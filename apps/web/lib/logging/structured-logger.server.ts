import { Buffer } from 'node:buffer';

export const WEB_LOG_EVENTS = Object.freeze({
  runtimeStarted: 'web.runtime.started',
  requestFailed: 'web.request.failed',
  processFatal: 'process.fatal',
} as const);

export const WEB_LOG_ROUTES = Object.freeze([
  '/',
  '/account',
  '/api/health',
  '/api/version',
  '/login',
  '/register',
] as const);

export type WebLogEvent = (typeof WEB_LOG_EVENTS)[keyof typeof WEB_LOG_EVENTS];
export type WebLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type WebLogOutcome = 'success' | 'failure' | 'rejected' | 'aborted' | 'retry' | 'idle';

export interface SafeWebLogFields {
  readonly method?: string;
  readonly route?: string;
  readonly outcome?: WebLogOutcome;
  readonly errorCode?: string;
}

export interface WebStructuredLogRecord extends SafeWebLogFields {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly level: WebLogLevel;
  readonly event: WebLogEvent;
  readonly service: 'crypto-lending';
  readonly workload: 'web';
  readonly environment: string;
}

export type WebStructuredLogSink = (line: string, level: WebLogLevel) => void;

export interface WebStructuredLoggerOptions {
  readonly clock?: () => Date;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly sink?: WebStructuredLogSink;
}

const MAX_SERIALIZED_LOG_BYTES = 4_096;
const DATE_TO_ISO_STRING = Date.prototype.toISOString;
const JSON_STRINGIFY = JSON.stringify;
const SAFE_EVENTS = new Set<WebLogEvent>(Object.values(WEB_LOG_EVENTS));
const SAFE_LEVELS = new Set<WebLogLevel>(['debug', 'info', 'warn', 'error', 'fatal']);
const SAFE_OUTCOMES = new Set<WebLogOutcome>([
  'success',
  'failure',
  'rejected',
  'aborted',
  'retry',
  'idle',
]);
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
const SAFE_ROUTES = new Set<string>(WEB_LOG_ROUTES);
const SAFE_ERROR_CODES = new Set([
  'ABORT_ERR',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'RANGE_ERROR',
  'SYNTAX_ERROR',
  'TYPE_ERROR',
  'UNEXPECTED_ERROR',
  'WEB_REQUEST_ERROR',
]);
const SAFE_FIELD_KEYS = new Set<keyof SafeWebLogFields>([
  'method',
  'route',
  'outcome',
  'errorCode',
]);
const EVENT_FIELD_KEYS: Readonly<Record<WebLogEvent, ReadonlySet<keyof SafeWebLogFields>>> =
  Object.freeze({
    [WEB_LOG_EVENTS.runtimeStarted]: new Set<keyof SafeWebLogFields>(['outcome']),
    [WEB_LOG_EVENTS.requestFailed]: new Set<keyof SafeWebLogFields>([
      'method',
      'route',
      'outcome',
      'errorCode',
    ]),
    [WEB_LOG_EVENTS.processFatal]: new Set<keyof SafeWebLogFields>(['outcome', 'errorCode']),
  });

function defaultSink(line: string, level: WebLogLevel): void {
  const output = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
  output.write(`${line}\n`);
}

function safeRuntimeName(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,62}$/u.test(normalized) ? normalized : fallback;
}

function ownDataFields(value: unknown): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const projected = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return undefined;
      if (!SAFE_FIELD_KEYS.has(key as keyof SafeWebLogFields)) continue;
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) return undefined;
      projected[key] = descriptor.value;
    }
    return projected;
  } catch {
    return undefined;
  }
}

function projectFields(event: WebLogEvent, fields: SafeWebLogFields): SafeWebLogFields {
  const source = ownDataFields(fields);
  if (!source) return {};
  const permitted = EVENT_FIELD_KEYS[event];
  const projected = Object.create(null) as Record<string, string>;

  if (
    permitted.has('method') &&
    typeof source.method === 'string' &&
    SAFE_METHODS.has(source.method)
  ) {
    projected.method = source.method;
  }
  if (permitted.has('route') && typeof source.route === 'string' && SAFE_ROUTES.has(source.route)) {
    projected.route = source.route;
  }
  if (
    permitted.has('outcome') &&
    typeof source.outcome === 'string' &&
    SAFE_OUTCOMES.has(source.outcome as WebLogOutcome)
  ) {
    projected.outcome = source.outcome;
  }
  if (
    permitted.has('errorCode') &&
    typeof source.errorCode === 'string' &&
    SAFE_ERROR_CODES.has(source.errorCode)
  ) {
    projected.errorCode = source.errorCode;
  }
  return projected;
}

function isCompleteEvent(
  event: WebLogEvent,
  level: WebLogLevel,
  fields: SafeWebLogFields,
): boolean {
  if (event === WEB_LOG_EVENTS.runtimeStarted) {
    return level === 'info' && fields.outcome === 'success';
  }
  if (event === WEB_LOG_EVENTS.requestFailed) {
    return level === 'error' && fields.outcome === 'failure' && fields.errorCode !== undefined;
  }
  return level === 'fatal' && fields.outcome === 'failure' && fields.errorCode !== undefined;
}

export function safeWebErrorCode(error: unknown): string {
  try {
    if (error instanceof TypeError) return 'TYPE_ERROR';
    if (error instanceof RangeError) return 'RANGE_ERROR';
    if (error instanceof SyntaxError) return 'SYNTAX_ERROR';
    if (error && typeof error === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      if (descriptor && 'value' in descriptor) {
        const code = descriptor.value;
        if (typeof code === 'string' && SAFE_ERROR_CODES.has(code)) return code;
      }
    }
  } catch {
    return 'UNEXPECTED_ERROR';
  }
  return 'UNEXPECTED_ERROR';
}

/** Server-only one-line JSON logger with an event-specific scalar allowlist. */
export class WebStructuredLogger {
  private readonly clock: () => Date;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly sink: WebStructuredLogSink;

  constructor(options: WebStructuredLoggerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.environment = options.environment ?? process.env;
    this.sink =
      options.sink ??
      (safeRuntimeName(this.environment.NODE_ENV, 'unknown') === 'test'
        ? () => undefined
        : defaultSink);
  }

  emit(event: WebLogEvent, level: WebLogLevel, fields: SafeWebLogFields = {}): void {
    try {
      if (!SAFE_EVENTS.has(event) || !SAFE_LEVELS.has(level)) return;
      const projectedFields = projectFields(event, fields);
      if (!isCompleteEvent(event, level, projectedFields)) return;
      const record = Object.assign(Object.create(null), {
        schemaVersion: 1,
        timestamp: DATE_TO_ISO_STRING.call(this.clock()),
        level,
        event,
        service: 'crypto-lending',
        workload: 'web',
        environment: safeRuntimeName(
          this.environment.APP_ENV ?? this.environment.NODE_ENV,
          'unknown',
        ),
        ...projectedFields,
      }) as WebStructuredLogRecord;
      const line = JSON_STRINGIFY(record);
      if (Buffer.byteLength(line) <= MAX_SERIALIZED_LOG_BYTES) this.sink(line, level);
    } catch {
      // Diagnostics must never change request or process-boundary behavior.
    }
  }

  emitFatal(event: typeof WEB_LOG_EVENTS.processFatal, error: unknown): void {
    try {
      this.emit(event, 'fatal', {
        outcome: 'failure',
        errorCode: safeWebErrorCode(error),
      });
    } catch {
      // Fatal diagnostics must not replace the original failure.
    }
  }
}

export const webStructuredLogger = new WebStructuredLogger();
