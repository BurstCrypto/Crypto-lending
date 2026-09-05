import { X509Certificate, createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

export const NODE_BASE_IMAGE =
  'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
export const NODE_BASE_DIGEST =
  'sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
export const NPM_VERSION = '11.6.4';
export const RDS_BUNDLE_SHA256 = 'e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3';
export const MAX_PRODUCTION_CONTAINER_SOURCE_BYTES = 393_216;
export const PRODUCTION_CONTAINER_INPUT_ERROR =
  'Production container inputs must be the 18 non-empty, canonical, stable, single-link repository files within their reviewed per-file limits and 393216-byte aggregate limit; text must be strict UTF-8 without a byte-order mark.';
const SOURCE_URL = 'https://github.com/Trey-Gleason/Crypto-lending';
const REDIS_SESSION_REVOCATION_CLI_SHA256 =
  'f222f63fb2d2edc534f941a5ee5980c2b1bf7a64ec1014323cf1215196d7c8b6';
const REDIS_SESSION_REVOCATION_RUNTIME_SHA256 =
  'fd84beff96d167ba3316d9ae476256ed0b32fb2b00717a4e062c36950d73a86b';
const EXPECTED_DOCKERIGNORE = `**
!Dockerfile.api
!Dockerfile.web
!package.json
!package-lock.json
!tsconfig.base.json
!apps/
!apps/api/
!apps/api/package.json
!apps/api/nest-cli.json
!apps/api/tsconfig.json
!apps/api/tsconfig.build.json
!apps/api/src/
!apps/api/src/**
!apps/web/
!apps/web/package.json
!apps/web/next-env.d.ts
!apps/web/next.config.ts
!apps/web/tsconfig.json
!apps/web/instrumentation.ts
!apps/web/proxy.ts
!apps/web/app/
!apps/web/app/**
!apps/web/components/
!apps/web/components/**
!apps/web/lib/
!apps/web/lib/**
!infra/
!infra/containers/
!infra/containers/aws-rds-global-bundle.crt
!infra/containers/validate-built-runtime.mjs
!infra/containers/validate-oci-build-metadata.mjs
**/.env
**/.env.*
**/*.key
**/*.pem
**/*.p12
**/*.pfx
**/*.jks
**/*.keystore
**/*credential*
**/*secret*
**/node_modules
**/.next
**/dist
**/coverage
**/*.tsbuildinfo
**/*.spec.ts
**/*.test.ts
**/*.test.tsx
**/*.test.mjs
`;

const SOURCE_FILES = Object.freeze([
  Object.freeze({ key: 'apiDockerfile', path: 'Dockerfile.api', maximumBytes: 16_384 }),
  Object.freeze({
    key: 'apiPackage',
    path: 'apps/api/package.json',
    maximumBytes: 32_768,
    json: true,
  }),
  Object.freeze({
    key: 'redisSessionRevocationCli',
    path: 'apps/api/src/infrastructure/redis/redis-session-revocation.cli.ts',
    maximumBytes: 4_096,
  }),
  Object.freeze({
    key: 'redisSessionRevocationRuntime',
    path: 'apps/api/src/infrastructure/redis/redis-session-revocation.ts',
    maximumBytes: 16_384,
  }),
  Object.freeze({
    key: 'balanceConsumerActivation',
    path: 'apps/api/src/blockchain-sync/application/balance-sync-consumer.activation.ts',
    maximumBytes: 4_096,
  }),
  Object.freeze({
    key: 'balanceConsumerCli',
    path: 'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli.ts',
    maximumBytes: 8_192,
  }),
  Object.freeze({
    key: 'balanceConsumerCliMode',
    path: 'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.ts',
    maximumBytes: 16_384,
  }),
  Object.freeze({
    key: 'balanceConsumerRuntime',
    path: 'apps/api/src/blockchain-sync/application/balance-sync-consumer.runtime.ts',
    maximumBytes: 8_192,
  }),
  Object.freeze({
    key: 'applicationTemplate',
    path: 'infra/aws/application-baseline.yaml',
    maximumBytes: 65_536,
  }),
  Object.freeze({
    key: 'observabilityTemplate',
    path: 'infra/aws/application-observability.yaml',
    maximumBytes: 51_200,
  }),
  Object.freeze({ key: 'dockerignore', path: '.dockerignore', maximumBytes: 8_192 }),
  Object.freeze({
    key: 'migrationTemplate',
    path: 'infra/aws/database-migration-task.yaml',
    maximumBytes: 16_384,
  }),
  Object.freeze({ key: 'nextConfig', path: 'apps/web/next.config.ts', maximumBytes: 8_192 }),
  Object.freeze({
    key: 'rdsBundle',
    path: 'infra/containers/aws-rds-global-bundle.crt',
    maximumBytes: 196_608,
    binary: true,
  }),
  Object.freeze({
    key: 'rdsChecksum',
    path: 'infra/containers/aws-rds-global-bundle.crt.sha256',
    maximumBytes: 1_024,
  }),
  Object.freeze({ key: 'rootPackage', path: 'package.json', maximumBytes: 32_768, json: true }),
  Object.freeze({
    key: 'webPackage',
    path: 'apps/web/package.json',
    maximumBytes: 16_384,
    json: true,
  }),
  Object.freeze({ key: 'webDockerfile', path: 'Dockerfile.web', maximumBytes: 16_384 }),
]);

export const PRODUCTION_CONTAINER_SOURCE_PATHS = Object.freeze(
  SOURCE_FILES.map(({ path }) => path),
);

function invalidProductionContainerInput() {
  throw new Error(PRODUCTION_CONTAINER_INPUT_ERROR);
}

function decodeStrictText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return invalidProductionContainerInput();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalidProductionContainerInput();
  }
}

function normalize(value) {
  return value.replaceAll('\r\n', '\n');
}

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function block(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return '';
  return source.slice(startIndex, endIndex);
}

function validateSharedDockerfile(source, filename, expected) {
  const errors = [];
  const normalized = normalize(source);
  const fromLines = [...normalized.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/gimu)].map(
    (match) => match[1],
  );

  addError(
    errors,
    fromLines.length === 3,
    `${filename} must have exactly metadata, build, and runtime stages`,
  );
  addError(
    errors,
    fromLines.length === 3 && fromLines.every((image) => image === NODE_BASE_IMAGE),
    `${filename} must pin every stage to the reviewed Node manifest-list digest`,
  );
  addError(
    errors,
    !/(?:^|\s)--platform(?:=|\s)|TARGETARCH|TARGETPLATFORM|\b(?:amd64|arm64|x86_64|aarch64)\b/iu.test(
      normalized,
    ),
    `${filename} must not hardcode a build or runtime architecture`,
  );
  addError(errors, !/^\s*ADD\b/imu.test(normalized), `${filename} must not use ADD`);
  addError(
    errors,
    count(normalized, /^ENTRYPOINT \[\]$/gmu) === 1,
    `${filename} must clear the base image shell entrypoint`,
  );
  addError(
    errors,
    !/\b(?:curl|wget)\b|\bgit\s+clone\b|COPY\s+https?:\/\//iu.test(normalized),
    `${filename} must not fetch ad-hoc remote build inputs`,
  );
  addError(
    errors,
    !/https?:\/\//iu.test(normalized.replaceAll(SOURCE_URL, '').replaceAll(expected.health, '')),
    `${filename} must contain no URL except the canonical OCI source and loopback health target`,
  );
  addError(
    errors,
    !/^\s*COPY(?:\s+--[^\s]+)*\s+\.\s+/imu.test(normalized),
    `${filename} must not copy the complete build context`,
  );
  addError(
    errors,
    !/^\s*(?:ARG|ENV)\s+[^\n]*(?:SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL|AUTH_|DATABASE_|REDIS_|RPC_)/imu.test(
      normalized,
    ),
    `${filename} must not accept or bake application credentials or configuration`,
  );
  const argNames = [...normalized.matchAll(/^ARG\s+([A-Z][A-Z0-9_]*)/gmu)].map((match) => match[1]);
  addError(
    errors,
    argNames.length === 11 &&
      ['OCI_SOURCE', 'OCI_REVISION', 'OCI_CREATED'].every(
        (name) => argNames.filter((candidate) => candidate === name).length === 3,
      ) &&
      argNames.filter((candidate) => candidate === 'SOURCE_DATE_EPOCH').length === 2,
    `${filename} must expose only the validated OCI arguments and fixed reproducible timestamp input`,
  );
  addError(
    errors,
    normalized.includes('ARG OCI_SOURCE=\n') &&
      normalized.includes('ARG OCI_REVISION=0000000000000000000000000000000000000000') &&
      normalized.includes('ARG OCI_CREATED=1970-01-01T00:00:00Z') &&
      normalized.includes('ARG SOURCE_DATE_EPOCH=0') &&
      normalized.includes('SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}') &&
      normalized.includes('RUN ["node", "infra/containers/validate-oci-build-metadata.mjs"]'),
    `${filename} must use deterministic fail-closed metadata defaults, timestamp normalization, and validation`,
  );
  addError(
    errors,
    normalized.includes(
      'COPY --from=metadata --chown=0:0 /oci-metadata.validated /usr/share/crypto-lending/oci-metadata.validated',
    ),
    `${filename} runtime must depend on successful OCI metadata validation`,
  );
  addError(
    errors,
    normalized.includes('RUN ["npm", "install", "--global", "npm@11.6.4"]') &&
      normalized.includes(".trim() !== '11.6.4'") &&
      normalized.includes('NPM_CONFIG_IGNORE_SCRIPTS=true'),
    `${filename} must activate and verify the repository-pinned npm version with lifecycle scripts disabled`,
  );
  addError(
    errors,
    normalized.includes(
      `RUN ["npm", "ci", "--workspace", "${expected.workspace}", "--include-workspace-root=false"]`,
    ),
    `${filename} must install its exact workspace lock with npm ci`,
  );
  addError(
    errors,
    count(normalized, /^USER 10001:10001$/gmu) === 1,
    `${filename} must run as UID/GID 10001`,
  );
  addError(
    errors,
    normalized.includes('useradd --uid 10001 --gid 10001 --no-create-home'),
    `${filename} must create the numeric non-root runtime identity`,
  );
  addError(
    errors,
    normalized.includes(
      'rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg',
    ),
    `${filename} must remove build-time package managers from the runtime`,
  );
  addError(
    errors,
    normalized.includes('ENV NODE_ENV=production'),
    `${filename} must default to production mode`,
  );
  addError(
    errors,
    normalized.includes(`org.opencontainers.image.base.digest="${NODE_BASE_DIGEST}"`) &&
      normalized.includes('org.opencontainers.image.created="${OCI_CREATED}"') &&
      normalized.includes('org.opencontainers.image.revision="${OCI_REVISION}"') &&
      normalized.includes('org.opencontainers.image.source="${OCI_SOURCE}"'),
    `${filename} must bind the required OCI and base-image labels`,
  );
  addError(
    errors,
    normalized.includes(`EXPOSE ${expected.port}`),
    `${filename} must expose port ${expected.port}`,
  );
  addError(
    errors,
    normalized.includes(expected.health),
    `${filename} must use its loopback process-health probe`,
  );
  addError(
    errors,
    normalized.includes(expected.command),
    `${filename} must use the exact exec-form default command`,
  );
  addError(
    errors,
    !/^CMD\s+[^[]/imu.test(normalized),
    `${filename} must not use a shell-form default command`,
  );
  addError(
    errors,
    normalized.includes('STOPSIGNAL SIGTERM'),
    `${filename} must declare SIGTERM shutdown`,
  );
  addError(
    errors,
    normalized.includes(
      `RUN ["node", "infra/containers/validate-built-runtime.mjs", "${expected.runtimeMode}", "${expected.runtimeRoot}"]`,
    ),
    `${filename} must run its built-runtime dependency boundary check`,
  );

  return errors;
}

function validateApiDockerfile(source) {
  const errors = validateSharedDockerfile(source, 'Dockerfile.api', {
    command: 'CMD ["node", "dist/main.js"]',
    health: 'http://127.0.0.1:3001/api/v1/health',
    port: 3001,
    runtimeMode: 'api',
    runtimeRoot: 'apps/api',
    workspace: '@crypto-lending/api',
  });
  const normalized = normalize(source);
  addError(
    errors,
    normalized.includes(
      'RUN ["npm", "prune", "--omit=dev", "--workspace", "@crypto-lending/api", "--include-workspace-root=false"]',
    ),
    'Dockerfile.api must remove development dependencies before runtime assembly',
  );
  addError(
    errors,
    normalized.includes(
      "['apps/api/dist/local-demo','apps/api/dist/public-testnet','apps/api/dist/evm-public-testnet','apps/api/dist/local-development-app.module.js']",
    ),
    'Dockerfile.api must remove development-only compiled modules before runtime assembly',
  );
  for (const artifact of [
    '/workspace/node_modules /app/node_modules',
    '/workspace/apps/api/node_modules ./node_modules',
    '/workspace/apps/api/dist ./dist',
  ]) {
    addError(
      errors,
      normalized.includes(artifact),
      `Dockerfile.api must copy runtime artifact ${artifact}`,
    );
  }
  addError(
    errors,
    normalized.includes(
      'infra/containers/aws-rds-global-bundle.crt /etc/ssl/certs/aws-rds-global-bundle.pem',
    ),
    'Dockerfile.api must install the checksum-controlled RDS trust bundle at the ECS path',
  );
  addError(
    errors,
    normalized.includes('WORKDIR /app/apps/api'),
    'Dockerfile.api runtime workdir is incompatible',
  );
  return errors;
}

function validateBalanceConsumerExecutable(sources) {
  const errors = [];
  const runtimeWithoutComments = normalize(sources.balanceConsumerRuntime)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*(?:\n|$)/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const expectedDormantRuntime = [
    "import { Module } from '@nestjs/common';",
    "import type { BalanceConsumerRuntimeModule } from './balance-sync-consumer.cli-mode';",
    '@Module({})',
    'export class DormantBalanceSyncConsumerRuntimeModule {}',
    "export const startBalanceSyncConsumerRuntime: BalanceConsumerRuntimeModule['startBalanceSyncConsumerRuntime'] = () => Promise.reject(new Error('BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED'));",
  ].join(' ');
  const forbiddenRuntimeDependency =
    /\b(?:InfrastructureConfigModule|MigrationRunner|OUTBOX_TRANSPORT|PostgresModule|PostgresService|SQS(?:_[A-Z0-9]+)+|Sqs[A-Za-z0-9_]*)\b/u;
  addError(
    errors,
    /export const BALANCE_CONSUMER_SOURCE_ACTIVATION = Object\.freeze\(\{\s*enabled: false as boolean,\s*\}\);/u.test(
      sources.balanceConsumerActivation,
    ),
    'Balance consumer source activation must remain immutably disabled',
  );
  addError(
    errors,
    sources.balanceConsumerCliMode.includes("return import('./balance-sync-consumer.runtime');") &&
      !/\bfrom\s+['"][^'"]*(?:@nestjs|postgres\.module|sqs\.module|balance-sync-consumer\.runtime)/u.test(
        sources.balanceConsumerCliMode,
      ),
    'Balance consumer clients must remain behind the dynamic runtime import',
  );
  addError(
    errors,
    runtimeWithoutComments === expectedDormantRuntime &&
      !forbiddenRuntimeDependency.test(runtimeWithoutComments),
    'Balance consumer dormant runtime must remain dependency-empty and reject with its fixed not-composed error',
  );
  addError(
    errors,
    !sources.balanceConsumerCli.includes('load-dotenv') &&
      !sources.balanceConsumerCli.includes("from '@nestjs") &&
      sources.balanceConsumerCli.includes("from './balance-sync-consumer.cli-mode'") &&
      sources.balanceConsumerCli.includes('installFatalProcessBoundary(logger)'),
    'Balance consumer CLI must evaluate fail-closed mode before framework configuration loads',
  );
  return errors;
}

function validateRedisSessionRevocationExecutable(sources) {
  const errors = [];
  const cliDigest = createHash('sha256')
    .update(sources.redisSessionRevocationCli, 'utf8')
    .digest('hex');
  const runtimeDigest = createHash('sha256')
    .update(sources.redisSessionRevocationRuntime, 'utf8')
    .digest('hex');
  addError(
    errors,
    cliDigest === REDIS_SESSION_REVOCATION_CLI_SHA256,
    'Redis session-revocation CLI must match the exact reviewed source',
  );
  addError(
    errors,
    runtimeDigest === REDIS_SESSION_REVOCATION_RUNTIME_SHA256,
    'Redis session-revocation runtime must match the exact reviewed source',
  );
  return errors;
}

function validateWebDockerfile(source) {
  const errors = validateSharedDockerfile(source, 'Dockerfile.web', {
    command: 'CMD ["node", "server.js"]',
    health: 'http://127.0.0.1:3000/api/health',
    port: 3000,
    runtimeMode: 'web',
    runtimeRoot: 'apps/web/.next/standalone',
    workspace: '@crypto-lending/web',
  });
  const normalized = normalize(source);
  addError(
    errors,
    normalized.includes('/workspace/apps/web/.next/standalone /app') &&
      normalized.includes('/workspace/apps/web/.next/static /app/apps/web/.next/static'),
    'Dockerfile.web must assemble only the standalone server and static output',
  );
  addError(
    errors,
    normalized.includes('WORKDIR /app/apps/web'),
    'Dockerfile.web runtime workdir is incompatible',
  );
  addError(
    errors,
    normalized.includes('HOSTNAME=0.0.0.0'),
    'Dockerfile.web must listen on every task interface',
  );
  addError(
    errors,
    normalized.includes('JSON.stringify({name:current.name,private:true,version:current.version})'),
    'Dockerfile.web must strip development metadata from its standalone manifest',
  );
  return errors;
}

function validateCloudFormation(applicationTemplate, migrationTemplate, observabilityTemplate) {
  const errors = [];
  const application = normalize(applicationTemplate);
  const migration = normalize(migrationTemplate);
  const observability = normalize(observabilityTemplate);
  const api = block(application, ' ApiTaskDefinition:', ' WebTaskDefinition:');
  const web = block(application, ' WebTaskDefinition:', ' WorkerTaskDefinition:');
  const worker = block(application, ' WorkerTaskDefinition:', ' ApiService:');
  const redisRevocation = block(
    observability,
    '  RedisSessionRevocationTaskDefinition:',
    '\nOutputs:',
  );

  addError(
    errors,
    api.length > 0 && !/^\s+Command:/mu.test(api),
    'API task must retain the image default command',
  );
  addError(
    errors,
    web.length > 0 && !/^\s+Command:/mu.test(web),
    'Web task must retain the image default command',
  );
  addError(
    errors,
    worker.includes('Command: [node, dist/infrastructure/outbox/outbox-worker.cli.js]') &&
      worker.includes(
        'Command: [CMD, node, dist/infrastructure/outbox/outbox-worker-health.cli.js]',
      ),
    'Worker task commands must exist in the API image build output',
  );
  addError(
    errors,
    migration.includes(
      'Command: [node, dist/infrastructure/database/migration.cli.js, --production, up]',
    ),
    'Migration task command must exist in the API image build output',
  );
  addError(
    errors,
    observability.includes(
      'RedisOperatorMode:\n    Type: String\n    Default: DISABLED\n    AllowedValues: [DISABLED, ENABLED]',
    ) &&
      observability.includes('RedisOperatorEnabled: !Equals [!Ref RedisOperatorMode, ENABLED]') &&
      redisRevocation.includes('Type: AWS::ECS::TaskDefinition') &&
      redisRevocation.includes('Condition: RedisOperatorEnabled') &&
      redisRevocation.includes(
        'Command: [node, dist/infrastructure/redis/redis-session-revocation.cli.js]',
      ) &&
      redisRevocation.includes('Image: !Ref ApiImageUri') &&
      redisRevocation.includes('Name: PRODUCT_NETWORK_SCOPE, Value: ethereum-solana-mainnet') &&
      redisRevocation.includes('Name: REDIS_CREDENTIAL_PHASE, Value: !Ref RedisCredentialPhase') &&
      redisRevocation.includes(
        "ValueFrom: !Sub '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}'",
      ) &&
      redisRevocation.includes('Capabilities: { Drop: [ALL] }') &&
      redisRevocation.includes('ReadonlyRootFilesystem: true') &&
      redisRevocation.includes("User: '10001:10001'") &&
      !redisRevocation.includes('TaskRoleArn:') &&
      !redisRevocation.includes('DesiredCount:') &&
      !redisRevocation.includes('EnableExecuteCommand:') &&
      !observability.includes('Type: AWS::ECS::Service'),
    'Redis revocation task must remain a disabled-by-default, exact-command, hardened one-off API-image task',
  );
  for (const [name, task, port] of [
    ['API', api, 3001],
    ['web', web, 3000],
  ]) {
    addError(
      errors,
      task.includes(`ContainerPort: ${port}`),
      `${name} task port must match its image`,
    );
    addError(
      errors,
      task.includes("User: '10001:10001'"),
      `${name} task user must match its image`,
    );
    addError(
      errors,
      task.includes('ReadonlyRootFilesystem: true'),
      `${name} task must keep its root read-only`,
    );
  }
  for (const [name, task] of [
    ['worker', worker],
    ['migration', migration],
  ]) {
    addError(
      errors,
      task.includes("User: '10001:10001'"),
      `${name} task user must match its image`,
    );
    addError(
      errors,
      task.includes('ReadonlyRootFilesystem: true'),
      `${name} task must keep its root read-only`,
    );
    addError(
      errors,
      task.includes('NODE_EXTRA_CA_CERTS') && task.includes('RdsCaBundlePath'),
      `${name} task must use the image RDS trust-bundle path`,
    );
  }
  addError(
    errors,
    application.includes('Default: /etc/ssl/certs/aws-rds-global-bundle.pem') &&
      migration.includes('Default: /etc/ssl/certs/aws-rds-global-bundle.pem'),
    'CloudFormation RDS trust-bundle defaults must match the API image',
  );
  return errors;
}

function validateRdsBundle(bundle, checksumFile) {
  const errors = [];
  const digest = createHash('sha256').update(bundle).digest('hex');
  addError(
    errors,
    digest === RDS_BUNDLE_SHA256,
    'Vendored AWS RDS global bundle digest is not reviewed',
  );
  addError(
    errors,
    checksumFile === `${RDS_BUNDLE_SHA256}  aws-rds-global-bundle.crt\n`,
    'AWS RDS bundle checksum sidecar is inconsistent',
  );
  const certificates = bundle
    .toString('utf8')
    .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu);
  let parsed = true;
  try {
    for (const certificate of certificates ?? []) new X509Certificate(certificate);
  } catch {
    parsed = false;
  }
  addError(
    errors,
    certificates?.length === 108 && parsed,
    'Vendored AWS RDS global bundle must contain the 108 reviewed parseable certificates',
  );
  return errors;
}

export function validateProductionContainerSources(sources) {
  const errors = [
    ...validateApiDockerfile(sources.apiDockerfile),
    ...validateBalanceConsumerExecutable(sources),
    ...validateRedisSessionRevocationExecutable(sources),
    ...validateWebDockerfile(sources.webDockerfile),
    ...validateCloudFormation(
      sources.applicationTemplate,
      sources.migrationTemplate,
      sources.observabilityTemplate,
    ),
    ...validateRdsBundle(sources.rdsBundle, normalize(sources.rdsChecksum)),
  ];
  addError(
    errors,
    normalize(sources.dockerignore) === EXPECTED_DOCKERIGNORE,
    '.dockerignore must remain the reviewed build-context allowlist',
  );

  let rootPackage;
  let apiPackage;
  let webPackage;
  try {
    rootPackage = parseStrictJsonBytes(asJsonBytes(sources.rootPackage));
    apiPackage = parseStrictJsonBytes(asJsonBytes(sources.apiPackage));
    webPackage = parseStrictJsonBytes(asJsonBytes(sources.webPackage));
  } catch {
    errors.push(
      'Container package manifests must be strict UTF-8 JSON without a byte-order mark or duplicate object keys',
    );
  }
  addError(
    errors,
    rootPackage?.packageManager === `npm@${NPM_VERSION}`,
    'Root packageManager must match the Docker build npm version',
  );
  addError(
    errors,
    apiPackage?.scripts?.['start:prod'] === 'node dist/main.js' &&
      apiPackage?.scripts?.['worker:outbox:prod'] ===
        'node dist/infrastructure/outbox/outbox-worker.cli.js' &&
      apiPackage?.scripts?.['worker:balance'] ===
        'tsx src/blockchain-sync/application/balance-sync-consumer.cli.ts' &&
      apiPackage?.scripts?.['worker:balance:prod'] ===
        'node dist/blockchain-sync/application/balance-sync-consumer.cli.js' &&
      apiPackage?.scripts?.['redis:revoke-inactive-sessions'] ===
        'tsx src/infrastructure/redis/redis-session-revocation.cli.ts' &&
      apiPackage?.scripts?.['redis:revoke-inactive-sessions:prod'] ===
        'node dist/infrastructure/redis/redis-session-revocation.cli.js' &&
      apiPackage?.scripts?.['db:migrate:prod'] ===
        'node dist/infrastructure/database/migration.cli.js --production up',
    'API production scripts must remain compatible with the image and ECS overrides',
  );
  addError(
    errors,
    rootPackage?.scripts?.['worker:balance'] ===
      'npm run worker:balance --workspace @crypto-lending/api' &&
      rootPackage?.scripts?.['worker:balance:prod'] ===
        'npm run worker:balance:prod --workspace @crypto-lending/api',
    'Root package must expose the fail-closed balance consumer production command',
  );
  addError(
    errors,
    apiPackage?.dependencies?.['@solana/web3.js'] === undefined &&
      webPackage?.dependencies?.['@solana/web3.js'] === undefined,
    '@solana/web3.js must remain outside both production dependency graphs',
  );
  addError(
    errors,
    /output:\s*['"]standalone['"]/u.test(sources.nextConfig),
    'Next.js must keep standalone output enabled',
  );

  return Object.freeze({
    baseImage: NODE_BASE_IMAGE,
    errors: Object.freeze(errors),
    npmVersion: NPM_VERSION,
    rdsBundleSha256: RDS_BUNDLE_SHA256,
    valid: errors.length === 0,
  });
}

function asJsonBytes(source) {
  if (typeof source === 'string') return Buffer.from(source, 'utf8');
  if (source instanceof Uint8Array) return source;
  return invalidProductionContainerInput();
}

function assertRepositoryRoot(root) {
  const resolved = resolve(root);
  const physical = realpathSync(resolved);
  const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (relative(physical, realpathSync(scriptRoot)) !== '') {
    throw new Error('Validator root must be this repository');
  }
  return physical;
}

export function validateProductionContainers(
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
) {
  try {
    const repositoryRoot = assertRepositoryRoot(root);
    return validateProductionContainerSources(loadProductionContainerSources(repositoryRoot));
  } catch {
    return invalidProductionContainerInput();
  }
}

function loadProductionContainerSourcesInternal(repositoryRoot, faultPath, afterFirstReadForTest) {
  try {
    if (
      SOURCE_FILES.length !== 18 ||
      new Set(SOURCE_FILES.map(({ key }) => key)).size !== SOURCE_FILES.length ||
      new Set(SOURCE_FILES.map(({ path }) => path)).size !== SOURCE_FILES.length
    ) {
      return invalidProductionContainerInput();
    }

    const sources = {};
    let aggregateBytes = 0;
    for (const source of SOURCE_FILES) {
      const filePath = join(repositoryRoot, source.path);
      const bytes =
        source.path === faultPath
          ? readSecureLocalFileForTest(filePath, source.maximumBytes, afterFirstReadForTest)
          : readSecureLocalFile(filePath, source.maximumBytes);
      aggregateBytes += bytes.byteLength;
      if (aggregateBytes > MAX_PRODUCTION_CONTAINER_SOURCE_BYTES) {
        return invalidProductionContainerInput();
      }
      sources[source.key] = source.binary || source.json ? bytes : decodeStrictText(bytes);
    }
    return Object.freeze(sources);
  } catch {
    return invalidProductionContainerInput();
  }
}

function loadProductionContainerSources(repositoryRoot) {
  return loadProductionContainerSourcesInternal(repositoryRoot, undefined, undefined);
}

/** Test-only fault seam; production callers use validateProductionContainers. */
export function loadProductionContainerSourcesForTest(
  repositoryRoot,
  faultPath,
  afterFirstReadForTest,
) {
  if (
    faultPath !== undefined &&
    (!PRODUCTION_CONTAINER_SOURCE_PATHS.includes(faultPath) ||
      typeof afterFirstReadForTest !== 'function')
  ) {
    return invalidProductionContainerInput();
  }
  return loadProductionContainerSourcesInternal(
    resolve(repositoryRoot),
    faultPath,
    afterFirstReadForTest,
  );
}

function isDirectExecution() {
  const script = process.argv[1];
  return script !== undefined && pathToFileURL(resolve(script)).href === import.meta.url;
}

if (isDirectExecution()) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
    process.stderr.write(
      'Usage: node infra/containers/validate-production-containers.mjs [--json]\n',
    );
    process.exitCode = 2;
  } else {
    let result;
    try {
      result = validateProductionContainers();
    } catch {
      result = { valid: false, errors: [PRODUCTION_CONTAINER_INPUT_ERROR] };
    }
    if (args[0] === '--json') {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (result.valid) {
      process.stdout.write(
        `Production container validation passed.\nBase: ${result.baseImage}\nRDS bundle SHA-256: ${result.rdsBundleSha256}\nNetwork calls made: 0\n`,
      );
    } else {
      for (const error of result.errors) process.stderr.write(`${error}\n`);
    }
    if (!result.valid) process.exitCode = 1;
  }
}
