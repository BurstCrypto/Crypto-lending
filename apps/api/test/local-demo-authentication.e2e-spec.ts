import { Buffer } from 'node:buffer';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { parseAccountId } from '../src/accounts/domain/account-profile';
import { configureApplication } from '../src/application';
import { AUTHENTICATION_RATE_LIMITER } from '../src/authentication/application/ports/authentication-rate-limiter.port';
import {
  AUTHENTICATION_REPOSITORY,
  type AuthenticationRepositoryPort,
} from '../src/authentication/application/ports/authentication-repository.port';
import {
  OIDC_CLIENT,
  type OidcClientPort,
} from '../src/authentication/application/ports/oidc-client.port';
import { parseOidcProviderKey } from '../src/authentication/domain/authentication';
import { AUTHENTICATION_COOKIE_NAMES } from '../src/authentication/http/authentication-cookies';
import { formatAuthenticationSessionCookie } from '../src/authentication/http/authentication-session-cookie';
import {
  AUTHENTICATION_CONFIG,
  type RuntimeAuthenticationConfig,
} from '../src/authentication/infrastructure/config/authentication-config.provider';
import {
  createAuthenticationKey,
  generateOpaqueAuthenticationSecret,
} from '../src/authentication/infrastructure/crypto/authentication-crypto';
import { StructuredLogger } from '../src/infrastructure/logging';
import { LocalDemoModule } from '../src/local-demo/local-demo.module';
import { LOCAL_DEMO_RUNTIME_CONFIG } from '../src/local-demo/local-demo-runtime.config';
import {
  type LocalDemoWalletConnection,
  LocalDemoWalletService,
} from '../src/local-demo/local-demo-wallet.service';

const LOCAL_ORIGIN = 'http://127.0.0.1:3000';
const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CREDENTIAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function encodedKey(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

const CONFIG: RuntimeAuthenticationConfig = Object.freeze({
  mode: 'oidc',
  localDemo: true,
  providerKey: parseOidcProviderKey('local_demo'),
  issuer: 'http://127.0.0.1:3400/local-demo',
  authorizationEndpoint: 'http://127.0.0.1:3400/authorize',
  tokenEndpoint: 'http://127.0.0.1:3400/token',
  jwksUri: 'http://127.0.0.1:3400/jwks.json',
  clientId: 'crypto-lending-local-demo',
  audience: 'crypto-lending-local-demo',
  signingAlgorithm: 'ES256',
  tokenEndpointAuthenticationMethod: 'none',
  publicOrigin: LOCAL_ORIGIN,
  redirectUri: `${LOCAL_ORIGIN}/api/v1/auth/callback`,
  httpTimeoutMs: 1_000,
  tokenResponseMaxBytes: 16_384,
  jwksResponseMaxBytes: 65_536,
  jwksCacheTtlSeconds: 30,
  clockToleranceSeconds: 5,
  maximumIdTokenAgeSeconds: 300,
  preAuthenticationTtlSeconds: 300,
  sessionIdleTtlSeconds: 3_600,
  sessionAbsoluteTtlSeconds: 28_800,
  preAuthenticationSealKey: createAuthenticationKey('preauth-seal', 'preauth', encodedKey(1)),
  identityHmacKey: createAuthenticationKey('identity-hmac', 'identity', encodedKey(2)),
  sessionHmacKey: createAuthenticationKey('session-hmac', 'session', encodedKey(3)),
  csrfHmacKey: createAuthenticationKey('csrf-hmac', 'csrf', encodedKey(4)),
});

describe('local demo authentication boundary (e2e)', () => {
  let app: INestApplication;
  let repository: jest.Mocked<AuthenticationRepositoryPort>;
  let wallets: {
    connect: jest.Mock<Promise<LocalDemoWalletConnection>, [unknown]>;
    disconnect: jest.Mock<void, [unknown, unknown]>;
    list: jest.Mock<readonly LocalDemoWalletConnection[], [unknown]>;
  };

  const sessionSecret = generateOpaqueAuthenticationSecret('session');
  const csrf = generateOpaqueAuthenticationSecret('csrf');
  const session = formatAuthenticationSessionCookie(CREDENTIAL_ID, sessionSecret);
  const cookie = `${AUTHENTICATION_COOKIE_NAMES.session}=${session}; ${AUTHENTICATION_COOKIE_NAMES.csrf}=${csrf}`;
  const connection: LocalDemoWalletConnection = Object.freeze({
    connectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    walletId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    label: 'Synthetic EVM wallet',
    namespace: 'EVM',
    chainId: 'eip155:11155111',
    address: '0x1111111111111111111111111111111111111111',
    registeredAt: '2026-08-24T00:00:00.000Z',
  });

  beforeAll(async () => {
    repository = {
      beginTransaction: jest.fn(async (input) => ({
        transactionId: input.transactionId,
        expiresAt: new Date(Date.now() + 300_000),
      })),
      claimTransaction: jest.fn(
        async (_input: Parameters<AuthenticationRepositoryPort['claimTransaction']>[0]) => ({
          status: 'invalid' as const,
        }),
      ),
      rejectClaimedTransaction: jest.fn(
        async (
          _input: Parameters<AuthenticationRepositoryPort['rejectClaimedTransaction']>[0],
        ) => ({ status: 'invalid' as const }),
      ),
      completeLogin: jest.fn(
        async (_input: Parameters<AuthenticationRepositoryPort['completeLogin']>[0]) => ({
          status: 'rejected' as const,
        }),
      ),
      resolveSession: jest.fn(
        async (_input: Parameters<AuthenticationRepositoryPort['resolveSession']>[0]) => ({
          status: 'authenticated' as const,
          accountId: ACCOUNT_ID,
          sessionFamilyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        }),
      ),
      rotateSession: jest.fn(
        async (_input: Parameters<AuthenticationRepositoryPort['rotateSession']>[0]) => ({
          status: 'invalid' as const,
        }),
      ),
      revokeSession: jest.fn(
        async (_input: Parameters<AuthenticationRepositoryPort['revokeSession']>[0]) => ({
          status: 'revoked' as const,
        }),
      ),
    };
    wallets = {
      connect: jest.fn(async (_input: unknown) => connection),
      disconnect: jest.fn((_accountId: unknown, _connectionId: unknown) => undefined),
      list: jest.fn((_accountId: unknown) => [connection]),
    };
    const oidc: OidcClientPort = {
      createAuthorizationUrl(input) {
        return new URL(`http://127.0.0.1:3400/authorize?state=${input.state}`);
      },
      exchangeAuthorizationCode: jest.fn(async () => {
        throw new Error('not exercised');
      }),
    };
    const module = await Test.createTestingModule({ imports: [LocalDemoModule] })
      .overrideProvider(AUTHENTICATION_CONFIG)
      .useValue(CONFIG)
      .overrideProvider(AUTHENTICATION_REPOSITORY)
      .useValue(repository)
      .overrideProvider(AUTHENTICATION_RATE_LIMITER)
      .useValue({ admit: jest.fn(async () => ({ admitted: true, remainingCount: 9 })) })
      .overrideProvider(OIDC_CLIENT)
      .useValue(oidc)
      .overrideProvider(LOCAL_DEMO_RUNTIME_CONFIG)
      .useValue({ mode: 'enabled', apiHost: '127.0.0.1', publicOrigin: LOCAL_ORIGIN })
      .overrideProvider(LocalDemoWalletService)
      .useValue(wallets)
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
    jest.clearAllMocks();
    repository.resolveSession.mockResolvedValue({
      status: 'authenticated',
      accountId: ACCOUNT_ID,
      sessionFamilyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });
    wallets.connect.mockResolvedValue(connection);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts registration only from the fixed local-demo HTTP origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/registration')
      .set('Accept', 'application/json')
      .set('Origin', LOCAL_ORIGIN)
      .send({
        contactEmail: 'demo@example.invalid',
        declaredResidencyCountryCode: 'US',
        returnPath: '/portfolio',
      })
      .expect(200);
    expect(repository.beginTransaction).toHaveBeenCalledTimes(1);

    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3001',
      'https://127.0.0.1:3000',
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/registration')
        .set('Accept', 'application/json')
        .set('Origin', origin)
        .send({
          contactEmail: 'demo@example.invalid',
          declaredResidencyCountryCode: 'US',
          returnPath: '/portfolio',
        })
        .expect(401);
    }
    expect(repository.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it('passes the real guard, CSRF, and privacy boundaries for wallet mutations', async () => {
    const connected = await request(app.getHttpServer())
      .post('/api/v1/local-demo/wallets')
      .set('Origin', LOCAL_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .set('Cookie', cookie)
      .send({ namespace: 'EVM' })
      .expect(201)
      .expect(connection);

    expect(connected.headers).toMatchObject({
      'cache-control': 'private, no-store, max-age=0',
      vary: 'Cookie, Origin',
      'x-crypto-lending-demo-mode': 'synthetic-local',
    });

    expect(repository.resolveSession).toHaveBeenCalledWith(
      expect.objectContaining({ csrf: expect.objectContaining({ required: true }) }),
    );
    expect(wallets.connect).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, namespace: 'EVM' }),
    );

    const disconnected = await request(app.getHttpServer())
      .delete('/api/v1/local-demo/wallets')
      .set('Origin', LOCAL_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .set('Cookie', cookie)
      .send({ connectionId: connection.connectionId })
      .expect(204);
    expect(disconnected.headers).toMatchObject({
      'cache-control': 'private, no-store, max-age=0',
      vary: 'Cookie, Origin',
      'x-crypto-lending-demo-mode': 'synthetic-local',
    });
    expect(wallets.disconnect).toHaveBeenCalledWith(ACCOUNT_ID, connection.connectionId);
  });

  it('rejects aliases and wrong ports before wallet mutation', async () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3001']) {
      await request(app.getHttpServer())
        .delete('/api/v1/local-demo/wallets')
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf)
        .set('Cookie', cookie)
        .send({ connectionId: connection.connectionId })
        .expect(401);
    }

    expect(wallets.disconnect).not.toHaveBeenCalled();
  });
});
