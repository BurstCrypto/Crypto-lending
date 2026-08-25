import { describe, expect, it, vi } from 'vitest';

import type {
  LocalDemoApiClient,
  LocalDemoWalletProjection,
} from '../lib/local-demo/local-demo-client';
import {
  LOCAL_DEMO_CONNECTOR_IDS,
  LocalDemoWalletAdapter,
  LocalDemoWalletAdapterError,
} from '../lib/wallets/local-demo-wallet-adapter';

const EVM_WALLET: LocalDemoWalletProjection = Object.freeze({
  connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  label: 'Synthetic EVM wallet',
  namespace: 'EVM',
  chainId: 'eip155:11155111',
  address: '0x1111111111111111111111111111111111111111',
  registeredAt: '2026-08-24T18:00:00.000Z',
});

function client(overrides: Partial<LocalDemoApiClient> = {}): LocalDemoApiClient {
  return {
    listWallets: vi.fn(),
    registerWallet: vi.fn(async () => EVM_WALLET),
    disconnectWallet: vi.fn(async () => undefined),
    readPortfolio: vi.fn(),
    ...overrides,
  } as unknown as LocalDemoApiClient;
}

describe('LocalDemoWalletAdapter', () => {
  it('normalizes a server-completed proof without retaining signing capability', async () => {
    const api = client();
    const adapter = new LocalDemoWalletAdapter('EVM', api);
    const connection = await adapter.connect();

    expect(connection).toMatchObject({
      connectionId: EVM_WALLET.connectionId,
      connectorId: LOCAL_DEMO_CONNECTOR_IDS.EVM,
      restored: false,
      selectedAccount: { chainId: EVM_WALLET.chainId, address: EVM_WALLET.address },
    });
    expect(connection.approvedScopes).toEqual([
      { chainId: EVM_WALLET.chainId, methods: [], events: [] },
    ]);
    expect(adapter.projectionFor(connection.connectionId)).toEqual(EVM_WALLET);
    await expect(
      adapter.signOwnershipChallenge(connection.connectionId, {
        id: 'never-signed-client-side',
        format: 'siwe',
        chainId: EVM_WALLET.chainId,
        address: EVM_WALLET.address,
        nonce: '12345678',
        expiresAt: '2026-08-24T18:05:00.000Z',
        message: 'server-completed proof',
      }),
    ).rejects.toBeInstanceOf(LocalDemoWalletAdapterError);
  });

  it('restores only the exact registered projection and disconnects it by application ID', async () => {
    const disconnectWallet = vi.fn(async () => undefined);
    const api = client({ disconnectWallet } as Partial<LocalDemoApiClient>);
    const adapter = new LocalDemoWalletAdapter('EVM', api, EVM_WALLET);

    await expect(adapter.restore()).resolves.toMatchObject({ restored: true });
    await adapter.disconnect(EVM_WALLET.connectionId);
    expect(disconnectWallet).toHaveBeenCalledWith(EVM_WALLET.connectionId, undefined);
    await expect(adapter.restore()).resolves.toBeNull();
  });

  it('threads cancellation to the same-origin disconnect request and retains uncertain state', async () => {
    const disconnectWallet = vi.fn(
      async (_connectionId: string, signal?: AbortSignal): Promise<void> =>
        new Promise((_resolve, reject) => {
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
    const adapter = new LocalDemoWalletAdapter(
      'EVM',
      client({ disconnectWallet } as Partial<LocalDemoApiClient>),
      EVM_WALLET,
    );
    const controller = new AbortController();

    const pending = adapter.disconnect(EVM_WALLET.connectionId, { signal: controller.signal });
    expect(disconnectWallet).toHaveBeenCalledWith(EVM_WALLET.connectionId, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(adapter.restore()).resolves.toBeNull();
  });

  it('does not revoke or call the API for a pre-aborted disconnect', async () => {
    const disconnectWallet = vi.fn(async () => undefined);
    const adapter = new LocalDemoWalletAdapter(
      'EVM',
      client({ disconnectWallet } as Partial<LocalDemoApiClient>),
      EVM_WALLET,
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.disconnect(EVM_WALLET.connectionId, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(disconnectWallet).not.toHaveBeenCalled();
    await expect(adapter.restore()).resolves.toMatchObject({ restored: true });
  });

  it('rejects a projection for the other namespace before it becomes adapter state', () => {
    expect(() => new LocalDemoWalletAdapter('SOLANA', client(), EVM_WALLET)).toThrow(
      LocalDemoWalletAdapterError,
    );
  });
});
