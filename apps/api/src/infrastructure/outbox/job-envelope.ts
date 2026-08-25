import { randomUUID } from 'node:crypto';

import {
  createSafeLegacyCorrelationId,
  isCanonicalUuidV4,
  isSafeCorrelationId,
  loggingContext,
  type LogCorrelationContext,
} from '../logging';

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
const CORRELATION_KEYS = new Set([
  'correlationId',
  'requestId',
  'initiatorActorId',
  'intentId',
  'quoteId',
  'transactionId',
  'ledgerEventId',
]);
const JOB_OPTION_KEYS = new Set(['id', 'version', 'occurredAt', 'correlation']);

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

function parseCorrelationContext(value: unknown): JobCorrelationContext {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid job correlation context');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Invalid job correlation context');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== 'string' || !CORRELATION_KEYS.has(key))) {
      throw new Error('Invalid job correlation context');
    }
    const correlationDescriptor = Object.hasOwn(descriptors, 'correlationId')
      ? descriptors.correlationId
      : undefined;
    if (
      !correlationDescriptor ||
      !('value' in correlationDescriptor) ||
      !isSafeCorrelationId(correlationDescriptor.value)
    ) {
      throw new Error('Invalid job correlation context');
    }
    const correlationId = correlationDescriptor.value;
    const optional = Object.create(null) as Record<string, string>;
    for (const key of [
      'requestId',
      'initiatorActorId',
      'intentId',
      'quoteId',
      'transactionId',
      'ledgerEventId',
    ] as const) {
      const descriptor = Object.hasOwn(descriptors, key) ? descriptors[key] : undefined;
      if (!descriptor) continue;
      if (!('value' in descriptor) || !isCanonicalUuidV4(descriptor.value)) {
        throw new Error('Invalid job correlation context');
      }
      optional[key] = descriptor.value;
    }
    if (optional.requestId !== undefined && optional.requestId !== correlationId) {
      throw new Error('Invalid job correlation context');
    }
    if (correlationId.startsWith('legacy:') && Object.keys(optional).length > 0) {
      throw new Error('Invalid job correlation context');
    }
    const parsed = Object.create(null) as {
      correlationId: string;
    } & Partial<JobCorrelationContext>;
    parsed.correlationId = correlationId;
    for (const key of CORRELATION_KEYS) {
      if (key === 'correlationId') continue;
      const optionalValue = optional[key];
      if (optionalValue !== undefined) {
        Object.defineProperty(parsed, key, {
          value: optionalValue,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
    }
    return Object.freeze(parsed);
  } catch {
    throw new Error('Invalid job correlation context');
  }
}

/**
 * Old outbox rows and SQS messages predate correlation metadata. Hash their
 * stable job ID so replay is deterministic without copying a potentially
 * sensitive or log-hostile legacy identifier into the correlation field.
 */
function legacyCorrelationContext(jobId: string): JobCorrelationContext {
  const correlationId = createSafeLegacyCorrelationId('job', jobId);
  if (!correlationId) throw new Error('Invalid legacy job identifier');
  const context = Object.create(null) as { correlationId: string };
  context.correlationId = correlationId;
  return Object.freeze(context);
}

function correlationContextsEqual(
  left: JobCorrelationContext,
  right: JobCorrelationContext,
): boolean {
  return [...CORRELATION_KEYS].every(
    (key) => left[key as keyof JobCorrelationContext] === right[key as keyof JobCorrelationContext],
  );
}

/** Projects the active logging context onto the exact metadata allowed in a job envelope. */
export function currentJobCorrelationContext(): JobCorrelationContext | undefined {
  const active = loggingContext.current();
  if (!active) return undefined;
  const projected = Object.create(null) as Record<string, string>;
  for (const key of CORRELATION_KEYS) {
    const value = active[key as keyof LogCorrelationContext];
    if (value !== undefined) projected[key] = value;
  }
  return parseCorrelationContext(projected);
}

function parseCreateOptions(value: CreateJobEnvelopeOptions): Readonly<CreateJobEnvelopeOptions> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid job envelope options');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Invalid job envelope options');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !JOB_OPTION_KEYS.has(key),
      ) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      throw new Error('Invalid job envelope options');
    }
    const parsed = Object.create(null) as {
      id?: string;
      version?: number;
      occurredAt?: string;
      correlation?: JobCorrelationContext;
    };
    for (const key of JOB_OPTION_KEYS) {
      if (!Object.hasOwn(descriptors, key)) continue;
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) {
        throw new Error('Invalid job envelope options');
      }
      Object.defineProperty(parsed, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(parsed);
  } catch {
    throw new Error('Invalid job envelope options');
  }
}

export function createJobEnvelope<Payload>(
  kind: string,
  payload: Payload,
  options: CreateJobEnvelopeOptions = {},
): JobEnvelope<Payload> {
  const parsedOptions = parseCreateOptions(options);
  const normalizedKind = kind.trim();
  if (!normalizedKind) {
    throw new Error('Job kind cannot be empty');
  }
  if (normalizedKind.length > MAX_JOB_KIND_LENGTH) {
    throw new Error(`Job kind cannot exceed ${MAX_JOB_KIND_LENGTH} characters`);
  }
  const version = parsedOptions.version === undefined ? 1 : parsedOptions.version;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Job version must be a positive integer');
  }

  const id = parsedOptions.id === undefined ? randomUUID() : parsedOptions.id;
  if (!isValidOpaqueId(id)) {
    throw new Error(
      `Job id must be trimmed and contain between 1 and ${MAX_JOB_ID_LENGTH} characters`,
    );
  }
  const occurredAt =
    parsedOptions.occurredAt === undefined ? new Date().toISOString() : parsedOptions.occurredAt;
  if (!isCanonicalIsoTimestamp(occurredAt)) {
    throw new Error('Job occurredAt must be a canonical ISO-8601 UTC timestamp');
  }
  const inheritedCorrelation = currentJobCorrelationContext();
  let correlation: JobCorrelationContext;
  if (inheritedCorrelation) {
    correlation = parseCorrelationContext(inheritedCorrelation);
    if (parsedOptions.correlation !== undefined) {
      const explicitCorrelation = parseCorrelationContext(parsedOptions.correlation);
      if (!correlationContextsEqual(correlation, explicitCorrelation)) {
        throw new Error('Explicit job correlation must match the active logging context');
      }
    }
  } else {
    correlation = parseCorrelationContext(
      parsedOptions.correlation === undefined
        ? { correlationId: randomUUID() }
        : parsedOptions.correlation,
    );
  }

  return Object.freeze({
    id,
    kind: normalizedKind,
    version,
    occurredAt,
    correlation,
    payload,
  });
}

export function parseJobEnvelope<Payload = unknown>(value: unknown): JobEnvelope<Payload> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid job envelope');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Invalid job envelope');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const idDescriptor = Object.hasOwn(descriptors, 'id') ? descriptors.id : undefined;
    const kindDescriptor = Object.hasOwn(descriptors, 'kind') ? descriptors.kind : undefined;
    const versionDescriptor = Object.hasOwn(descriptors, 'version')
      ? descriptors.version
      : undefined;
    const occurredAtDescriptor = Object.hasOwn(descriptors, 'occurredAt')
      ? descriptors.occurredAt
      : undefined;
    const payloadDescriptor = Object.hasOwn(descriptors, 'payload')
      ? descriptors.payload
      : undefined;
    const correlationDescriptor = Object.hasOwn(descriptors, 'correlation')
      ? descriptors.correlation
      : undefined;
    const id = idDescriptor && 'value' in idDescriptor ? idDescriptor.value : undefined;
    const kind = kindDescriptor && 'value' in kindDescriptor ? kindDescriptor.value : undefined;
    const version =
      versionDescriptor && 'value' in versionDescriptor ? versionDescriptor.value : undefined;
    const occurredAt =
      occurredAtDescriptor && 'value' in occurredAtDescriptor
        ? occurredAtDescriptor.value
        : undefined;
    if (
      !isValidOpaqueId(id) ||
      !isValidKind(kind) ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !isCanonicalIsoTimestamp(occurredAt) ||
      !payloadDescriptor ||
      !('value' in payloadDescriptor)
    ) {
      throw new Error('Invalid job envelope');
    }
    const correlationValue =
      correlationDescriptor && 'value' in correlationDescriptor
        ? correlationDescriptor.value
        : undefined;
    if (correlationDescriptor && !('value' in correlationDescriptor)) {
      throw new Error('Invalid job envelope');
    }
    return Object.freeze({
      id,
      kind,
      version,
      occurredAt,
      correlation:
        correlationDescriptor === undefined
          ? legacyCorrelationContext(id)
          : parseCorrelationContext(correlationValue),
      payload: payloadDescriptor.value as Payload,
    });
  } catch {
    throw new Error('Invalid job envelope');
  }
}
