import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '@/lib/authentication/http';
import {
  HttpMainnetWalletRosterClient,
  MAINNET_WALLET_ROSTER_PATH,
  MainnetWalletRosterError,
  parseMainnetWalletRosterResponse,
} from '@/lib/wallets/mainnet-wallet-roster-client';

const FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    walletId: '11111111-1111-4111-8111-111111111111',
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
});
