#!/usr/bin/env node

/**
 * Offline validation for the dedicated balance-consumer metadata secret.
 *
 * The record contains identifiers and a material-free key manifest only. This
 * module has no AWS, database, socket, DNS, HTTP, subprocess, secret-read, or
 * filesystem-write capability. Operational records need two independent
 * Ed25519 signatures from the production registry, which intentionally starts
 * empty. A successful report is therefore a non-executable review artifact.
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';
import { validateEd25519PublicKeyBytes } from '../shared/validate-ed25519-public-key.mjs';
import { authWalletTransitionStateSha256 } from './validate-auth-wallet-secret-version-transition.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..', '..');
export const LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT = join(
  REPOSITORY_ROOT,
  '.local-validation',
);
export const DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD = join(
  scriptDirectory,
  'balance-consumer-metadata-secret-version-transition.example.json',
);

export const MAX_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD_BYTES = 131_072;
export const BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR =
  'Balance-consumer metadata transition record must be a bounded, canonical, stable, single-link local JSON file in the approved ignored location.';
export const BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR =
  'Usage: validate-balance-consumer-metadata-secret-version-transition.mjs [--record <local-file>] [--mode <example|create|adopt|transition>] [--at <UTC-instant>] [--expected-account <id>] [--expected-region <region>] [--expected-stack <name>] [--expected-stack-id <arn>] [--expected-environment <name>] [--expected-envelope-sha256 <sha256>] [--expected-secret-arn <arn>] [--expected-kms-key-arn <arn>] [--expected-auth-wallet-secret-arn <arn>] [--expected-database-secret-arn <arn>] [--expected-redis-secret-arn <arn>] [--expected-current-version-id <id|NO_DEPLOYED_VERSION>] [--expected-target-version-id <id>] [--expected-predecessor-transition-sha256 <sha256|NONE>] [--expected-auth-wallet-state-sha256 <sha256>] [--expected-auth-wallet-transition-sha256 <sha256>] [--json].';

export const BALANCE_CONSUMER_METADATA_SECRET_FIELD =
  'BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON';
export const BALANCE_CONSUMER_METADATA_SECRET_FIELDS = Object.freeze([
  BALANCE_CONSUMER_METADATA_SECRET_FIELD,
]);
const AUTH_WALLET_METADATA_SECRET_FIELD = 'WALLET_METADATA_SEAL_KEY_RING_JSON';
const AUTH_WALLET_SECRET_FIELDS = Object.freeze([
  'AUTH_PREAUTH_SEAL_KEY',
  'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
  'AUTH_SESSION_HMAC_KEY_RING_JSON',
  'AUTH_CSRF_HMAC_KEY_RING_JSON',
  'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
  'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
  AUTH_WALLET_METADATA_SECRET_FIELD,
]);
const AUTH_WALLET_RING_PROPERTIES = Object.freeze({
  AUTH_IDENTITY_HMAC_KEY_RING_JSON: ['AUTH_IDENTITY_HMAC', 'identity_v', 'auth'],
  AUTH_SESSION_HMAC_KEY_RING_JSON: ['AUTH_SESSION_HMAC', 'session_v', 'auth'],
  AUTH_CSRF_HMAC_KEY_RING_JSON: ['AUTH_CSRF_HMAC', 'csrf_v', 'auth'],
  WALLET_IDENTITY_HMAC_KEY_RING_JSON: ['WALLET_IDENTITY_HMAC', 'wallet-identity-v', 'wallet'],
  WALLET_CHALLENGE_HMAC_KEY_RING_JSON: ['WALLET_CHALLENGE_HMAC', 'wallet-challenge-v', 'wallet'],
  WALLET_METADATA_SEAL_KEY_RING_JSON: ['WALLET_METADATA_SEAL', 'wallet-metadata-v', 'wallet'],
});

const ARTIFACT_TYPE = 'BALANCE_CONSUMER_METADATA_SECRET_VERSION_TRANSITION';
const AUTHORITY_ARTIFACT_TYPE = 'BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY';
const SIGNING_DOMAIN = 'crypto-lending:balance-consumer-metadata-secret-transition:v1';
const RECORD_HASH_DOMAIN = 'crypto-lending:balance-consumer-metadata-secret-transition-record:v1';
const STATE_HASH_DOMAIN = 'crypto-lending:balance-consumer-metadata-secret-state:v1';
const REGISTRY_HASH_DOMAIN =
  'crypto-lending:balance-consumer-metadata-transition-authority-registry:v1';
const DAY_MS = 86_400_000;
const MAX_METADATA_KEY_VERSION = 32_767;
const MAX_AUTH_WALLET_KEY_VERSION = 2_147_483_647;
const MAX_AUTH_WALLET_VERSION_HISTORY = 64;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/u;
const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/u;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-[1-9][0-9]?$/u;
const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/u;
const STACK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const RECORD_ID_PATTERN =
  /^balance-consumer-metadata\/(?:create|adopt|transition)\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u;
const AUTHORITY_KEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/u;
const KEY_ID_PATTERN = /^balance-consumer-metadata-v([1-9][0-9]{0,5})$/u;
const AUTH_WALLET_KEY_ID_PATTERN = /^wallet-metadata-v([1-9][0-9]{0,5})$/u;

const SIGNER_ROLES = Object.freeze([
  'BALANCE_CONSUMER_METADATA_TRANSITION_ISSUER',
  'INDEPENDENT_BALANCE_CONSUMER_METADATA_TRANSITION_VERIFIER',
]);
const SIGNER_SCOPE = 'BALANCE_CONSUMER_METADATA_SECRET_VERSION_TRANSITION';

const APPROVAL_REFERENCE_PATTERNS = Object.freeze({
  secretCustodyApprovalRef:
    /^approval\/secret-custody\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  walletPrivacyApprovalRef:
    /^approval\/wallet-privacy\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  databaseRewrapApprovalRef:
    /^approval\/database-rewrap\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  deploymentApprovalRef: /^approval\/deployment\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  rollbackApprovalRef: /^approval\/rollback\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
});

const EVIDENCE_KEYS = Object.freeze([
  'currentDeploymentCaptureSha256',
  'currentManifestSha256',
  'targetManifestSha256',
  'outerVersionInventorySha256',
  'metadataOnlyFieldInventorySha256',
  'secretSeparationSha256',
  'databaseKeyUsageSha256',
  'metadataKeyContinuitySha256',
  'databaseRewrapReadinessSha256',
  'candidateTaskReadinessSha256',
  'taskReplacementPlanSha256',
  'rollbackPlanSha256',
  'retirementReadinessSha256',
]);

const EXACT_KEYS = Object.freeze({
  root: ['schemaVersion', 'artifactType', 'content', 'signatures'],
  unsignedRoot: ['schemaVersion', 'artifactType', 'content'],
  content: [
    'status',
    'recordId',
    'issuedAt',
    'expiresAt',
    'deployment',
    'operation',
    'predecessor',
    'currentState',
    'targetState',
    'authWalletState',
    'authWalletMetadataProjection',
    'requiredSecretFields',
    'separation',
    'evidence',
    'approvals',
  ],
  deployment: [
    'accountId',
    'region',
    'stackName',
    'stackId',
    'environmentName',
    'balanceConsumerEnvelopeSha256',
  ],
  operation: ['kind', 'action'],
  predecessor: [
    'stateSha256',
    'transitionSha256',
    'authWalletStateSha256',
    'authWalletTransitionSha256',
  ],
  state: ['secretArn', 'kmsKeyArn', 'currentVersionId', 'usedVersionIds', 'manifest'],
  authWalletState: ['secretArn', 'kmsKeyArn', 'currentVersionId', 'usedVersionIds', 'manifest'],
  authWalletManifest: AUTH_WALLET_SECRET_FIELDS,
  authWalletPreauthManifest: ['presence'],
  authWalletRing: ['purpose', 'activeWriteVersion', 'keys', 'usedKeys', 'retiredOrBurnedKeys'],
  manifest: [
    'schemaVersion',
    'fieldName',
    'purpose',
    'activeWriteVersion',
    'keys',
    'retiredOrBurnedKeyVersions',
    'containsSecretMaterial',
  ],
  authWalletMetadataProjection: [
    'schemaVersion',
    'fieldName',
    'purpose',
    'activeWriteVersion',
    'keys',
    'retiredOrBurnedKeyVersions',
    'containsSecretMaterial',
  ],
  key: ['keyId', 'version'],
  separation: ['authWalletSecretArn', 'databaseSecretArn', 'redisSecretArn'],
  approvals: [
    'secretCustodyApprovalRef',
    'walletPrivacyApprovalRef',
    'databaseRewrapApprovalRef',
    'deploymentApprovalRef',
    'rollbackApprovalRef',
  ],
  signature: ['role', 'scope', 'authorityKeyId', 'algorithm', 'valueBase64'],
  registry: ['schemaVersion', 'artifactType', 'keys'],
  authorityKey: [
    'keyId',
    'algorithm',
    'status',
    'role',
    'scope',
    'publicKeySpkiDerBase64',
    'validFrom',
    'validUntil',
    'approvalReferenceId',
  ],
});

const EXPECTED_OPTION_KEYS = Object.freeze([
  'expectedAccount',
  'expectedRegion',
  'expectedStack',
  'expectedStackId',
  'expectedEnvironment',
  'expectedEnvelopeSha256',
  'expectedSecretArn',
  'expectedKmsKeyArn',
  'expectedAuthWalletSecretArn',
  'expectedDatabaseSecretArn',
  'expectedRedisSecretArn',
  'expectedCurrentVersionId',
  'expectedTargetVersionId',
  'expectedPredecessorTransitionSha256',
  'expectedAuthWalletStateSha256',
  'expectedAuthWalletTransitionSha256',
]);

const ZERO_CALLS = Object.freeze({
  externalCallsMade: 0,
  awsCallsMade: 0,
  databaseConnectionsMade: 0,
  redisConnectionsMade: 0,
  dnsQueriesMade: 0,
  httpRequestsMade: 0,
  secretValuesRead: 0,
  resourcesCreated: 0,
  credentialBytesRead: 0,
  filesWritten: 0,
});

/** Production authority is deliberately empty pending separate review. */
export const BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY = deepFreeze({
  schemaVersion: 1,
  artifactType: AUTHORITY_ARTIFACT_TYPE,
  keys: [],
});

const PRODUCTION_AUTHORIZED_REPORTS = new WeakSet();
const MAX_DATA_GRAPH_DEPTH = 64;
const MAX_DATA_GRAPH_NODES = 100_000;
const MAX_DATA_STRING_CHARACTERS = 262_144;

function arrayDataValues(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('Non-data array');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key === 'symbol')) throw new TypeError('Symbol array key');
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor ||
    Object.hasOwn(lengthDescriptor, 'get') ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.enumerable ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_DATA_GRAPH_NODES ||
    ownKeys.length !== lengthDescriptor.value + 1
  ) {
    throw new TypeError('Non-data array shape');
  }
  const values = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      Object.hasOwn(descriptor, 'get') ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError('Sparse or accessor-backed array');
    }
    values.push(descriptor.value);
  }
  return values;
}

function plainObjectDataEntries(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Non-data object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Custom object prototype');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key === 'symbol')) throw new TypeError('Symbol object key');
  return ownKeys.map((key) => {
    const descriptor = descriptors[key];
    if (
      !descriptor.enumerable ||
      Object.hasOwn(descriptor, 'get') ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError('Accessor-backed object');
    }
    return [key, descriptor.value];
  });
}

function assertDeepDataGraph(root) {
  const active = new WeakSet();
  let nodes = 0;
  const visit = (value, depth) => {
    nodes += 1;
    if (nodes > MAX_DATA_GRAPH_NODES || depth > MAX_DATA_GRAPH_DEPTH) {
      throw new TypeError('Data graph is too complex');
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      if (value.length > MAX_DATA_STRING_CHARACTERS) throw new TypeError('String is too large');
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new TypeError('Non-canonical number');
      return;
    }
    if (typeof value !== 'object' || active.has(value)) {
      throw new TypeError('Non-data or cyclic value');
    }
    active.add(value);
    const children = Array.isArray(value)
      ? arrayDataValues(value)
      : plainObjectDataEntries(value).map(([, child]) => child);
    for (const child of children) visit(child, depth + 1);
    active.delete(value);
  };
  visit(root, 0);
}

function isPlainDataObject(value) {
  try {
    plainObjectDataEntries(value);
    return true;
  } catch {
    return false;
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalValue(value, seen) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Non-canonical number');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Non-canonical array');
    seen.add(value);
    const result = arrayDataValues(value).map((entry) => canonicalValue(entry, seen));
    seen.delete(value);
    return result;
  }
  if (seen.has(value)) throw new TypeError('Non-canonical object');
  seen.add(value);
  const result = Object.fromEntries(
    plainObjectDataEntries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalValue(child, seen)]),
  );
  seen.delete(value);
  return result;
}

export function canonicalizeBalanceConsumerMetadataTransitionValue(value) {
  return JSON.stringify(canonicalValue(value, new WeakSet()));
}

function hashDomain(domain, value) {
  return createHash('sha256').update(`${domain}\n${value}`, 'utf8').digest('hex');
}

export function balanceConsumerMetadataTransitionStateSha256(state) {
  return hashDomain(STATE_HASH_DOMAIN, canonicalizeBalanceConsumerMetadataTransitionValue(state));
}

function recordSha256(record) {
  return hashDomain(RECORD_HASH_DOMAIN, canonicalizeBalanceConsumerMetadataTransitionValue(record));
}

function assertExactKeys(value, expectedKeys, label, errors) {
  if (!isPlainDataObject(value)) {
    errors.push(`${label} must be a plain data object.`);
    return false;
  }
  const actual = Object.keys(value);
  if (
    actual.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    errors.push(`${label} must contain only its exact reviewed keys.`);
    return false;
  }
  return true;
}

function canonicalInstant(value) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value.replace('Z', '.000Z')) {
    return undefined;
  }
  return parsed;
}

function validateWindow(issuedValue, expiresValue, now, errors) {
  const issuedAt = canonicalInstant(issuedValue);
  const expiresAt = canonicalInstant(expiresValue);
  if (
    !issuedAt ||
    !expiresAt ||
    expiresAt <= issuedAt ||
    expiresAt.getTime() - issuedAt.getTime() > DAY_MS
  ) {
    errors.push('Operational validity window must be canonical, positive, and at most 24 hours.');
    return;
  }
  if (now < issuedAt || now >= expiresAt) {
    errors.push('Operational transition is outside its signed validity window.');
  }
}

function partitionForArn(value) {
  const match = typeof value === 'string' ? value.match(/^arn:(aws|aws-us-gov|aws-cn):/u) : null;
  return match?.[1];
}

function secretArn(value, accountId, region) {
  const partition = partitionForArn(value);
  if (!partition) return false;
  const prefix = `arn:${partition}:secretsmanager:${region}:${accountId}:secret:`;
  const resource = value.slice(prefix.length);
  return (
    value.startsWith(prefix) &&
    resource.length >= 7 &&
    resource.length <= 512 &&
    /^[A-Za-z0-9/_+=.@-]+$/u.test(resource)
  );
}

function kmsKeyArn(value, accountId, region) {
  const partition = partitionForArn(value);
  if (!partition) return false;
  return new RegExp(
    `^arn:${partition}:kms:${region}:${accountId}:key/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`,
    'u',
  ).test(value);
}

function stackId(value, accountId, region, stackName) {
  const partition = partitionForArn(value);
  if (!partition) return false;
  const prefix = `arn:${partition}:cloudformation:${region}:${accountId}:stack/${stackName}/`;
  return (
    value.startsWith(prefix) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
      value.slice(prefix.length),
    )
  );
}

function validateDeployment(deployment, options, errors) {
  if (!assertExactKeys(deployment, EXACT_KEYS.deployment, 'content.deployment', errors)) return;
  if (
    typeof deployment.accountId !== 'string' ||
    !ACCOUNT_ID_PATTERN.test(deployment.accountId) ||
    /^0{12}$/u.test(deployment.accountId) ||
    typeof deployment.region !== 'string' ||
    !REGION_PATTERN.test(deployment.region) ||
    typeof deployment.stackName !== 'string' ||
    !STACK_NAME_PATTERN.test(deployment.stackName) ||
    typeof deployment.environmentName !== 'string' ||
    !ENVIRONMENT_PATTERN.test(deployment.environmentName) ||
    typeof deployment.balanceConsumerEnvelopeSha256 !== 'string' ||
    !SHA256_PATTERN.test(deployment.balanceConsumerEnvelopeSha256) ||
    !stackId(deployment.stackId, deployment.accountId, deployment.region, deployment.stackName)
  ) {
    errors.push('Deployment binding must use canonical, non-placeholder identities.');
  }
  for (const [actual, expected] of [
    [deployment.accountId, options.expectedAccount],
    [deployment.region, options.expectedRegion],
    [deployment.stackName, options.expectedStack],
    [deployment.stackId, options.expectedStackId],
    [deployment.environmentName, options.expectedEnvironment],
    [deployment.balanceConsumerEnvelopeSha256, options.expectedEnvelopeSha256],
  ]) {
    if (expected !== undefined && actual !== expected) {
      errors.push('Deployment identity does not match the exact invocation binding.');
    }
  }
}

function validateVersionIds(state, label, errors) {
  if (
    typeof state.currentVersionId !== 'string' ||
    !VERSION_ID_PATTERN.test(state.currentVersionId) ||
    !Array.isArray(state.usedVersionIds) ||
    state.usedVersionIds.length < 1 ||
    state.usedVersionIds.length > 64 ||
    state.usedVersionIds.some(
      (versionId) => typeof versionId !== 'string' || !VERSION_ID_PATTERN.test(versionId),
    ) ||
    new Set(state.usedVersionIds).size !== state.usedVersionIds.length ||
    state.usedVersionIds.at(-1) !== state.currentVersionId
  ) {
    errors.push(`${label} must bind one bounded append-only outer VersionId history.`);
  }
}

function validateManifest(manifest, label, errors) {
  if (!assertExactKeys(manifest, EXACT_KEYS.manifest, `${label}.manifest`, errors)) return;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.fieldName !== BALANCE_CONSUMER_METADATA_SECRET_FIELD ||
    manifest.purpose !== 'metadata-seal' ||
    manifest.containsSecretMaterial !== false ||
    !Number.isSafeInteger(manifest.activeWriteVersion) ||
    manifest.activeWriteVersion < 1 ||
    manifest.activeWriteVersion > MAX_METADATA_KEY_VERSION ||
    !Array.isArray(manifest.keys) ||
    manifest.keys.length < 1 ||
    manifest.keys.length > 3 ||
    !Array.isArray(manifest.retiredOrBurnedKeyVersions) ||
    manifest.retiredOrBurnedKeyVersions.length > 64
  ) {
    errors.push(`${label}.manifest must be the bounded material-free metadata-only ring.`);
    return;
  }
  const versions = [];
  for (const [index, key] of manifest.keys.entries()) {
    if (!assertExactKeys(key, EXACT_KEYS.key, `${label}.manifest.keys[${index}]`, errors)) {
      continue;
    }
    const match = typeof key.keyId === 'string' ? key.keyId.match(KEY_ID_PATTERN) : null;
    if (
      !Number.isSafeInteger(key.version) ||
      key.version < 1 ||
      key.version > MAX_METADATA_KEY_VERSION ||
      match === null ||
      Number(match[1]) !== key.version
    ) {
      errors.push(`${label}.manifest key identity is invalid.`);
      continue;
    }
    versions.push(key.version);
  }
  const retired = manifest.retiredOrBurnedKeyVersions;
  if (
    versions.length !== manifest.keys.length ||
    new Set(versions).size !== versions.length ||
    versions.some((version, index) => index > 0 && version <= versions[index - 1]) ||
    !versions.includes(manifest.activeWriteVersion) ||
    retired.some(
      (version, index) =>
        !Number.isSafeInteger(version) ||
        version < 1 ||
        version > MAX_METADATA_KEY_VERSION ||
        (index > 0 && version <= retired[index - 1]) ||
        versions.includes(version),
    )
  ) {
    errors.push(`${label}.manifest key histories must be ordered, unique, disjoint, and active.`);
  }
}

function authWalletKeyIdentity(entry) {
  return `${entry?.version ?? ''}\u0000${entry?.keyId ?? ''}`;
}

function validateAuthWalletKeyEntries(entries, minimum, maximum, prefix, label, errors) {
  if (!Array.isArray(entries) || entries.length < minimum || entries.length > maximum) {
    errors.push(`${label} must contain between ${minimum} and ${maximum} entries.`);
    return [];
  }
  let previousVersion = 0;
  const identities = new Set();
  const validated = [];
  for (const [index, entry] of entries.entries()) {
    if (!assertExactKeys(entry, EXACT_KEYS.key, `${label}[${index}]`, errors)) continue;
    const identity = authWalletKeyIdentity(entry);
    if (
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      entry.version > MAX_AUTH_WALLET_KEY_VERSION ||
      typeof entry.keyId !== 'string' ||
      entry.keyId !== `${prefix}${entry.version}` ||
      entry.version <= previousVersion ||
      identities.has(identity)
    ) {
      errors.push(`${label} must use strictly increasing purpose-bound key identities.`);
      continue;
    }
    previousVersion = entry.version;
    identities.add(identity);
    validated.push(entry);
  }
  return validated;
}

function validateAuthWalletRing(ring, fieldName, errors) {
  const label = `content.authWalletState.manifest.${fieldName}`;
  const properties = AUTH_WALLET_RING_PROPERTIES[fieldName];
  if (!assertExactKeys(ring, EXACT_KEYS.authWalletRing, label, errors)) return false;
  const [purpose, prefix, family] = properties;
  if (ring.purpose !== purpose) errors.push(`${label}.purpose must match its exact field.`);
  const keys = validateAuthWalletKeyEntries(ring.keys, 1, 3, prefix, `${label}.keys`, errors);
  const used = validateAuthWalletKeyEntries(
    ring.usedKeys,
    1,
    MAX_AUTH_WALLET_VERSION_HISTORY,
    prefix,
    `${label}.usedKeys`,
    errors,
  );
  const retired = validateAuthWalletKeyEntries(
    ring.retiredOrBurnedKeys,
    0,
    MAX_AUTH_WALLET_VERSION_HISTORY,
    prefix,
    `${label}.retiredOrBurnedKeys`,
    errors,
  );
  const keyIdentities = new Set(keys.map(authWalletKeyIdentity));
  const usedIdentities = new Set(used.map(authWalletKeyIdentity));
  const retiredIdentities = new Set(retired.map(authWalletKeyIdentity));
  if (
    keys.length !== ring.keys?.length ||
    used.length !== ring.usedKeys?.length ||
    retired.length !== ring.retiredOrBurnedKeys?.length ||
    [...keyIdentities].some((identity) => !usedIdentities.has(identity)) ||
    [...retiredIdentities].some(
      (identity) => !usedIdentities.has(identity) || keyIdentities.has(identity),
    ) ||
    usedIdentities.size !== keyIdentities.size + retiredIdentities.size
  ) {
    errors.push(`${label} must exactly partition its ordered append-only key history.`);
  }
  const activeIndex = keys.findIndex((entry) => entry.version === ring.activeWriteVersion);
  if (
    !Number.isSafeInteger(ring.activeWriteVersion) ||
    activeIndex < 0 ||
    (family === 'wallet' && activeIndex !== keys.length - 1) ||
    (family === 'auth' && activeIndex < keys.length - 2)
  ) {
    errors.push(`${label}.activeWriteVersion must name an allowed retained key.`);
  }
  return true;
}

function validateAuthWalletManifest(manifest, errors) {
  const label = 'content.authWalletState.manifest';
  const errorCount = errors.length;
  if (!assertExactKeys(manifest, EXACT_KEYS.authWalletManifest, label, errors)) return false;
  if (
    !assertExactKeys(
      manifest.AUTH_PREAUTH_SEAL_KEY,
      EXACT_KEYS.authWalletPreauthManifest,
      `${label}.AUTH_PREAUTH_SEAL_KEY`,
      errors,
    ) ||
    manifest.AUTH_PREAUTH_SEAL_KEY?.presence !== 'PRESENT'
  ) {
    errors.push(`${label}.AUTH_PREAUTH_SEAL_KEY must record only exact presence.`);
  }
  const allUsedKeyIds = [];
  for (const fieldName of Object.keys(AUTH_WALLET_RING_PROPERTIES)) {
    const ring = manifest[fieldName];
    validateAuthWalletRing(ring, fieldName, errors);
    if (Array.isArray(ring?.usedKeys)) {
      allUsedKeyIds.push(...ring.usedKeys.map((entry) => entry?.keyId));
    }
  }
  if (
    allUsedKeyIds.some((keyId) => typeof keyId !== 'string') ||
    new Set(allUsedKeyIds).size !== allUsedKeyIds.length
  ) {
    errors.push(`${label} must not reuse a keyId across authentication or wallet purposes.`);
  }
  return errors.length === errorCount;
}

function validateAuthWalletState(authWalletState, deployment, separation, errors) {
  const label = 'content.authWalletState';
  const errorCount = errors.length;
  if (!assertExactKeys(authWalletState, EXACT_KEYS.authWalletState, label, errors)) return false;
  const deploymentPartition = partitionForArn(deployment.stackId);
  if (
    !secretArn(authWalletState.secretArn, deployment.accountId, deployment.region) ||
    !kmsKeyArn(authWalletState.kmsKeyArn, deployment.accountId, deployment.region) ||
    partitionForArn(authWalletState.secretArn) !== deploymentPartition ||
    partitionForArn(authWalletState.kmsKeyArn) !== deploymentPartition ||
    authWalletState.secretArn !== separation?.authWalletSecretArn
  ) {
    errors.push(
      `${label} must bind the separated same-partition auth-wallet secret and its same-account, same-Region KMS key.`,
    );
  }
  validateVersionIds(authWalletState, label, errors);
  validateAuthWalletManifest(authWalletState.manifest, errors);
  return errors.length === errorCount;
}

function validateAuthWalletMetadataProjection(
  projection,
  authWalletState,
  authWalletStateValid,
  targetState,
  targetStateValid,
  errors,
) {
  const label = 'content.authWalletMetadataProjection';
  const errorCount = errors.length;
  if (!assertExactKeys(projection, EXACT_KEYS.authWalletMetadataProjection, label, errors)) {
    return false;
  }
  if (
    projection.schemaVersion !== 1 ||
    projection.fieldName !== AUTH_WALLET_METADATA_SECRET_FIELD ||
    projection.purpose !== 'metadata-seal' ||
    projection.containsSecretMaterial !== false ||
    !Number.isSafeInteger(projection.activeWriteVersion) ||
    projection.activeWriteVersion < 1 ||
    projection.activeWriteVersion > MAX_METADATA_KEY_VERSION ||
    !Array.isArray(projection.keys) ||
    projection.keys.length < 1 ||
    projection.keys.length > 3 ||
    !Array.isArray(projection.retiredOrBurnedKeyVersions) ||
    projection.retiredOrBurnedKeyVersions.length > 64
  ) {
    errors.push(`${label} must be one bounded material-free auth-wallet metadata projection.`);
    return false;
  }
  const versions = [];
  for (const [index, key] of projection.keys.entries()) {
    if (!assertExactKeys(key, EXACT_KEYS.key, `${label}.keys[${index}]`, errors)) continue;
    const match =
      typeof key.keyId === 'string' ? key.keyId.match(AUTH_WALLET_KEY_ID_PATTERN) : null;
    if (
      !Number.isSafeInteger(key.version) ||
      key.version < 1 ||
      key.version > MAX_METADATA_KEY_VERSION ||
      match === null ||
      Number(match[1]) !== key.version
    ) {
      errors.push(`${label} key identity is invalid.`);
      continue;
    }
    versions.push(key.version);
  }
  const retired = projection.retiredOrBurnedKeyVersions;
  if (
    versions.length !== projection.keys.length ||
    new Set(versions).size !== versions.length ||
    versions.some((version, index) => index > 0 && version <= versions[index - 1]) ||
    !versions.includes(projection.activeWriteVersion) ||
    retired.some(
      (version, index) =>
        !Number.isSafeInteger(version) ||
        version < 1 ||
        version > MAX_METADATA_KEY_VERSION ||
        (index > 0 && version <= retired[index - 1]) ||
        versions.includes(version),
    )
  ) {
    errors.push(`${label} histories must be ordered, unique, disjoint, and active.`);
  }
  if (
    authWalletStateValid &&
    (!isDeepStrictEqual(
      projection.keys,
      authWalletState.manifest[AUTH_WALLET_METADATA_SECRET_FIELD].keys,
    ) ||
      projection.activeWriteVersion !==
        authWalletState.manifest[AUTH_WALLET_METADATA_SECRET_FIELD].activeWriteVersion ||
      !isDeepStrictEqual(
        retired,
        authWalletState.manifest[AUTH_WALLET_METADATA_SECRET_FIELD].retiredOrBurnedKeys.map(
          ({ version }) => version,
        ),
      ))
  ) {
    errors.push(`${label} must be exactly derived from the bound auth-wallet metadata ring.`);
  }
  if (
    targetStateValid &&
    (!isDeepStrictEqual(
      versions,
      targetState.manifest.keys.map(({ version }) => version),
    ) ||
      projection.activeWriteVersion !== targetState.manifest.activeWriteVersion ||
      !isDeepStrictEqual(retired, targetState.manifest.retiredOrBurnedKeyVersions))
  ) {
    errors.push(
      `${label} must exactly mirror the target consumer versions, active version, and retired set.`,
    );
  }
  return errors.length === errorCount;
}

function validateState(state, deployment, label, errors) {
  const errorCount = errors.length;
  if (!assertExactKeys(state, EXACT_KEYS.state, label, errors)) return false;
  const deploymentPartition = partitionForArn(deployment.stackId);
  if (
    !secretArn(state.secretArn, deployment.accountId, deployment.region) ||
    !kmsKeyArn(state.kmsKeyArn, deployment.accountId, deployment.region) ||
    partitionForArn(state.secretArn) !== deploymentPartition ||
    partitionForArn(state.kmsKeyArn) !== deploymentPartition
  ) {
    errors.push(
      `${label} must bind same-partition, same-account, same-Region secret and KMS key ARNs.`,
    );
  }
  validateVersionIds(state, label, errors);
  validateManifest(state.manifest, label, errors);
  return errors.length === errorCount;
}

function validateSeparation(separation, targetState, deployment, options, errors) {
  if (!assertExactKeys(separation, EXACT_KEYS.separation, 'content.separation', errors)) return;
  const values = EXACT_KEYS.separation.map((key) => separation[key]);
  const deploymentPartition = partitionForArn(deployment.stackId);
  if (
    values.some((value) => !secretArn(value, deployment.accountId, deployment.region)) ||
    values.some((value) => partitionForArn(value) !== deploymentPartition) ||
    !targetState ||
    new Set([targetState.secretArn, ...values]).size !== values.length + 1
  ) {
    errors.push(
      'The metadata-only secret must be distinct from the auth/wallet, database, and Redis secrets.',
    );
  }
  for (const [actual, expected] of [
    [separation.authWalletSecretArn, options.expectedAuthWalletSecretArn],
    [separation.databaseSecretArn, options.expectedDatabaseSecretArn],
    [separation.redisSecretArn, options.expectedRedisSecretArn],
  ]) {
    if (expected !== undefined && actual !== expected) {
      errors.push('Secret separation does not match the exact invocation binding.');
    }
  }
}

function validatePredecessor(
  predecessor,
  mode,
  currentState,
  currentStateValid,
  authWalletState,
  authWalletStateValid,
  options,
  errors,
) {
  if (!assertExactKeys(predecessor, EXACT_KEYS.predecessor, 'content.predecessor', errors)) return;
  if (mode === 'transition') {
    if (
      !currentStateValid ||
      typeof predecessor.transitionSha256 !== 'string' ||
      !SHA256_PATTERN.test(predecessor.transitionSha256)
    ) {
      errors.push('TRANSITION must bind the exact current state and predecessor transition hash.');
    } else if (
      predecessor.stateSha256 !== balanceConsumerMetadataTransitionStateSha256(currentState)
    ) {
      errors.push('TRANSITION must bind the exact current state and predecessor transition hash.');
    }
  } else if (predecessor.stateSha256 !== 'UNTRACKED' || predecessor.transitionSha256 !== 'NONE') {
    errors.push('CREATE and ADOPT must start from the explicit untracked predecessor sentinel.');
  }
  if (
    typeof predecessor.authWalletStateSha256 !== 'string' ||
    !SHA256_PATTERN.test(predecessor.authWalletStateSha256) ||
    typeof predecessor.authWalletTransitionSha256 !== 'string' ||
    !SHA256_PATTERN.test(predecessor.authWalletTransitionSha256)
  ) {
    errors.push('The source auth-wallet state and transition must use exact SHA-256 bindings.');
  }
  if (
    authWalletStateValid &&
    predecessor.authWalletStateSha256 !== authWalletTransitionStateSha256(authWalletState)
  ) {
    errors.push(
      'The source auth-wallet state hash must bind the exact sanitized auth-wallet state.',
    );
  }
  if (predecessor.transitionSha256 !== options.expectedPredecessorTransitionSha256) {
    errors.push('Predecessor transition does not match the exact invocation binding.');
  }
  if (
    predecessor.authWalletStateSha256 !== options.expectedAuthWalletStateSha256 ||
    predecessor.authWalletTransitionSha256 !== options.expectedAuthWalletTransitionSha256
  ) {
    errors.push('Auth-wallet source bindings do not match the exact invocation binding.');
  }
}

function validateCreate(content, errors) {
  if (
    content.operation.kind !== 'CREATE_SECRET' ||
    content.operation.action !== 'CREATE_INITIAL_VERSION' ||
    content.currentState !== null ||
    content.targetState.usedVersionIds.length !== 1
  ) {
    errors.push(
      'CREATE must describe one new outer secret VersionId mirroring the bound auth-wallet metadata ring.',
    );
  }
}

function validateAdopt(content, errors) {
  if (
    content.operation.kind !== 'ADOPT_EXISTING_SECRET' ||
    content.operation.action !== 'ADOPT_CURRENT_VERSION' ||
    content.currentState === null ||
    !isDeepStrictEqual(content.currentState, content.targetState)
  ) {
    errors.push('ADOPT must attest one unchanged existing metadata-only secret state.');
  }
}

function validateSuccessor(current, target, errors) {
  const currentKeys = current.manifest.keys;
  const targetKeys = target.manifest.keys;
  const nextVersion = currentKeys.at(-1).version + 1;
  if (
    currentKeys.length >= 3 ||
    targetKeys.length !== currentKeys.length + 1 ||
    !isDeepStrictEqual(targetKeys.slice(0, -1), currentKeys) ||
    !isDeepStrictEqual(targetKeys.at(-1), {
      keyId: `balance-consumer-metadata-v${nextVersion}`,
      version: nextVersion,
    }) ||
    target.manifest.activeWriteVersion !== nextVersion ||
    !isDeepStrictEqual(
      target.manifest.retiredOrBurnedKeyVersions,
      current.manifest.retiredOrBurnedKeyVersions,
    )
  ) {
    errors.push('Successor rotation must append and activate exactly one sequential metadata key.');
  }
}

function validateRetirement(current, target, errors) {
  const removed = current.manifest.keys[0];
  if (
    current.manifest.keys.length < 2 ||
    removed.version === current.manifest.activeWriteVersion ||
    !isDeepStrictEqual(target.manifest.keys, current.manifest.keys.slice(1)) ||
    target.manifest.activeWriteVersion !== current.manifest.activeWriteVersion ||
    !isDeepStrictEqual(target.manifest.retiredOrBurnedKeyVersions, [
      ...current.manifest.retiredOrBurnedKeyVersions,
      removed.version,
    ])
  ) {
    errors.push('Retirement must remove only the oldest inactive key after rewrap readiness.');
  }
}

function validateTransition(content, errors) {
  if (
    content.operation.kind !== 'ROTATE_SECRET_VERSION' ||
    !['ADD_AND_ACTIVATE_SUCCESSOR', 'RETIRE_PREDECESSOR'].includes(content.operation.action) ||
    content.currentState === null
  ) {
    errors.push('TRANSITION must select one reviewed metadata-ring rotation action.');
    return;
  }
  const current = content.currentState;
  const target = content.targetState;
  if (
    current.secretArn !== target.secretArn ||
    current.kmsKeyArn !== target.kmsKeyArn ||
    target.currentVersionId === current.currentVersionId ||
    !isDeepStrictEqual(target.usedVersionIds, [...current.usedVersionIds, target.currentVersionId])
  ) {
    errors.push('TRANSITION must preserve custody and append exactly one new outer VersionId.');
  }
  if (content.operation.action === 'ADD_AND_ACTIVATE_SUCCESSOR') {
    validateSuccessor(current, target, errors);
  } else {
    validateRetirement(current, target, errors);
  }
}

function validateOperation(content, mode, errors) {
  if (!assertExactKeys(content.operation, EXACT_KEYS.operation, 'content.operation', errors)) {
    return;
  }
  if (mode === 'create') validateCreate(content, errors);
  else if (mode === 'adopt') validateAdopt(content, errors);
  else validateTransition(content, errors);
}

function validateEvidence(evidence, mode, action, errors) {
  if (!assertExactKeys(evidence, EVIDENCE_KEYS, 'content.evidence', errors)) return;
  const required = new Set();
  if (mode === 'create') {
    for (const key of [
      'targetManifestSha256',
      'outerVersionInventorySha256',
      'metadataOnlyFieldInventorySha256',
      'secretSeparationSha256',
      'databaseKeyUsageSha256',
      'metadataKeyContinuitySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ]) {
      required.add(key);
    }
  } else if (mode === 'adopt') {
    for (const key of [
      'currentDeploymentCaptureSha256',
      'currentManifestSha256',
      'outerVersionInventorySha256',
      'metadataOnlyFieldInventorySha256',
      'secretSeparationSha256',
      'databaseKeyUsageSha256',
      'metadataKeyContinuitySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ]) {
      required.add(key);
    }
  } else {
    for (const key of EVIDENCE_KEYS) {
      if (!['retirementReadinessSha256', 'databaseRewrapReadinessSha256'].includes(key)) {
        required.add(key);
      }
    }
    if (action === 'RETIRE_PREDECESSOR') {
      required.add('databaseRewrapReadinessSha256');
      required.add('retirementReadinessSha256');
    }
  }
  const hashes = [];
  for (const key of EVIDENCE_KEYS) {
    if (required.has(key)) {
      if (typeof evidence[key] !== 'string' || !SHA256_PATTERN.test(evidence[key])) {
        errors.push(`content.evidence.${key} must bind reviewed sanitized evidence.`);
      } else {
        hashes.push(evidence[key]);
      }
    } else if (evidence[key] !== 'NOT_APPLICABLE') {
      errors.push(`content.evidence.${key} must be NOT_APPLICABLE for this operation.`);
    }
  }
  if (new Set(hashes).size !== hashes.length) {
    errors.push('Required evidence fields must use distinct domain-specific SHA-256 bindings.');
  }
}

function validateApprovals(approvals, errors) {
  if (!assertExactKeys(approvals, EXACT_KEYS.approvals, 'content.approvals', errors)) return;
  const references = Object.values(approvals);
  if (
    Object.entries(APPROVAL_REFERENCE_PATTERNS).some(
      ([key, pattern]) => typeof approvals[key] !== 'string' || !pattern.test(approvals[key]),
    ) ||
    new Set(references).size !== references.length
  ) {
    errors.push('Approval references must be bounded, non-secret, and mutually independent.');
  }
}

function validateExpectedStateBindings(content, options, mode, errors) {
  const currentVersion =
    mode === 'create' ? 'NO_DEPLOYED_VERSION' : content.currentState?.currentVersionId;
  for (const [label, actual, expected] of [
    ['secret ARN', content.targetState?.secretArn, options.expectedSecretArn],
    ['KMS key ARN', content.targetState?.kmsKeyArn, options.expectedKmsKeyArn],
    ['current VersionId', currentVersion, options.expectedCurrentVersionId],
    ['target VersionId', content.targetState?.currentVersionId, options.expectedTargetVersionId],
  ]) {
    if (expected !== undefined && actual !== expected) {
      errors.push(`Record ${label} does not match the exact invocation binding.`);
    }
  }
}

function validateOperationalContent(content, mode, options, errors) {
  if (!assertExactKeys(content, EXACT_KEYS.content, 'content', errors)) return;
  if (content.status !== 'APPROVED') errors.push('Operational content.status must be APPROVED.');
  if (typeof content.recordId !== 'string' || !RECORD_ID_PATTERN.test(content.recordId)) {
    errors.push('content.recordId must be a bounded non-secret reference.');
  } else if (!content.recordId.startsWith(`balance-consumer-metadata/${mode}/`)) {
    errors.push('content.recordId must bind the selected operation mode.');
  }
  validateWindow(content.issuedAt, content.expiresAt, options.now, errors);
  validateDeployment(content.deployment, options, errors);
  if (!isDeepStrictEqual(content.requiredSecretFields, BALANCE_CONSUMER_METADATA_SECRET_FIELDS)) {
    errors.push('content.requiredSecretFields must contain the one exact metadata-ring field.');
  }
  let currentStateValid = mode === 'create' && content.currentState === null;
  if (mode !== 'create') {
    currentStateValid = validateState(
      content.currentState,
      content.deployment,
      'content.currentState',
      errors,
    );
  } else if (content.currentState !== null) {
    errors.push('CREATE currentState must be null.');
  }
  const targetStateValid = validateState(
    content.targetState,
    content.deployment,
    'content.targetState',
    errors,
  );
  const authWalletStateValid = validateAuthWalletState(
    content.authWalletState,
    content.deployment,
    content.separation,
    errors,
  );
  validateAuthWalletMetadataProjection(
    content.authWalletMetadataProjection,
    content.authWalletState,
    authWalletStateValid,
    content.targetState,
    targetStateValid,
    errors,
  );
  validateSeparation(content.separation, content.targetState, content.deployment, options, errors);
  validatePredecessor(
    content.predecessor,
    mode,
    content.currentState,
    currentStateValid,
    content.authWalletState,
    authWalletStateValid,
    options,
    errors,
  );
  if (currentStateValid && targetStateValid) validateOperation(content, mode, errors);
  validateEvidence(content.evidence, mode, content.operation?.action, errors);
  validateApprovals(content.approvals, errors);
  validateExpectedStateBindings(content, options, mode, errors);
}

function validateExample(record, errors) {
  if (!assertExactKeys(record, EXACT_KEYS.root, 'record', errors)) return;
  if (record.schemaVersion !== 1 || record.artifactType !== ARTIFACT_TYPE) {
    errors.push('Example must preserve its schema-v1 metadata-transition artifact identity.');
  }
  const content = record.content;
  if (!assertExactKeys(content, EXACT_KEYS.content, 'content', errors)) return;
  if (
    content.status !== 'NOT_AUTHORIZED' ||
    content.recordId !== 'NOT_AUTHORIZED' ||
    content.issuedAt !== 'NOT_RUN' ||
    content.expiresAt !== 'NOT_RUN' ||
    content.currentState !== null ||
    content.targetState !== null ||
    content.authWalletState !== null ||
    !Array.isArray(record.signatures) ||
    record.signatures.length !== 0
  ) {
    errors.push('Example must remain inert, unsigned, and NOT_AUTHORIZED.');
  }
  if (!isDeepStrictEqual(content.requiredSecretFields, BALANCE_CONSUMER_METADATA_SECRET_FIELDS)) {
    errors.push('Example must retain the one exact public metadata-ring field name.');
  }
  if (
    !assertExactKeys(content.deployment, EXACT_KEYS.deployment, 'content.deployment', errors) ||
    Object.values(content.deployment).some((value) => value !== 'NOT_AUTHORIZED')
  ) {
    errors.push('Example deployment identity must remain uncaptured.');
  }
  if (
    !assertExactKeys(content.operation, EXACT_KEYS.operation, 'content.operation', errors) ||
    Object.values(content.operation).some((value) => value !== 'NOT_AUTHORIZED')
  ) {
    errors.push('Example operation must remain NOT_AUTHORIZED.');
  }
  if (
    !assertExactKeys(content.predecessor, EXACT_KEYS.predecessor, 'content.predecessor', errors) ||
    content.predecessor.stateSha256 !== 'UNTRACKED' ||
    content.predecessor.transitionSha256 !== 'NONE' ||
    content.predecessor.authWalletStateSha256 !== 'NOT_RUN' ||
    content.predecessor.authWalletTransitionSha256 !== 'NOT_RUN'
  ) {
    errors.push('Example predecessor must remain untracked.');
  }
  if (content.authWalletMetadataProjection !== null) {
    errors.push('Example auth-wallet metadata projection must remain absent.');
  }
  if (
    !assertExactKeys(content.separation, EXACT_KEYS.separation, 'content.separation', errors) ||
    Object.values(content.separation).some((value) => value !== 'NOT_RUN')
  ) {
    errors.push('Example secret separation must remain NOT_RUN.');
  }
  if (
    !assertExactKeys(content.evidence, EVIDENCE_KEYS, 'content.evidence', errors) ||
    EVIDENCE_KEYS.some((key) => content.evidence[key] !== 'NOT_RUN')
  ) {
    errors.push('Example evidence must remain NOT_RUN.');
  }
  if (
    !assertExactKeys(content.approvals, EXACT_KEYS.approvals, 'content.approvals', errors) ||
    Object.values(content.approvals).some((value) => value !== 'NOT_APPROVED')
  ) {
    errors.push('Example approvals must remain NOT_APPROVED.');
  }
}

function canonicalBase64(value, expectedBytes) {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) throw new Error('invalid');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length !== expectedBytes) {
    throw new Error('invalid');
  }
  return bytes;
}

function parseRegistry(registry) {
  assertDeepDataGraph(registry);
  if (!assertExactKeys(registry, EXACT_KEYS.registry, 'registry', [])) throw new Error('invalid');
  if (
    registry.schemaVersion !== 1 ||
    registry.artifactType !== AUTHORITY_ARTIFACT_TYPE ||
    !Array.isArray(registry.keys) ||
    registry.keys.length > 16
  ) {
    throw new Error('invalid');
  }
  const ids = new Set();
  const publicKeyHashes = new Set();
  const keys = registry.keys.map((candidate) => {
    if (!assertExactKeys(candidate, EXACT_KEYS.authorityKey, 'authority key', [])) {
      throw new Error('invalid');
    }
    const validFrom = canonicalInstant(candidate.validFrom);
    const validUntil = canonicalInstant(candidate.validUntil);
    if (
      typeof candidate.keyId !== 'string' ||
      !AUTHORITY_KEY_ID_PATTERN.test(candidate.keyId) ||
      ids.has(candidate.keyId) ||
      candidate.algorithm !== 'Ed25519' ||
      candidate.status !== 'APPROVED' ||
      !SIGNER_ROLES.includes(candidate.role) ||
      candidate.scope !== SIGNER_SCOPE ||
      typeof candidate.approvalReferenceId !== 'string' ||
      !REFERENCE_PATTERN.test(candidate.approvalReferenceId) ||
      !validFrom ||
      !validUntil ||
      validUntil <= validFrom
    ) {
      throw new Error('invalid');
    }
    const der = canonicalBase64(candidate.publicKeySpkiDerBase64, 44);
    if (!der.subarray(0, ED25519_SPKI_DER_PREFIX.length).equals(ED25519_SPKI_DER_PREFIX)) {
      throw new Error('invalid');
    }
    validateEd25519PublicKeyBytes(der.subarray(ED25519_SPKI_DER_PREFIX.length));
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('invalid');
    const canonicalDer = key.export({ format: 'der', type: 'spki' });
    if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(der)) throw new Error('invalid');
    const publicKeySha256 = createHash('sha256').update(der).digest('hex');
    if (publicKeyHashes.has(publicKeySha256)) throw new Error('invalid');
    ids.add(candidate.keyId);
    publicKeyHashes.add(publicKeySha256);
    return { ...candidate, validFrom, validUntil, key, publicKeySha256 };
  });
  return {
    keys,
    registrySha256: hashDomain(
      REGISTRY_HASH_DOMAIN,
      canonicalizeBalanceConsumerMetadataTransitionValue(registry),
    ),
  };
}

function parseSignatures(signatures) {
  if (!Array.isArray(signatures) || signatures.length !== SIGNER_ROLES.length) {
    throw new Error('invalid');
  }
  const ids = new Set();
  return signatures.map((candidate, index) => {
    if (!assertExactKeys(candidate, EXACT_KEYS.signature, 'signature', [])) {
      throw new Error('invalid');
    }
    if (
      candidate.role !== SIGNER_ROLES[index] ||
      candidate.scope !== SIGNER_SCOPE ||
      typeof candidate.authorityKeyId !== 'string' ||
      !AUTHORITY_KEY_ID_PATTERN.test(candidate.authorityKeyId) ||
      ids.has(candidate.authorityKeyId) ||
      candidate.algorithm !== 'Ed25519'
    ) {
      throw new Error('invalid');
    }
    canonicalBase64(candidate.valueBase64, 64);
    ids.add(candidate.authorityKeyId);
    return candidate;
  });
}

export function balanceConsumerMetadataSecretTransitionSigningBytes(unsignedRecord) {
  if (
    !assertExactKeys(unsignedRecord, EXACT_KEYS.unsignedRoot, 'unsigned record', []) ||
    unsignedRecord.schemaVersion !== 1 ||
    unsignedRecord.artifactType !== ARTIFACT_TYPE
  ) {
    throw new Error('Invalid balance-consumer metadata transition signing input.');
  }
  return Buffer.from(
    `${SIGNING_DOMAIN}\n${canonicalizeBalanceConsumerMetadataTransitionValue(unsignedRecord)}`,
    'utf8',
  );
}

function baseFailureReport(mode, errors) {
  return deepFreeze({
    ok: false,
    readyForAuthorizedPlan: false,
    productionAuthorityValidated: false,
    signatureValidated: false,
    mode,
    errors,
    ...ZERO_CALLS,
  });
}

function planFor(content) {
  return deepFreeze({
    kind: 'LOCAL_ONLY_NON_EXECUTABLE_BALANCE_CONSUMER_METADATA_VERSION_PLAN',
    operation: content.operation.action,
    fieldName: BALANCE_CONSUMER_METADATA_SECRET_FIELD,
    executionAllowed: false,
    separateAuthorizationRequired: true,
    steps: [
      'VERIFY_SIGNED_SANITIZED_CURRENT_AND_TARGET_MANIFESTS',
      'VERIFY_BOUND_SANITIZED_AUTH_WALLET_STATE_AND_METADATA_PROJECTION',
      'VERIFY_THE_SECRET_CONTAINS_ONLY_THE_METADATA_RING_FIELD',
      'VERIFY_AUTH_WALLET_DATABASE_AND_REDIS_SECRET_SEPARATION',
      'VERIFY_DATABASE_REWRAP_READINESS_BEFORE_KEY_RETIREMENT',
      'PRESERVE_THE_SIGNED_ROLLBACK_VERSION_AND_PLAN',
    ],
    prohibitions: [
      'NO_SECRET_OR_KEY_MATERIAL',
      'NO_SECRET_VALUE_HASHES',
      'NO_API_AUTH_OR_GENERAL_WALLET_FIELDS_IN_TARGET_SECRET',
      'NO_DATABASE_OR_REDIS_CREDENTIAL_FIELDS',
      'NO_AWS_CALLS',
      'NO_DATABASE_OR_REDIS_CONNECTIONS',
      'NO_NETWORK_OR_DNS',
      'NO_RESOURCE_MUTATION',
      'NO_FILE_WRITES',
      'NO_RUNTIME_ACTIVATION',
    ],
  });
}

function validateRecordStructure(record, options) {
  const mode = options.mode ?? 'example';
  const errors = [];
  const operational = ['create', 'adopt', 'transition'].includes(mode);
  try {
    assertDeepDataGraph(record);
  } catch {
    errors.push('Record must be a bounded graph of plain JSON data values.');
    return { mode, operational, errors };
  }
  if (!['example', 'create', 'adopt', 'transition'].includes(mode)) {
    errors.push('Validation mode must be example, create, adopt, or transition.');
  }
  if (operational && (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))) {
    errors.push('Operational validation requires an explicit valid validation instant.');
  }
  if (
    operational &&
    EXPECTED_OPTION_KEYS.some(
      (key) => typeof options[key] !== 'string' || options[key].length === 0,
    )
  ) {
    errors.push('Operational validation requires every expected custody and deployment binding.');
  }
  if (!assertExactKeys(record, EXACT_KEYS.root, 'record', errors)) {
    return { mode, operational, errors };
  }
  if (record.schemaVersion !== 1) errors.push('record.schemaVersion must be 1.');
  if (record.artifactType !== ARTIFACT_TYPE) {
    errors.push(`record.artifactType must be ${ARTIFACT_TYPE}.`);
  }
  if (mode === 'example') validateExample(record, errors);
  else validateOperationalContent(record.content, mode, options, errors);
  return { mode, operational, errors };
}

function verifyRecord(record, options, registry, production) {
  let structural;
  try {
    structural = validateRecordStructure(record, options ?? {});
  } catch {
    return baseFailureReport(options?.mode, [
      'Balance-consumer metadata transition structure is malformed or non-canonical.',
    ]);
  }
  const errors = structural.errors;
  let registrySha256;
  let signatureValidated = false;
  if (structural.operational && errors.length === 0) {
    try {
      const parsedRegistry = parseRegistry(registry);
      registrySha256 = parsedRegistry.registrySha256;
      const signatures = parseSignatures(record.signatures);
      const unsigned = {
        schemaVersion: record.schemaVersion,
        artifactType: record.artifactType,
        content: record.content,
      };
      const signingBytes = balanceConsumerMetadataSecretTransitionSigningBytes(unsigned);
      const issuedAt = canonicalInstant(record.content.issuedAt);
      const expiresAt = canonicalInstant(record.content.expiresAt);
      const usedPublicKeys = new Set();
      for (const signature of signatures) {
        const authority = parsedRegistry.keys.find(
          (candidate) => candidate.keyId === signature.authorityKeyId,
        );
        if (
          !authority ||
          authority.role !== signature.role ||
          authority.scope !== signature.scope ||
          issuedAt < authority.validFrom ||
          expiresAt > authority.validUntil ||
          usedPublicKeys.has(authority.publicKeySha256) ||
          !verifySignature(
            null,
            signingBytes,
            authority.key,
            canonicalBase64(signature.valueBase64, 64),
          )
        ) {
          throw new Error('invalid');
        }
        usedPublicKeys.add(authority.publicKeySha256);
      }
      signatureValidated = true;
    } catch {
      errors.push('Record signatures do not satisfy the dedicated production authority registry.');
    }
  }
  const ok = errors.length === 0;
  const report = deepFreeze({
    ok,
    readyForAuthorizedPlan: false,
    productionAuthorityValidated: false,
    signatureValidated: ok && signatureValidated,
    mode: structural.mode,
    operation: ok && structural.operational ? record.content.operation.action : undefined,
    ...(ok
      ? {
          canonicalSha256: recordSha256(record),
          ...(structural.operational
            ? {
                currentStateSha256:
                  structural.mode === 'create'
                    ? 'NO_DEPLOYED_STATE'
                    : balanceConsumerMetadataTransitionStateSha256(record.content.currentState),
                targetStateSha256: balanceConsumerMetadataTransitionStateSha256(
                  record.content.targetState,
                ),
                predecessorTransitionSha256: record.content.predecessor.transitionSha256,
                authWalletStateSha256: record.content.predecessor.authWalletStateSha256,
                authWalletTransitionSha256: record.content.predecessor.authWalletTransitionSha256,
              }
            : {}),
          ...(signatureValidated ? { authorityRegistrySha256: registrySha256 } : {}),
        }
      : {}),
    plan: ok && structural.operational ? planFor(record.content) : undefined,
    errors,
    ...ZERO_CALLS,
  });
  if (ok && signatureValidated && production) {
    const productionReport = deepFreeze({
      ...report,
      readyForAuthorizedPlan: true,
      productionAuthorityValidated: true,
    });
    PRODUCTION_AUTHORIZED_REPORTS.add(productionReport);
    return productionReport;
  }
  return report;
}

/** Example validation is structural only and never confers operational authority. */
export function validateBalanceConsumerMetadataSecretVersionTransition(record, options = {}) {
  if ((options.mode ?? 'example') !== 'example') {
    return baseFailureReport(options.mode, [
      'Operational records require verification through the production authority path.',
    ]);
  }
  let structural;
  try {
    structural = validateRecordStructure(record, { ...options, mode: 'example' });
  } catch {
    return baseFailureReport('example', [
      'Balance-consumer metadata transition structure is malformed or non-canonical.',
    ]);
  }
  const ok = structural.errors.length === 0;
  return deepFreeze({
    ok,
    readyForAuthorizedPlan: false,
    productionAuthorityValidated: false,
    signatureValidated: false,
    mode: 'example',
    operation: ok ? 'EXAMPLE_ONLY' : undefined,
    ...(ok ? { canonicalSha256: recordSha256(record) } : {}),
    errors: structural.errors,
    ...ZERO_CALLS,
  });
}

/** Test-only cryptographic seam; its report is deliberately never production-branded. */
export function verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
  record,
  options,
  authorityRegistry,
) {
  return verifyRecord(record, options, authorityRegistry, false);
}

export function isProductionAuthorizedBalanceConsumerMetadataTransitionReport(report) {
  return isPlainDataObject(report) && PRODUCTION_AUTHORIZED_REPORTS.has(report);
}

function verifyWithProductionRegistry(record, options) {
  return verifyRecord(
    record,
    options,
    BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY,
    true,
  );
}

function comparablePath(path) {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathWithin(parent, child) {
  const fragment = relative(parent, child);
  return (
    fragment !== '' &&
    !isAbsolute(fragment) &&
    fragment !== '..' &&
    !fragment.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  );
}

function assertRecordLocation(recordPath, mode) {
  const resolvedPath = resolve(recordPath);
  if (mode === 'example') {
    if (
      comparablePath(resolvedPath) !==
      comparablePath(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD)
    ) {
      throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR);
    }
    return resolvedPath;
  }
  if (
    !pathWithin(LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT, resolvedPath) ||
    !resolvedPath.toLowerCase().endsWith('.balance-consumer-metadata-transition.local.json')
  ) {
    throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR);
  }
  return resolvedPath;
}

function loadRecordInternal(recordPath, mode, afterFirstReadForTest) {
  try {
    const resolvedPath = assertRecordLocation(recordPath, mode);
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(resolvedPath, MAX_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD_BYTES)
        : readSecureLocalFileForTest(
            resolvedPath,
            MAX_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD_BYTES,
            afterFirstReadForTest,
          );
    const record = parseStrictJsonBytes(bytes);
    if (mode !== 'example') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (canonicalizeBalanceConsumerMetadataTransitionValue(record) !== text) {
        throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR);
      }
    }
    return record;
  } catch {
    throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR);
  }
}

export function loadBalanceConsumerMetadataSecretVersionTransitionRecord(recordPath, mode) {
  return loadRecordInternal(recordPath, mode, undefined);
}

/** Test-only fault seam; production callers use the stable loader above. */
export function loadBalanceConsumerMetadataSecretVersionTransitionRecordForTest(
  recordPath,
  mode,
  afterFirstReadForTest,
) {
  return loadRecordInternal(recordPath, mode, afterFirstReadForTest);
}

function parseArguments(argv) {
  const options = {
    record: DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD,
    mode: 'example',
    json: false,
  };
  const valueArguments = new Map([
    ['--record', 'record'],
    ['--mode', 'mode'],
    ['--at', 'at'],
    ['--expected-account', 'expectedAccount'],
    ['--expected-region', 'expectedRegion'],
    ['--expected-stack', 'expectedStack'],
    ['--expected-stack-id', 'expectedStackId'],
    ['--expected-environment', 'expectedEnvironment'],
    ['--expected-envelope-sha256', 'expectedEnvelopeSha256'],
    ['--expected-secret-arn', 'expectedSecretArn'],
    ['--expected-kms-key-arn', 'expectedKmsKeyArn'],
    ['--expected-auth-wallet-secret-arn', 'expectedAuthWalletSecretArn'],
    ['--expected-database-secret-arn', 'expectedDatabaseSecretArn'],
    ['--expected-redis-secret-arn', 'expectedRedisSecretArn'],
    ['--expected-current-version-id', 'expectedCurrentVersionId'],
    ['--expected-target-version-id', 'expectedTargetVersionId'],
    ['--expected-predecessor-transition-sha256', 'expectedPredecessorTransitionSha256'],
    ['--expected-auth-wallet-state-sha256', 'expectedAuthWalletStateSha256'],
    ['--expected-auth-wallet-transition-sha256', 'expectedAuthWalletTransitionSha256'],
  ]);
  const operationalArguments = [...valueArguments.keys()].filter(
    (argument) => !['--record', '--mode'].includes(argument),
  );
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (seen.has(argument)) throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR);
      seen.add(argument);
      options.json = true;
      continue;
    }
    if (!valueArguments.has(argument) || seen.has(argument)) {
      throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR);
    }
    seen.add(argument);
    options[valueArguments.get(argument)] = value;
    index += 1;
  }
  if (!['example', 'create', 'adopt', 'transition'].includes(options.mode)) {
    throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR);
  }
  if (options.mode === 'example') {
    if (operationalArguments.some((argument) => seen.has(argument))) {
      throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR);
    }
  } else if (
    !seen.has('--record') ||
    operationalArguments.some((argument) => !seen.has(argument)) ||
    !canonicalInstant(options.at)
  ) {
    throw new Error(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR);
  }
  options.now = options.mode === 'example' ? undefined : new Date(options.at);
  return options;
}

function fixedFailure(message) {
  process.stderr.write(`${message}\n`);
  for (const [name, value] of Object.entries(ZERO_CALLS)) {
    process.stderr.write(`${name}: ${value}\n`);
  }
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch {
    fixedFailure(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR);
    process.exitCode = 2;
    return;
  }
  let record;
  try {
    record = loadBalanceConsumerMetadataSecretVersionTransitionRecord(options.record, options.mode);
  } catch {
    fixedFailure(BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR);
    process.exitCode = 2;
    return;
  }
  const report =
    options.mode === 'example'
      ? validateBalanceConsumerMetadataSecretVersionTransition(record, { mode: 'example' })
      : verifyWithProductionRegistry(record, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok && options.mode === 'example') {
    process.stdout.write(
      'Inert balance-consumer metadata transition example validation passed.\nReady for authorized plan: false.\nExternal calls made: 0\nAWS calls made: 0\nDatabase connections made: 0\nRedis connections made: 0\nSecret values read: 0\nResources created: 0\nFiles written: 0\n',
    );
  } else if (report.ok && isProductionAuthorizedBalanceConsumerMetadataTransitionReport(report)) {
    process.stdout.write(
      `Signed balance-consumer metadata ${options.mode} validation passed.\nReady for separately authorized plan: true.\nExternal calls made: 0\nAWS calls made: 0\nDatabase connections made: 0\nRedis connections made: 0\nSecret values read: 0\nResources created: 0\nFiles written: 0\n`,
    );
  } else {
    fixedFailure('No production balance-consumer metadata transition authority was granted.');
  }
  process.exitCode =
    options.mode === 'example'
      ? report.ok
        ? 0
        : 1
      : report.ok && isProductionAuthorizedBalanceConsumerMetadataTransitionReport(report)
        ? 0
        : 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
