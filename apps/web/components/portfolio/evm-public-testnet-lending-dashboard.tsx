'use client';

import { useEffect, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import {
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_EXPLORER_ORIGIN,
  isEvmPublicTestnetUnauthenticated,
  type EvmPublicTestnetExecutionApi,
  type EvmPublicTestnetPositionSnapshot,
} from '@/lib/evm-public-testnet';

interface EvmPublicTestnetLendingDashboardProps {
  readonly account: string | null;
  readonly createApi: () => EvmPublicTestnetExecutionApi;
  readonly onUnauthenticated?: (() => void) | undefined;
  readonly onSnapshotChange?:
    ((snapshot: EvmPublicTestnetPositionSnapshot | null) => void) | undefined;
  readonly refreshKey?: string | number | null | undefined;
}

type DashboardState =
  | Readonly<{ status: 'IDLE' | 'LOADING' }>
  | Readonly<{ status: 'READY'; snapshot: EvmPublicTestnetPositionSnapshot }>
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
  return `${Math.floor(value / 100)}.${(value % 100).toString().padStart(2, '0')}%`;
}

function maskedAccount(account: string): string {
  return `${account.slice(0, 8)}\u2026${account.slice(-6)}`;
}

function explorerAddressUrl(account: string): string {
  return `${EVM_PUBLIC_TESTNET_EXPLORER_ORIGIN}/address/${account}`;
}

export function EvmPublicTestnetLendingDashboard({
  account,
  createApi,
  onUnauthenticated,
  onSnapshotChange,
  refreshKey,
}: EvmPublicTestnetLendingDashboardProps) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<DashboardState>({ status: 'IDLE' });

  useEffect(() => {
    if (account === null) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setState({ status: 'LOADING' });
    });
    let api: EvmPublicTestnetExecutionApi;
    try {
      api = createApi();
    } catch {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setState({ status: 'ERROR' });
      });
      return () => controller.abort();
    }
    void api
      .queryPosition({ chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account }, controller.signal)
      .then((snapshot) => {
        if (!controller.signal.aborted) setState({ status: 'READY', snapshot });
      })
      .catch((error: unknown) => {
        if (isAbortFailure(error, controller.signal)) return;
        if (isEvmPublicTestnetUnauthenticated(error)) onUnauthenticated?.();
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
      id="evm-public-testnet-lending-dashboard"
      aria-labelledby="evm-public-testnet-lending-dashboard-title"
    >
      <div className="public-testnet-lending-dashboard-heading">
        <div>
          <p className="eyebrow">EVM lending dashboard</p>
          <h2 id="evm-public-testnet-lending-dashboard-title">
            {account === null ? 'Your EVM testnet position' : 'Your Base Sepolia position'}
          </h2>
        </div>
        {account === null ? null : (
          <button
            className="portfolio-secondary-action"
            type="button"
            disabled={state.status === 'LOADING'}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh EVM position
          </button>
        )}
      </div>

      {account === null ? (
        <div className="public-testnet-lending-dashboard-empty">
          <strong>Connect MetaMask or Coinbase Wallet to view this wallet.</strong>
          <p>
            Use the EVM public-testnet proof below once. Position refreshes are read-only and never
            ask the wallet to send another transaction.
          </p>
        </div>
      ) : null}

      {account !== null && state.status === 'LOADING' ? (
        <p className="public-testnet-lending-dashboard-status" role="status">
          Reading the latest Base Sepolia position and Aave reserve rate…
        </p>
      ) : null}

      {account !== null && state.status === 'ERROR' ? (
        <div className="public-testnet-lending-dashboard-error" role="alert">
          <strong>The EVM lending position could not be refreshed.</strong>
          <p>No balance or APY is assumed. This read-only request can be retried safely.</p>
        </div>
      ) : null}

      {snapshot !== null ? (
        <>
          <div className="public-testnet-lending-dashboard-summary">
            <div>
              <span>Current supplied amount</span>
              <strong>
                {snapshot.position.status === 'OPEN' ? '≈' : ''}
                {roundedAtomic(snapshot.position.suppliedLiquidityAtomic, 18, 8)} ETH
              </strong>
              <small>
                {snapshot.position.status === 'OPEN' ? 'Open position' : 'No aWETH held'}
              </small>
            </div>
            <div>
              <span>Current Base Sepolia supply APY</span>
              <strong>{basisPointsPercent(snapshot.rate.supplyApyBasisPoints)}</strong>
              <small>Variable · rewards excluded</small>
            </div>
            <div>
              <span>Usual APY</span>
              <strong>Not enough history</strong>
              <small>A single on-chain reading is not an average.</small>
            </div>
          </div>

          {snapshot.position.status === 'EMPTY' ? (
            <div className="public-testnet-lending-dashboard-empty">
              <strong>No Aave WETH position is held by this wallet.</strong>
              <p>The latest read found no aWETH balance in the fixed Base Sepolia reserve.</p>
            </div>
          ) : (
            <article className="public-testnet-lending-dashboard-position">
              <div className="public-testnet-lending-dashboard-position-heading">
                <div>
                  <strong>WETH · Aave V3 · Base Sepolia</strong>
                  <span>Native test ETH supplied through the fixed WETH gateway</span>
                </div>
                <span className="is-open">Open</span>
              </div>
              <dl className="public-testnet-lending-dashboard-metrics">
                <div>
                  <dt>aWETH receipt balance</dt>
                  <dd>
                    {roundedAtomic(snapshot.position.aTokenBalanceAtomic, 18, 8)}{' '}
                    {snapshot.position.aTokenSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Observed block</dt>
                  <dd>{snapshot.liveObservation.blockNumber}</dd>
                </div>
                <div>
                  <dt>Finalized through block</dt>
                  <dd>{snapshot.liveObservation.finalizedBlockNumber}</dd>
                </div>
                <div>
                  <dt>Latest observation</dt>
                  <dd>
                    <time dateTime={snapshot.liveObservation.observedAt}>
                      {new Date(snapshot.liveObservation.observedAt).toLocaleString()}
                    </time>
                  </dd>
                </div>
              </dl>
              <p className="public-testnet-lending-dashboard-note" role="note">
                This is the latest public-testnet position and current variable rate, not a yield
                guarantee or historical average. Base Sepolia mechanics and rates are not
                representative of Mainnet returns; rewards and risk assessment are excluded.
              </p>
              <div className="public-testnet-lending-dashboard-metadata">
                <span title={snapshot.account}>Wallet {maskedAccount(snapshot.account)}</span>
                <a
                  href={explorerAddressUrl(snapshot.account)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View wallet on Base Sepolia Explorer <span aria-hidden="true">↗</span>
                </a>
                <a
                  href={explorerAddressUrl(snapshot.provider.pool)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Aave pool <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          )}
        </>
      ) : null}
    </section>
  );
}
