import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { validateSqsFoundationSource } from './validate-sqs-foundation.mjs';

const validatorPath = join(import.meta.dirname, 'validate-application-baseline.mjs');
const templatePath = join(import.meta.dirname, 'application-baseline.yaml');
const templateSource = readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n');
const sqsFoundationPath = join(import.meta.dirname, 'sqs-foundation.yaml');
const sqsFoundationSource = readFileSync(sqsFoundationPath, 'utf8').replace(/\r\n/g, '\n');

function runValidator(source = templateSource) {
  const directory = mkdtempSync(join(tmpdir(), 'kan-231-application-validator-'));
  const path = join(directory, 'application-baseline.yaml');
  writeFileSync(path, source, 'utf8');

  try {
    const result = spawnSync(process.execPath, [validatorPath, '--template', path, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
      windowsHide: true,
    });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.error, undefined, result.error?.message);
    const report = JSON.parse(result.stdout);
    assert.equal(report.awsCallsMade, 0);
    return { report, status: result.status };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function mutate(replace) {
  const result = replace(templateSource);
  assert.notEqual(result, templateSource, 'Test mutation must change the baseline template.');
  return result;
}

function addResource(source, resource) {
  return source.replace(/^Resources:\s*$/m, `Resources:\n${resource}`);
}

function assertRejected(source, messagePattern) {
  const { report, status } = runValidator(source);
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert(
    report.errors.some((error) => messagePattern.test(error)),
    `Expected ${messagePattern}; received:\n${report.errors.join('\n')}`,
  );
}

test('accepts the repository no-external-egress baseline and records the DNS residual', () => {
  const { report, status } = runValidator();
  assert.equal(status, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.residualLimitations.length, 1);
  assert.match(report.residualLimitations[0], /port 53 to the VPC CIDR/);
  assert.match(report.residualLimitations[0], /cannot prove/);
});

test('standalone SQS foundation denies insecure transport to both queues', () => {
  const report = validateSqsFoundationSource(sqsFoundationSource);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.awsCallsMade, 0);
});

test('standalone SQS validator rejects weakened or incomplete TLS queue policies', () => {
  for (const [search, replacement] of [
    ['            Effect: Deny', '            Effect: Allow'],
    ["            Principal: '*'", '            Principal: { Service: ecs-tasks.amazonaws.com }'],
    ['            Action: sqs:*', '            Action: sqs:SendMessage'],
    ['              - !GetAtt JobDeadLetterQueue.Arn', '              - !GetAtt JobQueue.Arn'],
    ["                aws:SecureTransport: 'false'", "                aws:SecureTransport: 'true'"],
    [
      "                aws:SecureTransport: 'false'",
      "                aws:SecureTransport: 'false'\n              StringEquals:\n                aws:PrincipalArn: arn:aws:iam::000000000000:root",
    ],
  ]) {
    const mutated = sqsFoundationSource.replace(search, replacement);
    assert.notEqual(mutated, sqsFoundationSource, `Mutation did not replace ${search}.`);
    const report = validateSqsFoundationSource(mutated);
    assert.equal(report.ok, false);
    assert.equal(report.awsCallsMade, 0);
    assert(
      report.errors.some((error) => /must deny all SQS actions/.test(error)),
      report.errors.join('\n'),
    );
  }
});

test('rejects URI, UNC, and device template inputs before any filesystem access', () => {
  for (const input of [
    'https://example.invalid/application-baseline.yaml',
    '\\\\server\\share\\application-baseline.yaml',
    '\\\\?\\C:\\outside\\application-baseline.yaml',
  ]) {
    const result = spawnSync(process.execPath, [validatorPath, '--template', input, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
      windowsHide: true,
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /local filesystem path, not a URI or network path/);
    assert.equal(result.stdout, '');
  }
});

test('rejects a symbolic-link template without following it', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'kan-231-application-symlink-'));
  const path = join(directory, 'application-baseline.yaml');
  try {
    try {
      symlinkSync(templatePath, path, 'file');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        context.skip(`Host does not permit test symlink creation: ${error.code}`);
        return;
      }
      throw error;
    }

    const result = spawnSync(process.execPath, [validatorPath, '--template', path, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.awsCallsMade, 0);
    assert(report.errors.some((error) => /not a symbolic link/.test(error)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects private default and transit routes', () => {
  const privateDefaultRoute = [
    '  UnexpectedPrivateDefaultRoute:',
    '    Type: AWS::EC2::Route',
    '    Properties:',
    '      DestinationCidrBlock: 0.0.0.0/0',
    '      GatewayId: !Ref InternetGateway',
    '      RouteTableId: !Ref PrivateRouteTableA',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, privateDefaultRoute)),
    /Explicit route allowlist contains unapproved resource/,
  );

  const privateTransitRoute = [
    '  UnexpectedPrivateTransitRoute:',
    '    Type: AWS::EC2::Route',
    '    Properties:',
    '      DestinationCidrBlock: 10.99.0.0/16',
    '      RouteTableId: !Ref PrivateRouteTableB',
    '      TransitGatewayId: tgw-not-approved',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, privateTransitRoute)),
    /Explicit route allowlist contains unapproved resource/,
  );
});

test('rejects a NAT gateway', () => {
  const resource = [
    '  UnexpectedNatGateway:',
    '    Type: AWS::EC2::NatGateway',
    '    Properties:',
    '      SubnetId: !Ref PublicSubnetA',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resource)),
    /UnexpectedNatGateway uses prohibited external-egress or proxy resource type AWS::EC2::NatGateway/,
  );
});

test('rejects an Elastic IP', () => {
  const resource = [
    '  UnexpectedEip:',
    '    Type: AWS::EC2::EIP',
    '    Properties:',
    '      Domain: vpc',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resource)),
    /UnexpectedEip uses prohibited external-egress or proxy resource type AWS::EC2::EIP/,
  );
});

test('rejects public IP assignment for application tasks', () => {
  const source = mutate((value) =>
    value.replace('          AssignPublicIp: DISABLED', '          AssignPublicIp: ENABLED'),
  );
  assertRejected(source, /must disable public IPs|must never enable public IP assignment/);
});

test('rejects an additional ECS task security group', () => {
  const source = mutate((value) =>
    value.replace(
      '          SecurityGroups:\n            - !Ref WebTaskSecurityGroup\n          Subnets:',
      '          SecurityGroups:\n            - !Ref WebTaskSecurityGroup\n            - !Ref LoadBalancerSecurityGroup\n          Subnets:',
    ),
  );
  assertRejected(source, /WebService must use only the reviewed WebTaskSecurityGroup identity/);
});

test('rejects an additional ECS task subnet', () => {
  const source = mutate((value) =>
    value
      .replace(
        /^Parameters:\s*$/m,
        'Parameters:\n  UnapprovedTaskSubnetId:\n    Type: AWS::EC2::Subnet::Id',
      )
      .replace(
        '          Subnets:\n            - !Ref PrivateSubnetA\n            - !Ref PrivateSubnetB\n      PlatformVersion:',
        '          Subnets:\n            - !Ref PrivateSubnetA\n            - !Ref PrivateSubnetB\n            - !Ref UnapprovedTaskSubnetId\n      PlatformVersion:',
      ),
  );
  assertRejected(source, /must use exactly PrivateSubnetA and PrivateSubnetB/);
});

test('rejects private route propagation', () => {
  const resource = [
    '  UnexpectedVpnRoutePropagation:',
    '    Type: AWS::EC2::VPNGatewayRoutePropagation',
    '    Properties:',
    '      RouteTableIds:',
    '        - !Ref PrivateRouteTableA',
    '        - !Ref PrivateRouteTableB',
    '      VpnGatewayId: vgw-not-approved',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resource)),
    /UnexpectedVpnRoutePropagation uses prohibited external-egress/,
  );
});

test('rejects VPN replacement of the reviewed internet-gateway attachment', () => {
  const source = mutate((value) =>
    value.replace(
      '      InternetGatewayId: !Ref InternetGateway',
      '      VpnGatewayId: vgw-not-approved',
    ),
  );
  assertRejected(source, /InternetGatewayId to equal|must not attach a VPN gateway/);
});

test('rejects custom VPC DNS options and associations', () => {
  const resources = [
    '  UnexpectedDhcpOptions:',
    '    Type: AWS::EC2::DHCPOptions',
    '    Properties:',
    '      DomainNameServers:',
    '        - 10.42.0.10',
    '  UnexpectedDhcpAssociation:',
    '    Type: AWS::EC2::VPCDHCPOptionsAssociation',
    '    Properties:',
    '      DhcpOptionsId: !Ref UnexpectedDhcpOptions',
    '      VpcId: !Ref Vpc',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resources)),
    /UnexpectedDhcpOptions uses prohibited external-egress|UnexpectedDhcpAssociation uses prohibited external-egress/,
  );
});

test('rejects custom Route 53 Resolver forwarding rules and associations', () => {
  const resources = [
    '  UnexpectedResolverRule:',
    '    Type: AWS::Route53Resolver::ResolverRule',
    '    Properties:',
    '      DomainName: vendor.com.',
    '      Name: not-approved',
    '      ResolverEndpointId: rslvr-out-0123456789abcdef0',
    '      RuleType: FORWARD',
    '      TargetIps:',
    '        - Ip: 203.0.113.10',
    '          Port: 53',
    '  UnexpectedResolverRuleAssociation:',
    '    Type: AWS::Route53Resolver::ResolverRuleAssociation',
    '    Properties:',
    '      ResolverRuleId: !Ref UnexpectedResolverRule',
    '      VPCId: !Ref Vpc',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resources)),
    /UnexpectedResolverRule uses prohibited external-egress routing resource type AWS::Route53Resolver::ResolverRule/,
  );
});

test('rejects broad task security-group egress', () => {
  const source = mutate((value) =>
    value.replace('      CidrIp: !Ref VpcCidr', '      CidrIp: 0.0.0.0/0'),
  );
  assertRejected(source, /must not allow broad standalone egress|must use only CidrIp/);
});

test('rejects an additional VPC endpoint', () => {
  const resource = [
    '  UnexpectedSnsEndpoint:',
    '    Type: AWS::EC2::VPCEndpoint',
    '    Condition: UseVpcEndpoints',
    '    Properties:',
    '      ServiceName: !Sub com.amazonaws.${AWS::Region}.sns',
    '      VpcEndpointType: Interface',
    '      VpcId: !Ref Vpc',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resource)),
    /Private VPC endpoint allowlist contains unapproved resource UnexpectedSnsEndpoint/,
  );
});

test('rejects widening the S3 endpoint policy beyond ECR image layers', () => {
  const source = mutate((value) =>
    value
      .replace('            Action: s3:GetObject', '            Action: s3:*')
      .replace(
        '            Resource: !Sub arn:${AWS::Partition}:s3:::prod-${AWS::Region}-starport-layer-bucket/*',
        "            Resource: '*'",
      ),
  );
  const { report, status } = runValidator(source);
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert(report.errors.some((error) => error.includes('Action to equal s3:GetObject')));
  assert(report.errors.some((error) => error.includes('Resource to equal')));
});

test('rejects an unapproved paid network-firewall egress architecture', () => {
  const resource = [
    '  UnexpectedEgressFirewall:',
    '    Type: AWS::NetworkFirewall::Firewall',
    '    Properties:',
    '      FirewallName: not-approved',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resource)),
    /UnexpectedEgressFirewall uses prohibited external-egress or proxy resource type AWS::NetworkFirewall::Firewall/,
  );
});

test('rejects a proxy compute resource', () => {
  const resource = [
    '  UnexpectedOutboundProxy:',
    '    Type: AWS::EC2::Instance',
    '    Properties:',
    '      InstanceType: t4g.nano',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resource)),
    /UnexpectedOutboundProxy uses prohibited external-egress or proxy resource type AWS::EC2::Instance/,
  );
});

test('rejects any resource outside the complete reviewed logical-ID and type graph', () => {
  const lightsailResource = [
    '  UnexpectedPaidProxy:',
    '    Type: AWS::Lightsail::Instance',
    '    Properties:',
    '      AvailabilityZone: us-west-2a',
    '      BlueprintId: amazon_linux_2',
    '      BundleId: nano_3_0',
    '      InstanceName: unexpected-paid-proxy',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, lightsailResource)),
    /Reviewed resource graph contains unapproved resource UnexpectedPaidProxy/,
  );

  const apiDestinationResource = [
    '  UnexpectedApiDestination:',
    '    Type: AWS::Events::ApiDestination',
    '    Properties:',
    '      ConnectionArn: arn:aws:events:us-west-2:111122223333:connection/existing/00000000-0000-0000-0000-000000000000',
    '      HttpMethod: POST',
    '      InvocationEndpoint: https://vendor.example/hook',
    '      Name: unexpected-external-egress',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, apiDestinationResource)),
    /Reviewed resource graph contains unapproved resource UnexpectedApiDestination/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '  OperationalDashboard:\n    Type: AWS::CloudWatch::Dashboard',
        '  OperationalDashboard:\n    Type: AWS::CloudWatch::Alarm',
      ),
    ),
    /OperationalDashboard must retain reviewed resource type AWS::CloudWatch::Dashboard/,
  );
});

test('rejects same-resource application egress mutations and any unreviewed property change', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '                Resource: !GetAtt JobQueue.Arn',
        '                Resource: arn:aws:sqs:us-west-2:999999999999:external-exfiltration-queue',
      ),
    ),
    /WorkerTaskRole resources must bind exactly to JobQueue/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '- { Name: SQS_QUEUE_URL, Value: !Ref JobQueue }',
        '- { Name: SQS_QUEUE_URL, Value: https:\/\/sqs.us-west-2.amazonaws.com\/999999999999\/external-exfiltration-queue }',
      ),
    ),
    /ApiTaskDefinition must bind exactly one SQS_QUEUE_URL environment value to !Ref JobQueue/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        'Description: KAN-34 billable app baseline.',
        'Description: Reviewed-boundary mutation.',
      ),
    ),
    /does not match the reviewed property-complete baseline/,
  );
});

test('rejects crossing the runtime and migration database credential boundary', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '                  - !Ref DatabaseRuntimeSecret',
        '                  - !Ref DatabaseCredentialsSecret',
      ),
    ),
    /BackendTaskExecutionRole must read the runtime database secret and must not read the migration\/admin secret/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        "ValueFrom: !Sub '${DatabaseRuntimeSecret}:password::'",
        "ValueFrom: !Sub '${DatabaseCredentialsSecret}:password::'",
      ),
    ),
    /must not reference the database migration\/admin secret/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '- { Name: DATABASE_RUNTIME_HOST, Value: !GetAtt Database.Endpoint.Address }',
        '- { Name: MIGRATION_DATABASE_HOST, Value: !GetAtt Database.Endpoint.Address }',
      ),
    ),
    /must not receive migration\/admin database variables/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '- { Name: DATABASE_RUNTIME_HOST, Value: !GetAtt Database.Endpoint.Address }',
        '- { Name: DATABASE_HOST, Value: !GetAtt Database.Endpoint.Address }',
      ),
    ),
    /must not receive legacy unscoped database variables/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '${DatabaseCredentialsSecret}:SecretString:username',
        '${DatabaseRuntimeSecret}:SecretString:username',
      ),
    ),
    /must preserve DatabaseCredentialsSecret as its migration\/admin master credential/,
  );
});

test('rejects weakening or ordering the internal readiness deny after the API forward', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '      HealthCheckPath: /api/v1/internal/health/dependencies',
        '      HealthCheckPath: /api/v1/health/dependencies',
      ),
    ),
    /ApiTargetGroup must gate traffic on dependency and migration readiness/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        "RegexValues: ['^/[aA][pP][iI]/[vV]1/[iI][nN][tT][eE][rR][nN][aA][lL]/.*$']",
        "RegexValues: ['^/api/v1/internal/.*$']",
      ),
    ),
    /must case-insensitively reject the internal API prefix/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '      Priority: 5\n\n  HttpsApiListenerRule:',
        '      Priority: 15\n\n  HttpsApiListenerRule:',
      ),
    ),
    /internal API prefix with fixed 404 at priority 5/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '      Priority: 10\n\n  HttpsWebListenerRule:',
        '      Priority: 4\n\n  HttpsWebListenerRule:',
      ),
    ),
    /must forward the public API only after the internal deny rule/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        "          FixedResponseConfig: { ContentType: text/plain, StatusCode: '404' }",
        '          TargetGroupArn: !Ref ApiTargetGroup',
      ),
    ),
    /internal API prefix with fixed 404 at priority 5/,
  );
});

test('rejects quoted logical IDs that could evade the resource inventory', () => {
  const resource = [
    '  "UnexpectedOutboundProxy":',
    '    Type: AWS::EC2::Instance',
    '    Properties:',
    '      InstanceType: t4g.nano',
  ].join('\n');
  assertRejected(
    mutate((source) => addResource(source, resource)),
    /logical IDs must use the canonical unquoted form/,
  );
});

test('rejects transforms, anchors, and merge keys that obscure the resource graph', () => {
  assertRejected(
    mutate((source) => `"Transform" : ExistingMacro\n${source}`),
    /transforms and macros are prohibited/,
  );

  assertRejected(
    mutate((source) =>
      source.replace('Resources:', 'Resources:\n  Shared: &shared\n    Type: AWS::EC2::Instance'),
    ),
    /anchors, aliases, and merge keys are prohibited/,
  );
});
