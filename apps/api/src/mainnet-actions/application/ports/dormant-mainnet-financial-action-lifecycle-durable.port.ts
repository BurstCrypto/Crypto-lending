import type { DormantMainnetFinancialActionIntentInputV1 } from '../../domain/dormant-mainnet-financial-action';

export const DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION = 1 as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_ONLY' as const;
export const DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE =
  'DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_RESULT_ONLY' as const;
export const MAINNET_FINANCIAL_ACTION_DATABASE_FINGERPRINT_ENCODING = 'CLMA-FP-1' as const;

export type MainnetFinancialActionDatabaseNetworkId =
  'eip155:1' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export type DormantMainnetFinancialActionDurableOperation =
  'PREPARE' | 'BIND_SUBMISSION' | 'RECORD_BROADCAST' | 'RECORD_RECONCILIATION' | 'READ';

export type DormantMainnetFinancialActionDatabaseStage =
  | 'PREPARED'
  | 'WALLET_SIGNED_SUBMISSION_BOUND'
  | 'BROADCAST_OUTCOME_AMBIGUOUS'
  | 'RECONCILIATION_AMBIGUOUS'
  | 'FINALIZED_SUCCESS'
  | 'FINALIZED_FAILURE'
  | 'REORG_QUARANTINED';

export type DormantMainnetFinancialActionDatabaseRecordOutcome = 'RECORDED' | 'REPLAYED' | 'READ';

export type DormantMainnetWalletBroadcastDatabaseOutcome =
  'WALLET_REPORTED_SUBMITTED' | 'WALLET_REPORTED_AMBIGUOUS' | 'WALLET_REPORTED_REJECTED';

export type DormantMainnetReconciliationDatabaseOutcome =
  'PENDING' | 'UNKNOWN' | 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE' | 'REORGED_OUT';

/**
 * Audit-only commitment emitted by the volatile domain protocol. It is an
 * input to migration 0033, but it is never a durable compare-and-swap cursor.
 */
export interface DormantMainnetFinancialActionVolatileCommitmentV1 {
  readonly source: 'VOLATILE_IN_PROCESS_LIFECYCLE';
  readonly encoding: 'VOLATILE_JSON_DOMAIN_V1';
  readonly sha256: string;
  readonly mayServeAsDatabaseCursor: false;
}

/**
 * Database-authored compare-and-swap cursor. Every digest in this value comes
 * from migration 0033's CLMA-FP-1 result, never from the volatile protocol.
 * A concrete adapter retains issuance provenance and transition metadata in an
 * instance-private WeakMap after reviewing a database row. The public cursor
 * has no brand property; copies and caller-authored lookalikes are rejected
 * pre-I/O.
 */
export interface DormantMainnetFinancialActionClmaDatabaseCursorV1 {
  readonly schemaVersion: 1;
  readonly source: 'MIGRATION_0033_DATABASE';
  readonly fingerprintEncoding: typeof MAINNET_FINANCIAL_ACTION_DATABASE_FINGERPRINT_ENCODING;
  readonly accountId: string;
  readonly intentId: string;
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly lifecycleRevision: string;
  readonly currentSnapshotSha256: string;
  readonly intentRecordFingerprintSha256: string;
}

interface DormantMainnetFinancialActionDurableRequestCommonV1 {
  readonly durableLifecycleVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly signal: AbortSignal;
}

export interface DormantMainnetFinancialActionAuthoritativeLinksV1 {
  readonly yieldOperationId: string;
  readonly yieldSubmissionId: string;
  readonly ledgerTransactionId: string;
  readonly ledgerBookId: string;
}

export interface PrepareDormantMainnetFinancialActionDurableRequestV1 extends DormantMainnetFinancialActionDurableRequestCommonV1 {
  readonly intentInput: DormantMainnetFinancialActionIntentInputV1;
  readonly authoritativeLinks: DormantMainnetFinancialActionAuthoritativeLinksV1;
  readonly volatileIntentCommitment: DormantMainnetFinancialActionVolatileCommitmentV1;
  readonly correlationId: string;
}

interface DormantMainnetFinancialActionDurableTransitionRequestCommonV1 extends DormantMainnetFinancialActionDurableRequestCommonV1 {
  readonly cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
  readonly correlationId: string;
}

export interface BindDormantMainnetFinancialActionSubmissionRequestV1 extends DormantMainnetFinancialActionDurableTransitionRequestCommonV1 {
  readonly transactionId: string;
  readonly walletSignedPayloadSha256: string;
  readonly walletSignatureEvidenceSha256: string;
  readonly signedAt: string;
}

export interface RecordDormantMainnetFinancialActionBroadcastRequestV1 extends DormantMainnetFinancialActionDurableTransitionRequestCommonV1 {
  readonly observationId: string;
  readonly transactionId: string;
  readonly outcome: DormantMainnetWalletBroadcastDatabaseOutcome;
  readonly evidenceSha256: string;
  readonly observedAt: string;
}

export interface RecordDormantMainnetFinancialActionReconciliationRequestV1 extends DormantMainnetFinancialActionDurableTransitionRequestCommonV1 {
  readonly observationId: string;
  readonly transactionId: string;
  readonly outcome: DormantMainnetReconciliationDatabaseOutcome;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly finalizedPosition: string;
  readonly finalizedBlockId: string;
  readonly effectEvidenceSha256: string | null;
  readonly failureEvidenceSha256: string | null;
  readonly sourceEvidenceSha256: string;
  readonly observedAt: string;
}

export interface ReadDormantMainnetFinancialActionDurableRequestV1 extends DormantMainnetFinancialActionDurableRequestCommonV1 {
  readonly accountId: string;
  readonly intentId: string;
}

export type DormantMainnetFinancialActionDurableRequestV1 =
  | PrepareDormantMainnetFinancialActionDurableRequestV1
  | BindDormantMainnetFinancialActionSubmissionRequestV1
  | RecordDormantMainnetFinancialActionBroadcastRequestV1
  | RecordDormantMainnetFinancialActionReconciliationRequestV1
  | ReadDormantMainnetFinancialActionDurableRequestV1;

interface DormantMainnetFinancialActionDurableResultCommonV1 {
  readonly durableLifecycleVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION;
  readonly use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly apiMaySign: false;
  readonly apiMayBroadcast: false;
  readonly mayResendTransaction: false;
  readonly automaticRetryAllowed: false;
  readonly ledgerSettlementAuthority: false;
}

export interface DormantMainnetFinancialActionDatabaseConfirmedResultV1 extends DormantMainnetFinancialActionDurableResultCommonV1 {
  readonly outcome: 'DATABASE_STATE_CONFIRMED';
  readonly operation: DormantMainnetFinancialActionDurableOperation;
  readonly databaseRecordOutcome: DormantMainnetFinancialActionDatabaseRecordOutcome;
  readonly cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
  readonly volatileIntentCommitmentSha256: string;
  readonly stage: DormantMainnetFinancialActionDatabaseStage;
  readonly chainTransactionId: string | null;
  readonly submissionFingerprintSha256: string | null;
  readonly observationId: string | null;
  readonly broadcastOutcome: DormantMainnetWalletBroadcastDatabaseOutcome | null;
  readonly reconciliationOutcome: DormantMainnetReconciliationDatabaseOutcome | null;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly finalizedPosition: string | null;
  readonly finalizedBlockId: string | null;
  readonly lastObservedTransactionPosition: string | null;
  readonly lastObservedTransactionBlockId: string | null;
  readonly effectiveAt: string;
  readonly expiresAt: string;
  readonly recordedAt: string;
  readonly terminal: boolean;
  readonly requiresManualReconciliation: boolean;
  readonly databaseReplayProtectionEnforced: true;
  readonly recoveryMode: 'READ_ONLY' | 'READ_THEN_RECONCILE_ONLY' | 'NONE';
}

export interface DormantMainnetFinancialActionPreWalletDatabaseOutcomeUnknownV1 extends DormantMainnetFinancialActionDurableResultCommonV1 {
  readonly outcome: 'DATABASE_OUTCOME_UNKNOWN';
  readonly operation: 'PREPARE' | 'READ';
  readonly lastConfirmedCursor: DormantMainnetFinancialActionClmaDatabaseCursorV1 | null;
  readonly recoveryMode: 'READ_ONLY';
  readonly reconciliationOnly: false;
}

export interface DormantMainnetFinancialActionPostWalletDatabaseOutcomeUnknownV1 extends DormantMainnetFinancialActionDurableResultCommonV1 {
  readonly outcome: 'DATABASE_OUTCOME_UNKNOWN';
  readonly operation: 'BIND_SUBMISSION' | 'RECORD_BROADCAST' | 'RECORD_RECONCILIATION';
  readonly lastConfirmedCursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
  readonly recoveryMode: 'READ_THEN_RECONCILE_ONLY';
  readonly reconciliationOnly: true;
}

export type DormantMainnetFinancialActionDatabaseOutcomeUnknownV1 =
  | DormantMainnetFinancialActionPreWalletDatabaseOutcomeUnknownV1
  | DormantMainnetFinancialActionPostWalletDatabaseOutcomeUnknownV1;

export type DormantMainnetFinancialActionDurableResultV1 =
  | DormantMainnetFinancialActionDatabaseConfirmedResultV1
  | DormantMainnetFinancialActionDatabaseOutcomeUnknownV1;

/**
 * Dormant direct-import-only application boundary. Implementations must run the
 * pure request codec to completion before starting database I/O. Once a call
 * may have reached PostgreSQL, loss of its result is DATABASE_OUTCOME_UNKNOWN;
 * no mutation is automatically retried. Any uncertainty after a wallet has
 * signed is read-then-reconcile-only and can never authorize a resend.
 *
 * This interface registers no adapter and grants no database, signing,
 * broadcast, transaction-construction, retry, or ledger-settlement authority.
 */
export interface DormantMainnetFinancialActionLifecycleDurablePort {
  readonly durableLifecycleVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION;
  prepare(request: PrepareDormantMainnetFinancialActionDurableRequestV1): Promise<unknown>;
  bindSubmission(request: BindDormantMainnetFinancialActionSubmissionRequestV1): Promise<unknown>;
  recordBroadcast(request: RecordDormantMainnetFinancialActionBroadcastRequestV1): Promise<unknown>;
  recordReconciliation(
    request: RecordDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown>;
  read(request: ReadDormantMainnetFinancialActionDurableRequestV1): Promise<unknown>;
  reviewResult(
    capability: unknown,
    request: DormantMainnetFinancialActionDurableRequestV1,
  ): DormantMainnetFinancialActionDurableResultV1 | null;
}
