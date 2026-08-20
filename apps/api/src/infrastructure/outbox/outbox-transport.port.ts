import type { JobEnvelope } from './job-envelope';

export const OUTBOX_TRANSPORT = Symbol('OUTBOX_TRANSPORT');

export interface OutboxTransportMessage {
  destination: string;
  envelope: JobEnvelope;
  messageAttributes: Readonly<Record<string, string>>;
}

export interface OutboxTransportReceipt {
  transportMessageId?: string;
}

export type OutboxTransportBatchResult =
  { status: 'published'; receipt: OutboxTransportReceipt } | { status: 'failed'; error: unknown };

/** Internal adapter boundary. Domain modules must use JOB_PUBLISHER instead. */
export interface OutboxTransport {
  /** Maximum number of messages accepted by one publishBatch invocation. */
  readonly maxBatchSize?: number;
  /** Implementations must honor abortSignal and stop boundedly when it aborts. */
  publish(
    message: OutboxTransportMessage,
    abortSignal?: AbortSignal,
  ): Promise<OutboxTransportReceipt>;
  /**
   * Results must remain index-aligned with messages. A transport-level request
   * may be accepted while individual entries fail, so callers settle each row
   * independently. Implementations must honor abortSignal and stop boundedly.
   */
  publishBatch?(
    messages: readonly OutboxTransportMessage[],
    abortSignal?: AbortSignal,
  ): Promise<readonly OutboxTransportBatchResult[]>;
}
