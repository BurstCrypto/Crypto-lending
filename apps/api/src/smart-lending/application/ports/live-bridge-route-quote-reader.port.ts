import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';

export const LIVE_BRIDGE_ROUTE_QUOTE_READER = Symbol('LIVE_BRIDGE_ROUTE_QUOTE_READER');

export interface LiveBridgeRouteEndpoint {
  readonly networkId: MainnetLaunchNetworkId;
  readonly assetId: string;
  readonly assetDecimals: 6;
  readonly walletAddress: string;
}

export interface ReadLiveRoundTripBridgeQuoteRequest {
  readonly positionId: string;
  readonly opportunityId: string;
  readonly source: LiveBridgeRouteEndpoint;
  readonly destination: LiveBridgeRouteEndpoint;
  readonly sourceAmountAtomic: bigint;
  /** Conservative USD value of the complete source amount at scale 18. */
  readonly sourceAmountUsdMantissa: bigint;
  readonly allowedBridgeProviderIds: readonly string[];
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface LiveBridgeLegQuote {
  readonly quoteReferenceId: string;
  readonly bridgeProviderId: string;
  readonly sourceAmountAtomic: bigint;
  readonly minimumDestinationAmountAtomic: bigint;
  readonly networkGasCostUsdMantissa: bigint;
  /**
   * Conservative source-value loss implied by the minimum output, plus every
   * upstream fee explicitly marked as not included. Provider/routing fees
   * already taken from the transferred asset must not be added a second time.
   */
  readonly transferValueLossUsdMantissa: bigint;
}

export interface LiveRoundTripBridgeQuote {
  readonly schemaVersion: 1;
  readonly adapterId: 'lifi-round-trip-quote-v1';
  readonly quoteReferenceId: string;
  readonly routeReferenceId: string;
  readonly positionId: string;
  readonly opportunityId: string;
  readonly sourceNetworkId: MainnetLaunchNetworkId;
  readonly destinationNetworkId: MainnetLaunchNetworkId;
  readonly sourceAssetId: string;
  readonly destinationAssetId: string;
  readonly quotedAt: string;
  readonly validUntil: string;
  readonly entry: LiveBridgeLegQuote;
  readonly exit: LiveBridgeLegQuote;
  readonly use: 'QUOTE_EVIDENCE_ONLY';
  readonly includesTransactionPayload: false;
  readonly mayAuthorizeTransaction: false;
  readonly mayExecuteTransaction: false;
}

export interface LiveBridgeRouteQuoteReader {
  readRoundTripQuote(
    request: ReadLiveRoundTripBridgeQuoteRequest,
  ): Promise<LiveRoundTripBridgeQuote>;
}
