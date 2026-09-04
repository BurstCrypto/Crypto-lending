import type { SupportedStablecoin } from '../../../blockchain/domain/supported-asset-registry';
import type {
  StablecoinPriceConfidence,
  StablecoinValuationSourceId,
} from '../../domain/stablecoin-valuation-policy';

export type MainnetStablecoin = SupportedStablecoin;

export type VerifiedStablecoinPriceVerificationMethod =
  | 'PYTH_WORMHOLE_BINARY_UPDATE_SIGNATURE_VERIFIED'
  | 'CHAINLINK_ETHEREUM_FINALIZED_ONCHAIN_ROUND_VERIFIED';

export interface VerifiedStablecoinUsdPriceV1 {
  readonly mantissa: string;
  readonly scale: 8;
}

/**
 * Evidence emitted only after a future source implementation has authenticated
 * the provider update. Every identity needed to interpret the price is carried
 * with the value; no ambient provider, policy, or asset selection is trusted.
 */
export interface VerifiedStablecoinPriceEvidenceV1 {
  readonly schemaVersion: 1;
  readonly policyId: 'KAN-66';
  readonly policyVersion: 1;
  readonly policyDecisionSha256: string;
  readonly registryEnvironment: 'MAINNET';
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly sourceId: StablecoinValuationSourceId;
  readonly sourceReference: string;
  readonly stablecoin: MainnetStablecoin;
  readonly authenticatedSourceUpdateId: string;
  readonly monotonicSourceSequence: string;
  readonly usdPrice: VerifiedStablecoinUsdPriceV1;
  readonly confidence: StablecoinPriceConfidence;
  readonly pricedAt: string;
  readonly observedAt: string;
  readonly verificationMethod: VerifiedStablecoinPriceVerificationMethod;
  readonly verifiedAt: string;
  readonly evidenceActorReferenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly mayAuthorizeFinancialAction: false;
}

/**
 * Production-facing, read-only oracle boundary. The mandatory signal belongs
 * to the caller and must be forwarded unchanged by any future implementation.
 * Results remain untrusted until the pure ingestion boundary validates them.
 */
export interface VerifiedStablecoinPriceSourcePort {
  read(stablecoin: MainnetStablecoin, signal: AbortSignal): Promise<unknown>;
}
