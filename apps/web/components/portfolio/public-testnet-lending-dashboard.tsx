'use client';

import { useEffect, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import {
  isPublicTestnetUnauthenticated,
  type PublicTestnetExecutionApi,
} from '@/lib/public-testnet/public-testnet-client';
import {
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_EXPLORER_ORIGIN,
  type PublicTestnetPositionSnapshot,
} from '@/lib/public-testnet/public-testnet-execution';

interface PublicTestnetLendingDashboardProps {
  readonly account: string | null;
  readonly createApi: () => PublicTestnetExecutionApi;
  readonly onUnauthenticated?: (() => void) | undefined;
  readonly onSnapshotChange?:
    ((snapshot: PublicTestnetPositionSnapshot | null) => void) | undefined;
  readonly refreshKey?: string | number | null | undefined;
}

type DashboardState =
  | Readonly<{ status: 'IDLE' | 'LOADING' }>
  | Readonly<{ status: 'READY'; snapshot: PublicTestnetPositionSnapshot }>
  | Readonly<{ status: 'ERROR' }>;

function roundedAtomic(value: string, decimals: number, shownDecimals: number): string {
  const atomic = BigInt(value);
  const droppedDecimals = decimals - shownDecimals;
  const divisor = 10n ** BigInt(droppedDecimals);
  const rounded = droppedDecimals === 0 ? atomic : (atomic + divisor / 2n) / divisor;
  const scale = 10n ** BigInt(shownDecimals);
  const whole = rounded / scale;
  if (shownDecimals === 0) return whole.toString();
  return `${whole}.${(rounded % scale).toString().padStart(shownDecimals, '0')}`;
}

function basisPointsPercent(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = (value % 100).toString().padStart(2, '0');
  return `${whole}.${fraction}%`;
}

function maskedAccount(account: string): string {
  return `${account.slice(0, 6)}\u2026${account.slice(-6)}`;
}

function accountExplorerUrl(account: string): string {
  return `${PUBLIC_TESTNET_EXPLORER_ORIGIN}/address/${account}?cluster=devnet`;
}

export function PublicTestnetLendingDashboard({
  account,
  createApi,
  onUnauthenticated,
  onSnapshotChange,
  refreshKey,
}: PublicTestnetLendingDashboardProps) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<DashboardState>({ status: 'IDLE' });

  useEffect(() => {
    if (account === null) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setState({ status: 'LOADING' });
    });
    let api: PublicTestnetExecutionApi;
    try {
      api = createApi();
    } catch {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setState({ status: 'ERROR' });
      });
      return () => controller.abort();
    }
    void api
      .readPosition({ chainId: PUBLIC_TESTNET_CHAIN_ID, account }, controller.signal)
      .then((snapshot) => {
        if (!controller.signal.aborted) setState({ status: 'READY', snapshot });
      })
      .catch((error: unknown) => {
        if (isAbortFailure(error, controller.signal)) return;
        if (isPublicTestnetUnauthenticated(error)) onUnauthenticated?.();
        if (!controller.signal.aborted) setState({ status: 'ERROR' });
      });
    return () => controller.abort();
  }, [account, createApi, onUnauthenticated, refresh, refreshKey]);

  const snapshot =
    account !== null && state.status === 'READY' && state.snapshot.account === account
      ? state.snapshot
      : null;

  useEffect(() => {
    onSnapshotChange?.(snapshot);
  }, [onSnapshotChange, snapshot]);

  useEffect(
    () => () => {
      onSnapshotChange?.(null);
    },
    [onSnapshotChange],
  );

  return (
    <section
      className="public-testnet-lending-dashboard"
      id="public-testnet-lending-dashboard"
      aria-labelledby="public-testnet-lending-dashboard-title"
    >
      <div className="public-testnet-lending-dashboard-heading">
        <div>
          <p className="eyebrow">Lending dashboard</p>
          <h2 id="public-testnet-lending-dashboard-title">Your Devnet lending position</h2>
        </div>
        {account === null ? null : (
          <button
            className="portfolio-secondary-action"
            type="button"
            disabled={state.status === 'LOADING'}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh position
          </button>
        )}
      </div>

      {account === null ? (
        <div className="public-testnet-lending-dashboard-empty">
          <strong>Connect Phantom to view this wallet.</strong>
          <p>
            Use the Devnet proof below to connect Phantom. The position check is read-only; do not
            submit another proof just to refresh this dashboard.
          </p>
        </div>
      ) : null}

      {account !== null && state.status === 'LOADING' ? (
        <p className="public-testnet-lending-dashboard-status" role="status">
          Reading the finalized Devnet position and reserve rate…
        </p>
      ) : null}

      {account !== null && state.status === 'ERROR' ? (
        <div className="public-testnet-lending-dashboard-error" role="alert">
          <strong>The lending position could not be refreshed.</strong>
          <p>No amount or APY is assumed. The read-only check can be retried safely.</p>
        </div>
      ) : null}

      {snapshot !== null ? (
        <>
          <div className="public-testnet-lending-dashboard-summary">
            <div>
              <span>Current supplied value estimate</span>
              <strong>
                {snapshot.position.status === 'OPEN' ? '≈' : ''}
                {roundedAtomic(snapshot.position.suppliedLiquidityAtomic, 9, 6)} SOL
              </strong>
              <small>
                {snapshot.position.status === 'OPEN' ? 'Open position' : 'No cSOL held'}
              </small>
            </div>
            <div>
              <span>Latest base supply APY estimate</span>
              <strong>{basisPointsPercent(snapshot.rate.supplyApyBasisPoints)}</strong>
              <small>Variable · rewards excluded</small>
            </div>
            <div>
              <span>Usual APY</span>
              <strong>Not enough history</strong>
              <small>A single reserve reading is not an average.</small>
            </div>
          </div>

          {snapshot.position.status === 'EMPTY' ? (
            <div className="public-testnet-lending-dashboard-empty">
              <strong>No cSOL position is held by this wallet.</strong>
              <p>The finalized read found no receipt-token balance in the fixed Devnet reserve.</p>
            </div>
          ) : (
            <article className="public-testnet-lending-dashboard-position">
              <div className="public-testnet-lending-dashboard-position-heading">
                <div>
                  <strong>SOL · Solana Devnet</strong>
                  <span>Fixed public lending reserve</span>
                </div>
                <span className={snapshot.position.status === 'OPEN' ? 'is-open' : ''}>
                  {snapshot.position.status === 'OPEN' ? 'Open' : 'Empty'}
                </span>
              </div>
              <dl className="public-testnet-lending-dashboard-metrics">
                <div>
                  <dt>cSOL receipt balance</dt>
                  <dd>
                    {roundedAtomic(snapshot.position.collateralTokenAtomic, 9, 9)}{' '}
                    {snapshot.position.collateralTokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Reserve utilization</dt>
                  <dd>{basisPointsPercent(snapshot.rate.utilizationBasisPoints)}</dd>
                </div>
                <div>
                  <dt>Reserve update slot</dt>
                  <dd>{snapshot.rate.reserveLastUpdatedSlot}</dd>
                </div>
                <div>
                  <dt>Finalized observation</dt>
                  <dd>
                    <time dateTime={snapshot.liveObservation.observedAt}>
                      {new Date(snapshot.liveObservation.observedAt).toLocaleString()}
                    </time>
                  </dd>
                </div>
              </dl>
              <p
                className={
                  snapshot.rate.reserveMarkedStale
                    ? 'public-testnet-lending-dashboard-warning'
                    : 'public-testnet-lending-dashboard-note'
                }
                role="note"
              >
                {snapshot.rate.reserveMarkedStale
                  ? 'The lending program marked its latest reserve state stale. The APY is the latest on-chain estimate, not a current guarantee or historical average.'
                  : 'The APY is a finalized on-chain estimate, not a guarantee or historical average.'}{' '}
                Devnet mechanics are not representative of expected Mainnet returns; rewards and
                risk assessment are excluded.
              </p>
              <div className="public-testnet-lending-dashboard-metadata">
                <span title={snapshot.account}>Wallet {maskedAccount(snapshot.account)}</span>
                <a
                  href={accountExplorerUrl(snapshot.account)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View wallet on Devnet Explorer <span aria-hidden="true">↗</span>
                </a>
                <a
                  href={accountExplorerUrl(snapshot.provider.reserve)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View reserve <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          )}
        </>
      ) : null}
    </section>
  );
}
