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
const validatorSource = readFileSync(validatorPath, 'utf8').replace(/\r\n/g, '\n');
const deploymentGuardPath = join(import.meta.dirname, 'invoke-application-baseline.ps1');
const deploymentGuardSource = readFileSync(deploymentGuardPath, 'utf8').replace(/\r\n/g, '\n');
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

function mutateNthNodeEnvironment(occurrence, replacement) {
  return mutate((source) => {
    let seen = 0;
    return source.replace(
      /^\s*-\s*\{\s*Name:\s*NODE_ENV,\s*Value:\s*production\s*\}\s*$/gm,
      (binding) => {
        seen += 1;
        return seen === occurrence ? replacement(binding) : binding;
      },
    );
  });
}

function addResource(source, resource) {
  return source.replace(/^Resources:\s*$/m, `Resources:\n${resource}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function mutateResourceBlock(source, logicalId, transform) {
  const pattern = new RegExp(
    `(^ ${logicalId}:\\n[\\s\\S]*?)(?=^ [A-Z][A-Za-z0-9]*:\\s*$|^Outputs:\\s*$)`,
    'm',
  );
  let found = false;
  const result = source.replace(pattern, (block) => {
    found = true;
    return transform(block);
  });
  assert.equal(found, true, `Resource ${logicalId} was not found.`);
  return result;
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
  assert.equal(report.residualLimitations.length, 5);
  assert.match(report.residualLimitations[0], /port 53 to the VPC CIDR/);
  assert.match(report.residualLimitations[0], /cannot prove/);
  assert.match(report.residualLimitations[1], /REDIS_OPERATOR_EXECUTION_ARTIFACT_UNRESOLVED/);
  assert.match(report.residualLimitations[2], /FIXED_SLOT_CREDENTIAL_REGENERATION_UNRESOLVED/);
  assert.match(report.residualLimitations[3], /AUTH_WALLET_EXTERNAL_CONFIGURATION_UNRESOLVED/);
  assert.match(report.residualLimitations[4], /OPERATIONAL_ALERT_DELIVERY_EXTERNAL/);
});

test('keeps the parent below the reviewed direct-upload ceiling after child extraction', () => {
  const bytes = Buffer.byteLength(templateSource, 'utf8');
  assert.equal(bytes, 50_151);
  assert.ok(bytes <= 50_500);
  assert.equal(51_200 - bytes, 1_049);
});

test('pins the observability child URL, digest, binding, and exact parent mapping', () => {
  for (const [search, replacement, message] of [
    [
      'ObservabilityTemplateSha256:\n  Type: String',
      'ObservabilityTemplateSha256:\n  Type: Number',
      /ObservabilityTemplateSha256/,
    ],
    [
      'TemplateURL: !Ref ObservabilityTemplateUrl',
      'TemplateURL: !Ref WorkloadBoundariesTemplateUrl',
      /Observability.*exact reviewed minimum-name input/,
    ],
    [
      'AlarmTopicArn: !Ref AlarmTopicArn',
      'AlarmTopicArn: NONE',
      /Observability.*exact reviewed minimum-name input/,
    ],
    [
      'LoadBalancerFullName: !GetAtt ApplicationLoadBalancer.LoadBalancerFullName',
      'LoadBalancerFullName: unreviewed',
      /Observability.*exact reviewed minimum-name input/,
    ],
    [
      'BalanceQueueName: !GetAtt BalanceQueue.QueueName',
      'BalanceQueueName: !GetAtt JobQueue.QueueName',
      /Observability.*exact reviewed minimum-name input/,
    ],
    [
      'BalanceDeadLetterQueueName: !GetAtt BalanceDeadLetterQueue.QueueName',
      'BalanceDeadLetterQueueName: !GetAtt JobDeadLetterQueue.QueueName',
      /Observability.*exact reviewed minimum-name input/,
    ],
    [
      'RedisCacheClusterIdPrefix: !Ref RedisReplicationGroup',
      'RedisCacheClusterIdPrefix: unexpected',
      /Observability.*exact reviewed minimum-name input/,
    ],
    [
      'Value: !Ref ObservabilityArtifactBindingSha256',
      'Value: !Ref ObservabilityTemplateSha256',
      /Observability.*exact reviewed minimum-name input/,
    ],
  ]) {
    assertRejected(
      mutate((source) => source.replace(search, replacement)),
      message,
    );
  }
});

test('requires bare forwarded client IPs for trusted-proxy parsing', () => {
  const expectedError =
    /ApplicationLoadBalancer must preserve the exact reviewed LoadBalancerAttributes contract, including routing\.http\.xff_client_port\.enabled=false so trusted-proxy parsing receives a bare canonical client IP/;

  assertRejected(
    mutate((source) =>
      source.replace(
        "    - Key: routing.http.xff_client_port.enabled\n      Value: 'false'",
        "    - Key: routing.http.xff_client_port.enabled\n      Value: 'true'",
      ),
    ),
    expectedError,
  );
  assertRejected(
    mutate((source) =>
      source.replace("    - Key: routing.http.xff_client_port.enabled\n      Value: 'false'\n", ''),
    ),
    expectedError,
  );
});

test('rejects mutations to the exact bounded log-retention parameter contract', () => {
  for (const [search, replacement] of [
    [' LogRetentionDays:\n  Type: Number', ' LogRetentionDays:\n  Type: String'],
    ['  Default: 14\n  AllowedValues:', '  Default: 30\n  AllowedValues:'],
    [
      '  AllowedValues: [1, 3, 5, 7, 14, 30, 60, 90]',
      '  AllowedValues: [1, 3, 5, 7, 14, 30, 60, 90, 365]',
    ],
  ]) {
    assertRejected(
      mutate((source) => source.replace(search, replacement)),
      /LogRetentionDays must preserve the exact Number type, 14-day default, and reviewed bounded values 1, 3, 5, 7, 14, 30, 60, and 90/,
    );
  }
});

test('rejects every application log group that escapes the reviewed retention parameter', () => {
  for (const [logicalId, nextLogicalId] of [
    ['ApiLogGroup', 'WebLogGroup'],
    ['WebLogGroup', 'WorkerLogGroup'],
    ['WorkerLogGroup', 'WorkloadBoundaries'],
  ]) {
    assertRejected(
      mutate((source) =>
        source.replace(
          new RegExp(
            `( ${logicalId}:[\\s\\S]*?RetentionInDays:) !Ref LogRetentionDays(?=\\n\\n ${nextLogicalId}:)`,
          ),
          '$1 365',
        ),
      ),
      new RegExp(`${logicalId} requires RetentionInDays to equal !Ref LogRetentionDays`),
    );
  }
});

test('pins immutable child bytes and the AWS-owned regional S3 delivery boundary', () => {
  for (const fragment of [
    'Assert-RegionalS3ManagedPrefixList',
    "'describe-managed-prefix-lists'",
    "-Name 'OwnerId'",
    "-cne 'AWS'",
    '$pinnedChildHashMatch.Groups[1].Value -cne $workloadBoundariesTemplateSha256',
    "does not match the parent template's exact AllowedValue and content-addressed TemplateURL pin",
  ]) {
    assert.ok(deploymentGuardSource.includes(fragment), `Deployment guard is missing ${fragment}`);
    assert.ok(validatorSource.includes(fragment), `Static guard contract is missing ${fragment}`);
  }
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

test('standalone SQS validator rejects missing encryption and bounded-redrive topology', () => {
  for (const [search, replacement, message] of [
    ['      KmsMasterKeyId: alias/aws/sqs\n', '', /exact AWS-KMS-encrypted, 14-day-retained/],
    [
      '        redrivePermission: byQueue',
      '        redrivePermission: allowAll',
      /single-source dead-letter queue topology/,
    ],
    [
      '        maxReceiveCount: !Ref MaxReceiveCount',
      '        maxReceiveCount: 1000',
      /bounded-retry primary queue topology/,
    ],
  ]) {
    const mutated = sqsFoundationSource.replace(search, replacement);
    assert.notEqual(mutated, sqsFoundationSource, `Mutation did not replace ${search}.`);
    const report = validateSqsFoundationSource(mutated);
    assert.equal(report.ok, false);
    assert.equal(report.awsCallsMade, 0);
    assert(
      report.errors.some((error) => message.test(error)),
      report.errors.join('\n'),
    );
  }

  const withoutJobQueue = sqsFoundationSource.replace(
    /^ {2}JobQueue:[\s\S]*?(?=^ {2}JobQueueTlsPolicy:)/m,
    '',
  );
  assert.notEqual(withoutJobQueue, sqsFoundationSource);
  const report = validateSqsFoundationSource(withoutJobQueue);
  assert.equal(report.ok, false);
  assert(report.errors.some((error) => /topology is missing JobQueue/.test(error)));
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
    value.replace('     AssignPublicIp: DISABLED', '     AssignPublicIp: ENABLED'),
  );
  assertRejected(source, /must disable public IPs|must never enable public IP assignment/);
});

test('rejects an additional ECS task security group', () => {
  const source = mutate((value) =>
    value.replace(
      '     SecurityGroups:\n      - !Ref WebTaskSecurityGroup\n     Subnets:',
      '     SecurityGroups:\n      - !Ref WebTaskSecurityGroup\n      - !Ref LoadBalancerSecurityGroup\n     Subnets:',
    ),
  );
  assertRejected(
    source,
    /WebService must use only the reviewed !Ref WebTaskSecurityGroup identity/,
  );
});

test('rejects an additional ECS task subnet', () => {
  const source = mutate((value) =>
    value
      .replace(
        /^Parameters:\s*$/m,
        'Parameters:\n UnapprovedTaskSubnetId:\n  Type: AWS::EC2::Subnet::Id',
      )
      .replace(
        '     Subnets:\n      - !Ref PrivateSubnetA\n      - !Ref PrivateSubnetB\n   PlatformVersion:',
        '     Subnets:\n      - !Ref PrivateSubnetA\n      - !Ref PrivateSubnetB\n      - !Ref UnapprovedTaskSubnetId\n   PlatformVersion:',
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
      '   InternetGatewayId: !Ref InternetGateway',
      '   VpnGatewayId: vgw-not-approved',
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
    value.replace('   CidrIp: !Ref VpcCidr', '   CidrIp: 0.0.0.0/0'),
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
      .replace('       Action: s3:GetObject', '       Action: s3:*')
      .replace(
        '       Resource: !Sub arn:${AWS::Partition}:s3:::prod-${AWS::Region}-starport-layer-bucket/*',
        "       Resource: '*'",
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
        ' Observability:\n  Type: AWS::CloudFormation::Stack',
        ' Observability:\n  Type: AWS::CloudWatch::Dashboard',
      ),
    ),
    /Observability must retain reviewed resource type AWS::CloudFormation::Stack/,
  );
});

test('rejects same-resource application egress mutations and any unreviewed property change', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '          Resource: [!GetAtt JobQueue.Arn, !GetAtt BalanceQueue.Arn]',
        '          Resource: arn:aws:sqs:us-west-2:999999999999:external-exfiltration-queue',
      ),
    ),
    /WorkerTaskRole resources must bind exactly to both source queues/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '- { Name: SQS_QUEUE_URL, Value: !Ref JobQueue }',
        '- { Name: SQS_QUEUE_URL, Value: https://sqs.us-west-2.amazonaws.com/999999999999/external-exfiltration-queue }',
      ),
    ),
    /ApiTaskDefinition must bind exactly one SQS_QUEUE_URL environment value to !Ref JobQueue/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        'Description: Production app baseline.',
        'Description: Reviewed-boundary mutation.',
      ),
    ),
    /does not match the reviewed property-complete baseline/,
  );
});

test('pins the versioned child artifact, provenance, and exact nested input contract', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        'application-workload-boundaries-238dad734b6b7f455dbdbaff6be8b34e0138a424e60ca258b4aa5e30f0df6ef6',
        `application-workload-boundaries-${'0'.repeat(64)}`,
      ),
    ),
    /WorkloadBoundariesTemplateUrl must be supplied explicitly as the reviewed SHA-256-named, versioned S3 object URL/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        'AllowedValues: [238dad734b6b7f455dbdbaff6be8b34e0138a424e60ca258b4aa5e30f0df6ef6]',
        `AllowedValues: [${'0'.repeat(64)}]`,
      ),
    ),
    /WorkloadBoundariesTemplateSha256 must be an explicit String without a default/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        " WorkloadBoundariesArtifactBindingSha256:\n  Type: String\n  AllowedPattern: '^[a-f0-9]{64}$'",
        ` WorkloadBoundariesArtifactBindingSha256:\n  Type: String\n  Default: ${'0'.repeat(64)}\n  AllowedPattern: '^[a-f0-9]{64}$'`,
      ),
    ),
    /WorkloadBoundariesArtifactBindingSha256 must be an explicit lowercase SHA-256/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        'DeliveryArtifactBindingSha256: !Ref WorkloadBoundariesArtifactBindingSha256',
        'DeliveryArtifactBindingSha256: !Ref WorkloadBoundariesTemplateSha256',
      ),
    ),
    /WorkloadBoundaries must preserve the exact reviewed child input contract/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        '      Value: !Ref WorkloadBoundariesArtifactBindingSha256',
        '      Value: !Ref WorkloadBoundariesTemplateSha256',
      ),
    ),
    /WorkloadBoundaries must preserve the exact reviewed child input contract/,
  );
});

test('pins production Cognito, mainnet wallet, and API-only preauth plus six-ring wiring', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        ' AuthWalletKeysSecretArn:\n  Type: String\n  NoEcho: true',
        ' AuthWalletKeysSecretArn:\n  Type: String\n  NoEcho: true\n  Default: arn:aws:secretsmanager:us-west-2:111122223333:secret:prohibited',
      ),
    ),
    /AuthWalletKeysSecretArn must preserve an explicit bounded production identifier\/ARN with no default|must not have a default value/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        '- { Name: WALLET_REGISTRATION_REGISTRY_ENVIRONMENT, Value: MAINNET }',
        '- { Name: WALLET_REGISTRATION_REGISTRY_ENVIRONMENT, Value: TESTNET }',
      ),
    ),
    /reviewed production WALLET_REGISTRATION_REGISTRY_ENVIRONMENT value/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        '${AuthWalletKeysSecretArn}:WALLET_METADATA_SEAL_KEY_RING_JSON::',
        '${AuthWalletKeysSecretArn}:WALLET_IDENTITY_HMAC_KEY_RING_JSON::',
      ),
    ),
    /WALLET_METADATA_SEAL_KEY_RING_JSON secret value|seven reviewed auth\/wallet key fields/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        'AuthWalletKeysKmsKeyArn: !Ref AuthWalletKeysKmsKeyArn',
        'AuthWalletKeysKmsKeyArn: !GetAtt ApplicationDataKey.Arn',
      ),
    ),
    /WorkloadBoundaries must preserve the exact reviewed child input contract/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.WorkerDatabaseActiveSecretArn}:password::'",
        [
          "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.WorkerDatabaseActiveSecretArn}:password::'",
          "       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::' }",
        ].join('\n'),
      ),
    ),
    /WorkerTaskDefinition must not receive authentication or wallet configuration|exact active workload-scoped ECS secret injection/,
  );
});

test('rejects every legacy auth and wallet key binding mixed into the production API task', () => {
  for (const [name, value] of [
    ['AUTH_IDENTITY_HMAC_KEY_ID', 'identity-v1'],
    ['AUTH_SESSION_HMAC_KEY_ID', 'session-v1'],
    ['AUTH_CSRF_HMAC_KEY_ID', 'csrf-v1'],
    ['WALLET_IDENTITY_HMAC_KEY_VERSION', "'1'"],
    ['WALLET_CHALLENGE_HMAC_KEY_VERSION', "'1'"],
    ['WALLET_METADATA_SEAL_KEY_VERSION', "'1'"],
  ]) {
    assertRejected(
      mutate((source) =>
        source.replace(
          '       - { Name: AUTH_PREAUTH_SEAL_KEY_ID, Value: preauth-v1 }',
          [
            '       - { Name: AUTH_PREAUTH_SEAL_KEY_ID, Value: preauth-v1 }',
            `       - { Name: ${name}, Value: ${value} }`,
          ].join('\n'),
        ),
      ),
      new RegExp(`must not configure legacy or mixed-mode auth/wallet field ${name}`),
    );
  }

  for (const name of [
    'AUTH_IDENTITY_HMAC_KEY',
    'AUTH_SESSION_HMAC_KEY',
    'AUTH_CSRF_HMAC_KEY',
    'WALLET_IDENTITY_HMAC_KEY',
    'WALLET_CHALLENGE_HMAC_KEY',
    'WALLET_METADATA_SEAL_KEY',
  ]) {
    assertRejected(
      mutate((source) =>
        source.replace(
          "       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::' }",
          [
            "       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::' }",
            `       - { Name: ${name}, ValueFrom: !Sub '\${AuthWalletKeysSecretArn}:${name}::' }`,
          ].join('\n'),
        ),
      ),
      new RegExp(`must not configure legacy or mixed-mode auth/wallet field ${name}`),
    );
  }
});

test('rejects local demo authentication mode in the production API task', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '       - { Name: NODE_ENV, Value: production }',
        "       - { Name: NODE_ENV, Value: production }\n       - { Name: LOCAL_DEMO_MODE, Value: 'true' }",
      ),
    ),
    /ApiTaskDefinition must not configure LOCAL_DEMO_MODE in production/,
  );
});

test('rejects legacy shared Redis composition and worker Redis drift', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '   AtRestEncryptionEnabled: true',
        "   AtRestEncryptionEnabled: true\n   AuthToken: '{{resolve:secretsmanager:legacy}}'",
      ),
    ),
    /RedisReplicationGroup must not declare AuthToken/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        '       - { Name: APPLICATION_WORKLOAD, Value: worker }',
        '       - { Name: APPLICATION_WORKLOAD, Value: worker }\n       - { Name: REDIS_OPERATOR_TOKEN, Value: prohibited }',
      ),
    ),
    /WorkerTaskDefinition must not receive any Redis|must remain a Redis nonconsumer/,
  );
});

test('binds executable identity and exact image repository per workload', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '       - { Name: APPLICATION_WORKLOAD, Value: api }',
        '       - { Name: APPLICATION_WORKLOAD, Value: worker }',
      ),
    ),
    /ApiTaskDefinition must bind exactly one APPLICATION_WORKLOAD=api/,
  );
  assertRejected(
    mutate((source) =>
      source.replace(
        '       - { Name: APP_ENV, Value: !Ref EnvironmentName }',
        '       - { Name: APP_ENV, Value: staging }',
      ),
    ),
    /ApiTaskDefinition must bind exactly one APP_ENV environment value to !Ref EnvironmentName/,
  );
  assertRejected(
    mutate((source) =>
      source.replace('/crypto-lending-worker@sha256:', '/crypto-lending-api@sha256:'),
    ),
    /WorkerImageUri must accept only the exact crypto-lending-worker ECR repository/,
  );
});

test('rejects crossing the runtime and migration database credential boundary', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.ApiDatabaseActiveSecretArn}:password::'",
        "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.MigrationDatabaseCredentialSecretArn}:password::'",
      ),
    ),
    /ApiTaskDefinition must preserve its exact active workload-scoped ECS secret injection/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '!GetAtt WorkloadBoundaries.Outputs.WorkerDatabaseActiveUsername',
        '!GetAtt WorkloadBoundaries.Outputs.ApiDatabaseActiveUsername',
      ),
    ),
    /WorkerTaskDefinition must bind the reviewed non-secret runtime database username/,
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
        '${WorkloadBoundaries.Outputs.MigrationDatabaseCredentialSecretArn}:SecretString:username',
      ),
    ),
    /must preserve DatabaseCredentialsSecret as its bootstrap master credential/,
  );
});

test('rejects widening any ECS role trust policy', () => {
  for (const [search, replacement] of [
    ['Service: ecs-tasks.amazonaws.com', 'Service: lambda.amazonaws.com'],
    [
      'StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
      "StringEquals: { aws:SourceAccount: '999999999999' }",
    ],
    [
      "aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'",
      "aws:SourceArn: '*'",
    ],
    ['Action: sts:AssumeRole', 'Action: sts:*'],
  ]) {
    assertRejected(
      mutate((source) => source.replace(search, replacement)),
      /single-account, regional ECS task trust policy with no additional principal or action/,
    );
  }
});

test('rejects widening execution-role and task-role capability matrices', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.RedisActiveSecretArn}:password::'",
        "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.MigrationDatabaseCredentialSecretArn}:password::'",
      ),
    ),
    /ApiTaskDefinition must preserve its exact active workload-scoped ECS secret injection/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        'Action: [logs:CreateLogStream, logs:PutLogEvents]',
        'Action: [logs:CreateLogStream, logs:PutLogEvents, secretsmanager:GetSecretValue]',
      ),
    ),
    /web log-only execution policy with no secret or data-key access/,
  );

  assertRejected(
    mutate((source) => source.replace('Action: sqs:GetQueueAttributes', 'Action: sqs:SendMessage')),
    /read-only queue-readiness task policy with no publish, consume, secret, or key access/,
  );

  assertRejected(
    mutate((source) =>
      source.replace('Action: sqs:SendMessage', 'Action: [sqs:SendMessage, sqs:ReceiveMessage]'),
    ),
    /queue-publish\/readiness and SQS-only data-key task policy with no consume or secret access/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        ' ApplicationLoadBalancer:\n',
        [
          '   Policies:',
          '    - PolicyName: UnexpectedWebAccess',
          '      PolicyDocument:',
          "       Version: '2012-10-17'",
          '       Statement:',
          '        - Effect: Allow',
          '          Action: secretsmanager:GetSecretValue',
          "          Resource: '*'",
          '',
          ' ApplicationLoadBalancer:',
          '',
        ].join('\n'),
      ),
    ),
    /WebTaskRole must not declare Policies/,
  );
});

test('rejects task-role remapping and secret injection outside the exact service boundary', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '   TaskRoleArn: !GetAtt ApiTaskRole.Arn',
        '   TaskRoleArn: !GetAtt WorkerTaskRole.Arn',
      ),
    ),
    /ApiTaskDefinition requires TaskRoleArn to equal !GetAtt ApiTaskRole\.Arn/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.RedisActiveSecretArn}:password::'",
        "ValueFrom: !Sub '${WorkloadBoundaries.Outputs.ApiDatabaseActiveSecretArn}:password::'",
      ),
    ),
    /ApiTaskDefinition must preserve its exact active workload-scoped ECS secret injection/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '       - { Name: NODE_ENV, Value: production }',
        '       - { Name: NODE_ENV, Value: production }\n       - { Name: DATABASE_RUNTIME_PASSWORD, Value: plaintext-is-prohibited }',
      ),
    ),
    /inject sensitive runtime values only through ECS Secrets/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '       - { Name: APP_VERSION, Value: !Ref ApplicationVersion }',
        [
          '       - { Name: APP_VERSION, Value: !Ref ApplicationVersion }',
          '      Secrets:',
          '       - Name: DATABASE_RUNTIME_PASSWORD',
          "         ValueFrom: !Sub '${WorkloadBoundaries.Outputs.ApiDatabaseActiveSecretArn}:password::'",
        ].join('\n'),
      ),
    ),
    /WebTaskDefinition must not declare Secrets/,
  );
});

test('requires exactly one production NODE_ENV binding in every application task', () => {
  for (const [occurrence, logicalId, replacement] of [
    [1, 'ApiTaskDefinition', () => '            - { Name: NODE_ENV, Value: development }'],
    [2, 'WebTaskDefinition', () => ''],
    [3, 'WorkerTaskDefinition', (binding) => `${binding}\n${binding}`],
  ]) {
    assertRejected(
      mutateNthNodeEnvironment(occurrence, replacement),
      new RegExp(`${logicalId} must bind exactly one canonical NODE_ENV=production`),
    );
  }
});

test('rejects authored AWS credential-provider environment variables in every task', () => {
  const forbiddenNames = [
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
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  ];
  const logicalIds = ['ApiTaskDefinition', 'WebTaskDefinition', 'WorkerTaskDefinition'];
  for (const [index, name] of forbiddenNames.entries()) {
    const occurrence = (index % logicalIds.length) + 1;
    assertRejected(
      mutateNthNodeEnvironment(
        occurrence,
        (binding) => `${binding}\n            - { Name: ${name}, Value: prohibited }`,
      ),
      new RegExp(
        `${logicalIds[occurrence - 1]} must not author AWS credential-provider Environment bindings;.*${name}`,
      ),
    );
  }
});

test('rejects KMS principal, source, context, and ViaService policy widening', () => {
  for (const [search, replacement, message] of [
    [
      '         aws:SourceAccount: !Ref AWS::AccountId',
      "         aws:SourceAccount: '*'",
      /exact source account and queue ARN scope/,
    ],
    ['       Service: sqs.amazonaws.com', "       AWS: '*'", /SQS service key policy/],
    [
      'kms:EncryptionContext:aws:logs:arn: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/crypto-lending/${EnvironmentName}/*',
      "kms:EncryptionContext:aws:logs:arn: '*'",
      /environment-scoped encryption-context key policy/,
    ],
    [
      'ApplicationDataKeyArn: !GetAtt ApplicationDataKey.Arn',
      'ApplicationDataKeyArn: !GetAtt ApplicationLogsKey.Arn',
      /exact reviewed child input contract/,
    ],
    [
      'kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}',
      'kms:ViaService: !Sub secretsmanager.${AWS::Region}.${AWS::URLSuffix}',
      /SQS-only data-key task policy/,
    ],
  ]) {
    assertRejected(
      mutate((source) => source.replace(search, replacement)),
      message,
    );
  }
});

test('rejects durable-service encryption and queue-policy downgrades semantically', () => {
  for (const [search, replacement, message] of [
    [
      '   TransitEncryptionMode: required',
      '   TransitEncryptionMode: preferred',
      /RedisReplicationGroup requires TransitEncryptionMode to equal required/,
    ],
    [
      '   UserGroupIds:\n    - !GetAtt WorkloadBoundaries.Outputs.RedisApiUserGroupId',
      '   UserGroupIds:\n    - !Ref WebTaskSecurityGroup',
      /exact API-only ACL user group/,
    ],
    [
      '   KmsMasterKeyId: !GetAtt ApplicationDataKey.Arn',
      '   KmsMasterKeyId: alias/aws/sqs',
      /JobDeadLetterQueue requires KmsMasterKeyId to equal !GetAtt ApplicationDataKey\.Arn/,
    ],
    [
      '    redrivePermission: byQueue',
      '    redrivePermission: allowAll',
      /single-source byQueue dead-letter redrive allow policy/,
    ],
    [
      '    maxReceiveCount: !Ref SqsMaxReceiveCount',
      '    maxReceiveCount: 1000',
      /exact dead-letter target and bounded receive-count redrive policy/,
    ],
    [
      "         aws:SecureTransport: 'false'",
      "         aws:SecureTransport: 'true'",
      /exact two-queue attachment and unconditional insecure-transport denial/,
    ],
    [
      '   KmsDataKeyReusePeriodSeconds: 300',
      '   KmsDataKeyReusePeriodSeconds: 86400',
      /exact customer-key encryption, retention, name, and single-source dead-letter queue topology/,
    ],
    [
      '   VisibilityTimeout: !Ref SqsVisibilityTimeoutSeconds',
      '   VisibilityTimeout: 0',
      /exact customer-key encryption, retention, long-poll, bounded-redrive, and visibility-timeout primary queue topology/,
    ],
    [
      '   QueueName: !Sub crypto-lending-${EnvironmentName}-balance-sync-dlq',
      '   QueueName: !Sub crypto-lending-${EnvironmentName}-jobs-dlq',
      /exact encrypted, single-source balance-sync dead-letter queue topology/,
    ],
    [
      '    deadLetterTargetArn: !GetAtt BalanceDeadLetterQueue.Arn',
      '    deadLetterTargetArn: !GetAtt JobDeadLetterQueue.Arn',
      /exact encrypted, bounded-redrive balance-sync source queue topology/,
    ],
    [
      '    - !Ref BalanceDeadLetterQueue\n   PolicyDocument:',
      '    - !Ref JobDeadLetterQueue\n   PolicyDocument:',
      /exact isolated balance queue TLS-only policy/,
    ],
  ]) {
    assertRejected(
      mutate((source) => source.replace(search, replacement)),
      message,
    );
  }
});

test('rejects weakening or ordering the internal readiness deny after the API forward', () => {
  assertRejected(
    mutate((source) =>
      source.replace(
        '   HealthCheckPath: /api/v1/internal/health/dependencies',
        '   HealthCheckPath: /api/v1/health/dependencies',
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
        '   Priority: 5\n\n HttpsApiListenerRule:',
        '   Priority: 15\n\n HttpsApiListenerRule:',
      ),
    ),
    /internal API prefix with fixed 404 at priority 5/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        '   Priority: 10\n\n HttpsWebListenerRule:',
        '   Priority: 4\n\n HttpsWebListenerRule:',
      ),
    ),
    /must forward the public API only after the internal deny rule/,
  );

  assertRejected(
    mutate((source) =>
      source.replace(
        "      FixedResponseConfig: { ContentType: text/plain, StatusCode: '404' }",
        '      TargetGroupArn: !Ref ApiTargetGroup',
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
