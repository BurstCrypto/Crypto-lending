import { randomUUID } from 'node:crypto';

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import { INFRASTRUCTURE_CONFIG } from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { createJobEnvelope, parseJobEnvelope, type JobEnvelope } from '../outbox/job-envelope';
import type {
  OutboxTransport,
  OutboxTransportMessage,
  OutboxTransportReceipt,
} from '../outbox/outbox-transport.port';
import { SQS_CLIENT } from './sqs.tokens';
import type { ReceivedQueueMessage, SendJobOptions } from './sqs.types';

interface RedrivePolicy {
  deadLetterTargetArn?: string;
  maxReceiveCount?: string | number;
}

@Injectable()
export class SqsService implements OnApplicationShutdown, OutboxTransport {
  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(INFRASTRUCTURE_CONFIG)
    private readonly config: InfrastructureConfig,
  ) {}

  async sendJob<Payload>(
    kind: string,
    payload: Payload,
    options: SendJobOptions = {},
  ): Promise<JobEnvelope<Payload>> {
    const envelope = createJobEnvelope(kind, payload, {
      id: options.id ?? randomUUID(),
      ...(options.version === undefined ? {} : { version: options.version }),
    });

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.config.sqs.queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageAttributes: {
          jobKind: { DataType: 'String', StringValue: kind },
          jobVersion: {
            DataType: 'Number',
            StringValue: String(envelope.version),
          },
        },
        ...(options.delaySeconds === undefined ? {} : { DelaySeconds: options.delaySeconds }),
      }),
    );
    return envelope;
  }

  async publish(message: OutboxTransportMessage): Promise<OutboxTransportReceipt> {
    if (message.destination !== 'jobs') {
      throw new Error(`Unsupported SQS job destination: ${message.destination}`);
    }

    const customAttributes = Object.fromEntries(
      Object.entries(message.messageAttributes).map(([name, value]) => [
        name,
        { DataType: 'String', StringValue: value },
      ]),
    );
    const response = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.config.sqs.queueUrl,
        MessageBody: JSON.stringify(message.envelope),
        MessageAttributes: {
          ...customAttributes,
          jobKind: {
            DataType: 'String',
            StringValue: message.envelope.kind,
          },
          jobVersion: {
            DataType: 'Number',
            StringValue: String(message.envelope.version),
          },
          jobId: { DataType: 'String', StringValue: message.envelope.id },
        },
      }),
    );

    return response.MessageId ? { transportMessageId: response.MessageId } : {};
  }

  async receive(
    queueUrl = this.config.sqs.queueUrl,
    maxMessages = 1,
    waitTimeSeconds = 0,
  ): Promise<ReceivedQueueMessage[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds,
        VisibilityTimeout: this.config.sqs.visibilityTimeoutSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: ['All'],
      }),
    );

    return (response.Messages ?? []).flatMap((message) => {
      if (!message.MessageId || !message.ReceiptHandle || message.Body === undefined) {
        return [];
      }
      return [
        {
          messageId: message.MessageId,
          receiptHandle: message.ReceiptHandle,
          body: message.Body,
          receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? '1'),
        },
      ];
    });
  }

  async delete(message: ReceivedQueueMessage, queueUrl = this.config.sqs.queueUrl): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.receiptHandle,
      }),
    );
  }

  async changeVisibility(
    message: ReceivedQueueMessage,
    visibilityTimeoutSeconds: number,
    queueUrl = this.config.sqs.queueUrl,
  ): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.receiptHandle,
        VisibilityTimeout: visibilityTimeoutSeconds,
      }),
    );
  }

  parseEnvelope<Payload = unknown>(body: string): JobEnvelope<Payload> {
    return parseJobEnvelope<Payload>(JSON.parse(body) as unknown);
  }

  /** Verifies access to both queues and validates the source redrive policy. */
  async healthCheck(): Promise<void> {
    const [source, deadLetter] = await Promise.all([
      this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.config.sqs.queueUrl,
          AttributeNames: ['QueueArn', 'RedrivePolicy'],
        }),
      ),
      this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.config.sqs.deadLetterQueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      ),
    ]);

    const deadLetterArn = deadLetter.Attributes?.QueueArn;
    const rawPolicy = source.Attributes?.RedrivePolicy;
    if (!deadLetterArn || !rawPolicy) {
      throw new Error('SQS source queue or dead-letter queue is not configured');
    }

    let policy: RedrivePolicy;
    try {
      policy = JSON.parse(rawPolicy) as RedrivePolicy;
    } catch {
      throw new Error('SQS redrive policy is invalid JSON');
    }

    if (policy.deadLetterTargetArn !== deadLetterArn) {
      throw new Error('SQS redrive policy targets the wrong dead-letter queue');
    }
    if (Number(policy.maxReceiveCount) !== this.config.sqs.maxReceiveCount) {
      throw new Error('SQS redrive policy maxReceiveCount does not match configuration');
    }
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
