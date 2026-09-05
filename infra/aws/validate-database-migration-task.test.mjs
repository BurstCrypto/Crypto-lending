import assert from 'node:assert/strict';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR,
  MAX_DATABASE_MIGRATION_TEMPLATE_BYTES,
  readLocalTemplate,
  readLocalTemplateForTest,
  validateMigrationTaskTemplate,
} from './validate-database-migration-task.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const templatePath = join(scriptDirectory, 'database-migration-task.yaml');
const validatorPath = join(scriptDirectory, 'validate-database-migration-task.mjs');
const templateSource = readFileSync(templatePath, 'utf8');

function withTemporaryTemplate(contents, assertion) {
  const directory = mkdtempSync(join(tmpdir(), 'migration-template-input-'));
  const temporaryTemplatePath = join(directory, 'template.yaml');
  writeFileSync(temporaryTemplatePath, contents);
  try {
    assertion(temporaryTemplatePath, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertInputRejected(path) {
  assert.throws(
    () => readLocalTemplate(path),
    (error) =>
      error instanceof Error &&
      error.message === DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR &&
      !error.message.includes(path),
  );
}

function skipUnsupportedLink(error, context) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM', 'UNKNOWN'].includes(error.code)
  ) {
    context.skip(`symbolic links are unavailable: ${error.code}`);
    return true;
  }
  return false;
}

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
  assert.equal(report.residualLimitations.length, 1);
  assert.match(report.residualLimitations[0], /operator-supplied cross-stack inputs/);
  assert.match(report.residualLimitations[0], /cannot authenticate/);
});

test('securely loads the reviewed migration template', () => {
  const loaded = readLocalTemplate(templatePath);
  assert.equal(loaded.source, templateSource);
  assert.equal(loaded.resolved, templatePath);
});

test('rejects malformed UTF-8, a byte-order mark, empty input, and oversized input', () => {
  const bytes = readFileSync(templatePath);
  for (const contents of [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([0xff])]),
    Buffer.alloc(0),
    Buffer.alloc(MAX_DATABASE_MIGRATION_TEMPLATE_BYTES + 1, 0x20),
  ]) {
    withTemporaryTemplate(contents, assertInputRejected);
  }
});

test('rejects directory and hard-linked migration template inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-template-files-'));
  try {
    const directoryPath = join(directory, 'directory.yaml');
    mkdirSync(directoryPath);
    assertInputRejected(directoryPath);

    const sourcePath = join(directory, 'source.yaml');
    const linkedPath = join(directory, 'hard-link.yaml');
    writeFileSync(sourcePath, templateSource);
    linkSync(sourcePath, linkedPath);
    assertInputRejected(sourcePath);
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link migration template when supported', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'migration-template-symlink-'));
  try {
    const targetPath = join(directory, 'target.yaml');
    const linkedPath = join(directory, 'linked.yaml');
    writeFileSync(targetPath, templateSource);
    try {
      symlinkSync(targetPath, linkedPath, 'file');
    } catch (error) {
      if (skipUnsupportedLink(error, context)) return;
      throw error;
    }
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a same-size template rewrite during the stable descriptor read', () => {
  const original = Buffer.from(templateSource, 'utf8');
  const replacement = Buffer.from(
    templateSource.replace('Description: One-off', 'Description: Changed'),
    'utf8',
  );
  assert.equal(replacement.length, original.length);
  assert.notDeepEqual(replacement, original);

  withTemporaryTemplate(original, (path) => {
    assert.throws(
      () =>
        readLocalTemplateForTest(path, () => {
          writeFileSync(path, replacement);
        }),
      (error) =>
        error instanceof Error && error.message === DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR,
    );
  });
});

test('CLI input failures expose one fixed path-free error', () => {
  const hostilePath = join(tmpdir(), 'missing-template-with-sensitive-name.yaml');
  const result = spawnSync(process.execPath, [validatorPath, '--template', hostilePath, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
    windowsHide: true,
  });

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR}\n`);
  assert.equal(result.stderr.includes(hostilePath), false);
});

test('rejects an API image or repository parameter that can select another artifact', () => {
  assertRejected(
    mutate(
      '/crypto-lending-api@sha256:[a-f0-9]{64}$',
      '/crypto-lending-[a-z0-9-]+@sha256:[a-f0-9]{64}$',
    ),
    /ApiImageUri must bind only the exact immutable crypto-lending-api artifact/,
  );
  assertRejected(
    mutate("repository/crypto-lending-api$'", "repository/crypto-lending-[a-z0-9-]+$'"),
    /ApiImageRepositoryArn must bind only the exact immutable crypto-lending-api artifact/,
  );
  assertRejected(
    mutate('          Image: !Ref ApiImageUri', '          Image: !Ref UnreviewedImageUri'),
    /MigrationTaskDefinition must bind exactly one immutable Image reference to ApiImageUri/,
  );
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

test('rejects widening the migration ECS trust policy', () => {
  for (const [search, replacement] of [
    ['Service: ecs-tasks.amazonaws.com', 'Service: lambda.amazonaws.com'],
    [
      'StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
      "StringEquals: { aws:SourceAccount: '999999999999' }",
    ],
    [
      "aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'",
      "aws:SourceArn: '*'",
    ],
    ['Action: sts:AssumeRole', 'Action: sts:*'],
  ]) {
    assertRejected(
      mutate(search, replacement),
      /single-account, regional ECS task trust policy with no additional principal or action/,
    );
  }
});

test('rejects widening the migration execution-role capability matrix', () => {
  for (const [search, replacement] of [
    [
      '                Resource: !Ref DatabaseMigrationCredentialsSecretArn',
      [
        '                Resource:',
        '                  - !Ref DatabaseMigrationCredentialsSecretArn',
        '                  - arn:aws:secretsmanager:us-west-2:000000000000:secret:runtime',
      ].join('\n'),
    ],
    [
      '                Action: secretsmanager:GetSecretValue',
      '                Action: [secretsmanager:GetSecretValue, sqs:SendMessage]',
    ],
    [
      'kms:ViaService: !Sub secretsmanager.${AWS::Region}.${AWS::URLSuffix}',
      'kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}',
    ],
    [
      'Resource: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/crypto-lending/${EnvironmentName}/outbox-worker:*',
      "Resource: '*'",
    ],
  ]) {
    assertRejected(
      mutate(search, replacement),
      /exact image-pull, migration-log, migration-secret, and Secrets Manager-only KMS action\/resource matrix/,
    );
  }

  assertRejected(
    mutate(
      '      Policies:\n',
      '      ManagedPolicyArns:\n        - arn:aws:iam::aws:policy/AdministratorAccess\n      Policies:\n',
    ),
    /must not attach managed policies outside its exact inline capability matrix/,
  );
});

test('rejects migration role remapping and cross-scope secret injection', () => {
  assertRejected(
    mutate(
      'ExecutionRoleArn: !GetAtt MigrationTaskExecutionRole.Arn',
      'ExecutionRoleArn: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:role/other-role',
    ),
    /must use only MigrationTaskExecutionRole as its ECS execution role/,
  );

  assertRejected(
    mutate(
      "ValueFrom: !Sub '${DatabaseMigrationCredentialsSecretArn}:username::'",
      "ValueFrom: !Sub '${DatabaseMigrationCredentialsSecretArn}:password::'",
    ),
    /exact migration-only username and password injection/,
  );

  assertRejected(
    mutate(
      '            - { Name: NODE_ENV, Value: production }',
      '            - { Name: NODE_ENV, Value: production }\n            - { Name: MIGRATION_DATABASE_PASSWORD, Value: plaintext-is-prohibited }',
    ),
    /inject migration credentials only through ECS Secrets/,
  );

  assertRejected(
    mutate(
      "              ValueFrom: !Sub '${DatabaseMigrationCredentialsSecretArn}:password::'",
      [
        "              ValueFrom: !Sub '${DatabaseMigrationCredentialsSecretArn}:password::'",
        '            - Name: REDIS_AUTH_TOKEN',
        "              ValueFrom: !Sub '${DatabaseMigrationCredentialsSecretArn}:authToken::'",
      ].join('\n'),
    ),
    /exact migration-only username and password injection/,
  );

  for (const variableName of [
    'REDIS_URL',
    'REDIS_HOST',
    'REDIS_USERNAME',
    'REDIS_PASSWORD',
    'APPLICATION_WORKLOAD',
    'NODE_TLS_REJECT_UNAUTHORIZED',
  ]) {
    assertRejected(
      mutate(
        '            - { Name: NODE_ENV, Value: production }',
        `            - { Name: NODE_ENV, Value: production }\n            - { Name: ${variableName}, Value: prohibited }`,
      ),
      /must not receive runtime, Redis, workload, or process-wide TLS overrides/,
    );
  }
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

test('rejects database names outside the canonical lowercase principal-bootstrap contract', () => {
  assertRejected(
    mutate(
      "AllowedPattern: '^[a-z][a-z0-9_]{0,62}$'",
      "AllowedPattern: '^[A-Za-z][A-Za-z0-9_]{0,62}$'",
    ),
    /canonical lowercase PostgreSQL identifier contract/,
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
  assert.equal(result.stderr, `${DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR}\n`);
});
