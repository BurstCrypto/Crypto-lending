import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
  type SupportedStablecoinAsset,
} from '../../blockchain/domain/supported-asset-registry';
import type { StablecoinValuationReason, StablecoinValuationResult } from '../../valuation';
import type {
  IndexedBalanceCoverageStatus,
  IndexedPortfolioBalanceCoverage,
  IndexedPortfolioBalanceObservation,
} from '../application/ports/portfolio-balance-reader.port';

export const UNIFIED_PORTFOLIO_SCHEMA_VERSION = 1 as const;
export const PORTFOLIO_USD_SCALE = 18 as const;

const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const MAX_AGGREGATE_USD_DIGITS = 100;

export type PortfolioFreshness = 'CURRENT' | 'STALE' | 'UNAVAILABLE';
export type PortfolioCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface ExactUsdAmount {
  readonly currency: 'USD';
  readonly mantissa: string;
  readonly scale: typeof PORTFOLIO_USD_SCALE;
  readonly decimal: string;
}

export interface ExactAssetAmount {
  readonly atomic: string;
  readonly decimals: number;
  readonly decimal: string;
}

export interface PortfolioAssetReference {
  readonly registryEnvironment: 'MAINNET';
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly stablecoin: SupportedStablecoin;
  readonly networkId: string;
  readonly identity: string;
  readonly decimals: number;
}

export interface PortfolioValuationSnapshot {
  readonly priceSnapshotId: string | null;
  readonly policyVersion: 1;
  readonly policyApprovalState: 'PENDING_EXTERNAL_APPROVAL';
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly selection: StablecoinValuationResult['selection'];
  readonly selectedSourceId: StablecoinValuationResult['selectedSourceId'];
  readonly selectedSourceReference: string | null;
  readonly selectedSourceSequence: string | null;
  readonly pricedAt: string | null;
  readonly observedAt: string | null;
  readonly usdRateMantissa: string | null;
  readonly usdRateScale: number | null;
  readonly freshnessClass: StablecoinValuationResult['freshnessClass'];
  readonly confidenceClass: StablecoinValuationResult['confidenceClass'];
  readonly depegClass: StablecoinValuationResult['depegClass'];
  readonly downsideBand: StablecoinValuationResult['downsideBand'];
  readonly sourceAgreement: StablecoinValuationResult['sourceAgreement'];
  readonly reasons: readonly StablecoinValuationReason[];
  readonly reportingUse: StablecoinValuationResult['reportingUse'];
  readonly mayIncreaseBuyingPower: false;
  readonly mayAuthorizeFinancialUse: false;
}

export interface PortfolioSourceBreakdown {
  readonly observationId: string;
  readonly walletId: string;
  readonly networkId: string;
  readonly asset: PortfolioAssetReference;
  readonly balance: ExactAssetAmount;
  readonly balanceObservedAt: string;
  readonly balanceFreshnessClass: 'CURRENT' | 'STALE';
  readonly freshnessClass: PortfolioFreshness;
  readonly includedInOverallTotal: boolean;
  readonly usdValue: ExactUsdAmount | null;
  readonly valuation: PortfolioValuationSnapshot;
}

export interface ExcludedPortfolioSource {
  readonly observationId: string;
  readonly walletId: string;
  readonly networkId: string;
  readonly assetIdentity: string;
  readonly amountAtomic: string;
  readonly balanceObservedAt: string;
  readonly balanceFreshnessClass: 'CURRENT' | 'STALE';
  readonly reason: 'UNSUPPORTED_ASSET';
  readonly includedInOverallTotal: false;
}

export interface PortfolioAggregate {
  readonly usdValue: ExactUsdAmount | null;
  readonly freshnessClass: PortfolioFreshness;
  readonly completeness: PortfolioCompleteness;
  readonly sourceCount: number;
  readonly includedSourceCount: number;
}

export interface PortfolioWalletTotal extends PortfolioAggregate {
  readonly walletId: string;
}

export interface PortfolioChainTotal extends PortfolioAggregate {
  readonly networkId: string;
}

export interface PortfolioAssetTotal extends PortfolioAggregate {
  readonly stablecoin: SupportedStablecoin;
}

export interface PortfolioBalanceCoverageTarget {
  readonly walletId: string;
  readonly networkId: string;
  readonly status: IndexedBalanceCoverageStatus;
}

export interface PortfolioBalanceCoverage {
  readonly status: IndexedBalanceCoverageStatus;
  readonly targets: readonly PortfolioBalanceCoverageTarget[];
}

export interface UnifiedPortfolio {
  readonly schemaVersion: typeof UNIFIED_PORTFOLIO_SCHEMA_VERSION;
  readonly asOf: string;
  readonly balanceSnapshot: Readonly<{
    snapshotId: string;
    capturedAt: string;
    freshnessClass: 'CURRENT' | 'STALE';
  }>;
  readonly balanceCoverage: PortfolioBalanceCoverage;
  readonly oldestBalanceObservedAt: string | null;
  readonly overallTotal: PortfolioAggregate;
  readonly walletTotals: readonly PortfolioWalletTotal[];
  readonly chainTotals: readonly PortfolioChainTotal[];
  readonly assetTotals: readonly PortfolioAssetTotal[];
  readonly sources: readonly PortfolioSourceBreakdown[];
  readonly excludedSources: readonly ExcludedPortfolioSource[];
  readonly reportingUse: 'CONSERVATIVE_REPORTING_ONLY';
  readonly mayIncreaseBuyingPower: false;
  readonly mayAuthorizeFinancialUse: false;
}

export interface ValuedPortfolioBalance {
  readonly observation: IndexedPortfolioBalanceObservation;
  readonly registryAsset: SupportedStablecoinAsset;
  readonly asset: PortfolioAssetReference;
  readonly priceSnapshotId: string | null;
  readonly valuation: StablecoinValuationResult;
}

export interface BuildUnifiedPortfolioRequest {
  readonly asOf: string;
  readonly balanceSnapshotId: string;
  readonly balanceCapturedAt: string;
  readonly balanceSnapshotFreshness: 'CURRENT' | 'STALE';
  readonly balanceCoverage: IndexedPortfolioBalanceCoverage;
  readonly valuedBalances: readonly ValuedPortfolioBalance[];
  readonly excludedBalances: readonly IndexedPortfolioBalanceObservation[];
}

interface Contribution {
  readonly freshnessClass: PortfolioFreshness;
  readonly usdValueMantissa: string | null;
}

export class PortfolioAggregationError extends Error {
  constructor() {
    super('portfolio aggregation failed');
    this.name = 'PortfolioAggregationError';
  }
}

function formatFixedDecimal(mantissa: string, scale: number): string {
  if (
    !CANONICAL_INTEGER.test(mantissa) ||
    !Number.isSafeInteger(scale) ||
    scale < 0 ||
    scale > 36
  ) {
    throw new PortfolioAggregationError();
  }
  if (scale === 0) return mantissa;
  const padded = mantissa.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function exactUsdAmount(mantissa: string): ExactUsdAmount {
  if (!CANONICAL_INTEGER.test(mantissa) || mantissa.length > MAX_AGGREGATE_USD_DIGITS) {
    throw new PortfolioAggregationError();
  }
  return {
    currency: 'USD',
    mantissa,
    scale: PORTFOLIO_USD_SCALE,
    decimal: formatFixedDecimal(mantissa, PORTFOLIO_USD_SCALE),
  };
}

function exactAssetAmount(amountAtomic: string, decimals: number): ExactAssetAmount {
  return {
    atomic: amountAtomic,
    decimals,
    decimal: formatFixedDecimal(amountAtomic, decimals),
  };
}

function lineFreshness(
  observation: IndexedPortfolioBalanceObservation,
  valuation: StablecoinValuationResult,
): PortfolioFreshness {
  if (valuation.availability !== 'AVAILABLE' || valuation.usdValueMantissa === null) {
    return 'UNAVAILABLE';
  }
  return observation.freshnessClass === 'STALE' || valuation.freshnessClass === 'STALE'
    ? 'STALE'
    : valuation.freshnessClass;
}

function sourceBreakdown(value: ValuedPortfolioBalance): PortfolioSourceBreakdown {
  const valuation = value.valuation;
  const included = valuation.availability === 'AVAILABLE' && valuation.usdValueMantissa !== null;
  const usdValue = included ? exactUsdAmount(valuation.usdValueMantissa ?? '0') : null;
  return {
    observationId: value.observation.observationId,
    walletId: value.observation.walletId,
    networkId: value.observation.networkId,
    asset: value.asset,
    balance: exactAssetAmount(value.observation.amountAtomic, value.registryAsset.decimals),
    balanceObservedAt: value.observation.observedAt,
    balanceFreshnessClass: value.observation.freshnessClass,
    freshnessClass: lineFreshness(value.observation, valuation),
    includedInOverallTotal: included,
    usdValue,
    valuation: {
      priceSnapshotId: value.priceSnapshotId,
      policyVersion: valuation.policyVersion,
      policyApprovalState: valuation.policyApprovalState,
      availability: valuation.availability,
      selection: valuation.selection,
      selectedSourceId: valuation.selectedSourceId,
      selectedSourceReference: valuation.selectedSourceReference,
      selectedSourceSequence: valuation.selectedSourceSequence,
      pricedAt: valuation.pricedAt,
      observedAt: valuation.observedAt,
      usdRateMantissa: valuation.usdRateMantissa,
      usdRateScale: valuation.usdRateScale,
      freshnessClass: valuation.freshnessClass,
      confidenceClass: valuation.confidenceClass,
      depegClass: valuation.depegClass,
      downsideBand: valuation.downsideBand,
      sourceAgreement: valuation.sourceAgreement,
      reasons: [...valuation.reasons],
      reportingUse: valuation.reportingUse,
      mayIncreaseBuyingPower: false,
      mayAuthorizeFinancialUse: false,
    },
  };
}

function excludedSource(observation: IndexedPortfolioBalanceObservation): ExcludedPortfolioSource {
  return {
    observationId: observation.observationId,
    walletId: observation.walletId,
    networkId: observation.networkId,
    assetIdentity: observation.assetIdentity,
    amountAtomic: observation.amountAtomic,
    balanceObservedAt: observation.observedAt,
    balanceFreshnessClass: observation.freshnessClass,
    reason: 'UNSUPPORTED_ASSET',
    includedInOverallTotal: false,
  };
}

function worstFreshness(values: readonly PortfolioFreshness[]): PortfolioFreshness {
  if (values.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (values.includes('STALE')) return 'STALE';
  return 'CURRENT';
}

function aggregate(
  contributions: readonly Contribution[],
  coverageStatuses: readonly IndexedBalanceCoverageStatus[] = [],
): PortfolioAggregate {
  const included = contributions.filter(
    (contribution): contribution is Contribution & { readonly usdValueMantissa: string } =>
      contribution.usdValueMantissa !== null,
  );
  const coverageComplete = coverageStatuses.every((status) => status === 'COMPLETE');
  if (contributions.length === 0) {
    if (!coverageComplete) {
      return {
        usdValue: null,
        freshnessClass: 'UNAVAILABLE',
        completeness: 'UNAVAILABLE',
        sourceCount: 0,
        includedSourceCount: 0,
      };
    }
    return {
      usdValue: exactUsdAmount('0'),
      freshnessClass: 'CURRENT',
      completeness: 'COMPLETE',
      sourceCount: 0,
      includedSourceCount: 0,
    };
  }

  let sum = 0n;
  for (const contribution of included) {
    if (!CANONICAL_INTEGER.test(contribution.usdValueMantissa)) {
      throw new PortfolioAggregationError();
    }
    sum += BigInt(contribution.usdValueMantissa);
    if (sum.toString().length > MAX_AGGREGATE_USD_DIGITS) {
      throw new PortfolioAggregationError();
    }
  }
  return {
    usdValue: included.length === 0 ? null : exactUsdAmount(sum.toString()),
    freshnessClass: coverageComplete
      ? worstFreshness(contributions.map(({ freshnessClass }) => freshnessClass))
      : 'UNAVAILABLE',
    completeness:
      included.length === 0
        ? 'UNAVAILABLE'
        : included.length === contributions.length && coverageComplete
          ? 'COMPLETE'
          : 'PARTIAL',
    sourceCount: contributions.length,
    includedSourceCount: included.length,
  };
}

function sourceContribution(source: PortfolioSourceBreakdown): Contribution {
  return {
    freshnessClass: source.freshnessClass,
    usdValueMantissa: source.usdValue?.mantissa ?? null,
  };
}

const EXCLUDED_CONTRIBUTION: Contribution = Object.freeze({
  freshnessClass: 'UNAVAILABLE',
  usdValueMantissa: null,
});

function groupedTotals<Key extends string, Output>(
  keys: readonly Key[],
  contributionsFor: (key: Key) => readonly Contribution[],
  coverageStatusesFor: (key: Key) => readonly IndexedBalanceCoverageStatus[],
  build: (key: Key, total: PortfolioAggregate) => Output,
): readonly Output[] {
  return [...new Set(keys)]
    .sort()
    .map((key) => build(key, aggregate(contributionsFor(key), coverageStatusesFor(key))));
}

function immutableBalanceCoverage(
  coverage: IndexedPortfolioBalanceCoverage,
): PortfolioBalanceCoverage {
  return Object.freeze({
    status: coverage.status,
    targets: Object.freeze(
      coverage.targets.map((target) =>
        Object.freeze({
          walletId: target.walletId,
          networkId: target.networkId,
          status: target.status,
        }),
      ),
    ),
  });
}

export function buildUnifiedPortfolio(request: BuildUnifiedPortfolioRequest): UnifiedPortfolio {
  const sources = request.valuedBalances.map(sourceBreakdown).sort(sourceOrder);
  const excludedSources = request.excludedBalances.map(excludedSource).sort(excludedOrder);
  const contributions = [
    ...sources.map(sourceContribution),
    ...excludedSources.map(() => EXCLUDED_CONTRIBUTION),
  ];
  const walletKeys = [
    ...sources.map(({ walletId }) => walletId),
    ...excludedSources.map(({ walletId }) => walletId),
    ...request.balanceCoverage.targets.map(({ walletId }) => walletId),
  ];
  const chainKeys = [
    ...sources.map(({ networkId }) => networkId),
    ...excludedSources.map(({ networkId }) => networkId),
    ...request.balanceCoverage.targets.map(({ networkId }) => networkId),
  ];
  const assetKeys = sources.map(({ asset }) => asset.stablecoin);

  const walletTotals = groupedTotals(
    walletKeys,
    (walletId) => [
      ...sources.filter((source) => source.walletId === walletId).map(sourceContribution),
      ...excludedSources
        .filter((source) => source.walletId === walletId)
        .map(() => EXCLUDED_CONTRIBUTION),
    ],
    (walletId) =>
      request.balanceCoverage.targets
        .filter((target) => target.walletId === walletId)
        .map(({ status }) => status),
    (walletId, total): PortfolioWalletTotal => ({ walletId, ...total }),
  );
  const chainTotals = groupedTotals(
    chainKeys,
    (networkId) => [
      ...sources.filter((source) => source.networkId === networkId).map(sourceContribution),
      ...excludedSources
        .filter((source) => source.networkId === networkId)
        .map(() => EXCLUDED_CONTRIBUTION),
    ],
    (networkId) =>
      request.balanceCoverage.targets
        .filter((target) => target.networkId === networkId)
        .map(({ status }) => status),
    (networkId, total): PortfolioChainTotal => ({ networkId, ...total }),
  );
  const assetTotals = groupedTotals(
    assetKeys,
    (stablecoin) =>
      sources.filter((source) => source.asset.stablecoin === stablecoin).map(sourceContribution),
    (stablecoin) =>
      request.balanceCoverage.targets
        .filter((target) =>
          MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets.some(
            (asset) =>
              asset.activationState === 'ACTIVE' &&
              asset.networkId === target.networkId &&
              asset.stablecoin === stablecoin,
          ),
        )
        .map(({ status }) => status),
    (stablecoin, total): PortfolioAssetTotal => ({ stablecoin, ...total }),
  );
  const observedAt = [
    ...sources.map(({ balanceObservedAt }) => balanceObservedAt),
    ...excludedSources.map(({ balanceObservedAt }) => balanceObservedAt),
  ].sort();

  const overallTotal = aggregate(
    contributions,
    request.balanceCoverage.targets.map(({ status }) => status),
  );
  return {
    schemaVersion: UNIFIED_PORTFOLIO_SCHEMA_VERSION,
    asOf: request.asOf,
    balanceSnapshot: {
      snapshotId: request.balanceSnapshotId,
      capturedAt: request.balanceCapturedAt,
      freshnessClass: request.balanceSnapshotFreshness,
    },
    balanceCoverage: immutableBalanceCoverage(request.balanceCoverage),
    oldestBalanceObservedAt: observedAt[0] ?? null,
    overallTotal:
      request.balanceSnapshotFreshness === 'STALE' && overallTotal.freshnessClass === 'CURRENT'
        ? { ...overallTotal, freshnessClass: 'STALE' }
        : overallTotal,
    walletTotals,
    chainTotals,
    assetTotals,
    sources,
    excludedSources,
    reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
    mayIncreaseBuyingPower: false,
    mayAuthorizeFinancialUse: false,
  };
}

function sourceOrder(left: PortfolioSourceBreakdown, right: PortfolioSourceBreakdown): number {
  return (
    left.walletId.localeCompare(right.walletId) ||
    left.networkId.localeCompare(right.networkId) ||
    left.asset.stablecoin.localeCompare(right.asset.stablecoin) ||
    left.asset.identity.localeCompare(right.asset.identity)
  );
}

function excludedOrder(left: ExcludedPortfolioSource, right: ExcludedPortfolioSource): number {
  return (
    left.walletId.localeCompare(right.walletId) ||
    left.networkId.localeCompare(right.networkId) ||
    left.assetIdentity.localeCompare(right.assetIdentity)
  );
}
