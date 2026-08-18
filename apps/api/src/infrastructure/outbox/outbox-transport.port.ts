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

/** Internal adapter boundary. Domain modules must use JOB_PUBLISHER instead. */
export interface OutboxTransport {
  publish(message: OutboxTransportMessage): Promise<OutboxTransportReceipt>;
}
