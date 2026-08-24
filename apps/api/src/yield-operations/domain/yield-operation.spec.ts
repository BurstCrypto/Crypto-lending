import { LedgerLifecycleValidationError } from '../../ledger/domain/transaction-lifecycle';
import {
  normalizeCreateYieldOperationInput,
  normalizeTransitionYieldOperationInput,
  YieldOperationValidationError,
  type CreateYieldOperationInput,
  type TransitionYieldOperationInput,
} from './yield-operation';

const ids = {
  operation: '00000000-0000-4000-8000-000000000001',
  transaction: '00000000-0000-4000-8000-000000000002',
  plan: '00000000-0000-4000-8000-000000000003',
  quote: '00000000-0000-4000-8000-000000000004',
  journal: '00000000-0000-4000-8000-000000000005',
} as const;

const createInput: CreateYieldOperationInput = {
  operationId: ids.operation,
  operationType: 'ALLOCATE',
  ledgerTransactionId: ids.transaction,
  planReferenceId: ids.plan,
  quoteReferenceId: ids.quote,
  effectiveAt: new Date('2026-08-24T12:00:00.000Z'),
};

const transitionInput: TransitionYieldOperationInput = {
  operationId: ids.operation,
  expectedState: 'USER_APPROVED',
  nextState: 'SUBMITTED',
  reason: 'SUBMISSION_RECORDED',
  effectiveAt: new Date('2026-08-24T12:01:00.000Z'),
  ledgerJournalId: null,
};

describe('yield operation domain', () => {
  it.each(['ALLOCATE', 'WITHDRAW', 'REBALANCE'] as const)(
    'creates a canonical %s operation bound to plan, quote, and ledger transaction',
    (operationType) => {
      const operation = normalizeCreateYieldOperationInput({ ...createInput, operationType });

      expect(operation).toEqual({
        operationId: ids.operation,
        operationType,
        ledgerTransactionId: ids.transaction,
        planReferenceId: ids.plan,
        quoteReferenceId: ids.quote,
        effectiveAt: '2026-08-24T12:00:00.000Z',
      });
      expect(Object.isFrozen(operation)).toBe(true);
    },
  );

  it('reuses the canonical ledger state machine for operation transitions', () => {
    const transition = normalizeTransitionYieldOperationInput(transitionInput);

    expect(transition).toEqual({
      operationId: ids.operation,
      expectedState: 'USER_APPROVED',
      nextState: 'SUBMITTED',
      reason: 'SUBMISSION_RECORDED',
      effectiveAt: '2026-08-24T12:01:00.000Z',
      ledgerJournalId: null,
    });
    expect(Object.isFrozen(transition)).toBe(true);
  });

  it('rejects invalid and reason-mismatched transitions through the canonical rules', () => {
    for (const transition of [
      { ...transitionInput, expectedState: 'PENDING', nextState: 'PENDING' },
      { ...transitionInput, reason: 'SETTLEMENT_RECORDED' },
      { ...transitionInput, expectedState: 'FAILED', nextState: 'SUBMITTED' },
    ]) {
      expect(() => normalizeTransitionYieldOperationInput(transition)).toThrow(
        new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION'),
      );
    }
  });

  it('requires a journal for settled and reversed states and forbids one before recognition', () => {
    expect(() =>
      normalizeTransitionYieldOperationInput({
        ...transitionInput,
        expectedState: 'PENDING',
        nextState: 'SETTLED',
        reason: 'SETTLEMENT_RECORDED',
      }),
    ).toThrow(new YieldOperationValidationError('INVALID_YIELD_LEDGER_REFERENCE'));

    expect(
      normalizeTransitionYieldOperationInput({
        ...transitionInput,
        expectedState: 'PENDING',
        nextState: 'SETTLED',
        reason: 'SETTLEMENT_RECORDED',
        ledgerJournalId: ids.journal,
      }).ledgerJournalId,
    ).toBe(ids.journal);

    expect(() =>
      normalizeTransitionYieldOperationInput({
        ...transitionInput,
        ledgerJournalId: ids.journal,
      }),
    ).toThrow(new YieldOperationValidationError('INVALID_YIELD_LEDGER_REFERENCE'));
  });

  it('rejects malformed identifiers, unknown types, extra properties, and accessor inputs', () => {
    expect(() =>
      normalizeCreateYieldOperationInput({ ...createInput, operationId: 'not-a-uuid' }),
    ).toThrow(new YieldOperationValidationError('INVALID_YIELD_OPERATION_ID'));
    expect(() =>
      normalizeCreateYieldOperationInput({ ...createInput, operationType: 'DEPOSIT' }),
    ).toThrow(new YieldOperationValidationError('INVALID_YIELD_OPERATION_TYPE'));
    expect(() => normalizeCreateYieldOperationInput({ ...createInput, extra: 'forged' })).toThrow(
      new YieldOperationValidationError('INVALID_YIELD_OPERATION_INPUT'),
    );

    const accessor = { ...createInput } as Record<string, unknown>;
    Object.defineProperty(accessor, 'planReferenceId', {
      enumerable: true,
      get: () => ids.plan,
    });
    expect(() => normalizeCreateYieldOperationInput(accessor)).toThrow(
      new YieldOperationValidationError('INVALID_YIELD_OPERATION_INPUT'),
    );
  });
});
