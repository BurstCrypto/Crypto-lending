import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateBalanceConsumerDeploymentEnvelopeSource } from './validate-balance-consumer-deployment-envelope.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const templateSource = readFileSync(
  join(scriptDirectory, 'balance-consumer-deployment-envelope.yaml'),
  'utf8',
);

function mutate(search, replacement) {
  assert.equal(
    templateSource.split(search).length - 1,
    1,
    `Mutation fixture must identify one reviewed token: ${search}`,
  );
  return templateSource.replace(search, replacement);
}

function assertRejected(source, expectedError) {
  const result = validateBalanceConsumerDeploymentEnvelopeSource(source);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), expectedError);
}

test('accepts and cryptographically binds the reviewed dormant envelope', () => {
  const result = validateBalanceConsumerDeploymentEnvelopeSource(templateSource);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.templateSha256, result.reviewedTemplateSha256);
  assert.ok(result.templateBytes < 51_200);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.errors), true);
  assert.equal(Object.isFrozen(result.residualLimitations), true);
});

test('reports that the envelope is uncomposed, hard-zero, non-production, queue-unbound, and unactivated', () => {
  const result = validateBalanceConsumerDeploymentEnvelopeSource(templateSource);
  assert.deepEqual(
    result.residualLimitations.map((entry) => entry.split(':', 1)[0]),
    [
      'UNCOMPOSED_SOURCE_ONLY',
      'HARD_ZERO_AND_NO_EGRESS',
      'NON_PRODUCTION_ONLY',
      'SOURCE_QUEUE_REDRIVE_UNBOUND',
      'ACTIVATION_GATES_UNRESOLVED',
    ],
  );
});

for (const [name, search, replacement, expected] of [
  [
    'production environment admission',
    "AllowedPattern: '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
    "AllowedPattern: '^(dev|test|qa|sandbox|staging|prod)(-[a-z0-9]+)*$'",
    /EnvironmentName.*AllowedPattern/,
  ],
  [
    'implicit billing authorization',
    'Default: NOT_AUTHORIZED',
    'Default: I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES',
    /BillingAcknowledgement.*Default/,
  ],
  [
    'billable acknowledgement bypass',
    '- !Ref BillingAcknowledgement',
    '- NOT_AUTHORIZED',
    /billable-resource acknowledgement/,
  ],
  [
    'mutable image tag input',
    "AllowedPattern: '^[a-f0-9]{64}$'",
    "AllowedPattern: '^[A-Za-z0-9._:-]+$'",
    /ApiImageDigest.*AllowedPattern/,
  ],
  [
    'cross-account image URI',
    'Image: !Sub ${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/crypto-lending-api@sha256:${ApiImageDigest}',
    'Image: !Ref ExternalImageUri',
    /BalanceConsumerTaskDefinition.*Image/,
  ],
  [
    'cross-account data key ARN',
    'Resource: !Sub arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/${ApplicationDataKeyId}',
    'Resource: !Ref ExternalDataKeyArn',
    /exact source queue and SQS-only data-key use/,
  ],
  [
    'cross-account logs key ARN',
    'KmsKeyId: !Sub arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/${ApplicationLogsKeyId}',
    'KmsKeyId: !Ref ExternalLogsKeyArn',
    /BalanceConsumerLogGroup.*KmsKeyId/,
  ],
  [
    'aliased data and log encryption keys',
    '- Assert: !Not [!Equals [!Ref ApplicationDataKeyId, !Ref ApplicationLogsKeyId]]',
    '- Assert: !Equals [!Ref ApplicationDataKeyId, !Ref ApplicationDataKeyId]',
    /application data and log encryption keys distinct/,
  ],
  [
    'public security-group egress',
    "SecurityGroupEgress: [{ CidrIp: 127.0.0.1/32, IpProtocol: '-1' }]",
    "SecurityGroupEgress: [{ CidrIp: 0.0.0.0/0, IpProtocol: '-1' }]",
    /external or broad network rule|SecurityGroupEgress/,
  ],
  [
    'standalone endpoint egress path',
    '  BalanceConsumerTaskExecutionRole:',
    [
      '  BalanceConsumerToEndpointEgress:',
      '    Type: AWS::EC2::SecurityGroupEgress',
      '    Properties: {}',
      '',
      '  BalanceConsumerTaskExecutionRole:',
    ].join('\n'),
    /unreviewed entry BalanceConsumerToEndpointEgress|external or broad network rule/,
  ],
  [
    'SQS send authority',
    '- sqs:ReceiveMessage',
    '- sqs:SendMessage',
    /sqs:ReceiveMessage|only exact source/,
  ],
  [
    'SQS queue-inspection authority',
    '- sqs:DeleteMessage',
    '- sqs:GetQueueAttributes',
    /sqs:DeleteMessage|only exact source/,
  ],
  [
    'balance DLQ receive authority',
    'Resource: !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-balance-sync',
    'Resource: !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-balance-sync-dlq',
    /exact source queue|only exact source/,
  ],
  [
    'jobs queue receive authority',
    'Resource: !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-balance-sync',
    'Resource: !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-jobs',
    /exact source queue|only exact source/,
  ],
  [
    'wildcard task-role action',
    '- sqs:ChangeMessageVisibility',
    '- sqs:*',
    /sqs:ChangeMessageVisibility|only exact source/,
  ],
  [
    'unreviewed task-role queue action',
    '- sqs:ChangeMessageVisibility',
    '- sqs:PurgeQueue',
    /sqs:ChangeMessageVisibility|only exact source/,
  ],
  [
    'wildcard task-role resource',
    'Resource: !Sub arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/${ApplicationDataKeyId}',
    "Resource: '*'",
    /source queue and SQS-only data-key use|only exact source/,
  ],
  [
    'non-SQS KMS delegation',
    'kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}',
    'kms:ViaService: !Sub secretsmanager.${AWS::Region}.${AWS::URLSuffix}',
    /source queue and SQS-only data-key use/,
  ],
  [
    'execution-role secret read',
    'Action: [logs:CreateLogStream, logs:PutLogEvents]',
    'Action: [logs:CreateLogStream, logs:PutLogEvents, secretsmanager:GetSecretValue]',
    /image-pull\/log-only/,
  ],
  [
    'execution-role queue permission',
    'Action: ecr:GetAuthorizationToken',
    'Action: [ecr:GetAuthorizationToken, sqs:ReceiveMessage]',
    /ecr:GetAuthorizationToken|image-pull\/log-only/,
  ],
  [
    'shared task and execution identity',
    'TaskRoleArn: !GetAtt BalanceConsumerTaskRole.Arn',
    'TaskRoleArn: !GetAtt BalanceConsumerTaskExecutionRole.Arn',
    /BalanceConsumerTaskDefinition.*TaskRoleArn/,
  ],
  [
    'wrong executable',
    'dist/blockchain-sync/application/balance-sync-consumer.cli.js',
    'dist/main.js',
    /exact CLI and hardened Fargate contract/,
  ],
  [
    'enabled consumer mode',
    '{ Name: BALANCE_CONSUMER_MODE, Value: disabled }',
    '{ Name: BALANCE_CONSUMER_MODE, Value: enabled }',
    /reviewed binding.*BALANCE_CONSUMER_MODE/,
  ],
  [
    'unreviewed consumer network',
    'Value: ethereum-solana-mainnet }',
    'Value: ethereum-mainnet }',
    /reviewed binding.*BALANCE_CONSUMER_NETWORK/,
  ],
  [
    'unreviewed source approval',
    'Value: ethereum-solana-mainnet-reviewed }',
    'Value: UNREVIEWED }',
    /reviewed binding.*BALANCE_CONSUMER_SOURCE_APPROVAL/,
  ],
  [
    'caller-controlled max receive count',
    "{ Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
    '{ Name: SQS_MAX_RECEIVE_COUNT, Value: !Ref SqsMaxReceiveCount }',
    /reviewed binding.*SQS_MAX_RECEIVE_COUNT/,
  ],
  [
    'drifted retry base delay',
    "{ Name: SQS_RETRY_BASE_DELAY_SECONDS, Value: '5' }",
    "{ Name: SQS_RETRY_BASE_DELAY_SECONDS, Value: '1' }",
    /reviewed binding.*SQS_RETRY_BASE_DELAY_SECONDS/,
  ],
  [
    'drifted retry maximum delay',
    "{ Name: SQS_RETRY_MAX_DELAY_SECONDS, Value: '60' }",
    "{ Name: SQS_RETRY_MAX_DELAY_SECONDS, Value: '59' }",
    /reviewed binding.*SQS_RETRY_MAX_DELAY_SECONDS/,
  ],
  [
    'generic jobs queue injection',
    "            - { Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
    [
      '            - { Name: SQS_QUEUE_URL, Value: https://example.invalid/jobs }',
      "            - { Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
    ].join('\n'),
    /thirteen reviewed nonsecret settings|must not receive generic queues/,
  ],
  [
    'database injection',
    "            - { Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
    [
      '            - { Name: DATABASE_RUNTIME_HOST, Value: database.internal }',
      "            - { Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
    ].join('\n'),
    /thirteen reviewed nonsecret settings|must not receive generic queues/,
  ],
  [
    'RPC endpoint injection',
    "            - { Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
    [
      '            - { Name: ETHEREUM_RPC_URL, Value: https://example.invalid }',
      "            - { Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
    ].join('\n'),
    /thirteen reviewed nonsecret settings|must not receive generic queues/,
  ],
  [
    'wallet metadata key injection',
    '          LinuxParameters:',
    [
      '          Secrets:',
      '            - { Name: WALLET_METADATA_SEAL_KEY_RING_JSON, ValueFrom: secret }',
      '          LinuxParameters:',
    ].join('\n'),
    /must not receive generic queues|Secrets/,
  ],
  ['root execution', "User: '10001:10001'", "User: '0:0'", /BalanceConsumerTaskDefinition.*User/],
  [
    'writable root filesystem',
    'ReadonlyRootFilesystem: true',
    'ReadonlyRootFilesystem: false',
    /BalanceConsumerTaskDefinition.*ReadonlyRootFilesystem/,
  ],
  [
    'retained Linux capability',
    'Capabilities: { Drop: [ALL] }',
    'Capabilities: { Add: [NET_ADMIN], Drop: [] }',
    /exact CLI and hardened Fargate contract/,
  ],
  ['nonzero desired count', 'DesiredCount: 0', 'DesiredCount: 1', /hard-zero|DesiredCount/],
  [
    'caller-controlled desired count',
    'DesiredCount: 0',
    'DesiredCount: !Ref DesiredCount',
    /hard-zero|DesiredCount/,
  ],
  [
    'execute-command access',
    'EnableExecuteCommand: false',
    'EnableExecuteCommand: true',
    /BalanceConsumerService.*EnableExecuteCommand/,
  ],
  [
    'public task IP',
    'AssignPublicIp: DISABLED',
    'AssignPublicIp: ENABLED',
    /public IP|AssignPublicIp/,
  ],
  [
    'floating Fargate platform',
    'PlatformVersion: 1.4.0',
    'PlatformVersion: LATEST',
    /BalanceConsumerService.*PlatformVersion/,
  ],
  [
    'an extra resource',
    'Resources:\n',
    'Resources:\n  ExtraQueue:\n    Type: AWS::SQS::Queue\n\n',
    /Resource allowlist contains unreviewed entry ExtraQueue/,
  ],
  [
    'a conditional activation path',
    'Resources:\n',
    "Conditions:\n  Activate: !Equals ['true', 'true']\n\nResources:\n",
    /must not use transforms, macros, or conditions/,
  ],
  [
    'a secret-bearing output',
    'Outputs:\n',
    'Outputs:\n  DatabasePassword:\n    Value: plaintext\n',
    /unreviewed entry DatabasePassword|never secret material/,
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(mutate(search, replacement), expected);
  });
}

test('rejects non-string and oversized sources without throwing', () => {
  assert.equal(validateBalanceConsumerDeploymentEnvelopeSource(null).ok, false);
  assertRejected(`${templateSource}${' '.repeat(51_201)}`, /direct-upload ceiling/);
});
