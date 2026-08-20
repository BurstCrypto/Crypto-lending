#!/usr/bin/env node

/**
 * Offline, property-complete validation for the one-off database migration task.
 * This file intentionally imports no network, AWS SDK, or child-process APIs.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultTemplatePath = join(scriptDirectory, 'database-migration-task.yaml');
const reviewedTemplateSha256 = '79584004f9c60f4ebee3ca06ba41dc9f18297b1e8ada694f12a92e157522daff';

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

function readLocalTemplate(path) {
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) ||
    /^\\\\/.test(path) ||
    /^\\\\[?.]\\/.test(path)
  ) {
    throw new Error('Template must be a local filesystem path, not a URI or network path');
  }
  const resolved = isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
  const stats = lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Template must be a regular local file and not a symbolic link');
  }
  if (realpathSync(resolved) !== resolved) {
    throw new Error('Template path must resolve canonically without indirection');
  }
  return { resolved, source: readFileSync(resolved, 'utf8') };
}

function resourceInventory(source) {
  const resourcesSource = source.match(/^Resources:\s*$([\s\S]*?)(?=^Outputs:\s*$)/m)?.[1] ?? '';
  return [
    ...resourcesSource.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):\s*\n    Type:\s*([^\s#]+)\s*$/gm),
  ].map(([, logicalId, type]) => ({ logicalId, type }));
}

function exactCount(source, pattern) {
  return source.match(pattern)?.length ?? 0;
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
  if (templateBytes > 51_200) {
    errors.push(`Migration task template is ${templateBytes} bytes; direct upload allows 51200.`);
  }

  const expectedResources = new Map([
    ['MigrationTaskExecutionRole', 'AWS::IAM::Role'],
    ['MigrationTaskDefinition', 'AWS::ECS::TaskDefinition'],
  ]);
  const inventory = resourceInventory(source);
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
        `Database migration task validation passed.\nTemplate: ${resolved}\nAWS API calls made: 0\n`,
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
