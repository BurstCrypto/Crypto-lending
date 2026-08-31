'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  AuthenticationUnauthenticatedError,
  logoutAuthenticationSession,
  restoreAuthenticationSession,
  type AccountProfile,
} from '@/lib/authentication';
import { clearBrowserLocalDemoWalletRoster } from '@/lib/local-demo/wallet-roster';
import { clearBrowserPublicTestnetPositionAccount } from '@/lib/public-testnet/public-testnet-position-account';

import { replaceBrowserLocation } from './browser-navigation';
import { AuthenticationError } from './authentication-error';

type AccountSessionState =
  | { readonly status: 'checking' }
  | { readonly status: 'authenticated'; readonly profile: AccountProfile }
  | { readonly status: 'unavailable' }
  | { readonly status: 'signed-out'; readonly redirectTo: string };

function countryName(countryCode: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function clearCurrentWalletRoster(accountId: string | null): void {
  clearBrowserLocalDemoWalletRoster(accountId);
  clearBrowserPublicTestnetPositionAccount();
}

export function AccountSession() {
  const [session, setSession] = useState<AccountSessionState>({ status: 'checking' });
  const [retryRevision, setRetryRevision] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const restoreRequestReference = useRef<AbortController | null>(null);
  const logoutPendingReference = useRef(false);
  const logoutRequestReference = useRef<AbortController | null>(null);
  const logoutGeneration = useRef(0);
  const accountIdReference = useRef<string | null>(null);

  useEffect(
    () => () => {
      logoutGeneration.current += 1;
      logoutPendingReference.current = false;
      logoutRequestReference.current?.abort();
      logoutRequestReference.current = null;
    },
    [],
  );

  useEffect(() => {
    const abortController = new AbortController();
    restoreRequestReference.current?.abort();
    restoreRequestReference.current = abortController;

    void restoreAuthenticationSession({ signal: abortController.signal })
      .then((profile) => {
        if (!abortController.signal.aborted) {
          accountIdReference.current = profile.accountId;
          setSession({ status: 'authenticated', profile });
        }
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        clearCurrentWalletRoster(accountIdReference.current);
        accountIdReference.current = null;
        if (error instanceof AuthenticationUnauthenticatedError) {
          setSession({
            status: 'signed-out',
            redirectTo: `/login?returnTo=${encodeURIComponent('/account')}`,
          });
          return;
        }
        setSession({ status: 'unavailable' });
      });

    return () => {
      abortController.abort();
      if (restoreRequestReference.current === abortController) {
        restoreRequestReference.current = null;
      }
    };
  }, [retryRevision]);

  useEffect(() => {
    if (session.status === 'signed-out') {
      replaceBrowserLocation(session.redirectTo);
    }
  }, [session]);

  useEffect(() => {
    function revalidatePersistedPage(event: PageTransitionEvent): void {
      if (!event.persisted) return;
      restoreRequestReference.current?.abort();
      logoutGeneration.current += 1;
      logoutPendingReference.current = false;
      logoutRequestReference.current?.abort();
      logoutRequestReference.current = null;
      setLogoutFailed(false);
      setLoggingOut(false);
      setSession({ status: 'checking' });
      setRetryRevision((revision) => revision + 1);
    }

    window.addEventListener('pageshow', revalidatePersistedPage);
    return () => window.removeEventListener('pageshow', revalidatePersistedPage);
  }, []);

  async function logout(): Promise<void> {
    if (logoutPendingReference.current || session.status !== 'authenticated') return;
    clearCurrentWalletRoster(session.profile.accountId);
    accountIdReference.current = null;
    logoutPendingReference.current = true;
    logoutRequestReference.current?.abort();
    const abortController = new AbortController();
    logoutRequestReference.current = abortController;
    const generation = ++logoutGeneration.current;
    setLogoutFailed(false);
    setLoggingOut(true);
    try {
      await logoutAuthenticationSession({ signal: abortController.signal });
      if (abortController.signal.aborted || logoutGeneration.current !== generation) return;
      setSession({ status: 'signed-out', redirectTo: '/login' });
    } catch {
      if (abortController.signal.aborted || logoutGeneration.current !== generation) return;
      setLogoutFailed(true);
      setLoggingOut(false);
    } finally {
      if (logoutGeneration.current === generation) {
        logoutPendingReference.current = false;
        logoutRequestReference.current = null;
      }
    }
  }

  if (session.status === 'checking') {
    return (
      <div className="account-session-loading" role="status" aria-live="polite" aria-busy="true">
        <div>
          <div className="account-loading-mark" aria-hidden="true" />
          <p>Checking your secure session…</p>
        </div>
      </div>
    );
  }

  if (session.status === 'unavailable') {
    return (
      <div className="account-session-unavailable">
        <AuthenticationError active>
          Your account could not be loaded securely. Please try again in a moment.
        </AuthenticationError>
        <button
          className="authentication-secondary-button"
          type="button"
          onClick={() => {
            restoreRequestReference.current?.abort();
            setSession({ status: 'checking' });
            setRetryRevision((revision) => revision + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (session.status === 'signed-out') {
    return (
      <div className="account-session-loading" role="status" aria-live="polite" aria-busy="true">
        <p>Leaving your protected account…</p>
      </div>
    );
  }

  const { profile } = session;
  return (
    <div aria-busy={loggingOut}>
      <div className="account-profile-heading">
        <div>
          <h2>Profile details</h2>
          <p>Verified from your current secure session.</p>
        </div>
        <span className="account-verified-badge">Session verified</span>
      </div>

      <dl className="account-profile-details">
        <div>
          <dt>Email address</dt>
          <dd>{profile.contactEmail}</dd>
        </div>
        <div>
          <dt>Phone number</dt>
          <dd>{profile.contactPhone ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Country of residence</dt>
          <dd>{countryName(profile.declaredResidencyCountryCode)}</dd>
        </div>
        <div>
          <dt>Eligibility status</dt>
          <dd>{profile.eligibilityStatus === 'UNKNOWN' ? 'Not yet determined' : 'Unavailable'}</dd>
        </div>
      </dl>

      <AuthenticationError active={logoutFailed} id="logout-error">
        We could not confirm that you were signed out. Your protected session may still be active;
        please try again.
      </AuthenticationError>

      <Link className="account-portfolio-link" href="/portfolio">
        Open synthetic portfolio
      </Link>

      <button
        className="account-logout"
        type="button"
        aria-describedby={logoutFailed ? 'logout-error' : undefined}
        disabled={loggingOut}
        onClick={() => void logout()}
      >
        {loggingOut ? 'Signing out securely…' : 'Sign out'}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {loggingOut ? 'Secure sign out in progress.' : ''}
      </span>
    </div>
  );
}
