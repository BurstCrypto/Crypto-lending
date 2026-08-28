import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import type { LocalDemoAllocationPreview } from '@/lib/local-demo/local-demo-yield';
import type { SolanaPublicTestnetTransactionRequest } from '@/lib/wallets/solana/public-testnet-executor';

export const PUBLIC_TESTNET_CHAIN_ID = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
export const PUBLIC_TESTNET_WALLET_CHAIN = 'solana:devnet' as const;
export const PUBLIC_TESTNET_AMOUNT_ATOMIC = '10000000' as const;
export const PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS = '20000000' as const;
export const PUBLIC_TESTNET_FAUCET_URL = 'https://faucet.solana.com/' as const;
export const PUBLIC_TESTNET_EXPLORER_ORIGIN = 'https://explorer.solana.com' as const;

export const PUBLIC_TESTNET_SAVE_PROGRAM = 'ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx' as const;
export const PUBLIC_TESTNET_SAVE_MARKET = 'GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp' as const;
export const PUBLIC_TESTNET_SAVE_MARKET_AUTHORITY =
  'EhJ4fwaXUp7aiwvZThSUaGWCaBQAJe3AEaJJJVCn3UCK' as const;
export const PUBLIC_TESTNET_SAVE_RESERVE = '5VVLD7BQp8y3bTgyF5ezm1ResyMTR3PhYsT4iHFU8Sxz' as const;
export const PUBLIC_TESTNET_WRAPPED_SOL_MINT =
  'So11111111111111111111111111111111111111112' as const;
export const PUBLIC_TESTNET_SAVE_LIQUIDITY_VAULT =
  'furd3XUtjXZ2gRvSsoUts9A5m8cMJNqdsyR2Rt8vY9s' as const;
export const PUBLIC_TESTNET_SAVE_COLLATERAL_MINT =
  'FzwZWRMc3GCqjSrcpVX3ueJc6UpcV6iWWb7ZMsTXE3Gf' as const;
export const PUBLIC_TESTNET_SAVE_COLLATERAL_SUPPLY =
  'J5KGpESS8Zq2MvK4rtL6wKbeMRYZzb6TEzn8qPsZFgGd' as const;
export const PUBLIC_TESTNET_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;
export const PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as const;
export const PUBLIC_TESTNET_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as const;

const PUBLIC_TESTNET_SAVE_DEPOSIT_DATA = Uint8Array.from([4, 128, 150, 152, 0, 0, 0, 0, 0]);
const PUBLIC_TESTNET_SYNC_NATIVE_DATA = Uint8Array.of(17);
const PUBLIC_TESTNET_CREATE_IDEMPOTENT_DATA = Uint8Array.of(1);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PORTFOLIO_SNAPSHOT_ID = /^local-demo-portfolio:[0-9a-f]{32}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECIMAL_INTEGER = /^(0|[1-9][0-9]{0,19})$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,100}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_TRANSACTION_BASE64_LENGTH = 1_648;
const MAX_INTENT_LIFETIME_MS = 60_000;
const MAX_EVIDENCE_LIFETIME_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 30_000;

export type PublicTestnetFundingStatus = 'READY' | 'NEEDS_DEVNET_SOL';

export interface PublicTestnetExecutionRequest {
  readonly portfolioSnapshotId: string;
  readonly selection: Readonly<{
    kind: 'PRESET';
    presetId: 'BALANCED';
    liquidReserveBasisPoints: number;
  }>;
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface PublicTestnetExecutionIntent {
  readonly use: 'PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY';
  readonly mayAuthorizeMainnetFinancialAction: false;
  readonly intentId: string;
  readonly expiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
  readonly portfolioBinding: Readonly<{
    portfolioSnapshotId: string;
    selection: PublicTestnetExecutionRequest['selection'];
  }>;
  readonly proof: Readonly<{
    kind: 'SINGLE_TESTNET_PROOF_POSITION';
    amountAtomic: typeof PUBLIC_TESTNET_AMOUNT_ATOMIC;
    assetSymbol: 'SOL';
    assetDecimals: 9;
    notFullBlend: true;
  }>;
  readonly transaction: Readonly<{
    encoding: 'BASE64';
    messageVersion: 'LEGACY';
    serializedTransactionBase64: string;
    recentBlockhash: string;
    lastValidBlockHeight: string;
    minContextSlot: string;
    feePayer: string;
    sourceLiquidityAccount: string;
    destinationCollateralAccount: string;
  }>;
  readonly liveObservation: Readonly<{
    confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION';
    slot: string;
    observedAt: string;
    reserveLiquidityAtomic: string;
  }>;
  readonly fundingReadiness: Readonly<{
    status: PublicTestnetFundingStatus;
    nativeBalanceLamports: string;
    requiredNativeBalanceLamports: typeof PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS;
    faucetUrl: typeof PUBLIC_TESTNET_FAUCET_URL;
  }>;
  readonly providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER';
}

export interface PublicTestnetSubmissionResult {
  readonly intentId: string;
  readonly status: 'PENDING' | 'VERIFIED';
  readonly confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION';
  readonly transaction: Readonly<{
    status: 'PENDING' | 'VERIFIED';
    signature: string;
    slot: string | null;
  }>;
  readonly position: Readonly<{
    status: 'PENDING' | 'VERIFIED';
    collateralBalanceBeforeAtomic: string;
    collateralBalanceAfterAtomic: string | null;
    increaseAtomic: string | null;
  }>;
  readonly consumed: boolean;
}

export class PublicTestnetExecutionValidationError extends Error {
  constructor() {
    super('Public-testnet execution data is invalid');
    this.name = 'PublicTestnetExecutionValidationError';
  }
}

type PlainRecord = Record<string, unknown>;

function fail(): never {
  throw new PublicTestnetExecutionValidationError();
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
    keys.some((name) => {
      const descriptor = descriptors[name];
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

function safeIntegerDecimal(value: unknown): number {
  const parsed = decimal(value);
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 0) return fail();
  return number;
}

function publicKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 44) return fail();
  try {
    const key = new PublicKey(value);
    if (key.equals(PublicKey.default) || key.toBase58() !== value) return fail();
    return value;
  } catch {
    return fail();
  }
}

function dateTime(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !CANONICAL_DATE_TIME.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return fail();
  }
  return value;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function decodeBase64(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_TRANSACTION_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !BASE64.test(value)
  ) {
    return fail();
  }
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    return fail();
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength === 0 || bytes.byteLength > 1_232) return fail();
  return bytes;
}

function decodeBase58(value: string): Uint8Array {
  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) return fail();
    for (let index = 0; index < bytes.length; index += 1) {
      carry += (bytes[index] ?? 0) * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeroes = 0;
  while (value[zeroes] === '1') zeroes += 1;
  const significant = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  const decoded = new Uint8Array(zeroes + significant);
  for (let index = 0; index < significant; index += 1) {
    decoded[decoded.length - index - 1] = bytes[index] ?? 0;
  }
  return decoded;
}

export function normalizePublicTestnetAccount(value: unknown): string {
  return publicKey(value);
}

export function parsePublicTestnetTransactionSignature(value: unknown): string {
  if (typeof value !== 'string' || !BASE58.test(value) || value.length > 100) return fail();
  if (decodeBase58(value).byteLength !== 64) return fail();
  return value;
}

function deriveAssociatedTokenAccount(owner: string, mint: string): string {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBytes(),
      new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM).toBytes(),
      new PublicKey(mint).toBytes(),
    ],
    new PublicKey(PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM),
  )[0].toBase58();
}

function assertKey(
  key: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean } | undefined,
  expected: string,
  signer: boolean,
  writable: boolean,
): void {
  if (
    key === undefined ||
    key.pubkey.toBase58() !== expected ||
    key.isSigner !== signer ||
    key.isWritable !== writable
  ) {
    fail();
  }
}

function assertIdempotentAtaInstruction(
  instruction: Transaction['instructions'][number] | undefined,
  wallet: string,
  ata: string,
  mint: string,
  mintWritable: boolean,
): void {
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM ||
    instruction.keys.length !== 6 ||
    !bytesEqual(instruction.data, PUBLIC_TESTNET_CREATE_IDEMPOTENT_DATA)
  ) {
    fail();
  }
  assertKey(instruction.keys[0], wallet, true, true);
  assertKey(instruction.keys[1], ata, false, true);
  // Legacy messages store privileges per account, not per instruction. The fee payer's
  // signer/writable privileges therefore appear on its duplicate owner meta as well.
  assertKey(instruction.keys[2], wallet, true, true);
  assertKey(instruction.keys[3], mint, false, mintWritable);
  assertKey(instruction.keys[4], SystemProgram.programId.toBase58(), false, false);
  assertKey(instruction.keys[5], PUBLIC_TESTNET_TOKEN_PROGRAM, false, false);
}

function assertTransferInstruction(
  instruction: Transaction['instructions'][number] | undefined,
  wallet: string,
  sourceLiquidityAccount: string,
): void {
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== SystemProgram.programId.toBase58() ||
    instruction.keys.length !== 2 ||
    instruction.data.byteLength !== 12
  ) {
    fail();
  }
  const view = new DataView(
    instruction.data.buffer,
    instruction.data.byteOffset,
    instruction.data.byteLength,
  );
  if (view.getUint32(0, true) !== 2 || view.getBigUint64(4, true) !== 10_000_000n) fail();
  assertKey(instruction.keys[0], wallet, true, true);
  assertKey(instruction.keys[1], sourceLiquidityAccount, false, true);
}

function assertSyncNativeInstruction(
  instruction: Transaction['instructions'][number] | undefined,
  sourceLiquidityAccount: string,
): void {
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_TOKEN_PROGRAM ||
    instruction.keys.length !== 1 ||
    !bytesEqual(instruction.data, PUBLIC_TESTNET_SYNC_NATIVE_DATA)
  ) {
    fail();
  }
  assertKey(instruction.keys[0], sourceLiquidityAccount, false, true);
}

function assertSaveDepositInstruction(
  instruction: Transaction['instructions'][number] | undefined,
  wallet: string,
  sourceLiquidityAccount: string,
  destinationCollateralAccount: string,
): void {
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_SAVE_PROGRAM ||
    instruction.keys.length !== 9 ||
    !bytesEqual(instruction.data, PUBLIC_TESTNET_SAVE_DEPOSIT_DATA)
  ) {
    fail();
  }
  const expected = [
    [sourceLiquidityAccount, false, true],
    [destinationCollateralAccount, false, true],
    [PUBLIC_TESTNET_SAVE_RESERVE, false, true],
    [PUBLIC_TESTNET_SAVE_LIQUIDITY_VAULT, false, true],
    [PUBLIC_TESTNET_SAVE_COLLATERAL_MINT, false, true],
    [PUBLIC_TESTNET_SAVE_MARKET, false, false],
    [PUBLIC_TESTNET_SAVE_MARKET_AUTHORITY, false, false],
    [wallet, true, true],
    [PUBLIC_TESTNET_TOKEN_PROGRAM, false, false],
  ] as const;
  expected.forEach(([address, signer, writable], index) =>
    assertKey(instruction.keys[index], address, signer, writable),
  );
}

function assertIntentMemoInstruction(
  instruction: Transaction['instructions'][number] | undefined,
  intentId: string,
): void {
  const expected = `crypto-lending:devnet-proof:v1:${intentId}`;
  const expectedBytes = Uint8Array.from(expected, (character) => character.charCodeAt(0));
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_MEMO_PROGRAM ||
    instruction.keys.length !== 0 ||
    !bytesEqual(instruction.data, expectedBytes)
  ) {
    fail();
  }
}

function validateSerializedTransaction(
  serializedTransactionBase64: unknown,
  transactionRecord: PlainRecord,
  account: string,
  intentId: string,
): string {
  const bytes = decodeBase64(serializedTransactionBase64);
  let transaction: Transaction;
  try {
    transaction = Transaction.from(bytes);
  } catch {
    return fail();
  }
  const recentBlockhash = publicKey(transactionRecord.recentBlockhash);
  const feePayer = publicKey(transactionRecord.feePayer);
  const sourceLiquidityAccount = publicKey(transactionRecord.sourceLiquidityAccount);
  const destinationCollateralAccount = publicKey(transactionRecord.destinationCollateralAccount);
  if (
    feePayer !== account ||
    transaction.feePayer?.toBase58() !== account ||
    transaction.recentBlockhash !== recentBlockhash ||
    transaction.signatures.length !== 1 ||
    transaction.signatures[0]?.publicKey.toBase58() !== account ||
    transaction.signatures[0]?.signature !== null ||
    sourceLiquidityAccount !==
      deriveAssociatedTokenAccount(account, PUBLIC_TESTNET_WRAPPED_SOL_MINT) ||
    destinationCollateralAccount !==
      deriveAssociatedTokenAccount(account, PUBLIC_TESTNET_SAVE_COLLATERAL_MINT) ||
    transaction.instructions.length !== 6
  ) {
    return fail();
  }

  // Exact reviewed order: intent memo, WSOL ATA, transfer, SyncNative, cSOL ATA, deposit.
  assertIntentMemoInstruction(transaction.instructions[0], intentId);
  assertIdempotentAtaInstruction(
    transaction.instructions[1],
    account,
    sourceLiquidityAccount,
    PUBLIC_TESTNET_WRAPPED_SOL_MINT,
    false,
  );
  assertTransferInstruction(transaction.instructions[2], account, sourceLiquidityAccount);
  assertSyncNativeInstruction(transaction.instructions[3], sourceLiquidityAccount);
  assertIdempotentAtaInstruction(
    transaction.instructions[4],
    account,
    destinationCollateralAccount,
    PUBLIC_TESTNET_SAVE_COLLATERAL_MINT,
    true,
  );
  assertSaveDepositInstruction(
    transaction.instructions[5],
    account,
    sourceLiquidityAccount,
    destinationCollateralAccount,
  );
  return serializedTransactionBase64 as string;
}

export function validatePublicTestnetExecutionRequest(
  value: PublicTestnetExecutionRequest,
): PublicTestnetExecutionRequest {
  const record = exactRecord(value, ['portfolioSnapshotId', 'selection', 'chainId', 'account']);
  const selection = exactRecord(record.selection, ['kind', 'presetId', 'liquidReserveBasisPoints']);
  if (
    typeof record.portfolioSnapshotId !== 'string' ||
    !PORTFOLIO_SNAPSHOT_ID.test(record.portfolioSnapshotId) ||
    record.chainId !== PUBLIC_TESTNET_CHAIN_ID ||
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
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account: publicKey(record.account),
  });
}

function parseTransaction(
  value: unknown,
  account: string,
  intentId: string,
): PublicTestnetExecutionIntent['transaction'] {
  const record = exactRecord(value, [
    'encoding',
    'messageVersion',
    'serializedTransactionBase64',
    'recentBlockhash',
    'lastValidBlockHeight',
    'minContextSlot',
    'feePayer',
    'sourceLiquidityAccount',
    'destinationCollateralAccount',
  ]);
  if (record.encoding !== 'BASE64' || record.messageVersion !== 'LEGACY') return fail();
  const serializedTransactionBase64 = validateSerializedTransaction(
    record.serializedTransactionBase64,
    record,
    account,
    intentId,
  );
  return Object.freeze({
    encoding: 'BASE64' as const,
    messageVersion: 'LEGACY' as const,
    serializedTransactionBase64,
    recentBlockhash: publicKey(record.recentBlockhash),
    lastValidBlockHeight: decimal(record.lastValidBlockHeight),
    minContextSlot: decimal(record.minContextSlot),
    feePayer: publicKey(record.feePayer),
    sourceLiquidityAccount: publicKey(record.sourceLiquidityAccount),
    destinationCollateralAccount: publicKey(record.destinationCollateralAccount),
  });
}

function parseLiveObservation(value: unknown): PublicTestnetExecutionIntent['liveObservation'] {
  const record = exactRecord(value, [
    'confirmation',
    'slot',
    'observedAt',
    'reserveLiquidityAtomic',
  ]);
  const reserveLiquidityAtomic = decimal(record.reserveLiquidityAtomic);
  if (
    record.confirmation !== 'FINALIZED_PREFLIGHT_OBSERVATION' ||
    BigInt(reserveLiquidityAtomic) < 10_000_000n
  ) {
    return fail();
  }
  return Object.freeze({
    confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION' as const,
    slot: decimal(record.slot),
    observedAt: dateTime(record.observedAt),
    reserveLiquidityAtomic,
  });
}

function parseFundingReadiness(value: unknown): PublicTestnetExecutionIntent['fundingReadiness'] {
  const record = exactRecord(value, [
    'status',
    'nativeBalanceLamports',
    'requiredNativeBalanceLamports',
    'faucetUrl',
  ]);
  if (
    (record.status !== 'READY' && record.status !== 'NEEDS_DEVNET_SOL') ||
    record.requiredNativeBalanceLamports !== PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS ||
    record.faucetUrl !== PUBLIC_TESTNET_FAUCET_URL
  ) {
    return fail();
  }
  const nativeBalanceLamports = decimal(record.nativeBalanceLamports);
  const ready = BigInt(nativeBalanceLamports) >= 20_000_000n;
  if ((record.status === 'READY') !== ready) return fail();
  return Object.freeze({
    status: record.status,
    nativeBalanceLamports,
    requiredNativeBalanceLamports: PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
    faucetUrl: PUBLIC_TESTNET_FAUCET_URL,
  });
}

export function parsePublicTestnetExecutionIntent(
  value: unknown,
  expectedRequest: PublicTestnetExecutionRequest,
  now = new Date(),
): PublicTestnetExecutionIntent {
  const expected = validatePublicTestnetExecutionRequest(expectedRequest);
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
    'liveObservation',
    'fundingReadiness',
    'providerVisibility',
  ]);
  const account = publicKey(record.account);
  const expiresAt = dateTime(record.expiresAt);
  const evidenceExpiresAt = dateTime(record.evidenceExpiresAt);
  const expiry = Date.parse(expiresAt);
  const evidenceExpiry = Date.parse(evidenceExpiresAt);
  if (
    record.use !== 'PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY' ||
    record.mayAuthorizeMainnetFinancialAction !== false ||
    typeof record.intentId !== 'string' ||
    !UUID_V4.test(record.intentId) ||
    record.chainId !== PUBLIC_TESTNET_CHAIN_ID ||
    account !== expected.account ||
    !Number.isFinite(now.getTime()) ||
    expiry <= now.getTime() - CLOCK_SKEW_MS ||
    expiry - now.getTime() > MAX_INTENT_LIFETIME_MS + CLOCK_SKEW_MS ||
    evidenceExpiry <= expiry ||
    evidenceExpiry <= now.getTime() - CLOCK_SKEW_MS ||
    evidenceExpiry - now.getTime() > MAX_EVIDENCE_LIFETIME_MS + CLOCK_SKEW_MS ||
    record.providerVisibility !== 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER'
  ) {
    return fail();
  }
  const binding = exactRecord(record.portfolioBinding, ['portfolioSnapshotId', 'selection']);
  const selection = exactRecord(binding.selection, [
    'kind',
    'presetId',
    'liquidReserveBasisPoints',
  ]);
  if (
    binding.portfolioSnapshotId !== expected.portfolioSnapshotId ||
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
    proof.amountAtomic !== PUBLIC_TESTNET_AMOUNT_ATOMIC ||
    proof.assetSymbol !== 'SOL' ||
    proof.assetDecimals !== 9 ||
    proof.notFullBlend !== true
  ) {
    return fail();
  }
  const transaction = parseTransaction(record.transaction, account, record.intentId);
  const minContextSlot = safeIntegerDecimal(transaction.minContextSlot);
  const lastValidBlockHeight = safeIntegerDecimal(transaction.lastValidBlockHeight);
  if (lastValidBlockHeight === 0 || minContextSlot === 0) return fail();
  return Object.freeze({
    use: 'PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY' as const,
    mayAuthorizeMainnetFinancialAction: false as const,
    intentId: record.intentId,
    expiresAt,
    evidenceExpiresAt,
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account,
    portfolioBinding: Object.freeze({
      portfolioSnapshotId: expected.portfolioSnapshotId,
      selection: Object.freeze({ ...expected.selection }),
    }),
    proof: Object.freeze({
      kind: 'SINGLE_TESTNET_PROOF_POSITION' as const,
      amountAtomic: PUBLIC_TESTNET_AMOUNT_ATOMIC,
      assetSymbol: 'SOL' as const,
      assetDecimals: 9 as const,
      notFullBlend: true as const,
    }),
    transaction,
    liveObservation: parseLiveObservation(record.liveObservation),
    fundingReadiness: parseFundingReadiness(record.fundingReadiness),
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
  });
}

export function publicTestnetWalletTransaction(
  intent: PublicTestnetExecutionIntent,
): SolanaPublicTestnetTransactionRequest {
  return Object.freeze({
    serializedTransaction: decodeBase64(intent.transaction.serializedTransactionBase64),
    transactionVersion: 'legacy' as const,
    minContextSlot: safeIntegerDecimal(intent.transaction.minContextSlot),
  });
}

export function parsePublicTestnetSubmissionResult(
  value: unknown,
  expected: Readonly<{ intentId: string; signature: string }>,
): PublicTestnetSubmissionResult {
  if (!UUID_V4.test(expected.intentId)) return fail();
  const signature = parsePublicTestnetTransactionSignature(expected.signature);
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
    (record.status !== 'PENDING' && record.status !== 'VERIFIED') ||
    record.confirmation !== 'LATEST_SIGNATURE_STATUS_OBSERVATION' ||
    typeof record.consumed !== 'boolean'
  ) {
    return fail();
  }
  const transaction = exactRecord(record.transaction, ['status', 'signature', 'slot']);
  const position = exactRecord(record.position, [
    'status',
    'collateralBalanceBeforeAtomic',
    'collateralBalanceAfterAtomic',
    'increaseAtomic',
  ]);
  if (
    (transaction.status !== 'PENDING' && transaction.status !== 'VERIFIED') ||
    parsePublicTestnetTransactionSignature(transaction.signature) !== signature ||
    (position.status !== 'PENDING' && position.status !== 'VERIFIED')
  ) {
    return fail();
  }
  const before = decimal(position.collateralBalanceBeforeAtomic);
  const transactionSlot = transaction.slot === null ? null : decimal(transaction.slot);
  const after =
    position.collateralBalanceAfterAtomic === null
      ? null
      : decimal(position.collateralBalanceAfterAtomic);
  const increase = position.increaseAtomic === null ? null : decimal(position.increaseAtomic);
  if (record.status === 'VERIFIED') {
    if (
      transaction.status !== 'VERIFIED' ||
      position.status !== 'VERIFIED' ||
      transactionSlot === null ||
      after === null ||
      increase === null ||
      BigInt(increase) <= 0n ||
      BigInt(after) - BigInt(before) !== BigInt(increase) ||
      record.consumed !== true
    ) {
      return fail();
    }
  } else if (
    record.consumed !== false ||
    (transaction.status === 'PENDING' && transactionSlot !== null) ||
    (transaction.status === 'VERIFIED' && transactionSlot === null) ||
    (position.status === 'PENDING' && (after !== null || increase !== null)) ||
    (position.status === 'VERIFIED' &&
      (after === null ||
        increase === null ||
        BigInt(increase) <= 0n ||
        BigInt(after) - BigInt(before) !== BigInt(increase)))
  ) {
    return fail();
  }
  return Object.freeze({
    intentId: expected.intentId,
    status: record.status,
    confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION' as const,
    transaction: Object.freeze({
      status: transaction.status,
      signature,
      slot: transactionSlot,
    }),
    position: Object.freeze({
      status: position.status,
      collateralBalanceBeforeAtomic: before,
      collateralBalanceAfterAtomic: after,
      increaseAtomic: increase,
    }),
    consumed: record.consumed,
  });
}

export function publicTestnetExplorerTransactionUrl(signatureValue: unknown): string {
  const signature = parsePublicTestnetTransactionSignature(signatureValue);
  return `${PUBLIC_TESTNET_EXPLORER_ORIGIN}/tx/${signature}?cluster=devnet`;
}

export function publicTestnetPreviewRequest(
  preview: LocalDemoAllocationPreview,
  account: string,
): PublicTestnetExecutionRequest {
  if (preview.selection.presetId !== 'BALANCED') return fail();
  return validatePublicTestnetExecutionRequest({
    portfolioSnapshotId: preview.portfolioSnapshotId,
    selection: {
      kind: 'PRESET',
      presetId: 'BALANCED',
      liquidReserveBasisPoints: preview.selection.liquidReserveBasisPoints,
    },
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account,
  });
}
