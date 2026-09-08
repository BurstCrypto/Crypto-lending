import type {
  ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
  ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
} from '../dormant-mainnet-financial-action-finality-evidence.producer';
import type {
  DormantMainnetFinancialActionDatabaseStage,
  MainnetFinancialActionDatabaseNetworkId,
} from './dormant-mainnet-financial-action-lifecycle-durable.port';

export const DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION = 1 as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING = 'CLMA-FP-1' as const;

export type DormantMainnetFinancialActionFinalitySidecarOperation =
  'RECORD_AUTHENTICATED_ADMISSION' | 'RECORD_POST_FINALITY_REVIEW' | 'READ_EFFECTIVE_SAFETY_STATE';

export type MainnetFinancialActionPostFinalityDisposition =
  'FINALITY_REAFFIRMED' | 'REVIEW_INCONCLUSIVE' | 'DEEP_REORG_QUARANTINED';

export type MainnetFinancialActionEffectiveSafetyState =
  | 'RECONCILIATION_PENDING'
  | 'AUTHENTICATED_FINALITY_RECORDED'
  | 'UNAUTHENTICATED_TERMINAL_QUARANTINED'
  | 'REORG_QUARANTINED'
  | 'POST_FINALITY_REVIEW_INCONCLUSIVE'
  | 'AUTHORITY_CONTROLLED_QUARANTINED'
  | 'DEEP_REORG_QUARANTINED';

/**
 * Database-authored compare-and-swap cursor for migration 0035's post-finality
 * overlay. A concrete adapter additionally seals issuance, the exact read
 * request, and the complete reviewed row in an instance-private WeakMap.
 * Copies and caller-authored lookalikes therefore carry no authority.
 */
export interface DormantMainnetFinancialActionEffectiveSafetyCursorV1 {
  readonly schemaVersion: 1;
  readonly source: 'MIGRATION_0035_DATABASE';
  readonly fingerprintEncoding: typeof MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING;
  readonly accountId: string;
  readonly intentId: string;
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly terminalRevision: string;
  readonly terminalSnapshotSha256: string;
  readonly terminalTransitionFingerprintSha256: string;
  readonly originalAdmissionFingerprintSha256: string;
  readonly chainTransactionId: string;
  readonly transactionPosition: string;
  readonly transactionBlockId: string;
  readonly reviewRevision: string;
  readonly reviewFingerprintSha256: string | null;
}

/**
 * The only public values accepted for an authenticated reconciliation write.
 * Outcome, positions, blocks, evidence digests, and authority identifiers are
 * available solely through the producer-authenticated opaque capability. Every
 * request envelope must be a frozen exact-data record so a confirmed result
 * cannot later be rebound by mutating the same object identity.
 */
export interface RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1 {
  readonly evidenceCapability: unknown;
  readonly evidenceRequest: ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
  readonly signal: AbortSignal;
}

export interface ReadMainnetFinancialActionEffectiveSafetyStateRequestV1 {
  readonly accountId: string;
  readonly intentId: string;
  readonly signal: AbortSignal;
}

/**
 * Post-finality writes additionally require a cursor issued by this adapter
 * for the exact read request object. No scalar compare-and-swap tuple crosses
 * the public mutation boundary. This envelope and the read envelope must both
 * be frozen exact-data records.
 */
export interface RecordMainnetFinancialActionPostFinalityReviewRequestV1 {
  readonly evidenceCapability: unknown;
  readonly evidenceRequest: ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
  readonly effectiveSafetyCursor: DormantMainnetFinancialActionEffectiveSafetyCursorV1;
  readonly effectiveSafetyReadRequest: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
  readonly signal: AbortSignal;
}

export type DormantMainnetFinancialActionFinalitySidecarRequestV1 =
  | RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1
  | RecordMainnetFinancialActionPostFinalityReviewRequestV1
  | ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;

interface DormantMainnetFinancialActionFinalitySidecarResultCommonV1 {
  readonly sidecarVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayConstructTransaction: false;
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
  readonly mayResendTransaction: false;
  readonly automaticRetryAllowed: false;
  readonly ledgerSettlementAuthority: false;
}

export interface DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1 extends DormantMainnetFinancialActionFinalitySidecarResultCommonV1 {
  readonly outcome: 'DATABASE_STATE_CONFIRMED';
  readonly operation: 'RECORD_AUTHENTICATED_ADMISSION';
  readonly databaseRecordOutcome: 'RECORDED' | 'REPLAYED';
  readonly admissionFingerprintSha256: string;
  readonly admittedEventRevision: string;
  readonly admittedTransitionFingerprintSha256: string;
  readonly lifecycleStage: DormantMainnetFinancialActionDatabaseStage;
  readonly lifecycleRevision: string;
  readonly currentSnapshotSha256: string;
  readonly sourceEvidenceSha256: string;
  readonly effectEvidenceSha256: string | null;
  readonly failureEvidenceSha256: string | null;
  readonly terminal: boolean;
  readonly requiresManualReconciliation: boolean;
  readonly recordedAt: string;
  readonly recoveryMode: 'READ_ONLY';
}

export interface DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1 extends DormantMainnetFinancialActionFinalitySidecarResultCommonV1 {
  readonly outcome: 'DATABASE_STATE_CONFIRMED';
  readonly operation: 'RECORD_POST_FINALITY_REVIEW' | 'READ_EFFECTIVE_SAFETY_STATE';
  readonly databaseRecordOutcome: 'RECORDED' | 'REPLAYED' | 'READ';
  /**
   * Present only on an eligible effective-state READ: authenticated finality
   * that is neither reorg-quarantined nor permanently deep-reorg quarantined.
   * Mutations require a fresh read before another review.
   */
  readonly cursor: DormantMainnetFinancialActionEffectiveSafetyCursorV1 | null;
  readonly lifecycleStage: DormantMainnetFinancialActionDatabaseStage;
  readonly authenticatedReconciliation: boolean;
  /** Null for reads; identifies the exact review written or replayed by a mutation. */
  readonly recordedReviewRevision: string | null;
  readonly recordedReviewFingerprintSha256: string | null;
  readonly recordedReviewDisposition: MainnetFinancialActionPostFinalityDisposition | null;
  /** Always describes the database's current latest review, not an older replayed row. */
  readonly reviewRevision: string;
  readonly reviewFingerprintSha256: string | null;
  readonly latestReviewDisposition: MainnetFinancialActionPostFinalityDisposition | null;
  readonly effectiveSafetyState: MainnetFinancialActionEffectiveSafetyState;
  readonly requiresManualReview: boolean;
  readonly recordedAt: string | null;
  readonly recoveryMode: 'READ_ONLY';
}

export interface DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1 extends DormantMainnetFinancialActionFinalitySidecarResultCommonV1 {
  readonly outcome: 'DATABASE_OUTCOME_UNKNOWN';
  readonly operation: DormantMainnetFinancialActionFinalitySidecarOperation;
  readonly lastConfirmedEffectiveSafetyCursor: DormantMainnetFinancialActionEffectiveSafetyCursorV1 | null;
  readonly recoveryMode: 'READ_ONLY';
}

export type DormantMainnetFinancialActionFinalitySidecarResultV1 =
  | DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1
  | DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1
  | DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1;

/**
 * Dormant, direct-import-only migration-0035 boundary. It registers no
 * implementation and grants no source, database, signing, broadcast, retry,
 * resend, transaction-construction, or settlement authority.
 */
export interface DormantMainnetFinancialActionFinalitySidecarDurablePort {
  readonly sidecarVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION;
  recordAuthenticatedAdmission(
    request: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
  ): Promise<unknown>;
  recordPostFinalityReview(
    request: RecordMainnetFinancialActionPostFinalityReviewRequestV1,
  ): Promise<unknown>;
  readEffectiveSafetyState(
    request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  ): Promise<unknown>;
  reviewResult(
    capability: unknown,
    request: DormantMainnetFinancialActionFinalitySidecarRequestV1,
  ): DormantMainnetFinancialActionFinalitySidecarResultV1 | null;
}
