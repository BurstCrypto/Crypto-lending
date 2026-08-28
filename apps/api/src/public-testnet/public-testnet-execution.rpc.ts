import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';

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
  PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC,
  PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY,
  PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
  PUBLIC_TESTNET_RPC_ENDPOINT,
  PUBLIC_TESTNET_SOL_RESERVE,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_UPGRADEABLE_LOADER,
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

export interface PublicTestnetVerificationExpectation {
  readonly wallet: PublicKey;
  readonly sourceLiquidityAccount: PublicKey;
  readonly destinationCollateralAccount: PublicKey;
  readonly expectedMessageBase64: string;
  readonly preflightSlot: bigint;
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

function unavailable(): never {
  throw new PublicTestnetRpcUnavailableError();
}

function mismatch(): never {
  throw new PublicTestnetEvidenceMismatchError();
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
    this.assertEnabled();
    const [genesisResult, blockhashResult] = await Promise.all([
      this.request('getGenesisHash', []),
      this.request('getLatestBlockhash', [{ commitment: 'finalized' }]),
    ]);
    if (genesisResult !== PUBLIC_TESTNET_GENESIS_HASH) {
      throw new PublicTestnetPreflightRejectedError('DEPLOYMENT_MISMATCH');
    }
    const blockhashEnvelope = exactObject(blockhashResult);
    const blockhashContext = exactObject(blockhashEnvelope.context);
    const blockhashValue = exactObject(blockhashEnvelope.value);
    const slot = BigInt(safeInteger(blockhashContext.slot));
    const blockhash = publicKey(blockhashValue.blockhash).toBase58();
    const lastValidBlockHeight = BigInt(safeInteger(blockhashValue.lastValidBlockHeight));
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
        { commitment: 'finalized', encoding: 'base64', minContextSlot: Number(slot) },
      ]),
      this.request('getAccountInfo', [
        PUBLIC_TESTNET_LENDING_PROGRAM_DATA.toBase58(),
        {
          commitment: 'finalized',
          encoding: 'base64',
          dataSlice: { offset: 0, length: UPGRADEABLE_PROGRAM_DATA_HEADER_LENGTH },
          minContextSlot: Number(slot),
        },
      ]),
      this.request('getBalance', [
        account.toBase58(),
        { commitment: 'finalized', minContextSlot: Number(slot) },
      ]),
      this.request('getBlockTime', [Number(slot)]),
    ]);
    const accountsEnvelope = exactObject(accountsResult);
    const accountsContext = exactObject(accountsEnvelope.context);
    if (
      BigInt(safeInteger(accountsContext.slot)) < slot ||
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
    if (
      BigInt(safeInteger(programDataContext.slot)) < slot ||
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
    assertMint(collateralMint);
    const liquidity = tokenAccount(liquiditySupply);
    const collateral = tokenAccount(collateralSupply);
    if (
      !liquidity.mint.equals(PUBLIC_TESTNET_WRAPPED_SOL_MINT) ||
      !liquidity.owner.equals(PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY) ||
      !collateral.mint.equals(PUBLIC_TESTNET_COLLATERAL_MINT) ||
      !collateral.owner.equals(PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY) ||
      liquidity.amount < PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC
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
    const balanceEnvelope = exactObject(balanceResult);
    const balanceContext = exactObject(balanceEnvelope.context);
    const balanceValue = safeInteger(balanceEnvelope.value);
    if (BigInt(safeInteger(balanceContext.slot)) < slot) return unavailable();
    if (blockTimeResult === null) return unavailable();
    const blockTime = safeInteger(blockTimeResult);

    return Object.freeze({
      slot,
      blockhash,
      lastValidBlockHeight,
      observedAt: new Date(blockTime * 1_000).toISOString(),
      reserveLiquidityAtomic: liquidity.amount,
      nativeBalanceLamports: BigInt(balanceValue),
      collateralBalanceBeforeAtomic,
      sourceLiquidityAccount,
      destinationCollateralAccount,
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
    if (rawStatus === null || rawStatus === undefined) {
      return Object.freeze({ status: 'PENDING' as const });
    }
    const status = exactObject(rawStatus);
    if (status.err !== null) return mismatch();
    if (status.confirmationStatus !== 'finalized') {
      return Object.freeze({ status: 'PENDING' as const });
    }
    const statusSlot = BigInt(safeInteger(status.slot));
    if (statusSlot <= expected.preflightSlot) return mismatch();

    const transactionResult = await this.request('getTransaction', [
      signature,
      { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
    ]);
    if (transactionResult === null) return Object.freeze({ status: 'PENDING' as const });
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
      transaction.serializeMessage().toString('base64') !== expected.expectedMessageBase64
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

  private async request(method: string, params: readonly unknown[]): Promise<unknown> {
    this.assertEnabled();
    const allowed = new Set([
      'getGenesisHash',
      'getLatestBlockhash',
      'getMultipleAccounts',
      'getAccountInfo',
      'getBalance',
      'getBlockTime',
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
