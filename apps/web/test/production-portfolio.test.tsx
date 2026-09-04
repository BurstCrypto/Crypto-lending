import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProductionPortfolio,
  type WalletOwnershipCallbacks,
} from '../components/portfolio/production-portfolio';
import { AuthenticationUnauthenticatedError, type AccountProfile } from '../lib/authentication';
import { SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS } from '../lib/browser/use-sensitive-view-revalidation';
import { PortfolioApiError } from '../lib/portfolio/portfolio-client';
import type { ReportingPortfolioSnapshot } from '../lib/portfolio/reporting-portfolio';
import { REPORTING_PORTFOLIO_SNAPSHOT } from './fixtures/reporting-portfolio';

const PROFILE: AccountProfile = Object.freeze({
  accountId: '0f27af0b-48b2-4f1b-b3d4-cd531a0b4458',
  contactEmail: 'portfolio@example.com',
  contactPhone: null,
  declaredResidencyCountryCode: 'US',
  eligibilityStatus: 'UNKNOWN',
  version: 1,
  createdAt: '2026-08-20T16:00:00.000Z',
  updatedAt: '2026-08-20T16:01:00.000Z',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function dependencies(input: {
  navigate?: (path: string) => void;
  readPortfolio: (signal?: AbortSignal) => Promise<ReportingPortfolioSnapshot>;
  restoreSession: (options: { readonly signal?: AbortSignal }) => Promise<AccountProfile>;
}) {
  return {
    createClient: () => ({ readPortfolio: input.readPortfolio }),
    navigate: input.navigate ?? vi.fn(),
    restoreSession: input.restoreSession,
  };
}

function ExpiredSessionWallet({ onAuthenticationRequired }: WalletOwnershipCallbacks) {
  return (
    <button type="button" onClick={onAuthenticationRequired}>
      Simulate expired session
    </button>
  );
}

function ChangedWalletRoster({ onWalletsChanged }: WalletOwnershipCallbacks) {
  return (
    <button type="button" onClick={onWalletsChanged}>
      Simulate wallet roster change
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('authenticated production portfolio', () => {
  it('keeps portfolio data hidden until the managed session is verified', async () => {
    const pendingSession = deferred<AccountProfile>();
    const pendingPortfolio = deferred<ReportingPortfolioSnapshot>();
    const readPortfolio = vi.fn(async (signal?: AbortSignal) => {
      void signal;
      return pendingPortfolio.promise;
    });
    const restoreSession = vi.fn(() => pendingSession.promise);
    render(<ProductionPortfolio dependencies={dependencies({ readPortfolio, restoreSession })} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Loading your portfolio' })).toBeVisible();
    expect(screen.queryByText('Supported reporting total')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Add a wallet' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Jump to portfolio sections' }),
    ).not.toBeInTheDocument();
    expect(readPortfolio).not.toHaveBeenCalled();

    pendingSession.resolve(PROFILE);
    expect(await screen.findByRole('region', { name: 'Add a wallet' })).toHaveAttribute(
      'id',
      'wallets',
    );
    const jumpNavigation = screen.getByRole('navigation', {
      name: 'Jump to portfolio sections',
    });
    expect(within(jumpNavigation).getByRole('link', { name: 'Wallet' })).toHaveAttribute(
      'href',
      '#wallets',
    );
    expect(within(jumpNavigation).getByRole('link', { name: 'Balances' })).toHaveAttribute(
      'href',
      '#balances',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Loading your portfolio' })).toBeVisible();
    pendingPortfolio.resolve(REPORTING_PORTFOLIO_SNAPSHOT);
    const portfolioCard = (await screen.findByText('Supported reporting total')).closest('article');
    expect(within(portfolioCard!).getByLabelText('11,000 US dollars')).toHaveTextContent(
      '$11,000.00',
    );
    expect(screen.getByText('Reporting only.')).toBeVisible();
    expect(screen.getByText('Registered wallet coverage')).toBeVisible();
    expect(
      screen.getByText('All 2 registered wallet networks have complete balance coverage.'),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole('heading', { level: 3, name: 'Networks' }).closest('article')!,
      ).getByText('Ethereum'),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(document.body).not.toHaveTextContent('private-reference');
    expect(document.body).not.toHaveTextContent('Available buying power');
    expect(readPortfolio).toHaveBeenCalledTimes(1);
    expect(readPortfolio.mock.calls[0]?.[0]).toEqual(expect.any(AbortSignal));
  });

  it('shows incomplete registered-wallet coverage as unavailable instead of zero', async () => {
    const partialSnapshot: ReportingPortfolioSnapshot = {
      ...REPORTING_PORTFOLIO_SNAPSHOT,
      balanceCoverage: {
        status: 'PARTIAL',
        targetCount: 3,
        completeTargetCount: 2,
        partialTargetCount: 0,
        unavailableTargetCount: 1,
      },
      overallTotal: {
        ...REPORTING_PORTFOLIO_SNAPSHOT.overallTotal,
        freshnessClass: 'UNAVAILABLE',
        completeness: 'PARTIAL',
      },
      chainTotals: [
        ...REPORTING_PORTFOLIO_SNAPSHOT.chainTotals,
        {
          networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          usdValue: null,
          freshnessClass: 'UNAVAILABLE',
          completeness: 'UNAVAILABLE',
          sourceCount: 0,
          includedSourceCount: 0,
        },
      ],
    };
    render(
      <ProductionPortfolio
        dependencies={dependencies({
          readPortfolio: vi.fn(async () => partialSnapshot),
          restoreSession: vi.fn(async () => PROFILE),
        })}
      />,
    );

    expect(await screen.findByText('Registered wallet coverage')).toBeVisible();
    expect(
      screen.getByText(
        '1 of 3 registered wallet networks are incomplete or unavailable. Missing balances are shown as unavailable, never $0.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Known reported subtotal')).toBeVisible();
    expect(screen.queryByText('Supported reporting total')).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole('heading', { level: 3, name: 'Networks' }).closest('article')!,
      ).getByText('Solana'),
    ).toBeVisible();
  });

  it('replace-redirects a failed session check to the fixed safe portfolio login path', async () => {
    const navigate = vi.fn();
    const readPortfolio = vi.fn();
    const restoreSession = vi.fn(async () => {
      throw new AuthenticationUnauthenticatedError();
    });
    render(
      <ProductionPortfolio
        dependencies={dependencies({ navigate, readPortfolio, restoreSession })}
      />,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?returnTo=%2Fportfolio'));
    expect(readPortfolio).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Add a wallet' })).not.toBeInTheDocument();
    expect(screen.queryByText('Supported reporting total')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Loading your portfolio' })).toBeVisible();
  });

  it('also redirects safely when the portfolio request observes a session race', async () => {
    const navigate = vi.fn();
    const readPortfolio = vi.fn(async () => {
      throw new PortfolioApiError('UNAUTHENTICATED');
    });
    const restoreSession = vi.fn(async () => PROFILE);
    render(
      <ProductionPortfolio
        dependencies={dependencies({ navigate, readPortfolio, restoreSession })}
      />,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?returnTo=%2Fportfolio'));
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText('Supported reporting total')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Add a wallet' })).not.toBeInTheDocument();
  });

  it('clears private portfolio data and redirects when wallet challenge issuance proves auth loss', async () => {
    const navigate = vi.fn();
    const restoreSession = vi.fn(async () => PROFILE);
    const readPortfolio = vi.fn(async () => REPORTING_PORTFOLIO_SNAPSHOT);
    render(
      <ProductionPortfolio
        dependencies={dependencies({
          navigate,
          readPortfolio,
          restoreSession,
        })}
        walletOwnershipComponent={ExpiredSessionWallet}
      />,
    );

    expect(await screen.findByText('Supported reporting total')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate expired session' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?returnTo=%2Fportfolio'));
    expect(screen.queryByText('Supported reporting total')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simulate expired session' })).toBeNull();
  });

  it('hides the old snapshot and refetches after the wallet roster changes', async () => {
    const refreshed = deferred<ReportingPortfolioSnapshot>();
    const restoreSession = vi.fn(async () => PROFILE);
    const readPortfolio = vi
      .fn()
      .mockResolvedValueOnce(REPORTING_PORTFOLIO_SNAPSHOT)
      .mockReturnValueOnce(refreshed.promise);
    render(
      <ProductionPortfolio
        dependencies={dependencies({
          readPortfolio,
          restoreSession,
        })}
        walletOwnershipComponent={ChangedWalletRoster}
      />,
    );

    expect(await screen.findByText('Supported reporting total')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate wallet roster change' }));

    await waitFor(() => expect(screen.queryByText('Supported reporting total')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Loading your portfolio' })).toBeVisible();
    expect(readPortfolio).toHaveBeenCalledTimes(2);
    refreshed.resolve(REPORTING_PORTFOLIO_SNAPSHOT);
    expect(await screen.findByText('Supported reporting total')).toBeVisible();
  });

  it('renders a retryable unavailable state for 503-class failures', async () => {
    const readPortfolio = vi
      .fn()
      .mockRejectedValueOnce(new PortfolioApiError('UNAVAILABLE', 1))
      .mockResolvedValueOnce(REPORTING_PORTFOLIO_SNAPSHOT);
    const restoreSession = vi.fn(async () => PROFILE);
    render(<ProductionPortfolio dependencies={dependencies({ readPortfolio, restoreSession })} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Portfolio reporting is unavailable' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Add a wallet' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Loading your portfolio' })).toBeVisible();
    expect(await screen.findByText('Supported reporting total')).toBeVisible();
    expect(restoreSession).toHaveBeenCalledTimes(2);
    expect(readPortfolio).toHaveBeenCalledTimes(2);
  });

  it('renders invalid data as a retryable error without exposing response details', async () => {
    const readPortfolio = vi
      .fn()
      .mockRejectedValueOnce(new PortfolioApiError('INVALID_RESPONSE'))
      .mockResolvedValueOnce(REPORTING_PORTFOLIO_SNAPSHOT);
    const restoreSession = vi.fn(async () => PROFILE);
    render(<ProductionPortfolio dependencies={dependencies({ readPortfolio, restoreSession })} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your portfolio could not be loaded');
    expect(screen.getByRole('region', { name: 'Add a wallet' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Supported reporting total')).toBeVisible();
  });

  it('hides stale data, coalesces a lifecycle burst, and suppresses a superseded read', async () => {
    const superseded = deferred<ReportingPortfolioSnapshot>();
    const current = deferred<ReportingPortfolioSnapshot>();
    const signals: AbortSignal[] = [];
    const readPortfolio = vi.fn((signal?: AbortSignal) => {
      if (signal !== undefined) signals.push(signal);
      if (signals.length === 1) return Promise.resolve(REPORTING_PORTFOLIO_SNAPSHOT);
      if (signals.length === 2) return superseded.promise;
      return current.promise;
    });
    const restoreSession = vi.fn(async () => PROFILE);
    render(
      <ProductionPortfolio
        dependencies={dependencies({ readPortfolio, restoreSession })}
        walletOwnershipComponent={ChangedWalletRoster}
      />,
    );
    expect(await screen.findByText('Supported reporting total')).toBeVisible();
    vi.useFakeTimers();

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(pageShow);
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(readPortfolio).toHaveBeenCalledOnce();
    expect(screen.queryByText('Supported reporting total')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Loading your portfolio' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Simulate wallet roster change' })).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });
    expect(readPortfolio).toHaveBeenCalledTimes(2);
    expect(restoreSession).toHaveBeenCalledTimes(2);

    act(() => window.dispatchEvent(new Event('online')));
    expect(signals[1]?.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });
    expect(readPortfolio).toHaveBeenCalledTimes(3);

    await act(async () => {
      superseded.resolve(REPORTING_PORTFOLIO_SNAPSHOT);
      await Promise.resolve();
    });
    expect(screen.queryByText('Supported reporting total')).not.toBeInTheDocument();

    await act(async () => {
      current.resolve(REPORTING_PORTFOLIO_SNAPSHOT);
      await Promise.resolve();
    });
    expect(screen.getByText('Supported reporting total')).toBeVisible();
  });
});
