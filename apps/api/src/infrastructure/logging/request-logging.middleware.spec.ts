import { EventEmitter } from 'node:events';

import { loggingContext } from './logging-context';
import {
  createRequestLoggingMiddleware,
  REQUEST_ID_RESPONSE_HEADER,
} from './request-logging.middleware';
import { StructuredLogger, type StructuredLogRecord } from './structured-logger';

class TestResponse extends EventEmitter {
  readonly headers = new Map<string, string>();
  statusCode = 200;
  writableFinished = false;

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

function records(lines: readonly string[]): StructuredLogRecord[] {
  return lines.map((line) => JSON.parse(line) as StructuredLogRecord);
}

describe('request logging middleware', () => {
  it('uses an authoritative ID and records completion with only a verified initiator', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({
      environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
      sink: (line) => lines.push(line),
    });
    const middleware = createRequestLoggingMiddleware(logger);
    const request = {
      baseUrl: '',
      headers: { 'x-request-id': 'attacker-controlled' },
      method: 'patch',
      originalUrl: '/api/v1/accounts/me?token=must-not-escape',
      route: { path: '/api/v1/accounts/me' },
      body: { password: 'must-not-escape' },
    };
    const response = new TestResponse();

    middleware(request, response, () => {
      const active = loggingContext.requireCurrent();
      expect(active.requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(active.requestId).not.toBe('attacker-controlled');
      loggingContext.bindActorId('actor:verified');
      response.statusCode = 200;
      response.writableFinished = true;
      response.emit('finish');
    });

    const output = records(lines);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      event: 'http.request.completed',
      method: 'PATCH',
      route: '/api/v1/accounts/me',
      statusCode: 200,
      outcome: 'success',
      initiatorActorId: 'actor:verified',
    });
    expect(output[0]?.requestId).toBe(response.headers.get(REQUEST_ID_RESPONSE_HEADER));
    expect(output[0]?.correlationId).toBe(output[0]?.requestId);
    expect(lines.join('\n')).not.toMatch(/attacker-controlled|token=|password|must-not-escape/u);
  });

  it('suppresses successful health noise but records health failure', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });
    const middleware = createRequestLoggingMiddleware(logger);

    const healthy = new TestResponse();
    healthy.writableFinished = true;
    middleware(
      {
        method: 'GET',
        originalUrl: '/api/v1/health?probe=1',
        route: { path: '/api/v1/health' },
      },
      healthy,
      () => healthy.emit('finish'),
    );
    expect(lines).toHaveLength(0);

    const failed = new TestResponse();
    failed.statusCode = 503;
    failed.writableFinished = true;
    middleware(
      {
        method: 'GET',
        originalUrl: '/api/v1/health/dependencies',
        route: { path: '/api/v1/health/dependencies' },
      },
      failed,
      () => failed.emit('finish'),
    );

    expect(records(lines)).toEqual([
      expect.objectContaining({
        event: 'http.request.completed',
        statusCode: 503,
        outcome: 'failure',
      }),
    ]);
  });

  it('records an aborted request exactly once with a canonical route template', () => {
    const lines: string[] = [];
    const middleware = createRequestLoggingMiddleware(
      new StructuredLogger({ sink: (line) => lines.push(line) }),
    );
    const response = new TestResponse();

    middleware(
      {
        method: 'GET',
        originalUrl: '/customer/private-value',
        route: { path: '/accounts/:accountId' },
      },
      response,
      () => {
        response.emit('close');
        response.emit('close');
        response.emit('finish');
      },
    );

    const output = records(lines);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      event: 'http.request.aborted',
      route: '/accounts/:accountId',
      statusCode: 499,
      outcome: 'aborted',
    });
    expect(lines.join('\n')).not.toContain('private-value');
  });
});
