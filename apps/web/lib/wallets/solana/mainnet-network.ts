import type { SolanaWalletNetwork } from '../wallet-adapter';

/**
 * The complete Solana network authority available to production wallet code.
 *
 * This module deliberately contains one immutable binding. Compatibility and
 * public-testnet catalogs live in a separate module that production entries
 * must never import.
 */
export const MAINNET_SOLANA_WALLET_NETWORK = Object.freeze({
  chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  walletStandardChain: 'solana:mainnet',
} as const satisfies SolanaWalletNetwork);

export const MAINNET_SOLANA_WALLET_NETWORKS = Object.freeze([
  MAINNET_SOLANA_WALLET_NETWORK,
] as const);

export type MainnetSolanaCaipChainId = typeof MAINNET_SOLANA_WALLET_NETWORK.chainId;
