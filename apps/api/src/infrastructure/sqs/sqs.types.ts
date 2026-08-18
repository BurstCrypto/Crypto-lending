export type { JobEnvelope } from '../outbox/job-envelope';

export interface ReceivedQueueMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  receiveCount: number;
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
      status: 'retry-scheduled' | 'awaiting-dead-letter';
      messageId: string;
      jobId?: string;
      receiveCount: number;
      retryDelaySeconds: number;
      error: string;
    };
