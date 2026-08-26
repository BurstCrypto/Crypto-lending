import type {
  LocalDemoAllocationPreview,
  LocalDemoCustomYieldFilters,
  LocalDemoYieldCatalog,
  LocalDemoYieldOpportunity,
} from '../lib/local-demo/local-demo-yield';

const CAPTURED_AT = '2026-08-26T14:14:54.580Z';
const STALE_AFTER = '2026-08-27T14:14:54.580Z';
const PAYLOAD_SHA256 = '5afd26e631dc47617a3c6e84d0e04e0ac286ef8f175997611aabe937849723b4';

function opportunity(
  input: Readonly<{
    opportunityId: string;
    marketId: string;
    contract: string;
    networkId: 'eip155:1' | 'eip155:8453';
    networkName: 'Ethereum' | 'Base';
    collateral: string;
    observedAt: string;
    block: string;
    baseRateDecimal: string;
    baseBasisPoints: number;
    tvlDecimal: string;
    tvlMinor: string;
    liquidityDecimal: string;
    liquidityMinor: string;
    utilizationDecimal: string;
    utilizationBasisPoints: number;
    rewardRateDecimal?: string;
    rewardBasisPoints?: number;
  }>,
): LocalDemoYieldOpportunity {
  return Object.freeze({
    opportunityId: input.opportunityId,
    provider: Object.freeze({ id: 'MORPHO', name: 'Morpho' }),
    protocol: Object.freeze({
      id: 'MORPHO_BLUE',
      name: 'Morpho Blue',
      marketId: input.marketId,
    }),
    asset: Object.freeze({ symbol: 'USDC', contract: input.contract, decimals: 6 }),
    network: Object.freeze({ id: input.networkId, name: input.networkName }),
    apy: Object.freeze({
      baseRateDecimal: input.baseRateDecimal,
      baseBasisPoints: input.baseBasisPoints,
      observedAt: input.observedAt,
      rewardAprs:
        input.rewardRateDecimal === undefined || input.rewardBasisPoints === undefined
          ? Object.freeze([])
          : Object.freeze([
              Object.freeze({
                assetSymbol: 'USDC',
                rateDecimal: input.rewardRateDecimal,
                basisPoints: input.rewardBasisPoints,
              }),
            ]),
      providerFee: Object.freeze({ status: 'REPORTED', rateDecimal: '0', basisPoints: 0 }),
    }),
    tvl: Object.freeze({
      sourceAmountUsdDecimal: input.tvlDecimal,
      amountUsdMinor: input.tvlMinor,
      observedAt: input.observedAt,
    }),
    exitLiquidity: Object.freeze({
      sourceAmountUsdDecimal: input.liquidityDecimal,
      amountUsdMinor: input.liquidityMinor,
      observedAt: input.observedAt,
      interpretation: 'AVAILABLE_TO_BORROW_PROXY',
    }),
    utilization: Object.freeze({
      rateDecimal: input.utilizationDecimal,
      basisPoints: input.utilizationBasisPoints,
      observedAt: input.observedAt,
    }),
    availability: Object.freeze({
      status: 'LISTED_ONLY',
      providerListed: true,
      depositsEnabled: 'NOT_VERIFIED',
      withdrawalsEnabled: 'NOT_VERIFIED',
      asOf: input.observedAt,
    }),
    provenance: Object.freeze({
      sourceKind: 'API',
      sourceId: `${input.networkId}:${input.block}:${input.marketId}`,
      sourceReference: 'https://api.morpho.org/graphql',
      sourceObservedAt: input.observedAt,
      retrievedAt: CAPTURED_AT,
      payloadSha256: PAYLOAD_SHA256,
      normalizerId: 'morpho-local-demo-snapshot',
      normalizerVersion: '1.0.0',
      attributes: Object.freeze([
        Object.freeze({ key: 'chain.last_indexed_block', value: input.block }),
        Object.freeze({ key: 'market.collateral_symbol', value: input.collateral }),
        Object.freeze({
          key: 'market.collateral_contract',
          value: '0x1111111111111111111111111111111111111111',
        }),
        Object.freeze({
          key: 'snapshot.request_sha256',
          value: '4bf463059bdb4f8afd45ce26a8ddc71cb064b10131c4f9ba95323c1342618d13',
        }),
        Object.freeze({ key: 'snapshot.risk_classification', value: 'NOT_ASSESSED' }),
        Object.freeze({ key: 'snapshot.raw_response_retained', value: 'false' }),
      ]),
    }),
  });
}

export const USD3_OPPORTUNITY = opportunity({
  opportunityId:
    'morpho-blue:eip155:1:0xe3df58f9d3011b7481ff36b939fa5f8da642f34ea5792d25d3958dbf1efa26d7',
  marketId: '0xe3df58f9d3011b7481ff36b939fa5f8da642f34ea5792d25d3958dbf1efa26d7',
  contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  networkId: 'eip155:1',
  networkName: 'Ethereum',
  collateral: 'USD3',
  observedAt: '2026-08-26T14:05:47.000Z',
  block: '25839874',
  baseRateDecimal: '0.05210504022183349',
  baseBasisPoints: 521,
  tvlDecimal: '17440588.09816732',
  tvlMinor: '1744058809',
  liquidityDecimal: '2941335.5024091895',
  liquidityMinor: '294133550',
  utilizationDecimal: '0.8313511284221964',
  utilizationBasisPoints: 8313,
  rewardRateDecimal: '0.017398639912427037',
  rewardBasisPoints: 173,
});

export const BASE_CBBTC_OPPORTUNITY = opportunity({
  opportunityId:
    'morpho-blue:eip155:8453:0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
  marketId: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
  contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  networkId: 'eip155:8453',
  networkName: 'Base',
  collateral: 'cbBTC',
  observedAt: '2026-08-26T14:14:35.000Z',
  block: '50482164',
  baseRateDecimal: '0.04440914291661858',
  baseBasisPoints: 444,
  tvlDecimal: '1477830502.194782',
  tvlMinor: '147783050219',
  liquidityDecimal: '145826314.0535183',
  liquidityMinor: '14582631405',
  utilizationDecimal: '0.901324059939928',
  utilizationBasisPoints: 9013,
});

export const BASE_WETH_OPPORTUNITY = opportunity({
  opportunityId:
    'morpho-blue:eip155:8453:0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda',
  marketId: '0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda',
  contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  networkId: 'eip155:8453',
  networkName: 'Base',
  collateral: 'WETH',
  observedAt: '2026-08-26T14:12:37.000Z',
  block: '50482105',
  baseRateDecimal: '0.04426056987936856',
  baseBasisPoints: 442,
  tvlDecimal: '85584115.03256491',
  tvlMinor: '8558411503',
  liquidityDecimal: '8461288.178890718',
  liquidityMinor: '846128817',
  utilizationDecimal: '0.9011348288678199',
  utilizationBasisPoints: 9011,
});

export const LOCAL_DEMO_YIELD_CATALOG: LocalDemoYieldCatalog = Object.freeze({
  use: 'LOCAL_DEMO_SNAPSHOT_ONLY',
  mayAuthorizeFinancialAction: false,
  riskClassificationAvailable: false,
  snapshot: Object.freeze({
    id: `morpho-public-api-${CAPTURED_AT}`,
    provider: 'MORPHO_PUBLIC_API',
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshness: 'CURRENT',
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
    riskClassification: 'NOT_ASSESSED',
  }),
  opportunities: Object.freeze([USD3_OPPORTUNITY, BASE_CBBTC_OPPORTUNITY, BASE_WETH_OPPORTUNITY]),
});

export const CUSTOM_FILTERS: LocalDemoCustomYieldFilters = Object.freeze({
  assetSymbols: Object.freeze(['USDC', 'USDT'] as const),
  providerIds: Object.freeze(['MORPHO'] as const),
  networkIds: Object.freeze(['eip155:1', 'eip155:8453'] as const),
  minimumApyBasisPoints: 0,
  minimumTvlUsdMinor: '100000000',
  minimumExitLiquidityUsdMinor: '100000000',
  maximumUtilizationBasisPoints: 9500,
});

const allocations = Object.freeze([
  Object.freeze({
    bucket: 'LIQUID_RESERVE' as const,
    allocationId: 'LIQUID_RESERVE',
    label: 'Liquid reserve',
    percentageBasisPoints: 3000,
    baseApyBasisPoints: 0,
    baseApyRateDecimal: '0',
    amountUsdMinor: '330000',
    opportunity: null,
  }),
  Object.freeze({
    bucket: 'YIELD_OPPORTUNITY' as const,
    allocationId: USD3_OPPORTUNITY.opportunityId,
    label: 'USDC on Morpho Blue (Ethereum)',
    percentageBasisPoints: 2334,
    baseApyBasisPoints: 521,
    baseApyRateDecimal: USD3_OPPORTUNITY.apy.baseRateDecimal,
    amountUsdMinor: '256667',
    opportunity: USD3_OPPORTUNITY,
  }),
  Object.freeze({
    bucket: 'YIELD_OPPORTUNITY' as const,
    allocationId: BASE_CBBTC_OPPORTUNITY.opportunityId,
    label: 'USDC on Morpho Blue (Base)',
    percentageBasisPoints: 2333,
    baseApyBasisPoints: 444,
    baseApyRateDecimal: BASE_CBBTC_OPPORTUNITY.apy.baseRateDecimal,
    amountUsdMinor: '256667',
    opportunity: BASE_CBBTC_OPPORTUNITY,
  }),
  Object.freeze({
    bucket: 'YIELD_OPPORTUNITY' as const,
    allocationId: BASE_WETH_OPPORTUNITY.opportunityId,
    label: 'USDC on Morpho Blue (Base)',
    percentageBasisPoints: 2333,
    baseApyBasisPoints: 442,
    baseApyRateDecimal: BASE_WETH_OPPORTUNITY.apy.baseRateDecimal,
    amountUsdMinor: '256666',
    opportunity: BASE_WETH_OPPORTUNITY,
  }),
]);

export const BALANCED_PREVIEW: LocalDemoAllocationPreview = Object.freeze({
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
  selection: Object.freeze({
    kind: 'PRESET',
    presetId: 'BALANCED',
    label: 'Balanced blend',
    description: 'Keep 30% readily available and divide the remainder across snapshot markets.',
    liquidReserveBasisPoints: 3000,
    filters: null,
  }),
  catalog: Object.freeze({
    snapshotId: LOCAL_DEMO_YIELD_CATALOG.snapshot.id,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshness: 'CURRENT',
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
    riskClassificationAvailable: false,
    riskClassification: 'NOT_ASSESSED',
    matchedOpportunityCount: 3,
    selectedOpportunityCount: 3,
  }),
  grossCapitalUsdMinor: '1100000',
  allocations,
  executionCost: Object.freeze({
    treatment: 'LOCAL_DEMO_ZERO_NO_EXECUTION',
    modeledLocalAmountUsdMinor: '0',
    publicExecutionCostStatus: 'UNQUOTED',
  }),
  capitalIncludedInProjectionUsdMinor: '1100000',
  yieldProjection: Object.freeze({
    source: 'MORPHO_PUBLIC_API_SNAPSHOT',
    calculationMethod: 'POSITION_WEIGHTED_EXACT_BASE_APY',
    effectiveApyBasisPoints: 328,
    projectedAnnualYieldUsdMinor: '36132',
  }),
  asOf: '2026-08-26T14:15:00.000Z',
});

export const CUSTOM_PREVIEW: LocalDemoAllocationPreview = Object.freeze({
  ...BALANCED_PREVIEW,
  selection: Object.freeze({
    kind: 'CUSTOM',
    presetId: null,
    label: 'Custom yield filter',
    description:
      'Apply asset, provider, network, APY, TVL, liquidity, and utilization constraints.',
    liquidReserveBasisPoints: 3000,
    filters: CUSTOM_FILTERS,
  }),
});

export const MORE_LIQUID_PREVIEW: LocalDemoAllocationPreview = Object.freeze({
  ...BALANCED_PREVIEW,
  selection: Object.freeze({
    kind: 'PRESET',
    presetId: 'MORE_LIQUID',
    label: 'More liquid',
    description: 'Keep 60% readily available and divide the remainder across snapshot markets.',
    liquidReserveBasisPoints: 6000,
    filters: null,
  }),
  allocations: Object.freeze(
    BALANCED_PREVIEW.allocations.map((allocation, index) =>
      Object.freeze({
        ...allocation,
        percentageBasisPoints: [6000, 1334, 1333, 1333][index]!,
        amountUsdMinor: ['660000', '146667', '146667', '146666'][index]!,
      }),
    ),
  ),
  executionCost: Object.freeze({
    treatment: 'LOCAL_DEMO_ZERO_NO_EXECUTION',
    modeledLocalAmountUsdMinor: '0',
    publicExecutionCostStatus: 'UNQUOTED',
  }),
  capitalIncludedInProjectionUsdMinor: '1100000',
  yieldProjection: Object.freeze({
    source: 'MORPHO_PUBLIC_API_SNAPSHOT',
    calculationMethod: 'POSITION_WEIGHTED_EXACT_BASE_APY',
    effectiveApyBasisPoints: 187,
    projectedAnnualYieldUsdMinor: '20646',
  }),
});
