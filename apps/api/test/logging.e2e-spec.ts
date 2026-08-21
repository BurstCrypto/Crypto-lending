import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { StructuredLogger, type StructuredLogRecord } from '../src/infrastructure/logging';

describe('correlated HTTP logging (e2e)', () => {
  let app: INestApplication;
  let lines: string[];

  beforeAll(async () => {
    lines = [];
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app, {
      requestLogger: new StructuredLogger({
        environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
        sink: (line) => lines.push(line),
      }),
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    lines.length = 0;
  });

  it('returns its authoritative ID and never logs headers, query values, or bodies', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/version?token=query-secret')
      .set('Authorization', 'Bearer header-secret')
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
  });

  it('suppresses successful liveness noise and correlates unmatched failures', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(lines).toHaveLength(0);

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
  });
});
