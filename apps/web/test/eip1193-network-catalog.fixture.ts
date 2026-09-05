import { createSupportedEvmNetworks } from '@/lib/wallets/eip1193/networks';

/** Historical KAN-61 display data retained outside the shipped application graph. */
export const KAN61_EVM_NETWORK_CATALOG = createSupportedEvmNetworks([
  {
    chainId: 'eip155:1',
    providerChainId: '0x1',
    displayName: 'Ethereum Mainnet',
    environment: 'MAINNET',
  },
  {
    chainId: 'eip155:8453',
    providerChainId: '0x2105',
    displayName: 'Base Mainnet',
    environment: 'MAINNET',
  },
  {
    chainId: 'eip155:42161',
    providerChainId: '0xa4b1',
    displayName: 'Arbitrum One',
    environment: 'MAINNET',
  },
]);

export const KAN61_EVM_TESTNET_CATALOG = createSupportedEvmNetworks([
  {
    chainId: 'eip155:11155111',
    providerChainId: '0xaa36a7',
    displayName: 'Ethereum Sepolia',
    environment: 'TESTNET',
  },
  {
    chainId: 'eip155:84532',
    providerChainId: '0x14a34',
    displayName: 'Base Sepolia',
    environment: 'TESTNET',
  },
  {
    chainId: 'eip155:421614',
    providerChainId: '0x66eee',
    displayName: 'Arbitrum Sepolia',
    environment: 'TESTNET',
  },
]);
