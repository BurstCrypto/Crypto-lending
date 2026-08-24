import { createHash } from 'node:crypto';

import { parseLedgerActorAccountId, type LedgerActorAccountId } from '../../ledger/domain/ledger';
import type {
  CreateYieldOperationCommand,
  TransitionYieldOperationCommand,
} from './yield-operation';

export const YIELD_OPERATION_IDEMPOTENCY_CONTRACT_VERSION = 1 as const;
export const YIELD_OPERATION_FINGERPRINT_VERSION = 1 as const;
export const MAX_YIELD_OPERATION_IDEMPOTENCY_KEY_BYTES = 128;

export const YIELD_OPERATION_COMMAND_KINDS = Object.freeze(['CREATE', 'TRANSITION'] as const);

export type YieldOperationCommandKind = (typeof YIELD_OPERATION_COMMAND_KINDS)[number];

declare const yieldOperationDigestBrand: unique symbol;
export type YieldOperationDigest = string & {
  readonly [yieldOperationDigestBrand]: 'YieldOperationDigest';
};

export type YieldOperationIdempotencyErrorCode =
  | 'INVALID_YIELD_IDEMPOTENCY_KEY'
  | 'INVALID_YIELD_IDEMPOTENCY_CONTEXT'
  | 'YIELD_IDEMPOTENCY_CONFLICT';

export class YieldOperationIdempotencyError extends Error {
  constructor(readonly code: YieldOperationIdempotencyErrorCode) {
    super(code);
    this.name = 'YieldOperationIdempotencyError';
  }
}

export interface YieldOperationIdempotencyContext {
  readonly actorAccountId: LedgerActorAccountId;
  readonly commandKind: YieldOperationCommandKind;
  readonly contractVersion: typeof YIELD_OPERATION_IDEMPOTENCY_CONTRACT_VERSION;
  readonly keyDigest: YieldOperationDigest;
  readonly fingerprintVersion: typeof YIELD_OPERATION_FINGERPRINT_VERSION;
  readonly requestFingerprint: YieldOperationDigest;
}

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]+$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_DIGEST_DOMAIN = 'crypto-lending:yield-operation-idempotency-key:v1';
const REQUEST_FINGERPRINT_DOMAIN = 'crypto-lending:yield-operation-request:v1';

function idempotencyError(code: YieldOperationIdempotencyErrorCode): never {
  throw new YieldOperationIdempotencyError(code);
}

function digest(domain: string, fields: readonly string[]): YieldOperationDigest {
  const hash = createHash('sha256');
  for (const field of [domain, ...fields]) {
    const bytes = Buffer.from(field, 'utf8');
    hash.update(String(bytes.length), 'ascii');
    hash.update(':', 'ascii');
    hash.update(bytes);
  }
  return hash.digest('hex') as YieldOperationDigest;
}

export function digestYieldOperationIdempotencyKey(value: unknown): YieldOperationDigest {
  if (typeof value !== 'string') return idempotencyError('INVALID_YIELD_IDEMPOTENCY_KEY');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (
    bytes < 1 ||
    bytes > MAX_YIELD_OPERATION_IDEMPOTENCY_KEY_BYTES ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    return idempotencyError('INVALID_YIELD_IDEMPOTENCY_KEY');
  }
  return digest(KEY_DIGEST_DOMAIN, [value]);
}

function createContext(
  rawKey: unknown,
  actorAccountId: unknown,
  commandKind: YieldOperationCommandKind,
  fields: readonly string[],
): YieldOperationIdempotencyContext {
  const actor = parseLedgerActorAccountId(actorAccountId);
  return Object.freeze({
    actorAccountId: actor,
    commandKind,
    contractVersion: YIELD_OPERATION_IDEMPOTENCY_CONTRACT_VERSION,
    keyDigest: digestYieldOperationIdempotencyKey(rawKey),
    fingerprintVersion: YIELD_OPERATION_FINGERPRINT_VERSION,
    requestFingerprint: digest(REQUEST_FINGERPRINT_DOMAIN, [
      String(YIELD_OPERATION_FINGERPRINT_VERSION),
      String(YIELD_OPERATION_IDEMPOTENCY_CONTRACT_VERSION),
      actor,
      commandKind,
      ...fields,
    ]),
  });
}

export function createYieldOperationIdempotencyContext(
  rawKey: unknown,
  command: CreateYieldOperationCommand,
): YieldOperationIdempotencyContext {
  return createContext(rawKey, command.actorAccountId, 'CREATE', [
    command.operationId,
    command.operationType,
    command.ledgerTransactionId,
    command.planReferenceId,
    command.quoteReferenceId,
    command.effectiveAt,
  ]);
}

export function createYieldTransitionIdempotencyContext(
  rawKey: unknown,
  command: TransitionYieldOperationCommand,
): YieldOperationIdempotencyContext {
  return createContext(rawKey, command.actorAccountId, 'TRANSITION', [
    command.operationId,
    command.expectedState,
    command.nextState,
    command.reason,
    command.effectiveAt,
    command.ledgerJournalId ?? '',
  ]);
}

export function normalizeYieldOperationIdempotencyContext(
  value: unknown,
): YieldOperationIdempotencyContext {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return idempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return idempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [
      'actorAccountId',
      'commandKind',
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
      return idempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT');
    }
    const read = (key: (typeof expectedKeys)[number]): unknown => {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return idempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT');
      }
      return descriptor.value;
    };
    const commandKind = read('commandKind');
    const contractVersion = read('contractVersion');
    const fingerprintVersion = read('fingerprintVersion');
    const keyDigest = read('keyDigest');
    const requestFingerprint = read('requestFingerprint');
    if (
      typeof commandKind !== 'string' ||
      !YIELD_OPERATION_COMMAND_KINDS.includes(commandKind as YieldOperationCommandKind) ||
      contractVersion !== YIELD_OPERATION_IDEMPOTENCY_CONTRACT_VERSION ||
      fingerprintVersion !== YIELD_OPERATION_FINGERPRINT_VERSION ||
      typeof keyDigest !== 'string' ||
      !DIGEST_PATTERN.test(keyDigest) ||
      typeof requestFingerprint !== 'string' ||
      !DIGEST_PATTERN.test(requestFingerprint)
    ) {
      return idempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT');
    }
    return Object.freeze({
      actorAccountId: parseLedgerActorAccountId(read('actorAccountId')),
      commandKind: commandKind as YieldOperationCommandKind,
      contractVersion: YIELD_OPERATION_IDEMPOTENCY_CONTRACT_VERSION,
      keyDigest: keyDigest as YieldOperationDigest,
      fingerprintVersion: YIELD_OPERATION_FINGERPRINT_VERSION,
      requestFingerprint: requestFingerprint as YieldOperationDigest,
    });
  } catch (error) {
    if (error instanceof YieldOperationIdempotencyError) throw error;
    return idempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT');
  }
}
