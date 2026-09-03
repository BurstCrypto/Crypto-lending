import type { AccountId } from '../../../accounts/domain/account-profile';
import type { SupportedStablecoin } from '../../../blockchain/domain/supported-asset-registry';
import type { FeeAwareLendingOpportunity } from '../../domain/fee-aware-allocation';
import type { SmartLendingProviderId } from './live-lending-market-feed.port';

export const APPROVED_LENDING_OPPORTUNITY_SNAPSHOT_READER = Symbol(
  'APPROVED_LENDING_OPPORTUNITY_SNAPSHOT_READER',
);

/** Provider-native opportunity evidence after deployment, eligibility, and risk approval. */
export interface ApprovedLendingOpportunity extends FeeAwareLendingOpportunity {
  readonly protocolId: string;
  readonly marketId: string;
  readonly assetSymbol: SupportedStablecoin;
  readonly assetDecimals: 6;
}

export interface ApprovedLendingOpportunitySnapshot {
  readonly schemaVersion: 1;
  readonly use: 'APPROVED_SMART_LENDING_OPPORTUNITIES';
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  readonly snapshotReferenceId: string;
  readonly capturedAt: string;
  readonly validUntil: string;
  readonly coverage: 'COMPLETE';
  readonly providerCoverage: readonly SmartLendingProviderId[];
  readonly providerPolicyApprovalReferenceId: string;
  readonly riskPolicyApprovalReferenceId: string;
  readonly opportunities: readonly ApprovedLendingOpportunity[];
}

export interface ReadApprovedLendingOpportunitySnapshotRequest {
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  /** Shared aggregate composer deadline for all evidence and quote reads. */
  readonly deadlineAt: string;
  /** Implementations must stop their own I/O promptly when aborted. */
  readonly signal: AbortSignal;
}

export interface ApprovedLendingOpportunitySnapshotReader {
  readApprovedLendingOpportunities(
    request: ReadApprovedLendingOpportunitySnapshotRequest,
  ): Promise<ApprovedLendingOpportunitySnapshot>;
}
