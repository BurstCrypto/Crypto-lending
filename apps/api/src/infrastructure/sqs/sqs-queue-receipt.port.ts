import type { JobEnvelope } from '../outbox/job-envelope';
import type { ReceivedQueueMessage } from './sqs.types';

/**
 * Narrow view of the transport required to bind one physical source queue.
 * Publication methods are deliberately absent from this capability.
 */
export interface SqsQueueReceiptTransport {
  receive(
    queueUrl: string,
    maxMessages?: number,
    waitTimeSeconds?: number,
    abortSignal?: AbortSignal,
  ): Promise<ReceivedQueueMessage[]>;
  delete(message: ReceivedQueueMessage, queueUrl: string, abortSignal?: AbortSignal): Promise<void>;
  changeVisibility(
    message: ReceivedQueueMessage,
    visibilityTimeoutSeconds: number,
    queueUrl: string,
    abortSignal?: AbortSignal,
  ): Promise<void>;
  parseEnvelope<Payload = unknown>(body: string): JobEnvelope<Payload>;
}

/** Receipt capability for exactly one source queue selected at construction. */
export interface PinnedSqsQueueReceiptPort {
  receive(
    maxMessages?: number,
    waitTimeSeconds?: number,
    abortSignal?: AbortSignal,
  ): Promise<ReceivedQueueMessage[]>;
  delete(message: ReceivedQueueMessage, abortSignal?: AbortSignal): Promise<void>;
  changeVisibility(
    message: ReceivedQueueMessage,
    visibilityTimeoutSeconds: number,
    abortSignal?: AbortSignal,
  ): Promise<void>;
  parseEnvelope<Payload = unknown>(body: string): JobEnvelope<Payload>;
}

export class PinnedSqsQueueReceiptAdapter implements PinnedSqsQueueReceiptPort {
  readonly #transport: SqsQueueReceiptTransport;
  readonly #queueUrl: string;

  constructor(transport: SqsQueueReceiptTransport, queueUrl: string) {
    if (!transport || typeof transport !== 'object') {
      throw new TypeError('SQS receipt transport is required');
    }
    if (typeof queueUrl !== 'string' || !queueUrl || queueUrl.trim() !== queueUrl) {
      throw new TypeError('Pinned SQS source queue URL is invalid');
    }
    this.#transport = transport;
    this.#queueUrl = queueUrl;
    Object.freeze(this);
  }

  receive(
    maxMessages?: number,
    waitTimeSeconds?: number,
    abortSignal?: AbortSignal,
  ): Promise<ReceivedQueueMessage[]> {
    if (maxMessages === undefined && waitTimeSeconds === undefined && abortSignal === undefined) {
      return this.#transport.receive(this.#queueUrl);
    }
    return this.#transport.receive(
      this.#queueUrl,
      maxMessages ?? 1,
      waitTimeSeconds ?? 10,
      abortSignal,
    );
  }

  delete(message: ReceivedQueueMessage, abortSignal?: AbortSignal): Promise<void> {
    return this.#transport.delete(message, this.#queueUrl, abortSignal);
  }

  changeVisibility(
    message: ReceivedQueueMessage,
    visibilityTimeoutSeconds: number,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return this.#transport.changeVisibility(
      message,
      visibilityTimeoutSeconds,
      this.#queueUrl,
      abortSignal,
    );
  }

  parseEnvelope<Payload = unknown>(body: string): JobEnvelope<Payload> {
    return this.#transport.parseEnvelope<Payload>(body);
  }
}
