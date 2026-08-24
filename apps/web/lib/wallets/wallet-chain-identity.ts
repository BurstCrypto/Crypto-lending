import {
  assertWalletAccount,
  assertWalletConnection,
  SOLANA_CAIP_CHAIN_IDS,
  type ChainId,
  type WalletAccount,
  type WalletConnection,
  type WalletNamespace,
} from './wallet-adapter';

export const KAN61_SOLANA_CAIP_CHAIN_IDS = Object.freeze({
  mainnet: SOLANA_CAIP_CHAIN_IDS.mainnet,
  devnet: SOLANA_CAIP_CHAIN_IDS.devnet,
} as const);

export type Kan61SolanaCaipChainId =
  (typeof KAN61_SOLANA_CAIP_CHAIN_IDS)[keyof typeof KAN61_SOLANA_CAIP_CHAIN_IDS];

const EVM_CHAIN_ID = /^eip155:(?:0|[1-9][0-9]*)$/u;
const KAN61_SOLANA_CHAIN_IDS = new Set<string>(Object.values(KAN61_SOLANA_CAIP_CHAIN_IDS));

export function isCanonicalLifecycleChainId(
  value: unknown,
  namespace: WalletNamespace,
): value is ChainId {
  return (
    typeof value === 'string' &&
    (namespace === 'eip155' ? EVM_CHAIN_ID.test(value) : KAN61_SOLANA_CHAIN_IDS.has(value))
  );
}

export function assertLifecycleWalletAccount(
  value: unknown,
  expectedNamespace: WalletNamespace,
): asserts value is WalletAccount {
  assertWalletAccount(value, expectedNamespace);
}

export function assertLifecycleWalletConnection(
  value: unknown,
  expectedNamespace: WalletNamespace,
  expectedConnectorId: string,
): asserts value is WalletConnection {
  assertWalletConnection(value, expectedNamespace, expectedConnectorId);
}
