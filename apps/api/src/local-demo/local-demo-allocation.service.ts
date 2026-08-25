import { Injectable } from '@nestjs/common';

import type { AccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import { LocalDemoPortfolioService } from './local-demo-portfolio.service';

export const LOCAL_DEMO_ALLOCATION_PRESET_IDS = Object.freeze([
  'MORE_LIQUID',
  'BALANCED',
  'MORE_YIELD',
] as const);

export type LocalDemoAllocationPresetId = (typeof LOCAL_DEMO_ALLOCATION_PRESET_IDS)[number];

export const LOCAL_DEMO_ALLOCATION_BUCKETS = Object.freeze([
  'LIQUID_RESERVE',
  'CONSERVATIVE_YIELD',
  'BALANCED_YIELD',
] as const);

export type LocalDemoAllocationBucket = (typeof LOCAL_DEMO_ALLOCATION_BUCKETS)[number];

export const LOCAL_DEMO_ALLOCATION_APY_BASIS_POINTS: Readonly<
  Record<LocalDemoAllocationBucket, number>
> = Object.freeze({
  LIQUID_RESERVE: 0,
  CONSERVATIVE_YIELD: 400,
  BALANCED_YIELD: 600,
});

export const LOCAL_DEMO_YIELD_PROJECTION_SOURCE = 'SYNTHETIC_FIXED_DEMO_RATES' as const;
export const LOCAL_DEMO_YIELD_CALCULATION_METHOD =
  'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL' as const;

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
  readonly percentageBasisPoints: Readonly<Record<LocalDemoAllocationBucket, number>>;
}

const BUCKET_LABELS: Readonly<Record<LocalDemoAllocationBucket, string>> = Object.freeze({
  LIQUID_RESERVE: 'Liquid reserve',
  CONSERVATIVE_YIELD: 'Conservative yield',
  BALANCED_YIELD: 'Balanced yield',
});

const PRESETS: Readonly<Record<LocalDemoAllocationPresetId, AllocationPresetDefinition>> =
  Object.freeze({
    MORE_LIQUID: Object.freeze({
      id: 'MORE_LIQUID',
      label: 'More liquid',
      description: 'Keep most capital readily available while adding a smaller yield allocation.',
      percentageBasisPoints: Object.freeze({
        LIQUID_RESERVE: 6_000,
        CONSERVATIVE_YIELD: 3_000,
        BALANCED_YIELD: 1_000,
      }),
    }),
    BALANCED: Object.freeze({
      id: 'BALANCED',
      label: 'Balanced blend',
      description: 'Split capital between ready access and diversified synthetic yield.',
      percentageBasisPoints: Object.freeze({
        LIQUID_RESERVE: 3_000,
        CONSERVATIVE_YIELD: 4_500,
        BALANCED_YIELD: 2_500,
      }),
    }),
    MORE_YIELD: Object.freeze({
      id: 'MORE_YIELD',
      label: 'More yield',
      description: 'Put more capital toward synthetic yield while retaining a liquid reserve.',
      percentageBasisPoints: Object.freeze({
        LIQUID_RESERVE: 1_500,
        CONSERVATIVE_YIELD: 3_500,
        BALANCED_YIELD: 5_000,
      }),
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
  readonly preset: Readonly<{
    id: LocalDemoAllocationPresetId;
    label: string;
    description: string;
  }>;
  readonly grossCapitalUsdMinor: string;
  readonly allocations: readonly Readonly<{
    bucket: LocalDemoAllocationBucket;
    label: string;
    percentageBasisPoints: number;
    apyBasisPoints: number;
    amountUsdMinor: string;
  }>[];
  readonly deductions: readonly Readonly<{
    code: LocalDemoAllocationDeductionCode;
    amountUsdMinor: string;
  }>[];
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
 * Produces a deterministic estimate for the synthetic local demo. This service
 * only projects the authenticated portfolio snapshot in memory: it has no
 * operation, transaction, provider, network, or persistence dependency.
 */
@Injectable()
export class LocalDemoAllocationService {
  constructor(private readonly portfolio: LocalDemoPortfolioService) {}

  async preview(
    accountId: AccountId,
    correlation: JobCorrelationContext,
    presetId: LocalDemoAllocationPresetId,
  ): Promise<LocalDemoAllocationPreviewResponse> {
    const portfolio = await this.portfolio.read(accountId, correlation);
    const grossCapital = BigInt(portfolio.buyingPower.amountUsdMinor);
    const preset = PRESETS[presetId];
    const allocationAmounts = distribute(
      grossCapital,
      LOCAL_DEMO_ALLOCATION_BUCKETS.map((bucket) => preset.percentageBasisPoints[bucket]),
    );
    const allocations = LOCAL_DEMO_ALLOCATION_BUCKETS.map((bucket, index) =>
      Object.freeze({
        bucket,
        label: BUCKET_LABELS[bucket],
        percentageBasisPoints: preset.percentageBasisPoints[bucket],
        apyBasisPoints: LOCAL_DEMO_ALLOCATION_APY_BASIS_POINTS[bucket],
        amountUsdMinor: requiredAmount(allocationAmounts, index).toString(),
      }),
    );

    const nonReserveCapital = allocationAmounts
      .slice(1)
      .reduce((total, amount) => total + amount, 0n);
    const totalFees = nonReserveCapital / 100n;
    const deductionAmounts = distribute(
      totalFees,
      LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES.map((code) => DEDUCTION_BASIS_POINTS[code]),
    );
    const deductions = LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES.map((code, index) =>
      Object.freeze({
        code,
        amountUsdMinor: requiredAmount(deductionAmounts, index).toString(),
      }),
    );
    const netPlannedCapital = grossCapital - totalFees;
    const effectiveApyBasisPoints = calculateEffectiveApyBasisPoints(preset);
    const annualYieldNumerator = netPlannedCapital * BigInt(effectiveApyBasisPoints);
    const projectedAnnualYield = annualYieldNumerator / 10_000n;
    const projectedAnnualNetGrowth = projectedAnnualYield - totalFees;
    if (projectedAnnualNetGrowth < 0n) {
      throw new TypeError('negative local demo annual net growth');
    }

    return Object.freeze({
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
      preset: Object.freeze({
        id: preset.id,
        label: preset.label,
        description: preset.description,
      }),
      grossCapitalUsdMinor: grossCapital.toString(),
      allocations: Object.freeze(allocations),
      deductions: Object.freeze(deductions),
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

function calculateEffectiveApyBasisPoints(preset: AllocationPresetDefinition): number {
  const weightedBasisPoints = LOCAL_DEMO_ALLOCATION_BUCKETS.reduce(
    (total, bucket) =>
      total +
      BigInt(preset.percentageBasisPoints[bucket]) *
        BigInt(LOCAL_DEMO_ALLOCATION_APY_BASIS_POINTS[bucket]),
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

/**
 * Largest-remainder apportionment keeps every value in exact integer cents.
 * Equal fractional remainders resolve in the stable, server-defined order.
 */
function distribute(total: bigint, basisPoints: readonly number[]): readonly bigint[] {
  const denominator = 10_000n;
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
