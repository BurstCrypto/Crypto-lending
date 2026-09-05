#!/usr/bin/env node

/**
 * Offline validation for the shared authentication/wallet secret VersionId.
 *
 * This module intentionally has no subprocess, AWS, database, Redis, socket,
 * DNS, HTTP, secret-read, or filesystem-write capability. Operational records
 * require two Ed25519 signatures from the checked-in production authority
 * registry. That registry is deliberately empty until separately reviewed
 * public keys are added in source control.
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

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..', '..');
export const LOCAL_AUTH_WALLET_TRANSITION_ROOT = join(REPOSITORY_ROOT, '.local-validation');
export const DEFAULT_AUTH_WALLET_TRANSITION_RECORD = join(
  scriptDirectory,
  'auth-wallet-secret-version-transition.example.json',
);

export const MAX_AUTH_WALLET_TRANSITION_RECORD_BYTES = 262_144;
export const MAX_AUTH_WALLET_VERSION_HISTORY = 64;
export const AUTH_WALLET_TRANSITION_INPUT_ERROR =
  'Auth/wallet secret transition record must be a bounded, canonical, stable, single-link local JSON file in the approved ignored location.';
export const AUTH_WALLET_TRANSITION_ARGUMENT_ERROR =
  'Usage: validate-auth-wallet-secret-version-transition.mjs [--record <local-file>] [--mode <example|create|adopt|transition>] [--at <UTC-instant>] [--expected-account <id>] [--expected-region <region>] [--expected-stack <name>] [--expected-stack-id <arn>] [--expected-environment <name>] [--expected-parent-template-sha256 <sha256>] [--expected-workload-template-sha256 <sha256>] [--expected-secret-arn <arn>] [--expected-kms-key-arn <arn>] [--expected-current-version-id <id|NO_DEPLOYED_VERSION>] [--expected-target-version-id <id>] [--json].';

const SIGNING_DOMAIN = 'crypto-lending:auth-wallet-secret-version-transition:v1';
const RECORD_HASH_DOMAIN = 'crypto-lending:auth-wallet-secret-version-transition-record:v1';
const STATE_HASH_DOMAIN = 'crypto-lending:auth-wallet-secret-version-state:v1';
const AUTHORITY_REGISTRY_HASH_DOMAIN =
  'crypto-lending:auth-wallet-secret-version-transition-authority-registry:v1';
const DAY_MS = 86_400_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/u;
const AUTHORITY_KEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/u;
const RECORD_ID_PATTERN =
  /^auth-wallet\/(?:create|adopt|transition)\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u;
const APPROVAL_REFERENCE_PATTERNS = Object.freeze({
  secretCustodyApprovalRef:
    /^approval\/secret-custody\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  authenticationApprovalRef:
    /^approval\/authentication\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  walletApprovalRef: /^approval\/wallet\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  deploymentApprovalRef: /^approval\/deployment\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  rollbackApprovalRef: /^approval\/rollback\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
});
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u;
const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/u;
const STACK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export const AUTH_WALLET_SECRET_FIELDS = Object.freeze([
  'AUTH_PREAUTH_SEAL_KEY',
  'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
  'AUTH_SESSION_HMAC_KEY_RING_JSON',
  'AUTH_CSRF_HMAC_KEY_RING_JSON',
  'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
  'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
  'WALLET_METADATA_SEAL_KEY_RING_JSON',
]);

const RING_PURPOSES = Object.freeze({
  AUTH_IDENTITY_HMAC_KEY_RING_JSON: 'AUTH_IDENTITY_HMAC',
  AUTH_SESSION_HMAC_KEY_RING_JSON: 'AUTH_SESSION_HMAC',
  AUTH_CSRF_HMAC_KEY_RING_JSON: 'AUTH_CSRF_HMAC',
  WALLET_IDENTITY_HMAC_KEY_RING_JSON: 'WALLET_IDENTITY_HMAC',
  WALLET_CHALLENGE_HMAC_KEY_RING_JSON: 'WALLET_CHALLENGE_HMAC',
  WALLET_METADATA_SEAL_KEY_RING_JSON: 'WALLET_METADATA_SEAL',
});
const KEY_ID_PREFIXES = Object.freeze({
  AUTH_IDENTITY_HMAC_KEY_RING_JSON: 'identity_v',
  AUTH_SESSION_HMAC_KEY_RING_JSON: 'session_v',
  AUTH_CSRF_HMAC_KEY_RING_JSON: 'csrf_v',
  WALLET_IDENTITY_HMAC_KEY_RING_JSON: 'wallet-identity-v',
  WALLET_CHALLENGE_HMAC_KEY_RING_JSON: 'wallet-challenge-v',
  WALLET_METADATA_SEAL_KEY_RING_JSON: 'wallet-metadata-v',
});
const AUTH_RING_FIELDS = new Set([
  'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
  'AUTH_SESSION_HMAC_KEY_RING_JSON',
  'AUTH_CSRF_HMAC_KEY_RING_JSON',
]);
const WALLET_RING_FIELDS = new Set([
  'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
  'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
  'WALLET_METADATA_SEAL_KEY_RING_JSON',
]);
const AUTH_ACTIONS = new Set([
  'STAGE_SUCCESSOR',
  'ACTIVATE_SUCCESSOR',
  'ABORT_STAGED_SUCCESSOR',
  'RETIRE_PREDECESSOR',
]);
const WALLET_ACTIONS = new Set(['ADD_AND_ACTIVATE_SUCCESSOR', 'RETIRE_PREDECESSOR']);

const SIGNER_ROLES = Object.freeze([
  'AUTH_WALLET_TRANSITION_ISSUER',
  'INDEPENDENT_AUTH_WALLET_TRANSITION_VERIFIER',
]);
const SIGNER_SCOPE = 'AUTH_WALLET_SECRET_VERSION_TRANSITION';

const EVIDENCE_KEYS = Object.freeze([
  'currentDeploymentCaptureSha256',
  'currentManifestSha256',
  'targetManifestSha256',
  'outerVersionInventorySha256',
  'preauthCarryForwardSha256',
  'unchangedFieldsCarryForwardSha256',
  'purposeTransitionSha256',
  'databasePolicyCompatibilitySha256',
  'legacyFunctionDenialSha256',
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
    'requiredSecretFields',
    'evidence',
    'approvals',
  ],
  deployment: [
    'accountId',
    'region',
    'stackName',
    'stackId',
    'environmentName',
    'parentTemplateSha256',
    'workloadTemplateSha256',
  ],
  operation: ['kind', 'fieldName', 'action'],
  predecessor: ['stateSha256', 'transitionSha256'],
  state: ['secretArn', 'kmsKeyArn', 'currentVersionId', 'usedVersionIds', 'manifest'],
  preauthManifest: ['presence'],
  ring: ['purpose', 'activeWriteVersion', 'keys', 'usedKeys', 'retiredOrBurnedKeys'],
  key: ['keyId', 'version'],
  approvals: [
    'secretCustodyApprovalRef',
    'authenticationApprovalRef',
    'walletApprovalRef',
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
  'expectedParentTemplateSha256',
  'expectedWorkloadTemplateSha256',
  'expectedSecretArn',
  'expectedKmsKeyArn',
  'expectedCurrentVersionId',
  'expectedTargetVersionId',
]);

const ZERO_CALLS = Object.freeze({
  externalCallsMade: 0,
  awsCallsMade: 0,
  databaseConnectionsMade: 0,
  redisConnectionsMade: 0,
  dnsQueriesMade: 0,
  httpRequestsMade: 0,
  resourcesCreated: 0,
  credentialBytesRead: 0,
  filesWritten: 0,
});

/** Production authority is intentionally empty and can change only by review. */
export const AUTH_WALLET_TRANSITION_AUTHORITY_KEY_REGISTRY = deepFreeze({
  schemaVersion: 1,
  artifactType: 'AUTH_WALLET_TRANSITION_AUTHORITY_KEY_REGISTRY',
  keys: [],
});

const PRODUCTION_AUTHORIZED_REPORTS = new WeakSet();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => [key, sortedJsonValue(value[key])]),
  );
}

export function canonicalizeAuthWalletTransitionValue(value) {
  return JSON.stringify(sortedJsonValue(value));
}

function hashDomain(domain, value) {
  return createHash('sha256').update(`${domain}\n${value}`, 'utf8').digest('hex');
}

export function authWalletTransitionStateSha256(state) {
  return hashDomain(STATE_HASH_DOMAIN, canonicalizeAuthWalletTransitionValue(state));
}

function recordSha256(record) {
  return hashDomain(RECORD_HASH_DOMAIN, canonicalizeAuthWalletTransitionValue(record));
}

function safeRecordSha256(record) {
  try {
    return recordSha256(record);
  } catch {
    return undefined;
  }
}

function assertExactKeys(value, expectedKeys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object.`);
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
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  return instant.toISOString().replace('.000Z', 'Z') === value ? instant : undefined;
}

function validateWindow(startValue, endValue, now, errors) {
  const start = canonicalInstant(startValue);
  const end = canonicalInstant(endValue);
  if (!start || !end || end <= start || end.getTime() - start.getTime() > DAY_MS) {
    errors.push('Record authority window must be canonical and at most 24 hours.');
    return { start, end };
  }
  if (start > now || end <= now) errors.push('Record authority window must be active now.');
  return { start, end };
}

function validateDeployment(deployment, options, errors) {
  if (!assertExactKeys(deployment, EXACT_KEYS.deployment, 'content.deployment', errors)) return;
  if (typeof deployment.accountId !== 'string' || !/^\d{12}$/u.test(deployment.accountId)) {
    errors.push('content.deployment.accountId must be an exact 12-digit account ID.');
  }
  if (typeof deployment.region !== 'string' || !REGION_PATTERN.test(deployment.region)) {
    errors.push('content.deployment.region must be an exact AWS Region.');
  }
  if (typeof deployment.stackName !== 'string' || !STACK_NAME_PATTERN.test(deployment.stackName)) {
    errors.push('content.deployment.stackName must be an exact stack name.');
  }
  if (
    typeof deployment.environmentName !== 'string' ||
    !ENVIRONMENT_PATTERN.test(deployment.environmentName)
  ) {
    errors.push('content.deployment.environmentName must be an exact reviewed environment.');
  }
  const partition = String(deployment.stackId).split(':')[1];
  const escapedRegion = String(deployment.region).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedAccount = String(deployment.accountId).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedStack = String(deployment.stackName).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const stackPattern = new RegExp(
    `^arn:(?:aws|aws-us-gov|aws-cn):cloudformation:${escapedRegion}:${escapedAccount}:stack/${escapedStack}/[A-Za-z0-9-]{8,64}$`,
    'u',
  );
  if (typeof deployment.stackId !== 'string' || !stackPattern.test(deployment.stackId)) {
    errors.push('content.deployment.stackId must bind the exact account, Region, and stack.');
  }
  if (!['aws', 'aws-us-gov', 'aws-cn'].includes(partition)) {
    errors.push('content.deployment.stackId must use a reviewed AWS partition.');
  }
  for (const key of ['parentTemplateSha256', 'workloadTemplateSha256']) {
    if (!SHA256_PATTERN.test(deployment[key] ?? '')) {
      errors.push(`content.deployment.${key} must be a lowercase SHA-256 binding.`);
    }
  }
  for (const [key, expected] of [
    ['accountId', options.expectedAccount],
    ['region', options.expectedRegion],
    ['stackName', options.expectedStack],
    ['stackId', options.expectedStackId],
    ['environmentName', options.expectedEnvironment],
    ['parentTemplateSha256', options.expectedParentTemplateSha256],
    ['workloadTemplateSha256', options.expectedWorkloadTemplateSha256],
  ]) {
    if (expected !== undefined && deployment[key] !== expected) {
      errors.push(`content.deployment.${key} does not match the expected deployment identity.`);
    }
  }
}

function validateKeyEntry(entry, label, errors) {
  if (!assertExactKeys(entry, EXACT_KEYS.key, label, errors)) return false;
  if (typeof entry.keyId !== 'string' || entry.keyId.length > 64) {
    errors.push(`${label}.keyId must be a bounded non-secret key identifier.`);
  }
  if (!Number.isSafeInteger(entry.version) || entry.version < 1 || entry.version > 2_147_483_647) {
    errors.push(`${label}.version must be a bounded positive integer.`);
  }
  return true;
}

function keyIdentity(entry) {
  return `${entry?.version ?? ''}\u0000${entry?.keyId ?? ''}`;
}

function validateOrderedUniqueEntries(entries, minimum, maximum, label, errors) {
  if (!Array.isArray(entries) || entries.length < minimum || entries.length > maximum) {
    errors.push(`${label} must contain between ${minimum} and ${maximum} entries.`);
    return false;
  }
  let previousVersion = 0;
  const identities = new Set();
  let valid = true;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    valid = validateKeyEntry(entry, `${label}[${index}]`, errors) && valid;
    if (
      !Number.isSafeInteger(entry?.version) ||
      entry.version <= previousVersion ||
      identities.has(keyIdentity(entry))
    ) {
      errors.push(`${label} must use strictly increasing unique version/key identities.`);
      valid = false;
    }
    previousVersion = entry?.version ?? previousVersion;
    identities.add(keyIdentity(entry));
  }
  return valid;
}

function validateRing(ring, fieldName, label, errors) {
  if (!assertExactKeys(ring, EXACT_KEYS.ring, label, errors)) return;
  if (ring.purpose !== RING_PURPOSES[fieldName]) {
    errors.push(`${label}.purpose does not match its exact secret field.`);
  }
  validateOrderedUniqueEntries(ring.keys, 1, 3, `${label}.keys`, errors);
  validateOrderedUniqueEntries(
    ring.usedKeys,
    1,
    MAX_AUTH_WALLET_VERSION_HISTORY,
    `${label}.usedKeys`,
    errors,
  );
  for (const [historyName, entries] of [
    ['keys', ring.keys],
    ['usedKeys', ring.usedKeys],
    ['retiredOrBurnedKeys', ring.retiredOrBurnedKeys],
  ]) {
    if (
      Array.isArray(entries) &&
      entries.some((entry) => entry?.keyId !== `${KEY_ID_PREFIXES[fieldName]}${entry?.version}`)
    ) {
      errors.push(
        `${label}.${historyName} must use only the purpose-bound non-secret key ID form.`,
      );
    }
  }
  validateOrderedUniqueEntries(
    ring.retiredOrBurnedKeys,
    0,
    MAX_AUTH_WALLET_VERSION_HISTORY,
    `${label}.retiredOrBurnedKeys`,
    errors,
  );
  const keys = new Set(Array.isArray(ring.keys) ? ring.keys.map(keyIdentity) : []);
  const used = new Set(Array.isArray(ring.usedKeys) ? ring.usedKeys.map(keyIdentity) : []);
  const retired = new Set(
    Array.isArray(ring.retiredOrBurnedKeys) ? ring.retiredOrBurnedKeys.map(keyIdentity) : [],
  );
  if ([...keys].some((identity) => !used.has(identity))) {
    errors.push(`${label}.keys must be a subset of its append-only usedKeys history.`);
  }
  if ([...retired].some((identity) => !used.has(identity) || keys.has(identity))) {
    errors.push(`${label}.retiredOrBurnedKeys must be a disjoint subset of usedKeys.`);
  }
  if (used.size !== keys.size + retired.size) {
    errors.push(`${label}.usedKeys must be exactly partitioned into retained and retired entries.`);
  }
  if (
    !Number.isSafeInteger(ring.activeWriteVersion) ||
    !Array.isArray(ring.keys) ||
    !ring.keys.some((entry) => entry?.version === ring.activeWriteVersion)
  ) {
    errors.push(`${label}.activeWriteVersion must name one retained key.`);
  }
  if (Array.isArray(ring.keys) && ring.keys.length > 0) {
    const activeIndex = ring.keys.findIndex((entry) => entry?.version === ring.activeWriteVersion);
    if (WALLET_RING_FIELDS.has(fieldName) && activeIndex !== ring.keys.length - 1) {
      errors.push(`${label} wallet activeWriteVersion must be the highest retained version.`);
    }
    if (AUTH_RING_FIELDS.has(fieldName) && activeIndex < ring.keys.length - 2) {
      errors.push(`${label} auth ring may retain at most one staged successor.`);
    }
  }
}

function validateManifest(manifest, label, errors) {
  if (!assertExactKeys(manifest, AUTH_WALLET_SECRET_FIELDS, label, errors)) return;
  if (
    !assertExactKeys(
      manifest.AUTH_PREAUTH_SEAL_KEY,
      EXACT_KEYS.preauthManifest,
      `${label}.AUTH_PREAUTH_SEAL_KEY`,
      errors,
    ) ||
    manifest.AUTH_PREAUTH_SEAL_KEY?.presence !== 'PRESENT'
  ) {
    errors.push(`${label}.AUTH_PREAUTH_SEAL_KEY must record only exact presence.`);
  }
  const keyIds = [];
  for (const fieldName of Object.keys(RING_PURPOSES)) {
    const ring = manifest[fieldName];
    validateRing(ring, fieldName, `${label}.${fieldName}`, errors);
    if (Array.isArray(ring?.usedKeys)) keyIds.push(...ring.usedKeys.map((entry) => entry?.keyId));
  }
  if (keyIds.some((keyId) => typeof keyId !== 'string') || new Set(keyIds).size !== keyIds.length) {
    errors.push(`${label} must not reuse a keyId across any authentication or wallet purpose.`);
  }
}

function parseArnIdentity(arn, service, deployment) {
  if (typeof arn !== 'string' || arn.length > 2048 || arn.includes(':AWSCURRENT')) return false;
  const match = /^arn:([^:]+):([^:]+):([^:]+):(\d{12}):(.+)$/u.exec(arn);
  if (!match || match[2] !== service) return false;
  const [, partition, , region, accountId, resource] = match;
  if (!['aws', 'aws-us-gov', 'aws-cn'].includes(partition)) return false;
  if (partition !== String(deployment?.stackId).split(':')[1]) return false;
  if (region !== deployment?.region || accountId !== deployment?.accountId) return false;
  if (service === 'secretsmanager') {
    return /^secret:[A-Za-z0-9/_+=.@-]{1,512}$/u.test(resource);
  }
  return /^key\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(resource);
}

function validateState(state, deployment, label, errors) {
  if (!assertExactKeys(state, EXACT_KEYS.state, label, errors)) return;
  if (!parseArnIdentity(state.secretArn, 'secretsmanager', deployment)) {
    errors.push(
      `${label}.secretArn must be one selector-free secret ARN in the deployment account and Region.`,
    );
  }
  if (!parseArnIdentity(state.kmsKeyArn, 'kms', deployment)) {
    errors.push(
      `${label}.kmsKeyArn must be one customer-managed KMS key ARN in the deployment account and Region.`,
    );
  }
  if (!VERSION_ID_PATTERN.test(state.currentVersionId ?? '')) {
    errors.push(`${label}.currentVersionId must be one exact Secrets Manager VersionId.`);
  }
  if (
    !Array.isArray(state.usedVersionIds) ||
    state.usedVersionIds.length < 1 ||
    state.usedVersionIds.length > MAX_AUTH_WALLET_VERSION_HISTORY ||
    state.usedVersionIds.some(
      (value) => typeof value !== 'string' || !VERSION_ID_PATTERN.test(value),
    ) ||
    new Set(state.usedVersionIds).size !== state.usedVersionIds.length ||
    state.currentVersionId !== state.usedVersionIds.at(-1)
  ) {
    errors.push(`${label} must bind its current exact version to a unique append-only history.`);
  }
  validateManifest(state.manifest, `${label}.manifest`, errors);
}

function entriesEqual(left, right) {
  return isDeepStrictEqual(left, right);
}

function appendOne(current, target) {
  return (
    Array.isArray(current) &&
    Array.isArray(target) &&
    target.length === current.length + 1 &&
    current.every((entry, index) => entriesEqual(entry, target[index]))
  );
}

function removeExactlyOne(current, target) {
  if (!Array.isArray(current) || !Array.isArray(target) || target.length !== current.length - 1) {
    return undefined;
  }
  const removed = current.filter(
    (candidate) => !target.some((targetEntry) => entriesEqual(candidate, targetEntry)),
  );
  return removed.length === 1 ? removed[0] : undefined;
}

function classifyRingTransition(current, target, fieldName, action, errors) {
  const commonExact =
    current?.purpose === target?.purpose &&
    entriesEqual(current?.retiredOrBurnedKeys, target?.retiredOrBurnedKeys);
  if (action === 'STAGE_SUCCESSOR') {
    if (
      !AUTH_RING_FIELDS.has(fieldName) ||
      !commonExact ||
      current.activeWriteVersion !== target.activeWriteVersion ||
      current.activeWriteVersion !== current.keys?.at(-1)?.version ||
      !appendOne(current.keys, target.keys) ||
      !appendOne(current.usedKeys, target.usedKeys) ||
      !entriesEqual(target.keys?.at(-1), target.usedKeys?.at(-1))
    ) {
      errors.push('STAGE_SUCCESSOR must append one inactive fresh key to one auth ring.');
    }
    return;
  }
  if (action === 'ADD_AND_ACTIVATE_SUCCESSOR') {
    if (
      !WALLET_RING_FIELDS.has(fieldName) ||
      !commonExact ||
      !appendOne(current.keys, target.keys) ||
      !appendOne(current.usedKeys, target.usedKeys) ||
      !entriesEqual(target.keys?.at(-1), target.usedKeys?.at(-1)) ||
      target.activeWriteVersion !== target.keys?.at(-1)?.version ||
      target.activeWriteVersion <= current.activeWriteVersion
    ) {
      errors.push(
        'ADD_AND_ACTIVATE_SUCCESSOR must append and activate one fresh key in one wallet ring.',
      );
    }
    return;
  }
  if (action === 'ACTIVATE_SUCCESSOR') {
    if (
      !AUTH_RING_FIELDS.has(fieldName) ||
      current?.purpose !== target?.purpose ||
      !entriesEqual(current.keys, target.keys) ||
      !entriesEqual(current.usedKeys, target.usedKeys) ||
      !entriesEqual(current.retiredOrBurnedKeys, target.retiredOrBurnedKeys) ||
      current.keys?.filter((entry) => entry?.version > current.activeWriteVersion).length !== 1 ||
      target.activeWriteVersion !== target.keys?.at(-1)?.version ||
      target.activeWriteVersion <= current.activeWriteVersion ||
      !target.keys?.some((entry) => entry?.version === target.activeWriteVersion)
    ) {
      errors.push(
        'ACTIVATE_SUCCESSOR must activate one already-staged successor in one auth ring.',
      );
    }
    return;
  }
  if (action === 'ABORT_STAGED_SUCCESSOR') {
    const removed = removeExactlyOne(current?.keys, target?.keys);
    if (
      !AUTH_RING_FIELDS.has(fieldName) ||
      current?.purpose !== target?.purpose ||
      current?.activeWriteVersion !== target?.activeWriteVersion ||
      current?.keys?.filter((entry) => entry?.version > current.activeWriteVersion).length !== 1 ||
      removed?.version !== current?.keys?.at(-1)?.version ||
      removed?.version <= current?.activeWriteVersion ||
      !entriesEqual(current?.usedKeys, target?.usedKeys) ||
      !appendOne(current?.retiredOrBurnedKeys, target?.retiredOrBurnedKeys) ||
      !entriesEqual(removed, target?.retiredOrBurnedKeys?.at(-1))
    ) {
      errors.push(
        'ABORT_STAGED_SUCCESSOR must burn exactly the sole inactive staged auth successor.',
      );
    }
    return;
  }
  if (action === 'RETIRE_PREDECESSOR') {
    const removed = removeExactlyOne(current?.keys, target?.keys);
    if (
      (!AUTH_RING_FIELDS.has(fieldName) && !WALLET_RING_FIELDS.has(fieldName)) ||
      current?.purpose !== target?.purpose ||
      current?.activeWriteVersion !== target?.activeWriteVersion ||
      !entriesEqual(current?.usedKeys, target?.usedKeys) ||
      !appendOne(current?.retiredOrBurnedKeys, target?.retiredOrBurnedKeys) ||
      !entriesEqual(removed, target?.retiredOrBurnedKeys?.at(-1)) ||
      removed?.version >= target.activeWriteVersion
    ) {
      errors.push('RETIRE_PREDECESSOR must retire exactly one inactive predecessor key.');
    }
  }
}

function validateOperation(content, mode, errors) {
  const operation = content.operation;
  if (!assertExactKeys(operation, EXACT_KEYS.operation, 'content.operation', errors)) return;
  if (mode === 'create') {
    if (
      operation.kind !== 'CREATE' ||
      operation.fieldName !== 'ALL_SEVEN_FIELDS' ||
      operation.action !== 'INITIAL_BINDING' ||
      content.currentState !== null ||
      content.predecessor?.stateSha256 !== 'NO_DEPLOYED_STATE' ||
      content.predecessor?.transitionSha256 !== 'NONE'
    ) {
      errors.push(
        'CREATE must establish one exact initial seven-field binding with no predecessor.',
      );
    }
    if (content.targetState?.usedVersionIds?.length !== 1) {
      errors.push('CREATE target must begin with exactly one outer secret VersionId.');
    }
    return;
  }
  if (mode === 'adopt') {
    if (
      operation.kind !== 'ADOPT' ||
      operation.fieldName !== 'ALL_SEVEN_FIELDS' ||
      operation.action !== 'ADOPT_EXISTING_BINDING' ||
      content.predecessor?.stateSha256 !== 'UNTRACKED' ||
      content.predecessor?.transitionSha256 !== 'NONE' ||
      !isDeepStrictEqual(content.currentState, content.targetState) ||
      content.currentState?.usedVersionIds?.length !== 1
    ) {
      errors.push('ADOPT must be a no-op binding adoption from explicit untracked markers.');
    }
    return;
  }
  if (
    operation.kind !== 'TRANSITION' ||
    (!AUTH_RING_FIELDS.has(operation.fieldName) && !WALLET_RING_FIELDS.has(operation.fieldName)) ||
    (AUTH_RING_FIELDS.has(operation.fieldName) && !AUTH_ACTIONS.has(operation.action)) ||
    (WALLET_RING_FIELDS.has(operation.fieldName) && !WALLET_ACTIONS.has(operation.action))
  ) {
    errors.push('TRANSITION must name one reviewed auth or wallet ring operation.');
    return;
  }
  const current = content.currentState;
  const target = content.targetState;
  if (
    content.predecessor?.stateSha256 !== authWalletTransitionStateSha256(current) ||
    !SHA256_PATTERN.test(content.predecessor?.transitionSha256 ?? '')
  ) {
    errors.push('Transition predecessor must bind the exact current state and prior transition.');
  }
  if (
    current?.secretArn !== target?.secretArn ||
    current?.kmsKeyArn !== target?.kmsKeyArn ||
    !appendOne(current?.usedVersionIds, target?.usedVersionIds) ||
    target?.currentVersionId !== target?.usedVersionIds?.at(-1)
  ) {
    errors.push(
      'Transition may append only one fresh outer VersionId under the same secret and KMS key.',
    );
  }
  const changedFields = AUTH_WALLET_SECRET_FIELDS.filter(
    (fieldName) =>
      !isDeepStrictEqual(current?.manifest?.[fieldName], target?.manifest?.[fieldName]),
  );
  if (changedFields.length !== 1 || changedFields[0] !== operation.fieldName) {
    errors.push('Transition must change exactly the one declared inner-purpose manifest.');
    return;
  }
  classifyRingTransition(
    current?.manifest?.[operation.fieldName],
    target?.manifest?.[operation.fieldName],
    operation.fieldName,
    operation.action,
    errors,
  );
}

function validateEvidence(evidence, mode, operation, errors) {
  if (!assertExactKeys(evidence, EVIDENCE_KEYS, 'content.evidence', errors)) return;
  const required = new Set();
  if (mode === 'create') {
    for (const key of [
      'targetManifestSha256',
      'outerVersionInventorySha256',
      'databasePolicyCompatibilitySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ])
      required.add(key);
  } else if (mode === 'adopt') {
    for (const key of [
      'currentDeploymentCaptureSha256',
      'currentManifestSha256',
      'outerVersionInventorySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ])
      required.add(key);
  } else {
    for (const key of [
      'currentDeploymentCaptureSha256',
      'currentManifestSha256',
      'targetManifestSha256',
      'outerVersionInventorySha256',
      'preauthCarryForwardSha256',
      'unchangedFieldsCarryForwardSha256',
      'purposeTransitionSha256',
      'databasePolicyCompatibilitySha256',
      'candidateTaskReadinessSha256',
      'taskReplacementPlanSha256',
      'rollbackPlanSha256',
    ])
      required.add(key);
    if (
      AUTH_RING_FIELDS.has(operation?.fieldName) &&
      operation?.action !== 'ABORT_STAGED_SUCCESSOR'
    )
      required.add('legacyFunctionDenialSha256');
    if (operation?.action === 'RETIRE_PREDECESSOR') required.add('retirementReadinessSha256');
  }
  const hashes = [];
  for (const key of EVIDENCE_KEYS) {
    if (required.has(key)) {
      if (!SHA256_PATTERN.test(evidence[key] ?? '')) {
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

function validateExpectedBindings(content, options, mode, errors) {
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

function validateContent(content, mode, options, errors) {
  if (!assertExactKeys(content, EXACT_KEYS.content, 'content', errors)) return;
  if (content.status !== 'APPROVED') errors.push('Operational content.status must be APPROVED.');
  if (typeof content.recordId !== 'string' || !RECORD_ID_PATTERN.test(content.recordId)) {
    errors.push('content.recordId must be a bounded non-secret reference.');
  }
  validateWindow(content.issuedAt, content.expiresAt, options.now, errors);
  validateDeployment(content.deployment, options, errors);
  if (
    !assertExactKeys(content.predecessor, EXACT_KEYS.predecessor, 'content.predecessor', errors)
  ) {
    // Exact-key error is sufficient.
  }
  if (
    !Array.isArray(content.requiredSecretFields) ||
    !isDeepStrictEqual(content.requiredSecretFields, AUTH_WALLET_SECRET_FIELDS)
  ) {
    errors.push(
      'content.requiredSecretFields must list the exact seven shared-secret fields in order.',
    );
  }
  if (mode === 'create') {
    if (content.currentState !== null) errors.push('CREATE currentState must be null.');
  } else {
    validateState(content.currentState, content.deployment, 'content.currentState', errors);
  }
  validateState(content.targetState, content.deployment, 'content.targetState', errors);
  validateOperation(content, mode, errors);
  validateEvidence(content.evidence, mode, content.operation, errors);
  validateApprovals(content.approvals, errors);
  validateExpectedBindings(content, options, mode, errors);
}

function validateExample(record, errors) {
  if (!assertExactKeys(record, EXACT_KEYS.root, 'record', errors)) return;
  if (
    record.schemaVersion !== 1 ||
    record.artifactType !== 'AUTH_WALLET_SECRET_VERSION_TRANSITION'
  ) {
    errors.push('Example must preserve the schema-v1 auth/wallet artifact identity.');
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
    !Array.isArray(record.signatures) ||
    record.signatures.length !== 0
  ) {
    errors.push('Example must remain inert, unsigned, and NOT_AUTHORIZED.');
  }
  if (!isDeepStrictEqual(content.requiredSecretFields, AUTH_WALLET_SECRET_FIELDS)) {
    errors.push('Example must retain the exact seven public field names.');
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
    content.predecessor.transitionSha256 !== 'NONE'
  ) {
    errors.push('Example predecessor must remain untracked.');
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
  if (bytes.toString('base64') !== value || bytes.length !== expectedBytes)
    throw new Error('invalid');
  return bytes;
}

function parseRegistry(registry) {
  if (!assertExactKeys(registry, EXACT_KEYS.registry, 'registry', [])) throw new Error('invalid');
  if (
    registry.schemaVersion !== 1 ||
    registry.artifactType !== 'AUTH_WALLET_TRANSITION_AUTHORITY_KEY_REGISTRY' ||
    !Array.isArray(registry.keys) ||
    registry.keys.length > 16
  )
    throw new Error('invalid');
  const ids = new Set();
  const publicKeyHashes = new Set();
  const keys = registry.keys.map((candidate) => {
    if (!assertExactKeys(candidate, EXACT_KEYS.authorityKey, 'authority key', [])) {
      throw new Error('invalid');
    }
    if (
      typeof candidate.keyId !== 'string' ||
      !AUTHORITY_KEY_ID_PATTERN.test(candidate.keyId) ||
      ids.has(candidate.keyId) ||
      candidate.algorithm !== 'Ed25519' ||
      candidate.status !== 'APPROVED' ||
      !SIGNER_ROLES.includes(candidate.role) ||
      candidate.scope !== SIGNER_SCOPE ||
      typeof candidate.approvalReferenceId !== 'string' ||
      !REFERENCE_PATTERN.test(candidate.approvalReferenceId)
    )
      throw new Error('invalid');
    const validFrom = canonicalInstant(candidate.validFrom);
    const validUntil = canonicalInstant(candidate.validUntil);
    if (!validFrom || !validUntil || validUntil <= validFrom) throw new Error('invalid');
    const der = canonicalBase64(candidate.publicKeySpkiDerBase64, 44);
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
      AUTHORITY_REGISTRY_HASH_DOMAIN,
      canonicalizeAuthWalletTransitionValue(registry),
    ),
  };
}

function parseSignatures(signatures) {
  if (!Array.isArray(signatures) || signatures.length !== SIGNER_ROLES.length) {
    throw new Error('invalid');
  }
  const ids = new Set();
  return signatures.map((candidate, index) => {
    if (!assertExactKeys(candidate, EXACT_KEYS.signature, 'signature', []))
      throw new Error('invalid');
    if (
      candidate.role !== SIGNER_ROLES[index] ||
      candidate.scope !== SIGNER_SCOPE ||
      typeof candidate.authorityKeyId !== 'string' ||
      !AUTHORITY_KEY_ID_PATTERN.test(candidate.authorityKeyId) ||
      ids.has(candidate.authorityKeyId) ||
      candidate.algorithm !== 'Ed25519'
    )
      throw new Error('invalid');
    canonicalBase64(candidate.valueBase64, 64);
    ids.add(candidate.authorityKeyId);
    return candidate;
  });
}

export function authWalletSecretVersionTransitionSigningBytes(unsignedRecord) {
  if (!assertExactKeys(unsignedRecord, EXACT_KEYS.unsignedRoot, 'unsigned record', [])) {
    throw new Error('Invalid auth/wallet transition signing input.');
  }
  if (
    unsignedRecord.schemaVersion !== 1 ||
    unsignedRecord.artifactType !== 'AUTH_WALLET_SECRET_VERSION_TRANSITION'
  )
    throw new Error('Invalid auth/wallet transition signing input.');
  return Buffer.from(
    `${SIGNING_DOMAIN}\n${canonicalizeAuthWalletTransitionValue(unsignedRecord)}`,
    'utf8',
  );
}

function planFor(content, mode) {
  return deepFreeze({
    kind: 'LOCAL_ONLY_NON_EXECUTABLE_AUTH_WALLET_VERSION_PLAN',
    operation: content.operation.action,
    fieldName: content.operation.fieldName,
    versionParameter: 'AuthWalletKeysSecretVersionId',
    currentVersionId:
      mode === 'create' ? 'NO_DEPLOYED_VERSION' : content.currentState.currentVersionId,
    targetVersionId: content.targetState.currentVersionId,
    executionAllowed: false,
    separateAuthorizationRequired: true,
    steps: [
      'VERIFY_SIGNED_SANITIZED_CURRENT_AND_TARGET_MANIFESTS',
      'VERIFY_PREAUTH_AND_ALL_UNCHANGED_FIELDS_ARE_CARRIED_FORWARD',
      'REPLACE_ONLY_API_TASKS_WITH_THE_EXACT_TARGET_OUTER_VERSION',
      'DRAIN_THE_PREDECESSOR_TASK_SET_BEFORE_ANY_INNER_KEY_RETIREMENT',
      'PRESERVE_THE_SIGNED_ROLLBACK_VERSION_AND_PLAN',
    ],
    prohibitions: [
      'NO_SECRET_OR_KEY_MATERIAL',
      'NO_SECRET_VALUE_HASHES',
      'NO_FIXED_SLOT_OR_REDIS_STATE',
      'NO_AWS_CALLS',
      'NO_DATABASE_CONNECTIONS',
      'NO_REDIS_CONNECTIONS',
      'NO_NETWORK_OR_DNS',
      'NO_RESOURCE_MUTATION',
      'NO_FILE_WRITES',
    ],
  });
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

function validateRecordStructure(record, options) {
  const mode = options.mode ?? 'example';
  const errors = [];
  const operational = ['create', 'adopt', 'transition'].includes(mode);
  if (!['example', 'create', 'adopt', 'transition'].includes(mode)) {
    errors.push('Validation mode must be example, create, adopt, or transition.');
  }
  if (operational && (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime())))
    errors.push('Operational validation requires an explicit valid validation instant.');
  if (
    operational &&
    EXPECTED_OPTION_KEYS.some(
      (key) => typeof options[key] !== 'string' || options[key].length === 0,
    )
  )
    errors.push('Operational validation requires every expected deployment and version binding.');
  if (!assertExactKeys(record, EXACT_KEYS.root, 'record', errors)) {
    return { mode, operational, errors };
  }
  if (record.schemaVersion !== 1) errors.push('record.schemaVersion must be 1.');
  if (record.artifactType !== 'AUTH_WALLET_SECRET_VERSION_TRANSITION') {
    errors.push('record.artifactType must be AUTH_WALLET_SECRET_VERSION_TRANSITION.');
  }
  if (mode === 'example') {
    validateExample(record, errors);
  } else {
    validateContent(record.content, mode, options, errors);
  }
  return { mode, operational, errors };
}

function verifyRecord(record, options, registry, production) {
  let structural;
  try {
    structural = validateRecordStructure(record, options ?? {});
  } catch {
    return baseFailureReport(options?.mode, [
      'Auth/wallet transition structure is malformed or non-canonical.',
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
      const signingBytes = authWalletSecretVersionTransitionSigningBytes(unsigned);
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
        )
          throw new Error('invalid');
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
    fieldName: ok && structural.operational ? record.content.operation.fieldName : undefined,
    predecessorTransitionSha256:
      ok && structural.operational ? record.content.predecessor.transitionSha256 : undefined,
    canonicalSha256: safeRecordSha256(record),
    currentStateSha256:
      ok && structural.operational
        ? structural.mode === 'create'
          ? 'NO_DEPLOYED_STATE'
          : authWalletTransitionStateSha256(record.content.currentState)
        : undefined,
    targetStateSha256:
      ok && structural.operational
        ? authWalletTransitionStateSha256(record.content.targetState)
        : undefined,
    authorityRegistrySha256: ok && signatureValidated ? registrySha256 : undefined,
    plan: ok && structural.operational ? planFor(record.content, structural.mode) : undefined,
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

/** Structural/example validation never confers operational authority. */
export function validateAuthWalletSecretVersionTransition(record, options = {}) {
  if ((options.mode ?? 'example') === 'example') {
    let structural;
    try {
      structural = validateRecordStructure(record, { ...options, mode: 'example' });
    } catch {
      return baseFailureReport('example', [
        'Auth/wallet transition structure is malformed or non-canonical.',
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
      canonicalSha256: safeRecordSha256(record),
      errors: structural.errors,
      ...ZERO_CALLS,
    });
  }
  return baseFailureReport(options.mode, [
    'Operational records require verification through the production authority path.',
  ]);
}

/** Test-only cryptographic seam. Its result is deliberately never production-branded. */
export function verifyAuthWalletSecretVersionTransitionWithTestRegistry(
  record,
  options,
  authorityRegistry,
) {
  return verifyRecord(record, options, authorityRegistry, false);
}

export function isProductionAuthorizedAuthWalletTransitionReport(report) {
  return isPlainObject(report) && PRODUCTION_AUTHORIZED_REPORTS.has(report);
}

function verifyWithProductionRegistry(record, options) {
  return verifyRecord(record, options, AUTH_WALLET_TRANSITION_AUTHORITY_KEY_REGISTRY, true);
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
    if (comparablePath(resolvedPath) !== comparablePath(DEFAULT_AUTH_WALLET_TRANSITION_RECORD)) {
      throw new Error(AUTH_WALLET_TRANSITION_INPUT_ERROR);
    }
    return resolvedPath;
  }
  if (
    !pathWithin(LOCAL_AUTH_WALLET_TRANSITION_ROOT, resolvedPath) ||
    !resolvedPath.toLowerCase().endsWith('.auth-wallet-transition.local.json')
  )
    throw new Error(AUTH_WALLET_TRANSITION_INPUT_ERROR);
  return resolvedPath;
}

function loadRecordInternal(recordPath, mode, afterFirstReadForTest) {
  try {
    const resolvedPath = assertRecordLocation(recordPath, mode);
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(resolvedPath, MAX_AUTH_WALLET_TRANSITION_RECORD_BYTES)
        : readSecureLocalFileForTest(
            resolvedPath,
            MAX_AUTH_WALLET_TRANSITION_RECORD_BYTES,
            afterFirstReadForTest,
          );
    const record = parseStrictJsonBytes(bytes);
    if (mode !== 'example') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (canonicalizeAuthWalletTransitionValue(record) !== text) {
        throw new Error(AUTH_WALLET_TRANSITION_INPUT_ERROR);
      }
    }
    return record;
  } catch {
    throw new Error(AUTH_WALLET_TRANSITION_INPUT_ERROR);
  }
}

export function loadAuthWalletSecretVersionTransitionRecord(recordPath, mode) {
  return loadRecordInternal(recordPath, mode, undefined);
}

/** Test-only fault seam; production callers use the stable loader above. */
export function loadAuthWalletSecretVersionTransitionRecordForTest(
  recordPath,
  mode,
  afterFirstReadForTest,
) {
  return loadRecordInternal(recordPath, mode, afterFirstReadForTest);
}

function parseArguments(argv) {
  const options = { record: DEFAULT_AUTH_WALLET_TRANSITION_RECORD, mode: 'example', json: false };
  const valueArguments = new Map([
    ['--record', 'record'],
    ['--mode', 'mode'],
    ['--at', 'at'],
    ['--expected-account', 'expectedAccount'],
    ['--expected-region', 'expectedRegion'],
    ['--expected-stack', 'expectedStack'],
    ['--expected-stack-id', 'expectedStackId'],
    ['--expected-environment', 'expectedEnvironment'],
    ['--expected-parent-template-sha256', 'expectedParentTemplateSha256'],
    ['--expected-workload-template-sha256', 'expectedWorkloadTemplateSha256'],
    ['--expected-secret-arn', 'expectedSecretArn'],
    ['--expected-kms-key-arn', 'expectedKmsKeyArn'],
    ['--expected-current-version-id', 'expectedCurrentVersionId'],
    ['--expected-target-version-id', 'expectedTargetVersionId'],
  ]);
  const operationalArguments = [...valueArguments.keys()].filter(
    (argument) => !['--record', '--mode'].includes(argument),
  );
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (seen.has(argument)) throw new Error(AUTH_WALLET_TRANSITION_ARGUMENT_ERROR);
      seen.add(argument);
      options.json = true;
      continue;
    }
    if (!valueArguments.has(argument) || seen.has(argument)) {
      throw new Error(AUTH_WALLET_TRANSITION_ARGUMENT_ERROR);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(AUTH_WALLET_TRANSITION_ARGUMENT_ERROR);
    seen.add(argument);
    options[valueArguments.get(argument)] = value;
    index += 1;
  }
  if (!['example', 'create', 'adopt', 'transition'].includes(options.mode)) {
    throw new Error(AUTH_WALLET_TRANSITION_ARGUMENT_ERROR);
  }
  if (options.mode === 'example') {
    if (operationalArguments.some((argument) => seen.has(argument))) {
      throw new Error(AUTH_WALLET_TRANSITION_ARGUMENT_ERROR);
    }
  } else if (
    !seen.has('--record') ||
    operationalArguments.some((argument) => !seen.has(argument)) ||
    !canonicalInstant(options.at)
  ) {
    throw new Error(AUTH_WALLET_TRANSITION_ARGUMENT_ERROR);
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
    fixedFailure(AUTH_WALLET_TRANSITION_ARGUMENT_ERROR);
    process.exitCode = 2;
    return;
  }
  let record;
  try {
    record = loadAuthWalletSecretVersionTransitionRecord(options.record, options.mode);
  } catch {
    fixedFailure(AUTH_WALLET_TRANSITION_INPUT_ERROR);
    process.exitCode = 2;
    return;
  }
  const report =
    options.mode === 'example'
      ? validateAuthWalletSecretVersionTransition(record, { mode: 'example' })
      : verifyWithProductionRegistry(record, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok && options.mode === 'example') {
    process.stdout.write(
      'Inert auth/wallet transition example validation passed.\nReady for authorized plan: false.\nExternal calls made: 0\nAWS calls made: 0\nDatabase connections made: 0\nRedis connections made: 0\nResources created: 0\nFiles written: 0\n',
    );
  } else if (report.ok && isProductionAuthorizedAuthWalletTransitionReport(report)) {
    process.stdout.write(
      `Signed auth/wallet ${options.mode} validation passed.\nReady for separately authorized plan: true.\nExternal calls made: 0\nAWS calls made: 0\nDatabase connections made: 0\nRedis connections made: 0\nResources created: 0\nFiles written: 0\n`,
    );
  } else {
    fixedFailure('No production auth/wallet transition authority was granted.');
  }
  process.exitCode =
    options.mode === 'example'
      ? report.ok
        ? 0
        : 1
      : report.ok && isProductionAuthorizedAuthWalletTransitionReport(report)
        ? 0
        : 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
