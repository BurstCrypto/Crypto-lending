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

import { SiteHeader } from '@/components/site-header';
import {
  AuthenticationUnauthenticatedError,
  AuthenticationUnavailableError,
} from '@/lib/authentication';
import { SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS } from '@/lib/browser/use-sensitive-view-revalidation';

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('SiteHeader', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('does not request session-derived navigation when the header mounts hidden', async () => {
    authenticationMocks.restore.mockResolvedValueOnce({});
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    vi.useFakeTimers();

    render(<SiteHeader activePage="home" />);

    expect(authenticationMocks.restore).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('pageshow'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
    });
    expect(authenticationMocks.restore).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });

    expect(authenticationMocks.restore).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Portfolio' })).toBeVisible();
  });

  it('shows only guest actions after verification confirms there is no session', async () => {
    const verification = deferred<unknown>();
    authenticationMocks.restore.mockReturnValueOnce(verification.promise);
    render(<SiteHeader activePage="home" />);

    expect(screen.queryByRole('navigation')).toBeNull();

    await act(async () => {
      verification.reject(new AuthenticationUnauthenticatedError());
      await verification.promise.catch(() => undefined);
    });

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('shows protected destinations only after session verification succeeds', async () => {
    const verification = deferred<unknown>();
    authenticationMocks.restore.mockReturnValueOnce(verification.promise);
    render(<SiteHeader activePage="home" />);

    expect(screen.queryByRole('navigation')).toBeNull();

    await act(async () => {
      verification.resolve({});
      await verification.promise;
    });

    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/portfolio');
    expect(screen.getByRole('link', { name: 'Platforms' })).toHaveAttribute('href', '/platforms');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('navigation', { name: 'Account actions' })).toBeNull();
  });

  it('keeps protected-shell navigation neutral when verification is unavailable', async () => {
    authenticationMocks.restore.mockRejectedValueOnce(new AuthenticationUnavailableError());
    render(<SiteHeader activePage="portfolio" authenticationActions="sign-in" />);

    await waitFor(() =>
      expect(screen.getByRole('banner')).toHaveAttribute('data-session-navigation', 'unavailable'),
    );
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('keeps authentication entry points available on a public page during an outage', async () => {
    authenticationMocks.restore.mockRejectedValueOnce(new AuthenticationUnavailableError());
    render(<SiteHeader activePage="home" />);

    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('aborts session verification when the header unmounts', () => {
    const pending = deferred<unknown>();
    authenticationMocks.restore.mockReturnValueOnce(pending.promise);
    const rendered = render(<SiteHeader activePage="home" />);
    const signal = authenticationMocks.restore.mock.calls[0]?.[0]?.signal as AbortSignal;

    rendered.unmount();

    expect(signal.aborted).toBe(true);
    pending.resolve({});
  });

  it('shows a sign-in recovery action when a protected shell has a stale session', async () => {
    const verification = deferred<unknown>();
    authenticationMocks.restore.mockReturnValueOnce(verification.promise);
    render(
      <SiteHeader
        activePage="portfolio"
        authenticationActions="sign-in"
        signInHref="/login?returnTo=%2Fportfolio"
      />,
    );

    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByRole('link', { name: 'Bonsai Lending home' })).toBeInTheDocument();

    await act(async () => {
      verification.reject(new AuthenticationUnauthenticatedError());
      await verification.promise.catch(() => undefined);
    });

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fportfolio',
    );
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('hides protected destinations while a focused, reconnected page revalidates', async () => {
    const revalidation = deferred<unknown>();
    authenticationMocks.restore.mockResolvedValueOnce({}).mockReturnValueOnce(revalidation.promise);
    render(<SiteHeader activePage="home" />);
    expect(await screen.findByRole('link', { name: 'Portfolio' })).toBeInTheDocument();
    vi.useFakeTimers();

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByRole('link', { name: 'Portfolio' })).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(authenticationMocks.restore).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });
    expect(authenticationMocks.restore).toHaveBeenCalledTimes(2);

    await act(async () => {
      revalidation.resolve({});
      await revalidation.promise;
    });

    expect(screen.getByRole('link', { name: 'Portfolio' })).toBeInTheDocument();
  });

  it('ignores a superseded session check that settles after bfcache revalidation starts', async () => {
    const initial = deferred<unknown>();
    const revalidation = deferred<unknown>();
    authenticationMocks.restore
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(revalidation.promise);
    render(<SiteHeader activePage="home" />);
    const initialSignal = authenticationMocks.restore.mock.calls[0]?.[0]?.signal as AbortSignal;
    vi.useFakeTimers();

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    act(() => window.dispatchEvent(pageShow));

    expect(initialSignal.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });
    expect(authenticationMocks.restore).toHaveBeenCalledTimes(2);

    await act(async () => {
      initial.resolve({});
      await initial.promise;
    });
    expect(screen.queryByRole('navigation')).toBeNull();

    await act(async () => {
      revalidation.reject(new AuthenticationUnauthenticatedError());
      await revalidation.promise.catch(() => undefined);
    });
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('server-renders safe authentication actions for browsers without JavaScript', () => {
    authenticationMocks.restore.mockReturnValueOnce(new Promise(() => undefined));

    const markup = renderToStaticMarkup(<SiteHeader activePage="home" />);

    expect(markup).toContain('<noscript>');
    expect(markup).toContain('href="/login"');
    expect(markup).toContain('href="/register"');
    expect(markup).not.toContain('href="/portfolio"');
    expect(markup).not.toContain('href="/platforms"');
  });
});
