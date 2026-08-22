import { performance } from 'node:perf_hooks';

import type {
  ObservabilityHttpMethod,
  ObservabilityHttpOperation,
  ObservabilityPort,
  ObservabilityRequestOutcome,
  ObservabilitySpanHandle,
} from '../observability/observability';
import { createRootLogContext, loggingContext } from './logging-context';
import {
  LOG_EVENTS,
  structuredLogger,
  type StructuredLogger,
  type StructuredLogLevel,
} from './structured-logger';

export const REQUEST_ID_RESPONSE_HEADER = 'X-Request-Id';

interface LoggingHttpRequest {
  readonly baseUrl?: unknown;
  readonly method?: unknown;
  readonly originalUrl?: unknown;
  readonly route?: { readonly path?: unknown };
}

interface LoggingHttpResponse {
  readonly statusCode: number;
  readonly writableFinished?: boolean;
  setHeader(name: string, value: string): void;
  once(event: 'finish' | 'close', listener: () => void): this;
  removeListener(event: 'finish' | 'close', listener: () => void): this;
}

export type RequestLoggingMiddleware = (
  request: LoggingHttpRequest,
  response: LoggingHttpResponse,
  next: () => void,
) => void;

export interface RequestLoggingOptions {
  readonly anonymousRejectionLimit?: number;
  readonly anonymousRejectionWindowMs?: number;
  readonly monotonicNow?: () => number;
  readonly observability?: ObservabilityPort;
  /** Trusted test/bootstrap option. Inbound headers never select synthetic telemetry. */
  readonly syntheticRequest?: boolean;
}

const QUIET_HEALTH_PATHS = new Set([
  '/api/v1/health',
  '/api/v1/health/dependencies',
  '/api/v1/internal/health/dependencies',
]);
const DEFAULT_ANONYMOUS_REJECTION_LIMIT = 60;
const DEFAULT_ANONYMOUS_REJECTION_WINDOW_MS = 60_000;

function pathMatchesOperation(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function operationOf(request: LoggingHttpRequest): ObservabilityHttpOperation {
  if (typeof request.originalUrl !== 'string') return 'unknown';
  const queryStart = request.originalUrl.indexOf('?');
  const path = (
    queryStart === -1 ? request.originalUrl : request.originalUrl.slice(0, queryStart)
  ).toLowerCase();
  if (
    pathMatchesOperation(path, '/api/v1/health') ||
    pathMatchesOperation(path, '/api/v1/internal/health')
  ) {
    return 'health';
  }
  if (pathMatchesOperation(path, '/api/v1/auth')) return 'authentication';
  if (pathMatchesOperation(path, '/api/v1/accounts')) return 'account_profile';
  if (pathMatchesOperation(path, '/api/v1/quotes')) return 'quote';
  if (
    pathMatchesOperation(path, '/api/v1/executions') ||
    pathMatchesOperation(path, '/api/v1/ledger')
  ) {
    return 'execution';
  }
  if (pathMatchesOperation(path, '/api/v1/admin')) return 'admin';
  return 'unknown';
}

class FixedWindowBudget {
  private windowStartedAt: number;
  private accepted = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {
    this.windowStartedAt = now();
  }

  take(): { readonly allowed: boolean; readonly firstSuppressed: boolean } {
    const current = this.now();
    if (current - this.windowStartedAt >= this.windowMs || current < this.windowStartedAt) {
      this.windowStartedAt = current;
      this.accepted = 0;
    }
    if (this.accepted >= this.limit) {
      const firstSuppressed = this.accepted === this.limit;
      this.accepted = this.limit + 1;
      return { allowed: false, firstSuppressed };
    }
    this.accepted += 1;
    return { allowed: true, firstSuppressed: false };
  }
}

function methodOf(request: LoggingHttpRequest): string | undefined {
  return typeof request.method === 'string' ? request.method.toUpperCase() : undefined;
}

function metricMethodOf(request: LoggingHttpRequest): ObservabilityHttpMethod {
  const method = methodOf(request);
  switch (method) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
    case 'OPTIONS':
    case 'HEAD':
      return method;
    default:
      return 'OTHER';
  }
}

function rawPathIsQuietHealth(request: LoggingHttpRequest): boolean {
  if (typeof request.originalUrl !== 'string') return false;
  const queryStart = request.originalUrl.indexOf('?');
  const path = queryStart === -1 ? request.originalUrl : request.originalUrl.slice(0, queryStart);
  return QUIET_HEALTH_PATHS.has(path);
}

function routeTemplate(request: LoggingHttpRequest): string {
  const routePath = request.route?.path;
  if (typeof routePath !== 'string' || !routePath.startsWith('/')) return '/unmatched';
  const baseUrl = typeof request.baseUrl === 'string' ? request.baseUrl : '';
  const candidate = `${baseUrl}${routePath}`.replace(/\/{2,}/gu, '/');
  return candidate.length <= 256 ? candidate : '/unmatched';
}

function completion(statusCode: number): {
  readonly level: StructuredLogLevel;
  readonly outcome: ObservabilityRequestOutcome;
} {
  if (statusCode >= 500) return { level: 'error', outcome: 'failure' };
  if (statusCode >= 400) return { level: 'warn', outcome: 'rejected' };
  return { level: 'info', outcome: 'success' };
}

function safeElapsed(monotonicNow: () => number, startedAt: number): number {
  try {
    const elapsed = monotonicNow() - startedAt;
    return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  } catch {
    return 0;
  }
}

function safeRecordRequest(
  observability: ObservabilityPort | undefined,
  input: {
    readonly operation: ObservabilityHttpOperation;
    readonly method: ObservabilityHttpMethod;
    readonly outcome: ObservabilityRequestOutcome;
    readonly durationMs: number;
    readonly synthetic: boolean;
  },
): void {
  try {
    observability?.recordRequest(input);
  } catch {
    // Diagnostics never change request behavior.
  }
}

function safeRecordActiveRequests(
  observability: ObservabilityPort | undefined,
  operation: ObservabilityHttpOperation,
  active: number,
  synthetic: boolean,
): void {
  try {
    observability?.recordRequestSaturation({ operation, active, synthetic });
  } catch {
    // Diagnostics never change request behavior.
  }
}

function safeStartServerSpan(
  observability: ObservabilityPort | undefined,
  synthetic: boolean,
): ObservabilitySpanHandle | undefined {
  try {
    return observability?.startSpan({ name: 'http.request', kind: 'server', synthetic });
  } catch {
    return undefined;
  }
}

function safeEndSpan(
  span: ObservabilitySpanHandle | undefined,
  outcome: 'success' | 'failure' | 'aborted',
): void {
  try {
    span?.end(outcome);
  } catch {
    // Diagnostics never change request behavior.
  }
}

function safeDiscardSpan(span: ObservabilitySpanHandle | undefined): void {
  try {
    span?.discard();
  } catch {
    // Diagnostics never change request behavior.
  }
}

export function createRequestLoggingMiddleware(
  logger: StructuredLogger = structuredLogger,
  options: RequestLoggingOptions = {},
): RequestLoggingMiddleware {
  const anonymousRejectionLimit =
    options.anonymousRejectionLimit ?? DEFAULT_ANONYMOUS_REJECTION_LIMIT;
  const anonymousRejectionWindowMs =
    options.anonymousRejectionWindowMs ?? DEFAULT_ANONYMOUS_REJECTION_WINDOW_MS;
  if (
    !Number.isSafeInteger(anonymousRejectionLimit) ||
    anonymousRejectionLimit < 1 ||
    anonymousRejectionLimit > 10_000 ||
    !Number.isSafeInteger(anonymousRejectionWindowMs) ||
    anonymousRejectionWindowMs < 1_000 ||
    anonymousRejectionWindowMs > 3_600_000
  ) {
    throw new TypeError('Invalid anonymous request-log budget');
  }
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const observability = options.observability;
  const synthetic = options.syntheticRequest === true;
  const activeRequests = new Map<ObservabilityHttpOperation, number>();
  const anonymousRejectionBudget = new FixedWindowBudget(
    anonymousRejectionLimit,
    anonymousRejectionWindowMs,
    monotonicNow,
  );

  const allowAnonymousRejectionRecord = (): boolean => {
    if (loggingContext.current()?.initiatorActorId) return true;
    const decision = anonymousRejectionBudget.take();
    if (decision.firstSuppressed) {
      logger.emit(LOG_EVENTS.httpAnonymousRejectionsSuppressed, 'warn', {
        outcome: 'rejected',
      });
    }
    return decision.allowed;
  };

  return (request, response, next): void => {
    const rootContext = createRootLogContext();
    let startedAt: number;
    try {
      startedAt = monotonicNow();
    } catch {
      startedAt = 0;
    }
    const operation = operationOf(request);
    const metricMethod = metricMethodOf(request);

    loggingContext.run(rootContext, () => {
      const restoreContext = loggingContext.capture();
      const span = safeStartServerSpan(observability, synthetic);
      let recorded = false;

      const changeActive = (delta: 1 | -1): void => {
        const active = Math.max(0, (activeRequests.get(operation) ?? 0) + delta);
        if (active === 0) activeRequests.delete(operation);
        else activeRequests.set(operation, active);
        safeRecordActiveRequests(observability, operation, active, synthetic);
      };

      const finish = (): void => {
        if (recorded) return;
        recorded = true;
        response.removeListener('finish', finish);
        response.removeListener('close', close);
        const durationMs = safeElapsed(monotonicNow, startedAt);
        const result = completion(response.statusCode);
        changeActive(-1);
        safeRecordRequest(observability, {
          operation,
          method: metricMethod,
          outcome: result.outcome,
          durationMs,
          synthetic,
        });
        const quietSuccessfulHealth = rawPathIsQuietHealth(request) && response.statusCode < 400;
        if (quietSuccessfulHealth) {
          safeDiscardSpan(span);
        } else {
          safeEndSpan(span, result.outcome === 'failure' ? 'failure' : 'success');
        }
        if (quietSuccessfulHealth) return;
        const method = methodOf(request);
        restoreContext(() => {
          if (
            response.statusCode >= 400 &&
            response.statusCode < 500 &&
            !allowAnonymousRejectionRecord()
          ) {
            return;
          }
          logger.emit(LOG_EVENTS.httpRequestCompleted, result.level, {
            ...(method ? { method } : {}),
            route: routeTemplate(request),
            statusCode: response.statusCode,
            durationMs,
            outcome: result.outcome,
          });
        });
      };

      const close = (): void => {
        if (recorded) return;
        if (response.writableFinished) {
          finish();
          return;
        }
        recorded = true;
        response.removeListener('finish', finish);
        response.removeListener('close', close);
        const durationMs = safeElapsed(monotonicNow, startedAt);
        changeActive(-1);
        safeRecordRequest(observability, {
          operation,
          method: metricMethod,
          outcome: 'aborted',
          durationMs,
          synthetic,
        });
        safeEndSpan(span, 'aborted');
        const method = methodOf(request);
        restoreContext(() => {
          if (!allowAnonymousRejectionRecord()) return;
          logger.emit(LOG_EVENTS.httpRequestAborted, 'warn', {
            ...(method ? { method } : {}),
            route: routeTemplate(request),
            statusCode: 499,
            durationMs,
            outcome: 'aborted',
          });
        });
      };

      const runRequest = (): void => {
        response.setHeader(
          REQUEST_ID_RESPONSE_HEADER,
          rootContext.requestId ?? rootContext.correlationId,
        );
        changeActive(1);
        response.once('finish', finish);
        response.once('close', close);
        next();
      };
      if (!span) {
        runRequest();
        return;
      }
      let requestStarted = false;
      let requestCompleted = false;
      const runRequestOnce = (): void => {
        if (requestStarted) return;
        requestStarted = true;
        runRequest();
        requestCompleted = true;
      };
      try {
        span.run(runRequestOnce);
      } catch (error) {
        if (!requestStarted) {
          runRequestOnce();
          return;
        }
        if (requestCompleted) return;
        throw error;
      }
      if (!requestStarted) runRequestOnce();
    });
  };
}

export const requestLoggingMiddleware = createRequestLoggingMiddleware();
