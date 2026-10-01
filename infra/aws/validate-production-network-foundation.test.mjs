import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MAX_PRODUCTION_NETWORK_TEMPLATE_BYTES,
  PRODUCTION_NETWORK_TEMPLATE_PATH,
  validateProductionNetworkBytes,
  validateProductionNetworkFile,
} from './validate-production-network-foundation.mjs';

const bytes = readFileSync(PRODUCTION_NETWORK_TEMPLATE_PATH);
const template = JSON.parse(bytes);
const encode = (value) => Buffer.from(JSON.stringify(value));
const groups = Object.entries(template.Resources).filter(
  ([, resource]) => resource.Type === 'AWS::EC2::SecurityGroup',
);
const validator = fileURLToPath(
  new URL('./validate-production-network-foundation.mjs', import.meta.url),
);

function rejected(mutate) {
  const changed = structuredClone(template);
  mutate(changed);
  const report = validateProductionNetworkBytes(encode(changed));
  assert.equal(report.ok, false, 'Unsafe template mutation must be rejected.');
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(report.awsCallsMade, 0);
  assert.ok(report.errors.length > 0);
}

// Evaluate the document's CloudFormation conditions independently of the validator.
function expression(value, parameters) {
  if (value === null || typeof value !== 'object') return value;
  if ('Ref' in value) return parameters[value.Ref];
  if ('Fn::Equals' in value) {
    const [left, right] = value['Fn::Equals'].map((item) => expression(item, parameters));
    return left === right;
  }
  if ('Fn::Not' in value) return !expression(value['Fn::Not'][0], parameters);
  throw new Error('Unsupported condition in the network foundation.');
}

function evaluateProvisioning(overrides = {}) {
  const parameters = Object.fromEntries(
    Object.entries(template.Parameters).map(([name, parameter]) => [name, parameter.Default]),
  );
  Object.assign(
    parameters,
    { AvailabilityZoneA: 'us-east-1a', AvailabilityZoneB: 'us-east-1b' },
    overrides,
  );
  const accepted = Object.values(template.Rules).every(
    (rule) =>
      !expression(rule.RuleCondition, parameters) ||
      rule.Assertions.every((item) => expression(item.Assert, parameters)),
  );
  const conditions = Object.fromEntries(
    Object.entries(template.Conditions).map(([name, condition]) => [
      name,
      expression(condition, parameters),
    ]),
  );
  const activeResources = Object.values(template.Resources).filter(
    (resource) => !resource.Condition || conditions[resource.Condition],
  );
  const resourceOutputs = Object.values(template.Outputs).filter(
    (output) => output.Condition && conditions[output.Condition],
  );
  return { accepted, resources: activeResources.length, resourceOutputs: resourceOutputs.length };
}

test('the reviewed foundation passes local inspection without granting deployment authority', () => {
  const report = validateProductionNetworkFile();
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.definedResources, 21);
  assert.equal(report.defaultResources, 0);
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(report.resourcesProvisioned, 0);
  assert.match(report.templateSha256, /^[a-f0-9]{64}$/u);
});

test('CloudFormation defaults produce no resources or resource outputs', () => {
  assert.deepEqual(evaluateProvisioning(), { accepted: true, resources: 0, resourceOutputs: 0 });
  assert.equal(
    evaluateProvisioning({
      BillingAcknowledgement: 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES',
    }).resources,
    0,
  );
});

test('provisioning requires explicit acknowledgement and two distinct zones', () => {
  const enabled = { ActivationMode: 'PROVISION_INERT' };
  assert.equal(evaluateProvisioning(enabled).accepted, false);
  const acknowledged = {
    ...enabled,
    BillingAcknowledgement: 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES',
  };
  assert.equal(
    evaluateProvisioning({ ...acknowledged, AvailabilityZoneB: 'us-east-1a' }).accepted,
    false,
  );
  assert.deepEqual(evaluateProvisioning(acknowledged), {
    accepted: true,
    resources: 21,
    resourceOutputs: 17,
  });
});

test('private addressing stays canonical, nonoverlapping, and inside one VPC', () => {
  const pattern = new RegExp(template.Parameters.NetworkOctet.AllowedPattern, 'u');
  for (let octet = 0; octet <= 255; octet += 1) assert.match(String(octet), pattern);
  // CloudFormation requires AllowedPattern to match the entire parameter value.
  for (const invalid of ['-1', '256', '043', '1.5', '1e2', '10/8', ' 43', '43\n'])
    assert.notEqual(pattern.exec(invalid)?.[0], invalid);
  const subnets = Object.values(template.Resources).filter(
    (resource) => resource.Type === 'AWS::EC2::Subnet',
  );
  const cidrs = subnets.map((resource) => resource.Properties.CidrBlock['Fn::Sub']);
  assert.equal(new Set(cidrs).size, 4);
  for (const subnet of subnets) {
    assert.deepEqual(subnet.Properties.VpcId, { Ref: 'Vpc' });
    assert.match(
      subnet.Properties.CidrBlock['Fn::Sub'],
      /^10\.\$\{NetworkOctet\}\.(?:10|11|20|21)\.0\/24$/u,
    );
    assert.equal(subnet.Properties.MapPublicIpOnLaunch, false);
    assert.equal(subnet.Properties.AssignIpv6AddressOnCreation, false);
  }
});

test('activation, acknowledgement, zone, and template-extension bypasses are rejected', () => {
  for (const mutate of [
    (value) => {
      value.Parameters.ActivationMode.Default = 'PROVISION_INERT';
    },
    (value) => {
      value.Parameters.ActivationMode.AllowedValues.push('ACTIVATE_READ_ONLY');
    },
    (value) => {
      value.Parameters.BillingAcknowledgement.Default =
        'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES';
    },
    (value) => {
      value.Parameters.NetworkOctet.AllowedPattern = '.*';
    },
    (value) => {
      value.Conditions.ProvisionNetwork = { 'Fn::Equals': ['yes', 'yes'] };
    },
    (value) => {
      delete value.Rules.ProvisioningRequiresAcknowledgement;
    },
    (value) => {
      value.Rules.AvailabilityZonesMustDiffer.Assertions[0].Assert = {
        'Fn::Equals': ['yes', 'yes'],
      };
    },
    (value) => {
      value.Transform = 'AWS::Serverless-2016-10-31';
    },
    (value) => {
      value.Metadata.CryptoLendingProductionNetworkFoundation.LaunchApproval = 'APPROVED';
    },
  ])
    rejected(mutate);
});

for (const id of Object.keys(template.Resources)) {
  test(`${id} cannot escape the shared disabled-by-default condition`, () => {
    rejected((value) => {
      delete value.Resources[id].Condition;
    });
    rejected((value) => {
      value.Resources[id].Condition = 'Always';
    });
    rejected((value) => {
      value.Resources[id].CreationPolicy = { ResourceSignal: { Count: 1 } };
    });
  });
}

for (const type of [
  'AWS::EC2::InternetGateway',
  'AWS::EC2::NatGateway',
  'AWS::EC2::EgressOnlyInternetGateway',
  'AWS::EC2::Route',
  'AWS::EC2::VPCEndpoint',
  'AWS::EC2::SecurityGroupIngress',
  'AWS::EC2::SecurityGroupEgress',
  'AWS::ECS::Service',
  'AWS::IAM::Role',
  'AWS::CloudFormation::Stack',
  'Custom::Provision',
]) {
  test(`unreviewed ${type} resources are rejected`, () => {
    rejected((value) => {
      value.Resources.Unreviewed = { Type: type, Condition: 'ProvisionNetwork', Properties: {} };
    });
  });
}

for (const [id] of groups) {
  test(`${id} has no inbound rule and cannot regain EC2 default or unrestricted outbound access`, () => {
    rejected((value) => {
      delete value.Resources[id].Properties.SecurityGroupEgress;
    });
    rejected((value) => {
      value.Resources[id].Properties.SecurityGroupEgress = [];
    });
    rejected((value) => {
      value.Resources[id].Properties.SecurityGroupEgress[0].CidrIp = '0.0.0.0/0';
    });
    rejected((value) => {
      value.Resources[id].Properties.SecurityGroupEgress.push({
        CidrIpv6: '::/0',
        IpProtocol: '-1',
      });
    });
    rejected((value) => {
      value.Resources[id].Properties.SecurityGroupIngress.push({
        CidrIp: '10.43.0.0/16',
        IpProtocol: '-1',
      });
    });
    rejected((value) => {
      value.Resources[id].Properties.VpcId = { 'Fn::ImportValue': 'unreviewed-vpc' };
    });
  });
}

test('subnet public-addressing, zone, route-association, and output drift is rejected', () => {
  for (const mutate of [
    (value) => {
      value.Resources.WorkloadSubnetA.Properties.MapPublicIpOnLaunch = true;
    },
    (value) => {
      value.Resources.DataSubnetB.Properties.AssignIpv6AddressOnCreation = true;
    },
    (value) => {
      value.Resources.WorkloadSubnetA.Properties.EnableDns64 = true;
    },
    (value) => {
      value.Resources.DataSubnetB.Properties.AvailabilityZone = { Ref: 'AvailabilityZoneA' };
    },
    (value) => {
      value.Resources.DataSubnetA.Properties.CidrBlock = {
        'Fn::Sub': '10.${NetworkOctet}.10.0/24',
      };
    },
    (value) => {
      value.Resources.WorkloadRouteAssociationA.Properties.RouteTableId = {
        Ref: 'DataRouteTableB',
      };
    },
    (value) => {
      delete value.Outputs.VpcId.Condition;
    },
    (value) => {
      value.Outputs.ApiTaskSecurityGroupId.Value = { Ref: 'WebTaskSecurityGroup' };
    },
    (value) => {
      value.Outputs.VpcId.Export = { Name: 'unreviewed-export' };
    },
  ])
    rejected(mutate);
});

test('ambiguous JSON, malformed UTF-8, BOMs, and out-of-bounds input are rejected', () => {
  for (const invalid of [
    Buffer.from(
      bytes.toString('utf8').replace('"Resources": {', '"Resources": {}, "Resources": {'),
    ),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.from([0xff]),
    Buffer.alloc(0),
    Buffer.alloc(MAX_PRODUCTION_NETWORK_TEMPLATE_BYTES + 1),
    Buffer.from('{"Resources":'),
    Buffer.from('null'),
    Buffer.from('[]'),
    undefined,
  ])
    assert.equal(validateProductionNetworkBytes(invalid).ok, false);
});

test('file validation rejects missing paths, directories, and hard links without disclosing paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'production-network-test-'));
  try {
    const file = join(directory, 'template.json');
    const linked = join(directory, 'linked.json');
    writeFileSync(file, bytes);
    assert.equal(validateProductionNetworkFile(file).ok, true);
    linkSync(file, linked);
    for (const path of [file, linked, directory, join(directory, 'missing-private-name.json')]) {
      const report = validateProductionNetworkFile(path);
      assert.equal(report.ok, false);
      assert.equal(
        report.errors.some((message) => message.includes(directory)),
        false,
      );
    }
  } finally {
    const target = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(target && !isAbsolute(target) && !target.startsWith('..'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI reports local validation only and rejects duplicate or deployment arguments', () => {
  const result = spawnSync(process.execPath, [validator, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).deploymentAuthorized, false);
  for (const args of [
    ['--deploy'],
    ['--json', '--json'],
    ['--template'],
    [
      '--template',
      PRODUCTION_NETWORK_TEMPLATE_PATH,
      '--template',
      PRODUCTION_NETWORK_TEMPLATE_PATH,
    ],
  ]) {
    const rejected = spawnSync(process.execPath, [validator, ...args], { encoding: 'utf8' });
    assert.equal(rejected.status, 2);
  }
});
