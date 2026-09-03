export enum SmartLendingExternalFeedDestination {
  AaveV3EthereumMarket = 'AAVE_V3_ETHEREUM_MARKET',
  DefiLlamaYields = 'DEFILLAMA_YIELDS',
  LifiQuote = 'LIFI_QUOTE',
}

export type SmartLendingExternalFeedGetDestination =
  | SmartLendingExternalFeedDestination.DefiLlamaYields
  | SmartLendingExternalFeedDestination.LifiQuote;

/** DefiLlama's reviewed pool snapshot endpoint accepts no query parameters. */
export type DefiLlamaYieldsQuery = Readonly<Record<string, never>>;

export type LifiQuoteChain = '1' | 'SOL';

/**
 * Closed query contract for LI.FI's read-only quote endpoint. Values remain
 * strings so exact atomic amounts never cross a JavaScript number boundary.
 */
export interface LifiQuoteQuery {
  readonly fromChain: LifiQuoteChain;
  readonly toChain: LifiQuoteChain;
  readonly fromToken: string;
  readonly toToken: string;
  readonly fromAmount: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly slippage: '0.005';
  readonly integrator: 'crypto-lending';
  readonly allowBridges: string;
  readonly denyExchanges: 'all';
  readonly allowDestinationCall: 'false';
  readonly order: 'CHEAPEST';
}

export interface SmartLendingExternalFeedQueryByDestination {
  readonly [SmartLendingExternalFeedDestination.DefiLlamaYields]: DefiLlamaYieldsQuery;
  readonly [SmartLendingExternalFeedDestination.LifiQuote]: LifiQuoteQuery;
}
