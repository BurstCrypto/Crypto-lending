import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
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
const WEB_MANIFEST_PATH = 'apps/web/package.json';
const WEB_SERVER_PATH = 'apps/web/server.js';
const EXPECTED_WEB_PACKAGE_NAME = '@crypto-lending/web';
const SEMVER_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export const MAX_RUNTIME_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_RUNTIME_AGGREGATE_BYTES = 64 * 1024 * 1024;
export const MAX_RUNTIME_FILES = 4_096;
export const MAX_RUNTIME_ENTRIES = 8_192;
export const MAX_RUNTIME_TRAVERSAL_DEPTH = 64;

const PRODUCTION_LIMITS = Object.freeze({
  maximumAggregateBytes: MAX_RUNTIME_AGGREGATE_BYTES,
  maximumEntries: MAX_RUNTIME_ENTRIES,
  maximumFileBytes: MAX_RUNTIME_FILE_BYTES,
  maximumFiles: MAX_RUNTIME_FILES,
  maximumTraversalDepth: MAX_RUNTIME_TRAVERSAL_DEPTH,
});

const ERRORS = Object.freeze({
  apiActivation: 'API balance-consumer activation gate is invalid',
  apiMode: 'API runtime validation requires NODE_ENV=production',
  fileCount: 'Runtime artifact file count limit exceeded',
  fileSize: 'Runtime artifact file exceeds the per-file byte limit',
  generic: 'Built runtime validation failed safely',
  manifest: 'Web standalone manifest is invalid or non-canonical',
  totalSize: 'Runtime artifact aggregate byte limit exceeded',
  traversalDepth: 'Runtime artifact traversal depth limit exceeded',
  treeEntries: 'Runtime artifact tree entry limit exceeded',
  unsafeTree: 'Runtime artifact tree is unsafe or changed during validation',
  webArtifacts: 'Web standalone runtime is missing required artifacts',
  webMode: 'Web runtime validation requires NODE_ENV=production',
});

class BuiltRuntimeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuiltRuntimeValidationError';
  }
}

function invalid(message = ERRORS.unsafeTree) {
  throw new BuiltRuntimeValidationError(message);
}

function withSanitizedFailure(callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof BuiltRuntimeValidationError) throw error;
    throw new BuiltRuntimeValidationError(ERRORS.generic);
  }
}

function hasUnsafeColon(value) {
  if (!value.includes(':')) return false;
  return !(
    process.platform === 'win32' &&
    /^[A-Za-z]:[\\/]/u.test(value) &&
    !value.slice(2).includes(':')
  );
}

function comparablePath(value) {
  let path = normalize(resolve(value));
  if (path.startsWith('\\\\?\\UNC\\')) path = `\\\\${path.slice(8)}`;
  else if (path.startsWith('\\\\?\\')) path = path.slice(4);
  path = path.replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function sameStableFile(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameStableDirectory(left, right) {
  return (
    left.isDirectory() &&
    right.isDirectory() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function assertSafeInputPath(input) {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.length > 4_096 ||
    input.includes('\u0000') ||
    hasUnsafeColon(input) ||
    /^(?:\\\\|\/\/)/u.test(input) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(input)
  ) {
    invalid();
  }
}

function assertContained(root, candidate) {
  const relation = relative(root, candidate);
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) invalid();
}

function assertCanonicalUnlinkedPath(absolutePath) {
  const volumeRoot = parse(absolutePath).root;
  const childPath = relative(volumeRoot, absolutePath);
  if (volumeRoot.length === 0 || childPath === '' || isAbsolute(childPath)) invalid();
  let current = volumeRoot;
  let finalStatus;
  for (const component of childPath.split(/[\\/]+/u)) {
    if (component.length === 0) invalid();
    current = join(current, component);
    const status = lstatSync(current, { bigint: true });
    if (
      status.isSymbolicLink() ||
      comparablePath(realpathSync.native(current)) !== comparablePath(current)
    ) {
      invalid();
    }
    finalStatus = status;
  }
  return finalStatus;
}

function containedRoot(input) {
  assertSafeInputPath(input);
  const root = resolve(input);
  const status = assertCanonicalUnlinkedPath(root);
  if (!status?.isDirectory()) invalid();
  return root;
}

function readDescriptorExactly(descriptor, size) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count <= 0) invalid();
    offset += count;
  }
  const overflow = Buffer.allocUnsafe(1);
  if (readSync(descriptor, overflow, 0, 1, size) !== 0) invalid();
  return bytes;
}

function readStableRuntimeFile(root, absolutePath, maximumBytes, relativePath, afterFirstRead) {
  let descriptor;
  try {
    assertContained(root, absolutePath);
    const before = assertCanonicalUnlinkedPath(absolutePath);
    if (
      !before?.isFile() ||
      before.nlink !== 1n ||
      before.size < 0n ||
      before.size > BigInt(maximumBytes)
    ) {
      invalid(before?.size > BigInt(maximumBytes) ? ERRORS.fileSize : ERRORS.unsafeTree);
    }
    const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(before, opened)) invalid();
    const size = Number(opened.size);
    const first = readDescriptorExactly(descriptor, size);
    afterFirstRead?.(relativePath);
    const afterFirst = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(opened, afterFirst)) invalid();
    const second = readDescriptorExactly(descriptor, size);
    const afterSecond = fstatSync(descriptor, { bigint: true });
    const final = assertCanonicalUnlinkedPath(absolutePath);
    if (
      !sameStableFile(opened, afterSecond) ||
      !sameStableFile(afterSecond, final) ||
      !first.equals(second)
    ) {
      invalid();
    }
    return first;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validatedLimits(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) invalid();
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(PRODUCTION_LIMITS, key)) invalid();
  }
  const limits = { ...PRODUCTION_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > PRODUCTION_LIMITS[key]) {
      invalid();
    }
  }
  return Object.freeze(limits);
}

function normalizedRelativePath(root, absolutePath) {
  const value = relative(root, absolutePath).replaceAll('\\', '/');
  if (value.length === 0 || value.startsWith('../') || value === '..') invalid();
  return value;
}

function scanRuntimeTree(rootInput, options = {}) {
  const root = containedRoot(rootInput);
  const limits = validatedLimits(options.limits);
  const rootBefore = assertCanonicalUnlinkedPath(root);
  const state = {
    aggregateBytes: 0,
    capturedFiles: new Map(),
    directories: new Set(),
    entries: 0,
    files: new Set(),
  };

  function scanDirectory(current, depth) {
    if (depth > limits.maximumTraversalDepth) invalid(ERRORS.traversalDepth);
    const before = assertCanonicalUnlinkedPath(current);
    if (!before?.isDirectory()) invalid();
    let directory;
    try {
      directory = opendirSync(current);
      for (;;) {
        const entry = directory.readSync();
        if (entry === null) break;
        state.entries += 1;
        if (state.entries > limits.maximumEntries) invalid(ERRORS.treeEntries);
        if (
          entry.name.length === 0 ||
          entry.name === '.' ||
          entry.name === '..' ||
          entry.name.includes('\u0000') ||
          /[\\/]/u.test(entry.name) ||
          entry.isSymbolicLink()
        ) {
          invalid();
        }
        const unresolved = join(current, entry.name);
        assertContained(root, unresolved);
        const status = assertCanonicalUnlinkedPath(unresolved);
        const relativePath = normalizedRelativePath(root, unresolved);
        const childDepth = depth + 1;
        if (childDepth > limits.maximumTraversalDepth) invalid(ERRORS.traversalDepth);
        if (status?.isDirectory()) {
          state.directories.add(relativePath);
          options.onDirectory?.(relativePath);
          scanDirectory(unresolved, childDepth);
          continue;
        }
        if (!status?.isFile() || status.nlink !== 1n) invalid();
        state.files.add(relativePath);
        if (state.files.size > limits.maximumFiles) invalid(ERRORS.fileCount);
        if (status.size > BigInt(limits.maximumFileBytes)) invalid(ERRORS.fileSize);
        const bytes = readStableRuntimeFile(
          root,
          unresolved,
          limits.maximumFileBytes,
          relativePath,
          options.afterFirstRead,
        );
        state.aggregateBytes += bytes.byteLength;
        if (state.aggregateBytes > limits.maximumAggregateBytes) invalid(ERRORS.totalSize);
        if (options.capturePaths?.has(relativePath)) {
          state.capturedFiles.set(relativePath, bytes);
        }
        options.onFile?.(relativePath, bytes);
      }
    } finally {
      if (directory !== undefined) directory.closeSync();
    }
    const after = assertCanonicalUnlinkedPath(current);
    if (!sameStableDirectory(before, after)) invalid();
  }

  scanDirectory(root, 0);
  const rootAfter = assertCanonicalUnlinkedPath(root);
  if (!sameStableDirectory(rootBefore, rootAfter)) invalid();
  return Object.freeze({
    aggregateBytes: state.aggregateBytes,
    capturedFiles: state.capturedFiles,
    directories: state.directories,
    files: state.files,
  });
}

function assertPackageDoesNotResolve(requireFromRuntime, packageName) {
  try {
    requireFromRuntime.resolve(packageName);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'MODULE_NOT_FOUND') return;
    throw error;
  }
  invalid('Forbidden production dependency resolves: ' + packageName);
}

function validateActivation(activation) {
  if (
    activation === null ||
    typeof activation !== 'object' ||
    Object.keys(activation).sort().join(',') !== 'BALANCE_CONSUMER_SOURCE_ACTIVATION'
  ) {
    invalid(ERRORS.apiActivation);
  }
  const gate = activation.BALANCE_CONSUMER_SOURCE_ACTIVATION;
  if (
    gate === null ||
    typeof gate !== 'object' ||
    Object.keys(gate).join(',') !== 'enabled' ||
    gate.enabled !== false ||
    !Object.isFrozen(gate)
  ) {
    invalid(ERRORS.apiActivation);
  }
}

function validateBuiltApiRuntimeInternal(apiRootInput, options = {}) {
  if (process.env.NODE_ENV !== 'production') invalid(ERRORS.apiMode);
  const apiRoot = containedRoot(apiRootInput);
  const distRoot = join(apiRoot, 'dist');
  const snapshot = scanRuntimeTree(distRoot, {
    afterFirstRead: options.afterFirstRead,
    limits: options.limits,
  });
  const requiredPaths = [
    'main.js',
    'app.module.js',
    'blockchain-sync/application/balance-sync-consumer.activation.js',
    'blockchain-sync/application/balance-sync-consumer.cli-mode.js',
    'blockchain-sync/application/balance-sync-consumer.cli.js',
    'blockchain-sync/application/balance-sync-consumer.runtime.js',
    'infrastructure/outbox/outbox-worker.cli.js',
    'infrastructure/outbox/outbox-worker-health.cli.js',
    'infrastructure/database/migration.cli.js',
    'infrastructure/redis/redis-session-revocation.js',
    'infrastructure/redis/redis-session-revocation.cli.js',
  ];
  for (const relativePath of requiredPaths) {
    if (!snapshot.files.has(relativePath)) {
      invalid('Missing API runtime artifact: dist/' + relativePath);
    }
  }
  for (const forbiddenPath of [
    'local-demo',
    'public-testnet',
    'evm-public-testnet',
    'local-development-app.module.js',
  ]) {
    if (snapshot.files.has(forbiddenPath) || snapshot.directories.has(forbiddenPath)) {
      invalid('Development-only API artifact reached production: dist/' + forbiddenPath);
    }
  }

  const appModule = join(distRoot, 'app.module.js');
  const balanceConsumerActivation = join(
    distRoot,
    'blockchain-sync/application/balance-sync-consumer.activation.js',
  );
  const runtimeRequire = createRequire(appModule);
  const activation = runtimeRequire(balanceConsumerActivation);
  validateActivation(activation);
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
      invalid('Production AppModule loaded forbidden package: ' + marker);
    }
  }

  return Object.freeze({
    checkedEntrypoints: requiredPaths.length,
    forbiddenPackages: FORBIDDEN_RUNTIME_PACKAGES,
    scannedBytes: snapshot.aggregateBytes,
    scannedFiles: snapshot.files.size,
    valid: true,
  });
}

function isForbiddenPackageDirectory(relativePath, packageName) {
  return (
    relativePath === `node_modules/${packageName}` ||
    relativePath.endsWith(`/node_modules/${packageName}`)
  );
}

function scanWebFile(relativePath, bytes) {
  if (
    relativePath === WEB_MANIFEST_PATH ||
    /\.(?:node|wasm|so(?:\.[0-9]+)*)$/u.test(relativePath) ||
    bytes.includes(0)
  ) {
    return;
  }
  const text = bytes.toString('utf8').replaceAll('\\', '/');
  for (const marker of FORBIDDEN_WEB_MARKERS) {
    if (text.includes(marker)) invalid('Forbidden web standalone marker: ' + marker);
  }
}

function validateCanonicalWebManifest(bytes) {
  try {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.byteLength === 0 ||
      (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    ) {
      invalid(ERRORS.manifest);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const manifest = JSON.parse(text);
    if (
      manifest === null ||
      typeof manifest !== 'object' ||
      Array.isArray(manifest) ||
      Object.getPrototypeOf(manifest) !== Object.prototype ||
      Object.keys(manifest).sort().join(',') !== 'name,private,version' ||
      manifest.name !== EXPECTED_WEB_PACKAGE_NAME ||
      manifest.private !== true ||
      typeof manifest.version !== 'string' ||
      manifest.version.length > 128 ||
      !SEMVER_PATTERN.test(manifest.version)
    ) {
      invalid(ERRORS.manifest);
    }
    const canonical = Buffer.from(
      JSON.stringify({
        name: EXPECTED_WEB_PACKAGE_NAME,
        private: true,
        version: manifest.version,
      }) + '\n',
      'utf8',
    );
    if (!bytes.equals(canonical)) invalid(ERRORS.manifest);
  } catch (error) {
    if (error instanceof BuiltRuntimeValidationError) throw error;
    invalid(ERRORS.manifest);
  }
}

function validateBuiltWebRuntimeInternal(standaloneRootInput, options = {}) {
  if (process.env.NODE_ENV !== 'production') invalid(ERRORS.webMode);
  const snapshot = scanRuntimeTree(standaloneRootInput, {
    afterFirstRead: options.afterFirstRead,
    capturePaths: new Set([WEB_MANIFEST_PATH]),
    limits: options.limits,
    onDirectory(relativePath) {
      for (const packageName of FORBIDDEN_RUNTIME_PACKAGES) {
        if (isForbiddenPackageDirectory(relativePath, packageName)) {
          invalid('Forbidden web standalone package directory: ' + packageName);
        }
      }
    },
    onFile: scanWebFile,
  });
  if (!snapshot.files.has(WEB_SERVER_PATH) || !snapshot.files.has(WEB_MANIFEST_PATH)) {
    invalid(ERRORS.webArtifacts);
  }
  validateCanonicalWebManifest(snapshot.capturedFiles.get(WEB_MANIFEST_PATH));
  return Object.freeze({
    forbiddenPackages: FORBIDDEN_RUNTIME_PACKAGES,
    scannedBytes: snapshot.aggregateBytes,
    scannedFiles: snapshot.files.size,
    valid: true,
  });
}

export function validateBuiltApiRuntime(apiRootInput) {
  return withSanitizedFailure(() => validateBuiltApiRuntimeInternal(apiRootInput));
}

export function validateBuiltWebRuntime(standaloneRootInput) {
  return withSanitizedFailure(() => validateBuiltWebRuntimeInternal(standaloneRootInput));
}

/** Test-only fault and bound seam; production callers always use the fixed limits above. */
export function validateBuiltWebRuntimeForTest(standaloneRootInput, options) {
  return withSanitizedFailure(() => validateBuiltWebRuntimeInternal(standaloneRootInput, options));
}

function main() {
  const [mode, root, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || !root || (mode !== 'api' && mode !== 'web')) {
    throw new BuiltRuntimeValidationError(
      'Usage: node validate-built-runtime.mjs <api|web> <runtime-root>',
    );
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
      (error instanceof BuiltRuntimeValidationError ? error.message : ERRORS.generic) + '\n',
    );
    process.exitCode = 1;
  }
}
