import { Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { StructuredLogger, type StructuredLogRecord } from '../src/infrastructure/logging';
import { InProcessObservability } from '../src/infrastructure/observability/observability';
import {
  adversarialProviderError,
  LOGGING_PROHIBITED_VALUES,
  LOGGING_SECRET_CANARIES,
} from './fixtures/logging-adversarial.fixture';

@Controller('logging-boundary-fixture')
class LoggingBoundaryFixtureController {
  @Post('failure')
  fail(): never {
    throw adversarialProviderError();
  }
}

describe('correlated HTTP logging (e2e)', () => {
  let app: INestApplication;
  let lines: string[];
  let observability: InProcessObservability;

  beforeEach(async () => {
    lines = [];
    observability = new InProcessObservability();
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [LoggingBoundaryFixtureController],
    }).compile();
    app = module.createNestApplication();
    const logger = new StructuredLogger({
      environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
      sink: (line) => lines.push(line),
    });
    configureApplication(app, {
      observability,
      requestLogger: logger,
      syntheticRequest: true,
    });
    await app.init();
    app.useLogger(logger);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns its authoritative ID and never logs headers, query values, or bodies', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/version?token=query-secret')
      .set('Authorization', 'Bearer header-secret')
      .set('Traceparent', '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01')
      .set('Tracestate', 'attacker=customer-secret')
      .set('X-Crypto-Synthetic', 'false')
      .set('X-Request-Id', 'attacker-request-id')
      .expect(200);

    const output = lines.map((line) => JSON.parse(line) as StructuredLogRecord);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response.headers['x-request-id']).not.toBe('attacker-request-id');
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      event: 'http.request.completed',
      method: 'GET',
      route: '/api/v1/version',
      statusCode: 200,
      outcome: 'success',
      requestId: response.headers['x-request-id'],
      correlationId: response.headers['x-request-id'],
    });
    expect(lines.join('\n')).not.toMatch(
      /query-secret|header-secret|attacker-request-id|authorization|token=/iu,
    );

    const snapshot = observability.dashboardSnapshot();
    expect(snapshot.counters).toContainEqual({
      name: 'http_requests_total',
      labels: {
        operation: 'unknown',
        method: 'GET',
        outcome: 'success',
        synthetic: 'true',
      },
      value: 1,
    });
    expect(snapshot.counters).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'http_request_errors_total' })]),
    );
    expect(snapshot.gauges).toContainEqual({
      name: 'http_active_requests',
      labels: { operation: 'unknown', synthetic: 'true' },
      value: 0,
    });
    expect(snapshot.histograms).toEqual([
      expect.objectContaining({
        name: 'http_request_duration_ms',
        labels: { operation: 'unknown', method: 'GET', synthetic: 'true' },
        count: 1,
      }),
    ]);
    expect(snapshot.completedSpans).toEqual([
      expect.objectContaining({
        eventName: 'trace.span.completed',
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
        rootSpanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
        correlationId: response.headers['x-request-id'],
        name: 'http.request',
        kind: 'server',
        outcome: 'success',
        synthetic: true,
      }),
    ]);
    expect(snapshot.completedSpans[0]?.spanId).toBe(snapshot.completedSpans[0]?.rootSpanId);
    expect(snapshot.completedSpans[0]).not.toHaveProperty('parentSpanId');
    expect(JSON.stringify(snapshot)).not.toMatch(
      /aaaaaaaa|bbbbbbbb|attacker|customer-secret|query-secret|header-secret|token=/iu,
    );
  });

  it('suppresses successful liveness noise and correlates unmatched failures', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(lines).toHaveLength(0);
    let snapshot = observability.dashboardSnapshot();
    expect(snapshot.counters).toContainEqual({
      name: 'http_requests_total',
      labels: {
        operation: 'health',
        method: 'GET',
        outcome: 'success',
        synthetic: 'true',
      },
      value: 1,
    });
    expect(snapshot.gauges).toContainEqual({
      name: 'http_active_requests',
      labels: { operation: 'health', synthetic: 'true' },
      value: 0,
    });
    expect(snapshot.completedSpans).toEqual([]);

    const response = await request(app.getHttpServer())
      .get('/not-present/private-value')
      .expect(404);
    const output = lines.map((line) => JSON.parse(line) as StructuredLogRecord);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      event: 'http.request.completed',
      route: '/unmatched',
      statusCode: 404,
      outcome: 'rejected',
      requestId: response.headers['x-request-id'],
    });
    expect(lines.join('\n')).not.toContain('private-value');
    snapshot = observability.dashboardSnapshot();
    expect(snapshot.counters).toContainEqual({
      name: 'http_request_errors_total',
      labels: { operation: 'unknown', outcome: 'rejected', synthetic: 'true' },
      value: 1,
    });
    expect(snapshot.completedSpans).toEqual([
      expect.objectContaining({ name: 'http.request', synthetic: true }),
    ]);
  });

  it('projects an unhandled API/provider error through approved structured fields only', async () => {
    const response = await request(app.getHttpServer())
      .post(
        `/api/v1/logging-boundary-fixture/failure?idempotency=${encodeURIComponent(
          LOGGING_SECRET_CANARIES.idempotencyToken,
        )}`,
      )
      .set('Authorization', LOGGING_SECRET_CANARIES.bearerToken)
      .set('X-Ledger-Capability', LOGGING_SECRET_CANARIES.capabilityToken)
      .set('X-Provider-Credentials', LOGGING_SECRET_CANARIES.credentials)
      .set('X-Wallet-Signature', LOGGING_SECRET_CANARIES.rawSignature)
      .send({
        privateKey: LOGGING_SECRET_CANARIES.privateKey,
        providerResponse: LOGGING_SECRET_CANARIES.providerPayload,
      })
      .expect(500);

    expect(response.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    const output = lines.map((line) => JSON.parse(line) as StructuredLogRecord);
    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'framework.error',
          workload: 'api',
          errorCode: 'UNEXPECTED_ERROR',
        }),
        expect.objectContaining({
          event: 'http.request.completed',
          workload: 'api',
          method: 'POST',
          route: '/api/v1/logging-boundary-fixture/failure',
          statusCode: 500,
          outcome: 'failure',
        }),
      ]),
    );
    for (const record of output) {
      expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
      const allowedFields = new Set([
        'schemaVersion',
        'timestamp',
        'level',
        'event',
        'service',
        'workload',
        'environment',
        'correlationId',
        'requestId',
        'component',
        'errorCode',
        'method',
        'route',
        'statusCode',
        'durationMs',
        'outcome',
      ]);
      expect(Object.keys(record).filter((field) => !allowedFields.has(field))).toEqual([]);
    }
    const captured = `${JSON.stringify(response.body)}\n${JSON.stringify(
      observability.dashboardSnapshot(),
    )}\n${lines.join('\n')}`;
    for (const prohibited of LOGGING_PROHIBITED_VALUES) {
      expect(captured).not.toContain(prohibited);
    }
  });
});
