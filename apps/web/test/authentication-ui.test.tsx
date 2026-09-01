import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticationMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  restore: vi.fn(),
  startLogin: vi.fn(),
  startRegistration: vi.fn(),
}));

const navigationMocks = vi.hoisted(() => ({
  assign: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/lib/authentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authentication')>();
  return {
    ...actual,
    logoutAuthenticationSession: authenticationMocks.logout,
    restoreAuthenticationSession: authenticationMocks.restore,
    startAuthenticationLogin: authenticationMocks.startLogin,
    startAuthenticationRegistration: authenticationMocks.startRegistration,
  };
});

vi.mock('@/components/authentication/browser-navigation', () => ({
  assignBrowserLocation: navigationMocks.assign,
  replaceBrowserLocation: navigationMocks.replace,
}));

import AccountPage from '../app/account/page';
import LoginPage from '../app/login/page';
import RegisterPage from '../app/register/page';
import { AccountSession } from '../components/authentication/account-session';
import { LoginForm } from '../components/authentication/login-form';
import { RegistrationForm } from '../components/authentication/registration-form';
import { AuthenticationUnauthenticatedError, type AccountProfile } from '../lib/authentication';
import { localDemoWalletRosterKey } from '../lib/local-demo/wallet-roster';
import { PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY } from '../lib/public-testnet/public-testnet-position-account';

const PROFILE: AccountProfile = Object.freeze({
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  contactEmail: 'person@example.com',
  contactPhone: null,
  declaredResidencyCountryCode: 'US',
  eligibilityStatus: 'UNKNOWN' as const,
  version: 1,
  createdAt: '2026-08-22T18:00:00.000Z',
  updatedAt: '2026-08-22T18:00:00.000Z',
});

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('authentication UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticationMocks.startLogin.mockResolvedValue('https://identity.example/authorize');
    authenticationMocks.startRegistration.mockResolvedValue(
      'https://identity.example/authorize?flow=registration',
    );
    authenticationMocks.restore.mockResolvedValue(PROFILE);
    authenticationMocks.logout.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it('starts login through the JSON boundary and performs a top-level navigation', async () => {
    render(<LoginForm returnPath="/account?tab=security" />);

    fireEvent.click(screen.getByRole('button', { name: /continue to sign in/i }));

    await waitFor(() =>
      expect(authenticationMocks.startLogin).toHaveBeenCalledWith(
        '/account?tab=security',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(navigationMocks.assign).toHaveBeenCalledWith('https://identity.example/authorize');
  });

  it.each([
    new Error('provider says this email does not exist'),
    new Error('rate limited'),
    new Error('database unavailable'),
  ])(
    'shows the same focused, non-enumerating login error for every start failure',
    async (error) => {
      authenticationMocks.startLogin.mockRejectedValueOnce(error);
      render(<LoginForm returnPath="/account" />);

      fireEvent.click(screen.getByRole('button', { name: /continue to sign in/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveFocus();
      expect(alert).toHaveTextContent('Managed sign-in is unavailable right now');
      expect(alert).toHaveTextContent('No local demo identity or account fallback was used');
      expect(alert).not.toHaveTextContent(error.message);
      expect(navigationMocks.assign).not.toHaveBeenCalled();
    },
  );

  it('submits normalized registration fields and omits a blank optional phone', async () => {
    render(<RegistrationForm returnPath="/account" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'Person@EXAMPLE.COM' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /phone number/i }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country of residence' }), {
      target: { value: 'us' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue securely/i }));

    await waitFor(() =>
      expect(authenticationMocks.startRegistration).toHaveBeenCalledWith(
        {
          contactEmail: 'Person@EXAMPLE.COM',
          declaredResidencyCountryCode: 'US',
          returnPath: '/account',
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(navigationMocks.assign).toHaveBeenCalledWith(
      'https://identity.example/authorize?flow=registration',
    );
  });

  it('exposes accessible registration input and progress semantics', () => {
    render(<RegistrationForm returnPath="/account" />);

    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveAttribute(
      'autocomplete',
      'email',
    );
    expect(screen.getByRole('combobox', { name: 'Country of residence' })).toHaveAttribute(
      'pattern',
      '[A-Za-z]{2}',
    );
    expect(screen.getByRole('textbox', { name: /phone number/i })).toHaveAttribute(
      'autocomplete',
      'tel',
    );
    expect(screen.getByRole('combobox', { name: 'Country of residence' })).toHaveAttribute(
      'autocomplete',
      'country',
    );
    expect(
      screen.getByRole('button', { name: /continue securely/i }).closest('form'),
    ).toHaveAttribute('aria-busy', 'false');
  });

  it('uses privacy-safe same-origin fallback form contracts before hydration', () => {
    const login = render(<LoginForm returnPath="/account?tab=security" />);
    const loginForm = screen.getByRole('button', { name: /continue to sign in/i }).closest('form');
    expect(loginForm).toHaveAttribute('method', 'get');
    expect(loginForm).toHaveAttribute('action', '/api/v1/auth/login');
    expect(loginForm?.elements.namedItem('returnTo')).toHaveValue('/account?tab=security');
    expect(loginForm?.elements.namedItem('contactEmail')).toBeNull();

    login.unmount();
    render(<RegistrationForm returnPath="/account" />);
    const registrationForm = screen
      .getByRole('button', { name: /continue securely/i })
      .closest('form');
    expect(registrationForm).toHaveAttribute('method', 'post');
    expect(registrationForm).toHaveAttribute('action', '/api/v1/auth/registration');
    expect(registrationForm?.elements.namedItem('returnPath')).toHaveValue('/account');
    expect(registrationForm?.elements.namedItem('contactEmail')).not.toBeNull();
    expect(registrationForm?.elements.namedItem('contactPhone')).not.toBeNull();
    expect(registrationForm?.elements.namedItem('declaredResidencyCountryCode')).not.toBeNull();
  });

  it('falls back to the protected account path when a page receives an unsafe return target', async () => {
    authenticationMocks.restore.mockRejectedValue(new AuthenticationUnauthenticatedError());
    render(
      await LoginPage({
        searchParams: Promise.resolve({ returnTo: 'https://evil.example/account' }),
      }),
    );
    expect(await screen.findByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?returnTo=%2Faccount',
    );

    cleanup();
    render(
      await RegisterPage({
        searchParams: Promise.resolve({ returnTo: '//evil.example' }),
      }),
    );
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Faccount',
    );
  });

  it('aborts an unmounted login start and ignores its late successful response', async () => {
    const pending = deferred<string>();
    authenticationMocks.startLogin.mockReturnValueOnce(pending.promise);
    const rendered = render(<LoginForm returnPath="/account" />);

    fireEvent.click(screen.getByRole('button', { name: /continue to sign in/i }));
    const signal = authenticationMocks.startLogin.mock.calls[0]?.[1]?.signal as AbortSignal;
    rendered.unmount();

    expect(signal.aborted).toBe(true);
    pending.resolve('https://identity.example/late');
    await Promise.resolve();
    expect(navigationMocks.assign).not.toHaveBeenCalled();
  });

  it('aborts an unmounted registration start and ignores its late rejection', async () => {
    const pending = deferred<string>();
    authenticationMocks.startRegistration.mockReturnValueOnce(pending.promise);
    const rendered = render(<RegistrationForm returnPath="/account" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country of residence' }), {
      target: { value: 'US' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue securely/i }));
    const signal = authenticationMocks.startRegistration.mock.calls[0]?.[1]?.signal as AbortSignal;
    rendered.unmount();

    expect(signal.aborted).toBe(true);
    pending.reject(new Error('late sensitive provider failure'));
    await pending.promise.catch(() => undefined);
    expect(navigationMocks.assign).not.toHaveBeenCalled();
  });

  it('lets only the current login intent navigate after a return-path supersession', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    authenticationMocks.startLogin
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rendered = render(
      <LoginForm key="/account?tab=profile" returnPath="/account?tab=profile" />,
    );
    const firstButton = screen.getByRole('button', { name: /continue to sign in/i });

    fireEvent.click(firstButton);
    const firstSignal = authenticationMocks.startLogin.mock.calls[0]?.[1]?.signal as AbortSignal;
    rendered.rerender(<LoginForm key="/account?tab=security" returnPath="/account?tab=security" />);
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    const secondButton = screen.getByRole('button', { name: /continue to sign in/i });
    expect(secondButton).toBeEnabled();
    fireEvent.click(secondButton);

    first.resolve('https://identity.example/stale');
    await Promise.resolve();
    expect(navigationMocks.assign).not.toHaveBeenCalled();

    second.resolve('https://identity.example/current');
    await waitFor(() =>
      expect(navigationMocks.assign).toHaveBeenCalledWith('https://identity.example/current'),
    );
    expect(authenticationMocks.startLogin).toHaveBeenCalledTimes(2);
  });

  it('resets a registration start after a return-path supersession', async () => {
    const first = deferred<string>();
    authenticationMocks.startRegistration.mockReturnValueOnce(first.promise);
    const rendered = render(
      <RegistrationForm key="/account?tab=profile" returnPath="/account?tab=profile" />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'first@example.com' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country of residence' }), {
      target: { value: 'US' },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue securely/i }));
    const firstSignal = authenticationMocks.startRegistration.mock.calls[0]?.[1]
      ?.signal as AbortSignal;

    rendered.rerender(
      <RegistrationForm key="/account?tab=security" returnPath="/account?tab=security" />,
    );
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'second@example.com' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country of residence' }), {
      target: { value: 'US' },
    });
    const secondButton = screen.getByRole('button', { name: /continue securely/i });
    expect(secondButton).toBeEnabled();
    fireEvent.click(secondButton);

    await waitFor(() => expect(authenticationMocks.startRegistration).toHaveBeenCalledTimes(2));
    expect(authenticationMocks.startRegistration.mock.calls[1]?.[0]).toMatchObject({
      contactEmail: 'second@example.com',
      returnPath: '/account?tab=security',
    });
    first.resolve('https://identity.example/stale');
    await Promise.resolve();
    expect(navigationMocks.assign).toHaveBeenCalledTimes(1);
  });

  it('admits only one same-tick login start', () => {
    authenticationMocks.startLogin.mockReturnValueOnce(deferred<string>().promise);
    render(<LoginForm returnPath="/account" />);
    const form = screen.getByRole('button', { name: /continue to sign in/i }).closest('form');

    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    expect(authenticationMocks.startLogin).toHaveBeenCalledTimes(1);
  });

  it('admits only one same-tick registration start', () => {
    authenticationMocks.startRegistration.mockReturnValueOnce(deferred<string>().promise);
    render(<RegistrationForm returnPath="/account" />);
    const form = screen.getByRole('button', { name: /continue securely/i }).closest('form');

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Country of residence' }), {
      target: { value: 'US' },
    });
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    expect(authenticationMocks.startRegistration).toHaveBeenCalledTimes(1);
  });

  it('renders the fixed callback failure as the same focused generic login error', async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({
          error: 'authentication',
          returnTo: '/account',
        }),
      }),
    );

    const alert = screen.getByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(alert).toHaveTextContent('Managed sign-in is unavailable right now');
    expect(alert).not.toHaveTextContent('callback');
  });

  it('renders a polished account shell without embedding protected profile data', () => {
    render(<AccountPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Your account.' })).toBeInTheDocument();
    expect(screen.getByText('Checking your secure session…')).toBeInTheDocument();
    expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();
  });
});

describe('verified account session UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticationMocks.logout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it('renders no profile until restoration succeeds, then shows only the verified response', async () => {
    let resolveProfile: ((profile: typeof PROFILE) => void) | undefined;
    authenticationMocks.restore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        }),
    );
    render(<AccountSession />);

    expect(screen.getByText('Checking your secure session…')).toBeInTheDocument();
    expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();

    resolveProfile?.(PROFILE);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();
    expect(screen.getByText('Not provided')).toBeInTheDocument();
    expect(screen.getByText('Not yet determined')).toBeInTheDocument();
  });

  it('replace-redirects an unauthenticated restoration to the local login UI', async () => {
    const firstRosterKey = localDemoWalletRosterKey(PROFILE.accountId);
    const secondRosterKey = localDemoWalletRosterKey('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    window.sessionStorage.setItem(firstRosterKey, JSON.stringify({ version: 1, entries: [] }));
    window.sessionStorage.setItem(secondRosterKey, JSON.stringify({ version: 1, entries: [] }));
    window.sessionStorage.setItem('unrelated.preference', 'preserve-me');
    authenticationMocks.restore.mockRejectedValueOnce(new AuthenticationUnauthenticatedError());
    navigationMocks.replace.mockImplementationOnce(() => {
      expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();
    });
    render(<AccountSession />);

    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith('/login?returnTo=%2Faccount'),
    );
    expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(firstRosterKey)).toBeNull();
    expect(window.sessionStorage.getItem(secondRosterKey)).toBeNull();
    expect(window.sessionStorage.getItem('unrelated.preference')).toBe('preserve-me');
  });

  it('keeps profile data hidden on an unavailable restore and supports an explicit retry', async () => {
    authenticationMocks.restore
      .mockRejectedValueOnce(new Error('database offline'))
      .mockResolvedValueOnce(PROFILE);
    render(<AccountSession />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(alert).not.toHaveTextContent('database offline');
    expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();
    expect(authenticationMocks.restore).toHaveBeenCalledTimes(2);
  });

  it('clears protected profile output before replace-redirecting after confirmed logout', async () => {
    authenticationMocks.restore.mockResolvedValueOnce(PROFILE);
    const rosterKey = localDemoWalletRosterKey(PROFILE.accountId);
    window.sessionStorage.setItem(rosterKey, JSON.stringify({ version: 1, entries: [] }));
    window.sessionStorage.setItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY, 'remembered-wallet');
    navigationMocks.replace.mockImplementationOnce(() => {
      expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();
    });
    render(<AccountSession />);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(navigationMocks.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(rosterKey)).toBeNull();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_POSITION_ACCOUNT_STORAGE_KEY)).toBeNull();
    expect(screen.getByText('Leaving your protected account…')).toBeInTheDocument();
  });

  it('navigates to the validated provider logout URL after confirmed local logout', async () => {
    const providerLogoutUrl =
      'https://identity.example/logout?client_id=public-client&logout_uri=https%3A%2F%2Fapp.example%2Flogin';
    authenticationMocks.restore.mockResolvedValueOnce(PROFILE);
    authenticationMocks.logout.mockResolvedValueOnce(providerLogoutUrl);
    render(<AccountSession />);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(navigationMocks.replace).toHaveBeenCalledWith(providerLogoutUrl));
    expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();
  });

  it('retains the verified view when sign-out cannot be confirmed', async () => {
    authenticationMocks.restore.mockResolvedValueOnce(PROFILE);
    authenticationMocks.logout.mockRejectedValueOnce(new Error('session store unavailable'));
    render(<AccountSession />);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(alert).toHaveTextContent('could not confirm that you were signed out');
    expect(alert).not.toHaveTextContent('session store unavailable');
    expect(screen.getByText(PROFILE.contactEmail)).toBeInTheDocument();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  it('does not claim logout when the client has no valid CSRF proof or receives no 204', async () => {
    authenticationMocks.restore.mockResolvedValueOnce(PROFILE);
    authenticationMocks.logout.mockRejectedValueOnce(new AuthenticationUnauthenticatedError());
    render(<AccountSession />);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not confirm that you were signed out');
    expect(screen.getByText(PROFILE.contactEmail)).toBeInTheDocument();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  it('aborts pending logout on unmount and prevents late navigation', async () => {
    const pending = deferred<void>();
    authenticationMocks.restore.mockResolvedValueOnce(PROFILE);
    authenticationMocks.logout.mockReturnValueOnce(pending.promise);
    const rendered = render(<AccountSession />);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Sign out' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(authenticationMocks.logout).toHaveBeenCalledTimes(1);
    const signal = authenticationMocks.logout.mock.calls[0]?.[0]?.signal as AbortSignal;
    rendered.unmount();

    expect(signal.aborted).toBe(true);
    pending.resolve();
    await Promise.resolve();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  it('hides cached profile output and revalidates after a persisted pageshow', async () => {
    const refreshed = deferred<typeof PROFILE>();
    authenticationMocks.restore
      .mockResolvedValueOnce(PROFILE)
      .mockReturnValueOnce(refreshed.promise);
    render(<AccountSession />);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    window.dispatchEvent(pageShow);

    await waitFor(() => expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument());
    expect(screen.getByText('Checking your secure session…')).toBeInTheDocument();
    refreshed.resolve({ ...PROFILE, contactEmail: 'refreshed@example.com' });
    expect(await screen.findByText('refreshed@example.com')).toBeInTheDocument();
    expect(authenticationMocks.restore).toHaveBeenCalledTimes(2);
  });

  it('clears the known account roster when persisted-page session revalidation signs out', async () => {
    authenticationMocks.restore
      .mockResolvedValueOnce(PROFILE)
      .mockRejectedValueOnce(new AuthenticationUnauthenticatedError());
    const rosterKey = localDemoWalletRosterKey(PROFILE.accountId);
    window.sessionStorage.setItem(rosterKey, JSON.stringify({ version: 1, entries: [] }));
    render(<AccountSession />);
    expect(await screen.findByText(PROFILE.contactEmail)).toBeInTheDocument();

    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    window.dispatchEvent(pageShow);

    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith('/login?returnTo=%2Faccount'),
    );
    expect(window.sessionStorage.getItem(rosterKey)).toBeNull();
    expect(screen.queryByText(PROFILE.contactEmail)).not.toBeInTheDocument();
  });
});
