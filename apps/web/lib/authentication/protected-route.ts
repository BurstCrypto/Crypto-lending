import { safeAccountReturnPathOrDefault } from './return-path';

export const AUTHENTICATION_SESSION_COOKIE_NAME = '__Host-cl_session';

const MAXIMUM_COOKIE_HEADER_LENGTH = 16_384;
const SESSION_CREDENTIAL_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u;

export type ProtectedAccountShellDecision =
  | {
      readonly kind: 'render-shell';
      /**
       * This is only a syntactic browser hint. The account client must verify
       * the cookie-backed session with `GET /api/v1/accounts/me` before it
       * renders protected account data or enables protected actions.
       */
      readonly reason: 'session-cookie-hint-present';
    }
  | {
      readonly kind: 'redirect-to-login';
      readonly reason: 'session-cookie-hint-absent-or-invalid';
      readonly returnPath: string;
    };

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

/**
 * Reads the raw Cookie header so duplicate security-cookie names cannot be
 * collapsed by a convenience cookie API. A matching value is deliberately
 * only a shell-rendering hint; it is not proof of an authenticated session.
 */
export function hasUniqueValidSessionCookieHint(cookieHeader: unknown): boolean {
  if (cookieHeader === null || cookieHeader === undefined || cookieHeader === '') return false;
  if (
    typeof cookieHeader !== 'string' ||
    cookieHeader.length > MAXIMUM_COOKIE_HEADER_LENGTH ||
    containsControlCharacter(cookieHeader)
  ) {
    return false;
  }

  let sessionValue: string | null = null;
  for (const rawPart of cookieHeader.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;

    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== AUTHENTICATION_SESSION_COOKIE_NAME) continue;

    if (sessionValue !== null) return false;
    sessionValue = part.slice(separator + 1).trim();
  }

  return sessionValue !== null && SESSION_CREDENTIAL_PATTERN.test(sessionValue);
}

export function decideProtectedAccountShell(input: {
  readonly cookieHeader: unknown;
  readonly requestUrl: URL;
}): ProtectedAccountShellDecision {
  if (hasUniqueValidSessionCookieHint(input.cookieHeader)) {
    return { kind: 'render-shell', reason: 'session-cookie-hint-present' };
  }

  return {
    kind: 'redirect-to-login',
    reason: 'session-cookie-hint-absent-or-invalid',
    returnPath: safeAccountReturnPathOrDefault(
      `${input.requestUrl.pathname}${input.requestUrl.search}`,
    ),
  };
}
