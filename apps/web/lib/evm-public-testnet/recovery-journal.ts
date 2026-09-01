import { EVM_PUBLIC_TESTNET_CHAIN_ID } from './constants';
import {
  normalizeEvmPublicTestnetAccount,
  parseEvmPublicTestnetTransactionHash,
} from './execution';
import {
  EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_KEY,
  EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_KEY,
} from './operation-lock';

export const EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY =
  EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_KEY;

const JOURNAL_VERSION = 1 as const;
const MAX_JOURNAL_JSON_LENGTH = 1_024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const JOURNAL_FIELDS = [
  'version',
  'chainId',
  'intentId',
  'account',
  'nonce',
  'evidenceExpiresAt',
  'transactionHash',
] as const;
const START_FIELDS = ['chainId', 'intentId', 'account', 'nonce', 'evidenceExpiresAt'] as const;

export interface EvmPublicTestnetRecoveryJournalRecord {
  readonly version: typeof JOURNAL_VERSION;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly intentId: string;
  readonly account: string;
  readonly nonce: `0x${string}`;
  readonly evidenceExpiresAt: string;
  readonly transactionHash: string | null;
}

export type EvmPublicTestnetRecoveryJournal = EvmPublicTestnetRecoveryJournalRecord;

export interface EvmPublicTestnetRecoveryJournalStart {
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly intentId: string;
  readonly account: string;
  readonly nonce: `0x${string}`;
  readonly evidenceExpiresAt: string;
}

export interface EvmPublicTestnetRecoveryJournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class EvmPublicTestnetRecoveryJournalError extends Error {
  constructor() {
    super('EVM public-testnet recovery journal is unavailable.');
    this.name = 'EvmPublicTestnetRecoveryJournalError';
  }
}

type PlainRecord = Record<string, unknown>;

function fail(): never {
  throw new EvmPublicTestnetRecoveryJournalError();
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

function canonicalNonce(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) return fail();
  return value as `0x${string}`;
}

function canonicalEvidenceExpiry(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_DATE_TIME.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function parseJournal(value: unknown): EvmPublicTestnetRecoveryJournalRecord {
  const record = exactRecord(value, JOURNAL_FIELDS);
  if (record.version !== JOURNAL_VERSION || record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID) {
    return fail();
  }
  let account: string;
  let transactionHash: string | null;
  try {
    account = normalizeEvmPublicTestnetAccount(record.account);
    transactionHash =
      record.transactionHash === null
        ? null
        : parseEvmPublicTestnetTransactionHash(record.transactionHash);
  } catch {
    return fail();
  }
  return Object.freeze({
    version: JOURNAL_VERSION,
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    intentId: canonicalIntentId(record.intentId),
    account,
    nonce: canonicalNonce(record.nonce),
    evidenceExpiresAt: canonicalEvidenceExpiry(record.evidenceExpiresAt),
    transactionHash,
  });
}

function parseStart(value: unknown): EvmPublicTestnetRecoveryJournalRecord {
  const record = exactRecord(value, START_FIELDS);
  return parseJournal({
    version: JOURNAL_VERSION,
    chainId: record.chainId,
    intentId: record.intentId,
    account: record.account,
    nonce: record.nonce,
    evidenceExpiresAt: record.evidenceExpiresAt,
    transactionHash: null,
  });
}

function resolveStorage(
  supplied?: EvmPublicTestnetRecoveryJournalStorage,
): EvmPublicTestnetRecoveryJournalStorage {
  if (supplied !== undefined) return supplied;
  try {
    if (typeof window === 'undefined') return fail();
    return window.sessionStorage;
  } catch {
    return fail();
  }
}

function readStored(
  storage: EvmPublicTestnetRecoveryJournalStorage,
): EvmPublicTestnetRecoveryJournalRecord | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
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
  left: EvmPublicTestnetRecoveryJournalRecord,
  right: EvmPublicTestnetRecoveryJournalRecord,
): boolean {
  return JOURNAL_FIELDS.every((field) => left[field] === right[field]);
}

function writeAndVerify(
  storage: EvmPublicTestnetRecoveryJournalStorage,
  journal: EvmPublicTestnetRecoveryJournalRecord,
): void {
  const serialized = JSON.stringify(journal);
  try {
    storage.setItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY, serialized);
    const persisted = storage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
    if (persisted !== serialized || !sameJournal(parseJournal(JSON.parse(persisted)), journal)) {
      return fail();
    }
  } catch {
    return fail();
  }
}

function removeAndVerify(storage: EvmPublicTestnetRecoveryJournalStorage): void {
  try {
    storage.removeItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
    if (storage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY) !== null) return fail();
  } catch {
    return fail();
  }
}

/**
 * Reads the same-tab Base Sepolia recovery record. Neither a known transaction
 * hash nor an ambiguous no-hash send lock expires from wall-clock time alone.
 */
export function readEvmPublicTestnetRecoveryJournal(
  storage?: EvmPublicTestnetRecoveryJournalStorage,
): EvmPublicTestnetRecoveryJournalRecord | null {
  return readStored(resolveStorage(storage));
}

/** Must be called and read-back verified before `eth_sendTransaction`. */
export function startEvmPublicTestnetRecoveryJournal(
  input: EvmPublicTestnetRecoveryJournalStart,
  storage?: EvmPublicTestnetRecoveryJournalStorage,
): EvmPublicTestnetRecoveryJournalRecord {
  let journal: EvmPublicTestnetRecoveryJournalRecord;
  try {
    journal = parseStart(input);
  } catch {
    return fail();
  }
  const resolved = resolveStorage(storage);
  try {
    if (
      resolved.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY) !== null ||
      resolved.getItem(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_KEY) !== null
    ) {
      return fail();
    }
  } catch {
    return fail();
  }
  writeAndVerify(resolved, journal);
  return journal;
}

/** Adds the provider-returned transaction hash only if the exact null-hash lock is current. */
export function addEvmPublicTestnetRecoveryTransactionHash(
  expected: EvmPublicTestnetRecoveryJournalRecord,
  transactionHashValue: string,
  storage?: EvmPublicTestnetRecoveryJournalStorage,
): EvmPublicTestnetRecoveryJournalRecord {
  let normalizedExpected: EvmPublicTestnetRecoveryJournalRecord;
  let transactionHash: string;
  try {
    normalizedExpected = parseJournal(expected);
    transactionHash = parseEvmPublicTestnetTransactionHash(transactionHashValue);
  } catch {
    return fail();
  }
  if (normalizedExpected.transactionHash !== null) return fail();
  const resolved = resolveStorage(storage);
  const current = readStored(resolved);
  if (current === null || !sameJournal(current, normalizedExpected)) return fail();
  const hashed = parseJournal({ ...normalizedExpected, transactionHash });
  writeAndVerify(resolved, hashed);
  return hashed;
}

/** Clears only the exact record after a conclusive server decision. */
export function clearEvmPublicTestnetRecoveryJournal(
  expected: EvmPublicTestnetRecoveryJournalRecord,
  storage?: EvmPublicTestnetRecoveryJournalStorage,
): void {
  let normalizedExpected: EvmPublicTestnetRecoveryJournalRecord;
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
