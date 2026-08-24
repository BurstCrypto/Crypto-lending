import {
  parseLedgerActorAccountId,
  parseLedgerCorrelationId,
  parseLedgerJournalId,
  type LedgerActorAccountId,
  type LedgerCorrelationId,
  type LedgerJournalId,
  type LedgerTimestamp,
  type LedgerTransactionId,
} from '../../ledger/domain/ledger';
import {
  normalizeLedgerLifecycleTransitionInput,
  type LedgerLifecycleReasonCode,
  type LedgerLifecycleState,
} from '../../ledger/domain/transaction-lifecycle';

export const YIELD_OPERATION_TYPES = Object.freeze(['ALLOCATE', 'WITHDRAW', 'REBALANCE'] as const);

export type YieldOperationType = (typeof YIELD_OPERATION_TYPES)[number];

declare const yieldOperationIdBrand: unique symbol;
declare const yieldPlanReferenceIdBrand: unique symbol;
declare const yieldQuoteReferenceIdBrand: unique symbol;
declare const yieldTransitionEventIdBrand: unique symbol;
declare const yieldSubmissionIdBrand: unique symbol;

export type YieldOperationId = string & {
  readonly [yieldOperationIdBrand]: 'YieldOperationId';
};
export type YieldPlanReferenceId = string & {
  readonly [yieldPlanReferenceIdBrand]: 'YieldPlanReferenceId';
};
export type YieldQuoteReferenceId = string & {
  readonly [yieldQuoteReferenceIdBrand]: 'YieldQuoteReferenceId';
};
export type YieldTransitionEventId = string & {
  readonly [yieldTransitionEventIdBrand]: 'YieldTransitionEventId';
};
export type YieldSubmissionId = string & {
  readonly [yieldSubmissionIdBrand]: 'YieldSubmissionId';
};

export type YieldOperationValidationCode =
  | 'INVALID_YIELD_OPERATION_INPUT'
  | 'INVALID_YIELD_OPERATION_ID'
  | 'INVALID_YIELD_OPERATION_TYPE'
  | 'INVALID_YIELD_REFERENCE'
  | 'INVALID_YIELD_LEDGER_REFERENCE';

export class YieldOperationValidationError extends Error {
  constructor(readonly code: YieldOperationValidationCode) {
    super(code);
    this.name = 'YieldOperationValidationError';
  }
}

export interface CreateYieldOperationInput {
  readonly operationId: string;
  readonly operationType: string;
  readonly ledgerTransactionId: string;
  readonly planReferenceId: string;
  readonly quoteReferenceId: string;
  readonly effectiveAt: Date;
}

export interface ValidatedCreateYieldOperation {
  readonly operationId: YieldOperationId;
  readonly operationType: YieldOperationType;
  readonly ledgerTransactionId: LedgerTransactionId;
  readonly planReferenceId: YieldPlanReferenceId;
  readonly quoteReferenceId: YieldQuoteReferenceId;
  readonly effectiveAt: LedgerTimestamp;
}

export interface CreateYieldOperationCommand extends ValidatedCreateYieldOperation {
  readonly actorAccountId: LedgerActorAccountId;
  readonly correlationId: LedgerCorrelationId;
}

export interface TransitionYieldOperationInput {
  readonly operationId: string;
  readonly expectedState: string;
  readonly nextState: string;
  readonly reason: string;
  readonly effectiveAt: Date;
  readonly ledgerJournalId: string | null;
}

export interface ValidatedTransitionYieldOperation {
  readonly operationId: YieldOperationId;
  readonly expectedState: LedgerLifecycleState;
  readonly nextState: LedgerLifecycleState;
  readonly reason: LedgerLifecycleReasonCode;
  readonly effectiveAt: LedgerTimestamp;
  readonly ledgerJournalId: LedgerJournalId | null;
}

export interface TransitionYieldOperationCommand extends ValidatedTransitionYieldOperation {
  readonly actorAccountId: LedgerActorAccountId;
  readonly correlationId: LedgerCorrelationId;
}

export interface YieldOperationRecord {
  readonly operationId: YieldOperationId;
  readonly operationType: YieldOperationType;
  readonly state: LedgerLifecycleState;
  readonly ledgerTransactionId: LedgerTransactionId;
  readonly planReferenceId: YieldPlanReferenceId;
  readonly quoteReferenceId: YieldQuoteReferenceId;
  readonly recordedAt: LedgerTimestamp;
}

export interface YieldOperationTransitionRecord {
  readonly eventId: YieldTransitionEventId;
  readonly operationId: YieldOperationId;
  readonly actorAccountId: LedgerActorAccountId;
  readonly previousState: LedgerLifecycleState | null;
  readonly nextState: LedgerLifecycleState;
  readonly reason: LedgerLifecycleReasonCode;
  readonly effectiveAt: LedgerTimestamp;
  readonly recordedAt: LedgerTimestamp;
  readonly correlationId: LedgerCorrelationId;
  /** Present on every event and is the canonical ledger reference for the operation. */
  readonly ledgerTransactionId: LedgerTransactionId;
  /** Required when settlement or reversal has produced an immutable journal. */
  readonly ledgerJournalId: LedgerJournalId | null;
}

export interface YieldOperationCommandResult {
  readonly operation: YieldOperationRecord;
  readonly transition: YieldOperationTransitionRecord;
  readonly submissionId: YieldSubmissionId | null;
  readonly replayed: boolean;
}

type PlainRecord = Readonly<Record<string, unknown>>;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function invalid(code: YieldOperationValidationCode): never {
  throw new YieldOperationValidationError(code);
}

function ownDataRecord(value: unknown, expectedKeys: readonly string[]): PlainRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalid('INVALID_YIELD_OPERATION_INPUT');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid('INVALID_YIELD_OPERATION_INPUT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid('INVALID_YIELD_OPERATION_INPUT');
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return invalid('INVALID_YIELD_OPERATION_INPUT');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof YieldOperationValidationError) throw error;
    return invalid('INVALID_YIELD_OPERATION_INPUT');
  }
}

function uuid<T extends string>(value: unknown, code: YieldOperationValidationCode): T {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return invalid(code);
  return value as T;
}

export function parseYieldOperationId(value: unknown): YieldOperationId {
  return uuid<YieldOperationId>(value, 'INVALID_YIELD_OPERATION_ID');
}

export function parseYieldPlanReferenceId(value: unknown): YieldPlanReferenceId {
  return uuid<YieldPlanReferenceId>(value, 'INVALID_YIELD_REFERENCE');
}

export function parseYieldQuoteReferenceId(value: unknown): YieldQuoteReferenceId {
  return uuid<YieldQuoteReferenceId>(value, 'INVALID_YIELD_REFERENCE');
}

export function parseYieldTransitionEventId(value: unknown): YieldTransitionEventId {
  return uuid<YieldTransitionEventId>(value, 'INVALID_YIELD_OPERATION_ID');
}

export function parseYieldSubmissionId(value: unknown): YieldSubmissionId {
  return uuid<YieldSubmissionId>(value, 'INVALID_YIELD_OPERATION_ID');
}

function parseOperationType(value: unknown): YieldOperationType {
  if (typeof value !== 'string' || !YIELD_OPERATION_TYPES.includes(value as YieldOperationType)) {
    return invalid('INVALID_YIELD_OPERATION_TYPE');
  }
  return value as YieldOperationType;
}

function canonicalDate(value: unknown): Date {
  try {
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return invalid('INVALID_YIELD_OPERATION_INPUT');
    }
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) return invalid('INVALID_YIELD_OPERATION_INPUT');
    return new Date(milliseconds);
  } catch (error) {
    if (error instanceof YieldOperationValidationError) throw error;
    return invalid('INVALID_YIELD_OPERATION_INPUT');
  }
}

function timestampInput(value: unknown): Date {
  try {
    if (typeof value !== 'string') return invalid('INVALID_YIELD_OPERATION_INPUT');
    const parsed = new Date(value);
    if (parsed.toISOString() !== value) return invalid('INVALID_YIELD_OPERATION_INPUT');
    return parsed;
  } catch (error) {
    if (error instanceof YieldOperationValidationError) throw error;
    return invalid('INVALID_YIELD_OPERATION_INPUT');
  }
}

function parseJournalReference(
  value: unknown,
  nextState: LedgerLifecycleState,
): LedgerJournalId | null {
  const requiresJournal = nextState === 'SETTLED' || nextState === 'REVERSED';
  if ((value !== null) !== requiresJournal) {
    return invalid('INVALID_YIELD_LEDGER_REFERENCE');
  }
  try {
    return value === null ? null : parseLedgerJournalId(value);
  } catch {
    return invalid('INVALID_YIELD_LEDGER_REFERENCE');
  }
}

export function normalizeCreateYieldOperationInput(value: unknown): ValidatedCreateYieldOperation {
  const record = ownDataRecord(value, [
    'operationId',
    'operationType',
    'ledgerTransactionId',
    'planReferenceId',
    'quoteReferenceId',
    'effectiveAt',
  ]);
  const lifecycle = normalizeLedgerLifecycleTransitionInput({
    transactionId: record.ledgerTransactionId,
    legId: null,
    expectedState: null,
    nextState: 'CREATED',
    reason: 'INTENT_CREATED',
    effectiveAt: canonicalDate(record.effectiveAt),
  });
  return Object.freeze({
    operationId: parseYieldOperationId(record.operationId),
    operationType: parseOperationType(record.operationType),
    ledgerTransactionId: lifecycle.transactionId,
    planReferenceId: parseYieldPlanReferenceId(record.planReferenceId),
    quoteReferenceId: parseYieldQuoteReferenceId(record.quoteReferenceId),
    effectiveAt: lifecycle.effectiveAt,
  });
}

export function normalizeCreateYieldOperationCommand(value: unknown): CreateYieldOperationCommand {
  const record = ownDataRecord(value, [
    'actorAccountId',
    'correlationId',
    'operationId',
    'operationType',
    'ledgerTransactionId',
    'planReferenceId',
    'quoteReferenceId',
    'effectiveAt',
  ]);
  const operation = normalizeCreateYieldOperationInput({
    operationId: record.operationId,
    operationType: record.operationType,
    ledgerTransactionId: record.ledgerTransactionId,
    planReferenceId: record.planReferenceId,
    quoteReferenceId: record.quoteReferenceId,
    effectiveAt: timestampInput(record.effectiveAt),
  });
  return Object.freeze({
    actorAccountId: parseLedgerActorAccountId(record.actorAccountId),
    correlationId: parseLedgerCorrelationId(record.correlationId),
    ...operation,
  });
}

export function normalizeTransitionYieldOperationInput(
  value: unknown,
): ValidatedTransitionYieldOperation {
  const record = ownDataRecord(value, [
    'operationId',
    'expectedState',
    'nextState',
    'reason',
    'effectiveAt',
    'ledgerJournalId',
  ]);
  // Reuse the ledger state machine as the single canonical transition table.
  const lifecycle = normalizeLedgerLifecycleTransitionInput({
    transactionId: '00000000-0000-4000-8000-000000000000',
    legId: null,
    expectedState: record.expectedState,
    nextState: record.nextState,
    reason: record.reason,
    effectiveAt: canonicalDate(record.effectiveAt),
  });
  if (lifecycle.expectedState === null) {
    return invalid('INVALID_YIELD_OPERATION_INPUT');
  }
  return Object.freeze({
    operationId: parseYieldOperationId(record.operationId),
    expectedState: lifecycle.expectedState,
    nextState: lifecycle.nextState,
    reason: lifecycle.reason,
    effectiveAt: lifecycle.effectiveAt,
    ledgerJournalId: parseJournalReference(record.ledgerJournalId, lifecycle.nextState),
  });
}

export function normalizeTransitionYieldOperationCommand(
  value: unknown,
): TransitionYieldOperationCommand {
  const record = ownDataRecord(value, [
    'actorAccountId',
    'correlationId',
    'operationId',
    'expectedState',
    'nextState',
    'reason',
    'effectiveAt',
    'ledgerJournalId',
  ]);
  const transition = normalizeTransitionYieldOperationInput({
    operationId: record.operationId,
    expectedState: record.expectedState,
    nextState: record.nextState,
    reason: record.reason,
    effectiveAt: timestampInput(record.effectiveAt),
    ledgerJournalId: record.ledgerJournalId,
  });
  return Object.freeze({
    actorAccountId: parseLedgerActorAccountId(record.actorAccountId),
    correlationId: parseLedgerCorrelationId(record.correlationId),
    ...transition,
  });
}

export function createYieldOperationCommand(
  operation: ValidatedCreateYieldOperation,
  actorAccountId: unknown,
  correlationId: unknown,
): CreateYieldOperationCommand {
  return normalizeCreateYieldOperationCommand({
    actorAccountId,
    correlationId,
    ...operation,
    effectiveAt: operation.effectiveAt,
  });
}

export function createTransitionYieldOperationCommand(
  transition: ValidatedTransitionYieldOperation,
  actorAccountId: unknown,
  correlationId: unknown,
): TransitionYieldOperationCommand {
  return normalizeTransitionYieldOperationCommand({
    actorAccountId,
    correlationId,
    ...transition,
    effectiveAt: transition.effectiveAt,
  });
}
