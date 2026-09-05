import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
  type MessageAttributeValue,
  type SendMessageBatchRequestEntry,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import { INFRASTRUCTURE_CONFIG } from '../config/infrastructure-config.module';
import type {
  RuntimeInfrastructureConfig,
  SqsInfrastructureConfig,
} from '../config/infrastructure.config';
import { createJobEnvelope, parseJobEnvelope, type JobEnvelope } from '../outbox/job-envelope';
import { MAX_JOB_MESSAGE_BYTES, serializeJobMessage } from '../outbox/job-message-policy';
import { assertReviewedOutboxJob } from '../outbox/reviewed-job-contract-policy';
import type {
  OutboxTransport,
  OutboxTransportBatchResult,
  OutboxTransportMessage,
  OutboxTransportReceipt,
} from '../outbox/outbox-transport.port';
import { SQS_CLIENT } from './sqs.tokens';
import type { ReceivedQueueMessage, SendJobOptions } from './sqs.types';

interface RedrivePolicy {
  deadLetterTargetArn?: string;
  maxReceiveCount?: string | number;
}

interface PreparedBatchEntry {
  bytes: number;
  messageIndex: number;
  queueUrl: string;
  request: SendMessageBatchRequestEntry;
}

const SQS_MAX_BATCH_MESSAGES = 10;
const SQS_APPROXIMATE_RECEIVE_COUNT = /^[1-9][0-9]{0,15}$/u;

interface RequestAbortScope {
  signal: AbortSignal;
  close(): void;
}

function requestAbortScope(
  suppliedSignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestAbortScope {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`SQS request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  timeout.unref();
  const onSuppliedAbort = (): void => controller.abort(suppliedSignal?.reason);
  if (suppliedSignal?.aborted) {
    onSuppliedAbort();
  } else {
    suppliedSignal?.addEventListener('abort', onSuppliedAbort, { once: true });
  }
  return {
    signal: controller.signal,
    close: () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('SQS request scope closed'));
      }
      clearTimeout(timeout);
      suppliedSignal?.removeEventListener('abort', onSuppliedAbort);
    },
  };
}

function sqsMessageAttributes(
  envelope: JobEnvelope,
  customAttributes: Readonly<Record<string, string>>,
): Record<string, MessageAttributeValue> {
  return {
    ...Object.fromEntries(
      Object.entries(customAttributes).map(([name, value]) => [
        name,
        { DataType: 'String', StringValue: value },
      ]),
    ),
    jobKind: { DataType: 'String', StringValue: envelope.kind },
    jobVersion: { DataType: 'Number', StringValue: String(envelope.version) },
    jobId: { DataType: 'String', StringValue: envelope.id },
    correlationId: { DataType: 'String', StringValue: envelope.correlation.correlationId },
  };
}

function packSqsBatchEntries(entries: readonly PreparedBatchEntry[]): PreparedBatchEntry[][] {
  const batches: PreparedBatchEntry[][] = [];
  let batch: PreparedBatchEntry[] = [];
  let batchBytes = 0;

  for (const entry of entries) {
    if (
      batch.length > 0 &&
      (batch.length === SQS_MAX_BATCH_MESSAGES || batchBytes + entry.bytes > MAX_JOB_MESSAGE_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(entry);
    batchBytes += entry.bytes;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

function batchEntryError(code: string | undefined, message: string | undefined): Error {
  const detail = [code, message].filter(Boolean).join(': ');
  return new Error(detail ? `SQS batch entry failed: ${detail}` : 'SQS batch entry failed');
}

function parseApproximateReceiveCount(value: unknown): number {
  if (typeof value !== 'string' || !SQS_APPROXIMATE_RECEIVE_COUNT.test(value)) {
    throw new Error('SQS ApproximateReceiveCount must be a positive safe integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('SQS ApproximateReceiveCount must be a positive safe integer');
  }
  return parsed;
}

@Injectable()
export class SqsService implements OnApplicationShutdown, OutboxTransport {
  readonly maxBatchSize = SQS_MAX_BATCH_MESSAGES;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    @Inject(INFRASTRUCTURE_CONFIG)
    private readonly config: RuntimeInfrastructureConfig,
  ) {}

  async sendJob<Payload>(
    kind: string,
    payload: Payload,
    options: SendJobOptions = {},
  ): Promise<JobEnvelope<Payload>> {
    this.publisherSqsConfig();
    const envelope = createJobEnvelope(kind, payload, {
      id: options.id ?? randomUUID(),
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.correlation === undefined ? {} : { correlation: options.correlation }),
    });
    const serialized = serializeJobMessage(envelope, {});
    const queueUrl = this.queueUrlForEnvelope(envelope, {});

    const request = requestAbortScope(undefined, this.config.sqs.requestTimeoutMs);
    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: serialized.body,
          MessageAttributes: sqsMessageAttributes(envelope, serialized.messageAttributes),
          ...(options.delaySeconds === undefined ? {} : { DelaySeconds: options.delaySeconds }),
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }
    return envelope;
  }

  async publish(
    message: OutboxTransportMessage,
    abortSignal?: AbortSignal,
  ): Promise<OutboxTransportReceipt> {
    this.publisherSqsConfig();
    const queueUrl = this.queueUrlForMessage(message);

    const request = requestAbortScope(abortSignal, this.config.sqs.requestTimeoutMs);
    let response;
    try {
      const serialized = serializeJobMessage(message.envelope, message.messageAttributes);
      response = await this.client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: serialized.body,
          MessageAttributes: sqsMessageAttributes(message.envelope, serialized.messageAttributes),
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }

    return response.MessageId ? { transportMessageId: response.MessageId } : {};
  }

  async publishBatch(
    messages: readonly OutboxTransportMessage[],
    abortSignal?: AbortSignal,
  ): Promise<readonly OutboxTransportBatchResult[]> {
    this.publisherSqsConfig();
    if (messages.length > this.maxBatchSize) {
      throw new Error(`SQS publishBatch accepts at most ${this.maxBatchSize} messages`);
    }

    const results: Array<OutboxTransportBatchResult | undefined> = new Array(messages.length);
    const preparedByQueue = new Map<string, PreparedBatchEntry[]>();
    for (const [messageIndex, message] of messages.entries()) {
      try {
        const queueUrl = this.queueUrlForMessage(message);
        const serialized = serializeJobMessage(message.envelope, message.messageAttributes);
        const entry = {
          bytes: serialized.bytes,
          messageIndex,
          queueUrl,
          request: {
            Id: `entry-${messageIndex}`,
            MessageBody: serialized.body,
            MessageAttributes: sqsMessageAttributes(message.envelope, serialized.messageAttributes),
          },
        } satisfies PreparedBatchEntry;
        const entries = preparedByQueue.get(queueUrl) ?? [];
        entries.push(entry);
        preparedByQueue.set(queueUrl, entries);
      } catch (error) {
        results[messageIndex] = { status: 'failed', error };
      }
    }

    const physicalBatches = [...preparedByQueue.values()].flatMap(packSqsBatchEntries);
    await Promise.all(
      physicalBatches.map(async (batch) => {
        const queueUrl = batch[0]?.queueUrl;
        if (!queueUrl) return;
        const request = requestAbortScope(abortSignal, this.config.sqs.requestTimeoutMs);
        try {
          if (request.signal.aborted) {
            const error = request.signal.reason ?? new Error('SQS batch publication was aborted');
            for (const entry of batch) {
              results[entry.messageIndex] = { status: 'failed', error };
            }
            return;
          }
          let response;
          try {
            response = await this.client.send(
              new SendMessageBatchCommand({
                QueueUrl: queueUrl,
                Entries: batch.map(({ request: entry }) => entry),
              }),
              { abortSignal: request.signal },
            );
          } catch (error) {
            for (const entry of batch) {
              results[entry.messageIndex] = { status: 'failed', error };
            }
            return;
          }

          const successful = new Map((response.Successful ?? []).map((entry) => [entry.Id, entry]));
          const failed = new Map((response.Failed ?? []).map((entry) => [entry.Id, entry]));
          for (const entry of batch) {
            const success = successful.get(entry.request.Id);
            const failure = failed.get(entry.request.Id);
            if (success && !failure) {
              results[entry.messageIndex] = {
                status: 'published',
                receipt: success.MessageId ? { transportMessageId: success.MessageId } : {},
              };
            } else {
              results[entry.messageIndex] = {
                status: 'failed',
                error: failure
                  ? batchEntryError(failure.Code, failure.Message)
                  : new Error('SQS batch response omitted an entry result'),
              };
            }
          }
        } finally {
          request.close();
        }
      }),
    );

    return results.map(
      (result) => result ?? { status: 'failed', error: new Error('SQS batch entry was not sent') },
    );
  }

  async receive(
    queueUrl = this.defaultJobQueueUrl(),
    maxMessages = 1,
    waitTimeSeconds = 10,
    abortSignal?: AbortSignal,
  ): Promise<ReceivedQueueMessage[]> {
    if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 10) {
      throw new Error('SQS maxMessages must be an integer between 1 and 10');
    }
    if (!Number.isSafeInteger(waitTimeSeconds) || waitTimeSeconds < 0 || waitTimeSeconds > 20) {
      throw new Error('SQS waitTimeSeconds must be an integer between 0 and 20');
    }

    // Capture before the network request so heartbeat timing conservatively
    // includes response latency from the moment SQS could hide the message.
    const receivedAtMonotonicMs = performance.now();
    const request = requestAbortScope(
      abortSignal,
      Math.max(this.config.sqs.requestTimeoutMs, waitTimeSeconds * 1_000 + 5_000),
    );
    let response;
    try {
      response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds,
          VisibilityTimeout: this.config.sqs.visibilityTimeoutSeconds,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          MessageAttributeNames: ['All'],
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }
    return (response.Messages ?? []).flatMap((message) => {
      if (!message.MessageId || !message.ReceiptHandle || message.Body === undefined) {
        return [];
      }
      return [
        {
          messageId: message.MessageId,
          receiptHandle: message.ReceiptHandle,
          body: message.Body,
          receiveCount: parseApproximateReceiveCount(message.Attributes?.ApproximateReceiveCount),
          receivedAtMonotonicMs,
        },
      ];
    });
  }

  async delete(
    message: ReceivedQueueMessage,
    queueUrl = this.defaultJobQueueUrl(),
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const request = requestAbortScope(abortSignal, this.config.sqs.requestTimeoutMs);
    try {
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.receiptHandle,
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }
  }

  async changeVisibility(
    message: ReceivedQueueMessage,
    visibilityTimeoutSeconds: number,
    queueUrl = this.defaultJobQueueUrl(),
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(visibilityTimeoutSeconds) ||
      visibilityTimeoutSeconds < 0 ||
      visibilityTimeoutSeconds > 43_200
    ) {
      throw new Error('SQS visibilityTimeoutSeconds must be an integer between 0 and 43200');
    }
    const request = requestAbortScope(abortSignal, this.config.sqs.requestTimeoutMs);
    try {
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.receiptHandle,
          VisibilityTimeout: visibilityTimeoutSeconds,
        }),
        { abortSignal: request.signal },
      );
    } finally {
      request.close();
    }
  }

  parseEnvelope<Payload = unknown>(body: string): JobEnvelope<Payload> {
    return parseJobEnvelope<Payload>(JSON.parse(body) as unknown);
  }

  /** Verifies access to both physically isolated source/DLQ pairs and their redrive policies. */
  async healthCheck(abortSignal?: AbortSignal): Promise<void> {
    const sqs = this.publisherSqsConfig();
    const request = requestAbortScope(abortSignal, this.config.sqs.requestTimeoutMs);
    let source;
    let deadLetter;
    let balanceSource;
    let balanceDeadLetter;
    try {
      [source, deadLetter, balanceSource, balanceDeadLetter] = await Promise.all([
        this.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: sqs.queueUrl,
            AttributeNames: ['QueueArn', 'RedrivePolicy'],
          }),
          { abortSignal: request.signal },
        ),
        this.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: sqs.deadLetterQueueUrl,
            AttributeNames: ['QueueArn'],
          }),
          { abortSignal: request.signal },
        ),
        this.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: sqs.balanceQueueUrl,
            AttributeNames: ['QueueArn', 'RedrivePolicy'],
          }),
          { abortSignal: request.signal },
        ),
        this.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: sqs.balanceDeadLetterQueueUrl,
            AttributeNames: ['QueueArn'],
          }),
          { abortSignal: request.signal },
        ),
      ]);
    } finally {
      request.close();
    }

    const arns = [
      source.Attributes?.QueueArn,
      deadLetter.Attributes?.QueueArn,
      balanceSource.Attributes?.QueueArn,
      balanceDeadLetter.Attributes?.QueueArn,
    ];
    if (arns.some((arn) => !arn) || new Set(arns).size !== 4)
      throw new Error('SQS physical queue identities are missing or not isolated');
    this.assertRedrivePair(source.Attributes?.RedrivePolicy, deadLetter.Attributes?.QueueArn);
    this.assertRedrivePair(
      balanceSource.Attributes?.RedrivePolicy,
      balanceDeadLetter.Attributes?.QueueArn,
    );
  }

  private queueUrlForEnvelope(
    envelope: JobEnvelope,
    messageAttributes: Readonly<Record<string, string>>,
  ): string {
    const sqs = this.publisherSqsConfig();
    if (envelope.kind !== 'blockchain.balance-sync') return sqs.queueUrl;
    assertReviewedOutboxJob({ destination: 'jobs', envelope, messageAttributes });
    if (typeof sqs.balanceQueueUrl !== 'string' || sqs.balanceQueueUrl.length === 0)
      throw new Error('Dedicated balance-sync queue is not configured');
    return sqs.balanceQueueUrl;
  }

  private queueUrlForMessage(message: OutboxTransportMessage): string {
    const sqs = this.publisherSqsConfig();
    assertReviewedOutboxJob(message);
    if (message.envelope.kind !== 'blockchain.balance-sync' || message.envelope.version !== 1)
      return sqs.queueUrl;
    if (typeof sqs.balanceQueueUrl !== 'string' || sqs.balanceQueueUrl.length === 0)
      throw new Error('Dedicated balance-sync queue is not configured');
    return sqs.balanceQueueUrl;
  }

  private publisherSqsConfig(): SqsInfrastructureConfig {
    if (this.config.workload === 'balance-consumer') {
      throw new Error(
        'Balance-consumer SQS receipt transport cannot publish or inspect job queues',
      );
    }
    return this.config.sqs;
  }

  private defaultJobQueueUrl(): string {
    return this.publisherSqsConfig().queueUrl;
  }

  private assertRedrivePair(
    rawPolicy: string | undefined,
    deadLetterArn: string | undefined,
  ): void {
    if (!deadLetterArn || !rawPolicy)
      throw new Error('SQS source queue or dead-letter queue is not configured');
    let policy: RedrivePolicy;
    try {
      policy = JSON.parse(rawPolicy) as RedrivePolicy;
    } catch {
      throw new Error('SQS redrive policy is invalid JSON');
    }
    if (policy.deadLetterTargetArn !== deadLetterArn)
      throw new Error('SQS redrive policy targets the wrong dead-letter queue');
    if (Number(policy.maxReceiveCount) !== this.config.sqs.maxReceiveCount)
      throw new Error('SQS redrive policy maxReceiveCount does not match configuration');
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
