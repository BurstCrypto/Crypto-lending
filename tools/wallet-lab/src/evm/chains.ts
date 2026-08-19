import { baseSepolia, sepolia } from 'wagmi/chains';

/** The complete EVM network allowlist for the local wallet lab. */
export const EVM_TESTNET_CHAINS = Object.freeze([sepolia, baseSepolia] as const);

export const EVM_TESTNET_CHAIN_IDS = Object.freeze({
  sepolia: sepolia.id,
  baseSepolia: baseSepolia.id,
} as const);

export type EvmTestnetChainId = (typeof EVM_TESTNET_CHAIN_IDS)[keyof typeof EVM_TESTNET_CHAIN_IDS];

const allowedChainIds = new Set<number>(Object.values(EVM_TESTNET_CHAIN_IDS));

export function isEvmTestnetChainId(value: unknown): value is EvmTestnetChainId {
  return typeof value === 'number' && allowedChainIds.has(value);
}
