import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import { isMainnetLaunchNetwork } from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_SOURCES,
  type StablecoinPriceConfidence,
  type StablecoinPriceObservation,
  type StablecoinValuationAssetReference,
  type StablecoinValuationSourceId,
} from './stablecoin-valuation-policy';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const CANONICAL_INTEGER = /^(0|[1-9][0-9]*)$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_DIGITS = 78;
const NORMALIZED_USD_SCALE = 8;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const ASSET_KEYS = Object.freeze([
  'registryEnvironment',
  'registryVersion',
  'registryFingerprintSha256',
  'stablecoin',
  'networkId',
  'identity',
  'decimals',
] as const);
const OBSERVATION_KEYS = Object.freeze([
  'asset',
  'sourceId',
  'sourceReference',
  'sourceSequence',
  'sourceUpdateId',
  'pricedAt',
  'observedAt',
  'usdRateMantissa',
  'usdRateScale',
  'confidence',
] as const);
const REQUEST_KEYS = Object.freeze([
  'correlationId',
  'evidenceActorReferenceId',
  'evidenceFingerprintSha256',
  'verifiedAt',
  'observation',
] as const);

export const STABLECOIN_PRICE_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type StablecoinPriceEvidenceValidationCode =
  'INVALID_PRICE_EVIDENCE_REQUEST' | 'INVALID_PRICE_EVIDENCE_ASSET' | 'INVALID_PRICE_OBSERVATION';

export class StablecoinPriceEvidenceValidationError extends Error {
  constructor(readonly code: StablecoinPriceEvidenceValidationCode) {
    super('Stablecoin price evidence input is invalid');
    this.name = 'StablecoinPriceEvidenceValidationError';
  }
}

export interface NormalizedStablecoinPriceEvidenceCommand {
  readonly schemaVersion: 1;
  readonly correlationId: string;
  readonly evidenceId: string;
  readonly evidenceActorReferenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly verifiedAt: string;
  readonly observationId: string;
  readonly observation: StablecoinPriceObservation;
  readonly commandFingerprintSha256: string;
  readonly watermarkEventId: string;
  readonly watermarkEventFingerprintSha256: string;
}

type PlainRecord = Readonly<Record<string, unknown>>;

function invalid(code: StablecoinPriceEvidenceValidationCode): never {
  throw new StablecoinPriceEvidenceValidationError(code);
}

function ownDataRecord(
  value: unknown,
  keys: readonly string[],
  code: StablecoinPriceEvidenceValidationCode,
): PlainRecord {
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
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return invalid(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof StablecoinPriceEvidenceValidationError) throw error;
    return invalid(code);
  }
}

function timestamp(value: unknown, code: StablecoinPriceEvidenceValidationCode): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return invalid(code);
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    new Date(milliseconds).toISOString() !== value
  ) {
    return invalid(code);
  }
  return value;
}

function hash(domain: string, values: readonly string[]): string {
  const digest = createHash('sha256');
  digest.update(domain, 'utf8');
  for (const value of values) {
    digest.update('\u0000', 'utf8');
    digest.update(String(Buffer.byteLength(value, 'utf8')), 'utf8');
    digest.update(':', 'utf8');
    digest.update(value, 'utf8');
  }
  return digest.digest('hex');
}

function sourceId(value: unknown): StablecoinValuationSourceId {
  if (
    typeof value !== 'string' ||
    !STABLECOIN_VALUATION_SOURCES.includes(value as StablecoinValuationSourceId)
  ) {
    return invalid('INVALID_PRICE_OBSERVATION');
  }
  return value as StablecoinValuationSourceId;
}

function confidence(
  value: unknown,
  source: StablecoinValuationSourceId,
): StablecoinPriceConfidence {
  if (source === 'PYTH_CORE') {
    const record = ownDataRecord(value, ['kind', 'mantissa', 'scale'], 'INVALID_PRICE_OBSERVATION');
    if (
      record.kind !== 'PUBLISHED_ABSOLUTE_USD' ||
      typeof record.mantissa !== 'string' ||
      !CANONICAL_INTEGER.test(record.mantissa) ||
      record.mantissa.length > MAX_DIGITS ||
      record.scale !== NORMALIZED_USD_SCALE
    ) {
      return invalid('INVALID_PRICE_OBSERVATION');
    }
    return Object.freeze({
      kind: 'PUBLISHED_ABSOLUTE_USD',
      mantissa: record.mantissa,
      scale: NORMALIZED_USD_SCALE,
    });
  }
  const record = ownDataRecord(value, ['kind'], 'INVALID_PRICE_OBSERVATION');
  if (record.kind !== 'NOT_PUBLISHED') return invalid('INVALID_PRICE_OBSERVATION');
  return Object.freeze({ kind: 'NOT_PUBLISHED' });
}

export function normalizeStablecoinPriceEvidenceAsset(
  value: unknown,
): StablecoinValuationAssetReference {
  const record = ownDataRecord(value, ASSET_KEYS, 'INVALID_PRICE_EVIDENCE_ASSET');
  if (
    record.registryEnvironment !== 'MAINNET' ||
    record.registryVersion !== 1 ||
    record.registryFingerprintSha256 !== REGISTRY_FINGERPRINT ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 !== REGISTRY_FINGERPRINT ||
    typeof record.stablecoin !== 'string' ||
    typeof record.networkId !== 'string' ||
    !isMainnetLaunchNetwork(record.networkId) ||
    typeof record.identity !== 'string' ||
    record.decimals !== 6
  ) {
    return invalid('INVALID_PRICE_EVIDENCE_ASSET');
  }
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(1)?.identifyAsset(
    record.networkId,
    record.identity,
  );
  if (
    !asset ||
    asset.activationState !== 'ACTIVE' ||
    asset.stablecoin !== record.stablecoin ||
    asset.decimals !== record.decimals
  ) {
    return invalid('INVALID_PRICE_EVIDENCE_ASSET');
  }
  return Object.freeze({
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: REGISTRY_FINGERPRINT,
    stablecoin: asset.stablecoin,
    networkId: asset.networkId,
    identity: asset.identity,
    decimals: 6,
  });
}

export function normalizeStablecoinPriceObservation(value: unknown): StablecoinPriceObservation {
  const record = ownDataRecord(value, OBSERVATION_KEYS, 'INVALID_PRICE_OBSERVATION');
  const asset = normalizeStablecoinPriceEvidenceAsset(record.asset);
  const source = sourceId(record.sourceId);
  const expectedReference = STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin][source];
  if (
    record.sourceReference !== expectedReference ||
    typeof record.sourceSequence !== 'string' ||
    !POSITIVE_INTEGER.test(record.sourceSequence) ||
    record.sourceSequence.length > MAX_DIGITS ||
    typeof record.sourceUpdateId !== 'string' ||
    (source === 'PYTH_CORE'
      ? !SHA256.test(record.sourceUpdateId)
      : record.sourceUpdateId !== record.sourceSequence) ||
    typeof record.usdRateMantissa !== 'string' ||
    !CANONICAL_INTEGER.test(record.usdRateMantissa) ||
    record.usdRateMantissa.length > MAX_DIGITS ||
    record.usdRateScale !== NORMALIZED_USD_SCALE
  ) {
    return invalid('INVALID_PRICE_OBSERVATION');
  }
  const pricedAt = timestamp(record.pricedAt, 'INVALID_PRICE_OBSERVATION');
  const observedAt = timestamp(record.observedAt, 'INVALID_PRICE_OBSERVATION');
  if (Date.parse(pricedAt) > Date.parse(observedAt)) return invalid('INVALID_PRICE_OBSERVATION');
  return Object.freeze({
    asset,
    sourceId: source,
    sourceReference: expectedReference,
    sourceSequence: record.sourceSequence,
    sourceUpdateId: record.sourceUpdateId,
    pricedAt,
    observedAt,
    usdRateMantissa: record.usdRateMantissa,
    usdRateScale: NORMALIZED_USD_SCALE,
    confidence: confidence(record.confidence, source),
  });
}

function observationFingerprintValues(observation: StablecoinPriceObservation): readonly string[] {
  const confidenceValues =
    observation.confidence.kind === 'PUBLISHED_ABSOLUTE_USD'
      ? [
          observation.confidence.kind,
          observation.confidence.mantissa,
          String(observation.confidence.scale),
        ]
      : [observation.confidence.kind, '', ''];
  return [
    observation.asset.registryEnvironment,
    String(observation.asset.registryVersion),
    observation.asset.registryFingerprintSha256,
    observation.asset.stablecoin,
    observation.asset.networkId,
    observation.asset.identity,
    String(observation.asset.decimals),
    observation.sourceId,
    observation.sourceReference,
    observation.sourceSequence,
    observation.sourceUpdateId,
    observation.pricedAt,
    observation.observedAt,
    observation.usdRateMantissa,
    String(observation.usdRateScale),
    ...confidenceValues,
  ];
}

export function normalizeStablecoinPriceEvidenceCommand(
  value: unknown,
): NormalizedStablecoinPriceEvidenceCommand {
  const record = ownDataRecord(value, REQUEST_KEYS, 'INVALID_PRICE_EVIDENCE_REQUEST');
  if (
    typeof record.correlationId !== 'string' ||
    !UUID_V4.test(record.correlationId) ||
    typeof record.evidenceActorReferenceId !== 'string' ||
    !REFERENCE.test(record.evidenceActorReferenceId) ||
    typeof record.evidenceFingerprintSha256 !== 'string' ||
    !SHA256.test(record.evidenceFingerprintSha256)
  ) {
    return invalid('INVALID_PRICE_EVIDENCE_REQUEST');
  }
  const verifiedAt = timestamp(record.verifiedAt, 'INVALID_PRICE_EVIDENCE_REQUEST');
  const observation = normalizeStablecoinPriceObservation(record.observation);
  if (Date.parse(verifiedAt) < Date.parse(observation.observedAt)) {
    return invalid('INVALID_PRICE_EVIDENCE_REQUEST');
  }
  const observationValues = observationFingerprintValues(observation);
  const observationId = hash('crypto-lending:stablecoin-price-observation:v1', observationValues);
  const evidenceId = hash('crypto-lending:stablecoin-price-evidence:v1', [
    record.evidenceActorReferenceId,
    record.evidenceFingerprintSha256,
    verifiedAt,
  ]);
  const commandFingerprintSha256 = hash('crypto-lending:stablecoin-price-command:v1', [
    record.correlationId,
    evidenceId,
    observationId,
    ...observationValues,
  ]);
  const watermarkEventId = hash('crypto-lending:stablecoin-price-watermark-event-id:v1', [
    commandFingerprintSha256,
  ]);
  const watermarkEventFingerprintSha256 = hash(
    'crypto-lending:stablecoin-price-watermark-event:v1',
    [commandFingerprintSha256, watermarkEventId],
  );
  return Object.freeze({
    schemaVersion: STABLECOIN_PRICE_EVIDENCE_SCHEMA_VERSION,
    correlationId: record.correlationId,
    evidenceId,
    evidenceActorReferenceId: record.evidenceActorReferenceId,
    evidenceFingerprintSha256: record.evidenceFingerprintSha256,
    verifiedAt,
    observationId,
    observation,
    commandFingerprintSha256,
    watermarkEventId,
    watermarkEventFingerprintSha256,
  });
}
