// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  WebStructuredLogger,
  type WebStructuredLogRecord,
} from '@/lib/logging/structured-logger.server';
import { recordWebRequestFailure } from '@/lib/logging/web-runtime.server';

import {
  adversarialLoggingError,
  LOGGING_PROHIBITED_VALUES,
  LOGGING_SECRET_CANARIES,
} from './fixtures/logging-adversarial';

describe('web request-error logging boundary', () => {
  it('uses only a closed method, route ID, and error classification', () => {
    const lines: string[] = [];
    const logger = new WebStructuredLogger({ sink: (line) => lines.push(line) });

    recordWebRequestFailure(
      adversarialLoggingError(),
      {
        method: 'POST',
        path: `/account?token=${LOGGING_SECRET_CANARIES.bearerToken}`,
        headers: {
          authorization: LOGGING_SECRET_CANARIES.bearerToken,
          cookie: LOGGING_SECRET_CANARIES.credentials,
          'x-idempotency-key': LOGGING_SECRET_CANARIES.idempotencyToken,
          'x-wallet-signature': LOGGING_SECRET_CANARIES.rawSignature,
        },
      },
      {
        routePath: '/account',
        providerPayload: LOGGING_SECRET_CANARIES.providerPayload,
      },
      logger,
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '') as WebStructuredLogRecord).toEqual({
      schemaVersion: 1,
      timestamp: expect.any(String),
      level: 'error',
      event: 'web.request.failed',
      service: 'crypto-lending',
      workload: 'web',
      environment: 'test',
      method: 'POST',
      route: '/account',
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });
    for (const prohibited of LOGGING_PROHIBITED_VALUES) {
      expect(lines[0]).not.toContain(prohibited);
    }
  });

  it('does not invoke request/context accessors and drops unapproved route values', () => {
    const lines: string[] = [];
    const logger = new WebStructuredLogger({ sink: (line) => lines.push(line) });
    let getterReads = 0;
    const request = Object.defineProperty({}, 'method', {
      get: () => {
        getterReads += 1;
        throw new Error(LOGGING_SECRET_CANARIES.credentials);
      },
    });
    const context = Object.defineProperty({}, 'routePath', {
      value: `/account/${LOGGING_SECRET_CANARIES.capabilityToken}`,
      enumerable: true,
    });

    expect(() =>
      recordWebRequestFailure(adversarialLoggingError(), request, context, logger),
    ).not.toThrow();

    expect(getterReads).toBe(0);
    expect(JSON.parse(lines[0] ?? '') as WebStructuredLogRecord).toEqual({
      schemaVersion: 1,
      timestamp: expect.any(String),
      level: 'error',
      event: 'web.request.failed',
      service: 'crypto-lending',
      workload: 'web',
      environment: 'test',
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });
    for (const prohibited of LOGGING_PROHIBITED_VALUES) {
      expect(lines[0]).not.toContain(prohibited);
    }
  });
});
