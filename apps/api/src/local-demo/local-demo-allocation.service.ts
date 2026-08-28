import { Injectable } from '@nestjs/common';

import type { AccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  ROUTING_FEE_RULE_V1,
  calculateRoutingFeeSnapshotV1,
  type RoutingFeeRouteClassificationKind,
  type RoutingFeeRouteEndpointV1,
  type RoutingFeeRouteLegV1,
  type RoutingFeeRouteV1,
} from '../routing-fees';
import {
  LocalDemoPortfolioService,
  type LocalDemoPortfolioResponse,
} from './local-demo-portfolio.service';
import {
  LocalDemoNoMatchingYieldOpportunitiesError,
  LocalDemoYieldCatalogService,
  type LocalDemoYieldCatalogFreshness,
  type LocalDemoYieldNetworkId,
  type LocalDemoYieldOpportunitySummary,
} from './local-demo-yield-catalog.service';

export const LOCAL_DEMO_ALLOCATION_PRESET_IDS = Object.freeze([
  'MORE_LIQUID',
  'BALANCED',
  'MORE_YIELD',
] as const);

export type LocalDemoAllocationPresetId = (typeof LOCAL_DEMO_ALLOCATION_PRESET_IDS)[number];

export type LocalDemoAllocationSelection = Readonly<{
  kind: 'PRESET';
  presetId: LocalDemoAllocationPresetId;
  liquidReserveBasisPoints: number;
}>;

export const LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS = 9_500 as const;
export const LOCAL_DEMO_MAX_RETAINED_ROUNDING_RESIDUAL_USD_MINOR = 3 as const;

export const LOCAL_DEMO_YIELD_PROJECTION_SOURCE = 'MANAGED_RATE_SNAPSHOT' as const;
export const LOCAL_DEMO_YIELD_CALCULATION_METHOD =
  'INTERNAL_POSITION_WEIGHTED_25_BPS_CONSERVATIVE_BUCKET' as const;
export const LOCAL_DEMO_PUBLIC_APY_BUCKET_SIZE_BASIS_POINTS = 25 as const;
export const LOCAL_DEMO_EXECUTION_COST_MODEL = 'LOCAL_DEMO_ALLOCATION_COST_V2' as const;
export const LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD =
  'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES' as const;
export const LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS = 365 as const;

export const LOCAL_DEMO_EXECUTION_COST_COMPONENTS = Object.freeze([
  'NETWORK',
  'CONVERSION',
  'CROSS_ECOSYSTEM_TRANSFER',
  'MARKET_IMPACT',
  'PLATFORM_ROUTING',
] as const);

export type LocalDemoExecutionCostComponentCode =
  (typeof LOCAL_DEMO_EXECUTION_COST_COMPONENTS)[number];

type LocalDemoExecutionCostBasis =
  | 'NETWORK_ACTIVATION_AND_POSITION_VOLUME'
  | 'TWELVE_BPS_OF_REQUIRED_CONVERSION'
  | 'NO_CROSS_ECOSYSTEM_TRANSFER'
  | 'POSITION_SIZE_AND_UTILIZATION'
  | 'CANONICAL_PLATFORM_ROUTING_RULE_V1';

type LocalDemoExecutionCostFundingTreatment = 'DEDUCTED_FROM_GROSS' | 'ADDED_ON_TOP';

export const LOCAL_DEMO_ECOSYSTEMS = Object.freeze(['EVM', 'SOLANA'] as const);
export type LocalDemoEcosystem = (typeof LOCAL_DEMO_ECOSYSTEMS)[number];

interface AllocationPresetDefinition {
  readonly id: LocalDemoAllocationPresetId;
  readonly label: string;
}

const PRESETS: Readonly<Record<LocalDemoAllocationPresetId, AllocationPresetDefinition>> =
  Object.freeze({
    MORE_LIQUID: Object.freeze({
      id: 'MORE_LIQUID',
      label: 'More liquid',
    }),
    BALANCED: Object.freeze({
      id: 'BALANCED',
      label: 'Managed blend',
    }),
    MORE_YIELD: Object.freeze({
      id: 'MORE_YIELD',
      label: 'More yield',
    }),
  });

const NETWORK_ACTIVATION_COST_USD_MINOR: Readonly<Record<LocalDemoYieldNetworkId, bigint>> =
  Object.freeze({
    'eip155:1': 150n,
    'eip155:56': 5n,
    'eip155:8453': 25n,
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 1n,
  });
const NETWORK_POSITION_VOLUME_BASIS_POINTS: Readonly<Record<LocalDemoYieldNetworkId, number>> =
  Object.freeze({
    'eip155:1': 8,
    'eip155:56': 2,
    'eip155:8453': 4,
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 1,
  });
const CONVERSION_COST_BASIS_POINTS = 12;
const MARKET_IMPACT_BASE_BASIS_POINTS = 1;
const MARKET_IMPACT_UTILIZATION_THRESHOLD_BASIS_POINTS = 8_500;
const MARKET_IMPACT_UTILIZATION_STEP_BASIS_POINTS = 500;
const LOCAL_DEMO_USD_MINOR_ASSET_REVISION_ID = '25500000-0000-4000-8000-000000000001';
const LOCAL_DEMO_ROUTING_FEE_QUOTE_REFERENCE_ID = '25500000-0000-4000-8000-000000000002';
const LOCAL_DEMO_ROUTING_FEE_ROUTE_REFERENCE_ID = '25500000-0000-4000-8000-000000000003';
// Within a fixed route topology, cent ceilings can move the network,
// conversion, and market-impact estimates by only a few cents. A larger gap
// signals a topology/activation discontinuity and must fail closed rather than
// be mislabeled as rounding residual.

export interface LocalDemoAllocationPreviewResponse {
  readonly use: 'LOCAL_DEMO_ESTIMATE_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly portfolioSnapshotId: string;
  readonly selection: Readonly<{
    kind: 'PRESET';
    presetId: LocalDemoAllocationPresetId;
    label: string;
    description: string;
    liquidReserveBasisPoints: number;
  }>;
  readonly rateSnapshot: Readonly<{
    id: string;
    capturedAt: string;
    staleAfter: string;
    freshness: LocalDemoYieldCatalogFreshness;
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE';
    riskClassificationAvailable: false;
    riskClassification: 'NOT_ASSESSED';
  }>;
  readonly grossCapitalUsdMinor: string;
  readonly sourceCapitalByEcosystem: readonly Readonly<{
    ecosystem: LocalDemoEcosystem;
    amountUsdMinor: string;
  }>[];
  readonly allocations: readonly Readonly<{
    bucket: 'LIQUID_RESERVE' | 'MANAGED_YIELD';
    allocationId: 'LIQUID_RESERVE' | 'MANAGED_YIELD';
    label: 'Liquid reserve' | 'Managed yield';
    percentageBasisPoints: number;
    amountUsdMinor: string;
  }>[];
  readonly managedYieldComposition: readonly Readonly<{
    ecosystem: LocalDemoEcosystem;
    label: 'EVM managed yield' | 'SVM managed yield';
    percentageBasisPointsOfManagedYield: number;
    amountUsdMinor: string;
  }>[];
  readonly compositionSummary: Readonly<{
    mode: 'SINGLE_ECOSYSTEM' | 'EVM_SOLANA_PORTFOLIO_BLEND';
    crossEcosystemTransferRequired: false;
    crossEcosystemTransferUsdMinor: '0';
    activeEcosystemCount: 1 | 2;
  }>;
  readonly executionCost: Readonly<{
    actualLocalOperation: Readonly<{
      status: 'NO_EXECUTION';
      amountUsdMinor: '0';
    }>;
    modeledScenario: Readonly<{
      status: 'AVAILABLE';
      modelId: typeof LOCAL_DEMO_EXECUTION_COST_MODEL;
      isQuote: false;
      costBasisCapitalUsdMinor: string;
      fundingTreatment: 'MIXED_DEDUCT_FROM_GROSS_AND_ADD_ON_TOP';
      rounding: 'CEIL_VARIABLE_COMPONENTS_PLATFORM_FEE_HALF_EVEN';
      routingFeePolicy: Readonly<{
        tier: 'FREE';
        classification: RoutingFeeRouteClassificationKind;
        ruleVersion: 1;
      }>;
      components: readonly Readonly<{
        code: LocalDemoExecutionCostComponentCode;
        label: string;
        calculationBasis: LocalDemoExecutionCostBasis;
        fundingTreatment: LocalDemoExecutionCostFundingTreatment;
        amountUsdMinor: string;
      }>[];
      deductedFromGrossUsdMinor: string;
      addedOnTopUsdMinor: string;
      retainedRoundingResidualUsdMinor: string;
      totalUsdMinor: string;
      requiredCapitalIncludingAddedOnTopUsdMinor: string;
    }>;
    publicExecution: Readonly<{
      status: 'UNQUOTED';
      amountUsdMinor: null;
    }>;
  }>;
  readonly capitalIncludedInProjectionUsdMinor: string;
  readonly yieldProjection: Readonly<{
    source: typeof LOCAL_DEMO_YIELD_PROJECTION_SOURCE;
    calculationMethod: typeof LOCAL_DEMO_YIELD_CALCULATION_METHOD;
    effectiveApyBasisPoints: number;
    projectedAnnualYieldUsdMinor: string;
    projectedAnnualYieldAfterFeesUsdMinor: string;
    firstPositiveDayAfterFees: Readonly<{
      calculationMethod: typeof LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD;
      status: 'RECOVERED_WITHIN_HORIZON' | 'NO_PROJECTED_YIELD' | 'NOT_RECOVERED_WITHIN_HORIZON';
      day: number | null;
      modelHorizonDays: typeof LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS;
    }>;
  }>;
  readonly asOf: string;
}

interface InternalYieldPosition {
  readonly opportunity: LocalDemoYieldOpportunitySummary;
  readonly amountUsdMinor: bigint;
}

interface EcosystemCapital {
  readonly ecosystem: LocalDemoEcosystem;
  readonly amountUsdMinor: bigint;
}

interface EcosystemModeledCost {
  readonly ecosystem: LocalDemoEcosystem;
  readonly network: bigint;
  readonly conversion: bigint;
  readonly marketImpact: bigint;
  readonly platformRouting: bigint;
  readonly total: bigint;
}

interface ModeledCostPlan {
  readonly ecosystemCosts: readonly EcosystemModeledCost[];
  readonly routingFeePolicy: LocalDemoAllocationPreviewResponse['executionCost']['modeledScenario']['routingFeePolicy'];
}

interface ConvergenceCandidate {
  readonly executionCost: LocalDemoAllocationPreviewResponse['executionCost'];
  readonly managedCapitalByEcosystem: readonly EcosystemCapital[];
  readonly actualEcosystemCosts: readonly EcosystemModeledCost[];
  readonly capitalIncludedInProjection: bigint;
  readonly liquidReserveCapital: bigint;
  readonly retainedRoundingResidual: bigint;
}

interface ExactYieldProjection {
  readonly annualYieldNumerator: bigint;
  readonly denominator: bigint;
  readonly effectiveApyBasisPoints: number;
  readonly projectedAnnualYield: bigint;
}

/**
 * Projects an authenticated portfolio against server-only provider observations.
 * Browser responses expose only product-owned aggregate strategy data. The local
 * scenario performs no live request and creates no quote or financial action.
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
    expectedPortfolioSnapshotId: string,
    requestedSelection: LocalDemoAllocationSelection,
  ): Promise<LocalDemoAllocationPreviewResponse> {
    const selection = selectionDefinition(requestedSelection);
    const portfolio = await this.portfolio.read(accountId, correlation);
    if (portfolio.snapshotId !== expectedPortfolioSnapshotId) {
      throw new LocalDemoPortfolioSnapshotChangedError();
    }
    const grossCapital = BigInt(portfolio.buyingPower.amountUsdMinor);
    const catalogSelection = this.yieldCatalog.select(null);
    const opportunities = catalogSelection.selectedOpportunities;
    const sourceCapitalByEcosystem = ecosystemCapital(portfolio, grossCapital);
    const plan = convergePlan(
      portfolio,
      opportunities,
      sourceCapitalByEcosystem,
      grossCapital,
      selection.liquidReserveBasisPoints,
      catalogSelection.metadata.capturedAt,
    );
    const executionCost = plan.executionCost;
    const deductedModeledCost = BigInt(executionCost.modeledScenario.deductedFromGrossUsdMinor);
    const totalEstimatedFees = BigInt(executionCost.modeledScenario.totalUsdMinor);
    const retainedRoundingResidual = BigInt(
      executionCost.modeledScenario.retainedRoundingResidualUsdMinor,
    );
    const capitalIncludedInProjection = plan.capitalIncludedInProjection;
    if (
      capitalIncludedInProjection + deductedModeledCost + retainedRoundingResidual !==
      grossCapital
    ) {
      throw new TypeError('local demo retained capital does not reconcile');
    }
    const [liquidReserveCapital, managedYieldCapital] = requiredCapitalBuckets(
      capitalIncludedInProjection,
      selection.liquidReserveBasisPoints,
    );
    const managedCapitalByEcosystem = plan.managedCapitalByEcosystem;
    if (
      managedCapitalByEcosystem.reduce((sum, capital) => sum + capital.amountUsdMinor, 0n) !==
      managedYieldCapital
    ) {
      throw new TypeError('local demo converged managed capital does not reconcile');
    }
    const projectedPositions = positionsForCapital(opportunities, managedCapitalByEcosystem);
    const projection = calculateYieldProjection(projectedPositions, capitalIncludedInProjection);
    const firstPositiveDayAfterFees = calculateFirstPositiveDayAfterFees(
      projection,
      totalEstimatedFees,
    );
    const managedYieldComposition = publicManagedYieldComposition(
      managedCapitalByEcosystem,
      managedYieldCapital,
    );
    const activeEcosystemCount = managedCapitalByEcosystem.filter(
      ({ amountUsdMinor }) => amountUsdMinor > 0n,
    ).length;
    if (activeEcosystemCount !== 1 && activeEcosystemCount !== 2) {
      throw new TypeError('invalid local demo active ecosystem count');
    }

    return Object.freeze({
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
      portfolioSnapshotId: portfolio.snapshotId,
      selection,
      rateSnapshot: Object.freeze({
        id: catalogSelection.metadata.snapshotId,
        capturedAt: catalogSelection.metadata.capturedAt,
        staleAfter: catalogSelection.metadata.staleAfter,
        freshness: catalogSelection.metadata.freshness,
        staleBehavior: catalogSelection.metadata.staleBehavior,
        riskClassificationAvailable: false,
        riskClassification: catalogSelection.metadata.riskClassification,
      }),
      grossCapitalUsdMinor: grossCapital.toString(),
      sourceCapitalByEcosystem: Object.freeze(
        sourceCapitalByEcosystem.map(({ ecosystem, amountUsdMinor }) =>
          Object.freeze({ ecosystem, amountUsdMinor: amountUsdMinor.toString() }),
        ),
      ),
      allocations: Object.freeze([
        Object.freeze({
          bucket: 'LIQUID_RESERVE' as const,
          allocationId: 'LIQUID_RESERVE' as const,
          label: 'Liquid reserve' as const,
          percentageBasisPoints: selection.liquidReserveBasisPoints,
          amountUsdMinor: liquidReserveCapital.toString(),
        }),
        Object.freeze({
          bucket: 'MANAGED_YIELD' as const,
          allocationId: 'MANAGED_YIELD' as const,
          label: 'Managed yield' as const,
          percentageBasisPoints: 10_000 - selection.liquidReserveBasisPoints,
          amountUsdMinor: managedYieldCapital.toString(),
        }),
      ]),
      managedYieldComposition,
      compositionSummary: Object.freeze({
        mode:
          activeEcosystemCount === 2
            ? ('EVM_SOLANA_PORTFOLIO_BLEND' as const)
            : ('SINGLE_ECOSYSTEM' as const),
        crossEcosystemTransferRequired: false as const,
        crossEcosystemTransferUsdMinor: '0' as const,
        activeEcosystemCount,
      }),
      executionCost,
      capitalIncludedInProjectionUsdMinor: capitalIncludedInProjection.toString(),
      yieldProjection: Object.freeze({
        source: LOCAL_DEMO_YIELD_PROJECTION_SOURCE,
        calculationMethod: LOCAL_DEMO_YIELD_CALCULATION_METHOD,
        effectiveApyBasisPoints: projection.effectiveApyBasisPoints,
        projectedAnnualYieldUsdMinor: projection.projectedAnnualYield.toString(),
        projectedAnnualYieldAfterFeesUsdMinor: (
          projection.projectedAnnualYield - totalEstimatedFees
        ).toString(),
        firstPositiveDayAfterFees,
      }),
      asOf: portfolio.asOf,
    });
  }
}

export class LocalDemoPortfolioSnapshotChangedError extends Error {
  readonly code = 'PORTFOLIO_SNAPSHOT_CHANGED' as const;

  constructor() {
    super('The local demo portfolio changed before the preview was calculated');
    this.name = 'LocalDemoPortfolioSnapshotChangedError';
  }
}

function selectionDefinition(
  selection: LocalDemoAllocationSelection,
): LocalDemoAllocationPreviewResponse['selection'] {
  const values = exactSelectionValues(selection);
  if (values.kind !== 'PRESET') throw new TypeError('invalid local demo allocation selection');
  if (!LOCAL_DEMO_ALLOCATION_PRESET_IDS.includes(values.presetId as LocalDemoAllocationPresetId)) {
    throw new TypeError('unsupported local demo allocation preset');
  }
  if (
    !Number.isSafeInteger(values.liquidReserveBasisPoints) ||
    (values.liquidReserveBasisPoints as number) < 0 ||
    (values.liquidReserveBasisPoints as number) > LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS
  ) {
    throw new TypeError('invalid local demo liquid reserve basis points');
  }
  const liquidReserveBasisPoints = values.liquidReserveBasisPoints as number;
  const preset = PRESETS[values.presetId as LocalDemoAllocationPresetId];
  if (!preset) throw new TypeError('unsupported local demo allocation preset');
  return Object.freeze({
    kind: 'PRESET',
    presetId: preset.id,
    label: preset.label,
    description: `Keep ${formatPercentage(liquidReserveBasisPoints)} readily available and allocate the remainder to the managed yield strategy.`,
    liquidReserveBasisPoints,
  });
}

function exactSelectionValues(selection: unknown): Readonly<Record<string, unknown>> {
  const expectedKeys = ['kind', 'presetId', 'liquidReserveBasisPoints'] as const;
  try {
    if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) {
      throw new TypeError('invalid local demo allocation selection');
    }
    const prototype = Object.getPrototypeOf(selection) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('invalid local demo allocation selection');
    }
    const descriptors = Object.getOwnPropertyDescriptors(selection);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some(
        (key) => typeof key !== 'string' || !expectedKeys.some((expected) => expected === key),
      )
    ) {
      throw new TypeError('invalid local demo allocation selection');
    }
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new TypeError('invalid local demo allocation selection');
      }
      values[key] = descriptor.value;
    }
    return values;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError('invalid local demo allocation selection', { cause: error });
  }
}

function formatPercentage(basisPoints: number): string {
  const wholePercentage = Math.floor(basisPoints / 100);
  const fractionalPercentage = basisPoints % 100;
  if (fractionalPercentage === 0) return `${wholePercentage}%`;
  return `${wholePercentage}.${fractionalPercentage.toString().padStart(2, '0')}%`;
}

function positionsForCapital(
  opportunities: readonly LocalDemoYieldOpportunitySummary[],
  managedCapitalByEcosystem: readonly EcosystemCapital[],
): readonly InternalYieldPosition[] {
  const positions: InternalYieldPosition[] = [];
  for (const source of managedCapitalByEcosystem) {
    const candidates = opportunities.filter(
      (opportunity) => opportunity.ecosystem === source.ecosystem,
    );
    if (source.amountUsdMinor === 0n) continue;
    if (candidates.length < 1 || candidates.length > 2) {
      throw new TypeError('invalid local demo ecosystem opportunity selection');
    }
    // The best observed route is capped at 60% whenever a second eligible
    // route exists. This avoids the previous equal-split/top-APY behavior while
    // keeping the small local search deterministic and provider-confidential.
    const weights = candidates.length === 1 ? [10_000] : [6_000, 4_000];
    const capacities = candidates.map((opportunity) => {
      const exitLiquidity = BigInt(opportunity.exitLiquidity.amountUsdMinor);
      const tvl = BigInt(opportunity.tvl.amountUsdMinor);
      return exitLiquidity < tvl ? exitLiquidity : tvl;
    });
    const amounts = distributeLocalDemoCapitalWithinCapacities(
      source.amountUsdMinor,
      weights,
      capacities,
    );
    candidates.forEach((opportunity, index) => {
      positions.push(
        Object.freeze({ opportunity, amountUsdMinor: requiredAmount(amounts, index) }),
      );
    });
  }
  return Object.freeze(positions);
}

export function distributeLocalDemoCapitalWithinCapacities(
  total: bigint,
  basisPoints: readonly number[],
  capacities: readonly bigint[],
): readonly bigint[] {
  if (
    typeof total !== 'bigint' ||
    total < 0n ||
    capacities.length !== basisPoints.length ||
    capacities.length < 1 ||
    capacities.length > 2 ||
    capacities.some((capacity) => typeof capacity !== 'bigint' || capacity < 0n)
  ) {
    throw new TypeError('invalid local demo opportunity capacities');
  }

  const desiredAmounts = distribute(total, basisPoints);
  const amounts = desiredAmounts.map((desired, index) => {
    const capacity = requiredAmount(capacities, index);
    return desired < capacity ? desired : capacity;
  });
  let remaining = total - amounts.reduce((sum, amount) => sum + amount, 0n);
  for (let index = 0; index < amounts.length && remaining > 0n; index += 1) {
    const current = requiredAmount(amounts, index);
    const availableCapacity = requiredAmount(capacities, index) - current;
    const additional = remaining < availableCapacity ? remaining : availableCapacity;
    amounts[index] = current + additional;
    remaining -= additional;
  }
  if (remaining > 0n) throw new LocalDemoNoMatchingYieldOpportunitiesError();
  return Object.freeze(amounts);
}

function convergePlan(
  portfolio: LocalDemoPortfolioResponse,
  opportunities: readonly LocalDemoYieldOpportunitySummary[],
  sourceCapitalByEcosystem: readonly EcosystemCapital[],
  grossCapital: bigint,
  liquidReserveBasisPoints: number,
  rateSnapshotCapturedAt: string,
): Readonly<{
  executionCost: LocalDemoAllocationPreviewResponse['executionCost'];
  managedCapitalByEcosystem: readonly EcosystemCapital[];
  capitalIncludedInProjection: bigint;
}> {
  let estimatedEcosystemCosts = zeroEcosystemModeledCosts();
  const visitedCostStates = new Set([ecosystemCostStateKey(estimatedEcosystemCosts)]);
  const feasibleCandidates: ConvergenceCandidate[] = [];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const estimatedCost = estimatedEcosystemCosts.reduce((sum, cost) => sum + cost.total, 0n);
    if (estimatedCost >= grossCapital) {
      return bestFeasibleCandidate(feasibleCandidates, sourceCapitalByEcosystem);
    }
    const capitalAfterCost = grossCapital - estimatedCost;
    const [liquidReserveCapital, managedYieldCapital] = requiredCapitalBuckets(
      capitalAfterCost,
      liquidReserveBasisPoints,
    );
    if (managedYieldCapital === 0n) {
      throw new LocalDemoNoMatchingYieldOpportunitiesError();
    }
    const postModeledFeeCapacity = sourceCapitalByEcosystem.map((source) => {
      const modeledCost = requiredEcosystemCost(estimatedEcosystemCosts, source.ecosystem);
      if (modeledCost.total > source.amountUsdMinor) {
        throw new LocalDemoNoMatchingYieldOpportunitiesError();
      }
      return Object.freeze({
        ecosystem: source.ecosystem,
        amountUsdMinor: source.amountUsdMinor - modeledCost.total,
      });
    });
    const managedCapitalByEcosystem = apportionAcrossEcosystems(
      managedYieldCapital,
      postModeledFeeCapacity,
    );
    const positions = positionsForCapital(opportunities, managedCapitalByEcosystem);
    const modeledCostPlan = calculateModeledCostPlan(portfolio, positions, rateSnapshotCapturedAt);
    const nextEcosystemCosts = modeledCostPlan.ecosystemCosts;
    const actualDeductedCost = nextEcosystemCosts.reduce((sum, cost) => sum + cost.total, 0n);
    if (
      estimatedCost >= actualDeductedCost &&
      estimatedCost - actualDeductedCost <=
        BigInt(LOCAL_DEMO_MAX_RETAINED_ROUNDING_RESIDUAL_USD_MINOR)
    ) {
      const retainedRoundingResidual = estimatedCost - actualDeductedCost;
      if (
        ecosystemPlanIsSolvent(
          sourceCapitalByEcosystem,
          managedCapitalByEcosystem,
          nextEcosystemCosts,
          liquidReserveCapital,
          retainedRoundingResidual,
        )
      ) {
        feasibleCandidates.push(
          Object.freeze({
            executionCost: calculateExecutionCost(
              modeledCostPlan,
              grossCapital,
              retainedRoundingResidual,
            ),
            managedCapitalByEcosystem,
            actualEcosystemCosts: nextEcosystemCosts,
            capitalIncludedInProjection: capitalAfterCost,
            liquidReserveCapital,
            retainedRoundingResidual,
          }),
        );
      }
    }
    if (ecosystemCostsEqual(nextEcosystemCosts, estimatedEcosystemCosts)) {
      return bestFeasibleCandidate(feasibleCandidates, sourceCapitalByEcosystem);
    }
    const nextCostState = ecosystemCostStateKey(nextEcosystemCosts);
    if (visitedCostStates.has(nextCostState)) {
      return bestFeasibleCandidate(feasibleCandidates, sourceCapitalByEcosystem);
    }
    visitedCostStates.add(nextCostState);
    estimatedEcosystemCosts = nextEcosystemCosts;
  }
  return bestFeasibleCandidate(feasibleCandidates, sourceCapitalByEcosystem);
}

function ecosystemCostStateKey(costs: readonly EcosystemModeledCost[]): string {
  return LOCAL_DEMO_ECOSYSTEMS.map((ecosystem) =>
    requiredEcosystemCost(costs, ecosystem).total.toString(),
  ).join(':');
}

function bestFeasibleCandidate(
  candidates: readonly ConvergenceCandidate[],
  sourceCapitalByEcosystem: readonly EcosystemCapital[],
): Readonly<{
  executionCost: LocalDemoAllocationPreviewResponse['executionCost'];
  managedCapitalByEcosystem: readonly EcosystemCapital[];
  capitalIncludedInProjection: bigint;
}> {
  const candidate = [...candidates].sort((left, right) => {
    const leftManaged = left.managedCapitalByEcosystem.reduce(
      (sum, capital) => sum + capital.amountUsdMinor,
      0n,
    );
    const rightManaged = right.managedCapitalByEcosystem.reduce(
      (sum, capital) => sum + capital.amountUsdMinor,
      0n,
    );
    if (leftManaged !== rightManaged) return leftManaged > rightManaged ? -1 : 1;
    if (left.retainedRoundingResidual !== right.retainedRoundingResidual) {
      return left.retainedRoundingResidual < right.retainedRoundingResidual ? -1 : 1;
    }
    return 0;
  })[0];
  if (candidate === undefined) throw new LocalDemoNoMatchingYieldOpportunitiesError();
  assertEcosystemSolvency(
    sourceCapitalByEcosystem,
    candidate.managedCapitalByEcosystem,
    candidate.actualEcosystemCosts,
    candidate.liquidReserveCapital,
    candidate.retainedRoundingResidual,
  );
  return Object.freeze({
    executionCost: candidate.executionCost,
    managedCapitalByEcosystem: candidate.managedCapitalByEcosystem,
    capitalIncludedInProjection: candidate.capitalIncludedInProjection,
  });
}

function zeroEcosystemModeledCosts(): readonly EcosystemModeledCost[] {
  return Object.freeze(
    LOCAL_DEMO_ECOSYSTEMS.map((ecosystem) =>
      Object.freeze({
        ecosystem,
        network: 0n,
        conversion: 0n,
        marketImpact: 0n,
        platformRouting: 0n,
        total: 0n,
      }),
    ),
  );
}

function requiredEcosystemCost(
  costs: readonly EcosystemModeledCost[],
  ecosystem: LocalDemoEcosystem,
): EcosystemModeledCost {
  const cost = costs.find((candidate) => candidate.ecosystem === ecosystem);
  if (cost === undefined) throw new TypeError('missing local demo ecosystem modeled cost');
  return cost;
}

function ecosystemCostsEqual(
  left: readonly EcosystemModeledCost[],
  right: readonly EcosystemModeledCost[],
): boolean {
  return LOCAL_DEMO_ECOSYSTEMS.every(
    (ecosystem) =>
      requiredEcosystemCost(left, ecosystem).total ===
      requiredEcosystemCost(right, ecosystem).total,
  );
}

function calculateExecutionCost(
  modeledCostPlan: ModeledCostPlan,
  grossCapital: bigint,
  retainedRoundingResidual: bigint,
): LocalDemoAllocationPreviewResponse['executionCost'] {
  const ecosystemCosts = modeledCostPlan.ecosystemCosts;
  const network = sumEcosystemCost(ecosystemCosts, 'network');
  const conversion = sumEcosystemCost(ecosystemCosts, 'conversion');
  const marketImpact = sumEcosystemCost(ecosystemCosts, 'marketImpact');
  const platformRouting = sumEcosystemCost(ecosystemCosts, 'platformRouting');
  const components = Object.freeze([
    costComponent(
      'NETWORK',
      'Estimated network costs',
      'NETWORK_ACTIVATION_AND_POSITION_VOLUME',
      'DEDUCTED_FROM_GROSS',
      network,
    ),
    costComponent(
      'CONVERSION',
      'Estimated conversion costs',
      'TWELVE_BPS_OF_REQUIRED_CONVERSION',
      'DEDUCTED_FROM_GROSS',
      conversion,
    ),
    costComponent(
      'CROSS_ECOSYSTEM_TRANSFER',
      'Estimated EVM-Solana transfer costs',
      'NO_CROSS_ECOSYSTEM_TRANSFER',
      'DEDUCTED_FROM_GROSS',
      0n,
    ),
    costComponent(
      'MARKET_IMPACT',
      'Estimated market impact',
      'POSITION_SIZE_AND_UTILIZATION',
      'DEDUCTED_FROM_GROSS',
      marketImpact,
    ),
    costComponent(
      'PLATFORM_ROUTING',
      'Estimated platform routing fee',
      'CANONICAL_PLATFORM_ROUTING_RULE_V1',
      'ADDED_ON_TOP',
      platformRouting,
    ),
  ]);
  const deductedFromGross = components
    .filter(({ fundingTreatment }) => fundingTreatment === 'DEDUCTED_FROM_GROSS')
    .reduce((sum, component) => sum + BigInt(component.amountUsdMinor), 0n);
  const addedOnTop = components
    .filter(({ fundingTreatment }) => fundingTreatment === 'ADDED_ON_TOP')
    .reduce((sum, component) => sum + BigInt(component.amountUsdMinor), 0n);
  const total = deductedFromGross + addedOnTop;
  return Object.freeze({
    actualLocalOperation: Object.freeze({ status: 'NO_EXECUTION', amountUsdMinor: '0' }),
    modeledScenario: Object.freeze({
      status: 'AVAILABLE',
      modelId: LOCAL_DEMO_EXECUTION_COST_MODEL,
      isQuote: false,
      costBasisCapitalUsdMinor: grossCapital.toString(),
      fundingTreatment: 'MIXED_DEDUCT_FROM_GROSS_AND_ADD_ON_TOP',
      rounding: 'CEIL_VARIABLE_COMPONENTS_PLATFORM_FEE_HALF_EVEN',
      routingFeePolicy: modeledCostPlan.routingFeePolicy,
      components,
      deductedFromGrossUsdMinor: deductedFromGross.toString(),
      addedOnTopUsdMinor: addedOnTop.toString(),
      retainedRoundingResidualUsdMinor: retainedRoundingResidual.toString(),
      totalUsdMinor: total.toString(),
      requiredCapitalIncludingAddedOnTopUsdMinor: (grossCapital + addedOnTop).toString(),
    }),
    publicExecution: Object.freeze({ status: 'UNQUOTED', amountUsdMinor: null }),
  });
}

function calculateModeledCostPlan(
  portfolio: LocalDemoPortfolioResponse,
  positions: readonly InternalYieldPosition[],
  rateSnapshotCapturedAt: string,
): ModeledCostPlan {
  const activePositions = positions.filter((position) => position.amountUsdMinor > 0n);
  const managedCapital = activePositions.reduce(
    (total, position) => total + position.amountUsdMinor,
    0n,
  );
  const platformRoutingFee = calculateCanonicalPlatformRoutingFee(
    portfolio,
    activePositions,
    managedCapital,
    rateSnapshotCapturedAt,
  );
  const managedCapitalByEcosystem = LOCAL_DEMO_ECOSYSTEMS.map((ecosystem) =>
    activePositions
      .filter((position) => position.opportunity.ecosystem === ecosystem)
      .reduce((total, position) => total + position.amountUsdMinor, 0n),
  );
  const platformRoutingByEcosystem = distributeByAmounts(
    platformRoutingFee.amountUsdMinor,
    managedCapitalByEcosystem,
  );
  const ecosystemCosts = Object.freeze(
    LOCAL_DEMO_ECOSYSTEMS.map((ecosystem) => {
      const ecosystemPositions = activePositions.filter(
        (position) => position.amountUsdMinor > 0n && position.opportunity.ecosystem === ecosystem,
      );
      const activeNetworks = new Set(
        ecosystemPositions.map(({ opportunity }) => opportunity.network.id),
      );
      const networkActivation = [...activeNetworks].reduce(
        (total, networkId) => total + NETWORK_ACTIVATION_COST_USD_MINOR[networkId],
        0n,
      );
      const networkVolume = ecosystemPositions.reduce(
        (total, position) =>
          total +
          percentageCost(
            position.amountUsdMinor,
            NETWORK_POSITION_VOLUME_BASIS_POINTS[position.opportunity.network.id],
          ),
        0n,
      );
      const network = networkActivation + networkVolume;
      const conversion = percentageCost(
        requiredConversionAmount(portfolio, ecosystemPositions, ecosystem),
        CONVERSION_COST_BASIS_POINTS,
      );
      const marketImpact = ecosystemPositions.reduce((total, position) => {
        const utilizationExcess = Math.max(
          0,
          position.opportunity.utilization.basisPoints -
            MARKET_IMPACT_UTILIZATION_THRESHOLD_BASIS_POINTS,
        );
        const utilizationPremium = Math.ceil(
          utilizationExcess / MARKET_IMPACT_UTILIZATION_STEP_BASIS_POINTS,
        );
        return (
          total +
          percentageCost(
            position.amountUsdMinor,
            MARKET_IMPACT_BASE_BASIS_POINTS + utilizationPremium,
          )
        );
      }, 0n);
      const ecosystemIndex = LOCAL_DEMO_ECOSYSTEMS.indexOf(ecosystem);
      const platformRouting = requiredAmount(platformRoutingByEcosystem, ecosystemIndex);
      return Object.freeze({
        ecosystem,
        network,
        conversion,
        marketImpact,
        platformRouting,
        total: network + conversion + marketImpact,
      });
    }),
  );
  return Object.freeze({
    ecosystemCosts,
    routingFeePolicy: Object.freeze({
      tier: 'FREE',
      classification: platformRoutingFee.classification,
      ruleVersion: 1,
    }),
  });
}

function calculateCanonicalPlatformRoutingFee(
  portfolio: LocalDemoPortfolioResponse,
  activePositions: readonly InternalYieldPosition[],
  managedCapital: bigint,
  rateSnapshotCapturedAt: string,
): Readonly<{
  amountUsdMinor: bigint;
  classification: RoutingFeeRouteClassificationKind;
}> {
  if (managedCapital <= 0n || activePositions.length < 1) {
    throw new LocalDemoNoMatchingYieldOpportunitiesError();
  }
  const snapshot = calculateRoutingFeeSnapshotV1({
    schemaVersion: 1,
    // These private IDs identify the deterministic, non-quote local model
    // input. They are never returned as public route or provider metadata.
    quoteReferenceId: LOCAL_DEMO_ROUTING_FEE_QUOTE_REFERENCE_ID,
    routeReferenceId: LOCAL_DEMO_ROUTING_FEE_ROUTE_REFERENCE_ID,
    quotedAt: rateSnapshotCapturedAt,
    tier: 'FREE',
    route: routingFeeRouteForPlan(portfolio, activePositions),
    feeBase: {
      assetRevisionId: LOCAL_DEMO_USD_MINOR_ASSET_REVISION_ID,
      amountAtomic: managedCapital.toString(),
    },
    passThroughComponents: [],
  });
  const platformComponent = snapshot.components[0];
  if (
    snapshot.effectiveTier !== 'FREE' ||
    ROUTING_FEE_RULE_V1.version !== 1 ||
    snapshot.rule.version !== ROUTING_FEE_RULE_V1.version ||
    platformComponent === undefined ||
    platformComponent.category !== 'PLATFORM' ||
    platformComponent.assetRevisionId !== LOCAL_DEMO_USD_MINOR_ASSET_REVISION_ID
  ) {
    throw new TypeError('invalid local demo canonical routing fee result');
  }
  return Object.freeze({
    amountUsdMinor: BigInt(platformComponent.amountAtomic),
    classification: snapshot.routeClassification.kind,
  });
}

function routingFeeRouteForPlan(
  portfolio: LocalDemoPortfolioResponse,
  activePositions: readonly InternalYieldPosition[],
): RoutingFeeRouteV1 {
  const sourceByIdentity = new Map<string, RoutingFeeRouteEndpointV1>();
  for (const wallet of portfolio.wallets) {
    for (const chain of wallet.chains) {
      for (const asset of chain.assets) {
        if (BigInt(asset.buyingPowerUsdMinor) <= 0n) continue;
        const endpoint = Object.freeze({
          networkId: chain.networkId,
          assetId: asset.assetIdentity,
        });
        sourceByIdentity.set(routeEndpointKey(endpoint), endpoint);
      }
    }
  }
  const sources = [...sourceByIdentity.values()].sort(compareRouteEndpoints);
  const destinations = activePositions.map(({ opportunity }) =>
    Object.freeze({
      networkId: opportunity.network.id,
      assetId: opportunity.asset.contract,
    }),
  );
  const firstDestination = destinations[0];
  if (sources.length < 1 || firstDestination === undefined) {
    throw new LocalDemoNoMatchingYieldOpportunitiesError();
  }
  const soleSource = sources.length === 1 ? sources[0] : undefined;
  if (
    soleSource !== undefined &&
    destinations.length === 1 &&
    sameRouteEndpoint(soleSource, firstDestination)
  ) {
    const directLeg = Object.freeze({
      kind: 'DIRECT_SETTLEMENT' as const,
      source: soleSource,
      destination: firstDestination,
    });
    return Object.freeze({
      schemaVersion: 1,
      source: soleSource,
      destination: firstDestination,
      legs: Object.freeze([directLeg]),
    });
  }

  // A route is free only when the complete modeled plan is one exact direct
  // settlement. Multiple sources or positions are material orchestration even
  // when one individual leg happens to preserve network and asset identity.
  const routeSource =
    sources.find((source) => !sameRouteEndpoint(source, firstDestination)) ?? sources[0]!;
  const legs: RoutingFeeRouteLegV1[] = [];
  let current = routeSource;
  for (const destination of destinations) {
    appendCanonicalRouteLegs(legs, current, destination);
    current = destination;
  }
  return Object.freeze({
    schemaVersion: 1,
    source: routeSource,
    destination: current,
    legs: Object.freeze(legs),
  });
}

function appendCanonicalRouteLegs(
  legs: RoutingFeeRouteLegV1[],
  source: RoutingFeeRouteEndpointV1,
  destination: RoutingFeeRouteEndpointV1,
): void {
  if (sameRouteEndpoint(source, destination)) {
    legs.push(Object.freeze({ kind: 'DIRECT_SETTLEMENT', source, destination }));
    return;
  }
  if (source.networkId === destination.networkId) {
    legs.push(Object.freeze({ kind: 'SWAP', source, destination }));
    return;
  }
  if (source.assetId === destination.assetId) {
    legs.push(Object.freeze({ kind: 'BRIDGE', source, destination }));
    return;
  }
  const convertedSource = Object.freeze({
    networkId: source.networkId,
    assetId: destination.assetId,
  });
  legs.push(Object.freeze({ kind: 'SWAP', source, destination: convertedSource }));
  legs.push(Object.freeze({ kind: 'BRIDGE', source: convertedSource, destination }));
}

function routeEndpointKey(endpoint: RoutingFeeRouteEndpointV1): string {
  return `${endpoint.networkId}\u0000${endpoint.assetId}`;
}

function sameRouteEndpoint(
  left: RoutingFeeRouteEndpointV1,
  right: RoutingFeeRouteEndpointV1,
): boolean {
  return left.networkId === right.networkId && left.assetId === right.assetId;
}

function compareRouteEndpoints(
  left: RoutingFeeRouteEndpointV1,
  right: RoutingFeeRouteEndpointV1,
): number {
  return routeEndpointKey(left).localeCompare(routeEndpointKey(right));
}

function sumEcosystemCost(
  costs: readonly EcosystemModeledCost[],
  key: 'network' | 'conversion' | 'marketImpact' | 'platformRouting',
): bigint {
  return costs.reduce((sum, cost) => sum + cost[key], 0n);
}

function assertEcosystemSolvency(
  sources: readonly EcosystemCapital[],
  managedCapital: readonly EcosystemCapital[],
  costs: readonly EcosystemModeledCost[],
  expectedLiquidReserve: bigint,
  expectedRetainedRoundingResidual: bigint,
): void {
  let unallocatedCapital = 0n;
  for (const ecosystem of LOCAL_DEMO_ECOSYSTEMS) {
    const source = sources.find((candidate) => candidate.ecosystem === ecosystem);
    const managed = managedCapital.find((candidate) => candidate.ecosystem === ecosystem);
    const cost = costs.find((candidate) => candidate.ecosystem === ecosystem);
    if (
      source === undefined ||
      managed === undefined ||
      cost === undefined ||
      managed.amountUsdMinor + cost.total > source.amountUsdMinor
    ) {
      throw new LocalDemoNoMatchingYieldOpportunitiesError();
    }
    unallocatedCapital += source.amountUsdMinor - managed.amountUsdMinor - cost.total;
  }
  if (unallocatedCapital !== expectedLiquidReserve + expectedRetainedRoundingResidual) {
    throw new TypeError('local demo ecosystem capital does not reconcile after modeled costs');
  }
}

function ecosystemPlanIsSolvent(
  sources: readonly EcosystemCapital[],
  managedCapital: readonly EcosystemCapital[],
  costs: readonly EcosystemModeledCost[],
  expectedLiquidReserve: bigint,
  expectedRetainedRoundingResidual: bigint,
): boolean {
  try {
    assertEcosystemSolvency(
      sources,
      managedCapital,
      costs,
      expectedLiquidReserve,
      expectedRetainedRoundingResidual,
    );
    return true;
  } catch (error) {
    if (error instanceof LocalDemoNoMatchingYieldOpportunitiesError || error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

function costComponent(
  code: LocalDemoExecutionCostComponentCode,
  label: string,
  calculationBasis: LocalDemoExecutionCostBasis,
  fundingTreatment: LocalDemoExecutionCostFundingTreatment,
  amountUsdMinor: bigint,
): LocalDemoAllocationPreviewResponse['executionCost']['modeledScenario']['components'][number] {
  return Object.freeze({
    code,
    label,
    calculationBasis,
    fundingTreatment,
    amountUsdMinor: amountUsdMinor.toString(),
  });
}

function requiredConversionAmount(
  portfolio: LocalDemoPortfolioResponse,
  positions: readonly InternalYieldPosition[],
  ecosystem: LocalDemoEcosystem,
): bigint {
  const availableByAsset = new Map<string, bigint>();
  for (const wallet of portfolio.wallets) {
    if (wallet.namespace !== ecosystem) continue;
    for (const chain of wallet.chains) {
      for (const asset of chain.assets) {
        const key = ecosystemAssetKey(wallet.namespace, asset.stablecoin);
        availableByAsset.set(
          key,
          (availableByAsset.get(key) ?? 0n) + BigInt(asset.buyingPowerUsdMinor),
        );
      }
    }
  }
  const requiredByAsset = new Map<string, bigint>();
  for (const position of positions) {
    const key = ecosystemAssetKey(
      position.opportunity.ecosystem,
      position.opportunity.asset.symbol,
    );
    requiredByAsset.set(key, (requiredByAsset.get(key) ?? 0n) + position.amountUsdMinor);
  }
  return [...requiredByAsset].reduce((total, [key, required]) => {
    const available = availableByAsset.get(key) ?? 0n;
    return total + (required > available ? required - available : 0n);
  }, 0n);
}

function ecosystemAssetKey(ecosystem: LocalDemoEcosystem, symbol: string): string {
  return `${ecosystem}:${symbol}`;
}

function percentageCost(amountUsdMinor: bigint, basisPoints: number): bigint {
  if (amountUsdMinor < 0n || !Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new TypeError('invalid local demo cost input');
  }
  if (amountUsdMinor === 0n || basisPoints === 0) return 0n;
  return (amountUsdMinor * BigInt(basisPoints) + 9_999n) / 10_000n;
}

function calculateYieldProjection(
  positions: readonly InternalYieldPosition[],
  capitalIncludedInProjection: bigint,
): ExactYieldProjection {
  const rates = positions.map(({ opportunity }) => decimalRatio(opportunity.apy.baseRateDecimal));
  const maximumScale = rates.reduce(
    (maximum, { fractionalDigits }) => Math.max(maximum, fractionalDigits),
    0,
  );
  const denominator = 10n ** BigInt(maximumScale);
  const annualYieldNumerator = positions.reduce((total, position, index) => {
    const rate = rates[index];
    if (rate === undefined) throw new TypeError('missing local demo APY rate');
    const scaledRate = rate.numerator * 10n ** BigInt(maximumScale - rate.fractionalDigits);
    return total + position.amountUsdMinor * scaledRate;
  }, 0n);
  const exactEffectiveApy =
    capitalIncludedInProjection === 0n
      ? 0n
      : (annualYieldNumerator * 10_000n) / (capitalIncludedInProjection * denominator);
  if (exactEffectiveApy > BigInt(Number.MAX_SAFE_INTEGER) || exactEffectiveApy > 10_000n) {
    throw new TypeError('local demo effective APY exceeds numeric limits');
  }
  // Ranking, capacity checks, and position construction retain the exact
  // server-confidential rates. The public projection deliberately floors the
  // aggregate to a product-owned 25 bps bucket so exact cents cannot be used
  // to fingerprint the selected providers from their public market rates.
  const bucketSize = BigInt(LOCAL_DEMO_PUBLIC_APY_BUCKET_SIZE_BASIS_POINTS);
  const effectiveApy = exactEffectiveApy - (exactEffectiveApy % bucketSize);
  const publicDenominator = 10_000n;
  const publicAnnualYieldNumerator = capitalIncludedInProjection * effectiveApy;
  const projectedAnnualYield = publicAnnualYieldNumerator / publicDenominator;
  return Object.freeze({
    annualYieldNumerator: publicAnnualYieldNumerator,
    denominator: publicDenominator,
    effectiveApyBasisPoints: Number(effectiveApy),
    projectedAnnualYield,
  });
}

function calculateFirstPositiveDayAfterFees(
  projection: ExactYieldProjection,
  totalEstimatedCostUsdMinor: bigint,
): LocalDemoAllocationPreviewResponse['yieldProjection']['firstPositiveDayAfterFees'] {
  if (projection.annualYieldNumerator === 0n) {
    return Object.freeze({
      calculationMethod: LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD,
      status: 'NO_PROJECTED_YIELD',
      day: null,
      modelHorizonDays: LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS,
    });
  }
  const firstPositiveDay = ceilingDivide(
    (totalEstimatedCostUsdMinor + 1n) * 365n * projection.denominator,
    projection.annualYieldNumerator,
  );
  if (firstPositiveDay > BigInt(LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS)) {
    return Object.freeze({
      calculationMethod: LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD,
      status: 'NOT_RECOVERED_WITHIN_HORIZON',
      day: null,
      modelHorizonDays: LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS,
    });
  }
  return Object.freeze({
    calculationMethod: LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD,
    status: 'RECOVERED_WITHIN_HORIZON',
    day: Number(firstPositiveDay),
    modelHorizonDays: LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS,
  });
}

function ceilingDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new TypeError('invalid local demo division');
  return (numerator + denominator - 1n) / denominator;
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

function requiredCapitalBuckets(
  total: bigint,
  liquidReserveBasisPoints: number,
): readonly [bigint, bigint] {
  const amounts = distribute(total, [liquidReserveBasisPoints, 10_000 - liquidReserveBasisPoints]);
  const liquidReserve = amounts[0];
  const managedYield = amounts[1];
  if (liquidReserve === undefined || managedYield === undefined) {
    throw new TypeError('missing local demo capital bucket');
  }
  return Object.freeze([liquidReserve, managedYield]);
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

function ecosystemCapital(
  portfolio: LocalDemoPortfolioResponse,
  grossCapital: bigint,
): readonly EcosystemCapital[] {
  const result = LOCAL_DEMO_ECOSYSTEMS.map((ecosystem) =>
    Object.freeze({
      ecosystem,
      amountUsdMinor: portfolio.wallets
        .filter(({ namespace }) => namespace === ecosystem)
        .reduce((sum, wallet) => sum + BigInt(wallet.buyingPowerUsdMinor), 0n),
    }),
  );
  if (result.reduce((sum, { amountUsdMinor }) => sum + amountUsdMinor, 0n) !== grossCapital) {
    throw new TypeError('local demo ecosystem capital does not reconcile');
  }
  return Object.freeze(result);
}

function apportionAcrossEcosystems(
  total: bigint,
  sourceCapital: readonly EcosystemCapital[],
): readonly EcosystemCapital[] {
  const amounts = distributeByAmounts(
    total,
    sourceCapital.map(({ amountUsdMinor }) => amountUsdMinor),
  );
  return Object.freeze(
    sourceCapital.map(({ ecosystem }, index) =>
      Object.freeze({ ecosystem, amountUsdMinor: requiredAmount(amounts, index) }),
    ),
  );
}

function publicManagedYieldComposition(
  managedCapital: readonly EcosystemCapital[],
  managedYieldCapital: bigint,
): LocalDemoAllocationPreviewResponse['managedYieldComposition'] {
  const basisPoints = distributeByAmounts(
    10_000n,
    managedCapital.map(({ amountUsdMinor }) => amountUsdMinor),
  );
  if (
    managedCapital.reduce((sum, { amountUsdMinor }) => sum + amountUsdMinor, 0n) !==
      managedYieldCapital ||
    basisPoints.reduce((sum, value) => sum + value, 0n) !== 10_000n
  ) {
    throw new TypeError('invalid local demo managed yield composition');
  }
  return Object.freeze(
    managedCapital.map(({ ecosystem, amountUsdMinor }, index) =>
      Object.freeze({
        ecosystem,
        label:
          ecosystem === 'EVM' ? ('EVM managed yield' as const) : ('SVM managed yield' as const),
        percentageBasisPointsOfManagedYield: Number(requiredAmount(basisPoints, index)),
        amountUsdMinor: amountUsdMinor.toString(),
      }),
    ),
  );
}

/** Largest-remainder apportionment using arbitrary non-negative integer weights. */
function distributeByAmounts(total: bigint, weights: readonly bigint[]): readonly bigint[] {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total < 0n || weights.length < 1 || weights.some((weight) => weight < 0n)) {
    throw new TypeError('invalid local demo amount distribution');
  }
  if (denominator === 0n) {
    if (total !== 0n) throw new TypeError('invalid local demo zero-weight distribution');
    return Object.freeze(weights.map(() => 0n));
  }
  const amounts = weights.map((weight) => (total * weight) / denominator);
  const remainders = weights.map((weight, index) => ({
    index,
    value: (total * weight) % denominator,
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
  if (undistributed !== 0n) throw new TypeError('invalid local demo amount distribution');
  return Object.freeze(amounts);
}
