import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type {
  AccountProfileAuditContext,
  AccountProfileRepository,
  AccountProfileUpdateResult,
} from '../src/accounts/application/account-profile.repository.port';
import { ACCOUNT_PROFILE_REPOSITORY } from '../src/accounts/application/account-profile.repository.port';
import {
  CURRENT_PRINCIPAL_RESOLVER,
  type CurrentPrincipalResolver,
} from '../src/accounts/auth/current-principal';
import {
  parseAccountId,
  type AccountId,
  type AccountProfile,
  type CreateAccountProfileInput,
  type UpdateAccountProfileInput,
} from '../src/accounts/domain/account-profile';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { StructuredLogger, type StructuredLogRecord } from '../src/infrastructure/logging';

const ACCOUNT_A = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const ACCOUNT_B = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const ACCOUNT_UNMAPPED = parseAccountId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

function profile(accountId: AccountId, email: string): AccountProfile {
  return {
    accountId,
    contactEmail: email,
    contactPhone: null,
    declaredResidencyCountryCode: 'US',
    eligibilityStatus: 'UNKNOWN',
    version: 1,
    createdAt: new Date('2026-08-20T16:00:00.000Z'),
    updatedAt: new Date('2026-08-20T16:00:00.000Z'),
  };
}

class InMemoryAccountProfileRepository implements AccountProfileRepository {
  readonly auditContexts: AccountProfileAuditContext[] = [];
  readonly profiles = new Map<AccountId, AccountProfile>([
    [ACCOUNT_A, profile(ACCOUNT_A, 'alpha@example.com')],
    [ACCOUNT_B, profile(ACCOUNT_B, 'bravo@example.com')],
  ]);

  findByAccountId(accountId: AccountId): Promise<AccountProfile | null> {
    return Promise.resolve(this.profiles.get(accountId) ?? null);
  }

  provisionForAccount(
    input: CreateAccountProfileInput,
    auditContext: AccountProfileAuditContext,
  ): Promise<AccountProfile> {
    void auditContext;
    const existing = this.profiles.get(input.accountId);
    if (existing) return Promise.resolve(existing);
    const created = profile(input.accountId, input.contactEmail);
    this.profiles.set(input.accountId, created);
    return Promise.resolve(created);
  }

  update(
    accountId: AccountId,
    expectedVersion: number,
    input: UpdateAccountProfileInput,
    auditContext: AccountProfileAuditContext,
  ): Promise<AccountProfileUpdateResult> {
    const current = this.profiles.get(accountId);
    if (!current) return Promise.resolve({ status: 'not-found' });
    if (current.version !== expectedVersion) return Promise.resolve({ status: 'stale' });
    this.auditContexts.push(auditContext);

    const updated: AccountProfile = {
      ...current,
      ...(input.contactEmail === undefined ? {} : { contactEmail: input.contactEmail }),
      ...(input.contactPhone === undefined ? {} : { contactPhone: input.contactPhone }),
      ...(input.declaredResidencyCountryCode === undefined
        ? {}
        : { declaredResidencyCountryCode: input.declaredResidencyCountryCode }),
      eligibilityStatus: 'UNKNOWN',
      version: current.version + 1,
      updatedAt: new Date(current.updatedAt.getTime() + 1_000),
    };
    this.profiles.set(accountId, updated);
    return Promise.resolve({ status: 'updated', profile: updated });
  }
}

const resolver: CurrentPrincipalResolver = {
  resolve(requestValue: unknown) {
    const requestHeaders = (requestValue as { headers?: { authorization?: unknown } }).headers;
    const authorization = requestHeaders?.authorization;
    if (authorization === 'Bearer test-token-a') return { accountId: ACCOUNT_A };
    if (authorization === 'Bearer test-token-b') return { accountId: ACCOUNT_B };
    if (authorization === 'Bearer test-token-unmapped') return { accountId: ACCOUNT_UNMAPPED };
    return null;
  },
};

describe('account profile (e2e)', () => {
  let app: INestApplication;
  let repository: InMemoryAccountProfileRepository;
  let loggingLines: string[];

  beforeAll(async () => {
    repository = new InMemoryAccountProfileRepository();
    loggingLines = [];
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CURRENT_PRINCIPAL_RESOLVER)
      .useValue(resolver)
      .overrideProvider(ACCOUNT_PROFILE_REPOSITORY)
      .useValue(repository)
      .compile();

    app = testingModule.createNestApplication();
    configureApplication(app, {
      requestLogger: new StructuredLogger({
        environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
        sink: (line) => loggingLines.push(line),
      }),
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates before body validation and ignores spoofed identity headers', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/accounts/me')
      .set('X-User-ID', ACCOUNT_A)
      .send({ accountId: ACCOUNT_B, eligibilityStatus: 'ELIGIBLE' })
      .expect(401);

    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      'www-authenticate': 'Bearer',
    });
    expect(JSON.stringify(response.body)).not.toContain(ACCOUNT_A);
    expect(JSON.stringify(response.body)).not.toContain(ACCOUNT_B);
  });

  it('reads only the authenticated account with private caching and an account-bound ETag', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/accounts/me')
      .set('Authorization', 'Bearer test-token-a')
      .set('X-Account-ID', ACCOUNT_B)
      .query({ accountId: ACCOUNT_B })
      .expect(200);

    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      etag: `"account-profile:${ACCOUNT_A}:1"`,
      vary: 'Authorization',
    });
    expect(response.body).toEqual({
      accountId: ACCOUNT_A,
      contactEmail: 'alpha@example.com',
      contactPhone: null,
      declaredResidencyCountryCode: 'US',
      eligibilityStatus: 'UNKNOWN',
      version: 1,
      createdAt: '2026-08-20T16:00:00.000Z',
      updatedAt: '2026-08-20T16:00:00.000Z',
    });
  });

  it('returns a generic 404 for an authenticated but unmapped account', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/accounts/me')
      .set('Authorization', 'Bearer test-token-unmapped')
      .expect(404);

    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      vary: 'Authorization',
    });
    expect(JSON.stringify(response.body)).not.toContain(ACCOUNT_UNMAPPED);
  });

  it('requires an exact strong If-Match value bound to the current account', async () => {
    const missing = await request(app.getHttpServer())
      .patch('/api/v1/accounts/me')
      .set('Authorization', 'Bearer test-token-a')
      .send({ contactEmail: 'next@example.com' })
      .expect(428);
    expect(missing.headers).toMatchObject({
      'cache-control': 'private, no-store',
      vary: 'Authorization',
    });

    for (const value of [
      '*',
      'W/"account-profile:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1"',
      `"account-profile:${ACCOUNT_B}:1"`,
      `"account-profile:${ACCOUNT_A}:1", "account-profile:${ACCOUNT_A}:2"`,
    ]) {
      const stale = await request(app.getHttpServer())
        .patch('/api/v1/accounts/me')
        .set('Authorization', 'Bearer test-token-a')
        .set('If-Match', value)
        .send({ contactEmail: 'next@example.com' })
        .expect(412);
      expect(stale.headers).toMatchObject({
        'cache-control': 'private, no-store',
        vary: 'Authorization',
      });
    }
  });

  it('updates only permitted fields and leaves the other account unchanged', async () => {
    const beforeB = repository.profiles.get(ACCOUNT_B);
    repository.auditContexts.length = 0;
    loggingLines.length = 0;
    const response = await request(app.getHttpServer())
      .patch('/api/v1/accounts/me')
      .set('Authorization', 'Bearer test-token-a')
      .set('If-Match', `"account-profile:${ACCOUNT_A}:1"`)
      .send({
        contactEmail: 'Case.Sensitive@EXAMPLE.COM',
        contactPhone: '+13035550123',
        declaredResidencyCountryCode: 'CA',
      })
      .expect(200);

    expect(response.headers.etag).toBe(`"account-profile:${ACCOUNT_A}:2"`);
    expect(response.body).toMatchObject({
      accountId: ACCOUNT_A,
      contactEmail: 'Case.Sensitive@example.com',
      contactPhone: '+13035550123',
      declaredResidencyCountryCode: 'CA',
      eligibilityStatus: 'UNKNOWN',
      version: 2,
      updatedAt: '2026-08-20T16:00:01.000Z',
    });
    expect(repository.profiles.get(ACCOUNT_B)).toEqual(beforeB);
    const completion = loggingLines
      .map((line) => JSON.parse(line) as StructuredLogRecord)
      .find((record) => record.event === 'http.request.completed');
    expect(repository.auditContexts).toEqual([
      expect.objectContaining({
        actorAccountId: ACCOUNT_A,
        correlationId: response.headers['x-request-id'],
      }),
    ]);
    expect(completion).toMatchObject({
      correlationId: response.headers['x-request-id'],
      requestId: response.headers['x-request-id'],
      initiatorActorId: ACCOUNT_A,
      statusCode: 200,
      outcome: 'success',
    });
  });

  it.each([
    [{ accountId: ACCOUNT_B }],
    [{ eligibilityStatus: 'UNKNOWN' }],
    [{ version: 2 }],
    [{ declaredResidencyCountryCode: 'us' }],
    [{ declaredResidencyCountryCode: 'ZZ' }],
    [{ contactEmail: 'bad\r\n@example.com' }],
    [{ contactPhone: { nested: true } }],
    [{ constructor: { prototype: { polluted: true } }, contactEmail: 'safe@example.com' }],
    [{}],
  ])('rejects invalid or privileged update body %j', async (body) => {
    await request(app.getHttpServer())
      .patch('/api/v1/accounts/me')
      .set('Authorization', 'Bearer test-token-a')
      .set('If-Match', `"account-profile:${ACCOUNT_A}:2"`)
      .send(body)
      .expect(400);
  });

  it('rejects a raw JSON prototype-pollution key at the HTTP boundary', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/accounts/me')
      .set('Authorization', 'Bearer test-token-a')
      .set('If-Match', `"account-profile:${ACCOUNT_A}:2"`)
      .type('application/json')
      .send('{"__proto__":{"polluted":true},"contactEmail":"safe@example.com"}')
      .expect(400);

    expect(repository.profiles.get(ACCOUNT_A)?.version).toBe(2);
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('allows exactly one of two concurrent writes using the same version', async () => {
    const etag = `"account-profile:${ACCOUNT_A}:2"`;
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .patch('/api/v1/accounts/me')
        .set('Authorization', 'Bearer test-token-a')
        .set('If-Match', etag)
        .send({ contactPhone: null }),
      request(app.getHttpServer())
        .patch('/api/v1/accounts/me')
        .set('Authorization', 'Bearer test-token-a')
        .set('If-Match', etag)
        .send({ contactPhone: '+13035550999' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 412]);
    expect(repository.profiles.get(ACCOUNT_A)?.version).toBe(3);
  });

  it('publishes the protected profile operations in OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    const path = response.body.paths['/api/v1/accounts/me'];

    expect(path.get.security).toEqual([{ bearer: [] }]);
    expect(path.patch.security).toEqual([{ bearer: [] }]);
    expect(path.patch.responses).toEqual(
      expect.objectContaining({
        '200': expect.any(Object),
        '400': expect.any(Object),
        '401': expect.any(Object),
        '404': expect.any(Object),
        '412': expect.any(Object),
        '428': expect.any(Object),
      }),
    );
    expect(path.patch.requestBody.content['application/json'].schema).toEqual(
      expect.objectContaining({
        additionalProperties: false,
        maxProperties: 3,
        minProperties: 1,
        properties: expect.objectContaining({
          contactEmail: expect.objectContaining({
            format: 'email',
            pattern: '^[!-~]+$',
          }),
          declaredResidencyCountryCode: expect.objectContaining({
            enum: expect.arrayContaining(['CA', 'GB', 'US']),
          }),
        }),
      }),
    );
  });
});
