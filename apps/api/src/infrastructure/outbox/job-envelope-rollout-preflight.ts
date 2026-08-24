import { Buffer } from 'node:buffer';

import { parseJobEnvelope, type JobEnvelope } from './job-envelope';
import {
  MAX_CUSTOM_JOB_ATTRIBUTES,
  MAX_JOB_JSON_DEPTH,
  MAX_JOB_JSON_NODES,
  MAX_JOB_MESSAGE_BYTES,
  RESERVED_JOB_MESSAGE_ATTRIBUTE_NAMES,
  serializeJobMessage,
} from './job-message-policy';

export const JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION = 1 as const;

const LEGACY_ENVELOPE_KEYS = new Set(['id', 'kind', 'version', 'occurredAt', 'payload']);
const CORRELATED_ENVELOPE_KEYS = new Set([
  'id',
  'kind',
  'version',
  'occurredAt',
  'correlation',
  'payload',
]);
const RESERVED_ATTRIBUTE_NAMES = new Map(
  RESERVED_JOB_MESSAGE_ATTRIBUTE_NAMES.map((name) => [name.toLowerCase(), name]),
);

export type JobEnvelopeShape = 'correlated' | 'legacy-correlationless' | 'unsupported';

export type JobEnvelopePreflightReasonCode =
  | 'ROW_INVALID'
  | 'ENVELOPE_SHAPE_UNSUPPORTED'
  | 'ENVELOPE_INVALID'
  | 'MESSAGE_ATTRIBUTES_INVALID'
  | 'RESERVED_ATTRIBUTE_COLLISION'
  | 'LEGACY_SEVEN_ATTRIBUTE_ENVELOPE'
  | 'TOO_MANY_CUSTOM_ATTRIBUTES'
  | 'JSON_DEPTH_EXCEEDED'
  | 'JSON_NODE_LIMIT_EXCEEDED'
  | 'MESSAGE_SIZE_HEADROOM_INSUFFICIENT'
  | 'MESSAGE_SERIALIZATION_INVALID';

export interface PendingOutboxEnvelopeSnapshotRow {
  readonly id: string;
  readonly queueName: string;
  readonly payload: unknown;
  readonly messageAttributes: unknown;
}

export interface JobEnvelopePreflightReason {
  readonly code: JobEnvelopePreflightReasonCode;
  readonly detail: string;
  readonly attributeNames?: readonly string[];
}

export interface JobEnvelopePreflightRowResult {
  readonly rowId: string;
  readonly queueName?: string;
  readonly envelopeShape: JobEnvelopeShape;
  readonly status: 'compatible' | 'incompatible';
  readonly normalizedLegacyCorrelation: boolean;
  readonly customAttributeCount?: number;
  readonly projectedMessageBytes?: number;
  readonly messageHeadroomBytes?: number;
  readonly reasons: readonly JobEnvelopePreflightReason[];
}

export interface JobEnvelopeRolloutPreflightReport {
  readonly schemaVersion: typeof JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION;
  readonly scannedRows: number;
  readonly compatibleRows: number;
  readonly incompatibleRows: number;
  readonly legacyRows: number;
  readonly reasonCounts: Readonly<Partial<Record<JobEnvelopePreflightReasonCode, number>>>;
  readonly rows: readonly JobEnvelopePreflightRowResult[];
}

const REASON_DETAILS: Readonly<Record<JobEnvelopePreflightReasonCode, string>> = Object.freeze({
  ROW_INVALID: 'Snapshot row must contain data-only id, queueName, payload, and messageAttributes.',
  ENVELOPE_SHAPE_UNSUPPORTED:
    'Stored envelope keys do not exactly match the correlated or correlation-less legacy contract.',
  ENVELOPE_INVALID: 'Stored envelope does not satisfy the durable job-envelope contract.',
  MESSAGE_ATTRIBUTES_INVALID:
    'Stored custom attributes are not a plain string-valued SQS attribute record.',
  RESERVED_ATTRIBUTE_COLLISION:
    'A stored custom attribute collides case-insensitively with correlated envelope metadata.',
  LEGACY_SEVEN_ATTRIBUTE_ENVELOPE:
    'Legacy row uses seven custom attributes; correlation metadata leaves capacity for six.',
  TOO_MANY_CUSTOM_ATTRIBUTES:
    'Stored row exceeds the correlated envelope custom-attribute capacity.',
  JSON_DEPTH_EXCEEDED: `Projected correlated job JSON exceeds depth ${MAX_JOB_JSON_DEPTH}.`,
  JSON_NODE_LIMIT_EXCEEDED: `Projected correlated job JSON exceeds ${MAX_JOB_JSON_NODES} nodes.`,
  MESSAGE_SIZE_HEADROOM_INSUFFICIENT:
    'Stored row has insufficient SQS byte headroom for the projected correlated envelope.',
  MESSAGE_SERIALIZATION_INVALID:
    'Stored row cannot be projected to the supported correlated SQS JSON contract.',
});

const REASON_ORDER: readonly JobEnvelopePreflightReasonCode[] = [
  'ROW_INVALID',
  'ENVELOPE_SHAPE_UNSUPPORTED',
  'ENVELOPE_INVALID',
  'MESSAGE_ATTRIBUTES_INVALID',
  'RESERVED_ATTRIBUTE_COLLISION',
  'LEGACY_SEVEN_ATTRIBUTE_ENVELOPE',
  'TOO_MANY_CUSTOM_ATTRIBUTES',
  'JSON_DEPTH_EXCEEDED',
  'JSON_NODE_LIMIT_EXCEEDED',
  'MESSAGE_SIZE_HEADROOM_INSUFFICIENT',
  'MESSAGE_SERIALIZATION_INVALID',
];

type ParsedSnapshotRow = PendingOutboxEnvelopeSnapshotRow;

interface AttributeInspection {
  readonly entries?: readonly (readonly [string, string])[];
  readonly collisionNames: readonly string[];
  readonly valid: boolean;
}

interface JsonInspection {
  maxDepth: number;
  nodes: number;
  violation?: 'depth' | 'nodes' | 'unsupported';
}

function dataProperties(value: unknown): Readonly<Record<string, PropertyDescriptor>> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      return undefined;
    }
    return descriptors;
  } catch {
    return undefined;
  }
}

function dataValue(
  descriptors: Readonly<Record<string, PropertyDescriptor>>,
  key: string,
): unknown {
  const descriptor = Object.hasOwn(descriptors, key) ? descriptors[key] : undefined;
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function parseSnapshotRow(value: unknown): ParsedSnapshotRow | undefined {
  const descriptors = dataProperties(value);
  if (!descriptors) return undefined;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 4 ||
    !['id', 'queueName', 'payload', 'messageAttributes'].every((key) =>
      Object.hasOwn(descriptors, key),
    )
  ) {
    return undefined;
  }
  const id = dataValue(descriptors, 'id');
  const queueName = dataValue(descriptors, 'queueName');
  if (
    typeof id !== 'string' ||
    id.length < 1 ||
    id.length > 128 ||
    id.trim() !== id ||
    typeof queueName !== 'string' ||
    queueName.length < 1 ||
    queueName.length > 128 ||
    queueName.trim() !== queueName
  ) {
    return undefined;
  }
  return {
    id,
    queueName,
    payload: dataValue(descriptors, 'payload'),
    messageAttributes: dataValue(descriptors, 'messageAttributes'),
  };
}

function exactKeySet(value: unknown, expected: ReadonlySet<string>): boolean {
  const descriptors = dataProperties(value);
  if (!descriptors) return false;
  const keys = Reflect.ownKeys(descriptors);
  return keys.length === expected.size && keys.every((key) => expected.has(key as string));
}

function classifyEnvelopeShape(value: unknown): JobEnvelopeShape {
  if (exactKeySet(value, CORRELATED_ENVELOPE_KEYS)) return 'correlated';
  if (exactKeySet(value, LEGACY_ENVELOPE_KEYS)) return 'legacy-correlationless';
  return 'unsupported';
}

function isSqsText(value: string): boolean {
  if (value.length === 0) return false;
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

function isAttributeNameSyntaxValid(name: string): boolean {
  const normalized = name.toLowerCase();
  return Boolean(
    name.length >= 1 &&
    name.length <= 256 &&
    /^[A-Za-z0-9_.-]+$/u.test(name) &&
    !name.startsWith('.') &&
    !name.endsWith('.') &&
    !name.includes('..') &&
    !normalized.startsWith('aws.') &&
    !normalized.startsWith('amazon.'),
  );
}

function inspectAttributes(value: unknown): AttributeInspection {
  const descriptors = dataProperties(value);
  if (!descriptors) return { collisionNames: [], valid: false };
  const entries: Array<readonly [string, string]> = [];
  const collisionNames = new Set<string>();
  let valid = true;
  for (const name of Reflect.ownKeys(descriptors) as string[]) {
    const descriptor = Object.hasOwn(descriptors, name) ? descriptors[name] : undefined;
    const attributeValue = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    if (typeof attributeValue !== 'string') {
      valid = false;
      continue;
    }
    entries.push([name, attributeValue]);
    if (!isAttributeNameSyntaxValid(name) || !isSqsText(attributeValue)) valid = false;
    const reservedName = RESERVED_ATTRIBUTE_NAMES.get(name.toLowerCase());
    if (reservedName) collisionNames.add(reservedName);
  }
  return {
    entries,
    collisionNames: [...collisionNames].sort((left, right) => left.localeCompare(right)),
    valid,
  };
}

function inspectJson(value: unknown): JsonInspection {
  const inspection: JsonInspection = { maxDepth: 0, nodes: 0 };
  const ancestors = new WeakSet<object>();

  const visit = (current: unknown, depth: number): void => {
    if (inspection.violation) return;
    inspection.nodes += 1;
    inspection.maxDepth = Math.max(inspection.maxDepth, depth);
    if (inspection.nodes > MAX_JOB_JSON_NODES) {
      inspection.violation = 'nodes';
      return;
    }
    if (depth > MAX_JOB_JSON_DEPTH) {
      inspection.violation = 'depth';
      return;
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) inspection.violation = 'unsupported';
      return;
    }
    if (typeof current !== 'object') {
      inspection.violation = 'unsupported';
      return;
    }
    if (ancestors.has(current)) {
      inspection.violation = 'unsupported';
      return;
    }

    try {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Reflect.ownKeys(descriptors);
      const prototype = Object.getPrototypeOf(current);
      const children: unknown[] = [];
      if (Array.isArray(current)) {
        if (prototype !== Array.prototype && prototype !== null) {
          inspection.violation = 'unsupported';
          return;
        }
        const lengthDescriptor = Object.hasOwn(descriptors, 'length')
          ? descriptors.length
          : undefined;
        const length =
          lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : undefined;
        if (
          !Number.isSafeInteger(length) ||
          (length as number) < 0 ||
          keys.length !== (length as number) + 1 ||
          keys.some(
            (key) =>
              typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
          )
        ) {
          inspection.violation = 'unsupported';
          return;
        }
        for (let index = 0; index < (length as number); index += 1) {
          const descriptor = Object.hasOwn(descriptors, String(index))
            ? descriptors[String(index)]
            : undefined;
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
            inspection.violation = 'unsupported';
            return;
          }
          children.push(descriptor.value);
        }
      } else {
        if (prototype !== Object.prototype && prototype !== null) {
          inspection.violation = 'unsupported';
          return;
        }
        for (const key of keys) {
          const descriptor = typeof key === 'string' ? descriptors[key] : undefined;
          if (
            typeof key !== 'string' ||
            !descriptor ||
            !('value' in descriptor) ||
            !descriptor.enumerable
          ) {
            inspection.violation = 'unsupported';
            return;
          }
          children.push(descriptor.value);
        }
      }

      ancestors.add(current);
      for (const child of children) visit(child, depth + 1);
      ancestors.delete(current);
    } catch {
      inspection.violation = 'unsupported';
    }
  };

  visit(value, 0);
  return inspection;
}

function attributeBytes(name: string, dataType: 'Number' | 'String', value: string): number {
  return Buffer.byteLength(name) + Buffer.byteLength(dataType) + Buffer.byteLength(value);
}

function projectedBytes(
  envelope: JobEnvelope,
  attributes: readonly (readonly [string, string])[],
): number | undefined {
  try {
    const body = JSON.stringify(envelope);
    if (body === undefined) return undefined;
    let bytes = Buffer.byteLength(body);
    bytes += attributeBytes('jobKind', 'String', envelope.kind);
    bytes += attributeBytes('jobVersion', 'Number', String(envelope.version));
    bytes += attributeBytes('jobId', 'String', envelope.id);
    bytes += attributeBytes('correlationId', 'String', envelope.correlation.correlationId);
    for (const [name, value] of attributes) bytes += attributeBytes(name, 'String', value);
    return bytes;
  } catch {
    return undefined;
  }
}

function invalidRowResult(index: number): JobEnvelopePreflightRowResult {
  return {
    rowId: `snapshot-row:${index}`,
    envelopeShape: 'unsupported',
    status: 'incompatible',
    normalizedLegacyCorrelation: false,
    reasons: [{ code: 'ROW_INVALID', detail: REASON_DETAILS.ROW_INVALID }],
  };
}

function analyzeRow(row: ParsedSnapshotRow): JobEnvelopePreflightRowResult {
  const envelopeShape = classifyEnvelopeShape(row.payload);
  const reasons = new Map<JobEnvelopePreflightReasonCode, JobEnvelopePreflightReason>();
  const addReason = (
    code: JobEnvelopePreflightReasonCode,
    extra: Pick<JobEnvelopePreflightReason, 'attributeNames'> = {},
  ): void => {
    reasons.set(code, { code, detail: REASON_DETAILS[code], ...extra });
  };

  if (envelopeShape === 'unsupported') addReason('ENVELOPE_SHAPE_UNSUPPORTED');

  let envelope: JobEnvelope | undefined;
  try {
    envelope = parseJobEnvelope(row.payload);
  } catch {
    addReason('ENVELOPE_INVALID');
  }

  const attributes = inspectAttributes(row.messageAttributes);
  if (!attributes.valid || !attributes.entries) addReason('MESSAGE_ATTRIBUTES_INVALID');
  if (attributes.collisionNames.length > 0) {
    addReason('RESERVED_ATTRIBUTE_COLLISION', {
      attributeNames: attributes.collisionNames,
    });
  }

  const customAttributeCount = attributes.entries?.length;
  if (customAttributeCount !== undefined && customAttributeCount > MAX_CUSTOM_JOB_ATTRIBUTES) {
    if (envelopeShape === 'legacy-correlationless' && customAttributeCount === 7) {
      addReason('LEGACY_SEVEN_ATTRIBUTE_ENVELOPE');
    } else {
      addReason('TOO_MANY_CUSTOM_ATTRIBUTES');
    }
  }

  let projectedMessageBytes: number | undefined;
  if (envelope) {
    const jsonInspection = inspectJson(envelope);
    if (jsonInspection.violation === 'depth') addReason('JSON_DEPTH_EXCEEDED');
    if (jsonInspection.violation === 'nodes') addReason('JSON_NODE_LIMIT_EXCEEDED');
    if (jsonInspection.violation === 'unsupported') addReason('MESSAGE_SERIALIZATION_INVALID');

    if (!jsonInspection.violation && attributes.entries && attributes.valid) {
      projectedMessageBytes = projectedBytes(envelope, attributes.entries);
      if (projectedMessageBytes === undefined) {
        addReason('MESSAGE_SERIALIZATION_INVALID');
      } else if (projectedMessageBytes > MAX_JOB_MESSAGE_BYTES) {
        addReason('MESSAGE_SIZE_HEADROOM_INSUFFICIENT');
      }

      if (
        customAttributeCount !== undefined &&
        customAttributeCount <= MAX_CUSTOM_JOB_ATTRIBUTES &&
        attributes.collisionNames.length === 0 &&
        projectedMessageBytes !== undefined &&
        projectedMessageBytes <= MAX_JOB_MESSAGE_BYTES
      ) {
        try {
          const serialized = serializeJobMessage(
            envelope,
            Object.fromEntries(attributes.entries) as Record<string, string>,
          );
          projectedMessageBytes = serialized.bytes;
        } catch {
          addReason('MESSAGE_SERIALIZATION_INVALID');
        }
      }
    }
  }

  const orderedReasons = REASON_ORDER.flatMap((code) => {
    const reason = reasons.get(code);
    return reason ? [reason] : [];
  });
  return {
    rowId: row.id,
    queueName: row.queueName,
    envelopeShape,
    status: orderedReasons.length === 0 ? 'compatible' : 'incompatible',
    normalizedLegacyCorrelation: envelopeShape === 'legacy-correlationless',
    ...(customAttributeCount === undefined ? {} : { customAttributeCount }),
    ...(projectedMessageBytes === undefined ? {} : { projectedMessageBytes }),
    ...(projectedMessageBytes === undefined
      ? {}
      : { messageHeadroomBytes: MAX_JOB_MESSAGE_BYTES - projectedMessageBytes }),
    reasons: orderedReasons,
  };
}

export function runJobEnvelopeRolloutPreflight(
  snapshotRows: unknown,
): JobEnvelopeRolloutPreflightReport {
  if (!Array.isArray(snapshotRows)) {
    throw new Error('Job envelope preflight snapshot must be an array');
  }

  const rows = snapshotRows.map((value, index) => {
    const row = parseSnapshotRow(value);
    return row ? analyzeRow(row) : invalidRowResult(index);
  });
  rows.sort((left, right) => left.rowId.localeCompare(right.rowId));

  const reasonCounts: Partial<Record<JobEnvelopePreflightReasonCode, number>> = {};
  for (const row of rows) {
    for (const reason of row.reasons) {
      reasonCounts[reason.code] = (reasonCounts[reason.code] ?? 0) + 1;
    }
  }

  return {
    schemaVersion: JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION,
    scannedRows: rows.length,
    compatibleRows: rows.filter((row) => row.status === 'compatible').length,
    incompatibleRows: rows.filter((row) => row.status === 'incompatible').length,
    legacyRows: rows.filter((row) => row.envelopeShape === 'legacy-correlationless').length,
    reasonCounts: Object.fromEntries(
      REASON_ORDER.flatMap((code) => {
        const count = reasonCounts[code];
        return count === undefined ? [] : [[code, count]];
      }),
    ) as Partial<Record<JobEnvelopePreflightReasonCode, number>>,
    rows,
  };
}
