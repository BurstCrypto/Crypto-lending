import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import {
  AuthenticationDomainError,
  parseOidcProviderKey,
  parseOidcSubject,
  parseOpaqueAuthenticationSecret,
  parsePkceVerifier,
  parsePreAuthenticationTransactionCookiePayload,
  type OidcProviderKey,
  type OidcSubject,
  type OpaqueAuthenticationSecret,
  type PkceVerifier,
  type PreAuthenticationTransactionCookiePayload,
} from '../../domain/authentication';

export type AuthenticationKeyPurpose =
  'csrf-hmac' | 'identity-hmac' | 'preauth-seal' | 'session-hmac';
export type AuthenticationDigestPurpose = 'csrf' | 'oidc-state' | 'rate-limit' | 'session';
export type AuthenticationOpaqueSecretPurpose =
  'browser-binding' | 'csrf' | 'oidc-nonce' | 'oidc-state' | 'session';
export type AuthenticationOpaqueDigestPurpose = Extract<
  AuthenticationOpaqueSecretPurpose,
  'browser-binding' | 'oidc-nonce' | 'oidc-state'
>;

declare const authenticationKeyBrand: unique symbol;
declare const sensitiveTextBrand: unique symbol;
declare const authenticationDigestBrand: unique symbol;

export interface AuthenticationKey<Purpose extends AuthenticationKeyPurpose> {
  readonly keyId: string;
  readonly purpose: Purpose;
  readonly [authenticationKeyBrand]: true;
}

export interface SensitiveAuthenticationText<Purpose extends string> {
  readonly [sensitiveTextBrand]: Purpose;
}

export type AuthenticationDigest<Purpose extends string> = string & {
  readonly [authenticationDigestBrand]: Purpose;
};

const keyBytes = new WeakMap<object, Buffer>();
const sensitiveTextValues = new WeakMap<object, string>();
const KEY_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;
const SEALED_COOKIE_PATTERN =
  /^v1\.([a-z][a-z0-9_-]{0,31})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{1,4096})\.([A-Za-z0-9_-]{22})$/u;
const MAX_PREAUTH_PLAINTEXT_BYTES = 1_400;
const MAX_SEALED_COOKIE_LENGTH = 2_048;
const PREAUTH_AAD_PREFIX = 'crypto-lending:authentication:preauth-cookie:v1:';
const OPAQUE_SECRET_PURPOSES = new Set<AuthenticationOpaqueSecretPurpose>([
  'browser-binding',
  'csrf',
  'oidc-nonce',
  'oidc-state',
  'session',
]);
const OPAQUE_DIGEST_PURPOSES = new Set<AuthenticationOpaqueDigestPurpose>([
  'browser-binding',
  'oidc-nonce',
  'oidc-state',
]);

export class AuthenticationCryptoError extends Error {
  readonly code = 'AUTHENTICATION_CRYPTO_ERROR' as const;

  constructor() {
    super('Authentication cryptographic operation failed');
    this.name = 'AuthenticationCryptoError';
  }
}

function decodeCanonicalKey(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length !== 43 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new AuthenticationCryptoError();
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
      throw new AuthenticationCryptoError();
    }
    return decoded;
  } catch {
    throw new AuthenticationCryptoError();
  }
}

export function createAuthenticationKey<Purpose extends AuthenticationKeyPurpose>(
  purpose: Purpose,
  keyId: string,
  encodedKey: unknown,
): AuthenticationKey<Purpose> {
  if (!KEY_ID_PATTERN.test(keyId)) throw new AuthenticationCryptoError();
  const bytes = decodeCanonicalKey(encodedKey);
  const key = Object.freeze({ keyId, purpose }) as AuthenticationKey<Purpose>;
  keyBytes.set(key, bytes);
  return key;
}

function revealKey<Purpose extends AuthenticationKeyPurpose>(
  key: AuthenticationKey<Purpose>,
  expectedPurpose: Purpose,
): Buffer {
  try {
    if (
      !key ||
      typeof key !== 'object' ||
      !Object.isFrozen(key) ||
      key.purpose !== expectedPurpose ||
      !KEY_ID_PATTERN.test(key.keyId)
    ) {
      throw new AuthenticationCryptoError();
    }
    const bytes = keyBytes.get(key);
    if (!bytes || bytes.length !== 32) throw new AuthenticationCryptoError();
    return bytes;
  } catch {
    throw new AuthenticationCryptoError();
  }
}

export function createSensitiveAuthenticationText<Purpose extends string>(
  purpose: Purpose,
  value: unknown,
): SensitiveAuthenticationText<Purpose> {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 4_096 ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new AuthenticationCryptoError();
  }
  const secret = Object.freeze(Object.create(null)) as SensitiveAuthenticationText<Purpose>;
  sensitiveTextValues.set(secret, value);
  return secret;
}

export function revealSensitiveAuthenticationText<Purpose extends string>(
  secret: SensitiveAuthenticationText<Purpose>,
): string {
  try {
    if (
      !secret ||
      typeof secret !== 'object' ||
      Object.getPrototypeOf(secret) !== null ||
      !Object.isFrozen(secret) ||
      Reflect.ownKeys(secret).length !== 0
    ) {
      throw new AuthenticationCryptoError();
    }
    const value = sensitiveTextValues.get(secret);
    if (value === undefined) throw new AuthenticationCryptoError();
    return value;
  } catch {
    throw new AuthenticationCryptoError();
  }
}

export function generateOpaqueAuthenticationSecret<
  Purpose extends AuthenticationOpaqueSecretPurpose,
>(purpose: Purpose): OpaqueAuthenticationSecret<Purpose> {
  if (!OPAQUE_SECRET_PURPOSES.has(purpose)) throw new AuthenticationCryptoError();
  return parseOpaqueAuthenticationSecret<Purpose>(randomBytes(32).toString('base64url'));
}

export function generatePkceVerifier(): PkceVerifier {
  return parsePkceVerifier(randomBytes(32).toString('base64url'));
}

export function createPkceS256Challenge(verifier: PkceVerifier): string {
  try {
    return createHash('sha256').update(parsePkceVerifier(verifier), 'ascii').digest('base64url');
  } catch {
    throw new AuthenticationCryptoError();
  }
}

export function digestOpaqueAuthenticationSecret<Purpose extends AuthenticationOpaqueDigestPurpose>(
  purpose: Purpose,
  secret: OpaqueAuthenticationSecret<Purpose>,
): AuthenticationDigest<Purpose> {
  try {
    if (!OPAQUE_DIGEST_PURPOSES.has(purpose)) throw new AuthenticationCryptoError();
    return createHash('sha256')
      .update(`crypto-lending:authentication:opaque-digest:v1:${purpose}:`, 'utf8')
      .update(parseOpaqueAuthenticationSecret<Purpose>(secret), 'ascii')
      .digest('hex') as AuthenticationDigest<Purpose>;
  } catch {
    throw new AuthenticationCryptoError();
  }
}

export function createKeyedAuthenticationDigest<
  Purpose extends AuthenticationDigestPurpose,
  KeyPurpose extends Extract<AuthenticationKeyPurpose, 'csrf-hmac' | 'session-hmac'>,
>(
  purpose: Purpose,
  key: AuthenticationKey<KeyPurpose>,
  value: unknown,
): AuthenticationDigest<Purpose> {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 4_096 ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new AuthenticationCryptoError();
  }
  if (
    (purpose === 'csrf' && key.purpose !== 'csrf-hmac') ||
    (purpose !== 'csrf' && key.purpose !== 'session-hmac')
  ) {
    throw new AuthenticationCryptoError();
  }
  const bytes = revealKey(key, key.purpose);
  return createHmac('sha256', bytes)
    .update(`crypto-lending:authentication:keyed-digest:v1:${purpose}:`, 'utf8')
    .update(value, 'utf8')
    .digest('hex') as AuthenticationDigest<Purpose>;
}

export function createOidcIdentityDigest(
  key: AuthenticationKey<'identity-hmac'>,
  providerKey: OidcProviderKey,
  issuer: string,
  subject: OidcSubject,
): AuthenticationDigest<'oidc-identity'> {
  if (
    typeof issuer !== 'string' ||
    issuer.length < 1 ||
    issuer.length > 2_048 ||
    /[\0\r\n]/u.test(issuer)
  ) {
    throw new AuthenticationCryptoError();
  }
  const normalizedProvider = parseOidcProviderKey(providerKey);
  const exactSubject = parseOidcSubject(subject);
  return createHmac('sha256', revealKey(key, 'identity-hmac'))
    .update('crypto-lending:authentication:oidc-identity:v1\0', 'utf8')
    .update(normalizedProvider, 'ascii')
    .update('\0', 'ascii')
    .update(issuer, 'utf8')
    .update('\0', 'ascii')
    .update(exactSubject, 'ascii')
    .digest('hex') as AuthenticationDigest<'oidc-identity'>;
}

function parseBase64UrlSegment(value: string, expectedBytes?: number): Buffer {
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new AuthenticationCryptoError();
  }
  return decoded;
}

export function sealPreAuthenticationTransactionCookie(
  payload: PreAuthenticationTransactionCookiePayload,
  key: AuthenticationKey<'preauth-seal'>,
): string {
  try {
    const parsed = parsePreAuthenticationTransactionCookiePayload(payload);
    const plaintext = Buffer.from(JSON.stringify(parsed), 'utf8');
    if (plaintext.length > MAX_PREAUTH_PLAINTEXT_BYTES) {
      throw new AuthenticationCryptoError();
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', revealKey(key, 'preauth-seal'), iv, {
      authTagLength: 16,
    });
    cipher.setAAD(Buffer.from(`${PREAUTH_AAD_PREFIX}${key.keyId}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const sealed = [
      'v1',
      key.keyId,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
    if (sealed.length > MAX_SEALED_COOKIE_LENGTH) throw new AuthenticationCryptoError();
    return sealed;
  } catch {
    throw new AuthenticationCryptoError();
  }
}

export function openPreAuthenticationTransactionCookie(
  sealed: unknown,
  keys: readonly AuthenticationKey<'preauth-seal'>[],
  nowEpochSeconds: number,
  maximumLifetimeSeconds = 900,
): PreAuthenticationTransactionCookiePayload {
  try {
    if (
      typeof sealed !== 'string' ||
      sealed.length < 1 ||
      sealed.length > MAX_SEALED_COOKIE_LENGTH ||
      !Array.isArray(keys) ||
      keys.length < 1 ||
      keys.length > 8 ||
      !Number.isSafeInteger(nowEpochSeconds) ||
      nowEpochSeconds < 0
    ) {
      throw new AuthenticationCryptoError();
    }
    const seenKeyIds = new Set<string>();
    for (const candidate of keys) {
      revealKey(candidate, 'preauth-seal');
      if (seenKeyIds.has(candidate.keyId)) throw new AuthenticationCryptoError();
      seenKeyIds.add(candidate.keyId);
    }
    const match = SEALED_COOKIE_PATTERN.exec(sealed);
    if (!match) throw new AuthenticationCryptoError();
    const [, keyId, encodedIv, encodedCiphertext, encodedTag] = match;
    if (!keyId || !encodedIv || !encodedCiphertext || !encodedTag) {
      throw new AuthenticationCryptoError();
    }
    const key = keys.find((candidate) => candidate.keyId === keyId);
    if (!key) throw new AuthenticationCryptoError();
    const iv = parseBase64UrlSegment(encodedIv, 12);
    const ciphertext = parseBase64UrlSegment(encodedCiphertext);
    const tag = parseBase64UrlSegment(encodedTag, 16);
    if (ciphertext.length < 1 || ciphertext.length > MAX_PREAUTH_PLAINTEXT_BYTES) {
      throw new AuthenticationCryptoError();
    }
    const decipher = createDecipheriv('aes-256-gcm', revealKey(key, 'preauth-seal'), iv, {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(`${PREAUTH_AAD_PREFIX}${keyId}`, 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length > MAX_PREAUTH_PLAINTEXT_BYTES) {
      throw new AuthenticationCryptoError();
    }
    const payload = parsePreAuthenticationTransactionCookiePayload(
      JSON.parse(plaintext.toString('utf8')) as unknown,
      maximumLifetimeSeconds,
    );
    if (
      nowEpochSeconds < payload.issuedAtEpochSeconds ||
      nowEpochSeconds >= payload.expiresAtEpochSeconds
    ) {
      throw new AuthenticationCryptoError();
    }
    return payload;
  } catch {
    throw new AuthenticationCryptoError();
  }
}

export function constantTimeAuthenticationValueEquals(left: unknown, right: unknown): boolean {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    left.length > 4_096 ||
    right.length > 4_096
  ) {
    return false;
  }
  try {
    const leftBytes = Buffer.from(left, 'utf8');
    const rightBytes = Buffer.from(right, 'utf8');
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
  } catch {
    return false;
  }
}

export function isAuthenticationDomainError(error: unknown): error is AuthenticationDomainError {
  return error instanceof AuthenticationDomainError;
}
