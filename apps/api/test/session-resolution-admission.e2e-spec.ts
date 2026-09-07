import { Buffer } from 'node:buffer';

import { Controller, Get, UseGuards, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AccountAuthGuard } from '../src/accounts/auth/account-auth.guard';
import { CURRENT_PRINCIPAL_RESOLVER } from '../src/accounts/auth/current-principal';
import { AuthenticationService } from '../src/authentication/application/authentication.service';
import { AUTHENTICATION_RATE_LIMITER } from '../src/authentication/application/ports/authentication-rate-limiter.port';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepositoryPort,
} from '../src/authentication/application/ports/authentication-repository.port';
import { OIDC_CLIENT } from '../src/authentication/application/ports/oidc-client.port';
import { parseOidcProviderKey } from '../src/authentication/domain/authentication';
import { AuthenticationClientAddressResolver } from '../src/authentication/http/authentication-client-address';
import { AUTHENTICATION_CLIENT_ADDRESS_CONFIG } from '../src/authentication/infrastructure/config/authentication-client-address.config';
import {
  AUTHENTICATION_CONFIG,
  type RuntimeAuthenticationConfig,
} from '../src/authentication/infrastructure/config/authentication-config.provider';
import {
  createAuthenticationHmacKeyRing,
  createAuthenticationKey,
} from '../src/authentication/infrastructure/crypto/authentication-crypto';
import { SessionCurrentPrincipalResolver } from '../src/authentication/infrastructure/session-current-principal.resolver';
import { SessionResolutionAdmission } from '../src/authentication/infrastructure/session-resolution-admission';
import { configureApplication } from '../src/application';
import { StructuredLogger } from '../src/infrastructure/logging';

@Controller('session-resolution-probe')
@UseGuards(AccountAuthGuard)
class SessionResolutionProbeController {
  @Get()
  read(): Readonly<{ status: 'ok' }> {
    return Object.freeze({ status: 'ok' });
  }
}

function encodedKey(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

const PREAUTH_KEY = createAuthenticationKey('preauth-seal', 'preauth', encodedKey(1));
const IDENTITY_KEY = createAuthenticationKey('identity-hmac', 'identity', encodedKey(2));
const SESSION_KEY = createAuthenticationKey('session-hmac', 'session', encodedKey(3));
const CSRF_KEY = createAuthenticationKey('csrf-hmac', 'csrf', encodedKey(4));
const AUTHENTICATION_CONFIG_VALUE: RuntimeAuthenticationConfig = Object.freeze({
  mode: 'oidc',
  localDemo: false,
  providerKey: parseOidcProviderKey('cognito'),
  issuer: 'https://identity.example',
  authorizationEndpoint: 'https://identity.example/authorize',
  tokenEndpoint: 'https://identity.example/token',
  jwksUri: 'https://identity.example/jwks',
  clientId: 'test-client',
  audience: 'test-client',
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
  preAuthenticationSealKey: PREAUTH_KEY,
  preAuthenticationSealKeys: Object.freeze([PREAUTH_KEY]),
  identityHmacKeys: createAuthenticationHmacKeyRing('identity-hmac', 1, [IDENTITY_KEY]),
  sessionHmacKeys: createAuthenticationHmacKeyRing('session-hmac', 1, [SESSION_KEY]),
  csrfHmacKeys: createAuthenticationHmacKeyRing('csrf-hmac', 1, [CSRF_KEY]),
  identityHmacKey: IDENTITY_KEY,
  sessionHmacKey: SESSION_KEY,
  csrfHmacKey: CSRF_KEY,
});

const BOGUS_SESSION_COOKIE = `__Host-cl_session=00000000-0000-4000-8000-000000000001.${'a'.repeat(43)}`;
const SOURCE_ADDRESS = '198.51.100.70';

function fromTrustedProxy(test: request.Test, sourceAddress = SOURCE_ADDRESS): request.Test {
  return test.set('X-Forwarded-For', sourceAddress);
}

async function waitForCalls(readCount: () => number, count: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && readCount() < count; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (readCount() !== count) {
    throw new Error(`Expected ${count} admitted repository calls`);
  }
}

describe('session resolution admission HTTP boundary (e2e)', () => {
  let app: INestApplication;
  let repository: jest.Mocked<AuthenticationRepositoryPort>;

  beforeAll(async () => {
    repository = {
      beginTransaction: jest.fn(),
      claimTransaction: jest.fn(),
      rejectClaimedTransaction: jest.fn(),
      completeLogin: jest.fn(),
      resolveSession: jest.fn(),
      rotateSession: jest.fn(),
      revokeSession: jest.fn(),
    };
    const admission = new SessionResolutionAdmission({
      maxConcurrentResolutions: 2,
      maxTrackedSources: 16,
      sourceRequestLimit: 20,
      sourceWindowMilliseconds: 60_000,
    });
    const module = await Test.createTestingModule({
      controllers: [SessionResolutionProbeController],
      providers: [
        AccountAuthGuard,
        AuthenticationService,
        AuthenticationClientAddressResolver,
        SessionCurrentPrincipalResolver,
        { provide: CURRENT_PRINCIPAL_RESOLVER, useExisting: SessionCurrentPrincipalResolver },
        { provide: AUTHENTICATION_CONFIG, useValue: AUTHENTICATION_CONFIG_VALUE },
        {
          provide: AUTHENTICATION_CLIENT_ADDRESS_CONFIG,
          useValue: {
            mode: 'trusted-single-proxy',
            trustedProxyRanges: [
              { address: '127.0.0.0', prefixLength: 8, family: 'ipv4' },
              { address: '::ffff:7f00:0', prefixLength: 104, family: 'ipv6' },
            ],
          },
        },
        { provide: SessionResolutionAdmission, useValue: admission },
        { provide: AUTHENTICATION_REPOSITORY, useValue: repository },
        {
          provide: AUTHENTICATION_RATE_LIMITER,
          useValue: { admit: jest.fn() },
        },
        { provide: OIDC_CLIENT, useValue: null },
      ],
    }).compile();

    app = module.createNestApplication();
    configureApplication(app, {
      requestLogger: new StructuredLogger({
        environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
        sink: () => undefined,
      }),
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects bad proxy input pre-DB, caps bogus-cookie resolution, and recovers', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/session-resolution-probe')
      .set('Cookie', BOGUS_SESSION_COOKIE)
      .set('X-Forwarded-For', `${SOURCE_ADDRESS}, 203.0.113.1`)
      .expect(401);
    expect(repository.resolveSession).not.toHaveBeenCalled();

    let finishRepositoryCalls: (() => void) | undefined;
    const repositoryGate = new Promise<void>((resolve) => {
      finishRepositoryCalls = resolve;
    });
    repository.resolveSession.mockImplementation(async () => {
      await repositoryGate;
      return { status: 'invalid' };
    });

    const first = Promise.resolve(
      fromTrustedProxy(
        request(app.getHttpServer())
          .get('/api/v1/session-resolution-probe')
          .set('Cookie', BOGUS_SESSION_COOKIE),
      ).expect(401),
    );
    const second = Promise.resolve(
      fromTrustedProxy(
        request(app.getHttpServer())
          .get('/api/v1/session-resolution-probe')
          .set('Cookie', BOGUS_SESSION_COOKIE),
      ).expect(401),
    );
    await waitForCalls(() => repository.resolveSession.mock.calls.length, 2);

    try {
      const rejected = await fromTrustedProxy(
        request(app.getHttpServer())
          .get('/api/v1/session-resolution-probe')
          .set('Cookie', BOGUS_SESSION_COOKIE),
      ).expect(429);
      expect(rejected.body.message).toBe('Authentication request rejected');
      expect(rejected.headers['retry-after']).toBe('1');
      expect(repository.resolveSession).toHaveBeenCalledTimes(2);
    } finally {
      finishRepositoryCalls?.();
      await Promise.all([first, second]);
    }

    repository.resolveSession.mockResolvedValue({ status: 'invalid' });
    await fromTrustedProxy(
      request(app.getHttpServer())
        .get('/api/v1/session-resolution-probe')
        .set('Cookie', BOGUS_SESSION_COOKIE),
    ).expect(401);
    expect(repository.resolveSession).toHaveBeenCalledTimes(3);
  });
});
