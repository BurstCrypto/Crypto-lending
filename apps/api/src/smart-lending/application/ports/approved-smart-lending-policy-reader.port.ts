import type { AccountId } from '../../../accounts/domain/account-profile';
import type {
  FeeAwareAllocationExposurePolicy,
  FeeAwareCrossChainPolicy,
} from '../../domain/fee-aware-allocation';
import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';

export const APPROVED_SMART_LENDING_POLICY_READER = Symbol('APPROVED_SMART_LENDING_POLICY_READER');

export interface ApprovedCrossChainNetworkPair {
  readonly sourceNetworkId: MainnetLaunchNetworkId;
  readonly destinationNetworkId: MainnetLaunchNetworkId;
}

interface AccountBoundCrossChainConsent {
  readonly accountId: AccountId;
  /** Must match the enclosing approved policy snapshot. */
  readonly approvalReferenceId: string;
  readonly consentReferenceId: string;
  readonly grantedAt: string;
  readonly expiresAt: string;
  /** Exact account-owned wallet IDs approved for both sides of a quote. */
  readonly approvedWalletIds: readonly string[];
  /** Exact directed mainnet pairs approved by this consent. */
  readonly approvedDirectedNetworkPairs: readonly ApprovedCrossChainNetworkPair[];
}

/** Evidence binding for the domain opt-in retained in `crossChainPolicy`. */
export interface CrossChainConsiderationConsent extends AccountBoundCrossChainConsent {
  readonly scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS';
}

export interface CrossChainQuoteDisclosureConsent extends AccountBoundCrossChainConsent {
  readonly scope: 'DISCLOSE_WALLET_ADDRESSES_FOR_CROSS_CHAIN_QUOTE';
  readonly providerId: 'lifi';
}

export interface ApprovedSmartLendingPolicySnapshot {
  readonly schemaVersion: 1;
  readonly use: 'APPROVED_SMART_LENDING_RECOMMENDATION_POLICY';
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  readonly policyReferenceId: string;
  readonly approvalReferenceId: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly holdingPeriodDays: bigint;
  readonly maximumQuoteAgeSeconds: bigint;
  readonly maximumOpportunityAgeSeconds: bigint;
  readonly minimumNetBenefitUsdMantissa: bigint;
  readonly crossChainPolicy: FeeAwareCrossChainPolicy;
  readonly exposurePolicy: FeeAwareAllocationExposurePolicy;
  /** Bounds quote fan-out; implementations must never silently truncate candidates. */
  readonly maximumCandidateCount: number;
  readonly crossChainConsiderationConsent: CrossChainConsiderationConsent | null;
  readonly crossChainQuoteDisclosureConsent: CrossChainQuoteDisclosureConsent | null;
}

export interface ReadApprovedSmartLendingPolicyRequest {
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  /** Shared aggregate composer deadline for all evidence and quote reads. */
  readonly deadlineAt: string;
  /** Implementations must stop their own I/O promptly when aborted. */
  readonly signal: AbortSignal;
}

export interface ApprovedSmartLendingPolicyReader {
  readApprovedSmartLendingPolicy(
    request: ReadApprovedSmartLendingPolicyRequest,
  ): Promise<ApprovedSmartLendingPolicySnapshot>;
}
