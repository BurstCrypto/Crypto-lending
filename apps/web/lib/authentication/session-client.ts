import { parseAccountProfile, type AccountProfile } from './account-profile';
import { AuthenticationUnauthenticatedError, AuthenticationUnavailableError } from './errors';
import { createRequestDeadline } from '../http/bounded-response';
import {
  type AuthenticationFetch,
  isAbortFailure,
  readBoundedJson,
  retryAfterSeconds,
} from './http';

export const AUTHENTICATION_ACCOUNT_PROFILE_PATH = '/api/v1/accounts/me';
export const AUTHENTICATION_LOGOUT_PATH = '/api/v1/auth/logout';
export const AUTHENTICATION_CSRF_COOKIE_NAME = '__Host-cl_csrf';
export const AUTHENTICATION_PROVIDER_LOGOUT_HEADER = 'X-Authentication-Provider-Logout';
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_PROVIDER_LOGOUT_URL_LENGTH = 4_096;

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

function providerLogoutUrl(response: Response): string | null {
  const value = response.headers.get(AUTHENTICATION_PROVIDER_LOGOUT_HEADER);
  if (
    value === null ||
    typeof window === 'undefined' ||
    value.length < 1 ||
    value.length > MAXIMUM_PROVIDER_LOGOUT_URL_LENGTH ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/logout' ||
      parsed.hash !== ''
    ) {
      return null;
    }

    const entries = [...parsed.searchParams.entries()];
    if (
      entries.length !== 2 ||
      entries[0]?.[0] !== 'client_id' ||
      entries[1]?.[0] !== 'logout_uri'
    ) {
      return null;
    }
    const clientId = entries[0][1];
    const logoutUri = entries[1][1];
    const expectedLogoutUri = new URL('/login', window.location.origin).href;
    if (!/^[\x21-\x7e]{1,256}$/u.test(clientId) || logoutUri !== expectedLogoutUri) return null;

    const canonical = new URL('/logout', parsed.origin);
    canonical.searchParams.set('client_id', clientId);
    canonical.searchParams.set('logout_uri', logoutUri);
    return canonical.href === value ? value : null;
  } catch {
    return null;
  }
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
  const request = createRequestDeadline(options.signal);
  try {
    let response: Response;
    try {
      response = await request.waitFor(
        requestFetch(
          AUTHENTICATION_ACCOUNT_PROFILE_PATH,
          requestInit('GET', request.signal, { Accept: 'application/json' }),
        ),
      );
    } catch (error) {
      if (request.didTimeout()) throw new AuthenticationUnavailableError();
      if (isAbortFailure(error, options.signal)) throw error;
      throw new AuthenticationUnavailableError();
    }

    if (response.status === 401) throw new AuthenticationUnauthenticatedError();
    if (response.status !== 200) {
      throw new AuthenticationUnavailableError(retryAfterSeconds(response));
    }
    try {
      return parseAccountProfile(await readBoundedJson(response, request.signal));
    } catch (error) {
      if (request.didTimeout()) throw new AuthenticationUnavailableError();
      if (options.signal?.aborted === true) throw error;
      if (error instanceof AuthenticationUnavailableError) throw error;
      throw new AuthenticationUnavailableError();
    }
  } finally {
    request.dispose();
  }
}

export async function logoutAuthenticationSession(
  options: LogoutAuthenticationSessionOptions = {},
): Promise<string | null> {
  const csrfToken = readAuthenticationCsrfToken(options.cookieHeader ?? browserCookieHeader());
  const requestFetch = options.fetch ?? globalThis.fetch;
  const request = createRequestDeadline(options.signal);
  try {
    let response: Response;
    try {
      response = await request.waitFor(
        requestFetch(
          AUTHENTICATION_LOGOUT_PATH,
          requestInit('POST', request.signal, {
            Accept: 'application/json',
            'X-CSRF-Token': csrfToken,
          }),
        ),
      );
    } catch (error) {
      if (request.didTimeout()) throw new AuthenticationUnavailableError();
      if (isAbortFailure(error, options.signal)) throw error;
      throw new AuthenticationUnavailableError();
    }

    if (response.status === 401) throw new AuthenticationUnauthenticatedError();
    if (response.status !== 204) {
      throw new AuthenticationUnavailableError(retryAfterSeconds(response));
    }
    return providerLogoutUrl(response);
  } finally {
    request.dispose();
  }
}

export type { AccountProfile, AuthenticationFetch };
