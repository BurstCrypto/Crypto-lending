import {
  MAINNET_LAUNCH_NETWORK_IDS,
  type MainnetLaunchNetworkId,
} from '../../blockchain/domain/mainnet-launch-network-policy';
import { PORTFOLIO_USD_SCALE } from '../../portfolio/domain/unified-portfolio';

const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_REFERENCE_PATTERN = /^[\x21-\x7e]{1,192}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_RATE_BASIS_POINTS = 1_000_000n;
const MAX_HOLDING_PERIOD_DAYS = 36_500n;
const MAX_FRESHNESS_SECONDS = 86_400n;
const BASIS_POINTS_DENOMINATOR = 10_000n;
const DAYS_PER_YEAR = 365n;

export const FEE_AWARE_ALLOCATION_POLICY_VERSION = 1 as const;
export const FEE_AWARE_ALLOCATION_NETWORK_IDS = MAINNET_LAUNCH_NETWORK_IDS;
/** Every USD bigint in this contract is a mantissa at the portfolio's canonical scale. */
export const FEE_AWARE_ALLOCATION_USD_SCALE = PORTFOLIO_USD_SCALE;

export const FEE_AWARE_ALLOCATION_COST_KINDS = Object.freeze([
  'entrySourceNetwork',
  'entrySourceSwap',
  'entryBridge',
  'entryDestinationNetwork',
  'entryDestinationSwap',
  'providerEntry',
  'providerExit',
  'exitDestinationNetwork',
  'exitDestinationSwap',
  'exitBridge',
  'exitSourceNetwork',
  'platformRouting',
  'riskBuffer',
] as const);

export type FeeAwareAllocationCostKind = (typeof FEE_AWARE_ALLOCATION_COST_KINDS)[number];

export interface FeeAwareAllocationCostsUsdMantissa {
  readonly entrySourceNetwork: bigint;
  readonly entrySourceSwap: bigint;
  readonly entryBridge: bigint;
  readonly entryDestinationNetwork: bigint;
  readonly entryDestinationSwap: bigint;
  readonly providerEntry: bigint;
  readonly providerExit: bigint;
  readonly exitDestinationNetwork: bigint;
  readonly exitDestinationSwap: bigint;
  readonly exitBridge: bigint;
  readonly exitSourceNetwork: bigint;
  readonly platformRouting: bigint;
  readonly riskBuffer: bigint;
}

export interface FeeAwareCapitalPosition {
  readonly positionId: string;
  readonly walletId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly assetId: string;
  /** Exact native atomic units for the complete source position. */
  readonly amountAtomic: bigint;
  /** Conservative server-valued scale-18 USD mantissa units for the same complete position. */
  readonly amountUsdMantissa: bigint;
}

export interface FeeAwareOpportunityEvidence {
  readonly evidenceReferenceId: string;
  readonly adapterId: string;
  readonly observedAt: string;
  readonly validUntil: string;
}

export interface FeeAwareRiskAssessment {
  readonly status: 'APPROVED_FOR_RECOMMENDATION';
  readonly assessmentReferenceId: string;
  readonly assessedAt: string;
  readonly validUntil: string;
  /** Conservative APY haircut expressed in basis points. */
  readonly penaltyBasisPoints: bigint;
}

export interface FeeAwareLendingOpportunity {
  readonly opportunityId: string;
  readonly providerId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly assetId: string;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly recommendationEligibility: 'ELIGIBLE' | 'INELIGIBLE';
  readonly grossApyBasisPoints: bigint;
  readonly recurringFeeBasisPoints: bigint;
  readonly availableCapacityUsdMantissa: bigint;
  readonly evidence: FeeAwareOpportunityEvidence;
  readonly riskAssessment: FeeAwareRiskAssessment | null;
}

export interface FeeAwareBridgeEstimate {
  readonly bridgeProviderId: string;
  readonly entryEstimateReferenceId: string;
  readonly exitEstimateReferenceId: string;
  readonly entryMinimumOutputAtomic: bigint;
  readonly exitMinimumOutputAtomic: bigint;
}

export interface FeeAwareRouteCostQuote {
  readonly quoteReferenceId: string;
  readonly routeReferenceId: string;
  /** Prevents a quote from being replayed against another balance or yield opportunity. */
  readonly positionId: string;
  readonly opportunityId: string;
  /** Identifies the server adapter that authenticated and normalized the quote. */
  readonly verifiedByAdapterId: string;
  readonly quotedAt: string;
  readonly validUntil: string;
  readonly sourceNetworkId: MainnetLaunchNetworkId;
  readonly destinationNetworkId: MainnetLaunchNetworkId;
  readonly sourceAssetId: string;
  readonly destinationAssetId: string;
  readonly sourceAmountAtomic: bigint;
  readonly minimumDestinationAmountAtomic: bigint;
  /** Every lifecycle category must be present; an explicit 0n is different from omission. */
  readonly costsUsdMantissa: FeeAwareAllocationCostsUsdMantissa;
  readonly bridge: FeeAwareBridgeEstimate | null;
}

export interface FeeAwareAllocationCandidate {
  readonly candidateId: string;
  readonly positionId: string;
  readonly opportunityId: string;
  readonly costQuote: FeeAwareRouteCostQuote;
}

export interface FeeAwareCrossChainOptIn {
  readonly scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS';
  readonly consentReferenceId: string;
  readonly grantedAt: string;
  readonly expiresAt: string;
}

export interface FeeAwareCrossChainPolicy {
  /** This is recommendation consent, never approval of a transaction. */
  readonly optIn: FeeAwareCrossChainOptIn | null;
  readonly allowedBridgeProviderIds: readonly string[];
  readonly maximumLifecycleCostUsdMantissa: bigint;
  readonly minimumNetImprovementUsdMantissa: bigint;
}

export interface FeeAwareAllocationExposurePolicy {
  /** Aggregate across every selected Ethereum/Solana crossing in this recommendation. */
  readonly maximumCrossChainPrincipalUsdMantissa: bigint;
  /** Aggregate across all selected opportunities owned by the same provider. */
  readonly maximumProviderPrincipalUsdMantissa: bigint;
}

export interface FeeAwareAllocationRequest {
  readonly usdScale: typeof FEE_AWARE_ALLOCATION_USD_SCALE;
  /** Must be supplied from a trusted server clock by the runtime boundary. */
  readonly evaluatedAt: string;
  readonly holdingPeriodDays: bigint;
  readonly maximumQuoteAgeSeconds: bigint;
  readonly maximumOpportunityAgeSeconds: bigint;
  readonly minimumNetBenefitUsdMantissa: bigint;
  readonly crossChainPolicy: FeeAwareCrossChainPolicy;
  readonly exposurePolicy: FeeAwareAllocationExposurePolicy;
  readonly positions: readonly FeeAwareCapitalPosition[];
  readonly opportunities: readonly FeeAwareLendingOpportunity[];
  readonly candidates: readonly FeeAwareAllocationCandidate[];
}

export type FeeAwareCandidateReason =
  | 'INCOMPLETE_COST_QUOTE'
  | 'INVALID_COST_QUOTE'
  | 'COST_QUOTE_FROM_FUTURE'
  | 'COST_QUOTE_EXPIRED'
  | 'COST_QUOTE_STALE'
  | 'COST_QUOTE_POSITION_MISMATCH'
  | 'COST_QUOTE_OPPORTUNITY_MISMATCH'
  | 'ROUTE_NETWORK_MISMATCH'
  | 'ROUTE_ASSET_MISMATCH'
  | 'SOURCE_AMOUNT_MISMATCH'
  | 'OPPORTUNITY_UNAVAILABLE'
  | 'OPPORTUNITY_INELIGIBLE'
  | 'OPPORTUNITY_EVIDENCE_FROM_FUTURE'
  | 'OPPORTUNITY_EVIDENCE_EXPIRED'
  | 'OPPORTUNITY_EVIDENCE_STALE'
  | 'RISK_ASSESSMENT_REQUIRED'
  | 'RISK_ASSESSMENT_FROM_FUTURE'
  | 'RISK_ASSESSMENT_EXPIRED'
  | 'RISK_ASSESSMENT_STALE'
  | 'INSUFFICIENT_OPPORTUNITY_CAPACITY'
  | 'CROSS_CHAIN_OPT_IN_REQUIRED'
  | 'CROSS_CHAIN_OPT_IN_NOT_ACTIVE'
  | 'CROSS_CHAIN_OPT_IN_EXPIRED'
  | 'BRIDGE_ESTIMATE_REQUIRED'
  | 'BRIDGE_PROVIDER_NOT_ALLOWED'
  | 'UNEXPECTED_BRIDGE_ESTIMATE'
  | 'UNEXPECTED_BRIDGE_COST'
  | 'TOTAL_COST_EXCEEDS_PRINCIPAL'
  | 'CROSS_CHAIN_COST_LIMIT_EXCEEDED'
  | 'NON_POSITIVE_NET_BENEFIT'
  | 'MINIMUM_NET_BENEFIT_NOT_MET'
  | 'NO_ELIGIBLE_SAME_CHAIN_BASELINE'
  | 'CROSS_CHAIN_IMPROVEMENT_BELOW_THRESHOLD'
  | 'AGGREGATE_CAPACITY_EXCEEDED'
  | 'AGGREGATE_CROSS_CHAIN_PRINCIPAL_EXCEEDED'
  | 'AGGREGATE_PROVIDER_PRINCIPAL_EXCEEDED'
  | 'NUMERIC_LIMIT_EXCEEDED';

export interface FeeAwareCandidateCalculation {
  readonly grossApyBasisPoints: bigint;
  readonly recurringFeeBasisPoints: bigint;
  readonly riskPenaltyBasisPoints: bigint;
  readonly conservativeApyBasisPoints: bigint;
  readonly principalUsdMantissa: bigint;
  readonly deployedPrincipalUsdMantissa: bigint;
  readonly entryCostUsdMantissa: bigint;
  readonly anticipatedExitCostUsdMantissa: bigint;
  readonly totalLifecycleCostUsdMantissa: bigint;
  readonly costsUsdMantissa: FeeAwareAllocationCostsUsdMantissa;
  readonly projectedGrossYieldUsdMantissa: bigint;
  readonly projectedConservativeYieldUsdMantissa: bigint;
  readonly netBenefitUsdMantissa: bigint;
  readonly breakEvenDays: bigint | null;
  readonly improvementOverSameChainUsdMantissa: bigint | null;
}

export interface FeeAwareCandidateAssessment {
  readonly candidateId: string;
  readonly positionId: string;
  readonly opportunityId: string;
  readonly routeKind: 'SAME_CHAIN' | 'CROSS_CHAIN';
  readonly eligibility: 'ELIGIBLE' | 'REJECTED';
  readonly selected: boolean;
  readonly reasons: readonly FeeAwareCandidateReason[];
  readonly calculation: FeeAwareCandidateCalculation | null;
}

export interface FeeAwarePositionDecision {
  readonly positionId: string;
  readonly walletId: string;
  readonly sourceNetworkId: MainnetLaunchNetworkId;
  readonly sourceAssetId: string;
  readonly sourceAmountAtomic: bigint;
  readonly principalUsdMantissa: bigint;
  readonly selectedCandidateId: string | null;
  readonly selectedOpportunityId: string | null;
  readonly selectedProviderId: string | null;
  readonly selectedQuoteReferenceId: string | null;
  readonly selectedRouteReferenceId: string | null;
  readonly selectedOpportunityEvidenceReferenceId: string | null;
  readonly selectedRiskAssessmentReferenceId: string | null;
  readonly selectedRouteKind: 'SAME_CHAIN' | 'CROSS_CHAIN' | null;
  readonly requiresSeparateTransactionApproval: boolean;
  readonly assessments: readonly FeeAwareCandidateAssessment[];
}

export interface FeeAwareAllocationRecommendation {
  readonly policyVersion: typeof FEE_AWARE_ALLOCATION_POLICY_VERSION;
  readonly usdScale: typeof FEE_AWARE_ALLOCATION_USD_SCALE;
  readonly status: 'RECOMMENDED' | 'PARTIAL_RECOMMENDATION' | 'NO_ELIGIBLE_ROUTE' | 'INVALID_INPUT';
  readonly evaluatedAt: string | null;
  readonly holdingPeriodDays: bigint | null;
  readonly reasons: readonly ('INVALID_INPUT' | 'ONE_OR_MORE_POSITIONS_UNALLOCATED')[];
  readonly totalPrincipalUsdMantissa: bigint;
  readonly recommendedPrincipalUsdMantissa: bigint;
  readonly projectedNetBenefitUsdMantissa: bigint;
  readonly decisions: readonly FeeAwarePositionDecision[];
  readonly use: 'NON_EXECUTING_RECOMMENDATION_ONLY';
  readonly crossChainOptInMayAuthorizeTransaction: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayAuthorizeTransaction: false;
  readonly mayExecuteTransaction: false;
}

interface ParsedTimestamp {
  readonly text: string;
  readonly milliseconds: number;
}

interface ParsedOpportunity extends FeeAwareLendingOpportunity {
  readonly evidenceObservedAtMs: number;
  readonly evidenceValidUntilMs: number;
  readonly riskAssessedAtMs: number | null;
  readonly riskValidUntilMs: number | null;
}

interface ParsedOptIn extends FeeAwareCrossChainOptIn {
  readonly grantedAtMs: number;
  readonly expiresAtMs: number;
}

interface ParsedCostQuote extends Omit<FeeAwareRouteCostQuote, 'costsUsdMantissa'> {
  readonly quotedAtMs: number;
  readonly validUntilMs: number;
  readonly costsUsdMantissa: FeeAwareAllocationCostsUsdMantissa | null;
  readonly costIssue: 'INCOMPLETE_COST_QUOTE' | 'INVALID_COST_QUOTE' | null;
}

interface ParsedCandidate extends Omit<FeeAwareAllocationCandidate, 'costQuote'> {
  readonly costQuote: ParsedCostQuote | null;
  readonly quoteIssue: 'INVALID_COST_QUOTE' | null;
}

interface ParsedRequest extends Omit<
  FeeAwareAllocationRequest,
  'crossChainPolicy' | 'opportunities' | 'candidates'
> {
  readonly evaluatedAtMs: number;
  readonly crossChainPolicy: Omit<FeeAwareCrossChainPolicy, 'optIn'> & {
    readonly optIn: ParsedOptIn | null;
  };
  readonly opportunities: readonly ParsedOpportunity[];
  readonly candidates: readonly ParsedCandidate[];
}

interface InternalAssessment {
  readonly candidate: ParsedCandidate;
  readonly position: FeeAwareCapitalPosition;
  readonly opportunity: ParsedOpportunity;
  readonly routeKind: 'SAME_CHAIN' | 'CROSS_CHAIN';
  readonly reasons: FeeAwareCandidateReason[];
  calculation: FeeAwareCandidateCalculation | null;
  selected: boolean;
}

class InvalidInput extends Error {}

/**
 * Pure, deterministic recommendation policy. It performs no reads, writes, signatures, approvals,
 * or transactions. Structural evidence references are not authentication: a runtime boundary must
 * construct this request from a trusted server clock, verified adapters, and current risk policy.
 */
export function recommendFeeAwareAllocation(input: unknown): FeeAwareAllocationRecommendation {
  let request: ParsedRequest;
  try {
    request = parseRequest(input);
  } catch {
    return invalidRecommendation();
  }

  const positionById = new Map(
    request.positions.map((position) => [position.positionId, position]),
  );
  const opportunityById = new Map(
    request.opportunities.map((opportunity) => [opportunity.opportunityId, opportunity]),
  );
  const assessments: InternalAssessment[] = [];

  for (const candidate of request.candidates) {
    const position = positionById.get(candidate.positionId);
    const opportunity = opportunityById.get(candidate.opportunityId);
    if (!position || !opportunity) return invalidRecommendation();
    assessments.push(assessCandidate(request, candidate, position, opportunity));
  }

  applyCrossChainComparisonPolicy(request, assessments);
  selectCandidatesWithinLimits(assessments, request.opportunities, request.exposurePolicy);

  const decisions = request.positions
    .map((position) => positionDecision(position, assessments))
    .sort((left, right) => compareText(left.positionId, right.positionId));
  const selected = assessments.filter(({ selected }) => selected);
  const totalPrincipalUsdMantissa = boundedSum(
    request.positions.map(({ amountUsdMantissa }) => amountUsdMantissa),
  );
  const recommendedPrincipalUsdMantissa = boundedSum(
    selected.map(({ position }) => position.amountUsdMantissa),
  );
  const projectedNetBenefitUsdMantissa = selected.reduce(
    (total, assessment) => total + (assessment.calculation?.netBenefitUsdMantissa ?? 0n),
    0n,
  );
  if (
    totalPrincipalUsdMantissa === null ||
    recommendedPrincipalUsdMantissa === null ||
    projectedNetBenefitUsdMantissa > MAX_UINT256
  ) {
    return invalidRecommendation();
  }

  const selectedCount = selected.length;
  const status =
    selectedCount === request.positions.length
      ? 'RECOMMENDED'
      : selectedCount === 0
        ? 'NO_ELIGIBLE_ROUTE'
        : 'PARTIAL_RECOMMENDATION';

  return deepFreeze({
    policyVersion: FEE_AWARE_ALLOCATION_POLICY_VERSION,
    usdScale: FEE_AWARE_ALLOCATION_USD_SCALE,
    status,
    evaluatedAt: request.evaluatedAt,
    holdingPeriodDays: request.holdingPeriodDays,
    reasons:
      status === 'PARTIAL_RECOMMENDATION'
        ? (['ONE_OR_MORE_POSITIONS_UNALLOCATED'] as const)
        : ([] as const),
    totalPrincipalUsdMantissa,
    recommendedPrincipalUsdMantissa,
    projectedNetBenefitUsdMantissa,
    decisions,
    use: 'NON_EXECUTING_RECOMMENDATION_ONLY' as const,
    crossChainOptInMayAuthorizeTransaction: false as const,
    mayAuthorizeFinancialAction: false as const,
    mayAuthorizeTransaction: false as const,
    mayExecuteTransaction: false as const,
  });
}

function assessCandidate(
  request: ParsedRequest,
  candidate: ParsedCandidate,
  position: FeeAwareCapitalPosition,
  opportunity: ParsedOpportunity,
): InternalAssessment {
  const routeKind = position.networkId === opportunity.networkId ? 'SAME_CHAIN' : 'CROSS_CHAIN';
  const reasons: FeeAwareCandidateReason[] = [];
  const quote = candidate.costQuote;

  if (candidate.quoteIssue !== null || quote === null) {
    reasons.push(candidate.quoteIssue ?? 'INVALID_COST_QUOTE');
    return {
      candidate,
      position,
      opportunity,
      routeKind,
      reasons,
      calculation: null,
      selected: false,
    };
  }
  if (quote.costIssue !== null || quote.costsUsdMantissa === null) {
    reasons.push(quote.costIssue ?? 'INVALID_COST_QUOTE');
  }

  assessQuoteFreshness(request, quote, reasons);
  const positionBindingMatches = quote.positionId === position.positionId;
  const opportunityBindingMatches = quote.opportunityId === opportunity.opportunityId;
  if (!positionBindingMatches) {
    reasons.push('COST_QUOTE_POSITION_MISMATCH');
  }
  if (!opportunityBindingMatches) {
    reasons.push('COST_QUOTE_OPPORTUNITY_MISMATCH');
  }
  const networkBindingMismatch =
    quote.sourceNetworkId !== position.networkId ||
    quote.destinationNetworkId !== opportunity.networkId;
  if (networkBindingMismatch) {
    reasons.push('ROUTE_NETWORK_MISMATCH');
  }
  const assetBindingMismatch =
    quote.sourceAssetId !== position.assetId || quote.destinationAssetId !== opportunity.assetId;
  if (assetBindingMismatch) {
    reasons.push('ROUTE_ASSET_MISMATCH');
  }
  const sourceAmountMismatch = quote.sourceAmountAtomic !== position.amountAtomic;
  if (sourceAmountMismatch) {
    reasons.push('SOURCE_AMOUNT_MISMATCH');
  }

  assessOpportunity(request, opportunity, reasons);
  if (position.amountUsdMantissa > opportunity.availableCapacityUsdMantissa) {
    reasons.push('INSUFFICIENT_OPPORTUNITY_CAPACITY');
  }
  assessRouteKind(request, routeKind, quote, reasons);

  const calculation =
    quote.costsUsdMantissa === null ||
    !positionBindingMatches ||
    !opportunityBindingMatches ||
    networkBindingMismatch ||
    assetBindingMismatch ||
    sourceAmountMismatch
      ? null
      : calculateCandidate(request, position, opportunity, quote.costsUsdMantissa, reasons);

  return { candidate, position, opportunity, routeKind, reasons, calculation, selected: false };
}

function assessQuoteFreshness(
  request: ParsedRequest,
  quote: ParsedCostQuote,
  reasons: FeeAwareCandidateReason[],
): void {
  if (quote.quotedAtMs > request.evaluatedAtMs) reasons.push('COST_QUOTE_FROM_FUTURE');
  if (request.evaluatedAtMs >= quote.validUntilMs) reasons.push('COST_QUOTE_EXPIRED');
  if (
    quote.quotedAtMs <= request.evaluatedAtMs &&
    BigInt(request.evaluatedAtMs - quote.quotedAtMs) >= request.maximumQuoteAgeSeconds * 1_000n
  ) {
    reasons.push('COST_QUOTE_STALE');
  }
}

function assessOpportunity(
  request: ParsedRequest,
  opportunity: ParsedOpportunity,
  reasons: FeeAwareCandidateReason[],
): void {
  if (opportunity.availability !== 'AVAILABLE') reasons.push('OPPORTUNITY_UNAVAILABLE');
  if (opportunity.recommendationEligibility !== 'ELIGIBLE') {
    reasons.push('OPPORTUNITY_INELIGIBLE');
  }
  if (opportunity.evidenceObservedAtMs > request.evaluatedAtMs) {
    reasons.push('OPPORTUNITY_EVIDENCE_FROM_FUTURE');
  }
  if (request.evaluatedAtMs >= opportunity.evidenceValidUntilMs) {
    reasons.push('OPPORTUNITY_EVIDENCE_EXPIRED');
  }
  if (
    opportunity.evidenceObservedAtMs <= request.evaluatedAtMs &&
    BigInt(request.evaluatedAtMs - opportunity.evidenceObservedAtMs) >=
      request.maximumOpportunityAgeSeconds * 1_000n
  ) {
    reasons.push('OPPORTUNITY_EVIDENCE_STALE');
  }

  if (opportunity.riskAssessment === null) {
    reasons.push('RISK_ASSESSMENT_REQUIRED');
    return;
  }
  if ((opportunity.riskAssessedAtMs ?? Number.POSITIVE_INFINITY) > request.evaluatedAtMs) {
    reasons.push('RISK_ASSESSMENT_FROM_FUTURE');
  }
  if (request.evaluatedAtMs >= (opportunity.riskValidUntilMs ?? Number.NEGATIVE_INFINITY)) {
    reasons.push('RISK_ASSESSMENT_EXPIRED');
  }
  if (
    opportunity.riskAssessedAtMs !== null &&
    opportunity.riskAssessedAtMs <= request.evaluatedAtMs &&
    BigInt(request.evaluatedAtMs - opportunity.riskAssessedAtMs) >=
      request.maximumOpportunityAgeSeconds * 1_000n
  ) {
    reasons.push('RISK_ASSESSMENT_STALE');
  }
}

function assessRouteKind(
  request: ParsedRequest,
  routeKind: 'SAME_CHAIN' | 'CROSS_CHAIN',
  quote: ParsedCostQuote,
  reasons: FeeAwareCandidateReason[],
): void {
  const costs = quote.costsUsdMantissa;
  if (routeKind === 'SAME_CHAIN') {
    if (quote.bridge !== null) reasons.push('UNEXPECTED_BRIDGE_ESTIMATE');
    if (costs !== null && (costs.entryBridge !== 0n || costs.exitBridge !== 0n)) {
      reasons.push('UNEXPECTED_BRIDGE_COST');
    }
    return;
  }

  const optIn = request.crossChainPolicy.optIn;
  if (optIn === null) {
    reasons.push('CROSS_CHAIN_OPT_IN_REQUIRED');
  } else {
    if (request.evaluatedAtMs < optIn.grantedAtMs) {
      reasons.push('CROSS_CHAIN_OPT_IN_NOT_ACTIVE');
    }
    if (request.evaluatedAtMs >= optIn.expiresAtMs) {
      reasons.push('CROSS_CHAIN_OPT_IN_EXPIRED');
    }
  }
  if (quote.bridge === null) {
    reasons.push('BRIDGE_ESTIMATE_REQUIRED');
  } else if (
    !request.crossChainPolicy.allowedBridgeProviderIds.includes(quote.bridge.bridgeProviderId)
  ) {
    reasons.push('BRIDGE_PROVIDER_NOT_ALLOWED');
  }
}

function calculateCandidate(
  request: ParsedRequest,
  position: FeeAwareCapitalPosition,
  opportunity: ParsedOpportunity,
  costs: FeeAwareAllocationCostsUsdMantissa,
  reasons: FeeAwareCandidateReason[],
): FeeAwareCandidateCalculation | null {
  const entryCostUsdMantissa = boundedSum([
    costs.entrySourceNetwork,
    costs.entrySourceSwap,
    costs.entryBridge,
    costs.entryDestinationNetwork,
    costs.entryDestinationSwap,
    costs.providerEntry,
    costs.platformRouting,
    costs.riskBuffer,
  ]);
  const anticipatedExitCostUsdMantissa = boundedSum([
    costs.providerExit,
    costs.exitDestinationNetwork,
    costs.exitDestinationSwap,
    costs.exitBridge,
    costs.exitSourceNetwork,
  ]);
  const totalLifecycleCostUsdMantissa =
    entryCostUsdMantissa === null || anticipatedExitCostUsdMantissa === null
      ? null
      : boundedSum([entryCostUsdMantissa, anticipatedExitCostUsdMantissa]);
  if (
    entryCostUsdMantissa === null ||
    anticipatedExitCostUsdMantissa === null ||
    totalLifecycleCostUsdMantissa === null
  ) {
    reasons.push('NUMERIC_LIMIT_EXCEEDED');
    return null;
  }

  if (totalLifecycleCostUsdMantissa >= position.amountUsdMantissa) {
    reasons.push('TOTAL_COST_EXCEEDS_PRINCIPAL');
  }
  const deployedPrincipalUsdMantissa =
    entryCostUsdMantissa < position.amountUsdMantissa
      ? position.amountUsdMantissa - entryCostUsdMantissa
      : 0n;
  const riskPenaltyBasisPoints = opportunity.riskAssessment?.penaltyBasisPoints ?? 0n;
  const totalApyDeductions = opportunity.recurringFeeBasisPoints + riskPenaltyBasisPoints;
  const conservativeApyBasisPoints =
    opportunity.grossApyBasisPoints > totalApyDeductions
      ? opportunity.grossApyBasisPoints - totalApyDeductions
      : 0n;
  const projectedGrossYieldUsdMantissa = projectedYield(
    deployedPrincipalUsdMantissa,
    opportunity.grossApyBasisPoints,
    request.holdingPeriodDays,
  );
  const projectedConservativeYieldUsdMantissa = projectedYield(
    deployedPrincipalUsdMantissa,
    conservativeApyBasisPoints,
    request.holdingPeriodDays,
  );
  if (projectedGrossYieldUsdMantissa === null || projectedConservativeYieldUsdMantissa === null) {
    reasons.push('NUMERIC_LIMIT_EXCEEDED');
    return null;
  }
  const netBenefitUsdMantissa =
    projectedConservativeYieldUsdMantissa - totalLifecycleCostUsdMantissa;
  if (netBenefitUsdMantissa <= 0n) reasons.push('NON_POSITIVE_NET_BENEFIT');
  if (netBenefitUsdMantissa < request.minimumNetBenefitUsdMantissa) {
    reasons.push('MINIMUM_NET_BENEFIT_NOT_MET');
  }
  const breakEvenDays = calculateBreakEvenDays(
    deployedPrincipalUsdMantissa,
    conservativeApyBasisPoints,
    totalLifecycleCostUsdMantissa,
  );

  return deepFreeze({
    grossApyBasisPoints: opportunity.grossApyBasisPoints,
    recurringFeeBasisPoints: opportunity.recurringFeeBasisPoints,
    riskPenaltyBasisPoints,
    conservativeApyBasisPoints,
    principalUsdMantissa: position.amountUsdMantissa,
    deployedPrincipalUsdMantissa,
    entryCostUsdMantissa,
    anticipatedExitCostUsdMantissa,
    totalLifecycleCostUsdMantissa,
    costsUsdMantissa: costs,
    projectedGrossYieldUsdMantissa,
    projectedConservativeYieldUsdMantissa,
    netBenefitUsdMantissa,
    breakEvenDays,
    improvementOverSameChainUsdMantissa: null,
  });
}

function applyCrossChainComparisonPolicy(
  request: ParsedRequest,
  assessments: InternalAssessment[],
): void {
  for (const position of request.positions) {
    const sameChain = assessments
      .filter(
        (assessment) =>
          assessment.position.positionId === position.positionId &&
          assessment.routeKind === 'SAME_CHAIN' &&
          assessment.reasons.length === 0 &&
          assessment.calculation !== null,
      )
      .sort(compareAssessments);
    const baseline = sameChain[0]?.calculation?.netBenefitUsdMantissa ?? null;

    for (const assessment of assessments) {
      if (
        assessment.position.positionId !== position.positionId ||
        assessment.routeKind !== 'CROSS_CHAIN' ||
        assessment.calculation === null
      ) {
        continue;
      }
      if (baseline === null) {
        assessment.reasons.push('NO_ELIGIBLE_SAME_CHAIN_BASELINE');
        continue;
      }
      const improvement = assessment.calculation.netBenefitUsdMantissa - baseline;
      assessment.calculation = deepFreeze({
        ...assessment.calculation,
        improvementOverSameChainUsdMantissa: improvement,
      });
      if (
        assessment.calculation.totalLifecycleCostUsdMantissa >
        request.crossChainPolicy.maximumLifecycleCostUsdMantissa
      ) {
        assessment.reasons.push('CROSS_CHAIN_COST_LIMIT_EXCEEDED');
      }
      if (improvement < request.crossChainPolicy.minimumNetImprovementUsdMantissa) {
        assessment.reasons.push('CROSS_CHAIN_IMPROVEMENT_BELOW_THRESHOLD');
      }
    }
  }
}

function selectCandidatesWithinLimits(
  assessments: InternalAssessment[],
  opportunities: readonly ParsedOpportunity[],
  exposurePolicy: FeeAwareAllocationExposurePolicy,
): void {
  const remainingCapacity = new Map(
    opportunities.map(({ opportunityId, availableCapacityUsdMantissa }) => [
      opportunityId,
      availableCapacityUsdMantissa,
    ]),
  );
  const remainingProviderPrincipal = new Map<string, bigint>();
  let remainingCrossChainPrincipal = exposurePolicy.maximumCrossChainPrincipalUsdMantissa;
  const positionGroups = new Map<string, InternalAssessment[]>();
  for (const assessment of assessments) {
    const group = positionGroups.get(assessment.position.positionId) ?? [];
    group.push(assessment);
    positionGroups.set(assessment.position.positionId, group);
  }
  const orderedGroups = [...positionGroups.values()].sort((left, right) => {
    const leftBest = left.filter(isEligibleInternal).sort(compareAssessments)[0];
    const rightBest = right.filter(isEligibleInternal).sort(compareAssessments)[0];
    const valueComparison = compareOptionalNetBenefit(leftBest, rightBest);
    if (valueComparison !== 0) return valueComparison;
    return compareText(left[0]?.position.positionId ?? '', right[0]?.position.positionId ?? '');
  });

  for (const group of orderedGroups) {
    for (const assessment of group.filter(isEligibleInternal).sort(compareAssessments)) {
      const opportunityId = assessment.opportunity.opportunityId;
      const capacity = remainingCapacity.get(opportunityId) ?? 0n;
      if (capacity < assessment.position.amountUsdMantissa) {
        assessment.reasons.push('AGGREGATE_CAPACITY_EXCEEDED');
        continue;
      }
      if (
        assessment.routeKind === 'CROSS_CHAIN' &&
        remainingCrossChainPrincipal < assessment.position.amountUsdMantissa
      ) {
        assessment.reasons.push('AGGREGATE_CROSS_CHAIN_PRINCIPAL_EXCEEDED');
        continue;
      }
      const providerId = assessment.opportunity.providerId;
      const providerCapacity =
        remainingProviderPrincipal.get(providerId) ??
        exposurePolicy.maximumProviderPrincipalUsdMantissa;
      if (providerCapacity < assessment.position.amountUsdMantissa) {
        assessment.reasons.push('AGGREGATE_PROVIDER_PRINCIPAL_EXCEEDED');
        continue;
      }
      assessment.selected = true;
      remainingCapacity.set(opportunityId, capacity - assessment.position.amountUsdMantissa);
      remainingProviderPrincipal.set(
        providerId,
        providerCapacity - assessment.position.amountUsdMantissa,
      );
      if (assessment.routeKind === 'CROSS_CHAIN') {
        remainingCrossChainPrincipal -= assessment.position.amountUsdMantissa;
      }
      break;
    }
  }
}

function positionDecision(
  position: FeeAwareCapitalPosition,
  assessments: readonly InternalAssessment[],
): FeeAwarePositionDecision {
  const matching = assessments
    .filter((assessment) => assessment.position.positionId === position.positionId)
    .sort((left, right) => compareText(left.candidate.candidateId, right.candidate.candidateId));
  const selected = matching.find((assessment) => assessment.selected) ?? null;
  return deepFreeze({
    positionId: position.positionId,
    walletId: position.walletId,
    sourceNetworkId: position.networkId,
    sourceAssetId: position.assetId,
    sourceAmountAtomic: position.amountAtomic,
    principalUsdMantissa: position.amountUsdMantissa,
    selectedCandidateId: selected?.candidate.candidateId ?? null,
    selectedOpportunityId: selected?.opportunity.opportunityId ?? null,
    selectedProviderId: selected?.opportunity.providerId ?? null,
    selectedQuoteReferenceId: selected?.candidate.costQuote?.quoteReferenceId ?? null,
    selectedRouteReferenceId: selected?.candidate.costQuote?.routeReferenceId ?? null,
    selectedOpportunityEvidenceReferenceId:
      selected?.opportunity.evidence.evidenceReferenceId ?? null,
    selectedRiskAssessmentReferenceId:
      selected?.opportunity.riskAssessment?.assessmentReferenceId ?? null,
    selectedRouteKind: selected?.routeKind ?? null,
    requiresSeparateTransactionApproval: selected !== null,
    assessments: matching.map(publicAssessment),
  });
}

function publicAssessment(assessment: InternalAssessment): FeeAwareCandidateAssessment {
  return deepFreeze({
    candidateId: assessment.candidate.candidateId,
    positionId: assessment.position.positionId,
    opportunityId: assessment.opportunity.opportunityId,
    routeKind: assessment.routeKind,
    eligibility: assessment.reasons.length === 0 ? 'ELIGIBLE' : 'REJECTED',
    selected: assessment.selected,
    reasons: [...assessment.reasons],
    calculation: assessment.calculation,
  });
}

function isEligibleInternal(assessment: InternalAssessment): boolean {
  return assessment.reasons.length === 0 && assessment.calculation !== null;
}

function compareAssessments(left: InternalAssessment, right: InternalAssessment): number {
  const leftCalculation = left.calculation;
  const rightCalculation = right.calculation;
  if (leftCalculation === null) return rightCalculation === null ? 0 : 1;
  if (rightCalculation === null) return -1;
  if (leftCalculation.netBenefitUsdMantissa !== rightCalculation.netBenefitUsdMantissa) {
    return leftCalculation.netBenefitUsdMantissa > rightCalculation.netBenefitUsdMantissa ? -1 : 1;
  }
  if (left.routeKind !== right.routeKind) return left.routeKind === 'SAME_CHAIN' ? -1 : 1;
  if (
    leftCalculation.totalLifecycleCostUsdMantissa !== rightCalculation.totalLifecycleCostUsdMantissa
  ) {
    return leftCalculation.totalLifecycleCostUsdMantissa <
      rightCalculation.totalLifecycleCostUsdMantissa
      ? -1
      : 1;
  }
  return compareText(left.candidate.candidateId, right.candidate.candidateId);
}

function compareOptionalNetBenefit(
  left: InternalAssessment | undefined,
  right: InternalAssessment | undefined,
): number {
  const leftValue = left?.calculation?.netBenefitUsdMantissa;
  const rightValue = right?.calculation?.netBenefitUsdMantissa;
  if (leftValue === undefined) return rightValue === undefined ? 0 : 1;
  if (rightValue === undefined) return -1;
  return leftValue === rightValue ? 0 : leftValue > rightValue ? -1 : 1;
}

function projectedYield(
  principalUsdMantissa: bigint,
  apyBasisPoints: bigint,
  holdingPeriodDays: bigint,
): bigint | null {
  const value =
    (principalUsdMantissa * apyBasisPoints * holdingPeriodDays) /
    (BASIS_POINTS_DENOMINATOR * DAYS_PER_YEAR);
  return value <= MAX_UINT256 ? value : null;
}

function calculateBreakEvenDays(
  principalUsdMantissa: bigint,
  apyBasisPoints: bigint,
  totalCostsUsdMantissa: bigint,
): bigint | null {
  if (totalCostsUsdMantissa === 0n) return 0n;
  const dailyYieldNumerator = principalUsdMantissa * apyBasisPoints;
  if (dailyYieldNumerator === 0n) return null;
  const numerator = totalCostsUsdMantissa * BASIS_POINTS_DENOMINATOR * DAYS_PER_YEAR;
  return (numerator + dailyYieldNumerator - 1n) / dailyYieldNumerator;
}

function parseRequest(value: unknown): ParsedRequest {
  const record = exactRecord(value, [
    'usdScale',
    'evaluatedAt',
    'holdingPeriodDays',
    'maximumQuoteAgeSeconds',
    'maximumOpportunityAgeSeconds',
    'minimumNetBenefitUsdMantissa',
    'crossChainPolicy',
    'exposurePolicy',
    'positions',
    'opportunities',
    'candidates',
  ]);
  if (record.usdScale !== FEE_AWARE_ALLOCATION_USD_SCALE) throw new InvalidInput();
  const evaluatedAt = timestamp(record.evaluatedAt);
  const holdingPeriodDays = positiveBigInt(record.holdingPeriodDays, MAX_HOLDING_PERIOD_DAYS);
  const maximumQuoteAgeSeconds = positiveBigInt(
    record.maximumQuoteAgeSeconds,
    MAX_FRESHNESS_SECONDS,
  );
  const maximumOpportunityAgeSeconds = positiveBigInt(
    record.maximumOpportunityAgeSeconds,
    MAX_FRESHNESS_SECONDS,
  );
  const minimumNetBenefitUsdMantissa = unsignedBigInt(record.minimumNetBenefitUsdMantissa);
  const positions = exactArray(record.positions, 1, 64).map(parsePosition);
  const opportunities = exactArray(record.opportunities, 1, 256).map(parseOpportunity);
  const candidates = exactArray(record.candidates, 0, 1_024).map(parseCandidate);
  unique(positions.map(({ positionId }) => positionId));
  unique(opportunities.map(({ opportunityId }) => opportunityId));
  unique(candidates.map(({ candidateId }) => candidateId));

  return {
    usdScale: FEE_AWARE_ALLOCATION_USD_SCALE,
    evaluatedAt: evaluatedAt.text,
    evaluatedAtMs: evaluatedAt.milliseconds,
    holdingPeriodDays,
    maximumQuoteAgeSeconds,
    maximumOpportunityAgeSeconds,
    minimumNetBenefitUsdMantissa,
    crossChainPolicy: parseCrossChainPolicy(record.crossChainPolicy),
    exposurePolicy: parseExposurePolicy(record.exposurePolicy),
    positions,
    opportunities,
    candidates,
  };
}

function parsePosition(value: unknown): FeeAwareCapitalPosition {
  const record = exactRecord(value, [
    'positionId',
    'walletId',
    'networkId',
    'assetId',
    'amountAtomic',
    'amountUsdMantissa',
  ]);
  return {
    positionId: reference(record.positionId),
    walletId: reference(record.walletId),
    networkId: networkId(record.networkId),
    assetId: reference(record.assetId),
    amountAtomic: positiveBigInt(record.amountAtomic, MAX_UINT256),
    amountUsdMantissa: positiveBigInt(record.amountUsdMantissa, MAX_UINT256),
  };
}

function parseOpportunity(value: unknown): ParsedOpportunity {
  const record = exactRecord(value, [
    'opportunityId',
    'providerId',
    'networkId',
    'assetId',
    'availability',
    'recommendationEligibility',
    'grossApyBasisPoints',
    'recurringFeeBasisPoints',
    'availableCapacityUsdMantissa',
    'evidence',
    'riskAssessment',
  ]);
  const evidenceRecord = exactRecord(record.evidence, [
    'evidenceReferenceId',
    'adapterId',
    'observedAt',
    'validUntil',
  ]);
  const observedAt = timestamp(evidenceRecord.observedAt);
  const evidenceValidUntil = timestamp(evidenceRecord.validUntil);
  if (evidenceValidUntil.milliseconds <= observedAt.milliseconds) throw new InvalidInput();
  const risk = parseRiskAssessment(record.riskAssessment);
  return {
    opportunityId: reference(record.opportunityId),
    providerId: reference(record.providerId),
    networkId: networkId(record.networkId),
    assetId: reference(record.assetId),
    availability: enumValue(record.availability, ['AVAILABLE', 'UNAVAILABLE'] as const),
    recommendationEligibility: enumValue(record.recommendationEligibility, [
      'ELIGIBLE',
      'INELIGIBLE',
    ] as const),
    grossApyBasisPoints: unsignedBigInt(record.grossApyBasisPoints, MAX_RATE_BASIS_POINTS),
    recurringFeeBasisPoints: unsignedBigInt(record.recurringFeeBasisPoints, MAX_RATE_BASIS_POINTS),
    availableCapacityUsdMantissa: unsignedBigInt(record.availableCapacityUsdMantissa),
    evidence: {
      evidenceReferenceId: reference(evidenceRecord.evidenceReferenceId),
      adapterId: reference(evidenceRecord.adapterId),
      observedAt: observedAt.text,
      validUntil: evidenceValidUntil.text,
    },
    riskAssessment: risk?.value ?? null,
    evidenceObservedAtMs: observedAt.milliseconds,
    evidenceValidUntilMs: evidenceValidUntil.milliseconds,
    riskAssessedAtMs: risk?.assessedAtMs ?? null,
    riskValidUntilMs: risk?.validUntilMs ?? null,
  };
}

function parseRiskAssessment(value: unknown): {
  readonly value: FeeAwareRiskAssessment;
  readonly assessedAtMs: number;
  readonly validUntilMs: number;
} | null {
  if (value === null) return null;
  const record = exactRecord(value, [
    'status',
    'assessmentReferenceId',
    'assessedAt',
    'validUntil',
    'penaltyBasisPoints',
  ]);
  if (record.status !== 'APPROVED_FOR_RECOMMENDATION') throw new InvalidInput();
  const assessedAt = timestamp(record.assessedAt);
  const validUntil = timestamp(record.validUntil);
  if (validUntil.milliseconds <= assessedAt.milliseconds) throw new InvalidInput();
  return {
    value: {
      status: 'APPROVED_FOR_RECOMMENDATION',
      assessmentReferenceId: reference(record.assessmentReferenceId),
      assessedAt: assessedAt.text,
      validUntil: validUntil.text,
      penaltyBasisPoints: unsignedBigInt(record.penaltyBasisPoints, MAX_RATE_BASIS_POINTS),
    },
    assessedAtMs: assessedAt.milliseconds,
    validUntilMs: validUntil.milliseconds,
  };
}

function parseCandidate(value: unknown): ParsedCandidate {
  const record = exactRecord(value, ['candidateId', 'positionId', 'opportunityId', 'costQuote']);
  let costQuote: ParsedCostQuote | null = null;
  let quoteIssue: 'INVALID_COST_QUOTE' | null = null;
  try {
    costQuote = parseCostQuote(record.costQuote);
  } catch {
    quoteIssue = 'INVALID_COST_QUOTE';
  }
  return {
    candidateId: reference(record.candidateId),
    positionId: reference(record.positionId),
    opportunityId: reference(record.opportunityId),
    costQuote,
    quoteIssue,
  };
}

function parseCostQuote(value: unknown): ParsedCostQuote {
  const record = exactRecord(value, [
    'quoteReferenceId',
    'routeReferenceId',
    'positionId',
    'opportunityId',
    'verifiedByAdapterId',
    'quotedAt',
    'validUntil',
    'sourceNetworkId',
    'destinationNetworkId',
    'sourceAssetId',
    'destinationAssetId',
    'sourceAmountAtomic',
    'minimumDestinationAmountAtomic',
    'costsUsdMantissa',
    'bridge',
  ]);
  const quotedAt = timestamp(record.quotedAt);
  const validUntil = timestamp(record.validUntil);
  if (validUntil.milliseconds <= quotedAt.milliseconds) throw new InvalidInput();
  const parsedCosts = parseCosts(record.costsUsdMantissa);
  return {
    quoteReferenceId: reference(record.quoteReferenceId),
    routeReferenceId: reference(record.routeReferenceId),
    positionId: reference(record.positionId),
    opportunityId: reference(record.opportunityId),
    verifiedByAdapterId: reference(record.verifiedByAdapterId),
    quotedAt: quotedAt.text,
    validUntil: validUntil.text,
    quotedAtMs: quotedAt.milliseconds,
    validUntilMs: validUntil.milliseconds,
    sourceNetworkId: networkId(record.sourceNetworkId),
    destinationNetworkId: networkId(record.destinationNetworkId),
    sourceAssetId: reference(record.sourceAssetId),
    destinationAssetId: reference(record.destinationAssetId),
    sourceAmountAtomic: positiveBigInt(record.sourceAmountAtomic, MAX_UINT256),
    minimumDestinationAmountAtomic: positiveBigInt(
      record.minimumDestinationAmountAtomic,
      MAX_UINT256,
    ),
    costsUsdMantissa: parsedCosts.value,
    costIssue: parsedCosts.issue,
    bridge: parseBridge(record.bridge),
  };
}

function parseCosts(value: unknown): {
  readonly value: FeeAwareAllocationCostsUsdMantissa | null;
  readonly issue: 'INCOMPLETE_COST_QUOTE' | 'INVALID_COST_QUOTE' | null;
} {
  const descriptors = dataDescriptors(value);
  if (descriptors === null) return { value: null, issue: 'INVALID_COST_QUOTE' };
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== FEE_AWARE_ALLOCATION_COST_KINDS.length ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !FEE_AWARE_ALLOCATION_COST_KINDS.includes(key as FeeAwareAllocationCostKind),
    )
  ) {
    return { value: null, issue: 'INCOMPLETE_COST_QUOTE' };
  }
  const result = Object.create(null) as Record<FeeAwareAllocationCostKind, bigint>;
  for (const kind of FEE_AWARE_ALLOCATION_COST_KINDS) {
    const descriptor = descriptors[kind];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      return { value: null, issue: 'INVALID_COST_QUOTE' };
    }
    try {
      result[kind] = unsignedBigInt(descriptor.value, MAX_UINT256);
    } catch {
      return { value: null, issue: 'INVALID_COST_QUOTE' };
    }
  }
  return { value: result, issue: null };
}

function parseBridge(value: unknown): FeeAwareBridgeEstimate | null {
  if (value === null) return null;
  const record = exactRecord(value, [
    'bridgeProviderId',
    'entryEstimateReferenceId',
    'exitEstimateReferenceId',
    'entryMinimumOutputAtomic',
    'exitMinimumOutputAtomic',
  ]);
  return {
    bridgeProviderId: reference(record.bridgeProviderId),
    entryEstimateReferenceId: reference(record.entryEstimateReferenceId),
    exitEstimateReferenceId: reference(record.exitEstimateReferenceId),
    entryMinimumOutputAtomic: positiveBigInt(record.entryMinimumOutputAtomic, MAX_UINT256),
    exitMinimumOutputAtomic: positiveBigInt(record.exitMinimumOutputAtomic, MAX_UINT256),
  };
}

function parseCrossChainPolicy(value: unknown): ParsedRequest['crossChainPolicy'] {
  const record = exactRecord(value, [
    'optIn',
    'allowedBridgeProviderIds',
    'maximumLifecycleCostUsdMantissa',
    'minimumNetImprovementUsdMantissa',
  ]);
  const allowedBridgeProviderIds = exactArray(record.allowedBridgeProviderIds, 0, 32).map(
    reference,
  );
  unique(allowedBridgeProviderIds);
  return {
    optIn: parseOptIn(record.optIn),
    allowedBridgeProviderIds,
    maximumLifecycleCostUsdMantissa: unsignedBigInt(record.maximumLifecycleCostUsdMantissa),
    minimumNetImprovementUsdMantissa: unsignedBigInt(record.minimumNetImprovementUsdMantissa),
  };
}

function parseExposurePolicy(value: unknown): FeeAwareAllocationExposurePolicy {
  const record = exactRecord(value, [
    'maximumCrossChainPrincipalUsdMantissa',
    'maximumProviderPrincipalUsdMantissa',
  ]);
  return {
    maximumCrossChainPrincipalUsdMantissa: unsignedBigInt(
      record.maximumCrossChainPrincipalUsdMantissa,
    ),
    maximumProviderPrincipalUsdMantissa: unsignedBigInt(record.maximumProviderPrincipalUsdMantissa),
  };
}

function parseOptIn(value: unknown): ParsedOptIn | null {
  if (value === null) return null;
  const record = exactRecord(value, ['scope', 'consentReferenceId', 'grantedAt', 'expiresAt']);
  if (record.scope !== 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS') throw new InvalidInput();
  const grantedAt = timestamp(record.grantedAt);
  const expiresAt = timestamp(record.expiresAt);
  if (expiresAt.milliseconds <= grantedAt.milliseconds) throw new InvalidInput();
  return {
    scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS',
    consentReferenceId: reference(record.consentReferenceId),
    grantedAt: grantedAt.text,
    expiresAt: expiresAt.text,
    grantedAtMs: grantedAt.milliseconds,
    expiresAtMs: expiresAt.milliseconds,
  };
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  const descriptors = dataDescriptors(value);
  if (descriptors === null) throw new InvalidInput();
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    throw new InvalidInput();
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new InvalidInput();
    }
    result[key] = descriptor.value;
  }
  return result;
}

function dataDescriptors(value: unknown): PropertyDescriptorMap | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
}

function exactArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      throw new InvalidInput();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors['length'] as PropertyDescriptor | undefined;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) throw new InvalidInput();
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < minimum ||
      length > maximum
    ) {
      throw new InvalidInput();
    }
    const allowed = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    if (
      Reflect.ownKeys(descriptors).length !== allowed.size ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !allowed.has(key))
    ) {
      throw new InvalidInput();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new InvalidInput();
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof InvalidInput) throw error;
    throw new InvalidInput();
  }
}

function timestamp(value: unknown): ParsedTimestamp {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP_PATTERN.test(value)) {
    throw new InvalidInput();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new InvalidInput();
  return { text: value, milliseconds: date.getTime() };
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE_PATTERN.test(value)) throw new InvalidInput();
  return value;
}

function networkId(value: unknown): MainnetLaunchNetworkId {
  if (
    typeof value !== 'string' ||
    !MAINNET_LAUNCH_NETWORK_IDS.includes(value as MainnetLaunchNetworkId)
  ) {
    throw new InvalidInput();
  }
  return value as MainnetLaunchNetworkId;
}

function unsignedBigInt(value: unknown, maximum: bigint = MAX_UINT256): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > maximum) throw new InvalidInput();
  return value;
}

function positiveBigInt(value: unknown, maximum: bigint): bigint {
  const parsed = unsignedBigInt(value, maximum);
  if (parsed === 0n) throw new InvalidInput();
  return parsed;
}

function enumValue<const Value extends string>(value: unknown, allowed: readonly Value[]): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) throw new InvalidInput();
  return value as Value;
}

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new InvalidInput();
}

function boundedSum(values: readonly bigint[]): bigint | null {
  let total = 0n;
  for (const value of values) {
    total += value;
    if (total > MAX_UINT256) return null;
  }
  return total;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function invalidRecommendation(): FeeAwareAllocationRecommendation {
  return deepFreeze({
    policyVersion: FEE_AWARE_ALLOCATION_POLICY_VERSION,
    usdScale: FEE_AWARE_ALLOCATION_USD_SCALE,
    status: 'INVALID_INPUT' as const,
    evaluatedAt: null,
    holdingPeriodDays: null,
    reasons: ['INVALID_INPUT'] as const,
    totalPrincipalUsdMantissa: 0n,
    recommendedPrincipalUsdMantissa: 0n,
    projectedNetBenefitUsdMantissa: 0n,
    decisions: [] as const,
    use: 'NON_EXECUTING_RECOMMENDATION_ONLY' as const,
    crossChainOptInMayAuthorizeTransaction: false as const,
    mayAuthorizeFinancialAction: false as const,
    mayAuthorizeTransaction: false as const,
    mayExecuteTransaction: false as const,
  });
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
