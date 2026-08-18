import { randomUUID } from 'node:crypto';

export interface JobEnvelope<Payload = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly payload: Payload;
}

export interface CreateJobEnvelopeOptions {
  id?: string;
  version?: number;
  occurredAt?: string;
}

const MAX_JOB_ID_LENGTH = 128;
const MAX_JOB_KIND_LENGTH = 128;

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

  return {
    id,
    kind: normalizedKind,
    version,
    occurredAt,
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

  return value as JobEnvelope<Payload>;
}
