import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DormantBalanceSyncConsumerResource } from './balance-sync-consumer.resource';
import {
  createDormantBalanceSyncConsumerLifecycleCoordinator,
  type BalanceSyncConsumerLifecycleEvent,
  type BalanceSyncConsumerLifecycleOperatorPort,
} from './balance-sync-consumer.lifecycle';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function aggregateResource(
  run: (signal: AbortSignal) => Promise<void>,
  close: () => Promise<void>,
): Readonly<DormantBalanceSyncConsumerResource> {
  return Object.freeze(
    Object.assign(Object.create(null) as DormantBalanceSyncConsumerResource, { run, close }),
  );
}

function operatorHarness(): {
  readonly events: BalanceSyncConsumerLifecycleEvent[];
  readonly port: BalanceSyncConsumerLifecycleOperatorPort;
  readonly record: jest.Mock;
} {
  const events: BalanceSyncConsumerLifecycleEvent[] = [];
  const record = jest.fn((event: BalanceSyncConsumerLifecycleEvent) => {
    events.push(event);
  });
  return { events, port: { record }, record };
}

async function capturedRejection(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
    throw new Error('expected rejection');
  } catch (error) {
    return error;
  }
}

function expectFixedError(
  error: unknown,
  expected: Readonly<{ code: string; name: string; message: string }>,
): void {
  expect(error).toMatchObject(expected);
  expect(error).not.toHaveProperty('cause');
}

describe('createDormantBalanceSyncConsumerLifecycleCoordinator', () => {
  it('constructs an exact inert facade without touching aggregate, operator, or signal listeners', () => {
    const run = jest.fn(async () => undefined);
    const close = jest.fn(async () => undefined);
    const operator = operatorHarness();
    const signal = new AbortController().signal;
    const addListener = jest.spyOn(EventTarget.prototype, 'addEventListener');
    const removeListener = jest.spyOn(EventTarget.prototype, 'removeEventListener');

    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(run, close),
      signal,
      operatorEvents: operator.port,
    });

    expect(Object.getPrototypeOf(coordinator)).toBeNull();
    expect(Object.isFrozen(coordinator)).toBe(true);
    expect(Reflect.ownKeys(coordinator)).toEqual(['run']);
    expect(Object.getOwnPropertyDescriptor(coordinator, 'run')).toMatchObject({
      enumerable: true,
      configurable: false,
      writable: false,
    });
    expect(run).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(operator.record).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(removeListener).not.toHaveBeenCalled();

    addListener.mockRestore();
    removeListener.mockRestore();
  });

  it('bridges an expected stop without forwarding its hostile reason, drains run, then closes', async () => {
    const external = new AbortController();
    const order: string[] = [];
    let privateSignal: AbortSignal | undefined;
    const run = jest.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          privateSignal = signal;
          order.push('run-started');
          const finish = (): void => {
            order.push('run-settled');
            resolve();
          };
          if (signal.aborted) finish();
          else signal.addEventListener('abort', finish, { once: true });
        }),
    );
    const close = jest.fn(async () => {
      order.push('close');
    });
    const operator = operatorHarness();
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(run, close),
      signal: external.signal,
      operatorEvents: operator.port,
    });

    const running = coordinator.run();
    await Promise.resolve();
    await Promise.resolve();
    const hostileReason = new Proxy(Object.create(null) as object, {
      get() {
        throw new Error('hostile external abort reason');
      },
      getPrototypeOf() {
        throw new Error('hostile external abort reason');
      },
    });
    expect(() => external.abort(hostileReason)).not.toThrow();
    await expect(running).resolves.toBeUndefined();

    expect(privateSignal?.aborted).toBe(true);
    expect(privateSignal?.reason).toEqual(
      new Error('Balance sync consumer lifecycle stop requested'),
    );
    expect(privateSignal?.reason).not.toBe(hostileReason);
    expect(order).toEqual(['run-started', 'run-settled', 'close']);
    expect(close).toHaveBeenCalledTimes(1);
    expect(operator.events.map(({ event }) => event)).toEqual(['STARTED', 'STOPPED']);
    for (const event of operator.events) {
      expect(Object.getPrototypeOf(event)).toBeNull();
      expect(Object.isFrozen(event)).toBe(true);
      expect(Reflect.ownKeys(event)).toEqual(['event']);
      expect(JSON.stringify(event)).not.toContain('hostile external abort reason');
    }
  });

  it('treats an already-aborted genuine signal as an expected stop and still consumes the run', async () => {
    const external = new AbortController();
    external.abort(new Error('external detail'));
    const operator = operatorHarness();
    const run = jest.fn(async (signal: AbortSignal) => {
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toEqual(new Error('Balance sync consumer lifecycle stop requested'));
    });
    const close = jest.fn(async () => undefined);
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(run, close),
      signal: external.signal,
      operatorEvents: operator.port,
    });

    await expect(coordinator.run()).resolves.toBeUndefined();
    expect(operator.events.map(({ event }) => event)).toEqual(['STOPPED']);
    expect(close).toHaveBeenCalledTimes(1);
    await expect(coordinator.run()).rejects.toMatchObject({
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_ALREADY_STARTED',
    });
  });

  it('closes and reports a premature run exit while removing the external listener', async () => {
    const external = new AbortController();
    const operator = operatorHarness();
    let privateSignal: AbortSignal | undefined;
    const run = jest.fn(async (signal: AbortSignal) => {
      privateSignal = signal;
    });
    const close = jest.fn(async () => undefined);
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(run, close),
      signal: external.signal,
      operatorEvents: operator.port,
    });

    const error = await capturedRejection(() => coordinator.run());
    expectFixedError(error, {
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_PREMATURE_RUN_EXIT',
      name: 'BalanceSyncConsumerLifecyclePrematureExitError',
      message: 'Balance sync consumer lifecycle run exited before shutdown',
    });
    expect(operator.events.map(({ event }) => event)).toEqual(['STARTED', 'PREMATURE_RUN_EXIT']);
    expect(close).toHaveBeenCalledTimes(1);
    external.abort();
    expect(privateSignal?.aborted).toBe(false);
  });

  it('sanitizes a run rejection, reports it, drains it, and still closes', async () => {
    const external = new AbortController();
    const operator = operatorHarness();
    const close = jest.fn(async () => undefined);
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(async () => {
        throw new Error('provider-secret.example/key');
      }, close),
      signal: external.signal,
      operatorEvents: operator.port,
    });

    const error = await capturedRejection(() => coordinator.run());
    expectFixedError(error, {
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_RUN_FAILED',
      name: 'BalanceSyncConsumerLifecycleRunError',
      message: 'Balance sync consumer lifecycle run failed',
    });
    expect(JSON.stringify(error)).not.toContain('provider-secret.example');
    expect(operator.events.map(({ event }) => event)).toEqual(['STARTED', 'RUN_FAILED']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not report started when the aggregate rejects the run handoff synchronously', async () => {
    const operator = operatorHarness();
    const close = jest.fn(async () => undefined);
    const synchronousFailure = (): Promise<void> => {
      throw new Error('synchronous aggregate secret');
    };
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(synchronousFailure, close),
      signal: new AbortController().signal,
      operatorEvents: operator.port,
    });

    const error = await capturedRejection(() => coordinator.run());

    expectFixedError(error, {
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_RUN_FAILED',
      name: 'BalanceSyncConsumerLifecycleRunError',
      message: 'Balance sync consumer lifecycle run failed',
    });
    expect(operator.events.map(({ event }) => event)).toEqual(['RUN_FAILED']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('gives a fixed close failure precedence while retaining both terminal operator events', async () => {
    const external = new AbortController();
    const operator = operatorHarness();
    const runFailure = deferred<void>();
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(
        async () => runFailure.promise,
        async () => {
          throw new Error('database-secret');
        },
      ),
      signal: external.signal,
      operatorEvents: operator.port,
    });

    const running = coordinator.run();
    await Promise.resolve();
    runFailure.reject(new Error('rpc-secret'));
    const error = await capturedRejection(() => running);

    expectFixedError(error, {
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CLOSE_FAILED',
      name: 'BalanceSyncConsumerLifecycleCloseError',
      message: 'Balance sync consumer lifecycle close failed',
    });
    expect(JSON.stringify(error)).not.toMatch(/database-secret|rpc-secret/u);
    expect(operator.events.map(({ event }) => event)).toEqual([
      'STARTED',
      'RUN_FAILED',
      'CLOSE_FAILED',
    ]);
  });

  it('marks one-shot state synchronously and rejects concurrent and late attempts', async () => {
    const external = new AbortController();
    const runGate = deferred<void>();
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(
        async () => runGate.promise,
        async () => undefined,
      ),
      signal: external.signal,
      operatorEvents: operatorHarness().port,
    });

    const first = coordinator.run();
    const concurrent = await capturedRejection(() => coordinator.run());
    expectFixedError(concurrent, {
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_ALREADY_STARTED',
      name: 'BalanceSyncConsumerLifecycleAlreadyStartedError',
      message: 'Balance sync consumer lifecycle is already started',
    });
    external.abort();
    runGate.resolve(undefined);
    await expect(first).resolves.toBeUndefined();
    await expect(coordinator.run()).rejects.toMatchObject({
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_ALREADY_STARTED',
    });
  });

  it('isolates hostile and reentrant operator callbacks from lifecycle behavior', async () => {
    const external = new AbortController();
    const lateAttempts: Promise<unknown>[] = [];
    let rerun = (): Promise<unknown> => Promise.reject(new Error('coordinator not ready'));
    const record = jest.fn((event: BalanceSyncConsumerLifecycleEvent) => {
      if (event.event === 'STARTED') lateAttempts.push(rerun());
      throw new Error('operator sink secret');
    });
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(
        (signal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          }),
        async () => undefined,
      ),
      signal: external.signal,
      operatorEvents: { record },
    });
    rerun = () => coordinator.run().catch((error: unknown) => error);

    const running = coordinator.run();
    await Promise.resolve();
    await Promise.resolve();
    external.abort();
    await expect(running).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledTimes(2);
    expect(await lateAttempts[0]).toMatchObject({
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_ALREADY_STARTED',
    });
  });

  it('drains rejected async operator callbacks without an unhandled rejection', async () => {
    const external = new AbortController();
    const unhandled = jest.fn();
    const events: BalanceSyncConsumerLifecycleEvent['event'][] = [];
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(
        (signal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          }),
        async () => undefined,
      ),
      signal: external.signal,
      operatorEvents: {
        record: (event) => {
          events.push(event.event);
          return Promise.reject(new Error('async operator sink secret'));
        },
      },
    });
    process.on('unhandledRejection', unhandled);

    try {
      const running = coordinator.run();
      await Promise.resolve();
      external.abort();
      await expect(running).resolves.toBeUndefined();
      await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));

      expect(events).toEqual(['STARTED', 'STOPPED']);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandled);
    }
  });

  it('rejects malformed boundaries without invoking accessors or aggregate capabilities', () => {
    const run = jest.fn(async () => undefined);
    const close = jest.fn(async () => undefined);
    const signal = new AbortController().signal;
    const accessed = jest.fn(() => {
      throw new Error('accessor secret');
    });
    const malformedDependencies = Object.defineProperty(
      {
        resource: aggregateResource(run, close),
        signal,
        operatorEvents: operatorHarness().port,
      },
      'resource',
      { enumerable: true, get: accessed },
    );

    expect(() =>
      createDormantBalanceSyncConsumerLifecycleCoordinator(malformedDependencies as never),
    ).toThrow(
      expect.objectContaining({
        code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_INVALID',
      }),
    );
    expect(accessed).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    expect(() =>
      createDormantBalanceSyncConsumerLifecycleCoordinator({
        resource: Object.freeze({ run, close }) as never,
        signal,
        operatorEvents: operatorHarness().port,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_INVALID',
      }),
    );
    expect(() =>
      createDormantBalanceSyncConsumerLifecycleCoordinator({
        resource: aggregateResource(run, close),
        signal: {} as AbortSignal,
        operatorEvents: operatorHarness().port,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_INVALID',
      }),
    );

    const operatorGetter = jest.fn(() => run);
    const hostileOperator = Object.defineProperty({}, 'record', {
      enumerable: true,
      get: operatorGetter,
    });
    expect(() =>
      createDormantBalanceSyncConsumerLifecycleCoordinator({
        resource: aggregateResource(run, close),
        signal,
        operatorEvents: hostileOperator as never,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_INVALID',
      }),
    );
    expect(operatorGetter).not.toHaveBeenCalled();
  });

  it('closes after a run-time signal-listener failure and returns only a fixed signal error', async () => {
    const external = new AbortController();
    const close = jest.fn(async () => undefined);
    const coordinator = createDormantBalanceSyncConsumerLifecycleCoordinator({
      resource: aggregateResource(async () => undefined, close),
      signal: external.signal,
      operatorEvents: operatorHarness().port,
    });
    const addListener = jest
      .spyOn(EventTarget.prototype, 'addEventListener')
      .mockImplementationOnce(() => {
        throw new Error('listener secret');
      });

    const error = await capturedRejection(() => coordinator.run());
    addListener.mockRestore();

    expectFixedError(error, {
      code: 'BALANCE_SYNC_CONSUMER_LIFECYCLE_SIGNAL_INVALID',
      name: 'BalanceSyncConsumerLifecycleSignalError',
      message: 'Balance sync consumer lifecycle signal is invalid',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('remains source-only and absent from launch and composition roots', () => {
    const source = readFileSync(resolve(__dirname, 'balance-sync-consumer.lifecycle.ts'), 'utf8');
    expect(source).not.toMatch(
      /process\.|NestFactory|@Module|loadBalanceConsumer|BalanceJsonRpcTransport|setTimeout|setInterval/u,
    );
    for (const relativePath of [
      'balance-sync-consumer.runtime.ts',
      'balance-sync-consumer.cli.ts',
      'balance-sync-consumer.cli-mode.ts',
      'balance-sync-consumer.activation.ts',
      'balance-sync-consumer.composition.ts',
      '../blockchain-sync.module.ts',
      '../index.ts',
    ]) {
      const launchSource = readFileSync(resolve(__dirname, relativePath), 'utf8');
      expect(launchSource).not.toContain('balance-sync-consumer.lifecycle');
      expect(launchSource).not.toContain('createDormantBalanceSyncConsumerLifecycleCoordinator');
    }
  });
});
