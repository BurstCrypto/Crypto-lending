import { describe, expect, it } from 'vitest';

import { EVM_TESTNET_CHAINS, EVM_TESTNET_CHAIN_IDS, isEvmTestnetChainId } from './chains';

describe('EVM testnet allowlist', () => {
  it('contains Sepolia and Base Sepolia and rejects mainnet', () => {
    expect(EVM_TESTNET_CHAINS.map(({ id }) => id)).toEqual([
      EVM_TESTNET_CHAIN_IDS.sepolia,
      EVM_TESTNET_CHAIN_IDS.baseSepolia,
    ]);
    expect(isEvmTestnetChainId(EVM_TESTNET_CHAIN_IDS.sepolia)).toBe(true);
    expect(isEvmTestnetChainId(EVM_TESTNET_CHAIN_IDS.baseSepolia)).toBe(true);
    expect(isEvmTestnetChainId(1)).toBe(false);
  });
});
