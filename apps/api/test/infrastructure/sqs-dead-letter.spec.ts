import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

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
  it('moves a sample job to the DLQ after the configured failed deliveries', async () => {
    const config = testInfrastructureConfig();
    const transport = new InMemoryRedriveSqs(
      config.sqs.queueUrl,
      config.sqs.deadLetterQueueUrl,
      config.sqs.maxReceiveCount,
    );
    const sqs = new SqsService(transport as unknown as SQSClient, config);
    const worker = new SqsJobWorker(sqs, config);
    const sample = await sqs.sendJob('sample.always-fails', { accountId: 'acct-1' });
    const failingHandler = jest
      .fn<Promise<void>, [unknown]>()
      .mockRejectedValue(new Error('sample failure'));

    await expect(worker.processOne(failingHandler)).resolves.toMatchObject({
      status: 'retry-scheduled',
      receiveCount: 1,
      retryDelaySeconds: 1,
    });
    await expect(worker.processOne(failingHandler)).resolves.toMatchObject({
      status: 'retry-scheduled',
      receiveCount: 2,
      retryDelaySeconds: 2,
    });
    await expect(worker.processOne(failingHandler)).resolves.toMatchObject({
      status: 'awaiting-dead-letter',
      receiveCount: 3,
      retryDelaySeconds: 0,
    });

    // The next source receive is where SQS evaluates and performs redrive.
    await expect(sqs.receive()).resolves.toEqual([]);
    const deadLetters = await sqs.receive(config.sqs.deadLetterQueueUrl);
    expect(deadLetters).toHaveLength(1);
    expect(sqs.parseEnvelope(deadLetters[0]?.body ?? '').id).toBe(sample.id);
    expect(failingHandler).toHaveBeenCalledTimes(3);
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
});
