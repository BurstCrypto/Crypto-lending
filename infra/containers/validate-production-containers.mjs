import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NODE_BASE_IMAGE =
  'node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
export const NODE_BASE_DIGEST =
  'sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e';
export const NPM_VERSION = '11.6.4';
export const RDS_BUNDLE_SHA256 = 'e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3';
const SOURCE_URL = 'https://github.com/Trey-Gleason/Crypto-lending';
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

function validateCloudFormation(applicationTemplate, migrationTemplate) {
  const errors = [];
  const application = normalize(applicationTemplate);
  const migration = normalize(migrationTemplate);
  const api = block(application, ' ApiTaskDefinition:', ' WebTaskDefinition:');
  const web = block(application, ' WebTaskDefinition:', ' WorkerTaskDefinition:');
  const worker = block(application, ' WorkerTaskDefinition:', ' ApiService:');

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
    ...validateWebDockerfile(sources.webDockerfile),
    ...validateCloudFormation(sources.applicationTemplate, sources.migrationTemplate),
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
    rootPackage = JSON.parse(sources.rootPackage);
    apiPackage = JSON.parse(sources.apiPackage);
    webPackage = JSON.parse(sources.webPackage);
  } catch {
    errors.push('Container package manifests must be valid JSON');
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
      apiPackage?.scripts?.['db:migrate:prod'] ===
        'node dist/infrastructure/database/migration.cli.js --production up',
    'API production scripts must remain compatible with the image and ECS overrides',
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
  const repositoryRoot = assertRepositoryRoot(root);
  return validateProductionContainerSources({
    apiDockerfile: readFileSync(join(repositoryRoot, 'Dockerfile.api'), 'utf8'),
    apiPackage: readFileSync(join(repositoryRoot, 'apps/api/package.json'), 'utf8'),
    applicationTemplate: readFileSync(
      join(repositoryRoot, 'infra/aws/application-baseline.yaml'),
      'utf8',
    ),
    dockerignore: readFileSync(join(repositoryRoot, '.dockerignore'), 'utf8'),
    migrationTemplate: readFileSync(
      join(repositoryRoot, 'infra/aws/database-migration-task.yaml'),
      'utf8',
    ),
    nextConfig: readFileSync(join(repositoryRoot, 'apps/web/next.config.ts'), 'utf8'),
    rdsBundle: readFileSync(join(repositoryRoot, 'infra/containers/aws-rds-global-bundle.crt')),
    rdsChecksum: readFileSync(
      join(repositoryRoot, 'infra/containers/aws-rds-global-bundle.crt.sha256'),
      'utf8',
    ),
    rootPackage: readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    webPackage: readFileSync(join(repositoryRoot, 'apps/web/package.json'), 'utf8'),
    webDockerfile: readFileSync(join(repositoryRoot, 'Dockerfile.web'), 'utf8'),
  });
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation failure';
      result = { valid: false, errors: [message] };
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
