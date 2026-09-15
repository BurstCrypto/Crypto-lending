'use client';

import { useEffect, useRef, useState } from 'react';

import { safeAccountReturnPathOrDefault } from '@/lib/authentication';
import { assignBrowserLocation } from './browser-navigation';

type Step = 'identifier' | 'code' | 'profile';
type Channels = { email: boolean; sms: boolean };
const UNAVAILABLE = 'Sign-in codes are unavailable right now. Please try again later.';

export function PasswordlessForm({ returnPath }: { readonly returnPath: string }) {
  const [channels, setChannels] = useState<Channels | null>(null);
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 15_000);
    void fetch('/api/v1/auth/options', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(UNAVAILABLE);
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== 'object' ||
          !('mode' in value) ||
          value.mode !== 'passwordless' ||
          !('email' in value) ||
          typeof value.email !== 'boolean' ||
          !('sms' in value) ||
          typeof value.sms !== 'boolean'
        )
          throw new Error(UNAVAILABLE);
        if (!controller.signal.aborted) setChannels({ email: value.email, sms: value.sms });
      })
      .catch(() => {
        if (!disposed) setError(UNAVAILABLE);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      const activeRequest = pending.current;
      pending.current = null;
      activeRequest?.abort();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(timer);
  }, [resendAt]);

  async function submit(event: React.FormEvent<HTMLFormElement>, resend = false): Promise<void> {
    event.preventDefault();
    if (pending.current) return;
    const fields = new FormData(event.currentTarget);
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setBusy(true);
    setError('');
    const action =
      resend || step === 'identifier' ? 'request' : step === 'code' ? 'verify' : 'complete';
    try {
      const response = await fetch(`/api/v1/auth/code/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'request'
            ? { identifier }
            : action === 'verify'
              ? { code }
              : {
                  contactEmail: String(fields.get('contactEmail') ?? ''),
                  declaredResidencyCountryCode: String(fields.get('country') ?? '')
                    .trim()
                    .toUpperCase(),
                },
        ),
      });
      if (response.status === 429)
        throw new Error('Too many attempts. Please wait a few minutes before trying again.');
      if (response.status === 401)
        throw new Error(
          action === 'request'
            ? channels?.email && channels.sms
              ? 'Enter a valid email address or U.S. phone number.'
              : channels?.sms
                ? 'Enter a valid U.S. phone number.'
                : 'Enter a valid email address.'
            : step === 'profile'
              ? 'Check your account details. If your code has expired, start again.'
              : 'That code is invalid or expired. Try again or request a new code.',
        );
      if (!response.ok) throw new Error(UNAVAILABLE);
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('status' in value)) throw new Error(UNAVAILABLE);
      if (controller.signal.aborted) return;
      if (action === 'request' && value.status === 'sent') {
        setCode('');
        setStep('code');
        setRemaining(60);
        setResendAt(Date.now() + 60_000);
      } else if (action !== 'request' && value.status === 'profile_required') {
        setCode('');
        setVerifiedEmail(
          'contactEmail' in value && typeof value.contactEmail === 'string'
            ? value.contactEmail
            : null,
        );
        setStep('profile');
      } else if (action !== 'request' && value.status === 'authenticated') {
        setCode('');
        assignBrowserLocation(safeAccountReturnPathOrDefault(returnPath));
      } else throw new Error(UNAVAILABLE);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : UNAVAILABLE);
      else if (pending.current === controller) setError('Sign-in took too long. Please try again.');
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  const available = Boolean(channels?.email || channels?.sms);
  const label =
    channels?.email && channels.sms
      ? 'Email or phone number'
      : channels?.sms
        ? 'Phone number'
        : 'Email address';
  return (
    <>
      <div className="authentication-card-header">
        <h2>
          {step === 'identifier'
            ? 'Sign in with a code'
            : step === 'code'
              ? 'Check your messages'
              : 'Finish creating your account'}
        </h2>
        <p>
          {step === 'identifier'
            ? 'We will send you a one-time code. No password needed.'
            : step === 'code'
              ? `Enter the six-digit code sent to ${identifier}. Codes are valid for up to 10 minutes.`
              : 'Your code is verified. Add these details to complete your profile.'}
        </p>
      </div>
      {error && (
        <p className="authentication-error" role="alert">
          {error}
        </p>
      )}
      {channels && !available && <p role="status">{UNAVAILABLE}</p>}
      <form
        className="authentication-form"
        aria-busy={busy}
        onSubmit={(event) => {
          const resend =
            (event.nativeEvent as SubmitEvent).submitter?.getAttribute('name') === 'resend';
          void submit(event, resend);
        }}
      >
        {step === 'identifier' && (
          <div className="authentication-field">
            <label htmlFor="passwordless-identifier">{label}</label>
            <input
              id="passwordless-identifier"
              name="identifier"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              type={channels?.email ? (channels.sms ? 'text' : 'email') : 'tel'}
              autoComplete="username"
              maxLength={254}
              required
              disabled={busy}
              placeholder={
                channels?.email
                  ? channels.sms
                    ? 'you@example.com or (202) 555-0123'
                    : 'you@example.com'
                  : '(202) 555-0123'
              }
            />
            {channels?.sms && (
              <p className="authentication-field-hint">
                U.S. phone numbers only. Enter 10 digits, with or without +1.
              </p>
            )}
          </div>
        )}
        {step === 'code' && (
          <div className="authentication-field">
            <label htmlFor="passwordless-code">Sign-in code</label>
            <input
              key="code"
              id="passwordless-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              minLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              disabled={busy}
              autoFocus
            />
          </div>
        )}
        {step === 'profile' && (
          <>
            <div className="authentication-field">
              <label htmlFor="passwordless-email">Contact email</label>
              <input
                id="passwordless-email"
                name="contactEmail"
                type="email"
                autoComplete="email"
                maxLength={254}
                defaultValue={verifiedEmail ?? ''}
                readOnly={verifiedEmail !== null}
                required
                disabled={busy}
              />
            </div>
            <div className="authentication-field">
              <label htmlFor="passwordless-country">Country of residence</label>
              <input
                id="passwordless-country"
                name="country"
                autoComplete="country"
                minLength={2}
                maxLength={2}
                pattern="[A-Za-z]{2}"
                placeholder="US"
                required
                disabled={busy}
              />
              <p className="authentication-field-hint">
                Enter the two-letter country code, such as US or CA.
              </p>
            </div>
          </>
        )}
        <button className="authentication-submit" type="submit" disabled={busy || !available}>
          {busy
            ? 'Please wait…'
            : step === 'identifier'
              ? 'Send sign-in code'
              : step === 'code'
                ? 'Verify and sign in'
                : 'Create account'}
        </button>
        {step === 'code' && (
          <button type="submit" name="resend" formNoValidate disabled={busy || remaining > 0}>
            {remaining > 0 ? `Resend code in ${remaining}s` : 'Resend code'}
          </button>
        )}
        {step !== 'identifier' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setStep('identifier');
              setCode('');
              setError('');
            }}
          >
            Start again
          </button>
        )}
        <p className="authentication-form-note">
          Use the same email or phone number each time you sign in.
        </p>
        <span className="visually-hidden" aria-live="polite">
          {busy ? 'Please wait.' : ''}
        </span>
      </form>
    </>
  );
}
