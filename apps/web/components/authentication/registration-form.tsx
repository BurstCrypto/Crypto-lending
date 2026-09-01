'use client';

import { useEffect, useRef, useState } from 'react';

import { startAuthenticationRegistration } from '@/lib/authentication';

import { assignBrowserLocation } from './browser-navigation';
import { AuthenticationError } from './authentication-error';

const GENERIC_START_ERROR = 'Please check your entries, wait a moment, and try again.';

export function RegistrationForm({ returnPath }: { readonly returnPath: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
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

    const form = new FormData(event.currentTarget);
    const contactEmail = String(form.get('contactEmail') ?? '').trim();
    const contactPhone = String(form.get('contactPhone') ?? '').trim();
    const declaredResidencyCountryCode = String(form.get('declaredResidencyCountryCode') ?? '')
      .trim()
      .toUpperCase();

    pendingReference.current = true;
    requestReference.current?.abort();
    const abortController = new AbortController();
    requestReference.current = abortController;
    const generation = ++requestGeneration.current;
    setFailed(false);
    setSubmitting(true);
    try {
      const authorizationUrl = await startAuthenticationRegistration(
        {
          contactEmail,
          ...(contactPhone === '' ? {} : { contactPhone }),
          declaredResidencyCountryCode,
          returnPath,
        },
        {
          signal: abortController.signal,
        },
      );
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
        <h2>Create your profile</h2>
        <p>All fields are checked again by the server before account creation.</p>
      </div>

      <AuthenticationError active={failed} id="registration-error">
        {GENERIC_START_ERROR}
      </AuthenticationError>

      <form
        className="authentication-form"
        method="post"
        action="/api/v1/auth/registration"
        aria-busy={submitting}
        aria-describedby={failed ? 'registration-error' : 'registration-form-note'}
        onSubmit={(event) => void submit(event)}
      >
        <input type="hidden" name="returnPath" value={returnPath} />
        <div className="authentication-field">
          <label htmlFor="registration-email">Email address</label>
          <input
            id="registration-email"
            name="contactEmail"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            placeholder="you@example.com"
            required
          />
        </div>

        <div className="authentication-field">
          <label htmlFor="registration-phone">
            Phone number <span>(optional)</span>
          </label>
          <input
            id="registration-phone"
            name="contactPhone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            maxLength={16}
            pattern="\+[1-9][0-9]{1,14}"
            placeholder="+13035550123"
            aria-describedby="registration-phone-hint"
          />
          <p className="authentication-field-hint" id="registration-phone-hint">
            Include the country calling code, beginning with +.
          </p>
        </div>

        <div className="authentication-field">
          <label htmlFor="registration-country">Country of residence</label>
          <input
            id="registration-country"
            name="declaredResidencyCountryCode"
            type="text"
            list="registration-country-options"
            autoComplete="country"
            autoCapitalize="characters"
            maxLength={2}
            minLength={2}
            pattern="[A-Za-z]{2}"
            placeholder="US"
            aria-describedby="registration-country-hint"
            required
          />
          <datalist id="registration-country-options">
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="GB">United Kingdom</option>
            <option value="AU">Australia</option>
            <option value="DE">Germany</option>
            <option value="FR">France</option>
          </datalist>
          <p className="authentication-field-hint" id="registration-country-hint">
            Enter the two-letter country code, such as US or CA.
          </p>
        </div>

        <button className="authentication-submit" type="submit" disabled={submitting}>
          {submitting ? 'Opening secure registration…' : 'Continue securely'}
          {!submitting && <span aria-hidden="true">↗</span>}
        </button>
        <p className="authentication-form-note" id="registration-form-note">
          Continuing does not connect a wallet or authorize a financial transaction.
        </p>
        <span className="visually-hidden" aria-live="polite">
          {submitting ? 'Opening secure registration.' : ''}
        </span>
      </form>
    </>
  );
}
