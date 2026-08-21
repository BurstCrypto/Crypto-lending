import { Buffer } from 'node:buffer';

import type { LoggerService } from '@nestjs/common';

import { loggingContext, type LoggingContext } from './logging-context';

export const LOG_EVENTS = Object.freeze({
  applicationStarted: 'application.started',
  applicationStartFailed: 'application.start_failed',
  applicationStopped: 'application.stopped',
  frameworkLifecycle: 'framework.lifecycle',
  frameworkWarning: 'framework.warning',
  frameworkError: 'framework.error',
  httpRequestCompleted: 'http.request.completed',
  httpRequestAborted: 'http.request.aborted',
  outboxDispatchCompleted: 'outbox.dispatch.completed',
  outboxDispatchFailed: 'outbox.dispatch.failed',
  outboxCleanupCompleted: 'outbox.cleanup.completed',
  outboxCleanupFailed: 'outbox.cleanup.failed',
  jobPublished: 'job.published',
  jobPublishFailed: 'job.publish_failed',
  jobProcessed: 'job.processed',
  jobRetryScheduled: 'job.retry_scheduled',
  jobAwaitingDeadLetter: 'job.awaiting_dead_letter',
  jobOwnershipLost: 'job.ownership_lost',
  workerStarted: 'worker.started',
  workerStartFailed: 'worker.start_failed',
  workerStopped: 'worker.stopped',
  workerHealthFailed: 'worker.health_failed',
  migrationCompleted: 'migration.completed',
  migrationFailed: 'migration.failed',
  openApiGenerated: 'openapi.generated',
  openApiFailed: 'openapi.failed',
} as const);

export type StructuredLogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS];
export type StructuredLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type StructuredLogOutcome =
  'success' | 'failure' | 'rejected' | 'aborted' | 'retry' | 'idle';

export interface SafeLogFields {
  readonly component?: string;
  readonly method?: string;
  readonly route?: string;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly outcome?: StructuredLogOutcome;
  readonly errorCode?: string;
  readonly jobId?: string;
  readonly jobKind?: string;
  readonly messageId?: string;
  readonly receiveCount?: number;
  readonly retryCount?: number;
  readonly retryDelayMs?: number;
  readonly claimed?: number;
  readonly published?: number;
  readonly retried?: number;
  readonly failed?: number;
  readonly leaseLost?: number;
  readonly deleted?: number;
}

export interface StructuredLogRecord extends SafeLogFields {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly level: StructuredLogLevel;
  readonly event: StructuredLogEvent;
  readonly service: string;
  readonly workload: string;
  readonly environment: string;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly initiatorActorId?: string;
  readonly intentId?: string;
  readonly quoteId?: string;
  readonly transactionId?: string;
  readonly ledgerEventId?: string;
}

export type StructuredLogSink = (line: string, level: StructuredLogLevel) => void;

export interface StructuredLoggerOptions {
  readonly clock?: () => Date;
  readonly context?: LoggingContext;
  readonly environment?: NodeJS.ProcessEnv;
  readonly sink?: StructuredLogSink;
}

const MAX_SERIALIZED_LOG_BYTES = 4_096;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_ROUTE_PATTERN = /^\/[A-Za-z0-9_./:*-]{0,255}$/u;
const SAFE_METHODS = new Set([
  'CONNECT',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
  'TRACE',
]);
const SAFE_LEVELS = new Set<StructuredLogLevel>(['debug', 'info', 'warn', 'error', 'fatal']);
const SAFE_WORKLOADS = new Set(['api', 'worker', 'migration', 'openapi', 'unknown']);
const SAFE_OUTCOMES = new Set<StructuredLogOutcome>([
  'success',
  'failure',
  'rejected',
  'aborted',
  'retry',
  'idle',
]);
const SAFE_COMPONENTS = new Set([
  'Nest',
  'NestApplication',
  'NestFactory',
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);
const SAFE_ERROR_CODES = new Set([
  'ABORT_ERR',
  'CONFIGURATION_ERROR',
  'DATABASE_ERROR',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'JOB_ENVELOPE_INVALID',
  'JOB_HANDLER_FAILED',
  'JOB_PROCESSING_FAILED',
  'JOB_PROCESSING_ERROR',
  'MIGRATION_ERROR',
  'OPENAPI_ERROR',
  'OUTBOX_CLEANUP_FAILED',
  'OUTBOX_CLEANUP_ERROR',
  'OUTBOX_DISPATCH_PASS_FAILED',
  'OUTBOX_DISPATCH_ERROR',
  'OUTBOX_LEASE_LOST',
  'OUTBOX_TRANSPORT_FAILED',
  'OUTBOX_TRANSPORT_TIMEOUT',
  'OUTBOX_WORKER_FATAL',
  'OUTBOX_WORKER_HEALTH_FAILED',
  'RANGE_ERROR',
  'RECEIPT_OWNERSHIP_LOST',
  'REDIS_ERROR',
  'SQS_DELETE_FAILED',
  'SQS_ERROR',
  'SQS_RECEIPT_OWNERSHIP_EXPIRED',
  'SQS_VISIBILITY_HEARTBEAT_FAILED',
  'SQS_VISIBILITY_UPDATE_FAILED',
  'SYNTAX_ERROR',
  'TYPE_ERROR',
  'UNEXPECTED_ERROR',
]);

const EVENT_FIELD_KEYS: Readonly<Record<StructuredLogEvent, ReadonlySet<keyof SafeLogFields>>> = {
  [LOG_EVENTS.applicationStarted]: new Set(['outcome']),
  [LOG_EVENTS.applicationStartFailed]: new Set(['errorCode', 'outcome']),
  [LOG_EVENTS.applicationStopped]: new Set(['outcome']),
  [LOG_EVENTS.frameworkLifecycle]: new Set(['component']),
  [LOG_EVENTS.frameworkWarning]: new Set(['component']),
  [LOG_EVENTS.frameworkError]: new Set(['component', 'errorCode']),
  [LOG_EVENTS.httpRequestCompleted]: new Set([
    'method',
    'route',
    'statusCode',
    'durationMs',
    'outcome',
  ]),
  [LOG_EVENTS.httpRequestAborted]: new Set([
    'method',
    'route',
    'statusCode',
    'durationMs',
    'outcome',
  ]),
  [LOG_EVENTS.outboxDispatchCompleted]: new Set([
    'claimed',
    'published',
    'retried',
    'failed',
    'leaseLost',
    'durationMs',
    'outcome',
  ]),
  [LOG_EVENTS.outboxDispatchFailed]: new Set(['errorCode', 'outcome']),
  [LOG_EVENTS.outboxCleanupCompleted]: new Set(['deleted', 'durationMs', 'outcome']),
  [LOG_EVENTS.outboxCleanupFailed]: new Set(['errorCode', 'outcome']),
  [LOG_EVENTS.jobPublished]: new Set(['jobId', 'jobKind', 'messageId', 'durationMs', 'outcome']),
  [LOG_EVENTS.jobPublishFailed]: new Set([
    'jobId',
    'jobKind',
    'retryCount',
    'retryDelayMs',
    'errorCode',
    'outcome',
  ]),
  [LOG_EVENTS.jobProcessed]: new Set([
    'jobId',
    'jobKind',
    'messageId',
    'receiveCount',
    'durationMs',
    'outcome',
  ]),
  [LOG_EVENTS.jobRetryScheduled]: new Set([
    'jobId',
    'jobKind',
    'messageId',
    'receiveCount',
    'retryCount',
    'retryDelayMs',
    'errorCode',
    'outcome',
  ]),
  [LOG_EVENTS.jobAwaitingDeadLetter]: new Set([
    'jobId',
    'jobKind',
    'messageId',
    'receiveCount',
    'errorCode',
    'outcome',
  ]),
  [LOG_EVENTS.jobOwnershipLost]: new Set([
    'jobId',
    'jobKind',
    'messageId',
    'receiveCount',
    'errorCode',
    'outcome',
  ]),
  [LOG_EVENTS.workerStarted]: new Set(['outcome']),
  [LOG_EVENTS.workerStartFailed]: new Set(['errorCode', 'outcome']),
  [LOG_EVENTS.workerStopped]: new Set(['outcome']),
  [LOG_EVENTS.workerHealthFailed]: new Set(['errorCode', 'outcome']),
  [LOG_EVENTS.migrationCompleted]: new Set(['durationMs', 'outcome']),
  [LOG_EVENTS.migrationFailed]: new Set(['errorCode', 'outcome']),
  [LOG_EVENTS.openApiGenerated]: new Set(['durationMs', 'outcome']),
  [LOG_EVENTS.openApiFailed]: new Set(['errorCode', 'outcome']),
};
const SAFE_EVENTS = new Set<StructuredLogEvent>(Object.values(LOG_EVENTS));

function defaultSink(line: string, level: StructuredLogLevel): void {
  const output = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
  output.write(`${line}\n`);
}

function safeRuntimeName(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,62}$/u.test(normalized) ? normalized : fallback;
}

function safeWorkload(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? 'unknown';
  return SAFE_WORKLOADS.has(normalized) ? normalized : 'unknown';
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value) ? value : undefined;
}

function safeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : undefined;
}

function safeDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000) / 1_000
    : undefined;
}

function projectFields(event: StructuredLogEvent, fields: SafeLogFields): SafeLogFields {
  const permitted = EVENT_FIELD_KEYS[event];
  const projected: Record<string, string | number> = {};
  if (permitted.has('component') && fields.component && SAFE_COMPONENTS.has(fields.component)) {
    projected.component = fields.component;
  }
  if (permitted.has('method') && fields.method && SAFE_METHODS.has(fields.method)) {
    projected.method = fields.method;
  }
  if (permitted.has('route') && fields.route && SAFE_ROUTE_PATTERN.test(fields.route)) {
    projected.route = fields.route;
  }
  const statusCode = safeInteger(fields.statusCode, 599);
  if (permitted.has('statusCode') && statusCode !== undefined && statusCode >= 100) {
    projected.statusCode = statusCode;
  }
  const durationMs = safeDuration(fields.durationMs);
  if (permitted.has('durationMs') && durationMs !== undefined) projected.durationMs = durationMs;
  if (permitted.has('outcome') && fields.outcome && SAFE_OUTCOMES.has(fields.outcome)) {
    projected.outcome = fields.outcome;
  }
  if (permitted.has('errorCode') && fields.errorCode && SAFE_ERROR_CODES.has(fields.errorCode)) {
    projected.errorCode = fields.errorCode;
  }
  for (const name of ['jobId', 'jobKind', 'messageId'] as const) {
    const value = safeIdentifier(fields[name]);
    if (permitted.has(name) && value) projected[name] = value;
  }
  for (const [name, maximum] of [
    ['receiveCount', 1_000],
    ['retryCount', 1_000],
    ['retryDelayMs', 900_000],
    ['claimed', 10_000],
    ['published', 10_000],
    ['retried', 10_000],
    ['failed', 10_000],
    ['leaseLost', 10_000],
    ['deleted', 100_000],
  ] as const) {
    const value = safeInteger(fields[name], maximum);
    if (permitted.has(name) && value !== undefined) projected[name] = value;
  }
  return projected;
}

function safeFrameworkComponent(optionalParams: readonly unknown[]): string {
  for (let index = optionalParams.length - 1; index >= 0; index -= 1) {
    const component = optionalParams[index];
    if (typeof component === 'string' && SAFE_COMPONENTS.has(component)) return component;
  }
  return 'Nest';
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof TypeError) return 'TYPE_ERROR';
  if (error instanceof RangeError) return 'RANGE_ERROR';
  if (error instanceof SyntaxError) return 'SYNTAX_ERROR';
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === 'string' && SAFE_ERROR_CODES.has(code)) return code;
  }
  return 'UNEXPECTED_ERROR';
}

/** One-line JSON logger that projects only explicitly approved scalar fields. */
export class StructuredLogger implements LoggerService {
  private readonly clock: () => Date;
  private readonly context: LoggingContext;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly sink: StructuredLogSink;

  constructor(options: StructuredLoggerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.context = options.context ?? loggingContext;
    this.environment = options.environment ?? process.env;
    this.sink =
      options.sink ??
      (safeRuntimeName(this.environment.NODE_ENV, 'unknown') === 'test'
        ? () => undefined
        : defaultSink);
  }

  emit(event: StructuredLogEvent, level: StructuredLogLevel, fields: SafeLogFields = {}): void {
    try {
      if (!SAFE_EVENTS.has(event) || !SAFE_LEVELS.has(level)) return;
      const context = this.context.current();
      const coreRecord = {
        schemaVersion: 1 as const,
        timestamp: this.clock().toISOString(),
        level,
        event,
        service: 'crypto-lending',
        workload: safeWorkload(this.environment.APPLICATION_WORKLOAD),
        environment: safeRuntimeName(
          this.environment.APP_ENV ?? this.environment.NODE_ENV,
          'unknown',
        ),
        ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
        ...(context?.requestId ? { requestId: context.requestId } : {}),
      };
      const record: StructuredLogRecord = {
        ...coreRecord,
        ...projectFields(event, fields),
        ...(context?.initiatorActorId ? { initiatorActorId: context.initiatorActorId } : {}),
        ...(context?.jobId ? { jobId: context.jobId } : {}),
        ...(context?.intentId ? { intentId: context.intentId } : {}),
        ...(context?.quoteId ? { quoteId: context.quoteId } : {}),
        ...(context?.transactionId ? { transactionId: context.transactionId } : {}),
        ...(context?.ledgerEventId ? { ledgerEventId: context.ledgerEventId } : {}),
      };
      let line = JSON.stringify(record);
      if (Buffer.byteLength(line) > MAX_SERIALIZED_LOG_BYTES) {
        line = JSON.stringify(coreRecord);
      }
      if (Buffer.byteLength(line) <= MAX_SERIALIZED_LOG_BYTES) this.sink(line, level);
    } catch {
      // Application behavior must never depend on diagnostic record construction or delivery.
    }
  }

  emitFatal(event: StructuredLogEvent, error: unknown, fields: SafeLogFields = {}): void {
    this.emit(event, 'fatal', { ...fields, errorCode: safeErrorCode(error) });
  }

  log(_message: unknown, ...optionalParams: unknown[]): void {
    this.emit(LOG_EVENTS.frameworkLifecycle, 'info', {
      component: safeFrameworkComponent(optionalParams),
    });
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(LOG_EVENTS.frameworkError, 'error', {
      component: safeFrameworkComponent(optionalParams),
      errorCode: safeErrorCode(message),
    });
  }

  warn(_message: unknown, ...optionalParams: unknown[]): void {
    this.emit(LOG_EVENTS.frameworkWarning, 'warn', {
      component: safeFrameworkComponent(optionalParams),
    });
  }

  debug(_message: unknown, ...optionalParams: unknown[]): void {
    this.emit(LOG_EVENTS.frameworkLifecycle, 'debug', {
      component: safeFrameworkComponent(optionalParams),
    });
  }

  verbose(_message: unknown, ...optionalParams: unknown[]): void {
    this.debug(undefined, ...optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit(LOG_EVENTS.frameworkError, 'fatal', {
      component: safeFrameworkComponent(optionalParams),
      errorCode: safeErrorCode(message),
    });
  }
}

export const structuredLogger = new StructuredLogger();
