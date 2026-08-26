import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
  LocalDemoApiClient,
  LocalDemoApiError,
  LOCAL_DEMO_PORTFOLIO_PATH,
  LOCAL_DEMO_WALLETS_PATH,
  parseLocalDemoAllocationPreview,
  parseLocalDemoWallets,
} from '../lib/local-demo/local-demo-client';
import {
  LOCAL_DEMO_EVM_NETWORK_ID,
  LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY,
  parseLocalDemoPortfolioResponse,
} from '../lib/local-demo/local-demo-portfolio-response';
import { parseUnifiedBalanceResponse } from '../lib/portfolio/unified-balance';
import { LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD } from './local-demo-portfolio.fixtures';

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

const ALLOCATION_PREVIEW = Object.freeze({
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
  preset: Object.freeze({
    id: 'BALANCED',
    label: 'Balanced blend',
    description: 'Split capital between ready access and diversified synthetic yield.',
  }),
  grossCapitalUsdMinor: '1100000',
  allocations: Object.freeze([
    Object.freeze({
      bucket: 'LIQUID_RESERVE',
      label: 'Liquid reserve',
      percentageBasisPoints: 3000,
      apyBasisPoints: 0,
      amountUsdMinor: '330000',
    }),
    Object.freeze({
      bucket: 'CONSERVATIVE_YIELD',
      label: 'Conservative yield',
      percentageBasisPoints: 4500,
      apyBasisPoints: 400,
      amountUsdMinor: '495000',
    }),
    Object.freeze({
      bucket: 'BALANCED_YIELD',
      label: 'Balanced yield',
      percentageBasisPoints: 2500,
      apyBasisPoints: 600,
      amountUsdMinor: '275000',
    }),
  ]),
  deductions: Object.freeze([
    Object.freeze({ code: 'LIQUIDITY', amountUsdMinor: '3850' }),
    Object.freeze({ code: 'CONVERSION', amountUsdMinor: '770' }),
    Object.freeze({ code: 'SLIPPAGE', amountUsdMinor: '770' }),
    Object.freeze({ code: 'NETWORK', amountUsdMinor: '770' }),
    Object.freeze({ code: 'ROUTING', amountUsdMinor: '1540' }),
  ]),
  totalFeesUsdMinor: '7700',
  netPlannedCapitalUsdMinor: '1092300',
  yieldProjection: Object.freeze({
    source: 'SYNTHETIC_FIXED_DEMO_RATES',
    calculationMethod: 'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL',
    effectiveApyBasisPoints: 330,
    projectedAnnualYieldUsdMinor: '36045',
    projectedAnnualNetGrowthUsdMinor: '28345',
    breakEven: Object.freeze({ status: 'AVAILABLE', firstNetPositiveDay: 78 }),
  }),
  asOf: '2026-08-24T18:30:00.000Z',
});
function positiveYieldZeroFeeAllocationPreview(): unknown {
  const allocationAmounts = ['30', '45', '25'] as const;
  return {
    ...ALLOCATION_PREVIEW,
    grossCapitalUsdMinor: '100',
    allocations: ALLOCATION_PREVIEW.allocations.map((allocation, index) => ({
      ...allocation,
      amountUsdMinor: allocationAmounts[index],
    })),
    deductions: ALLOCATION_PREVIEW.deductions.map((deduction) => ({
      ...deduction,
      amountUsdMinor: '0',
    })),
    totalFeesUsdMinor: '0',
    netPlannedCapitalUsdMinor: '100',
    yieldProjection: {
      ...ALLOCATION_PREVIEW.yieldProjection,
      projectedAnnualYieldUsdMinor: '3',
      projectedAnnualNetGrowthUsdMinor: '3',
      breakEven: { status: 'AVAILABLE', firstNetPositiveDay: 111 },
    },
  };
}

function zeroCapitalAllocationPreview(): unknown {
  return {
    ...ALLOCATION_PREVIEW,
    grossCapitalUsdMinor: '0',
    allocations: ALLOCATION_PREVIEW.allocations.map((allocation) => ({
      ...allocation,
      amountUsdMinor: '0',
    })),
    deductions: ALLOCATION_PREVIEW.deductions.map((deduction) => ({
      ...deduction,
      amountUsdMinor: '0',
    })),
    totalFeesUsdMinor: '0',
    netPlannedCapitalUsdMinor: '0',
    yieldProjection: {
      ...ALLOCATION_PREVIEW.yieldProjection,
      projectedAnnualYieldUsdMinor: '0',
      projectedAnnualNetGrowthUsdMinor: '0',
      breakEven: { status: 'NOT_APPLICABLE', firstNetPositiveDay: null },
    },
  };
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

  it('requires the session CSRF proof before either unsafe request is attempted', async () => {
    const requestFetch = vi.fn<typeof fetch>();
    const client = new LocalDemoApiClient({ cookieHeader: '', fetch: requestFetch });

    await expect(client.registerWallet('SOLANA')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(client.disconnectWallet(SOLANA_WALLET.connectionId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(client.previewAllocation('BALANCED')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('previews one closed allocation preset through a fixed CSRF-protected relative path', async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(json(ALLOCATION_PREVIEW));
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });

    await expect(client.previewAllocation('BALANCED')).resolves.toEqual(ALLOCATION_PREVIEW);
    expect(requestFetch).toHaveBeenCalledWith(
      LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ presetId: 'BALANCED' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': CSRF,
        }),
      }),
    );
  });

  it('rejects allocation previews with untrusted labels, arithmetic, or a different preset', async () => {
    expect(() =>
      parseLocalDemoAllocationPreview({
        ...structuredClone(ALLOCATION_PREVIEW),
        preset: { ...ALLOCATION_PREVIEW.preset, label: 'Unsafe server label' },
      }),
    ).toThrow(LocalDemoApiError);
    expect(() =>
      parseLocalDemoAllocationPreview({
        ...structuredClone(ALLOCATION_PREVIEW),
        netPlannedCapitalUsdMinor: '1092301',
      }),
    ).toThrow(LocalDemoApiError);
    const internallyReconciledButForgedFees = structuredClone(ALLOCATION_PREVIEW) as unknown as {
      deductions: Array<{ amountUsdMinor: string }>;
      totalFeesUsdMinor: string;
      netPlannedCapitalUsdMinor: string;
    };
    internallyReconciledButForgedFees.deductions[0]!.amountUsdMinor = '3851';
    internallyReconciledButForgedFees.totalFeesUsdMinor = '7701';
    internallyReconciledButForgedFees.netPlannedCapitalUsdMinor = '1092299';
    expect(() => parseLocalDemoAllocationPreview(internallyReconciledButForgedFees)).toThrow(
      LocalDemoApiError,
    );

    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: vi.fn(async () => json(ALLOCATION_PREVIEW)),
    });
    await expect(client.previewAllocation('MORE_LIQUID')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('recomputes fixed APY, annual growth, and break-even timing with integer arithmetic', () => {
    const forgedPoolApy = {
      ...structuredClone(ALLOCATION_PREVIEW),
      allocations: ALLOCATION_PREVIEW.allocations.map((allocation, index) => ({
        ...allocation,
        ...(index === 1 ? { apyBasisPoints: 401 } : {}),
      })),
    };
    expect(() => parseLocalDemoAllocationPreview(forgedPoolApy)).toThrow(LocalDemoApiError);

    const forgedAnnualProjection = {
      ...structuredClone(ALLOCATION_PREVIEW),
      yieldProjection: {
        ...ALLOCATION_PREVIEW.yieldProjection,
        projectedAnnualYieldUsdMinor: '36046',
        projectedAnnualNetGrowthUsdMinor: '28346',
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedAnnualProjection)).toThrow(
      LocalDemoApiError,
    );

    const forgedBreakEven = {
      ...structuredClone(ALLOCATION_PREVIEW),
      yieldProjection: {
        ...ALLOCATION_PREVIEW.yieldProjection,
        breakEven: { status: 'AVAILABLE', firstNetPositiveDay: 77 },
      },
    };
    expect(() => parseLocalDemoAllocationPreview(forgedBreakEven)).toThrow(LocalDemoApiError);
  });

  it('uses the exact positive-yield day with no fees and reserves not-applicable for zero yield', () => {
    const positiveYieldNoFee = positiveYieldZeroFeeAllocationPreview();
    expect(parseLocalDemoAllocationPreview(positiveYieldNoFee)).toMatchObject({
      totalFeesUsdMinor: '0',
      yieldProjection: {
        projectedAnnualYieldUsdMinor: '3',
        breakEven: { status: 'AVAILABLE', firstNetPositiveDay: 111 },
      },
    });

    const forgedNotApplicable = structuredClone(positiveYieldNoFee) as {
      yieldProjection: { breakEven: { status: string; firstNetPositiveDay: number | null } };
    };
    forgedNotApplicable.yieldProjection.breakEven = {
      status: 'NOT_APPLICABLE',
      firstNetPositiveDay: null,
    };
    expect(() => parseLocalDemoAllocationPreview(forgedNotApplicable)).toThrow(LocalDemoApiError);

    expect(parseLocalDemoAllocationPreview(zeroCapitalAllocationPreview())).toMatchObject({
      totalFeesUsdMinor: '0',
      yieldProjection: {
        breakEven: { status: 'NOT_APPLICABLE', firstNetPositiveDay: null },
      },
    });

    const unavailable = structuredClone(zeroCapitalAllocationPreview()) as {
      yieldProjection: { breakEven: { status: string; firstNetPositiveDay: number | null } };
    };
    unavailable.yieldProjection.breakEven.status = 'UNAVAILABLE';
    expect(() => parseLocalDemoAllocationPreview(unavailable)).toThrow(LocalDemoApiError);
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
