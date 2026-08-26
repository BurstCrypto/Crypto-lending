import type {
  LocalDemoAllocationPreview,
  LocalDemoAllocationPresetId,
  LocalDemoExecutionCostComponentCode,
  LocalDemoYieldCatalog,
} from '../lib/local-demo/local-demo-yield';

const CAPTURED_AT = '2026-08-26T14:14:54.580Z';
const STALE_AFTER = '2026-08-27T14:14:54.580Z';

export const LOCAL_DEMO_YIELD_CATALOG: LocalDemoYieldCatalog = Object.freeze({
  use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY',
  mayAuthorizeFinancialAction: false,
  riskClassificationAvailable: false,
  strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND',
  ecosystems: Object.freeze(['EVM', 'SOLANA'] as const),
  snapshot: Object.freeze({
    id: 'managed-rate-snapshot-v2',
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshness: 'CURRENT',
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
    riskClassification: 'NOT_ASSESSED',
  }),
});

interface PreviewFixtureInput {
  readonly presetId: LocalDemoAllocationPresetId;
  readonly label: string;
  readonly description: string;
  readonly liquidReserveBasisPoints: number;
  readonly grossCapitalUsdMinor?: string;
  readonly portfolioSnapshotId?: string;
  readonly sourceCapitalAmounts?: readonly [string, string];
  readonly managedYieldCompositionAmounts?: readonly [string, string];
  readonly managedYieldCompositionBasisPoints?: readonly [number, number];
  readonly activeAllocationCount?: number;
  readonly feeAmounts: readonly [string, string, string, string, string];
  readonly totalFeeUsdMinor: string;
  readonly capitalIncludedInProjectionUsdMinor: string;
  readonly allocationAmounts: readonly [string, string];
  readonly effectiveApyBasisPoints: number;
  readonly projectedAnnualYieldUsdMinor: string;
  readonly projectedAnnualYieldAfterFeesUsdMinor: string;
  readonly firstPositiveDay: number;
}

const COMPONENTS = Object.freeze([
  Object.freeze({
    code: 'NETWORK' as const,
    label: 'Estimated network costs',
    calculationBasis: 'NETWORK_ACTIVATION_AND_POSITION_VOLUME' as const,
  }),
  Object.freeze({
    code: 'CONVERSION' as const,
    label: 'Estimated conversion costs',
    calculationBasis: 'TWELVE_BPS_OF_REQUIRED_CONVERSION' as const,
  }),
  Object.freeze({
    code: 'CROSS_ECOSYSTEM_TRANSFER' as const,
    label: 'Estimated EVM-Solana transfer costs',
    calculationBasis: 'NO_CROSS_ECOSYSTEM_TRANSFER' as const,
  }),
  Object.freeze({
    code: 'MARKET_IMPACT' as const,
    label: 'Estimated market impact',
    calculationBasis: 'POSITION_SIZE_AND_UTILIZATION' as const,
  }),
  Object.freeze({
    code: 'ROUTING' as const,
    label: 'Estimated routing fee',
    calculationBasis: 'TWENTY_CENTS_PER_ACTIVE_ALLOCATION' as const,
  }),
] satisfies readonly Readonly<{
  code: LocalDemoExecutionCostComponentCode;
  label: string;
  calculationBasis:
    | 'NETWORK_ACTIVATION_AND_POSITION_VOLUME'
    | 'TWELVE_BPS_OF_REQUIRED_CONVERSION'
    | 'NO_CROSS_ECOSYSTEM_TRANSFER'
    | 'POSITION_SIZE_AND_UTILIZATION'
    | 'TWENTY_CENTS_PER_ACTIVE_ALLOCATION';
}>[]);

function preview(input: PreviewFixtureInput): LocalDemoAllocationPreview {
  const grossCapitalUsdMinor = input.grossCapitalUsdMinor ?? '700000';
  const sourceCapitalAmounts = input.sourceCapitalAmounts ?? [grossCapitalUsdMinor, '0'];
  const managedYieldCompositionAmounts = input.managedYieldCompositionAmounts ?? [
    input.allocationAmounts[1],
    '0',
  ];
  const managedYieldCompositionBasisPoints = input.managedYieldCompositionBasisPoints ?? [
    10_000, 0,
  ];
  const activeEcosystemCount = managedYieldCompositionAmounts[1] === '0' ? 1 : 2;
  return Object.freeze({
    use: 'LOCAL_DEMO_ESTIMATE_ONLY',
    mayAuthorizeFinancialAction: false,
    portfolioSnapshotId:
      input.portfolioSnapshotId ?? 'local-demo-portfolio:11111111111111111111111111111111',
    selection: Object.freeze({
      kind: 'PRESET',
      presetId: input.presetId,
      label: input.label,
      description: input.description,
      liquidReserveBasisPoints: input.liquidReserveBasisPoints,
    }),
    rateSnapshot: Object.freeze({
      ...LOCAL_DEMO_YIELD_CATALOG.snapshot,
      riskClassificationAvailable: false,
    }),
    grossCapitalUsdMinor,
    sourceCapitalByEcosystem: Object.freeze([
      Object.freeze({ ecosystem: 'EVM' as const, amountUsdMinor: sourceCapitalAmounts[0] }),
      Object.freeze({ ecosystem: 'SOLANA' as const, amountUsdMinor: sourceCapitalAmounts[1] }),
    ]),
    allocations: Object.freeze([
      Object.freeze({
        bucket: 'LIQUID_RESERVE' as const,
        allocationId: 'LIQUID_RESERVE' as const,
        label: 'Liquid reserve' as const,
        percentageBasisPoints: input.liquidReserveBasisPoints,
        amountUsdMinor: input.allocationAmounts[0],
      }),
      Object.freeze({
        bucket: 'MANAGED_YIELD' as const,
        allocationId: 'MANAGED_YIELD' as const,
        label: 'Managed yield' as const,
        percentageBasisPoints: 10_000 - input.liquidReserveBasisPoints,
        amountUsdMinor: input.allocationAmounts[1],
      }),
    ]),
    managedYieldComposition: Object.freeze([
      Object.freeze({
        ecosystem: 'EVM' as const,
        label: 'EVM managed yield' as const,
        percentageBasisPointsOfManagedYield: managedYieldCompositionBasisPoints[0],
        amountUsdMinor: managedYieldCompositionAmounts[0],
      }),
      Object.freeze({
        ecosystem: 'SOLANA' as const,
        label: 'SVM managed yield' as const,
        percentageBasisPointsOfManagedYield: managedYieldCompositionBasisPoints[1],
        amountUsdMinor: managedYieldCompositionAmounts[1],
      }),
    ]),
    compositionSummary: Object.freeze({
      mode: activeEcosystemCount === 2 ? 'EVM_SOLANA_PORTFOLIO_BLEND' : 'SINGLE_ECOSYSTEM',
      crossEcosystemTransferRequired: false,
      crossEcosystemTransferUsdMinor: '0',
      activeEcosystemCount,
      activeAllocationCount: input.activeAllocationCount ?? activeEcosystemCount,
    }),
    executionCost: Object.freeze({
      actualLocalOperation: Object.freeze({ status: 'NO_EXECUTION', amountUsdMinor: '0' }),
      modeledScenario: Object.freeze({
        status: 'AVAILABLE',
        modelId: 'LOCAL_DEMO_ALLOCATION_COST_V2',
        isQuote: false,
        costBasisCapitalUsdMinor: grossCapitalUsdMinor,
        fundingTreatment: 'DEDUCT_FROM_GROSS_BEFORE_PROJECTION',
        rounding: 'CEIL_EACH_VARIABLE_COMPONENT_TO_USD_MINOR',
        components: Object.freeze(
          COMPONENTS.map((component, index) =>
            Object.freeze({ ...component, amountUsdMinor: input.feeAmounts[index]! }),
          ),
        ),
        totalUsdMinor: input.totalFeeUsdMinor,
      }),
      publicExecution: Object.freeze({ status: 'UNQUOTED', amountUsdMinor: null }),
    }),
    capitalIncludedInProjectionUsdMinor: input.capitalIncludedInProjectionUsdMinor,
    yieldProjection: Object.freeze({
      source: 'MANAGED_RATE_SNAPSHOT',
      calculationMethod: 'INTERNAL_POSITION_WEIGHTED_EXACT_BASE_APY',
      effectiveApyBasisPoints: input.effectiveApyBasisPoints,
      projectedAnnualYieldUsdMinor: input.projectedAnnualYieldUsdMinor,
      projectedAnnualYieldAfterFeesUsdMinor: input.projectedAnnualYieldAfterFeesUsdMinor,
      firstPositiveDayAfterFees: Object.freeze({
        calculationMethod: 'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES',
        status: 'RECOVERED_WITHIN_HORIZON',
        day: input.firstPositiveDay,
        modelHorizonDays: 365,
      }),
    }),
    asOf: '2026-08-26T14:15:00.000Z',
  });
}

export const BALANCED_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Balanced blend',
  description:
    'Keep 30% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 3_000,
  feeAmounts: ['438', '0', '0', '115', '60'],
  totalFeeUsdMinor: '613',
  capitalIncludedInProjectionUsdMinor: '699387',
  allocationAmounts: ['209816', '489571'],
  effectiveApyBasisPoints: 328,
  projectedAnnualYieldUsdMinor: '22973',
  projectedAnnualYieldAfterFeesUsdMinor: '22360',
  firstPositiveDay: 10,
});

export const MORE_LIQUID_PREVIEW = preview({
  presetId: 'MORE_LIQUID',
  label: 'More liquid',
  description:
    'Keep 60% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 6_000,
  feeAmounts: ['326', '0', '0', '66', '60'],
  totalFeeUsdMinor: '452',
  capitalIncludedInProjectionUsdMinor: '699548',
  allocationAmounts: ['419729', '279819'],
  effectiveApyBasisPoints: 187,
  projectedAnnualYieldUsdMinor: '13130',
  projectedAnnualYieldAfterFeesUsdMinor: '12678',
  firstPositiveDay: 13,
});

export const MORE_YIELD_PREVIEW = preview({
  presetId: 'MORE_YIELD',
  label: 'More yield',
  description:
    'Keep 15% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 1_500,
  feeAmounts: ['494', '0', '0', '140', '60'],
  totalFeeUsdMinor: '694',
  capitalIncludedInProjectionUsdMinor: '699306',
  allocationAmounts: ['104896', '594410'],
  effectiveApyBasisPoints: 398,
  projectedAnnualYieldUsdMinor: '27892',
  projectedAnnualYieldAfterFeesUsdMinor: '27198',
  firstPositiveDay: 10,
});

export const FRACTIONAL_LIQUID_PREVIEW = preview({
  presetId: 'MORE_YIELD',
  label: 'More yield',
  description:
    'Keep 15.50% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 1_550,
  feeAmounts: ['494', '0', '0', '140', '60'],
  totalFeeUsdMinor: '694',
  capitalIncludedInProjectionUsdMinor: '699306',
  allocationAmounts: ['108392', '590914'],
  effectiveApyBasisPoints: 398,
  projectedAnnualYieldUsdMinor: '27892',
  projectedAnnualYieldAfterFeesUsdMinor: '27198',
  firstPositiveDay: 10,
});

export const MORE_YIELD_DAY_365_PREVIEW = preview({
  presetId: 'MORE_YIELD',
  label: 'More yield',
  description:
    'Keep 15% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 1_500,
  grossCapitalUsdMinor: '6335',
  feeAmounts: ['179', '0', '0', '3', '60'],
  totalFeeUsdMinor: '242',
  capitalIncludedInProjectionUsdMinor: '6093',
  allocationAmounts: ['914', '5179'],
  effectiveApyBasisPoints: 398,
  projectedAnnualYieldUsdMinor: '243',
  projectedAnnualYieldAfterFeesUsdMinor: '1',
  firstPositiveDay: 365,
});

export const CROSS_CHAIN_BALANCED_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Balanced blend',
  description:
    'Keep 30% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 3_000,
  grossCapitalUsdMinor: '1100000',
  sourceCapitalAmounts: ['700000', '400000'],
  managedYieldCompositionAmounts: ['489594', '279768'],
  managedYieldCompositionBasisPoints: [6_364, 3_636],
  activeAllocationCount: 3,
  feeAmounts: ['650', '84', '0', '118', '60'],
  totalFeeUsdMinor: '912',
  capitalIncludedInProjectionUsdMinor: '1099088',
  allocationAmounts: ['329726', '769362'],
  effectiveApyBasisPoints: 328,
  projectedAnnualYieldUsdMinor: '36102',
  projectedAnnualYieldAfterFeesUsdMinor: '35190',
  firstPositiveDay: 10,
});
