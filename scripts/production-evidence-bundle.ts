import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  readSync,
  type BigIntStats,
} from 'node:fs';
import { join, normalize, parse, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

// @ts-expect-error The operations-owned audited manifest boundary is an ESM JavaScript module.
import * as releaseCandidateManifest from './release-candidate-manifest.mjs';
import {
  resolveProductionDeploymentTarget,
  resolveProductionDeploymentTargetWithTestRegistry,
  type ProductionDeploymentTargetRegistry,
  type ResolvedProductionDeploymentTarget,
} from './production-deployment-target.mjs';

export const PRODUCTION_EVIDENCE_BUNDLE_SCHEMA_VERSION = 2 as const;
export const MAX_PRODUCTION_EVIDENCE_BUNDLE_BYTES = 262_144 as const;
export const MAX_PRODUCTION_EVIDENCE_BUNDLE_VALIDITY_MILLISECONDS = 24 * 60 * 60 * 1_000;
export const MAX_PRODUCTION_EVIDENCE_OBSERVATION_LEAD_MILLISECONDS = 60 * 60 * 1_000;
const MAX_RDS_MASTER_LIFECYCLE_CAPTURE_MILLISECONDS = 24 * 60 * 60 * 1_000;

const SIGNING_DOMAIN = 'crypto-lending:production-controlled-evidence-bundle:v2' as const;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const SOURCE_TREE_PATTERN = /^[a-f0-9]{40,64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const KEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const TARGET_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-[1-9][0-9]?$/u;
const RDS_DATABASE_ARN_RESOURCE_PATTERN = /^db:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const RDS_MANAGED_SECRET_ARN_RESOURCE_PATTERN = /^secret:rds!db-[A-Za-z0-9/_+=.@-]{1,512}$/u;
const KMS_KEY_ARN_RESOURCE_PATTERN =
  /^key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

const ROOT_KEYS = Object.freeze(['schemaVersion', 'artifactType', 'content', 'signatures']);
const UNSIGNED_ROOT_KEYS = Object.freeze(['schemaVersion', 'artifactType', 'content']);
const CONTENT_KEYS = Object.freeze([
  'scope',
  'issuedAt',
  'expiresAt',
  'sourceRevision',
  'releaseCandidateManifestSha256',
  'deploymentTargetId',
  'deploymentTargetSha256',
  'directoryConfigurationSha256',
  'authenticationDeploymentEvidence',
  'rdsMasterLifecycleEvidence',
  'externalEgressLiveEvidence',
  'rpcProviderLiveEvidence',
  'liveReadEvidenceIndex',
  'mainnetWriteEvidenceIndex',
]);
const ATTESTATION_KEYS = Object.freeze(['artifactType', 'status', 'observedAt']);
const RDS_MASTER_LIFECYCLE_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'status',
  'observedAt',
  'supportingCapture',
  'binding',
  'access',
  'rotation',
  'restore',
]);
const RDS_MASTER_SUPPORTING_CAPTURE_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'format',
  'captureSha256',
  'collectionStartedAt',
  'collectionCompletedAt',
]);
const RDS_MASTER_BINDING_KEYS = Object.freeze([
  'applicationDataKeyArn',
  'compatibilityOutputSecretArn',
  'databaseInstanceArn',
  'databaseManagedSecretArn',
  'databaseResourceId',
  'managedSecretKmsKeyArn',
  'managedSecretStatus',
  'masterUsername',
]);
const RDS_MASTER_ACCESS_KEYS = Object.freeze([
  'applicationTaskCredentialIsolation',
  'bootstrapIamAndKmsAccess',
  'migrationTaskCredentialIsolation',
  'observedAt',
]);
const RDS_MASTER_ROTATION_KEYS = Object.freeze([
  'automaticRotationEnabled',
  'completedAt',
  'currentSecretVersionId',
  'currentSecretVersionStage',
  'managedSecretStatus',
  'masterSessionDrain',
  'newMasterAuthentication',
  'oldMasterAuthenticationDenied',
  'previousSecretVersionId',
  'previousSecretVersionStage',
  'rotationCompleted',
  'rotationScheduleDays',
  'runtimeCredentialContinuity',
  'startedAt',
]);
const RDS_MASTER_RESTORE_KEYS = Object.freeze([
  'completedAt',
  'databaseInstanceArn',
  'databaseResourceId',
  'originalMasterAuthenticationDenied',
  'reboundManagedSecretArn',
  'reboundManagedSecretKmsKeyArn',
  'reboundManagedSecretStatus',
  'reboundManagedSecretVersionId',
  'reboundManagedSecretVersionStage',
  'rebindingStatus',
  'restoredMasterAuthentication',
  'runtimeCredentialContinuity',
  'startedAt',
]);
const SIGNATURE_KEYS = Object.freeze([
  'role',
  'scope',
  'authorityKeyId',
  'algorithm',
  'valueBase64',
]);
const REGISTRY_KEYS = Object.freeze(['schemaVersion', 'artifactType', 'keys']);
const AUTHORITY_KEY_KEYS = Object.freeze([
  'keyId',
  'algorithm',
  'status',
  'role',
  'scope',
  'publicKeySpkiDerBase64',
  'validFrom',
  'validUntil',
  'approvalReferenceId',
]);
const READ_EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'status',
  'sourceRevision',
  'directoryConfigurationSha256',
  'providerIds',
  'adapterBindings',
  'compositionEvidence',
]);
const RELEASE_MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'source',
  'builder',
  'components',
  'payloadSha256',
]);
const RELEASE_SOURCE_KEYS = Object.freeze(['revision', 'tree']);

export const PRODUCTION_EVIDENCE_SIGNER_ROLES = Object.freeze([
  'DEPLOYMENT_EVIDENCE_ISSUER',
  'INDEPENDENT_RELEASE_VERIFIER',
  'LEGAL_RELEASE_APPROVER',
  'PRIVACY_RELEASE_APPROVER',
  'REGULATORY_RELEASE_APPROVER',
  'OPERATIONS_RELEASE_APPROVER',
  'DEPENDENCY_RELEASE_APPROVER',
  'DEPLOYMENT_OWNER_APPROVER',
] as const);
const REQUIRED_READ_ONLY_SIGNER_ROLES = Object.freeze([
  'DEPLOYMENT_EVIDENCE_ISSUER',
  'INDEPENDENT_RELEASE_VERIFIER',
] as const);
const RECOGNIZED_SIGNER_ROLES = new Set<string>(PRODUCTION_EVIDENCE_SIGNER_ROLES);
const AUTHORIZED_BUNDLES = new WeakMap<object, Readonly<{ verifiedAtMilliseconds: number }>>();

export type ProductionEvidenceSignerRole = (typeof PRODUCTION_EVIDENCE_SIGNER_ROLES)[number];
export type ProductionEvidenceScope = 'READ_ONLY';

export interface ProductionEvidenceAuthorityKey {
  readonly keyId: string;
  readonly algorithm: 'Ed25519';
  readonly status: 'APPROVED';
  readonly role: ProductionEvidenceSignerRole;
  readonly scope: ProductionEvidenceScope;
  readonly publicKeySpkiDerBase64: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly approvalReferenceId: string;
}

export interface ProductionEvidenceAuthorityKeyRegistry {
  readonly schemaVersion: 1;
  readonly artifactType: 'PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY';
  readonly keys: readonly ProductionEvidenceAuthorityKey[];
}

/**
 * Production signature authority remains intentionally empty. Each future key
 * is a reviewed source change and has one role and one read-only scope.
 */
export const PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY = Object.freeze({
  schemaVersion: 1,
  artifactType: 'PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY',
  keys: Object.freeze([]),
} as const satisfies ProductionEvidenceAuthorityKeyRegistry);

export interface ProductionEvidenceObservation {
  readonly artifactType:
    | 'AUTHENTICATION_DEPLOYMENT_EVIDENCE'
    | 'EXTERNAL_EGRESS_LIVE_EVIDENCE'
    | 'RPC_PROVIDER_LIVE_EVIDENCE';
  readonly status: 'ACCEPTED';
  readonly observedAt: string;
}

export interface ProductionRdsMasterLifecycleEvidence {
  readonly schemaVersion: 1;
  readonly artifactType: 'RDS_MASTER_LIFECYCLE_EVIDENCE';
  readonly status: 'ACCEPTED';
  readonly observedAt: string;
  readonly supportingCapture: Readonly<{
    schemaVersion: 1;
    artifactType: 'RDS_MASTER_LIFECYCLE_CAPTURE';
    format: 'SANITIZED_CANONICAL_JSON_V1';
    captureSha256: string;
    collectionStartedAt: string;
    collectionCompletedAt: string;
  }>;
  readonly binding: Readonly<{
    applicationDataKeyArn: string;
    compatibilityOutputSecretArn: string;
    databaseInstanceArn: string;
    databaseManagedSecretArn: string;
    databaseResourceId: string;
    managedSecretKmsKeyArn: string;
    managedSecretStatus: 'active';
    masterUsername: 'crypto_admin';
  }>;
  readonly access: Readonly<{
    applicationTaskCredentialIsolation: 'PASS';
    bootstrapIamAndKmsAccess: 'PASS';
    migrationTaskCredentialIsolation: 'PASS';
    observedAt: string;
  }>;
  readonly rotation: Readonly<{
    automaticRotationEnabled: 'PASS';
    completedAt: string;
    currentSecretVersionId: string;
    currentSecretVersionStage: 'AWSCURRENT';
    managedSecretStatus: 'active';
    masterSessionDrain: 'PASS';
    newMasterAuthentication: 'PASS';
    oldMasterAuthenticationDenied: 'PASS';
    previousSecretVersionId: string;
    previousSecretVersionStage: 'AWSPREVIOUS';
    rotationCompleted: 'PASS';
    rotationScheduleDays: 7;
    runtimeCredentialContinuity: 'PASS';
    startedAt: string;
  }>;
  readonly restore: Readonly<{
    completedAt: string;
    databaseInstanceArn: string;
    databaseResourceId: string;
    originalMasterAuthenticationDenied: 'PASS';
    reboundManagedSecretArn: string;
    reboundManagedSecretKmsKeyArn: string;
    reboundManagedSecretStatus: 'active';
    reboundManagedSecretVersionId: string;
    reboundManagedSecretVersionStage: 'AWSCURRENT';
    rebindingStatus: 'PASS';
    restoredMasterAuthentication: 'PASS';
    runtimeCredentialContinuity: 'PASS';
    startedAt: string;
  }>;
}

export interface ProductionLiveReadEvidenceIndex {
  readonly schemaVersion: 1;
  readonly artifactType: 'PRODUCTION_LIVE_READ_EVIDENCE_INDEX';
  readonly status: 'ACCEPTED';
  readonly sourceRevision: string;
  readonly directoryConfigurationSha256: string;
  readonly providerIds: readonly string[];
  readonly adapterBindings: 'COMPLETE';
  readonly compositionEvidence: 'PASS';
}

export interface ProductionEvidenceBundleContent {
  readonly scope: ProductionEvidenceScope;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly sourceRevision: string;
  readonly releaseCandidateManifestSha256: string;
  readonly deploymentTargetId: string;
  readonly deploymentTargetSha256: string;
  readonly directoryConfigurationSha256: string;
  readonly authenticationDeploymentEvidence: ProductionEvidenceObservation;
  readonly rdsMasterLifecycleEvidence: ProductionRdsMasterLifecycleEvidence;
  readonly externalEgressLiveEvidence: ProductionEvidenceObservation;
  readonly rpcProviderLiveEvidence: ProductionEvidenceObservation;
  readonly liveReadEvidenceIndex: ProductionLiveReadEvidenceIndex;
  readonly mainnetWriteEvidenceIndex: null;
}

export interface ProductionEvidenceSignature {
  readonly role: ProductionEvidenceSignerRole;
  readonly scope: ProductionEvidenceScope;
  readonly authorityKeyId: string;
  readonly algorithm: 'Ed25519';
  readonly valueBase64: string;
}

export interface UnsignedProductionEvidenceBundle {
  readonly schemaVersion: 2;
  readonly artifactType: 'PRODUCTION_CONTROLLED_EVIDENCE_BUNDLE';
  readonly content: ProductionEvidenceBundleContent;
}

export interface ProductionEvidenceBundle extends UnsignedProductionEvidenceBundle {
  readonly signatures: readonly ProductionEvidenceSignature[];
}

export interface VerifiedProductionEvidenceBundle extends ProductionEvidenceBundle {
  readonly signatureValidated: true;
  readonly verifiedSignerRoles: readonly ProductionEvidenceSignerRole[];
  readonly authorityRegistrySha256: string;
  readonly deploymentTargetRegistrySha256: string;
  readonly bundleSha256: string;
}

export interface VerifyProductionEvidenceBundleOptions {
  readonly releaseManifest: unknown;
}

interface EvaluatedProductionEvidenceBundleOptions extends VerifyProductionEvidenceBundleOptions {
  readonly evaluatedAt: string;
}

export interface TestProductionEvidenceBundleVerificationOptions extends EvaluatedProductionEvidenceBundleOptions {
  readonly authorityKeyRegistry: ProductionEvidenceAuthorityKeyRegistry;
  readonly deploymentTargetRegistry: ProductionDeploymentTargetRegistry;
  readonly isReleaseManifestVerified: (value: unknown) => boolean;
}

export interface ProductionEvidenceApplicationOptions {
  readonly releaseManifest: unknown;
  readonly repositoryRoot: string;
  readonly sourceRevision: string;
}

export class ProductionEvidenceBundleInvalidError extends Error {
  readonly code = 'PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID' as const;

  constructor() {
    super('Production preflight evidence bundle is invalid');
    this.name = 'ProductionEvidenceBundleInvalidError';
  }
}

function invalid(): never {
  throw new ProductionEvidenceBundleInvalidError();
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function record(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
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
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}

export function canonicalProductionEvidenceJson(
  value: unknown,
  seen: Set<object> = new Set<object>(),
): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) return invalid();
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalProductionEvidenceJson(item, seen)).join(',')}]`;
  } else {
    const object = value as Record<string, unknown>;
    result = `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalProductionEvidenceJson(object[key], seen)}`)
      .join(',')}}`;
  }
  seen.delete(value);
  return result;
}

function timestamp(value: unknown): Readonly<{ text: string; milliseconds: number }> {
  if (typeof value !== 'string') return invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return invalid();
  }
  return Object.freeze({ text: value, milliseconds });
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) return invalid();
  return value;
}

function safeReference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE_PATTERN.test(value)) return invalid();
  return value;
}

interface ParsedAwsArn {
  readonly value: string;
  readonly service: string;
  readonly region: string;
  readonly accountId: string;
  readonly resource: string;
}

function awsArn(
  value: unknown,
  expectedService: 'kms' | 'rds' | 'secretsmanager',
  resourcePattern: RegExp,
): ParsedAwsArn {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) return invalid();
  const match = /^arn:aws:([a-z0-9-]+):([a-z]{2}-[a-z]+-[1-9][0-9]?):([0-9]{12}):(.+)$/u.exec(
    value,
  );
  if (
    match === null ||
    match[1] !== expectedService ||
    !AWS_REGION_PATTERN.test(match[2] ?? '') ||
    /^0{12}$/u.test(match[3] ?? '') ||
    !resourcePattern.test(match[4] ?? '') ||
    (expectedService === 'rds' && (match[4] ?? '').slice(3).includes('--'))
  ) {
    return invalid();
  }
  return Object.freeze({
    value,
    service: match[1] as string,
    region: match[2] as string,
    accountId: match[3] as string,
    resource: match[4] as string,
  });
}

function databaseResourceId(value: unknown): string {
  const containsAsciiControl =
    typeof value === 'string' &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    });
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    containsAsciiControl
  ) {
    return invalid();
  }
  return value;
}

function secretVersionId(value: unknown): string {
  // AWS documents VersionId as an opaque 32-64 character string. It is signed
  // and compared only; no undocumented alphabet is imposed here.
  if (typeof value !== 'string' || value.length < 32 || value.length > 64) return invalid();
  return value;
}

function pass(value: unknown): 'PASS' {
  if (value !== 'PASS') return invalid();
  return 'PASS';
}

function canonicalBase64(value: unknown, expectedBytes?: number): Buffer {
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
  if (
    bytes.toString('base64') !== value ||
    (expectedBytes !== undefined && bytes.length !== expectedBytes)
  ) {
    return invalid();
  }
  return bytes;
}

function providerIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return invalid();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || id.length > 64 || !PROVIDER_ID_PATTERN.test(id) || seen.has(id)) {
      return invalid();
    }
    seen.add(id);
    ids.push(id);
  }
  return Object.freeze(ids);
}

function observation(
  value: unknown,
  artifactType: ProductionEvidenceObservation['artifactType'],
  issuedAtMilliseconds: number,
): ProductionEvidenceObservation {
  const parsed = record(value, ATTESTATION_KEYS);
  if (parsed.artifactType !== artifactType || parsed.status !== 'ACCEPTED') return invalid();
  const observedAt = timestamp(parsed.observedAt);
  if (
    observedAt.milliseconds > issuedAtMilliseconds ||
    issuedAtMilliseconds - observedAt.milliseconds >
      MAX_PRODUCTION_EVIDENCE_OBSERVATION_LEAD_MILLISECONDS
  ) {
    return invalid();
  }
  return Object.freeze({ artifactType, status: 'ACCEPTED', observedAt: observedAt.text });
}

function rdsMasterLifecycleEvidence(
  value: unknown,
  issuedAtMilliseconds: number,
): ProductionRdsMasterLifecycleEvidence {
  const parsed = record(value, RDS_MASTER_LIFECYCLE_KEYS);
  if (
    parsed.schemaVersion !== 1 ||
    parsed.artifactType !== 'RDS_MASTER_LIFECYCLE_EVIDENCE' ||
    parsed.status !== 'ACCEPTED'
  ) {
    return invalid();
  }
  const observedAt = timestamp(parsed.observedAt);
  if (
    observedAt.milliseconds > issuedAtMilliseconds ||
    issuedAtMilliseconds - observedAt.milliseconds >
      MAX_PRODUCTION_EVIDENCE_OBSERVATION_LEAD_MILLISECONDS
  ) {
    return invalid();
  }

  const supportingCapture = record(parsed.supportingCapture, RDS_MASTER_SUPPORTING_CAPTURE_KEYS);
  const collectionStartedAt = timestamp(supportingCapture.collectionStartedAt);
  const collectionCompletedAt = timestamp(supportingCapture.collectionCompletedAt);
  if (
    supportingCapture.schemaVersion !== 1 ||
    supportingCapture.artifactType !== 'RDS_MASTER_LIFECYCLE_CAPTURE' ||
    supportingCapture.format !== 'SANITIZED_CANONICAL_JSON_V1' ||
    collectionStartedAt.milliseconds >= collectionCompletedAt.milliseconds ||
    collectionCompletedAt.text !== observedAt.text ||
    collectionCompletedAt.milliseconds - collectionStartedAt.milliseconds >
      MAX_RDS_MASTER_LIFECYCLE_CAPTURE_MILLISECONDS
  ) {
    return invalid();
  }
  const captureSha256 = sha256(supportingCapture.captureSha256);

  const binding = record(parsed.binding, RDS_MASTER_BINDING_KEYS);
  const applicationDataKeyArn = awsArn(
    binding.applicationDataKeyArn,
    'kms',
    KMS_KEY_ARN_RESOURCE_PATTERN,
  ).value;
  const compatibilityOutputSecretArn = awsArn(
    binding.compatibilityOutputSecretArn,
    'secretsmanager',
    RDS_MANAGED_SECRET_ARN_RESOURCE_PATTERN,
  ).value;
  const databaseInstanceArn = awsArn(
    binding.databaseInstanceArn,
    'rds',
    RDS_DATABASE_ARN_RESOURCE_PATTERN,
  ).value;
  const databaseManagedSecretArn = awsArn(
    binding.databaseManagedSecretArn,
    'secretsmanager',
    RDS_MANAGED_SECRET_ARN_RESOURCE_PATTERN,
  ).value;
  const primaryDatabaseResourceId = databaseResourceId(binding.databaseResourceId);
  const managedSecretKmsKeyArn = awsArn(
    binding.managedSecretKmsKeyArn,
    'kms',
    KMS_KEY_ARN_RESOURCE_PATTERN,
  ).value;
  if (
    binding.masterUsername !== 'crypto_admin' ||
    binding.managedSecretStatus !== 'active' ||
    compatibilityOutputSecretArn !== databaseManagedSecretArn ||
    managedSecretKmsKeyArn !== applicationDataKeyArn
  ) {
    return invalid();
  }

  const access = record(parsed.access, RDS_MASTER_ACCESS_KEYS);
  const accessObservedAt = timestamp(access.observedAt);
  const rotation = record(parsed.rotation, RDS_MASTER_ROTATION_KEYS);
  const rotationStartedAt = timestamp(rotation.startedAt);
  const rotationCompletedAt = timestamp(rotation.completedAt);
  const previousSecretVersionId = secretVersionId(rotation.previousSecretVersionId);
  const currentSecretVersionId = secretVersionId(rotation.currentSecretVersionId);
  if (
    rotation.rotationScheduleDays !== 7 ||
    rotation.currentSecretVersionStage !== 'AWSCURRENT' ||
    rotation.previousSecretVersionStage !== 'AWSPREVIOUS' ||
    rotation.managedSecretStatus !== 'active' ||
    previousSecretVersionId === currentSecretVersionId
  ) {
    return invalid();
  }

  const restore = record(parsed.restore, RDS_MASTER_RESTORE_KEYS);
  const restoreStartedAt = timestamp(restore.startedAt);
  const restoreCompletedAt = timestamp(restore.completedAt);
  const restoredDatabaseInstanceArn = awsArn(
    restore.databaseInstanceArn,
    'rds',
    RDS_DATABASE_ARN_RESOURCE_PATTERN,
  ).value;
  const restoredDatabaseResourceId = databaseResourceId(restore.databaseResourceId);
  const reboundManagedSecretArn = awsArn(
    restore.reboundManagedSecretArn,
    'secretsmanager',
    RDS_MANAGED_SECRET_ARN_RESOURCE_PATTERN,
  ).value;
  const reboundManagedSecretKmsKeyArn = awsArn(
    restore.reboundManagedSecretKmsKeyArn,
    'kms',
    KMS_KEY_ARN_RESOURCE_PATTERN,
  ).value;
  if (
    restore.reboundManagedSecretStatus !== 'active' ||
    restore.reboundManagedSecretVersionStage !== 'AWSCURRENT' ||
    restoredDatabaseInstanceArn === databaseInstanceArn ||
    restoredDatabaseResourceId === primaryDatabaseResourceId ||
    reboundManagedSecretArn === databaseManagedSecretArn ||
    reboundManagedSecretKmsKeyArn !== applicationDataKeyArn
  ) {
    return invalid();
  }
  if (
    collectionStartedAt.milliseconds > accessObservedAt.milliseconds ||
    accessObservedAt.milliseconds > rotationStartedAt.milliseconds ||
    rotationStartedAt.milliseconds >= rotationCompletedAt.milliseconds ||
    rotationCompletedAt.milliseconds > restoreStartedAt.milliseconds ||
    restoreStartedAt.milliseconds >= restoreCompletedAt.milliseconds ||
    restoreCompletedAt.milliseconds !== collectionCompletedAt.milliseconds
  ) {
    return invalid();
  }

  return deepFreeze({
    schemaVersion: 1,
    artifactType: 'RDS_MASTER_LIFECYCLE_EVIDENCE',
    status: 'ACCEPTED',
    observedAt: observedAt.text,
    supportingCapture: {
      schemaVersion: 1,
      artifactType: 'RDS_MASTER_LIFECYCLE_CAPTURE',
      format: 'SANITIZED_CANONICAL_JSON_V1',
      captureSha256,
      collectionStartedAt: collectionStartedAt.text,
      collectionCompletedAt: collectionCompletedAt.text,
    },
    binding: {
      applicationDataKeyArn,
      compatibilityOutputSecretArn,
      databaseInstanceArn,
      databaseManagedSecretArn,
      databaseResourceId: primaryDatabaseResourceId,
      managedSecretKmsKeyArn,
      managedSecretStatus: 'active',
      masterUsername: 'crypto_admin',
    },
    access: {
      applicationTaskCredentialIsolation: pass(access.applicationTaskCredentialIsolation),
      bootstrapIamAndKmsAccess: pass(access.bootstrapIamAndKmsAccess),
      migrationTaskCredentialIsolation: pass(access.migrationTaskCredentialIsolation),
      observedAt: accessObservedAt.text,
    },
    rotation: {
      automaticRotationEnabled: pass(rotation.automaticRotationEnabled),
      completedAt: rotationCompletedAt.text,
      currentSecretVersionId,
      currentSecretVersionStage: 'AWSCURRENT',
      managedSecretStatus: 'active',
      masterSessionDrain: pass(rotation.masterSessionDrain),
      newMasterAuthentication: pass(rotation.newMasterAuthentication),
      oldMasterAuthenticationDenied: pass(rotation.oldMasterAuthenticationDenied),
      previousSecretVersionId,
      previousSecretVersionStage: 'AWSPREVIOUS',
      rotationCompleted: pass(rotation.rotationCompleted),
      rotationScheduleDays: 7,
      runtimeCredentialContinuity: pass(rotation.runtimeCredentialContinuity),
      startedAt: rotationStartedAt.text,
    },
    restore: {
      completedAt: restoreCompletedAt.text,
      databaseInstanceArn: restoredDatabaseInstanceArn,
      databaseResourceId: restoredDatabaseResourceId,
      originalMasterAuthenticationDenied: pass(restore.originalMasterAuthenticationDenied),
      reboundManagedSecretArn,
      reboundManagedSecretKmsKeyArn,
      reboundManagedSecretStatus: 'active',
      reboundManagedSecretVersionId: secretVersionId(restore.reboundManagedSecretVersionId),
      reboundManagedSecretVersionStage: 'AWSCURRENT',
      rebindingStatus: pass(restore.rebindingStatus),
      restoredMasterAuthentication: pass(restore.restoredMasterAuthentication),
      runtimeCredentialContinuity: pass(restore.runtimeCredentialContinuity),
      startedAt: restoreStartedAt.text,
    },
  });
}

function validateRdsMasterLifecycleTargetBinding(
  evidence: ProductionRdsMasterLifecycleEvidence,
  target: ResolvedProductionDeploymentTarget,
): void {
  if (
    evidence.binding.applicationDataKeyArn !== target.rds.applicationDataKeyArn ||
    evidence.binding.compatibilityOutputSecretArn !== target.rds.databaseManagedSecretArn ||
    evidence.binding.databaseInstanceArn !== target.rds.databaseInstanceArn ||
    evidence.binding.databaseManagedSecretArn !== target.rds.databaseManagedSecretArn ||
    evidence.binding.databaseResourceId !== target.rds.databaseResourceId ||
    evidence.binding.managedSecretKmsKeyArn !== target.rds.applicationDataKeyArn
  ) {
    return invalid();
  }
  const identities: readonly Readonly<[string, 'kms' | 'rds' | 'secretsmanager', RegExp]>[] = [
    [evidence.binding.applicationDataKeyArn, 'kms', KMS_KEY_ARN_RESOURCE_PATTERN],
    [
      evidence.binding.compatibilityOutputSecretArn,
      'secretsmanager',
      RDS_MANAGED_SECRET_ARN_RESOURCE_PATTERN,
    ],
    [evidence.binding.databaseInstanceArn, 'rds', RDS_DATABASE_ARN_RESOURCE_PATTERN],
    [
      evidence.binding.databaseManagedSecretArn,
      'secretsmanager',
      RDS_MANAGED_SECRET_ARN_RESOURCE_PATTERN,
    ],
    [evidence.binding.managedSecretKmsKeyArn, 'kms', KMS_KEY_ARN_RESOURCE_PATTERN],
    [evidence.restore.databaseInstanceArn, 'rds', RDS_DATABASE_ARN_RESOURCE_PATTERN],
    [
      evidence.restore.reboundManagedSecretArn,
      'secretsmanager',
      RDS_MANAGED_SECRET_ARN_RESOURCE_PATTERN,
    ],
    [evidence.restore.reboundManagedSecretKmsKeyArn, 'kms', KMS_KEY_ARN_RESOURCE_PATTERN],
  ];
  for (const [value, service, resourcePattern] of identities) {
    const parsed = awsArn(value, service, resourcePattern);
    if (parsed.accountId !== target.awsAccountId || parsed.region !== target.awsRegion) {
      return invalid();
    }
  }
}

function readEvidenceIndex(
  value: unknown,
  sourceRevision: string,
  directoryConfigurationSha256: string,
): ProductionLiveReadEvidenceIndex {
  const parsed = record(value, READ_EVIDENCE_KEYS);
  if (
    parsed.schemaVersion !== 1 ||
    parsed.artifactType !== 'PRODUCTION_LIVE_READ_EVIDENCE_INDEX' ||
    parsed.status !== 'ACCEPTED' ||
    parsed.sourceRevision !== sourceRevision ||
    parsed.directoryConfigurationSha256 !== directoryConfigurationSha256 ||
    parsed.adapterBindings !== 'COMPLETE' ||
    parsed.compositionEvidence !== 'PASS'
  ) {
    return invalid();
  }
  return Object.freeze({
    schemaVersion: 1,
    artifactType: 'PRODUCTION_LIVE_READ_EVIDENCE_INDEX',
    status: 'ACCEPTED',
    sourceRevision,
    directoryConfigurationSha256,
    providerIds: providerIds(parsed.providerIds),
    adapterBindings: 'COMPLETE',
    compositionEvidence: 'PASS',
  });
}

function content(value: unknown): ProductionEvidenceBundleContent {
  const parsed = record(value, CONTENT_KEYS);
  if (
    parsed.scope !== 'READ_ONLY' ||
    typeof parsed.sourceRevision !== 'string' ||
    !SOURCE_REVISION_PATTERN.test(parsed.sourceRevision) ||
    typeof parsed.deploymentTargetId !== 'string' ||
    parsed.deploymentTargetId.length > 96 ||
    !TARGET_ID_PATTERN.test(parsed.deploymentTargetId) ||
    parsed.mainnetWriteEvidenceIndex !== null
  ) {
    return invalid();
  }
  const issuedAt = timestamp(parsed.issuedAt);
  const expiresAt = timestamp(parsed.expiresAt);
  if (
    expiresAt.milliseconds <= issuedAt.milliseconds ||
    expiresAt.milliseconds - issuedAt.milliseconds >
      MAX_PRODUCTION_EVIDENCE_BUNDLE_VALIDITY_MILLISECONDS
  ) {
    return invalid();
  }
  const releaseCandidateManifestSha256 = sha256(parsed.releaseCandidateManifestSha256);
  const deploymentTargetSha256 = sha256(parsed.deploymentTargetSha256);
  const directoryConfigurationSha256 = sha256(parsed.directoryConfigurationSha256);
  return deepFreeze({
    scope: 'READ_ONLY',
    issuedAt: issuedAt.text,
    expiresAt: expiresAt.text,
    sourceRevision: parsed.sourceRevision,
    releaseCandidateManifestSha256,
    deploymentTargetId: parsed.deploymentTargetId,
    deploymentTargetSha256,
    directoryConfigurationSha256,
    authenticationDeploymentEvidence: observation(
      parsed.authenticationDeploymentEvidence,
      'AUTHENTICATION_DEPLOYMENT_EVIDENCE',
      issuedAt.milliseconds,
    ),
    rdsMasterLifecycleEvidence: rdsMasterLifecycleEvidence(
      parsed.rdsMasterLifecycleEvidence,
      issuedAt.milliseconds,
    ),
    externalEgressLiveEvidence: observation(
      parsed.externalEgressLiveEvidence,
      'EXTERNAL_EGRESS_LIVE_EVIDENCE',
      issuedAt.milliseconds,
    ),
    rpcProviderLiveEvidence: observation(
      parsed.rpcProviderLiveEvidence,
      'RPC_PROVIDER_LIVE_EVIDENCE',
      issuedAt.milliseconds,
    ),
    liveReadEvidenceIndex: readEvidenceIndex(
      parsed.liveReadEvidenceIndex,
      parsed.sourceRevision,
      directoryConfigurationSha256,
    ),
    mainnetWriteEvidenceIndex: null,
  });
}

function publicKey(value: unknown): Readonly<{
  key: KeyObject;
  spkiDerBase64: string;
  sha256: string;
}> {
  const der = canonicalBase64(value);
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return invalid();
  }
  if (key.asymmetricKeyType !== 'ed25519') return invalid();
  const canonicalDer = key.export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(der)) return invalid();
  return Object.freeze({
    key,
    spkiDerBase64: der.toString('base64'),
    sha256: createHash('sha256').update(der).digest('hex'),
  });
}

function signerRole(value: unknown): ProductionEvidenceSignerRole {
  if (typeof value !== 'string' || !RECOGNIZED_SIGNER_ROLES.has(value)) return invalid();
  return value as ProductionEvidenceSignerRole;
}

interface ParsedAuthorityKey {
  readonly keyId: string;
  readonly role: ProductionEvidenceSignerRole;
  readonly scope: ProductionEvidenceScope;
  readonly publicKey: KeyObject;
  readonly publicKeySha256: string;
  readonly validFrom: Readonly<{ text: string; milliseconds: number }>;
  readonly validUntil: Readonly<{ text: string; milliseconds: number }>;
  readonly normalized: ProductionEvidenceAuthorityKey;
}

function authorityRegistry(value: unknown): Readonly<{
  registrySha256: string;
  keys: readonly ParsedAuthorityKey[];
}> {
  const parsed = record(value, REGISTRY_KEYS);
  if (
    parsed.schemaVersion !== 1 ||
    parsed.artifactType !== 'PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY' ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length > 32
  ) {
    return invalid();
  }
  const ids = new Set<string>();
  const keys = parsed.keys.map((candidate) => {
    const key = record(candidate, AUTHORITY_KEY_KEYS);
    if (
      typeof key.keyId !== 'string' ||
      key.keyId.length > 96 ||
      !KEY_ID_PATTERN.test(key.keyId) ||
      ids.has(key.keyId) ||
      key.algorithm !== 'Ed25519' ||
      key.status !== 'APPROVED' ||
      key.scope !== 'READ_ONLY'
    ) {
      return invalid();
    }
    const role = signerRole(key.role);
    const validFrom = timestamp(key.validFrom);
    const validUntil = timestamp(key.validUntil);
    if (validUntil.milliseconds <= validFrom.milliseconds) return invalid();
    const approvalReferenceId = safeReference(key.approvalReferenceId);
    const parsedPublicKey = publicKey(key.publicKeySpkiDerBase64);
    ids.add(key.keyId);
    const normalized = Object.freeze({
      keyId: key.keyId,
      algorithm: 'Ed25519',
      status: 'APPROVED',
      role,
      scope: 'READ_ONLY',
      publicKeySpkiDerBase64: parsedPublicKey.spkiDerBase64,
      validFrom: validFrom.text,
      validUntil: validUntil.text,
      approvalReferenceId,
    } as const);
    return Object.freeze({
      keyId: key.keyId,
      role,
      scope: 'READ_ONLY' as const,
      publicKey: parsedPublicKey.key,
      publicKeySha256: parsedPublicKey.sha256,
      validFrom,
      validUntil,
      normalized,
    });
  });
  const normalizedRegistry = {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY',
    keys: keys.map(({ normalized }) => normalized),
  } as const;
  return Object.freeze({
    registrySha256: createHash('sha256')
      .update(canonicalProductionEvidenceJson(normalizedRegistry), 'utf8')
      .digest('hex'),
    keys: Object.freeze(keys),
  });
}

function parsedSignatures(value: unknown): readonly ProductionEvidenceSignature[] {
  if (
    !Array.isArray(value) ||
    value.length < REQUIRED_READ_ONLY_SIGNER_ROLES.length ||
    value.length > PRODUCTION_EVIDENCE_SIGNER_ROLES.length
  ) {
    return invalid();
  }
  const roles = new Set<ProductionEvidenceSignerRole>();
  const keyIds = new Set<string>();
  let priorRole = '';
  const signatures = value.map((candidate) => {
    const parsed = record(candidate, SIGNATURE_KEYS);
    const role = signerRole(parsed.role);
    if (
      parsed.scope !== 'READ_ONLY' ||
      typeof parsed.authorityKeyId !== 'string' ||
      parsed.authorityKeyId.length > 96 ||
      !KEY_ID_PATTERN.test(parsed.authorityKeyId) ||
      parsed.algorithm !== 'Ed25519' ||
      roles.has(role) ||
      keyIds.has(parsed.authorityKeyId) ||
      (priorRole !== '' && priorRole >= role)
    ) {
      return invalid();
    }
    canonicalBase64(parsed.valueBase64, 64);
    roles.add(role);
    keyIds.add(parsed.authorityKeyId);
    priorRole = role;
    return Object.freeze({
      role,
      scope: 'READ_ONLY' as const,
      authorityKeyId: parsed.authorityKeyId,
      algorithm: 'Ed25519' as const,
      valueBase64: parsed.valueBase64 as string,
    });
  });
  if (REQUIRED_READ_ONLY_SIGNER_ROLES.some((role) => !roles.has(role))) return invalid();
  return Object.freeze(signatures);
}

function releaseManifestIdentity(
  value: unknown,
  brandVerifier: (candidate: unknown) => boolean,
): Readonly<{ payloadSha256: string; sourceRevision: string }> {
  if (!brandVerifier(value)) return invalid();
  const manifest = record(value, RELEASE_MANIFEST_KEYS);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.artifactType !== 'CRYPTO_LENDING_RELEASE_CANDIDATE_MANIFEST' ||
    !Array.isArray(manifest.components)
  ) {
    return invalid();
  }
  const source = record(manifest.source, RELEASE_SOURCE_KEYS);
  if (
    typeof source.revision !== 'string' ||
    !SOURCE_REVISION_PATTERN.test(source.revision) ||
    typeof source.tree !== 'string' ||
    !SOURCE_TREE_PATTERN.test(source.tree)
  ) {
    return invalid();
  }
  return Object.freeze({
    payloadSha256: sha256(manifest.payloadSha256),
    sourceRevision: source.revision,
  });
}

function validateContext(
  validatedContent: ProductionEvidenceBundleContent,
  evaluatedAtValue: unknown,
  releaseManifest: unknown,
  releaseManifestBrandVerifier: (candidate: unknown) => boolean,
  targetResolver: (targetId: string, targetSha256: string) => ResolvedProductionDeploymentTarget,
  minimumEvaluatedAtMilliseconds?: number,
): number {
  const evaluatedAt = timestamp(evaluatedAtValue);
  const issuedAt = timestamp(validatedContent.issuedAt);
  const expiresAt = timestamp(validatedContent.expiresAt);
  if (
    issuedAt.milliseconds > evaluatedAt.milliseconds ||
    evaluatedAt.milliseconds >= expiresAt.milliseconds ||
    (minimumEvaluatedAtMilliseconds !== undefined &&
      evaluatedAt.milliseconds < minimumEvaluatedAtMilliseconds)
  ) {
    return invalid();
  }
  const manifest = releaseManifestIdentity(releaseManifest, releaseManifestBrandVerifier);
  if (
    manifest.payloadSha256 !== validatedContent.releaseCandidateManifestSha256 ||
    manifest.sourceRevision !== validatedContent.sourceRevision
  ) {
    return invalid();
  }
  const target = targetResolver(
    validatedContent.deploymentTargetId,
    validatedContent.deploymentTargetSha256,
  );
  validateRdsMasterLifecycleTargetBinding(validatedContent.rdsMasterLifecycleEvidence, target);
  return evaluatedAt.milliseconds;
}

export function productionEvidenceBundleSigningBytes(
  unsignedBundle: UnsignedProductionEvidenceBundle,
): Buffer {
  const unsigned = record(unsignedBundle, UNSIGNED_ROOT_KEYS);
  if (
    unsigned.schemaVersion !== PRODUCTION_EVIDENCE_BUNDLE_SCHEMA_VERSION ||
    unsigned.artifactType !== 'PRODUCTION_CONTROLLED_EVIDENCE_BUNDLE'
  ) {
    return invalid();
  }
  const validatedContent = content(unsigned.content);
  return Buffer.from(
    `${SIGNING_DOMAIN}\n${canonicalProductionEvidenceJson({
      schemaVersion: PRODUCTION_EVIDENCE_BUNDLE_SCHEMA_VERSION,
      artifactType: 'PRODUCTION_CONTROLLED_EVIDENCE_BUNDLE',
      content: validatedContent,
    })}`,
    'utf8',
  );
}

function verifyProductionEvidenceBundleBytesAgainstContext(
  bytes: Uint8Array,
  options: EvaluatedProductionEvidenceBundleOptions,
  authorityKeyRegistry: ProductionEvidenceAuthorityKeyRegistry,
  releaseManifestBrandVerifier: (candidate: unknown) => boolean,
  targetResolver: (targetId: string, targetSha256: string) => ResolvedProductionDeploymentTarget,
): Readonly<{ bundle: VerifiedProductionEvidenceBundle; evaluatedAtMilliseconds: number }> {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_PRODUCTION_EVIDENCE_BUNDLE_BYTES ||
      (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    ) {
      return invalid();
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\u0000')) return invalid();
    const parsedValue = JSON.parse(text) as unknown;
    if (canonicalProductionEvidenceJson(parsedValue) !== text) return invalid();
    const root = record(parsedValue, ROOT_KEYS);
    if (
      root.schemaVersion !== PRODUCTION_EVIDENCE_BUNDLE_SCHEMA_VERSION ||
      root.artifactType !== 'PRODUCTION_CONTROLLED_EVIDENCE_BUNDLE'
    ) {
      return invalid();
    }
    const validatedContent = content(root.content);
    const evaluatedAtMilliseconds = validateContext(
      validatedContent,
      options.evaluatedAt,
      options.releaseManifest,
      releaseManifestBrandVerifier,
      targetResolver,
    );
    const registry = authorityRegistry(authorityKeyRegistry);
    const issuedAt = timestamp(validatedContent.issuedAt);
    const expiresAt = timestamp(validatedContent.expiresAt);
    const signatures = parsedSignatures(root.signatures);
    const unsigned = Object.freeze({
      schemaVersion: PRODUCTION_EVIDENCE_BUNDLE_SCHEMA_VERSION,
      artifactType: 'PRODUCTION_CONTROLLED_EVIDENCE_BUNDLE',
      content: validatedContent,
    } as const);
    const signingBytes = productionEvidenceBundleSigningBytes(unsigned);
    const usedPublicKeys = new Set<string>();
    for (const signature of signatures) {
      const key = registry.keys.find(({ keyId }) => keyId === signature.authorityKeyId);
      if (
        key === undefined ||
        key.role !== signature.role ||
        key.scope !== signature.scope ||
        issuedAt.milliseconds < key.validFrom.milliseconds ||
        expiresAt.milliseconds > key.validUntil.milliseconds ||
        usedPublicKeys.has(key.publicKeySha256) ||
        !verifySignature(
          null,
          signingBytes,
          key.publicKey,
          canonicalBase64(signature.valueBase64, 64),
        )
      ) {
        return invalid();
      }
      usedPublicKeys.add(key.publicKeySha256);
    }
    const target = targetResolver(
      validatedContent.deploymentTargetId,
      validatedContent.deploymentTargetSha256,
    );
    const bundle = deepFreeze({
      ...unsigned,
      signatures,
      signatureValidated: true,
      verifiedSignerRoles: signatures.map(({ role }) => role),
      authorityRegistrySha256: registry.registrySha256,
      deploymentTargetRegistrySha256: target.registrySha256,
      bundleSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    return Object.freeze({ bundle, evaluatedAtMilliseconds });
  } catch {
    return invalid();
  }
}

/**
 * Cryptographic test seam. Its result is deliberately unbranded and cannot be
 * applied to a production preflight.
 */
export function verifyProductionEvidenceBundleBytesWithTestRegistries(
  bytes: Uint8Array,
  options: TestProductionEvidenceBundleVerificationOptions,
): VerifiedProductionEvidenceBundle {
  return verifyProductionEvidenceBundleBytesAgainstContext(
    bytes,
    options,
    options.authorityKeyRegistry,
    options.isReleaseManifestVerified,
    (targetId, targetSha256) =>
      resolveProductionDeploymentTargetWithTestRegistry(
        targetId,
        targetSha256,
        options.deploymentTargetRegistry,
      ),
  ).bundle;
}

export function parseAndVerifyProductionEvidenceBundleBytes(
  bytes: Uint8Array,
  options: VerifyProductionEvidenceBundleOptions,
): VerifiedProductionEvidenceBundle {
  const result = verifyProductionEvidenceBundleBytesAgainstContext(
    bytes,
    { ...options, evaluatedAt: new Date().toISOString() },
    PRODUCTION_EVIDENCE_AUTHORITY_KEY_REGISTRY,
    (candidate) => releaseCandidateManifest.isVerifiedReleaseManifest(candidate) === true,
    resolveProductionDeploymentTarget,
  );
  AUTHORIZED_BUNDLES.set(
    result.bundle,
    Object.freeze({ verifiedAtMilliseconds: result.evaluatedAtMilliseconds }),
  );
  return result.bundle;
}

export function isVerifiedProductionEvidenceBundle(
  value: unknown,
): value is VerifiedProductionEvidenceBundle {
  return typeof value === 'object' && value !== null && AUTHORIZED_BUNDLES.has(value);
}

export function revalidateProductionEvidenceBundleForApplication(
  bundle: VerifiedProductionEvidenceBundle,
  options: ProductionEvidenceApplicationOptions,
): void {
  try {
    const metadata = AUTHORIZED_BUNDLES.get(bundle);
    if (metadata === undefined) return invalid();
    if (
      options.sourceRevision !== bundle.content.sourceRevision ||
      releaseCandidateManifest.revalidateVerifiedReleaseManifest(
        options.repositoryRoot,
        options.releaseManifest,
        options.sourceRevision,
      ) !== options.releaseManifest
    ) {
      return invalid();
    }
    validateContext(
      bundle.content,
      new Date().toISOString(),
      options.releaseManifest,
      (candidate) => releaseCandidateManifest.isVerifiedReleaseManifest(candidate) === true,
      resolveProductionDeploymentTarget,
      metadata.verifiedAtMilliseconds,
    );
  } catch {
    return invalid();
  }
}

/** Freshness/context test seam; it cannot confer the production bundle brand. */
export function revalidateProductionEvidenceBundleForApplicationWithTestRegistries(
  bundle: VerifiedProductionEvidenceBundle,
  options: TestProductionEvidenceBundleVerificationOptions,
): void {
  try {
    validateContext(
      bundle.content,
      options.evaluatedAt,
      options.releaseManifest,
      options.isReleaseManifestVerified,
      (targetId, targetSha256) =>
        resolveProductionDeploymentTargetWithTestRegistry(
          targetId,
          targetSha256,
          options.deploymentTargetRegistry,
        ),
    );
  } catch {
    return invalid();
  }
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
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
    left.ctimeNs === right.ctimeNs &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function closeStableFileDescriptor(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    return invalid();
  }
}

/** Descriptor-close test seam; it cannot read or confer evidence authority. */
export function closeProductionEvidenceFileDescriptorForTest(descriptor: number): void {
  closeStableFileDescriptor(descriptor);
}

function comparablePath(value: string): string {
  let path = normalize(value);
  if (path.startsWith('\\\\?\\UNC\\')) path = `\\\\${path.slice(8)}`;
  else if (path.startsWith('\\\\?\\')) path = path.slice(4);
  path = path.replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function assertNoLinkedPathComponents(absolutePath: string): void {
  const root = parse(absolutePath).root;
  const segments = absolutePath
    .slice(root.length)
    .split(/[\\/]+/u)
    .filter(Boolean);
  if (segments.length === 0) return invalid();
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) return invalid();
    current = join(current, segment);
    const stat = lstatSync(current);
    const final = index === segments.length - 1;
    if (stat.isSymbolicLink() || (!final && !stat.isDirectory())) return invalid();
    if (comparablePath(realpathSync.native(current)) !== comparablePath(current)) return invalid();
  }
}

function readDescriptorExactly(descriptor: number, size: number): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count <= 0) return invalid();
    offset += count;
  }
  const overflow = Buffer.allocUnsafe(1);
  if (readSync(descriptor, overflow, 0, 1, size) !== 0) return invalid();
  return bytes;
}

function readBoundedStableRegularFile(path: string, afterFirstReadForTest?: () => void): Buffer {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 4_096 ||
    path.includes('\u0000')
  ) {
    return invalid();
  }
  const absolutePath = resolve(path);
  let descriptor: number | undefined;
  try {
    assertNoLinkedPathComponents(absolutePath);
    const before = lstatSync(absolutePath, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(MAX_PRODUCTION_EVIDENCE_BUNDLE_BYTES)
    ) {
      return invalid();
    }
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(before, opened)) return invalid();
    const size = Number(opened.size);
    const first = readDescriptorExactly(descriptor, size);
    afterFirstReadForTest?.();
    const afterFirst = fstatSync(descriptor, { bigint: true });
    if (!sameStableFile(opened, afterFirst)) return invalid();
    const second = readDescriptorExactly(descriptor, size);
    const afterSecond = fstatSync(descriptor, { bigint: true });
    assertNoLinkedPathComponents(absolutePath);
    const finalPath = lstatSync(absolutePath, { bigint: true });
    if (
      finalPath.isSymbolicLink() ||
      !sameStableFile(opened, afterSecond) ||
      !sameStableFile(afterSecond, finalPath) ||
      !first.equals(second)
    ) {
      return invalid();
    }
    return first;
  } catch {
    return invalid();
  } finally {
    if (descriptor !== undefined) closeStableFileDescriptor(descriptor);
  }
}

export function loadAndVerifyProductionEvidenceBundle(
  path: string,
  options: VerifyProductionEvidenceBundleOptions,
): VerifiedProductionEvidenceBundle {
  try {
    return parseAndVerifyProductionEvidenceBundleBytes(readBoundedStableRegularFile(path), options);
  } catch {
    return invalid();
  }
}

/** File-boundary test seam; like the byte seam, its result is unbranded. */
export function loadAndVerifyProductionEvidenceBundleWithTestRegistries(
  path: string,
  options: TestProductionEvidenceBundleVerificationOptions,
  afterFirstReadForTest?: () => void,
): VerifiedProductionEvidenceBundle {
  try {
    return verifyProductionEvidenceBundleBytesWithTestRegistries(
      readBoundedStableRegularFile(path, afterFirstReadForTest),
      options,
    );
  } catch {
    return invalid();
  }
}
