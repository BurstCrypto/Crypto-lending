import {
  SUPPORTED_STABLECOINS,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import type { StablecoinValuationSourceId } from '../domain/stablecoin-valuation-policy';
import type {
  MainnetStablecoin,
  VerifiedStablecoinPriceSourcePort,
} from './ports/verified-stablecoin-price-source.port';

export type VerifiedStablecoinPriceSourceUnavailableCode =
  'INVALID_SOURCE_REQUEST' | 'SOURCE_NOT_CONFIGURED';

export class VerifiedStablecoinPriceSourceUnavailableError extends Error {
  constructor(
    readonly code: VerifiedStablecoinPriceSourceUnavailableCode,
    readonly sourceId: StablecoinValuationSourceId,
  ) {
    super('Verified stablecoin price source is unavailable.');
    this.name = 'VerifiedStablecoinPriceSourceUnavailableError';
  }
}

abstract class FailClosedStablecoinPriceSource implements VerifiedStablecoinPriceSourcePort {
  protected constructor(readonly sourceId: StablecoinValuationSourceId) {}

  async read(stablecoin: MainnetStablecoin, signal: AbortSignal): Promise<never> {
    if (!(signal instanceof AbortSignal)) {
      throw new VerifiedStablecoinPriceSourceUnavailableError(
        'INVALID_SOURCE_REQUEST',
        this.sourceId,
      );
    }
    signal.throwIfAborted();
    if (!isMainnetStablecoin(stablecoin)) {
      throw new VerifiedStablecoinPriceSourceUnavailableError(
        'INVALID_SOURCE_REQUEST',
        this.sourceId,
      );
    }
    throw new VerifiedStablecoinPriceSourceUnavailableError('SOURCE_NOT_CONFIGURED', this.sourceId);
  }
}

/** Default Pyth source: deliberately owns no client, endpoint, credential, or transport. */
export class FailClosedPythStablecoinPriceSource extends FailClosedStablecoinPriceSource {
  constructor() {
    super('PYTH_CORE');
  }
}

/** Default Chainlink source: deliberately owns no RPC client, endpoint, or transport. */
export class FailClosedChainlinkStablecoinPriceSource extends FailClosedStablecoinPriceSource {
  constructor() {
    super('CHAINLINK_DATA_FEEDS');
  }
}

export const DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES = Object.freeze({
  PYTH_CORE: Object.freeze(new FailClosedPythStablecoinPriceSource()),
  CHAINLINK_DATA_FEEDS: Object.freeze(new FailClosedChainlinkStablecoinPriceSource()),
});

function isMainnetStablecoin(value: unknown): value is SupportedStablecoin {
  return typeof value === 'string' && SUPPORTED_STABLECOINS.includes(value as SupportedStablecoin);
}
