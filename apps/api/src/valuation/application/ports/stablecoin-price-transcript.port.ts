import type {
  StablecoinPriceObservation,
  StablecoinValuationAssetReference,
} from '../../domain/stablecoin-valuation-policy';

export interface StablecoinPriceTranscriptReadRequest {
  readonly asset: StablecoinValuationAssetReference;
}

export interface StablecoinPriceTranscriptClock {
  now(): Date;
}

export type StablecoinPriceTranscriptProofStatus =
  | 'FINALIZED_ETHEREUM_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED'
  | 'PYTH_BINARY_UPDATE_SIGNATURE_UNVERIFIED';

export type StablecoinPriceTranscriptFinality =
  'ETHEREUM_FINALIZED_BLOCK' | 'PYTH_HERMES_METADATA_UNVERIFIED';

/**
 * A structurally validated, normalized candidate. It intentionally cannot be
 * passed to StablecoinPriceEvidenceWriter: source authentication and the
 * external activation gates remain separate, mandatory steps.
 */
export interface DormantStablecoinPriceTranscriptCandidate {
  readonly schemaVersion: 1;
  readonly observation: StablecoinPriceObservation;
  readonly transcriptFingerprintSha256: string;
  readonly sourceNetworkId: string;
  readonly sourcePosition: string;
  readonly sourceFinality: StablecoinPriceTranscriptFinality;
  readonly sourceProofStatus: StablecoinPriceTranscriptProofStatus;
  readonly persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION';
  readonly mayRecordAsVerifiedEvidence: false;
}

export interface StablecoinPriceTranscriptAdapter {
  read(
    request: StablecoinPriceTranscriptReadRequest,
  ): Promise<DormantStablecoinPriceTranscriptCandidate>;
}
