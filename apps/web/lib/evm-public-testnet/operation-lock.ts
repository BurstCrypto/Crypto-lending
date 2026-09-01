export const EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_KEY =
  'crypto-lending.evm-public-testnet.base-sepolia-recovery-journal.v1' as const;
export const EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_KEY =
  'crypto-lending.evm-public-testnet.base-sepolia-full-withdrawal-recovery-journal.v1' as const;

export type EvmPublicTestnetOperation = 'DEPOSIT' | 'WITHDRAWAL';

export interface EvmPublicTestnetOperationLockStorage {
  getItem(key: string): string | null;
}

/**
 * Last-line browser check used immediately before a provider send. Journal
 * creation performs the same cross-key check synchronously, so two local
 * operation types cannot both claim the tab between event-loop turns.
 */
export function hasCompetingEvmPublicTestnetOperation(
  operation: EvmPublicTestnetOperation,
  supplied?: EvmPublicTestnetOperationLockStorage,
): boolean {
  let storage = supplied;
  if (storage === undefined) {
    if (typeof window === 'undefined') return false;
    storage = window.sessionStorage;
  }
  const competingKey =
    operation === 'DEPOSIT'
      ? EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_KEY
      : EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_KEY;
  return storage.getItem(competingKey) !== null;
}
