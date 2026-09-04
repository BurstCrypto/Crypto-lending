'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AuthenticationUnauthenticatedError,
  restoreAuthenticationSession,
} from '@/lib/authentication';
import { useSensitiveViewRevalidation } from '@/lib/browser/use-sensitive-view-revalidation';

const PORTFOLIO_LOGIN_PATH = '/login?returnTo=%2Fportfolio';
const PORTFOLIO_REGISTRATION_PATH = '/register?returnTo=%2Fportfolio';

type HomeSessionActionState = 'checking' | 'authenticated' | 'public' | 'unavailable';

function PublicActions() {
  return (
    <div className="hero-actions action-group">
      <Link className="primary-action action-button" href={PORTFOLIO_LOGIN_PATH}>
        Sign in
      </Link>
      <Link className="secondary-action action-button" href={PORTFOLIO_REGISTRATION_PATH}>
        Create an account
      </Link>
    </div>
  );
}

function AuthenticatedActions() {
  return (
    <div className="hero-actions action-group">
      <Link className="primary-action action-button" href="/portfolio">
        View portfolio
      </Link>
      <Link className="secondary-action action-button" href="/account">
        Account
      </Link>
    </div>
  );
}

export function HomeSessionActions() {
  const [state, setState] = useState<HomeSessionActionState>('checking');
  const [revision, setRevision] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  const invalidateSessionActions = useCallback((): void => {
    activeRequest.current?.abort();
    setState('checking');
  }, []);

  const revalidateSessionActions = useCallback((): void => {
    setRevision((current) => current + 1);
  }, []);

  useSensitiveViewRevalidation({
    invalidate: invalidateSessionActions,
    revalidate: revalidateSessionActions,
  });

  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;

    void restoreAuthenticationSession({ signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setState('authenticated');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(error instanceof AuthenticationUnauthenticatedError ? 'public' : 'unavailable');
      });

    return () => {
      controller.abort();
      if (activeRequest.current === controller) activeRequest.current = null;
    };
  }, [revision]);

  return (
    <>
      {state === 'authenticated' ? (
        <AuthenticatedActions />
      ) : state === 'public' || state === 'unavailable' ? (
        <PublicActions />
      ) : (
        <div
          className="hero-actions action-group home-session-actions-checking"
          data-home-session-actions="checking"
          aria-hidden="true"
        />
      )}

      <noscript>
        <PublicActions />
      </noscript>
    </>
  );
}
