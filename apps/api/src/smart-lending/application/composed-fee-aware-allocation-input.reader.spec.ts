import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  FEE_AWARE_ALLOCATION_USD_SCALE,
  recommendFeeAwareAllocation,
  type FeeAwareAllocationCostsUsdMantissa,
  type FeeAwareRouteCostQuote,
} from '../domain/fee-aware-allocation';
import {
  COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS,
  ComposedFeeAwareAllocationInputReader,
  FeeAwareAllocationInputUnavailableError,
  MAX_COMPOSED_FEE_AWARE_CANDIDATES,
} from './composed-fee-aware-allocation-input.reader';
import type {
  ApprovedLendingOpportunity,
  ApprovedLendingOpportunitySnapshot,
  ApprovedLendingOpportunitySnapshotReader,
} from './ports/approved-lending-opportunity-snapshot-reader.port';
import type {
  ApprovedSmartLendingPolicyReader,
  ApprovedSmartLendingPolicySnapshot,
} from './ports/approved-smart-lending-policy-reader.port';
import type {
  FullLifecycleCostQuoteReader,
  FullLifecycleCostQuoteResult,
  ReadFullLifecycleCostQuoteRequest,
} from './ports/full-lifecycle-cost-quote-reader.port';
import { SMART_LENDING_PROVIDER_IDS } from './ports/live-lending-market-feed.port';
import type {
  RoutableCapitalPositionSnapshot,
  RoutableCapitalPositionSnapshotReader,
} from './ports/routable-capital-position-snapshot-reader.port';
import {
  UnavailableApprovedLendingOpportunitySnapshotReader,
  UnavailableApprovedSmartLendingPolicyReader,
  UnavailableFullLifecycleCostQuoteReader,
  UnavailableRoutableCapitalPositionSnapshotReader,
} from '../infrastructure/unavailable-fee-aware-allocation-input-readers';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CORRELATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVALUATED_AT = '2026-09-03T12:00:00.000Z';
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ETHEREUM_WALLET = '0xde709f2102306220921060314715629080e2fb77';
const SOLANA_WALLET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ETHEREUM_WALLET_ID = '11111111-1111-4111-8111-111111111111';
const SOLANA_WALLET_ID = '22222222-2222-4222-8222-222222222222';
const AMOUNT_ATOMIC = 100_000_000n;
const USD = 10n ** 18n;

type MutableRecord = Record<string, unknown>;

interface Harness {
  readonly reader: ComposedFeeAwareAllocationInputReader;
  readonly capital: jest.Mocked<RoutableCapitalPositionSnapshotReader>;
  readonly opportunities: jest.Mocked<ApprovedLendingOpportunitySnapshotReader>;
  readonly policy: jest.Mocked<ApprovedSmartLendingPolicyReader>;
  readonly quotes: jest.Mocked<FullLifecycleCostQuoteReader>;
}

function request(): {
  readonly accountId: typeof ACCOUNT_ID;
  readonly correlationId: string;
  readonly evaluatedAt: string;
} {
  return { accountId: ACCOUNT_ID, correlationId: CORRELATION_ID, evaluatedAt: EVALUATED_AT };
}

function positionSnapshot(
  overrides: Partial<RoutableCapitalPositionSnapshot> = {},
): RoutableCapitalPositionSnapshot {
  return {
    schemaVersion: 1,
    use: 'SMART_LENDING_ROUTABLE_CAPITAL',
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    evaluatedAt: EVALUATED_AT,
    snapshotReferenceId: 'capital-snapshot-1',
    capturedAt: '2026-09-03T11:59:45.000Z',
    validUntil: '2026-09-03T12:01:00.000Z',
    coverage: 'COMPLETE',
    valuationPolicyApprovalReferenceId: 'valuation-approval-1',
    positions: [
      {
        positionId: 'position-ethereum-usdc',
        walletId: ETHEREUM_WALLET_ID,
        networkId: ETHEREUM,
        assetId: ETHEREUM_USDC,
        assetSymbol: 'USDC',
        assetDecimals: 6,
        walletAddress: ETHEREUM_WALLET,
        amountAtomic: AMOUNT_ATOMIC,
        amountUsdMantissa: 100n * USD,
      },
    ],
    destinationWallets: [
      {
        walletId: SOLANA_WALLET_ID,
        networkId: SOLANA,
        walletAddress: SOLANA_WALLET,
        selectionReferenceId: 'destination-selection-solana-1',
      },
    ],
    ...overrides,
  };
}

function opportunity(
  values: Readonly<{
    opportunityId: string;
    providerId: 'aave' | 'kamino';
    networkId: typeof ETHEREUM | typeof SOLANA;
    assetId: string;
  }>,
  overrides: Partial<ApprovedLendingOpportunity> = {},
): ApprovedLendingOpportunity {
  return {
    opportunityId: values.opportunityId,
    providerId: values.providerId,
    protocolId: `${values.providerId}-protocol`,
    marketId: `${values.providerId}-usdc-market`,
    networkId: values.networkId,
    assetId: values.assetId,
    assetSymbol: 'USDC',
    assetDecimals: 6,
    availability: 'AVAILABLE',
    recommendationEligibility: 'ELIGIBLE',
    grossApyBasisPoints: values.providerId === 'aave' ? 450n : 700n,
    recurringFeeBasisPoints: 10n,
    availableCapacityUsdMantissa: 10_000n * USD,
    evidence: {
      evidenceReferenceId: `${values.providerId}-evidence-1`,
      adapterId: `${values.providerId}-native-adapter-v1`,
      observedAt: '2026-09-03T11:59:30.000Z',
      validUntil: '2026-09-03T12:02:00.000Z',
    },
    riskAssessment: {
      status: 'APPROVED_FOR_RECOMMENDATION',
      assessmentReferenceId: `${values.providerId}-risk-1`,
      assessedAt: '2026-09-03T11:59:00.000Z',
      validUntil: '2026-09-03T12:05:00.000Z',
      penaltyBasisPoints: 25n,
    },
    ...overrides,
  };
}

function ethereumOpportunity(
  overrides: Partial<ApprovedLendingOpportunity> = {},
): ApprovedLendingOpportunity {
  return opportunity(
    {
      opportunityId: 'opportunity-aave-ethereum-usdc',
      providerId: 'aave',
      networkId: ETHEREUM,
      assetId: ETHEREUM_USDC,
    },
    overrides,
  );
}

function solanaOpportunity(
  overrides: Partial<ApprovedLendingOpportunity> = {},
): ApprovedLendingOpportunity {
  return opportunity(
    {
      opportunityId: 'opportunity-kamino-solana-usdc',
      providerId: 'kamino',
      networkId: SOLANA,
      assetId: SOLANA_USDC,
    },
    overrides,
  );
}

function opportunitySnapshot(
  overrides: Partial<ApprovedLendingOpportunitySnapshot> = {},
): ApprovedLendingOpportunitySnapshot {
  return {
    schemaVersion: 1,
    use: 'APPROVED_SMART_LENDING_OPPORTUNITIES',
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    evaluatedAt: EVALUATED_AT,
    snapshotReferenceId: 'opportunity-snapshot-1',
    capturedAt: '2026-09-03T11:59:45.000Z',
    validUntil: '2026-09-03T12:01:00.000Z',
    coverage: 'COMPLETE',
    providerCoverage: [...SMART_LENDING_PROVIDER_IDS],
    providerPolicyApprovalReferenceId: 'provider-policy-approval-1',
    riskPolicyApprovalReferenceId: 'risk-policy-approval-1',
    opportunities: [ethereumOpportunity(), solanaOpportunity()],
    ...overrides,
  };
}

function policySnapshot(
  overrides: Partial<ApprovedSmartLendingPolicySnapshot> = {},
): ApprovedSmartLendingPolicySnapshot {
  return {
    schemaVersion: 1,
    use: 'APPROVED_SMART_LENDING_RECOMMENDATION_POLICY',
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    evaluatedAt: EVALUATED_AT,
    policyReferenceId: 'smart-lending-policy-1',
    approvalReferenceId: 'smart-lending-policy-approval-1',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    effectiveUntil: '2026-10-01T00:00:00.000Z',
    holdingPeriodDays: 365n,
    maximumQuoteAgeSeconds: 60n,
    maximumOpportunityAgeSeconds: 300n,
    minimumNetBenefitUsdMantissa: 1n,
    crossChainPolicy: {
      optIn: {
        scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS',
        consentReferenceId: 'cross-chain-consideration-consent-1',
        grantedAt: '2026-09-03T11:00:00.000Z',
        expiresAt: '2026-09-03T13:00:00.000Z',
      },
      allowedBridgeProviderIds: ['relaydepository', 'polymerStandard'],
      maximumLifecycleCostUsdMantissa: 5n * USD,
      minimumNetImprovementUsdMantissa: 1n * USD,
    },
    exposurePolicy: {
      maximumCrossChainPrincipalUsdMantissa: 1_000n * USD,
      maximumProviderPrincipalUsdMantissa: 1_000n * USD,
    },
    maximumCandidateCount: 8,
    crossChainConsiderationConsent: {
      scope: 'CONSIDER_CROSS_CHAIN_RECOMMENDATIONS',
      accountId: ACCOUNT_ID,
      approvalReferenceId: 'smart-lending-policy-approval-1',
      consentReferenceId: 'cross-chain-consideration-consent-1',
      grantedAt: '2026-09-03T11:00:00.000Z',
      expiresAt: '2026-09-03T13:00:00.000Z',
      approvedWalletIds: [ETHEREUM_WALLET_ID, SOLANA_WALLET_ID],
      approvedDirectedNetworkPairs: [{ sourceNetworkId: ETHEREUM, destinationNetworkId: SOLANA }],
    },
    crossChainQuoteDisclosureConsent: {
      scope: 'DISCLOSE_WALLET_ADDRESSES_FOR_CROSS_CHAIN_QUOTE',
      providerId: 'lifi',
      accountId: ACCOUNT_ID,
      approvalReferenceId: 'smart-lending-policy-approval-1',
      consentReferenceId: 'lifi-disclosure-consent-1',
      grantedAt: '2026-09-03T11:00:00.000Z',
      expiresAt: '2026-09-03T13:00:00.000Z',
      approvedWalletIds: [ETHEREUM_WALLET_ID, SOLANA_WALLET_ID],
      approvedDirectedNetworkPairs: [{ sourceNetworkId: ETHEREUM, destinationNetworkId: SOLANA }],
    },
    ...overrides,
  };
}

function zeroCosts(): FeeAwareAllocationCostsUsdMantissa {
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
  };
}

function quoteResult(
  quoteRequest: ReadFullLifecycleCostQuoteRequest,
  overrides: Partial<FullLifecycleCostQuoteResult> = {},
): FullLifecycleCostQuoteResult {
  const crossChain = quoteRequest.position.networkId !== quoteRequest.opportunity.networkId;
  const minimum = crossChain ? quoteRequest.position.amountAtomic - 1_000_000n : AMOUNT_ATOMIC;
  const costs: FeeAwareAllocationCostsUsdMantissa = crossChain
    ? {
        ...zeroCosts(),
        entryBridge: 200_000_000_000_000_000n,
        exitBridge: 200_000_000_000_000_000n,
      }
    : zeroCosts();
  const quote: FeeAwareRouteCostQuote = {
    quoteReferenceId: `quote-${quoteRequest.opportunity.opportunityId}`,
    routeReferenceId: `route-${quoteRequest.opportunity.opportunityId}`,
    positionId: quoteRequest.position.positionId,
    opportunityId: quoteRequest.opportunity.opportunityId,
    verifiedByAdapterId: crossChain ? 'cross-chain-lifecycle-adapter-v1' : 'same-chain-adapter-v1',
    quotedAt: '2026-09-03T11:59:50.000Z',
    validUntil: '2026-09-03T12:01:00.000Z',
    sourceNetworkId: quoteRequest.position.networkId,
    destinationNetworkId: quoteRequest.opportunity.networkId,
    sourceAssetId: quoteRequest.position.assetId,
    destinationAssetId: quoteRequest.opportunity.assetId,
    sourceAmountAtomic: quoteRequest.position.amountAtomic,
    minimumDestinationAmountAtomic: minimum,
    costsUsdMantissa: costs,
    bridge: crossChain
      ? {
          entryBridgeProviderId: 'polymerStandard',
          exitBridgeProviderId: 'relaydepository',
          entryEstimateReferenceId: 'entry-bridge-estimate-1',
          exitEstimateReferenceId: 'exit-bridge-estimate-1',
          entryMinimumOutputAtomic: minimum,
          exitMinimumOutputAtomic: minimum - 1_000_000n,
        }
      : null,
  };
  return {
    schemaVersion: 1,
    use: 'FULL_LIFECYCLE_COST_QUOTE',
    accountId: quoteRequest.accountId,
    correlationId: quoteRequest.correlationId,
    evaluatedAt: quoteRequest.evaluatedAt,
    policyReferenceId: quoteRequest.policyReferenceId,
    requestFingerprintSha256: quoteRequest.requestFingerprintSha256,
    quote,
    ...overrides,
  };
}

function harness(
  values: {
    readonly capitalValue?: unknown;
    readonly opportunityValue?: unknown;
    readonly policyValue?: unknown;
    readonly quoteImplementation?: (
      request: ReadFullLifecycleCostQuoteRequest,
    ) => Promise<FullLifecycleCostQuoteResult>;
  } = {},
): Harness {
  const capital = {
    readRoutableCapitalPositions: jest
      .fn()
      .mockResolvedValue(values.capitalValue ?? positionSnapshot()),
  } as jest.Mocked<RoutableCapitalPositionSnapshotReader>;
  const opportunities = {
    readApprovedLendingOpportunities: jest
      .fn()
      .mockResolvedValue(values.opportunityValue ?? opportunitySnapshot()),
  } as jest.Mocked<ApprovedLendingOpportunitySnapshotReader>;
  const policy = {
    readApprovedSmartLendingPolicy: jest
      .fn()
      .mockResolvedValue(values.policyValue ?? policySnapshot()),
  } as jest.Mocked<ApprovedSmartLendingPolicyReader>;
  const quotes = {
    readFullLifecycleCostQuote: jest.fn(
      values.quoteImplementation ?? (async (input) => quoteResult(input)),
    ),
  } as jest.Mocked<FullLifecycleCostQuoteReader>;
  return {
    reader: new ComposedFeeAwareAllocationInputReader(capital, opportunities, policy, quotes),
    capital,
    opportunities,
    policy,
    quotes,
  };
}

async function expectUnavailable(reader: ComposedFeeAwareAllocationInputReader): Promise<void> {
  await expect(reader.read(request())).rejects.toEqual(
    new FeeAwareAllocationInputUnavailableError(),
  );
}

describe('ComposedFeeAwareAllocationInputReader', () => {
  it('composes deterministic same-chain-first and consented cross-chain candidates', async () => {
    const signalStatesDuringQuote: boolean[] = [];
    const fixture = harness({
      quoteImplementation: async (input) => {
        signalStatesDuringQuote.push(input.signal.aborted);
        return quoteResult(input);
      },
    });

    const result = await fixture.reader.read(request());

    const upstreamRequests = [fixture.capital, fixture.opportunities, fixture.policy].map(
      (upstream) => (Object.values(upstream)[0] as jest.Mock).mock.calls[0]?.[0] as unknown,
    );
    for (const upstreamRequest of upstreamRequests) {
      expect(upstreamRequest).toMatchObject({
        ...request(),
        deadlineAt: '2026-09-03T12:00:30.000Z',
      });
      expect((upstreamRequest as { signal: unknown }).signal).toBeInstanceOf(AbortSignal);
      expect(Object.isFrozen(upstreamRequest)).toBe(true);
    }
    expect(upstreamRequests[1]).toBe(upstreamRequests[0]);
    expect(upstreamRequests[2]).toBe(upstreamRequests[0]);
    const sharedSignal = (upstreamRequests[0] as { signal: AbortSignal }).signal;
    expect(fixture.quotes.readFullLifecycleCostQuote).toHaveBeenCalledTimes(2);
    const quoteRequests = fixture.quotes.readFullLifecycleCostQuote.mock.calls.map(
      ([value]) => value,
    );
    expect(quoteRequests.map(({ opportunity }) => opportunity.opportunityId)).toEqual([
      'opportunity-aave-ethereum-usdc',
      'opportunity-kamino-solana-usdc',
    ]);
    expect(quoteRequests[0]?.destinationWallet).toEqual({
      walletId: ETHEREUM_WALLET_ID,
      networkId: ETHEREUM,
      walletAddress: ETHEREUM_WALLET,
      selectionReferenceId: null,
    });
    expect(quoteRequests[1]?.destinationWallet).toEqual({
      walletId: SOLANA_WALLET_ID,
      networkId: SOLANA,
      walletAddress: SOLANA_WALLET,
      selectionReferenceId: 'destination-selection-solana-1',
    });
    expect(quoteRequests[0]).toMatchObject({
      accountId: ACCOUNT_ID,
      deadlineAt: '2026-09-03T12:00:30.000Z',
      policyReferenceId: 'smart-lending-policy-1',
      policyApprovalReferenceId: 'smart-lending-policy-approval-1',
      crossChainConsiderationConsentReferenceId: null,
      crossChainQuoteDisclosureConsentReferenceId: null,
    });
    expect(quoteRequests[1]).toMatchObject({
      accountId: ACCOUNT_ID,
      crossChainConsiderationConsentReferenceId: 'cross-chain-consideration-consent-1',
      crossChainQuoteDisclosureConsentReferenceId: 'lifi-disclosure-consent-1',
    });
    expect(
      quoteRequests.every(({ requestFingerprintSha256 }) =>
        /^[0-9a-f]{64}$/u.test(requestFingerprintSha256),
      ),
    ).toBe(true);
    expect(quoteRequests.every(({ signal }) => signal instanceof AbortSignal)).toBe(true);
    expect(signalStatesDuringQuote).toEqual([false, false]);
    expect(quoteRequests.every(({ signal }) => signal.aborted)).toBe(true);
    expect(quoteRequests.every(({ signal }) => signal === sharedSignal)).toBe(true);
    expect(sharedSignal.aborted).toBe(true);
    expect(quoteRequests.every(Object.isFrozen)).toBe(true);
    expect(
      quoteRequests.every(
        ({ allowedBridgeProviderIds }) =>
          allowedBridgeProviderIds.join(',') === 'polymerStandard,relaydepository',
      ),
    ).toBe(true);

    expect(result.positions).toEqual([
      {
        positionId: 'position-ethereum-usdc',
        walletId: ETHEREUM_WALLET_ID,
        networkId: ETHEREUM,
        assetId: ETHEREUM_USDC,
        amountAtomic: AMOUNT_ATOMIC,
        amountUsdMantissa: 100n * USD,
      },
    ]);
    expect(result.positions[0]).not.toHaveProperty('walletAddress');
    expect(result).not.toHaveProperty('crossChainConsiderationConsent');
    expect(result).not.toHaveProperty('crossChainQuoteDisclosureConsent');
    expect(result.crossChainPolicy.optIn).not.toHaveProperty('accountId');
    expect(result.crossChainPolicy.optIn).not.toHaveProperty('approvedWalletIds');
    expect(result.opportunities).toHaveLength(2);
    expect(result.opportunities[0]).not.toHaveProperty('protocolId');
    expect(result.opportunities[0]).not.toHaveProperty('assetSymbol');
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.every(({ candidateId }) => /^candidate:[0-9a-f]{64}$/u.test(candidateId)),
    ).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.positions)).toBe(true);
    expect(Object.isFrozen(result.candidates[0]?.costQuote.costsUsdMantissa)).toBe(true);
    expect(result.candidates[0]?.costQuote).not.toHaveProperty('requestFingerprintSha256');

    expect(
      recommendFeeAwareAllocation({
        usdScale: FEE_AWARE_ALLOCATION_USD_SCALE,
        evaluatedAt: EVALUATED_AT,
        ...result,
      }).status,
    ).not.toBe('INVALID_INPUT');
  });

  it.each([
    {
      name: 'consideration opt-in is absent',
      policy: policySnapshot({
        crossChainPolicy: { ...policySnapshot().crossChainPolicy, optIn: null },
        crossChainConsiderationConsent: null,
      }),
    },
    {
      name: 'third-party disclosure consent is absent',
      policy: policySnapshot({ crossChainQuoteDisclosureConsent: null }),
    },
    {
      name: 'third-party disclosure consent is expired',
      policy: policySnapshot({
        crossChainQuoteDisclosureConsent: {
          ...policySnapshot().crossChainQuoteDisclosureConsent!,
          expiresAt: EVALUATED_AT,
        },
      }),
    },
    {
      name: 'third-party disclosure consent expires before the aggregate deadline',
      policy: policySnapshot({
        crossChainQuoteDisclosureConsent: {
          ...policySnapshot().crossChainQuoteDisclosureConsent!,
          expiresAt: '2026-09-03T12:00:20.000Z',
        },
      }),
    },
    {
      name: 'consideration consent expires before the aggregate deadline',
      policy: policySnapshot({
        crossChainPolicy: {
          ...policySnapshot().crossChainPolicy,
          optIn: {
            ...policySnapshot().crossChainPolicy.optIn!,
            expiresAt: '2026-09-03T12:00:20.000Z',
          },
        },
        crossChainConsiderationConsent: {
          ...policySnapshot().crossChainConsiderationConsent!,
          expiresAt: '2026-09-03T12:00:20.000Z',
        },
      }),
    },
  ])('does not disclose cross-chain wallets when $name', async ({ policy }) => {
    const fixture = harness({ policyValue: policy });

    const result = await fixture.reader.read(request());

    expect(result.candidates).toHaveLength(1);
    expect(fixture.quotes.readFullLifecycleCostQuote).toHaveBeenCalledTimes(1);
    expect(fixture.quotes.readFullLifecycleCostQuote.mock.calls[0]?.[0].opportunity.networkId).toBe(
      ETHEREUM,
    );
  });

  it.each([
    {
      name: 'consideration wallet scope omits the destination wallet',
      policy: policySnapshot({
        crossChainConsiderationConsent: {
          ...policySnapshot().crossChainConsiderationConsent!,
          approvedWalletIds: [ETHEREUM_WALLET_ID],
        },
      }),
    },
    {
      name: 'consideration scope approves only the reverse directed pair',
      policy: policySnapshot({
        crossChainConsiderationConsent: {
          ...policySnapshot().crossChainConsiderationConsent!,
          approvedDirectedNetworkPairs: [
            { sourceNetworkId: SOLANA, destinationNetworkId: ETHEREUM },
          ],
        },
      }),
    },
    {
      name: 'disclosure wallet scope omits the source wallet',
      policy: policySnapshot({
        crossChainQuoteDisclosureConsent: {
          ...policySnapshot().crossChainQuoteDisclosureConsent!,
          approvedWalletIds: [SOLANA_WALLET_ID],
        },
      }),
    },
    {
      name: 'disclosure scope approves only the reverse directed pair',
      policy: policySnapshot({
        crossChainQuoteDisclosureConsent: {
          ...policySnapshot().crossChainQuoteDisclosureConsent!,
          approvedDirectedNetworkPairs: [
            { sourceNetworkId: SOLANA, destinationNetworkId: ETHEREUM },
          ],
        },
      }),
    },
  ])('keeps cross-chain quote egress inside both consent scopes: $name', async ({ policy }) => {
    const fixture = harness({ policyValue: policy });

    const result = await fixture.reader.read(request());

    expect(result.candidates).toHaveLength(1);
    expect(fixture.quotes.readFullLifecycleCostQuote).toHaveBeenCalledTimes(1);
    expect(fixture.quotes.readFullLifecycleCostQuote.mock.calls[0]?.[0].opportunity.networkId).toBe(
      ETHEREUM,
    );
  });

  it.each([
    {
      name: 'consideration account',
      policy: policySnapshot({
        crossChainConsiderationConsent: {
          ...policySnapshot().crossChainConsiderationConsent!,
          accountId: parseAccountId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        },
      }),
    },
    {
      name: 'disclosure approval',
      policy: policySnapshot({
        crossChainQuoteDisclosureConsent: {
          ...policySnapshot().crossChainQuoteDisclosureConsent!,
          approvalReferenceId: 'different-policy-approval',
        },
      }),
    },
  ])('rejects a consent with a mismatched intrinsic $name binding', async ({ policy }) => {
    const fixture = harness({ policyValue: policy });

    await expectUnavailable(fixture.reader);
    expect(fixture.quotes.readFullLifecycleCostQuote).not.toHaveBeenCalled();
  });

  it('does not quote a cross-chain route without a potentially eligible same-chain baseline', async () => {
    const fixture = harness({
      opportunityValue: opportunitySnapshot({ opportunities: [solanaOpportunity()] }),
    });

    const result = await fixture.reader.read(request());

    expect(result.candidates).toEqual([]);
    expect(fixture.quotes.readFullLifecycleCostQuote).not.toHaveBeenCalled();
  });

  it('omits cross-chain candidates when no approved destination wallet exists', async () => {
    const fixture = harness({
      capitalValue: positionSnapshot({ destinationWallets: [] }),
    });

    const result = await fixture.reader.read(request());

    expect(result.candidates).toHaveLength(1);
    expect(fixture.quotes.readFullLifecycleCostQuote).toHaveBeenCalledTimes(1);
  });

  it('rejects fan-out above the approved bound before any quote egress', async () => {
    const fixture = harness({
      policyValue: policySnapshot({ maximumCandidateCount: 1 }),
    });

    await expectUnavailable(fixture.reader);
    expect(fixture.quotes.readFullLifecycleCostQuote).not.toHaveBeenCalled();
    expect(MAX_COMPOSED_FEE_AWARE_CANDIDATES).toBe(128);
  });

  it('uses ordinal ordering and produces identical candidates and quote bindings for permutations', async () => {
    const upper = ethereumOpportunity({ opportunityId: 'opportunity-Z-ethereum-usdc' });
    const lower = ethereumOpportunity({ opportunityId: 'opportunity-a-ethereum-usdc' });
    const cross = solanaOpportunity();
    const first = harness({
      opportunityValue: opportunitySnapshot({ opportunities: [lower, cross, upper] }),
      policyValue: policySnapshot({
        crossChainPolicy: {
          ...policySnapshot().crossChainPolicy,
          allowedBridgeProviderIds: ['relaydepository', 'polymerStandard'],
        },
      }),
    });
    const second = harness({
      opportunityValue: opportunitySnapshot({ opportunities: [upper, cross, lower] }),
      policyValue: policySnapshot({
        crossChainPolicy: {
          ...policySnapshot().crossChainPolicy,
          allowedBridgeProviderIds: ['polymerStandard', 'relaydepository'],
        },
      }),
    });

    const [firstResult, secondResult] = await Promise.all([
      first.reader.read(request()),
      second.reader.read(request()),
    ]);
    const firstRequests = first.quotes.readFullLifecycleCostQuote.mock.calls.map(
      ([value]) => value,
    );
    const secondRequests = second.quotes.readFullLifecycleCostQuote.mock.calls.map(
      ([value]) => value,
    );

    expect(firstRequests.map(({ opportunity }) => opportunity.opportunityId)).toEqual([
      'opportunity-Z-ethereum-usdc',
      'opportunity-a-ethereum-usdc',
      'opportunity-kamino-solana-usdc',
    ]);
    expect(secondRequests.map(({ opportunity }) => opportunity.opportunityId)).toEqual(
      firstRequests.map(({ opportunity }) => opportunity.opportunityId),
    );
    expect(secondRequests.map(({ requestFingerprintSha256 }) => requestFingerprintSha256)).toEqual(
      firstRequests.map(({ requestFingerprintSha256 }) => requestFingerprintSha256),
    );
    expect(secondResult.candidates).toEqual(firstResult.candidates);
  });

  it.each([
    {
      name: 'capital account binding',
      values: {
        capitalValue: positionSnapshot({
          accountId: parseAccountId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        }),
      },
    },
    {
      name: 'opportunity correlation binding',
      values: {
        opportunityValue: opportunitySnapshot({
          correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        }),
      },
    },
    {
      name: 'policy evaluated-at binding',
      values: { policyValue: policySnapshot({ evaluatedAt: '2026-09-03T11:59:59.000Z' }) },
    },
    {
      name: 'expired capital snapshot',
      values: { capitalValue: positionSnapshot({ validUntil: EVALUATED_AT }) },
    },
    {
      name: 'capital snapshot that expires before the aggregate quote deadline',
      values: {
        capitalValue: positionSnapshot({ validUntil: '2026-09-03T12:00:20.000Z' }),
      },
    },
    {
      name: 'policy that expires before the aggregate quote deadline',
      values: {
        policyValue: policySnapshot({ effectiveUntil: '2026-09-03T12:00:20.000Z' }),
      },
    },
    {
      name: 'incomplete opportunity coverage',
      values: {
        opportunityValue: opportunitySnapshot({
          providerCoverage: SMART_LENDING_PROVIDER_IDS.slice(1) as never,
        }),
      },
    },
    {
      name: 'unapproved capital coverage',
      values: { capitalValue: { ...positionSnapshot(), coverage: 'PARTIAL' } },
    },
  ])('fails closed for an invalid $name', async ({ values }) => {
    const fixture = harness(values);

    await expectUnavailable(fixture.reader);
    expect(fixture.quotes.readFullLifecycleCostQuote).not.toHaveBeenCalled();
  });

  it('rejects accessor, sparse, and extra-key snapshots without invoking accessors', async () => {
    const accessor = { ...positionSnapshot() } as MutableRecord;
    let getterCalls = 0;
    Object.defineProperty(accessor, 'positions', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('malicious position accessor');
      },
    });
    const accessorFixture = harness({ capitalValue: accessor });
    await expectUnavailable(accessorFixture.reader);
    expect(getterCalls).toBe(0);

    const sparse = { ...positionSnapshot() } as MutableRecord;
    sparse.positions = new Array<unknown>(1);
    await expectUnavailable(harness({ capitalValue: sparse }).reader);

    const extra = { ...opportunitySnapshot(), unexpected: true };
    await expectUnavailable(harness({ opportunityValue: extra }).reader);
  });

  it.each([
    {
      name: 'envelope account',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        accountId: parseAccountId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      }),
    },
    {
      name: 'envelope correlation',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    },
    {
      name: 'position',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        quote: { ...value.quote, positionId: 'different-position' },
      }),
    },
    {
      name: 'destination network',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        quote: { ...value.quote, destinationNetworkId: SOLANA },
      }),
    },
    {
      name: 'source amount',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        quote: { ...value.quote, sourceAmountAtomic: AMOUNT_ATOMIC - 1n },
      }),
    },
    {
      name: 'future timestamp',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        quote: { ...value.quote, quotedAt: '2026-09-03T12:00:01.000Z' },
      }),
    },
    {
      name: 'validity ending at the aggregate deadline',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        quote: { ...value.quote, validUntil: '2026-09-03T12:00:30.000Z' },
      }),
    },
    {
      name: 'age reaching the maximum at the aggregate deadline',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        quote: { ...value.quote, quotedAt: '2026-09-03T11:59:30.000Z' },
      }),
    },
    {
      name: 'request fingerprint',
      mutate: (value: FullLifecycleCostQuoteResult): unknown => ({
        ...value,
        requestFingerprintSha256: '0'.repeat(64),
      }),
    },
  ])('rejects a lifecycle quote with a mismatched $name', async ({ mutate }) => {
    let invocation = 0;
    const fixture = harness({
      quoteImplementation: async (input) => {
        invocation += 1;
        const valid = quoteResult(input);
        return (invocation === 1 ? mutate(valid) : valid) as FullLifecycleCostQuoteResult;
      },
    });

    await expectUnavailable(fixture.reader);
    expect(fixture.quotes.readFullLifecycleCostQuote).toHaveBeenCalledTimes(1);
  });

  it('rejects accessor-backed quote costs without invoking them', async () => {
    let getterCalls = 0;
    const fixture = harness({
      quoteImplementation: async (input) => {
        const result = quoteResult(input);
        const costs = { ...result.quote.costsUsdMantissa } as MutableRecord;
        Object.defineProperty(costs, 'entrySourceNetwork', {
          enumerable: true,
          get: () => {
            getterCalls += 1;
            throw new Error('malicious cost accessor');
          },
        });
        return { ...result, quote: { ...result.quote, costsUsdMantissa: costs as never } };
      },
    });

    await expectUnavailable(fixture.reader);
    expect(getterCalls).toBe(0);
  });

  it('sanitizes upstream and quote failures and stops at the failed deterministic quote', async () => {
    const upstream = harness();
    upstream.capital.readRoutableCapitalPositions.mockRejectedValue(
      new Error('secret balance provider response'),
    );
    await expectUnavailable(upstream.reader);

    const quoteFailure = harness({
      quoteImplementation: async () => {
        throw new Error('secret route provider response');
      },
    });
    try {
      await quoteFailure.reader.read(request());
      throw new Error('expected composed input read to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(FeeAwareAllocationInputUnavailableError);
      expect(error).toMatchObject({
        code: 'FEE_AWARE_ALLOCATION_INPUT_UNAVAILABLE',
        message: 'Fee-aware allocation inputs are unavailable',
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(String(error)).not.toContain('secret');
    }
    expect(quoteFailure.quotes.readFullLifecycleCostQuote).toHaveBeenCalledTimes(1);
  });

  it('aborts sibling initial I/O when one upstream rejects and returns a fresh sanitized error', async () => {
    const upstreamError = new FeeAwareAllocationInputUnavailableError();
    upstreamError.name = 'SensitiveUpstreamFailure';
    upstreamError.message = 'secret rejected upstream detail';
    Object.defineProperty(upstreamError, 'cause', {
      configurable: true,
      enumerable: true,
      value: new Error('secret upstream cause'),
    });
    let opportunityAborted!: () => void;
    let policyAborted!: () => void;
    const opportunityObservedAbort = new Promise<void>((resolve) => {
      opportunityAborted = resolve;
    });
    const policyObservedAbort = new Promise<void>((resolve) => {
      policyAborted = resolve;
    });
    const fixture = harness();
    fixture.capital.readRoutableCapitalPositions.mockRejectedValue(upstreamError);
    fixture.opportunities.readApprovedLendingOpportunities.mockImplementation(
      (input) =>
        new Promise<ApprovedLendingOpportunitySnapshot>((_resolve, reject) => {
          input.signal.addEventListener(
            'abort',
            () => {
              opportunityAborted();
              reject(new Error('secret opportunity cancellation detail'));
            },
            { once: true },
          );
        }),
    );
    fixture.policy.readApprovedSmartLendingPolicy.mockImplementation(
      (input) =>
        new Promise<ApprovedSmartLendingPolicySnapshot>((_resolve, reject) => {
          input.signal.addEventListener(
            'abort',
            () => {
              policyAborted();
              reject(new Error('secret policy cancellation detail'));
            },
            { once: true },
          );
        }),
    );

    let captured: unknown;
    try {
      await fixture.reader.read(request());
    } catch (error) {
      captured = error;
    }
    await Promise.all([opportunityObservedAbort, policyObservedAbort]);

    const opportunitySignal =
      fixture.opportunities.readApprovedLendingOpportunities.mock.calls[0]?.[0].signal;
    const policySignal = fixture.policy.readApprovedSmartLendingPolicy.mock.calls[0]?.[0].signal;
    expect(opportunitySignal).toBe(policySignal);
    expect(opportunitySignal?.aborted).toBe(true);
    expect(captured).toEqual(new FeeAwareAllocationInputUnavailableError());
    expect(captured).not.toBe(upstreamError);
    expect(String(captured)).not.toContain('secret');
    expect((captured as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(fixture.quotes.readFullLifecycleCostQuote).not.toHaveBeenCalled();
  });

  it('times out a non-cooperative initial upstream with the shared signal and launches no quote', async () => {
    jest.useFakeTimers();
    try {
      const fixture = harness();
      fixture.capital.readRoutableCapitalPositions.mockImplementation(
        () => new Promise<RoutableCapitalPositionSnapshot>(() => undefined),
      );

      const pending = fixture.reader.read(request());
      const upstreamRequests = [
        fixture.capital.readRoutableCapitalPositions.mock.calls[0]?.[0],
        fixture.opportunities.readApprovedLendingOpportunities.mock.calls[0]?.[0],
        fixture.policy.readApprovedSmartLendingPolicy.mock.calls[0]?.[0],
      ];
      expect(upstreamRequests.every((value) => value !== undefined)).toBe(true);
      expect(
        upstreamRequests.every((value) => value?.deadlineAt === '2026-09-03T12:00:30.000Z'),
      ).toBe(true);
      const sharedSignal = upstreamRequests[0]?.signal;
      expect(sharedSignal).toBeInstanceOf(AbortSignal);
      expect(upstreamRequests.every((value) => value?.signal === sharedSignal)).toBe(true);
      expect(sharedSignal?.aborted).toBe(false);

      const rejection = expect(pending).rejects.toEqual(
        new FeeAwareAllocationInputUnavailableError(),
      );
      await jest.advanceTimersByTimeAsync(COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS);
      await rejection;

      expect(sharedSignal?.aborted).toBe(true);
      expect(fixture.quotes.readFullLifecycleCostQuote).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS);
      expect(fixture.quotes.readFullLifecycleCostQuote).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('enforces one aggregate deadline, aborts the active quote, and launches no later quote', async () => {
    jest.useFakeTimers();
    try {
      let started!: () => void;
      const quoteStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      let activeRequest: ReadFullLifecycleCostQuoteRequest | undefined;
      const fixture = harness({
        quoteImplementation: async (input) => {
          activeRequest = input;
          started();
          return new Promise<FullLifecycleCostQuoteResult>((_resolve, reject) => {
            input.signal.addEventListener(
              'abort',
              () => reject(new Error('sensitive cancelled upstream quote detail')),
              { once: true },
            );
          });
        },
      });

      const pending = fixture.reader.read(request());
      await quoteStarted;
      expect(activeRequest?.deadlineAt).toBe('2026-09-03T12:00:30.000Z');
      expect(activeRequest?.signal.aborted).toBe(false);
      const rejection = expect(pending).rejects.toEqual(
        new FeeAwareAllocationInputUnavailableError(),
      );
      await jest.advanceTimersByTimeAsync(COMPOSED_FEE_AWARE_QUOTE_DEADLINE_MILLISECONDS);
      await rejection;

      expect(activeRequest?.signal.aborted).toBe(true);
      expect(fixture.quotes.readFullLifecycleCostQuote).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('replaces a mutated exported unavailable error with a new stable sanitized instance', async () => {
    const tainted = new FeeAwareAllocationInputUnavailableError();
    tainted.name = 'SecretProviderFailure';
    tainted.message = 'secret provider body and wallet details';
    Object.defineProperty(tainted, 'code', {
      configurable: true,
      enumerable: true,
      value: 'SECRET_UPSTREAM_CODE',
    });
    Object.defineProperty(tainted, 'cause', {
      configurable: true,
      enumerable: true,
      value: new Error('secret cause'),
    });
    const fixture = harness({
      quoteImplementation: async () => {
        throw tainted;
      },
    });

    let captured: unknown;
    try {
      await fixture.reader.read(request());
    } catch (error) {
      captured = error;
    }

    expect(captured).toEqual(new FeeAwareAllocationInputUnavailableError());
    expect(captured).not.toBe(tainted);
    expect(String(captured)).not.toContain('secret');
    expect((captured as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('ignores caller-authored financial fields', async () => {
    const fixture = harness();
    const input = { ...request() } as MutableRecord;
    let getterCalls = 0;
    for (const key of ['positions', 'opportunities', 'policy', 'quotes', 'consent']) {
      Object.defineProperty(input, key, {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          throw new Error('caller-authored financial input');
        },
      });
    }

    await fixture.reader.read(input as unknown as ReturnType<typeof request>);

    expect(getterCalls).toBe(0);
  });
});

describe('unavailable fee-aware input adapters', () => {
  it('reject every upstream boundary with the same sanitized unavailable error', async () => {
    const error = new FeeAwareAllocationInputUnavailableError();
    const upstreamRequest = {
      ...request(),
      deadlineAt: '2026-09-03T12:00:30.000Z',
      signal: new AbortController().signal,
    };
    await expect(
      new UnavailableRoutableCapitalPositionSnapshotReader().readRoutableCapitalPositions(
        upstreamRequest,
      ),
    ).rejects.toEqual(error);
    await expect(
      new UnavailableApprovedLendingOpportunitySnapshotReader().readApprovedLendingOpportunities(
        upstreamRequest,
      ),
    ).rejects.toEqual(error);
    await expect(
      new UnavailableApprovedSmartLendingPolicyReader().readApprovedSmartLendingPolicy(
        upstreamRequest,
      ),
    ).rejects.toEqual(error);
    await expect(
      new UnavailableFullLifecycleCostQuoteReader().readFullLifecycleCostQuote(
        {} as ReadFullLifecycleCostQuoteRequest,
      ),
    ).rejects.toEqual(error);
  });
});
