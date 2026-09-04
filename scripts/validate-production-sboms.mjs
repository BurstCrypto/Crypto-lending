#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { TextDecoder } from 'node:util';

export const MAX_PRODUCTION_SBOM_BYTES = 32 * 1024 * 1024;
export const SYFT_VERSION = '1.51.1';
export const SBOM_ACTION_COMMIT = '3ad7283483fc7af8ff2b4ea19663c2d5ca935e26';
export const PRODUCTION_SBOM_DIRECTORY = '.local-validation/production-sbom';
export const PRODUCTION_SBOM_FILES = Object.freeze({
  api: `${PRODUCTION_SBOM_DIRECTORY}/api-image.spdx.json`,
  web: `${PRODUCTION_SBOM_DIRECTORY}/web-image.spdx.json`,
});
export const PRODUCTION_SBOM_BINDING_FILES = Object.freeze({
  api: `${PRODUCTION_SBOM_DIRECTORY}/api-image.syft.json`,
  web: `${PRODUCTION_SBOM_DIRECTORY}/web-image.syft.json`,
});
export const PRODUCTION_IMAGE_BINDING_FILES = Object.freeze({
  api: `${PRODUCTION_SBOM_DIRECTORY}/api-image.binding.json`,
  web: `${PRODUCTION_SBOM_DIRECTORY}/web-image.binding.json`,
});
export const PRODUCTION_SBOM_IMAGES = Object.freeze({
  api: 'docker:crypto-lending-api:ci',
  web: 'docker:crypto-lending-web:ci',
});

const MAX_PACKAGES = 20_000;
const MAX_FILES = 100_000;
const MAX_RELATIONSHIPS = 200_000;
const MAX_LICENSES = 20_000;
const MAX_NATIVE_RELATIONSHIPS = 200_000;
const SYFT_JSON_SCHEMA_VERSION = '16.1.10';
const CANONICAL_OCI_SOURCE = 'https://github.com/Trey-Gleason/Crypto-lending';
const SPDX_ID = /^SPDXRef-[A-Za-z0-9.-]{1,255}$/u;
const LICENSE_ID = /^LicenseRef-[A-Za-z0-9.-]{1,255}$/u;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_~-]{0,255}$/u;
const SHA256_IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const IMAGE_BINDING_SCHEMA = 'crypto-lending.production-image-archive-binding.v1';
const OCI_INDEX_MEDIA_TYPE = 'application/vnd.oci.image.index.v1+json';
const IMAGE_MANIFEST_MEDIA_TYPES = Object.freeze([
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
]);
const IMAGE_CONFIG_MEDIA_TYPES = Object.freeze([
  'application/vnd.docker.container.image.v1+json',
  'application/vnd.oci.image.config.v1+json',
]);
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TOP_LEVEL_KEYS = new Set([
  'SPDXID',
  'creationInfo',
  'dataLicense',
  'documentNamespace',
  'files',
  'hasExtractedLicensingInfos',
  'name',
  'packages',
  'relationships',
  'spdxVersion',
]);
const PACKAGE_KEYS = new Set([
  'SPDXID',
  'annotations',
  'attributionTexts',
  'builtDate',
  'checksums',
  'comment',
  'copyrightText',
  'description',
  'downloadLocation',
  'externalRefs',
  'filesAnalyzed',
  'homepage',
  'licenseConcluded',
  'licenseDeclared',
  'licenseInfoFromFiles',
  'name',
  'originator',
  'packageFileName',
  'packageVerificationCode',
  'primaryPackagePurpose',
  'releaseDate',
  'sourceInfo',
  'summary',
  'supplier',
  'validUntilDate',
  'versionInfo',
]);
const FILE_KEYS = new Set([
  'SPDXID',
  'annotations',
  'attributionTexts',
  'checksums',
  'comment',
  'copyrightText',
  'fileContributors',
  'fileName',
  'fileTypes',
  'licenseConcluded',
  'licenseInfoInFiles',
  'noticeText',
]);
const WORKSPACES = Object.freeze({
  api: Object.freeze({
    relativePath: 'apps/api',
    expectedName: '@crypto-lending/api',
    documentName: 'sha256',
    imageName: 'crypto-lending-api',
    imageInput: PRODUCTION_SBOM_IMAGES.api,
    imageTag: 'ci',
    requiredPackages: Object.freeze([
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/platform-express',
      '@nestjs/swagger',
      'reflect-metadata',
      'rxjs',
    ]),
    forbiddenPackages: Object.freeze([
      '@eslint/js',
      '@nestjs/cli',
      '@nestjs/testing',
      '@solana/web3.js',
      '@types/jest',
      '@types/supertest',
      'eslint',
      'jest',
      'supertest',
      'ts-jest',
      'ts-node',
      'tsx',
      'typescript-eslint',
    ]),
  }),
  web: Object.freeze({
    relativePath: 'apps/web',
    expectedName: '@crypto-lending/web',
    documentName: 'sha256',
    imageName: 'crypto-lending-web',
    imageInput: PRODUCTION_SBOM_IMAGES.web,
    imageTag: 'ci',
    requiredPackages: Object.freeze(['next', 'react', 'react-dom']),
    forbiddenPackages: Object.freeze([
      '@solana/web3.js',
      '@testing-library/dom',
      '@testing-library/jest-dom',
      '@testing-library/react',
      '@types/react',
      '@types/react-dom',
      'eslint',
      'eslint-config-next',
      'jsdom',
      'vitest',
    ]),
  }),
});
const FORBIDDEN_PACKAGE_MANAGERS = Object.freeze(['corepack', 'npm', 'pnpm', 'yarn']);

export class ProductionSbomValidationError extends Error {
  constructor(code) {
    super('Production image SBOM validation failed.');
    this.name = 'ProductionSbomValidationError';
    this.code = code;
  }
}

function fail(code) {
  throw new ProductionSbomValidationError(code);
}

function isPlainRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function record(value, code) {
  if (!isPlainRecord(value)) return fail(code);
  return value;
}

function array(value, maximum, code) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum
  ) {
    return fail(code);
  }
  return value;
}

function requireAllowedKeys(value, allowed, required, code) {
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    return fail(code);
  }
}

function boundedString(value, maximum, code) {
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

function optionalString(value, maximum, code) {
  if (value === undefined) return;
  boundedString(value, maximum, code);
}

function normalizedPhysicalPath(value) {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function samePath(left, right) {
  return normalizedPhysicalPath(left) === normalizedPhysicalPath(right);
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map(String)
    .join(':');
}

export function readSecureRegularFile(filePath, maximumBytes = MAX_PRODUCTION_SBOM_BYTES) {
  const resolved = path.resolve(filePath);
  let initial;
  let real;
  try {
    initial = lstatSync(resolved, { bigint: true });
    real = realpathSync.native(resolved);
  } catch {
    return fail('SBOM_FILE_UNAVAILABLE');
  }
  if (
    initial.isSymbolicLink() ||
    !initial.isFile() ||
    initial.nlink !== 1n ||
    initial.size <= 0n ||
    initial.size > BigInt(maximumBytes) ||
    !samePath(resolved, real)
  ) {
    return fail('SBOM_FILE_UNSAFE');
  }

  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(resolved, fsConstants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || statIdentity(opened) !== statIdentity(initial)) {
      return fail('SBOM_FILE_UNSAFE');
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const final = lstatSync(resolved, { bigint: true });
    const finalReal = realpathSync.native(resolved);
    if (
      bytes.length !== Number(opened.size) ||
      statIdentity(after) !== statIdentity(opened) ||
      statIdentity(final) !== statIdentity(opened) ||
      !samePath(resolved, finalReal)
    ) {
      return fail('SBOM_FILE_UNSAFE');
    }
    return bytes;
  } catch (error) {
    if (error instanceof ProductionSbomValidationError) throw error;
    return fail('SBOM_FILE_UNSAFE');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateJsonWithoutDuplicateKeys(text, code) {
  let index = 0;

  function invalid() {
    return fail(code);
  }

  function whitespace() {
    while (
      text[index] === ' ' ||
      text[index] === '\t' ||
      text[index] === '\r' ||
      text[index] === '\n'
    ) {
      index += 1;
    }
  }

  function string() {
    if (text[index] !== '"') return invalid();
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text.charCodeAt(index);
      if (character === 0x22) {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          return invalid();
        }
      }
      if (character < 0x20) return invalid();
      if (character !== 0x5c) {
        index += 1;
        continue;
      }
      index += 1;
      const escaped = text[index];
      if (escaped === 'u') {
        const digits = text.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/u.test(digits)) return invalid();
        index += 5;
        continue;
      }
      if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped)) return invalid();
      index += 1;
    }
    return invalid();
  }

  function number() {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(index));
    if (match === null) return invalid();
    index += match[0].length;
  }

  function value(depth) {
    if (depth > 128) return invalid();
    whitespace();
    if (text[index] === '"') {
      string();
      return;
    }
    if (text[index] === '{') {
      object(depth + 1);
      return;
    }
    if (text[index] === '[') {
      list(depth + 1);
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    number();
  }

  function object(depth) {
    index += 1;
    whitespace();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set();
    while (index < text.length) {
      const key = string();
      if (keys.has(key)) return fail('JSON_DUPLICATE_KEY');
      keys.add(key);
      whitespace();
      if (text[index] !== ':') return invalid();
      index += 1;
      value(depth);
      whitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') return invalid();
      index += 1;
      whitespace();
    }
    return invalid();
  }

  function list(depth) {
    index += 1;
    whitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      value(depth);
      whitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') return invalid();
      index += 1;
    }
    return invalid();
  }

  whitespace();
  value(0);
  whitespace();
  if (index !== text.length) return invalid();
}

export function parseJsonBytes(bytes, code) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(code);
  }
  validateJsonWithoutDuplicateKeys(text, code);
  try {
    return JSON.parse(text);
  } catch {
    return fail(code);
  }
}

function repositoryJson(repoRoot, relativePath, maximumBytes) {
  return parseJsonBytes(
    readSecureRegularFile(path.join(repoRoot, relativePath), maximumBytes),
    'REPOSITORY_STATE_INVALID',
  );
}

function dependencyVersion(lockPackages, workspacePath, name) {
  for (const candidate of [`${workspacePath}/node_modules/${name}`, `node_modules/${name}`]) {
    const entry = lockPackages[candidate];
    if (isPlainRecord(entry) && typeof entry.version === 'string' && VERSION.test(entry.version)) {
      return entry.version;
    }
  }
  return fail('LOCK_DEPENDENCY_MISSING');
}

function workspaceExpectation(repoRoot, lockPackages, definition) {
  const manifest = record(
    repositoryJson(repoRoot, `${definition.relativePath}/package.json`, 1024 * 1024),
    'REPOSITORY_STATE_INVALID',
  );
  const lockWorkspace = record(lockPackages[definition.relativePath], 'LOCK_WORKSPACE_MISSING');
  const dependencies = record(manifest.dependencies, 'REPOSITORY_STATE_INVALID');
  const lockDependencies = record(lockWorkspace.dependencies, 'LOCK_WORKSPACE_MISMATCH');
  if (
    manifest.name !== definition.expectedName ||
    typeof manifest.version !== 'string' ||
    !VERSION.test(manifest.version) ||
    lockWorkspace.name !== manifest.name ||
    lockWorkspace.version !== manifest.version
  ) {
    return fail('WORKSPACE_IDENTITY_MISMATCH');
  }

  const requiredPackages = definition.requiredPackages.map((name) => {
    if (typeof dependencies[name] !== 'string' || lockDependencies[name] !== dependencies[name]) {
      return fail('LOCK_WORKSPACE_MISMATCH');
    }
    return Object.freeze({
      name,
      version: dependencyVersion(lockPackages, definition.relativePath, name),
    });
  });
  return Object.freeze({
    ...definition,
    version: manifest.version,
    requiredPackages: Object.freeze(requiredPackages),
  });
}

export function loadProductionSbomExpectations(repoRootInput) {
  const repoRoot = path.resolve(repoRootInput);
  const rootManifest = record(
    repositoryJson(repoRoot, 'package.json', 1024 * 1024),
    'REPOSITORY_STATE_INVALID',
  );
  const lock = record(
    repositoryJson(repoRoot, 'package-lock.json', 24 * 1024 * 1024),
    'REPOSITORY_STATE_INVALID',
  );
  const lockPackages = record(lock.packages, 'REPOSITORY_STATE_INVALID');
  const lockRoot = record(lockPackages[''], 'REPOSITORY_STATE_INVALID');
  if (
    rootManifest.name !== 'crypto-lending' ||
    rootManifest.version !== '0.1.0' ||
    lock.lockfileVersion !== 3 ||
    lockRoot.name !== rootManifest.name ||
    lockRoot.version !== rootManifest.version
  ) {
    return fail('REPOSITORY_STATE_INVALID');
  }
  return Object.freeze({
    repoRoot,
    api: workspaceExpectation(repoRoot, lockPackages, WORKSPACES.api),
    web: workspaceExpectation(repoRoot, lockPackages, WORKSPACES.web),
  });
}

function validateNamespace(value, expectation) {
  const raw = boundedString(value, 2048, 'SPDX_NAMESPACE_INVALID');
  let namespace;
  try {
    namespace = new URL(raw);
  } catch {
    return fail('SPDX_NAMESPACE_INVALID');
  }
  const prefix = `/syft/image/${expectation.documentName}-`;
  const suffix = namespace.pathname.slice(prefix.length);
  if (
    namespace.protocol !== 'https:' ||
    namespace.hostname !== 'anchore.com' ||
    namespace.username !== '' ||
    namespace.password !== '' ||
    namespace.port !== '' ||
    namespace.search !== '' ||
    namespace.hash !== '' ||
    !namespace.pathname.startsWith(prefix) ||
    !UUID.test(suffix)
  ) {
    return fail('SPDX_NAMESPACE_INVALID');
  }
  return raw;
}

function validateChecksum(value, code) {
  const checksum = record(value, code);
  requireAllowedKeys(
    checksum,
    new Set(['algorithm', 'checksumValue']),
    ['algorithm', 'checksumValue'],
    code,
  );
  const algorithm = boundedString(checksum.algorithm, 16, code);
  const digest = boundedString(checksum.checksumValue, 128, code);
  const lengths = Object.freeze({ MD5: 32, SHA1: 40, SHA256: 64, SHA384: 96, SHA512: 128 });
  const expectedLength = lengths[algorithm];
  if (
    expectedLength === undefined ||
    digest.length !== expectedLength ||
    !/^[0-9a-f]+$/u.test(digest)
  ) {
    return fail(code);
  }
  return Object.freeze({ algorithm, digest });
}

function validateChecksums(value, code) {
  const seen = new Set();
  return array(value, 16, code).map((item) => {
    const checksum = validateChecksum(item, code);
    if (seen.has(checksum.algorithm)) return fail(code);
    seen.add(checksum.algorithm);
    return checksum;
  });
}

function validateStringArray(value, maximumItems, maximumLength, code) {
  return array(value, maximumItems, code).map((item) => boundedString(item, maximumLength, code));
}

function validateExternalRefs(value) {
  return array(value, 64, 'SPDX_PACKAGE_INVALID').map((item) => {
    const ref = record(item, 'SPDX_PACKAGE_INVALID');
    requireAllowedKeys(
      ref,
      new Set(['comment', 'referenceCategory', 'referenceLocator', 'referenceType']),
      ['referenceCategory', 'referenceLocator', 'referenceType'],
      'SPDX_PACKAGE_INVALID',
    );
    optionalString(ref.comment, 4096, 'SPDX_PACKAGE_INVALID');
    return Object.freeze({
      category: boundedString(ref.referenceCategory, 64, 'SPDX_PACKAGE_INVALID'),
      locator: boundedString(ref.referenceLocator, 4096, 'SPDX_PACKAGE_INVALID'),
      type: boundedString(ref.referenceType, 128, 'SPDX_PACKAGE_INVALID'),
    });
  });
}

function validatePackage(value, identifiers) {
  const item = record(value, 'SPDX_PACKAGE_INVALID');
  requireAllowedKeys(
    item,
    PACKAGE_KEYS,
    [
      'SPDXID',
      'copyrightText',
      'downloadLocation',
      'filesAnalyzed',
      'licenseConcluded',
      'licenseDeclared',
      'name',
    ],
    'SPDX_PACKAGE_INVALID',
  );
  const name = boundedString(item.name, 512, 'SPDX_PACKAGE_INVALID');
  const identifier = boundedString(item.SPDXID, 264, 'SPDX_PACKAGE_ID_INVALID');
  if (!SPDX_ID.test(identifier) || identifiers.has(identifier)) {
    return fail(
      identifiers.has(identifier) ? 'SPDX_PACKAGE_ID_DUPLICATE' : 'SPDX_PACKAGE_ID_INVALID',
    );
  }
  identifiers.add(identifier);
  if (typeof item.filesAnalyzed !== 'boolean') return fail('SPDX_PACKAGE_INVALID');
  for (const key of [
    'builtDate',
    'comment',
    'copyrightText',
    'description',
    'downloadLocation',
    'homepage',
    'licenseConcluded',
    'licenseDeclared',
    'originator',
    'packageFileName',
    'primaryPackagePurpose',
    'releaseDate',
    'sourceInfo',
    'summary',
    'supplier',
    'validUntilDate',
  ]) {
    optionalString(item[key], 16_384, 'SPDX_PACKAGE_INVALID');
  }
  optionalString(item.versionInfo, 256, 'SPDX_PACKAGE_INVALID');
  const checksums =
    item.checksums === undefined ? [] : validateChecksums(item.checksums, 'SPDX_PACKAGE_INVALID');
  const externalRefs =
    item.externalRefs === undefined ? [] : validateExternalRefs(item.externalRefs);
  if (item.licenseInfoFromFiles !== undefined) {
    validateStringArray(item.licenseInfoFromFiles, 256, 512, 'SPDX_PACKAGE_INVALID');
  }
  if (item.attributionTexts !== undefined) {
    validateStringArray(item.attributionTexts, 256, 16_384, 'SPDX_PACKAGE_INVALID');
  }
  if (item.annotations !== undefined && !Array.isArray(item.annotations)) {
    return fail('SPDX_PACKAGE_INVALID');
  }
  if (item.packageVerificationCode !== undefined) {
    const verification = record(item.packageVerificationCode, 'SPDX_PACKAGE_INVALID');
    requireAllowedKeys(
      verification,
      new Set(['packageVerificationCodeExcludedFiles', 'packageVerificationCodeValue']),
      ['packageVerificationCodeValue'],
      'SPDX_PACKAGE_INVALID',
    );
    if (!/^[0-9a-f]{40}$/u.test(verification.packageVerificationCodeValue)) {
      return fail('SPDX_PACKAGE_INVALID');
    }
    if (verification.packageVerificationCodeExcludedFiles !== undefined) {
      validateStringArray(
        verification.packageVerificationCodeExcludedFiles,
        10_000,
        4096,
        'SPDX_PACKAGE_INVALID',
      );
    }
  }
  if (item.filesAnalyzed && item.packageVerificationCode === undefined) {
    return fail('SPDX_PACKAGE_INVALID');
  }
  return Object.freeze({
    name,
    identifier,
    version: item.versionInfo,
    purpose: item.primaryPackagePurpose,
    checksums,
    externalRefs,
  });
}

function safeImagePath(value) {
  const fileName = boundedString(value, 4096, 'SPDX_FILE_INVALID');
  return (
    !fileName.startsWith('/') &&
    !fileName.includes('\\') &&
    fileName.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function validateFile(value, identifiers) {
  const item = record(value, 'SPDX_FILE_INVALID');
  requireAllowedKeys(
    item,
    FILE_KEYS,
    ['SPDXID', 'checksums', 'copyrightText', 'fileName', 'licenseConcluded', 'licenseInfoInFiles'],
    'SPDX_FILE_INVALID',
  );
  const identifier = boundedString(item.SPDXID, 264, 'SPDX_FILE_INVALID');
  if (!SPDX_ID.test(identifier) || identifiers.has(identifier) || !safeImagePath(item.fileName)) {
    return fail('SPDX_FILE_INVALID');
  }
  identifiers.add(identifier);
  if (validateChecksums(item.checksums, 'SPDX_FILE_INVALID').length === 0) {
    return fail('SPDX_FILE_INVALID');
  }
  for (const key of ['comment', 'copyrightText', 'licenseConcluded', 'noticeText']) {
    optionalString(item[key], 64 * 1024, 'SPDX_FILE_INVALID');
  }
  validateStringArray(item.licenseInfoInFiles, 256, 512, 'SPDX_FILE_INVALID');
  if (item.fileTypes !== undefined) {
    validateStringArray(item.fileTypes, 32, 64, 'SPDX_FILE_INVALID');
  }
  if (item.fileContributors !== undefined) {
    validateStringArray(item.fileContributors, 256, 4096, 'SPDX_FILE_INVALID');
  }
  if (item.attributionTexts !== undefined) {
    validateStringArray(item.attributionTexts, 256, 16_384, 'SPDX_FILE_INVALID');
  }
  if (item.annotations !== undefined && !Array.isArray(item.annotations)) {
    return fail('SPDX_FILE_INVALID');
  }
  return identifier;
}

function validateExtractedLicense(value, identifiers) {
  const item = record(value, 'SPDX_LICENSE_INVALID');
  requireAllowedKeys(
    item,
    new Set(['comment', 'crossRefs', 'extractedText', 'licenseId', 'name', 'seeAlsos']),
    ['extractedText', 'licenseId'],
    'SPDX_LICENSE_INVALID',
  );
  const identifier = boundedString(item.licenseId, 264, 'SPDX_LICENSE_INVALID');
  if (!LICENSE_ID.test(identifier) || identifiers.has(identifier)) {
    return fail('SPDX_LICENSE_INVALID');
  }
  identifiers.add(identifier);
  boundedString(item.extractedText, MAX_PRODUCTION_SBOM_BYTES, 'SPDX_LICENSE_INVALID');
  optionalString(item.comment, 64 * 1024, 'SPDX_LICENSE_INVALID');
  optionalString(item.name, 4096, 'SPDX_LICENSE_INVALID');
  if (item.crossRefs !== undefined) {
    validateStringArray(item.crossRefs, 256, 4096, 'SPDX_LICENSE_INVALID');
  }
  if (item.seeAlsos !== undefined) {
    validateStringArray(item.seeAlsos, 256, 4096, 'SPDX_LICENSE_INVALID');
  }
}

function validateRelationship(value, identifiers, seen) {
  const relationship = record(value, 'SPDX_RELATIONSHIP_INVALID');
  requireAllowedKeys(
    relationship,
    new Set(['comment', 'relatedSpdxElement', 'relationshipType', 'spdxElementId']),
    ['relatedSpdxElement', 'relationshipType', 'spdxElementId'],
    'SPDX_RELATIONSHIP_INVALID',
  );
  const source = boundedString(relationship.spdxElementId, 264, 'SPDX_RELATIONSHIP_INVALID');
  const target = boundedString(relationship.relatedSpdxElement, 264, 'SPDX_RELATIONSHIP_INVALID');
  const type = boundedString(relationship.relationshipType, 64, 'SPDX_RELATIONSHIP_INVALID');
  optionalString(relationship.comment, 4096, 'SPDX_RELATIONSHIP_INVALID');
  if (!identifiers.has(source) || !identifiers.has(target) || !/^[A-Z][A-Z0-9_]*$/u.test(type)) {
    return fail('SPDX_RELATIONSHIP_DANGLING');
  }
  const key = `${source}\0${type}\0${target}`;
  if (seen.has(key)) return fail('SPDX_RELATIONSHIP_DUPLICATE');
  seen.add(key);
  return Object.freeze({ source, target, type });
}

function validateImageRoot(packages, relationships, expectation, expectedImageId) {
  if (!SHA256_IMAGE_ID.test(expectedImageId)) return fail('IMAGE_ID_INVALID');
  const expectedImageDigest = expectedImageId.slice('sha256:'.length);
  const descriptions = relationships.filter(
    ({ source, type }) => source === 'SPDXRef-DOCUMENT' && type === 'DESCRIBES',
  );
  if (descriptions.length !== 1) return fail('IMAGE_ROOT_INVALID');
  const root = packages.find(({ identifier }) => identifier === descriptions[0].target);
  const expectedRootId = `SPDXRef-DocumentRoot-Image-${expectation.documentName}`;
  const imageChecksums =
    root?.checksums.filter((checksum) => checksum.algorithm === 'SHA256') ?? [];
  if (imageChecksums.length !== 1) return fail('IMAGE_ROOT_INVALID');
  const digest = imageChecksums[0].digest;
  if (
    root === undefined ||
    root.identifier !== expectedRootId ||
    root.name !== expectation.documentName ||
    root.purpose !== 'CONTAINER'
  ) {
    return fail('IMAGE_ROOT_INVALID');
  }
  if (
    root.version !== expectedImageDigest ||
    !root.externalRefs.some(
      (ref) =>
        (ref.category === 'PACKAGE-MANAGER' || ref.category === 'PACKAGE_MANAGER') &&
        ref.type === 'purl' &&
        ref.locator.startsWith(`pkg:oci/${expectation.documentName}@sha256%3A${digest}?`) &&
        ref.locator.includes(`tag=${expectedImageDigest}`),
    )
  ) {
    return fail('IMAGE_INPUT_BINDING_INVALID');
  }
  return Object.freeze({ ...root, imageManifestDigest: `sha256:${digest}` });
}

export function validateProductionSpdxBytes(bytes, workspaceKind, expectations, expectedImageId) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PRODUCTION_SBOM_BYTES) {
    return fail('SBOM_FILE_UNSAFE');
  }
  if (workspaceKind !== 'api' && workspaceKind !== 'web') {
    return fail('WORKSPACE_IDENTITY_MISMATCH');
  }
  const expectation = expectations[workspaceKind];
  const document = record(parseJsonBytes(bytes, 'SPDX_JSON_INVALID'), 'SPDX_DOCUMENT_INVALID');
  requireAllowedKeys(
    document,
    TOP_LEVEL_KEYS,
    [
      'SPDXID',
      'creationInfo',
      'dataLicense',
      'documentNamespace',
      'files',
      'hasExtractedLicensingInfos',
      'name',
      'packages',
      'relationships',
      'spdxVersion',
    ],
    'SPDX_DOCUMENT_INVALID',
  );
  if (
    document.spdxVersion !== 'SPDX-2.3' ||
    document.dataLicense !== 'CC0-1.0' ||
    document.SPDXID !== 'SPDXRef-DOCUMENT' ||
    document.name !== expectation.documentName
  ) {
    return fail('SPDX_DOCUMENT_INVALID');
  }
  const namespace = validateNamespace(document.documentNamespace, expectation);

  const creationInfo = record(document.creationInfo, 'SPDX_CREATION_INFO_INVALID');
  requireAllowedKeys(
    creationInfo,
    new Set(['created', 'creators', 'licenseListVersion']),
    ['created', 'creators', 'licenseListVersion'],
    'SPDX_CREATION_INFO_INVALID',
  );
  const created = boundedString(creationInfo.created, 32, 'SPDX_CREATION_INFO_INVALID');
  const creators = validateStringArray(creationInfo.creators, 8, 128, 'SPDX_CREATION_INFO_INVALID');
  if (
    !CANONICAL_TIMESTAMP.test(created) ||
    Number.isNaN(Date.parse(created)) ||
    new Date(created).toISOString().replace('.000Z', 'Z') !== created ||
    !/^\d+\.\d+$/u.test(creationInfo.licenseListVersion) ||
    creators.length !== 2 ||
    creators[0] !== 'Organization: Anchore, Inc' ||
    creators[1] !== `Tool: syft-${SYFT_VERSION}`
  ) {
    return fail('SPDX_CREATION_INFO_INVALID');
  }

  const identifiers = new Set(['SPDXRef-DOCUMENT']);
  const packages = array(document.packages, MAX_PACKAGES, 'SPDX_PACKAGES_INVALID').map((item) =>
    validatePackage(item, identifiers),
  );
  if (packages.length === 0) return fail('SPDX_PACKAGES_INVALID');
  const files = array(document.files, MAX_FILES, 'SPDX_FILES_INVALID');
  for (const file of files) validateFile(file, identifiers);
  const licenseIdentifiers = new Set();
  for (const license of array(
    document.hasExtractedLicensingInfos,
    MAX_LICENSES,
    'SPDX_LICENSE_INVALID',
  )) {
    validateExtractedLicense(license, licenseIdentifiers);
  }

  const seenRelationships = new Set();
  const relationships = array(
    document.relationships,
    MAX_RELATIONSHIPS,
    'SPDX_RELATIONSHIPS_INVALID',
  ).map((item) => validateRelationship(item, identifiers, seenRelationships));
  if (relationships.length === 0) return fail('SPDX_RELATIONSHIPS_INVALID');
  const root = validateImageRoot(packages, relationships, expectation, expectedImageId);

  const forbidden = new Set(
    [...expectation.forbiddenPackages, ...FORBIDDEN_PACKAGE_MANAGERS].map((name) =>
      name.toLocaleLowerCase('en-US'),
    ),
  );
  if (packages.some(({ name }) => forbidden.has(name.toLocaleLowerCase('en-US')))) {
    return fail('FORBIDDEN_RUNTIME_PACKAGE');
  }
  for (const required of expectation.requiredPackages) {
    const matches = packages.filter(
      ({ name, version }) => name === required.name && version === required.version,
    );
    if (matches.length === 0) return fail('REQUIRED_RUNTIME_PACKAGE_MISSING');
    if (
      !matches.some(({ identifier }) =>
        relationships.some(
          ({ source, target, type }) =>
            source === root.identifier && target === identifier && type === 'CONTAINS',
        ),
      )
    ) {
      return fail('REQUIRED_RUNTIME_RELATIONSHIP_MISSING');
    }
  }

  return Object.freeze({
    workspace: workspaceKind,
    workspaceName: expectation.expectedName,
    workspaceVersion: expectation.version,
    image: `docker:${expectedImageId}`,
    taggedImage: expectation.imageInput,
    imageId: expectedImageId,
    imageManifestDigest: root.imageManifestDigest,
    spdxVersion: 'SPDX-2.3',
    syftVersion: SYFT_VERSION,
    created,
    namespace,
    packageCount: packages.length,
    fileCount: files.length,
    relationshipCount: relationships.length,
    inventoryHash: createHash('sha256')
      .update(
        packages
          .filter(({ identifier }) => identifier !== root.identifier)
          .map(({ name, version }) => `${name}\0${version ?? ''}`)
          .sort()
          .join('\n'),
      )
      .digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

function safeInteger(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) return fail(code);
  return value;
}

function canonicalBase64(value, maximumBytes, code) {
  const encoded = boundedString(value, Math.ceil((maximumBytes * 4) / 3) + 4, code);
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64');
  } catch {
    return fail(code);
  }
  if (
    decoded.length === 0 ||
    decoded.length > maximumBytes ||
    decoded.toString('base64') !== encoded
  ) {
    return fail(code);
  }
  return decoded;
}

function sha256Prefixed(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function validateImageConfigBytes(configBytes, code) {
  const config = record(parseJsonBytes(configBytes, code), code);
  requireAllowedKeys(
    config,
    new Set(['architecture', 'config', 'created', 'history', 'os', 'rootfs']),
    ['architecture', 'config', 'created', 'history', 'os', 'rootfs'],
    code,
  );
  const runtime = record(config.config, code);
  requireAllowedKeys(
    runtime,
    new Set([
      'ArgsEscaped',
      'AttachStderr',
      'AttachStdin',
      'AttachStdout',
      'Cmd',
      'Domainname',
      'Entrypoint',
      'Env',
      'ExposedPorts',
      'Healthcheck',
      'Hostname',
      'Image',
      'Labels',
      'MacAddress',
      'NetworkDisabled',
      'OnBuild',
      'OpenStdin',
      'Shell',
      'StdinOnce',
      'StopSignal',
      'Tty',
      'User',
      'Volumes',
      'WorkingDir',
    ]),
    ['Labels'],
    code,
  );
  const labels = record(runtime.Labels, code);
  boundedString(config.created, 64, code);
  for (const value of array(config.history, 4096, code)) {
    const history = record(value, code);
    requireAllowedKeys(
      history,
      new Set(['comment', 'created', 'created_by', 'empty_layer']),
      ['created'],
      code,
    );
    boundedString(history.created, 64, code);
    optionalString(history.created_by, 64 * 1024, code);
    optionalString(history.comment, 4096, code);
    if (history.empty_layer !== undefined && typeof history.empty_layer !== 'boolean') {
      return fail(code);
    }
  }
  const rootfs = record(config.rootfs, code);
  requireAllowedKeys(rootfs, new Set(['diff_ids', 'type']), ['diff_ids', 'type'], code);
  const diffIds = validateStringArray(rootfs.diff_ids, 1024, 71, code);
  if (
    config.architecture !== 'amd64' ||
    config.os !== 'linux' ||
    rootfs.type !== 'layers' ||
    diffIds.length === 0 ||
    diffIds.some((digest) => !SHA256_IMAGE_ID.test(digest)) ||
    new Set(diffIds).size !== diffIds.length
  ) {
    return fail('IMAGE_CONFIG_PLATFORM_INVALID');
  }
  for (const [name, value] of Object.entries(labels)) {
    boundedString(name, 256, code);
    boundedString(value, 16_384, code);
  }
  return Object.freeze({ architecture: config.architecture, os: config.os, diffIds, labels });
}

function validateBindingBlob(value, maximumBytes, allowedMediaTypes, code) {
  const blob = record(value, code);
  requireAllowedKeys(
    blob,
    new Set(['bytes', 'digest', 'mediaType', 'size']),
    ['bytes', 'digest', 'mediaType', 'size'],
    code,
  );
  const bytes = canonicalBase64(blob.bytes, maximumBytes, code);
  const digest = boundedString(blob.digest, 71, code);
  const mediaType = boundedString(blob.mediaType, 256, code);
  if (
    !SHA256_IMAGE_ID.test(digest) ||
    digest !== sha256Prefixed(bytes) ||
    safeInteger(blob.size, maximumBytes, code) !== bytes.length ||
    !allowedMediaTypes.includes(mediaType)
  ) {
    return fail('IMAGE_BINDING_BLOB_INVALID');
  }
  return Object.freeze({ bytes, bytesBase64: blob.bytes, digest, mediaType, size: bytes.length });
}

function validateImageDescriptor(
  value,
  allowedMediaTypes,
  code,
  platformRequired = false,
  maximumSize = 16 * 1024 * 1024,
) {
  const descriptor = record(value, code);
  requireAllowedKeys(
    descriptor,
    new Set(['annotations', 'digest', 'mediaType', 'platform', 'size']),
    ['digest', 'mediaType', 'size', ...(platformRequired ? ['platform'] : [])],
    code,
  );
  const digest = boundedString(descriptor.digest, 71, code);
  const mediaType = boundedString(descriptor.mediaType, 256, code);
  if (
    !SHA256_IMAGE_ID.test(digest) ||
    !allowedMediaTypes.includes(mediaType) ||
    safeInteger(descriptor.size, maximumSize, code) === 0
  ) {
    return fail(code);
  }
  const annotations =
    descriptor.annotations === undefined ? {} : record(descriptor.annotations, code);
  for (const [name, annotation] of Object.entries(annotations)) {
    boundedString(name, 256, code);
    boundedString(annotation, 4096, code);
    if (name === 'vnd.docker.reference.type' || /attestation/iu.test(annotation)) {
      return fail('IMAGE_BINDING_ATTESTATION_INVALID');
    }
  }
  let platform;
  if (descriptor.platform !== undefined) {
    platform = record(descriptor.platform, code);
    requireAllowedKeys(
      platform,
      new Set(['architecture', 'os', 'os.features', 'os.version', 'variant']),
      ['architecture', 'os'],
      code,
    );
    const architecture = boundedString(platform.architecture, 64, code);
    const operatingSystem = boundedString(platform.os, 64, code);
    optionalString(platform.variant, 64, code);
    optionalString(platform['os.version'], 256, code);
    if (platform['os.features'] !== undefined) {
      validateStringArray(platform['os.features'], 64, 256, code);
    }
    platform = Object.freeze({ architecture, os: operatingSystem });
  } else if (platformRequired) {
    return fail(code);
  }
  return Object.freeze({
    digest,
    mediaType,
    platform,
    size: descriptor.size,
  });
}

function validateImageAnnotations(value, code) {
  if (value === undefined) return;
  const annotations = record(value, code);
  if (Object.keys(annotations).length > 128) return fail(code);
  for (const [name, annotation] of Object.entries(annotations)) {
    boundedString(name, 256, code);
    boundedString(annotation, 4096, code);
    if (name === 'vnd.docker.reference.type' || /attestation/iu.test(annotation)) {
      return fail('IMAGE_BINDING_ATTESTATION_INVALID');
    }
  }
}

function validateArchiveManifestBlob(manifestBlob, configBlob, code) {
  const manifest = record(parseJsonBytes(manifestBlob.bytes, code), code);
  requireAllowedKeys(
    manifest,
    new Set(['annotations', 'config', 'layers', 'mediaType', 'schemaVersion']),
    ['config', 'layers', 'mediaType', 'schemaVersion'],
    code,
  );
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== manifestBlob.mediaType) {
    return fail(code);
  }
  validateImageAnnotations(manifest.annotations, code);
  const configDescriptor = validateImageDescriptor(manifest.config, IMAGE_CONFIG_MEDIA_TYPES, code);
  if (
    configDescriptor.digest !== configBlob.digest ||
    configDescriptor.mediaType !== configBlob.mediaType ||
    configDescriptor.size !== configBlob.size
  ) {
    return fail('IMAGE_BINDING_CONFIG_DESCRIPTOR_INVALID');
  }
  const seenLayers = new Set();
  const layers = array(manifest.layers, 1024, code).map((value) => {
    const layer = validateImageDescriptor(
      value,
      [
        'application/vnd.docker.image.rootfs.diff.tar.gzip',
        'application/vnd.oci.image.layer.v1.tar',
        'application/vnd.oci.image.layer.v1.tar+gzip',
        'application/vnd.oci.image.layer.v1.tar+zstd',
      ],
      code,
      false,
      16 * 1024 * 1024 * 1024,
    );
    if (seenLayers.has(layer.digest)) return fail('IMAGE_BINDING_DESCRIPTOR_DUPLICATE');
    seenLayers.add(layer.digest);
    return layer.digest;
  });
  if (layers.length === 0) return fail(code);
  return Object.freeze({ layers });
}

export function validateProductionImageBindingBytes(
  bytes,
  workspaceKind,
  expectations,
  expectedImageId,
) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 40 * 1024 * 1024) {
    return fail('IMAGE_BINDING_FILE_UNSAFE');
  }
  if (workspaceKind !== 'api' && workspaceKind !== 'web') {
    return fail('WORKSPACE_IDENTITY_MISMATCH');
  }
  if (!SHA256_IMAGE_ID.test(expectedImageId)) return fail('IMAGE_ID_INVALID');
  const expectation = expectations[workspaceKind];
  const document = record(
    parseJsonBytes(bytes, 'IMAGE_BINDING_JSON_INVALID'),
    'IMAGE_BINDING_INVALID',
  );
  requireAllowedKeys(
    document,
    new Set([
      'archiveFormat',
      'capturedImageId',
      'chainType',
      'config',
      'imageReference',
      'index',
      'inspectAfterImageId',
      'inspectBeforeImageId',
      'manifest',
      'platform',
      'schemaVersion',
      'workspace',
    ]),
    [
      'archiveFormat',
      'capturedImageId',
      'chainType',
      'config',
      'imageReference',
      'index',
      'inspectAfterImageId',
      'inspectBeforeImageId',
      'manifest',
      'platform',
      'schemaVersion',
      'workspace',
    ],
    'IMAGE_BINDING_INVALID',
  );
  const platform = record(document.platform, 'IMAGE_BINDING_INVALID');
  requireAllowedKeys(
    platform,
    new Set(['architecture', 'os']),
    ['architecture', 'os'],
    'IMAGE_BINDING_INVALID',
  );
  if (
    document.schemaVersion !== IMAGE_BINDING_SCHEMA ||
    document.workspace !== workspaceKind ||
    document.imageReference !== `${expectation.imageName}:${expectation.imageTag}` ||
    document.capturedImageId !== expectedImageId ||
    document.inspectBeforeImageId !== expectedImageId ||
    document.inspectAfterImageId !== expectedImageId ||
    platform.architecture !== 'amd64' ||
    platform.os !== 'linux' ||
    !['oci', 'docker'].includes(document.archiveFormat) ||
    !['index-manifest-config', 'manifest-config', 'config'].includes(document.chainType)
  ) {
    return fail('IMAGE_BINDING_IDENTITY_INVALID');
  }

  const configBlob = validateBindingBlob(
    document.config,
    16 * 1024 * 1024,
    IMAGE_CONFIG_MEDIA_TYPES,
    'IMAGE_BINDING_CONFIG_INVALID',
  );
  const config = validateImageConfigBytes(configBlob.bytes, 'IMAGE_BINDING_CONFIG_INVALID');
  let indexBlob;
  let manifestBlob;
  let archiveLayers;

  if (document.chainType === 'index-manifest-config') {
    if (document.archiveFormat !== 'oci' || document.index === null || document.manifest === null) {
      return fail('IMAGE_BINDING_CHAIN_INVALID');
    }
    indexBlob = validateBindingBlob(
      document.index,
      4 * 1024 * 1024,
      [OCI_INDEX_MEDIA_TYPE],
      'IMAGE_BINDING_INDEX_INVALID',
    );
    manifestBlob = validateBindingBlob(
      document.manifest,
      4 * 1024 * 1024,
      IMAGE_MANIFEST_MEDIA_TYPES,
      'IMAGE_BINDING_MANIFEST_INVALID',
    );
    if (indexBlob.digest !== expectedImageId) return fail('IMAGE_BINDING_ROOT_INVALID');
    const index = record(
      parseJsonBytes(indexBlob.bytes, 'IMAGE_BINDING_INDEX_INVALID'),
      'IMAGE_BINDING_INDEX_INVALID',
    );
    requireAllowedKeys(
      index,
      new Set(['annotations', 'manifests', 'mediaType', 'schemaVersion']),
      ['manifests', 'mediaType', 'schemaVersion'],
      'IMAGE_BINDING_INDEX_INVALID',
    );
    if (index.schemaVersion !== 2 || index.mediaType !== OCI_INDEX_MEDIA_TYPE) {
      return fail('IMAGE_BINDING_INDEX_INVALID');
    }
    validateImageAnnotations(index.annotations, 'IMAGE_BINDING_INDEX_INVALID');
    const seenDigests = new Set();
    const seenPlatforms = new Set();
    const selected = [];
    for (const value of array(index.manifests, 128, 'IMAGE_BINDING_INDEX_INVALID')) {
      const descriptor = validateImageDescriptor(
        value,
        IMAGE_MANIFEST_MEDIA_TYPES,
        'IMAGE_BINDING_INDEX_INVALID',
        true,
      );
      const platformKey = `${descriptor.platform.os}/${descriptor.platform.architecture}`;
      if (seenDigests.has(descriptor.digest) || seenPlatforms.has(platformKey)) {
        return fail('IMAGE_BINDING_DESCRIPTOR_DUPLICATE');
      }
      seenDigests.add(descriptor.digest);
      seenPlatforms.add(platformKey);
      if (platformKey === 'linux/amd64') selected.push(descriptor);
    }
    if (selected.length !== 1) return fail('IMAGE_BINDING_PLATFORM_SELECTION_INVALID');
    if (
      selected[0].digest !== manifestBlob.digest ||
      selected[0].mediaType !== manifestBlob.mediaType ||
      selected[0].size !== manifestBlob.size
    ) {
      return fail('IMAGE_BINDING_MANIFEST_DESCRIPTOR_INVALID');
    }
    archiveLayers = validateArchiveManifestBlob(
      manifestBlob,
      configBlob,
      'IMAGE_BINDING_MANIFEST_INVALID',
    ).layers;
  } else if (document.chainType === 'manifest-config') {
    if (document.archiveFormat !== 'oci' || document.index !== null || document.manifest === null) {
      return fail('IMAGE_BINDING_CHAIN_INVALID');
    }
    manifestBlob = validateBindingBlob(
      document.manifest,
      4 * 1024 * 1024,
      IMAGE_MANIFEST_MEDIA_TYPES,
      'IMAGE_BINDING_MANIFEST_INVALID',
    );
    if (manifestBlob.digest !== expectedImageId) return fail('IMAGE_BINDING_ROOT_INVALID');
    archiveLayers = validateArchiveManifestBlob(
      manifestBlob,
      configBlob,
      'IMAGE_BINDING_MANIFEST_INVALID',
    ).layers;
  } else {
    if (
      document.archiveFormat !== 'docker' ||
      document.index !== null ||
      document.manifest !== null ||
      configBlob.digest !== expectedImageId
    ) {
      return fail('IMAGE_BINDING_CHAIN_INVALID');
    }
  }
  if (archiveLayers !== undefined && archiveLayers.length !== config.diffIds.length) {
    return fail('IMAGE_BINDING_LAYER_CARDINALITY_INVALID');
  }

  return Object.freeze({
    workspace: workspaceKind,
    imageId: expectedImageId,
    imageReference: document.imageReference,
    archiveFormat: document.archiveFormat,
    chainType: document.chainType,
    configDigest: configBlob.digest,
    configBytesBase64: configBlob.bytesBase64,
    rootDigest:
      document.chainType === 'index-manifest-config'
        ? indexBlob.digest
        : document.chainType === 'manifest-config'
          ? manifestBlob.digest
          : configBlob.digest,
    manifestDigest: manifestBlob?.digest,
    diffIds: config.diffIds,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

function nativeCollectionIdentity(items, maximum, code) {
  const identifiers = new Set();
  const inventory = [];
  for (const value of array(items, maximum, code)) {
    const item = record(value, code);
    const identifier = boundedString(item.id, 64, code);
    if (!/^[0-9a-f]{16}$/u.test(identifier) || identifiers.has(identifier)) return fail(code);
    identifiers.add(identifier);
    if (code === 'SYFT_ARTIFACTS_INVALID') {
      inventory.push(
        `${boundedString(item.name, 512, code)}\0${boundedString(item.version, 256, code)}`,
      );
    }
  }
  return Object.freeze({
    count: identifiers.size,
    identifiers,
    inventoryHash:
      code === 'SYFT_ARTIFACTS_INVALID'
        ? createHash('sha256').update(inventory.sort().join('\n')).digest('hex')
        : undefined,
  });
}

function validateNativeManifest(metadata, expectedConfigBytesBase64, code) {
  const manifestBytes = canonicalBase64(metadata.manifest, 4 * 1024 * 1024, code);
  const configBytes = canonicalBase64(metadata.config, 16 * 1024 * 1024, code);
  const manifestDigest = sha256Prefixed(manifestBytes);
  const configDigest = sha256Prefixed(configBytes);
  if (manifestDigest !== metadata.manifestDigest || configDigest !== metadata.imageID) {
    return fail('SYFT_IMAGE_CONTENT_BINDING_INVALID');
  }
  if (metadata.config !== expectedConfigBytesBase64) {
    return fail('SYFT_ARCHIVE_CONFIG_BINDING_INVALID');
  }

  const manifest = record(parseJsonBytes(manifestBytes, code), code);
  requireAllowedKeys(
    manifest,
    new Set(['config', 'layers', 'mediaType', 'schemaVersion']),
    ['config', 'layers', 'mediaType', 'schemaVersion'],
    code,
  );
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== metadata.mediaType) return fail(code);
  const configDescriptor = record(manifest.config, code);
  requireAllowedKeys(
    configDescriptor,
    new Set(['digest', 'mediaType', 'size']),
    ['digest', 'mediaType', 'size'],
    code,
  );
  if (
    configDescriptor.digest !== metadata.imageID ||
    safeInteger(configDescriptor.size, 16 * 1024 * 1024, code) !== configBytes.length ||
    !boundedString(configDescriptor.mediaType, 256, code).includes('container.image')
  ) {
    return fail('SYFT_IMAGE_CONTENT_BINDING_INVALID');
  }

  const manifestLayers = array(manifest.layers, 1024, code).map((value) => {
    const layer = record(value, code);
    requireAllowedKeys(
      layer,
      new Set(['digest', 'mediaType', 'size']),
      ['digest', 'mediaType', 'size'],
      code,
    );
    if (!SHA256_IMAGE_ID.test(layer.digest)) return fail(code);
    safeInteger(layer.size, 128 * 1024 * 1024 * 1024, code);
    boundedString(layer.mediaType, 256, code);
    return layer.digest;
  });
  const metadataLayers = array(metadata.layers, 1024, code).map((value) => {
    const layer = record(value, code);
    requireAllowedKeys(
      layer,
      new Set(['digest', 'mediaType', 'size']),
      ['digest', 'mediaType', 'size'],
      code,
    );
    if (!SHA256_IMAGE_ID.test(layer.digest)) return fail(code);
    safeInteger(layer.size, 128 * 1024 * 1024 * 1024, code);
    boundedString(layer.mediaType, 256, code);
    return layer.digest;
  });
  if (
    manifestLayers.length === 0 ||
    manifestLayers.length !== metadataLayers.length ||
    manifestLayers.some((digest, index) => digest !== metadataLayers[index])
  ) {
    return fail('SYFT_IMAGE_CONTENT_BINDING_INVALID');
  }

  const config = validateImageConfigBytes(configBytes, code);
  if (
    config.architecture !== metadata.architecture ||
    config.os !== metadata.os ||
    JSON.stringify(Object.keys(config.labels).sort()) !==
      JSON.stringify(Object.keys(metadata.labels).sort())
  ) {
    return fail(code);
  }
  if (
    config.diffIds.length !== manifestLayers.length ||
    config.diffIds.some(
      (digest, index) => !SHA256_IMAGE_ID.test(digest) || digest !== manifestLayers[index],
    )
  ) {
    return fail('SYFT_ROOTFS_BINDING_INVALID');
  }
  for (const [name, value] of Object.entries(metadata.labels)) {
    if (config.labels[name] !== value) return fail('SYFT_IMAGE_CONTENT_BINDING_INVALID');
  }
  return Object.freeze({ manifestBytes, configBytes });
}

export function validateProductionSyftBindingBytes(
  bytes,
  workspaceKind,
  expectations,
  expectedImageId,
  expectedSourceRevision,
  imageBinding,
) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PRODUCTION_SBOM_BYTES) {
    return fail('SBOM_FILE_UNSAFE');
  }
  if (workspaceKind !== 'api' && workspaceKind !== 'web') {
    return fail('WORKSPACE_IDENTITY_MISMATCH');
  }
  if (!SHA256_IMAGE_ID.test(expectedImageId) || !/^[0-9a-f]{40}$/u.test(expectedSourceRevision)) {
    return fail('IMAGE_IDENTITY_ARGUMENT_INVALID');
  }
  if (
    !isPlainRecord(imageBinding) ||
    imageBinding.imageId !== expectedImageId ||
    typeof imageBinding.configBytesBase64 !== 'string'
  ) {
    return fail('IMAGE_BINDING_INVALID');
  }
  const expectation = expectations[workspaceKind];
  const document = record(parseJsonBytes(bytes, 'SYFT_JSON_INVALID'), 'SYFT_DOCUMENT_INVALID');
  requireAllowedKeys(
    document,
    new Set([
      'artifactRelationships',
      'artifacts',
      'descriptor',
      'distro',
      'files',
      'schema',
      'source',
    ]),
    ['artifactRelationships', 'artifacts', 'descriptor', 'distro', 'files', 'schema', 'source'],
    'SYFT_DOCUMENT_INVALID',
  );

  const artifacts = nativeCollectionIdentity(
    document.artifacts,
    MAX_PACKAGES,
    'SYFT_ARTIFACTS_INVALID',
  );
  const files = nativeCollectionIdentity(document.files, MAX_FILES, 'SYFT_FILES_INVALID');
  if ([...files.identifiers].some((identifier) => artifacts.identifiers.has(identifier))) {
    return fail('SYFT_IDENTITY_DUPLICATE');
  }
  const knownIdentifiers = new Set([...artifacts.identifiers, ...files.identifiers]);
  const source = record(document.source, 'SYFT_SOURCE_INVALID');
  requireAllowedKeys(
    source,
    new Set(['id', 'metadata', 'name', 'type', 'version']),
    ['id', 'metadata', 'name', 'type', 'version'],
    'SYFT_SOURCE_INVALID',
  );
  const metadata = record(source.metadata, 'SYFT_SOURCE_INVALID');
  requireAllowedKeys(
    metadata,
    new Set([
      'architecture',
      'config',
      'imageID',
      'imageSize',
      'labels',
      'layers',
      'manifest',
      'manifestDigest',
      'mediaType',
      'os',
      'repoDigests',
      'tags',
      'userInput',
    ]),
    [
      'architecture',
      'config',
      'imageID',
      'imageSize',
      'labels',
      'layers',
      'manifest',
      'manifestDigest',
      'mediaType',
      'os',
      'repoDigests',
      'tags',
      'userInput',
    ],
    'SYFT_SOURCE_INVALID',
  );
  const sourceId = boundedString(source.id, 64, 'SYFT_SOURCE_INVALID');
  const sourceVersion = boundedString(source.version, 64, 'SYFT_SOURCE_INVALID');
  const manifestDigest = boundedString(metadata.manifestDigest, 71, 'SYFT_SOURCE_INVALID');
  const imageConfigDigest = boundedString(metadata.imageID, 71, 'SYFT_SOURCE_INVALID');
  const expectedDigest = expectedImageId.slice('sha256:'.length);
  const expectedTag = `${expectation.imageName}:${expectation.imageTag}`;
  if (
    !/^[0-9a-f]{64}$/u.test(sourceId) ||
    sourceId !== manifestDigest.slice('sha256:'.length) ||
    source.name !== 'sha256' ||
    sourceVersion !== expectedDigest ||
    source.type !== 'image' ||
    metadata.userInput !== expectedImageId ||
    !SHA256_IMAGE_ID.test(imageConfigDigest) ||
    !SHA256_IMAGE_ID.test(manifestDigest) ||
    metadata.architecture !== 'amd64' ||
    metadata.os !== 'linux' ||
    safeInteger(metadata.imageSize, 128 * 1024 * 1024 * 1024, 'SYFT_SOURCE_INVALID') === 0 ||
    ![
      'application/vnd.docker.distribution.manifest.v2+json',
      'application/vnd.oci.image.manifest.v1+json',
    ].includes(metadata.mediaType) ||
    JSON.stringify(validateStringArray(metadata.tags, 8, 512, 'SYFT_SOURCE_INVALID')) !==
      JSON.stringify([expectedTag]) ||
    JSON.stringify(validateStringArray(metadata.repoDigests, 8, 512, 'SYFT_SOURCE_INVALID')) !==
      JSON.stringify([`${expectation.imageName}@${expectedImageId}`])
  ) {
    return fail('SYFT_IMAGE_INPUT_BINDING_INVALID');
  }
  if (knownIdentifiers.has(sourceId)) return fail('SYFT_IDENTITY_DUPLICATE');
  knownIdentifiers.add(sourceId);

  const labels = record(metadata.labels, 'SYFT_SOURCE_INVALID');
  for (const [name, value] of Object.entries(labels)) {
    boundedString(name, 256, 'SYFT_SOURCE_INVALID');
    boundedString(value, 16_384, 'SYFT_SOURCE_INVALID');
  }
  if (
    labels['org.opencontainers.image.title'] !== expectation.imageName ||
    labels['org.opencontainers.image.source'] !== CANONICAL_OCI_SOURCE ||
    labels['org.opencontainers.image.revision'] !== expectedSourceRevision
  ) {
    return fail('SYFT_OCI_IDENTITY_INVALID');
  }
  validateNativeManifest(metadata, imageBinding.configBytesBase64, 'SYFT_SOURCE_INVALID');
  if (imageConfigDigest !== imageBinding.configDigest) {
    return fail('SYFT_ARCHIVE_CONFIG_BINDING_INVALID');
  }

  for (const value of array(
    document.artifactRelationships,
    MAX_NATIVE_RELATIONSHIPS,
    'SYFT_RELATIONSHIPS_INVALID',
  )) {
    const relationship = record(value, 'SYFT_RELATIONSHIPS_INVALID');
    requireAllowedKeys(
      relationship,
      new Set(['child', 'metadata', 'parent', 'type']),
      ['child', 'parent', 'type'],
      'SYFT_RELATIONSHIPS_INVALID',
    );
    const parent = boundedString(relationship.parent, 64, 'SYFT_RELATIONSHIPS_INVALID');
    const child = boundedString(relationship.child, 64, 'SYFT_RELATIONSHIPS_INVALID');
    const type = boundedString(relationship.type, 64, 'SYFT_RELATIONSHIPS_INVALID');
    if (
      !/^[a-z][a-z-]{0,63}$/u.test(type) ||
      !knownIdentifiers.has(parent) ||
      !knownIdentifiers.has(child)
    ) {
      return fail('SYFT_RELATIONSHIPS_INVALID');
    }
    if (relationship.metadata !== undefined) {
      record(relationship.metadata, 'SYFT_RELATIONSHIPS_INVALID');
    }
  }
  record(document.distro, 'SYFT_DOCUMENT_INVALID');

  const descriptor = record(document.descriptor, 'SYFT_DESCRIPTOR_INVALID');
  const descriptorConfiguration = record(descriptor.configuration, 'SYFT_DESCRIPTOR_INVALID');
  const packageConfiguration = record(descriptorConfiguration.packages, 'SYFT_DESCRIPTOR_INVALID');
  if (
    descriptor.name !== 'syft' ||
    descriptor.version !== SYFT_VERSION ||
    record(packageConfiguration.cpp, 'SYFT_DESCRIPTOR_INVALID')['vcpkg-allow-git-clone'] !==
      false ||
    record(packageConfiguration['java-archive'], 'SYFT_DESCRIPTOR_INVALID')['use-network'] !==
      false ||
    record(packageConfiguration.javascript, 'SYFT_DESCRIPTOR_INVALID')['search-remote-licenses'] !==
      false ||
    record(packageConfiguration.golang, 'SYFT_DESCRIPTOR_INVALID')['search-remote-licenses'] !==
      false
  ) {
    return fail('SYFT_DESCRIPTOR_INVALID');
  }
  const schema = record(document.schema, 'SYFT_SCHEMA_INVALID');
  requireAllowedKeys(
    schema,
    new Set(['url', 'version']),
    ['url', 'version'],
    'SYFT_SCHEMA_INVALID',
  );
  if (
    schema.version !== SYFT_JSON_SCHEMA_VERSION ||
    schema.url !==
      `https://raw.githubusercontent.com/anchore/syft/main/schema/json/schema-${SYFT_JSON_SCHEMA_VERSION}.json`
  ) {
    return fail('SYFT_SCHEMA_INVALID');
  }

  return Object.freeze({
    workspace: workspaceKind,
    image: `docker:${expectedImageId}`,
    taggedImage: expectation.imageInput,
    imageId: expectedImageId,
    imageConfigDigest,
    imageManifestDigest: manifestDigest,
    sourceRevision: expectedSourceRevision,
    artifactCount: artifacts.count,
    fileCount: files.count,
    relationshipCount: document.artifactRelationships.length,
    inventoryHash: artifacts.inventoryHash,
    schemaVersion: SYFT_JSON_SCHEMA_VERSION,
    syftVersion: SYFT_VERSION,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

export function validateProductionSbomFiles({
  apiPath,
  webPath,
  apiBindingPath,
  webBindingPath,
  apiImageBindingPath,
  webImageBindingPath,
  repoRoot,
  apiImageId,
  webImageId,
  sourceRevision,
}) {
  const pathInputs = [
    apiPath,
    webPath,
    apiBindingPath,
    webBindingPath,
    apiImageBindingPath,
    webImageBindingPath,
  ];
  if (pathInputs.some((value) => typeof value !== 'string' || value.length === 0)) {
    return fail('SBOM_PATH_INVALID');
  }
  const resolvedPaths = pathInputs.map((value) => path.resolve(value));
  if (new Set(resolvedPaths.map(normalizedPhysicalPath)).size !== resolvedPaths.length) {
    return fail('SBOM_PATHS_DUPLICATE');
  }
  if (!SHA256_IMAGE_ID.test(apiImageId) || !SHA256_IMAGE_ID.test(webImageId)) {
    return fail('IMAGE_ID_INVALID');
  }
  if (apiImageId === webImageId) return fail('IMAGE_IDS_DUPLICATE');
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision)) return fail('SOURCE_REVISION_INVALID');
  const expectations = loadProductionSbomExpectations(repoRoot);
  const apiImageBinding = validateProductionImageBindingBytes(
    readSecureRegularFile(resolvedPaths[4], 40 * 1024 * 1024),
    'api',
    expectations,
    apiImageId,
  );
  const webImageBinding = validateProductionImageBindingBytes(
    readSecureRegularFile(resolvedPaths[5], 40 * 1024 * 1024),
    'web',
    expectations,
    webImageId,
  );
  const api = validateProductionSpdxBytes(
    readSecureRegularFile(resolvedPaths[0]),
    'api',
    expectations,
    apiImageId,
  );
  const web = validateProductionSpdxBytes(
    readSecureRegularFile(resolvedPaths[1]),
    'web',
    expectations,
    webImageId,
  );
  const apiBinding = validateProductionSyftBindingBytes(
    readSecureRegularFile(resolvedPaths[2]),
    'api',
    expectations,
    apiImageId,
    sourceRevision,
    apiImageBinding,
  );
  const webBinding = validateProductionSyftBindingBytes(
    readSecureRegularFile(resolvedPaths[3]),
    'web',
    expectations,
    webImageId,
    sourceRevision,
    webImageBinding,
  );
  for (const [spdx, binding] of [
    [api, apiBinding],
    [web, webBinding],
  ]) {
    if (
      spdx.imageManifestDigest !== binding.imageManifestDigest ||
      spdx.packageCount !== binding.artifactCount + 1 ||
      spdx.fileCount !== binding.fileCount ||
      spdx.inventoryHash !== binding.inventoryHash
    ) {
      return fail('SBOM_CROSS_FORMAT_BINDING_INVALID');
    }
  }
  if (api.namespace === web.namespace || api.sha256 === web.sha256) {
    return fail('SBOM_IDENTITIES_DUPLICATE');
  }
  if (apiBinding.sha256 === webBinding.sha256) return fail('SBOM_IDENTITIES_DUPLICATE');
  return Object.freeze({
    api: Object.freeze({
      ...api,
      sourceRevision,
      imageConfigDigest: apiBinding.imageConfigDigest,
      bindingSha256: apiBinding.sha256,
      archiveBindingSha256: apiImageBinding.sha256,
      imageChainType: apiImageBinding.chainType,
      syftSchemaVersion: apiBinding.schemaVersion,
    }),
    web: Object.freeze({
      ...web,
      sourceRevision,
      imageConfigDigest: webBinding.imageConfigDigest,
      bindingSha256: webBinding.sha256,
      archiveBindingSha256: webImageBinding.sha256,
      imageChainType: webImageBinding.chainType,
      syftSchemaVersion: webBinding.schemaVersion,
    }),
  });
}

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function requireStepFields(segment, fields) {
  for (const field of fields) {
    if (!segment.includes(field)) return fail('CI_SBOM_CONFIGURATION_INVALID');
  }
}

export function validateProductionSbomWorkflowText(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024 * 1024) {
    return fail('CI_SBOM_CONFIGURATION_INVALID');
  }
  const text = input.replaceAll('\r\n', '\n');
  const markers = [
    '- name: Build production container images from the reviewed definitions',
    '- name: Verify hardened production container runtime boundaries',
    '- name: Prepare isolated production SBOM output',
    '- name: Capture production image identities',
    '- name: Capture exact production image descriptor chains',
    '- name: Generate API production image SPDX SBOM',
    '- name: Generate API production image binding record',
    '- name: Generate web production image SPDX SBOM',
    '- name: Generate web production image binding record',
    '- name: Validate exact production image SBOMs',
    '- name: Create and verify revision-bound release candidate manifest',
    '- name: Stage immutable release candidate',
    '- name: Upload immutable release candidate',
  ];
  let prior = -1;
  const positions = [];
  for (const marker of markers) {
    const position = text.indexOf(marker);
    if (position <= prior || text.indexOf(marker, position + marker.length) !== -1) {
      return fail('CI_SBOM_ORDER_INVALID');
    }
    positions.push(position);
    prior = position;
  }
  const action = `uses: anchore/sbom-action@${SBOM_ACTION_COMMIT} # v0.24.2 (2026-08-28)`;
  if (
    occurrences(text, action) !== 4 ||
    occurrences(text, '--build-arg "OCI_SOURCE=https://github.com/Trey-Gleason/Crypto-lending"') !==
      2 ||
    occurrences(text, 'docker build --provenance=false --file Dockerfile.api') !== 1 ||
    occurrences(text, 'docker build --provenance=false --file Dockerfile.web') !== 1 ||
    occurrences(text, '--provenance=false') !== 2
  ) {
    return fail('CI_SBOM_CONFIGURATION_INVALID');
  }
  const captureSegment = text.slice(positions[3], positions[4]);
  requireStepFields(captureSegment, [
    'id: production-image-identities',
    'DOCKER_CONFIG: ${{ runner.temp }}/crypto-lending-sbom-no-credentials',
    `docker image inspect --format '{{.Id}}' crypto-lending-api:ci`,
    `docker image inspect --format '{{.Id}}' crypto-lending-web:ci`,
    '[[ "$API_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]',
    '[[ "$WEB_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]',
    'test "$API_IMAGE_ID" != "$WEB_IMAGE_ID"',
    'printf \'api_id=%s\\n\' "$API_IMAGE_ID" >> "$GITHUB_OUTPUT"',
    'printf \'web_id=%s\\n\' "$WEB_IMAGE_ID" >> "$GITHUB_OUTPUT"',
  ]);
  const descriptorCaptureSegment = text.slice(positions[4], positions[5]);
  requireStepFields(descriptorCaptureSegment, [
    'API_IMAGE_ID: ${{ steps.production-image-identities.outputs.api_id }}',
    'DOCKER_CONFIG: ${{ runner.temp }}/crypto-lending-sbom-no-credentials',
    'WEB_IMAGE_ID: ${{ steps.production-image-identities.outputs.web_id }}',
    `npm run production:sbom:capture -- api crypto-lending-api:ci "$API_IMAGE_ID" ${PRODUCTION_IMAGE_BINDING_FILES.api}`,
    `npm run production:sbom:capture -- web crypto-lending-web:ci "$WEB_IMAGE_ID" ${PRODUCTION_IMAGE_BINDING_FILES.web}`,
  ]);

  const actionSegments = [
    {
      segment: text.slice(positions[5], positions[6]),
      kind: 'api',
      format: 'spdx-json',
      output: PRODUCTION_SBOM_FILES.api,
    },
    {
      segment: text.slice(positions[6], positions[7]),
      kind: 'api',
      format: 'json',
      output: PRODUCTION_SBOM_BINDING_FILES.api,
    },
    {
      segment: text.slice(positions[7], positions[8]),
      kind: 'web',
      format: 'spdx-json',
      output: PRODUCTION_SBOM_FILES.web,
    },
    {
      segment: text.slice(positions[8], positions[9]),
      kind: 'web',
      format: 'json',
      output: PRODUCTION_SBOM_BINDING_FILES.web,
    },
  ];
  for (const { segment, kind, format, output } of actionSegments) {
    requireStepFields(segment, [
      action,
      `image: docker:\${{ steps.production-image-identities.outputs.${kind}_id }}`,
      `format: ${format}`,
      `output-file: ${output}`,
      `syft-version: v${SYFT_VERSION}`,
      'dependency-snapshot: false',
      'upload-artifact: false',
      'upload-release-assets: false',
      "github-token: ''",
      "AWS_REGION: ''",
      "AWS_ACCESS_KEY_ID: ''",
      "AWS_SECRET_ACCESS_KEY: ''",
      "AWS_SESSION_TOKEN: ''",
      "DATABASE_RUNTIME_URL: ''",
      "MIGRATION_DATABASE_URL: ''",
      "TEST_DATABASE_URL: ''",
      "REDIS_USERNAME: ''",
      "REDIS_PASSWORD: ''",
      "SQS_ENDPOINT: ''",
      "SQS_QUEUE_URL: ''",
      "SQS_DEAD_LETTER_QUEUE_URL: ''",
      'DOCKER_CONFIG: ${{ runner.temp }}/crypto-lending-sbom-no-credentials',
    ]);
    if (segment.includes('registry-username:') || segment.includes('registry-password:')) {
      return fail('CI_SBOM_CONFIGURATION_INVALID');
    }
  }
  const validationSegment = text.slice(positions[9], positions[10]);
  requireStepFields(validationSegment, [
    'DOCKER_CONFIG: ${{ runner.temp }}/crypto-lending-sbom-no-credentials',
    'npm run production:sbom:validate --',
    '"$API_IMAGE_ID" "$WEB_IMAGE_ID" "$GITHUB_SHA"',
    'API_IMAGE_ID="${{ steps.production-image-identities.outputs.api_id }}"',
    'WEB_IMAGE_ID="${{ steps.production-image-identities.outputs.web_id }}"',
    `docker image inspect --format '{{.Id}}' crypto-lending-api:ci`,
    `docker image inspect --format '{{.Id}}' crypto-lending-web:ci`,
    'test "$CURRENT_API_IMAGE_ID" = "$API_IMAGE_ID"',
    'test "$CURRENT_WEB_IMAGE_ID" = "$WEB_IMAGE_ID"',
  ]);
  return true;
}

function parseCliArguments(argv) {
  if (
    argv.length !== 3 ||
    !SHA256_IMAGE_ID.test(argv[0] ?? '') ||
    !SHA256_IMAGE_ID.test(argv[1] ?? '') ||
    !/^[0-9a-f]{40}$/u.test(argv[2] ?? '')
  ) {
    return fail('INVALID_ARGUMENTS');
  }
  return Object.freeze({ apiImageId: argv[0], webImageId: argv[1], sourceRevision: argv[2] });
}

function repositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function runProductionSbomValidatorCli(argv = process.argv.slice(2)) {
  const { apiImageId, webImageId, sourceRevision } = parseCliArguments(argv);
  const repoRoot = repositoryRoot();
  const result = validateProductionSbomFiles({
    apiPath: path.resolve(repoRoot, ...PRODUCTION_SBOM_FILES.api.split('/')),
    webPath: path.resolve(repoRoot, ...PRODUCTION_SBOM_FILES.web.split('/')),
    apiBindingPath: path.resolve(repoRoot, ...PRODUCTION_SBOM_BINDING_FILES.api.split('/')),
    webBindingPath: path.resolve(repoRoot, ...PRODUCTION_SBOM_BINDING_FILES.web.split('/')),
    apiImageBindingPath: path.resolve(repoRoot, ...PRODUCTION_IMAGE_BINDING_FILES.api.split('/')),
    webImageBindingPath: path.resolve(repoRoot, ...PRODUCTION_IMAGE_BINDING_FILES.web.split('/')),
    repoRoot,
    apiImageId,
    webImageId,
    sourceRevision,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    runProductionSbomValidatorCli();
  } catch (error) {
    const code =
      error instanceof ProductionSbomValidationError ? error.code : 'UNEXPECTED_VALIDATION_FAILURE';
    process.stderr.write(`Production image SBOM unavailable: ${code}\n`);
    process.exitCode = 1;
  }
}
