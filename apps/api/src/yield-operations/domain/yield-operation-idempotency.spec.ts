import { parseLedgerActorAccountId, parseLedgerCorrelationId } from '../../ledger/domain/ledger';
import {
  createTransitionYieldOperationCommand,
  createYieldOperationCommand,
  normalizeCreateYieldOperationInput,
  normalizeTransitionYieldOperationInput,
} from './yield-operation';
import {
  createYieldOperationIdempotencyContext,
  createYieldTransitionIdempotencyContext,
  digestYieldOperationIdempotencyKey,
  normalizeYieldOperationIdempotencyContext,
  YieldOperationIdempotencyError,
} from './yield-operation-idempotency';

const ids = {
  actor: '00000000-0000-4000-8000-000000000001',
  correlation: '00000000-0000-4000-8000-000000000002',
  operation: '00000000-0000-4000-8000-000000000003',
  transaction: '00000000-0000-4000-8000-000000000004',
  plan: '00000000-0000-4000-8000-000000000005',
  quote: '00000000-0000-4000-8000-000000000006',
} as const;

const actor = parseLedgerActorAccountId(ids.actor);
const correlation = parseLedgerCorrelationId(ids.correlation);
const createCommand = createYieldOperationCommand(
  normalizeCreateYieldOperationInput({
    operationId: ids.operation,
    operationType: 'ALLOCATE',
    ledgerTransactionId: ids.transaction,
    planReferenceId: ids.plan,
    quoteReferenceId: ids.quote,
    effectiveAt: new Date('2026-08-24T12:00:00.000Z'),
  }),
  actor,
  correlation,
);
const transitionCommand = createTransitionYieldOperationCommand(
  normalizeTransitionYieldOperationInput({
    operationId: ids.operation,
    expectedState: 'USER_APPROVED',
    nextState: 'SUBMITTED',
    reason: 'SUBMISSION_RECORDED',
    effectiveAt: new Date('2026-08-24T12:01:00.000Z'),
    ledgerJournalId: null,
  }),
  actor,
  correlation,
);

describe('yield operation idempotency', () => {
  it('creates deterministic scoped fingerprints without retaining the raw key', () => {
    const first = createYieldOperationIdempotencyContext('yield-command-secret', createCommand);
    const replay = createYieldOperationIdempotencyContext('yield-command-secret', createCommand);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      actorAccountId: ids.actor,
      commandKind: 'CREATE',
      contractVersion: 1,
      fingerprintVersion: 1,
    });
    expect(first.keyDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(first)).not.toContain('yield-command-secret');
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('binds transition fingerprints to state, reason, time, and journal reference', () => {
    const original = createYieldTransitionIdempotencyContext('transition-key', transitionCommand);
    const changedCommand = createTransitionYieldOperationCommand(
      normalizeTransitionYieldOperationInput({
        operationId: ids.operation,
        expectedState: 'USER_APPROVED',
        nextState: 'SUBMITTED',
        reason: 'SUBMISSION_RECORDED',
        effectiveAt: new Date('2026-08-24T12:01:01.000Z'),
        ledgerJournalId: null,
      }),
      actor,
      correlation,
    );
    const changed = createYieldTransitionIdempotencyContext('transition-key', changedCommand);

    expect(original.commandKind).toBe('TRANSITION');
    expect(changed.keyDigest).toBe(original.keyDigest);
    expect(changed.requestFingerprint).not.toBe(original.requestFingerprint);
  });

  it('rejects blank, whitespace, control-character, and oversized keys', () => {
    for (const value of ['', 'has space', 'line\nbreak', 'x'.repeat(129)]) {
      expect(() => digestYieldOperationIdempotencyKey(value)).toThrow(
        new YieldOperationIdempotencyError('INVALID_YIELD_IDEMPOTENCY_KEY'),
      );
    }
  });

  it('normalizes only an exact versioned context', () => {
    const context = createYieldOperationIdempotencyContext('create-key', createCommand);
    expect(normalizeYieldOperationIdempotencyContext(context)).toEqual(context);
    expect(() =>
      normalizeYieldOperationIdempotencyContext({ ...context, contractVersion: 2 }),
    ).toThrow(new YieldOperationIdempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT'));
    expect(() =>
      normalizeYieldOperationIdempotencyContext({ ...context, rawKey: 'create-key' }),
    ).toThrow(new YieldOperationIdempotencyError('INVALID_YIELD_IDEMPOTENCY_CONTEXT'));
  });
});
