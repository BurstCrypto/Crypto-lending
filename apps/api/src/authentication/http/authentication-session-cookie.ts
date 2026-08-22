import {
  parseOpaqueAuthenticationSecret,
  type OpaqueAuthenticationSecret,
} from '../domain/authentication';

const SESSION_CREDENTIAL_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/u;

export interface AuthenticationSessionCookieCredential {
  readonly credentialId: string;
  readonly secret: OpaqueAuthenticationSecret<'session'>;
}

export class AuthenticationSessionCookieError extends Error {
  constructor() {
    super('Invalid authentication session');
    this.name = 'AuthenticationSessionCookieError';
  }
}

export function parseAuthenticationSessionCookie(
  value: unknown,
): AuthenticationSessionCookieCredential {
  if (typeof value !== 'string' || value.length > 128) {
    throw new AuthenticationSessionCookieError();
  }
  const match = SESSION_CREDENTIAL_PATTERN.exec(value);
  const credentialId = match?.[1];
  const encodedSecret = match?.[2];
  if (!credentialId || !encodedSecret) throw new AuthenticationSessionCookieError();
  try {
    return Object.freeze({
      credentialId,
      secret: parseOpaqueAuthenticationSecret<'session'>(encodedSecret),
    });
  } catch {
    throw new AuthenticationSessionCookieError();
  }
}

export function formatAuthenticationSessionCookie(
  credentialId: string,
  secret: OpaqueAuthenticationSecret<'session'>,
): string {
  return `${parseAuthenticationSessionCookie(`${credentialId}.${secret}`).credentialId}.${secret}`;
}
