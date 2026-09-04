import { createHash } from 'node:crypto';

import { BalanceSyncIndexerFailure } from '../../domain/balance-sync';

export interface BalanceJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly method: string;
  readonly params: readonly unknown[];
}

/**
 * Deliberately transport-only. Implementations own no URL, credential, retry,
 * DNS, TLS, or client policy here; no implementation is registered at runtime.
 */
export interface BalanceJsonRpcTransport {
  exchange(request: BalanceJsonRpcRequest): Promise<unknown>;
}

export type BalanceJsonRpcTransportFailureCode =
  'TIMEOUT' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'PERMANENT';

/** A bounded transport classification. Raw provider text is never retained. */
export class BalanceJsonRpcTransportFailure extends Error {
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: BalanceJsonRpcTransportFailureCode,
    options: Readonly<{ retryAfterSeconds?: number }> = {},
  ) {
    super(code);
    this.name = 'BalanceJsonRpcTransportFailure';
    if (
      !['TIMEOUT', 'RATE_LIMITED', 'UNAVAILABLE', 'PERMANENT'].includes(code) ||
      (options.retryAfterSeconds !== undefined &&
        (!Number.isSafeInteger(options.retryAfterSeconds) || options.retryAfterSeconds < 0))
    ) {
      throw new TypeError('invalid balance JSON-RPC transport failure');
    }
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function balanceRpcRequest(
  method: string,
  params: readonly unknown[],
): BalanceJsonRpcRequest {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(method)) {
    throw new TypeError('invalid JSON-RPC method');
  }
  const frozenParams = deepFreezeCopy(params) as readonly unknown[];
  return Object.freeze({
    jsonrpc: '2.0',
    id: createHash('sha256')
      .update('crypto-lending:balance-json-rpc-request:v1\0')
      .update(method)
      .update('\0')
      .update(JSON.stringify(frozenParams))
      .digest('hex'),
    method,
    params: frozenParams,
  });
}

export function parseBalanceRpcResult(response: unknown, expectedId: string): unknown {
  assertBoundedJson(response);
  const record = plainRecord(response);
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
): Promise<unknown> {
  const request = balanceRpcRequest(method, params);
  try {
    const response = await transport.exchange(request);
    return parseBalanceRpcResult(response, request.id);
  } catch (error) {
    if (error instanceof BalanceSyncIndexerFailure) throw error;
    if (error instanceof BalanceJsonRpcTransportFailure) {
      switch (error.code) {
        case 'TIMEOUT':
          throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');
        case 'RATE_LIMITED':
          throw new BalanceSyncIndexerFailure(
            'RATE_LIMITED',
            error.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: error.retryAfterSeconds },
          );
        case 'UNAVAILABLE':
          throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
        case 'PERMANENT':
          throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
      }
    }
    throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
  }
}

export function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = plainRecord(value);
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
  const record = plainRecord(value);
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
  const hash = createHash('sha256').update('crypto-lending:balance-position:v1');
  for (const part of parts) hash.update('\0').update(part);
  return hash.digest('hex');
}

function plainRecord(value: unknown): Record<string, unknown> {
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

function assertBoundedJson(value: unknown): void {
  try {
    const seen = new WeakSet<object>();
    let bytes = 0;
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): void => {
      nodes += 1;
      if (depth > 32 || nodes > 200_000) throw new Error('complex JSON-RPC response');
      if (candidate === null || typeof candidate === 'boolean') {
        bytes += 5;
      } else if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate)) throw new Error('non-JSON number');
        bytes += 32;
      } else if (typeof candidate === 'string') {
        bytes += Buffer.byteLength(candidate, 'utf8') + 2;
      } else if (typeof candidate === 'object') {
        if (seen.has(candidate)) throw new Error('cyclic JSON-RPC response');
        seen.add(candidate);
        const prototype = Object.getPrototypeOf(candidate) as unknown;
        if (
          (Array.isArray(candidate) && prototype !== Array.prototype) ||
          (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) ||
          Object.getOwnPropertySymbols(candidate).length !== 0
        ) {
          throw new Error('non-data JSON-RPC response');
        }
        const descriptors = Object.getOwnPropertyDescriptors(candidate);
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (Array.isArray(candidate) && key === 'length') continue;
          if (!('value' in descriptor) || !descriptor.enumerable) {
            throw new Error('non-data JSON-RPC response');
          }
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          visit(descriptor.value, depth + 1);
        }
        if (Array.isArray(candidate)) {
          const keys = Object.keys(candidate);
          if (
            keys.length !== candidate.length ||
            keys.some((key, index) => key !== String(index))
          ) {
            throw new Error('sparse JSON-RPC response');
          }
        }
      } else {
        throw new Error('non-JSON value');
      }
      if (bytes > 4 * 1024 * 1024) throw new Error('oversized JSON-RPC response');
    };
    visit(value, 0);
  } catch {
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
}

function deepFreezeCopy(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeCopy));
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.freeze(
      Object.fromEntries(
        Object.entries(record).map(([key, nested]) => [key, deepFreezeCopy(nested)]),
      ),
    );
  }
  return value;
}
