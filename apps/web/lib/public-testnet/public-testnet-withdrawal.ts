import { PublicKey, SystemInstruction, Transaction } from '@solana/web3.js';

import {
  createSolanaPublicTestnetWalletExecutor,
  type SolanaPublicTestnetTransactionRequest,
  type SolanaPublicTestnetWalletPort,
} from '@/lib/wallets/solana/public-testnet-executor';
import {
  PhantomSolanaWalletDiscovery,
  type SelectedSolanaWallet,
  type SolanaWalletDescriptor,
} from '@/lib/wallets/solana/discovery';

import {
  PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_FAUCET_URL,
  PUBLIC_TESTNET_MEMO_PROGRAM,
  PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
  PUBLIC_TESTNET_SAVE_COLLATERAL_MINT,
  PUBLIC_TESTNET_SAVE_LIQUIDITY_VAULT,
  PUBLIC_TESTNET_SAVE_MARKET,
  PUBLIC_TESTNET_SAVE_MARKET_AUTHORITY,
  PUBLIC_TESTNET_SAVE_PROGRAM,
  PUBLIC_TESTNET_SAVE_RESERVE,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
  normalizePublicTestnetAccount,
  parsePublicTestnetTransactionSignature,
} from './public-testnet-execution';
import {
  claimPublicTestnetOperationLock,
  clearPublicTestnetOperationLock,
  type PublicTestnetOperationLock,
  type PublicTestnetOperationLockStorage,
} from './public-testnet-operation-lock';
import {
  clearPublicTestnetWithdrawalRecoveryJournal,
  readPublicTestnetWithdrawalRecoveryJournal,
  startPublicTestnetWithdrawalRecoveryJournal,
} from './public-testnet-withdrawal-recovery-journal';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DECIMAL_INTEGER = /^(0|[1-9][0-9]{0,19})$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const TEMPORARY_ACCOUNT_SEED = /^wdv1:[0-9a-f]{27}$/u;
const MAX_TRANSACTION_BASE64_LENGTH = 1_648;
const MAX_INTENT_LIFETIME_MILLISECONDS = 60_000;
const MAX_EVIDENCE_LIFETIME_MILLISECONDS = 10 * 60_000;
const CLOCK_SKEW_MILLISECONDS = 30_000;

export interface PublicTestnetWithdrawalRequest {
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface PublicTestnetWithdrawalIntent {
  readonly use: 'PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY';
  readonly mayAuthorizeMainnetFinancialAction: false;
  readonly intentId: string;
  readonly expiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
  readonly proof: Readonly<{
    kind: 'FULL_TESTNET_POSITION_WITHDRAWAL';
    collateralAmountAtomic: string;
    estimatedLiquidityAtomic: string;
    collateralSymbol: 'cSOL';
    assetSymbol: 'SOL';
    assetDecimals: 9;
  }>;
  readonly transaction: Readonly<{
    encoding: 'BASE64';
    messageVersion: 'LEGACY';
    serializedTransactionBase64: string;
    recentBlockhash: string;
    lastValidBlockHeight: string;
    minContextSlot: string;
    feePayer: string;
    sourceCollateralAccount: string;
    temporaryLiquidityAccount: string;
    temporaryAccountSeed: string;
  }>;
  readonly fundingReadiness: Readonly<{
    status: 'READY' | 'NEEDS_DEVNET_SOL';
    nativeBalanceLamports: string;
    requiredNativeBalanceLamports: typeof PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS;
    temporaryAccountRentLamports: string;
    faucetUrl: typeof PUBLIC_TESTNET_FAUCET_URL;
  }>;
  readonly liveObservation: Readonly<{
    confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION';
    slot: string;
    observedAt: string;
    collateralBalanceAtomic: string;
    estimatedLiquidityAtomic: string;
    reserveAvailableLiquidityAtomic: string;
  }>;
  readonly providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER';
}

export type PublicTestnetWithdrawalStatus =
  'PENDING' | 'VERIFIED' | 'SETTLED_POSITION_REMAINS' | 'FAILED';

export interface PublicTestnetWithdrawalResult {
  readonly intentId: string;
  readonly status: PublicTestnetWithdrawalStatus;
  readonly confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION';
  readonly transaction: Readonly<{
    status: PublicTestnetWithdrawalStatus;
    signature: string;
    slot: string | null;
  }>;
  readonly position: Readonly<{
    status: PublicTestnetWithdrawalStatus;
    collateralBalanceBeforeAtomic: string;
    collateralBalanceAfterAtomic: string | null;
    decreaseAtomic: string | null;
    liquidityReceivedAtomic: string | null;
  }>;
  readonly consumed: boolean;
}

export interface PublicTestnetWithdrawalApi {
  createWithdrawalIntent(
    input: PublicTestnetWithdrawalRequest,
    signal?: AbortSignal,
  ): Promise<PublicTestnetWithdrawalIntent>;
  submitSignedWithdrawal(
    intentId: string,
    signature: string,
    serializedTransaction: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PublicTestnetWithdrawalResult>;
  verifyWithdrawal(
    intentId: string,
    signature: string,
    signal?: AbortSignal,
  ): Promise<PublicTestnetWithdrawalResult>;
}

export interface ClaimedPublicTestnetWithdrawal {
  readonly intent: PublicTestnetWithdrawalIntent;
  readonly transactionRequest: SolanaPublicTestnetTransactionRequest;
}

export type PublicTestnetWithdrawalStartOutcome =
  | Readonly<{
      status: 'COMPLETE';
      signature: string;
      result: PublicTestnetWithdrawalResult;
    }>
  | Readonly<{
      status: 'RECOVERY_REQUIRED';
      signature: string;
      result?: PublicTestnetWithdrawalResult;
      error?: unknown;
    }>
  | Readonly<{ status: 'FAILED'; error: unknown }>;

export interface PublicTestnetWithdrawalWalletDiscovery {
  start(): void;
  stop(): void;
  list(): readonly SolanaWalletDescriptor[];
  select(selectionId: string): SelectedSolanaWallet | null;
}

export interface PublicTestnetWithdrawalWalletDependencies {
  readonly createDiscovery?: () => PublicTestnetWithdrawalWalletDiscovery;
  readonly createWallet?: (selection: SelectedSolanaWallet) => SolanaPublicTestnetWalletPort;
  readonly polling?: PublicTestnetWithdrawalPollingOptions;
}

export interface PublicTestnetWithdrawalPollingOptions {
  readonly intervalMilliseconds?: number;
  readonly maximumWaitMilliseconds?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class PublicTestnetWithdrawalValidationError extends Error {
  constructor() {
    super('Public-testnet withdrawal data is invalid');
    this.name = 'PublicTestnetWithdrawalValidationError';
  }
}

type PlainRecord = Record<string, unknown>;

function fail(): never {
  throw new PublicTestnetWithdrawalValidationError();
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
    keys.some(
      (name) => descriptors[name] === undefined || !Object.hasOwn(descriptors[name]!, 'value'),
    )
  ) {
    return fail();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) return fail();
  return value;
}

function positiveDecimal(value: unknown): string {
  const parsed = decimal(value);
  if (BigInt(parsed) <= 0n) return fail();
  return parsed;
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

function safeIntegerDecimal(value: unknown): number {
  const parsed = decimal(value);
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 0) return fail();
  return number;
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

function assertMemo(
  instruction: Transaction['instructions'][number] | undefined,
  intentId: string,
): void {
  const expected = Uint8Array.from(`crypto-lending:devnet-withdrawal:v1:${intentId}`, (character) =>
    character.charCodeAt(0),
  );
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_MEMO_PROGRAM ||
    instruction.keys.length !== 0 ||
    !bytesEqual(instruction.data, expected)
  ) {
    fail();
  }
}

function assertCreateTemporaryAccount(
  instruction: Transaction['instructions'][number] | undefined,
  account: string,
  temporaryAccount: string,
  seed: string,
  rentLamports: string,
): void {
  if (instruction === undefined || instruction.keys.length !== 2) return fail();
  let decoded: ReturnType<typeof SystemInstruction.decodeCreateWithSeed>;
  try {
    decoded = SystemInstruction.decodeCreateWithSeed(instruction);
  } catch {
    return fail();
  }
  if (
    decoded.fromPubkey.toBase58() !== account ||
    decoded.newAccountPubkey.toBase58() !== temporaryAccount ||
    decoded.basePubkey.toBase58() !== account ||
    decoded.seed !== seed ||
    decoded.lamports !== Number(rentLamports) ||
    decoded.space !== 165 ||
    decoded.programId.toBase58() !== PUBLIC_TESTNET_TOKEN_PROGRAM
  ) {
    fail();
  }
  assertKey(instruction.keys[0], account, true, true);
  assertKey(instruction.keys[1], temporaryAccount, false, true);
}

function assertInitializeAccount3(
  instruction: Transaction['instructions'][number] | undefined,
  account: string,
  temporaryAccount: string,
): void {
  const expectedData = Uint8Array.from([18, ...new PublicKey(account).toBytes()]);
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_TOKEN_PROGRAM ||
    instruction.keys.length !== 2 ||
    !bytesEqual(instruction.data, expectedData)
  ) {
    fail();
  }
  assertKey(instruction.keys[0], temporaryAccount, false, true);
  assertKey(instruction.keys[1], PUBLIC_TESTNET_WRAPPED_SOL_MINT, false, false);
}

function assertRedeem(
  instruction: Transaction['instructions'][number] | undefined,
  account: string,
  sourceCollateralAccount: string,
  temporaryAccount: string,
  collateralAmountAtomic: string,
): void {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  data[0] = 5;
  view.setBigUint64(1, BigInt(collateralAmountAtomic), true);
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_SAVE_PROGRAM ||
    instruction.keys.length !== 9 ||
    !bytesEqual(instruction.data, data)
  ) {
    fail();
  }
  const expected = [
    [sourceCollateralAccount, false, true],
    [temporaryAccount, false, true],
    [PUBLIC_TESTNET_SAVE_RESERVE, false, true],
    [PUBLIC_TESTNET_SAVE_COLLATERAL_MINT, false, true],
    [PUBLIC_TESTNET_SAVE_LIQUIDITY_VAULT, false, true],
    [PUBLIC_TESTNET_SAVE_MARKET, false, true],
    [PUBLIC_TESTNET_SAVE_MARKET_AUTHORITY, false, false],
    [account, true, true],
    [PUBLIC_TESTNET_TOKEN_PROGRAM, false, false],
  ] as const;
  expected.forEach(([address, signer, writable], index) =>
    assertKey(instruction.keys[index], address, signer, writable),
  );
}

function assertCloseTemporaryAccount(
  instruction: Transaction['instructions'][number] | undefined,
  account: string,
  temporaryAccount: string,
): void {
  if (
    instruction === undefined ||
    instruction.programId.toBase58() !== PUBLIC_TESTNET_TOKEN_PROGRAM ||
    instruction.keys.length !== 3 ||
    !bytesEqual(instruction.data, Uint8Array.of(9))
  ) {
    fail();
  }
  assertKey(instruction.keys[0], temporaryAccount, false, true);
  assertKey(instruction.keys[1], account, true, true);
  assertKey(instruction.keys[2], account, true, true);
}

function parseTransaction(
  value: unknown,
  account: string,
  intentId: string,
  collateralAmountAtomic: string,
  temporaryAccountRentLamports: string,
): PublicTestnetWithdrawalIntent['transaction'] {
  const record = exactRecord(value, [
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
  ]);
  if (
    record.encoding !== 'BASE64' ||
    record.messageVersion !== 'LEGACY' ||
    typeof record.temporaryAccountSeed !== 'string' ||
    !TEMPORARY_ACCOUNT_SEED.test(record.temporaryAccountSeed)
  ) {
    return fail();
  }
  const serialized = decodeBase64(record.serializedTransactionBase64);
  const recentBlockhash = normalizePublicTestnetAccount(record.recentBlockhash);
  const feePayer = normalizePublicTestnetAccount(record.feePayer);
  const sourceCollateralAccount = normalizePublicTestnetAccount(record.sourceCollateralAccount);
  const temporaryLiquidityAccount = normalizePublicTestnetAccount(record.temporaryLiquidityAccount);
  let transaction: Transaction;
  try {
    transaction = Transaction.from(serialized);
  } catch {
    return fail();
  }
  if (
    feePayer !== account ||
    transaction.feePayer?.toBase58() !== account ||
    transaction.recentBlockhash !== recentBlockhash ||
    transaction.signatures.length !== 1 ||
    transaction.signatures[0]?.publicKey.toBase58() !== account ||
    transaction.signatures[0]?.signature !== null ||
    !bytesEqual(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      serialized,
    ) ||
    sourceCollateralAccount !==
      PublicKey.findProgramAddressSync(
        [
          new PublicKey(account).toBytes(),
          new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM).toBytes(),
          new PublicKey(PUBLIC_TESTNET_SAVE_COLLATERAL_MINT).toBytes(),
        ],
        new PublicKey(PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM),
      )[0].toBase58() ||
    transaction.instructions.length !== 5
  ) {
    return fail();
  }
  assertMemo(transaction.instructions[0], intentId);
  assertCreateTemporaryAccount(
    transaction.instructions[1],
    account,
    temporaryLiquidityAccount,
    record.temporaryAccountSeed,
    temporaryAccountRentLamports,
  );
  assertInitializeAccount3(transaction.instructions[2], account, temporaryLiquidityAccount);
  assertRedeem(
    transaction.instructions[3],
    account,
    sourceCollateralAccount,
    temporaryLiquidityAccount,
    collateralAmountAtomic,
  );
  assertCloseTemporaryAccount(transaction.instructions[4], account, temporaryLiquidityAccount);
  return Object.freeze({
    encoding: 'BASE64' as const,
    messageVersion: 'LEGACY' as const,
    serializedTransactionBase64: record.serializedTransactionBase64 as string,
    recentBlockhash,
    lastValidBlockHeight: decimal(record.lastValidBlockHeight),
    minContextSlot: decimal(record.minContextSlot),
    feePayer,
    sourceCollateralAccount,
    temporaryLiquidityAccount,
    temporaryAccountSeed: record.temporaryAccountSeed,
  });
}

export function validatePublicTestnetWithdrawalRequest(
  value: PublicTestnetWithdrawalRequest,
): PublicTestnetWithdrawalRequest {
  const record = exactRecord(value, ['chainId', 'account']);
  if (record.chainId !== PUBLIC_TESTNET_CHAIN_ID) return fail();
  return Object.freeze({
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account: normalizePublicTestnetAccount(record.account),
  });
}

export function parsePublicTestnetWithdrawalIntent(
  value: unknown,
  expectedRequest: PublicTestnetWithdrawalRequest,
  now = new Date(),
): PublicTestnetWithdrawalIntent {
  const expected = validatePublicTestnetWithdrawalRequest(expectedRequest);
  const record = exactRecord(value, [
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
  ]);
  const account = normalizePublicTestnetAccount(record.account);
  const expiresAt = dateTime(record.expiresAt);
  const evidenceExpiresAt = dateTime(record.evidenceExpiresAt);
  const expiry = Date.parse(expiresAt);
  const evidenceExpiry = Date.parse(evidenceExpiresAt);
  if (
    record.use !== 'PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY' ||
    record.mayAuthorizeMainnetFinancialAction !== false ||
    typeof record.intentId !== 'string' ||
    !UUID_V4.test(record.intentId) ||
    record.chainId !== PUBLIC_TESTNET_CHAIN_ID ||
    account !== expected.account ||
    record.providerVisibility !== 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' ||
    !Number.isFinite(now.getTime()) ||
    expiry <= now.getTime() - CLOCK_SKEW_MILLISECONDS ||
    expiry - now.getTime() > MAX_INTENT_LIFETIME_MILLISECONDS + CLOCK_SKEW_MILLISECONDS ||
    evidenceExpiry <= expiry ||
    evidenceExpiry <= now.getTime() - CLOCK_SKEW_MILLISECONDS ||
    evidenceExpiry - now.getTime() > MAX_EVIDENCE_LIFETIME_MILLISECONDS + CLOCK_SKEW_MILLISECONDS
  ) {
    return fail();
  }
  const proof = exactRecord(record.proof, [
    'kind',
    'collateralAmountAtomic',
    'estimatedLiquidityAtomic',
    'collateralSymbol',
    'assetSymbol',
    'assetDecimals',
  ]);
  const collateralAmountAtomic = positiveDecimal(proof.collateralAmountAtomic);
  const estimatedLiquidityAtomic = positiveDecimal(proof.estimatedLiquidityAtomic);
  if (
    proof.kind !== 'FULL_TESTNET_POSITION_WITHDRAWAL' ||
    proof.collateralSymbol !== 'cSOL' ||
    proof.assetSymbol !== 'SOL' ||
    proof.assetDecimals !== 9
  ) {
    return fail();
  }
  const funding = exactRecord(record.fundingReadiness, [
    'status',
    'nativeBalanceLamports',
    'requiredNativeBalanceLamports',
    'temporaryAccountRentLamports',
    'faucetUrl',
  ]);
  if (
    (funding.status !== 'READY' && funding.status !== 'NEEDS_DEVNET_SOL') ||
    funding.requiredNativeBalanceLamports !== PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS ||
    funding.faucetUrl !== PUBLIC_TESTNET_FAUCET_URL
  ) {
    return fail();
  }
  const nativeBalanceLamports = decimal(funding.nativeBalanceLamports);
  const temporaryAccountRentLamports = positiveDecimal(funding.temporaryAccountRentLamports);
  safeIntegerDecimal(temporaryAccountRentLamports);
  if ((funding.status === 'READY') !== BigInt(nativeBalanceLamports) >= 20_000_000n) {
    return fail();
  }
  const live = exactRecord(record.liveObservation, [
    'confirmation',
    'slot',
    'observedAt',
    'collateralBalanceAtomic',
    'estimatedLiquidityAtomic',
    'reserveAvailableLiquidityAtomic',
  ]);
  const slot = decimal(live.slot);
  const reserveAvailableLiquidityAtomic = positiveDecimal(live.reserveAvailableLiquidityAtomic);
  if (
    live.confirmation !== 'FINALIZED_PREFLIGHT_OBSERVATION' ||
    live.collateralBalanceAtomic !== collateralAmountAtomic ||
    live.estimatedLiquidityAtomic !== estimatedLiquidityAtomic ||
    BigInt(reserveAvailableLiquidityAtomic) < BigInt(estimatedLiquidityAtomic)
  ) {
    return fail();
  }
  const transaction = parseTransaction(
    record.transaction,
    account,
    record.intentId,
    collateralAmountAtomic,
    temporaryAccountRentLamports,
  );
  if (
    safeIntegerDecimal(transaction.lastValidBlockHeight) === 0 ||
    safeIntegerDecimal(transaction.minContextSlot) === 0 ||
    transaction.minContextSlot !== slot
  ) {
    return fail();
  }
  return Object.freeze({
    use: 'PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY' as const,
    mayAuthorizeMainnetFinancialAction: false as const,
    intentId: record.intentId,
    expiresAt,
    evidenceExpiresAt,
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account,
    proof: Object.freeze({
      kind: 'FULL_TESTNET_POSITION_WITHDRAWAL' as const,
      collateralAmountAtomic,
      estimatedLiquidityAtomic,
      collateralSymbol: 'cSOL' as const,
      assetSymbol: 'SOL' as const,
      assetDecimals: 9 as const,
    }),
    transaction,
    fundingReadiness: Object.freeze({
      status: funding.status,
      nativeBalanceLamports,
      requiredNativeBalanceLamports: PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
      temporaryAccountRentLamports,
      faucetUrl: PUBLIC_TESTNET_FAUCET_URL,
    }),
    liveObservation: Object.freeze({
      confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION' as const,
      slot,
      observedAt: dateTime(live.observedAt),
      collateralBalanceAtomic: collateralAmountAtomic,
      estimatedLiquidityAtomic,
      reserveAvailableLiquidityAtomic,
    }),
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
  });
}

export function toSolanaPublicTestnetWithdrawalTransactionRequest(
  intent: PublicTestnetWithdrawalIntent,
): SolanaPublicTestnetTransactionRequest {
  return Object.freeze({
    serializedTransaction: decodeBase64(intent.transaction.serializedTransactionBase64),
    transactionVersion: 'legacy' as const,
    minContextSlot: safeIntegerDecimal(intent.transaction.minContextSlot),
  });
}

export function parsePublicTestnetWithdrawalResult(
  value: unknown,
  expected: Readonly<{ intentId: string; signature: string }>,
): PublicTestnetWithdrawalResult {
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
  const statuses: readonly PublicTestnetWithdrawalStatus[] = [
    'PENDING',
    'VERIFIED',
    'SETTLED_POSITION_REMAINS',
    'FAILED',
  ];
  if (
    record.intentId !== expected.intentId ||
    typeof record.status !== 'string' ||
    !statuses.includes(record.status as PublicTestnetWithdrawalStatus) ||
    record.confirmation !== 'LATEST_SIGNATURE_STATUS_OBSERVATION' ||
    typeof record.consumed !== 'boolean'
  ) {
    return fail();
  }
  const status = record.status as PublicTestnetWithdrawalStatus;
  const transaction = exactRecord(record.transaction, ['status', 'signature', 'slot']);
  const position = exactRecord(record.position, [
    'status',
    'collateralBalanceBeforeAtomic',
    'collateralBalanceAfterAtomic',
    'decreaseAtomic',
    'liquidityReceivedAtomic',
  ]);
  if (
    transaction.status !== status ||
    position.status !== status ||
    parsePublicTestnetTransactionSignature(transaction.signature) !== signature
  ) {
    return fail();
  }
  const before = positiveDecimal(position.collateralBalanceBeforeAtomic);
  const slot = transaction.slot === null ? null : decimal(transaction.slot);
  const after =
    position.collateralBalanceAfterAtomic === null
      ? null
      : decimal(position.collateralBalanceAfterAtomic);
  const decrease =
    position.decreaseAtomic === null ? null : positiveDecimal(position.decreaseAtomic);
  const liquidityReceived =
    position.liquidityReceivedAtomic === null
      ? null
      : positiveDecimal(position.liquidityReceivedAtomic);
  const pendingOrFailed = status === 'PENDING' || status === 'FAILED';
  if (
    (status === 'PENDING' && (slot !== null || record.consumed !== false)) ||
    (status !== 'PENDING' && record.consumed !== true) ||
    ((status === 'VERIFIED' || status === 'SETTLED_POSITION_REMAINS') && slot === null) ||
    (pendingOrFailed && (after !== null || decrease !== null || liquidityReceived !== null)) ||
    (!pendingOrFailed &&
      (after === null ||
        decrease === null ||
        liquidityReceived === null ||
        BigInt(before) - BigInt(after) !== BigInt(decrease))) ||
    (status === 'VERIFIED' && BigInt(after ?? '1') !== 0n) ||
    (status === 'SETTLED_POSITION_REMAINS' && BigInt(after ?? '0') <= 0n)
  ) {
    return fail();
  }
  return Object.freeze({
    intentId: expected.intentId,
    status,
    confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION' as const,
    transaction: Object.freeze({ status, signature, slot }),
    position: Object.freeze({
      status,
      collateralBalanceBeforeAtomic: before,
      collateralBalanceAfterAtomic: after,
      decreaseAtomic: decrease,
      liquidityReceivedAtomic: liquidityReceived,
    }),
    consumed: record.consumed,
  });
}

export async function claimPublicTestnetWithdrawal(
  api: PublicTestnetWithdrawalApi,
  request: PublicTestnetWithdrawalRequest,
  signal?: AbortSignal,
): Promise<ClaimedPublicTestnetWithdrawal> {
  const intent = await api.createWithdrawalIntent(request, signal);
  return Object.freeze({
    intent,
    transactionRequest: toSolanaPublicTestnetWithdrawalTransactionRequest(intent),
  });
}

export async function startClaimedPublicTestnetWithdrawal(
  api: PublicTestnetWithdrawalApi,
  wallet: SolanaPublicTestnetWalletPort,
  claim: ClaimedPublicTestnetWithdrawal,
  signal?: AbortSignal,
  polling: PublicTestnetWithdrawalPollingOptions = {},
): Promise<PublicTestnetWithdrawalStartOutcome> {
  if (claim.intent.fundingReadiness.status !== 'READY') {
    return Object.freeze({
      status: 'FAILED' as const,
      error: new PublicTestnetWithdrawalValidationError(),
    });
  }
  let operationLock: PublicTestnetOperationLock;
  try {
    operationLock = claimPublicTestnetOperationLock({
      operation: 'WITHDRAWAL',
      intentId: claim.intent.intentId,
      account: claim.intent.account,
    });
  } catch (error) {
    return Object.freeze({ status: 'FAILED' as const, error });
  }
  let signed: Awaited<ReturnType<SolanaPublicTestnetWalletPort['signTransaction']>>;
  try {
    signed = await wallet.signTransaction(claim.transactionRequest, claim.intent.account, signal);
  } catch (error) {
    try {
      clearPublicTestnetOperationLock(operationLock);
    } catch {
      // The durable lock fails closed when storage cannot prove removal.
    }
    return Object.freeze({ status: 'FAILED' as const, error });
  }
  let journal: ReturnType<typeof startPublicTestnetWithdrawalRecoveryJournal>;
  try {
    journal = startPublicTestnetWithdrawalRecoveryJournal({
      intentId: claim.intent.intentId,
      account: claim.intent.account,
      evidenceExpiresAt: claim.intent.evidenceExpiresAt,
      signature: signed.signature,
    });
  } catch (error) {
    try {
      clearPublicTestnetOperationLock(operationLock);
    } catch {
      // A storage failure remains a fail-closed local operation lock.
    }
    return Object.freeze({ status: 'FAILED' as const, error });
  }
  try {
    const result = await api.submitSignedWithdrawal(
      claim.intent.intentId,
      signed.signature,
      signed.serializedTransaction,
      signal,
    );
    if (result.status === 'PENDING') {
      return pollPublicTestnetWithdrawal(api, journal, signed.signature, result, signal, polling);
    }
    try {
      clearPublicTestnetWithdrawalRecoveryJournal(journal);
    } catch (error) {
      return Object.freeze({
        status: 'RECOVERY_REQUIRED' as const,
        signature: signed.signature,
        result,
        error,
      });
    }
    return Object.freeze({ status: 'COMPLETE' as const, signature: signed.signature, result });
  } catch (error) {
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      signature: signed.signature,
      error,
    });
  }
}

export async function startClaimedPublicTestnetWithdrawalWithDiscoveredWallet(
  api: PublicTestnetWithdrawalApi,
  claim: ClaimedPublicTestnetWithdrawal,
  signal?: AbortSignal,
  dependencies: PublicTestnetWithdrawalWalletDependencies = {},
): Promise<PublicTestnetWithdrawalStartOutcome> {
  const discovery = dependencies.createDiscovery?.() ?? new PhantomSolanaWalletDiscovery();
  let wallet: SolanaPublicTestnetWalletPort | null = null;
  try {
    discovery.start();
    const descriptors = discovery.list();
    if (descriptors.length !== 1 || descriptors[0] === undefined) {
      return Object.freeze({
        status: 'FAILED' as const,
        error: new PublicTestnetWithdrawalValidationError(),
      });
    }
    const selection = discovery.select(descriptors[0].selectionId);
    if (selection === null) {
      return Object.freeze({
        status: 'FAILED' as const,
        error: new PublicTestnetWithdrawalValidationError(),
      });
    }
    wallet =
      dependencies.createWallet?.(selection) ?? createSolanaPublicTestnetWalletExecutor(selection);
    const connectedAccount = await wallet.connect(signal);
    if (connectedAccount !== claim.intent.account) {
      return Object.freeze({
        status: 'FAILED' as const,
        error: new PublicTestnetWithdrawalValidationError(),
      });
    }
    return await startClaimedPublicTestnetWithdrawal(
      api,
      wallet,
      claim,
      signal,
      dependencies.polling,
    );
  } catch (error) {
    return Object.freeze({ status: 'FAILED' as const, error });
  } finally {
    wallet?.dispose();
    discovery.stop();
  }
}

function defaultPollingWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted', 'AbortError'));
      return;
    }
    const onAbort = (): void => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function pollPublicTestnetWithdrawal(
  api: PublicTestnetWithdrawalApi,
  journal: ReturnType<typeof startPublicTestnetWithdrawalRecoveryJournal>,
  signature: string,
  initial: PublicTestnetWithdrawalResult,
  signal: AbortSignal | undefined,
  options: PublicTestnetWithdrawalPollingOptions,
): Promise<PublicTestnetWithdrawalStartOutcome> {
  const intervalMilliseconds = options.intervalMilliseconds ?? 1_000;
  const maximumWaitMilliseconds = options.maximumWaitMilliseconds ?? 45_000;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? defaultPollingWait;
  if (
    !Number.isSafeInteger(intervalMilliseconds) ||
    intervalMilliseconds < 100 ||
    intervalMilliseconds > 5_000 ||
    !Number.isSafeInteger(maximumWaitMilliseconds) ||
    maximumWaitMilliseconds < 0 ||
    maximumWaitMilliseconds > 60_000
  ) {
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      signature,
      result: initial,
      error: new PublicTestnetWithdrawalValidationError(),
    });
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      signature,
      result: initial,
      error: new PublicTestnetWithdrawalValidationError(),
    });
  }
  const deadline = startedAt + maximumWaitMilliseconds;
  let latest = initial;
  let latestError: unknown;
  while (now() < deadline && !signal?.aborted) {
    try {
      await wait(Math.min(intervalMilliseconds, Math.max(0, deadline - now())), signal);
      latest = await api.verifyWithdrawal(journal.intentId, signature, signal);
      latestError = undefined;
      if (latest.status !== 'PENDING') {
        clearPublicTestnetWithdrawalRecoveryJournal(journal);
        return Object.freeze({ status: 'COMPLETE' as const, signature, result: latest });
      }
    } catch (error) {
      latestError = error;
      if (signal?.aborted) break;
    }
  }
  return Object.freeze({
    status: 'RECOVERY_REQUIRED' as const,
    signature,
    result: latest,
    ...(latestError === undefined ? {} : { error: latestError }),
  });
}

export function recoverPublicTestnetWithdrawal(
  api: PublicTestnetWithdrawalApi,
  claim: ClaimedPublicTestnetWithdrawal,
  signature: string,
  signal?: AbortSignal,
): Promise<PublicTestnetWithdrawalResult> {
  return recoverAndReleasePublicTestnetWithdrawal(
    api,
    claim.intent.intentId,
    claim.intent.account,
    signature,
    undefined,
    signal,
  );
}

async function recoverAndReleasePublicTestnetWithdrawal(
  api: PublicTestnetWithdrawalApi,
  intentId: string,
  account: string,
  signature: string,
  storage: PublicTestnetOperationLockStorage | undefined,
  signal?: AbortSignal,
): Promise<PublicTestnetWithdrawalResult> {
  const journal = readPublicTestnetWithdrawalRecoveryJournal(storage);
  if (
    journal === null ||
    journal.intentId !== intentId ||
    journal.account !== account ||
    journal.signature !== signature
  ) {
    return fail();
  }
  const result = await api.verifyWithdrawal(intentId, signature, signal);
  if (result.status !== 'PENDING') {
    clearPublicTestnetWithdrawalRecoveryJournal(journal, storage);
  }
  return result;
}

export async function recoverStoredPublicTestnetWithdrawal(
  api: PublicTestnetWithdrawalApi,
  storage?: PublicTestnetOperationLockStorage,
  signal?: AbortSignal,
): Promise<PublicTestnetWithdrawalResult | null> {
  const journal = readPublicTestnetWithdrawalRecoveryJournal(storage);
  if (journal === null) return null;
  return recoverAndReleasePublicTestnetWithdrawal(
    api,
    journal.intentId,
    journal.account,
    journal.signature,
    storage,
    signal,
  );
}
