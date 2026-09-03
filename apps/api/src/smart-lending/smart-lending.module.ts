import { Module } from '@nestjs/common';

import { LIVE_BRIDGE_ROUTE_QUOTE_READER } from './application/ports/live-bridge-route-quote-reader.port';
import { LIVE_LENDING_MARKET_FEED } from './application/ports/live-lending-market-feed.port';
import { DefiLlamaMarketFeedAdapter } from './infrastructure/defillama/defillama-market-feed.adapter';
import {
  SMART_LENDING_EXTERNAL_FEED_CLIENT,
  SMART_LENDING_EXTERNAL_FEED_CONFIG,
  FixedSmartLendingExternalFeedClient,
  loadSmartLendingExternalFeedConfig,
  type SmartLendingExternalFeedConfig,
} from './infrastructure/external-feeds';
import { LifiRoundTripQuoteAdapter } from './infrastructure/lifi/lifi-round-trip-quote.adapter';

/**
 * Registers passive, read-only market and route evidence adapters. No provider
 * is contacted during module startup, and the transport is disabled unless an
 * operator explicitly enables the reviewed configuration.
 */
@Module({
  providers: [
    {
      provide: SMART_LENDING_EXTERNAL_FEED_CONFIG,
      useFactory: loadSmartLendingExternalFeedConfig,
    },
    {
      provide: SMART_LENDING_EXTERNAL_FEED_CLIENT,
      inject: [SMART_LENDING_EXTERNAL_FEED_CONFIG],
      useFactory: (config: SmartLendingExternalFeedConfig) =>
        new FixedSmartLendingExternalFeedClient(config),
    },
    DefiLlamaMarketFeedAdapter,
    {
      provide: LIVE_LENDING_MARKET_FEED,
      useExisting: DefiLlamaMarketFeedAdapter,
    },
    LifiRoundTripQuoteAdapter,
    {
      provide: LIVE_BRIDGE_ROUTE_QUOTE_READER,
      useExisting: LifiRoundTripQuoteAdapter,
    },
  ],
  exports: [LIVE_LENDING_MARKET_FEED, LIVE_BRIDGE_ROUTE_QUOTE_READER],
})
export class SmartLendingModule {}
