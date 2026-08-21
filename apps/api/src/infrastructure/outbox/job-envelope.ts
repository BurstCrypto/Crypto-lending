import { createHash, randomUUID } from 'node:crypto';

import { loggingContext, type LogCorrelationContext } from '../logging';

/**
 * Safe, durable identifiers that connect an asynchronous job to the operation
 * that created it. The context is deliberately metadata-only: payloads,
 * credentials, headers, signatures, and arbitrary caller fields do not belong
 * here.
 */
export type JobCorrelationContext = Omit<LogCorrelationContext, 'jobId'>;

export interface JobEnvelope<Payload = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly correlation: JobCorrelationContext;
  readonly payload: Payload;
}

export interface CreateJobEnvelopeOptions {
  id?: string;
  version?: number;
  occurredAt?: string;
  correlation?: JobCorrelationContext;
}

const MAX_JOB_ID_LENGTH = 128;
const MAX_JOB_KIND_LENGTH = 128;
const MAX_CORRELATION_ID_LENGTH = 128;
const CORRELATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const CORRELATION_KEYS = new Set([
  'correlationId',
  'requestId',
  'initiatorActorId',
  'intentId',
  'quoteId',
  'transactionId',
  'ledgerEventId',
]);

function isValidOpaqueId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_JOB_ID_LENGTH &&
    value.trim() === value
  );
}

function isValidKind(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_JOB_KIND_LENGTH &&
    value.trim() === value
  );
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isValidCorrelationIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_CORRELATION_ID_LENGTH &&
    CORRELATION_IDENTIFIER_PATTERN.test(value)
  );
}

function parseCorrelationContext(value: unknown): JobCorrelationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid job correlation context');
  }
  const prototype = Object.getPrototypeOf(value);
  const prototypeConstructor =
    prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  if (
    prototype !== null &&
    (typeof prototypeConstructor !== 'function' || prototypeConstructor.name !== 'Object')
  ) {
    throw new Error('Invalid job correlation context');
  }
  const record = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(record);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !CORRELATION_KEYS.has(key)) ||
    Object.values(descriptors).some(
      (descriptor) => descriptor.get !== undefined || descriptor.set !== undefined,
    ) ||
    !isValidCorrelationIdentifier(record.correlationId)
  ) {
    throw new Error('Invalid job correlation context');
  }
  for (const key of [
    'requestId',
    'initiatorActorId',
    'intentId',
    'quoteId',
    'transactionId',
    'ledgerEventId',
  ] as const) {
    const identifier = record[key];
    if (identifier !== undefined && !isValidCorrelationIdentifier(identifier)) {
      throw new Error('Invalid job correlation context');
    }
  }

  return Object.freeze({
    correlationId: record.correlationId,
    ...(record.requestId === undefined ? {} : { requestId: record.requestId as string }),
    ...(record.initiatorActorId === undefined
      ? {}
      : { initiatorActorId: record.initiatorActorId as string }),
    ...(record.intentId === undefined ? {} : { intentId: record.intentId as string }),
    ...(record.quoteId === undefined ? {} : { quoteId: record.quoteId as string }),
    ...(record.transactionId === undefined
      ? {}
      : { transactionId: record.transactionId as string }),
    ...(record.ledgerEventId === undefined
      ? {}
      : { ledgerEventId: record.ledgerEventId as string }),
  });
}

/**
 * Old outbox rows and SQS messages predate correlation metadata. Hash their
 * stable job ID so replay is deterministic without copying a potentially
 * sensitive or log-hostile legacy identifier into the correlation field.
 */
function legacyCorrelationContext(jobId: string): JobCorrelationContext {
  const digest = createHash('sha256')
    .update('crypto-lending:legacy-job:')
    .update(jobId)
    .digest('hex');
  return Object.freeze({ correlationId: `legacy:${digest}` });
}

function activeJobCorrelationContext(): JobCorrelationContext | undefined {
  const active = loggingContext.current();
  if (!active) return undefined;
  return {
    correlationId: active.correlationId,
    ...(active.requestId ? { requestId: active.requestId } : {}),
    ...(active.initiatorActorId ? { initiatorActorId: active.initiatorActorId } : {}),
    ...(active.intentId ? { intentId: active.intentId } : {}),
    ...(active.quoteId ? { quoteId: active.quoteId } : {}),
    ...(active.transactionId ? { transactionId: active.transactionId } : {}),
    ...(active.ledgerEventId ? { ledgerEventId: active.ledgerEventId } : {}),
  };
}

export function createJobEnvelope<Payload>(
  kind: string,
  payload: Payload,
  options: CreateJobEnvelopeOptions = {},
): JobEnvelope<Payload> {
  const normalizedKind = kind.trim();
  if (!normalizedKind) {
    throw new Error('Job kind cannot be empty');
  }
  if (normalizedKind.length > MAX_JOB_KIND_LENGTH) {
    throw new Error(`Job kind cannot exceed ${MAX_JOB_KIND_LENGTH} characters`);
  }
  const version = options.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Job version must be a positive integer');
  }

  const id = options.id ?? randomUUID();
  if (!isValidOpaqueId(id)) {
    throw new Error(
      `Job id must be trimmed and contain between 1 and ${MAX_JOB_ID_LENGTH} characters`,
    );
  }
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  if (!isCanonicalIsoTimestamp(occurredAt)) {
    throw new Error('Job occurredAt must be a canonical ISO-8601 UTC timestamp');
  }
  const inheritedCorrelation = activeJobCorrelationContext();
  const correlation = parseCorrelationContext(
    options.correlation ?? inheritedCorrelation ?? { correlationId: randomUUID() },
  );

  return {
    id,
    kind: normalizedKind,
    version,
    occurredAt,
    correlation,
    payload,
  };
}

export function parseJobEnvelope<Payload = unknown>(value: unknown): JobEnvelope<Payload> {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    !isValidOpaqueId(value.id) ||
    !('kind' in value) ||
    !isValidKind(value.kind) ||
    !('version' in value) ||
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    !('occurredAt' in value) ||
    !isCanonicalIsoTimestamp(value.occurredAt) ||
    !('payload' in value)
  ) {
    throw new Error('Invalid job envelope');
  }

  const envelope = value as {
    id: string;
    kind: string;
    version: number;
    occurredAt: string;
    correlation?: unknown;
    payload: Payload;
  };

  return {
    id: envelope.id,
    kind: envelope.kind,
    version: envelope.version,
    occurredAt: envelope.occurredAt,
    correlation:
      envelope.correlation === undefined
        ? legacyCorrelationContext(envelope.id)
        : parseCorrelationContext(envelope.correlation),
    payload: envelope.payload,
  };
}
