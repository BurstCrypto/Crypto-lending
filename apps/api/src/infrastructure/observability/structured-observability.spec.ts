import { LOG_EVENTS, structuredLogger } from '../logging/structured-logger';
import type { CompletedSpanSnapshot } from './observability';
import { emitCompletedSpan, SUCCESS_TRACE_SAMPLE_MODULUS } from './structured-observability';

function span(overrides: Partial<CompletedSpanSnapshot> = {}): CompletedSpanSnapshot {
  return Object.freeze({
    eventName: 'trace.span.completed',
    traceId: '00000001000000000000000000000000',
    rootSpanId: '1111111111111111',
    spanId: '2222222222222222',
    parentSpanId: '1111111111111111',
    correlationId: '00000000-0000-4000-8000-000000000052',
    name: 'queue.process',
    kind: 'consumer',
    outcome: 'success',
    synthetic: false,
    startedAt: '2026-08-22T12:00:00.000Z',
    durationMs: 12,
    ...overrides,
  });
}

describe('structured observability sink', () => {
  afterEach(() => jest.restoreAllMocks());

  it('deterministically samples one percent of ordinary successful traces', () => {
    const emit = jest.spyOn(structuredLogger, 'emit').mockImplementation(() => undefined);

    emitCompletedSpan(span());
    emitCompletedSpan(span({ traceId: '00000064000000000000000000000000' }));

    expect(SUCCESS_TRACE_SAMPLE_MODULUS).toBe(100);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      LOG_EVENTS.traceSpanCompleted,
      'info',
      expect.objectContaining({ traceId: '00000064000000000000000000000000' }),
    );
  });

  it('always emits synthetic, failed, and aborted spans with only fixed fields', () => {
    const emit = jest.spyOn(structuredLogger, 'emit').mockImplementation(() => undefined);

    emitCompletedSpan(span({ synthetic: true }));
    emitCompletedSpan(span({ outcome: 'failure', synthetic: false }));
    emitCompletedSpan(span({ name: 'http.request', outcome: 'aborted', synthetic: false }));

    expect(emit).toHaveBeenNthCalledWith(
      1,
      LOG_EVENTS.traceSpanCompleted,
      'info',
      expect.objectContaining({ outcome: 'success' }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      LOG_EVENTS.traceSpanCompleted,
      'error',
      expect.objectContaining({
        errorCode: 'JOB_PROCESSING_ERROR',
        outcome: 'failure',
      }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      3,
      LOG_EVENTS.traceSpanCompleted,
      'warn',
      expect.objectContaining({
        errorCode: 'HTTP_REQUEST_ABORTED',
        outcome: 'aborted',
      }),
    );
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/rootSpanId|correlationId|synthetic/u);
  });
});
