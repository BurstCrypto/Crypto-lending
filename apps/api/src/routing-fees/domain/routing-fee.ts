import { createHash } from 'node:crypto';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

const MAX_DECIMAL_DIGITS = 78;
const MAX_DECIMAL_SCALE = 77;
const MAX_REFERENCE_LENGTH = 192;
const MAX_ROUTE_LEGS = 32;
const MAX_FEE_COMPONENTS = 32;

export const MAX_ROUTING_FEE_ATOMIC_AMOUNT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const ROUTING_FEE_RULE_SCHEMA_VERSION = 1 as const;
export const ROUTING_FEE_RULE_CATALOG_SCHEMA_VERSION = 1 as const;
export const ROUTING_FEE_ROUTE_SCHEMA_VERSION = 1 as const;
export const ROUTING_FEE_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION = 1 as const;

export const ROUTING_FEE_TIERS = Object.freeze(['FREE', 'INDIVIDUAL', 'PRO'] as const);
export const ROUTING_FEE_CATEGORIES = Object.freeze([
  'PLATFORM',
  'NETWORK',
  'DEX',
  'BRIDGE',
  'PROVIDER',
] as const);
export const ROUTING_FEE_PASS_THROUGH_CATEGORIES = Object.freeze([
  'NETWORK',
  'DEX',
  'BRIDGE',
  'PROVIDER',
] as const);
export const ROUTING_FEE_DEDUCTION_MODES = Object.freeze([
  'ADDED_ON_TOP',
  'DEDUCTED_FROM_INPUT',
  'DEDUCTED_FROM_OUTPUT',
] as const);
export const ROUTING_FEE_ROUNDING_MODES = Object.freeze(['DOWN', 'UP', 'HALF_EVEN'] as const);
export const ROUTING_FEE_ROUTE_LEG_KINDS = Object.freeze([
  'DIRECT_SETTLEMENT',
  'SWAP',
  'BRIDGE',
] as const);
export const ROUTING_FEE_ROUTE_CLASSIFICATIONS = Object.freeze([
  'DIRECT_COMPATIBLE',
  'MATERIAL_ORCHESTRATION',
] as const);
export const ROUTING_FEE_CLASSIFICATION_REASONS = Object.freeze([
  'SINGLE_DIRECT_COMPATIBLE_LEG',
  'MULTI_LEG_ROUTE',
  'SWAP_REQUIRED',
  'BRIDGE_REQUIRED',
] as const);

export const ROUTING_FEE_V1_BASIS_POINTS = Object.freeze({
  FREE: 20,
  INDIVIDUAL: 12,
  PRO: 8,
} as const);

export type RoutingFeeTier = (typeof ROUTING_FEE_TIERS)[number];
export type RoutingFeeCategory = (typeof ROUTING_FEE_CATEGORIES)[number];
export type RoutingFeePassThroughCategory = (typeof ROUTING_FEE_PASS_THROUGH_CATEGORIES)[number];
export type RoutingFeeDeductionMode = (typeof ROUTING_FEE_DEDUCTION_MODES)[number];
export type RoutingFeeRoundingMode = (typeof ROUTING_FEE_ROUNDING_MODES)[number];
export type RoutingFeeRouteLegKind = (typeof ROUTING_FEE_ROUTE_LEG_KINDS)[number];
export type RoutingFeeRouteClassificationKind = (typeof ROUTING_FEE_ROUTE_CLASSIFICATIONS)[number];
export type RoutingFeeClassificationReason = (typeof ROUTING_FEE_CLASSIFICATION_REASONS)[number];

export interface RoutingFeeDecimalV1 {
  /** `mantissa * 10^-scale`; values never cross a binary floating-point boundary. */
  readonly mantissa: string;
  readonly scale: number;
}

export interface RoutingFeeRuleVersionV1 {
  readonly schemaVersion: typeof ROUTING_FEE_RULE_SCHEMA_VERSION;
  readonly ruleReferenceId: string;
  readonly version: number;
  readonly effectiveFrom: string;
  /** Exclusive upper bound. `null` means the version has no scheduled end. */
  readonly effectiveUntil: string | null;
  readonly routeClassificationVersion: typeof ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION;
  readonly roundingMode: RoutingFeeRoundingMode;
  readonly platformRates: Readonly<{
    readonly directCompatible: RoutingFeeDecimalV1;
    readonly materialOrchestration: Readonly<Record<RoutingFeeTier, RoutingFeeDecimalV1>>;
  }>;
}

export interface RoutingFeeRuleCatalogV1 {
  readonly schemaVersion: typeof ROUTING_FEE_RULE_CATALOG_SCHEMA_VERSION;
  readonly rules: readonly RoutingFeeRuleVersionV1[];
}

export interface RoutingFeeRouteEndpointV1 {
  readonly networkId: string;
  readonly assetId: string;
}

export interface RoutingFeeRouteLegV1 {
  readonly kind: RoutingFeeRouteLegKind;
  readonly source: RoutingFeeRouteEndpointV1;
  readonly destination: RoutingFeeRouteEndpointV1;
}

export interface RoutingFeeRouteV1 {
  readonly schemaVersion: typeof ROUTING_FEE_ROUTE_SCHEMA_VERSION;
  readonly source: RoutingFeeRouteEndpointV1;
  readonly destination: RoutingFeeRouteEndpointV1;
  readonly legs: readonly RoutingFeeRouteLegV1[];
}

export interface RoutingFeeRouteClassificationV1 {
  readonly version: typeof ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION;
  readonly kind: RoutingFeeRouteClassificationKind;
  readonly reasons: readonly RoutingFeeClassificationReason[];
}

export interface RoutingFeeAtomicAmountInput {
  readonly assetRevisionId: string;
  readonly amountAtomic: string;
}

export interface RoutingFeePassThroughComponentInput extends RoutingFeeAtomicAmountInput {
  readonly category: RoutingFeePassThroughCategory;
  readonly deductionMode: RoutingFeeDeductionMode;
  readonly sourceReferenceId: string;
}

export interface CalculateRoutingFeeSnapshotInput {
  readonly schemaVersion: typeof ROUTING_FEE_SNAPSHOT_SCHEMA_VERSION;
  readonly quoteReferenceId: string;
  readonly routeReferenceId: string;
  readonly quotedAt: string;
  /** Missing, `undefined`, or `null` means the authoritative Free default. */
  readonly tier?: RoutingFeeTier | null;
  readonly route: RoutingFeeRouteV1;
  readonly feeBase: RoutingFeeAtomicAmountInput;
  readonly passThroughComponents: readonly RoutingFeePassThroughComponentInput[];
}

export interface RoutingFeeComponentV1 extends RoutingFeeAtomicAmountInput {
  readonly lineNumber: number;
  readonly category: RoutingFeeCategory;
  readonly deductionMode: RoutingFeeDeductionMode;
  readonly source: 'PLATFORM_RULE' | 'PASS_THROUGH_QUOTE';
  readonly sourceReferenceId: string;
}

export type RoutingFeeAssetTotalV1 = RoutingFeeAtomicAmountInput;

export interface RoutingFeeSnapshotV1 {
  readonly schemaVersion: typeof ROUTING_FEE_SNAPSHOT_SCHEMA_VERSION;
  readonly quoteReferenceId: string;
  readonly routeReferenceId: string;
  readonly quotedAt: string;
  readonly effectiveTier: RoutingFeeTier;
  readonly rule: RoutingFeeRuleVersionV1;
  readonly route: RoutingFeeRouteV1;
  readonly routeClassification: RoutingFeeRouteClassificationV1;
  readonly feeBase: RoutingFeeAtomicAmountInput;
  readonly components: readonly RoutingFeeComponentV1[];
  /** Totals are kept per exact asset revision; unlike assets are never added together. */
  readonly totalsByAsset: readonly RoutingFeeAssetTotalV1[];
  readonly fingerprintSha256: string;
}

export type RoutingFeeValidationCode =
  | 'INVALID_RULE'
  | 'INVALID_RULE_CATALOG'
  | 'NO_EFFECTIVE_RULE'
  | 'INVALID_ROUTE'
  | 'INVALID_CALCULATION_INPUT'
  | 'INVALID_FEE_COMPONENT'
  | 'INVALID_ATOMIC_AMOUNT'
  | 'NUMERIC_LIMIT_EXCEEDED';

export class RoutingFeeValidationError extends Error {
  constructor(readonly code: RoutingFeeValidationCode) {
    super(code);
    this.name = 'RoutingFeeValidationError';
  }
}

type PlainRecord = Readonly<Record<string, unknown>>;

function validationError(code: RoutingFeeValidationCode): never {
  throw new RoutingFeeValidationError(code);
}

function ownDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  code: RoutingFeeValidationCode,
): PlainRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return validationError(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return validationError(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const ownKeys = Reflect.ownKeys(descriptors);
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    if (
      requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
    ) {
      return validationError(code);
    }
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys) {
      if (typeof key !== 'string') return validationError(code);
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return validationError(code);
      }
      copy[key] = descriptor.value;
    }
    return copy;
  } catch (error) {
    if (error instanceof RoutingFeeValidationError) throw error;
    return validationError(code);
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: RoutingFeeValidationCode,
): PlainRecord {
  return ownDataRecord(value, keys, [], code);
}

function ownDataArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  code: RoutingFeeValidationCode,
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return validationError(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return validationError(code);
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < minimumLength ||
      length > maximumLength
    ) {
      return validationError(code);
    }
    const expectedKeys = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== expectedKeys.size ||
      ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      return validationError(code);
    }
    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return validationError(code);
      }
      copy.push(descriptor.value);
    }
    return copy;
  } catch (error) {
    if (error instanceof RoutingFeeValidationError) throw error;
    return validationError(code);
  }
}

function enumMember<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  code: RoutingFeeValidationCode,
): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) {
    return validationError(code);
  }
  return value as Value;
}

function uuidV4(value: unknown, code: RoutingFeeValidationCode): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return validationError(code);
  }
  return value;
}

function safeReference(value: unknown, code: RoutingFeeValidationCode): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REFERENCE_LENGTH ||
    !SAFE_REFERENCE_PATTERN.test(value)
  ) {
    return validationError(code);
  }
  return value;
}

function positiveVersion(value: unknown, code: RoutingFeeValidationCode): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return validationError(code);
  }
  return value;
}

function canonicalTimestamp(value: unknown, code: RoutingFeeValidationCode): string {
  if (typeof value !== 'string' || !CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) {
    return validationError(code);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return validationError(code);
  }
  return value;
}

function parseDecimal(value: unknown, code: RoutingFeeValidationCode): RoutingFeeDecimalV1 {
  const record = exactDataRecord(value, ['mantissa', 'scale'], code);
  const mantissa = record.mantissa;
  const scale = record.scale;
  if (
    typeof mantissa !== 'string' ||
    !UNSIGNED_INTEGER_PATTERN.test(mantissa) ||
    mantissa.length > MAX_DECIMAL_DIGITS ||
    typeof scale !== 'number' ||
    !Number.isSafeInteger(scale) ||
    scale < 0 ||
    scale > MAX_DECIMAL_SCALE ||
    BigInt(mantissa) > 10n ** BigInt(scale)
  ) {
    return validationError(code);
  }
  return Object.freeze({ mantissa, scale });
}

function isZeroDecimal(value: RoutingFeeDecimalV1): boolean {
  return value.mantissa === '0';
}

function parseAtomicAmount(
  value: unknown,
  allowZero: boolean,
  code: RoutingFeeValidationCode,
): string {
  const pattern = allowZero ? UNSIGNED_INTEGER_PATTERN : POSITIVE_INTEGER_PATTERN;
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value.length > MAX_ROUTING_FEE_ATOMIC_AMOUNT.length ||
    (value.length === MAX_ROUTING_FEE_ATOMIC_AMOUNT.length && value > MAX_ROUTING_FEE_ATOMIC_AMOUNT)
  ) {
    return validationError(code);
  }
  return value;
}

function parseRates(value: unknown): Readonly<Record<RoutingFeeTier, RoutingFeeDecimalV1>> {
  const record = exactDataRecord(value, ROUTING_FEE_TIERS, 'INVALID_RULE');
  return Object.freeze({
    FREE: parseDecimal(record.FREE, 'INVALID_RULE'),
    INDIVIDUAL: parseDecimal(record.INDIVIDUAL, 'INVALID_RULE'),
    PRO: parseDecimal(record.PRO, 'INVALID_RULE'),
  });
}

export function normalizeRoutingFeeRuleVersionV1(value: unknown): RoutingFeeRuleVersionV1 {
  const record = exactDataRecord(
    value,
    [
      'schemaVersion',
      'ruleReferenceId',
      'version',
      'effectiveFrom',
      'effectiveUntil',
      'routeClassificationVersion',
      'roundingMode',
      'platformRates',
    ],
    'INVALID_RULE',
  );
  if (
    record.schemaVersion !== ROUTING_FEE_RULE_SCHEMA_VERSION ||
    record.routeClassificationVersion !== ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION
  ) {
    return validationError('INVALID_RULE');
  }
  const effectiveFrom = canonicalTimestamp(record.effectiveFrom, 'INVALID_RULE');
  const effectiveUntil =
    record.effectiveUntil === null
      ? null
      : canonicalTimestamp(record.effectiveUntil, 'INVALID_RULE');
  if (effectiveUntil !== null && effectiveUntil <= effectiveFrom) {
    return validationError('INVALID_RULE');
  }
  const platformRates = exactDataRecord(
    record.platformRates,
    ['directCompatible', 'materialOrchestration'],
    'INVALID_RULE',
  );
  const directCompatible = parseDecimal(platformRates.directCompatible, 'INVALID_RULE');
  if (!isZeroDecimal(directCompatible)) return validationError('INVALID_RULE');

  return Object.freeze({
    schemaVersion: ROUTING_FEE_RULE_SCHEMA_VERSION,
    ruleReferenceId: uuidV4(record.ruleReferenceId, 'INVALID_RULE'),
    version: positiveVersion(record.version, 'INVALID_RULE'),
    effectiveFrom,
    effectiveUntil,
    routeClassificationVersion: ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION,
    roundingMode: enumMember(record.roundingMode, ROUTING_FEE_ROUNDING_MODES, 'INVALID_RULE'),
    platformRates: Object.freeze({
      directCompatible,
      materialOrchestration: parseRates(platformRates.materialOrchestration),
    }),
  });
}

export function normalizeRoutingFeeRuleCatalogV1(value: unknown): RoutingFeeRuleCatalogV1 {
  const record = exactDataRecord(value, ['schemaVersion', 'rules'], 'INVALID_RULE_CATALOG');
  if (record.schemaVersion !== ROUTING_FEE_RULE_CATALOG_SCHEMA_VERSION) {
    return validationError('INVALID_RULE_CATALOG');
  }
  let rawRules: readonly unknown[];
  try {
    rawRules = ownDataArray(record.rules, 1, 128, 'INVALID_RULE_CATALOG');
  } catch (error) {
    if (error instanceof RoutingFeeValidationError) {
      return validationError('INVALID_RULE_CATALOG');
    }
    throw error;
  }
  let rules: RoutingFeeRuleVersionV1[];
  try {
    rules = rawRules.map(normalizeRoutingFeeRuleVersionV1);
  } catch (error) {
    if (error instanceof RoutingFeeValidationError) {
      return validationError('INVALID_RULE_CATALOG');
    }
    throw error;
  }
  rules.sort((left, right) => {
    if (left.effectiveFrom === right.effectiveFrom) return left.version - right.version;
    return left.effectiveFrom < right.effectiveFrom ? -1 : 1;
  });
  if (
    new Set(rules.map(({ ruleReferenceId }) => ruleReferenceId)).size !== rules.length ||
    new Set(rules.map(({ version }) => version)).size !== rules.length
  ) {
    return validationError('INVALID_RULE_CATALOG');
  }
  for (let index = 0; index < rules.length - 1; index += 1) {
    const current = rules[index];
    const next = rules[index + 1];
    if (
      !current ||
      !next ||
      current.version >= next.version ||
      current.effectiveUntil === null ||
      current.effectiveUntil > next.effectiveFrom
    ) {
      return validationError('INVALID_RULE_CATALOG');
    }
  }
  return Object.freeze({
    schemaVersion: ROUTING_FEE_RULE_CATALOG_SCHEMA_VERSION,
    rules: Object.freeze(rules),
  });
}

export function resolveRoutingFeeRuleV1(
  catalogValue: unknown,
  atValue: unknown,
): RoutingFeeRuleVersionV1 {
  const catalog = normalizeRoutingFeeRuleCatalogV1(catalogValue);
  const at = canonicalTimestamp(atValue, 'NO_EFFECTIVE_RULE');
  const matching = catalog.rules.filter(
    ({ effectiveFrom, effectiveUntil }) =>
      effectiveFrom <= at && (effectiveUntil === null || at < effectiveUntil),
  );
  if (matching.length !== 1) return validationError('NO_EFFECTIVE_RULE');
  return matching[0]!;
}

function parseEndpoint(value: unknown): RoutingFeeRouteEndpointV1 {
  const record = exactDataRecord(value, ['networkId', 'assetId'], 'INVALID_ROUTE');
  return Object.freeze({
    networkId: safeReference(record.networkId, 'INVALID_ROUTE'),
    assetId: safeReference(record.assetId, 'INVALID_ROUTE'),
  });
}

function sameEndpoint(left: RoutingFeeRouteEndpointV1, right: RoutingFeeRouteEndpointV1): boolean {
  return left.networkId === right.networkId && left.assetId === right.assetId;
}

function parseLeg(value: unknown): RoutingFeeRouteLegV1 {
  const record = exactDataRecord(value, ['kind', 'source', 'destination'], 'INVALID_ROUTE');
  const kind = enumMember(record.kind, ROUTING_FEE_ROUTE_LEG_KINDS, 'INVALID_ROUTE');
  const source = parseEndpoint(record.source);
  const destination = parseEndpoint(record.destination);
  if (
    (kind === 'DIRECT_SETTLEMENT' && !sameEndpoint(source, destination)) ||
    (kind === 'SWAP' &&
      (source.networkId !== destination.networkId || source.assetId === destination.assetId)) ||
    (kind === 'BRIDGE' && source.networkId === destination.networkId)
  ) {
    return validationError('INVALID_ROUTE');
  }
  return Object.freeze({ kind, source, destination });
}

export function normalizeRoutingFeeRouteV1(value: unknown): RoutingFeeRouteV1 {
  const record = exactDataRecord(
    value,
    ['schemaVersion', 'source', 'destination', 'legs'],
    'INVALID_ROUTE',
  );
  if (record.schemaVersion !== ROUTING_FEE_ROUTE_SCHEMA_VERSION) {
    return validationError('INVALID_ROUTE');
  }
  const source = parseEndpoint(record.source);
  const destination = parseEndpoint(record.destination);
  const legs = Object.freeze(
    ownDataArray(record.legs, 1, MAX_ROUTE_LEGS, 'INVALID_ROUTE').map(parseLeg),
  );
  if (
    !sameEndpoint(source, legs[0]!.source) ||
    !sameEndpoint(destination, legs.at(-1)!.destination)
  ) {
    return validationError('INVALID_ROUTE');
  }
  for (let index = 1; index < legs.length; index += 1) {
    if (!sameEndpoint(legs[index - 1]!.destination, legs[index]!.source)) {
      return validationError('INVALID_ROUTE');
    }
  }
  return Object.freeze({
    schemaVersion: ROUTING_FEE_ROUTE_SCHEMA_VERSION,
    source,
    destination,
    legs,
  });
}

function classifyNormalizedRoute(route: RoutingFeeRouteV1): RoutingFeeRouteClassificationV1 {
  const swapRequired = route.legs.some(({ kind }) => kind === 'SWAP');
  const bridgeRequired = route.legs.some(({ kind }) => kind === 'BRIDGE');
  const multiLeg = route.legs.length > 1;
  if (!swapRequired && !bridgeRequired && !multiLeg) {
    return Object.freeze({
      version: ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION,
      kind: 'DIRECT_COMPATIBLE',
      reasons: Object.freeze(['SINGLE_DIRECT_COMPATIBLE_LEG'] as const),
    });
  }
  const reasons: RoutingFeeClassificationReason[] = [];
  if (multiLeg) reasons.push('MULTI_LEG_ROUTE');
  if (swapRequired) reasons.push('SWAP_REQUIRED');
  if (bridgeRequired) reasons.push('BRIDGE_REQUIRED');
  return Object.freeze({
    version: ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION,
    kind: 'MATERIAL_ORCHESTRATION',
    reasons: Object.freeze(reasons),
  });
}

export function classifyRoutingFeeRouteV1(value: unknown): RoutingFeeRouteClassificationV1 {
  return classifyNormalizedRoute(normalizeRoutingFeeRouteV1(value));
}

function parseFeeBase(value: unknown): RoutingFeeAtomicAmountInput {
  const record = exactDataRecord(
    value,
    ['assetRevisionId', 'amountAtomic'],
    'INVALID_CALCULATION_INPUT',
  );
  return Object.freeze({
    assetRevisionId: uuidV4(record.assetRevisionId, 'INVALID_CALCULATION_INPUT'),
    amountAtomic: parseAtomicAmount(record.amountAtomic, false, 'INVALID_ATOMIC_AMOUNT'),
  });
}

function parsePassThroughComponent(value: unknown): RoutingFeePassThroughComponentInput {
  const record = exactDataRecord(
    value,
    ['category', 'assetRevisionId', 'amountAtomic', 'deductionMode', 'sourceReferenceId'],
    'INVALID_FEE_COMPONENT',
  );
  return Object.freeze({
    category: enumMember(
      record.category,
      ROUTING_FEE_PASS_THROUGH_CATEGORIES,
      'INVALID_FEE_COMPONENT',
    ),
    assetRevisionId: uuidV4(record.assetRevisionId, 'INVALID_FEE_COMPONENT'),
    amountAtomic: parseAtomicAmount(record.amountAtomic, true, 'INVALID_ATOMIC_AMOUNT'),
    deductionMode: enumMember(
      record.deductionMode,
      ROUTING_FEE_DEDUCTION_MODES,
      'INVALID_FEE_COMPONENT',
    ),
    sourceReferenceId: uuidV4(record.sourceReferenceId, 'INVALID_FEE_COMPONENT'),
  });
}

function effectiveTier(value: unknown): RoutingFeeTier {
  if (value === undefined || value === null) return 'FREE';
  return enumMember(value, ROUTING_FEE_TIERS, 'INVALID_CALCULATION_INPUT');
}

function roundRatio(
  numerator: bigint,
  denominator: bigint,
  roundingMode: RoutingFeeRoundingMode,
): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || roundingMode === 'DOWN') return quotient;
  if (roundingMode === 'UP') return quotient + 1n;
  const doubledRemainder = remainder * 2n;
  if (doubledRemainder < denominator) return quotient;
  if (doubledRemainder > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

export function calculateRoutingFeeAtomicAmount(
  amountAtomicValue: unknown,
  rateValue: unknown,
  roundingModeValue: unknown,
): string {
  const amountAtomic = parseAtomicAmount(amountAtomicValue, true, 'INVALID_ATOMIC_AMOUNT');
  const rate = parseDecimal(rateValue, 'INVALID_RULE');
  const roundingMode = enumMember(roundingModeValue, ROUTING_FEE_ROUNDING_MODES, 'INVALID_RULE');
  const result = roundRatio(
    BigInt(amountAtomic) * BigInt(rate.mantissa),
    10n ** BigInt(rate.scale),
    roundingMode,
  );
  if (result > BigInt(MAX_ROUTING_FEE_ATOMIC_AMOUNT)) {
    return validationError('NUMERIC_LIMIT_EXCEEDED');
  }
  return result.toString();
}

function totalsByAsset(
  components: readonly RoutingFeeComponentV1[],
): readonly RoutingFeeAssetTotalV1[] {
  const totals = new Map<string, bigint>();
  for (const component of components) {
    const next = (totals.get(component.assetRevisionId) ?? 0n) + BigInt(component.amountAtomic);
    if (next > BigInt(MAX_ROUTING_FEE_ATOMIC_AMOUNT)) {
      return validationError('NUMERIC_LIMIT_EXCEEDED');
    }
    totals.set(component.assetRevisionId, next);
  }
  return Object.freeze(
    [...totals.entries()]
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([assetRevisionId, amountAtomic]) =>
        Object.freeze({ assetRevisionId, amountAtomic: amountAtomic.toString() }),
      ),
  );
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update('crypto-lending:routing-fee-snapshot:v1\0', 'utf8')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

export function calculateRoutingFeeSnapshotV1(
  inputValue: unknown,
  catalogValue: unknown = ROUTING_FEE_RULE_CATALOG_V1,
): RoutingFeeSnapshotV1 {
  const record = ownDataRecord(
    inputValue,
    [
      'schemaVersion',
      'quoteReferenceId',
      'routeReferenceId',
      'quotedAt',
      'route',
      'feeBase',
      'passThroughComponents',
    ],
    ['tier'],
    'INVALID_CALCULATION_INPUT',
  );
  if (record.schemaVersion !== ROUTING_FEE_SNAPSHOT_SCHEMA_VERSION) {
    return validationError('INVALID_CALCULATION_INPUT');
  }
  const quoteReferenceId = uuidV4(record.quoteReferenceId, 'INVALID_CALCULATION_INPUT');
  const routeReferenceId = uuidV4(record.routeReferenceId, 'INVALID_CALCULATION_INPUT');
  const quotedAt = canonicalTimestamp(record.quotedAt, 'INVALID_CALCULATION_INPUT');
  const tier = effectiveTier(record.tier);
  const route = normalizeRoutingFeeRouteV1(record.route);
  const routeClassification = classifyNormalizedRoute(route);
  const feeBase = parseFeeBase(record.feeBase);
  const passThroughComponents = ownDataArray(
    record.passThroughComponents,
    0,
    MAX_FEE_COMPONENTS - 1,
    'INVALID_FEE_COMPONENT',
  ).map(parsePassThroughComponent);
  const rule = resolveRoutingFeeRuleV1(catalogValue, quotedAt);
  const platformRate =
    routeClassification.kind === 'DIRECT_COMPATIBLE'
      ? rule.platformRates.directCompatible
      : rule.platformRates.materialOrchestration[tier];
  const platformAmount = calculateRoutingFeeAtomicAmount(
    feeBase.amountAtomic,
    platformRate,
    rule.roundingMode,
  );
  const components: readonly RoutingFeeComponentV1[] = Object.freeze([
    Object.freeze({
      lineNumber: 1,
      category: 'PLATFORM',
      assetRevisionId: feeBase.assetRevisionId,
      amountAtomic: platformAmount,
      deductionMode: 'ADDED_ON_TOP',
      source: 'PLATFORM_RULE',
      sourceReferenceId: rule.ruleReferenceId,
    }),
    ...passThroughComponents.map((component, index) =>
      Object.freeze({
        lineNumber: index + 2,
        category: component.category,
        assetRevisionId: component.assetRevisionId,
        amountAtomic: component.amountAtomic,
        deductionMode: component.deductionMode,
        source: 'PASS_THROUGH_QUOTE' as const,
        sourceReferenceId: component.sourceReferenceId,
      }),
    ),
  ]);
  const totals = totalsByAsset(components);
  const snapshotWithoutFingerprint = Object.freeze({
    schemaVersion: ROUTING_FEE_SNAPSHOT_SCHEMA_VERSION,
    quoteReferenceId,
    routeReferenceId,
    quotedAt,
    effectiveTier: tier,
    rule,
    route,
    routeClassification,
    feeBase,
    components,
    totalsByAsset: totals,
  });
  const fingerprintSha256 = fingerprint(snapshotWithoutFingerprint);
  if (!SHA256_PATTERN.test(fingerprintSha256)) {
    return validationError('INVALID_CALCULATION_INPUT');
  }
  return Object.freeze({ ...snapshotWithoutFingerprint, fingerprintSha256 });
}

export const ROUTING_FEE_RULE_V1 = normalizeRoutingFeeRuleVersionV1({
  schemaVersion: ROUTING_FEE_RULE_SCHEMA_VERSION,
  ruleReferenceId: '76000000-0000-4000-8000-000000000001',
  version: 1,
  effectiveFrom: '2026-08-25T00:00:00.000Z',
  effectiveUntil: null,
  routeClassificationVersion: ROUTING_FEE_ROUTE_CLASSIFICATION_VERSION,
  roundingMode: 'HALF_EVEN',
  platformRates: {
    directCompatible: { mantissa: '0', scale: 0 },
    materialOrchestration: {
      FREE: { mantissa: String(ROUTING_FEE_V1_BASIS_POINTS.FREE), scale: 4 },
      INDIVIDUAL: { mantissa: String(ROUTING_FEE_V1_BASIS_POINTS.INDIVIDUAL), scale: 4 },
      PRO: { mantissa: String(ROUTING_FEE_V1_BASIS_POINTS.PRO), scale: 4 },
    },
  },
});

export const ROUTING_FEE_RULE_CATALOG_V1 = normalizeRoutingFeeRuleCatalogV1({
  schemaVersion: ROUTING_FEE_RULE_CATALOG_SCHEMA_VERSION,
  rules: [ROUTING_FEE_RULE_V1],
});

export const normalizeRoutingFeeRuleVersion = normalizeRoutingFeeRuleVersionV1;
export const normalizeRoutingFeeRuleCatalog = normalizeRoutingFeeRuleCatalogV1;
export const resolveRoutingFeeRule = resolveRoutingFeeRuleV1;
export const normalizeRoutingFeeRoute = normalizeRoutingFeeRouteV1;
export const classifyRoutingFeeRoute = classifyRoutingFeeRouteV1;
export const calculateRoutingFeeSnapshot = calculateRoutingFeeSnapshotV1;
