import { normalizeEvmPublicTestnetAccount } from './execution';

export const EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY =
  'crypto-lending.evm-public-testnet.base-sepolia-position-account.v1' as const;

export interface EvmPublicTestnetPositionAccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(
  supplied?: EvmPublicTestnetPositionAccountStorage,
): EvmPublicTestnetPositionAccountStorage {
  if (supplied !== undefined) return supplied;
  if (typeof window === 'undefined') throw new Error('EVM position account storage is unavailable');
  return window.sessionStorage;
}

export function rememberEvmPublicTestnetPositionAccount(
  account: string,
  storage?: EvmPublicTestnetPositionAccountStorage,
): string {
  const normalized = normalizeEvmPublicTestnetAccount(account);
  const resolved = resolveStorage(storage);
  resolved.setItem(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, normalized);
  if (resolved.getItem(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY) !== normalized) {
    throw new Error('EVM position account storage could not be verified');
  }
  return normalized;
}

export function readEvmPublicTestnetPositionAccount(
  storage?: EvmPublicTestnetPositionAccountStorage,
): string | null {
  const stored = resolveStorage(storage).getItem(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
  return stored === null ? null : normalizeEvmPublicTestnetAccount(stored);
}

export function clearEvmPublicTestnetPositionAccount(
  storage?: EvmPublicTestnetPositionAccountStorage,
): void {
  const resolved = resolveStorage(storage);
  resolved.removeItem(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
  if (resolved.getItem(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY) !== null) {
    throw new Error('EVM position account storage could not be cleared');
  }
}

/** Best-effort privacy cleanup; authentication transitions must not fail on storage errors. */
export function clearBrowserEvmPublicTestnetPositionAccount(): void {
  if (typeof window === 'undefined') return;
  try {
    clearEvmPublicTestnetPositionAccount(window.sessionStorage);
  } catch {
    // The authenticated session transition still completes when browser storage is blocked.
  }
}
