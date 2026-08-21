import { performance } from 'node:perf_hooks';

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import { loggingContext } from '../../src/infrastructure/logging';
import { SqsJobWorker } from '../../src/infrastructure/sqs/sqs-job.worker';
import { SqsService } from '../../src/infrastructure/sqs/sqs.service';
import { testInfrastructureConfig } from './fixtures';

interface StoredMessage {
  id: string;
  body: string;
  receiveCount: number;
  receiptHandle?: string;
}

class InMemoryRedriveSqs {
  readonly receiveRequests: ReceiveMessageCommand['input'][] = [];
  readonly sentRequests: SendMessageCommand['input'][] = [];
  private readonly source: StoredMessage[] = [];
  private readonly deadLetter: StoredMessage[] = [];
  private nextId = 1;

  constructor(
    private readonly sourceUrl: string,
    private readonly deadLetterUrl: string,
    private readonly maxReceiveCount: number,
  ) {}

  async send(command: unknown): Promise<unknown> {
    if (command instanceof SendMessageCommand) {
      this.sentRequests.push(command.input);
      const body = command.input.MessageBody;
      if (!body) {
        throw new Error('MessageBody is required');
      }
      const id = `message-${this.nextId++}`;
      this.source.push({ id, body, receiveCount: 0 });
      return { MessageId: id };
    }

    if (command instanceof ReceiveMessageCommand) {
      this.receiveRequests.push(command.input);
      const queue = command.input.QueueUrl === this.deadLetterUrl ? this.deadLetter : this.source;

      if (queue === this.source && queue[0]?.receiveCount === this.maxReceiveCount) {
        const exhausted = queue.shift();
        if (exhausted) {
          this.deadLetter.push(exhausted);
        }
        return { Messages: [] };
      }

      const message = queue[0];
      if (!message) {
        return { Messages: [] };
      }
      message.receiveCount += 1;
      message.receiptHandle = `${message.id}-receipt-${message.receiveCount}`;
      return {
        Messages: [
          {
            MessageId: message.id,
            ReceiptHandle: message.receiptHandle,
            Body: message.body,
            Attributes: {
              ApproximateReceiveCount: String(message.receiveCount),
            },
          },
        ],
      };
    }

    if (command instanceof ChangeMessageVisibilityCommand) {
      return {};
    }

    if (command instanceof DeleteMessageCommand) {
      const queue = command.input.QueueUrl === this.deadLetterUrl ? this.deadLetter : this.source;
      const index = queue.findIndex(
        (message) => message.receiptHandle === command.input.ReceiptHandle,
      );
      if (index >= 0) {
        queue.splice(index, 1);
      }
      return {};
    }

    if (command instanceof GetQueueAttributesCommand) {
      const isDeadLetter = command.input.QueueUrl === this.deadLetterUrl;
      const deadLetterArn = 'arn:aws:sqs:us-east-1:000000000000:jobs-dlq';
      return {
        Attributes: isDeadLetter
          ? { QueueArn: deadLetterArn }
          : {
              QueueArn: 'arn:aws:sqs:us-east-1:000000000000:jobs',
              RedrivePolicy: JSON.stringify({
                deadLetterTargetArn: deadLetterArn,
                maxReceiveCount: String(this.maxReceiveCount),
              }),
            },
      };
    }

    throw new Error(`Unsupported test command: ${String(command)}`);
  }

  destroy(): void {}
}

describe('SQS retry and dead-letter flow', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('moves a sample job to the DLQ after the configured failed deliveries', async () => {
    const config = testInfrastructureConfig();
    const transport = new InMemoryRedriveSqs(
      config.sqs.queueUrl,
      config.sqs.deadLetterQueueUrl,
      config.sqs.maxReceiveCount,
    );
    const sqs = new SqsService(transport as unknown as SQSClient, config);
    const worker = new SqsJobWorker(sqs, config);
    const correlation = {
      correlationId: 'corr-sqs-flow',
      requestId: 'request-sqs-flow',
      initiatorActorId: 'actor-sqs-flow',
      intentId: 'intent-sqs-flow',
      quoteId: 'quote-sqs-flow',
      transactionId: 'transaction-sqs-flow',
      ledgerEventId: 'ledger-event-sqs-flow',
    };
    const sample = await sqs.sendJob(
      'sample.always-fails',
      { accountId: 'acct-1' },
      { correlation },
    );
    const observedContexts: unknown[] = [];
    const failingHandler = jest.fn<Promise<void>, [unknown]>().mockImplementation(() => {
      observedContexts.push(loggingContext.current());
      return Promise.reject(new Error('Bearer raw-handler-secret'));
    });

    const firstAttempt = await worker.processOne(failingHandler);
    expect(firstAttempt).toMatchObject({
      status: 'retry-scheduled',
      receiveCount: 1,
      retryDelaySeconds: 1,
      errorCode: 'JOB_HANDLER_FAILED',
    });
    const secondAttempt = await worker.processOne(failingHandler);
    expect(secondAttempt).toMatchObject({
      status: 'retry-scheduled',
      receiveCount: 2,
      retryDelaySeconds: 2,
      errorCode: 'JOB_HANDLER_FAILED',
    });
    const terminalAttempt = await worker.processOne(failingHandler);
    expect(terminalAttempt).toMatchObject({
      status: 'awaiting-dead-letter',
      receiveCount: 3,
      retryDelaySeconds: 0,
      errorCode: 'JOB_HANDLER_FAILED',
    });

    // The next source receive is where SQS evaluates and performs redrive.
    await expect(sqs.receive()).resolves.toEqual([]);
    const deadLetters = await sqs.receive(config.sqs.deadLetterQueueUrl);
    expect(deadLetters).toHaveLength(1);
    expect(sqs.parseEnvelope(deadLetters[0]?.body ?? '').id).toBe(sample.id);
    expect(failingHandler).toHaveBeenCalledTimes(3);
    expect(transport.sentRequests[0]?.MessageAttributes?.correlationId).toEqual({
      DataType: 'String',
      StringValue: correlation.correlationId,
    });
    expect(sqs.parseEnvelope(transport.sentRequests[0]?.MessageBody ?? '').correlation).toEqual(
      correlation,
    );
    expect(observedContexts).toEqual(
      Array.from({ length: 3 }, () => ({ ...correlation, jobId: sample.id })),
    );
    expect(
      JSON.stringify({ observedContexts, firstAttempt, secondAttempt, terminalAttempt }),
    ).not.toContain('raw-handler-secret');
  });

  it('checks both queue URLs and their redrive relationship', async () => {
    const config = testInfrastructureConfig();
    const transport = new InMemoryRedriveSqs(
      config.sqs.queueUrl,
      config.sqs.deadLetterQueueUrl,
      config.sqs.maxReceiveCount,
    );
    const sqs = new SqsService(transport as unknown as SQSClient, config);

    await expect(sqs.healthCheck()).resolves.toBeUndefined();
  });

  it('aborts the unfinished SQS health request when its sibling fails', async () => {
    const config = testInfrastructureConfig();
    let siblingAborted = false;
    const send = jest.fn(
      (command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown> => {
        if (!(command instanceof GetQueueAttributesCommand)) {
          return Promise.reject(new Error('Unexpected SQS command'));
        }
        if (command.input.QueueUrl === config.sqs.queueUrl) {
          return Promise.reject(new Error('source queue unavailable'));
        }
        return new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener(
            'abort',
            () => {
              siblingAborted = true;
              reject(new Error('sibling health request aborted'));
            },
            { once: true },
          );
        });
      },
    );
    const sqs = new SqsService({ send, destroy: jest.fn() } as unknown as SQSClient, config);

    await expect(sqs.healthCheck()).rejects.toThrow('source queue unavailable');
    expect(siblingAborted).toBe(true);
  });

  it('uses bounded long polling by default and validates receive overrides', async () => {
    const config = testInfrastructureConfig();
    const transport = new InMemoryRedriveSqs(
      config.sqs.queueUrl,
      config.sqs.deadLetterQueueUrl,
      config.sqs.maxReceiveCount,
    );
    const sqs = new SqsService(transport as unknown as SQSClient, config);

    await expect(sqs.receive()).resolves.toEqual([]);
    expect(transport.receiveRequests[0]).toMatchObject({
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 10,
    });
    await expect(sqs.receive(config.sqs.queueUrl, 11)).rejects.toThrow('maxMessages');
    await expect(sqs.receive(config.sqs.queueUrl, 1, 21)).rejects.toThrow('waitTimeSeconds');
  });

  it('bounds a stalled receive beyond the configured long-poll margin', async () => {
    jest.useFakeTimers();
    const config = testInfrastructureConfig({ requestTimeoutMs: 1_000 });
    const send = jest.fn(
      (_command: unknown, options?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener(
            'abort',
            () => reject(new Error('receive aborted')),
            { once: true },
          );
        }),
    );
    const sqs = new SqsService({ send, destroy: jest.fn() } as unknown as SQSClient, config);
    const handler = jest.fn().mockResolvedValue(undefined);
    const processing = new SqsJobWorker(sqs, config).processOne(handler);
    const boundedRejection = expect(processing).rejects.toThrow('receive aborted');

    await jest.advanceTimersByTimeAsync(15_000);

    await boundedRejection;
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps the configured SQS deadline when a caller supplies a longer-lived signal', async () => {
    jest.useFakeTimers();
    const config = testInfrastructureConfig({ requestTimeoutMs: 100 });
    const send = jest.fn(
      (_command: unknown, options?: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener(
            'abort',
            () => reject(new Error('publish aborted')),
            { once: true },
          );
        }),
    );
    const sqs = new SqsService({ send, destroy: jest.fn() } as unknown as SQSClient, config);
    const caller = new AbortController();
    const publication = sqs.publish(
      {
        destination: 'jobs',
        envelope: {
          id: 'job-bounded-sqs-request',
          kind: 'sample.publish',
          version: 1,
          occurredAt: '2026-08-20T00:00:00.000Z',
          correlation: { correlationId: 'corr-bounded-sqs-request' },
          payload: {},
        },
        messageAttributes: {},
      },
      caller.signal,
    );
    const boundedRejection = expect(publication).rejects.toThrow('publish aborted');

    await jest.advanceTimersByTimeAsync(100);

    await boundedRejection;
    expect(caller.signal.aborted).toBe(false);
  });

  it('starts the receipt lifetime before the receive request can complete', async () => {
    const config = testInfrastructureConfig();
    let requestObservedAt = Number.POSITIVE_INFINITY;
    const client = {
      send: jest.fn(async (command: unknown) => {
        expect(command).toBeInstanceOf(ReceiveMessageCommand);
        requestObservedAt = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          Messages: [
            {
              MessageId: 'message-delayed-receive',
              ReceiptHandle: 'receipt-delayed-receive',
              Body: '{}',
              Attributes: { ApproximateReceiveCount: '1' },
            },
          ],
        };
      }),
      destroy: jest.fn(),
    };
    const sqs = new SqsService(client as unknown as SQSClient, config);

    const [message] = await sqs.receive();

    expect(message).toBeDefined();
    expect(message?.receivedAtMonotonicMs).toBeLessThanOrEqual(requestObservedAt);
  });

  it('renews immediately when a message arrives after a long poll exceeds its visibility window', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    let monotonicNow = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    const config = testInfrastructureConfig({ visibilityTimeoutSeconds: 5 });
    const send = jest.fn((command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        return new Promise((resolve) =>
          setTimeout(() => {
            monotonicNow = 10_000;
            resolve({
              Messages: [
                {
                  MessageId: 'message-late-long-poll',
                  ReceiptHandle: 'receipt-late-long-poll',
                  Body: JSON.stringify({
                    id: 'job-late-long-poll',
                    kind: 'sample.long',
                    version: 1,
                    occurredAt: '2026-08-20T00:00:00.000Z',
                    payload: {},
                  }),
                  Attributes: { ApproximateReceiveCount: '1' },
                },
              ],
            });
          }, 10_000),
        );
      }
      if (command instanceof ChangeMessageVisibilityCommand) {
        return Promise.resolve({});
      }
      if (command instanceof DeleteMessageCommand) {
        return Promise.resolve({});
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    });
    const sqs = new SqsService({ send, destroy: jest.fn() } as unknown as SQSClient, config);
    const worker = new SqsJobWorker(sqs, config);
    let releaseHandler = (): void => undefined;
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const processing = worker.processOne(async () => handlerBlocked);

    await jest.advanceTimersByTimeAsync(10_000);

    const visibilityRequests = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof ChangeMessageVisibilityCommand);
    expect(visibilityRequests).toHaveLength(1);
    expect(visibilityRequests[0]?.input.VisibilityTimeout).toBe(5);

    releaseHandler();
    await expect(processing).resolves.toMatchObject({ status: 'completed' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('renews visibility halfway through long processing and removes the heartbeat timer', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    const config = testInfrastructureConfig();
    const message = {
      messageId: 'message-long',
      receiptHandle: 'receipt-long',
      body: JSON.stringify({
        id: 'job-long',
        kind: 'sample.long',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    let releaseHandler = (): void => undefined;
    let signalHandlerStarted = (): void => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      signalHandlerStarted = resolve;
    });
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const worker = new SqsJobWorker(sqs, config);
    const processing = worker.processOne(async () => {
      signalHandlerStarted();
      await handlerBlocked;
    });

    await handlerStarted;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(sqs.changeVisibility).toHaveBeenCalledWith(
      message,
      30,
      undefined,
      expect.any(AbortSignal),
    );
    releaseHandler();
    await expect(processing).resolves.toMatchObject({ status: 'completed', jobId: 'job-long' });
    expect(sqs.delete).toHaveBeenCalledWith(message, undefined, expect.anything());
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(sqs.changeVisibility).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('leaves a message undeleted when its visibility heartbeat fails', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    const config = testInfrastructureConfig();
    const message = {
      messageId: 'message-heartbeat-failure',
      receiptHandle: 'receipt-heartbeat-failure',
      body: JSON.stringify({
        id: 'job-heartbeat-failure',
        kind: 'sample.long',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    let releaseHandler = (): void => undefined;
    let signalHandlerStarted = (): void => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      signalHandlerStarted = resolve;
    });
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const changeVisibility = jest
      .fn()
      .mockRejectedValueOnce(new Error('visibility endpoint unavailable'))
      .mockResolvedValueOnce(undefined);
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility,
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const worker = new SqsJobWorker(sqs, config);
    const processing = worker.processOne(async () => {
      signalHandlerStarted();
      await handlerBlocked;
    });

    await handlerStarted;
    await jest.advanceTimersByTimeAsync(15_000);
    releaseHandler();
    await expect(processing).resolves.toMatchObject({
      status: 'retry-scheduled',
      jobId: 'job-heartbeat-failure',
      errorCode: 'SQS_VISIBILITY_HEARTBEAT_FAILED',
    });
    expect(changeVisibility.mock.calls.map(([, seconds]) => seconds)).toEqual([30, 1]);
    expect(sqs.delete).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('subtracts elapsed handling time from the first monotonic heartbeat deadline', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    const config = testInfrastructureConfig();
    const message = {
      messageId: 'message-delayed-start',
      receiptHandle: 'receipt-delayed-start',
      body: JSON.stringify({
        id: 'job-delayed-start',
        kind: 'sample.long',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now() - 8_000,
    };
    let releaseHandler = (): void => undefined;
    let signalHandlerStarted = (): void => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      signalHandlerStarted = resolve;
    });
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const changeVisibility = jest.fn().mockResolvedValue(undefined);
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility,
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const processing = new SqsJobWorker(sqs, config).processOne(async () => {
      signalHandlerStarted();
      await handlerBlocked;
    });

    await handlerStarted;
    jest.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
    await jest.advanceTimersByTimeAsync(5_000);
    expect(changeVisibility).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(changeVisibility.mock.calls[0]?.[1]).toBe(30);
    releaseHandler();
    await expect(processing).resolves.toMatchObject({ status: 'completed' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds a stalled visibility heartbeat request before settling the handler', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    const config = testInfrastructureConfig();
    const message = {
      messageId: 'message-stalled-heartbeat',
      receiptHandle: 'receipt-stalled-heartbeat',
      body: JSON.stringify({
        id: 'job-stalled-heartbeat',
        kind: 'sample.long',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    let releaseHandler = (): void => undefined;
    let signalHandlerStarted = (): void => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      signalHandlerStarted = resolve;
    });
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const changeVisibility = jest
      .fn()
      .mockImplementationOnce(
        (_message, _seconds, _queue, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('heartbeat aborted')), {
              once: true,
            });
          }),
      )
      .mockResolvedValueOnce(undefined);
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility,
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const processing = new SqsJobWorker(sqs, config).processOne(async () => {
      signalHandlerStarted();
      await handlerBlocked;
    });

    await handlerStarted;
    await jest.advanceTimersByTimeAsync(20_000);
    releaseHandler();
    await expect(processing).resolves.toMatchObject({
      status: 'retry-scheduled',
      errorCode: 'SQS_VISIBILITY_HEARTBEAT_FAILED',
    });
    expect(changeVisibility).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('caps visibility renewal at the remaining 12-hour receipt lifetime', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    const config = testInfrastructureConfig({ visibilityTimeoutSeconds: 43_200 });
    const message = {
      messageId: 'message-near-limit',
      receiptHandle: 'receipt-near-limit',
      body: JSON.stringify({
        id: 'job-near-limit',
        kind: 'sample.long',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now() - (12 * 60 * 60 * 1_000 - 20_000),
    };
    let releaseHandler = (): void => undefined;
    let signalHandlerStarted = (): void => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      signalHandlerStarted = resolve;
    });
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const worker = new SqsJobWorker(sqs, config);
    const processing = worker.processOne(async () => {
      signalHandlerStarted();
      await handlerBlocked;
    });

    await handlerStarted;
    await jest.advanceTimersByTimeAsync(1);
    const renewalSeconds = (sqs.changeVisibility as jest.Mock).mock.calls[0]?.[1] as number;
    expect(renewalSeconds).toBeGreaterThan(0);
    expect(renewalSeconds).toBeLessThan(43_200);
    releaseHandler();
    await expect(processing).resolves.toMatchObject({ status: 'completed' });
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('does not delete after the event loop stalls past the visibility deadline', async () => {
    const config = testInfrastructureConfig({ visibilityTimeoutSeconds: 1 });
    const message = {
      messageId: 'message-event-loop-stall',
      receiptHandle: 'receipt-event-loop-stall',
      body: JSON.stringify({
        id: 'job-event-loop-stall',
        kind: 'sample.cpu-bound',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;

    const result = await new SqsJobWorker(sqs, config).processOne(async () => {
      const blockedUntil = performance.now() + 1_100;
      while (performance.now() < blockedUntil) {
        // Deliberately block the event loop to exercise a missed heartbeat.
      }
    });

    expect(result).toMatchObject({
      status: 'ownership-lost',
      errorCode: 'SQS_RECEIPT_OWNERSHIP_EXPIRED',
    });
    expect(sqs.changeVisibility).not.toHaveBeenCalled();
    expect(sqs.delete).not.toHaveBeenCalled();
  });

  it('bounds a stalled delete before the remaining visibility margin is consumed', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    const config = testInfrastructureConfig();
    const message = {
      messageId: 'message-stalled-delete',
      receiptHandle: 'receipt-stalled-delete',
      body: JSON.stringify({
        id: 'job-stalled-delete',
        kind: 'sample.completed',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(
        (_message, _queue, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('delete aborted')), {
              once: true,
            });
          }),
      ),
    } as unknown as SqsService;
    const processing = new SqsJobWorker(sqs, config).processOne(async () => undefined);

    await jest.advanceTimersByTimeAsync(5_000);

    await expect(processing).resolves.toMatchObject({
      status: 'retry-scheduled',
      errorCode: 'SQS_DELETE_FAILED',
    });
    expect(sqs.changeVisibility).toHaveBeenCalledTimes(1);
  });

  it('reports ownership loss without using a receipt beyond the 12-hour window', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-20T00:00:00.000Z') });
    const config = testInfrastructureConfig({ visibilityTimeoutSeconds: 43_200 });
    const message = {
      messageId: 'message-expired-receipt',
      receiptHandle: 'receipt-expired-receipt',
      body: JSON.stringify({
        id: 'job-expired-receipt',
        kind: 'sample.long',
        version: 1,
        occurredAt: '2026-08-20T00:00:00.000Z',
        payload: {},
      }),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now() - (12 * 60 * 60 * 1_000 - 4_000),
    };
    const handler = jest.fn().mockResolvedValue(undefined);
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockImplementation((body: string) => JSON.parse(body)),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const processing = new SqsJobWorker(sqs, config).processOne(handler);

    await jest.advanceTimersByTimeAsync(1);
    await expect(processing).resolves.toMatchObject({
      status: 'ownership-lost',
      errorCode: 'SQS_RECEIPT_OWNERSHIP_EXPIRED',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(sqs.changeVisibility).not.toHaveBeenCalled();
    expect(sqs.delete).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
