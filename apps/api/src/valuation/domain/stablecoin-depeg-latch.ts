import { createHash } from 'node:crypto';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import { isMainnetLaunchNetwork } from '../../blockchain/domain/mainnet-launch-network-policy';
import type {
  ClearStablecoinDepegLatchRequest,
  RecordStablecoinDepegLatchRequest,
  StablecoinDepegRecoveryAuthorization,
} from '../application/ports/stablecoin-depeg-latch.port';
import {
  evaluateStablecoinRecovery,
  evaluateStablecoinValuation,
  type StablecoinRecoveryRequest,
  type StablecoinValuationAssetReference,
  type StablecoinValuationRequest,
} from './stablecoin-valuation-policy';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ASSET_KEYS = Object.freeze([
  'registryEnvironment',
  'registryVersion',
  'registryFingerprintSha256',
  'stablecoin',
  'networkId',
  'identity',
  'decimals',
] as const);
const RECORD_KEYS = Object.freeze([
  'expectedRevision',
  'correlationId',
  'latchId',
  'evidenceActorReferenceId',
  'depegEvidenceFingerprintSha256',
  'valuationRequest',
] as const);
const CLEAR_KEYS = Object.freeze([
  'evaluatedAt',
  'correlationId',
  'recoveryRequest',
  'authorization',
] as const);
const AUTHORIZATION_MATERIAL_KEYS = Object.freeze([
  'schemaVersion',
  'authorizationType',
  'scope',
  'mayAuthorizeFinancialAction',
  'operation',
  'asset',
  'expectedLatchId',
  'expectedRevision',
  'clearId',
  'recoveryEvidenceFingerprintSha256',
  'evidenceActorReferenceId',
  'riskApproverReferenceId',
  'riskApproverRole',
  'issuedAt',
  'notBefore',
  'expiresAt',
  'nonce',
] as const);
const AUTHORIZATION_KEYS = Object.freeze([
  ...AUTHORIZATION_MATERIAL_KEYS,
  'authorizationFingerprintSha256',
  'authorizationId',
] as const);
const DEPEG_EVIDENCE_FINGERPRINT_DOMAIN = 'crypto-lending:stablecoin-depeg-evidence:v1';
const RECOVERY_EVIDENCE_FINGERPRINT_DOMAIN = 'crypto-lending:stablecoin-depeg-recovery-evidence:v1';
const LATCH_COMMAND_FINGERPRINT_DOMAIN = 'crypto-lending:stablecoin-depeg-latch-command:v1';
const LATCH_EVENT_FINGERPRINT_DOMAIN = 'crypto-lending:stablecoin-depeg-latch-event:v1';
const RECOVERY_AUTHORIZATION_FINGERPRINT_DOMAIN =
  'crypto-lending:stablecoin-depeg-recovery-authorization:v1';
const CLEAR_COMMAND_FINGERPRINT_DOMAIN = 'crypto-lending:stablecoin-depeg-clear-command:v1';
const CLEAR_EVENT_FINGERPRINT_DOMAIN = 'crypto-lending:stablecoin-depeg-clear-event:v1';
const AUTHORIZATION_ID_PREFIX = 'stablecoin-depeg-latch-recovery:';

export const STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION = 1 as const;
export const STABLECOIN_DEPEG_RECOVERY_AUTHORIZATION_MAXIMUM_AGE_MILLISECONDS = 15 * 60 * 1_000;

export type StablecoinDepegLatchValidationCode =
  | 'INVALID_DEPEG_LATCH_INPUT'
  | 'INVALID_DEPEG_LATCH_ASSET'
  | 'VALUATION_DID_NOT_DETECT_DEPEG'
  | 'DEPEG_EVIDENCE_FINGERPRINT_MISMATCH'
  | 'INVALID_DEPEG_RECOVERY_INPUT'
  | 'RECOVERY_NOT_CLEARED'
  | 'INVALID_DEPEG_RECOVERY_AUTHORIZATION'
  | 'DEPEG_RECOVERY_AUTHORIZATION_MISMATCH';

export class StablecoinDepegLatchValidationError extends Error {
  constructor(readonly code: StablecoinDepegLatchValidationCode) {
    super('Stablecoin depeg latch input is invalid');
    this.name = 'StablecoinDepegLatchValidationError';
  }
}

export interface StablecoinDepegEvidenceFingerprintMaterial {
  readonly evidenceActorReferenceId: string;
  readonly valuationRequest: StablecoinValuationRequest;
}

export type StablecoinDepegRecoveryAuthorizationFingerprintMaterial = Omit<
  StablecoinDepegRecoveryAuthorization,
  'authorizationFingerprintSha256' | 'authorizationId'
>;

export interface NormalizedRecordStablecoinDepegLatchCommand {
  readonly schemaVersion: 1;
  readonly asset: StablecoinValuationAssetReference;
  readonly expectedRevision: number | null;
  readonly correlationId: string;
  readonly latchId: string;
  readonly latchedAt: string;
  readonly evidenceActorReferenceId: string;
  readonly depegEvidenceFingerprintSha256: string;
  readonly commandFingerprintSha256: string;
  readonly eventFingerprintSha256: string;
}

export interface NormalizedClearStablecoinDepegLatchCommand {
  readonly schemaVersion: 1;
  readonly asset: StablecoinValuationAssetReference;
  readonly evaluatedAt: string;
  readonly correlationId: string;
  readonly clearId: string;
  readonly latchId: string;
  readonly latchedAt: string;
  readonly expectedRevision: number;
  readonly recoveryEvidenceFingerprintSha256: string;
  readonly evidenceActorReferenceId: string;
  readonly riskApproverReferenceId: string;
  readonly riskApproverRole: 'RISK_APPROVER';
  readonly clearedAt: string;
  readonly authorizationIssuedAt: string;
  readonly authorizationNotBefore: string;
  readonly authorizationExpiresAt: string;
  readonly authorizationNonce: string;
  readonly authorizationFingerprintSha256: string;
  readonly authorizationId: string;
  readonly commandFingerprintSha256: string;
  readonly eventFingerprintSha256: string;
}

interface ParsedTimestamp {
  readonly text: string;
  readonly milliseconds: number;
}

interface ValidatedRecoveryEvidence {
  readonly asset: StablecoinValuationAssetReference;
  readonly latchId: string;
  readonly latchedAt: string;
  readonly clearId: string;
  readonly clearedAt: string;
  readonly evaluatedAt: string;
  readonly fingerprintSha256: string;
}

type PlainRecord = Readonly<Record<string, unknown>>;

function invalid(code: StablecoinDepegLatchValidationCode): never {
  throw new StablecoinDepegLatchValidationError(code);
}

function ownDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: StablecoinDepegLatchValidationCode,
): PlainRecord {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid(code);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof StablecoinDepegLatchValidationError) throw error;
    return invalid(code);
  }
}

function parseTimestamp(value: unknown, code: StablecoinDepegLatchValidationCode): ParsedTimestamp {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return invalid(code);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return invalid(code);
  if (new Date(milliseconds).toISOString() !== value) return invalid(code);
  return Object.freeze({ text: value, milliseconds });
}

function parseUuid(value: unknown, code: StablecoinDepegLatchValidationCode): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return invalid(code);
  return value;
}

function parseDigest(value: unknown, code: StablecoinDepegLatchValidationCode): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return invalid(code);
  return value;
}

function parseReference(value: unknown, code: StablecoinDepegLatchValidationCode): string {
  if (typeof value !== 'string' || !REFERENCE.test(value)) return invalid(code);
  return value;
}

function parseRevision(
  value: unknown,
  nullable: boolean,
  code: StablecoinDepegLatchValidationCode,
): number | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >= Number.MAX_SAFE_INTEGER
  ) {
    return invalid(code);
  }
  return value;
}

export function normalizeStablecoinDepegLatchAsset(
  value: unknown,
): StablecoinValuationAssetReference {
  const code = 'INVALID_DEPEG_LATCH_ASSET' as const;
  const record = ownDataRecord(value, ASSET_KEYS, code);
  if (
    record.registryEnvironment !== 'MAINNET' ||
    record.registryVersion !== 1 ||
    typeof record.registryFingerprintSha256 !== 'string' ||
    record.registryFingerprintSha256 !==
      MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 ||
    typeof record.stablecoin !== 'string' ||
    typeof record.networkId !== 'string' ||
    !isMainnetLaunchNetwork(record.networkId) ||
    typeof record.identity !== 'string' ||
    typeof record.decimals !== 'number' ||
    !Number.isSafeInteger(record.decimals)
  ) {
    return invalid(code);
  }
  const snapshot = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(1);
  const registered = snapshot?.identifyAsset(record.networkId, record.identity);
  const network = snapshot?.networks.find(({ networkId }) => networkId === record.networkId);
  if (
    snapshot === undefined ||
    registered === undefined ||
    network?.activationState !== 'ACTIVE' ||
    registered.activationState !== 'ACTIVE' ||
    registered.stablecoin !== record.stablecoin ||
    registered.identity !== record.identity ||
    registered.decimals !== record.decimals
  ) {
    return invalid(code);
  }
  return Object.freeze({
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: snapshot.fingerprintSha256,
    stablecoin: registered.stablecoin,
    networkId: registered.networkId,
    identity: registered.identity,
    decimals: registered.decimals,
  });
}

function sameAsset(
  first: StablecoinValuationAssetReference,
  second: StablecoinValuationAssetReference,
): boolean {
  return (
    first.registryEnvironment === second.registryEnvironment &&
    first.registryVersion === second.registryVersion &&
    first.registryFingerprintSha256 === second.registryFingerprintSha256 &&
    first.stablecoin === second.stablecoin &&
    first.networkId === second.networkId &&
    first.identity === second.identity &&
    first.decimals === second.decimals
  );
}

function canonicalJson(value: unknown): string {
  let remainingNodes = 512;
  const encode = (candidate: unknown, depth: number): string => {
    remainingNodes -= 1;
    if (remainingNodes < 0 || depth > 12) return invalid('INVALID_DEPEG_LATCH_INPUT');
    if (candidate === null || typeof candidate === 'boolean') return JSON.stringify(candidate);
    if (typeof candidate === 'string') {
      if (candidate.length > 4_096 || /[\0\r\n]/u.test(candidate)) {
        return invalid('INVALID_DEPEG_LATCH_INPUT');
      }
      return JSON.stringify(candidate);
    }
    if (typeof candidate === 'number') {
      if (!Number.isSafeInteger(candidate) || candidate < 0) {
        return invalid('INVALID_DEPEG_LATCH_INPUT');
      }
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > 32) return invalid('INVALID_DEPEG_LATCH_INPUT');
      return `[${candidate.map((item) => encode(item, depth + 1)).join(',')}]`;
    }
    if (typeof candidate !== 'object' || candidate === null) {
      return invalid('INVALID_DEPEG_LATCH_INPUT');
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid('INVALID_DEPEG_LATCH_INPUT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 64 || keys.some((key) => typeof key !== 'string')) {
      return invalid('INVALID_DEPEG_LATCH_INPUT');
    }
    const stringKeys = keys as string[];
    const entries = stringKeys.sort().map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return invalid('INVALID_DEPEG_LATCH_INPUT');
      }
      return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
    });
    return `{${entries.join(',')}}`;
  };
  return encode(value, 0);
}

function fingerprint(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\n`, 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function validateDepegEvidence(
  valuationRequest: unknown,
  evidenceActorReferenceId: string,
): Readonly<{
  asset: StablecoinValuationAssetReference;
  evaluatedAt: string;
  fingerprintSha256: string;
}> {
  const request = ownDataRecord(
    valuationRequest,
    ['asset', 'amountAtomic', 'evaluatedAt', 'sourceWatermarks', 'observations'],
    'INVALID_DEPEG_LATCH_INPUT',
  ) as unknown as StablecoinValuationRequest;
  const asset = normalizeStablecoinDepegLatchAsset(request.asset);
  const result = evaluateStablecoinValuation(request);
  if (
    result.asset === null ||
    !sameAsset(result.asset, asset) ||
    result.evaluatedAt === null ||
    result.evaluatedAt !== request.evaluatedAt ||
    result.depegClass !== 'OUTSIDE_POLICY' ||
    result.downsideBand !== 'DEPEGGED' ||
    !result.reasons.includes('DEPEG_DETECTED') ||
    result.mayIncreaseBuyingPower !== false ||
    result.mayAuthorizeFinancialUse !== false
  ) {
    return invalid('VALUATION_DID_NOT_DETECT_DEPEG');
  }
  parseTimestamp(result.evaluatedAt, 'INVALID_DEPEG_LATCH_INPUT');
  const fingerprintSha256 = fingerprint(DEPEG_EVIDENCE_FINGERPRINT_DOMAIN, [
    STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION,
    evidenceActorReferenceId,
    request,
  ]);
  return Object.freeze({ asset, evaluatedAt: result.evaluatedAt, fingerprintSha256 });
}

export function fingerprintStablecoinDepegEvidence(
  value: StablecoinDepegEvidenceFingerprintMaterial,
): string {
  const record = ownDataRecord(
    value,
    ['evidenceActorReferenceId', 'valuationRequest'],
    'INVALID_DEPEG_LATCH_INPUT',
  );
  const actor = parseReference(record.evidenceActorReferenceId, 'INVALID_DEPEG_LATCH_INPUT');
  return validateDepegEvidence(record.valuationRequest, actor).fingerprintSha256;
}

export function normalizeRecordStablecoinDepegLatchCommand(
  value: RecordStablecoinDepegLatchRequest,
): NormalizedRecordStablecoinDepegLatchCommand {
  const record = ownDataRecord(value, RECORD_KEYS, 'INVALID_DEPEG_LATCH_INPUT');
  const expectedRevision = parseRevision(
    record.expectedRevision,
    true,
    'INVALID_DEPEG_LATCH_INPUT',
  );
  const correlationId = parseUuid(record.correlationId, 'INVALID_DEPEG_LATCH_INPUT');
  const latchId = parseDigest(record.latchId, 'INVALID_DEPEG_LATCH_INPUT');
  const evidenceActorReferenceId = parseReference(
    record.evidenceActorReferenceId,
    'INVALID_DEPEG_LATCH_INPUT',
  );
  const requestedFingerprint = parseDigest(
    record.depegEvidenceFingerprintSha256,
    'INVALID_DEPEG_LATCH_INPUT',
  );
  const evidence = validateDepegEvidence(record.valuationRequest, evidenceActorReferenceId);
  if (requestedFingerprint !== evidence.fingerprintSha256) {
    return invalid('DEPEG_EVIDENCE_FINGERPRINT_MISMATCH');
  }
  const commandFingerprintSha256 = fingerprint(LATCH_COMMAND_FINGERPRINT_DOMAIN, [
    STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION,
    evidence.asset,
    expectedRevision,
    correlationId,
    latchId,
    evidence.evaluatedAt,
    evidenceActorReferenceId,
    requestedFingerprint,
  ]);
  const eventFingerprintSha256 = fingerprint(LATCH_EVENT_FINGERPRINT_DOMAIN, [
    commandFingerprintSha256,
    expectedRevision === null ? 1 : expectedRevision + 1,
    'LATCHED',
  ]);
  return Object.freeze({
    schemaVersion: STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION,
    asset: evidence.asset,
    expectedRevision,
    correlationId,
    latchId,
    latchedAt: evidence.evaluatedAt,
    evidenceActorReferenceId,
    depegEvidenceFingerprintSha256: requestedFingerprint,
    commandFingerprintSha256,
    eventFingerprintSha256,
  });
}

function validateRecoveryEvidence(value: unknown): ValidatedRecoveryEvidence {
  const request = ownDataRecord(
    value,
    ['asset', 'evaluatedAt', 'depegLatch', 'manualRiskClear', 'samples'],
    'INVALID_DEPEG_RECOVERY_INPUT',
  ) as unknown as StablecoinRecoveryRequest;
  const asset = normalizeStablecoinDepegLatchAsset(request.asset);
  const result = evaluateStablecoinRecovery(request);
  if (
    result.status !== 'RECOVERY_CANDIDATE_CLEARED' ||
    result.manualRiskClearAccepted !== true ||
    result.asset === null ||
    !sameAsset(result.asset, asset) ||
    result.depegLatch === null ||
    result.acceptedManualRiskClear === null ||
    result.evaluatedAt !== request.evaluatedAt ||
    result.mayIncreaseBuyingPower !== false ||
    result.mayAuthorizeFinancialUse !== false
  ) {
    return invalid('RECOVERY_NOT_CLEARED');
  }
  const depegAsset = normalizeStablecoinDepegLatchAsset(result.depegLatch.asset);
  const clearAsset = normalizeStablecoinDepegLatchAsset(result.acceptedManualRiskClear.asset);
  if (!sameAsset(asset, depegAsset) || !sameAsset(asset, clearAsset)) {
    return invalid('RECOVERY_NOT_CLEARED');
  }
  const latchId = parseDigest(result.depegLatch.latchId, 'INVALID_DEPEG_RECOVERY_INPUT');
  const clearId = parseDigest(
    result.acceptedManualRiskClear.clearId,
    'INVALID_DEPEG_RECOVERY_INPUT',
  );
  const latchedAt = parseTimestamp(
    result.depegLatch.latchedAt,
    'INVALID_DEPEG_RECOVERY_INPUT',
  ).text;
  const clearedAt = parseTimestamp(
    result.acceptedManualRiskClear.clearedAt,
    'INVALID_DEPEG_RECOVERY_INPUT',
  ).text;
  const evaluatedAt = parseTimestamp(result.evaluatedAt, 'INVALID_DEPEG_RECOVERY_INPUT').text;
  const fingerprintSha256 = fingerprint(RECOVERY_EVIDENCE_FINGERPRINT_DOMAIN, [
    STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION,
    request,
  ]);
  return Object.freeze({
    asset,
    latchId,
    latchedAt,
    clearId,
    clearedAt,
    evaluatedAt,
    fingerprintSha256,
  });
}

export function fingerprintStablecoinDepegRecoveryEvidence(
  value: StablecoinRecoveryRequest,
): string {
  return validateRecoveryEvidence(value).fingerprintSha256;
}

function normalizeAuthorizationMaterial(
  value: unknown,
): StablecoinDepegRecoveryAuthorizationFingerprintMaterial {
  const record = ownDataRecord(
    value,
    AUTHORIZATION_MATERIAL_KEYS,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  );
  if (
    record.schemaVersion !== STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION ||
    record.authorizationType !== 'STABLECOIN_DEPEG_LATCH_RECOVERY' ||
    record.scope !== 'DEPEG_LATCH_CLEAR_ONLY' ||
    record.mayAuthorizeFinancialAction !== false ||
    record.operation !== 'CLEAR_STABLECOIN_DEPEG_LATCH' ||
    record.riskApproverRole !== 'RISK_APPROVER'
  ) {
    return invalid('INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  }
  const asset = normalizeStablecoinDepegLatchAsset(record.asset);
  const expectedLatchId = parseDigest(
    record.expectedLatchId,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  );
  const expectedRevision = parseRevision(
    record.expectedRevision,
    false,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  );
  if (expectedRevision === null) return invalid('INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  const clearId = parseDigest(record.clearId, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  const recoveryEvidenceFingerprintSha256 = parseDigest(
    record.recoveryEvidenceFingerprintSha256,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  );
  const evidenceActorReferenceId = parseReference(
    record.evidenceActorReferenceId,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  );
  const riskApproverReferenceId = parseReference(
    record.riskApproverReferenceId,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  );
  if (evidenceActorReferenceId === riskApproverReferenceId || expectedLatchId === clearId) {
    return invalid('INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  }
  const issuedAt = parseTimestamp(record.issuedAt, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  const notBefore = parseTimestamp(record.notBefore, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  const expiresAt = parseTimestamp(record.expiresAt, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  if (
    issuedAt.milliseconds > notBefore.milliseconds ||
    expiresAt.milliseconds <= notBefore.milliseconds ||
    expiresAt.milliseconds - issuedAt.milliseconds >
      STABLECOIN_DEPEG_RECOVERY_AUTHORIZATION_MAXIMUM_AGE_MILLISECONDS
  ) {
    return invalid('INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  }
  return Object.freeze({
    schemaVersion: STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION,
    authorizationType: 'STABLECOIN_DEPEG_LATCH_RECOVERY',
    scope: 'DEPEG_LATCH_CLEAR_ONLY',
    mayAuthorizeFinancialAction: false,
    operation: 'CLEAR_STABLECOIN_DEPEG_LATCH',
    asset,
    expectedLatchId,
    expectedRevision,
    clearId,
    recoveryEvidenceFingerprintSha256,
    evidenceActorReferenceId,
    riskApproverReferenceId,
    riskApproverRole: 'RISK_APPROVER',
    issuedAt: issuedAt.text,
    notBefore: notBefore.text,
    expiresAt: expiresAt.text,
    nonce: parseUuid(record.nonce, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION'),
  });
}

export function fingerprintStablecoinDepegRecoveryAuthorization(
  value: StablecoinDepegRecoveryAuthorizationFingerprintMaterial,
): string {
  const material = normalizeAuthorizationMaterial(value);
  return fingerprint(RECOVERY_AUTHORIZATION_FINGERPRINT_DOMAIN, [
    material.schemaVersion,
    material.authorizationType,
    material.scope,
    material.mayAuthorizeFinancialAction,
    material.operation,
    material.asset,
    material.expectedLatchId,
    material.expectedRevision,
    material.clearId,
    material.recoveryEvidenceFingerprintSha256,
    material.evidenceActorReferenceId,
    material.riskApproverReferenceId,
    material.riskApproverRole,
    material.issuedAt,
    material.notBefore,
    material.expiresAt,
    material.nonce,
  ]);
}

function normalizeAuthorization(value: unknown): StablecoinDepegRecoveryAuthorization {
  const record = ownDataRecord(value, AUTHORIZATION_KEYS, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  const materialInput = Object.create(null) as Record<string, unknown>;
  for (const key of AUTHORIZATION_MATERIAL_KEYS) materialInput[key] = record[key];
  const material = normalizeAuthorizationMaterial(materialInput);
  const authorizationFingerprintSha256 = parseDigest(
    record.authorizationFingerprintSha256,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  );
  const expectedFingerprint = fingerprintStablecoinDepegRecoveryAuthorization(material);
  if (authorizationFingerprintSha256 !== expectedFingerprint) {
    return invalid('INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  }
  const authorizationId = record.authorizationId;
  if (authorizationId !== `${AUTHORIZATION_ID_PREFIX}${authorizationFingerprintSha256}`) {
    return invalid('INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  }
  return Object.freeze({
    ...material,
    authorizationFingerprintSha256,
    authorizationId,
  });
}

export function normalizeClearStablecoinDepegLatchCommand(
  value: ClearStablecoinDepegLatchRequest,
): NormalizedClearStablecoinDepegLatchCommand {
  const record = ownDataRecord(value, CLEAR_KEYS, 'INVALID_DEPEG_RECOVERY_INPUT');
  const evaluatedAt = parseTimestamp(record.evaluatedAt, 'INVALID_DEPEG_RECOVERY_INPUT');
  const correlationId = parseUuid(record.correlationId, 'INVALID_DEPEG_RECOVERY_INPUT');
  const recovery = validateRecoveryEvidence(record.recoveryRequest);
  const authorization = normalizeAuthorization(record.authorization);
  const issuedAt = parseTimestamp(authorization.issuedAt, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  const notBefore = parseTimestamp(authorization.notBefore, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  const expiresAt = parseTimestamp(authorization.expiresAt, 'INVALID_DEPEG_RECOVERY_AUTHORIZATION');
  if (
    recovery.evaluatedAt !== evaluatedAt.text ||
    !sameAsset(recovery.asset, authorization.asset) ||
    recovery.latchId !== authorization.expectedLatchId ||
    recovery.clearId !== authorization.clearId ||
    recovery.clearedAt !== authorization.issuedAt ||
    recovery.fingerprintSha256 !== authorization.recoveryEvidenceFingerprintSha256 ||
    evaluatedAt.milliseconds < notBefore.milliseconds ||
    evaluatedAt.milliseconds >= expiresAt.milliseconds ||
    issuedAt.milliseconds > evaluatedAt.milliseconds
  ) {
    return invalid('DEPEG_RECOVERY_AUTHORIZATION_MISMATCH');
  }
  const commandFingerprintSha256 = fingerprint(CLEAR_COMMAND_FINGERPRINT_DOMAIN, [
    STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION,
    recovery.asset,
    evaluatedAt.text,
    correlationId,
    recovery.clearId,
    recovery.latchId,
    recovery.latchedAt,
    authorization.expectedRevision,
    recovery.fingerprintSha256,
    authorization.evidenceActorReferenceId,
    authorization.riskApproverReferenceId,
    authorization.riskApproverRole,
    recovery.clearedAt,
    authorization.issuedAt,
    authorization.notBefore,
    authorization.expiresAt,
    authorization.nonce,
    authorization.authorizationFingerprintSha256,
    authorization.authorizationId,
  ]);
  const eventFingerprintSha256 = fingerprint(CLEAR_EVENT_FINGERPRINT_DOMAIN, [
    commandFingerprintSha256,
    authorization.expectedRevision + 1,
    'CLEARED',
  ]);
  return Object.freeze({
    schemaVersion: STABLECOIN_DEPEG_LATCH_SCHEMA_VERSION,
    asset: recovery.asset,
    evaluatedAt: evaluatedAt.text,
    correlationId,
    clearId: recovery.clearId,
    latchId: recovery.latchId,
    latchedAt: recovery.latchedAt,
    expectedRevision: authorization.expectedRevision,
    recoveryEvidenceFingerprintSha256: recovery.fingerprintSha256,
    evidenceActorReferenceId: authorization.evidenceActorReferenceId,
    riskApproverReferenceId: authorization.riskApproverReferenceId,
    riskApproverRole: authorization.riskApproverRole,
    clearedAt: recovery.clearedAt,
    authorizationIssuedAt: authorization.issuedAt,
    authorizationNotBefore: authorization.notBefore,
    authorizationExpiresAt: authorization.expiresAt,
    authorizationNonce: authorization.nonce,
    authorizationFingerprintSha256: authorization.authorizationFingerprintSha256,
    authorizationId: authorization.authorizationId,
    commandFingerprintSha256,
    eventFingerprintSha256,
  });
}

/** Convenience helper for tests and future approved issuers; it does not authenticate a signer. */
export function stablecoinDepegRecoveryAuthorizationId(fingerprintSha256: string): string {
  return `${AUTHORIZATION_ID_PREFIX}${parseDigest(
    fingerprintSha256,
    'INVALID_DEPEG_RECOVERY_AUTHORIZATION',
  )}`;
}

export function stablecoinDepegLatchAssetKey(
  assetValue: StablecoinValuationAssetReference,
): string {
  const asset = normalizeStablecoinDepegLatchAsset(assetValue);
  return fingerprint('crypto-lending:stablecoin-depeg-latch-asset-key:v1', asset);
}

export function supportedStablecoinForDepegLatch(value: unknown): SupportedStablecoin {
  return normalizeStablecoinDepegLatchAsset(value).stablecoin;
}
