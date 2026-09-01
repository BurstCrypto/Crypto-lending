import { encodeFunctionData, isAddress, keccak256, stringToHex, type Hex } from 'viem';

import type { LocalDemoAllocationPreview } from '@/lib/local-demo/local-demo-yield';
import type { EvmPublicTestnetTransactionRequest } from '@/lib/wallets/eip1193/public-testnet-executor';

import {
  EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
  EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
  EVM_PUBLIC_TESTNET_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_ATOKEN,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_DATA_PROVIDER,
  EVM_PUBLIC_TESTNET_EXPLORER_TRANSACTION_BASE,
  EVM_PUBLIC_TESTNET_FAUCET_URL,
  EVM_PUBLIC_TESTNET_GATEWAY,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI,
  EVM_PUBLIC_TESTNET_RESERVE,
} from './constants';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PORTFOLIO_SNAPSHOT_ID = /^local-demo-portfolio:[0-9a-f]{32}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECIMAL_INTEGER = /^(0|[1-9][0-9]{0,77})$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const MAX_INTENT_LIFETIME_MS = 10 * 60_000;
const MAX_EVIDENCE_LIFETIME_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 30_000;

const DEPOSIT_ETH_ABI = [
  {
    type: 'function',
    name: 'depositETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
] as const;

export type EvmPublicTestnetSubmissionStatus = 'PENDING' | 'CONFIRMED' | 'VERIFIED';
export type EvmPublicTestnetFundingStatus = 'READY' | 'NEEDS_BASE_SEPOLIA_ETH';

export interface EvmPublicTestnetExecutionRequest {
  readonly portfolioSnapshotId: string;
  readonly selection: Readonly<{
    kind: 'PRESET';
    presetId: 'BALANCED';
    liquidReserveBasisPoints: number;
  }>;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface EvmPublicTestnetExecutionIntent {
  readonly use: 'EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY';
  readonly mayAuthorizeMainnetFinancialAction: false;
  readonly intentId: string;
  readonly expiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
  readonly portfolioBinding: Readonly<{
    portfolioSnapshotId: string;
    selection: EvmPublicTestnetExecutionRequest['selection'];
  }>;
  readonly proof: Readonly<{
    kind: 'SINGLE_TESTNET_PROOF_POSITION';
    amountAtomic: typeof EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC;
    assetSymbol: 'ETH';
    assetDecimals: 18;
    notFullBlend: true;
  }>;
  readonly transaction: Readonly<{
    from: string;
    to: string;
    value: typeof EVM_PUBLIC_TESTNET_AMOUNT_HEX;
    input: Hex;
    nonce: Hex;
    chainId: typeof EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID;
  }>;
  readonly fundingReadiness: Readonly<{
    status: EvmPublicTestnetFundingStatus;
    nativeBalanceWei: string;
    requiredNativeBalanceWei: typeof EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI;
    faucetUrl: typeof EVM_PUBLIC_TESTNET_FAUCET_URL;
  }>;
  readonly liveObservation: Readonly<{
    confirmation: 'LATEST_PREFLIGHT_OBSERVATION';
    blockNumber: string;
    blockHash: Hex;
    observedAt: string;
    aTokenBalanceBeforeAtomic: string;
  }>;
  readonly providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER';
}

export interface EvmPublicTestnetSubmissionResult {
  readonly intentId: string;
  readonly status: EvmPublicTestnetSubmissionStatus;
  readonly confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION';
  readonly transaction: Readonly<{
    status: EvmPublicTestnetSubmissionStatus;
    transactionHash: string | null;
    blockNumber: string | null;
    blockHash: string | null;
  }>;
  readonly position: Readonly<{
    status: EvmPublicTestnetSubmissionStatus;
    aTokenBalanceBeforeAtomic: string;
    aTokenBalanceAfterAtomic: string | null;
    increaseAtomic: string | null;
  }>;
  readonly consumed: boolean;
}

export interface EvmPublicTestnetPositionRequest {
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface EvmPublicTestnetPositionSnapshot {
  readonly use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION';
  readonly mayAuthorizeFinancialAction: false;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
  readonly provider: Readonly<{
    name: 'Aave V3';
    pool: string;
    addressesProvider: string;
    dataProvider: string;
    gateway: string;
    reserve: string;
    aToken: string;
  }>;
  readonly position: Readonly<{
    status: 'OPEN' | 'EMPTY';
    assetSymbol: 'ETH';
    assetDecimals: 18;
    suppliedLiquidityAtomic: string;
    aTokenSymbol: 'aBaseSepoliaWETH';
    aTokenBalanceAtomic: string;
    aTokenDecimals: 18;
  }>;
  readonly rate: Readonly<{
    kind: 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY';
    liquidityRateRay: string;
    supplyApyBasisPoints: number;
    variable: true;
    rewardsIncluded: false;
    riskAssessed: false;
    historyAvailable: false;
  }>;
  readonly liveObservation: Readonly<{
    confirmation: 'LATEST_POSITION_OBSERVATION';
    blockNumber: string;
    blockHash: string;
    finalizedBlockNumber: string;
    finalizedBlockHash: string;
    observedAt: string;
  }>;
}

export class EvmPublicTestnetExecutionValidationError extends Error {
  constructor() {
    super('EVM public-testnet execution data is invalid');
    this.name = 'EvmPublicTestnetExecutionValidationError';
  }
}

type PlainRecord = Record<string, unknown>;

function fail(): never {
  throw new EvmPublicTestnetExecutionValidationError();
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord {
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
    keys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !Object.hasOwn(descriptor, 'value');
    })
  ) {
    return fail();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) return fail();
  return value;
}

function dateTime(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_DATE_TIME.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function canonicalHexQuantity(value: unknown): Hex {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) return fail();
  return value as Hex;
}

function canonicalHash(value: unknown): Hex {
  if (typeof value !== 'string' || !HASH.test(value)) return fail();
  return value as Hex;
}

function sameAddress(left: unknown, right: string): boolean {
  try {
    return normalizeEvmPublicTestnetAccount(left) === right.toLowerCase();
  } catch {
    return false;
  }
}

export function normalizeEvmPublicTestnetAccount(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/u.test(value) ||
    !isAddress(value, { strict: true }) ||
    value.toLowerCase() === ZERO_ADDRESS
  ) {
    return fail();
  }
  return value.toLowerCase();
}

export function parseEvmPublicTestnetTransactionHash(value: unknown): string {
  return canonicalHash(value);
}

export function validateEvmPublicTestnetExecutionRequest(
  value: EvmPublicTestnetExecutionRequest,
): EvmPublicTestnetExecutionRequest {
  const record = exactRecord(value, ['portfolioSnapshotId', 'selection', 'chainId', 'account']);
  const selection = exactRecord(record.selection, ['kind', 'presetId', 'liquidReserveBasisPoints']);
  if (
    typeof record.portfolioSnapshotId !== 'string' ||
    !PORTFOLIO_SNAPSHOT_ID.test(record.portfolioSnapshotId) ||
    record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID ||
    selection.kind !== 'PRESET' ||
    selection.presetId !== 'BALANCED' ||
    !Number.isSafeInteger(selection.liquidReserveBasisPoints) ||
    (selection.liquidReserveBasisPoints as number) < 0 ||
    (selection.liquidReserveBasisPoints as number) > 9_500
  ) {
    return fail();
  }
  return Object.freeze({
    portfolioSnapshotId: record.portfolioSnapshotId,
    selection: Object.freeze({
      kind: 'PRESET' as const,
      presetId: 'BALANCED' as const,
      liquidReserveBasisPoints: selection.liquidReserveBasisPoints as number,
    }),
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: normalizeEvmPublicTestnetAccount(record.account),
  });
}

export function validateEvmPublicTestnetPositionRequest(
  value: EvmPublicTestnetPositionRequest,
): EvmPublicTestnetPositionRequest {
  const record = exactRecord(value, ['chainId', 'account']);
  if (record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID) return fail();
  return Object.freeze({
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: normalizeEvmPublicTestnetAccount(record.account),
  });
}

function expectedDepositInput(account: string, intentId: string): Hex {
  const call = encodeFunctionData({
    abi: DEPOSIT_ETH_ABI,
    functionName: 'depositETH',
    args: [EVM_PUBLIC_TESTNET_POOL, account as `0x${string}`, 0],
  });
  const marker = keccak256(stringToHex(`crypto-lending:base-sepolia-aave-v3-proof:v1:${intentId}`));
  return `${call}${marker.slice(2)}` as Hex;
}

export function parseEvmPublicTestnetExecutionIntent(
  value: unknown,
  expectedRequest: EvmPublicTestnetExecutionRequest,
  now: Date,
): EvmPublicTestnetExecutionIntent {
  const expected = validateEvmPublicTestnetExecutionRequest(expectedRequest);
  const record = exactRecord(value, [
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
  ]);
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) return fail();
  const expiresAt = dateTime(record.expiresAt);
  const evidenceExpiresAt = dateTime(record.evidenceExpiresAt);
  const expiresAtMilliseconds = Date.parse(expiresAt);
  const evidenceExpiresAtMilliseconds = Date.parse(evidenceExpiresAt);
  if (
    record.use !== 'EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY' ||
    record.mayAuthorizeMainnetFinancialAction !== false ||
    typeof record.intentId !== 'string' ||
    !UUID_V4.test(record.intentId) ||
    record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID ||
    normalizeEvmPublicTestnetAccount(record.account) !== expected.account ||
    expiresAtMilliseconds <= nowMilliseconds - CLOCK_SKEW_MS ||
    expiresAtMilliseconds > nowMilliseconds + MAX_INTENT_LIFETIME_MS ||
    evidenceExpiresAtMilliseconds < expiresAtMilliseconds ||
    evidenceExpiresAtMilliseconds > nowMilliseconds + MAX_EVIDENCE_LIFETIME_MS ||
    record.providerVisibility !== 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER'
  ) {
    return fail();
  }

  const portfolioBinding = exactRecord(record.portfolioBinding, [
    'portfolioSnapshotId',
    'selection',
  ]);
  const selection = exactRecord(portfolioBinding.selection, [
    'kind',
    'presetId',
    'liquidReserveBasisPoints',
  ]);
  if (
    portfolioBinding.portfolioSnapshotId !== expected.portfolioSnapshotId ||
    selection.kind !== expected.selection.kind ||
    selection.presetId !== expected.selection.presetId ||
    selection.liquidReserveBasisPoints !== expected.selection.liquidReserveBasisPoints
  ) {
    return fail();
  }

  const proof = exactRecord(record.proof, [
    'kind',
    'amountAtomic',
    'assetSymbol',
    'assetDecimals',
    'notFullBlend',
  ]);
  if (
    proof.kind !== 'SINGLE_TESTNET_PROOF_POSITION' ||
    proof.amountAtomic !== EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC ||
    proof.assetSymbol !== 'ETH' ||
    proof.assetDecimals !== 18 ||
    proof.notFullBlend !== true
  ) {
    return fail();
  }

  const transaction = exactRecord(record.transaction, [
    'from',
    'to',
    'value',
    'input',
    'nonce',
    'chainId',
  ]);
  const nonce = canonicalHexQuantity(transaction.nonce);
  const input = transaction.input;
  if (
    normalizeEvmPublicTestnetAccount(transaction.from) !== expected.account ||
    !sameAddress(transaction.to, EVM_PUBLIC_TESTNET_GATEWAY) ||
    transaction.value !== EVM_PUBLIC_TESTNET_AMOUNT_HEX ||
    typeof input !== 'string' ||
    input !== expectedDepositInput(expected.account, record.intentId) ||
    transaction.chainId !== EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID
  ) {
    return fail();
  }

  const funding = exactRecord(record.fundingReadiness, [
    'status',
    'nativeBalanceWei',
    'requiredNativeBalanceWei',
    'faucetUrl',
  ]);
  const nativeBalanceWei = decimal(funding.nativeBalanceWei);
  const ready = BigInt(nativeBalanceWei) >= BigInt(EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI);
  if (
    (funding.status !== 'READY' && funding.status !== 'NEEDS_BASE_SEPOLIA_ETH') ||
    funding.status !== (ready ? 'READY' : 'NEEDS_BASE_SEPOLIA_ETH') ||
    funding.requiredNativeBalanceWei !== EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI ||
    funding.faucetUrl !== EVM_PUBLIC_TESTNET_FAUCET_URL
  ) {
    return fail();
  }

  const observation = exactRecord(record.liveObservation, [
    'confirmation',
    'blockNumber',
    'blockHash',
    'observedAt',
    'aTokenBalanceBeforeAtomic',
  ]);
  if (observation.confirmation !== 'LATEST_PREFLIGHT_OBSERVATION') return fail();

  return Object.freeze({
    use: 'EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY' as const,
    mayAuthorizeMainnetFinancialAction: false as const,
    intentId: record.intentId,
    expiresAt,
    evidenceExpiresAt,
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: expected.account,
    portfolioBinding: Object.freeze({
      portfolioSnapshotId: expected.portfolioSnapshotId,
      selection: expected.selection,
    }),
    proof: Object.freeze({
      kind: 'SINGLE_TESTNET_PROOF_POSITION' as const,
      amountAtomic: EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
      assetSymbol: 'ETH' as const,
      assetDecimals: 18 as const,
      notFullBlend: true as const,
    }),
    transaction: Object.freeze({
      from: expected.account,
      to: EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase(),
      value: EVM_PUBLIC_TESTNET_AMOUNT_HEX,
      input: input as Hex,
      nonce,
      chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
    }),
    fundingReadiness: Object.freeze({
      status: funding.status as EvmPublicTestnetFundingStatus,
      nativeBalanceWei,
      requiredNativeBalanceWei: EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI,
      faucetUrl: EVM_PUBLIC_TESTNET_FAUCET_URL,
    }),
    liveObservation: Object.freeze({
      confirmation: 'LATEST_PREFLIGHT_OBSERVATION' as const,
      blockNumber: decimal(observation.blockNumber),
      blockHash: canonicalHash(observation.blockHash),
      observedAt: dateTime(observation.observedAt),
      aTokenBalanceBeforeAtomic: decimal(observation.aTokenBalanceBeforeAtomic),
    }),
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
  });
}

export function evmPublicTestnetWalletTransaction(
  intent: EvmPublicTestnetExecutionIntent,
): EvmPublicTestnetTransactionRequest {
  return Object.freeze({
    from: normalizeEvmPublicTestnetAccount(intent.transaction.from),
    to: normalizeEvmPublicTestnetAccount(intent.transaction.to),
    value: canonicalHexQuantity(intent.transaction.value),
    data: intent.transaction.input,
    nonce: canonicalHexQuantity(intent.transaction.nonce),
  });
}

export function parseEvmPublicTestnetSubmissionResult(
  value: unknown,
  expected: Readonly<{ intentId: string; transactionHash: string | null }>,
): EvmPublicTestnetSubmissionResult {
  if (typeof expected.intentId !== 'string' || !UUID_V4.test(expected.intentId)) return fail();
  const expectedHash =
    expected.transactionHash === null
      ? null
      : parseEvmPublicTestnetTransactionHash(expected.transactionHash);
  const record = exactRecord(value, [
    'intentId',
    'status',
    'confirmation',
    'transaction',
    'position',
    'consumed',
  ]);
  if (
    record.intentId !== expected.intentId ||
    (record.status !== 'PENDING' &&
      record.status !== 'CONFIRMED' &&
      record.status !== 'VERIFIED') ||
    record.confirmation !== 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION' ||
    typeof record.consumed !== 'boolean'
  ) {
    return fail();
  }
  const status = record.status;
  const transaction = exactRecord(record.transaction, [
    'status',
    'transactionHash',
    'blockNumber',
    'blockHash',
  ]);
  const position = exactRecord(record.position, [
    'status',
    'aTokenBalanceBeforeAtomic',
    'aTokenBalanceAfterAtomic',
    'increaseAtomic',
  ]);
  if (transaction.status !== status || position.status !== status) return fail();

  const transactionHash =
    transaction.transactionHash === null
      ? null
      : parseEvmPublicTestnetTransactionHash(transaction.transactionHash);
  if (
    (expectedHash !== null && transactionHash !== expectedHash && status === 'PENDING') ||
    (status !== 'PENDING' && transactionHash === null)
  ) {
    return fail();
  }

  const blockNumber = transaction.blockNumber === null ? null : decimal(transaction.blockNumber);
  const blockHash = transaction.blockHash === null ? null : canonicalHash(transaction.blockHash);
  const balanceBefore = decimal(position.aTokenBalanceBeforeAtomic);
  const balanceAfter =
    position.aTokenBalanceAfterAtomic === null ? null : decimal(position.aTokenBalanceAfterAtomic);
  const increase = position.increaseAtomic === null ? null : decimal(position.increaseAtomic);
  if (status === 'PENDING') {
    if (
      blockNumber !== null ||
      blockHash !== null ||
      balanceAfter !== null ||
      increase !== null ||
      record.consumed !== false
    ) {
      return fail();
    }
  } else if (
    blockNumber === null ||
    blockHash === null ||
    balanceAfter === null ||
    increase === null ||
    BigInt(balanceAfter) < BigInt(balanceBefore) ||
    BigInt(balanceAfter) - BigInt(balanceBefore) !== BigInt(increase) ||
    BigInt(increase) <= 0n ||
    record.consumed !== true
  ) {
    return fail();
  }

  return Object.freeze({
    intentId: expected.intentId,
    status,
    confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION' as const,
    transaction: Object.freeze({ status, transactionHash, blockNumber, blockHash }),
    position: Object.freeze({
      status,
      aTokenBalanceBeforeAtomic: balanceBefore,
      aTokenBalanceAfterAtomic: balanceAfter,
      increaseAtomic: increase,
    }),
    consumed: record.consumed,
  });
}

export function parseEvmPublicTestnetPositionSnapshot(
  value: unknown,
  expectedRequest: EvmPublicTestnetPositionRequest,
): EvmPublicTestnetPositionSnapshot {
  const expected = validateEvmPublicTestnetPositionRequest(expectedRequest);
  const record = exactRecord(value, [
    'use',
    'mayAuthorizeFinancialAction',
    'chainId',
    'account',
    'provider',
    'position',
    'rate',
    'liveObservation',
  ]);
  if (
    record.use !== 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION' ||
    record.mayAuthorizeFinancialAction !== false ||
    record.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID ||
    normalizeEvmPublicTestnetAccount(record.account) !== expected.account
  ) {
    return fail();
  }

  const provider = exactRecord(record.provider, [
    'name',
    'pool',
    'addressesProvider',
    'dataProvider',
    'gateway',
    'reserve',
    'aToken',
  ]);
  if (
    provider.name !== 'Aave V3' ||
    !sameAddress(provider.pool, EVM_PUBLIC_TESTNET_POOL) ||
    !sameAddress(provider.addressesProvider, EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER) ||
    !sameAddress(provider.dataProvider, EVM_PUBLIC_TESTNET_DATA_PROVIDER) ||
    !sameAddress(provider.gateway, EVM_PUBLIC_TESTNET_GATEWAY) ||
    !sameAddress(provider.reserve, EVM_PUBLIC_TESTNET_RESERVE) ||
    !sameAddress(provider.aToken, EVM_PUBLIC_TESTNET_ATOKEN)
  ) {
    return fail();
  }

  const position = exactRecord(record.position, [
    'status',
    'assetSymbol',
    'assetDecimals',
    'suppliedLiquidityAtomic',
    'aTokenSymbol',
    'aTokenBalanceAtomic',
    'aTokenDecimals',
  ]);
  const suppliedLiquidityAtomic = decimal(position.suppliedLiquidityAtomic);
  const aTokenBalanceAtomic = decimal(position.aTokenBalanceAtomic);
  if (
    (position.status !== 'OPEN' && position.status !== 'EMPTY') ||
    position.assetSymbol !== 'ETH' ||
    position.assetDecimals !== 18 ||
    position.aTokenSymbol !== 'aBaseSepoliaWETH' ||
    position.aTokenDecimals !== 18 ||
    suppliedLiquidityAtomic !== aTokenBalanceAtomic ||
    (position.status === 'OPEN') !== BigInt(aTokenBalanceAtomic) > 0n
  ) {
    return fail();
  }

  const rate = exactRecord(record.rate, [
    'kind',
    'liquidityRateRay',
    'supplyApyBasisPoints',
    'variable',
    'rewardsIncluded',
    'riskAssessed',
    'historyAvailable',
  ]);
  const liquidityRateRay = decimal(rate.liquidityRateRay);
  if (
    rate.kind !== 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY' ||
    !Number.isSafeInteger(rate.supplyApyBasisPoints) ||
    (rate.supplyApyBasisPoints as number) < 0 ||
    (rate.supplyApyBasisPoints as number) > 10_000_000 ||
    rate.variable !== true ||
    rate.rewardsIncluded !== false ||
    rate.riskAssessed !== false ||
    rate.historyAvailable !== false
  ) {
    return fail();
  }

  const observation = exactRecord(record.liveObservation, [
    'confirmation',
    'blockNumber',
    'blockHash',
    'finalizedBlockNumber',
    'finalizedBlockHash',
    'observedAt',
  ]);
  const blockNumber = decimal(observation.blockNumber);
  const finalizedBlockNumber = decimal(observation.finalizedBlockNumber);
  if (
    observation.confirmation !== 'LATEST_POSITION_OBSERVATION' ||
    BigInt(finalizedBlockNumber) > BigInt(blockNumber)
  ) {
    return fail();
  }

  return Object.freeze({
    use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION' as const,
    mayAuthorizeFinancialAction: false as const,
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: expected.account,
    provider: Object.freeze({
      name: 'Aave V3' as const,
      pool: EVM_PUBLIC_TESTNET_POOL,
      addressesProvider: EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
      dataProvider: EVM_PUBLIC_TESTNET_DATA_PROVIDER,
      gateway: EVM_PUBLIC_TESTNET_GATEWAY,
      reserve: EVM_PUBLIC_TESTNET_RESERVE,
      aToken: EVM_PUBLIC_TESTNET_ATOKEN,
    }),
    position: Object.freeze({
      status: position.status as 'OPEN' | 'EMPTY',
      assetSymbol: 'ETH' as const,
      assetDecimals: 18 as const,
      suppliedLiquidityAtomic,
      aTokenSymbol: 'aBaseSepoliaWETH' as const,
      aTokenBalanceAtomic,
      aTokenDecimals: 18 as const,
    }),
    rate: Object.freeze({
      kind: 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY' as const,
      liquidityRateRay,
      supplyApyBasisPoints: rate.supplyApyBasisPoints as number,
      variable: true as const,
      rewardsIncluded: false as const,
      riskAssessed: false as const,
      historyAvailable: false as const,
    }),
    liveObservation: Object.freeze({
      confirmation: 'LATEST_POSITION_OBSERVATION' as const,
      blockNumber,
      blockHash: canonicalHash(observation.blockHash),
      finalizedBlockNumber,
      finalizedBlockHash: canonicalHash(observation.finalizedBlockHash),
      observedAt: dateTime(observation.observedAt),
    }),
  });
}

export function evmPublicTestnetExplorerTransactionUrl(transactionHashValue: unknown): string {
  return `${EVM_PUBLIC_TESTNET_EXPLORER_TRANSACTION_BASE}${parseEvmPublicTestnetTransactionHash(transactionHashValue)}`;
}

export function evmPublicTestnetPreviewRequest(
  preview: LocalDemoAllocationPreview,
  account: string,
): EvmPublicTestnetExecutionRequest {
  if (preview.selection.presetId !== 'BALANCED') return fail();
  return validateEvmPublicTestnetExecutionRequest({
    portfolioSnapshotId: preview.portfolioSnapshotId,
    selection: {
      kind: 'PRESET',
      presetId: 'BALANCED',
      liquidReserveBasisPoints: preview.selection.liquidReserveBasisPoints,
    },
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account,
  });
}
