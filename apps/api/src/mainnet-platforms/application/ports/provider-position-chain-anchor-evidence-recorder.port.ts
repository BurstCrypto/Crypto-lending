import type { ProduceProviderPositionChainAnchorEvidenceRequestV1 } from '../dormant-provider-position-chain-anchor-evidence.producer';

export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION = 2 as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ONLY' as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_ONLY' as const;

/**
 * Exact authority-free handoff from the two-source producer to the dormant
 * durable record-intent workflow.
 *
 * The recorder must privately own the producer that issued
 * `producerCapability` and authenticate it against the exact
 * `producerRequest` object. `signal` must be the same object held by that
 * request. Callers cannot provide an intent identifier, dispatch token,
 * database handle, persistence grant, or record arguments through this
 * boundary.
 */
export interface RecordProviderPositionChainAnchorEvidenceRequestV2 {
  readonly recorderVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly producerCapability: unknown;
  readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly signal: AbortSignal;
}

export type ProviderPositionChainAnchorEvidenceRecordOutcome = 'RECORDED' | 'IDEMPOTENT_REPLAY';
export type ProviderPositionChainAnchorEvidenceRecordUncertainPhase =
  'PREPARE' | 'CLAIM_DISPATCH' | 'EXECUTE_RECORD' | 'MARK_UNKNOWN';
export type ProviderPositionChainAnchorEvidenceRecordKnownIntentState =
  'NEW' | 'RECORD_DISPATCHED' | 'UNKNOWN';

interface ProviderPositionChainAnchorEvidenceRecordResultCommonV2 {
  readonly recorderVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly producerDeadlineAt: string;
}

export interface ProviderPositionChainAnchorEvidenceRecordedResultV2 extends ProviderPositionChainAnchorEvidenceRecordResultCommonV2 {
  readonly outcome: 'RECORDED';
  readonly recordOutcome: ProviderPositionChainAnchorEvidenceRecordOutcome;
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly deadlineBindingSha256: string;
  readonly evidenceRecordedAt: string;
  readonly resolvedAt: string;
}

export interface ProviderPositionChainAnchorEvidenceNotRecordedResultV2 extends ProviderPositionChainAnchorEvidenceRecordResultCommonV2 {
  readonly outcome: 'NOT_RECORDED';
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly resolvedAt: string;
}

export interface ProviderPositionChainAnchorEvidenceReconciliationRequiredResultV2 extends ProviderPositionChainAnchorEvidenceRecordResultCommonV2 {
  readonly outcome: 'RECONCILIATION_REQUIRED';
  readonly recordIntentFingerprintSha256: string | null;
  readonly evidenceFingerprintSha256: string | null;
  readonly uncertainPhase: ProviderPositionChainAnchorEvidenceRecordUncertainPhase;
  readonly knownIntentState: ProviderPositionChainAnchorEvidenceRecordKnownIntentState | null;
}

export interface ProviderPositionChainAnchorEvidenceDeadlineViolationResultV2 extends ProviderPositionChainAnchorEvidenceRecordResultCommonV2 {
  readonly outcome: 'DEADLINE_VIOLATION';
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly evidenceRecordedAt: string;
  readonly resolvedAt: string;
}

/**
 * A structurally reviewed result is useful only after `reviewResult`
 * authenticates the opaque capability against the exact request identity.
 * No result member grants financial-action or persistence authority.
 */
export type ProviderPositionChainAnchorEvidenceRecordResultV2 =
  | ProviderPositionChainAnchorEvidenceRecordedResultV2
  | ProviderPositionChainAnchorEvidenceNotRecordedResultV2
  | ProviderPositionChainAnchorEvidenceReconciliationRequiredResultV2
  | ProviderPositionChainAnchorEvidenceDeadlineViolationResultV2;

/**
 * Dormant application boundary only. It registers no adapter, grants no
 * database permission, and exposes no dispatch or reconciliation token.
 * Returned values stay opaque until this same recorder authenticates the
 * capability and exact request and returns its reviewed result.
 */
export interface ProviderPositionChainAnchorEvidenceRecorderPort {
  readonly recorderVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION;
  recordEvidence(request: RecordProviderPositionChainAnchorEvidenceRequestV2): Promise<unknown>;
  reviewResult(
    capability: unknown,
    request: RecordProviderPositionChainAnchorEvidenceRequestV2,
  ): ProviderPositionChainAnchorEvidenceRecordResultV2 | null;
}
