import { describe, expect, it, vi } from 'vitest';

import {
  INJECTED_EVM_ERROR_CODES,
  InjectedEip1193WalletAdapter,
} from '@/lib/wallets/eip1193/adapter';
import type { InjectedProviderDescriptor } from '@/lib/wallets/eip1193/discovery';
import type {
  Eip1193Listener,
  Eip1193Provider,
  Eip1193RequestArguments,
} from '@/lib/wallets/eip1193/provider';
import type { SiweOwnershipChallenge, WalletEvent } from '@/lib/wallets/wallet-adapter';

import { KAN61_EVM_TESTNET_CATALOG } from './eip1193-network-catalog.fixture';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const SECOND_ADDRESS = '0x2222222222222222222222222222222222222222';
const SIGNATURE = `0x${'AB'.repeat(65)}`;

class FakeProvider implements Eip1193Provider {
  chainId = '0xaa36a7';
  accounts: string[] = [ADDRESS];
  readonly listeners = new Map<string, Set<Eip1193Listener>>();
  readonly handlers = new Map<string, (arguments_: Eip1193RequestArguments) => Promise<unknown>>();

  readonly request = vi.fn(async (arguments_: Eip1193RequestArguments): Promise<unknown> => {
    const handler = this.handlers.get(arguments_.method);
    if (handler !== undefined) return handler(arguments_);
    switch (arguments_.method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [...this.accounts];
      case 'eth_chainId':
        return this.chainId;
      case 'personal_sign':
        return SIGNATURE;
      default:
        throw { code: 4200, message: 'unapproved method detail' };
    }
  });

  readonly on = vi.fn((event: string, listener: Eip1193Listener): void => {
    const listeners = this.listeners.get(event) ?? new Set<Eip1193Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  });

  readonly removeListener = vi.fn((event: string, listener: Eip1193Listener): void => {
    this.listeners.get(event)?.delete(listener);
  });

  emit(event: string, ...arguments_: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...arguments_);
  }
}

function descriptor(connectorId: 'metamask' | 'coinbase' = 'metamask'): InjectedProviderDescriptor {
  return Object.freeze({
    selectionId: `selection-${connectorId}`,
    connectorId,
    displayName: connectorId === 'metamask' ? 'MetaMask' : 'Coinbase Wallet',
    supportedNetworks: KAN61_EVM_TESTNET_CATALOG,
  });
}

function adapter(
  provider: FakeProvider,
  connectorId: 'metamask' | 'coinbase' = 'metamask',
): InjectedEip1193WalletAdapter {
  return new InjectedEip1193WalletAdapter({
    selection: { descriptor: descriptor(connectorId), provider },
    createConnectionId: () => `connection-${connectorId}`,
    now: () => new Date('2026-08-24T12:00:00.000Z'),
  });
}

function challenge(overrides: Partial<SiweOwnershipChallenge> = {}): SiweOwnershipChallenge {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    format: 'siwe',
    chainId: 'eip155:11155111',
    address: ADDRESS,
    nonce: 'AbCdEf123456',
    expiresAt: '2026-08-24T12:05:00.000Z',
    message: 'exact server-authored SIWE message',
    ...overrides,
  };
}

describe('InjectedEip1193WalletAdapter connection state', () => {
  it('normalizes an explicit MetaMask selection and prevents duplicate connections', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);

    const connected = await wallet.connect();
    const repeated = await wallet.connect();

    expect(repeated).toBe(connected);
    expect(connected).toEqual({
      connectionId: 'connection-metamask',
      connectorId: 'metamask',
      accounts: [{ chainId: 'eip155:11155111', address: ADDRESS }],
      approvedScopes: [
        {
          chainId: 'eip155:11155111',
          methods: ['personal_sign'],
          events: ['accountsChanged', 'chainChanged', 'disconnect'],
        },
      ],
      selectedAccount: { chainId: 'eip155:11155111', address: ADDRESS },
      restored: false,
    });
    expect(
      provider.request.mock.calls.filter(([request]) => request.method === 'eth_requestAccounts'),
    ).toHaveLength(1);
  });

  it('keeps MetaMask and Coinbase capabilities independent', async () => {
    const metamaskProvider = new FakeProvider();
    const coinbaseProvider = new FakeProvider();
    coinbaseProvider.accounts = [SECOND_ADDRESS];

    const metamask = await adapter(metamaskProvider, 'metamask').connect();
    const coinbase = await adapter(coinbaseProvider, 'coinbase').connect();

    expect(metamask.connectorId).toBe('metamask');
    expect(metamask.selectedAccount.address).toBe(ADDRESS);
    expect(coinbase.connectorId).toBe('coinbase');
    expect(coinbase.selectedAccount.address).toBe(SECOND_ADDRESS);
    expect(metamaskProvider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.arrayContaining([SECOND_ADDRESS]) }),
    );
  });

  it('requires an explicit authorized account selection without switching the provider', async () => {
    const provider = new FakeProvider();
    provider.accounts = [ADDRESS, SECOND_ADDRESS];
    const wallet = adapter(provider);
    const connected = await wallet.connect();

    const selected = wallet.selectAccount(
      connected.connectionId,
      `0x${SECOND_ADDRESS.slice(2).toUpperCase()}`,
    );

    expect(selected.selectedAccount).toEqual({
      chainId: 'eip155:11155111',
      address: SECOND_ADDRESS,
    });
    expect(wallet.currentConnection()).toBe(selected);
    expect(
      provider.request.mock.calls.some(([request]) =>
        ['wallet_switchEthereumChain', 'wallet_addEthereumChain'].includes(request.method),
      ),
    ).toBe(false);
    expect(() => wallet.selectAccount(connected.connectionId, `0x${'3'.repeat(40)}`)).toThrow(
      expect.objectContaining({ code: INJECTED_EVM_ERROR_CODES.accountUnavailable }),
    );
  });

  it('restores non-interactively, returns null without accounts, and blocks unsupported networks', async () => {
    const restoredProvider = new FakeProvider();
    const restored = await adapter(restoredProvider).restore();
    expect(restored).toMatchObject({ restored: true, connectorId: 'metamask' });
    expect(
      restoredProvider.request.mock.calls.some(
        ([request]) => request.method === 'eth_requestAccounts',
      ),
    ).toBe(false);

    const emptyProvider = new FakeProvider();
    emptyProvider.accounts = [];
    await expect(adapter(emptyProvider).restore()).resolves.toBeNull();

    const unsupportedProvider = new FakeProvider();
    unsupportedProvider.chainId = '0x1';
    await expect(adapter(unsupportedProvider).connect()).rejects.toMatchObject({
      code: INJECTED_EVM_ERROR_CODES.unsupportedNetwork,
      message: 'Injected wallet network is unsupported',
    });
    expect(
      unsupportedProvider.request.mock.calls.some(
        ([request]) => request.method === 'eth_requestAccounts',
      ),
    ).toBe(false);
  });

  it('rejects a second operation while one permission request is pending', async () => {
    const provider = new FakeProvider();
    let release!: (accounts: readonly string[]) => void;
    provider.handlers.set(
      'eth_requestAccounts',
      () => new Promise((resolve) => (release = resolve)),
    );
    const wallet = adapter(provider);
    const first = wallet.connect();

    await expect(wallet.connect()).rejects.toMatchObject({
      code: INJECTED_EVM_ERROR_CODES.operationPending,
    });
    release([ADDRESS]);
    await expect(first).resolves.toMatchObject({ connectionId: 'connection-metamask' });
  });

  it('does not silently replace the account returned by the permission gesture', async () => {
    const provider = new FakeProvider();
    provider.handlers.set('eth_requestAccounts', async () => {
      provider.accounts = [SECOND_ADDRESS];
      return [ADDRESS];
    });

    await expect(adapter(provider).connect()).rejects.toMatchObject({
      code: INJECTED_EVM_ERROR_CODES.connectionChanged,
    });
  });

  it('honors pre-aborted operations without invoking the provider', async () => {
    const provider = new FakeProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(adapter(provider).connect({ signal: controller.signal })).rejects.toMatchObject({
      code: INJECTED_EVM_ERROR_CODES.aborted,
    });
    expect(provider.request).not.toHaveBeenCalled();
  });
});

describe('InjectedEip1193WalletAdapter ownership signing', () => {
  it('signs only the exact server challenge and returns a KAN-56-compatible signature', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const issued = challenge();

    const signature = await wallet.signOwnershipChallenge(connection.connectionId, issued);

    expect(provider.request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: [issued.message, issued.address],
    });
    expect(signature).toEqual({
      format: 'siwe',
      challengeId: issued.id,
      chainId: issued.chainId,
      address: issued.address,
      signature: SIGNATURE.toLowerCase(),
    });
    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, issued),
    ).rejects.toMatchObject({ code: INJECTED_EVM_ERROR_CODES.challengeReused });
    expect(
      provider.request.mock.calls.filter(([request]) => request.method === 'personal_sign'),
    ).toHaveLength(1);
  });

  it('rejects wrong account, wrong chain, expired, and malformed provider results', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();

    await expect(
      wallet.signOwnershipChallenge(
        connection.connectionId,
        challenge({ address: SECOND_ADDRESS }),
      ),
    ).rejects.toMatchObject({ code: INJECTED_EVM_ERROR_CODES.challengeInvalid });
    await expect(
      wallet.signOwnershipChallenge(
        connection.connectionId,
        challenge({ chainId: 'eip155:84532' }),
      ),
    ).rejects.toMatchObject({ code: INJECTED_EVM_ERROR_CODES.challengeInvalid });
    await expect(
      wallet.signOwnershipChallenge(
        connection.connectionId,
        challenge({ expiresAt: '2026-08-24T11:59:59.000Z' }),
      ),
    ).rejects.toMatchObject({ code: INJECTED_EVM_ERROR_CODES.challengeInvalid });

    provider.handlers.set('personal_sign', async () => 'not-a-signature');
    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, challenge()),
    ).rejects.toMatchObject({ code: INJECTED_EVM_ERROR_CODES.malformedResponse });
  });

  it('fails closed when account state changes during signing', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    provider.handlers.set('personal_sign', async () => {
      provider.accounts = [SECOND_ADDRESS];
      provider.emit('accountsChanged', [SECOND_ADDRESS]);
      return SIGNATURE;
    });

    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, challenge()),
    ).rejects.toMatchObject({ code: INJECTED_EVM_ERROR_CODES.connectionChanged });
    expect(wallet.currentConnection()).toBeNull();
  });

  it('invalidates silent account drift detected after signing', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const events: WalletEvent[] = [];
    wallet.subscribe((event) => events.push(event));
    provider.handlers.set('personal_sign', async () => {
      provider.accounts = [SECOND_ADDRESS];
      return SIGNATURE;
    });

    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, challenge()),
    ).rejects.toMatchObject({ code: INJECTED_EVM_ERROR_CODES.connectionChanged });
    expect(wallet.currentConnection()).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        type: 'disconnect',
        error: expect.objectContaining({ code: INJECTED_EVM_ERROR_CODES.connectionChanged }),
      }),
    ]);
  });

  it('maps provider rejection to fixed redacted errors', async () => {
    const provider = new FakeProvider();
    const secret = 'seed phrase and session identifier';
    provider.handlers.set('eth_requestAccounts', async () => {
      throw { code: 4001, message: secret, data: { session: secret } };
    });

    const rejection = await adapter(provider)
      .connect()
      .catch((error: unknown) => error);
    expect(rejection).toMatchObject({
      code: INJECTED_EVM_ERROR_CODES.userRejected,
      message: 'Injected wallet request was rejected',
      recoverable: true,
    });
    expect(JSON.stringify(rejection)).not.toContain(secret);
    expect(rejection).not.toHaveProperty('cause');
  });
});

describe('InjectedEip1193WalletAdapter invalidation and cleanup', () => {
  it('invalidates on account changes and contains consumer exceptions', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const events: WalletEvent[] = [];
    wallet.subscribe(() => {
      throw new Error('consumer failure');
    });
    wallet.subscribe((event) => events.push(event));

    provider.accounts = [SECOND_ADDRESS];
    expect(() => provider.emit('accountsChanged', [SECOND_ADDRESS])).not.toThrow();

    expect(wallet.currentConnection()).toBeNull();
    expect(events).toEqual([
      {
        type: 'accountsChanged',
        connectionId: connection.connectionId,
        connectorId: 'metamask',
        connection: null,
      },
    ]);
  });

  it('updates supported chains but disconnects fail-closed on unsupported chain events', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    await wallet.connect();
    const events: WalletEvent[] = [];
    wallet.subscribe((event) => events.push(event));

    provider.chainId = '0x14a34';
    provider.emit('chainChanged', '0x14a34');
    expect(wallet.currentConnection()?.selectedAccount.chainId).toBe('eip155:84532');
    expect(events[0]).toMatchObject({
      type: 'chainChanged',
      connection: { selectedAccount: { chainId: 'eip155:84532' } },
    });

    provider.chainId = '0x1';
    provider.emit('chainChanged', '0x1');
    expect(wallet.currentConnection()).toBeNull();
    expect(events[1]).toMatchObject({
      type: 'disconnect',
      error: {
        code: INJECTED_EVM_ERROR_CODES.unsupportedNetwork,
        message: 'Injected wallet network is unsupported',
      },
    });
  });

  it('redacts disconnect details and removes the exact provider listeners', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    await wallet.connect();
    const events: WalletEvent[] = [];
    wallet.subscribe((event) => events.push(event));

    provider.emit('disconnect', { code: 4900, message: 'secret provider transport' });
    expect(events[0]).toMatchObject({
      type: 'disconnect',
      error: {
        code: INJECTED_EVM_ERROR_CODES.providerDisconnected,
        message: 'Injected wallet provider disconnected',
      },
    });
    expect(JSON.stringify(events)).not.toContain('secret provider transport');

    const attached = provider.on.mock.calls.map(([event, listener]) => [event, listener]);
    wallet.dispose();
    expect(provider.removeListener.mock.calls).toEqual(attached);
    expect([...provider.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('disconnects only the exact normalized connection and makes repeat cleanup idempotent', async () => {
    const provider = new FakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();

    await expect(wallet.disconnect('another-connection')).rejects.toMatchObject({
      code: INJECTED_EVM_ERROR_CODES.connectionMismatch,
    });
    await wallet.disconnect(connection.connectionId);
    await expect(wallet.disconnect(connection.connectionId)).resolves.toBeUndefined();
    expect(
      provider.request.mock.calls.some(([request]) => request.method.includes('disconnect')),
    ).toBe(false);
  });

  it('never reuses an older application connection identity', async () => {
    const provider = new FakeProvider();
    const connectionIds = ['connection-a', 'connection-b', 'connection-a'];
    const wallet = new InjectedEip1193WalletAdapter({
      selection: { descriptor: descriptor(), provider },
      createConnectionId: () => connectionIds.shift() ?? 'connection-fallback',
    });

    const first = await wallet.connect();
    await wallet.disconnect(first.connectionId);
    const second = await wallet.connect();
    await wallet.disconnect(second.connectionId);

    await expect(wallet.connect()).rejects.toMatchObject({
      code: INJECTED_EVM_ERROR_CODES.providerFailure,
    });
    expect(wallet.currentConnection()).toBeNull();
  });
});
