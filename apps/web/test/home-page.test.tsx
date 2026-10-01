import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/authentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authentication')>();
  return {
    ...actual,
    restoreAuthenticationSession: vi
      .fn()
      .mockRejectedValue(new actual.AuthenticationUnauthenticatedError()),
  };
});

import HomePage from '../app/page';
import { restoreAuthenticationSession } from '@/lib/authentication';

describe('HomePage', () => {
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it('uses wallet access and shared navigation locally without making an account request', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOCAL_MAINNET_TEST_MODE', 'enabled');
    vi.stubEnv('LOCAL_MAINNET_TEST_LAUNCH_TOKEN', 'a'.repeat(64));
    render(<HomePage />);
    expect(screen.getByRole('link', { name: 'Connect wallets' })).toHaveAttribute('href', '/portfolio#wallets');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(restoreAuthenticationSession).not.toHaveBeenCalled();
  });
  it('presents a session-safe signed-out path and explains the product', async () => {
    render(<HomePage />);

    const hero = screen.getByRole('region', {
      name: 'Your stablecoins. Smarter lending.',
    });
    expect(within(hero).getByText(/Smart Lending selects where to lend/i)).toBeInTheDocument();
    expect(
      within(hero).getByText(/Your wallet approves every transaction/iu),
    ).toBeInTheDocument();
    expect(await within(hero).findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fportfolio',
    );
    expect(within(hero).getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?returnTo=%2Fportfolio',
    );
    expect(within(hero).queryByRole('link', { name: 'View portfolio' })).toBeNull();
    expect(within(hero).queryByRole('link', { name: 'Account' })).toBeNull();

    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();

    const accountActions = await screen.findByRole('navigation', { name: 'Account actions' });
    expect(within(accountActions).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fportfolio',
    );
    expect(within(accountActions).getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register?returnTo=%2Fportfolio',
    );

    const preview = screen.getByRole('complementary', {
      name: 'From your wallet to a reviewed deposit.',
    });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(preview).getByRole('heading', { name: 'Let Smart Lending choose' }),
    ).toBeInTheDocument();

    const productExplanation = screen.getByRole('region', {
      name: 'Let Smart Lending do the comparison.',
    });
    expect(
      within(productExplanation).getByRole('heading', { name: 'Unify supported balances' }),
    ).toBeInTheDocument();
    expect(
      within(productExplanation).getByRole('heading', { name: 'See returns after costs' }),
    ).toBeInTheDocument();
    expect(
      within(productExplanation).getByRole('heading', { name: 'Keep control in your wallet' }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('region', { name: 'Review first. Act only when you are ready.' }),
    ).toHaveTextContent('Deposit amounts are bounded by your connected wallet balance');
    expect(screen.queryByRole('link', { name: 'Open the portfolio workspace' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Portfolio' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Health endpoint' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Version endpoint' })).toBeNull();
  });
});
