import { Inject, Injectable } from '@nestjs/common';

import type {
  LiveLendingMarketFeed,
  LiveLendingMarketSnapshot,
  ReadLiveLendingMarketsRequest,
} from '../../application/ports/live-lending-market-feed.port';
import {
  SMART_LENDING_EXTERNAL_FEED_CLIENT,
  type SmartLendingExternalFeedClient,
} from '../external-feeds/smart-lending-external-feed.client';
import { SmartLendingExternalFeedDestination } from '../external-feeds/smart-lending-external-feed.types';
import { parseDefiLlamaMarketFeed } from './defillama-market-feed.parser';

const DEFILLAMA_YIELDS_QUERY: Readonly<Record<string, never>> = Object.freeze({});
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class LiveLendingMarketFeedUnavailableError extends Error {
  readonly code = 'LIVE_LENDING_MARKET_FEED_UNAVAILABLE' as const;

  constructor() {
    super('Live lending market feed is unavailable');
    this.name = 'LiveLendingMarketFeedUnavailableError';
  }
}

function unavailable(): never {
  throw new LiveLendingMarketFeedUnavailableError();
}

function trustedTimestamp(value: unknown): string {
  if (typeof value !== 'string') return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return unavailable();
  }
  return value;
}

/**
 * Read-only corroboration adapter. DefiLlama is deliberately unable to turn a
 * provider into an executable or recommendation-eligible destination.
 */
@Injectable()
export class DefiLlamaMarketFeedAdapter implements LiveLendingMarketFeed {
  constructor(
    @Inject(SMART_LENDING_EXTERNAL_FEED_CLIENT)
    private readonly externalFeeds: SmartLendingExternalFeedClient,
  ) {}

  async readCurrentMarkets(
    request: ReadLiveLendingMarketsRequest,
  ): Promise<LiveLendingMarketSnapshot> {
    try {
      const evaluatedAt = trustedTimestamp(request.evaluatedAt);
      if (!UUID_V4.test(request.correlationId)) return unavailable();
      const response = await this.externalFeeds.get(
        SmartLendingExternalFeedDestination.DefiLlamaYields,
        DEFILLAMA_YIELDS_QUERY,
      );
      const snapshot = parseDefiLlamaMarketFeed(response, evaluatedAt);
      if (
        snapshot.source !== 'DEFILLAMA_YIELDS' ||
        snapshot.use !== 'INDICATIVE_CORROBORATION_ONLY' ||
        snapshot.mayEstablishRecommendationEligibility !== false
      ) {
        return unavailable();
      }
      return snapshot;
    } catch (error) {
      if (error instanceof LiveLendingMarketFeedUnavailableError) throw error;
      return unavailable();
    }
  }
}
