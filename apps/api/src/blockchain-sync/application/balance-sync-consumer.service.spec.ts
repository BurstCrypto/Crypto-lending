import type { JobEnvelope, JobProcessingResult } from '../../infrastructure/sqs/sqs.types';
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
    const processOne = jest.fn(async (handler: (job: JobEnvelope) => Promise<void>) => {
      await handler(JOB);
      controller.abort();
      return {
        status: 'completed',
        messageId: 'message-1',
        jobId: JOB.id,
      } satisfies JobProcessingResult;
    });
    const service = new BalanceSyncConsumerService({ processOne }, configuredDispatcher, POLICY);

    expect(processOne).not.toHaveBeenCalled();
    expect(configuredDispatcher.dispatch).not.toHaveBeenCalled();
    await service.run(controller.signal);

    expect(processOne).toHaveBeenCalledTimes(1);
    expect(configuredDispatcher.dispatch).toHaveBeenCalledWith(JOB);
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
  });
});
