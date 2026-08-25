import { describe, expect, it, vi } from 'vitest';

import { UNIFIED_BALANCE_DEMO_PAYLOAD } from '../lib/portfolio/unified-balance.fixtures';
import {
  LocalDemoApiClient,
  LocalDemoApiError,
  LOCAL_DEMO_PORTFOLIO_PATH,
  LOCAL_DEMO_WALLETS_PATH,
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('local demo same-origin API client', () => {
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
    expect(requestFetch).not.toHaveBeenCalled();
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
    expect(() =>
      parseLocalDemoWallets([{ ...SOLANA_WALLET, chainId: 'eip155:11155111' }]),
    ).toThrow(LocalDemoApiError);
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
