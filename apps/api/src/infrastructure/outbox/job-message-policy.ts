import { Buffer } from 'node:buffer';

import { parseJobEnvelope, type JobEnvelope } from './job-envelope';

// SQS currently accepts at most 1 MiB including message-attribute names, types,
// and values. Four attributes are reserved for stable job/correlation metadata.
export const MAX_JOB_MESSAGE_BYTES = 1_048_576;
export const MAX_CUSTOM_JOB_ATTRIBUTES = 6;

const RESERVED_ATTRIBUTE_NAMES = new Set(['correlationid', 'jobid', 'jobkind', 'jobversion']);
const JSON_STRINGIFY = JSON.stringify;
const JSON_PARSE = JSON.parse;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;

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

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) {
    throw new Error('Invalid job message attributes');
  }
  const entries: [string, string][] = [];
  for (const name of keys as string[]) {
    const descriptor = Object.hasOwn(descriptors, name) ? descriptors[name] : undefined;
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
      throw new Error('Job message attributes must contain only string data properties');
    }
    entries.push([name, descriptor.value]);
  }
  if (entries.length > MAX_CUSTOM_JOB_ATTRIBUTES) {
    throw new Error(`Job messages support at most ${MAX_CUSTOM_JOB_ATTRIBUTES} custom attributes`);
  }
  for (const [name, attributeValue] of entries) {
    if (!isValidAttributeName(name)) {
      throw new Error('Invalid or reserved job message attribute name');
    }
    assertSqsText(attributeValue, 'Job message attribute value', false);
  }

  const parsed = Object.create(null) as Record<string, string>;
  for (const [name, attributeValue] of entries) parsed[name] = attributeValue;
  return Object.freeze(parsed);
}

interface JsonCloneState {
  nodes: number;
  readonly seen: WeakSet<object>;
}

function cloneSupportedJson(value: unknown, state: JsonCloneState, depth = 0): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new TypeError('Job JSON exceeds structural limits');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Job JSON contains a non-finite number');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('Job JSON contains an unsupported value');
  if (state.seen.has(value)) throw new TypeError('Job JSON contains a cycle');
  state.seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Array.prototype && prototype !== null) {
        throw new TypeError('Job JSON arrays must use the built-in prototype');
      }
      const lengthDescriptor = Object.hasOwn(descriptors, 'length') ? descriptors.length : undefined;
      const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : -1;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new TypeError('Job JSON array length is invalid');
      }
      const keys = Reflect.ownKeys(descriptors);
      if (
        keys.some(
          (key) =>
            typeof key !== 'string' ||
            (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
        ) ||
        keys.length !== length + 1
      ) {
        throw new TypeError('Job JSON arrays must be dense and contain no custom properties');
      }
      const cloned: unknown[] = [];
      Object.setPrototypeOf(cloned, null);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.hasOwn(descriptors, String(index))
          ? descriptors[String(index)]
          : undefined;
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw new TypeError('Job JSON arrays must contain enumerable data properties');
        }
        cloned[index] = cloneSupportedJson(descriptor.value, state, depth + 1);
      }
      return cloned;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Job JSON objects must be plain records');
    }
    const cloned = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new TypeError('Job JSON cannot contain symbol keys');
      const descriptor = Object.hasOwn(descriptors, key) ? descriptors[key] : undefined;
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw new TypeError('Job JSON objects must contain enumerable data properties');
      }
      cloned[key] = cloneSupportedJson(descriptor.value, state, depth + 1);
    }
    return cloned;
  } finally {
    state.seen.delete(value);
  }
}

function attributeBytes(name: string, dataType: 'Number' | 'String', value: string): number {
  return Buffer.byteLength(name) + Buffer.byteLength(dataType) + Buffer.byteLength(value);
}

export function serializeJobMessage(
  envelope: JobEnvelope,
  messageAttributes: unknown,
): SerializedJobMessage {
  const attributes = parseJobMessageAttributes(messageAttributes);
  const normalizedEnvelope = parseJobEnvelope(envelope);
  let body: string;
  try {
    const safeEnvelope = cloneSupportedJson(normalizedEnvelope, {
      nodes: 0,
      seen: new WeakSet(),
    });
    const serialized = JSON_STRINGIFY(safeEnvelope);
    if (serialized === undefined) throw new Error('envelope is not JSON serializable');
    parseJobEnvelope(JSON_PARSE(serialized) as unknown);
    body = serialized;
  } catch {
    throw new Error('Job message must contain only supported JSON data');
  }

  assertSqsText(body, 'Job message body', false);
  assertSqsText(normalizedEnvelope.id, 'Job ID', false);
  assertSqsText(normalizedEnvelope.kind, 'Job kind', false);

  let bytes = Buffer.byteLength(body);
  bytes += attributeBytes('jobKind', 'String', normalizedEnvelope.kind);
  bytes += attributeBytes('jobVersion', 'Number', String(normalizedEnvelope.version));
  bytes += attributeBytes('jobId', 'String', normalizedEnvelope.id);
  bytes += attributeBytes(
    'correlationId',
    'String',
    normalizedEnvelope.correlation.correlationId,
  );
  for (const [name, value] of Object.entries(attributes)) {
    bytes += attributeBytes(name, 'String', value);
  }
  if (bytes > MAX_JOB_MESSAGE_BYTES) {
    throw new Error(`Job message cannot exceed ${MAX_JOB_MESSAGE_BYTES} bytes`);
  }

  return { body, bytes, messageAttributes: attributes };
}
