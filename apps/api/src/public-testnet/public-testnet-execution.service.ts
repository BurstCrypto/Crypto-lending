import { createPublicKey, randomUUID, verify as verifyEd25519, type KeyObject } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

import type { AccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import { validateEd25519PublicKeyBytes } from '../infrastructure/security/ed25519-public-key';
import {
  LocalDemoAllocationService,
  type LocalDemoAllocationSelection,
} from '../local-demo/local-demo-allocation.service';
import {
  PUBLIC_TESTNET_ASSET_DECIMALS,
  PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_COLLATERAL_MINT,
  PUBLIC_TESTNET_CREATE_ASSOCIATED_TOKEN_IDEMPOTENT_TAG,
  PUBLIC_TESTNET_DEPOSIT_RESERVE_LIQUIDITY_TAG,
  PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS,
  PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS,
  PUBLIC_TESTNET_LENDING_MARKET,
  PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
  PUBLIC_TESTNET_LENDING_PROGRAM,
  PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT,
  PUBLIC_TESTNET_MAX_INTENTS,
  PUBLIC_TESTNET_MEMO_PREFIX,
  PUBLIC_TESTNET_MEMO_PROGRAM,
  PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC,
  PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC_TEXT,
  PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
  PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
  PUBLIC_TESTNET_SOL_FAUCET,
  PUBLIC_TESTNET_SOL_RESERVE,
  PUBLIC_TESTNET_SYNC_NATIVE_TAG,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
} from './public-testnet-execution.constants';
import {
  PUBLIC_TESTNET_EXECUTION_CONFIG,
  type PublicTestnetExecutionConfig,
} from './public-testnet-execution.config';
import {
  PUBLIC_TESTNET_EXECUTION_RPC,
  PublicTestnetEvidenceMismatchError,
  assertPublicTestnetSignedTransactionMatchesIntent,
  type PublicTestnetExecutionRpc,
  type PublicTestnetPositionObservation,
  type PublicTestnetTransactionObservation,
  type PublicTestnetVerificationExpectation,
} from './public-testnet-execution.rpc';

export type PublicTestnetFundingReadiness = 'READY' | 'NEEDS_DEVNET_SOL';

export interface PublicTestnetIntentRequest {
  readonly portfolioSnapshotId: string;
  readonly selection: Readonly<{
    kind: 'PRESET';
    presetId: 'BALANCED';
    liquidReserveBasisPoints: number;
  }>;
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface PublicTestnetIntentResponse {
  readonly use: 'PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY';
  readonly mayAuthorizeMainnetFinancialAction: false;
  readonly intentId: string;
  readonly expiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
  readonly portfolioBinding: Readonly<{
    portfolioSnapshotId: string;
    selection: PublicTestnetIntentRequest['selection'];
  }>;
  readonly proof: Readonly<{
    kind: 'SINGLE_TESTNET_PROOF_POSITION';
    amountAtomic: typeof PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC_TEXT;
    assetSymbol: 'SOL';
    assetDecimals: typeof PUBLIC_TESTNET_ASSET_DECIMALS;
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
  readonly fundingReadiness: Readonly<{
    status: PublicTestnetFundingReadiness;
    nativeBalanceLamports: string;
    requiredNativeBalanceLamports: '20000000';
    faucetUrl: typeof PUBLIC_TESTNET_SOL_FAUCET;
  }>;
  readonly liveObservation: Readonly<{
    confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION';
    slot: string;
    observedAt: string;
    reserveLiquidityAtomic: string;
  }>;
  readonly providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER';
}

export interface PublicTestnetSubmissionRequest {
  readonly signature: string;
  readonly signedTransactionBase64?: string;
}

export interface PublicTestnetPositionRequest {
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface PublicTestnetPositionResponse {
  readonly use: 'PUBLIC_TESTNET_READ_ONLY_POSITION';
  readonly mayAuthorizeFinancialAction: false;
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
  readonly provider: Readonly<{
    name: 'Save / Solend';
    program: string;
    market: string;
    reserve: string;
  }>;
  readonly position: Readonly<{
    status: 'OPEN' | 'EMPTY';
    assetSymbol: 'SOL';
    assetDecimals: typeof PUBLIC_TESTNET_ASSET_DECIMALS;
    suppliedLiquidityAtomic: string;
    collateralTokenSymbol: 'cSOL';
    collateralTokenAtomic: string;
    collateralTokenDecimals: typeof PUBLIC_TESTNET_ASSET_DECIMALS;
  }>;
  readonly rate: Readonly<{
    kind: 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY';
    supplyApyBasisPoints: number;
    utilizationBasisPoints: number;
    variable: true;
    rewardsIncluded: false;
    riskAssessed: false;
    historyAvailable: false;
    reserveLastUpdatedSlot: string;
    reserveMarkedStale: boolean;
  }>;
  readonly liveObservation: Readonly<{
    confirmation: 'FINALIZED_POSITION_OBSERVATION';
    slot: string;
    observedAt: string;
  }>;
}

type StepStatus = 'PENDING' | 'VERIFIED';

export interface PublicTestnetVerificationResponse {
  readonly intentId: string;
  readonly status: StepStatus;
  readonly confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION';
  readonly transaction: Readonly<{
    status: StepStatus;
    signature: string;
    slot: string | null;
  }>;
  readonly position: Readonly<{
    status: StepStatus;
    collateralBalanceBeforeAtomic: string;
    collateralBalanceAfterAtomic: string | null;
    increaseAtomic: string | null;
  }>;
  readonly consumed: boolean;
}

export class PublicTestnetIntentNotFoundError extends Error {}
export class PublicTestnetIntentExpiredError extends Error {}
export class PublicTestnetIntentConflictError extends Error {}
export class PublicTestnetIntentCapacityError extends Error {}

interface StoredIntent {
  readonly accountId: AccountId;
  readonly wallet: PublicKey;
  readonly expiresAtMilliseconds: number;
  readonly evidenceDeadlineMilliseconds: number;
  readonly expectedMessageBase64: string;
  readonly preflightSlot: bigint;
  readonly lastValidBlockHeight: bigint;
  readonly sourceLiquidityAccount: PublicKey;
  readonly destinationCollateralAccount: PublicKey;
  readonly collateralBalanceBeforeAtomic: bigint;
  readonly response: PublicTestnetIntentResponse;
  submission?: PublicTestnetSubmissionRequest;
  unboundVerification?: Readonly<{
    signature: string;
    result: Promise<PublicTestnetVerificationResponse>;
  }>;
  verification?: Promise<PublicTestnetVerificationResponse>;
  verified?: PublicTestnetVerificationResponse;
}

function associatedTokenInstruction(
  payer: PublicKey,
  associatedAccount: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedAccount, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: PUBLIC_TESTNET_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([PUBLIC_TESTNET_CREATE_ASSOCIATED_TOKEN_IDEMPOTENT_TAG]),
  });
}

function intentMemoInstruction(intentId: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_MEMO_PROGRAM,
    keys: [],
    data: Buffer.from(`${PUBLIC_TESTNET_MEMO_PREFIX}${intentId}`, 'utf8'),
  });
}

function syncNativeInstruction(sourceLiquidityAccount: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_TOKEN_PROGRAM,
    keys: [{ pubkey: sourceLiquidityAccount, isSigner: false, isWritable: true }],
    data: Buffer.from([PUBLIC_TESTNET_SYNC_NATIVE_TAG]),
  });
}

function depositReserveLiquidityInstruction(
  wallet: PublicKey,
  sourceLiquidityAccount: PublicKey,
  destinationCollateralAccount: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = PUBLIC_TESTNET_DEPOSIT_RESERVE_LIQUIDITY_TAG;
  data.writeBigUInt64LE(PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC, 1);
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_LENDING_PROGRAM,
    keys: [
      { pubkey: sourceLiquidityAccount, isSigner: false, isWritable: true },
      { pubkey: destinationCollateralAccount, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_SOL_RESERVE, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_COLLATERAL_MINT, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_LENDING_MARKET, isSigner: false, isWritable: false },
      { pubkey: PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: wallet, isSigner: true, isWritable: false },
      { pubkey: PUBLIC_TESTNET_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildPublicTestnetUnsignedTransaction(
  wallet: PublicKey,
  sourceLiquidityAccount: PublicKey,
  destinationCollateralAccount: PublicKey,
  recentBlockhash: string,
  intentId: string,
): Transaction {
  return new Transaction({ feePayer: wallet, recentBlockhash }).add(
    intentMemoInstruction(intentId),
    associatedTokenInstruction(wallet, sourceLiquidityAccount, PUBLIC_TESTNET_WRAPPED_SOL_MINT),
    SystemProgram.transfer({
      fromPubkey: wallet,
      toPubkey: sourceLiquidityAccount,
      lamports: PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC,
    }),
    syncNativeInstruction(sourceLiquidityAccount),
    associatedTokenInstruction(
      wallet,
      destinationCollateralAccount,
      PUBLIC_TESTNET_COLLATERAL_MINT,
    ),
    depositReserveLiquidityInstruction(
      wallet,
      sourceLiquidityAccount,
      destinationCollateralAccount,
    ),
  );
}

function sameSubmission(
  left: PublicTestnetSubmissionRequest,
  right: PublicTestnetSubmissionRequest,
): boolean {
  if (left.signature !== right.signature) return false;
  if (left.signedTransactionBase64 === undefined) {
    return right.signedTransactionBase64 === undefined;
  }
  return (
    right.signedTransactionBase64 === undefined ||
    right.signedTransactionBase64 === left.signedTransactionBase64
  );
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function decodeSignature(value: string): Buffer | undefined {
  if (value.length < 64 || value.length > 88) return undefined;
  const output: number[] = [0];
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return undefined;
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
  while (leadingZeroes < value.length - 1 && value[leadingZeroes] === '1') {
    leadingZeroes += 1;
  }
  if (leadingZeroes + output.length !== 64) return undefined;
  const decoded = Buffer.alloc(64);
  for (let index = 0; index < output.length; index += 1) {
    decoded[decoded.length - 1 - index] = output[index] ?? 0;
  }
  return decoded;
}

type IntentSignatureVerification =
  'VERIFIED' | 'MALFORMED_SIGNATURE' | 'INVALID_SIGNATURE' | 'INVALID_PUBLIC_KEY';

function verifiesIntentSignature(
  intent: StoredIntent,
  encodedSignature: string,
): IntentSignatureVerification {
  const signature = decodeSignature(encodedSignature);
  if (signature === undefined) return 'MALFORMED_SIGNATURE';
  let publicKey: KeyObject;
  try {
    const publicKeyBytes = intent.wallet.toBuffer();
    validateEd25519PublicKeyBytes(publicKeyBytes);
    publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return 'INVALID_PUBLIC_KEY';
  }
  try {
    return verifyEd25519(
      null,
      Buffer.from(intent.expectedMessageBase64, 'base64'),
      publicKey,
      signature,
    )
      ? 'VERIFIED'
      : 'INVALID_SIGNATURE';
  } catch {
    return 'INVALID_SIGNATURE';
  }
}

@Injectable()
export class PublicTestnetExecutionService {
  private readonly intents = new Map<string, StoredIntent>();
  private readonly signatureIntents = new Map<string, string>();

  constructor(
    private readonly allocations: LocalDemoAllocationService,
    @Inject(PUBLIC_TESTNET_EXECUTION_RPC) private readonly rpc: PublicTestnetExecutionRpc,
    @Inject(PUBLIC_TESTNET_EXECUTION_CONFIG) private readonly config: PublicTestnetExecutionConfig,
  ) {}

  async readPosition(
    accountId: AccountId,
    request: PublicTestnetPositionRequest,
  ): Promise<PublicTestnetPositionResponse> {
    this.assertEnabled();
    void accountId;
    const wallet = new PublicKey(request.account);
    const observation: PublicTestnetPositionObservation = await this.rpc.readPosition(wallet);
    return Object.freeze({
      use: 'PUBLIC_TESTNET_READ_ONLY_POSITION' as const,
      mayAuthorizeFinancialAction: false as const,
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: wallet.toBase58(),
      provider: Object.freeze({
        name: 'Save / Solend' as const,
        program: PUBLIC_TESTNET_LENDING_PROGRAM.toBase58(),
        market: PUBLIC_TESTNET_LENDING_MARKET.toBase58(),
        reserve: PUBLIC_TESTNET_SOL_RESERVE.toBase58(),
      }),
      position: Object.freeze({
        status: observation.collateralBalanceAtomic > 0n ? ('OPEN' as const) : ('EMPTY' as const),
        assetSymbol: 'SOL' as const,
        assetDecimals: PUBLIC_TESTNET_ASSET_DECIMALS,
        suppliedLiquidityAtomic: observation.suppliedLiquidityAtomic.toString(),
        collateralTokenSymbol: 'cSOL' as const,
        collateralTokenAtomic: observation.collateralBalanceAtomic.toString(),
        collateralTokenDecimals: PUBLIC_TESTNET_ASSET_DECIMALS,
      }),
      rate: Object.freeze({
        kind: 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY' as const,
        supplyApyBasisPoints: observation.supplyApyBasisPoints,
        utilizationBasisPoints: observation.utilizationBasisPoints,
        variable: true as const,
        rewardsIncluded: false as const,
        riskAssessed: false as const,
        historyAvailable: false as const,
        reserveLastUpdatedSlot: observation.reserveLastUpdatedSlot.toString(),
        reserveMarkedStale: observation.reserveMarkedStale,
      }),
      liveObservation: Object.freeze({
        confirmation: 'FINALIZED_POSITION_OBSERVATION' as const,
        slot: observation.slot.toString(),
        observedAt: observation.observedAt,
      }),
    });
  }

  async createIntent(
    accountId: AccountId,
    correlation: JobCorrelationContext,
    request: PublicTestnetIntentRequest,
  ): Promise<PublicTestnetIntentResponse> {
    this.assertEnabled();
    this.prune();
    this.assertCapacity(accountId);
    const wallet = new PublicKey(request.account);
    const preview = await this.allocations.preview(
      accountId,
      correlation,
      request.portfolioSnapshotId,
      request.selection as LocalDemoAllocationSelection,
    );
    if (
      preview.portfolioSnapshotId !== request.portfolioSnapshotId ||
      preview.selection.kind !== 'PRESET' ||
      preview.selection.presetId !== 'BALANCED' ||
      preview.selection.liquidReserveBasisPoints !== request.selection.liquidReserveBasisPoints
    ) {
      throw new PublicTestnetEvidenceMismatchError();
    }

    const observation = await this.rpc.preflight(wallet);
    const intentId = randomUUID();
    const unsignedTransaction = buildPublicTestnetUnsignedTransaction(
      wallet,
      observation.sourceLiquidityAccount,
      observation.destinationCollateralAccount,
      observation.blockhash,
      intentId,
    );
    const serializedTransactionBase64 = unsignedTransaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
    const expectedMessageBase64 = unsignedTransaction.serializeMessage().toString('base64');
    const now = Date.now();
    const expiresAtMilliseconds = now + PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS;
    const evidenceDeadlineMilliseconds = now + PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS;
    const selection = Object.freeze({
      kind: 'PRESET' as const,
      presetId: 'BALANCED' as const,
      liquidReserveBasisPoints: request.selection.liquidReserveBasisPoints,
    });
    const walletAddress = wallet.toBase58();
    const response: PublicTestnetIntentResponse = Object.freeze({
      use: 'PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY' as const,
      mayAuthorizeMainnetFinancialAction: false as const,
      intentId,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      evidenceExpiresAt: new Date(evidenceDeadlineMilliseconds).toISOString(),
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: walletAddress,
      portfolioBinding: Object.freeze({
        portfolioSnapshotId: request.portfolioSnapshotId,
        selection,
      }),
      proof: Object.freeze({
        kind: 'SINGLE_TESTNET_PROOF_POSITION' as const,
        amountAtomic: PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC_TEXT,
        assetSymbol: 'SOL' as const,
        assetDecimals: PUBLIC_TESTNET_ASSET_DECIMALS,
        notFullBlend: true as const,
      }),
      transaction: Object.freeze({
        encoding: 'BASE64' as const,
        messageVersion: 'LEGACY' as const,
        serializedTransactionBase64,
        recentBlockhash: observation.blockhash,
        lastValidBlockHeight: observation.lastValidBlockHeight.toString(),
        minContextSlot: observation.slot.toString(),
        feePayer: walletAddress,
        sourceLiquidityAccount: observation.sourceLiquidityAccount.toBase58(),
        destinationCollateralAccount: observation.destinationCollateralAccount.toBase58(),
      }),
      fundingReadiness: Object.freeze({
        status:
          observation.nativeBalanceLamports >= PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS
            ? ('READY' as const)
            : ('NEEDS_DEVNET_SOL' as const),
        nativeBalanceLamports: observation.nativeBalanceLamports.toString(),
        requiredNativeBalanceLamports: '20000000' as const,
        faucetUrl: PUBLIC_TESTNET_SOL_FAUCET,
      }),
      liveObservation: Object.freeze({
        confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION' as const,
        slot: observation.slot.toString(),
        observedAt: observation.observedAt,
        reserveLiquidityAtomic: observation.reserveLiquidityAtomic.toString(),
      }),
      providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
    });
    const storedIntent: StoredIntent = {
      accountId,
      wallet,
      expiresAtMilliseconds,
      evidenceDeadlineMilliseconds,
      expectedMessageBase64,
      preflightSlot: observation.slot,
      lastValidBlockHeight: observation.lastValidBlockHeight,
      sourceLiquidityAccount: observation.sourceLiquidityAccount,
      destinationCollateralAccount: observation.destinationCollateralAccount,
      collateralBalanceBeforeAtomic: observation.collateralBalanceBeforeAtomic,
      response,
    };
    // No await may appear between this second capacity check and insertion.
    // Concurrent intent builders therefore observe every prior insertion.
    this.prune();
    this.assertCapacity(accountId);
    this.intents.set(intentId, storedIntent);
    return response;
  }

  async verifySubmission(
    accountId: AccountId,
    intentId: string,
    submission: PublicTestnetSubmissionRequest,
  ): Promise<PublicTestnetVerificationResponse> {
    this.assertEnabled();
    const intent = this.intents.get(intentId);
    if (intent === undefined || intent.accountId !== accountId) {
      throw new PublicTestnetIntentNotFoundError();
    }
    if (Date.now() >= intent.evidenceDeadlineMilliseconds) {
      this.removeIntent(intentId, intent);
      if (intent.submission !== undefined) throw new PublicTestnetIntentNotFoundError();
      throw new PublicTestnetIntentExpiredError();
    }
    const signatureIntentId = this.signatureIntents.get(submission.signature);
    if (signatureIntentId !== undefined && signatureIntentId !== intentId) {
      throw new PublicTestnetIntentConflictError();
    }
    if (intent.submission !== undefined && !sameSubmission(intent.submission, submission)) {
      throw new PublicTestnetIntentConflictError();
    }
    if (intent.verified !== undefined) return intent.verified;
    if (intent.submission === undefined && submission.signedTransactionBase64 !== undefined) {
      if (Date.now() >= intent.expiresAtMilliseconds) {
        throw new PublicTestnetIntentExpiredError();
      }
      const signedSubmission = Object.freeze({
        signature: submission.signature,
        signedTransactionBase64: submission.signedTransactionBase64,
      });
      const expectation = this.verificationExpectation(intent);
      // Reject malformed or wallet-mutated bytes before they can consume the
      // intent. Once validated, bind both signature and exact wire bytes before
      // making the single external send attempt.
      assertPublicTestnetSignedTransactionMatchesIntent(signedSubmission, expectation);
      intent.submission = signedSubmission;
      this.signatureIntents.set(submission.signature, intentId);
      const verification = this.broadcastAndVerify(
        accountId,
        intentId,
        intent,
        signedSubmission,
        expectation,
      ).finally(() => {
        delete intent.verification;
      });
      intent.verification = verification;
      return verification;
    }
    if (intent.submission === undefined) {
      // Authenticate the intent-bound transaction message before reserving this
      // globally unique signature. A signature for another intent must not be
      // able to squat this intent's binding.
      const signatureVerification = verifiesIntentSignature(intent, submission.signature);
      if (
        signatureVerification === 'MALFORMED_SIGNATURE' ||
        signatureVerification === 'INVALID_PUBLIC_KEY'
      ) {
        throw new PublicTestnetEvidenceMismatchError();
      }
      if (signatureVerification === 'INVALID_SIGNATURE') {
        return this.verifyUnboundWalletModifiedSubmission(accountId, intentId, intent, submission);
      }
      intent.submission = Object.freeze({ ...submission });
      this.signatureIntents.set(submission.signature, intentId);
    }
    if (intent.verification !== undefined) return intent.verification;
    const verification = this.performVerification(
      accountId,
      intentId,
      intent,
      intent.submission,
    ).finally(() => {
      delete intent.verification;
    });
    intent.verification = verification;
    return verification;
  }

  private async broadcastAndVerify(
    accountId: AccountId,
    intentId: string,
    intent: StoredIntent,
    submission: Required<PublicTestnetSubmissionRequest>,
    expectation: PublicTestnetVerificationExpectation,
  ): Promise<PublicTestnetVerificationResponse> {
    await this.rpc.broadcastSignedTransaction(submission, expectation);
    return this.performVerification(accountId, intentId, intent, submission);
  }

  private verifyUnboundWalletModifiedSubmission(
    accountId: AccountId,
    intentId: string,
    intent: StoredIntent,
    submission: PublicTestnetSubmissionRequest,
  ): Promise<PublicTestnetVerificationResponse> {
    const inFlight = intent.unboundVerification;
    if (inFlight !== undefined) {
      if (inFlight.signature !== submission.signature) {
        throw new PublicTestnetIntentConflictError();
      }
      return inFlight.result;
    }

    const result = this.performUnboundWalletModifiedSubmission(
      accountId,
      intentId,
      intent,
      submission,
    ).finally(() => {
      if (intent.unboundVerification?.result === result) delete intent.unboundVerification;
    });
    intent.unboundVerification = Object.freeze({ signature: submission.signature, result });
    return result;
  }

  private async performUnboundWalletModifiedSubmission(
    accountId: AccountId,
    intentId: string,
    intent: StoredIntent,
    submission: PublicTestnetSubmissionRequest,
  ): Promise<PublicTestnetVerificationResponse> {
    // A detached Ed25519 signature cannot reveal a message changed by the
    // wallet. Consult finalized chain evidence first, and do not reserve an
    // unproven signature while it is pending or if it is rejected.
    const observation = await this.observeDeposit(intent, submission);

    this.assertCurrentIntentAfterObservation(accountId, intentId, intent);
    const signatureIntentId = this.signatureIntents.get(submission.signature);
    if (signatureIntentId !== undefined && signatureIntentId !== intentId) {
      throw new PublicTestnetIntentConflictError();
    }
    if (intent.submission !== undefined && !sameSubmission(intent.submission, submission)) {
      throw new PublicTestnetIntentConflictError();
    }
    if (intent.verified !== undefined) return intent.verified;

    const result = this.verificationResponse(intent, submission, observation);
    if (observation.status === 'PENDING') return result;

    // No await may appear between these checks and the binding writes. Two
    // finalized candidates therefore cannot both consume the same intent.
    intent.submission = Object.freeze({ ...submission });
    this.signatureIntents.set(submission.signature, intentId);
    intent.verified = result;
    return result;
  }

  private async performVerification(
    accountId: AccountId,
    intentId: string,
    intent: StoredIntent,
    submission: PublicTestnetSubmissionRequest,
  ): Promise<PublicTestnetVerificationResponse> {
    const observation = await this.observeDeposit(intent, submission);
    this.assertCurrentIntentAfterObservation(accountId, intentId, intent);
    const result = this.verificationResponse(intent, submission, observation);
    if (observation.status === 'VERIFIED') intent.verified = result;
    return result;
  }

  private async observeDeposit(
    intent: StoredIntent,
    submission: PublicTestnetSubmissionRequest,
  ): Promise<PublicTestnetTransactionObservation> {
    const observation = await this.rpc.verifyFinalizedDeposit(
      submission.signature,
      this.verificationExpectation(intent),
    );
    if (
      observation.status === 'VERIFIED' &&
      observation.collateralBalanceBeforeAtomic !== intent.collateralBalanceBeforeAtomic
    ) {
      throw new PublicTestnetEvidenceMismatchError();
    }
    return observation;
  }

  private verificationExpectation(intent: StoredIntent): PublicTestnetVerificationExpectation {
    return Object.freeze({
      wallet: intent.wallet,
      sourceLiquidityAccount: intent.sourceLiquidityAccount,
      destinationCollateralAccount: intent.destinationCollateralAccount,
      expectedMessageBase64: intent.expectedMessageBase64,
      preflightSlot: intent.preflightSlot,
      lastValidBlockHeight: intent.lastValidBlockHeight,
    });
  }

  private assertCurrentIntentAfterObservation(
    accountId: AccountId,
    intentId: string,
    intent: StoredIntent,
  ): void {
    const currentIntent = this.intents.get(intentId);
    if (currentIntent !== intent || intent.accountId !== accountId) {
      throw new PublicTestnetIntentNotFoundError();
    }
    if (Date.now() >= intent.evidenceDeadlineMilliseconds) {
      this.removeIntent(intentId, intent);
      if (intent.submission !== undefined) throw new PublicTestnetIntentNotFoundError();
      throw new PublicTestnetIntentExpiredError();
    }
  }

  private verificationResponse(
    intent: StoredIntent,
    submission: PublicTestnetSubmissionRequest,
    observation: PublicTestnetTransactionObservation,
  ): PublicTestnetVerificationResponse {
    const verified = observation.status === 'VERIFIED';
    return Object.freeze({
      intentId: intent.response.intentId,
      status: verified ? ('VERIFIED' as const) : ('PENDING' as const),
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION' as const,
      transaction: Object.freeze({
        status: verified ? ('VERIFIED' as const) : ('PENDING' as const),
        signature: submission.signature,
        slot: verified ? observation.slot.toString() : null,
      }),
      position: Object.freeze({
        status: verified ? ('VERIFIED' as const) : ('PENDING' as const),
        collateralBalanceBeforeAtomic: intent.collateralBalanceBeforeAtomic.toString(),
        collateralBalanceAfterAtomic: verified
          ? observation.collateralBalanceAfterAtomic.toString()
          : null,
        increaseAtomic: verified ? observation.increaseAtomic.toString() : null,
      }),
      consumed: verified,
    });
  }

  private assertCapacity(accountId: AccountId): void {
    if (this.intents.size >= PUBLIC_TESTNET_MAX_INTENTS) {
      throw new PublicTestnetIntentCapacityError();
    }
    const activeForAccount = [...this.intents.values()].filter(
      (intent) =>
        intent.accountId === accountId &&
        intent.verified === undefined &&
        Date.now() < intent.expiresAtMilliseconds,
    ).length;
    if (activeForAccount >= PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT) {
      throw new PublicTestnetIntentCapacityError();
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [intentId, intent] of this.intents) {
      if (now >= intent.evidenceDeadlineMilliseconds) this.removeIntent(intentId, intent);
    }
  }

  private removeIntent(intentId: string, intent: StoredIntent): void {
    this.intents.delete(intentId);
    const signature = intent.submission?.signature;
    if (signature !== undefined && this.signatureIntents.get(signature) === intentId) {
      this.signatureIntents.delete(signature);
    }
  }

  private assertEnabled(): void {
    if (this.config.mode !== 'enabled') throw new PublicTestnetIntentNotFoundError();
  }
}
