import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { StructuredLogger, type StructuredLogRecord } from '../src/infrastructure/logging';
import { InProcessObservability } from '../src/infrastructure/observability/observability';

describe('correlated HTTP logging (e2e)', () => {
  let app: INestApplication;
  let lines: string[];
  let observability: InProcessObservability;

  beforeEach(async () => {
    lines = [];
    observability = new InProcessObservability();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app, {
      observability,
      requestLogger: new StructuredLogger({
        environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
        sink: (line) => lines.push(line),
      }),
      syntheticRequest: true,
    });
    await app.init();
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
});
