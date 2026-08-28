import type {
  LocalDemoAllocationPreview,
  LocalDemoAllocationPresetId,
  LocalDemoExecutionCostComponentCode,
  LocalDemoYieldCatalog,
} from '../lib/local-demo/local-demo-yield';

const CAPTURED_AT = '2026-08-27T01:04:48.000Z';
const STALE_AFTER = '2026-08-27T14:14:54.580Z';

export const LOCAL_DEMO_YIELD_CATALOG: LocalDemoYieldCatalog = Object.freeze({
  use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY',
  mayAuthorizeFinancialAction: false,
  riskClassificationAvailable: false,
  strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND',
  ecosystems: Object.freeze(['EVM', 'SOLANA'] as const),
  snapshot: Object.freeze({
    id: 'managed-rate-snapshot-v3',
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
  readonly routingFeeClassification?: 'MATERIAL_ORCHESTRATION' | 'DIRECT_COMPATIBLE';
  readonly retainedRoundingResidualUsdMinor?: string;
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
    fundingTreatment: 'DEDUCTED_FROM_GROSS' as const,
  }),
  Object.freeze({
    code: 'CONVERSION' as const,
    label: 'Estimated conversion costs',
    calculationBasis: 'TWELVE_BPS_OF_REQUIRED_CONVERSION' as const,
    fundingTreatment: 'DEDUCTED_FROM_GROSS' as const,
  }),
  Object.freeze({
    code: 'CROSS_ECOSYSTEM_TRANSFER' as const,
    label: 'Estimated EVM-Solana transfer costs',
    calculationBasis: 'NO_CROSS_ECOSYSTEM_TRANSFER' as const,
    fundingTreatment: 'DEDUCTED_FROM_GROSS' as const,
  }),
  Object.freeze({
    code: 'MARKET_IMPACT' as const,
    label: 'Estimated market impact',
    calculationBasis: 'POSITION_SIZE_AND_UTILIZATION' as const,
    fundingTreatment: 'DEDUCTED_FROM_GROSS' as const,
  }),
  Object.freeze({
    code: 'PLATFORM_ROUTING' as const,
    label: 'Estimated platform routing fee',
    calculationBasis: 'CANONICAL_PLATFORM_ROUTING_RULE_V1' as const,
    fundingTreatment: 'ADDED_ON_TOP' as const,
  }),
] satisfies readonly Readonly<{
  code: LocalDemoExecutionCostComponentCode;
  label: string;
  calculationBasis:
    | 'NETWORK_ACTIVATION_AND_POSITION_VOLUME'
    | 'TWELVE_BPS_OF_REQUIRED_CONVERSION'
    | 'NO_CROSS_ECOSYSTEM_TRANSFER'
    | 'POSITION_SIZE_AND_UTILIZATION'
    | 'CANONICAL_PLATFORM_ROUTING_RULE_V1';
  fundingTreatment: 'DEDUCTED_FROM_GROSS' | 'ADDED_ON_TOP';
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
  const deductedFromGrossUsdMinor = input.feeAmounts
    .slice(0, 4)
    .reduce((sum, amount) => sum + BigInt(amount), 0n)
    .toString();
  const addedOnTopUsdMinor = input.feeAmounts[4];
  const requiredCapitalIncludingAddedOnTopUsdMinor = (
    BigInt(grossCapitalUsdMinor) + BigInt(addedOnTopUsdMinor)
  ).toString();
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
    }),
    executionCost: Object.freeze({
      actualLocalOperation: Object.freeze({ status: 'NO_EXECUTION', amountUsdMinor: '0' }),
      modeledScenario: Object.freeze({
        status: 'AVAILABLE',
        modelId: 'LOCAL_DEMO_ALLOCATION_COST_V2',
        isQuote: false,
        costBasisCapitalUsdMinor: grossCapitalUsdMinor,
        fundingTreatment: 'MIXED_DEDUCT_FROM_GROSS_AND_ADD_ON_TOP',
        rounding: 'CEIL_VARIABLE_COMPONENTS_PLATFORM_FEE_HALF_EVEN',
        routingFeePolicy: Object.freeze({
          tier: 'FREE' as const,
          classification: input.routingFeeClassification ?? 'MATERIAL_ORCHESTRATION',
          ruleVersion: 1 as const,
        }),
        components: Object.freeze(
          COMPONENTS.map((component, index) =>
            Object.freeze({ ...component, amountUsdMinor: input.feeAmounts[index]! }),
          ),
        ),
        deductedFromGrossUsdMinor,
        addedOnTopUsdMinor,
        retainedRoundingResidualUsdMinor: input.retainedRoundingResidualUsdMinor ?? '0',
        totalUsdMinor: input.totalFeeUsdMinor,
        requiredCapitalIncludingAddedOnTopUsdMinor,
      }),
      publicExecution: Object.freeze({ status: 'UNQUOTED', amountUsdMinor: null }),
    }),
    capitalIncludedInProjectionUsdMinor: input.capitalIncludedInProjectionUsdMinor,
    yieldProjection: Object.freeze({
      source: 'MANAGED_RATE_SNAPSHOT',
      calculationMethod: 'INTERNAL_POSITION_WEIGHTED_25_BPS_CONSERVATIVE_BUCKET',
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

const ZERO_LIQUID_SINGLE_EVM_ECONOMICS = Object.freeze({
  description:
    'Keep 0% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 0,
  feeAmounts: Object.freeze(['623', '0', '0', '252', '1398'] as const),
  totalFeeUsdMinor: '2273',
  capitalIncludedInProjectionUsdMinor: '699125',
  allocationAmounts: Object.freeze(['0', '699125'] as const),
  effectiveApyBasisPoints: 950,
  projectedAnnualYieldUsdMinor: '66416',
  projectedAnnualYieldAfterFeesUsdMinor: '64143',
  firstPositiveDay: 13,
});

export const ZERO_LIQUID_BALANCED_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  ...ZERO_LIQUID_SINGLE_EVM_ECONOMICS,
});

export const ZERO_LIQUID_MORE_LIQUID_PREVIEW = preview({
  presetId: 'MORE_LIQUID',
  label: 'More liquid',
  ...ZERO_LIQUID_SINGLE_EVM_ECONOMICS,
});

export const ZERO_LIQUID_MORE_YIELD_PREVIEW = preview({
  presetId: 'MORE_YIELD',
  label: 'More yield',
  ...ZERO_LIQUID_SINGLE_EVM_ECONOMICS,
});

export const DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  description:
    'Keep 0% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 0,
  routingFeeClassification: 'DIRECT_COMPATIBLE',
  feeAmounts: ['0', '0', '0', '0', '0'],
  totalFeeUsdMinor: '0',
  capitalIncludedInProjectionUsdMinor: '700000',
  allocationAmounts: ['0', '700000'],
  effectiveApyBasisPoints: 500,
  projectedAnnualYieldUsdMinor: '35000',
  projectedAnnualYieldAfterFeesUsdMinor: '35000',
  firstPositiveDay: 1,
});

export const HALF_EVEN_DOWN_PLATFORM_FEE_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  description:
    'Keep 0% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 0,
  grossCapitalUsdMinor: '250',
  feeAmounts: ['0', '0', '0', '0', '0'],
  totalFeeUsdMinor: '0',
  capitalIncludedInProjectionUsdMinor: '250',
  allocationAmounts: ['0', '250'],
  effectiveApyBasisPoints: 400,
  projectedAnnualYieldUsdMinor: '10',
  projectedAnnualYieldAfterFeesUsdMinor: '10',
  firstPositiveDay: 37,
});

export const RETAINED_ROUNDING_RESIDUAL_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  description:
    'Keep 0% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 0,
  grossCapitalUsdMinor: '251',
  retainedRoundingResidualUsdMinor: '1',
  feeAmounts: ['0', '0', '0', '0', '0'],
  totalFeeUsdMinor: '0',
  capitalIncludedInProjectionUsdMinor: '250',
  allocationAmounts: ['0', '250'],
  effectiveApyBasisPoints: 400,
  projectedAnnualYieldUsdMinor: '10',
  projectedAnnualYieldAfterFeesUsdMinor: '10',
  firstPositiveDay: 37,
});

export const HALF_EVEN_UP_PLATFORM_FEE_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  description:
    'Keep 0% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 0,
  grossCapitalUsdMinor: '750',
  feeAmounts: ['0', '0', '0', '0', '2'],
  totalFeeUsdMinor: '2',
  capitalIncludedInProjectionUsdMinor: '750',
  allocationAmounts: ['0', '750'],
  effectiveApyBasisPoints: 400,
  projectedAnnualYieldUsdMinor: '30',
  projectedAnnualYieldAfterFeesUsdMinor: '28',
  firstPositiveDay: 37,
});

export const BALANCED_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  description:
    'Keep 30% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 3_000,
  feeAmounts: ['489', '0', '0', '177', '979'],
  totalFeeUsdMinor: '1645',
  capitalIncludedInProjectionUsdMinor: '699334',
  allocationAmounts: ['209800', '489534'],
  effectiveApyBasisPoints: 650,
  projectedAnnualYieldUsdMinor: '45456',
  projectedAnnualYieldAfterFeesUsdMinor: '43811',
  firstPositiveDay: 14,
});

export const MORE_LIQUID_PREVIEW = preview({
  presetId: 'MORE_LIQUID',
  label: 'More liquid',
  description:
    'Keep 60% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 6_000,
  feeAmounts: ['355', '0', '0', '102', '560'],
  totalFeeUsdMinor: '1017',
  capitalIncludedInProjectionUsdMinor: '699543',
  allocationAmounts: ['419726', '279817'],
  effectiveApyBasisPoints: 375,
  projectedAnnualYieldUsdMinor: '26232',
  projectedAnnualYieldAfterFeesUsdMinor: '25215',
  firstPositiveDay: 15,
});

export const MORE_YIELD_PREVIEW = preview({
  presetId: 'MORE_YIELD',
  label: 'More yield',
  description:
    'Keep 15% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 1_500,
  feeAmounts: ['557', '0', '0', '215', '1189'],
  totalFeeUsdMinor: '1961',
  capitalIncludedInProjectionUsdMinor: '699228',
  allocationAmounts: ['104884', '594344'],
  effectiveApyBasisPoints: 800,
  projectedAnnualYieldUsdMinor: '55938',
  projectedAnnualYieldAfterFeesUsdMinor: '53977',
  firstPositiveDay: 13,
});

export const FRACTIONAL_LIQUID_PREVIEW = preview({
  presetId: 'MORE_YIELD',
  label: 'More yield',
  description:
    'Keep 15.50% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 1_550,
  feeAmounts: ['554', '0', '0', '213', '1182'],
  totalFeeUsdMinor: '1949',
  capitalIncludedInProjectionUsdMinor: '699233',
  allocationAmounts: ['108381', '590852'],
  effectiveApyBasisPoints: 800,
  projectedAnnualYieldUsdMinor: '55938',
  projectedAnnualYieldAfterFeesUsdMinor: '53989',
  firstPositiveDay: 13,
});

export const MORE_YIELD_DAY_365_PREVIEW = preview({
  presetId: 'MORE_YIELD',
  label: 'More yield',
  description:
    'Keep 15% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 1_500,
  grossCapitalUsdMinor: '4957',
  feeAmounts: ['179', '0', '0', '3', '8'],
  totalFeeUsdMinor: '190',
  capitalIncludedInProjectionUsdMinor: '4775',
  allocationAmounts: ['716', '4059'],
  effectiveApyBasisPoints: 400,
  projectedAnnualYieldUsdMinor: '191',
  projectedAnnualYieldAfterFeesUsdMinor: '1',
  firstPositiveDay: 365,
});

export const CROSS_CHAIN_BALANCED_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  description:
    'Keep 30% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 3_000,
  grossCapitalUsdMinor: '1100000',
  sourceCapitalAmounts: ['700000', '400000'],
  managedYieldCompositionAmounts: ['489534', '279935'],
  managedYieldCompositionBasisPoints: [6_362, 3_638],
  feeAmounts: ['519', '0', '0', '240', '1539'],
  totalFeeUsdMinor: '2298',
  capitalIncludedInProjectionUsdMinor: '1099241',
  allocationAmounts: ['329772', '769469'],
  effectiveApyBasisPoints: 525,
  projectedAnnualYieldUsdMinor: '57710',
  projectedAnnualYieldAfterFeesUsdMinor: '55412',
  firstPositiveDay: 15,
});

export const CROSS_CHAIN_ZERO_LIQUID_BALANCED_PREVIEW = preview({
  presetId: 'BALANCED',
  label: 'Managed blend',
  description:
    'Keep 0% readily available and allocate the remainder to the managed yield strategy.',
  liquidReserveBasisPoints: 0,
  grossCapitalUsdMinor: '1100000',
  sourceCapitalAmounts: ['700000', '400000'],
  managedYieldCompositionAmounts: ['699125', '399871'],
  managedYieldCompositionBasisPoints: [6_361, 3_639],
  feeAmounts: ['664', '0', '0', '340', '2198'],
  totalFeeUsdMinor: '3202',
  capitalIncludedInProjectionUsdMinor: '1098996',
  allocationAmounts: ['0', '1098996'],
  effectiveApyBasisPoints: 750,
  projectedAnnualYieldUsdMinor: '82424',
  projectedAnnualYieldAfterFeesUsdMinor: '79222',
  firstPositiveDay: 15,
});
