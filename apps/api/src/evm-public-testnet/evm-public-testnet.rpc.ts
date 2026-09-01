import { Inject, Injectable } from '@nestjs/common';
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from 'viem';

import {
  EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
  EVM_PUBLIC_TESTNET_APPROVAL_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_AWETH,
  EVM_PUBLIC_TESTNET_CHAIN_NUMBER,
  EVM_PUBLIC_TESTNET_DATA_PROVIDER,
  EVM_PUBLIC_TESTNET_MAX_LOG_BLOCK_RANGE,
  EVM_PUBLIC_TESTNET_MAX_LOG_CANDIDATES,
  EVM_PUBLIC_TESTNET_MAX_UINT256,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_SUPPLY_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_TRANSFER_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_WETH_WITHDRAWAL_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_WETH,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
  EVM_PUBLIC_TESTNET_WITHDRAW_EVENT_TOPIC,
  evmPublicTestnetAddressTopic,
  evmPublicTestnetUintTopic,
} from './evm-public-testnet.constants';
import {
  EVM_PUBLIC_TESTNET_EXECUTION_CONFIG,
  type EvmPublicTestnetExecutionConfig,
} from './evm-public-testnet.config';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;

const BALANCE_OF_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ALLOWANCE_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const GET_GATEWAY_POOL_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'POOL',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const GET_POOL_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getPool',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const GET_WETH_ADDRESS_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getWETHAddress',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const GET_RESERVE_TOKENS_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getReserveTokensAddresses',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'aTokenAddress', type: 'address' },
      { name: 'stableDebtTokenAddress', type: 'address' },
      { name: 'variableDebtTokenAddress', type: 'address' },
    ],
  },
] as const;

const GET_RESERVE_DATA_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getReserveData',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'unbacked', type: 'uint256' },
      { name: 'accruedToTreasuryScaled', type: 'uint256' },
      { name: 'totalAToken', type: 'uint256' },
      { name: 'totalStableDebt', type: 'uint256' },
      { name: 'totalVariableDebt', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'variableBorrowRate', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'averageStableBorrowRate', type: 'uint256' },
      { name: 'liquidityIndex', type: 'uint256' },
      { name: 'variableBorrowIndex', type: 'uint256' },
      { name: 'lastUpdateTimestamp', type: 'uint40' },
    ],
  },
] as const;

export class EvmPublicTestnetRpcUnavailableError extends Error {}
export class EvmPublicTestnetPreflightRejectedError extends Error {}
export class EvmPublicTestnetEvidenceMismatchError extends Error {}
export class EvmPublicTestnetTransactionRevertedError extends Error {}
export class EvmPublicTestnetTransactionReplacedError extends Error {}

export interface EvmPublicTestnetTransactionExpectation {
  readonly account: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly input: Hex;
  readonly nonce: bigint;
  readonly baselineBlockNumber: bigint;
  readonly baselineBlockHash: Hex;
  readonly aTokenBalanceBeforeAtomic: bigint;
}

export interface EvmPublicTestnetPreflightObservation {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly finalizedBlockNumber: bigint;
  readonly finalizedBlockHash: Hex;
  readonly nativeBalanceWei: bigint;
  readonly nonce: bigint;
  readonly aTokenBalanceAtomic: bigint;
  readonly liquidityRateRay: bigint;
  readonly observedAt: string;
}

export interface EvmPublicTestnetPositionObservation {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly finalizedBlockNumber: bigint;
  readonly finalizedBlockHash: Hex;
  readonly aTokenBalanceAtomic: bigint;
  readonly liquidityRateRay: bigint;
  readonly observedAt: string;
}

export interface EvmPublicTestnetTransactionObservation {
  readonly status: 'PENDING' | 'CONFIRMED' | 'VERIFIED';
  readonly transactionHash: Hex | null;
  readonly blockNumber: bigint | null;
  readonly blockHash: Hex | null;
  readonly aTokenBalanceAfterAtomic: bigint | null;
  readonly increaseAtomic: bigint | null;
}

export interface EvmPublicTestnetExecutionRpc {
  preflight(account: Address): Promise<EvmPublicTestnetPreflightObservation>;
  readPosition(account: Address): Promise<EvmPublicTestnetPositionObservation>;
  observeTransaction(
    transactionHash: Hex,
    expectation: EvmPublicTestnetTransactionExpectation,
  ): Promise<EvmPublicTestnetTransactionObservation>;
  recoverTransaction(
    expectation: EvmPublicTestnetTransactionExpectation,
  ): Promise<EvmPublicTestnetTransactionObservation>;
}

export type EvmPublicTestnetWithdrawalStep = 'APPROVE_AWETH' | 'WITHDRAW_FULL_ETH';

export interface EvmPublicTestnetWithdrawalExpectation {
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly account: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly input: Hex;
  readonly nonce: bigint;
  readonly baselineBlockNumber: bigint;
  readonly baselineBlockHash: Hex;
  readonly aTokenBalanceBeforeAtomic: bigint;
  readonly allowanceBeforeAtomic: bigint;
}

export interface EvmPublicTestnetWithdrawalPreflightObservation {
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly finalizedBlockNumber: bigint;
  readonly finalizedBlockHash: Hex;
  readonly nativeBalanceWei: bigint;
  readonly nonce: bigint;
  readonly aTokenBalanceAtomic: bigint;
  readonly allowanceAtomic: bigint;
  readonly observedAt: string;
}

export interface EvmPublicTestnetWithdrawalTransactionObservation {
  readonly status: 'PENDING' | 'CONFIRMED' | 'VERIFIED';
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly transactionHash: Hex | null;
  readonly blockNumber: bigint | null;
  readonly blockHash: Hex | null;
  readonly amountAtomic: bigint | null;
  readonly aTokenBalanceAfterAtomic: bigint | null;
  readonly allowanceAfterAtomic: bigint | null;
}

export interface EvmPublicTestnetWithdrawalRpc {
  preflightWithdrawal(account: Address): Promise<EvmPublicTestnetWithdrawalPreflightObservation>;
  assertWithdrawalExecutable(account: Address, input: Hex): Promise<void>;
  observeWithdrawalTransaction(
    transactionHash: Hex,
    expectation: EvmPublicTestnetWithdrawalExpectation,
  ): Promise<EvmPublicTestnetWithdrawalTransactionObservation>;
  recoverWithdrawalTransaction(
    expectation: EvmPublicTestnetWithdrawalExpectation,
  ): Promise<EvmPublicTestnetWithdrawalTransactionObservation>;
}

export const EVM_PUBLIC_TESTNET_WITHDRAWAL_RPC = Symbol('EVM_PUBLIC_TESTNET_WITHDRAWAL_RPC');

export const EVM_PUBLIC_TESTNET_EXECUTION_RPC = Symbol('EVM_PUBLIC_TESTNET_EXECUTION_RPC');

interface RpcBlock {
  readonly number: bigint;
  readonly hash: Hex;
}

interface RpcTransaction {
  readonly hash: Hex;
  readonly from: Address;
  readonly to: Address | null;
  readonly input: Hex;
  readonly value: bigint;
  readonly nonce: bigint;
  readonly chainId: bigint;
  readonly blockNumber: bigint | null;
  readonly blockHash: Hex | null;
}

interface RpcLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly transactionHash: Hex;
}

interface RpcReceipt {
  readonly transactionHash: Hex;
  readonly from: Address;
  readonly to: Address | null;
  readonly status: bigint;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly logs: readonly RpcLog[];
}

function unavailable(): never {
  throw new EvmPublicTestnetRpcUnavailableError();
}

function mismatch(): never {
  throw new EvmPublicTestnetEvidenceMismatchError();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !QUANTITY_PATTERN.test(value)) return unavailable();
  try {
    return BigInt(value);
  } catch {
    return unavailable();
  }
}

function hash(value: unknown): Hex {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) return unavailable();
  return value.toLowerCase() as Hex;
}

function hexData(value: unknown): Hex {
  if (typeof value !== 'string' || !isHex(value) || value.length % 2 !== 0) return unavailable();
  return value.toLowerCase() as Hex;
}

function address(value: unknown): Address {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value) || !isAddress(value)) {
    return unavailable();
  }
  return getAddress(value);
}

function nullableAddress(value: unknown): Address | null {
  return value === null ? null : address(value);
}

function block(value: unknown): RpcBlock {
  const candidate = record(value);
  return Object.freeze({ number: quantity(candidate.number), hash: hash(candidate.hash) });
}

function transaction(value: unknown): RpcTransaction | null {
  if (value === null) return null;
  const candidate = record(value);
  return Object.freeze({
    hash: hash(candidate.hash),
    from: address(candidate.from),
    to: nullableAddress(candidate.to),
    input: hexData(candidate.input),
    value: quantity(candidate.value),
    nonce: quantity(candidate.nonce),
    chainId: quantity(candidate.chainId),
    blockNumber: candidate.blockNumber === null ? null : quantity(candidate.blockNumber),
    blockHash: candidate.blockHash === null ? null : hash(candidate.blockHash),
  });
}

function log(value: unknown): RpcLog {
  const candidate = record(value);
  if (!Array.isArray(candidate.topics)) return unavailable();
  return Object.freeze({
    address: address(candidate.address),
    topics: Object.freeze(candidate.topics.map((topic) => hash(topic))),
    data: hexData(candidate.data),
    transactionHash: hash(candidate.transactionHash),
  });
}

function receipt(value: unknown): RpcReceipt | null {
  if (value === null) return null;
  const candidate = record(value);
  if (!Array.isArray(candidate.logs)) return unavailable();
  return Object.freeze({
    transactionHash: hash(candidate.transactionHash),
    from: address(candidate.from),
    to: nullableAddress(candidate.to),
    status: quantity(candidate.status),
    blockNumber: quantity(candidate.blockNumber),
    blockHash: hash(candidate.blockHash),
    logs: Object.freeze(candidate.logs.map((entry) => log(entry))),
  });
}

function sameAddress(left: Address | null, right: Address): boolean {
  return left !== null && left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

type ExactTransactionExpectation = Readonly<
  Pick<EvmPublicTestnetTransactionExpectation, 'account' | 'to' | 'value' | 'input' | 'nonce'>
>;

function assertTransactionMatches(
  candidate: RpcTransaction,
  expectation: ExactTransactionExpectation,
): void {
  if (
    !sameAddress(candidate.from, expectation.account) ||
    !sameAddress(candidate.to, expectation.to) ||
    candidate.value !== expectation.value ||
    !sameHex(candidate.input, expectation.input) ||
    candidate.nonce !== expectation.nonce ||
    candidate.chainId !== EVM_PUBLIC_TESTNET_CHAIN_NUMBER
  ) {
    return mismatch();
  }
}

function transactionMatches(
  candidate: RpcTransaction,
  expectation: ExactTransactionExpectation,
): boolean {
  try {
    assertTransactionMatches(candidate, expectation);
    return true;
  } catch (error) {
    if (error instanceof EvmPublicTestnetEvidenceMismatchError) return false;
    throw error;
  }
}

function isExpectedSupplyLog(entry: RpcLog, account: Address): boolean {
  if (
    !sameAddress(entry.address, EVM_PUBLIC_TESTNET_POOL) ||
    entry.topics.length !== 4 ||
    !sameHex(entry.topics[0] as Hex, EVM_PUBLIC_TESTNET_SUPPLY_EVENT_TOPIC) ||
    !sameHex(entry.topics[1] as Hex, evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH)) ||
    !sameHex(entry.topics[2] as Hex, evmPublicTestnetAddressTopic(account)) ||
    !sameHex(entry.topics[3] as Hex, evmPublicTestnetUintTopic(0n)) ||
    entry.data.length !== 130
  ) {
    return false;
  }
  try {
    const user = getAddress(`0x${entry.data.slice(26, 66)}`);
    const amount = BigInt(`0x${entry.data.slice(66, 130)}`);
    return (
      sameAddress(user, EVM_PUBLIC_TESTNET_WETH_GATEWAY) &&
      amount === EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI
    );
  } catch {
    return false;
  }
}

function singleUintData(entry: RpcLog): bigint | null {
  if (entry.data.length !== 66) return null;
  try {
    return BigInt(entry.data);
  } catch {
    return null;
  }
}

function isExpectedApprovalLog(entry: RpcLog, account: Address): boolean {
  return (
    sameAddress(entry.address, EVM_PUBLIC_TESTNET_AWETH) &&
    entry.topics.length === 3 &&
    sameHex(entry.topics[0] as Hex, EVM_PUBLIC_TESTNET_APPROVAL_EVENT_TOPIC) &&
    sameHex(entry.topics[1] as Hex, evmPublicTestnetAddressTopic(account)) &&
    sameHex(
      entry.topics[2] as Hex,
      evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
    ) &&
    singleUintData(entry) === EVM_PUBLIC_TESTNET_MAX_UINT256
  );
}

function withdrawalTransferAmount(entry: RpcLog, account: Address): bigint | null {
  if (
    !sameAddress(entry.address, EVM_PUBLIC_TESTNET_AWETH) ||
    entry.topics.length !== 3 ||
    !sameHex(entry.topics[0] as Hex, EVM_PUBLIC_TESTNET_TRANSFER_EVENT_TOPIC) ||
    !sameHex(entry.topics[1] as Hex, evmPublicTestnetAddressTopic(account)) ||
    !sameHex(entry.topics[2] as Hex, evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY))
  ) {
    return null;
  }
  const amount = singleUintData(entry);
  return amount !== null && amount > 0n ? amount : null;
}

function isExpectedPoolWithdrawalLog(entry: RpcLog, amount: bigint): boolean {
  return (
    sameAddress(entry.address, EVM_PUBLIC_TESTNET_POOL) &&
    entry.topics.length === 4 &&
    sameHex(entry.topics[0] as Hex, EVM_PUBLIC_TESTNET_WITHDRAW_EVENT_TOPIC) &&
    sameHex(entry.topics[1] as Hex, evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH)) &&
    sameHex(
      entry.topics[2] as Hex,
      evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
    ) &&
    sameHex(
      entry.topics[3] as Hex,
      evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
    ) &&
    singleUintData(entry) === amount
  );
}

function isExpectedWethWithdrawalLog(entry: RpcLog, amount: bigint): boolean {
  return (
    sameAddress(entry.address, EVM_PUBLIC_TESTNET_WETH) &&
    entry.topics.length === 2 &&
    sameHex(entry.topics[0] as Hex, EVM_PUBLIC_TESTNET_WETH_WITHDRAWAL_EVENT_TOPIC) &&
    sameHex(
      entry.topics[1] as Hex,
      evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
    ) &&
    singleUintData(entry) === amount
  );
}

function quantityHex(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

@Injectable()
export class FixedBaseSepoliaExecutionRpc
  implements EvmPublicTestnetExecutionRpc, EvmPublicTestnetWithdrawalRpc
{
  private requestId = 0;

  constructor(
    @Inject(EVM_PUBLIC_TESTNET_EXECUTION_CONFIG)
    private readonly config: EvmPublicTestnetExecutionConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async preflight(account: Address): Promise<EvmPublicTestnetPreflightObservation> {
    await this.assertChain();
    const [latestValue, finalizedValue] = await Promise.all([
      this.request('eth_getBlockByNumber', ['latest', false]),
      this.request('eth_getBlockByNumber', ['finalized', false]),
    ]);
    const latest = block(latestValue);
    const finalized = block(finalizedValue);
    const blockTag = quantityHex(latest.number);
    const [nativeBalance, nonce, aTokenBalance, liquidityRateRay] = await Promise.all([
      this.request('eth_getBalance', [account, blockTag]).then(quantity),
      this.request('eth_getTransactionCount', [account, 'pending']).then(quantity),
      this.readATokenBalance(account, blockTag),
      this.validateDeploymentAndReadRate(blockTag),
    ]);
    return Object.freeze({
      blockNumber: latest.number,
      blockHash: latest.hash,
      finalizedBlockNumber: finalized.number,
      finalizedBlockHash: finalized.hash,
      nativeBalanceWei: nativeBalance,
      nonce,
      aTokenBalanceAtomic: aTokenBalance,
      liquidityRateRay,
      observedAt: new Date().toISOString(),
    });
  }

  async readPosition(account: Address): Promise<EvmPublicTestnetPositionObservation> {
    await this.assertChain();
    const [latestValue, finalizedValue] = await Promise.all([
      this.request('eth_getBlockByNumber', ['latest', false]),
      this.request('eth_getBlockByNumber', ['finalized', false]),
    ]);
    const latest = block(latestValue);
    const finalized = block(finalizedValue);
    const blockTag = quantityHex(latest.number);
    const [aTokenBalanceAtomic, liquidityRateRay] = await Promise.all([
      this.readATokenBalance(account, blockTag),
      this.validateDeploymentAndReadRate(blockTag),
    ]);
    return Object.freeze({
      blockNumber: latest.number,
      blockHash: latest.hash,
      finalizedBlockNumber: finalized.number,
      finalizedBlockHash: finalized.hash,
      aTokenBalanceAtomic,
      liquidityRateRay,
      observedAt: new Date().toISOString(),
    });
  }

  async preflightWithdrawal(
    account: Address,
  ): Promise<EvmPublicTestnetWithdrawalPreflightObservation> {
    await this.assertChain();
    const [latestValue, finalizedValue] = await Promise.all([
      this.request('eth_getBlockByNumber', ['latest', false]),
      this.request('eth_getBlockByNumber', ['finalized', false]),
    ]);
    const latest = block(latestValue);
    const finalized = block(finalizedValue);
    const blockTag = quantityHex(latest.number);
    const [nativeBalanceWei, nonce, aTokenBalanceAtomic, allowanceAtomic] = await Promise.all([
      this.request('eth_getBalance', [account, blockTag]).then(quantity),
      this.request('eth_getTransactionCount', [account, 'pending']).then(quantity),
      this.readATokenBalance(account, blockTag),
      this.readATokenAllowance(account, blockTag),
      this.validateWithdrawalDeployment(blockTag),
    ]);
    return Object.freeze({
      blockNumber: latest.number,
      blockHash: latest.hash,
      finalizedBlockNumber: finalized.number,
      finalizedBlockHash: finalized.hash,
      nativeBalanceWei,
      nonce,
      aTokenBalanceAtomic,
      allowanceAtomic,
      observedAt: new Date().toISOString(),
    });
  }

  async assertWithdrawalExecutable(account: Address, input: Hex): Promise<void> {
    await this.assertChain();
    try {
      const result = hexData(
        await this.request('eth_call', [
          { from: account, to: EVM_PUBLIC_TESTNET_WETH_GATEWAY, value: '0x0', data: input },
          'latest',
        ]),
      );
      if (result !== '0x') return mismatch();
    } catch (error) {
      if (
        error instanceof EvmPublicTestnetRpcUnavailableError ||
        error instanceof EvmPublicTestnetEvidenceMismatchError
      ) {
        throw error;
      }
      return unavailable();
    }
  }

  async observeTransaction(
    transactionHash: Hex,
    expectation: EvmPublicTestnetTransactionExpectation,
  ): Promise<EvmPublicTestnetTransactionObservation> {
    await this.assertChain();
    return this.observeKnownTransaction(transactionHash, expectation, true);
  }

  private async observeKnownTransaction(
    transactionHash: Hex,
    expectation: EvmPublicTestnetTransactionExpectation,
    recoverMissing: boolean,
  ): Promise<EvmPublicTestnetTransactionObservation> {
    const candidate = transaction(
      await this.request('eth_getTransactionByHash', [transactionHash]),
    );
    if (candidate === null) {
      return recoverMissing
        ? this.recoverMissingKnownTransaction(transactionHash, expectation)
        : this.pending(transactionHash);
    }
    if (!sameHex(candidate.hash, transactionHash)) return mismatch();
    assertTransactionMatches(candidate, expectation);
    const observedReceipt = receipt(
      await this.request('eth_getTransactionReceipt', [transactionHash]),
    );
    if (observedReceipt === null) {
      return recoverMissing
        ? this.recoverMissingKnownTransaction(transactionHash, expectation)
        : this.pending(transactionHash);
    }
    if (
      !sameHex(observedReceipt.transactionHash, transactionHash) ||
      !sameAddress(observedReceipt.from, expectation.account) ||
      !sameAddress(observedReceipt.to, expectation.to)
    ) {
      return mismatch();
    }
    if (observedReceipt.status === 0n) throw new EvmPublicTestnetTransactionRevertedError();
    if (observedReceipt.status !== 1n) return mismatch();
    if (
      !observedReceipt.logs.some(
        (entry) =>
          sameHex(entry.transactionHash, transactionHash) &&
          isExpectedSupplyLog(entry, expectation.account),
      )
    ) {
      return mismatch();
    }
    const [canonicalValue, baselineValue, finalizedValue, aTokenBalanceAfterAtomic] =
      await Promise.all([
        this.request('eth_getBlockByNumber', [quantityHex(observedReceipt.blockNumber), false]),
        this.request('eth_getBlockByNumber', [quantityHex(expectation.baselineBlockNumber), false]),
        this.request('eth_getBlockByNumber', ['finalized', false]),
        this.readATokenBalance(expectation.account, quantityHex(observedReceipt.blockNumber)),
      ]);
    const canonical = block(canonicalValue);
    const baseline = block(baselineValue);
    const finalized = block(finalizedValue);
    if (
      canonical.number !== observedReceipt.blockNumber ||
      !sameHex(canonical.hash, observedReceipt.blockHash) ||
      baseline.number !== expectation.baselineBlockNumber ||
      !sameHex(baseline.hash, expectation.baselineBlockHash) ||
      candidate.blockNumber !== observedReceipt.blockNumber ||
      candidate.blockHash === null ||
      !sameHex(candidate.blockHash, observedReceipt.blockHash)
    ) {
      return mismatch();
    }
    if (aTokenBalanceAfterAtomic <= expectation.aTokenBalanceBeforeAtomic) return mismatch();
    const increaseAtomic = aTokenBalanceAfterAtomic - expectation.aTokenBalanceBeforeAtomic;
    return Object.freeze({
      status:
        observedReceipt.blockNumber <= finalized.number
          ? ('VERIFIED' as const)
          : ('CONFIRMED' as const),
      transactionHash,
      blockNumber: observedReceipt.blockNumber,
      blockHash: observedReceipt.blockHash,
      aTokenBalanceAfterAtomic,
      increaseAtomic,
    });
  }

  async recoverTransaction(
    expectation: EvmPublicTestnetTransactionExpectation,
  ): Promise<EvmPublicTestnetTransactionObservation> {
    await this.assertChain();
    const [latestValue, baselineValue, finalizedNonceValue] = await Promise.all([
      this.request('eth_getBlockByNumber', ['latest', false]),
      this.request('eth_getBlockByNumber', [quantityHex(expectation.baselineBlockNumber), false]),
      this.request('eth_getTransactionCount', [expectation.account, 'finalized']),
    ]);
    const latest = block(latestValue);
    const baseline = block(baselineValue);
    if (
      baseline.number !== expectation.baselineBlockNumber ||
      !sameHex(baseline.hash, expectation.baselineBlockHash) ||
      latest.number < expectation.baselineBlockNumber ||
      latest.number - expectation.baselineBlockNumber > EVM_PUBLIC_TESTNET_MAX_LOG_BLOCK_RANGE
    ) {
      return unavailable();
    }
    const logsValue = await this.request('eth_getLogs', [
      {
        address: EVM_PUBLIC_TESTNET_POOL,
        fromBlock: quantityHex(expectation.baselineBlockNumber),
        toBlock: quantityHex(latest.number),
        topics: [
          EVM_PUBLIC_TESTNET_SUPPLY_EVENT_TOPIC,
          evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH),
          evmPublicTestnetAddressTopic(expectation.account),
          evmPublicTestnetUintTopic(0n),
        ],
      },
    ]);
    if (!Array.isArray(logsValue) || logsValue.length > EVM_PUBLIC_TESTNET_MAX_LOG_CANDIDATES) {
      return unavailable();
    }
    const candidateHashes = [
      ...new Set(
        logsValue
          .map((entry) => log(entry))
          .filter((entry) => isExpectedSupplyLog(entry, expectation.account))
          .map((entry) => entry.transactionHash),
      ),
    ];
    for (const candidateHash of candidateHashes) {
      const candidate = transaction(
        await this.request('eth_getTransactionByHash', [candidateHash]),
      );
      if (candidate !== null && transactionMatches(candidate, expectation)) {
        return this.observeKnownTransaction(candidateHash, expectation, false);
      }
    }
    if (quantity(finalizedNonceValue) > expectation.nonce) {
      throw new EvmPublicTestnetTransactionReplacedError();
    }
    return this.pending(null);
  }

  async observeWithdrawalTransaction(
    transactionHash: Hex,
    expectation: EvmPublicTestnetWithdrawalExpectation,
  ): Promise<EvmPublicTestnetWithdrawalTransactionObservation> {
    await this.assertChain();
    return this.observeKnownWithdrawalTransaction(transactionHash, expectation, true);
  }

  async recoverWithdrawalTransaction(
    expectation: EvmPublicTestnetWithdrawalExpectation,
  ): Promise<EvmPublicTestnetWithdrawalTransactionObservation> {
    await this.assertChain();
    const [latestValue, baselineValue, finalizedNonceValue] = await Promise.all([
      this.request('eth_getBlockByNumber', ['latest', false]),
      this.request('eth_getBlockByNumber', [quantityHex(expectation.baselineBlockNumber), false]),
      this.request('eth_getTransactionCount', [expectation.account, 'finalized']),
    ]);
    const latest = block(latestValue);
    const baseline = block(baselineValue);
    if (
      baseline.number !== expectation.baselineBlockNumber ||
      !sameHex(baseline.hash, expectation.baselineBlockHash) ||
      latest.number < expectation.baselineBlockNumber ||
      latest.number - expectation.baselineBlockNumber > EVM_PUBLIC_TESTNET_MAX_LOG_BLOCK_RANGE
    ) {
      return unavailable();
    }
    const topics =
      expectation.step === 'APPROVE_AWETH'
        ? [
            EVM_PUBLIC_TESTNET_APPROVAL_EVENT_TOPIC,
            evmPublicTestnetAddressTopic(expectation.account),
            evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
          ]
        : [
            EVM_PUBLIC_TESTNET_TRANSFER_EVENT_TOPIC,
            evmPublicTestnetAddressTopic(expectation.account),
            evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
          ];
    const logsValue = await this.request('eth_getLogs', [
      {
        address: EVM_PUBLIC_TESTNET_AWETH,
        fromBlock: quantityHex(expectation.baselineBlockNumber),
        toBlock: quantityHex(latest.number),
        topics,
      },
    ]);
    if (!Array.isArray(logsValue) || logsValue.length > EVM_PUBLIC_TESTNET_MAX_LOG_CANDIDATES) {
      return unavailable();
    }
    const candidateHashes = [
      ...new Set(
        logsValue
          .map((entry) => log(entry))
          .filter((entry) =>
            expectation.step === 'APPROVE_AWETH'
              ? isExpectedApprovalLog(entry, expectation.account)
              : withdrawalTransferAmount(entry, expectation.account) !== null,
          )
          .map((entry) => entry.transactionHash),
      ),
    ];
    for (const candidateHash of candidateHashes) {
      const candidate = transaction(
        await this.request('eth_getTransactionByHash', [candidateHash]),
      );
      if (candidate !== null && transactionMatches(candidate, expectation)) {
        return this.observeKnownWithdrawalTransaction(candidateHash, expectation, false);
      }
    }
    if (quantity(finalizedNonceValue) > expectation.nonce) {
      throw new EvmPublicTestnetTransactionReplacedError();
    }
    return this.pendingWithdrawal(expectation.step, null);
  }

  private async observeKnownWithdrawalTransaction(
    transactionHash: Hex,
    expectation: EvmPublicTestnetWithdrawalExpectation,
    recoverMissing: boolean,
  ): Promise<EvmPublicTestnetWithdrawalTransactionObservation> {
    const candidate = transaction(
      await this.request('eth_getTransactionByHash', [transactionHash]),
    );
    if (candidate === null) {
      return recoverMissing
        ? this.recoverMissingKnownWithdrawalTransaction(transactionHash, expectation)
        : this.pendingWithdrawal(expectation.step, transactionHash);
    }
    if (!sameHex(candidate.hash, transactionHash)) return mismatch();
    assertTransactionMatches(candidate, expectation);
    const observedReceipt = receipt(
      await this.request('eth_getTransactionReceipt', [transactionHash]),
    );
    if (observedReceipt === null) {
      return recoverMissing
        ? this.recoverMissingKnownWithdrawalTransaction(transactionHash, expectation)
        : this.pendingWithdrawal(expectation.step, transactionHash);
    }
    if (
      !sameHex(observedReceipt.transactionHash, transactionHash) ||
      !sameAddress(observedReceipt.from, expectation.account) ||
      !sameAddress(observedReceipt.to, expectation.to)
    ) {
      return mismatch();
    }
    if (observedReceipt.status === 0n) throw new EvmPublicTestnetTransactionRevertedError();
    if (observedReceipt.status !== 1n) return mismatch();

    let amountAtomic: bigint;
    if (expectation.step === 'APPROVE_AWETH') {
      const approvals = observedReceipt.logs.filter(
        (entry) =>
          sameHex(entry.transactionHash, transactionHash) &&
          isExpectedApprovalLog(entry, expectation.account),
      );
      if (approvals.length !== 1) {
        return mismatch();
      }
      amountAtomic = EVM_PUBLIC_TESTNET_MAX_UINT256;
    } else {
      const transferAmounts = observedReceipt.logs
        .filter((entry) => sameHex(entry.transactionHash, transactionHash))
        .map((entry) => withdrawalTransferAmount(entry, expectation.account))
        .filter((amount): amount is bigint => amount !== null);
      if (transferAmounts.length !== 1) return mismatch();
      amountAtomic = transferAmounts[0] as bigint;
      const poolWithdrawals = observedReceipt.logs.filter(
        (entry) =>
          sameHex(entry.transactionHash, transactionHash) &&
          isExpectedPoolWithdrawalLog(entry, amountAtomic),
      );
      const wethWithdrawals = observedReceipt.logs.filter(
        (entry) =>
          sameHex(entry.transactionHash, transactionHash) &&
          isExpectedWethWithdrawalLog(entry, amountAtomic),
      );
      if (poolWithdrawals.length !== 1 || wethWithdrawals.length !== 1) {
        return mismatch();
      }
    }

    const blockTag = quantityHex(observedReceipt.blockNumber);
    const [
      canonicalValue,
      baselineValue,
      finalizedValue,
      aTokenBalanceAfterAtomic,
      allowanceAfterAtomic,
    ] = await Promise.all([
      this.request('eth_getBlockByNumber', [blockTag, false]),
      this.request('eth_getBlockByNumber', [quantityHex(expectation.baselineBlockNumber), false]),
      this.request('eth_getBlockByNumber', ['finalized', false]),
      this.readATokenBalance(expectation.account, blockTag),
      this.readATokenAllowance(expectation.account, blockTag),
    ]);
    const canonical = block(canonicalValue);
    const baseline = block(baselineValue);
    const finalized = block(finalizedValue);
    if (
      canonical.number !== observedReceipt.blockNumber ||
      !sameHex(canonical.hash, observedReceipt.blockHash) ||
      baseline.number !== expectation.baselineBlockNumber ||
      !sameHex(baseline.hash, expectation.baselineBlockHash) ||
      candidate.blockNumber !== observedReceipt.blockNumber ||
      candidate.blockHash === null ||
      !sameHex(candidate.blockHash, observedReceipt.blockHash)
    ) {
      return mismatch();
    }
    if (
      (expectation.step === 'APPROVE_AWETH' &&
        allowanceAfterAtomic !== EVM_PUBLIC_TESTNET_MAX_UINT256) ||
      (expectation.step === 'WITHDRAW_FULL_ETH' &&
        (aTokenBalanceAfterAtomic !== 0n || amountAtomic < expectation.aTokenBalanceBeforeAtomic))
    ) {
      return mismatch();
    }
    return Object.freeze({
      status:
        observedReceipt.blockNumber <= finalized.number
          ? ('VERIFIED' as const)
          : ('CONFIRMED' as const),
      step: expectation.step,
      transactionHash,
      blockNumber: observedReceipt.blockNumber,
      blockHash: observedReceipt.blockHash,
      amountAtomic,
      aTokenBalanceAfterAtomic,
      allowanceAfterAtomic,
    });
  }

  private async recoverMissingKnownWithdrawalTransaction(
    originalHash: Hex,
    expectation: EvmPublicTestnetWithdrawalExpectation,
  ): Promise<EvmPublicTestnetWithdrawalTransactionObservation> {
    const recovered = await this.recoverWithdrawalTransaction(expectation);
    return recovered.status === 'PENDING' && recovered.transactionHash === null
      ? this.pendingWithdrawal(expectation.step, originalHash)
      : recovered;
  }

  private async recoverMissingKnownTransaction(
    originalHash: Hex,
    expectation: EvmPublicTestnetTransactionExpectation,
  ): Promise<EvmPublicTestnetTransactionObservation> {
    const recovered = await this.recoverTransaction(expectation);
    return recovered.status === 'PENDING' && recovered.transactionHash === null
      ? this.pending(originalHash)
      : recovered;
  }

  private pending(transactionHash: Hex | null): EvmPublicTestnetTransactionObservation {
    return Object.freeze({
      status: 'PENDING' as const,
      transactionHash,
      blockNumber: null,
      blockHash: null,
      aTokenBalanceAfterAtomic: null,
      increaseAtomic: null,
    });
  }

  private pendingWithdrawal(
    step: EvmPublicTestnetWithdrawalStep,
    transactionHash: Hex | null,
  ): EvmPublicTestnetWithdrawalTransactionObservation {
    return Object.freeze({
      status: 'PENDING' as const,
      step,
      transactionHash,
      blockNumber: null,
      blockHash: null,
      amountAtomic: null,
      aTokenBalanceAfterAtomic: null,
      allowanceAfterAtomic: null,
    });
  }

  private async assertChain(): Promise<void> {
    const chainId = await this.request('eth_chainId', []);
    if (
      typeof chainId !== 'string' ||
      !QUANTITY_PATTERN.test(chainId) ||
      BigInt(chainId) !== EVM_PUBLIC_TESTNET_CHAIN_NUMBER ||
      chainId.toLowerCase() !== EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID
    ) {
      throw new EvmPublicTestnetPreflightRejectedError();
    }
  }

  private async readATokenBalance(account: Address, blockTag: Hex): Promise<bigint> {
    const data = encodeFunctionData({
      abi: BALANCE_OF_ABI,
      functionName: 'balanceOf',
      args: [account],
    });
    const result = hexData(
      await this.request('eth_call', [{ to: EVM_PUBLIC_TESTNET_AWETH, data }, blockTag]),
    );
    try {
      return decodeFunctionResult({ abi: BALANCE_OF_ABI, functionName: 'balanceOf', data: result });
    } catch {
      return unavailable();
    }
  }

  private async readATokenAllowance(account: Address, blockTag: Hex): Promise<bigint> {
    const data = encodeFunctionData({
      abi: ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [account, EVM_PUBLIC_TESTNET_WETH_GATEWAY],
    });
    const result = hexData(
      await this.request('eth_call', [{ to: EVM_PUBLIC_TESTNET_AWETH, data }, blockTag]),
    );
    try {
      return decodeFunctionResult({ abi: ALLOWANCE_ABI, functionName: 'allowance', data: result });
    } catch {
      return unavailable();
    }
  }

  private async validateWithdrawalDeployment(blockTag: Hex): Promise<void> {
    await this.validateDeploymentAndReadRate(blockTag);
    const data = encodeFunctionData({ abi: GET_GATEWAY_POOL_ABI, functionName: 'POOL' });
    const result = hexData(
      await this.request('eth_call', [{ to: EVM_PUBLIC_TESTNET_WETH_GATEWAY, data }, blockTag]),
    );
    try {
      const configuredPool = decodeFunctionResult({
        abi: GET_GATEWAY_POOL_ABI,
        functionName: 'POOL',
        data: result,
      });
      if (!sameAddress(configuredPool, EVM_PUBLIC_TESTNET_POOL)) {
        throw new EvmPublicTestnetPreflightRejectedError();
      }
    } catch (error) {
      if (error instanceof EvmPublicTestnetPreflightRejectedError) throw error;
      return unavailable();
    }
  }

  private async validateDeploymentAndReadRate(blockTag: Hex): Promise<bigint> {
    const contracts = [
      EVM_PUBLIC_TESTNET_POOL,
      EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
      EVM_PUBLIC_TESTNET_DATA_PROVIDER,
      EVM_PUBLIC_TESTNET_WETH_GATEWAY,
      EVM_PUBLIC_TESTNET_WETH,
      EVM_PUBLIC_TESTNET_AWETH,
    ] as const;
    const getPoolData = encodeFunctionData({ abi: GET_POOL_ABI, functionName: 'getPool' });
    const getWethData = encodeFunctionData({
      abi: GET_WETH_ADDRESS_ABI,
      functionName: 'getWETHAddress',
    });
    const getTokensData = encodeFunctionData({
      abi: GET_RESERVE_TOKENS_ABI,
      functionName: 'getReserveTokensAddresses',
      args: [EVM_PUBLIC_TESTNET_WETH],
    });
    const getReserveData = encodeFunctionData({
      abi: GET_RESERVE_DATA_ABI,
      functionName: 'getReserveData',
      args: [EVM_PUBLIC_TESTNET_WETH],
    });
    const [codes, poolResult, wethResult, tokensResult, reserveResult] = await Promise.all([
      Promise.all(contracts.map((contract) => this.request('eth_getCode', [contract, blockTag]))),
      this.request('eth_call', [
        { to: EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER, data: getPoolData },
        blockTag,
      ]),
      this.request('eth_call', [
        { to: EVM_PUBLIC_TESTNET_WETH_GATEWAY, data: getWethData },
        blockTag,
      ]),
      this.request('eth_call', [
        { to: EVM_PUBLIC_TESTNET_DATA_PROVIDER, data: getTokensData },
        blockTag,
      ]),
      this.request('eth_call', [
        { to: EVM_PUBLIC_TESTNET_DATA_PROVIDER, data: getReserveData },
        blockTag,
      ]),
    ]);
    if (codes.some((code) => hexData(code) === '0x')) {
      throw new EvmPublicTestnetPreflightRejectedError();
    }
    try {
      const configuredPool = decodeFunctionResult({
        abi: GET_POOL_ABI,
        functionName: 'getPool',
        data: hexData(poolResult),
      });
      const configuredWeth = decodeFunctionResult({
        abi: GET_WETH_ADDRESS_ABI,
        functionName: 'getWETHAddress',
        data: hexData(wethResult),
      });
      const reserveTokens = decodeFunctionResult({
        abi: GET_RESERVE_TOKENS_ABI,
        functionName: 'getReserveTokensAddresses',
        data: hexData(tokensResult),
      });
      const reserveData = decodeFunctionResult({
        abi: GET_RESERVE_DATA_ABI,
        functionName: 'getReserveData',
        data: hexData(reserveResult),
      });
      if (
        !sameAddress(configuredPool, EVM_PUBLIC_TESTNET_POOL) ||
        !sameAddress(configuredWeth, EVM_PUBLIC_TESTNET_WETH) ||
        !sameAddress(reserveTokens[0], EVM_PUBLIC_TESTNET_AWETH)
      ) {
        throw new EvmPublicTestnetPreflightRejectedError();
      }
      return reserveData[5];
    } catch (error) {
      if (error instanceof EvmPublicTestnetPreflightRejectedError) throw error;
      return unavailable();
    }
  }

  private async request(method: string, params: readonly unknown[]): Promise<unknown> {
    if (this.config.mode !== 'enabled') return unavailable();
    const allowed = new Set([
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_getBalance',
      'eth_getTransactionCount',
      'eth_getCode',
      'eth_call',
      'eth_getTransactionByHash',
      'eth_getTransactionReceipt',
      'eth_getLogs',
    ]);
    if (!allowed.has(method)) return unavailable();
    const id = ++this.requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMilliseconds);
    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(this.config.rpcEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
      } catch {
        return unavailable();
      }
      if (
        response.status !== 200 ||
        response.redirected ||
        (response.url !== '' && response.url !== this.config.rpcEndpoint)
      ) {
        return unavailable();
      }
      const declaredLength = response.headers.get('content-length');
      if (
        declaredLength !== null &&
        (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
          Number(declaredLength) > this.config.responseMaximumBytes)
      ) {
        return unavailable();
      }
      if (response.body === null) return unavailable();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > this.config.responseMaximumBytes) {
            await reader.cancel();
            return unavailable();
          }
          chunks.push(next.value);
        }
      } catch {
        return unavailable();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let envelope: Record<string, unknown>;
      try {
        envelope = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      } catch {
        return unavailable();
      }
      if (
        envelope.jsonrpc !== '2.0' ||
        envelope.id !== id ||
        'error' in envelope ||
        !('result' in envelope)
      ) {
        return unavailable();
      }
      return envelope.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}
