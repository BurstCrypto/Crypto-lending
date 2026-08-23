import { describe, expect, it } from 'vitest';

import { readCanonicalAuthenticationPublicOrigin } from '../lib/authentication/public-origin.server';

describe('authentication public origin', () => {
  it('accepts an exact HTTPS origin in every runtime', () => {
    for (const NODE_ENV of ['production', 'development', 'test']) {
      expect(
        readCanonicalAuthenticationPublicOrigin({
          AUTH_PUBLIC_ORIGIN: 'https://app.example:8443',
          NODE_ENV,
        }),
      ).toBe('https://app.example:8443');
    }
  });

  it.each([
    undefined,
    '',
    ' https://app.example',
    'https://app.example/',
    'https://user@app.example',
    'https://user:secret@app.example',
    'https://app.example/account',
    'https://app.example?mode=login',
    'https://app.example#login',
    'https://app.example\n',
    'not a URL',
  ])('rejects a missing, malformed, or non-canonical origin', (AUTH_PUBLIC_ORIGIN) => {
    expect(
      readCanonicalAuthenticationPublicOrigin({ AUTH_PUBLIC_ORIGIN, NODE_ENV: 'production' }),
    ).toBeNull();
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'permits exact HTTP loopback only in development and test: %s',
    (AUTH_PUBLIC_ORIGIN) => {
      expect(
        readCanonicalAuthenticationPublicOrigin({
          AUTH_PUBLIC_ORIGIN,
          NODE_ENV: 'development',
        }),
      ).toBe(AUTH_PUBLIC_ORIGIN);
      expect(
        readCanonicalAuthenticationPublicOrigin({ AUTH_PUBLIC_ORIGIN, NODE_ENV: 'test' }),
      ).toBe(AUTH_PUBLIC_ORIGIN);
      expect(
        readCanonicalAuthenticationPublicOrigin({
          AUTH_PUBLIC_ORIGIN,
          NODE_ENV: 'production',
        }),
      ).toBeNull();
    },
  );

  it.each([
    'http://app.example',
    'http://127.0.0.2:3000',
    'http://localhost.example:3000',
    'http://127.1:3000',
  ])('rejects non-loopback or non-canonical HTTP even outside production: %s', (origin) => {
    expect(
      readCanonicalAuthenticationPublicOrigin({
        AUTH_PUBLIC_ORIGIN: origin,
        NODE_ENV: 'development',
      }),
    ).toBeNull();
  });
});
