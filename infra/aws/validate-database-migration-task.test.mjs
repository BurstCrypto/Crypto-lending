import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { validateMigrationTaskTemplate } from './validate-database-migration-task.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const templatePath = join(scriptDirectory, 'database-migration-task.yaml');
const validatorPath = join(scriptDirectory, 'validate-database-migration-task.mjs');
const templateSource = readFileSync(templatePath, 'utf8');

function mutate(search, replacement) {
  const result = templateSource.replace(search, replacement);
  assert.notEqual(result, templateSource, `Mutation must replace ${search}.`);
  return result;
}

function assertRejected(source, message) {
  const report = validateMigrationTaskTemplate(source);
  assert.equal(report.ok, false);
  assert.equal(report.awsCallsMade, 0);
  assert(
    report.errors.some((error) => message.test(error)),
    report.errors.join('\n'),
  );
}

test('accepts the reviewed one-off migration task without AWS calls', () => {
  const report = validateMigrationTaskTemplate(templateSource);
  assert.equal(report.ok, true);
  assert.equal(report.awsCallsMade, 0);
  assert.deepEqual(report.errors, []);
});

test('rejects attaching the migration task to an ECS service', () => {
  assertRejected(
    mutate(
      'Outputs:\n',
      [
        '  UnexpectedMigrationService:',
        '    Type: AWS::ECS::Service',
        '    Properties:',
        '      DesiredCount: 1',
        '      TaskDefinition: !Ref MigrationTaskDefinition',
        '',
        'Outputs:',
        '',
      ].join('\n'),
    ),
    /one-off with no ECS service/,
  );
});

test('rejects runtime credentials in the migration task', () => {
  assertRejected(
    mutate('MIGRATION_DATABASE_PASSWORD', 'DATABASE_RUNTIME_PASSWORD'),
    /must not expose runtime database credentials/,
  );
});

test('rejects wildcard migration-secret access', () => {
  assertRejected(
    mutate(
      '                Resource: !Ref DatabaseMigrationCredentialsSecretArn',
      "                Resource: '*'",
    ),
    /must read only the migration secret parameter/,
  );
});

test('rejects a migration task that does not explicitly run up', () => {
  assertRejected(
    mutate(
      'Command: [node, dist/infrastructure/database/migration.cli.js, --production, up]',
      'Command: [node, dist/infrastructure/database/migration.cli.js, --production, status]',
    ),
    /compiled migration CLI in enforced production mode with command up/,
  );
});

test('rejects weakening verified database TLS', () => {
  assertRejected(
    mutate(
      '{ Name: MIGRATION_DATABASE_SSL_MODE, Value: verify-full }',
      '{ Name: MIGRATION_DATABASE_SSL_MODE, Value: require }',
    ),
    /missing reviewed hardening/,
  );
});

test('rejects migration DDL and lock timeout drift', () => {
  assertRejected(
    mutate(
      "{ Name: MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS, Value: '3600000' }",
      "{ Name: MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS, Value: '15000' }",
    ),
    /missing reviewed hardening/,
  );
  assertRejected(
    mutate(
      "{ Name: MIGRATION_DATABASE_LOCK_TIMEOUT_MS, Value: '10000' }",
      "{ Name: MIGRATION_DATABASE_LOCK_TIMEOUT_MS, Value: '0' }",
    ),
    /missing reviewed hardening/,
  );
});

test('rejects any property-complete template mutation', () => {
  assertRejected(
    mutate('Description: One-off', 'Description: Mutated one-off'),
    /does not match reviewed baseline/,
  );
});

test('CLI rejects URI inputs before filesystem or network access', () => {
  const result = spawnSync(
    process.execPath,
    [validatorPath, '--template', 'https://example.invalid/migration.yaml', '--json'],
    {
      encoding: 'utf8',
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
      windowsHide: true,
    },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /local filesystem path, not a URI or network path/);
});
