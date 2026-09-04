import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  FEE_AWARE_ALLOCATION_NETWORK_IDS,
  FEE_AWARE_ALLOCATION_USD_SCALE,
  type FeeAwareAllocationCostsUsdMantissa,
} from '../domain/fee-aware-allocation';
import type { FeeAwareAllocationInputReader } from './ports/fee-aware-allocation-input.port';
import {
  SmartLendingRecommendationService,
  SmartLendingRecommendationUnavailableError,
  type SmartLendingRecommendationClock,
} from './smart-lending-recommendation.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CORRELATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVALUATED_AT = '2026-09-03T12:00:00.000Z';
const ETHEREUM = FEE_AWARE_ALLOCATION_NETWORK_IDS[0];
const USD = 10n ** BigInt(FEE_AWARE_ALLOCATION_USD_SCALE);

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

function validInputs(): Awaited<ReturnType<FeeAwareAllocationInputReader['read']>> {
  const position = {
    positionId: 'position-ethereum-usdc',
    walletId: 'wallet-1',
    networkId: ETHEREUM,
    assetId: 'ethereum-usdc',
    amountAtomic: 1_000_000_000n,
    amountUsdMantissa: 1_000n * USD,
  } as const;
  const opportunity = {
    opportunityId: 'opportunity-aave-usdc',
    providerId: 'aave',
    networkId: ETHEREUM,
    assetId: 'ethereum-usdc',
    availability: 'AVAILABLE',
    recommendationEligibility: 'ELIGIBLE',
    grossApyBasisPoints: 500n,
    recurringFeeBasisPoints: 0n,
    availableCapacityUsdMantissa: 10_000n * USD,
    evidence: {
      evidenceReferenceId: 'provider-evidence-1',
      adapterId: 'aave-read-adapter',
      observedAt: '2026-09-03T11:59:30.000Z',
      validUntil: '2026-09-03T12:01:00.000Z',
    },
    riskAssessment: {
      status: 'APPROVED_FOR_RECOMMENDATION',
      assessmentReferenceId: 'risk-assessment-1',
      assessedAt: '2026-09-03T11:59:00.000Z',
      validUntil: '2026-09-03T12:05:00.000Z',
      penaltyBasisPoints: 25n,
    },
  } as const;
  return {
    holdingPeriodDays: 365n,
    maximumQuoteAgeSeconds: 60n,
    maximumOpportunityAgeSeconds: 300n,
    minimumNetBenefitUsdMantissa: 1n,
    crossChainPolicy: {
      optIn: null,
      allowedBridgeProviderIds: [],
      maximumLifecycleCostUsdMantissa: 0n,
      minimumNetImprovementUsdMantissa: 0n,
    },
    exposurePolicy: {
      maximumCrossChainPrincipalUsdMantissa: 0n,
      maximumProviderPrincipalUsdMantissa: 1_000n * USD,
    },
    positions: [position],
    opportunities: [opportunity],
    candidates: [
      {
        candidateId: 'candidate-aave-usdc',
        positionId: position.positionId,
        opportunityId: opportunity.opportunityId,
        costQuote: {
          quoteReferenceId: 'quote-aave-usdc',
          routeReferenceId: 'route-aave-usdc',
          positionId: position.positionId,
          opportunityId: opportunity.opportunityId,
          verifiedByAdapterId: 'ethereum-route-adapter',
          quotedAt: '2026-09-03T11:59:30.000Z',
          validUntil: '2026-09-03T12:01:00.000Z',
          sourceNetworkId: ETHEREUM,
          destinationNetworkId: ETHEREUM,
          sourceAssetId: position.assetId,
          destinationAssetId: opportunity.assetId,
          sourceAmountAtomic: position.amountAtomic,
          minimumDestinationAmountAtomic: position.amountAtomic,
          costsUsdMantissa: zeroCosts(),
          bridge: null,
        },
      },
    ],
  };
}

function serviceFixture(values?: {
  readonly reader?: jest.Mocked<FeeAwareAllocationInputReader>;
  readonly clock?: SmartLendingRecommendationClock;
}): {
  readonly service: SmartLendingRecommendationService;
  readonly reader: jest.Mocked<FeeAwareAllocationInputReader>;
} {
  const reader =
    values?.reader ??
    ({
      read: jest.fn().mockResolvedValue(validInputs()),
    } as jest.Mocked<FeeAwareAllocationInputReader>);
  const clock = values?.clock ?? { now: (): Date => new Date(EVALUATED_AT) };
  return { service: new SmartLendingRecommendationService(reader, clock), reader };
}

describe('SmartLendingRecommendationService', () => {
  it('uses trusted server inputs and clock for a non-authorizing recommendation', async () => {
    const fixture = serviceFixture();

    const result = await fixture.service.read({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(fixture.reader.read).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      evaluatedAt: EVALUATED_AT,
    });
    expect(result).toMatchObject({
      status: 'RECOMMENDED',
      evaluatedAt: EVALUATED_AT,
      use: 'NON_EXECUTING_RECOMMENDATION_ONLY',
      mayAuthorizeFinancialAction: false,
      mayAuthorizeTransaction: false,
      mayExecuteTransaction: false,
    });
  });

  it('does not read caller-authored policy, consent, position, opportunity, or quote fields', async () => {
    const fixture = serviceFixture();
    const untrustedRequest: Record<string, unknown> = {
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    };
    let financialAccessorInvoked = false;
    for (const key of ['policy', 'consent', 'positions', 'opportunities', 'quotes']) {
      Object.defineProperty(untrustedRequest, key, {
        enumerable: true,
        get: () => {
          financialAccessorInvoked = true;
          throw new Error('caller-authored financial input must not be read');
        },
      });
    }

    const result = await fixture.service.read(
      untrustedRequest as unknown as Parameters<SmartLendingRecommendationService['read']>[0],
    );

    expect(result.status).toBe('RECOMMENDED');
    expect(financialAccessorInvoked).toBe(false);
  });

  it('rejects required request accessors without invoking them or reading financial inputs', async () => {
    const fixture = serviceFixture();
    let getterCalls = 0;
    const request = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(request, {
      accountId: {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          throw new Error('private request detail');
        },
      },
      correlationId: { enumerable: true, value: CORRELATION_ID },
    });

    await expect(
      fixture.service.read(
        request as unknown as Parameters<SmartLendingRecommendationService['read']>[0],
      ),
    ).rejects.toEqual(new SmartLendingRecommendationUnavailableError());
    expect(getterCalls).toBe(0);
    expect(fixture.reader.read).not.toHaveBeenCalled();
  });

  it('rejects accessor-backed trusted inputs without invoking their fields', async () => {
    let getterCalls = 0;
    const hostileInputs = { ...validInputs() };
    Object.defineProperty(hostileInputs, 'positions', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('private adapter detail');
      },
    });
    const reader = {
      read: jest.fn().mockResolvedValue(hostileInputs),
    } as jest.Mocked<FeeAwareAllocationInputReader>;
    const fixture = serviceFixture({ reader });

    await expect(
      fixture.service.read({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID }),
    ).rejects.toEqual(new SmartLendingRecommendationUnavailableError());
    expect(getterCalls).toBe(0);
  });

  it('fails closed when the trusted input source fails or returns malformed data', async () => {
    const failures: jest.Mocked<FeeAwareAllocationInputReader>[] = [
      { read: jest.fn().mockRejectedValue(new Error('unavailable')) },
      {
        read: jest.fn().mockResolvedValue({
          ...validInputs(),
          positions: [],
        }),
      },
    ];

    for (const reader of failures) {
      const fixture = serviceFixture({ reader });
      await expect(
        fixture.service.read({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID }),
      ).rejects.toEqual(new SmartLendingRecommendationUnavailableError());
    }
  });

  it.each([
    {
      name: 'account',
      accountId: 'not-an-account',
      correlationId: CORRELATION_ID,
      clock: { now: (): Date => new Date(EVALUATED_AT) },
    },
    {
      name: 'correlation',
      accountId: ACCOUNT_ID,
      correlationId: 'not-a-correlation',
      clock: { now: (): Date => new Date(EVALUATED_AT) },
    },
    {
      name: 'clock',
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      clock: { now: (): Date => new Date(Number.NaN) },
    },
  ])('rejects an invalid $name before reading financial inputs', async (entry) => {
    const fixture = serviceFixture({ clock: entry.clock });

    await expect(
      fixture.service.read({
        accountId: entry.accountId as typeof ACCOUNT_ID,
        correlationId: entry.correlationId,
      }),
    ).rejects.toEqual(new SmartLendingRecommendationUnavailableError());
    expect(fixture.reader.read).not.toHaveBeenCalled();
  });

  it('rejects Date subclasses, Date proxies, and clock failures before reading inputs', async () => {
    class DateSubclass extends Date {}
    const subclassFixture = serviceFixture({
      clock: { now: (): Date => new DateSubclass(EVALUATED_AT) },
    });
    await expect(
      subclassFixture.service.read({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID }),
    ).rejects.toEqual(new SmartLendingRecommendationUnavailableError());
    expect(subclassFixture.reader.read).not.toHaveBeenCalled();

    let proxyPropertyReads = 0;
    const dateProxy = new Proxy(new Date(EVALUATED_AT), {
      get: () => {
        proxyPropertyReads += 1;
        throw new Error('private proxy detail');
      },
    });
    const proxyFixture = serviceFixture({ clock: { now: (): Date => dateProxy } });
    await expect(
      proxyFixture.service.read({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID }),
    ).rejects.toEqual(new SmartLendingRecommendationUnavailableError());
    expect(proxyPropertyReads).toBe(0);
    expect(proxyFixture.reader.read).not.toHaveBeenCalled();

    const failureFixture = serviceFixture({
      clock: {
        now: (): Date => {
          throw new Error('private clock detail');
        },
      },
    });
    await expect(
      failureFixture.service.read({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID }),
    ).rejects.toEqual(new SmartLendingRecommendationUnavailableError());
    expect(failureFixture.reader.read).not.toHaveBeenCalled();
  });
});
