import { loggingContext } from '../logging';
import {
  InProcessObservability,
  type CurrentTraceContext,
  type ObservabilityPort,
} from '../observability';
import type { ClaimedOutboxJob, JobOutboxRepository } from './job-outbox.repository';
import type { OutboxDispatcherOptions } from './outbox-dispatcher.options';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import type { OutboxTransport } from './outbox-transport.port';

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function claimedJob(id: string, correlationIndex: number): ClaimedOutboxJob {
  const correlationId = testUuid(correlationIndex);
  return {
    id,
    destination: 'jobs',
    envelope: {
      id,
      kind: 'account.updated',
      version: 1,
      occurredAt: '2026-08-22T12:00:00.000Z',
      correlation: { correlationId, requestId: correlationId },
      payload: {},
    },
    messageAttributes: {},
    attempts: 0,
  };
}

function options(overrides: Partial<OutboxDispatcherOptions> = {}): OutboxDispatcherOptions {
  return {
    batchSize: 10,
    cleanupBatchSize: 100,
    cleanupIntervalMs: 60_000,
    concurrency: 2,
    failedRetentionMs: 30 * 24 * 60 * 60 * 1_000,
    leaseMs: 5_000,
    maxAttempts: 3,
    publishTimeoutMs: 1_000,
    publishedRetentionMs: 7 * 24 * 60 * 60 * 1_000,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 1_000,
    ...overrides,
  };
}

function repositoryFor(jobs: readonly ClaimedOutboxJob[]): JobOutboxRepository {
  return {
    claimBatch: jest.fn().mockResolvedValue(jobs),
    markPublished: jest.fn().mockResolvedValue(true),
    recordFailure: jest.fn().mockResolvedValue('retry'),
  } as unknown as JobOutboxRepository;
}

function deterministicObservability(): InProcessObservability {
  let monotonic = 0;
  let spanId = 0;
  return new InProcessObservability({
    monotonicNow: () => {
      monotonic += 5;
      return monotonic;
    },
    wallClock: () => new Date('2026-08-22T12:00:00.000Z'),
    randomSpanId: () => {
      spanId += 1;
      return spanId.toString(16).padStart(16, '0');
    },
  });
}

describe('OutboxDispatcher observability', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes within a correlation-linked producer span and records completion', async () => {
    const job = claimedJob('publish-success', 52);
    const repository = repositoryFor([job]);
    const observability = deterministicObservability();
    let traceDuringPublish: CurrentTraceContext | undefined;
    let correlationDuringPublish: string | undefined;
    const transport: OutboxTransport = {
      publish: jest.fn().mockImplementation(async () => {
        traceDuringPublish = observability.currentTraceContext();
        correlationDuringPublish = loggingContext.current()?.correlationId;
        return { transportMessageId: 'provider-message-id' };
      }),
    };
    const dispatcher = new OutboxDispatcher(repository, transport, options(), observability);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      published: 1,
      retried: 0,
      failed: 0,
      leaseLost: 0,
    });

    const snapshot = observability.dashboardSnapshot();
    expect(correlationDuringPublish).toBe(job.envelope.correlation.correlationId);
    expect(traceDuringPublish).toEqual(
      expect.objectContaining({
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
        parentSpanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
        synthetic: false,
      }),
    );
    expect(snapshot.completedSpans).toEqual([
      expect.objectContaining({
        correlationId: job.envelope.correlation.correlationId,
        name: 'queue.publish',
        kind: 'producer',
        outcome: 'success',
        synthetic: false,
      }),
    ]);
    expect(snapshot.completedSpans[0]?.spanId).toBe(traceDuringPublish?.spanId);
    expect(snapshot.counters).toContainEqual({
      name: 'queue_events_total',
      labels: { queue: 'outbox', event: 'published' },
      value: 1,
    });
    expect(snapshot.gauges).toEqual(
      expect.arrayContaining([
        { name: 'worker_in_flight', labels: { worker: 'outbox_dispatcher' }, value: 0 },
        { name: 'worker_saturation_ratio', labels: { worker: 'outbox_dispatcher' }, value: 0 },
      ]),
    );
  });

  it('retains batch publication while tracing and recording each indexed outcome', async () => {
    const published = claimedJob('batch-published', 61);
    const failed = claimedJob('batch-failed', 71);
    const repository = repositoryFor([published, failed]);
    const observability = deterministicObservability();
    const privateError = 'Bearer batch-provider-secret';
    const transport: OutboxTransport = {
      maxBatchSize: 10,
      publish: jest.fn(),
      publishBatch: jest.fn().mockResolvedValue([
        { status: 'published', receipt: {} },
        { status: 'failed', error: new Error(privateError) },
      ]),
    };
    const dispatcher = new OutboxDispatcher(repository, transport, options(), observability);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 2,
      published: 1,
      retried: 1,
      failed: 0,
      leaseLost: 0,
    });

    expect(transport.publishBatch).toHaveBeenCalledTimes(1);
    expect(transport.publish).not.toHaveBeenCalled();
    const snapshot = observability.dashboardSnapshot();
    expect(snapshot.completedSpans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: published.envelope.correlation.correlationId,
          name: 'queue.publish',
          outcome: 'success',
        }),
        expect.objectContaining({
          correlationId: failed.envelope.correlation.correlationId,
          name: 'queue.publish',
          outcome: 'failure',
        }),
      ]),
    );
    expect(snapshot.completedSpans).toHaveLength(2);
    expect(snapshot.counters).toEqual(
      expect.arrayContaining([
        {
          name: 'job_errors_total',
          labels: { queue: 'outbox', error_class: 'dependency' },
          value: 1,
        },
        {
          name: 'queue_events_total',
          labels: { queue: 'outbox', event: 'retry_scheduled' },
          value: 1,
        },
        {
          name: 'queue_events_total',
          labels: { queue: 'outbox', event: 'published' },
          value: 1,
        },
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain(privateError);
  });

  it('classifies an enforced publisher deadline as a closed timeout failure', async () => {
    jest.useFakeTimers();
    const job = claimedJob('publish-timeout', 81);
    const repository = repositoryFor([job]);
    const observability = deterministicObservability();
    const transport: OutboxTransport = {
      publish: jest.fn(
        (_message, abortSignal) =>
          new Promise((_resolve, reject) => {
            const rejectAborted = (): void => reject(abortSignal?.reason);
            if (abortSignal?.aborted) rejectAborted();
            else abortSignal?.addEventListener('abort', rejectAborted, { once: true });
          }),
      ),
    };
    const dispatcher = new OutboxDispatcher(
      repository,
      transport,
      options({ publishTimeoutMs: 100 }),
      observability,
    );

    const dispatch = dispatcher.dispatchBatch();
    await jest.advanceTimersByTimeAsync(100);
    await expect(dispatch).resolves.toMatchObject({ claimed: 1, retried: 1 });

    const snapshot = observability.dashboardSnapshot();
    expect(snapshot.counters).toContainEqual({
      name: 'job_errors_total',
      labels: { queue: 'outbox', error_class: 'timeout' },
      value: 1,
    });
    expect(snapshot.completedSpans).toEqual([
      expect.objectContaining({ name: 'queue.publish', outcome: 'failure' }),
    ]);
  });

  it('isolates throwing recorder and span-handle methods from mixed dispatch results', async () => {
    const published = claimedJob('diagnostics-published', 91);
    const failed = claimedJob('diagnostics-failed', 101);
    const repository = repositoryFor([published, failed]);
    const transport: OutboxTransport = {
      publish: jest
        .fn()
        .mockImplementation(({ envelope }) =>
          envelope.id === published.id
            ? Promise.resolve({})
            : Promise.reject(new Error('provider unavailable')),
        ),
    };
    const observability = {
      startSpan: jest.fn(() => ({
        run: jest.fn(),
        runAsync: jest.fn(() => {
          throw new Error('span runner failed');
        }),
        discard: jest.fn(),
        end: jest.fn(() => {
          throw new Error('span completion failed');
        }),
      })),
      recordQueueEvent: jest.fn(() => {
        throw new Error('counter failed');
      }),
      recordJobFailure: jest.fn(() => {
        throw new Error('counter failed');
      }),
    } as unknown as ObservabilityPort;
    const dispatcher = new OutboxDispatcher(repository, transport, options(), observability);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 2,
      published: 1,
      retried: 1,
      failed: 0,
      leaseLost: 0,
    });

    expect(transport.publish).toHaveBeenCalledTimes(2);
    expect(repository.markPublished).toHaveBeenCalledTimes(1);
    expect(repository.recordFailure).toHaveBeenCalledTimes(1);
    expect(observability.recordQueueEvent).toHaveBeenCalledTimes(1);
    expect(observability.recordJobFailure).toHaveBeenCalledTimes(1);
  });
});
