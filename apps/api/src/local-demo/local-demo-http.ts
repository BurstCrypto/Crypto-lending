import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import type { Observable } from 'rxjs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type LocalDemoWalletNamespace = 'EVM' | 'SOLANA';

export class LocalDemoBodyError extends Error {
  constructor() {
    super('Local demo request body is invalid');
    this.name = 'LocalDemoBodyError';
  }
}

function fail(): never {
  throw new LocalDemoBodyError();
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return fail();
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof LocalDemoBodyError) throw error;
    return fail();
  }
}

export function parseLocalDemoConnectBody(
  value: unknown,
): Readonly<{ namespace: LocalDemoWalletNamespace }> {
  const record = exactRecord(value, ['namespace']);
  if (record.namespace !== 'EVM' && record.namespace !== 'SOLANA') return fail();
  return Object.freeze({ namespace: record.namespace });
}

export function parseLocalDemoDisconnectBody(
  value: unknown,
): Readonly<{ connectionId: string }> {
  const record = exactRecord(value, ['connectionId']);
  if (typeof record.connectionId !== 'string' || !UUID_V4.test(record.connectionId)) {
    return fail();
  }
  return Object.freeze({ connectionId: record.connectionId });
}

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class LocalDemoPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<HeaderWriter>();
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Vary', 'Cookie, Origin');
    response.setHeader('X-Crypto-Lending-Demo-Mode', 'synthetic-local');
    return next.handle();
  }
}

export const LOCAL_DEMO_CONNECT_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['namespace'],
  properties: {
    namespace: { type: 'string', enum: ['EVM', 'SOLANA'] },
  },
});

export const LOCAL_DEMO_DISCONNECT_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['connectionId'],
  properties: {
    connectionId: { type: 'string', format: 'uuid' },
  },
});

export const LOCAL_DEMO_WALLET_CONNECTION_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'connectionId',
    'walletId',
    'label',
    'namespace',
    'chainId',
    'address',
    'registeredAt',
  ],
  properties: {
    connectionId: { type: 'string', format: 'uuid' },
    walletId: { type: 'string', format: 'uuid' },
    label: { type: 'string', maxLength: 64 },
    namespace: { type: 'string', enum: ['EVM', 'SOLANA'] },
    chainId: { type: 'string', maxLength: 96 },
    address: { type: 'string', maxLength: 44 },
    registeredAt: { type: 'string', format: 'date-time' },
  },
});
