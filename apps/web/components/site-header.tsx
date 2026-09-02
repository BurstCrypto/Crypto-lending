'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  AuthenticationUnauthenticatedError,
  restoreAuthenticationSession,
} from '@/lib/authentication';

export type SitePage = 'home' | 'platforms' | 'portfolio' | 'account' | 'login' | 'register';

export type SiteHeaderAuthenticationActions = 'both' | 'sign-in' | 'create-account' | 'none';

interface SiteHeaderProps {
  readonly activePage: SitePage;
  readonly authenticationActions?: SiteHeaderAuthenticationActions;
  readonly signInHref?: string | undefined;
  readonly createAccountHref?: string | undefined;
  readonly createAccountLabel?: string | undefined;
}

const PRIMARY_LINKS = [
  { page: 'home', href: '/', label: 'Home' },
  { page: 'platforms', href: '/platforms', label: 'Platforms' },
  { page: 'portfolio', href: '/portfolio', label: 'Portfolio' },
  { page: 'account', href: '/account', label: 'Account' },
] as const;

type SessionNavigationState = 'checking' | 'authenticated' | 'public' | 'unavailable';

function isActionVisible(
  action: 'sign-in' | 'create-account',
  actions: SiteHeaderAuthenticationActions,
) {
  return actions === 'both' || actions === action;
}

interface AuthenticationNavigationProps {
  readonly activePage: SitePage;
  readonly authenticationActions: Exclude<SiteHeaderAuthenticationActions, 'none'>;
  readonly signInHref: string;
  readonly createAccountHref: string;
  readonly createAccountLabel: string;
}

function AuthenticationNavigation({
  activePage,
  authenticationActions,
  signInHref,
  createAccountHref,
  createAccountLabel,
}: AuthenticationNavigationProps) {
  return (
    <nav className="site-navigation site-navigation--account" aria-label="Account actions">
      {isActionVisible('sign-in', authenticationActions) ? (
        <Link
          className="navigation-link navigation-button"
          href={signInHref}
          aria-current={activePage === 'login' ? 'page' : undefined}
        >
          Sign in
        </Link>
      ) : null}
      {isActionVisible('create-account', authenticationActions) ? (
        <Link
          className="navigation-action navigation-button"
          href={createAccountHref}
          aria-current={activePage === 'register' ? 'page' : undefined}
        >
          {createAccountLabel}
        </Link>
      ) : null}
    </nav>
  );
}

export function SiteHeader({
  activePage,
  authenticationActions = 'both',
  signInHref = '/login',
  createAccountHref = '/register',
  createAccountLabel = 'Create account',
}: SiteHeaderProps) {
  const [sessionState, setSessionState] = useState<SessionNavigationState>('checking');
  const [sessionRevision, setSessionRevision] = useState(0);
  const activeSessionCheck = useRef<AbortController | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    activeSessionCheck.current = abortController;

    void restoreAuthenticationSession({ signal: abortController.signal })
      .then(() => {
        if (!abortController.signal.aborted) setSessionState('authenticated');
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) {
          setSessionState(
            error instanceof AuthenticationUnauthenticatedError ? 'public' : 'unavailable',
          );
        }
      });

    return () => {
      abortController.abort();
      if (activeSessionCheck.current === abortController) activeSessionCheck.current = null;
    };
  }, [sessionRevision]);

  useEffect(() => {
    function revalidatePersistedPage(event: PageTransitionEvent): void {
      if (!event.persisted) return;
      activeSessionCheck.current?.abort();
      setSessionState('checking');
      setSessionRevision((revision) => revision + 1);
    }

    window.addEventListener('pageshow', revalidatePersistedPage);
    return () => window.removeEventListener('pageshow', revalidatePersistedPage);
  }, []);

  const primaryLinks = sessionState === 'authenticated' ? PRIMARY_LINKS : [];
  const isPublicEntryPage =
    activePage === 'home' || activePage === 'login' || activePage === 'register';
  const visibleAuthenticationActions =
    authenticationActions !== 'none' &&
    (sessionState === 'public' || (sessionState === 'unavailable' && isPublicEntryPage))
      ? authenticationActions
      : null;

  return (
    <header className="site-header site-header--shared" data-session-navigation={sessionState}>
      <Link className="brand site-header__brand" href="/" aria-label="Crypto Lending home">
        <span className="brand-mark" aria-hidden="true">
          CL
        </span>
        <span className="brand-name">Crypto Lending</span>
      </Link>

      <div className="site-header__menus">
        {primaryLinks.length > 0 ? (
          <nav className="site-navigation site-navigation--primary" aria-label="Primary">
            {primaryLinks.map((link) => (
              <Link
                key={link.page}
                className="navigation-link navigation-button"
                href={link.href}
                aria-current={activePage === link.page ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}

        {visibleAuthenticationActions !== null ? (
          <AuthenticationNavigation
            activePage={activePage}
            authenticationActions={visibleAuthenticationActions}
            signInHref={signInHref}
            createAccountHref={createAccountHref}
            createAccountLabel={createAccountLabel}
          />
        ) : null}

        {authenticationActions !== 'none' ? (
          <noscript>
            <AuthenticationNavigation
              activePage={activePage}
              authenticationActions={authenticationActions}
              signInHref={signInHref}
              createAccountHref={createAccountHref}
              createAccountLabel={createAccountLabel}
            />
          </noscript>
        ) : null}
      </div>
    </header>
  );
}
