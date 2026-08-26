/**
 * Immutable research-time capture from the public Morpho GraphQL API.
 *
 * This module performs no I/O and is intentionally separate from every provider
 * adapter, controller, and financial workflow. The values are point-in-time,
 * non-executable local-demo evidence. A market being listed is not a risk,
 * eligibility, provider, or investment approval.
 */

const MORPHO_MARKET_CAPTURE_FIELDS = `
  marketId
  listed
  chain { id network }
  loanAsset { address name symbol decimals }
  collateralAsset { address name symbol decimals }
  lltv
  irmAddress
  oracle { address }
  state {
    blockNumber
    timestamp
    supplyApy
    supplyAssets
    supplyAssetsUsd
    borrowAssets
    borrowAssetsUsd
    utilization
    liquidityAssets
    liquidityAssetsUsd
    fee
    rewards {
      asset { address name symbol decimals chain { id network } }
      supplyApr
    }
  }
`;

export const MORPHO_YIELD_SNAPSHOT_QUERY = `query LocalDemoMorphoSnapshot {
  baseUsdcCbBtc: marketById(marketId: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836", chainId: 8453) { ${MORPHO_MARKET_CAPTURE_FIELDS} }
  baseUsdcWeth: marketById(marketId: "0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda", chainId: 8453) { ${MORPHO_MARKET_CAPTURE_FIELDS} }
  ethereumUsdcCbBtc: marketById(marketId: "0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64", chainId: 1) { ${MORPHO_MARKET_CAPTURE_FIELDS} }
  ethereumUsdtWstEth: marketById(marketId: "0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2", chainId: 1) { ${MORPHO_MARKET_CAPTURE_FIELDS} }
  ethereumUsdcUsd3: marketById(marketId: "0xe3df58f9d3011b7481ff36b939fa5f8da642f34ea5792d25d3958dbf1efa26d7", chainId: 1) { ${MORPHO_MARKET_CAPTURE_FIELDS} }
}`;

export interface MorphoYieldRewardAprSnapshot {
  readonly assetSymbol: string;
  readonly assetContract: string;
  readonly assetDecimals: number;
  readonly networkId: string;
  readonly rateDecimal: string;
}

export interface MorphoYieldOpportunitySnapshot {
  readonly opportunityId: string;
  readonly marketId: string;
  readonly assetSymbol: 'USDC' | 'USDT';
  readonly assetContract: string;
  readonly assetDecimals: 6;
  readonly collateralSymbol: string;
  readonly collateralContract: string;
  readonly networkId: 'eip155:1' | 'eip155:8453';
  readonly networkName: 'Ethereum' | 'Base';
  /** Morpho `MarketState.supplyApy`: instantaneous native supply APY, excluding rewards. */
  readonly apyRateDecimal: string;
  /** Morpho `MarketState.supplyAssetsUsd`: supplied assets in USD for display. */
  readonly tvlUsdDecimal: string;
  /** Exact provider underlying-unit values; the loan asset has six decimals. */
  readonly supplyAssetsAtomic: string;
  readonly borrowAssetsAtomic: string;
  /** Morpho `MarketState.liquidityAssets`: amount available to borrow, used only as an exit-liquidity proxy. */
  readonly exitLiquidityAssetsAtomic: string;
  readonly exitLiquidityUsdDecimal: string;
  readonly utilizationRateDecimal: string;
  /** Morpho market borrow-interest fee rate; this is not a user entry or routing fee. */
  readonly providerFeeRateDecimal: string;
  readonly rewardAprs: readonly MorphoYieldRewardAprSnapshot[];
  readonly providerObservedAt: string;
  readonly lastIndexedBlock: string;
  readonly providerListed: true;
  readonly riskClassification: 'NOT_ASSESSED';
  readonly mayAuthorizeFinancialAction: false;
}

const noRewards = (): readonly MorphoYieldRewardAprSnapshot[] => Object.freeze([]);

const opportunities: readonly MorphoYieldOpportunitySnapshot[] = Object.freeze([
  Object.freeze({
    opportunityId:
      'morpho-blue:eip155:8453:0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
    marketId: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
    assetSymbol: 'USDC',
    assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetDecimals: 6,
    collateralSymbol: 'cbBTC',
    collateralContract: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    networkId: 'eip155:8453',
    networkName: 'Base',
    apyRateDecimal: '0.04440914291661858',
    tvlUsdDecimal: '1477830502.194782',
    supplyAssetsAtomic: '1477983678753551',
    borrowAssetsAtomic: '1332142249859101',
    exitLiquidityAssetsAtomic: '145841428894450',
    exitLiquidityUsdDecimal: '145826314.0535183',
    utilizationRateDecimal: '0.901324059939928',
    providerFeeRateDecimal: '0',
    rewardAprs: noRewards(),
    providerObservedAt: '2026-08-26T14:14:35.000Z',
    lastIndexedBlock: '50482164',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
  Object.freeze({
    opportunityId:
      'morpho-blue:eip155:8453:0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda',
    marketId: '0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda',
    assetSymbol: 'USDC',
    assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetDecimals: 6,
    collateralSymbol: 'WETH',
    collateralContract: '0x4200000000000000000000000000000000000006',
    networkId: 'eip155:8453',
    networkName: 'Base',
    apyRateDecimal: '0.04426056987936856',
    tvlUsdDecimal: '85584115.03256491',
    supplyAssetsAtomic: '85592985792917',
    borrowAssetsAtomic: '77130820604786',
    exitLiquidityAssetsAtomic: '8462165188131',
    exitLiquidityUsdDecimal: '8461288.178890718',
    utilizationRateDecimal: '0.9011348288678199',
    providerFeeRateDecimal: '0',
    rewardAprs: noRewards(),
    providerObservedAt: '2026-08-26T14:12:37.000Z',
    lastIndexedBlock: '50482105',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
  Object.freeze({
    opportunityId:
      'morpho-blue:eip155:1:0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64',
    marketId: '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64',
    assetSymbol: 'USDC',
    assetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetDecimals: 6,
    collateralSymbol: 'cbBTC',
    collateralContract: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    networkId: 'eip155:1',
    networkName: 'Ethereum',
    apyRateDecimal: '0.04205303220765344',
    tvlUsdDecimal: '330531468.38254285',
    supplyAssetsAtomic: '330565727841132',
    borrowAssetsAtomic: '298424176218137',
    exitLiquidityAssetsAtomic: '32141551622995',
    exitLiquidityUsdDecimal: '32138220.508895513',
    utilizationRateDecimal: '0.9027680460618045',
    providerFeeRateDecimal: '0',
    rewardAprs: noRewards(),
    providerObservedAt: '2026-08-26T14:12:11.000Z',
    lastIndexedBlock: '25839906',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
  Object.freeze({
    opportunityId:
      'morpho-blue:eip155:1:0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2',
    marketId: '0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2',
    assetSymbol: 'USDT',
    assetContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    assetDecimals: 6,
    collateralSymbol: 'wstETH',
    collateralContract: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    networkId: 'eip155:1',
    networkName: 'Ethereum',
    apyRateDecimal: '0.030244914978243814',
    tvlUsdDecimal: '110276706.21899776',
    supplyAssetsAtomic: '110290452267576',
    borrowAssetsAtomic: '98189748197275',
    exitLiquidityAssetsAtomic: '12100704070301',
    exitLiquidityUsdDecimal: '12099195.899262063',
    utilizationRateDecimal: '0.8902833035724304',
    providerFeeRateDecimal: '0',
    rewardAprs: noRewards(),
    providerObservedAt: '2026-08-26T14:12:47.000Z',
    lastIndexedBlock: '25839909',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
  Object.freeze({
    opportunityId:
      'morpho-blue:eip155:1:0xe3df58f9d3011b7481ff36b939fa5f8da642f34ea5792d25d3958dbf1efa26d7',
    marketId: '0xe3df58f9d3011b7481ff36b939fa5f8da642f34ea5792d25d3958dbf1efa26d7',
    assetSymbol: 'USDC',
    assetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetDecimals: 6,
    collateralSymbol: 'USD3',
    collateralContract: '0x056B269Eb1f75477a8666ae8C7fE01b64dD55eCc',
    networkId: 'eip155:1',
    networkName: 'Ethereum',
    apyRateDecimal: '0.05210504022183349',
    tvlUsdDecimal: '17440588.09816732',
    supplyAssetsAtomic: '17442395808364',
    borrowAssetsAtomic: '14500755437670',
    exitLiquidityAssetsAtomic: '2941640370694',
    exitLiquidityUsdDecimal: '2941335.5024091895',
    utilizationRateDecimal: '0.8313511284221964',
    providerFeeRateDecimal: '0',
    rewardAprs: Object.freeze([
      Object.freeze({
        assetSymbol: 'USDC',
        assetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        assetDecimals: 6,
        networkId: 'eip155:1',
        rateDecimal: '0.017398639912427037',
      }),
    ]),
    providerObservedAt: '2026-08-26T14:05:47.000Z',
    lastIndexedBlock: '25839874',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
]);

export const MORPHO_YIELD_SNAPSHOT = Object.freeze({
  schemaVersion: 1 as const,
  snapshotId: 'morpho-public-api-2026-08-26T14:14:54.580Z',
  capturedAt: '2026-08-26T14:14:54.580Z',
  staleAfter: '2026-08-27T14:14:54.580Z',
  use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY' as const,
  staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' as const,
  source: Object.freeze({
    providerId: 'MORPHO_PUBLIC_API',
    providerName: 'Morpho Public API',
    protocolId: 'MORPHO_BLUE',
    protocolName: 'Morpho Blue',
    reference: 'https://api.morpho.org/graphql',
    requestStartedAt: '2026-08-26T14:14:54.109Z',
    retrievedAt: '2026-08-26T14:14:54.580Z',
    requestBodySha256: '4bf463059bdb4f8afd45ce26a8ddc71cb064b10131c4f9ba95323c1342618d13',
    responseSha256: '5afd26e631dc47617a3c6e84d0e04e0ac286ef8f175997611aabe937849723b4',
    responseBytes: 4_762,
    rawResponseRetained: false as const,
    query: MORPHO_YIELD_SNAPSHOT_QUERY,
  }),
  opportunities,
  disclosures: Object.freeze([
    'Point-in-time public Morpho API capture; no live request occurs in the application.',
    'Base supply APY excludes reward APR; reward components remain separate.',
    'USD values are provider display values and are not settlement valuations.',
    'Available-to-borrow liquidity is an exit-liquidity proxy, not a withdrawal guarantee.',
    'Provider listing is captured; deposit and withdrawal availability were not verified.',
    'The recorded raw-response digest is capture metadata; the raw response is not retained.',
    'No opportunity has a risk, eligibility, or execution approval.',
  ]),
  mayAuthorizeFinancialAction: false as const,
});
