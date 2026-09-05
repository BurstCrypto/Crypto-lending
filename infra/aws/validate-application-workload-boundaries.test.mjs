import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { validateApplicationWorkloadBoundariesSource } from './validate-application-workload-boundaries.mjs';

const templatePath = join(import.meta.dirname, 'application-workload-boundaries.yaml');
const validatorPath = join(import.meta.dirname, 'validate-application-workload-boundaries.mjs');
const templateSource = readFileSync(templatePath, 'utf8').replace(/\r\n/gu, '\n');

function mutate(search, replacement) {
  const result = templateSource.replace(search, replacement);
  assert.notEqual(result, templateSource, 'Test mutation must change the child template.');
  return result;
}

function assertRejected(source, messagePattern) {
  const report = validateApplicationWorkloadBoundariesSource(source);
  assert.equal(report.ok, false);
  assert.equal(report.awsCallsMade, 0);
  assert(
    report.errors.some((error) => messagePattern.test(error)),
    `Expected ${messagePattern}; received:\n${report.errors.join('\n')}`,
  );
}

test('accepts the reviewed local workload-boundary child under the direct body cap', () => {
  const report = validateApplicationWorkloadBoundariesSource(templateSource);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.deepEqual(report.errors, []);
  assert.equal(report.awsCallsMade, 0);
  assert.equal(report.deploymentStatus, 'STANDALONE_REQUIRES_VALIDATED_PARENT_COMPOSITION');
  assert(report.templateBytes < report.directUploadLimitBytes);
  assert.match(
    report.residualLimitations.join('\n'),
    /STANDALONE_REQUIRES_VALIDATED_PARENT_COMPOSITION/,
  );
  assert.match(report.residualLimitations.join('\n'), /No DNS security-group rule/);
  assert.match(report.residualLimitations.join('\n'), /PostgreSQL LOGIN principals/);
  assert.match(report.residualLimitations.join('\n'), /CLIENT KILL/);
  assert.match(report.residualLimitations.join('\n'), /LIVE_REVOCATION_UNRESOLVED/);
  assert.match(
    report.residualLimitations.join('\n'),
    /FIXED_SLOT_CREDENTIAL_DEPLOYMENT_GUARD_UNRESOLVED/,
  );
  assert.match(report.residualLimitations.join('\n'), /AUTH_WALLET_SECRET_EXTERNAL/);
  assert.match(report.residualLimitations.join('\n'), /not packaged or uploaded/);
});

test('grants the one external auth/wallet secret and KMS key only to API execution', () => {
  assertRejected(
    mutate(
      '  AuthWalletKeysSecretArn:\n    Type: String\n    NoEcho: true',
      '  AuthWalletKeysSecretArn:\n    Type: String\n    NoEcho: true\n    Default: arn:aws:secretsmanager:us-west-2:111122223333:secret:prohibited',
    ),
    /AuthWalletKeysSecretArn must be one explicit selector-free Secrets Manager ARN/,
  );
  assertRejected(
    mutate('                  - !Ref AuthWalletKeysSecretArn\n', ''),
    /ApiTaskExecutionRole must retain the exact API log and runtime-secret matrix/,
  );
  assertRejected(
    mutate(
      '                  - !Ref WorkerDatabaseCredentialBSecret\n',
      '                  - !Ref WorkerDatabaseCredentialBSecret\n                  - !Ref AuthWalletKeysSecretArn\n',
    ),
    /WorkerTaskExecutionRole must retain the exact worker log and runtime-secret matrix|must not read Redis or authentication\/wallet credentials/,
  );
  assertRejected(
    mutate(
      'Resource: [!Ref ApplicationDataKeyArn, !Ref AuthWalletKeysKmsKeyArn]',
      'Resource: !Ref ApplicationDataKeyArn',
    ),
    /ApiTaskExecutionRole must retain the exact API log and runtime-secret matrix/,
  );
  assertRejected(
    mutate(
      '                Resource: !Ref RedisOperatorSecret',
      '                Resource: [!Ref RedisOperatorSecret, !Ref AuthWalletKeysSecretArn]',
    ),
    /Redis operator execution must not read application or migration credentials|conditional and read only its scoped operator secret/,
  );
});

test('rejects deployment without the exact explicit billing gate', () => {
  assertRejected(
    mutate('Default: NOT_AUTHORIZED', 'Default: I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES'),
    /BillingAcknowledgement.*explicit consent/,
  );
  assertRejected(
    mutate(
      '          - I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES',
      '          - NOT_AUTHORIZED',
    ),
    /explicit billing acknowledgement/,
  );
});

test('rejects an uppercase-capable database-name contract', () => {
  assertRejected(
    mutate(
      "AllowedPattern: '^[a-z][a-z0-9_]{0,62}$'",
      "AllowedPattern: '^[A-Za-z][A-Za-z0-9_]{0,62}$'",
    ),
    /DatabaseName must be a canonical lowercase PostgreSQL identifier/,
  );
});

test('rejects defaulted or unbound delivery provenance', () => {
  assertRejected(
    mutate(
      "  DeliveryArtifactSha256:\n    Type: String\n    AllowedPattern: '^[a-f0-9]{64}$'",
      "  DeliveryArtifactSha256:\n    Type: String\n    Default: ${'0'.repeat(64)}\n    AllowedPattern: '^[a-f0-9]{64}$'",
    ),
    /DeliveryArtifactSha256.*explicit lowercase SHA-256/,
  );
  assertRejected(
    mutate(
      '  DeliveryArtifactBindingSha256:\n    Value: !Ref DeliveryArtifactBindingSha256',
      '  DeliveryArtifactBindingSha256:\n    Value: !Ref DeliveryArtifactSha256',
    ),
    /DeliveryArtifactBindingSha256.*reviewed identifier/,
  );
});

test('rejects an operator without the private artifact-delivery gate', () => {
  assertRejected(
    mutate(
      '          - !Equals [!Ref PrivateEgressMode, VpcEndpoints]\n        AssertDescription: Redis operator mode requires',
      '          - !Equals [!Ref PrivateEgressMode, None]\n        AssertDescription: Redis operator mode requires',
    ),
    /Deployment rules.*billing acknowledgement/,
  );
  assertRejected(
    mutate(
      '  RedisOperatorToInterfaceEndpointEgress:\n    Type: AWS::EC2::SecurityGroupEgress\n    Condition: RedisOperatorVpcEndpointRulesEnabled',
      '  RedisOperatorToInterfaceEndpointEgress:\n    Type: AWS::EC2::SecurityGroupEgress\n    Condition: CreateVpcEndpointRules',
    ),
    /RedisOperatorToInterfaceEndpointEgress.*exact/,
  );
  assertRejected(
    mutate(
      '  RedisOperatorToS3Egress:\n    Type: AWS::EC2::SecurityGroupEgress\n    Condition: RedisOperatorVpcEndpointRulesEnabled',
      '  RedisOperatorToS3Egress:\n    Type: AWS::EC2::SecurityGroupEgress',
    ),
    /RedisOperatorToS3Egress.*exact/,
  );
  assertRejected(
    mutate(
      '  RedisOperatorToInterfaceEndpointEgress:\n    Type: AWS::EC2::SecurityGroupEgress\n    Condition: RedisOperatorVpcEndpointRulesEnabled\n    Metadata: { cfn-lint: { config: { ignore_checks: [W1030] } } }\n    Properties:\n      DestinationSecurityGroupId: !Ref InterfaceEndpointSecurityGroupId\n      FromPort: 443\n      GroupId: !Ref RedisOperatorTaskSecurityGroup',
      '  RedisOperatorToInterfaceEndpointEgress:\n    Type: AWS::EC2::SecurityGroupEgress\n    Condition: RedisOperatorVpcEndpointRulesEnabled\n    Metadata: { cfn-lint: { config: { ignore_checks: [W1030] } } }\n    Properties:\n      DestinationSecurityGroupId: !Ref InterfaceEndpointSecurityGroupId\n      FromPort: 443\n      GroupId: !Ref ApiTaskSecurityGroup',
    ),
    /RedisOperatorToInterfaceEndpointEgress.*exact/,
  );
  assertRejected(
    mutate(
      '          - !Equals [!Ref RedisCredentialPhase, B_ONLY]\n        AssertDescription: Redis operator mode requires one inactive application credential slot.',
      '          - !Equals [!Ref RedisCredentialPhase, BOTH_USE_B]\n        AssertDescription: Redis operator mode requires one inactive application credential slot.',
    ),
    /Deployment rules.*billing acknowledgement/,
  );
});

test('CLI emits a zero-call machine-readable report and rejects network template paths', () => {
  const accepted = spawnSync(process.execPath, [validatorPath, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
    windowsHide: true,
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).awsCallsMade, 0);

  const rejected = spawnSync(
    process.execPath,
    [validatorPath, '--template', 'https://example.invalid/template.yaml'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /local filesystem path/);
});

test('rejects a child larger than the conservative direct-upload cap', () => {
  assertRejected(`${templateSource}\n#${'x'.repeat(51_200)}\n`, /at or below 51200 bytes/);
});

for (const [name, search, replacement] of [
  [
    'a missing rotation phase',
    'AllowedValues: [A_ONLY, BOTH_USE_A, BOTH_USE_B, B_ONLY]',
    'AllowedValues: [A_ONLY, BOTH_USE_A, B_ONLY]',
  ],
  [
    'an A enablement condition that can disable the selected slot',
    '  RedisApiAEnabled: !And\n    - !Condition CredentialVersionsPinned\n    - !Not [!Equals [!Ref RedisCredentialPhase, B_ONLY]]',
    '  RedisApiAEnabled: !And\n    - !Condition CredentialVersionsPinned\n    - !Not [!Equals [!Ref RedisCredentialPhase, BOTH_USE_A]]',
  ],
  [
    'an active-slot condition that selects B too early',
    '    - !Equals [!Ref RedisCredentialPhase, BOTH_USE_A]',
    '    - !Equals [!Ref RedisCredentialPhase, BOTH_USE_B]',
  ],
  [
    'an active secret output that disagrees with the active username',
    'Value: !If [UseRedisApiA, !Ref RedisApiASecret, !Ref RedisApiBSecret]',
    'Value: !If [UseRedisApiA, !Ref RedisApiBSecret, !Ref RedisApiASecret]',
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(
      mutate(search, replacement),
      /rotation|enabled-slot|active-slot|reviewed identifier/iu,
    );
  });
}

const fixedSlotVersionParameters = [
  'ApiDatabaseSlotAVersionId',
  'ApiDatabaseSlotBVersionId',
  'WorkerDatabaseSlotAVersionId',
  'WorkerDatabaseSlotBVersionId',
  'RedisApiSlotAVersionId',
  'RedisApiSlotBVersionId',
];

test('requires all six fixed-slot version parameters without a mutable default', () => {
  for (const parameter of fixedSlotVersionParameters) {
    const block = [
      `  ${parameter}:`,
      '    Type: String',
      "    AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'",
    ].join('\n');
    assertRejected(
      mutate(block, block.replace('    Type: String', '    Type: String\n    Default: UNPINNED')),
      new RegExp(`${parameter}.*must be explicit.*VersionId`),
    );
    assertRejected(
      mutate(block, block.replace('{32,64}', '+')),
      new RegExp(`${parameter}.*must be explicit.*VersionId`),
    );
  }
});

test('rejects mixed pins or an active direct-child UNPINNED state', () => {
  assertRejected(
    mutate(
      '!Equals [!Ref ApiDatabaseSlotBVersionId, UNPINNED],',
      '!Not [!Equals [!Ref ApiDatabaseSlotBVersionId, UNPINNED]],',
    ),
    /Deployment rules.*billing acknowledgement/,
  );
  assertRejected(
    mutate(
      '!Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY],',
      '!Equals [!Ref ApiDatabaseCredentialPhase, BOTH_USE_A],',
    ),
    /Deployment rules.*billing acknowledgement/,
  );
  assertRejected(
    mutate(
      '!Equals [!Ref RedisOperatorMode, DISABLED],',
      '!Equals [!Ref RedisOperatorMode, ENABLED],',
    ),
    /Deployment rules.*billing acknowledgement/,
  );
});

test('keeps every fixed-slot read permission closed during UNPINNED adoption', () => {
  for (const [, condition] of [
    ['API database A', 'ApiDatabaseAReadable'],
    ['API database B', 'ApiDatabaseBReadable'],
    ['worker database A', 'WorkerDatabaseAReadable'],
    ['worker database B', 'WorkerDatabaseBReadable'],
    ['Redis API A', 'RedisApiAEnabled'],
    ['Redis API B', 'RedisApiBEnabled'],
  ]) {
    assertRejected(
      mutate(
        `  ${condition}: !And\n    - !Condition CredentialVersionsPinned`,
        `  ${condition}: !And\n    - !Not [!Equals [!Ref RedisCredentialPhase, NEVER]]`,
      ),
      /credential readable-slot\/active-slot mappings/,
    );
  }
});

test('renders no empty worker secret-resource statement during UNPINNED adoption', () => {
  const roleStart = templateSource.indexOf('  WorkerTaskExecutionRole:\n');
  const roleEnd = templateSource.indexOf('\n  RedisOperatorTaskExecutionRole:\n', roleStart);
  assert.notEqual(roleStart, -1);
  assert.notEqual(roleEnd, -1);
  const role = templateSource.slice(roleStart, roleEnd);
  const guard = '              - !If\n                - CredentialVersionsPinned\n';
  const guardStart = role.indexOf(guard);
  const nextStatement = '              - Sid: DecryptSecrets\n';
  const guardEnd = role.indexOf(nextStatement, guardStart);
  assert.notEqual(guardStart, -1);
  assert.notEqual(guardEnd, -1);

  const renderedUnpinned = `${role.slice(0, guardStart)}${role.slice(guardEnd)}`;
  assert.doesNotMatch(renderedUnpinned, /secretsmanager:GetSecretValue/);
  assert.doesNotMatch(renderedUnpinned, /WorkerDatabaseCredential[AB]Secret/);
  assert.match(renderedUnpinned, /Action: kms:Decrypt/);

  assertRejected(
    mutate(guard, guard.replace('CredentialVersionsPinned', 'CreateVpcEndpointRules')),
    /WorkerTaskExecutionRole must retain the exact worker log and runtime-secret matrix/,
  );
});

test('pins both Redis application passwords to their exact slot VersionIds', () => {
  for (const [slot, versionParameter] of [
    ['A', 'RedisApiSlotAVersionId'],
    ['B', 'RedisApiSlotBVersionId'],
  ]) {
    const exact = `\${RedisApi${slot}Secret}:SecretString:password::\${${versionParameter}}`;
    assertRejected(
      mutate(exact, `\${RedisApi${slot}Secret}:SecretString:password`),
      new RegExp(`RedisApi${slot}User.*exact ordered`),
    );
    assertRejected(
      mutate(exact, `\${RedisApi${slot}Secret}:SecretString:password:AWSCURRENT:`),
      new RegExp(`RedisApi${slot}User.*exact ordered`),
    );
  }
  assertRejected(
    mutate('password::${RedisApiSlotAVersionId}', 'password::${RedisApiSlotBVersionId}'),
    /RedisApiAUser.*exact ordered/,
  );
});

test('phase-selects matching active VersionIds without exposing raw slot outputs', () => {
  for (const [output, search, replacement] of [
    [
      'ApiDatabaseActiveVersionId',
      '!If [UseApiDatabaseA, !Ref ApiDatabaseSlotAVersionId, !Ref ApiDatabaseSlotBVersionId]',
      '!If [UseApiDatabaseA, !Ref ApiDatabaseSlotBVersionId, !Ref ApiDatabaseSlotAVersionId]',
    ],
    [
      'WorkerDatabaseActiveVersionId',
      '!If [UseWorkerDatabaseA, !Ref WorkerDatabaseSlotAVersionId, !Ref WorkerDatabaseSlotBVersionId]',
      '!If [UseWorkerDatabaseA, !Ref WorkerDatabaseSlotBVersionId, !Ref WorkerDatabaseSlotAVersionId]',
    ],
    [
      'RedisActiveVersionId',
      '!If [UseRedisApiA, !Ref RedisApiSlotAVersionId, !Ref RedisApiSlotBVersionId]',
      '!If [UseRedisApiA, !Ref RedisApiSlotBVersionId, !Ref RedisApiSlotAVersionId]',
    ],
  ]) {
    assertRejected(mutate(search, replacement), new RegExp(`${output}.*reviewed identifier`));
  }
  assertRejected(
    mutate(
      'Outputs:\n',
      'Outputs:\n  RedisApiSlotAVersionId:\n    Value: !Ref RedisApiSlotAVersionId\n',
    ),
    /Output allowlist contains unreviewed entry RedisApiSlotAVersionId/,
  );
});

for (const [name, search, replacement, expected] of [
  [
    'an API database active-secret output that disagrees with its active username',
    '      - !Ref ApiDatabaseCredentialASecret\n      - !Ref ApiDatabaseCredentialBSecret',
    '      - !Ref ApiDatabaseCredentialBSecret\n      - !Ref ApiDatabaseCredentialASecret',
    /ApiDatabaseActiveSecretArn.*reviewed identifier/,
  ],
  [
    'unconditional readability of the retired Redis A secret',
    [
      '                  - !If',
      '                    - RedisApiAEnabled',
      '                    - !Ref RedisApiASecret',
      '                    - !Ref AWS::NoValue',
    ].join('\n'),
    '                  - !Ref RedisApiASecret',
    /exact API log and runtime-secret matrix/,
  ],
  [
    'unconditional readability of the retired worker database A secret',
    [
      '                    - !If',
      '                      - WorkerDatabaseAReadable',
      '                      - !Ref WorkerDatabaseCredentialASecret',
      '                      - !Ref AWS::NoValue',
    ].join('\n'),
    '                    - !Ref WorkerDatabaseCredentialASecret',
    /exact worker log and runtime-secret matrix/,
  ],
  [
    'an externally mutable managed policy attachment',
    '      Policies:\n        - PolicyName: PullApiImage',
    "      ManagedPolicyArns: ['arn:aws:iam::000000000000:policy/unreviewed']\n      Policies:\n        - PolicyName: PullApiImage",
    /externally mutable managed policies|exact API/,
  ],
  [
    'a bare log-group ARN that cannot authorize log streams',
    "Resource: !Sub '${ApiLogGroupArn}:*'",
    'Resource: !Ref ApiLogGroupArn',
    /exact API log and runtime-secret matrix/,
  ],
  [
    'a wildcard-capable ECR repository parameter',
    "repository/crypto-lending-api$'",
    "repository/*$'",
    /concrete reviewed application ECR repository ARN/,
  ],
  [
    'an API execution-role repository remap',
    '                Resource: !Ref ApiImageRepositoryArn',
    '                Resource: !Ref ApplicationDataKeyArn',
    /exact API log and runtime-secret matrix/,
  ],
  [
    'boolean private-egress semantics',
    'AllowedValues: [VpcEndpoints, None]',
    "AllowedValues: ['true', 'false']",
    /PrivateEgressMode.*VpcEndpoints/,
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(mutate(search, replacement), expected);
  });
}

for (const [name, search, replacement, expected] of [
  [
    'an enabled-by-default Redis operator',
    '  RedisOperatorMode:\n    Type: String\n    Default: DISABLED',
    '  RedisOperatorMode:\n    Type: String\n    Default: ENABLED',
    /disabled-by-default break-glass gate/,
  ],
  [
    'an operator with broad client authority',
    '+client|kill',
    '+client',
    /RedisOperatorUser.*exact ordered/,
  ],
  [
    'an operator execution role that exists outside the explicit gate',
    '  RedisOperatorTaskExecutionRole:\n    Type: AWS::IAM::Role\n    Condition: RedisOperatorEnabled',
    '  RedisOperatorTaskExecutionRole:\n    Type: AWS::IAM::Role',
    /RedisOperatorTaskExecutionRole must be conditional/,
  ],
  [
    'operator access to an application secret',
    '                Resource: !Ref RedisOperatorSecret',
    '                Resource: !Ref RedisApiASecret',
    /must not read application or migration credentials|read only its scoped operator secret/,
  ],
  [
    'an operator credential output outside the explicit gate',
    '  RedisOperatorSecretArn:\n    Condition: RedisOperatorEnabled',
    '  RedisOperatorSecretArn:',
    /RedisOperatorSecretArn.*reviewed identifier/,
  ],
  [
    'a cross-environment static Redis username',
    'UserName: !Sub crypto_api_${EnvironmentName}_a',
    'UserName: crypto_api_a',
    /RedisApiAUser.*exact ordered/,
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(mutate(search, replacement), expected);
  });
}

test('does not expose raw A/B secret ARNs that a parent could inject around the phase machine', () => {
  assertRejected(
    mutate('Outputs:\n', 'Outputs:\n  RedisApiASecretArn:\n    Value: !Ref RedisApiASecret\n'),
    /Output allowlist contains unreviewed entry RedisApiASecretArn/,
  );
});

test('owns all workload roles with exact least-privilege policies in the child', () => {
  assertRejected(
    mutate('Resource: !Ref WebImageRepositoryArn', 'Resource: !Ref ApiImageRepositoryArn'),
    /WebTaskExecutionRole must retain the exact image-pull and log-only matrix/,
  );
  assertRejected(
    mutate(
      '  WebTaskRole:\n    Type: AWS::IAM::Role\n    Properties:\n      AssumeRolePolicyDocument:',
      '  WebTaskRole:\n    Type: AWS::IAM::Role\n    Properties:\n      Policies: [{ PolicyName: Unexpected, PolicyDocument: {} }]\n      AssumeRolePolicyDocument:',
    ),
    /WebTaskRole must remain permissionless/,
  );
  assertRejected(
    mutate(
      '                Action: sqs:GetQueueAttributes',
      '                Action: sqs:SendMessage',
    ),
    /ApiTaskRole must retain only the exact queue-readiness capability matrix/,
  );
  assertRejected(
    mutate(
      'Resource: [!Ref JobQueueArn, !Ref BalanceQueueArn]',
      'Resource: [!Ref JobDeadLetterQueueArn, !Ref BalanceDeadLetterQueueArn]',
    ),
    /WorkerTaskRole must retain only the exact queue-publish and SQS KMS matrix/,
  );
  assertRejected(
    mutate(
      '  WorkerTaskRoleArn:\n    Value: !GetAtt WorkerTaskRole.Arn',
      '  WorkerTaskRoleArn:\n    Value: !GetAtt ApiTaskRole.Arn',
    ),
    /WorkerTaskRoleArn.*reviewed identifier/,
  );
});

test('keeps extracted workload role trust scoped to ECS tasks in this account', () => {
  const start = templateSource.indexOf('  WebTaskRole:\n');
  const end = templateSource.indexOf('\n  ApiTaskRole:\n', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const role = templateSource.slice(start, end);

  for (const [search, replacement] of [
    ['Service: ecs-tasks.amazonaws.com', 'Service: lambda.amazonaws.com'],
    ['Action: sts:AssumeRole', 'Action: sts:*'],
    ['aws:SourceAccount: !Ref AWS::AccountId', "aws:SourceAccount: '*'"],
    [
      "aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'",
      "aws:SourceArn: '*'",
    ],
  ]) {
    const mutatedRole = role.replace(search, replacement);
    assert.notEqual(mutatedRole, role, `Trust mutation must change ${search}.`);
    assertRejected(
      templateSource.replace(role, mutatedRole),
      /WebTaskRole must remain permissionless with only the reviewed ECS trust policy/,
    );
  }
});

test('requires explicit application log-group ARN inputs for extracted execution roles', () => {
  for (const parameter of ['ApiLogGroupArn', 'WebLogGroupArn', 'WorkerLogGroupArn']) {
    const block = [
      `  ${parameter}:`,
      '    Type: String',
      "    AllowedPattern: '^arn:[a-z0-9-]+:logs:[a-z0-9-]+:[0-9]{12}:log-group:[A-Za-z0-9_./#-]+$'",
    ].join('\n');
    assertRejected(
      mutate(block, block.replace('log-group:[A-Za-z0-9_./#-]+$', 'log-group:.*$')),
      new RegExp(`${parameter} must be one explicit application log-group ARN`),
    );
  }
});

for (const [name, search, replacement, expected] of [
  [
    'removal of Redis ACL payload sanitization',
    'on sanitize-payload resetkeys resetchannels -@all +ping +quit',
    'on resetkeys resetchannels -@all +ping +quit',
    /exact ordered/iu,
  ],
  [
    'a Redis data-command grant',
    '-@all +ping +quit',
    '-@all +get +ping +quit',
    /data, script, pubsub, transaction, or admin commands|exact ordered/iu,
  ],
  [
    'a Redis command category',
    '-@all +ping +quit',
    '-@all +@read +ping +quit',
    /command categories|exact ordered/iu,
  ],
  [
    'semantic ACL token reordering',
    'on sanitize-payload resetkeys resetchannels -@all +ping +quit',
    'on sanitize-payload resetchannels resetkeys -@all +ping +quit',
    /exact ordered/iu,
  ],
  [
    'an enabled default Redis user',
    "AccessString: 'off sanitize-payload resetkeys resetchannels -@all'",
    "AccessString: 'on sanitize-payload resetkeys resetchannels -@all'",
    /RedisDefaultUser.*exact ordered/iu,
  ],
  [
    'an unscoped default Redis user id',
    'UserId: !Sub cl-${EnvironmentName}-rd',
    'UserId: cl-default',
    /RedisDefaultUser.*exact ordered/iu,
  ],
  [
    'a global Redis key grant',
    "'on sanitize-payload resetkeys resetchannels -@all +ping +quit'",
    "'on sanitize-payload resetkeys ~* resetchannels -@all +ping +quit'",
    /command categories, keys, or channels|exact ordered/iu,
  ],
  [
    'cross-slot Redis password binding',
    '${RedisApiASecret}:SecretString:password',
    '${RedisApiBSecret}:SecretString:password',
    /RedisApiAUser.*exact ordered/iu,
  ],
  [
    'an invalid underscore in an ElastiCache user id',
    'UserId: !Sub cl-${EnvironmentName}-ra',
    'UserId: !Sub cl_${EnvironmentName}_ra',
    /RedisApiAUser.*exact ordered/iu,
  ],
  [
    'a user group without the disabled default user',
    '      UserIds:\n        - !Ref RedisDefaultUser\n        - !Ref RedisApiAUser',
    '      UserIds:\n        - !Ref RedisApiAUser',
    /RedisApiUserGroup.*exact ordered/iu,
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(mutate(search, replacement), expected);
  });
}

test('rejects an unreviewed second production Redis operator identity', () => {
  assertRejected(
    mutate(
      'Resources:\n',
      [
        'Resources:',
        '  RedisAdminUser:',
        '    Type: AWS::ElastiCache::User',
        '    Properties:',
        "      AccessString: 'on +@all ~*'",
        '      Engine: redis',
        '      UserId: local-operator',
        '      UserName: local_acl_operator',
        '',
      ].join('\n'),
    ),
    /unreviewed entry RedisAdminUser/,
  );
});

for (const [name, search, replacement, expected] of [
  [
    'API database username drift',
    'crypto_api_login_a',
    'crypto_api_runtime',
    /ApiDatabaseCredentialASecret.*crypto_api_login_a/,
  ],
  [
    'worker database username drift',
    'crypto_worker_login_b',
    'crypto_api_login_b',
    /WorkerDatabaseCredentialBSecret.*crypto_worker_login_b/,
  ],
  [
    'migration credential aliasing to an API login',
    'crypto_migration',
    'crypto_api_login_a',
    /MigrationDatabaseCredentialSecret.*crypto_migration/,
  ],
  [
    'a plaintext migration secret',
    '      GenerateSecretString:\n        ExcludeCharacters:',
    '      SecretString: \'{"username":"crypto_migration","password":"plaintext"}\'\n      GenerateSecretString:\n        ExcludeCharacters:',
    /plaintext SecretString|MigrationDatabaseCredentialSecret/,
  ],
  [
    'a secret not encrypted with the application data key',
    'KmsKeyId: !Ref ApplicationDataKeyArn',
    'KmsKeyId: alias/aws/secretsmanager',
    /distinct retained KMS-backed/,
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(mutate(search, replacement), expected);
  });
}

for (const [name, search, replacement, expected] of [
  [
    'API execution access to a worker database credential',
    '                  - !Ref RedisApiASecret',
    '                  - !Ref WorkerDatabaseCredentialASecret\n                  - !Ref RedisApiASecret',
    /exact API log and runtime-secret matrix/,
  ],
  [
    'worker execution access to Redis credentials',
    '                  - !Ref WorkerDatabaseCredentialBSecret',
    '                  - !Ref WorkerDatabaseCredentialBSecret\n                  - !Ref RedisApiASecret',
    /exact worker log and runtime-secret matrix|must not read Redis/,
  ],
  [
    'long-lived execution access to the migration credential',
    '                  - !Ref RedisApiBSecret',
    '                  - !Ref RedisApiBSecret\n                  - !Ref MigrationDatabaseCredentialSecret',
    /must not read migration\/admin credentials/,
  ],
  [
    'a wildcard execution-role secret resource',
    [
      '        - PolicyName: PullWorkerImage',
      '          PolicyDocument:',
      "            Version: '2012-10-17'",
    ].join('\n'),
    [
      '        - PolicyName: PullWorkerImage',
      '          PolicyDocument:',
      "            Version: '2012-10-17'",
      "            Resource: '*'",
    ].join('\n'),
    /outside ECR authorization|exact worker/,
  ],
  [
    'cross-workload log write access',
    "Resource: !Sub '${WorkerLogGroupArn}:*'",
    "Resource: !Sub '${ApiLogGroupArn}:*'",
    /exact worker log and runtime-secret matrix/,
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(mutate(search, replacement), expected);
  });
}

for (const [name, search, replacement, expected] of [
  [
    'a worker Redis network path',
    'DestinationSecurityGroupId: !Ref DatabaseSecurityGroupId\n      FromPort: 5432\n      GroupId: !Ref WorkerTaskSecurityGroup',
    'DestinationSecurityGroupId: !Ref RedisSecurityGroupId\n      FromPort: 6379\n      GroupId: !Ref WorkerTaskSecurityGroup',
    /WorkerTaskToDatabaseEgress.*exact|Worker network resources must not reference Redis/,
  ],
  [
    'an internet-wide workload egress rule',
    'SecurityGroupEgress: [{ CidrIp: 127.0.0.1/32, IpProtocol:',
    'SecurityGroupEgress: [{ CidrIp: 0.0.0.0/0, IpProtocol:',
    /internet-wide|exact reviewed source/,
  ],
  [
    'an endpoint rule without its mode condition',
    '  ApiTaskToInterfaceEndpointEgress:\n    Type: AWS::EC2::SecurityGroupEgress\n    Condition: CreateVpcEndpointRules',
    '  ApiTaskToInterfaceEndpointEgress:\n    Type: AWS::EC2::SecurityGroupEgress',
    /ApiTaskToInterfaceEndpointEgress.*exact/,
  ],
  [
    'an API/worker security-group output swap',
    '  WorkerTaskSecurityGroupId:\n    Value: !Ref WorkerTaskSecurityGroup',
    '  WorkerTaskSecurityGroupId:\n    Value: !Ref ApiTaskSecurityGroup',
    /WorkerTaskSecurityGroupId.*reviewed identifier/,
  ],
]) {
  test(`rejects ${name}`, () => {
    assertRejected(mutate(search, replacement), expected);
  });
}

test('rejects output of a secret value instead of its ARN', () => {
  assertRejected(
    mutate(
      '  MigrationDatabaseCredentialSecretArn:\n    Value: !Ref MigrationDatabaseCredentialSecret',
      "  MigrationDatabaseCredentialSecretArn:\n    Value: !Sub '{{resolve:secretsmanager:${MigrationDatabaseCredentialSecret}:SecretString:password}}'",
    ),
    /Outputs must expose only secret ARNs|MigrationDatabaseCredentialSecretArn.*reviewed/,
  );
});
