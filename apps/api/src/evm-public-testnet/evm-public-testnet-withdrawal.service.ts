import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { concatHex, encodeFunctionData, getAddress, type Address, type Hex } from 'viem';

import type { AccountId } from '../accounts/domain/account-profile';
import {
  EVM_PUBLIC_TESTNET_ASSET_DECIMALS,
  EVM_PUBLIC_TESTNET_AWETH,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS,
  EVM_PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS,
  EVM_PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT,
  EVM_PUBLIC_TESTNET_MAX_INTENTS,
  EVM_PUBLIC_TESTNET_MAX_UINT256,
  EVM_PUBLIC_TESTNET_MAX_UINT256_TEXT,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
  EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
  evmPublicTestnetWithdrawalIntentMarker,
} from './evm-public-testnet.constants';
import {
  EVM_PUBLIC_TESTNET_EXECUTION_CONFIG,
  type EvmPublicTestnetExecutionConfig,
} from './evm-public-testnet.config';
import {
  EVM_PUBLIC_TESTNET_WITHDRAWAL_RPC,
  EvmPublicTestnetTransactionReplacedError,
  EvmPublicTestnetTransactionRevertedError,
  type EvmPublicTestnetWithdrawalExpectation,
  type EvmPublicTestnetWithdrawalRpc,
  type EvmPublicTestnetWithdrawalStep,
  type EvmPublicTestnetWithdrawalTransactionObservation,
} from './evm-public-testnet.rpc';

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

export interface EvmPublicTestnetWithdrawalRequest {
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: Address;
}

export interface EvmPublicTestnetWithdrawalIntentResponse {
  readonly use: 'EVM_PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY';
  readonly mayAuthorizeMainnetFinancialAction: false;
  readonly intentId: string;
  readonly expiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: Address;
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly position: Readonly<{
    assetSymbol: 'ETH';
    assetDecimals: typeof EVM_PUBLIC_TESTNET_ASSET_DECIMALS;
    aTokenBalanceBeforeAtomic: string;
    fullPosition: true;
  }>;
  readonly allowance: Readonly<{
    token: Address;
    spender: Address;
    beforeAtomic: string;
    requiredAtomic: typeof EVM_PUBLIC_TESTNET_MAX_UINT256_TEXT;
  }>;
  readonly transaction: Readonly<{
    from: Address;
    to: Address;
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

export interface EvmPublicTestnetWithdrawalSubmissionRequest {
  readonly transactionHash?: Hex;
}

export interface EvmPublicTestnetWithdrawalVerificationResponse {
  readonly intentId: string;
  readonly step: EvmPublicTestnetWithdrawalStep;
  readonly status: 'PENDING' | 'CONFIRMED' | 'VERIFIED';
  readonly confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION';
  readonly transaction: Readonly<{
    status: 'PENDING' | 'CONFIRMED' | 'VERIFIED';
    transactionHash: Hex | null;
    blockNumber: string | null;
    blockHash: Hex | null;
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

export class EvmPublicTestnetWithdrawalIntentNotFoundError extends Error {}
export class EvmPublicTestnetWithdrawalIntentConflictError extends Error {}
export class EvmPublicTestnetWithdrawalIntentCapacityError extends Error {}
export class EvmPublicTestnetWithdrawalEmptyPositionError extends Error {}

interface StoredWithdrawalIntent {
  readonly accountId: AccountId;
  readonly evidenceDeadlineMilliseconds: number;
  readonly expectation: EvmPublicTestnetWithdrawalExpectation;
  readonly response: EvmPublicTestnetWithdrawalIntentResponse;
  readonly acceptedTransactionHashes: Set<Hex>;
  transactionHash?: Hex;
  recoveryAttempted?: true;
  landed?: true;
  terminalRetentionDeadlineMilliseconds?: number;
  terminalFailure?: 'REPLACED' | 'REVERTED';
  inFlight?: Readonly<{
    key: string;
    result: Promise<EvmPublicTestnetWithdrawalVerificationResponse>;
  }>;
  verified?: EvmPublicTestnetWithdrawalVerificationResponse;
}

function quantityHex(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

function buildInput(step: EvmPublicTestnetWithdrawalStep, account: Address, intentId: string): Hex {
  const call =
    step === 'APPROVE_AWETH'
      ? encodeFunctionData({
          abi: APPROVE_ABI,
          functionName: 'approve',
          args: [EVM_PUBLIC_TESTNET_WETH_GATEWAY, EVM_PUBLIC_TESTNET_MAX_UINT256],
        })
      : encodeFunctionData({
          abi: WITHDRAW_ETH_ABI,
          functionName: 'withdrawETH',
          args: [EVM_PUBLIC_TESTNET_POOL, EVM_PUBLIC_TESTNET_MAX_UINT256, account],
        });
  return concatHex([call, evmPublicTestnetWithdrawalIntentMarker(step, intentId)]);
}

@Injectable()
export class EvmPublicTestnetWithdrawalService {
  private readonly intents = new Map<string, StoredWithdrawalIntent>();
  private readonly transactionIntents = new Map<Hex, string>();

  constructor(
    @Inject(EVM_PUBLIC_TESTNET_WITHDRAWAL_RPC)
    private readonly rpc: EvmPublicTestnetWithdrawalRpc,
    @Inject(EVM_PUBLIC_TESTNET_EXECUTION_CONFIG)
    private readonly config: EvmPublicTestnetExecutionConfig,
  ) {}

  async createIntent(
    accountId: AccountId,
    request: EvmPublicTestnetWithdrawalRequest,
  ): Promise<EvmPublicTestnetWithdrawalIntentResponse> {
    this.assertEnabled();
    this.prune();
    this.assertCapacity(accountId);
    const account = getAddress(request.account);
    const observation = await this.rpc.preflightWithdrawal(account);
    if (observation.aTokenBalanceAtomic <= 0n) {
      throw new EvmPublicTestnetWithdrawalEmptyPositionError();
    }
    const step: EvmPublicTestnetWithdrawalStep =
      observation.allowanceAtomic === EVM_PUBLIC_TESTNET_MAX_UINT256
        ? 'WITHDRAW_FULL_ETH'
        : 'APPROVE_AWETH';
    const intentId = randomUUID();
    const input = buildInput(step, account, intentId);
    if (step === 'WITHDRAW_FULL_ETH') {
      await this.rpc.assertWithdrawalExecutable(account, input);
    }
    const now = Date.now();
    const expiresAtMilliseconds = now + EVM_PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS;
    const evidenceDeadlineMilliseconds = now + EVM_PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS;
    const target =
      step === 'APPROVE_AWETH' ? EVM_PUBLIC_TESTNET_AWETH : EVM_PUBLIC_TESTNET_WETH_GATEWAY;
    const response: EvmPublicTestnetWithdrawalIntentResponse = Object.freeze({
      use: 'EVM_PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY' as const,
      mayAuthorizeMainnetFinancialAction: false as const,
      intentId,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      evidenceExpiresAt: new Date(evidenceDeadlineMilliseconds).toISOString(),
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account,
      step,
      position: Object.freeze({
        assetSymbol: 'ETH' as const,
        assetDecimals: EVM_PUBLIC_TESTNET_ASSET_DECIMALS,
        aTokenBalanceBeforeAtomic: observation.aTokenBalanceAtomic.toString(),
        fullPosition: true as const,
      }),
      allowance: Object.freeze({
        token: EVM_PUBLIC_TESTNET_AWETH,
        spender: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
        beforeAtomic: observation.allowanceAtomic.toString(),
        requiredAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256_TEXT,
      }),
      transaction: Object.freeze({
        from: account,
        to: target,
        value: EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
        input,
        nonce: quantityHex(observation.nonce),
        chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
      }),
      liveObservation: Object.freeze({
        confirmation: 'LATEST_WITHDRAWAL_PREFLIGHT_OBSERVATION' as const,
        blockNumber: observation.blockNumber.toString(),
        blockHash: observation.blockHash,
        observedAt: observation.observedAt,
        nativeBalanceWei: observation.nativeBalanceWei.toString(),
      }),
      providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
    });
    const stored: StoredWithdrawalIntent = {
      accountId,
      evidenceDeadlineMilliseconds,
      expectation: Object.freeze({
        step,
        account,
        to: target,
        value: 0n,
        input,
        nonce: observation.nonce,
        baselineBlockNumber: observation.blockNumber,
        baselineBlockHash: observation.blockHash,
        aTokenBalanceBeforeAtomic: observation.aTokenBalanceAtomic,
        allowanceBeforeAtomic: observation.allowanceAtomic,
      }),
      response,
      acceptedTransactionHashes: new Set<Hex>(),
    };
    this.prune();
    this.assertCapacity(accountId);
    this.intents.set(intentId, stored);
    return response;
  }

  async verifySubmission(
    accountId: AccountId,
    intentId: string,
    submission: EvmPublicTestnetWithdrawalSubmissionRequest,
  ): Promise<EvmPublicTestnetWithdrawalVerificationResponse> {
    this.assertEnabled();
    const intent = this.intents.get(intentId);
    if (intent === undefined || intent.accountId !== accountId) {
      throw new EvmPublicTestnetWithdrawalIntentNotFoundError();
    }
    if (submission.transactionHash !== undefined) {
      const owner = this.transactionIntents.get(submission.transactionHash);
      if (owner !== undefined && owner !== intentId) {
        throw new EvmPublicTestnetWithdrawalIntentConflictError();
      }
      if (
        intent.transactionHash !== undefined &&
        !intent.acceptedTransactionHashes.has(submission.transactionHash)
      ) {
        throw new EvmPublicTestnetWithdrawalIntentConflictError();
      }
    }
    if (intent.terminalFailure === 'REPLACED') {
      throw new EvmPublicTestnetTransactionReplacedError();
    }
    if (intent.terminalFailure === 'REVERTED') {
      throw new EvmPublicTestnetTransactionRevertedError();
    }
    if (intent.verified !== undefined) return intent.verified;
    if (submission.transactionHash === undefined) intent.recoveryAttempted = true;
    if (submission.transactionHash !== undefined && intent.transactionHash === undefined) {
      intent.transactionHash = submission.transactionHash;
      intent.acceptedTransactionHashes.add(submission.transactionHash);
      this.transactionIntents.set(submission.transactionHash, intentId);
    }
    const transactionHash = intent.transactionHash;
    const key = transactionHash ?? 'HASHLESS_RECOVERY';
    if (intent.inFlight !== undefined) {
      if (intent.inFlight.key !== key) throw new EvmPublicTestnetWithdrawalIntentConflictError();
      return intent.inFlight.result;
    }
    const result = this.performVerification(intentId, intent, transactionHash).finally(() => {
      if (intent.inFlight?.result === result) delete intent.inFlight;
    });
    intent.inFlight = Object.freeze({ key, result });
    return result;
  }

  private async performVerification(
    intentId: string,
    intent: StoredWithdrawalIntent,
    transactionHash: Hex | undefined,
  ): Promise<EvmPublicTestnetWithdrawalVerificationResponse> {
    try {
      const observation =
        transactionHash === undefined
          ? await this.rpc.recoverWithdrawalTransaction(intent.expectation)
          : await this.rpc.observeWithdrawalTransaction(transactionHash, intent.expectation);
      if (
        observation.transactionHash !== null &&
        observation.transactionHash !== intent.transactionHash
      ) {
        if (intent.transactionHash !== undefined && observation.status === 'PENDING') {
          throw new EvmPublicTestnetWithdrawalIntentConflictError();
        }
        const owner = this.transactionIntents.get(observation.transactionHash);
        if (owner !== undefined && owner !== intentId) {
          throw new EvmPublicTestnetWithdrawalIntentConflictError();
        }
        const previousHash = intent.transactionHash;
        intent.transactionHash = observation.transactionHash;
        intent.acceptedTransactionHashes.add(observation.transactionHash);
        this.transactionIntents.set(observation.transactionHash, intentId);
        if (previousHash !== undefined) intent.acceptedTransactionHashes.add(previousHash);
      }
      const response = this.verificationResponse(intent, observation);
      if (observation.status !== 'PENDING') {
        intent.landed = true;
        intent.terminalRetentionDeadlineMilliseconds ??=
          Date.now() + EVM_PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS;
      }
      if (observation.status === 'VERIFIED') intent.verified = response;
      return response;
    } catch (error) {
      if (
        error instanceof EvmPublicTestnetTransactionReplacedError ||
        error instanceof EvmPublicTestnetTransactionRevertedError
      ) {
        intent.terminalFailure =
          error instanceof EvmPublicTestnetTransactionReplacedError ? 'REPLACED' : 'REVERTED';
        intent.landed = true;
        intent.terminalRetentionDeadlineMilliseconds ??=
          Date.now() + EVM_PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS;
      }
      throw error;
    }
  }

  private verificationResponse(
    intent: StoredWithdrawalIntent,
    observation: EvmPublicTestnetWithdrawalTransactionObservation,
  ): EvmPublicTestnetWithdrawalVerificationResponse {
    return Object.freeze({
      intentId: intent.response.intentId,
      step: intent.response.step,
      status: observation.status,
      confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION' as const,
      transaction: Object.freeze({
        status: observation.status,
        transactionHash: observation.transactionHash,
        blockNumber: observation.blockNumber?.toString() ?? null,
        blockHash: observation.blockHash,
      }),
      effect: Object.freeze({
        amountAtomic: observation.amountAtomic?.toString() ?? null,
        aTokenBalanceBeforeAtomic: intent.expectation.aTokenBalanceBeforeAtomic.toString(),
        aTokenBalanceAfterAtomic: observation.aTokenBalanceAfterAtomic?.toString() ?? null,
        allowanceBeforeAtomic: intent.expectation.allowanceBeforeAtomic.toString(),
        allowanceAfterAtomic: observation.allowanceAfterAtomic?.toString() ?? null,
      }),
      consumed: observation.status !== 'PENDING',
    });
  }

  private assertCapacity(accountId: AccountId): void {
    if (this.intents.size >= EVM_PUBLIC_TESTNET_MAX_INTENTS) {
      throw new EvmPublicTestnetWithdrawalIntentCapacityError();
    }
    const active = [...this.intents.values()].filter(
      (intent) => intent.accountId === accountId && intent.landed !== true,
    ).length;
    if (active >= EVM_PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT) {
      throw new EvmPublicTestnetWithdrawalIntentCapacityError();
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [intentId, intent] of this.intents) {
      if (
        (intent.terminalRetentionDeadlineMilliseconds !== undefined &&
          now >= intent.terminalRetentionDeadlineMilliseconds) ||
        (intent.terminalRetentionDeadlineMilliseconds === undefined &&
          now >= intent.evidenceDeadlineMilliseconds &&
          intent.transactionHash === undefined &&
          intent.recoveryAttempted !== true)
      ) {
        this.intents.delete(intentId);
        for (const hash of intent.acceptedTransactionHashes) {
          if (this.transactionIntents.get(hash) === intentId) this.transactionIntents.delete(hash);
        }
      }
    }
  }

  private assertEnabled(): void {
    if (this.config.mode !== 'enabled') {
      throw new EvmPublicTestnetWithdrawalIntentNotFoundError();
    }
  }
}
