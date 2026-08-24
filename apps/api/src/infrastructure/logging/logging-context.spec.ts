import {
  createSafeLogReference,
  createRootLogContext,
  LoggingContext,
  type LogCorrelationContext,
} from './logging-context';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = ROOT_ID;
const ACTOR_ID = '00000000-0000-4000-8000-000000000003';
const INTENT_ID = '00000000-0000-4000-8000-000000000004';
const QUOTE_ID = '00000000-0000-4000-8000-000000000005';

function indexedUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

describe('LoggingContext', () => {
  it('creates unique server-authoritative request roots', () => {
    const first = createRootLogContext();
    const second = createRootLogContext();

    expect(first).toEqual({ correlationId: first.requestId, requestId: expect.any(String) });
    expect(first.correlationId).not.toBe(second.correlationId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.getPrototypeOf(first)).toBeNull();
  });

  it('isolates concurrent asynchronous contexts and merges nested job identifiers', async () => {
    const context = new LoggingContext();
    const seen = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        context.run({ correlationId: indexedUuid(index) }, async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          const jobId = createSafeLogReference('job', `job:${index}`);
          if (!jobId) throw new Error('Expected a diagnostic job reference');
          return context.runWith({ jobId }, async () => {
            await Promise.resolve();
            return context.requireCurrent();
          });
        }),
      ),
    );

    expect(seen).toHaveLength(100);
    seen.forEach((value, index) => {
      expect(value).toEqual({
        correlationId: indexedUuid(index),
        jobId: createSafeLogReference('job', `job:${index}`),
      });
      expect(Object.isFrozen(value)).toBe(true);
    });
    expect(context.current()).toBeUndefined();
  });

  it('projects known fields, binds a verified initiator once, and rejects external mutation', () => {
    const context = new LoggingContext();
    const runtimeInput = {
      correlationId: ROOT_ID,
      requestId: REQUEST_ID,
      password: 'must-not-survive',
    } as LogCorrelationContext;

    context.run(runtimeInput, () => {
      expect(context.bindActorId(ACTOR_ID)).toBe(true);
      const current = context.requireCurrent();
      expect(current).toEqual({
        correlationId: ROOT_ID,
        requestId: REQUEST_ID,
        initiatorActorId: ACTOR_ID,
      });
      expect(current).not.toHaveProperty('password');
      expect(() => {
        (current as { correlationId: string }).correlationId = indexedUuid(4);
      }).toThrow(TypeError);
      expect(() => context.bindActorId(indexedUuid(5))).toThrow(
        'Logging context actor cannot be rebound',
      );
      expect(() => context.runWith({ requestId: indexedUuid(6) }, () => undefined)).toThrow(
        'Logging context requestId cannot be replaced',
      );
    });
  });

  it('requires bounded identifiers and a root correlation', () => {
    const context = new LoggingContext();

    const jobId = createSafeLogReference('job', 'job:1');
    expect(() => context.runWith({ ...(jobId ? { jobId } : {}) }, () => undefined)).toThrow(
      'A correlationId is required',
    );
    expect(() => context.run({ correlationId: 'bad\nvalue' }, () => undefined)).toThrow(
      'correlationId must use its canonical diagnostic identifier format',
    );
    expect(context.bindActorId(ACTOR_ID)).toBe(false);
  });

  it('rejects malformed intent and quote identifiers before extending correlation', () => {
    const context = new LoggingContext();

    context.run({ correlationId: ROOT_ID }, () => {
      expect(() => context.runWith({ intentId: 'client-intent' }, () => undefined)).toThrow(
        'intentId must use its canonical diagnostic identifier format',
      );
      expect(() => context.runWith({ quoteId: 'client-quote' }, () => undefined)).toThrow(
        'quoteId must use its canonical diagnostic identifier format',
      );
      expect(context.requireCurrent()).toEqual({ correlationId: ROOT_ID });

      context.runWith({ intentId: INTENT_ID, quoteId: QUOTE_ID }, () => {
        expect(context.requireCurrent()).toEqual({
          correlationId: ROOT_ID,
          intentId: INTENT_ID,
          quoteId: QUOTE_ID,
        });
      });
    });
  });

  it('rejects accessors and ignores prototype pollution without forging an actor', () => {
    const context = new LoggingContext();
    let getterReads = 0;
    const accessor = Object.defineProperty({}, 'correlationId', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return ROOT_ID;
      },
    }) as LogCorrelationContext;
    const polluted = Object.prototype as { initiatorActorId?: string };
    polluted.initiatorActorId = ACTOR_ID;
    try {
      expect(() => context.run(accessor, () => undefined)).toThrow(
        'correlationId must be an own data property',
      );
      expect(getterReads).toBe(0);
      context.run({ correlationId: ROOT_ID }, () => {
        expect(context.requireCurrent()).toEqual({ correlationId: ROOT_ID });
      });
    } finally {
      delete polluted.initiatorActorId;
    }
  });
});
