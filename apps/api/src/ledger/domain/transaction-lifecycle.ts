import {
  parseLedgerActorAccountId,
  parseLedgerCorrelationId,
  parseLedgerLegId,
  parseLedgerTransactionId,
  type LedgerActorAccountId,
  type LedgerCorrelationId,
  type LedgerLegId,
  type LedgerTimestamp,
  type LedgerTransactionId,
} from './ledger';

export const LEDGER_LIFECYCLE_STATES = Object.freeze([
  'CREATED',
  'QUOTED',
  'USER_APPROVED',
  'SUBMITTED',
  'PENDING',
  'SETTLED',
  'FAILED',
  'REVERSED',
] as const);

export const LEDGER_RECOVERY_STATES = Object.freeze([
  'NOT_REQUIRED',
  'REQUIRED',
  'IN_PROGRESS',
  'RESOLVED',
] as const);

export const LEDGER_LIFECYCLE_REASON_CODES = Object.freeze([
  'INTENT_CREATED',
  'QUOTE_CREATED',
  'USER_APPROVAL_RECORDED',
  'SUBMISSION_RECORDED',
  'OUTCOME_PENDING',
  'SETTLEMENT_RECORDED',
  'PREFLIGHT_FAILED',
  'USER_REJECTED',
  'QUOTE_EXPIRED',
  'PROVIDER_REJECTED',
  'TERMINAL_FAILURE_CONFIRMED',
  'FULL_REVERSAL_RECORDED',
] as const);

export const LEDGER_RECOVERY_REASON_CODES = Object.freeze([
  'RECOVERY_REQUIRED',
  'RECOVERY_STARTED',
  'RECOVERY_RESOLVED',
] as const);

export type LedgerLifecycleState = (typeof LEDGER_LIFECYCLE_STATES)[number];
export type LedgerRecoveryState = (typeof LEDGER_RECOVERY_STATES)[number];
export type LedgerLifecycleReasonCode = (typeof LEDGER_LIFECYCLE_REASON_CODES)[number];
export type LedgerRecoveryReasonCode = (typeof LEDGER_RECOVERY_REASON_CODES)[number];

export type LedgerLifecycleValidationCode =
  | 'INVALID_LIFECYCLE_INPUT'
  | 'INVALID_LIFECYCLE_STATE'
  | 'INVALID_LIFECYCLE_REASON'
  | 'INVALID_LIFECYCLE_TIMESTAMP'
  | 'ILLEGAL_LIFECYCLE_TRANSITION';

export class LedgerLifecycleValidationError extends Error {
  constructor(readonly code: LedgerLifecycleValidationCode) {
    super(code);
    this.name = 'LedgerLifecycleValidationError';
  }
}

interface LifecycleRule {
  readonly from: LedgerLifecycleState | null;
  readonly to: LedgerLifecycleState;
  readonly reasons: readonly LedgerLifecycleReasonCode[];
}

interface RecoveryRule {
  readonly from: LedgerRecoveryState;
  readonly to: LedgerRecoveryState;
  readonly reasons: readonly LedgerRecoveryReasonCode[];
}

function lifecycleReasons<const T extends readonly LedgerLifecycleReasonCode[]>(...values: T): T {
  return Object.freeze(values) as T;
}

function recoveryReasons<const T extends readonly LedgerRecoveryReasonCode[]>(...values: T): T {
  return Object.freeze(values) as T;
}

const LIFECYCLE_RULES: readonly LifecycleRule[] = Object.freeze([
  { from: null, to: 'CREATED', reasons: lifecycleReasons('INTENT_CREATED') },
  { from: 'CREATED', to: 'QUOTED', reasons: lifecycleReasons('QUOTE_CREATED') },
  { from: 'CREATED', to: 'FAILED', reasons: lifecycleReasons('PREFLIGHT_FAILED') },
  {
    from: 'QUOTED',
    to: 'USER_APPROVED',
    reasons: lifecycleReasons('USER_APPROVAL_RECORDED'),
  },
  {
    from: 'QUOTED',
    to: 'FAILED',
    reasons: lifecycleReasons('PREFLIGHT_FAILED', 'USER_REJECTED', 'QUOTE_EXPIRED'),
  },
  {
    from: 'USER_APPROVED',
    to: 'SUBMITTED',
    reasons: lifecycleReasons('SUBMISSION_RECORDED'),
  },
  {
    from: 'USER_APPROVED',
    to: 'FAILED',
    reasons: lifecycleReasons('PREFLIGHT_FAILED', 'USER_REJECTED'),
  },
  { from: 'SUBMITTED', to: 'PENDING', reasons: lifecycleReasons('OUTCOME_PENDING') },
  { from: 'SUBMITTED', to: 'FAILED', reasons: lifecycleReasons('PROVIDER_REJECTED') },
  { from: 'PENDING', to: 'SETTLED', reasons: lifecycleReasons('SETTLEMENT_RECORDED') },
  {
    from: 'PENDING',
    to: 'FAILED',
    reasons: lifecycleReasons('TERMINAL_FAILURE_CONFIRMED'),
  },
  {
    from: 'SETTLED',
    to: 'REVERSED',
    reasons: lifecycleReasons('FULL_REVERSAL_RECORDED'),
  },
]);

const RECOVERY_RULES: readonly RecoveryRule[] = Object.freeze([
  {
    from: 'NOT_REQUIRED',
    to: 'REQUIRED',
    reasons: recoveryReasons('RECOVERY_REQUIRED'),
  },
  {
    from: 'REQUIRED',
    to: 'IN_PROGRESS',
    reasons: recoveryReasons('RECOVERY_STARTED'),
  },
  {
    from: 'REQUIRED',
    to: 'RESOLVED',
    reasons: recoveryReasons('RECOVERY_RESOLVED'),
  },
  {
    from: 'IN_PROGRESS',
    to: 'RESOLVED',
    reasons: recoveryReasons('RECOVERY_RESOLVED'),
  },
]);

export interface LedgerLifecycleTransitionInput {
  readonly transactionId: string;
  readonly legId: string | null;
  readonly expectedState: string | null;
  readonly nextState: string;
  readonly reason: string;
  readonly effectiveAt: Date;
}

export interface ValidatedLedgerLifecycleTransition {
  readonly transactionId: LedgerTransactionId;
  readonly legId: LedgerLegId | null;
  readonly expectedState: LedgerLifecycleState | null;
  readonly nextState: LedgerLifecycleState;
  readonly reason: LedgerLifecycleReasonCode;
  readonly effectiveAt: LedgerTimestamp;
}

export interface LedgerLifecycleTransitionCommand extends ValidatedLedgerLifecycleTransition {
  readonly actorAccountId: LedgerActorAccountId;
  readonly correlationId: LedgerCorrelationId;
}

export interface LedgerRecoveryTransitionInput {
  readonly transactionId: string;
  readonly legId: string | null;
  readonly expectedRecoveryState: string;
  readonly nextRecoveryState: string;
  readonly reason: string;
  readonly effectiveAt: Date;
}

export interface ValidatedLedgerRecoveryTransition {
  readonly transactionId: LedgerTransactionId;
  readonly legId: LedgerLegId | null;
  readonly expectedRecoveryState: LedgerRecoveryState;
  readonly nextRecoveryState: LedgerRecoveryState;
  readonly reason: LedgerRecoveryReasonCode;
  readonly effectiveAt: LedgerTimestamp;
}

export interface LedgerRecoveryTransitionCommand extends ValidatedLedgerRecoveryTransition {
  readonly actorAccountId: LedgerActorAccountId;
  readonly correlationId: LedgerCorrelationId;
}

type PlainRecord = Readonly<Record<string, unknown>>;

function lifecycleError(code: LedgerLifecycleValidationCode): never {
  throw new LedgerLifecycleValidationError(code);
}

function ownDataRecord(value: unknown, expectedKeys: readonly string[]): PlainRecord {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return lifecycleError('INVALID_LIFECYCLE_INPUT');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return lifecycleError('INVALID_LIFECYCLE_INPUT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return lifecycleError('INVALID_LIFECYCLE_INPUT');
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return lifecycleError('INVALID_LIFECYCLE_INPUT');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return lifecycleError('INVALID_LIFECYCLE_INPUT');
  }
}

function parseLifecycleState(value: unknown): LedgerLifecycleState {
  if (
    typeof value !== 'string' ||
    !LEDGER_LIFECYCLE_STATES.includes(value as LedgerLifecycleState)
  ) {
    return lifecycleError('INVALID_LIFECYCLE_STATE');
  }
  return value as LedgerLifecycleState;
}

function parseNullableLifecycleState(value: unknown): LedgerLifecycleState | null {
  return value === null ? null : parseLifecycleState(value);
}

function parseRecoveryState(value: unknown): LedgerRecoveryState {
  if (typeof value !== 'string' || !LEDGER_RECOVERY_STATES.includes(value as LedgerRecoveryState)) {
    return lifecycleError('INVALID_LIFECYCLE_STATE');
  }
  return value as LedgerRecoveryState;
}

function parseLifecycleReason(value: unknown): LedgerLifecycleReasonCode {
  if (
    typeof value !== 'string' ||
    !LEDGER_LIFECYCLE_REASON_CODES.includes(value as LedgerLifecycleReasonCode)
  ) {
    return lifecycleError('INVALID_LIFECYCLE_REASON');
  }
  return value as LedgerLifecycleReasonCode;
}

function parseRecoveryReason(value: unknown): LedgerRecoveryReasonCode {
  if (
    typeof value !== 'string' ||
    !LEDGER_RECOVERY_REASON_CODES.includes(value as LedgerRecoveryReasonCode)
  ) {
    return lifecycleError('INVALID_LIFECYCLE_REASON');
  }
  return value as LedgerRecoveryReasonCode;
}

function parseLifecycleTimestamp(value: unknown): LedgerTimestamp {
  try {
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return lifecycleError('INVALID_LIFECYCLE_TIMESTAMP');
    }
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) {
      return lifecycleError('INVALID_LIFECYCLE_TIMESTAMP');
    }
    return new Date(milliseconds).toISOString() as LedgerTimestamp;
  } catch {
    return lifecycleError('INVALID_LIFECYCLE_TIMESTAMP');
  }
}

function timestampInput(value: unknown): Date {
  try {
    if (typeof value !== 'string') {
      return lifecycleError('INVALID_LIFECYCLE_TIMESTAMP');
    }
    const parsed = new Date(value);
    if (parsed.toISOString() !== value) {
      return lifecycleError('INVALID_LIFECYCLE_TIMESTAMP');
    }
    return parsed;
  } catch {
    return lifecycleError('INVALID_LIFECYCLE_TIMESTAMP');
  }
}

function parseLegId(value: unknown): LedgerLegId | null {
  return value === null ? null : parseLedgerLegId(value);
}

export function isAllowedLedgerLifecycleTransition(
  from: LedgerLifecycleState | null,
  to: LedgerLifecycleState,
  reason: LedgerLifecycleReasonCode,
): boolean {
  return LIFECYCLE_RULES.some(
    (rule) => rule.from === from && rule.to === to && rule.reasons.includes(reason),
  );
}

export function isAllowedLedgerRecoveryTransition(
  from: LedgerRecoveryState,
  to: LedgerRecoveryState,
  reason: LedgerRecoveryReasonCode,
): boolean {
  return RECOVERY_RULES.some(
    (rule) => rule.from === from && rule.to === to && rule.reasons.includes(reason),
  );
}

export function normalizeLedgerLifecycleTransitionInput(
  value: unknown,
): ValidatedLedgerLifecycleTransition {
  const record = ownDataRecord(value, [
    'transactionId',
    'legId',
    'expectedState',
    'nextState',
    'reason',
    'effectiveAt',
  ]);
  const expectedState = parseNullableLifecycleState(record.expectedState);
  const nextState = parseLifecycleState(record.nextState);
  const reason = parseLifecycleReason(record.reason);
  if (!isAllowedLedgerLifecycleTransition(expectedState, nextState, reason)) {
    return lifecycleError('ILLEGAL_LIFECYCLE_TRANSITION');
  }
  return Object.freeze({
    transactionId: parseLedgerTransactionId(record.transactionId),
    legId: parseLegId(record.legId),
    expectedState,
    nextState,
    reason,
    effectiveAt: parseLifecycleTimestamp(record.effectiveAt),
  });
}

export function normalizeLedgerLifecycleTransitionCommand(
  value: unknown,
): LedgerLifecycleTransitionCommand {
  const record = ownDataRecord(value, [
    'actorAccountId',
    'correlationId',
    'transactionId',
    'legId',
    'expectedState',
    'nextState',
    'reason',
    'effectiveAt',
  ]);
  const transition = normalizeLedgerLifecycleTransitionInput({
    transactionId: record.transactionId,
    legId: record.legId,
    expectedState: record.expectedState,
    nextState: record.nextState,
    reason: record.reason,
    effectiveAt: timestampInput(record.effectiveAt),
  });
  return Object.freeze({
    actorAccountId: parseLedgerActorAccountId(record.actorAccountId),
    correlationId: parseLedgerCorrelationId(record.correlationId),
    ...transition,
  });
}

export function normalizeLedgerRecoveryTransitionInput(
  value: unknown,
): ValidatedLedgerRecoveryTransition {
  const record = ownDataRecord(value, [
    'transactionId',
    'legId',
    'expectedRecoveryState',
    'nextRecoveryState',
    'reason',
    'effectiveAt',
  ]);
  const expectedRecoveryState = parseRecoveryState(record.expectedRecoveryState);
  const nextRecoveryState = parseRecoveryState(record.nextRecoveryState);
  const reason = parseRecoveryReason(record.reason);
  if (!isAllowedLedgerRecoveryTransition(expectedRecoveryState, nextRecoveryState, reason)) {
    return lifecycleError('ILLEGAL_LIFECYCLE_TRANSITION');
  }
  return Object.freeze({
    transactionId: parseLedgerTransactionId(record.transactionId),
    legId: parseLegId(record.legId),
    expectedRecoveryState,
    nextRecoveryState,
    reason,
    effectiveAt: parseLifecycleTimestamp(record.effectiveAt),
  });
}

export function normalizeLedgerRecoveryTransitionCommand(
  value: unknown,
): LedgerRecoveryTransitionCommand {
  const record = ownDataRecord(value, [
    'actorAccountId',
    'correlationId',
    'transactionId',
    'legId',
    'expectedRecoveryState',
    'nextRecoveryState',
    'reason',
    'effectiveAt',
  ]);
  const transition = normalizeLedgerRecoveryTransitionInput({
    transactionId: record.transactionId,
    legId: record.legId,
    expectedRecoveryState: record.expectedRecoveryState,
    nextRecoveryState: record.nextRecoveryState,
    reason: record.reason,
    effectiveAt: timestampInput(record.effectiveAt),
  });
  return Object.freeze({
    actorAccountId: parseLedgerActorAccountId(record.actorAccountId),
    correlationId: parseLedgerCorrelationId(record.correlationId),
    ...transition,
  });
}
