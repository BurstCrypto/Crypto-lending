import { describe, expect, it } from 'vitest';

import { EVM_TESTNET_CHAIN_IDS } from './chains';
import { isEvmOwnershipProofReady } from './proof-policy';

const base = {
  connected: true,
  currentChainId: EVM_TESTNET_CHAIN_IDS.sepolia,
  targetChainId: EVM_TESTNET_CHAIN_IDS.sepolia,
  walletConnect: true,
  currentWalletConnectIdentity: 'wc:11155111:0xabc',
  guardedWalletConnectIdentity: 'wc:11155111:0xabc',
} as const;

describe('isEvmOwnershipProofReady', () => {
  it('keeps signing disabled while scope is pending or blocked even if disconnect fails', () => {
    expect(isEvmOwnershipProofReady({ ...base, walletConnectScope: 'pending' })).toBe(false);
    expect(isEvmOwnershipProofReady({ ...base, walletConnectScope: 'blocked' })).toBe(false);
  });

  it('requires an accepted scope bound to the current chain and account identity', () => {
    expect(isEvmOwnershipProofReady({ ...base, walletConnectScope: 'accepted' })).toBe(true);
    expect(
      isEvmOwnershipProofReady({
        ...base,
        walletConnectScope: 'accepted',
        currentWalletConnectIdentity: 'wc:11155111:0xchanged',
      }),
    ).toBe(false);
  });

  it('allows a connected non-WalletConnect testnet account without a WC verdict', () => {
    expect(
      isEvmOwnershipProofReady({
        ...base,
        walletConnect: false,
        walletConnectScope: 'not-applicable',
        currentWalletConnectIdentity: null,
        guardedWalletConnectIdentity: null,
      }),
    ).toBe(true);
  });
});
