#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';

export const MAX_REDIS_ACL_BYTES = 65_536;
export const REDIS_ACL_FILE_INVALID_ERROR =
  'ACL file must be a bounded, canonical, stable, single-link UTF-8 file';

const EXPECTED_USERS = new Set(['default', 'crypto_api_a', 'crypto_api_b', 'local_acl_operator']);
const REVIEWED_HASHES = Object.freeze({
  crypto_api_a: '#1b2c3478d952713964d64eea3e8db66170e24ba4c69858e45cd7f4a84878949c',
  crypto_api_b: '#f5dfc373b8b26f789bee1f219d19378322fb9d14cfe30db260c563524dd23572',
  local_acl_operator: '#277ac4d731803df4f3dee092d6580ff3df5364fe45bc8f4acd73ec14dc3726aa',
});
const EXPECTED_RULES = Object.freeze({
  default: ['reset', 'off', 'sanitize-payload'],
  crypto_api_a: [
    'reset',
    'on',
    'sanitize-payload',
    REVIEWED_HASHES.crypto_api_a,
    'resetkeys',
    'resetchannels',
    '-@all',
    '+ping',
    '+quit',
  ],
  crypto_api_b: [
    'reset',
    'off',
    'sanitize-payload',
    REVIEWED_HASHES.crypto_api_b,
    'resetkeys',
    'resetchannels',
    '-@all',
    '+ping',
    '+quit',
  ],
  local_acl_operator: [
    'reset',
    'on',
    'sanitize-payload',
    REVIEWED_HASHES.local_acl_operator,
    'resetkeys',
    'resetchannels',
    '-@all',
    '+ping',
    '+quit',
    '+acl|setuser',
    '+acl|deluser',
    '+acl|getuser',
    '+acl|log',
    '+client|kill',
  ],
});

function parseUsers(source, errors) {
  const users = new Map();
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/u);
    if (tokens[0] !== 'user' || !tokens[1] || tokens.length < 3) {
      errors.push(`line ${index + 1} must contain one canonical user declaration`);
      continue;
    }
    if (users.has(tokens[1])) {
      errors.push(`user ${tokens[1]} must be declared exactly once`);
      continue;
    }
    users.set(tokens[1], tokens.slice(2));
  }
  return users;
}

export function validateRedisAclSource(source) {
  const errors = [];
  const users = parseUsers(source, errors);
  for (const expected of EXPECTED_USERS) {
    if (!users.has(expected)) errors.push(`missing required user ${expected}`);
  }
  for (const username of users.keys()) {
    if (!EXPECTED_USERS.has(username)) errors.push(`unreviewed fixed user ${username}`);
  }

  for (const [username, expected] of Object.entries(EXPECTED_RULES)) {
    const actual = users.get(username) ?? [];
    if (
      actual.length !== expected.length ||
      actual.some((rule, index) => rule !== expected[index])
    ) {
      errors.push(
        `${username} must match the exact ordered reviewed ACL rules and credential digest`,
      );
    }
  }

  if (/[>!]\S+/u.test(source)) {
    errors.push('ACL fixture must not contain plaintext passwords');
  }
  if (/(?:\+@|~\*|&\*|allcommands|allkeys|allchannels)/iu.test(source)) {
    errors.push('ACL fixture must not grant command categories, global keys, or global channels');
  }
  return errors;
}

export function validateRedisAclFile(path) {
  try {
    const bytes = readSecureLocalFile(path, MAX_REDIS_ACL_BYTES);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return [REDIS_ACL_FILE_INVALID_ERROR];
    }
    return validateRedisAclSource(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return [REDIS_ACL_FILE_INVALID_ERROR];
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const aclPath = resolve(process.argv[2] ?? 'infra/redis/users.acl');
  const errors = validateRedisAclFile(aclPath);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`Redis ACL validation failed: ${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Redis ACL validation passed.\n');
  }
}
