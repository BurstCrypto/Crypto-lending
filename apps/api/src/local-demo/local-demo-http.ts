import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import type { Observable } from 'rxjs';

import {
  LOCAL_DEMO_ALLOCATION_BUCKETS,
  LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES,
  LOCAL_DEMO_ALLOCATION_PRESET_IDS,
  LOCAL_DEMO_YIELD_CALCULATION_METHOD,
  LOCAL_DEMO_YIELD_PROJECTION_SOURCE,
  type LocalDemoAllocationPresetId,
} from './local-demo-allocation.service';

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

export function parseLocalDemoDisconnectBody(value: unknown): Readonly<{ connectionId: string }> {
  const record = exactRecord(value, ['connectionId']);
  if (typeof record.connectionId !== 'string' || !UUID_V4.test(record.connectionId)) {
    return fail();
  }
  return Object.freeze({ connectionId: record.connectionId });
}

export function parseLocalDemoAllocationPreviewBody(
  value: unknown,
): Readonly<{ presetId: LocalDemoAllocationPresetId }> {
  const record = exactRecord(value, ['presetId']);
  if (!LOCAL_DEMO_ALLOCATION_PRESET_IDS.includes(record.presetId as LocalDemoAllocationPresetId)) {
    return fail();
  }
  return Object.freeze({ presetId: record.presetId as LocalDemoAllocationPresetId });
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

export const LOCAL_DEMO_ALLOCATION_PREVIEW_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['presetId'],
  properties: {
    presetId: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_PRESET_IDS] },
  },
});

export const LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'use',
    'mayAuthorizeFinancialAction',
    'preset',
    'grossCapitalUsdMinor',
    'allocations',
    'deductions',
    'totalFeesUsdMinor',
    'netPlannedCapitalUsdMinor',
    'yieldProjection',
    'asOf',
  ],
  properties: {
    use: { type: 'string', enum: ['LOCAL_DEMO_ESTIMATE_ONLY'] },
    mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
    preset: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'label', 'description'],
      properties: {
        id: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_PRESET_IDS] },
        label: { type: 'string' },
        description: { type: 'string' },
      },
    },
    grossCapitalUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
    allocations: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bucket', 'label', 'percentageBasisPoints', 'apyBasisPoints', 'amountUsdMinor'],
        properties: {
          bucket: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_BUCKETS] },
          label: { type: 'string' },
          percentageBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
          apyBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
          amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
        },
      },
    },
    deductions: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'amountUsdMinor'],
        properties: {
          code: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_DEDUCTION_CODES] },
          amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
        },
      },
    },
    totalFeesUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
    netPlannedCapitalUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
    yieldProjection: {
      type: 'object',
      additionalProperties: false,
      required: [
        'source',
        'calculationMethod',
        'effectiveApyBasisPoints',
        'projectedAnnualYieldUsdMinor',
        'projectedAnnualNetGrowthUsdMinor',
        'breakEven',
      ],
      properties: {
        source: { type: 'string', enum: [LOCAL_DEMO_YIELD_PROJECTION_SOURCE] },
        calculationMethod: {
          type: 'string',
          enum: [LOCAL_DEMO_YIELD_CALCULATION_METHOD],
        },
        effectiveApyBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
        projectedAnnualYieldUsdMinor: {
          type: 'string',
          pattern: '^(?:0|[1-9][0-9]*)$',
        },
        projectedAnnualNetGrowthUsdMinor: {
          type: 'string',
          pattern: '^(?:0|[1-9][0-9]*)$',
        },
        breakEven: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'firstNetPositiveDay'],
          properties: {
            status: {
              type: 'string',
              enum: ['AVAILABLE', 'NOT_APPLICABLE', 'UNAVAILABLE'],
            },
            firstNetPositiveDay: {
              type: 'integer',
              minimum: 1,
              nullable: true,
            },
          },
        },
      },
    },
    asOf: { type: 'string', format: 'date-time' },
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
