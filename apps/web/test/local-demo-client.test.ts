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
} from '../lib/local-demo/local-demo-yield';
import { parseUnifiedBalanceResponse } from '../lib/portfolio/unified-balance';
import { LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD } from './local-demo-portfolio.fixtures';
import {
  BALANCED_PREVIEW,
  CROSS_CHAIN_BALANCED_PREVIEW,
  LOCAL_DEMO_YIELD_CATALOG,
  MORE_YIELD_DAY_365_PREVIEW,
  MORE_LIQUID_PREVIEW,
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

function expectProviderPrivate(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(
    /morpho|api\.morpho|eip155:(?:1|8453)|0x[0-9a-f]{40,64}|"(?:provider|protocol|marketId|opportunity|provenance|sourceReference|payloadSha256|normalizerId)"/iu,
  );
}

describe('local demo same-origin API client', () => {
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
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, { kind: 'PRESET', presetId: 'BALANCED' }),
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
    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, { kind: 'PRESET', presetId: 'BALANCED' }),
    ).resolves.toEqual(BALANCED_PREVIEW);
    await expect(
      client.previewAllocation(PORTFOLIO_SNAPSHOT_ID, {
        kind: 'PRESET',
        presetId: 'MORE_LIQUID',
      }),
    ).resolves.toEqual(MORE_LIQUID_PREVIEW);
    expectProviderPrivate(LOCAL_DEMO_YIELD_CATALOG);
    expectProviderPrivate(BALANCED_PREVIEW);
    expectProviderPrivate(MORE_LIQUID_PREVIEW);
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
          selection: { kind: 'PRESET', presetId: 'BALANCED' },
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
          selection: { kind: 'PRESET', presetId: 'MORE_LIQUID' },
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
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('reconciles components, post-fee yield, allocation cents, and exact recovery timing', () => {
    expect(() => parseLocalDemoAllocationPreview(BALANCED_PREVIEW)).not.toThrow();
    expect(BALANCED_PREVIEW.executionCost.modeledScenario.components).toMatchObject([
      { code: 'NETWORK', amountUsdMinor: '438' },
      { code: 'CONVERSION', amountUsdMinor: '0' },
      { code: 'CROSS_ECOSYSTEM_TRANSFER', amountUsdMinor: '0' },
      { code: 'MARKET_IMPACT', amountUsdMinor: '115' },
      { code: 'ROUTING', amountUsdMinor: '60' },
    ]);
    expect(BALANCED_PREVIEW.executionCost.modeledScenario.totalUsdMinor).toBe('613');
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
      day: 10,
      modelHorizonDays: 365,
    });

    const forgedComponentTotal = {
      ...structuredClone(BALANCED_PREVIEW),
      executionCost: {
        ...BALANCED_PREVIEW.executionCost,
        modeledScenario: {
          ...BALANCED_PREVIEW.executionCost.modeledScenario,
          totalUsdMinor: '614',
        },
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedComponentTotal)).toThrow(TypeError);

    const forgedPostFeeYield = {
      ...structuredClone(BALANCED_PREVIEW),
      yieldProjection: {
        ...BALANCED_PREVIEW.yieldProjection,
        projectedAnnualYieldAfterFeesUsdMinor: '22361',
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedPostFeeYield)).toThrow(TypeError);

    const forgedRecoveryDay = {
      ...structuredClone(BALANCED_PREVIEW),
      yieldProjection: {
        ...BALANCED_PREVIEW.yieldProjection,
        firstPositiveDayAfterFees: {
          ...BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees,
          day: 11,
        },
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedRecoveryDay)).toThrow(TypeError);

    const shiftedAllocationAmounts = {
      ...structuredClone(BALANCED_PREVIEW),
      allocations: BALANCED_PREVIEW.allocations.map((allocation, index) => ({
        ...allocation,
        amountUsdMinor: index === 0 ? '209817' : '489570',
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

  it('reconciles provider-private native ecosystem sources, composition, and routing', () => {
    expect(() => parseLocalDemoAllocationPreview(CROSS_CHAIN_BALANCED_PREVIEW)).not.toThrow();
    expect(CROSS_CHAIN_BALANCED_PREVIEW.sourceCapitalByEcosystem).toEqual([
      { ecosystem: 'EVM', amountUsdMinor: '700000' },
      { ecosystem: 'SOLANA', amountUsdMinor: '400000' },
    ]);
    expect(CROSS_CHAIN_BALANCED_PREVIEW.managedYieldComposition).toMatchObject([
      { ecosystem: 'EVM', percentageBasisPointsOfManagedYield: 6_364 },
      { ecosystem: 'SOLANA', percentageBasisPointsOfManagedYield: 3_636 },
    ]);
    expect(CROSS_CHAIN_BALANCED_PREVIEW.compositionSummary).toEqual({
      mode: 'EVM_SOLANA_PORTFOLIO_BLEND',
      crossEcosystemTransferRequired: false,
      crossEcosystemTransferUsdMinor: '0',
      activeEcosystemCount: 2,
      activeAllocationCount: 3,
    });
    expectProviderPrivate(CROSS_CHAIN_BALANCED_PREVIEW);

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
        rows[1]!.percentageBasisPointsOfManagedYield = 3_635;
      },
      (candidate) => {
        const rows = candidate.managedYieldComposition as Array<Record<string, unknown>>;
        rows[1]!.amountUsdMinor = '279767';
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
        modeled.totalUsdMinor = '913';
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
    hiddenTransferComposition[0]!.amountUsdMinor = '369299';
    hiddenTransferComposition[0]!.percentageBasisPointsOfManagedYield = 4_800;
    hiddenTransferComposition[1]!.amountUsdMinor = '400001';
    hiddenTransferComposition[1]!.percentageBasisPointsOfManagedYield = 5_200;
    expect(() => parseLocalDemoAllocationPreview(transferHiddenAsNative)).toThrow(TypeError);

    const zeroSourceWithAllocation = structuredClone(BALANCED_PREVIEW) as unknown as Record<
      string,
      unknown
    >;
    const zeroSourceComposition = zeroSourceWithAllocation.managedYieldComposition as Array<
      Record<string, unknown>
    >;
    zeroSourceComposition[0]!.amountUsdMinor = '489570';
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
      });
    } finally {
      if (objectToJson === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Object.prototype, 'toJSON', objectToJson);
      if (arrayToJson === undefined) delete (Array.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Array.prototype, 'toJSON', arrayToJson);
    }

    expect(requestFetch.mock.calls.map(([, init]) => init?.body)).toEqual([
      `{"portfolioSnapshotId":"${PORTFOLIO_SNAPSHOT_ID}","selection":{"kind":"PRESET","presetId":"BALANCED"}}`,
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
