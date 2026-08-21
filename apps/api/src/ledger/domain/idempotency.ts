import { createHash } from 'node:crypto';

import {
  parseLedgerActorAccountId,
  type LedgerActorAccountId,
  type ValidatedPostLedgerJournal,
  type ValidatedReverseLedgerJournal,
} from './ledger';

export const LEDGER_IDEMPOTENCY_CONTRACT_VERSION = 1 as const;
export const LEDGER_REQUEST_FINGERPRINT_VERSION = 1 as const;
export const MAX_LEDGER_IDEMPOTENCY_KEY_BYTES = 128;

export const LEDGER_IDEMPOTENCY_OPERATIONS = Object.freeze([
  'POST_JOURNAL',
  'REVERSE_JOURNAL',
] as const);

export type LedgerIdempotencyOperation = (typeof LEDGER_IDEMPOTENCY_OPERATIONS)[number];

declare const ledgerDigestBrand: unique symbol;
export type LedgerDigest = string & { readonly [ledgerDigestBrand]: 'LedgerDigest' };

export type LedgerIdempotencyErrorCode =
  'INVALID_IDEMPOTENCY_KEY' | 'INVALID_IDEMPOTENCY_CONTEXT' | 'IDEMPOTENCY_CONFLICT';

export class LedgerIdempotencyError extends Error {
  constructor(readonly code: LedgerIdempotencyErrorCode) {
    super(code);
    this.name = 'LedgerIdempotencyError';
  }
}

export interface LedgerIdempotencyContext {
  readonly actorAccountId: LedgerActorAccountId;
  readonly operation: LedgerIdempotencyOperation;
  readonly contractVersion: typeof LEDGER_IDEMPOTENCY_CONTRACT_VERSION;
  readonly keyDigest: LedgerDigest;
  readonly fingerprintVersion: typeof LEDGER_REQUEST_FINGERPRINT_VERSION;
  readonly requestFingerprint: LedgerDigest;
}

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]+$/u;
const KEY_DIGEST_DOMAIN = 'crypto-lending:ledger-idempotency-key:v1';
const REQUEST_FINGERPRINT_DOMAIN = 'crypto-lending:ledger-request-fingerprint:v1';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

function invalidKey(): never {
  throw new LedgerIdempotencyError('INVALID_IDEMPOTENCY_KEY');
}

function parseRawIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') return invalidKey();
  const bytes = Buffer.byteLength(value, 'utf8');
  if (
    bytes < 1 ||
    bytes > MAX_LEDGER_IDEMPOTENCY_KEY_BYTES ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    return invalidKey();
  }
  return value;
}

function digest(domain: string, values: readonly string[]): LedgerDigest {
  const hash = createHash('sha256');
  const updateField = (value: string): void => {
    const bytes = Buffer.from(value, 'utf8');
    hash.update(String(bytes.length), 'ascii');
    hash.update(':', 'ascii');
    hash.update(bytes);
  };

  updateField(domain);
  for (const value of values) updateField(value);
  return hash.digest('hex') as LedgerDigest;
}

/**
 * Hashes the exact bounded key under a ledger-only domain. The raw key must not
 * be copied into a command, durable result, error, log, or job envelope.
 */
export function digestLedgerIdempotencyKey(value: unknown): LedgerDigest {
  return digest(KEY_DIGEST_DOMAIN, [parseRawIdempotencyKey(value)]);
}

export function normalizeLedgerIdempotencyContext(value: unknown): LedgerIdempotencyContext {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new LedgerIdempotencyError('INVALID_IDEMPOTENCY_CONTEXT');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new LedgerIdempotencyError('INVALID_IDEMPOTENCY_CONTEXT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [
      'actorAccountId',
      'operation',
      'contractVersion',
      'keyDigest',
      'fingerprintVersion',
      'requestFingerprint',
    ] as const;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key as never))
    ) {
      throw new LedgerIdempotencyError('INVALID_IDEMPOTENCY_CONTEXT');
    }
    const read = (key: (typeof expectedKeys)[number]): unknown => {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new LedgerIdempotencyError('INVALID_IDEMPOTENCY_CONTEXT');
      }
      return descriptor.value;
    };
    const operation = read('operation');
    const contractVersion = read('contractVersion');
    const fingerprintVersion = read('fingerprintVersion');
    const keyDigest = read('keyDigest');
    const requestFingerprint = read('requestFingerprint');
    if (
      typeof operation !== 'string' ||
      !LEDGER_IDEMPOTENCY_OPERATIONS.includes(operation as LedgerIdempotencyOperation) ||
      contractVersion !== LEDGER_IDEMPOTENCY_CONTRACT_VERSION ||
      fingerprintVersion !== LEDGER_REQUEST_FINGERPRINT_VERSION ||
      typeof keyDigest !== 'string' ||
      !DIGEST_PATTERN.test(keyDigest) ||
      typeof requestFingerprint !== 'string' ||
      !DIGEST_PATTERN.test(requestFingerprint)
    ) {
      throw new LedgerIdempotencyError('INVALID_IDEMPOTENCY_CONTEXT');
    }
    return Object.freeze({
      actorAccountId: parseLedgerActorAccountId(read('actorAccountId')),
      operation: operation as LedgerIdempotencyOperation,
      contractVersion: LEDGER_IDEMPOTENCY_CONTRACT_VERSION,
      keyDigest: keyDigest as LedgerDigest,
      fingerprintVersion: LEDGER_REQUEST_FINGERPRINT_VERSION,
      requestFingerprint: requestFingerprint as LedgerDigest,
    });
  } catch {
    throw new LedgerIdempotencyError('INVALID_IDEMPOTENCY_CONTEXT');
  }
}

function fingerprintHeader(
  actorAccountId: LedgerActorAccountId,
  operation: LedgerIdempotencyOperation,
): readonly string[] {
  return [
    String(LEDGER_REQUEST_FINGERPRINT_VERSION),
    String(LEDGER_IDEMPOTENCY_CONTRACT_VERSION),
    operation,
    actorAccountId,
  ];
}

export function createPostLedgerIdempotencyContext(
  rawKey: unknown,
  actorAccountId: unknown,
  journal: ValidatedPostLedgerJournal,
): LedgerIdempotencyContext {
  const actor = parseLedgerActorAccountId(actorAccountId);
  const operation = 'POST_JOURNAL' as const;
  const fingerprintFields = [
    ...fingerprintHeader(actor, operation),
    journal.bookId,
    journal.transactionId,
    journal.legId,
    journal.economicEventType,
    journal.effectiveAt,
    journal.observedAt,
    journal.reason,
    String(journal.postings.length),
  ];
  for (const posting of journal.postings) {
    fingerprintFields.push(
      posting.accountId,
      posting.assetRevisionId,
      posting.side,
      posting.amountAtomic,
    );
  }

  return Object.freeze({
    actorAccountId: actor,
    operation,
    contractVersion: LEDGER_IDEMPOTENCY_CONTRACT_VERSION,
    keyDigest: digestLedgerIdempotencyKey(rawKey),
    fingerprintVersion: LEDGER_REQUEST_FINGERPRINT_VERSION,
    requestFingerprint: digest(REQUEST_FINGERPRINT_DOMAIN, fingerprintFields),
  });
}

export function createReverseLedgerIdempotencyContext(
  rawKey: unknown,
  actorAccountId: unknown,
  reversal: ValidatedReverseLedgerJournal,
): LedgerIdempotencyContext {
  const actor = parseLedgerActorAccountId(actorAccountId);
  const operation = 'REVERSE_JOURNAL' as const;
  return Object.freeze({
    actorAccountId: actor,
    operation,
    contractVersion: LEDGER_IDEMPOTENCY_CONTRACT_VERSION,
    keyDigest: digestLedgerIdempotencyKey(rawKey),
    fingerprintVersion: LEDGER_REQUEST_FINGERPRINT_VERSION,
    requestFingerprint: digest(REQUEST_FINGERPRINT_DOMAIN, [
      ...fingerprintHeader(actor, operation),
      reversal.originalJournalId,
      reversal.reason,
      reversal.effectiveAt,
      reversal.observedAt,
    ]),
  });
}
