import {
  PORTFOLIO_ASSET_IDENTITIES,
  PORTFOLIO_NETWORKS,
  type StablecoinSymbol,
} from './unified-balance';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const REGISTRY_FINGERPRINT = /^[0-9a-f]{64}$/u;
const MAINNET_V1_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const MAX_SOURCES = 512;
const MAX_REASONS = 16;
const MAX_USD_DIGITS = 100;
const MAX_ATOMIC_DIGITS = 78;

const MAINNET_NETWORK_IDS = ['eip155:8453'] as const;

const FRESHNESS_VALUES = ['CURRENT', 'STALE', 'UNAVAILABLE'] as const;
const COMPLETENESS_VALUES = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'] as const;
const STABLECOINS = ['USDC', 'USDT', 'PYUSD'] as const;
const VALUATION_REASONS = [
  'INVALID_INPUT',
  'NO_ELIGIBLE_SOURCE',
  'SOURCE_CONFLICT',
  'SINGLE_SOURCE',
  'FALLBACK_SOURCE_SELECTED',
  'SOFT_SOURCE_DISAGREEMENT',
  'PUBLISHED_CONFIDENCE_LOWER_BOUND',
  'UPSIDE_CAPPED_AT_PEG',
  'WATCH_DOWNSIDE',
  'DEPEG_DETECTED',
  'NUMERIC_LIMIT_EXCEEDED',
] as const;

export type ProductionPortfolioNetworkId = (typeof MAINNET_NETWORK_IDS)[number];
export type ReportingFreshness = (typeof FRESHNESS_VALUES)[number];
export type ReportingCompleteness = (typeof COMPLETENESS_VALUES)[number];

export interface ReportingExactUsdAmount {
  readonly currency: 'USD';
  readonly mantissa: string;
  readonly scale: 18;
  readonly decimal: string;
}

export interface ReportingAggregate {
  readonly usdValue: ReportingExactUsdAmount | null;
  readonly freshnessClass: ReportingFreshness;
  readonly completeness: ReportingCompleteness;
  readonly sourceCount: number;
  readonly includedSourceCount: number;
}

export interface ReportingChainTotal extends ReportingAggregate {
  readonly networkId: ProductionPortfolioNetworkId;
}

export interface ReportingAssetTotal extends ReportingAggregate {
  readonly stablecoin: StablecoinSymbol;
}

/**
 * The browser retains only the reporting fields it renders. Wallet, observation,
 * address, registry, and pricing-provider identifiers are validated and discarded.
 */
export interface ReportingPortfolioSnapshot {
  readonly schemaVersion: 1;
  readonly asOf: string;
  readonly balanceSnapshot: Readonly<{
    readonly capturedAt: string;
    readonly freshnessClass: 'CURRENT' | 'STALE';
  }>;
  readonly oldestBalanceObservedAt: string | null;
  readonly overallTotal: ReportingAggregate;
  readonly chainTotals: readonly ReportingChainTotal[];
  readonly assetTotals: readonly ReportingAssetTotal[];
  readonly excludedSourceCount: number;
  readonly reportingUse: 'CONSERVATIVE_REPORTING_ONLY';
  readonly mayIncreaseBuyingPower: false;
  readonly mayAuthorizeFinancialUse: false;
}

interface Contribution {
  readonly freshnessClass: ReportingFreshness;
  readonly usdValue: ReportingExactUsdAmount | null;
}

interface ParsedSource extends Contribution {
  readonly observationId: string;
  readonly walletId: string;
  readonly networkId: ProductionPortfolioNetworkId;
  readonly stablecoin: StablecoinSymbol;
  readonly assetIdentity: string;
  readonly balanceObservedAt: string;
  readonly registryFingerprint: string;
}

interface ParsedExcludedSource extends Contribution {
  readonly observationId: string;
  readonly walletId: string;
  readonly networkId: ProductionPortfolioNetworkId;
  readonly assetIdentity: string;
  readonly balanceObservedAt: string;
}

export class ReportingPortfolioResponseError extends Error {
  constructor() {
    super('Portfolio reporting data is unavailable.');
    this.name = 'ReportingPortfolioResponseError';
  }
}

function fail(): never {
  throw new ReportingPortfolioResponseError();
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (
      descriptorKeys.length !== expectedKeys.length ||
      descriptorKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      return fail();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error: unknown) {
    if (error instanceof ReportingPortfolioResponseError) throw error;
    return fail();
  }
}

function boundedArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return fail();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [
      ...new Array<string>(value.length).fill('').map((_, index) => String(index)),
      'length',
    ];
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expectedKeys.includes(key),
      ) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      expectedKeys.some((key) => !('value' in descriptors[key]!))
    ) {
      return fail();
    }
    return expectedKeys
      .slice(0, -1)
      .map((key) => ('value' in descriptors[key]! ? descriptors[key]!.value : undefined));
  } catch (error: unknown) {
    if (error instanceof ReportingPortfolioResponseError) throw error;
    return fail();
  }
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
): Values[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) return fail();
  return value as Values[number];
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function canonicalInteger(value: unknown, maximumDigits: number): string {
  if (typeof value !== 'string' || value.length > maximumDigits || !CANONICAL_INTEGER.test(value)) {
    return fail();
  }
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail();
  }
  return value as number;
}

function safeOpaqueString(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
  ) {
    return fail();
  }
  return value;
}

function nullableOpaqueString(value: unknown, maximumLength: number): string | null {
  return value === null ? null : safeOpaqueString(value, maximumLength);
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail();
  return value;
}

function formatFixedDecimal(mantissa: string, scale: number): string {
  if (scale === 0) return mantissa;
  const padded = mantissa.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function parseExactUsd(value: unknown): ReportingExactUsdAmount {
  const record = exactDataRecord(value, ['currency', 'mantissa', 'scale', 'decimal']);
  if (record.currency !== 'USD' || record.scale !== 18) return fail();
  const mantissa = canonicalInteger(record.mantissa, MAX_USD_DIGITS);
  const decimal = formatFixedDecimal(mantissa, 18);
  if (record.decimal !== decimal) return fail();
  return Object.freeze({ currency: 'USD', mantissa, scale: 18, decimal });
}

function nullableExactUsd(value: unknown): ReportingExactUsdAmount | null {
  return value === null ? null : parseExactUsd(value);
}

function parseAggregateRecord(record: Record<string, unknown>): ReportingAggregate {
  const usdValue = nullableExactUsd(record.usdValue);
  const freshnessClass = oneOf(record.freshnessClass, FRESHNESS_VALUES);
  const completeness = oneOf(record.completeness, COMPLETENESS_VALUES);
  const sourceCount = boundedInteger(record.sourceCount, 0, MAX_SOURCES);
  const includedSourceCount = boundedInteger(record.includedSourceCount, 0, sourceCount);

  if (
    (sourceCount === 0 &&
      (includedSourceCount !== 0 ||
        usdValue?.mantissa !== '0' ||
        freshnessClass !== 'CURRENT' ||
        completeness !== 'COMPLETE')) ||
    (sourceCount > 0 &&
      includedSourceCount === 0 &&
      (usdValue !== null || completeness !== 'UNAVAILABLE')) ||
    (sourceCount > 0 &&
      includedSourceCount === sourceCount &&
      (usdValue === null || completeness !== 'COMPLETE')) ||
    (includedSourceCount > 0 &&
      includedSourceCount < sourceCount &&
      (usdValue === null || completeness !== 'PARTIAL'))
  ) {
    return fail();
  }

  return Object.freeze({
    usdValue,
    freshnessClass,
    completeness,
    sourceCount,
    includedSourceCount,
  });
}

function parseAggregate(value: unknown): ReportingAggregate {
  return parseAggregateRecord(
    exactDataRecord(value, [
      'usdValue',
      'freshnessClass',
      'completeness',
      'sourceCount',
      'includedSourceCount',
    ]),
  );
}

function parseValuation(
  value: unknown,
  asOf: string,
): Readonly<{
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  freshnessClass: ReportingFreshness;
}> {
  const record = exactDataRecord(value, [
    'priceSnapshotId',
    'policyVersion',
    'policyApprovalState',
    'availability',
    'selection',
    'selectedSourceId',
    'selectedSourceReference',
    'selectedSourceSequence',
    'pricedAt',
    'observedAt',
    'usdRateMantissa',
    'usdRateScale',
    'freshnessClass',
    'confidenceClass',
    'depegClass',
    'downsideBand',
    'sourceAgreement',
    'reasons',
    'reportingUse',
    'mayIncreaseBuyingPower',
    'mayAuthorizeFinancialUse',
  ]);

  nullableOpaqueString(record.priceSnapshotId, 128);
  if (record.policyVersion !== 1 || record.policyApprovalState !== 'PENDING_EXTERNAL_APPROVAL') {
    return fail();
  }
  const availability = oneOf(record.availability, ['AVAILABLE', 'UNAVAILABLE'] as const);
  const selection = oneOf(record.selection, [
    'PRIMARY',
    'FALLBACK',
    'CONSERVATIVE_MINIMUM',
    'NONE',
  ] as const);
  const selectedSourceId =
    record.selectedSourceId === null
      ? null
      : oneOf(record.selectedSourceId, ['PYTH_CORE', 'CHAINLINK_DATA_FEEDS'] as const);
  const selectedSourceReference = nullableOpaqueString(record.selectedSourceReference, 192);
  const selectedSourceSequence = nullableOpaqueString(record.selectedSourceSequence, 78);
  const pricedAt = record.pricedAt === null ? null : canonicalTimestamp(record.pricedAt);
  const observedAt = record.observedAt === null ? null : canonicalTimestamp(record.observedAt);
  const usdRateMantissa =
    record.usdRateMantissa === null
      ? null
      : canonicalInteger(record.usdRateMantissa, MAX_USD_DIGITS);
  const usdRateScale =
    record.usdRateScale === null ? null : boundedInteger(record.usdRateScale, 0, 36);
  const freshnessClass = oneOf(record.freshnessClass, FRESHNESS_VALUES);
  const confidenceClass = oneOf(record.confidenceClass, ['MEDIUM', 'LOW', 'UNAVAILABLE'] as const);
  oneOf(record.depegClass, ['NOT_ASSESSED', 'WITHIN_POLICY', 'OUTSIDE_POLICY'] as const);
  oneOf(record.downsideBand, ['NORMAL', 'WATCH', 'DEPEGGED', 'NOT_ASSESSED'] as const);
  const sourceAgreement = oneOf(record.sourceAgreement, [
    'CORROBORATED',
    'SOFT_DISAGREEMENT',
    'CONFLICT',
    'SINGLE_SOURCE',
    'NOT_AVAILABLE',
  ] as const);
  const reasons = boundedArray(record.reasons, MAX_REASONS).map((reason) =>
    oneOf(reason, VALUATION_REASONS),
  );
  if (new Set(reasons).size !== reasons.length) return fail();
  if (record.mayIncreaseBuyingPower !== false || record.mayAuthorizeFinancialUse !== false) {
    return fail();
  }
  if ((pricedAt !== null && pricedAt > asOf) || (observedAt !== null && observedAt > asOf)) {
    return fail();
  }

  if (availability === 'AVAILABLE') {
    if (
      selection === 'NONE' ||
      selectedSourceId === null ||
      selectedSourceReference === null ||
      selectedSourceSequence === null ||
      pricedAt === null ||
      observedAt === null ||
      usdRateMantissa === null ||
      usdRateScale === null ||
      freshnessClass === 'UNAVAILABLE' ||
      confidenceClass === 'UNAVAILABLE' ||
      sourceAgreement === 'CONFLICT' ||
      sourceAgreement === 'NOT_AVAILABLE' ||
      record.reportingUse !== 'CONSERVATIVE_REPORTING_ONLY'
    ) {
      return fail();
    }
  } else if (
    selection !== 'NONE' ||
    selectedSourceId !== null ||
    selectedSourceReference !== null ||
    selectedSourceSequence !== null ||
    pricedAt !== null ||
    observedAt !== null ||
    usdRateMantissa !== null ||
    usdRateScale !== null ||
    freshnessClass !== 'UNAVAILABLE' ||
    confidenceClass !== 'UNAVAILABLE' ||
    record.reportingUse !== 'BLOCKED'
  ) {
    return fail();
  }
  return { availability, freshnessClass };
}

function parseSource(value: unknown, asOf: string): ParsedSource {
  const record = exactDataRecord(value, [
    'observationId',
    'walletId',
    'networkId',
    'asset',
    'balance',
    'balanceObservedAt',
    'balanceFreshnessClass',
    'freshnessClass',
    'includedInOverallTotal',
    'usdValue',
    'valuation',
  ]);
  const observationId = uuid(record.observationId);
  const walletId = uuid(record.walletId);
  const networkId = oneOf(record.networkId, MAINNET_NETWORK_IDS);
  const assetRecord = exactDataRecord(record.asset, [
    'registryEnvironment',
    'registryVersion',
    'registryFingerprintSha256',
    'stablecoin',
    'networkId',
    'identity',
    'decimals',
  ]);
  if (assetRecord.registryEnvironment !== 'MAINNET' || assetRecord.registryVersion !== 1) {
    return fail();
  }
  if (
    typeof assetRecord.registryFingerprintSha256 !== 'string' ||
    !REGISTRY_FINGERPRINT.test(assetRecord.registryFingerprintSha256) ||
    assetRecord.registryFingerprintSha256 !== MAINNET_V1_REGISTRY_FINGERPRINT
  ) {
    return fail();
  }
  const registryFingerprint = assetRecord.registryFingerprintSha256;
  const stablecoin = oneOf(assetRecord.stablecoin, STABLECOINS);
  if (assetRecord.networkId !== networkId) return fail();
  const registeredIdentities: Partial<Record<StablecoinSymbol, string>> =
    PORTFOLIO_ASSET_IDENTITIES[networkId];
  if (assetRecord.identity !== registeredIdentities[stablecoin]) return fail();
  const decimals = boundedInteger(assetRecord.decimals, 0, 36);
  if (decimals !== 6) return fail();

  const balanceRecord = exactDataRecord(record.balance, ['atomic', 'decimals', 'decimal']);
  const atomic = canonicalInteger(balanceRecord.atomic, MAX_ATOMIC_DIGITS);
  if (
    balanceRecord.decimals !== decimals ||
    balanceRecord.decimal !== formatFixedDecimal(atomic, decimals)
  ) {
    return fail();
  }
  const balanceObservedAt = canonicalTimestamp(record.balanceObservedAt);
  if (balanceObservedAt > asOf) return fail();
  const balanceFreshnessClass = oneOf(record.balanceFreshnessClass, ['CURRENT', 'STALE'] as const);
  const freshnessClass = oneOf(record.freshnessClass, FRESHNESS_VALUES);
  const usdValue = nullableExactUsd(record.usdValue);
  const valuation = parseValuation(record.valuation, asOf);
  const included = record.includedInOverallTotal;
  if (typeof included !== 'boolean') return fail();
  const expectedFreshness: ReportingFreshness =
    valuation.availability === 'UNAVAILABLE'
      ? 'UNAVAILABLE'
      : balanceFreshnessClass === 'STALE' || valuation.freshnessClass === 'STALE'
        ? 'STALE'
        : 'CURRENT';
  if (
    included !== (valuation.availability === 'AVAILABLE') ||
    included !== (usdValue !== null) ||
    freshnessClass !== expectedFreshness
  ) {
    return fail();
  }
  return {
    observationId,
    walletId,
    networkId,
    stablecoin,
    assetIdentity: assetRecord.identity as string,
    balanceObservedAt,
    registryFingerprint,
    freshnessClass,
    usdValue,
  };
}

function parseExcludedSource(value: unknown, asOf: string): ParsedExcludedSource {
  const record = exactDataRecord(value, [
    'observationId',
    'walletId',
    'networkId',
    'assetIdentity',
    'amountAtomic',
    'balanceObservedAt',
    'balanceFreshnessClass',
    'reason',
    'includedInOverallTotal',
  ]);
  const observationId = uuid(record.observationId);
  const walletId = uuid(record.walletId);
  const networkId = oneOf(record.networkId, MAINNET_NETWORK_IDS);
  const assetIdentity = safeOpaqueString(record.assetIdentity, 64);
  canonicalInteger(record.amountAtomic, MAX_ATOMIC_DIGITS);
  const balanceObservedAt = canonicalTimestamp(record.balanceObservedAt);
  if (
    balanceObservedAt > asOf ||
    !['CURRENT', 'STALE'].includes(record.balanceFreshnessClass as string) ||
    record.reason !== 'UNSUPPORTED_ASSET' ||
    record.includedInOverallTotal !== false
  ) {
    return fail();
  }
  return {
    observationId,
    walletId,
    networkId,
    assetIdentity,
    balanceObservedAt,
    freshnessClass: 'UNAVAILABLE',
    usdValue: null,
  };
}

function worstFreshness(contributions: readonly Contribution[]): ReportingFreshness {
  if (contributions.some(({ freshnessClass }) => freshnessClass === 'UNAVAILABLE')) {
    return 'UNAVAILABLE';
  }
  if (contributions.some(({ freshnessClass }) => freshnessClass === 'STALE')) return 'STALE';
  return 'CURRENT';
}

function derivedAggregate(contributions: readonly Contribution[]): ReportingAggregate {
  if (contributions.length === 0) {
    return Object.freeze({
      usdValue: Object.freeze({
        currency: 'USD',
        mantissa: '0',
        scale: 18,
        decimal: '0.000000000000000000',
      }),
      freshnessClass: 'CURRENT',
      completeness: 'COMPLETE',
      sourceCount: 0,
      includedSourceCount: 0,
    });
  }
  const included = contributions.filter(
    (contribution): contribution is Contribution & { readonly usdValue: ReportingExactUsdAmount } =>
      contribution.usdValue !== null,
  );
  const sum = included.reduce(
    (total, contribution) => total + BigInt(contribution.usdValue.mantissa),
    0n,
  );
  const mantissa = sum.toString();
  if (mantissa.length > MAX_USD_DIGITS) return fail();
  return Object.freeze({
    usdValue:
      included.length === 0
        ? null
        : Object.freeze({
            currency: 'USD',
            mantissa,
            scale: 18,
            decimal: formatFixedDecimal(mantissa, 18),
          }),
    freshnessClass: worstFreshness(contributions),
    completeness:
      included.length === 0
        ? 'UNAVAILABLE'
        : included.length === contributions.length
          ? 'COMPLETE'
          : 'PARTIAL',
    sourceCount: contributions.length,
    includedSourceCount: included.length,
  });
}

function sameAggregate(left: ReportingAggregate, right: ReportingAggregate): boolean {
  return (
    left.usdValue?.mantissa === right.usdValue?.mantissa &&
    (left.usdValue === null) === (right.usdValue === null) &&
    left.freshnessClass === right.freshnessClass &&
    left.completeness === right.completeness &&
    left.sourceCount === right.sourceCount &&
    left.includedSourceCount === right.includedSourceCount
  );
}

function groupBy<Value extends Contribution, Key extends string>(
  contributions: readonly Value[],
  keyFor: (contribution: Value) => Key,
): ReadonlyMap<Key, readonly Contribution[]> {
  const groups = new Map<Key, Contribution[]>();
  for (const contribution of contributions) {
    const key = keyFor(contribution);
    groups.set(key, [...(groups.get(key) ?? []), contribution]);
  }
  return groups;
}

function parseKeyedAggregate(
  value: unknown,
  key: 'walletId' | 'networkId' | 'stablecoin',
): { readonly key: string; readonly aggregate: ReportingAggregate } {
  const record = exactDataRecord(value, [
    key,
    'usdValue',
    'freshnessClass',
    'completeness',
    'sourceCount',
    'includedSourceCount',
  ]);
  const parsedKey =
    key === 'walletId'
      ? uuid(record[key])
      : key === 'networkId'
        ? oneOf(record[key], MAINNET_NETWORK_IDS)
        : oneOf(record[key], STABLECOINS);
  return { key: parsedKey, aggregate: parseAggregateRecord(record) };
}

function reconcileKeyedTotals(
  rawTotals: readonly unknown[],
  key: 'walletId' | 'networkId' | 'stablecoin',
  expected: ReadonlyMap<string, readonly Contribution[]>,
): ReadonlyMap<string, ReportingAggregate> {
  const parsed = new Map<string, ReportingAggregate>();
  for (const rawTotal of rawTotals) {
    const total = parseKeyedAggregate(rawTotal, key);
    if (parsed.has(total.key)) return fail();
    parsed.set(total.key, total.aggregate);
  }
  if (parsed.size !== expected.size) return fail();
  for (const [groupKey, contributions] of expected) {
    const total = parsed.get(groupKey);
    if (total === undefined || !sameAggregate(total, derivedAggregate(contributions)))
      return fail();
  }
  return parsed;
}

function parseResponse(value: unknown): ReportingPortfolioSnapshot {
  const record = exactDataRecord(value, [
    'schemaVersion',
    'asOf',
    'balanceSnapshot',
    'oldestBalanceObservedAt',
    'overallTotal',
    'walletTotals',
    'chainTotals',
    'assetTotals',
    'sources',
    'excludedSources',
    'reportingUse',
    'mayIncreaseBuyingPower',
    'mayAuthorizeFinancialUse',
  ]);
  if (
    record.schemaVersion !== 1 ||
    record.reportingUse !== 'CONSERVATIVE_REPORTING_ONLY' ||
    record.mayIncreaseBuyingPower !== false ||
    record.mayAuthorizeFinancialUse !== false
  ) {
    return fail();
  }
  const asOf = canonicalTimestamp(record.asOf);
  const snapshotRecord = exactDataRecord(record.balanceSnapshot, [
    'snapshotId',
    'capturedAt',
    'freshnessClass',
  ]);
  if (
    typeof snapshotRecord.snapshotId !== 'string' ||
    !SAFE_SNAPSHOT_ID.test(snapshotRecord.snapshotId)
  ) {
    return fail();
  }
  const capturedAt = canonicalTimestamp(snapshotRecord.capturedAt);
  const snapshotFreshness = oneOf(snapshotRecord.freshnessClass, ['CURRENT', 'STALE'] as const);
  if (capturedAt > asOf) return fail();
  const oldestBalanceObservedAt =
    record.oldestBalanceObservedAt === null
      ? null
      : canonicalTimestamp(record.oldestBalanceObservedAt);
  if (oldestBalanceObservedAt !== null && oldestBalanceObservedAt > asOf) return fail();

  const sources = boundedArray(record.sources, MAX_SOURCES).map((source) =>
    parseSource(source, asOf),
  );
  const excludedSources = boundedArray(record.excludedSources, MAX_SOURCES).map((source) =>
    parseExcludedSource(source, asOf),
  );
  const allSources = [...sources, ...excludedSources];
  if (allSources.length > MAX_SOURCES) return fail();
  if (
    allSources.some(({ balanceObservedAt }) => balanceObservedAt > capturedAt) ||
    (snapshotFreshness === 'STALE' &&
      sources.some(({ freshnessClass }) => freshnessClass === 'CURRENT')) ||
    new Set(allSources.map(({ observationId }) => observationId)).size !== allSources.length ||
    new Set(
      allSources.map(
        ({ walletId, networkId, assetIdentity }) =>
          `${walletId}\u0000${networkId}\u0000${assetIdentity}`,
      ),
    ).size !== allSources.length ||
    new Set(sources.map(({ registryFingerprint }) => registryFingerprint)).size > 1
  ) {
    return fail();
  }
  const expectedOldest =
    allSources.map(({ balanceObservedAt }) => balanceObservedAt).sort()[0] ?? null;
  if (oldestBalanceObservedAt !== expectedOldest) return fail();

  const overallTotal = parseAggregate(record.overallTotal);
  const derivedOverall = derivedAggregate(allSources);
  const expectedOverall =
    snapshotFreshness === 'STALE' && derivedOverall.freshnessClass === 'CURRENT'
      ? Object.freeze({ ...derivedOverall, freshnessClass: 'STALE' as const })
      : derivedOverall;
  if (!sameAggregate(overallTotal, expectedOverall)) return fail();

  const walletGroups = groupBy(allSources, (source) => source.walletId);
  const chainGroups = groupBy(allSources, (source) => source.networkId);
  const assetGroups = groupBy(sources, (source) => source.stablecoin);
  reconcileKeyedTotals(boundedArray(record.walletTotals, MAX_SOURCES), 'walletId', walletGroups);
  const chainTotals = reconcileKeyedTotals(
    boundedArray(record.chainTotals, MAX_SOURCES),
    'networkId',
    chainGroups,
  );
  const assetTotals = reconcileKeyedTotals(
    boundedArray(record.assetTotals, STABLECOINS.length),
    'stablecoin',
    assetGroups,
  );

  return Object.freeze({
    schemaVersion: 1,
    asOf,
    balanceSnapshot: Object.freeze({
      capturedAt,
      freshnessClass: snapshotFreshness,
    }),
    oldestBalanceObservedAt,
    overallTotal,
    chainTotals: Object.freeze(
      [...chainTotals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([networkId, aggregate]) =>
          Object.freeze({
            networkId: oneOf(networkId, MAINNET_NETWORK_IDS),
            ...aggregate,
          }),
        ),
    ),
    assetTotals: Object.freeze(
      [...assetTotals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([stablecoin, aggregate]) =>
          Object.freeze({ stablecoin: oneOf(stablecoin, STABLECOINS), ...aggregate }),
        ),
    ),
    excludedSourceCount: excludedSources.length,
    reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
    mayIncreaseBuyingPower: false,
    mayAuthorizeFinancialUse: false,
  });
}

export function parseReportingPortfolioResponse(value: unknown): ReportingPortfolioSnapshot {
  try {
    return parseResponse(value);
  } catch {
    throw new ReportingPortfolioResponseError();
  }
}

export function reportingNetworkName(networkId: ProductionPortfolioNetworkId): string {
  return PORTFOLIO_NETWORKS[networkId].name;
}
