import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATION_SESSION_COOKIE_NAME,
  decideProtectedAccountShell,
  hasUniqueValidSessionCookieHint,
} from '../lib/authentication/protected-route';

const VALID_SESSION = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${'A'.repeat(43)}`;

function sessionCookie(value = VALID_SESSION): string {
  return `${AUTHENTICATION_SESSION_COOKIE_NAME}=${value}`;
}

describe('protected account shell decision', () => {
  it('uses one syntactically valid raw session cookie only as a shell-rendering hint', () => {
    expect(hasUniqueValidSessionCookieHint(`theme=dark; ${sessionCookie()}; locale=en`)).toBe(true);
    expect(
      decideProtectedAccountShell({
        cookieHeader: sessionCookie(),
        requestUrl: new URL('https://app.example/account'),
      }),
    ).toEqual({ kind: 'render-shell', reason: 'session-cookie-hint-present' });
  });

  it.each([
    null,
    undefined,
    '',
    42,
    `${AUTHENTICATION_SESSION_COOKIE_NAME}=`,
    sessionCookie(`aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa.${'A'.repeat(43)}`),
    sessionCookie(`AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.${'A'.repeat(43)}`),
    sessionCookie(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${'A'.repeat(42)}`),
    sessionCookie(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${'A'.repeat(42)}=`),
    sessionCookie(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${'A'.repeat(42)}!`),
    `${sessionCookie()}; ${sessionCookie()}`,
    `${sessionCookie('malformed')}; ${sessionCookie()}`,
    `theme=dark\u0000; ${sessionCookie()}`,
    `ignored=${'a'.repeat(16_385)}; ${sessionCookie()}`,
  ])('fails the shell hint closed for an absent, ambiguous, or malformed raw header', (value) => {
    expect(hasUniqueValidSessionCookieHint(value)).toBe(false);
  });

  it('preserves a safe account pathname and query in the server-built return path', () => {
    expect(
      decideProtectedAccountShell({
        cookieHeader: null,
        requestUrl: new URL('https://app.example/account/settings?section=security&mode=compact'),
      }),
    ).toEqual({
      kind: 'redirect-to-login',
      reason: 'session-cookie-hint-absent-or-invalid',
      returnPath: '/account/settings?section=security&mode=compact',
    });
  });

  it('preserves the exact protected portfolio return path', () => {
    expect(
      decideProtectedAccountShell({
        cookieHeader: null,
        requestUrl: new URL('https://app.example/portfolio'),
      }),
    ).toEqual({
      kind: 'redirect-to-login',
      reason: 'session-cookie-hint-absent-or-invalid',
      returnPath: '/portfolio',
    });
  });

  it('preserves the exact protected platforms return path', () => {
    expect(
      decideProtectedAccountShell({
        cookieHeader: null,
        requestUrl: new URL('https://app.example/platforms'),
      }),
    ).toEqual({
      kind: 'redirect-to-login',
      reason: 'session-cookie-hint-absent-or-invalid',
      returnPath: '/platforms',
    });
  });

  it('falls back to the account root when invoked with a non-account or unsafe path', () => {
    for (const url of [
      'https://app.example/login?returnTo=%2Flogin',
      'https://app.example/api/v1/auth/login',
      'https://app.example/account/%252f%252fevil.example',
    ]) {
      expect(
        decideProtectedAccountShell({ cookieHeader: null, requestUrl: new URL(url) }),
      ).toMatchObject({ kind: 'redirect-to-login', returnPath: '/account' });
    }
  });
});
