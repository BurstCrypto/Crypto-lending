/**
 * Immutable research-time captures for additional decentralized lending providers.
 *
 * Every observation came from an official provider API, repository-backed
 * deployment, or public chain RPC. This module performs no I/O. The retained
 * fields are server-private, non-executable local-demo evidence only.
 */

export type AdditionalProviderId = 'COMPOUND' | 'MOONWELL' | 'SPARK' | 'VENUS' | 'EULER' | 'P0';

export type AdditionalProtocolId =
  'COMPOUND_III' | 'MOONWELL_V2' | 'SPARKLEND' | 'VENUS_CORE_POOL' | 'EULER_V2' | 'MARGINFI_V2';

export interface AdditionalProviderYieldOpportunitySnapshot {
  readonly opportunityId: string;
  readonly ecosystem: 'EVM' | 'SOLANA';
  readonly providerId: AdditionalProviderId;
  readonly providerName: 'Compound' | 'Moonwell' | 'Spark' | 'Venus' | 'Euler' | 'P0';
  readonly protocolId: AdditionalProtocolId;
  readonly protocolName:
    'Compound III' | 'Moonwell V2' | 'SparkLend' | 'Venus Core Pool' | 'Euler V2' | 'marginfi v2';
  readonly marketId: string;
  readonly assetSymbol: 'USDC';
  readonly assetContract: string;
  readonly assetDecimals: 6 | 18;
  readonly networkId:
    'eip155:1' | 'eip155:56' | 'eip155:8453' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  readonly networkName: 'Ethereum' | 'BNB Smart Chain' | 'Base' | 'Solana';
  /** Base supply APY, excluding reward and promotional APRs. */
  readonly supplyApyRateDecimal: string;
  readonly totalSupplyUsdDecimal: string;
  readonly totalBorrowUsdDecimal: string;
  readonly availableLiquidityUsdDecimal: string;
  readonly utilizationRateDecimal: string;
  readonly providerObservedAt: string;
  readonly providerListed: true;
  readonly riskClassification: 'NOT_ASSESSED';
  readonly mayAuthorizeFinancialAction: false;
  readonly source: Readonly<{
    kind: 'API' | 'ON_CHAIN';
    id: string;
    reference: string;
    retrievedAt: string;
    payloadSha256: string;
    attributes: readonly Readonly<{ key: string; value: string }>[];
  }>;
}

const opportunities: readonly AdditionalProviderYieldOpportunitySnapshot[] = Object.freeze([
  Object.freeze({
    opportunityId: 'compound-iii:eip155:8453:0xb125E6687d4313864e53df431d5425969c15Eb2F:USDC',
    ecosystem: 'EVM',
    providerId: 'COMPOUND',
    providerName: 'Compound',
    protocolId: 'COMPOUND_III',
    protocolName: 'Compound III',
    marketId: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    assetSymbol: 'USDC',
    assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetDecimals: 6,
    networkId: 'eip155:8453',
    networkName: 'Base',
    supplyApyRateDecimal: '0.032925296371662236248258664468970525',
    totalSupplyUsdDecimal: '9295911.9708141346698',
    totalBorrowUsdDecimal: '8364996.22185687554610',
    availableLiquidityUsdDecimal: '1600690.53276698187144',
    utilizationRateDecimal: '0.899857511131943922',
    providerObservedAt: '2026-08-27T00:49:25.000Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
    source: Object.freeze({
      kind: 'ON_CHAIN',
      id: 'eip155:8453:50501209:0xb125E6687d4313864e53df431d5425969c15Eb2F',
      reference:
        'https://raw.githubusercontent.com/compound-finance/comet/f766f51583c23acc33b2a7824654ef2029a96804/deployments/base/usdc/roots.json',
      retrievedAt: '2026-08-27T00:49:45.144Z',
      payloadSha256: '6e63f5754f6f3536df9354788696635694bea9b2bd471a5d649bfb2f0bcbb7bb',
      attributes: Object.freeze([
        Object.freeze({ key: 'chain.block', value: '50501209' }),
        Object.freeze({
          key: 'chain.block_hash',
          value: '0x289e6ec3606076f4baca2b2d52dbbd64f7e75d185f871d88c6f64c86ba8f4dc0',
        }),
        Object.freeze({ key: 'rate.raw_supply_rate_per_second', value: '1027234601' }),
        Object.freeze({ key: 'rate.raw_scale', value: '1000000000000000000' }),
        Object.freeze({ key: 'rate.normalization', value: 'PER_SECOND_COMPOUNDING' }),
        Object.freeze({
          key: 'snapshot.request_manifest_sha256',
          value: '08b9cee85820ec2c9cb5afed2edf9ecd3a3342098e7c02ac601fb2118ffe316c',
        }),
      ]),
    }),
  }),
  Object.freeze({
    opportunityId: 'moonwell-v2:eip155:8453:0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22:USDC',
    ecosystem: 'EVM',
    providerId: 'MOONWELL',
    providerName: 'Moonwell',
    protocolId: 'MOONWELL_V2',
    protocolName: 'Moonwell V2',
    marketId: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
    assetSymbol: 'USDC',
    assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetDecimals: 6,
    networkId: 'eip155:8453',
    networkName: 'Base',
    supplyApyRateDecimal: '0.039197949967',
    totalSupplyUsdDecimal: '13386202.977347787',
    totalBorrowUsdDecimal: '11295766.222734576',
    availableLiquidityUsdDecimal: '2090436.7546132114',
    utilizationRateDecimal: '0.843836466685089',
    providerObservedAt: '2026-08-27T00:54:36.249Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
    source: Object.freeze({
      kind: 'API',
      id: 'eip155:8453:0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
      reference: 'https://api.moonwell.fi/v1/markets/USDC?chain=base',
      retrievedAt: '2026-08-27T00:54:36.274Z',
      payloadSha256: '59e7fc21ae8215f28d10867a6ea4ef21ff846fe71db586ddcf60b9fceb4e8087',
      attributes: Object.freeze([
        Object.freeze({ key: 'market.deprecated', value: 'false' }),
        Object.freeze({ key: 'rate.provider_field', value: 'baseSupplyApy' }),
        Object.freeze({ key: 'rate.provider_unit', value: 'PERCENT' }),
        Object.freeze({
          key: 'snapshot.request_sha256',
          value: '7f1d78d9139768e54e6d253aab590645092c1de0a535addc9ac70fe24d0fccc3',
        }),
      ]),
    }),
  }),
  Object.freeze({
    opportunityId: 'sparklend:eip155:1:0xC13e21B648A5Ee794902342038FF3aDAB66BE987:USDC',
    ecosystem: 'EVM',
    providerId: 'SPARK',
    providerName: 'Spark',
    protocolId: 'SPARKLEND',
    protocolName: 'SparkLend',
    marketId: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987',
    assetSymbol: 'USDC',
    assetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetDecimals: 6,
    networkId: 'eip155:1',
    networkName: 'Ethereum',
    supplyApyRateDecimal: '0.035334017662430897',
    totalSupplyUsdDecimal: '22984833.677647',
    totalBorrowUsdDecimal: '21166520.241653',
    availableLiquidityUsdDecimal: '1820545.257332',
    utilizationRateDecimal: '0.92089072901309132',
    providerObservedAt: '2026-08-27T00:52:23.000Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
    source: Object.freeze({
      kind: 'ON_CHAIN',
      id: 'eip155:1:25843089:0xC13e21B648A5Ee794902342038FF3aDAB66BE987',
      reference:
        'https://github.com/sparkdotfi/spark-address-registry/blob/master/src/SparkLend.sol',
      retrievedAt: '2026-08-27T00:52:35.867Z',
      payloadSha256: 'aed73f7660ef8c096abc6162bca88b1940cc2278f53474f50a3fa1144da5c6de',
      attributes: Object.freeze([
        Object.freeze({ key: 'chain.block', value: '25843089' }),
        Object.freeze({
          key: 'chain.block_hash',
          value: '0xaac59312635e76fd3ecc1ac5ed1496d04876d99056063ebf5a12d541decb992a',
        }),
        Object.freeze({
          key: 'rate.raw_liquidity_rate_ray',
          value: '34724097051944030178644477',
        }),
        Object.freeze({ key: 'rate.normalization', value: 'PER_SECOND_COMPOUNDING' }),
      ]),
    }),
  }),
  Object.freeze({
    opportunityId: 'venus-core:eip155:56:0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8:USDC',
    ecosystem: 'EVM',
    providerId: 'VENUS',
    providerName: 'Venus',
    protocolId: 'VENUS_CORE_POOL',
    protocolName: 'Venus Core Pool',
    marketId: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
    assetSymbol: 'USDC',
    assetContract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    assetDecimals: 18,
    networkId: 'eip155:56',
    networkName: 'BNB Smart Chain',
    supplyApyRateDecimal: '0.02289567391536908738',
    totalSupplyUsdDecimal: '45924901.2878484361469215976560379961627656947060030369328328',
    totalBorrowUsdDecimal: '28503750.8032491493645741178089943779158263',
    availableLiquidityUsdDecimal: '17421167.5984421663845304641362419128910002',
    utilizationRateDecimal: '0.620660034184790711809856977834273221',
    providerObservedAt: '2026-08-27T00:57:44.760Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
    source: Object.freeze({
      kind: 'API',
      id: 'eip155:56:0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
      reference:
        'https://api.venus.io/markets?chainId=56&address=0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8&limit=1',
      retrievedAt: '2026-08-27T00:57:44.760Z',
      payloadSha256: 'b4db9cb6229cec089e466090d5df69462c42f2712ac4f8cabfed7f86274980e7',
      attributes: Object.freeze([
        Object.freeze({ key: 'api.accept_version', value: 'next' }),
        Object.freeze({ key: 'market.listed', value: 'true' }),
        Object.freeze({ key: 'market.paused_actions_bitmap', value: '0' }),
        Object.freeze({ key: 'market.price_valid', value: 'true' }),
        Object.freeze({
          key: 'snapshot.request_sha256',
          value: '6b2fc562cff370deda00ed34f0b9b32fbddc1993a2d2252d7c25b33bd199f5af',
        }),
      ]),
    }),
  }),
  Object.freeze({
    opportunityId: 'euler-v2:eip155:8453:0x07954BEB7e137101A7cbb3e47864C684aEC50524:USDC',
    ecosystem: 'EVM',
    providerId: 'EULER',
    providerName: 'Euler',
    protocolId: 'EULER_V2',
    protocolName: 'Euler V2',
    marketId: '0x07954BEB7e137101A7cbb3e47864C684aEC50524',
    assetSymbol: 'USDC',
    assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetDecimals: 6,
    networkId: 'eip155:8453',
    networkName: 'Base',
    supplyApyRateDecimal: '0.09226853285021493',
    totalSupplyUsdDecimal: '620734.283639763',
    totalBorrowUsdDecimal: '571219.1153637259',
    availableLiquidityUsdDecimal: '49515.1682760371',
    utilizationRateDecimal: '0.9202312977048763',
    providerObservedAt: '2026-08-27T00:42:17.000Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
    source: Object.freeze({
      kind: 'API',
      id: 'eip155:8453:0x07954BEB7e137101A7cbb3e47864C684aEC50524',
      reference:
        'https://v3.euler.finance/v3/evk/vaults?chainId=8453&asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&minTvl=100000&limit=100',
      retrievedAt: '2026-08-27T00:50:57.272Z',
      payloadSha256: 'f99030d6771616d784730f0b7fa26c3acfbc648dbb7f9cce4808a5321f0cc592',
      attributes: Object.freeze([
        Object.freeze({ key: 'vault.visibility', value: 'visible' }),
        Object.freeze({ key: 'vault.explorable_lend', value: 'true' }),
        Object.freeze({ key: 'vault.type', value: 'evk' }),
        Object.freeze({ key: 'rate.provider_unit', value: 'PERCENT' }),
      ]),
    }),
  }),
  Object.freeze({
    opportunityId:
      'marginfi-v2:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB:USDC',
    ecosystem: 'SOLANA',
    providerId: 'P0',
    providerName: 'P0',
    protocolId: 'MARGINFI_V2',
    protocolName: 'marginfi v2',
    marketId: '2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB',
    assetSymbol: 'USDC',
    assetContract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    assetDecimals: 6,
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    networkName: 'Solana',
    supplyApyRateDecimal: '0.031252082831978',
    totalSupplyUsdDecimal: '9697689.250588862922',
    totalBorrowUsdDecimal: '7629518.824874962349',
    availableLiquidityUsdDecimal: '2068170.425713900573',
    utilizationRateDecimal: '0.78673574990162556888',
    providerObservedAt: '2026-08-27T01:02:13.000Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
    source: Object.freeze({
      kind: 'ON_CHAIN',
      id: 'solana:441990796:2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB',
      reference: 'https://github.com/0dotxyz/p0-ts-sdk',
      retrievedAt: '2026-08-27T01:04:47.998Z',
      payloadSha256: '04fff651b4baa1e7de05b436dc508f471c6f3200a49e257aaf1df75398a795b0',
      attributes: Object.freeze([
        Object.freeze({ key: 'chain.slot', value: '441990796' }),
        Object.freeze({ key: 'market.asset_tag', value: 'DEFAULT' }),
        Object.freeze({ key: 'market.operational_state', value: 'Operational' }),
        Object.freeze({ key: 'rate.raw_lending_apr', value: '0.030773732397326756' }),
        Object.freeze({ key: 'rate.normalization', value: 'HOURLY_COMPOUNDING' }),
        Object.freeze({ key: 'rate.compounding_periods_per_year', value: '8766' }),
        Object.freeze({
          key: 'rate.compounding_convention',
          value: 'SDK_365.25_DAY_YEAR_HOURLY',
        }),
        Object.freeze({ key: 'sdk.package', value: '@0dotxyz/p0-ts-sdk' }),
        Object.freeze({ key: 'sdk.version', value: '2.7.3' }),
        Object.freeze({
          key: 'sdk.commit',
          value: 'ebfe29cee843307242144039e604050f86e9d054',
        }),
        Object.freeze({ key: 'rpc.reference', value: 'https://api.mainnet-beta.solana.com' }),
        Object.freeze({ key: 'rpc.method', value: 'getAccountInfo' }),
        Object.freeze({
          key: 'valuation.usd_basis',
          value: 'USDC_UNITS_AT_LOCAL_1_USD_DISPLAY_PROXY',
        }),
        Object.freeze({
          key: 'snapshot.bank_account_sha256',
          value: '04fff651b4baa1e7de05b436dc508f471c6f3200a49e257aaf1df75398a795b0',
        }),
      ]),
    }),
  }),
]);

export const ADDITIONAL_PROVIDER_YIELD_SNAPSHOT = Object.freeze({
  schemaVersion: 1 as const,
  snapshotId: 'additional-providers-2026-08-27T01:04:48.000Z',
  capturedAt: '2026-08-27T01:04:48.000Z',
  staleAfter: '2026-08-28T01:04:48.000Z',
  use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY' as const,
  staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' as const,
  source: Object.freeze({
    providerId: 'MULTI_PROVIDER_OFFICIAL_SOURCES',
    providerName: 'Official provider APIs and chain sources',
    rawResponseRetained: false as const,
  }),
  opportunities,
  disclosures: Object.freeze([
    'Point-in-time official-source captures; no live provider request occurs in the application.',
    'Only base supply APY is retained; reward and promotional APRs are excluded.',
    'Compound, Spark, and P0 APYs are transparent normalizations of official raw rates.',
    "P0 APY uses the pinned SDK's 365.25-day, 8,766-period hourly convention.",
    'P0 USDC token units use a local $1 display proxy; no price-oracle request was made.',
    'USD values are capture-time display values and are not settlement valuations.',
    'Available liquidity is a capacity proxy and is not a withdrawal guarantee.',
    'Provider listing is captured; deposit and withdrawal availability were not verified.',
    'No opportunity has a risk, eligibility, or execution approval.',
  ]),
  mayAuthorizeFinancialAction: false as const,
});
