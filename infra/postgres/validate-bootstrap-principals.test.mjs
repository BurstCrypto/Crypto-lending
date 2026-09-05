import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BOOTSTRAP_PRINCIPALS_FILE_INVALID_ERROR,
  MAX_BOOTSTRAP_PRINCIPALS_BYTES,
  validateBootstrapPrincipalsFile,
  validateBootstrapPrincipalsSource,
} from './validate-bootstrap-principals.mjs';

const fixturePath = fileURLToPath(new URL('./bootstrap-principals.sql', import.meta.url));
const fixture = readFileSync(fixturePath, 'utf8');

function expectRejected(source, expected) {
  const errors = validateBootstrapPrincipalsSource(source);
  assert.ok(
    errors.some((error) => error.includes(expected)),
    errors.join('\n'),
  );
}

function replaceLast(source, target, replacement) {
  const index = source.lastIndexOf(target);
  assert.notEqual(index, -1, `missing mutation target: ${target}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + target.length)}`;
}

test('accepts the reviewed dormant balance-consumer bootstrap boundary', () => {
  assert.deepEqual(validateBootstrapPrincipalsSource(fixture), []);
  assert.deepEqual(validateBootstrapPrincipalsFile(fixturePath), []);
});

for (const input of [
  'balance_consumer_runtime_role',
  'balance_consumer_login_prefix',
  'balance_consumer_login',
]) {
  test(`rejects an omitted ${input} input guard`, () => {
    expectRejected(
      fixture.replace(`\\if :{?${input}}`, `\\if :{?removed_${input}}`),
      `${input} must have exactly one`,
    );
  });
}

test('rejects malformed balance role, prefix, and login identifier validation', () => {
  for (const [source, expected] of [
    [
      fixture.replace(":'balance_consumer_runtime_role' ~ '^[a-z][a-z0-9_]{0,62}$'", 'true'),
      'balance_consumer_runtime_role',
    ],
    [
      fixture.replace(":'balance_consumer_login_prefix' ~ '^[a-z][a-z0-9_]{0,29}_$'", 'true'),
      'balance_consumer_login_prefix',
    ],
    [
      fixture.replace(":'balance_consumer_login' ~ '^[a-z][a-z0-9_]{0,62}$'", 'true'),
      'balance_consumer_login',
    ],
  ]) {
    expectRejected(source, expected);
  }
});

test('rejects cross-scoped role aliases and overlapping login prefixes', () => {
  expectRejected(
    fixture.replace('SELECT count(DISTINCT role_name) = 10', 'SELECT true'),
    'count(DISTINCT role_name)',
  );
  expectRejected(
    fixture.replace(
      "AND pg_catalog.left(\n         :'api_login_prefix', pg_catalog.length(:'balance_consumer_login_prefix')\n       ) <> :'balance_consumer_login_prefix'",
      '',
    ),
    'pairwise disjoint',
  );
});

test('rejects unbounded, malformed, or incompletely drained prefix inventories', () => {
  expectRejected(
    fixture.replaceAll('SELECT count(*) BETWEEN 1 AND 2', 'SELECT count(*) >= 1'),
    'inventory must be bounded',
  );
  expectRejected(fixture.replaceAll('login_role.rolname !~ (', 'false OR ('), 'rolname !~');
  expectRejected(
    fixture.replace(
      /OR pg_catalog\.left\(\s*usename,\s*pg_catalog\.length\(:'balance_consumer_login_prefix'\)\s*\) = :'balance_consumer_login_prefix'/u,
      '',
    ),
    'session drain',
  );
});

test('rejects weakened or cross-role membership graphs', () => {
  expectRejected(
    fixture.replaceAll('AND membership.set_option', 'AND NOT membership.set_option'),
    'membership.set_option',
  );
  expectRejected(
    fixture.replaceAll("member_role.rolname = :'balance_consumer_runtime_role'", 'false'),
    "member_role.rolname = :'balance_consumer_runtime_role'",
  );
  expectRejected(
    fixture.replaceAll("granted_role.rolname = :'balance_consumer_runtime_role'", 'false'),
    "granted_role.rolname = :'balance_consumer_runtime_role'",
  );
});

for (const [name, anchor] of [
  ['current database CONNECT denial', "login_role.oid, pg_catalog.current_database(), 'CONNECT'"],
  ['current database direct ACLs', 'WHERE database.datname = pg_catalog.current_database()'],
  ['cross-database access', 'FROM pg_catalog.pg_database AS other_database'],
  ['cross-database CREATE', "audited_role.oid, other_database.oid, 'CREATE'"],
  ['cross-database TEMP', "audited_role.oid, other_database.oid, 'TEMP'"],
  ['cross-database direct ACLs', 'FROM pg_catalog.pg_database AS explicitly_granted_database'],
  [
    'cross-database direct ACL expansion',
    'pg_catalog.aclexplode(explicitly_granted_database.datacl)',
  ],
  ['database ownership', 'owned_database.datdba = audited_role.oid'],
  ['schema ownership in every namespace', 'owned_namespace.nspowner = audited_role.oid'],
  ['relation ownership in every namespace', 'owned_object.relowner = audited_role.oid'],
  ['function ownership in every namespace', 'owned_procedure.proowner = audited_role.oid'],
  ['type ownership in every namespace', 'owned_type.typowner = audited_role.oid'],
  ['default ACL ownership in every namespace', 'owned_defaults.defaclrole = audited_role.oid'],
  ['schema access', 'FROM pg_catalog.pg_namespace AS namespace'],
  ['table and sequence ACLs', 'FROM pg_catalog.pg_class AS object'],
  ['column ACLs', 'FROM pg_catalog.pg_attribute AS attribute'],
  ['function ACLs', 'FROM pg_catalog.pg_proc AS procedure'],
  ['type ACLs', 'FROM pg_catalog.pg_type AS type_object'],
  ['default ACLs', 'FROM pg_catalog.pg_default_acl AS defaults'],
]) {
  test(`rejects removal of ${name} auditing`, () => {
    expectRejected(
      replaceLast(fixture, anchor, `FROM removed_${name.replaceAll(' ', '_')}`),
      anchor,
    );
  });
}

test('rejects credential handling and balance-consumer schema or function grants', () => {
  expectRejected(
    `${fixture}\nALTER ROLE :"balance_consumer_login" PASSWORD 'not-allowed';\n`,
    'credential material',
  );
  expectRejected(
    `${fixture}\nALTER ROLE :"balance_consumer_login" PASSWORD NULL;\n`,
    'credential material',
  );
  expectRejected(
    `${fixture}\nCREATE ROLE :"balance_consumer_login" LOGIN PASSWORD NULL;\n`,
    'credential material',
  );
  expectRejected(
    `${fixture}\nALTER USER :"balance_consumer_login" PASSWORD NULL;\n`,
    'credential material',
  );
  expectRejected(
    `${fixture}\nSELECT pg_catalog.format('ALTER ROLE %I PASSWORD NULL', :'balance_consumer_login') AS unsafe_statement\n\\gexec\n`,
    'credential material',
  );
  expectRejected(
    `${fixture}\nSELECT pg_catalog.format('CREATE USER %I LOGIN PASSWORD NULL', :'balance_consumer_login') AS unsafe_statement\n\\gexec\n`,
    'credential material',
  );
  expectRejected(
    `${fixture}\nGRANT USAGE ON SCHEMA public TO :"balance_consumer_runtime_role";\n`,
    'database, schema, and object ACLs',
  );
  expectRejected(
    `${fixture}\nGRANT EXECUTE ON FUNCTION unsafe() TO :"balance_consumer_runtime_role";\n`,
    'database, schema, and object ACLs',
  );
  expectRejected(
    `${fixture}\nGRANT CONNECT ON DATABASE :"database" TO :"balance_consumer_login";\n`,
    'database, schema, and object ACLs',
  );
  expectRejected(
    `${fixture}\nGRANT SELECT ON job_outbox\nTO :"balance_consumer_login";\n`,
    'database, schema, and object ACLs',
  );
});

test('rejects commit-before-validation ordering', () => {
  const withoutFinalCommit = replaceLast(fixture, '\nCOMMIT;\n', '\n');
  expectRejected(
    withoutFinalCommit.replace(
      'AS balance_consumer_boundary_valid',
      'COMMIT;\nAS balance_consumer_boundary_valid',
    ),
    'committed only after final validation',
  );
});

test('controlled loading rejects malformed UTF-8, BOM, and oversized input', () => {
  const invalidInputs = [
    Buffer.from([0xc3, 0x28]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fixture)]),
    Buffer.alloc(MAX_BOOTSTRAP_PRINCIPALS_BYTES + 1, 0x20),
  ];
  for (const bytes of invalidInputs) {
    const directory = mkdtempSync(join(tmpdir(), 'bootstrap-principals-file-'));
    const path = join(directory, 'bootstrap-principals.sql');
    try {
      writeFileSync(path, bytes);
      assert.deepEqual(validateBootstrapPrincipalsFile(path), [
        BOOTSTRAP_PRINCIPALS_FILE_INVALID_ERROR,
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('controlled loading rejects multiply-linked input', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'bootstrap-principals-link-'));
  const source = join(directory, 'source.sql');
  const linked = join(directory, 'linked.sql');
  try {
    writeFileSync(source, fixture, 'utf8');
    try {
      linkSync(source, linked);
    } catch (error) {
      context.skip(`hard links unavailable: ${error instanceof Error ? error.message : 'unknown'}`);
      return;
    }
    assert.deepEqual(validateBootstrapPrincipalsFile(linked), [
      BOOTSTRAP_PRINCIPALS_FILE_INVALID_ERROR,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
