import { Injectable } from '@nestjs/common';

import type { AccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
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
}>;

export const LOCAL_DEMO_YIELD_PROJECTION_SOURCE = 'MANAGED_RATE_SNAPSHOT' as const;
export const LOCAL_DEMO_YIELD_CALCULATION_METHOD =
  'INTERNAL_POSITION_WEIGHTED_EXACT_BASE_APY' as const;
export const LOCAL_DEMO_EXECUTION_COST_MODEL = 'LOCAL_DEMO_ALLOCATION_COST_V2' as const;
export const LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD =
  'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES' as const;
export const LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS = 365 as const;

export const LOCAL_DEMO_EXECUTION_COST_COMPONENTS = Object.freeze([
  'NETWORK',
  'CONVERSION',
  'CROSS_ECOSYSTEM_TRANSFER',
  'MARKET_IMPACT',
  'ROUTING',
] as const);

export type LocalDemoExecutionCostComponentCode =
  (typeof LOCAL_DEMO_EXECUTION_COST_COMPONENTS)[number];

type LocalDemoExecutionCostBasis =
  | 'NETWORK_ACTIVATION_AND_POSITION_VOLUME'
  | 'TWELVE_BPS_OF_REQUIRED_CONVERSION'
  | 'NO_CROSS_ECOSYSTEM_TRANSFER'
  | 'POSITION_SIZE_AND_UTILIZATION'
  | 'TWENTY_CENTS_PER_ACTIVE_ALLOCATION';

export const LOCAL_DEMO_ECOSYSTEMS = Object.freeze(['EVM', 'SOLANA'] as const);
export type LocalDemoEcosystem = (typeof LOCAL_DEMO_ECOSYSTEMS)[number];

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
      description:
        'Keep 60% readily available and allocate the remainder to the managed yield strategy.',
      liquidReserveBasisPoints: 6_000,
    }),
    BALANCED: Object.freeze({
      id: 'BALANCED',
      label: 'Balanced blend',
      description:
        'Keep 30% readily available and allocate the remainder to the managed yield strategy.',
      liquidReserveBasisPoints: 3_000,
    }),
    MORE_YIELD: Object.freeze({
      id: 'MORE_YIELD',
      label: 'More yield',
      description:
        'Keep 15% readily available and allocate the remainder to the managed yield strategy.',
      liquidReserveBasisPoints: 1_500,
    }),
  });

const NETWORK_ACTIVATION_COST_USD_MINOR: Readonly<Record<LocalDemoYieldNetworkId, bigint>> =
  Object.freeze({
    'eip155:1': 150n,
    'eip155:8453': 25n,
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 1n,
  });
const NETWORK_POSITION_VOLUME_BASIS_POINTS: Readonly<Record<LocalDemoYieldNetworkId, number>> =
  Object.freeze({
    'eip155:1': 8,
    'eip155:8453': 4,
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 1,
  });
const CONVERSION_COST_BASIS_POINTS = 12;
const ROUTING_COST_PER_ACTIVE_ALLOCATION_USD_MINOR = 20n;
const MARKET_IMPACT_BASE_BASIS_POINTS = 1;
const MARKET_IMPACT_UTILIZATION_THRESHOLD_BASIS_POINTS = 8_500;
const MARKET_IMPACT_UTILIZATION_STEP_BASIS_POINTS = 500;

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
    activeAllocationCount: number;
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
      fundingTreatment: 'DEDUCT_FROM_GROSS_BEFORE_PROJECTION';
      rounding: 'CEIL_EACH_VARIABLE_COMPONENT_TO_USD_MINOR';
      components: readonly Readonly<{
        code: LocalDemoExecutionCostComponentCode;
        label: string;
        calculationBasis: LocalDemoExecutionCostBasis;
        amountUsdMinor: string;
      }>[];
      totalUsdMinor: string;
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
  readonly routing: bigint;
  readonly total: bigint;
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
    const portfolio = await this.portfolio.read(accountId, correlation);
    if (portfolio.snapshotId !== expectedPortfolioSnapshotId) {
      throw new LocalDemoPortfolioSnapshotChangedError();
    }
    const grossCapital = BigInt(portfolio.buyingPower.amountUsdMinor);
    const selection = selectionDefinition(requestedSelection);
    const catalogSelection = this.yieldCatalog.select(null);
    const opportunities = catalogSelection.selectedOpportunities;
    const sourceCapitalByEcosystem = ecosystemCapital(portfolio, grossCapital);
    const plan = convergePlan(
      portfolio,
      opportunities,
      sourceCapitalByEcosystem,
      grossCapital,
      selection.liquidReserveBasisPoints,
    );
    const executionCost = plan.executionCost;
    const estimatedCost = BigInt(executionCost.modeledScenario.totalUsdMinor);
    const capitalIncludedInProjection = grossCapital - estimatedCost;
    const [liquidReserveCapital, managedYieldCapital] = requiredCapitalBuckets(
      capitalIncludedInProjection,
      selection.liquidReserveBasisPoints,
    );
    const managedCapitalByEcosystem = apportionAcrossEcosystems(
      managedYieldCapital,
      sourceCapitalByEcosystem,
    );
    const projectedPositions = positionsForCapital(opportunities, managedCapitalByEcosystem);
    const projection = calculateYieldProjection(projectedPositions, capitalIncludedInProjection);
    const firstPositiveDayAfterFees = calculateFirstPositiveDayAfterFees(projection, estimatedCost);
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
        activeAllocationCount: projectedPositions.filter(
          ({ amountUsdMinor }) => amountUsdMinor > 0n,
        ).length,
      }),
      executionCost,
      capitalIncludedInProjectionUsdMinor: capitalIncludedInProjection.toString(),
      yieldProjection: Object.freeze({
        source: LOCAL_DEMO_YIELD_PROJECTION_SOURCE,
        calculationMethod: LOCAL_DEMO_YIELD_CALCULATION_METHOD,
        effectiveApyBasisPoints: projection.effectiveApyBasisPoints,
        projectedAnnualYieldUsdMinor: projection.projectedAnnualYield.toString(),
        projectedAnnualYieldAfterFeesUsdMinor: (
          projection.projectedAnnualYield - estimatedCost
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
  if (selection.kind !== 'PRESET') throw new TypeError('invalid local demo allocation selection');
  const preset = PRESETS[selection.presetId];
  if (!preset) throw new TypeError('unsupported local demo allocation preset');
  return Object.freeze({
    kind: 'PRESET',
    presetId: preset.id,
    label: preset.label,
    description: preset.description,
    liquidReserveBasisPoints: preset.liquidReserveBasisPoints,
  });
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
    const amounts = distribute(source.amountUsdMinor, weights);
    candidates.forEach((opportunity, index) => {
      positions.push(
        Object.freeze({ opportunity, amountUsdMinor: requiredAmount(amounts, index) }),
      );
    });
  }
  return Object.freeze(positions);
}

function convergePlan(
  portfolio: LocalDemoPortfolioResponse,
  opportunities: readonly LocalDemoYieldOpportunitySummary[],
  sourceCapitalByEcosystem: readonly EcosystemCapital[],
  grossCapital: bigint,
  liquidReserveBasisPoints: number,
): Readonly<{
  executionCost: LocalDemoAllocationPreviewResponse['executionCost'];
}> {
  let estimatedCost = 0n;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    if (estimatedCost >= grossCapital) {
      throw new TypeError('local demo modeled cost exhausts capital');
    }
    const capitalAfterCost = grossCapital - estimatedCost;
    const [, managedYieldCapital] = requiredCapitalBuckets(
      capitalAfterCost,
      liquidReserveBasisPoints,
    );
    const managedCapitalByEcosystem = apportionAcrossEcosystems(
      managedYieldCapital,
      sourceCapitalByEcosystem,
    );
    const positions = positionsForCapital(opportunities, managedCapitalByEcosystem);
    const executionCost = calculateExecutionCost(portfolio, positions, grossCapital);
    const nextCost = BigInt(executionCost.modeledScenario.totalUsdMinor);
    if (nextCost === estimatedCost) {
      assertEcosystemSolvency(
        sourceCapitalByEcosystem,
        managedCapitalByEcosystem,
        calculateEcosystemModeledCosts(portfolio, positions),
      );
      return Object.freeze({ executionCost });
    }
    estimatedCost = nextCost;
  }
  throw new TypeError('local demo modeled cost did not converge');
}

function calculateExecutionCost(
  portfolio: LocalDemoPortfolioResponse,
  positions: readonly InternalYieldPosition[],
  grossCapital: bigint,
): LocalDemoAllocationPreviewResponse['executionCost'] {
  const ecosystemCosts = calculateEcosystemModeledCosts(portfolio, positions);
  const network = sumEcosystemCost(ecosystemCosts, 'network');
  const conversion = sumEcosystemCost(ecosystemCosts, 'conversion');
  const marketImpact = sumEcosystemCost(ecosystemCosts, 'marketImpact');
  const routing = sumEcosystemCost(ecosystemCosts, 'routing');
  const components = Object.freeze([
    costComponent(
      'NETWORK',
      'Estimated network costs',
      'NETWORK_ACTIVATION_AND_POSITION_VOLUME',
      network,
    ),
    costComponent(
      'CONVERSION',
      'Estimated conversion costs',
      'TWELVE_BPS_OF_REQUIRED_CONVERSION',
      conversion,
    ),
    costComponent(
      'CROSS_ECOSYSTEM_TRANSFER',
      'Estimated EVM-Solana transfer costs',
      'NO_CROSS_ECOSYSTEM_TRANSFER',
      0n,
    ),
    costComponent(
      'MARKET_IMPACT',
      'Estimated market impact',
      'POSITION_SIZE_AND_UTILIZATION',
      marketImpact,
    ),
    costComponent(
      'ROUTING',
      'Estimated routing fee',
      'TWENTY_CENTS_PER_ACTIVE_ALLOCATION',
      routing,
    ),
  ]);
  const total = components.reduce((sum, component) => sum + BigInt(component.amountUsdMinor), 0n);
  return Object.freeze({
    actualLocalOperation: Object.freeze({ status: 'NO_EXECUTION', amountUsdMinor: '0' }),
    modeledScenario: Object.freeze({
      status: 'AVAILABLE',
      modelId: LOCAL_DEMO_EXECUTION_COST_MODEL,
      isQuote: false,
      costBasisCapitalUsdMinor: grossCapital.toString(),
      fundingTreatment: 'DEDUCT_FROM_GROSS_BEFORE_PROJECTION',
      rounding: 'CEIL_EACH_VARIABLE_COMPONENT_TO_USD_MINOR',
      components,
      totalUsdMinor: total.toString(),
    }),
    publicExecution: Object.freeze({ status: 'UNQUOTED', amountUsdMinor: null }),
  });
}

function calculateEcosystemModeledCosts(
  portfolio: LocalDemoPortfolioResponse,
  positions: readonly InternalYieldPosition[],
): readonly EcosystemModeledCost[] {
  return Object.freeze(
    LOCAL_DEMO_ECOSYSTEMS.map((ecosystem) => {
      const activePositions = positions.filter(
        (position) => position.amountUsdMinor > 0n && position.opportunity.ecosystem === ecosystem,
      );
      const activeNetworks = new Set(
        activePositions.map(({ opportunity }) => opportunity.network.id),
      );
      const networkActivation = [...activeNetworks].reduce(
        (total, networkId) => total + NETWORK_ACTIVATION_COST_USD_MINOR[networkId],
        0n,
      );
      const networkVolume = activePositions.reduce(
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
        requiredConversionAmount(portfolio, activePositions, ecosystem),
        CONVERSION_COST_BASIS_POINTS,
      );
      const marketImpact = activePositions.reduce((total, position) => {
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
      const routing = BigInt(activePositions.length) * ROUTING_COST_PER_ACTIVE_ALLOCATION_USD_MINOR;
      return Object.freeze({
        ecosystem,
        network,
        conversion,
        marketImpact,
        routing,
        total: network + conversion + marketImpact + routing,
      });
    }),
  );
}

function sumEcosystemCost(
  costs: readonly EcosystemModeledCost[],
  key: 'network' | 'conversion' | 'marketImpact' | 'routing',
): bigint {
  return costs.reduce((sum, cost) => sum + cost[key], 0n);
}

function assertEcosystemSolvency(
  sources: readonly EcosystemCapital[],
  managedCapital: readonly EcosystemCapital[],
  costs: readonly EcosystemModeledCost[],
): void {
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
  }
}

function costComponent(
  code: LocalDemoExecutionCostComponentCode,
  label: string,
  calculationBasis: LocalDemoExecutionCostBasis,
  amountUsdMinor: bigint,
): LocalDemoAllocationPreviewResponse['executionCost']['modeledScenario']['components'][number] {
  return Object.freeze({
    code,
    label,
    calculationBasis,
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
  const projectedAnnualYield = annualYieldNumerator / denominator;
  const effectiveApy =
    capitalIncludedInProjection === 0n
      ? 0n
      : (annualYieldNumerator * 10_000n) / (capitalIncludedInProjection * denominator);
  if (effectiveApy > BigInt(Number.MAX_SAFE_INTEGER) || effectiveApy > 10_000n) {
    throw new TypeError('local demo effective APY exceeds numeric limits');
  }
  return Object.freeze({
    annualYieldNumerator,
    denominator,
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
