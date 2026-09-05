#!/usr/bin/env node

/**
 * Local-only validation for the application workload-boundary nested template.
 * This module uses filesystem and string operations only: it never loads an
 * AWS SDK, resolves credentials, invokes a provider CLI, or performs network I/O.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultTemplatePath = join(scriptDirectory, 'application-workload-boundaries.yaml');
const directUploadLimitBytes = 51_200;
const fixedSlotVersionParameterNames = Object.freeze([
  'ApiDatabaseSlotAVersionId',
  'ApiDatabaseSlotBVersionId',
  'WorkerDatabaseSlotAVersionId',
  'WorkerDatabaseSlotBVersionId',
  'RedisApiSlotAVersionId',
  'RedisApiSlotBVersionId',
]);

const residualLimitations = Object.freeze([
  'STANDALONE_REQUIRES_VALIDATED_PARENT_COMPOSITION: this child does not itself wire task definitions, services, or the Redis replication group. The repository parent must pass its independent composition validator and immutable delivery guard; deploying this child alone does not enforce workload boundaries.',
  'Generated database secrets and phase-scoped injection do not create, enable, disable, or install SCRAM verifiers for PostgreSQL LOGIN principals; those remain separately authorized privileged provisioning gates.',
  'PrivateEgressMode=None intentionally provides no ECR, logs, Secrets Manager, or SQS path; the parent must independently enforce zero API and worker desired counts.',
  'No DNS security-group rule is present because AmazonProvidedDNS traffic is not filterable by security groups; a custom resolver requires a separately reviewed exact destination.',
  'REDIS_OPERATOR_LIVE_REVOCATION_UNRESOLVED: the validated parent composes a conditional one-off task and production CLI that derive only the inactive environment slot and issue CLIENT KILL USER <target> SKIPME YES, but no task is authorized or run. Workload drain, live session denial evidence, immediate operator disablement, and credential installation or regeneration remain external gates.',
  'FIXED_SLOT_CREDENTIAL_DEPLOYMENT_GUARD_UNRESOLVED: all six fixed slots now require exact VersionId pins before activation and the unpinned creation state is inert, but the deployment command does not yet bind a reviewed transition record to deployed state. Inactive-slot regeneration, backend installation, transition adjacency, current-state comparison, and live evidence remain separately authorized gates.',
  'AUTH_WALLET_SECRET_EXTERNAL: the parent supplies one Secrets Manager ARN for seven distinct authentication and wallet key fields. This static boundary neither provisions that secret nor proves its field set, key material, rotation, resource policy, KMS policy, or deployed readability.',
  'This local template is not packaged or uploaded; a parent nested-stack TemplateURL remains a separately authorized deployment gate.',
]);

const parameterTypes = new Map([
  ['BillingAcknowledgement', 'String'],
  ['DeliveryArtifactSha256', 'String'],
  ['DeliveryArtifactBindingSha256', 'String'],
  ['EnvironmentName', 'String'],
  ['DatabaseName', 'String'],
  ['VpcId', 'AWS::EC2::VPC::Id'],
  ['LoadBalancerSecurityGroupId', 'AWS::EC2::SecurityGroup::Id'],
  ['DatabaseSecurityGroupId', 'AWS::EC2::SecurityGroup::Id'],
  ['RedisSecurityGroupId', 'AWS::EC2::SecurityGroup::Id'],
  ['PrivateEgressMode', 'String'],
  ['InterfaceEndpointSecurityGroupId', 'String'],
  ['S3ManagedPrefixListId', 'String'],
  ['ApplicationDataKeyArn', 'String'],
  ['AuthWalletKeysSecretArn', 'String'],
  ['AuthWalletKeysKmsKeyArn', 'String'],
  ['ApiLogGroupArn', 'String'],
  ['WebLogGroupArn', 'String'],
  ['WorkerLogGroupArn', 'String'],
  ['ApiImageRepositoryArn', 'String'],
  ['WebImageRepositoryArn', 'String'],
  ['JobQueueArn', 'String'],
  ['JobDeadLetterQueueArn', 'String'],
  ['BalanceQueueArn', 'String'],
  ['BalanceDeadLetterQueueArn', 'String'],
  ['ApiDatabaseCredentialPhase', 'String'],
  ['WorkerDatabaseCredentialPhase', 'String'],
  ['RedisCredentialPhase', 'String'],
  ['ApiDatabaseSlotAVersionId', 'String'],
  ['ApiDatabaseSlotBVersionId', 'String'],
  ['WorkerDatabaseSlotAVersionId', 'String'],
  ['WorkerDatabaseSlotBVersionId', 'String'],
  ['RedisApiSlotAVersionId', 'String'],
  ['RedisApiSlotBVersionId', 'String'],
  ['RedisOperatorMode', 'String'],
]);

const resourceTypes = new Map([
  ['ApiTaskSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['WorkerTaskSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['LoadBalancerToApiEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['LoadBalancerToApiIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['ApiTaskToDatabaseEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['ApiTaskToDatabaseIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['WorkerTaskToDatabaseEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['WorkerTaskToDatabaseIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['ApiTaskToRedisEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['ApiTaskToRedisIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['RedisOperatorTaskSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['RedisOperatorToRedisEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['RedisOperatorToRedisIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['RedisOperatorToInterfaceEndpointEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['RedisOperatorToInterfaceEndpointIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['RedisOperatorToS3Egress', 'AWS::EC2::SecurityGroupEgress'],
  ['ApiTaskToInterfaceEndpointEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['ApiTaskToInterfaceEndpointIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['WorkerTaskToInterfaceEndpointEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['WorkerTaskToInterfaceEndpointIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['ApiTaskToS3Egress', 'AWS::EC2::SecurityGroupEgress'],
  ['WorkerTaskToS3Egress', 'AWS::EC2::SecurityGroupEgress'],
  ['ApiDatabaseCredentialASecret', 'AWS::SecretsManager::Secret'],
  ['ApiDatabaseCredentialBSecret', 'AWS::SecretsManager::Secret'],
  ['WorkerDatabaseCredentialASecret', 'AWS::SecretsManager::Secret'],
  ['WorkerDatabaseCredentialBSecret', 'AWS::SecretsManager::Secret'],
  ['MigrationDatabaseCredentialSecret', 'AWS::SecretsManager::Secret'],
  ['RedisApiASecret', 'AWS::SecretsManager::Secret'],
  ['RedisApiBSecret', 'AWS::SecretsManager::Secret'],
  ['RedisOperatorSecret', 'AWS::SecretsManager::Secret'],
  ['RedisDefaultUser', 'AWS::ElastiCache::User'],
  ['RedisApiAUser', 'AWS::ElastiCache::User'],
  ['RedisApiBUser', 'AWS::ElastiCache::User'],
  ['RedisOperatorUser', 'AWS::ElastiCache::User'],
  ['RedisApiUserGroup', 'AWS::ElastiCache::UserGroup'],
  ['ApiTaskExecutionRole', 'AWS::IAM::Role'],
  ['WebTaskExecutionRole', 'AWS::IAM::Role'],
  ['WebTaskRole', 'AWS::IAM::Role'],
  ['ApiTaskRole', 'AWS::IAM::Role'],
  ['WorkerTaskRole', 'AWS::IAM::Role'],
  ['WorkerTaskExecutionRole', 'AWS::IAM::Role'],
  ['RedisOperatorTaskExecutionRole', 'AWS::IAM::Role'],
]);

const secretUsernames = new Map([
  ['ApiDatabaseCredentialASecret', 'crypto_api_login_a'],
  ['ApiDatabaseCredentialBSecret', 'crypto_api_login_b'],
  ['WorkerDatabaseCredentialASecret', 'crypto_worker_login_a'],
  ['WorkerDatabaseCredentialBSecret', 'crypto_worker_login_b'],
  ['MigrationDatabaseCredentialSecret', 'crypto_migration'],
  ['RedisApiASecret', 'crypto_api_${EnvironmentName}_a'],
  ['RedisApiBSecret', 'crypto_api_${EnvironmentName}_b'],
  ['RedisOperatorSecret', 'crypto_operator_${EnvironmentName}'],
]);

const outputValues = new Map([
  ['DeliveryArtifactSha256', '!Ref DeliveryArtifactSha256'],
  ['DeliveryArtifactBindingSha256', '!Ref DeliveryArtifactBindingSha256'],
  ['ApiTaskExecutionRoleArn', '!GetAtt ApiTaskExecutionRole.Arn'],
  ['WebTaskExecutionRoleArn', '!GetAtt WebTaskExecutionRole.Arn'],
  ['WebTaskRoleArn', '!GetAtt WebTaskRole.Arn'],
  ['ApiTaskRoleArn', '!GetAtt ApiTaskRole.Arn'],
  ['WorkerTaskRoleArn', '!GetAtt WorkerTaskRole.Arn'],
  ['WorkerTaskExecutionRoleArn', '!GetAtt WorkerTaskExecutionRole.Arn'],
  ['ApiTaskSecurityGroupId', '!Ref ApiTaskSecurityGroup'],
  ['WorkerTaskSecurityGroupId', '!Ref WorkerTaskSecurityGroup'],
  [
    'ApiDatabaseActiveSecretArn',
    [
      'Value: !If',
      '  - UseApiDatabaseA',
      '  - !Ref ApiDatabaseCredentialASecret',
      '  - !Ref ApiDatabaseCredentialBSecret',
    ],
  ],
  ['ApiDatabaseActiveUsername', '!If [UseApiDatabaseA, crypto_api_login_a, crypto_api_login_b]'],
  [
    'ApiDatabaseActiveVersionId',
    '!If [UseApiDatabaseA, !Ref ApiDatabaseSlotAVersionId, !Ref ApiDatabaseSlotBVersionId]',
  ],
  [
    'WorkerDatabaseActiveSecretArn',
    [
      'Value: !If',
      '  - UseWorkerDatabaseA',
      '  - !Ref WorkerDatabaseCredentialASecret',
      '  - !Ref WorkerDatabaseCredentialBSecret',
    ],
  ],
  [
    'WorkerDatabaseActiveUsername',
    '!If [UseWorkerDatabaseA, crypto_worker_login_a, crypto_worker_login_b]',
  ],
  [
    'WorkerDatabaseActiveVersionId',
    [
      'Value:',
      '  !If [UseWorkerDatabaseA, !Ref WorkerDatabaseSlotAVersionId, !Ref WorkerDatabaseSlotBVersionId]',
    ],
  ],
  ['MigrationDatabaseCredentialSecretArn', '!Ref MigrationDatabaseCredentialSecret'],
  ['RedisActiveSecretArn', '!If [UseRedisApiA, !Ref RedisApiASecret, !Ref RedisApiBSecret]'],
  [
    'RedisActiveVersionId',
    '!If [UseRedisApiA, !Ref RedisApiSlotAVersionId, !Ref RedisApiSlotBVersionId]',
  ],
  [
    'RedisActiveUsername',
    [
      'Value: !If',
      '  - UseRedisApiA',
      '  - !Sub crypto_api_${EnvironmentName}_a',
      '  - !Sub crypto_api_${EnvironmentName}_b',
    ],
  ],
  ['RedisApiUserGroupId', '!Ref RedisApiUserGroup'],
  ['RedisApiAUserId', '!Ref RedisApiAUser'],
  ['RedisApiBUserId', '!Ref RedisApiBUser'],
  [
    'RedisOperatorTaskExecutionRoleArn',
    ['Condition: RedisOperatorEnabled', 'Value: !GetAtt RedisOperatorTaskExecutionRole.Arn'],
  ],
  [
    'RedisOperatorTaskSecurityGroupId',
    ['Condition: RedisOperatorEnabled', 'Value: !Ref RedisOperatorTaskSecurityGroup'],
  ],
  [
    'RedisOperatorSecretArn',
    ['Condition: RedisOperatorEnabled', 'Value: !Ref RedisOperatorSecret'],
  ],
  [
    'RedisOperatorUsername',
    ['Condition: RedisOperatorEnabled', 'Value: !Sub crypto_operator_${EnvironmentName}'],
  ],
]);

const securityRuleSpecs = new Map([
  [
    'LoadBalancerToApiEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      properties: [
        ['DestinationSecurityGroupId', '!Ref ApiTaskSecurityGroup'],
        ['FromPort', '3001'],
        ['GroupId', '!Ref LoadBalancerSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '3001'],
      ],
    },
  ],
  [
    'LoadBalancerToApiIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      properties: [
        ['FromPort', '3001'],
        ['GroupId', '!Ref ApiTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref LoadBalancerSecurityGroupId'],
        ['ToPort', '3001'],
      ],
    },
  ],
  [
    'ApiTaskToDatabaseEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      properties: [
        ['DestinationSecurityGroupId', '!Ref DatabaseSecurityGroupId'],
        ['FromPort', '5432'],
        ['GroupId', '!Ref ApiTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '5432'],
      ],
    },
  ],
  [
    'ApiTaskToDatabaseIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      properties: [
        ['FromPort', '5432'],
        ['GroupId', '!Ref DatabaseSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref ApiTaskSecurityGroup'],
        ['ToPort', '5432'],
      ],
    },
  ],
  [
    'WorkerTaskToDatabaseEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      properties: [
        ['DestinationSecurityGroupId', '!Ref DatabaseSecurityGroupId'],
        ['FromPort', '5432'],
        ['GroupId', '!Ref WorkerTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '5432'],
      ],
    },
  ],
  [
    'WorkerTaskToDatabaseIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      properties: [
        ['FromPort', '5432'],
        ['GroupId', '!Ref DatabaseSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref WorkerTaskSecurityGroup'],
        ['ToPort', '5432'],
      ],
    },
  ],
  [
    'ApiTaskToRedisEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      properties: [
        ['DestinationSecurityGroupId', '!Ref RedisSecurityGroupId'],
        ['FromPort', '6379'],
        ['GroupId', '!Ref ApiTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '6379'],
      ],
    },
  ],
  [
    'ApiTaskToRedisIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      properties: [
        ['FromPort', '6379'],
        ['GroupId', '!Ref RedisSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref ApiTaskSecurityGroup'],
        ['ToPort', '6379'],
      ],
    },
  ],
  [
    'RedisOperatorToRedisEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      condition: 'RedisOperatorEnabled',
      properties: [
        ['DestinationSecurityGroupId', '!Ref RedisSecurityGroupId'],
        ['FromPort', '6379'],
        ['GroupId', '!Ref RedisOperatorTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '6379'],
      ],
    },
  ],
  [
    'RedisOperatorToRedisIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      condition: 'RedisOperatorEnabled',
      properties: [
        ['FromPort', '6379'],
        ['GroupId', '!Ref RedisSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref RedisOperatorTaskSecurityGroup'],
        ['ToPort', '6379'],
      ],
    },
  ],
  [
    'RedisOperatorToInterfaceEndpointEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      condition: 'RedisOperatorVpcEndpointRulesEnabled',
      metadata: true,
      properties: [
        ['DestinationSecurityGroupId', '!Ref InterfaceEndpointSecurityGroupId'],
        ['FromPort', '443'],
        ['GroupId', '!Ref RedisOperatorTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'RedisOperatorToInterfaceEndpointIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      condition: 'RedisOperatorVpcEndpointRulesEnabled',
      metadata: true,
      properties: [
        ['FromPort', '443'],
        ['GroupId', '!Ref InterfaceEndpointSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref RedisOperatorTaskSecurityGroup'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'RedisOperatorToS3Egress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      condition: 'RedisOperatorVpcEndpointRulesEnabled',
      properties: [
        ['DestinationPrefixListId', '!Ref S3ManagedPrefixListId'],
        ['FromPort', '443'],
        ['GroupId', '!Ref RedisOperatorTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'ApiTaskToInterfaceEndpointEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      condition: 'CreateVpcEndpointRules',
      metadata: true,
      properties: [
        ['DestinationSecurityGroupId', '!Ref InterfaceEndpointSecurityGroupId'],
        ['FromPort', '443'],
        ['GroupId', '!Ref ApiTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'ApiTaskToInterfaceEndpointIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      condition: 'CreateVpcEndpointRules',
      metadata: true,
      properties: [
        ['FromPort', '443'],
        ['GroupId', '!Ref InterfaceEndpointSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref ApiTaskSecurityGroup'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'WorkerTaskToInterfaceEndpointEgress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      condition: 'CreateVpcEndpointRules',
      metadata: true,
      properties: [
        ['DestinationSecurityGroupId', '!Ref InterfaceEndpointSecurityGroupId'],
        ['FromPort', '443'],
        ['GroupId', '!Ref WorkerTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'WorkerTaskToInterfaceEndpointIngress',
    {
      type: 'AWS::EC2::SecurityGroupIngress',
      condition: 'CreateVpcEndpointRules',
      metadata: true,
      properties: [
        ['FromPort', '443'],
        ['GroupId', '!Ref InterfaceEndpointSecurityGroupId'],
        ['IpProtocol', 'tcp'],
        ['SourceSecurityGroupId', '!Ref WorkerTaskSecurityGroup'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'ApiTaskToS3Egress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      condition: 'CreateVpcEndpointRules',
      properties: [
        ['DestinationPrefixListId', '!Ref S3ManagedPrefixListId'],
        ['FromPort', '443'],
        ['GroupId', '!Ref ApiTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '443'],
      ],
    },
  ],
  [
    'WorkerTaskToS3Egress',
    {
      type: 'AWS::EC2::SecurityGroupEgress',
      condition: 'CreateVpcEndpointRules',
      properties: [
        ['DestinationPrefixListId', '!Ref S3ManagedPrefixListId'],
        ['FromPort', '443'],
        ['GroupId', '!Ref WorkerTaskSecurityGroup'],
        ['IpProtocol', 'tcp'],
        ['ToPort', '443'],
      ],
    },
  ],
]);

function normalize(source) {
  return source.replace(/\r\n/gu, '\n');
}

function section(source, heading, nextHeading) {
  const pattern = new RegExp(`^${heading}:\\n([\\s\\S]*?)(?=^${nextHeading}:\\n)`, 'mu');
  return source.match(pattern)?.[1] ?? '';
}

function finalSection(source, heading) {
  return source.match(new RegExp(`^${heading}:\\n([\\s\\S]*)$`, 'mu'))?.[1] ?? '';
}

function parseIndentedBlocks(source) {
  const matches = [...source.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):\n/gmu)];
  const blocks = new Map();
  for (const [index, match] of matches.entries()) {
    const start = match.index;
    const end = matches[index + 1]?.index ?? source.length;
    blocks.set(match[1], source.slice(start, end).trimEnd());
  }
  return blocks;
}

function exactBlock(logicalId, body) {
  return [`  ${logicalId}:`, ...body.map((line) => `    ${line}`)].join('\n');
}

function expectedRuleBlock(logicalId, spec) {
  const lines = [`Type: ${spec.type}`];
  if (spec.condition) lines.push(`Condition: ${spec.condition}`);
  if (spec.metadata) {
    lines.push('Metadata: { cfn-lint: { config: { ignore_checks: [W1030] } } }');
  }
  lines.push('Properties:', ...spec.properties.map(([name, value]) => `  ${name}: ${value}`));
  return exactBlock(logicalId, lines);
}

function expectedSecretBlock(logicalId, username) {
  const databaseTemplate = logicalId.includes('Database')
    ? `!Sub '{"database":"${'${DatabaseName}'}","username":"${username}"}'`
    : `!Sub '{"username":"${username}"}'`;
  return exactBlock(logicalId, [
    'Type: AWS::SecretsManager::Secret',
    'DeletionPolicy: Retain',
    'UpdateReplacePolicy: Retain',
    'Properties:',
    '  GenerateSecretString:',
    `    ExcludeCharacters: ',"/@'`,
    '    GenerateStringKey: password',
    '    IncludeSpace: false',
    '    PasswordLength: 48',
    '    RequireEachIncludedType: true',
    `    SecretStringTemplate: ${databaseTemplate}`,
    '  KmsKeyId: !Ref ApplicationDataKeyArn',
  ]);
}

function expectedExecutionRoleBlock(
  logicalId,
  imagePolicyName,
  imageRepositoryParameter,
  logPolicyName,
  logGroupParameter,
  secretPolicyName,
  unconditionalSecrets,
  conditionalSecrets,
  decryptionKeys,
  secretStatementCondition,
) {
  const secretStatement = secretStatementCondition
    ? [
        '          - !If',
        `            - ${secretStatementCondition}`,
        '            - Sid: NamedSecrets',
        '              Effect: Allow',
        '              Action: secretsmanager:GetSecretValue',
        '              Resource:',
        ...unconditionalSecrets.map((secret) => `                - !Ref ${secret}`),
        ...conditionalSecrets.flatMap(([condition, secret]) => [
          '                - !If',
          `                  - ${condition}`,
          `                  - !Ref ${secret}`,
          '                  - !Ref AWS::NoValue',
        ]),
        '            - !Ref AWS::NoValue',
      ]
    : [
        '          - Sid: NamedSecrets',
        '            Effect: Allow',
        '            Action: secretsmanager:GetSecretValue',
        '            Resource:',
        ...unconditionalSecrets.map((secret) => `              - !Ref ${secret}`),
        ...conditionalSecrets.flatMap(([condition, secret]) => [
          '              - !If',
          `                - ${condition}`,
          `                - !Ref ${secret}`,
          '                - !Ref AWS::NoValue',
        ]),
      ];
  return exactBlock(logicalId, [
    'Type: AWS::IAM::Role',
    'Properties:',
    '  AssumeRolePolicyDocument:',
    "    Version: '2012-10-17'",
    '    Statement:',
    '      - Effect: Allow',
    '        Principal: { Service: ecs-tasks.amazonaws.com }',
    '        Action: sts:AssumeRole',
    '        Condition:',
    '          StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    '          ArnLike:',
    '            {',
    "              aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*',",
    '            }',
    '  Policies:',
    `    - PolicyName: ${imagePolicyName}`,
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Sid: RegistryAuthentication',
    '            Effect: Allow',
    '            Action: ecr:GetAuthorizationToken',
    "            Resource: '*'",
    '          - Sid: RepositoryImageRead',
    '            Effect: Allow',
    '            Action:',
    '              - ecr:BatchCheckLayerAvailability',
    '              - ecr:BatchGetImage',
    '              - ecr:GetDownloadUrlForLayer',
    `            Resource: !Ref ${imageRepositoryParameter}`,
    `    - PolicyName: ${logPolicyName}`,
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Effect: Allow',
    '            Action: [logs:CreateLogStream, logs:PutLogEvents]',
    `            Resource: !Sub '${'${'}${logGroupParameter}}:*'`,
    `    - PolicyName: ${secretPolicyName}`,
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    ...secretStatement,
    '          - Sid: DecryptSecrets',
    '            Effect: Allow',
    '            Action: kms:Decrypt',
    ...(decryptionKeys.length === 1
      ? [`            Resource: !Ref ${decryptionKeys[0]}`]
      : [`            Resource: [${decryptionKeys.map((key) => `!Ref ${key}`).join(', ')}]`]),
    '            Condition:',
    '              StringEquals:',
    '                kms:ViaService: !Sub secretsmanager.${AWS::Region}.${AWS::URLSuffix}',
  ]);
}

function expectedWebExecutionRoleBlock() {
  return exactBlock('WebTaskExecutionRole', [
    'Type: AWS::IAM::Role',
    'Properties:',
    '  AssumeRolePolicyDocument:',
    "    Version: '2012-10-17'",
    '    Statement:',
    '      - Effect: Allow',
    '        Principal: { Service: ecs-tasks.amazonaws.com }',
    '        Action: sts:AssumeRole',
    '        Condition:',
    '          StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    '          ArnLike:',
    '            {',
    "              aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*',",
    '            }',
    '  Policies:',
    '    - PolicyName: PullWebImage',
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Effect: Allow',
    '            Action: ecr:GetAuthorizationToken',
    "            Resource: '*'",
    '          - Effect: Allow',
    '            Action:',
    '              [ecr:BatchCheckLayerAvailability, ecr:BatchGetImage, ecr:GetDownloadUrlForLayer]',
    '            Resource: !Ref WebImageRepositoryArn',
    '    - PolicyName: WriteWebLogs',
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Effect: Allow',
    '            Action: [logs:CreateLogStream, logs:PutLogEvents]',
    "            Resource: !Sub '${WebLogGroupArn}:*'",
  ]);
}

function expectedTrustOnlyRoleBlock(logicalId) {
  return exactBlock(logicalId, [
    'Type: AWS::IAM::Role',
    'Properties:',
    '  AssumeRolePolicyDocument:',
    "    Version: '2012-10-17'",
    '    Statement:',
    '      - Effect: Allow',
    '        Principal: { Service: ecs-tasks.amazonaws.com }',
    '        Action: sts:AssumeRole',
    '        Condition:',
    '          StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    '          ArnLike:',
    '            {',
    "              aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*',",
    '            }',
  ]);
}

function expectedApiTaskRoleBlock() {
  return exactBlock('ApiTaskRole', [
    'Type: AWS::IAM::Role',
    'Properties:',
    '  AssumeRolePolicyDocument:',
    "    Version: '2012-10-17'",
    '    Statement:',
    '      - Effect: Allow',
    '        Principal: { Service: ecs-tasks.amazonaws.com }',
    '        Action: sts:AssumeRole',
    '        Condition:',
    '          StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    '          ArnLike:',
    '            {',
    "              aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*',",
    '            }',
    '  Policies:',
    '    - PolicyName: ApiJobQueueAccess',
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Sid: InspectQueueRedriveConfiguration',
    '            Effect: Allow',
    '            Action: sqs:GetQueueAttributes',
    '            Resource:',
    '              [',
    '                !Ref JobQueueArn,',
    '                !Ref JobDeadLetterQueueArn,',
    '                !Ref BalanceQueueArn,',
    '                !Ref BalanceDeadLetterQueueArn,',
    '              ]',
  ]);
}

function expectedWorkerTaskRoleBlock() {
  return exactBlock('WorkerTaskRole', [
    'Type: AWS::IAM::Role',
    'Properties:',
    '  AssumeRolePolicyDocument:',
    "    Version: '2012-10-17'",
    '    Statement:',
    '      - Effect: Allow',
    '        Principal: { Service: ecs-tasks.amazonaws.com }',
    '        Action: sts:AssumeRole',
    '        Condition:',
    '          StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    '          ArnLike:',
    '            {',
    "              aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*',",
    '            }',
    '  Policies:',
    '    - PolicyName: OutboxPublishAccess',
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Sid: PublishJobs',
    '            Effect: Allow',
    '            Action: sqs:SendMessage',
    '            Resource: [!Ref JobQueueArn, !Ref BalanceQueueArn]',
    '          - Sid: InspectQueueRedriveConfiguration',
    '            Effect: Allow',
    '            Action: sqs:GetQueueAttributes',
    '            Resource:',
    '              [',
    '                !Ref JobQueueArn,',
    '                !Ref JobDeadLetterQueueArn,',
    '                !Ref BalanceQueueArn,',
    '                !Ref BalanceDeadLetterQueueArn,',
    '              ]',
    '          - Sid: UseSqsEncryptionKey',
    '            Effect: Allow',
    '            Action: [kms:Decrypt, kms:GenerateDataKey]',
    '            Resource: !Ref ApplicationDataKeyArn',
    '            Condition:',
    '              StringEquals:',
    '                kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}',
  ]);
}

function expectedRedisOperatorExecutionRoleBlock() {
  return exactBlock('RedisOperatorTaskExecutionRole', [
    'Type: AWS::IAM::Role',
    'Condition: RedisOperatorEnabled',
    'Properties:',
    '  AssumeRolePolicyDocument:',
    "    Version: '2012-10-17'",
    '    Statement:',
    '      - Effect: Allow',
    '        Principal: { Service: ecs-tasks.amazonaws.com }',
    '        Action: sts:AssumeRole',
    '        Condition:',
    '          StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    '          ArnLike:',
    '            {',
    "              aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*',",
    '            }',
    '  Policies:',
    '    - PolicyName: PullRedisOperatorImage',
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Sid: RegistryAuthentication',
    '            Effect: Allow',
    '            Action: ecr:GetAuthorizationToken',
    "            Resource: '*'",
    '          - Sid: RepositoryImageRead',
    '            Effect: Allow',
    '            Action:',
    '              - ecr:BatchCheckLayerAvailability',
    '              - ecr:BatchGetImage',
    '              - ecr:GetDownloadUrlForLayer',
    '            Resource: !Ref ApiImageRepositoryArn',
    '    - PolicyName: WriteRedisOperatorLogs',
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Effect: Allow',
    '            Action: [logs:CreateLogStream, logs:PutLogEvents]',
    "            Resource: !Sub '${ApiLogGroupArn}:*'",
    '    - PolicyName: ReadRedisOperatorSecret',
    '      PolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Sid: NamedSecret',
    '            Effect: Allow',
    '            Action: secretsmanager:GetSecretValue',
    '            Resource: !Ref RedisOperatorSecret',
    '          - Sid: DecryptSecret',
    '            Effect: Allow',
    '            Action: kms:Decrypt',
    '            Resource: !Ref ApplicationDataKeyArn',
    '            Condition:',
    '              StringEquals:',
    '                kms:ViaService: !Sub secretsmanager.${AWS::Region}.${AWS::URLSuffix}',
  ]);
}

function requireExactIds(actual, expected, label, errors) {
  for (const id of expected.keys()) {
    if (!actual.has(id)) errors.push(`${label} is missing ${id}.`);
  }
  for (const id of actual.keys()) {
    if (!expected.has(id)) errors.push(`${label} contains unreviewed entry ${id}.`);
  }
}

function validateParameters(source, errors) {
  const blocks = parseIndentedBlocks(section(source, 'Parameters', 'Rules'));
  requireExactIds(blocks, parameterTypes, 'Parameter allowlist', errors);
  for (const [logicalId, expectedType] of parameterTypes) {
    const block = blocks.get(logicalId) ?? '';
    const actualType = block.match(/^ {4}Type:\s*(\S+)$/mu)?.[1];
    if (actualType !== expectedType) {
      errors.push(`${logicalId} must use parameter type ${expectedType}.`);
    }
  }
  for (const phaseParameter of [
    'ApiDatabaseCredentialPhase',
    'WorkerDatabaseCredentialPhase',
    'RedisCredentialPhase',
  ]) {
    if (
      (blocks.get(phaseParameter) ?? '') !==
      exactBlock(phaseParameter, [
        'Type: String',
        'Default: A_ONLY',
        'AllowedValues: [A_ONLY, BOTH_USE_A, BOTH_USE_B, B_ONLY]',
      ])
    ) {
      errors.push(`${phaseParameter} must expose only the reviewed four-state rotation machine.`);
    }
  }
  for (const parameter of fixedSlotVersionParameterNames) {
    if (
      (blocks.get(parameter) ?? '') !==
      exactBlock(parameter, ['Type: String', "AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'"])
    ) {
      errors.push(
        `${parameter} must be explicit and accept only the adoption sentinel or an exact Secrets Manager VersionId.`,
      );
    }
  }
  if (
    (blocks.get('RedisOperatorMode') ?? '') !==
    exactBlock('RedisOperatorMode', [
      'Type: String',
      'Default: DISABLED',
      'AllowedValues: [DISABLED, ENABLED]',
    ])
  ) {
    errors.push('RedisOperatorMode must be an explicit disabled-by-default break-glass gate.');
  }
  if (
    (blocks.get('AuthWalletKeysKmsKeyArn') ?? '') !==
    exactBlock('AuthWalletKeysKmsKeyArn', [
      'Type: String',
      'MaxLength: 2048',
      "AllowedPattern: '^arn:[a-z0-9-]+:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9-]+$'",
    ])
  ) {
    errors.push(
      'AuthWalletKeysKmsKeyArn must be one explicit customer-managed KMS key ARN and must not expose a default.',
    );
  }
  if (
    (blocks.get('BillingAcknowledgement') ?? '') !==
    exactBlock('BillingAcknowledgement', [
      'Type: String',
      'Default: NOT_AUTHORIZED',
      'AllowedValues: [NOT_AUTHORIZED, I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES]',
    ])
  ) {
    errors.push(
      'BillingAcknowledgement must default to NOT_AUTHORIZED and require explicit consent.',
    );
  }
  if (
    (blocks.get('DatabaseName') ?? '') !==
    exactBlock('DatabaseName', [
      'Type: String',
      'Default: crypto_lending',
      "AllowedPattern: '^[a-z][a-z0-9_]{0,62}$'",
    ])
  ) {
    errors.push('DatabaseName must be a canonical lowercase PostgreSQL identifier.');
  }
  for (const parameter of ['DeliveryArtifactSha256', 'DeliveryArtifactBindingSha256']) {
    if (
      (blocks.get(parameter) ?? '') !==
      exactBlock(parameter, ['Type: String', "AllowedPattern: '^[a-f0-9]{64}$'"])
    ) {
      errors.push(`${parameter} must be an explicit lowercase SHA-256 provenance value.`);
    }
  }
  if (
    (blocks.get('PrivateEgressMode') ?? '') !==
    exactBlock('PrivateEgressMode', [
      'Type: String',
      'Default: VpcEndpoints',
      'AllowedValues: [VpcEndpoints, None]',
    ])
  ) {
    errors.push('PrivateEgressMode must expose only VpcEndpoints or fail-closed None.');
  }
  for (const [parameter, allowedPattern] of [
    ['InterfaceEndpointSecurityGroupId', '^$|^sg-(?:[a-f0-9]{8}|[a-f0-9]{17})$'],
    ['S3ManagedPrefixListId', '^$|^pl-[a-f0-9]+$'],
  ]) {
    if (
      (blocks.get(parameter) ?? '') !==
      exactBlock(parameter, ['Type: String', "Default: ''", `AllowedPattern: '${allowedPattern}'`])
    ) {
      errors.push(`${parameter} must use the exact optional identifier contract.`);
    }
  }
  for (const [parameter, repository] of [
    ['ApiImageRepositoryArn', 'crypto-lending-api'],
    ['WebImageRepositoryArn', 'crypto-lending-web'],
  ]) {
    const repositoryPattern = `^arn:[a-z0-9-]+:ecr:[a-z0-9-]+:[0-9]{12}:repository/${repository}$`;
    if (
      (blocks.get(parameter) ?? '') !==
      exactBlock(parameter, ['Type: String', `AllowedPattern: '${repositoryPattern}'`])
    ) {
      errors.push(`${parameter} must be a concrete reviewed application ECR repository ARN.`);
    }
  }
  for (const parameter of ['ApiLogGroupArn', 'WebLogGroupArn', 'WorkerLogGroupArn']) {
    if (
      (blocks.get(parameter) ?? '') !==
      exactBlock(parameter, [
        'Type: String',
        "AllowedPattern: '^arn:[a-z0-9-]+:logs:[a-z0-9-]+:[0-9]{12}:log-group:[A-Za-z0-9_./#-]+$'",
      ])
    ) {
      errors.push(`${parameter} must be one explicit application log-group ARN.`);
    }
  }
  for (const parameter of [
    'JobQueueArn',
    'JobDeadLetterQueueArn',
    'BalanceQueueArn',
    'BalanceDeadLetterQueueArn',
  ]) {
    if (
      (blocks.get(parameter) ?? '') !==
      exactBlock(parameter, [
        'Type: String',
        "AllowedPattern: '^arn:[a-z0-9-]+:sqs:[a-z0-9-]+:[0-9]{12}:crypto-lending-[A-Za-z0-9-]+$'",
      ])
    ) {
      errors.push(`${parameter} must be one explicit application SQS queue ARN.`);
    }
  }
  if (
    (blocks.get('AuthWalletKeysSecretArn') ?? '') !==
    exactBlock('AuthWalletKeysSecretArn', [
      'Type: String',
      'NoEcho: true',
      'MaxLength: 2048',
      "AllowedPattern: '^arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$'",
    ])
  ) {
    errors.push(
      'AuthWalletKeysSecretArn must be one explicit selector-free Secrets Manager ARN and must not expose a default.',
    );
  }
  if (
    [...blocks.keys()].some(
      (name) =>
        name !== 'AuthWalletKeysSecretArn' && /(?:password|token|secret|migration)/iu.test(name),
    )
  ) {
    errors.push('The child template must own credentials and must not accept secret/admin inputs.');
  }
}

function validateRules(source, errors) {
  const expected = [
    '  ExplicitBillingAcknowledgementRequired:',
    '    Assertions:',
    '      - Assert: !Equals',
    '          - !Ref BillingAcknowledgement',
    '          - I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES',
    '        AssertDescription: Explicit billing acknowledgement is required before deployment.',
    '  PrivateEgressInputsMatchMode:',
    '    Assertions:',
    '      - Assert: !Or',
    '          - !And',
    '            - !Equals [!Ref PrivateEgressMode, VpcEndpoints]',
    "            - !Not [!Equals [!Ref InterfaceEndpointSecurityGroupId, '']]",
    "            - !Not [!Equals [!Ref S3ManagedPrefixListId, '']]",
    '          - !And',
    '            - !Equals [!Ref PrivateEgressMode, None]',
    "            - !Equals [!Ref InterfaceEndpointSecurityGroupId, '']",
    "            - !Equals [!Ref S3ManagedPrefixListId, '']",
    '        AssertDescription: VpcEndpoints requires exact endpoint identifiers; None requires both identifiers omitted.',
    '  RedisOperatorRequiresPrivateDeliveryPath:',
    '    Assertions:',
    '      - Assert: !Or',
    '          - !Equals [!Ref RedisOperatorMode, DISABLED]',
    '          - !Equals [!Ref PrivateEgressMode, VpcEndpoints]',
    '        AssertDescription: Redis operator mode requires the reviewed private ECR, logs, Secrets Manager, and S3 delivery path.',
    '  RedisOperatorRequiresInactiveSlot:',
    '    Assertions:',
    '      - Assert: !Or',
    '          - !Equals [!Ref RedisOperatorMode, DISABLED]',
    '          - !Equals [!Ref RedisCredentialPhase, A_ONLY]',
    '          - !Equals [!Ref RedisCredentialPhase, B_ONLY]',
    '        AssertDescription: Redis operator mode requires one inactive application credential slot.',
    '  FixedSlotVersionsRequireSafeState:',
    '    Assertions:',
    '      - Assert: !Or',
    '          - !And [',
    '              !Equals [!Ref ApiDatabaseSlotAVersionId, UNPINNED],',
    '              !Equals [!Ref ApiDatabaseSlotBVersionId, UNPINNED],',
    '              !Equals [!Ref WorkerDatabaseSlotAVersionId, UNPINNED],',
    '              !Equals [!Ref WorkerDatabaseSlotBVersionId, UNPINNED],',
    '              !Equals [!Ref RedisApiSlotAVersionId, UNPINNED],',
    '              !Equals [!Ref RedisApiSlotBVersionId, UNPINNED],',
    '              !Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY],',
    '              !Equals [!Ref WorkerDatabaseCredentialPhase, A_ONLY],',
    '              !Equals [!Ref RedisCredentialPhase, A_ONLY],',
    '              !Equals [!Ref RedisOperatorMode, DISABLED],',
    '            ]',
    '          - !And [',
    '              !Not [!Equals [!Ref ApiDatabaseSlotAVersionId, UNPINNED]],',
    '              !Not [!Equals [!Ref ApiDatabaseSlotBVersionId, UNPINNED]],',
    '              !Not [!Equals [!Ref WorkerDatabaseSlotAVersionId, UNPINNED]],',
    '              !Not [!Equals [!Ref WorkerDatabaseSlotBVersionId, UNPINNED]],',
    '              !Not [!Equals [!Ref RedisApiSlotAVersionId, UNPINNED]],',
    '              !Not [!Equals [!Ref RedisApiSlotBVersionId, UNPINNED]],',
    '            ]',
    '        AssertDescription: Fixed-slot versions must be all pinned or an inert A_ONLY adoption sentinel.',
  ].join('\n');
  if (section(source, 'Rules', 'Conditions').trimEnd() !== expected) {
    errors.push('Deployment rules must require exact explicit billing acknowledgement.');
  }
}

function validateConditions(source, errors) {
  const expected = [
    '  CreateVpcEndpointRules: !Equals [!Ref PrivateEgressMode, VpcEndpoints]',
    '  CredentialVersionsPinned: !Not [!Equals [!Ref ApiDatabaseSlotAVersionId, UNPINNED]]',
    '  ApiDatabaseAReadable: !And',
    '    - !Condition CredentialVersionsPinned',
    '    - !Not [!Equals [!Ref ApiDatabaseCredentialPhase, B_ONLY]]',
    '  ApiDatabaseBReadable: !And',
    '    - !Condition CredentialVersionsPinned',
    '    - !Not [!Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY]]',
    '  UseApiDatabaseA: !Or',
    '    - !Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY]',
    '    - !Equals [!Ref ApiDatabaseCredentialPhase, BOTH_USE_A]',
    '  WorkerDatabaseAReadable: !And',
    '    - !Condition CredentialVersionsPinned',
    '    - !Not [!Equals [!Ref WorkerDatabaseCredentialPhase, B_ONLY]]',
    '  WorkerDatabaseBReadable: !And',
    '    - !Condition CredentialVersionsPinned',
    '    - !Not [!Equals [!Ref WorkerDatabaseCredentialPhase, A_ONLY]]',
    '  UseWorkerDatabaseA: !Or',
    '    - !Equals [!Ref WorkerDatabaseCredentialPhase, A_ONLY]',
    '    - !Equals [!Ref WorkerDatabaseCredentialPhase, BOTH_USE_A]',
    '  RedisApiAEnabled: !And',
    '    - !Condition CredentialVersionsPinned',
    '    - !Not [!Equals [!Ref RedisCredentialPhase, B_ONLY]]',
    '  RedisApiBEnabled: !And',
    '    - !Condition CredentialVersionsPinned',
    '    - !Not [!Equals [!Ref RedisCredentialPhase, A_ONLY]]',
    '  RedisOperatorEnabled: !Equals [!Ref RedisOperatorMode, ENABLED]',
    '  RedisOperatorVpcEndpointRulesEnabled: !And',
    '    - !Equals [!Ref RedisOperatorMode, ENABLED]',
    '    - !Equals [!Ref PrivateEgressMode, VpcEndpoints]',
    '  UseRedisApiA: !Or',
    '    - !Equals [!Ref RedisCredentialPhase, A_ONLY]',
    '    - !Equals [!Ref RedisCredentialPhase, BOTH_USE_A]',
  ].join('\n');
  const actual = section(source, 'Conditions', 'Resources').trimEnd();
  if (actual !== `${expected}\n`.trimEnd() && actual !== expected) {
    errors.push(
      'Conditions must preserve the exact endpoint gate and workload credential readable-slot/active-slot mappings.',
    );
  }
}

function validateNetwork(resources, errors) {
  for (const [logicalId, description] of [
    ['ApiTaskSecurityGroup', '!Sub ${EnvironmentName} API tasks'],
    ['WorkerTaskSecurityGroup', '!Sub ${EnvironmentName} worker tasks'],
  ]) {
    const expected = exactBlock(logicalId, [
      'Type: AWS::EC2::SecurityGroup',
      'Properties:',
      `  GroupDescription: ${description}`,
      '  VpcId: !Ref VpcId',
      "  SecurityGroupEgress: [{ CidrIp: 127.0.0.1/32, IpProtocol: '-1' }]",
    ]);
    if ((resources.get(logicalId) ?? '') !== expected) {
      errors.push(`${logicalId} must retain the exact deny-by-default reviewed definition.`);
    }
  }
  const expectedOperatorSecurityGroup = exactBlock('RedisOperatorTaskSecurityGroup', [
    'Type: AWS::EC2::SecurityGroup',
    'Condition: RedisOperatorEnabled',
    'Properties:',
    '  GroupDescription: !Sub ${EnvironmentName} one-off Redis revocation operator',
    '  VpcId: !Ref VpcId',
    "  SecurityGroupEgress: [{ CidrIp: 127.0.0.1/32, IpProtocol: '-1' }]",
  ]);
  if ((resources.get('RedisOperatorTaskSecurityGroup') ?? '') !== expectedOperatorSecurityGroup) {
    errors.push(
      'RedisOperatorTaskSecurityGroup must exist only behind the explicit operator gate.',
    );
  }

  for (const [logicalId, spec] of securityRuleSpecs) {
    if ((resources.get(logicalId) ?? '') !== expectedRuleBlock(logicalId, spec)) {
      errors.push(
        `${logicalId} must retain its exact reviewed source, destination, port, and mode.`,
      );
    }
  }

  const workerNetwork = [...resources]
    .filter(([logicalId]) => logicalId.startsWith('WorkerTask'))
    .map(([, block]) => block)
    .join('\n');
  if (/Redis|6379/iu.test(workerNetwork)) {
    errors.push('Worker network resources must not reference Redis or port 6379.');
  }
  if (/(?:0\.0\.0\.0\/0|::\/0)/u.test([...resources.values()].join('\n'))) {
    errors.push('Workload security groups must not contain internet-wide ingress or egress.');
  }
}

function validateSecrets(resources, errors) {
  for (const [logicalId, username] of secretUsernames) {
    if ((resources.get(logicalId) ?? '') !== expectedSecretBlock(logicalId, username)) {
      errors.push(
        `${logicalId} must be a distinct retained KMS-backed generated secret for ${username}.`,
      );
    }
  }
  const secretBlocks = [...secretUsernames.keys()]
    .map((logicalId) => resources.get(logicalId) ?? '')
    .join('\n');
  if (
    /^\s+SecretString:/mu.test(secretBlocks) ||
    /(?:password|token)\s*[:=]\s*[^\s{]/iu.test(secretBlocks)
  ) {
    errors.push(
      'Credential resources must not contain a plaintext SecretString or password value.',
    );
  }
  if (new Set(secretUsernames.values()).size !== secretUsernames.size) {
    errors.push('Every database and Redis credential resource must use a distinct username.');
  }
}

function validateRedis(resources, errors) {
  const expectedDefault = exactBlock('RedisDefaultUser', [
    'Type: AWS::ElastiCache::User',
    'Properties:',
    "  AccessString: 'off sanitize-payload resetkeys resetchannels -@all'",
    '  AuthenticationMode: { Type: no-password-required }',
    '  Engine: redis',
    '  UserId: !Sub cl-${EnvironmentName}-rd',
    '  UserName: default',
  ]);
  const expectedA = exactBlock('RedisApiAUser', [
    'Type: AWS::ElastiCache::User',
    'Properties:',
    '  AccessString: !If',
    '    - RedisApiAEnabled',
    "    - 'on sanitize-payload resetkeys resetchannels -@all +ping +quit'",
    "    - 'off sanitize-payload resetkeys resetchannels -@all +ping +quit'",
    '  AuthenticationMode: !If',
    '    - CredentialVersionsPinned',
    '    - {',
    '        Passwords:',
    '          [',
    "            !Sub '{{resolve:secretsmanager:${RedisApiASecret}:SecretString:password::${RedisApiSlotAVersionId}}',",
    '          ],',
    '        Type: password,',
    '      }',
    '    - { Type: no-password-required }',
    '  Engine: redis',
    '  UserId: !Sub cl-${EnvironmentName}-ra',
    '  UserName: !Sub crypto_api_${EnvironmentName}_a',
  ]);
  const expectedB = exactBlock('RedisApiBUser', [
    'Type: AWS::ElastiCache::User',
    'Properties:',
    '  AccessString: !If',
    '    - RedisApiBEnabled',
    "    - 'on sanitize-payload resetkeys resetchannels -@all +ping +quit'",
    "    - 'off sanitize-payload resetkeys resetchannels -@all +ping +quit'",
    '  AuthenticationMode: !If',
    '    - CredentialVersionsPinned',
    '    - {',
    '        Passwords:',
    '          [',
    "            !Sub '{{resolve:secretsmanager:${RedisApiBSecret}:SecretString:password::${RedisApiSlotBVersionId}}',",
    '          ],',
    '        Type: password,',
    '      }',
    '    - { Type: no-password-required }',
    '  Engine: redis',
    '  UserId: !Sub cl-${EnvironmentName}-rb',
    '  UserName: !Sub crypto_api_${EnvironmentName}_b',
  ]);
  const expectedOperator = exactBlock('RedisOperatorUser', [
    'Type: AWS::ElastiCache::User',
    'Properties:',
    '  AccessString: !If',
    '    - RedisOperatorEnabled',
    "    - 'on sanitize-payload resetkeys resetchannels -@all +client|kill'",
    "    - 'off sanitize-payload resetkeys resetchannels -@all +client|kill'",
    '  AuthenticationMode:',
    "    Passwords: [!Sub '{{resolve:secretsmanager:${RedisOperatorSecret}:SecretString:password}}']",
    '    Type: password',
    '  Engine: redis',
    '  UserId: !Sub cl-${EnvironmentName}-ro',
    '  UserName: !Sub crypto_operator_${EnvironmentName}',
  ]);
  const expectedGroup = exactBlock('RedisApiUserGroup', [
    'Type: AWS::ElastiCache::UserGroup',
    'Properties:',
    '  Engine: redis',
    '  UserGroupId: !Sub cl-${EnvironmentName}-api',
    '  UserIds:',
    '    - !Ref RedisDefaultUser',
    '    - !Ref RedisApiAUser',
    '    - !Ref RedisApiBUser',
    '    - !Ref RedisOperatorUser',
  ]);
  for (const [logicalId, expected] of [
    ['RedisDefaultUser', expectedDefault],
    ['RedisApiAUser', expectedA],
    ['RedisApiBUser', expectedB],
    ['RedisOperatorUser', expectedOperator],
    ['RedisApiUserGroup', expectedGroup],
  ]) {
    if ((resources.get(logicalId) ?? '') !== expected) {
      errors.push(`${logicalId} must match the exact ordered reviewed Redis identity contract.`);
    }
  }

  const userBlocks = ['RedisDefaultUser', 'RedisApiAUser', 'RedisApiBUser', 'RedisOperatorUser']
    .map((logicalId) => resources.get(logicalId) ?? '')
    .join('\n');
  if (/(?:\+@|~\*|&\*|allcommands|allkeys|allchannels)/iu.test(userBlocks)) {
    errors.push('Redis identities must not grant command categories, keys, or channels.');
  }
  if (
    /\+(?:get|set|del|eval|script|function|module|publish|subscribe|multi|exec|config|acl)\b/iu.test(
      userBlocks,
    )
  ) {
    errors.push(
      'Redis identities must not grant data, script, pubsub, transaction, or admin commands.',
    );
  }
}

function validateExecutionRoles(resources, errors) {
  const expectedApi = expectedExecutionRoleBlock(
    'ApiTaskExecutionRole',
    'PullApiImage',
    'ApiImageRepositoryArn',
    'WriteApiLogs',
    'ApiLogGroupArn',
    'ReadApiRuntimeSecrets',
    ['AuthWalletKeysSecretArn'],
    [
      ['ApiDatabaseAReadable', 'ApiDatabaseCredentialASecret'],
      ['ApiDatabaseBReadable', 'ApiDatabaseCredentialBSecret'],
      ['RedisApiAEnabled', 'RedisApiASecret'],
      ['RedisApiBEnabled', 'RedisApiBSecret'],
    ],
    ['ApplicationDataKeyArn', 'AuthWalletKeysKmsKeyArn'],
  );
  const expectedWorker = expectedExecutionRoleBlock(
    'WorkerTaskExecutionRole',
    'PullWorkerImage',
    'ApiImageRepositoryArn',
    'WriteWorkerLogs',
    'WorkerLogGroupArn',
    'ReadWorkerRuntimeSecrets',
    [],
    [
      ['WorkerDatabaseAReadable', 'WorkerDatabaseCredentialASecret'],
      ['WorkerDatabaseBReadable', 'WorkerDatabaseCredentialBSecret'],
    ],
    ['ApplicationDataKeyArn'],
    'CredentialVersionsPinned',
  );
  if ((resources.get('ApiTaskExecutionRole') ?? '') !== expectedApi) {
    errors.push('ApiTaskExecutionRole must retain the exact API log and runtime-secret matrix.');
  }
  if ((resources.get('WorkerTaskExecutionRole') ?? '') !== expectedWorker) {
    errors.push(
      'WorkerTaskExecutionRole must retain the exact worker log and runtime-secret matrix.',
    );
  }
  if ((resources.get('WebTaskExecutionRole') ?? '') !== expectedWebExecutionRoleBlock()) {
    errors.push('WebTaskExecutionRole must retain the exact image-pull and log-only matrix.');
  }
  if ((resources.get('WebTaskRole') ?? '') !== expectedTrustOnlyRoleBlock('WebTaskRole')) {
    errors.push('WebTaskRole must remain permissionless with only the reviewed ECS trust policy.');
  }
  if ((resources.get('ApiTaskRole') ?? '') !== expectedApiTaskRoleBlock()) {
    errors.push('ApiTaskRole must retain only the exact queue-readiness capability matrix.');
  }
  if ((resources.get('WorkerTaskRole') ?? '') !== expectedWorkerTaskRoleBlock()) {
    errors.push('WorkerTaskRole must retain only the exact queue-publish and SQS KMS matrix.');
  }
  const operator = resources.get('RedisOperatorTaskExecutionRole') ?? '';
  if (operator !== expectedRedisOperatorExecutionRoleBlock()) {
    errors.push(
      'RedisOperatorTaskExecutionRole must be conditional and read only its scoped operator secret.',
    );
  }

  const executionRoles = ['ApiTaskExecutionRole', 'WebTaskExecutionRole', 'WorkerTaskExecutionRole']
    .map((logicalId) => resources.get(logicalId) ?? '')
    .join('\n');
  const longLivedRoles = `${executionRoles}\n${resources.get('ApiTaskRole') ?? ''}\n${resources.get('WorkerTaskRole') ?? ''}\n${resources.get('WebTaskRole') ?? ''}`;
  if (/MigrationDatabaseCredentialSecret|crypto_migration|admin/iu.test(longLivedRoles)) {
    errors.push('Long-lived execution roles must not read migration/admin credentials.');
  }
  const worker = resources.get('WorkerTaskExecutionRole') ?? '';
  if (/RedisApi|crypto_api_|AuthWalletKeys(?:Secret|KmsKey)Arn/iu.test(worker)) {
    errors.push(
      'WorkerTaskExecutionRole must not read Redis or authentication/wallet credentials.',
    );
  }
  if (
    /ApiDatabaseCredential|WorkerDatabaseCredential|MigrationDatabaseCredential|RedisApi[AB]Secret|AuthWalletKeys(?:Secret|KmsKey)Arn/iu.test(
      operator,
    )
  ) {
    errors.push('Redis operator execution must not read application or migration credentials.');
  }
  if (/ManagedPolicyArns:/u.test(longLivedRoles)) {
    errors.push('Workload roles must not attach externally mutable managed policies.');
  }
  const registryAuthorization = [
    '                Action: ecr:GetAuthorizationToken',
    "                Resource: '*'",
  ].join('\n');
  if (executionRoles.split(registryAuthorization).length - 1 !== 3) {
    errors.push(
      'Each execution role must contain the one AWS-required ECR authorization wildcard.',
    );
  }
  const rolesWithoutRequiredEcrWildcard = executionRoles.replaceAll(registryAuthorization, '');
  if (/Resource:\s*(?:\[?['"]?\*|\n\s*- ['"]?\*)/mu.test(rolesWithoutRequiredEcrWildcard)) {
    errors.push('Execution-role IAM resources must not use a wildcard outside ECR authorization.');
  }
  const operatorWithoutRequiredEcrWildcard = operator.replace(registryAuthorization, '');
  if (
    operator.split(registryAuthorization).length - 1 !== 1 ||
    /Resource:\s*(?:\[?['"]?\*|\n\s*- ['"]?\*)/mu.test(operatorWithoutRequiredEcrWildcard)
  ) {
    errors.push('Redis operator IAM must use only the AWS-required ECR authorization wildcard.');
  }
}

function validateOutputs(source, errors) {
  const outputSection = finalSection(source, 'Outputs');
  const blocks = parseIndentedBlocks(outputSection);
  requireExactIds(blocks, outputValues, 'Output allowlist', errors);
  for (const [logicalId, value] of outputValues) {
    const expected = exactBlock(logicalId, Array.isArray(value) ? value : [`Value: ${value}`]);
    if ((blocks.get(logicalId) ?? '') !== expected) {
      errors.push(`${logicalId} must expose only its reviewed identifier/ARN mapping.`);
    }
  }
  if (/SecretString:password|resolve:secretsmanager|(?:password|token)\s*:/iu.test(outputSection)) {
    errors.push('Outputs must expose only secret ARNs, never secret values or dynamic references.');
  }
}

export function validateApplicationWorkloadBoundariesSource(rawSource) {
  const source = normalize(rawSource);
  const errors = [];
  const templateBytes = Buffer.byteLength(rawSource, 'utf8');

  if (!source.startsWith("AWSTemplateFormatVersion: '2010-09-09'\n")) {
    errors.push('Template must declare the reviewed CloudFormation format version.');
  }
  if (
    !source.startsWith(
      "AWSTemplateFormatVersion: '2010-09-09'\nDescription: Standalone child; deploy only through the independently validated parent composition.\n",
    )
  ) {
    errors.push(
      'Template must state that it requires the independently validated parent composition.',
    );
  }
  if (/^Transform:/mu.test(source)) {
    errors.push('Template transforms/macros are not allowed in the workload-boundary child.');
  }
  if (templateBytes > directUploadLimitBytes) {
    errors.push(
      `Workload-boundary template is ${templateBytes} bytes; keep it at or below ${directUploadLimitBytes} bytes.`,
    );
  }
  for (const heading of ['Parameters', 'Rules', 'Conditions', 'Resources', 'Outputs']) {
    if ((source.match(new RegExp(`^${heading}:$`, 'gmu')) ?? []).length !== 1) {
      errors.push(`Template must declare exactly one ${heading} section.`);
    }
  }

  validateParameters(source, errors);
  validateRules(source, errors);
  validateConditions(source, errors);

  const resources = parseIndentedBlocks(section(source, 'Resources', 'Outputs'));
  requireExactIds(resources, resourceTypes, 'Resource allowlist', errors);
  for (const [logicalId, expectedType] of resourceTypes) {
    const actualType = resources.get(logicalId)?.match(/^ {4}Type:\s*(\S+)$/mu)?.[1];
    if (actualType !== expectedType) {
      errors.push(`${logicalId} must use resource type ${expectedType}.`);
    }
  }

  validateNetwork(resources, errors);
  validateSecrets(resources, errors);
  validateRedis(resources, errors);
  validateExecutionRoles(resources, errors);
  validateOutputs(source, errors);

  return {
    ok: errors.length === 0,
    deploymentStatus: 'STANDALONE_REQUIRES_VALIDATED_PARENT_COMPOSITION',
    errors: [...new Set(errors)],
    residualLimitations: [...residualLimitations],
    templateBytes,
    directUploadLimitBytes,
    awsCallsMade: 0,
  };
}

export function validateApplicationWorkloadBoundariesFile(path = defaultTemplatePath) {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return {
      ok: false,
      deploymentStatus: 'STANDALONE_REQUIRES_VALIDATED_PARENT_COMPOSITION',
      errors: [`Template does not exist: ${path}`],
      residualLimitations: [...residualLimitations],
      templateBytes: 0,
      directUploadLimitBytes,
      awsCallsMade: 0,
    };
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    return {
      ok: false,
      deploymentStatus: 'STANDALONE_REQUIRES_VALIDATED_PARENT_COMPOSITION',
      errors: [`Template must be a regular local file, not a symlink or directory: ${path}`],
      residualLimitations: [...residualLimitations],
      templateBytes: 0,
      directUploadLimitBytes,
      awsCallsMade: 0,
    };
  }
  return validateApplicationWorkloadBoundariesSource(readFileSync(path, 'utf8'));
}

function parseArguments(argv) {
  let template = defaultTemplatePath;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--template') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--template requires a path.');
      if (/^(?:\\\\|\/\/|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/u.test(value)) {
        throw new Error('--template requires a local filesystem path, not a URI/network path.');
      }
      template = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        [
          'Usage: node infra/aws/validate-application-workload-boundaries.mjs [options]',
          '',
          'Options:',
          '  --template <path>  Local child-template path',
          '  --json             Emit machine-readable output',
          '',
          'This command performs local static checks only and makes zero AWS calls.',
          '',
        ].join('\n'),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { template, json };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = validateApplicationWorkloadBoundariesFile(options.template);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (report.ok) {
      process.stdout.write(
        `Application workload-boundary validation passed (${report.templateBytes} bytes, zero AWS calls).\n`,
      );
    } else {
      for (const error of report.errors) {
        process.stderr.write(`Application workload-boundary validation failed: ${error}\n`);
      }
    }
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Application workload-boundary validation failed: ${message}\n`);
    process.exitCode = 1;
  }
}
