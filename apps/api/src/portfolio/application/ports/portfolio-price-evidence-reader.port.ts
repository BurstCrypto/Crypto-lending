import type {
  StablecoinPriceObservation,
  StablecoinSourceWatermark,
  StablecoinValuationAssetReference,
} from '../../../valuation';

export const PORTFOLIO_PRICE_EVIDENCE_READER = Symbol('PORTFOLIO_PRICE_EVIDENCE_READER');

export interface PortfolioPriceEvidenceSnapshot {
  /** Opaque, non-secret identity for the immutable source snapshot. */
  readonly snapshotId: string;
  readonly observations: readonly StablecoinPriceObservation[];
  readonly sourceWatermarks: readonly StablecoinSourceWatermark[];
}

export interface ReadPortfolioPriceEvidenceRequest {
  readonly asset: StablecoinValuationAssetReference;
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface PortfolioPriceEvidenceReader {
  readPriceEvidence(
    request: ReadPortfolioPriceEvidenceRequest,
  ): Promise<PortfolioPriceEvidenceSnapshot>;
}
