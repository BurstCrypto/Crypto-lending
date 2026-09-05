import { createSupportedEvmNetworks } from './eip1193/networks';
import { MAINNET_SOLANA_WALLET_NETWORK } from './solana/mainnet-network';

export const MAINNET_WALLET_REGISTRY = Object.freeze({
  environment: 'MAINNET' as const,
  version: 1,
  fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
});

export const MAINNET_WALLET_NETWORKS = Object.freeze([
  Object.freeze({
    chainId: 'eip155:1' as const,
    providerChainId: '0x1' as const,
    displayName: 'Ethereum',
    environment: 'MAINNET' as const,
    namespace: 'eip155' as const,
  }),
  Object.freeze({
    chainId: MAINNET_SOLANA_WALLET_NETWORK.chainId,
    displayName: 'Solana',
    environment: 'MAINNET' as const,
    namespace: 'solana' as const,
  }),
]);

export type MainnetWalletNetworkId = (typeof MAINNET_WALLET_NETWORKS)[number]['chainId'];

export const MAINNET_EVM_WALLET_NETWORKS = createSupportedEvmNetworks(
  MAINNET_WALLET_NETWORKS.filter((network) => network.namespace === 'eip155').map((network) => ({
    chainId: network.chainId,
    providerChainId: network.providerChainId,
    displayName: `${network.displayName} Mainnet`,
    environment: network.environment,
  })),
);

export function mainnetWalletNetworkFor(chainId: MainnetWalletNetworkId) {
  const network = MAINNET_WALLET_NETWORKS.find((candidate) => candidate.chainId === chainId);
  if (network === undefined) throw new TypeError('Mainnet wallet network is unavailable');
  return network;
}

export function mainnetWalletAddressHint(chainId: MainnetWalletNetworkId, address: string): string {
  if (chainId.startsWith('eip155:')) {
    return `${address.slice(0, 8).toLowerCase()}…${address.slice(-6).toLowerCase()}`;
  }
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}
