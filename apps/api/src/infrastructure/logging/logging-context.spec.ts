import {
  createRootLogContext,
  LoggingContext,
  type LogCorrelationContext,
} from './logging-context';

describe('LoggingContext', () => {
  it('creates unique server-authoritative request roots', () => {
    const first = createRootLogContext();
    const second = createRootLogContext();

    expect(first).toEqual({ correlationId: first.requestId, requestId: expect.any(String) });
    expect(first.correlationId).not.toBe(second.correlationId);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('isolates concurrent asynchronous contexts and merges nested job identifiers', async () => {
    const context = new LoggingContext();
    const seen = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        context.run({ correlationId: `request:${index}` }, async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          return context.runWith({ jobId: `job:${index}` }, async () => {
            await Promise.resolve();
            return context.requireCurrent();
          });
        }),
      ),
    );

    expect(seen).toHaveLength(100);
    seen.forEach((value, index) => {
      expect(value).toEqual({ correlationId: `request:${index}`, jobId: `job:${index}` });
      expect(Object.isFrozen(value)).toBe(true);
    });
    expect(context.current()).toBeUndefined();
  });

  it('projects known fields, binds a verified initiator once, and rejects external mutation', () => {
    const context = new LoggingContext();
    const runtimeInput = {
      correlationId: 'request:trusted',
      requestId: 'request:trusted',
      password: 'must-not-survive',
    } as LogCorrelationContext;

    context.run(runtimeInput, () => {
      expect(context.bindActorId('actor:verified')).toBe(true);
      const current = context.requireCurrent();
      expect(current).toEqual({
        correlationId: 'request:trusted',
        requestId: 'request:trusted',
        initiatorActorId: 'actor:verified',
      });
      expect(current).not.toHaveProperty('password');
      expect(() => {
        (current as { correlationId: string }).correlationId = 'request:attacker';
      }).toThrow(TypeError);
      expect(() => context.bindActorId('actor:different')).toThrow(
        'Logging context actor cannot be rebound',
      );
    });
  });

  it('requires bounded identifiers and a root correlation', () => {
    const context = new LoggingContext();

    expect(() => context.runWith({ jobId: 'job:1' }, () => undefined)).toThrow(
      'A correlationId is required',
    );
    expect(() => context.run({ correlationId: 'bad\nvalue' }, () => undefined)).toThrow(
      'correlationId must be a bounded opaque identifier',
    );
    expect(context.bindActorId('actor:outside')).toBe(false);
  });
});
