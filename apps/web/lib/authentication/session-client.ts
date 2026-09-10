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

interface SharedSessionRestoreFlight {
  readonly controller: AbortController;
  readonly consumers: Set<symbol>;
  readonly promise: Promise<AccountProfile>;
}

let sharedSessionRestoreFlight: SharedSessionRestoreFlight | null = null;

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
    const cognito = parsed.pathname === '/logout';
    const auth0 = parsed.pathname === '/v2/logout';
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      (!cognito && !auth0) ||
      parsed.hash !== ''
    ) {
      return null;
    }

    const entries = [...parsed.searchParams.entries()];
    const redirectParameter = auth0 ? 'returnTo' : 'logout_uri';
    if (
      entries.length !== 2 ||
      entries[0]?.[0] !== 'client_id' ||
      entries[1]?.[0] !== redirectParameter
    ) {
      return null;
    }
    const clientId = entries[0][1];
    const logoutUri = entries[1][1];
    const expectedLogoutUri = new URL('/login', window.location.origin).href;
    if (!/^[\x21-\x7e]{1,256}$/u.test(clientId) || logoutUri !== expectedLogoutUri) return null;

    const canonical = new URL(auth0 ? '/v2/logout' : '/logout', parsed.origin);
    canonical.searchParams.set('client_id', clientId);
    canonical.searchParams.set(redirectParameter, logoutUri);
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

async function requestAuthenticationSession(
  requestFetch: AuthenticationFetch,
  signal: AbortSignal | undefined,
): Promise<AccountProfile> {
  const request = createRequestDeadline(signal);
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
      if (isAbortFailure(error, signal)) throw error;
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
      if (signal?.aborted === true) throw error;
      if (error instanceof AuthenticationUnavailableError) throw error;
      throw new AuthenticationUnavailableError();
    }
  } finally {
    request.dispose();
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function createSharedSessionRestoreFlight(): SharedSessionRestoreFlight {
  const controller = new AbortController();
  const promise = requestAuthenticationSession(globalThis.fetch, controller.signal).finally(() => {
    if (sharedSessionRestoreFlight?.controller === controller) sharedSessionRestoreFlight = null;
  });
  return {
    controller,
    consumers: new Set(),
    promise,
  };
}

function releaseSharedSessionRestoreConsumer(
  flight: SharedSessionRestoreFlight,
  consumer: symbol,
  reason?: unknown,
): void {
  flight.consumers.delete(consumer);
  if (flight.consumers.size > 0 || sharedSessionRestoreFlight !== flight) return;
  sharedSessionRestoreFlight = null;
  if (!flight.controller.signal.aborted) {
    flight.controller.abort(reason ?? new DOMException('The operation was aborted.', 'AbortError'));
  }
}

function joinSharedSessionRestore(signal: AbortSignal | undefined): Promise<AccountProfile> {
  if (signal?.aborted === true) return Promise.reject(abortReason(signal));

  const flight = sharedSessionRestoreFlight ?? createSharedSessionRestoreFlight();
  sharedSessionRestoreFlight = flight;
  const consumer = Symbol('session-restore-consumer');
  flight.consumers.add(consumer);

  return new Promise<AccountProfile>((resolve, reject) => {
    let finished = false;
    const removeAbortListener = () => signal?.removeEventListener('abort', handleAbort);
    const finish = (complete: () => void, reason?: unknown) => {
      if (finished) return;
      finished = true;
      removeAbortListener();
      releaseSharedSessionRestoreConsumer(flight, consumer, reason);
      complete();
    };
    const handleAbort = () => {
      const reason = abortReason(signal!);
      finish(() => reject(reason), reason);
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    void flight.promise.then(
      (profile) => finish(() => resolve(profile)),
      (error: unknown) => finish(() => reject(error), error),
    );
  });
}

/**
 * Coalesces only concurrent browser calls using the default fetch implementation. Results are
 * never cached, and each caller retains independent cancellation. Injected fetches stay isolated.
 */
export function restoreAuthenticationSession(
  options: RestoreAuthenticationSessionOptions = {},
): Promise<AccountProfile> {
  if (options.fetch !== undefined || typeof window === 'undefined') {
    return requestAuthenticationSession(options.fetch ?? globalThis.fetch, options.signal);
  }
  return joinSharedSessionRestore(options.signal);
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
