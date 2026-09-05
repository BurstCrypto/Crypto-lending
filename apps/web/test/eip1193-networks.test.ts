import { describe, expect, it } from 'vitest';

import {
  createSupportedEvmNetworks,
  findSupportedEvmNetwork,
  parseEip1193ChainId,
} from '@/lib/wallets/eip1193/networks';

import {
  KAN61_EVM_NETWORK_CATALOG,
  KAN61_EVM_TESTNET_CATALOG,
} from './eip1193-network-catalog.fixture';

describe('EIP-1193 network policy', () => {
  it('keeps the KAN-61 mainnet and testnet display catalogs distinct', () => {
    expect(KAN61_EVM_NETWORK_CATALOG.map(({ chainId }) => chainId)).toEqual([
      'eip155:1',
      'eip155:8453',
      'eip155:42161',
    ]);
    expect(KAN61_EVM_TESTNET_CATALOG.map(({ providerChainId }) => providerChainId)).toEqual([
      '0xaa36a7',
      '0x14a34',
      '0x66eee',
    ]);
    expect(Object.isFrozen(KAN61_EVM_TESTNET_CATALOG)).toBe(true);
  });

  it('accepts only canonical hexadecimal chain identities', () => {
    expect(parseEip1193ChainId('0x1')).toBe('eip155:1');
    expect(parseEip1193ChainId('0xaa36a7')).toBe('eip155:11155111');
    expect(parseEip1193ChainId('0x01')).toBeNull();
    expect(parseEip1193ChainId('0xAA36A7')).toBeNull();
    expect(parseEip1193ChainId(1)).toBeNull();
    expect(findSupportedEvmNetwork('0xaa36a7', KAN61_EVM_TESTNET_CATALOG)?.displayName).toBe(
      'Ethereum Sepolia',
    );
    expect(findSupportedEvmNetwork('0x1', KAN61_EVM_TESTNET_CATALOG)).toBeNull();
  });

  it('rejects mismatched, duplicate, and mixed-environment configuration', () => {
    expect(() =>
      createSupportedEvmNetworks([
        {
          chainId: 'eip155:1',
          providerChainId: '0x2',
          displayName: 'Wrong',
          environment: 'MAINNET',
        },
      ]),
    ).toThrow('configuration is invalid');
    expect(() =>
      createSupportedEvmNetworks([KAN61_EVM_NETWORK_CATALOG[0]!, KAN61_EVM_TESTNET_CATALOG[0]!]),
    ).toThrow('configuration is invalid');
    expect(() =>
      createSupportedEvmNetworks([KAN61_EVM_NETWORK_CATALOG[0]!, KAN61_EVM_NETWORK_CATALOG[0]!]),
    ).toThrow('configuration is invalid');
  });
});
