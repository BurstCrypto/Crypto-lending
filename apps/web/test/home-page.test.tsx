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
  it('presents a simple signed-out path and explains the product', async () => {
    render(<HomePage />);

    const hero = screen.getByRole('region', {
      name: 'Understand your portfolio before you borrow or lend.',
    });
    expect(
      within(hero).getByText(/supported balances, estimated buying power/i),
    ).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'View portfolio' })).toHaveAttribute(
      'href',
      '/portfolio',
    );
    expect(within(hero).getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register',
    );

    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();

    const accountActions = await screen.findByRole('navigation', { name: 'Account actions' });
    expect(within(accountActions).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(within(accountActions).getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register',
    );

    const preview = screen.getByRole('complementary', {
      name: 'From balances to a lending estimate.',
    });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(preview).getByRole('heading', { name: 'Preview an allocation' }),
    ).toBeInTheDocument();

    const productExplanation = screen.getByRole('region', {
      name: 'Make every estimate easier to understand.',
    });
    expect(
      within(productExplanation).getByRole('heading', { name: 'Trace what is included' }),
    ).toBeInTheDocument();
    expect(
      within(productExplanation).getByRole('heading', { name: 'See why buying power changes' }),
    ).toBeInTheDocument();
    expect(
      within(productExplanation).getByRole('heading', { name: 'Explore without real funds' }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('region', { name: 'Review first. Act only when you are ready.' }),
    ).toHaveTextContent('synthetic or locally cached estimates');
    expect(screen.queryByRole('link', { name: 'Health endpoint' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Version endpoint' })).toBeNull();
  });
});
