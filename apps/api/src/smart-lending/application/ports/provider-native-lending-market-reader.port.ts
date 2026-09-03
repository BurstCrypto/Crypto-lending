import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { SupportedStablecoin } from '../../../blockchain/domain/supported-asset-registry';
import type { SmartLendingProviderId } from './live-lending-market-feed.port';

export const PROVIDER_NATIVE_LENDING_MARKET_READER = Symbol(
  'PROVIDER_NATIVE_LENDING_MARKET_READER',
);

export interface ReadProviderNativeLendingMarketsRequest {
  /** Trusted server timestamp; implementations must not substitute a caller-authored clock. */
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface ProviderNativeLendingMarketObservation {
  readonly providerId: SmartLendingProviderId;
  readonly protocolId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly marketId: string;
  readonly assetId: string;
  readonly assetSymbol: SupportedStablecoin;
  readonly assetDecimals: 6;
  /** Provider-reported base supply APY only, conservatively floored to whole basis points. */
  readonly baseSupplyApyBasisPoints: bigint;
  readonly totalSuppliedAtomic: bigint;
  /** Provider-native status only; UNKNOWN must never be interpreted as open or eligible. */
  readonly providerSupplyStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  readonly evidenceReferenceId: string;
}

/**
 * Provider-native data still requires independently authenticated deployment,
 * chain-freshness, valuation, and risk evidence before recommendation use.
 */
export interface ProviderNativeLendingMarketSnapshot {
  readonly schemaVersion: 1;
  /** Adapter-owned stable identifier; each implementation must enforce its exact value. */
  readonly sourceId: string;
  readonly use: 'PROVIDER_NATIVE_CORROBORATION_ONLY';
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly snapshotId: string;
  readonly fingerprintSha256: string;
  readonly sourceRequestFingerprintSha256: string;
  readonly retrievedAt: string;
  readonly validUntil: string;
  readonly providerCoverage: readonly SmartLendingProviderId[];
  readonly observations: readonly ProviderNativeLendingMarketObservation[];
}

export interface ProviderNativeLendingMarketReader {
  readCurrentMarkets(
    request: ReadProviderNativeLendingMarketsRequest,
  ): Promise<ProviderNativeLendingMarketSnapshot>;
}
