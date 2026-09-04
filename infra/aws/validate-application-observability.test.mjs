import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { validateApplicationObservabilitySource } from './validate-application-observability.mjs';

const source = readFileSync(join(import.meta.dirname, 'application-observability.yaml'), 'utf8');

test('accepts the exact reviewed observability child without external calls', () => {
  const report = validateApplicationObservabilitySource(source);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.awsCallsMade, 0);
});

test('rejects line-ending drift even when the parsed YAML would be equivalent', () => {
  const mutated = source.replace(/\n/g, '\r\n');
  assert.notEqual(mutated, source);
  const report = validateApplicationObservabilitySource(mutated);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /does not match reviewed bytes/);
});

for (const [name, search, replacement] of [
  ['alarm action', 'AlarmActions: [!Ref AlarmTopicArn]', 'AlarmActions: []'],
  ['OK action', 'OKActions: [!Ref AlarmTopicArn]', 'OKActions: []'],
  [
    'alarm condition',
    "CreateAlarms: !Equals [!Ref EnableOperationalAlarms, 'true']",
    "CreateAlarms: !Equals [!Ref EnableOperationalDashboard, 'true']",
  ],
  [
    'topic rule',
    '- !Not [!Equals [!Ref AlarmTopicArn, NONE]]',
    "- !Equals [!Ref EnableOperationalAlarms, 'true']",
  ],
  ['ALB dimension', 'Value: !Ref LoadBalancerFullName', 'Value: !Ref ApiTargetGroupFullName'],
  [
    'database dimension',
    'Value: !Ref DatabaseInstanceIdentifier',
    'Value: !Ref RedisReplicationGroupId',
  ],
  ['queue dimension', 'Value: !Ref JobQueueName', 'Value: !Ref JobDeadLetterQueueName'],
  [
    'balance queue dimension',
    'Value: !Ref BalanceQueueName',
    'Value: !Ref BalanceDeadLetterQueueName',
  ],
  [
    'Redis primary cache dimension',
    'Value: !Sub ${RedisCacheClusterIdPrefix}-001',
    'Value: !Sub ${RedisCacheClusterIdPrefix}-003',
  ],
  [
    'Redis access-denial metric',
    'MetricName: AuthenticationFailures',
    'MetricName: NewConnections',
  ],
  [
    'Redis access-denial aggregation',
    'primaryauth + replicaauth + primarycommand + replicacommand + primarykey + replicakey + primarychannel + replicachannel',
    'primaryauth + replicaauth',
  ],
  ['ECS input', '${ApiServiceName}', '${WorkerServiceName}'],
  ['dashboard log input', "SOURCE '${ApiLogGroupName}'", "SOURCE '${WorkerLogGroupName}'"],
  ['dashboard event allowlist', "'job.awaiting_dead_letter'", "'job.processed'"],
  [
    'dashboard sensitive field',
    'fields @timestamp, correlationId',
    'fields @timestamp, @message, correlationId',
  ],
  [
    'artifact digest output',
    'Value: !Ref DeliveryArtifactSha256',
    'Value: !Ref DeliveryArtifactBindingSha256',
  ],
]) {
  test(`rejects ${name} mutation`, () => {
    const mutated = source.replace(search, replacement);
    assert.notEqual(mutated, source);
    const report = validateApplicationObservabilitySource(mutated);
    assert.equal(report.ok, false);
    assert.equal(report.awsCallsMade, 0);
  });
}
