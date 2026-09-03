import type { FeeAwareRouteCostQuote } from '../../domain/fee-aware-allocation';
import type { ApprovedLendingOpportunity } from './approved-lending-opportunity-snapshot-reader.port';
import type { RoutableCapitalPosition } from './routable-capital-position-snapshot-reader.port';
import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { AccountId } from '../../../accounts/domain/account-profile';

export const FULL_LIFECYCLE_COST_QUOTE_READER = Symbol('FULL_LIFECYCLE_COST_QUOTE_READER');

export interface LifecycleQuoteWalletEndpoint {
  readonly walletId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly walletAddress: string;
  /** Null means the source position wallet is also the destination. */
  readonly selectionReferenceId: string | null;
}

export interface ReadFullLifecycleCostQuoteRequest {
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  /** Aggregate composer deadline, included in `requestFingerprintSha256`. */
  readonly deadlineAt: string;
  /** Aborts at the aggregate deadline; implementations must stop their own I/O promptly. */
  readonly signal: AbortSignal;
  readonly policyReferenceId: string;
  readonly policyApprovalReferenceId: string;
  readonly position: RoutableCapitalPosition;
  readonly opportunity: ApprovedLendingOpportunity;
  readonly destinationWallet: LifecycleQuoteWalletEndpoint;
  readonly allowedBridgeProviderIds: readonly string[];
  readonly crossChainConsiderationConsentReferenceId: string | null;
  readonly crossChainQuoteDisclosureConsentReferenceId: string | null;
  /** SHA-256 of every immutable request field above; the runtime signal is excluded. */
  readonly requestFingerprintSha256: string;
}

export interface FullLifecycleCostQuoteResult {
  readonly schemaVersion: 1;
  readonly use: 'FULL_LIFECYCLE_COST_QUOTE';
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  readonly policyReferenceId: string;
  /** Must exactly echo the request fingerprint supplied by the composer. */
  readonly requestFingerprintSha256: string;
  readonly quote: FeeAwareRouteCostQuote;
}

/**
 * Trusted high-level quote boundary. Implementations own all thirteen USD cost
 * categories and may use the read-only LI.FI adapter only for cross-chain legs.
 */
export interface FullLifecycleCostQuoteReader {
  readFullLifecycleCostQuote(
    request: ReadFullLifecycleCostQuoteRequest,
  ): Promise<FullLifecycleCostQuoteResult>;
}
