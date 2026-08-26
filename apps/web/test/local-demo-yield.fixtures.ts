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
  snapshot: Object.freeze({
    id: 'managed-rate-snapshot-v1',
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
  readonly feeAmounts: readonly [string, string, string, string];
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
    | 'POSITION_SIZE_AND_UTILIZATION'
    | 'TWENTY_CENTS_PER_ACTIVE_ALLOCATION';
}>[]);

function preview(input: PreviewFixtureInput): LocalDemoAllocationPreview {
  const grossCapitalUsdMinor = input.grossCapitalUsdMinor ?? '700000';
  return Object.freeze({
    use: 'LOCAL_DEMO_ESTIMATE_ONLY',
    mayAuthorizeFinancialAction: false,
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
    executionCost: Object.freeze({
      actualLocalOperation: Object.freeze({ status: 'NO_EXECUTION', amountUsdMinor: '0' }),
      modeledScenario: Object.freeze({
        status: 'AVAILABLE',
        modelId: 'LOCAL_DEMO_ALLOCATION_COST_V1',
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
  feeAmounts: ['438', '0', '115', '60'],
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
  feeAmounts: ['326', '0', '66', '60'],
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
  feeAmounts: ['494', '0', '140', '60'],
  totalFeeUsdMinor: '694',
  capitalIncludedInProjectionUsdMinor: '699306',
  allocationAmounts: ['104896', '594410'],
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
  feeAmounts: ['179', '0', '3', '60'],
  totalFeeUsdMinor: '242',
  capitalIncludedInProjectionUsdMinor: '6093',
  allocationAmounts: ['914', '5179'],
  effectiveApyBasisPoints: 398,
  projectedAnnualYieldUsdMinor: '243',
  projectedAnnualYieldAfterFeesUsdMinor: '1',
  firstPositiveDay: 365,
});
