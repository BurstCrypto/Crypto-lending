import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import type { Observable } from 'rxjs';

import {
  LOCAL_DEMO_ALLOCATION_SELECTION_KINDS,
  LOCAL_DEMO_ALLOCATION_PRESET_IDS,
  LOCAL_DEMO_EXECUTION_COST_TREATMENT,
  LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
  LOCAL_DEMO_YIELD_CALCULATION_METHOD,
  LOCAL_DEMO_YIELD_PROJECTION_SOURCE,
  type LocalDemoAllocationSelection,
  type LocalDemoAllocationPresetId,
} from './local-demo-allocation.service';
import {
  LOCAL_DEMO_YIELD_ASSET_SYMBOLS,
  LOCAL_DEMO_YIELD_NETWORK_IDS,
  LOCAL_DEMO_YIELD_PROVIDER_IDS,
  type LocalDemoCustomYieldFilters,
  type LocalDemoYieldAssetSymbol,
  type LocalDemoYieldNetworkId,
  type LocalDemoYieldProviderId,
} from './local-demo-yield-catalog.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const USD_MINOR = /^(?:0|[1-9][0-9]{0,17})$/u;

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

function exactArray(value: unknown, maximumLength: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return fail();
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > maximumLength
    ) {
      return fail();
    }
    const expectedKeys = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.size ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      return fail();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return fail();
      result.push(descriptor.value);
    }
    return Object.freeze(result);
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

function boundedBasisPoints(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    return fail();
  }
  return value;
}

function boundedLiquidReserveBasisPoints(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS
  ) {
    return fail();
  }
  return value;
}

function canonicalUsdMinor(value: unknown): string {
  if (typeof value !== 'string' || !USD_MINOR.test(value)) return fail();
  return value;
}

function enumArray<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): readonly Value[] {
  const values = exactArray(value, allowed.length);
  if (
    values.some((member) => typeof member !== 'string' || !allowed.includes(member as Value)) ||
    new Set(values).size !== values.length
  ) {
    return fail();
  }
  return Object.freeze(values as Value[]);
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
): Readonly<{ selection: LocalDemoAllocationSelection }> {
  const body = exactRecord(value, ['selection']);
  const kind = ownDataProperty(body.selection, 'kind');
  if (!LOCAL_DEMO_ALLOCATION_SELECTION_KINDS.includes(kind as 'PRESET' | 'CUSTOM')) return fail();
  if (kind === 'PRESET') {
    const selection = exactRecord(body.selection, ['kind', 'presetId']);
    if (
      !LOCAL_DEMO_ALLOCATION_PRESET_IDS.includes(selection.presetId as LocalDemoAllocationPresetId)
    ) {
      return fail();
    }
    return Object.freeze({
      selection: Object.freeze({
        kind: 'PRESET',
        presetId: selection.presetId as LocalDemoAllocationPresetId,
      }),
    });
  }
  const selection = exactRecord(body.selection, ['kind', 'liquidReserveBasisPoints', 'filters']);
  const filtersRecord = exactRecord(selection.filters, [
    'assetSymbols',
    'providerIds',
    'networkIds',
    'minimumApyBasisPoints',
    'minimumTvlUsdMinor',
    'minimumExitLiquidityUsdMinor',
    'maximumUtilizationBasisPoints',
  ]);
  const filters: LocalDemoCustomYieldFilters = Object.freeze({
    assetSymbols: enumArray<LocalDemoYieldAssetSymbol>(
      filtersRecord.assetSymbols,
      LOCAL_DEMO_YIELD_ASSET_SYMBOLS,
    ),
    providerIds: enumArray<LocalDemoYieldProviderId>(
      filtersRecord.providerIds,
      LOCAL_DEMO_YIELD_PROVIDER_IDS,
    ),
    networkIds: enumArray<LocalDemoYieldNetworkId>(
      filtersRecord.networkIds,
      LOCAL_DEMO_YIELD_NETWORK_IDS,
    ),
    minimumApyBasisPoints: boundedBasisPoints(filtersRecord.minimumApyBasisPoints),
    minimumTvlUsdMinor: canonicalUsdMinor(filtersRecord.minimumTvlUsdMinor),
    minimumExitLiquidityUsdMinor: canonicalUsdMinor(filtersRecord.minimumExitLiquidityUsdMinor),
    maximumUtilizationBasisPoints: boundedBasisPoints(filtersRecord.maximumUtilizationBasisPoints),
  });
  return Object.freeze({
    selection: Object.freeze({
      kind: 'CUSTOM',
      liquidReserveBasisPoints: boundedLiquidReserveBasisPoints(selection.liquidReserveBasisPoints),
      filters,
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

const LOCAL_DEMO_CUSTOM_YIELD_FILTERS_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'assetSymbols',
    'providerIds',
    'networkIds',
    'minimumApyBasisPoints',
    'minimumTvlUsdMinor',
    'minimumExitLiquidityUsdMinor',
    'maximumUtilizationBasisPoints',
  ],
  properties: {
    assetSymbols: {
      type: 'array',
      minItems: 1,
      maxItems: LOCAL_DEMO_YIELD_ASSET_SYMBOLS.length,
      uniqueItems: true,
      items: { type: 'string', enum: [...LOCAL_DEMO_YIELD_ASSET_SYMBOLS] },
    },
    providerIds: {
      type: 'array',
      minItems: 1,
      maxItems: LOCAL_DEMO_YIELD_PROVIDER_IDS.length,
      uniqueItems: true,
      items: { type: 'string', enum: [...LOCAL_DEMO_YIELD_PROVIDER_IDS] },
    },
    networkIds: {
      type: 'array',
      minItems: 1,
      maxItems: LOCAL_DEMO_YIELD_NETWORK_IDS.length,
      uniqueItems: true,
      items: { type: 'string', enum: [...LOCAL_DEMO_YIELD_NETWORK_IDS] },
    },
    minimumApyBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
    minimumTvlUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,17})$' },
    minimumExitLiquidityUsdMinor: {
      type: 'string',
      pattern: '^(?:0|[1-9][0-9]{0,17})$',
    },
    maximumUtilizationBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
  },
});

export const LOCAL_DEMO_ALLOCATION_PREVIEW_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['selection'],
  properties: {
    selection: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'presetId'],
          properties: {
            kind: { type: 'string', enum: ['PRESET'] },
            presetId: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_PRESET_IDS] },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'liquidReserveBasisPoints', 'filters'],
          properties: {
            kind: { type: 'string', enum: ['CUSTOM'] },
            liquidReserveBasisPoints: {
              type: 'integer',
              minimum: 0,
              maximum: LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
            },
            filters: LOCAL_DEMO_CUSTOM_YIELD_FILTERS_SCHEMA,
          },
        },
      ],
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
      enum: ['No trusted snapshot opportunities match this selection'],
    },
    code: { type: 'string', enum: ['NO_MATCHING_YIELD_OPPORTUNITIES'] },
  },
});

const LOCAL_DEMO_YIELD_OPPORTUNITY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'opportunityId',
    'provider',
    'protocol',
    'asset',
    'network',
    'apy',
    'tvl',
    'exitLiquidity',
    'utilization',
    'availability',
    'provenance',
  ],
  properties: {
    opportunityId: { type: 'string', maxLength: 192 },
    provider: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', enum: ['MORPHO'] },
        name: { type: 'string', enum: ['Morpho'] },
      },
    },
    protocol: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'marketId'],
      properties: {
        id: { type: 'string', enum: ['MORPHO_BLUE'] },
        name: { type: 'string', enum: ['Morpho Blue'] },
        marketId: { type: 'string', maxLength: 192 },
      },
    },
    asset: {
      type: 'object',
      additionalProperties: false,
      required: ['symbol', 'contract', 'decimals'],
      properties: {
        symbol: { type: 'string', enum: [...LOCAL_DEMO_YIELD_ASSET_SYMBOLS] },
        contract: { type: 'string', maxLength: 192 },
        decimals: { type: 'integer', enum: [6] },
      },
    },
    network: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      properties: {
        id: { type: 'string', enum: [...LOCAL_DEMO_YIELD_NETWORK_IDS] },
        name: { type: 'string', enum: ['Ethereum', 'Base'] },
      },
    },
    apy: {
      type: 'object',
      additionalProperties: false,
      required: ['baseRateDecimal', 'baseBasisPoints', 'observedAt', 'rewardAprs', 'providerFee'],
      properties: {
        baseRateDecimal: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' },
        baseBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
        observedAt: { type: 'string', format: 'date-time' },
        rewardAprs: {
          type: 'array',
          maxItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['assetSymbol', 'rateDecimal', 'basisPoints'],
            properties: {
              assetSymbol: { type: 'string', maxLength: 32 },
              rateDecimal: {
                type: 'string',
                pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
              },
              basisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
            },
          },
        },
        providerFee: {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'rateDecimal', 'basisPoints'],
          properties: {
            status: { type: 'string', enum: ['REPORTED'] },
            rateDecimal: {
              type: 'string',
              pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
            },
            basisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
          },
        },
      },
    },
    tvl: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceAmountUsdDecimal', 'amountUsdMinor', 'observedAt'],
      properties: {
        sourceAmountUsdDecimal: {
          type: 'string',
          pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
        },
        amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,17})$' },
        observedAt: { type: 'string', format: 'date-time' },
      },
    },
    exitLiquidity: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceAmountUsdDecimal', 'amountUsdMinor', 'observedAt', 'interpretation'],
      properties: {
        sourceAmountUsdDecimal: {
          type: 'string',
          pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
        },
        amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]{0,17})$' },
        observedAt: { type: 'string', format: 'date-time' },
        interpretation: { type: 'string', enum: ['AVAILABLE_TO_BORROW_PROXY'] },
      },
    },
    utilization: {
      type: 'object',
      additionalProperties: false,
      required: ['rateDecimal', 'basisPoints', 'observedAt'],
      properties: {
        rateDecimal: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' },
        basisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
        observedAt: { type: 'string', format: 'date-time' },
      },
    },
    availability: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'providerListed', 'depositsEnabled', 'withdrawalsEnabled', 'asOf'],
      properties: {
        status: { type: 'string', enum: ['LISTED_ONLY'] },
        providerListed: { type: 'boolean', enum: [true] },
        depositsEnabled: { type: 'string', enum: ['NOT_VERIFIED'] },
        withdrawalsEnabled: { type: 'string', enum: ['NOT_VERIFIED'] },
        asOf: { type: 'string', format: 'date-time' },
      },
    },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: [
        'sourceKind',
        'sourceId',
        'sourceReference',
        'sourceObservedAt',
        'retrievedAt',
        'payloadSha256',
        'normalizerId',
        'normalizerVersion',
        'attributes',
      ],
      properties: {
        sourceKind: { type: 'string', enum: ['API'] },
        sourceId: { type: 'string', maxLength: 192 },
        sourceReference: { type: 'string', maxLength: 1_024 },
        sourceObservedAt: { type: 'string', format: 'date-time' },
        retrievedAt: { type: 'string', format: 'date-time' },
        payloadSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        normalizerId: { type: 'string', enum: ['morpho-local-demo-snapshot'] },
        normalizerVersion: { type: 'string', enum: ['1.0.0'] },
        attributes: {
          type: 'array',
          minItems: 6,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'value'],
            properties: {
              key: { type: 'string', maxLength: 192 },
              value: { type: 'string', maxLength: 1_024 },
            },
          },
        },
      },
    },
  },
});

export const LOCAL_DEMO_YIELD_CATALOG_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'use',
    'mayAuthorizeFinancialAction',
    'riskClassificationAvailable',
    'snapshot',
    'opportunities',
  ],
  properties: {
    use: { type: 'string', enum: ['LOCAL_DEMO_SNAPSHOT_ONLY'] },
    mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
    riskClassificationAvailable: { type: 'boolean', enum: [false] },
    snapshot: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'provider',
        'capturedAt',
        'staleAfter',
        'freshness',
        'staleBehavior',
        'riskClassification',
      ],
      properties: {
        id: { type: 'string', maxLength: 192 },
        provider: { type: 'string', enum: ['MORPHO_PUBLIC_API'] },
        capturedAt: { type: 'string', format: 'date-time' },
        staleAfter: { type: 'string', format: 'date-time' },
        freshness: { type: 'string', enum: ['CURRENT', 'STALE'] },
        staleBehavior: { type: 'string', enum: ['LABEL_STALE_KEEP_NON_EXECUTABLE'] },
        riskClassification: { type: 'string', enum: ['NOT_ASSESSED'] },
      },
    },
    opportunities: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: LOCAL_DEMO_YIELD_OPPORTUNITY_SCHEMA,
    },
  },
});

export const LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'use',
    'mayAuthorizeFinancialAction',
    'selection',
    'catalog',
    'grossCapitalUsdMinor',
    'allocations',
    'executionCost',
    'capitalIncludedInProjectionUsdMinor',
    'yieldProjection',
    'asOf',
  ],
  properties: {
    use: { type: 'string', enum: ['LOCAL_DEMO_ESTIMATE_ONLY'] },
    mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
    selection: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'presetId', 'label', 'description', 'liquidReserveBasisPoints', 'filters'],
      properties: {
        kind: { type: 'string', enum: [...LOCAL_DEMO_ALLOCATION_SELECTION_KINDS] },
        presetId: {
          type: 'string',
          enum: [...LOCAL_DEMO_ALLOCATION_PRESET_IDS],
          nullable: true,
        },
        label: { type: 'string' },
        description: { type: 'string' },
        liquidReserveBasisPoints: {
          type: 'integer',
          minimum: 0,
          maximum: LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
        },
        filters: { ...LOCAL_DEMO_CUSTOM_YIELD_FILTERS_SCHEMA, nullable: true },
      },
    },
    catalog: {
      type: 'object',
      additionalProperties: false,
      required: [
        'snapshotId',
        'capturedAt',
        'staleAfter',
        'freshness',
        'staleBehavior',
        'riskClassificationAvailable',
        'riskClassification',
        'matchedOpportunityCount',
        'selectedOpportunityCount',
      ],
      properties: {
        snapshotId: { type: 'string', maxLength: 192 },
        capturedAt: { type: 'string', format: 'date-time' },
        staleAfter: { type: 'string', format: 'date-time' },
        freshness: { type: 'string', enum: ['CURRENT', 'STALE'] },
        staleBehavior: { type: 'string', enum: ['LABEL_STALE_KEEP_NON_EXECUTABLE'] },
        riskClassificationAvailable: { type: 'boolean', enum: [false] },
        riskClassification: { type: 'string', enum: ['NOT_ASSESSED'] },
        matchedOpportunityCount: { type: 'integer', minimum: 1, maximum: 5 },
        selectedOpportunityCount: { type: 'integer', minimum: 1, maximum: 3 },
      },
    },
    grossCapitalUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
    allocations: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'bucket',
          'allocationId',
          'label',
          'percentageBasisPoints',
          'baseApyBasisPoints',
          'baseApyRateDecimal',
          'amountUsdMinor',
          'opportunity',
        ],
        properties: {
          bucket: { type: 'string', enum: ['LIQUID_RESERVE', 'YIELD_OPPORTUNITY'] },
          allocationId: { type: 'string', maxLength: 192 },
          label: { type: 'string' },
          percentageBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
          baseApyBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000 },
          baseApyRateDecimal: {
            type: 'string',
            pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$',
          },
          amountUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
          opportunity: { ...LOCAL_DEMO_YIELD_OPPORTUNITY_SCHEMA, nullable: true },
        },
      },
    },
    executionCost: {
      type: 'object',
      additionalProperties: false,
      required: ['treatment', 'modeledLocalAmountUsdMinor', 'publicExecutionCostStatus'],
      properties: {
        treatment: { type: 'string', enum: [LOCAL_DEMO_EXECUTION_COST_TREATMENT] },
        modeledLocalAmountUsdMinor: { type: 'string', enum: ['0'] },
        publicExecutionCostStatus: { type: 'string', enum: ['UNQUOTED'] },
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
