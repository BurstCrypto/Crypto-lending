import { Buffer } from 'node:buffer';

import { LoggingContext } from './logging-context';
import {
  LOG_EVENTS,
  safeErrorCode,
  StructuredLogger,
  type SafeLogFields,
  type StructuredLogEvent,
  type StructuredLogLevel,
  type StructuredLogRecord,
} from './structured-logger';

function parse(line: string): StructuredLogRecord {
  return JSON.parse(line) as StructuredLogRecord;
}

describe('StructuredLogger', () => {
  it('writes bounded UTC JSON with fixed metadata and correlated allowlisted fields', () => {
    const lines: string[] = [];
    const context = new LoggingContext();
    const logger = new StructuredLogger({
      clock: () => new Date('2026-08-21T12:34:56.789Z'),
      context,
      environment: {
        APPLICATION_WORKLOAD: 'api',
        APP_ENV: 'staging-blue',
      },
      sink: (line) => lines.push(line),
    });

    context.run(
      {
        correlationId: 'request:one',
        requestId: 'request:one',
        initiatorActorId: 'actor:verified',
        intentId: 'intent:1',
      },
      () =>
        logger.emit(LOG_EVENTS.httpRequestCompleted, 'info', {
          method: 'GET',
          route: '/api/v1/accounts/me',
          statusCode: 200,
          durationMs: 12.34567,
          outcome: 'success',
        }),
    );

    expect(lines).toHaveLength(1);
    expect(parse(lines[0] ?? '')).toEqual({
      schemaVersion: 1,
      timestamp: '2026-08-21T12:34:56.789Z',
      level: 'info',
      event: 'http.request.completed',
      service: 'crypto-lending',
      workload: 'api',
      environment: 'staging-blue',
      correlationId: 'request:one',
      requestId: 'request:one',
      method: 'GET',
      route: '/api/v1/accounts/me',
      statusCode: 200,
      durationMs: 12.346,
      outcome: 'success',
      initiatorActorId: 'actor:verified',
      intentId: 'intent:1',
    });
    expect(Buffer.byteLength(lines[0] ?? '')).toBeLessThanOrEqual(4_096);
  });

  it('drops unknown, secret-bearing, invalid, and event-inappropriate fields', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({
      environment: {
        APPLICATION_WORKLOAD: 'api\nforged',
        NODE_ENV: 'test',
      },
      sink: (line) => lines.push(line),
    });
    const adversarialFields = {
      method: 'GET',
      route: '/must-not-be-allowed-on-start',
      authorization: 'Bearer must-not-escape',
      body: { password: 'must-not-escape' },
      query: 'token=must-not-escape',
      stack: 'PRIVATE KEY must-not-escape',
      error: new Error('credential must-not-escape'),
      jobId: 'job-must-not-be-allowed-on-start',
    } as SafeLogFields;

    logger.emit(LOG_EVENTS.applicationStarted, 'info', adversarialFields);
    logger.emit('attacker.event' as StructuredLogEvent, 'info', adversarialFields);
    logger.emit(
      LOG_EVENTS.applicationStarted,
      'authorization' as StructuredLogLevel,
      adversarialFields,
    );

    expect(lines).toHaveLength(1);
    expect(parse(lines[0] ?? '')).toMatchObject({
      event: 'application.started',
      workload: 'unknown',
    });
    expect(parse(lines[0] ?? '')).not.toHaveProperty('method');
    expect(parse(lines[0] ?? '')).not.toHaveProperty('route');
    expect(parse(lines[0] ?? '')).not.toHaveProperty('jobId');
    expect(lines[0]).not.toMatch(/Bearer|password|token=|PRIVATE KEY|credential|authorization/u);
  });

  it('maps errors and Nest components through closed catalogs without raw details', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });
    const untrusted = Object.assign(new Error('Bearer super-secret-value'), {
      code: 'AWS_SECRET_ACCESS_KEY',
    });

    expect(safeErrorCode(untrusted)).toBe('UNEXPECTED_ERROR');
    logger.emitFatal(LOG_EVENTS.applicationStartFailed, untrusted, { outcome: 'failure' });
    logger.error(untrusted, 'AuthorizationHeader');

    expect(lines).toHaveLength(2);
    expect(parse(lines[0] ?? '')).toMatchObject({
      event: 'application.start_failed',
      errorCode: 'UNEXPECTED_ERROR',
    });
    expect(parse(lines[1] ?? '')).toMatchObject({
      event: 'framework.error',
      component: 'Nest',
      errorCode: 'UNEXPECTED_ERROR',
    });
    expect(lines.join('\n')).not.toMatch(/super-secret|AWS_SECRET_ACCESS_KEY|AuthorizationHeader/u);
  });

  it('never changes application behavior when construction or delivery fails', () => {
    const badClock = new StructuredLogger({
      clock: () => new Date(Number.NaN),
      sink: () => {
        throw new Error('sink failure');
      },
    });
    const badSink = new StructuredLogger({
      sink: () => {
        throw new Error('sink failure');
      },
    });

    expect(() => badClock.emit(LOG_EVENTS.applicationStarted, 'info')).not.toThrow();
    expect(() => badSink.emit(LOG_EVENTS.applicationStarted, 'info')).not.toThrow();
  });

  it('keeps the default test sink silent while an explicit sink remains capturable', () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const logger = new StructuredLogger({ environment: { NODE_ENV: 'test' } });
      logger.emit(LOG_EVENTS.applicationStarted, 'info', { outcome: 'success' });
      logger.emitFatal(LOG_EVENTS.applicationStartFailed, new Error('private detail'));

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
