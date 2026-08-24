import type { QueryResult, QueryResultRow } from 'pg';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import { loggingContext } from '../../infrastructure/logging';
import type { JobPublisherPort } from '../../infrastructure/outbox/job-publisher.port';
import { LedgerLifecycleValidationError } from '../../ledger/domain/transaction-lifecycle';
import {
  createTransitionYieldOperationCommand,
  createYieldOperationCommand,
  normalizeCreateYieldOperationInput,
  normalizeTransitionYieldOperationInput,
  type CreateYieldOperationCommand,
  type TransitionYieldOperationCommand,
} from '../domain/yield-operation';
import {
  createYieldOperationIdempotencyContext,
  createYieldTransitionIdempotencyContext,
  YieldOperationIdempotencyError,
} from '../domain/yield-operation-idempotency';
import {
  PostgresYieldOperationRepository,
  YieldOperationPersistenceError,
} from './postgres-yield-operation.repository';

const ids = {
  actor: '00000000-0000-4000-8000-000000000001',
  correlation: '00000000-0000-4000-8000-000000000002',
  operation: '00000000-0000-4000-8000-000000000003',
  transaction: '00000000-0000-4000-8000-000000000004',
  plan: '00000000-0000-4000-8000-000000000005',
  quote: '00000000-0000-4000-8000-000000000006',
  command: '00000000-0000-4000-8000-000000000007',
  createEvent: '00000000-0000-4000-8000-000000000008',
  submitEvent: '00000000-0000-4000-8000-000000000009',
  submission: '00000000-0000-4000-8000-00000000000a',
} as const;

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function createCommand(operationType = 'ALLOCATE'): CreateYieldOperationCommand {
  return createYieldOperationCommand(
    normalizeCreateYieldOperationInput({
      operationId: ids.operation,
      operationType,
      ledgerTransactionId: ids.transaction,
      planReferenceId: ids.plan,
      quoteReferenceId: ids.quote,
      effectiveAt: new Date('2026-08-24T12:00:00.000Z'),
    }),
    ids.actor,
    ids.correlation,
  );
}

function submitCommand(): TransitionYieldOperationCommand {
  return createTransitionYieldOperationCommand(
    normalizeTransitionYieldOperationInput({
      operationId: ids.operation,
      expectedState: 'USER_APPROVED',
      nextState: 'SUBMITTED',
      reason: 'SUBMISSION_RECORDED',
      effectiveAt: new Date('2026-08-24T12:01:00.000Z'),
      ledgerJournalId: null,
    }),
    ids.actor,
    ids.correlation,
  );
}

function row(
  state: 'CREATED' | 'SUBMITTED',
  outcome: 'COMMITTED' | 'REPLAYED' = 'COMMITTED',
): QueryResultRow {
  const submitted = state === 'SUBMITTED';
  return {
    command_id: ids.command,
    operation_id: ids.operation,
    operation_type: 'ALLOCATE',
    current_state: state,
    ledger_transaction_id: ids.transaction,
    plan_reference_id: ids.plan,
    quote_reference_id: ids.quote,
    operation_recorded_at: new Date('2026-08-24T12:00:00.001Z'),
    transition_event_id: submitted ? ids.submitEvent : ids.createEvent,
    actor_account_id: ids.actor,
    previous_state: submitted ? 'USER_APPROVED' : null,
    next_state: state,
    reason_code: submitted ? 'SUBMISSION_RECORDED' : 'INTENT_CREATED',
    effective_at: new Date(submitted ? '2026-08-24T12:01:00.000Z' : '2026-08-24T12:00:00.000Z'),
    transition_recorded_at: new Date(
      submitted ? '2026-08-24T12:01:00.001Z' : '2026-08-24T12:00:00.002Z',
    ),
    correlation_id: ids.correlation,
    ledger_journal_id: null,
    submission_id: submitted ? ids.submission : null,
    outcome,
  };
}

function setup(): {
  query: jest.Mock;
  withTransaction: jest.Mock;
  publisher: jest.Mocked<JobPublisherPort>;
  repository: PostgresYieldOperationRepository;
} {
  const query = jest.fn();
  const withTransaction = jest.fn(async (work: () => Promise<unknown>) => work());
  const postgres = { query, withTransaction } as unknown as PostgresService;
  const publisher = {
    enqueue: jest.fn(async (request: { id?: string }) => ({ id: request.id })),
  } as unknown as jest.Mocked<JobPublisherPort>;
  return {
    query,
    withTransaction,
    publisher,
    repository: new PostgresYieldOperationRepository(postgres, publisher),
  };
}

describe('PostgresYieldOperationRepository', () => {
  it.each(['ALLOCATE', 'WITHDRAW', 'REBALANCE'] as const)(
    'creates a %s operation only through the fixed definer function',
    async (operationType) => {
      const { query, withTransaction, publisher, repository } = setup();
      const command = createCommand(operationType);
      const idempotency = createYieldOperationIdempotencyContext('create-key', command);
      query.mockResolvedValueOnce(result([{ ...row('CREATED'), operation_type: operationType }]));

      await expect(repository.create(command, idempotency)).resolves.toMatchObject({
        operation: {
          operationType,
          state: 'CREATED',
          ledgerTransactionId: ids.transaction,
          planReferenceId: ids.plan,
          quoteReferenceId: ids.quote,
        },
        transition: {
          actorAccountId: ids.actor,
          previousState: null,
          nextState: 'CREATED',
          reason: 'INTENT_CREATED',
          ledgerTransactionId: ids.transaction,
          ledgerJournalId: null,
        },
        submissionId: null,
        replayed: false,
      });

      expect(withTransaction).toHaveBeenCalledTimes(1);
      expect(publisher.enqueue).not.toHaveBeenCalled();
      const [sql, values] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('public.create_yield_operation(');
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
      expect(values).toEqual([
        ids.actor,
        ids.operation,
        operationType,
        ids.transaction,
        ids.plan,
        ids.quote,
        '2026-08-24T12:00:00.000Z',
        ids.correlation,
        1,
        idempotency.keyDigest,
        1,
        idempotency.requestFingerprint,
      ]);
      expect(JSON.stringify(query.mock.calls)).not.toContain('create-key');
    },
  );

  it('atomically enqueues exactly one provider/on-chain adapter submission', async () => {
    const { query, withTransaction, publisher, repository } = setup();
    const command = submitCommand();
    const idempotency = createYieldTransitionIdempotencyContext('submit-key', command);
    query.mockResolvedValueOnce(result([row('SUBMITTED')]));
    publisher.enqueue.mockImplementationOnce(async (request: { id?: string }) => {
      expect(loggingContext.current()).toEqual({
        correlationId: ids.correlation,
        initiatorActorId: ids.actor,
        quoteId: ids.quote,
        transactionId: ids.transaction,
      });
      return { id: request.id } as never;
    });

    await expect(repository.transition(command, idempotency)).resolves.toMatchObject({
      submissionId: ids.submission,
      replayed: false,
    });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(publisher.enqueue).toHaveBeenCalledTimes(1);
    expect(publisher.enqueue).toHaveBeenCalledWith({
      id: ids.submission,
      kind: 'yield.operation.submit',
      version: 1,
      occurredAt: '2026-08-24T12:01:00.001Z',
      payload: {
        submissionId: ids.submission,
        operationId: ids.operation,
        operationType: 'ALLOCATE',
        ledgerTransactionId: ids.transaction,
        planReferenceId: ids.plan,
        quoteReferenceId: ids.quote,
      },
      messageAttributes: { operationType: 'ALLOCATE' },
    });
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('public.transition_yield_operation(');
    expect(values).toEqual([
      ids.actor,
      ids.operation,
      'USER_APPROVED',
      'SUBMITTED',
      'SUBMISSION_RECORDED',
      '2026-08-24T12:01:00.000Z',
      null,
      ids.correlation,
      1,
      idempotency.keyDigest,
      1,
      idempotency.requestFingerprint,
    ]);
  });

  it('returns a duplicate submit result without enqueueing another submission', async () => {
    const { query, publisher, repository } = setup();
    const command = submitCommand();
    const idempotency = createYieldTransitionIdempotencyContext('submit-key', command);
    query.mockResolvedValueOnce(result([row('SUBMITTED', 'REPLAYED')]));

    await expect(repository.transition(command, idempotency)).resolves.toMatchObject({
      submissionId: ids.submission,
      replayed: true,
    });
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('maps idempotency conflicts and invalid persisted transitions to fixed errors', async () => {
    const conflict = setup();
    const command = submitCommand();
    const idempotency = createYieldTransitionIdempotencyContext('submit-key', command);
    conflict.query.mockRejectedValue(
      Object.assign(new Error('private fingerprint detail'), { code: 'Y8601' }),
    );
    await expect(conflict.repository.transition(command, idempotency)).rejects.toEqual(
      new YieldOperationIdempotencyError('YIELD_IDEMPOTENCY_CONFLICT'),
    );

    const illegal = setup();
    illegal.query.mockRejectedValue(
      Object.assign(new Error('private state detail'), { code: 'L4201' }),
    );
    await expect(illegal.repository.transition(command, idempotency)).rejects.toEqual(
      new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION'),
    );
  });

  it('rejects malformed or over-disclosed result rows with one fixed persistence error', async () => {
    for (const persisted of [
      [],
      [{ ...row('SUBMITTED'), current_state: 'PENDING' }],
      [{ ...row('SUBMITTED'), submission_id: null }],
      [{ ...row('SUBMITTED'), command_id: 'not-a-command-id' }],
      [{ ...row('SUBMITTED'), ledger_transaction_id: 'not-a-ledger-id' }],
      [{ ...row('SUBMITTED'), provider_secret: 'must-not-pass' }],
    ] as QueryResultRow[][]) {
      const { query, repository } = setup();
      const command = submitCommand();
      query.mockResolvedValueOnce(result(persisted));
      await expect(
        repository.transition(
          command,
          createYieldTransitionIdempotencyContext('submit-key', command),
        ),
      ).rejects.toEqual(new YieldOperationPersistenceError());
    }
  });
});
