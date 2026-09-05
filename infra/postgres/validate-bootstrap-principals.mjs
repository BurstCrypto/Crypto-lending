#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';

export const MAX_BOOTSTRAP_PRINCIPALS_BYTES = 65_536;
export const BOOTSTRAP_PRINCIPALS_FILE_INVALID_ERROR =
  'Bootstrap principal source must be a bounded, stable, single-link UTF-8 file';

const REQUIRED_BALANCE_INPUTS = Object.freeze([
  'balance_consumer_runtime_role',
  'balance_consumer_login_prefix',
  'balance_consumer_login',
]);

const REQUIRED_SENTINELS = Object.freeze([
  'SELECT count(DISTINCT role_name) = 10',
  ":'balance_consumer_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'",
  ":'balance_consumer_login_prefix' ~ '^[a-z][a-z0-9_]{0,29}_$'",
  ":'balance_consumer_login' ~ '^[a-z][a-z0-9_]{0,62}$'",
  ":'balance_consumer_login' ~ (",
  "pg_catalog.length(:'balance_consumer_login_prefix')",
  'SELECT count(*) BETWEEN 1 AND 2',
  'login_role.rolname !~ (',
  "member_role.rolname = :'balance_consumer_runtime_role'",
  "granted_role.rolname = :'balance_consumer_runtime_role'",
  'AND NOT membership.admin_option',
  'AND NOT membership.inherit_option',
  'AND membership.set_option',
  'CREATE ROLE %5$I\n      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;',
  'ALTER ROLE %5$I\n    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS\n    PASSWORD NULL;',
  "'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',\n  :'balance_consumer_runtime_role', :'balance_consumer_login'",
  ':"balance_consumer_runtime_role"',
  ':"balance_consumer_login"',
  "'GRANT CONNECT ON DATABASE %I TO %I, %I, %I'",
  'AS balance_consumer_boundary_valid',
  'FROM pg_catalog.pg_database AS other_database',
  'owned_database.datdba = audited_role.oid',
  'owned_namespace.nspowner = audited_role.oid',
  'owned_object.relowner = audited_role.oid',
  'owned_procedure.proowner = audited_role.oid',
  'owned_type.typowner = audited_role.oid',
  'owned_defaults.defaclrole = audited_role.oid',
  'FROM pg_catalog.pg_namespace AS namespace',
  'FROM pg_catalog.pg_class AS object',
  'FROM pg_catalog.pg_proc AS procedure',
  'FROM pg_catalog.pg_type AS type_object',
  'FROM pg_catalog.pg_default_acl AS defaults',
  'ROLLBACK;\n  DO $invalid_balance_consumer_boundary$',
]);

const REQUIRED_FINAL_AUDITS = Object.freeze([
  "pg_catalog.has_database_privilege(\n           login_role.oid, pg_catalog.current_database(), 'CONNECT'",
  'WHERE database.datname = pg_catalog.current_database()',
  'FROM pg_catalog.pg_database AS other_database',
  "audited_role.oid, other_database.oid, 'CREATE'",
  "audited_role.oid, other_database.oid, 'TEMP'",
  'FROM pg_catalog.pg_database AS explicitly_granted_database',
  'pg_catalog.aclexplode(explicitly_granted_database.datacl)',
  'FROM pg_catalog.pg_namespace AS namespace',
  'FROM pg_catalog.pg_class AS object',
  'FROM pg_catalog.pg_attribute AS attribute',
  'FROM pg_catalog.pg_proc AS procedure',
  'FROM pg_catalog.pg_type AS type_object',
  'FROM pg_catalog.pg_default_acl AS defaults',
]);

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function requireOrdered(source, ordered, errors) {
  let cursor = -1;
  for (const sentinel of ordered) {
    const next = source.indexOf(sentinel, cursor + 1);
    if (next < 0) {
      errors.push(`missing ordered bootstrap boundary: ${sentinel}`);
      return;
    }
    cursor = next;
  }
}

function containsForbiddenBalanceAclGrant(source) {
  const grantPattern =
    /\bGRANT\s+(?:ALL(?:\s+PRIVILEGES)?|CONNECT|CREATE|DELETE|EXECUTE|INSERT|REFERENCES|SELECT|TEMP(?:ORARY)?|TRIGGER|TRUNCATE|UPDATE|USAGE)\b/giu;
  const balanceTarget = /(?:balance_consumer_runtime_role|balance_consumer_login)/iu;
  for (const match of source.matchAll(grantPattern)) {
    const remainder = source.slice(match.index ?? 0, (match.index ?? 0) + 2_048);
    const terminators = [remainder.indexOf(';'), remainder.indexOf('\n\\gexec')].filter(
      (index) => index >= 0,
    );
    const end = terminators.length > 0 ? Math.min(...terminators) : remainder.length;
    if (balanceTarget.test(remainder.slice(0, end))) return true;
  }
  return false;
}

function splitSqlCommands(source) {
  const commands = [];
  let commandStart = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag;

  for (let index = 0; index < source.length; index += 1) {
    if (dollarTag !== undefined) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = undefined;
      }
      continue;
    }
    const character = source[index];
    if (singleQuoted) {
      if (character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      if (character === '"' && source[index + 1] === '"') {
        index += 1;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (character === "'") {
      singleQuoted = true;
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      continue;
    }
    if (character === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(source.slice(index))?.[0];
      if (tag !== undefined) {
        dollarTag = tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (character === ';') {
      commands.push(source.slice(commandStart, index + 1));
      commandStart = index + 1;
    }
  }
  commands.push(source.slice(commandStart));
  return commands.flatMap((command) => command.split(/^\s*\\gexec\s*$/gimu));
}

function containsForbiddenBalanceCredentialMutation(source) {
  const roleMutation = /\b(?:CREATE|ALTER)\s+(?:ROLE|USER)\b/iu;
  const passwordMutation = /\bPASSWORD\b/iu;
  const balanceLoginTarget =
    /\bbalance_consumer_login\b|\bcrypto_balance_consumer_login_[a-z0-9]+\b/iu;
  return splitSqlCommands(source).some(
    (command) =>
      roleMutation.test(command) &&
      passwordMutation.test(command) &&
      balanceLoginTarget.test(command),
  );
}

export function validateBootstrapPrincipalsSource(source) {
  const errors = [];
  if (typeof source !== 'string' || source.length === 0) {
    return ['Bootstrap principal source must be non-empty text'];
  }

  for (const input of REQUIRED_BALANCE_INPUTS) {
    if (countOccurrences(source, `\\if :{?${input}}`) !== 1) {
      errors.push(`${input} must have exactly one fail-closed required-input check`);
    }
    if (!source.includes(`missing required psql variable: ${input}`)) {
      errors.push(`${input} must fail closed when omitted`);
    }
  }
  for (const sentinel of REQUIRED_SENTINELS) {
    if (!source.includes(sentinel)) {
      errors.push(`missing reviewed balance-consumer bootstrap sentinel: ${sentinel}`);
    }
  }
  if (countOccurrences(source, 'SELECT count(*) BETWEEN 1 AND 2') !== 2) {
    errors.push('broad balance-consumer login inventory must be bounded before and after mutation');
  }

  const finalBoundaryStart = source.indexOf('-- The balance consumer remains dormant');
  const finalBoundaryEnd = source.indexOf('AS balance_consumer_boundary_valid');
  const finalBoundary =
    finalBoundaryStart >= 0 && finalBoundaryEnd > finalBoundaryStart
      ? source.slice(finalBoundaryStart, finalBoundaryEnd)
      : '';
  for (const audit of REQUIRED_FINAL_AUDITS) {
    if (!finalBoundary.includes(audit)) {
      errors.push(`final balance-consumer boundary must retain audit: ${audit}`);
    }
  }

  const prefixSeparationChecks = [
    ["'api_login_prefix'", "'balance_consumer_login_prefix'"],
    ["'balance_consumer_login_prefix'", "'api_login_prefix'"],
    ["'worker_login_prefix'", "'balance_consumer_login_prefix'"],
    ["'balance_consumer_login_prefix'", "'worker_login_prefix'"],
  ];
  for (const [candidate, boundary] of prefixSeparationChecks) {
    const pattern = new RegExp(
      `pg_catalog\\.left\\([\\s\\S]{0,80}:${candidate},[\\s\\S]{0,100}:${boundary}[\\s\\S]{0,40}<>\\s*:${boundary}`,
      'u',
    );
    if (!pattern.test(source)) {
      errors.push(`login prefixes must be pairwise disjoint: ${candidate} versus ${boundary}`);
    }
  }

  const scopedSessionPattern =
    /pg_catalog\.left\(\s*usename,\s*pg_catalog\.length\(:'balance_consumer_login_prefix'\)\s*\)\s*=\s*:'balance_consumer_login_prefix'/u;
  if (!scopedSessionPattern.test(source)) {
    errors.push('balance-consumer session drain must use the broad prefix inventory');
  }

  const forbiddenCredentialPatterns = [
    /balance_consumer_(?:login_)?password/iu,
    /PASSWORD\s+(?!NULL\b)[^\s;]+/iu,
  ];
  if (
    forbiddenCredentialPatterns.some((pattern) => pattern.test(source)) ||
    containsForbiddenBalanceCredentialMutation(source)
  ) {
    errors.push('Bootstrap must never accept, embed, print, or mutate credential material');
  }
  if (containsForbiddenBalanceAclGrant(source)) {
    errors.push('Bootstrap must keep balance-consumer database, schema, and object ACLs denied');
  }

  requireOrdered(
    source,
    [
      '\\if :{?balance_consumer_runtime_role}',
      'BEGIN;',
      'AS bootstrap_inputs_valid',
      '$create_capability_roles$',
      ":'balance_consumer_runtime_role', :'balance_consumer_login'",
      "'GRANT CONNECT ON DATABASE %I TO %I, %I, %I'",
      'AS balance_consumer_boundary_valid',
      'COMMIT;',
    ],
    errors,
  );
  if (
    countOccurrences(source, 'BEGIN;') !== 1 ||
    countOccurrences(source, 'COMMIT;') !== 1 ||
    source.indexOf('COMMIT;') < finalBoundaryEnd ||
    !source.trimEnd().endsWith('COMMIT;')
  ) {
    errors.push('bootstrap must have one transaction committed only after final validation');
  }

  return errors;
}

export function validateBootstrapPrincipalsFile(path) {
  try {
    const bytes = readSecureLocalFile(path, MAX_BOOTSTRAP_PRINCIPALS_BYTES);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return [BOOTSTRAP_PRINCIPALS_FILE_INVALID_ERROR];
    }
    return validateBootstrapPrincipalsSource(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    return [BOOTSTRAP_PRINCIPALS_FILE_INVALID_ERROR];
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const sourcePath = resolve(process.argv[2] ?? 'infra/postgres/bootstrap-principals.sql');
  const errors = validateBootstrapPrincipalsFile(sourcePath);
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`Bootstrap principal validation failed: ${error}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write('Bootstrap principal validation passed.\n');
  }
}
