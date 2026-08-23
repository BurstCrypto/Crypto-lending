import { AuthenticationRejectedError, AuthenticationUnavailableError } from './errors';
import {
  type AuthenticationFetch,
  isAbortFailure,
  readBoundedJson,
  retryAfterSeconds,
} from './http';
import { buildAuthenticationLoginPath, safeAccountReturnPathOrDefault } from './return-path';
import { isAssignedCountryCode, isValidContactEmailInput } from './account-profile';

export const AUTHENTICATION_REGISTRATION_PATH = '/api/v1/auth/registration';
const AUTHORIZATION_RESPONSE_KEYS = new Set(['authorizationUrl']);
const REGISTRATION_INPUT_KEYS = new Set([
  'contactEmail',
  'contactPhone',
  'declaredResidencyCountryCode',
  'returnPath',
]);
const E164_PHONE = /^\+[1-9][0-9]{1,14}$/u;

export interface AuthenticationStartOptions {
  readonly fetch?: AuthenticationFetch;
  readonly signal?: AbortSignal;
}

export interface StartAuthenticationRegistrationInput {
  readonly contactEmail: string;
  readonly contactPhone?: string | null;
  readonly declaredResidencyCountryCode: string;
  readonly returnPath?: unknown;
}

function parseAuthorizationUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
    throw new AuthenticationUnavailableError();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthenticationUnavailableError();
  }
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';
  const localRuntime = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  if (
    (parsed.protocol !== 'https:' && !(localRuntime && parsed.protocol === 'http:' && loopback)) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    throw new AuthenticationUnavailableError();
  }
  return parsed.href;
}

function parseStartResult(value: unknown): string {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AuthenticationUnavailableError();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AuthenticationUnavailableError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !AUTHORIZATION_RESPONSE_KEYS.has(key),
      ) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor)) ||
      Object.keys(descriptors).length !== 1
    ) {
      throw new AuthenticationUnavailableError();
    }
    const authorizationUrl = descriptors.authorizationUrl;
    if (!authorizationUrl || !('value' in authorizationUrl)) {
      throw new AuthenticationUnavailableError();
    }
    return parseAuthorizationUrl(authorizationUrl.value);
  } catch (error) {
    if (error instanceof AuthenticationUnavailableError) throw error;
    throw new AuthenticationUnavailableError();
  }
}

function requestInit(
  method: 'GET' | 'POST',
  signal: AbortSignal | undefined,
  body?: string,
): RequestInit {
  return {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    redirect: 'error',
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal }),
  };
}

async function start(
  path: string,
  init: RequestInit,
  requestFetch: AuthenticationFetch,
  signal: AbortSignal | undefined,
): Promise<string> {
  let response: Response;
  try {
    response = await requestFetch(path, init);
  } catch (error) {
    if (isAbortFailure(error, signal)) throw error;
    throw new AuthenticationUnavailableError();
  }
  if (response.status === 400 || response.status === 401) {
    throw new AuthenticationRejectedError();
  }
  if (response.status !== 200) {
    throw new AuthenticationUnavailableError(retryAfterSeconds(response));
  }
  return parseStartResult(await readBoundedJson(response));
}

export async function startAuthenticationLogin(
  returnPath: unknown,
  options: AuthenticationStartOptions = {},
): Promise<string> {
  return start(
    buildAuthenticationLoginPath(returnPath),
    requestInit('GET', options.signal),
    options.fetch ?? globalThis.fetch,
    options.signal,
  );
}

export async function startAuthenticationRegistration(
  input: StartAuthenticationRegistrationInput,
  options: AuthenticationStartOptions = {},
): Promise<string> {
  let record: Record<string, unknown>;
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new AuthenticationRejectedError();
    }
    const prototype = Object.getPrototypeOf(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !REGISTRATION_INPUT_KEYS.has(key),
      ) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      throw new AuthenticationRejectedError();
    }
    record = Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error) {
    if (error instanceof AuthenticationRejectedError) throw error;
    throw new AuthenticationRejectedError();
  }

  if (
    !isValidContactEmailInput(record.contactEmail) ||
    (record.contactPhone !== undefined &&
      record.contactPhone !== null &&
      (typeof record.contactPhone !== 'string' || !E164_PHONE.test(record.contactPhone))) ||
    !isAssignedCountryCode(record.declaredResidencyCountryCode)
  ) {
    throw new AuthenticationRejectedError();
  }
  const returnPath = safeAccountReturnPathOrDefault(record.returnPath);
  const body = JSON.stringify({
    contactEmail: record.contactEmail,
    ...(record.contactPhone === undefined ? {} : { contactPhone: record.contactPhone }),
    declaredResidencyCountryCode: record.declaredResidencyCountryCode,
    returnPath,
  });
  return start(
    AUTHENTICATION_REGISTRATION_PATH,
    requestInit('POST', options.signal, body),
    options.fetch ?? globalThis.fetch,
    options.signal,
  );
}
