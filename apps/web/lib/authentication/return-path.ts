const MAX_RETURN_PATH_LENGTH = 512;
const ACCOUNT_PATH = '/account';
const FORBIDDEN_ENCODED_PATH_CHARACTER = /%(?:25)*(?:2f|5c)/iu;
const FORBIDDEN_ENCODED_CONTROL = /%(?:25)*(?:0[0-9a-f]|1[0-9a-f]|7f)/iu;
const LOOP_QUERY_KEYS = new Set([
  'callback',
  'continue',
  'next',
  'redirect',
  'redirectto',
  'returnpath',
  'returnto',
]);

export const DEFAULT_AUTHENTICATED_RETURN_PATH = ACCOUNT_PATH;
export const AUTHENTICATION_LOGIN_PATH = '/api/v1/auth/login';

export class AuthenticationReturnPathError extends Error {
  constructor() {
    super('Invalid authentication return path');
    this.name = 'AuthenticationReturnPathError';
  }
}

function reject(): never {
  throw new AuthenticationReturnPathError();
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function assertDecodedLayersSafe(value: string): void {
  let candidate = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (hasControlCharacter(candidate) || candidate.includes('\\') || candidate.startsWith('//')) {
      reject();
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      reject();
    }
    if (decoded === candidate) return;
    candidate = decoded;
  }

  if (hasControlCharacter(candidate) || candidate.includes('\\') || candidate.startsWith('//')) {
    reject();
  }
}

/**
 * Accepts only the protected account route family. This deliberately cannot be
 * reused as an arbitrary local redirect validator.
 */
export function parseSafeAccountReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_RETURN_PATH_LENGTH ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('#') ||
    value.includes('\\') ||
    hasControlCharacter(value) ||
    FORBIDDEN_ENCODED_PATH_CHARACTER.test(value) ||
    FORBIDDEN_ENCODED_CONTROL.test(value)
  ) {
    reject();
  }
  assertDecodedLayersSafe(value);

  let parsed: URL;
  try {
    parsed = new URL(value, 'https://authentication.invalid');
  } catch {
    return reject();
  }

  if (
    parsed.origin !== 'https://authentication.invalid' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    (parsed.pathname !== ACCOUNT_PATH && !parsed.pathname.startsWith(`${ACCOUNT_PATH}/`))
  ) {
    reject();
  }

  for (const key of parsed.searchParams.keys()) {
    if (LOOP_QUERY_KEYS.has(key.toLowerCase().replace(/[-_]/gu, ''))) reject();
  }

  const canonical = `${parsed.pathname}${parsed.search}`;
  if (canonical.length > MAX_RETURN_PATH_LENGTH || canonical !== value) reject();
  return canonical;
}

export function safeAccountReturnPathOrDefault(value: unknown): string {
  try {
    return parseSafeAccountReturnPath(value);
  } catch (error) {
    if (error instanceof AuthenticationReturnPathError) {
      return DEFAULT_AUTHENTICATED_RETURN_PATH;
    }
    throw error;
  }
}

export function buildAuthenticationLoginPath(value?: unknown): string {
  const returnPath = safeAccountReturnPathOrDefault(value);
  return `${AUTHENTICATION_LOGIN_PATH}?returnTo=${encodeURIComponent(returnPath)}`;
}
