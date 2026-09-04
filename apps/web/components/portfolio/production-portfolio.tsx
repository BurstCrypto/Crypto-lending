'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';

import { replaceBrowserLocation } from '@/components/authentication/browser-navigation';
import { MainnetWalletOwnership } from '@/components/wallets/mainnet-wallet-ownership';
import {
  AuthenticationUnauthenticatedError,
  restoreAuthenticationSession,
  type AccountProfile,
} from '@/lib/authentication';
import { isAbortFailure } from '@/lib/authentication/http';
import { useSensitiveViewRevalidation } from '@/lib/browser/use-sensitive-view-revalidation';
import {
  isPortfolioUnauthenticated,
  PortfolioApiClient,
  PortfolioApiError,
} from '@/lib/portfolio/portfolio-client';
import type { ReportingPortfolioSnapshot } from '@/lib/portfolio/reporting-portfolio';

import {
  ProductionPortfolioView,
  type ProductionPortfolioViewState,
} from './production-portfolio-view';

const PORTFOLIO_LOGIN_PATH = '/login?returnTo=%2Fportfolio';

interface PortfolioReader {
  readPortfolio(signal?: AbortSignal): Promise<ReportingPortfolioSnapshot>;
}

export interface WalletOwnershipCallbacks {
  readonly onAuthenticationRequired: () => void;
  readonly onWalletsChanged: () => void;
}

interface ProductionPortfolioDependencies {
  readonly createClient: () => PortfolioReader;
  readonly navigate: (path: string) => void;
  readonly restoreSession: (options: { readonly signal?: AbortSignal }) => Promise<AccountProfile>;
}

export interface ProductionPortfolioProps {
  /** Deterministic injection boundary for focused browser tests. */
  readonly dependencies?: Partial<ProductionPortfolioDependencies>;
  readonly walletOwnershipComponent?: ComponentType<WalletOwnershipCallbacks>;
}

const DEFAULT_DEPENDENCIES: ProductionPortfolioDependencies = Object.freeze({
  createClient: () => new PortfolioApiClient(),
  navigate: replaceBrowserLocation,
  restoreSession: restoreAuthenticationSession,
});

function DefaultWalletOwnership({
  onAuthenticationRequired,
  onWalletsChanged,
}: WalletOwnershipCallbacks) {
  return (
    <MainnetWalletOwnership
      id="wallets"
      onAuthenticationRequired={onAuthenticationRequired}
      onWalletsChanged={onWalletsChanged}
    />
  );
}

function dependenciesFor(
  overrides: Partial<ProductionPortfolioDependencies> | undefined,
): ProductionPortfolioDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function PortfolioJumpNavigation() {
  return (
    <nav
      className="portfolio-jump-navigation portfolio-jump-nav"
      aria-label="Jump to portfolio sections"
    >
      <a className="portfolio-jump-link navigation-button" href="#wallets">
        Wallet
      </a>
      <a className="portfolio-jump-link navigation-button" href="#balances">
        Balances
      </a>
    </nav>
  );
}

export function ProductionPortfolio({
  dependencies,
  walletOwnershipComponent: WalletOwnership = DefaultWalletOwnership,
}: ProductionPortfolioProps) {
  const configured = useMemo(() => dependenciesFor(dependencies), [dependencies]);
  const [phase, setPhase] = useState<'CHECKING_SESSION' | 'AUTHENTICATED' | 'SIGNED_OUT'>(
    'CHECKING_SESSION',
  );
  const [portfolio, setPortfolio] = useState<ProductionPortfolioViewState>({ status: 'LOADING' });
  const [revision, setRevision] = useState(0);
  const requestReference = useRef<AbortController | null>(null);
  const requestGenerationReference = useRef(0);

  const invalidateSensitiveView = useCallback((): void => {
    requestGenerationReference.current += 1;
    requestReference.current?.abort();
    setPortfolio({ status: 'LOADING' });
  }, []);

  const revalidateSensitiveView = useCallback((): void => {
    setRevision((current) => current + 1);
  }, []);

  useSensitiveViewRevalidation({
    enabled: phase !== 'SIGNED_OUT',
    invalidate: invalidateSensitiveView,
    revalidate: revalidateSensitiveView,
  });

  useEffect(() => {
    const controller = new AbortController();
    const generation = requestGenerationReference.current;
    requestReference.current?.abort();
    requestReference.current = controller;

    const isCurrentRequest = (): boolean =>
      !controller.signal.aborted && requestGenerationReference.current === generation;

    async function load(): Promise<void> {
      try {
        await configured.restoreSession({ signal: controller.signal });
        if (!isCurrentRequest()) return;
        setPhase('AUTHENTICATED');
        const snapshot = await configured.createClient().readPortfolio(controller.signal);
        if (!isCurrentRequest()) return;
        setPortfolio({ status: 'READY', snapshot });
      } catch (error) {
        if (!isCurrentRequest() || isAbortFailure(error, controller.signal)) return;
        if (
          error instanceof AuthenticationUnauthenticatedError ||
          isPortfolioUnauthenticated(error)
        ) {
          setPortfolio({ status: 'LOADING' });
          setPhase('SIGNED_OUT');
          return;
        }
        setPortfolio(
          error instanceof PortfolioApiError && error.code === 'UNAVAILABLE'
            ? { status: 'UNAVAILABLE' }
            : { status: 'ERROR' },
        );
      }
    }

    void load();
    return () => {
      controller.abort();
      if (requestReference.current === controller) requestReference.current = null;
    };
  }, [configured, revision]);

  useEffect(() => {
    if (phase === 'SIGNED_OUT') configured.navigate(PORTFOLIO_LOGIN_PATH);
  }, [configured, phase]);

  function retry(): void {
    invalidateSensitiveView();
    setPhase('CHECKING_SESSION');
    revalidateSensitiveView();
  }

  const clearExpiredSession = useCallback((): void => {
    requestGenerationReference.current += 1;
    requestReference.current?.abort();
    setPortfolio({ status: 'LOADING' });
    setPhase('SIGNED_OUT');
  }, []);

  const refreshAfterWalletChange = useCallback((): void => {
    requestGenerationReference.current += 1;
    requestReference.current?.abort();
    setPortfolio({ status: 'LOADING' });
    setRevision((current) => current + 1);
  }, []);

  if (phase === 'SIGNED_OUT' || (phase === 'CHECKING_SESSION' && portfolio.status === 'LOADING')) {
    return <ProductionPortfolioView state={portfolio} />;
  }

  if (phase === 'CHECKING_SESSION') {
    return (
      <div className="portfolio-experience-unavailable">
        <ProductionPortfolioView state={portfolio} />
        <button className="portfolio-secondary-action" type="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <PortfolioJumpNavigation />
      <WalletOwnership
        onAuthenticationRequired={clearExpiredSession}
        onWalletsChanged={refreshAfterWalletChange}
      />
      {portfolio.status === 'READY' || portfolio.status === 'LOADING' ? (
        <ProductionPortfolioView state={portfolio} />
      ) : (
        <div className="portfolio-experience-unavailable">
          <ProductionPortfolioView state={portfolio} />
          <button className="portfolio-secondary-action" type="button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}
