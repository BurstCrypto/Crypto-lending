import { describe, expect, it, vi } from 'vitest';

import type { LocalDemoApiClient, LocalDemoWalletProjection } from '../lib/local-demo/local-demo-client';
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
    expect(disconnectWallet).toHaveBeenCalledWith(EVM_WALLET.connectionId);
    await expect(adapter.restore()).resolves.toBeNull();
  });

  it('rejects a projection for the other namespace before it becomes adapter state', () => {
    expect(
      () => new LocalDemoWalletAdapter('SOLANA', client(), EVM_WALLET),
    ).toThrow(LocalDemoWalletAdapterError);
  });
});
