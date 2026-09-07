#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RELEASE_MANIFEST_PATH = '.local-validation/release-candidate-manifest.json';
export const RELEASE_STAGE_PATH = '.local-validation/release-candidate-stage';
export const RELEASE_STAGE_MANIFEST_PATH = `${RELEASE_STAGE_PATH}/release-candidate-manifest.json`;
export const RELEASE_MANIFEST_DOMAIN = 'crypto-lending/release-candidate-manifest/v1\0';

const MANIFEST_TYPE = 'CRYPTO_LENDING_RELEASE_CANDIDATE_MANIFEST';
const REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const TREE_PATTERN = /^[0-9a-f]{40,64}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 50_000;
const MAX_DEPTH = 64;
const READ_BUFFER_BYTES = 64 * 1024;
const WINDOWS_RESERVED_SEGMENT = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const WINDOWS_FORBIDDEN_CHARACTERS = /[<>:"|?*]/u;
const verifiedReleaseManifests = new WeakMap();

export const RELEASE_COMPONENTS = Object.freeze([
  Object.freeze({
    name: 'api-runtime',
    path: 'apps/api/dist',
    kind: 'directory',
    requiredFiles: Object.freeze([
      'main.js',
      'blockchain-sync/application/balance-sync-consumer.cli.js',
      'infrastructure/database/migration.cli.js',
      'infrastructure/outbox/outbox-worker.cli.js',
      'infrastructure/outbox/outbox-worker-health.cli.js',
    ]),
  }),
  Object.freeze({
    name: 'web-standalone-runtime',
    path: 'apps/web/.next/standalone',
    kind: 'directory',
    requiredFiles: Object.freeze(['apps/web/server.js']),
  }),
  Object.freeze({
    name: 'web-static-assets',
    path: 'apps/web/.next/static',
    kind: 'directory',
    requiredFiles: Object.freeze([]),
  }),
  Object.freeze({
    name: 'api-openapi-contract',
    path: 'apps/api/openapi.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'dependency-lock',
    path: 'package-lock.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'root-package-manifest',
    path: 'package.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'api-package-manifest',
    path: 'apps/api/package.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'web-package-manifest',
    path: 'apps/web/package.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'api-production-image-sbom',
    path: '.local-validation/production-sbom/api-image.spdx.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'api-production-image-binding-record',
    path: '.local-validation/production-sbom/api-image.syft.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'api-production-image-archive-binding',
    path: '.local-validation/production-sbom/api-image.binding.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'web-production-image-sbom',
    path: '.local-validation/production-sbom/web-image.spdx.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'web-production-image-binding-record',
    path: '.local-validation/production-sbom/web-image.syft.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'web-production-image-archive-binding',
    path: '.local-validation/production-sbom/web-image.binding.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'api-container-build-definition',
    path: 'Dockerfile.api',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'web-container-build-definition',
    path: 'Dockerfile.web',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'container-build-context-policy',
    path: '.dockerignore',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'production-container-policy',
    path: 'infra/containers',
    kind: 'directory',
    requiredFiles: Object.freeze([
      'aws-rds-global-bundle.crt',
      'aws-rds-global-bundle.crt.sha256',
      'validate-built-runtime.mjs',
      'validate-oci-build-metadata.mjs',
      'validate-production-containers.mjs',
    ]),
  }),
  Object.freeze({
    name: 'application-cloudformation',
    path: 'infra/aws/application-baseline.yaml',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'application-observability-cloudformation',
    path: 'infra/aws/application-observability.yaml',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'workload-boundaries-cloudformation',
    path: 'infra/aws/application-workload-boundaries.yaml',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'balance-consumer-deployment-envelope-cloudformation',
    path: 'infra/aws/balance-consumer-deployment-envelope.yaml',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'production-infrastructure-contract-cloudformation',
    path: 'infra/aws/production-infrastructure-contract.yaml',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'production-deployment-target-validator',
    path: 'scripts/production-deployment-target.mjs',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'production-deployment-intent-validator',
    path: 'infra/aws/validate-production-deployment-intent.mjs',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'production-deployment-intent-strict-json-runtime',
    path: 'infra/shared/parse-strict-json.mjs',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'production-deployment-intent-secure-file-runtime',
    path: 'infra/shared/read-secure-local-file.mjs',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'production-deployment-intent-inert-example',
    path: 'infra/aws/production-deployment-intent.example.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'migration-task-cloudformation',
    path: 'infra/aws/database-migration-task.yaml',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'preflight-egress-decision',
    path: 'infra/egress/egress-policy.example.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'preflight-rpc-decision',
    path: 'docs/rpc-indexing/kan-62-provider-decision.json',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'preflight-rpc-decision-digest',
    path: 'docs/rpc-indexing/kan-62-provider-decision.sha256',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'active-scope-provider-research',
    path: 'docs/provider-research/active-scope-2026-09-04',
    kind: 'directory',
    requiredFiles: Object.freeze([
      'ethereum-solana-missing-provider-captures.json',
      'ethereum-solana-missing-provider-captures.sha256',
    ]),
  }),
  Object.freeze({
    name: 'preflight-platform-directory',
    path: 'apps/api/src/mainnet-platforms/domain/mainnet-platform-directory.ts',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
  Object.freeze({
    name: 'preflight-platform-network-policy',
    path: 'apps/api/src/blockchain/domain/mainnet-launch-network-policy.ts',
    kind: 'file',
    requiredFiles: Object.freeze(['.']),
  }),
]);

export class ReleaseManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseManifestError';
  }
}

export class ReleaseManifestInvalidError extends Error {
  constructor() {
    super('Release candidate manifest is invalid.');
    this.name = 'ReleaseManifestInvalidError';
  }
}

function fail(message) {
  throw new ReleaseManifestError(message);
}

function closeStableFileDescriptor(descriptor) {
  try {
    closeSync(descriptor);
  } catch {
    throw new ReleaseManifestInvalidError();
  }
}

/** Descriptor-close test seam; it cannot read or confer release authority. */
export function closeReleaseFileDescriptorForTest(descriptor) {
  closeStableFileDescriptor(descriptor);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  return isDeepStrictEqual(actual, wanted);
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0)
      fail('Manifest numbers must be nonnegative integers.');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value !== 'object') fail('Manifest contains an unsupported value.');

  return `{${Object.keys(value)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function digestText(domain, text) {
  return createHash('sha256').update(domain, 'utf8').update(text, 'utf8').digest('hex');
}

function safeManifestPath(value, allowDot = false) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false;
  if (allowDot && value === '.') return true;
  if (value.startsWith('/') || value.startsWith('\\') || value.includes('\\')) return false;
  if (
    value.normalize('NFC') !== value ||
    value.normalize('NFKC') !== value ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      Buffer.byteLength(segment, 'utf8') <= 255 &&
      !WINDOWS_FORBIDDEN_CHARACTERS.test(segment) &&
      !WINDOWS_RESERVED_SEGMENT.test(segment) &&
      !/[. ]$/u.test(segment),
  );
}

function portablePathKey(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function safeRuntimeValue(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._+-]{1,64}$/u.test(value);
}

function statIdentity(stat) {
  return [
    stat.dev,
    stat.ino,
    stat.mode,
    stat.nlink,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
    stat.birthtimeNs,
  ]
    .map(String)
    .join(':');
}

function sameFileObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function hasExpectedFileMode(stat, mode) {
  if (process.platform === 'win32') {
    return (mode & 0o222) !== 0 || (stat.mode & 0o222n) === 0n;
  }
  return (stat.mode & 0o777n) === BigInt(mode);
}

function normalizedPhysicalPath(path) {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function samePhysicalPath(left, right) {
  return normalizedPhysicalPath(left) === normalizedPhysicalPath(right);
}

function isContained(root, target) {
  const fromRoot = relative(root, target);
  return (
    fromRoot === '' ||
    (!isAbsolute(fromRoot) && !fromRoot.startsWith(`..${sep}`) && fromRoot !== '..')
  );
}

function assertContained(root, target) {
  if (!isContained(root, target)) fail('A release component escaped the workspace.');
}

function workspaceContext(workspaceRoot) {
  const lexicalRoot = resolve(workspaceRoot);
  let rootStat;
  try {
    rootStat = lstatSync(lexicalRoot, { bigint: true });
  } catch {
    fail('The release workspace is unavailable.');
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('The release workspace must be a physical directory.');
  }
  let physicalRoot;
  try {
    physicalRoot = realpathSync.native(lexicalRoot);
  } catch {
    fail('The release workspace could not be resolved safely.');
  }
  return Object.freeze({
    lexicalRoot,
    physicalRoot,
    rootIdentity: statIdentity(rootStat),
  });
}

function safeExistingPath(context, absolutePath, expectedKind) {
  const target = resolve(absolutePath);
  assertContained(context.lexicalRoot, target);
  const fromRoot = relative(context.lexicalRoot, target);
  if (fromRoot === '') fail('A release component cannot be the workspace root.');
  const segments = fromRoot.split(sep);
  const identities = [];
  let lexical = context.lexicalRoot;
  let expectedPhysical = context.physicalRoot;
  let finalStat;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    lexical = join(lexical, segment);
    expectedPhysical = join(expectedPhysical, segment);
    let stat;
    let physical;
    try {
      stat = lstatSync(lexical, { bigint: true });
      physical = realpathSync.native(lexical);
    } catch {
      fail('A required release component is missing.');
    }
    if (stat.isSymbolicLink() || !samePhysicalPath(physical, expectedPhysical)) {
      fail('Release component paths must not contain links or reparse points.');
    }
    assertContained(context.physicalRoot, physical);
    const final = index === segments.length - 1;
    if ((!final || expectedKind === 'directory') && !stat.isDirectory()) {
      fail('Release component directory topology is invalid.');
    }
    if (final && expectedKind === 'file' && (!stat.isFile() || stat.nlink !== 1n)) {
      fail('Release components must be single-link regular files.');
    }
    if (final) finalStat = stat;
    identities.push(Object.freeze({ identity: statIdentity(stat), lexical, physical }));
  }

  return Object.freeze({
    finalStat,
    identities: Object.freeze(identities),
  });
}

function pathSnapshotMatches(left, right) {
  return (
    left.identities.length === right.identities.length &&
    left.identities.every(
      (entry, index) =>
        entry.identity === right.identities[index]?.identity &&
        samePhysicalPath(entry.physical, right.identities[index]?.physical ?? ''),
    )
  );
}

function assertWorkspaceContextCurrent(context) {
  const current = workspaceContext(context.lexicalRoot);
  if (
    current.rootIdentity !== context.rootIdentity ||
    !samePhysicalPath(current.physicalRoot, context.physicalRoot)
  ) {
    fail('The release workspace changed during verification.');
  }
}

function assertSafeDirectoryOrWorkspaceRoot(context, absolutePath) {
  if (samePhysicalPath(resolve(absolutePath), context.lexicalRoot)) {
    assertWorkspaceContextCurrent(context);
    return;
  }
  safeExistingPath(context, absolutePath, 'directory');
}

function accountCandidateFiles(totals, fileCount, totalBytes) {
  if (totals.fileCount > MAX_FILES - fileCount) {
    fail('The release candidate exceeds the aggregate file limit.');
  }
  if (totals.totalBytes > MAX_TOTAL_BYTES - totalBytes) {
    fail('The release candidate exceeds the aggregate byte limit.');
  }
  totals.fileCount += fileCount;
  totals.totalBytes += totalBytes;
}

function consumeExactBoundedDescriptor(
  descriptor,
  expectedSize,
  consumeChunk,
  afterChunkForTest = undefined,
) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_FILE_BYTES) {
    fail('A release component file exceeds the size limit.');
  }
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let offset = 0;
  while (offset < expectedSize) {
    const count = readSync(
      descriptor,
      buffer,
      0,
      Math.min(buffer.length, expectedSize - offset),
      offset,
    );
    if (count <= 0) fail('A release component file ended unexpectedly.');
    consumeChunk(buffer.subarray(0, count), offset);
    offset += count;
    afterChunkForTest?.();
  }
  const overflow = Buffer.allocUnsafe(1);
  if (readSync(descriptor, overflow, 0, 1, expectedSize) !== 0) {
    fail('A release component file exceeded its inspected size.');
  }
  return offset;
}

function hashStableFile(context, absolutePath, candidateTotals, afterChunkForTest = undefined) {
  const beforePath = safeExistingPath(context, absolutePath, 'file');
  const before = beforePath.finalStat;
  if (before.size > BigInt(MAX_FILE_BYTES))
    fail('A release component file exceeds the size limit.');
  accountCandidateFiles(candidateTotals, 1, Number(before.size));

  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollow);
  } catch {
    fail('A release component file could not be opened safely.');
  }

  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || statIdentity(opened) !== statIdentity(before)) {
      fail('A release component changed while it was opened.');
    }

    const hash = createHash('sha256');
    const offset = consumeExactBoundedDescriptor(
      descriptor,
      Number(opened.size),
      (chunk) => hash.update(chunk),
      afterChunkForTest,
    );

    const after = fstatSync(descriptor, { bigint: true });
    const finalPath = safeExistingPath(context, absolutePath, 'file');
    const finalPathStat = finalPath.finalStat;
    if (
      !pathSnapshotMatches(beforePath, finalPath) ||
      statIdentity(after) !== statIdentity(opened) ||
      statIdentity(finalPathStat) !== statIdentity(opened) ||
      BigInt(offset) !== opened.size
    ) {
      fail('A release component changed while it was read.');
    }

    return Object.freeze({ size: offset, sha256: hash.digest('hex') });
  } finally {
    closeStableFileDescriptor(descriptor);
  }
}

/** Unbranded hostile-artifact test seam; it cannot confer release authority. */
export function fingerprintReleaseArtifactFileForTest(artifactPath, afterChunkForTest) {
  try {
    const absolutePath = resolve(artifactPath);
    return hashStableFile(
      workspaceContext(dirname(absolutePath)),
      absolutePath,
      { fileCount: 0, totalBytes: 0 },
      afterChunkForTest,
    );
  } catch {
    throw new ReleaseManifestInvalidError();
  }
}

function assertNoLinkedPathComponents(absolutePath) {
  const root = parse(absolutePath).root;
  const segments = absolutePath
    .slice(root.length)
    .split(/[\\/]+/u)
    .filter(Boolean);
  if (segments.length === 0) fail('Release manifest path is invalid.');
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let stat;
    let physical;
    try {
      stat = lstatSync(current, { bigint: true });
      physical = realpathSync.native(current);
    } catch {
      fail('Release manifest could not be read.');
    }
    const final = index === segments.length - 1;
    if (
      stat.isSymbolicLink() ||
      (!final && !stat.isDirectory()) ||
      !samePhysicalPath(physical, current)
    ) {
      fail('Release manifest path contains links or reparse points.');
    }
  }
}

function readDescriptorExactly(descriptor, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count === 0) fail('Release manifest ended unexpectedly.');
    offset += count;
  }
  const overflow = Buffer.allocUnsafe(1);
  if (readSync(descriptor, overflow, 0, 1, size) !== 0) {
    fail('Release manifest exceeded its inspected size.');
  }
  return bytes;
}

function readBoundedStableFile(absolutePath, maximumBytes, afterFirstReadForTest = undefined) {
  assertNoLinkedPathComponents(absolutePath);
  let before;
  try {
    before = lstatSync(absolutePath, { bigint: true });
  } catch {
    fail('Release manifest could not be read.');
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size <= 0n ||
    before.size > BigInt(maximumBytes)
  ) {
    fail('Release manifest must be a bounded regular file.');
  }

  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollow);
  } catch {
    fail('Release manifest could not be opened safely.');
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || statIdentity(opened) !== statIdentity(before)) {
      fail('Release manifest changed while it was opened.');
    }
    const first = readDescriptorExactly(descriptor, Number(opened.size));
    if (afterFirstReadForTest !== undefined) {
      afterFirstReadForTest();
    }
    const afterFirst = fstatSync(descriptor, { bigint: true });
    if (statIdentity(afterFirst) !== statIdentity(opened)) {
      fail('Release manifest changed while it was read.');
    }
    const second = readDescriptorExactly(descriptor, Number(opened.size));
    const afterSecond = fstatSync(descriptor, { bigint: true });
    let finalPathStat;
    try {
      assertNoLinkedPathComponents(absolutePath);
      finalPathStat = lstatSync(absolutePath, { bigint: true });
    } catch {
      fail('Release manifest changed while it was read.');
    }
    if (
      finalPathStat.isSymbolicLink() ||
      finalPathStat.nlink !== 1n ||
      statIdentity(afterSecond) !== statIdentity(opened) ||
      statIdentity(finalPathStat) !== statIdentity(opened) ||
      !first.equals(second)
    ) {
      fail('Release manifest changed while it was read.');
    }
    return first;
  } finally {
    closeStableFileDescriptor(descriptor);
  }
}

function collectDirectoryFiles(context, absoluteRoot, candidateTotals) {
  const files = [];
  const caseFolded = new Set();
  let totalBytes = 0;

  function visit(absoluteDirectory, relativeDirectory, depth) {
    if (depth > MAX_DEPTH) fail('A release component directory is too deep.');
    const beforePath = safeExistingPath(context, absoluteDirectory, 'directory');

    let names;
    try {
      names = readdirSync(absoluteDirectory).sort(compareUtf8);
    } catch {
      fail('A release component directory could not be read.');
    }
    for (const name of names) {
      const manifestPath = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      if (!safeManifestPath(manifestPath)) fail('A release component contains an unsafe path.');
      const absolutePath = join(absoluteDirectory, name);
      let stat;
      try {
        stat = lstatSync(absolutePath, { bigint: true });
      } catch {
        fail('A release component changed during inventory.');
      }
      if (stat.isSymbolicLink()) fail('Release components must not contain symbolic links.');
      if (stat.isDirectory()) {
        visit(absolutePath, manifestPath, depth + 1);
        continue;
      }
      if (!stat.isFile()) fail('Release components must not contain special files.');

      const folded = portablePathKey(manifestPath);
      if (caseFolded.has(folded)) fail('A release component contains a case-colliding path.');
      caseFolded.add(folded);
      if (files.length >= MAX_FILES) fail('The release candidate contains too many files.');

      const fingerprint = hashStableFile(context, absolutePath, candidateTotals);
      totalBytes += fingerprint.size;
      if (totalBytes > MAX_TOTAL_BYTES) fail('The release candidate exceeds the total size limit.');
      files.push(Object.freeze({ path: manifestPath, ...fingerprint }));
    }

    const afterPath = safeExistingPath(context, absoluteDirectory, 'directory');
    if (!pathSnapshotMatches(beforePath, afterPath)) {
      fail('A release component directory changed during inventory.');
    }
  }

  visit(absoluteRoot, '', 0);
  return Object.freeze(files.sort((left, right) => compareUtf8(left.path, right.path)));
}

function buildComponent(context, spec, candidateTotals) {
  const absolutePath = resolve(context.lexicalRoot, ...spec.path.split('/'));
  assertContained(context.lexicalRoot, absolutePath);
  let files;
  if (spec.kind === 'file') {
    files = Object.freeze([
      Object.freeze({ path: '.', ...hashStableFile(context, absolutePath, candidateTotals) }),
    ]);
  } else {
    files = collectDirectoryFiles(context, absolutePath, candidateTotals);
    if (files.length === 0) fail('A release component directory is empty.');
  }

  const filePaths = new Set(files.map((file) => file.path));
  if (!spec.requiredFiles.every((path) => filePaths.has(path))) {
    fail('A release component is missing a required runtime entry point.');
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const componentPayload = {
    kind: spec.kind,
    name: spec.name,
    path: spec.path,
    files,
  };
  return Object.freeze({
    ...componentPayload,
    fileCount: files.length,
    totalBytes,
    sha256: digestText(
      `crypto-lending/release-component/v1/${spec.name}\0`,
      canonicalJson(componentPayload),
    ),
  });
}

function validateSource(source) {
  if (
    !exactKeys(source, ['revision', 'tree']) ||
    !REVISION_PATTERN.test(source.revision) ||
    !TREE_PATTERN.test(source.tree)
  ) {
    fail('Manifest source identity is invalid.');
  }
}

function validateBuilder(builder) {
  if (
    !exactKeys(builder, ['architecture', 'nodeVersion', 'platform']) ||
    !safeRuntimeValue(builder.architecture) ||
    !/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(builder.nodeVersion) ||
    !safeRuntimeValue(builder.platform)
  ) {
    fail('Manifest builder identity is invalid.');
  }
}

function validateFile(file, kind) {
  return (
    exactKeys(file, ['path', 'sha256', 'size']) &&
    safeManifestPath(file.path, kind === 'file') &&
    (kind === 'directory' ? file.path !== '.' : file.path === '.') &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    file.size <= MAX_FILE_BYTES &&
    SHA256_PATTERN.test(file.sha256)
  );
}

function validateComponent(component, spec) {
  if (
    !exactKeys(component, ['fileCount', 'files', 'kind', 'name', 'path', 'sha256', 'totalBytes']) ||
    component.name !== spec.name ||
    component.path !== spec.path ||
    component.kind !== spec.kind ||
    !Array.isArray(component.files) ||
    component.files.length === 0 ||
    component.files.length > MAX_FILES ||
    component.fileCount !== component.files.length ||
    !Number.isSafeInteger(component.totalBytes) ||
    component.totalBytes < 0 ||
    component.totalBytes > MAX_TOTAL_BYTES ||
    !SHA256_PATTERN.test(component.sha256)
  ) {
    fail('Manifest component shape is invalid.');
  }

  let priorPath;
  const folded = new Set();
  let totalBytes = 0;
  for (const file of component.files) {
    if (!validateFile(file, component.kind)) fail('Manifest file entry is invalid.');
    if (priorPath !== undefined && compareUtf8(priorPath, file.path) >= 0) {
      fail('Manifest file entries are not strictly sorted.');
    }
    priorPath = file.path;
    const caseKey = portablePathKey(file.path);
    if (folded.has(caseKey)) fail('Manifest file entries collide by case.');
    folded.add(caseKey);
    totalBytes += file.size;
  }
  if (totalBytes !== component.totalBytes || totalBytes > MAX_TOTAL_BYTES) {
    fail('Manifest component byte counts do not match.');
  }
  const exactPaths = new Set(component.files.map((file) => file.path));
  if (!spec.requiredFiles.every((path) => exactPaths.has(path))) {
    fail('Manifest component is missing a required runtime entry point.');
  }

  const componentPayload = {
    kind: component.kind,
    name: component.name,
    path: component.path,
    files: component.files,
  };
  const expectedDigest = digestText(
    `crypto-lending/release-component/v1/${spec.name}\0`,
    canonicalJson(componentPayload),
  );
  if (component.sha256 !== expectedDigest) fail('Manifest component digest does not match.');
}

export function validateReleaseManifest(manifest) {
  if (
    !exactKeys(manifest, [
      'artifactType',
      'builder',
      'components',
      'payloadSha256',
      'schemaVersion',
      'source',
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.artifactType !== MANIFEST_TYPE ||
    !Array.isArray(manifest.components) ||
    manifest.components.length !== RELEASE_COMPONENTS.length ||
    !SHA256_PATTERN.test(manifest.payloadSha256)
  ) {
    fail('Release manifest shape is invalid.');
  }
  validateSource(manifest.source);
  validateBuilder(manifest.builder);
  const candidateTotals = { fileCount: 0, totalBytes: 0 };
  for (let index = 0; index < RELEASE_COMPONENTS.length; index += 1) {
    validateComponent(manifest.components[index], RELEASE_COMPONENTS[index]);
    accountCandidateFiles(
      candidateTotals,
      manifest.components[index].fileCount,
      manifest.components[index].totalBytes,
    );
  }

  const payload = {
    schemaVersion: manifest.schemaVersion,
    artifactType: manifest.artifactType,
    source: manifest.source,
    builder: manifest.builder,
    components: manifest.components,
  };
  const expectedDigest = digestText(RELEASE_MANIFEST_DOMAIN, canonicalJson(payload));
  if (manifest.payloadSha256 !== expectedDigest)
    fail('Release manifest payload digest does not match.');
  return manifest;
}

export function createReleaseManifest(workspaceRoot, source, builder = undefined) {
  const context = workspaceContext(workspaceRoot);
  validateSource(source);
  const resolvedBuilder = Object.freeze(
    builder ?? {
      architecture: process.arch,
      nodeVersion: process.version,
      platform: process.platform,
    },
  );
  validateBuilder(resolvedBuilder);
  const candidateTotals = { fileCount: 0, totalBytes: 0 };
  const components = Object.freeze(
    RELEASE_COMPONENTS.map((spec) => buildComponent(context, spec, candidateTotals)),
  );
  assertWorkspaceContextCurrent(context);
  const payload = Object.freeze({
    schemaVersion: 1,
    artifactType: MANIFEST_TYPE,
    source: Object.freeze({ revision: source.revision, tree: source.tree }),
    builder: resolvedBuilder,
    components,
  });
  return Object.freeze({
    ...payload,
    payloadSha256: digestText(RELEASE_MANIFEST_DOMAIN, canonicalJson(payload)),
  });
}

export function parseReleaseManifest(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
    fail('Release manifest exceeds the size limit.');
  }
  if (text.startsWith('\ufeff') || !text.endsWith('\n') || text.endsWith('\n\n')) {
    fail('Release manifest encoding is not canonical.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('Release manifest is not valid JSON.');
  }
  const validated = validateReleaseManifest(parsed);
  if (text !== `${canonicalJson(validated)}\n`) {
    fail('Release manifest JSON is not canonical.');
  }
  return validated;
}

export function verifyReleaseManifest(workspaceRoot, manifest) {
  const validated = validateReleaseManifest(manifest);
  const first = createReleaseManifest(workspaceRoot, validated.source, validated.builder);
  const second = createReleaseManifest(workspaceRoot, validated.source, validated.builder);
  if (!isDeepStrictEqual(first, validated) || !isDeepStrictEqual(second, validated))
    fail('Release candidate bytes do not match the manifest.');
  return validated;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function isVerifiedReleaseManifest(value) {
  return value !== null && typeof value === 'object' && verifiedReleaseManifests.has(value);
}

function trustedGitExecutable() {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe']
      : ['/usr/bin/git', '/usr/local/bin/git'];
  for (const candidate of candidates) {
    try {
      const stat = lstatSync(candidate, { bigint: true });
      if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n) return candidate;
    } catch {
      // Continue through the closed, platform-owned candidate list.
    }
  }
  fail('A trusted Git executable is unavailable.');
}

function gitEnvironment(gitExecutable) {
  const environment = Object.create(null);
  for (const name of ['COMSPEC', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'WINDIR']) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) environment[name] = value;
  }
  const systemRoot = environment.SystemRoot ?? environment.WINDIR ?? 'C:\\Windows';
  environment.PATH =
    process.platform === 'win32'
      ? [dirname(gitExecutable), join(systemRoot, 'System32'), systemRoot].join(delimiter)
      : '/usr/bin:/bin';
  environment.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_NO_LAZY_FETCH = '1';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.LC_ALL = 'C';
  return environment;
}

function runGit(context, gitDirectory, args) {
  const gitExecutable = trustedGitExecutable();
  const invocation = [
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.ignorestat=false',
    '-c',
    'core.hooksPath=',
    `--git-dir=${gitDirectory}`,
    `--work-tree=${context.lexicalRoot}`,
    ...args,
  ];
  const result = spawnSync(gitExecutable, invocation, {
    cwd: context.lexicalRoot,
    encoding: 'utf8',
    env: gitEnvironment(gitExecutable),
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) fail('Git source inspection failed.');
  return result.stdout.trim();
}

export function inspectCleanGitSource(workspaceRoot, expectedRevision) {
  if (!REVISION_PATTERN.test(expectedRevision)) fail('The expected source revision is invalid.');
  const context = workspaceContext(workspaceRoot);
  const gitPath = resolve(context.lexicalRoot, '.git');
  const gitBefore = safeExistingPath(context, gitPath, 'directory');
  const gitDirectory = gitBefore.identities.at(-1)?.physical;
  if (gitDirectory === undefined) fail('Git source inspection failed.');
  const topLevel = runGit(context, gitDirectory, ['rev-parse', '--show-toplevel']);
  let physicalTopLevel;
  try {
    physicalTopLevel = realpathSync.native(topLevel);
  } catch {
    fail('Git source inspection failed.');
  }
  if (!samePhysicalPath(physicalTopLevel, context.physicalRoot)) {
    fail('Git worktree does not match the release workspace.');
  }
  const revision = runGit(context, gitDirectory, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (revision !== expectedRevision)
    fail('The checked-out revision does not match the release revision.');
  const tree = runGit(context, gitDirectory, ['rev-parse', '--verify', 'HEAD^{tree}']);
  if (!TREE_PATTERN.test(tree)) fail('The checked-out source tree identity is invalid.');
  const indexEntries = runGit(context, gitDirectory, ['ls-files', '-v', '-z']);
  if (
    indexEntries
      .split('\0')
      .filter((entry) => entry.length > 0)
      .some((entry) => entry[0] !== 'H')
  ) {
    fail('The release source index contains hidden or sparse entries.');
  }
  const status = runGit(context, gitDirectory, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]);
  if (status !== '') fail('The release source tree is not clean.');
  const gitAfter = safeExistingPath(context, gitPath, 'directory');
  if (!pathSnapshotMatches(gitBefore, gitAfter)) fail('Git metadata changed during inspection.');
  assertWorkspaceContextCurrent(context);
  return Object.freeze({ revision, tree });
}

function readManifestFile(absolutePath, context = undefined, afterFirstReadForTest = undefined) {
  const beforePath =
    context !== undefined && isContained(context.lexicalRoot, absolutePath)
      ? safeExistingPath(context, absolutePath, 'file')
      : undefined;
  const bytes = readBoundedStableFile(absolutePath, MAX_MANIFEST_BYTES, afterFirstReadForTest);
  if (beforePath !== undefined) {
    const afterPath = safeExistingPath(context, absolutePath, 'file');
    if (!pathSnapshotMatches(beforePath, afterPath)) {
      fail('Release manifest changed while it was read.');
    }
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('Release manifest is not valid UTF-8.');
  }
  return parseReleaseManifest(text);
}

/** Unbranded hostile-file test seam; it can never confer release authority. */
export function readReleaseManifestFileForTest(manifestPath, afterFirstReadForTest) {
  try {
    return readManifestFile(resolve(manifestPath), undefined, afterFirstReadForTest);
  } catch {
    throw new ReleaseManifestInvalidError();
  }
}

export function loadAndVerifyReleaseManifest(workspaceRoot, manifestPath, expectedRevision) {
  try {
    const root = resolve(workspaceRoot);
    const context = workspaceContext(root);
    const sourceBefore = inspectCleanGitSource(root, expectedRevision);
    const manifest = readManifestFile(resolve(manifestPath), context);
    if (
      manifest.source.revision !== sourceBefore.revision ||
      manifest.source.tree !== sourceBefore.tree
    ) {
      fail('Release manifest source identity does not match the checked-out source.');
    }
    verifyReleaseManifest(root, manifest);
    const sourceAfter = inspectCleanGitSource(root, expectedRevision);
    if (!isDeepStrictEqual(sourceAfter, sourceBefore)) {
      fail('Release source identity changed during verification.');
    }
    const frozen = deepFreeze(manifest);
    verifiedReleaseManifests.set(
      frozen,
      Object.freeze({
        expectedRevision,
        physicalWorkspaceRoot: context.physicalRoot,
        source: sourceAfter,
      }),
    );
    return frozen;
  } catch {
    throw new ReleaseManifestInvalidError();
  }
}

export function revalidateVerifiedReleaseManifest(workspaceRoot, manifest, expectedRevision) {
  try {
    const brand =
      manifest !== null && typeof manifest === 'object'
        ? verifiedReleaseManifests.get(manifest)
        : undefined;
    if (brand === undefined || brand.expectedRevision !== expectedRevision) {
      fail('Release manifest brand is invalid.');
    }
    const root = resolve(workspaceRoot);
    const context = workspaceContext(root);
    if (!samePhysicalPath(context.physicalRoot, brand.physicalWorkspaceRoot)) {
      fail('Release manifest workspace binding is invalid.');
    }
    const sourceBefore = inspectCleanGitSource(root, expectedRevision);
    if (
      manifest.source.revision !== sourceBefore.revision ||
      manifest.source.tree !== sourceBefore.tree ||
      !isDeepStrictEqual(sourceBefore, brand.source)
    ) {
      fail('Release manifest source identity is invalid.');
    }
    verifyReleaseManifest(root, manifest);
    const sourceAfter = inspectCleanGitSource(root, expectedRevision);
    if (!isDeepStrictEqual(sourceAfter, sourceBefore)) {
      fail('Release source identity changed during revalidation.');
    }
    return manifest;
  } catch {
    throw new ReleaseManifestInvalidError();
  }
}

function ensurePhysicalDirectoryChain(root, relativePath, finalMustBeNew = false) {
  if (!safeManifestPath(relativePath)) fail('A release output path is invalid.');
  const segments = relativePath.split('/');
  let current = resolve(root);
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let created = false;
    try {
      mkdirSync(current, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        fail('A release output directory could not be created safely.');
      }
    }
    const context = workspaceContext(root);
    safeExistingPath(context, current, 'directory');
    if (finalMustBeNew && index === segments.length - 1 && !created) {
      fail('A release output directory already exists.');
    }
  }
  return current;
}

function writeExclusiveFile(root, relativePath, contents, mode = 0o600) {
  if (!safeManifestPath(relativePath)) fail('A release output path is invalid.');
  const absolutePath = resolve(root, ...relativePath.split('/'));
  const context = workspaceContext(root);
  assertContained(context.lexicalRoot, absolutePath);
  assertSafeDirectoryOrWorkspaceRoot(context, dirname(absolutePath));
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(
      absolutePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      mode,
    );
  } catch {
    fail('A release output file could not be created exclusively.');
  }
  let opened;
  try {
    opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.isSymbolicLink() || opened.nlink !== 1n) {
      fail('A release output file is not a single-link regular file.');
    }
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) fail('A release output file could not be written completely.');
      offset += count;
    }
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
    const afterWrite = fstatSync(descriptor, { bigint: true });
    if (
      afterWrite.nlink !== 1n ||
      afterWrite.size !== BigInt(bytes.length) ||
      !sameFileObject(afterWrite, opened) ||
      !hasExpectedFileMode(afterWrite, mode)
    ) {
      fail('A release output file changed while it was written.');
    }
    opened = afterWrite;
  } finally {
    closeStableFileDescriptor(descriptor);
  }
  const finalContext = workspaceContext(root);
  const finalPath = safeExistingPath(finalContext, absolutePath, 'file');
  if (statIdentity(finalPath.finalStat) !== statIdentity(opened)) {
    fail('A release output file changed after it was written.');
  }
  return absolutePath;
}

function writeManifest(root, manifest) {
  ensurePhysicalDirectoryChain(root, dirname(RELEASE_MANIFEST_PATH).replaceAll('\\', '/'));
  return writeExclusiveFile(root, RELEASE_MANIFEST_PATH, `${canonicalJson(manifest)}\n`);
}

function copyManifestFile(sourceRoot, stageRoot, component, file, afterChunkForTest = undefined) {
  const relativeFile =
    component.kind === 'file' ? component.path : `${component.path}/${file.path}`;
  const sourceContext = workspaceContext(sourceRoot);
  const sourcePath = resolve(sourceRoot, ...relativeFile.split('/'));
  const sourceBefore = safeExistingPath(sourceContext, sourcePath, 'file');
  const sourceNoFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const sourceDescriptor = openSync(sourcePath, fsConstants.O_RDONLY | sourceNoFollow);
  let destinationDescriptor;
  try {
    const openedSource = fstatSync(sourceDescriptor, { bigint: true });
    if (
      !openedSource.isFile() ||
      openedSource.nlink !== 1n ||
      statIdentity(openedSource) !== statIdentity(sourceBefore.finalStat)
    ) {
      fail('A release component changed before staging.');
    }
    const destinationDirectory = dirname(relativeFile).replaceAll('\\', '/');
    if (destinationDirectory !== '.') ensurePhysicalDirectoryChain(stageRoot, destinationDirectory);
    const destinationPath = resolve(stageRoot, ...relativeFile.split('/'));
    const stageContext = workspaceContext(stageRoot);
    assertSafeDirectoryOrWorkspaceRoot(stageContext, dirname(destinationPath));
    const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
    destinationDescriptor = openSync(
      destinationPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      0o400,
    );
    const openedDestination = fstatSync(destinationDescriptor, { bigint: true });
    if (!openedDestination.isFile() || openedDestination.nlink !== 1n) {
      fail('A staged release file is not a single-link regular file.');
    }
    const hash = createHash('sha256');
    const offset = consumeExactBoundedDescriptor(
      sourceDescriptor,
      file.size,
      (chunk, chunkOffset) => {
        hash.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          const writeCount = writeSync(
            destinationDescriptor,
            chunk,
            written,
            chunk.length - written,
            chunkOffset + written,
          );
          if (writeCount <= 0) fail('A staged release file could not be written completely.');
          written += writeCount;
        }
      },
      afterChunkForTest,
    );
    fchmodSync(destinationDescriptor, 0o400);
    fsyncSync(destinationDescriptor);
    const finalSource = fstatSync(sourceDescriptor, { bigint: true });
    const finalDestination = fstatSync(destinationDescriptor, { bigint: true });
    const sourceAfter = safeExistingPath(sourceContext, sourcePath, 'file');
    if (
      !pathSnapshotMatches(sourceBefore, sourceAfter) ||
      statIdentity(openedSource) !== statIdentity(finalSource) ||
      finalDestination.nlink !== 1n ||
      !sameFileObject(finalDestination, openedDestination) ||
      !hasExpectedFileMode(finalDestination, 0o400) ||
      finalDestination.size !== BigInt(offset) ||
      offset !== file.size ||
      hash.digest('hex') !== file.sha256
    ) {
      fail('A release component changed while it was staged.');
    }
  } finally {
    try {
      if (destinationDescriptor !== undefined) closeStableFileDescriptor(destinationDescriptor);
    } finally {
      closeStableFileDescriptor(sourceDescriptor);
    }
  }
  const destinationPath = resolve(stageRoot, ...relativeFile.split('/'));
  const finalStageContext = workspaceContext(stageRoot);
  const destination = safeExistingPath(finalStageContext, destinationPath, 'file');
  if (destination.finalStat.size !== BigInt(file.size)) {
    fail('A staged release file size does not match its manifest.');
  }
}

/** Unbranded hostile-stage test seam; it cannot confer release authority. */
export function copyReleaseArtifactFileForTest(
  sourceRoot,
  stageRoot,
  component,
  file,
  afterChunkForTest,
) {
  try {
    const spec = RELEASE_COMPONENTS.find(
      (candidate) =>
        candidate.kind === component?.kind &&
        candidate.name === component?.name &&
        candidate.path === component?.path,
    );
    if (spec === undefined) fail('Manifest component shape is invalid.');
    validateComponent(component, spec);
    if (!component.files.some((candidate) => isDeepStrictEqual(candidate, file))) {
      fail('Manifest file entry is invalid.');
    }
    copyManifestFile(resolve(sourceRoot), resolve(stageRoot), component, file, afterChunkForTest);
  } catch {
    throw new ReleaseManifestInvalidError();
  }
}

function buildStageLayout(manifest) {
  const directories = new Set(['.']);
  const files = new Set(['release-candidate-manifest.json']);
  const expectedChildren = new Map([['.', new Set(['release-candidate-manifest.json'])]]);

  function childrenFor(directory) {
    let children = expectedChildren.get(directory);
    if (children === undefined) {
      children = new Set();
      expectedChildren.set(directory, children);
    }
    return children;
  }

  function addFile(relativePath) {
    if (!safeManifestPath(relativePath)) fail('A staged release path is invalid.');
    const segments = relativePath.split('/');
    let directory = '.';
    for (const segment of segments.slice(0, -1)) {
      childrenFor(directory).add(segment);
      directory = directory === '.' ? segment : `${directory}/${segment}`;
      directories.add(directory);
      childrenFor(directory);
    }
    childrenFor(directory).add(segments.at(-1));
    files.add(relativePath);
  }

  for (const component of manifest.components) {
    for (const file of component.files) {
      addFile(component.kind === 'file' ? component.path : `${component.path}/${file.path}`);
    }
  }

  return Object.freeze({
    directories: Object.freeze(
      [...directories].sort((left, right) => {
        const leftDepth = left === '.' ? 0 : left.split('/').length;
        const rightDepth = right === '.' ? 0 : right.split('/').length;
        const depth = rightDepth - leftDepth;
        return depth === 0 ? compareUtf8(left, right) : depth;
      }),
    ),
    expectedChildren,
    files: Object.freeze([...files].sort(compareUtf8)),
  });
}

function assertExactStageTopology(stageRoot, layout) {
  const context = workspaceContext(stageRoot);
  for (const directory of layout.directories) {
    const absoluteDirectory =
      directory === '.'
        ? context.lexicalRoot
        : resolve(context.lexicalRoot, ...directory.split('/'));
    const before =
      directory === '.' ? undefined : safeExistingPath(context, absoluteDirectory, 'directory');
    let names;
    try {
      names = readdirSync(absoluteDirectory).sort(compareUtf8);
    } catch {
      fail('A staged release directory could not be inspected safely.');
    }
    const expected = [...(layout.expectedChildren.get(directory) ?? [])].sort(compareUtf8);
    if (!isDeepStrictEqual(names, expected)) fail('The staged release contains an unknown path.');
    if (directory === '.') {
      assertWorkspaceContextCurrent(context);
    } else {
      const after = safeExistingPath(context, absoluteDirectory, 'directory');
      if (!pathSnapshotMatches(before, after)) {
        fail('A staged release directory changed during inspection.');
      }
    }
  }
}

function assertStageFilesReadOnly(stageRoot, layout) {
  const context = workspaceContext(stageRoot);
  for (const file of layout.files) {
    const absolutePath = resolve(context.lexicalRoot, ...file.split('/'));
    const path = safeExistingPath(context, absolutePath, 'file');
    if (!hasExpectedFileMode(path.finalStat, 0o400)) {
      fail('A staged release file is not read-only.');
    }
  }
  assertWorkspaceContextCurrent(context);
}

function sealStageDirectories(stageRoot, layout) {
  if (process.platform === 'win32') return;
  if (typeof fsConstants.O_DIRECTORY !== 'number' || typeof fsConstants.O_NOFOLLOW !== 'number') {
    fail('Descriptor-bound release directory sealing is unavailable.');
  }

  const context = workspaceContext(stageRoot);
  for (const directory of layout.directories) {
    const absoluteDirectory =
      directory === '.'
        ? context.lexicalRoot
        : resolve(context.lexicalRoot, ...directory.split('/'));
    const beforeIdentity =
      directory === '.'
        ? context.rootIdentity
        : safeExistingPath(context, absoluteDirectory, 'directory').finalStat;
    let descriptor;
    try {
      descriptor = openSync(
        absoluteDirectory,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
    } catch {
      fail('A staged release directory could not be opened safely.');
    }
    try {
      const opened = fstatSync(descriptor, { bigint: true });
      const expectedIdentity =
        typeof beforeIdentity === 'string' ? beforeIdentity : statIdentity(beforeIdentity);
      if (!opened.isDirectory() || statIdentity(opened) !== expectedIdentity) {
        fail('A staged release directory changed while it was opened.');
      }
      fchmodSync(descriptor, 0o500);
      const sealed = fstatSync(descriptor, { bigint: true });
      if (
        !sealed.isDirectory() ||
        !sameFileObject(sealed, opened) ||
        !hasExpectedFileMode(sealed, 0o500)
      ) {
        fail('A staged release directory could not be sealed safely.');
      }
      if (directory === '.') {
        const after = workspaceContext(stageRoot);
        if (
          !samePhysicalPath(after.physicalRoot, context.physicalRoot) ||
          after.rootIdentity !== statIdentity(sealed)
        ) {
          fail('The staged release root changed while it was sealed.');
        }
      } else {
        const after = safeExistingPath(context, absoluteDirectory, 'directory');
        if (statIdentity(after.finalStat) !== statIdentity(sealed)) {
          fail('A staged release directory changed while it was sealed.');
        }
      }
    } finally {
      closeStableFileDescriptor(descriptor);
    }
  }
}

export function sealReleaseCandidateStage(stageRoot, manifest) {
  const validated = validateReleaseManifest(manifest);
  const layout = buildStageLayout(validated);
  assertExactStageTopology(stageRoot, layout);
  assertStageFilesReadOnly(stageRoot, layout);
  sealStageDirectories(stageRoot, layout);
  verifyReleaseManifest(stageRoot, validated);
  assertExactStageTopology(stageRoot, layout);
  assertStageFilesReadOnly(stageRoot, layout);
  return validated;
}

function stageVerifiedReleaseCandidate(root, manifest, expectedRevision) {
  const brand = verifiedReleaseManifests.get(manifest);
  const context = workspaceContext(root);
  if (
    brand === undefined ||
    brand.expectedRevision !== expectedRevision ||
    !samePhysicalPath(context.physicalRoot, brand.physicalWorkspaceRoot)
  ) {
    fail('Release manifest brand is invalid.');
  }
  ensurePhysicalDirectoryChain(root, RELEASE_STAGE_PATH, true);
  const stageRoot = resolve(root, ...RELEASE_STAGE_PATH.split('/'));
  for (const component of manifest.components) {
    for (const file of component.files) copyManifestFile(root, stageRoot, component, file);
  }
  writeExclusiveFile(
    stageRoot,
    'release-candidate-manifest.json',
    `${canonicalJson(manifest)}\n`,
    0o400,
  );
  const stagedManifestPath = resolve(stageRoot, 'release-candidate-manifest.json');
  const stagedManifest = readManifestFile(stagedManifestPath, workspaceContext(stageRoot));
  if (!isDeepStrictEqual(stagedManifest, manifest)) {
    fail('The staged release manifest does not match the verified candidate.');
  }
  revalidateVerifiedReleaseManifest(root, manifest, expectedRevision);
  sealReleaseCandidateStage(stageRoot, manifest);
  if (
    !isDeepStrictEqual(readManifestFile(stagedManifestPath, workspaceContext(stageRoot)), manifest)
  ) {
    fail('The staged release manifest changed while the stage was sealed.');
  }
  return Object.freeze({ manifestPath: RELEASE_STAGE_MANIFEST_PATH, stageRoot });
}

function parseArguments(argv) {
  const [command, revisionFlag, revision, ...rest] = argv;
  if (
    (command !== 'create' && command !== 'verify' && command !== 'stage') ||
    revisionFlag !== '--source-revision' ||
    rest.length !== 0 ||
    revision === undefined
  ) {
    fail('Usage: release-candidate-manifest.mjs <create|verify|stage> --source-revision <40-hex>.');
  }
  return { command, revision };
}

export function runCli(argv = process.argv.slice(2), workspaceRoot = REPOSITORY_ROOT) {
  const { command, revision } = parseArguments(argv);
  const root = resolve(workspaceRoot);
  const manifestPath = resolve(root, ...RELEASE_MANIFEST_PATH.split('/'));
  if (command === 'create') {
    const sourceBefore = inspectCleanGitSource(root, revision);
    const manifest = createReleaseManifest(root, sourceBefore);
    const sourceAfter = inspectCleanGitSource(root, revision);
    if (!isDeepStrictEqual(sourceAfter, sourceBefore)) {
      fail('Release source identity changed during manifest creation.');
    }
    writeManifest(root, manifest);
    loadAndVerifyReleaseManifest(root, manifestPath, revision);
    process.stdout.write(
      `Release candidate manifest created: ${RELEASE_MANIFEST_PATH} (${manifest.payloadSha256})\n`,
    );
    return;
  }
  const manifest = loadAndVerifyReleaseManifest(root, manifestPath, revision);
  if (command === 'stage') {
    const staged = stageVerifiedReleaseCandidate(root, manifest, revision);
    process.stdout.write(
      `Release candidate staged: ${staged.manifestPath} (${manifest.payloadSha256})\n`,
    );
    return;
  }
  process.stdout.write(`Release candidate manifest verified: ${manifest.payloadSha256}\n`);
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    const message =
      error instanceof ReleaseManifestError ? error.message : 'Unexpected local failure.';
    process.stderr.write(`Release candidate manifest failed: ${message}\n`);
    process.exitCode = 1;
  }
}
