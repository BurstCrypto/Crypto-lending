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
  it('presents a simple navigation path and operational status', async () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Crypto lending, made clear.',
      }),
    ).toBeInTheDocument();

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

    expect(screen.getByRole('link', { name: /Open portfolio/ })).toHaveAttribute(
      'href',
      '/portfolio',
    );
    expect(screen.getByRole('link', { name: /Review balances/ })).toHaveAttribute(
      'href',
      '/portfolio',
    );
    expect(screen.getByRole('link', { name: /View opportunities/ })).toHaveAttribute(
      'href',
      '/portfolio',
    );

    expect(screen.getByText('Page ready')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Health endpoint' })).toHaveAttribute(
      'href',
      '/api/health',
    );
    expect(screen.getByRole('link', { name: 'Version endpoint' })).toHaveAttribute(
      'href',
      '/api/version',
    );
  });
});
