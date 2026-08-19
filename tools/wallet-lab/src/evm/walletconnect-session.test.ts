import { describe, expect, it, vi } from 'vitest';

import { EVM_TESTNET_CHAIN_IDS } from './chains';
import {
  inspectWalletConnectSession,
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
});
