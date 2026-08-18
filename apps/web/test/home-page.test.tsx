import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from '../app/page';

describe('HomePage', () => {
  it('presents the application status and operational endpoints', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Built for a clearer way to borrow and lend.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
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
