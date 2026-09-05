#!/usr/bin/env node

/**
 * Local-only validation for the standalone SQS foundation transport boundary.
 * This file reads a local template and never loads an AWS SDK or performs I/O
 * beyond the local filesystem.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultTemplatePath = join(scriptDirectory, 'sqs-foundation.yaml');

export const MAX_SQS_FOUNDATION_TEMPLATE_BYTES = 51_200;
export const SQS_FOUNDATION_TEMPLATE_INPUT_ERROR =
  'Standalone SQS template must be a non-empty, stable, single-link regular file of at most 51200 bytes at a canonical local path containing UTF-8 text without a byte-order mark.';
export const SQS_FOUNDATION_ARGUMENT_ERROR =
  'Usage: validate-sqs-foundation.mjs [--template <local-file>] [--json].';

function readLocalTemplateInternal(path, afterFirstReadForTest) {
  try {
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(path, MAX_SQS_FOUNDATION_TEMPLATE_BYTES)
        : readSecureLocalFileForTest(
            path,
            MAX_SQS_FOUNDATION_TEMPLATE_BYTES,
            afterFirstReadForTest,
          );
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(SQS_FOUNDATION_TEMPLATE_INPUT_ERROR);
    }
    return {
      resolved: resolve(path),
      source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  } catch {
    throw new Error(SQS_FOUNDATION_TEMPLATE_INPUT_ERROR);
  }
}

export function readLocalSqsFoundationTemplate(path) {
  return readLocalTemplateInternal(path, undefined);
}

/** Test-only fault seam; production callers use readLocalSqsFoundationTemplate. */
export function readLocalSqsFoundationTemplateForTest(path, afterFirstReadForTest) {
  return readLocalTemplateInternal(path, afterFirstReadForTest);
}

function topLevelDocumentEntries(source) {
  const entries = [];
  const invalidLines = [];
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim() === '' || /^\s*#/.test(line) || /^\s/.test(line)) continue;
    const entry = line.match(/^([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/);
    if (entry) {
      entries.push({ name: entry[1], line });
    } else {
      invalidLines.push(line);
    }
  }
  return { entries, invalidLines };
}

function topLevelSectionBlock(source, sectionName) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const sectionIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line === `${sectionName}:`)
    .map(({ index }) => index);
  if (sectionIndexes.length !== 1) return undefined;

  const start = sectionIndexes[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== '' && !/^\s/.test(line) && !/^#/.test(line)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

function topLevelBlocks(source, sectionName) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = new Map();
  let sectionIndex = lines.findIndex((line) => line === `${sectionName}:`);
  if (sectionIndex < 0) return blocks;

  let currentName;
  let currentLines = [];
  const flush = () => {
    if (currentName) blocks.set(currentName, currentLines.join('\n'));
  };

  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9]*:$/.test(line)) break;
    const entry = line.match(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*$/);
    if (entry) {
      flush();
      currentName = entry[1];
      currentLines = [line];
    } else if (currentName) {
      currentLines.push(line);
    }
  }
  flush();
  return blocks;
}

function requireMatch(source, pattern, message, errors) {
  if (!pattern.test(source)) errors.push(message);
}

function indentedPropertyBlock(block, propertyName) {
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => new RegExp(`^\\s+${escapedName}:\\s*$`).test(line));
  if (matches.length !== 1) return undefined;

  const { index, line } = matches[0];
  const propertyIndent = line.search(/\S/);
  const propertyLines = [line];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const nestedLine = lines[cursor];
    if (nestedLine.trim() !== '' && nestedLine.search(/\S/) <= propertyIndent) break;
    propertyLines.push(nestedLine);
  }
  return propertyLines.join('\n').trimEnd();
}

function semanticYamlTokens(source) {
  return source.replace(/^\s*-\s+/gm, '').replace(/[\s{},'"]/g, '');
}

function requireExactSemanticSection(source, sectionName, expectedSource, expectation, errors) {
  const actual = topLevelSectionBlock(source, sectionName);
  if (!actual || semanticYamlTokens(actual) !== semanticYamlTokens(expectedSource)) {
    errors.push(`Standalone SQS ${sectionName} must preserve ${expectation}.`);
  }
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

export function validateSqsFoundationSource(source) {
  const errors = [];
  if (/^\s*(?:["']?Transform["']?|["']?Fn::Transform["']?)\s*:/m.test(source)) {
    errors.push('Standalone SQS template must not use transforms or macros.');
  }
  if (/^\s*(?:["']?<<["']?)\s*:/m.test(source)) {
    errors.push('Standalone SQS template must not use YAML merge keys.');
  }

  const { entries: topLevelEntries, invalidLines: invalidTopLevelLines } =
    topLevelDocumentEntries(source);
  const expectedTopLevelNames = new Set([
    'AWSTemplateFormatVersion',
    'Description',
    'Parameters',
    'Resources',
    'Outputs',
  ]);
  const topLevelCounts = new Map();
  for (const { name } of topLevelEntries) {
    topLevelCounts.set(name, (topLevelCounts.get(name) ?? 0) + 1);
  }
  for (const name of expectedTopLevelNames) {
    if (topLevelCounts.get(name) !== 1) {
      errors.push('Standalone SQS template must declare exactly one top-level ' + name + '.');
    }
  }
  for (const name of new Set(topLevelEntries.map(({ name }) => name))) {
    if (!expectedTopLevelNames.has(name)) {
      errors.push('Standalone SQS template contains unapproved top-level section ' + name + '.');
    }
  }
  if (invalidTopLevelLines.length > 0) {
    errors.push(
      'Standalone SQS template contains unrecognized top-level syntax: ' +
        invalidTopLevelLines.join(', ') +
        '.',
    );
  }

  const expectedScalarEntries = new Map([
    ['AWSTemplateFormatVersion', "AWSTemplateFormatVersion: '2010-09-09'"],
    ['Description', 'Description: Crypto Lending isolated job and balance-sync queue pairs'],
  ]);
  for (const [name, expectedLine] of expectedScalarEntries) {
    const matchingEntries = topLevelEntries.filter((entry) => entry.name === name);
    if (
      matchingEntries.length !== 1 ||
      semanticYamlTokens(matchingEntries[0].line) !== semanticYamlTokens(expectedLine)
    ) {
      errors.push('Standalone SQS template must preserve the reviewed ' + name + ' value.');
    }
  }

  requireExactSemanticSection(
    source,
    'Parameters',
    [
      'Parameters:',
      '  EnvironmentName:',
      '    Type: String',
      "    AllowedPattern: '[a-z0-9-]+'",
      '  MaxReceiveCount:',
      '    Type: Number',
      '    Default: 3',
      '    MinValue: 1',
      '    MaxValue: 100',
    ].join('\n'),
    'exactly the reviewed EnvironmentName and MaxReceiveCount definitions and bounds',
    errors,
  );

  requireExactSemanticSection(
    source,
    'Outputs',
    [
      'Outputs:',
      '  JobQueueUrl:',
      '    Value: !Ref JobQueue',
      '  JobQueueArn:',
      '    Value: !GetAtt JobQueue.Arn',
      '  JobDeadLetterQueueUrl:',
      '    Value: !Ref JobDeadLetterQueue',
      '  JobDeadLetterQueueArn:',
      '    Value: !GetAtt JobDeadLetterQueue.Arn',
      '  BalanceQueueUrl:',
      '    Value: !Ref BalanceQueue',
      '  BalanceQueueArn:',
      '    Value: !GetAtt BalanceQueue.Arn',
      '  BalanceDeadLetterQueueUrl:',
      '    Value: !Ref BalanceDeadLetterQueue',
      '  BalanceDeadLetterQueueArn:',
      '    Value: !GetAtt BalanceDeadLetterQueue.Arn',
    ].join('\n'),
    'exactly the eight reviewed queue URL and ARN outputs',
    errors,
  );

  const resources = topLevelBlocks(source, 'Resources');
  const expectedResources = new Map([
    ['JobDeadLetterQueue', 'AWS::SQS::Queue'],
    ['JobQueue', 'AWS::SQS::Queue'],
    ['JobQueueTlsPolicy', 'AWS::SQS::QueuePolicy'],
    ['BalanceDeadLetterQueue', 'AWS::SQS::Queue'],
    ['BalanceQueue', 'AWS::SQS::Queue'],
    ['BalanceQueueTlsPolicy', 'AWS::SQS::QueuePolicy'],
  ]);
  const resourceEntryCounts = new Map();
  const invalidResourceEntryLines = [];
  const resourcesSection = topLevelSectionBlock(source, 'Resources') ?? '';
  for (const line of resourcesSection.split('\n').slice(1)) {
    if (!/^ {2}\S/.test(line) || /^ {2}#/.test(line)) continue;
    const entry = line.match(/^ {2}([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/);
    if (entry) {
      resourceEntryCounts.set(entry[1], (resourceEntryCounts.get(entry[1]) ?? 0) + 1);
    } else {
      invalidResourceEntryLines.push(line.trim());
    }
  }
  for (const [logicalId, count] of resourceEntryCounts) {
    if (count !== 1) {
      errors.push('Standalone SQS resource logical ID ' + logicalId + ' must appear exactly once.');
    }
    if (!expectedResources.has(logicalId)) {
      errors.push('Standalone SQS topology contains unapproved resource ' + logicalId + '.');
    }
  }
  if (invalidResourceEntryLines.length > 0) {
    errors.push(
      'Standalone SQS Resources contains unrecognized logical-ID syntax: ' +
        invalidResourceEntryLines.join(', ') +
        '.',
    );
  }
  if (resources.size !== expectedResources.size) {
    errors.push(
      'Standalone SQS topology must contain exactly two isolated queue/DLQ pairs and their TLS policies.',
    );
  }
  for (const [logicalId, expectedType] of expectedResources) {
    const block = resources.get(logicalId);
    if (!block) {
      errors.push(`Standalone SQS topology is missing ${logicalId}.`);
      continue;
    }
    const actualType = block.match(/^\s+Type:\s*([^\s#]+)\s*$/m)?.[1];
    const resourceAttributeCounts = new Map();
    const invalidResourceAttributeLines = [];
    for (const line of block.split('\n').slice(1)) {
      if (!/^ {4}\S/.test(line) || /^ {4}#/.test(line)) continue;
      const attribute = line.match(/^ {4}([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/);
      if (attribute) {
        resourceAttributeCounts.set(
          attribute[1],
          (resourceAttributeCounts.get(attribute[1]) ?? 0) + 1,
        );
      } else {
        invalidResourceAttributeLines.push(line.trim());
      }
    }
    for (const requiredAttribute of ['Type', 'Properties']) {
      if (resourceAttributeCounts.get(requiredAttribute) !== 1) {
        errors.push(
          logicalId + ' must declare exactly one ' + requiredAttribute + ' resource attribute.',
        );
      }
    }
    for (const attributeName of resourceAttributeCounts.keys()) {
      if (attributeName !== 'Type' && attributeName !== 'Properties') {
        errors.push(
          logicalId +
            ' contains unapproved resource attribute ' +
            attributeName +
            '; only Type and Properties are reviewed.',
        );
      }
    }
    if (invalidResourceAttributeLines.length > 0) {
      errors.push(
        logicalId +
          ' contains unrecognized resource-attribute syntax: ' +
          invalidResourceAttributeLines.join(', ') +
          '.',
      );
    }
    if (actualType !== expectedType) {
      errors.push(`${logicalId} must retain resource type ${expectedType}.`);
    }
  }
  for (const logicalId of resources.keys()) {
    if (!expectedResources.has(logicalId)) {
      errors.push(`Standalone SQS topology contains unapproved resource ${logicalId}.`);
    }
  }

  requireExactSemanticProperty(
    resources.get('JobDeadLetterQueue') ?? '',
    'JobDeadLetterQueue',
    'Properties',
    [
      'Properties:',
      "  QueueName: !Sub 'crypto-lending-${EnvironmentName}-jobs-dlq'",
      '  KmsMasterKeyId: alias/aws/sqs',
      '  MessageRetentionPeriod: 1209600',
      '  RedriveAllowPolicy:',
      '    redrivePermission: byQueue',
      '    sourceQueueArns:',
      "      - !Sub 'arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-jobs'",
      '  Tags:',
      '    - Key: application',
      '      Value: crypto-lending',
      '    - Key: environment',
      '      Value: !Ref EnvironmentName',
    ].join('\n'),
    'the exact AWS-KMS-encrypted, 14-day-retained, single-source dead-letter queue topology and tags',
    errors,
  );

  requireExactSemanticProperty(
    resources.get('JobQueue') ?? '',
    'JobQueue',
    'Properties',
    [
      'Properties:',
      "  QueueName: !Sub 'crypto-lending-${EnvironmentName}-jobs'",
      '  KmsMasterKeyId: alias/aws/sqs',
      '  MessageRetentionPeriod: 345600',
      '  ReceiveMessageWaitTimeSeconds: 10',
      '  VisibilityTimeout: 30',
      '  RedrivePolicy:',
      '    deadLetterTargetArn: !GetAtt JobDeadLetterQueue.Arn',
      '    maxReceiveCount: !Ref MaxReceiveCount',
      '  Tags:',
      '    - Key: application',
      '      Value: crypto-lending',
      '    - Key: environment',
      '      Value: !Ref EnvironmentName',
    ].join('\n'),
    'the exact AWS-KMS-encrypted, bounded-retry primary queue topology and tags',
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

  const policy = resources.get('JobQueueTlsPolicy') ?? '';
  requireMatch(
    policy,
    /^ {4}Type: AWS::SQS::QueuePolicy\s*$/m,
    'JobQueueTlsPolicy must be an AWS::SQS::QueuePolicy.',
    errors,
  );
  requireMatch(
    policy,
    / {6}Queues:\s*\n {8}- !Ref JobQueue\s*\n {8}- !Ref JobDeadLetterQueue\s*\n {6}PolicyDocument:/,
    'JobQueueTlsPolicy must attach to exactly the job queue and dead-letter queue.',
    errors,
  );
  requireMatch(
    policy,
    / {10}- Sid: DenyInsecureTransport\s*\n {12}Effect: Deny\s*\n {12}Principal: ['"]\*['"]\s*\n {12}Action: sqs:\*\s*\n {12}Resource:\s*\n {14}- !GetAtt JobQueue\.Arn\s*\n {14}- !GetAtt JobDeadLetterQueue\.Arn\s*\n {12}Condition:\s*\n {14}Bool:\s*\n {16}aws:SecureTransport: ['"]false['"]\s*$/,
    'JobQueueTlsPolicy must deny all SQS actions on both queues when aws:SecureTransport is false.',
    errors,
  );

  requireExactSemanticProperty(
    resources.get('BalanceDeadLetterQueue') ?? '',
    'BalanceDeadLetterQueue',
    'Properties',
    [
      'Properties:',
      "  QueueName: !Sub 'crypto-lending-${EnvironmentName}-balance-sync-dlq'",
      '  KmsMasterKeyId: alias/aws/sqs',
      '  MessageRetentionPeriod: 1209600',
      '  RedriveAllowPolicy:',
      '    redrivePermission: byQueue',
      '    sourceQueueArns:',
      "      - !Sub 'arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-balance-sync'",
      '  Tags:',
      '    - Key: application',
      '      Value: crypto-lending',
      '    - Key: environment',
      '      Value: !Ref EnvironmentName',
    ].join('\n'),
    'the exact AWS-KMS-encrypted, 14-day-retained, single-source balance dead-letter queue topology and tags',
    errors,
  );

  requireExactSemanticProperty(
    resources.get('BalanceQueue') ?? '',
    'BalanceQueue',
    'Properties',
    [
      'Properties:',
      "  QueueName: !Sub 'crypto-lending-${EnvironmentName}-balance-sync'",
      '  KmsMasterKeyId: alias/aws/sqs',
      '  MessageRetentionPeriod: 345600',
      '  ReceiveMessageWaitTimeSeconds: 10',
      '  VisibilityTimeout: 30',
      '  RedrivePolicy:',
      '    deadLetterTargetArn: !GetAtt BalanceDeadLetterQueue.Arn',
      '    maxReceiveCount: 3',
      '  Tags:',
      '    - Key: application',
      '      Value: crypto-lending',
      '    - Key: environment',
      '      Value: !Ref EnvironmentName',
    ].join('\n'),
    'the exact AWS-KMS-encrypted balance source queue topology, literal three-receive redrive bound, and tags',
    errors,
  );

  requireMatch(
    resources.get('BalanceQueue') ?? '',
    /^ {8}maxReceiveCount: 3$/m,
    'BalanceQueue RedrivePolicy must set maxReceiveCount to the exact literal integer 3.',
    errors,
  );

  requireExactSemanticProperty(
    resources.get('BalanceQueueTlsPolicy') ?? '',
    'BalanceQueueTlsPolicy',
    'Properties',
    [
      'Properties:',
      '  Queues:',
      '    - !Ref BalanceQueue',
      '    - !Ref BalanceDeadLetterQueue',
      '  PolicyDocument:',
      "    Version: '2012-10-17'",
      '    Statement:',
      '      - Sid: DenyInsecureTransport',
      '        Effect: Deny',
      "        Principal: '*'",
      '        Action: sqs:*',
      '        Resource:',
      '          - !GetAtt BalanceQueue.Arn',
      '          - !GetAtt BalanceDeadLetterQueue.Arn',
      '        Condition:',
      '          Bool:',
      "            aws:SecureTransport: 'false'",
    ].join('\n'),
    'the exact balance two-queue attachment and unconditional insecure-transport denial',
    errors,
  );

  return { ok: errors.length === 0, errors, awsCallsMade: 0 };
}

function parseArguments(argv) {
  const options = { template: defaultTemplatePath, json: false };
  let templateSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (options.json) throw new Error(SQS_FOUNDATION_ARGUMENT_ERROR);
      options.json = true;
      continue;
    }
    if (argument !== '--template' || templateSeen) {
      throw new Error(SQS_FOUNDATION_ARGUMENT_ERROR);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(SQS_FOUNDATION_ARGUMENT_ERROR);
    if (/^(?:\\\\[.?]\\|\\\\|\/\/)/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
      throw new Error(SQS_FOUNDATION_TEMPLATE_INPUT_ERROR);
    }
    options.template = resolve(value);
    templateSeen = true;
    index += 1;
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const { resolved, source } = readLocalSqsFoundationTemplate(options.template);
    const report = {
      ...validateSqsFoundationSource(source),
      template: resolved,
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (report.ok) {
      process.stdout.write('Standalone SQS foundation validation passed.\nAWS API calls made: 0\n');
    } else {
      process.stderr.write('Standalone SQS foundation validation failed:\n');
      for (const error of report.errors) process.stderr.write(`- ${error}\n`);
      process.stderr.write('AWS API calls made: 0\n');
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof Error &&
      [SQS_FOUNDATION_ARGUMENT_ERROR, SQS_FOUNDATION_TEMPLATE_INPUT_ERROR].includes(error.message)
        ? error.message
        : SQS_FOUNDATION_TEMPLATE_INPUT_ERROR;
    process.stderr.write(`${message}\nAWS API calls made: 0\n`);
    process.exitCode = 2;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
