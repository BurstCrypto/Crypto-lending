import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
  LocalDemoApiClient,
  LocalDemoApiError,
  LOCAL_DEMO_PORTFOLIO_PATH,
  LOCAL_DEMO_WALLETS_PATH,
  parseLocalDemoWallets,
} from '../lib/local-demo/local-demo-client';
import {
  LOCAL_DEMO_EVM_NETWORK_ID,
  LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY,
  parseLocalDemoPortfolioResponse,
} from '../lib/local-demo/local-demo-portfolio-response';
import {
  LOCAL_DEMO_YIELD_CATALOG_PATH,
  parseLocalDemoAllocationPreview,
  parseLocalDemoYieldCatalog,
  validateLocalDemoAllocationSelection,
} from '../lib/local-demo/local-demo-yield';
import { parseUnifiedBalanceResponse } from '../lib/portfolio/unified-balance';
import { LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD } from './local-demo-portfolio.fixtures';
import {
  expectProviderPrivateValue,
  LOCAL_DEMO_PROVIDER_PRIVACY_CANARY,
  LOCAL_DEMO_PROVIDER_PRIVACY_SAFE_COPY_TEST_CANARIES,
  LOCAL_DEMO_PROVIDER_PRIVACY_TEST_CANARIES,
} from './local-demo-provider-privacy';
import {
  BALANCED_PREVIEW,
  CROSS_CHAIN_BALANCED_PREVIEW,
  DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW,
  FRACTIONAL_LIQUID_PREVIEW,
  HALF_EVEN_DOWN_PLATFORM_FEE_PREVIEW,
  HALF_EVEN_UP_PLATFORM_FEE_PREVIEW,
  LOCAL_DEMO_YIELD_CATALOG,
  MORE_YIELD_DAY_365_PREVIEW,
  MORE_LIQUID_PREVIEW,
  RETAINED_ROUNDING_RESIDUAL_PREVIEW,
} from './local-demo-yield.fixtures';

const PORTFOLIO_SNAPSHOT_ID = BALANCED_PREVIEW.portfolioSnapshotId;

const CSRF = 'A'.repeat(43);

const EVM_WALLET = Object.freeze({
  connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  label: 'Synthetic EVM wallet',
  namespace: 'EVM' as const,
  chainId: 'eip155:11155111',
  address: '0x1111111111111111111111111111111111111111',
  registeredAt: '2026-08-24T18:00:00.000Z',
});

const SOLANA_WALLET = Object.freeze({
  connectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  label: 'Synthetic Solana wallet',
  namespace: 'SOLANA' as const,
  chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  address: '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8',
  registeredAt: '2026-08-24T18:00:00.000Z',
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('local demo same-origin API client', () => {
  it('covers every supported provider family and private response-field class in its canary', () => {
    for (const canary of LOCAL_DEMO_PROVIDER_PRIVACY_TEST_CANARIES) {
      expect(canary).toMatch(LOCAL_DEMO_PROVIDER_PRIVACY_CANARY);
    }
  });

  it('does not mistake adjacent generic copy for provider identity', () => {
    for (const canary of LOCAL_DEMO_PROVIDER_PRIVACY_SAFE_COPY_TEST_CANARIES) {
      expect(canary).not.toMatch(LOCAL_DEMO_PROVIDER_PRIVACY_CANARY);
    }
  });

  it('invokes the default browser fetch with its required global receiver', async () => {
    const browserFetch = vi.fn(function (
      this: typeof globalThis,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      void _input;
      void _init;
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(json([]));
    });
    vi.stubGlobal('fetch', browserFetch);

    try {
      const client = new LocalDemoApiClient();
      await expect(client.listWallets()).resolves.toEqual([]);
      expect(browserFetch).toHaveBeenCalledWith(
        LOCAL_DEMO_WALLETS_PATH,
        expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lists, registers, disconnects, and reads a bounded portfolio through fixed relative paths', async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([EVM_WALLET, SOLANA_WALLET]))
      .mockResolvedValueOnce(json(EVM_WALLET, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json(LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD));
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });

    await expect(client.listWallets()).resolves.toHaveLength(2);
    await expect(client.registerWallet('EVM')).resolves.toEqual(EVM_WALLET);
    await expect(client.disconnectWallet(EVM_WALLET.connectionId)).resolves.toBeUndefined();
    const portfolio = await client.readPortfolio();
    expect(portfolio).toMatchObject({
      portfolioValueUsdMinor: '1100000',
      buyingPower: { amountUsdMinor: '1100000', deductions: [] },
    });
    expect(portfolio.wallets[0]?.chains[0]).toMatchObject({
      networkId: LOCAL_DEMO_EVM_NETWORK_ID,
    });
    expect(portfolio.wallets[0]?.chains[0]?.assets[0]).toMatchObject({
      assetIdentity: LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY,
    });

    expect(requestFetch.mock.calls.map(([path]) => path)).toEqual([
      LOCAL_DEMO_WALLETS_PATH,
      LOCAL_DEMO_WALLETS_PATH,
      LOCAL_DEMO_WALLETS_PATH,
      LOCAL_DEMO_PORTFOLIO_PATH,
    ]);
    expect(requestFetch.mock.calls.map(([, init]) => init)).toMatchObject([
      { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' },
      {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ namespace: 'EVM' }),
        headers: { 'X-CSRF-Token': CSRF },
      },
      {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ connectionId: EVM_WALLET.connectionId }),
        headers: { 'X-CSRF-Token': CSRF },
      },
      { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' },
    ]);
  });

  it('requires the session CSRF proof before any unsafe request is attempted', async () => {
    const requestFetch = vi.fn<typeof fetch>();
    const client = new LocalDemoApiClient({ cookieHeader: '', fetch: requestFetch });

    await expect(client.registerWallet('SOLANA')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(client.disconnectWallet(SOLANA_WALLET.connectionId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('reads only aggregate managed rates and previews a closed preset through fixed paths', async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(LOCAL_DEMO_YIELD_CATALOG))
      .mockResolvedValueOnce(json(BALANCED_PREVIEW))
      .mockResolvedValueOnce(json(MORE_LIQUID_PREVIEW));
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });

    await expect(client.readYieldCatalog()).resolves.toEqual(LOCAL_DEMO_YIELD_CATALOG);
    expect(LOCAL_DEMO_YIELD_CATALOG.snapshot).toMatchObject({
      id: 'managed-rate-snapshot-v3',
      capturedAt: '2026-08-27T01:04:48.000Z',
      staleAfter: '2026-08-27T14:14:54.580Z',
    });
    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).resolves.toEqual(BALANCED_PREVIEW);
    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'MORE_LIQUID',
        liquidReserveBasisPoints: 6_000,
      }),
    ).resolves.toEqual(MORE_LIQUID_PREVIEW);
    expectProviderPrivateValue(LOCAL_DEMO_YIELD_CATALOG);
    expectProviderPrivateValue(BALANCED_PREVIEW);
    expectProviderPrivateValue(MORE_LIQUID_PREVIEW);
    expect(BALANCED_PREVIEW.executionCost.modeledScenario.totalUsdMinor).not.toBe(
      MORE_LIQUID_PREVIEW.executionCost.modeledScenario.totalUsdMinor,
    );
    expect(requestFetch).toHaveBeenNthCalledWith(
      1,
      LOCAL_DEMO_YIELD_CATALOG_PATH,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
    expect(requestFetch).toHaveBeenNthCalledWith(
      2,
      LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({
          portfolioSnapshotId: PORTFOLIO_SNAPSHOT_ID,
          selection: {
            kind: 'PRESET',
            presetId: 'BALANCED',
            liquidReserveBasisPoints: 3_000,
          },
        }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': CSRF,
        }),
      }),
    );
    expect(requestFetch).toHaveBeenNthCalledWith(
      3,
      LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          portfolioSnapshotId: PORTFOLIO_SNAPSHOT_ID,
          selection: {
            kind: 'PRESET',
            presetId: 'MORE_LIQUID',
            liquidReserveBasisPoints: 6_000,
          },
        }),
      }),
    );
    expect(requestFetch).toHaveBeenCalledTimes(3);
  });

  it('rejects legacy identity fields and forged aggregate cost arithmetic', async () => {
    expect(() =>
      parseLocalDemoYieldCatalog({
        ...structuredClone(LOCAL_DEMO_YIELD_CATALOG),
        snapshot: { ...LOCAL_DEMO_YIELD_CATALOG.snapshot, staleBehavior: 'EXECUTE_STALE' },
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseLocalDemoYieldCatalog({
        ...structuredClone(LOCAL_DEMO_YIELD_CATALOG),
        opportunities: [],
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseLocalDemoYieldCatalog({
        ...structuredClone(LOCAL_DEMO_YIELD_CATALOG),
        snapshot: { ...LOCAL_DEMO_YIELD_CATALOG.snapshot, provider: 'LEGACY_PROVIDER' },
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseLocalDemoAllocationPreview({
        ...structuredClone(BALANCED_PREVIEW),
        capitalIncludedInProjectionUsdMinor: '1099999',
      }),
    ).toThrow(TypeError);
    const forgedExecutionCost = structuredClone(BALANCED_PREVIEW) as unknown as {
      executionCost: {
        actualLocalOperation: { amountUsdMinor: string };
        publicExecution: { status: string; amountUsdMinor: string | null };
      };
    };
    forgedExecutionCost.executionCost.actualLocalOperation.amountUsdMinor = '1';
    forgedExecutionCost.executionCost.publicExecution.status = 'QUOTED';
    forgedExecutionCost.executionCost.publicExecution.amountUsdMinor = '822';
    expect(() => parseLocalDemoAllocationPreview(forgedExecutionCost)).toThrow(TypeError);

    const legacyAllocation = structuredClone(BALANCED_PREVIEW) as unknown as {
      allocations: Array<Record<string, unknown>>;
    };
    legacyAllocation.allocations[1]!.opportunity = { provider: 'LEGACY_PROVIDER' };
    expect(() => parseLocalDemoAllocationPreview(legacyAllocation)).toThrow(TypeError);

    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(BALANCED_PREVIEW)),
    });
    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'MORE_LIQUID',
        liquidReserveBasisPoints: 6_000,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects every provider-private field class and URL at the aggregate boundary', () => {
    const hostileCases: ReadonlyArray<
      readonly [string, 'CATALOG' | 'PREVIEW', (candidate: Record<string, unknown>) => void]
    > = [
      [
        'provider identifiers',
        'CATALOG',
        (candidate) => {
          candidate.providerIds = ['MORPHO', 'KAMINO', 'AAVE', 'SAVE', 'SOLEND'];
        },
      ],
      [
        'protocol identifiers',
        'CATALOG',
        (candidate) => {
          candidate.protocols = ['MORPHO_BLUE', 'KAMINO_LEND', 'AAVE_V3', 'SAVE_LEND'];
        },
      ],
      [
        'market identifiers',
        'PREVIEW',
        (candidate) => {
          const allocations = candidate.allocations as Array<Record<string, unknown>>;
          allocations[1]!.marketId = 'opaque-market';
        },
      ],
      [
        'reserve identifiers',
        'PREVIEW',
        (candidate) => {
          const composition = candidate.managedYieldComposition as Array<Record<string, unknown>>;
          composition[1]!.reserveId = 'opaque-reserve';
        },
      ],
      [
        'opportunity identifiers',
        'PREVIEW',
        (candidate) => {
          const allocations = candidate.allocations as Array<Record<string, unknown>>;
          allocations[1]!.opportunityId = 'opaque-opportunity';
        },
      ],
      [
        'provenance and provider URLs',
        'PREVIEW',
        (candidate) => {
          const rateSnapshot = candidate.rateSnapshot as Record<string, unknown>;
          rateSnapshot.provenance = {
            sourceReference: 'https://api.kamino.finance/private-provider-route',
            endpoint: 'https://api.morpho.org/graphql',
          };
        },
      ],
    ];

    for (const [, shape, mutate] of hostileCases) {
      const candidate = structuredClone(
        shape === 'CATALOG' ? LOCAL_DEMO_YIELD_CATALOG : BALANCED_PREVIEW,
      ) as unknown as Record<string, unknown>;
      mutate(candidate);
      expect(() =>
        shape === 'CATALOG'
          ? parseLocalDemoYieldCatalog(candidate)
          : parseLocalDemoAllocationPreview(candidate),
      ).toThrow(TypeError);
    }
  });

  it('maps a provider-bearing success body to a fixed error without retaining its detail', async () => {
    const hostile = structuredClone(BALANCED_PREVIEW) as unknown as Record<string, unknown>;
    hostile.providerIds = ['MORPHO', 'KAMINO', 'AAVE', 'SAVE', 'SOLEND'];
    hostile.sourceReference = 'https://save.finance/private-reserve';
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(hostile)),
    });

    const error = await client
      .previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LocalDemoApiError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
    expectProviderPrivateValue(error);
  });

  it('reconciles components, post-fee yield, allocation cents, and exact recovery timing', () => {
    expect(() => parseLocalDemoAllocationPreview(BALANCED_PREVIEW)).not.toThrow();
    expect(BALANCED_PREVIEW.executionCost.modeledScenario.components).toMatchObject([
      { code: 'NETWORK', fundingTreatment: 'DEDUCTED_FROM_GROSS', amountUsdMinor: '489' },
      { code: 'CONVERSION', fundingTreatment: 'DEDUCTED_FROM_GROSS', amountUsdMinor: '0' },
      {
        code: 'CROSS_ECOSYSTEM_TRANSFER',
        fundingTreatment: 'DEDUCTED_FROM_GROSS',
        amountUsdMinor: '0',
      },
      { code: 'MARKET_IMPACT', fundingTreatment: 'DEDUCTED_FROM_GROSS', amountUsdMinor: '177' },
      {
        code: 'PLATFORM_ROUTING',
        calculationBasis: 'CANONICAL_PLATFORM_ROUTING_RULE_V1',
        fundingTreatment: 'ADDED_ON_TOP',
        amountUsdMinor: '979',
      },
    ]);
    expect(BALANCED_PREVIEW.executionCost.modeledScenario.routingFeePolicy).toEqual({
      tier: 'FREE',
      classification: 'MATERIAL_ORCHESTRATION',
      ruleVersion: 1,
    });
    expect(BALANCED_PREVIEW.executionCost.modeledScenario).toMatchObject({
      fundingTreatment: 'MIXED_DEDUCT_FROM_GROSS_AND_ADD_ON_TOP',
      deductedFromGrossUsdMinor: '666',
      addedOnTopUsdMinor: '979',
      retainedRoundingResidualUsdMinor: '0',
      totalUsdMinor: '1645',
      requiredCapitalIncludingAddedOnTopUsdMinor: '700979',
    });
    expect(BALANCED_PREVIEW.executionCost.actualLocalOperation).toEqual({
      status: 'NO_EXECUTION',
      amountUsdMinor: '0',
    });
    expect(BALANCED_PREVIEW.executionCost.publicExecution).toEqual({
      status: 'UNQUOTED',
      amountUsdMinor: null,
    });
    expect(BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees).toMatchObject({
      status: 'RECOVERED_WITHIN_HORIZON',
      day: 14,
      modelHorizonDays: 365,
    });

    const forgedComponentTotal = {
      ...structuredClone(BALANCED_PREVIEW),
      executionCost: {
        ...BALANCED_PREVIEW.executionCost,
        modeledScenario: {
          ...BALANCED_PREVIEW.executionCost.modeledScenario,
          totalUsdMinor: '721',
        },
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedComponentTotal)).toThrow(TypeError);

    const policyMutations: ReadonlyArray<(policy: Record<string, unknown>) => void> = [
      (policy) => {
        policy.tier = 'INDIVIDUAL';
      },
      (policy) => {
        policy.classification = 'UNKNOWN_ROUTE';
      },
      (policy) => {
        policy.ruleVersion = 2;
      },
      (policy) => {
        policy.ruleReferenceId = '76000000-0000-4000-8000-000000000001';
      },
    ];
    for (const mutatePolicy of policyMutations) {
      const candidate = structuredClone(BALANCED_PREVIEW) as unknown as Record<string, unknown>;
      const execution = candidate.executionCost as Record<string, unknown>;
      const modeled = execution.modeledScenario as Record<string, unknown>;
      mutatePolicy(modeled.routingFeePolicy as Record<string, unknown>);
      expect(() => parseLocalDemoAllocationPreview(candidate)).toThrow(TypeError);
    }

    const fundingMutations: ReadonlyArray<(modeled: Record<string, unknown>) => void> = [
      (modeled) => {
        modeled.fundingTreatment = 'DEDUCT_FROM_GROSS';
      },
      (modeled) => {
        const components = modeled.components as Array<Record<string, unknown>>;
        components[0]!.fundingTreatment = 'ADDED_ON_TOP';
      },
      (modeled) => {
        const components = modeled.components as Array<Record<string, unknown>>;
        components[4]!.calculationBasis = 'FREE_TIER_20_BPS_OF_MANAGED_CAPITAL';
      },
      (modeled) => {
        modeled.deductedFromGrossUsdMinor = '665';
      },
      (modeled) => {
        modeled.addedOnTopUsdMinor = '978';
      },
      (modeled) => {
        modeled.retainedRoundingResidualUsdMinor = '1';
      },
      (modeled) => {
        modeled.requiredCapitalIncludingAddedOnTopUsdMinor = '700978';
      },
    ];
    for (const mutateFunding of fundingMutations) {
      const candidate = structuredClone(BALANCED_PREVIEW) as unknown as Record<string, unknown>;
      const execution = candidate.executionCost as Record<string, unknown>;
      const modeled = execution.modeledScenario as Record<string, unknown>;
      mutateFunding(modeled);
      expect(() => parseLocalDemoAllocationPreview(candidate)).toThrow(TypeError);
    }

    const forgedDirectCompatibleFee = structuredClone(BALANCED_PREVIEW) as unknown as Record<
      string,
      unknown
    >;
    const forgedDirectExecution = forgedDirectCompatibleFee.executionCost as Record<
      string,
      unknown
    >;
    const forgedDirectModeled = forgedDirectExecution.modeledScenario as Record<string, unknown>;
    const forgedDirectPolicy = forgedDirectModeled.routingFeePolicy as Record<string, unknown>;
    forgedDirectPolicy.classification = 'DIRECT_COMPATIBLE';
    expect(() => parseLocalDemoAllocationPreview(forgedDirectCompatibleFee)).toThrow(TypeError);

    const forgedPostFeeYield = {
      ...structuredClone(BALANCED_PREVIEW),
      yieldProjection: {
        ...BALANCED_PREVIEW.yieldProjection,
        projectedAnnualYieldAfterFeesUsdMinor: '38525',
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedPostFeeYield)).toThrow(TypeError);

    const forgedWholeCentYieldInsideLegacyOneBpInterval = {
      ...structuredClone(BALANCED_PREVIEW),
      yieldProjection: {
        ...BALANCED_PREVIEW.yieldProjection,
        projectedAnnualYieldUsdMinor: '45454',
        projectedAnnualYieldAfterFeesUsdMinor: '44739',
      },
    };
    expect(() =>
      parseLocalDemoAllocationPreview(forgedWholeCentYieldInsideLegacyOneBpInterval),
    ).toThrow(TypeError);

    const forgedRecoveryDay = {
      ...structuredClone(BALANCED_PREVIEW),
      yieldProjection: {
        ...BALANCED_PREVIEW.yieldProjection,
        firstPositiveDayAfterFees: {
          ...BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees,
          day: 8,
        },
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedRecoveryDay)).toThrow(TypeError);

    const shiftedAllocationAmounts = {
      ...structuredClone(BALANCED_PREVIEW),
      allocations: BALANCED_PREVIEW.allocations.map((allocation, index) => ({
        ...allocation,
        amountUsdMinor: index === 0 ? '209785' : '489500',
      })),
    };
    expect(() => parseLocalDemoAllocationPreview(shiftedAllocationAmounts)).toThrow(TypeError);

    const legacyBreakEven = {
      ...structuredClone(BALANCED_PREVIEW),
      yieldProjection: {
        ...BALANCED_PREVIEW.yieldProjection,
        breakEven: { status: 'AVAILABLE', firstNetPositiveDay: 78 },
      },
    };
    expect(() => parseLocalDemoAllocationPreview(legacyBreakEven)).toThrow(TypeError);

    const legacyCost = {
      ...structuredClone(BALANCED_PREVIEW),
      executionCost: {
        treatment: 'LOCAL_DEMO_ZERO_NO_EXECUTION',
        modeledLocalAmountUsdMinor: '0',
        publicExecutionCostStatus: 'UNQUOTED',
      },
    };
    expect(() => parseLocalDemoAllocationPreview(legacyCost)).toThrow(TypeError);
  });

  it('accepts only a zero platform fee for a direct-compatible preview', () => {
    expect(() =>
      parseLocalDemoAllocationPreview(DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW),
    ).not.toThrow();
    expect(DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW.executionCost.modeledScenario).toMatchObject({
      routingFeePolicy: {
        tier: 'FREE',
        classification: 'DIRECT_COMPATIBLE',
        ruleVersion: 1,
      },
      components: expect.arrayContaining([
        expect.objectContaining({ code: 'PLATFORM_ROUTING', amountUsdMinor: '0' }),
      ]),
    });

    const nonzeroPlatformFee = structuredClone(
      DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW,
    ) as unknown as Record<string, unknown>;
    const execution = nonzeroPlatformFee.executionCost as Record<string, unknown>;
    const modeled = execution.modeledScenario as Record<string, unknown>;
    const components = modeled.components as Array<Record<string, unknown>>;
    components[4]!.amountUsdMinor = '1';
    modeled.totalUsdMinor = '1';
    expect(() => parseLocalDemoAllocationPreview(nonzeroPlatformFee)).toThrow(TypeError);
  });

  it('validates canonical half-even Free-tier platform fee rounding', () => {
    expect(() =>
      parseLocalDemoAllocationPreview(HALF_EVEN_DOWN_PLATFORM_FEE_PREVIEW),
    ).not.toThrow();
    expect(() => parseLocalDemoAllocationPreview(HALF_EVEN_UP_PLATFORM_FEE_PREVIEW)).not.toThrow();
    expect(
      HALF_EVEN_DOWN_PLATFORM_FEE_PREVIEW.executionCost.modeledScenario.components[4]
        ?.amountUsdMinor,
    ).toBe('0');
    expect(
      HALF_EVEN_UP_PLATFORM_FEE_PREVIEW.executionCost.modeledScenario.components[4]?.amountUsdMinor,
    ).toBe('2');
  });

  it('accepts a coherent retained rounding residual without treating it as a fee', () => {
    expect(() => parseLocalDemoAllocationPreview(RETAINED_ROUNDING_RESIDUAL_PREVIEW)).not.toThrow();
    expect(RETAINED_ROUNDING_RESIDUAL_PREVIEW.executionCost.modeledScenario).toMatchObject({
      deductedFromGrossUsdMinor: '0',
      addedOnTopUsdMinor: '0',
      retainedRoundingResidualUsdMinor: '1',
      totalUsdMinor: '0',
      requiredCapitalIncludingAddedOnTopUsdMinor: '251',
    });
    expect(RETAINED_ROUNDING_RESIDUAL_PREVIEW.capitalIncludedInProjectionUsdMinor).toBe('250');

    const maximumResidual = structuredClone(
      RETAINED_ROUNDING_RESIDUAL_PREVIEW,
    ) as unknown as Record<string, unknown>;
    maximumResidual.grossCapitalUsdMinor = '253';
    const maximumSources = maximumResidual.sourceCapitalByEcosystem as Array<
      Record<string, unknown>
    >;
    maximumSources[0]!.amountUsdMinor = '253';
    const maximumExecution = maximumResidual.executionCost as Record<string, unknown>;
    const maximumModeled = maximumExecution.modeledScenario as Record<string, unknown>;
    maximumModeled.costBasisCapitalUsdMinor = '253';
    maximumModeled.retainedRoundingResidualUsdMinor = '3';
    maximumModeled.requiredCapitalIncludingAddedOnTopUsdMinor = '253';
    expect(() => parseLocalDemoAllocationPreview(maximumResidual)).not.toThrow();

    const excessiveResidual = structuredClone(
      RETAINED_ROUNDING_RESIDUAL_PREVIEW,
    ) as unknown as Record<string, unknown>;
    excessiveResidual.grossCapitalUsdMinor = '254';
    const sources = excessiveResidual.sourceCapitalByEcosystem as Array<Record<string, unknown>>;
    sources[0]!.amountUsdMinor = '254';
    const execution = excessiveResidual.executionCost as Record<string, unknown>;
    const modeled = execution.modeledScenario as Record<string, unknown>;
    modeled.costBasisCapitalUsdMinor = '254';
    modeled.retainedRoundingResidualUsdMinor = '4';
    modeled.requiredCapitalIncludingAddedOnTopUsdMinor = '254';
    expect(() => parseLocalDemoAllocationPreview(excessiveResidual)).toThrow(TypeError);
  });

  it('accepts only the exact dynamic selection description, including fractional percentages', () => {
    expect(() => parseLocalDemoAllocationPreview(FRACTIONAL_LIQUID_PREVIEW)).not.toThrow();
    expect(FRACTIONAL_LIQUID_PREVIEW.selection.description).toBe(
      'Keep 15.50% readily available and allocate the remainder to the managed yield strategy.',
    );

    const stalePresetDescription = {
      ...structuredClone(FRACTIONAL_LIQUID_PREVIEW),
      selection: {
        ...FRACTIONAL_LIQUID_PREVIEW.selection,
        description:
          'Keep 15% readily available and allocate the remainder to the managed yield strategy.',
      },
    };
    expect(() => parseLocalDemoAllocationPreview(stalePresetDescription)).toThrow(TypeError);
  });

  it('reconciles provider-private native ecosystem sources, composition, and routing', () => {
    expect(() => parseLocalDemoAllocationPreview(CROSS_CHAIN_BALANCED_PREVIEW)).not.toThrow();
    expect(CROSS_CHAIN_BALANCED_PREVIEW.sourceCapitalByEcosystem).toEqual([
      { ecosystem: 'EVM', amountUsdMinor: '700000' },
      { ecosystem: 'SOLANA', amountUsdMinor: '400000' },
    ]);
    expect(CROSS_CHAIN_BALANCED_PREVIEW.managedYieldComposition).toMatchObject([
      { ecosystem: 'EVM', percentageBasisPointsOfManagedYield: 6_362 },
      { ecosystem: 'SOLANA', percentageBasisPointsOfManagedYield: 3_638 },
    ]);
    expect(CROSS_CHAIN_BALANCED_PREVIEW.compositionSummary).toEqual({
      mode: 'EVM_SOLANA_PORTFOLIO_BLEND',
      crossEcosystemTransferRequired: false,
      crossEcosystemTransferUsdMinor: '0',
      activeEcosystemCount: 2,
    });
    expectProviderPrivateValue(CROSS_CHAIN_BALANCED_PREVIEW);

    const mutations: Array<(candidate: Record<string, unknown>) => void> = [
      (candidate) => {
        const rows = candidate.sourceCapitalByEcosystem as Array<Record<string, unknown>>;
        rows[0]!.amountUsdMinor = '699999';
      },
      (candidate) => {
        const rows = candidate.sourceCapitalByEcosystem as unknown[];
        rows.reverse();
      },
      (candidate) => {
        const rows = candidate.managedYieldComposition as Array<Record<string, unknown>>;
        rows[1]!.percentageBasisPointsOfManagedYield = 3_637;
      },
      (candidate) => {
        const rows = candidate.managedYieldComposition as Array<Record<string, unknown>>;
        rows[1]!.amountUsdMinor = '279906';
      },
      (candidate) => {
        const composition = candidate.compositionSummary as Record<string, unknown>;
        composition.crossEcosystemTransferRequired = true;
      },
      (candidate) => {
        const composition = candidate.compositionSummary as Record<string, unknown>;
        composition.activeEcosystemCount = 1;
      },
      (candidate) => {
        const execution = candidate.executionCost as Record<string, unknown>;
        const modeled = execution.modeledScenario as Record<string, unknown>;
        const components = modeled.components as Array<Record<string, unknown>>;
        components[2]!.amountUsdMinor = '1';
        modeled.totalUsdMinor = '854';
      },
      (candidate) => {
        const execution = candidate.executionCost as Record<string, unknown>;
        const modeled = execution.modeledScenario as Record<string, unknown>;
        const components = modeled.components as Array<Record<string, unknown>>;
        components[0]!.amountUsdMinor = '518';
        components[4]!.amountUsdMinor = '78';
      },
    ];

    for (const mutate of mutations) {
      const candidate = structuredClone(CROSS_CHAIN_BALANCED_PREVIEW) as unknown as Record<
        string,
        unknown
      >;
      mutate(candidate);
      expect(() => parseLocalDemoAllocationPreview(candidate)).toThrow(TypeError);
    }

    const transferHiddenAsNative = structuredClone(
      CROSS_CHAIN_BALANCED_PREVIEW,
    ) as unknown as Record<string, unknown>;
    const hiddenTransferComposition = transferHiddenAsNative.managedYieldComposition as Array<
      Record<string, unknown>
    >;
    hiddenTransferComposition[0]!.amountUsdMinor = '369313';
    hiddenTransferComposition[0]!.percentageBasisPointsOfManagedYield = 4_800;
    hiddenTransferComposition[1]!.amountUsdMinor = '400090';
    hiddenTransferComposition[1]!.percentageBasisPointsOfManagedYield = 5_200;
    expect(() => parseLocalDemoAllocationPreview(transferHiddenAsNative)).toThrow(TypeError);

    const zeroSourceWithAllocation = structuredClone(BALANCED_PREVIEW) as unknown as Record<
      string,
      unknown
    >;
    const zeroSourceComposition = zeroSourceWithAllocation.managedYieldComposition as Array<
      Record<string, unknown>
    >;
    zeroSourceComposition[0]!.amountUsdMinor = '489498';
    zeroSourceComposition[0]!.percentageBasisPointsOfManagedYield = 9_999;
    zeroSourceComposition[1]!.amountUsdMinor = '1';
    zeroSourceComposition[1]!.percentageBasisPointsOfManagedYield = 1;
    expect(() => parseLocalDemoAllocationPreview(zeroSourceWithAllocation)).toThrow(TypeError);
  });

  it('uses both disclosed yield floors to reject an impossible recovery day at the horizon', () => {
    expect(() => parseLocalDemoAllocationPreview(MORE_YIELD_DAY_365_PREVIEW)).not.toThrow();

    const forgedDay = {
      ...structuredClone(MORE_YIELD_DAY_365_PREVIEW),
      yieldProjection: {
        ...MORE_YIELD_DAY_365_PREVIEW.yieldProjection,
        firstPositiveDayAfterFees: {
          ...MORE_YIELD_DAY_365_PREVIEW.yieldProjection.firstPositiveDayAfterFees,
          day: 364,
        },
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedDay)).toThrow(TypeError);
  });

  it('rejects legacy non-preset selections before fetch without reading attacker getters', async () => {
    const getter = vi.fn(() => ({ attackerControlled: true }));
    const legacySelection = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(legacySelection, 'kind', { enumerable: true, value: 'CUSTOM' });
    Object.defineProperty(legacySelection, 'filters', { enumerable: true, get: getter });
    const requestFetch = vi.fn<typeof fetch>();
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });

    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, legacySelection as never),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('rejects an accessor-backed preset before fetch without invoking it', async () => {
    const getter = vi.fn(() => 'BALANCED');
    const selection = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(selection, 'kind', { enumerable: true, value: 'PRESET' });
    Object.defineProperty(selection, 'presetId', { enumerable: true, get: getter });
    Object.defineProperty(selection, 'liquidReserveBasisPoints', {
      enumerable: true,
      value: 3_000,
    });
    const requestFetch = vi.fn<typeof fetch>();
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });

    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, selection as never),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing reserve', { kind: 'PRESET', presetId: 'BALANCED' }],
    [
      'unexpected field',
      {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
        filters: {},
      },
    ],
    ['negative reserve', { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: -1 }],
    [
      'reserve above 95 percent',
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 9_501 },
    ],
    [
      'fractional basis points',
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 3_000.5 },
    ],
  ])('rejects %s before fetch', async (_case, selection) => {
    const requestFetch = vi.fn<typeof fetch>();
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });

    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, selection as never),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('accepts both inclusive reserve boundaries in the closed selection contract', () => {
    expect(
      validateLocalDemoAllocationSelection({
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 0,
      }),
    ).toEqual({ kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 0 });
    expect(
      validateLocalDemoAllocationSelection({
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 9_500,
      }),
    ).toEqual({ kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 9_500 });
  });

  it('binds previews to a canonical portfolio snapshot and maps only the exact change conflict', async () => {
    const requestFetch = vi.fn<typeof fetch>();
    const invalidClient = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });
    await expect(
      invalidClient.previewAllocation('invalid snapshot id', {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(requestFetch).not.toHaveBeenCalled();

    const mismatched = {
      ...structuredClone(BALANCED_PREVIEW),
      portfolioSnapshotId: 'different-portfolio-snapshot',
    };
    const mismatchClient = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(mismatched)),
    });
    await expect(
      mismatchClient.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const reserveMismatchClient = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(BALANCED_PREVIEW)),
    });
    await expect(
      reserveMismatchClient.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_500,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const exactConflict = {
      statusCode: 409,
      error: 'Conflict',
      message: 'The local demo portfolio changed; refresh and retry',
      code: 'PORTFOLIO_SNAPSHOT_CHANGED',
    };
    const conflictClient = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(exactConflict, 409)),
    });
    await expect(
      conflictClient.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_SNAPSHOT_CHANGED' });

    const malformedConflictClient = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json({ ...exactConflict, detail: 'unexpected' }, 409)),
    });
    await expect(
      malformedConflictClient.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('maps only the exact bounded 422 body to a no-match result', async () => {
    const exactNoMatch = {
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'The managed yield strategy is unavailable for this snapshot',
      code: 'NO_MATCHING_YIELD_OPPORTUNITIES',
    };
    const exactClient = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(exactNoMatch, 422)),
    });
    await expect(
      exactClient.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).rejects.toMatchObject({ code: 'NO_MATCHING_YIELD_OPPORTUNITIES' });

    const malformedClient = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json({ ...exactNoMatch, debug: 'unexpected detail' }, 422)),
    });
    await expect(
      malformedClient.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('serializes closed allocation selections without consulting polluted toJSON hooks', async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(json(BALANCED_PREVIEW));
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');

    try {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value: () => ({ attackerControlled: true }),
      });
      Object.defineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        value: () => ['ATTACKER_CONTROLLED'],
      });
      await client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      });
    } finally {
      if (objectToJson === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Object.prototype, 'toJSON', objectToJson);
      if (arrayToJson === undefined) delete (Array.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Array.prototype, 'toJSON', arrayToJson);
    }

    expect(requestFetch.mock.calls.map(([, init]) => init?.body)).toEqual([
      `{"portfolioSnapshotId":"${PORTFOLIO_SNAPSHOT_ID}","selection":{"kind":"PRESET","presetId":"BALANCED","liquidReserveBasisPoints":3000}}`,
    ]);
  });

  it('fails closed when wallet registration does not return the contracted 201 status', async () => {
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(EVM_WALLET, 200)),
    });

    await expect(client.registerWallet('EVM')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('threads disconnect cancellation to fetch without translating the abort', async () => {
    const requestFetch = vi.fn(
      async (_path: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted === true) {
            reject(new DOMException('Request aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Request aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });
    const controller = new AbortController();

    const pending = client.disconnectWallet(EVM_WALLET.connectionId, controller.signal);
    expect(requestFetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('maps authentication and malformed data to fixed errors without retaining response detail', async () => {
    const unauthenticated = new LocalDemoApiClient({
      fetch: vi.fn(async () => json({ unsafe: 'session detail' }, 401)),
    });
    await expect(unauthenticated.listWallets()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
    });

    const malformed = new LocalDemoApiClient({
      fetch: vi.fn(async () => json([{ ...EVM_WALLET, privateKey: 'unsafe detail' }])),
    });
    const error = await malformed.listWallets().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LocalDemoApiError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(JSON.stringify(error)).not.toContain('unsafe detail');
  });

  it('rejects duplicate namespaces and invalid projection/address correlations', () => {
    expect(() =>
      parseLocalDemoWallets([
        EVM_WALLET,
        {
          ...EVM_WALLET,
          connectionId: SOLANA_WALLET.connectionId,
          walletId: SOLANA_WALLET.walletId,
        },
      ]),
    ).toThrow(LocalDemoApiError);
    expect(() => parseLocalDemoWallets([{ ...SOLANA_WALLET, chainId: 'eip155:11155111' }])).toThrow(
      LocalDemoApiError,
    );
    expect(() => parseLocalDemoWallets([{ ...EVM_WALLET, chainId: 'eip155:31338' }])).toThrow(
      LocalDemoApiError,
    );
    expect(() =>
      parseLocalDemoWallets([{ ...EVM_WALLET, chainId: LOCAL_DEMO_EVM_NETWORK_ID }]),
    ).toThrow(LocalDemoApiError);
    expect(() => parseLocalDemoWallets([{ ...EVM_WALLET, chainId: 'eip155:1' }])).toThrow(
      LocalDemoApiError,
    );
    expect(() =>
      parseLocalDemoWallets([
        { ...SOLANA_WALLET, chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
      ]),
    ).toThrow(LocalDemoApiError);
  });

  it('accepts the exact LOCAL chain and asset only at the guarded local-demo boundary', async () => {
    const controlled = structuredClone(LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD);
    const client = new LocalDemoApiClient({ fetch: vi.fn(async () => json(controlled)) });
    const portfolio = await client.readPortfolio();
    expect(portfolio).toMatchObject({
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
    });
    expect(portfolio.wallets[0]?.chains[0]).toMatchObject({
      networkId: LOCAL_DEMO_EVM_NETWORK_ID,
    });
    expect(portfolio.wallets[0]?.chains[0]?.assets[0]).toMatchObject({
      assetIdentity: LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY,
    });
    expect(() => parseUnifiedBalanceResponse(controlled)).toThrow();
    expect(() => parseLocalDemoPortfolioResponse(controlled)).not.toThrow();

    const unsafeClient = new LocalDemoApiClient({
      fetch: vi.fn(async () => json({ ...controlled, mayAuthorizeFinancialAction: true })),
    });
    await expect(unsafeClient.readPortfolio()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const unmarked = structuredClone(controlled);
    Reflect.deleteProperty(unmarked, 'use');
    Reflect.deleteProperty(unmarked, 'mayAuthorizeFinancialAction');
    const unmarkedClient = new LocalDemoApiClient({ fetch: vi.fn(async () => json(unmarked)) });
    await expect(unmarkedClient.readPortfolio()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it.each([
    ['network drift', { networkId: 'eip155:31338' }],
    ['asset drift', { assetIdentity: '0x0000000000000000000000000000000000000102' }],
    [
      'production identity substituted on LOCAL',
      { assetIdentity: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238' },
    ],
    [
      'production EVM source substituted',
      {
        networkId: 'eip155:11155111',
        assetIdentity: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
      },
    ],
  ] as const)('fails closed on LOCAL portfolio %s', async (_case, drift) => {
    const payload = structuredClone(LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD);
    const localWallet = payload.wallets[0]!;
    const localChain = localWallet.chains[0]!;
    const localAsset = localChain.assets[0]!;
    const driftedPayload = {
      ...payload,
      wallets: [
        {
          ...localWallet,
          chains: [
            {
              ...localChain,
              ...('networkId' in drift ? { networkId: drift.networkId } : {}),
              assets: [
                {
                  ...localAsset,
                  ...('assetIdentity' in drift ? { assetIdentity: drift.assetIdentity } : {}),
                },
              ],
            },
          ],
        },
        ...payload.wallets.slice(1),
      ],
    };
    const client = new LocalDemoApiClient({ fetch: vi.fn(async () => json(driftedPayload)) });

    await expect(client.readPortfolio()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
