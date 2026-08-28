import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import { PublicKey } from '@solana/web3.js';
import type { Observable } from 'rxjs';

import { LOCAL_DEMO_MAX_LIQUID_RESERVE_BASIS_POINTS } from '../local-demo/local-demo-allocation.service';
import {
  PUBLIC_TESTNET_ASSET_DECIMALS,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC_TEXT,
  PUBLIC_TESTNET_SOL_FAUCET,
} from './public-testnet-execution.constants';
import type {
  PublicTestnetIntentRequest,
  PublicTestnetSubmissionRequest,
} from './public-testnet-execution.service';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PORTFOLIO_SNAPSHOT_ID = /^local-demo-portfolio:[0-9a-f]{32}$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const DECIMAL_INTEGER = '^(?:0|[1-9][0-9]*)$';
const BASE58_SCHEMA = '^[1-9A-HJ-NP-Za-km-z]+$';
const BASE64_SCHEMA = '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export class PublicTestnetBodyError extends Error {
  constructor() {
    super('Public-testnet request is invalid');
    this.name = 'PublicTestnetBodyError';
  }
}

function fail(): never {
  throw new PublicTestnetBodyError();
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
    if (error instanceof PublicTestnetBodyError) throw error;
    return fail();
  }
}

function decodedBase58Length(value: string): number {
  if (value.length === 0 || !BASE58.test(value)) return -1;
  const output: number[] = [0];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return -1;
    let carry = digit;
    for (let index = 0; index < output.length; index += 1) {
      const next = (output[index] ?? 0) * 58 + carry;
      output[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      output.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeroes = 0;
  while (leadingZeroes < value.length - 1 && value[leadingZeroes] === '1') leadingZeroes += 1;
  return leadingZeroes + output.length;
}

export function parsePublicTestnetIntentBody(value: unknown): PublicTestnetIntentRequest {
  const body = exactRecord(value, ['portfolioSnapshotId', 'selection', 'chainId', 'account']);
  if (
    typeof body.portfolioSnapshotId !== 'string' ||
    !PORTFOLIO_SNAPSHOT_ID.test(body.portfolioSnapshotId) ||
    body.chainId !== PUBLIC_TESTNET_CHAIN_ID ||
    typeof body.account !== 'string' ||
    body.account.length < 32 ||
    body.account.length > 44 ||
    !BASE58.test(body.account)
  ) {
    return fail();
  }
  let account: string;
  try {
    account = new PublicKey(body.account).toBase58();
  } catch {
    return fail();
  }
  if (account !== body.account) return fail();
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
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account,
  });
}

export function parsePublicTestnetSubmissionBody(value: unknown): PublicTestnetSubmissionRequest {
  const body = exactRecord(value, ['signature']);
  if (
    typeof body.signature !== 'string' ||
    body.signature.length < 64 ||
    body.signature.length > 88 ||
    decodedBase58Length(body.signature) !== 64
  ) {
    return fail();
  }
  return Object.freeze({ signature: body.signature });
}

export function parsePublicTestnetIntentId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail();
  return value;
}

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class PublicTestnetPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<HeaderWriter>();
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Vary', 'Cookie, Origin');
    response.setHeader('X-Crypto-Lending-Demo-Mode', 'public-testnet-local');
    return next.handle();
  }
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

export const PUBLIC_TESTNET_INTENT_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['portfolioSnapshotId', 'selection', 'chainId', 'account'],
  properties: {
    portfolioSnapshotId: { type: 'string', pattern: '^local-demo-portfolio:[0-9a-f]{32}$' },
    selection: SELECTION_SCHEMA,
    chainId: { type: 'string', enum: [PUBLIC_TESTNET_CHAIN_ID] },
    account: { type: 'string', pattern: BASE58_SCHEMA, minLength: 32, maxLength: 44 },
  },
});

export const PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['signature'],
  properties: {
    signature: { type: 'string', pattern: BASE58_SCHEMA, minLength: 64, maxLength: 88 },
  },
});

export const PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
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
    use: { type: 'string', enum: ['PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY'] },
    mayAuthorizeMainnetFinancialAction: { type: 'boolean', enum: [false] },
    intentId: { type: 'string', format: 'uuid' },
    expiresAt: { type: 'string', format: 'date-time' },
    evidenceExpiresAt: { type: 'string', format: 'date-time' },
    chainId: { type: 'string', enum: [PUBLIC_TESTNET_CHAIN_ID] },
    account: { type: 'string', pattern: BASE58_SCHEMA },
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
        amountAtomic: { type: 'string', enum: [PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC_TEXT] },
        assetSymbol: { type: 'string', enum: ['SOL'] },
        assetDecimals: { type: 'integer', enum: [PUBLIC_TESTNET_ASSET_DECIMALS] },
        notFullBlend: { type: 'boolean', enum: [true] },
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
        'sourceLiquidityAccount',
        'destinationCollateralAccount',
      ],
      properties: {
        encoding: { type: 'string', enum: ['BASE64'] },
        messageVersion: { type: 'string', enum: ['LEGACY'] },
        serializedTransactionBase64: { type: 'string', pattern: BASE64_SCHEMA },
        recentBlockhash: { type: 'string', pattern: BASE58_SCHEMA },
        lastValidBlockHeight: { type: 'string', pattern: DECIMAL_INTEGER },
        minContextSlot: { type: 'string', pattern: DECIMAL_INTEGER },
        feePayer: { type: 'string', pattern: BASE58_SCHEMA },
        sourceLiquidityAccount: { type: 'string', pattern: BASE58_SCHEMA },
        destinationCollateralAccount: { type: 'string', pattern: BASE58_SCHEMA },
      },
    },
    fundingReadiness: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'nativeBalanceLamports', 'requiredNativeBalanceLamports', 'faucetUrl'],
      properties: {
        status: { type: 'string', enum: ['READY', 'NEEDS_DEVNET_SOL'] },
        nativeBalanceLamports: { type: 'string', pattern: DECIMAL_INTEGER },
        requiredNativeBalanceLamports: { type: 'string', enum: ['20000000'] },
        faucetUrl: { type: 'string', enum: [PUBLIC_TESTNET_SOL_FAUCET] },
      },
    },
    liveObservation: {
      type: 'object',
      additionalProperties: false,
      required: ['confirmation', 'slot', 'observedAt', 'reserveLiquidityAtomic'],
      properties: {
        confirmation: { type: 'string', enum: ['FINALIZED_PREFLIGHT_OBSERVATION'] },
        slot: { type: 'string', pattern: DECIMAL_INTEGER },
        observedAt: { type: 'string', format: 'date-time' },
        reserveLiquidityAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
      },
    },
    providerVisibility: { type: 'string', enum: ['ONCHAIN_TARGETS_PUBLIC_TO_SIGNER'] },
  },
});

export const PUBLIC_TESTNET_VERIFICATION_RESPONSE_SCHEMA: SchemaObject = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['intentId', 'status', 'confirmation', 'transaction', 'position', 'consumed'],
  properties: {
    intentId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['PENDING', 'VERIFIED'] },
    confirmation: { type: 'string', enum: ['LATEST_SIGNATURE_STATUS_OBSERVATION'] },
    transaction: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'signature', 'slot'],
      properties: {
        status: { type: 'string', enum: ['PENDING', 'VERIFIED'] },
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
        'increaseAtomic',
      ],
      properties: {
        status: { type: 'string', enum: ['PENDING', 'VERIFIED'] },
        collateralBalanceBeforeAtomic: { type: 'string', pattern: DECIMAL_INTEGER },
        collateralBalanceAfterAtomic: {
          oneOf: [{ type: 'string', pattern: DECIMAL_INTEGER }, { type: 'null' }],
        },
        increaseAtomic: {
          oneOf: [{ type: 'string', pattern: DECIMAL_INTEGER }, { type: 'null' }],
        },
      },
    },
    consumed: { type: 'boolean' },
  },
});
