import {
  EvmPublicTestnetWalletError,
  type EvmPublicTestnetWithdrawalWalletPort,
} from '@/lib/wallets/eip1193/public-testnet-executor';

import { EVM_PUBLIC_TESTNET_CHAIN_ID } from './constants';
import { hasCompetingEvmPublicTestnetOperation } from './operation-lock';
import {
  evmPublicTestnetWithdrawalResultExpectation,
  evmPublicTestnetWithdrawalWalletTransaction,
  validateEvmPublicTestnetWithdrawalRequest,
  type EvmPublicTestnetWithdrawalIntent,
  type EvmPublicTestnetWithdrawalStep,
} from './withdrawal';
import {
  EvmPublicTestnetWithdrawalApiError,
  type EvmPublicTestnetWithdrawalApi,
} from './withdrawal-client';
import {
  addEvmPublicTestnetWithdrawalRecoveryTransactionHash,
  clearEvmPublicTestnetWithdrawalRecoveryJournal,
  evmPublicTestnetWithdrawalExpectationFromJournal,
  readEvmPublicTestnetWithdrawalRecoveryJournal,
  startEvmPublicTestnetWithdrawalRecoveryJournal,
  type EvmPublicTestnetWithdrawalRecoveryJournalRecord,
  type EvmPublicTestnetWithdrawalRecoveryJournalStorage,
} from './withdrawal-recovery-journal';

export type EvmPublicTestnetWithdrawalControllerStatus =
  | 'IDLE'
  | 'PREPARING'
  | 'CONNECTING_WALLET'
  | 'WALLET_APPROVAL'
  | 'VERIFYING_APPROVAL'
  | 'WALLET_WITHDRAWAL'
  | 'VERIFYING_WITHDRAWAL'
  | 'COMPLETE'
  | 'RECOVERY_REQUIRED'
  | 'FAILED'
  | 'DISPOSED';

export interface EvmPublicTestnetWithdrawalControllerSnapshot {
  readonly status: EvmPublicTestnetWithdrawalControllerStatus;
  readonly ready: boolean;
  readonly locked: boolean;
  readonly step: EvmPublicTestnetWithdrawalStep | null;
  readonly transactionHash: string | null;
  readonly message: string | null;
}

export interface EvmPublicTestnetWithdrawalClaim {
  readonly account: string;
  readonly id: symbol;
}

export type EvmPublicTestnetWithdrawalStartResult =
  | Readonly<{ status: 'COMPLETE'; message?: string }>
  | Readonly<{ status: 'RECOVERY_REQUIRED'; message: string }>
  | Readonly<{ status: 'FAILED'; message: string }>;

export interface EvmPublicTestnetFullWithdrawalControllerDependencies {
  readonly account: string;
  readonly api: EvmPublicTestnetWithdrawalApi;
  readonly wallet: EvmPublicTestnetWithdrawalWalletPort;
  readonly storage?: EvmPublicTestnetWithdrawalRecoveryJournalStorage;
  readonly pollIntervalMilliseconds?: number;
  readonly approvalPollAttempts?: number;
  readonly withdrawalPollAttempts?: number;
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface EvmPublicTestnetFullWithdrawalController {
  getSnapshot(): EvmPublicTestnetWithdrawalControllerSnapshot;
  subscribe(listener: (snapshot: EvmPublicTestnetWithdrawalControllerSnapshot) => void): () => void;
  /** Synchronously reserves this lane before any wallet interaction. */
  canClaim(): boolean;
  claim(): EvmPublicTestnetWithdrawalClaim | null;
  /** May show approval and withdrawal prompts sequentially under this single claim. */
  start(
    claim: EvmPublicTestnetWithdrawalClaim,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalStartResult>;
  /** Read-only. It never connects a wallet or sends a transaction. */
  recover(signal?: AbortSignal): Promise<EvmPublicTestnetWithdrawalStartResult>;
  dispose(): void;
}

const SAFE_WALLET_FAILURES = new Set([
  'ABORTED',
  'ACCOUNT_CHANGED',
  'DISCONNECTED',
  'INVALID_RESPONSE',
  'REQUEST_PENDING',
  'UNSUPPORTED',
  'USER_REJECTED',
]);

function frozenResult(
  status: EvmPublicTestnetWithdrawalStartResult['status'],
  message?: string,
): EvmPublicTestnetWithdrawalStartResult {
  return Object.freeze(
    message === undefined ? { status } : { status, message },
  ) as EvmPublicTestnetWithdrawalStartResult;
}

function terminalApiFailure(errorValue: unknown): boolean {
  return (
    errorValue instanceof EvmPublicTestnetWithdrawalApiError &&
    (errorValue.code === 'REPLACED' || errorValue.code === 'REVERTED')
  );
}

function safeWalletFailure(errorValue: unknown): boolean {
  return (
    errorValue instanceof EvmPublicTestnetWalletError && SAFE_WALLET_FAILURES.has(errorValue.code)
  );
}

function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('withdrawal observation aborted'));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
    const aborted = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      reject(new Error('withdrawal observation aborted'));
    };
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

class DefaultEvmPublicTestnetFullWithdrawalController implements EvmPublicTestnetFullWithdrawalController {
  readonly #account: string;
  readonly #api: EvmPublicTestnetWithdrawalApi;
  readonly #wallet: EvmPublicTestnetWithdrawalWalletPort;
  readonly #storage: EvmPublicTestnetWithdrawalRecoveryJournalStorage | undefined;
  readonly #pollIntervalMilliseconds: number;
  readonly #approvalPollAttempts: number;
  readonly #withdrawalPollAttempts: number;
  readonly #wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #listeners = new Set<(snapshot: EvmPublicTestnetWithdrawalControllerSnapshot) => void>();
  #snapshot: EvmPublicTestnetWithdrawalControllerSnapshot;
  #journal: EvmPublicTestnetWithdrawalRecoveryJournalRecord | null = null;
  #activeClaim: EvmPublicTestnetWithdrawalClaim | null = null;
  #running = false;
  #disposed = false;
  #storageUnavailable = false;
  #blockedByDeposit = false;

  constructor(dependencies: EvmPublicTestnetFullWithdrawalControllerDependencies) {
    this.#account = validateEvmPublicTestnetWithdrawalRequest({
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: dependencies.account,
    }).account;
    this.#api = dependencies.api;
    this.#wallet = dependencies.wallet;
    this.#storage = dependencies.storage;
    this.#pollIntervalMilliseconds = dependencies.pollIntervalMilliseconds ?? 1_000;
    this.#approvalPollAttempts = dependencies.approvalPollAttempts ?? 60;
    this.#withdrawalPollAttempts = dependencies.withdrawalPollAttempts ?? 15;
    this.#wait = dependencies.wait ?? defaultWait;
    if (
      !Number.isSafeInteger(this.#pollIntervalMilliseconds) ||
      this.#pollIntervalMilliseconds < 0 ||
      this.#pollIntervalMilliseconds > 10_000 ||
      !Number.isSafeInteger(this.#approvalPollAttempts) ||
      this.#approvalPollAttempts < 0 ||
      this.#approvalPollAttempts > 60 ||
      !Number.isSafeInteger(this.#withdrawalPollAttempts) ||
      this.#withdrawalPollAttempts < 0 ||
      this.#withdrawalPollAttempts > 60 ||
      typeof this.#wait !== 'function'
    ) {
      throw new TypeError('withdrawal polling configuration is invalid');
    }
    try {
      this.#journal = readEvmPublicTestnetWithdrawalRecoveryJournal(this.#storage);
      this.#blockedByDeposit = hasCompetingEvmPublicTestnetOperation('WITHDRAWAL', this.#storage);
    } catch {
      this.#storageUnavailable = true;
    }
    const locked = this.#storageUnavailable || this.#journal !== null || this.#blockedByDeposit;
    this.#snapshot = Object.freeze({
      status: locked ? ('RECOVERY_REQUIRED' as const) : ('IDLE' as const),
      ready: !locked,
      locked,
      step: this.#journal?.step ?? null,
      transactionHash: this.#journal?.transactionHash ?? null,
      message: this.#storageUnavailable
        ? 'Safe withdrawal storage is unavailable; no wallet transaction will be sent.'
        : this.#journal !== null
          ? 'A prior withdrawal step needs read-only server recovery before any new send.'
          : this.#blockedByDeposit
            ? 'Finish the unresolved Base Sepolia deposit before starting a withdrawal.'
            : null,
    });
  }

  getSnapshot(): EvmPublicTestnetWithdrawalControllerSnapshot {
    return this.#snapshot;
  }

  subscribe(
    listener: (snapshot: EvmPublicTestnetWithdrawalControllerSnapshot) => void,
  ): () => void {
    if (typeof listener !== 'function')
      throw new TypeError('withdrawal listener must be a function');
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  canClaim(): boolean {
    this.#refreshCompetingDeposit();
    return (
      !this.#disposed &&
      !this.#storageUnavailable &&
      !this.#blockedByDeposit &&
      this.#journal === null &&
      this.#activeClaim === null &&
      !this.#running
    );
  }

  claim(): EvmPublicTestnetWithdrawalClaim | null {
    if (!this.canClaim()) return null;
    const claim = Object.freeze({ account: this.#account, id: Symbol('evm-full-withdrawal') });
    this.#activeClaim = claim;
    this.#setSnapshot({
      status: 'PREPARING',
      ready: false,
      locked: true,
      step: null,
      transactionHash: null,
      message: null,
    });
    return claim;
  }

  async start(
    claim: EvmPublicTestnetWithdrawalClaim,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalStartResult> {
    if (
      this.#disposed ||
      this.#running ||
      this.#activeClaim === null ||
      claim !== this.#activeClaim
    ) {
      return frozenResult('FAILED', 'The withdrawal launch claim is no longer valid.');
    }
    this.#running = true;
    try {
      this.#setSnapshot({ ...this.#snapshot, status: 'CONNECTING_WALLET' });
      let connectedAccount: string;
      try {
        connectedAccount = await this.#wallet.connect(signal);
      } catch {
        return this.#finishFailed('The Base Sepolia wallet could not be connected safely.');
      }
      if (connectedAccount.toLowerCase() !== this.#account) {
        return this.#finishFailed('The connected wallet account does not match this portfolio.');
      }

      let approvalVerified = false;
      for (let index = 0; index < 2; index += 1) {
        let intent: EvmPublicTestnetWithdrawalIntent;
        try {
          intent = await this.#api.prepare(
            { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: this.#account },
            signal,
          );
        } catch (caught) {
          if (
            caught instanceof EvmPublicTestnetWithdrawalApiError &&
            caught.code === 'EMPTY_POSITION'
          ) {
            return this.#finishComplete('The Base Sepolia lending position is already empty.');
          }
          return this.#finishFailed('The next withdrawal step could not be prepared safely.');
        }
        if (approvalVerified && intent.step !== 'WITHDRAW_FULL_ETH') {
          return this.#finishFailed(
            'The verified approval was not followed by an exact withdrawal intent.',
          );
        }

        let journal: EvmPublicTestnetWithdrawalRecoveryJournalRecord;
        try {
          journal = startEvmPublicTestnetWithdrawalRecoveryJournal(
            {
              chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
              step: intent.step,
              intentId: intent.intentId,
              account: intent.account,
              nonce: intent.transaction.nonce,
              evidenceExpiresAt: intent.evidenceExpiresAt,
              aTokenBalanceBeforeAtomic: intent.position.aTokenBalanceBeforeAtomic,
              allowanceBeforeAtomic: intent.allowance.beforeAtomic,
            },
            this.#storage,
          );
          this.#journal = journal;
        } catch {
          return this.#finishFailed(
            'The recovery lock could not be persisted, so no wallet transaction was sent.',
          );
        }

        this.#setSnapshot({
          status: intent.step === 'APPROVE_AWETH' ? 'WALLET_APPROVAL' : 'WALLET_WITHDRAWAL',
          ready: false,
          locked: true,
          step: intent.step,
          transactionHash: null,
          message: null,
        });

        let transactionHash: string;
        try {
          const sent = await this.#wallet.sendWithdrawalTransaction(
            evmPublicTestnetWithdrawalWalletTransaction(intent),
            this.#account,
            signal,
          );
          transactionHash = sent.transactionHash;
        } catch (caught) {
          if (safeWalletFailure(caught)) {
            if (!this.#clearJournal(journal)) {
              return this.#finishRecovery(
                'The wallet did not broadcast, but the local recovery lock could not be cleared.',
              );
            }
            return this.#finishFailed('The wallet did not authorize this withdrawal step.');
          }
          return this.#finishRecovery(
            'The wallet result was inconclusive. Read-only recovery is required; this app will not resend.',
          );
        }

        try {
          journal = addEvmPublicTestnetWithdrawalRecoveryTransactionHash(
            journal,
            transactionHash,
            this.#storage,
          );
          this.#journal = journal;
        } catch {
          return this.#finishRecovery(
            'A transaction hash was returned but could not be persisted. This app will not resend.',
            transactionHash,
          );
        }

        this.#setSnapshot({
          ...this.#snapshot,
          status: intent.step === 'APPROVE_AWETH' ? 'VERIFYING_APPROVAL' : 'VERIFYING_WITHDRAWAL',
          transactionHash,
        });
        let result;
        try {
          result = await this.#api.submit(
            evmPublicTestnetWithdrawalResultExpectation(intent),
            { transactionHash },
            signal,
          );
          result = await this.#pollWhilePending(intent, result, signal);
        } catch (caught) {
          if (terminalApiFailure(caught)) {
            if (!this.#clearJournal(journal)) {
              return this.#finishRecovery(
                'The server reached a terminal decision, but the local recovery lock could not be cleared.',
                transactionHash,
              );
            }
            return this.#finishFailed(
              caught instanceof EvmPublicTestnetWithdrawalApiError && caught.code === 'REVERTED'
                ? 'The reviewed Base Sepolia transaction reverted.'
                : 'The reviewed nonce was replaced by a different transaction.',
            );
          }
          return this.#finishRecovery(
            'Server verification is unresolved. Use read-only recovery; this app will not resend.',
            transactionHash,
          );
        }
        if (
          result.status === 'PENDING' ||
          (intent.step === 'WITHDRAW_FULL_ETH' && result.status !== 'VERIFIED')
        ) {
          return this.#finishRecovery(
            result.status === 'CONFIRMED'
              ? 'The withdrawal is confirmed and finality is pending. Use read-only recovery; this app will not resend.'
              : 'The transaction is still pending. Use read-only recovery; this app will not resend.',
            result.transaction.transactionHash ?? transactionHash,
          );
        }
        if (!this.#clearJournal(journal)) {
          return this.#finishRecovery(
            'The step is verified, but the local recovery lock could not be cleared.',
            result.transaction.transactionHash ?? transactionHash,
          );
        }
        if (intent.step === 'WITHDRAW_FULL_ETH') {
          return this.#finishComplete('The full Base Sepolia aWETH position was withdrawn.');
        }
        approvalVerified = true;
        this.#setSnapshot({
          status: 'PREPARING',
          ready: false,
          locked: true,
          step: null,
          transactionHash: null,
          message:
            result.status === 'VERIFIED'
              ? 'Approval verified. Preparing the exact full-withdrawal transaction.'
              : 'Approval confirmed with maximum allowance. Preparing the dependent withdrawal transaction.',
        });
      }
      return this.#finishFailed('The withdrawal sequence did not reach its full-withdrawal step.');
    } finally {
      this.#running = false;
    }
  }

  async recover(signal?: AbortSignal): Promise<EvmPublicTestnetWithdrawalStartResult> {
    if (this.#disposed || this.#running || this.#activeClaim !== null) {
      return frozenResult('FAILED', 'Withdrawal recovery is already busy or unavailable.');
    }
    if (this.#storageUnavailable) {
      return frozenResult(
        'RECOVERY_REQUIRED',
        'Safe withdrawal storage is unavailable; no new transaction will be sent.',
      );
    }
    this.#refreshCompetingDeposit();
    if (this.#journal === null) {
      if (this.#blockedByDeposit) {
        return frozenResult(
          'RECOVERY_REQUIRED',
          'Finish the unresolved Base Sepolia deposit before starting a withdrawal.',
        );
      }
      return frozenResult('FAILED', 'There is no unresolved withdrawal step to recover.');
    }
    this.#running = true;
    const journal = this.#journal;
    this.#setSnapshot({
      ...this.#snapshot,
      status: journal.step === 'APPROVE_AWETH' ? 'VERIFYING_APPROVAL' : 'VERIFYING_WITHDRAWAL',
    });
    try {
      let result;
      try {
        result = await this.#api.query(
          evmPublicTestnetWithdrawalExpectationFromJournal(journal),
          signal,
        );
      } catch (caught) {
        if (terminalApiFailure(caught)) {
          if (!this.#clearJournal(journal)) {
            return this.#finishRecovery(
              'The server reached a terminal decision, but the local recovery lock could not be cleared.',
            );
          }
          return this.#finishFailed(
            caught instanceof EvmPublicTestnetWithdrawalApiError && caught.code === 'REVERTED'
              ? 'The reviewed Base Sepolia transaction reverted.'
              : 'The reviewed nonce was replaced by a different transaction.',
          );
        }
        return this.#finishRecovery(
          'The withdrawal step is still unresolved. Recovery is read-only and will never resend it.',
        );
      }
      if (
        result.status === 'PENDING' ||
        (journal.step === 'WITHDRAW_FULL_ETH' && result.status !== 'VERIFIED')
      ) {
        return this.#finishRecovery(
          result.status === 'CONFIRMED'
            ? 'The withdrawal is confirmed and finality is pending. Recovery is read-only and will never resend it.'
            : 'The withdrawal step is still pending. Recovery is read-only and will never resend it.',
          result.transaction.transactionHash ?? journal.transactionHash,
        );
      }
      if (!this.#clearJournal(journal)) {
        return this.#finishRecovery('The verified recovery lock could not be cleared safely.');
      }
      if (journal.step === 'WITHDRAW_FULL_ETH') {
        return this.#finishComplete('The full Base Sepolia aWETH position was withdrawn.');
      }
      return this.#finishFailed(
        'The aWETH approval is verified. Start a new launch to prepare the withdrawal; recovery never sends automatically.',
      );
    } finally {
      this.#running = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#wallet.dispose();
    this.#listeners.clear();
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      status: 'DISPOSED',
      ready: false,
      locked: this.#journal !== null,
    });
  }

  #refreshCompetingDeposit(): void {
    if (this.#disposed || this.#storageUnavailable || this.#journal !== null || this.#running)
      return;
    let blocked: boolean;
    try {
      blocked = hasCompetingEvmPublicTestnetOperation('WITHDRAWAL', this.#storage);
    } catch {
      this.#storageUnavailable = true;
      this.#setSnapshot({
        status: 'RECOVERY_REQUIRED',
        ready: false,
        locked: true,
        step: null,
        transactionHash: null,
        message: 'Safe withdrawal storage is unavailable; no wallet transaction will be sent.',
      });
      return;
    }
    if (blocked === this.#blockedByDeposit) return;
    this.#blockedByDeposit = blocked;
    this.#setSnapshot({
      status: blocked ? 'RECOVERY_REQUIRED' : 'IDLE',
      ready: !blocked,
      locked: blocked,
      step: null,
      transactionHash: null,
      message: blocked
        ? 'Finish the unresolved Base Sepolia deposit before starting a withdrawal.'
        : null,
    });
  }

  async #pollWhilePending(
    intent: EvmPublicTestnetWithdrawalIntent,
    initial: Awaited<ReturnType<EvmPublicTestnetWithdrawalApi['submit']>>,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<EvmPublicTestnetWithdrawalApi['submit']>>> {
    let result = initial;
    const attempts =
      intent.step === 'APPROVE_AWETH' ? this.#approvalPollAttempts : this.#withdrawalPollAttempts;
    for (let attempt = 0; result.status === 'PENDING' && attempt < attempts; attempt += 1) {
      await this.#wait(this.#pollIntervalMilliseconds, signal);
      result = await this.#api.query(evmPublicTestnetWithdrawalResultExpectation(intent), signal);
    }
    return result;
  }

  #clearJournal(journal: EvmPublicTestnetWithdrawalRecoveryJournalRecord): boolean {
    try {
      clearEvmPublicTestnetWithdrawalRecoveryJournal(journal, this.#storage);
      this.#journal = null;
      return true;
    } catch {
      return false;
    }
  }

  #finishComplete(message: string): EvmPublicTestnetWithdrawalStartResult {
    this.#activeClaim = null;
    this.#setSnapshot({
      status: 'COMPLETE',
      ready: true,
      locked: false,
      step: null,
      transactionHash: null,
      message,
    });
    return frozenResult('COMPLETE', message);
  }

  #finishFailed(message: string): EvmPublicTestnetWithdrawalStartResult {
    this.#activeClaim = null;
    const locked = this.#journal !== null || this.#storageUnavailable || this.#blockedByDeposit;
    this.#setSnapshot({
      status: locked ? 'RECOVERY_REQUIRED' : 'FAILED',
      ready: !locked,
      locked,
      step: this.#journal?.step ?? null,
      transactionHash: this.#journal?.transactionHash ?? null,
      message,
    });
    return locked ? frozenResult('RECOVERY_REQUIRED', message) : frozenResult('FAILED', message);
  }

  #finishRecovery(
    message: string,
    transactionHash?: string | null,
  ): EvmPublicTestnetWithdrawalStartResult {
    this.#activeClaim = null;
    this.#setSnapshot({
      status: 'RECOVERY_REQUIRED',
      ready: false,
      locked: true,
      step: this.#journal?.step ?? this.#snapshot.step,
      transactionHash: transactionHash ?? this.#journal?.transactionHash ?? null,
      message,
    });
    return frozenResult('RECOVERY_REQUIRED', message);
  }

  #setSnapshot(snapshot: EvmPublicTestnetWithdrawalControllerSnapshot): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.#snapshot);
      } catch {
        // One presentation listener cannot interrupt transaction recovery.
      }
    }
  }
}

export function createEvmPublicTestnetFullWithdrawalController(
  dependencies: EvmPublicTestnetFullWithdrawalControllerDependencies,
): EvmPublicTestnetFullWithdrawalController {
  return new DefaultEvmPublicTestnetFullWithdrawalController(dependencies);
}
