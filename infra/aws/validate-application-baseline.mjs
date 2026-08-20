#!/usr/bin/env node

/**
 * KAN-34 local CloudFormation policy validation.
 *
 * This program deliberately uses only local filesystem APIs. It never loads an
 * AWS SDK, invokes the AWS CLI, resolves credentials, or performs network I/O.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');

function parseArguments(argv) {
  const options = {
    template: join(scriptDirectory, 'application-baseline.yaml'),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--json') {
      options.json = true;
      continue;
    }

    if (argument === '--template') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path.`);
      }

      options.template = resolve(value);
      index += 1;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        [
          'Usage: node infra/aws/validate-application-baseline.mjs [options]',
          '',
          'Options:',
          '  --template <path>      Application baseline template path',
          '  --json                 Emit machine-readable output',
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

function readRequiredFile(path, label, errors) {
  if (!existsSync(path)) {
    errors.push(`${label} does not exist: ${path}`);
    return '';
  }

  const info = statSync(path);
  if (!info.isFile()) {
    errors.push(`${label} is not a file: ${path}`);
    return '';
  }

  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function topLevelBlocks(source, sectionName) {
  const lines = source.split('\n');
  const sectionIndex = lines.findIndex(
    (line) => line.trimEnd() === `${sectionName}:` && !/^\s/.test(line),
  );

  if (sectionIndex < 0) {
    return new Map();
  }

  const blocks = new Map();
  let currentName;
  let currentLines = [];

  const saveCurrent = () => {
    if (currentName) {
      blocks.set(currentName, currentLines.join('\n'));
    }
  };

  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9]*:\s*(?:#.*)?$/.test(line)) {
      break;
    }

    const blockStart = line.match(/^  ([A-Za-z][A-Za-z0-9]*):\s*(?:#.*)?$/);
    if (blockStart) {
      saveCurrent();
      currentName = blockStart[1];
      currentLines = [line];
    } else if (currentName) {
      currentLines.push(line);
    }
  }

  saveCurrent();
  return blocks;
}

function resourceInventory(source) {
  const resources = topLevelBlocks(source, 'Resources');
  const inventory = new Map();

  for (const [logicalId, block] of resources) {
    const type = block.match(/^\s{4}Type:\s*['"]?([^\s'"]+)['"]?\s*(?:#.*)?$/m)?.[1];
    if (!type) {
      continue;
    }

    const entries = inventory.get(type) ?? [];
    entries.push({ logicalId, block });
    inventory.set(type, entries);
  }

  return { resources, inventory };
}

function entriesOf(inventory, type) {
  return inventory.get(type) ?? [];
}

function hasProperty(block, propertyName, expectedValue) {
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedValue = expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s+${escapedName}:\\s*['"]?${escapedValue}['"]?\\s*(?:#.*)?$`, 'mi').test(
    block,
  );
}

function hasPropertyName(block, propertyName) {
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s+${escapedName}:`, 'm').test(block);
}

function requireTypeCount(inventory, type, minimum, errors) {
  const count = entriesOf(inventory, type).length;
  if (count < minimum) {
    errors.push(`Expected at least ${minimum} ${type} resource(s); found ${count}.`);
  }
}

function requireProperties(entries, rules, errors) {
  for (const { logicalId, block } of entries) {
    for (const rule of rules) {
      const passed =
        rule.value === undefined
          ? hasPropertyName(block, rule.name)
          : hasProperty(block, rule.name, rule.value);
      if (!passed) {
        const expectation = rule.value === undefined ? 'to be present' : `to equal ${rule.value}`;
        errors.push(`${logicalId} requires ${rule.name} ${expectation}.`);
      }
    }
  }
}

function validateTemplateShape(source, errors) {
  const templateBytes = Buffer.byteLength(source, 'utf8');
  if (templateBytes > 51200) {
    errors.push(
      `Application template is ${templateBytes} bytes; keep it at or below the 51,200-byte direct-upload limit so validation/planning never stages it in S3.`,
    );
  }

  if (!/^AWSTemplateFormatVersion:\s*['"]?2010-09-09['"]?\s*$/m.test(source)) {
    errors.push('Application template must declare AWSTemplateFormatVersion 2010-09-09.');
  }

  const parameters = topLevelBlocks(source, 'Parameters');
  const sensitiveParameterName = /(password|credential|accesskey|secret(?:value|string)?|token)/i;
  for (const [name, block] of parameters) {
    if (!sensitiveParameterName.test(name)) {
      continue;
    }

    if (!hasProperty(block, 'NoEcho', 'true')) {
      errors.push(`Sensitive parameter ${name} must set NoEcho: true.`);
    }
    if (hasPropertyName(block, 'Default')) {
      errors.push(`Sensitive parameter ${name} must not have a default value.`);
    }
  }

  const billingAcknowledgement = parameters.get('BillingAcknowledgement');
  if (!billingAcknowledgement) {
    errors.push(
      'BillingAcknowledgement parameter is required as an in-template fail-closed cost guard.',
    );
  } else {
    if (!hasProperty(billingAcknowledgement, 'Default', 'NOT_AUTHORIZED')) {
      errors.push('BillingAcknowledgement must default to NOT_AUTHORIZED.');
    }
    if (!billingAcknowledgement.includes('I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES')) {
      errors.push(
        'BillingAcknowledgement must expose the explicit billable-resource acknowledgement value.',
      );
    }
  }
  if (
    !/Rules:[\s\S]*BillingAcknowledgement[\s\S]*I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES/.test(
      source,
    )
  ) {
    errors.push('A CloudFormation Rule must reject an unacknowledged billable stack plan.');
  }

  const certificateParameter = parameters.get('AlbCertificateArn');
  if (!certificateParameter) {
    errors.push('AlbCertificateArn is required to enforce TLS at the load balancer.');
  } else {
    if (hasPropertyName(certificateParameter, 'Default')) {
      errors.push('AlbCertificateArn must not default to an empty/plaintext deployment.');
    }
    if (
      !/AllowedPattern:[^\n]*acm:/.test(certificateParameter) ||
      /AllowedPattern:[^\n]*\^\$\|/.test(certificateParameter)
    ) {
      errors.push('AlbCertificateArn must accept only an explicit ACM certificate ARN.');
    }
  }

  const ingressCidrParameter = parameters.get('AllowedIngressIpv4Cidr') ?? '';
  if (
    !/AllowedPattern:[^\n]*\/\(\?:\[1-9\]\|\[12\]\[0-9\]\|3\[0-2\]\)\$/.test(ingressCidrParameter)
  ) {
    errors.push('AllowedIngressIpv4Cidr must prohibit every IPv4 /0 representation.');
  }

  const desiredCountParameters = [...parameters].filter(([name]) => /DesiredCount$/i.test(name));
  if (desiredCountParameters.length === 0) {
    errors.push('At least one ECS DesiredCount parameter is required and must default to zero.');
  }
  for (const [name, block] of desiredCountParameters) {
    if (!hasProperty(block, 'Default', '0')) {
      errors.push(
        `${name} must default to 0 so the baseline does not start application tasks by default.`,
      );
    }
  }

  for (const name of ['ApiImageUri', 'WebImageUri', 'WorkerImageUri']) {
    const block = parameters.get(name);
    if (!block) {
      errors.push(`Immutable deployment parameter ${name} is required.`);
      continue;
    }
    const allowedPattern = block.match(/^\s+AllowedPattern:\s*['"]?(.+?)['"]?\s*$/m)?.[1] ?? '';
    if (
      !allowedPattern.includes('ecr') ||
      !allowedPattern.includes('@sha256:') ||
      !allowedPattern.includes('{64}')
    ) {
      errors.push(
        `${name} must only accept a full ECR URI pinned to a 64-character sha256 digest.`,
      );
    }
    if (hasPropertyName(block, 'Default')) {
      errors.push(`${name} must be supplied explicitly and must not have a mutable default image.`);
    }
  }

  const { resources, inventory } = resourceInventory(source);
  if (resources.size === 0) {
    errors.push('Application template must contain a non-empty Resources section.');
    return;
  }

  const requiredTypes = new Map([
    ['AWS::EC2::VPC', 1],
    ['AWS::EC2::Subnet', 4],
    ['AWS::EC2::SecurityGroup', 4],
    ['AWS::ElasticLoadBalancingV2::LoadBalancer', 1],
    ['AWS::ElasticLoadBalancingV2::TargetGroup', 2],
    ['AWS::ElasticLoadBalancingV2::Listener', 2],
    ['AWS::ECS::Cluster', 1],
    ['AWS::ECS::TaskDefinition', 3],
    ['AWS::ECS::Service', 3],
    ['AWS::RDS::DBInstance', 1],
    ['AWS::RDS::DBSubnetGroup', 1],
    ['AWS::ElastiCache::ReplicationGroup', 1],
    ['AWS::ElastiCache::SubnetGroup', 1],
    ['AWS::KMS::Key', 2],
    ['AWS::SecretsManager::Secret', 1],
    ['AWS::Logs::LogGroup', 3],
    ['AWS::IAM::Role', 4],
    ['AWS::CloudWatch::Alarm', 1],
    ['AWS::CloudWatch::Dashboard', 1],
    ['AWS::SQS::Queue', 2],
    ['AWS::EC2::VPCEndpoint', 6],
  ]);

  for (const [type, minimum] of requiredTypes) {
    requireTypeCount(inventory, type, minimum, errors);
  }

  if (entriesOf(inventory, 'AWS::EC2::NatGateway').length > 0) {
    errors.push('NAT gateways are prohibited; private tasks must use the required VPC endpoints.');
  }

  for (const { logicalId, block } of entriesOf(inventory, 'AWS::EC2::SecurityGroup')) {
    if (
      !/SecurityGroupEgress:\s*\[\{\s*CidrIp:\s*127\.0\.0\.1\/32,\s*IpProtocol:\s*['"]-1['"]\s*\}\]/m.test(
        block,
      )
    ) {
      errors.push(
        `${logicalId} must declare the localhost sentinel inline so CloudFormation removes default allow-all egress before adding scoped standalone rules.`,
      );
    }
    if (/(?:0\.0\.0\.0\/0|::\/0)/.test(block.match(/SecurityGroupEgress:[\s\S]*/)?.[0] ?? '')) {
      errors.push(`${logicalId} must not contain broad inline egress.`);
    }
  }
  for (const { logicalId, block } of entriesOf(inventory, 'AWS::EC2::SecurityGroupEgress')) {
    if (/(?:0\.0\.0\.0\/0|::\/0)/.test(block)) {
      errors.push(`${logicalId} must not allow broad standalone egress.`);
    }
  }

  const endpointSource = entriesOf(inventory, 'AWS::EC2::VPCEndpoint')
    .map(({ block }) => block)
    .join('\n');
  for (const service of ['ecr.api', 'ecr.dkr', 'logs', 'secretsmanager', 'sqs', 's3']) {
    if (
      !new RegExp(`ServiceName:[^\\n]*\\.${service.replace('.', '\\.')}(?:\\s|$)`).test(
        endpointSource,
      )
    ) {
      errors.push(`Private networking requires the regional ${service} VPC endpoint.`);
    }
  }

  requireProperties(
    entriesOf(inventory, 'AWS::EC2::VPC'),
    [
      { name: 'EnableDnsHostnames', value: 'true' },
      { name: 'EnableDnsSupport', value: 'true' },
    ],
    errors,
  );

  const queues = entriesOf(inventory, 'AWS::SQS::Queue');
  requireProperties(queues, [{ name: 'KmsMasterKeyId' }], errors);
  for (const { logicalId, block } of queues) {
    if (/KmsMasterKeyId:\s*alias\/aws\/sqs/i.test(block)) {
      errors.push(`${logicalId} must use the baseline customer-managed data KMS key.`);
    }
  }
  if (!queues.some(({ block }) => hasPropertyName(block, 'RedrivePolicy'))) {
    errors.push('The application job queue must define a dead-letter redrive policy.');
  }
  if (!queues.some(({ block }) => hasPropertyName(block, 'RedriveAllowPolicy'))) {
    errors.push('The dead-letter queue must restrict which source queue may redrive messages.');
  }

  const taskDefinitionSource = entriesOf(inventory, 'AWS::ECS::TaskDefinition')
    .map(({ block }) => block)
    .join('\n');
  if (!/!Ref\s+JobQueue\b/.test(taskDefinitionSource)) {
    errors.push('An ECS task definition must receive the in-template JobQueue URL by !Ref.');
  }
  if (!/Name:\s*(?:NODE_EXTRA_CA_CERTS|DATABASE_SSL_CA_PATH)\b/.test(taskDefinitionSource)) {
    errors.push('The API task must identify its current AWS RDS CA trust bundle path.');
  }
  if (
    !/Name:\s*DATABASE_SSL_MODE\b[\s\S]{0,160}?Value:\s*['"]?verify-full['"]?/i.test(
      taskDefinitionSource,
    )
  ) {
    errors.push(
      'The API task must enforce PostgreSQL certificate and hostname verification (verify-full).',
    );
  }
  if (
    !/Name:\s*APP_VERSION\b[\s\S]{0,120}?Value:\s*!Ref\s+ApplicationVersion/.test(
      taskDefinitionSource,
    )
  ) {
    errors.push(
      'The web task must receive ApplicationVersion through a server-only runtime variable.',
    );
  }

  const workerTaskDefinition = resources.get('WorkerTaskDefinition') ?? '';
  if (
    !/HealthCheck:[\s\S]*outbox-worker-health\.cli\.js/.test(workerTaskDefinition) ||
    !hasProperty(workerTaskDefinition, 'Retries', '3')
  ) {
    errors.push('WorkerTaskDefinition must run the dependency-aware worker health command.');
  }

  const apiTargetGroup = resources.get('ApiTargetGroup') ?? '';
  if (!hasProperty(apiTargetGroup, 'HealthCheckPath', '/api/v1/health/dependencies')) {
    errors.push('ApiTargetGroup must gate traffic on dependency and migration readiness.');
  }

  const workerTaskRole = resources.get('WorkerTaskRole') ?? '';
  if (!/sqs:GetQueueAttributes/.test(workerTaskRole) || !/sqs:SendMessage/.test(workerTaskRole)) {
    errors.push('WorkerTaskRole must support exact queue readiness and publishing operations.');
  }

  const privateSubnets = entriesOf(inventory, 'AWS::EC2::Subnet').filter(
    ({ logicalId, block }) => /private/i.test(logicalId) || /private/i.test(block),
  );
  if (privateSubnets.length < 2) {
    errors.push(
      'At least two subnets must be clearly identified as private across availability zones.',
    );
  }
  requireProperties(privateSubnets, [{ name: 'MapPublicIpOnLaunch', value: 'false' }], errors);

  const loadBalancers = entriesOf(inventory, 'AWS::ElasticLoadBalancingV2::LoadBalancer');
  requireProperties(loadBalancers, [{ name: 'Type', value: 'application' }], errors);

  const listeners = entriesOf(inventory, 'AWS::ElasticLoadBalancingV2::Listener');
  if (
    !listeners.some(
      ({ block }) =>
        hasProperty(block, 'Protocol', 'HTTPS') && hasPropertyName(block, 'Certificates'),
    )
  ) {
    errors.push('An HTTPS load-balancer listener with an explicit certificate is required.');
  }
  if (
    !listeners.some(
      ({ block }) =>
        hasProperty(block, 'Protocol', 'HTTP') &&
        /Type:\s*redirect/i.test(block) &&
        /RedirectConfig:/m.test(block),
    )
  ) {
    errors.push('An HTTP listener that redirects to HTTPS is required.');
  }

  const httpsListener = resources.get('HttpsListener') ?? '';
  if (
    !/Type:\s*fixed-response/.test(httpsListener) ||
    !hasProperty(httpsListener, 'StatusCode', '404')
  ) {
    errors.push('The HTTPS listener must reject unmatched hostnames with a fixed 404 response.');
  }
  const listenerRules = entriesOf(inventory, 'AWS::ElasticLoadBalancingV2::ListenerRule');
  if (
    listenerRules.length < 2 ||
    listenerRules.some(
      ({ block }) => !/HostHeaderConfig:[\s\S]*!Ref\s+ApplicationHostname/.test(block),
    )
  ) {
    errors.push('Every HTTPS forwarding rule must require the approved ApplicationHostname.');
  }

  requireProperties(
    entriesOf(inventory, 'AWS::ECS::TaskDefinition'),
    [
      { name: 'NetworkMode', value: 'awsvpc' },
      { name: 'ExecutionRoleArn' },
      { name: 'TaskRoleArn' },
      { name: 'LogConfiguration' },
      { name: 'ReadonlyRootFilesystem', value: 'true' },
      { name: 'User', value: '10001:10001' },
    ],
    errors,
  );

  for (const { logicalId, block } of entriesOf(inventory, 'AWS::ECS::TaskDefinition')) {
    if (!/RequiresCompatibilities:\s*\n(?:\s+-.*\n)*\s+-\s*FARGATE\s*$/m.test(block)) {
      errors.push(`${logicalId} must require FARGATE compatibility.`);
    }
    if (!/Capabilities:\s*\{\s*Drop:\s*\[ALL\]\s*\}/m.test(block)) {
      errors.push(`${logicalId} must drop all Linux capabilities.`);
    }

    const executionRole = block.match(/^\s+ExecutionRoleArn:\s*(.+?)\s*$/m)?.[1];
    const taskRole = block.match(/^\s+TaskRoleArn:\s*(.+?)\s*$/m)?.[1];
    if (executionRole && taskRole && executionRole === taskRole) {
      errors.push(`${logicalId} must use separate execution and application task roles.`);
    }
  }

  requireProperties(
    entriesOf(inventory, 'AWS::ECS::Service'),
    [
      { name: 'DesiredCount' },
      { name: 'AssignPublicIp', value: 'DISABLED' },
      { name: 'SecurityGroups' },
      { name: 'Subnets' },
      { name: 'DeploymentCircuitBreaker' },
      { name: 'Enable', value: 'true' },
      { name: 'Rollback', value: 'true' },
    ],
    errors,
  );

  for (const { logicalId, block } of entriesOf(inventory, 'AWS::ECS::Service')) {
    if (!/private/i.test(block)) {
      errors.push(`${logicalId} must place Fargate tasks in explicitly private subnets.`);
    }
  }

  requireProperties(
    entriesOf(inventory, 'AWS::RDS::DBInstance'),
    [
      { name: 'Engine', value: 'postgres' },
      { name: 'PubliclyAccessible', value: 'false' },
      { name: 'StorageEncrypted', value: 'true' },
      { name: 'KmsKeyId' },
      { name: 'DBSubnetGroupName' },
      { name: 'VPCSecurityGroups' },
    ],
    errors,
  );

  for (const { logicalId, block } of entriesOf(inventory, 'AWS::RDS::DBInstance')) {
    if (hasProperty(block, 'EnableIAMDatabaseAuthentication', 'true')) {
      errors.push(
        `${logicalId} must not enable memory-intensive IAM database authentication until runtime token auth is implemented.`,
      );
    }
    if (!/DeletionPolicy:\s*(?:Snapshot|Retain)/m.test(block)) {
      errors.push(`${logicalId} must retain or snapshot data when deleted.`);
    }
    if (!/UpdateReplacePolicy:\s*(?:Snapshot|Retain)/m.test(block)) {
      errors.push(`${logicalId} must retain or snapshot data when replaced.`);
    }
    if (
      !/\{\{resolve:secretsmanager:/i.test(block) &&
      !hasProperty(block, 'ManageMasterUserPassword', 'true')
    ) {
      errors.push(`${logicalId} must obtain its master password from Secrets Manager.`);
    }
  }

  requireProperties(
    entriesOf(inventory, 'AWS::ElastiCache::ReplicationGroup'),
    [
      { name: 'AtRestEncryptionEnabled', value: 'true' },
      { name: 'TransitEncryptionEnabled', value: 'true' },
      { name: 'CacheSubnetGroupName' },
      { name: 'SecurityGroupIds' },
    ],
    errors,
  );

  for (const { logicalId, block } of entriesOf(inventory, 'AWS::ElastiCache::ReplicationGroup')) {
    if (
      !hasPropertyName(block, 'AuthToken') &&
      !hasProperty(block, 'TransitEncryptionMode', 'required')
    ) {
      errors.push(`${logicalId} must enforce authenticated or required-mode TLS connections.`);
    }
    if (!/DeletionPolicy:\s*(?:Snapshot|Retain)/m.test(block)) {
      errors.push(`${logicalId} must retain or snapshot cache data when deleted.`);
    }
    if (!/UpdateReplacePolicy:\s*(?:Snapshot|Retain)/m.test(block)) {
      errors.push(`${logicalId} must retain or snapshot cache data when replaced.`);
    }
  }

  requireProperties(
    entriesOf(inventory, 'AWS::KMS::Key'),
    [{ name: 'EnableKeyRotation', value: 'true' }],
    errors,
  );
  requireProperties(
    entriesOf(inventory, 'AWS::SecretsManager::Secret'),
    [{ name: 'GenerateSecretString' }, { name: 'KmsKeyId' }],
    errors,
  );
  const databaseSecret = resources.get('DatabaseCredentialsSecret') ?? '';
  const databaseUsername = databaseSecret.match(/"username":"([A-Za-z][A-Za-z0-9_]*)"/)?.[1];
  if (!databaseUsername || databaseUsername.length > 16) {
    errors.push('DatabaseCredentialsSecret username must satisfy the RDS 1-16 character limit.');
  }
  requireProperties(
    entriesOf(inventory, 'AWS::Logs::LogGroup'),
    [{ name: 'KmsKeyId' }, { name: 'RetentionInDays' }],
    errors,
  );

  for (const { logicalId, block } of entriesOf(inventory, 'AWS::IAM::Role')) {
    if (
      /^\s+Action:\s*['"]?\*['"]?\s*$/m.test(block) ||
      /^\s+-\s*['"]?\*['"]?\s*$/m.test(block.match(/Action:[\s\S]*?(?=\n\s{6}\w|$)/)?.[0] ?? '')
    ) {
      errors.push(
        `${logicalId} contains a wildcard IAM action; enumerate least-privilege actions.`,
      );
    }

    if (/TaskRole/i.test(logicalId) && /^\s+Resource:\s*['"]?\*['"]?\s*$/m.test(block)) {
      errors.push(`${logicalId} contains a wildcard IAM resource; scope application task access.`);
    }
  }

  const databaseAndCacheSecurityGroups = entriesOf(inventory, 'AWS::EC2::SecurityGroup').filter(
    ({ logicalId, block }) =>
      /(database|db|cache|redis)/i.test(logicalId) ||
      /(database|postgres|cache|redis)/i.test(block),
  );
  const standaloneIngressRules = entriesOf(inventory, 'AWS::EC2::SecurityGroupIngress');
  for (const { logicalId, block } of databaseAndCacheSecurityGroups) {
    if (/(?:0\.0\.0\.0\/0|::\/0)/.test(block)) {
      errors.push(`${logicalId} must not expose database or cache ingress to the internet.`);
    }
    const hasStandaloneSourceRule = standaloneIngressRules.some(
      ({ block: ingressBlock }) =>
        /SourceSecurityGroupId:/m.test(ingressBlock) &&
        new RegExp(`(?:!Ref\\s+${logicalId}\\b|GroupId:[\\s\\S]{0,80}${logicalId}\\b)`).test(
          ingressBlock,
        ),
    );
    if (!/SourceSecurityGroupId:/m.test(block) && !hasStandaloneSourceRule) {
      errors.push(`${logicalId} must authorize ingress from a specific service security group.`);
    }
  }

  if (/AssignPublicIp:\s*ENABLED/i.test(source)) {
    errors.push('Fargate tasks must never enable public IP assignment.');
  }
  if (/PubliclyAccessible:\s*true/i.test(source)) {
    errors.push('Database resources must never be publicly accessible.');
  }
}

function validateDeploymentGuard(source, errors) {
  const localDefault = source.match(/\[string\]\s+\$Action\s*=\s*'([^']+)'/)?.[1];
  if (localDefault !== 'LocalValidate') {
    errors.push('Deployment guard must default to LocalValidate.');
  }

  const localReturnIndex = source.indexOf("if ($Action -eq 'LocalValidate')");
  const optInIndex = source.indexOf('if (-not $AllowAwsApiCalls.IsPresent)');
  const awsDiscoveryIndex = source.indexOf('Get-Command aws');
  if (localReturnIndex < 0 || optInIndex < localReturnIndex || awsDiscoveryIndex < optInIndex) {
    errors.push(
      'Deployment guard must return locally and enforce cloud opt-in before resolving AWS tooling.',
    );
  }

  const requiredIdentityGuards = [
    "Assert-RequiredValue -Name 'Profile'",
    "Assert-RequiredValue -Name 'AccountId'",
    "Assert-RequiredValue -Name 'Region'",
    "if ($Profile -match '^default$')",
    "'get-caller-identity'",
    "'--profile', $Profile",
    "'--region', $Region",
    "'ApiImageUri', 'WebImageUri', 'WorkerImageUri'",
    '$expectedEcrPrefix',
    '$expectedCertificatePrefix',
    "'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES'",
    "'^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
    'Get-TextSha256',
    'parameters-sha256=',
    "if ($ChangeSetType -eq 'CREATE')",
    "'ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount'",
    '$prefixLength -lt 1',
    "'get-template'",
    "'--template-stage', 'Original'",
    '$submittedTemplateSha256',
    '$changeSetId',
    "'--change-set-name', $changeSetId",
  ];
  for (const fragment of requiredIdentityGuards) {
    if (!source.includes(fragment)) {
      errors.push(`Deployment guard is missing required identity safeguard: ${fragment}`);
    }
  }

  if (
    !source.includes("$Action -eq 'Plan'") ||
    !source.includes("'create-change-set'") ||
    !source.includes("'--change-set-name', $ChangeSetName")
  ) {
    errors.push(
      'Deployment guard Plan action must create an explicitly named, reviewable change set.',
    );
  }

  if (!source.includes("'describe-change-set'") || !source.includes("'execute-change-set'")) {
    errors.push('Deployment guard must describe and execute the exact reviewed change set.');
  }

  const acknowledgementIndex = source.indexOf(
    '$expectedAcknowledgement = "EXECUTE REVIEWED CHANGE SET',
  );
  const templateRetrievalIndex = source.indexOf("'get-template'");
  const deployInvocationIndex = source.lastIndexOf("'execute-change-set'");
  if (
    templateRetrievalIndex < 0 ||
    acknowledgementIndex < templateRetrievalIndex ||
    deployInvocationIndex < acknowledgementIndex
  ) {
    errors.push(
      'Deployment guard must retrieve the actual submitted template, then require the typed billable-resource acknowledgement before deployment.',
    );
  }

  if (!source.includes('$BillableAcknowledgement -cne $expectedAcknowledgement')) {
    errors.push('Deployment acknowledgement comparison must be exact and case-sensitive.');
  }

  if (
    !source.includes('Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256') ||
    !source.includes("'--description', $expectedChangeSetDescription") ||
    !source.includes('$changeSet.Description -cne $expectedChangeSetDescription') ||
    !source.includes('Sort-Object ParameterKey') ||
    !source.includes('$submittedTemplateSha256 -cne $templateSha256')
  ) {
    errors.push(
      'Plan and Deploy must bind the reviewed change set to exact template and parameter SHA-256 values and verify the submitted Original template.',
    );
  }
}

function validateNoEmbeddedSecrets(sources, errors) {
  const forbiddenPatterns = [
    { label: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
    {
      label: 'GitHub access token',
      pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    },
    { label: 'Slack access token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/ },
    { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    {
      label: 'literal AWS secret access key',
      pattern: /aws_secret_access_key\s*[:=]\s*[^\s!{][^\s]*/i,
    },
    {
      label: 'literal master password',
      pattern: /^\s*MasterUserPassword:\s*(?![!{]|\{\{resolve:)[^\s#]+/im,
    },
    { label: 'literal secret string', pattern: /^\s*SecretString:\s*(?![!{])[^\s#]+/im },
  ];

  for (const [label, source] of sources) {
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(source)) {
        errors.push(`${label} contains a forbidden ${forbidden.label}.`);
      }
    }
  }
}

function collectInfraCredentialScanSources() {
  const infraRoot = join(repositoryRoot, 'infra');
  const allowedExtensions = new Set(['.yaml', '.yml', '.json', '.ps1', '.sh']);
  const sources = [];

  walk(infraRoot, (path, isDirectory) => {
    const filename = path.split(/[\\/]/).at(-1) ?? '';
    const isScannable =
      allowedExtensions.has(extname(path).toLowerCase()) ||
      /^Dockerfile(?:\..+)?$/i.test(filename) ||
      /^\.env(?:\..+)?$/i.test(filename);
    if (isDirectory || !isScannable) {
      return;
    }

    // The validator contains non-secret detector fixtures such as access-key
    // prefixes and private-key headers; scanning itself would be a false positive.
    if (resolve(path) === resolve(fileURLToPath(import.meta.url))) {
      return;
    }

    if (statSync(path).size <= 2_000_000) {
      sources.push([path, readFileSync(path, 'utf8')]);
    }
  });

  return sources;
}

function walk(directory, visitor) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      visitor(path, true);
      walk(path, visitor);
    } else {
      visitor(path, false);
    }
  }
}

function validateLocalArtifactHygiene(errors) {
  const ignorePath = join(scriptDirectory, '.gitignore');
  const ignoreSource = readRequiredFile(ignorePath, 'infra/aws/.gitignore', errors);
  const requiredIgnoreRules = [
    '.terraform/',
    '*.tfstate',
    'cdk.out/',
    '.aws-sam/',
    '.aws/',
    'change-sets/',
    '*.outputs.local.json',
    '*.billing-controls.local.json',
    '*.pricing.local.json',
    '*.notification-evidence.local.json',
    'cost-exports/',
    'parameters.local.json',
    '*.secrets.json',
    '*.pem',
    '*.key',
  ];

  for (const rule of requiredIgnoreRules) {
    if (!ignoreSource.split('\n').some((line) => line.trim() === rule)) {
      errors.push(`infra/aws/.gitignore must include ${rule}.`);
    }
  }

  const forbiddenDirectories = new Set([
    '.terraform',
    'cdk.out',
    '.aws-sam',
    '.serverless',
    'change-sets',
    'cost-exports',
  ]);
  const forbiddenExtensions = new Set(['.pem', '.key', '.p12', '.pfx']);
  const forbiddenPaths = [];

  walk(scriptDirectory, (path, isDirectory) => {
    const name = path.split(/[\\/]/).at(-1) ?? '';
    if (isDirectory && forbiddenDirectories.has(name)) {
      forbiddenPaths.push(path);
      return;
    }
    if (isDirectory) {
      return;
    }

    if (
      forbiddenExtensions.has(extname(name).toLowerCase()) ||
      /\.tfstate(?:\..+)?$/i.test(name) ||
      /(?:^|\.)secrets\.(?:json|ya?ml)$/i.test(name) ||
      /\.changeset\.json$/i.test(name) ||
      /\.outputs\.local\.json$/i.test(name) ||
      /\.billing-controls\.local\.json$/i.test(name) ||
      /\.pricing\.local\.json$/i.test(name) ||
      /\.notification-evidence\.local\.json$/i.test(name) ||
      /(?:^|\.)parameters\.local\.json$/i.test(name)
    ) {
      forbiddenPaths.push(path);
    }
  });

  for (const path of forbiddenPaths) {
    errors.push(
      `Generated state or secret-bearing artifact must be removed from infra/aws: ${path}`,
    );
  }
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  const errors = [];
  const applicationSource = readRequiredFile(
    options.template,
    'Application baseline template',
    errors,
  );
  const guardPath = join(scriptDirectory, 'invoke-application-baseline.ps1');
  const guardSource = readRequiredFile(guardPath, 'Application deployment guard', errors);

  if (applicationSource) {
    validateTemplateShape(applicationSource, errors);
  }
  if (guardSource) {
    validateDeploymentGuard(guardSource, errors);
  }
  validateNoEmbeddedSecrets(collectInfraCredentialScanSources(), errors);
  validateLocalArtifactHygiene(errors);

  const report = {
    ok: errors.length === 0,
    awsCallsMade: 0,
    template: options.template,
    deploymentGuard: guardPath,
    errors,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write(
      [
        'KAN-34 local infrastructure policy validation passed.',
        `Application template: ${options.template}`,
        'AWS API calls made: 0',
        '',
      ].join('\n'),
    );
  } else {
    process.stderr.write('KAN-34 local infrastructure policy validation failed:\n');
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.stderr.write('AWS API calls made: 0\n');
  }

  process.exit(report.ok ? 0 : 1);
}

main();
