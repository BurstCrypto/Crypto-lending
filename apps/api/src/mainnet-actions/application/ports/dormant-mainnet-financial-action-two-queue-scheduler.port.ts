import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { MainnetFinancialAction } from '../../domain/dormant-mainnet-financial-action';
import type { DormantMainnetFinancialActionDatabaseStage } from './dormant-mainnet-financial-action-lifecycle-durable.port';

export const DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION = 1 as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_SOURCE_CLAIM_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_CAPABILITY_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_OPAQUE_CLAIM_CAPABILITY_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_VIEW_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_VIEW_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_CAPABILITY_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_OPAQUE_COMPLETION_CAPABILITY_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_RESULT_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_DIRECTIVE_ONLY' as const;

export const DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY = Object.freeze({
  PRE_BROADCAST: Object.freeze({ maximumAttempts: 3 }),
  RECONCILIATION: Object.freeze({ maximumAttempts: 12 }),
});
export const DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_LEASE_MILLISECONDS = 15 * 60 * 1_000;

interface SchedulerAuthorityDenialV1 {
  readonly mayAuthorizeFinancialAction: false;
  readonly mayConstructTransaction: false;
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
  readonly mayResubmitTransaction: false;
  readonly ledgerSettlementAuthority: false;
}

interface DormantMainnetFinancialActionScheduledJobCommonV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly jobId: string;
  readonly accountId: string;
  readonly intentId: string;
  readonly intentRecordFingerprintSha256: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly action: MainnetFinancialAction;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
}

export interface DormantMainnetFinancialActionPreBroadcastJobV1 extends DormantMainnetFinancialActionScheduledJobCommonV1 {
  readonly queue: 'PRE_BROADCAST';
  readonly purpose: 'PRE_BROADCAST_SAFETY_REVIEW';
  readonly lifecycleStage: 'PREPARED';
  readonly transactionId: null;
  readonly reconciliationOutcome: null;
}

export interface DormantMainnetFinancialActionReconciliationJobV1 extends DormantMainnetFinancialActionScheduledJobCommonV1 {
  readonly queue: 'RECONCILIATION';
  readonly purpose: 'RECONCILIATION_ADMISSION' | 'POST_FINALITY_REVIEW';
  readonly lifecycleStage:
    | 'WALLET_SIGNED_SUBMISSION_BOUND'
    | 'BROADCAST_OUTCOME_AMBIGUOUS'
    | 'RECONCILIATION_AMBIGUOUS'
    | 'FINALIZED_SUCCESS'
    | 'FINALIZED_FAILURE';
  readonly transactionId: string;
  readonly reconciliationOutcome:
    'PENDING' | 'UNKNOWN' | 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE' | null;
}

export type DormantMainnetFinancialActionScheduledJobV1 =
  DormantMainnetFinancialActionPreBroadcastJobV1 | DormantMainnetFinancialActionReconciliationJobV1;

interface ClaimDormantMainnetFinancialActionRequestCommonV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly mayPersist: false;
  readonly signal: AbortSignal;
}

export interface ClaimDormantMainnetFinancialActionPreBroadcastRequestV1 extends ClaimDormantMainnetFinancialActionRequestCommonV1 {
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE;
}

export interface ClaimDormantMainnetFinancialActionReconciliationRequestV1 extends ClaimDormantMainnetFinancialActionRequestCommonV1 {
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE;
}

export type ClaimDormantMainnetFinancialActionRequestV1 =
  | ClaimDormantMainnetFinancialActionPreBroadcastRequestV1
  | ClaimDormantMainnetFinancialActionReconciliationRequestV1;

interface DormantMainnetFinancialActionSourceClaimCommonV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE;
  readonly mayPersist: false;
  readonly attempt: number;
  readonly leaseId: string;
  readonly fencingToken: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}

export interface DormantMainnetFinancialActionPreBroadcastSourceClaimV1 extends DormantMainnetFinancialActionSourceClaimCommonV1 {
  readonly queue: 'PRE_BROADCAST';
  readonly job: DormantMainnetFinancialActionPreBroadcastJobV1;
}

export interface DormantMainnetFinancialActionReconciliationSourceClaimV1 extends DormantMainnetFinancialActionSourceClaimCommonV1 {
  readonly queue: 'RECONCILIATION';
  readonly job: DormantMainnetFinancialActionReconciliationJobV1;
}

/**
 * Future durable adapters own lease creation and persistence. Claim requests
 * deliberately contain no lease ID, fencing token, attempt, or timestamp.
 */
export interface DormantMainnetFinancialActionTwoQueueClaimSourcePort {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  claimPreBroadcast(
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown>;
  claimReconciliation(
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown>;
  reviewPreBroadcastClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): DormantMainnetFinancialActionPreBroadcastSourceClaimV1 | null;
  reviewReconciliationClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): DormantMainnetFinancialActionReconciliationSourceClaimV1 | null;
}

export interface DormantMainnetFinancialActionClaimCapabilityV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_CAPABILITY_USE;
  readonly mayPersist: false;
}

export interface DormantMainnetFinancialActionClaimViewV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_VIEW_USE;
  readonly mayPersist: false;
  readonly queue: 'PRE_BROADCAST' | 'RECONCILIATION';
  readonly job: DormantMainnetFinancialActionScheduledJobV1;
  readonly attempt: number;
  readonly maximumAttempts: number;
  readonly leaseId: string;
  readonly fencingToken: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}

interface CompleteDormantMainnetFinancialActionRequestCommonV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly mayPersist: false;
  readonly claimCapability: unknown;
  readonly claimRequest: ClaimDormantMainnetFinancialActionRequestV1;
  readonly signal: AbortSignal;
}

export interface CompleteDormantMainnetFinancialActionPreBroadcastRequestV1 extends CompleteDormantMainnetFinancialActionRequestCommonV1 {
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE;
  readonly disposition:
    | 'PRE_BROADCAST_REVIEW_COMPLETED'
    | 'RETRY_PRE_BROADCAST_REVIEW_ONLY'
    | 'PRE_BROADCAST_TERMINAL_FAILURE';
  readonly claimRequest: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1;
}

export interface CompleteDormantMainnetFinancialActionReconciliationRequestV1 extends CompleteDormantMainnetFinancialActionRequestCommonV1 {
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE;
  readonly disposition:
    'RECONCILIATION_COMPLETED' | 'RETRY_RECONCILIATION_ONLY' | 'MANUAL_REVIEW_REQUIRED';
  readonly claimRequest: ClaimDormantMainnetFinancialActionReconciliationRequestV1;
}

export type CompleteDormantMainnetFinancialActionRequestV1 =
  | CompleteDormantMainnetFinancialActionPreBroadcastRequestV1
  | CompleteDormantMainnetFinancialActionReconciliationRequestV1;

export interface DormantMainnetFinancialActionCompletionCapabilityV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_CAPABILITY_USE;
  readonly mayPersist: false;
}

export interface DormantMainnetFinancialActionCompletionResultV1 extends SchedulerAuthorityDenialV1 {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_RESULT_USE;
  readonly mayPersist: false;
  readonly queue: 'PRE_BROADCAST' | 'RECONCILIATION';
  readonly jobId: string;
  readonly accountId: string;
  readonly intentId: string;
  readonly intentRecordFingerprintSha256: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly action: MainnetFinancialAction;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly lifecycleStage: DormantMainnetFinancialActionDatabaseStage;
  readonly purpose:
    'PRE_BROADCAST_SAFETY_REVIEW' | 'RECONCILIATION_ADMISSION' | 'POST_FINALITY_REVIEW';
  readonly transactionId: string | null;
  readonly reconciliationOutcome:
    'PENDING' | 'UNKNOWN' | 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE' | null;
  readonly attempt: number;
  readonly maximumAttempts: number;
  readonly leaseId: string;
  readonly fencingToken: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
  readonly completedAt: string;
  readonly requestedDisposition:
    | CompleteDormantMainnetFinancialActionPreBroadcastRequestV1['disposition']
    | CompleteDormantMainnetFinancialActionReconciliationRequestV1['disposition'];
  readonly completionDisposition:
    | 'COMPLETED'
    | 'TERMINAL_FAILURE'
    | 'RELEASE_PRE_BROADCAST_ONLY'
    | 'RELEASE_RECONCILIATION_ONLY'
    | 'MANUAL_REVIEW_REQUIRED'
    /**
     * Exhausts automated claims only. A future durable adapter must quarantine
     * this job for manual review; it must never treat the job as completed or
     * silently drop it.
     */
    | 'ATTEMPT_LIMIT_REACHED';
  readonly nextQueue: 'PRE_BROADCAST' | 'RECONCILIATION' | null;
}

export interface DormantMainnetFinancialActionSchedulerClock {
  now(): Date;
}

/** Dormant direct-import-only application contract; no implementation is registered. */
export interface DormantMainnetFinancialActionTwoQueueSchedulerPort {
  readonly schedulerVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  claimPreBroadcast(
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown>;
  claimReconciliation(
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown>;
  reviewPreBroadcastClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): DormantMainnetFinancialActionClaimViewV1 | null;
  reviewReconciliationClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): DormantMainnetFinancialActionClaimViewV1 | null;
  completePreBroadcast(
    request: CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown>;
  completeReconciliation(
    request: CompleteDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown>;
  reviewCompletion(
    capability: unknown,
    request: CompleteDormantMainnetFinancialActionRequestV1,
  ): DormantMainnetFinancialActionCompletionResultV1 | null;
}
