import { createHash } from 'node:crypto';

import { loggingContext } from '../logging';
import {
  InProcessObservability,
  OBSERVABILITY_EXECUTION_STATES,
  REQUEST_LATENCY_BUCKETS_MS,
  TRACE_SPAN_COMPLETED_EVENT,
  type CompletedSpanSnapshot,
  type CounterSeriesSnapshot,
  type CurrentTraceContext,
  type GaugeSeriesSnapshot,
  type InProcessObservabilityOptions,
  type ObservabilityDashboardSnapshot,
  type ObservabilitySpanHandle,
  type RequestObservation,
  type SpanObservation,
} from './observability';

const CORRELATION_ID = '00000000-0000-4000-8000-000000000052';
const FIXED_TIME = new Date('2026-08-22T12:00:00.000Z');

function counter(
  snapshot: ObservabilityDashboardSnapshot,
  name: CounterSeriesSnapshot['name'],
  labels: Readonly<Record<string, string>>,
): CounterSeriesSnapshot | undefined {
  return snapshot.counters.find(
    (series) => series.name === name && JSON.stringify(series.labels) === JSON.stringify(labels),
  );
}

function gauge(
  snapshot: ObservabilityDashboardSnapshot,
  name: GaugeSeriesSnapshot['name'],
  labels: Readonly<Record<string, string>>,
): GaugeSeriesSnapshot | undefined {
  return snapshot.gauges.find(
    (series) => series.name === name && JSON.stringify(series.labels) === JSON.stringify(labels),
  );
}

function deterministicObservability(
  options: Pick<InProcessObservabilityOptions, 'maxCompletedSpans' | 'completedSpanSink'> = {},
): InProcessObservability {
  let monotonic = 0;
  let span = 0;
  return new InProcessObservability({
    ...options,
    monotonicNow: () => {
      monotonic += 5;
      return monotonic;
    },
    wallClock: () => new Date(FIXED_TIME),
    randomSpanId: () => {
      span += 1;
      return span.toString(16).padStart(16, '0');
    },
  });
}

describe('InProcessObservability', () => {
  it('records bounded request latency/error series and a synthetic dashboard marker', () => {
    const observability = deterministicObservability();

    expect(
      observability.recordRequest({
        operation: 'quote',
        method: 'POST',
        outcome: 'failure',
        durationMs: 12,
        synthetic: true,
      }),
    ).toBe(true);

    const snapshot = observability.dashboardSnapshot();
    expect(
      counter(snapshot, 'http_requests_total', {
        operation: 'quote',
        method: 'POST',
        outcome: 'failure',
        synthetic: 'true',
      })?.value,
    ).toBe(1);
    expect(
      counter(snapshot, 'http_request_errors_total', {
        operation: 'quote',
        outcome: 'failure',
        synthetic: 'true',
      })?.value,
    ).toBe(1);
    expect(snapshot.histograms).toEqual([
      {
        name: 'http_request_duration_ms',
        labels: { operation: 'quote', method: 'POST', synthetic: 'true' },
        count: 1,
        sum: 12,
        buckets: [
          { le: 5, count: 0 },
          { le: 10, count: 0 },
          { le: 25, count: 1 },
          { le: 50, count: 1 },
          { le: 100, count: 1 },
          { le: 250, count: 1 },
          { le: 500, count: 1 },
          { le: 1_000, count: 1 },
          { le: 2_500, count: 1 },
          { le: 5_000, count: 1 },
          { le: '+Inf', count: 1 },
        ],
      },
    ]);
    expect(REQUEST_LATENCY_BUCKETS_MS).toHaveLength(10);
  });

  it('records active-request, worker, queue, and DLQ saturation without dynamic labels', () => {
    const observability = deterministicObservability();

    expect(
      observability.recordRequestSaturation({
        operation: 'execution',
        active: 8,
        synthetic: false,
      }),
    ).toBe(true);
    expect(
      observability.recordWorkerSaturation({
        worker: 'job_consumer',
        inFlight: 6,
        capacity: 4,
      }),
    ).toBe(true);
    expect(
      observability.recordWorkerSaturation({
        worker: 'outbox_dispatcher',
        inFlight: 2,
      }),
    ).toBe(true);
    expect(
      observability.recordQueueSnapshot({ queue: 'dead_letter', depth: 3, oldestAgeMs: 750 }),
    ).toBe(true);

    const snapshot = observability.dashboardSnapshot();
    expect(
      gauge(snapshot, 'http_active_requests', {
        operation: 'execution',
        synthetic: 'false',
      })?.value,
    ).toBe(8);
    expect(gauge(snapshot, 'worker_saturation_ratio', { worker: 'job_consumer' })?.value).toBe(1);
    expect(gauge(snapshot, 'worker_in_flight', { worker: 'outbox_dispatcher' })?.value).toBe(2);
    expect(gauge(snapshot, 'worker_saturation_ratio', { worker: 'outbox_dispatcher' })).toBe(
      undefined,
    );
    expect(gauge(snapshot, 'queue_depth', { queue: 'dead_letter' })?.value).toBe(3);
    expect(gauge(snapshot, 'queue_oldest_age_ms', { queue: 'dead_letter' })?.value).toBe(750);
  });

  it.each(['HEAD', 'OTHER'] as const)('accepts %s as a closed HTTP method', (method) => {
    const observability = deterministicObservability();
    expect(
      observability.recordRequest({
        operation: 'health',
        method,
        outcome: 'success',
        durationMs: 1,
        synthetic: false,
      }),
    ).toBe(true);
  });

  it('atomically records both error and queue metrics for a failed job', () => {
    const observability = deterministicObservability();

    expect(
      observability.recordJobFailure({
        queue: 'jobs',
        disposition: 'retry_scheduled',
        errorClass: 'dependency',
      }),
    ).toBe(true);
    let snapshot = observability.dashboardSnapshot();
    expect(
      counter(snapshot, 'job_errors_total', {
        queue: 'jobs',
        error_class: 'dependency',
      })?.value,
    ).toBe(1);
    expect(
      counter(snapshot, 'queue_events_total', {
        queue: 'jobs',
        event: 'retry_scheduled',
      })?.value,
    ).toBe(1);

    expect(
      observability.recordJobFailure({
        queue: 'balance',
        disposition: 'awaiting_dead_letter',
        errorClass: 'dependency',
      }),
    ).toBe(true);
    snapshot = observability.dashboardSnapshot();
    expect(
      counter(snapshot, 'job_errors_total', {
        queue: 'balance',
        error_class: 'dependency',
      })?.value,
    ).toBe(1);
    expect(
      counter(snapshot, 'queue_events_total', {
        queue: 'balance',
        event: 'awaiting_dead_letter',
      })?.value,
    ).toBe(1);

    expect(
      observability.recordJobFailure({
        queue: 'jobs',
        disposition: 'dead_lettered',
        errorClass: 'internal',
      }),
    ).toBe(true);
    snapshot = observability.dashboardSnapshot();
    expect(
      counter(snapshot, 'queue_events_total', {
        queue: 'dead_letter',
        event: 'dead_lettered',
      })?.value,
    ).toBe(1);
    expect(
      observability.recordJobFailure({
        queue: 'outbox',
        disposition: 'failed',
        errorClass: 'timeout',
      }),
    ).toBe(true);
    expect(observability.recordQueueEvent({ queue: 'jobs', event: 'ownership_lost' })).toBe(true);
    snapshot = observability.dashboardSnapshot();
    expect(
      counter(snapshot, 'queue_events_total', { queue: 'outbox', event: 'failed' })?.value,
    ).toBe(1);
    expect(
      counter(snapshot, 'queue_events_total', { queue: 'jobs', event: 'ownership_lost' })?.value,
    ).toBe(1);
  });

  it('uses closed quote and execution states', () => {
    const observability = deterministicObservability();

    expect(observability.recordQuoteState({ state: 'AVAILABLE' })).toBe(true);
    for (const state of OBSERVABILITY_EXECUTION_STATES) {
      expect(observability.recordExecutionState({ state })).toBe(true);
    }
    expect(observability.recordExecutionState({ state: 'user:0001' } as never)).toBe(false);

    const snapshot = observability.dashboardSnapshot();
    expect(counter(snapshot, 'quote_state_total', { state: 'AVAILABLE' })?.value).toBe(1);
    expect(snapshot.counters.filter(({ name }) => name === 'execution_state_total')).toHaveLength(
      OBSERVABILITY_EXECUTION_STATES.length,
    );
  });

  it('derives a server trace from the authoritative correlation and propagates nested spans', async () => {
    const observability = deterministicObservability();
    let rootTraceContext: CurrentTraceContext | undefined;
    let childTraceContext: CurrentTraceContext | undefined;

    await loggingContext.run({ correlationId: CORRELATION_ID, requestId: CORRELATION_ID }, () =>
      observability.runInSpanAsync(
        { name: 'synthetic.request', kind: 'server', synthetic: true },
        async () => {
          rootTraceContext = observability.currentTraceContext();
          await observability.runInSpanAsync(
            { name: 'quote.create', kind: 'internal', synthetic: false },
            async () => {
              await Promise.resolve();
              childTraceContext = observability.currentTraceContext();
            },
          );
        },
      ),
    );

    const expectedTraceId = createHash('sha256')
      .update('crypto-lending:server-trace:v1:')
      .update(CORRELATION_ID)
      .digest('hex')
      .slice(0, 32);
    const expectedRootSpanId = createHash('sha256')
      .update('crypto-lending:server-root-span:v1:')
      .update(CORRELATION_ID)
      .digest('hex')
      .slice(0, 16);
    expect(rootTraceContext).toEqual({
      traceId: expectedTraceId,
      rootSpanId: expectedRootSpanId,
      spanId: expectedRootSpanId,
      synthetic: true,
    });
    expect(childTraceContext).toEqual({
      traceId: expectedTraceId,
      rootSpanId: expectedRootSpanId,
      spanId: '0000000000000001',
      parentSpanId: expectedRootSpanId,
      synthetic: true,
    });
    expect(observability.dashboardSnapshot().completedSpans).toEqual([
      expect.objectContaining({
        eventName: TRACE_SPAN_COMPLETED_EVENT,
        traceId: expectedTraceId,
        rootSpanId: expectedRootSpanId,
        spanId: '0000000000000001',
        parentSpanId: expectedRootSpanId,
        correlationId: CORRELATION_ID,
        synthetic: true,
        outcome: 'success',
      }),
      expect.objectContaining({
        traceId: expectedTraceId,
        rootSpanId: expectedRootSpanId,
        spanId: expectedRootSpanId,
        correlationId: CORRELATION_ID,
        synthetic: true,
        outcome: 'success',
      }),
    ]);
  });

  it('connects separate HTTP and consumer spans through the durable correlation root', () => {
    const observability = deterministicObservability();

    loggingContext.run({ correlationId: CORRELATION_ID }, () => {
      observability.runInSpan(
        { name: 'http.request', kind: 'server', synthetic: false },
        () => undefined,
      );
    });
    loggingContext.run({ correlationId: CORRELATION_ID }, () => {
      observability.runInSpan(
        { name: 'queue.process', kind: 'consumer', synthetic: false },
        () => undefined,
      );
    });

    const [server, consumer] = observability.dashboardSnapshot().completedSpans;
    expect(server?.traceId).toBe(consumer?.traceId);
    expect(server?.spanId).toBe(server?.rootSpanId);
    expect(consumer?.parentSpanId).toBe(server?.spanId);
    expect(consumer?.spanId).not.toBe(server?.spanId);
  });

  it('drops colliding child span IDs while preserving business work', () => {
    const rootSpanId = createHash('sha256')
      .update('crypto-lending:server-root-span:v1:')
      .update(CORRELATION_ID)
      .digest('hex')
      .slice(0, 16);
    const ids = [rootSpanId, '1111111111111111', '1111111111111111'];
    const observability = new InProcessObservability({
      monotonicNow: () => 1,
      wallClock: () => new Date(FIXED_TIME),
      randomSpanId: () => ids.shift() ?? '2222222222222222',
    });
    let completedWork = 0;

    loggingContext.run({ correlationId: CORRELATION_ID }, () => {
      observability.runInSpan({ name: 'http.request', kind: 'server', synthetic: false }, () => {
        observability.runInSpan(
          { name: 'quote.create', kind: 'internal', synthetic: false },
          () => {
            completedWork += 1;
          },
        );
        observability.runInSpan(
          { name: 'execution.transition', kind: 'internal', synthetic: false },
          () => {
            observability.runInSpan(
              { name: 'queue.publish', kind: 'producer', synthetic: false },
              () => {
                completedWork += 1;
              },
            );
          },
        );
      });
    });

    expect(completedWork).toBe(2);
    expect(observability.dashboardSnapshot().completedSpans.map(({ spanId }) => spanId)).toEqual([
      '1111111111111111',
      rootSpanId,
    ]);
  });

  it('provides an idempotent manual span whose sink restores correlation context', () => {
    let observedCorrelation: string | undefined;
    const completed: CompletedSpanSnapshot[] = [];
    const observability = deterministicObservability({
      completedSpanSink: (span) => {
        observedCorrelation = loggingContext.current()?.correlationId;
        completed.push(span);
        throw new Error('sink failure is diagnostic only');
      },
    });
    const spanHolder: { current: ObservabilitySpanHandle | undefined } = { current: undefined };

    loggingContext.run({ correlationId: CORRELATION_ID }, () => {
      spanHolder.current = observability.startSpan({
        name: 'http.request',
        kind: 'server',
        synthetic: false,
      });
      expect(spanHolder.current?.run(() => observability.currentTraceContext()?.traceId)).toMatch(
        /^[0-9a-f]{32}$/u,
      );
    });

    const handle = spanHolder.current;
    expect(handle).toBeDefined();
    expect(handle?.end('success')).toBe(true);
    expect(handle?.end('failure')).toBe(false);
    expect(observedCorrelation).toBe(CORRELATION_ID);
    expect(completed).toHaveLength(1);
    expect(observability.dashboardSnapshot().completedSpans).toHaveLength(1);
  });

  it('finalizes a suppressed span without buffering or exporting it', () => {
    const completed: CompletedSpanSnapshot[] = [];
    const observability = deterministicObservability({
      completedSpanSink: (span) => completed.push(span),
    });
    const handle = loggingContext.run({ correlationId: CORRELATION_ID }, () =>
      observability.startSpan({ name: 'http.request', kind: 'server', synthetic: false }),
    );

    expect(handle?.discard()).toBe(true);
    expect(handle?.end('success')).toBe(false);
    expect(completed).toEqual([]);
    expect(observability.dashboardSnapshot().completedSpans).toEqual([]);
  });

  it('does not trust caller-provided trace identifiers and isolates diagnostic failures', () => {
    const observability = deterministicObservability();
    let getterReads = 0;
    const maliciousRequest = Object.defineProperty(
      {
        operation: 'quote',
        method: 'POST',
        outcome: 'success',
        synthetic: false,
      },
      'durationMs',
      {
        enumerable: true,
        get: () => {
          getterReads += 1;
          return 1;
        },
      },
    ) as RequestObservation;
    const untrustedSpan = {
      name: 'http.request',
      kind: 'server',
      synthetic: false,
      traceId: 'attacker-controlled',
    } as unknown as SpanObservation;

    expect(observability.recordRequest(maliciousRequest)).toBe(false);
    expect(getterReads).toBe(0);
    expect(observability.runInSpan(untrustedSpan, () => 'business-result')).toBe('business-result');
    expect(observability.dashboardSnapshot().completedSpans).toEqual([]);
  });

  it('preserves business failures while recording a failed span', async () => {
    const observability = deterministicObservability();
    const businessError = new Error('business failure');

    await expect(
      loggingContext.run({ correlationId: CORRELATION_ID }, () =>
        observability.runInSpanAsync(
          { name: 'queue.process', kind: 'consumer', synthetic: false },
          async () => {
            throw businessError;
          },
        ),
      ),
    ).rejects.toBe(businessError);
    expect(observability.dashboardSnapshot().completedSpans[0]?.outcome).toBe('failure');
  });

  it('bounds the completed-span buffer and returns deeply immutable snapshots', () => {
    const observability = deterministicObservability({ maxCompletedSpans: 2 });

    loggingContext.run({ correlationId: CORRELATION_ID }, () => {
      for (const name of ['http.request', 'quote.create', 'execution.transition'] as const) {
        observability.runInSpan({ name, kind: 'internal', synthetic: false }, () => undefined);
      }
    });
    const snapshot = observability.dashboardSnapshot();

    expect(snapshot.completedSpans.map(({ name }) => name)).toEqual([
      'quote.create',
      'execution.transition',
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.completedSpans)).toBe(true);
    expect(Object.isFrozen(snapshot.completedSpans[0])).toBe(true);
    expect(() => {
      (snapshot.completedSpans as CompletedSpanSnapshotForMutation[]).push({} as never);
    }).toThrow(TypeError);
  });

  it('rejects high-cardinality or malformed metric inputs without partial writes', () => {
    const observability = deterministicObservability();
    const invalid = {
      operation: 'quote',
      method: 'POST',
      outcome: 'success',
      durationMs: 1,
      synthetic: false,
      actorId: CORRELATION_ID,
    } as unknown as RequestObservation;

    expect(observability.recordRequest(invalid)).toBe(false);
    expect(
      observability.recordJobFailure({
        queue: 'jobs',
        disposition: 'attacker-job-id',
        errorClass: 'internal',
      } as never),
    ).toBe(false);
    expect(observability.dashboardSnapshot().counters).toEqual([]);
  });

  it('validates the bounded span capacity configuration', () => {
    expect(() => new InProcessObservability({ maxCompletedSpans: 0 })).toThrow(TypeError);
    expect(() => new InProcessObservability({ maxCompletedSpans: 10_001 })).toThrow(TypeError);
  });
});

type CompletedSpanSnapshotForMutation = ObservabilityDashboardSnapshot['completedSpans'][number];
