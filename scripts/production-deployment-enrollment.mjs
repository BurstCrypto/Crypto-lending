/**
 * Offline verification for independently signed post-provision target-identity
 * enrollment evidence. INERT_DEPLOYED is only a signed claim in this artifact,
 * not proof of live state. This module performs no I/O and grants no deployment,
 * state, chain-head, or external-state authority. A future consumer must match
 * every provision/reservation/result/source/release binding, require separate
 * live-state and CAS brands, and atomically consume the destination epoch/head.
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { TextDecoder, types as utilTypes } from 'node:util';

import { parseStrictJsonBytes } from '../infra/shared/parse-strict-json.mjs';
import { validateEd25519PublicKeyBytes } from '../infra/shared/validate-ed25519-public-key.mjs';
import {
  isVerifiedProductionDeploymentDestination,
  productionDeploymentTargetSha256,
  resolveProductionDeploymentDestination,
  resolveProductionDeploymentDestinationWithTestRegistry,
} from './production-deployment-target.mjs';

export const PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE =
  'PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_V1';
export const PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SIGNER_ROLES = Object.freeze([
  'DEPLOYMENT_OWNER',
  'INDEPENDENT_SECURITY',
]);
export const MAX_PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_BYTES = 131_072;

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT';
const SIGNING_DOMAIN =
  'crypto-lending:production-deployment-target-identity-enrollment-signature:v1';
const ENROLLMENT_HASH_DOMAIN = 'crypto-lending:production-deployment-target-identity-enrollment:v1';
const AUTHORITY_REGISTRY_HASH_DOMAIN =
  'crypto-lending:production-deployment-target-identity-enrollment-authority-registry:v1';
const MAX_ENROLLMENT_VALIDITY_MILLISECONDS = 15 * 60 * 1_000;
const MAX_OBSERVATION_AGE_MILLISECONDS = 5 * 60 * 1_000;
const MAX_KEY_VALIDITY_MILLISECONDS = 400 * 24 * 60 * 60 * 1_000;
const MAX_AUTHORITY_KEYS = 16;
const MAX_KEY_ID_LENGTH = 128;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u;
const KEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const READ_TRUSTED_TIME_MILLISECONDS = Date.now.bind(Date);
const READ_MONOTONIC_TIME_MILLISECONDS = performance.now.bind(performance);
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const EXACT_KEYS = Object.freeze({
  root: ['schemaVersion', 'artifactType', 'enrollmentSha256', 'content', 'signatures'],
  unsignedRoot: ['schemaVersion', 'artifactType', 'enrollmentSha256', 'content'],
  content: [
    'status',
    'enrollmentId',
    'observedAt',
    'issuedAt',
    'expiresAt',
    'destinationBinding',
    'provisionBinding',
    'targetBinding',
  ],
  destinationBinding: [
    'destinationId',
    'destinationSha256',
    'epochId',
    'destinationRegistrySha256',
  ],
  provisionBinding: [
    'operation',
    'sequence',
    'outcome',
    'intentSha256',
    'reservationSha256',
    'resultSha256',
    'sourceRevision',
    'releaseCandidateManifestSha256',
  ],
  targetBinding: ['deploymentTargetId', 'deploymentTargetSha256', 'target'],
  signer: ['role', 'scope', 'authorityKeyId', 'signedAt'],
  signature: ['role', 'scope', 'authorityKeyId', 'signedAt', 'algorithm', 'valueBase64'],
  registry: ['schemaVersion', 'artifactType', 'keys'],
  authorityKey: [
    'keyId',
    'role',
    'scope',
    'algorithm',
    'status',
    'publicKeySpkiDerBase64',
    'validFrom',
    'validUntil',
    'approvalReferenceId',
  ],
  testOptions: ['clockReadings', 'destinationRegistry', 'authorityKeyRegistry'],
  testClockReading: ['wallTime', 'monotonicMilliseconds'],
});

export const PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY =
  Object.freeze({
    schemaVersion: 1,
    artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY',
    keys: Object.freeze([]),
  });

const PRODUCTION_VERIFIED_ENROLLMENTS = new WeakSet();
const TEST_VERIFIED_ENROLLMENTS = new WeakSet();
const PRODUCTION_ENROLLMENT_FRESHNESS = new WeakMap();
const TEST_ENROLLMENT_FRESHNESS = new WeakMap();

export class ProductionDeploymentTargetIdentityEnrollmentInvalidError extends Error {
  constructor() {
    super('Production deployment target-identity enrollment is invalid');
    this.name = 'ProductionDeploymentTargetIdentityEnrollmentInvalidError';
  }
}

function invalid() {
  throw new ProductionDeploymentTargetIdentityEnrollmentInvalidError();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function dataRecord(value, expectedKeys) {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      utilTypes.isProxy(value)
    ) {
      return invalid();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid();
    }
    const result = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return invalid();
  }
}

function strictArray(value, maximumLength) {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      utilTypes.isProxy(value)
    ) {
      return invalid();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumLength ||
      Reflect.ownKeys(descriptors).length !== length + 1
    ) {
      return invalid();
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return invalid();
  }
}

function canonicalValue(value, seen) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return invalid();
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value) || utilTypes.isProxy(value)) return invalid();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${strictArray(value, 256)
        .map((entry) => canonicalValue(entry, seen))
        .join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 256 || keys.some((key) => typeof key !== 'string')) return invalid();
    return `{${keys
      .map(String)
      .sort()
      .map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
        return `${JSON.stringify(key)}:${canonicalValue(descriptor.value, seen)}`;
      })
      .join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeProductionDeploymentTargetIdentityEnrollmentValue(value) {
  try {
    return canonicalValue(value, new Set());
  } catch {
    return invalid();
  }
}

function domainHash(domain, value) {
  return createHash('sha256').update(`${domain}\n`, 'utf8').update(value, 'utf8').digest('hex');
}

function digest(value) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value) || /^0{64}$/u.test(value)) {
    return invalid();
  }
  return value;
}

function sourceRevision(value) {
  if (typeof value !== 'string' || !SOURCE_REVISION_PATTERN.test(value) || /^0{40}$/u.test(value)) {
    return invalid();
  }
  return value;
}

function boundedIdentifier(value, maximumLength = 192) {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function canonicalInstant(value) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return invalid();
  }
  return Object.freeze({ text: value, milliseconds });
}

function monotonicMilliseconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return invalid();
  return value;
}

function trustedClockReading() {
  try {
    const monotonic = monotonicMilliseconds(READ_MONOTONIC_TIME_MILLISECONDS());
    const wallMilliseconds = READ_TRUSTED_TIME_MILLISECONDS();
    if (!Number.isSafeInteger(wallMilliseconds) || wallMilliseconds < 0) return invalid();
    return Object.freeze({
      wall: canonicalInstant(new Date(wallMilliseconds).toISOString()),
      monotonicMilliseconds: monotonic,
    });
  } catch {
    return invalid();
  }
}

function testClockReading(value) {
  const parsed = dataRecord(value, EXACT_KEYS.testClockReading);
  return Object.freeze({
    wall: canonicalInstant(parsed.wallTime),
    monotonicMilliseconds: monotonicMilliseconds(parsed.monotonicMilliseconds),
  });
}

function testClockSequence(value) {
  const readings = strictArray(value, 2).map((reading) => testClockReading(reading));
  if (readings.length !== 2) return invalid();
  let index = 0;
  return () => readings[index++] ?? invalid();
}

function canonicalClone(value) {
  try {
    return deepFreeze(
      JSON.parse(canonicalizeProductionDeploymentTargetIdentityEnrollmentValue(value)),
    );
  } catch {
    return invalid();
  }
}

function destinationBinding(value) {
  const parsed = dataRecord(value, EXACT_KEYS.destinationBinding);
  return Object.freeze({
    destinationId: boundedIdentifier(parsed.destinationId, 96),
    destinationSha256: digest(parsed.destinationSha256),
    epochId: digest(parsed.epochId),
    destinationRegistrySha256: digest(parsed.destinationRegistrySha256),
  });
}

function provisionBinding(value) {
  const parsed = dataRecord(value, EXACT_KEYS.provisionBinding);
  if (
    parsed.operation !== 'PROVISION_INERT' ||
    parsed.sequence !== 1 ||
    parsed.outcome !== 'CLAIMED_INERT_DEPLOYED'
  ) {
    return invalid();
  }
  return Object.freeze({
    operation: 'PROVISION_INERT',
    sequence: 1,
    outcome: 'CLAIMED_INERT_DEPLOYED',
    intentSha256: digest(parsed.intentSha256),
    reservationSha256: digest(parsed.reservationSha256),
    resultSha256: digest(parsed.resultSha256),
    sourceRevision: sourceRevision(parsed.sourceRevision),
    releaseCandidateManifestSha256: digest(parsed.releaseCandidateManifestSha256),
  });
}

function targetBinding(value) {
  const parsed = dataRecord(value, EXACT_KEYS.targetBinding);
  const target = canonicalClone(parsed.target);
  const targetSha256 = productionDeploymentTargetSha256(target);
  if (
    typeof target.targetId !== 'string' ||
    parsed.deploymentTargetId !== target.targetId ||
    digest(parsed.deploymentTargetSha256) !== targetSha256
  ) {
    return invalid();
  }
  return deepFreeze({
    deploymentTargetId: boundedIdentifier(parsed.deploymentTargetId, 96),
    deploymentTargetSha256: targetSha256,
    target,
  });
}

function parsedContent(value) {
  const parsed = dataRecord(value, EXACT_KEYS.content);
  if (parsed.status !== 'TARGET_IDENTITY_ACCEPTED') return invalid();
  const observedAt = canonicalInstant(parsed.observedAt);
  const issuedAt = canonicalInstant(parsed.issuedAt);
  const expiresAt = canonicalInstant(parsed.expiresAt);
  if (
    observedAt.milliseconds > issuedAt.milliseconds ||
    issuedAt.milliseconds - observedAt.milliseconds > MAX_OBSERVATION_AGE_MILLISECONDS ||
    expiresAt.milliseconds <= issuedAt.milliseconds ||
    expiresAt.milliseconds - issuedAt.milliseconds > MAX_ENROLLMENT_VALIDITY_MILLISECONDS
  ) {
    return invalid();
  }
  return Object.freeze({
    value: deepFreeze({
      status: 'TARGET_IDENTITY_ACCEPTED',
      enrollmentId: boundedIdentifier(parsed.enrollmentId),
      observedAt: observedAt.text,
      issuedAt: issuedAt.text,
      expiresAt: expiresAt.text,
      destinationBinding: destinationBinding(parsed.destinationBinding),
      provisionBinding: provisionBinding(parsed.provisionBinding),
      targetBinding: targetBinding(parsed.targetBinding),
    }),
    observedAt,
    issuedAt,
    expiresAt,
  });
}

export function productionDeploymentTargetIdentityEnrollmentContentSha256(value) {
  try {
    const content = parsedContent(value).value;
    return domainHash(
      ENROLLMENT_HASH_DOMAIN,
      canonicalizeProductionDeploymentTargetIdentityEnrollmentValue(content),
    );
  } catch {
    return invalid();
  }
}

function unsignedRoot(value) {
  const parsed = dataRecord(value, EXACT_KEYS.unsignedRoot);
  if (parsed.schemaVersion !== SCHEMA_VERSION || parsed.artifactType !== ARTIFACT_TYPE) {
    return invalid();
  }
  const content = parsedContent(parsed.content);
  const enrollmentSha256 = digest(parsed.enrollmentSha256);
  if (
    enrollmentSha256 !== productionDeploymentTargetIdentityEnrollmentContentSha256(content.value)
  ) {
    return invalid();
  }
  return Object.freeze({
    ...content,
    value: deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      artifactType: ARTIFACT_TYPE,
      enrollmentSha256,
      content: content.value,
    }),
  });
}

function signer(value) {
  const parsed = dataRecord(value, EXACT_KEYS.signer);
  if (
    !PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SIGNER_ROLES.includes(parsed.role) ||
    parsed.scope !== PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE ||
    typeof parsed.authorityKeyId !== 'string' ||
    parsed.authorityKeyId.length > MAX_KEY_ID_LENGTH ||
    !KEY_ID_PATTERN.test(parsed.authorityKeyId)
  ) {
    return invalid();
  }
  return Object.freeze({
    role: parsed.role,
    scope: PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE,
    authorityKeyId: parsed.authorityKeyId,
    signedAt: canonicalInstant(parsed.signedAt).text,
  });
}

export function productionDeploymentTargetIdentityEnrollmentSigningBytes(
  unsignedValue,
  signerValue,
) {
  try {
    const unsigned = unsignedRoot(unsignedValue);
    const parsedSigner = signer(signerValue);
    const signedAt = canonicalInstant(parsedSigner.signedAt);
    if (
      signedAt.milliseconds < unsigned.issuedAt.milliseconds ||
      signedAt.milliseconds >= unsigned.expiresAt.milliseconds
    ) {
      return invalid();
    }
    return Buffer.from(
      `${SIGNING_DOMAIN}\n${canonicalizeProductionDeploymentTargetIdentityEnrollmentValue({
        ...unsigned.value,
        signer: parsedSigner,
      })}`,
      'utf8',
    );
  } catch {
    return invalid();
  }
}

function canonicalBase64(value, expectedBytes) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    return invalid();
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== expectedBytes || bytes.toString('base64') !== value) return invalid();
  return bytes;
}

function parsedRegistry(value) {
  const parsed = dataRecord(value, EXACT_KEYS.registry);
  if (
    parsed.schemaVersion !== 1 ||
    parsed.artifactType !==
      'PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY'
  ) {
    return invalid();
  }
  const candidates = strictArray(parsed.keys, MAX_AUTHORITY_KEYS);
  const keyIds = new Set();
  const publicKeyHashes = new Set();
  let previousKeyId;
  const keys = candidates.map((candidate) => {
    const key = dataRecord(candidate, EXACT_KEYS.authorityKey);
    if (
      typeof key.keyId !== 'string' ||
      key.keyId.length > MAX_KEY_ID_LENGTH ||
      !KEY_ID_PATTERN.test(key.keyId) ||
      keyIds.has(key.keyId) ||
      (previousKeyId !== undefined && previousKeyId >= key.keyId) ||
      !PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SIGNER_ROLES.includes(key.role) ||
      key.scope !== PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SCOPE ||
      key.algorithm !== 'Ed25519' ||
      key.status !== 'APPROVED' ||
      typeof key.approvalReferenceId !== 'string' ||
      !REFERENCE_PATTERN.test(key.approvalReferenceId)
    ) {
      return invalid();
    }
    const validFrom = canonicalInstant(key.validFrom);
    const validUntil = canonicalInstant(key.validUntil);
    if (
      validUntil.milliseconds <= validFrom.milliseconds ||
      validUntil.milliseconds - validFrom.milliseconds > MAX_KEY_VALIDITY_MILLISECONDS
    ) {
      return invalid();
    }
    const der = canonicalBase64(key.publicKeySpkiDerBase64, 44);
    if (!der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
      return invalid();
    }
    try {
      // This check deliberately precedes createPublicKey: DER/algorithm
      // acceptance alone is insufficient for an Ed25519 trust anchor.
      validateEd25519PublicKeyBytes(der.subarray(ED25519_SPKI_PREFIX.length));
    } catch {
      return invalid();
    }
    let publicKey;
    try {
      publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    } catch {
      return invalid();
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') return invalid();
    const canonicalDer = publicKey.export({ format: 'der', type: 'spki' });
    if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(der)) return invalid();
    const publicKeySha256 = createHash('sha256').update(der).digest('hex');
    if (publicKeyHashes.has(publicKeySha256)) return invalid();
    keyIds.add(key.keyId);
    publicKeyHashes.add(publicKeySha256);
    previousKeyId = key.keyId;
    return Object.freeze({
      keyId: key.keyId,
      role: key.role,
      validFrom,
      validUntil,
      publicKey,
      publicKeySha256,
    });
  });
  return Object.freeze({
    keys: Object.freeze(keys),
    registrySha256: domainHash(
      AUTHORITY_REGISTRY_HASH_DOMAIN,
      canonicalizeProductionDeploymentTargetIdentityEnrollmentValue(value),
    ),
  });
}

function parsedSignature(value, expectedRole) {
  const parsed = dataRecord(value, EXACT_KEYS.signature);
  const parsedSigner = signer({
    role: parsed.role,
    scope: parsed.scope,
    authorityKeyId: parsed.authorityKeyId,
    signedAt: parsed.signedAt,
  });
  if (parsedSigner.role !== expectedRole || parsed.algorithm !== 'Ed25519') return invalid();
  return Object.freeze({
    ...parsedSigner,
    algorithm: 'Ed25519',
    valueBase64: canonicalBase64(parsed.valueBase64, 64).toString('base64'),
  });
}

function parsedArtifact(bytes) {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > MAX_PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_BYTES
    ) {
      return invalid();
    }
    const parsed = parseStrictJsonBytes(bytes);
    const root = dataRecord(parsed, EXACT_KEYS.root);
    const unsigned = unsignedRoot({
      schemaVersion: root.schemaVersion,
      artifactType: root.artifactType,
      enrollmentSha256: root.enrollmentSha256,
      content: root.content,
    });
    const signatureValues = strictArray(root.signatures, 2);
    if (
      signatureValues.length !==
      PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SIGNER_ROLES.length
    ) {
      return invalid();
    }
    const signatures = signatureValues.map((candidate, index) =>
      parsedSignature(
        candidate,
        PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_SIGNER_ROLES[index],
      ),
    );
    const value = deepFreeze({ ...unsigned.value, signatures: Object.freeze(signatures) });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text !== `${canonicalizeProductionDeploymentTargetIdentityEnrollmentValue(value)}\n`) {
      return invalid();
    }
    return Object.freeze({ ...unsigned, value, signatures });
  } catch {
    return invalid();
  }
}

function destinationContinuity(content, destination, productionMode) {
  const binding = content.destinationBinding;
  if (
    (productionMode && !isVerifiedProductionDeploymentDestination(destination)) ||
    (!productionMode && isVerifiedProductionDeploymentDestination(destination)) ||
    binding.destinationId !== destination.destinationId ||
    binding.destinationSha256 !== destination.destinationSha256 ||
    binding.epochId !== destination.epochId ||
    binding.destinationRegistrySha256 !== destination.registrySha256
  ) {
    return invalid();
  }
  const target = content.targetBinding.target;
  const expectedStackPrefix =
    `arn:aws:cloudformation:${destination.awsRegion}:${destination.awsAccountId}:` +
    `stack/${destination.stackName}/`;
  if (
    target.awsAccountId !== destination.awsAccountId ||
    target.awsRegion !== destination.awsRegion ||
    target.publicOrigin !== destination.publicOrigin ||
    !target.rds.cloudFormationStackId.startsWith(expectedStackPrefix)
  ) {
    return invalid();
  }
}

function createEnrollmentFreshness(initialReading, finalReading, expiresAtMilliseconds) {
  const monotonicDeadlineMilliseconds =
    initialReading.monotonicMilliseconds +
    (expiresAtMilliseconds - initialReading.wall.milliseconds);
  if (
    finalReading.wall.milliseconds < initialReading.wall.milliseconds ||
    finalReading.monotonicMilliseconds < initialReading.monotonicMilliseconds ||
    finalReading.wall.milliseconds >= expiresAtMilliseconds ||
    !Number.isFinite(monotonicDeadlineMilliseconds) ||
    finalReading.monotonicMilliseconds >= monotonicDeadlineMilliseconds
  ) {
    return invalid();
  }
  return Object.seal({
    invalidated: false,
    expiresAtMilliseconds,
    monotonicDeadlineMilliseconds,
    lastObservedWallMilliseconds: finalReading.wall.milliseconds,
    lastObservedMonotonicMilliseconds: finalReading.monotonicMilliseconds,
  });
}

function reportIsFreshAt(value, registry, reading) {
  if (value === null || typeof value !== 'object') return false;
  const freshness = registry.get(value);
  if (freshness === undefined || freshness.invalidated) return false;
  if (
    reading.wall.milliseconds < freshness.lastObservedWallMilliseconds ||
    reading.monotonicMilliseconds < freshness.lastObservedMonotonicMilliseconds ||
    reading.wall.milliseconds >= freshness.expiresAtMilliseconds ||
    reading.monotonicMilliseconds >= freshness.monotonicDeadlineMilliseconds
  ) {
    freshness.invalidated = true;
    return false;
  }
  freshness.lastObservedWallMilliseconds = reading.wall.milliseconds;
  freshness.lastObservedMonotonicMilliseconds = reading.monotonicMilliseconds;
  return true;
}

function reportIsFreshFromClock(value, registry, readClock) {
  if (value === null || typeof value !== 'object') return false;
  const freshness = registry.get(value);
  if (freshness === undefined || freshness.invalidated) return false;
  try {
    return reportIsFreshAt(value, registry, readClock());
  } catch {
    freshness.invalidated = true;
    return false;
  }
}

function verifyParsedArtifact(
  parsed,
  registryValue,
  destinationResolver,
  initialReading,
  readFinalClock,
  productionMode,
) {
  const evaluatedAt = initialReading.wall;
  if (
    evaluatedAt.milliseconds < parsed.issuedAt.milliseconds ||
    evaluatedAt.milliseconds >= parsed.expiresAt.milliseconds
  ) {
    return invalid();
  }
  const registry = parsedRegistry(registryValue);
  const binding = parsed.value.content.destinationBinding;
  const destination = destinationResolver(binding.destinationId, binding.destinationSha256);
  destinationContinuity(parsed.value.content, destination, productionMode);

  const usedAuthorityIds = new Set();
  const usedPhysicalKeys = new Set();
  const signers = parsed.signatures.map((signature) => {
    const authority = registry.keys.find((key) => key.keyId === signature.authorityKeyId);
    const signedAt = canonicalInstant(signature.signedAt);
    if (
      authority === undefined ||
      authority.role !== signature.role ||
      usedAuthorityIds.has(authority.keyId) ||
      usedPhysicalKeys.has(authority.publicKeySha256) ||
      signedAt.milliseconds < parsed.issuedAt.milliseconds ||
      signedAt.milliseconds > evaluatedAt.milliseconds ||
      signedAt.milliseconds >= parsed.expiresAt.milliseconds ||
      signedAt.milliseconds < authority.validFrom.milliseconds ||
      parsed.expiresAt.milliseconds > authority.validUntil.milliseconds ||
      !verifySignature(
        null,
        productionDeploymentTargetIdentityEnrollmentSigningBytes(
          {
            schemaVersion: parsed.value.schemaVersion,
            artifactType: parsed.value.artifactType,
            enrollmentSha256: parsed.value.enrollmentSha256,
            content: parsed.value.content,
          },
          {
            role: signature.role,
            scope: signature.scope,
            authorityKeyId: signature.authorityKeyId,
            signedAt: signature.signedAt,
          },
        ),
        authority.publicKey,
        Buffer.from(signature.valueBase64, 'base64'),
      )
    ) {
      return invalid();
    }
    usedAuthorityIds.add(authority.keyId);
    usedPhysicalKeys.add(authority.publicKeySha256);
    return Object.freeze({
      role: signature.role,
      authorityKeyId: authority.keyId,
      publicKeySha256: authority.publicKeySha256,
      signedAt: signature.signedAt,
    });
  });

  const freshness = createEnrollmentFreshness(
    initialReading,
    readFinalClock(),
    parsed.expiresAt.milliseconds,
  );
  const report = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    artifactType: ARTIFACT_TYPE,
    targetIdentityEvidenceAccepted: true,
    enrollmentSha256: parsed.value.enrollmentSha256,
    destination,
    provisionBinding: parsed.value.content.provisionBinding,
    deployedTarget: Object.freeze({
      ...parsed.value.content.targetBinding.target,
      targetSha256: parsed.value.content.targetBinding.deploymentTargetSha256,
    }),
    observedAt: parsed.value.content.observedAt,
    issuedAt: parsed.value.content.issuedAt,
    validUntil: parsed.value.content.expiresAt,
    authorityRegistrySha256: registry.registrySha256,
    signers: Object.freeze(signers),
    provisionStateClaim: 'INERT_DEPLOYED_UNVERIFIED',
    consumerRequirements: Object.freeze({
      provisionIntentBindingMatchRequired: true,
      reservationBindingMatchRequired: true,
      resultBindingMatchRequired: true,
      sourceRevisionBindingMatchRequired: true,
      releaseManifestBindingMatchRequired: true,
      liveStateBrandRequired: true,
      atomicChainHeadCasBrandRequired: true,
    }),
    replayProtection: 'EXTERNAL_CHAIN_REQUIRED',
    atomicChainHeadConsumed: false,
    externalStateVerified: false,
    executionAllowed: false,
    externalCallsMade: 0,
    cloudCallsMade: 0,
    networkCallsMade: 0,
    subprocessesStarted: 0,
    environmentValuesRead: 0,
    filesWritten: 0,
  });
  return Object.freeze({ report, freshness });
}

export function verifyProductionDeploymentTargetIdentityEnrollmentBytes(bytes) {
  try {
    const initialReading = trustedClockReading();
    const verified = verifyParsedArtifact(
      parsedArtifact(bytes),
      PRODUCTION_DEPLOYMENT_TARGET_IDENTITY_ENROLLMENT_AUTHORITY_KEY_REGISTRY,
      resolveProductionDeploymentDestination,
      initialReading,
      trustedClockReading,
      true,
    );
    PRODUCTION_VERIFIED_ENROLLMENTS.add(verified.report);
    PRODUCTION_ENROLLMENT_FRESHNESS.set(verified.report, verified.freshness);
    return verified.report;
  } catch {
    return invalid();
  }
}

/** Test seam: injected trust/time cannot mint the production WeakSet brand. */
export function verifyProductionDeploymentTargetIdentityEnrollmentBytesWithTestRegistries(
  bytes,
  options,
) {
  try {
    const parsedOptions = dataRecord(options, EXACT_KEYS.testOptions);
    const readClock = testClockSequence(parsedOptions.clockReadings);
    const initialReading = readClock();
    const verified = verifyParsedArtifact(
      parsedArtifact(bytes),
      parsedOptions.authorityKeyRegistry,
      (destinationId, destinationSha256) =>
        resolveProductionDeploymentDestinationWithTestRegistry(
          destinationId,
          destinationSha256,
          parsedOptions.destinationRegistry,
        ),
      initialReading,
      readClock,
      false,
    );
    TEST_VERIFIED_ENROLLMENTS.add(verified.report);
    TEST_ENROLLMENT_FRESHNESS.set(verified.report, verified.freshness);
    return verified.report;
  } catch {
    return invalid();
  }
}

export function isVerifiedProductionDeploymentTargetIdentityEnrollment(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    PRODUCTION_VERIFIED_ENROLLMENTS.has(value) &&
    reportIsFreshFromClock(value, PRODUCTION_ENROLLMENT_FRESHNESS, trustedClockReading)
  );
}

export function isTestVerifiedProductionDeploymentTargetIdentityEnrollment(value) {
  return typeof value === 'object' && value !== null && TEST_VERIFIED_ENROLLMENTS.has(value);
}

export function revalidateProductionDeploymentTargetIdentityEnrollmentForApplication(value) {
  if (!isVerifiedProductionDeploymentTargetIdentityEnrollment(value)) return invalid();
  return value;
}

/** Test-only freshness seam; it cannot accept or mint a production brand. */
export function isTestVerifiedProductionDeploymentTargetIdentityEnrollmentFreshAtForTest(
  value,
  clockReading,
) {
  if (PRODUCTION_VERIFIED_ENROLLMENTS.has(value) || !TEST_VERIFIED_ENROLLMENTS.has(value)) {
    return false;
  }
  return reportIsFreshFromClock(value, TEST_ENROLLMENT_FRESHNESS, () =>
    testClockReading(clockReading),
  );
}
