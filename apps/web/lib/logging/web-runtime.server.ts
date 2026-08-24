import { installWebFatalProcessBoundary } from './fatal-process-boundary.server';
import {
  WEB_LOG_EVENTS,
  webStructuredLogger,
  type WebStructuredLogger,
} from './structured-logger.server';

interface WebRequestErrorInput {
  readonly method?: unknown;
  readonly [key: string]: unknown;
}

interface WebRequestErrorContext {
  readonly routePath?: unknown;
  readonly [key: string]: unknown;
}

interface WebRuntimeBoundaryState {
  readonly dispose: () => void;
}

const WEB_RUNTIME_BOUNDARY_STATE = Symbol.for('crypto-lending.web-runtime-boundary');

function ownDataValue(value: unknown, key: string): unknown {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Registers one fatal process boundary even when development modules reload. */
export function registerWebNodeRuntime(logger: WebStructuredLogger = webStructuredLogger): void {
  const globals = globalThis as typeof globalThis & {
    [WEB_RUNTIME_BOUNDARY_STATE]?: WebRuntimeBoundaryState;
  };
  if (globals[WEB_RUNTIME_BOUNDARY_STATE]) return;
  const dispose = installWebFatalProcessBoundary(logger);
  globals[WEB_RUNTIME_BOUNDARY_STATE] = Object.freeze({ dispose });
  logger.emit(WEB_LOG_EVENTS.runtimeStarted, 'info', { outcome: 'success' });
}

/**
 * Records a Next.js request failure without reading its raw path, headers,
 * error message, digest, cause, stack, or provider response.
 */
export function recordWebRequestFailure(
  _error: unknown,
  request: WebRequestErrorInput,
  context: WebRequestErrorContext,
  logger: WebStructuredLogger = webStructuredLogger,
): void {
  const method = ownDataValue(request, 'method');
  const route = ownDataValue(context, 'routePath');
  logger.emit(WEB_LOG_EVENTS.requestFailed, 'error', {
    ...(typeof method === 'string' ? { method } : {}),
    ...(typeof route === 'string' ? { route } : {}),
    outcome: 'failure',
    errorCode: 'WEB_REQUEST_ERROR',
  });
}
