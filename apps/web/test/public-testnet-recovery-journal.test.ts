import { beforeEach, describe, expect, it } from 'vitest';

import {
  addPublicTestnetRecoverySignature,
  clearPublicTestnetRecoveryJournal,
  PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
  PublicTestnetRecoveryJournalError,
  readPublicTestnetRecoveryJournal,
  startPublicTestnetRecoveryJournal,
  type PublicTestnetRecoveryJournalRecord,
  type PublicTestnetRecoveryJournalStorage,
} from '../lib/public-testnet/public-testnet-recovery-journal';
import {
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_INTENT_ID,
  PUBLIC_TESTNET_SIGNATURE,
} from './public-testnet.fixtures';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const EVIDENCE_EXPIRES_AT = '2026-08-27T12:10:00.000Z';

class FakeStorage implements PublicTestnetRecoveryJournalStorage {
  readonly values = new Map<string, string>();
  readonly operations: string[] = [];
  failReads = false;
  failWrites = false;
  failRemoves = false;
  ignoreWrites = false;
  ignoreRemoves = false;
  corruptWrites = false;

  getItem(key: string): string | null {
    this.operations.push('get');
    if (this.failReads) throw new Error('sensitive browser storage read detail');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.operations.push('set');
    if (this.failWrites) throw new Error('sensitive browser storage write detail');
    if (this.ignoreWrites) return;
    this.values.set(key, this.corruptWrites ? `${value}x` : value);
  }

  removeItem(key: string): void {
    this.operations.push('remove');
    if (this.failRemoves) throw new Error('sensitive browser storage remove detail');
    if (!this.ignoreRemoves) this.values.delete(key);
  }
}

function startInput() {
  return {
    intentId: PUBLIC_TESTNET_INTENT_ID,
    account: PUBLIC_TESTNET_ACCOUNT,
    evidenceExpiresAt: EVIDENCE_EXPIRES_AT,
  };
}

function journal(signature: string | null = null): PublicTestnetRecoveryJournalRecord {
  return { version: 1, ...startInput(), signature };
}

describe('public-testnet recovery journal', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('synchronously creates and verifies the exact unsigned journal before returning', () => {
    const storage = new FakeStorage();

    const created = startPublicTestnetRecoveryJournal(startInput(), storage);

    expect(created).toEqual(journal());
    expect(Object.isFrozen(created)).toBe(true);
    expect(storage.operations).toEqual(['get', 'set', 'get']);
    expect(
      JSON.parse(storage.values.get(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY) ?? ''),
    ).toEqual(journal());
  });

  it('adds a valid 64-byte signature and clears only the exact signed record', () => {
    const storage = new FakeStorage();
    const unsigned = startPublicTestnetRecoveryJournal(startInput(), storage);
    storage.operations.length = 0;

    const signed = addPublicTestnetRecoverySignature(unsigned, PUBLIC_TESTNET_SIGNATURE, storage);

    expect(signed).toEqual(journal(PUBLIC_TESTNET_SIGNATURE));
    expect(storage.operations).toEqual(['get', 'set', 'get']);
    storage.operations.length = 0;

    clearPublicTestnetRecoveryJournal(signed, storage);

    expect(storage.operations).toEqual(['get', 'remove', 'get']);
    expect(storage.values.has(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('uses sessionStorage by default', () => {
    const created = startPublicTestnetRecoveryJournal(startInput());

    expect(readPublicTestnetRecoveryJournal(NOW)).toEqual(created);
    clearPublicTestnetRecoveryJournal(created);
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
  });

  it('retains malformed or unexpected storage and exposes only the generic error', () => {
    const storage = new FakeStorage();
    const malformed = JSON.stringify({ ...journal(), provider: 'must-not-be-accepted' });
    storage.values.set(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY, malformed);

    expect(() => readPublicTestnetRecoveryJournal(NOW, storage)).toThrow(
      PublicTestnetRecoveryJournalError,
    );
    expect(() => readPublicTestnetRecoveryJournal(NOW, storage)).toThrow(
      'Public-testnet recovery journal is unavailable.',
    );
    expect(storage.values.get(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(malformed);
    expect(storage.operations).not.toContain('remove');

    storage.failReads = true;
    expect(() => readPublicTestnetRecoveryJournal(NOW, storage)).toThrow(
      PublicTestnetRecoveryJournalError,
    );
    expect(() => readPublicTestnetRecoveryJournal(NOW, storage)).not.toThrow(
      /sensitive browser storage/,
    );
  });

  it('rejects non-exact inputs and non-canonical identity, expiry, and signature values', () => {
    const storage = new FakeStorage();
    const invalidStarts: unknown[] = [
      { ...startInput(), extra: true },
      { ...startInput(), intentId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
      { ...startInput(), account: '11111111111111111111111111111111' },
      { ...startInput(), evidenceExpiresAt: '2026-08-27T12:10:00Z' },
      { ...startInput(), evidenceExpiresAt: '2026-02-31T12:10:00.000Z' },
    ];

    for (const invalid of invalidStarts) {
      expect(() =>
        startPublicTestnetRecoveryJournal(
          invalid as Parameters<typeof startPublicTestnetRecoveryJournal>[0],
          storage,
        ),
      ).toThrow(PublicTestnetRecoveryJournalError);
    }
    expect(storage.operations).toEqual([]);

    const unsigned = startPublicTestnetRecoveryJournal(startInput(), storage);
    expect(() => addPublicTestnetRecoverySignature(unsigned, '2'.repeat(64), storage)).toThrow(
      PublicTestnetRecoveryJournalError,
    );
    expect(readPublicTestnetRecoveryJournal(NOW, storage)).toEqual(unsigned);
  });

  it('detects a failed or corrupted read-back after every write', () => {
    for (const mode of ['ignoreWrites', 'corruptWrites'] as const) {
      const storage = new FakeStorage();
      storage[mode] = true;
      expect(() => startPublicTestnetRecoveryJournal(startInput(), storage)).toThrow(
        PublicTestnetRecoveryJournalError,
      );
      expect(storage.operations).toEqual(['get', 'set', 'get']);
    }

    const storage = new FakeStorage();
    const unsigned = startPublicTestnetRecoveryJournal(startInput(), storage);
    storage.ignoreWrites = true;
    expect(() =>
      addPublicTestnetRecoverySignature(unsigned, PUBLIC_TESTNET_SIGNATURE, storage),
    ).toThrow(PublicTestnetRecoveryJournalError);
    expect(readPublicTestnetRecoveryJournal(NOW, storage)).toEqual(unsigned);
  });

  it('does not overwrite an existing record or clear on stale and malformed expectations', () => {
    const storage = new FakeStorage();
    const unsigned = startPublicTestnetRecoveryJournal(startInput(), storage);
    const signed = addPublicTestnetRecoverySignature(unsigned, PUBLIC_TESTNET_SIGNATURE, storage);
    const persisted = storage.values.get(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);

    expect(() => startPublicTestnetRecoveryJournal(startInput(), storage)).toThrow(
      PublicTestnetRecoveryJournalError,
    );
    expect(() => clearPublicTestnetRecoveryJournal(unsigned, storage)).toThrow(
      PublicTestnetRecoveryJournalError,
    );
    expect(() =>
      clearPublicTestnetRecoveryJournal(
        { ...signed, evidenceExpiresAt: '2026-08-27T12:10:00Z' },
        storage,
      ),
    ).toThrow(PublicTestnetRecoveryJournalError);
    expect(storage.values.get(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(persisted);
  });

  it('clears only definitely expired valid records and verifies their removal', () => {
    const storage = new FakeStorage();
    const created = startPublicTestnetRecoveryJournal(startInput(), storage);

    expect(readPublicTestnetRecoveryJournal(new Date('2026-08-27T12:09:59.999Z'), storage)).toEqual(
      created,
    );
    expect(readPublicTestnetRecoveryJournal(new Date(EVIDENCE_EXPIRES_AT), storage)).toBeNull();
    expect(storage.values.has(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(false);

    startPublicTestnetRecoveryJournal(startInput(), storage);
    storage.ignoreRemoves = true;
    expect(() => readPublicTestnetRecoveryJournal(new Date(EVIDENCE_EXPIRES_AT), storage)).toThrow(
      PublicTestnetRecoveryJournalError,
    );
    expect(storage.values.has(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(true);
  });
});
