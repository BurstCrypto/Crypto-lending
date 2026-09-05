import { createHash } from 'node:crypto';

import { BalanceSyncIndexerFailure } from '../../domain/balance-sync';
import {
  reviewBalanceSyncExecutionContext,
  type BalanceSyncExecutionContext,
  type ReviewedBalanceSyncExecutionContext,
} from '../../application/ports/balance-sync.ports';

const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 200_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const VERIFIED_TRANSPORT_FAILURES = new WeakSet<object>();

export interface BalanceJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly method: string;
  readonly params: readonly unknown[];
}

/**
 * Deliberately transport-only. Implementations own no URL, credential, retry,
 * DNS, TLS, or client policy here; no implementation is registered at runtime.
 * A transport must cooperatively stop and reject promptly when `signal` aborts;
 * it may not leave accepted I/O unresolved. This boundary never detaches I/O
 * with Promise.race.
 */
export interface BalanceJsonRpcTransport {
  exchange(request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown>;
}

export type BalanceJsonRpcTransportFailureCode =
  'TIMEOUT' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'PERMANENT';

/** A bounded transport classification. Raw provider text is never retained. */
export class BalanceJsonRpcTransportFailure extends Error {
  readonly code: BalanceJsonRpcTransportFailureCode;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: BalanceJsonRpcTransportFailureCode,
    options: Readonly<{ retryAfterSeconds?: number }> = {},
  ) {
    const validCode = isTransportFailureCode(code);
    super(validCode ? code : 'invalid balance JSON-RPC transport failure');
    this.name = 'BalanceJsonRpcTransportFailure';
    let retryAfterSeconds: number | undefined;
    try {
      retryAfterSeconds = snapshotRetryAfterSeconds(options);
    } catch {
      throw new TypeError('invalid balance JSON-RPC transport failure');
    }
    if (!validCode) throw new TypeError('invalid balance JSON-RPC transport failure');
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    VERIFIED_TRANSPORT_FAILURES.add(this);
    Object.freeze(this);
  }
}

export function balanceRpcRequest(
  method: string,
  params: readonly unknown[],
): BalanceJsonRpcRequest {
  if (typeof method !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(method)) {
    throw new TypeError('invalid JSON-RPC method');
  }
  let frozenParams: readonly unknown[];
  let canonicalParams: string;
  try {
    const snapshot = boundedJsonSnapshot(params);
    if (!Array.isArray(snapshot)) throw new Error('invalid JSON-RPC params');
    frozenParams = snapshot;
    canonicalParams = JSON.stringify(snapshot);
  } catch {
    throw new TypeError('invalid JSON-RPC params');
  }
  return Object.freeze({
    jsonrpc: '2.0',
    id: createHash('sha256')
      .update('crypto-lending:balance-json-rpc-request:v1\0')
      .update(method)
      .update('\0')
      .update(canonicalParams)
      .digest('hex'),
    method,
    params: frozenParams,
  });
}

export function parseBalanceRpcResult(response: unknown, expectedId: string): unknown {
  if (typeof expectedId !== 'string' || !/^[0-9a-f]{64}$/u.test(expectedId)) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  const record = snapshotRecord(response);
  if (record.jsonrpc !== '2.0' || record.id !== expectedId) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  const keys = Object.keys(record).sort();
  if (sameKeys(keys, ['id', 'jsonrpc', 'result'])) return record.result;
  if (!sameKeys(keys, ['error', 'id', 'jsonrpc'])) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  const error = exactRecord(record.error, ['code', 'message']);
  if (
    typeof error.code !== 'number' ||
    !Number.isSafeInteger(error.code) ||
    typeof error.message !== 'string' ||
    error.message.length < 1 ||
    error.message.length > 512
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  if (error.code === -32601 || error.code === -32602) {
    throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
  }
  throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
}

export async function exchangeBalanceRpc(
  transport: BalanceJsonRpcTransport,
  method: string,
  params: readonly unknown[],
  context: BalanceSyncExecutionContext,
): Promise<unknown> {
  const execution = requireExecutionContext(context);
  throwIfExecutionAborted(execution);
  const request = balanceRpcRequest(method, params);
  let response: unknown;
  try {
    response = await transport.exchange(request, execution.signal);
  } catch (error) {
    throwIfExecutionAborted(requireExecutionContext(context));
    throwMappedTransportFailure(error);
  }
  throwIfExecutionAborted(requireExecutionContext(context));
  return parseBalanceRpcResult(response, request.id);
}

function requireExecutionContext(context: unknown): Readonly<ReviewedBalanceSyncExecutionContext> {
  const reviewed = reviewBalanceSyncExecutionContext(context);
  if (reviewed === null) throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
  return reviewed;
}

function throwIfExecutionAborted(execution: Readonly<ReviewedBalanceSyncExecutionContext>): void {
  switch (execution.abortKind) {
    case 'DEADLINE':
      throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');
    case 'SHUTDOWN':
      throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
    case null:
      return;
  }
}

export function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = snapshotRecord(value);
  if (!sameKeys(Object.keys(record).sort(), [...keys].sort())) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  return record;
}

export function allowedRecord(
  value: unknown,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const record = snapshotRecord(value);
  const actual = Object.keys(record);
  if (
    requiredKeys.some((key) => !actual.includes(key)) ||
    actual.some((key) => !allowedKeys.includes(key))
  ) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  return record;
}

export function canonicalPositionId(parts: readonly string[]): string {
  let reviewedParts: readonly string[];
  try {
    const snapshot = boundedJsonSnapshot(parts);
    if (
      !Array.isArray(snapshot) ||
      snapshot.some((part) => typeof part !== 'string' || part.includes('\0'))
    ) {
      throw new Error('invalid balance position id parts');
    }
    reviewedParts = snapshot as readonly string[];
  } catch {
    throw new TypeError('invalid balance position id parts');
  }
  const hash = createHash('sha256').update('crypto-lending:balance-position:v1');
  for (const part of reviewedParts) hash.update('\0').update(part);
  return hash.digest('hex');
}

function recordFromOwnedJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
  return value as Record<string, unknown>;
}

function sameKeys(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  try {
    return recordFromOwnedJson(boundedJsonSnapshot(value));
  } catch {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
}

interface JsonSnapshotState {
  readonly seen: WeakSet<object>;
  nodes: number;
  bytes: number;
}

function boundedJsonSnapshot(value: unknown): unknown {
  const state: JsonSnapshotState = { seen: new WeakSet<object>(), nodes: 0, bytes: 0 };
  const snapshot = snapshotJsonValue(value, 0, state);
  const encoded = JSON.stringify(snapshot);
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_JSON_BYTES) {
    throw new Error('invalid JSON value');
  }
  return snapshot;
}

function snapshotJsonValue(value: unknown, depth: number, state: JsonSnapshotState): unknown {
  state.nodes += 1;
  if (depth > MAX_JSON_DEPTH || state.nodes > MAX_JSON_NODES) {
    throw new Error('invalid JSON value');
  }
  if (value === null || typeof value === 'boolean') {
    addSnapshotBytes(state, 5);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid JSON value');
    addSnapshotBytes(state, 32);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'string') {
    addSnapshotBytes(state, Buffer.byteLength(value, 'utf8') + 2);
    return value;
  }
  if (typeof value !== 'object') throw new Error('invalid JSON value');
  if (state.seen.has(value)) throw new Error('invalid JSON value');
  state.seen.add(value);

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (
    (array && prototype !== Array.prototype) ||
    (!array && prototype !== Object.prototype && prototype !== null)
  ) {
    throw new Error('invalid JSON value');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const propertyKeys = Reflect.ownKeys(descriptors);
  if (propertyKeys.some((key) => typeof key !== 'string')) throw new Error('invalid JSON value');
  addSnapshotBytes(state, 2);

  if (array) return snapshotJsonArray(descriptors, propertyKeys as string[], depth, state);
  return snapshotJsonRecord(descriptors, propertyKeys as string[], depth, state);
}

function snapshotJsonArray(
  descriptors: PropertyDescriptorMap,
  propertyKeys: readonly string[],
  depth: number,
  state: JsonSnapshotState,
): readonly unknown[] {
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_JSON_NODES - state.nodes ||
    propertyKeys.length !== lengthDescriptor.value + 1
  ) {
    throw new Error('invalid JSON value');
  }
  const length = lengthDescriptor.value as number;
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error('invalid JSON value');
    }
    addSnapshotBytes(state, 1);
    result.push(snapshotJsonValue(descriptor.value, depth + 1, state));
  }
  return Object.freeze(result);
}

function snapshotJsonRecord(
  descriptors: PropertyDescriptorMap,
  propertyKeys: readonly string[],
  depth: number,
  state: JsonSnapshotState,
): Readonly<Record<string, unknown>> {
  if (propertyKeys.length > MAX_JSON_NODES - state.nodes) throw new Error('invalid JSON value');
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of [...propertyKeys].sort()) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error('invalid JSON value');
    }
    addSnapshotBytes(state, Buffer.byteLength(key, 'utf8') + 3);
    result[key] = snapshotJsonValue(descriptor.value, depth + 1, state);
  }
  return Object.freeze(result);
}

function addSnapshotBytes(state: JsonSnapshotState, bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || state.bytes > MAX_JSON_BYTES - bytes) {
    throw new Error('invalid JSON value');
  }
  state.bytes += bytes;
}

function isTransportFailureCode(value: unknown): value is BalanceJsonRpcTransportFailureCode {
  return (
    value === 'TIMEOUT' ||
    value === 'RATE_LIMITED' ||
    value === 'UNAVAILABLE' ||
    value === 'PERMANENT'
  );
}

function snapshotRetryAfterSeconds(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid transport failure');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('invalid transport failure');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== 'string') ||
    keys.some((key) => key !== 'retryAfterSeconds') ||
    keys.length > 1
  ) {
    throw new Error('invalid transport failure');
  }
  if (keys.length === 0) return undefined;
  const descriptor = descriptors.retryAfterSeconds;
  if (!descriptor?.enumerable || !('value' in descriptor)) {
    throw new Error('invalid transport failure');
  }
  const retryAfterSeconds = descriptor.value as unknown;
  if (retryAfterSeconds === undefined) return undefined;
  if (!Number.isSafeInteger(retryAfterSeconds) || (retryAfterSeconds as number) < 0) {
    throw new Error('invalid transport failure');
  }
  return retryAfterSeconds as number;
}

function reviewedTransportFailure(
  value: unknown,
): Readonly<{ code: BalanceJsonRpcTransportFailureCode; retryAfterSeconds?: number }> | null {
  try {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
    if (!VERIFIED_TRANSPORT_FAILURES.has(value) || !Object.isFrozen(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const code = descriptors.code?.value as unknown;
    const retryAfterSeconds = descriptors.retryAfterSeconds?.value as unknown;
    if (
      !isTransportFailureCode(code) ||
      (retryAfterSeconds !== undefined &&
        (!Number.isSafeInteger(retryAfterSeconds) || (retryAfterSeconds as number) < 0))
    ) {
      return null;
    }
    return retryAfterSeconds === undefined
      ? Object.freeze({ code })
      : Object.freeze({ code, retryAfterSeconds: retryAfterSeconds as number });
  } catch {
    return null;
  }
}

function throwMappedTransportFailure(error: unknown): never {
  const failure = reviewedTransportFailure(error);
  switch (failure?.code) {
    case 'TIMEOUT':
      throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');
    case 'RATE_LIMITED':
      throw new BalanceSyncIndexerFailure(
        'RATE_LIMITED',
        failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds },
      );
    case 'UNAVAILABLE':
      throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
    case 'PERMANENT':
      throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
    default:
      throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
  }
}
