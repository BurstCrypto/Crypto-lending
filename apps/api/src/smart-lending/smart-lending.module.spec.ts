import { Test } from '@nestjs/testing';

import { parseAccountId } from '../accounts/domain/account-profile';
import {
  AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_READER,
  type AaveV3EthereumDeploymentEvidenceReader,
} from './application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import {
  LIVE_BRIDGE_ROUTE_QUOTE_READER,
  type LiveBridgeRouteQuoteReader,
} from './application/ports/live-bridge-route-quote-reader.port';
import {
  LIVE_LENDING_MARKET_FEED,
  type LiveLendingMarketFeed,
} from './application/ports/live-lending-market-feed.port';
import {
  PROVIDER_NATIVE_LENDING_MARKET_READER,
  type ProviderNativeLendingMarketReader,
} from './application/ports/provider-native-lending-market-reader.port';
import { SmartLendingRecommendationService } from './application/smart-lending-recommendation.service';
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
    const nativeMarkets = moduleRef.get<ProviderNativeLendingMarketReader>(
      PROVIDER_NATIVE_LENDING_MARKET_READER,
    );
    const aaveDeploymentEvidence = moduleRef.get<AaveV3EthereumDeploymentEvidenceReader>(
      AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_READER,
    );
    const recommendations = moduleRef.get(SmartLendingRecommendationService);

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
    await expect(
      nativeMarkets.readCurrentMarkets({
        evaluatedAt: '2026-09-03T12:00:00.000Z',
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).rejects.toMatchObject({
      code: 'AAVE_V3_ETHEREUM_MARKET_UNAVAILABLE',
      message: 'Aave V3 Ethereum market data is unavailable',
    });
    await expect(
      aaveDeploymentEvidence.readCurrentDeploymentEvidence({
        evaluatedAt: '2026-09-03T12:00:00.000Z',
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).rejects.toMatchObject({
      code: 'AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_UNAVAILABLE',
      message: 'Aave V3 Ethereum deployment evidence is unavailable',
    });
    await expect(
      recommendations.read({
        accountId: parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).rejects.toMatchObject({
      code: 'SMART_LENDING_RECOMMENDATION_UNAVAILABLE',
      message: 'Smart lending recommendation is unavailable',
    });

    await moduleRef.close();
  });
});
