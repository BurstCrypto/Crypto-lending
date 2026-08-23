import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticationUnauthenticatedError,
  AuthenticationUnavailableError,
} from '../lib/authentication/errors';
import {
  logoutAuthenticationSession,
  readAuthenticationCsrfToken,
  restoreAuthenticationSession,
  type AuthenticationFetch,
} from '../lib/authentication/session-client';
import { parseAccountProfile } from '../lib/authentication/account-profile';

const PROFILE = Object.freeze({
  accountId: '0f27af0b-48b2-4f1b-b3d4-cd531a0b4458',
  contactEmail: 'Case.Sensitive@example.com',
  contactPhone: '+14155552671',
  declaredResidencyCountryCode: 'US',
  eligibilityStatus: 'UNKNOWN',
  version: 1,
  createdAt: '2026-08-20T16:00:00.000Z',
  updatedAt: '2026-08-20T16:01:00.000Z',
});
const CSRF = 'A'.repeat(43);

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

describe('account profile response boundary', () => {
  it('accepts and freezes the exact canonical API profile', () => {
    const parsed = parseAccountProfile(PROFILE);

    expect(parsed).toEqual(PROFILE);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    { ...PROFILE, accountId: 'not-a-uuid' },
    { ...PROFILE, contactEmail: 'person@EXAMPLE.com' },
    { ...PROFILE, contactPhone: '303-555-0100' },
    { ...PROFILE, declaredResidencyCountryCode: 'ZZ' },
    { ...PROFILE, eligibilityStatus: 'ELIGIBLE' },
    { ...PROFILE, version: 0 },
    { ...PROFILE, createdAt: 'not-a-date' },
    { ...PROFILE, updatedAt: '2026-08-20T15:59:00.000Z' },
    { ...PROFILE, extra: 'unexpected' },
  ])('rejects malformed, non-canonical, or expanded profile data', (candidate) => {
    expect(() => parseAccountProfile(candidate)).toThrow(AuthenticationUnavailableError);
  });

  it('rejects accessors without evaluating them', () => {
    const getter = vi.fn(() => PROFILE.contactEmail);
    const candidate = { ...PROFILE };
    Object.defineProperty(candidate, 'contactEmail', { enumerable: true, get: getter });

    expect(() => parseAccountProfile(candidate)).toThrow(AuthenticationUnavailableError);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('authentication session client', () => {
  it('restores only a strict no-store same-origin profile response', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => jsonResponse(PROFILE));

    await expect(restoreAuthenticationSession({ fetch: requestFetch })).resolves.toEqual(PROFILE);
    expect(requestFetch).toHaveBeenCalledWith('/api/v1/accounts/me', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
    expect(JSON.stringify(requestFetch.mock?.calls ?? '')).not.toContain('Authorization');
  });

  it('maps missing sessions and operational failures to generic typed errors', async () => {
    await expect(
      restoreAuthenticationSession({
        fetch: async () => jsonResponse({ private: 'ignored' }, 401),
      }),
    ).rejects.toEqual(expect.any(AuthenticationUnauthenticatedError));

    const unavailable = restoreAuthenticationSession({
      fetch: async () => jsonResponse({ private: 'ignored' }, 503, { 'Retry-After': '7' }),
    });
    await expect(unavailable).rejects.toMatchObject({
      code: 'AUTHENTICATION_UNAVAILABLE',
      message: 'Authentication unavailable',
      retryAfterSeconds: 7,
    });
    await expect(
      restoreAuthenticationSession({ fetch: async () => Promise.reject(new Error('secret')) }),
    ).rejects.toMatchObject({ message: 'Authentication unavailable' });
  });

  it('rejects malformed or oversized success bodies without reflecting them', async () => {
    await expect(
      restoreAuthenticationSession({
        fetch: async () =>
          new Response('{private', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      }),
    ).rejects.toMatchObject({ message: 'Authentication unavailable' });
    await expect(
      restoreAuthenticationSession({
        fetch: async () => jsonResponse(PROFILE, 200, { 'Content-Length': String(16_385) }),
      }),
    ).rejects.toEqual(expect.any(AuthenticationUnavailableError));
  });

  it('preserves aborts so an unmounted UI does not render an outage', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException('aborted', 'AbortError');

    await expect(
      restoreAuthenticationSession({
        signal: controller.signal,
        fetch: async () => Promise.reject(aborted),
      }),
    ).rejects.toBe(aborted);
  });
});

describe('authentication CSRF and logout boundary', () => {
  it('reads exactly one canonical CSRF cookie among unrelated cookies', () => {
    expect(readAuthenticationCsrfToken(`theme=dark; __Host-cl_csrf=${CSRF}; locale=en`)).toBe(CSRF);
  });

  it.each([
    '',
    '__Host-cl_csrf=short',
    `__Host-cl_csrf=${'A'.repeat(42)}+`,
    `__Host-cl_csrf=${CSRF}; __Host-cl_csrf=${CSRF}`,
    `__Host-cl_csrf=${CSRF}\u0000`,
  ])('rejects absent, malformed, ambiguous, or unsafe CSRF state', (cookieHeader) => {
    expect(() => readAuthenticationCsrfToken(cookieHeader)).toThrow(
      AuthenticationUnauthenticatedError,
    );
  });

  it('posts the CSRF proof with same-origin cookies and accepts only 204', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(
      async () => new Response(null, { status: 204 }),
    );

    await expect(
      logoutAuthenticationSession({ cookieHeader: `__Host-cl_csrf=${CSRF}`, fetch: requestFetch }),
    ).resolves.toBeUndefined();
    expect(requestFetch).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': CSRF },
      redirect: 'error',
    });
    const serializedCall = JSON.stringify(requestFetch.mock?.calls ?? []);
    expect(serializedCall).not.toContain('Authorization');
    expect(serializedCall).not.toContain('__Host-cl_csrf');
  });

  it('keeps non-204 logout failures generic and retains bounded retry advice', async () => {
    const failure = logoutAuthenticationSession({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: async () => jsonResponse({ message: 'database details' }, 503, { 'Retry-After': '2' }),
    });

    await expect(failure).rejects.toMatchObject({
      code: 'AUTHENTICATION_UNAVAILABLE',
      message: 'Authentication unavailable',
      retryAfterSeconds: 2,
    });
  });
});
