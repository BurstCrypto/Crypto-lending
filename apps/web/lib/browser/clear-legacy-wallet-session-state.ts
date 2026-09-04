const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY =
  'crypto-lending.local-demo-wallet-roster.v1' as const;
export const LEGACY_EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY =
  'crypto-lending.evm-public-testnet.base-sepolia-position-account.v1' as const;
export const LEGACY_SOLANA_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY =
  'crypto-lending.public-testnet-position-account.v1' as const;

const LEGACY_LOCAL_DEMO_WALLET_ROSTER_ACCOUNT_PREFIX =
  `${LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY}.account` as const;
const MAX_STORAGE_KEYS_TO_INSPECT = 4_096;

export interface LegacyWalletSessionStorage {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
}

export function legacyLocalDemoWalletRosterKey(accountId: string): string {
  if (!ACCOUNT_ID.test(accountId)) throw new TypeError('Legacy wallet roster is unavailable.');
  return `${LEGACY_LOCAL_DEMO_WALLET_ROSTER_ACCOUNT_PREFIX}.${accountId}`;
}

function removeBestEffort(storage: LegacyWalletSessionStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Authentication transitions must still complete when browser storage is blocked.
  }
}

function removeAndVerifyBestEffort(storage: LegacyWalletSessionStorage, key: string): void {
  try {
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw new Error('Legacy wallet state could not be cleared.');
  } catch {
    // Authentication transitions must still complete when browser storage is blocked.
  }
}

function clearKnownLocalDemoWalletRoster(
  storage: LegacyWalletSessionStorage,
  accountId: string,
): void {
  let rosterKey: string;
  try {
    rosterKey = legacyLocalDemoWalletRosterKey(accountId);
  } catch {
    return;
  }
  removeBestEffort(storage, rosterKey);
  removeBestEffort(storage, LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY);
}

function clearAllLocalDemoWalletRosters(storage: LegacyWalletSessionStorage): void {
  removeBestEffort(storage, LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY);

  let index = 0;
  let inspected = 0;
  while (inspected < MAX_STORAGE_KEYS_TO_INSPECT) {
    let length: number;
    let key: string | null;
    try {
      length = storage.length;
      if (!Number.isSafeInteger(length) || length < 0 || index >= length) return;
      key = storage.key(index);
    } catch {
      return;
    }

    inspected += 1;
    if (key !== null && key.startsWith(`${LEGACY_LOCAL_DEMO_WALLET_ROSTER_ACCOUNT_PREFIX}.`)) {
      try {
        storage.removeItem(key);
        continue;
      } catch {
        // Move past a key the browser refuses to remove to keep iteration bounded.
      }
    }
    index += 1;
  }
}

/** Best-effort privacy cleanup for browser state left by retired non-production flows. */
export function clearLegacyWalletSessionState(
  storage: LegacyWalletSessionStorage,
  accountId: string | null,
): void {
  if (accountId === null) clearAllLocalDemoWalletRosters(storage);
  else clearKnownLocalDemoWalletRoster(storage, accountId);

  removeAndVerifyBestEffort(storage, LEGACY_EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
  removeAndVerifyBestEffort(storage, LEGACY_SOLANA_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
}

export function clearBrowserLegacyWalletSessionState(accountId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    clearLegacyWalletSessionState(window.sessionStorage, accountId);
  } catch {
    // Authentication transitions must still complete when browser storage is blocked.
  }
}
