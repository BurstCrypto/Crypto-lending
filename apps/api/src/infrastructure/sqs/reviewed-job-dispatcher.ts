import {
  parseBalanceSyncJobEnvelope,
  type BalanceSyncJobEnvelope,
} from '../../blockchain-sync/domain/balance-sync';
import { isMainnetLaunchNetwork } from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  LEDGER_IDEMPOTENCY_OPERATIONS,
  type LedgerIdempotencyOperation,
} from '../../ledger/domain/idempotency';
import {
  YIELD_OPERATION_TYPES,
  type YieldOperationType,
} from '../../yield-operations/domain/yield-operation';
import { isCanonicalUuidV4 } from '../logging';
import { parseJobEnvelope, type JobEnvelope } from '../outbox/job-envelope';
import { REVIEWED_JOB_CONTRACTS } from '../outbox/reviewed-job-contract-policy';

export interface LedgerJournalCommittedJobPayload {
  readonly journalId: string;
  readonly operation: LedgerIdempotencyOperation;
}

export interface YieldOperationSubmitJobPayload {
  readonly submissionId: string;
  readonly operationId: string;
  readonly operationType: YieldOperationType;
  readonly ledgerTransactionId: string;
  readonly planReferenceId: string;
  readonly quoteReferenceId: string;
}

export type LedgerJournalCommittedJobEnvelope = JobEnvelope<LedgerJournalCommittedJobPayload> &
  Readonly<{ kind: 'ledger.journal-committed'; version: 1 }>;

export type YieldOperationSubmitJobEnvelope = JobEnvelope<YieldOperationSubmitJobPayload> &
  Readonly<{ kind: 'yield.operation.submit'; version: 1 }>;

export type BalanceSyncConsumerJobEnvelope = BalanceSyncJobEnvelope &
  Readonly<{ kind: 'blockchain.balance-sync'; version: 1 }>;

export type ReviewedConsumerJobEnvelope =
  | LedgerJournalCommittedJobEnvelope
  | YieldOperationSubmitJobEnvelope
  | BalanceSyncConsumerJobEnvelope;
export type ReviewedGenericConsumerJobEnvelope =
  LedgerJournalCommittedJobEnvelope | YieldOperationSubmitJobEnvelope;

export type ReviewedJobHandler<Job extends ReviewedConsumerJobEnvelope> = (
  job: Job,
) => Promise<void>;

export interface ReviewedJobHandlers {
  readonly 'ledger.journal-committed': ReviewedJobHandler<LedgerJournalCommittedJobEnvelope>;
  readonly 'yield.operation.submit': ReviewedJobHandler<YieldOperationSubmitJobEnvelope>;
}

export type ReviewedJobDispatchErrorCode =
  'INVALID_HANDLER_REGISTRY' | 'UNREVIEWED_JOB' | 'JOB_HANDLER_FAILED';

export class ReviewedJobDispatchError extends Error {
  constructor(readonly code: ReviewedJobDispatchErrorCode) {
    super('Reviewed job dispatch failed');
    this.name = 'ReviewedJobDispatchError';
    Object.freeze(this);
  }
}

const HANDLER_KEYS = Object.freeze(
  REVIEWED_JOB_CONTRACTS.filter(({ kind }) => kind !== 'blockchain.balance-sync').map(
    ({ kind, version }) => `${kind}@${version}`,
  ),
);

const REQUIRED_ENVELOPE_KEYS = Object.freeze([
  'id',
  'kind',
  'version',
  'occurredAt',
  'correlation',
  'payload',
] as const);

function fail(code: ReviewedJobDispatchErrorCode): never {
  throw new ReviewedJobDispatchError(code);
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fail('UNREVIEWED_JOB');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('UNREVIEWED_JOB');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(
        (descriptor) => !descriptor.enumerable || !('value' in descriptor),
      )
    ) {
      return fail('UNREVIEWED_JOB');
    }
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) return fail('UNREVIEWED_JOB');
      copy[key] = descriptor.value;
    }
    return copy;
  } catch (error) {
    if (error instanceof ReviewedJobDispatchError) throw error;
    return fail('UNREVIEWED_JOB');
  }
}

function parseLedgerJob(envelope: JobEnvelope): LedgerJournalCommittedJobEnvelope {
  const record = exactDataRecord(envelope.payload, ['journalId', 'operation']);
  if (
    !isCanonicalUuidV4(record.journalId) ||
    typeof record.operation !== 'string' ||
    !LEDGER_IDEMPOTENCY_OPERATIONS.includes(record.operation as LedgerIdempotencyOperation) ||
    envelope.correlation.ledgerEventId !== record.journalId
  ) {
    return fail('UNREVIEWED_JOB');
  }
  const payload = Object.freeze({
    journalId: record.journalId,
    operation: record.operation as LedgerIdempotencyOperation,
  });
  return Object.freeze({
    ...envelope,
    kind: 'ledger.journal-committed',
    version: 1,
    payload,
  });
}

function parseYieldJob(envelope: JobEnvelope): YieldOperationSubmitJobEnvelope {
  const record = exactDataRecord(envelope.payload, [
    'submissionId',
    'operationId',
    'operationType',
    'ledgerTransactionId',
    'planReferenceId',
    'quoteReferenceId',
  ]);
  for (const field of [
    'submissionId',
    'operationId',
    'ledgerTransactionId',
    'planReferenceId',
    'quoteReferenceId',
  ] as const) {
    if (!isCanonicalUuidV4(record[field])) return fail('UNREVIEWED_JOB');
  }
  if (
    typeof record.operationType !== 'string' ||
    !YIELD_OPERATION_TYPES.includes(record.operationType as YieldOperationType) ||
    envelope.id !== record.submissionId ||
    envelope.correlation.transactionId !== record.ledgerTransactionId ||
    envelope.correlation.quoteId !== record.quoteReferenceId
  ) {
    return fail('UNREVIEWED_JOB');
  }
  const payload = Object.freeze({
    submissionId: record.submissionId as string,
    operationId: record.operationId as string,
    operationType: record.operationType as YieldOperationType,
    ledgerTransactionId: record.ledgerTransactionId as string,
    planReferenceId: record.planReferenceId as string,
    quoteReferenceId: record.quoteReferenceId as string,
  });
  return Object.freeze({
    ...envelope,
    kind: 'yield.operation.submit',
    version: 1,
    payload,
  });
}

/**
 * Parses the exact, current inbound contract. Legacy envelopes are accepted by
 * the transport parser for controlled rollout only; a production business
 * consumer may not execute them.
 */
export function parseReviewedConsumerJobEnvelope(value: unknown): ReviewedConsumerJobEnvelope {
  exactDataRecord(value, REQUIRED_ENVELOPE_KEYS);
  let envelope: JobEnvelope;
  try {
    envelope = parseJobEnvelope(value);
  } catch {
    return fail('UNREVIEWED_JOB');
  }
  if (envelope.kind === 'ledger.journal-committed' && envelope.version === 1) {
    return parseLedgerJob(envelope);
  }
  if (envelope.kind === 'yield.operation.submit' && envelope.version === 1) {
    return parseYieldJob(envelope);
  }
  if (envelope.kind === 'blockchain.balance-sync' && envelope.version === 1) {
    let job: BalanceSyncJobEnvelope;
    try {
      job = parseBalanceSyncJobEnvelope(envelope);
    } catch {
      return fail('UNREVIEWED_JOB');
    }
    if (!isMainnetLaunchNetwork(job.payload.networkId)) return fail('UNREVIEWED_JOB');
    return job as BalanceSyncConsumerJobEnvelope;
  }
  return fail('UNREVIEWED_JOB');
}

export function parseReviewedGenericConsumerJobEnvelope(
  value: unknown,
): ReviewedGenericConsumerJobEnvelope {
  const job = parseReviewedConsumerJobEnvelope(value);
  if (job.kind === 'blockchain.balance-sync') return fail('UNREVIEWED_JOB');
  return job;
}

export function parseBalanceSyncConsumerJobEnvelope(
  value: unknown,
): BalanceSyncConsumerJobEnvelope {
  const job = parseReviewedConsumerJobEnvelope(value);
  if (
    job.kind !== 'blockchain.balance-sync' ||
    job.payload.attempt !== 1 ||
    (job.payload.cause !== 'SCHEDULED' && job.payload.cause !== 'MANUAL_RECOVERY')
  ) {
    return fail('UNREVIEWED_JOB');
  }
  return job;
}

function parseHandlers(value: ReviewedJobHandlers): Readonly<ReviewedJobHandlers> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fail('INVALID_HANDLER_REGISTRY');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('INVALID_HANDLER_REGISTRY');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKinds = HANDLER_KEYS.map((key) => key.slice(0, key.lastIndexOf('@')));
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKinds.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKinds.includes(key)) ||
      expectedKinds.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(
        (descriptor) =>
          !descriptor.enumerable ||
          !('value' in descriptor) ||
          typeof descriptor.value !== 'function',
      )
    ) {
      return fail('INVALID_HANDLER_REGISTRY');
    }
    return Object.freeze({
      'ledger.journal-committed': descriptors['ledger.journal-committed']?.value,
      'yield.operation.submit': descriptors['yield.operation.submit']?.value,
    }) as Readonly<ReviewedJobHandlers>;
  } catch (error) {
    if (error instanceof ReviewedJobDispatchError) throw error;
    return fail('INVALID_HANDLER_REGISTRY');
  }
}

/**
 * Closed dispatcher intended to be passed to SqsJobWorker.processOne. It
 * accepts only ledger/yield contracts and rejects balance traffic before any
 * generic handler can run. No handler is implemented or activated here.
 */
export class ReviewedJobDispatcher {
  private readonly handlers: Readonly<ReviewedJobHandlers>;

  constructor(handlers: ReviewedJobHandlers) {
    this.handlers = parseHandlers(handlers);
  }

  async dispatch(value: unknown): Promise<void> {
    const job = parseReviewedGenericConsumerJobEnvelope(value);
    try {
      switch (job.kind) {
        case 'ledger.journal-committed':
          await this.handlers['ledger.journal-committed'](job);
          return;
        case 'yield.operation.submit':
          await this.handlers['yield.operation.submit'](job);
          return;
      }
    } catch {
      return fail('JOB_HANDLER_FAILED');
    }
  }
}

/**
 * Dormant dedicated balance boundary. Native SQS receipt redrive owns every
 * subsequent attempt, so this ingress accepts only first-attempt source jobs
 * and is intentionally not registered in any module.
 */
export class BalanceSyncJobDispatcher {
  private readonly handler: ReviewedJobHandler<BalanceSyncConsumerJobEnvelope>;

  constructor(handler: ReviewedJobHandler<BalanceSyncConsumerJobEnvelope>) {
    if (typeof handler !== 'function') fail('INVALID_HANDLER_REGISTRY');
    this.handler = handler;
  }

  async dispatch(value: unknown): Promise<void> {
    const job = parseBalanceSyncConsumerJobEnvelope(value);
    try {
      await this.handler(job);
    } catch {
      return fail('JOB_HANDLER_FAILED');
    }
  }
}
