import {
  normalizePublicTestnetAccount,
  parsePublicTestnetTransactionSignature,
} from './public-testnet-execution';

export const PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY =
  'crypto-lending.public-testnet-recovery-journal.v1' as const;

const JOURNAL_VERSION = 1 as const;
const MAX_JOURNAL_JSON_LENGTH = 1_024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const JOURNAL_FIELDS = [
  'version',
  'intentId',
  'account',
  'evidenceExpiresAt',
  'signature',
] as const;
const START_FIELDS = ['intentId', 'account', 'evidenceExpiresAt'] as const;

export interface PublicTestnetRecoveryJournalRecord {
  readonly version: typeof JOURNAL_VERSION;
  readonly intentId: string;
  readonly account: string;
  readonly evidenceExpiresAt: string;
  readonly signature: string | null;
}

export type PublicTestnetRecoveryJournal = PublicTestnetRecoveryJournalRecord;

export interface PublicTestnetRecoveryJournalStart {
  readonly intentId: string;
  readonly account: string;
  readonly evidenceExpiresAt: string;
}

export interface PublicTestnetRecoveryJournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class PublicTestnetRecoveryJournalError extends Error {
  constructor() {
    super('Public-testnet recovery journal is unavailable.');
    this.name = 'PublicTestnetRecoveryJournalError';
  }
}

type PlainRecord = Record<string, unknown>;

function fail(): never {
  throw new PublicTestnetRecoveryJournalError();
}

function exactRecord(value: unknown, fields: readonly string[]): PlainRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail();
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (
    names.length !== fields.length ||
    names.some((name) => !fields.includes(name)) ||
    fields.some((field) => {
      const descriptor = descriptors[field];
      return descriptor === undefined || !Object.hasOwn(descriptor, 'value');
    })
  ) {
    return fail();
  }

  return Object.fromEntries(fields.map((field) => [field, descriptors[field]?.value]));
}

function canonicalIntentId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail();
  return value;
}

function canonicalAccount(value: unknown): string {
  try {
    return normalizePublicTestnetAccount(value);
  } catch {
    return fail();
  }
}

function canonicalEvidenceExpiry(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UTC_DATE_TIME.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function canonicalSignature(value: unknown): string {
  try {
    return parsePublicTestnetTransactionSignature(value);
  } catch {
    return fail();
  }
}

function parseJournal(value: unknown): PublicTestnetRecoveryJournalRecord {
  const record = exactRecord(value, JOURNAL_FIELDS);
  if (record.version !== JOURNAL_VERSION) return fail();

  return Object.freeze({
    version: JOURNAL_VERSION,
    intentId: canonicalIntentId(record.intentId),
    account: canonicalAccount(record.account),
    evidenceExpiresAt: canonicalEvidenceExpiry(record.evidenceExpiresAt),
    signature: record.signature === null ? null : canonicalSignature(record.signature),
  });
}

function parseStart(input: unknown): PublicTestnetRecoveryJournalRecord {
  const record = exactRecord(input, START_FIELDS);
  return parseJournal({
    version: JOURNAL_VERSION,
    intentId: record.intentId,
    account: record.account,
    evidenceExpiresAt: record.evidenceExpiresAt,
    signature: null,
  });
}

function resolveStorage(
  supplied: PublicTestnetRecoveryJournalStorage | undefined,
): PublicTestnetRecoveryJournalStorage {
  if (supplied !== undefined) return supplied;
  try {
    if (typeof window === 'undefined') return fail();
    return window.sessionStorage;
  } catch {
    return fail();
  }
}

function readStored(
  storage: PublicTestnetRecoveryJournalStorage,
): PublicTestnetRecoveryJournalRecord | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
  } catch {
    return fail();
  }
  if (serialized === null) return null;
  if (serialized.length === 0 || serialized.length > MAX_JOURNAL_JSON_LENGTH) return fail();

  try {
    return parseJournal(JSON.parse(serialized) as unknown);
  } catch {
    return fail();
  }
}

function sameJournal(
  left: PublicTestnetRecoveryJournalRecord,
  right: PublicTestnetRecoveryJournalRecord,
): boolean {
  return JOURNAL_FIELDS.every((field) => left[field] === right[field]);
}

function writeAndVerify(
  storage: PublicTestnetRecoveryJournalStorage,
  journal: PublicTestnetRecoveryJournalRecord,
): void {
  const serialized = JSON.stringify(journal);
  try {
    storage.setItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY, serialized);
    const persisted = storage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
    if (persisted !== serialized || !sameJournal(parseJournal(JSON.parse(persisted)), journal)) {
      return fail();
    }
  } catch {
    return fail();
  }
}

function removeAndVerify(storage: PublicTestnetRecoveryJournalStorage): void {
  try {
    storage.removeItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
    if (storage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY) !== null) return fail();
  } catch {
    return fail();
  }
}

/**
 * Reads the same-tab recovery record. Only a valid record that is definitely
 * expired at `now` may be removed as part of a read.
 */
export function readPublicTestnetRecoveryJournal(
  now: Date,
  storage?: PublicTestnetRecoveryJournalStorage,
): PublicTestnetRecoveryJournalRecord | null {
  let nowMilliseconds: number;
  try {
    nowMilliseconds = now.getTime();
  } catch {
    return fail();
  }
  if (!Number.isFinite(nowMilliseconds)) return fail();

  const resolved = resolveStorage(storage);
  const journal = readStored(resolved);
  if (journal === null) return null;
  if (Date.parse(journal.evidenceExpiresAt) <= nowMilliseconds) {
    removeAndVerify(resolved);
    return null;
  }
  return journal;
}

/**
 * Creates the unsigned journal synchronously. Existing storage is never
 * overwritten: callers must first recover or explicitly clear that record.
 */
export function startPublicTestnetRecoveryJournal(
  input: PublicTestnetRecoveryJournalStart,
  storage?: PublicTestnetRecoveryJournalStorage,
): PublicTestnetRecoveryJournalRecord {
  let journal: PublicTestnetRecoveryJournalRecord;
  try {
    journal = parseStart(input);
  } catch {
    return fail();
  }

  const resolved = resolveStorage(storage);
  let existing: string | null;
  try {
    existing = resolved.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
  } catch {
    return fail();
  }
  if (existing !== null) return fail();

  writeAndVerify(resolved, journal);
  return journal;
}

/** Adds the wallet signature only when the exact unsigned journal is current. */
export function addPublicTestnetRecoverySignature(
  expected: PublicTestnetRecoveryJournalRecord,
  signature: string,
  storage?: PublicTestnetRecoveryJournalStorage,
): PublicTestnetRecoveryJournalRecord {
  let normalizedExpected: PublicTestnetRecoveryJournalRecord;
  let normalizedSignature: string;
  try {
    normalizedExpected = parseJournal(expected);
    normalizedSignature = canonicalSignature(signature);
  } catch {
    return fail();
  }
  if (normalizedExpected.signature !== null) return fail();

  const resolved = resolveStorage(storage);
  const current = readStored(resolved);
  if (current === null || !sameJournal(current, normalizedExpected)) return fail();

  const signed = parseJournal({ ...normalizedExpected, signature: normalizedSignature });
  writeAndVerify(resolved, signed);
  return signed;
}

/** Clears only the exact record supplied by the caller. */
export function clearPublicTestnetRecoveryJournal(
  expected: PublicTestnetRecoveryJournalRecord,
  storage?: PublicTestnetRecoveryJournalStorage,
): void {
  let normalizedExpected: PublicTestnetRecoveryJournalRecord;
  try {
    normalizedExpected = parseJournal(expected);
  } catch {
    return fail();
  }

  const resolved = resolveStorage(storage);
  const current = readStored(resolved);
  if (current === null || !sameJournal(current, normalizedExpected)) return fail();
  removeAndVerify(resolved);
}
