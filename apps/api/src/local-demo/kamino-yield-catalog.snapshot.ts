/**
 * Immutable research-time capture from the official Kamino Public API.
 *
 * This module performs no I/O. The selected response fields are retained only
 * as server-private, non-executable local-demo evidence. Provider listing does
 * not establish deposit, withdrawal, risk, eligibility, or execution approval.
 */

export interface KaminoYieldOpportunitySnapshot {
  readonly opportunityId: string;
  readonly marketId: string;
  readonly reserveId: string;
  readonly assetSymbol: 'USDC';
  readonly assetMint: string;
  readonly assetDecimals: 6;
  readonly networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  readonly networkName: 'Solana';
  readonly supplyApyRateDecimal: string;
  readonly totalSupplyUsdDecimal: string;
  readonly totalBorrowUsdDecimal: string;
  readonly providerObservedAt: string;
  readonly providerListed: true;
  readonly riskClassification: 'NOT_ASSESSED';
  readonly mayAuthorizeFinancialAction: false;
}

const opportunities: readonly KaminoYieldOpportunitySnapshot[] = Object.freeze([
  Object.freeze({
    opportunityId:
      'kamino-lend:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF:D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
    marketId: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
    reserveId: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
    assetSymbol: 'USDC',
    assetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    assetDecimals: 6,
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    networkName: 'Solana',
    supplyApyRateDecimal: '0.04542148187048922',
    totalSupplyUsdDecimal: '109125834.79081585224',
    totalBorrowUsdDecimal: '100844813.2475332357427599269456163239444',
    providerObservedAt: '2026-08-26T21:20:06.659Z',
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
]);

export const KAMINO_YIELD_SNAPSHOT = Object.freeze({
  schemaVersion: 1 as const,
  snapshotId: 'kamino-public-api-2026-08-26T21:20:06.659Z',
  capturedAt: '2026-08-26T21:20:06.659Z',
  staleAfter: '2026-08-27T21:20:06.659Z',
  use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY' as const,
  staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' as const,
  source: Object.freeze({
    providerId: 'KAMINO_PUBLIC_API',
    providerName: 'Kamino Public API',
    protocolId: 'KAMINO_LEND',
    protocolName: 'Kamino Lend',
    reference:
      'https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics?env=mainnet-beta',
    responseSha256: '5e818a2e995ef0b0e1cfc1f6a2762cac5825a4d470d0bf1835e52b5f9b16f109',
    rawResponseRetained: false as const,
  }),
  opportunities,
  disclosures: Object.freeze([
    'Point-in-time official Kamino Public API capture; no live request occurs in the application.',
    'Supply APY is the captured base supply APY; no reward APY is included.',
    'USD values are provider display values and are not settlement valuations.',
    'Total supply less total borrow is used only as an exit-liquidity proxy.',
    'Provider listing is captured; deposit and withdrawal availability were not verified.',
    'The recorded response digest is capture metadata; the raw response is not retained.',
    'The opportunity has no risk, eligibility, or execution approval.',
  ]),
  mayAuthorizeFinancialAction: false as const,
});
