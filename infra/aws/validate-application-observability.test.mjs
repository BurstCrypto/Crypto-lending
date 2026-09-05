import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { join } from 'node:path';
import { test } from 'node:test';

import {
  APPLICATION_OBSERVABILITY_ARGUMENT_ERROR,
  APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR,
  MAX_APPLICATION_OBSERVABILITY_TEMPLATE_BYTES,
  readLocalApplicationObservabilityTemplate,
  readLocalApplicationObservabilityTemplateForTest,
  validateApplicationObservabilitySource,
} from './validate-application-observability.mjs';

const templatePath = join(import.meta.dirname, 'application-observability.yaml');
const validatorPath = join(import.meta.dirname, 'validate-application-observability.mjs');
const source = readFileSync(templatePath, 'utf8');

function withTemporaryTemplate(contents, assertion) {
  const directory = mkdtempSync(join(tmpdir(), 'application-observability-input-'));
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
    () => readLocalApplicationObservabilityTemplate(path),
    (error) =>
      error instanceof Error &&
      error.message === APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR &&
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

test('accepts the exact reviewed observability child without external calls', () => {
  const report = validateApplicationObservabilitySource(source);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.awsCallsMade, 0);
});

test('securely loads the exact reviewed observability child', () => {
  const loaded = readLocalApplicationObservabilityTemplate(templatePath);
  assert.equal(loaded.source, source);
  assert.equal(loaded.resolved, templatePath);
});

test('rejects malformed UTF-8, a byte-order mark, empty input, and oversized input', () => {
  const bytes = readFileSync(templatePath);
  for (const contents of [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([0xff])]),
    Buffer.alloc(0),
    Buffer.alloc(MAX_APPLICATION_OBSERVABILITY_TEMPLATE_BYTES + 1, 0x20),
  ]) {
    withTemporaryTemplate(contents, assertInputRejected);
  }
});

test('rejects directory and hard-linked observability template inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'application-observability-files-'));
  try {
    const directoryPath = join(directory, 'directory.yaml');
    mkdirSync(directoryPath);
    assertInputRejected(directoryPath);

    const sourcePath = join(directory, 'source.yaml');
    const linkedPath = join(directory, 'hard-link.yaml');
    writeFileSync(sourcePath, source);
    linkSync(sourcePath, linkedPath);
    assertInputRejected(sourcePath);
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link observability template when supported', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'application-observability-symlink-'));
  try {
    const targetPath = join(directory, 'target.yaml');
    const linkedPath = join(directory, 'linked.yaml');
    writeFileSync(targetPath, source);
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

test('rejects a same-size rewrite during the stable descriptor read', () => {
  const original = Buffer.from(source, 'utf8');
  const replacement = Buffer.from(
    source.replace('Description: Production', 'Description: Unreviewed'),
    'utf8',
  );
  assert.equal(replacement.length, original.length);
  assert.notDeepEqual(replacement, original);

  withTemporaryTemplate(original, (path) => {
    assert.throws(
      () =>
        readLocalApplicationObservabilityTemplateForTest(path, () => {
          writeFileSync(path, replacement);
        }),
      (error) =>
        error instanceof Error && error.message === APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR,
    );
  });
});

test('CLI input and argument failures expose only fixed path-free errors', () => {
  const hostilePath = join(tmpdir(), 'missing-observability-template-with-sensitive-name.yaml');
  const inputFailure = spawnSync(
    process.execPath,
    [validatorPath, '--template', hostilePath, '--json'],
    {
      encoding: 'utf8',
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
      windowsHide: true,
    },
  );

  assert.equal(inputFailure.status, 2);
  assert.equal(inputFailure.stdout, '');
  assert.equal(
    inputFailure.stderr,
    `${APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR}\nAWS API calls made: 0\n`,
  );
  assert.equal(inputFailure.stderr.includes(hostilePath), false);

  const hostileArgument = '--sensitive-customer-token';
  const argumentFailure = spawnSync(process.execPath, [validatorPath, hostileArgument], {
    encoding: 'utf8',
    env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
    windowsHide: true,
  });

  assert.equal(argumentFailure.status, 2);
  assert.equal(argumentFailure.stdout, '');
  assert.equal(
    argumentFailure.stderr,
    `${APPLICATION_OBSERVABILITY_ARGUMENT_ERROR}\nAWS API calls made: 0\n`,
  );
  assert.equal(argumentFailure.stderr.includes(hostileArgument), false);
});

test('rejects line-ending drift even when the parsed YAML would be equivalent', () => {
  const mutated = source.replace(/\n/g, '\r\n');
  assert.notEqual(mutated, source);
  const report = validateApplicationObservabilitySource(mutated);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /does not match reviewed bytes/);
});

test('requires an explicit operator VersionId and an auditable selector-free secret ARN', () => {
  const versionBlock = [
    '  RedisOperatorSecretVersionId:',
    '    Type: String',
    "    AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'",
  ].join('\n');
  for (const mutated of [
    source.replace(versionBlock, ''),
    source.replace('{32,64}', '+'),
    source.replace(
      "    Type: String\n    AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'",
      `    Type: String\n    Default: UNPINNED\n    AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'`,
    ),
    source.replace(
      '  RedisOperatorSecretArn:\n    Type: String',
      '  RedisOperatorSecretArn:\n    Type: String\n    NoEcho: true',
    ),
  ]) {
    assert.notEqual(mutated, source);
    const report = validateApplicationObservabilitySource(mutated);
    assert.equal(report.ok, false);
    assert.equal(report.awsCallsMade, 0);
  }
});

test('rejects omitted, mutable-stage, and alternate operator password selectors', () => {
  const exact = '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}';
  for (const replacement of [
    '${RedisOperatorSecretArn}:password::',
    '${RedisOperatorSecretArn}:password:AWSCURRENT:',
    '${RedisOperatorSecretArn}:password:AWSPREVIOUS:',
    '${RedisOperatorSecretArn}:password::${RedisApiSlotAVersionId}',
  ]) {
    const mutated = source.replace(exact, replacement);
    assert.notEqual(mutated, source);
    const report = validateApplicationObservabilitySource(mutated);
    assert.equal(report.ok, false);
    assert.equal(report.awsCallsMade, 0);
    assert.match(
      report.errors.join('\n'),
      /immutable operator secret VersionId|reviewed invariant/,
    );
  }
});

for (const [name, search, replacement] of [
  ['alarm action', 'AlarmActions: [!Ref AlarmTopicArn]', 'AlarmActions: []'],
  ['OK action', 'OKActions: [!Ref AlarmTopicArn]', 'OKActions: []'],
  [
    'alarm condition',
    "CreateAlarms: !Equals [!Ref EnableOperationalAlarms, 'true']",
    "CreateAlarms: !Equals [!Ref EnableOperationalDashboard, 'true']",
  ],
  [
    'topic rule',
    '- !Not [!Equals [!Ref AlarmTopicArn, NONE]]',
    "- !Equals [!Ref EnableOperationalAlarms, 'true']",
  ],
  ['ALB dimension', 'Value: !Ref LoadBalancerFullName', 'Value: !Ref ApiTargetGroupFullName'],
  [
    'database dimension',
    'Value: !Ref DatabaseInstanceIdentifier',
    'Value: !Ref RedisReplicationGroupId',
  ],
  ['queue dimension', 'Value: !Ref JobQueueName', 'Value: !Ref JobDeadLetterQueueName'],
  [
    'balance queue dimension',
    'Value: !Ref BalanceQueueName',
    'Value: !Ref BalanceDeadLetterQueueName',
  ],
  [
    'Redis primary cache dimension',
    'Value: !Sub ${RedisCacheClusterIdPrefix}-001',
    'Value: !Sub ${RedisCacheClusterIdPrefix}-003',
  ],
  [
    'Redis access-denial metric',
    'MetricName: AuthenticationFailures',
    'MetricName: NewConnections',
  ],
  [
    'Redis access-denial aggregation',
    'primaryauth + replicaauth + primarycommand + replicacommand + primarykey + replicakey + primarychannel + replicachannel',
    'primaryauth + replicaauth',
  ],
  ['ECS input', '${ApiServiceName}', '${WorkerServiceName}'],
  ['dashboard log input', "SOURCE '${ApiLogGroupName}'", "SOURCE '${WorkerLogGroupName}'"],
  ['dashboard event allowlist', "'job.awaiting_dead_letter'", "'job.processed'"],
  [
    'dashboard sensitive field',
    'fields @timestamp, correlationId',
    'fields @timestamp, @message, correlationId',
  ],
  [
    'artifact digest output',
    'Value: !Ref DeliveryArtifactSha256',
    'Value: !Ref DeliveryArtifactBindingSha256',
  ],
  [
    'enabled-by-default Redis operator',
    'RedisOperatorMode:\n    Type: String\n    Default: DISABLED',
    'RedisOperatorMode:\n    Type: String\n    Default: ENABLED',
  ],
  [
    'operator overlap phase',
    '- !Equals [!Ref RedisCredentialPhase, B_ONLY]',
    '- !Equals [!Ref RedisCredentialPhase, BOTH_USE_B]',
  ],
  [
    'unpinned enabled operator credential',
    '- !Not [!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]]',
    '- !Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]',
  ],
  [
    'operator task condition',
    'RedisSessionRevocationTaskDefinition:\n    Type: AWS::ECS::TaskDefinition\n    Condition: RedisOperatorEnabled',
    'RedisSessionRevocationTaskDefinition:\n    Type: AWS::ECS::TaskDefinition',
  ],
  [
    'operator task command',
    'Command: [node, dist/infrastructure/redis/redis-session-revocation.cli.js]',
    'Command: [node, dist/main.js, CLIENT, KILL]',
  ],
  [
    'operator task Base scope',
    'Name: PRODUCT_NETWORK_SCOPE, Value: ethereum-solana-mainnet',
    'Name: PRODUCT_NETWORK_SCOPE, Value: ethereum-solana-base-mainnet',
  ],
  [
    'operator task hard-coded target phase',
    'Name: REDIS_CREDENTIAL_PHASE, Value: !Ref RedisCredentialPhase',
    'Name: REDIS_CREDENTIAL_PHASE, Value: B_ONLY',
  ],
  [
    'operator task application credential',
    "ValueFrom: !Sub '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}'",
    "ValueFrom: !Sub '${RedisOperatorTaskExecutionRoleArn}:password::${RedisOperatorSecretVersionId}'",
  ],
  ['operator task TLS', "Name: REDIS_TLS, Value: 'true'", "Name: REDIS_TLS, Value: 'false'"],
  ['operator task filesystem', 'ReadonlyRootFilesystem: true', 'ReadonlyRootFilesystem: false'],
  ['operator task user', "User: '10001:10001'", "User: '0:0'"],
  ['operator task capabilities', 'Capabilities: { Drop: [ALL] }', 'Capabilities: { Add: [ALL] }'],
  ['operator task image', 'Image: !Ref ApiImageUri', 'Image: crypto-lending-api:latest'],
  [
    'operator task execution role',
    'ExecutionRoleArn: !Ref RedisOperatorTaskExecutionRoleArn',
    'ExecutionRoleArn: !Ref RedisOperatorSecretArn',
  ],
  [
    'operator task role authority',
    'RuntimePlatform: { CpuArchitecture: X86_64, OperatingSystemFamily: LINUX }',
    'RuntimePlatform: { CpuArchitecture: X86_64, OperatingSystemFamily: LINUX }\n      TaskRoleArn: !Ref RedisOperatorTaskExecutionRoleArn',
  ],
]) {
  test(`rejects ${name} mutation`, () => {
    const mutated = source.replace(search, replacement);
    assert.notEqual(mutated, source);
    const report = validateApplicationObservabilitySource(mutated);
    assert.equal(report.ok, false);
    assert.equal(report.awsCallsMade, 0);
  });
}

test('rejects a service or desired count added to the one-off Redis task', () => {
  const mutated = source.replace(
    'Outputs:\n',
    '  RedisRevocationService:\n    Type: AWS::ECS::Service\n    Properties:\n      DesiredCount: 1\nOutputs:\n',
  );
  assert.notEqual(mutated, source);
  const report = validateApplicationObservabilitySource(mutated);
  assert.equal(report.ok, false);
  assert.equal(report.awsCallsMade, 0);
  assert.match(report.errors.join('\n'), /no-service task/);
});
