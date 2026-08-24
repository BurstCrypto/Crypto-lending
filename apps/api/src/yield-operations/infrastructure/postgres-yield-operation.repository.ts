import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../infrastructure/database/postgres.service';
import { loggingContext } from '../../infrastructure/logging';
import {
  JOB_PUBLISHER,
  type JobPublisherPort,
} from '../../infrastructure/outbox/job-publisher.port';
import {
  parseLedgerActorAccountId,
  parseLedgerCorrelationId,
  parseLedgerTransactionId,
} from '../../ledger/domain/ledger';
import { LedgerLifecycleValidationError } from '../../ledger/domain/transaction-lifecycle';
import type { YieldOperationRepository } from '../application/yield-operation.repository.port';
import {
  normalizeCreateYieldOperationCommand,
  normalizeTransitionYieldOperationCommand,
  parseYieldOperationId,
  parseYieldPlanReferenceId,
  parseYieldQuoteReferenceId,
  parseYieldSubmissionId,
  parseYieldTransitionEventId,
  type CreateYieldOperationCommand,
  type TransitionYieldOperationCommand,
  type YieldOperationCommandResult,
  type YieldOperationTransitionRecord,
  type YieldOperationType,
} from '../domain/yield-operation';
import {
  normalizeYieldOperationIdempotencyContext,
  YieldOperationIdempotencyError,
  type YieldOperationIdempotencyContext,
} from '../domain/yield-operation-idempotency';

const IDEMPOTENCY_CONFLICT_SQL_STATE = 'Y8601';
const ILLEGAL_LIFECYCLE_SQL_STATE = 'L4201';

interface YieldOperationResultRow extends QueryResultRow {
  command_id: string;
  operation_id: string;
  operation_type: string;
  current_state: string;
  ledger_transaction_id: string;
  plan_reference_id: string;
  quote_reference_id: string;
  operation_recorded_at: Date;
  transition_event_id: string;
  actor_account_id: string;
  previous_state: string | null;
  next_state: string;
  reason_code: string;
  effective_at: Date;
  transition_recorded_at: Date;
  correlation_id: string;
  ledger_journal_id: string | null;
  submission_id: string | null;
  outcome: 'COMMITTED' | 'REPLAYED';
}

export class YieldOperationPersistenceError extends Error {
  readonly code = 'YIELD_OPERATION_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Yield operation persistence failed');
    this.name = 'YieldOperationPersistenceError';
  }
}

function postgresErrorCode(value: unknown): string | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'code');
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function persistenceError(error: unknown): never {
  const code = postgresErrorCode(error);
  if (code === IDEMPOTENCY_CONFLICT_SQL_STATE) {
    throw new YieldOperationIdempotencyError('YIELD_IDEMPOTENCY_CONFLICT');
  }
  if (code === ILLEGAL_LIFECYCLE_SQL_STATE) {
    throw new LedgerLifecycleValidationError('ILLEGAL_LIFECYCLE_TRANSITION');
  }
  throw new YieldOperationPersistenceError();
}

function finiteTimestamp(value: unknown): string {
  if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
    throw new YieldOperationPersistenceError();
  }
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new YieldOperationPersistenceError();
  return new Date(milliseconds).toISOString();
}

function operationType(value: unknown): YieldOperationType {
  if (value === 'ALLOCATE' || value === 'WITHDRAW' || value === 'REBALANCE') return value;
  throw new YieldOperationPersistenceError();
}

function returnedResult(rows: readonly YieldOperationResultRow[]): YieldOperationCommandResult {
  if (!Array.isArray(rows) || rows.length !== 1) throw new YieldOperationPersistenceError();
  const row: unknown = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new YieldOperationPersistenceError();
  }
  const prototype = Object.getPrototypeOf(row);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new YieldOperationPersistenceError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(row);
  const expectedKeys = [
    'command_id',
    'operation_id',
    'operation_type',
    'current_state',
    'ledger_transaction_id',
    'plan_reference_id',
    'quote_reference_id',
    'operation_recorded_at',
    'transition_event_id',
    'actor_account_id',
    'previous_state',
    'next_state',
    'reason_code',
    'effective_at',
    'transition_recorded_at',
    'correlation_id',
    'ledger_journal_id',
    'submission_id',
    'outcome',
  ] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key as never))
  ) {
    throw new YieldOperationPersistenceError();
  }
  const read = (key: (typeof expectedKeys)[number]): unknown => {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new YieldOperationPersistenceError();
    }
    return descriptor.value;
  };

  const commandId = read('command_id');
  const operationId = parseYieldOperationId(read('operation_id'));
  const type = operationType(read('operation_type'));
  const currentState = read('current_state');
  const previousState = read('previous_state');
  const nextState = read('next_state');
  const reason = read('reason_code');
  const ledgerTransactionId = read('ledger_transaction_id');
  const ledgerJournalId = read('ledger_journal_id');
  const effectiveAt = finiteTimestamp(read('effective_at'));
  const operationRecordedAt = finiteTimestamp(read('operation_recorded_at'));
  const transitionRecordedAt = finiteTimestamp(read('transition_recorded_at'));
  const outcome = read('outcome');
  const submission = read('submission_id');
  if (
    typeof commandId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(commandId) ||
    (previousState !== null && typeof previousState !== 'string') ||
    typeof currentState !== 'string' ||
    typeof nextState !== 'string' ||
    currentState !== nextState ||
    typeof reason !== 'string' ||
    typeof ledgerTransactionId !== 'string' ||
    (ledgerJournalId !== null && typeof ledgerJournalId !== 'string') ||
    (outcome !== 'COMMITTED' && outcome !== 'REPLAYED') ||
    (nextState === 'SUBMITTED') !== (submission !== null)
  ) {
    throw new YieldOperationPersistenceError();
  }

  // Re-run public domain normalization over the database projection. Besides
  // checking the canonical transition table, this enforces journal shape.
  const transition =
    previousState === null
      ? normalizeCreateYieldOperationCommand({
          actorAccountId: read('actor_account_id'),
          correlationId: read('correlation_id'),
          operationId,
          operationType: type,
          ledgerTransactionId,
          planReferenceId: read('plan_reference_id'),
          quoteReferenceId: read('quote_reference_id'),
          effectiveAt,
        })
      : normalizeTransitionYieldOperationCommand({
          actorAccountId: read('actor_account_id'),
          correlationId: read('correlation_id'),
          operationId,
          expectedState: previousState,
          nextState,
          reason,
          effectiveAt,
          ledgerJournalId,
        });

  if (previousState === null && (nextState !== 'CREATED' || reason !== 'INTENT_CREATED')) {
    throw new YieldOperationPersistenceError();
  }
  const actorAccountId = parseLedgerActorAccountId(read('actor_account_id'));
  const correlationId = parseLedgerCorrelationId(read('correlation_id'));
  const canonicalLedgerTransactionId = parseLedgerTransactionId(ledgerTransactionId);
  const transitionRecord: YieldOperationTransitionRecord = Object.freeze({
    eventId: parseYieldTransitionEventId(read('transition_event_id')),
    operationId,
    actorAccountId,
    previousState: previousState as YieldOperationTransitionRecord['previousState'],
    nextState: nextState as YieldOperationTransitionRecord['nextState'],
    reason: reason as YieldOperationTransitionRecord['reason'],
    effectiveAt: transition.effectiveAt,
    recordedAt: transitionRecordedAt as YieldOperationTransitionRecord['recordedAt'],
    correlationId,
    ledgerTransactionId:
      'ledgerTransactionId' in transition
        ? transition.ledgerTransactionId
        : canonicalLedgerTransactionId,
    ledgerJournalId: 'ledgerJournalId' in transition ? transition.ledgerJournalId : null,
  });

  return Object.freeze({
    operation: Object.freeze({
      operationId,
      operationType: type,
      state: transitionRecord.nextState,
      ledgerTransactionId: transitionRecord.ledgerTransactionId,
      planReferenceId: parseYieldPlanReferenceId(read('plan_reference_id')),
      quoteReferenceId: parseYieldQuoteReferenceId(read('quote_reference_id')),
      recordedAt: operationRecordedAt as YieldOperationCommandResult['operation']['recordedAt'],
    }),
    transition: transitionRecord,
    submissionId: submission === null ? null : parseYieldSubmissionId(submission),
    replayed: outcome === 'REPLAYED',
  });
}

function idempotencyValues(context: YieldOperationIdempotencyContext): readonly unknown[] {
  return [
    context.contractVersion,
    context.keyDigest,
    context.fingerprintVersion,
    context.requestFingerprint,
  ];
}

@Injectable()
export class PostgresYieldOperationRepository implements YieldOperationRepository {
  constructor(
    private readonly postgres: PostgresService,
    @Inject(JOB_PUBLISHER) private readonly publisher: JobPublisherPort,
  ) {}

  async create(
    command: CreateYieldOperationCommand,
    idempotency: YieldOperationIdempotencyContext,
  ): Promise<YieldOperationCommandResult> {
    try {
      const normalized = normalizeCreateYieldOperationCommand(command);
      const normalizedIdempotency = normalizeYieldOperationIdempotencyContext(idempotency);
      if (
        normalizedIdempotency.commandKind !== 'CREATE' ||
        normalizedIdempotency.actorAccountId !== normalized.actorAccountId
      ) {
        throw new YieldOperationPersistenceError();
      }
      return await this.postgres.withTransaction(async () => {
        const result = await this.postgres.query<YieldOperationResultRow>(
          `SELECT created.*
           FROM public.create_yield_operation(
             $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::uuid,
             $7::timestamptz, $8::uuid, $9::smallint, $10::text,
             $11::smallint, $12::text
           ) AS created`,
          [
            normalized.actorAccountId,
            normalized.operationId,
            normalized.operationType,
            normalized.ledgerTransactionId,
            normalized.planReferenceId,
            normalized.quoteReferenceId,
            normalized.effectiveAt,
            normalized.correlationId,
            ...idempotencyValues(normalizedIdempotency),
          ],
        );
        return returnedResult(result.rows);
      });
    } catch (error) {
      persistenceError(error);
    }
  }

  async transition(
    command: TransitionYieldOperationCommand,
    idempotency: YieldOperationIdempotencyContext,
  ): Promise<YieldOperationCommandResult> {
    try {
      const normalized = normalizeTransitionYieldOperationCommand(command);
      const normalizedIdempotency = normalizeYieldOperationIdempotencyContext(idempotency);
      if (
        normalizedIdempotency.commandKind !== 'TRANSITION' ||
        normalizedIdempotency.actorAccountId !== normalized.actorAccountId
      ) {
        throw new YieldOperationPersistenceError();
      }
      return await this.postgres.withTransaction(async () => {
        const result = await this.postgres.query<YieldOperationResultRow>(
          `SELECT transitioned.*
           FROM public.transition_yield_operation(
             $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
             $6::timestamptz, $7::uuid, $8::uuid, $9::smallint,
             $10::text, $11::smallint, $12::text
           ) AS transitioned`,
          [
            normalized.actorAccountId,
            normalized.operationId,
            normalized.expectedState,
            normalized.nextState,
            normalized.reason,
            normalized.effectiveAt,
            normalized.ledgerJournalId,
            normalized.correlationId,
            ...idempotencyValues(normalizedIdempotency),
          ],
        );
        const operation = returnedResult(result.rows);
        if (operation.submissionId !== null && !operation.replayed) {
          await this.enqueueSubmission(operation);
        }
        return operation;
      });
    } catch (error) {
      persistenceError(error);
    }
  }

  private async enqueueSubmission(operation: YieldOperationCommandResult): Promise<void> {
    const submissionId = operation.submissionId;
    if (submissionId === null || operation.transition.nextState !== 'SUBMITTED') {
      throw new YieldOperationPersistenceError();
    }
    const activeContext = loggingContext.current();
    if (
      activeContext &&
      (activeContext.correlationId !== operation.transition.correlationId ||
        (activeContext.initiatorActorId !== undefined &&
          activeContext.initiatorActorId !== operation.transition.actorAccountId))
    ) {
      throw new YieldOperationPersistenceError();
    }
    const enqueue = (): ReturnType<JobPublisherPort['enqueue']> =>
      this.publisher.enqueue({
        id: submissionId,
        kind: 'yield.operation.submit',
        version: 1,
        occurredAt: operation.transition.recordedAt,
        payload: Object.freeze({
          submissionId,
          operationId: operation.operation.operationId,
          operationType: operation.operation.operationType,
          ledgerTransactionId: operation.operation.ledgerTransactionId,
          planReferenceId: operation.operation.planReferenceId,
          quoteReferenceId: operation.operation.quoteReferenceId,
        }),
        messageAttributes: Object.freeze({ operationType: operation.operation.operationType }),
      });
    const envelope = await (activeContext
      ? loggingContext.runWith(
          {
            initiatorActorId: operation.transition.actorAccountId,
            quoteId: operation.operation.quoteReferenceId,
            transactionId: operation.operation.ledgerTransactionId,
          },
          enqueue,
        )
      : loggingContext.run(
          {
            correlationId: operation.transition.correlationId,
            initiatorActorId: operation.transition.actorAccountId,
            quoteId: operation.operation.quoteReferenceId,
            transactionId: operation.operation.ledgerTransactionId,
          },
          enqueue,
        ));
    if (envelope.id !== submissionId) throw new YieldOperationPersistenceError();
  }
}
