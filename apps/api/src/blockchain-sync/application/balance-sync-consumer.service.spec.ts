import type { JobEnvelope, JobProcessingResult } from '../../infrastructure/sqs/sqs.types';
import {
  reviewBalanceSyncExecutionContext,
  type BalanceSyncExecutionContext,
} from './ports/balance-sync.ports';
import {
  BalanceSyncConsumerError,
  BalanceSyncConsumerService,
  type BalanceSyncConsumerDispatcherPort,
  type BalanceSyncConsumerPolicy,
  type BalanceSyncConsumerQueueWorkerPort,
  type BalanceSyncConsumerWait,
} from './balance-sync-consumer.service';

const POLICY = Object.freeze({
  idleDelayMs: 50,
  dependencyFailureBaseDelayMs: 10,
  dependencyFailureMaxDelayMs: 40,
  maximumRpcWindowMs: 7_200_000,
}) satisfies BalanceSyncConsumerPolicy;

const JOB: JobEnvelope = Object.freeze({
  id: 'job-1',
  kind: 'blockchain.balance-sync',
  version: 1,
  occurredAt: '2026-09-04T12:00:00.000Z',
  correlation: Object.freeze({ correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  payload: Object.freeze({}),
});

function failedResult(status: 'retry-scheduled' | 'awaiting-dead-letter'): JobProcessingResult {
  return {
    status,
    messageId: 'message-1',
    jobId: JOB.id,
    receiveCount: 1,
    retryDelaySeconds: status === 'retry-scheduled' ? 5 : 0,
    errorCode: 'JOB_HANDLER_FAILED',
  };
}

function dispatcher(): BalanceSyncConsumerDispatcherPort & { dispatch: jest.Mock } {
  return { dispatch: jest.fn().mockResolvedValue(undefined) };
}

describe('BalanceSyncConsumerService', () => {
  it('is inert until run and dispatches a worker-delivered job exactly once', async () => {
    const controller = new AbortController();
    const configuredDispatcher = dispatcher();
    const processOne = jest.fn(
      async (handler: (job: JobEnvelope) => Promise<void>, _signal: AbortSignal) => {
        void _signal;
        await handler(JOB);
        controller.abort();
        return {
          status: 'completed',
          messageId: 'message-1',
          jobId: JOB.id,
        } satisfies JobProcessingResult;
      },
    );
    const service = new BalanceSyncConsumerService({ processOne }, configuredDispatcher, POLICY);

    expect(processOne).not.toHaveBeenCalled();
    expect(configuredDispatcher.dispatch).not.toHaveBeenCalled();
    await service.run(controller.signal);

    expect(processOne).toHaveBeenCalledTimes(1);
    const workerSignal = processOne.mock.calls[0]?.[1] as AbortSignal;
    expect(workerSignal).not.toBe(controller.signal);
    expect(configuredDispatcher.dispatch).toHaveBeenCalledWith(JOB, expect.anything());
    const context = configuredDispatcher.dispatch.mock.calls[0]?.[1] as BalanceSyncExecutionContext;
    expect(reviewBalanceSyncExecutionContext(context)?.signal).toBeInstanceOf(AbortSignal);
  });

  it('propagates cancellation into a pending worker poll and exits without dispatch or backoff', async () => {
    const controller = new AbortController();
    const configuredDispatcher = dispatcher();
    const wait = jest.fn<
      ReturnType<BalanceSyncConsumerWait>,
      Parameters<BalanceSyncConsumerWait>
    >();
    const processOne = jest.fn(
      async (
        _handler: (job: JobEnvelope) => Promise<void>,
        abortSignal: AbortSignal,
      ): Promise<JobProcessingResult> =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () => reject(new Error('poll aborted')), {
            once: true,
          });
        }),
    );
    const service = new BalanceSyncConsumerService(
      { processOne },
      configuredDispatcher,
      POLICY,
      wait,
    );

    const running = service.run(controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const workerSignal = processOne.mock.calls[0]?.[1] as AbortSignal;
    expect(workerSignal).not.toBe(controller.signal);

    controller.abort();
    await expect(running).resolves.toBeUndefined();

    expect(configuredDispatcher.dispatch).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  it('waits on idle and resolves promptly when aborted during the default wait', async () => {
    const controller = new AbortController();
    const processOne = jest.fn(async () => ({ status: 'idle' }) satisfies JobProcessingResult);
    const service = new BalanceSyncConsumerService({ processOne }, dispatcher(), POLICY);

    const running = service.run(controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await running;

    expect(processOne).toHaveBeenCalledTimes(1);
  });

  it('applies exponential dependency backoff with a hard maximum', async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    const processOne = jest
      .fn<Promise<JobProcessingResult>, [(job: JobEnvelope) => Promise<void>]>()
      .mockRejectedValueOnce(new Error('private dependency detail'))
      .mockResolvedValueOnce(failedResult('retry-scheduled'))
      .mockRejectedValueOnce(new Error('another private dependency detail'))
      .mockResolvedValue(failedResult('awaiting-dead-letter'));
    const wait: BalanceSyncConsumerWait = async (milliseconds) => {
      delays.push(milliseconds);
      if (delays.length === 4) controller.abort();
    };
    const service = new BalanceSyncConsumerService({ processOne }, dispatcher(), POLICY, wait);

    await service.run(controller.signal);

    expect(delays).toEqual([10, 20, 40, 40]);
    expect(processOne).toHaveBeenCalledTimes(4);
  });

  it('resets dependency backoff after a completed pass', async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    const processOne = jest
      .fn<Promise<JobProcessingResult>, [(job: JobEnvelope) => Promise<void>]>()
      .mockRejectedValueOnce(new Error('dependency unavailable'))
      .mockResolvedValueOnce({ status: 'completed', messageId: 'message-1', jobId: JOB.id })
      .mockResolvedValue(failedResult('retry-scheduled'));
    const wait: BalanceSyncConsumerWait = async (milliseconds) => {
      delays.push(milliseconds);
      if (delays.length === 2) controller.abort();
    };
    const service = new BalanceSyncConsumerService({ processOne }, dispatcher(), POLICY, wait);

    await service.run(controller.signal);

    expect(delays).toEqual([10, 10]);
  });

  it('rejects a concurrent run but can release the guard after the first run exits', async () => {
    const firstController = new AbortController();
    let finish: ((result: JobProcessingResult) => void) | undefined;
    const pending = new Promise<JobProcessingResult>((resolve) => {
      finish = resolve;
    });
    const worker: BalanceSyncConsumerQueueWorkerPort = { processOne: async () => pending };
    const service = new BalanceSyncConsumerService(worker, dispatcher(), POLICY);
    const firstRun = service.run(firstController.signal);

    await expect(service.run(new AbortController().signal)).rejects.toEqual(
      new BalanceSyncConsumerError('BALANCE_SYNC_CONSUMER_ALREADY_RUNNING'),
    );
    firstController.abort();
    finish?.({ status: 'idle' });
    await firstRun;

    const stopped = new AbortController();
    stopped.abort();
    await expect(service.run(stopped.signal)).resolves.toBeUndefined();
  });

  it('does not poll when already aborted and rejects malformed signals and policies', async () => {
    const controller = new AbortController();
    controller.abort();
    const processOne = jest.fn(async () => ({ status: 'idle' }) satisfies JobProcessingResult);
    const service = new BalanceSyncConsumerService({ processOne }, dispatcher(), POLICY);

    await service.run(controller.signal);
    expect(processOne).not.toHaveBeenCalled();
    await expect(service.run({} as AbortSignal)).rejects.toEqual(
      new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_SIGNAL'),
    );

    let reads = 0;
    const accessorPolicy = { ...POLICY } as Record<string, unknown>;
    Object.defineProperty(accessorPolicy, 'idleDelayMs', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 50;
      },
    });
    expect(
      () =>
        new BalanceSyncConsumerService(
          { processOne },
          dispatcher(),
          accessorPolicy as unknown as BalanceSyncConsumerPolicy,
        ),
    ).toThrow(new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY'));
    expect(reads).toBe(0);

    for (const maximumRpcWindowMs of [7_199_999, 21_600_001, 7_200_000.5, Number.NaN]) {
      expect(
        () =>
          new BalanceSyncConsumerService(
            { processOne },
            dispatcher(),
            Object.freeze({ ...POLICY, maximumRpcWindowMs }),
          ),
      ).toThrow(new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY'));
    }
  });

  it('uses intrinsics for a shadowed parent signal and gives the worker a canonical owned signal', async () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, 'aborted', {
      configurable: true,
      value: true,
    });
    let workerSignal: AbortSignal | undefined;
    const processOne = jest.fn(
      async (
        _handler: (job: JobEnvelope) => Promise<void>,
        signal: AbortSignal,
      ): Promise<JobProcessingResult> => {
        workerSignal = signal;
        controller.abort('raw-parent-reason');
        return { status: 'idle' };
      },
    );
    const service = new BalanceSyncConsumerService({ processOne }, dispatcher(), POLICY);

    await service.run(controller.signal);

    expect(processOne).toHaveBeenCalledTimes(1);
    expect(workerSignal).not.toBe(controller.signal);
    expect(Object.hasOwn(workerSignal as object, 'aborted')).toBe(false);
  });

  it('mints a distinct execution context and signal for every accepted job', async () => {
    const controller = new AbortController();
    const contexts: BalanceSyncExecutionContext[] = [];
    const configuredDispatcher: BalanceSyncConsumerDispatcherPort = {
      dispatch: async (_job, context) => {
        contexts.push(context);
      },
    };
    let accepted = 0;
    const processOne = jest.fn(
      async (handler: (job: JobEnvelope) => Promise<void>): Promise<JobProcessingResult> => {
        await handler(JOB);
        accepted += 1;
        if (accepted === 2) controller.abort();
        return { status: 'completed', messageId: `message-${accepted}`, jobId: JOB.id };
      },
    );
    const service = new BalanceSyncConsumerService({ processOne }, configuredDispatcher, POLICY);

    await service.run(controller.signal);

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(reviewBalanceSyncExecutionContext(contexts[0])?.signal).not.toBe(
      reviewBalanceSyncExecutionContext(contexts[1])?.signal,
    );
  });

  it.each([
    ['deadline', 'DEADLINE'],
    ['shutdown', 'SHUTDOWN'],
  ] as const)(
    'classifies a pending accepted job %s without forwarding a raw reason',
    async (cause, kind) => {
      jest.useFakeTimers();
      try {
        const controller = new AbortController();
        let context: BalanceSyncExecutionContext | undefined;
        let observedKind: string | null | undefined;
        const configuredDispatcher: BalanceSyncConsumerDispatcherPort = {
          dispatch: async (_job, execution) => {
            context = execution;
            const reviewed = reviewBalanceSyncExecutionContext(execution);
            await new Promise<void>((_resolve, reject) => {
              reviewed?.signal.addEventListener(
                'abort',
                () => {
                  observedKind = reviewBalanceSyncExecutionContext(execution)?.abortKind;
                  reject(new Error('fixed test rejection'));
                },
                { once: true },
              );
            });
          },
        };
        const processOne = jest.fn(
          async (handler: (job: JobEnvelope) => Promise<void>): Promise<JobProcessingResult> => {
            try {
              await handler(JOB);
            } catch {
              controller.abort('raw-parent-reason');
            }
            return failedResult('retry-scheduled');
          },
        );
        const wait: BalanceSyncConsumerWait = async () => undefined;
        const service = new BalanceSyncConsumerService(
          { processOne },
          configuredDispatcher,
          POLICY,
          wait,
        );
        const running = service.run(controller.signal);
        await Promise.resolve();

        if (cause === 'deadline') {
          await jest.advanceTimersByTimeAsync(POLICY.maximumRpcWindowMs);
        } else {
          controller.abort('raw-parent-reason');
        }
        await running;

        expect(observedKind).toBe(kind);
        expect(String(reviewBalanceSyncExecutionContext(context)?.signal.reason)).not.toContain(
          'raw-parent-reason',
        );
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('cleans the accepted-job deadline and shutdown listener after dispatch completes', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      let context: BalanceSyncExecutionContext | undefined;
      const configuredDispatcher: BalanceSyncConsumerDispatcherPort = {
        dispatch: async (_job, execution) => {
          context = execution;
        },
      };
      const processOne = jest.fn(
        async (handler: (job: JobEnvelope) => Promise<void>): Promise<JobProcessingResult> => {
          await handler(JOB);
          return { status: 'idle' };
        },
      );
      const wait: BalanceSyncConsumerWait = async () => {
        controller.abort();
      };
      const service = new BalanceSyncConsumerService(
        { processOne },
        configuredDispatcher,
        POLICY,
        wait,
      );

      await service.run(controller.signal);
      await jest.advanceTimersByTimeAsync(POLICY.maximumRpcWindowMs);

      expect(reviewBalanceSyncExecutionContext(context)?.abortKind).toBeNull();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
