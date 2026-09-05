import assert from 'node:assert/strict';
import {
  appendFileSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  validateBuiltApiRuntime,
  validateBuiltWebRuntime,
  validateBuiltWebRuntimeForTest,
} from './validate-built-runtime.mjs';

const VALIDATOR_PATH = fileURLToPath(new URL('./validate-built-runtime.mjs', import.meta.url));
const WEB_MANIFEST_PATH = 'apps/web/package.json';
const WEB_SERVER_PATH = 'apps/web/server.js';

function temporaryRoot(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function withProduction(callback) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

function apiFixture(t) {
  const root = temporaryRoot(t, 'crypto-lending-api-runtime-');
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'blockchain-sync/application'), { recursive: true });
  mkdirSync(join(dist, 'infrastructure/outbox'), { recursive: true });
  mkdirSync(join(dist, 'infrastructure/database'), { recursive: true });
  for (const file of [
    'main.js',
    'app.module.js',
    'blockchain-sync/application/balance-sync-consumer.cli-mode.js',
    'blockchain-sync/application/balance-sync-consumer.cli.js',
    'blockchain-sync/application/balance-sync-consumer.runtime.js',
    'infrastructure/outbox/outbox-worker.cli.js',
    'infrastructure/outbox/outbox-worker-health.cli.js',
    'infrastructure/database/migration.cli.js',
  ]) {
    writeFileSync(join(dist, file), 'module.exports = Object.freeze({});\n', 'utf8');
  }
  writeFileSync(
    join(dist, 'blockchain-sync/application/balance-sync-consumer.activation.js'),
    'module.exports.BALANCE_CONSUMER_SOURCE_ACTIVATION=Object.freeze({enabled:false});\n',
    'utf8',
  );
  return root;
}

function webFixture(t) {
  const root = temporaryRoot(t, 'crypto-lending-web-runtime-');
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  writeFileSync(join(root, 'apps/web/server.js'), "console.log('server');\n", 'utf8');
  writeFileSync(
    join(root, 'apps/web/package.json'),
    '{"name":"@crypto-lending/web","private":true,"version":"0.1.0"}\n',
    'utf8',
  );
  return root;
}

function addPackage(root, name) {
  const packageRoot = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name, main: 'index.js', version: '1.0.0' }),
    'utf8',
  );
  writeFileSync(join(packageRoot, 'index.js'), 'module.exports = {};\n', 'utf8');
}

function createSymbolicLinkOrSkip(t, target, path, type) {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      ['EACCES', 'EINVAL', 'ENOSYS', 'EPERM', 'UNKNOWN'].includes(error.code)
    ) {
      t.skip(`symbolic links are unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test('accepts an API runtime whose production root cannot resolve test-only SDKs', (t) => {
  const report = withProduction(() => validateBuiltApiRuntime(apiFixture(t)));
  assert.equal(report.valid, true);
  assert.equal(report.checkedEntrypoints, 9);
});

test('rejects an API runtime that can resolve a test-only SDK', (t) => {
  const root = apiFixture(t);
  addPackage(root, '@solana/web3.js');
  assert.throws(
    () => withProduction(() => validateBuiltApiRuntime(root)),
    /Forbidden production dependency resolves: @solana\/web3\.js/u,
  );
});

test('requires production mode and every API executable used by ECS', (t) => {
  const root = apiFixture(t);
  assert.throws(() => validateBuiltApiRuntime(root), /requires NODE_ENV=production/u);
  rmSync(join(root, 'dist/infrastructure/database/migration.cli.js'));
  assert.throws(
    () => withProduction(() => validateBuiltApiRuntime(root)),
    /Missing API runtime artifact/u,
  );
});

test('rejects an enabled compiled balance-consumer activation gate', (t) => {
  const root = apiFixture(t);
  writeFileSync(
    join(root, 'dist/blockchain-sync/application/balance-sync-consumer.activation.js'),
    'module.exports.BALANCE_CONSUMER_SOURCE_ACTIVATION=Object.freeze({enabled:true});\n',
    'utf8',
  );
  assert.throws(
    () => withProduction(() => validateBuiltApiRuntime(root)),
    /API balance-consumer activation gate is invalid/u,
  );
});

test('rejects a compiled local-demo or public-testnet module in the API runtime', (t) => {
  const root = apiFixture(t);
  mkdirSync(join(root, 'dist/public-testnet'));
  assert.throws(
    () => withProduction(() => validateBuiltApiRuntime(root)),
    /Development-only API artifact reached production/u,
  );
});

test('accepts harmless shared public-testnet text in the minimal web runtime', (t) => {
  const root = webFixture(t);
  writeFileSync(
    join(root, 'apps/web/chunk.js'),
    "const cssClass = 'public-testnet-status';\n",
    'utf8',
  );
  assert.equal(withProduction(() => validateBuiltWebRuntime(root)).valid, true);
});

test('rejects forbidden SDK package paths and module markers in the web runtime', (t) => {
  const packageRoot = webFixture(t);
  addPackage(packageRoot, 'jayson');
  assert.throws(
    () => withProduction(() => validateBuiltWebRuntime(packageRoot)),
    /Forbidden web standalone package directory: jayson/u,
  );

  const markerRoot = webFixture(t);
  writeFileSync(
    join(markerRoot, 'apps/web/chunk.js'),
    'const sdk = require("@solana/web3.js");\n',
    'utf8',
  );
  assert.throws(
    () => withProduction(() => validateBuiltWebRuntime(markerRoot)),
    /Forbidden web standalone marker: @solana\/web3\.js/u,
  );
});

test('rejects an unsanitized standalone package manifest', (t) => {
  const root = webFixture(t);
  writeFileSync(
    join(root, 'apps/web/package.json'),
    '{"dependencies":{"@solana/web3.js":"1.98.4"},"name":"@crypto-lending/web","private":true,"version":"0.1.0"}\n',
    'utf8',
  );
  assert.throws(
    () => withProduction(() => validateBuiltWebRuntime(root)),
    /Web standalone manifest is invalid or non-canonical/u,
  );
});

test('accepts the legitimate empty client-only shim', (t) => {
  const root = webFixture(t);
  mkdirSync(join(root, 'node_modules/client-only'), { recursive: true });
  writeFileSync(join(root, 'node_modules/client-only/index.js'), Buffer.alloc(0));
  const report = withProduction(() => validateBuiltWebRuntime(root));
  assert.equal(report.valid, true);
  assert.equal(report.scannedFiles, 3);
});

test('rejects ambiguous, non-canonical, BOM-prefixed, and invalid UTF-8 manifests', (t) => {
  const ambiguousManifests = [
    '{"name":"@crypto-lending/web","name":"@crypto-lending/web","private":true,"version":"0.1.0"}\n',
    '{ "name":"@crypto-lending/web","private":true,"version":"0.1.0"}\n',
    '{"private":true,"name":"@crypto-lending/web","version":"0.1.0"}\n',
    '{"name":"customer-controlled-name","private":true,"version":"0.1.0"}\n',
    '{"name":"@crypto-lending/web","private":false,"version":"0.1.0"}\n',
    '{"name":"@crypto-lending/web","private":true,"version":"01.0.0"}\n',
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('{"name":"@crypto-lending/web","private":true,"version":"0.1.0"}\n', 'utf8'),
    ]),
    Buffer.from([
      ...Buffer.from('{"name":"@crypto-lending/web","private":true,"version":"0.1.', 'utf8'),
      0xc3,
      0x28,
      ...Buffer.from('"}\n', 'utf8'),
    ]),
  ];
  for (const [index, manifest] of ambiguousManifests.entries()) {
    const root = webFixture(t);
    writeFileSync(join(root, WEB_MANIFEST_PATH), manifest);
    assert.throws(
      () => withProduction(() => validateBuiltWebRuntime(root)),
      /Web standalone manifest is invalid or non-canonical/u,
      `manifest fixture ${index} should fail closed`,
    );
  }
});

test('rejects symbolic links without following them', (t) => {
  const fileRoot = webFixture(t);
  const realServer = join(fileRoot, 'apps/web/real-server.js');
  writeFileSync(realServer, "console.log('server');\n", 'utf8');
  rmSync(join(fileRoot, WEB_SERVER_PATH));
  if (
    createSymbolicLinkOrSkip(
      t,
      realServer,
      join(fileRoot, WEB_SERVER_PATH),
      process.platform === 'win32' ? 'file' : undefined,
    )
  ) {
    assert.throws(
      () => withProduction(() => validateBuiltWebRuntime(fileRoot)),
      /Runtime artifact tree is unsafe or changed/u,
    );
  }
});

test('rejects directory reparse links without following them', (t) => {
  const reparseRoot = webFixture(t);
  const outside = temporaryRoot(t, 'crypto-lending-outside-runtime-');
  writeFileSync(join(outside, 'outside.js'), 'module.exports = {};\n', 'utf8');
  mkdirSync(join(reparseRoot, 'node_modules'), { recursive: true });
  if (
    createSymbolicLinkOrSkip(
      t,
      outside,
      join(reparseRoot, 'node_modules/linked-package'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  ) {
    assert.throws(
      () => withProduction(() => validateBuiltWebRuntime(reparseRoot)),
      /Runtime artifact tree is unsafe or changed/u,
    );
  }
});

test('rejects multiply linked runtime files', (t) => {
  const root = webFixture(t);
  const source = join(root, 'apps/web/shared.js');
  writeFileSync(source, 'module.exports = {};\n', 'utf8');
  linkSync(source, join(root, 'apps/web/duplicate.js'));
  assert.throws(
    () => withProduction(() => validateBuiltWebRuntime(root)),
    /Runtime artifact tree is unsafe or changed/u,
  );
});

test('rejects a runtime file that changes while its bytes are inspected', (t) => {
  const root = webFixture(t);
  const changingPath = join(root, 'apps/web/changing.js');
  writeFileSync(changingPath, 'module.exports = 1;\n', 'utf8');
  let changed = false;
  assert.throws(
    () =>
      withProduction(() =>
        validateBuiltWebRuntimeForTest(root, {
          afterFirstRead(relativePath) {
            if (relativePath !== 'apps/web/changing.js' || changed) return;
            changed = true;
            appendFileSync(changingPath, 'module.exports = 2;\n', 'utf8');
          },
        }),
      ),
    /Runtime artifact tree is unsafe or changed/u,
  );
  assert.equal(changed, true);
});

test('enforces per-file, aggregate, file-count, entry-count, and depth bounds', (t) => {
  const perFileRoot = webFixture(t);
  writeFileSync(join(perFileRoot, 'apps/web/large.js'), Buffer.alloc(129, 0x61));
  assert.throws(
    () =>
      withProduction(() =>
        validateBuiltWebRuntimeForTest(perFileRoot, {
          limits: { maximumFileBytes: 128 },
        }),
      ),
    /per-file byte limit/u,
  );

  const aggregateRoot = webFixture(t);
  const baselineBytes =
    Buffer.byteLength("console.log('server');\n") +
    Buffer.byteLength('{"name":"@crypto-lending/web","private":true,"version":"0.1.0"}\n');
  writeFileSync(join(aggregateRoot, 'apps/web/chunk.js'), Buffer.alloc(10, 0x61));
  assert.throws(
    () =>
      withProduction(() =>
        validateBuiltWebRuntimeForTest(aggregateRoot, {
          limits: { maximumAggregateBytes: baselineBytes + 9 },
        }),
      ),
    /aggregate byte limit/u,
  );

  const fileCountRoot = webFixture(t);
  writeFileSync(join(fileCountRoot, 'apps/web/extra.js'), '', 'utf8');
  assert.throws(
    () =>
      withProduction(() =>
        validateBuiltWebRuntimeForTest(fileCountRoot, {
          limits: { maximumFiles: 2 },
        }),
      ),
    /file count limit/u,
  );

  const entryCountRoot = webFixture(t);
  mkdirSync(join(entryCountRoot, 'empty'));
  assert.throws(
    () =>
      withProduction(() =>
        validateBuiltWebRuntimeForTest(entryCountRoot, {
          limits: { maximumEntries: 4 },
        }),
      ),
    /tree entry limit/u,
  );

  const depthRoot = webFixture(t);
  mkdirSync(join(depthRoot, 'apps/web/deep'));
  writeFileSync(join(depthRoot, 'apps/web/deep/chunk.js'), '', 'utf8');
  assert.throws(
    () =>
      withProduction(() =>
        validateBuiltWebRuntimeForTest(depthRoot, {
          limits: { maximumTraversalDepth: 3 },
        }),
      ),
    /traversal depth limit/u,
  );
});

test('sanitizes filesystem and CLI errors without reflecting hostile paths', (t) => {
  const hostilePath = join(temporaryRoot(t, 'crypto-lending-private-root-'), 'tenant-secret');
  assert.throws(
    () => withProduction(() => validateBuiltWebRuntime(hostilePath)),
    (error) => {
      assert.equal(error.message, 'Built runtime validation failed safely');
      assert.equal(error.message.includes(hostilePath), false);
      return true;
    },
  );
  const result = spawnSync(process.execPath, [VALIDATOR_PATH, 'web', hostilePath], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Built runtime validation failed safely\n');
  assert.equal(result.stderr.includes(hostilePath), false);
});
