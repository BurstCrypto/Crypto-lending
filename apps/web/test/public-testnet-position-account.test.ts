import { describe, expect, it } from 'vitest';

import {
  clearPublicTestnetPositionAccount,
  PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY,
  readPublicTestnetPositionAccount,
  rememberPublicTestnetPositionAccount,
} from '../lib/public-testnet/public-testnet-position-account';
import { PUBLIC_TESTNET_ACCOUNT } from './public-testnet.fixtures';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('public testnet position account cache', () => {
  it('retains only a canonical public wallet address for read-only reload recovery', () => {
    const storage = memoryStorage();

    expect(rememberPublicTestnetPositionAccount(PUBLIC_TESTNET_ACCOUNT, storage)).toBe(
      PUBLIC_TESTNET_ACCOUNT,
    );
    expect(storage.getItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY)).toBe(
      PUBLIC_TESTNET_ACCOUNT,
    );
    expect(readPublicTestnetPositionAccount(storage)).toBe(PUBLIC_TESTNET_ACCOUNT);
  });

  it('rejects a malformed cached address', () => {
    const storage = memoryStorage();
    storage.setItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, 'not-a-wallet');

    expect(() => readPublicTestnetPositionAccount(storage)).toThrow();
  });

  it('clears the remembered public wallet on an authenticated-session transition', () => {
    const storage = memoryStorage();
    rememberPublicTestnetPositionAccount(PUBLIC_TESTNET_ACCOUNT, storage);

    clearPublicTestnetPositionAccount(storage);

    expect(readPublicTestnetPositionAccount(storage)).toBeNull();
  });
});
