import type { SchemaObject } from '@nestjs/swagger';

const NETWORK_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name'],
  properties: {
    id: {
      type: 'string',
      enum: ['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    },
    name: { type: 'string', enum: ['Ethereum', 'Solana'] },
  },
};

const PLATFORM_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'protocol',
    'ecosystem',
    'networks',
    'integrationStatus',
    'dataStatus',
    'accessStatus',
    'riskStatus',
    'supportedActions',
  ],
  properties: {
    id: {
      type: 'string',
      enum: [
        'aave',
        'morpho',
        'compound',
        'spark',
        'euler',
        'gearbox',
        'kamino',
        'save',
        'project-0',
        'jupiter',
      ],
    },
    name: {
      type: 'string',
      enum: [
        'Aave',
        'Morpho',
        'Compound',
        'Spark',
        'Euler',
        'Gearbox',
        'Kamino',
        'Save',
        'Project 0',
        'Jupiter',
      ],
    },
    protocol: {
      type: 'string',
      enum: [
        'Aave V3',
        'Morpho Blue',
        'Compound III',
        'SparkLend',
        'Euler V2',
        'Gearbox V3',
        'Kamino Lend',
        'Save lending',
        'marginfi v2',
        'Jupiter Lend',
      ],
    },
    ecosystem: { type: 'string', enum: ['EVM', 'SOLANA'] },
    networks: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: NETWORK_SCHEMA },
    integrationStatus: { type: 'string', enum: ['PLANNED'] },
    dataStatus: { type: 'string', enum: ['NOT_CONNECTED'] },
    accessStatus: { type: 'string', enum: ['UNAVAILABLE'] },
    riskStatus: { type: 'string', enum: ['NOT_ASSESSED'] },
    supportedActions: { type: 'array', minItems: 0, maxItems: 0, items: { type: 'string' } },
  },
};

export const MAINNET_PLATFORM_DIRECTORY_RESPONSE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'use',
    'mayAuthorizeFinancialAction',
    'minimumProviderTarget',
    'providers',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    use: { type: 'string', enum: ['MAINNET_PLATFORM_DIRECTORY'] },
    mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
    minimumProviderTarget: { type: 'integer', enum: [10] },
    providers: {
      type: 'array',
      minItems: 10,
      maxItems: 10,
      uniqueItems: true,
      items: PLATFORM_SCHEMA,
    },
  },
};
