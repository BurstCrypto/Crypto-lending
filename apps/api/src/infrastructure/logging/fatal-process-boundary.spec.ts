import { createFatalProcessHandler } from './fatal-process-boundary';
import { StructuredLogger, type StructuredLogRecord } from './structured-logger';

describe('fatal process boundary', () => {
  it('emits one safe record and terminates once without reading raw error accessors', () => {
    const lines: string[] = [];
    const exits: number[] = [];
    const logger = new StructuredLogger({
      workload: 'worker',
      sink: (line) => lines.push(line),
    });
    const handler = createFatalProcessHandler(logger, (status) => exits.push(status));
    let getterReads = 0;
    const reason = Object.defineProperty({}, 'code', {
      get: () => {
        getterReads += 1;
        throw new Error('Bearer fatal-canary');
      },
    });

    expect(() => handler(reason)).not.toThrow();
    handler(new Error('second secret must not be logged'));

    expect(exits).toEqual([1]);
    expect(getterReads).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '') as StructuredLogRecord).toMatchObject({
      event: 'process.fatal',
      level: 'fatal',
      workload: 'worker',
      outcome: 'failure',
      errorCode: 'UNEXPECTED_ERROR',
    });
    expect(lines[0]).not.toMatch(/fatal-canary|second secret|Bearer/u);
  });
});
