import type { JobCorrelationContext } from '../outbox/job-envelope';

export type { JobCorrelationContext, JobEnvelope } from '../outbox/job-envelope';

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
  correlation?: JobCorrelationContext;
}

export type JobProcessingErrorCode =
  | 'JOB_ENVELOPE_INVALID'
  | 'JOB_HANDLER_FAILED'
  | 'JOB_PROCESSING_FAILED'
  | 'SQS_DELETE_FAILED'
  | 'SQS_RECEIPT_OWNERSHIP_EXPIRED'
  | 'SQS_VISIBILITY_HEARTBEAT_FAILED'
  | 'SQS_VISIBILITY_UPDATE_FAILED';

export type JobProcessingResult =
  | { status: 'idle' }
  | { status: 'completed'; messageId: string; jobId: string }
  | {
      status: 'ownership-lost';
      messageId: string;
      jobId?: string;
      receiveCount: number;
      errorCode: JobProcessingErrorCode;
    }
  | {
      status: 'retry-scheduled' | 'awaiting-dead-letter';
      messageId: string;
      jobId?: string;
      receiveCount: number;
      retryDelaySeconds: number;
      errorCode: JobProcessingErrorCode;
    };
