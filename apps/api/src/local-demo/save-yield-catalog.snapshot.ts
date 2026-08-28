/**
 * Immutable research-time capture for the Save (formerly Solend) main pool.
 *
 * Reserve state was read from the official public Solana RPC and identified
 * against the official Save production market configuration. This module does
 * no I/O and retains only non-executable, server-private local-demo evidence.
 */

export interface SaveYieldOpportunitySnapshot {
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
  readonly availableLiquidityUsdDecimal: string;
  readonly utilizationRateDecimal: string;
  /** Protocol share of borrow interest; not a depositor entry or withdrawal fee. */
  readonly protocolTakeRateDecimal: string;
  readonly providerObservedAt: string;
  readonly contextSlot: number;
  readonly lastUpdateSlot: number;
  readonly providerListed: true;
  readonly riskClassification: 'NOT_ASSESSED';
  readonly mayAuthorizeFinancialAction: false;
}

const opportunities: readonly SaveYieldOpportunitySnapshot[] = Object.freeze([
  Object.freeze({
    opportunityId:
      'solend:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY:BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
    marketId: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
    reserveId: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
    assetSymbol: 'USDC',
    assetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    assetDecimals: 6,
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    networkName: 'Solana',
    supplyApyRateDecimal: '0.02035785858499506',
    totalSupplyUsdDecimal: '22361108.292043261296455330735951113561',
    totalBorrowUsdDecimal: '16522350.95610992622941903620301953544388',
    availableLiquidityUsdDecimal: '5838758.08804183145367',
    utilizationRateDecimal: '0.7388878129204920274',
    protocolTakeRateDecimal: '0.2',
    providerObservedAt: '2026-08-27T00:02:40.000Z',
    contextSlot: 441_981_658,
    lastUpdateSlot: 441_980_637,
    providerListed: true,
    riskClassification: 'NOT_ASSESSED',
    mayAuthorizeFinancialAction: false,
  }),
]);

export const SAVE_YIELD_SNAPSHOT = Object.freeze({
  schemaVersion: 1 as const,
  snapshotId: 'save-official-sources-2026-08-27T00:08:51.427Z',
  capturedAt: '2026-08-27T00:08:51.427Z',
  staleAfter: '2026-08-28T00:08:51.427Z',
  use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY' as const,
  staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' as const,
  source: Object.freeze({
    providerId: 'SAVE_OFFICIAL_SOURCES',
    providerName: 'Save official sources',
    protocolId: 'SOLEND',
    protocolName: 'Solend',
    rpcReference: 'https://api.mainnet-beta.solana.com',
    rpcMethod: 'getAccountInfo',
    configurationReference:
      'https://api.save.finance/v1/markets/configs?scope=all&deployment=production',
    requestStartedAt: '2026-08-27T00:08:50.938Z',
    retrievedAt: '2026-08-27T00:08:51.427Z',
    requestBodySha256: '2941db8af5f6c9f1de4504686f076fe47450e57710ab2c1bc61effc3a34a0ba3',
    responseSha256: 'da1d8940bca670134d141bf33e7c0062dce12d975dbe423eb59a67ef40adeebb',
    accountDataSha256: 'cec996f11df59b3491bf800c520a780502fcf92f8f45cca04a428d21473c83d8',
    rawResponseRetained: false as const,
  }),
  opportunities,
  disclosures: Object.freeze([
    'Point-in-time official Solana RPC and Save configuration capture; no live request occurs in the application.',
    'Supply APY is the captured native supply APY; no reward or promotional APR is included.',
    'USD values are capture-time derived display values and are not settlement valuations.',
    'Available liquidity is retained separately and is not a withdrawal guarantee.',
    'Protocol take is a share of borrow interest, not a depositor entry or withdrawal fee.',
    'Provider listing is captured; deposit and withdrawal availability were not verified.',
    'The recorded request, response, and account-data digests are capture metadata; raw response bytes are not retained.',
    'The opportunity has no risk, eligibility, or execution approval.',
  ]),
  mayAuthorizeFinancialAction: false as const,
});
