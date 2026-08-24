// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  WEB_LOG_EVENTS,
  WebStructuredLogger,
  safeWebErrorCode,
  type SafeWebLogFields,
  type WebLogEvent,
  type WebLogLevel,
  type WebStructuredLogRecord,
} from '@/lib/logging/structured-logger.server';

import {
  adversarialLoggingError,
  LOGGING_PROHIBITED_VALUES,
  LOGGING_SECRET_CANARIES,
} from './fixtures/logging-adversarial';

function parse(line: string): WebStructuredLogRecord {
  return JSON.parse(line) as WebStructuredLogRecord;
}

describe('WebStructuredLogger', () => {
  it('writes canonical UTC JSON with the same fixed runtime metadata contract as the API', () => {
    const lines: string[] = [];
    const logger = new WebStructuredLogger({
      clock: () => new Date('2026-08-24T18:30:45.123Z'),
      environment: { APP_ENV: 'staging-blue', NODE_ENV: 'production' },
      sink: (line) => lines.push(line),
    });

    logger.emit(WEB_LOG_EVENTS.requestFailed, 'error', {
      method: 'POST',
      route: '/account',
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });

    expect(lines).toHaveLength(1);
    expect(parse(lines[0] ?? '')).toEqual({
      schemaVersion: 1,
      timestamp: '2026-08-24T18:30:45.123Z',
      level: 'error',
      event: 'web.request.failed',
      service: 'crypto-lending',
      workload: 'web',
      environment: 'staging-blue',
      method: 'POST',
      route: '/account',
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });
    expect(new Date(parse(lines[0] ?? '').timestamp).toISOString()).toBe(
      parse(lines[0] ?? '').timestamp,
    );
  });

  it('projects adversarial error and field graphs through the closed event allowlist', () => {
    const lines: string[] = [];
    const logger = new WebStructuredLogger({ sink: (line) => lines.push(line) });
    const fields = {
      method: 'GET',
      route: '/api/version',
      outcome: 'failure',
      errorCode: safeWebErrorCode(adversarialLoggingError()),
      authorization: LOGGING_SECRET_CANARIES.bearerToken,
      privateKey: LOGGING_SECRET_CANARIES.privateKey,
      capability: LOGGING_SECRET_CANARIES.capabilityToken,
      idempotencyKey: LOGGING_SECRET_CANARIES.idempotencyToken,
      credentials: LOGGING_SECRET_CANARIES.credentials,
      signature: LOGGING_SECRET_CANARIES.rawSignature,
      response: { body: LOGGING_SECRET_CANARIES.providerPayload },
    } as SafeWebLogFields;

    logger.emit(WEB_LOG_EVENTS.requestFailed, 'error', fields);
    logger.emitFatal(WEB_LOG_EVENTS.processFatal, adversarialLoggingError());

    expect(lines.map(parse)).toEqual([
      {
        schemaVersion: 1,
        timestamp: expect.any(String),
        level: 'error',
        event: 'web.request.failed',
        service: 'crypto-lending',
        workload: 'web',
        environment: 'test',
        method: 'GET',
        route: '/api/version',
        outcome: 'failure',
        errorCode: 'UNEXPECTED_ERROR',
      },
      {
        schemaVersion: 1,
        timestamp: expect.any(String),
        level: 'fatal',
        event: 'process.fatal',
        service: 'crypto-lending',
        workload: 'web',
        environment: 'test',
        outcome: 'failure',
        errorCode: 'UNEXPECTED_ERROR',
      },
    ]);
    for (const prohibited of LOGGING_PROHIBITED_VALUES) {
      expect(lines.join('\n')).not.toContain(prohibited);
    }
  });

  it('drops unknown catalog values, raw routes, secret codes, and incomplete events', () => {
    const lines: string[] = [];
    const logger = new WebStructuredLogger({ sink: (line) => lines.push(line) });

    logger.emit('attacker.event' as WebLogEvent, 'error', {
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });
    logger.emit(WEB_LOG_EVENTS.requestFailed, 'authorization' as WebLogLevel, {
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });
    logger.emit(WEB_LOG_EVENTS.requestFailed, 'error', {
      method: 'GET',
      route: `/account?token=${LOGGING_SECRET_CANARIES.idempotencyToken}`,
      outcome: 'failure',
      errorCode: LOGGING_SECRET_CANARIES.capabilityToken,
    });
    logger.emit(WEB_LOG_EVENTS.runtimeStarted, 'info', {
      outcome: 'success',
      route: '/account',
    });

    expect(lines.map(parse)).toEqual([
      expect.objectContaining({
        event: 'web.runtime.started',
        outcome: 'success',
      }),
    ]);
    expect(parse(lines[0] ?? '')).not.toHaveProperty('route');
    expect(lines.join('\n')).not.toContain(LOGGING_SECRET_CANARIES.idempotencyToken);
  });

  it('does not invoke accessors or change behavior when construction or delivery fails', () => {
    let getterReads = 0;
    const fields = Object.defineProperty({}, 'outcome', {
      get: () => {
        getterReads += 1;
        throw new Error(LOGGING_SECRET_CANARIES.credentials);
      },
    }) as SafeWebLogFields;
    const error = Object.defineProperty({}, 'code', {
      get: () => {
        getterReads += 1;
        throw new Error(LOGGING_SECRET_CANARIES.privateKey);
      },
    });
    const logger = new WebStructuredLogger({
      clock: () => new Date(Number.NaN),
      sink: () => {
        throw new Error(LOGGING_SECRET_CANARIES.providerPayload);
      },
    });

    expect(() => logger.emit(WEB_LOG_EVENTS.runtimeStarted, 'info', fields)).not.toThrow();
    expect(() => logger.emitFatal(WEB_LOG_EVENTS.processFatal, error)).not.toThrow();
    expect(safeWebErrorCode(error)).toBe('UNEXPECTED_ERROR');
    expect(getterReads).toBe(0);
  });
});
