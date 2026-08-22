const CALLBACK_VALUE_LIMITS = Object.freeze({
  code: 2048,
  state: 128,
  iss: 2048,
  error: 128,
});

export class AuthenticationCallbackError extends Error {
  constructor() {
    super('Invalid authentication callback');
    this.name = 'AuthenticationCallbackError';
  }
}

export interface SuccessfulAuthenticationCallback {
  readonly kind: 'success';
  readonly code: string;
  readonly state: string;
  readonly issuer?: string;
}

export interface FailedAuthenticationCallback {
  readonly kind: 'error';
  readonly error: string;
  readonly state: string;
  readonly issuer?: string;
}

export type AuthenticationCallback =
  SuccessfulAuthenticationCallback | FailedAuthenticationCallback;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function uniqueBoundedParameter(
  parameters: URLSearchParams,
  name: keyof typeof CALLBACK_VALUE_LIMITS,
  required: boolean,
): string | undefined {
  const values = parameters.getAll(name);
  if (values.length > 1 || (required && values.length !== 1)) {
    throw new AuthenticationCallbackError();
  }
  const value = values[0];
  if (value === undefined) return undefined;
  if (
    value.length < 1 ||
    value.length > CALLBACK_VALUE_LIMITS[name] ||
    containsControlCharacter(value)
  ) {
    throw new AuthenticationCallbackError();
  }
  return value;
}

export function parseAuthenticationCallback(originalUrl: unknown): AuthenticationCallback {
  if (
    typeof originalUrl !== 'string' ||
    originalUrl.length > 8192 ||
    containsControlCharacter(originalUrl)
  ) {
    throw new AuthenticationCallbackError();
  }
  let parsed: URL;
  try {
    parsed = new URL(originalUrl, 'https://authentication.invalid');
  } catch {
    throw new AuthenticationCallbackError();
  }
  if (parsed.hash !== '') throw new AuthenticationCallbackError();

  const code = uniqueBoundedParameter(parsed.searchParams, 'code', false);
  const error = uniqueBoundedParameter(parsed.searchParams, 'error', false);
  const state = uniqueBoundedParameter(parsed.searchParams, 'state', true);
  const issuer = uniqueBoundedParameter(parsed.searchParams, 'iss', false);

  if ((code === undefined) === (error === undefined) || state === undefined) {
    throw new AuthenticationCallbackError();
  }
  return code === undefined
    ? { kind: 'error', error: error as string, state, ...(issuer ? { issuer } : {}) }
    : { kind: 'success', code, state, ...(issuer ? { issuer } : {}) };
}

/** Prevents the post-login location from becoming an open redirect. */
export function parseLocalReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#') ||
    containsControlCharacter(value) ||
    /%(?:2f|5c|25(?:2f|5c))/iu.test(value)
  ) {
    throw new AuthenticationCallbackError();
  }
  let parsed: URL;
  try {
    parsed = new URL(value, 'https://authentication.invalid');
  } catch {
    throw new AuthenticationCallbackError();
  }
  if (
    parsed.origin !== 'https://authentication.invalid' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname.startsWith('//') ||
    parsed.pathname.includes('\\')
  ) {
    throw new AuthenticationCallbackError();
  }
  return `${parsed.pathname}${parsed.search}`;
}
