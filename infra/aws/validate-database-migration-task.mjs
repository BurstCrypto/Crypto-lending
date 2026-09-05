#!/usr/bin/env node

/**
 * Offline, property-complete validation for the one-off database migration task.
 * This file intentionally imports no network, AWS SDK, or child-process APIs.
 */

import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultTemplatePath = join(scriptDirectory, 'database-migration-task.yaml');
const reviewedTemplateSha256 = '32917167b77f5e517581ed411ad5feef57691996e0bcc012ab2f3e68f3bd8c91';
const migrationBindingResidualLimitation =
  'DatabaseMigrationCredentialsSecretArn and ApplicationDataKeyArn are operator-supplied cross-stack inputs; local validation cannot authenticate their origin. The secret must be the separately scoped crypto_migration credential and must never be the RDS master/bootstrap DatabaseCredentialsSecret.';

export const MAX_DATABASE_MIGRATION_TEMPLATE_BYTES = 51_200;
export const DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR =
  'Database migration task template must be a non-empty, stable, single-link regular file of at most 51200 bytes at a canonical local path containing UTF-8 text without a byte-order mark.';

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseArguments(argv) {
  const options = { template: defaultTemplatePath, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--template') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--template requires a local file path');
      }
      options.template = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function readLocalTemplateInternal(path, afterFirstReadForTest) {
  try {
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(path, MAX_DATABASE_MIGRATION_TEMPLATE_BYTES)
        : readSecureLocalFileForTest(
            path,
            MAX_DATABASE_MIGRATION_TEMPLATE_BYTES,
            afterFirstReadForTest,
          );
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR);
    }
    return {
      resolved: resolve(path),
      source: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  } catch {
    throw new Error(DATABASE_MIGRATION_TEMPLATE_INPUT_ERROR);
  }
}

export function readLocalTemplate(path) {
  return readLocalTemplateInternal(path, undefined);
}

/** Test-only fault seam; production callers use readLocalTemplate. */
export function readLocalTemplateForTest(path, afterFirstReadForTest) {
  return readLocalTemplateInternal(path, afterFirstReadForTest);
}

function resourceInventory(source) {
  const resourcesSource = source.match(/^Resources:\s*$([\s\S]*?)(?=^Outputs:\s*$)/m)?.[1] ?? '';
  return [
    ...resourcesSource.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*\n {4}Type:\s*([^\s#]+)\s*$/gm),
  ].map(([, logicalId, type]) => ({ logicalId, type }));
}

function exactCount(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function topLevelBlocks(source, sectionName) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const sectionIndex = lines.findIndex((line) => line === `${sectionName}:`);
  if (sectionIndex < 0) return new Map();

  const blocks = new Map();
  let currentName;
  let currentLines = [];
  const saveCurrent = () => {
    if (currentName) blocks.set(currentName, currentLines.join('\n'));
  };
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9]*:\s*$/.test(line)) break;
    const start = line.match(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*$/);
    if (start) {
      saveCurrent();
      currentName = start[1];
      currentLines = [line];
    } else if (currentName) {
      currentLines.push(line);
    }
  }
  saveCurrent();
  return blocks;
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

export function validateMigrationTaskTemplate(source) {
  const errors = [];
  const templateSha256 = sha256(source);
  if (templateSha256 !== reviewedTemplateSha256) {
    errors.push(
      `Migration task template SHA-256 ${templateSha256} does not match reviewed baseline ${reviewedTemplateSha256}.`,
    );
  }
  const templateBytes = Buffer.byteLength(source, 'utf8');
  if (templateBytes > MAX_DATABASE_MIGRATION_TEMPLATE_BYTES) {
    errors.push(`Migration task template is ${templateBytes} bytes; direct upload allows 51200.`);
  }

  const parameters = topLevelBlocks(source, 'Parameters');
  for (const [name, expectedPattern] of [
    [
      'ApiImageUri',
      '^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.(amazonaws\\.com|amazonaws\\.com\\.cn)/crypto-lending-api@sha256:[a-f0-9]{64}$',
    ],
    [
      'ApiImageRepositoryArn',
      '^arn:(aws|aws-us-gov|aws-cn):ecr:[a-z0-9-]+:[0-9]{12}:repository/crypto-lending-api$',
    ],
  ]) {
    const block = parameters.get(name) ?? '';
    if (
      semanticYamlTokens(block) !==
      semanticYamlTokens(
        [name + ':', '  Type: String', `  AllowedPattern: '${expectedPattern}'`].join('\n'),
      )
    ) {
      errors.push(`${name} must bind only the exact immutable crypto-lending-api artifact.`);
    }
  }
  const databaseName = parameters.get('DatabaseName') ?? '';
  if (
    semanticYamlTokens(databaseName) !==
    semanticYamlTokens(
      ['DatabaseName:', '  Type: String', "  AllowedPattern: '^[a-z][a-z0-9_]{0,62}$'"].join('\n'),
    )
  ) {
    errors.push(
      'DatabaseName must use the canonical lowercase PostgreSQL identifier contract required by the principal bootstrap.',
    );
  }

  const expectedResources = new Map([
    ['MigrationTaskExecutionRole', 'AWS::IAM::Role'],
    ['MigrationTaskDefinition', 'AWS::ECS::TaskDefinition'],
  ]);
  const inventory = resourceInventory(source);
  const resources = topLevelBlocks(source, 'Resources');
  if (
    inventory.length !== expectedResources.size ||
    inventory.some(({ logicalId, type }) => expectedResources.get(logicalId) !== type)
  ) {
    errors.push(
      'Migration template must contain only its reviewed execution role and task definition.',
    );
  }
  if (/AWS::ECS::Service|\bDesiredCount\b|\bTaskRoleArn\b/.test(source)) {
    errors.push(
      'Migration task must remain one-off with no ECS service, DesiredCount, or task role.',
    );
  }

  const role = resources.get('MigrationTaskExecutionRole') ?? '';
  requireExactSemanticProperty(
    role,
    'MigrationTaskExecutionRole',
    'AssumeRolePolicyDocument',
    [
      'AssumeRolePolicyDocument:',
      "  Version: '2012-10-17'",
      '  Statement:',
      '    - Effect: Allow',
      '      Principal: { Service: ecs-tasks.amazonaws.com }',
      '      Action: sts:AssumeRole',
      '      Condition:',
      '        StringEquals: { aws:SourceAccount: !Ref AWS::AccountId }',
      '        ArnLike:',
      "          aws:SourceArn: !Sub 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*'",
    ].join('\n'),
    'the single-account, regional ECS task trust policy with no additional principal or action',
    errors,
  );
  requireExactSemanticProperty(
    role,
    'MigrationTaskExecutionRole',
    'Policies',
    [
      'Policies:',
      '  - PolicyName: PullMigrationImage',
      '    PolicyDocument:',
      "      Version: '2012-10-17'",
      '      Statement:',
      '        - Effect: Allow',
      '          Action: ecr:GetAuthorizationToken',
      "          Resource: '*'",
      '        - Effect: Allow',
      '          Action:',
      '            - ecr:BatchCheckLayerAvailability',
      '            - ecr:BatchGetImage',
      '            - ecr:GetDownloadUrlForLayer',
      '          Resource: !Ref ApiImageRepositoryArn',
      '  - PolicyName: WriteMigrationLogs',
      '    PolicyDocument:',
      "      Version: '2012-10-17'",
      '      Statement:',
      '        - Effect: Allow',
      '          Action: [logs:CreateLogStream, logs:PutLogEvents]',
      '          Resource: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/crypto-lending/${EnvironmentName}/outbox-worker:*',
      '  - PolicyName: ReadMigrationSecret',
      '    PolicyDocument:',
      "      Version: '2012-10-17'",
      '      Statement:',
      '        - Effect: Allow',
      '          Action: secretsmanager:GetSecretValue',
      '          Resource: !Ref DatabaseMigrationCredentialsSecretArn',
      '        - Effect: Allow',
      '          Action: kms:Decrypt',
      '          Resource: !Ref ApplicationDataKeyArn',
      '          Condition:',
      '            StringEquals:',
      '              kms:ViaService: !Sub secretsmanager.${AWS::Region}.${AWS::URLSuffix}',
    ].join('\n'),
    'the exact image-pull, migration-log, migration-secret, and Secrets Manager-only KMS action/resource matrix',
    errors,
  );
  if (/^\s+ManagedPolicyArns:\s*$/m.test(role)) {
    errors.push(
      'MigrationTaskExecutionRole must not attach managed policies outside its exact inline capability matrix.',
    );
  }

  const task = resources.get('MigrationTaskDefinition') ?? '';
  if (
    exactCount(task, /^\s+Image:\s*!Ref ApiImageUri\s*$/gm) !== 1 ||
    exactCount(task, /^\s+Image:/gm) !== 1
  ) {
    errors.push(
      'MigrationTaskDefinition must bind exactly one immutable Image reference to ApiImageUri.',
    );
  }
  if (!/^\s+ExecutionRoleArn:\s*!GetAtt MigrationTaskExecutionRole\.Arn\s*$/m.test(task)) {
    errors.push(
      'MigrationTaskDefinition must use only MigrationTaskExecutionRole as its ECS execution role.',
    );
  }
  requireExactSemanticProperty(
    task,
    'MigrationTaskDefinition',
    'Secrets',
    [
      'Secrets:',
      '  - Name: MIGRATION_DATABASE_USERNAME',
      "    ValueFrom: !Sub '${DatabaseMigrationCredentialsSecretArn}:username::'",
      '  - Name: MIGRATION_DATABASE_PASSWORD',
      "    ValueFrom: !Sub '${DatabaseMigrationCredentialsSecretArn}:password::'",
    ].join('\n'),
    'the exact migration-only username and password injection from the single migration-secret parameter',
    errors,
  );
  const environment = indentedPropertyBlock(task, 'Environment') ?? '';
  if (
    /\bName:\s*(?:MIGRATION_DATABASE_(?:USERNAME|PASSWORD)|DATABASE_RUNTIME_[A-Z_]+|REDIS_(?:URL|HOST|PORT|TLS|USERNAME|PASSWORD|AUTH_TOKEN|KEY_PREFIX|CONNECT_TIMEOUT_MS|COMMAND_TIMEOUT_MS)|APPLICATION_WORKLOAD|NODE_TLS_REJECT_UNAUTHORIZED)\b/.test(
      environment,
    )
  ) {
    errors.push(
      'MigrationTaskDefinition must inject migration credentials only through ECS Secrets and must not receive runtime, Redis, workload, or process-wide TLS overrides.',
    );
  }
  if (/\bDATABASE_RUNTIME_[A-Z_]+\b|\bDatabaseRuntimeSecret\b/.test(source)) {
    errors.push(
      'Migration task must not expose runtime database credentials or secret references.',
    );
  }
  if (/\bDATABASE_(?:URL|HOST|PORT|NAME|USERNAME|PASSWORD|SSL_MODE)\b/.test(source)) {
    errors.push('Migration task must use only explicitly scoped MIGRATION_DATABASE_* variables.');
  }

  for (const name of [
    'MIGRATION_DATABASE_HOST',
    'MIGRATION_DATABASE_PORT',
    'MIGRATION_DATABASE_NAME',
    'MIGRATION_DATABASE_LOCK_TIMEOUT_MS',
    'MIGRATION_DATABASE_SSL_MODE',
    'MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS',
    'MIGRATION_DATABASE_USERNAME',
    'MIGRATION_DATABASE_PASSWORD',
  ]) {
    if (exactCount(source, new RegExp(`\\bName:\\s*${name}\\b`, 'g')) !== 1) {
      errors.push(`MigrationTaskDefinition must bind exactly one ${name}.`);
    }
  }
  if (
    exactCount(
      source,
      /ValueFrom:\s*!Sub\s+'\$\{DatabaseMigrationCredentialsSecretArn\}:username::'/g,
    ) !== 1 ||
    exactCount(
      source,
      /ValueFrom:\s*!Sub\s+'\$\{DatabaseMigrationCredentialsSecretArn\}:password::'/g,
    ) !== 1
  ) {
    errors.push(
      'Migration task username/password must come only from the migration secret parameter.',
    );
  }
  if (
    !/Command:\s*\[node, dist\/infrastructure\/database\/migration\.cli\.js, --production, up\]/.test(
      source,
    )
  ) {
    errors.push(
      'MigrationTaskDefinition must run the compiled migration CLI in enforced production mode with command up.',
    );
  }
  for (const required of [
    /Name:\s*MIGRATION_DATABASE_LOCK_TIMEOUT_MS, Value:\s*['"]10000['"]/,
    /Name:\s*MIGRATION_DATABASE_SSL_MODE, Value:\s*verify-full/,
    /Name:\s*MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS, Value:\s*['"]3600000['"]/,
    /Name:\s*NODE_EXTRA_CA_CERTS, Value:\s*!Ref RdsCaBundlePath/,
    /ReadonlyRootFilesystem:\s*true/,
    /Capabilities:\s*\{ Drop:\s*\[ALL\]\s*\}/,
    /User:\s*'10001:10001'/,
    /NetworkMode:\s*awsvpc/,
    /RequiresCompatibilities:\s*\[FARGATE\]/,
  ]) {
    if (!required.test(source)) {
      errors.push(`MigrationTaskDefinition is missing reviewed hardening: ${required}.`);
    }
  }

  if (
    !/Action:\s*secretsmanager:GetSecretValue[\s\S]{0,100}?Resource:\s*!Ref DatabaseMigrationCredentialsSecretArn/.test(
      source,
    ) ||
    /Action:\s*secretsmanager:GetSecretValue[\s\S]{0,100}?Resource:\s*['"]?\*['"]?/.test(source)
  ) {
    errors.push('Migration execution role must read only the migration secret parameter.');
  }
  if (
    !/Action:\s*kms:Decrypt[\s\S]{0,100}?Resource:\s*!Ref ApplicationDataKeyArn[\s\S]{0,180}?kms:ViaService:\s*!Sub secretsmanager\./.test(
      source,
    )
  ) {
    errors.push(
      'Migration secret decryption must be key-scoped and limited through Secrets Manager.',
    );
  }
  if (
    !/Action:\s*ecr:GetAuthorizationToken\s*\n\s+Resource:\s*['"]\*['"]/.test(source) ||
    !/ecr:BatchGetImage[\s\S]{0,160}?Resource:\s*!Ref ApiImageRepositoryArn/.test(source) ||
    exactCount(source, /^\s+Resource:\s*['"]\*['"]\s*$/gm) !== 1
  ) {
    errors.push(
      'Migration image-pull permissions must be repository-scoped except for the ECR token.',
    );
  }
  if (
    !/ExplicitBillingAcknowledgementRequired:[\s\S]*I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES/.test(
      source,
    )
  ) {
    errors.push('Migration task registration requires the explicit billing acknowledgement rule.');
  }

  return {
    ok: errors.length === 0,
    awsCallsMade: 0,
    templateSha256,
    reviewedTemplateSha256,
    residualLimitations: [migrationBindingResidualLimitation],
    errors,
  };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const { resolved, source } = readLocalTemplate(options.template);
    const report = { ...validateMigrationTaskTemplate(source), template: resolved };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (report.ok) {
      process.stdout.write(
        `Database migration task validation passed.\nTemplate: ${resolved}\nAWS API calls made: 0\nKnown residual limitation: ${migrationBindingResidualLimitation}\n`,
      );
    } else {
      process.stderr.write(`${report.errors.join('\n')}\n`);
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
