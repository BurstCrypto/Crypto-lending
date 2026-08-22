import { LOG_EVENTS, structuredLogger } from '../logging/structured-logger';
import {
  InProcessObservability,
  type CompletedSpanSnapshot,
  type InProcessObservabilityOptions,
  type ObservabilityPort,
} from './observability';

export const OBSERVABILITY_PORT = Symbol('OBSERVABILITY_PORT');
export const SUCCESS_TRACE_SAMPLE_MODULUS = 100;

function shouldEmitCompletedSpan(span: CompletedSpanSnapshot): boolean {
  if (span.outcome !== 'success' || span.synthetic) return true;
  return Number.parseInt(span.traceId.slice(0, 8), 16) % SUCCESS_TRACE_SAMPLE_MODULUS === 0;
}

function fixedSpanErrorCode(span: CompletedSpanSnapshot): string {
  if (span.outcome === 'aborted') return 'HTTP_REQUEST_ABORTED';
  switch (span.name) {
    case 'http.request':
    case 'synthetic.request':
      return 'HTTP_SERVER_ERROR';
    case 'queue.publish':
      return 'OUTBOX_DISPATCH_ERROR';
    case 'queue.process':
      return 'JOB_PROCESSING_ERROR';
    case 'quote.create':
    case 'execution.transition':
      return 'UNEXPECTED_ERROR';
  }
}

/**
 * Projects completed spans through KAN-51's closed structured-log catalog.
 * The sink deliberately excludes synthetic flags, arbitrary attributes, raw
 * errors, payloads, and identifiers that are not explicit trace fields.
 */
export function emitCompletedSpan(span: CompletedSpanSnapshot): void {
  if (!shouldEmitCompletedSpan(span)) return;
  structuredLogger.emit(
    LOG_EVENTS.traceSpanCompleted,
    span.outcome === 'failure' ? 'error' : span.outcome === 'aborted' ? 'warn' : 'info',
    {
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      spanName: span.name,
      durationMs: span.durationMs,
      outcome: span.outcome,
      ...(span.outcome !== 'success' ? { errorCode: fixedSpanErrorCode(span) } : {}),
    },
  );
}

export function createApplicationObservability(
  options: Omit<InProcessObservabilityOptions, 'completedSpanSink'> = {},
): InProcessObservability {
  return new InProcessObservability({ ...options, completedSpanSink: emitCompletedSpan });
}

/** Process-local recorder. Tests inject isolated recorders at each boundary. */
export const applicationObservability: ObservabilityPort = createApplicationObservability();
