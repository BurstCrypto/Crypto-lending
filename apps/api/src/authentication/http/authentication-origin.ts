import {
  AUTHENTICATION_COOKIE_NAMES,
  AuthenticationCookieError,
  readUniqueAuthenticationCookie,
} from './authentication-cookies';

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_DEMO_HTTP_ORIGIN = 'http://127.0.0.1:3000';

export class AuthenticationCsrfError extends Error {
  constructor() {
    super('Invalid CSRF proof');
    this.name = 'AuthenticationCsrfError';
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function singleHeader(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || containsControlCharacter(value)) {
    throw new AuthenticationCsrfError();
  }
  return value;
}

export function canonicalAuthenticationOrigin(
  value: string,
  options: { readonly localDemo?: boolean } = {},
): string {
  if (value.length > 2048 || containsControlCharacter(value)) {
    throw new AuthenticationCsrfError();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthenticationCsrfError();
  }
  const permittedProtocol =
    parsed.protocol === 'https:' ||
    (options.localDemo === true && value === LOCAL_DEMO_HTTP_ORIGIN);
  if (
    !permittedProtocol ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.origin !== value
  ) {
    throw new AuthenticationCsrfError();
  }
  return parsed.origin;
}

export function canonicalHttpsOrigin(value: string): string {
  return canonicalAuthenticationOrigin(value);
}

/** Returns the session-bound CSRF value for unsafe methods and null for safe methods. */
export function requireAuthenticationCsrf(input: {
  readonly method: unknown;
  readonly originHeader: unknown;
  readonly csrfHeader: unknown;
  readonly cookieHeader: unknown;
  readonly expectedOrigin: string;
  readonly localDemo?: boolean;
}): string | null {
  if (typeof input.method !== 'string') throw new AuthenticationCsrfError();
  const method = input.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;

  const expectedOrigin = canonicalAuthenticationOrigin(input.expectedOrigin, {
    localDemo: input.localDemo === true,
  });
  const origin = singleHeader(input.originHeader);
  const csrfHeader = singleHeader(input.csrfHeader);
  let csrfCookie: string | null;
  try {
    csrfCookie = readUniqueAuthenticationCookie(
      input.cookieHeader,
      AUTHENTICATION_COOKIE_NAMES.csrf,
    );
  } catch (error) {
    if (error instanceof AuthenticationCookieError) throw new AuthenticationCsrfError();
    throw error;
  }

  if (
    origin !== expectedOrigin ||
    csrfHeader === undefined ||
    csrfCookie === null ||
    !CSRF_TOKEN_PATTERN.test(csrfHeader) ||
    !CSRF_TOKEN_PATTERN.test(csrfCookie) ||
    csrfHeader !== csrfCookie
  ) {
    throw new AuthenticationCsrfError();
  }
  return csrfHeader;
}
