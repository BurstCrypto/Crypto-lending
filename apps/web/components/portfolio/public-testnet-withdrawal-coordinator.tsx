'use client';

import { useEffect, useRef, useState } from 'react';

import type { EvmPublicTestnetPositionSnapshot } from '@/lib/evm-public-testnet';
import type { PublicTestnetPositionSnapshot } from '@/lib/public-testnet/public-testnet-execution';

import { PublicTestnetWithdrawalLane } from './public-testnet-withdrawal-lane';

export type PublicTestnetWithdrawalLaneId = 'EVM' | 'SVM';

export type PublicTestnetWithdrawalOverallStatus =
  'IDLE' | 'ACTIVE' | 'COMPLETE' | 'PARTIAL_SUCCESS' | 'RECOVERY_REQUIRED' | 'FAILED';

export type PublicTestnetWithdrawalLaneAvailability = Readonly<
  | { status: 'ABSENT' | 'LOADING' | 'EMPTY'; message: null }
  | { status: 'READY' | 'UNAVAILABLE'; message: string }
  | { status: 'LOCKED'; message: string; recoverable?: boolean }
>;

export type PublicTestnetWithdrawalLaneState = Readonly<{
  status: 'IDLE' | 'CLAIMED' | 'ACTIVE' | 'COMPLETE' | 'RECOVERY_REQUIRED' | 'FAILED';
  message: string | null;
}>;

export interface PublicTestnetWithdrawalClaim {
  readonly lane: PublicTestnetWithdrawalLaneId;
  readonly value: unknown;
}

export interface PublicTestnetWithdrawalLaneResult {
  readonly status: 'COMPLETE' | 'RECOVERY_REQUIRED' | 'FAILED';
  readonly message: string;
}

export interface PublicTestnetWithdrawalLaneProgress {
  readonly message: string;
}

export interface PublicTestnetWithdrawalLaneAdapter<TSnapshot> {
  inspect(snapshot: TSnapshot): PublicTestnetWithdrawalLaneAvailability;
  /** This must synchronously reserve the lane and must not contact a wallet. */
  claim(snapshot: TSnapshot): PublicTestnetWithdrawalClaim | null;
  /** Every ready lane finishes this optional server phase before any wallet starts. */
  prepare?(
    claim: PublicTestnetWithdrawalClaim,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<void>;
  start(
    claim: PublicTestnetWithdrawalClaim,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<PublicTestnetWithdrawalLaneResult>;
  /** Read-only recovery. It must never discover, connect, sign, or send through a wallet. */
  recover?(
    snapshot: TSnapshot,
    onProgress: (progress: PublicTestnetWithdrawalLaneProgress) => void,
  ): Promise<PublicTestnetWithdrawalLaneResult>;
  release(claim: PublicTestnetWithdrawalClaim): void;
}

export interface PublicTestnetWithdrawalAdapters {
  readonly evm: PublicTestnetWithdrawalLaneAdapter<EvmPublicTestnetPositionSnapshot> | null;
  readonly svm: PublicTestnetWithdrawalLaneAdapter<PublicTestnetPositionSnapshot> | null;
}

interface PublicTestnetWithdrawalCoordinatorProps {
  readonly adapters: PublicTestnetWithdrawalAdapters;
  readonly evmPositionExpected: boolean;
  readonly evmSnapshot: EvmPublicTestnetPositionSnapshot | null;
  readonly svmPositionExpected: boolean;
  readonly svmSnapshot: PublicTestnetPositionSnapshot | null;
  readonly onEvmPositionRefreshRequested: () => void;
  readonly onSvmPositionRefreshRequested: () => void;
  readonly onWriteActivityChange?: ((active: boolean) => void) | undefined;
}

interface ClaimedLane {
  readonly id: PublicTestnetWithdrawalLaneId;
  readonly claim: PublicTestnetWithdrawalClaim;
  readonly adapter: PublicTestnetWithdrawalLaneAdapter<never>;
  readonly refresh: () => void;
}

const IDLE_LANE_STATE: PublicTestnetWithdrawalLaneState = Object.freeze({
  status: 'IDLE',
  message: null,
});

function roundedAtomic(value: string, decimals: number, shownDecimals: number): string {
  const atomic = BigInt(value);
  const droppedDecimals = decimals - shownDecimals;
  const divisor = 10n ** BigInt(droppedDecimals);
  const rounded = droppedDecimals === 0 ? atomic : (atomic + divisor / 2n) / divisor;
  const scale = 10n ** BigInt(shownDecimals);
  return `${rounded / scale}.${(rounded % scale).toString().padStart(shownDecimals, '0')}`;
}

function defaultAvailability(
  snapshot: EvmPublicTestnetPositionSnapshot | PublicTestnetPositionSnapshot | null,
  adapterAvailable: boolean,
  expected: boolean,
): PublicTestnetWithdrawalLaneAvailability {
  if (!expected) return Object.freeze({ status: 'ABSENT', message: null });
  if (snapshot === null) return Object.freeze({ status: 'LOADING', message: null });
  if (snapshot.position.status === 'EMPTY') {
    return Object.freeze({ status: 'EMPTY', message: null });
  }
  return adapterAvailable
    ? Object.freeze({ status: 'READY', message: 'Ready for one coordinated withdrawal action.' })
    : Object.freeze({
        status: 'UNAVAILABLE',
        message: 'Withdrawal support is unavailable. The position is unchanged.',
      });
}

function inspectLane<
  TSnapshot extends EvmPublicTestnetPositionSnapshot | PublicTestnetPositionSnapshot,
>(
  snapshot: TSnapshot | null,
  adapter: PublicTestnetWithdrawalLaneAdapter<TSnapshot> | null,
  expected: boolean,
): PublicTestnetWithdrawalLaneAvailability {
  const fallback = defaultAvailability(snapshot, adapter !== null, expected);
  if (!expected || snapshot === null || snapshot.position.status === 'EMPTY' || adapter === null)
    return fallback;
  try {
    return adapter.inspect(snapshot);
  } catch {
    return Object.freeze({
      status: 'LOCKED',
      message: 'Safe recovery state could not be read. New writes remain blocked on this network.',
    });
  }
}

function overallCopy(
  status: PublicTestnetWithdrawalOverallStatus,
  activeKind: 'WITHDRAWAL' | 'RECOVERY' | null,
): string {
  switch (status) {
    case 'ACTIVE':
      return activeKind === 'RECOVERY'
        ? 'Checking existing chain evidence only. Recovery cannot connect a wallet or send a transaction.'
        : 'The selected independent withdrawal lanes are in progress. Complete each wallet prompt.';
    case 'COMPLETE':
      return 'COMPLETE — every launched withdrawal settled. Successful dashboards are refreshing.';
    case 'PARTIAL_SUCCESS':
      return 'PARTIAL_SUCCESS — one network completed and another needs attention. Nothing was rolled back or retried.';
    case 'RECOVERY_REQUIRED':
      return 'RECOVERY_REQUIRED — no new transaction will be sent while exact chain evidence is unresolved.';
    case 'FAILED':
      return 'The withdrawal action did not complete. No automatic retry or rollback was attempted.';
    default:
      return 'One button starts every ready nonzero lane. The networks remain independent and are not atomic.';
  }
}

function lanePositionKey(
  snapshot: EvmPublicTestnetPositionSnapshot | PublicTestnetPositionSnapshot | null,
): string {
  if (snapshot === null) return '-';
  const receiptBalance =
    'aTokenBalanceAtomic' in snapshot.position
      ? snapshot.position.aTokenBalanceAtomic
      : snapshot.position.collateralTokenAtomic;
  return `${snapshot.account}:${receiptBalance}`;
}

function laneCanLaunch(state: PublicTestnetWithdrawalLaneState): boolean {
  return state.status === 'IDLE' || state.status === 'FAILED';
}

export function PublicTestnetWithdrawalCoordinator({
  adapters,
  evmPositionExpected,
  evmSnapshot,
  svmPositionExpected,
  svmSnapshot,
  onEvmPositionRefreshRequested,
  onSvmPositionRefreshRequested,
  onWriteActivityChange,
}: PublicTestnetWithdrawalCoordinatorProps) {
  const [overallStatus, setOverallStatus] = useState<PublicTestnetWithdrawalOverallStatus>('IDLE');
  const [activeKind, setActiveKind] = useState<'WITHDRAWAL' | 'RECOVERY' | null>(null);
  const [evmState, setEvmState] = useState<PublicTestnetWithdrawalLaneState>(IDLE_LANE_STATE);
  const [svmState, setSvmState] = useState<PublicTestnetWithdrawalLaneState>(IDLE_LANE_STATE);
  const launchClaimed = useRef(false);
  const evmSnapshotKey = lanePositionKey(evmSnapshot);
  const svmSnapshotKey = lanePositionKey(svmSnapshot);
  const priorEvmSnapshotKey = useRef(evmSnapshotKey);
  const priorSvmSnapshotKey = useRef(svmSnapshotKey);

  useEffect(() => {
    if (priorEvmSnapshotKey.current === evmSnapshotKey) return;
    priorEvmSnapshotKey.current = evmSnapshotKey;
    if (!launchClaimed.current) {
      setEvmState((current) =>
        current.status === 'RECOVERY_REQUIRED' ? current : IDLE_LANE_STATE,
      );
    }
  }, [evmSnapshotKey]);

  useEffect(() => {
    if (priorSvmSnapshotKey.current === svmSnapshotKey) return;
    priorSvmSnapshotKey.current = svmSnapshotKey;
    if (!launchClaimed.current) {
      setSvmState((current) =>
        current.status === 'RECOVERY_REQUIRED' ? current : IDLE_LANE_STATE,
      );
    }
  }, [svmSnapshotKey]);

  useEffect(
    () => () => {
      onWriteActivityChange?.(false);
    },
    [onWriteActivityChange],
  );

  const evmAvailability = inspectLane(evmSnapshot, adapters.evm, evmPositionExpected);
  const svmAvailability = inspectLane(svmSnapshot, adapters.svm, svmPositionExpected);
  const evmReady = evmAvailability.status === 'READY' && laneCanLaunch(evmState);
  const svmReady = svmAvailability.status === 'READY' && laneCanLaunch(svmState);
  const readyLaneCount = Number(evmReady) + Number(svmReady);
  const expectedPositionLoading =
    (evmPositionExpected && evmSnapshot === null) || (svmPositionExpected && svmSnapshot === null);
  const active = overallStatus === 'ACTIVE';

  function setLaneState(
    lane: PublicTestnetWithdrawalLaneId,
    state: PublicTestnetWithdrawalLaneState,
  ): void {
    if (lane === 'EVM') setEvmState(state);
    else setSvmState(state);
  }

  function claimReadyLanes(): readonly ClaimedLane[] | null {
    const claimed: ClaimedLane[] = [];
    const candidates = [
      evmReady && evmSnapshot !== null && adapters.evm !== null
        ? {
            id: 'EVM' as const,
            snapshot: evmSnapshot,
            adapter: adapters.evm,
            refresh: onEvmPositionRefreshRequested,
          }
        : null,
      svmReady && svmSnapshot !== null && adapters.svm !== null
        ? {
            id: 'SVM' as const,
            snapshot: svmSnapshot,
            adapter: adapters.svm,
            refresh: onSvmPositionRefreshRequested,
          }
        : null,
    ].filter((candidate) => candidate !== null);

    try {
      for (const candidate of candidates) {
        const claim = candidate.adapter.claim(candidate.snapshot as never);
        if (claim === null || claim.lane !== candidate.id) throw new Error('claim rejected');
        claimed.push({
          id: candidate.id,
          claim,
          adapter: candidate.adapter as PublicTestnetWithdrawalLaneAdapter<never>,
          refresh: candidate.refresh,
        });
      }
      return claimed;
    } catch {
      for (const lane of claimed) {
        try {
          lane.adapter.release(lane.claim);
        } catch {
          // A release failure leaves the adapter fail-closed; no wallet interaction started.
        }
      }
      return null;
    }
  }

  function launchWithdrawals(): void {
    if (launchClaimed.current || active || expectedPositionLoading || readyLaneCount === 0) return;
    launchClaimed.current = true;
    const claimed = claimReadyLanes();
    if (claimed === null || claimed.length === 0) {
      launchClaimed.current = false;
      setOverallStatus('FAILED');
      return;
    }

    for (const lane of claimed) {
      setLaneState(
        lane.id,
        Object.freeze({
          status: 'CLAIMED',
          message: 'Lane reserved. Securing its server intent before any wallet prompt.',
        }),
      );
    }
    setOverallStatus('ACTIVE');
    setActiveKind('WITHDRAWAL');
    onWriteActivityChange?.(true);

    void (async () => {
      const results: PublicTestnetWithdrawalLaneResult[] = [];
      const successfulRefreshes: (() => void)[] = [];
      const preparation = await Promise.allSettled(
        claimed.map(async (lane) => {
          await lane.adapter.prepare?.(lane.claim, (progress) => {
            setLaneState(lane.id, Object.freeze({ status: 'CLAIMED', message: progress.message }));
          });
          return lane;
        }),
      );
      const prepared = preparation.flatMap((entry, index) => {
        const lane = claimed[index];
        if (lane === undefined) return [];
        if (entry.status === 'fulfilled') return [lane];
        const result = Object.freeze({
          status: 'FAILED' as const,
          message: 'This lane could not secure a withdrawal intent. No wallet prompt was opened.',
        });
        results.push(result);
        setLaneState(lane.id, result);
        try {
          lane.adapter.release(lane.claim);
        } catch {
          // A release failure leaves the adapter fail-closed; no wallet interaction started.
        }
        return [];
      });

      const executions = prepared.map(async (lane) => {
        setLaneState(
          lane.id,
          Object.freeze({ status: 'ACTIVE', message: 'Waiting for this network’s wallet flow.' }),
        );
        try {
          const result = await lane.adapter.start(lane.claim, (progress) => {
            setLaneState(lane.id, Object.freeze({ status: 'ACTIVE', message: progress.message }));
          });
          setLaneState(lane.id, Object.freeze({ status: result.status, message: result.message }));
          if (result.status === 'COMPLETE') successfulRefreshes.push(lane.refresh);
          return result;
        } catch {
          const result = Object.freeze({
            status: 'FAILED' as const,
            message: 'This lane stopped without a conclusive success. It was not retried.',
          });
          setLaneState(lane.id, result);
          return result;
        } finally {
          try {
            lane.adapter.release(lane.claim);
          } catch {
            // Adapter-local locking remains authoritative when release cannot be proven.
          }
        }
      });

      const settled = await Promise.allSettled(executions);
      results.push(
        ...settled.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : [])),
      );
      const completed = results.filter((result) => result.status === 'COMPLETE').length;
      const recoveryRequired = results.some((result) => result.status === 'RECOVERY_REQUIRED');
      setOverallStatus(
        results.length > 0 && completed === results.length
          ? 'COMPLETE'
          : completed > 0
            ? 'PARTIAL_SUCCESS'
            : recoveryRequired
              ? 'RECOVERY_REQUIRED'
              : 'FAILED',
      );
      launchClaimed.current = false;
      setActiveKind(null);
      onWriteActivityChange?.(false);
      for (const refresh of successfulRefreshes) refresh();
    })();
  }

  function recoverLane(laneId: PublicTestnetWithdrawalLaneId): void {
    if (launchClaimed.current || active) return;
    const candidate =
      laneId === 'EVM'
        ? {
            adapter: adapters.evm as PublicTestnetWithdrawalLaneAdapter<never> | null,
            availability: evmAvailability,
            refresh: onEvmPositionRefreshRequested,
            snapshot: evmSnapshot as never,
          }
        : {
            adapter: adapters.svm as PublicTestnetWithdrawalLaneAdapter<never> | null,
            availability: svmAvailability,
            refresh: onSvmPositionRefreshRequested,
            snapshot: svmSnapshot as never,
          };
    if (
      candidate.snapshot === null ||
      candidate.adapter?.recover === undefined ||
      candidate.availability.status !== 'LOCKED' ||
      candidate.availability.recoverable !== true
    ) {
      return;
    }

    launchClaimed.current = true;
    setOverallStatus('ACTIVE');
    setActiveKind('RECOVERY');
    setLaneState(
      laneId,
      Object.freeze({
        status: 'ACTIVE',
        message: 'Checking stored chain evidence without opening a wallet.',
      }),
    );
    onWriteActivityChange?.(true);
    let refreshAfterRecovery = false;
    void candidate.adapter
      .recover(candidate.snapshot, (progress) => {
        setLaneState(laneId, Object.freeze({ status: 'ACTIVE', message: progress.message }));
      })
      .then((result) => {
        setLaneState(laneId, Object.freeze({ status: result.status, message: result.message }));
        setOverallStatus(result.status);
        refreshAfterRecovery = result.status !== 'FAILED';
      })
      .catch(() => {
        const result = Object.freeze({
          status: 'RECOVERY_REQUIRED' as const,
          message: 'Read-only recovery is still unresolved. No transaction was sent.',
        });
        setLaneState(laneId, result);
        setOverallStatus('RECOVERY_REQUIRED');
        refreshAfterRecovery = true;
      })
      .finally(() => {
        launchClaimed.current = false;
        setActiveKind(null);
        onWriteActivityChange?.(false);
        if (refreshAfterRecovery) candidate.refresh();
      });
  }

  const buttonCopy = active
    ? 'Complete wallet withdrawals'
    : expectedPositionLoading
      ? 'Checking withdrawable positions…'
      : readyLaneCount === 0
        ? 'No withdrawals ready'
        : readyLaneCount === 2
          ? 'Withdraw both testnet positions'
          : 'Withdraw testnet position';
  const evmPromptDisclosure =
    evmSnapshot === null
      ? 'EVM can require a token approval followed by a full-position withdrawal prompt.'
      : 'On Base Sepolia, EVM can first require a maximum/unlimited aWETH allowance for the fixed gateway, followed by a second prompt that withdraws the full current testnet position.';

  return (
    <section
      className="public-testnet-withdrawal"
      aria-labelledby="public-testnet-withdrawal-title"
      aria-busy={active}
    >
      <div className="public-testnet-withdrawal-heading">
        <div>
          <p className="eyebrow">Return testnet funds</p>
          <h3 id="public-testnet-withdrawal-title">Withdraw your lending positions</h3>
        </div>
        <span>One action · independent networks</span>
      </div>
      <p>
        Withdraws use each validated nonzero position, including a smaller remaining position.{' '}
        {evmPromptDisclosure} Solana requires one transaction prompt. One network may complete if
        the other fails.
      </p>
      <div className="public-testnet-withdrawal-lanes">
        <PublicTestnetWithdrawalLane
          chain="EVM"
          availability={evmAvailability}
          position={
            !evmPositionExpected
              ? 'No connected account'
              : evmSnapshot === null
                ? 'Position not loaded'
                : `${roundedAtomic(evmSnapshot.position.aTokenBalanceAtomic, 18, 8)} aWETH`
          }
          state={evmState}
          title={evmSnapshot === null ? 'EVM testnet' : 'Base Sepolia'}
          recoveryDisabled={active}
          onRecover={() => recoverLane('EVM')}
        />
        <PublicTestnetWithdrawalLane
          chain="SVM"
          availability={svmAvailability}
          position={
            !svmPositionExpected
              ? 'No connected account'
              : svmSnapshot === null
                ? 'Position not loaded'
                : `${roundedAtomic(svmSnapshot.position.collateralTokenAtomic, 9, 9)} cSOL`
          }
          state={svmState}
          title="Solana Devnet"
          recoveryDisabled={active}
          onRecover={() => recoverLane('SVM')}
        />
      </div>
      <div className="public-testnet-withdrawal-action">
        <button
          className="public-testnet-submit-action"
          type="button"
          disabled={active || expectedPositionLoading || readyLaneCount === 0}
          onClick={launchWithdrawals}
        >
          {buttonCopy}
        </button>
        <p role="status" aria-live="polite">
          {overallCopy(overallStatus, activeKind)}
        </p>
      </div>
    </section>
  );
}
