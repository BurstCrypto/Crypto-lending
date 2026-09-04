import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  type MessageAttributeValue,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import {
  createSafeLogReference,
  loggingContext,
  structuredLogger,
  StructuredLogger,
  type StructuredLogRecord,
} from '../../src/infrastructure/logging';
import {
  createJobEnvelope,
  parseJobEnvelope,
  type JobCorrelationContext,
  type JobEnvelope,
} from '../../src/infrastructure/outbox/job-envelope';
import {
  MAX_CUSTOM_JOB_ATTRIBUTES,
  MAX_JOB_MESSAGE_BYTES,
  serializeJobMessage,
} from '../../src/infrastructure/outbox/job-message-policy';
import {
  JobOutboxRepository,
  type ClaimedOutboxJob,
} from '../../src/infrastructure/outbox/job-outbox.repository';
import type { OutboxDispatcherOptions } from '../../src/infrastructure/outbox/outbox-dispatcher.options';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/outbox-dispatcher.service';
import type {
  EnqueueJobRequest,
  LedgerOutboxLink,
} from '../../src/infrastructure/outbox/job-publisher.port';
import type {
  OutboxTransport,
  OutboxTransportMessage,
  OutboxTransportReceipt,
} from '../../src/infrastructure/outbox/outbox-transport.port';
import { OutboxWorker } from '../../src/infrastructure/outbox/outbox-worker.service';
import { TransactionalJobPublisher } from '../../src/infrastructure/outbox/transactional-job-publisher.service';
import { SqsJobWorker } from '../../src/infrastructure/sqs/sqs-job.worker';
import { SqsService } from '../../src/infrastructure/sqs/sqs.service';
import {
  adversarialProviderError,
  LOGGING_PROHIBITED_VALUES,
} from '../fixtures/logging-adversarial.fixture';
import { testInfrastructureConfig, testOutboxDispatcherOptions } from './fixtures';

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function testCorrelation(offset: number): Readonly<JobCorrelationContext> {
  const correlationId = testUuid(offset);
  return Object.freeze({
    correlationId,
    requestId: correlationId,
    initiatorActorId: testUuid(offset + 1),
    intentId: testUuid(offset + 2),
    quoteId: testUuid(offset + 3),
    transactionId: testUuid(offset + 4),
    ledgerEventId: testUuid(offset + 5),
  });
}

const DEFAULT_CORRELATION = testCorrelation(10);

type ReviewedLedgerPayload = Readonly<{
  journalId: string;
  operation: 'POST_JOURNAL';
}>;

function reviewedLedgerRequest(
  id: string,
  correlation: Readonly<JobCorrelationContext> = DEFAULT_CORRELATION,
): EnqueueJobRequest<ReviewedLedgerPayload> & { readonly ledgerLink: LedgerOutboxLink } {
  const journalId = correlation.ledgerEventId ?? testUuid(900);
  return Object.freeze({
    id,
    kind: 'ledger.journal-committed',
    version: 1,
    occurredAt: '2026-08-18T00:00:00.000Z',
    payload: Object.freeze({ journalId, operation: 'POST_JOURNAL' }),
    correlation,
    ledgerLink: Object.freeze({ commandId: testUuid(901), journalId }),
  });
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

type StoredJobEnvelope = Omit<JobEnvelope, 'correlation'> & {
  readonly correlation?: JobCorrelationContext;
};

interface StoredJob {
  id: string;
  destination: string;
  envelope: StoredJobEnvelope;
  messageAttributes: Readonly<Record<string, string>>;
  ledgerLink?: LedgerOutboxLink;
  status: 'pending' | 'published' | 'failed';
  attempts: number;
  availableAt: number;
  failedAt?: number;
  lastError?: string;
  lockedBy?: string;
  lockedUntil?: number;
  publishedAt?: number;
}

function queryResult<Row extends QueryResultRow>(
  rows: Row[] = [],
  rowCount = rows.length,
): QueryResult<Row> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

class TransactionalOutboxHarness {
  now = 0;
  readonly queries: string[] = [];
  private committed: StoredJob[] = [];
  private transaction: StoredJob[] | undefined;

  readonly client = {
    query: (text: string, values?: unknown[]): Promise<QueryResult> => this.query(text, values),
    release: (): void => undefined,
  } as unknown as PoolClient;

  readonly pool = {
    connect: async (): Promise<PoolClient> => this.client,
    query: (text: string, values?: unknown[]): Promise<QueryResult> => this.query(text, values),
    end: async (): Promise<void> => undefined,
  } as unknown as Pool;

  advance(milliseconds: number): void {
    this.now += milliseconds;
  }

  job(id: string): StoredJob | undefined {
    return this.committed.find((job) => job.id === id);
  }

  seed(job: StoredJob): void {
    this.committed.push(cloneJson(job));
  }

  private async query(text: string, values: unknown[] = []): Promise<QueryResult> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.queries.push(normalized);

    if (normalized.startsWith('BEGIN')) {
      this.transaction = cloneJson(this.committed);
      return queryResult();
    }
    if (normalized === 'COMMIT') {
      this.committed = this.transaction ?? this.committed;
      this.transaction = undefined;
      return queryResult();
    }
    if (normalized === 'ROLLBACK') {
      this.transaction = undefined;
      return queryResult();
    }
    if (normalized.startsWith('SELECT enqueue_reviewed_job_v1(')) {
      if (!this.transaction) {
        throw new Error('test insert occurred outside transaction');
      }
      const [id, destination, rawEnvelope, rawAttributes, commandId, journalId] = values;
      this.transaction.push({
        id: String(id),
        destination: String(destination),
        envelope: JSON.parse(String(rawEnvelope)) as JobEnvelope,
        messageAttributes: JSON.parse(String(rawAttributes)) as Record<string, string>,
        ...(commandId == null || journalId == null
          ? {}
          : { ledgerLink: { commandId: String(commandId), journalId: String(journalId) } }),
        status: 'pending',
        attempts: 0,
        availableAt: this.now,
      });
      return queryResult([], 1);
    }
    if (normalized.startsWith('WITH published_expired AS')) {
      const [rawPublishedRetentionMs, rawFailedRetentionMs, rawBatchSize] = values;
      const publishedBefore = this.now - Number(rawPublishedRetentionMs);
      const failedBefore = this.now - Number(rawFailedRetentionMs);
      const target = this.transaction ?? this.committed;
      const expiredIds = new Set(
        target
          .filter(
            (job) =>
              (job.status === 'published' &&
                job.publishedAt !== undefined &&
                job.publishedAt < publishedBefore) ||
              (job.status === 'failed' &&
                job.failedAt !== undefined &&
                job.failedAt < failedBefore),
          )
          .sort(
            (left, right) =>
              (left.status === 'published'
                ? (left.publishedAt ?? 0) + Number(rawPublishedRetentionMs)
                : (left.failedAt ?? 0) + Number(rawFailedRetentionMs)) -
                (right.status === 'published'
                  ? (right.publishedAt ?? 0) + Number(rawPublishedRetentionMs)
                  : (right.failedAt ?? 0) + Number(rawFailedRetentionMs)) ||
              left.id.localeCompare(right.id),
          )
          .slice(0, Number(rawBatchSize))
          .map((job) => job.id),
      );
      if (this.transaction) {
        this.transaction = this.transaction.filter((job) => !expiredIds.has(job.id));
      } else {
        this.committed = this.committed.filter((job) => !expiredIds.has(job.id));
      }
      return queryResult(
        [...expiredIds].map((id) => ({ id })),
        expiredIds.size,
      );
    }
    if (normalized.startsWith('WITH candidates AS')) {
      const [claimToken, rawBatchSize, rawLeaseMs, rawMaxAttempts] = values;
      const batchSize = Number(rawBatchSize);
      const leaseMs = Number(rawLeaseMs);
      const maxAttempts = Number(rawMaxAttempts);
      const jobs = (this.transaction ?? this.committed)
        .filter(
          (job) =>
            job.status === 'pending' &&
            job.availableAt <= this.now &&
            (job.lockedUntil === undefined || job.lockedUntil <= this.now) &&
            job.attempts < maxAttempts,
        )
        .slice(0, batchSize);
      for (const job of jobs) {
        job.lockedBy = String(claimToken);
        job.lockedUntil = this.now + leaseMs;
      }
      return queryResult(
        jobs.map((job) => ({
          id: job.id,
          queue_name: job.destination,
          payload: job.envelope,
          message_attributes: job.messageAttributes,
          ledger_command_id: job.ledgerLink?.commandId ?? null,
          ledger_journal_id: job.ledgerLink?.journalId ?? null,
          attempts: job.attempts,
        })),
      );
    }
    if (normalized.includes("SET status = 'published'")) {
      const [id, claimToken] = values;
      const job = this.committed.find(
        (candidate) =>
          candidate.id === id &&
          candidate.status === 'pending' &&
          candidate.lockedBy === claimToken,
      );
      if (!job) {
        return queryResult([], 0);
      }
      job.status = 'published';
      job.publishedAt = this.now;
      delete job.lastError;
      delete job.failedAt;
      delete job.lockedBy;
      delete job.lockedUntil;
      return queryResult([], 1);
    }
    if (normalized.includes('SET attempts = attempts + 1')) {
      const [id, claimToken, errorCode, rawTerminal, rawRetryDelay] = values;
      const job = this.committed.find(
        (candidate) =>
          candidate.id === id &&
          candidate.status === 'pending' &&
          candidate.lockedBy === claimToken,
      );
      if (!job) {
        return queryResult();
      }
      job.attempts += 1;
      job.lastError = String(errorCode);
      job.status = rawTerminal ? 'failed' : 'pending';
      if (!rawTerminal) {
        job.availableAt = this.now + Number(rawRetryDelay);
        delete job.failedAt;
      } else {
        job.failedAt = this.now;
      }
      delete job.lockedBy;
      delete job.lockedUntil;
      return queryResult([{ status: job.status }]);
    }
    return queryResult();
  }
}

function dispatcherOptions(
  overrides: Partial<OutboxDispatcherOptions> = {},
): OutboxDispatcherOptions {
  return testOutboxDispatcherOptions(overrides);
}

async function enqueueCommitted(
  postgres: PostgresService,
  publisher: TransactionalJobPublisher,
  id: string,
): Promise<JobEnvelope> {
  return postgres.withTransaction(() => publisher.enqueue(reviewedLedgerRequest(id)));
}

describe('transactional job outbox', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects envelope identifiers and timestamps that cannot support deduplication', () => {
    expect(() => createJobEnvelope('sample', {}, { id: '  ' })).toThrow('Job id must be trimmed');
    expect(() => createJobEnvelope('sample', {}, { occurredAt: 'not-a-timestamp' })).toThrow(
      'canonical ISO-8601',
    );
    expect(() =>
      parseJobEnvelope({
        id: '',
        kind: 'sample',
        version: 1,
        occurredAt: '2026-08-18T00:00:00.000Z',
        payload: {},
      }),
    ).toThrow('Invalid job envelope');
  });

  it('inherits and durably projects only the active correlation context', () => {
    const activeCorrelation = testCorrelation(20);
    const parentJobId = createSafeLogReference('job', 'unrelated-parent-job');
    if (!parentJobId) throw new Error('Expected a diagnostic job reference');
    const envelope = loggingContext.run(
      {
        ...activeCorrelation,
        jobId: parentJobId,
      },
      () =>
        createJobEnvelope(
          'sample.correlated',
          {},
          {
            id: 'correlated-job',
            occurredAt: '2026-08-21T00:00:00.000Z',
          },
        ),
    );

    expect(envelope.correlation).toEqual(activeCorrelation);
    expect(envelope.correlation).not.toHaveProperty('jobId');
    expect(parseJobEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  it('keeps active correlation authoritative and preserves it for child jobs', () => {
    const activeCorrelation = testCorrelation(70);
    const parentJobId = createSafeLogReference('job', 'parent-job');
    if (!parentJobId) throw new Error('Expected a diagnostic job reference');

    loggingContext.run({ ...activeCorrelation, jobId: parentJobId }, () => {
      const child = createJobEnvelope('account.updated', {}, { id: 'child-job' });
      expect(child.correlation).toEqual(activeCorrelation);
      expect(() =>
        createJobEnvelope(
          'account.updated',
          {},
          {
            correlation: testCorrelation(80),
          },
        ),
      ).toThrow('must match the active logging context');
    });
  });

  it('gives legacy envelopes a deterministic correlation without copying their opaque ID', () => {
    const legacy = {
      id: 'private-key-shaped-legacy-job',
      kind: 'sample.legacy',
      version: 1,
      occurredAt: '2026-08-18T00:00:00.000Z',
      payload: {},
    };

    const first = parseJobEnvelope(legacy);
    const second = parseJobEnvelope(cloneJson(legacy));
    expect(first.correlation).toEqual(second.correlation);
    expect(first.correlation.correlationId).toMatch(/^legacy:[a-f0-9]{64}$/u);
    expect(first.correlation.correlationId).not.toContain(legacy.id);
  });

  it('rejects unknown or unsafe correlation metadata instead of serializing it', () => {
    const base = {
      id: 'unsafe-correlation-job',
      kind: 'sample.invalid-correlation',
      version: 1,
      occurredAt: '2026-08-18T00:00:00.000Z',
      payload: {},
    };
    expect(() =>
      parseJobEnvelope({
        ...base,
        correlation: { correlationId: 'corr-safe', authorization: 'Bearer do-not-store' },
      }),
    ).toThrow('Invalid job envelope');
    expect(() =>
      parseJobEnvelope({ ...base, correlation: { correlationId: 'corr\nforged' } }),
    ).toThrow('Invalid job envelope');
    expect(() => parseJobEnvelope({ ...base, correlation: undefined })).toThrow(
      'Invalid job envelope',
    );
    expect(() =>
      createJobEnvelope(
        'account.updated',
        {},
        {
          correlation: null as unknown as JobCorrelationContext,
        },
      ),
    ).toThrow('Invalid job correlation context');
  });

  it('rejects an explicit null correlation at the transactional publisher boundary', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const publisher = new TransactionalJobPublisher(new JobOutboxRepository(postgres));

    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({
          kind: 'account.updated',
          payload: {},
          correlation: null as unknown as JobCorrelationContext,
        }),
      ),
    ).rejects.toThrow('Invalid job correlation context');
    expect(harness.queries.some((sql) => sql.includes('enqueue_reviewed_job_v1'))).toBe(false);
  });

  it('does not inherit envelope options or metadata through prototypes and accessors', () => {
    const polluted = Object.prototype as { correlation?: JobCorrelationContext };
    polluted.correlation = testCorrelation(90);
    let inheritedReads = 0;
    const inherited = Object.create({
      constructor: Object,
      get correlationId() {
        inheritedReads += 1;
        return testUuid(100);
      },
    });
    try {
      const envelope = createJobEnvelope('account.updated', {});
      expect(envelope.correlation).not.toEqual(polluted.correlation);
      expect(() =>
        parseJobEnvelope({
          id: 'inherited-correlation',
          kind: 'account.updated',
          version: 1,
          occurredAt: '2026-08-18T00:00:00.000Z',
          correlation: inherited,
          payload: {},
        }),
      ).toThrow('Invalid job envelope');
      expect(inheritedReads).toBe(0);
    } finally {
      delete polluted.correlation;
    }
  });

  it('serializes a canonical data clone without honoring inherited or payload toJSON hooks', () => {
    const envelope = createJobEnvelope(
      'account.updated',
      { accountId: 'safe-account-alias' },
      { id: 'original-job', correlation: DEFAULT_CORRELATION },
    );
    const polluted = Object.prototype as { toJSON?: () => unknown };
    polluted.toJSON = () => ({
      id: 'BearerTokenCANARY',
      kind: 'account.updated',
      version: 1,
      occurredAt: '2026-08-18T00:00:00.000Z',
      correlation: testCorrelation(110),
      payload: {},
    });
    try {
      const serialized = serializeJobMessage(envelope, {});
      expect(parseJobEnvelope(JSON.parse(serialized.body))).toMatchObject({
        id: 'original-job',
        payload: { accountId: 'safe-account-alias' },
      });
      expect(serialized.body).not.toContain('BearerTokenCANARY');
    } finally {
      delete polluted.toJSON;
    }

    expect(() =>
      serializeJobMessage(
        createJobEnvelope('account.updated', {
          toJSON: () => ({ authorization: 'Bearer payload-canary' }),
        }),
        {},
      ),
    ).toThrow('supported JSON data');
  });

  it('stops projection once the aggregate message byte budget is exhausted', () => {
    let laterValueReads = 0;
    const laterValue = new Proxy(Object.create(null) as object, {
      getPrototypeOf: () => {
        laterValueReads += 1;
        throw new Error('projection continued after the byte budget was exhausted');
      },
    });
    const envelope = createJobEnvelope(
      'account.updated',
      {
        oversized: 'x'.repeat(MAX_JOB_MESSAGE_BYTES),
        laterValue,
      },
      { correlation: DEFAULT_CORRELATION },
    );

    expect(() => serializeJobMessage(envelope, {})).toThrow(
      `Job message cannot exceed ${MAX_JOB_MESSAGE_BYTES} bytes`,
    );
    expect(laterValueReads).toBe(0);
  });

  it('rolls enqueue back atomically and leaves nothing to publish', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    const publish = jest.fn<Promise<OutboxTransportReceipt>, [OutboxTransportMessage]>();
    publish.mockResolvedValue({});
    const transport: OutboxTransport = { publish };
    const dispatcher = new OutboxDispatcher(repository, transport, dispatcherOptions());

    await expect(
      postgres.withTransaction(async () => {
        await publisher.enqueue(reviewedLedgerRequest('rolled-back-job'));
        throw new Error('domain write failed');
      }),
    ).rejects.toThrow('domain write failed');

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ claimed: 0 });
    expect(transport.publish).not.toHaveBeenCalled();
    expect(harness.job('rolled-back-job')).toBeUndefined();
  });

  it('commits one stable envelope and publishes that exact ID', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    const envelope = await enqueueCommitted(postgres, publisher, 'stable-job-id');
    const transport = {
      publish: jest.fn().mockResolvedValue({ transportMessageId: 'sqs-1' }),
    } as OutboxTransport;
    const dispatcher = new OutboxDispatcher(repository, transport, dispatcherOptions());

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 1,
      retried: 0,
      failed: 0,
      leaseLost: 0,
    });
    expect(transport.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          id: envelope.id,
          correlation: DEFAULT_CORRELATION,
        }),
      }),
      expect.anything(),
    );
    expect(harness.job(envelope.id)?.status).toBe('published');
  });

  it('preserves two isolated request contexts through outbox, SQS, and concurrent workers', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    const config = testInfrastructureConfig();
    const wireMessages: Array<{
      body: string;
      messageAttributes: Record<string, MessageAttributeValue>;
      messageId: string;
      receiptHandle: string;
    }> = [];
    const publishedWireMessages: typeof wireMessages = [];
    const send = jest.fn(async (command: unknown): Promise<unknown> => {
      if (command instanceof SendMessageBatchCommand) {
        const successful = (command.input.Entries ?? []).map((entry, index) => {
          const messageId = `wire-message-${index + 1}`;
          const message = {
            body: entry.MessageBody ?? '',
            messageAttributes: entry.MessageAttributes ?? {},
            messageId,
            receiptHandle: `${messageId}-receipt`,
          };
          wireMessages.push(message);
          publishedWireMessages.push(message);
          return { Id: entry.Id, MessageId: messageId };
        });
        return { Successful: successful, Failed: [] };
      }
      if (command instanceof ReceiveMessageCommand) {
        const message = wireMessages.shift();
        return message
          ? {
              Messages: [
                {
                  MessageId: message.messageId,
                  ReceiptHandle: message.receiptHandle,
                  Body: message.body,
                  Attributes: { ApproximateReceiveCount: '1' },
                  MessageAttributes: message.messageAttributes,
                },
              ],
            }
          : { Messages: [] };
      }
      if (
        command instanceof ChangeMessageVisibilityCommand ||
        command instanceof DeleteMessageCommand
      ) {
        return {};
      }
      throw new Error(`Unexpected local SQS command: ${String(command)}`);
    });
    const sqs = new SqsService({ send, destroy: jest.fn() } as unknown as SQSClient, config);
    const dispatcher = new OutboxDispatcher(repository, sqs, dispatcherOptions());
    const contexts = [testCorrelation(30), testCorrelation(40)] as const;

    for (const [index, context] of contexts.entries()) {
      await loggingContext.run(context, async () => {
        await Promise.resolve();
        await postgres.withTransaction(() =>
          publisher.enqueue(reviewedLedgerRequest(`correlated-flow-${index + 1}`, context)),
        );
      });
    }

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 2,
      published: 2,
    });
    expect(publishedWireMessages).toHaveLength(2);
    for (const [index, context] of contexts.entries()) {
      const jobId = `correlated-flow-${index + 1}`;
      expect(harness.job(jobId)?.envelope.correlation).toEqual(context);
      const wireMessage = publishedWireMessages.find(
        ({ body }) => sqs.parseEnvelope(body).id === jobId,
      );
      expect(wireMessage).toBeDefined();
      expect(sqs.parseEnvelope(wireMessage?.body ?? '').correlation).toEqual(context);
      expect(wireMessage?.messageAttributes.correlationId).toEqual({
        DataType: 'String',
        StringValue: context.correlationId,
      });
    }

    const observedContexts = new Map<string, unknown>();
    let concurrentHandlers = 0;
    let releaseHandlers = (): void => undefined;
    const bothHandlersStarted = new Promise<void>((resolve) => {
      releaseHandlers = resolve;
    });
    const handler = jest.fn(async (job: JobEnvelope): Promise<void> => {
      observedContexts.set(job.id, loggingContext.current());
      concurrentHandlers += 1;
      if (concurrentHandlers === 2) releaseHandlers();
      await bothHandlersStarted;
    });
    const worker = new SqsJobWorker(sqs, config);

    await expect(
      Promise.all([worker.processOne(handler), worker.processOne(handler)]),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'completed', jobId: 'correlated-flow-1' }),
        expect.objectContaining({ status: 'completed', jobId: 'correlated-flow-2' }),
      ]),
    );
    expect(observedContexts).toEqual(
      new Map(
        contexts.map((context, index) => [
          `correlated-flow-${index + 1}`,
          {
            ...context,
            jobId: createSafeLogReference('job', `correlated-flow-${index + 1}`),
          },
        ]),
      ),
    );
    expect(loggingContext.current()).toBeUndefined();
  });

  it('maps partial SQS batch failures per row without letting legacy poison block valid jobs', async () => {
    const harness = new TransactionalOutboxHarness();
    harness.seed({
      id: 'legacy-batch-poison',
      destination: 'jobs',
      envelope: {
        id: 'legacy-batch-poison',
        kind: 'account.updated',
        version: 1,
        occurredAt: '2026-08-18T00:00:00.000Z',
        payload: {},
      },
      messageAttributes: { jobId: 'reserved-legacy-value' },
      status: 'pending',
      attempts: 0,
      availableAt: 0,
    });
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    await enqueueCommitted(postgres, publisher, 'batch-success');
    await enqueueCommitted(postgres, publisher, 'batch-failure');
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (!(command instanceof SendMessageBatchCommand)) {
        throw new Error('Expected SendMessageBatchCommand');
      }
      const [successful, failed] = command.input.Entries ?? [];
      return Promise.resolve({
        Successful: successful ? [{ Id: successful.Id, MessageId: 'sqs-success' }] : [],
        Failed: failed
          ? [{ Id: failed.Id, Code: 'InternalError', Message: 'retry this entry' }]
          : [],
      });
    });
    const transport = new SqsService(
      { send, destroy: jest.fn() } as unknown as SQSClient,
      testInfrastructureConfig(),
    );
    const dispatcher = new OutboxDispatcher(
      repository,
      transport,
      dispatcherOptions({ maxAttempts: 1 }),
    );

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 3,
      published: 1,
      retried: 0,
      failed: 2,
      leaseLost: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]?.[0] as SendMessageBatchCommand).input.Entries).toHaveLength(2);
    expect(harness.job('legacy-batch-poison')?.status).toBe('failed');
    expect(harness.job('batch-success')?.status).toBe('published');
    expect(harness.job('batch-failure')?.status).toBe('failed');
  });

  it('rejects oversized unreviewed legacy batches before any physical SQS request', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    for (const id of ['large-a', 'large-b']) {
      harness.seed({
        id,
        destination: 'jobs',
        envelope: createJobEnvelope('large.sample', 'x'.repeat(600_000), {
          id,
          occurredAt: '2026-08-18T00:00:00.000Z',
          correlation: DEFAULT_CORRELATION,
        }),
        messageAttributes: {},
        status: 'pending',
        attempts: 0,
        availableAt: 0,
      });
    }
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (!(command instanceof SendMessageBatchCommand)) {
        throw new Error('Expected SendMessageBatchCommand');
      }
      return Promise.resolve({
        Successful: (command.input.Entries ?? []).map((entry) => ({
          Id: entry.Id,
          MessageId: `sqs-${entry.Id}`,
        })),
      });
    });
    const dispatcher = new OutboxDispatcher(
      repository,
      new SqsService(
        { send, destroy: jest.fn() } as unknown as SQSClient,
        testInfrastructureConfig(),
      ),
      dispatcherOptions(),
    );

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({
      claimed: 2,
      published: 0,
      retried: 2,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects an undefined poison payload before inserting a row', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);

    await expect(
      postgres.withTransaction(() => publisher.enqueue({ kind: 'poison', payload: undefined })),
    ).rejects.toThrow('Invalid outbox job');
    expect(harness.queries.some((sql) => sql.includes('enqueue_reviewed_job_v1'))).toBe(false);
  });

  it('rejects nested values that JSON would otherwise silently discard or coerce', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);

    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: { nested: undefined } }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: { amount: Number.POSITIVE_INFINITY } }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    expect(harness.queries.some((sql) => sql.includes('enqueue_reviewed_job_v1'))).toBe(false);
  });

  it('rejects transport poison messages before inserting an outbox row', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    const tooManyAttributes = Object.fromEntries(
      Array.from({ length: MAX_CUSTOM_JOB_ATTRIBUTES + 1 }, (_, index) => [`key${index}`, 'value']),
    );

    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: {}, messageAttributes: tooManyAttributes }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({
          kind: 'poison',
          payload: {},
          messageAttributes: { jobId: 'shadowed-id' },
        }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({
          kind: 'poison',
          payload: {},
          messageAttributes: { correlationId: 'shadowed-correlation' },
        }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: 'x'.repeat(MAX_JOB_MESSAGE_BYTES) }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({
          kind: 'poison',
          payload: {},
          messageAttributes: { trace: 'x'.repeat(MAX_JOB_MESSAGE_BYTES) },
        }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: {}, messageAttributes: { trace: '' } }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: {}, messageAttributes: { trace: '\0' } }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() => publisher.enqueue({ kind: 'poison', payload: '\uFFFE' })),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() => publisher.enqueue({ kind: 'poison\0', payload: {} })),
    ).rejects.toThrow('Invalid outbox job');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ id: 'poison\0id', kind: 'poison', payload: {} }),
      ),
    ).rejects.toThrow('Invalid outbox job');
    expect(harness.queries.filter((sql) => sql.includes('enqueue_reviewed_job_v1'))).toHaveLength(
      0,
    );
  });

  it('retires a legacy poison row without blocking newer outbox delivery', async () => {
    const harness = new TransactionalOutboxHarness();
    harness.seed({
      id: 'legacy-poison',
      destination: 'jobs',
      envelope: {
        id: 'legacy-poison',
        kind: 'account.updated',
        version: 1,
        occurredAt: '2026-08-18T00:00:00.000Z',
        payload: {},
      },
      messageAttributes: { jobId: 'legacy-shadow-value' },
      status: 'pending',
      attempts: 0,
      availableAt: 0,
    });
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    await enqueueCommitted(postgres, publisher, 'new-valid-job');
    const client = {
      send: jest.fn().mockImplementation((command: unknown) => {
        if (!(command instanceof SendMessageBatchCommand)) {
          throw new Error('Expected SendMessageBatchCommand');
        }
        return Promise.resolve({
          Successful: (command.input.Entries ?? []).map((entry) => ({
            Id: entry.Id,
            MessageId: 'sqs-valid',
          })),
        });
      }),
      destroy: jest.fn(),
    } as unknown as SQSClient;
    const dispatcher = new OutboxDispatcher(
      repository,
      new SqsService(client, testInfrastructureConfig()),
      dispatcherOptions({ maxAttempts: 1 }),
    );

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 2,
      published: 1,
      retried: 0,
      failed: 1,
      leaseLost: 0,
    });
    expect(harness.job('legacy-poison')?.status).toBe('failed');
    expect(harness.job('new-valid-job')?.status).toBe('published');
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('uses SKIP LOCKED leases and rejects a stale claimant after reclaim', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    await enqueueCommitted(postgres, publisher, 'leased-job');

    const first = await repository.claimBatch({
      dispatcherId: 'claim-a',
      batchSize: 1,
      leaseMs: 1_000,
      maxAttempts: 3,
    });
    expect(first).toHaveLength(1);
    harness.advance(1_001);
    const reclaimed = await repository.claimBatch({
      dispatcherId: 'claim-b',
      batchSize: 1,
      leaseMs: 1_000,
      maxAttempts: 3,
    });

    expect(reclaimed).toHaveLength(1);
    await expect(repository.markPublished('leased-job', 'claim-a')).resolves.toBe(false);
    await expect(repository.markPublished('leased-job', 'claim-b')).resolves.toBe(true);
    expect(harness.queries.some((sql) => sql.includes('FOR UPDATE SKIP LOCKED'))).toBe(true);
  });

  it('deletes terminal outbox history in bounded batches while preserving pending and fresh rows', async () => {
    const harness = new TransactionalOutboxHarness();
    harness.seed({
      id: 'old-published',
      destination: 'jobs',
      envelope: createJobEnvelope('sample', {}, { id: 'old-published' }),
      messageAttributes: {},
      status: 'published',
      attempts: 0,
      availableAt: 0,
      publishedAt: 50_000,
    });
    harness.seed({
      id: 'old-failed',
      destination: 'jobs',
      envelope: createJobEnvelope('sample', {}, { id: 'old-failed' }),
      messageAttributes: {},
      status: 'failed',
      attempts: 3,
      availableAt: 0,
      failedAt: 0,
    });
    harness.seed({
      id: 'old-pending',
      destination: 'jobs',
      envelope: createJobEnvelope('sample', {}, { id: 'old-pending' }),
      messageAttributes: {},
      status: 'pending',
      attempts: 0,
      availableAt: 0,
    });
    harness.advance(120_001);
    harness.seed({
      id: 'fresh-published',
      destination: 'jobs',
      envelope: createJobEnvelope('sample', {}, { id: 'fresh-published' }),
      messageAttributes: {},
      status: 'published',
      attempts: 0,
      availableAt: harness.now,
      publishedAt: harness.now,
    });
    const repository = new JobOutboxRepository(new PostgresService(harness.pool));
    const cleanup = {
      batchSize: 1,
      failedRetentionMs: 120_000,
      publishedRetentionMs: 60_000,
    };

    await expect(repository.deleteExpired(cleanup)).resolves.toBe(1);
    expect(harness.job('old-published')).toBeUndefined();
    expect(harness.job('old-failed')).toBeDefined();
    await expect(repository.deleteExpired(cleanup)).resolves.toBe(1);
    await expect(repository.deleteExpired(cleanup)).resolves.toBe(0);
    expect(harness.job('old-published')).toBeUndefined();
    expect(harness.job('old-failed')).toBeUndefined();
    expect(harness.job('old-pending')).toBeDefined();
    expect(harness.job('fresh-published')).toBeDefined();
    expect(
      harness.queries.some(
        (sql) =>
          sql.startsWith('WITH published_expired AS') &&
          (sql.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length === 2,
      ),
    ).toBe(true);
  });

  it('records a legacy-row SQS failure without leaking payload data', async () => {
    const harness = new TransactionalOutboxHarness();
    const payloadCanary = 'private-outbox-payload-canary';
    const attributeCanary = 'private-outbox-attribute-canary';
    harness.seed({
      id: 'failing-job',
      destination: 'jobs',
      envelope: createJobEnvelope(
        'account.updated',
        { privateValue: payloadCanary },
        {
          id: 'failing-job',
          occurredAt: '2026-08-18T00:00:00.000Z',
          correlation: DEFAULT_CORRELATION,
        },
      ),
      messageAttributes: { diagnostic: attributeCanary },
      status: 'pending',
      attempts: 0,
      availableAt: 0,
    });
    const repository = new JobOutboxRepository(new PostgresService(harness.pool));
    const lines: string[] = [];
    const captureLogger = new StructuredLogger({
      workload: 'worker',
      environment: { NODE_ENV: 'test' },
      sink: (line) => lines.push(line),
    });
    jest
      .spyOn(structuredLogger, 'emit')
      .mockImplementation((event, level, fields) => captureLogger.emit(event, level, fields));
    const sqsClient = {
      send: jest.fn().mockRejectedValue(adversarialProviderError()),
      destroy: jest.fn(),
    } as unknown as SQSClient;
    const sqsTransport = new SqsService(sqsClient, testInfrastructureConfig());
    const dispatcher = new OutboxDispatcher(
      repository,
      sqsTransport,
      dispatcherOptions({ maxAttempts: 2 }),
    );

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ retried: 1 });
    expect(harness.job('failing-job')).toMatchObject({
      status: 'pending',
      attempts: 1,
      availableAt: 100,
      lastError: 'OUTBOX_TRANSPORT_FAILED',
    });
    harness.advance(100);
    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ failed: 1 });
    expect(harness.job('failing-job')).toMatchObject({
      status: 'failed',
      attempts: 2,
      lastError: 'OUTBOX_TRANSPORT_FAILED',
    });
    for (const prohibited of LOGGING_PROHIBITED_VALUES) {
      expect(JSON.stringify(harness.job('failing-job'))).not.toContain(prohibited);
    }
    const records = lines.map((line) => JSON.parse(line) as StructuredLogRecord);
    const failureRecords = records.filter(({ event }) => event === 'job.publish_failed');
    expect(failureRecords).toHaveLength(2);
    expect(failureRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'job.publish_failed',
          workload: 'worker',
          correlationId: DEFAULT_CORRELATION.correlationId,
          jobId: createSafeLogReference('job', 'failing-job'),
          jobKind: 'account.updated',
          errorCode: 'OUTBOX_TRANSPORT_FAILED',
        }),
      ]),
    );
    expect(lines.join('\n')).not.toMatch(
      new RegExp(
        [...LOGGING_PROHIBITED_VALUES, payloadCanary, attributeCanary, 'failing-job']
          .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'u',
      ),
    );
  });

  it('aborts a stalled batch before its lease and settles every row for retry', async () => {
    jest.useFakeTimers();
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    await enqueueCommitted(postgres, publisher, 'stalled-batch-a');
    await enqueueCommitted(postgres, publisher, 'stalled-batch-b');
    const transport: OutboxTransport = {
      maxBatchSize: 10,
      publish: jest.fn(),
      publishBatch: jest.fn((_messages, abortSignal) => {
        return new Promise((_resolve, reject) => {
          const rejectAborted = (): void => reject(abortSignal?.reason);
          if (abortSignal?.aborted) {
            rejectAborted();
          } else {
            abortSignal?.addEventListener('abort', rejectAborted, { once: true });
          }
        });
      }),
    };
    const dispatcher = new OutboxDispatcher(
      repository,
      transport,
      dispatcherOptions({ leaseMs: 5_000, publishTimeoutMs: 100 }),
    );

    const dispatch = dispatcher.dispatchBatch();
    await jest.advanceTimersByTimeAsync(100);

    await expect(dispatch).resolves.toMatchObject({ claimed: 2, retried: 2 });
    expect(harness.job('stalled-batch-a')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'OUTBOX_TRANSPORT_TIMEOUT',
    });
    expect(harness.job('stalled-batch-b')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'OUTBOX_TRANSPORT_TIMEOUT',
    });
  });

  it('aborts an in-flight publish when the worker receives its shutdown signal', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    await enqueueCommitted(postgres, publisher, 'shutdown-batch-a');
    await enqueueCommitted(postgres, publisher, 'shutdown-batch-b');
    const abortController = new AbortController();
    const transport: OutboxTransport = {
      maxBatchSize: 10,
      publish: jest.fn(),
      publishBatch: jest.fn((_messages, abortSignal) => {
        abortController.abort();
        return Promise.reject(abortSignal?.reason ?? new Error('worker stopped'));
      }),
    };
    const dispatcher = new OutboxDispatcher(repository, transport, dispatcherOptions());
    const worker = new OutboxWorker(dispatcher, dispatcherOptions());

    await expect(worker.run(abortController.signal, 10)).resolves.toBeUndefined();

    expect(transport.publishBatch).toHaveBeenCalledTimes(1);
    expect(harness.job('shutdown-batch-a')).toMatchObject({ status: 'pending', attempts: 0 });
    expect(harness.job('shutdown-batch-b')).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('settles confirmed batch successes when shutdown follows the SQS response', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    await enqueueCommitted(postgres, publisher, 'confirmed-before-shutdown-a');
    await enqueueCommitted(postgres, publisher, 'confirmed-before-shutdown-b');
    const abortController = new AbortController();
    const transport: OutboxTransport = {
      maxBatchSize: 10,
      publish: jest.fn(),
      publishBatch: jest.fn(async (messages) => {
        abortController.abort();
        return messages.map(() => ({ status: 'published' as const, receipt: {} }));
      }),
    };
    const dispatcher = new OutboxDispatcher(repository, transport, dispatcherOptions());

    await expect(dispatcher.dispatchBatch(abortController.signal)).resolves.toEqual({
      claimed: 2,
      published: 2,
      retried: 0,
      failed: 0,
      leaseLost: 0,
    });
    expect(harness.job('confirmed-before-shutdown-a')?.status).toBe('published');
    expect(harness.job('confirmed-before-shutdown-b')?.status).toBe('published');
  });

  it('does not claim new rows after shutdown has already started', async () => {
    const repository = {
      claimBatch: jest.fn(),
    } as unknown as JobOutboxRepository;
    const dispatcher = new OutboxDispatcher(
      repository,
      { publish: jest.fn() },
      dispatcherOptions(),
    );
    const abortController = new AbortController();
    abortController.abort();

    await expect(dispatcher.dispatchBatch(abortController.signal)).resolves.toEqual({
      claimed: 0,
      published: 0,
      retried: 0,
      failed: 0,
      leaseLost: 0,
    });
    expect(repository.claimBatch).not.toHaveBeenCalled();
  });

  it('reuses the same job ID after publish succeeds but the DB mark loses its lease', async () => {
    const envelope: JobEnvelope = {
      id: 'dedupe-id',
      kind: 'sample',
      version: 1,
      occurredAt: '2026-08-18T00:00:00.000Z',
      correlation: { correlationId: testUuid(50) },
      payload: {},
    };
    const claimed: ClaimedOutboxJob = {
      id: envelope.id,
      destination: 'jobs',
      envelope,
      messageAttributes: {},
      attempts: 0,
    };
    const claimTokens: string[] = [];
    const repository = {
      claimBatch: jest.fn().mockImplementation((options: { dispatcherId: string }) => {
        claimTokens.push(options.dispatcherId);
        return Promise.resolve([claimed]);
      }),
      markPublished: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      recordFailure: jest.fn(),
    } as unknown as JobOutboxRepository;
    const publish = jest.fn<Promise<OutboxTransportReceipt>, [OutboxTransportMessage]>();
    publish.mockResolvedValue({});
    const transport: OutboxTransport = { publish };
    const dispatcher = new OutboxDispatcher(repository, transport, dispatcherOptions());

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ leaseLost: 1 });
    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ published: 1 });
    expect(claimTokens[0]).not.toBe(claimTokens[1]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.map(([message]) => message.envelope.id)).toEqual([
      'dedupe-id',
      'dedupe-id',
    ]);
  });

  it('never exceeds configured in-process dispatch concurrency', async () => {
    const envelope = (id: string): ClaimedOutboxJob => ({
      id,
      destination: 'jobs',
      envelope: {
        id,
        kind: 'sample',
        version: 1,
        occurredAt: '2026-08-18T00:00:00.000Z',
        correlation: { correlationId: testUuid(60 + Number(id)) },
        payload: {},
      },
      messageAttributes: {},
      attempts: 0,
    });
    const repository = {
      claimBatch: jest
        .fn()
        .mockResolvedValue(Array.from({ length: 5 }, (_, index) => envelope(String(index)))),
      markPublished: jest.fn().mockResolvedValue(true),
      recordFailure: jest.fn(),
    } as unknown as JobOutboxRepository;
    let active = 0;
    let maximumActive = 0;
    const transport: OutboxTransport = {
      publish: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {};
      },
    };
    const dispatcher = new OutboxDispatcher(
      repository,
      transport,
      dispatcherOptions({ concurrency: 2 }),
    );

    await dispatcher.dispatchBatch();
    expect(maximumActive).toBe(2);
  });

  it('runs polling only when the dedicated worker entrypoint explicitly starts it', async () => {
    const abortController = new AbortController();
    const dispatcher = {
      cleanupExpired: jest.fn().mockResolvedValue(0),
      dispatchBatch: jest.fn().mockImplementation(() => {
        abortController.abort();
        return Promise.resolve({
          claimed: 0,
          published: 0,
          retried: 0,
          failed: 0,
          leaseLost: 0,
        });
      }),
    } as unknown as OutboxDispatcher;
    const worker = new OutboxWorker(dispatcher, dispatcherOptions());

    await expect(worker.run(abortController.signal, 10)).resolves.toBeUndefined();
    expect(dispatcher.dispatchBatch).toHaveBeenCalledTimes(1);
  });

  it('drains full retention batches without starving dispatch work', async () => {
    const abortController = new AbortController();
    const cleanupExpired = jest
      .fn()
      .mockResolvedValueOnce(2)
      .mockImplementationOnce(() => {
        abortController.abort();
        return Promise.resolve(0);
      });
    const dispatcher = {
      cleanupExpired,
      dispatchBatch: jest.fn().mockResolvedValue({
        claimed: 0,
        published: 0,
        retried: 0,
        failed: 0,
        leaseLost: 0,
      }),
    } as unknown as OutboxDispatcher;
    const worker = new OutboxWorker(
      dispatcher,
      dispatcherOptions({ cleanupBatchSize: 2, cleanupIntervalMs: 10_000 }),
    );

    await worker.run(abortController.signal, 10);

    expect(cleanupExpired).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatchBatch).toHaveBeenCalledTimes(2);
  });

  it('removes abort listeners after repeated idle polling', async () => {
    const abortController = new AbortController();
    let passes = 0;
    const dispatcher = {
      cleanupExpired: jest.fn().mockResolvedValue(0),
      dispatchBatch: jest.fn().mockImplementation(() => {
        passes += 1;
        if (passes === 12) {
          abortController.abort();
        }
        return Promise.resolve({
          claimed: 0,
          published: 0,
          retried: 0,
          failed: 0,
          leaseLost: 0,
        });
      }),
    } as unknown as OutboxDispatcher;
    const addListener = jest.spyOn(abortController.signal, 'addEventListener');
    const removeListener = jest.spyOn(abortController.signal, 'removeEventListener');
    const worker = new OutboxWorker(dispatcher, dispatcherOptions());

    await worker.run(abortController.signal, 10);

    expect(dispatcher.dispatchBatch).toHaveBeenCalledTimes(12);
    expect(addListener).toHaveBeenCalledTimes(11);
    expect(removeListener).toHaveBeenCalledTimes(11);
  });
});
