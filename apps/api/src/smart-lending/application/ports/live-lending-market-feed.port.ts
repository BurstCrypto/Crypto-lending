import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';

export const LIVE_LENDING_MARKET_FEED = Symbol('LIVE_LENDING_MARKET_FEED');

export const SMART_LENDING_PROVIDER_IDS = Object.freeze([
  'aave',
  'morpho',
  'compound',
  'spark',
  'euler',
  'gearbox',
  'kamino',
  'save',
  'project-0',
  'jupiter',
] as const);

export type SmartLendingProviderId = (typeof SMART_LENDING_PROVIDER_IDS)[number];

export interface ReadLiveLendingMarketsRequest {
  /** Trusted server timestamp; the adapter must not use a caller-authored clock. */
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface LiveLendingMarketObservation {
  readonly providerId: SmartLendingProviderId;
  readonly networkId: MainnetLaunchNetworkId;
  readonly marketId: string;
  readonly assetId: string;
  readonly assetSymbol: 'USDC' | 'USDT' | 'PYUSD';
  readonly assetDecimals: 6;
  /** Base supply APY only, rounded down to whole basis points. */
  readonly grossApyBasisPoints: bigint;
  /** Informational TVL; it is never interpreted as deposit or exit capacity. */
  readonly totalValueLockedUsdMantissa: bigint;
  readonly evidenceReferenceId: string;
}

/**
 * A cross-provider aggregate is useful for discovery and divergence checks, but
 * it does not prove provider pause state, caps, fees, or deployment identity.
 * Consequently this contract can never directly establish recommendation
 * eligibility.
 */
export interface LiveLendingMarketSnapshot {
  readonly schemaVersion: 1;
  readonly source: 'DEFILLAMA_YIELDS';
  readonly use: 'INDICATIVE_CORROBORATION_ONLY';
  readonly mayEstablishRecommendationEligibility: false;
  readonly snapshotId: string;
  readonly fingerprintSha256: string;
  readonly retrievedAt: string;
  readonly validUntil: string;
  readonly providerCoverage: readonly SmartLendingProviderId[];
  readonly observations: readonly LiveLendingMarketObservation[];
}

export interface LiveLendingMarketFeed {
  readCurrentMarkets(request: ReadLiveLendingMarketsRequest): Promise<LiveLendingMarketSnapshot>;
}
