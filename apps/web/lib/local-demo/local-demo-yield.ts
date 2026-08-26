const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const CANONICAL_USD_MINOR = /^(?:0|[1-9][0-9]{0,17})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export const LOCAL_DEMO_YIELD_CATALOG_PATH = '/api/v1/local-demo/yield-catalog' as const;

export const LOCAL_DEMO_ALLOCATION_PRESETS = Object.freeze([
  Object.freeze({
    id: 'MORE_LIQUID',
    label: 'More liquid',
    description: 'Keep 60% readily available and divide the remainder across snapshot markets.',
    liquidReserveBasisPoints: 6_000,
  }),
  Object.freeze({
    id: 'BALANCED',
    label: 'Balanced blend',
    description: 'Keep 30% readily available and divide the remainder across snapshot markets.',
    liquidReserveBasisPoints: 3_000,
  }),
  Object.freeze({
    id: 'MORE_YIELD',
    label: 'More yield',
    description: 'Keep 15% readily available and divide the remainder across snapshot markets.',
    liquidReserveBasisPoints: 1_500,
  }),
] as const);

export const LOCAL_DEMO_YIELD_ASSET_SYMBOLS = Object.freeze(['USDC', 'USDT'] as const);
export const LOCAL_DEMO_YIELD_PROVIDER_IDS = Object.freeze(['MORPHO'] as const);
export const LOCAL_DEMO_YIELD_NETWORK_IDS = Object.freeze(['eip155:1', 'eip155:8453'] as const);
export const LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS = 9_900 as const;

export type LocalDemoAllocationPresetId = (typeof LOCAL_DEMO_ALLOCATION_PRESETS)[number]['id'];
export type LocalDemoYieldAssetSymbol = (typeof LOCAL_DEMO_YIELD_ASSET_SYMBOLS)[number];
export type LocalDemoYieldProviderId = (typeof LOCAL_DEMO_YIELD_PROVIDER_IDS)[number];
export type LocalDemoYieldNetworkId = (typeof LOCAL_DEMO_YIELD_NETWORK_IDS)[number];
export type LocalDemoYieldFreshness = 'CURRENT' | 'STALE';
export type LocalDemoAllocationDeductionCode =
  'LIQUIDITY' | 'CONVERSION' | 'SLIPPAGE' | 'NETWORK' | 'ROUTING';

export interface LocalDemoCustomYieldFilters {
  readonly assetSymbols: readonly LocalDemoYieldAssetSymbol[];
  readonly providerIds: readonly LocalDemoYieldProviderId[];
  readonly networkIds: readonly LocalDemoYieldNetworkId[];
  readonly minimumApyBasisPoints: number;
  readonly minimumTvlUsdMinor: string;
  readonly minimumExitLiquidityUsdMinor: string;
  readonly maximumUtilizationBasisPoints: number;
}

export type LocalDemoAllocationSelectionInput =
  | Readonly<{
      kind: 'PRESET';
      presetId: LocalDemoAllocationPresetId;
    }>
  | Readonly<{
      kind: 'CUSTOM';
      liquidReserveBasisPoints: number;
      filters: LocalDemoCustomYieldFilters;
    }>;

export interface LocalDemoYieldRewardApr {
  readonly assetSymbol: string;
  readonly rateDecimal: string;
  readonly basisPoints: number;
}

export interface LocalDemoYieldOpportunity {
  readonly opportunityId: string;
  readonly provider: Readonly<{ id: 'MORPHO'; name: 'Morpho' }>;
  readonly protocol: Readonly<{ id: 'MORPHO_BLUE'; name: 'Morpho Blue'; marketId: string }>;
  readonly asset: Readonly<{
    symbol: LocalDemoYieldAssetSymbol;
    contract: string;
    decimals: number;
  }>;
  readonly network: Readonly<{ id: LocalDemoYieldNetworkId; name: string }>;
  readonly apy: Readonly<{
    baseRateDecimal: string;
    baseBasisPoints: number;
    observedAt: string;
    rewardAprs: readonly LocalDemoYieldRewardApr[];
    providerFee: Readonly<{
      status: 'REPORTED';
      rateDecimal: string;
      basisPoints: number;
    }>;
  }>;
  readonly tvl: Readonly<{
    sourceAmountUsdDecimal: string;
    amountUsdMinor: string;
    observedAt: string;
  }>;
  readonly exitLiquidity: Readonly<{
    sourceAmountUsdDecimal: string;
    amountUsdMinor: string;
    observedAt: string;
    interpretation: 'AVAILABLE_TO_BORROW_PROXY';
  }>;
  readonly utilization: Readonly<{
    rateDecimal: string;
    basisPoints: number;
    observedAt: string;
  }>;
  readonly availability: Readonly<{
    status: 'LISTED_ONLY';
    providerListed: true;
    depositsEnabled: 'NOT_VERIFIED';
    withdrawalsEnabled: 'NOT_VERIFIED';
    asOf: string;
  }>;
  readonly provenance: Readonly<{
    sourceKind: 'API';
    sourceId: string;
    sourceReference: string;
    sourceObservedAt: string;
    retrievedAt: string;
    payloadSha256: string;
    normalizerId: string;
    normalizerVersion: string;
    attributes: readonly Readonly<{ key: string; value: string }>[];
  }>;
}

export interface LocalDemoYieldCatalog {
  readonly use: 'LOCAL_DEMO_SNAPSHOT_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly riskClassificationAvailable: false;
  readonly snapshot: Readonly<{
    id: string;
    provider: 'MORPHO_PUBLIC_API';
    capturedAt: string;
    staleAfter: string;
    freshness: LocalDemoYieldFreshness;
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE';
    riskClassification: 'NOT_ASSESSED';
  }>;
  readonly opportunities: readonly LocalDemoYieldOpportunity[];
}

export interface LocalDemoAllocationPreview {
  readonly use: 'LOCAL_DEMO_ESTIMATE_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly selection: Readonly<{
    kind: 'PRESET' | 'CUSTOM';
    presetId: LocalDemoAllocationPresetId | null;
    label: string;
    description: string;
    liquidReserveBasisPoints: number;
    filters: LocalDemoCustomYieldFilters | null;
  }>;
  readonly catalog: Readonly<{
    snapshotId: string;
    capturedAt: string;
    staleAfter: string;
    freshness: LocalDemoYieldFreshness;
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE';
    riskClassificationAvailable: false;
    riskClassification: 'NOT_ASSESSED';
    matchedOpportunityCount: number;
    selectedOpportunityCount: number;
  }>;
  readonly grossCapitalUsdMinor: string;
  readonly allocations: readonly Readonly<{
    bucket: 'LIQUID_RESERVE' | 'YIELD_OPPORTUNITY';
    allocationId: string;
    label: string;
    percentageBasisPoints: number;
    baseApyBasisPoints: number;
    baseApyRateDecimal: string;
    amountUsdMinor: string;
    opportunity: LocalDemoYieldOpportunity | null;
  }>[];
  readonly deductions: readonly Readonly<{
    code: LocalDemoAllocationDeductionCode;
    amountUsdMinor: string;
  }>[];
  readonly feeEstimateSource: 'LOCAL_DEMO_ACTION_COST_ASSUMPTION';
  readonly totalFeesUsdMinor: string;
  readonly netPlannedCapitalUsdMinor: string;
  readonly yieldProjection: Readonly<{
    source: 'MORPHO_PUBLIC_API_SNAPSHOT';
    calculationMethod: 'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL';
    effectiveApyBasisPoints: number;
    projectedAnnualYieldUsdMinor: string;
    projectedAnnualNetGrowthUsdMinor: string;
    breakEven: Readonly<{
      status: 'AVAILABLE' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
      firstNetPositiveDay: number | null;
    }>;
  }>;
  readonly asOf: string;
}

const DEDUCTION_CODES = Object.freeze([
  'LIQUIDITY',
  'CONVERSION',
  'SLIPPAGE',
  'NETWORK',
  'ROUTING',
] as const);
const DEDUCTION_WEIGHTS = Object.freeze({
  LIQUIDITY: 5_000,
  CONVERSION: 1_000,
  SLIPPAGE: 1_000,
  NETWORK: 1_000,
  ROUTING: 2_000,
} as const);

function invalid(): never {
  throw new TypeError('Invalid local demo yield response');
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return invalid();
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return invalid();
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid local demo yield response') {
      throw error;
    }
    return invalid();
  }
}

function exactArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return invalid();
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < minimum ||
      length > maximum
    ) {
      return invalid();
    }
    const expected = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expected.size ||
      keys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
      return invalid();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return invalid();
      }
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid local demo yield response') {
      throw error;
    }
    return invalid();
  }
}

function safeText(value: unknown, maximum = 512): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    FORBIDDEN_TEXT.test(value)
  ) {
    return invalid();
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return invalid();
  return value;
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || value.length > 96 || !CANONICAL_DECIMAL.test(value)) {
    return invalid();
  }
  return value;
}

function usdMinor(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_USD_MINOR.test(value)) return invalid();
  return value;
}

function boundedInteger(value: unknown, minimum = 0, maximum = 10_000): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid();
  }
  return value;
}

function basisPointsFromRatio(value: string): number {
  const [whole = '', fraction = ''] = value.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`) * 10_000n;
  const result = numerator / denominator;
  if (result > 10_000n) return invalid();
  return Number(result);
}

export function compareLocalDemoRatioToBasisPoints(value: string, basisPoints: number): number {
  const [whole = '', fraction = ''] = value.split('.');
  const left = BigInt(`${whole}${fraction}`) * 10_000n;
  const right = BigInt(basisPoints) * 10n ** BigInt(fraction.length);
  return left === right ? 0 : left > right ? 1 : -1;
}

export function compareLocalDemoDecimals(left: string, right: string): number {
  const [leftWhole = '', leftFraction = ''] = left.split('.');
  const [rightWhole = '', rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue =
    BigInt(`${leftWhole}${leftFraction}`) * 10n ** BigInt(scale - leftFraction.length);
  const rightValue =
    BigInt(`${rightWhole}${rightFraction}`) * 10n ** BigInt(scale - rightFraction.length);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function opportunityWasCapturedBy(
  opportunity: LocalDemoYieldOpportunity,
  capturedAt: string,
): boolean {
  const boundary = Date.parse(capturedAt);
  return [
    opportunity.apy.observedAt,
    opportunity.tvl.observedAt,
    opportunity.exitLiquidity.observedAt,
    opportunity.utilization.observedAt,
    opportunity.availability.asOf,
    opportunity.provenance.sourceObservedAt,
    opportunity.provenance.retrievedAt,
  ].every((value) => Date.parse(value) <= boundary);
}

function minorFromUsdDecimal(value: string): string {
  const [whole = '', fraction = ''] = value.split('.');
  const cents = `${fraction}00`.slice(0, 2);
  const result = BigInt(whole) * 100n + BigInt(cents);
  if (result > 999_999_999_999_999_999n) return invalid();
  return result.toString();
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) return invalid();
  return value as Values[number];
}

function parseRewardApr(value: unknown): LocalDemoYieldRewardApr {
  const record = exactRecord(value, ['assetSymbol', 'rateDecimal', 'basisPoints']);
  const rateDecimal = decimal(record.rateDecimal);
  const basisPoints = boundedInteger(record.basisPoints);
  if (basisPoints !== basisPointsFromRatio(rateDecimal)) return invalid();
  return Object.freeze({
    assetSymbol: safeText(record.assetSymbol, 32),
    rateDecimal,
    basisPoints,
  });
}

function parseOpportunity(value: unknown): LocalDemoYieldOpportunity {
  const record = exactRecord(value, [
    'opportunityId',
    'provider',
    'protocol',
    'asset',
    'network',
    'apy',
    'tvl',
    'exitLiquidity',
    'utilization',
    'availability',
    'provenance',
  ]);
  const provider = exactRecord(record.provider, ['id', 'name']);
  if (provider.id !== 'MORPHO' || provider.name !== 'Morpho') return invalid();
  const protocol = exactRecord(record.protocol, ['id', 'name', 'marketId']);
  if (protocol.id !== 'MORPHO_BLUE' || protocol.name !== 'Morpho Blue') return invalid();
  const marketId = safeText(protocol.marketId, 192);
  const asset = exactRecord(record.asset, ['symbol', 'contract', 'decimals']);
  const symbol = enumValue(asset.symbol, LOCAL_DEMO_YIELD_ASSET_SYMBOLS);
  const contract = safeText(asset.contract, 192);
  if (asset.decimals !== 6) return invalid();
  const network = exactRecord(record.network, ['id', 'name']);
  const networkId = enumValue(network.id, LOCAL_DEMO_YIELD_NETWORK_IDS);
  const networkName = networkId === 'eip155:1' ? 'Ethereum' : 'Base';
  if (network.name !== networkName) return invalid();

  const apy = exactRecord(record.apy, [
    'baseRateDecimal',
    'baseBasisPoints',
    'observedAt',
    'rewardAprs',
    'providerFee',
  ]);
  const baseRateDecimal = decimal(apy.baseRateDecimal);
  const baseBasisPoints = boundedInteger(apy.baseBasisPoints);
  if (baseBasisPoints !== basisPointsFromRatio(baseRateDecimal)) return invalid();
  const observedAt = timestamp(apy.observedAt);
  const rewardAprs = Object.freeze(exactArray(apy.rewardAprs, 0, 1).map(parseRewardApr));
  const providerFee = exactRecord(apy.providerFee, ['status', 'rateDecimal', 'basisPoints']);
  if (providerFee.status !== 'REPORTED') return invalid();
  const providerFeeRateDecimal = decimal(providerFee.rateDecimal);
  const providerFeeBasisPoints = boundedInteger(providerFee.basisPoints);
  if (providerFeeBasisPoints !== basisPointsFromRatio(providerFeeRateDecimal)) return invalid();

  function amountObservation(candidate: unknown, exitLiquidityProxy = false) {
    const amount = exactRecord(candidate, [
      'sourceAmountUsdDecimal',
      'amountUsdMinor',
      'observedAt',
      ...(exitLiquidityProxy ? ['interpretation'] : []),
    ]);
    if (exitLiquidityProxy && amount.interpretation !== 'AVAILABLE_TO_BORROW_PROXY') {
      return invalid();
    }
    const sourceAmountUsdDecimal = decimal(amount.sourceAmountUsdDecimal);
    const amountUsdMinor = usdMinor(amount.amountUsdMinor);
    if (amountUsdMinor !== minorFromUsdDecimal(sourceAmountUsdDecimal)) return invalid();
    const observation = {
      sourceAmountUsdDecimal,
      amountUsdMinor,
      observedAt: timestamp(amount.observedAt),
    };
    return exitLiquidityProxy
      ? Object.freeze({ ...observation, interpretation: 'AVAILABLE_TO_BORROW_PROXY' as const })
      : Object.freeze(observation);
  }

  const utilization = exactRecord(record.utilization, ['rateDecimal', 'basisPoints', 'observedAt']);
  const utilizationRateDecimal = decimal(utilization.rateDecimal);
  const utilizationBasisPoints = boundedInteger(utilization.basisPoints);
  if (utilizationBasisPoints !== basisPointsFromRatio(utilizationRateDecimal)) return invalid();
  const availability = exactRecord(record.availability, [
    'status',
    'providerListed',
    'depositsEnabled',
    'withdrawalsEnabled',
    'asOf',
  ]);
  if (
    availability.status !== 'LISTED_ONLY' ||
    availability.providerListed !== true ||
    availability.depositsEnabled !== 'NOT_VERIFIED' ||
    availability.withdrawalsEnabled !== 'NOT_VERIFIED'
  ) {
    return invalid();
  }
  const provenance = exactRecord(record.provenance, [
    'sourceKind',
    'sourceId',
    'sourceReference',
    'sourceObservedAt',
    'retrievedAt',
    'payloadSha256',
    'normalizerId',
    'normalizerVersion',
    'attributes',
  ]);
  if (provenance.sourceKind !== 'API') return invalid();
  const payloadSha256 = safeText(provenance.payloadSha256, 64);
  if (!SHA256.test(payloadSha256)) return invalid();
  const attributes = Object.freeze(
    exactArray(provenance.attributes, 6, 6).map((entry) => {
      const attribute = exactRecord(entry, ['key', 'value']);
      return Object.freeze({
        key: safeText(attribute.key, 192),
        value: safeText(attribute.value, 1_024),
      });
    }),
  );
  if (new Set(attributes.map(({ key }) => key)).size !== attributes.length) return invalid();
  if (
    provenance.sourceReference !== 'https://api.morpho.org/graphql' ||
    provenance.normalizerId !== 'morpho-local-demo-snapshot' ||
    provenance.normalizerVersion !== '1.0.0' ||
    !attributes.some(
      ({ key, value }) => key === 'snapshot.risk_classification' && value === 'NOT_ASSESSED',
    ) ||
    !attributes.some(
      ({ key, value }) => key === 'snapshot.raw_response_retained' && value === 'false',
    )
  ) {
    return invalid();
  }

  return Object.freeze({
    opportunityId: safeText(record.opportunityId, 192),
    provider: Object.freeze({ id: 'MORPHO' as const, name: 'Morpho' as const }),
    protocol: Object.freeze({
      id: 'MORPHO_BLUE' as const,
      name: 'Morpho Blue' as const,
      marketId,
    }),
    asset: Object.freeze({ symbol, contract, decimals: 6 }),
    network: Object.freeze({ id: networkId, name: networkName }),
    apy: Object.freeze({
      baseRateDecimal,
      baseBasisPoints,
      observedAt,
      rewardAprs,
      providerFee: Object.freeze({
        status: 'REPORTED' as const,
        rateDecimal: providerFeeRateDecimal,
        basisPoints: providerFeeBasisPoints,
      }),
    }),
    tvl: amountObservation(record.tvl),
    exitLiquidity: amountObservation(
      record.exitLiquidity,
      true,
    ) as LocalDemoYieldOpportunity['exitLiquidity'],
    utilization: Object.freeze({
      rateDecimal: utilizationRateDecimal,
      basisPoints: utilizationBasisPoints,
      observedAt: timestamp(utilization.observedAt),
    }),
    availability: Object.freeze({
      status: 'LISTED_ONLY' as const,
      providerListed: true as const,
      depositsEnabled: 'NOT_VERIFIED' as const,
      withdrawalsEnabled: 'NOT_VERIFIED' as const,
      asOf: timestamp(availability.asOf),
    }),
    provenance: Object.freeze({
      sourceKind: 'API' as const,
      sourceId: safeText(provenance.sourceId, 192),
      sourceReference: safeText(provenance.sourceReference, 1_024),
      sourceObservedAt: timestamp(provenance.sourceObservedAt),
      retrievedAt: timestamp(provenance.retrievedAt),
      payloadSha256,
      normalizerId: safeText(provenance.normalizerId, 192),
      normalizerVersion: safeText(provenance.normalizerVersion, 64),
      attributes,
    }),
  });
}

export function parseLocalDemoYieldCatalog(value: unknown): LocalDemoYieldCatalog {
  const record = exactRecord(value, [
    'use',
    'mayAuthorizeFinancialAction',
    'riskClassificationAvailable',
    'snapshot',
    'opportunities',
  ]);
  if (
    record.use !== 'LOCAL_DEMO_SNAPSHOT_ONLY' ||
    record.mayAuthorizeFinancialAction !== false ||
    record.riskClassificationAvailable !== false
  ) {
    return invalid();
  }
  const snapshot = exactRecord(record.snapshot, [
    'id',
    'provider',
    'capturedAt',
    'staleAfter',
    'freshness',
    'staleBehavior',
    'riskClassification',
  ]);
  if (
    snapshot.provider !== 'MORPHO_PUBLIC_API' ||
    snapshot.staleBehavior !== 'LABEL_STALE_KEEP_NON_EXECUTABLE' ||
    snapshot.riskClassification !== 'NOT_ASSESSED'
  ) {
    return invalid();
  }
  const capturedAt = timestamp(snapshot.capturedAt);
  const staleAfter = timestamp(snapshot.staleAfter);
  if (Date.parse(staleAfter) <= Date.parse(capturedAt)) return invalid();
  const opportunities = Object.freeze(exactArray(record.opportunities, 1, 5).map(parseOpportunity));
  if (
    new Set(opportunities.map(({ opportunityId }) => opportunityId)).size !== opportunities.length
  ) {
    return invalid();
  }
  if (opportunities.some((opportunity) => !opportunityWasCapturedBy(opportunity, capturedAt))) {
    return invalid();
  }
  return Object.freeze({
    use: 'LOCAL_DEMO_SNAPSHOT_ONLY',
    mayAuthorizeFinancialAction: false,
    riskClassificationAvailable: false,
    snapshot: Object.freeze({
      id: safeText(snapshot.id, 192),
      provider: 'MORPHO_PUBLIC_API',
      capturedAt,
      staleAfter,
      freshness: enumValue(snapshot.freshness, ['CURRENT', 'STALE'] as const),
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      riskClassification: 'NOT_ASSESSED',
    }),
    opportunities,
  });
}

function parseStringSet<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
): readonly Values[number][] {
  const parsed = exactArray(value, 1, allowed.length).map((entry) => enumValue(entry, allowed));
  if (new Set(parsed).size !== parsed.length) return invalid();
  return Object.freeze(parsed);
}

export function parseLocalDemoCustomYieldFilters(value: unknown): LocalDemoCustomYieldFilters {
  const record = exactRecord(value, [
    'assetSymbols',
    'providerIds',
    'networkIds',
    'minimumApyBasisPoints',
    'minimumTvlUsdMinor',
    'minimumExitLiquidityUsdMinor',
    'maximumUtilizationBasisPoints',
  ]);
  return Object.freeze({
    assetSymbols: parseStringSet(record.assetSymbols, LOCAL_DEMO_YIELD_ASSET_SYMBOLS),
    providerIds: parseStringSet(record.providerIds, LOCAL_DEMO_YIELD_PROVIDER_IDS),
    networkIds: parseStringSet(record.networkIds, LOCAL_DEMO_YIELD_NETWORK_IDS),
    minimumApyBasisPoints: boundedInteger(record.minimumApyBasisPoints),
    minimumTvlUsdMinor: usdMinor(record.minimumTvlUsdMinor),
    minimumExitLiquidityUsdMinor: usdMinor(record.minimumExitLiquidityUsdMinor),
    maximumUtilizationBasisPoints: boundedInteger(record.maximumUtilizationBasisPoints),
  });
}

export function validateLocalDemoAllocationSelection(
  value: LocalDemoAllocationSelectionInput,
): LocalDemoAllocationSelectionInput {
  let kind: unknown;
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return invalid();
    kind = descriptor.value;
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid local demo yield response') {
      throw error;
    }
    return invalid();
  }
  const record = exactRecord(
    value,
    kind === 'PRESET' ? ['kind', 'presetId'] : ['kind', 'liquidReserveBasisPoints', 'filters'],
  );
  if (record.kind === 'PRESET') {
    return Object.freeze({
      kind: 'PRESET',
      presetId: enumValue(
        record.presetId,
        LOCAL_DEMO_ALLOCATION_PRESETS.map(({ id }) => id),
      ),
    });
  }
  if (record.kind !== 'CUSTOM') return invalid();
  return Object.freeze({
    kind: 'CUSTOM',
    liquidReserveBasisPoints: boundedInteger(
      record.liquidReserveBasisPoints,
      0,
      LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
    ),
    filters: parseLocalDemoCustomYieldFilters(record.filters),
  });
}

function distribute(total: bigint, weights: readonly number[]): readonly bigint[] {
  const amounts = weights.map((weight) => (total * BigInt(weight)) / 10_000n);
  const remainders = weights.map((weight, index) => ({
    index,
    value: (total * BigInt(weight)) % 10_000n,
  }));
  let remaining = total - amounts.reduce((sum, amount) => sum + amount, 0n);
  remainders.sort((left, right) =>
    left.value === right.value ? left.index - right.index : left.value > right.value ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (remaining === 0n) break;
    const current = amounts[index];
    if (current === undefined) return invalid();
    amounts[index] = current + 1n;
    remaining -= 1n;
  }
  if (remaining !== 0n) return invalid();
  return Object.freeze(amounts);
}

function divideEvenly(total: number, count: number): readonly number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(count) || count < 1) {
    return invalid();
  }
  const quotient = Math.floor(total / count);
  const remainder = total % count;
  return Object.freeze(
    Array.from({ length: count }, (_, index) => quotient + (index < remainder ? 1 : 0)),
  );
}

export function parseLocalDemoAllocationPreview(value: unknown): LocalDemoAllocationPreview {
  const record = exactRecord(value, [
    'use',
    'mayAuthorizeFinancialAction',
    'selection',
    'catalog',
    'grossCapitalUsdMinor',
    'allocations',
    'deductions',
    'feeEstimateSource',
    'totalFeesUsdMinor',
    'netPlannedCapitalUsdMinor',
    'yieldProjection',
    'asOf',
  ]);
  if (
    record.use !== 'LOCAL_DEMO_ESTIMATE_ONLY' ||
    record.mayAuthorizeFinancialAction !== false ||
    record.feeEstimateSource !== 'LOCAL_DEMO_ACTION_COST_ASSUMPTION'
  ) {
    return invalid();
  }

  const selectionRecord = exactRecord(record.selection, [
    'kind',
    'presetId',
    'label',
    'description',
    'liquidReserveBasisPoints',
    'filters',
  ]);
  const selectionKind = enumValue(selectionRecord.kind, ['PRESET', 'CUSTOM'] as const);
  const liquidReserveBasisPoints = boundedInteger(selectionRecord.liquidReserveBasisPoints);
  let presetId: LocalDemoAllocationPresetId | null = null;
  let filters: LocalDemoCustomYieldFilters | null = null;
  if (selectionKind === 'PRESET') {
    presetId = enumValue(
      selectionRecord.presetId,
      LOCAL_DEMO_ALLOCATION_PRESETS.map(({ id }) => id),
    );
    if (selectionRecord.filters !== null) return invalid();
    const preset = LOCAL_DEMO_ALLOCATION_PRESETS.find(({ id }) => id === presetId);
    if (
      !preset ||
      preset.liquidReserveBasisPoints !== liquidReserveBasisPoints ||
      selectionRecord.label !== preset.label ||
      selectionRecord.description !== preset.description
    ) {
      return invalid();
    }
  } else {
    if (selectionRecord.presetId !== null) return invalid();
    filters = parseLocalDemoCustomYieldFilters(selectionRecord.filters);
    if (
      selectionRecord.label !== 'Custom yield filter' ||
      selectionRecord.description !==
        'Apply asset, provider, network, APY, TVL, liquidity, and utilization constraints.' ||
      liquidReserveBasisPoints > LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS
    ) {
      return invalid();
    }
  }
  const selection = Object.freeze({
    kind: selectionKind,
    presetId,
    label: safeText(selectionRecord.label, 96),
    description: safeText(selectionRecord.description),
    liquidReserveBasisPoints,
    filters,
  });

  const catalogRecord = exactRecord(record.catalog, [
    'snapshotId',
    'capturedAt',
    'staleAfter',
    'freshness',
    'staleBehavior',
    'riskClassificationAvailable',
    'riskClassification',
    'matchedOpportunityCount',
    'selectedOpportunityCount',
  ]);
  if (
    catalogRecord.staleBehavior !== 'LABEL_STALE_KEEP_NON_EXECUTABLE' ||
    catalogRecord.riskClassificationAvailable !== false ||
    catalogRecord.riskClassification !== 'NOT_ASSESSED'
  ) {
    return invalid();
  }
  const catalog = Object.freeze({
    snapshotId: safeText(catalogRecord.snapshotId, 192),
    capturedAt: timestamp(catalogRecord.capturedAt),
    staleAfter: timestamp(catalogRecord.staleAfter),
    freshness: enumValue(catalogRecord.freshness, ['CURRENT', 'STALE'] as const),
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' as const,
    riskClassificationAvailable: false as const,
    riskClassification: 'NOT_ASSESSED' as const,
    matchedOpportunityCount: boundedInteger(catalogRecord.matchedOpportunityCount, 1, 5),
    selectedOpportunityCount: boundedInteger(catalogRecord.selectedOpportunityCount, 1, 3),
  });
  if (
    catalog.selectedOpportunityCount > catalog.matchedOpportunityCount ||
    (catalog.selectedOpportunityCount < 3 &&
      catalog.matchedOpportunityCount !== catalog.selectedOpportunityCount) ||
    Date.parse(catalog.staleAfter) <= Date.parse(catalog.capturedAt)
  ) {
    return invalid();
  }
  const grossCapitalUsdMinor = usdMinor(record.grossCapitalUsdMinor);
  const grossCapital = BigInt(grossCapitalUsdMinor);
  const allocations = Object.freeze(
    exactArray(record.allocations, 2, 4).map((candidate) => {
      const allocation = exactRecord(candidate, [
        'bucket',
        'allocationId',
        'label',
        'percentageBasisPoints',
        'baseApyBasisPoints',
        'baseApyRateDecimal',
        'amountUsdMinor',
        'opportunity',
      ]);
      const bucket = enumValue(allocation.bucket, ['LIQUID_RESERVE', 'YIELD_OPPORTUNITY'] as const);
      const allocationId = safeText(allocation.allocationId, 192);
      const label = safeText(allocation.label, 256);
      const percentageBasisPoints = boundedInteger(allocation.percentageBasisPoints);
      const baseApyBasisPoints = boundedInteger(allocation.baseApyBasisPoints);
      const baseApyRateDecimal = decimal(allocation.baseApyRateDecimal);
      const amountUsdMinor = usdMinor(allocation.amountUsdMinor);
      if (baseApyBasisPoints !== basisPointsFromRatio(baseApyRateDecimal)) return invalid();
      const opportunity =
        allocation.opportunity === null ? null : parseOpportunity(allocation.opportunity);
      if (bucket === 'LIQUID_RESERVE') {
        if (
          allocationId !== 'LIQUID_RESERVE' ||
          label !== 'Liquid reserve' ||
          percentageBasisPoints !== liquidReserveBasisPoints ||
          baseApyBasisPoints !== 0 ||
          baseApyRateDecimal !== '0' ||
          opportunity !== null
        ) {
          return invalid();
        }
      } else if (
        opportunity === null ||
        allocationId !== opportunity.opportunityId ||
        label !==
          `${opportunity.asset.symbol} on ${opportunity.protocol.name} (${opportunity.network.name})` ||
        baseApyBasisPoints !== opportunity.apy.baseBasisPoints ||
        baseApyRateDecimal !== opportunity.apy.baseRateDecimal
      ) {
        return invalid();
      }
      return Object.freeze({
        bucket,
        allocationId,
        label,
        percentageBasisPoints,
        baseApyBasisPoints,
        baseApyRateDecimal,
        amountUsdMinor,
        opportunity,
      });
    }),
  );
  if (
    allocations[0]?.bucket !== 'LIQUID_RESERVE' ||
    allocations.filter(({ bucket }) => bucket === 'LIQUID_RESERVE').length !== 1 ||
    allocations.filter(({ bucket }) => bucket === 'YIELD_OPPORTUNITY').length !==
      catalog.selectedOpportunityCount ||
    new Set(allocations.map(({ allocationId }) => allocationId)).size !== allocations.length ||
    allocations.reduce((sum, allocation) => sum + allocation.percentageBasisPoints, 0) !== 10_000 ||
    allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountUsdMinor), 0n) !==
      grossCapital ||
    allocations.some(
      ({ opportunity }) =>
        opportunity !== null && !opportunityWasCapturedBy(opportunity, catalog.capturedAt),
    )
  ) {
    return invalid();
  }
  const yieldAllocations = allocations.filter(
    (
      allocation,
    ): allocation is (typeof allocations)[number] & {
      opportunity: LocalDemoYieldOpportunity;
    } => allocation.bucket === 'YIELD_OPPORTUNITY',
  );
  if (
    yieldAllocations.some((allocation, index) => {
      const next = yieldAllocations[index + 1];
      if (next === undefined) return false;
      const apyOrder = compareLocalDemoDecimals(
        allocation.baseApyRateDecimal,
        next.baseApyRateDecimal,
      );
      return (
        apyOrder < 0 ||
        (apyOrder === 0 &&
          allocation.opportunity.opportunityId.localeCompare(next.opportunity.opportunityId) > 0)
      );
    })
  ) {
    return invalid();
  }
  if (
    filters !== null &&
    yieldAllocations.some(({ opportunity }) => {
      return (
        !filters.assetSymbols.includes(opportunity.asset.symbol) ||
        !filters.providerIds.includes(opportunity.provider.id) ||
        !filters.networkIds.includes(opportunity.network.id) ||
        compareLocalDemoRatioToBasisPoints(
          opportunity.apy.baseRateDecimal,
          filters.minimumApyBasisPoints,
        ) < 0 ||
        BigInt(opportunity.tvl.amountUsdMinor) < BigInt(filters.minimumTvlUsdMinor) ||
        BigInt(opportunity.exitLiquidity.amountUsdMinor) <
          BigInt(filters.minimumExitLiquidityUsdMinor) ||
        compareLocalDemoRatioToBasisPoints(
          opportunity.utilization.rateDecimal,
          filters.maximumUtilizationBasisPoints,
        ) > 0
      );
    })
  ) {
    return invalid();
  }
  const expectedWeights = Object.freeze([
    liquidReserveBasisPoints,
    ...divideEvenly(10_000 - liquidReserveBasisPoints, catalog.selectedOpportunityCount),
  ]);
  const expectedAllocationAmounts = distribute(grossCapital, expectedWeights);
  if (
    allocations.some(
      (allocation, index) =>
        allocation.percentageBasisPoints !== expectedWeights[index] ||
        BigInt(allocation.amountUsdMinor) !== expectedAllocationAmounts[index],
    )
  ) {
    return invalid();
  }

  const nonReserve = allocations
    .filter(({ bucket }) => bucket === 'YIELD_OPPORTUNITY')
    .reduce((sum, allocation) => sum + BigInt(allocation.amountUsdMinor), 0n);
  const expectedFees = nonReserve / 100n;
  const expectedDeductionAmounts = distribute(
    expectedFees,
    DEDUCTION_CODES.map((code) => DEDUCTION_WEIGHTS[code]),
  );
  const deductions = Object.freeze(
    exactArray(record.deductions, DEDUCTION_CODES.length, DEDUCTION_CODES.length).map(
      (candidate) => {
        const deduction = exactRecord(candidate, ['code', 'amountUsdMinor']);
        const code = enumValue(deduction.code, DEDUCTION_CODES);
        const amountUsdMinor = usdMinor(deduction.amountUsdMinor);
        const expected = expectedDeductionAmounts[DEDUCTION_CODES.indexOf(code)];
        if (expected === undefined || BigInt(amountUsdMinor) !== expected) return invalid();
        return Object.freeze({ code, amountUsdMinor });
      },
    ),
  );
  if (new Set(deductions.map(({ code }) => code)).size !== DEDUCTION_CODES.length) return invalid();
  const totalFeesUsdMinor = usdMinor(record.totalFeesUsdMinor);
  if (
    BigInt(totalFeesUsdMinor) !== expectedFees ||
    deductions.reduce((sum, deduction) => sum + BigInt(deduction.amountUsdMinor), 0n) !==
      expectedFees
  ) {
    return invalid();
  }
  const netPlannedCapitalUsdMinor = usdMinor(record.netPlannedCapitalUsdMinor);
  if (grossCapital - expectedFees !== BigInt(netPlannedCapitalUsdMinor)) return invalid();

  const projectionRecord = exactRecord(record.yieldProjection, [
    'source',
    'calculationMethod',
    'effectiveApyBasisPoints',
    'projectedAnnualYieldUsdMinor',
    'projectedAnnualNetGrowthUsdMinor',
    'breakEven',
  ]);
  if (
    projectionRecord.source !== 'MORPHO_PUBLIC_API_SNAPSHOT' ||
    projectionRecord.calculationMethod !== 'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL'
  ) {
    return invalid();
  }
  const weightedApy =
    allocations.reduce(
      (sum, allocation) =>
        sum + BigInt(allocation.percentageBasisPoints) * BigInt(allocation.baseApyBasisPoints),
      0n,
    ) / 10_000n;
  const effectiveApyBasisPoints = boundedInteger(projectionRecord.effectiveApyBasisPoints);
  if (BigInt(effectiveApyBasisPoints) !== weightedApy) return invalid();
  const netCapital = BigInt(netPlannedCapitalUsdMinor);
  const annualYield = (netCapital * weightedApy) / 10_000n;
  const projectedAnnualYieldUsdMinor = usdMinor(projectionRecord.projectedAnnualYieldUsdMinor);
  if (BigInt(projectedAnnualYieldUsdMinor) !== annualYield || annualYield < expectedFees) {
    return invalid();
  }
  const projectedAnnualNetGrowthUsdMinor = usdMinor(
    projectionRecord.projectedAnnualNetGrowthUsdMinor,
  );
  if (BigInt(projectedAnnualNetGrowthUsdMinor) !== annualYield - expectedFees) return invalid();
  const breakEvenRecord = exactRecord(projectionRecord.breakEven, [
    'status',
    'firstNetPositiveDay',
  ]);
  const dailyDenominator = netCapital * weightedApy;
  let breakEven: LocalDemoAllocationPreview['yieldProjection']['breakEven'];
  if (dailyDenominator > 0n) {
    const numerator = (expectedFees + 1n) * 10_000n * 365n;
    const day = (numerator + dailyDenominator - 1n) / dailyDenominator;
    if (
      day > BigInt(Number.MAX_SAFE_INTEGER) ||
      breakEvenRecord.status !== 'AVAILABLE' ||
      breakEvenRecord.firstNetPositiveDay !== Number(day)
    ) {
      return invalid();
    }
    breakEven = Object.freeze({ status: 'AVAILABLE', firstNetPositiveDay: Number(day) });
  } else if (expectedFees === 0n) {
    if (
      breakEvenRecord.status !== 'NOT_APPLICABLE' ||
      breakEvenRecord.firstNetPositiveDay !== null
    ) {
      return invalid();
    }
    breakEven = Object.freeze({ status: 'NOT_APPLICABLE', firstNetPositiveDay: null });
  } else {
    if (breakEvenRecord.status !== 'UNAVAILABLE' || breakEvenRecord.firstNetPositiveDay !== null) {
      return invalid();
    }
    breakEven = Object.freeze({ status: 'UNAVAILABLE', firstNetPositiveDay: null });
  }

  return Object.freeze({
    use: 'LOCAL_DEMO_ESTIMATE_ONLY',
    mayAuthorizeFinancialAction: false,
    selection,
    catalog,
    grossCapitalUsdMinor,
    allocations,
    deductions,
    feeEstimateSource: 'LOCAL_DEMO_ACTION_COST_ASSUMPTION',
    totalFeesUsdMinor,
    netPlannedCapitalUsdMinor,
    yieldProjection: Object.freeze({
      source: 'MORPHO_PUBLIC_API_SNAPSHOT',
      calculationMethod: 'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL',
      effectiveApyBasisPoints,
      projectedAnnualYieldUsdMinor,
      projectedAnnualNetGrowthUsdMinor,
      breakEven,
    }),
    asOf: timestamp(record.asOf),
  });
}
