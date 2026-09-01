import type { SchemaObject } from '@nestjs/swagger';

import {
  PUBLIC_TESTNET_ASSET_DECIMALS,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_MAX_TRANSACTION_BYTES,
  PUBLIC_TESTNET_SOL_FAUCET,
} from './public-testnet-execution.constants';

const DECIMAL_INTEGER = '^(?:0|[1-9][0-9]*)$';
const BASE58_SCHEMA = '^[1-9A-HJ-NP-Za-km-z]+$';
const BASE64_SCHEMA = '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';

export const PUBLIC_TESTNET_WITHDRAWAL_INTENT_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
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
    'proof',
    'transaction',
    'fundingReadiness',
    'liveObservation',
    'providerVisibility',
  ],
  properties: {
    use: { type: 'string', enum: ['PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY'] },
    mayAuthorizeMainnetFinancialAction: { type: 'boolean', enum: [false] },
    intentId: { type: 'string', format: 'uuid' },
    expiresAt: { type: 'string', format: 'date-time' },
    evidenceExpiresAt: { type: 'string', format: 'date-time' },
    chainId: { type: 'string', enum: [PUBLIC_TESTNET_CHAIN_ID] },
    account: { type: 'string', pattern: BASE58_SCHEMA },
    proof: {
      type: 'object',
      additionalProperties: false,
      required: [
        'kind',
        'collateralAmountAtomic',
        'estimatedLiquidityAtomic',
        'collateralSymbol',
        'assetSymbol',
        'assetDecimals',
      ],
      properties: {
        kind: { type: 'string', enum: ['FULL_TESTNET_POSITION_WITHDRAWAL'] },
        collateralAmountAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
        estimatedLiquidityAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
        collateralSymbol: { type: 'string', enum: ['cSOL'] },
        assetSymbol: { type: 'string', enum: ['SOL'] },
        assetDecimals: { type: 'integer', enum: [PUBLIC_TESTNET_ASSET_DECIMALS] },
      },
    },
    transaction: {
      type: 'object',
      additionalProperties: false,
      required: [
        'encoding',
        'messageVersion',
        'serializedTransactionBase64',
        'recentBlockhash',
        'lastValidBlockHeight',
        'minContextSlot',
        'feePayer',
        'sourceCollateralAccount',
        'temporaryLiquidityAccount',
        'temporaryAccountSeed',
      ],
      properties: {
        encoding: { type: 'string', enum: ['BASE64'] },
        messageVersion: { type: 'string', enum: ['LEGACY'] },
        serializedTransactionBase64: {
          type: 'string',
          pattern: BASE64_SCHEMA,
          maxLength: Math.ceil(PUBLIC_TESTNET_MAX_TRANSACTION_BYTES / 3) * 4,
        },
        recentBlockhash: { type: 'string', pattern: BASE58_SCHEMA },
        lastValidBlockHeight: { type: 'string', pattern: DECIMAL_INTEGER },
        minContextSlot: { type: 'string', pattern: DECIMAL_INTEGER },
        feePayer: { type: 'string', pattern: BASE58_SCHEMA },
        sourceCollateralAccount: { type: 'string', pattern: BASE58_SCHEMA },
        temporaryLiquidityAccount: { type: 'string', pattern: BASE58_SCHEMA },
        temporaryAccountSeed: { type: 'string', pattern: '^wdv1:[0-9a-f]{27}$' },
      },
    },
    fundingReadiness: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'nativeBalanceLamports',
        'requiredNativeBalanceLamports',
        'temporaryAccountRentLamports',
        'faucetUrl',
      ],
      properties: {
        status: { type: 'string', enum: ['READY', 'NEEDS_DEVNET_SOL'] },
        nativeBalanceLamports: { type: 'string', pattern: DECIMAL_INTEGER },
        requiredNativeBalanceLamports: { type: 'string', enum: ['20000000'] },
        temporaryAccountRentLamports: { type: 'string', pattern: DECIMAL_INTEGER },
        faucetUrl: { type: 'string', enum: [PUBLIC_TESTNET_SOL_FAUCET] },
      },
    },
    liveObservation: {
      type: 'object',
      additionalProperties: false,
      required: [
        'confirmation',
        'slot',
        'observedAt',
        'collateralBalanceAtomic',
        'estimatedLiquidityAtomic',
        'reserveAvailableLiquidityAtomic',
      ],
      properties: {
        confirmation: { type: 'string', enum: ['FINALIZED_PREFLIGHT_OBSERVATION'] },
        slot: { type: 'string', pattern: DECIMAL_INTEGER },
        observedAt: { type: 'string', format: 'date-time' },
        collateralBalanceAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
        estimatedLiquidityAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
        reserveAvailableLiquidityAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
      },
    },
    providerVisibility: { type: 'string', enum: ['ONCHAIN_TARGETS_PUBLIC_TO_SIGNER'] },
  },
});

export const PUBLIC_TESTNET_WITHDRAWAL_VERIFICATION_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['intentId', 'status', 'confirmation', 'transaction', 'position', 'consumed'],
  properties: {
    intentId: { type: 'string', format: 'uuid' },
    status: {
      type: 'string',
      enum: ['PENDING', 'VERIFIED', 'SETTLED_POSITION_REMAINS', 'FAILED'],
    },
    confirmation: { type: 'string', enum: ['LATEST_SIGNATURE_STATUS_OBSERVATION'] },
    transaction: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'signature', 'slot'],
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING', 'VERIFIED', 'SETTLED_POSITION_REMAINS', 'FAILED'],
        },
        signature: { type: 'string', pattern: BASE58_SCHEMA },
        slot: { oneOf: [{ type: 'string', pattern: DECIMAL_INTEGER }, { type: 'null' }] },
      },
    },
    position: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'collateralBalanceBeforeAtomic',
        'collateralBalanceAfterAtomic',
        'decreaseAtomic',
        'liquidityReceivedAtomic',
      ],
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING', 'VERIFIED', 'SETTLED_POSITION_REMAINS', 'FAILED'],
        },
        collateralBalanceBeforeAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
        collateralBalanceAfterAtomic: {
          oneOf: [{ type: 'string', pattern: DECIMAL_INTEGER }, { type: 'null' }],
        },
        decreaseAtomic: {
          oneOf: [{ type: 'string', pattern: DECIMAL_INTEGER }, { type: 'null' }],
        },
        liquidityReceivedAtomic: {
          oneOf: [{ type: 'string', pattern: DECIMAL_INTEGER }, { type: 'null' }],
        },
      },
    },
    consumed: { type: 'boolean' },
  },
});
