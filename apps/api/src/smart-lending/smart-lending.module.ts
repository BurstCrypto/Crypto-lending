import { Module } from '@nestjs/common';

import { ComposedFeeAwareAllocationInputReader } from './application/composed-fee-aware-allocation-input.reader';
import { APPROVED_LENDING_OPPORTUNITY_SNAPSHOT_READER } from './application/ports/approved-lending-opportunity-snapshot-reader.port';
import { APPROVED_SMART_LENDING_POLICY_READER } from './application/ports/approved-smart-lending-policy-reader.port';
import { FEE_AWARE_ALLOCATION_INPUT_READER } from './application/ports/fee-aware-allocation-input.port';
import { FULL_LIFECYCLE_COST_QUOTE_READER } from './application/ports/full-lifecycle-cost-quote-reader.port';
import { LIVE_BRIDGE_ROUTE_QUOTE_READER } from './application/ports/live-bridge-route-quote-reader.port';
import { LIVE_LENDING_MARKET_FEED } from './application/ports/live-lending-market-feed.port';
import { PROVIDER_NATIVE_LENDING_MARKET_READER } from './application/ports/provider-native-lending-market-reader.port';
import { ROUTABLE_CAPITAL_POSITION_SNAPSHOT_READER } from './application/ports/routable-capital-position-snapshot-reader.port';
import {
  SMART_LENDING_RECOMMENDATION_CLOCK,
  SYSTEM_SMART_LENDING_RECOMMENDATION_CLOCK,
  SmartLendingRecommendationService,
} from './application/smart-lending-recommendation.service';
import {
  AAVE_V3_ETHEREUM_PROVIDER_NATIVE_LENDING_MARKET_READER,
  AaveV3EthereumMarketFeedAdapter,
} from './infrastructure/aave/aave-v3-market-feed.adapter';
import { DefiLlamaMarketFeedAdapter } from './infrastructure/defillama/defillama-market-feed.adapter';
import {
  AAVE_V3_ETHEREUM_MARKET_EXTERNAL_FEED_CLIENT,
  SMART_LENDING_EXTERNAL_FEED_CLIENT,
  SMART_LENDING_EXTERNAL_FEED_CONFIG,
  FixedSmartLendingExternalFeedClient,
  loadSmartLendingExternalFeedConfig,
  type SmartLendingExternalFeedConfig,
} from './infrastructure/external-feeds';
import { LifiRoundTripQuoteAdapter } from './infrastructure/lifi/lifi-round-trip-quote.adapter';
import {
  UnavailableApprovedLendingOpportunitySnapshotReader,
  UnavailableApprovedSmartLendingPolicyReader,
  UnavailableFullLifecycleCostQuoteReader,
  UnavailableRoutableCapitalPositionSnapshotReader,
} from './infrastructure/unavailable-fee-aware-allocation-input-readers';

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
      provide: FixedSmartLendingExternalFeedClient,
      inject: [SMART_LENDING_EXTERNAL_FEED_CONFIG],
      useFactory: (config: SmartLendingExternalFeedConfig) =>
        new FixedSmartLendingExternalFeedClient(config),
    },
    {
      provide: SMART_LENDING_EXTERNAL_FEED_CLIENT,
      useExisting: FixedSmartLendingExternalFeedClient,
    },
    {
      provide: AAVE_V3_ETHEREUM_MARKET_EXTERNAL_FEED_CLIENT,
      useExisting: FixedSmartLendingExternalFeedClient,
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
    AaveV3EthereumMarketFeedAdapter,
    {
      provide: AAVE_V3_ETHEREUM_PROVIDER_NATIVE_LENDING_MARKET_READER,
      useExisting: AaveV3EthereumMarketFeedAdapter,
    },
    {
      provide: PROVIDER_NATIVE_LENDING_MARKET_READER,
      useExisting: AaveV3EthereumMarketFeedAdapter,
    },
    UnavailableRoutableCapitalPositionSnapshotReader,
    {
      provide: ROUTABLE_CAPITAL_POSITION_SNAPSHOT_READER,
      useExisting: UnavailableRoutableCapitalPositionSnapshotReader,
    },
    UnavailableApprovedLendingOpportunitySnapshotReader,
    {
      provide: APPROVED_LENDING_OPPORTUNITY_SNAPSHOT_READER,
      useExisting: UnavailableApprovedLendingOpportunitySnapshotReader,
    },
    UnavailableApprovedSmartLendingPolicyReader,
    {
      provide: APPROVED_SMART_LENDING_POLICY_READER,
      useExisting: UnavailableApprovedSmartLendingPolicyReader,
    },
    UnavailableFullLifecycleCostQuoteReader,
    {
      provide: FULL_LIFECYCLE_COST_QUOTE_READER,
      useExisting: UnavailableFullLifecycleCostQuoteReader,
    },
    ComposedFeeAwareAllocationInputReader,
    {
      provide: FEE_AWARE_ALLOCATION_INPUT_READER,
      useExisting: ComposedFeeAwareAllocationInputReader,
    },
    {
      provide: SMART_LENDING_RECOMMENDATION_CLOCK,
      useValue: SYSTEM_SMART_LENDING_RECOMMENDATION_CLOCK,
    },
    SmartLendingRecommendationService,
  ],
  exports: [
    LIVE_LENDING_MARKET_FEED,
    PROVIDER_NATIVE_LENDING_MARKET_READER,
    SmartLendingRecommendationService,
  ],
})
export class SmartLendingModule {}
