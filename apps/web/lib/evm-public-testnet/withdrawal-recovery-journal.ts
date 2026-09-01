import { EVM_PUBLIC_TESTNET_CHAIN_ID } from './constants';
import {
  normalizeEvmPublicTestnetAccount,
  parseEvmPublicTestnetTransactionHash,
} from './execution';
import {
  EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_KEY,
  EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_KEY,
} from './operation-lock';
import type {
  EvmPublicTestnetWithdrawalIntent,
  EvmPublicTestnetWithdrawalResultExpectation,
} from './withdrawal';

export const EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY =
  EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_KEY;

const JOURNAL_VERSION = 1 as const;
const MAX_JOURNAL_JSON_LENGTH = 1_500;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const FIELDS = [
  'version',
  'chainId',
  'step',
  'intentId',
  'account',
  'nonce',
  'evidenceExpiresAt',
  'aTokenBalanceBeforeAtomic',
  'allowanceBeforeAtomic',
  'transactionHash',
] as const;
const START_FIELDS = FIELDS.filter((field) => field !== 'version' && field !== 'transactionHash');

export interface EvmPublicTestnetWithdrawalRecoveryJournalRecord {
  readonly version: typeof JOURNAL_VERSION;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly step: EvmPublicTestnetWithdrawalIntent['step'];
  readonly intentId: string;
  readonly account: string;
  readonly nonce: `0x${string}`;
  readonly evidenceExpiresAt: string;
  readonly aTokenBalanceBeforeAtomic: string;
  readonly allowanceBeforeAtomic: string;
  readonly transactionHash: string | null;
}

export type EvmPublicTestnetWithdrawalRecoveryJournalStart = Omit<
  EvmPublicTestnetWithdrawalRecoveryJournalRecord,
  'version' | 'transactionHash'
>;

export interface EvmPublicTestnetWithdrawalRecoveryJournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class EvmPublicTestnetWithdrawalRecoveryJournalError extends Error {
  constructor() {
    super('EVM public-testnet withdrawal recovery journal is unavailable.');
    this.name = 'EvmPublicTestnetWithdrawalRecoveryJournalError';
  }
}

type PlainRecord = Record<string, unknown>;

function fail(): never {
  throw new EvmPublicTestnetWithdrawalRecoveryJournalError();
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

function canonicalDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_TIME.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return fail();
  return value;
}

function parseJournal(value: unknown): EvmPublicTestnetWithdrawalRecoveryJournalRecord {
  const record = exactRecord(value, FIELDS);
  if (
    record.version !== JOURNAL_VERSION ||
    record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID ||
    (record.step !== 'APPROVE_AWETH' && record.step !== 'WITHDRAW_FULL_ETH') ||
    typeof record.intentId !== 'string' ||
    !UUID_V4.test(record.intentId) ||
    typeof record.nonce !== 'string' ||
    !QUANTITY.test(record.nonce)
  ) {
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
  const aTokenBalanceBeforeAtomic = decimal(record.aTokenBalanceBeforeAtomic);
  const allowanceBeforeAtomic = decimal(record.allowanceBeforeAtomic);
  if (BigInt(aTokenBalanceBeforeAtomic) <= 0n) return fail();
  return Object.freeze({
    version: JOURNAL_VERSION,
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    step: record.step,
    intentId: record.intentId,
    account,
    nonce: record.nonce as `0x${string}`,
    evidenceExpiresAt: canonicalDate(record.evidenceExpiresAt),
    aTokenBalanceBeforeAtomic,
    allowanceBeforeAtomic,
    transactionHash,
  });
}

function parseStart(value: unknown): EvmPublicTestnetWithdrawalRecoveryJournalRecord {
  const record = exactRecord(value, START_FIELDS);
  return parseJournal({ version: JOURNAL_VERSION, ...record, transactionHash: null });
}

function resolveStorage(
  supplied?: EvmPublicTestnetWithdrawalRecoveryJournalStorage,
): EvmPublicTestnetWithdrawalRecoveryJournalStorage {
  if (supplied !== undefined) return supplied;
  try {
    if (typeof window === 'undefined') return fail();
    return window.sessionStorage;
  } catch {
    return fail();
  }
}

function readStored(
  storage: EvmPublicTestnetWithdrawalRecoveryJournalStorage,
): EvmPublicTestnetWithdrawalRecoveryJournalRecord | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY);
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

function same(
  left: EvmPublicTestnetWithdrawalRecoveryJournalRecord,
  right: EvmPublicTestnetWithdrawalRecoveryJournalRecord,
): boolean {
  return FIELDS.every((field) => left[field] === right[field]);
}

function writeAndVerify(
  storage: EvmPublicTestnetWithdrawalRecoveryJournalStorage,
  journal: EvmPublicTestnetWithdrawalRecoveryJournalRecord,
): void {
  const serialized = JSON.stringify(journal);
  try {
    storage.setItem(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY, serialized);
    const persisted = storage.getItem(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY);
    if (persisted !== serialized || !same(parseJournal(JSON.parse(persisted)), journal))
      return fail();
  } catch {
    return fail();
  }
}

export function readEvmPublicTestnetWithdrawalRecoveryJournal(
  storage?: EvmPublicTestnetWithdrawalRecoveryJournalStorage,
): EvmPublicTestnetWithdrawalRecoveryJournalRecord | null {
  return readStored(resolveStorage(storage));
}

/** Must complete and read back before the corresponding wallet prompt is opened. */
export function startEvmPublicTestnetWithdrawalRecoveryJournal(
  input: EvmPublicTestnetWithdrawalRecoveryJournalStart,
  storage?: EvmPublicTestnetWithdrawalRecoveryJournalStorage,
): EvmPublicTestnetWithdrawalRecoveryJournalRecord {
  let journal: EvmPublicTestnetWithdrawalRecoveryJournalRecord;
  try {
    journal = parseStart(input);
  } catch {
    return fail();
  }
  const resolved = resolveStorage(storage);
  try {
    if (
      resolved.getItem(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY) !== null ||
      resolved.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_KEY) !== null
    ) {
      return fail();
    }
  } catch {
    return fail();
  }
  writeAndVerify(resolved, journal);
  return journal;
}

export function addEvmPublicTestnetWithdrawalRecoveryTransactionHash(
  expected: EvmPublicTestnetWithdrawalRecoveryJournalRecord,
  transactionHashValue: string,
  storage?: EvmPublicTestnetWithdrawalRecoveryJournalStorage,
): EvmPublicTestnetWithdrawalRecoveryJournalRecord {
  let normalized: EvmPublicTestnetWithdrawalRecoveryJournalRecord;
  let transactionHash: string;
  try {
    normalized = parseJournal(expected);
    transactionHash = parseEvmPublicTestnetTransactionHash(transactionHashValue);
  } catch {
    return fail();
  }
  if (normalized.transactionHash !== null) return fail();
  const resolved = resolveStorage(storage);
  const current = readStored(resolved);
  if (current === null || !same(current, normalized)) return fail();
  const updated = parseJournal({ ...normalized, transactionHash });
  writeAndVerify(resolved, updated);
  return updated;
}

export function clearEvmPublicTestnetWithdrawalRecoveryJournal(
  expected: EvmPublicTestnetWithdrawalRecoveryJournalRecord,
  storage?: EvmPublicTestnetWithdrawalRecoveryJournalStorage,
): void {
  const normalized = parseJournal(expected);
  const resolved = resolveStorage(storage);
  const current = readStored(resolved);
  if (current === null || !same(current, normalized)) return fail();
  try {
    resolved.removeItem(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY);
    if (resolved.getItem(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY) !== null) {
      return fail();
    }
  } catch {
    return fail();
  }
}

export function evmPublicTestnetWithdrawalExpectationFromJournal(
  journalValue: EvmPublicTestnetWithdrawalRecoveryJournalRecord,
): EvmPublicTestnetWithdrawalResultExpectation {
  const journal = parseJournal(journalValue);
  return Object.freeze({
    intentId: journal.intentId,
    step: journal.step,
    aTokenBalanceBeforeAtomic: journal.aTokenBalanceBeforeAtomic,
    allowanceBeforeAtomic: journal.allowanceBeforeAtomic,
  });
}
