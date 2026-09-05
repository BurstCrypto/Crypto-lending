import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_REDIS_ACL_BYTES,
  REDIS_ACL_FILE_INVALID_ERROR,
  validateRedisAclFile,
  validateRedisAclSource,
} from './validate-redis-acl.mjs';

const fixture = readFileSync(new URL('./users.acl', import.meta.url), 'utf8');

test('accepts the reviewed least-privilege local ACL fixture', () => {
  assert.deepEqual(validateRedisAclSource(fixture), []);
});

test('accepts the reviewed fixture through the controlled file boundary', () => {
  assert.deepEqual(
    validateRedisAclFile(fileURLToPath(new URL('./users.acl', import.meta.url))),
    [],
  );
});

test('controlled ACL loading rejects malformed UTF-8, a byte-order mark, and oversized input', () => {
  const invalidInputs = [
    Buffer.from([0xc3, 0x28]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fixture)]),
    Buffer.alloc(MAX_REDIS_ACL_BYTES + 1, 0x20),
  ];
  for (const bytes of invalidInputs) {
    const directory = mkdtempSync(join(tmpdir(), 'redis-acl-file-'));
    const path = join(directory, 'users.acl');
    try {
      writeFileSync(path, bytes);
      assert.deepEqual(validateRedisAclFile(path), [REDIS_ACL_FILE_INVALID_ERROR]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('controlled ACL loading rejects a multiply-linked file', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'redis-acl-link-'));
  const source = join(directory, 'source.acl');
  const linked = join(directory, 'linked.acl');
  try {
    writeFileSync(source, fixture, 'utf8');
    try {
      linkSync(source, linked);
    } catch (error) {
      context.skip(`hard links unavailable: ${error instanceof Error ? error.message : 'unknown'}`);
      return;
    }
    assert.deepEqual(validateRedisAclFile(linked), [REDIS_ACL_FILE_INVALID_ERROR]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [name, mutate, expected] of [
  [
    'anonymous access',
    (value) => value.replace('user default reset off', 'user default reset on'),
    'exact ordered',
  ],
  [
    'command category',
    (value) => value.replace('-@all +ping +quit', '-@all +@read +ping +quit'),
    'command categories',
  ],
  [
    'global keys',
    (value) => value.replace('resetkeys resetchannels', 'resetkeys ~* resetchannels'),
    'global keys',
  ],
  [
    'active standby',
    (value) => value.replace('user crypto_api_b reset off', 'user crypto_api_b reset on'),
    'exact ordered',
  ],
  [
    'administrative API command',
    (value) => value.replace('+ping +quit', '+ping +config|get +quit'),
    'exact ordered',
  ],
  [
    'unreviewed data command',
    (value) => value.replace('+ping +quit', '+ping +get +quit'),
    'exact ordered',
  ],
  [
    'plaintext password',
    (value) => value.replace(/#[0-9a-f]{64}/u, '>plaintext-local-value'),
    'plaintext passwords',
  ],
  [
    'operator key access',
    (value) =>
      value.replace(
        'resetkeys resetchannels -@all +ping +quit +acl|setuser',
        'resetkeys ~* resetchannels -@all +ping +quit +acl|setuser',
      ),
    'global keys',
  ],
  [
    'rule reordering',
    (value) => value.replace('reset on sanitize-payload', 'on reset sanitize-payload'),
    'exact ordered',
  ],
  [
    'reset after grants',
    (value) => value.replace('+ping +quit', '+ping +quit resetkeys'),
    'exact ordered',
  ],
  [
    'credential digest drift',
    (value) =>
      value.replace(
        '1b2c3478d952713964d64eea3e8db66170e24ba4c69858e45cd7f4a84878949c',
        'f5dfc373b8b26f789bee1f219d19378322fb9d14cfe30db260c563524dd23572',
      ),
    'exact ordered',
  ],
]) {
  test(`rejects ${name}`, () => {
    const errors = validateRedisAclSource(mutate(fixture));
    assert.ok(
      errors.some((error) => error.includes(expected)),
      errors.join('\n'),
    );
  });
}
