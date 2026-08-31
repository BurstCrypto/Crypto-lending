import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ComputeBudgetProgram, Message, PublicKey, Transaction } from '@solana/web3.js';

import {
  PUBLIC_TESTNET_ASSET_DECIMALS,
  PUBLIC_TESTNET_COLLATERAL_MINT,
  PUBLIC_TESTNET_GENESIS_HASH,
  PUBLIC_TESTNET_LENDING_MARKET,
  PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
  PUBLIC_TESTNET_LENDING_PROGRAM,
  PUBLIC_TESTNET_LENDING_PROGRAM_DATA,
  PUBLIC_TESTNET_LENDING_PROGRAM_DEPLOYMENT_SLOT,
  PUBLIC_TESTNET_LENDING_PROGRAM_UPGRADE_AUTHORITY,
  PUBLIC_TESTNET_MAX_TRANSACTION_BYTES,
  PUBLIC_TESTNET_MINIMUM_BROADCAST_REMAINING_BLOCK_HEIGHTS,
  PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC,
  PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY,
  PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
  PUBLIC_TESTNET_RPC_ENDPOINT,
  PUBLIC_TESTNET_SOL_RESERVE,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_UPGRADEABLE_LOADER,
  PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
  PUBLIC_TESTNET_WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  PUBLIC_TESTNET_WALLET_MAX_PRIORITY_FEE_LAMPORTS,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
  derivePublicTestnetAssociatedTokenAddress,
} from './public-testnet-execution.constants';
import type { PublicTestnetExecutionConfig } from './public-testnet-execution.config';

export const PUBLIC_TESTNET_EXECUTION_RPC = Symbol('PUBLIC_TESTNET_EXECUTION_RPC');

export interface PublicTestnetPreflightObservation {
  readonly slot: bigint;
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly observedAt: string;
  readonly reserveLiquidityAtomic: bigint;
  readonly nativeBalanceLamports: bigint;
  readonly collateralBalanceBeforeAtomic: bigint;
  readonly sourceLiquidityAccount: PublicKey;
  readonly destinationCollateralAccount: PublicKey;
}

export interface PublicTestnetPositionObservation {
  readonly slot: bigint;
  readonly observedAt: string;
  readonly collateralBalanceAtomic: bigint;
  readonly suppliedLiquidityAtomic: bigint;
  readonly supplyApyBasisPoints: number;
  readonly utilizationBasisPoints: number;
  readonly reserveLastUpdatedSlot: bigint;
  readonly reserveMarkedStale: boolean;
}

export interface PublicTestnetVerificationExpectation {
  readonly wallet: PublicKey;
  readonly sourceLiquidityAccount: PublicKey;
  readonly destinationCollateralAccount: PublicKey;
  readonly expectedMessageBase64: string;
  readonly preflightSlot: bigint;
  readonly lastValidBlockHeight: bigint;
}

export interface PublicTestnetSignedTransactionSubmission {
  readonly signature: string;
  readonly signedTransactionBase64: string;
}

export type PublicTestnetTransactionObservation =
  | Readonly<{ status: 'PENDING' }>
  | Readonly<{
      status: 'VERIFIED';
      slot: bigint;
      collateralBalanceBeforeAtomic: bigint;
      collateralBalanceAfterAtomic: bigint;
      increaseAtomic: bigint;
    }>;

export interface PublicTestnetExecutionRpc {
  preflight(account: PublicKey): Promise<PublicTestnetPreflightObservation>;
  readPosition(account: PublicKey): Promise<PublicTestnetPositionObservation>;
  broadcastSignedTransaction(
    submission: PublicTestnetSignedTransactionSubmission,
    expected: PublicTestnetVerificationExpectation,
  ): Promise<string>;
  verifyFinalizedDeposit(
    signature: string,
    expected: PublicTestnetVerificationExpectation,
  ): Promise<PublicTestnetTransactionObservation>;
}

export class PublicTestnetRpcUnavailableError extends Error {
  constructor() {
    super('Fixed public testnet RPC is unavailable');
    this.name = 'PublicTestnetRpcUnavailableError';
  }
}

export class PublicTestnetPreflightRejectedError extends Error {
  constructor(readonly code: 'DEPLOYMENT_MISMATCH' | 'RESERVE_UNAVAILABLE') {
    super(code);
    this.name = 'PublicTestnetPreflightRejectedError';
  }
}

export class PublicTestnetEvidenceMismatchError extends Error {
  constructor() {
    super('Submitted transaction evidence does not match the fixed intent');
    this.name = 'PublicTestnetEvidenceMismatchError';
  }
}

export class PublicTestnetBroadcastRejectedError extends Error {
  constructor() {
    super('Fixed public testnet RPC rejected the signed transaction');
    this.name = 'PublicTestnetBroadcastRejectedError';
  }
}

export class PublicTestnetBroadcastAmbiguousError extends Error {
  constructor() {
    super('Fixed public testnet RPC did not return a conclusive broadcast result');
    this.name = 'PublicTestnetBroadcastAmbiguousError';
  }
}

interface AccountObservation {
  readonly data: Buffer;
  readonly executable: boolean;
  readonly lamports: bigint;
  readonly owner: PublicKey;
}

interface TokenBalanceObservation {
  readonly accountIndex: number;
  readonly amount: bigint;
  readonly decimals: number;
  readonly mint: PublicKey;
  readonly owner: PublicKey;
}

const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const RESERVE_DATA_LENGTH = 619;
const LENDING_MARKET_DATA_LENGTH = 290;
const UPGRADEABLE_PROGRAM_DATA_LENGTH = 36;
const UPGRADEABLE_PROGRAM_DATA_HEADER_LENGTH = 45;
const MINT_DATA_LENGTH = 82;
const TOKEN_ACCOUNT_DATA_LENGTH = 165;
const WAD = 1_000_000_000_000_000_000n;
const SLOTS_PER_YEAR = 63_072_000;
const SET_COMPUTE_UNIT_LIMIT_TAG = 2;
const SET_COMPUTE_UNIT_PRICE_TAG = 3;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;
const FINALIZED_SIGNATURE_HISTORY_LIMIT = 100;

function unavailable(): never {
  throw new PublicTestnetRpcUnavailableError();
}

function mismatch(): never {
  throw new PublicTestnetEvidenceMismatchError();
}

function ambiguousBroadcast(): never {
  throw new PublicTestnetBroadcastAmbiguousError();
}

function matchesExpectedMessageOrAllowedWalletPrefix(
  transaction: Transaction,
  expectedMessageBase64: string,
): boolean {
  if (transaction.serializeMessage().toString('base64') === expectedMessageBase64) return true;

  const [priceInstruction, limitInstruction] = transaction.instructions;
  if (
    priceInstruction === undefined ||
    limitInstruction === undefined ||
    !priceInstruction.programId.equals(ComputeBudgetProgram.programId) ||
    priceInstruction.keys.length !== 0 ||
    priceInstruction.data.length !== 9 ||
    priceInstruction.data[0] !== SET_COMPUTE_UNIT_PRICE_TAG ||
    !limitInstruction.programId.equals(ComputeBudgetProgram.programId) ||
    limitInstruction.keys.length !== 0 ||
    limitInstruction.data.length !== 5 ||
    limitInstruction.data[0] !== SET_COMPUTE_UNIT_LIMIT_TAG
  ) {
    return false;
  }

  const computeUnitPriceMicroLamports = priceInstruction.data.readBigUInt64LE(1);
  const computeUnitLimit = limitInstruction.data.readUInt32LE(1);
  const priorityFeeLamports =
    (BigInt(computeUnitLimit) * computeUnitPriceMicroLamports + MICRO_LAMPORTS_PER_LAMPORT - 1n) /
    MICRO_LAMPORTS_PER_LAMPORT;
  if (
    computeUnitLimit !== PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT ||
    computeUnitPriceMicroLamports > PUBLIC_TESTNET_WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS ||
    priorityFeeLamports > PUBLIC_TESTNET_WALLET_MAX_PRIORITY_FEE_LAMPORTS
  ) {
    return false;
  }

  try {
    const reviewedTransaction = Transaction.populate(
      Message.from(Buffer.from(expectedMessageBase64, 'base64')),
    );
    if (
      reviewedTransaction.feePayer === undefined ||
      reviewedTransaction.recentBlockhash === undefined
    ) {
      return false;
    }
    const allowedTransaction = new Transaction({
      feePayer: reviewedTransaction.feePayer,
      recentBlockhash: reviewedTransaction.recentBlockhash,
    }).add(priceInstruction, limitInstruction, ...reviewedTransaction.instructions);
    return (
      allowedTransaction.serializeMessage().toString('base64') ===
      transaction.serializeMessage().toString('base64')
    );
  } catch {
    return false;
  }
}

function signedTransactionBytes(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !BASE64.test(value)) return mismatch();
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length === 0 ||
    bytes.length > PUBLIC_TESTNET_MAX_TRANSACTION_BYTES ||
    bytes.toString('base64') !== value
  ) {
    return mismatch();
  }
  return bytes;
}

/**
 * Validates the complete signed legacy wire transaction before the service
 * binds it to an intent. The RPC adapter repeats this check immediately before
 * its single broadcast attempt so no alternate caller can bypass it.
 */
export function assertPublicTestnetSignedTransactionMatchesIntent(
  submission: PublicTestnetSignedTransactionSubmission,
  expected: PublicTestnetVerificationExpectation,
): void {
  const serialized = signedTransactionBytes(submission.signedTransactionBase64);
  if (typeof submission.signature !== 'string') return mismatch();
  const submittedSignature = decodeBase58(submission.signature);
  if (submittedSignature.length !== 64) return mismatch();

  let transaction: Transaction;
  try {
    transaction = Transaction.from(serialized);
    const canonical = transaction.serialize({
      requireAllSignatures: true,
      verifySignatures: false,
    });
    if (!sameBytes(canonical, serialized)) return mismatch();
  } catch {
    return mismatch();
  }

  const feePayerSignature = transaction.signatures[0];
  try {
    if (
      transaction.signatures.length !== 1 ||
      feePayerSignature === undefined ||
      feePayerSignature.signature === null ||
      !feePayerSignature.publicKey.equals(expected.wallet) ||
      !transaction.feePayer?.equals(expected.wallet) ||
      !sameBytes(feePayerSignature.signature, submittedSignature) ||
      !transaction.verifySignatures() ||
      !matchesExpectedMessageOrAllowedWalletPrefix(transaction, expected.expectedMessageBase64)
    ) {
      return mismatch();
    }
  } catch {
    return mismatch();
  }
}

function exactObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return unavailable();
  return value as number;
}

function decimalInteger(value: unknown): bigint {
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) return unavailable();
  try {
    return BigInt(value);
  } catch {
    return unavailable();
  }
}

function publicKey(value: unknown): PublicKey {
  if (typeof value !== 'string' || !BASE58.test(value)) return unavailable();
  try {
    const parsed = new PublicKey(value);
    if (parsed.toBase58() !== value) return unavailable();
    return parsed;
  } catch {
    return unavailable();
  }
}

function base64Bytes(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !BASE64.test(value)) return unavailable();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return unavailable();
  return bytes;
}

function readPublicKey(data: Buffer, offset: number): PublicKey {
  if (offset < 0 || offset + 32 > data.length) return unavailable();
  return new PublicKey(data.subarray(offset, offset + 32));
}

function readU64(data: Buffer, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length) return unavailable();
  return data.readBigUInt64LE(offset);
}

function readU8(data: Buffer, offset: number): number {
  if (offset < 0 || offset >= data.length) return unavailable();
  const value = data[offset];
  return value === undefined ? unavailable() : value;
}

function readU128(data: Buffer, offset: number): bigint {
  if (offset < 0 || offset + 16 > data.length) return unavailable();
  return data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << 64n);
}

function calculateSupplyRate(
  availableLiquidityAtomic: bigint,
  borrowedLiquidityWads: bigint,
  optimalUtilizationPercent: number,
  minimumBorrowRatePercent: number,
  optimalBorrowRatePercent: number,
  maximumBorrowRatePercent: number,
  maximumUtilizationPercentRaw: number,
  superMaximumBorrowRatePercentRaw: bigint,
  protocolTakeRatePercent: number,
): Readonly<{ supplyApyBasisPoints: number; utilizationBasisPoints: number }> {
  if (superMaximumBorrowRatePercentRaw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PublicTestnetPreflightRejectedError('RESERVE_UNAVAILABLE');
  }
  const maximumUtilizationPercent = Math.max(
    maximumUtilizationPercentRaw,
    optimalUtilizationPercent,
  );
  const superMaximumBorrowRatePercent = Math.max(
    Number(superMaximumBorrowRatePercentRaw),
    maximumBorrowRatePercent,
  );
  if (
    optimalUtilizationPercent <= 0 ||
    optimalUtilizationPercent > 100 ||
    maximumUtilizationPercent > 100 ||
    minimumBorrowRatePercent > optimalBorrowRatePercent ||
    optimalBorrowRatePercent > maximumBorrowRatePercent ||
    protocolTakeRatePercent > 100
  ) {
    throw new PublicTestnetPreflightRejectedError('RESERVE_UNAVAILABLE');
  }
  const totalLiquidityWads = availableLiquidityAtomic * WAD + borrowedLiquidityWads;
  if (totalLiquidityWads <= 0n) {
    throw new PublicTestnetPreflightRejectedError('RESERVE_UNAVAILABLE');
  }
  const utilization = Number(borrowedLiquidityWads) / Number(totalLiquidityWads);
  const optimalUtilization = optimalUtilizationPercent / 100;
  const maximumUtilization = maximumUtilizationPercent / 100;
  let borrowApr: number;
  if (utilization <= optimalUtilization) {
    const normalizedUtilization = utilization / optimalUtilization;
    borrowApr =
      (minimumBorrowRatePercent +
        normalizedUtilization * (optimalBorrowRatePercent - minimumBorrowRatePercent)) /
      100;
  } else if (utilization <= maximumUtilization) {
    const normalizedUtilization =
      (utilization - optimalUtilization) / (maximumUtilization - optimalUtilization);
    borrowApr =
      (optimalBorrowRatePercent +
        normalizedUtilization * (maximumBorrowRatePercent - optimalBorrowRatePercent)) /
      100;
  } else {
    const normalizedUtilization = (utilization - maximumUtilization) / (1 - maximumUtilization);
    borrowApr =
      (maximumBorrowRatePercent +
        normalizedUtilization * (superMaximumBorrowRatePercent - maximumBorrowRatePercent)) /
      100;
  }
  const supplyApr = utilization * borrowApr * (1 - protocolTakeRatePercent / 100);
  const supplyApy = Math.pow(1 + supplyApr / SLOTS_PER_YEAR, SLOTS_PER_YEAR) - 1;
  const supplyApyBasisPoints = Math.floor(supplyApy * 10_000);
  const utilizationBasisPoints = Math.floor(utilization * 10_000);
  if (
    !Number.isSafeInteger(supplyApyBasisPoints) ||
    supplyApyBasisPoints < 0 ||
    !Number.isSafeInteger(utilizationBasisPoints) ||
    utilizationBasisPoints < 0 ||
    utilizationBasisPoints > 10_000
  ) {
    throw new PublicTestnetPreflightRejectedError('RESERVE_UNAVAILABLE');
  }
  return Object.freeze({ supplyApyBasisPoints, utilizationBasisPoints });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

function decodeBase58(value: string): Buffer {
  if (value.length === 0 || !BASE58.test(value)) return mismatch();
  const output: number[] = [0];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return mismatch();
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
  const decoded = Buffer.alloc(leadingZeroes + output.length);
  for (let index = 0; index < output.length; index += 1) {
    decoded[decoded.length - 1 - index] = output[index] ?? 0;
  }
  return decoded;
}

function parseAccount(value: unknown): AccountObservation {
  const record = exactObject(value);
  if (!Array.isArray(record.data) || record.data.length !== 2 || record.data[1] !== 'base64') {
    return unavailable();
  }
  if (typeof record.executable !== 'boolean') return unavailable();
  return Object.freeze({
    data: base64Bytes(record.data[0]),
    executable: record.executable,
    lamports: BigInt(safeInteger(record.lamports)),
    owner: publicKey(record.owner),
  });
}

function assertMint(account: AccountObservation): bigint {
  if (
    account.executable ||
    !account.owner.equals(PUBLIC_TESTNET_TOKEN_PROGRAM) ||
    account.data.length !== MINT_DATA_LENGTH ||
    account.data[44] !== PUBLIC_TESTNET_ASSET_DECIMALS ||
    account.data[45] !== 1
  ) {
    throw new PublicTestnetPreflightRejectedError('DEPLOYMENT_MISMATCH');
  }
  return readU64(account.data, 36);
}

function tokenAccount(account: AccountObservation): Readonly<{
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
}> {
  if (
    account.executable ||
    !account.owner.equals(PUBLIC_TESTNET_TOKEN_PROGRAM) ||
    account.data.length !== TOKEN_ACCOUNT_DATA_LENGTH ||
    account.data[108] !== 1
  ) {
    throw new PublicTestnetPreflightRejectedError('DEPLOYMENT_MISMATCH');
  }
  return Object.freeze({
    mint: readPublicKey(account.data, 0),
    owner: readPublicKey(account.data, 32),
    amount: readU64(account.data, 64),
  });
}

function parseTokenBalances(value: unknown): readonly TokenBalanceObservation[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) return mismatch();
  return Object.freeze(
    value.map((entry) => {
      const record = exactObject(entry);
      const ui = exactObject(record.uiTokenAmount);
      return Object.freeze({
        accountIndex: safeInteger(record.accountIndex),
        amount: decimalInteger(ui.amount),
        decimals: safeInteger(ui.decimals),
        mint: publicKey(record.mint),
        owner: publicKey(record.owner),
      });
    }),
  );
}

function findTokenBalance(
  balances: readonly TokenBalanceObservation[],
  accountIndex: number,
  mint: PublicKey,
  owner: PublicKey,
): bigint | undefined {
  const matches = balances.filter(
    (entry) =>
      entry.accountIndex === accountIndex &&
      entry.decimals === PUBLIC_TESTNET_ASSET_DECIMALS &&
      entry.mint.equals(mint) &&
      entry.owner.equals(owner),
  );
  if (matches.length > 1) return mismatch();
  return matches[0]?.amount;
}

@Injectable()
export class FixedSolanaDevnetExecutionRpc implements PublicTestnetExecutionRpc {
  private requestId = 0;

  constructor(
    private readonly config: PublicTestnetExecutionConfig,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    if (
      config.mode === 'enabled' &&
      (config.rpcEndpoint !== PUBLIC_TESTNET_RPC_ENDPOINT ||
        config.genesisHash !== PUBLIC_TESTNET_GENESIS_HASH)
    ) {
      throw new PublicTestnetRpcUnavailableError();
    }
  }

  async preflight(account: PublicKey): Promise<PublicTestnetPreflightObservation> {
    const observation = await this.observeFixedDeployment(account, true);
    return observation.preflight ?? unavailable();
  }

  async readPosition(account: PublicKey): Promise<PublicTestnetPositionObservation> {
    return (await this.observeFixedDeployment(account, false)).position;
  }

  async broadcastSignedTransaction(
    submission: PublicTestnetSignedTransactionSubmission,
    expected: PublicTestnetVerificationExpectation,
  ): Promise<string> {
    this.assertEnabled();
    assertPublicTestnetSignedTransactionMatchesIntent(submission, expected);
    if (
      expected.preflightSlot < 0n ||
      expected.preflightSlot > BigInt(Number.MAX_SAFE_INTEGER) ||
      expected.lastValidBlockHeight < 0n ||
      expected.lastValidBlockHeight > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return mismatch();
    }
    const currentBlockHeight = BigInt(
      safeInteger(
        await this.request('getBlockHeight', [
          {
            // Expiration is enforced by the leader's actively processed bank.
            // Use that fresher frontier for this conservative guard while
            // retaining confirmed for blockhash selection and preflight.
            commitment: 'processed',
            minContextSlot: Number(expected.preflightSlot),
          },
        ]),
      ),
    );
    if (
      expected.lastValidBlockHeight - currentBlockHeight <
      PUBLIC_TESTNET_MINIMUM_BROADCAST_REMAINING_BLOCK_HEIGHTS
    ) {
      throw new PublicTestnetBroadcastRejectedError();
    }
    const result = await this.sendTransactionRequest([
      submission.signedTransactionBase64,
      {
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        minContextSlot: Number(expected.preflightSlot),
      },
    ]);
    if (typeof result !== 'string' || result !== submission.signature) {
      return ambiguousBroadcast();
    }
    const returnedSignature = decodeBase58(result);
    if (returnedSignature.length !== 64) return ambiguousBroadcast();
    return result;
  }

  private async observeFixedDeployment(
    account: PublicKey,
    requireWriteReadiness: boolean,
  ): Promise<
    Readonly<{
      preflight: PublicTestnetPreflightObservation | null;
      position: PublicTestnetPositionObservation;
    }>
  > {
    this.assertEnabled();
    const [genesisResult, finalizedSlotResult] = await Promise.all([
      this.request('getGenesisHash', []),
      requireWriteReadiness
        ? this.request('getSlot', [{ commitment: 'finalized' }])
        : Promise.resolve(null),
    ]);
    if (genesisResult !== PUBLIC_TESTNET_GENESIS_HASH) {
      throw new PublicTestnetPreflightRejectedError('DEPLOYMENT_MISMATCH');
    }
    const preflightSlot =
      finalizedSlotResult === null ? null : BigInt(safeInteger(finalizedSlotResult));
    let blockhash: string | null = null;
    let lastValidBlockHeight: bigint | null = null;
    const sourceLiquidityAccount = derivePublicTestnetAssociatedTokenAddress(
      account,
      PUBLIC_TESTNET_WRAPPED_SOL_MINT,
    );
    const destinationCollateralAccount = derivePublicTestnetAssociatedTokenAddress(
      account,
      PUBLIC_TESTNET_COLLATERAL_MINT,
    );
    const addresses = [
      PUBLIC_TESTNET_LENDING_PROGRAM,
      PUBLIC_TESTNET_LENDING_MARKET,
      PUBLIC_TESTNET_SOL_RESERVE,
      PUBLIC_TESTNET_WRAPPED_SOL_MINT,
      PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
      PUBLIC_TESTNET_COLLATERAL_MINT,
      PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY,
      sourceLiquidityAccount,
      destinationCollateralAccount,
    ];
    const [accountsResult, programDataResult, balanceResult, blockTimeResult] = await Promise.all([
      this.request('getMultipleAccounts', [
        addresses.map((address) => address.toBase58()),
        {
          commitment: 'finalized',
          encoding: 'base64',
          ...(preflightSlot === null ? {} : { minContextSlot: Number(preflightSlot) }),
        },
      ]),
      this.request('getAccountInfo', [
        PUBLIC_TESTNET_LENDING_PROGRAM_DATA.toBase58(),
        {
          commitment: 'finalized',
          encoding: 'base64',
          dataSlice: { offset: 0, length: UPGRADEABLE_PROGRAM_DATA_HEADER_LENGTH },
          ...(preflightSlot === null ? {} : { minContextSlot: Number(preflightSlot) }),
        },
      ]),
      preflightSlot === null
        ? Promise.resolve(null)
        : this.request('getBalance', [
            account.toBase58(),
            { commitment: 'finalized', minContextSlot: Number(preflightSlot) },
          ]),
      preflightSlot === null
        ? Promise.resolve(null)
        : this.request('getBlockTime', [Number(preflightSlot)]),
    ]);
    const accountsEnvelope = exactObject(accountsResult);
    const accountsContext = exactObject(accountsEnvelope.context);
    const accountsContextSlot = BigInt(safeInteger(accountsContext.slot));
    if (
      (preflightSlot !== null && accountsContextSlot < preflightSlot) ||
      !Array.isArray(accountsEnvelope.value)
    ) {
      return unavailable();
    }
    if (accountsEnvelope.value.length !== addresses.length) return unavailable();
    const values = accountsEnvelope.value;
    const required = (index: number): AccountObservation => {
      const value = values[index];
      if (value === null || value === undefined) {
        throw new PublicTestnetPreflightRejectedError('DEPLOYMENT_MISMATCH');
      }
      return parseAccount(value);
    };
    const program = required(0);
    const market = required(1);
    const reserve = required(2);
    const wrappedSolMint = required(3);
    const liquiditySupply = required(4);
    const collateralMint = required(5);
    const collateralSupply = required(6);
    const programDataEnvelope = exactObject(programDataResult);
    const programDataContext = exactObject(programDataEnvelope.context);
    const programDataContextSlot = BigInt(safeInteger(programDataContext.slot));
    if (
      (preflightSlot !== null && programDataContextSlot < preflightSlot) ||
      programDataEnvelope.value === null ||
      programDataEnvelope.value === undefined
    ) {
      return unavailable();
    }
    const programData = parseAccount(programDataEnvelope.value);

    if (
      !program.executable ||
      !program.owner.equals(PUBLIC_TESTNET_UPGRADEABLE_LOADER) ||
      program.data.length !== UPGRADEABLE_PROGRAM_DATA_LENGTH ||
      program.data.readUInt32LE(0) !== 2 ||
      !readPublicKey(program.data, 4).equals(PUBLIC_TESTNET_LENDING_PROGRAM_DATA) ||
      programData.executable ||
      programData.lamports <= 0n ||
      !programData.owner.equals(PUBLIC_TESTNET_UPGRADEABLE_LOADER) ||
      programData.data.length !== UPGRADEABLE_PROGRAM_DATA_HEADER_LENGTH ||
      programData.data.readUInt32LE(0) !== 3 ||
      programData.data.readBigUInt64LE(4) !== PUBLIC_TESTNET_LENDING_PROGRAM_DEPLOYMENT_SLOT ||
      programData.data[12] !== 1 ||
      !readPublicKey(programData.data, 13).equals(
        PUBLIC_TESTNET_LENDING_PROGRAM_UPGRADE_AUTHORITY,
      ) ||
      market.executable ||
      !market.owner.equals(PUBLIC_TESTNET_LENDING_PROGRAM) ||
      market.data.length !== LENDING_MARKET_DATA_LENGTH ||
      market.data[0] !== 1 ||
      !readPublicKey(market.data, 66).equals(PUBLIC_TESTNET_TOKEN_PROGRAM) ||
      reserve.executable ||
      !reserve.owner.equals(PUBLIC_TESTNET_LENDING_PROGRAM) ||
      reserve.data.length !== RESERVE_DATA_LENGTH ||
      reserve.data[0] !== 1 ||
      !readPublicKey(reserve.data, 10).equals(PUBLIC_TESTNET_LENDING_MARKET) ||
      !readPublicKey(reserve.data, 42).equals(PUBLIC_TESTNET_WRAPPED_SOL_MINT) ||
      reserve.data[74] !== PUBLIC_TESTNET_ASSET_DECIMALS ||
      !readPublicKey(reserve.data, 75).equals(PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY) ||
      !readPublicKey(reserve.data, 227).equals(PUBLIC_TESTNET_COLLATERAL_MINT) ||
      !readPublicKey(reserve.data, 267).equals(PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY)
    ) {
      throw new PublicTestnetPreflightRejectedError('DEPLOYMENT_MISMATCH');
    }
    assertMint(wrappedSolMint);
    const collateralMintSupply = assertMint(collateralMint);
    const liquidity = tokenAccount(liquiditySupply);
    const collateral = tokenAccount(collateralSupply);
    const reserveLastUpdatedSlot = readU64(reserve.data, 1);
    const reserveStaleByte = readU8(reserve.data, 9);
    const availableLiquidityAtomic = readU64(reserve.data, 171);
    const borrowedLiquidityWads = readU128(reserve.data, 179);
    const collateralMintTotalSupply = readU64(reserve.data, 259);
    const optimalUtilizationPercent = readU8(reserve.data, 299);
    const minimumBorrowRatePercent = readU8(reserve.data, 303);
    const optimalBorrowRatePercent = readU8(reserve.data, 304);
    const maximumBorrowRatePercent = readU8(reserve.data, 305);
    const protocolTakeRatePercent = readU8(reserve.data, 372);
    const accumulatedProtocolFeesWads = readU128(reserve.data, 373);
    const maximumUtilizationPercent = readU8(reserve.data, 470);
    const superMaximumBorrowRatePercent = readU64(reserve.data, 471);
    if (
      !liquidity.mint.equals(PUBLIC_TESTNET_WRAPPED_SOL_MINT) ||
      !liquidity.owner.equals(PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY) ||
      !collateral.mint.equals(PUBLIC_TESTNET_COLLATERAL_MINT) ||
      !collateral.owner.equals(PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY) ||
      (requireWriteReadiness && availableLiquidityAtomic < PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC) ||
      liquidity.amount < availableLiquidityAtomic ||
      collateralMintSupply > collateralMintTotalSupply ||
      collateralMintSupply < collateral.amount ||
      collateralMintTotalSupply === 0n ||
      reserveLastUpdatedSlot > accountsContextSlot ||
      reserveStaleByte > 1
    ) {
      throw new PublicTestnetPreflightRejectedError('RESERVE_UNAVAILABLE');
    }

    const optionalTokenBalance = (index: number, mint: PublicKey): bigint => {
      const value = values[index];
      if (value === null || value === undefined) return 0n;
      const parsed = tokenAccount(parseAccount(value));
      if (!parsed.mint.equals(mint) || !parsed.owner.equals(account)) {
        throw new PublicTestnetPreflightRejectedError('DEPLOYMENT_MISMATCH');
      }
      return parsed.amount;
    };
    optionalTokenBalance(7, PUBLIC_TESTNET_WRAPPED_SOL_MINT);
    const collateralBalanceBeforeAtomic = optionalTokenBalance(8, PUBLIC_TESTNET_COLLATERAL_MINT);
    if (collateralMintSupply < collateral.amount + collateralBalanceBeforeAtomic) {
      throw new PublicTestnetPreflightRejectedError('RESERVE_UNAVAILABLE');
    }
    let nativeBalanceLamports: bigint | null = null;
    let preflightObservedAt: string | null = null;
    if (preflightSlot !== null) {
      if (balanceResult === null || blockTimeResult === null) return unavailable();
      const balanceEnvelope = exactObject(balanceResult);
      const balanceContext = exactObject(balanceEnvelope.context);
      const balanceValue = safeInteger(balanceEnvelope.value);
      if (BigInt(safeInteger(balanceContext.slot)) < preflightSlot) return unavailable();
      nativeBalanceLamports = BigInt(balanceValue);
      preflightObservedAt = new Date(safeInteger(blockTimeResult) * 1_000).toISOString();
    }
    const positionBlockTimeResult =
      preflightSlot !== null && accountsContextSlot === preflightSlot
        ? blockTimeResult
        : await this.request('getBlockTime', [Number(accountsContextSlot)]);
    if (positionBlockTimeResult === null) return unavailable();
    const positionBlockTime = safeInteger(positionBlockTimeResult);

    const grossLiquidityWads = availableLiquidityAtomic * WAD + borrowedLiquidityWads;
    if (accumulatedProtocolFeesWads >= grossLiquidityWads) {
      throw new PublicTestnetPreflightRejectedError('RESERVE_UNAVAILABLE');
    }
    const netLiquidityWads = grossLiquidityWads - accumulatedProtocolFeesWads;
    const suppliedLiquidityAtomic =
      (collateralBalanceBeforeAtomic * netLiquidityWads) / (collateralMintTotalSupply * WAD);
    const rate = calculateSupplyRate(
      availableLiquidityAtomic,
      borrowedLiquidityWads,
      optimalUtilizationPercent,
      minimumBorrowRatePercent,
      optimalBorrowRatePercent,
      maximumBorrowRatePercent,
      maximumUtilizationPercent,
      superMaximumBorrowRatePercent,
      protocolTakeRatePercent,
    );
    const positionObservedAt = new Date(positionBlockTime * 1_000).toISOString();

    if (preflightSlot !== null) {
      // Keep all deployment, reserve, position, and funding decisions pinned to
      // finalized state, then obtain the transaction blockhash last. A blockhash
      // fetched before those reads is needlessly aged by the preflight itself.
      // `confirmed` supplies a substantially fresher hash, and broadcast uses the
      // same commitment so preflight simulation cannot run on a bank that does not
      // know that hash yet.
      const blockhashResult = await this.request('getLatestBlockhash', [
        { commitment: 'confirmed', minContextSlot: Number(preflightSlot) },
      ]);
      const blockhashEnvelope = exactObject(blockhashResult);
      const blockhashContext = exactObject(blockhashEnvelope.context);
      const blockhashValue = exactObject(blockhashEnvelope.value);
      if (BigInt(safeInteger(blockhashContext.slot)) < preflightSlot) return unavailable();
      blockhash = publicKey(blockhashValue.blockhash).toBase58();
      lastValidBlockHeight = BigInt(safeInteger(blockhashValue.lastValidBlockHeight));
    }

    const preflight =
      preflightSlot === null ||
      blockhash === null ||
      lastValidBlockHeight === null ||
      nativeBalanceLamports === null ||
      preflightObservedAt === null
        ? null
        : Object.freeze({
            slot: preflightSlot,
            blockhash,
            lastValidBlockHeight,
            observedAt: preflightObservedAt,
            reserveLiquidityAtomic: liquidity.amount,
            nativeBalanceLamports,
            collateralBalanceBeforeAtomic,
            sourceLiquidityAccount,
            destinationCollateralAccount,
          });

    return Object.freeze({
      preflight,
      position: Object.freeze({
        slot: accountsContextSlot,
        observedAt: positionObservedAt,
        collateralBalanceAtomic: collateralBalanceBeforeAtomic,
        suppliedLiquidityAtomic,
        supplyApyBasisPoints: rate.supplyApyBasisPoints,
        utilizationBasisPoints: rate.utilizationBasisPoints,
        reserveLastUpdatedSlot,
        reserveMarkedStale: reserveStaleByte === 1,
      }),
    });
  }

  async verifyFinalizedDeposit(
    signature: string,
    expected: PublicTestnetVerificationExpectation,
  ): Promise<PublicTestnetTransactionObservation> {
    this.assertEnabled();
    const signatureBytes = decodeBase58(signature);
    if (signatureBytes.length !== 64) return mismatch();
    const statusResult = await this.request('getSignatureStatuses', [
      [signature],
      { searchTransactionHistory: true },
    ]);
    const statusEnvelope = exactObject(statusResult);
    if (!Array.isArray(statusEnvelope.value) || statusEnvelope.value.length !== 1) {
      return unavailable();
    }
    const rawStatus = statusEnvelope.value[0];
    let statusSlot: bigint;
    let transactionResult: unknown;
    if (rawStatus === null || rawStatus === undefined) {
      if (expected.preflightSlot < 0n || expected.preflightSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
        return mismatch();
      }
      transactionResult = await this.request('getTransaction', [
        signature,
        { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
      ]);
      if (transactionResult === null) {
        const fallbackSlot = await this.findFinalizedSignatureSlot(signature, expected);
        if (fallbackSlot === null) return Object.freeze({ status: 'PENDING' as const });
        statusSlot = fallbackSlot;
        // The address index is independent positive evidence. Retry the exact
        // transaction lookup because the fixed public endpoint is load balanced
        // and its transaction/status indexes can temporarily disagree.
        transactionResult = await this.request('getTransaction', [
          signature,
          { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
        ]);
        if (transactionResult === null) return Object.freeze({ status: 'PENDING' as const });
      } else {
        statusSlot = BigInt(safeInteger(exactObject(transactionResult).slot));
      }
    } else {
      const status = exactObject(rawStatus);
      if (status.err !== null) return mismatch();
      if (status.confirmationStatus !== 'finalized') {
        return Object.freeze({ status: 'PENDING' as const });
      }
      statusSlot = BigInt(safeInteger(status.slot));
      transactionResult = await this.request('getTransaction', [
        signature,
        { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
      ]);
      if (transactionResult === null) return Object.freeze({ status: 'PENDING' as const });
    }
    if (statusSlot <= expected.preflightSlot) return mismatch();
    const envelope = exactObject(transactionResult);
    const slot = BigInt(safeInteger(envelope.slot));
    if (slot !== statusSlot) return mismatch();
    if (!Array.isArray(envelope.transaction) || envelope.transaction.length !== 2)
      return mismatch();
    if (envelope.transaction[1] !== 'base64') return mismatch();
    const serialized = base64Bytes(envelope.transaction[0]);
    let transaction: Transaction;
    try {
      transaction = Transaction.from(serialized);
    } catch {
      return mismatch();
    }
    const actualSignature = transaction.signatures[0];
    if (
      transaction.signatures.length !== 1 ||
      actualSignature === undefined ||
      actualSignature.signature === null ||
      !actualSignature.publicKey.equals(expected.wallet) ||
      !sameBytes(actualSignature.signature, signatureBytes) ||
      !transaction.verifySignatures() ||
      !transaction.feePayer?.equals(expected.wallet) ||
      !matchesExpectedMessageOrAllowedWalletPrefix(transaction, expected.expectedMessageBase64)
    ) {
      return mismatch();
    }

    const meta = exactObject(envelope.meta);
    if (meta.err !== null || !Array.isArray(meta.logMessages)) return mismatch();
    const logs = meta.logMessages;
    if (
      logs.filter((line) => line === 'Program log: Instruction: Deposit Reserve Liquidity')
        .length !== 1 ||
      !logs.includes(`Program ${PUBLIC_TESTNET_LENDING_PROGRAM.toBase58()} success`)
    ) {
      return mismatch();
    }
    const accountKeys = transaction.compileMessage().accountKeys;
    const collateralIndex = accountKeys.findIndex((key) =>
      key.equals(expected.destinationCollateralAccount),
    );
    const liquidityIndex = accountKeys.findIndex((key) =>
      key.equals(PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY),
    );
    if (collateralIndex < 0 || liquidityIndex < 0) return mismatch();
    const pre = parseTokenBalances(meta.preTokenBalances);
    const post = parseTokenBalances(meta.postTokenBalances);
    const collateralBefore =
      findTokenBalance(pre, collateralIndex, PUBLIC_TESTNET_COLLATERAL_MINT, expected.wallet) ?? 0n;
    const collateralAfter = findTokenBalance(
      post,
      collateralIndex,
      PUBLIC_TESTNET_COLLATERAL_MINT,
      expected.wallet,
    );
    const liquidityBefore = findTokenBalance(
      pre,
      liquidityIndex,
      PUBLIC_TESTNET_WRAPPED_SOL_MINT,
      PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
    );
    const liquidityAfter = findTokenBalance(
      post,
      liquidityIndex,
      PUBLIC_TESTNET_WRAPPED_SOL_MINT,
      PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
    );
    if (
      collateralAfter === undefined ||
      collateralAfter <= collateralBefore ||
      liquidityBefore === undefined ||
      liquidityAfter === undefined ||
      liquidityAfter - liquidityBefore !== PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC
    ) {
      return mismatch();
    }
    return Object.freeze({
      status: 'VERIFIED' as const,
      slot,
      collateralBalanceBeforeAtomic: collateralBefore,
      collateralBalanceAfterAtomic: collateralAfter,
      increaseAtomic: collateralAfter - collateralBefore,
    });
  }

  private async findFinalizedSignatureSlot(
    signature: string,
    expected: PublicTestnetVerificationExpectation,
  ): Promise<bigint | null> {
    const addresses = [
      expected.wallet.toBase58(),
      expected.destinationCollateralAccount.toBase58(),
    ].filter((address, index, all) => all.indexOf(address) === index);
    let successfulLookups = 0;
    for (const address of addresses) {
      let result: unknown;
      try {
        result = await this.request('getSignaturesForAddress', [
          address,
          {
            commitment: 'finalized',
            minContextSlot: Number(expected.preflightSlot),
            limit: FINALIZED_SIGNATURE_HISTORY_LIMIT,
          },
        ]);
      } catch (error) {
        if (error instanceof PublicTestnetRpcUnavailableError) continue;
        throw error;
      }
      successfulLookups += 1;
      if (!Array.isArray(result)) return unavailable();
      for (const value of result) {
        const record = exactObject(value);
        if (typeof record.signature !== 'string') return unavailable();
        if (record.signature !== signature) continue;
        if (record.err !== null) return mismatch();
        if (record.confirmationStatus !== 'finalized') return null;
        const slot = BigInt(safeInteger(record.slot));
        if (slot <= expected.preflightSlot) return mismatch();
        return slot;
      }
    }
    if (successfulLookups === 0) return unavailable();
    return null;
  }

  private async sendTransactionRequest(params: readonly unknown[]): Promise<unknown> {
    this.assertEnabled();
    const config = this.config;
    if (config.mode !== 'enabled') return ambiguousBroadcast();
    const id = ++this.requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMilliseconds);
    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(config.rpcEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method: 'sendTransaction', params }),
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
      } catch {
        return ambiguousBroadcast();
      }
      if (
        response.status !== 200 ||
        response.redirected ||
        (response.url !== '' && response.url !== config.rpcEndpoint)
      ) {
        return ambiguousBroadcast();
      }
      const declaredLength = response.headers.get('content-length');
      if (
        declaredLength !== null &&
        (!DECIMAL_INTEGER.test(declaredLength) ||
          Number(declaredLength) > config.responseMaximumBytes)
      ) {
        return ambiguousBroadcast();
      }
      if (response.body === null) return ambiguousBroadcast();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > config.responseMaximumBytes) {
            await reader.cancel();
            return ambiguousBroadcast();
          }
          chunks.push(next.value);
        }
      } catch {
        return ambiguousBroadcast();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        return ambiguousBroadcast();
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return ambiguousBroadcast();
      }
      const envelope = payload as Record<string, unknown>;
      const keys = Object.keys(envelope);
      if (envelope.jsonrpc !== '2.0' || envelope.id !== id) return ambiguousBroadcast();
      if (
        keys.length === 3 &&
        keys.includes('jsonrpc') &&
        keys.includes('id') &&
        keys.includes('error')
      ) {
        const error = envelope.error;
        if (typeof error !== 'object' || error === null || Array.isArray(error)) {
          return ambiguousBroadcast();
        }
        const errorEnvelope = error as Record<string, unknown>;
        const errorKeys = Object.keys(errorEnvelope);
        if (
          !errorKeys.includes('code') ||
          !errorKeys.includes('message') ||
          errorKeys.some((key) => !['code', 'message', 'data'].includes(key)) ||
          !Number.isSafeInteger(errorEnvelope.code) ||
          typeof errorEnvelope.message !== 'string' ||
          errorEnvelope.message.length === 0 ||
          errorEnvelope.message.length > 4_096
        ) {
          return ambiguousBroadcast();
        }
        throw new PublicTestnetBroadcastRejectedError();
      }
      if (
        keys.length !== 3 ||
        !keys.includes('jsonrpc') ||
        !keys.includes('id') ||
        !keys.includes('result')
      ) {
        return ambiguousBroadcast();
      }
      return envelope.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(method: string, params: readonly unknown[]): Promise<unknown> {
    this.assertEnabled();
    const allowed = new Set([
      'getGenesisHash',
      'getSlot',
      'getBlockHeight',
      'getLatestBlockhash',
      'getMultipleAccounts',
      'getAccountInfo',
      'getBalance',
      'getBlockTime',
      'getSignaturesForAddress',
      'getSignatureStatuses',
      'getTransaction',
    ]);
    if (!allowed.has(method)) return unavailable();
    const config = this.config;
    if (config.mode !== 'enabled') return unavailable();
    const id = ++this.requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMilliseconds);
    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(config.rpcEndpoint, {
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
        (response.url !== '' && response.url !== config.rpcEndpoint)
      ) {
        return unavailable();
      }
      const declaredLength = response.headers.get('content-length');
      if (
        declaredLength !== null &&
        (!DECIMAL_INTEGER.test(declaredLength) ||
          Number(declaredLength) > config.responseMaximumBytes)
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
          if (length > config.responseMaximumBytes) {
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
      let payload: Record<string, unknown>;
      try {
        payload = exactObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      } catch {
        return unavailable();
      }
      if (
        payload.jsonrpc !== '2.0' ||
        payload.id !== id ||
        'error' in payload ||
        !('result' in payload)
      ) {
        return unavailable();
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertEnabled(): void {
    if (this.config.mode !== 'enabled') throw new PublicTestnetRpcUnavailableError();
  }
}
