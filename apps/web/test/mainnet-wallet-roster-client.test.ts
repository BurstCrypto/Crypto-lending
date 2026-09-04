import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '@/lib/authentication/http';
import { API_REQUEST_TIMEOUT_MILLISECONDS } from '@/lib/http/bounded-response';
import {
  HttpMainnetWalletRosterClient,
  MAINNET_WALLET_ROSTER_PATH,
  MainnetWalletRosterError,
  parseMainnetWalletRosterResponse,
} from '@/lib/wallets/mainnet-wallet-roster-client';

const FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const CSRF_TOKEN = 'c'.repeat(43);
const WALLET_ID = '11111111-1111-4111-8111-111111111111';

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    walletId: WALLET_ID,
    chainId: 'eip155:1',
    address: '0x1111111111111111111111111111111111111111',
    registeredAt: '2026-09-02T12:00:00.000Z',
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: FINGERPRINT,
    ...overrides,
  };
}

function response(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

afterEach(() => vi.useRealTimers());

describe('mainnet wallet roster response', () => {
  it('retains only masked, chain-qualified summaries for supported mainnet wallets', () => {
    const rawAddress = '0x1111111111111111111111111111111111111111';
    const parsed = parseMainnetWalletRosterResponse({ version: 1, wallets: [wallet()] });

    expect(parsed.wallets).toEqual([
      {
        walletId: '11111111-1111-4111-8111-111111111111',
        chainId: 'eip155:1',
        addressHint: '0x111111…111111',
        registeredAt: '2026-09-02T12:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain(rawAddress);
  });

  it.each([
    ['removed Base mainnet chain', wallet({ chainId: 'eip155:8453' })],
    ['testnet chain', wallet({ chainId: 'eip155:11155111' })],
    ['noncanonical EVM address', wallet({ address: '0x' + 'A'.repeat(40) })],
    ['wrong registry', wallet({ registryFingerprintSha256: 'a'.repeat(64) })],
  ])('rejects a %s', (_label, entry) => {
    expect(() => parseMainnetWalletRosterResponse({ version: 1, wallets: [entry] })).toThrow(
      MainnetWalletRosterError,
    );
  });

  it('rejects duplicate chain accounts even when wallet IDs differ', () => {
    expect(() =>
      parseMainnetWalletRosterResponse({
        version: 1,
        wallets: [wallet(), wallet({ walletId: '22222222-2222-4222-8222-222222222222' })],
      }),
    ).toThrow(MainnetWalletRosterError);
  });
});

describe('HttpMainnetWalletRosterClient', () => {
  it('uses a private same-origin GET and parses the bounded response', async () => {
    const requestFetch = vi.fn(async () => response(200, { version: 1, wallets: [] }));
    const client = new HttpMainnetWalletRosterClient({
      fetch: requestFetch as AuthenticationFetch,
    });

    await expect(client.readWallets()).resolves.toEqual({ version: 1, wallets: [] });
    expect(requestFetch).toHaveBeenCalledWith(
      MAINNET_WALLET_ROSTER_PATH,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
      }),
    );
  });

  it('keeps authentication and temporary availability failures distinct', async () => {
    const unauthenticated = new HttpMainnetWalletRosterClient({
      fetch: vi.fn(async () => response(401, {})) as AuthenticationFetch,
    });
    await expect(unauthenticated.readWallets()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const unavailable = new HttpMainnetWalletRosterClient({
      fetch: vi.fn(async () => response(503, {}, { 'Retry-After': '30' })) as AuthenticationFetch,
    });
    await expect(unavailable.readWallets()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      retryAfterSeconds: 30,
    });
  });

  it('rejects a successful roster response with no body stream', async () => {
    const client = new HttpMainnetWalletRosterClient({
      fetch: async () =>
        new Response(null, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });

    await expect(client.readWallets()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('maps a stalled roster body deadline to unavailable', async () => {
    vi.useFakeTimers();
    const pendingPull = Promise.withResolvers<void>();
    const cancel = vi.fn(() => pendingPull.resolve());
    const stalled = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          return pendingPull.promise;
        },
        cancel,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const read = new HttpMainnetWalletRosterClient({
      fetch: async () => stalled,
    }).readWallets();
    const failure = expect(read).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MILLISECONDS);

    await failure;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes one canonical wallet with same-origin credentials and a CSRF proof', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(
      async () => new Response(null, { status: 204 }),
    );
    const client = new HttpMainnetWalletRosterClient({
      fetch: requestFetch,
      cookieHeader: `theme=dark; __Host-cl_csrf=${CSRF_TOKEN}`,
    });

    await expect(client.removeWallet(WALLET_ID)).resolves.toBeUndefined();
    expect(requestFetch).toHaveBeenCalledWith(`${MAINNET_WALLET_ROSTER_PATH}/${WALLET_ID}`, {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    const serializedCall = JSON.stringify(requestFetch.mock.calls);
    expect(serializedCall).not.toContain('Authorization');
    expect(serializedCall).not.toContain('__Host-cl_csrf');
  });

  it.each([
    ['missing', ''],
    ['malformed', '__Host-cl_csrf=short'],
    ['ambiguous', `__Host-cl_csrf=${CSRF_TOKEN}; __Host-cl_csrf=${CSRF_TOKEN}`],
  ])('does not send a DELETE with %s CSRF state', async (_label, cookieHeader) => {
    const requestFetch = vi.fn<AuthenticationFetch>();
    const client = new HttpMainnetWalletRosterClient({ fetch: requestFetch, cookieHeader });

    await expect(client.removeWallet(WALLET_ID)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'not-a-wallet-id',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    '../11111111-1111-4111-8111-111111111111',
  ])(
    'rejects a noncanonical wallet ID before reading cookies or fetching: %s',
    async (walletId) => {
      const cookieHeader = vi.fn(() => `__Host-cl_csrf=${CSRF_TOKEN}`);
      const requestFetch = vi.fn<AuthenticationFetch>();
      const client = new HttpMainnetWalletRosterClient({ fetch: requestFetch, cookieHeader });

      await expect(client.removeWallet(walletId)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      expect(cookieHeader).not.toHaveBeenCalled();
      expect(requestFetch).not.toHaveBeenCalled();
    },
  );

  it('keeps removal authentication and temporary failures generic', async () => {
    const unauthenticated = new HttpMainnetWalletRosterClient({
      fetch: vi.fn(async () => response(401, { internal: 'not exposed' })) as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    });
    await expect(unauthenticated.removeWallet(WALLET_ID)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
    });

    const unavailable = new HttpMainnetWalletRosterClient({
      fetch: vi.fn(async () =>
        response(503, { internal: 'not exposed' }, { 'Retry-After': '1' }),
      ) as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    });
    await expect(unavailable.removeWallet(WALLET_ID)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Wallet list unavailable.',
      retryAfterSeconds: 1,
    });
  });

  it.each([200, 400, 403, 404, 409, 500])(
    'accepts only 204 as a confirmed removal, not %i',
    async (status) => {
      const client = new HttpMainnetWalletRosterClient({
        fetch: vi.fn(async () =>
          response(status, { internal: 'not exposed' }),
        ) as AuthenticationFetch,
        cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
      });

      await expect(client.removeWallet(WALLET_ID)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    },
  );

  it('preserves aborts and maps other transport failures to a generic unavailable error', async () => {
    const controller = new AbortController();
    const aborted = new DOMException('Request aborted', 'AbortError');
    const abortingClient = new HttpMainnetWalletRosterClient({
      fetch: vi.fn(async () => Promise.reject(aborted)) as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    });
    await expect(abortingClient.removeWallet(WALLET_ID, controller.signal)).rejects.toBe(aborted);

    const unavailableClient = new HttpMainnetWalletRosterClient({
      fetch: vi.fn(async () =>
        Promise.reject(new Error('private transport details')),
      ) as AuthenticationFetch,
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    });
    await expect(unavailableClient.removeWallet(WALLET_ID)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Wallet list unavailable.',
    });
  });

  it('times out an abort-ignorant removal and never accepts its late 204', async () => {
    vi.useFakeTimers();
    const lateResponse = Promise.withResolvers<Response>();
    let requestSignal: AbortSignal | undefined;
    const client = new HttpMainnetWalletRosterClient({
      fetch: async (_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return lateResponse.promise;
      },
      cookieHeader: `__Host-cl_csrf=${CSRF_TOKEN}`,
    });
    const removal = client.removeWallet(WALLET_ID);
    const failure = expect(removal).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MILLISECONDS);
    await failure;

    expect(requestSignal?.aborted).toBe(true);
    lateResponse.resolve(new Response(null, { status: 204 }));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
