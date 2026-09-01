import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PublicTestnetWithdrawalCoordinator,
  type PublicTestnetWithdrawalClaim,
  type PublicTestnetWithdrawalLaneAdapter,
  type PublicTestnetWithdrawalLaneId,
  type PublicTestnetWithdrawalLaneResult,
} from '../components/portfolio/public-testnet-withdrawal-coordinator';
import { EVM_PUBLIC_TESTNET_CHAIN_ID } from '../lib/evm-public-testnet/constants';
import {
  parseEvmPublicTestnetPositionSnapshot,
  type EvmPublicTestnetPositionSnapshot,
} from '../lib/evm-public-testnet/execution';
import type { PublicTestnetPositionSnapshot } from '../lib/public-testnet/public-testnet-execution';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  evmPublicTestnetPositionResponse,
} from './evm-public-testnet.fixtures';
import { publicTestnetPosition } from './public-testnet.fixtures';

type Snapshot = EvmPublicTestnetPositionSnapshot | PublicTestnetPositionSnapshot;

function evmPosition(amountAtomic = '50000000000000'): EvmPublicTestnetPositionSnapshot {
  const response = evmPublicTestnetPositionResponse();
  const position = response.position as {
    suppliedLiquidityAtomic: string;
    aTokenBalanceAtomic: string;
  };
  position.suppliedLiquidityAtomic = amountAtomic;
  position.aTokenBalanceAtomic = amountAtomic;
  return parseEvmPublicTestnetPositionSnapshot(response, {
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: EVM_PUBLIC_TESTNET_ACCOUNT,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function laneAdapter<TSnapshot extends Snapshot>(
  lane: PublicTestnetWithdrawalLaneId,
  options: Readonly<{
    events?: string[];
    preparePromise?: Promise<void>;
    recoverable?: boolean;
    recoveryResult?: PublicTestnetWithdrawalLaneResult;
    result?: PublicTestnetWithdrawalLaneResult;
    resultPromise?: Promise<PublicTestnetWithdrawalLaneResult>;
    status?: 'READY' | 'LOCKED';
  }> = {},
) {
  const claimValue: PublicTestnetWithdrawalClaim = Object.freeze({ lane, value: Symbol(lane) });
  const inspect = vi.fn<PublicTestnetWithdrawalLaneAdapter<TSnapshot>['inspect']>(() =>
    options.status === 'LOCKED'
      ? ({
          status: 'LOCKED',
          message: `${lane} recovery lock is active.`,
          ...(options.recoverable === undefined ? {} : { recoverable: options.recoverable }),
        } as const)
      : ({ status: 'READY', message: `${lane} is ready.` } as const),
  );
  const claim = vi.fn<PublicTestnetWithdrawalLaneAdapter<TSnapshot>['claim']>(() => {
    options.events?.push(`claim:${lane}`);
    return claimValue;
  });
  const prepare =
    options.preparePromise === undefined
      ? undefined
      : vi.fn<NonNullable<PublicTestnetWithdrawalLaneAdapter<TSnapshot>['prepare']>>(async () => {
          options.events?.push(`prepare:${lane}`);
          await options.preparePromise;
          options.events?.push(`prepared:${lane}`);
        });
  const start = vi.fn<PublicTestnetWithdrawalLaneAdapter<TSnapshot>['start']>(async () => {
    options.events?.push(`start:${lane}`);
    return await (options.resultPromise ??
      Promise.resolve(
        options.result ??
          ({ status: 'COMPLETE', message: `${lane} withdrawal completed.` } as const),
      ));
  });
  const recover = vi.fn<NonNullable<PublicTestnetWithdrawalLaneAdapter<TSnapshot>['recover']>>(
    async () =>
      options.recoveryResult ??
      ({ status: 'COMPLETE', message: `${lane} recovery completed.` } as const),
  );
  const release = vi.fn<PublicTestnetWithdrawalLaneAdapter<TSnapshot>['release']>(() => {
    options.events?.push(`release:${lane}`);
  });
  const adapter: PublicTestnetWithdrawalLaneAdapter<TSnapshot> = {
    inspect,
    claim,
    ...(prepare === undefined ? {} : { prepare }),
    recover,
    start,
    release,
  };
  return { adapter, claim, claimValue, inspect, prepare, recover, release, start };
}

function renderCoordinator(
  options: Readonly<{
    evm?: ReturnType<typeof laneAdapter<EvmPublicTestnetPositionSnapshot>> | null;
    evmPositionExpected?: boolean;
    evmSnapshot?: EvmPublicTestnetPositionSnapshot | null;
    svm?: ReturnType<typeof laneAdapter<PublicTestnetPositionSnapshot>> | null;
    svmPositionExpected?: boolean;
    svmSnapshot?: PublicTestnetPositionSnapshot | null;
  }> = {},
) {
  const refreshEvm = vi.fn();
  const refreshSvm = vi.fn();
  const writeActivityChanged = vi.fn();
  const evm =
    options.evm === undefined ? laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM') : options.evm;
  const svm =
    options.svm === undefined ? laneAdapter<PublicTestnetPositionSnapshot>('SVM') : options.svm;
  const evmSnapshot = options.evmSnapshot === undefined ? evmPosition() : options.evmSnapshot;
  const svmSnapshot =
    options.svmSnapshot === undefined ? publicTestnetPosition() : options.svmSnapshot;
  const rendered = render(
    <PublicTestnetWithdrawalCoordinator
      adapters={{ evm: evm?.adapter ?? null, svm: svm?.adapter ?? null }}
      evmPositionExpected={options.evmPositionExpected ?? evmSnapshot !== null}
      evmSnapshot={evmSnapshot}
      svmPositionExpected={options.svmPositionExpected ?? svmSnapshot !== null}
      svmSnapshot={svmSnapshot}
      onEvmPositionRefreshRequested={refreshEvm}
      onSvmPositionRefreshRequested={refreshSvm}
      onWriteActivityChange={writeActivityChanged}
    />,
  );
  return { ...rendered, evm, refreshEvm, refreshSvm, svm, writeActivityChanged };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PublicTestnetWithdrawalCoordinator', () => {
  it('is always visible and disables withdrawal until a validated nonzero position is ready', () => {
    renderCoordinator({
      evmPositionExpected: true,
      evmSnapshot: null,
      svmPositionExpected: true,
      svmSnapshot: null,
    });

    const surface = screen.getByRole('region', { name: 'Withdraw your lending positions' });
    expect(within(surface).getAllByText(/token approval/iu)).not.toHaveLength(0);
    expect(within(surface).queryByText(/Base Sepolia|aWETH|maximum\/unlimited/iu)).toBeNull();
    expect(
      within(surface).getByText(/Solana requires one transaction prompt/iu),
    ).toBeInTheDocument();
    expect(
      within(surface).getByRole('button', { name: 'Checking withdrawable positions…' }),
    ).toBeDisabled();
  });

  it('waits for every connected lane to resolve before launching a faster ready lane', () => {
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM');
    const svm = laneAdapter<PublicTestnetPositionSnapshot>('SVM');
    renderCoordinator({
      evm,
      evmPositionExpected: true,
      evmSnapshot: evmPosition(),
      svm,
      svmPositionExpected: true,
      svmSnapshot: null,
    });

    const button = screen.getByRole('button', { name: 'Checking withdrawable positions…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(evm.claim).not.toHaveBeenCalled();
    expect(evm.start).not.toHaveBeenCalled();
  });

  it('treats disconnected null lanes as absent instead of loading forever', () => {
    renderCoordinator({
      evmPositionExpected: false,
      evmSnapshot: null,
      svmPositionExpected: false,
      svmSnapshot: null,
    });

    expect(screen.getByRole('button', { name: 'No withdrawals ready' })).toBeDisabled();
    expect(screen.queryByText(/Checking withdrawable positions/iu)).toBeNull();
    expect(screen.getAllByText('No connected account')).toHaveLength(2);
  });

  it('claims every ready lane before either wallet flow starts and ignores rapid duplicate clicks', async () => {
    const events: string[] = [];
    const pendingEvm = deferred<PublicTestnetWithdrawalLaneResult>();
    const pendingSvm = deferred<PublicTestnetWithdrawalLaneResult>();
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM', {
      events,
      resultPromise: pendingEvm.promise,
    });
    const svm = laneAdapter<PublicTestnetPositionSnapshot>('SVM', {
      events,
      resultPromise: pendingSvm.promise,
    });
    renderCoordinator({ evm, svm, evmSnapshot: evmPosition('25000000000000') });

    expect(screen.getAllByText(/maximum\/unlimited aWETH allowance/iu)).not.toHaveLength(0);
    expect(screen.getAllByText(/full current testnet position/iu)).not.toHaveLength(0);
    const button = screen.getByRole('button', { name: 'Withdraw both testnet positions' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() =>
      expect(events).toEqual(['claim:EVM', 'claim:SVM', 'start:EVM', 'start:SVM']),
    );
    expect(button).toBeDisabled();
    expect(evm.claim).toHaveBeenCalledTimes(1);
    expect(svm.claim).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingEvm.resolve({ status: 'COMPLETE', message: 'EVM returned.' });
      pendingSvm.resolve({ status: 'COMPLETE', message: 'SVM returned.' });
    });

    expect(
      await screen.findByText(/COMPLETE — every launched withdrawal settled/iu),
    ).toBeInTheDocument();
    expect(events).toContain('release:EVM');
    expect(events).toContain('release:SVM');
  });

  it('finishes every supported server-claim phase before opening either wallet flow', async () => {
    const events: string[] = [];
    const evmPreparation = deferred<void>();
    const svmPreparation = deferred<void>();
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM', {
      events,
      preparePromise: evmPreparation.promise,
    });
    const svm = laneAdapter<PublicTestnetPositionSnapshot>('SVM', {
      events,
      preparePromise: svmPreparation.promise,
    });
    renderCoordinator({ evm, svm });

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw both testnet positions' }));

    await waitFor(() =>
      expect(events).toEqual(['claim:EVM', 'claim:SVM', 'prepare:EVM', 'prepare:SVM']),
    );
    expect(evm.start).not.toHaveBeenCalled();
    expect(svm.start).not.toHaveBeenCalled();

    await act(async () => {
      evmPreparation.resolve();
    });
    expect(evm.start).not.toHaveBeenCalled();

    await act(async () => {
      svmPreparation.resolve();
    });
    await waitFor(() => {
      expect(events.indexOf('prepared:EVM')).toBeLessThan(events.indexOf('start:EVM'));
      expect(events.indexOf('prepared:SVM')).toBeLessThan(events.indexOf('start:EVM'));
      expect(events.indexOf('prepared:EVM')).toBeLessThan(events.indexOf('start:SVM'));
      expect(events.indexOf('prepared:SVM')).toBeLessThan(events.indexOf('start:SVM'));
    });
  });

  it('reports partial success without retrying or refreshing the recovery-required lane', async () => {
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM', {
      result: { status: 'COMPLETE', message: 'Base Sepolia withdrawal completed.' },
    });
    const svm = laneAdapter<PublicTestnetPositionSnapshot>('SVM', {
      result: {
        status: 'RECOVERY_REQUIRED',
        message: 'The Solana signature still needs read-only recovery.',
      },
    });
    const harness = renderCoordinator({ evm, svm });

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw both testnet positions' }));

    expect(await screen.findByText(/PARTIAL_SUCCESS/iu)).toBeInTheDocument();
    expect(screen.getByText('Base Sepolia withdrawal completed.')).toBeInTheDocument();
    expect(
      screen.getByText(/Solana signature still needs read-only recovery/iu),
    ).toBeInTheDocument();
    expect(harness.refreshEvm).toHaveBeenCalledTimes(1);
    expect(harness.refreshSvm).not.toHaveBeenCalled();
    expect(evm.start).toHaveBeenCalledTimes(1);
    expect(svm.start).toHaveBeenCalledTimes(1);
  });

  it('keeps a locked EVM lane independent and launches only the ready Solana position', async () => {
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM', { status: 'LOCKED' });
    const svm = laneAdapter<PublicTestnetPositionSnapshot>('SVM');
    const harness = renderCoordinator({ evm, svm });

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw testnet position' }));

    expect(
      await screen.findByText(/COMPLETE — every launched withdrawal settled/iu),
    ).toBeInTheDocument();
    expect(evm.claim).not.toHaveBeenCalled();
    expect(evm.start).not.toHaveBeenCalled();
    expect(svm.claim).toHaveBeenCalledTimes(1);
    expect(svm.start).toHaveBeenCalledTimes(1);
    expect(harness.refreshEvm).not.toHaveBeenCalled();
    expect(harness.refreshSvm).toHaveBeenCalledTimes(1);
  });

  it('offers read-only recovery for a withdrawal lock without launching either wallet flow', async () => {
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM', {
      status: 'LOCKED',
      recoverable: true,
      recoveryResult: { status: 'COMPLETE', message: 'Stored EVM evidence verified.' },
    });
    const svm = laneAdapter<PublicTestnetPositionSnapshot>('SVM', { status: 'LOCKED' });
    const harness = renderCoordinator({ evm, svm });

    expect(screen.queryByRole('button', { name: /Check Solana Devnet recovery/iu })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check Base Sepolia recovery' }));

    expect(await screen.findByText('Stored EVM evidence verified.')).toBeInTheDocument();
    expect(evm.recover).toHaveBeenCalledTimes(1);
    expect(evm.claim).not.toHaveBeenCalled();
    expect(evm.start).not.toHaveBeenCalled();
    expect(svm.start).not.toHaveBeenCalled();
    expect(harness.refreshEvm).toHaveBeenCalledTimes(1);
    expect(harness.refreshSvm).not.toHaveBeenCalled();
  });

  it('refreshes only the queried dashboard when read-only recovery remains unresolved', async () => {
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM', {
      status: 'LOCKED',
      recoverable: true,
      recoveryResult: {
        status: 'RECOVERY_REQUIRED',
        message: 'EVM finality is still pending; nothing was resent.',
      },
    });
    const harness = renderCoordinator({ evm });

    fireEvent.click(screen.getByRole('button', { name: 'Check Base Sepolia recovery' }));

    expect(await screen.findByText(/EVM finality is still pending/iu)).toBeInTheDocument();
    expect(await screen.findByText(/RECOVERY_REQUIRED/iu)).toBeInTheDocument();
    expect(harness.refreshEvm).toHaveBeenCalledTimes(1);
    expect(harness.refreshSvm).not.toHaveBeenCalled();
    expect(evm.claim).not.toHaveBeenCalled();
    expect(evm.start).not.toHaveBeenCalled();
  });

  it('releases every earlier claim and contacts no wallet when a later claim fails', async () => {
    const events: string[] = [];
    const evm = laneAdapter<EvmPublicTestnetPositionSnapshot>('EVM', { events });
    const svm = laneAdapter<PublicTestnetPositionSnapshot>('SVM', { events });
    svm.claim.mockImplementationOnce(() => {
      events.push('claim:SVM');
      return null;
    });
    renderCoordinator({ evm, svm });

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw both testnet positions' }));

    await waitFor(() => expect(screen.getByText(/did not complete/iu)).toBeInTheDocument());
    expect(events).toEqual(['claim:EVM', 'claim:SVM', 'release:EVM']);
    expect(evm.start).not.toHaveBeenCalled();
    expect(svm.start).not.toHaveBeenCalled();
  });
});
