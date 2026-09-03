import type { AssetRegistryEnvironment } from '../../blockchain/domain/supported-asset-registry';
import { MAINNET_LAUNCH_NETWORK_IDS } from '../../blockchain/domain/mainnet-launch-network-policy';

import type { WalletOwnershipChainId } from './wallet-identity';

export const WALLET_REGISTRATION_LAUNCH_CHAIN_IDS = {
  MAINNET: MAINNET_LAUNCH_NETWORK_IDS,
  TESTNET: Object.freeze([
    'eip155:11155111',
    'eip155:84532',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  ] as const),
} as const satisfies Readonly<Record<AssetRegistryEnvironment, readonly WalletOwnershipChainId[]>>;

export function isWalletRegistrationLaunchChain(
  environment: AssetRegistryEnvironment,
  chainId: string,
): chainId is WalletOwnershipChainId {
  return (WALLET_REGISTRATION_LAUNCH_CHAIN_IDS[environment] as readonly string[]).includes(chainId);
}
