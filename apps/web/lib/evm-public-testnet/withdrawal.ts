import { concatHex, encodeFunctionData, isAddress, keccak256, stringToHex, type Hex } from 'viem';

import {
  EVM_PUBLIC_TESTNET_ATOKEN,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_GATEWAY,
  EVM_PUBLIC_TESTNET_MAX_UINT256,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
} from './constants';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const MAX_INTENT_LIFETIME_MS = 10 * 60_000;
const MAX_EVIDENCE_LIFETIME_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 30_000;

const APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const WITHDRAW_ETH_ABI = [
  {
    type: 'function',
    name: 'withdrawETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
] as const;

export type EvmPublicTestnetWithdrawalStep = 'APPROVE_AWETH' | 'WITHDRAW_FULL_ETH';
export type EvmPublicTestnetWithdrawalStatus = 'PENDING' | 'CONFIRMED' | 'VERIFIED';

export interface EvmPublicTestnetWithdrawalRequest {
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface EvmPublicTestnetWithdrawalIntent {
  readonly use: 'EVM_PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY';
  readonly mayAuthorizeMainnetFinancialAction: false;
  readonly intentId: string;
  readonly expiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly position: Readonly<{
    assetSymbol: 'ETH';
    assetDecimals: 18;
    aTokenBalanceBeforeAtomic: string;
    fullPosition: true;
  }>;
  readonly allowance: Readonly<{
    token: string;
    spender: string;
    beforeAtomic: string;
    requiredAtomic: typeof EVM_PUBLIC_TESTNET_MAX_UINT256;
  }>;
  readonly transaction: Readonly<{
    from: string;
    to: string;
    value: typeof EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX;
    input: Hex;
    nonce: Hex;
    chainId: typeof EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID;
  }>;
  readonly liveObservation: Readonly<{
    confirmation: 'LATEST_WITHDRAWAL_PREFLIGHT_OBSERVATION';
    blockNumber: string;
    blockHash: Hex;
    observedAt: string;
    nativeBalanceWei: string;
  }>;
  readonly providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER';
}

export interface EvmPublicTestnetWithdrawalResult {
  readonly intentId: string;
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly status: EvmPublicTestnetWithdrawalStatus;
  readonly confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION';
  readonly transaction: Readonly<{
    status: EvmPublicTestnetWithdrawalStatus;
    transactionHash: string | null;
    blockNumber: string | null;
    blockHash: string | null;
  }>;
  readonly effect: Readonly<{
    amountAtomic: string | null;
    aTokenBalanceBeforeAtomic: string;
    aTokenBalanceAfterAtomic: string | null;
    allowanceBeforeAtomic: string;
    allowanceAfterAtomic: string | null;
  }>;
  readonly consumed: boolean;
}

export interface EvmPublicTestnetWithdrawalResultExpectation {
  readonly intentId: string;
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly aTokenBalanceBeforeAtomic: string;
  readonly allowanceBeforeAtomic: string;
}

export interface EvmPublicTestnetWithdrawalWalletTransaction {
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly intentId: string;
  readonly from: string;
  readonly to: string;
  readonly value: typeof EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX;
  readonly data: Hex;
  readonly nonce: Hex;
}

export class EvmPublicTestnetWithdrawalValidationError extends Error {
  constructor() {
    super('Invalid EVM public-testnet withdrawal contract');
    this.name = 'EvmPublicTestnetWithdrawalValidationError';
  }
}

type PlainRecord = Record<string, unknown>;

function fail(): never {
  throw new EvmPublicTestnetWithdrawalValidationError();
}

function exact(value: unknown, keys: readonly string[]): PlainRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (
    names.length !== keys.length ||
    names.some((name) => !keys.includes(name)) ||
    keys.some((key) => descriptors[key] === undefined || !Object.hasOwn(descriptors[key]!, 'value'))
  ) {
    return fail();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
}

function account(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !isAddress(value, { strict: true }) ||
    value.toLowerCase() === ZERO_ADDRESS
  ) {
    return fail();
  }
  return value.toLowerCase();
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return fail();
  return value;
}

function dateTime(value: unknown): string {
  if (typeof value !== 'string' || !DATE_TIME.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function hash(value: unknown): Hex {
  if (typeof value !== 'string' || !HASH.test(value)) return fail();
  return value as Hex;
}

function sameAddress(left: unknown, right: string): boolean {
  try {
    return account(left) === right.toLowerCase();
  } catch {
    return false;
  }
}

function marker(step: EvmPublicTestnetWithdrawalStep, intentId: string): Hex {
  return keccak256(
    stringToHex(`crypto-lending:base-sepolia-aave-v3-full-withdrawal:v1:${step}:${intentId}`),
  );
}

export function evmPublicTestnetWithdrawalInput(
  step: EvmPublicTestnetWithdrawalStep,
  accountValue: string,
  intentId: string,
): Hex {
  const owner = account(accountValue) as `0x${string}`;
  if (!UUID_V4.test(intentId)) return fail();
  const call =
    step === 'APPROVE_AWETH'
      ? encodeFunctionData({
          abi: APPROVE_ABI,
          functionName: 'approve',
          args: [EVM_PUBLIC_TESTNET_GATEWAY, BigInt(EVM_PUBLIC_TESTNET_MAX_UINT256)],
        })
      : encodeFunctionData({
          abi: WITHDRAW_ETH_ABI,
          functionName: 'withdrawETH',
          args: [EVM_PUBLIC_TESTNET_POOL, BigInt(EVM_PUBLIC_TESTNET_MAX_UINT256), owner],
        });
  return concatHex([call, marker(step, intentId)]);
}

export function validateEvmPublicTestnetWithdrawalRequest(
  value: unknown,
): EvmPublicTestnetWithdrawalRequest {
  const record = exact(value, ['chainId', 'account']);
  if (record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID) return fail();
  return Object.freeze({ chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: account(record.account) });
}

export function parseEvmPublicTestnetWithdrawalIntent(
  value: unknown,
  expectedRequestValue: EvmPublicTestnetWithdrawalRequest,
  now: Date = new Date(),
): EvmPublicTestnetWithdrawalIntent {
  const expected = validateEvmPublicTestnetWithdrawalRequest(expectedRequestValue);
  const record = exact(value, [
    'use',
    'mayAuthorizeMainnetFinancialAction',
    'intentId',
    'expiresAt',
    'evidenceExpiresAt',
    'chainId',
    'account',
    'step',
    'position',
    'allowance',
    'transaction',
    'liveObservation',
    'providerVisibility',
  ]);
  if (
    record.use !== 'EVM_PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY' ||
    record.mayAuthorizeMainnetFinancialAction !== false ||
    typeof record.intentId !== 'string' ||
    !UUID_V4.test(record.intentId) ||
    record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID ||
    account(record.account) !== expected.account ||
    (record.step !== 'APPROVE_AWETH' && record.step !== 'WITHDRAW_FULL_ETH') ||
    record.providerVisibility !== 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER'
  ) {
    return fail();
  }
  const step = record.step;
  const nowMs = now.getTime();
  const expiresAt = dateTime(record.expiresAt);
  const evidenceExpiresAt = dateTime(record.evidenceExpiresAt);
  const expiresMs = Date.parse(expiresAt);
  const evidenceMs = Date.parse(evidenceExpiresAt);
  if (
    !Number.isFinite(nowMs) ||
    expiresMs <= nowMs - CLOCK_SKEW_MS ||
    expiresMs > nowMs + MAX_INTENT_LIFETIME_MS ||
    evidenceMs < expiresMs ||
    evidenceMs > nowMs + MAX_EVIDENCE_LIFETIME_MS
  ) {
    return fail();
  }
  const position = exact(record.position, [
    'assetSymbol',
    'assetDecimals',
    'aTokenBalanceBeforeAtomic',
    'fullPosition',
  ]);
  const balanceBefore = decimal(position.aTokenBalanceBeforeAtomic);
  if (
    position.assetSymbol !== 'ETH' ||
    position.assetDecimals !== 18 ||
    position.fullPosition !== true ||
    BigInt(balanceBefore) <= 0n
  ) {
    return fail();
  }
  const allowance = exact(record.allowance, ['token', 'spender', 'beforeAtomic', 'requiredAtomic']);
  const allowanceBefore = decimal(allowance.beforeAtomic);
  if (
    !sameAddress(allowance.token, EVM_PUBLIC_TESTNET_ATOKEN) ||
    !sameAddress(allowance.spender, EVM_PUBLIC_TESTNET_GATEWAY) ||
    allowance.requiredAtomic !== EVM_PUBLIC_TESTNET_MAX_UINT256 ||
    (step === 'APPROVE_AWETH') !== (allowanceBefore !== EVM_PUBLIC_TESTNET_MAX_UINT256)
  ) {
    return fail();
  }
  const transaction = exact(record.transaction, [
    'from',
    'to',
    'value',
    'input',
    'nonce',
    'chainId',
  ]);
  const expectedTarget =
    step === 'APPROVE_AWETH' ? EVM_PUBLIC_TESTNET_ATOKEN : EVM_PUBLIC_TESTNET_GATEWAY;
  const expectedInput = evmPublicTestnetWithdrawalInput(step, expected.account, record.intentId);
  if (
    account(transaction.from) !== expected.account ||
    !sameAddress(transaction.to, expectedTarget) ||
    transaction.value !== EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX ||
    transaction.input !== expectedInput ||
    typeof transaction.nonce !== 'string' ||
    !QUANTITY.test(transaction.nonce) ||
    transaction.chainId !== EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID
  ) {
    return fail();
  }
  const observation = exact(record.liveObservation, [
    'confirmation',
    'blockNumber',
    'blockHash',
    'observedAt',
    'nativeBalanceWei',
  ]);
  if (
    observation.confirmation !== 'LATEST_WITHDRAWAL_PREFLIGHT_OBSERVATION' ||
    BigInt(decimal(observation.blockNumber)) < 0n
  ) {
    return fail();
  }
  const blockHash = hash(observation.blockHash);
  const observedAt = dateTime(observation.observedAt);
  const nativeBalanceWei = decimal(observation.nativeBalanceWei);
  return Object.freeze({
    use: 'EVM_PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY' as const,
    mayAuthorizeMainnetFinancialAction: false as const,
    intentId: record.intentId,
    expiresAt,
    evidenceExpiresAt,
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: expected.account,
    step,
    position: Object.freeze({
      assetSymbol: 'ETH' as const,
      assetDecimals: 18 as const,
      aTokenBalanceBeforeAtomic: balanceBefore,
      fullPosition: true as const,
    }),
    allowance: Object.freeze({
      token: EVM_PUBLIC_TESTNET_ATOKEN.toLowerCase(),
      spender: EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase(),
      beforeAtomic: allowanceBefore,
      requiredAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256,
    }),
    transaction: Object.freeze({
      from: expected.account,
      to: expectedTarget.toLowerCase(),
      value: EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
      input: expectedInput,
      nonce: transaction.nonce as Hex,
      chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
    }),
    liveObservation: Object.freeze({
      confirmation: 'LATEST_WITHDRAWAL_PREFLIGHT_OBSERVATION' as const,
      blockNumber: observation.blockNumber as string,
      blockHash,
      observedAt,
      nativeBalanceWei,
    }),
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
  });
}

export function evmPublicTestnetWithdrawalWalletTransaction(
  intent: EvmPublicTestnetWithdrawalIntent,
): EvmPublicTestnetWithdrawalWalletTransaction {
  return Object.freeze({
    step: intent.step,
    intentId: intent.intentId,
    from: intent.transaction.from,
    to: intent.transaction.to,
    value: intent.transaction.value,
    data: intent.transaction.input,
    nonce: intent.transaction.nonce,
  });
}

export function evmPublicTestnetWithdrawalResultExpectation(
  intent: EvmPublicTestnetWithdrawalIntent,
): EvmPublicTestnetWithdrawalResultExpectation {
  return Object.freeze({
    intentId: intent.intentId,
    step: intent.step,
    aTokenBalanceBeforeAtomic: intent.position.aTokenBalanceBeforeAtomic,
    allowanceBeforeAtomic: intent.allowance.beforeAtomic,
  });
}

export function parseEvmPublicTestnetWithdrawalResult(
  value: unknown,
  expectedIntent: EvmPublicTestnetWithdrawalResultExpectation,
  expectedTransactionHash?: string,
): EvmPublicTestnetWithdrawalResult {
  const record = exact(value, [
    'intentId',
    'step',
    'status',
    'confirmation',
    'transaction',
    'effect',
    'consumed',
  ]);
  if (
    record.intentId !== expectedIntent.intentId ||
    record.step !== expectedIntent.step ||
    (record.status !== 'PENDING' &&
      record.status !== 'CONFIRMED' &&
      record.status !== 'VERIFIED') ||
    record.confirmation !== 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION'
  ) {
    return fail();
  }
  const status = record.status;
  const transaction = exact(record.transaction, [
    'status',
    'transactionHash',
    'blockNumber',
    'blockHash',
  ]);
  const effect = exact(record.effect, [
    'amountAtomic',
    'aTokenBalanceBeforeAtomic',
    'aTokenBalanceAfterAtomic',
    'allowanceBeforeAtomic',
    'allowanceAfterAtomic',
  ]);
  if (
    transaction.status !== status ||
    effect.aTokenBalanceBeforeAtomic !== expectedIntent.aTokenBalanceBeforeAtomic ||
    effect.allowanceBeforeAtomic !== expectedIntent.allowanceBeforeAtomic ||
    record.consumed !== (status !== 'PENDING')
  ) {
    return fail();
  }
  const transactionHash =
    transaction.transactionHash === null ? null : hash(transaction.transactionHash);
  const blockNumber = transaction.blockNumber === null ? null : decimal(transaction.blockNumber);
  const blockHash = transaction.blockHash === null ? null : hash(transaction.blockHash);
  const amountAtomic = effect.amountAtomic === null ? null : decimal(effect.amountAtomic);
  const balanceAfter =
    effect.aTokenBalanceAfterAtomic === null ? null : decimal(effect.aTokenBalanceAfterAtomic);
  const allowanceAfter =
    effect.allowanceAfterAtomic === null ? null : decimal(effect.allowanceAfterAtomic);
  if (status === 'PENDING') {
    if (
      blockNumber !== null ||
      blockHash !== null ||
      amountAtomic !== null ||
      balanceAfter !== null ||
      allowanceAfter !== null ||
      (expectedTransactionHash !== undefined &&
        transactionHash !== null &&
        transactionHash !== expectedTransactionHash)
    ) {
      return fail();
    }
  } else if (
    transactionHash === null ||
    blockNumber === null ||
    blockHash === null ||
    amountAtomic === null ||
    balanceAfter === null ||
    allowanceAfter === null ||
    (expectedIntent.step === 'APPROVE_AWETH'
      ? amountAtomic !== EVM_PUBLIC_TESTNET_MAX_UINT256
      : BigInt(amountAtomic) <= 0n)
  ) {
    return fail();
  }
  if (
    status !== 'PENDING' &&
    expectedIntent.step === 'APPROVE_AWETH' &&
    allowanceAfter !== EVM_PUBLIC_TESTNET_MAX_UINT256
  ) {
    return fail();
  }
  if (
    status !== 'PENDING' &&
    expectedIntent.step === 'WITHDRAW_FULL_ETH' &&
    (balanceAfter !== '0' ||
      BigInt(amountAtomic as string) < BigInt(expectedIntent.aTokenBalanceBeforeAtomic))
  ) {
    return fail();
  }
  return Object.freeze({
    intentId: expectedIntent.intentId,
    step: expectedIntent.step,
    status,
    confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION' as const,
    transaction: Object.freeze({ status, transactionHash, blockNumber, blockHash }),
    effect: Object.freeze({
      amountAtomic,
      aTokenBalanceBeforeAtomic: expectedIntent.aTokenBalanceBeforeAtomic,
      aTokenBalanceAfterAtomic: balanceAfter,
      allowanceBeforeAtomic: expectedIntent.allowanceBeforeAtomic,
      allowanceAfterAtomic: allowanceAfter,
    }),
    consumed: status !== 'PENDING',
  });
}
