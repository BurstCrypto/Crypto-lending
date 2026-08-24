// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createWebFatalProcessHandler } from '@/lib/logging/fatal-process-boundary.server';
import {
  WebStructuredLogger,
  type WebStructuredLogRecord,
} from '@/lib/logging/structured-logger.server';

import { LOGGING_PROHIBITED_VALUES, LOGGING_SECRET_CANARIES } from './fixtures/logging-adversarial';

describe('web fatal process boundary', () => {
  it('emits one approved fatal record and exits once without reading raw error accessors', () => {
    const lines: string[] = [];
    const exits: number[] = [];
    const logger = new WebStructuredLogger({ sink: (line) => lines.push(line) });
    const handler = createWebFatalProcessHandler(logger, (status) => exits.push(status));
    let getterReads = 0;
    const reason = Object.defineProperties(
      {},
      {
        code: {
          get: () => {
            getterReads += 1;
            throw new Error(LOGGING_SECRET_CANARIES.capabilityToken);
          },
        },
        stack: {
          get: () => {
            getterReads += 1;
            throw new Error(LOGGING_SECRET_CANARIES.privateKey);
          },
        },
      },
    );

    expect(() => handler(reason)).not.toThrow();
    handler(new Error(LOGGING_SECRET_CANARIES.bearerToken));

    expect(exits).toEqual([1]);
    expect(getterReads).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '') as WebStructuredLogRecord).toMatchObject({
      schemaVersion: 1,
      event: 'process.fatal',
      level: 'fatal',
      workload: 'web',
      outcome: 'failure',
      errorCode: 'UNEXPECTED_ERROR',
    });
    for (const prohibited of LOGGING_PROHIBITED_VALUES) {
      expect(lines[0]).not.toContain(prohibited);
    }
  });
});
