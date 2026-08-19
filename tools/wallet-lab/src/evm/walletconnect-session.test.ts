import { describe, expect, it, vi } from 'vitest';

import { EVM_TESTNET_CHAIN_IDS } from './chains';
import {
  inspectWalletConnectSession,
  subscribeWalletConnectSessionLifecycle,
  subscribeWalletConnectSessionUpdates,
} from './walletconnect-session';

const address = '0xaabbccddeeff0011223344556677889900aabbcc';

function provider(
  overrides: Partial<{
    methods: string[];
    events: string[];
    chains: string[];
    accounts: string[];
  }> = {},
) {
  return {
    isWalletConnect: true,
    namespace: 'eip155',
    on: vi.fn(),
    off: vi.fn(),
    session: {
      namespaces: {
        eip155: {
          methods: ['personal_sign', 'wallet_switchEthereumChain'],
          events: ['accountsChanged', 'chainChanged'],
          chains: ['eip155:11155111', 'eip155:84532'],
          accounts: [`eip155:11155111:${address}`, `eip155:84532:${address}`],
          ...overrides,
        },
      },
    },
  };
}

const expected = { chainId: EVM_TESTNET_CHAIN_IDS.sepolia, address } as const;

describe('inspectWalletConnectSession', () => {
  it('accepts the selected account only within the two testnet scopes', () => {
    expect(inspectWalletConnectSession(provider(), expected)).toEqual({
      accepted: true,
      canSwitchChain: true,
    });
  });

  it('normalizes a standards-valid scoped namespace key', () => {
    const candidate = provider();
    candidate.session.namespaces = {
      'eip155:11155111': {
        methods: ['personal_sign'],
        events: ['accountsChanged'],
        chains: [],
        accounts: [`eip155:11155111:${address}`],
      },
    } as unknown as typeof candidate.session.namespaces;
    expect(inspectWalletConnectSession(candidate, expected)).toEqual({
      accepted: true,
      canSwitchChain: false,
    });
  });

  it('does not combine an account and signing permission from different scopes', () => {
    const candidate = provider();
    candidate.session.namespaces = {
      eip155: {
        methods: ['wallet_switchEthereumChain'],
        events: ['accountsChanged'],
        chains: ['eip155:11155111'],
        accounts: [`eip155:11155111:${address}`],
      },
      'eip155:11155111': {
        methods: ['personal_sign'],
        events: ['accountsChanged'],
        chains: [],
        accounts: ['eip155:11155111:0x1111111111111111111111111111111111111111'],
      },
    } as typeof candidate.session.namespaces;
    expect(inspectWalletConnectSession(candidate, expected)).toEqual({
      accepted: false,
      reason: 'missing-personal-sign',
    });
  });

  it.each([
    ['mainnet chain', provider({ chains: ['eip155:1'] }), 'testnet-scope-missing'],
    ['mainnet account', provider({ accounts: [`eip155:1:${address}`] }), 'testnet-scope-missing'],
    [
      'transaction method',
      provider({ methods: ['personal_sign', 'eth_sendTransaction'] }),
      'unapproved-method',
    ],
    [
      'typed-sign method',
      provider({ methods: ['personal_sign', 'eth_signTypedData_v4'] }),
      'unapproved-method',
    ],
    [
      'future method',
      provider({ methods: ['personal_sign', 'wallet_futureMethod'] }),
      'unapproved-method',
    ],
    ['extra event', provider({ events: ['accountsChanged', 'message'] }), 'unapproved-event'],
    [
      'missing signing',
      provider({ methods: ['wallet_switchEthereumChain'] }),
      'missing-personal-sign',
    ],
    [
      'different account',
      provider({ accounts: ['eip155:11155111:0x1111111111111111111111111111111111111111'] }),
      'selected-account-missing',
    ],
    [
      'multiple wallet accounts',
      provider({
        accounts: [
          'eip155:11155111:0xaabbccddeeff0011223344556677889900aabbcc',
          'eip155:84532:0x1111111111111111111111111111111111111111',
        ],
      }),
      'ambiguous-account-selection',
    ],
    ['missing provider marker', { ...provider(), isWalletConnect: false }, 'invalid-session-scope'],
    ['missing session', {}, 'invalid-session-scope'],
  ])('blocks %s', (_label, candidate, reason) => {
    expect(inspectWalletConnectSession(candidate, expected)).toEqual({ accepted: false, reason });
  });

  it('subscribes to provider session updates and removes the exact listener', () => {
    const candidate = provider();
    const listener = vi.fn();
    const unsubscribe = subscribeWalletConnectSessionUpdates(candidate, listener);
    expect(candidate.on).toHaveBeenCalledWith('session_update', listener);
    expect(unsubscribe).not.toBeNull();
    unsubscribe?.();
    expect(candidate.off).toHaveBeenCalledWith('session_update', listener);
  });

  it('uses a function-valued removeListener when off is not callable', () => {
    const candidate = {
      ...provider(),
      off: 'not-a-function',
      removeListener: vi.fn(),
    };
    const listener = vi.fn();
    const unsubscribe = subscribeWalletConnectSessionUpdates(candidate, listener);

    expect(unsubscribe).not.toBeNull();
    expect(() => unsubscribe?.()).not.toThrow();
    expect(candidate.removeListener).toHaveBeenCalledWith('session_update', listener);
  });

  it('contains a provider error while removing a session listener', () => {
    const candidate = provider();
    candidate.off.mockImplementation(() => {
      throw new Error('provider removal failed');
    });
    const unsubscribe = subscribeWalletConnectSessionUpdates(candidate, vi.fn());

    expect(() => unsubscribe?.()).not.toThrow();
  });

  it('normalizes lifecycle signals without forwarding provider payloads', () => {
    const listeners = new Map<string, (...payload: unknown[]) => void>();
    const candidate = provider();
    candidate.on.mockImplementation((event: string, listener: (...payload: unknown[]) => void) => {
      listeners.set(event, listener);
    });
    candidate.off.mockImplementation((event: string, listener: (...payload: unknown[]) => void) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    });
    const listener = vi.fn();

    const unsubscribe = subscribeWalletConnectSessionLifecycle(candidate, listener);

    expect(unsubscribe).not.toBeNull();
    listeners.get('session_update')?.({ topic: 'private-update-payload' });
    listeners.get('session_delete')?.({ topic: 'private-delete-payload' });
    listeners.get('session_expire')?.({ topic: 'private-expire-payload' });
    expect(listener.mock.calls).toEqual([
      ['session-update'],
      ['session-delete'],
      ['session-expire'],
    ]);

    unsubscribe?.();
    unsubscribe?.();
    expect(candidate.off).toHaveBeenCalledTimes(3);
    expect(listeners).toHaveLength(0);
  });

  it('deactivates retained lifecycle callbacks before best-effort cleanup', () => {
    const listeners: ((...payload: unknown[]) => void)[] = [];
    const candidate = provider();
    candidate.on.mockImplementation((_event: string, listener: (...payload: unknown[]) => void) => {
      listeners.push(listener);
    });
    candidate.off.mockImplementation(() => {
      throw new Error('provider removal failed');
    });
    const listener = vi.fn();
    const unsubscribe = subscribeWalletConnectSessionLifecycle(candidate, listener);

    expect(() => unsubscribe?.()).not.toThrow();
    for (const retainedListener of listeners) retainedListener({ topic: 'must-not-escape' });
    expect(listener).not.toHaveBeenCalled();
    expect(candidate.off).toHaveBeenCalledTimes(3);
  });

  it('rolls back partial lifecycle registration without exposing provider errors', () => {
    const candidate = provider();
    candidate.on.mockImplementation((event: string) => {
      if (event === 'session_delete') throw new Error('provider registration failed');
    });
    candidate.off.mockImplementation(() => {
      throw new Error('provider rollback failed');
    });

    let unsubscribe: (() => void) | null | undefined;
    expect(() => {
      unsubscribe = subscribeWalletConnectSessionLifecycle(candidate, vi.fn());
    }).not.toThrow();
    expect(unsubscribe).toBeNull();
    expect(candidate.off).toHaveBeenCalledWith('session_update', expect.any(Function));
    expect(candidate.off).toHaveBeenCalledWith('session_delete', expect.any(Function));
  });
});
