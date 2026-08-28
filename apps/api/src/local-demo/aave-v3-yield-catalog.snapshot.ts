/**
 * Immutable research-time capture from the official Aave V3 public GraphQL API.
 *
 * This module performs no I/O. The retained fields are server-private,
 * point-in-time local-demo evidence only. A listed reserve is not a risk,
 * eligibility, deposit, withdrawal, or execution approval.
 */

export interface AaveV3YieldOpportunitySnapshot {
  readonly opportunityId: string;
  readonly marketId: string;
  readonly assetSymbol: 'USDC' | 'USDT';
  readonly assetContract: string;
  readonly assetDecimals: 6;
  readonly networkId: 'eip155:1' | 'eip155:8453';
  readonly networkName: 'Ethereum' | 'Base';
  readonly supplyApyRateDecimal: string;
  readonly totalSupplyUsdDecimal: string;
  readonly totalBorrowUsdDecimal: string;
  readonly availableLiquidityUsdDecimal: string;
  readonly utilizationRateDecimal: string;
  /** Aave reserve factor; this is not a user entry, withdrawal, or routing fee. */
  readonly reserveFactorRateDecimal: string;
  readonly providerObservedAt: string;
  readonly providerListed: true;
  readonly riskClassification: 'NOT_ASSESSED';
  readonly mayAuthorizeFinancialAction: false;
}

const opportunities: readonly AaveV3YieldOpportunitySnapshot[] = Object.freeze([
  Object.freeze({
    opportunityId:
      'aave-v3:eip155:8453:0xA238Dd80C259a72e81d7e4664a9801593F98d1c5:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    marketId: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    assetSymbol: 'USDC',
    assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetDecimals: 6,
    networkId: 'eip155:8453',
    networkName: 'Base',
    supplyApyRateDecimal: '0.030971355791245742167875921',
    totalSupplyUsdDecimal: '177480406.6310846789128',
    totalBorrowUsdDecimal: '146118149.1126589071056',
    availableLiquidityUsdDecimal: '31362226.6433556342682',
    utilizationRateDecimal: '0.823291862495998711203455152',
    reserveFactorRateDecimal: '0.10',
    providerObservedAt: '2026-08-27T00:09:16.195Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
  Object.freeze({
    opportunityId:
      'aave-v3:eip155:1:0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    marketId: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    assetSymbol: 'USDC',
    assetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    assetDecimals: 6,
    networkId: 'eip155:1',
    networkName: 'Ethereum',
    supplyApyRateDecimal: '0.098884748614322825628319949',
    totalSupplyUsdDecimal: '2079223526.38491297289368',
    totalBorrowUsdDecimal: '2025270598.6261549579563',
    availableLiquidityUsdDecimal: '53952926.20723198965879',
    utilizationRateDecimal: '0.974051406420310022203987122',
    reserveFactorRateDecimal: '0.10',
    providerObservedAt: '2026-08-27T00:09:16.195Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
  Object.freeze({
    opportunityId:
      'aave-v3:eip155:1:0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2:0xdAC17F958D2ee523a2206206994597C13D831ec7',
    marketId: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    assetSymbol: 'USDT',
    assetContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    assetDecimals: 6,
    networkId: 'eip155:1',
    networkName: 'Ethereum',
    supplyApyRateDecimal: '0.041491952326748560387498417',
    totalSupplyUsdDecimal: '2922148236.32074954660324',
    totalBorrowUsdDecimal: '2708783408.16643855376664',
    availableLiquidityUsdDecimal: '213364827.32304709491786',
    utilizationRateDecimal: '0.92698357163003176629998691',
    reserveFactorRateDecimal: '0.10',
    providerObservedAt: '2026-08-27T00:09:16.195Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
]);

export const AAVE_V3_YIELD_SNAPSHOT = Object.freeze({
  schemaVersion: 1 as const,
  snapshotId: 'aave-v3-public-api-2026-08-27T00:09:16.195Z',
  capturedAt: '2026-08-27T00:09:16.195Z',
  staleAfter: '2026-08-28T00:09:16.195Z',
  use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY' as const,
  staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' as const,
  source: Object.freeze({
    providerId: 'AAVE_PUBLIC_API',
    providerName: 'Aave Public API',
    protocolId: 'AAVE_V3',
    protocolName: 'Aave V3',
    reference: 'https://api.v3.aave.com/graphql',
    requestStartedAt: '2026-08-27T00:09:15.945Z',
    retrievedAt: '2026-08-27T00:09:16.195Z',
    requestBodySha256: '19e7ab9e9e80e7ebf47ecaaa2b89cd9721161cb82cf8623897420d12dcc1082e',
    responseSha256: 'ade2f90a3ba5542cd1d502ae6dea1f8b95ef1dfac80a7a5990389500b056c134',
    responseBytes: 2_327,
    rawResponseRetained: false as const,
  }),
  opportunities,
  disclosures: Object.freeze([
    'Point-in-time official Aave V3 API capture; no live request occurs in the application.',
    'Supply APY is the captured native supply APY; no reward or promotional APR is included.',
    'USD values are provider display values and are not settlement valuations.',
    'Available liquidity is captured separately and is not a withdrawal guarantee.',
    'Reserve factor is protocol interest allocation, not a user entry, withdrawal, or routing fee.',
    'Provider listing is captured; deposit and withdrawal availability were not verified.',
    'The recorded request and response digests are capture metadata; the raw response is not retained.',
    'No opportunity has a risk, eligibility, or execution approval.',
  ]),
  mayAuthorizeFinancialAction: false as const,
});
