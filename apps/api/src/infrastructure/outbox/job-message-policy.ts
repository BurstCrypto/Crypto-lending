import { Buffer } from 'node:buffer';

import { parseJobEnvelope, type JobEnvelope } from './job-envelope';

// SQS currently accepts at most 1 MiB including message-attribute names, types,
// and values. Four attributes are reserved for stable job/correlation metadata.
export const MAX_JOB_MESSAGE_BYTES = 1_048_576;
export const MAX_CUSTOM_JOB_ATTRIBUTES = 6;
export const MAX_JOB_JSON_DEPTH = 64;
export const MAX_JOB_JSON_NODES = 100_000;
export const RESERVED_JOB_MESSAGE_ATTRIBUTE_NAMES = Object.freeze([
  'correlationId',
  'jobId',
  'jobKind',
  'jobVersion',
] as const);

const RESERVED_ATTRIBUTE_NAMES = new Set(
  RESERVED_JOB_MESSAGE_ATTRIBUTE_NAMES.map((name) => name.toLowerCase()),
);
const JSON_STRINGIFY = JSON.stringify;
const JSON_PARSE = JSON.parse;
const MESSAGE_TOO_LARGE = Symbol('MESSAGE_TOO_LARGE');

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

interface MessageByteBudget {
  bytes: number;
}

function addMessageBytes(budget: MessageByteBudget, bytes: number): void {
  if (bytes > MAX_JOB_MESSAGE_BYTES - budget.bytes) {
    throw MESSAGE_TOO_LARGE;
  }
  budget.bytes += bytes;
}

function utf8CodePointBytes(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function assertSqsText(
  value: string,
  label: string,
  allowEmpty = true,
  budget?: MessageByteBudget,
): void {
  if (!allowEmpty && value.length === 0) {
    throw new Error(`${label} contains characters SQS cannot accept`);
  }
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
      throw new Error(`${label} contains characters SQS cannot accept`);
    }
    if (budget) addMessageBytes(budget, utf8CodePointBytes(codePoint));
  }
}

function addAttributeToBudget(
  budget: MessageByteBudget,
  name: string,
  dataType: 'Number' | 'String',
  value: string,
  label: string,
): void {
  addMessageBytes(budget, Buffer.byteLength(name) + Buffer.byteLength(dataType));
  assertSqsText(value, label, false, budget);
}

function parseJobMessageAttributesWithBudget(
  value: unknown,
  budget?: MessageByteBudget,
): Readonly<Record<string, string>> {
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
    if (budget) {
      addAttributeToBudget(budget, name, 'String', attributeValue, 'Job message attribute value');
    } else {
      assertSqsText(attributeValue, 'Job message attribute value', false);
    }
  }

  const parsed = Object.create(null) as Record<string, string>;
  for (const [name, attributeValue] of entries) parsed[name] = attributeValue;
  return Object.freeze(parsed);
}

export function parseJobMessageAttributes(value: unknown): Readonly<Record<string, string>> {
  return parseJobMessageAttributesWithBudget(value);
}

interface JsonCloneState {
  nodes: number;
  readonly seen: WeakSet<object>;
  readonly budget: MessageByteBudget;
}

function addJsonStringBytes(value: string, budget: MessageByteBudget): void {
  addMessageBytes(budget, 2);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      addMessageBytes(budget, 2);
      continue;
    }
    if (codeUnit <= 0x1f) {
      addMessageBytes(
        budget,
        codeUnit === 0x08 ||
          codeUnit === 0x09 ||
          codeUnit === 0x0a ||
          codeUnit === 0x0c ||
          codeUnit === 0x0d
          ? 2
          : 6,
      );
      continue;
    }
    if (codeUnit <= 0x7f) {
      addMessageBytes(budget, 1);
      continue;
    }
    if (codeUnit <= 0x7ff) {
      addMessageBytes(budget, 2);
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addMessageBytes(budget, 4);
        index += 1;
      } else {
        addMessageBytes(budget, 6);
      }
      continue;
    }
    addMessageBytes(budget, codeUnit >= 0xdc00 && codeUnit <= 0xdfff ? 6 : 3);
  }
}

function cloneSupportedJson(value: unknown, state: JsonCloneState, depth = 0): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_JOB_JSON_NODES || depth > MAX_JOB_JSON_DEPTH) {
    throw new TypeError('Job JSON exceeds structural limits');
  }
  if (value === null) {
    addMessageBytes(state.budget, 4);
    return value;
  }
  if (typeof value === 'string') {
    addJsonStringBytes(value, state.budget);
    return value;
  }
  if (typeof value === 'boolean') {
    addMessageBytes(state.budget, value ? 4 : 5);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Job JSON contains a non-finite number');
    addMessageBytes(state.budget, Object.is(value, -0) ? 1 : String(value).length);
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
      const lengthDescriptor = Object.hasOwn(descriptors, 'length')
        ? descriptors.length
        : undefined;
      const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : -1;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new TypeError('Job JSON array length is invalid');
      }
      const keys = Reflect.ownKeys(descriptors);
      if (
        keys.some(
          (key) =>
            typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
        ) ||
        keys.length !== length + 1
      ) {
        throw new TypeError('Job JSON arrays must be dense and contain no custom properties');
      }
      addMessageBytes(state.budget, 2 + Math.max(0, length - 1));
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
    const keys = Reflect.ownKeys(descriptors);
    addMessageBytes(state.budget, 2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      if (typeof key !== 'string') throw new TypeError('Job JSON cannot contain symbol keys');
      const descriptor = Object.hasOwn(descriptors, key) ? descriptors[key] : undefined;
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw new TypeError('Job JSON objects must contain enumerable data properties');
      }
      addJsonStringBytes(key, state.budget);
      addMessageBytes(state.budget, 1);
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
  const budget: MessageByteBudget = { bytes: 0 };
  let attributes: Readonly<Record<string, string>>;
  try {
    attributes = parseJobMessageAttributesWithBudget(messageAttributes, budget);
  } catch (error) {
    if (error === MESSAGE_TOO_LARGE) {
      throw new Error(`Job message cannot exceed ${MAX_JOB_MESSAGE_BYTES} bytes`, {
        cause: error,
      });
    }
    throw error;
  }
  const normalizedEnvelope = parseJobEnvelope(envelope);
  try {
    addAttributeToBudget(budget, 'jobKind', 'String', normalizedEnvelope.kind, 'Job kind');
    addAttributeToBudget(
      budget,
      'jobVersion',
      'Number',
      String(normalizedEnvelope.version),
      'Job version',
    );
    addAttributeToBudget(budget, 'jobId', 'String', normalizedEnvelope.id, 'Job ID');
    addAttributeToBudget(
      budget,
      'correlationId',
      'String',
      normalizedEnvelope.correlation.correlationId,
      'Correlation ID',
    );
  } catch (error) {
    if (error === MESSAGE_TOO_LARGE) {
      throw new Error(`Job message cannot exceed ${MAX_JOB_MESSAGE_BYTES} bytes`, {
        cause: error,
      });
    }
    throw error;
  }
  let body: string;
  try {
    const safeEnvelope = cloneSupportedJson(normalizedEnvelope, {
      nodes: 0,
      seen: new WeakSet(),
      budget,
    });
    const serialized = JSON_STRINGIFY(safeEnvelope);
    if (serialized === undefined) throw new Error('envelope is not JSON serializable');
    parseJobEnvelope(JSON_PARSE(serialized) as unknown);
    body = serialized;
  } catch (error) {
    if (error === MESSAGE_TOO_LARGE) {
      throw new Error(`Job message cannot exceed ${MAX_JOB_MESSAGE_BYTES} bytes`, {
        cause: error,
      });
    }
    throw new Error('Job message must contain only supported JSON data', { cause: error });
  }

  assertSqsText(body, 'Job message body', false);

  let bytes = Buffer.byteLength(body);
  bytes += attributeBytes('jobKind', 'String', normalizedEnvelope.kind);
  bytes += attributeBytes('jobVersion', 'Number', String(normalizedEnvelope.version));
  bytes += attributeBytes('jobId', 'String', normalizedEnvelope.id);
  bytes += attributeBytes('correlationId', 'String', normalizedEnvelope.correlation.correlationId);
  for (const [name, value] of Object.entries(attributes)) {
    bytes += attributeBytes(name, 'String', value);
  }
  if (bytes > MAX_JOB_MESSAGE_BYTES) {
    throw new Error(`Job message cannot exceed ${MAX_JOB_MESSAGE_BYTES} bytes`);
  }

  return { body, bytes, messageAttributes: attributes };
}
