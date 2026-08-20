import type { SQSClient } from '@aws-sdk/client-sqs';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import {
  createJobEnvelope,
  parseJobEnvelope,
  type JobEnvelope,
} from '../../src/infrastructure/outbox/job-envelope';
import {
  MAX_CUSTOM_JOB_ATTRIBUTES,
  MAX_JOB_MESSAGE_BYTES,
} from '../../src/infrastructure/outbox/job-message-policy';
import {
  JobOutboxRepository,
  type ClaimedOutboxJob,
} from '../../src/infrastructure/outbox/job-outbox.repository';
import type { OutboxDispatcherOptions } from '../../src/infrastructure/outbox/outbox-dispatcher.options';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/outbox-dispatcher.service';
import type {
  OutboxTransport,
  OutboxTransportMessage,
  OutboxTransportReceipt,
} from '../../src/infrastructure/outbox/outbox-transport.port';
import { OutboxWorker } from '../../src/infrastructure/outbox/outbox-worker.service';
import { TransactionalJobPublisher } from '../../src/infrastructure/outbox/transactional-job-publisher.service';
import { SqsService } from '../../src/infrastructure/sqs/sqs.service';
import { testInfrastructureConfig } from './fixtures';

interface StoredJob {
  id: string;
  destination: string;
  envelope: JobEnvelope;
  messageAttributes: Readonly<Record<string, string>>;
  status: 'pending' | 'published' | 'failed';
  attempts: number;
  availableAt: number;
  lockedBy?: string;
  lockedUntil?: number;
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
    this.committed.push(structuredClone(job));
  }

  private async query(text: string, values: unknown[] = []): Promise<QueryResult> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.queries.push(normalized);

    if (normalized.startsWith('BEGIN')) {
      this.transaction = structuredClone(this.committed);
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
    if (normalized.startsWith('INSERT INTO job_outbox')) {
      if (!this.transaction) {
        throw new Error('test insert occurred outside transaction');
      }
      const [id, destination, rawEnvelope, rawAttributes] = values;
      this.transaction.push({
        id: String(id),
        destination: String(destination),
        envelope: JSON.parse(String(rawEnvelope)) as JobEnvelope,
        messageAttributes: JSON.parse(String(rawAttributes)) as Record<string, string>,
        status: 'pending',
        attempts: 0,
        availableAt: this.now,
      });
      return queryResult([], 1);
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
      delete job.lockedBy;
      delete job.lockedUntil;
      return queryResult([], 1);
    }
    if (normalized.includes('SET attempts = attempts + 1')) {
      const [id, claimToken, , rawTerminal, rawRetryDelay] = values;
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
      job.status = rawTerminal ? 'failed' : 'pending';
      if (!rawTerminal) {
        job.availableAt = this.now + Number(rawRetryDelay);
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
  return {
    batchSize: 10,
    concurrency: 2,
    leaseMs: 5_000,
    maxAttempts: 3,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1_000,
    ...overrides,
  };
}

async function enqueueCommitted(
  postgres: PostgresService,
  publisher: TransactionalJobPublisher,
  id: string,
): Promise<JobEnvelope> {
  return postgres.withTransaction(() =>
    publisher.enqueue({
      id,
      kind: 'account.updated',
      occurredAt: '2026-08-18T00:00:00.000Z',
      payload: { accountId: 'acct-1' },
      messageAttributes: { correlationId: 'corr-1' },
    }),
  );
}

describe('transactional job outbox', () => {
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
        await publisher.enqueue({
          id: 'rolled-back-job',
          kind: 'account.updated',
          payload: { accountId: 'acct-1' },
        });
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
      expect.objectContaining({ envelope: expect.objectContaining({ id: envelope.id }) }),
    );
    expect(harness.job(envelope.id)?.status).toBe('published');
  });

  it('rejects an undefined poison payload before inserting a row', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);

    await expect(
      postgres.withTransaction(() => publisher.enqueue({ kind: 'poison', payload: undefined })),
    ).rejects.toThrow('JSON serializable');
    expect(harness.queries.some((sql) => sql.startsWith('INSERT'))).toBe(false);
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
    ).rejects.toThrow('unsupported JSON value');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: { amount: Number.POSITIVE_INFINITY } }),
      ),
    ).rejects.toThrow('unsupported JSON value');
    expect(harness.queries.some((sql) => sql.startsWith('INSERT'))).toBe(false);
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
    ).rejects.toThrow('custom attributes');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({
          kind: 'poison',
          payload: {},
          messageAttributes: { jobId: 'shadowed-id' },
        }),
      ),
    ).rejects.toThrow('reserved job message attribute');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: 'x'.repeat(MAX_JOB_MESSAGE_BYTES) }),
      ),
    ).rejects.toThrow('cannot exceed');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: {}, messageAttributes: { trace: '' } }),
      ),
    ).rejects.toThrow('characters SQS cannot accept');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ kind: 'poison', payload: {}, messageAttributes: { trace: '\0' } }),
      ),
    ).rejects.toThrow('characters SQS cannot accept');
    await expect(
      postgres.withTransaction(() => publisher.enqueue({ kind: 'poison', payload: '\uFFFE' })),
    ).rejects.toThrow('characters SQS cannot accept');
    await expect(
      postgres.withTransaction(() => publisher.enqueue({ kind: 'poison\0', payload: {} })),
    ).rejects.toThrow('characters SQS cannot accept');
    await expect(
      postgres.withTransaction(() =>
        publisher.enqueue({ id: 'poison\0id', kind: 'poison', payload: {} }),
      ),
    ).rejects.toThrow('characters SQS cannot accept');
    expect(harness.queries.filter((sql) => sql.startsWith('INSERT'))).toHaveLength(0);
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
      send: jest.fn().mockResolvedValue({ MessageId: 'sqs-valid' }),
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

  it('records an SQS failure as retry and then terminal failure at the limit', async () => {
    const harness = new TransactionalOutboxHarness();
    const postgres = new PostgresService(harness.pool);
    const repository = new JobOutboxRepository(postgres);
    const publisher = new TransactionalJobPublisher(repository);
    await enqueueCommitted(postgres, publisher, 'failing-job');
    const sqsClient = {
      send: jest.fn().mockRejectedValue(new Error('SQS unavailable')),
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
    });
    harness.advance(100);
    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ failed: 1 });
    expect(harness.job('failing-job')).toMatchObject({
      status: 'failed',
      attempts: 2,
    });
  });

  it('reuses the same job ID after publish succeeds but the DB mark loses its lease', async () => {
    const envelope: JobEnvelope = {
      id: 'dedupe-id',
      kind: 'sample',
      version: 1,
      occurredAt: '2026-08-18T00:00:00.000Z',
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
    const worker = new OutboxWorker(dispatcher);

    await expect(worker.run(abortController.signal, 10)).resolves.toBeUndefined();
    expect(dispatcher.dispatchBatch).toHaveBeenCalledTimes(1);
  });

  it('removes abort listeners after repeated idle polling', async () => {
    const abortController = new AbortController();
    let passes = 0;
    const dispatcher = {
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
    const worker = new OutboxWorker(dispatcher);

    await worker.run(abortController.signal, 10);

    expect(dispatcher.dispatchBatch).toHaveBeenCalledTimes(12);
    expect(addListener).toHaveBeenCalledTimes(11);
    expect(removeListener).toHaveBeenCalledTimes(11);
  });
});
