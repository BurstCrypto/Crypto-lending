import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { concatHex, encodeFunctionData, getAddress, type Address, type Hex } from 'viem';

import type { AccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  LocalDemoAllocationService,
  type LocalDemoAllocationSelection,
} from '../local-demo/local-demo-allocation.service';
import {
  EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
  EVM_PUBLIC_TESTNET_ASSET_DECIMALS,
  EVM_PUBLIC_TESTNET_AWETH,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_DATA_PROVIDER,
  EVM_PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS,
  EVM_PUBLIC_TESTNET_FAUCET,
  EVM_PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS,
  EVM_PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT,
  EVM_PUBLIC_TESTNET_MAX_INTENTS,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI_TEXT,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI,
  EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI_TEXT,
  EVM_PUBLIC_TESTNET_WETH,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
  evmPublicTestnetIntentMarker,
} from './evm-public-testnet.constants';
import {
  EVM_PUBLIC_TESTNET_EXECUTION_CONFIG,
  type EvmPublicTestnetExecutionConfig,
} from './evm-public-testnet.config';
import {
  EVM_PUBLIC_TESTNET_EXECUTION_RPC,
  EvmPublicTestnetEvidenceMismatchError,
  EvmPublicTestnetTransactionReplacedError,
  EvmPublicTestnetTransactionRevertedError,
  type EvmPublicTestnetExecutionRpc,
  type EvmPublicTestnetTransactionExpectation,
  type EvmPublicTestnetTransactionObservation,
} from './evm-public-testnet.rpc';

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

export type EvmPublicTestnetFundingReadiness = 'READY' | 'NEEDS_BASE_SEPOLIA_ETH';
export type EvmPublicTestnetSubmissionStatus = 'PENDING' | 'CONFIRMED' | 'VERIFIED';

export interface EvmPublicTestnetIntentRequest {
  readonly portfolioSnapshotId: string;
  readonly selection: Readonly<{
    kind: 'PRESET';
    presetId: 'BALANCED';
    liquidReserveBasisPoints: number;
  }>;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: Address;
}

export interface EvmPublicTestnetIntentResponse {
  readonly use: 'EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY';
  readonly mayAuthorizeMainnetFinancialAction: false;
  readonly intentId: string;
  readonly expiresAt: string;
  readonly evidenceExpiresAt: string;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: Address;
  readonly portfolioBinding: Readonly<{
    portfolioSnapshotId: string;
    selection: EvmPublicTestnetIntentRequest['selection'];
  }>;
  readonly proof: Readonly<{
    kind: 'SINGLE_TESTNET_PROOF_POSITION';
    amountAtomic: typeof EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI_TEXT;
    assetSymbol: 'ETH';
    assetDecimals: typeof EVM_PUBLIC_TESTNET_ASSET_DECIMALS;
    notFullBlend: true;
  }>;
  readonly transaction: Readonly<{
    from: Address;
    to: Address;
    value: typeof EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX;
    input: Hex;
    nonce: Hex;
    chainId: typeof EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID;
  }>;
  readonly fundingReadiness: Readonly<{
    status: EvmPublicTestnetFundingReadiness;
    nativeBalanceWei: string;
    requiredNativeBalanceWei: typeof EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI_TEXT;
    faucetUrl: typeof EVM_PUBLIC_TESTNET_FAUCET;
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

export interface EvmPublicTestnetSubmissionRequest {
  readonly transactionHash?: Hex;
}

export interface EvmPublicTestnetVerificationResponse {
  readonly intentId: string;
  readonly status: EvmPublicTestnetSubmissionStatus;
  readonly confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION';
  readonly transaction: Readonly<{
    status: EvmPublicTestnetSubmissionStatus;
    transactionHash: Hex | null;
    blockNumber: string | null;
    blockHash: Hex | null;
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
  readonly account: Address;
}

export interface EvmPublicTestnetPositionResponse {
  readonly use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION';
  readonly mayAuthorizeFinancialAction: false;
  readonly chainId: typeof EVM_PUBLIC_TESTNET_CHAIN_ID;
  readonly account: Address;
  readonly provider: Readonly<{
    name: 'Aave V3';
    pool: Address;
    addressesProvider: Address;
    dataProvider: Address;
    gateway: Address;
    reserve: Address;
    aToken: Address;
  }>;
  readonly position: Readonly<{
    status: 'OPEN' | 'EMPTY';
    assetSymbol: 'ETH';
    assetDecimals: typeof EVM_PUBLIC_TESTNET_ASSET_DECIMALS;
    suppliedLiquidityAtomic: string;
    aTokenSymbol: 'aBaseSepoliaWETH';
    aTokenBalanceAtomic: string;
    aTokenDecimals: typeof EVM_PUBLIC_TESTNET_ASSET_DECIMALS;
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
    blockHash: Hex;
    finalizedBlockNumber: string;
    finalizedBlockHash: Hex;
    observedAt: string;
  }>;
}

export class EvmPublicTestnetIntentNotFoundError extends Error {}
export class EvmPublicTestnetIntentExpiredError extends Error {}
export class EvmPublicTestnetIntentConflictError extends Error {}
export class EvmPublicTestnetIntentCapacityError extends Error {}

interface StoredIntent {
  readonly accountId: AccountId;
  readonly account: Address;
  readonly evidenceDeadlineMilliseconds: number;
  readonly expectation: EvmPublicTestnetTransactionExpectation;
  readonly response: EvmPublicTestnetIntentResponse;
  readonly acceptedTransactionHashes: Set<Hex>;
  transactionHash?: Hex;
  recoveryAttempted?: true;
  landed?: true;
  terminalRetentionDeadlineMilliseconds?: number;
  terminalFailure?: 'REPLACED' | 'REVERTED';
  inFlight?: Readonly<{
    key: string;
    result: Promise<EvmPublicTestnetVerificationResponse>;
  }>;
  verified?: EvmPublicTestnetVerificationResponse;
}

function quantityHex(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

function buildDepositInput(account: Address, intentId: string): Hex {
  const call = encodeFunctionData({
    abi: DEPOSIT_ETH_ABI,
    functionName: 'depositETH',
    args: [EVM_PUBLIC_TESTNET_POOL, account, 0],
  });
  return concatHex([call, evmPublicTestnetIntentMarker(intentId)]);
}

function supplyApyBasisPoints(liquidityRateRay: bigint): number {
  if (liquidityRateRay < 0n || liquidityRateRay > 1_000n * 10n ** 27n) {
    throw new EvmPublicTestnetEvidenceMismatchError();
  }
  const annualRate = Number(liquidityRateRay) / 1e27;
  const secondsPerYear = 31_536_000;
  const apy = Math.expm1(secondsPerYear * Math.log1p(annualRate / secondsPerYear));
  const basisPoints = Math.round(apy * 10_000);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000_000) {
    throw new EvmPublicTestnetEvidenceMismatchError();
  }
  return basisPoints;
}

@Injectable()
export class EvmPublicTestnetExecutionService {
  // These maps are deliberately not shared with the Solana public-testnet
  // service. An EVM recovery lock therefore cannot consume SVM capacity or
  // serialize an unrelated Solana proof.
  private readonly intents = new Map<string, StoredIntent>();
  private readonly transactionIntents = new Map<Hex, string>();

  constructor(
    private readonly allocations: LocalDemoAllocationService,
    @Inject(EVM_PUBLIC_TESTNET_EXECUTION_RPC)
    private readonly rpc: EvmPublicTestnetExecutionRpc,
    @Inject(EVM_PUBLIC_TESTNET_EXECUTION_CONFIG)
    private readonly config: EvmPublicTestnetExecutionConfig,
  ) {}

  async createIntent(
    accountId: AccountId,
    correlation: JobCorrelationContext,
    request: EvmPublicTestnetIntentRequest,
  ): Promise<EvmPublicTestnetIntentResponse> {
    this.assertEnabled();
    this.prune();
    this.removeSupersededUnfundedIntents(accountId);
    this.assertCapacity(accountId);
    const account = getAddress(request.account);
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
      throw new EvmPublicTestnetEvidenceMismatchError();
    }

    const observation = await this.rpc.preflight(account);
    const intentId = randomUUID();
    const input = buildDepositInput(account, intentId);
    const now = Date.now();
    const expiresAtMilliseconds = now + EVM_PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS;
    const evidenceDeadlineMilliseconds = now + EVM_PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS;
    const selection = Object.freeze({
      kind: 'PRESET' as const,
      presetId: 'BALANCED' as const,
      liquidReserveBasisPoints: request.selection.liquidReserveBasisPoints,
    });
    const response: EvmPublicTestnetIntentResponse = Object.freeze({
      use: 'EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY' as const,
      mayAuthorizeMainnetFinancialAction: false as const,
      intentId,
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      evidenceExpiresAt: new Date(evidenceDeadlineMilliseconds).toISOString(),
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account,
      portfolioBinding: Object.freeze({
        portfolioSnapshotId: request.portfolioSnapshotId,
        selection,
      }),
      proof: Object.freeze({
        kind: 'SINGLE_TESTNET_PROOF_POSITION' as const,
        amountAtomic: EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI_TEXT,
        assetSymbol: 'ETH' as const,
        assetDecimals: EVM_PUBLIC_TESTNET_ASSET_DECIMALS,
        notFullBlend: true as const,
      }),
      transaction: Object.freeze({
        from: account,
        to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
        value: EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX,
        input,
        nonce: quantityHex(observation.nonce),
        chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
      }),
      fundingReadiness: Object.freeze({
        status:
          observation.nativeBalanceWei >= EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI
            ? ('READY' as const)
            : ('NEEDS_BASE_SEPOLIA_ETH' as const),
        nativeBalanceWei: observation.nativeBalanceWei.toString(),
        requiredNativeBalanceWei: EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI_TEXT,
        faucetUrl: EVM_PUBLIC_TESTNET_FAUCET,
      }),
      liveObservation: Object.freeze({
        confirmation: 'LATEST_PREFLIGHT_OBSERVATION' as const,
        blockNumber: observation.blockNumber.toString(),
        blockHash: observation.blockHash,
        observedAt: observation.observedAt,
        aTokenBalanceBeforeAtomic: observation.aTokenBalanceAtomic.toString(),
      }),
      providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER' as const,
    });
    const stored: StoredIntent = {
      accountId,
      account,
      evidenceDeadlineMilliseconds,
      expectation: Object.freeze({
        account,
        to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
        value: EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI,
        input,
        nonce: observation.nonce,
        baselineBlockNumber: observation.blockNumber,
        baselineBlockHash: observation.blockHash,
        aTokenBalanceBeforeAtomic: observation.aTokenBalanceAtomic,
      }),
      response,
      acceptedTransactionHashes: new Set<Hex>(),
    };
    // No await may appear between the second capacity check and insertion.
    this.prune();
    this.removeSupersededUnfundedIntents(accountId);
    this.assertCapacity(accountId);
    this.intents.set(intentId, stored);
    return response;
  }

  async verifySubmission(
    accountId: AccountId,
    intentId: string,
    submission: EvmPublicTestnetSubmissionRequest,
  ): Promise<EvmPublicTestnetVerificationResponse> {
    this.assertEnabled();
    const intent = this.intents.get(intentId);
    if (intent === undefined || intent.accountId !== accountId) {
      throw new EvmPublicTestnetIntentNotFoundError();
    }

    // Validate a supplied hash even after final verification so a cached result
    // can never conceal a conflicting rebind attempt.
    if (submission.transactionHash !== undefined) {
      const owner = this.transactionIntents.get(submission.transactionHash);
      if (owner !== undefined && owner !== intentId) {
        throw new EvmPublicTestnetIntentConflictError();
      }
      if (
        intent.transactionHash !== undefined &&
        !intent.acceptedTransactionHashes.has(submission.transactionHash)
      ) {
        throw new EvmPublicTestnetIntentConflictError();
      }
    }
    if (intent.terminalFailure === 'REPLACED') {
      throw new EvmPublicTestnetTransactionReplacedError();
    }
    if (intent.terminalFailure === 'REVERTED') {
      throw new EvmPublicTestnetTransactionRevertedError();
    }
    if (intent.verified !== undefined) return intent.verified;

    // An empty body is an explicit read-only recovery declaration. Record it
    // so wall time can never turn an ambiguous wallet outcome into an apparent
    // safe retry. If the record still exists, a supplied hash is always treated
    // as recovery evidence for an already-crossed wallet boundary.
    if (submission.transactionHash === undefined) intent.recoveryAttempted = true;

    if (submission.transactionHash !== undefined) {
      if (intent.transactionHash === undefined) {
        // `expiresAt` closes the browser authorization window, but a wallet may
        // already have broadcast before returning control. Binding and reading
        // that exact hash is recovery evidence, not permission for a new send.
        intent.transactionHash = submission.transactionHash;
        intent.acceptedTransactionHashes.add(submission.transactionHash);
        this.transactionIntents.set(submission.transactionHash, intentId);
      }
    }

    const transactionHash = intent.transactionHash;
    const key = transactionHash ?? 'HASHLESS_RECOVERY';
    if (intent.inFlight !== undefined) {
      if (intent.inFlight.key !== key) throw new EvmPublicTestnetIntentConflictError();
      return intent.inFlight.result;
    }
    const result = this.performVerification(intentId, intent, transactionHash).finally(() => {
      if (intent.inFlight?.result === result) delete intent.inFlight;
    });
    intent.inFlight = Object.freeze({ key, result });
    return result;
  }

  async readPosition(
    accountId: AccountId,
    request: EvmPublicTestnetPositionRequest,
  ): Promise<EvmPublicTestnetPositionResponse> {
    this.assertEnabled();
    void accountId;
    const account = getAddress(request.account);
    const observation = await this.rpc.readPosition(account);
    const balance = observation.aTokenBalanceAtomic.toString();
    return Object.freeze({
      use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION' as const,
      mayAuthorizeFinancialAction: false as const,
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account,
      provider: Object.freeze({
        name: 'Aave V3' as const,
        pool: EVM_PUBLIC_TESTNET_POOL,
        addressesProvider: EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
        dataProvider: EVM_PUBLIC_TESTNET_DATA_PROVIDER,
        gateway: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
        reserve: EVM_PUBLIC_TESTNET_WETH,
        aToken: EVM_PUBLIC_TESTNET_AWETH,
      }),
      position: Object.freeze({
        status: observation.aTokenBalanceAtomic > 0n ? ('OPEN' as const) : ('EMPTY' as const),
        assetSymbol: 'ETH' as const,
        assetDecimals: EVM_PUBLIC_TESTNET_ASSET_DECIMALS,
        suppliedLiquidityAtomic: balance,
        aTokenSymbol: 'aBaseSepoliaWETH' as const,
        aTokenBalanceAtomic: balance,
        aTokenDecimals: EVM_PUBLIC_TESTNET_ASSET_DECIMALS,
      }),
      rate: Object.freeze({
        kind: 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY' as const,
        liquidityRateRay: observation.liquidityRateRay.toString(),
        supplyApyBasisPoints: supplyApyBasisPoints(observation.liquidityRateRay),
        variable: true as const,
        rewardsIncluded: false as const,
        riskAssessed: false as const,
        historyAvailable: false as const,
      }),
      liveObservation: Object.freeze({
        confirmation: 'LATEST_POSITION_OBSERVATION' as const,
        blockNumber: observation.blockNumber.toString(),
        blockHash: observation.blockHash,
        finalizedBlockNumber: observation.finalizedBlockNumber.toString(),
        finalizedBlockHash: observation.finalizedBlockHash,
        observedAt: observation.observedAt,
      }),
    });
  }

  private async performVerification(
    intentId: string,
    intent: StoredIntent,
    transactionHash: Hex | undefined,
  ): Promise<EvmPublicTestnetVerificationResponse> {
    try {
      const observation =
        transactionHash === undefined
          ? await this.rpc.recoverTransaction(intent.expectation)
          : await this.rpc.observeTransaction(transactionHash, intent.expectation);
      if (
        observation.transactionHash !== null &&
        observation.transactionHash !== intent.transactionHash
      ) {
        if (intent.transactionHash !== undefined && observation.status === 'PENDING') {
          throw new EvmPublicTestnetIntentConflictError();
        }
        const owner = this.transactionIntents.get(observation.transactionHash);
        if (owner !== undefined && owner !== intentId) {
          throw new EvmPublicTestnetIntentConflictError();
        }
        const previousHash = intent.transactionHash;
        intent.transactionHash = observation.transactionHash;
        intent.acceptedTransactionHashes.add(observation.transactionHash);
        this.transactionIntents.set(observation.transactionHash, intentId);
        // Preserve the provider-returned hash as an accepted alias. If the
        // replacement response is lost, a journal with the original hash must
        // still reach this exact terminal result on retry.
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
    intent: StoredIntent,
    observation: EvmPublicTestnetTransactionObservation,
  ): EvmPublicTestnetVerificationResponse {
    return Object.freeze({
      intentId: intent.response.intentId,
      status: observation.status,
      confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION' as const,
      transaction: Object.freeze({
        status: observation.status,
        transactionHash: observation.transactionHash,
        blockNumber: observation.blockNumber?.toString() ?? null,
        blockHash: observation.blockHash,
      }),
      position: Object.freeze({
        status: observation.status,
        aTokenBalanceBeforeAtomic: intent.expectation.aTokenBalanceBeforeAtomic.toString(),
        aTokenBalanceAfterAtomic: observation.aTokenBalanceAfterAtomic?.toString() ?? null,
        increaseAtomic: observation.increaseAtomic?.toString() ?? null,
      }),
      consumed: observation.status !== 'PENDING',
    });
  }

  private assertCapacity(accountId: AccountId): void {
    if (this.intents.size >= EVM_PUBLIC_TESTNET_MAX_INTENTS) {
      throw new EvmPublicTestnetIntentCapacityError();
    }
    const activeForAccount = [...this.intents.values()].filter(
      (intent) => intent.accountId === accountId && intent.landed !== true,
    ).length;
    if (activeForAccount >= EVM_PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT) {
      throw new EvmPublicTestnetIntentCapacityError();
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
        this.removeIntent(intentId, intent);
      }
    }
  }

  private removeSupersededUnfundedIntents(accountId: AccountId): void {
    for (const [intentId, intent] of this.intents) {
      // The UI never exposes a wallet send for an unfunded intent. A new
      // funding check therefore supersedes only these untouched preparations;
      // any declared recovery or bound hash remains preserved.
      if (
        intent.accountId === accountId &&
        intent.response.fundingReadiness.status === 'NEEDS_BASE_SEPOLIA_ETH' &&
        intent.transactionHash === undefined &&
        intent.recoveryAttempted !== true
      ) {
        this.removeIntent(intentId, intent);
      }
    }
  }

  private removeIntent(intentId: string, intent: StoredIntent): void {
    this.intents.delete(intentId);
    for (const transactionHash of intent.acceptedTransactionHashes) {
      if (this.transactionIntents.get(transactionHash) === intentId) {
        this.transactionIntents.delete(transactionHash);
      }
    }
  }

  private assertEnabled(): void {
    if (this.config.mode !== 'enabled') throw new EvmPublicTestnetIntentNotFoundError();
  }
}
