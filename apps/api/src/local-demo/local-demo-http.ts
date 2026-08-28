import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import type { Observable } from 'rxjs';

import {
  LOCAL_DEMO_ALLOCATION_PRESET_IDS,
  LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD,
  LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS,
  LOCAL_DEMO_EXECUTION_COST_COMPONENTS,
  LOCAL_DEMO_EXECUTION_COST_MODEL,
  LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
  LOCAL_DEMO_MAX_RETAINED_ROUNDING_RESIDUAL_USD_MINOR,
  LOCAL_DEMO_YIELD_CALCULATION_METHOD,
  LOCAL_DEMO_YIELD_PROJECTION_SOURCE,
  type LocalDemoAllocationSelection,
  type LocalDemoAllocationPresetId,
} from './local-demo-allocation.service';
import { LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID } from './local-demo-yield-catalog.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PORTFOLIO_SNAPSHOT_ID = /^local-demo-portfolio:[0-9a-f]{32}$/u;

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

function ownDataProperty(value: unknown, key: string): unknown {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return fail();
    return descriptor.value;
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
): Readonly<{ portfolioSnapshotId: string; selection: LocalDemoAllocationSelection }> {
  const body = exactRecord(value, ['portfolioSnapshotId', 'selection']);
  if (
    typeof body.portfolioSnapshotId !== 'string' ||
    !PORTFOLIO_SNAPSHOT_ID.test(body.portfolioSnapshotId)
  ) {
    return fail();
  }
  if (ownDataProperty(body.selection, 'kind') !== 'PRESET') return fail();
  const selection = exactRecord(body.selection, ['kind', 'presetId', 'liquidReserveBasisPoints']);
  if (
    !LOCAL_DEMO_ALLOCATION_PRESET_IDS.includes(selection.presetId as LocalDemoAllocationPresetId)
  ) {
    return fail();
  }
  if (
    !Number.isSafeInteger(selection.liquidReserveBasisPoints) ||
    (selection.liquidReserveBasisPoints as number) < 0 ||
    (selection.liquidReserveBasisPoints as number) > LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS
  ) {
    return fail();
  }
  return Object.freeze({
    portfolioSnapshotId: body.portfolioSnapshotId,
    selection: Object.freeze({
      kind: 'PRESET',
      presetId: selection.presetId as LocalDemoAllocationPresetId,
      liquidReserveBasisPoints: selection.liquidReserveBasisPoints as number,
    }),
  });
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
  required: ['portfolioSnapshotId', 'selection'],
  properties: {
    portfolioSnapshotId: {
      type: 'string',
      pattern: '^local-demo-portfolio:[0-9a-f]{32}$',
    },
    selection: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'presetId', 'liquidReserveBasisPoints'],
      properties: {
        kind: { type: 'string', enum: ['PRESET'] },
        presetId: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_PRESET_IDS] },
        liquidReserveBasisPoints: {
          type: 'integer',
          minimum: 0,
          maximum: LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
        },
      },
    },
  },
});

export const LOCAL_DEMO_ALLOCATION_NO_MATCH_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['statusCode', 'error', 'message', 'code'],
  properties: {
    statusCode: { type: 'integer', enum: [422] },
    error: { type: 'string', enum: ['Unprocessable Entity'] },
    message: {
      type: 'string',
      enum: ['The managed yield strategy is unavailable for this snapshot'],
    },
    code: { type: 'string', enum: ['NO_MATCHING_YIELD_OPPORTUNITIES'] },
  },
});

export const LOCAL_DEMO_PORTFOLIO_CHANGED_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['statusCode', 'error', 'message', 'code'],
  properties: {
    statusCode: { type: 'integer', enum: [409] },
    error: { type: 'string', enum: ['Conflict'] },
    message: { type: 'string', enum: ['The local demo portfolio changed; refresh and retry'] },
    code: { type: 'string', enum: ['PORTFOLIO_SNAPSHOT_CHANGED'] },
  },
});

export const LOCAL_DEMO_YIELD_CATALOG_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'use',
    'mayAuthorizeFinancialAction',
    'riskClassificationAvailable',
    'strategyMode',
    'ecosystems',
    'snapshot',
  ],
  properties: {
    use: { type: 'string', enum: ['LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY'] },
    mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
    riskClassificationAvailable: { type: 'boolean', enum: [false] },
    strategyMode: { type: 'string', enum: ['PORTFOLIO_CROSS_CHAIN_BLEND'] },
    ecosystems: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'string', enum: ['EVM', 'SOLANA'] },
    },
    snapshot: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'capturedAt',
        'staleAfter',
        'freshness',
        'staleBehavior',
        'riskClassification',
      ],
      properties: {
        id: { type: 'string', enum: [LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID] },
        capturedAt: { type: 'string', format: 'date-time' },
        staleAfter: { type: 'string', format: 'date-time' },
        freshness: { type: 'string', enum: ['CURRENT', 'STALE'] },
        staleBehavior: { type: 'string', enum: ['LABEL_STALE_KEEP_NON_EXECUTABLE'] },
        riskClassification: { type: 'string', enum: ['NOT_ASSESSED'] },
      },
    },
  },
});

const LOCAL_DEMO_EXECUTION_COST_COMPONENT_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['code', 'label', 'calculationBasis', 'fundingTreatment', 'amountUsdMinor'],
  properties: {
    code: { type: 'string', enum: [...LOCAL_DEMO_EXECUTION_COST_COMPONENTS] },
    label: { type: 'string', maxLength: 96 },
    calculationBasis: {
      type: 'string',
      enum: [
        'NETWORK_ACTIVATION_AND_POSITION_VOLUME',
        'TWELVE_BPS_OF_REQUIRED_CONVERSION',
        'NO_CROSS_ECOSYSTEM_TRANSFER',
        'POSITION_SIZE_AND_UTILIZATION',
        'CANONICAL_PLATFORM_ROUTING_RULE_V1',
      ],
    },
    fundingTreatment: {
      type: 'string',
      enum: ['DEDUCTED_FROM_GROSS', 'ADDED_ON_TOP'],
    },
    amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
  },
});

export const LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'use',
    'mayAuthorizeFinancialAction',
    'portfolioSnapshotId',
    'selection',
    'rateSnapshot',
    'grossCapitalUsdMinor',
    'sourceCapitalByEcosystem',
    'allocations',
    'managedYieldComposition',
    'compositionSummary',
    'executionCost',
    'capitalIncludedInProjectionUsdMinor',
    'yieldProjection',
    'asOf',
  ],
  properties: {
    use: { type: 'string', enum: ['LOCAL_DEMO_ESTIMATE_ONLY'] },
    mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
    portfolioSnapshotId: {
      type: 'string',
      pattern: '^local-demo-portfolio:[0-9a-f]{32}$',
    },
    selection: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'presetId', 'label', 'description', 'liquidReserveBasisPoints'],
      properties: {
        kind: { type: 'string', enum: ['PRESET'] },
        presetId: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_PRESET_IDS] },
        label: { type: 'string', maxLength: 96 },
        description: { type: 'string', maxLength: 512 },
        liquidReserveBasisPoints: {
          type: 'integer',
          minimum: 0,
          maximum: LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
        },
      },
    },
    rateSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'capturedAt',
        'staleAfter',
        'freshness',
        'staleBehavior',
        'riskClassificationAvailable',
        'riskClassification',
      ],
      properties: {
        id: { type: 'string', enum: [LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID] },
        capturedAt: { type: 'string', format: 'date-time' },
        staleAfter: { type: 'string', format: 'date-time' },
        freshness: { type: 'string', enum: ['CURRENT', 'STALE'] },
        staleBehavior: { type: 'string', enum: ['LABEL_STALE_KEEP_NON_EXECUTABLE'] },
        riskClassificationAvailable: { type: 'boolean', enum: [false] },
        riskClassification: { type: 'string', enum: ['NOT_ASSESSED'] },
      },
    },
    grossCapitalUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
    sourceCapitalByEcosystem: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ecosystem', 'amountUsdMinor'],
        properties: {
          ecosystem: { type: 'string', enum: ['EVM', 'SOLANA'] },
          amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
        },
      },
    },
    allocations: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bucket', 'allocationId', 'label', 'percentageBasisPoints', 'amountUsdMinor'],
        properties: {
          bucket: { type: 'string', enum: ['LIQUID_RESERVE', 'MANAGED_YIELD'] },
          allocationId: { type: 'string', enum: ['LIQUID_RESERVE', 'MANAGED_YIELD'] },
          label: { type: 'string', enum: ['Liquid reserve', 'Managed yield'] },
          percentageBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
          amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
        },
      },
    },
    managedYieldComposition: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ecosystem', 'label', 'percentageBasisPointsOfManagedYield', 'amountUsdMinor'],
        properties: {
          ecosystem: { type: 'string', enum: ['EVM', 'SOLANA'] },
          label: { type: 'string', enum: ['EVM managed yield', 'SVM managed yield'] },
          percentageBasisPointsOfManagedYield: {
            type: 'integer',
            minimum: 0,
            maximum: 10_000,
          },
          amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
        },
      },
    },
    compositionSummary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'mode',
        'crossEcosystemTransferRequired',
        'crossEcosystemTransferUsdMinor',
        'activeEcosystemCount',
      ],
      properties: {
        mode: { type: 'string', enum: ['SINGLE_ECOSYSTEM', 'EVM_SOLANA_PORTFOLIO_BLEND'] },
        crossEcosystemTransferRequired: { type: 'boolean', enum: [false] },
        crossEcosystemTransferUsdMinor: { type: 'string', enum: ['0'] },
        activeEcosystemCount: { type: 'integer', enum: [1, 2] },
      },
    },
    executionCost: {
      type: 'object',
      additionalProperties: false,
      required: ['actualLocalOperation', 'modeledScenario', 'publicExecution'],
      properties: {
        actualLocalOperation: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'amountUsdMinor'],
          properties: {
            status: { type: 'string', enum: ['NO_EXECUTION'] },
            amountUsdMinor: { type: 'string', enum: ['0'] },
          },
        },
        modeledScenario: {
          type: 'object',
          additionalProperties: false,
          required: [
            'status',
            'modelId',
            'isQuote',
            'costBasisCapitalUsdMinor',
            'fundingTreatment',
            'rounding',
            'routingFeePolicy',
            'components',
            'deductedFromGrossUsdMinor',
            'addedOnTopUsdMinor',
            'retainedRoundingResidualUsdMinor',
            'totalUsdMinor',
            'requiredCapitalIncludingAddedOnTopUsdMinor',
          ],
          properties: {
            status: { type: 'string', enum: ['AVAILABLE'] },
            modelId: { type: 'string', enum: [LOCAL_DEMO_EXECUTION_COST_MODEL] },
            isQuote: { type: 'boolean', enum: [false] },
            costBasisCapitalUsdMinor: {
              type: 'string',
              pattern: '^(?:0|[1-9][0-9]*)$',
            },
            fundingTreatment: {
              type: 'string',
              enum: ['MIXED_DEDUCT_FROM_GROSS_AND_ADD_ON_TOP'],
            },
            rounding: {
              type: 'string',
              enum: ['CEIL_VARIABLE_COMPONENTS_PLATFORM_FEE_HALF_EVEN'],
            },
            routingFeePolicy: {
              type: 'object',
              additionalProperties: false,
              required: ['tier', 'classification', 'ruleVersion'],
              properties: {
                tier: { type: 'string', enum: ['FREE'] },
                classification: {
                  type: 'string',
                  enum: ['DIRECT_COMPATIBLE', 'MATERIAL_ORCHESTRATION'],
                },
                ruleVersion: { type: 'integer', enum: [1] },
              },
            },
            components: {
              type: 'array',
              minItems: LOCAL_DEMO_EXECUTION_COST_COMPONENTS.length,
              maxItems: LOCAL_DEMO_EXECUTION_COST_COMPONENTS.length,
              items: LOCAL_DEMO_EXECUTION_COST_COMPONENT_SCHEMA,
            },
            deductedFromGrossUsdMinor: {
              type: 'string',
              pattern: '^(?:0|[1-9][0-9]*)$',
            },
            addedOnTopUsdMinor: {
              type: 'string',
              pattern: '^(?:0|[1-9][0-9]*)$',
            },
            retainedRoundingResidualUsdMinor: {
              type: 'string',
              enum: Array.from(
                { length: LOCAL_DEMO_MAX_RETAINED_ROUNDING_RESIDUAL_USD_MINOR + 1 },
                (_, amount) => amount.toString(),
              ),
            },
            totalUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
            requiredCapitalIncludingAddedOnTopUsdMinor: {
              type: 'string',
              pattern: '^(?:0|[1-9][0-9]*)$',
            },
          },
        },
        publicExecution: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'amountUsdMinor'],
          properties: {
            status: { type: 'string', enum: ['UNQUOTED'] },
            amountUsdMinor: { type: 'string', nullable: true, enum: [null] },
          },
        },
      },
    },
    capitalIncludedInProjectionUsdMinor: {
      type: 'string',
      pattern: '^(?:0|[1-9][0-9]*)$',
    },
    yieldProjection: {
      type: 'object',
      additionalProperties: false,
      required: [
        'source',
        'calculationMethod',
        'effectiveApyBasisPoints',
        'projectedAnnualYieldUsdMinor',
        'projectedAnnualYieldAfterFeesUsdMinor',
        'firstPositiveDayAfterFees',
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
        projectedAnnualYieldAfterFeesUsdMinor: {
          type: 'string',
          pattern: '^(?:0|-?[1-9][0-9]*)$',
        },
        firstPositiveDayAfterFees: {
          type: 'object',
          additionalProperties: false,
          required: ['calculationMethod', 'status', 'day', 'modelHorizonDays'],
          properties: {
            calculationMethod: {
              type: 'string',
              enum: [LOCAL_DEMO_BREAK_EVEN_CALCULATION_METHOD],
            },
            status: {
              type: 'string',
              enum: [
                'RECOVERED_WITHIN_HORIZON',
                'NO_PROJECTED_YIELD',
                'NOT_RECOVERED_WITHIN_HORIZON',
              ],
            },
            day: {
              type: 'integer',
              minimum: 1,
              maximum: LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS,
              nullable: true,
            },
            modelHorizonDays: {
              type: 'integer',
              enum: [LOCAL_DEMO_BREAK_EVEN_MODEL_HORIZON_DAYS],
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
