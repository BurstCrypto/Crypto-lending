import { EventEmitter } from 'node:events';

import { InProcessObservability, type ObservabilityPort } from '../observability/observability';
import { loggingContext } from './logging-context';
import {
  createRequestLoggingMiddleware,
  REQUEST_ID_RESPONSE_HEADER,
} from './request-logging.middleware';
import { StructuredLogger, type StructuredLogRecord } from './structured-logger';

const VERIFIED_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

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
    let now = 0;
    const observability = new InProcessObservability({
      monotonicNow: () => now,
      wallClock: () => new Date('2026-08-22T12:00:00.000Z'),
    });
    const logger = new StructuredLogger({
      environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
      sink: (line) => lines.push(line),
    });
    const middleware = createRequestLoggingMiddleware(logger, {
      monotonicNow: () => now,
      observability,
      syntheticRequest: true,
    });
    const request = {
      baseUrl: '',
      headers: {
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        tracestate: 'attacker=customer-secret',
        'x-crypto-synthetic': 'false',
        'x-request-id': 'attacker-controlled',
      },
      method: 'patch',
      originalUrl: '/api/v1/accounts/me?token=must-not-escape&customer=customer-secret',
      route: { path: '/api/v1/accounts/me' },
      body: { password: 'must-not-escape' },
    };
    const response = new TestResponse();

    middleware(request, response, () => {
      const active = loggingContext.requireCurrent();
      expect(active.requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(active.requestId).not.toBe('attacker-controlled');
      loggingContext.bindActorId(VERIFIED_ACTOR_ID);
      expect(observability.currentTraceContext()).toEqual(
        expect.objectContaining({
          traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
          rootSpanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
          spanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
          synthetic: true,
        }),
      );
      expect(
        observability
          .dashboardSnapshot()
          .gauges.find(({ name }) => name === 'http_active_requests'),
      ).toMatchObject({
        labels: { operation: 'account_profile', synthetic: 'true' },
        value: 1,
      });
      now = 12;
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
      initiatorActorId: VERIFIED_ACTOR_ID,
    });
    expect(output[0]?.requestId).toBe(response.headers.get(REQUEST_ID_RESPONSE_HEADER));
    expect(output[0]?.correlationId).toBe(output[0]?.requestId);
    expect(lines.join('\n')).not.toMatch(/attacker-controlled|token=|password|must-not-escape/u);

    const snapshot = observability.dashboardSnapshot();
    expect(snapshot.counters).toContainEqual({
      name: 'http_requests_total',
      labels: {
        operation: 'account_profile',
        method: 'PATCH',
        outcome: 'success',
        synthetic: 'true',
      },
      value: 1,
    });
    expect(snapshot.gauges).toContainEqual({
      name: 'http_active_requests',
      labels: { operation: 'account_profile', synthetic: 'true' },
      value: 0,
    });
    expect(snapshot.histograms).toEqual([
      expect.objectContaining({
        name: 'http_request_duration_ms',
        labels: { operation: 'account_profile', method: 'PATCH', synthetic: 'true' },
        count: 1,
        sum: 12,
      }),
    ]);
    expect(snapshot.completedSpans).toEqual([
      expect.objectContaining({
        eventName: 'trace.span.completed',
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
        rootSpanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
        correlationId: response.headers.get(REQUEST_ID_RESPONSE_HEADER),
        name: 'http.request',
        kind: 'server',
        outcome: 'success',
        synthetic: true,
        durationMs: 12,
      }),
    ]);
    expect(snapshot.completedSpans[0]).not.toHaveProperty('parentSpanId');
    expect(JSON.stringify(snapshot)).not.toMatch(
      /aaaaaaaa|bbbbbbbb|attacker|customer-secret|must-not-escape|token=/u,
    );
  });

  it('suppresses successful health noise but records health failure', () => {
    const lines: string[] = [];
    const observability = new InProcessObservability();
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });
    const middleware = createRequestLoggingMiddleware(logger, { observability });

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
    const snapshot = observability.dashboardSnapshot();
    expect(snapshot.counters.filter(({ name }) => name === 'http_requests_total')).toEqual([
      expect.objectContaining({
        labels: {
          operation: 'health',
          method: 'GET',
          outcome: 'failure',
          synthetic: 'false',
        },
        value: 1,
      }),
      expect.objectContaining({
        labels: {
          operation: 'health',
          method: 'GET',
          outcome: 'success',
          synthetic: 'false',
        },
        value: 1,
      }),
    ]);
    expect(snapshot.completedSpans).toEqual([
      expect.objectContaining({ name: 'http.request', outcome: 'failure' }),
    ]);
    expect(snapshot.gauges).toContainEqual({
      name: 'http_active_requests',
      labels: { operation: 'health', synthetic: 'false' },
      value: 0,
    });
  });

  it('records an aborted request exactly once with a canonical route template', () => {
    const lines: string[] = [];
    const observability = new InProcessObservability();
    const middleware = createRequestLoggingMiddleware(
      new StructuredLogger({ sink: (line) => lines.push(line) }),
      { observability },
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
    const snapshot = observability.dashboardSnapshot();
    expect(snapshot.counters).toEqual([
      expect.objectContaining({
        name: 'http_request_errors_total',
        labels: { operation: 'unknown', outcome: 'aborted', synthetic: 'false' },
        value: 1,
      }),
      expect.objectContaining({
        name: 'http_requests_total',
        labels: {
          operation: 'unknown',
          method: 'GET',
          outcome: 'aborted',
          synthetic: 'false',
        },
        value: 1,
      }),
    ]);
    expect(snapshot.completedSpans).toEqual([
      expect.objectContaining({ name: 'http.request', outcome: 'aborted' }),
    ]);
  });

  it('balances saturation across concurrent requests of the same closed operation', () => {
    const observability = new InProcessObservability();
    const middleware = createRequestLoggingMiddleware(new StructuredLogger({ sink: () => {} }), {
      observability,
    });
    const first = new TestResponse();
    const second = new TestResponse();
    const request = { method: 'POST', originalUrl: '/api/v1/quotes' };

    middleware(request, first, () => undefined);
    middleware(request, second, () => undefined);
    expect(observability.dashboardSnapshot().gauges).toContainEqual({
      name: 'http_active_requests',
      labels: { operation: 'quote', synthetic: 'false' },
      value: 2,
    });

    first.writableFinished = true;
    first.emit('finish');
    expect(observability.dashboardSnapshot().gauges).toContainEqual({
      name: 'http_active_requests',
      labels: { operation: 'quote', synthetic: 'false' },
      value: 1,
    });

    second.writableFinished = true;
    second.emit('close');
    expect(observability.dashboardSnapshot().gauges).toContainEqual({
      name: 'http_active_requests',
      labels: { operation: 'quote', synthetic: 'false' },
      value: 0,
    });
    expect(
      observability
        .dashboardSnapshot()
        .counters.filter(({ name }) => name === 'http_requests_total'),
    ).toEqual([expect.objectContaining({ value: 2 })]);
  });

  it('isolates recorder and span-runner failures from request behavior', () => {
    const lines: string[] = [];
    const observability = {
      recordRequest: jest.fn(() => {
        throw new Error('diagnostic failure');
      }),
      recordRequestSaturation: jest.fn(() => {
        throw new Error('diagnostic failure');
      }),
      startSpan: jest.fn(() => ({
        run: () => {
          throw new Error('diagnostic failure');
        },
        runAsync: jest.fn(),
        discard: jest.fn(() => {
          throw new Error('diagnostic failure');
        }),
        end: () => {
          throw new Error('diagnostic failure');
        },
      })),
    } as unknown as ObservabilityPort;
    const middleware = createRequestLoggingMiddleware(
      new StructuredLogger({ sink: (line) => lines.push(line) }),
      { observability },
    );
    const response = new TestResponse();
    response.writableFinished = true;
    let calls = 0;

    expect(() =>
      middleware({ method: 'GET', originalUrl: '/api/v1/version' }, response, () => {
        calls += 1;
        response.emit('finish');
      }),
    ).not.toThrow();

    expect(calls).toBe(1);
    expect(records(lines)).toEqual([
      expect.objectContaining({ event: 'http.request.completed', outcome: 'success' }),
    ]);
  });

  it('bounds anonymous rejection logs per window without suppressing verified actors', () => {
    const lines: string[] = [];
    let now = 1_000;
    const middleware = createRequestLoggingMiddleware(
      new StructuredLogger({ sink: (line) => lines.push(line) }),
      {
        anonymousRejectionLimit: 3,
        anonymousRejectionWindowMs: 1_000,
        monotonicNow: () => now,
      },
    );

    for (let index = 0; index < 100; index += 1) {
      const response = new TestResponse();
      response.statusCode = 401;
      response.writableFinished = true;
      middleware({ method: 'GET', originalUrl: `/missing?attempt=${index}` }, response, () =>
        response.emit('finish'),
      );
    }
    expect(lines).toHaveLength(4);
    expect(records(lines).at(-1)).toMatchObject({
      event: 'http.anonymous_rejections.suppressed',
      outcome: 'rejected',
    });

    now += 1_000;
    const resetResponse = new TestResponse();
    resetResponse.statusCode = 404;
    resetResponse.writableFinished = true;
    middleware({ method: 'GET', originalUrl: '/missing' }, resetResponse, () =>
      resetResponse.emit('finish'),
    );
    expect(lines).toHaveLength(5);

    for (let index = 0; index < 5; index += 1) {
      const response = new TestResponse();
      response.statusCode = 403;
      response.writableFinished = true;
      middleware({ method: 'GET', originalUrl: '/protected' }, response, () => {
        loggingContext.bindActorId(VERIFIED_ACTOR_ID);
        response.emit('finish');
      });
    }
    expect(lines).toHaveLength(10);
    expect(lines.join('\n')).not.toMatch(/attempt=|missing|protected/u);
  });

  it('applies the same anonymous budget to aborted requests', () => {
    const lines: string[] = [];
    const middleware = createRequestLoggingMiddleware(
      new StructuredLogger({ sink: (line) => lines.push(line) }),
      {
        anonymousRejectionLimit: 2,
        anonymousRejectionWindowMs: 1_000,
        monotonicNow: () => 1_000,
      },
    );

    for (let index = 0; index < 100; index += 1) {
      const response = new TestResponse();
      middleware({ method: 'GET', originalUrl: `/abort?secret=${index}` }, response, () =>
        response.emit('close'),
      );
    }

    expect(records(lines).filter(({ event }) => event === 'http.request.aborted')).toHaveLength(2);
    expect(
      records(lines).filter(({ event }) => event === 'http.anonymous_rejections.suppressed'),
    ).toHaveLength(1);
    expect(lines.join('\n')).not.toMatch(/secret=|abort\?/u);
  });
});
