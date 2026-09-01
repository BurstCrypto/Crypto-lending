import { describe, expect, it } from 'vitest';

import {
  clearEvmPublicTestnetPositionAccount,
  EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY,
  readEvmPublicTestnetPositionAccount,
  rememberEvmPublicTestnetPositionAccount,
} from '../lib/evm-public-testnet/position-account';
import { PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY } from '../lib/public-testnet/public-testnet-position-account';
import { EVM_PUBLIC_TESTNET_ACCOUNT } from './evm-public-testnet.fixtures';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('EVM public-testnet position account cache', () => {
  it('retains only a canonical Base Sepolia account for read-only recovery', () => {
    const storage = memoryStorage();
    const checksummed = '0x1111111111111111111111111111111111111111';

    expect(rememberEvmPublicTestnetPositionAccount(checksummed, storage)).toBe(
      EVM_PUBLIC_TESTNET_ACCOUNT,
    );
    expect(storage.getItem(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY)).toBe(
      EVM_PUBLIC_TESTNET_ACCOUNT,
    );
    expect(readEvmPublicTestnetPositionAccount(storage)).toBe(EVM_PUBLIC_TESTNET_ACCOUNT);
  });

  it('rejects malformed, zero, and corrupted cached accounts', () => {
    const storage = memoryStorage();
    for (const value of ['not-an-account', '0x0000000000000000000000000000000000000000']) {
      storage.setItem(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, value);
      expect(() => readEvmPublicTestnetPositionAccount(storage)).toThrow();
    }
  });

  it('clears only the EVM account and leaves the SVM remembered account untouched', () => {
    const storage = memoryStorage();
    storage.setItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, 'svm-account');
    rememberEvmPublicTestnetPositionAccount(EVM_PUBLIC_TESTNET_ACCOUNT, storage);

    clearEvmPublicTestnetPositionAccount(storage);

    expect(EVM_PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY).not.toBe(
      PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY,
    );
    expect(readEvmPublicTestnetPositionAccount(storage)).toBeNull();
    expect(storage.getItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY)).toBe('svm-account');
  });

  it('verifies writes and removals instead of trusting browser storage', () => {
    const ignoresWrites = memoryStorage();
    ignoresWrites.setItem = () => undefined;
    expect(() =>
      rememberEvmPublicTestnetPositionAccount(EVM_PUBLIC_TESTNET_ACCOUNT, ignoresWrites),
    ).toThrow();

    const ignoresRemoves = memoryStorage();
    rememberEvmPublicTestnetPositionAccount(EVM_PUBLIC_TESTNET_ACCOUNT, ignoresRemoves);
    ignoresRemoves.removeItem = () => undefined;
    expect(() => clearEvmPublicTestnetPositionAccount(ignoresRemoves)).toThrow();
  });
});
