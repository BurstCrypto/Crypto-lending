#!/usr/bin/env node

/**
 * KAN-34 local CloudFormation policy validation.
 *
 * This program deliberately uses only local filesystem APIs. It never loads an
 * AWS SDK, invokes the AWS CLI, resolves credentials, or performs network I/O.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const noExternalEgressResidualLimitations = [
  'Web-task DNS security-group egress permits TCP and UDP port 53 to the VPC CIDR; this static control cannot prove that traffic reaches only the VPC Route 53 Resolver address. API and worker boundaries rely on AmazonProvidedDNS, which is not filtered by security groups.',
  'REDIS_OPERATOR_EXECUTION_ARTIFACT_UNRESOLVED: the nested child exposes conditional operator infrastructure, but this parent defines no reviewed revocation CLI or one-off ECS task. Exact CLIENT KILL targeting, task drain, denial evidence, and immediate operator disablement remain unresolved local-design and live authorization gates.',
  'FIXED_SLOT_CREDENTIAL_REGENERATION_UNRESOLVED: the four enum values constrain each submitted phase but do not compare deployed state or enforce transition adjacency, and retained A/B secrets do not regenerate on a phase-only update. A-to-B-to-A would reuse the original A credential, so the composition can represent reviewed overlap/cutover phases but is neither an enforced workflow nor a repeatable rotation mechanism until inactive-slot regeneration, Redis-password/database-verifier installation, and current-state transition checks are reviewed.',
  'FAILED_AUTH_MONITORING_UNRESOLVED: local ACL denial and redaction tests exist, but this parent has no validated ElastiCache failed-auth log or metric delivery, filter, alarm, and actionable evidence path.',
];
const reviewedApplicationBaselineSha256 =
  '0436cc3d5dc2e1d52f1c6041b97aa9497e4ba7f644eaf7cec810989e0c2796d6';
const reviewedWorkloadBoundariesSha256 =
  '93273bb3bf26f7d21702da2d4b155132db765ce3f123134341e2762ae521b3f9';
const reviewedResourceTypesByLogicalId = new Map([
  ['ApplicationDataKey', 'AWS::KMS::Key'],
  ['ApplicationDataKeyAlias', 'AWS::KMS::Alias'],
  ['ApplicationLogsKey', 'AWS::KMS::Key'],
  ['ApplicationLogsKeyAlias', 'AWS::KMS::Alias'],
  ['Vpc', 'AWS::EC2::VPC'],
  ['InternetGateway', 'AWS::EC2::InternetGateway'],
  ['VpcGatewayAttachment', 'AWS::EC2::VPCGatewayAttachment'],
  ['PublicSubnetA', 'AWS::EC2::Subnet'],
  ['PublicSubnetB', 'AWS::EC2::Subnet'],
  ['PrivateSubnetA', 'AWS::EC2::Subnet'],
  ['PrivateSubnetB', 'AWS::EC2::Subnet'],
  ['PublicRouteTable', 'AWS::EC2::RouteTable'],
  ['PublicDefaultRoute', 'AWS::EC2::Route'],
  ['PublicSubnetARouteTableAssociation', 'AWS::EC2::SubnetRouteTableAssociation'],
  ['PublicSubnetBRouteTableAssociation', 'AWS::EC2::SubnetRouteTableAssociation'],
  ['PrivateRouteTableA', 'AWS::EC2::RouteTable'],
  ['PrivateRouteTableB', 'AWS::EC2::RouteTable'],
  ['PrivateSubnetARouteTableAssociation', 'AWS::EC2::SubnetRouteTableAssociation'],
  ['PrivateSubnetBRouteTableAssociation', 'AWS::EC2::SubnetRouteTableAssociation'],
  ['LoadBalancerSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['LoadBalancerHttpsIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['WebTaskSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['LoadBalancerToWebEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['LoadBalancerToWebIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['DatabaseSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['RedisSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['InterfaceEndpointSecurityGroup', 'AWS::EC2::SecurityGroup'],
  ['WebTaskDnsUdpEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['WebTaskDnsTcpEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['WebTaskToInterfaceEndpointEgress', 'AWS::EC2::SecurityGroupEgress'],
  ['WebTaskToInterfaceEndpointIngress', 'AWS::EC2::SecurityGroupIngress'],
  ['EcrApiEndpoint', 'AWS::EC2::VPCEndpoint'],
  ['EcrDockerEndpoint', 'AWS::EC2::VPCEndpoint'],
  ['CloudWatchLogsEndpoint', 'AWS::EC2::VPCEndpoint'],
  ['SecretsManagerEndpoint', 'AWS::EC2::VPCEndpoint'],
  ['SqsEndpoint', 'AWS::EC2::VPCEndpoint'],
  ['S3GatewayEndpoint', 'AWS::EC2::VPCEndpoint'],
  ['WebTaskToS3Egress', 'AWS::EC2::SecurityGroupEgress'],
  ['DatabaseSubnetGroup', 'AWS::RDS::DBSubnetGroup'],
  ['RedisSubnetGroup', 'AWS::ElastiCache::SubnetGroup'],
  ['DatabaseCredentialsSecret', 'AWS::SecretsManager::Secret'],
  ['DatabaseParameterGroup', 'AWS::RDS::DBParameterGroup'],
  ['Database', 'AWS::RDS::DBInstance'],
  ['RedisReplicationGroup', 'AWS::ElastiCache::ReplicationGroup'],
  ['JobDeadLetterQueue', 'AWS::SQS::Queue'],
  ['JobQueue', 'AWS::SQS::Queue'],
  ['JobQueueTlsPolicy', 'AWS::SQS::QueuePolicy'],
  ['ApiLogGroup', 'AWS::Logs::LogGroup'],
  ['WebLogGroup', 'AWS::Logs::LogGroup'],
  ['WorkerLogGroup', 'AWS::Logs::LogGroup'],
  ['WorkloadBoundaries', 'AWS::CloudFormation::Stack'],
  ['ApplicationImagePullPolicy', 'AWS::IAM::ManagedPolicy'],
  ['WebTaskExecutionRole', 'AWS::IAM::Role'],
  ['ApiTaskRole', 'AWS::IAM::Role'],
  ['WorkerTaskRole', 'AWS::IAM::Role'],
  ['WebTaskRole', 'AWS::IAM::Role'],
  ['ApplicationLoadBalancer', 'AWS::ElasticLoadBalancingV2::LoadBalancer'],
  ['WebTargetGroup', 'AWS::ElasticLoadBalancingV2::TargetGroup'],
  ['ApiTargetGroup', 'AWS::ElasticLoadBalancingV2::TargetGroup'],
  ['HttpRedirectListener', 'AWS::ElasticLoadBalancingV2::Listener'],
  ['HttpRedirectListenerRule', 'AWS::ElasticLoadBalancingV2::ListenerRule'],
  ['HttpsListener', 'AWS::ElasticLoadBalancingV2::Listener'],
  ['HttpsInternalApiDenyRule', 'AWS::ElasticLoadBalancingV2::ListenerRule'],
  ['HttpsApiListenerRule', 'AWS::ElasticLoadBalancingV2::ListenerRule'],
  ['HttpsWebListenerRule', 'AWS::ElasticLoadBalancingV2::ListenerRule'],
  ['EcsCluster', 'AWS::ECS::Cluster'],
  ['ApiTaskDefinition', 'AWS::ECS::TaskDefinition'],
  ['WebTaskDefinition', 'AWS::ECS::TaskDefinition'],
  ['WorkerTaskDefinition', 'AWS::ECS::TaskDefinition'],
  ['ApiService', 'AWS::ECS::Service'],
  ['WebService', 'AWS::ECS::Service'],
  ['WorkerService', 'AWS::ECS::Service'],
  ['ApiUnhealthyHostAlarm', 'AWS::CloudWatch::Alarm'],
  ['DatabaseLowStorageAlarm', 'AWS::CloudWatch::Alarm'],
  ['RedisEvictionsAlarm', 'AWS::CloudWatch::Alarm'],
  ['JobQueueAgeAlarm', 'AWS::CloudWatch::Alarm'],
  ['DeadLetterQueueNotEmptyAlarm', 'AWS::CloudWatch::Alarm'],
  ['OperationalDashboard', 'AWS::CloudWatch::Dashboard'],
]);

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
      if (/^(?:\\\\[.?]\\|\\\\|\/\/)/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
        throw new Error(`${argument} requires a local filesystem path, not a URI or network path.`);
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
  let info;
  try {
    info = lstatSync(path);
  } catch {
    errors.push(`${label} does not exist: ${path}`);
    return '';
  }

  if (info.isSymbolicLink()) {
    errors.push(`${label} must be a regular local file, not a symbolic link: ${path}`);
    return '';
  }
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

function propertyValue(block, propertyName) {
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`^\\s+${escapedName}:\\s*(.+?)\\s*(?:#.*)?$`, 'm'))?.[1];
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function indentedPropertyBlock(block, propertyName) {
  const lines = block.split('\n');
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => new RegExp(`^\\s+${escapedName}:\\s*$`).test(line));
  if (matches.length !== 1) {
    return undefined;
  }

  const { index, line } = matches[0];
  const propertyIndent = line.search(/\S/);
  const propertyLines = [line];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const nestedLine = lines[cursor];
    if (nestedLine.trim() !== '' && nestedLine.search(/\S/) <= propertyIndent) {
      break;
    }
    propertyLines.push(nestedLine);
  }
  return propertyLines.join('\n').trimEnd();
}

function semanticYamlTokens(source) {
  return source.replace(/^\s*-\s+/gm, '').replace(/[\s{},'"]/g, '');
}

function requireExactSemanticProperty(
  block,
  logicalId,
  propertyName,
  expectedSource,
  expectation,
  errors,
) {
  const actual = indentedPropertyBlock(block, propertyName);
  if (!actual || semanticYamlTokens(actual) !== semanticYamlTokens(expectedSource)) {
    errors.push(`${logicalId} must preserve ${expectation}.`);
  }
}

function requireAbsentProperty(block, logicalId, propertyName, expectation, errors) {
  if (hasPropertyName(block, propertyName)) {
    errors.push(`${logicalId} must not declare ${propertyName}; ${expectation}.`);
  }
}

function validateTaskEnvironmentCredentialBoundary(block, logicalId, errors) {
  const environment = indentedPropertyBlock(block, 'Environment') ?? '';
  const nodeEnvironmentNames = environment.match(/\bName:\s*NODE_ENV\b/g) ?? [];
  const productionBindings =
    environment.match(/^\s*-\s*\{\s*Name:\s*NODE_ENV,\s*Value:\s*production\s*\}\s*$/gm) ?? [];
  if (nodeEnvironmentNames.length !== 1 || productionBindings.length !== 1) {
    errors.push(
      `${logicalId} must bind exactly one canonical NODE_ENV=production Environment value.`,
    );
  }

  const forbiddenCredentialNames = new Set([
    'AWS_ACCESS_KEY_ID',
    'AWS_ACCESS_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SECRET_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN',
    'AWS_PROFILE',
    'AWS_DEFAULT_PROFILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CREDENTIAL_FILE',
    'AWS_CONFIG_FILE',
    'AWS_SDK_LOAD_CONFIG',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_ROLE_ARN',
    'AWS_ROLE_SESSION_NAME',
    'AWS_ENDPOINT_URL',
    'AWS_ENDPOINT_URL_SQS',
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
  ]);
  const authoredCredentialNames = [
    ...new Set(
      [...environment.matchAll(/\bName:\s*([A-Z][A-Z0-9_]*)\b/g)]
        .map((match) => match[1])
        .filter(
          (name) =>
            forbiddenCredentialNames.has(name) ||
            name.startsWith('AWS_CONTAINER_CREDENTIALS_') ||
            name.startsWith('AWS_CONTAINER_AUTHORIZATION_'),
        ),
    ),
  ].sort();
  if (authoredCredentialNames.length > 0) {
    errors.push(
      `${logicalId} must not author AWS credential-provider Environment bindings; ECS supplies task-role credentials through its platform channel. Forbidden bindings: ${authoredCredentialNames.join(', ')}.`,
    );
  }
}

function requireExactInlineEnvironmentReference(
  block,
  logicalId,
  environmentName,
  referencedLogicalId,
  errors,
) {
  const escapedName = environmentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedReference = referencedLogicalId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameMatches = block.match(new RegExp(`\\bName:\\s*${escapedName}\\b`, 'g')) ?? [];
  const exactMatches =
    block.match(
      new RegExp(
        `^\\s*-\\s*\\{\\s*Name:\\s*${escapedName},\\s*Value:\\s*!Ref\\s+${escapedReference}\\s*\\}\\s*$`,
        'gm',
      ),
    ) ?? [];
  if (nameMatches.length !== 1 || exactMatches.length !== 1) {
    errors.push(
      `${logicalId} must bind exactly one ${environmentName} environment value to !Ref ${referencedLogicalId}.`,
    );
  }
}

function requireExactGetAttEnvironmentReference(
  block,
  logicalId,
  environmentName,
  referencedAttribute,
  errors,
) {
  const escapedName = environmentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedReference = referencedAttribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameMatches = block.match(new RegExp(`\\bName:\\s*${escapedName}\\b`, 'g')) ?? [];
  const exactMatches =
    block.match(
      new RegExp(
        `\\bName:\\s*${escapedName},?[\\s\\S]{0,160}?\\bValue:\\s*!GetAtt\\s+${escapedReference}(?=\\s*[,}\\n])`,
        'g',
      ),
    ) ?? [];
  if (nameMatches.length !== 1 || exactMatches.length !== 1) {
    errors.push(
      `${logicalId} must bind exactly one ${environmentName} environment value to !GetAtt ${referencedAttribute}.`,
    );
  }
}

function requireExactInlineSecretReference(
  block,
  logicalId,
  environmentName,
  referencedLogicalId,
  secretField,
  errors,
) {
  const escapedName = environmentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedReference = referencedLogicalId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedField = secretField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameMatches = block.match(new RegExp(`\\bName:\\s*${escapedName}\\b`, 'g')) ?? [];
  const exactMatches =
    block.match(
      new RegExp(
        `\\bName:\\s*${escapedName},?[\\s\\S]{0,160}?\\bValueFrom:\\s*!Sub\\s+['"]\\$\\{${escapedReference}\\}:${escapedField}::['"]`,
        'g',
      ),
    ) ?? [];
  if (nameMatches.length !== 1 || exactMatches.length !== 1) {
    errors.push(
      `${logicalId} must bind exactly one ${environmentName} secret value to ${referencedLogicalId}:${secretField}.`,
    );
  }
}

function nestedReferenceList(block, propertyName) {
  const lines = block.split(/\r?\n/);
  const propertyLines = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => line.trim() === `${propertyName}:`);
  if (propertyLines.length !== 1) {
    return undefined;
  }

  const { index, line } = propertyLines[0];
  const propertyIndent = line.search(/\S/);
  const references = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const nestedLine = lines[cursor];
    if (nestedLine.trim() === '') {
      continue;
    }
    if (nestedLine.search(/\S/) <= propertyIndent) {
      break;
    }
    const reference = nestedLine.trim().match(/^-\s+!Ref\s+([A-Za-z][A-Za-z0-9]*)$/)?.[1];
    if (!reference) {
      return undefined;
    }
    references.push(reference);
  }
  return references;
}

function requireExactLogicalIds(entries, expectedIds, label, errors) {
  const expected = new Set(expectedIds);
  const actual = new Set(entries.map(({ logicalId }) => logicalId));

  for (const logicalId of expected) {
    if (!actual.has(logicalId)) {
      errors.push(`${label} is missing required resource ${logicalId}.`);
    }
  }
  for (const logicalId of actual) {
    if (!expected.has(logicalId)) {
      errors.push(`${label} contains unapproved resource ${logicalId}.`);
    }
  }
}

function requireExactProperty(block, logicalId, propertyName, expectedValue, errors) {
  const actualValue = propertyValue(block, propertyName);
  if (actualValue !== expectedValue) {
    errors.push(`${logicalId} requires ${propertyName} to equal ${expectedValue}.`);
  }
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

function validateNoExternalApplicationEgress(source, parameters, resources, inventory, errors) {
  const privateEgressMode = parameters.get('PrivateEgressMode') ?? '';
  const privateEgressAllowedValues = [
    ...privateEgressMode.matchAll(/^\s{6}-\s*([A-Za-z0-9]+)\s*$/gm),
  ].map((match) => match[1]);
  if (
    !hasProperty(privateEgressMode, 'Default', 'VpcEndpoints') ||
    privateEgressAllowedValues.join('|') !== 'VpcEndpoints|None'
  ) {
    errors.push(
      'PrivateEgressMode must expose exactly VpcEndpoints and None and must default to VpcEndpoints; internet egress modes are not approved.',
    );
  }
  if (
    !/^\s{2}UseVpcEndpoints:\s*!Equals \[!Ref PrivateEgressMode, VpcEndpoints\]\s*$/m.test(source)
  ) {
    errors.push('UseVpcEndpoints must be controlled only by PrivateEgressMode VpcEndpoints.');
  }

  if (/^\s*(?:["']?Transform["']?|["']?Fn::Transform["']?)\s*:/m.test(source)) {
    errors.push(
      'Application baseline transforms and macros are prohibited because static egress validation must inspect every resource directly.',
    );
  }
  if (/^\s*<<\s*:|(?:^|[\s:[,{])[&*][A-Za-z0-9_-]+/m.test(source)) {
    errors.push(
      'Application baseline YAML anchors, aliases, and merge keys are prohibited because static egress validation must inspect the resolved resource graph.',
    );
  }
  if (/^  ["'][A-Za-z][A-Za-z0-9]*["']\s*:/m.test(source)) {
    errors.push(
      'Application baseline logical IDs must use the canonical unquoted form required by the static resource inventory.',
    );
  }
  for (const [logicalId, block] of resources) {
    if (!/^\s{4}Type:\s*['"]?[^\s'"]+['"]?\s*(?:#.*)?$/m.test(block)) {
      errors.push(`${logicalId} must declare one canonical, statically visible resource Type.`);
    }
  }
  for (const [type, entries] of inventory) {
    if (type.startsWith('Custom::') || type === 'AWS::CloudFormation::CustomResource') {
      for (const { logicalId } of entries) {
        errors.push(
          `${logicalId} is a prohibited custom resource that could bypass egress policy.`,
        );
      }
    }
  }

  const actualResourceTypesByLogicalId = new Map();
  for (const [type, entries] of inventory) {
    for (const { logicalId } of entries) {
      actualResourceTypesByLogicalId.set(logicalId, type);
    }
  }
  for (const [logicalId, expectedType] of reviewedResourceTypesByLogicalId) {
    if (!resources.has(logicalId)) {
      errors.push(`Reviewed resource graph is missing ${logicalId}.`);
      continue;
    }

    const actualType = actualResourceTypesByLogicalId.get(logicalId);
    if (actualType !== expectedType) {
      errors.push(
        `${logicalId} must retain reviewed resource type ${expectedType}; found ${actualType ?? 'no statically visible type'}.`,
      );
    }
  }
  for (const logicalId of resources.keys()) {
    if (!reviewedResourceTypesByLogicalId.has(logicalId)) {
      errors.push(`Reviewed resource graph contains unapproved resource ${logicalId}.`);
    }
  }

  const prohibitedEgressTypes = new Set([
    'AWS::AppRunner::Service',
    'AWS::AutoScaling::AutoScalingGroup',
    'AWS::Batch::ComputeEnvironment',
    'AWS::EC2::CarrierGateway',
    'AWS::EC2::ClientVpnEndpoint',
    'AWS::EC2::ClientVpnRoute',
    'AWS::EC2::CustomerGateway',
    'AWS::EC2::DHCPOptions',
    'AWS::EC2::EgressOnlyInternetGateway',
    'AWS::EC2::EIP',
    'AWS::EC2::Instance',
    'AWS::EC2::LaunchTemplate',
    'AWS::EC2::LocalGatewayRoute',
    'AWS::EC2::LocalGatewayRouteTableVPCAssociation',
    'AWS::EC2::NatGateway',
    'AWS::EC2::NetworkInterface',
    'AWS::EC2::TransitGateway',
    'AWS::EC2::TransitGatewayAttachment',
    'AWS::EC2::TransitGatewayPeeringAttachment',
    'AWS::EC2::TransitGatewayRoute',
    'AWS::EC2::TransitGatewayRouteTable',
    'AWS::EC2::TransitGatewayVpcAttachment',
    'AWS::EC2::VPNConnection',
    'AWS::EC2::VPNGateway',
    'AWS::EC2::VPNGatewayRoutePropagation',
    'AWS::EC2::VPCDHCPOptionsAssociation',
    'AWS::EC2::VPCPeeringConnection',
    'AWS::ElasticLoadBalancing::LoadBalancer',
    'AWS::Lambda::Function',
    'AWS::NetworkFirewall::Firewall',
    'AWS::NetworkFirewall::FirewallPolicy',
    'AWS::NetworkFirewall::LoggingConfiguration',
    'AWS::NetworkFirewall::RuleGroup',
    'AWS::Route53Resolver::FirewallDomainList',
    'AWS::Route53Resolver::FirewallRuleGroup',
    'AWS::Route53Resolver::FirewallRuleGroupAssociation',
    'AWS::Route53Resolver::ResolverEndpoint',
  ]);
  for (const type of prohibitedEgressTypes) {
    for (const { logicalId } of entriesOf(inventory, type)) {
      errors.push(
        `${logicalId} uses prohibited external-egress or proxy resource type ${type}; no such architecture has been approved.`,
      );
    }
  }
  const prohibitedEgressTypeFamilies = [
    /^AWS::NetworkManager::/,
    /^AWS::Route53Resolver::/,
    /^AWS::VpcLattice::/,
    /^AWS::EC2::(?:GatewayRouteTableAssociation|RouteServer|TransitGateway|VPNGatewayRoutePropagation)/,
  ];
  for (const [type, entries] of inventory) {
    if (prohibitedEgressTypeFamilies.some((pattern) => pattern.test(type))) {
      for (const { logicalId } of entries) {
        errors.push(
          `${logicalId} uses prohibited external-egress routing resource type ${type}; the reviewed baseline has no route propagation, Cloud WAN, route server, or VPC Lattice path.`,
        );
      }
    }
  }

  const routes = entriesOf(inventory, 'AWS::EC2::Route');
  requireExactLogicalIds(routes, ['PublicDefaultRoute'], 'Explicit route allowlist', errors);
  const publicDefaultRoute = resources.get('PublicDefaultRoute') ?? '';
  requireExactProperty(
    publicDefaultRoute,
    'PublicDefaultRoute',
    'DestinationCidrBlock',
    '0.0.0.0/0',
    errors,
  );
  requireExactProperty(
    publicDefaultRoute,
    'PublicDefaultRoute',
    'GatewayId',
    '!Ref InternetGateway',
    errors,
  );
  requireExactProperty(
    publicDefaultRoute,
    'PublicDefaultRoute',
    'RouteTableId',
    '!Ref PublicRouteTable',
    errors,
  );
  if (
    /(?:DestinationIpv6CidrBlock|NatGatewayId|TransitGatewayId|EgressOnlyInternetGatewayId|NetworkInterfaceId|VpcPeeringConnectionId|CarrierGatewayId|LocalGatewayId):/m.test(
      publicDefaultRoute,
    )
  ) {
    errors.push('PublicDefaultRoute contains an unapproved destination or egress target.');
  }

  const routeTables = entriesOf(inventory, 'AWS::EC2::RouteTable');
  requireExactLogicalIds(
    routeTables,
    ['PublicRouteTable', 'PrivateRouteTableA', 'PrivateRouteTableB'],
    'Route-table allowlist',
    errors,
  );
  const routeTableAssociations = entriesOf(inventory, 'AWS::EC2::SubnetRouteTableAssociation');
  requireExactLogicalIds(
    routeTableAssociations,
    [
      'PublicSubnetARouteTableAssociation',
      'PublicSubnetBRouteTableAssociation',
      'PrivateSubnetARouteTableAssociation',
      'PrivateSubnetBRouteTableAssociation',
    ],
    'Subnet route-table association allowlist',
    errors,
  );
  const expectedAssociations = new Map([
    ['PublicSubnetARouteTableAssociation', ['!Ref PublicSubnetA', '!Ref PublicRouteTable']],
    ['PublicSubnetBRouteTableAssociation', ['!Ref PublicSubnetB', '!Ref PublicRouteTable']],
    ['PrivateSubnetARouteTableAssociation', ['!Ref PrivateSubnetA', '!Ref PrivateRouteTableA']],
    ['PrivateSubnetBRouteTableAssociation', ['!Ref PrivateSubnetB', '!Ref PrivateRouteTableB']],
  ]);
  for (const [logicalId, [subnetId, routeTableId]] of expectedAssociations) {
    const block = resources.get(logicalId) ?? '';
    requireExactProperty(block, logicalId, 'SubnetId', subnetId, errors);
    requireExactProperty(block, logicalId, 'RouteTableId', routeTableId, errors);
  }

  requireExactLogicalIds(
    entriesOf(inventory, 'AWS::EC2::InternetGateway'),
    ['InternetGateway'],
    'Internet-gateway allowlist',
    errors,
  );
  requireExactLogicalIds(
    entriesOf(inventory, 'AWS::EC2::VPCGatewayAttachment'),
    ['VpcGatewayAttachment'],
    'Internet-gateway attachment allowlist',
    errors,
  );
  const internetGatewayAttachment = resources.get('VpcGatewayAttachment') ?? '';
  requireExactProperty(
    internetGatewayAttachment,
    'VpcGatewayAttachment',
    'InternetGatewayId',
    '!Ref InternetGateway',
    errors,
  );
  requireExactProperty(
    internetGatewayAttachment,
    'VpcGatewayAttachment',
    'VpcId',
    '!Ref Vpc',
    errors,
  );
  if (hasPropertyName(internetGatewayAttachment, 'VpnGatewayId')) {
    errors.push('VpcGatewayAttachment must not attach a VPN gateway.');
  }

  const endpoints = entriesOf(inventory, 'AWS::EC2::VPCEndpoint');
  const expectedEndpoints = new Map([
    ['EcrApiEndpoint', ['ecr.api', 'Interface']],
    ['EcrDockerEndpoint', ['ecr.dkr', 'Interface']],
    ['CloudWatchLogsEndpoint', ['logs', 'Interface']],
    ['SecretsManagerEndpoint', ['secretsmanager', 'Interface']],
    ['SqsEndpoint', ['sqs', 'Interface']],
    ['S3GatewayEndpoint', ['s3', 'Gateway']],
  ]);
  requireExactLogicalIds(
    endpoints,
    [...expectedEndpoints.keys()],
    'Private VPC endpoint allowlist',
    errors,
  );
  for (const [logicalId, [service, endpointType]] of expectedEndpoints) {
    const block = resources.get(logicalId) ?? '';
    requireExactProperty(block, logicalId, 'Condition', 'UseVpcEndpoints', errors);
    requireExactProperty(
      block,
      logicalId,
      'ServiceName',
      `!Sub com.amazonaws.\${AWS::Region}.${service}`,
      errors,
    );
    requireExactProperty(block, logicalId, 'VpcEndpointType', endpointType, errors);
    requireExactProperty(block, logicalId, 'VpcId', '!Ref Vpc', errors);

    if (endpointType === 'Interface') {
      requireExactProperty(block, logicalId, 'PrivateDnsEnabled', 'true', errors);
      const subnetReferences = [
        ...block.matchAll(/^\s+-\s*!Ref\s+((?:Public|Private)Subnet[A-Za-z0-9]*)\s*$/gm),
      ].map((match) => match[1]);
      if (subnetReferences.join('|') !== 'PrivateSubnetA|PrivateSubnetB') {
        errors.push(`${logicalId} must use exactly PrivateSubnetA and PrivateSubnetB.`);
      }
      if ((block.match(/!Ref\s+InterfaceEndpointSecurityGroup\b/g) ?? []).length !== 1) {
        errors.push(`${logicalId} must use exactly the interface endpoint security group.`);
      }
    }
  }

  const s3Endpoint = resources.get('S3GatewayEndpoint') ?? '';
  const s3RouteTableReferences = [
    ...s3Endpoint.matchAll(/^\s+-\s*!Ref\s+((?:Public|Private)RouteTable[A-Za-z0-9]*)\s*$/gm),
  ].map((match) => match[1]);
  if (s3RouteTableReferences.join('|') !== 'PrivateRouteTableA|PrivateRouteTableB') {
    errors.push('S3GatewayEndpoint must attach only to both private route tables.');
  }
  if ((s3Endpoint.match(/^\s+-\s+Effect:/gm) ?? []).length !== 1) {
    errors.push('S3GatewayEndpoint must contain exactly one endpoint-policy statement.');
  }
  if (!/^\s+-\s+Effect:\s*Allow\s*$/m.test(s3Endpoint)) {
    errors.push('S3GatewayEndpoint endpoint policy must have Effect: Allow.');
  }
  requireExactProperty(s3Endpoint, 'S3GatewayEndpoint', 'Principal', "'*'", errors);
  requireExactProperty(s3Endpoint, 'S3GatewayEndpoint', 'Action', 's3:GetObject', errors);
  requireExactProperty(
    s3Endpoint,
    'S3GatewayEndpoint',
    'Resource',
    '!Sub arn:${AWS::Partition}:s3:::prod-${AWS::Region}-starport-layer-bucket/*',
    errors,
  );

  const expectedSecurityGroupEgress = new Map([
    [
      'LoadBalancerToWebEgress',
      ['DestinationSecurityGroupId', '!Ref WebTaskSecurityGroup', '3000', 'tcp', undefined],
    ],
    ['WebTaskDnsUdpEgress', ['CidrIp', '!Ref VpcCidr', '53', 'udp', undefined]],
    ['WebTaskDnsTcpEgress', ['CidrIp', '!Ref VpcCidr', '53', 'tcp', undefined]],
    [
      'WebTaskToInterfaceEndpointEgress',
      [
        'DestinationSecurityGroupId',
        '!Ref InterfaceEndpointSecurityGroup',
        '443',
        'tcp',
        'UseVpcEndpoints',
      ],
    ],
    [
      'WebTaskToS3Egress',
      ['DestinationPrefixListId', '!Ref S3ManagedPrefixListId', '443', 'tcp', 'UseVpcEndpoints'],
    ],
  ]);
  const securityGroupEgress = entriesOf(inventory, 'AWS::EC2::SecurityGroupEgress');
  requireExactLogicalIds(
    securityGroupEgress,
    [...expectedSecurityGroupEgress.keys()],
    'Security-group egress allowlist',
    errors,
  );
  for (const [
    logicalId,
    [destinationProperty, destinationValue, port, protocol, condition],
  ] of expectedSecurityGroupEgress) {
    const block = resources.get(logicalId) ?? '';
    const destinations = [
      ...block.matchAll(
        /^\s+(CidrIp|CidrIpv6|DestinationSecurityGroupId|DestinationPrefixListId):\s*(.+?)\s*$/gm,
      ),
    ];
    if (
      destinations.length !== 1 ||
      destinations[0][1] !== destinationProperty ||
      destinations[0][2] !== destinationValue
    ) {
      errors.push(
        `${logicalId} must use only ${destinationProperty}: ${destinationValue} as its destination.`,
      );
    }
    requireExactProperty(block, logicalId, 'FromPort', port, errors);
    requireExactProperty(block, logicalId, 'ToPort', port, errors);
    requireExactProperty(block, logicalId, 'IpProtocol', protocol, errors);
    if (condition) {
      requireExactProperty(block, logicalId, 'Condition', condition, errors);
    } else if (hasPropertyName(block, 'Condition')) {
      errors.push(`${logicalId} must not make its required scoped egress conditional.`);
    }
  }

  requireExactLogicalIds(
    entriesOf(inventory, 'AWS::ElasticLoadBalancingV2::LoadBalancer'),
    ['ApplicationLoadBalancer'],
    'Load-balancer allowlist',
    errors,
  );
  requireExactLogicalIds(
    entriesOf(inventory, 'AWS::ECS::TaskDefinition'),
    ['ApiTaskDefinition', 'WebTaskDefinition', 'WorkerTaskDefinition'],
    'Task-definition allowlist',
    errors,
  );
  const services = entriesOf(inventory, 'AWS::ECS::Service');
  requireExactLogicalIds(
    services,
    ['ApiService', 'WebService', 'WorkerService'],
    'ECS service allowlist',
    errors,
  );
  const expectedServiceSecurityGroups = new Map([
    ['ApiService', '!GetAtt WorkloadBoundaries.Outputs.ApiTaskSecurityGroupId'],
    ['WebService', '!Ref WebTaskSecurityGroup'],
    ['WorkerService', '!GetAtt WorkloadBoundaries.Outputs.WorkerTaskSecurityGroupId'],
  ]);
  for (const { logicalId, block } of services) {
    if (
      !hasProperty(block, 'AssignPublicIp', 'DISABLED') ||
      /!Ref\s+PublicSubnet[A-Za-z0-9]*\b/.test(block)
    ) {
      errors.push(`${logicalId} must disable public IPs and use only private subnets.`);
    }
    const subnetReferences = nestedReferenceList(block, 'Subnets');
    if (subnetReferences?.join('|') !== 'PrivateSubnetA|PrivateSubnetB') {
      errors.push(`${logicalId} must use exactly PrivateSubnetA and PrivateSubnetB.`);
    }
    const expectedSecurityGroup = expectedServiceSecurityGroups.get(logicalId);
    const securityGroups = indentedPropertyBlock(block, 'SecurityGroups');
    const expectedSecurityGroups = `SecurityGroups:\n  - ${expectedSecurityGroup}`;
    if (
      !expectedSecurityGroup ||
      semanticYamlTokens(securityGroups ?? '') !== semanticYamlTokens(expectedSecurityGroups)
    ) {
      errors.push(`${logicalId} must use only the reviewed ${expectedSecurityGroup} identity.`);
    }
  }
}

function validateWorkloadBoundaryComposition(source, parameters, resources, inventory, errors) {
  const templateUrl = parameters.get('WorkloadBoundariesTemplateUrl') ?? '';
  const expectedTemplateUrlPattern = `^https://[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\\.s3\\.[a-z0-9-]+\\.(?:amazonaws\\.com|amazonaws\\.com\\.cn)/application-workload-boundaries-${reviewedWorkloadBoundariesSha256}\\.yaml\\?versionId=[A-Za-z0-9._~%+-]+$`;
  if (
    !hasProperty(templateUrl, 'Type', 'String') ||
    !hasProperty(templateUrl, 'MaxLength', '1024') ||
    !hasProperty(templateUrl, 'AllowedPattern', expectedTemplateUrlPattern) ||
    hasPropertyName(templateUrl, 'Default')
  ) {
    errors.push(
      'WorkloadBoundariesTemplateUrl must be supplied explicitly as the reviewed SHA-256-named, versioned S3 object URL.',
    );
  }
  const templateSha = parameters.get('WorkloadBoundariesTemplateSha256') ?? '';
  if (
    !hasProperty(templateSha, 'Type', 'String') ||
    !hasProperty(templateSha, 'AllowedValues', `[${reviewedWorkloadBoundariesSha256}]`) ||
    hasPropertyName(templateSha, 'Default')
  ) {
    errors.push('WorkloadBoundariesTemplateSha256 must be an explicit String without a default.');
  }
  const artifactBinding = parameters.get('WorkloadBoundariesArtifactBindingSha256') ?? '';
  if (
    !hasProperty(artifactBinding, 'Type', 'String') ||
    !hasProperty(artifactBinding, 'AllowedPattern', '^[a-f0-9]{64}$') ||
    hasPropertyName(artifactBinding, 'Default')
  ) {
    errors.push(
      'WorkloadBoundariesArtifactBindingSha256 must be an explicit lowercase SHA-256 without a default.',
    );
  }

  for (const name of [
    'ApiDatabaseCredentialPhase',
    'WorkerDatabaseCredentialPhase',
    'RedisCredentialPhase',
  ]) {
    const block = parameters.get(name) ?? '';
    if (
      !hasProperty(block, 'Type', 'String') ||
      !hasProperty(block, 'Default', 'A_ONLY') ||
      !hasProperty(block, 'AllowedValues', '[A_ONLY, BOTH_USE_A, BOTH_USE_B, B_ONLY]')
    ) {
      errors.push(`${name} must be a String that defaults to the safe A_ONLY phase.`);
    }
  }
  const operatorMode = parameters.get('RedisOperatorMode') ?? '';
  if (
    !hasProperty(operatorMode, 'Type', 'String') ||
    !hasProperty(operatorMode, 'Default', 'DISABLED') ||
    !hasProperty(operatorMode, 'AllowedValues', '[DISABLED, ENABLED]')
  ) {
    errors.push('RedisOperatorMode must be a String that defaults to DISABLED.');
  }

  requireExactLogicalIds(
    entriesOf(inventory, 'AWS::CloudFormation::Stack'),
    ['WorkloadBoundaries'],
    'Nested-stack allowlist',
    errors,
  );
  requireExactSemanticProperty(
    resources.get('WorkloadBoundaries') ?? '',
    'WorkloadBoundaries',
    'Properties',
    [
      'Properties:',
      '  TemplateURL: !Ref WorkloadBoundariesTemplateUrl',
      '  TimeoutInMinutes: 10',
      '  Parameters:',
      '    BillingAcknowledgement: !Ref BillingAcknowledgement',
      '    DeliveryArtifactSha256: !Ref WorkloadBoundariesTemplateSha256',
      '    DeliveryArtifactBindingSha256: !Ref WorkloadBoundariesArtifactBindingSha256',
      '    EnvironmentName: !Ref EnvironmentName',
      '    DatabaseName: !Ref DatabaseName',
      '    VpcId: !Ref Vpc',
      '    LoadBalancerSecurityGroupId: !Ref LoadBalancerSecurityGroup',
      '    DatabaseSecurityGroupId: !Ref DatabaseSecurityGroup',
      '    RedisSecurityGroupId: !Ref RedisSecurityGroup',
      '    PrivateEgressMode: !Ref PrivateEgressMode',
      "    InterfaceEndpointSecurityGroupId: !If [UseVpcEndpoints, !Ref InterfaceEndpointSecurityGroup, '']",
      "    S3ManagedPrefixListId: !If [UseVpcEndpoints, !Ref S3ManagedPrefixListId, '']",
      '    ApplicationDataKeyArn: !GetAtt ApplicationDataKey.Arn',
      '    ApiLogGroupArn: !GetAtt ApiLogGroup.Arn',
      '    WorkerLogGroupArn: !GetAtt WorkerLogGroup.Arn',
      '    ApiImageRepositoryArn: !Sub arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/crypto-lending-api',
      '    WorkerImageRepositoryArn: !Sub arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/crypto-lending-worker',
      '    ApiDatabaseCredentialPhase: !Ref ApiDatabaseCredentialPhase',
      '    WorkerDatabaseCredentialPhase: !Ref WorkerDatabaseCredentialPhase',
      '    RedisCredentialPhase: !Ref RedisCredentialPhase',
      '    RedisOperatorMode: !Ref RedisOperatorMode',
      '  Tags:',
      '    - Key: WorkloadBoundariesTemplateSha256',
      '      Value: !Ref WorkloadBoundariesTemplateSha256',
      '    - Key: WorkloadBoundariesArtifactBindingSha256',
      '      Value: !Ref WorkloadBoundariesArtifactBindingSha256',
    ].join('\n'),
    'the exact reviewed child input contract with no caller-selected role, policy, repository, key, or secret',
    errors,
  );

  for (const legacyToken of [
    'BackendTaskExecutionRole',
    'BackendTaskSecurityGroup',
    'DatabaseRuntimeSecret',
    'RedisAuthSecret',
    'REDIS_AUTH_TOKEN',
    'REDIS_KEY_PREFIX',
  ]) {
    if (source.includes(legacyToken)) {
      errors.push(
        `Legacy shared boundary ${legacyToken} must be removed rather than composed alongside WorkloadBoundaries.`,
      );
    }
  }

  const outputs = topLevelBlocks(source, 'Outputs');
  const expectedOutputs = new Map([
    [
      'WorkloadBoundariesTemplateSha256',
      '!GetAtt WorkloadBoundaries.Outputs.DeliveryArtifactSha256',
    ],
    [
      'WorkloadBoundariesArtifactBindingSha256',
      '!GetAtt WorkloadBoundaries.Outputs.DeliveryArtifactBindingSha256',
    ],
    ['ApiTaskSecurityGroupId', '!GetAtt WorkloadBoundaries.Outputs.ApiTaskSecurityGroupId'],
    ['WorkerTaskSecurityGroupId', '!GetAtt WorkloadBoundaries.Outputs.WorkerTaskSecurityGroupId'],
    ['ApiDatabaseActiveSecretArn', '!GetAtt WorkloadBoundaries.Outputs.ApiDatabaseActiveSecretArn'],
    [
      'WorkerDatabaseActiveSecretArn',
      '!GetAtt WorkloadBoundaries.Outputs.WorkerDatabaseActiveSecretArn',
    ],
    [
      'MigrationDatabaseCredentialSecretArn',
      '!GetAtt WorkloadBoundaries.Outputs.MigrationDatabaseCredentialSecretArn',
    ],
    ['RedisActiveSecretArn', '!GetAtt WorkloadBoundaries.Outputs.RedisActiveSecretArn'],
    ['RedisApiUserGroupId', '!GetAtt WorkloadBoundaries.Outputs.RedisApiUserGroupId'],
  ]);
  for (const [name, value] of expectedOutputs) {
    requireExactProperty(outputs.get(name) ?? '', name, 'Value', value, errors);
  }
  for (const name of outputs.keys()) {
    if (/(?:Credential|Secret)(?:A|B)(?:Arn)?$|Api(?:A|B)Secret/.test(name)) {
      errors.push(
        `${name} must not expose a raw A/B credential slot around the active-phase contract.`,
      );
    }
  }
}

function validateEcsRoleSecurityBoundaries(resources, inventory, errors) {
  const roleEntries = entriesOf(inventory, 'AWS::IAM::Role');
  const expectedRoleIds = ['WebTaskExecutionRole', 'ApiTaskRole', 'WorkerTaskRole', 'WebTaskRole'];
  requireExactLogicalIds(roleEntries, expectedRoleIds, 'ECS IAM role allowlist', errors);

  const expectedTrustPolicy = [
    'AssumeRolePolicyDocument:',
    "  Version: '2012-10-17'",
    '  Statement:',
    '    - Effect: Allow',
    '      Principal:',
    '        Service: ecs-tasks.amazonaws.com',
    '      Action: sts:AssumeRole',
    '      Condition:',
    '        StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
    '        ArnLike:',
    "          aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'",
  ].join('\n');
  for (const logicalId of expectedRoleIds) {
    requireExactSemanticProperty(
      resources.get(logicalId) ?? '',
      logicalId,
      'AssumeRolePolicyDocument',
      expectedTrustPolicy,
      'the single-account, regional ECS task trust policy with no additional principal or action',
      errors,
    );
  }

  const imagePullPolicy = resources.get('ApplicationImagePullPolicy') ?? '';
  requireExactSemanticProperty(
    imagePullPolicy,
    'ApplicationImagePullPolicy',
    'PolicyDocument',
    [
      'PolicyDocument:',
      "  Version: '2012-10-17'",
      '  Statement:',
      '    - Effect: Allow',
      '      Action: ecr:GetAuthorizationToken',
      "      Resource: '*'",
      '    - Effect: Allow',
      '      Action:',
      '        - ecr:BatchCheckLayerAvailability',
      '        - ecr:BatchGetImage',
      '        - ecr:GetDownloadUrlForLayer',
      '      Resource: !Sub arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/crypto-lending-web',
    ].join('\n'),
    'the reviewed ECR token and repository-scoped image-pull action/resource matrix',
    errors,
  );

  const executionManagedPolicies = [
    'ManagedPolicyArns:',
    '  - !Ref ApplicationImagePullPolicy',
  ].join('\n');
  for (const logicalId of ['WebTaskExecutionRole']) {
    requireExactSemanticProperty(
      resources.get(logicalId) ?? '',
      logicalId,
      'ManagedPolicyArns',
      executionManagedPolicies,
      'the single reviewed application image-pull managed policy attachment',
      errors,
    );
  }

  requireExactSemanticProperty(
    resources.get('WebTaskExecutionRole') ?? '',
    'WebTaskExecutionRole',
    'Policies',
    [
      'Policies:',
      '  - PolicyName: WriteWebLogs',
      '    PolicyDocument:',
      "      Version: '2012-10-17'",
      '      Statement:',
      '        - Effect: Allow',
      '          Action: [logs:CreateLogStream, logs:PutLogEvents]',
      '          Resource: !Sub ${WebLogGroup.Arn}:*',
    ].join('\n'),
    'the web log-only execution policy with no secret or data-key access',
    errors,
  );

  requireExactSemanticProperty(
    resources.get('ApiTaskRole') ?? '',
    'ApiTaskRole',
    'Policies',
    [
      'Policies:',
      '  - PolicyName: ApiJobQueueAccess',
      '    PolicyDocument:',
      "      Version: '2012-10-17'",
      '      Statement:',
      '        - Sid: InspectQueueRedriveConfiguration',
      '          Effect: Allow',
      '          Action: sqs:GetQueueAttributes',
      '          Resource: [!GetAtt JobQueue.Arn, !GetAtt JobDeadLetterQueue.Arn]',
    ].join('\n'),
    'the read-only queue-readiness task policy with no publish, consume, secret, or key access',
    errors,
  );

  requireExactSemanticProperty(
    resources.get('WorkerTaskRole') ?? '',
    'WorkerTaskRole',
    'Policies',
    [
      'Policies:',
      '  - PolicyName: OutboxPublishAccess',
      '    PolicyDocument:',
      "      Version: '2012-10-17'",
      '      Statement:',
      '        - Sid: PublishJobs',
      '          Effect: Allow',
      '          Action: sqs:SendMessage',
      '          Resource: !GetAtt JobQueue.Arn',
      '        - Sid: InspectQueueRedriveConfiguration',
      '          Effect: Allow',
      '          Action: sqs:GetQueueAttributes',
      '          Resource: [!GetAtt JobQueue.Arn, !GetAtt JobDeadLetterQueue.Arn]',
      '        - Sid: UseSqsEncryptionKey',
      '          Effect: Allow',
      '          Action:',
      '            - kms:Decrypt',
      '            - kms:GenerateDataKey',
      '          Resource: !GetAtt ApplicationDataKey.Arn',
      '          Condition:',
      '            StringEquals:',
      '              kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}',
    ].join('\n'),
    'the queue-publish/readiness and SQS-only data-key task policy with no consume or secret access',
    errors,
  );

  for (const logicalId of ['ApiTaskRole', 'WorkerTaskRole', 'WebTaskRole']) {
    requireAbsentProperty(
      resources.get(logicalId) ?? '',
      logicalId,
      'ManagedPolicyArns',
      'application task roles must not inherit managed permissions',
      errors,
    );
  }
  requireAbsentProperty(
    resources.get('WebTaskRole') ?? '',
    'WebTaskRole',
    'Policies',
    'the web application task role must remain permissionless',
    errors,
  );

  const expectedTaskRoles = new Map([
    [
      'ApiTaskDefinition',
      ['!GetAtt WorkloadBoundaries.Outputs.ApiTaskExecutionRoleArn', '!GetAtt ApiTaskRole.Arn'],
    ],
    ['WebTaskDefinition', ['!GetAtt WebTaskExecutionRole.Arn', '!GetAtt WebTaskRole.Arn']],
    [
      'WorkerTaskDefinition',
      [
        '!GetAtt WorkloadBoundaries.Outputs.WorkerTaskExecutionRoleArn',
        '!GetAtt WorkerTaskRole.Arn',
      ],
    ],
  ]);
  for (const [logicalId, [executionRoleArn, taskRoleArn]] of expectedTaskRoles) {
    const block = resources.get(logicalId) ?? '';
    requireExactProperty(block, logicalId, 'ExecutionRoleArn', executionRoleArn, errors);
    requireExactProperty(block, logicalId, 'TaskRoleArn', taskRoleArn, errors);
    validateTaskEnvironmentCredentialBoundary(block, logicalId, errors);
  }

  const workloadSecretBindings = new Map([
    [
      'ApiTaskDefinition',
      [
        'Secrets:',
        '  - Name: DATABASE_RUNTIME_PASSWORD',
        "    ValueFrom: !Sub '${WorkloadBoundaries.Outputs.ApiDatabaseActiveSecretArn}:password::'",
        '  - Name: REDIS_PASSWORD',
        "    ValueFrom: !Sub '${WorkloadBoundaries.Outputs.RedisActiveSecretArn}:password::'",
      ].join('\n'),
    ],
    [
      'WorkerTaskDefinition',
      [
        'Secrets:',
        '  - Name: DATABASE_RUNTIME_PASSWORD',
        "    ValueFrom: !Sub '${WorkloadBoundaries.Outputs.WorkerDatabaseActiveSecretArn}:password::'",
      ].join('\n'),
    ],
  ]);
  for (const [logicalId, expectedSecrets] of workloadSecretBindings) {
    const block = resources.get(logicalId) ?? '';
    requireExactSemanticProperty(
      block,
      logicalId,
      'Secrets',
      expectedSecrets,
      'its exact active workload-scoped ECS secret injection with no cross-workload or migration credential',
      errors,
    );
    const environment = indentedPropertyBlock(block, 'Environment') ?? '';
    if (
      /\bName:\s*(?:DATABASE_RUNTIME_PASSWORD|REDIS_PASSWORD|REDIS_AUTH_TOKEN|MIGRATION_DATABASE_[A-Z_]+)\b/.test(
        environment,
      )
    ) {
      errors.push(
        `${logicalId} must inject sensitive runtime values only through ECS Secrets, never plaintext Environment entries.`,
      );
    }
    if (logicalId === 'WorkerTaskDefinition' && /\bREDIS_[A-Z0-9_]+\b/.test(block)) {
      errors.push('WorkerTaskDefinition must not receive any Redis environment or secret binding.');
    }
  }

  const webTaskDefinition = resources.get('WebTaskDefinition') ?? '';
  requireAbsentProperty(
    webTaskDefinition,
    'WebTaskDefinition',
    'Secrets',
    'the web container has no approved secret dependency',
    errors,
  );
  if (
    /Database(?:Credentials|Runtime)Secret|RedisAuthSecret|WorkloadBoundaries\.Outputs\.(?:Api|Worker|Migration|Redis)|\bValueFrom:/.test(
      webTaskDefinition,
    )
  ) {
    errors.push('WebTaskDefinition must not reference any application secret or ECS secret value.');
  }
}

function validateKmsAndEncryptedServiceBoundaries(resources, inventory, errors) {
  requireExactSemanticProperty(
    resources.get('ApplicationDataKey') ?? '',
    'ApplicationDataKey',
    'KeyPolicy',
    [
      'KeyPolicy:',
      "  Version: '2012-10-17'",
      '  Statement:',
      '    - Sid: AccountAdministrationAndIamDelegation',
      '      Effect: Allow',
      '      Principal:',
      '        AWS: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:root',
      '      Action: kms:*',
      "      Resource: '*'",
      '    - Sid: SqsDataKeyUse',
      '      Effect: Allow',
      '      Principal:',
      '        Service: sqs.amazonaws.com',
      '      Action:',
      '        - kms:Decrypt',
      '        - kms:GenerateDataKey',
      "      Resource: '*'",
      '      Condition:',
      '        StringEquals:',
      '          aws:SourceAccount: !Ref AWS::AccountId',
      '        ArnLike:',
      '          aws:SourceArn: !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-jobs*',
    ].join('\n'),
    'the reviewed account-delegation and SQS service key policy, including exact source account and queue ARN scope',
    errors,
  );

  requireExactSemanticProperty(
    resources.get('ApplicationLogsKey') ?? '',
    'ApplicationLogsKey',
    'KeyPolicy',
    [
      'KeyPolicy:',
      "  Version: '2012-10-17'",
      '  Statement:',
      '    - Sid: AccountAdministrationAndIamDelegation',
      '      Effect: Allow',
      '      Principal:',
      '        AWS: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:root',
      '      Action: kms:*',
      "      Resource: '*'",
      '    - Sid: CloudWatchLogsEncryption',
      '      Effect: Allow',
      '      Principal:',
      '        Service: !Sub logs.${AWS::Region}.${AWS::URLSuffix}',
      '      Action:',
      '        - kms:Encrypt*',
      '        - kms:Decrypt*',
      '        - kms:ReEncrypt*',
      '        - kms:GenerateDataKey*',
      '        - kms:Describe*',
      "      Resource: '*'",
      '      Condition:',
      '        ArnLike:',
      '          kms:EncryptionContext:aws:logs:arn: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/crypto-lending/${EnvironmentName}/*',
    ].join('\n'),
    'the reviewed regional CloudWatch Logs principal and environment-scoped encryption-context key policy',
    errors,
  );

  for (const logicalId of ['DatabaseCredentialsSecret']) {
    requireExactProperty(
      resources.get(logicalId) ?? '',
      logicalId,
      'KmsKeyId',
      '!GetAtt ApplicationDataKey.Arn',
      errors,
    );
  }
  for (const logicalId of ['Database', 'RedisReplicationGroup', 'JobQueue', 'JobDeadLetterQueue']) {
    requireExactProperty(
      resources.get(logicalId) ?? '',
      logicalId,
      logicalId.startsWith('Job') ? 'KmsMasterKeyId' : 'KmsKeyId',
      '!GetAtt ApplicationDataKey.Arn',
      errors,
    );
  }
  for (const logicalId of ['ApiLogGroup', 'WebLogGroup', 'WorkerLogGroup']) {
    requireExactProperty(
      resources.get(logicalId) ?? '',
      logicalId,
      'KmsKeyId',
      '!GetAtt ApplicationLogsKey.Arn',
      errors,
    );
  }

  const redis = resources.get('RedisReplicationGroup') ?? '';
  for (const [propertyName, expectedValue] of [
    ['AtRestEncryptionEnabled', 'true'],
    ['TransitEncryptionEnabled', 'true'],
    ['TransitEncryptionMode', 'required'],
  ]) {
    requireExactProperty(redis, 'RedisReplicationGroup', propertyName, expectedValue, errors);
  }
  requireAbsentProperty(
    redis,
    'RedisReplicationGroup',
    'AuthToken',
    'ACL user-group authentication replaces the legacy shared token',
    errors,
  );
  requireExactSemanticProperty(
    redis,
    'RedisReplicationGroup',
    'UserGroupIds',
    'UserGroupIds:\n  - !GetAtt WorkloadBoundaries.Outputs.RedisApiUserGroupId',
    'the exact API-only ACL user group from the reviewed workload-boundary child',
    errors,
  );
  requireExactProperty(
    resources.get('DatabaseParameterGroup') ?? '',
    'DatabaseParameterGroup',
    'rds.force_ssl',
    "'1'",
    errors,
  );

  requireExactLogicalIds(
    entriesOf(inventory, 'AWS::SQS::Queue'),
    ['JobDeadLetterQueue', 'JobQueue'],
    'Encrypted application queue topology',
    errors,
  );
  requireExactSemanticProperty(
    resources.get('JobDeadLetterQueue') ?? '',
    'JobDeadLetterQueue',
    'Properties',
    [
      'Properties:',
      '  KmsMasterKeyId: !GetAtt ApplicationDataKey.Arn',
      '  KmsDataKeyReusePeriodSeconds: 300',
      '  MessageRetentionPeriod: 1209600',
      '  QueueName: !Sub crypto-lending-${EnvironmentName}-jobs-dlq',
      '  RedriveAllowPolicy:',
      '    redrivePermission: byQueue',
      '    sourceQueueArns:',
      '      - !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-jobs',
    ].join('\n'),
    'the exact customer-key encryption, retention, name, and single-source dead-letter queue topology',
    errors,
  );
  requireExactSemanticProperty(
    resources.get('JobQueue') ?? '',
    'JobQueue',
    'Properties',
    [
      'Properties:',
      '  KmsMasterKeyId: !GetAtt ApplicationDataKey.Arn',
      '  KmsDataKeyReusePeriodSeconds: 300',
      '  MessageRetentionPeriod: 345600',
      '  QueueName: !Sub crypto-lending-${EnvironmentName}-jobs',
      '  ReceiveMessageWaitTimeSeconds: 10',
      '  RedrivePolicy:',
      '    deadLetterTargetArn: !GetAtt JobDeadLetterQueue.Arn',
      '    maxReceiveCount: !Ref SqsMaxReceiveCount',
      '  VisibilityTimeout: !Ref SqsVisibilityTimeoutSeconds',
    ].join('\n'),
    'the exact customer-key encryption, retention, long-poll, bounded-redrive, and visibility-timeout primary queue topology',
    errors,
  );
  requireExactSemanticProperty(
    resources.get('JobDeadLetterQueue') ?? '',
    'JobDeadLetterQueue',
    'RedriveAllowPolicy',
    [
      'RedriveAllowPolicy:',
      '  redrivePermission: byQueue',
      '  sourceQueueArns:',
      '    - !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-jobs',
    ].join('\n'),
    'the single-source byQueue dead-letter redrive allow policy',
    errors,
  );
  requireExactSemanticProperty(
    resources.get('JobQueue') ?? '',
    'JobQueue',
    'RedrivePolicy',
    [
      'RedrivePolicy:',
      '  deadLetterTargetArn: !GetAtt JobDeadLetterQueue.Arn',
      '  maxReceiveCount: !Ref SqsMaxReceiveCount',
    ].join('\n'),
    'the exact dead-letter target and bounded receive-count redrive policy',
    errors,
  );
  requireExactSemanticProperty(
    resources.get('JobQueueTlsPolicy') ?? '',
    'JobQueueTlsPolicy',
    'Properties',
    [
      'Properties:',
      '  Queues:',
      '    - !Ref JobQueue',
      '    - !Ref JobDeadLetterQueue',
      '  PolicyDocument:',
      "    Version: '2012-10-17'",
      '    Statement:',
      '      - Sid: DenyInsecureTransport',
      '        Effect: Deny',
      "        Principal: '*'",
      '        Action: sqs:*',
      '        Resource:',
      '          - !GetAtt JobQueue.Arn',
      '          - !GetAtt JobDeadLetterQueue.Arn',
      '        Condition:',
      '          Bool:',
      "            aws:SecureTransport: 'false'",
    ].join('\n'),
    'the exact two-queue attachment and unconditional insecure-transport denial',
    errors,
  );
  const tlsPolicyQueues = nestedReferenceList(resources.get('JobQueueTlsPolicy') ?? '', 'Queues');
  if (tlsPolicyQueues?.join('|') !== 'JobQueue|JobDeadLetterQueue') {
    errors.push('JobQueueTlsPolicy must attach to exactly JobQueue and JobDeadLetterQueue.');
  }
}

function validateTemplateShape(source, errors) {
  const templateSha256 = sha256(source);
  if (templateSha256 !== reviewedApplicationBaselineSha256) {
    errors.push(
      `Application template SHA-256 ${templateSha256} does not match the reviewed property-complete baseline ${reviewedApplicationBaselineSha256}.`,
    );
  }

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
    if (!sensitiveParameterName.test(name) || /CredentialPhase$/.test(name)) {
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

  const hostnameParameter = parameters.get('ApplicationHostname');
  if (!hostnameParameter) {
    errors.push('ApplicationHostname is required for exact host routing.');
  } else {
    if (hasPropertyName(hostnameParameter, 'Default')) {
      errors.push('ApplicationHostname must be supplied explicitly.');
    }
    if (!/AllowedPattern:[^\n]*\{2,\}/.test(hostnameParameter)) {
      errors.push('ApplicationHostname must require an exact non-production subdomain.');
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

  const imageRepositories = new Map([
    ['ApiImageUri', 'crypto-lending-api'],
    ['WebImageUri', 'crypto-lending-web'],
    ['WorkerImageUri', 'crypto-lending-worker'],
  ]);
  for (const [name, repository] of imageRepositories) {
    const block = parameters.get(name);
    if (!block) {
      errors.push(`Immutable deployment parameter ${name} is required.`);
      continue;
    }
    const allowedPattern = block.match(/^\s+AllowedPattern:\s*['"]?(.+?)['"]?\s*$/m)?.[1] ?? '';
    if (
      allowedPattern !==
      `^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.(amazonaws\\.com|amazonaws\\.com\\.cn)/${repository}@sha256:[a-f0-9]{64}$`
    ) {
      errors.push(
        `${name} must accept only the exact ${repository} ECR repository pinned to a 64-character sha256 digest.`,
      );
    }
    if (hasPropertyName(block, 'Default')) {
      errors.push(`${name} must be supplied explicitly and must not have a mutable default image.`);
    }
  }
  const databaseName = parameters.get('DatabaseName') ?? '';
  if (!hasProperty(databaseName, 'AllowedPattern', '^[a-z][a-z0-9_]{0,62}$')) {
    errors.push('DatabaseName must accept only canonical lowercase PostgreSQL identifiers.');
  }

  const { resources, inventory } = resourceInventory(source);
  if (resources.size === 0) {
    errors.push('Application template must contain a non-empty Resources section.');
    return;
  }

  validateNoExternalApplicationEgress(source, parameters, resources, inventory, errors);
  validateWorkloadBoundaryComposition(source, parameters, resources, inventory, errors);
  validateEcsRoleSecurityBoundaries(resources, inventory, errors);
  validateKmsAndEncryptedServiceBoundaries(resources, inventory, errors);

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
    ['AWS::CloudFormation::Stack', 1],
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
  for (const forbiddenType of [
    'AWS::Route53::',
    'AWS::CertificateManager::',
    'AWS::ACMPCA::',
    'AWS::CloudFormation::CustomResource',
    'Custom::',
  ]) {
    if (source.includes(`Type: ${forbiddenType}`)) {
      errors.push(
        `Application baseline must not provision external KAN-230 prerequisite type ${forbiddenType}.`,
      );
    }
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
    !/Name:\s*DATABASE_RUNTIME_SSL_MODE\b[\s\S]{0,160}?Value:\s*['"]?verify-full['"]?/i.test(
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
  const apiTaskDefinition = resources.get('ApiTaskDefinition') ?? '';
  const workloadTaskContracts = [
    [
      'ApiTaskDefinition',
      apiTaskDefinition,
      'api',
      'ApiDatabaseActiveUsername',
      'ApiDatabaseActiveSecretArn',
    ],
    [
      'WorkerTaskDefinition',
      workerTaskDefinition,
      'worker',
      'WorkerDatabaseActiveUsername',
      'WorkerDatabaseActiveSecretArn',
    ],
  ];
  for (const [logicalId, block, workload, usernameOutput, secretOutput] of workloadTaskContracts) {
    if (/\bMIGRATION_DATABASE_[A-Z_]+\b/.test(block)) {
      errors.push(`${logicalId} must not receive migration/admin database variables.`);
    }
    if (/\bDATABASE_(?:URL|HOST|PORT|NAME|USERNAME|PASSWORD|SSL_MODE)\b/.test(block)) {
      errors.push(`${logicalId} must not receive legacy unscoped database variables.`);
    }
    if (/\bDatabaseCredentialsSecret\b/.test(block)) {
      errors.push(`${logicalId} must not reference the database migration/admin secret.`);
    }
    const usernameBindingErrors = [];
    requireExactGetAttEnvironmentReference(
      block,
      logicalId,
      'DATABASE_RUNTIME_USERNAME',
      `WorkloadBoundaries.Outputs.${usernameOutput}`,
      usernameBindingErrors,
    );
    if (usernameBindingErrors.length > 0) {
      errors.push(
        `${logicalId} must bind the reviewed non-secret runtime database username exactly once to !GetAtt WorkloadBoundaries.Outputs.${usernameOutput}.`,
      );
    }
    requireExactInlineSecretReference(
      block,
      logicalId,
      'DATABASE_RUNTIME_PASSWORD',
      `WorkloadBoundaries.Outputs.${secretOutput}`,
      'password',
      errors,
    );
    const environment = indentedPropertyBlock(block, 'Environment') ?? '';
    const workloadBindings =
      environment.match(
        new RegExp(
          `^\\s*-\\s*\\{\\s*Name:\\s*APPLICATION_WORKLOAD,\\s*Value:\\s*${workload}\\s*\\}\\s*$`,
          'gm',
        ),
      ) ?? [];
    if (workloadBindings.length !== 1) {
      errors.push(`${logicalId} must bind exactly one APPLICATION_WORKLOAD=${workload}.`);
    }
    requireExactInlineEnvironmentReference(block, logicalId, 'APP_ENV', 'EnvironmentName', errors);
    requireExactInlineEnvironmentReference(block, logicalId, 'SQS_QUEUE_URL', 'JobQueue', errors);
    requireExactInlineEnvironmentReference(
      block,
      logicalId,
      'SQS_DEAD_LETTER_QUEUE_URL',
      'JobDeadLetterQueue',
      errors,
    );
  }
  const redisBindingErrors = [];
  requireExactGetAttEnvironmentReference(
    apiTaskDefinition,
    'ApiTaskDefinition',
    'REDIS_USERNAME',
    'WorkloadBoundaries.Outputs.RedisActiveUsername',
    redisBindingErrors,
  );
  if (
    redisBindingErrors.length > 0 ||
    !/^\s*-\s*\{\s*Name:\s*REDIS_TLS,\s*Value:\s*['"]true['"]\s*\}\s*$/m.test(apiTaskDefinition)
  ) {
    errors.push(
      'ApiTaskDefinition must bind the active environment-scoped Redis ACL identity over TLS.',
    );
  }
  if (/\bREDIS_[A-Z0-9_]+\b/.test(workerTaskDefinition)) {
    errors.push('WorkerTaskDefinition must remain a Redis nonconsumer with no REDIS_* bindings.');
  }
  const webTaskDefinition = resources.get('WebTaskDefinition') ?? '';
  if (/\bName:\s*SQS_(?:DEAD_LETTER_)?QUEUE_URL\b/.test(webTaskDefinition)) {
    errors.push('WebTaskDefinition must not receive an SQS queue destination.');
  }

  const apiTargetGroup = resources.get('ApiTargetGroup') ?? '';
  if (!hasProperty(apiTargetGroup, 'HealthCheckPath', '/api/v1/internal/health/dependencies')) {
    errors.push('ApiTargetGroup must gate traffic on dependency and migration readiness.');
  }

  const workerTaskRole = resources.get('WorkerTaskRole') ?? '';
  if (!/sqs:GetQueueAttributes/.test(workerTaskRole) || !/sqs:SendMessage/.test(workerTaskRole)) {
    errors.push('WorkerTaskRole must support exact queue readiness and publishing operations.');
  }
  const workerResourceValues = [...workerTaskRole.matchAll(/^\s+Resource:\s*(.+?)\s*$/gm)].map(
    (match) => match[1],
  );
  const expectedWorkerResourceValues = [
    '!GetAtt JobQueue.Arn',
    '[!GetAtt JobQueue.Arn, !GetAtt JobDeadLetterQueue.Arn]',
    '!GetAtt ApplicationDataKey.Arn',
  ];
  if (workerResourceValues.join('|') !== expectedWorkerResourceValues.join('|')) {
    errors.push(
      'WorkerTaskRole resources must bind exactly to JobQueue, JobDeadLetterQueue, and ApplicationDataKey.',
    );
  }
  const apiTaskRole = resources.get('ApiTaskRole') ?? '';
  const apiResourceValues = [...apiTaskRole.matchAll(/^\s+Resource:\s*(.+?)\s*$/gm)].map(
    (match) => match[1],
  );
  if (apiResourceValues.join('|') !== '[!GetAtt JobQueue.Arn, !GetAtt JobDeadLetterQueue.Arn]') {
    errors.push('ApiTaskRole resources must bind exactly to JobQueue and JobDeadLetterQueue.');
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
  const httpsListener = resources.get('HttpsListener') ?? '';
  if (
    !/Type:\s*fixed-response/.test(httpsListener) ||
    !hasProperty(httpsListener, 'StatusCode', '404')
  ) {
    errors.push('The HTTPS listener must reject unmatched hostnames with a fixed 404 response.');
  }
  if (!hasProperty(httpsListener, 'SslPolicy', 'ELBSecurityPolicy-TLS13-1-2-2021-06')) {
    errors.push('The HTTPS listener must use the reviewed TLS 1.2/1.3 policy.');
  }
  const internalDenyPathRegex = '^/[aA][pP][iI]/[vV]1/[iI][nN][tT][eE][rR][nN][aA][lL]/.*$';
  const internalDenyRule = resources.get('HttpsInternalApiDenyRule') ?? '';
  if (
    !/ListenerArn:\s*!Ref\s+HttpsListener/.test(internalDenyRule) ||
    !hasProperty(internalDenyRule, 'Priority', '5') ||
    !/Type:\s*fixed-response/.test(internalDenyRule) ||
    !/StatusCode:\s*['"]?404['"]?/.test(internalDenyRule) ||
    /Type:\s*forward|TargetGroupArn:/.test(internalDenyRule) ||
    !/Field:\s*host-header/.test(internalDenyRule) ||
    !/Field:\s*path-pattern/.test(internalDenyRule) ||
    !/HostHeaderConfig:[\s\S]*!Ref\s+ApplicationHostname/.test(internalDenyRule) ||
    !internalDenyRule.includes(`RegexValues: ['${internalDenyPathRegex}']`)
  ) {
    errors.push(
      'HttpsInternalApiDenyRule must case-insensitively reject the internal API prefix with fixed 404 at priority 5.',
    );
  }
  const httpsApiRule = resources.get('HttpsApiListenerRule') ?? '';
  if (
    !/ListenerArn:\s*!Ref\s+HttpsListener/.test(httpsApiRule) ||
    !hasProperty(httpsApiRule, 'Priority', '10') ||
    !/Type:\s*forward/.test(httpsApiRule) ||
    !/TargetGroupArn:\s*!Ref\s+ApiTargetGroup/.test(httpsApiRule) ||
    !httpsApiRule.includes('PathPatternConfig: { Values: [/api/v1/*] }')
  ) {
    errors.push(
      'HttpsApiListenerRule must forward the public API only after the internal deny rule.',
    );
  }
  const httpListener = resources.get('HttpRedirectListener') ?? '';
  if (
    !/Type:\s*fixed-response/.test(httpListener) ||
    !hasProperty(httpListener, 'StatusCode', '404')
  ) {
    errors.push('The HTTP listener must reject unmatched hostnames with a fixed 404 response.');
  }
  const listenerRules = entriesOf(inventory, 'AWS::ElasticLoadBalancingV2::ListenerRule');
  if (
    listenerRules.length < 4 ||
    listenerRules.some(
      ({ block }) => !/HostHeaderConfig:[\s\S]*!Ref\s+ApplicationHostname/.test(block),
    )
  ) {
    errors.push('Every HTTPS forwarding rule must require the approved ApplicationHostname.');
  }
  const httpRedirectRule = resources.get('HttpRedirectListenerRule') ?? '';
  if (
    !/ListenerArn:\s*!Ref\s+HttpRedirectListener/.test(httpRedirectRule) ||
    !/Type:\s*redirect/.test(httpRedirectRule) ||
    !/HostHeaderConfig:[\s\S]*!Ref\s+ApplicationHostname/.test(httpRedirectRule)
  ) {
    errors.push('Only the approved hostname may receive an HTTP-to-HTTPS redirect.');
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
  const database = resources.get('Database') ?? '';
  if (
    !/MasterUsername:\s*!Sub\s+'\{\{resolve:secretsmanager:\$\{DatabaseCredentialsSecret\}:SecretString:username\}\}'/.test(
      database,
    ) ||
    !/MasterUserPassword:\s*!Sub\s+'\{\{resolve:secretsmanager:\$\{DatabaseCredentialsSecret\}:SecretString:password\}\}'/.test(
      database,
    ) ||
    /DatabaseRuntimeCredentialsSecret/.test(database)
  ) {
    errors.push(
      'Database must preserve DatabaseCredentialsSecret as its bootstrap master credential.',
    );
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
    if (logicalId === 'DatabaseSecurityGroup' || logicalId === 'RedisSecurityGroup') {
      continue;
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
    "Assert-RequiredValue -Name 'AcmDnsControlRecordFile'",
    "'validate-acm-dns-control-record.mjs'",
    "'--mode', 'prerequisite'",
    '$acmDnsValidation.externalCallsMade -ne 0',
    '$acmDnsValidation.tlsConnectionsMade -ne 0',
    '$acmDnsValidation.resourcesCreated -ne 0',
    'acm-dns-record-sha256=',
    '$parameterMap.AlbCertificateArn -cne [string] $acmDnsBinding.certificateArn',
    '$parameterMap.ApplicationHostname -cne [string] $acmDnsBinding.applicationHostname',
    "'validate-application-workload-boundaries.mjs'",
    'Get-FileHash -LiteralPath $resolvedWorkloadBoundariesTemplate -Algorithm SHA256',
    "Assert-RequiredValue -Name 'WorkloadBoundariesArtifactBucket'",
    "Assert-RequiredValue -Name 'WorkloadBoundariesArtifactVersionId'",
    'Assert-RegionalS3ManagedPrefixList',
    "'describe-managed-prefix-lists'",
    "-Name 'OwnerId'",
    "-cne 'AWS'",
    'application-workload-boundaries-$workloadBoundariesTemplateSha256.yaml',
    '$pinnedChildHashMatch.Groups[1].Value -cne $workloadBoundariesTemplateSha256',
    "does not match the parent template's exact AllowedValue and content-addressed TemplateURL pin",
    'bucket=$WorkloadBoundariesArtifactBucket',
    "'get-bucket-location'",
    "'get-bucket-versioning'",
    "'get-object'",
    "'--expected-bucket-owner', $ExpectedOwner",
    "'--version-id', $VersionId",
    "'--include-nested-stacks'",
    'WorkloadBoundariesTemplateUrl = $workloadBoundariesTemplateUrl',
    'WorkloadBoundariesTemplateSha256 = $workloadBoundariesTemplateSha256',
    'WorkloadBoundariesArtifactBindingSha256 = $workloadBoundariesArtifactBindingSha256',
    'child-template-sha256=',
    'child-artifact-binding-sha256=',
    "'workload-boundaries-sha256' = $workloadBoundariesTemplateSha256",
    "'workload-boundaries-binding-sha256' = $workloadBoundariesArtifactBindingSha256",
    '$changeSetParameterMap.Count -ne $parameterMap.Count',
    '$reviewedParameterSha256 -cne $parameterSha256',
    '$currentLocalChildSha256 -cne $workloadBoundariesTemplateSha256',
    '$reviewedNonSecretControlParameters',
    "$allowedCredentialPhases = @('A_ONLY', 'BOTH_USE_A', 'BOTH_USE_B', 'B_ONLY')",
    'RedisOperatorMode must use exactly DISABLED or ENABLED.',
    '$changeSetCapabilities.Count -ne 1',
    '$parentChangeSetId',
    '$stackId',
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
    '$expectedAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET',
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
    !source.includes(
      'Get-FileHash -LiteralPath $resolvedWorkloadBoundariesTemplate -Algorithm SHA256',
    ) ||
    !source.includes("'--description', $expectedChangeSetDescription") ||
    !source.includes('$changeSet.Description -cne $expectedChangeSetDescription') ||
    !source.includes('GetEnumerator() | Sort-Object Key') ||
    !source.includes('$submittedTemplateSha256 -cne $templateSha256') ||
    !source.includes('$reviewedParameterSha256 -cne $parameterSha256') ||
    !source.includes('Assert-WorkloadBoundariesArtifact')
  ) {
    errors.push(
      'Plan and Deploy must bind the reviewed change set to exact template and parameter SHA-256 values and verify the submitted Original template.',
    );
  }
  for (const prohibitedArtifactMutation of ["'put-object'", "'create-bucket'", "'delete-object'"]) {
    if (source.includes(prohibitedArtifactMutation)) {
      errors.push(
        `Deployment guard must remain read-only for the pre-staged workload-boundary artifact; found ${prohibitedArtifactMutation}.`,
      );
    }
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
    '*.acm-dns.local.json',
    '*.acm-dns-plan.local.json',
    '*.acm-dns-evidence.local.json',
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
      /\.acm-dns\.local\.json$/i.test(name) ||
      /\.acm-dns-plan\.local\.json$/i.test(name) ||
      /\.acm-dns-evidence\.local\.json$/i.test(name) ||
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
    templateSha256: applicationSource ? sha256(applicationSource) : undefined,
    reviewedTemplateSha256: reviewedApplicationBaselineSha256,
    deploymentGuard: guardPath,
    residualLimitations: noExternalEgressResidualLimitations,
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
        `Known residual limitation: ${noExternalEgressResidualLimitations[0]}`,
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
