import { AUTHENTICATION_COOKIE_NAMES } from './authentication-cookies';
import {
  AuthenticationCsrfError,
  canonicalAuthenticationOrigin,
  canonicalHttpsOrigin,
  requireAuthenticationCsrf,
} from './authentication-origin';

const TOKEN = 'a'.repeat(43);

describe('authentication CSRF boundary', () => {
  it('requires an exact HTTPS origin and matching header/cookie on unsafe requests', () => {
    expect(
      requireAuthenticationCsrf({
        method: 'POST',
        originHeader: 'https://app.example',
        csrfHeader: TOKEN,
        cookieHeader: `${AUTHENTICATION_COOKIE_NAMES.csrf}=${TOKEN}`,
        expectedOrigin: 'https://app.example',
      }),
    ).toBe(TOKEN);
  });

  it('leaves safe methods side-effect free without demanding a CSRF proof', () => {
    expect(
      requireAuthenticationCsrf({
        method: 'GET',
        originHeader: undefined,
        csrfHeader: undefined,
        cookieHeader: undefined,
        expectedOrigin: 'https://app.example',
      }),
    ).toBeNull();
  });

  it.each([
    {
      originHeader: undefined,
      csrfHeader: TOKEN,
      cookieHeader: `${AUTHENTICATION_COOKIE_NAMES.csrf}=${TOKEN}`,
    },
    {
      originHeader: 'https://evil.example',
      csrfHeader: TOKEN,
      cookieHeader: `${AUTHENTICATION_COOKIE_NAMES.csrf}=${TOKEN}`,
    },
    {
      originHeader: 'https://app.example',
      csrfHeader: undefined,
      cookieHeader: `${AUTHENTICATION_COOKIE_NAMES.csrf}=${TOKEN}`,
    },
    {
      originHeader: 'https://app.example',
      csrfHeader: TOKEN,
      cookieHeader: `${AUTHENTICATION_COOKIE_NAMES.csrf}=${'b'.repeat(43)}`,
    },
  ])('rejects missing or mismatched unsafe-request proofs', (input) => {
    expect(() =>
      requireAuthenticationCsrf({
        method: 'PATCH',
        expectedOrigin: 'https://app.example',
        ...input,
      }),
    ).toThrow(AuthenticationCsrfError);
  });

  it('accepts only a canonical HTTPS origin', () => {
    expect(canonicalHttpsOrigin('https://app.example')).toBe('https://app.example');
    expect(() => canonicalHttpsOrigin('http://app.example')).toThrow(AuthenticationCsrfError);
    expect(() => canonicalHttpsOrigin('https://app.example/path')).toThrow(AuthenticationCsrfError);
  });

  it('permits only the fixed loopback HTTP origin under the explicit local-demo policy', () => {
    expect(canonicalAuthenticationOrigin('http://127.0.0.1:3000', { localDemo: true })).toBe(
      'http://127.0.0.1:3000',
    );

    for (const origin of [
      'http://127.0.0.1:3001',
      'http://localhost:3000',
      'http://[::1]:3000',
      'http://app.example',
    ]) {
      expect(() => canonicalAuthenticationOrigin(origin, { localDemo: true })).toThrow(
        AuthenticationCsrfError,
      );
    }
    expect(() => canonicalAuthenticationOrigin('http://127.0.0.1:3000')).toThrow(
      AuthenticationCsrfError,
    );
  });

  it('accepts a matching local-demo CSRF proof without weakening the production default', () => {
    const input = {
      method: 'POST',
      originHeader: 'http://127.0.0.1:3000',
      csrfHeader: TOKEN,
      cookieHeader: `${AUTHENTICATION_COOKIE_NAMES.csrf}=${TOKEN}`,
      expectedOrigin: 'http://127.0.0.1:3000',
    } as const;

    expect(requireAuthenticationCsrf({ ...input, localDemo: true })).toBe(TOKEN);
    expect(() => requireAuthenticationCsrf(input)).toThrow(AuthenticationCsrfError);
  });
});
