#!/usr/bin/env node

/**
 * Local-only validation for the standalone dormant balance-consumer envelope.
 * This module performs filesystem and string operations only. It never loads an
 * AWS SDK, invokes a provider CLI, resolves credentials, or performs network I/O.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultTemplatePath = join(scriptDirectory, 'balance-consumer-deployment-envelope.yaml');
const directUploadLimitBytes = 51_200;
const reviewedTemplateSha256 = '91b9129ea24a8c9abd8baa66d411d231eba84e417a80d066f1bd0fc819bd7685';

const residualLimitations = Object.freeze([
  'UNCOMPOSED_SOURCE_ONLY: release and preflight controls only bind and inspect this source; no application parent template or deployment target composes or provisions it.',
  'HARD_ZERO_AND_NO_EGRESS: the ECS service has a literal desired count of zero and its dedicated security group has no external egress path, so this source cannot run the consumer.',
  'NON_PRODUCTION_ONLY: EnvironmentName accepts only dev, test, qa, sandbox, or staging families, and deployment still requires explicit billing acknowledgement.',
  'ACTIVATION_GATES_UNRESOLVED: source activation, runtime composition, database grants and credentials, metadata-only secret custody, mainnet RPC egress, operational ownership, and deployed evidence remain absent.',
]);

const expectedParameters = new Map([
  ['BillingAcknowledgement', 'String'],
  ['EnvironmentName', 'String'],
  ['VpcId', 'AWS::EC2::VPC::Id'],
  ['PrivateSubnetAId', 'AWS::EC2::Subnet::Id'],
  ['PrivateSubnetBId', 'AWS::EC2::Subnet::Id'],
  ['ApplicationDataKeyId', 'String'],
  ['ApplicationLogsKeyId', 'String'],
  ['ApiImageDigest', 'String'],
  ['SqsMaxReceiveCount', 'Number'],
  ['SqsVisibilityTimeoutSeconds', 'Number'],
  ['LogRetentionDays', 'Number'],
]);

const expectedResources = new Map([
  ['BalanceConsumerLogGroup', 'AWS::Logs::LogGroup'],
  ['BalanceConsumerTaskSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['BalanceConsumerTaskExecutionRole', 'AWS::IAM::Role'],
  ['BalanceConsumerTaskRole', 'AWS::IAM::Role'],
  ['BalanceConsumerTaskDefinition', 'AWS::ECS::TaskDefinition'],
  ['BalanceConsumerService', 'AWS::ECS::Service'],
]);

const expectedOutputs = new Map([
  ['BalanceConsumerLogGroupName', '!Ref BalanceConsumerLogGroup'],
  ['BalanceConsumerTaskSecurityGroupId', '!Ref BalanceConsumerTaskSecurityGroup'],
  ['BalanceConsumerTaskExecutionRoleArn', '!GetAtt BalanceConsumerTaskExecutionRole.Arn'],
  ['BalanceConsumerTaskRoleArn', '!GetAtt BalanceConsumerTaskRole.Arn'],
  ['BalanceConsumerTaskDefinitionArn', '!Ref BalanceConsumerTaskDefinition'],
  ['BalanceConsumerServiceArn', '!Ref BalanceConsumerService'],
]);

function normalize(value) {
  if (typeof value !== 'string') return '';
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function section(source, start, end) {
  const startMarker = `${start}:\n`;
  const startIndex = source.indexOf(startMarker);
  if (startIndex < 0) return '';
  const contentStart = startIndex + startMarker.length;
  if (!end) return source.slice(contentStart);
  const endIndex = source.indexOf(`\n${end}:\n`, contentStart);
  return endIndex < 0 ? '' : source.slice(contentStart, endIndex + 1);
}

function parseBlocks(value) {
  const blocks = new Map();
  const matches = [...value.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*$/gmu)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = match[1];
    if (!name || match.index === undefined) continue;
    const end = matches[index + 1]?.index ?? value.length;
    blocks.set(name, value.slice(match.index, end).trimEnd());
  }
  return blocks;
}

function requireExactIds(actual, expected, label, errors) {
  for (const id of expected.keys()) {
    if (!actual.has(id)) errors.push(`${label} is missing ${id}.`);
  }
  for (const id of actual.keys()) {
    if (!expected.has(id)) errors.push(`${label} contains unreviewed entry ${id}.`);
  }
}

function requireProperty(block, logicalId, name, expected, errors) {
  const values = [
    ...block.matchAll(
      new RegExp(`^\\s+${name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:\\s*(.+?)\\s*$`, 'gmu'),
    ),
  ].map((match) => match[1]);
  if (values.length !== 1 || values[0] !== expected) {
    errors.push(`${logicalId} must bind exactly one ${name}: ${expected}.`);
  }
}

function validateParameters(source, errors) {
  const parameters = parseBlocks(section(source, 'Parameters', 'Rules'));
  requireExactIds(parameters, expectedParameters, 'Parameter allowlist', errors);
  for (const [name, type] of expectedParameters) {
    requireProperty(parameters.get(name) ?? '', name, 'Type', type, errors);
  }

  const billing = parameters.get('BillingAcknowledgement') ?? '';
  requireProperty(billing, 'BillingAcknowledgement', 'Default', 'NOT_AUTHORIZED', errors);
  requireProperty(
    billing,
    'BillingAcknowledgement',
    'AllowedValues',
    '[NOT_AUTHORIZED, I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES]',
    errors,
  );
  const environment = parameters.get('EnvironmentName') ?? '';
  requireProperty(environment, 'EnvironmentName', 'MaxLength', '31', errors);
  requireProperty(
    environment,
    'EnvironmentName',
    'AllowedPattern',
    "'^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
    errors,
  );
  if (/^\s+Default:/mu.test(environment)) {
    errors.push('EnvironmentName must be explicit and must not default to any environment.');
  }

  const kmsKeyIdPattern = "'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'";
  for (const name of ['ApplicationDataKeyId', 'ApplicationLogsKeyId']) {
    requireProperty(parameters.get(name) ?? '', name, 'AllowedPattern', kmsKeyIdPattern, errors);
  }
  requireProperty(
    parameters.get('ApiImageDigest') ?? '',
    'ApiImageDigest',
    'AllowedPattern',
    "'^[a-f0-9]{64}$'",
    errors,
  );
  for (const [name, defaultValue, minimum, maximum] of [
    ['SqsMaxReceiveCount', '3', '1', '100'],
    ['SqsVisibilityTimeoutSeconds', '30', '1', '43200'],
  ]) {
    const block = parameters.get(name) ?? '';
    requireProperty(block, name, 'Default', defaultValue, errors);
    requireProperty(block, name, 'MinValue', minimum, errors);
    requireProperty(block, name, 'MaxValue', maximum, errors);
  }
  requireProperty(
    parameters.get('LogRetentionDays') ?? '',
    'LogRetentionDays',
    'Default',
    '14',
    errors,
  );
  requireProperty(
    parameters.get('LogRetentionDays') ?? '',
    'LogRetentionDays',
    'AllowedValues',
    '[1, 3, 5, 7, 14, 30, 60, 90]',
    errors,
  );
}

function validateRules(source, errors) {
  const rules = parseBlocks(section(source, 'Rules', 'Resources'));
  const expected = new Map([
    ['ExplicitBillingAcknowledgementRequired', ''],
    ['PrivateSubnetsMustBeDistinct', ''],
    ['DataAndLogsKeysMustBeDistinct', ''],
  ]);
  requireExactIds(rules, expected, 'Rule allowlist', errors);
  const billing = rules.get('ExplicitBillingAcknowledgementRequired') ?? '';
  if (
    !billing.includes('- !Ref BillingAcknowledgement') ||
    !billing.includes('- I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES')
  ) {
    errors.push('Deployment must require the exact explicit billable-resource acknowledgement.');
  }
  const subnets = rules.get('PrivateSubnetsMustBeDistinct') ?? '';
  if (
    !subnets.includes('- Assert: !Not [!Equals [!Ref PrivateSubnetAId, !Ref PrivateSubnetBId]]')
  ) {
    errors.push('The template must reject identical private subnet identifiers.');
  }
  const keys = rules.get('DataAndLogsKeysMustBeDistinct') ?? '';
  if (
    !keys.includes(
      '- Assert: !Not [!Equals [!Ref ApplicationDataKeyId, !Ref ApplicationLogsKeyId]]',
    )
  ) {
    errors.push('The template must keep application data and log encryption keys distinct.');
  }
}

function validateResourceInventory(source, errors) {
  const resources = parseBlocks(section(source, 'Resources', 'Outputs'));
  requireExactIds(resources, expectedResources, 'Resource allowlist', errors);
  for (const [logicalId, type] of expectedResources) {
    requireProperty(resources.get(logicalId) ?? '', logicalId, 'Type', type, errors);
  }
  return resources;
}

function validateNetwork(resources, source, errors) {
  const securityGroup = resources.get('BalanceConsumerTaskSecurityGroup') ?? '';
  requireProperty(
    securityGroup,
    'BalanceConsumerTaskSecurityGroup',
    'SecurityGroupEgress',
    "[{ CidrIp: 127.0.0.1/32, IpProtocol: '-1' }]",
    errors,
  );
  requireProperty(securityGroup, 'BalanceConsumerTaskSecurityGroup', 'VpcId', '!Ref VpcId', errors);
  if (/SecurityGroupIngress:/u.test(securityGroup)) {
    errors.push('BalanceConsumerTaskSecurityGroup must not declare ingress.');
  }
  if (
    /Type:\s*AWS::EC2::SecurityGroup(?:Egress|Ingress)/u.test(source) ||
    /(?:0\.0\.0\.0\/0|::\/0)/u.test(source)
  ) {
    errors.push('The dormant envelope must not declare any external or broad network rule.');
  }
}

function exactActionCount(block, action) {
  const escaped = action.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return (
    block.match(new RegExp(`(?:^|[^A-Za-z0-9:*])${escaped}(?=$|[^A-Za-z0-9:*])`, 'gmu')) ?? []
  ).length;
}

function policyActionTokens(block) {
  return [...block.matchAll(/\b([a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9*]*)\b/gu)]
    .map((match) => match[1])
    .filter((token) => token !== 'kms:ViaService' && !token.startsWith('aws:'))
    .sort();
}

function hasExactPolicyActions(block, expected) {
  return policyActionTokens(block).join('|') === [...expected].sort().join('|');
}

function validateIam(resources, errors) {
  const execution = resources.get('BalanceConsumerTaskExecutionRole') ?? '';
  const task = resources.get('BalanceConsumerTaskRole') ?? '';
  const trustTokens = [
    'Principal: { Service: ecs-tasks.amazonaws.com }',
    'Action: sts:AssumeRole',
    'StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    "aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'",
  ];
  for (const [logicalId, block] of [
    ['BalanceConsumerTaskExecutionRole', execution],
    ['BalanceConsumerTaskRole', task],
  ]) {
    for (const token of trustTokens) {
      if (block.split(token).length - 1 !== 1) {
        errors.push(`${logicalId} must retain the exact same-account regional ECS task trust.`);
        break;
      }
    }
    if (/ManagedPolicyArns:/u.test(block)) {
      errors.push(`${logicalId} must not attach an externally mutable managed policy.`);
    }
  }

  for (const action of [
    'ecr:GetAuthorizationToken',
    'ecr:BatchCheckLayerAvailability',
    'ecr:BatchGetImage',
    'ecr:GetDownloadUrlForLayer',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ]) {
    if (exactActionCount(execution, action) !== 1) {
      errors.push(`BalanceConsumerTaskExecutionRole must grant exactly one ${action}.`);
    }
  }
  if (
    !execution.includes(
      'Resource: !Sub arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/crypto-lending-api',
    ) ||
    !execution.includes(
      'Resource: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/crypto-lending/${EnvironmentName}/balance-consumer:*',
    )
  ) {
    errors.push('BalanceConsumerTaskExecutionRole must scope image pull and log writes exactly.');
  }
  const registryWildcard = ['Action: ecr:GetAuthorizationToken', "Resource: '*'"].join(
    '\n                ',
  );
  if (
    execution.split("Resource: '*'").length - 1 !== 1 ||
    !execution.includes(registryWildcard) ||
    /(?:sqs:|kms:|secretsmanager:)/iu.test(execution) ||
    !hasExactPolicyActions(execution, [
      'sts:AssumeRole',
      'ecr:GetAuthorizationToken',
      'ecr:BatchCheckLayerAvailability',
      'ecr:BatchGetImage',
      'ecr:GetDownloadUrlForLayer',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
    ])
  ) {
    errors.push(
      'BalanceConsumerTaskExecutionRole must be image-pull/log-only with only the ECR authorization wildcard.',
    );
  }

  for (const action of [
    'sqs:ReceiveMessage',
    'sqs:DeleteMessage',
    'sqs:ChangeMessageVisibility',
    'kms:Decrypt',
  ]) {
    if (exactActionCount(task, action) !== 1) {
      errors.push(`BalanceConsumerTaskRole must grant exactly one ${action}.`);
    }
  }
  if (
    !task.includes(
      'Resource: !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-balance-sync',
    ) ||
    !task.includes(
      'Resource: !Sub arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/${ApplicationDataKeyId}',
    ) ||
    !task.includes('kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}')
  ) {
    errors.push(
      'BalanceConsumerTaskRole must bind the exact source queue and SQS-only data-key use.',
    );
  }
  if (
    /(?:SendMessage|GetQueueAttributes|DeadLetter|jobs|balance-sync-dlq|secretsmanager:|ecr:|logs:)/iu.test(
      task,
    ) ||
    /Action:\s*(?:\[[^\]]*\*|['"]?[^\s'"]*\*)/u.test(task) ||
    /Resource:\s*(?:\[[^\]]*\*|['"]?\*)/u.test(task) ||
    !hasExactPolicyActions(task, [
      'sts:AssumeRole',
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:ChangeMessageVisibility',
      'kms:Decrypt',
    ])
  ) {
    errors.push(
      'BalanceConsumerTaskRole must have only exact source receive/delete/change-visibility and SQS-scoped decrypt authority.',
    );
  }
}

function environmentNames(taskDefinition) {
  const environment =
    taskDefinition.match(/\n\s+Environment:\n([\s\S]*?)\n\s+LinuxParameters:/u)?.[1] ?? '';
  return [...environment.matchAll(/\bName:\s*([A-Z][A-Z0-9_]*)\b/gu)].map((match) => match[1]);
}

function validateTaskDefinition(resources, errors) {
  const task = resources.get('BalanceConsumerTaskDefinition') ?? '';
  for (const [name, value] of [
    [
      'Image',
      '!Sub ${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/crypto-lending-api@sha256:${ApiImageDigest}',
    ],
    ['ExecutionRoleArn', '!GetAtt BalanceConsumerTaskExecutionRole.Arn'],
    ['TaskRoleArn', '!GetAtt BalanceConsumerTaskRole.Arn'],
    ['NetworkMode', 'awsvpc'],
    ['ReadonlyRootFilesystem', 'true'],
    ['User', "'10001:10001'"],
  ]) {
    requireProperty(task, 'BalanceConsumerTaskDefinition', name, value, errors);
  }
  if (
    !task.includes(
      'Command: [node, dist/blockchain-sync/application/balance-sync-consumer.cli.js]',
    ) ||
    !task.includes('Capabilities: { Drop: [ALL] }') ||
    !task.includes('RequiresCompatibilities: [FARGATE]')
  ) {
    errors.push(
      'BalanceConsumerTaskDefinition must retain its exact CLI and hardened Fargate contract.',
    );
  }

  const names = environmentNames(task);
  const expectedNames = [
    'NODE_ENV',
    'APP_ENV',
    'APPLICATION_WORKLOAD',
    'BALANCE_CONSUMER_MODE',
    'BALANCE_CONSUMER_NETWORK',
    'BALANCE_CONSUMER_SOURCE_APPROVAL',
    'AWS_REGION',
    'SQS_BALANCE_QUEUE_URL',
    'SQS_BALANCE_DEAD_LETTER_QUEUE_URL',
    'SQS_MAX_RECEIVE_COUNT',
    'SQS_VISIBILITY_TIMEOUT_SECONDS',
  ];
  if (
    names.length !== expectedNames.length ||
    expectedNames.some((name) => names.filter((actual) => actual === name).length !== 1)
  ) {
    errors.push(
      'BalanceConsumerTaskDefinition must receive only the eleven reviewed nonsecret settings.',
    );
  }
  const taskLines = task.split('\n').map((line) => line.trim());
  for (const token of [
    '- { Name: NODE_ENV, Value: production }',
    '- { Name: APP_ENV, Value: !Ref EnvironmentName }',
    '- { Name: APPLICATION_WORKLOAD, Value: balance-consumer }',
    '- { Name: BALANCE_CONSUMER_MODE, Value: disabled }',
    '- { Name: BALANCE_CONSUMER_NETWORK, Value: ethereum-solana-mainnet }',
    '- { Name: BALANCE_CONSUMER_SOURCE_APPROVAL, Value: ethereum-solana-mainnet-reviewed }',
    '- { Name: AWS_REGION, Value: !Ref AWS::Region }',
    'Value: !Sub https://sqs.${AWS::Region}.${AWS::URLSuffix}/${AWS::AccountId}/crypto-lending-${EnvironmentName}-balance-sync',
    'Value: !Sub https://sqs.${AWS::Region}.${AWS::URLSuffix}/${AWS::AccountId}/crypto-lending-${EnvironmentName}-balance-sync-dlq',
    '- { Name: SQS_MAX_RECEIVE_COUNT, Value: !Ref SqsMaxReceiveCount }',
    '- { Name: SQS_VISIBILITY_TIMEOUT_SECONDS, Value: !Ref SqsVisibilityTimeoutSeconds }',
  ]) {
    if (taskLines.filter((line) => line === token).length !== 1) {
      errors.push(
        `BalanceConsumerTaskDefinition is missing or duplicates reviewed binding ${token}.`,
      );
    }
  }
  if (
    /^\s+Secrets:/mu.test(task) ||
    /\bName:\s*(?:SQS_QUEUE_URL|SQS_DEAD_LETTER_QUEUE_URL)\b/u.test(task) ||
    /\b(?:DATABASE|REDIS|AUTH|OIDC|WALLET|RPC|ETHEREUM|SOLANA|PROVIDER)_[A-Z0-9_]+\b/iu.test(task)
  ) {
    errors.push(
      'BalanceConsumerTaskDefinition must not receive generic queues, databases, Redis, auth/wallet, RPC/provider endpoints or credentials, or secret configuration.',
    );
  }
}

function validateService(resources, errors) {
  const service = resources.get('BalanceConsumerService') ?? '';
  for (const [name, value] of [
    [
      'Cluster',
      '!Sub arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:cluster/crypto-lending-${EnvironmentName}',
    ],
    ['DesiredCount', '0'],
    ['EnableExecuteCommand', 'false'],
    ['LaunchType', 'FARGATE'],
    ['AssignPublicIp', 'DISABLED'],
    ['SecurityGroups', '[!Ref BalanceConsumerTaskSecurityGroup]'],
    ['Subnets', '[!Ref PrivateSubnetAId, !Ref PrivateSubnetBId]'],
    ['PlatformVersion', '1.4.0'],
    ['TaskDefinition', '!Ref BalanceConsumerTaskDefinition'],
  ]) {
    requireProperty(service, 'BalanceConsumerService', name, value, errors);
  }
  for (const token of [
    'DeploymentCircuitBreaker:',
    'Enable: true',
    'Rollback: true',
    'MinimumHealthyPercent: 0',
    'ServiceName: balance-consumer',
  ]) {
    if (service.split(token).length - 1 !== 1) {
      errors.push(`BalanceConsumerService must retain exact dormant service token ${token}.`);
    }
  }
  if (/DesiredCount:\s*!|DesiredCount:\s*[1-9]|AssignPublicIp:\s*ENABLED/iu.test(service)) {
    errors.push('BalanceConsumerService must remain hard-zero with no public IP activation path.');
  }
}

function validateLogGroup(resources, errors) {
  const logGroup = resources.get('BalanceConsumerLogGroup') ?? '';
  for (const [name, value] of [
    ['DeletionPolicy', 'Retain'],
    ['UpdateReplacePolicy', 'Retain'],
    [
      'KmsKeyId',
      '!Sub arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/${ApplicationLogsKeyId}',
    ],
    ['LogGroupName', '!Sub /crypto-lending/${EnvironmentName}/balance-consumer'],
    ['RetentionInDays', '!Ref LogRetentionDays'],
  ]) {
    requireProperty(logGroup, 'BalanceConsumerLogGroup', name, value, errors);
  }
}

function validateOutputs(source, errors) {
  const outputs = parseBlocks(section(source, 'Outputs'));
  requireExactIds(outputs, expectedOutputs, 'Output allowlist', errors);
  for (const [name, value] of expectedOutputs) {
    requireProperty(outputs.get(name) ?? '', name, 'Value', value, errors);
  }
  if (/(?:Secret|Credential|Password|Token)/iu.test(section(source, 'Outputs'))) {
    errors.push('Envelope outputs must expose identifiers only, never secret material.');
  }
}

export function validateBalanceConsumerDeploymentEnvelopeSource(rawSource) {
  const input = typeof rawSource === 'string' ? rawSource : '';
  const source = normalize(input);
  const errors = [];
  const templateBytes = Buffer.byteLength(input, 'utf8');
  const templateSha256 = sha256(input);

  if (typeof rawSource !== 'string') {
    errors.push('Template source must be a string.');
  }

  if (!source.startsWith("AWSTemplateFormatVersion: '2010-09-09'\n")) {
    errors.push('Template must declare the reviewed CloudFormation format version.');
  }
  if (templateBytes > directUploadLimitBytes) {
    errors.push(`Template exceeds the ${directUploadLimitBytes}-byte direct-upload ceiling.`);
  }
  for (const heading of ['Parameters', 'Rules', 'Resources', 'Outputs']) {
    if ((source.match(new RegExp(`^${heading}:$`, 'gmu')) ?? []).length !== 1) {
      errors.push(`Template must declare exactly one ${heading} section.`);
    }
  }
  if (/^(?:Transform|Conditions):/mu.test(source)) {
    errors.push('The standalone dormant envelope must not use transforms, macros, or conditions.');
  }

  validateParameters(source, errors);
  validateRules(source, errors);
  const resources = validateResourceInventory(source, errors);
  validateNetwork(resources, source, errors);
  validateIam(resources, errors);
  validateTaskDefinition(resources, errors);
  validateService(resources, errors);
  validateLogGroup(resources, errors);
  validateOutputs(source, errors);

  if (templateSha256 !== reviewedTemplateSha256) {
    errors.push(
      `Template SHA-256 ${templateSha256} does not match reviewed dormant envelope ${reviewedTemplateSha256}.`,
    );
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    residualLimitations,
    templateBytes,
    templateSha256,
    reviewedTemplateSha256,
  });
}

function parseArguments(argv) {
  const options = { template: defaultTemplatePath, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--template') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--template requires a path.');
      if (
        /^(?:\\\\[.?]\\|\\\\|\/\/)/u.test(value) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)
      ) {
        throw new Error('--template requires a local filesystem path, not a URI or network path.');
      }
      options.template = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        [
          'Usage: node infra/aws/validate-balance-consumer-deployment-envelope.mjs [options]',
          '',
          'Options:',
          '  --template <path>  Dormant balance-consumer envelope path',
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
  return options;
}

function readLocalTemplate(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('Template path must identify a regular local file, not a symbolic link.');
  }
  return readFileSync(path, 'utf8');
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const result = validateBalanceConsumerDeploymentEnvelopeSource(
    readLocalTemplate(options.template),
  );
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `Dormant balance-consumer deployment envelope is valid (${result.templateSha256}).\n`,
    );
  } else {
    for (const error of result.errors) process.stderr.write(`ERROR: ${error}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
