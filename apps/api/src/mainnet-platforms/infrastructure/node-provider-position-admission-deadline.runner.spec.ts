import type {
  ProviderPositionAdmissionClock,
  ProviderPositionAdmissionDeadlineRunRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  NodeProviderPositionAdmissionDeadlineRunner,
  type ProviderPositionAdmissionDeadlineRunnerError,
  type ProviderPositionAdmissionDeadlineRunnerErrorCode,
  type ProviderPositionAdmissionDeadlineTimerRuntime,
} from './node-provider-position-admission-deadline.runner';

const START = Date.parse('2026-09-05T18:00:00.000Z');
const DEADLINE = '2026-09-05T18:00:05.000Z';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({
    promise,
    resolve: (value: T): void => resolvePromise?.(value),
    reject: (error: unknown): void => rejectPromise?.(error),
  });
}

class MutableClock implements ProviderPositionAdmissionClock {
  constructor(public milliseconds = START) {}

  now(): Date {
    return new Date(this.milliseconds);
  }
}

class ManualTimerRuntime implements ProviderPositionAdmissionDeadlineTimerRuntime {
  readonly delays: number[] = [];
  readonly callbacks = new Map<number, () => void>();
  cancelCalls = 0;
  private nextHandle = 1;

  schedule(callback: () => void, milliseconds: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.delays.push(milliseconds);
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: unknown): void {
    this.cancelCalls += 1;
    if (typeof handle === 'number') this.callbacks.delete(handle);
  }

  fireNext(): void {
    const entry = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (entry === undefined) throw new Error('No timer is scheduled.');
    this.callbacks.delete(entry[0]);
    entry[1]();
  }
}

interface Fixture {
  readonly clock: MutableClock;
  readonly timers: ManualTimerRuntime;
  readonly runner: NodeProviderPositionAdmissionDeadlineRunner;
  readonly controller: AbortController;
  readonly abortAdmission: jest.Mock<void, []>;
}

function fixture(
  timerRuntime: ProviderPositionAdmissionDeadlineTimerRuntime = new ManualTimerRuntime(),
): Fixture {
  const clock = new MutableClock();
  const timers = timerRuntime as ManualTimerRuntime;
  const controller = new AbortController();
  const abortAdmission = jest.fn(() => controller.abort());
  return Object.freeze({
    clock,
    timers,
    runner: new NodeProviderPositionAdmissionDeadlineRunner(clock, timerRuntime),
    controller,
    abortAdmission,
  });
}

function request(
  value: Fixture,
  overrides: Readonly<Record<string, unknown>> = {},
): ProviderPositionAdmissionDeadlineRunRequestV1 {
  return Object.freeze({
    deadlineAt: DEADLINE,
    correlationId: 'provider-position-read-1',
    sourceFamilyId: 'ethereum-primary',
    targetId: 'provider-position-target-1',
    signal: value.controller.signal,
    abortAdmission: value.abortAdmission,
    ...overrides,
  }) as ProviderPositionAdmissionDeadlineRunRequestV1;
}

async function expectFailure(
  promise: Promise<unknown>,
  code: ProviderPositionAdmissionDeadlineRunnerErrorCode,
): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining({
      name: 'ProviderPositionAdmissionDeadlineRunnerError',
      code,
      message: 'Provider-position admission deadline execution is unavailable.',
    }),
  );
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('NodeProviderPositionAdmissionDeadlineRunner', () => {
  it('returns a drained success strictly before the exclusive deadline and cleans its timer', async () => {
    const value = fixture();
    const result = Object.freeze({ snapshot: 'covered' });
    const operation = jest.fn(async () => result);

    await expect(value.runner.run(request(value), operation)).resolves.toBe(result);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(value.timers.delays).toEqual([5_000]);
    expect(value.timers.callbacks.size).toBe(0);
    expect(value.timers.cancelCalls).toBe(1);
    expect(value.abortAdmission).not.toHaveBeenCalled();
    expect(value.controller.signal.aborted).toBe(false);
  });

  it('rejects pre-aborted and pre-expired work before invoking the operation', async () => {
    const aborted = fixture();
    aborted.controller.abort();
    const abortedOperation = jest.fn(async () => 'must-not-run');
    await expectFailure(
      aborted.runner.run(request(aborted), abortedOperation),
      'ADMISSION_ABORTED',
    );
    expect(abortedOperation).not.toHaveBeenCalled();
    expect(aborted.timers.delays).toEqual([]);
    expect(aborted.abortAdmission).not.toHaveBeenCalled();

    const expired = fixture();
    expired.clock.milliseconds = Date.parse(DEADLINE);
    const expiredOperation = jest.fn(async () => 'must-not-run');
    await expectFailure(
      expired.runner.run(request(expired), expiredOperation),
      'DEADLINE_EXCEEDED',
    );
    expect(expiredOperation).not.toHaveBeenCalled();
    expect(expired.timers.delays).toEqual([]);
    expect(expired.abortAdmission).toHaveBeenCalledTimes(1);
    expect(expired.controller.signal.aborted).toBe(true);
  });

  it.each(['resolve', 'reject'] as const)(
    'aborts at the deadline and drains a late operation %s before rejecting',
    async (settlement) => {
      const value = fixture();
      const gate = deferred<string>();
      const operation = jest.fn(() => gate.promise);
      const running = value.runner.run(request(value), operation);
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await flushMicrotasks();
      expect(operation).toHaveBeenCalledTimes(1);

      value.clock.milliseconds = Date.parse(DEADLINE);
      value.timers.fireNext();
      await flushMicrotasks();

      expect(value.controller.signal.aborted).toBe(true);
      expect(value.abortAdmission).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      if (settlement === 'resolve') gate.resolve('late-private-value');
      else gate.reject(new Error('private provider detail'));
      await expectFailure(running, 'DEADLINE_EXCEEDED');
      expect(value.timers.callbacks.size).toBe(0);
      expect(value.timers.cancelCalls).toBe(1);
    },
  );

  it('drains an externally aborted operation before returning a sanitized failure', async () => {
    const value = fixture();
    const gate = deferred<string>();
    const running = value.runner.run(request(value), () => gate.promise);
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await flushMicrotasks();

    value.controller.abort();
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(value.abortAdmission).not.toHaveBeenCalled();

    gate.resolve('discarded');
    await expectFailure(running, 'ADMISSION_ABORTED');
    expect(value.timers.callbacks.size).toBe(0);
    expect(value.timers.cancelCalls).toBe(1);
  });

  it('aborts the admission and hides an operation failure', async () => {
    const value = fixture();
    const running = value.runner.run(request(value), async () => {
      throw new Error('provider credential and endpoint');
    });

    await expectFailure(running, 'OPERATION_FAILED');
    expect(value.abortAdmission).toHaveBeenCalledTimes(1);
    expect(value.controller.signal.aborted).toBe(true);
    expect(value.timers.callbacks.size).toBe(0);
    expect(value.timers.cancelCalls).toBe(1);
  });

  it('rejects a completion exactly at the exclusive deadline even before the timer runs', async () => {
    const value = fixture();
    const gate = deferred<string>();
    const running = value.runner.run(request(value), () => gate.promise);
    await flushMicrotasks();

    value.clock.milliseconds = Date.parse(DEADLINE);
    gate.resolve('boundary-value');

    await expectFailure(running, 'DEADLINE_EXCEEDED');
    expect(value.abortAdmission).toHaveBeenCalledTimes(1);
    expect(value.controller.signal.aborted).toBe(true);
    expect(value.timers.callbacks.size).toBe(0);
  });

  it('rechecks abort immediately before deferred operation invocation', async () => {
    const clock = new MutableClock();
    const controller = new AbortController();
    const timers = new ManualTimerRuntime();
    const runtime: ProviderPositionAdmissionDeadlineTimerRuntime = Object.freeze({
      schedule(callback: () => void, milliseconds: number): unknown {
        queueMicrotask(() => controller.abort());
        return timers.schedule(callback, milliseconds);
      },
      cancel(handle: unknown): void {
        timers.cancel(handle);
      },
    });
    const abortAdmission = jest.fn(() => controller.abort());
    const value = Object.freeze({
      clock,
      timers,
      runner: new NodeProviderPositionAdmissionDeadlineRunner(clock, runtime),
      controller,
      abortAdmission,
    });
    const operation = jest.fn(async () => 'must-not-run');

    await expectFailure(value.runner.run(request(value), operation), 'ADMISSION_ABORTED');
    expect(operation).not.toHaveBeenCalled();
    expect(timers.callbacks.size).toBe(0);
    expect(timers.cancelCalls).toBe(1);
  });

  it('fails closed on a regressing clock and timer setup failure', async () => {
    const regressing = fixture();
    const gate = deferred<string>();
    const running = regressing.runner.run(request(regressing), () => gate.promise);
    await flushMicrotasks();
    regressing.clock.milliseconds = START - 1;
    gate.resolve('discarded');
    await expectFailure(running, 'RUNTIME_UNAVAILABLE');
    expect(regressing.controller.signal.aborted).toBe(true);

    const timerFailureRuntime: ProviderPositionAdmissionDeadlineTimerRuntime = Object.freeze({
      schedule(): never {
        throw new Error('private timer failure');
      },
      cancel(): void {},
    });
    const timerFailure = fixture(timerFailureRuntime);
    const operation = jest.fn(async () => 'must-not-run');
    await expectFailure(
      timerFailure.runner.run(request(timerFailure), operation),
      'RUNTIME_UNAVAILABLE',
    );
    expect(operation).not.toHaveBeenCalled();
    expect(timerFailure.controller.signal.aborted).toBe(true);
  });

  it('rejects excessive deadlines and an abort callback unrelated to the supplied signal', async () => {
    const excessive = fixture();
    const excessiveDeadline = new Date(START + 30_001).toISOString();
    const operation = jest.fn(async () => 'must-not-run');
    await expectFailure(
      excessive.runner.run(request(excessive, { deadlineAt: excessiveDeadline }), operation),
      'INVALID_REQUEST',
    );
    expect(operation).not.toHaveBeenCalled();
    expect(excessive.controller.signal.aborted).toBe(true);

    const unrelated = fixture();
    const gate = deferred<string>();
    const noOpAbort = jest.fn();
    const running = unrelated.runner.run(
      request(unrelated, { abortAdmission: noOpAbort }),
      () => gate.promise,
    );
    await flushMicrotasks();
    unrelated.clock.milliseconds = Date.parse(DEADLINE);
    unrelated.timers.fireNext();
    gate.resolve('discarded');
    await expectFailure(running, 'INVALID_ABORT_CAPABILITY');
    expect(noOpAbort).toHaveBeenCalledTimes(1);
  });

  it('rejects accessor requests and counterfeit signals without invoking hostile code or work', async () => {
    const value = fixture();
    const operation = jest.fn(async () => 'must-not-run');
    let getterInvoked = false;
    const accessorRequest: Record<string, unknown> = {
      correlationId: 'provider-position-read-1',
      sourceFamilyId: 'ethereum-primary',
      targetId: 'provider-position-target-1',
      signal: value.controller.signal,
      abortAdmission: value.abortAdmission,
    };
    Object.defineProperty(accessorRequest, 'deadlineAt', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return DEADLINE;
      },
    });
    await expectFailure(
      value.runner.run(
        accessorRequest as unknown as ProviderPositionAdmissionDeadlineRunRequestV1,
        operation,
      ),
      'INVALID_REQUEST',
    );
    expect(getterInvoked).toBe(false);

    const counterfeit = fixture();
    await expectFailure(
      counterfeit.runner.run(
        request(counterfeit, { signal: new Proxy(counterfeit.controller.signal, {}) }),
        operation,
      ),
      'INVALID_REQUEST',
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects invalid constructor dependencies without exposing their details', () => {
    expect(
      () =>
        new NodeProviderPositionAdmissionDeadlineRunner(
          Object.create(null) as ProviderPositionAdmissionClock,
        ),
    ).toThrow(
      expect.objectContaining({
        name: 'ProviderPositionAdmissionDeadlineRunnerError',
        code: 'INVALID_CONFIGURATION',
      }) as ProviderPositionAdmissionDeadlineRunnerError,
    );
  });
});
