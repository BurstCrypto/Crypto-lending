export type { JobEnvelope } from '../outbox/job-envelope';

export interface ReceivedQueueMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  receiveCount: number;
  /** Conservative monotonic receive-request start used for heartbeat/lifetime bounds. */
  receivedAtMonotonicMs: number;
}

export interface SendJobOptions {
  id?: string;
  version?: number;
  delaySeconds?: number;
}

export type JobProcessingResult =
  | { status: 'idle' }
  | { status: 'completed'; messageId: string; jobId: string }
  | {
      status: 'ownership-lost';
      messageId: string;
      jobId?: string;
      receiveCount: number;
      error: string;
    }
  | {
      status: 'retry-scheduled' | 'awaiting-dead-letter';
      messageId: string;
      jobId?: string;
      receiveCount: number;
      retryDelaySeconds: number;
      error: string;
    };
