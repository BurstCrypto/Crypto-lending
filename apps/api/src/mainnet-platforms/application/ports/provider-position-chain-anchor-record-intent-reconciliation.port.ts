export const PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION = 1 as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ONLY' as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_ONLY' as const;

/**
 * Exact source-only request to reconcile at most one internally selected
 * durable record intent. The implementation, not its caller, owns selection,
 * leasing, retry timing, database access, and any private token material.
 */
export interface ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1 {
  readonly reconciliationVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly signal: AbortSignal;
}

export type ProviderPositionChainAnchorRecordIntentState = 'NEW' | 'RECORD_DISPATCHED' | 'UNKNOWN';
export type ProviderPositionChainAnchorRecordIntentReconciliationUncertainPhase =
  'LEASE_RECONCILIATION' | 'RECONCILE_RECORD';

interface ProviderPositionChainAnchorRecordIntentReconciliationResultCommonV1 {
  readonly reconciliationVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
}

export interface ProviderPositionChainAnchorRecordIntentReconciliationIdleResultV1 extends ProviderPositionChainAnchorRecordIntentReconciliationResultCommonV1 {
  readonly outcome: 'IDLE';
}

export interface ProviderPositionChainAnchorRecordIntentReconciliationRecordedResultV1 extends ProviderPositionChainAnchorRecordIntentReconciliationResultCommonV1 {
  readonly outcome: 'RECORDED';
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly deadlineBindingSha256: string;
  readonly producerDeadlineAt: string;
  readonly evidenceRecordedAt: string;
  readonly resolvedAt: string;
}

export interface ProviderPositionChainAnchorRecordIntentReconciliationNotRecordedResultV1 extends ProviderPositionChainAnchorRecordIntentReconciliationResultCommonV1 {
  readonly outcome: 'NOT_RECORDED';
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly producerDeadlineAt: string;
  readonly resolvedAt: string;
}

export interface ProviderPositionChainAnchorRecordIntentReconciliationDeadlineViolationResultV1 extends ProviderPositionChainAnchorRecordIntentReconciliationResultCommonV1 {
  readonly outcome: 'DEADLINE_VIOLATION';
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly producerDeadlineAt: string;
  readonly evidenceRecordedAt: string;
  readonly resolvedAt: string;
}

export interface ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1 extends ProviderPositionChainAnchorRecordIntentReconciliationResultCommonV1 {
  readonly outcome: 'DEFERRED';
  readonly recordIntentFingerprintSha256: string | null;
  readonly evidenceFingerprintSha256: string | null;
  readonly knownIntentState: ProviderPositionChainAnchorRecordIntentState | null;
  readonly uncertainPhase: ProviderPositionChainAnchorRecordIntentReconciliationUncertainPhase;
  readonly retryNotBefore: string | null;
}

/**
 * Reviewed, authenticated reconciliation status. It contains neither a raw
 * token nor a financial-action or persistence-authority grant.
 */
export type ProviderPositionChainAnchorRecordIntentReconciliationResultV1 =
  | ProviderPositionChainAnchorRecordIntentReconciliationIdleResultV1
  | ProviderPositionChainAnchorRecordIntentReconciliationRecordedResultV1
  | ProviderPositionChainAnchorRecordIntentReconciliationNotRecordedResultV1
  | ProviderPositionChainAnchorRecordIntentReconciliationDeadlineViolationResultV1
  | ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1;

/**
 * Dormant direct-import-only application boundary. It registers no adapter,
 * grants no storage access, and gives callers no control over which intent is
 * reconciled. Returned values stay opaque until this same port authenticates
 * the capability against the exact request identity.
 */
export interface ProviderPositionChainAnchorRecordIntentReconciliationPort {
  readonly reconciliationVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION;
  reconcileNext(
    request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): Promise<unknown>;
  reviewResult(
    capability: unknown,
    request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 | null;
}
