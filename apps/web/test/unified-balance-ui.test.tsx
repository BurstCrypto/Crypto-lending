import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PortfolioPage, { metadata } from '@/app/portfolio/page';
import {
  UnifiedBalanceView,
  type UnifiedBalanceViewState,
} from '@/components/portfolio/unified-balance-view';
import {
  UNAVAILABLE_BUYING_POWER_DEMO_PAYLOAD,
  UNIFIED_BALANCE_DEMO_PAYLOAD,
} from '@/lib/portfolio/unified-balance.fixtures';
import { parseUnifiedBalanceResponse } from '@/lib/portfolio/unified-balance';

const READY_STATE = Object.freeze({
  status: 'READY',
  snapshot: parseUnifiedBalanceResponse(UNIFIED_BALANCE_DEMO_PAYLOAD),
} as const satisfies UnifiedBalanceViewState);

function grossLocalDemoPayload(): unknown {
  return {
    ...UNIFIED_BALANCE_DEMO_PAYLOAD,
    freshness: 'CURRENT',
    buyingPower: {
      status: 'AVAILABLE',
      amountUsdMinor: UNIFIED_BALANCE_DEMO_PAYLOAD.portfolioValueUsdMinor,
      freshness: 'CURRENT',
      deductions: [],
      reasons: [],
    },
    wallets: UNIFIED_BALANCE_DEMO_PAYLOAD.wallets.map((wallet) => ({
      ...wallet,
      buyingPowerUsdMinor: wallet.portfolioValueUsdMinor,
      chains: wallet.chains.map((chain) => ({
        ...chain,
        buyingPowerUsdMinor: chain.portfolioValueUsdMinor,
        assets: chain.assets.map((asset) => ({
          ...asset,
          buyingPowerUsdMinor: asset.portfolioValueUsdMinor,
          buyingPowerAvailability: 'INCLUDED',
          buyingPowerReason: null,
          freshness: 'CURRENT',
        })),
      })),
    })),
    use: 'LOCAL_DEMO_ESTIMATE_ONLY',
    mayAuthorizeFinancialAction: false,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('UnifiedBalanceView', () => {
  it('distinguishes the reconciled portfolio total from available buying power', () => {
    render(<UnifiedBalanceView state={READY_STATE} />);

    const balances = screen
      .getByRole('heading', { level: 2, name: 'Your capital, clearly attributed.' })
      .closest('section');
    const portfolioCard = screen.getByText('Total portfolio value').closest('article');
    const buyingPowerCard = screen.getByText('Available buying power').closest('article');
    expect(balances).toHaveAttribute('id', 'balances');
    expect(portfolioCard).not.toBeNull();
    expect(buyingPowerCard).not.toBeNull();
    expect(within(portfolioCard!).getByLabelText('11,000 US dollars')).toHaveTextContent(
      '$11,000.00',
    );
    expect(within(buyingPowerCard!).getByLabelText('7,500 US dollars')).toHaveTextContent(
      '$7,500.00',
    );
    expect(screen.getByText('Why buying power is lower')).toBeInTheDocument();
    expect(screen.getByLabelText('2,000 US dollars deduction')).toHaveTextContent('-$2,000.00');
  });

  it('shows as-of and stale semantics without relying on color alone', () => {
    render(<UnifiedBalanceView state={READY_STATE} />);

    expect(screen.getAllByLabelText('Stale data')).not.toHaveLength(0);
    expect(screen.getByText('Some balance data is stale.')).toBeInTheDocument();
    expect(
      screen.getByText(/Stale holdings remain visible in portfolio value but do not increase/),
    ).toBeInTheDocument();
    expect(screen.getByText('Aug 24, 2026, 6:30 PM UTC')).toHaveAttribute(
      'datetime',
      '2026-08-24T18:30:00.000Z',
    );
    expect(screen.getByText('Buying-power notes')).toBeInTheDocument();
  });

  it('shows full idle local-demo capital and defers cost treatment until allocation preview', () => {
    const snapshot = parseUnifiedBalanceResponse(grossLocalDemoPayload());
    render(<UnifiedBalanceView state={{ status: 'READY', snapshot }} />);

    const buyingPowerCard = screen.getByText('Available buying power').closest('article');
    expect(within(buyingPowerCard!).getByLabelText('11,000 US dollars')).toHaveTextContent(
      '$11,000.00',
    );
    expect(
      within(buyingPowerCard!).getByText(/Full supported capital available before any allocation/u),
    ).toBeInTheDocument();
    expect(screen.queryByText('Why buying power is lower')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated slippage')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated network costs')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated conversion costs')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated market impact')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated routing fee')).not.toBeInTheDocument();
    expect(screen.queryByText('Total estimated fees')).not.toBeInTheDocument();
    expect(screen.queryByText('First positive day after estimated fees')).not.toBeInTheDocument();
    expect(screen.queryByText(/Actual local operation/u)).not.toBeInTheDocument();
  });

  it('expands wallet and chain attribution while keeping addresses masked', () => {
    const rendered = render(<UnifiedBalanceView state={READY_STATE} />);
    const walletSummary = screen.getByText('Primary EVM wallet').closest('summary');
    const walletDetails = walletSummary?.closest('details');
    expect(walletSummary).not.toBeNull();
    expect(walletDetails).not.toBeNull();
    expect(walletDetails).not.toHaveAttribute('open');

    (walletSummary as HTMLElement).focus();
    expect(walletSummary).toHaveFocus();
    fireEvent.click(walletSummary!);
    expect(walletDetails).toHaveAttribute('open');
    const ethereumSummary = within(walletDetails!).getByText('Ethereum').closest('summary');
    const ethereumDetails = ethereumSummary?.closest('details');
    fireEvent.click(ethereumSummary!);
    expect(ethereumDetails).toHaveAttribute('open');
    expect(within(ethereumDetails!).getByText('5,000 USDC')).toBeInTheDocument();
    expect(within(ethereumDetails!).getByText('USDC')).toBeInTheDocument();

    expect(screen.getByText('0x71c7…976f')).toBeInTheDocument();
    expect(screen.getByText('7Ytt…FrA8')).toBeInTheDocument();
    expect(rendered.container.innerHTML).not.toContain(
      '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
    );
    expect(rendered.container.innerHTML).not.toContain(
      '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8',
    );
    expect(rendered.container.innerHTML).not.toContain(
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    );
    expect(rendered.container.innerHTML).not.toContain('5f640a87-9e21-4a95-8ec4-1a68b4a9237c');
    expect(rendered.container.innerHTML).not.toContain('portfolio-demo-2026-08-24T18:30:00Z');
  });

  it('explains unavailable buying power instead of presenting a false zero', () => {
    const snapshot = parseUnifiedBalanceResponse(UNAVAILABLE_BUYING_POWER_DEMO_PAYLOAD);
    render(<UnifiedBalanceView state={{ status: 'READY', snapshot }} />);

    const card = screen.getByText('Available buying power').closest('article');
    expect(within(card!).getByText('Unavailable')).toHaveAttribute('role', 'status');
    expect(within(card!).getByText('Inputs unavailable')).toBeInTheDocument();
    expect(screen.getByText('Why buying power is unavailable')).toBeInTheDocument();
    expect(screen.getAllByText(/will not assume that moving funds is free/)).not.toHaveLength(0);
    expect(within(card!).queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByText('Required cost inputs')).toBeInTheDocument();
    expect(screen.getByText('Cost unavailable')).toBeInTheDocument();
  });

  it.each([
    {
      state: { status: 'LOADING' } as const,
      role: 'status',
      heading: 'Loading your portfolio',
      explanation: 'No missing value will be shown as zero.',
    },
    {
      state: { status: 'ERROR' } as const,
      role: 'alert',
      heading: 'Your portfolio could not be loaded',
      explanation: 'Your last confirmed balances are not replaced with zero',
    },
    {
      state: { status: 'UNAVAILABLE', reason: 'NO_SUPPORTED_BALANCES' } as const,
      role: 'status',
      heading: 'Portfolio value is unavailable',
      explanation: 'No supported, priced stablecoin balances are available',
    },
    {
      state: { status: 'UNAVAILABLE', reason: 'INCOMPLETE_SNAPSHOT' } as const,
      role: 'status',
      heading: 'Portfolio value is unavailable',
      explanation: 'Some wallet or pricing sources are incomplete',
    },
  ])('renders an explicit $state.status state with a safe explanation', (scenario) => {
    render(<UnifiedBalanceView state={scenario.state} />);

    expect(screen.getByRole(scenario.role)).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 2, name: scenario.heading });
    expect(heading.closest('section')).toHaveAttribute('id', 'balances');
    expect(screen.getByText(new RegExp(scenario.explanation, 'u'))).toBeInTheDocument();
  });
});

describe('PortfolioPage', () => {
  it('renders an authenticated dynamic shell without embedding the old fixture', () => {
    render(<PortfolioPage />);

    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crypto Lending home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    const sectionNavigation = screen.getByRole('navigation', {
      name: 'Jump to portfolio sections',
    });
    expect(within(sectionNavigation).getByRole('link', { name: 'Balances' })).toHaveAttribute(
      'href',
      '#balances',
    );
    expect(within(sectionNavigation).queryByRole('link', { name: 'Demo wallets' })).toBeNull();
    expect(within(sectionNavigation).queryByRole('link', { name: 'Opportunities' })).toBeNull();
    expect(document.querySelector('#balances')).not.toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Portfolio value is unavailable' }),
    ).toBeInTheDocument();
    expect(metadata).toMatchObject({
      title: 'Portfolio',
      robots: { index: false, follow: false },
    });
  });

  it('renders every enabled section button with a stable page target', () => {
    vi.stubEnv('LOCAL_DEMO_MODE', 'enabled');
    vi.stubEnv('LOCAL_DEMO_API_ORIGIN', 'http://127.0.0.1:3001');
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', 'http://127.0.0.1:3000');
    render(<PortfolioPage />);

    const sectionNavigation = screen.getByRole('navigation', {
      name: 'Jump to portfolio sections',
    });
    const links = within(sectionNavigation).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Demo wallets',
      'Balances',
      'Opportunities',
    ]);
    for (const link of links) {
      const target = link.getAttribute('href');
      expect(target).toMatch(/^#[a-z-]+$/u);
      expect(document.querySelector(target!)).not.toBeNull();
    }
  });
});
