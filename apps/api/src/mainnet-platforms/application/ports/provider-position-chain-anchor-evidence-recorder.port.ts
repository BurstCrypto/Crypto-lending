import type { ProduceProviderPositionChainAnchorEvidenceRequestV1 } from '../dormant-provider-position-chain-anchor-evidence.producer';

export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION = 1 as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ONLY' as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_ONLY' as const;

/**
 * Exact authority-free handoff from the two-source producer to a future
 * owner-authorized persistence adapter.
 *
 * The producer capability stays opaque. A concrete recorder must privately
 * own the producer instance that issued it and review the capability against
 * the exact producerRequest object before inspecting the candidate. Supplying
 * a verifier, record arguments, database handle, or persistence-authority flag
 * here would let callers replace or duplicate a trust boundary, so none is
 * part of this request.
 *
 * `signal` must be the exact object held by `producerRequest.signal`. It is
 * repeated only as the recorder operation's explicit cancellation boundary;
 * implementations must reject substitution rather than create a new signal.
 */
export interface RecordProviderPositionChainAnchorEvidenceRequestV1 {
  readonly recorderVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly producerCapability: unknown;
  readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly signal: AbortSignal;
}

export type ProviderPositionChainAnchorEvidenceRecordOutcome = 'RECORDED' | 'IDEMPOTENT_REPLAY';

/**
 * Structurally reviewed migration-0029 result. Authenticity still requires
 * verifyReceipt against the exact record request. A receipt reports completed
 * storage only; it grants neither financial-action nor persistence authority.
 */
export interface ProviderPositionChainAnchorEvidenceRecordReceiptV1 {
  readonly recorderVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly recordOutcome: ProviderPositionChainAnchorEvidenceRecordOutcome;
  readonly recordedEvidenceFingerprintSha256: string;
  readonly evidenceRecordedAt: string;
}

/**
 * Dormant application boundary only. This contract registers no adapter and
 * conveys no database permission. Any future implementation must receive its
 * narrowly scoped migration-0029 record permission from separately reviewed
 * deployment configuration, not from a caller or from this request.
 *
 * Returned values remain opaque until the same recorder authenticates them.
 * Unissued receipts, receipt clones, request clones, producer-request clones,
 * and signal substitutions must verify false.
 */
export interface ProviderPositionChainAnchorEvidenceRecorderPort {
  readonly recorderVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION;
  recordEvidence(request: RecordProviderPositionChainAnchorEvidenceRequestV1): Promise<unknown>;
  verifyReceipt(
    capability: unknown,
    request: RecordProviderPositionChainAnchorEvidenceRequestV1,
  ): boolean;
}
