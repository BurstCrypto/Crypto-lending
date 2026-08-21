import { performance } from 'node:perf_hooks';

import { createRootLogContext, loggingContext } from './logging-context';
import {
  LOG_EVENTS,
  structuredLogger,
  type StructuredLogger,
  type StructuredLogLevel,
  type StructuredLogOutcome,
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

const QUIET_HEALTH_PATHS = new Set([
  '/api/v1/health',
  '/api/v1/health/dependencies',
  '/api/v1/internal/health/dependencies',
]);

function methodOf(request: LoggingHttpRequest): string | undefined {
  return typeof request.method === 'string' ? request.method.toUpperCase() : undefined;
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
  readonly outcome: StructuredLogOutcome;
} {
  if (statusCode >= 500) return { level: 'error', outcome: 'failure' };
  if (statusCode >= 400) return { level: 'warn', outcome: 'rejected' };
  return { level: 'info', outcome: 'success' };
}

export function createRequestLoggingMiddleware(
  logger: StructuredLogger = structuredLogger,
): RequestLoggingMiddleware {
  return (request, response, next): void => {
    const rootContext = createRootLogContext();
    const startedAt = performance.now();

    loggingContext.run(rootContext, () => {
      const restoreContext = loggingContext.capture();
      let recorded = false;
      response.setHeader(
        REQUEST_ID_RESPONSE_HEADER,
        rootContext.requestId ?? rootContext.correlationId,
      );

      const finish = (): void => {
        if (recorded) return;
        recorded = true;
        response.removeListener('finish', finish);
        response.removeListener('close', close);
        if (rawPathIsQuietHealth(request) && response.statusCode < 400) return;
        const result = completion(response.statusCode);
        const method = methodOf(request);
        restoreContext(() =>
          logger.emit(LOG_EVENTS.httpRequestCompleted, result.level, {
            ...(method ? { method } : {}),
            route: routeTemplate(request),
            statusCode: response.statusCode,
            durationMs: performance.now() - startedAt,
            outcome: result.outcome,
          }),
        );
      };

      const close = (): void => {
        if (recorded || response.writableFinished) return;
        recorded = true;
        response.removeListener('finish', finish);
        response.removeListener('close', close);
        const method = methodOf(request);
        restoreContext(() =>
          logger.emit(LOG_EVENTS.httpRequestAborted, 'warn', {
            ...(method ? { method } : {}),
            route: routeTemplate(request),
            statusCode: 499,
            durationMs: performance.now() - startedAt,
            outcome: 'aborted',
          }),
        );
      };

      response.once('finish', finish);
      response.once('close', close);
      next();
    });
  };
}

export const requestLoggingMiddleware = createRequestLoggingMiddleware();
