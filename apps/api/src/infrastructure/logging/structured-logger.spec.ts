import { Buffer } from 'node:buffer';

import { AuthenticationConfigurationError } from '../../authentication/infrastructure/config/authentication.config';
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

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR_ID = '00000000-0000-4000-8000-000000000002';
const INTENT_ID = '00000000-0000-4000-8000-000000000003';

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
        correlationId: REQUEST_ID,
        requestId: REQUEST_ID,
        initiatorActorId: ACTOR_ID,
        intentId: INTENT_ID,
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
      correlationId: REQUEST_ID,
      requestId: REQUEST_ID,
      method: 'GET',
      route: '/api/v1/accounts/me',
      statusCode: 200,
      durationMs: 12.346,
      outcome: 'success',
      initiatorActorId: ACTOR_ID,
      intentId: INTENT_ID,
    });
    expect(Buffer.byteLength(lines[0] ?? '')).toBeLessThanOrEqual(4_096);
  });

  it('admits only reviewed current and safe legacy job kinds', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });

    for (const jobKind of [
      'account.updated',
      'blockchain.balance-sync',
      'ledger.journal-committed',
      'yield.operation.submit',
    ]) {
      logger.emit(LOG_EVENTS.jobProcessed, 'info', {
        jobKind,
        outcome: 'success',
      });
    }
    logger.emit(LOG_EVENTS.jobProcessed, 'info', {
      jobKind: 'ledger.unreviewed-operation',
      outcome: 'success',
    });

    expect(lines.slice(0, 4).map((line) => parse(line).jobKind)).toEqual([
      'account.updated',
      'blockchain.balance-sync',
      'ledger.journal-committed',
      'yield.operation.submit',
    ]);
    expect(parse(lines[4] ?? '')).not.toHaveProperty('jobKind');
  });

  it('emits only canonical completed spans and closed ledger lifecycle transitions', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });

    logger.emit(LOG_EVENTS.traceSpanCompleted, 'info', {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      parentSpanId: 'fedcba9876543210',
      spanName: 'http.request',
      durationMs: 12.34567,
      outcome: 'success',
      errorCode: 'HTTP_SERVER_ERROR',
    });
    logger.emit(LOG_EVENTS.traceSpanCompleted, 'error', {
      traceId: 'fedcba9876543210fedcba9876543210',
      spanId: 'fedcba9876543210',
      spanName: 'queue.process',
      durationMs: 25,
      outcome: 'failure',
      errorCode: 'JOB_HANDLER_FAILED',
    });
    logger.emit(LOG_EVENTS.ledgerLifecycleTransitioned, 'info', {
      lifecycleScope: 'leg',
      state: 'QUOTED',
      reason: 'QUOTE_CREATED',
    });

    expect(lines.map(parse)).toEqual([
      expect.objectContaining({
        event: 'trace.span.completed',
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        parentSpanId: 'fedcba9876543210',
        spanName: 'http.request',
        durationMs: 12.346,
        outcome: 'success',
      }),
      expect.objectContaining({
        event: 'trace.span.completed',
        traceId: 'fedcba9876543210fedcba9876543210',
        spanId: 'fedcba9876543210',
        spanName: 'queue.process',
        durationMs: 25,
        outcome: 'failure',
        errorCode: 'JOB_HANDLER_FAILED',
      }),
      expect.objectContaining({
        event: 'ledger.lifecycle.transitioned',
        lifecycleScope: 'leg',
        state: 'QUOTED',
        reason: 'QUOTE_CREATED',
      }),
    ]);
    expect(parse(lines[0] ?? '')).not.toHaveProperty('errorCode');
  });

  it('keeps high-cardinality domain context out of trace events', () => {
    const lines: string[] = [];
    const context = new LoggingContext();
    const logger = new StructuredLogger({ context, sink: (line) => lines.push(line) });

    context.run(
      {
        correlationId: REQUEST_ID,
        requestId: REQUEST_ID,
        initiatorActorId: ACTOR_ID,
        jobId: `job:${'a'.repeat(64)}`,
        intentId: INTENT_ID,
        quoteId: '00000000-0000-4000-8000-000000000004',
        transactionId: '00000000-0000-4000-8000-000000000005',
        ledgerEventId: '00000000-0000-4000-8000-000000000006',
      },
      () =>
        logger.emit(LOG_EVENTS.traceSpanCompleted, 'info', {
          traceId: '0123456789abcdef0123456789abcdef',
          spanId: '0123456789abcdef',
          spanName: 'queue.process',
          durationMs: 1,
          outcome: 'success',
        }),
    );

    expect(parse(lines[0] ?? '')).toMatchObject({
      event: 'trace.span.completed',
      correlationId: REQUEST_ID,
    });
    for (const field of [
      'requestId',
      'initiatorActorId',
      'jobId',
      'intentId',
      'quoteId',
      'transactionId',
      'ledgerEventId',
    ]) {
      expect(parse(lines[0] ?? '')).not.toHaveProperty(field);
    }
  });

  it('drops malformed or semantically inconsistent trace and lifecycle records', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });

    for (const fields of [
      {
        traceId: 'ABCDEF0123456789ABCDEF0123456789',
        spanId: '0123456789abcdef',
        spanName: 'http.request',
        durationMs: 1,
        outcome: 'success',
      },
      {
        traceId: '00000000000000000000000000000000',
        spanId: '0123456789abcdef',
        spanName: 'http.request',
        durationMs: 1,
        outcome: 'success',
      },
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0000000000000000',
        spanName: 'http.request',
        durationMs: 1,
        outcome: 'success',
      },
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        spanName: 'attacker.request',
        durationMs: 1,
        outcome: 'success',
      },
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        spanName: 'http.request',
        durationMs: 1,
        outcome: 'failure',
        errorCode: 'Bearer-secret',
      },
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        parentSpanId: 'ABCDEF0123456789',
        spanName: 'http.request',
        durationMs: 1,
        outcome: 'success',
      },
      {
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
        parentSpanId: '0123456789abcdef',
        spanName: 'http.request',
        durationMs: 1,
        outcome: 'success',
      },
    ]) {
      logger.emit(LOG_EVENTS.traceSpanCompleted, 'error', fields as SafeLogFields);
    }
    for (const fields of [
      { lifecycleScope: 'wallet', state: 'QUOTED', reason: 'QUOTE_CREATED' },
      { lifecycleScope: 'leg', state: 'SECRET_STATE', reason: 'QUOTE_CREATED' },
      { lifecycleScope: 'leg', state: 'QUOTED', reason: 'SECRET_REASON' },
      { lifecycleScope: 'leg', state: 'SETTLED', reason: 'QUOTE_CREATED' },
    ]) {
      logger.emit(LOG_EVENTS.ledgerLifecycleTransitioned, 'info', fields as SafeLogFields);
    }

    expect(lines).toEqual([]);
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
    const configuration = new AuthenticationConfigurationError('AUTH_IDENTITY_HMAC_KEY_RING_JSON');

    expect(safeErrorCode(untrusted)).toBe('UNEXPECTED_ERROR');
    expect(safeErrorCode(configuration)).toBe('CONFIGURATION_ERROR');
    logger.emitFatal(LOG_EVENTS.applicationStartFailed, untrusted, { outcome: 'failure' });
    logger.error(untrusted, 'AuthorizationHeader');
    logger.emitFatal(LOG_EVENTS.applicationStartFailed, configuration, { outcome: 'failure' });

    expect(lines).toHaveLength(3);
    expect(parse(lines[0] ?? '')).toMatchObject({
      event: 'application.start_failed',
      errorCode: 'UNEXPECTED_ERROR',
    });
    expect(parse(lines[1] ?? '')).toMatchObject({
      event: 'framework.error',
      component: 'Nest',
      errorCode: 'UNEXPECTED_ERROR',
    });
    expect(parse(lines[2] ?? '')).toMatchObject({
      event: 'application.start_failed',
      errorCode: 'CONFIGURATION_ERROR',
    });
    expect(lines.join('\n')).not.toMatch(/super-secret|AWS_SECRET_ACCESS_KEY|AuthorizationHeader/u);
    expect(lines.join('\n')).not.toContain('AUTH_IDENTITY_HMAC_KEY_RING_JSON');
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

    const throwingCode = Object.defineProperty({}, 'code', {
      get: () => {
        throw new Error('credential getter must not escape');
      },
    });
    const throwingField = Object.defineProperty({}, 'outcome', {
      get: () => {
        throw new Error('field getter must not escape');
      },
    }) as SafeLogFields;
    expect(() => safeErrorCode(throwingCode)).not.toThrow();
    expect(safeErrorCode(throwingCode)).toBe('UNEXPECTED_ERROR');
    expect(() =>
      badSink.emitFatal(LOG_EVENTS.applicationStartFailed, throwingCode, throwingField),
    ).not.toThrow();
  });

  it('drops huge durations and token-shaped identifiers rather than serializing null or secrets', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });
    logger.emit(LOG_EVENTS.jobProcessed, 'info', {
      durationMs: 1e308,
      jobId: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      messageId: 'ghp_SECRET_MATERIAL',
      jobKind: 'ghp_SECRET_MATERIAL',
      outcome: 'success',
    });

    expect(lines).toHaveLength(1);
    expect(parse(lines[0] ?? '')).not.toHaveProperty('durationMs');
    expect(parse(lines[0] ?? '')).not.toHaveProperty('jobId');
    expect(parse(lines[0] ?? '')).not.toHaveProperty('messageId');
    expect(parse(lines[0] ?? '')).not.toHaveProperty('jobKind');
    expect(lines[0]).not.toContain('SECRET_MATERIAL');
    expect(lines[0]).not.toContain(':null');
  });

  it('is not replaceable through Object.prototype.toJSON pollution', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ sink: (line) => lines.push(line) });
    const polluted = Object.prototype as { toJSON?: () => unknown };
    polluted.toJSON = () => ({ authorization: 'Bearer ObjectPrototypeCANARY' });
    try {
      logger.emit(LOG_EVENTS.applicationStarted, 'info', { outcome: 'success' });
    } finally {
      delete polluted.toJSON;
    }

    expect(lines).toHaveLength(1);
    expect(parse(lines[0] ?? '')).toMatchObject({
      event: LOG_EVENTS.applicationStarted,
      outcome: 'success',
    });
    expect(lines[0]).not.toContain('ObjectPrototypeCANARY');
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

  it('resolves late-bound executable workload unless a trusted override is supplied', () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    const dynamicLines: string[] = [];
    const dynamic = new StructuredLogger({
      environment,
      sink: (line) => dynamicLines.push(line),
    });
    environment.APPLICATION_WORKLOAD = 'api';
    dynamic.emit(LOG_EVENTS.applicationStarted, 'info', { outcome: 'success' });

    const explicitLines: string[] = [];
    const explicit = new StructuredLogger({
      environment: { APPLICATION_WORKLOAD: 'api', NODE_ENV: 'test' },
      workload: 'migration',
      sink: (line) => explicitLines.push(line),
    });
    explicit.emit(LOG_EVENTS.migrationCompleted, 'info', {
      migrationCommand: 'status',
      migrationId: '0005',
      migrationState: 'up',
      changed: 5,
      outcome: 'success',
    });

    expect(parse(dynamicLines[0] ?? '')).toMatchObject({ workload: 'api' });
    expect(parse(explicitLines[0] ?? '')).toMatchObject({
      workload: 'migration',
      migrationCommand: 'status',
      migrationId: '0005',
      migrationState: 'up',
      changed: 5,
    });

    const consumerLines: string[] = [];
    const consumer = new StructuredLogger({
      environment: { NODE_ENV: 'test' },
      workload: 'balance-consumer',
      sink: (line) => consumerLines.push(line),
    });
    consumer.emit(LOG_EVENTS.workerStartFailed, 'fatal', {
      errorCode: 'BALANCE_CONSUMER_STARTUP_REFUSED',
      outcome: 'failure',
    });
    expect(parse(consumerLines[0] ?? '')).toMatchObject({
      workload: 'balance-consumer',
      errorCode: 'BALANCE_CONSUMER_STARTUP_REFUSED',
    });
  });
});
