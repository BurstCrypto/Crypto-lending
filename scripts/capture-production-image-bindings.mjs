#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadProductionSbomExpectations,
  parseJsonBytes,
  validateProductionImageBindingBytes,
} from './validate-production-sboms.mjs';

export const MAX_DOCKER_SAVE_ARCHIVE_BYTES = 16 * 1024 * 1024 * 1024;
export const MAX_DOCKER_SAVE_ENTRIES = 8192;
const MAX_RETAINED_BYTES = 64 * 1024 * 1024;
const MAX_RETAINED_ENTRIES = 512;
const MAX_JSON_BLOB_BYTES = 16 * 1024 * 1024;
const IMAGE_BINDING_SCHEMA = 'crypto-lending.production-image-archive-binding.v1';
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const OCI_INDEX_MEDIA_TYPE = 'application/vnd.oci.image.index.v1+json';
const MANIFEST_MEDIA_TYPES = new Set([
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
]);
const CONFIG_MEDIA_TYPES = new Set([
  'application/vnd.docker.container.image.v1+json',
  'application/vnd.oci.image.config.v1+json',
]);

export class ProductionImageBindingCaptureError extends Error {
  constructor(code) {
    super('Production image archive binding capture failed.');
    this.name = 'ProductionImageBindingCaptureError';
    this.code = code;
  }
}

function fail(code) {
  throw new ProductionImageBindingCaptureError(code);
}

function record(value, code) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail(code);
  }
  return value;
}

function exactKeys(value, allowed, required, code) {
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    return fail(code);
  }
}

function array(value, maximum, code) {
  if (!Array.isArray(value) || value.length > maximum) return fail(code);
  return value;
}

function string(value, maximum, code) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes('\u0000')
  ) {
    return fail(code);
  }
  return value;
}

function integer(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) return fail(code);
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
  };
  return normalize(left) === normalize(right);
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map(String)
    .join(':');
}

function directoryIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode].map(String).join(':');
}

function parseTarOctal(bytes, code) {
  const text = bytes.toString('ascii').replaceAll('\u0000', '').trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/u.test(text)) return fail(code);
  const value = Number.parseInt(text, 8);
  return integer(value, MAX_DOCKER_SAVE_ARCHIVE_BYTES, code);
}

function parseTarPath(bytes, prefixBytes, type, code) {
  const decode = (value) => {
    const end = value.indexOf(0);
    const slice = value.subarray(0, end === -1 ? value.length : end);
    if (slice.some((byte) => byte < 0x20 || byte > 0x7e)) return fail(code);
    return slice.toString('ascii');
  };
  const name = decode(bytes);
  const prefix = decode(prefixBytes);
  const joined = prefix === '' ? name : `${prefix}/${name}`;
  const normalized = type === '5' ? joined.replace(/\/$/u, '') : joined;
  if (
    normalized.length === 0 ||
    normalized.length > 512 ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return fail(code);
  }
  return normalized;
}

function readExactly(descriptor, length, position, code) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(descriptor, bytes, offset, length - offset, position + offset);
    if (count === 0) return fail(code);
    offset += count;
  }
  return bytes;
}

function shouldRetain(pathname, size) {
  if (['index.json', 'manifest.json', 'oci-layout'].includes(pathname)) return true;
  if (/^[0-9a-f]{64}\.json$/u.test(pathname)) return size <= MAX_JSON_BLOB_BYTES;
  return /^blobs\/sha256\/[0-9a-f]{64}$/u.test(pathname) && size <= MAX_JSON_BLOB_BYTES;
}

export function readDockerSaveArchive(archivePath) {
  const resolved = path.resolve(archivePath);
  let initial;
  let real;
  try {
    initial = lstatSync(resolved, { bigint: true });
    real = realpathSync.native(resolved);
  } catch {
    return fail('ARCHIVE_UNAVAILABLE');
  }
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    initial.nlink !== 1n ||
    initial.size <= 0n ||
    initial.size > BigInt(MAX_DOCKER_SAVE_ARCHIVE_BYTES) ||
    !samePath(resolved, real)
  ) {
    return fail('ARCHIVE_UNSAFE');
  }

  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(resolved, fsConstants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor, { bigint: true });
    if (statIdentity(opened) !== statIdentity(initial)) return fail('ARCHIVE_UNSAFE');
    const archiveSize = Number(opened.size);
    const entries = new Map();
    const seenPaths = new Set();
    let entryCount = 0;
    let retainedBytes = 0;
    let position = 0;
    let zeroBlocks = 0;

    while (position < archiveSize) {
      if (archiveSize - position < 512) return fail('ARCHIVE_TRUNCATED');
      const header = readExactly(descriptor, 512, position, 'ARCHIVE_TRUNCATED');
      position += 512;
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks >= 2) {
          while (position < archiveSize) {
            const remaining = Math.min(512, archiveSize - position);
            if (
              !readExactly(descriptor, remaining, position, 'ARCHIVE_TRUNCATED').every(
                (byte) => byte === 0,
              )
            ) {
              return fail('ARCHIVE_TRAILING_DATA');
            }
            position += remaining;
          }
          break;
        }
        continue;
      }
      if (zeroBlocks !== 0) return fail('ARCHIVE_TRAILING_DATA');
      entryCount += 1;
      if (entryCount > MAX_DOCKER_SAVE_ENTRIES) return fail('ARCHIVE_ENTRY_LIMIT');

      const storedChecksum = parseTarOctal(header.subarray(148, 156), 'ARCHIVE_HEADER_INVALID');
      const checksumHeader = Buffer.from(header);
      checksumHeader.fill(0x20, 148, 156);
      const computedChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
      if (storedChecksum !== computedChecksum) return fail('ARCHIVE_CHECKSUM_INVALID');
      const magic = header.subarray(257, 263).toString('ascii');
      if (magic !== 'ustar\u0000' && magic !== 'ustar ') return fail('ARCHIVE_HEADER_INVALID');
      const typeByte = header[156];
      const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
      if (type !== '0' && type !== '5') return fail('ARCHIVE_ENTRY_TYPE_INVALID');
      const pathname = parseTarPath(
        header.subarray(0, 100),
        header.subarray(345, 500),
        type,
        'ARCHIVE_PATH_INVALID',
      );
      if (seenPaths.has(pathname)) return fail('ARCHIVE_PATH_DUPLICATE');
      seenPaths.add(pathname);
      const size = parseTarOctal(header.subarray(124, 136), 'ARCHIVE_HEADER_INVALID');
      if (type === '5' && size !== 0) return fail('ARCHIVE_HEADER_INVALID');
      if (size > archiveSize - position) return fail('ARCHIVE_TRUNCATED');

      if (type === '0' && shouldRetain(pathname, size)) {
        if (
          size > MAX_JSON_BLOB_BYTES ||
          entries.size >= MAX_RETAINED_ENTRIES ||
          retainedBytes + size > MAX_RETAINED_BYTES
        ) {
          return fail('ARCHIVE_RETAINED_LIMIT');
        }
        const bytes = readExactly(descriptor, size, position, 'ARCHIVE_TRUNCATED');
        entries.set(pathname, bytes);
        retainedBytes += size;
        const blobMatch = /^blobs\/sha256\/([0-9a-f]{64})$/u.exec(pathname);
        if (blobMatch !== null && sha256(bytes) !== `sha256:${blobMatch[1]}`) {
          return fail('ARCHIVE_BLOB_DIGEST_INVALID');
        }
      }
      const padded = Math.ceil(size / 512) * 512;
      if (padded > archiveSize - position) return fail('ARCHIVE_TRUNCATED');
      position += padded;
    }
    if (zeroBlocks < 2 || position !== archiveSize) return fail('ARCHIVE_TRUNCATED');
    const after = fstatSync(descriptor, { bigint: true });
    const final = lstatSync(resolved, { bigint: true });
    if (
      statIdentity(after) !== statIdentity(opened) ||
      statIdentity(final) !== statIdentity(opened)
    ) {
      return fail('ARCHIVE_UNSAFE');
    }
    return entries;
  } catch (error) {
    if (error instanceof ProductionImageBindingCaptureError) throw error;
    return fail('ARCHIVE_UNSAFE');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseEntry(entries, pathname, code) {
  const bytes = entries.get(pathname);
  if (!Buffer.isBuffer(bytes)) return fail(code);
  return parseJsonBytes(bytes, code);
}

function descriptor(value, mediaTypes, platformRequired, code, maximumSize = MAX_JSON_BLOB_BYTES) {
  const item = record(value, code);
  exactKeys(
    item,
    new Set(['annotations', 'digest', 'mediaType', 'platform', 'size']),
    ['digest', 'mediaType', 'size', ...(platformRequired ? ['platform'] : [])],
    code,
  );
  if (
    !SHA256.test(item.digest) ||
    !mediaTypes.has(item.mediaType) ||
    integer(item.size, maximumSize, code) === 0
  ) {
    return fail(code);
  }
  if (item.annotations !== undefined) {
    for (const [name, value] of Object.entries(record(item.annotations, code))) {
      string(name, 256, code);
      string(value, 4096, code);
      if (name === 'vnd.docker.reference.type' || /attestation/iu.test(value)) {
        return fail('ARCHIVE_ATTESTATION_INVALID');
      }
    }
  }
  let platform;
  if (item.platform !== undefined) {
    platform = record(item.platform, code);
    exactKeys(
      platform,
      new Set(['architecture', 'os', 'os.features', 'os.version', 'variant']),
      ['architecture', 'os'],
      code,
    );
    string(platform.architecture, 64, code);
    string(platform.os, 64, code);
  }
  return { ...item, platform };
}

function blob(entries, pathname, mediaType, expectedSize, code) {
  const bytes = entries.get(pathname);
  if (!Buffer.isBuffer(bytes)) return fail(code);
  if (expectedSize !== undefined && bytes.length !== expectedSize) return fail(code);
  const digest = sha256(bytes);
  const expectedDigest = /^blobs\/sha256\/([0-9a-f]{64})$/u.exec(pathname);
  if (expectedDigest !== null && digest !== `sha256:${expectedDigest[1]}`) return fail(code);
  return Object.freeze({
    bytes: bytes.toString('base64'),
    digest,
    mediaType,
    size: bytes.length,
  });
}

function configDetails(configBytes, code) {
  const config = record(parseJsonBytes(configBytes, code), code);
  const rootfs = record(config.rootfs, code);
  const diffIds = array(rootfs.diff_ids, 1024, code);
  if (
    config.architecture !== 'amd64' ||
    config.os !== 'linux' ||
    rootfs.type !== 'layers' ||
    diffIds.length === 0 ||
    diffIds.some((digest) => !SHA256.test(digest)) ||
    new Set(diffIds).size !== diffIds.length
  ) {
    return fail('ARCHIVE_PLATFORM_INVALID');
  }
  return { diffIds };
}

function manifestDetails(entries, manifestBlob, code) {
  const manifest = record(parseJsonBytes(Buffer.from(manifestBlob.bytes, 'base64'), code), code);
  if (
    manifest.schemaVersion !== 2 ||
    manifest.mediaType !== manifestBlob.mediaType ||
    !MANIFEST_MEDIA_TYPES.has(manifest.mediaType)
  ) {
    return fail(code);
  }
  const configDescriptor = descriptor(manifest.config, CONFIG_MEDIA_TYPES, false, code);
  const configPath = `blobs/sha256/${configDescriptor.digest.slice('sha256:'.length)}`;
  const configBlob = blob(
    entries,
    configPath,
    configDescriptor.mediaType,
    configDescriptor.size,
    'ARCHIVE_CONFIG_UNAVAILABLE',
  );
  if (configBlob.digest !== configDescriptor.digest) return fail('ARCHIVE_CONFIG_DIGEST_INVALID');
  const seenLayers = new Set();
  const layers = array(manifest.layers, 1024, code).map((value) => {
    const layer = descriptor(
      value,
      new Set([
        'application/vnd.docker.image.rootfs.diff.tar.gzip',
        'application/vnd.oci.image.layer.v1.tar',
        'application/vnd.oci.image.layer.v1.tar+gzip',
        'application/vnd.oci.image.layer.v1.tar+zstd',
      ]),
      false,
      code,
      MAX_DOCKER_SAVE_ARCHIVE_BYTES,
    );
    if (seenLayers.has(layer.digest)) return fail('ARCHIVE_DESCRIPTOR_DUPLICATE');
    seenLayers.add(layer.digest);
    return layer.digest;
  });
  const config = configDetails(Buffer.from(configBlob.bytes, 'base64'), 'ARCHIVE_CONFIG_INVALID');
  if (layers.length !== config.diffIds.length) return fail('ARCHIVE_LAYER_CARDINALITY_INVALID');
  return { configBlob, layers };
}

function validateOciLayout(entries) {
  const layout = record(
    parseEntry(entries, 'oci-layout', 'ARCHIVE_OCI_LAYOUT_INVALID'),
    'ARCHIVE_OCI_LAYOUT_INVALID',
  );
  exactKeys(
    layout,
    new Set(['imageLayoutVersion']),
    ['imageLayoutVersion'],
    'ARCHIVE_OCI_LAYOUT_INVALID',
  );
  if (layout.imageLayoutVersion !== '1.0.0') return fail('ARCHIVE_OCI_LAYOUT_INVALID');
  parseEntry(entries, 'index.json', 'ARCHIVE_OCI_INDEX_INVALID');
}

function validateClassicManifest(entries, imageReference, configBlob, layers) {
  const document = parseEntry(entries, 'manifest.json', 'ARCHIVE_DOCKER_MANIFEST_INVALID');
  const manifests = array(document, 64, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
  const matching = [];
  for (const value of manifests) {
    const candidate = record(value, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
    exactKeys(
      candidate,
      new Set(['Config', 'Layers', 'RepoTags']),
      ['Config', 'Layers', 'RepoTags'],
      'ARCHIVE_DOCKER_MANIFEST_INVALID',
    );
    string(candidate.Config, 256, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
    array(candidate.Layers, 1024, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
    const tags = array(candidate.RepoTags, 8, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
    for (const tag of tags) string(tag, 512, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
    if (tags.includes(imageReference)) matching.push(candidate);
  }
  if (matching.length !== 1) return fail('ARCHIVE_TAG_BINDING_INVALID');
  const manifest = matching[0];
  if (manifest.RepoTags.length !== 1) return fail('ARCHIVE_TAG_BINDING_INVALID');
  const configPath = string(manifest.Config, 256, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
  const configBytes = entries.get(configPath);
  if (!Buffer.isBuffer(configBytes) || sha256(configBytes) !== configBlob.digest) {
    return fail('ARCHIVE_DOCKER_CONFIG_BINDING_INVALID');
  }
  const layerPaths = array(manifest.Layers, 1024, 'ARCHIVE_DOCKER_MANIFEST_INVALID');
  if (layerPaths.length !== layers.length || new Set(layerPaths).size !== layerPaths.length) {
    return fail('ARCHIVE_DOCKER_LAYER_BINDING_INVALID');
  }
  for (const layerPath of layerPaths) {
    if (
      typeof layerPath !== 'string' ||
      layerPath.length === 0 ||
      layerPath.length > 512 ||
      layerPath.startsWith('/') ||
      layerPath.includes('\\') ||
      layerPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      return fail('ARCHIVE_DOCKER_LAYER_BINDING_INVALID');
    }
  }
  if (layers.length > 0 && layers.every((digest) => SHA256.test(digest))) {
    for (let index = 0; index < layers.length; index += 1) {
      const expectedPath = `blobs/sha256/${layers[index].slice('sha256:'.length)}`;
      if (layerPaths[index] !== expectedPath) return fail('ARCHIVE_DOCKER_LAYER_BINDING_INVALID');
    }
  }
}

export function deriveProductionImageBinding({
  entries,
  workspaceKind,
  imageReference,
  expectedImageId,
  inspectBeforeImageId,
  inspectAfterImageId,
}) {
  if (!(entries instanceof Map) || (workspaceKind !== 'api' && workspaceKind !== 'web')) {
    return fail('CAPTURE_ARGUMENT_INVALID');
  }
  if (
    !SHA256.test(expectedImageId) ||
    inspectBeforeImageId !== expectedImageId ||
    inspectAfterImageId !== expectedImageId
  ) {
    return fail('IMAGE_TAG_DRIFT');
  }
  const imageName = `crypto-lending-${workspaceKind}`;
  if (imageReference !== `${imageName}:ci`) return fail('CAPTURE_ARGUMENT_INVALID');
  const digest = expectedImageId.slice('sha256:'.length);
  const rootPath = `blobs/sha256/${digest}`;
  const rootBytes = entries.get(rootPath);
  const indexBytes = entries.get('index.json');
  const classicConfigPath = `${digest}.json`;
  const classicConfigBytes = entries.get(classicConfigPath);
  let chainType;
  let archiveFormat;
  let indexBlob = null;
  let manifestBlob = null;
  let configBlob;
  let layers = [];

  if (Buffer.isBuffer(rootBytes)) {
    const root = record(parseJsonBytes(rootBytes, 'ARCHIVE_ROOT_INVALID'), 'ARCHIVE_ROOT_INVALID');
    if (root.mediaType === OCI_INDEX_MEDIA_TYPE && Array.isArray(root.manifests)) {
      chainType = 'index-manifest-config';
      archiveFormat = 'oci';
      indexBlob = blob(entries, rootPath, OCI_INDEX_MEDIA_TYPE, undefined, 'ARCHIVE_ROOT_INVALID');
      const seenDigests = new Set();
      const seenPlatforms = new Set();
      const selected = [];
      for (const value of array(root.manifests, 128, 'ARCHIVE_INDEX_INVALID')) {
        const item = descriptor(value, MANIFEST_MEDIA_TYPES, true, 'ARCHIVE_INDEX_INVALID');
        const platformKey = `${item.platform.os}/${item.platform.architecture}`;
        if (seenDigests.has(item.digest) || seenPlatforms.has(platformKey)) {
          return fail('ARCHIVE_DESCRIPTOR_DUPLICATE');
        }
        seenDigests.add(item.digest);
        seenPlatforms.add(platformKey);
        if (platformKey === 'linux/amd64') selected.push(item);
      }
      if (selected.length !== 1) return fail('ARCHIVE_PLATFORM_SELECTION_INVALID');
      const selectedDescriptor = selected[0];
      const selectedPath = `blobs/sha256/${selectedDescriptor.digest.slice('sha256:'.length)}`;
      manifestBlob = blob(
        entries,
        selectedPath,
        selectedDescriptor.mediaType,
        selectedDescriptor.size,
        'ARCHIVE_MANIFEST_UNAVAILABLE',
      );
      if (manifestBlob.digest !== selectedDescriptor.digest)
        return fail('ARCHIVE_MANIFEST_INVALID');
      ({ configBlob, layers } = manifestDetails(entries, manifestBlob, 'ARCHIVE_MANIFEST_INVALID'));
    } else if (MANIFEST_MEDIA_TYPES.has(root.mediaType) && root.schemaVersion === 2) {
      chainType = 'manifest-config';
      archiveFormat = 'oci';
      manifestBlob = blob(entries, rootPath, root.mediaType, undefined, 'ARCHIVE_MANIFEST_INVALID');
      ({ configBlob, layers } = manifestDetails(entries, manifestBlob, 'ARCHIVE_MANIFEST_INVALID'));
    } else if (root.architecture === 'amd64' && root.os === 'linux') {
      chainType = 'config';
      archiveFormat = 'docker';
      configBlob = blob(
        entries,
        rootPath,
        'application/vnd.docker.container.image.v1+json',
        undefined,
        'ARCHIVE_CONFIG_INVALID',
      );
      configDetails(rootBytes, 'ARCHIVE_CONFIG_INVALID');
    } else {
      return fail('ARCHIVE_ROOT_INVALID');
    }
  } else if (Buffer.isBuffer(indexBytes) && sha256(indexBytes) === expectedImageId) {
    entries.set(rootPath, indexBytes);
    try {
      return deriveProductionImageBinding({
        entries,
        workspaceKind,
        imageReference,
        expectedImageId,
        inspectBeforeImageId,
        inspectAfterImageId,
      });
    } finally {
      entries.delete(rootPath);
    }
  } else if (
    Buffer.isBuffer(classicConfigBytes) &&
    sha256(classicConfigBytes) === expectedImageId
  ) {
    chainType = 'config';
    archiveFormat = 'docker';
    configBlob = blob(
      entries,
      classicConfigPath,
      'application/vnd.docker.container.image.v1+json',
      undefined,
      'ARCHIVE_CONFIG_INVALID',
    );
    const config = configDetails(classicConfigBytes, 'ARCHIVE_CONFIG_INVALID');
    layers = Array(config.diffIds.length).fill('');
  } else {
    return fail('ARCHIVE_ROOT_UNAVAILABLE');
  }

  if (archiveFormat === 'oci') validateOciLayout(entries);
  validateClassicManifest(entries, imageReference, configBlob, layers);
  const evidence = {
    schemaVersion: IMAGE_BINDING_SCHEMA,
    workspace: workspaceKind,
    imageReference,
    capturedImageId: expectedImageId,
    inspectBeforeImageId,
    inspectAfterImageId,
    archiveFormat,
    chainType,
    platform: { architecture: 'amd64', os: 'linux' },
    index: indexBlob,
    manifest: manifestBlob,
    config: configBlob,
  };
  return evidence;
}

function inspectImageId(dockerExecutable, imageReference) {
  let output;
  try {
    output = execFileSync(
      dockerExecutable,
      ['image', 'inspect', '--format', '{{.Id}}', imageReference],
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        windowsHide: true,
      },
    ).trim();
  } catch {
    return fail('DOCKER_INSPECT_FAILED');
  }
  if (!SHA256.test(output)) return fail('DOCKER_INSPECT_INVALID');
  return output;
}

function saveImage(dockerExecutable, imageReference, archivePath) {
  try {
    execFileSync(dockerExecutable, ['image', 'save', '--output', archivePath, imageReference], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10 * 60_000,
      windowsHide: true,
    });
  } catch {
    return fail('DOCKER_SAVE_FAILED');
  }
}

export function writeProductionImageBindingEvidence(
  outputPath,
  evidence,
  { repoRoot, workspaceKind, beforeOpen } = {},
) {
  if (
    typeof repoRoot !== 'string' ||
    (workspaceKind !== 'api' && workspaceKind !== 'web') ||
    typeof outputPath !== 'string'
  ) {
    return fail('OUTPUT_PATH_INVALID');
  }
  const resolved = path.resolve(outputPath);
  const expected = path.resolve(
    repoRoot,
    '.local-validation',
    'production-sbom',
    `${workspaceKind}-image.binding.json`,
  );
  if (!samePath(resolved, expected)) return fail('OUTPUT_PATH_INVALID');
  const parent = path.dirname(resolved);
  let parentStat;
  let parentReal;
  try {
    parentStat = lstatSync(parent, { bigint: true });
    parentReal = realpathSync.native(parent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || !samePath(parent, parentReal)) {
      return fail('OUTPUT_PATH_UNSAFE');
    }
  } catch {
    return fail('OUTPUT_PATH_UNSAFE');
  }
  beforeOpen?.();
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(
      resolved,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      0o600,
    );
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    const opened = fstatSync(descriptor, { bigint: true });
    const finalFile = lstatSync(resolved, { bigint: true });
    const finalParent = lstatSync(parent, { bigint: true });
    const finalParentReal = realpathSync.native(parent);
    const finalFileReal = realpathSync.native(resolved);
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      statIdentity(opened) !== statIdentity(finalFile) ||
      directoryIdentity(parentStat) !== directoryIdentity(finalParent) ||
      !samePath(parentReal, finalParentReal) ||
      !samePath(resolved, finalFileReal)
    ) {
      return fail('OUTPUT_PATH_RACE');
    }
  } catch (error) {
    if (error instanceof ProductionImageBindingCaptureError) throw error;
    return fail('OUTPUT_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function captureProductionImageBinding({
  workspaceKind,
  imageReference,
  expectedImageId,
  outputPath,
  repoRoot,
  dockerExecutable = 'docker',
  inspect = inspectImageId,
  save = saveImage,
}) {
  if (typeof outputPath !== 'string' || outputPath.length === 0 || typeof repoRoot !== 'string') {
    return fail('CAPTURE_ARGUMENT_INVALID');
  }
  const temporaryDirectory = mkdtempSync(
    path.join(realpathSync.native(tmpdir()), 'crypto-lending-image-binding-'),
  );
  const archivePath = path.join(temporaryDirectory, 'image.tar');
  try {
    const before = inspect(dockerExecutable, imageReference);
    if (before !== expectedImageId) return fail('IMAGE_TAG_DRIFT');
    save(dockerExecutable, imageReference, archivePath);
    const after = inspect(dockerExecutable, imageReference);
    if (after !== expectedImageId) return fail('IMAGE_TAG_DRIFT');
    const entries = readDockerSaveArchive(archivePath);
    const evidence = deriveProductionImageBinding({
      entries,
      workspaceKind,
      imageReference,
      expectedImageId,
      inspectBeforeImageId: before,
      inspectAfterImageId: after,
    });
    const expectations = loadProductionSbomExpectations(repoRoot);
    validateProductionImageBindingBytes(
      Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8'),
      workspaceKind,
      expectations,
      expectedImageId,
    );
    writeProductionImageBindingEvidence(outputPath, evidence, { repoRoot, workspaceKind });
    return evidence;
  } finally {
    if (existsSync(archivePath)) unlinkSync(archivePath);
    rmdirSync(temporaryDirectory);
  }
}

function repositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function parseArguments(argv) {
  if (
    argv.length !== 4 ||
    (argv[0] !== 'api' && argv[0] !== 'web') ||
    argv[1] !== `crypto-lending-${argv[0]}:ci` ||
    !SHA256.test(argv[2] ?? '') ||
    typeof argv[3] !== 'string' ||
    argv[3].length === 0
  ) {
    return fail('CAPTURE_ARGUMENT_INVALID');
  }
  return {
    workspaceKind: argv[0],
    imageReference: argv[1],
    expectedImageId: argv[2],
    outputPath: argv[3],
  };
}

export function runProductionImageBindingCaptureCli(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  captureProductionImageBinding({ ...args, repoRoot: repositoryRoot() });
  process.stdout.write(`Captured ${args.workspaceKind} local image archive binding.\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    runProductionImageBindingCaptureCli();
  } catch (error) {
    const code =
      error instanceof ProductionImageBindingCaptureError ||
      (error instanceof Error && typeof error.code === 'string')
        ? error.code
        : 'UNEXPECTED_CAPTURE_FAILURE';
    process.stderr.write(`Production image archive binding unavailable: ${code}\n`);
    process.exitCode = 1;
  }
}
