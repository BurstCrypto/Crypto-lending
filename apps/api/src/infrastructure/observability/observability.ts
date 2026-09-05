import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';

import { isCanonicalUuidV4, loggingContext } from '../logging/logging-context';

export const TRACE_SPAN_COMPLETED_EVENT = 'trace.span.completed' as const;

export const OBSERVABILITY_HTTP_OPERATIONS = Object.freeze([
  'health',
  'authentication',
  'account_profile',
  'quote',
  'execution',
  'admin',
  'unknown',
] as const);
export const OBSERVABILITY_HTTP_METHODS = Object.freeze([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'OTHER',
] as const);
export const OBSERVABILITY_REQUEST_OUTCOMES = Object.freeze([
  'success',
  'rejected',
  'failure',
  'aborted',
] as const);
export const OBSERVABILITY_WORKERS = Object.freeze(['outbox_dispatcher', 'job_consumer'] as const);
export const OBSERVABILITY_QUEUES = Object.freeze([
  'outbox',
  'jobs',
  'balance',
  'dead_letter',
] as const);
export const OBSERVABILITY_QUEUE_EVENTS = Object.freeze([
  'enqueued',
  'published',
  'received',
  'completed',
  'retry_scheduled',
  'awaiting_dead_letter',
  'dead_lettered',
  'deleted',
  'failed',
  'ownership_lost',
] as const);
export const OBSERVABILITY_JOB_ERROR_CLASSES = Object.freeze([
  'validation',
  'dependency',
  'timeout',
  'conflict',
  'ownership_lost',
  'internal',
] as const);
export const OBSERVABILITY_QUOTE_STATES = Object.freeze([
  'CREATED',
  'AVAILABLE',
  'SELECTED',
  'EXPIRED',
  'REJECTED',
  'FAILED',
] as const);
export const OBSERVABILITY_EXECUTION_STATES = Object.freeze([
  'CREATED',
  'QUOTED',
  'USER_APPROVED',
  'SUBMITTED',
  'PENDING',
  'SETTLED',
  'FAILED',
  'REVERSED',
] as const);
export const OBSERVABILITY_SPAN_NAMES = Object.freeze([
  'http.request',
  'quote.create',
  'execution.transition',
  'queue.publish',
  'queue.process',
  'synthetic.request',
] as const);
export const OBSERVABILITY_SPAN_KINDS = Object.freeze([
  'server',
  'producer',
  'consumer',
  'internal',
] as const);
export const REQUEST_LATENCY_BUCKETS_MS = Object.freeze([
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000,
] as const);

export type ObservabilityHttpOperation = (typeof OBSERVABILITY_HTTP_OPERATIONS)[number];
export type ObservabilityHttpMethod = (typeof OBSERVABILITY_HTTP_METHODS)[number];
export type ObservabilityRequestOutcome = (typeof OBSERVABILITY_REQUEST_OUTCOMES)[number];
export type ObservabilityWorker = (typeof OBSERVABILITY_WORKERS)[number];
export type ObservabilityQueue = (typeof OBSERVABILITY_QUEUES)[number];
export type ObservabilityQueueEvent = (typeof OBSERVABILITY_QUEUE_EVENTS)[number];
export type ObservabilityJobErrorClass = (typeof OBSERVABILITY_JOB_ERROR_CLASSES)[number];
export type ObservabilityQuoteState = (typeof OBSERVABILITY_QUOTE_STATES)[number];
export type ObservabilityExecutionState = (typeof OBSERVABILITY_EXECUTION_STATES)[number];
export type ObservabilitySpanName = (typeof OBSERVABILITY_SPAN_NAMES)[number];
export type ObservabilitySpanKind = (typeof OBSERVABILITY_SPAN_KINDS)[number];
export type ObservabilitySpanOutcome = 'success' | 'failure' | 'aborted';

export interface RequestObservation {
  readonly operation: ObservabilityHttpOperation;
  readonly method: ObservabilityHttpMethod;
  readonly outcome: ObservabilityRequestOutcome;
  readonly durationMs: number;
  readonly synthetic: boolean;
}

export interface RequestSaturationObservation {
  readonly operation: ObservabilityHttpOperation;
  readonly active: number;
  readonly synthetic: boolean;
}

export interface WorkerSaturationObservation {
  readonly worker: ObservabilityWorker;
  readonly inFlight: number;
  /** Omit until the invoking worker has an authoritative configured capacity. */
  readonly capacity?: number;
}

export interface QueueSnapshotObservation {
  readonly queue: ObservabilityQueue;
  readonly depth: number;
  readonly oldestAgeMs: number;
}

export interface QueueEventObservation {
  readonly queue: ObservabilityQueue;
  readonly event: ObservabilityQueueEvent;
}

export interface JobFailureObservation {
  readonly queue: 'outbox' | 'jobs' | 'balance';
  readonly disposition:
    'retry_scheduled' | 'awaiting_dead_letter' | 'dead_lettered' | 'failed' | 'ownership_lost';
  readonly errorClass: ObservabilityJobErrorClass;
}

/**
 * Low-cardinality receipt facts for the dedicated balance queue. Counts and
 * applied timing come from the SQS receipt lifecycle and worker policy. The
 * boolean only reports whether a previously validated, bounded provider delay
 * raised native timing; the closed shape admits no raw provider code or detail.
 */
export interface BalanceReceiptDispositionObservation {
  readonly queue: 'balance';
  readonly receiveCount: number;
  readonly retryDelaySeconds: number;
  readonly trustedProviderDelayFloorApplied: boolean;
}

export interface QuoteStateObservation {
  readonly state: ObservabilityQuoteState;
}

export interface ExecutionStateObservation {
  readonly state: ObservabilityExecutionState;
}

export interface SpanObservation {
  readonly name: ObservabilitySpanName;
  readonly kind: ObservabilitySpanKind;
  readonly synthetic: boolean;
}

export interface CounterSeriesSnapshot {
  readonly name:
    | 'balance_receipt_dispositions_total'
    | 'http_requests_total'
    | 'http_request_errors_total'
    | 'queue_events_total'
    | 'job_errors_total'
    | 'quote_state_total'
    | 'execution_state_total';
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

export interface GaugeSeriesSnapshot {
  readonly name:
    | 'http_active_requests'
    | 'worker_in_flight'
    | 'worker_saturation_ratio'
    | 'queue_depth'
    | 'queue_oldest_age_ms';
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

export interface HistogramBucketSnapshot {
  readonly le: number | '+Inf';
  readonly count: number;
}

export interface HistogramSeriesSnapshot {
  readonly name: 'http_request_duration_ms';
  readonly labels: Readonly<Record<string, string>>;
  readonly count: number;
  readonly sum: number;
  readonly buckets: readonly HistogramBucketSnapshot[];
}

export interface CompletedSpanSnapshot {
  readonly eventName: typeof TRACE_SPAN_COMPLETED_EVENT;
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly correlationId: string;
  readonly name: ObservabilitySpanName;
  readonly kind: ObservabilitySpanKind;
  readonly outcome: ObservabilitySpanOutcome;
  readonly synthetic: boolean;
  readonly startedAt: string;
  readonly durationMs: number;
}

export interface ObservabilityDashboardSnapshot {
  readonly generatedAt: string;
  readonly counters: readonly CounterSeriesSnapshot[];
  readonly gauges: readonly GaugeSeriesSnapshot[];
  readonly histograms: readonly HistogramSeriesSnapshot[];
  readonly completedSpans: readonly CompletedSpanSnapshot[];
}

export interface CurrentTraceContext {
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly synthetic: boolean;
}

export interface ObservabilitySpanHandle {
  run<T>(work: () => T): T;
  runAsync<T>(work: () => Promise<T>): Promise<T>;
  end(outcome: ObservabilitySpanOutcome): boolean;
  /** Finalizes a deliberately suppressed span without buffering or exporting it. */
  discard(): boolean;
}

export interface ObservabilityPort {
  recordRequest(input: RequestObservation): boolean;
  recordRequestSaturation(input: RequestSaturationObservation): boolean;
  recordWorkerSaturation(input: WorkerSaturationObservation): boolean;
  recordQueueSnapshot(input: QueueSnapshotObservation): boolean;
  recordQueueEvent(input: QueueEventObservation): boolean;
  recordJobFailure(input: JobFailureObservation): boolean;
  recordBalanceReceiptDisposition(input: BalanceReceiptDispositionObservation): boolean;
  recordQuoteState(input: QuoteStateObservation): boolean;
  recordExecutionState(input: ExecutionStateObservation): boolean;
  startSpan(input: SpanObservation): ObservabilitySpanHandle | undefined;
  runInSpan<T>(input: SpanObservation, work: () => T): T;
  runInSpanAsync<T>(input: SpanObservation, work: () => Promise<T>): Promise<T>;
  currentTraceContext(): CurrentTraceContext | undefined;
  dashboardSnapshot(): ObservabilityDashboardSnapshot;
}

export interface InProcessObservabilityOptions {
  readonly maxCompletedSpans?: number;
  readonly monotonicNow?: () => number;
  readonly wallClock?: () => Date;
  readonly randomSpanId?: () => string;
  readonly completedSpanSink?: (span: CompletedSpanSnapshot) => void;
}

type CounterName = CounterSeriesSnapshot['name'];
type GaugeName = GaugeSeriesSnapshot['name'];
type Labels = Readonly<Record<string, string>>;

interface MutableCounterSeries {
  readonly name: CounterName;
  readonly labels: Labels;
  readonly value: number;
}

interface MutableGaugeSeries {
  readonly name: GaugeName;
  readonly labels: Labels;
  readonly value: number;
}

interface MutableHistogramSeries {
  readonly name: 'http_request_duration_ms';
  readonly labels: Labels;
  readonly count: number;
  readonly sum: number;
  readonly bucketCounts: readonly number[];
}

interface ActiveSpan {
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly correlationId: string;
  readonly name: ObservabilitySpanName;
  readonly kind: ObservabilitySpanKind;
  readonly synthetic: boolean;
  readonly startedAt: string;
  readonly startedAtMonotonic: number;
}

const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
const BALANCE_RECEIPT_RETRY_BASE_DELAY_SECONDS = 5;
const MAX_BALANCE_RECEIPT_RECEIVE_COUNT = 3;
const MAX_BALANCE_RECEIPT_RETRY_DELAY_SECONDS = 60;
const MAX_SATURATION_CAPACITY = 1_000_000;
const MAX_QUEUE_DEPTH = 1_000_000_000;
const MAX_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_COMPLETED_SPANS = 10_000;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/u;

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    )
      return null;
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}

function boundedNumber(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && boundedNumber(value, maximum);
}

function immutableLabels(entries: readonly (readonly [string, string])[]): Labels {
  return Object.freeze(Object.fromEntries(entries));
}

function seriesKey(name: string, labels: Labels): string {
  return `${name}\0${Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join('\0')}`;
}

function incrementCounter(
  target: Map<string, MutableCounterSeries>,
  name: CounterName,
  labels: Labels,
): void {
  const key = seriesKey(name, labels);
  const current = target.get(key)?.value ?? 0;
  target.set(key, { name, labels, value: Math.min(Number.MAX_SAFE_INTEGER, current + 1) });
}

function setGauge(
  target: Map<string, MutableGaugeSeries>,
  name: GaugeName,
  labels: Labels,
  value: number,
): void {
  target.set(seriesKey(name, labels), { name, labels, value });
}

function observeRequestDuration(
  target: Map<string, MutableHistogramSeries>,
  labels: Labels,
  durationMs: number,
): void {
  const name = 'http_request_duration_ms' as const;
  const key = seriesKey(name, labels);
  const current = target.get(key);
  const bucketCounts = REQUEST_LATENCY_BUCKETS_MS.map((upperBound, index) =>
    Math.min(
      Number.MAX_SAFE_INTEGER,
      (current?.bucketCounts[index] ?? 0) + (durationMs <= upperBound ? 1 : 0),
    ),
  );
  target.set(key, {
    name,
    labels,
    count: Math.min(Number.MAX_SAFE_INTEGER, (current?.count ?? 0) + 1),
    sum: Math.min(Number.MAX_VALUE, (current?.sum ?? 0) + durationMs),
    bucketCounts: Object.freeze(bucketCounts),
  });
}

function sortedSeries<T extends { readonly name: string; readonly labels: Labels }>(
  values: Iterable<T>,
): readonly T[] {
  return [...values].sort((left, right) =>
    seriesKey(left.name, left.labels).localeCompare(seriesKey(right.name, right.labels)),
  );
}

function frozenCounterSnapshot(series: MutableCounterSeries): CounterSeriesSnapshot {
  return Object.freeze({ name: series.name, labels: series.labels, value: series.value });
}

function frozenGaugeSnapshot(series: MutableGaugeSeries): GaugeSeriesSnapshot {
  return Object.freeze({ name: series.name, labels: series.labels, value: series.value });
}

function frozenHistogramSnapshot(series: MutableHistogramSeries): HistogramSeriesSnapshot {
  const buckets: HistogramBucketSnapshot[] = REQUEST_LATENCY_BUCKETS_MS.map((le, index) =>
    Object.freeze({ le, count: series.bucketCounts[index] ?? 0 }),
  );
  buckets.push(Object.freeze({ le: '+Inf' as const, count: series.count }));
  return Object.freeze({
    name: series.name,
    labels: series.labels,
    count: series.count,
    sum: series.sum,
    buckets: Object.freeze(buckets),
  });
}

function quoteState(input: unknown): ObservabilityQuoteState | undefined {
  const record = closedRecord(input, ['state']);
  return record && oneOf(record.state, OBSERVABILITY_QUOTE_STATES) ? record.state : undefined;
}

function executionState(input: unknown): ObservabilityExecutionState | undefined {
  const record = closedRecord(input, ['state']);
  return record && oneOf(record.state, OBSERVABILITY_EXECUTION_STATES) ? record.state : undefined;
}

function safeWallClock(wallClock: () => Date): string {
  try {
    const value = wallClock();
    if (Object.getPrototypeOf(value) !== Date.prototype || !Number.isFinite(value.getTime())) {
      return new Date(0).toISOString();
    }
    return value.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function traceIdForCorrelation(correlationId: string): string {
  return createHash('sha256')
    .update('crypto-lending:server-trace:v1:')
    .update(correlationId)
    .digest('hex')
    .slice(0, 32);
}

function rootSpanIdForCorrelation(correlationId: string): string {
  const derived = createHash('sha256')
    .update('crypto-lending:server-root-span:v1:')
    .update(correlationId)
    .digest('hex')
    .slice(0, 16);
  return derived === '0000000000000000' ? '0000000000000001' : derived;
}

/**
 * Local provider-neutral telemetry backend. Its public recording API exposes no
 * arbitrary metric name or label map, keeping high-cardinality identifiers out
 * of metric series by construction. Invalid diagnostics are dropped instead of
 * changing application behavior.
 */
export class InProcessObservability implements ObservabilityPort {
  private counters = new Map<string, MutableCounterSeries>();
  private gauges = new Map<string, MutableGaugeSeries>();
  private histograms = new Map<string, MutableHistogramSeries>();
  private readonly completedSpans: CompletedSpanSnapshot[] = [];
  private readonly spanContext = new AsyncLocalStorage<ActiveSpan>();
  private readonly maxCompletedSpans: number;
  private readonly monotonicNow: () => number;
  private readonly wallClock: () => Date;
  private readonly randomSpanId: () => string;
  private readonly completedSpanSink: ((span: CompletedSpanSnapshot) => void) | undefined;

  constructor(options: InProcessObservabilityOptions = {}) {
    const maxCompletedSpans = options.maxCompletedSpans ?? 1_024;
    if (
      !Number.isSafeInteger(maxCompletedSpans) ||
      maxCompletedSpans < 1 ||
      maxCompletedSpans > MAX_COMPLETED_SPANS
    ) {
      throw new TypeError(`maxCompletedSpans must be between 1 and ${MAX_COMPLETED_SPANS}`);
    }
    this.maxCompletedSpans = maxCompletedSpans;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.wallClock = options.wallClock ?? (() => new Date());
    this.randomSpanId = options.randomSpanId ?? (() => randomBytes(8).toString('hex'));
    this.completedSpanSink = options.completedSpanSink;
  }

  recordRequest(input: RequestObservation): boolean {
    try {
      const record = closedRecord(input, [
        'operation',
        'method',
        'outcome',
        'durationMs',
        'synthetic',
      ]);
      if (
        !record ||
        !oneOf(record.operation, OBSERVABILITY_HTTP_OPERATIONS) ||
        !oneOf(record.method, OBSERVABILITY_HTTP_METHODS) ||
        !oneOf(record.outcome, OBSERVABILITY_REQUEST_OUTCOMES) ||
        !boundedNumber(record.durationMs, MAX_DURATION_MS) ||
        typeof record.synthetic !== 'boolean'
      )
        return false;
      const labels = immutableLabels([
        ['operation', record.operation],
        ['method', record.method],
        ['outcome', record.outcome],
        ['synthetic', String(record.synthetic)],
      ]);
      const histogramLabels = immutableLabels([
        ['operation', record.operation],
        ['method', record.method],
        ['synthetic', String(record.synthetic)],
      ]);
      const nextCounters = new Map(this.counters);
      const nextHistograms = new Map(this.histograms);
      incrementCounter(nextCounters, 'http_requests_total', labels);
      if (record.outcome !== 'success') {
        incrementCounter(
          nextCounters,
          'http_request_errors_total',
          immutableLabels([
            ['operation', record.operation],
            ['outcome', record.outcome],
            ['synthetic', String(record.synthetic)],
          ]),
        );
      }
      observeRequestDuration(nextHistograms, histogramLabels, record.durationMs);
      this.counters = nextCounters;
      this.histograms = nextHistograms;
      return true;
    } catch {
      return false;
    }
  }

  recordRequestSaturation(input: RequestSaturationObservation): boolean {
    try {
      const record = closedRecord(input, ['operation', 'active', 'synthetic']);
      if (
        !record ||
        !oneOf(record.operation, OBSERVABILITY_HTTP_OPERATIONS) ||
        !boundedInteger(record.active, MAX_SATURATION_CAPACITY) ||
        typeof record.synthetic !== 'boolean'
      )
        return false;
      const labels = immutableLabels([
        ['operation', record.operation],
        ['synthetic', String(record.synthetic)],
      ]);
      const next = new Map(this.gauges);
      setGauge(next, 'http_active_requests', labels, record.active);
      this.gauges = next;
      return true;
    } catch {
      return false;
    }
  }

  recordWorkerSaturation(input: WorkerSaturationObservation): boolean {
    try {
      const record =
        closedRecord(input, ['worker', 'inFlight']) ??
        closedRecord(input, ['worker', 'inFlight', 'capacity']);
      if (
        !record ||
        !oneOf(record.worker, OBSERVABILITY_WORKERS) ||
        !boundedInteger(record.inFlight, MAX_SATURATION_CAPACITY) ||
        (record.capacity !== undefined &&
          (!boundedInteger(record.capacity, MAX_SATURATION_CAPACITY) || record.capacity < 1))
      )
        return false;
      const labels = immutableLabels([['worker', record.worker]]);
      const next = new Map(this.gauges);
      setGauge(next, 'worker_in_flight', labels, record.inFlight);
      if (record.capacity !== undefined) {
        setGauge(
          next,
          'worker_saturation_ratio',
          labels,
          Math.min(1, record.inFlight / record.capacity),
        );
      }
      this.gauges = next;
      return true;
    } catch {
      return false;
    }
  }

  recordQueueSnapshot(input: QueueSnapshotObservation): boolean {
    try {
      const record = closedRecord(input, ['queue', 'depth', 'oldestAgeMs']);
      if (
        !record ||
        !oneOf(record.queue, OBSERVABILITY_QUEUES) ||
        !boundedInteger(record.depth, MAX_QUEUE_DEPTH) ||
        !boundedNumber(record.oldestAgeMs, MAX_QUEUE_AGE_MS)
      )
        return false;
      const labels = immutableLabels([['queue', record.queue]]);
      const next = new Map(this.gauges);
      setGauge(next, 'queue_depth', labels, record.depth);
      setGauge(next, 'queue_oldest_age_ms', labels, record.oldestAgeMs);
      this.gauges = next;
      return true;
    } catch {
      return false;
    }
  }

  recordQueueEvent(input: QueueEventObservation): boolean {
    try {
      const record = closedRecord(input, ['queue', 'event']);
      if (
        !record ||
        !oneOf(record.queue, OBSERVABILITY_QUEUES) ||
        !oneOf(record.event, OBSERVABILITY_QUEUE_EVENTS)
      )
        return false;
      const next = new Map(this.counters);
      incrementCounter(
        next,
        'queue_events_total',
        immutableLabels([
          ['queue', record.queue],
          ['event', record.event],
        ]),
      );
      this.counters = next;
      return true;
    } catch {
      return false;
    }
  }

  recordJobFailure(input: JobFailureObservation): boolean {
    try {
      const record = closedRecord(input, ['queue', 'disposition', 'errorClass']);
      if (
        !record ||
        !oneOf(record.queue, ['outbox', 'jobs', 'balance'] as const) ||
        !oneOf(record.disposition, [
          'retry_scheduled',
          'awaiting_dead_letter',
          'dead_lettered',
          'failed',
          'ownership_lost',
        ] as const) ||
        !oneOf(record.errorClass, OBSERVABILITY_JOB_ERROR_CLASSES)
      )
        return false;
      const next = new Map(this.counters);
      incrementCounter(
        next,
        'job_errors_total',
        immutableLabels([
          ['queue', record.queue],
          ['error_class', record.errorClass],
        ]),
      );
      incrementCounter(
        next,
        'queue_events_total',
        immutableLabels([
          ['queue', record.disposition === 'dead_lettered' ? 'dead_letter' : record.queue],
          ['event', record.disposition],
        ]),
      );
      this.counters = next;
      return true;
    } catch {
      return false;
    }
  }

  recordBalanceReceiptDisposition(input: BalanceReceiptDispositionObservation): boolean {
    try {
      const record = closedRecord(input, [
        'queue',
        'receiveCount',
        'retryDelaySeconds',
        'trustedProviderDelayFloorApplied',
      ]);
      if (
        !record ||
        record.queue !== 'balance' ||
        !boundedInteger(record.receiveCount, MAX_BALANCE_RECEIPT_RECEIVE_COUNT) ||
        record.receiveCount < 1 ||
        !boundedInteger(record.retryDelaySeconds, MAX_BALANCE_RECEIPT_RETRY_DELAY_SECONDS) ||
        typeof record.trustedProviderDelayFloorApplied !== 'boolean'
      )
        return false;
      const exhausted = record.receiveCount === MAX_BALANCE_RECEIPT_RECEIVE_COUNT;
      const nativeRetryDelaySeconds = Math.min(
        BALANCE_RECEIPT_RETRY_BASE_DELAY_SECONDS * 2 ** (record.receiveCount - 1),
        MAX_BALANCE_RECEIPT_RETRY_DELAY_SECONDS,
      );
      if (
        exhausted
          ? record.retryDelaySeconds !== 0 || record.trustedProviderDelayFloorApplied
          : record.trustedProviderDelayFloorApplied
            ? record.retryDelaySeconds <= nativeRetryDelaySeconds
            : record.retryDelaySeconds !== nativeRetryDelaySeconds
      ) {
        return false;
      }
      const next = new Map(this.counters);
      incrementCounter(
        next,
        'balance_receipt_dispositions_total',
        immutableLabels([
          ['receive_count', String(record.receiveCount)],
          ['retry_delay_seconds', String(record.retryDelaySeconds)],
          ['trusted_provider_delay_floor_applied', String(record.trustedProviderDelayFloorApplied)],
        ]),
      );
      this.counters = next;
      return true;
    } catch {
      return false;
    }
  }

  recordQuoteState(input: QuoteStateObservation): boolean {
    try {
      const state = quoteState(input);
      if (!state) return false;
      const next = new Map(this.counters);
      incrementCounter(next, 'quote_state_total', immutableLabels([['state', state]]));
      this.counters = next;
      return true;
    } catch {
      return false;
    }
  }

  recordExecutionState(input: ExecutionStateObservation): boolean {
    try {
      const state = executionState(input);
      if (!state) return false;
      const next = new Map(this.counters);
      incrementCounter(next, 'execution_state_total', immutableLabels([['state', state]]));
      this.counters = next;
      return true;
    } catch {
      return false;
    }
  }

  startSpan(input: SpanObservation): ObservabilitySpanHandle | undefined {
    const span = this.createSpan(input);
    if (!span) return undefined;
    const restoreLoggingContext = loggingContext.capture();
    let completed = false;
    return Object.freeze({
      run: <T>(work: () => T): T => this.spanContext.run(span, work),
      runAsync: <T>(work: () => Promise<T>): Promise<T> => this.spanContext.run(span, work),
      end: (outcome: ObservabilitySpanOutcome): boolean => {
        if (
          completed ||
          (outcome !== 'success' && outcome !== 'failure' && outcome !== 'aborted') ||
          (outcome === 'aborted' && span.name !== 'http.request')
        )
          return false;
        completed = true;
        restoreLoggingContext(() => this.completeSpan(span, outcome));
        return true;
      },
      discard: (): boolean => {
        if (completed) return false;
        completed = true;
        return true;
      },
    });
  }

  runInSpan<T>(input: SpanObservation, work: () => T): T {
    const span = this.startSpan(input);
    if (!span) return work();
    return span.run(() => {
      try {
        const result = work();
        span.end('success');
        return result;
      } catch (error) {
        span.end('failure');
        throw error;
      }
    });
  }

  async runInSpanAsync<T>(input: SpanObservation, work: () => Promise<T>): Promise<T> {
    const span = this.startSpan(input);
    if (!span) return work();
    return span.runAsync(async () => {
      try {
        const result = await work();
        span.end('success');
        return result;
      } catch (error) {
        span.end('failure');
        throw error;
      }
    });
  }

  /** Internal diagnostic context only; it is never parsed from inbound HTTP headers. */
  currentTraceContext(): CurrentTraceContext | undefined {
    try {
      const current = this.spanContext.getStore();
      if (!current) return undefined;
      return Object.freeze({
        traceId: current.traceId,
        rootSpanId: current.rootSpanId,
        spanId: current.spanId,
        ...(current.parentSpanId ? { parentSpanId: current.parentSpanId } : {}),
        synthetic: current.synthetic,
      });
    } catch {
      return undefined;
    }
  }

  dashboardSnapshot(): ObservabilityDashboardSnapshot {
    try {
      const counters = sortedSeries(this.counters.values()).map(frozenCounterSnapshot);
      const gauges = sortedSeries(this.gauges.values()).map(frozenGaugeSnapshot);
      const histograms = sortedSeries(this.histograms.values()).map(frozenHistogramSnapshot);
      const completedSpans = this.completedSpans.map((span) => Object.freeze({ ...span }));
      return Object.freeze({
        generatedAt: safeWallClock(this.wallClock),
        counters: Object.freeze(counters),
        gauges: Object.freeze(gauges),
        histograms: Object.freeze(histograms),
        completedSpans: Object.freeze(completedSpans),
      });
    } catch {
      return Object.freeze({
        generatedAt: new Date(0).toISOString(),
        counters: Object.freeze([]),
        gauges: Object.freeze([]),
        histograms: Object.freeze([]),
        completedSpans: Object.freeze([]),
      });
    }
  }

  private createSpan(input: SpanObservation): ActiveSpan | undefined {
    try {
      const record = closedRecord(input, ['name', 'kind', 'synthetic']);
      if (
        !record ||
        !oneOf(record.name, OBSERVABILITY_SPAN_NAMES) ||
        !oneOf(record.kind, OBSERVABILITY_SPAN_KINDS) ||
        typeof record.synthetic !== 'boolean'
      )
        return undefined;
      const correlationId = loggingContext.current()?.correlationId;
      if (!isCanonicalUuidV4(correlationId)) return undefined;
      const traceId = traceIdForCorrelation(correlationId);
      const rootSpanId = rootSpanIdForCorrelation(correlationId);
      const active = this.spanContext.getStore();
      const parent = active?.traceId === traceId ? active : undefined;
      const topLevelServer = parent === undefined && record.kind === 'server';
      const spanId = topLevelServer ? rootSpanId : this.randomSpanId();
      if (
        !HEX_SPAN_ID.test(spanId) ||
        spanId === '0000000000000000' ||
        (!topLevelServer && (spanId === parent?.spanId || spanId === rootSpanId))
      )
        return undefined;
      const startedAtMonotonic = this.monotonicNow();
      if (!Number.isFinite(startedAtMonotonic)) return undefined;
      return Object.freeze({
        traceId,
        rootSpanId,
        spanId,
        ...(parent
          ? { parentSpanId: parent.spanId }
          : topLevelServer
            ? {}
            : { parentSpanId: rootSpanId }),
        correlationId,
        name: record.name,
        kind: record.kind,
        synthetic: parent?.synthetic === true || record.synthetic,
        startedAt: safeWallClock(this.wallClock),
        startedAtMonotonic,
      });
    } catch {
      return undefined;
    }
  }

  private completeSpan(span: ActiveSpan, outcome: ObservabilitySpanOutcome): void {
    try {
      const completedAt = this.monotonicNow();
      const durationMs = Number.isFinite(completedAt)
        ? Math.min(MAX_DURATION_MS, Math.max(0, completedAt - span.startedAtMonotonic))
        : 0;
      const completed = Object.freeze({
        eventName: TRACE_SPAN_COMPLETED_EVENT,
        traceId: span.traceId,
        rootSpanId: span.rootSpanId,
        spanId: span.spanId,
        ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
        correlationId: span.correlationId,
        name: span.name,
        kind: span.kind,
        outcome,
        synthetic: span.synthetic,
        startedAt: span.startedAt,
        durationMs,
      });
      if (this.completedSpans.length >= this.maxCompletedSpans) this.completedSpans.shift();
      this.completedSpans.push(completed);
      try {
        this.completedSpanSink?.(completed);
      } catch {
        // Sink failures never change application behavior or the local buffer.
      }
    } catch {
      // Diagnostic failure is intentionally isolated from business execution.
    }
  }
}
