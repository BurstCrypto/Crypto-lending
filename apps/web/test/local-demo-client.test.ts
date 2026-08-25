import { describe, expect, it, vi } from 'vitest';

import { UNIFIED_BALANCE_DEMO_PAYLOAD } from '../lib/portfolio/unified-balance.fixtures';
import {
  LOCAL_DEMO_ALLOCATION_PREVIEW_PATH,
  LocalDemoApiClient,
  LocalDemoApiError,
  LOCAL_DEMO_PORTFOLIO_PATH,
  LOCAL_DEMO_WALLETS_PATH,
  parseLocalDemoAllocationPreview,
  parseLocalDemoWallets,
} from '../lib/local-demo/local-demo-client';

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

const LOCAL_DEMO_PORTFOLIO = Object.freeze({
  ...UNIFIED_BALANCE_DEMO_PAYLOAD,
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
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
      amountUsdMinor: '330000',
    }),
    Object.freeze({
      bucket: 'CONSERVATIVE_YIELD',
      label: 'Conservative yield',
      percentageBasisPoints: 4500,
      amountUsdMinor: '495000',
    }),
    Object.freeze({
      bucket: 'BALANCED_YIELD',
      label: 'Balanced yield',
      percentageBasisPoints: 2500,
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
  asOf: '2026-08-24T18:30:00.000Z',
});

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
      .mockResolvedValueOnce(json(LOCAL_DEMO_PORTFOLIO));
    const client = new LocalDemoApiClient({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: requestFetch,
    });

    await expect(client.listWallets()).resolves.toHaveLength(2);
    await expect(client.registerWallet('EVM')).resolves.toEqual(EVM_WALLET);
    await expect(client.disconnectWallet(EVM_WALLET.connectionId)).resolves.toBeUndefined();
    await expect(client.readPortfolio()).resolves.toMatchObject({
      portfolioValueUsdMinor: '1100000',
      buyingPower: { amountUsdMinor: '750000' },
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
  });

  it('accepts only paired, non-authorizing local-demo portfolio controls', async () => {
    const controlled = structuredClone(LOCAL_DEMO_PORTFOLIO);
    const client = new LocalDemoApiClient({ fetch: vi.fn(async () => json(controlled)) });
    await expect(client.readPortfolio()).resolves.toMatchObject({
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
    });

    const unsafeClient = new LocalDemoApiClient({
      fetch: vi.fn(async () => json({ ...controlled, mayAuthorizeFinancialAction: true })),
    });
    await expect(unsafeClient.readPortfolio()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    const unmarkedClient = new LocalDemoApiClient({
      fetch: vi.fn(async () => json(UNIFIED_BALANCE_DEMO_PAYLOAD)),
    });
    await expect(unmarkedClient.readPortfolio()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
