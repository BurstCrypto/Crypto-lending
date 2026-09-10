import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AuthenticationUnauthenticatedError,
  AuthenticationUnavailableError,
} from '../lib/authentication/errors';
import {
  AUTHENTICATION_PROVIDER_LOGOUT_HEADER,
  logoutAuthenticationSession,
  readAuthenticationCsrfToken,
  restoreAuthenticationSession,
  type AuthenticationFetch,
} from '../lib/authentication/session-client';
import { parseAccountProfile } from '../lib/authentication/account-profile';
import { API_REQUEST_TIMEOUT_MILLISECONDS } from '../lib/http/bounded-response';

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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
  it('single-flights concurrent default browser restores without caching the result', async () => {
    const firstResponse = Promise.withResolvers<Response>();
    const requestFetch = vi
      .fn<AuthenticationFetch>()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce(jsonResponse(PROFILE));
    vi.stubGlobal('fetch', requestFetch);

    const first = restoreAuthenticationSession();
    const concurrent = restoreAuthenticationSession();

    expect(requestFetch).toHaveBeenCalledOnce();
    firstResponse.resolve(jsonResponse(PROFILE));
    await expect(Promise.all([first, concurrent])).resolves.toEqual([PROFILE, PROFILE]);

    await expect(restoreAuthenticationSession()).resolves.toEqual(PROFILE);
    expect(requestFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps concurrent restore cancellation independent while another consumer remains', async () => {
    const response = Promise.withResolvers<Response>();
    let requestSignal: AbortSignal | undefined;
    const requestFetch = vi.fn<AuthenticationFetch>((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return response.promise;
    });
    vi.stubGlobal('fetch', requestFetch);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = restoreAuthenticationSession({ signal: firstController.signal });
    const second = restoreAuthenticationSession({ signal: secondController.signal });
    const cancellation = new DOMException('first view left', 'AbortError');
    const firstFailure = expect(first).rejects.toBe(cancellation);

    firstController.abort(cancellation);

    await firstFailure;
    expect(requestSignal?.aborted).toBe(false);
    expect(requestFetch).toHaveBeenCalledOnce();
    response.resolve(jsonResponse(PROFILE));
    await expect(second).resolves.toEqual(PROFILE);
  });

  it('retires an all-cancelled flight before a visible caller starts a fresh restore', async () => {
    const abandonedResponse = Promise.withResolvers<Response>();
    const requestSignals: AbortSignal[] = [];
    const requestFetch = vi
      .fn<AuthenticationFetch>()
      .mockImplementationOnce((_input, init) => {
        if (init?.signal) requestSignals.push(init.signal);
        return abandonedResponse.promise;
      })
      .mockImplementationOnce(async (_input, init) => {
        if (init?.signal) requestSignals.push(init.signal);
        return jsonResponse(PROFILE);
      });
    vi.stubGlobal('fetch', requestFetch);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = restoreAuthenticationSession({ signal: firstController.signal });
    const second = restoreAuthenticationSession({ signal: secondController.signal });
    const firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const secondFailure = expect(second).rejects.toMatchObject({ name: 'AbortError' });

    firstController.abort();
    expect(requestSignals[0]?.aborted).toBe(false);
    secondController.abort();
    expect(requestSignals[0]?.aborted).toBe(true);

    const fresh = restoreAuthenticationSession();
    expect(requestFetch).toHaveBeenCalledTimes(2);
    await expect(fresh).resolves.toEqual(PROFILE);
    await Promise.all([firstFailure, secondFailure]);

    abandonedResponse.resolve(jsonResponse({ ...PROFILE, contactEmail: 'stale@example.com' }));
    await Promise.resolve();
    expect(requestSignals[1]?.aborted).toBe(false);
  });

  it('never coalesces explicitly injected fetch boundaries', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => jsonResponse(PROFILE));

    await expect(
      Promise.all([
        restoreAuthenticationSession({ fetch: requestFetch }),
        restoreAuthenticationSession({ fetch: requestFetch }),
      ]),
    ).resolves.toEqual([PROFILE, PROFILE]);
    expect(requestFetch).toHaveBeenCalledTimes(2);
  });

  it('never coalesces default-fetch restores outside the browser boundary', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => jsonResponse(PROFILE));
    vi.stubGlobal('fetch', requestFetch);
    vi.stubGlobal('window', undefined);

    await expect(
      Promise.all([restoreAuthenticationSession(), restoreAuthenticationSession()]),
    ).resolves.toEqual([PROFILE, PROFILE]);
    expect(requestFetch).toHaveBeenCalledTimes(2);
  });

  it('restores only a strict no-store same-origin profile response', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => jsonResponse(PROFILE));

    await expect(restoreAuthenticationSession({ fetch: requestFetch })).resolves.toEqual(PROFILE);
    expect(requestFetch).toHaveBeenCalledWith('/api/v1/accounts/me', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: expect.any(AbortSignal),
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

  it('bounds and cancels a chunked profile body without Content-Length', async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(9_000).fill(0x20);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(restoreAuthenticationSession({ fetch: async () => response })).rejects.toEqual(
      expect.any(AuthenticationUnavailableError),
    );
    expect(response.headers.has('content-length')).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('maps a stalled profile body deadline to authentication unavailable', async () => {
    vi.useFakeTimers();
    const pendingPull = Promise.withResolvers<void>();
    const cancel = vi.fn(() => pendingPull.resolve());
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          return pendingPull.promise;
        },
        cancel,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const restore = restoreAuthenticationSession({ fetch: async () => response });
    const failure = expect(restore).rejects.toEqual(expect.any(AuthenticationUnavailableError));

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MILLISECONDS);

    await failure;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves aborts so an unmounted UI does not render an outage', async () => {
    const controller = new AbortController();
    const aborted = new DOMException('aborted', 'AbortError');
    controller.abort(aborted);

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
    ).resolves.toBeNull();
    expect(requestFetch).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': CSRF },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    const serializedCall = JSON.stringify(requestFetch.mock?.calls ?? []);
    expect(serializedCall).not.toContain('Authorization');
    expect(serializedCall).not.toContain('__Host-cl_csrf');
  });

  it('returns only the exact same-origin Cognito post-logout navigation hint', async () => {
    const logoutUri = new URL('/login', window.location.origin).href;
    const providerLogout = new URL('https://identity.example.test/logout');
    providerLogout.searchParams.set('client_id', 'public-client');
    providerLogout.searchParams.set('logout_uri', logoutUri);

    await expect(
      logoutAuthenticationSession({
        cookieHeader: `__Host-cl_csrf=${CSRF}`,
        fetch: async () =>
          new Response(null, {
            status: 204,
            headers: { [AUTHENTICATION_PROVIDER_LOGOUT_HEADER]: providerLogout.href },
          }),
      }),
    ).resolves.toBe(providerLogout.href);
  });

  it('returns only the exact same-origin Auth0 post-logout navigation hint', async () => {
    const returnTo = new URL('/login', window.location.origin).href;
    const providerLogout = new URL('https://identity.example.test/v2/logout');
    providerLogout.searchParams.set('client_id', 'public-client');
    providerLogout.searchParams.set('returnTo', returnTo);

    await expect(
      logoutAuthenticationSession({
        cookieHeader: `__Host-cl_csrf=${CSRF}`,
        fetch: async () =>
          new Response(null, {
            status: 204,
            headers: { [AUTHENTICATION_PROVIDER_LOGOUT_HEADER]: providerLogout.href },
          }),
      }),
    ).resolves.toBe(providerLogout.href);
  });

  it('treats malformed provider logout hints as an absent hint after confirmed local logout', async () => {
    const logoutUri = new URL('/login', window.location.origin).href;
    const invalid = [
      `http://identity.example.test/logout?client_id=public-client&logout_uri=${encodeURIComponent(logoutUri)}`,
      `https://identity.example.test/logout?client_id=public-client&logout_uri=${encodeURIComponent(`${window.location.origin}/account`)}`,
      `https://identity.example.test/logout?logout_uri=${encodeURIComponent(logoutUri)}&client_id=public-client`,
      `https://identity.example.test/logout?client_id=public-client&logout_uri=${encodeURIComponent(logoutUri)}&next=https%3A%2F%2Fevil.example`,
      `https://identity.example.test/logout?client_id=${'A'.repeat(4_096)}&logout_uri=${encodeURIComponent(logoutUri)}`,
    ];

    for (const value of invalid) {
      await expect(
        logoutAuthenticationSession({
          cookieHeader: `__Host-cl_csrf=${CSRF}`,
          fetch: async () =>
            new Response(null, {
              status: 204,
              headers: { [AUTHENTICATION_PROVIDER_LOGOUT_HEADER]: value },
            }),
        }),
      ).resolves.toBeNull();
    }
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

  it('times out an abort-ignorant logout and never accepts its late 204', async () => {
    vi.useFakeTimers();
    const lateResponse = Promise.withResolvers<Response>();
    let requestSignal: AbortSignal | undefined;
    const logout = logoutAuthenticationSession({
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      fetch: async (_input, init) => {
        requestSignal = init?.signal ?? undefined;
        return lateResponse.promise;
      },
    });
    const failure = expect(logout).rejects.toEqual(expect.any(AuthenticationUnavailableError));

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MILLISECONDS);
    await failure;

    expect(requestSignal?.aborted).toBe(true);
    lateResponse.resolve(new Response(null, { status: 204 }));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
