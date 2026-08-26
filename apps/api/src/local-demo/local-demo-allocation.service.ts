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
export const LOCAL_DEMO_YIELD_CALCULATION_METHOD = 'POSITION_WEIGHTED_EXACT_BASE_APY' as const;
export const LOCAL_DEMO_EXECUTION_COST_TREATMENT = 'LOCAL_DEMO_ZERO_NO_EXECUTION' as const;

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
  readonly executionCost: Readonly<{
    treatment: typeof LOCAL_DEMO_EXECUTION_COST_TREATMENT;
    modeledLocalAmountUsdMinor: '0';
    publicExecutionCostStatus: 'UNQUOTED';
  }>;
  readonly capitalIncludedInProjectionUsdMinor: string;
  readonly yieldProjection: Readonly<{
    source: typeof LOCAL_DEMO_YIELD_PROJECTION_SOURCE;
    calculationMethod: typeof LOCAL_DEMO_YIELD_CALCULATION_METHOD;
    effectiveApyBasisPoints: number;
    projectedAnnualYieldUsdMinor: string;
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
    const [liquidReserveCapital, nonReserveCapital] = distribute(grossCapital, [
      selection.liquidReserveBasisPoints,
      10_000 - selection.liquidReserveBasisPoints,
    ]);
    if (liquidReserveCapital === undefined || nonReserveCapital === undefined) {
      throw new TypeError('missing local demo capital bucket');
    }
    const allocationAmounts = Object.freeze([
      liquidReserveCapital,
      ...divideAmountEvenly(nonReserveCapital, opportunities.length),
    ]);
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

    // This preview creates no route or transaction, so it must not fabricate a
    // production execution quote. Public execution costs remain unquoted.
    const { effectiveApyBasisPoints, projectedAnnualYield } = calculateYieldProjection(
      allocations,
      grossCapital,
    );

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
      executionCost: Object.freeze({
        treatment: LOCAL_DEMO_EXECUTION_COST_TREATMENT,
        modeledLocalAmountUsdMinor: '0',
        publicExecutionCostStatus: 'UNQUOTED',
      }),
      capitalIncludedInProjectionUsdMinor: grossCapital.toString(),
      yieldProjection: Object.freeze({
        source: LOCAL_DEMO_YIELD_PROJECTION_SOURCE,
        calculationMethod: LOCAL_DEMO_YIELD_CALCULATION_METHOD,
        effectiveApyBasisPoints,
        projectedAnnualYieldUsdMinor: projectedAnnualYield.toString(),
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

function calculateYieldProjection(
  allocations: LocalDemoAllocationPreviewResponse['allocations'],
  grossCapital: bigint,
): Readonly<{ effectiveApyBasisPoints: number; projectedAnnualYield: bigint }> {
  const rates = allocations.map(({ baseApyRateDecimal }) => decimalRatio(baseApyRateDecimal));
  const maximumScale = rates.reduce(
    (maximum, { fractionalDigits }) => Math.max(maximum, fractionalDigits),
    0,
  );
  const denominator = 10n ** BigInt(maximumScale);
  const annualYieldNumerator = allocations.reduce((total, allocation, index) => {
    const rate = rates[index];
    if (rate === undefined) throw new TypeError('missing local demo APY rate');
    const scaledRate = rate.numerator * 10n ** BigInt(maximumScale - rate.fractionalDigits);
    return total + BigInt(allocation.amountUsdMinor) * scaledRate;
  }, 0n);
  const projectedAnnualYield = annualYieldNumerator / denominator;
  const effectiveApy =
    grossCapital === 0n ? 0n : (annualYieldNumerator * 10_000n) / (grossCapital * denominator);
  if (effectiveApy > BigInt(Number.MAX_SAFE_INTEGER) || effectiveApy > 10_000n) {
    throw new TypeError('local demo effective APY exceeds numeric limits');
  }
  return Object.freeze({
    effectiveApyBasisPoints: Number(effectiveApy),
    projectedAnnualYield,
  });
}

function decimalRatio(value: string): Readonly<{ numerator: bigint; fractionalDigits: number }> {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(value);
  if (!match) throw new TypeError('invalid local demo APY rate');
  const whole = match[1];
  const fraction = match[2] ?? '';
  if (whole === undefined || fraction.length > 96) {
    throw new TypeError('invalid local demo APY rate');
  }
  return Object.freeze({
    numerator: BigInt(`${whole}${fraction}`),
    fractionalDigits: fraction.length,
  });
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

function divideAmountEvenly(total: bigint, count: number): readonly bigint[] {
  if (total < 0n || !Number.isSafeInteger(count) || count < 1) {
    throw new TypeError('invalid local demo amount distribution');
  }
  const divisor = BigInt(count);
  const quotient = total / divisor;
  const remainder = Number(total % divisor);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => quotient + (index < remainder ? 1n : 0n)),
  );
}
