import type { StablecoinPriceObservation } from '../../domain/stablecoin-valuation-policy';

export interface RecordStablecoinPriceEvidenceRequest {
  readonly correlationId: string;
  /** Internal adapter identity; this is not proof that a provider payload is authentic. */
  readonly evidenceActorReferenceId: string;
  /** Digest of the independently verified provider/on-chain evidence bytes. */
  readonly evidenceFingerprintSha256: string;
  /** Trusted adapter timestamp after evidence verification completed. */
  readonly verifiedAt: string;
  readonly observation: StablecoinPriceObservation;
}

export type RecordStablecoinPriceEvidenceOutcome =
  'ACCEPTED' | 'IDEMPOTENT_REPLAY' | 'REPLAYED_UPDATE_ID' | 'NON_MONOTONIC';

export interface RecordStablecoinPriceEvidenceResult {
  readonly outcome: RecordStablecoinPriceEvidenceOutcome;
  readonly observationId: string;
  readonly watermarkRevision: number | null;
}

/** Worker-only persistence boundary. It performs no network or provider access. */
export interface StablecoinPriceEvidenceWriter {
  record(
    request: RecordStablecoinPriceEvidenceRequest,
  ): Promise<RecordStablecoinPriceEvidenceResult>;
}
