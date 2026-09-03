export {
  SMART_LENDING_RECOMMENDATION_CLOCK,
  SYSTEM_SMART_LENDING_RECOMMENDATION_CLOCK,
  SmartLendingRecommendationService,
  SmartLendingRecommendationUnavailableError,
  type ReadSmartLendingRecommendationRequest,
  type SmartLendingRecommendationClock,
} from './application/smart-lending-recommendation.service';
export {
  COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS,
  ComposedFeeAwareAllocationInputReader,
  FeeAwareAllocationInputUnavailableError,
  MAX_COMPOSED_FEE_AWARE_CANDIDATES,
} from './application/composed-fee-aware-allocation-input.reader';
export {
  APPROVED_LENDING_OPPORTUNITY_SNAPSHOT_READER,
  type ApprovedLendingOpportunity,
  type ApprovedLendingOpportunitySnapshot,
  type ApprovedLendingOpportunitySnapshotReader,
  type ReadApprovedLendingOpportunitySnapshotRequest,
} from './application/ports/approved-lending-opportunity-snapshot-reader.port';
export {
  APPROVED_SMART_LENDING_POLICY_READER,
  type ApprovedCrossChainNetworkPair,
  type ApprovedSmartLendingPolicyReader,
  type ApprovedSmartLendingPolicySnapshot,
  type CrossChainConsiderationConsent,
  type CrossChainQuoteDisclosureConsent,
  type ReadApprovedSmartLendingPolicyRequest,
} from './application/ports/approved-smart-lending-policy-reader.port';
export {
  FEE_AWARE_ALLOCATION_INPUT_READER,
  type FeeAwareAllocationInputReader,
  type FeeAwareAllocationInputs,
  type ReadFeeAwareAllocationInputsRequest,
} from './application/ports/fee-aware-allocation-input.port';
export {
  FULL_LIFECYCLE_COST_QUOTE_READER,
  type FullLifecycleCostQuoteReader,
  type FullLifecycleCostQuoteResult,
  type LifecycleQuoteWalletEndpoint,
  type ReadFullLifecycleCostQuoteRequest,
} from './application/ports/full-lifecycle-cost-quote-reader.port';
export {
  LIVE_BRIDGE_ROUTE_QUOTE_READER,
  type LiveBridgeLegQuote,
  type LiveBridgeRouteEndpoint,
  type LiveBridgeRouteQuoteReader,
  type LiveRoundTripBridgeQuote,
  type ReadLiveRoundTripBridgeQuoteRequest,
} from './application/ports/live-bridge-route-quote-reader.port';
export {
  LIVE_LENDING_MARKET_FEED,
  SMART_LENDING_PROVIDER_IDS,
  type LiveLendingMarketFeed,
  type LiveLendingMarketObservation,
  type LiveLendingMarketSnapshot,
  type ReadLiveLendingMarketsRequest,
  type SmartLendingProviderId,
} from './application/ports/live-lending-market-feed.port';
export {
  PROVIDER_NATIVE_LENDING_MARKET_READER,
  type ProviderNativeLendingMarketObservation,
  type ProviderNativeLendingMarketReader,
  type ProviderNativeLendingMarketSnapshot,
  type ReadProviderNativeLendingMarketsRequest,
} from './application/ports/provider-native-lending-market-reader.port';
export {
  ROUTABLE_CAPITAL_POSITION_SNAPSHOT_READER,
  type ReadRoutableCapitalPositionSnapshotRequest,
  type RoutableCapitalPosition,
  type RoutableCapitalPositionSnapshot,
  type RoutableCapitalPositionSnapshotReader,
  type SmartLendingDestinationWallet,
} from './application/ports/routable-capital-position-snapshot-reader.port';
export {
  FEE_AWARE_ALLOCATION_COST_KINDS,
  FEE_AWARE_ALLOCATION_NETWORK_IDS,
  FEE_AWARE_ALLOCATION_POLICY_VERSION,
  FEE_AWARE_ALLOCATION_USD_SCALE,
  recommendFeeAwareAllocation,
  type FeeAwareAllocationCandidate,
  type FeeAwareAllocationCostKind,
  type FeeAwareAllocationCostsUsdMantissa,
  type FeeAwareAllocationExposurePolicy,
  type FeeAwareAllocationRecommendation,
  type FeeAwareAllocationRequest,
  type FeeAwareBridgeEstimate,
  type FeeAwareCandidateAssessment,
  type FeeAwareCandidateCalculation,
  type FeeAwareCandidateReason,
  type FeeAwareCapitalPosition,
  type FeeAwareCrossChainOptIn,
  type FeeAwareCrossChainPolicy,
  type FeeAwareLendingOpportunity,
  type FeeAwareOpportunityEvidence,
  type FeeAwarePositionDecision,
  type FeeAwareRiskAssessment,
  type FeeAwareRouteCostQuote,
} from './domain/fee-aware-allocation';
export { SmartLendingModule } from './smart-lending.module';
