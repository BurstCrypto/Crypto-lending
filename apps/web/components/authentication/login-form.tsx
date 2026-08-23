'use client';

import { useEffect, useRef, useState } from 'react';

import { startAuthenticationLogin } from '@/lib/authentication';

import { assignBrowserLocation } from './browser-navigation';
import { AuthenticationError } from './authentication-error';

const GENERIC_START_ERROR = 'Please wait a moment and try again. No account details were changed.';

export function LoginForm({
  returnPath,
  initialError = false,
}: {
  readonly returnPath: string;
  readonly initialError?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(initialError);
  const pendingReference = useRef(false);
  const requestReference = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      pendingReference.current = false;
      requestReference.current?.abort();
      requestReference.current = null;
    },
    [returnPath],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pendingReference.current) return;

    pendingReference.current = true;
    requestReference.current?.abort();
    const abortController = new AbortController();
    requestReference.current = abortController;
    const generation = ++requestGeneration.current;
    setFailed(false);
    setSubmitting(true);
    try {
      const authorizationUrl = await startAuthenticationLogin(returnPath, {
        signal: abortController.signal,
      });
      if (abortController.signal.aborted || requestGeneration.current !== generation) return;
      assignBrowserLocation(authorizationUrl);
    } catch {
      if (abortController.signal.aborted || requestGeneration.current !== generation) return;
      setFailed(true);
      setSubmitting(false);
    } finally {
      if (requestGeneration.current === generation) {
        pendingReference.current = false;
        requestReference.current = null;
      }
    }
  }

  return (
    <>
      <div className="authentication-card-header">
        <h2>Sign in securely</h2>
        <p>You&apos;ll continue to our managed identity provider in the next step.</p>
      </div>

      <AuthenticationError active={failed} id="login-error">
        {GENERIC_START_ERROR}
      </AuthenticationError>

      <form
        className="authentication-form"
        method="get"
        action="/api/v1/auth/login"
        aria-busy={submitting}
        aria-describedby={failed ? 'login-error' : undefined}
        onSubmit={(event) => void submit(event)}
      >
        <input type="hidden" name="returnTo" value={returnPath} />
        <button className="authentication-submit" type="submit" disabled={submitting}>
          {submitting ? 'Opening secure sign in…' : 'Continue to sign in'}
          {!submitting && <span aria-hidden="true">↗</span>}
        </button>
        <p className="authentication-form-note">
          Crypto Lending receives a verified result—not your identity-provider password.
        </p>
        <span className="visually-hidden" aria-live="polite">
          {submitting ? 'Opening secure sign in.' : ''}
        </span>
      </form>
    </>
  );
}
