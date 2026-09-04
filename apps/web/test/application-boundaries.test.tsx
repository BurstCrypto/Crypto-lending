import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ApplicationError from '../app/error';
import ApplicationLoading from '../app/loading';
import NotFound from '../app/not-found';

afterEach(cleanup);

describe('application route boundaries', () => {
  it('offers a focused, explicit recovery action after a route error', () => {
    const reset = vi.fn();

    render(<ApplicationError error={new Error('private failure detail')} reset={reset} />);

    const heading = screen.getByRole('heading', { name: 'We could not load this page.' });
    expect(heading).toHaveFocus();
    expect(screen.queryByText('private failure detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  });

  it('keeps the not-found page to two clear navigation choices', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { name: 'That page is not available.' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fportfolio',
    );
  });

  it('announces pending route content without presenting a false result', () => {
    render(<ApplicationLoading />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading Crypto Lending');
  });
});
