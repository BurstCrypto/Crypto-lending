import { describe, expect, it } from 'vitest';

import {
  AuthenticationReturnPathError,
  buildAuthenticationLoginPath,
  parseSafeAccountReturnPath,
  safeAccountReturnPathOrDefault,
} from '../lib/authentication/return-path';

describe('authentication return paths', () => {
  it.each([
    ['/account', '/account'],
    ['/account/', '/account/'],
    ['/account/wallets', '/account/wallets'],
    ['/account/wallets?tab=registered&sort=recent', '/account/wallets?tab=registered&sort=recent'],
    ['/portfolio', '/portfolio'],
  ])('accepts the narrow account route family: %s', (candidate, expected) => {
    expect(parseSafeAccountReturnPath(candidate)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    'account',
    'https://evil.example/account',
    '//evil.example/account',
    '/login',
    '/register',
    '/portfolio/history',
    '/logout',
    '/api/v1/auth/login',
    '/accountant',
    '/account#private',
    '/account\\settings',
    '/account/%2fsettings',
    '/account/%252fsettings',
    '/account/%25252fsettings',
    '/account/%5csettings',
    '/account/%255csettings',
    '/account/%0asettings',
    '/account/%250asettings',
    '/account/%',
    '/account/../login',
    '/account?returnTo=/login',
    '/account?redirect=%2Fapi%2Fv1%2Fauth%2Flogin',
    `/account?value=${'a'.repeat(510)}`,
    `/account\u0000`,
    `/account\u007f`,
  ])('rejects an unsafe or ambiguous target: %s', (candidate) => {
    expect(() => parseSafeAccountReturnPath(candidate)).toThrow(AuthenticationReturnPathError);
    expect(safeAccountReturnPathOrDefault(candidate)).toBe('/account');
  });

  it('builds one encoded login URL from a validated local target', () => {
    expect(buildAuthenticationLoginPath('/account/wallets?tab=registered')).toBe(
      '/api/v1/auth/login?returnTo=%2Faccount%2Fwallets%3Ftab%3Dregistered',
    );
    expect(buildAuthenticationLoginPath('https://evil.example')).toBe(
      '/api/v1/auth/login?returnTo=%2Faccount',
    );
  });
});
