// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  LOG_EVENTS,
  StructuredLogger,
  type StructuredLogRecord,
} from '../../api/src/infrastructure/logging/structured-logger';
import {
  WEB_LOG_EVENTS,
  WebStructuredLogger,
  type WebStructuredLogRecord,
} from '@/lib/logging/structured-logger.server';

describe('structured logging cross-runtime contract', () => {
  it('keeps schema, UTC time, severity, service, and environment metadata identical', () => {
    const timestamp = '2026-08-24T20:15:30.456Z';
    const apiLines: string[] = [];
    const webLines: string[] = [];
    const environment: NodeJS.ProcessEnv = {
      APP_ENV: 'staging-blue',
      NODE_ENV: 'production',
    };
    const apiLogger = new StructuredLogger({
      clock: () => new Date(timestamp),
      environment,
      workload: 'api',
      sink: (line) => apiLines.push(line),
    });
    const webLogger = new WebStructuredLogger({
      clock: () => new Date(timestamp),
      environment,
      sink: (line) => webLines.push(line),
    });

    apiLogger.emit(LOG_EVENTS.applicationStartFailed, 'error', {
      outcome: 'failure',
      errorCode: 'UNEXPECTED_ERROR',
    });
    webLogger.emit(WEB_LOG_EVENTS.requestFailed, 'error', {
      outcome: 'failure',
      errorCode: 'WEB_REQUEST_ERROR',
    });

    const api = JSON.parse(apiLines[0] ?? '') as StructuredLogRecord;
    const web = JSON.parse(webLines[0] ?? '') as WebStructuredLogRecord;
    for (const key of ['schemaVersion', 'timestamp', 'level', 'service', 'environment'] as const) {
      expect(web[key]).toBe(api[key]);
    }
    expect(api.workload).toBe('api');
    expect(web.workload).toBe('web');
    expect(new Date(api.timestamp).toISOString()).toBe(api.timestamp);
    expect(new Date(web.timestamp).toISOString()).toBe(web.timestamp);
  });
});
