const CANONICAL_MANTISSA_PATTERN = /^-?(?:0|[1-9][0-9]*)$/u;
const DECIMAL_TEXT_PATTERN = /^(-?)([0-9]+)(?:\.([0-9]+))?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const MAX_DECIMAL_DIGITS = 78;
const MAX_DECIMAL_SCALE = 77;
const MAX_COLLECTION_LENGTH = 64;
const MAX_IDENTIFIER_LENGTH = 192;
const MAX_TEXT_LENGTH = 512;
const MAX_PROVENANCE_VALUE_LENGTH = 1_024;

export const YIELD_OPPORTUNITY_SCHEMA_VERSION = 1 as const;
export const YIELD_OPPORTUNITY_SCHEMA_ID =
  'urn:crypto-lending:smart-yield:normalized-opportunity:v1' as const;

export const YIELD_AVAILABILITY_STATUSES = Object.freeze([
  'AVAILABLE',
  'LIMITED',
  'UNAVAILABLE',
] as const);
export const YIELD_FEE_KINDS = Object.freeze([
  'DEPOSIT',
  'WITHDRAWAL',
  'MANAGEMENT',
  'PERFORMANCE',
  'PROTOCOL',
  'OTHER',
] as const);
export const YIELD_LIMIT_KINDS = Object.freeze([
  'MINIMUM_DEPOSIT',
  'MAXIMUM_DEPOSIT',
  'MINIMUM_WITHDRAWAL',
  'MAXIMUM_WITHDRAWAL',
  'REMAINING_CAPACITY',
] as const);
export const YIELD_DISCLOSURE_STATUSES = Object.freeze(['REPORTED', 'NOT_REPORTED'] as const);
export const YIELD_AMOUNT_DENOMINATIONS = Object.freeze(['ASSET', 'USD'] as const);
export const YIELD_PROVENANCE_SOURCE_KINDS = Object.freeze([
  'API',
  'ON_CHAIN',
  'AGGREGATED',
  'FILE',
] as const);

export type YieldAvailabilityStatus = (typeof YIELD_AVAILABILITY_STATUSES)[number];
export type YieldFeeKind = (typeof YIELD_FEE_KINDS)[number];
export type YieldLimitKind = (typeof YIELD_LIMIT_KINDS)[number];
export type YieldDisclosureStatus = (typeof YIELD_DISCLOSURE_STATUSES)[number];
export type YieldAmountDenomination = (typeof YIELD_AMOUNT_DENOMINATIONS)[number];
export type YieldProvenanceSourceKind = (typeof YIELD_PROVENANCE_SOURCE_KINDS)[number];

/**
 * Exact base-10 value. `mantissa * 10^-scale` is the represented number.
 * Both members are JSON-safe, and no provider decimal crosses a binary float.
 */
export interface YieldDecimalV1 {
  readonly mantissa: string;
  readonly scale: number;
}

export interface YieldAmountV1 {
  readonly value: YieldDecimalV1;
  readonly denomination: YieldAmountDenomination;
}

export interface YieldEntityReferenceV1 {
  readonly id: string;
  readonly name: string;
}

export interface YieldProtocolReferenceV1 extends YieldEntityReferenceV1 {
  readonly marketId: string;
}

export interface YieldChainReferenceV1 {
  /** CAIP-2 identifier where one exists; otherwise the provider's canonical chain identifier. */
  readonly id: string;
  readonly name: string;
}

export interface YieldAssetContractV1 {
  readonly symbol: string;
  /** Case-sensitive chain-native contract or mint identity. */
  readonly contract: string;
  readonly decimals: number;
}

export interface YieldRateObservationV1 {
  /** Ratio, not percentage points: 0.0525 represents 5.25%. */
  readonly rate: YieldDecimalV1;
  readonly asOf: string;
}

export interface YieldAmountObservationV1 {
  readonly amount: YieldAmountV1;
  readonly asOf: string;
}

export type YieldFeeChargeV1 =
  | Readonly<{
      kind: 'RATE';
      /** Ratio, not percentage points. */
      rate: YieldDecimalV1;
    }>
  | Readonly<{
      kind: 'AMOUNT';
      amount: YieldAmountV1;
    }>;

export interface YieldFeeV1 {
  readonly kind: YieldFeeKind;
  /** Provider label retained even when `kind` maps it to a normalized category. */
  readonly label: string;
  readonly charge: YieldFeeChargeV1;
}

export interface YieldFeeDisclosureV1 {
  /** Distinguishes a known empty fee schedule from missing provider data. */
  readonly status: YieldDisclosureStatus;
  readonly entries: readonly YieldFeeV1[];
}

export interface YieldLimitV1 {
  readonly kind: YieldLimitKind;
  readonly amount: YieldAmountV1;
}

export interface YieldLimitDisclosureV1 {
  /** Distinguishes no applicable limits from limits the provider did not report. */
  readonly status: YieldDisclosureStatus;
  readonly entries: readonly YieldLimitV1[];
}

export interface YieldOpportunityAvailabilityV1 {
  readonly status: YieldAvailabilityStatus;
  readonly depositsEnabled: boolean;
  readonly withdrawalsEnabled: boolean;
  readonly asOf: string;
  readonly reasonCodes: readonly string[];
}

export interface YieldProvenanceAttributeV1 {
  readonly key: string;
  readonly value: string;
}

export interface YieldOpportunityProvenanceV1 {
  readonly sourceKind: YieldProvenanceSourceKind;
  readonly sourceId: string;
  readonly sourceReference: string;
  readonly sourceObservedAt: string;
  readonly retrievedAt: string;
  /** Digest of the exact provider payload before normalization. */
  readonly payloadSha256: string;
  readonly normalizerId: string;
  readonly normalizerVersion: string;
  /** Lossless string metadata for source identifiers not promoted into the normalized schema. */
  readonly attributes: readonly YieldProvenanceAttributeV1[];
}

export interface NormalizedYieldOpportunityV1 {
  readonly schemaVersion: typeof YIELD_OPPORTUNITY_SCHEMA_VERSION;
  readonly opportunityId: string;
  readonly provider: YieldEntityReferenceV1;
  readonly protocol: YieldProtocolReferenceV1;
  readonly asset: YieldAssetContractV1;
  readonly chain: YieldChainReferenceV1;
  readonly apy: YieldRateObservationV1;
  readonly tvl: YieldAmountObservationV1;
  readonly utilization: YieldRateObservationV1;
  readonly exitLiquidity: YieldAmountObservationV1;
  readonly fees: YieldFeeDisclosureV1;
  readonly limits: YieldLimitDisclosureV1;
  readonly availability: YieldOpportunityAvailabilityV1;
  readonly provenance: YieldOpportunityProvenanceV1;
}

export type NormalizedYieldOpportunity = NormalizedYieldOpportunityV1;

export type YieldOpportunityValidationCode =
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_OPPORTUNITY_ID'
  | 'INVALID_PROVIDER'
  | 'INVALID_PROTOCOL'
  | 'INVALID_ASSET'
  | 'INVALID_CHAIN'
  | 'INVALID_DECIMAL'
  | 'INVALID_APY'
  | 'INVALID_TVL'
  | 'INVALID_UTILIZATION'
  | 'INVALID_EXIT_LIQUIDITY'
  | 'INVALID_FEES'
  | 'INVALID_LIMITS'
  | 'INVALID_AVAILABILITY'
  | 'INVALID_PROVENANCE';

export class YieldOpportunityValidationError extends Error {
  constructor(readonly code: YieldOpportunityValidationCode) {
    super(code);
    this.name = 'YieldOpportunityValidationError';
  }
}

type PlainRecord = Readonly<Record<string, unknown>>;

function validationError(code: YieldOpportunityValidationCode): never {
  throw new YieldOpportunityValidationError(code);
}

function ownDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: YieldOpportunityValidationCode,
): PlainRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return validationError(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return validationError(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return validationError(code);
    }

    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return validationError(code);
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof YieldOpportunityValidationError) throw error;
    return validationError(code);
  }
}

function ownDataArray(value: unknown, code: YieldOpportunityValidationCode): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return validationError(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return validationError(code);
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_COLLECTION_LENGTH
    ) {
      return validationError(code);
    }

    const allowedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== allowedKeys.size ||
      ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
    ) {
      return validationError(code);
    }

    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return validationError(code);
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof YieldOpportunityValidationError) throw error;
    return validationError(code);
  }
}

function ownDataProperty(
  value: unknown,
  key: string,
  code: YieldOpportunityValidationCode,
): unknown {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return validationError(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return validationError(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      return validationError(code);
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof YieldOpportunityValidationError) throw error;
    return validationError(code);
  }
}

function safeText(
  value: unknown,
  code: YieldOpportunityValidationCode,
  maximumLength = MAX_TEXT_LENGTH,
): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    return validationError(code);
  }
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function identifier(value: unknown, code: YieldOpportunityValidationCode): string {
  return safeText(value, code, MAX_IDENTIFIER_LENGTH);
}

function canonicalTimestamp(value: unknown, code: YieldOpportunityValidationCode): string {
  if (typeof value !== 'string') return validationError(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return validationError(code);
  }
  return value;
}

function enumMember<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  code: YieldOpportunityValidationCode,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) return validationError(code);
  return value as Values[number];
}

function booleanValue(value: unknown, code: YieldOpportunityValidationCode): boolean {
  if (typeof value !== 'boolean') return validationError(code);
  return value;
}

function nonNegative(
  decimal: YieldDecimalV1,
  code: YieldOpportunityValidationCode,
): YieldDecimalV1 {
  if (decimal.mantissa.startsWith('-')) return validationError(code);
  return decimal;
}

function unitRatio(decimal: YieldDecimalV1, code: YieldOpportunityValidationCode): YieldDecimalV1 {
  nonNegative(decimal, code);
  if (BigInt(decimal.mantissa) > 10n ** BigInt(decimal.scale)) return validationError(code);
  return decimal;
}

function parseDecimal(value: unknown, code: YieldOpportunityValidationCode): YieldDecimalV1 {
  const record = ownDataRecord(value, ['mantissa', 'scale'], code);
  const { mantissa, scale } = record;
  if (
    typeof mantissa !== 'string' ||
    !CANONICAL_MANTISSA_PATTERN.test(mantissa) ||
    mantissa === '-0' ||
    mantissa.replace('-', '').length > MAX_DECIMAL_DIGITS ||
    typeof scale !== 'number' ||
    !Number.isSafeInteger(scale) ||
    scale < 0 ||
    scale > MAX_DECIMAL_SCALE
  ) {
    return validationError(code);
  }
  return Object.freeze({ mantissa, scale });
}

/** Converts provider decimal text without passing through a JavaScript number. */
export function yieldDecimalFromString(value: unknown): YieldDecimalV1 {
  if (typeof value !== 'string') return validationError('INVALID_DECIMAL');
  const match = DECIMAL_TEXT_PATTERN.exec(value);
  if (!match) return validationError('INVALID_DECIMAL');

  const sign = match[1] ?? '';
  const whole = match[2];
  const fraction = match[3] ?? '';
  if (!whole) return validationError('INVALID_DECIMAL');
  const unsignedMantissa = `${whole}${fraction}`.replace(/^0+(?=[0-9])/u, '');
  const mantissa = unsignedMantissa === '0' ? '0' : `${sign}${unsignedMantissa}`;
  return parseDecimal({ mantissa, scale: fraction.length }, 'INVALID_DECIMAL');
}

/** Divides an exact decimal by 10^places (for example basis points to a ratio uses 4). */
export function divideYieldDecimalByPowerOfTen(
  value: YieldDecimalV1,
  places: number,
): YieldDecimalV1 {
  const parsed = parseDecimal(value, 'INVALID_DECIMAL');
  if (!Number.isSafeInteger(places) || places < 0 || parsed.scale + places > MAX_DECIMAL_SCALE) {
    return validationError('INVALID_DECIMAL');
  }
  return Object.freeze({ mantissa: parsed.mantissa, scale: parsed.scale + places });
}

/** Renders the exact value while retaining its declared fractional scale. */
export function yieldDecimalToString(value: YieldDecimalV1): string {
  const parsed = parseDecimal(value, 'INVALID_DECIMAL');
  if (parsed.scale === 0) return parsed.mantissa;
  const negative = parsed.mantissa.startsWith('-');
  const digits = negative ? parsed.mantissa.slice(1) : parsed.mantissa;
  const padded = digits.padStart(parsed.scale + 1, '0');
  const splitAt = padded.length - parsed.scale;
  return `${negative ? '-' : ''}${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
}

function parseEntityReference(
  value: unknown,
  code: YieldOpportunityValidationCode,
): YieldEntityReferenceV1 {
  const record = ownDataRecord(value, ['id', 'name'], code);
  return Object.freeze({ id: identifier(record.id, code), name: safeText(record.name, code) });
}

function parseProtocolReference(value: unknown): YieldProtocolReferenceV1 {
  const record = ownDataRecord(value, ['id', 'name', 'marketId'], 'INVALID_PROTOCOL');
  return Object.freeze({
    id: identifier(record.id, 'INVALID_PROTOCOL'),
    name: safeText(record.name, 'INVALID_PROTOCOL'),
    marketId: identifier(record.marketId, 'INVALID_PROTOCOL'),
  });
}

function parseChain(value: unknown): YieldChainReferenceV1 {
  const record = ownDataRecord(value, ['id', 'name'], 'INVALID_CHAIN');
  return Object.freeze({
    id: identifier(record.id, 'INVALID_CHAIN'),
    name: safeText(record.name, 'INVALID_CHAIN'),
  });
}

function parseAsset(value: unknown): YieldAssetContractV1 {
  const record = ownDataRecord(value, ['symbol', 'contract', 'decimals'], 'INVALID_ASSET');
  const decimals = record.decimals;
  if (
    typeof decimals !== 'number' ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    return validationError('INVALID_ASSET');
  }
  return Object.freeze({
    symbol: identifier(record.symbol, 'INVALID_ASSET'),
    contract: identifier(record.contract, 'INVALID_ASSET'),
    decimals,
  });
}

function parseRateObservation(
  value: unknown,
  code: 'INVALID_APY' | 'INVALID_UTILIZATION',
): YieldRateObservationV1 {
  const record = ownDataRecord(value, ['rate', 'asOf'], code);
  const rate = parseDecimal(record.rate, code);
  if (code === 'INVALID_UTILIZATION') unitRatio(rate, code);
  return Object.freeze({ rate, asOf: canonicalTimestamp(record.asOf, code) });
}

function parseAmount(value: unknown, code: YieldOpportunityValidationCode): YieldAmountV1 {
  const record = ownDataRecord(value, ['value', 'denomination'], code);
  return Object.freeze({
    value: nonNegative(parseDecimal(record.value, code), code),
    denomination: enumMember(record.denomination, YIELD_AMOUNT_DENOMINATIONS, code),
  });
}

function parseAmountObservation(
  value: unknown,
  code: 'INVALID_TVL' | 'INVALID_EXIT_LIQUIDITY',
): YieldAmountObservationV1 {
  const record = ownDataRecord(value, ['amount', 'asOf'], code);
  return Object.freeze({
    amount: parseAmount(record.amount, code),
    asOf: canonicalTimestamp(record.asOf, code),
  });
}

function parseFeeCharge(value: unknown): YieldFeeChargeV1 {
  const kind = ownDataProperty(value, 'kind', 'INVALID_FEES');
  if (kind === 'RATE') {
    const record = ownDataRecord(value, ['kind', 'rate'], 'INVALID_FEES');
    return Object.freeze({
      kind: 'RATE',
      rate: nonNegative(parseDecimal(record.rate, 'INVALID_FEES'), 'INVALID_FEES'),
    });
  }
  if (kind === 'AMOUNT') {
    const record = ownDataRecord(value, ['kind', 'amount'], 'INVALID_FEES');
    return Object.freeze({ kind: 'AMOUNT', amount: parseAmount(record.amount, 'INVALID_FEES') });
  }
  return validationError('INVALID_FEES');
}

function parseFee(value: unknown): YieldFeeV1 {
  const record = ownDataRecord(value, ['kind', 'label', 'charge'], 'INVALID_FEES');
  return Object.freeze({
    kind: enumMember(record.kind, YIELD_FEE_KINDS, 'INVALID_FEES'),
    label: safeText(record.label, 'INVALID_FEES'),
    charge: parseFeeCharge(record.charge),
  });
}

function parseFees(value: unknown): YieldFeeDisclosureV1 {
  const record = ownDataRecord(value, ['status', 'entries'], 'INVALID_FEES');
  const status = enumMember(record.status, YIELD_DISCLOSURE_STATUSES, 'INVALID_FEES');
  const entries = Object.freeze(ownDataArray(record.entries, 'INVALID_FEES').map(parseFee));
  if (status === 'NOT_REPORTED' && entries.length > 0) return validationError('INVALID_FEES');
  return Object.freeze({ status, entries });
}

function parseLimit(value: unknown): YieldLimitV1 {
  const record = ownDataRecord(value, ['kind', 'amount'], 'INVALID_LIMITS');
  return Object.freeze({
    kind: enumMember(record.kind, YIELD_LIMIT_KINDS, 'INVALID_LIMITS'),
    amount: parseAmount(record.amount, 'INVALID_LIMITS'),
  });
}

function parseLimits(value: unknown): YieldLimitDisclosureV1 {
  const record = ownDataRecord(value, ['status', 'entries'], 'INVALID_LIMITS');
  const status = enumMember(record.status, YIELD_DISCLOSURE_STATUSES, 'INVALID_LIMITS');
  const entries = Object.freeze(ownDataArray(record.entries, 'INVALID_LIMITS').map(parseLimit));
  if (status === 'NOT_REPORTED' && entries.length > 0) return validationError('INVALID_LIMITS');
  return Object.freeze({ status, entries });
}

function parseAvailability(value: unknown): YieldOpportunityAvailabilityV1 {
  const record = ownDataRecord(
    value,
    ['status', 'depositsEnabled', 'withdrawalsEnabled', 'asOf', 'reasonCodes'],
    'INVALID_AVAILABILITY',
  );
  const reasonCodes = Object.freeze(
    ownDataArray(record.reasonCodes, 'INVALID_AVAILABILITY').map((reason) =>
      identifier(reason, 'INVALID_AVAILABILITY'),
    ),
  );
  return Object.freeze({
    status: enumMember(record.status, YIELD_AVAILABILITY_STATUSES, 'INVALID_AVAILABILITY'),
    depositsEnabled: booleanValue(record.depositsEnabled, 'INVALID_AVAILABILITY'),
    withdrawalsEnabled: booleanValue(record.withdrawalsEnabled, 'INVALID_AVAILABILITY'),
    asOf: canonicalTimestamp(record.asOf, 'INVALID_AVAILABILITY'),
    reasonCodes,
  });
}

function parseProvenanceAttribute(value: unknown): YieldProvenanceAttributeV1 {
  const record = ownDataRecord(value, ['key', 'value'], 'INVALID_PROVENANCE');
  return Object.freeze({
    key: identifier(record.key, 'INVALID_PROVENANCE'),
    value: safeText(record.value, 'INVALID_PROVENANCE', MAX_PROVENANCE_VALUE_LENGTH),
  });
}

function parseProvenance(value: unknown): YieldOpportunityProvenanceV1 {
  const record = ownDataRecord(
    value,
    [
      'sourceKind',
      'sourceId',
      'sourceReference',
      'sourceObservedAt',
      'retrievedAt',
      'payloadSha256',
      'normalizerId',
      'normalizerVersion',
      'attributes',
    ],
    'INVALID_PROVENANCE',
  );
  const payloadSha256 = record.payloadSha256;
  if (typeof payloadSha256 !== 'string' || !SHA256_PATTERN.test(payloadSha256)) {
    return validationError('INVALID_PROVENANCE');
  }
  const attributes = Object.freeze(
    ownDataArray(record.attributes, 'INVALID_PROVENANCE').map(parseProvenanceAttribute),
  );
  const uniqueKeys = new Set(attributes.map(({ key }) => key));
  if (uniqueKeys.size !== attributes.length) return validationError('INVALID_PROVENANCE');

  return Object.freeze({
    sourceKind: enumMember(record.sourceKind, YIELD_PROVENANCE_SOURCE_KINDS, 'INVALID_PROVENANCE'),
    sourceId: identifier(record.sourceId, 'INVALID_PROVENANCE'),
    sourceReference: safeText(record.sourceReference, 'INVALID_PROVENANCE'),
    sourceObservedAt: canonicalTimestamp(record.sourceObservedAt, 'INVALID_PROVENANCE'),
    retrievedAt: canonicalTimestamp(record.retrievedAt, 'INVALID_PROVENANCE'),
    payloadSha256,
    normalizerId: identifier(record.normalizerId, 'INVALID_PROVENANCE'),
    normalizerVersion: identifier(record.normalizerVersion, 'INVALID_PROVENANCE'),
    attributes,
  });
}

/**
 * Validates, copies, and deeply freezes one provider-normalized opportunity.
 * Provider adapters remain responsible for mapping their raw payload into this
 * provider-neutral shape; this boundary guarantees the resulting contract.
 */
export function normalizeYieldOpportunityV1(value: unknown): NormalizedYieldOpportunityV1 {
  const record = ownDataRecord(
    value,
    [
      'schemaVersion',
      'opportunityId',
      'provider',
      'protocol',
      'asset',
      'chain',
      'apy',
      'tvl',
      'utilization',
      'exitLiquidity',
      'fees',
      'limits',
      'availability',
      'provenance',
    ],
    'INVALID_SCHEMA_VERSION',
  );
  if (record.schemaVersion !== YIELD_OPPORTUNITY_SCHEMA_VERSION) {
    return validationError('INVALID_SCHEMA_VERSION');
  }

  return Object.freeze({
    schemaVersion: YIELD_OPPORTUNITY_SCHEMA_VERSION,
    opportunityId: identifier(record.opportunityId, 'INVALID_OPPORTUNITY_ID'),
    provider: parseEntityReference(record.provider, 'INVALID_PROVIDER'),
    protocol: parseProtocolReference(record.protocol),
    asset: parseAsset(record.asset),
    chain: parseChain(record.chain),
    apy: parseRateObservation(record.apy, 'INVALID_APY'),
    tvl: parseAmountObservation(record.tvl, 'INVALID_TVL'),
    utilization: parseRateObservation(record.utilization, 'INVALID_UTILIZATION'),
    exitLiquidity: parseAmountObservation(record.exitLiquidity, 'INVALID_EXIT_LIQUIDITY'),
    fees: parseFees(record.fees),
    limits: parseLimits(record.limits),
    availability: parseAvailability(record.availability),
    provenance: parseProvenance(record.provenance),
  });
}

export const normalizeYieldOpportunity = normalizeYieldOpportunityV1;
