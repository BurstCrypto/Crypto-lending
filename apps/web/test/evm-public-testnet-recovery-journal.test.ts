import { describe, expect, it } from 'vitest';

import {
  addEvmPublicTestnetRecoveryTransactionHash,
  clearEvmPublicTestnetRecoveryJournal,
  EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
  EvmPublicTestnetRecoveryJournalError,
  readEvmPublicTestnetRecoveryJournal,
  startEvmPublicTestnetRecoveryJournal,
  type EvmPublicTestnetRecoveryJournalRecord,
  type EvmPublicTestnetRecoveryJournalStorage,
} from '../lib/evm-public-testnet/recovery-journal';
import { PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY } from '../lib/public-testnet/public-testnet-recovery-journal';
import { EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY } from '../lib/evm-public-testnet/withdrawal-recovery-journal';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  EVM_PUBLIC_TESTNET_EVIDENCE_EXPIRES_AT,
  EVM_PUBLIC_TESTNET_INTENT_ID,
  EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
} from './evm-public-testnet.fixtures';

class FakeStorage implements EvmPublicTestnetRecoveryJournalStorage {
  readonly values = new Map<string, string>();
  readonly operations: string[] = [];
  failReads = false;
  failWrites = false;
  failRemoves = false;
  ignoreWrites = false;
  ignoreRemoves = false;
  corruptWrites = false;

  getItem(key: string): string | null {
    this.operations.push(`get:${key}`);
    if (this.failReads) throw new Error('private storage read detail');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.operations.push(`set:${key}`);
    if (this.failWrites) throw new Error('private storage write detail');
    if (!this.ignoreWrites) this.values.set(key, this.corruptWrites ? `${value}x` : value);
  }

  removeItem(key: string): void {
    this.operations.push(`remove:${key}`);
    if (this.failRemoves) throw new Error('private storage remove detail');
    if (!this.ignoreRemoves) this.values.delete(key);
  }
}

function startInput() {
  return {
    chainId: 'eip155:84532' as const,
    intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
    account: EVM_PUBLIC_TESTNET_ACCOUNT,
    nonce: '0x7' as const,
    evidenceExpiresAt: EVM_PUBLIC_TESTNET_EVIDENCE_EXPIRES_AT,
  };
}

function journal(transactionHash: string | null = null): EvmPublicTestnetRecoveryJournalRecord {
  return { version: 1, ...startInput(), transactionHash };
}

describe('EVM public-testnet recovery journal', () => {
  it('persists and verifies an exact hashless lock before the wallet send', () => {
    const storage = new FakeStorage();

    const created = startEvmPublicTestnetRecoveryJournal(startInput(), storage);

    expect(created).toEqual(journal());
    expect(Object.isFrozen(created)).toBe(true);
    expect(storage.operations).toEqual([
      `get:${EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY}`,
      `get:${EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY}`,
      `set:${EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY}`,
      `get:${EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY}`,
    ]);
    expect(
      JSON.parse(storage.values.get(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY) ?? ''),
    ).toEqual(journal());
  });

  it('retains an ambiguous no-hash lock regardless of its wall-clock evidence deadline', () => {
    const storage = new FakeStorage();
    const created = startEvmPublicTestnetRecoveryJournal(startInput(), storage);

    expect(readEvmPublicTestnetRecoveryJournal(storage)).toEqual(created);
    expect(readEvmPublicTestnetRecoveryJournal(storage)?.evidenceExpiresAt).toBe(
      '2026-08-31T22:30:00.000Z',
    );
    expect(storage.values.has(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(true);
  });

  it('adds a canonical transaction hash by compare-and-set and clears only the exact record', () => {
    const storage = new FakeStorage();
    const unsigned = startEvmPublicTestnetRecoveryJournal(startInput(), storage);

    const signed = addEvmPublicTestnetRecoveryTransactionHash(
      unsigned,
      EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      storage,
    );
    expect(signed).toEqual(journal(EVM_PUBLIC_TESTNET_TRANSACTION_HASH));
    expect(readEvmPublicTestnetRecoveryJournal(storage)).toEqual(signed);

    expect(() => clearEvmPublicTestnetRecoveryJournal(unsigned, storage)).toThrow(
      EvmPublicTestnetRecoveryJournalError,
    );
    clearEvmPublicTestnetRecoveryJournal(signed, storage);
    expect(readEvmPublicTestnetRecoveryJournal(storage)).toBeNull();
  });

  it('does not overwrite a current lock or accept stale hash updates', () => {
    const storage = new FakeStorage();
    const unsigned = startEvmPublicTestnetRecoveryJournal(startInput(), storage);
    const signed = addEvmPublicTestnetRecoveryTransactionHash(
      unsigned,
      EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      storage,
    );

    expect(() => startEvmPublicTestnetRecoveryJournal(startInput(), storage)).toThrow(
      EvmPublicTestnetRecoveryJournalError,
    );
    expect(() =>
      addEvmPublicTestnetRecoveryTransactionHash(unsigned, `0x${'33'.repeat(32)}`, storage),
    ).toThrow(EvmPublicTestnetRecoveryJournalError);
    expect(readEvmPublicTestnetRecoveryJournal(storage)).toEqual(signed);
  });

  it('rejects malformed inputs and accessor-backed or corrupted stored records generically', () => {
    const storage = new FakeStorage();
    const invalidStarts: unknown[] = [
      { ...startInput(), extra: true },
      { ...startInput(), chainId: 'eip155:8453' },
      { ...startInput(), intentId: 'NOT-A-UUID' },
      { ...startInput(), account: '0x1234' },
      { ...startInput(), nonce: '0x07' },
      { ...startInput(), evidenceExpiresAt: '2026-08-31T22:30:00Z' },
    ];
    for (const invalid of invalidStarts) {
      expect(() =>
        startEvmPublicTestnetRecoveryJournal(
          invalid as Parameters<typeof startEvmPublicTestnetRecoveryJournal>[0],
          storage,
        ),
      ).toThrow(EvmPublicTestnetRecoveryJournalError);
    }
    expect(storage.operations).toEqual([]);

    const accessor = journal();
    Object.defineProperty(accessor, 'account', {
      enumerable: true,
      get: () => {
        throw new Error('must not execute');
      },
    });
    expect(() =>
      startEvmPublicTestnetRecoveryJournal(
        accessor as Parameters<typeof startEvmPublicTestnetRecoveryJournal>[0],
        storage,
      ),
    ).toThrow(EvmPublicTestnetRecoveryJournalError);

    storage.values.set(
      EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
      JSON.stringify({ ...journal(), secret: 'private RPC detail' }),
    );
    const failure = (() => {
      try {
        readEvmPublicTestnetRecoveryJournal(storage);
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(failure).toBeInstanceOf(EvmPublicTestnetRecoveryJournalError);
    expect(String(failure)).not.toContain('private RPC detail');
    expect(storage.values.has(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(true);
  });

  it('detects failed write/readback/remove storage behavior without leaking its detail', () => {
    for (const mode of ['ignoreWrites', 'corruptWrites', 'failWrites'] as const) {
      const storage = new FakeStorage();
      storage[mode] = true;
      const caught = (() => {
        try {
          startEvmPublicTestnetRecoveryJournal(startInput(), storage);
        } catch (failure) {
          return failure;
        }
        return null;
      })();
      expect(caught).toBeInstanceOf(EvmPublicTestnetRecoveryJournalError);
      expect(String(caught)).not.toContain('private storage');
    }

    const storage = new FakeStorage();
    const created = startEvmPublicTestnetRecoveryJournal(startInput(), storage);
    storage.ignoreRemoves = true;
    expect(() => clearEvmPublicTestnetRecoveryJournal(created, storage)).toThrow(
      EvmPublicTestnetRecoveryJournalError,
    );
  });

  it('uses a key independent from the SVM journal so both proof locks can coexist', () => {
    const storage = new FakeStorage();
    const svmValue = '{"svm":"still-locked"}';
    storage.values.set(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY, svmValue);

    const created = startEvmPublicTestnetRecoveryJournal(startInput(), storage);

    expect(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY).not.toBe(
      PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
    );
    expect(storage.values.get(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(svmValue);
    expect(readEvmPublicTestnetRecoveryJournal(storage)).toEqual(created);
  });
});
