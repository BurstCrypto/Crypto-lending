import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AuthenticationRejectedError,
  AuthenticationUnavailableError,
} from '../lib/authentication/errors';
import {
  startAuthenticationLogin,
  startAuthenticationRegistration,
} from '../lib/authentication/start-client';
import type { AuthenticationFetch } from '../lib/authentication/session-client';

function success(authorizationUrl = 'https://identity.example/authorize?state=opaque'): Response {
  return new Response(JSON.stringify({ authorizationUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

describe('authentication start client', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('starts login with one safe local target and returns the validated authorization URL', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => success());

    await expect(
      startAuthenticationLogin('/account/wallets?tab=active', { fetch: requestFetch }),
    ).resolves.toBe('https://identity.example/authorize?state=opaque');
    expect(requestFetch).toHaveBeenCalledWith(
      '/api/v1/auth/login?returnTo=%2Faccount%2Fwallets%3Ftab%3Dactive',
      {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        redirect: 'error',
      },
    );
  });

  it('defaults unsafe login targets to the account landing page', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => success());

    await startAuthenticationLogin('https://evil.example', { fetch: requestFetch });
    expect(requestFetch).toHaveBeenCalledWith(
      '/api/v1/auth/login?returnTo=%2Faccount',
      expect.any(Object),
    );
  });

  it('starts registration with a strict JSON body and no bearer credential', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => success());

    await expect(
      startAuthenticationRegistration(
        {
          contactEmail: 'Case.Sensitive@Example.com',
          contactPhone: null,
          declaredResidencyCountryCode: 'US',
          returnPath: '/account/wallets',
        },
        { fetch: requestFetch },
      ),
    ).resolves.toBe('https://identity.example/authorize?state=opaque');

    expect(requestFetch).toHaveBeenCalledWith('/api/v1/auth/registration', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      redirect: 'error',
      body: JSON.stringify({
        contactEmail: 'Case.Sensitive@Example.com',
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
        returnPath: '/account/wallets',
      }),
    });
    expect(JSON.stringify(requestFetch.mock?.calls ?? [])).not.toContain('Authorization');
  });

  it.each([
    { contactEmail: 'invalid', declaredResidencyCountryCode: 'US' },
    {
      contactEmail: 'person@example.com',
      contactPhone: '303-555-0100',
      declaredResidencyCountryCode: 'US',
    },
    { contactEmail: 'person@example.com', declaredResidencyCountryCode: 'ZZ' },
    { contactEmail: 'person@example.com', declaredResidencyCountryCode: 'US', extra: 'field' },
  ])('rejects invalid registration input before calling fetch', async (input) => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () => success());

    await expect(
      startAuthenticationRegistration(input as never, { fetch: requestFetch }),
    ).rejects.toEqual(expect.any(AuthenticationRejectedError));
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://identity.example/authorize',
    'javascript:alert(1)',
    'https://user:password@identity.example/authorize',
    'https://identity.example/authorize#token',
    '/relative/authorize',
  ])('rejects unsafe authorization URLs without exposing them', async (authorizationUrl) => {
    await expect(
      startAuthenticationLogin('/account', { fetch: async () => success(authorizationUrl) }),
    ).rejects.toEqual(expect.any(AuthenticationUnavailableError));
  });

  it.each([
    'http://localhost:4444/authorize?state=opaque',
    'http://127.0.0.1:4444/authorize?state=opaque',
    'http://[::1]:4444/authorize?state=opaque',
  ])('allows an exact loopback HTTP authorization endpoint for local tests', async (url) => {
    await expect(
      startAuthenticationLogin('/account', { fetch: async () => success(url) }),
    ).resolves.toBe(url);
  });

  it('rejects loopback HTTP authorization endpoints in a production build', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(
      startAuthenticationLogin('/account', {
        fetch: async () => success('http://127.0.0.1:4444/authorize?state=opaque'),
      }),
    ).rejects.toEqual(expect.any(AuthenticationUnavailableError));
  });

  it('maps rejected and unavailable statuses without reading their body details', async () => {
    await expect(
      startAuthenticationLogin('/account', {
        fetch: async () =>
          new Response(JSON.stringify({ detail: 'account exists' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      }),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_REJECTED',
      message: 'Authentication request rejected',
    });

    await expect(
      startAuthenticationLogin('/account', {
        fetch: async () =>
          new Response(JSON.stringify({ detail: 'provider secret' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '4' },
          }),
      }),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_UNAVAILABLE',
      message: 'Authentication unavailable',
      retryAfterSeconds: 4,
    });
  });

  it('rejects expanded success objects and non-JSON success responses', async () => {
    await expect(
      startAuthenticationLogin('/account', {
        fetch: async () =>
          new Response(
            JSON.stringify({
              authorizationUrl: 'https://identity.example/authorize',
              token: 'must-not-be-accepted',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      }),
    ).rejects.toEqual(expect.any(AuthenticationUnavailableError));

    await expect(
      startAuthenticationLogin('/account', {
        fetch: async () => new Response('not json', { status: 200 }),
      }),
    ).rejects.toEqual(expect.any(AuthenticationUnavailableError));
  });
});
