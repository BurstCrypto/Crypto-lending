import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { API_VERSION, SERVICE_NAME, SERVICE_VERSION } from '../src/constants';
import {
  READINESS_ABUSE_LIMITS,
  ReadinessAbuseLimiter,
  type ReadinessRequestLease,
} from '../src/infrastructure/health/readiness-abuse-limiter';
import { InfrastructureHealthService } from '../src/infrastructure/health/infrastructure-health.service';

describe('system endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InfrastructureHealthService)
      .useValue({
        check: jest.fn().mockResolvedValue({
          status: 'ok',
          checks: {
            postgres: { status: 'up', latencyMs: 1 },
            redis: { status: 'up', latencyMs: 1 },
            sqs: { status: 'up', latencyMs: 1 },
          },
        }),
      })
      .compile();

    app = testingModule.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves health only under the versioned prefix', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ service: SERVICE_NAME, status: 'ok' });

    expect(response.headers).toMatchObject({
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
    });
    expect(response.headers).not.toHaveProperty('x-powered-by');

    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('reports the contract and service versions', async () => {
    await request(app.getHttpServer()).get('/api/v1/version').expect(200).expect({
      apiVersion: API_VERSION,
      service: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION,
    });
  });

  it('fails closed on account routes until a verified principal adapter is installed', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/accounts/me')
      .set('X-User-ID', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      .expect(401);

    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      vary: 'Cookie, Origin',
    });
    expect(response.body).toEqual({
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });

    const publicTestnet = await request(app.getHttpServer())
      .post('/api/v1/public-testnet/execution-intents')
      .send({})
      .expect(401);
    expect(publicTestnet.headers).toMatchObject({
      'cache-control': 'private, no-store',
      vary: 'Cookie, Origin',
    });
    expect(publicTestnet.body).toEqual({
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
  });

  it('rejects dependency-readiness work above the replica concurrency cap', async () => {
    const limiter = app.get(ReadinessAbuseLimiter);
    const leases: ReadinessRequestLease[] = [];

    try {
      for (let index = 0; index < READINESS_ABUSE_LIMITS.maxConcurrentRequests; index += 1) {
        const admission = limiter.tryAcquire();
        expect(admission.admitted).toBe(true);
        if (admission.admitted) leases.push(admission.lease);
      }

      const response = await request(app.getHttpServer())
        .get('/api/v1/health/dependencies')
        .expect(429);

      expect(response.headers).toMatchObject({
        'cache-control': 'no-store',
        'retry-after': '1',
      });
      expect(response.body).toEqual({
        error: 'Too Many Requests',
        message: 'Readiness request limit exceeded',
        statusCode: 429,
      });
    } finally {
      leases.forEach((lease) => lease.release());
    }
  });

  it('keeps the private readiness route independent of the public limiter', async () => {
    const limiter = app.get(ReadinessAbuseLimiter);
    const leases: ReadinessRequestLease[] = [];

    try {
      for (let index = 0; index < READINESS_ABUSE_LIMITS.maxConcurrentRequests; index += 1) {
        const admission = limiter.tryAcquire();
        expect(admission.admitted).toBe(true);
        if (admission.admitted) leases.push(admission.lease);
      }

      await request(app.getHttpServer())
        .get('/api/v1/internal/health/dependencies')
        .expect(200)
        .expect({
          status: 'ok',
          checks: {
            postgres: { status: 'up', latencyMs: 1 },
            redis: { status: 'up', latencyMs: 1 },
            sqs: { status: 'up', latencyMs: 1 },
          },
        });
    } finally {
      leases.forEach((lease) => lease.release());
    }
  });

  it('publishes the generated OpenAPI contract', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);

    expect(response.body.info.version).toBe('1.0.0');
    expect(response.body.paths).toHaveProperty('/api/v1/health');
    expect(response.body.paths).toHaveProperty('/api/v1/health/dependencies');
    expect(response.body.paths).toHaveProperty('/api/v1/version');
    expect(response.body.paths).toHaveProperty('/api/v1/accounts/me');
    expect(response.body.paths).toHaveProperty('/api/v1/local-demo/wallets');
    expect(response.body.paths).toHaveProperty('/api/v1/local-demo/portfolio');
    expect(response.body.paths).toHaveProperty('/api/v1/public-testnet/execution-intents');
    expect(response.body.paths).toHaveProperty(
      '/api/v1/public-testnet/execution-intents/{intentId}/submissions',
    );
    expect(
      response.body.paths['/api/v1/public-testnet/execution-intents'].post.requestBody.content[
        'application/json'
      ].schema.properties.selection.properties.presetId.enum,
    ).toEqual(['BALANCED']);
    expect(
      response.body.paths['/api/v1/public-testnet/execution-intents/{intentId}/submissions'].post
        .responses['200'].content['application/json'].schema.properties.confirmation.enum,
    ).toEqual(['LATEST_SIGNATURE_STATUS_OBSERVATION']);
    const submissionSchema =
      response.body.paths['/api/v1/public-testnet/execution-intents/{intentId}/submissions'].post
        .requestBody.content['application/json'].schema;
    expect(submissionSchema.required).toEqual(['signature']);
    expect(submissionSchema.additionalProperties).toBe(false);
    expect(submissionSchema.properties.signedTransactionBase64).toMatchObject({
      type: 'string',
      minLength: 4,
      maxLength: 1_644,
    });
    expect(response.body.paths).not.toHaveProperty('/api/v1/internal/health/dependencies');
    expect(
      response.body.paths['/api/v1/health/dependencies'].get.responses['503'].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/InfrastructureHealthResponseDto');
    expect(response.body.paths['/api/v1/health/dependencies'].get.responses).toHaveProperty('429');
  });
});
