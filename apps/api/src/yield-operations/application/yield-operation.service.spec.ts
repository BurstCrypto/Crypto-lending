import { loggingContext } from '../../infrastructure/logging';
import type { LedgerActorResolver } from '../../ledger/application/ledger-actor-resolver.port';
import {
  parseLedgerActorAccountId,
  parseLedgerCorrelationId,
  parseLedgerTransactionId,
  type LedgerTimestamp,
} from '../../ledger/domain/ledger';
import type {
  CreateYieldOperationCommand,
  TransitionYieldOperationCommand,
  YieldOperationCommandResult,
  YieldOperationType,
} from '../domain/yield-operation';
import {
  parseYieldOperationId,
  parseYieldPlanReferenceId,
  parseYieldQuoteReferenceId,
  parseYieldSubmissionId,
  parseYieldTransitionEventId,
} from '../domain/yield-operation';
import type { YieldOperationIdempotencyContext } from '../domain/yield-operation-idempotency';
import type { YieldOperationRepository } from './yield-operation.repository.port';
import {
  YieldOperationCommandContextError,
  YieldOperationService,
} from './yield-operation.service';

const ids = {
  actor: '00000000-0000-4000-8000-000000000001',
  otherActor: '00000000-0000-4000-8000-000000000002',
  correlation: '00000000-0000-4000-8000-000000000003',
  operation: '00000000-0000-4000-8000-000000000004',
  transaction: '00000000-0000-4000-8000-000000000005',
  plan: '00000000-0000-4000-8000-000000000006',
  quote: '00000000-0000-4000-8000-000000000007',
  createEvent: '00000000-0000-4000-8000-000000000008',
  submitEvent: '00000000-0000-4000-8000-000000000009',
  submission: '00000000-0000-4000-8000-00000000000a',
} as const;

const timestamp = (value: string): LedgerTimestamp => value as LedgerTimestamp;

function actorResolver(actorId: string | null = ids.actor): jest.Mocked<LedgerActorResolver> {
  return {
    resolve: jest
      .fn()
      .mockResolvedValue(actorId === null ? null : parseLedgerActorAccountId(actorId)),
  };
}

function result(
  operationType: YieldOperationType,
  state: 'CREATED' | 'SUBMITTED',
  replayed: boolean,
): YieldOperationCommandResult {
  const submitted = state === 'SUBMITTED';
  return Object.freeze({
    operation: Object.freeze({
      operationId: parseYieldOperationId(ids.operation),
      operationType,
      state,
      ledgerTransactionId: parseLedgerTransactionId(ids.transaction),
      planReferenceId: parseYieldPlanReferenceId(ids.plan),
      quoteReferenceId: parseYieldQuoteReferenceId(ids.quote),
      recordedAt: timestamp('2026-08-24T12:00:00.000Z'),
    }),
    transition: Object.freeze({
      eventId: parseYieldTransitionEventId(submitted ? ids.submitEvent : ids.createEvent),
      operationId: parseYieldOperationId(ids.operation),
      actorAccountId: parseLedgerActorAccountId(ids.actor),
      previousState: submitted ? 'USER_APPROVED' : null,
      nextState: state,
      reason: submitted ? 'SUBMISSION_RECORDED' : 'INTENT_CREATED',
      effectiveAt: timestamp(submitted ? '2026-08-24T12:01:00.000Z' : '2026-08-24T12:00:00.000Z'),
      recordedAt: timestamp(submitted ? '2026-08-24T12:01:00.001Z' : '2026-08-24T12:00:00.001Z'),
      correlationId: parseLedgerCorrelationId(ids.correlation),
      ledgerTransactionId: parseLedgerTransactionId(ids.transaction),
      ledgerJournalId: null,
    }),
    submissionId: submitted ? parseYieldSubmissionId(ids.submission) : null,
    replayed,
  });
}

function repositoryStub(): jest.Mocked<YieldOperationRepository> {
  return {
    create: jest.fn<
      ReturnType<YieldOperationRepository['create']>,
      [CreateYieldOperationCommand, YieldOperationIdempotencyContext]
    >(async (command) => result(command.operationType, 'CREATED', false)),
    transition: jest.fn<
      ReturnType<YieldOperationRepository['transition']>,
      [TransitionYieldOperationCommand, YieldOperationIdempotencyContext]
    >(async () => result('ALLOCATE', 'SUBMITTED', false)),
  };
}

describe('YieldOperationService', () => {
  it.each(['ALLOCATE', 'WITHDRAW', 'REBALANCE'] as const)(
    'creates an idempotent %s command from trusted actor and correlation context',
    async (operationType) => {
      const repository = repositoryStub();
      const resolver = actorResolver();
      const service = new YieldOperationService(repository, resolver);

      await expect(
        loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
          service.create(
            {
              operationId: ids.operation,
              operationType,
              ledgerTransactionId: ids.transaction,
              planReferenceId: ids.plan,
              quoteReferenceId: ids.quote,
              effectiveAt: new Date('2026-08-24T12:00:00.000Z'),
            },
            `${operationType.toLowerCase()}-key`,
          ),
        ),
      ).resolves.toMatchObject({ operation: { operationType, state: 'CREATED' } });

      expect(resolver.resolve).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledTimes(1);
      const [command, idempotency] = repository.create.mock.calls[0] ?? [];
      expect(command).toMatchObject({
        actorAccountId: ids.actor,
        correlationId: ids.correlation,
        operationType,
        ledgerTransactionId: ids.transaction,
        planReferenceId: ids.plan,
        quoteReferenceId: ids.quote,
      });
      expect(idempotency).toMatchObject({
        actorAccountId: ids.actor,
        commandKind: 'CREATE',
        contractVersion: 1,
        fingerprintVersion: 1,
      });
      expect(JSON.stringify([command, idempotency])).not.toContain(`${operationType}-key`);
    },
  );

  it('normalizes a submit transition before persistence', async () => {
    const repository = repositoryStub();
    const service = new YieldOperationService(repository, actorResolver());

    await loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
      service.transition(
        {
          operationId: ids.operation,
          expectedState: 'USER_APPROVED',
          nextState: 'SUBMITTED',
          reason: 'SUBMISSION_RECORDED',
          effectiveAt: new Date('2026-08-24T12:01:00.000Z'),
          ledgerJournalId: null,
        },
        'submit-key',
      ),
    );

    const [command, idempotency] = repository.transition.mock.calls[0] ?? [];
    expect(command).toEqual({
      actorAccountId: ids.actor,
      correlationId: ids.correlation,
      operationId: ids.operation,
      expectedState: 'USER_APPROVED',
      nextState: 'SUBMITTED',
      reason: 'SUBMISSION_RECORDED',
      effectiveAt: '2026-08-24T12:01:00.000Z',
      ledgerJournalId: null,
    });
    expect(idempotency).toMatchObject({ commandKind: 'TRANSITION' });
  });

  it('returns the same result for a duplicate submit while the repository creates one submission', async () => {
    const submissions: string[] = [];
    const byFingerprint = new Map<string, YieldOperationCommandResult>();
    const repository: YieldOperationRepository = {
      create: async (command) => result(command.operationType, 'CREATED', false),
      transition: async (
        _command: TransitionYieldOperationCommand,
        idempotency: YieldOperationIdempotencyContext,
      ) => {
        const cached = byFingerprint.get(idempotency.keyDigest);
        if (cached) return { ...cached, replayed: true };
        submissions.push(ids.submission);
        const committed = result('ALLOCATE', 'SUBMITTED', false);
        byFingerprint.set(idempotency.keyDigest, committed);
        return committed;
      },
    };
    const service = new YieldOperationService(repository, actorResolver());
    const submit = (): Promise<YieldOperationCommandResult> =>
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
        service.transition(
          {
            operationId: ids.operation,
            expectedState: 'USER_APPROVED',
            nextState: 'SUBMITTED',
            reason: 'SUBMISSION_RECORDED',
            effectiveAt: new Date('2026-08-24T12:01:00.000Z'),
            ledgerJournalId: null,
          },
          'same-submit-key',
        ),
      );

    const first = await submit();
    const replay = await submit();

    expect(first.submissionId).toBe(ids.submission);
    expect(replay).toMatchObject({ submissionId: ids.submission, replayed: true });
    expect(submissions).toEqual([ids.submission]);
  });

  it('rejects missing and spoofed authenticated context before persistence', async () => {
    const repository = repositoryStub();
    const service = new YieldOperationService(repository, actorResolver());
    const input = {
      operationId: ids.operation,
      operationType: 'ALLOCATE',
      ledgerTransactionId: ids.transaction,
      planReferenceId: ids.plan,
      quoteReferenceId: ids.quote,
      effectiveAt: new Date('2026-08-24T12:00:00.000Z'),
    };

    await expect(service.create(input, 'create-key')).rejects.toEqual(
      new YieldOperationCommandContextError(),
    );
    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.otherActor }, () =>
        service.create(input, 'create-key'),
      ),
    ).rejects.toEqual(new YieldOperationCommandContextError());
    expect(repository.create).not.toHaveBeenCalled();
  });
});
