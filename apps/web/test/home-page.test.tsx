import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from '../app/page';

describe('HomePage', () => {
  it('presents a simple navigation path and operational status', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Crypto lending, made clear.',
      }),
    ).toBeInTheDocument();

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primaryNavigation).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(primaryNavigation).getByRole('link', { name: 'Portfolio' })).toHaveAttribute(
      'href',
      '/portfolio',
    );
    expect(within(primaryNavigation).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/account',
    );

    const accountActions = screen.getByRole('navigation', { name: 'Account actions' });
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
