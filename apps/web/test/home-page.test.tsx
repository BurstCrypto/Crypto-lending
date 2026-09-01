import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('HomePage', () => {
  it('presents a session-safe signed-out path and explains the product', async () => {
    render(<HomePage />);

    const hero = screen.getByRole('region', {
      name: 'See how supported balances will be reported—without giving up wallet control.',
    });
    expect(within(hero).getByText(/conservative reporting totals/i)).toBeInTheDocument();
    expect(
      within(hero).getByText(/Live provider-backed balance data is not active yet/iu),
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
      name: 'From secure access to an informed decision.',
    });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(preview).getByRole('heading', { name: 'Verify your wallet' }),
    ).toBeInTheDocument();

    const productExplanation = screen.getByRole('region', {
      name: 'Design every reported total to be easier to understand.',
    });
    expect(
      within(productExplanation).getByRole('heading', { name: 'Unify supported balances' }),
    ).toBeInTheDocument();
    expect(
      within(productExplanation).getByRole('heading', { name: 'Understand each reported total' }),
    ).toBeInTheDocument();
    expect(
      within(productExplanation).getByRole('heading', { name: 'Keep control in your wallet' }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('region', { name: 'Review first. Act only when you are ready.' }),
    ).toHaveTextContent('When enabled, connecting a wallet proves ownership only');
    expect(screen.queryByRole('link', { name: 'Open the portfolio workspace' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Portfolio' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Health endpoint' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Version endpoint' })).toBeNull();
  });
});
