import {
  createBalanceSyncExecutionContext,
  reviewBalanceSyncExecutionContext,
  type BalanceSyncExecutionContext,
} from './balance-sync.ports';

describe('balance sync execution context authority', () => {
  it('mints one frozen exact context and reviews the same native signal identity', () => {
    const owner = createBalanceSyncExecutionContext();
    const reviewed = reviewBalanceSyncExecutionContext(owner.context);

    expect(Object.getPrototypeOf(owner)).toBeNull();
    expect(Object.getPrototypeOf(owner.context)).toBeNull();
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.context)).toBe(true);
    expect(Reflect.ownKeys(owner).sort()).toEqual(['abort', 'context']);
    expect(Reflect.ownKeys(owner.context)).toEqual(['signal']);
    expect(reviewed?.signal).toBe(owner.context.signal);
    expect(reviewed?.abortKind).toBeNull();
    expect(Object.getPrototypeOf(reviewed as object)).toBeNull();
    expect(Object.isFrozen(reviewed)).toBe(true);
  });

  it('rejects counterfeit, accessor, proxied, and prototype-forged contexts without reads', () => {
    const genuine = createBalanceSyncExecutionContext().context;
    let reads = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'signal', {
      enumerable: true,
      get: () => {
        reads += 1;
        return genuine.signal;
      },
    });
    const proxy = new Proxy(genuine, {
      get: () => {
        reads += 1;
        throw new Error('must not read');
      },
      getPrototypeOf: () => {
        reads += 1;
        throw new Error('must not inspect');
      },
    });
    const prototypeForged = Object.create(
      Object.getPrototypeOf(genuine),
      Object.getOwnPropertyDescriptors(genuine),
    );

    for (const value of [
      { signal: genuine.signal },
      accessor,
      proxy,
      prototypeForged,
      null,
      undefined,
    ]) {
      expect(reviewBalanceSyncExecutionContext(value)).toBeNull();
    }
    expect(reads).toBe(0);
  });

  it.each([
    ['DEADLINE', 'SHUTDOWN', 'DEADLINE'],
    ['SHUTDOWN', 'DEADLINE', 'SHUTDOWN'],
  ] as const)('keeps first abort kind %s across later %s aborts', (first, second, expected) => {
    const owner = createBalanceSyncExecutionContext();
    owner.abort(first);
    owner.abort(second);
    owner.abort(second);

    const reviewed = reviewBalanceSyncExecutionContext(owner.context);
    expect(reviewed?.abortKind).toBe(expected);
    expect(reviewed?.signal.aborted).toBe(true);
  });

  it('rejects an invalid abort kind without aborting or retaining caller data', () => {
    const owner = createBalanceSyncExecutionContext();
    const callerSecret = 'caller-secret-must-not-become-an-abort-reason';

    expect(() => owner.abort(callerSecret as unknown as Parameters<typeof owner.abort>[0])).toThrow(
      new TypeError('invalid balance sync execution abort kind'),
    );
    expect(reviewBalanceSyncExecutionContext(owner.context)?.abortKind).toBeNull();

    owner.abort('SHUTDOWN');
    const signal = reviewBalanceSyncExecutionContext(owner.context)?.signal;
    expect(String(signal?.reason)).not.toContain(callerSecret);
    expect(JSON.stringify(reviewBalanceSyncExecutionContext(owner.context))).not.toContain(
      callerSecret,
    );
  });

  it('does not recognize a raw native signal cast as a context', () => {
    const signal = new AbortController().signal;
    expect(
      reviewBalanceSyncExecutionContext(signal as unknown as BalanceSyncExecutionContext),
    ).toBeNull();
  });
});
