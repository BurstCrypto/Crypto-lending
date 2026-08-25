import { Buffer } from 'node:buffer';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTHENTICATION_SESSION_COOKIE_NAME } from '../lib/authentication/protected-route';
import { config, proxy } from '../proxy';

const VALID_SESSION = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${'A'.repeat(43)}`;
const ACCOUNT_PRIVACY_HEADERS = {
  'cache-control': 'private, no-store, max-age=0',
  'x-robots-tag': 'noindex, nofollow, noarchive',
};

function accountRequest(path = '/account', cookie?: string): NextRequest {
  return new NextRequest(`https://app.example${path}`, {
    ...(cookie === undefined ? {} : { headers: { Cookie: cookie } }),
  });
}

function expectAccountPrivacyHeaders(response: Response): void {
  for (const [name, value] of Object.entries(ACCOUNT_PRIVACY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.has('www-authenticate')).toBe(false);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('AUTH_PUBLIC_ORIGIN', 'https://app.example');
});

describe('web request proxy', () => {
  it('matches the original restricted lab and the protected account shell only', () => {
    expect(config.matcher).toEqual([
      '/internal/wallet-lab/:path*',
      '/account/:path*',
      '/portfolio',
    ]);
  });

  it('protects the portfolio shell with the same cookie hint and return path', () => {
    const redirect = proxy(accountRequest('/portfolio'));
    expect(redirect.status).toBe(307);
    expect(new URL(redirect.headers.get('location') as string).searchParams.get('returnTo')).toBe(
      '/portfolio',
    );
    expectAccountPrivacyHeaders(redirect);

    const shell = proxy(
      accountRequest('/portfolio', `${AUTHENTICATION_SESSION_COOKIE_NAME}=${VALID_SESSION}`),
    );
    expect(shell.status).toBe(200);
    expectAccountPrivacyHeaders(shell);
  });

  it('redirects a missing account-session hint temporarily and preserves the safe query', () => {
    const response = proxy(accountRequest('/account/settings?section=security&mode=compact'));

    expect(response.status).toBe(307);
    expectAccountPrivacyHeaders(response);
    expect(response.headers.get('vary')).toBe('Cookie, Origin');
    expect(response.headers.get('location')).toMatch(/^https:\/\/app\.example\/login\?/u);
    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
    expect([...location.searchParams]).toEqual([
      ['returnTo', '/account/settings?section=security&mode=compact'],
    ]);
  });

  it.each([
    `${AUTHENTICATION_SESSION_COOKIE_NAME}=malformed`,
    `${AUTHENTICATION_SESSION_COOKIE_NAME}=${VALID_SESSION}; ${AUTHENTICATION_SESSION_COOKIE_NAME}=${VALID_SESSION}`,
  ])(
    'redirects a malformed or duplicate account-session hint without a Basic challenge',
    (cookie) => {
      const response = proxy(accountRequest('/account/wallets', cookie));

      expect(response.status).toBe(307);
      expectAccountPrivacyHeaders(response);
      expect(response.headers.get('vary')).toBe('Cookie, Origin');
      expect(new URL(response.headers.get('location') as string).searchParams.get('returnTo')).toBe(
        '/account/wallets',
      );
    },
  );

  it('renders only the account shell for one valid-looking hint with private headers', () => {
    const response = proxy(
      accountRequest('/account', `${AUTHENTICATION_SESSION_COOKIE_NAME}=${VALID_SESSION}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expectAccountPrivacyHeaders(response);
    expect(response.headers.has('vary')).toBe(false);
  });

  it('never turns an unsafe encoded path into an external or login-loop return target', () => {
    const response = proxy(accountRequest('/account/%252f%252fevil.example'));
    const location = new URL(response.headers.get('location') as string);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('returnTo')).toBe('/account');
  });

  it('does not reflect a request-derived host into the redirect Location', () => {
    const response = proxy(
      new NextRequest('https://request-origin-attacker.invalid/account', {
        headers: {
          Host: 'host-header-attacker.invalid',
          'X-Forwarded-Host': 'forwarded-host-attacker.invalid',
          'X-Forwarded-Proto': 'http',
        },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example/login?returnTo=%2Faccount');
    expect(response.headers.get('location')).not.toContain('attacker.invalid');
  });

  it.each([undefined, '', 'not a URL', 'https://app.example/path', 'http://app.example'])(
    'fails closed with a private 503 when AUTH_PUBLIC_ORIGIN is missing or invalid',
    async (configuredOrigin) => {
      vi.stubEnv('AUTH_PUBLIC_ORIGIN', configuredOrigin);

      const response = proxy(accountRequest());

      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Authentication unavailable.');
      expect(response.headers.has('location')).toBe(false);
      expect(response.headers.get('retry-after')).toBe('1');
      expectAccountPrivacyHeaders(response);
      expect(response.headers.get('vary')).toBe('Cookie, Origin');
    },
  );

  it('permits HTTP loopback in development but rejects it in production', () => {
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', 'http://127.0.0.1:3000');
    vi.stubEnv('NODE_ENV', 'development');
    const localResponse = proxy(
      new NextRequest('http://host-header-attacker.invalid/account/settings'),
    );
    expect(localResponse.status).toBe(307);
    expect(localResponse.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?returnTo=%2Faccount%2Fsettings',
    );

    vi.stubEnv('NODE_ENV', 'production');
    const productionResponse = proxy(accountRequest());
    expect(productionResponse.status).toBe(503);
    expect(productionResponse.headers.has('location')).toBe(false);
    expectAccountPrivacyHeaders(productionResponse);
    expect(productionResponse.headers.get('vary')).toBe('Cookie, Origin');
  });

  it('preserves the existing restricted wallet-lab decision and Basic challenge', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WALLET_LAB_ENABLED', 'true');
    vi.stubEnv('WALLET_LAB_ENVIRONMENT', 'local');
    vi.stubEnv('WALLET_LAB_BASIC_AUTH_USERNAME', 'reviewer');
    vi.stubEnv('WALLET_LAB_BASIC_AUTH_PASSWORD', 'a-long-preview-only-password');

    const response = proxy(
      new NextRequest('http://127.0.0.1:3000/internal/wallet-lab', {
        headers: { Authorization: 'Basic invalid' },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Authentication required.');
    expect(response.headers.get('www-authenticate')).toBe(
      'Basic realm="Restricted wallet lab", charset="UTF-8"',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  it('keeps the existing wallet-lab success branch separate from account cookies', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WALLET_LAB_ENABLED', 'true');
    vi.stubEnv('WALLET_LAB_ENVIRONMENT', 'local');
    vi.stubEnv('WALLET_LAB_BASIC_AUTH_USERNAME', 'reviewer');
    vi.stubEnv('WALLET_LAB_BASIC_AUTH_PASSWORD', 'a-long-preview-only-password');
    const authorization = Buffer.from('reviewer:a-long-preview-only-password', 'utf8').toString(
      'base64',
    );

    const response = proxy(
      new NextRequest('http://127.0.0.1:3000/internal/wallet-lab', {
        headers: {
          Authorization: `Basic ${authorization}`,
          Cookie: `${AUTHENTICATION_SESSION_COOKIE_NAME}=${VALID_SESSION}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.has('www-authenticate')).toBe(false);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });
});
