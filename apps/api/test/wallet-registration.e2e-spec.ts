import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { parseAccountId } from '../src/accounts/domain/account-profile';
import { AccountAuthGuard } from '../src/accounts/auth/account-auth.guard';
import {
  CURRENT_PRINCIPAL_RESOLVER,
  type CurrentPrincipalResolver,
} from '../src/accounts/auth/current-principal';
import { configureApplication } from '../src/application';
import {
  WalletOwnershipConflictError,
  WalletRegistrationRateLimitedError,
  WalletRegistrationRejectedError,
  WalletRegistrationUnavailableError,
} from '../src/wallets/application/wallet-registration.errors';
import { WalletRegistrationService } from '../src/wallets/application/wallet-registration.service';
import { WalletRegistrationController } from '../src/wallets/http/wallet-registration.controller';
import { WalletRegistrationPrivacyInterceptor } from '../src/wallets/http/wallet-registration-privacy.interceptor';
import { StructuredLogger } from '../src/infrastructure/logging';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const PUBLIC_ORIGIN = 'https://app.example';
const CSRF_TOKEN = 'fixture-csrf-token';
const COOKIE = `fixture_session=opaque-session; fixture_csrf=${CSRF_TOKEN}`;
const EVM_ADDRESS = '0xde709f2102306220921060314715629080e2fb77';
const EVM_SIGNATURE = `0x${'ab'.repeat(65)}`;
const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface HttpRequestFixture {
  readonly method?: unknown;
  readonly headers?: Readonly<Record<string, unknown>>;
}

function hasBoundBrowserSession(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const fixture = value as HttpRequestFixture;
  return (
    fixture.method === 'POST' &&
    fixture.headers?.cookie === COOKIE &&
    fixture.headers.origin === PUBLIC_ORIGIN &&
    fixture.headers['x-csrf-token'] === CSRF_TOKEN
  );
}

function authenticate(test: request.Test): request.Test {
  return test.set('Cookie', COOKIE).set('Origin', PUBLIC_ORIGIN).set('X-CSRF-Token', CSRF_TOKEN);
}

function expectPrivate(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers.vary).toBe('Cookie, Origin');
}

describe('wallet registration HTTP boundary (e2e)', () => {
  let app: INestApplication;
  let resolver: { resolve: jest.Mock };
  let wallets: { issueChallenge: jest.Mock; submitProof: jest.Mock };

  beforeAll(async () => {
    resolver = {
      resolve: jest.fn(async (value: unknown) =>
        hasBoundBrowserSession(value) ? { accountId: ACCOUNT_ID } : null,
      ),
    };
    wallets = {
      issueChallenge: jest.fn(),
      submitProof: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [WalletRegistrationController],
      providers: [
        AccountAuthGuard,
        WalletRegistrationPrivacyInterceptor,
        {
          provide: CURRENT_PRINCIPAL_RESOLVER,
          useValue: resolver satisfies CurrentPrincipalResolver,
        },
        { provide: WalletRegistrationService, useValue: wallets },
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

  beforeEach(() => {
    jest.clearAllMocks();
    resolver.resolve.mockImplementation(async (value: unknown) =>
      hasBoundBrowserSession(value) ? { accountId: ACCOUNT_ID } : null,
    );
    wallets.issueChallenge.mockResolvedValue({
      version: 1,
      challengeId: CHALLENGE_ID,
      messageFormat: 'SIWE',
      chainId: 'eip155:11155111',
      address: EVM_ADDRESS,
      accountId: `eip155:11155111:${EVM_ADDRESS}`,
      message: 'exact server-authored message',
      expiresAt: '2026-08-22T17:05:00.000Z',
      registryEnvironment: 'TESTNET',
      registryVersion: 1,
      registryFingerprintSha256: 'a'.repeat(64),
    });
    wallets.submitProof.mockResolvedValue({
      status: 'registered',
      walletId: WALLET_ID,
      chainId: 'eip155:11155111',
      address: EVM_ADDRESS,
      registeredAt: new Date('2026-08-22T17:00:00.000Z'),
      registryEnvironment: 'TESTNET',
      registryVersion: 1,
      registryFingerprintSha256: 'a'.repeat(64),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['missing session, origin, and CSRF', {}],
    ['missing origin and CSRF', { Cookie: COOKIE }],
    ['missing CSRF header', { Cookie: COOKIE, Origin: PUBLIC_ORIGIN }],
    [
      'wrong origin',
      { Cookie: COOKIE, Origin: 'https://attacker.example', 'X-CSRF-Token': CSRF_TOKEN },
    ],
    ['wrong CSRF header', { Cookie: COOKIE, Origin: PUBLIC_ORIGIN, 'X-CSRF-Token': 'wrong-token' }],
  ])(
    'rejects %s through the session resolver before invoking wallet code',
    async (_label, headers) => {
      let pending = request(app.getHttpServer())
        .post('/api/v1/wallets/ownership-challenges')
        .send({ chainId: 'eip155:11155111', address: EVM_ADDRESS });
      for (const [name, value] of Object.entries(headers)) pending = pending.set(name, value);

      const response = await pending.expect(401);

      expect(response.body).toEqual({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
      expectPrivate(response);
      expect(wallets.issueChallenge).not.toHaveBeenCalled();
      expect(wallets.submitProof).not.toHaveBeenCalled();
    },
  );

  it('runs AccountAuthGuard before the custom body parser or wallet service', async () => {
    const malformed = { chainId: ['not-text'], address: { nested: true } };

    const unauthenticated = await request(app.getHttpServer())
      .post('/api/v1/wallets/ownership-challenges')
      .send(malformed)
      .expect(401);
    expect(unauthenticated.body.message).toBe('Authentication required');
    expect(wallets.issueChallenge).not.toHaveBeenCalled();

    const authenticated = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-challenges'),
    )
      .send(malformed)
      .expect(400);
    expect(authenticated.body.message).toBe('Wallet challenge request rejected');
    expect(wallets.issueChallenge).not.toHaveBeenCalled();
  });

  it('returns the issued challenge with private headers and trusted principal wiring', async () => {
    const response = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-challenges'),
    )
      .send({ chainId: 'eip155:11155111', address: EVM_ADDRESS })
      .expect(201);

    expect(response.body).toMatchObject({
      challengeId: CHALLENGE_ID,
      chainId: 'eip155:11155111',
      address: EVM_ADDRESS,
      message: 'exact server-authored message',
    });
    expectPrivate(response);
    expect(wallets.issueChallenge).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      chainId: 'eip155:11155111',
      address: EVM_ADDRESS,
      correlationId: expect.stringMatching(CORRELATION_ID_PATTERN),
    });
  });

  it('wires a strict EVM proof and selects 201 versus idempotent 200', async () => {
    const proof = {
      kind: 'EVM_EIP191_EOA',
      challengeId: CHALLENGE_ID,
      message: 'exact server-authored message',
      signature: EVM_SIGNATURE,
    };
    const created = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-proofs'),
    )
      .send(proof)
      .expect(201);

    expect(created.body).toMatchObject({
      status: 'registered',
      walletId: WALLET_ID,
      registeredAt: '2026-08-22T17:00:00.000Z',
    });
    expectPrivate(created);
    expect(wallets.submitProof).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      proof,
      correlationId: expect.stringMatching(CORRELATION_ID_PATTERN),
    });

    wallets.submitProof.mockResolvedValueOnce({
      ...created.body,
      status: 'already_registered',
    });
    const idempotent = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-proofs'),
    )
      .send(proof)
      .expect(200);
    expect(idempotent.body.status).toBe('already_registered');
    expectPrivate(idempotent);
  });

  it('maps malformed and rejected proof material to the same generic 401', async () => {
    const malformed = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-proofs'),
    )
      .send({
        kind: 'EVM_EIP191_EOA',
        challengeId: 'not-a-uuid',
        message: 'raw message must not echo',
        signature: 'not-a-signature',
      })
      .expect(401);
    expect(malformed.body.message).toBe('Wallet ownership proof rejected');
    expectPrivate(malformed);
    expect(wallets.submitProof).not.toHaveBeenCalled();

    wallets.submitProof.mockRejectedValueOnce(new WalletRegistrationRejectedError());
    const rejected = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-proofs'),
    )
      .send({
        kind: 'EVM_EIP191_EOA',
        challengeId: CHALLENGE_ID,
        message: 'exact server-authored message',
        signature: EVM_SIGNATURE,
      })
      .expect(401);
    expect(rejected.body).toEqual(malformed.body);
    expectPrivate(rejected);
  });

  it('maps malformed challenge requests to a generic 400', async () => {
    const response = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-challenges'),
    )
      .send({ chainId: 'eip155:11155111', address: EVM_ADDRESS, attacker: true })
      .expect(400);

    expect(response.body).toEqual({
      error: 'Bad Request',
      message: 'Wallet challenge request rejected',
      statusCode: 400,
    });
    expectPrivate(response);
    expect(wallets.issueChallenge).not.toHaveBeenCalled();
  });

  it('maps ownership conflict to a generic private 409', async () => {
    wallets.submitProof.mockRejectedValueOnce(new WalletOwnershipConflictError());

    const response = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-proofs'),
    )
      .send({
        kind: 'EVM_EIP191_EOA',
        challengeId: CHALLENGE_ID,
        message: 'exact server-authored message',
        signature: EVM_SIGNATURE,
      })
      .expect(409);

    expect(response.body).toEqual({
      error: 'Conflict',
      message: 'Wallet ownership proof conflicts with an existing wallet',
      statusCode: 409,
    });
    expectPrivate(response);
  });

  it('maps an unavailable dependency to a generic private 503', async () => {
    wallets.issueChallenge.mockRejectedValueOnce(new WalletRegistrationUnavailableError());

    const response = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-challenges'),
    )
      .send({ chainId: 'eip155:11155111', address: EVM_ADDRESS })
      .expect(503);

    expect(response.body).toEqual({
      error: 'Service Unavailable',
      message: 'Wallet registration unavailable',
      statusCode: 503,
    });
    expect(response.headers['retry-after']).toBe('1');
    expectPrivate(response);
  });

  it('maps challenge throttling to bounded 429 metadata without leaking a subject', async () => {
    wallets.issueChallenge.mockRejectedValueOnce(new WalletRegistrationRateLimitedError(17));

    const response = await authenticate(
      request(app.getHttpServer()).post('/api/v1/wallets/ownership-challenges'),
    )
      .send({ chainId: 'eip155:11155111', address: EVM_ADDRESS })
      .expect(429);

    expect(response.headers['retry-after']).toBe('17');
    expect(response.body).toEqual({
      statusCode: 429,
      message: 'Wallet challenge request rate limited',
    });
    expect(JSON.stringify(response.body)).not.toContain(ACCOUNT_ID);
    expect(JSON.stringify(response.body)).not.toContain(EVM_ADDRESS);
    expectPrivate(response);
  });
});
