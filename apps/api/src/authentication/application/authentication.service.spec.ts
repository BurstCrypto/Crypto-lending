import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  generateOpaqueAuthenticationSecret,
  openPreAuthenticationTransactionCookie,
  sealPreAuthenticationTransactionCookie,
} from '../infrastructure/crypto/authentication-crypto';
import {
  loadAuthenticationConfig,
  type OidcAuthenticationConfig,
} from '../infrastructure/config/authentication.config';
import { AUTHENTICATION_COOKIE_NAMES } from '../http/authentication-cookies';
import { formatAuthenticationSessionCookie } from '../http/authentication-session-cookie';
import { parseOidcProviderKey, parseOidcSubject } from '../domain/authentication';
import {
  AuthenticationRateLimitedError,
  AuthenticationRejectedError,
  AuthenticationUnavailableError,
} from './authentication.errors';
import type { AuthenticationRateLimiterPort } from './ports/authentication-rate-limiter.port';
import type { AuthenticationRepositoryPort } from './ports/authentication-repository.port';
import type { OidcClientPort } from './ports/oidc-client.port';
import { AuthenticationService } from './authentication.service';

const ACCOUNT_ID = parseAccountId('fd2354fa-67c0-495c-a0f7-310bd3db7a6d');
const CREDENTIAL_ID = '17565582-f383-4d97-895a-14513135603b';
const IDLE_EXPIRES_AT = new Date('2030-01-01T01:00:00.000Z');
const ABSOLUTE_EXPIRES_AT = new Date('2030-01-08T00:00:00.000Z');

function authenticationConfig(
  overrides: Readonly<Record<string, string | undefined>> = {},
): OidcAuthenticationConfig {
  const key = (fill: number): string => Buffer.alloc(32, fill).toString('base64url');
  const config = loadAuthenticationConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    OIDC_PROVIDER_KEY: 'primary',
    OIDC_ISSUER_URL: 'https://identity.example.test/tenant',
    OIDC_AUTHORIZATION_ENDPOINT: 'https://identity.example.test/authorize',
    OIDC_TOKEN_ENDPOINT: 'https://identity.example.test/token',
    OIDC_JWKS_URI: 'https://identity.example.test/jwks',
    OIDC_CLIENT_ID: 'crypto-lending-web',
    OIDC_AUDIENCE: 'crypto-lending-web',
    OIDC_SIGNING_ALGORITHM: 'RS256',
    OIDC_TOKEN_AUTH_METHOD: 'client_secret_basic',
    OIDC_CLIENT_SECRET: 'client-secret-canary',
    AUTH_PUBLIC_ORIGIN: 'https://app.example.test',
    OIDC_REDIRECT_URI: 'https://app.example.test/api/v1/auth/callback',
    OIDC_HTTP_TIMEOUT_MS: '1000',
    OIDC_TOKEN_RESPONSE_MAX_BYTES: '4096',
    OIDC_JWKS_RESPONSE_MAX_BYTES: '8192',
    OIDC_JWKS_CACHE_TTL_SECONDS: '300',
    OIDC_CLOCK_TOLERANCE_SECONDS: '30',
    OIDC_MAX_ID_TOKEN_AGE_SECONDS: '600',
    AUTH_PREAUTH_TTL_SECONDS: '600',
    AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
    AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '604800',
    AUTH_PREAUTH_SEAL_KEY_ID: 'seal_v1',
    AUTH_PREAUTH_SEAL_KEY: key(1),
    AUTH_IDENTITY_HMAC_KEY_ID: 'identity_v1',
    AUTH_IDENTITY_HMAC_KEY: key(2),
    AUTH_SESSION_HMAC_KEY_ID: 'session_v1',
    AUTH_SESSION_HMAC_KEY: key(3),
    AUTH_CSRF_HMAC_KEY_ID: 'csrf_v1',
    AUTH_CSRF_HMAC_KEY: key(4),
    ...overrides,
  });
  if (config.mode !== 'oidc') throw new Error('Expected OIDC config');
  return config;
}

function rotatingAuthenticationConfig(): OidcAuthenticationConfig {
  const key = (fill: number): string => Buffer.alloc(32, fill).toString('base64url');
  const ring = (purpose: string, firstFill: number): string =>
    JSON.stringify({
      activeWriteVersion: 2,
      keys: [
        {
          keyId: `${purpose.replace('-hmac', '')}_v1`,
          purpose,
          version: 1,
          material: key(firstFill),
        },
        {
          keyId: `${purpose.replace('-hmac', '')}_v2`,
          purpose,
          version: 2,
          material: key(firstFill + 1),
        },
      ],
    });
  return authenticationConfig({
    AUTH_IDENTITY_HMAC_KEY_ID: undefined,
    AUTH_IDENTITY_HMAC_KEY: undefined,
    AUTH_SESSION_HMAC_KEY_ID: undefined,
    AUTH_SESSION_HMAC_KEY: undefined,
    AUTH_CSRF_HMAC_KEY_ID: undefined,
    AUTH_CSRF_HMAC_KEY: undefined,
    AUTH_IDENTITY_HMAC_KEY_RING_JSON: ring('identity-hmac', 10),
    AUTH_SESSION_HMAC_KEY_RING_JSON: ring('session-hmac', 12),
    AUTH_CSRF_HMAC_KEY_RING_JSON: ring('csrf-hmac', 14),
  });
}

interface Harness {
  readonly config: OidcAuthenticationConfig;
  readonly repository: jest.Mocked<AuthenticationRepositoryPort>;
  readonly rateLimiter: jest.Mocked<AuthenticationRateLimiterPort>;
  readonly oidc: jest.Mocked<OidcClientPort>;
  readonly service: AuthenticationService;
}

function harness(config: OidcAuthenticationConfig = authenticationConfig()): Harness {
  const repository: jest.Mocked<AuthenticationRepositoryPort> = {
    beginTransaction: jest.fn().mockResolvedValue({
      transactionId: 'b4c78068-fe5b-46ee-9c74-a62908679656',
      expiresAt: new Date('2030-01-01T00:10:00.000Z'),
    }),
    claimTransaction: jest.fn().mockResolvedValue({ status: 'invalid' }),
    rejectClaimedTransaction: jest.fn().mockResolvedValue({ status: 'rejected' }),
    completeLogin: jest.fn().mockResolvedValue({ status: 'rejected' }),
    resolveSession: jest.fn().mockResolvedValue({ status: 'invalid' }),
    rotateSession: jest.fn().mockResolvedValue({ status: 'invalid' }),
    revokeSession: jest.fn().mockResolvedValue({ status: 'invalid' }),
  };
  const rateLimiter: jest.Mocked<AuthenticationRateLimiterPort> = {
    admit: jest.fn().mockResolvedValue({ admitted: true, remainingCount: 9 }),
  };
  const oidc: jest.Mocked<OidcClientPort> = {
    createAuthorizationUrl: jest.fn().mockImplementation(({ state }) => {
      const url = new URL(config.authorizationEndpoint);
      url.searchParams.set('state', state);
      return url;
    }),
    exchangeAuthorizationCode: jest.fn().mockResolvedValue({
      providerKey: parseOidcProviderKey('primary'),
      issuer: config.issuer,
      subject: parseOidcSubject('CaseSensitiveSubject'),
      issuedAtEpochSeconds: 1_800_000_000,
      expiresAtEpochSeconds: 1_800_000_300,
    }),
  };
  return {
    config,
    repository,
    rateLimiter,
    oidc,
    service: new AuthenticationService(config, repository, rateLimiter, oidc),
  };
}

function sessionProof(
  config: OidcAuthenticationConfig,
  method = 'POST',
): {
  readonly request: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly sessionValue: string;
  readonly csrf: string;
} {
  const secret = generateOpaqueAuthenticationSecret('session');
  const csrf = generateOpaqueAuthenticationSecret('csrf');
  const sessionValue = formatAuthenticationSessionCookie(CREDENTIAL_ID, secret);
  return {
    request: {
      method,
      headers: {
        cookie: `${AUTHENTICATION_COOKIE_NAMES.session}=${sessionValue}; ${AUTHENTICATION_COOKIE_NAMES.csrf}=${csrf}`,
        origin: config.publicOrigin,
        'x-csrf-token': csrf,
      },
    },
    sessionValue,
    csrf,
  };
}

async function startedRegistration(fixture: Harness): Promise<{
  readonly transactionCookie: string;
  readonly payload: ReturnType<typeof openPreAuthenticationTransactionCookie>;
}> {
  const started = await fixture.service.start({
    flow: 'registration',
    returnPath: '/dashboard?welcome=1',
    sourceAddress: '198.51.100.10',
    registration: {
      contactEmail: 'Person@EXAMPLE.TEST',
      contactPhone: null,
      declaredResidencyCountryCode: 'US',
    },
  });
  const payload = openPreAuthenticationTransactionCookie(
    started.transactionCookie,
    [fixture.config.preAuthenticationSealKey],
    Math.floor(Date.now() / 1_000),
    fixture.config.preAuthenticationTtlSeconds,
  );
  return { transactionCookie: started.transactionCookie, payload };
}

describe('AuthenticationService', () => {
  it('starts a browser-bound registration without persisting raw transaction secrets or profile data', async () => {
    const fixture = harness();
    const { transactionCookie, payload } = await startedRegistration(fixture);

    expect(payload).toMatchObject({
      flow: 'registration',
      returnPath: '/dashboard?welcome=1',
      registration: {
        contactEmail: 'Person@example.test',
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
      },
    });
    const begun = fixture.repository.beginTransaction.mock.calls[0]?.[0];
    expect(begun).toMatchObject({
      flow: 'registration',
      issuer: fixture.config.issuer,
      ttlSeconds: fixture.config.preAuthenticationTtlSeconds,
    });
    expect(
      new Set([
        begun?.stateDigest.value,
        begun?.browserBindingDigest.value,
        begun?.nonceDigest.value,
      ]).size,
    ).toBe(3);
    expect(JSON.stringify(begun)).not.toContain(payload.state);
    expect(JSON.stringify(begun)).not.toContain(payload.browserBinding);
    expect(JSON.stringify(begun)).not.toContain('Person@example.test');
    expect(transactionCookie).not.toContain(payload.state);
    expect(fixture.rateLimiter.admit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'LOGIN_START', windowSeconds: 60, limitCount: 10 }),
    );
  });

  it('claims then verifies and completes registration through one atomic repository operation', async () => {
    const fixture = harness();
    const { transactionCookie, payload } = await startedRegistration(fixture);
    const begun = fixture.repository.beginTransaction.mock.calls[0]?.[0];
    if (!begun) throw new Error('Expected begin transaction call');
    fixture.repository.claimTransaction.mockResolvedValue({
      status: 'claimed',
      flow: 'registration',
      issuer: fixture.config.issuer,
      nonceDigest: begun.nonceDigest,
    });
    fixture.repository.completeLogin.mockImplementation((request) =>
      Promise.resolve({
        status: 'authenticated',
        accountId: ACCOUNT_ID,
        sessionFamilyId: request.proposedSessionFamilyId,
        credentialId: request.proposedCredentialId,
        idleExpiresAt: IDLE_EXPIRES_AT,
        absoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
      }),
    );

    const completed = await fixture.service.completeCallback({
      callback: {
        kind: 'success',
        code: 'one-time-code',
        state: payload.state,
        issuer: fixture.config.issuer,
      },
      transactionCookie,
      sourceAddress: '198.51.100.10',
    });

    expect(completed).toMatchObject({
      accountId: ACCOUNT_ID,
      returnPath: '/dashboard?welcome=1',
      idleExpiresAt: IDLE_EXPIRES_AT,
      absoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
    });
    expect(completed.sessionCookie).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u);
    expect(completed.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(fixture.repository.completeLogin).toHaveBeenCalledTimes(1);
    expect(fixture.repository.completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'registration',
        registration: {
          contactEmail: 'Person@example.test',
          contactPhone: null,
          declaredResidencyCountryCode: 'US',
        },
      }),
    );
    expect(fixture.repository.claimTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.oidc.exchangeAuthorizationCode.mock.invocationCallOrder[0] as number,
    );
    expect(fixture.oidc.exchangeAuthorizationCode).toHaveBeenCalledWith({
      code: 'one-time-code',
      codeVerifier: payload.codeVerifier,
      expectedNonce: payload.nonce,
    });
  });

  it('reads every accepted HMAC version while all new identity, session, and CSRF writes use the active version', async () => {
    const fixture = harness(rotatingAuthenticationConfig());
    const { transactionCookie, payload } = await startedRegistration(fixture);
    const begun = fixture.repository.beginTransaction.mock.calls[0]?.[0];
    if (!begun) throw new Error('Expected begin transaction call');
    fixture.repository.claimTransaction.mockResolvedValue({
      status: 'claimed',
      flow: 'registration',
      issuer: fixture.config.issuer,
      nonceDigest: begun.nonceDigest,
    });
    fixture.repository.completeLogin.mockImplementation((request) =>
      Promise.resolve({
        status: 'authenticated',
        accountId: ACCOUNT_ID,
        sessionFamilyId: request.proposedSessionFamilyId,
        credentialId: request.proposedCredentialId,
        idleExpiresAt: IDLE_EXPIRES_AT,
        absoluteExpiresAt: ABSOLUTE_EXPIRES_AT,
      }),
    );
    await fixture.service.completeCallback({
      callback: {
        kind: 'success',
        code: 'rotation-code',
        state: payload.state,
        issuer: fixture.config.issuer,
      },
      transactionCookie,
      sourceAddress: '198.51.100.10',
    });
    const completed = fixture.repository.completeLogin.mock.calls[0]?.[0];
    expect(completed?.subjectDigests.map(({ version }) => version)).toEqual([1, 2]);
    expect(completed?.credentialDigest.version).toBe(2);
    expect(completed?.csrfDigest.version).toBe(2);
    expect(
      fixture.rateLimiter.admit.mock.calls.map(([request]) =>
        request.subjectDigests.map(({ version }) => version),
      ),
    ).toEqual([
      [1, 2],
      [1, 2],
    ]);

    const proof = sessionProof(fixture.config);
    fixture.repository.resolveSession.mockResolvedValue({
      status: 'authenticated',
      accountId: ACCOUNT_ID,
      sessionFamilyId: '39563e7d-8f41-4b47-803b-968cf99a9f2e',
    });
    fixture.repository.rotateSession.mockImplementation((request) =>
      Promise.resolve({
        status: 'rotated',
        credentialId: request.successorCredentialId,
        expiresAt: IDLE_EXPIRES_AT,
      }),
    );
    await fixture.service.resolve(proof.request);
    const resolved = fixture.repository.resolveSession.mock.calls.at(-1)?.[0];
    expect(resolved?.credentialDigests.map(({ version }) => version)).toEqual([1, 2]);
    expect(resolved?.csrf.required && resolved.csrf.digests.map(({ version }) => version)).toEqual([
      1, 2,
    ]);

    await fixture.service.rotate(proof.request, '198.51.100.10');
    const rotated = fixture.repository.rotateSession.mock.calls[0]?.[0];
    expect(rotated?.credentialDigests.map(({ version }) => version)).toEqual([1, 2]);
    expect(rotated?.successorCredentialDigest.version).toBe(2);
    expect(rotated?.successorCsrfDigest.version).toBe(2);
    expect(
      fixture.rateLimiter.admit.mock.calls.at(-1)?.[0].subjectDigests.map(({ version }) => version),
    ).toEqual([1, 2]);
  });

  it('rejects mismatched state, changed browser binding, and replay before another token exchange', async () => {
    const fixture = harness();
    const { transactionCookie, payload } = await startedRegistration(fixture);

    await expect(
      fixture.service.completeCallback({
        callback: {
          kind: 'success',
          code: 'code',
          state: generateOpaqueAuthenticationSecret('oidc-state'),
        },
        transactionCookie,
        sourceAddress: '198.51.100.10',
      }),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    expect(fixture.repository.claimTransaction).not.toHaveBeenCalled();

    const changedBindingCookie = sealPreAuthenticationTransactionCookie(
      { ...payload, browserBinding: generateOpaqueAuthenticationSecret('browser-binding') },
      fixture.config.preAuthenticationSealKey,
    );
    fixture.repository.claimTransaction.mockResolvedValueOnce({ status: 'invalid' });
    await expect(
      fixture.service.completeCallback({
        callback: { kind: 'success', code: 'code', state: payload.state },
        transactionCookie: changedBindingCookie,
        sourceAddress: '198.51.100.10',
      }),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);

    fixture.repository.claimTransaction.mockResolvedValueOnce({ status: 'replayed' });
    await expect(
      fixture.service.completeCallback({
        callback: { kind: 'success', code: 'code', state: payload.state },
        transactionCookie,
        sourceAddress: '198.51.100.10',
      }),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    expect(fixture.oidc.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('writes with the current pre-authentication key and accepts an in-flight previous-key cookie', async () => {
    const key = (fill: number): string => Buffer.alloc(32, fill).toString('base64url');
    const config = authenticationConfig({
      AUTH_PREAUTH_SEAL_KEY_ID: 'seal_v2',
      AUTH_PREAUTH_SEAL_KEY: key(9),
      AUTH_PREAUTH_SEAL_PREVIOUS_KEY_ID: 'seal_v1',
      AUTH_PREAUTH_SEAL_PREVIOUS_KEY: key(1),
    });
    const fixture = harness(config);
    const { transactionCookie, payload } = await startedRegistration(fixture);
    expect(transactionCookie).toMatch(/^v1\.seal_v2\./u);

    const previousKey = config.preAuthenticationSealKeys[1];
    if (!previousKey) throw new Error('Expected previous seal key');
    const previousCookie = sealPreAuthenticationTransactionCookie(payload, previousKey);
    await expect(
      fixture.service.completeCallback({
        callback: { kind: 'success', code: 'code', state: payload.state },
        transactionCookie: previousCookie,
        sourceAddress: '198.51.100.10',
      }),
    ).rejects.toBeInstanceOf(AuthenticationRejectedError);
    expect(fixture.repository.claimTransaction).toHaveBeenCalledTimes(1);
  });

  it('fails closed while disabled and does not touch dependencies', async () => {
    const fixture = harness();
    const service = new AuthenticationService(
      { mode: 'disabled' },
      fixture.repository,
      fixture.rateLimiter,
      null,
    );

    await expect(
      service.start({ flow: 'login', returnPath: '/', sourceAddress: '198.51.100.10' }),
    ).rejects.toBeInstanceOf(AuthenticationUnavailableError);
    await expect(service.resolve({ method: 'GET', headers: {} })).resolves.toBeNull();
    expect(fixture.repository.beginTransaction).not.toHaveBeenCalled();
    expect(fixture.rateLimiter.admit).not.toHaveBeenCalled();
  });

  it('resolves safe and unsafe requests with session-bound CSRF and rejects ambiguity', async () => {
    const fixture = harness();
    const proof = sessionProof(fixture.config);
    fixture.repository.resolveSession.mockResolvedValue({
      status: 'authenticated',
      accountId: ACCOUNT_ID,
      sessionFamilyId: '39563e7d-8f41-4b47-803b-968cf99a9f2e',
    });

    await expect(
      fixture.service.resolve({
        method: 'GET',
        headers: { cookie: `${AUTHENTICATION_COOKIE_NAMES.session}=${proof.sessionValue}` },
      }),
    ).resolves.toEqual({ accountId: ACCOUNT_ID });
    expect(fixture.repository.resolveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ csrf: { required: false } }),
    );

    await expect(fixture.service.resolve(proof.request)).resolves.toEqual({
      accountId: ACCOUNT_ID,
    });
    const unsafeCall = fixture.repository.resolveSession.mock.calls.at(-1)?.[0];
    expect(unsafeCall?.csrf).toMatchObject({ required: true });
    if (unsafeCall?.csrf.required) {
      expect(unsafeCall.csrf.digests).toHaveLength(1);
      expect(unsafeCall.csrf.digests[0]?.value).toMatch(/^[0-9a-f]{64}$/u);
    }

    await expect(
      fixture.service.resolve({
        ...proof.request,
        headers: { ...proof.request.headers, authorization: 'Bearer ambiguous' },
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.service.resolve({
        ...proof.request,
        headers: {
          ...proof.request.headers,
          'x-csrf-token': generateOpaqueAuthenticationSecret('csrf'),
        },
      }),
    ).resolves.toBeNull();
    expect(fixture.repository.resolveSession).toHaveBeenCalledTimes(2);
  });

  it('rotates only with cookie, exact Origin, CSRF, and an admitted rate-limit decision', async () => {
    const fixture = harness();
    const proof = sessionProof(fixture.config);
    fixture.repository.resolveSession.mockResolvedValue({
      status: 'authenticated',
      accountId: ACCOUNT_ID,
      sessionFamilyId: '39563e7d-8f41-4b47-803b-968cf99a9f2e',
    });
    fixture.repository.rotateSession.mockImplementation((request) =>
      Promise.resolve({
        status: 'rotated',
        credentialId: request.successorCredentialId,
        expiresAt: IDLE_EXPIRES_AT,
      }),
    );

    const rotated = await fixture.service.rotate(proof.request, '198.51.100.10');
    expect(rotated.sessionCookie).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u);
    expect(rotated.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(fixture.rateLimiter.admit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'SESSION_ROTATE', windowSeconds: 60, limitCount: 10 }),
    );
    expect(JSON.stringify(fixture.rateLimiter.admit.mock.calls[0]?.[0])).not.toContain(
      '198.51.100.10',
    );
  });

  it('revokes logout credentials and distinguishes rejection from repository outage', async () => {
    const fixture = harness();
    const proof = sessionProof(fixture.config);
    fixture.repository.resolveSession.mockResolvedValue({
      status: 'authenticated',
      accountId: ACCOUNT_ID,
      sessionFamilyId: '39563e7d-8f41-4b47-803b-968cf99a9f2e',
    });
    fixture.repository.revokeSession.mockResolvedValueOnce({ status: 'revoked' });
    await expect(fixture.service.logout(proof.request)).resolves.toBeUndefined();

    fixture.repository.revokeSession.mockResolvedValueOnce({ status: 'replayed' });
    await expect(fixture.service.logout(proof.request)).rejects.toBeInstanceOf(
      AuthenticationRejectedError,
    );

    fixture.repository.revokeSession.mockRejectedValueOnce(new Error('database-canary'));
    await expect(fixture.service.logout(proof.request)).rejects.toBeInstanceOf(
      AuthenticationUnavailableError,
    );
  });

  it('maps rate limiting and provider outages to closed public status categories', async () => {
    const limited = harness();
    limited.rateLimiter.admit.mockResolvedValue({ admitted: false, retryAfterSeconds: 30 });
    await expect(
      limited.service.start({ flow: 'login', returnPath: '/', sourceAddress: '198.51.100.10' }),
    ).rejects.toMatchObject({
      constructor: AuthenticationRateLimitedError,
      retryAfterSeconds: 30,
    });
    expect(limited.repository.beginTransaction).not.toHaveBeenCalled();

    const outage = harness();
    const { transactionCookie, payload } = await startedRegistration(outage);
    const begun = outage.repository.beginTransaction.mock.calls[0]?.[0];
    if (!begun) throw new Error('Expected begin transaction call');
    outage.repository.claimTransaction.mockResolvedValue({
      status: 'claimed',
      flow: 'registration',
      issuer: outage.config.issuer,
      nonceDigest: begun.nonceDigest,
    });
    outage.oidc.exchangeAuthorizationCode.mockRejectedValue(
      Object.assign(new Error('provider-secret-canary'), {
        code: 'OIDC_TOKEN_SERVICE_UNAVAILABLE',
      }),
    );
    await expect(
      outage.service.completeCallback({
        callback: { kind: 'success', code: 'code', state: payload.state },
        transactionCookie,
        sourceAddress: '198.51.100.10',
      }),
    ).rejects.toBeInstanceOf(AuthenticationUnavailableError);
    expect(outage.repository.completeLogin).not.toHaveBeenCalled();
  });
});
