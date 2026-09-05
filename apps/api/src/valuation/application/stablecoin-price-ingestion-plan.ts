import { createHash } from 'node:crypto';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  SUPPORTED_STABLECOINS,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import {
  MAINNET_LAUNCH_NETWORK_IDS,
  type MainnetLaunchNetworkId,
} from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_POLICY_VERSION,
  STABLECOIN_VALUATION_SOURCES,
  type StablecoinPriceConfidence,
  type StablecoinValuationAssetReference,
  type StablecoinValuationSourceId,
} from '../domain/stablecoin-valuation-policy';
import type {
  MainnetStablecoin,
  VerifiedStablecoinPriceEvidenceV1,
  VerifiedStablecoinPriceVerificationMethod,
  VerifiedStablecoinUsdPriceV1,
} from './ports/verified-stablecoin-price-source.port';

const SHA256 = /^[0-9a-f]{64}$/u;
const CANONICAL_INTEGER = /^(0|[1-9][0-9]*)$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const ACTOR_REFERENCE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_INTEGER_DIGITS = 78;
const POLICY_IDENTITY_KEYS = Object.freeze([
  'policyId',
  'policyVersion',
  'policyDecisionSha256',
] as const);
const PRICE_KEYS = Object.freeze(['mantissa', 'scale'] as const);
const EVIDENCE_MATERIAL_KEYS = Object.freeze([
  'schemaVersion',
  'policyId',
  'policyVersion',
  'policyDecisionSha256',
  'registryEnvironment',
  'registryVersion',
  'registryFingerprintSha256',
  'sourceId',
  'sourceReference',
  'stablecoin',
  'authenticatedSourceUpdateId',
  'monotonicSourceSequence',
  'usdPrice',
  'confidence',
  'pricedAt',
  'observedAt',
  'verificationMethod',
  'verifiedAt',
  'evidenceActorReferenceId',
  'mayAuthorizeFinancialAction',
] as const);
const EVIDENCE_KEYS = Object.freeze([
  ...EVIDENCE_MATERIAL_KEYS,
  'evidenceFingerprintSha256',
] as const);
const INGESTION_PLAN_SCHEMA_VERSION = 1 as const;
const EVIDENCE_SCHEMA_VERSION = 1 as const;
const POLICY_ID = 'KAN-66' as const;
const REGISTRY_ENVIRONMENT = 'MAINNET' as const;
const REGISTRY_VERSION = 1 as const;
const LOGICAL_READ_COUNT = 6 as const;
const PROJECTION_COUNT = 12 as const;

const VERIFICATION_METHODS = Object.freeze({
  PYTH_CORE: 'PYTH_WORMHOLE_BINARY_UPDATE_SIGNATURE_VERIFIED',
  CHAINLINK_DATA_FEEDS: 'CHAINLINK_ETHEREUM_FINALIZED_ONCHAIN_ROUND_VERIFIED',
} as const satisfies Record<
  StablecoinValuationSourceId,
  VerifiedStablecoinPriceVerificationMethod
>);

const CREATED_PLANS = new WeakSet<object>();
const CREATED_PROJECTION_BATCHES = new WeakSet<object>();

export interface StablecoinPricePolicyIdentityV1 {
  readonly policyId: typeof POLICY_ID;
  readonly policyVersion: typeof STABLECOIN_VALUATION_POLICY_VERSION;
  /** Exact SHA-256 from the independently selected KAN-66 decision artifact. */
  readonly policyDecisionSha256: string;
}

export interface StablecoinPriceLogicalReadV1 {
  readonly readId: string;
  readonly sourceId: StablecoinValuationSourceId;
  /** Reviewed feed identifier only; never a URL, host, credential, or token. */
  readonly sourceReference: string;
  readonly stablecoin: MainnetStablecoin;
  readonly verificationMethod: VerifiedStablecoinPriceVerificationMethod;
}

export interface StablecoinPriceProjectionTargetV1 {
  readonly projectionId: string;
  readonly readId: string;
  readonly asset: StablecoinValuationAssetReference;
}

export interface StablecoinPriceIngestionPlanV1 {
  readonly schemaVersion: typeof INGESTION_PLAN_SCHEMA_VERSION;
  readonly policyIdentity: StablecoinPricePolicyIdentityV1;
  readonly registryEnvironment: typeof REGISTRY_ENVIRONMENT;
  readonly registryVersion: typeof REGISTRY_VERSION;
  readonly registryFingerprintSha256: string;
  readonly logicalReadCount: typeof LOGICAL_READ_COUNT;
  readonly projectionCount: typeof PROJECTION_COUNT;
  readonly logicalReads: readonly StablecoinPriceLogicalReadV1[];
  readonly projections: readonly StablecoinPriceProjectionTargetV1[];
  readonly mayAuthorizeFinancialAction: false;
}

export type VerifiedStablecoinPriceEvidenceMaterialV1 = Omit<
  VerifiedStablecoinPriceEvidenceV1,
  'evidenceFingerprintSha256'
>;

export interface VerifiedStablecoinPriceProjectionV1 {
  readonly schemaVersion: typeof INGESTION_PLAN_SCHEMA_VERSION;
  readonly projectionId: string;
  readonly readId: string;
  readonly asset: StablecoinValuationAssetReference;
  readonly evidence: VerifiedStablecoinPriceEvidenceV1;
  readonly mayAuthorizeFinancialAction: false;
}

export interface VerifiedStablecoinPriceProjectionBatchV1 {
  readonly schemaVersion: typeof INGESTION_PLAN_SCHEMA_VERSION;
  readonly policyIdentity: StablecoinPricePolicyIdentityV1;
  readonly registryEnvironment: typeof REGISTRY_ENVIRONMENT;
  readonly registryVersion: typeof REGISTRY_VERSION;
  readonly registryFingerprintSha256: string;
  readonly evidenceCount: typeof LOGICAL_READ_COUNT;
  readonly projectionCount: typeof PROJECTION_COUNT;
  readonly projections: readonly VerifiedStablecoinPriceProjectionV1[];
  readonly mayAuthorizeFinancialAction: false;
}

export type StablecoinPriceIngestionPlanValidationCode =
  | 'INVALID_POLICY_IDENTITY'
  | 'INVALID_INGESTION_PLAN'
  | 'INVALID_VERIFIED_PRICE_PROJECTION_BATCH'
  | 'INVALID_VERIFIED_PRICE_EVIDENCE'
  | 'VERIFIED_PRICE_EVIDENCE_MISMATCH'
  | 'DUPLICATE_VERIFIED_PRICE_EVIDENCE'
  | 'INCOMPLETE_VERIFIED_PRICE_EVIDENCE_SET';

export class StablecoinPriceIngestionPlanValidationError extends Error {
  constructor(readonly code: StablecoinPriceIngestionPlanValidationCode) {
    super('Stablecoin price ingestion input is invalid.');
    this.name = 'StablecoinPriceIngestionPlanValidationError';
  }
}

/**
 * Builds the complete launch topology without reading a provider, chain,
 * clock, environment variable, or database. The policy digest is injected so
 * a later reviewed activation can bind the exact KAN-66 artifact without this
 * dormant slice claiming that review has occurred.
 */
export function createStablecoinPriceIngestionPlan(
  policyIdentityInput: unknown,
): StablecoinPriceIngestionPlanV1 {
  const policyIdentity = normalizePolicyIdentity(policyIdentityInput);
  const snapshot = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(REGISTRY_VERSION);
  if (
    snapshot === undefined ||
    snapshot.environment !== REGISTRY_ENVIRONMENT ||
    snapshot !== MAINNET_SUPPORTED_ASSET_REGISTRY.latest ||
    !SHA256.test(snapshot.fingerprintSha256)
  ) {
    return invalid('INVALID_INGESTION_PLAN');
  }

  const logicalReads = Object.freeze(
    STABLECOIN_VALUATION_SOURCES.flatMap((sourceId) =>
      SUPPORTED_STABLECOINS.map((stablecoin) => logicalRead(sourceId, stablecoin)),
    ),
  );
  const projections = Object.freeze(
    logicalReads.flatMap((read) =>
      MAINNET_LAUNCH_NETWORK_IDS.map((networkId) => projectionTarget(read, networkId)),
    ),
  );
  if (logicalReads.length !== LOGICAL_READ_COUNT || projections.length !== PROJECTION_COUNT) {
    return invalid('INVALID_INGESTION_PLAN');
  }

  const plan = Object.freeze({
    schemaVersion: INGESTION_PLAN_SCHEMA_VERSION,
    policyIdentity,
    registryEnvironment: REGISTRY_ENVIRONMENT,
    registryVersion: REGISTRY_VERSION,
    registryFingerprintSha256: snapshot.fingerprintSha256,
    logicalReadCount: LOGICAL_READ_COUNT,
    projectionCount: PROJECTION_COUNT,
    logicalReads,
    projections,
    mayAuthorizeFinancialAction: false as const,
  });
  CREATED_PLANS.add(plan);
  return plan;
}

/** Accepts only an in-process immutable plan created by the factory above. */
export function assertCanonicalStablecoinPriceIngestionPlan(
  value: unknown,
): asserts value is StablecoinPriceIngestionPlanV1 {
  if (typeof value !== 'object' || value === null || !CREATED_PLANS.has(value)) {
    return invalid('INVALID_INGESTION_PLAN');
  }
}

/** Accepts only an immutable projection batch created by this in-process boundary. */
export function assertCanonicalVerifiedStablecoinPriceProjectionBatch(
  value: unknown,
): asserts value is VerifiedStablecoinPriceProjectionBatchV1 {
  if (typeof value !== 'object' || value === null || !CREATED_PROJECTION_BATCHES.has(value)) {
    return invalid('INVALID_VERIFIED_PRICE_PROJECTION_BATCH');
  }
}

/** Computes the fingerprint over every evidence field except the fingerprint itself. */
export function fingerprintVerifiedStablecoinPriceEvidence(evidenceMaterialInput: unknown): string {
  const evidence = normalizeEvidenceMaterial(evidenceMaterialInput);
  return evidenceFingerprint(evidence);
}

/** Validates one source result against one exact logical read in a canonical plan. */
export function normalizeVerifiedStablecoinPriceEvidence(
  plan: StablecoinPriceIngestionPlanV1,
  logicalRead: StablecoinPriceLogicalReadV1,
  evidenceInput: unknown,
): VerifiedStablecoinPriceEvidenceV1 {
  assertCreatedPlan(plan);
  if (!plan.logicalReads.includes(logicalRead)) return invalid('INVALID_INGESTION_PLAN');
  const record = exactDataRecord(evidenceInput, EVIDENCE_KEYS, 'INVALID_VERIFIED_PRICE_EVIDENCE');
  const materialInput = Object.fromEntries(EVIDENCE_MATERIAL_KEYS.map((key) => [key, record[key]]));
  const material = normalizeEvidenceMaterial(materialInput);
  if (
    material.policyId !== plan.policyIdentity.policyId ||
    material.policyVersion !== plan.policyIdentity.policyVersion ||
    material.policyDecisionSha256 !== plan.policyIdentity.policyDecisionSha256 ||
    material.registryEnvironment !== plan.registryEnvironment ||
    material.registryVersion !== plan.registryVersion ||
    material.registryFingerprintSha256 !== plan.registryFingerprintSha256 ||
    material.sourceId !== logicalRead.sourceId ||
    material.sourceReference !== logicalRead.sourceReference ||
    material.stablecoin !== logicalRead.stablecoin ||
    material.verificationMethod !== logicalRead.verificationMethod
  ) {
    return invalid('VERIFIED_PRICE_EVIDENCE_MISMATCH');
  }
  if (
    typeof record.evidenceFingerprintSha256 !== 'string' ||
    !SHA256.test(record.evidenceFingerprintSha256) ||
    record.evidenceFingerprintSha256 !== evidenceFingerprint(material)
  ) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  return Object.freeze({
    ...material,
    evidenceFingerprintSha256: record.evidenceFingerprintSha256,
  });
}

/**
 * Purely validates a complete six-item evidence set and projects it onto the
 * six exact Ethereum/Solana asset identities. It performs no source reads and
 * no persistence; source execution is intentionally reserved for Slice C.
 */
export function createVerifiedStablecoinPriceProjectionBatch(
  plan: StablecoinPriceIngestionPlanV1,
  evidenceInputs: unknown,
): VerifiedStablecoinPriceProjectionBatchV1 {
  assertCreatedPlan(plan);
  const candidates = exactArray(
    evidenceInputs,
    LOGICAL_READ_COUNT,
    'INCOMPLETE_VERIFIED_PRICE_EVIDENCE_SET',
  );
  const evidenceByReadId = new Map<string, VerifiedStablecoinPriceEvidenceV1>();
  for (const candidate of candidates) {
    const locator = exactDataRecord(candidate, EVIDENCE_KEYS, 'INVALID_VERIFIED_PRICE_EVIDENCE');
    const read = plan.logicalReads.find(
      ({ sourceId, stablecoin }) =>
        sourceId === locator.sourceId && stablecoin === locator.stablecoin,
    );
    if (read === undefined) return invalid('VERIFIED_PRICE_EVIDENCE_MISMATCH');
    if (evidenceByReadId.has(read.readId)) {
      return invalid('DUPLICATE_VERIFIED_PRICE_EVIDENCE');
    }
    evidenceByReadId.set(
      read.readId,
      normalizeVerifiedStablecoinPriceEvidence(plan, read, candidate),
    );
  }
  if (
    evidenceByReadId.size !== LOGICAL_READ_COUNT ||
    plan.logicalReads.some(({ readId }) => !evidenceByReadId.has(readId))
  ) {
    return invalid('INCOMPLETE_VERIFIED_PRICE_EVIDENCE_SET');
  }

  const projections = Object.freeze(
    plan.projections.map((target) => {
      const evidence = evidenceByReadId.get(target.readId);
      if (evidence === undefined) return invalid('INCOMPLETE_VERIFIED_PRICE_EVIDENCE_SET');
      return Object.freeze({
        schemaVersion: INGESTION_PLAN_SCHEMA_VERSION,
        projectionId: target.projectionId,
        readId: target.readId,
        asset: target.asset,
        evidence,
        mayAuthorizeFinancialAction: false as const,
      });
    }),
  );
  if (projections.length !== PROJECTION_COUNT) {
    return invalid('INCOMPLETE_VERIFIED_PRICE_EVIDENCE_SET');
  }
  const batch = Object.freeze({
    schemaVersion: INGESTION_PLAN_SCHEMA_VERSION,
    policyIdentity: plan.policyIdentity,
    registryEnvironment: plan.registryEnvironment,
    registryVersion: plan.registryVersion,
    registryFingerprintSha256: plan.registryFingerprintSha256,
    evidenceCount: LOGICAL_READ_COUNT,
    projectionCount: PROJECTION_COUNT,
    projections,
    mayAuthorizeFinancialAction: false as const,
  });
  CREATED_PROJECTION_BATCHES.add(batch);
  return batch;
}

function normalizePolicyIdentity(value: unknown): StablecoinPricePolicyIdentityV1 {
  const record = exactDataRecord(value, POLICY_IDENTITY_KEYS, 'INVALID_POLICY_IDENTITY');
  if (
    record.policyId !== POLICY_ID ||
    record.policyVersion !== STABLECOIN_VALUATION_POLICY_VERSION ||
    typeof record.policyDecisionSha256 !== 'string' ||
    !SHA256.test(record.policyDecisionSha256)
  ) {
    return invalid('INVALID_POLICY_IDENTITY');
  }
  return Object.freeze({
    policyId: POLICY_ID,
    policyVersion: STABLECOIN_VALUATION_POLICY_VERSION,
    policyDecisionSha256: record.policyDecisionSha256,
  });
}

function logicalRead(
  sourceId: StablecoinValuationSourceId,
  stablecoin: SupportedStablecoin,
): StablecoinPriceLogicalReadV1 {
  return Object.freeze({
    readId: `${sourceId}:${stablecoin}`,
    sourceId,
    sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES[stablecoin][sourceId],
    stablecoin,
    verificationMethod: VERIFICATION_METHODS[sourceId],
  });
}

function projectionTarget(
  read: StablecoinPriceLogicalReadV1,
  networkId: MainnetLaunchNetworkId,
): StablecoinPriceProjectionTargetV1 {
  const matches = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets.filter(
    (candidate) =>
      candidate.activationState === 'ACTIVE' &&
      candidate.stablecoin === read.stablecoin &&
      candidate.networkId === networkId,
  );
  if (matches.length !== 1) return invalid('INVALID_INGESTION_PLAN');
  const asset = matches[0];
  if (asset === undefined) return invalid('INVALID_INGESTION_PLAN');
  const reference = Object.freeze({
    registryEnvironment: REGISTRY_ENVIRONMENT,
    registryVersion: REGISTRY_VERSION,
    registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    stablecoin: asset.stablecoin,
    networkId: asset.networkId,
    identity: asset.identity,
    decimals: asset.decimals,
  });
  return Object.freeze({
    projectionId: `${read.readId}:${networkId}`,
    readId: read.readId,
    asset: reference,
  });
}

function normalizeEvidenceMaterial(value: unknown): VerifiedStablecoinPriceEvidenceMaterialV1 {
  const record = exactDataRecord(value, EVIDENCE_MATERIAL_KEYS, 'INVALID_VERIFIED_PRICE_EVIDENCE');
  const source = normalizeSource(record.sourceId);
  const stablecoin = normalizeStablecoin(record.stablecoin);
  const sourceReference = STABLECOIN_VALUATION_FEED_REFERENCES[stablecoin][source];
  if (
    record.schemaVersion !== EVIDENCE_SCHEMA_VERSION ||
    record.policyId !== POLICY_ID ||
    record.policyVersion !== STABLECOIN_VALUATION_POLICY_VERSION ||
    typeof record.policyDecisionSha256 !== 'string' ||
    !SHA256.test(record.policyDecisionSha256) ||
    record.registryEnvironment !== REGISTRY_ENVIRONMENT ||
    record.registryVersion !== REGISTRY_VERSION ||
    record.registryFingerprintSha256 !==
      MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 ||
    record.sourceReference !== sourceReference ||
    record.verificationMethod !== VERIFICATION_METHODS[source] ||
    record.mayAuthorizeFinancialAction !== false ||
    typeof record.monotonicSourceSequence !== 'string' ||
    !POSITIVE_INTEGER.test(record.monotonicSourceSequence) ||
    record.monotonicSourceSequence.length > MAXIMUM_INTEGER_DIGITS ||
    typeof record.authenticatedSourceUpdateId !== 'string' ||
    !validUpdateId(source, record.authenticatedSourceUpdateId, record.monotonicSourceSequence) ||
    typeof record.evidenceActorReferenceId !== 'string' ||
    !ACTOR_REFERENCE.test(record.evidenceActorReferenceId)
  ) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  const pricedAt = normalizeTimestamp(record.pricedAt);
  const observedAt = normalizeTimestamp(record.observedAt);
  const verifiedAt = normalizeTimestamp(record.verifiedAt);
  if (
    Date.parse(pricedAt) > Date.parse(observedAt) ||
    Date.parse(observedAt) > Date.parse(verifiedAt)
  ) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  return Object.freeze({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    policyId: POLICY_ID,
    policyVersion: STABLECOIN_VALUATION_POLICY_VERSION,
    policyDecisionSha256: record.policyDecisionSha256,
    registryEnvironment: REGISTRY_ENVIRONMENT,
    registryVersion: REGISTRY_VERSION,
    registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    sourceId: source,
    sourceReference,
    stablecoin,
    authenticatedSourceUpdateId: record.authenticatedSourceUpdateId,
    monotonicSourceSequence: record.monotonicSourceSequence,
    usdPrice: normalizePrice(record.usdPrice),
    confidence: normalizeConfidence(record.confidence, source),
    pricedAt,
    observedAt,
    verificationMethod: VERIFICATION_METHODS[source],
    verifiedAt,
    evidenceActorReferenceId: record.evidenceActorReferenceId,
    mayAuthorizeFinancialAction: false,
  });
}

function normalizeSource(value: unknown): StablecoinValuationSourceId {
  if (
    typeof value !== 'string' ||
    !STABLECOIN_VALUATION_SOURCES.includes(value as StablecoinValuationSourceId)
  ) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  return value as StablecoinValuationSourceId;
}

function normalizeStablecoin(value: unknown): MainnetStablecoin {
  if (typeof value !== 'string' || !SUPPORTED_STABLECOINS.includes(value as SupportedStablecoin)) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  return value as MainnetStablecoin;
}

function normalizePrice(value: unknown): VerifiedStablecoinUsdPriceV1 {
  const record = exactDataRecord(value, PRICE_KEYS, 'INVALID_VERIFIED_PRICE_EVIDENCE');
  if (
    typeof record.mantissa !== 'string' ||
    !CANONICAL_INTEGER.test(record.mantissa) ||
    record.mantissa.length > MAXIMUM_INTEGER_DIGITS ||
    record.scale !== 8
  ) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  return Object.freeze({ mantissa: record.mantissa, scale: 8 });
}

function normalizeConfidence(
  value: unknown,
  source: StablecoinValuationSourceId,
): StablecoinPriceConfidence {
  if (source === 'CHAINLINK_DATA_FEEDS') {
    const record = exactDataRecord(value, ['kind'], 'INVALID_VERIFIED_PRICE_EVIDENCE');
    if (record.kind !== 'NOT_PUBLISHED') return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
    return Object.freeze({ kind: 'NOT_PUBLISHED' });
  }
  const record = exactDataRecord(
    value,
    ['kind', 'mantissa', 'scale'],
    'INVALID_VERIFIED_PRICE_EVIDENCE',
  );
  if (
    record.kind !== 'PUBLISHED_ABSOLUTE_USD' ||
    typeof record.mantissa !== 'string' ||
    !CANONICAL_INTEGER.test(record.mantissa) ||
    record.mantissa.length > MAXIMUM_INTEGER_DIGITS ||
    record.scale !== 8
  ) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  return Object.freeze({
    kind: 'PUBLISHED_ABSOLUTE_USD',
    mantissa: record.mantissa,
    scale: 8,
  });
}

function validUpdateId(
  source: StablecoinValuationSourceId,
  updateId: string,
  sequence: string,
): boolean {
  return source === 'PYTH_CORE' ? SHA256.test(updateId) : updateId === sequence;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    new Date(milliseconds).toISOString() !== value
  ) {
    return invalid('INVALID_VERIFIED_PRICE_EVIDENCE');
  }
  return value;
}

function evidenceFingerprint(evidence: VerifiedStablecoinPriceEvidenceMaterialV1): string {
  const confidenceValues =
    evidence.confidence.kind === 'PUBLISHED_ABSOLUTE_USD'
      ? [evidence.confidence.kind, evidence.confidence.mantissa, String(evidence.confidence.scale)]
      : [evidence.confidence.kind, '', ''];
  return fingerprint('crypto-lending:verified-stablecoin-price-evidence:v1', [
    String(evidence.schemaVersion),
    evidence.policyId,
    String(evidence.policyVersion),
    evidence.policyDecisionSha256,
    evidence.registryEnvironment,
    String(evidence.registryVersion),
    evidence.registryFingerprintSha256,
    evidence.sourceId,
    evidence.sourceReference,
    evidence.stablecoin,
    evidence.authenticatedSourceUpdateId,
    evidence.monotonicSourceSequence,
    evidence.usdPrice.mantissa,
    String(evidence.usdPrice.scale),
    ...confidenceValues,
    evidence.pricedAt,
    evidence.observedAt,
    evidence.verificationMethod,
    evidence.verifiedAt,
    evidence.evidenceActorReferenceId,
    String(evidence.mayAuthorizeFinancialAction),
  ]);
}

function fingerprint(domain: string, values: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  for (const value of values) {
    hash.update('\u0000', 'utf8');
    hash.update(String(Buffer.byteLength(value, 'utf8')), 'utf8');
    hash.update(':', 'utf8');
    hash.update(value, 'utf8');
  }
  return hash.digest('hex');
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: StablecoinPriceIngestionPlanValidationCode,
): Readonly<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return invalid(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid(code);
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof StablecoinPriceIngestionPlanValidationError) throw error;
    return invalid(code);
  }
}

function exactArray(
  value: unknown,
  length: number,
  code: StablecoinPriceIngestionPlanValidationCode,
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return invalid(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      value.length !== length ||
      keys.length !== length + 1 ||
      keys.some((key) =>
        typeof key === 'symbol'
          ? true
          : key !== 'length' && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length),
      )
    ) {
      return invalid(code);
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid(code);
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof StablecoinPriceIngestionPlanValidationError) throw error;
    return invalid(code);
  }
}

function assertCreatedPlan(plan: StablecoinPriceIngestionPlanV1): void {
  assertCanonicalStablecoinPriceIngestionPlan(plan);
}

function invalid(code: StablecoinPriceIngestionPlanValidationCode): never {
  throw new StablecoinPriceIngestionPlanValidationError(code);
}
