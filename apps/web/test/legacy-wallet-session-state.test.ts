import { describe, expect, it, vi } from 'vitest';

import {
  clearLegacyWalletSessionState,
  LEGACY_EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY,
  LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY,
  LEGACY_SOLANA_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY,
  legacyLocalDemoWalletRosterKey,
  type LegacyWalletSessionStorage,
} from '../lib/browser/clear-legacy-wallet-session-state';

class MemoryStorage implements LegacyWalletSessionStorage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('legacy wallet session state cleanup', () => {
  it('uses the retired Base Sepolia identifier only to delete old browser state', () => {
    const storage = new MemoryStorage();
    const rosterKey = legacyLocalDemoWalletRosterKey(ACCOUNT_ID);
    const otherRosterKey = legacyLocalDemoWalletRosterKey(OTHER_ACCOUNT_ID);
    storage.values.set(LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY, 'legacy-roster');
    storage.values.set(rosterKey, 'account-roster');
    storage.values.set(otherRosterKey, 'other-account-roster');
    storage.values.set(LEGACY_EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, 'evm-account');
    storage.values.set(LEGACY_SOLANA_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, 'svm-account');
    storage.values.set('unrelated.preference', 'preserve-me');

    clearLegacyWalletSessionState(storage, ACCOUNT_ID);

    expect(storage.getItem(LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(rosterKey)).toBeNull();
    expect(storage.getItem(otherRosterKey)).toBe('other-account-roster');
    expect(storage.getItem(LEGACY_EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_SOLANA_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('unrelated.preference')).toBe('preserve-me');
  });

  it('clears every discoverable retired roster when no account is known', () => {
    const storage = new MemoryStorage();
    const firstRosterKey = legacyLocalDemoWalletRosterKey(ACCOUNT_ID);
    const secondRosterKey = legacyLocalDemoWalletRosterKey(OTHER_ACCOUNT_ID);
    storage.values.set(LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY, 'legacy-roster');
    storage.values.set(firstRosterKey, 'first-roster');
    storage.values.set('unrelated.preference', 'preserve-me');
    storage.values.set(secondRosterKey, 'second-roster');

    clearLegacyWalletSessionState(storage, null);

    expect(storage.getItem(LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(firstRosterKey)).toBeNull();
    expect(storage.getItem(secondRosterKey)).toBeNull();
    expect(storage.getItem('unrelated.preference')).toBe('preserve-me');
  });

  it('bounds storage enumeration and still attempts both exact position-account removals', () => {
    const key = vi.fn((index: number) => `unrelated.${index}`);
    const removeItem = vi.fn();
    const storage: LegacyWalletSessionStorage = {
      length: 10_000,
      getItem: () => null,
      key,
      removeItem,
    };

    clearLegacyWalletSessionState(storage, null);

    expect(key).toHaveBeenCalledTimes(4_096);
    expect(removeItem).toHaveBeenCalledWith(LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY);
    expect(removeItem).toHaveBeenCalledWith(LEGACY_EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
    expect(removeItem).toHaveBeenCalledWith(
      LEGACY_SOLANA_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY,
    );
  });

  it('keeps cleanup best-effort when individual storage operations fail', () => {
    const removeItem = vi.fn((key: string) => {
      if (key === LEGACY_LOCAL_DEMO_WALLET_ROSTER_STORAGE_KEY) {
        throw new Error('storage blocked');
      }
    });
    const storage: LegacyWalletSessionStorage = {
      length: 0,
      getItem: () => null,
      key: () => null,
      removeItem,
    };

    expect(() => clearLegacyWalletSessionState(storage, ACCOUNT_ID)).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith(LEGACY_EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY);
    expect(removeItem).toHaveBeenCalledWith(
      LEGACY_SOLANA_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY,
    );
  });
});
