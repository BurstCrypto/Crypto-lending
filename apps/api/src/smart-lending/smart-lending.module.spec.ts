import { Test } from '@nestjs/testing';

import {
  LIVE_BRIDGE_ROUTE_QUOTE_READER,
  type LiveBridgeRouteQuoteReader,
} from './application/ports/live-bridge-route-quote-reader.port';
import {
  LIVE_LENDING_MARKET_FEED,
  type LiveLendingMarketFeed,
} from './application/ports/live-lending-market-feed.port';
import {
  SMART_LENDING_EXTERNAL_FEED_CONFIG,
  type SmartLendingExternalFeedConfig,
} from './infrastructure/external-feeds';
import { SmartLendingModule } from './smart-lending.module';

const DISABLED: SmartLendingExternalFeedConfig = Object.freeze({ mode: 'disabled' });

describe('SmartLendingModule', () => {
  it('registers passive feed ports while the transport is disabled', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SmartLendingModule] })
      .overrideProvider(SMART_LENDING_EXTERNAL_FEED_CONFIG)
      .useValue(DISABLED)
      .compile();

    const markets = moduleRef.get<LiveLendingMarketFeed>(LIVE_LENDING_MARKET_FEED);
    const bridges = moduleRef.get<LiveBridgeRouteQuoteReader>(LIVE_BRIDGE_ROUTE_QUOTE_READER);

    await expect(
      markets.readCurrentMarkets({
        evaluatedAt: '2026-09-03T12:00:00.000Z',
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).rejects.toMatchObject({
      code: 'LIVE_LENDING_MARKET_FEED_UNAVAILABLE',
      message: 'Live lending market feed is unavailable',
    });
    await expect(
      bridges.readRoundTripQuote({
        positionId: 'position-1',
        opportunityId: 'opportunity-1',
        source: {
          networkId: 'eip155:1',
          assetId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          assetDecimals: 6,
          walletAddress: '0xde709f2102306220921060314715629080e2fb77',
        },
        destination: {
          networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          assetId: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          assetDecimals: 6,
          walletAddress: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
        },
        sourceAmountAtomic: 10_000_000n,
        sourceAmountUsdMantissa: 10n * 10n ** 18n,
        allowedBridgeProviderIds: ['polymerStandard'],
        evaluatedAt: '2026-09-03T12:00:00.000Z',
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).rejects.toMatchObject({
      code: 'LIFI_ROUND_TRIP_QUOTE_UNAVAILABLE',
      message: 'Cross-chain route quote is unavailable',
    });

    await moduleRef.close();
  });
});
