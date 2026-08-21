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

const residualLimitations = Object.freeze([
  'STANDALONE_REQUIRES_VALIDATED_PARENT_COMPOSITION: this child does not itself wire task definitions, services, or the Redis replication group. The repository parent must pass its independent composition validator and immutable delivery guard; deploying this child alone does not enforce workload boundaries.',
  'Generated database secrets and phase-scoped injection do not create, enable, disable, or install SCRAM verifiers for PostgreSQL LOGIN principals; those remain separately authorized privileged provisioning gates.',
  'PrivateEgressMode=None intentionally provides no ECR, logs, Secrets Manager, or SQS path; the parent must independently enforce zero API and worker desired counts.',
  'No DNS security-group rule is present because AmazonProvidedDNS traffic is not filterable by security groups; a custom resolver requires a separately reviewed exact destination.',
  'REDIS_OPERATOR_EXECUTION_ARTIFACT_UNRESOLVED: this child emits a conditional role, network identity, credential, and ACL user but the repository has no reviewed production revocation CLI or one-off task definition. Redis ACL cannot constrain the CLIENT KILL username argument, so exact-target command construction, task drain, denial evidence, and immediate operator disablement remain unresolved local-design and separately authorized live gates.',
  'FIXED_SLOT_CREDENTIAL_REGENERATION_UNRESOLVED: the four enum values constrain each submitted phase but do not compare deployed state or enforce transition adjacency, and retained A/B Secrets Manager resources do not regenerate when a phase changes. A-to-B-to-A would re-enable the original A credential, so the child can represent reviewed overlap/cutover phases but is neither an enforced workflow nor repeatable rotation until a reviewed inactive-slot regeneration, Redis-password/database-verifier installation, and current-state transition artifact exists.',
  'FAILED_AUTH_MONITORING_UNRESOLVED: local ACL LOG and application redaction tests prove safe denial behavior, but the repository does not yet define a validated ElastiCache failed-auth log or metric delivery, filter, alarm, and actionable evidence path.',
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
  ['ApiLogGroupArn', 'String'],
  ['WorkerLogGroupArn', 'String'],
  ['ApiImageRepositoryArn', 'String'],
  ['WorkerImageRepositoryArn', 'String'],
  ['ApiDatabaseCredentialPhase', 'String'],
  ['WorkerDatabaseCredentialPhase', 'String'],
  ['RedisCredentialPhase', 'String'],
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
  ['MigrationDatabaseCredentialSecretArn', '!Ref MigrationDatabaseCredentialSecret'],
  ['RedisActiveSecretArn', '!If [UseRedisApiA, !Ref RedisApiASecret, !Ref RedisApiBSecret]'],
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
  const matches = [...source.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):\n/gmu)];
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
  conditionalSecrets,
) {
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
    '          - Sid: NamedSecrets',
    '            Effect: Allow',
    '            Action: secretsmanager:GetSecretValue',
    '            Resource:',
    ...conditionalSecrets.flatMap(([condition, secret]) => [
      '              - !If',
      `                - ${condition}`,
      `                - !Ref ${secret}`,
      '                - !Ref AWS::NoValue',
    ]),
    '          - Sid: DecryptSecrets',
    '            Effect: Allow',
    '            Action: kms:Decrypt',
    '            Resource: !Ref ApplicationDataKeyArn',
    '            Condition:',
    '              StringEquals:',
    '                kms:ViaService: !Sub secretsmanager.${AWS::Region}.${AWS::URLSuffix}',
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
    const actualType = block.match(/^    Type:\s*(\S+)$/mu)?.[1];
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
    ['WorkerImageRepositoryArn', 'crypto-lending-worker'],
  ]) {
    const repositoryPattern = `^arn:[a-z0-9-]+:ecr:[a-z0-9-]+:[0-9]{12}:repository/${repository}$`;
    if (
      (blocks.get(parameter) ?? '') !==
      exactBlock(parameter, ['Type: String', `AllowedPattern: '${repositoryPattern}'`])
    ) {
      errors.push(`${parameter} must be a concrete reviewed application ECR repository ARN.`);
    }
  }
  if ([...blocks.keys()].some((name) => /(?:password|token|secret|migration)/iu.test(name))) {
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
  ].join('\n');
  if (section(source, 'Rules', 'Conditions').trimEnd() !== expected) {
    errors.push('Deployment rules must require exact explicit billing acknowledgement.');
  }
}

function validateConditions(source, errors) {
  const expected = [
    '  CreateVpcEndpointRules: !Equals [!Ref PrivateEgressMode, VpcEndpoints]',
    '  ApiDatabaseAReadable: !Not [!Equals [!Ref ApiDatabaseCredentialPhase, B_ONLY]]',
    '  ApiDatabaseBReadable: !Not [!Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY]]',
    '  UseApiDatabaseA: !Or',
    '    - !Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY]',
    '    - !Equals [!Ref ApiDatabaseCredentialPhase, BOTH_USE_A]',
    '  WorkerDatabaseAReadable: !Not [!Equals [!Ref WorkerDatabaseCredentialPhase, B_ONLY]]',
    '  WorkerDatabaseBReadable: !Not [!Equals [!Ref WorkerDatabaseCredentialPhase, A_ONLY]]',
    '  UseWorkerDatabaseA: !Or',
    '    - !Equals [!Ref WorkerDatabaseCredentialPhase, A_ONLY]',
    '    - !Equals [!Ref WorkerDatabaseCredentialPhase, BOTH_USE_A]',
    '  RedisApiAEnabled: !Not [!Equals [!Ref RedisCredentialPhase, B_ONLY]]',
    '  RedisApiBEnabled: !Not [!Equals [!Ref RedisCredentialPhase, A_ONLY]]',
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
    '  AuthenticationMode:',
    "    Passwords: [!Sub '{{resolve:secretsmanager:${RedisApiASecret}:SecretString:password}}']",
    '    Type: password',
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
    '  AuthenticationMode:',
    "    Passwords: [!Sub '{{resolve:secretsmanager:${RedisApiBSecret}:SecretString:password}}']",
    '    Type: password',
    '  Engine: redis',
    '  UserId: !Sub cl-${EnvironmentName}-rb',
    '  UserName: !Sub crypto_api_${EnvironmentName}_b',
  ]);
  const expectedOperator = exactBlock('RedisOperatorUser', [
    'Type: AWS::ElastiCache::User',
    'Properties:',
    '  AccessString: !If',
    '    - RedisOperatorEnabled',
    "    - 'on sanitize-payload resetkeys resetchannels -@all +ping +quit +client|kill'",
    "    - 'off sanitize-payload resetkeys resetchannels -@all +ping +quit +client|kill'",
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
    [
      ['ApiDatabaseAReadable', 'ApiDatabaseCredentialASecret'],
      ['ApiDatabaseBReadable', 'ApiDatabaseCredentialBSecret'],
      ['RedisApiAEnabled', 'RedisApiASecret'],
      ['RedisApiBEnabled', 'RedisApiBSecret'],
    ],
  );
  const expectedWorker = expectedExecutionRoleBlock(
    'WorkerTaskExecutionRole',
    'PullWorkerImage',
    'WorkerImageRepositoryArn',
    'WriteWorkerLogs',
    'WorkerLogGroupArn',
    'ReadWorkerRuntimeSecrets',
    [
      ['WorkerDatabaseAReadable', 'WorkerDatabaseCredentialASecret'],
      ['WorkerDatabaseBReadable', 'WorkerDatabaseCredentialBSecret'],
    ],
  );
  if ((resources.get('ApiTaskExecutionRole') ?? '') !== expectedApi) {
    errors.push('ApiTaskExecutionRole must retain the exact API log and runtime-secret matrix.');
  }
  if ((resources.get('WorkerTaskExecutionRole') ?? '') !== expectedWorker) {
    errors.push(
      'WorkerTaskExecutionRole must retain the exact worker log and runtime-secret matrix.',
    );
  }
  const operator = resources.get('RedisOperatorTaskExecutionRole') ?? '';
  if (operator !== expectedRedisOperatorExecutionRoleBlock()) {
    errors.push(
      'RedisOperatorTaskExecutionRole must be conditional and read only its scoped operator secret.',
    );
  }

  const roles = `${resources.get('ApiTaskExecutionRole') ?? ''}\n${resources.get('WorkerTaskExecutionRole') ?? ''}`;
  if (/MigrationDatabaseCredentialSecret|crypto_migration|admin/iu.test(roles)) {
    errors.push('Long-lived execution roles must not read migration/admin credentials.');
  }
  const worker = resources.get('WorkerTaskExecutionRole') ?? '';
  if (/RedisApi|crypto_api_/iu.test(worker)) {
    errors.push('WorkerTaskExecutionRole must not read Redis credentials.');
  }
  if (
    /ApiDatabaseCredential|WorkerDatabaseCredential|MigrationDatabaseCredential|RedisApi[AB]Secret/iu.test(
      operator,
    )
  ) {
    errors.push('Redis operator execution must not read application or migration credentials.');
  }
  if (/ManagedPolicyArns:/u.test(roles)) {
    errors.push('Execution roles must not attach externally mutable managed policies.');
  }
  const registryAuthorization = [
    '                Action: ecr:GetAuthorizationToken',
    "                Resource: '*'",
  ].join('\n');
  if (roles.split(registryAuthorization).length - 1 !== 2) {
    errors.push(
      'Each execution role must contain the one AWS-required ECR authorization wildcard.',
    );
  }
  const rolesWithoutRequiredEcrWildcard = roles.replaceAll(registryAuthorization, '');
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
    const actualType = resources.get(logicalId)?.match(/^    Type:\s*(\S+)$/mu)?.[1];
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
