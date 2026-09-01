import { normalizePublicTestnetAccount } from './public-testnet-execution';

export const PUBLIC_TESTNET_OPERATION_LOCK_STORAGE_KEY =
  'crypto-lending.public-testnet-operation-lock.v1' as const;

const LEGACY_DEPOSIT_JOURNAL_STORAGE_KEY =
  'crypto-lending.public-testnet-recovery-journal.v1' as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface PublicTestnetOperationLock {
  readonly version: 1;
  readonly operation: 'DEPOSIT' | 'WITHDRAWAL';
  readonly intentId: string;
  readonly account: string;
}

export interface PublicTestnetOperationLockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class PublicTestnetOperationLockError extends Error {
  constructor() {
    super('Another Solana public-testnet operation requires recovery.');
    this.name = 'PublicTestnetOperationLockError';
  }
}

function fail(): never {
  throw new PublicTestnetOperationLockError();
}

function storage(supplied?: PublicTestnetOperationLockStorage): PublicTestnetOperationLockStorage {
  if (supplied !== undefined) return supplied;
  try {
    if (typeof window === 'undefined') return fail();
    return window.sessionStorage;
  } catch {
    return fail();
  }
}

function parse(value: unknown): PublicTestnetOperationLock {
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
    Object.keys(record).length !== 4 ||
    record.version !== 1 ||
    (record.operation !== 'DEPOSIT' && record.operation !== 'WITHDRAWAL') ||
    typeof record.intentId !== 'string' ||
    !UUID_V4.test(record.intentId)
  ) {
    return fail();
  }
  let account: string;
  try {
    account = normalizePublicTestnetAccount(record.account);
  } catch {
    return fail();
  }
  return Object.freeze({
    version: 1 as const,
    operation: record.operation,
    intentId: record.intentId,
    account,
  });
}

function read(resolved: PublicTestnetOperationLockStorage): PublicTestnetOperationLock | null {
  let serialized: string | null;
  try {
    serialized = resolved.getItem(PUBLIC_TESTNET_OPERATION_LOCK_STORAGE_KEY);
  } catch {
    return fail();
  }
  if (serialized === null) return null;
  if (serialized.length === 0 || serialized.length > 512) return fail();
  try {
    return parse(JSON.parse(serialized) as unknown);
  } catch {
    return fail();
  }
}

function same(left: PublicTestnetOperationLock, right: PublicTestnetOperationLock): boolean {
  return (
    left.version === right.version &&
    left.operation === right.operation &&
    left.intentId === right.intentId &&
    left.account === right.account
  );
}

export function readPublicTestnetOperationLock(
  supplied?: PublicTestnetOperationLockStorage,
): PublicTestnetOperationLock | null {
  return read(storage(supplied));
}

export function claimPublicTestnetOperationLock(
  input: Omit<PublicTestnetOperationLock, 'version'>,
  supplied?: PublicTestnetOperationLockStorage,
): PublicTestnetOperationLock {
  const lock = parse({ version: 1, ...input });
  const resolved = storage(supplied);
  if (read(resolved) !== null) return fail();
  try {
    if (
      lock.operation === 'WITHDRAWAL' &&
      resolved.getItem(LEGACY_DEPOSIT_JOURNAL_STORAGE_KEY) !== null
    ) {
      return fail();
    }
    const serialized = JSON.stringify(lock);
    resolved.setItem(PUBLIC_TESTNET_OPERATION_LOCK_STORAGE_KEY, serialized);
    const persisted = resolved.getItem(PUBLIC_TESTNET_OPERATION_LOCK_STORAGE_KEY);
    if (persisted !== serialized || !same(parse(JSON.parse(persisted)), lock)) return fail();
    return lock;
  } catch {
    return fail();
  }
}

export function assertPublicTestnetOperationLockAllows(
  operation: PublicTestnetOperationLock['operation'],
  supplied?: PublicTestnetOperationLockStorage,
): void {
  const current = read(storage(supplied));
  if (current !== null && current.operation !== operation) return fail();
}

export function clearPublicTestnetOperationLock(
  expected: PublicTestnetOperationLock,
  supplied?: PublicTestnetOperationLockStorage,
): void {
  const normalized = parse(expected);
  const resolved = storage(supplied);
  const current = read(resolved);
  if (current === null || !same(current, normalized)) return fail();
  try {
    resolved.removeItem(PUBLIC_TESTNET_OPERATION_LOCK_STORAGE_KEY);
    if (resolved.getItem(PUBLIC_TESTNET_OPERATION_LOCK_STORAGE_KEY) !== null) return fail();
  } catch {
    return fail();
  }
}
