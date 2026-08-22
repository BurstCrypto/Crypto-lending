import {
  normalizeContactEmail,
  normalizeContactPhone,
  normalizeDeclaredResidencyCountryCode,
} from '../../accounts/domain/account-profile';

const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;
const OIDC_SUBJECT_PATTERN = /^[\x21-\x7e]{1,255}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;

declare const providerKeyBrand: unique symbol;
declare const oidcSubjectBrand: unique symbol;
declare const opaqueSecretBrand: unique symbol;
declare const pkceVerifierBrand: unique symbol;

export type OidcProviderKey = string & { readonly [providerKeyBrand]: true };
export type OidcSubject = string & { readonly [oidcSubjectBrand]: true };
export type OpaqueAuthenticationSecret<Purpose extends string> = string & {
  readonly [opaqueSecretBrand]: Purpose;
};
export type PkceVerifier = string & { readonly [pkceVerifierBrand]: true };
export type AuthenticationFlow = 'login' | 'registration';

export class AuthenticationDomainError extends Error {
  readonly code = 'AUTHENTICATION_VALUE_INVALID' as const;

  constructor() {
    super('Authentication value is invalid');
    this.name = 'AuthenticationDomainError';
  }
}

export function parseOidcProviderKey(value: unknown): OidcProviderKey {
  if (typeof value !== 'string' || !PROVIDER_KEY_PATTERN.test(value)) {
    throw new AuthenticationDomainError();
  }
  return value as OidcProviderKey;
}

/** OIDC `sub` is case-sensitive and is never normalized or used as display data. */
export function parseOidcSubject(value: unknown): OidcSubject {
  if (typeof value !== 'string' || !OIDC_SUBJECT_PATTERN.test(value)) {
    throw new AuthenticationDomainError();
  }
  return value as OidcSubject;
}

export function parseOpaqueAuthenticationSecret<Purpose extends string>(
  value: unknown,
): OpaqueAuthenticationSecret<Purpose> {
  if (typeof value !== 'string' || !OPAQUE_SECRET_PATTERN.test(value)) {
    throw new AuthenticationDomainError();
  }
  return value as OpaqueAuthenticationSecret<Purpose>;
}

export function parsePkceVerifier(value: unknown): PkceVerifier {
  if (typeof value !== 'string' || !PKCE_VERIFIER_PATTERN.test(value)) {
    throw new AuthenticationDomainError();
  }
  return value as PkceVerifier;
}

export function parseAuthenticationTransactionId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new AuthenticationDomainError();
  }
  return value;
}

export function parseAuthenticationFlow(value: unknown): AuthenticationFlow {
  if (value !== 'login' && value !== 'registration') {
    throw new AuthenticationDomainError();
  }
  return value;
}

export interface PreAuthenticationTransactionCookiePayload {
  readonly version: 1;
  readonly transactionId: string;
  readonly flow: AuthenticationFlow;
  readonly state: OpaqueAuthenticationSecret<'oidc-state'>;
  readonly browserBinding: OpaqueAuthenticationSecret<'browser-binding'>;
  readonly nonce: OpaqueAuthenticationSecret<'oidc-nonce'>;
  readonly codeVerifier: PkceVerifier;
  readonly returnPath: string;
  readonly registration?: PreAuthenticationRegistrationPayload;
  readonly issuedAtEpochSeconds: number;
  readonly expiresAtEpochSeconds: number;
}

export interface PreAuthenticationRegistrationPayload {
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly declaredResidencyCountryCode: string;
}

const PRE_AUTH_COOKIE_KEYS = new Set([
  'version',
  'transactionId',
  'flow',
  'state',
  'browserBinding',
  'nonce',
  'codeVerifier',
  'returnPath',
  'registration',
  'issuedAtEpochSeconds',
  'expiresAtEpochSeconds',
]);

const REGISTRATION_KEYS = new Set(['contactEmail', 'contactPhone', 'declaredResidencyCountryCode']);

function parseLocalReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#') ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    }) ||
    /%(?:2f|5c|25(?:2f|5c))/iu.test(value)
  ) {
    throw new AuthenticationDomainError();
  }
  try {
    const parsed = new URL(value, 'https://authentication.invalid');
    if (
      parsed.origin !== 'https://authentication.invalid' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      !parsed.pathname.startsWith('/') ||
      parsed.pathname.startsWith('//') ||
      parsed.pathname.includes('\\')
    ) {
      throw new AuthenticationDomainError();
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    throw new AuthenticationDomainError();
  }
}

function parseRegistration(value: unknown): PreAuthenticationRegistrationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthenticationDomainError();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AuthenticationDomainError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => typeof key !== 'string' || !REGISTRATION_KEYS.has(key),
    ) ||
    Object.values(descriptors).some((descriptor) => !('value' in descriptor))
  ) {
    throw new AuthenticationDomainError();
  }
  const contactEmail = descriptors.contactEmail;
  const contactPhone = descriptors.contactPhone;
  const countryCode = descriptors.declaredResidencyCountryCode;
  if (
    !contactEmail ||
    !('value' in contactEmail) ||
    !contactPhone ||
    !('value' in contactPhone) ||
    !countryCode ||
    !('value' in countryCode)
  ) {
    throw new AuthenticationDomainError();
  }
  try {
    const normalizedPhone = normalizeContactPhone(contactPhone.value);
    if (normalizedPhone === undefined) throw new AuthenticationDomainError();
    return Object.freeze({
      contactEmail: normalizeContactEmail(contactEmail.value),
      contactPhone: normalizedPhone,
      declaredResidencyCountryCode: normalizeDeclaredResidencyCountryCode(countryCode.value),
    });
  } catch {
    throw new AuthenticationDomainError();
  }
}

function ownDataRecord(value: unknown): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AuthenticationDomainError();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AuthenticationDomainError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !PRE_AUTH_COOKIE_KEYS.has(key),
      ) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      throw new AuthenticationDomainError();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ('value' in descriptor) record[key] = descriptor.value;
    }
    return record;
  } catch {
    throw new AuthenticationDomainError();
  }
}

function epochSeconds(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AuthenticationDomainError();
  }
  return value as number;
}

export function parsePreAuthenticationTransactionCookiePayload(
  value: unknown,
  maximumLifetimeSeconds = 900,
): PreAuthenticationTransactionCookiePayload {
  if (
    !Number.isSafeInteger(maximumLifetimeSeconds) ||
    maximumLifetimeSeconds < 1 ||
    maximumLifetimeSeconds > 3_600
  ) {
    throw new AuthenticationDomainError();
  }
  const record = ownDataRecord(value);
  if (record.version !== 1) throw new AuthenticationDomainError();
  const issuedAtEpochSeconds = epochSeconds(record.issuedAtEpochSeconds);
  const expiresAtEpochSeconds = epochSeconds(record.expiresAtEpochSeconds);
  if (
    expiresAtEpochSeconds <= issuedAtEpochSeconds ||
    expiresAtEpochSeconds - issuedAtEpochSeconds > maximumLifetimeSeconds
  ) {
    throw new AuthenticationDomainError();
  }
  const flow = parseAuthenticationFlow(record.flow);
  const registration =
    record.registration === undefined ? undefined : parseRegistration(record.registration);
  if ((flow === 'registration') !== (registration !== undefined)) {
    throw new AuthenticationDomainError();
  }
  return Object.freeze({
    version: 1,
    transactionId: parseAuthenticationTransactionId(record.transactionId),
    flow,
    state: parseOpaqueAuthenticationSecret<'oidc-state'>(record.state),
    browserBinding: parseOpaqueAuthenticationSecret<'browser-binding'>(record.browserBinding),
    nonce: parseOpaqueAuthenticationSecret<'oidc-nonce'>(record.nonce),
    codeVerifier: parsePkceVerifier(record.codeVerifier),
    returnPath: parseLocalReturnPath(record.returnPath),
    ...(registration ? { registration } : {}),
    issuedAtEpochSeconds,
    expiresAtEpochSeconds,
  });
}

export interface VerifiedOidcIdentity {
  readonly providerKey: OidcProviderKey;
  readonly issuer: string;
  readonly subject: OidcSubject;
  readonly issuedAtEpochSeconds: number;
  readonly expiresAtEpochSeconds: number;
}
