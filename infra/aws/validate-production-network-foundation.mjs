#!/usr/bin/env node

// Inspects a local CloudFormation document. This module has no deployment authority.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';

export const MAX_PRODUCTION_NETWORK_TEMPLATE_BYTES = 51_200;
export const PRODUCTION_NETWORK_TEMPLATE_PATH = fileURLToPath(
  new URL('./production-network-foundation.json', import.meta.url),
);
const provisioningCondition = 'ProvisionNetwork';
const acknowledgement = 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES';
const ref = (name) => ({ Ref: name });
const sub = (value) => ({ 'Fn::Sub': value });
const enabled = { 'Fn::Equals': [ref('ActivationMode'), 'PROVISION_INERT'] };
const groupDescriptions = Object.freeze({
  ApiTaskSecurityGroup: 'API tasks',
  WebTaskSecurityGroup: 'Web tasks',
  OutboxWorkerSecurityGroup: 'Outbox worker tasks',
  BalanceConsumerSecurityGroup: 'Balance consumer tasks',
  MigrationTaskSecurityGroup: 'Database migration tasks',
  DatabaseSecurityGroup: 'PostgreSQL database',
  RedisSecurityGroup: 'Redis cache',
  InterfaceEndpointSecurityGroup: 'Future private AWS service endpoints',
});

function requireEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected))
    throw new Error(`${label} violates the network policy.`);
}

function requireKeys(value, names, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  requireEqual(Object.keys(value).sort(), [...names].sort(), label);
}

function requireDescription(value, label) {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,1024}$/u.test(value)) {
    throw new Error(`${label} must be a bounded description.`);
  }
}

function validateParameters(parameters) {
  requireKeys(
    parameters,
    [
      'ActivationMode',
      'BillingAcknowledgement',
      'NetworkOctet',
      'AvailabilityZoneA',
      'AvailabilityZoneB',
    ],
    'Parameters',
  );
  requireEqual(
    parameters.ActivationMode,
    {
      Type: 'String',
      Default: 'DISABLED',
      AllowedValues: ['DISABLED', 'PROVISION_INERT'],
    },
    'Activation defaults',
  );
  requireEqual(
    parameters.BillingAcknowledgement,
    {
      Type: 'String',
      Default: 'NOT_AUTHORIZED',
      AllowedValues: ['NOT_AUTHORIZED', acknowledgement],
    },
    'Provisioning acknowledgement',
  );
  requireKeys(
    parameters.NetworkOctet,
    ['Type', 'Default', 'AllowedPattern', 'Description'],
    'Network octet',
  );
  requireEqual(parameters.NetworkOctet.Type, 'String', 'Network octet type');
  requireEqual(parameters.NetworkOctet.Default, '43', 'Network octet default');
  requireEqual(
    parameters.NetworkOctet.AllowedPattern,
    '^(?:0|[1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])$',
    'Network octet range',
  );
  requireDescription(parameters.NetworkOctet.Description, 'Network octet');
  for (const zone of ['A', 'B']) {
    const parameter = parameters[`AvailabilityZone${zone}`];
    requireKeys(parameter, ['Type', 'Description'], 'Availability Zone parameter');
    requireEqual(parameter.Type, 'AWS::EC2::AvailabilityZone::Name', 'Availability Zone type');
    requireDescription(parameter.Description, 'Availability Zone');
  }
}

function validateRules(rules) {
  const assertions = {
    ProvisioningRequiresAcknowledgement: {
      'Fn::Equals': [ref('BillingAcknowledgement'), acknowledgement],
    },
    AvailabilityZonesMustDiffer: {
      'Fn::Not': [{ 'Fn::Equals': [ref('AvailabilityZoneA'), ref('AvailabilityZoneB')] }],
    },
  };
  requireKeys(rules, Object.keys(assertions), 'Provisioning rules');
  for (const [id, assertion] of Object.entries(assertions)) {
    requireKeys(rules[id], ['RuleCondition', 'Assertions'], id);
    requireEqual(rules[id].RuleCondition, enabled, `${id} condition`);
    if (!Array.isArray(rules[id].Assertions) || rules[id].Assertions.length !== 1) {
      throw new Error('Each provisioning rule must have exactly one assertion.');
    }
    const entry = rules[id].Assertions[0];
    requireKeys(entry, ['Assert', 'AssertDescription'], id);
    requireEqual(entry.Assert, assertion, id);
    requireDescription(entry.AssertDescription, id);
  }
}

function expectedResources() {
  const resources = {};
  function add(id, type, properties, tagged = true) {
    resources[id] = {
      Type: type,
      Condition: provisioningCondition,
      Properties: {
        ...properties,
        ...(tagged
          ? {
              Tags: [
                { Key: 'project', Value: 'crypto-lending' },
                { Key: 'environment', Value: 'production' },
                { Key: 'Name', Value: sub('${AWS::StackName}-' + id) },
              ],
            }
          : {}),
      },
    };
  }
  add('Vpc', 'AWS::EC2::VPC', {
    CidrBlock: sub('10.${NetworkOctet}.0.0/16'),
    EnableDnsSupport: true,
    EnableDnsHostnames: true,
    InstanceTenancy: 'default',
  });
  for (const [tier, octets] of [
    ['Workload', [10, 11]],
    ['Data', [20, 21]],
  ]) {
    for (const [index, zone] of ['A', 'B'].entries()) {
      const subnet = `${tier}Subnet${zone}`;
      const routeTable = `${tier}RouteTable${zone}`;
      add(subnet, 'AWS::EC2::Subnet', {
        VpcId: ref('Vpc'),
        AvailabilityZone: ref(`AvailabilityZone${zone}`),
        CidrBlock: sub('10.${NetworkOctet}.' + octets[index] + '.0/24'),
        MapPublicIpOnLaunch: false,
        AssignIpv6AddressOnCreation: false,
        EnableDns64: false,
      });
      add(routeTable, 'AWS::EC2::RouteTable', { VpcId: ref('Vpc') });
      add(
        `${tier}RouteAssociation${zone}`,
        'AWS::EC2::SubnetRouteTableAssociation',
        {
          SubnetId: ref(subnet),
          RouteTableId: ref(routeTable),
        },
        false,
      );
    }
  }
  for (const [id, description] of Object.entries(groupDescriptions)) {
    add(id, 'AWS::EC2::SecurityGroup', {
      GroupDescription: `${description} - isolated production foundation`,
      VpcId: ref('Vpc'),
      SecurityGroupIngress: [],
      // A nonempty loopback rule suppresses EC2's automatic allow-all egress rule.
      SecurityGroupEgress: [{ CidrIp: '127.0.0.1/32', IpProtocol: '-1' }],
    });
  }
  return resources;
}

function validateDocument(template) {
  requireKeys(
    template,
    [
      'AWSTemplateFormatVersion',
      'Description',
      'Metadata',
      'Parameters',
      'Rules',
      'Conditions',
      'Resources',
      'Outputs',
    ],
    'Template sections',
  );
  requireEqual(template.AWSTemplateFormatVersion, '2010-09-09', 'Template version');
  requireDescription(template.Description, 'Template');
  requireEqual(
    template.Metadata,
    {
      CryptoLendingProductionNetworkFoundation: {
        SchemaVersion: 1,
        Environment: 'production',
        Scope: 'NETWORK_FOUNDATION_ONLY',
        DefaultResourceCount: 0,
        PublicIngress: 'ABSENT',
        InternetRoute: 'ABSENT',
        LaunchApproval: 'NOT_APPROVED',
      },
    },
    'Foundation scope',
  );
  validateParameters(template.Parameters);
  validateRules(template.Rules);
  requireEqual(template.Conditions, { ProvisionNetwork: enabled }, 'Resource activation condition');

  const resources = expectedResources();
  requireKeys(template.Resources, Object.keys(resources), 'Resource allowlist');
  const outputs = {
    FoundationScope: { Value: 'NETWORK_FOUNDATION_ONLY' },
    ActivationMode: { Value: ref('ActivationMode') },
  };
  for (const [id, expected] of Object.entries(resources)) {
    requireEqual(template.Resources[id], expected, id);
    if (expected.Type !== 'AWS::EC2::SubnetRouteTableAssociation') {
      outputs[`${id}Id`] = { Condition: provisioningCondition, Value: ref(id) };
    }
  }
  requireEqual(template.Outputs, outputs, 'Conditional resource outputs');
  return Object.keys(resources).length;
}

export function validateProductionNetworkBytes(bytes) {
  const report = {
    ok: false,
    scope: 'LOCAL_TEMPLATE_VALIDATION',
    deploymentAuthorized: false,
    awsCallsMade: 0,
    resourcesProvisioned: 0,
    errors: [],
  };
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_PRODUCTION_NETWORK_TEMPLATE_BYTES
  ) {
    return { ...report, errors: ['Template must contain between 1 and 51200 bytes.'] };
  }
  try {
    const template = parseStrictJsonBytes(bytes);
    const definedResources = validateDocument(template);
    return {
      ...report,
      ok: true,
      definedResources,
      defaultResources: 0,
      templateSha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    return { ...report, errors: [error instanceof Error ? error.message : 'Template is invalid.'] };
  }
}

export function validateProductionNetworkFile(path = PRODUCTION_NETWORK_TEMPLATE_PATH) {
  try {
    return validateProductionNetworkBytes(
      readSecureLocalFile(path, MAX_PRODUCTION_NETWORK_TEMPLATE_BYTES),
    );
  } catch {
    return {
      ok: false,
      scope: 'LOCAL_TEMPLATE_VALIDATION',
      deploymentAuthorized: false,
      awsCallsMade: 0,
      resourcesProvisioned: 0,
      errors: ['Template must be a stable, single-link regular file at a canonical local path.'],
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  let template = PRODUCTION_NETWORK_TEMPLATE_PATH;
  let json = false;
  let templateSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json' && !json) {
      json = true;
    } else if (
      args[index] === '--template' &&
      !templateSeen &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    ) {
      template = args[++index];
      templateSeen = true;
    } else {
      process.stderr.write(
        'Usage: validate-production-network-foundation.mjs [--template <local-file>] [--json].\n',
      );
      process.exitCode = 2;
      return;
    }
  }
  const report = validateProductionNetworkFile(template);
  process.stdout.write(
    json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `Production network foundation: ${report.ok ? 'PASS' : 'FAIL'}. AWS calls: 0. Deployment authorized: false.\n${report.errors.map((error) => `${error}\n`).join('')}`,
  );
  process.exitCode = report.ok ? 0 : 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
