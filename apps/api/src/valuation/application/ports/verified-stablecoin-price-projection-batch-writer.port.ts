import type { StablecoinPricePersistenceAdmissionV1 } from '../stablecoin-price-persistence-plan';

/**
 * Future persistence capability for one complete verified batch. Implementers
 * must commit all twelve projections atomically or persist none. Persistence
 * success can never authorize a financial action.
 */
export interface VerifiedStablecoinPriceProjectionBatchWriterPort {
  persistAtomically(
    admission: StablecoinPricePersistenceAdmissionV1,
    signal: AbortSignal,
  ): Promise<void>;
}
