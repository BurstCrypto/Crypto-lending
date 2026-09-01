import {
  EvmPublicTestnetWithdrawalApiClient,
  createDefaultEvmPublicTestnetFullWithdrawalController,
  createEvmPublicTestnetFullWithdrawalController,
  hasCompetingEvmPublicTestnetOperation,
  readEvmPublicTestnetWithdrawalRecoveryJournal,
  type EvmPublicTestnetFullWithdrawalController,
  type EvmPublicTestnetPositionSnapshot,
} from '@/lib/evm-public-testnet';
import {
  claimPublicTestnetWithdrawal,
  recoverStoredPublicTestnetWithdrawal,
  startClaimedPublicTestnetWithdrawalWithDiscoveredWallet,
  type ClaimedPublicTestnetWithdrawal,
  type PublicTestnetWithdrawalApi,
} from '@/lib/public-testnet/public-testnet-withdrawal';
import { DefaultPublicTestnetWithdrawalClient } from '@/lib/public-testnet/public-testnet-withdrawal-client';
import { readPublicTestnetOperationLock } from '@/lib/public-testnet/public-testnet-operation-lock';
import { readPublicTestnetRecoveryJournal } from '@/lib/public-testnet/public-testnet-recovery-journal';
import { readPublicTestnetWithdrawalRecoveryJournal } from '@/lib/public-testnet/public-testnet-withdrawal-recovery-journal';
import type { PublicTestnetPositionSnapshot } from '@/lib/public-testnet/public-testnet-execution';
import type { EvmPublicTestnetWithdrawalWalletPort } from '@/lib/wallets/eip1193/public-testnet-executor';

import type {
  PublicTestnetWithdrawalAdapters,
  PublicTestnetWithdrawalClaim,
  PublicTestnetWithdrawalLaneAdapter,
  PublicTestnetWithdrawalLaneAvailability,
  PublicTestnetWithdrawalLaneProgress,
  PublicTestnetWithdrawalLaneResult,
} from './public-testnet-withdrawal-coordinator';

interface BrowserPublicTestnetWithdrawalDependencies {
  readonly createEvmApi: () => EvmPublicTestnetWithdrawalApiClient;
  readonly createEvmController: typeof createEvmPublicTestnetFullWithdrawalController;
  readonly createDefaultEvmController: (
    account: string,
  ) => Promise<EvmPublicTestnetFullWithdrawalController>;
  readonly createSolanaApi: () => PublicTestnetWithdrawalApi;
  readonly startSolanaWithdrawal: typeof startClaimedPublicTestnetWithdrawalWithDiscoveredWallet;
  readonly now: () => Date;
}

const DEFAULT_DEPENDENCIES: BrowserPublicTestnetWithdrawalDependencies = Object.freeze({
  createEvmApi: () => new EvmPublicTestnetWithdrawalApiClient(),
  createEvmController: createEvmPublicTestnetFullWithdrawalController,
  createDefaultEvmController: (account: string) =>
    createDefaultEvmPublicTestnetFullWithdrawalController(account),
  createSolanaApi: () => new DefaultPublicTestnetWithdrawalClient(),
  startSolanaWithdrawal: startClaimedPublicTestnetWithdrawalWithDiscoveredWallet,
  now: () => new Date(),
});

function ready(message: string): PublicTestnetWithdrawalLaneAvailability {
  return Object.freeze({ status: 'READY' as const, message });
}

function locked(message: string, recoverable = false): PublicTestnetWithdrawalLaneAvailability {
  return Object.freeze({ status: 'LOCKED' as const, message, recoverable });
}

function failed(message: string): PublicTestnetWithdrawalLaneResult {
  return Object.freeze({ status: 'FAILED' as const, message });
}

function recovery(message: string): PublicTestnetWithdrawalLaneResult {
  return Object.freeze({ status: 'RECOVERY_REQUIRED' as const, message });
}

function progressMessage(
  snapshot: ReturnType<EvmPublicTestnetFullWithdrawalController['getSnapshot']>,
): string {
  if (snapshot.message !== null) return snapshot.message;
  switch (snapshot.status) {
    case 'CONNECTING_WALLET':
      return 'Confirm the matching EVM wallet and Base Sepolia network.';
    case 'WALLET_APPROVAL':
      return 'Approve aWETH for the reviewed full-position withdrawal.';
    case 'VERIFYING_APPROVAL':
      return 'Verifying the approval before preparing the withdrawal prompt.';
    case 'WALLET_WITHDRAWAL':
      return 'Confirm the reviewed full-position ETH withdrawal.';
    case 'VERIFYING_WITHDRAWAL':
      return 'Verifying the withdrawal without resending it.';
    default:
      return 'Preparing the next Base Sepolia withdrawal step.';
  }
}

interface EvmLocalClaim {
  readonly token: object;
  readonly snapshot: EvmPublicTestnetPositionSnapshot;
}

class BrowserEvmWithdrawalAdapter implements PublicTestnetWithdrawalLaneAdapter<EvmPublicTestnetPositionSnapshot> {
  #active: EvmLocalClaim | null = null;

  constructor(private readonly dependencies: BrowserPublicTestnetWithdrawalDependencies) {}

  inspect(snapshot: EvmPublicTestnetPositionSnapshot): PublicTestnetWithdrawalLaneAvailability {
    if (
      snapshot.position.status !== 'OPEN' ||
      BigInt(snapshot.position.aTokenBalanceAtomic) === 0n
    ) {
      return Object.freeze({ status: 'EMPTY' as const, message: null });
    }
    const withdrawal = readEvmPublicTestnetWithdrawalRecoveryJournal();
    if (withdrawal !== null) {
      return locked(
        'A prior EVM withdrawal step needs read-only recovery before any new send.',
        true,
      );
    }
    if (hasCompetingEvmPublicTestnetOperation('WITHDRAWAL')) {
      return locked('Finish the unresolved EVM deposit before starting a withdrawal.');
    }
    return ready('Ready. This lane may require an approval and then a withdrawal prompt.');
  }

  claim(snapshot: EvmPublicTestnetPositionSnapshot): PublicTestnetWithdrawalClaim | null {
    if (this.#active !== null || this.inspect(snapshot).status !== 'READY') return null;
    const token = Object.freeze({});
    this.#active = Object.freeze({ token, snapshot });
    return Object.freeze({ lane: 'EVM' as const, value: token });
  }

  async start(
    claim: PublicTestnetWithdrawalClaim,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<PublicTestnetWithdrawalLaneResult> {
    const active = this.#active;
    if (active === null || claim.lane !== 'EVM' || claim.value !== active.token) {
      return failed('The EVM withdrawal launch claim is no longer valid.');
    }
    let controller: EvmPublicTestnetFullWithdrawalController | null = null;
    let unsubscribe: (() => void) | null = null;
    try {
      onProgress({ message: 'Finding the EVM wallet authorized for this dashboard account.' });
      controller = await this.dependencies.createDefaultEvmController(active.snapshot.account);
      const initial = controller.getSnapshot();
      if (initial.locked) {
        return recovery(
          initial.message ?? 'A prior EVM step needs read-only recovery before any new send.',
        );
      }
      unsubscribe = controller.subscribe((snapshot) => {
        onProgress({ message: progressMessage(snapshot) });
      });
      const controllerClaim = controller.claim();
      if (controllerClaim === null) {
        return failed('The EVM withdrawal lane could not be reserved safely.');
      }
      const result = await controller.start(controllerClaim);
      if (result.status === 'COMPLETE') {
        return Object.freeze({
          status: 'COMPLETE' as const,
          message: result.message ?? 'The Base Sepolia lending position was withdrawn.',
        });
      }
      return result.status === 'RECOVERY_REQUIRED'
        ? recovery(result.message)
        : failed(result.message);
    } catch {
      return failed('The EVM wallet flow could not be started safely. It was not retried.');
    } finally {
      unsubscribe?.();
      controller?.dispose();
    }
  }

  async recover(
    snapshot: EvmPublicTestnetPositionSnapshot,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<PublicTestnetWithdrawalLaneResult> {
    onProgress({ message: 'Querying stored EVM transaction evidence. No wallet will be opened.' });
    const unavailableWallet: EvmPublicTestnetWithdrawalWalletPort = Object.freeze({
      connect: async () => {
        throw new Error('wallet access is disabled during recovery');
      },
      readSnapshot: async () => {
        throw new Error('wallet access is disabled during recovery');
      },
      sendTransaction: async () => {
        throw new Error('wallet access is disabled during recovery');
      },
      sendWithdrawalTransaction: async () => {
        throw new Error('wallet access is disabled during recovery');
      },
      subscribeInvalidation: () => () => undefined,
      dispose: () => undefined,
    });
    const controller = this.dependencies.createEvmController({
      account: snapshot.account,
      api: this.dependencies.createEvmApi(),
      wallet: unavailableWallet,
    });
    try {
      const result = await controller.recover();
      if (result.status === 'COMPLETE') {
        return Object.freeze({
          status: 'COMPLETE' as const,
          message: result.message ?? 'The stored EVM withdrawal is verified.',
        });
      }
      return result.status === 'RECOVERY_REQUIRED'
        ? recovery(result.message)
        : failed(result.message);
    } catch {
      return recovery(
        'The EVM step is still unresolved. No wallet was opened and nothing was resent.',
      );
    } finally {
      controller.dispose();
    }
  }

  release(claim: PublicTestnetWithdrawalClaim): void {
    if (claim.lane === 'EVM' && this.#active?.token === claim.value) this.#active = null;
  }
}

interface SolanaLocalClaim {
  readonly token: object;
  readonly snapshot: PublicTestnetPositionSnapshot;
  readonly api: PublicTestnetWithdrawalApi;
  prepared: ClaimedPublicTestnetWithdrawal | null;
}

class BrowserSolanaWithdrawalAdapter implements PublicTestnetWithdrawalLaneAdapter<PublicTestnetPositionSnapshot> {
  #active: SolanaLocalClaim | null = null;

  constructor(private readonly dependencies: BrowserPublicTestnetWithdrawalDependencies) {}

  inspect(snapshot: PublicTestnetPositionSnapshot): PublicTestnetWithdrawalLaneAvailability {
    if (
      snapshot.position.status !== 'OPEN' ||
      BigInt(snapshot.position.collateralTokenAtomic) === 0n
    ) {
      return Object.freeze({ status: 'EMPTY' as const, message: null });
    }
    const withdrawal = readPublicTestnetWithdrawalRecoveryJournal();
    if (withdrawal !== null) {
      return locked(
        'A prior Solana withdrawal needs read-only recovery before any new send.',
        true,
      );
    }
    const deposit = readPublicTestnetRecoveryJournal(this.dependencies.now());
    if (deposit !== null) {
      return locked('Finish the unresolved Solana deposit before starting a withdrawal.');
    }
    const operation = readPublicTestnetOperationLock();
    if (operation !== null) {
      return locked('A Solana testnet operation is already recovery-locked in this tab.');
    }
    return ready('Ready. This lane sends one reviewed Solana withdrawal transaction.');
  }

  claim(snapshot: PublicTestnetPositionSnapshot): PublicTestnetWithdrawalClaim | null {
    if (this.#active !== null || this.inspect(snapshot).status !== 'READY') return null;
    const token = Object.freeze({});
    this.#active = {
      token,
      snapshot,
      api: this.dependencies.createSolanaApi(),
      prepared: null,
    };
    return Object.freeze({ lane: 'SVM' as const, value: token });
  }

  async prepare(
    claim: PublicTestnetWithdrawalClaim,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<void> {
    const active = this.#active;
    if (active === null || claim.lane !== 'SVM' || claim.value !== active.token) {
      throw new Error('invalid Solana withdrawal claim');
    }
    onProgress({ message: 'Securing the exact Solana full-position withdrawal intent.' });
    const prepared = await claimPublicTestnetWithdrawal(active.api, {
      chainId: active.snapshot.chainId,
      account: active.snapshot.account,
    });
    if (prepared.intent.fundingReadiness.status !== 'READY') {
      throw new Error('Solana Devnet fee balance is not ready');
    }
    active.prepared = prepared;
  }

  async start(
    claim: PublicTestnetWithdrawalClaim,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<PublicTestnetWithdrawalLaneResult> {
    const active = this.#active;
    if (
      active === null ||
      claim.lane !== 'SVM' ||
      claim.value !== active.token ||
      active.prepared === null
    ) {
      return failed('The Solana withdrawal launch claim is no longer valid.');
    }
    try {
      onProgress({ message: 'Finding Phantom for the validated Solana dashboard account.' });
      onProgress({ message: 'Review and sign the one Solana withdrawal transaction.' });
      const result = await this.dependencies.startSolanaWithdrawal(active.api, active.prepared);
      if (result.status === 'RECOVERY_REQUIRED') {
        return recovery(
          'The Solana signature is unresolved. Recovery is read-only and this app will not resend.',
        );
      }
      if (result.status === 'FAILED') {
        return failed('The Solana wallet did not complete the reviewed withdrawal transaction.');
      }
      if (result.result.status === 'FAILED') {
        return failed('The Solana withdrawal reached a terminal failure and was not retried.');
      }
      return Object.freeze({
        status: 'COMPLETE' as const,
        message:
          result.result.status === 'SETTLED_POSITION_REMAINS'
            ? 'The Solana withdrawal settled; the refreshed dashboard will show the remaining position.'
            : 'The Solana lending position was withdrawn.',
      });
    } catch {
      return failed('The Solana wallet flow could not be started safely. It was not retried.');
    }
  }

  async recover(
    _snapshot: PublicTestnetPositionSnapshot,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<PublicTestnetWithdrawalLaneResult> {
    onProgress({ message: 'Querying the stored Solana signature. No wallet will be opened.' });
    try {
      const result = await recoverStoredPublicTestnetWithdrawal(
        this.dependencies.createSolanaApi(),
      );
      if (result === null) {
        return failed('There is no stored Solana withdrawal to recover.');
      }
      if (result.status === 'PENDING') {
        return recovery('The Solana signature is still pending. Nothing was resent.');
      }
      if (result.status === 'FAILED') {
        return failed('The Solana withdrawal reached a terminal failure and its lock was cleared.');
      }
      return Object.freeze({
        status: 'COMPLETE' as const,
        message:
          result.status === 'SETTLED_POSITION_REMAINS'
            ? 'The recovered Solana withdrawal settled with a remaining position.'
            : 'The stored Solana withdrawal is verified.',
      });
    } catch {
      return recovery(
        'The Solana signature is still unresolved. No wallet was opened and nothing was resent.',
      );
    }
  }

  release(claim: PublicTestnetWithdrawalClaim): void {
    if (claim.lane === 'SVM' && this.#active?.token === claim.value) this.#active = null;
  }
}

export function createBrowserPublicTestnetWithdrawalAdapters(
  dependencies: BrowserPublicTestnetWithdrawalDependencies = DEFAULT_DEPENDENCIES,
): PublicTestnetWithdrawalAdapters {
  return Object.freeze({
    evm: new BrowserEvmWithdrawalAdapter(dependencies),
    svm: new BrowserSolanaWithdrawalAdapter(dependencies),
  });
}
