import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_RUNTIME_PACKAGES = Object.freeze(['@solana/web3.js', 'jayson', 'stream-json']);
const FORBIDDEN_WEB_MARKERS = Object.freeze([
  '@solana/web3.js',
  'node_modules/jayson/',
  'node_modules/stream-json/',
  'require("jayson")',
  "require('jayson')",
  'require("stream-json',
  "require('stream-json",
]);
const MAX_SCANNED_FILE_BYTES = 16 * 1024 * 1024;

function containedRoot(input) {
  const root = realpathSync(resolve(input));
  if (!statSync(root).isDirectory())
    throw new Error('Runtime validation target must be a directory');
  return root;
}

function assertContained(root, candidate) {
  const path = realpathSync(candidate);
  const relation = relative(root, path);
  if (relation === '..' || relation.startsWith('..' + sep)) {
    throw new Error('Runtime artifact escapes its root');
  }
  return path;
}

function assertPackageDoesNotResolve(requireFromRuntime, packageName) {
  try {
    requireFromRuntime.resolve(packageName);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'MODULE_NOT_FOUND') return;
    throw error;
  }
  throw new Error('Forbidden production dependency resolves: ' + packageName);
}

export function validateBuiltApiRuntime(apiRootInput) {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('API runtime validation requires NODE_ENV=production');
  }
  const apiRoot = containedRoot(apiRootInput);
  const appModule = join(apiRoot, 'dist/app.module.js');
  const balanceConsumerActivation = join(
    apiRoot,
    'dist/blockchain-sync/application/balance-sync-consumer.activation.js',
  );
  for (const relativePath of [
    'dist/main.js',
    'dist/app.module.js',
    'dist/blockchain-sync/application/balance-sync-consumer.activation.js',
    'dist/blockchain-sync/application/balance-sync-consumer.cli-mode.js',
    'dist/blockchain-sync/application/balance-sync-consumer.cli.js',
    'dist/blockchain-sync/application/balance-sync-consumer.runtime.js',
    'dist/infrastructure/outbox/outbox-worker.cli.js',
    'dist/infrastructure/outbox/outbox-worker-health.cli.js',
    'dist/infrastructure/database/migration.cli.js',
  ]) {
    if (!existsSync(join(apiRoot, relativePath))) {
      throw new Error('Missing API runtime artifact: ' + relativePath);
    }
  }
  for (const forbiddenPath of [
    'dist/local-demo',
    'dist/public-testnet',
    'dist/evm-public-testnet',
    'dist/local-development-app.module.js',
  ]) {
    if (existsSync(join(apiRoot, forbiddenPath))) {
      throw new Error('Development-only API artifact reached production: ' + forbiddenPath);
    }
  }

  const runtimeRequire = createRequire(appModule);
  const activation = runtimeRequire(balanceConsumerActivation);
  assert.deepEqual(Object.keys(activation).sort(), ['BALANCE_CONSUMER_SOURCE_ACTIVATION']);
  assert.deepEqual(activation.BALANCE_CONSUMER_SOURCE_ACTIVATION, { enabled: false });
  assert.equal(Object.isFrozen(activation.BALANCE_CONSUMER_SOURCE_ACTIVATION), true);
  for (const packageName of FORBIDDEN_RUNTIME_PACKAGES) {
    assertPackageDoesNotResolve(runtimeRequire, packageName);
  }
  runtimeRequire(appModule);
  const loadedPaths = Object.keys(runtimeRequire.cache);
  for (const marker of FORBIDDEN_RUNTIME_PACKAGES) {
    if (
      loadedPaths.some((path) =>
        path.replaceAll('\\', '/').includes('/node_modules/' + marker + '/'),
      )
    ) {
      throw new Error('Production AppModule loaded forbidden package: ' + marker);
    }
  }

  return Object.freeze({
    checkedEntrypoints: 9,
    forbiddenPackages: FORBIDDEN_RUNTIME_PACKAGES,
    valid: true,
  });
}

function scanStandaloneTree(root, current = root) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const unresolved = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      assertContained(root, unresolved);
      continue;
    }
    if (entry.isDirectory()) {
      const normalized = unresolved.replaceAll('\\', '/');
      for (const packageName of FORBIDDEN_RUNTIME_PACKAGES) {
        if (normalized.endsWith('/node_modules/' + packageName)) {
          throw new Error('Forbidden web standalone package directory: ' + packageName);
        }
      }
      scanStandaloneTree(root, unresolved);
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.(?:node|wasm|so(?:\.[0-9]+)*)$/u.test(entry.name)) continue;
    const stats = statSync(unresolved);
    if (stats.size > MAX_SCANNED_FILE_BYTES) {
      throw new Error('Standalone file exceeds bounded scanner size: ' + basename(unresolved));
    }
    const bytes = readFileSync(unresolved);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8').replaceAll('\\', '/');
    for (const marker of FORBIDDEN_WEB_MARKERS) {
      if (text.includes(marker)) throw new Error('Forbidden web standalone marker: ' + marker);
    }
  }
}

export function validateBuiltWebRuntime(standaloneRootInput) {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Web runtime validation requires NODE_ENV=production');
  }
  const root = containedRoot(standaloneRootInput);
  const server = join(root, 'apps/web/server.js');
  const manifest = join(root, 'apps/web/package.json');
  if (!existsSync(server) || !existsSync(manifest)) {
    throw new Error('Web standalone runtime is missing server.js or package.json');
  }
  const runtimeManifest = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.deepEqual(Object.keys(runtimeManifest).sort(), ['name', 'private', 'version']);
  scanStandaloneTree(root);
  return Object.freeze({
    forbiddenPackages: FORBIDDEN_RUNTIME_PACKAGES,
    valid: true,
  });
}

function main() {
  const [mode, root, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || !root || (mode !== 'api' && mode !== 'web')) {
    throw new Error('Usage: node validate-built-runtime.mjs <api|web> <runtime-root>');
  }
  const report = mode === 'api' ? validateBuiltApiRuntime(root) : validateBuiltWebRuntime(root);
  process.stdout.write(JSON.stringify(report) + '\n');
}

const direct =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : 'runtime validation failed') + '\n',
    );
    process.exitCode = 1;
  }
}
