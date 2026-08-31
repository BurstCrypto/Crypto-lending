import { ComputeBudgetProgram, PublicKey, Transaction } from '@solana/web3.js';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { StandardEventsChangeProperties } from '@wallet-standard/features';

import {
  SOLANA_DEVNET_WALLET_STANDARD_CHAIN,
  type SelectedSolanaWallet,
  walletStandardConnectFeature,
  walletStandardEventsFeature,
  walletStandardSignTransactionFeature,
} from './discovery';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_TRANSACTION_BYTES = 1_232;
const SET_COMPUTE_UNIT_LIMIT_TAG = 2;
const SET_COMPUTE_UNIT_PRICE_TAG = 3;
const WALLET_COMPUTE_UNIT_LIMIT = 200_000;
const WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 500_000n;
const WALLET_MAX_PRIORITY_FEE_LAMPORTS = 100_000n;
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;

export type SolanaPublicTestnetWalletErrorCode =
  | 'ABORTED'
  | 'ACCOUNT_CHANGED'
  | 'COMMIT_AMBIGUOUS'
  | 'DISCONNECTED'
  | 'INVALID_RESPONSE'
  | 'REQUEST_PENDING'
  | 'UNSUPPORTED'
  | 'USER_REJECTED';

const ERROR_MESSAGES: Readonly<Record<SolanaPublicTestnetWalletErrorCode, string>> = Object.freeze({
  ABORTED: 'Wallet operation aborted',
  ACCOUNT_CHANGED: 'The selected wallet account changed',
  COMMIT_AMBIGUOUS: 'The wallet did not return a conclusive transaction result',
  DISCONNECTED: 'The selected wallet disconnected',
  INVALID_RESPONSE: 'The wallet returned an invalid response',
  REQUEST_PENDING: 'A wallet request is already pending',
  UNSUPPORTED: 'The wallet does not support the required Solana Devnet transaction',
  USER_REJECTED: 'The wallet request was rejected',
});

export class SolanaPublicTestnetWalletError extends Error {
  constructor(readonly code: SolanaPublicTestnetWalletErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SolanaPublicTestnetWalletError';
  }
}

export interface SolanaPublicTestnetWalletSnapshot {
  readonly account: string;
  readonly correctNetwork: true;
}

export interface SolanaPublicTestnetTransactionRequest {
  readonly serializedTransaction: Uint8Array;
  readonly transactionVersion: 'legacy' | 0;
  readonly minContextSlot: number;
}

export interface SolanaPublicTestnetSignedTransaction {
  readonly signature: string;
  readonly serializedTransaction: Uint8Array;
}

export interface SolanaPublicTestnetWalletPort {
  connect(signal?: AbortSignal): Promise<string>;
  readSnapshot(signal?: AbortSignal): Promise<SolanaPublicTestnetWalletSnapshot>;
  signTransaction(
    request: SolanaPublicTestnetTransactionRequest,
    expectedAccount: string,
    signal?: AbortSignal,
  ): Promise<SolanaPublicTestnetSignedTransaction>;
  subscribeInvalidation(listener: () => void): () => void;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeRead(value: unknown, key: PropertyKey): unknown {
  if (!isRecord(value)) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function providerCode(value: unknown): string | number | undefined {
  const code = safeRead(value, 'code');
  if (typeof code === 'number' && Number.isSafeInteger(code)) return code;
  if (typeof code === 'string' && /^[A-Z0-9_-]{1,64}$/iu.test(code)) return code;
  return undefined;
}

function providerFailure(
  value: unknown,
  operation: 'connect' | 'sign',
  signal?: AbortSignal,
): SolanaPublicTestnetWalletError {
  if (value instanceof SolanaPublicTestnetWalletError) return value;
  const code = providerCode(value);
  if (code === 4001 || code === '4001' || code === 'USER_REJECTED') {
    return new SolanaPublicTestnetWalletError('USER_REJECTED');
  }
  if (code === -32002 || code === '-32002' || code === 'REQUEST_PENDING') {
    return new SolanaPublicTestnetWalletError('REQUEST_PENDING');
  }
  if (operation === 'sign') {
    return new SolanaPublicTestnetWalletError(signal?.aborted ? 'ABORTED' : 'INVALID_RESPONSE');
  }
  return new SolanaPublicTestnetWalletError(signal?.aborted ? 'ABORTED' : 'INVALID_RESPONSE');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SolanaPublicTestnetWalletError('ABORTED');
}

function exactBytes(value: unknown, length?: number): Uint8Array {
  if (
    !ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== '[object Uint8Array]' ||
    Object.prototype.toString.call(value.buffer) === '[object SharedArrayBuffer]' ||
    value.byteLength === 0 ||
    value.byteLength > MAX_TRANSACTION_BYTES ||
    (length !== undefined && value.byteLength !== length)
  ) {
    throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
  }
  return Uint8Array.from(value as Uint8Array);
}

function canonicalAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length > 44) {
    throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
  }
  try {
    const address = new PublicKey(value);
    if (address.equals(PublicKey.default)) throw new Error('zero public key');
    return address.toBase58();
  } catch {
    throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function accountSupportsFeature(account: WalletAccount, feature: string): boolean {
  try {
    return account.features.some((candidate) => candidate === feature);
  } catch {
    return false;
  }
}

function validAccount(account: WalletAccount): boolean {
  try {
    const address = canonicalAddress(account.address);
    return (
      account.chains.some((chain) => chain === SOLANA_DEVNET_WALLET_STANDARD_CHAIN) &&
      accountSupportsFeature(account, 'solana:signTransaction') &&
      account.publicKey instanceof Uint8Array &&
      account.publicKey.byteLength === 32 &&
      bytesEqual(new PublicKey(address).toBytes(), account.publicKey)
    );
  } catch {
    return false;
  }
}

function encodeBase58(value: Uint8Array): string {
  if (value.byteLength === 0) throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
  const digits = [0];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (let index = 0; index < value.length - 1 && value[index] === 0; index += 1) result += '1';
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    result += BASE58_ALPHABET[digits[index] ?? 0];
  }
  return result;
}

function readUnsignedLittleEndian(value: Uint8Array, offset: number, length: number): bigint {
  let result = 0n;
  for (let index = length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(value[offset + index] ?? 0);
  }
  return result;
}

function allowedSignedMessage(reviewed: Transaction, signed: Transaction): boolean {
  const reviewedMessage = reviewed.serializeMessage();
  const signedMessage = signed.serializeMessage();
  if (bytesEqual(reviewedMessage, signedMessage)) return true;

  const [priceInstruction, limitInstruction] = signed.instructions;
  if (
    priceInstruction === undefined ||
    limitInstruction === undefined ||
    !priceInstruction.programId.equals(ComputeBudgetProgram.programId) ||
    priceInstruction.keys.length !== 0 ||
    priceInstruction.data.byteLength !== 9 ||
    priceInstruction.data[0] !== SET_COMPUTE_UNIT_PRICE_TAG ||
    !limitInstruction.programId.equals(ComputeBudgetProgram.programId) ||
    limitInstruction.keys.length !== 0 ||
    limitInstruction.data.byteLength !== 5 ||
    limitInstruction.data[0] !== SET_COMPUTE_UNIT_LIMIT_TAG
  ) {
    return false;
  }

  const computeUnitPriceMicroLamports = readUnsignedLittleEndian(priceInstruction.data, 1, 8);
  const computeUnitLimit = Number(readUnsignedLittleEndian(limitInstruction.data, 1, 4));
  const priorityFeeLamports =
    (BigInt(computeUnitLimit) * computeUnitPriceMicroLamports + MICRO_LAMPORTS_PER_LAMPORT - 1n) /
    MICRO_LAMPORTS_PER_LAMPORT;
  if (
    computeUnitLimit !== WALLET_COMPUTE_UNIT_LIMIT ||
    computeUnitPriceMicroLamports > WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS ||
    priorityFeeLamports > WALLET_MAX_PRIORITY_FEE_LAMPORTS
  ) {
    return false;
  }

  if (reviewed.feePayer === undefined || reviewed.recentBlockhash === undefined) return false;
  try {
    const allowed = new Transaction({
      feePayer: reviewed.feePayer,
      recentBlockhash: reviewed.recentBlockhash,
    }).add(priceInstruction, limitInstruction, ...reviewed.instructions);
    return bytesEqual(allowed.serializeMessage(), signedMessage);
  } catch {
    return false;
  }
}

function parseReviewedTransaction(value: Uint8Array, expectedAccount: string): Transaction {
  try {
    const transaction = Transaction.from(value);
    if (
      transaction.feePayer?.toBase58() !== expectedAccount ||
      transaction.recentBlockhash === undefined ||
      transaction.signatures.length !== 1 ||
      transaction.signatures[0]?.publicKey.toBase58() !== expectedAccount ||
      transaction.signatures[0].signature !== null ||
      !bytesEqual(
        transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
        value,
      )
    ) {
      throw new Error('invalid reviewed transaction');
    }
    return transaction;
  } catch {
    throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
  }
}

function parseSignedTransaction(
  value: unknown,
  reviewed: Transaction,
  expectedAccount: string,
): SolanaPublicTestnetSignedTransaction {
  try {
    const serializedTransaction = exactBytes(value);
    const transaction = Transaction.from(serializedTransaction);
    const signer = transaction.signatures[0];
    if (
      transaction.feePayer?.toBase58() !== expectedAccount ||
      transaction.recentBlockhash !== reviewed.recentBlockhash ||
      transaction.signatures.length !== 1 ||
      signer?.publicKey.toBase58() !== expectedAccount ||
      signer.signature === null ||
      signer.signature.byteLength !== 64 ||
      !transaction.verifySignatures() ||
      !allowedSignedMessage(reviewed, transaction) ||
      !bytesEqual(transaction.serialize(), serializedTransaction)
    ) {
      throw new Error('invalid signed transaction');
    }
    return Object.freeze({
      signature: encodeBase58(Uint8Array.from(signer.signature)),
      serializedTransaction: Uint8Array.from(serializedTransaction),
    });
  } catch {
    throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
  }
}

class DefaultSolanaPublicTestnetWallet implements SolanaPublicTestnetWalletPort {
  readonly #wallet: Wallet;
  readonly #versions: readonly ('legacy' | 0)[];
  readonly #listeners = new Set<() => void>();
  #account: WalletAccount | null = null;
  #generation = 0;
  #offEvents: (() => void) | null = null;
  #disposed = false;

  constructor(selection: SelectedSolanaWallet) {
    this.#wallet = selection.wallet;
    this.#versions = selection.descriptor.supportedTransactionVersions;
  }

  async connect(signal?: AbortSignal): Promise<string> {
    this.#assertLive();
    throwIfAborted(signal);
    const connect = walletStandardConnectFeature(this.#wallet);
    if (connect === null) throw new SolanaPublicTestnetWalletError('UNSUPPORTED');
    let output: Awaited<ReturnType<typeof connect.connect>>;
    try {
      output = await connect.connect({ silent: false });
    } catch (error) {
      throw providerFailure(error, 'connect', signal);
    }
    if (signal?.aborted) {
      this.#invalidate(false);
      throw new SolanaPublicTestnetWalletError('ABORTED');
    }
    const accounts = output.accounts.filter(validAccount);
    if (accounts.length !== 1 || output.accounts.length !== 1 || accounts[0] === undefined) {
      this.#invalidate(false);
      throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
    }
    this.#account = accounts[0];
    this.#generation += 1;
    this.#bindEvents();
    return canonicalAddress(accounts[0].address);
  }

  async readSnapshot(signal?: AbortSignal): Promise<SolanaPublicTestnetWalletSnapshot> {
    this.#assertLive();
    throwIfAborted(signal);
    const account = this.#requireAccount();
    if (!validAccount(account)) {
      this.#invalidate(true);
      throw new SolanaPublicTestnetWalletError('ACCOUNT_CHANGED');
    }
    return Object.freeze({
      account: canonicalAddress(account.address),
      correctNetwork: true as const,
    });
  }

  async signTransaction(
    request: SolanaPublicTestnetTransactionRequest,
    expectedAccount: string,
    signal?: AbortSignal,
  ): Promise<SolanaPublicTestnetSignedTransaction> {
    this.#assertLive();
    throwIfAborted(signal);
    const account = this.#requireAccount();
    const accountAddress = canonicalAddress(account.address);
    if (accountAddress !== canonicalAddress(expectedAccount) || !validAccount(account)) {
      this.#invalidate(true);
      throw new SolanaPublicTestnetWalletError('ACCOUNT_CHANGED');
    }
    if (
      request.transactionVersion !== 'legacy' ||
      !this.#versions.includes('legacy') ||
      !Number.isSafeInteger(request.minContextSlot) ||
      request.minContextSlot < 0
    ) {
      throw new SolanaPublicTestnetWalletError('UNSUPPORTED');
    }
    const serializedTransaction = exactBytes(request.serializedTransaction);
    const reviewedTransaction = parseReviewedTransaction(serializedTransaction, accountAddress);
    const feature = walletStandardSignTransactionFeature(this.#wallet);
    if (feature === null || !accountSupportsFeature(account, 'solana:signTransaction')) {
      throw new SolanaPublicTestnetWalletError('UNSUPPORTED');
    }
    let output: Awaited<ReturnType<typeof feature.signTransaction>>;
    try {
      output = await feature.signTransaction({
        account,
        chain: SOLANA_DEVNET_WALLET_STANDARD_CHAIN,
        transaction: serializedTransaction,
      });
    } catch (error) {
      throw providerFailure(error, 'sign', signal);
    }

    // This method never broadcasts. A malformed signing result is therefore a pre-broadcast
    // wallet failure, not an ambiguous on-chain commit.
    try {
      if (!Array.isArray(output) || output.length !== 1 || output[0] === undefined) {
        throw new Error('missing signed transaction');
      }
      return parseSignedTransaction(
        output[0].signedTransaction,
        reviewedTransaction,
        accountAddress,
      );
    } catch {
      throw new SolanaPublicTestnetWalletError('INVALID_RESPONSE');
    }
  }

  subscribeInvalidation(listener: () => void): () => void {
    this.#assertLive();
    if (typeof listener !== 'function') throw new TypeError('wallet listener must be a function');
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#invalidate(false);
    this.#listeners.clear();
  }

  #assertLive(): void {
    if (this.#disposed) throw new SolanaPublicTestnetWalletError('DISCONNECTED');
  }

  #requireAccount(): WalletAccount {
    if (this.#account === null) throw new SolanaPublicTestnetWalletError('DISCONNECTED');
    return this.#account;
  }

  #bindEvents(): void {
    const events = walletStandardEventsFeature(this.#wallet);
    if (events === null) throw new SolanaPublicTestnetWalletError('UNSUPPORTED');
    try {
      const off = events.on('change', (properties: StandardEventsChangeProperties) => {
        if (properties.accounts === undefined || this.#account === null) return;
        const currentAddress = canonicalAddress(this.#account.address);
        const current = properties.accounts.find(
          (candidate) => validAccount(candidate) && candidate.address === currentAddress,
        );
        if (properties.accounts.length !== 1 || current === undefined) {
          this.#invalidate(true);
          return;
        }
        this.#account = current;
        this.#generation += 1;
      });
      if (typeof off !== 'function') throw new Error('missing listener cleanup');
      this.#offEvents = off;
    } catch {
      this.#invalidate(false);
      throw new SolanaPublicTestnetWalletError('UNSUPPORTED');
    }
  }

  #invalidate(emit: boolean): void {
    const hadAccount = this.#account !== null;
    this.#account = null;
    this.#generation += 1;
    const off = this.#offEvents;
    this.#offEvents = null;
    try {
      off?.();
    } catch {
      // Local authorization is already cleared.
    }
    if (emit && hadAccount) {
      for (const listener of [...this.#listeners]) {
        try {
          listener();
        } catch {
          // One listener cannot block fail-closed invalidation.
        }
      }
    }
  }
}

export function createSolanaPublicTestnetWalletExecutor(
  selection: SelectedSolanaWallet,
): SolanaPublicTestnetWalletPort {
  return new DefaultSolanaPublicTestnetWallet(selection);
}
