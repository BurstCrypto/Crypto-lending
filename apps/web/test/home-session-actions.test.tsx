import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticationMocks = vi.hoisted(() => ({
  restore: vi.fn(),
}));

vi.mock('@/lib/authentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authentication')>();
  return {
    ...actual,
    restoreAuthenticationSession: authenticationMocks.restore,
  };
});

import { HomeSessionActions } from '../components/authentication/home-session-actions';
import { AuthenticationUnauthenticatedError } from '../lib/authentication';

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('HomeSessionActions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('fails closed while checking and exposes protected destinations only after verification', async () => {
    const verification = deferred<unknown>();
    authenticationMocks.restore.mockReturnValueOnce(verification.promise);
    render(<HomeSessionActions />);

    expect(document.querySelector('[data-home-session-actions="checking"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.queryByRole('link', { name: 'View portfolio' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();

    await act(async () => {
      verification.resolve({});
      await verification.promise;
    });

    expect(screen.getByRole('link', { name: 'View portfolio' })).toHaveAttribute(
      'href',
      '/portfolio',
    );
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it.each([
    ['signed out', new AuthenticationUnauthenticatedError()],
    ['session unavailable', new Error('private session-provider detail')],
  ])('shows only fixed public entry actions when %s', async (_scenario, failure) => {
    authenticationMocks.restore.mockRejectedValueOnce(failure);
    render(<HomeSessionActions />);

    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fportfolio',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?returnTo=%2Fportfolio',
    );
    expect(screen.queryByRole('link', { name: 'View portfolio' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    expect(document.body).not.toHaveTextContent('private session-provider detail');
  });

  it('hides authenticated actions while a persisted page revalidates', async () => {
    const revalidation = deferred<unknown>();
    authenticationMocks.restore.mockResolvedValueOnce({}).mockReturnValueOnce(revalidation.promise);
    render(<HomeSessionActions />);
    expect(await screen.findByRole('link', { name: 'View portfolio' })).toBeInTheDocument();

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    act(() => window.dispatchEvent(pageShow));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'View portfolio' })).toBeNull());
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    expect(document.querySelector('[data-home-session-actions="checking"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(authenticationMocks.restore).toHaveBeenCalledTimes(2);

    await act(async () => {
      revalidation.reject(new AuthenticationUnauthenticatedError());
      await revalidation.promise.catch(() => undefined);
    });
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('ignores an initial check that settles after persisted-page revalidation starts', async () => {
    const initial = deferred<unknown>();
    const revalidation = deferred<unknown>();
    authenticationMocks.restore
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(revalidation.promise);
    render(<HomeSessionActions />);
    const initialSignal = authenticationMocks.restore.mock.calls[0]?.[0]?.signal as AbortSignal;

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    act(() => window.dispatchEvent(pageShow));

    await waitFor(() => expect(authenticationMocks.restore).toHaveBeenCalledTimes(2));
    expect(initialSignal.aborted).toBe(true);

    await act(async () => {
      initial.resolve({});
      await initial.promise;
    });
    expect(screen.queryByRole('link', { name: 'View portfolio' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();

    await act(async () => {
      revalidation.reject(new AuthenticationUnauthenticatedError());
      await revalidation.promise.catch(() => undefined);
    });
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('aborts session verification when unmounted', () => {
    const verification = deferred<unknown>();
    authenticationMocks.restore.mockReturnValueOnce(verification.promise);
    const rendered = render(<HomeSessionActions />);
    const signal = authenticationMocks.restore.mock.calls[0]?.[0]?.signal as AbortSignal;

    rendered.unmount();

    expect(signal.aborted).toBe(true);
    verification.resolve({});
  });

  it('server-renders only fixed public entry links for browsers without JavaScript', () => {
    const markup = renderToStaticMarkup(<HomeSessionActions />);

    expect(markup).toContain('<noscript>');
    expect(markup).toContain('href="/login?returnTo=%2Fportfolio"');
    expect(markup).toContain('href="/register?returnTo=%2Fportfolio"');
    expect(markup).not.toContain('href="/portfolio"');
    expect(markup).not.toContain('href="/account"');
    expect(markup).not.toContain('aria-busy');
  });
});
