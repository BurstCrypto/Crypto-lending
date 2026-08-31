import { normalizePublicTestnetAccount } from './public-testnet-execution';

export const PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY =
  'crypto-lending.public-testnet-position-account.v1' as const;

interface PositionAccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(supplied?: PositionAccountStorage): PositionAccountStorage {
  if (supplied !== undefined) return supplied;
  if (typeof window === 'undefined') throw new Error('Position account storage is unavailable');
  return window.sessionStorage;
}

export function rememberPublicTestnetPositionAccount(
  account: string,
  supplied?: PositionAccountStorage,
): string {
  const normalized = normalizePublicTestnetAccount(account);
  const resolved = storage(supplied);
  resolved.setItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, normalized);
  if (resolved.getItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY) !== normalized) {
    throw new Error('Position account storage could not be verified');
  }
  return normalized;
}

export function readPublicTestnetPositionAccount(supplied?: PositionAccountStorage): string | null {
  const stored = storage(supplied).getItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
  return stored === null ? null : normalizePublicTestnetAccount(stored);
}

export function clearPublicTestnetPositionAccount(supplied?: PositionAccountStorage): void {
  const resolved = storage(supplied);
  resolved.removeItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
  if (resolved.getItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY) !== null) {
    throw new Error('Position account storage could not be cleared');
  }
}

/** Best-effort privacy cleanup; authentication transitions must not fail on storage errors. */
export function clearBrowserPublicTestnetPositionAccount(): void {
  if (typeof window === 'undefined') return;
  try {
    clearPublicTestnetPositionAccount(window.sessionStorage);
  } catch {
    // The authenticated session transition still completes when browser storage is blocked.
  }
}
