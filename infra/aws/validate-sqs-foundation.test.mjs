import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  MAX_SQS_FOUNDATION_TEMPLATE_BYTES,
  readLocalSqsFoundationTemplate,
  readLocalSqsFoundationTemplateForTest,
  SQS_FOUNDATION_ARGUMENT_ERROR,
  SQS_FOUNDATION_TEMPLATE_INPUT_ERROR,
  validateSqsFoundationSource,
} from './validate-sqs-foundation.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const templatePath = join(scriptDirectory, 'sqs-foundation.yaml');
const validatorPath = join(scriptDirectory, 'validate-sqs-foundation.mjs');
const templateSource = readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n');

function withTemporaryTemplate(contents, assertion) {
  const directory = mkdtempSync(join(tmpdir(), 'sqs-foundation-input-'));
  const temporaryTemplatePath = join(directory, 'template.yaml');
  writeFileSync(temporaryTemplatePath, contents);
  try {
    assertion(temporaryTemplatePath, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertInputRejected(path) {
  assert.throws(
    () => readLocalSqsFoundationTemplate(path),
    (error) =>
      error instanceof Error &&
      error.message === SQS_FOUNDATION_TEMPLATE_INPUT_ERROR &&
      !error.message.includes(path),
  );
}

function skipUnsupportedLink(error, context) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM', 'UNKNOWN'].includes(error.code)
  ) {
    context.skip(`symbolic links are unavailable: ${error.code}`);
    return true;
  }
  return false;
}

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

test('securely loads the reviewed standalone SQS template', () => {
  const loaded = readLocalSqsFoundationTemplate(templatePath);
  assert.equal(loaded.source, templateSource);
  assert.equal(loaded.resolved, templatePath);
});

test('rejects malformed UTF-8, a byte-order mark, empty input, and oversized input', () => {
  const bytes = readFileSync(templatePath);
  for (const contents of [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([0xff])]),
    Buffer.alloc(0),
    Buffer.alloc(MAX_SQS_FOUNDATION_TEMPLATE_BYTES + 1, 0x20),
  ]) {
    withTemporaryTemplate(contents, assertInputRejected);
  }
});

test('rejects directory and hard-linked standalone SQS template inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sqs-foundation-files-'));
  try {
    const directoryPath = join(directory, 'directory.yaml');
    mkdirSync(directoryPath);
    assertInputRejected(directoryPath);

    const sourcePath = join(directory, 'source.yaml');
    const linkedPath = join(directory, 'hard-link.yaml');
    writeFileSync(sourcePath, templateSource);
    linkSync(sourcePath, linkedPath);
    assertInputRejected(sourcePath);
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link standalone SQS template when supported', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'sqs-foundation-symlink-'));
  try {
    const targetPath = join(directory, 'target.yaml');
    const linkedPath = join(directory, 'linked.yaml');
    writeFileSync(targetPath, templateSource);
    try {
      symlinkSync(targetPath, linkedPath, 'file');
    } catch (error) {
      if (skipUnsupportedLink(error, context)) return;
      throw error;
    }
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a same-size rewrite during the stable descriptor read', () => {
  const original = Buffer.from(templateSource, 'utf8');
  const replacement = Buffer.from(
    templateSource.replace('Description: Crypto', 'Description: Broken'),
    'utf8',
  );
  assert.equal(replacement.length, original.length);
  assert.notDeepEqual(replacement, original);

  withTemporaryTemplate(original, (path) => {
    assert.throws(
      () =>
        readLocalSqsFoundationTemplateForTest(path, () => {
          writeFileSync(path, replacement);
        }),
      (error) => error instanceof Error && error.message === SQS_FOUNDATION_TEMPLATE_INPUT_ERROR,
    );
  });
});

test('CLI input failures expose only fixed path-free errors and zero AWS calls', () => {
  const hostilePath = join(tmpdir(), 'missing-template-with-sensitive-name.yaml');
  const inputFailure = spawnSync(
    process.execPath,
    [validatorPath, '--template', hostilePath, '--json'],
    {
      encoding: 'utf8',
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
      windowsHide: true,
    },
  );

  assert.equal(inputFailure.status, 2);
  assert.equal(inputFailure.stdout, '');
  assert.equal(
    inputFailure.stderr,
    `${SQS_FOUNDATION_TEMPLATE_INPUT_ERROR}\nAWS API calls made: 0\n`,
  );
  assert.equal(inputFailure.stderr.includes(hostilePath), false);

  const hostileArgument = '--sensitive-customer-token';
  const argumentFailure = spawnSync(process.execPath, [validatorPath, hostileArgument], {
    encoding: 'utf8',
    env: { ...process.env, AWS_EC2_METADATA_DISABLED: 'true' },
    windowsHide: true,
  });

  assert.equal(argumentFailure.status, 2);
  assert.equal(argumentFailure.stdout, '');
  assert.equal(argumentFailure.stderr, `${SQS_FOUNDATION_ARGUMENT_ERROR}\nAWS API calls made: 0\n`);
  assert.equal(argumentFailure.stderr.includes(hostileArgument), false);
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
    /Outputs must preserve exactly the eight reviewed queue URL and ARN outputs/,
  );
  assertRejected(
    mutate('    Value: !Ref JobQueue\n', '    Value: !Ref JobDeadLetterQueue\n'),
    /Outputs must preserve exactly the eight reviewed queue URL and ARN outputs/,
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
    mutate(/^ {2}JobQueue:[\s\S]*?(?=^ {2}JobQueueTlsPolicy:)/m, ''),
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

  const firstKeyIndex = templateSource.indexOf('      KmsMasterKeyId: alias/aws/sqs');
  const secondKeyIndex = templateSource.indexOf(
    '      KmsMasterKeyId: alias/aws/sqs',
    firstKeyIndex + 1,
  );
  assert.notEqual(secondKeyIndex, -1);
  assertRejected(
    `${templateSource.slice(0, secondKeyIndex)}${templateSource
      .slice(secondKeyIndex)
      .replace('      KmsMasterKeyId: alias/aws/sqs\n', '')}`,
    /exact AWS-KMS-encrypted, bounded-retry primary queue/,
  );
});

test('rejects balance source/DLQ, encryption, and TLS isolation drift', () => {
  for (const [search, replacement, message] of [
    [
      "      QueueName: !Sub 'crypto-lending-${EnvironmentName}-balance-sync-dlq'",
      "      QueueName: !Sub 'crypto-lending-${EnvironmentName}-jobs-dlq'",
      /single-source balance dead-letter/,
    ],
    [
      '        deadLetterTargetArn: !GetAtt BalanceDeadLetterQueue.Arn',
      '        deadLetterTargetArn: !GetAtt JobDeadLetterQueue.Arn',
      /bounded-retry balance source queue/,
    ],
    [
      '        - !Ref BalanceDeadLetterQueue',
      '        - !Ref JobDeadLetterQueue',
      /exact balance two-queue attachment/,
    ],
  ]) {
    assertRejected(mutate(search, replacement), message);
  }
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
