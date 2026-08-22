const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u;
const COOKIE_VALUE_PATTERN = /^[A-Za-z0-9._~-]{1,2048}$/u;

export const AUTHENTICATION_COOKIE_NAMES = Object.freeze({
  transaction: '__Host-cl_oidc_transaction',
  session: '__Host-cl_session',
  csrf: '__Host-cl_csrf',
});

export type AuthenticationSameSite = 'Lax' | 'Strict';

export interface AuthenticationCookieOptions {
  readonly httpOnly: boolean;
  readonly maxAgeSeconds: number;
  readonly sameSite: AuthenticationSameSite;
}

export class AuthenticationCookieError extends Error {
  constructor() {
    super('Invalid authentication cookie');
    this.name = 'AuthenticationCookieError';
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function assertCookieName(name: string): void {
  if (!COOKIE_NAME_PATTERN.test(name) || !name.startsWith('__Host-')) {
    throw new AuthenticationCookieError();
  }
}

function assertCookieValue(value: string): void {
  if (!COOKIE_VALUE_PATTERN.test(value)) {
    throw new AuthenticationCookieError();
  }
}

function singleHeaderValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new AuthenticationCookieError();
  if (value.length > 16_384 || containsControlCharacter(value)) {
    throw new AuthenticationCookieError();
  }
  return value;
}

/**
 * Reads one security-sensitive cookie without first/last-value ambiguity.
 * Unrelated cookies remain opaque, but malformed or duplicate occurrences of
 * the requested name fail closed.
 */
export function readUniqueAuthenticationCookie(cookieHeader: unknown, name: string): string | null {
  assertCookieName(name);
  const header = singleHeaderValue(cookieHeader);
  if (header === undefined || header === '') return null;

  let found: string | null = null;
  for (const rawPart of header.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;
    const separator = part.indexOf('=');
    if (separator < 1) {
      continue;
    }
    const candidateName = part.slice(0, separator).trim();
    if (candidateName !== name) continue;
    if (found !== null) throw new AuthenticationCookieError();
    const value = part.slice(separator + 1).trim();
    assertCookieValue(value);
    found = value;
  }
  return found;
}

export function assertUnambiguousAuthenticationHeaders(
  cookieHeader: unknown,
  authorizationHeader: unknown,
): string | null {
  const session = readUniqueAuthenticationCookie(cookieHeader, AUTHENTICATION_COOKIE_NAMES.session);
  if (authorizationHeader !== undefined) {
    if (typeof authorizationHeader !== 'string' || containsControlCharacter(authorizationHeader)) {
      throw new AuthenticationCookieError();
    }
    if (session !== null || authorizationHeader.trim() !== '') {
      throw new AuthenticationCookieError();
    }
  }
  return session;
}

export function serializeAuthenticationCookie(
  name: string,
  value: string,
  options: AuthenticationCookieOptions,
): string {
  assertCookieName(name);
  assertCookieValue(value);
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 1) {
    throw new AuthenticationCookieError();
  }
  return [
    `${name}=${value}`,
    'Path=/',
    'Secure',
    ...(options.httpOnly ? ['HttpOnly'] : []),
    `SameSite=${options.sameSite}`,
    `Max-Age=${options.maxAgeSeconds}`,
  ].join('; ');
}

export function clearAuthenticationCookie(
  name: string,
  options: Pick<AuthenticationCookieOptions, 'httpOnly' | 'sameSite'>,
): string {
  assertCookieName(name);
  return [
    `${name}=`,
    'Path=/',
    'Secure',
    ...(options.httpOnly ? ['HttpOnly'] : []),
    `SameSite=${options.sameSite}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}
