import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { validateSqsFoundationSource } from './validate-sqs-foundation.mjs';

const templatePath = join(import.meta.dirname, 'sqs-foundation.yaml');
const templateSource = readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n');

function mutate(search, replacement) {
  const source = templateSource.replace(search, replacement);
  assert.notEqual(source, templateSource, `Mutation must replace ${search}.`);
  return source;
}

function assertRejected(source, message) {
  const report = validateSqsFoundationSource(source);
  assert.equal(report.ok, false);
  assert.equal(report.awsCallsMade, 0);
  assert(
    report.errors.some((error) => message.test(error)),
    report.errors.join('\n'),
  );
}

test('accepts the exact encrypted standalone queue topology without AWS calls', () => {
  const report = validateSqsFoundationSource(templateSource);
  assert.equal(report.ok, true);
  assert.equal(report.awsCallsMade, 0);
  assert.deepEqual(report.errors, []);
});

test('rejects widening or extending the exact standalone parameters', () => {
  for (const [search, replacement] of [
    ["    AllowedPattern: '[a-z0-9-]+'\n", ''],
    ['    Default: 3', '    Default: 100'],
    ['    MaxValue: 100', '    MaxValue: 1000'],
    ['    MinValue: 1', '    MinValue: 0'],
    ['    Type: String', '    Type: String\n    NoEcho: true'],
  ]) {
    assertRejected(
      mutate(search, replacement),
      /Parameters must preserve exactly the reviewed EnvironmentName and MaxReceiveCount/,
    );
  }
});

test('rejects added or changed standalone outputs', () => {
  assertRejected(
    mutate(
      'Outputs:\n',
      ['Outputs:', '  UnexpectedOutput:', '    Value: unexpected', ''].join('\n'),
    ),
    /Outputs must preserve exactly the four reviewed queue URL and ARN outputs/,
  );
  assertRejected(
    mutate('    Value: !Ref JobQueue\n', '    Value: !Ref JobDeadLetterQueue\n'),
    /Outputs must preserve exactly the four reviewed queue URL and ARN outputs/,
  );
});

test('rejects duplicate and unapproved top-level sections', () => {
  for (const sectionName of [
    'AWSTemplateFormatVersion',
    'Description',
    'Parameters',
    'Resources',
    'Outputs',
  ]) {
    assertRejected(
      templateSource + '\n' + sectionName + ': duplicate\n',
      new RegExp('exactly one top-level ' + sectionName),
    );
  }

  for (const sectionName of ['Conditions', 'Mappings', 'Rules', 'Metadata']) {
    assertRejected(
      templateSource + '\n' + sectionName + ': {}\n',
      new RegExp('unapproved top-level section ' + sectionName),
    );
  }
});

test('rejects missing, additional, or retyped standalone queue resources', () => {
  assertRejected(
    mutate(/^  JobQueue:[\s\S]*?(?=^  JobQueueTlsPolicy:)/m, ''),
    /topology is missing JobQueue/,
  );

  assertRejected(
    mutate(
      'Resources:\n',
      [
        'Resources:',
        '  UnexpectedQueue:',
        '    Type: AWS::SQS::Queue',
        '    Properties:',
        '      QueueName: unexpected',
        '',
      ].join('\n'),
    ),
    /contains unapproved resource UnexpectedQueue/,
  );

  assertRejected(
    mutate('    Type: AWS::SQS::Queue', '    Type: AWS::SNS::Topic'),
    /JobDeadLetterQueue must retain resource type AWS::SQS::Queue/,
  );
});

test('rejects lifecycle, dependency, and duplicate resource-level attributes', () => {
  for (const [search, replacement, attributeName] of [
    [
      '  JobDeadLetterQueue:\n    Type: AWS::SQS::Queue\n    Properties:',
      '  JobDeadLetterQueue:\n    Type: AWS::SQS::Queue\n    DeletionPolicy: Retain\n    Properties:',
      'DeletionPolicy',
    ],
    [
      '  JobQueue:\n    Type: AWS::SQS::Queue\n    Properties:',
      '  JobQueue:\n    Type: AWS::SQS::Queue\n    UpdateReplacePolicy: Retain\n    Properties:',
      'UpdateReplacePolicy',
    ],
    [
      '  JobQueueTlsPolicy:\n    Type: AWS::SQS::QueuePolicy\n    Properties:',
      '  JobQueueTlsPolicy:\n    Type: AWS::SQS::QueuePolicy\n    DependsOn: JobQueue\n    Properties:',
      'DependsOn',
    ],
  ]) {
    assertRejected(
      mutate(search, replacement),
      new RegExp('unapproved resource attribute ' + attributeName),
    );
  }

  assertRejected(
    mutate(
      '  JobQueue:\n    Type: AWS::SQS::Queue\n',
      '  JobQueue:\n    Type: AWS::SQS::Queue\n    Type: AWS::SQS::Queue\n',
    ),
    /JobQueue must declare exactly one Type resource attribute/,
  );

  assertRejected(
    mutate('Resources:\n', 'Resources:\n  JobQueue: {}\n'),
    /resource logical ID JobQueue must appear exactly once/,
  );
});

test('rejects removing or weakening encryption on either queue', () => {
  assertRejected(
    mutate('      KmsMasterKeyId: alias/aws/sqs\n', ''),
    /exact AWS-KMS-encrypted, 14-day-retained/,
  );

  assertRejected(
    mutate('      KmsMasterKeyId: alias/aws/sqs', '      KmsMasterKeyId: alias/aws/s3'),
    /exact AWS-KMS-encrypted, 14-day-retained/,
  );

  const secondKeyIndex = templateSource.lastIndexOf('      KmsMasterKeyId: alias/aws/sqs');
  assert.notEqual(secondKeyIndex, -1);
  assertRejected(
    `${templateSource.slice(0, secondKeyIndex)}${templateSource
      .slice(secondKeyIndex)
      .replace('      KmsMasterKeyId: alias/aws/sqs\n', '')}`,
    /exact AWS-KMS-encrypted, bounded-retry primary queue/,
  );
});

test('rejects dead-letter retention and redrive topology drift', () => {
  for (const [search, replacement, message] of [
    ['MessageRetentionPeriod: 1209600', 'MessageRetentionPeriod: 60', /14-day-retained/],
    ['redrivePermission: byQueue', 'redrivePermission: allowAll', /single-source dead-letter/],
    [
      "arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-jobs'",
      "arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:*'",
      /single-source dead-letter/,
    ],
    [
      'deadLetterTargetArn: !GetAtt JobDeadLetterQueue.Arn',
      "deadLetterTargetArn: 'arn:aws:sqs:us-east-1:000000000000:other'",
      /bounded-retry primary queue/,
    ],
    [
      'maxReceiveCount: !Ref MaxReceiveCount',
      'maxReceiveCount: 1000',
      /bounded-retry primary queue/,
    ],
    ['VisibilityTimeout: 30', 'VisibilityTimeout: 0', /bounded-retry primary queue/],
  ]) {
    assertRejected(mutate(search, replacement), message);
  }
});

test('rejects weakening or partially attaching the insecure-transport denial', () => {
  for (const [search, replacement] of [
    ['            Effect: Deny', '            Effect: Allow'],
    ["            Principal: '*'", '            Principal: { Service: ecs-tasks.amazonaws.com }'],
    ['            Action: sqs:*', '            Action: sqs:SendMessage'],
    ['              - !GetAtt JobDeadLetterQueue.Arn', '              - !GetAtt JobQueue.Arn'],
    ["                aws:SecureTransport: 'false'", "                aws:SecureTransport: 'true'"],
  ]) {
    assertRejected(
      mutate(search, replacement),
      /exact two-queue attachment and unconditional insecure-transport denial/,
    );
  }
});

test('rejects transforms and merge keys that obscure the queue graph', () => {
  assertRejected(
    `Transform: UnexpectedMacro\n${templateSource}`,
    /must not use transforms or macros/,
  );
  assertRejected(`<<: *shared\n${templateSource}`, /must not use YAML merge keys/);
});
