import { Injectable } from '@nestjs/common';

import type { AccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import { LocalDemoPortfolioService } from './local-demo-portfolio.service';
import {
  LocalDemoYieldCatalogService,
  type LocalDemoCustomYieldFilters,
  type LocalDemoYieldCatalogFreshness,
  type LocalDemoYieldOpportunitySummary,
} from './local-demo-yield-catalog.service';

export const LOCAL_DEMO_ALLOCATION_PRESET_IDS = Object.freeze([
  'MORE_LIQUID',
  'BALANCED',
  'MORE_YIELD',
] as const);

export type LocalDemoAllocationPresetId = (typeof LOCAL_DEMO_ALLOCATION_PRESET_IDS)[number];

export const LOCAL_DEMO_ALLOCATION_SELECTION_KINDS = Object.freeze(['PRESET', 'CUSTOM'] as const);
export const LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS = 9_900 as const;

export type LocalDemoAllocationSelection =
  | Readonly<{
      kind: 'PRESET';
      presetId: LocalDemoAllocationPresetId;
    }>
  | Readonly<{
      kind: 'CUSTOM';
      liquidReserveBasisPoints: number;
      filters: LocalDemoCustomYieldFilters;
    }>;

export const LOCAL_DEMO_YIELD_PROJECTION_SOURCE = 'MORPHO_PUBLIC_API_SNAPSHOT' as const;
export const LOCAL_DEMO_YIELD_CALCULATION_METHOD =
  'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL' as const;
export const LOCAL_DEMO_FEE_ESTIMATE_SOURCE = 'LOCAL_DEMO_ACTION_COST_ASSUMPTION' as const;

export type LocalDemoBreakEvenStatus = 'AVAILABLE' | 'NOT_APPLICABLE' | 'UNAVAILABLE';

export const LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES = Object.freeze([
  'LIQUIDITY',
  'CONVERSION',
  'SLIPPAGE',
  'NETWORK',
  'ROUTING',
] as const);

export type LocalDemoAllocationDeductionCode =
  (typeof LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES)[number];

interface AllocationPresetDefinition {
  readonly id: LocalDemoAllocationPresetId;
  readonly label: string;
  readonly description: string;
  readonly liquidReserveBasisPoints: number;
}

const PRESETS: Readonly<Record<LocalDemoAllocationPresetId, AllocationPresetDefinition>> =
  Object.freeze({
    MORE_LIQUID: Object.freeze({
      id: 'MORE_LIQUID',
      label: 'More liquid',
      description: 'Keep 60% readily available and divide the remainder across snapshot markets.',
      liquidReserveBasisPoints: 6_000,
    }),
    BALANCED: Object.freeze({
      id: 'BALANCED',
      label: 'Balanced blend',
      description: 'Keep 30% readily available and divide the remainder across snapshot markets.',
      liquidReserveBasisPoints: 3_000,
    }),
    MORE_YIELD: Object.freeze({
      id: 'MORE_YIELD',
      label: 'More yield',
      description: 'Keep 15% readily available and divide the remainder across snapshot markets.',
      liquidReserveBasisPoints: 1_500,
    }),
  });

const DEDUCTION_BASIS_POINTS: Readonly<Record<LocalDemoAllocationDeductionCode, number>> =
  Object.freeze({
    LIQUIDITY: 5_000,
    CONVERSION: 1_000,
    SLIPPAGE: 1_000,
    NETWORK: 1_000,
    ROUTING: 2_000,
  });

export interface LocalDemoAllocationPreviewResponse {
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
    freshness: LocalDemoYieldCatalogFreshness;
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
    opportunity: LocalDemoYieldOpportunitySummary | null;
  }>[];
  readonly deductions: readonly Readonly<{
    code: LocalDemoAllocationDeductionCode;
    amountUsdMinor: string;
  }>[];
  readonly feeEstimateSource: typeof LOCAL_DEMO_FEE_ESTIMATE_SOURCE;
  readonly totalFeesUsdMinor: string;
  readonly netPlannedCapitalUsdMinor: string;
  readonly yieldProjection: Readonly<{
    source: typeof LOCAL_DEMO_YIELD_PROJECTION_SOURCE;
    calculationMethod: typeof LOCAL_DEMO_YIELD_CALCULATION_METHOD;
    effectiveApyBasisPoints: number;
    projectedAnnualYieldUsdMinor: string;
    projectedAnnualNetGrowthUsdMinor: string;
    breakEven: Readonly<{
      status: LocalDemoBreakEvenStatus;
      firstNetPositiveDay: number | null;
    }>;
  }>;
  readonly asOf: string;
}

/**
 * Projects an authenticated portfolio against a checked-in Morpho observation.
 * It performs no live provider request and creates no user-authorized financial
 * operation, quote, reservation, persistence record, or public-chain transaction.
 */
@Injectable()
export class LocalDemoAllocationService {
  constructor(
    private readonly portfolio: LocalDemoPortfolioService,
    private readonly yieldCatalog: LocalDemoYieldCatalogService,
  ) {}

  async preview(
    accountId: AccountId,
    correlation: JobCorrelationContext,
    requestedSelection: LocalDemoAllocationSelection,
  ): Promise<LocalDemoAllocationPreviewResponse> {
    const portfolio = await this.portfolio.read(accountId, correlation);
    const grossCapital = BigInt(portfolio.buyingPower.amountUsdMinor);
    const selection = selectionDefinition(requestedSelection);
    const catalogSelection = this.yieldCatalog.select(selection.filters);
    const opportunities = catalogSelection.selectedOpportunities;
    const yieldWeights = divideEvenly(
      10_000 - selection.liquidReserveBasisPoints,
      opportunities.length,
    );
    const percentageBasisPoints = Object.freeze([
      selection.liquidReserveBasisPoints,
      ...yieldWeights,
    ]);
    const allocationAmounts = distribute(grossCapital, percentageBasisPoints);
    const allocations: LocalDemoAllocationPreviewResponse['allocations'] = Object.freeze([
      Object.freeze({
        bucket: 'LIQUID_RESERVE' as const,
        allocationId: 'LIQUID_RESERVE',
        label: 'Liquid reserve',
        percentageBasisPoints: selection.liquidReserveBasisPoints,
        baseApyBasisPoints: 0,
        baseApyRateDecimal: '0',
        amountUsdMinor: requiredAmount(allocationAmounts, 0).toString(),
        opportunity: null,
      }),
      ...opportunities.map((opportunity, index) =>
        Object.freeze({
          bucket: 'YIELD_OPPORTUNITY' as const,
          allocationId: opportunity.opportunityId,
          label: `${opportunity.asset.symbol} on ${opportunity.protocol.name} (${opportunity.network.name})`,
          percentageBasisPoints: requiredNumber(yieldWeights, index),
          baseApyBasisPoints: opportunity.apy.baseBasisPoints,
          baseApyRateDecimal: opportunity.apy.baseRateDecimal,
          amountUsdMinor: requiredAmount(allocationAmounts, index + 1).toString(),
          opportunity,
        }),
      ),
    ]);

    const nonReserveCapital = allocationAmounts
      .slice(1)
      .reduce((total, amount) => total + amount, 0n);
    const totalFees = nonReserveCapital / 100n;
    const deductionAmounts = distribute(
      totalFees,
      LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES.map((code) => DEDUCTION_BASIS_POINTS[code]),
    );
    const deductions = Object.freeze(
      LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES.map((code, index) =>
        Object.freeze({
          code,
          amountUsdMinor: requiredAmount(deductionAmounts, index).toString(),
        }),
      ),
    );
    const netPlannedCapital = grossCapital - totalFees;
    const effectiveApyBasisPoints = calculateEffectiveApyBasisPoints(allocations);
    const annualYieldNumerator = netPlannedCapital * BigInt(effectiveApyBasisPoints);
    const projectedAnnualYield = annualYieldNumerator / 10_000n;
    const projectedAnnualNetGrowth = projectedAnnualYield - totalFees;
    if (projectedAnnualNetGrowth < 0n) {
      throw new TypeError('negative local demo annual net growth');
    }

    return Object.freeze({
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
      selection,
      catalog: Object.freeze({
        snapshotId: catalogSelection.metadata.snapshotId,
        capturedAt: catalogSelection.metadata.capturedAt,
        staleAfter: catalogSelection.metadata.staleAfter,
        freshness: catalogSelection.metadata.freshness,
        staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
        riskClassificationAvailable: false,
        riskClassification: 'NOT_ASSESSED',
        matchedOpportunityCount: catalogSelection.matchedOpportunities.length,
        selectedOpportunityCount: opportunities.length,
      }),
      grossCapitalUsdMinor: grossCapital.toString(),
      allocations,
      deductions,
      feeEstimateSource: LOCAL_DEMO_FEE_ESTIMATE_SOURCE,
      totalFeesUsdMinor: totalFees.toString(),
      netPlannedCapitalUsdMinor: netPlannedCapital.toString(),
      yieldProjection: Object.freeze({
        source: LOCAL_DEMO_YIELD_PROJECTION_SOURCE,
        calculationMethod: LOCAL_DEMO_YIELD_CALCULATION_METHOD,
        effectiveApyBasisPoints,
        projectedAnnualYieldUsdMinor: projectedAnnualYield.toString(),
        projectedAnnualNetGrowthUsdMinor: projectedAnnualNetGrowth.toString(),
        breakEven: projectBreakEven(totalFees, annualYieldNumerator),
      }),
      asOf: portfolio.asOf,
    });
  }
}

function copyFilters(filters: LocalDemoCustomYieldFilters): LocalDemoCustomYieldFilters {
  return Object.freeze({
    assetSymbols: Object.freeze([...filters.assetSymbols]),
    providerIds: Object.freeze([...filters.providerIds]),
    networkIds: Object.freeze([...filters.networkIds]),
    minimumApyBasisPoints: filters.minimumApyBasisPoints,
    minimumTvlUsdMinor: filters.minimumTvlUsdMinor,
    minimumExitLiquidityUsdMinor: filters.minimumExitLiquidityUsdMinor,
    maximumUtilizationBasisPoints: filters.maximumUtilizationBasisPoints,
  });
}

function selectionDefinition(
  selection: LocalDemoAllocationSelection,
): LocalDemoAllocationPreviewResponse['selection'] {
  if (selection.kind === 'PRESET') {
    const preset = PRESETS[selection.presetId];
    if (!preset) throw new TypeError('unsupported local demo allocation preset');
    return Object.freeze({
      kind: 'PRESET',
      presetId: preset.id,
      label: preset.label,
      description: preset.description,
      liquidReserveBasisPoints: preset.liquidReserveBasisPoints,
      filters: null,
    });
  }
  if (
    selection.kind !== 'CUSTOM' ||
    !Number.isSafeInteger(selection.liquidReserveBasisPoints) ||
    selection.liquidReserveBasisPoints < 0 ||
    selection.liquidReserveBasisPoints > LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS
  ) {
    throw new TypeError('invalid local demo allocation selection');
  }
  return Object.freeze({
    kind: 'CUSTOM',
    presetId: null,
    label: 'Custom yield filter',
    description:
      'Apply asset, provider, network, APY, TVL, liquidity, and utilization constraints.',
    liquidReserveBasisPoints: selection.liquidReserveBasisPoints,
    filters: copyFilters(selection.filters),
  });
}

function divideEvenly(total: number, count: number): readonly number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(count) || count < 1) {
    throw new TypeError('invalid local demo allocation distribution');
  }
  const quotient = Math.floor(total / count);
  const remainder = total % count;
  return Object.freeze(
    Array.from({ length: count }, (_, index) => quotient + (index < remainder ? 1 : 0)),
  );
}

function calculateEffectiveApyBasisPoints(
  allocations: LocalDemoAllocationPreviewResponse['allocations'],
): number {
  const weightedBasisPoints = allocations.reduce(
    (total, allocation) =>
      total + BigInt(allocation.percentageBasisPoints) * BigInt(allocation.baseApyBasisPoints),
    0n,
  );
  const result = weightedBasisPoints / 10_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('local demo effective APY exceeds numeric limits');
  }
  return Number(result);
}

function projectBreakEven(
  totalFees: bigint,
  annualYieldNumerator: bigint,
): LocalDemoAllocationPreviewResponse['yieldProjection']['breakEven'] {
  if (annualYieldNumerator > 0n) {
    const firstDay = ceilDivide((totalFees + 1n) * 10_000n * 365n, annualYieldNumerator);
    if (firstDay < 1n || firstDay > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError('local demo break-even day exceeds numeric limits');
    }
    return Object.freeze({ status: 'AVAILABLE', firstNetPositiveDay: Number(firstDay) });
  }
  return totalFees === 0n
    ? Object.freeze({ status: 'NOT_APPLICABLE', firstNetPositiveDay: null })
    : Object.freeze({ status: 'UNAVAILABLE', firstNetPositiveDay: null });
}

function ceilDivide(dividend: bigint, divisor: bigint): bigint {
  if (dividend < 0n || divisor <= 0n) throw new TypeError('invalid local demo division');
  return (dividend + divisor - 1n) / divisor;
}

/** Largest-remainder apportionment keeps every value in exact integer cents. */
function distribute(total: bigint, basisPoints: readonly number[]): readonly bigint[] {
  const denominator = 10_000n;
  if (
    total < 0n ||
    basisPoints.some(
      (basisPoint) => !Number.isSafeInteger(basisPoint) || basisPoint < 0 || basisPoint > 10_000,
    ) ||
    basisPoints.reduce((sum, basisPoint) => sum + basisPoint, 0) !== 10_000
  ) {
    throw new TypeError('invalid local demo allocation weights');
  }
  const amounts = basisPoints.map((basisPoint) => (total * BigInt(basisPoint)) / denominator);
  const remainders = basisPoints.map((basisPoint, index) => ({
    index,
    value: (total * BigInt(basisPoint)) % denominator,
  }));
  let undistributed = total - amounts.reduce((sum, amount) => sum + amount, 0n);
  remainders.sort((left, right) =>
    left.value === right.value ? left.index - right.index : left.value > right.value ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (undistributed === 0n) break;
    amounts[index] = requiredAmount(amounts, index) + 1n;
    undistributed -= 1n;
  }
  if (undistributed !== 0n) throw new TypeError('invalid local demo allocation weights');
  return Object.freeze(amounts);
}

function requiredAmount(amounts: readonly bigint[], index: number): bigint {
  const amount = amounts[index];
  if (amount === undefined) throw new TypeError('missing local demo allocation amount');
  return amount;
}

function requiredNumber(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new TypeError('missing local demo allocation weight');
  return value;
}
