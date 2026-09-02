import type { SchemaObject } from '@nestjs/swagger';

import { MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT } from '../../wallets/application/ports/wallet-registration-repository.port';

const EXACT_USD_AMOUNT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['currency', 'mantissa', 'scale', 'decimal'],
  properties: {
    currency: { type: 'string', enum: ['USD'] },
    mantissa: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    scale: { type: 'integer', enum: [18] },
    decimal: { type: 'string', pattern: '^(0|[1-9][0-9]*)\\.[0-9]{18}$' },
  },
};

const NULLABLE_USD_AMOUNT_SCHEMA: SchemaObject = {
  ...EXACT_USD_AMOUNT_SCHEMA,
  nullable: true,
};

const AGGREGATE_PROPERTIES: SchemaObject['properties'] = {
  usdValue: NULLABLE_USD_AMOUNT_SCHEMA,
  freshnessClass: { type: 'string', enum: ['CURRENT', 'STALE', 'UNAVAILABLE'] },
  completeness: { type: 'string', enum: ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'] },
  sourceCount: { type: 'integer', minimum: 0, maximum: 512 },
  includedSourceCount: { type: 'integer', minimum: 0, maximum: 512 },
};

const AGGREGATE_REQUIRED = [
  'usdValue',
  'freshnessClass',
  'completeness',
  'sourceCount',
  'includedSourceCount',
];

const AGGREGATE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: AGGREGATE_REQUIRED,
  properties: AGGREGATE_PROPERTIES,
};

const BALANCE_COVERAGE_STATUS_SCHEMA: SchemaObject = {
  type: 'string',
  enum: ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'],
};

const BALANCE_COVERAGE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'targets'],
  properties: {
    status: BALANCE_COVERAGE_STATUS_SCHEMA,
    targets: {
      type: 'array',
      maxItems: MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT,
      uniqueItems: true,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['walletId', 'networkId', 'status'],
        properties: {
          walletId: { type: 'string', format: 'uuid' },
          networkId: { type: 'string', maxLength: 96 },
          status: BALANCE_COVERAGE_STATUS_SCHEMA,
        },
      },
    },
  },
};

const ASSET_REFERENCE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'registryEnvironment',
    'registryVersion',
    'registryFingerprintSha256',
    'stablecoin',
    'networkId',
    'identity',
    'decimals',
  ],
  properties: {
    registryEnvironment: { type: 'string', enum: ['MAINNET'] },
    registryVersion: { type: 'integer', enum: [1] },
    registryFingerprintSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    stablecoin: { type: 'string', enum: ['USDC', 'USDT', 'PYUSD'] },
    networkId: { type: 'string', maxLength: 96 },
    identity: { type: 'string', maxLength: 64 },
    decimals: { type: 'integer', minimum: 0, maximum: 36 },
  },
};

const EXACT_ASSET_AMOUNT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['atomic', 'decimals', 'decimal'],
  properties: {
    atomic: { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$' },
    decimals: { type: 'integer', minimum: 0, maximum: 36 },
    decimal: { type: 'string', pattern: '^(0|[1-9][0-9]*)(?:\\.[0-9]+)?$' },
  },
};

const NULLABLE_STRING: SchemaObject = { type: 'string', nullable: true };
const NULLABLE_INTEGER: SchemaObject = { type: 'integer', nullable: true };

const VALUATION_SNAPSHOT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'priceSnapshotId',
    'policyVersion',
    'policyApprovalState',
    'availability',
    'selection',
    'selectedSourceId',
    'selectedSourceReference',
    'selectedSourceSequence',
    'pricedAt',
    'observedAt',
    'usdRateMantissa',
    'usdRateScale',
    'freshnessClass',
    'confidenceClass',
    'depegClass',
    'downsideBand',
    'sourceAgreement',
    'reasons',
    'reportingUse',
    'mayIncreaseBuyingPower',
    'mayAuthorizeFinancialUse',
  ],
  properties: {
    priceSnapshotId: { ...NULLABLE_STRING, maxLength: 128 },
    policyVersion: { type: 'integer', enum: [1] },
    policyApprovalState: { type: 'string', enum: ['PENDING_EXTERNAL_APPROVAL'] },
    availability: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
    selection: {
      type: 'string',
      enum: ['PRIMARY', 'FALLBACK', 'CONSERVATIVE_MINIMUM', 'NONE'],
    },
    selectedSourceId: {
      type: 'string',
      enum: ['PYTH_CORE', 'CHAINLINK_DATA_FEEDS'],
      nullable: true,
    },
    selectedSourceReference: { ...NULLABLE_STRING, maxLength: 192 },
    selectedSourceSequence: { ...NULLABLE_STRING, maxLength: 78 },
    pricedAt: { ...NULLABLE_STRING, format: 'date-time' },
    observedAt: { ...NULLABLE_STRING, format: 'date-time' },
    usdRateMantissa: { ...NULLABLE_STRING, pattern: '^(0|[1-9][0-9]*)$' },
    usdRateScale: { ...NULLABLE_INTEGER, minimum: 0, maximum: 36 },
    freshnessClass: { type: 'string', enum: ['CURRENT', 'STALE', 'UNAVAILABLE'] },
    confidenceClass: { type: 'string', enum: ['MEDIUM', 'LOW', 'UNAVAILABLE'] },
    depegClass: { type: 'string', enum: ['NOT_ASSESSED', 'WITHIN_POLICY', 'OUTSIDE_POLICY'] },
    downsideBand: { type: 'string', enum: ['NORMAL', 'WATCH', 'DEPEGGED', 'NOT_ASSESSED'] },
    sourceAgreement: {
      type: 'string',
      enum: ['CORROBORATED', 'SOFT_DISAGREEMENT', 'CONFLICT', 'SINGLE_SOURCE', 'NOT_AVAILABLE'],
    },
    reasons: { type: 'array', maxItems: 16, items: { type: 'string' } },
    reportingUse: { type: 'string', enum: ['CONSERVATIVE_REPORTING_ONLY', 'BLOCKED'] },
    mayIncreaseBuyingPower: { type: 'boolean', enum: [false] },
    mayAuthorizeFinancialUse: { type: 'boolean', enum: [false] },
  },
};

const SOURCE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'observationId',
    'walletId',
    'networkId',
    'asset',
    'balance',
    'balanceObservedAt',
    'balanceFreshnessClass',
    'freshnessClass',
    'includedInOverallTotal',
    'usdValue',
    'valuation',
  ],
  properties: {
    observationId: { type: 'string', format: 'uuid' },
    walletId: { type: 'string', format: 'uuid' },
    networkId: { type: 'string', maxLength: 96 },
    asset: ASSET_REFERENCE_SCHEMA,
    balance: EXACT_ASSET_AMOUNT_SCHEMA,
    balanceObservedAt: { type: 'string', format: 'date-time' },
    balanceFreshnessClass: { type: 'string', enum: ['CURRENT', 'STALE'] },
    freshnessClass: { type: 'string', enum: ['CURRENT', 'STALE', 'UNAVAILABLE'] },
    includedInOverallTotal: { type: 'boolean' },
    usdValue: NULLABLE_USD_AMOUNT_SCHEMA,
    valuation: VALUATION_SNAPSHOT_SCHEMA,
  },
};

const EXCLUDED_SOURCE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'observationId',
    'walletId',
    'networkId',
    'assetIdentity',
    'amountAtomic',
    'balanceObservedAt',
    'balanceFreshnessClass',
    'reason',
    'includedInOverallTotal',
  ],
  properties: {
    observationId: { type: 'string', format: 'uuid' },
    walletId: { type: 'string', format: 'uuid' },
    networkId: { type: 'string', maxLength: 96 },
    assetIdentity: { type: 'string', maxLength: 64 },
    amountAtomic: { type: 'string', pattern: '^(0|[1-9][0-9]{0,77})$' },
    balanceObservedAt: { type: 'string', format: 'date-time' },
    balanceFreshnessClass: { type: 'string', enum: ['CURRENT', 'STALE'] },
    reason: { type: 'string', enum: ['UNSUPPORTED_ASSET'] },
    includedInOverallTotal: { type: 'boolean', enum: [false] },
  },
};

function keyedAggregateSchema(key: string, keySchema: SchemaObject): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: [key, ...AGGREGATE_REQUIRED],
    properties: {
      [key]: keySchema,
      ...AGGREGATE_PROPERTIES,
    },
  };
}

export const UNIFIED_PORTFOLIO_RESPONSE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'asOf',
    'balanceSnapshot',
    'balanceCoverage',
    'oldestBalanceObservedAt',
    'overallTotal',
    'walletTotals',
    'chainTotals',
    'assetTotals',
    'sources',
    'excludedSources',
    'reportingUse',
    'mayIncreaseBuyingPower',
    'mayAuthorizeFinancialUse',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    asOf: { type: 'string', format: 'date-time' },
    balanceSnapshot: {
      type: 'object',
      additionalProperties: false,
      required: ['snapshotId', 'capturedAt', 'freshnessClass'],
      properties: {
        snapshotId: { type: 'string', maxLength: 128 },
        capturedAt: { type: 'string', format: 'date-time' },
        freshnessClass: { type: 'string', enum: ['CURRENT', 'STALE'] },
      },
    },
    balanceCoverage: BALANCE_COVERAGE_SCHEMA,
    oldestBalanceObservedAt: { type: 'string', format: 'date-time', nullable: true },
    overallTotal: AGGREGATE_SCHEMA,
    walletTotals: {
      type: 'array',
      maxItems: 512,
      items: keyedAggregateSchema('walletId', { type: 'string', format: 'uuid' }),
    },
    chainTotals: {
      type: 'array',
      maxItems: 512,
      items: keyedAggregateSchema('networkId', { type: 'string', maxLength: 96 }),
    },
    assetTotals: {
      type: 'array',
      maxItems: 3,
      items: keyedAggregateSchema('stablecoin', {
        type: 'string',
        enum: ['USDC', 'USDT', 'PYUSD'],
      }),
    },
    sources: { type: 'array', maxItems: 512, items: SOURCE_SCHEMA },
    excludedSources: { type: 'array', maxItems: 512, items: EXCLUDED_SOURCE_SCHEMA },
    reportingUse: { type: 'string', enum: ['CONSERVATIVE_REPORTING_ONLY'] },
    mayIncreaseBuyingPower: { type: 'boolean', enum: [false] },
    mayAuthorizeFinancialUse: { type: 'boolean', enum: [false] },
  },
};
