import {
  FEE_AWARE_ALLOCATION_NETWORK_IDS,
  FEE_AWARE_ALLOCATION_USD_SCALE,
  recommendFeeAwareAllocation,
  type FeeAwareAllocationCandidate,
  type FeeAwareAllocationCostsUsdMantissa,
  type FeeAwareAllocationRequest,
  type FeeAwareCandidateAssessment,
  type FeeAwareCapitalPosition,
  type FeeAwareCrossChainOptIn,
  type FeeAwareLendingOpportunity,
} from './fee-aware-allocation';
import { PORTFOLIO_USD_SCALE } from '../../portfolio/domain/unified-portfolio';

const ETHEREUM = FEE_AWARE_ALLOCATION_NETWORK_IDS[0];
const SOLANA = FEE_AWARE_ALLOCATION_NETWORK_IDS[1];
const EVALUATED_AT = '2026-09-03T12:00:00.000Z';

function costs(
  overrides: Partial<FeeAwareAllocationCostsUsdMantissa> = {},
): FeeAwareAllocationCostsUsdMantissa {
  return {
    entrySourceNetwork: 0n,
    entrySourceSwap: 0n,
    entryBridge: 0n,
    entryDestinationNetwork: 0n,
    entryDestinationSwap: 0n,
    providerEntry: 0n,
    providerExit: 0n,
    exitDestinationNetwork: 0n,
    exitDestinationSwap: 0n,
    exitBridge: 0n,
    exitSourceNetwork: 0n,
    platformRouting: 0n,
    riskBuffer: 0n,
    ...overrides,
  };
}

function position(overrides: Partial<FeeAwareCapitalPosition> = {}): FeeAwareCapitalPosition {
  return {
    positionId: 'position-ethereum-usdc',
    walletId: 'wallet-1',
    networkId: ETHEREUM,
    assetId: 'ethereum-usdc',
    amountAtomic: 1_000_000_000n,
    amountUsdMantissa: 100_000n,
    ...overrides,
  };
}

function opportunity(
  overrides: Partial<FeeAwareLendingOpportunity> = {},
): FeeAwareLendingOpportunity {
  return {
    opportunityId: 'opportunity-ethereum-usdc',
    providerId: 'provider-a',
    networkId: ETHEREUM,
    assetId: 'ethereum-usdc',
    availability: 'AVAILABLE',
    recommendationEligibility: 'ELIGIBLE',
    grossApyBasisPoints: 500n,
    recurringFeeBasisPoints: 0n,
    availableCapacityUsdMantissa: 10_000_000n,
    evidence: {
      evidenceReferenceId: 'evidence-1',
      adapterId: 'verified-provider-adapter',
      observedAt: '2026-09-03T11:59:00.001Z',
      validUntil: '2026-09-03T12:05:00.000Z',
    },
    riskAssessment: {
      status: 'APPROVED_FOR_RECOMMENDATION',
      assessmentReferenceId: 'risk-assessment-1',
      assessedAt: '2026-09-03T11:59:00.001Z',
      validUntil: '2026-09-03T12:05:00.000Z',
      penaltyBasisPoints: 0n,
    },
    ...overrides,
  };
}

interface CandidateOptions {
  readonly candidateId?: string;
  readonly costs?: FeeAwareAllocationCostsUsdMantissa;
  readonly quotedAt?: string;
  readonly validUntil?: string;
  readonly entryBridgeProviderId?: string;
  readonly exitBridgeProviderId?: string;
}

function candidate(
  source: FeeAwareCapitalPosition,
  target: FeeAwareLendingOpportunity,
  options: CandidateOptions = {},
): FeeAwareAllocationCandidate {
  const crossChain = source.networkId !== target.networkId;
  return {
    candidateId: options.candidateId ?? `candidate-${source.positionId}-${target.opportunityId}`,
    positionId: source.positionId,
    opportunityId: target.opportunityId,
    costQuote: {
      quoteReferenceId: `quote-${source.positionId}-${target.opportunityId}`,
      routeReferenceId: `route-${source.positionId}-${target.opportunityId}`,
      positionId: source.positionId,
      opportunityId: target.opportunityId,
      verifiedByAdapterId: 'verified-route-adapter',
      quotedAt: options.quotedAt ?? '2026-09-03T11:59:30.000Z',
      validUntil: options.validUntil ?? '2026-09-03T12:01:00.000Z',
      sourceNetworkId: source.networkId,
      destinationNetworkId: target.networkId,
      sourceAssetId: source.assetId,
      destinationAssetId: target.assetId,
      sourceAmountAtomic: source.amountAtomic,
      minimumDestinationAmountAtomic: 990_000_000n,
      costsUsdMantissa: options.costs ?? costs(),
      bridge: crossChain
        ? {
            entryBridgeProviderId: options.entryBridgeProviderId ?? 'wormhole',
            exitBridgeProviderId: options.exitBridgeProviderId ?? 'wormhole',
            entryEstimateReferenceId: 'bridge-entry-estimate-1',
            exitEstimateReferenceId: 'bridge-exit-estimate-1',
            entryMinimumOutputAtomic: 990_000_000n,
            exitMinimumOutputAtomic: 980_000_000n,
          }
        : null,
    },
  };
}

function activeOptIn(overrides: Partial<FeeAwareCrossChainOptIn> = {}): FeeAwareCrossChainOptIn {
  return {
    scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS',
    consentReferenceId: 'cross-chain-consent-1',
    grantedAt: '2026-09-03T11:55:00.000Z',
    expiresAt: '2026-09-03T12:05:00.000Z',
    ...overrides,
  };
}

function request(
  values: {
    readonly positions: readonly FeeAwareCapitalPosition[];
    readonly opportunities: readonly FeeAwareLendingOpportunity[];
    readonly candidates: readonly FeeAwareAllocationCandidate[];
    readonly optIn?: FeeAwareCrossChainOptIn | null;
    readonly maximumCrossChainCost?: bigint;
    readonly minimumCrossChainImprovement?: bigint;
    readonly maximumCrossChainPrincipal?: bigint;
    readonly maximumProviderPrincipal?: bigint;
  },
  overrides: Partial<
    Pick<
      FeeAwareAllocationRequest,
      | 'evaluatedAt'
      | 'holdingPeriodDays'
      | 'maximumQuoteAgeSeconds'
      | 'maximumOpportunityAgeSeconds'
      | 'minimumNetBenefitUsdMantissa'
    >
  > = {},
): FeeAwareAllocationRequest {
  return {
    usdScale: FEE_AWARE_ALLOCATION_USD_SCALE,
    evaluatedAt: EVALUATED_AT,
    holdingPeriodDays: 365n,
    maximumQuoteAgeSeconds: 60n,
    maximumOpportunityAgeSeconds: 300n,
    minimumNetBenefitUsdMantissa: 1n,
    crossChainPolicy: {
      optIn: values.optIn ?? null,
      allowedBridgeProviderIds: ['wormhole'],
      maximumLifecycleCostUsdMantissa: values.maximumCrossChainCost ?? 5_000n,
      minimumNetImprovementUsdMantissa: values.minimumCrossChainImprovement ?? 500n,
    },
    exposurePolicy: {
      maximumCrossChainPrincipalUsdMantissa: values.maximumCrossChainPrincipal ?? 10_000_000n,
      maximumProviderPrincipalUsdMantissa: values.maximumProviderPrincipal ?? 10_000_000n,
    },
    positions: values.positions,
    opportunities: values.opportunities,
    candidates: values.candidates,
    ...overrides,
  };
}

function assessment(
  result: ReturnType<typeof recommendFeeAwareAllocation>,
  candidateId: string,
): FeeAwareCandidateAssessment {
  const value = result.decisions
    .flatMap(({ assessments }) => assessments)
    .find((candidateAssessment) => candidateAssessment.candidateId === candidateId);
  if (!value) throw new TypeError(`missing assessment ${candidateId}`);
  return value;
}

describe('fee-aware allocation recommendation policy', () => {
  it('uses the production portfolio fixed USD scale for every mantissa', () => {
    expect(FEE_AWARE_ALLOCATION_USD_SCALE).toBe(PORTFOLIO_USD_SCALE);
    expect(FEE_AWARE_ALLOCATION_USD_SCALE).toBe(18);
  });

  it('selects the best net route instead of imposing a fixed provider split or highest gross APY', () => {
    const source = position();
    const expensiveHighApy = opportunity({
      opportunityId: 'high-gross-expensive',
      grossApyBasisPoints: 1_000n,
    });
    const efficientLowerApy = opportunity({
      opportunityId: 'lower-gross-efficient',
      providerId: 'provider-b',
      grossApyBasisPoints: 600n,
    });
    const expensiveCandidate = candidate(source, expensiveHighApy, {
      candidateId: 'candidate-high-gross',
      costs: costs({ providerEntry: 10_000n }),
    });
    const efficientCandidate = candidate(source, efficientLowerApy, {
      candidateId: 'candidate-efficient',
      costs: costs({ entrySourceNetwork: 100n }),
    });

    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [expensiveHighApy, efficientLowerApy],
        candidates: [expensiveCandidate, efficientCandidate],
      }),
    );

    expect(result).toMatchObject({
      status: 'RECOMMENDED',
      totalPrincipalUsdMantissa: 100_000n,
      recommendedPrincipalUsdMantissa: 100_000n,
      mayAuthorizeFinancialAction: false,
      mayAuthorizeTransaction: false,
      mayExecuteTransaction: false,
    });
    expect(result.decisions[0]?.selectedCandidateId).toBe('candidate-efficient');
    expect(assessment(result, 'candidate-efficient').calculation).toMatchObject({
      principalUsdMantissa: 100_000n,
      deployedPrincipalUsdMantissa: 99_900n,
      totalLifecycleCostUsdMantissa: 100n,
      projectedConservativeYieldUsdMantissa: 5_994n,
      netBenefitUsdMantissa: 5_894n,
    });
    expect(assessment(result, 'candidate-high-gross').reasons).toContain(
      'NON_POSITIVE_NET_BENEFIT',
    );
  });

  it('binds every quote to both its source position and opportunity', () => {
    const source = position();
    const otherSource = position({ positionId: 'other-position', walletId: 'other-wallet' });
    const lowerApy = opportunity({ opportunityId: 'lower-apy', grossApyBasisPoints: 500n });
    const higherApy = opportunity({
      opportunityId: 'higher-apy',
      providerId: 'provider-b',
      grossApyBasisPoints: 1_000n,
    });
    const cheapLowerApyRoute = candidate(source, lowerApy, { candidateId: 'legitimate-low' });
    const replayedAgainstHigherApy: FeeAwareAllocationCandidate = {
      ...candidate(source, higherApy, { candidateId: 'replayed-opportunity' }),
      costQuote: cheapLowerApyRoute.costQuote,
    };
    const otherPositionQuote = candidate(otherSource, lowerApy, {
      candidateId: 'other-position-quote',
    });
    const replayedAgainstPosition: FeeAwareAllocationCandidate = {
      ...candidate(source, lowerApy, { candidateId: 'replayed-position' }),
      costQuote: otherPositionQuote.costQuote,
    };

    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [lowerApy, higherApy],
        candidates: [cheapLowerApyRoute, replayedAgainstHigherApy, replayedAgainstPosition],
      }),
    );

    expect(result.decisions[0]?.selectedCandidateId).toBe('legitimate-low');
    expect(assessment(result, 'replayed-opportunity').reasons).toContain(
      'COST_QUOTE_OPPORTUNITY_MISMATCH',
    );
    expect(assessment(result, 'replayed-opportunity').calculation).toBeNull();
    expect(assessment(result, 'replayed-position').reasons).toContain(
      'COST_QUOTE_POSITION_MISMATCH',
    );
    expect(assessment(result, 'replayed-position').calculation).toBeNull();
  });

  it('uses all entry and anticipated-exit costs before recommending an opted-in cross-chain route', () => {
    const source = position();
    const ethereum = opportunity({ opportunityId: 'ethereum-baseline' });
    const solana = opportunity({
      opportunityId: 'solana-higher-yield',
      providerId: 'solana-provider',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 900n,
    });
    const sameChain = candidate(source, ethereum, {
      candidateId: 'same-chain',
      costs: costs({ entrySourceNetwork: 50n, exitSourceNetwork: 50n }),
    });
    const crossChain = candidate(source, solana, {
      candidateId: 'cross-chain',
      costs: costs({
        entrySourceNetwork: 100n,
        entryBridge: 300n,
        entryDestinationNetwork: 10n,
        providerExit: 10n,
        exitDestinationNetwork: 10n,
        exitBridge: 300n,
        exitSourceNetwork: 100n,
        platformRouting: 50n,
        riskBuffer: 20n,
      }),
    });

    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [ethereum, solana],
        candidates: [sameChain, crossChain],
        optIn: activeOptIn(),
        maximumCrossChainCost: 1_000n,
        minimumCrossChainImprovement: 3_000n,
      }),
    );

    expect(result.decisions[0]).toMatchObject({
      selectedCandidateId: 'cross-chain',
      selectedOpportunityId: 'solana-higher-yield',
      selectedProviderId: 'solana-provider',
      selectedQuoteReferenceId: 'quote-position-ethereum-usdc-solana-higher-yield',
      selectedRouteReferenceId: 'route-position-ethereum-usdc-solana-higher-yield',
      selectedOpportunityEvidenceReferenceId: 'evidence-1',
      selectedRiskAssessmentReferenceId: 'risk-assessment-1',
      selectedRouteKind: 'CROSS_CHAIN',
      requiresSeparateTransactionApproval: true,
    });
    expect(assessment(result, 'cross-chain').calculation).toMatchObject({
      entryCostUsdMantissa: 480n,
      anticipatedExitCostUsdMantissa: 420n,
      totalLifecycleCostUsdMantissa: 900n,
      deployedPrincipalUsdMantissa: 99_520n,
      projectedConservativeYieldUsdMantissa: 8_956n,
      netBenefitUsdMantissa: 8_056n,
      improvementOverSameChainUsdMantissa: 3_159n,
    });
    expect(result.crossChainOptInMayAuthorizeTransaction).toBe(false);
  });

  it('treats opt-in as permission to consider crossing, never transaction approval', () => {
    const source = position();
    const ethereum = opportunity({ opportunityId: 'ethereum-baseline' });
    const solana = opportunity({
      opportunityId: 'solana-option',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 1_000n,
    });
    const sameChain = candidate(source, ethereum, { candidateId: 'same' });
    const crossChain = candidate(source, solana, { candidateId: 'cross' });

    const withoutOptIn = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [ethereum, solana],
        candidates: [sameChain, crossChain],
        minimumCrossChainImprovement: 0n,
      }),
    );
    const withOptIn = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [ethereum, solana],
        candidates: [sameChain, crossChain],
        optIn: activeOptIn(),
        minimumCrossChainImprovement: 0n,
      }),
    );

    expect(withoutOptIn.decisions[0]?.selectedCandidateId).toBe('same');
    expect(assessment(withoutOptIn, 'cross').reasons).toContain('CROSS_CHAIN_OPT_IN_REQUIRED');
    expect(withOptIn.decisions[0]?.selectedCandidateId).toBe('cross');
    expect(withOptIn).toMatchObject({
      crossChainOptInMayAuthorizeTransaction: false,
      mayAuthorizeTransaction: false,
      mayExecuteTransaction: false,
    });
  });

  it('requires a current complete same-chain baseline before crossing', () => {
    const source = position();
    const solana = opportunity({
      opportunityId: 'solana-only',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 1_000n,
    });
    const crossChain = candidate(source, solana, { candidateId: 'cross' });

    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [solana],
        candidates: [crossChain],
        optIn: activeOptIn(),
        minimumCrossChainImprovement: 0n,
      }),
    );

    expect(result.status).toBe('NO_ELIGIBLE_ROUTE');
    expect(result.decisions[0]).toMatchObject({
      selectedCandidateId: null,
      selectedOpportunityId: null,
      selectedProviderId: null,
      selectedQuoteReferenceId: null,
      selectedRouteReferenceId: null,
      selectedOpportunityEvidenceReferenceId: null,
      selectedRiskAssessmentReferenceId: null,
      selectedRouteKind: null,
      requiresSeparateTransactionApproval: false,
    });
    expect(assessment(result, 'cross').reasons).toContain('NO_ELIGIBLE_SAME_CHAIN_BASELINE');
  });

  it('distinguishes an omitted cost category from an explicit zero', () => {
    const source = position();
    const target = opportunity();
    const complete = candidate(source, target, { candidateId: 'complete' });
    const missing = candidate(source, target, { candidateId: 'missing' });
    const { exitBridge: omitted, ...incompleteCosts } = missing.costQuote.costsUsdMantissa;
    expect(omitted).toBe(0n);
    const malformedMissing = {
      ...missing,
      costQuote: { ...missing.costQuote, costsUsdMantissa: incompleteCosts },
    };

    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [target],
        candidates: [malformedMissing as unknown as FeeAwareAllocationCandidate, complete],
      }),
    );

    expect(result.decisions[0]?.selectedCandidateId).toBe('complete');
    expect(assessment(result, 'missing')).toMatchObject({
      eligibility: 'REJECTED',
      calculation: null,
      reasons: ['INCOMPLETE_COST_QUOTE'],
    });
  });

  it('expires deadlines exclusively and treats age equal to the freshness bound as stale', () => {
    const source = position();
    const target = opportunity();
    const stale = candidate(source, target, {
      candidateId: 'stale',
      quotedAt: '2026-09-03T11:59:00.000Z',
      validUntil: '2026-09-03T12:01:00.000Z',
    });
    const expired = candidate(source, target, {
      candidateId: 'expired',
      validUntil: EVALUATED_AT,
    });

    const result = recommendFeeAwareAllocation(
      request({ positions: [source], opportunities: [target], candidates: [stale, expired] }),
    );

    expect(result.status).toBe('NO_ELIGIBLE_ROUTE');
    expect(assessment(result, 'stale').reasons).toContain('COST_QUOTE_STALE');
    expect(assessment(result, 'expired').reasons).toContain('COST_QUOTE_EXPIRED');
  });

  it('expires cross-chain consideration consent at the exact expiry instant', () => {
    const source = position();
    const ethereum = opportunity({ opportunityId: 'same-opportunity' });
    const solana = opportunity({
      opportunityId: 'cross-opportunity',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 1_000n,
    });
    const same = candidate(source, ethereum, { candidateId: 'same' });
    const cross = candidate(source, solana, { candidateId: 'cross' });

    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [ethereum, solana],
        candidates: [same, cross],
        optIn: activeOptIn({ expiresAt: EVALUATED_AT }),
        minimumCrossChainImprovement: 0n,
      }),
    );

    expect(result.decisions[0]?.selectedCandidateId).toBe('same');
    expect(assessment(result, 'cross').reasons).toContain('CROSS_CHAIN_OPT_IN_EXPIRED');
  });

  it('keeps the same-chain route when the complete cross-chain lifecycle exceeds the fee cap', () => {
    const source = position();
    const ethereum = opportunity({ opportunityId: 'same-opportunity' });
    const solana = opportunity({
      opportunityId: 'cross-opportunity',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 1_000n,
    });
    const same = candidate(source, ethereum, { candidateId: 'same' });
    const cross = candidate(source, solana, {
      candidateId: 'cross',
      costs: costs({ entryBridge: 500n, exitBridge: 500n }),
    });
    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [ethereum, solana],
        candidates: [same, cross],
        optIn: activeOptIn(),
        maximumCrossChainCost: 999n,
        minimumCrossChainImprovement: 0n,
      }),
    );

    expect(result.decisions[0]?.selectedCandidateId).toBe('same');
    expect(assessment(result, 'cross').calculation?.totalLifecycleCostUsdMantissa).toBe(1_000n);
    expect(assessment(result, 'cross').reasons).toContain('CROSS_CHAIN_COST_LIMIT_EXCEEDED');
  });

  it('requires bridge evidence from an allowlisted provider for every cross-chain route', () => {
    const source = position();
    const ethereum = opportunity({ opportunityId: 'same-opportunity' });
    const solana = opportunity({
      opportunityId: 'cross-opportunity',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 1_000n,
    });
    const same = candidate(source, ethereum, { candidateId: 'same' });
    const unapprovedEntryBridge = candidate(source, solana, {
      candidateId: 'unapproved-entry-bridge',
      entryBridgeProviderId: 'unknown-bridge',
    });
    const unapprovedExitBridge = candidate(source, solana, {
      candidateId: 'unapproved-exit-bridge',
      exitBridgeProviderId: 'unknown-bridge',
    });
    const absentBridge = candidate(source, solana, { candidateId: 'absent-bridge' });
    const absentBridgeQuote: FeeAwareAllocationCandidate = {
      ...absentBridge,
      costQuote: { ...absentBridge.costQuote, bridge: null },
    };
    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [ethereum, solana],
        candidates: [same, unapprovedEntryBridge, unapprovedExitBridge, absentBridgeQuote],
        optIn: activeOptIn(),
        minimumCrossChainImprovement: 0n,
      }),
    );

    expect(result.decisions[0]?.selectedCandidateId).toBe('same');
    expect(assessment(result, 'unapproved-entry-bridge').reasons).toContain(
      'BRIDGE_PROVIDER_NOT_ALLOWED',
    );
    expect(assessment(result, 'unapproved-exit-bridge').reasons).toContain(
      'BRIDGE_PROVIDER_NOT_ALLOWED',
    );
    expect(assessment(result, 'absent-bridge').reasons).toContain('BRIDGE_ESTIMATE_REQUIRED');
  });

  it('rejects cross-chain bridge evidence whose minimum amounts contradict the route quote', () => {
    const source = position();
    const sameOpportunity = opportunity({ opportunityId: 'same-opportunity' });
    const crossOpportunity = opportunity({
      opportunityId: 'cross-opportunity',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 1_000n,
    });
    const validCross = candidate(source, crossOpportunity, { candidateId: 'cross' });
    const bridge = validCross.costQuote.bridge;
    if (bridge === null) throw new Error('missing bridge fixture');

    const contradictoryQuotes = [
      {
        ...validCross.costQuote,
        bridge: { ...bridge, entryMinimumOutputAtomic: 989_000_000n },
      },
      {
        ...validCross.costQuote,
        minimumDestinationAmountAtomic: 1_000_000_001n,
        bridge: { ...bridge, entryMinimumOutputAtomic: 1_000_000_001n },
      },
      {
        ...validCross.costQuote,
        bridge: { ...bridge, exitMinimumOutputAtomic: 990_000_001n },
      },
    ];

    for (const [index, costQuote] of contradictoryQuotes.entries()) {
      const candidateId = `contradictory-${index}`;
      const result = recommendFeeAwareAllocation(
        request({
          positions: [source],
          opportunities: [sameOpportunity, crossOpportunity],
          candidates: [
            candidate(source, sameOpportunity, { candidateId: 'same' }),
            { ...validCross, candidateId, costQuote },
          ],
          optIn: activeOptIn(),
          minimumCrossChainImprovement: 0n,
        }),
      );
      expect(assessment(result, candidateId).reasons).toContain('INVALID_COST_QUOTE');
    }
  });

  it('rejects unavailable opportunity evidence and a missing current risk assessment', () => {
    const source = position();
    const unavailable = opportunity({
      opportunityId: 'unavailable',
      availability: 'UNAVAILABLE',
    });
    const notRiskAssessed = opportunity({
      opportunityId: 'not-risk-assessed',
      riskAssessment: null,
    });

    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [unavailable, notRiskAssessed],
        candidates: [
          candidate(source, unavailable, { candidateId: 'unavailable-route' }),
          candidate(source, notRiskAssessed, { candidateId: 'unassessed-route' }),
        ],
      }),
    );

    expect(assessment(result, 'unavailable-route').reasons).toContain('OPPORTUNITY_UNAVAILABLE');
    expect(assessment(result, 'unassessed-route').reasons).toContain('RISK_ASSESSMENT_REQUIRED');
  });

  it('expires opportunity and risk evidence at their exact validity deadline', () => {
    const source = position();
    const target = opportunity({
      evidence: {
        evidenceReferenceId: 'expiring-evidence',
        adapterId: 'verified-provider-adapter',
        observedAt: '2026-09-03T11:59:30.000Z',
        validUntil: EVALUATED_AT,
      },
      riskAssessment: {
        status: 'APPROVED_FOR_RECOMMENDATION',
        assessmentReferenceId: 'expiring-risk-assessment',
        assessedAt: '2026-09-03T11:59:30.000Z',
        validUntil: EVALUATED_AT,
        penaltyBasisPoints: 0n,
      },
    });
    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [target],
        candidates: [candidate(source, target, { candidateId: 'expired-evidence' })],
      }),
    );

    expect(result.status).toBe('NO_ELIGIBLE_ROUTE');
    expect(assessment(result, 'expired-evidence').reasons).toEqual(
      expect.arrayContaining(['OPPORTUNITY_EVIDENCE_EXPIRED', 'RISK_ASSESSMENT_EXPIRED']),
    );
  });

  it('applies deterministic ties: same-chain, then lower lifecycle cost, then candidate ID', () => {
    const source = position();
    const sameOpportunity = opportunity({ opportunityId: 'same-opportunity' });
    const crossOpportunity = opportunity({
      opportunityId: 'cross-opportunity',
      networkId: SOLANA,
      assetId: 'solana-usdc',
    });
    const same = candidate(source, sameOpportunity, {
      candidateId: 'z-same-chain',
      costs: costs(),
    });
    const cross = candidate(source, crossOpportunity, {
      candidateId: 'a-cross-chain',
      costs: costs(),
    });
    const routeTie = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [sameOpportunity, crossOpportunity],
        candidates: [cross, same],
        optIn: activeOptIn(),
        maximumCrossChainCost: 0n,
        minimumCrossChainImprovement: 0n,
      }),
    );
    expect(routeTie.decisions[0]?.selectedCandidateId).toBe('z-same-chain');

    const lowerCostOpportunity = opportunity({
      opportunityId: 'lower-cost',
      grossApyBasisPoints: 500n,
    });
    const higherCostOpportunity = opportunity({
      opportunityId: 'higher-cost',
      grossApyBasisPoints: 510n,
    });
    const lowerCost = candidate(source, lowerCostOpportunity, {
      candidateId: 'z-lower-cost',
    });
    const higherCost = candidate(source, higherCostOpportunity, {
      candidateId: 'a-higher-cost',
      costs: costs({ providerExit: 100n }),
    });
    const costTie = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [lowerCostOpportunity, higherCostOpportunity],
        candidates: [higherCost, lowerCost],
      }),
    );
    expect(assessment(costTie, 'z-lower-cost').calculation?.netBenefitUsdMantissa).toBe(5_000n);
    expect(assessment(costTie, 'a-higher-cost').calculation?.netBenefitUsdMantissa).toBe(5_000n);
    expect(costTie.decisions[0]?.selectedCandidateId).toBe('z-lower-cost');

    const lexicalFirst = candidate(source, lowerCostOpportunity, { candidateId: 'a-route' });
    const lexicalLast = candidate(source, lowerCostOpportunity, { candidateId: 'z-route' });
    const lexicalTie = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [lowerCostOpportunity],
        candidates: [lexicalLast, lexicalFirst],
      }),
    );
    expect(lexicalTie.decisions[0]?.selectedCandidateId).toBe('a-route');
  });

  it('conserves aggregate opportunity capacity across complete-position recommendations', () => {
    const first = position({ positionId: 'position-a', walletId: 'wallet-a' });
    const second = position({ positionId: 'position-b', walletId: 'wallet-b' });
    const best = opportunity({
      opportunityId: 'capacity-limited-best',
      grossApyBasisPoints: 600n,
      availableCapacityUsdMantissa: 100_000n,
    });
    const fallback = opportunity({
      opportunityId: 'fallback',
      providerId: 'provider-b',
      grossApyBasisPoints: 500n,
      availableCapacityUsdMantissa: 200_000n,
    });
    const result = recommendFeeAwareAllocation(
      request({
        positions: [second, first],
        opportunities: [fallback, best],
        candidates: [
          candidate(second, best, { candidateId: 'b-best' }),
          candidate(first, best, { candidateId: 'a-best' }),
          candidate(second, fallback, { candidateId: 'b-fallback' }),
          candidate(first, fallback, { candidateId: 'a-fallback' }),
        ],
      }),
    );

    expect(result.status).toBe('RECOMMENDED');
    expect(
      result.decisions.map(({ positionId, selectedOpportunityId }) => [
        positionId,
        selectedOpportunityId,
      ]),
    ).toEqual([
      ['position-a', 'capacity-limited-best'],
      ['position-b', 'fallback'],
    ]);
    expect(assessment(result, 'b-best').reasons).toContain('AGGREGATE_CAPACITY_EXCEEDED');
  });

  it('caps aggregate cross-chain principal and falls back to a same-chain route', () => {
    const first = position({ positionId: 'position-a', walletId: 'wallet-a' });
    const second = position({ positionId: 'position-b', walletId: 'wallet-b' });
    const ethereum = opportunity({
      opportunityId: 'ethereum-baseline',
      providerId: 'ethereum-provider',
      availableCapacityUsdMantissa: 1_000_000n,
    });
    const solana = opportunity({
      opportunityId: 'solana-higher-yield',
      providerId: 'solana-provider',
      networkId: SOLANA,
      assetId: 'solana-usdc',
      grossApyBasisPoints: 1_000n,
      availableCapacityUsdMantissa: 1_000_000n,
    });
    const result = recommendFeeAwareAllocation(
      request({
        positions: [second, first],
        opportunities: [solana, ethereum],
        candidates: [
          candidate(second, solana, { candidateId: 'b-cross' }),
          candidate(first, solana, { candidateId: 'a-cross' }),
          candidate(second, ethereum, { candidateId: 'b-same' }),
          candidate(first, ethereum, { candidateId: 'a-same' }),
        ],
        optIn: activeOptIn(),
        minimumCrossChainImprovement: 0n,
        maximumCrossChainPrincipal: 100_000n,
        maximumProviderPrincipal: 1_000_000n,
      }),
    );

    expect(
      result.decisions.map(({ positionId, selectedCandidateId }) => [
        positionId,
        selectedCandidateId,
      ]),
    ).toEqual([
      ['position-a', 'a-cross'],
      ['position-b', 'b-same'],
    ]);
    expect(assessment(result, 'b-cross').reasons).toContain(
      'AGGREGATE_CROSS_CHAIN_PRINCIPAL_EXCEEDED',
    );
  });

  it("caps aggregate provider principal across that provider's opportunities", () => {
    const first = position({ positionId: 'position-a', walletId: 'wallet-a' });
    const second = position({ positionId: 'position-b', walletId: 'wallet-b' });
    const best = opportunity({
      opportunityId: 'provider-a-best',
      providerId: 'provider-a',
      grossApyBasisPoints: 600n,
      availableCapacityUsdMantissa: 1_000_000n,
    });
    const fallback = opportunity({
      opportunityId: 'provider-b-fallback',
      providerId: 'provider-b',
      grossApyBasisPoints: 500n,
      availableCapacityUsdMantissa: 1_000_000n,
    });
    const result = recommendFeeAwareAllocation(
      request({
        positions: [second, first],
        opportunities: [fallback, best],
        candidates: [
          candidate(second, best, { candidateId: 'b-provider-a' }),
          candidate(first, best, { candidateId: 'a-provider-a' }),
          candidate(second, fallback, { candidateId: 'b-provider-b' }),
          candidate(first, fallback, { candidateId: 'a-provider-b' }),
        ],
        maximumProviderPrincipal: 100_000n,
      }),
    );

    expect(
      result.decisions.map(({ positionId, selectedOpportunityId }) => [
        positionId,
        selectedOpportunityId,
      ]),
    ).toEqual([
      ['position-a', 'provider-a-best'],
      ['position-b', 'provider-b-fallback'],
    ]);
    expect(assessment(result, 'b-provider-a').reasons).toContain(
      'AGGREGATE_PROVIDER_PRINCIPAL_EXCEEDED',
    );
  });

  it('keeps exact bigint precision above JavaScript safe-integer range', () => {
    const exactPrincipal = 9_007_199_254_740_993n;
    const source = position({
      amountAtomic: exactPrincipal * 10_000n,
      amountUsdMantissa: exactPrincipal,
    });
    const target = opportunity({ availableCapacityUsdMantissa: exactPrincipal });
    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [target],
        candidates: [candidate(source, target, { candidateId: 'exact' })],
      }),
    );

    expect(result.totalPrincipalUsdMantissa).toBe(exactPrincipal);
    expect(assessment(result, 'exact').calculation?.projectedConservativeYieldUsdMantissa).toBe(
      (exactPrincipal * 500n) / 10_000n,
    );
  });
});

describe('fee-aware allocation trust boundaries', () => {
  it('rejects a request whose USD mantissas claim a different scale', () => {
    const source = position();
    const target = opportunity();
    const malformed = {
      ...request({
        positions: [source],
        opportunities: [target],
        candidates: [candidate(source, target)],
      }),
      usdScale: 2,
    };

    expect(recommendFeeAwareAllocation(malformed)).toMatchObject({
      status: 'INVALID_INPUT',
      usdScale: PORTFOLIO_USD_SCALE,
    });
  });

  it.each(['eip155:8453', 'eip155:56', 'eip155:11155111', 'solana:devnet'])(
    'rejects unsupported or non-mainnet network %s',
    (networkId) => {
      const unsupported = position({
        networkId: networkId as FeeAwareCapitalPosition['networkId'],
      });
      const target = opportunity();
      const result = recommendFeeAwareAllocation(
        request({
          positions: [unsupported],
          opportunities: [target],
          candidates: [candidate(unsupported, target)],
        }),
      );
      expect(result).toMatchObject({
        status: 'INVALID_INPUT',
        decisions: [],
        mayAuthorizeTransaction: false,
        mayExecuteTransaction: false,
      });
    },
  );

  it('rejects extra fields, sparse arrays, custom prototypes, and accessors without invoking them', () => {
    const source = position();
    const target = opportunity();
    const valid = request({
      positions: [source],
      opportunities: [target],
      candidates: [candidate(source, target)],
    });
    const withExtraPosition = {
      ...valid,
      positions: [{ ...source, unexpected: true }],
    };
    const sparse = { ...valid, positions: new Array(1) };
    const customPrototype = Object.assign(Object.create({ inherited: true }), valid);
    let accessorInvoked = false;
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, 'candidates', {
      enumerable: true,
      get: () => {
        accessorInvoked = true;
        return valid.candidates;
      },
    });

    for (const malformed of [withExtraPosition, sparse, customPrototype, accessor]) {
      expect(recommendFeeAwareAllocation(malformed).status).toBe('INVALID_INPUT');
    }
    expect(accessorInvoked).toBe(false);
  });

  it('rejects an extra cost field instead of silently ignoring it', () => {
    const source = position();
    const target = opportunity();
    const route = candidate(source, target, { candidateId: 'extra-cost' });
    const malformed = {
      ...route,
      costQuote: {
        ...route.costQuote,
        costsUsdMantissa: { ...route.costQuote.costsUsdMantissa, hiddenSubsidy: 1n },
      },
    };
    const result = recommendFeeAwareAllocation(
      request({
        positions: [source],
        opportunities: [target],
        candidates: [malformed as unknown as FeeAwareAllocationCandidate],
      }),
    );

    expect(result.status).toBe('NO_ELIGIBLE_ROUTE');
    expect(assessment(result, 'extra-cost').reasons).toContain('INCOMPLETE_COST_QUOTE');
  });

  it('rejects cost accessors without evaluating them', () => {
    const source = position();
    const target = opportunity();
    const route = candidate(source, target, { candidateId: 'cost-accessor' });
    const maliciousCosts = { ...route.costQuote.costsUsdMantissa } as Record<string, unknown>;
    let accessorInvoked = false;
    Object.defineProperty(maliciousCosts, 'entryBridge', {
      enumerable: true,
      get: () => {
        accessorInvoked = true;
        return 0n;
      },
    });
    const malformed: FeeAwareAllocationCandidate = {
      ...route,
      costQuote: {
        ...route.costQuote,
        costsUsdMantissa: maliciousCosts as unknown as FeeAwareAllocationCostsUsdMantissa,
      },
    };

    const result = recommendFeeAwareAllocation(
      request({ positions: [source], opportunities: [target], candidates: [malformed] }),
    );

    expect(result.status).toBe('NO_ELIGIBLE_ROUTE');
    expect(assessment(result, 'cost-accessor').reasons).toContain('INVALID_COST_QUOTE');
    expect(accessorInvoked).toBe(false);
  });
});
