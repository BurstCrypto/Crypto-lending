import { parseOpaqueAuthenticationSecret } from '../domain/authentication';
import {
  AuthenticationSessionCookieError,
  formatAuthenticationSessionCookie,
  parseAuthenticationSessionCookie,
} from './authentication-session-cookie';

const CREDENTIAL_ID = '7c0d2378-cfc4-4991-a04d-f06892f0da7d';
const SECRET = parseOpaqueAuthenticationSecret<'session'>('a'.repeat(43));

describe('authentication session cookie credential', () => {
  it('round-trips a UUIDv4 selector and 256-bit opaque secret', () => {
    const value = formatAuthenticationSessionCookie(CREDENTIAL_ID, SECRET);
    expect(value).toBe(`${CREDENTIAL_ID}.${SECRET}`);
    expect(parseAuthenticationSessionCookie(value)).toEqual({
      credentialId: CREDENTIAL_ID,
      secret: SECRET,
    });
  });

  it.each([
    '',
    `${CREDENTIAL_ID}.short`,
    `00000000-0000-0000-0000-000000000000.${SECRET}`,
    `${CREDENTIAL_ID}.${'a'.repeat(42)}!`,
    `${CREDENTIAL_ID}.${SECRET}.extra`,
  ])('rejects malformed or ambiguous session credentials', (value) => {
    expect(() => parseAuthenticationSessionCookie(value)).toThrow(AuthenticationSessionCookieError);
  });
});
