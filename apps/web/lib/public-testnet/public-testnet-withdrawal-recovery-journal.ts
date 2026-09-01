import {
  normalizePublicTestnetAccount,
  parsePublicTestnetTransactionSignature,
} from './public-testnet-execution';
import {
  clearPublicTestnetOperationLock,
  readPublicTestnetOperationLock,
  type PublicTestnetOperationLockStorage,
} from './public-testnet-operation-lock';

export const PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY =
  'crypto-lending.public-testnet-withdrawal-recovery-journal.v1' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface PublicTestnetWithdrawalRecoveryJournalRecord {
  readonly version: 1;
  readonly intentId: string;
  readonly account: string;
  readonly evidenceExpiresAt: string;
  readonly signature: string;
}

export type PublicTestnetWithdrawalRecoveryJournalStorage = PublicTestnetOperationLockStorage;

export class PublicTestnetWithdrawalRecoveryJournalError extends Error {
  constructor() {
    super('Solana withdrawal recovery journal is unavailable.');
    this.name = 'PublicTestnetWithdrawalRecoveryJournalError';
  }
}

function fail(): never {
  throw new PublicTestnetWithdrawalRecoveryJournalError();
}

function storage(
  supplied?: PublicTestnetWithdrawalRecoveryJournalStorage,
): PublicTestnetWithdrawalRecoveryJournalStorage {
  if (supplied !== undefined) return supplied;
  try {
    if (typeof window === 'undefined') return fail();
    return window.sessionStorage;
  } catch {
    return fail();
  }
}

function parse(value: unknown): PublicTestnetWithdrawalRecoveryJournalRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 5 ||
    record.version !== 1 ||
    typeof record.intentId !== 'string' ||
    !UUID_V4.test(record.intentId) ||
    typeof record.evidenceExpiresAt !== 'string' ||
    !CANONICAL_DATE_TIME.test(record.evidenceExpiresAt) ||
    !Number.isFinite(Date.parse(record.evidenceExpiresAt))
  ) {
    return fail();
  }
  let account: string;
  let signature: string;
  try {
    account = normalizePublicTestnetAccount(record.account);
    signature = parsePublicTestnetTransactionSignature(record.signature);
  } catch {
    return fail();
  }
  return Object.freeze({
    version: 1 as const,
    intentId: record.intentId,
    account,
    evidenceExpiresAt: record.evidenceExpiresAt,
    signature,
  });
}

function same(
  left: PublicTestnetWithdrawalRecoveryJournalRecord,
  right: PublicTestnetWithdrawalRecoveryJournalRecord,
): boolean {
  return (
    left.version === right.version &&
    left.intentId === right.intentId &&
    left.account === right.account &&
    left.evidenceExpiresAt === right.evidenceExpiresAt &&
    left.signature === right.signature
  );
}

function readStored(
  resolved: PublicTestnetWithdrawalRecoveryJournalStorage,
): PublicTestnetWithdrawalRecoveryJournalRecord | null {
  let serialized: string | null;
  try {
    serialized = resolved.getItem(PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY);
  } catch {
    return fail();
  }
  if (serialized === null) return null;
  if (serialized.length === 0 || serialized.length > 1_024) return fail();
  try {
    return parse(JSON.parse(serialized) as unknown);
  } catch {
    return fail();
  }
}

export function readPublicTestnetWithdrawalRecoveryJournal(
  supplied?: PublicTestnetWithdrawalRecoveryJournalStorage,
): PublicTestnetWithdrawalRecoveryJournalRecord | null {
  const resolved = storage(supplied);
  const journal = readStored(resolved);
  const lock = readPublicTestnetOperationLock(resolved);
  if (journal === null) {
    if (lock?.operation === 'WITHDRAWAL') return fail();
    return null;
  }
  if (
    lock?.operation !== 'WITHDRAWAL' ||
    lock.intentId !== journal.intentId ||
    lock.account !== journal.account
  ) {
    return fail();
  }
  return journal;
}

export function startPublicTestnetWithdrawalRecoveryJournal(
  input: Omit<PublicTestnetWithdrawalRecoveryJournalRecord, 'version'>,
  supplied?: PublicTestnetWithdrawalRecoveryJournalStorage,
): PublicTestnetWithdrawalRecoveryJournalRecord {
  const journal = parse({ version: 1, ...input });
  const resolved = storage(supplied);
  if (readStored(resolved) !== null) return fail();
  const lock = readPublicTestnetOperationLock(resolved);
  if (
    lock?.operation !== 'WITHDRAWAL' ||
    lock.intentId !== journal.intentId ||
    lock.account !== journal.account
  ) {
    return fail();
  }
  const serialized = JSON.stringify(journal);
  try {
    resolved.setItem(PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY, serialized);
    const persisted = resolved.getItem(PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY);
    if (persisted !== serialized || !same(parse(JSON.parse(persisted)), journal)) return fail();
    return journal;
  } catch {
    return fail();
  }
}

export function clearPublicTestnetWithdrawalRecoveryJournal(
  expected: PublicTestnetWithdrawalRecoveryJournalRecord,
  supplied?: PublicTestnetWithdrawalRecoveryJournalStorage,
): void {
  const normalized = parse(expected);
  const resolved = storage(supplied);
  const current = readStored(resolved);
  const lock = readPublicTestnetOperationLock(resolved);
  if (
    current === null ||
    !same(current, normalized) ||
    lock?.operation !== 'WITHDRAWAL' ||
    lock.intentId !== normalized.intentId ||
    lock.account !== normalized.account
  ) {
    return fail();
  }
  try {
    resolved.removeItem(PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY);
    if (resolved.getItem(PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY) !== null) {
      return fail();
    }
    clearPublicTestnetOperationLock(lock, resolved);
  } catch {
    return fail();
  }
}
