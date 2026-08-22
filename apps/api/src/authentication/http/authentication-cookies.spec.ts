import {
  assertUnambiguousAuthenticationHeaders,
  AUTHENTICATION_COOKIE_NAMES,
  AuthenticationCookieError,
  clearAuthenticationCookie,
  readUniqueAuthenticationCookie,
  serializeAuthenticationCookie,
} from './authentication-cookies';

describe('authentication cookies', () => {
  it('reads exactly one opaque authentication cookie', () => {
    expect(
      readUniqueAuthenticationCookie(
        `theme=dark; ${AUTHENTICATION_COOKIE_NAMES.session}=selector.secret`,
        AUTHENTICATION_COOKIE_NAMES.session,
      ),
    ).toBe('selector.secret');
    expect(
      readUniqueAuthenticationCookie(undefined, AUTHENTICATION_COOKIE_NAMES.session),
    ).toBeNull();
  });

  it('rejects duplicate, malformed, and ambiguous credentials', () => {
    expect(() =>
      readUniqueAuthenticationCookie(
        `${AUTHENTICATION_COOKIE_NAMES.session}=one; ${AUTHENTICATION_COOKIE_NAMES.session}=two`,
        AUTHENTICATION_COOKIE_NAMES.session,
      ),
    ).toThrow(AuthenticationCookieError);
    expect(() =>
      readUniqueAuthenticationCookie(
        `${AUTHENTICATION_COOKIE_NAMES.session}=bad value`,
        AUTHENTICATION_COOKIE_NAMES.session,
      ),
    ).toThrow(AuthenticationCookieError);
    expect(() =>
      assertUnambiguousAuthenticationHeaders(
        `${AUTHENTICATION_COOKIE_NAMES.session}=selector.secret`,
        'Bearer anything',
      ),
    ).toThrow(AuthenticationCookieError);
  });

  it('serializes and clears host-only secure cookies with pinned attributes', () => {
    expect(
      serializeAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.session, 'selector.secret', {
        httpOnly: true,
        maxAgeSeconds: 900,
        sameSite: 'Lax',
      }),
    ).toBe(
      '__Host-cl_session=selector.secret; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=900',
    );
    expect(
      clearAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.csrf, {
        httpOnly: false,
        sameSite: 'Strict',
      }),
    ).toContain('__Host-cl_csrf=; Path=/; Secure; SameSite=Strict; Max-Age=0');
  });
});
