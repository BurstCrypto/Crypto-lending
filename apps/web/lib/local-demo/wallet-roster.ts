import type { WalletRosterKeyValueStorage } from '@/lib/wallets/wallet-roster-storage';

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LEGACY_ROSTER_KEY = 'crypto-lending.local-demo-wallet-roster.v1';
const ACCOUNT_ROSTER_PREFIX = `${LEGACY_ROSTER_KEY}.account`;
const MAX_STORAGE_KEYS_TO_INSPECT = 4_096;

interface EnumerableWalletRosterStorage extends WalletRosterKeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
}

function enumerableStorage(
  storage: WalletRosterKeyValueStorage,
): EnumerableWalletRosterStorage | null {
  try {
    const candidate = storage as Partial<EnumerableWalletRosterStorage>;
    return Number.isSafeInteger(candidate.length) &&
      (candidate.length ?? -1) >= 0 &&
      typeof candidate.key === 'function'
      ? (candidate as EnumerableWalletRosterStorage)
      : null;
  } catch {
    return null;
  }
}

export function localDemoWalletRosterKey(accountId: string): string {
  if (!ACCOUNT_ID.test(accountId)) throw new TypeError('Local demo wallet roster is unavailable.');
  return `${ACCOUNT_ROSTER_PREFIX}.${accountId}`;
}

export function removeLegacyLocalDemoWalletRoster(storage: WalletRosterKeyValueStorage): void {
  storage.removeItem(LEGACY_ROSTER_KEY);
}

export function clearAllLocalDemoWalletRosters(storage: WalletRosterKeyValueStorage): void {
  try {
    removeLegacyLocalDemoWalletRoster(storage);
  } catch {
    // Continue with scoped cleanup when the legacy key cannot be removed.
  }

  const enumerable = enumerableStorage(storage);
  if (enumerable === null) return;
  let index = 0;
  let inspected = 0;
  while (inspected < MAX_STORAGE_KEYS_TO_INSPECT) {
    let length: number;
    let key: string | null;
    try {
      length = enumerable.length;
      if (!Number.isSafeInteger(length) || length < 0 || index >= length) return;
      key = enumerable.key(index);
    } catch {
      return;
    }
    inspected += 1;
    if (key !== null && key.startsWith(`${ACCOUNT_ROSTER_PREFIX}.`)) {
      try {
        enumerable.removeItem(key);
        continue;
      } catch {
        // Move past a key the browser refuses to remove to keep iteration bounded.
      }
    }
    index += 1;
  }
}

/** Best-effort privacy cleanup; authentication transitions must not fail on storage errors. */
export function clearLocalDemoWalletRoster(
  storage: WalletRosterKeyValueStorage,
  accountId: string,
): void {
  const rosterKey = localDemoWalletRosterKey(accountId);
  try {
    storage.removeItem(rosterKey);
  } catch {
    // The caller still clears in-memory authorization and completes the auth transition.
  }
  try {
    removeLegacyLocalDemoWalletRoster(storage);
  } catch {
    // A blocked storage backend must not retain protected data in application state.
  }
}

export function clearBrowserLocalDemoWalletRoster(accountId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (accountId === null) clearAllLocalDemoWalletRosters(window.sessionStorage);
    else clearLocalDemoWalletRoster(window.sessionStorage, accountId);
  } catch {
    // Authentication transitions must still complete when browser storage is blocked.
  }
}
