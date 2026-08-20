#!/usr/bin/env node

/**
 * Local-only validation for the standalone SQS foundation transport boundary.
 * This file reads a local template and never loads an AWS SDK or performs I/O
 * beyond the local filesystem.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

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
    const entry = line.match(/^  ([A-Za-z][A-Za-z0-9]*):\s*$/);
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

export function validateSqsFoundationSource(source) {
  const errors = [];
  if (/^\s*(?:["']?Transform["']?|["']?Fn::Transform["']?)\s*:/m.test(source)) {
    errors.push('Standalone SQS template must not use transforms or macros.');
  }
  if (/^\s*(?:["']?<<["']?)\s*:/m.test(source)) {
    errors.push('Standalone SQS template must not use YAML merge keys.');
  }

  const policy = topLevelBlocks(source, 'Resources').get('JobQueueTlsPolicy') ?? '';
  requireMatch(
    policy,
    /^    Type: AWS::SQS::QueuePolicy\s*$/m,
    'JobQueueTlsPolicy must be an AWS::SQS::QueuePolicy.',
    errors,
  );
  requireMatch(
    policy,
    /      Queues:\s*\n        - !Ref JobQueue\s*\n        - !Ref JobDeadLetterQueue\s*\n      PolicyDocument:/,
    'JobQueueTlsPolicy must attach to exactly the job queue and dead-letter queue.',
    errors,
  );
  requireMatch(
    policy,
    /          - Sid: DenyInsecureTransport\s*\n            Effect: Deny\s*\n            Principal: ['"]\*['"]\s*\n            Action: sqs:\*\s*\n            Resource:\s*\n              - !GetAtt JobQueue\.Arn\s*\n              - !GetAtt JobDeadLetterQueue\.Arn\s*\n            Condition:\s*\n              Bool:\s*\n                aws:SecureTransport: ['"]false['"]\s*$/,
    'JobQueueTlsPolicy must deny all SQS actions on both queues when aws:SecureTransport is false.',
    errors,
  );

  return { ok: errors.length === 0, errors, awsCallsMade: 0 };
}

function parseArguments(argv) {
  const options = { template: join(scriptDirectory, 'sqs-foundation.yaml'), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument !== '--template') throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--template requires a path.');
    if (/^(?:\\\\[.?]\\|\\\\|\/\/)/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
      throw new Error('--template requires a local filesystem path, not a URI or network path.');
    }
    options.template = resolve(value);
    index += 1;
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const info = lstatSync(options.template);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error('--template must identify a regular local file, not a symbolic link.');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\nAWS API calls made: 0\n`);
    process.exit(2);
  }

  const report = {
    ...validateSqsFoundationSource(readFileSync(options.template, 'utf8')),
    template: options.template,
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
  process.exit(report.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
