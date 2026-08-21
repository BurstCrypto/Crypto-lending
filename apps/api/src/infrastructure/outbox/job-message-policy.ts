import { Buffer } from 'node:buffer';

import { parseJobEnvelope, type JobEnvelope } from './job-envelope';

// SQS currently accepts at most 1 MiB including message-attribute names, types,
// and values. Four attributes are reserved for stable job/correlation metadata.
export const MAX_JOB_MESSAGE_BYTES = 1_048_576;
export const MAX_CUSTOM_JOB_ATTRIBUTES = 6;

const RESERVED_ATTRIBUTE_NAMES = new Set(['correlationid', 'jobid', 'jobkind', 'jobversion']);

export interface SerializedJobMessage {
  body: string;
  bytes: number;
  messageAttributes: Readonly<Record<string, string>>;
}

function isValidAttributeName(name: string): boolean {
  const normalized = name.toLowerCase();
  return Boolean(
    name.length >= 1 &&
    name.length <= 256 &&
    /^[A-Za-z0-9_.-]+$/u.test(name) &&
    !name.startsWith('.') &&
    !name.endsWith('.') &&
    !name.includes('..') &&
    !normalized.startsWith('aws.') &&
    !normalized.startsWith('amazon.') &&
    !RESERVED_ATTRIBUTE_NAMES.has(normalized),
  );
}

function isSqsAllowedText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      !(
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff)
      )
    ) {
      return false;
    }
  }
  return true;
}

function assertSqsText(value: string, label: string, allowEmpty = true): void {
  if ((!allowEmpty && value.length === 0) || !isSqsAllowedText(value)) {
    throw new Error(`${label} contains characters SQS cannot accept`);
  }
}

export function parseJobMessageAttributes(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid job message attributes');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Job message attributes must be a plain object');
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_CUSTOM_JOB_ATTRIBUTES) {
    throw new Error(`Job messages support at most ${MAX_CUSTOM_JOB_ATTRIBUTES} custom attributes`);
  }
  for (const [name, attributeValue] of entries) {
    if (!isValidAttributeName(name)) {
      throw new Error('Invalid or reserved job message attribute name');
    }
    if (typeof attributeValue !== 'string') {
      throw new Error('Job message attributes must contain only strings');
    }
    assertSqsText(attributeValue, 'Job message attribute value', false);
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function attributeBytes(name: string, dataType: 'Number' | 'String', value: string): number {
  return Buffer.byteLength(name) + Buffer.byteLength(dataType) + Buffer.byteLength(value);
}

export function serializeJobMessage(
  envelope: JobEnvelope,
  messageAttributes: unknown,
): SerializedJobMessage {
  const attributes = parseJobMessageAttributes(messageAttributes);
  let body: string;
  try {
    const serialized = JSON.stringify(envelope, (_key, value: unknown) => {
      if (
        value === undefined ||
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        (typeof value === 'number' && !Number.isFinite(value))
      ) {
        throw new TypeError('unsupported JSON value');
      }
      return value;
    });
    if (serialized === undefined) throw new Error('envelope is not JSON serializable');
    parseJobEnvelope(JSON.parse(serialized) as unknown);
    body = serialized;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new Error(`Job message must be JSON serializable: ${reason}`, { cause: error });
  }

  assertSqsText(body, 'Job message body', false);
  assertSqsText(envelope.id, 'Job ID', false);
  assertSqsText(envelope.kind, 'Job kind', false);

  let bytes = Buffer.byteLength(body);
  bytes += attributeBytes('jobKind', 'String', envelope.kind);
  bytes += attributeBytes('jobVersion', 'Number', String(envelope.version));
  bytes += attributeBytes('jobId', 'String', envelope.id);
  bytes += attributeBytes('correlationId', 'String', envelope.correlation.correlationId);
  for (const [name, value] of Object.entries(attributes)) {
    bytes += attributeBytes(name, 'String', value);
  }
  if (bytes > MAX_JOB_MESSAGE_BYTES) {
    throw new Error(`Job message cannot exceed ${MAX_JOB_MESSAGE_BYTES} bytes`);
  }

  return { body, bytes, messageAttributes: attributes };
}
