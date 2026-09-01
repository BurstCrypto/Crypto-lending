'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { replaceBrowserLocation } from '@/components/authentication/browser-navigation';
import {
  AuthenticationUnauthenticatedError,
  restoreAuthenticationSession,
  type AccountProfile,
} from '@/lib/authentication';
import { isAbortFailure } from '@/lib/authentication/http';
import {
  isLocalDemoUnauthenticated,
  LocalDemoApiClient,
  type LocalDemoWalletNamespace,
} from '@/lib/local-demo/local-demo-client';
import {
  clearAllLocalDemoWalletRosters,
  clearLocalDemoWalletRoster,
  localDemoWalletRosterKey,
  removeLegacyLocalDemoWalletRoster,
} from '@/lib/local-demo/wallet-roster';
import { PORTFOLIO_NETWORKS } from '@/lib/portfolio/unified-balance';
import {
  MultiWalletManager,
  type MultiWalletState,
  type WalletRosterEntry,
} from '@/lib/wallets/multi-wallet-manager';
import {
  LOCAL_DEMO_CONNECTOR_IDS,
  LocalDemoWalletAdapter,
} from '@/lib/wallets/local-demo-wallet-adapter';
import {
  StorageBackedWalletRosterStore,
  type WalletRosterKeyValueStorage,
} from '@/lib/wallets/wallet-roster-storage';

import {
  LocalDemoUnifiedBalanceView,
  type LocalDemoUnifiedBalanceViewState,
} from './local-demo-unified-balance-view';
import { LocalDemoAllocationPlanner } from './local-demo-allocation-planner';

const PORTFOLIO_LOGIN_PATH = '/login?returnTo=%2Fportfolio';
const EMPTY_WALLET_STATE: MultiWalletState = Object.freeze({
  entries: Object.freeze([]),
  persistenceAvailable: true,
});

type ExperiencePhase = 'CHECKING' | 'READY' | 'SIGNED_OUT' | 'UNAVAILABLE';

interface ExperienceDependencies {
  readonly createClient: () => LocalDemoApiClient;
  readonly navigate: (path: string) => void;
  readonly restoreSession: (options: { readonly signal?: AbortSignal }) => Promise<AccountProfile>;
  readonly storage: () => WalletRosterKeyValueStorage;
}

export interface LocalDemoPortfolioProps {
  readonly enabled: boolean;
  /** Deterministic injection boundary for local jsdom evidence. */
  readonly dependencies?: Partial<ExperienceDependencies>;
}

const DEFAULT_DEPENDENCIES: ExperienceDependencies = Object.freeze({
  createClient: () => new LocalDemoApiClient(),
  navigate: replaceBrowserLocation,
  restoreSession: restoreAuthenticationSession,
  storage: () => window.sessionStorage,
});

function dependenciesFor(
  overrides: Partial<ExperienceDependencies> | undefined,
): ExperienceDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function fixedWalletError(): string {
  return 'The synthetic wallet operation could not be confirmed. No wallet or balance was treated as available.';
}

function connectorId(namespace: LocalDemoWalletNamespace): string {
  return LOCAL_DEMO_CONNECTOR_IDS[namespace];
}

function networkName(chainId: string): string {
  return Object.hasOwn(PORTFOLIO_NETWORKS, chainId)
    ? PORTFOLIO_NETWORKS[chainId as keyof typeof PORTFOLIO_NETWORKS].name
    : 'Unsupported network';
}

function acceptedEntry(
  manager: MultiWalletManager,
  adapter: LocalDemoWalletAdapter,
  entry: WalletRosterEntry,
): WalletRosterEntry {
  const projection = adapter.projectionFor(entry.connectionId);
  if (projection === null) throw new Error('local demo wallet projection unavailable');
  const labeled =
    entry.label === projection.label
      ? entry
      : manager.renameWallet(entry.connectionId, projection.label);
  return manager.acceptOwnershipVerification(labeled.connectionId, labeled.lifecycleRevision);
}

function LocalDemoJumpNavigation() {
  return (
    <nav
      className="portfolio-jump-navigation portfolio-jump-nav"
      aria-label="Jump to portfolio sections"
    >
      <a className="portfolio-jump-link navigation-button" href="#wallets">
        Demo wallets
      </a>
      <a className="portfolio-jump-link navigation-button" href="#balances">
        Balances
      </a>
      <a className="portfolio-jump-link navigation-button" href="#opportunities">
        Opportunities
      </a>
    </nav>
  );
}

export function LocalDemoPortfolio({ enabled, dependencies }: LocalDemoPortfolioProps) {
  const configured = useMemo(() => dependenciesFor(dependencies), [dependencies]);
  const [phase, setPhase] = useState<ExperiencePhase>(enabled ? 'CHECKING' : 'UNAVAILABLE');
  const [wallets, setWallets] = useState<MultiWalletState>(EMPTY_WALLET_STATE);
  const [portfolio, setPortfolio] = useState<LocalDemoUnifiedBalanceViewState>({
    status: 'LOADING',
  });
  const [allocationClient, setAllocationClient] = useState<LocalDemoApiClient | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const managerReference = useRef<MultiWalletManager | null>(null);
  const clientReference = useRef<LocalDemoApiClient | null>(null);
  const adaptersReference = useRef<ReadonlyMap<LocalDemoWalletNamespace, LocalDemoWalletAdapter>>(
    new Map(),
  );
  const accountIdReference = useRef<string | null>(null);
  const operationReference = useRef<AbortController | null>(null);
  const operationPending = useRef(false);
  const operationGeneration = useRef(0);

  const clearProtectedState = useCallback((): void => {
    operationGeneration.current += 1;
    operationPending.current = false;
    operationReference.current?.abort();
    operationReference.current = null;
    managerReference.current?.dispose();
    managerReference.current = null;
    clientReference.current = null;
    setAllocationClient(null);
    adaptersReference.current = new Map();
    setWallets(EMPTY_WALLET_STATE);
    setWalletError(null);
    setPendingOperation(null);
  }, []);

  const clearRoster = useCallback((): void => {
    const accountId = accountIdReference.current;
    try {
      if (accountId === null) clearAllLocalDemoWalletRosters(configured.storage());
      else clearLocalDemoWalletRoster(configured.storage(), accountId);
    } catch {
      // Session loss still clears all in-memory authorization even if storage is unavailable.
    }
    accountIdReference.current = null;
  }, [configured]);

  const requireSignIn = useCallback((): void => {
    clearProtectedState();
    clearRoster();
    setPortfolio({ status: 'LOADING' });
    setPhase('SIGNED_OUT');
  }, [clearProtectedState, clearRoster]);

  const readPortfolio = useCallback(
    async (client: LocalDemoApiClient, signal: AbortSignal, generation: number): Promise<void> => {
      setPortfolio({ status: 'LOADING' });
      try {
        const snapshot = await client.readPortfolio(signal);
        if (signal.aborted || generation !== operationGeneration.current) return;
        setPortfolio({ status: 'READY', snapshot });
      } catch (error) {
        if (isAbortFailure(error, signal)) return;
        if (isLocalDemoUnauthenticated(error)) {
          requireSignIn();
          return;
        }
        if (generation === operationGeneration.current) setPortfolio({ status: 'ERROR' });
      }
    },
    [requireSignIn],
  );

  const sessionWasLost = useCallback(
    async (error: unknown, signal?: AbortSignal): Promise<boolean> => {
      if (isLocalDemoUnauthenticated(error)) {
        requireSignIn();
        return true;
      }
      try {
        await configured.restoreSession({ ...(signal === undefined ? {} : { signal }) });
        return false;
      } catch (sessionError) {
        if (
          sessionError instanceof AuthenticationUnauthenticatedError ||
          isLocalDemoUnauthenticated(sessionError)
        ) {
          requireSignIn();
          return true;
        }
        return false;
      }
    },
    [configured, requireSignIn],
  );

  useEffect(() => {
    if (!enabled) return;
    const abortController = new AbortController();
    const generation = ++operationGeneration.current;
    let manager: MultiWalletManager | null = null;
    let unsubscribe: (() => void) | null = null;
    let sessionRestored = false;

    async function bootstrap(): Promise<void> {
      try {
        const profile = await configured.restoreSession({ signal: abortController.signal });
        sessionRestored = true;
        const storage = configured.storage();
        const rosterKey = localDemoWalletRosterKey(profile.accountId);
        accountIdReference.current = profile.accountId;
        removeLegacyLocalDemoWalletRoster(storage);
        const client = configured.createClient();
        const registered = await client.listWallets(abortController.signal);
        if (abortController.signal.aborted || generation !== operationGeneration.current) return;

        const adapters = new Map<LocalDemoWalletNamespace, LocalDemoWalletAdapter>();
        for (const namespace of ['EVM', 'SOLANA'] as const) {
          adapters.set(
            namespace,
            new LocalDemoWalletAdapter(
              namespace,
              client,
              registered.find((wallet) => wallet.namespace === namespace) ?? null,
            ),
          );
        }
        const store = new StorageBackedWalletRosterStore(storage, rosterKey);
        manager = new MultiWalletManager({ adapters: [...adapters.values()], store });
        unsubscribe = manager.subscribe((state) => {
          if (!abortController.signal.aborted) setWallets(state);
        });
        managerReference.current = manager;
        clientReference.current = client;
        setAllocationClient(client);
        adaptersReference.current = adapters;
        setWallets(manager.getState());

        for (const namespace of ['EVM', 'SOLANA'] as const) {
          const restored = await manager.restore(connectorId(namespace), {
            signal: abortController.signal,
          });
          if (restored !== null) acceptedEntry(manager, adapters.get(namespace)!, restored);
        }
        if (abortController.signal.aborted || generation !== operationGeneration.current) return;
        const restoredState = manager.getState();
        setWallets(restoredState);
        setPhase('READY');
        if (restoredState.entries.some((entry) => entry.indexingEnabled)) {
          await readPortfolio(client, abortController.signal, generation);
        } else {
          setPortfolio({ status: 'UNAVAILABLE', reason: 'NO_SUPPORTED_BALANCES' });
        }
      } catch (error) {
        if (isAbortFailure(error, abortController.signal)) return;
        if (
          error instanceof AuthenticationUnauthenticatedError ||
          isLocalDemoUnauthenticated(error)
        ) {
          requireSignIn();
          return;
        }
        if (generation === operationGeneration.current) {
          clearProtectedState();
          if (!sessionRestored) clearRoster();
          setPortfolio({ status: 'ERROR' });
          setPhase('UNAVAILABLE');
        }
      }
    }

    void bootstrap();
    return () => {
      abortController.abort();
      operationGeneration.current += 1;
      operationPending.current = false;
      operationReference.current?.abort();
      operationReference.current = null;
      unsubscribe?.();
      manager?.dispose();
      if (managerReference.current === manager) managerReference.current = null;
    };
  }, [
    bootstrapRevision,
    clearProtectedState,
    clearRoster,
    configured,
    enabled,
    readPortfolio,
    requireSignIn,
  ]);

  useEffect(() => {
    if (phase === 'SIGNED_OUT') configured.navigate(PORTFOLIO_LOGIN_PATH);
  }, [configured, phase]);

  useEffect(() => {
    function revalidatePersistedPage(event: PageTransitionEvent): void {
      if (!event.persisted) return;
      operationGeneration.current += 1;
      operationPending.current = false;
      operationReference.current?.abort();
      operationReference.current = null;
      managerReference.current?.dispose();
      managerReference.current = null;
      clientReference.current = null;
      setAllocationClient(null);
      adaptersReference.current = new Map();
      setWallets(EMPTY_WALLET_STATE);
      setWalletError(null);
      setPendingOperation(null);
      setPortfolio({ status: 'LOADING' });
      setPhase('CHECKING');
      setBootstrapRevision((revision) => revision + 1);
    }
    window.addEventListener('pageshow', revalidatePersistedPage);
    return () => window.removeEventListener('pageshow', revalidatePersistedPage);
  }, []);

  async function connect(namespace: LocalDemoWalletNamespace): Promise<void> {
    const manager = managerReference.current;
    const adapter = adaptersReference.current.get(namespace);
    const client = clientReference.current;
    if (
      phase !== 'READY' ||
      manager === null ||
      adapter === undefined ||
      client === null ||
      operationPending.current
    ) {
      return;
    }
    operationPending.current = true;
    const abortController = new AbortController();
    operationReference.current = abortController;
    const generation = ++operationGeneration.current;
    setWalletError(null);
    setPendingOperation(namespace);
    try {
      const connected = await manager.connect(connectorId(namespace), {
        signal: abortController.signal,
      });
      acceptedEntry(manager, adapter, connected);
      if (abortController.signal.aborted || generation !== operationGeneration.current) return;
      setWallets(manager.getState());
      await readPortfolio(client, abortController.signal, generation);
    } catch (error) {
      if (isAbortFailure(error, abortController.signal)) return;
      if (await sessionWasLost(error, abortController.signal)) return;
      if (generation === operationGeneration.current) setWalletError(fixedWalletError());
    } finally {
      if (generation === operationGeneration.current) {
        operationPending.current = false;
        operationReference.current = null;
        setPendingOperation(null);
      }
    }
  }

  async function disconnect(connectionId: string): Promise<void> {
    const manager = managerReference.current;
    const client = clientReference.current;
    if (phase !== 'READY' || manager === null || client === null || operationPending.current)
      return;
    operationPending.current = true;
    const controller = new AbortController();
    operationReference.current = controller;
    const generation = ++operationGeneration.current;
    setWalletError(null);
    setPendingOperation(connectionId);
    try {
      await manager.disconnect(connectionId, { signal: controller.signal });
      if (generation !== operationGeneration.current) return;
      const disconnectedState = manager.getState();
      setWallets(disconnectedState);
      if (disconnectedState.entries.some((entry) => entry.indexingEnabled)) {
        await readPortfolio(client, controller.signal, generation);
      } else {
        setPortfolio({ status: 'UNAVAILABLE', reason: 'NO_SUPPORTED_BALANCES' });
      }
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (await sessionWasLost(error, controller.signal)) return;
      if (generation === operationGeneration.current) {
        setWallets(manager.getState());
        setWalletError(fixedWalletError());
      }
    } finally {
      if (generation === operationGeneration.current) {
        operationPending.current = false;
        operationReference.current = null;
        setPendingOperation(null);
      }
    }
  }

  async function refresh(): Promise<void> {
    const client = clientReference.current;
    if (phase !== 'READY' || client === null || operationPending.current) return;
    operationPending.current = true;
    const controller = new AbortController();
    operationReference.current = controller;
    const generation = ++operationGeneration.current;
    setPendingOperation('refresh');
    setWalletError(null);
    try {
      await readPortfolio(client, controller.signal, generation);
    } finally {
      if (generation === operationGeneration.current) {
        operationPending.current = false;
        operationReference.current = null;
        setPendingOperation(null);
      }
    }
  }

  if (!enabled) {
    return (
      <LocalDemoUnifiedBalanceView
        state={{ status: 'UNAVAILABLE', reason: 'INCOMPLETE_SNAPSHOT' }}
      />
    );
  }

  if (phase === 'CHECKING' || phase === 'SIGNED_OUT') {
    return (
      <div className="portfolio-loading-experience">
        <span id="wallets" className="portfolio-anchor-target" aria-hidden="true" />
        <LocalDemoUnifiedBalanceView state={{ status: 'LOADING' }} />
        <span id="opportunities" className="portfolio-anchor-target" aria-hidden="true" />
      </div>
    );
  }

  if (phase === 'UNAVAILABLE') {
    return (
      <div id="wallets" className="portfolio-experience-unavailable">
        <LocalDemoUnifiedBalanceView state={{ status: 'ERROR' }} />
        <button
          className="portfolio-secondary-action"
          type="button"
          onClick={() => {
            setPhase('CHECKING');
            setPortfolio({ status: 'LOADING' });
            setBootstrapRevision((revision) => revision + 1);
          }}
        >
          Try again
        </button>
        <span id="opportunities" className="portfolio-anchor-target" aria-hidden="true" />
      </div>
    );
  }

  const activeWallets = wallets.entries.filter((entry) => entry.indexingEnabled);
  const opportunitiesAvailable = portfolio.status === 'READY' && allocationClient !== null;
  return (
    <>
      <LocalDemoJumpNavigation />
      <section
        id="wallets"
        className="local-demo-wallet-panel"
        aria-labelledby="local-demo-wallet-title"
        aria-describedby="local-demo-wallet-intro"
      >
        <div className="local-demo-wallet-heading">
          <div>
            <p className="eyebrow">Demo wallets</p>
            <h2 id="local-demo-wallet-title">Connect demo wallets</h2>
          </div>
          <span className="local-demo-proof-badge">No provider egress</span>
        </div>
        <p id="local-demo-wallet-intro" className="portfolio-section-intro">
          Connect one or both demo wallets to explore sample balances and a lending plan. No browser
          wallet or real funds are used.
        </p>
        <details className="portfolio-disclosure">
          <summary>How these synthetic demo wallets work</summary>
          <div className="portfolio-notice local-demo-financial-notice" role="note">
            <span aria-hidden="true">i</span>
            <p>
              These loopback-only wallets are synthetic. The ownership proof is completed by the
              local API and{' '}
              <strong>cannot authorize a loan, transfer, quote, or transaction.</strong> EVM
              balances are observations from the loopback-only LOCAL EVM chain (31337). Solana
              balances and all price and valuation inputs remain deterministic fixtures; none of
              this is public-chain or validator evidence.
            </p>
          </div>
        </details>

        <div className="local-demo-wallet-choices" aria-label="Synthetic wallet choices">
          {(['EVM', 'SOLANA'] as const).map((namespace) => {
            const active = wallets.entries.some(
              (entry) => entry.connectorId === connectorId(namespace) && entry.live,
            );
            return (
              <button
                key={namespace}
                type="button"
                disabled={active || pendingOperation !== null}
                onClick={() => void connect(namespace)}
              >
                <span>{namespace === 'EVM' ? 'EVM test wallet' : 'Solana test wallet'}</span>
                <small>{active ? 'Proof accepted' : 'Connect and prove locally'}</small>
              </button>
            );
          })}
        </div>

        {activeWallets.length === 0 ? (
          <p className="local-demo-wallet-empty">No synthetic wallets are connected yet.</p>
        ) : (
          <ul className="local-demo-wallet-roster" aria-label="Connected synthetic wallets">
            {activeWallets.map((entry) => (
              <li key={entry.connectionId}>
                <div>
                  <strong>{entry.label}</strong>
                  <span>
                    {networkName(entry.selectedAccount.chainId)} -{' '}
                    <code>{entry.selectedAccount.address}</code>
                  </span>
                  <small>Proof accepted - indexing enabled</small>
                </div>
                <button
                  type="button"
                  disabled={pendingOperation !== null}
                  onClick={() => void disconnect(entry.connectionId)}
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}

        {walletError === null ? null : (
          <p className="local-demo-wallet-error" role="alert">
            {walletError}
          </p>
        )}
        <span className="visually-hidden" aria-live="polite">
          {pendingOperation === null ? '' : 'Synthetic wallet operation in progress.'}
        </span>
      </section>

      <div className="portfolio-refresh-row">
        <p>Portfolio values are read from the authenticated same-origin local API.</p>
        <button
          className="portfolio-secondary-action"
          type="button"
          disabled={pendingOperation !== null || activeWallets.length === 0}
          onClick={() => void refresh()}
        >
          {pendingOperation === 'refresh' ? 'Refreshing...' : 'Refresh portfolio'}
        </button>
      </div>
      <LocalDemoUnifiedBalanceView
        state={portfolio}
        readyContent={
          opportunitiesAvailable ? (
            <LocalDemoAllocationPlanner
              key={portfolio.snapshot.snapshotId}
              client={allocationClient}
              portfolioSnapshotId={portfolio.snapshot.snapshotId}
              onUnauthenticated={requireSignIn}
              onPortfolioSnapshotChanged={() => void refresh()}
            />
          ) : null
        }
      />
      {opportunitiesAvailable ? null : (
        <section
          id="opportunities"
          className="portfolio-opportunity-state"
          aria-labelledby="portfolio-opportunity-state-title"
        >
          <p className="eyebrow">Step 3 · Explore opportunities</p>
          <h2 id="portfolio-opportunity-state-title">
            {activeWallets.length === 0
              ? 'Connect a demo wallet to explore opportunities.'
              : 'Loading opportunities for your demo balances.'}
          </h2>
          <p>
            {activeWallets.length === 0
              ? 'An earning preview appears here after a supported demo balance has been loaded.'
              : 'The earning preview will appear after the latest balance snapshot is confirmed.'}
          </p>
        </section>
      )}
    </>
  );
}
