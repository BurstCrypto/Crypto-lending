import { AUTHENTICATION_COOKIE_NAMES } from './authentication-cookies';
import {
  AuthenticationCsrfError,
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
});
