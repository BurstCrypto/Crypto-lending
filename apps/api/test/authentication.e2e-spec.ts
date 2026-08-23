import { Buffer } from 'node:buffer';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthenticationModule } from '../src/authentication/authentication.module';
import { parseAccountId } from '../src/accounts/domain/account-profile';
import { AUTHENTICATION_RATE_LIMITER } from '../src/authentication/application/ports/authentication-rate-limiter.port';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepositoryPort,
} from '../src/authentication/application/ports/authentication-repository.port';
import {
  OIDC_CLIENT,
  type OidcClientPort,
} from '../src/authentication/application/ports/oidc-client.port';
import {
  parseOidcProviderKey,
  parseOidcSubject,
} from '../src/authentication/domain/authentication';
import { AUTHENTICATION_COOKIE_NAMES } from '../src/authentication/http/authentication-cookies';
import {
  AUTHENTICATION_CONFIG,
  type RuntimeAuthenticationConfig,
} from '../src/authentication/infrastructure/config/authentication-config.provider';
import { createAuthenticationKey } from '../src/authentication/infrastructure/crypto/authentication-crypto';
import { configureApplication } from '../src/application';
import { StructuredLogger } from '../src/infrastructure/logging';

const PROVIDER_KEY = parseOidcProviderKey('fixture');
const ISSUER = 'https://identity.example';
const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

function encodedKey(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

const CONFIG: RuntimeAuthenticationConfig = Object.freeze({
  mode: 'oidc',
  providerKey: PROVIDER_KEY,
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/authorize`,
  tokenEndpoint: `${ISSUER}/token`,
  jwksUri: `${ISSUER}/jwks`,
  clientId: 'local-client',
  audience: 'local-client',
  signingAlgorithm: 'RS256',
  tokenEndpointAuthenticationMethod: 'none',
  publicOrigin: 'https://app.example',
  redirectUri: 'https://app.example/api/v1/auth/callback',
  httpTimeoutMs: 1_000,
  tokenResponseMaxBytes: 16_384,
  jwksResponseMaxBytes: 65_536,
  jwksCacheTtlSeconds: 300,
  clockToleranceSeconds: 30,
  maximumIdTokenAgeSeconds: 300,
  preAuthenticationTtlSeconds: 300,
  sessionIdleTtlSeconds: 3_600,
  sessionAbsoluteTtlSeconds: 86_400,
  preAuthenticationSealKey: createAuthenticationKey('preauth-seal', 'preauth', encodedKey(1)),
  identityHmacKey: createAuthenticationKey('identity-hmac', 'identity', encodedKey(2)),
  sessionHmacKey: createAuthenticationKey('session-hmac', 'session', encodedKey(3)),
  csrfHmacKey: createAuthenticationKey('csrf-hmac', 'csrf', encodedKey(4)),
});

function cookiePair(header: string): string {
  return header.split(';', 1)[0] as string;
}

function cookieValue(header: string): string {
  return cookiePair(header).slice(cookiePair(header).indexOf('=') + 1);
}

function setCookies(response: request.Response): string[] {
  const value = response.headers['set-cookie'];
  return Array.isArray(value) ? value : value ? [value] : [];
}

describe('authentication HTTP boundary (e2e)', () => {
  let app: INestApplication;
  let repository: jest.Mocked<AuthenticationRepositoryPort>;
  let limiter: { admit: jest.Mock };
  let exchangeCode: jest.MockedFunction<OidcClientPort['exchangeAuthorizationCode']>;
  const attempts = new Map<
    string,
    Parameters<AuthenticationRepositoryPort['beginTransaction']>[0]
  >();
  const claimedAttempts = new Set<string>();

  beforeAll(async () => {
    repository = {
      beginTransaction: jest.fn(async (input) => {
        attempts.set(input.transactionId, input);
        return {
          transactionId: input.transactionId,
          expiresAt: new Date(Date.now() + input.ttlSeconds * 1_000),
        };
      }),
      claimTransaction: jest.fn(async (input) => {
        const begun = attempts.get(input.transactionId);
        if (!begun) return { status: 'invalid' } as const;
        if (claimedAttempts.has(input.transactionId)) return { status: 'replayed' } as const;
        claimedAttempts.add(input.transactionId);
        return {
          status: 'claimed',
          flow: begun.flow,
          issuer: begun.issuer,
          nonceDigest: begun.nonceDigest,
        } as const;
      }),
      rejectClaimedTransaction: jest.fn(async (input) => {
        void input;
        return { status: 'rejected' as const };
      }),
      completeLogin: jest.fn(async (input) => ({
        status: 'authenticated' as const,
        accountId: ACCOUNT_ID,
        sessionFamilyId: input.proposedSessionFamilyId,
        credentialId: input.proposedCredentialId,
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      })),
      resolveSession: jest.fn(async (input) => {
        void input;
        return {
          status: 'authenticated' as const,
          accountId: ACCOUNT_ID,
          sessionFamilyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        };
      }),
      rotateSession: jest.fn(async (input) => ({
        status: 'rotated' as const,
        credentialId: input.successorCredentialId,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
      revokeSession: jest.fn(async (input) => {
        void input;
        return { status: 'revoked' as const };
      }),
    };
    limiter = { admit: jest.fn(async () => ({ admitted: true, remainingCount: 9 })) };
    exchangeCode = jest.fn(async (input) => {
      void input;
      return {
        providerKey: PROVIDER_KEY,
        issuer: ISSUER,
        subject: parseOidcSubject('case-sensitive-subject'),
        issuedAtEpochSeconds: Math.floor(Date.now() / 1_000) - 1,
        expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 300,
      };
    });
    const oidc: OidcClientPort = {
      createAuthorizationUrl(input) {
        const url = new URL(`${ISSUER}/authorize`);
        url.searchParams.set('state', input.state);
        url.searchParams.set('nonce', input.nonce);
        url.searchParams.set('code_challenge', input.codeChallenge);
        return url;
      },
      exchangeAuthorizationCode: exchangeCode,
    };
    const module = await Test.createTestingModule({ imports: [AuthenticationModule] })
      .overrideProvider(AUTHENTICATION_CONFIG)
      .useValue(CONFIG)
      .overrideProvider(AUTHENTICATION_REPOSITORY)
      .useValue(repository)
      .overrideProvider(AUTHENTICATION_RATE_LIMITER)
      .useValue(limiter)
      .overrideProvider(OIDC_CLIENT)
      .useValue(oidc)
      .compile();

    app = module.createNestApplication();
    configureApplication(app, {
      requestLogger: new StructuredLogger({
        environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
        sink: () => undefined,
      }),
    });
    await app.init();
  });

  beforeEach(() => {
    attempts.clear();
    claimedAttempts.clear();
    jest.clearAllMocks();
    limiter.admit.mockResolvedValue({ admitted: true, remainingCount: 9 });
    exchangeCode.mockResolvedValue({
      providerKey: PROVIDER_KEY,
      issuer: ISSUER,
      subject: parseOidcSubject('case-sensitive-subject'),
      issuedAtEpochSeconds: Math.floor(Date.now() / 1_000) - 1,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 300,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('completes registration, issues secure cookies, rotates with bound CSRF, and logs out', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/v1/auth/registration')
      .set('Origin', CONFIG.publicOrigin)
      .send({
        contactEmail: 'Trey@EXAMPLE.COM',
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
        returnPath: '/dashboard?welcome=1',
      })
      .expect(303);
    const transactionHeader = setCookies(started).find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.transaction}=`),
    );
    expect(transactionHeader).toBeDefined();
    expect(transactionHeader).toContain('Secure');
    expect(transactionHeader).toContain('HttpOnly');
    expect(transactionHeader).toContain('SameSite=Lax');
    expect(transactionHeader).not.toContain('Trey@');
    const authorizationUrl = new URL(started.headers.location as string);
    const state = authorizationUrl.searchParams.get('state');
    expect(state).toHaveLength(43);

    const completed = await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?code=fixture-code&state=${state}`)
      .set('Cookie', cookiePair(transactionHeader as string))
      .expect(303);
    expect(completed.headers.location).toBe('/dashboard?welcome=1');
    expect(repository.completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'registration',
        registration: {
          contactEmail: 'Trey@example.com',
          contactPhone: null,
          declaredResidencyCountryCode: 'US',
        },
      }),
    );

    const issued = setCookies(completed);
    const sessionHeader = issued.find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.session}=`),
    );
    const csrfHeader = issued.find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.csrf}=`),
    );
    expect(sessionHeader).toContain('Secure');
    expect(sessionHeader).toContain('HttpOnly');
    expect(csrfHeader).toContain('SameSite=Strict');
    expect(csrfHeader).not.toContain('HttpOnly');
    const csrf = cookieValue(csrfHeader as string);

    const replayed = await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?code=fixture-code&state=${state}`)
      .set('Cookie', cookiePair(transactionHeader as string))
      .expect(401);
    expect(setCookies(replayed)[0]).toContain('Max-Age=0');
    expect(repository.completeLogin).toHaveBeenCalledTimes(1);

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/session/rotate')
      .set('Origin', CONFIG.publicOrigin)
      .set('X-CSRF-Token', csrf)
      .set('Cookie', `${cookiePair(sessionHeader as string)}; ${cookiePair(csrfHeader as string)}`)
      .expect(204);
    expect(repository.resolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ csrf: expect.objectContaining({ required: true }) }),
    );
    expect(repository.rotateSession).toHaveBeenCalledTimes(1);

    const rotatedCookies = setCookies(rotated);
    const rotatedSession = rotatedCookies.find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.session}=`),
    );
    const rotatedCsrf = rotatedCookies.find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.csrf}=`),
    );
    const rotatedCsrfValue = cookieValue(rotatedCsrf as string);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', CONFIG.publicOrigin)
      .set('X-CSRF-Token', rotatedCsrfValue)
      .set(
        'Cookie',
        `${cookiePair(rotatedSession as string)}; ${cookiePair(rotatedCsrf as string)}`,
      )
      .expect(204);
    expect(repository.revokeSession).toHaveBeenCalledTimes(1);
  });

  it('returns authorization URLs to explicit JSON clients without exposing the transaction cookie', async () => {
    const login = await request(app.getHttpServer())
      .get('/api/v1/auth/login?returnTo=%2Faccount')
      .set('Accept', 'application/json')
      .expect(200);
    expect(login.body).toEqual({ authorizationUrl: expect.stringMatching(/^https:\/\//u) });
    expect(login.headers.location).toBeUndefined();
    expect(login.headers.vary).toBe('Cookie, Origin, Accept');
    expect(login.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(login.body)).not.toContain(AUTHENTICATION_COOKIE_NAMES.transaction);
    expect(setCookies(login)).toEqual([
      expect.stringContaining(`${AUTHENTICATION_COOKIE_NAMES.transaction}=`),
    ]);

    const registration = await request(app.getHttpServer())
      .post('/api/v1/auth/registration')
      .set('Accept', 'application/json')
      .set('Origin', CONFIG.publicOrigin)
      .send({
        contactEmail: 'new@example.com',
        declaredResidencyCountryCode: 'US',
        returnPath: '/account',
      })
      .expect(200);
    expect(registration.body).toEqual({ authorizationUrl: expect.stringMatching(/^https:\/\//u) });
    expect(registration.headers.location).toBeUndefined();
    expect(JSON.stringify(registration.body)).not.toContain('new@example.com');
  });

  it('keeps a progressively enhanced URL-encoded registration navigation compatible', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/registration')
      .set('Origin', CONFIG.publicOrigin)
      .type('form')
      .send({
        contactEmail: 'form@example.com',
        contactPhone: '',
        declaredResidencyCountryCode: 'us',
        returnPath: '/account',
      })
      .expect(303);
    expect(response.headers.location).toMatch(/^https:\/\//u);
    expect(setCookies(response)).toEqual([
      expect.stringContaining(`${AUTHENTICATION_COOKIE_NAMES.transaction}=`),
    ]);
  });

  it('rejects non-ASCII residency input instead of normalizing it into another country', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/registration')
      .set('Origin', CONFIG.publicOrigin)
      .send({
        contactEmail: 'form@example.com',
        declaredResidencyCountryCode: 'ß',
        returnPath: '/account',
      })
      .expect(400);

    expect(repository.beginTransaction).not.toHaveBeenCalled();
  });

  it('rejects a callback state mismatch before claiming the transaction and clears it', async () => {
    const started = await request(app.getHttpServer())
      .get('/api/v1/auth/login?returnTo=%2F')
      .expect(302);
    const transactionHeader = setCookies(started).find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.transaction}=`),
    );

    const rejected = await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?code=fixture-code&state=${'A'.repeat(43)}`)
      .set('Cookie', cookiePair(transactionHeader as string))
      .expect(401);
    expect(repository.claimTransaction).not.toHaveBeenCalled();
    expect(setCookies(rejected)).toEqual([
      expect.stringContaining(`${AUTHENTICATION_COOKIE_NAMES.transaction}=`),
    ]);
    expect(setCookies(rejected)[0]).toContain('Max-Age=0');
  });

  it('returns browser callback failures to one fixed generic authentication screen', async () => {
    const started = await request(app.getHttpServer()).get('/api/v1/auth/login').expect(302);
    const transactionHeader = setCookies(started).find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.transaction}=`),
    );

    const rejected = await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?code=fixture-code&state=${'A'.repeat(43)}`)
      .set('Accept', 'text/html,application/xhtml+xml')
      .set('Cookie', cookiePair(transactionHeader as string))
      .expect(303);
    expect(rejected.headers.location).toBe('/login?error=authentication');
    expect(repository.claimTransaction).not.toHaveBeenCalled();
    expect(setCookies(rejected)[0]).toContain('Max-Age=0');
  });

  it('retains the API error contract when a caller explicitly refuses HTML', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?code=fixture-code&state=${'A'.repeat(43)}`)
      .set('Accept', 'application/json, text/html;q=0')
      .expect(401)
      .expect('Content-Type', /json/u);
  });

  it('returns a bounded 429 without beginning an OIDC transaction when rate limited', async () => {
    limiter.admit.mockResolvedValueOnce({ admitted: false, retryAfterSeconds: 17 });
    const response = await request(app.getHttpServer()).get('/api/v1/auth/login').expect(429);
    expect(response.headers['retry-after']).toBe('17');
    expect(repository.beginTransaction).not.toHaveBeenCalled();
  });

  it('clears a definitively claimed callback cookie when the provider becomes unavailable', async () => {
    const started = await request(app.getHttpServer()).get('/api/v1/auth/login').expect(302);
    const transactionHeader = setCookies(started).find((header) =>
      header.startsWith(`${AUTHENTICATION_COOKIE_NAMES.transaction}=`),
    ) as string;
    const state = new URL(started.headers.location as string).searchParams.get('state');
    exchangeCode.mockRejectedValueOnce(
      Object.assign(new Error('fixture provider unavailable'), {
        code: 'OIDC_TOKEN_SERVICE_UNAVAILABLE',
      }),
    );

    const response = await request(app.getHttpServer())
      .get(`/api/v1/auth/callback?code=fixture-code&state=${state}`)
      .set('Cookie', cookiePair(transactionHeader))
      .expect(503);
    expect(setCookies(response)[0]).toContain('Max-Age=0');
    expect(repository.rejectClaimedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'PROVIDER_ERROR' }),
    );
  });

  it('clears stale session cookies when rotation detects replay', async () => {
    repository.resolveSession.mockResolvedValueOnce({ status: 'replayed' });
    const credentialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const session = `${AUTHENTICATION_COOKIE_NAMES.session}=${credentialId}.${'A'.repeat(43)}`;
    const csrf = 'B'.repeat(43);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/session/rotate')
      .set('Origin', CONFIG.publicOrigin)
      .set('X-CSRF-Token', csrf)
      .set('Cookie', `${session}; ${AUTHENTICATION_COOKIE_NAMES.csrf}=${csrf}`)
      .expect(401);
    expect(setCookies(response)).toHaveLength(2);
    expect(setCookies(response).every((header) => header.includes('Max-Age=0'))).toBe(true);
    expect(repository.rotateSession).not.toHaveBeenCalled();
  });

  it('rejects untrusted unsafe origins without clearing or resolving session cookies', async () => {
    const credentialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const session = `${AUTHENTICATION_COOKIE_NAMES.session}=${credentialId}.${'A'.repeat(43)}`;
    const csrf = 'B'.repeat(43);

    for (const endpoint of ['/api/v1/auth/session/rotate', '/api/v1/auth/logout']) {
      const response = await request(app.getHttpServer())
        .post(endpoint)
        .set('Origin', 'https://attacker.invalid')
        .set('X-CSRF-Token', csrf)
        .set('Cookie', `${session}; ${AUTHENTICATION_COOKIE_NAMES.csrf}=${csrf}`)
        .expect(401);
      expect(setCookies(response)).toEqual([]);
    }

    expect(repository.resolveSession).not.toHaveBeenCalled();
    expect(repository.rotateSession).not.toHaveBeenCalled();
    expect(repository.revokeSession).not.toHaveBeenCalled();
  });
});
