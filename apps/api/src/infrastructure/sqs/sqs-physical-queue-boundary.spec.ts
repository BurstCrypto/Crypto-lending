import { performance } from 'node:perf_hooks';

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import type { InfrastructureConfig } from '../config/infrastructure.config';
import { createJobEnvelope, type JobEnvelope } from '../outbox/job-envelope';
import type { OutboxTransportMessage } from '../outbox/outbox-transport.port';
import { SqsJobWorker } from './sqs-job.worker';
import { SqsService } from './sqs.service';

const UUIDS = Object.freeze({
  job: '00000000-0000-4000-8000-000000000001',
  operation: '00000000-0000-4000-8000-000000000002',
  ledger: '00000000-0000-4000-8000-000000000003',
  plan: '00000000-0000-4000-8000-000000000004',
  quote: '00000000-0000-4000-8000-000000000005',
  account: '00000000-0000-4000-8000-000000000006',
  wallet: '00000000-0000-4000-8000-000000000007',
  correlation: '00000000-0000-4000-8000-000000000008',
  journal: '00000000-0000-4000-8000-000000000009',
  command: '00000000-0000-4000-8000-000000000010',
});

function config(overrides: Partial<InfrastructureConfig['sqs']> = {}): InfrastructureConfig {
  return {
    workload: 'worker',
    database: {
      connectionString: 'postgresql://unused',
      connectionTimeoutMs: 100,
      idleTimeoutMs: 100,
      lockTimeoutMs: 100,
      maxLifetimeSeconds: 100,
      poolMax: 1,
      statementTimeoutMs: 100,
      ssl: false,
    },
    sqs: {
      region: 'us-east-1',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs',
      deadLetterQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs-dlq',
      balanceQueueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync',
      balanceDeadLetterQueueUrl:
        'https://sqs.us-east-1.amazonaws.com/000000000000/balance-sync-dlq',
      requestTimeoutMs: 1_000,
      sdkMaxAttempts: 1,
      maxReceiveCount: 3,
      visibilityTimeoutSeconds: 30,
      retryBaseDelaySeconds: 1,
      retryMaxDelaySeconds: 60,
      ...overrides,
    },
  };
}

function yieldMessage(index = 0): OutboxTransportMessage {
  const id = index === 0 ? UUIDS.job : `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const envelope = createJobEnvelope(
    'yield.operation.submit',
    {
      submissionId: id,
      operationId: UUIDS.operation,
      operationType: 'ALLOCATE',
      ledgerTransactionId: UUIDS.ledger,
      planReferenceId: UUIDS.plan,
      quoteReferenceId: UUIDS.quote,
    },
    {
      id,
      occurredAt: '2026-09-04T12:00:00.000Z',
      correlation: {
        correlationId: UUIDS.correlation,
        transactionId: UUIDS.ledger,
        quoteId: UUIDS.quote,
      },
    },
  );
  return { destination: 'jobs', envelope, messageAttributes: { operationType: 'ALLOCATE' } };
}

function balanceMessage(index = 10): OutboxTransportMessage {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const envelope = createJobEnvelope(
    'blockchain.balance-sync',
    {
      schemaVersion: 1,
      accountId: UUIDS.account,
      walletId: UUIDS.wallet,
      networkId: 'eip155:1',
      requiredTier: 'CANONICAL',
      cause: 'SCHEDULED',
      attempt: 1,
      rescanFromPosition: null,
    },
    {
      id,
      occurredAt: '2026-09-04T12:00:00.000Z',
      correlation: { correlationId: UUIDS.correlation },
    },
  );
  return { destination: 'jobs', envelope, messageAttributes: {} };
}

function ledgerMessage(): OutboxTransportMessage {
  const envelope = createJobEnvelope(
    'ledger.journal-committed',
    { journalId: UUIDS.journal, operation: 'POST_JOURNAL' },
    {
      id: UUIDS.job,
      occurredAt: '2026-09-04T12:00:00.000Z',
      correlation: { correlationId: UUIDS.correlation, ledgerEventId: UUIDS.journal },
    },
  );
  return {
    destination: 'jobs',
    envelope,
    messageAttributes: {},
    ledgerLink: { commandId: UUIDS.command, journalId: UUIDS.journal },
  };
}

describe('dedicated balance-sync physical SQS boundary', () => {
  it('routes only the exact reviewed balance contract away from the jobs queue', async () => {
    const current = config();
    const sends: string[] = [];
    const client = {
      send: jest.fn((command: unknown) => {
        expect(command).toBeInstanceOf(SendMessageCommand);
        sends.push((command as SendMessageCommand).input.QueueUrl ?? '');
        return Promise.resolve({ MessageId: `message-${sends.length}` });
      }),
      destroy: jest.fn(),
    };
    const service = new SqsService(client as unknown as SQSClient, current);

    await service.publish(ledgerMessage());
    await service.publish(yieldMessage());
    await service.publish(balanceMessage());

    expect(sends).toEqual([
      current.sqs.queueUrl,
      current.sqs.queueUrl,
      current.sqs.balanceQueueUrl,
    ]);
    await expect(
      service.publish({
        ...balanceMessage(),
        envelope: { ...balanceMessage().envelope, version: 2 },
      }),
    ).rejects.toThrow('UNREVIEWED_JOB_CONTRACT');
    const ledger = ledgerMessage();
    await expect(
      service.publish({
        destination: ledger.destination,
        envelope: ledger.envelope,
        messageAttributes: ledger.messageAttributes,
      }),
    ).rejects.toThrow('INVALID_REVIEWED_JOB_LEDGER_LINK');
    expect(sends).toHaveLength(3);
  });

  it('fails balance publication closed when its dedicated source URL is missing', async () => {
    const current = config({ balanceQueueUrl: undefined as unknown as string });
    const send = jest.fn().mockResolvedValue({ MessageId: 'jobs-message' });
    const service = new SqsService({ send, destroy: jest.fn() } as unknown as SQSClient, current);

    await expect(service.publish(balanceMessage())).rejects.toThrow(
      'Dedicated balance-sync queue is not configured',
    );
    expect(send).not.toHaveBeenCalled();
    await expect(service.publish(yieldMessage())).resolves.toEqual({
      transportMessageId: 'jobs-message',
    });
  });

  it('groups mixed batches physically, preserves result order, and isolates group failures', async () => {
    const current = config();
    const seen: Array<{ queueUrl: string; ids: string[]; signal: AbortSignal | undefined }> = [];
    const client = {
      send: jest.fn(
        (command: unknown, options?: Readonly<{ abortSignal?: AbortSignal }>): Promise<unknown> => {
          expect(command).toBeInstanceOf(SendMessageBatchCommand);
          const batch = command as SendMessageBatchCommand;
          const queueUrl = batch.input.QueueUrl ?? '';
          const ids = (batch.input.Entries ?? []).map(({ Id }) => Id ?? '');
          seen.push({ queueUrl, ids, signal: options?.abortSignal });
          if (queueUrl === current.sqs.balanceQueueUrl) {
            return Promise.reject(new Error('balance source unavailable'));
          }
          return Promise.resolve({
            Successful: ids.map((Id) => ({ Id, MessageId: `sent-${Id}` })),
            Failed: [],
          });
        },
      ),
      destroy: jest.fn(),
    };
    const service = new SqsService(client as unknown as SQSClient, current);

    const result = await service.publishBatch([
      balanceMessage(10),
      yieldMessage(11),
      balanceMessage(12),
      yieldMessage(13),
    ]);

    expect(seen.map(({ queueUrl }) => queueUrl).sort()).toEqual(
      [current.sqs.balanceQueueUrl, current.sqs.queueUrl].sort(),
    );
    expect(seen[0]?.signal).not.toBe(seen[1]?.signal);
    expect(result.map(({ status }) => status)).toEqual([
      'failed',
      'published',
      'failed',
      'published',
    ]);
    expect((result[0] as { error: Error }).error.message).toBe('balance source unavailable');
  });

  it('verifies both isolated source/DLQ redrive pairs and rejects a cross-wired pair', async () => {
    const current = config();
    const arnByUrl = new Map([
      [current.sqs.queueUrl, 'arn:aws:sqs:us-east-1:000000000000:jobs'],
      [current.sqs.deadLetterQueueUrl, 'arn:aws:sqs:us-east-1:000000000000:jobs-dlq'],
      [current.sqs.balanceQueueUrl, 'arn:aws:sqs:us-east-1:000000000000:balance-sync'],
      [
        current.sqs.balanceDeadLetterQueueUrl,
        'arn:aws:sqs:us-east-1:000000000000:balance-sync-dlq',
      ],
    ]);
    let crossWireBalance = false;
    const client = {
      send: jest.fn((command: unknown): Promise<unknown> => {
        expect(command).toBeInstanceOf(GetQueueAttributesCommand);
        const queueUrl = (command as GetQueueAttributesCommand).input.QueueUrl ?? '';
        const queueArn = arnByUrl.get(queueUrl);
        const isSource =
          queueUrl === current.sqs.queueUrl || queueUrl === current.sqs.balanceQueueUrl;
        const expectedDlqUrl =
          queueUrl === current.sqs.balanceQueueUrl
            ? current.sqs.balanceDeadLetterQueueUrl
            : current.sqs.deadLetterQueueUrl;
        return Promise.resolve({
          Attributes: {
            QueueArn: queueArn,
            ...(isSource
              ? {
                  RedrivePolicy: JSON.stringify({
                    deadLetterTargetArn:
                      crossWireBalance && queueUrl === current.sqs.balanceQueueUrl
                        ? arnByUrl.get(current.sqs.deadLetterQueueUrl)
                        : arnByUrl.get(expectedDlqUrl),
                    maxReceiveCount: '3',
                  }),
                }
              : {}),
          },
        });
      }),
      destroy: jest.fn(),
    };
    const service = new SqsService(client as unknown as SQSClient, current);

    await expect(service.healthCheck()).resolves.toBeUndefined();
    crossWireBalance = true;
    await expect(service.healthCheck()).rejects.toThrow(
      'SQS redrive policy targets the wrong dead-letter queue',
    );
  });

  it('binds receive, retry visibility, deletion, and metrics to the selected queue', async () => {
    const current = config();
    const envelope = balanceMessage().envelope as JobEnvelope;
    const message = {
      messageId: 'message-balance',
      receiptHandle: 'receipt-balance',
      body: JSON.stringify(envelope),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockReturnValue(envelope),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const handler = jest.fn().mockResolvedValue(undefined);

    const result = await new SqsJobWorker(sqs, current, undefined, 'balance').processOne(handler);

    expect(result).toMatchObject({ status: 'completed', jobId: envelope.id });
    expect(sqs.receive).toHaveBeenCalledWith(current.sqs.balanceQueueUrl);
    expect(sqs.delete).toHaveBeenCalledWith(
      message,
      current.sqs.balanceQueueUrl,
      expect.any(AbortSignal),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation to a balance long poll and drops a message when abort wins the race', async () => {
    const current = config();
    const controller = new AbortController();
    const envelope = balanceMessage().envelope as JobEnvelope;
    const message = {
      messageId: 'message-cancelled-balance',
      receiptHandle: 'receipt-cancelled-balance',
      body: JSON.stringify(envelope),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    let resolveReceive: ((messages: (typeof message)[]) => void) | undefined;
    const sqs = {
      receive: jest.fn(
        () =>
          new Promise<(typeof message)[]>((resolve) => {
            resolveReceive = resolve;
          }),
      ),
      parseEnvelope: jest.fn().mockReturnValue(envelope),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const handler = jest.fn().mockResolvedValue(undefined);
    const processing = new SqsJobWorker(sqs, current, undefined, 'balance').processOne(
      handler,
      controller.signal,
    );

    expect(sqs.receive).toHaveBeenCalledWith(current.sqs.balanceQueueUrl, 1, 10, controller.signal);
    controller.abort();
    resolveReceive?.([message]);

    await expect(processing).resolves.toEqual({ status: 'idle' });
    expect(sqs.parseEnvelope).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(sqs.changeVisibility).not.toHaveBeenCalled();
    expect(sqs.delete).not.toHaveBeenCalled();
  });

  it('treats an aborted balance long-poll rejection as an idle shutdown', async () => {
    const current = config();
    const controller = new AbortController();
    const sqs = {
      receive: jest.fn(
        (
          _queueUrl: string,
          _maxMessages: number,
          _waitTimeSeconds: number,
          abortSignal: AbortSignal,
        ) =>
          new Promise<never>((_resolve, reject) => {
            abortSignal.addEventListener('abort', () => reject(new Error('receive aborted')), {
              once: true,
            });
          }),
      ),
      parseEnvelope: jest.fn(),
      changeVisibility: jest.fn(),
      delete: jest.fn(),
    } as unknown as SqsService;
    const handler = jest.fn().mockResolvedValue(undefined);
    const processing = new SqsJobWorker(sqs, current, undefined, 'balance').processOne(
      handler,
      controller.signal,
    );

    controller.abort();

    await expect(processing).resolves.toEqual({ status: 'idle' });
    expect(handler).not.toHaveBeenCalled();
    expect(sqs.changeVisibility).not.toHaveBeenCalled();
    expect(sqs.delete).not.toHaveBeenCalled();
  });

  it('preserves acknowledgement after a received balance job becomes in flight', async () => {
    const current = config();
    const controller = new AbortController();
    const envelope = balanceMessage().envelope as JobEnvelope;
    const message = {
      messageId: 'message-in-flight-balance',
      receiptHandle: 'receipt-in-flight-balance',
      body: JSON.stringify(envelope),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockReturnValue(envelope),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const handler = jest.fn(async () => controller.abort());

    await expect(
      new SqsJobWorker(sqs, current, undefined, 'balance').processOne(handler, controller.signal),
    ).resolves.toMatchObject({ status: 'completed', jobId: envelope.id });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sqs.delete).toHaveBeenCalledWith(
      message,
      current.sqs.balanceQueueUrl,
      expect.any(AbortSignal),
    );
  });

  it('accepts an exact raw balance envelope with a positive receive count before deletion', async () => {
    const current = config();
    const envelope = balanceMessage().envelope as JobEnvelope;
    const commands: unknown[] = [];
    const client = {
      send: jest.fn((command: unknown): Promise<unknown> => {
        commands.push(command);
        if (command instanceof ReceiveMessageCommand) {
          return Promise.resolve({
            Messages: [
              {
                MessageId: 'message-exact-raw',
                ReceiptHandle: 'receipt-exact-raw',
                Body: JSON.stringify(envelope),
                Attributes: { ApproximateReceiveCount: '2' },
              },
            ],
          });
        }
        if (
          command instanceof ChangeMessageVisibilityCommand ||
          command instanceof DeleteMessageCommand
        ) {
          return Promise.resolve({});
        }
        return Promise.reject(new Error('Unexpected SQS command'));
      }),
      destroy: jest.fn(),
    };
    const handler = jest.fn().mockResolvedValue(undefined);

    const result = await new SqsJobWorker(
      new SqsService(client as unknown as SQSClient, current),
      current,
      undefined,
      'balance',
    ).processOne(handler);

    expect(result).toMatchObject({ status: 'completed', jobId: envelope.id });
    expect(handler).toHaveBeenCalledWith(envelope);
    expect(commands.some((command) => command instanceof DeleteMessageCommand)).toBe(true);
  });

  it('rejects an extra raw envelope key before handler invocation or deletion', async () => {
    const current = config();
    const envelope = balanceMessage().envelope as JobEnvelope;
    const commands: unknown[] = [];
    const client = {
      send: jest.fn((command: unknown): Promise<unknown> => {
        commands.push(command);
        if (command instanceof ReceiveMessageCommand) {
          return Promise.resolve({
            Messages: [
              {
                MessageId: 'message-extra-raw-key',
                ReceiptHandle: 'receipt-extra-raw-key',
                Body: JSON.stringify({ ...envelope, authorization: 'must-not-pass' }),
                Attributes: { ApproximateReceiveCount: '1' },
              },
            ],
          });
        }
        if (command instanceof ChangeMessageVisibilityCommand) return Promise.resolve({});
        if (command instanceof DeleteMessageCommand) return Promise.resolve({});
        return Promise.reject(new Error('Unexpected SQS command'));
      }),
      destroy: jest.fn(),
    };
    const handler = jest.fn().mockResolvedValue(undefined);

    const result = await new SqsJobWorker(
      new SqsService(client as unknown as SQSClient, current),
      current,
      undefined,
      'balance',
    ).processOne(handler);

    expect(result).toMatchObject({
      status: 'retry-scheduled',
      errorCode: 'JOB_ENVELOPE_INVALID',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(commands.some((command) => command instanceof ChangeMessageVisibilityCommand)).toBe(
      true,
    );
    expect(commands.some((command) => command instanceof DeleteMessageCommand)).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['zero', '0'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['non-canonical', '01'],
    ['unsafe', '9007199254740992'],
  ] as const)(
    'rejects %s ApproximateReceiveCount before handler invocation or deletion',
    async (_name, rawReceiveCount) => {
      const current = config();
      const envelope = balanceMessage().envelope as JobEnvelope;
      const commands: unknown[] = [];
      const client = {
        send: jest.fn((command: unknown): Promise<unknown> => {
          commands.push(command);
          if (command instanceof ReceiveMessageCommand) {
            return Promise.resolve({
              Messages: [
                {
                  MessageId: 'message-invalid-receive-count',
                  ReceiptHandle: 'receipt-invalid-receive-count',
                  Body: JSON.stringify(envelope),
                  ...(rawReceiveCount === undefined
                    ? {}
                    : { Attributes: { ApproximateReceiveCount: rawReceiveCount } }),
                },
              ],
            });
          }
          return Promise.resolve({});
        }),
        destroy: jest.fn(),
      };
      const handler = jest.fn().mockResolvedValue(undefined);

      await expect(
        new SqsJobWorker(
          new SqsService(client as unknown as SQSClient, current),
          current,
          undefined,
          'balance',
        ).processOne(handler),
      ).rejects.toThrow('SQS ApproximateReceiveCount must be a positive safe integer');

      expect(handler).not.toHaveBeenCalled();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toBeInstanceOf(ReceiveMessageCommand);
      expect(commands.some((command) => command instanceof DeleteMessageCommand)).toBe(false);
    },
  );

  it('prevents cross-queue handler invocation and keeps retry visibility on the selected queue', async () => {
    const current = config();
    const envelope = yieldMessage().envelope;
    const message = {
      messageId: 'message-wrong-queue',
      receiptHandle: 'receipt-wrong-queue',
      body: JSON.stringify(envelope),
      receiveCount: 1,
      receivedAtMonotonicMs: performance.now(),
    };
    const sqs = {
      receive: jest.fn().mockResolvedValue([message]),
      parseEnvelope: jest.fn().mockReturnValue(envelope),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const handler = jest.fn().mockResolvedValue(undefined);

    const result = await new SqsJobWorker(sqs, current, undefined, 'balance').processOne(handler);

    expect(result).toMatchObject({ status: 'retry-scheduled', errorCode: 'JOB_ENVELOPE_INVALID' });
    expect(handler).not.toHaveBeenCalled();
    expect(sqs.changeVisibility).toHaveBeenCalledWith(
      message,
      1,
      current.sqs.balanceQueueUrl,
      expect.any(AbortSignal),
    );
    expect(sqs.delete).not.toHaveBeenCalled();
  });

  it('does not use a generic worker to consume a balance job', async () => {
    const current = config();
    const envelope = balanceMessage().envelope;
    const sqs = {
      receive: jest.fn().mockResolvedValue([
        {
          messageId: 'message-cross-queue',
          receiptHandle: 'receipt-cross-queue',
          body: JSON.stringify(envelope),
          receiveCount: 1,
          receivedAtMonotonicMs: performance.now(),
        },
      ]),
      parseEnvelope: jest.fn().mockReturnValue(envelope),
      changeVisibility: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const handler = jest.fn().mockResolvedValue(undefined);

    await expect(new SqsJobWorker(sqs, current).processOne(handler)).resolves.toMatchObject({
      status: 'retry-scheduled',
      errorCode: 'JOB_ENVELOPE_INVALID',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(sqs.receive).toHaveBeenCalledWith(current.sqs.queueUrl);
  });
});
