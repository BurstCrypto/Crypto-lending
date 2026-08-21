import { randomUUID } from 'node:crypto';

import {
  LEDGER_LIFECYCLE_REASON_CODES,
  LedgerLifecycleValidationError,
  normalizeLedgerLifecycleTransitionCommand,
  normalizeLedgerLifecycleTransitionInput,
  normalizeLedgerRecoveryTransitionInput,
} from './transaction-lifecycle';

const TRANSACTION_ID = randomUUID();
const LEG_ID = randomUUID();
const ACTOR_ID = randomUUID();
const CORRELATION_ID = randomUUID();
const EFFECTIVE_AT = new Date('2026-08-21T20:00:00.000Z');

function transitionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transactionId: TRANSACTION_ID,
    legId: null,
    expectedState: null,
    nextState: 'CREATED',
    reason: 'INTENT_CREATED',
    effectiveAt: EFFECTIVE_AT,
    ...overrides,
  };
}

describe('transaction lifecycle', () => {
  it.each([
    [null, 'CREATED', 'INTENT_CREATED'],
    ['CREATED', 'QUOTED', 'QUOTE_CREATED'],
    ['CREATED', 'FAILED', 'PREFLIGHT_FAILED'],
    ['QUOTED', 'USER_APPROVED', 'USER_APPROVAL_RECORDED'],
    ['QUOTED', 'FAILED', 'USER_REJECTED'],
    ['QUOTED', 'FAILED', 'QUOTE_EXPIRED'],
    ['USER_APPROVED', 'SUBMITTED', 'SUBMISSION_RECORDED'],
    ['USER_APPROVED', 'FAILED', 'PREFLIGHT_FAILED'],
    ['SUBMITTED', 'PENDING', 'OUTCOME_PENDING'],
    ['SUBMITTED', 'SETTLED', 'SETTLEMENT_RECORDED'],
    ['SUBMITTED', 'FAILED', 'PROVIDER_REJECTED'],
    ['PENDING', 'SETTLED', 'SETTLEMENT_RECORDED'],
    ['PENDING', 'FAILED', 'TERMINAL_FAILURE_CONFIRMED'],
    ['SETTLED', 'REVERSED', 'FULL_REVERSAL_RECORDED'],
  ])('accepts %s -> %s with %s', (expectedState, nextState, reason) => {
    expect(
      normalizeLedgerLifecycleTransitionInput(
        transitionInput({ expectedState, nextState, reason }),
      ),
    ).toMatchObject({ expectedState, nextState, reason });
  });

  it.each([
    [null, 'QUOTED', 'QUOTE_CREATED'],
    ['CREATED', 'SETTLED', 'SETTLEMENT_RECORDED'],
    ['PENDING', 'FAILED', 'OUTCOME_PENDING'],
    ['SETTLED', 'SETTLED', 'SETTLEMENT_RECORDED'],
    ['FAILED', 'SUBMITTED', 'SUBMISSION_RECORDED'],
    ['REVERSED', 'SETTLED', 'SETTLEMENT_RECORDED'],
  ])('rejects %s -> %s with %s', (expectedState, nextState, reason) => {
    const input = transitionInput({ expectedState, nextState, reason });
    const snapshot = structuredClone(input);

    expect(() => normalizeLedgerLifecycleTransitionInput(input)).toThrow(
      new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION'),
    );
    expect(input).toEqual(snapshot);
  });

  it('normalizes a leg command with actor and correlation history', () => {
    expect(
      normalizeLedgerLifecycleTransitionCommand({
        actorAccountId: ACTOR_ID,
        correlationId: CORRELATION_ID,
        transactionId: TRANSACTION_ID,
        legId: LEG_ID,
        expectedState: 'SUBMITTED',
        nextState: 'PENDING',
        reason: 'OUTCOME_PENDING',
        effectiveAt: EFFECTIVE_AT.toISOString(),
      }),
    ).toEqual({
      actorAccountId: ACTOR_ID,
      correlationId: CORRELATION_ID,
      transactionId: TRANSACTION_ID,
      legId: LEG_ID,
      expectedState: 'SUBMITTED',
      nextState: 'PENDING',
      reason: 'OUTCOME_PENDING',
      effectiveAt: EFFECTIVE_AT.toISOString(),
    });
  });

  it('normalizes malformed command timestamps to the lifecycle domain error', () => {
    expect(() =>
      normalizeLedgerLifecycleTransitionCommand({
        actorAccountId: ACTOR_ID,
        correlationId: CORRELATION_ID,
        transactionId: TRANSACTION_ID,
        legId: LEG_ID,
        expectedState: 'SUBMITTED',
        nextState: 'PENDING',
        reason: 'OUTCOME_PENDING',
        effectiveAt: 'not-a-timestamp',
      }),
    ).toThrow(new LedgerLifecycleValidationError('INVALID_LIFECYCLE_TIMESTAMP'));
  });

  it.each([
    ['NOT_REQUIRED', 'REQUIRED', 'RECOVERY_REQUIRED'],
    ['REQUIRED', 'IN_PROGRESS', 'RECOVERY_STARTED'],
    ['REQUIRED', 'RESOLVED', 'RECOVERY_RESOLVED'],
    ['IN_PROGRESS', 'RESOLVED', 'RECOVERY_RESOLVED'],
  ])('accepts recovery %s -> %s with %s', (expectedRecoveryState, nextRecoveryState, reason) => {
    expect(
      normalizeLedgerRecoveryTransitionInput({
        transactionId: TRANSACTION_ID,
        legId: LEG_ID,
        expectedRecoveryState,
        nextRecoveryState,
        reason,
        effectiveAt: EFFECTIVE_AT,
      }),
    ).toMatchObject({ expectedRecoveryState, nextRecoveryState, reason });
  });

  it('rejects recovery reopening after resolution', () => {
    expect(() =>
      normalizeLedgerRecoveryTransitionInput({
        transactionId: TRANSACTION_ID,
        legId: null,
        expectedRecoveryState: 'RESOLVED',
        nextRecoveryState: 'REQUIRED',
        reason: 'RECOVERY_REQUIRED',
        effectiveAt: EFFECTIVE_AT,
      }),
    ).toThrow(new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION'));
  });

  it('rejects unknown states, reasons, timestamps, and extra fields', () => {
    expect(() =>
      normalizeLedgerLifecycleTransitionInput(transitionInput({ nextState: 'UNKNOWN' })),
    ).toThrow(new LedgerLifecycleValidationError('INVALID_LIFECYCLE_STATE'));
    expect(() =>
      normalizeLedgerLifecycleTransitionInput(transitionInput({ reason: 'arbitrary' })),
    ).toThrow(new LedgerLifecycleValidationError('INVALID_LIFECYCLE_REASON'));
    expect(() =>
      normalizeLedgerLifecycleTransitionInput(
        transitionInput({ effectiveAt: new Date(Number.NaN) }),
      ),
    ).toThrow(new LedgerLifecycleValidationError('INVALID_LIFECYCLE_TIMESTAMP'));
    expect(() =>
      normalizeLedgerLifecycleTransitionInput(transitionInput({ unexpected: true })),
    ).toThrow(new LedgerLifecycleValidationError('INVALID_LIFECYCLE_INPUT'));
  });

  it('keeps the published reason registry closed and immutable', () => {
    expect(LEDGER_LIFECYCLE_REASON_CODES).toEqual([
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
    ]);
    expect(Object.isFrozen(LEDGER_LIFECYCLE_REASON_CODES)).toBe(true);
  });
});
