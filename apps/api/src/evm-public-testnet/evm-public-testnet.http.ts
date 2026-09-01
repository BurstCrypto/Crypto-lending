import type { SchemaObject } from '@nestjs/swagger';
import { getAddress, isAddress, type Address, type Hex } from 'viem';

import { LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS } from '../local-demo/local-demo-allocation.service';
import {
  EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
  EVM_PUBLIC_TESTNET_ASSET_DECIMALS,
  EVM_PUBLIC_TESTNET_AWETH,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_DATA_PROVIDER,
  EVM_PUBLIC_TESTNET_FAUCET,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI_TEXT,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI_TEXT,
  EVM_PUBLIC_TESTNET_WETH,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
} from './evm-public-testnet.constants';
import type {
  EvmPublicTestnetIntentRequest,
  EvmPublicTestnetPositionRequest,
  EvmPublicTestnetSubmissionRequest,
} from './evm-public-testnet.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PORTFOLIO_SNAPSHOT_ID = /^local-demo-portfolio:[0-9a-f]{32}$/u;
const ADDRESS = '^0x[0-9a-fA-F]{40}$';
const HASH = '^0x[0-9a-f]{64}$';
const HEX_DATA = '^0x(?:[0-9a-f]{2})*$';
const HEX_QUANTITY = '^0x(?:0|[1-9a-f][0-9a-f]*)$';
const DECIMAL_INTEGER = '^(?:0|[1-9][0-9]*)$';
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

export class EvmPublicTestnetBodyError extends Error {
  constructor() {
    super('EVM public-testnet request is invalid');
    this.name = 'EvmPublicTestnetBodyError';
  }
}

function fail(): never {
  throw new EvmPublicTestnetBodyError();
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
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return fail();
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof EvmPublicTestnetBodyError) throw error;
    return fail();
  }
}

function account(value: unknown): Address {
  if (
    typeof value !== 'string' ||
    !new RegExp(ADDRESS, 'u').test(value) ||
    !isAddress(value, { strict: true }) ||
    value.toLowerCase() === ZERO_ADDRESS
  ) {
    return fail();
  }
  return getAddress(value);
}

export function parseEvmPublicTestnetIntentBody(value: unknown): EvmPublicTestnetIntentRequest {
  const body = exactRecord(value, ['portfolioSnapshotId', 'selection', 'chainId', 'account']);
  if (
    typeof body.portfolioSnapshotId !== 'string' ||
    !PORTFOLIO_SNAPSHOT_ID.test(body.portfolioSnapshotId) ||
    body.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID
  ) {
    return fail();
  }
  const selection = exactRecord(body.selection, ['kind', 'presetId', 'liquidReserveBasisPoints']);
  if (
    selection.kind !== 'PRESET' ||
    selection.presetId !== 'BALANCED' ||
    !Number.isSafeInteger(selection.liquidReserveBasisPoints) ||
    (selection.liquidReserveBasisPoints as number) < 0 ||
    (selection.liquidReserveBasisPoints as number) > LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS
  ) {
    return fail();
  }
  return Object.freeze({
    portfolioSnapshotId: body.portfolioSnapshotId,
    selection: Object.freeze({
      kind: 'PRESET' as const,
      presetId: 'BALANCED' as const,
      liquidReserveBasisPoints: selection.liquidReserveBasisPoints as number,
    }),
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: account(body.account),
  });
}

export function parseEvmPublicTestnetSubmissionBody(
  value: unknown,
): EvmPublicTestnetSubmissionRequest {
  let body: Record<string, unknown>;
  try {
    body = exactRecord(value, []);
    return Object.freeze({});
  } catch (error) {
    if (!(error instanceof EvmPublicTestnetBodyError)) throw error;
    body = exactRecord(value, ['transactionHash']);
  }
  if (
    typeof body.transactionHash !== 'string' ||
    !new RegExp(HASH, 'u').test(body.transactionHash)
  ) {
    return fail();
  }
  return Object.freeze({ transactionHash: body.transactionHash as Hex });
}

export function parseEvmPublicTestnetPositionBody(value: unknown): EvmPublicTestnetPositionRequest {
  const body = exactRecord(value, ['chainId', 'account']);
  if (body.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID) return fail();
  return Object.freeze({ chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: account(body.account) });
}

export function parseEvmPublicTestnetIntentId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail();
  return value;
}

const SELECTION_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'presetId', 'liquidReserveBasisPoints'],
  properties: {
    kind: { type: 'string', enum: ['PRESET'] },
    presetId: { type: 'string', enum: ['BALANCED'] },
    liquidReserveBasisPoints: {
      type: 'integer',
      minimum: 0,
      maximum: LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS,
    },
  },
});

export const EVM_PUBLIC_TESTNET_INTENT_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['portfolioSnapshotId', 'selection', 'chainId', 'account'],
  properties: {
    portfolioSnapshotId: { type: 'string', pattern: '^local-demo-portfolio:[0-9a-f]{32}$' },
    selection: SELECTION_SCHEMA,
    chainId: { type: 'string', enum: [EVM_PUBLIC_TESTNET_CHAIN_ID] },
    account: { type: 'string', pattern: ADDRESS },
  },
});

export const EVM_PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA: SchemaObject = Object.freeze({
  oneOf: [
    { type: 'object', additionalProperties: false, maxProperties: 0 },
    {
      type: 'object',
      additionalProperties: false,
      required: ['transactionHash'],
      properties: { transactionHash: { type: 'string', pattern: HASH } },
    },
  ],
});

export const EVM_PUBLIC_TESTNET_POSITION_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['chainId', 'account'],
  properties: {
    chainId: { type: 'string', enum: [EVM_PUBLIC_TESTNET_CHAIN_ID] },
    account: { type: 'string', pattern: ADDRESS },
  },
});

const STATUS_SCHEMA: SchemaObject = { type: 'string', enum: ['PENDING', 'CONFIRMED', 'VERIFIED'] };
const HASH_SCHEMA: SchemaObject = { type: 'string', pattern: HASH };
const DECIMAL_SCHEMA: SchemaObject = { type: 'string', pattern: DECIMAL_INTEGER };

export const EVM_PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'use',
    'mayAuthorizeMainnetFinancialAction',
    'intentId',
    'expiresAt',
    'evidenceExpiresAt',
    'chainId',
    'account',
    'portfolioBinding',
    'proof',
    'transaction',
    'fundingReadiness',
    'liveObservation',
    'providerVisibility',
  ],
  properties: {
    use: { type: 'string', enum: ['EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY'] },
    mayAuthorizeMainnetFinancialAction: { type: 'boolean', enum: [false] },
    intentId: { type: 'string', format: 'uuid' },
    expiresAt: { type: 'string', format: 'date-time' },
    evidenceExpiresAt: { type: 'string', format: 'date-time' },
    chainId: { type: 'string', enum: [EVM_PUBLIC_TESTNET_CHAIN_ID] },
    account: { type: 'string', pattern: ADDRESS },
    portfolioBinding: {
      type: 'object',
      additionalProperties: false,
      required: ['portfolioSnapshotId', 'selection'],
      properties: {
        portfolioSnapshotId: { type: 'string', pattern: '^local-demo-portfolio:[0-9a-f]{32}$' },
        selection: SELECTION_SCHEMA,
      },
    },
    proof: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'amountAtomic', 'assetSymbol', 'assetDecimals', 'notFullBlend'],
      properties: {
        kind: { type: 'string', enum: ['SINGLE_TESTNET_PROOF_POSITION'] },
        amountAtomic: { type: 'string', enum: [EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI_TEXT] },
        assetSymbol: { type: 'string', enum: ['ETH'] },
        assetDecimals: { type: 'integer', enum: [EVM_PUBLIC_TESTNET_ASSET_DECIMALS] },
        notFullBlend: { type: 'boolean', enum: [true] },
      },
    },
    transaction: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to', 'value', 'input', 'nonce', 'chainId'],
      properties: {
        from: { type: 'string', pattern: ADDRESS },
        to: { type: 'string', enum: [EVM_PUBLIC_TESTNET_WETH_GATEWAY] },
        value: { type: 'string', enum: [EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX] },
        input: { type: 'string', pattern: HEX_DATA },
        nonce: { type: 'string', pattern: HEX_QUANTITY },
        chainId: { type: 'string', enum: [EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID] },
      },
    },
    fundingReadiness: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'nativeBalanceWei', 'requiredNativeBalanceWei', 'faucetUrl'],
      properties: {
        status: { type: 'string', enum: ['READY', 'NEEDS_BASE_SEPOLIA_ETH'] },
        nativeBalanceWei: DECIMAL_SCHEMA,
        requiredNativeBalanceWei: {
          type: 'string',
          enum: [EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI_TEXT],
        },
        faucetUrl: { type: 'string', enum: [EVM_PUBLIC_TESTNET_FAUCET] },
      },
    },
    liveObservation: {
      type: 'object',
      additionalProperties: false,
      required: [
        'confirmation',
        'blockNumber',
        'blockHash',
        'observedAt',
        'aTokenBalanceBeforeAtomic',
      ],
      properties: {
        confirmation: { type: 'string', enum: ['LATEST_PREFLIGHT_OBSERVATION'] },
        blockNumber: DECIMAL_SCHEMA,
        blockHash: HASH_SCHEMA,
        observedAt: { type: 'string', format: 'date-time' },
        aTokenBalanceBeforeAtomic: DECIMAL_SCHEMA,
      },
    },
    providerVisibility: { type: 'string', enum: ['ONCHAIN_TARGETS_PUBLIC_TO_SIGNER'] },
  },
});

export const EVM_PUBLIC_TESTNET_VERIFICATION_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['intentId', 'status', 'confirmation', 'transaction', 'position', 'consumed'],
  properties: {
    intentId: { type: 'string', format: 'uuid' },
    status: STATUS_SCHEMA,
    confirmation: { type: 'string', enum: ['LATEST_RECEIPT_AND_FINALITY_OBSERVATION'] },
    transaction: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'transactionHash', 'blockNumber', 'blockHash'],
      properties: {
        status: STATUS_SCHEMA,
        transactionHash: { oneOf: [HASH_SCHEMA, { type: 'null' }] },
        blockNumber: { oneOf: [DECIMAL_SCHEMA, { type: 'null' }] },
        blockHash: { oneOf: [HASH_SCHEMA, { type: 'null' }] },
      },
    },
    position: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'aTokenBalanceBeforeAtomic',
        'aTokenBalanceAfterAtomic',
        'increaseAtomic',
      ],
      properties: {
        status: STATUS_SCHEMA,
        aTokenBalanceBeforeAtomic: DECIMAL_SCHEMA,
        aTokenBalanceAfterAtomic: { oneOf: [DECIMAL_SCHEMA, { type: 'null' }] },
        increaseAtomic: { oneOf: [DECIMAL_SCHEMA, { type: 'null' }] },
      },
    },
    consumed: { type: 'boolean' },
  },
});

export const EVM_PUBLIC_TESTNET_POSITION_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'use',
    'mayAuthorizeFinancialAction',
    'chainId',
    'account',
    'provider',
    'position',
    'rate',
    'liveObservation',
  ],
  properties: {
    use: { type: 'string', enum: ['EVM_PUBLIC_TESTNET_READ_ONLY_POSITION'] },
    mayAuthorizeFinancialAction: { type: 'boolean', enum: [false] },
    chainId: { type: 'string', enum: [EVM_PUBLIC_TESTNET_CHAIN_ID] },
    account: { type: 'string', pattern: ADDRESS },
    provider: {
      type: 'object',
      additionalProperties: false,
      required: [
        'name',
        'pool',
        'addressesProvider',
        'dataProvider',
        'gateway',
        'reserve',
        'aToken',
      ],
      properties: {
        name: { type: 'string', enum: ['Aave V3'] },
        pool: { type: 'string', enum: [EVM_PUBLIC_TESTNET_POOL] },
        addressesProvider: { type: 'string', enum: [EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER] },
        dataProvider: { type: 'string', enum: [EVM_PUBLIC_TESTNET_DATA_PROVIDER] },
        gateway: { type: 'string', enum: [EVM_PUBLIC_TESTNET_WETH_GATEWAY] },
        reserve: { type: 'string', enum: [EVM_PUBLIC_TESTNET_WETH] },
        aToken: { type: 'string', enum: [EVM_PUBLIC_TESTNET_AWETH] },
      },
    },
    position: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'assetSymbol',
        'assetDecimals',
        'suppliedLiquidityAtomic',
        'aTokenSymbol',
        'aTokenBalanceAtomic',
        'aTokenDecimals',
      ],
      properties: {
        status: { type: 'string', enum: ['OPEN', 'EMPTY'] },
        assetSymbol: { type: 'string', enum: ['ETH'] },
        assetDecimals: { type: 'integer', enum: [EVM_PUBLIC_TESTNET_ASSET_DECIMALS] },
        suppliedLiquidityAtomic: DECIMAL_SCHEMA,
        aTokenSymbol: { type: 'string', enum: ['aBaseSepoliaWETH'] },
        aTokenBalanceAtomic: DECIMAL_SCHEMA,
        aTokenDecimals: { type: 'integer', enum: [EVM_PUBLIC_TESTNET_ASSET_DECIMALS] },
      },
    },
    rate: {
      type: 'object',
      additionalProperties: false,
      required: [
        'kind',
        'liquidityRateRay',
        'supplyApyBasisPoints',
        'variable',
        'rewardsIncluded',
        'riskAssessed',
        'historyAvailable',
      ],
      properties: {
        kind: { type: 'string', enum: ['ONCHAIN_INDICATIVE_BASE_SUPPLY_APY'] },
        liquidityRateRay: DECIMAL_SCHEMA,
        supplyApyBasisPoints: { type: 'integer', minimum: 0, maximum: 10_000_000 },
        variable: { type: 'boolean', enum: [true] },
        rewardsIncluded: { type: 'boolean', enum: [false] },
        riskAssessed: { type: 'boolean', enum: [false] },
        historyAvailable: { type: 'boolean', enum: [false] },
      },
    },
    liveObservation: {
      type: 'object',
      additionalProperties: false,
      required: [
        'confirmation',
        'blockNumber',
        'blockHash',
        'finalizedBlockNumber',
        'finalizedBlockHash',
        'observedAt',
      ],
      properties: {
        confirmation: { type: 'string', enum: ['LATEST_POSITION_OBSERVATION'] },
        blockNumber: DECIMAL_SCHEMA,
        blockHash: HASH_SCHEMA,
        finalizedBlockNumber: DECIMAL_SCHEMA,
        finalizedBlockHash: HASH_SCHEMA,
        observedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
});
