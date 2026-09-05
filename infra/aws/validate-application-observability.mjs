#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultTemplatePath = join(scriptDirectory, 'application-observability.yaml');
export const reviewedApplicationObservabilitySha256 =
  'ef0704fc3eea63ca60e6b44bcd8298639696f21478cc119757d968b84920c6a7';
export const MAX_APPLICATION_OBSERVABILITY_TEMPLATE_BYTES = 51_200;
export const APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR =
  'Application observability child template must be a non-empty, stable, single-link regular file of at most 51200 bytes at a canonical local path containing UTF-8 text without a byte-order mark.';
export const APPLICATION_OBSERVABILITY_ARGUMENT_ERROR =
  'Usage: validate-application-observability.mjs [--template <local-file>] [--json].';

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

function readLocalTemplateInternal(path, afterFirstReadForTest) {
  try {
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(path, MAX_APPLICATION_OBSERVABILITY_TEMPLATE_BYTES)
        : readSecureLocalFileForTest(
            path,
            MAX_APPLICATION_OBSERVABILITY_TEMPLATE_BYTES,
            afterFirstReadForTest,
          );
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR);
    }
    return {
      resolved: resolve(path),
      source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  } catch {
    throw new Error(APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR);
  }
}

export function readLocalApplicationObservabilityTemplate(path) {
  return readLocalTemplateInternal(path, undefined);
}

/** Test-only fault seam; production callers use readLocalApplicationObservabilityTemplate. */
export function readLocalApplicationObservabilityTemplateForTest(path, afterFirstReadForTest) {
  return readLocalTemplateInternal(path, afterFirstReadForTest);
}

export function validateApplicationObservabilitySource(source) {
  const normalized = source.replace(/\r\n/g, '\n');
  const errors = [];
  const digest = sha256(source);

  if (Buffer.byteLength(source, 'utf8') > MAX_APPLICATION_OBSERVABILITY_TEMPLATE_BYTES) {
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

function parseArguments(argv) {
  const options = { template: defaultTemplatePath, json: false };
  let templateSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (options.json) throw new Error(APPLICATION_OBSERVABILITY_ARGUMENT_ERROR);
      options.json = true;
      continue;
    }
    if (argument !== '--template' || templateSeen) {
      throw new Error(APPLICATION_OBSERVABILITY_ARGUMENT_ERROR);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(APPLICATION_OBSERVABILITY_ARGUMENT_ERROR);
    }
    options.template = value;
    templateSeen = true;
    index += 1;
  }
  return options;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const { resolved, source } = readLocalApplicationObservabilityTemplate(options.template);
    const report = { ...validateApplicationObservabilitySource(source), template: resolved };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (report.ok) {
      process.stdout.write(
        `Application observability child validation passed.\nAWS API calls made: 0\n`,
      );
    } else {
      process.stderr.write(`${report.errors.join('\n')}\nAWS API calls made: 0\n`);
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof Error &&
      [
        APPLICATION_OBSERVABILITY_ARGUMENT_ERROR,
        APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR,
      ].includes(error.message)
        ? error.message
        : APPLICATION_OBSERVABILITY_TEMPLATE_INPUT_ERROR;
    process.stderr.write(`${message}\nAWS API calls made: 0\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
