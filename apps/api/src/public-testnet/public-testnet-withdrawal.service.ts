import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

import type { AccountId } from '../accounts/domain/account-profile';
import {
  PUBLIC_TESTNET_ASSET_DECIMALS,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_CLOSE_ACCOUNT_TAG,
  PUBLIC_TESTNET_COLLATERAL_MINT,
  PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS,
  PUBLIC_TESTNET_INITIALIZE_ACCOUNT_3_TAG,
  PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS,
  PUBLIC_TESTNET_LENDING_MARKET,
  PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
  PUBLIC_TESTNET_LENDING_PROGRAM,
  PUBLIC_TESTNET_MAX_ACTIVE_WITHDRAWALS_PER_ACCOUNT,
  PUBLIC_TESTNET_MAX_INTENTS,
  PUBLIC_TESTNET_MAX_TRANSACTION_BYTES,
  PUBLIC_TESTNET_MEMO_PROGRAM,
  PUBLIC_TESTNET_REDEEM_RESERVE_COLLATERAL_TAG,
  PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
  PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
  PUBLIC_TESTNET_SOL_FAUCET,
  PUBLIC_TESTNET_SOL_RESERVE,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_WITHDRAWAL_MEMO_PREFIX,
  PUBLIC_TESTNET_WITHDRAWAL_TERMINAL_RETENTION_MILLISECONDS,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
  derivePublicTestnetAssociatedTokenAddress,
} from './public-testnet-execution.constants';
import {
  PUBLIC_TESTNET_EXECUTION_CONFIG,
  type PublicTestnetExecutionConfig,
} from './public-testnet-execution.config';
import {
  PUBLIC_TESTNET_EXECUTION_RPC,
  PublicTestnetEvidenceMismatchError,
  PublicTestnetRpcUnavailableError,
  assertPublicTestnetSignedTransactionMatchesIntent,
  type PublicTestnetExecutionRpc,
  type PublicTestnetWithdrawalTransactionObservation,
  type PublicTestnetWithdrawalVerificationExpectation,
} from './public-testnet-execution.rpc';
import type { PublicTestnetSubmissionRequest } from './public-testnet-execution.service';
import {
  PublicTestnetIntentCapacityError,
  PublicTestnetIntentConflictError,
  PublicTestnetIntentExpiredError,
  PublicTestnetIntentNotFoundError,
} from './public-testnet-execution.service';

const TOKEN_ACCOUNT_SPACE = 165;

export interface PublicTestnetWithdrawalRequest {
  readonly chainId: typeof PUBLIC_TESTNET_CHAIN_ID;
  readonly account: string;
}

export interface PublicTestnetWithdrawalIntentResponse {
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
    assetDecimals: typeof PUBLIC_TESTNET_ASSET_DECIMALS;
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
    requiredNativeBalanceLamports: '20000000';
    temporaryAccountRentLamports: string;
    faucetUrl: typeof PUBLIC_TESTNET_SOL_FAUCET;
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

export interface PublicTestnetWithdrawalVerificationResponse {
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

interface StoredWithdrawalIntent {
  readonly accountId: AccountId;
  readonly wallet: PublicKey;
  readonly expiresAtMilliseconds: number;
  readonly evidenceDeadlineMilliseconds: number;
  readonly expectedMessageBase64: string;
  readonly preflightSlot: bigint;
  readonly lastValidBlockHeight: bigint;
  readonly sourceCollateralAccount: PublicKey;
  readonly temporaryLiquidityAccount: PublicKey;
  readonly collateralAmountAtomic: bigint;
  readonly response: PublicTestnetWithdrawalIntentResponse;
  submission?: PublicTestnetSubmissionRequest;
  verification?: Promise<PublicTestnetWithdrawalVerificationResponse>;
  terminal?: PublicTestnetWithdrawalVerificationResponse;
  terminalAtMilliseconds?: number;
}

function withdrawalSeed(intentId: string, wallet: PublicKey): string {
  const digest = createHash('sha256')
    .update('crypto-lending:devnet-withdrawal-account:v1\0', 'utf8')
    .update(intentId, 'utf8')
    .update(wallet.toBuffer())
    .digest('hex');
  return `wdv1:${digest.slice(0, 27)}`;
}

function memoInstruction(intentId: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_MEMO_PROGRAM,
    keys: [],
    data: Buffer.from(`${PUBLIC_TESTNET_WITHDRAWAL_MEMO_PREFIX}${intentId}`, 'utf8'),
  });
}

function initializeAccount3Instruction(
  temporaryLiquidityAccount: PublicKey,
  wallet: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_TOKEN_PROGRAM,
    keys: [
      { pubkey: temporaryLiquidityAccount, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_WRAPPED_SOL_MINT, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([PUBLIC_TESTNET_INITIALIZE_ACCOUNT_3_TAG]),
      wallet.toBuffer(),
    ]),
  });
}

function redeemReserveCollateralInstruction(
  wallet: PublicKey,
  sourceCollateralAccount: PublicKey,
  temporaryLiquidityAccount: PublicKey,
  collateralAmountAtomic: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = PUBLIC_TESTNET_REDEEM_RESERVE_COLLATERAL_TAG;
  data.writeBigUInt64LE(collateralAmountAtomic, 1);
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_LENDING_PROGRAM,
    keys: [
      { pubkey: sourceCollateralAccount, isSigner: false, isWritable: true },
      { pubkey: temporaryLiquidityAccount, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_SOL_RESERVE, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_COLLATERAL_MINT, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_LENDING_MARKET, isSigner: false, isWritable: true },
      { pubkey: PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: wallet, isSigner: true, isWritable: false },
      { pubkey: PUBLIC_TESTNET_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function closeTemporaryAccountInstruction(
  temporaryLiquidityAccount: PublicKey,
  wallet: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUBLIC_TESTNET_TOKEN_PROGRAM,
    keys: [
      { pubkey: temporaryLiquidityAccount, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([PUBLIC_TESTNET_CLOSE_ACCOUNT_TAG]),
  });
}

export function buildPublicTestnetWithdrawalUnsignedTransaction(
  wallet: PublicKey,
  sourceCollateralAccount: PublicKey,
  temporaryLiquidityAccount: PublicKey,
  temporaryAccountSeed: string,
  temporaryAccountRentLamports: bigint,
  collateralAmountAtomic: bigint,
  recentBlockhash: string,
  intentId: string,
): Transaction {
  if (
    temporaryAccountRentLamports <= 0n ||
    temporaryAccountRentLamports > BigInt(Number.MAX_SAFE_INTEGER) ||
    collateralAmountAtomic <= 0n
  ) {
    throw new PublicTestnetEvidenceMismatchError();
  }
  return new Transaction({ feePayer: wallet, recentBlockhash }).add(
    memoInstruction(intentId),
    SystemProgram.createAccountWithSeed({
      fromPubkey: wallet,
      newAccountPubkey: temporaryLiquidityAccount,
      basePubkey: wallet,
      seed: temporaryAccountSeed,
      lamports: Number(temporaryAccountRentLamports),
      space: TOKEN_ACCOUNT_SPACE,
      programId: PUBLIC_TESTNET_TOKEN_PROGRAM,
    }),
    initializeAccount3Instruction(temporaryLiquidityAccount, wallet),
    redeemReserveCollateralInstruction(
      wallet,
      sourceCollateralAccount,
      temporaryLiquidityAccount,
      collateralAmountAtomic,
    ),
    closeTemporaryAccountInstruction(temporaryLiquidityAccount, wallet),
  );
}

function sameSubmission(
  left: PublicTestnetSubmissionRequest,
  right: PublicTestnetSubmissionRequest,
): boolean {
  return (
    left.signature === right.signature &&
    (left.signedTransactionBase64 === right.signedTransactionBase64 ||
      right.signedTransactionBase64 === undefined)
  );
}

@Injectable()
export class PublicTestnetWithdrawalService {
  private readonly intents = new Map<string, StoredWithdrawalIntent>();
  private readonly signatureIntents = new Map<string, string>();

  constructor(
    @Inject(PUBLIC_TESTNET_EXECUTION_RPC) private readonly rpc: PublicTestnetExecutionRpc,
    @Inject(PUBLIC_TESTNET_EXECUTION_CONFIG) private readonly config: PublicTestnetExecutionConfig,
  ) {}

  async createIntent(
    accountId: AccountId,
    request: PublicTestnetWithdrawalRequest,
  ): Promise<PublicTestnetWithdrawalIntentResponse> {
    this.assertEnabled();
    this.prune();
    this.assertCapacity(accountId);
    const wallet = new PublicKey(request.account);
    const intentId = randomUUID();
    const temporaryAccountSeed = withdrawalSeed(intentId, wallet);
    const temporaryLiquidityAccount = await PublicKey.createWithSeed(
      wallet,
      temporaryAccountSeed,
      PUBLIC_TESTNET_TOKEN_PROGRAM,
    );
    const preflightWithdrawal = this.rpc.preflightWithdrawal;
    if (preflightWithdrawal === undefined) throw new PublicTestnetRpcUnavailableError();
    const observation = await preflightWithdrawal.call(this.rpc, wallet, temporaryLiquidityAccount);
    if (
      !observation.temporaryLiquidityAccount.equals(temporaryLiquidityAccount) ||
      !observation.sourceCollateralAccount.equals(
        derivePublicTestnetAssociatedTokenAddress(wallet, PUBLIC_TESTNET_COLLATERAL_MINT),
      )
    ) {
      throw new PublicTestnetEvidenceMismatchError();
    }
    const transaction = buildPublicTestnetWithdrawalUnsignedTransaction(
      wallet,
      observation.sourceCollateralAccount,
      temporaryLiquidityAccount,
      temporaryAccountSeed,
      observation.temporaryAccountRentLamports,
      observation.collateralBalanceAtomic,
      observation.blockhash,
      intentId,
    );
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    if (serialized.length > PUBLIC_TESTNET_MAX_TRANSACTION_BYTES) {
      throw new PublicTestnetEvidenceMismatchError();
    }
    const now = Date.now();
    const expiresAtMilliseconds = now + PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS;
    const evidenceDeadlineMilliseconds = now + PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS;
    const response: PublicTestnetWithdrawalIntentResponse = Object.freeze({
      use: 'PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY' as const,
      mayAuthorizeMainnetFinancialAction: false as const,
      intentId,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      evidenceExpiresAt: new Date(evidenceDeadlineMilliseconds).toISOString(),
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: wallet.toBase58(),
      proof: Object.freeze({
        kind: 'FULL_TESTNET_POSITION_WITHDRAWAL' as const,
        collateralAmountAtomic: observation.collateralBalanceAtomic.toString(),
        estimatedLiquidityAtomic: observation.estimatedLiquidityAtomic.toString(),
        collateralSymbol: 'cSOL' as const,
        assetSymbol: 'SOL' as const,
        assetDecimals: PUBLIC_TESTNET_ASSET_DECIMALS,
      }),
      transaction: Object.freeze({
        encoding: 'BASE64' as const,
        messageVersion: 'LEGACY' as const,
        serializedTransactionBase64: serialized.toString('base64'),
        recentBlockhash: observation.blockhash,
        lastValidBlockHeight: observation.lastValidBlockHeight.toString(),
        minContextSlot: observation.slot.toString(),
        feePayer: wallet.toBase58(),
        sourceCollateralAccount: observation.sourceCollateralAccount.toBase58(),
        temporaryLiquidityAccount: temporaryLiquidityAccount.toBase58(),
        temporaryAccountSeed,
      }),
      fundingReadiness: Object.freeze({
        status:
          observation.nativeBalanceLamports >= PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS
            ? ('READY' as const)
            : ('NEEDS_DEVNET_SOL' as const),
        nativeBalanceLamports: observation.nativeBalanceLamports.toString(),
        requiredNativeBalanceLamports: '20000000' as const,
        temporaryAccountRentLamports: observation.temporaryAccountRentLamports.toString(),
        faucetUrl: PUBLIC_TESTNET_SOL_FAUCET,
      }),
      liveObservation: Object.freeze({
        confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION' as const,
        slot: observation.slot.toString(),
        observedAt: observation.observedAt,
        collateralBalanceAtomic: observation.collateralBalanceAtomic.toString(),
        estimatedLiquidityAtomic: observation.estimatedLiquidityAtomic.toString(),
        reserveAvailableLiquidityAtomic: observation.reserveAvailableLiquidityAtomic.toString(),
      }),
      providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
    });
    const stored: StoredWithdrawalIntent = {
      accountId,
      wallet,
      expiresAtMilliseconds,
      evidenceDeadlineMilliseconds,
      expectedMessageBase64: transaction.serializeMessage().toString('base64'),
      preflightSlot: observation.slot,
      lastValidBlockHeight: observation.lastValidBlockHeight,
      sourceCollateralAccount: observation.sourceCollateralAccount,
      temporaryLiquidityAccount,
      collateralAmountAtomic: observation.collateralBalanceAtomic,
      response,
    };
    this.prune();
    this.assertCapacity(accountId);
    this.intents.set(intentId, stored);
    return response;
  }

  async verifySubmission(
    accountId: AccountId,
    intentId: string,
    submission: PublicTestnetSubmissionRequest,
  ): Promise<PublicTestnetWithdrawalVerificationResponse> {
    this.assertEnabled();
    const intent = this.intents.get(intentId);
    if (intent === undefined || intent.accountId !== accountId) {
      throw new PublicTestnetIntentNotFoundError();
    }
    const boundIntent = this.signatureIntents.get(submission.signature);
    if (boundIntent !== undefined && boundIntent !== intentId) {
      throw new PublicTestnetIntentConflictError();
    }
    if (intent.submission !== undefined && !sameSubmission(intent.submission, submission)) {
      throw new PublicTestnetIntentConflictError();
    }
    if (intent.terminal !== undefined) return intent.terminal;
    if (intent.submission === undefined && Date.now() >= intent.expiresAtMilliseconds) {
      throw new PublicTestnetIntentExpiredError();
    }
    if (intent.submission === undefined) {
      if (submission.signedTransactionBase64 === undefined) {
        throw new PublicTestnetIntentConflictError();
      }
      const signed = Object.freeze({
        signature: submission.signature,
        signedTransactionBase64: submission.signedTransactionBase64,
      });
      assertPublicTestnetSignedTransactionMatchesIntent(signed, this.expectation(intent));
      intent.submission = signed;
      this.signatureIntents.set(signed.signature, intentId);
      const result = this.broadcastAndVerify(accountId, intentId, intent, signed).finally(() => {
        delete intent.verification;
      });
      intent.verification = result;
      return result;
    }
    if (intent.verification !== undefined) return intent.verification;
    const result = this.performVerification(accountId, intentId, intent).finally(() => {
      delete intent.verification;
    });
    intent.verification = result;
    return result;
  }

  private async broadcastAndVerify(
    accountId: AccountId,
    intentId: string,
    intent: StoredWithdrawalIntent,
    submission: Required<PublicTestnetSubmissionRequest>,
  ): Promise<PublicTestnetWithdrawalVerificationResponse> {
    await this.rpc.broadcastSignedTransaction(submission, this.expectation(intent));
    return this.performVerification(accountId, intentId, intent);
  }

  private async performVerification(
    accountId: AccountId,
    intentId: string,
    intent: StoredWithdrawalIntent,
  ): Promise<PublicTestnetWithdrawalVerificationResponse> {
    const submission = intent.submission;
    if (submission === undefined) throw new PublicTestnetIntentConflictError();
    const verifyFinalizedWithdrawal = this.rpc.verifyFinalizedWithdrawal;
    if (verifyFinalizedWithdrawal === undefined) throw new PublicTestnetRpcUnavailableError();
    const observation = await verifyFinalizedWithdrawal.call(
      this.rpc,
      submission.signature,
      this.expectation(intent),
    );
    if (this.intents.get(intentId) !== intent || intent.accountId !== accountId) {
      throw new PublicTestnetIntentNotFoundError();
    }
    const response = this.verificationResponse(intent, submission.signature, observation);
    if (observation.status !== 'PENDING') {
      intent.terminal = response;
      intent.terminalAtMilliseconds = Date.now();
    }
    return response;
  }

  private expectation(
    intent: StoredWithdrawalIntent,
  ): PublicTestnetWithdrawalVerificationExpectation {
    return Object.freeze({
      wallet: intent.wallet,
      sourceLiquidityAccount: intent.temporaryLiquidityAccount,
      destinationCollateralAccount: intent.sourceCollateralAccount,
      sourceCollateralAccount: intent.sourceCollateralAccount,
      temporaryLiquidityAccount: intent.temporaryLiquidityAccount,
      collateralAmountAtomic: intent.collateralAmountAtomic,
      expectedMessageBase64: intent.expectedMessageBase64,
      preflightSlot: intent.preflightSlot,
      lastValidBlockHeight: intent.lastValidBlockHeight,
    });
  }

  private verificationResponse(
    intent: StoredWithdrawalIntent,
    signature: string,
    observation: PublicTestnetWithdrawalTransactionObservation,
  ): PublicTestnetWithdrawalVerificationResponse {
    const pending = observation.status === 'PENDING';
    const failed = observation.status === 'FAILED';
    return Object.freeze({
      intentId: intent.response.intentId,
      status: observation.status,
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION' as const,
      transaction: Object.freeze({
        status: observation.status,
        signature,
        slot: pending || observation.slot === null ? null : observation.slot.toString(),
      }),
      position: Object.freeze({
        status: observation.status,
        collateralBalanceBeforeAtomic:
          pending || failed
            ? intent.collateralAmountAtomic.toString()
            : observation.collateralBalanceBeforeAtomic.toString(),
        collateralBalanceAfterAtomic:
          pending || failed ? null : observation.collateralBalanceAfterAtomic.toString(),
        decreaseAtomic: pending || failed ? null : observation.decreaseAtomic.toString(),
        liquidityReceivedAtomic:
          pending || failed ? null : observation.liquidityReceivedAtomic.toString(),
      }),
      consumed: !pending,
    });
  }

  private assertCapacity(accountId: AccountId): void {
    if (this.intents.size >= PUBLIC_TESTNET_MAX_INTENTS) {
      throw new PublicTestnetIntentCapacityError();
    }
    const active = [...this.intents.values()].filter(
      (intent) =>
        intent.accountId === accountId &&
        intent.terminal === undefined &&
        (intent.submission !== undefined || Date.now() < intent.expiresAtMilliseconds),
    ).length;
    if (active >= PUBLIC_TESTNET_MAX_ACTIVE_WITHDRAWALS_PER_ACCOUNT) {
      throw new PublicTestnetIntentCapacityError();
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [intentId, intent] of this.intents) {
      const terminalExpired =
        intent.terminalAtMilliseconds !== undefined &&
        now - intent.terminalAtMilliseconds >=
          PUBLIC_TESTNET_WITHDRAWAL_TERMINAL_RETENTION_MILLISECONDS;
      const unsignedExpired =
        intent.submission === undefined && now >= intent.evidenceDeadlineMilliseconds;
      if (terminalExpired || unsignedExpired) this.removeIntent(intentId, intent);
    }
  }

  private removeIntent(intentId: string, intent: StoredWithdrawalIntent): void {
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
