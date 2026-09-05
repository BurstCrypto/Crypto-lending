import type { SolanaWalletNetwork } from '../wallet-adapter';
import { MAINNET_SOLANA_WALLET_NETWORK } from './mainnet-network';

/**
 * Historical KAN-61 compatibility catalog for isolated tests and retired
 * public-testnet tooling. Production wallet entries must import only
 * `mainnet-network.ts`.
 */
export const KAN61_SOLANA_COMPATIBILITY_NETWORKS = Object.freeze([
  MAINNET_SOLANA_WALLET_NETWORK,
  Object.freeze({
    chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    walletStandardChain: 'solana:devnet',
  }),
] as const satisfies readonly SolanaWalletNetwork[]);

export const SOLANA_CAIP_CHAIN_IDS = Object.freeze({
  mainnet: KAN61_SOLANA_COMPATIBILITY_NETWORKS[0].chainId,
  devnet: KAN61_SOLANA_COMPATIBILITY_NETWORKS[1].chainId,
} as const);

export const SOLANA_WALLET_STANDARD_CHAINS = Object.freeze({
  mainnet: KAN61_SOLANA_COMPATIBILITY_NETWORKS[0].walletStandardChain,
  devnet: KAN61_SOLANA_COMPATIBILITY_NETWORKS[1].walletStandardChain,
} as const);

export type SupportedSolanaCluster = keyof typeof SOLANA_CAIP_CHAIN_IDS;
export type SupportedSolanaCaipChainId = (typeof SOLANA_CAIP_CHAIN_IDS)[SupportedSolanaCluster];
export type SupportedSolanaWalletStandardChain =
  (typeof SOLANA_WALLET_STANDARD_CHAINS)[SupportedSolanaCluster];

export function solanaWalletStandardChainForCaip(
  chainId: string,
): SupportedSolanaWalletStandardChain {
  const network = KAN61_SOLANA_COMPATIBILITY_NETWORKS.find(
    (candidate) => candidate.chainId === chainId,
  );
  if (network === undefined) {
    throw new TypeError('Solana chain ID is not in the supported CAIP allowlist');
  }
  return network.walletStandardChain;
}
