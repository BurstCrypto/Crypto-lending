#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const reviewedApplicationObservabilitySha256 =
  'ef0704fc3eea63ca60e6b44bcd8298639696f21478cc119757d968b84920c6a7';

const requiredFragments = Object.freeze([
  'Default: NOT_AUTHORIZED\n    AllowedValues: [NOT_AUTHORIZED, I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES]',
  "DeliveryArtifactSha256:\n    Type: String\n    AllowedPattern: '^[a-f0-9]{64}$'",
  "DeliveryArtifactBindingSha256:\n    Type: String\n    AllowedPattern: '^[a-f0-9]{64}$'",
  "Default: 'true'\n    AllowedValues: ['true', 'false']",
  'AlarmTopicArn:\n    Type: String\n    Default: NONE',
  "Default: 'false'\n    AllowedValues: ['true', 'false']",
  '- !Not [!Equals [!Ref AlarmTopicArn, NONE]]',
  "CreateAlarms: !Equals [!Ref EnableOperationalAlarms, 'true']",
  "CreateOperationalDashboard: !Equals [!Ref EnableOperationalDashboard, 'true']",
  'AlarmActions: [!Ref AlarmTopicArn]',
  'OKActions: [!Ref AlarmTopicArn]',
  'Value: !Ref LoadBalancerFullName',
  'Value: !Ref ApiTargetGroupFullName',
  'Value: !Ref DatabaseInstanceIdentifier',
  'RedisCacheClusterIdPrefix:\n    Type: String',
  'Value: !Sub ${RedisCacheClusterIdPrefix}-001',
  'Value: !Sub ${RedisCacheClusterIdPrefix}-002',
  'Name: CacheClusterId',
  'MetricName: AuthenticationFailures',
  'MetricName: CommandAuthorizationFailures',
  'MetricName: KeyAuthorizationFailures',
  'MetricName: ChannelAuthorizationFailures',
  'Expression: primaryevictions + replicaevictions',
  'Expression: primaryauth + replicaauth + primarycommand + replicacommand + primarykey + replicakey + primarychannel + replicachannel',
  'title":"Redis access denials"',
  'Value: !Ref JobQueueName',
  'Value: !Ref JobDeadLetterQueueName',
  'Value: !Ref BalanceQueueName',
  'Value: !Ref BalanceDeadLetterQueueName',
  '${EcsClusterName}',
  '${ApiServiceName}',
  '${WebServiceName}',
  '${WorkerServiceName}',
  "SOURCE '${WorkerLogGroupName}'",
  "SOURCE '${ApiLogGroupName}'",
  "filter event = 'trace.span.completed' | limit 100",
  "filter event in ['job.publish_failed','job.retry_scheduled','job.awaiting_dead_letter','job.ownership_lost','outbox.dispatch.failed'] | limit 100",
  'stats count(*) as transitions by lifecycleScope, state, reason | limit 100',
  'DeliveryArtifactSha256:\n    Value: !Ref DeliveryArtifactSha256',
  'DeliveryArtifactBindingSha256:\n    Value: !Ref DeliveryArtifactBindingSha256',
]);

const requiredResources = Object.freeze({
  ApiUnhealthyHostAlarm: 'AWS::CloudWatch::Alarm',
  DatabaseLowStorageAlarm: 'AWS::CloudWatch::Alarm',
  RedisEvictionsAlarm: 'AWS::CloudWatch::Alarm',
  RedisAccessDenialsAlarm: 'AWS::CloudWatch::Alarm',
  JobQueueAgeAlarm: 'AWS::CloudWatch::Alarm',
  DeadLetterQueueNotEmptyAlarm: 'AWS::CloudWatch::Alarm',
  BalanceQueueAgeAlarm: 'AWS::CloudWatch::Alarm',
  BalanceDeadLetterQueueNotEmptyAlarm: 'AWS::CloudWatch::Alarm',
  OperationalDashboard: 'AWS::CloudWatch::Dashboard',
});

function sha256(source) {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}

export function validateApplicationObservabilitySource(source) {
  const normalized = source.replace(/\r\n/g, '\n');
  const errors = [];
  const digest = sha256(source);

  if (Buffer.byteLength(source, 'utf8') > 51_200) {
    errors.push('Observability child template exceeds the 51,200-byte direct-upload limit.');
  }
  if (digest !== reviewedApplicationObservabilitySha256) {
    errors.push(
      `Observability child SHA-256 ${digest} does not match reviewed bytes ${reviewedApplicationObservabilitySha256}.`,
    );
  }
  for (const fragment of requiredFragments) {
    if (!normalized.includes(fragment)) {
      errors.push(`Observability child is missing reviewed invariant: ${fragment}`);
    }
  }

  const resourcesSource = normalized.match(/^Resources:\n([\s\S]*?)(?=^Outputs:\s*$)/m)?.[1] ?? '';
  const entries = [...resourcesSource.matchAll(/^ {2}([A-Z][A-Za-z0-9]*):\n {4}Type: ([^\n]+)$/gm)];
  if (entries.length !== Object.keys(requiredResources).length) {
    errors.push('Observability child must contain exactly eight alarms and one dashboard.');
  }
  for (const [logicalId, expectedType] of Object.entries(requiredResources)) {
    const entry = entries.find((candidate) => candidate[1] === logicalId);
    if (!entry || entry[2] !== expectedType) {
      errors.push(`${logicalId} must retain reviewed resource type ${expectedType}.`);
    }
  }
  if ((normalized.match(/^ {6}AlarmActions: \[!Ref AlarmTopicArn\]$/gm) ?? []).length !== 8) {
    errors.push('Every reviewed alarm must route exactly one ALARM action to AlarmTopicArn.');
  }
  if ((normalized.match(/^ {6}OKActions: \[!Ref AlarmTopicArn\]$/gm) ?? []).length !== 8) {
    errors.push('Every reviewed alarm must route exactly one OK action to AlarmTopicArn.');
  }
  if (/ActionsEnabled:|InsufficientDataActions:/.test(resourcesSource)) {
    errors.push('Reviewed alarms must not disable actions or route insufficient-data actions.');
  }
  if (
    /\b(?:accountId|customerId|walletAddress|transactionId|@message|headers?|payload|secret)\b/i.test(
      normalized.match(/^ {6}DashboardBody:[\s\S]*?(?=^Outputs:)/m)?.[0] ?? '',
    )
  ) {
    errors.push('Dashboard must not expose high-cardinality or sensitive fields.');
  }

  return { ok: errors.length === 0, awsCallsMade: 0, templateSha256: digest, errors };
}

function main() {
  const argumentIndex = process.argv.indexOf('--template');
  const template = resolve(
    argumentIndex >= 0
      ? process.argv[argumentIndex + 1]
      : join(scriptDirectory, 'application-observability.yaml'),
  );
  const json = process.argv.includes('--json');
  let report;
  try {
    report = validateApplicationObservabilitySource(readFileSync(template, 'utf8'));
  } catch (error) {
    report = { ok: false, awsCallsMade: 0, templateSha256: undefined, errors: [error.message] };
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...report, template }, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write(
      `Application observability child validation passed.\nAWS API calls made: 0\n`,
    );
  } else {
    process.stderr.write(`${report.errors.join('\n')}\nAWS API calls made: 0\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
