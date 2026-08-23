import { parseAccountProfile, type AccountProfile } from './account-profile';
import { AuthenticationUnauthenticatedError, AuthenticationUnavailableError } from './errors';
import {
  type AuthenticationFetch,
  isAbortFailure,
  readBoundedJson,
  retryAfterSeconds,
} from './http';

export const AUTHENTICATION_ACCOUNT_PROFILE_PATH = '/api/v1/accounts/me';
export const AUTHENTICATION_LOGOUT_PATH = '/api/v1/auth/logout';
export const AUTHENTICATION_CSRF_COOKIE_NAME = '__Host-cl_csrf';
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/u;

export interface RestoreAuthenticationSessionOptions {
  readonly fetch?: AuthenticationFetch;
  readonly signal?: AbortSignal;
}

export interface LogoutAuthenticationSessionOptions {
  readonly cookieHeader?: string;
  readonly fetch?: AuthenticationFetch;
  readonly signal?: AbortSignal;
}

function requestInit(
  method: 'GET' | 'POST',
  signal: AbortSignal | undefined,
  headers: Readonly<Record<string, string>>,
): RequestInit {
  return {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers,
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  };
}

function browserCookieHeader(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

export function readAuthenticationCsrfToken(cookieHeader: unknown): string {
  if (
    typeof cookieHeader !== 'string' ||
    cookieHeader.length > 16_384 ||
    [...cookieHeader].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new AuthenticationUnauthenticatedError();
  }

  let found: string | undefined;
  for (const part of cookieHeader.split(';')) {
    const candidate = part.trim();
    const separator = candidate.indexOf('=');
    if (separator < 1 || candidate.slice(0, separator).trim() !== AUTHENTICATION_CSRF_COOKIE_NAME) {
      continue;
    }
    if (found !== undefined) throw new AuthenticationUnauthenticatedError();
    const value = candidate.slice(separator + 1).trim();
    if (!CSRF_TOKEN.test(value)) throw new AuthenticationUnauthenticatedError();
    found = value;
  }
  if (found === undefined) throw new AuthenticationUnauthenticatedError();
  return found;
}

export async function restoreAuthenticationSession(
  options: RestoreAuthenticationSessionOptions = {},
): Promise<AccountProfile> {
  const requestFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await requestFetch(
      AUTHENTICATION_ACCOUNT_PROFILE_PATH,
      requestInit('GET', options.signal, { Accept: 'application/json' }),
    );
  } catch (error) {
    if (isAbortFailure(error, options.signal)) throw error;
    throw new AuthenticationUnavailableError();
  }

  if (response.status === 401) throw new AuthenticationUnauthenticatedError();
  if (response.status !== 200) {
    throw new AuthenticationUnavailableError(retryAfterSeconds(response));
  }
  return parseAccountProfile(await readBoundedJson(response));
}

export async function logoutAuthenticationSession(
  options: LogoutAuthenticationSessionOptions = {},
): Promise<void> {
  const csrfToken = readAuthenticationCsrfToken(options.cookieHeader ?? browserCookieHeader());
  const requestFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await requestFetch(
      AUTHENTICATION_LOGOUT_PATH,
      requestInit('POST', options.signal, {
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken,
      }),
    );
  } catch (error) {
    if (isAbortFailure(error, options.signal)) throw error;
    throw new AuthenticationUnavailableError();
  }

  if (response.status === 401) throw new AuthenticationUnauthenticatedError();
  if (response.status !== 204) {
    throw new AuthenticationUnavailableError(retryAfterSeconds(response));
  }
}

export type { AccountProfile, AuthenticationFetch };
