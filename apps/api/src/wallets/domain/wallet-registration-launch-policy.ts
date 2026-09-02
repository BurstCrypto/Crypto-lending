import type { AssetRegistryEnvironment } from '../../blockchain/domain/supported-asset-registry';

import type { WalletOwnershipChainId } from './wallet-identity';

export const WALLET_REGISTRATION_LAUNCH_CHAIN_IDS = {
  MAINNET: ['eip155:1', 'eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  TESTNET: ['eip155:11155111', 'eip155:84532', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
} as const satisfies Readonly<Record<AssetRegistryEnvironment, readonly WalletOwnershipChainId[]>>;

export function isWalletRegistrationLaunchChain(
  environment: AssetRegistryEnvironment,
  chainId: string,
): chainId is WalletOwnershipChainId {
  return (WALLET_REGISTRATION_LAUNCH_CHAIN_IDS[environment] as readonly string[]).includes(chainId);
}
