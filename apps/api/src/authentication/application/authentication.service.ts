import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  normalizeContactEmail,
  normalizeContactPhone,
  normalizeDeclaredResidencyCountryCode,
  parseAccountId,
  type ProvisionAccountProfileInput,
} from '../../accounts/domain/account-profile';
import { loggingContext } from '../../infrastructure/logging';
import type { AuthenticationCallback } from '../http/authentication-callback';
import { parseLocalReturnPath } from '../http/authentication-callback';
import { assertUnambiguousAuthenticationHeaders } from '../http/authentication-cookies';
import { requireAuthenticationCsrf } from '../http/authentication-origin';
import {
  formatAuthenticationSessionCookie,
  parseAuthenticationSessionCookie,
} from '../http/authentication-session-cookie';
import type {
  AuthenticationFlow,
  PreAuthenticationRegistrationPayload,
} from '../domain/authentication';
import {
  AuthenticationRejectedError,
  AuthenticationRateLimitedError,
  AuthenticationUnavailableError,
  ClaimedAuthenticationRejectedError,
  ClaimedAuthenticationUnavailableError,
} from './authentication.errors';
import {
  AUTHENTICATION_RATE_LIMITER,
  type AuthenticationRateLimiterPort,
  type AuthenticationRateLimitScope,
} from './ports/authentication-rate-limiter.port';
import {
  AUTHENTICATION_DIGEST_VERSION,
  AUTHENTICATION_REPOSITORY,
  type AuthenticationDigestReference,
  type AuthenticationRepositoryPort,
  type ClaimedAuthenticationRejectionReason,
} from './ports/authentication-repository.port';
import { OIDC_CLIENT, type OidcClientPort } from './ports/oidc-client.port';
import {
  AUTHENTICATION_CONFIG,
  type RuntimeAuthenticationConfig,
} from '../infrastructure/config/authentication-config.provider';
import type { OidcAuthenticationConfig } from '../infrastructure/config/authentication.config';
import {
  constantTimeAuthenticationValueEquals,
  createKeyedAuthenticationDigest,
  createOidcIdentityDigest,
  createPkceS256Challenge,
  digestOpaqueAuthenticationSecret,
  generateOpaqueAuthenticationSecret,
  generatePkceVerifier,
  openPreAuthenticationTransactionCookie,
  sealPreAuthenticationTransactionCookie,
} from '../infrastructure/crypto/authentication-crypto';

const RATE_LIMIT_POLICIES = Object.freeze({
  LOGIN_START: Object.freeze({ windowSeconds: 60, limitCount: 10 }),
  CALLBACK: Object.freeze({ windowSeconds: 60, limitCount: 20 }),
  SESSION_ROTATE: Object.freeze({ windowSeconds: 60, limitCount: 10 }),
});

export interface AuthenticationHttpRequest {
  readonly method?: unknown;
  readonly headers?: Readonly<Record<string, unknown>>;
}

export interface StartAuthenticationRequest {
  readonly flow: AuthenticationFlow;
  readonly returnPath: unknown;
  readonly sourceAddress: unknown;
  readonly registration?: ProvisionAccountProfileInput;
}

export interface StartedAuthentication {
  readonly authorizationUrl: string;
  readonly transactionCookie: string;
  readonly expiresAt: Date;
}

export interface CompleteAuthenticationCallbackRequest {
  readonly callback: AuthenticationCallback;
  readonly transactionCookie: unknown;
  readonly sourceAddress: unknown;
}

export interface CompletedAuthentication {
  readonly accountId: ReturnType<typeof parseAccountId>;
  readonly sessionCookie: string;
  readonly csrfToken: string;
  readonly returnPath: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface RotatedAuthenticationSession {
  readonly sessionCookie: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

interface VerifiedBrowserSessionProof {
  readonly credential: ReturnType<typeof parseAuthenticationSessionCookie>;
  readonly csrfToken: string;
}

function digestReference(value: string): AuthenticationDigestReference {
  return Object.freeze({ version: AUTHENTICATION_DIGEST_VERSION, value });
}

function requestHeader(request: AuthenticationHttpRequest, name: string): unknown {
  const headers = request.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  return headers[name.toLowerCase()];
}

function requestCorrelationId(): string {
  const candidate = loggingContext.current()?.correlationId;
  return typeof candidate === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(candidate)
    ? candidate
    : randomUUID();
}

function exactSourceAddress(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x21 || code > 0x7e;
    })
  ) {
    throw new AuthenticationRejectedError();
  }
  return value;
}

function unavailableOidcFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'OIDC_JWKS_UNAVAILABLE' || error.code === 'OIDC_TOKEN_SERVICE_UNAVAILABLE';
}

function claimedOidcRejectionReason(error: unknown): ClaimedAuthenticationRejectionReason {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'TOKEN_INVALID';
  return error.code === 'OIDC_TOKEN_EXCHANGE_REJECTED' || unavailableOidcFailure(error)
    ? 'PROVIDER_ERROR'
    : 'TOKEN_INVALID';
}

@Injectable()
export class AuthenticationService {
  constructor(
    @Inject(AUTHENTICATION_CONFIG)
    private readonly runtimeConfig: RuntimeAuthenticationConfig,
    @Inject(AUTHENTICATION_REPOSITORY)
    private readonly repository: AuthenticationRepositoryPort,
    @Inject(AUTHENTICATION_RATE_LIMITER)
    private readonly rateLimiter: AuthenticationRateLimiterPort,
    @Inject(OIDC_CLIENT)
    private readonly oidc: OidcClientPort | null,
  ) {}

  async start(request: StartAuthenticationRequest): Promise<StartedAuthentication> {
    const config = this.requireEnabled();
    const returnPath = parseLocalReturnPath(request.returnPath);
    const registration = this.registrationForFlow(request.flow, request.registration);
    const correlationId = requestCorrelationId();
    await this.admit(
      'LOGIN_START',
      exactSourceAddress(request.sourceAddress),
      correlationId,
      config,
    );

    const transactionId = randomUUID();
    const state = generateOpaqueAuthenticationSecret('oidc-state');
    const browserBinding = generateOpaqueAuthenticationSecret('browser-binding');
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const codeVerifier = generatePkceVerifier();
    let begun: Awaited<ReturnType<AuthenticationRepositoryPort['beginTransaction']>>;
    try {
      begun = await this.repository.beginTransaction({
        transactionId,
        flow: request.flow,
        issuer: config.issuer,
        stateDigest: digestReference(digestOpaqueAuthenticationSecret('oidc-state', state)),
        browserBindingDigest: digestReference(
          digestOpaqueAuthenticationSecret('browser-binding', browserBinding),
        ),
        nonceDigest: digestReference(digestOpaqueAuthenticationSecret('oidc-nonce', nonce)),
        ttlSeconds: config.preAuthenticationTtlSeconds,
        correlationId,
      });
    } catch {
      throw new AuthenticationUnavailableError();
    }

    const nowEpochSeconds = Math.floor(Date.now() / 1_000);
    const transactionCookie = sealPreAuthenticationTransactionCookie(
      {
        version: 1,
        transactionId,
        flow: request.flow,
        state,
        browserBinding,
        nonce,
        codeVerifier,
        returnPath,
        ...(registration ? { registration } : {}),
        issuedAtEpochSeconds: nowEpochSeconds,
        expiresAtEpochSeconds: nowEpochSeconds + config.preAuthenticationTtlSeconds,
      },
      config.preAuthenticationSealKey,
    );
    try {
      const authorizationUrl = this.requireOidc().createAuthorizationUrl({
        state,
        nonce,
        codeChallenge: createPkceS256Challenge(codeVerifier),
      });
      return Object.freeze({
        authorizationUrl: authorizationUrl.toString(),
        transactionCookie,
        expiresAt: begun.expiresAt,
      });
    } catch {
      throw new AuthenticationUnavailableError();
    }
  }

  async completeCallback(
    request: CompleteAuthenticationCallbackRequest,
  ): Promise<CompletedAuthentication> {
    const config = this.requireEnabled();
    const correlationId = requestCorrelationId();
    await this.admit('CALLBACK', exactSourceAddress(request.sourceAddress), correlationId, config);
    let payload: ReturnType<typeof openPreAuthenticationTransactionCookie>;
    try {
      payload = openPreAuthenticationTransactionCookie(
        request.transactionCookie,
        [config.preAuthenticationSealKey],
        Math.floor(Date.now() / 1_000),
        config.preAuthenticationTtlSeconds,
      );
    } catch {
      throw new AuthenticationRejectedError();
    }
    if (
      !constantTimeAuthenticationValueEquals(payload.state, request.callback.state) ||
      (request.callback.issuer !== undefined && request.callback.issuer !== config.issuer)
    ) {
      throw new AuthenticationRejectedError();
    }

    let claimed: Awaited<ReturnType<AuthenticationRepositoryPort['claimTransaction']>>;
    try {
      claimed = await this.repository.claimTransaction({
        transactionId: payload.transactionId,
        stateDigest: digestReference(digestOpaqueAuthenticationSecret('oidc-state', payload.state)),
        browserBindingDigest: digestReference(
          digestOpaqueAuthenticationSecret('browser-binding', payload.browserBinding),
        ),
        correlationId,
      });
    } catch {
      throw new AuthenticationUnavailableError();
    }
    const nonceDigest = digestReference(
      digestOpaqueAuthenticationSecret('oidc-nonce', payload.nonce),
    );
    if (claimed.status !== 'claimed') {
      throw new AuthenticationRejectedError();
    }
    if (
      claimed.flow !== payload.flow ||
      claimed.issuer !== config.issuer ||
      claimed.nonceDigest.version !== nonceDigest.version ||
      !constantTimeAuthenticationValueEquals(claimed.nonceDigest.value, nonceDigest.value)
    ) {
      return this.rejectClaimedCallback(
        payload.transactionId,
        'IDENTITY_INVALID',
        correlationId,
        false,
      );
    }
    if (request.callback.kind !== 'success') {
      return this.rejectClaimedCallback(
        payload.transactionId,
        'PROVIDER_ERROR',
        correlationId,
        false,
      );
    }

    let identity: Awaited<ReturnType<OidcClientPort['exchangeAuthorizationCode']>>;
    try {
      identity = await this.requireOidc().exchangeAuthorizationCode({
        code: request.callback.code,
        codeVerifier: payload.codeVerifier,
        expectedNonce: payload.nonce,
      });
    } catch (error) {
      return this.rejectClaimedCallback(
        payload.transactionId,
        claimedOidcRejectionReason(error),
        correlationId,
        unavailableOidcFailure(error),
      );
    }
    if (identity.issuer !== config.issuer || identity.providerKey !== config.providerKey) {
      return this.rejectClaimedCallback(
        payload.transactionId,
        'IDENTITY_INVALID',
        correlationId,
        false,
      );
    }

    const proposedCredentialId = randomUUID();
    const sessionSecret = generateOpaqueAuthenticationSecret('session');
    const csrfToken = generateOpaqueAuthenticationSecret('csrf');
    const base = {
      transactionId: payload.transactionId,
      identity,
      nonceDigest,
      subjectDigest: digestReference(
        createOidcIdentityDigest(
          config.identityHmacKey,
          identity.providerKey,
          identity.issuer,
          identity.subject,
        ),
      ),
      proposedAccountId: parseAccountId(randomUUID()),
      proposedIdentityId: randomUUID(),
      proposedSessionFamilyId: randomUUID(),
      proposedCredentialId,
      credentialDigest: digestReference(
        createKeyedAuthenticationDigest('session', config.sessionHmacKey, sessionSecret),
      ),
      csrfDigest: digestReference(
        createKeyedAuthenticationDigest('csrf', config.csrfHmacKey, csrfToken),
      ),
      idleTtlSeconds: config.sessionIdleTtlSeconds,
      absoluteTtlSeconds: config.sessionAbsoluteTtlSeconds,
      correlationId,
    } as const;
    let completed: Awaited<ReturnType<AuthenticationRepositoryPort['completeLogin']>>;
    try {
      completed = await this.repository.completeLogin(
        payload.flow === 'registration'
          ? {
              ...base,
              flow: 'registration',
              registration: payload.registration as PreAuthenticationRegistrationPayload,
            }
          : { ...base, flow: 'login' },
      );
    } catch {
      throw new ClaimedAuthenticationUnavailableError();
    }
    if (completed.status !== 'authenticated' || completed.credentialId !== proposedCredentialId) {
      throw new ClaimedAuthenticationRejectedError();
    }
    return Object.freeze({
      accountId: completed.accountId,
      sessionCookie: formatAuthenticationSessionCookie(completed.credentialId, sessionSecret),
      csrfToken,
      returnPath: payload.returnPath,
      idleExpiresAt: completed.idleExpiresAt,
      absoluteExpiresAt: completed.absoluteExpiresAt,
    });
  }

  async resolve(
    request: AuthenticationHttpRequest,
  ): Promise<{ readonly accountId: ReturnType<typeof parseAccountId> } | null> {
    const config = this.enabledOrNull();
    if (!config) return null;
    let sessionValue: string | null;
    let credential: ReturnType<typeof parseAuthenticationSessionCookie>;
    let csrfValue: string | null;
    try {
      sessionValue = assertUnambiguousAuthenticationHeaders(
        requestHeader(request, 'cookie'),
        requestHeader(request, 'authorization'),
      );
      if (sessionValue === null) return null;
      credential = parseAuthenticationSessionCookie(sessionValue);
      csrfValue = requireAuthenticationCsrf({
        method: request.method,
        originHeader: requestHeader(request, 'origin'),
        csrfHeader: requestHeader(request, 'x-csrf-token'),
        cookieHeader: requestHeader(request, 'cookie'),
        expectedOrigin: config.publicOrigin,
      });
    } catch {
      return null;
    }
    let resolved: Awaited<ReturnType<AuthenticationRepositoryPort['resolveSession']>>;
    try {
      resolved = await this.repository.resolveSession({
        credentialId: credential.credentialId,
        credentialDigest: digestReference(
          createKeyedAuthenticationDigest('session', config.sessionHmacKey, credential.secret),
        ),
        csrf:
          csrfValue === null
            ? { required: false }
            : {
                required: true,
                digest: digestReference(
                  createKeyedAuthenticationDigest('csrf', config.csrfHmacKey, csrfValue),
                ),
              },
        correlationId: requestCorrelationId(),
      });
    } catch {
      throw new AuthenticationUnavailableError();
    }
    return resolved.status === 'authenticated'
      ? Object.freeze({ accountId: resolved.accountId })
      : null;
  }

  async rotate(
    request: AuthenticationHttpRequest,
    sourceAddress: unknown,
  ): Promise<RotatedAuthenticationSession> {
    const config = this.requireEnabled();
    const correlationId = requestCorrelationId();
    const proof = this.requireSessionProof(request, config);
    await this.verifySessionProof(proof, config, correlationId);
    const current = proof.credential;
    await this.admit(
      'SESSION_ROTATE',
      `${exactSourceAddress(sourceAddress)}:${current.credentialId}`,
      correlationId,
      config,
    );
    const successorCredentialId = randomUUID();
    const successorSecret = generateOpaqueAuthenticationSecret('session');
    const successorCsrf = generateOpaqueAuthenticationSecret('csrf');
    let result: Awaited<ReturnType<AuthenticationRepositoryPort['rotateSession']>>;
    try {
      result = await this.repository.rotateSession({
        credentialId: current.credentialId,
        credentialDigest: digestReference(
          createKeyedAuthenticationDigest('session', config.sessionHmacKey, current.secret),
        ),
        successorCredentialId,
        successorCredentialDigest: digestReference(
          createKeyedAuthenticationDigest('session', config.sessionHmacKey, successorSecret),
        ),
        successorCsrfDigest: digestReference(
          createKeyedAuthenticationDigest('csrf', config.csrfHmacKey, successorCsrf),
        ),
        correlationId,
      });
    } catch {
      throw new AuthenticationUnavailableError();
    }
    if (result.status !== 'rotated' || result.credentialId !== successorCredentialId) {
      throw new AuthenticationRejectedError();
    }
    return Object.freeze({
      sessionCookie: formatAuthenticationSessionCookie(successorCredentialId, successorSecret),
      csrfToken: successorCsrf,
      expiresAt: result.expiresAt,
    });
  }

  async logout(request: AuthenticationHttpRequest): Promise<void> {
    const config = this.requireEnabled();
    const correlationId = requestCorrelationId();
    const proof = this.requireSessionProof(request, config);
    await this.verifySessionProof(proof, config, correlationId);
    const current = proof.credential;
    try {
      const result = await this.repository.revokeSession({
        credentialId: current.credentialId,
        credentialDigest: digestReference(
          createKeyedAuthenticationDigest('session', config.sessionHmacKey, current.secret),
        ),
        correlationId,
      });
      if (result.status !== 'revoked') throw new AuthenticationRejectedError();
    } catch (error) {
      if (error instanceof AuthenticationRejectedError) throw error;
      throw new AuthenticationUnavailableError();
    }
  }

  private requireSessionProof(
    request: AuthenticationHttpRequest,
    config: OidcAuthenticationConfig,
  ): VerifiedBrowserSessionProof {
    try {
      const value = assertUnambiguousAuthenticationHeaders(
        requestHeader(request, 'cookie'),
        requestHeader(request, 'authorization'),
      );
      if (value === null) throw new AuthenticationRejectedError();
      const csrfToken = requireAuthenticationCsrf({
        method: request.method,
        originHeader: requestHeader(request, 'origin'),
        csrfHeader: requestHeader(request, 'x-csrf-token'),
        cookieHeader: requestHeader(request, 'cookie'),
        expectedOrigin: config.publicOrigin,
      });
      if (csrfToken === null) throw new AuthenticationRejectedError();
      return Object.freeze({
        credential: parseAuthenticationSessionCookie(value),
        csrfToken,
      });
    } catch {
      throw new AuthenticationRejectedError();
    }
  }

  private async verifySessionProof(
    proof: VerifiedBrowserSessionProof,
    config: OidcAuthenticationConfig,
    correlationId: string,
  ): Promise<void> {
    try {
      const result = await this.repository.resolveSession({
        credentialId: proof.credential.credentialId,
        credentialDigest: digestReference(
          createKeyedAuthenticationDigest(
            'session',
            config.sessionHmacKey,
            proof.credential.secret,
          ),
        ),
        csrf: {
          required: true,
          digest: digestReference(
            createKeyedAuthenticationDigest('csrf', config.csrfHmacKey, proof.csrfToken),
          ),
        },
        correlationId,
      });
      if (result.status !== 'authenticated') throw new AuthenticationRejectedError();
    } catch (error) {
      if (error instanceof AuthenticationRejectedError) throw error;
      throw new AuthenticationUnavailableError();
    }
  }

  private async admit(
    scope: AuthenticationRateLimitScope,
    subject: string,
    correlationId: string,
    config: OidcAuthenticationConfig,
  ): Promise<void> {
    const policy = RATE_LIMIT_POLICIES[scope];
    let decision: Awaited<ReturnType<AuthenticationRateLimiterPort['admit']>>;
    try {
      decision = await this.rateLimiter.admit({
        scope,
        subjectDigest: digestReference(
          createKeyedAuthenticationDigest('rate-limit', config.sessionHmacKey, subject),
        ),
        windowSeconds: policy.windowSeconds,
        limitCount: policy.limitCount,
        correlationId,
      });
    } catch {
      throw new AuthenticationUnavailableError();
    }
    if (!decision.admitted) throw new AuthenticationRateLimitedError(decision.retryAfterSeconds);
  }

  private async rejectClaimedCallback(
    transactionId: string,
    reason: ClaimedAuthenticationRejectionReason,
    correlationId: string,
    dependencyUnavailable: boolean,
  ): Promise<never> {
    let result: Awaited<ReturnType<AuthenticationRepositoryPort['rejectClaimedTransaction']>>;
    try {
      result = await this.repository.rejectClaimedTransaction({
        transactionId,
        reason,
        correlationId,
      });
    } catch {
      throw new ClaimedAuthenticationUnavailableError();
    }
    if (result.status !== 'rejected') throw new ClaimedAuthenticationRejectedError();
    if (dependencyUnavailable) throw new ClaimedAuthenticationUnavailableError();
    throw new ClaimedAuthenticationRejectedError();
  }

  private registrationForFlow(
    flow: AuthenticationFlow,
    registration: ProvisionAccountProfileInput | undefined,
  ): ProvisionAccountProfileInput | undefined {
    if ((flow === 'registration') !== (registration !== undefined)) {
      throw new AuthenticationRejectedError();
    }
    if (!registration) return undefined;
    try {
      const contactPhone = normalizeContactPhone(registration.contactPhone);
      if (contactPhone === undefined) throw new AuthenticationRejectedError();
      return Object.freeze({
        contactEmail: normalizeContactEmail(registration.contactEmail),
        contactPhone,
        declaredResidencyCountryCode: normalizeDeclaredResidencyCountryCode(
          registration.declaredResidencyCountryCode,
        ),
      });
    } catch {
      throw new AuthenticationRejectedError();
    }
  }

  private enabledOrNull(): OidcAuthenticationConfig | null {
    return this.runtimeConfig.mode === 'oidc' ? this.runtimeConfig : null;
  }

  private requireEnabled(): OidcAuthenticationConfig {
    const config = this.enabledOrNull();
    if (!config) throw new AuthenticationUnavailableError();
    return config;
  }

  private requireOidc(): OidcClientPort {
    if (!this.oidc) throw new AuthenticationUnavailableError();
    return this.oidc;
  }
}
