import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { INFRASTRUCTURE_CONFIG } from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import {
  createSafeLegacyCorrelationId,
  createSafeLogReference,
  LOG_EVENTS,
  loggingContext,
  structuredLogger,
  type SafeLogFields,
} from '../logging';
import { SqsService } from './sqs.service';
import type {
  JobEnvelope,
  JobProcessingErrorCode,
  JobProcessingResult,
  ReceivedQueueMessage,
} from './sqs.types';

export type JobHandler<Payload = unknown> = (job: JobEnvelope<Payload>) => Promise<void>;

const MAX_RECEIPT_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const RECEIPT_LIFETIME_SAFETY_MS = 5_000;
const MAX_VISIBILITY_REQUEST_MS = 5_000;

class ReceiptOwnershipExpiredError extends Error {}

class JobProcessingFailure extends Error {
  constructor(readonly code: JobProcessingErrorCode) {
    super(code);
    this.name = 'JobProcessingFailure';
  }
}

function diagnosticJobFields(job: JobEnvelope | undefined): SafeLogFields {
  if (!job) return {};
  const jobId = createSafeLogReference('job', job.id);
  return { ...(jobId ? { jobId } : {}), jobKind: job.kind };
}

function diagnosticMessageField(messageId: string): SafeLogFields {
  const safeMessageId = createSafeLogReference('message', messageId);
  return safeMessageId ? { messageId: safeMessageId } : {};
}

function processingErrorCode(error: unknown): JobProcessingErrorCode {
  try {
    if (error instanceof ReceiptOwnershipExpiredError) {
      return 'SQS_RECEIPT_OWNERSHIP_EXPIRED';
    }
    return error instanceof JobProcessingFailure ? error.code : 'JOB_PROCESSING_FAILED';
  } catch {
    return 'JOB_PROCESSING_FAILED';
  }
}

interface VisibilityHeartbeat {
  ready(): Promise<{ status: 'healthy' } | { status: 'failed'; error: unknown }>;
  stop(): Promise<{ status: 'healthy' } | { status: 'failed'; error: unknown }>;
}

function visibilityRequestTimeoutMs(configuredTimeoutSeconds: number): number {
  return Math.max(
    100,
    Math.min(MAX_VISIBILITY_REQUEST_MS, Math.floor((configuredTimeoutSeconds * 1_000) / 4)),
  );
}

async function changeVisibilityWithDeadline(
  sqs: SqsService,
  message: ReceivedQueueMessage,
  visibilityTimeoutSeconds: number,
  requestTimeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    await sqs.changeVisibility(message, visibilityTimeoutSeconds, undefined, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteWithDeadline(
  sqs: SqsService,
  message: ReceivedQueueMessage,
  requestTimeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    await sqs.delete(message, undefined, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function startVisibilityHeartbeat(
  sqs: SqsService,
  message: ReceivedQueueMessage,
  configuredTimeoutSeconds: number,
): VisibilityHeartbeat {
  const requestTimeoutMs = visibilityRequestTimeoutMs(configuredTimeoutSeconds);
  let failure: { status: 'failed'; error: unknown } | undefined;
  let inFlight = Promise.resolve();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let currentVisibilityStartedAtMs = message.receivedAtMonotonicMs;
  let currentVisibilityTimeoutSeconds = configuredTimeoutSeconds;

  const renew = (
    grantedTimeoutSeconds: number,
    visibilityStartedAtMs: number,
    deadlineKnown: boolean,
  ): void => {
    if (stopped) {
      return;
    }
    inFlight = (async () => {
      try {
        const renewalStartedAtMs = performance.now();
        const currentVisibilityDeadlineMs = visibilityStartedAtMs + grantedTimeoutSeconds * 1_000;
        // The first timestamp predates the ReceiveMessage request. A message
        // may arrive near the end of a long poll, so only a successful renewal
        // gives us an exact local visibility deadline.
        if (deadlineKnown && renewalStartedAtMs + requestTimeoutMs >= currentVisibilityDeadlineMs) {
          throw new ReceiptOwnershipExpiredError(
            'SQS visibility renewal deadline elapsed before the heartbeat could run',
          );
        }
        const elapsedMs = Math.max(0, renewalStartedAtMs - message.receivedAtMonotonicMs);
        const remainingSeconds = Math.floor(
          (MAX_RECEIPT_LIFETIME_MS - RECEIPT_LIFETIME_SAFETY_MS - elapsedMs) / 1_000,
        );
        if (remainingSeconds < 1) {
          throw new ReceiptOwnershipExpiredError(
            'SQS message reached the maximum 12-hour processing window',
          );
        }
        const renewalSeconds = Math.min(configuredTimeoutSeconds, remainingSeconds);
        await changeVisibilityWithDeadline(sqs, message, renewalSeconds, requestTimeoutMs);
        currentVisibilityStartedAtMs = renewalStartedAtMs;
        currentVisibilityTimeoutSeconds = renewalSeconds;
        if (!stopped) {
          schedule(renewalSeconds, renewalStartedAtMs, true);
        }
      } catch (error) {
        failure = { status: 'failed', error };
        stopped = true;
      }
    })();
  };

  const schedule = (
    grantedTimeoutSeconds: number,
    visibilityStartedAtMs: number,
    deadlineKnown: boolean,
  ): void => {
    const elapsedVisibilityMs = Math.max(0, performance.now() - visibilityStartedAtMs);
    const delayMs = Math.floor((grantedTimeoutSeconds * 1_000) / 2 - elapsedVisibilityMs);
    if (delayMs <= 0) {
      renew(grantedTimeoutSeconds, visibilityStartedAtMs, deadlineKnown);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      renew(grantedTimeoutSeconds, visibilityStartedAtMs, deadlineKnown);
    }, delayMs);
  };

  schedule(configuredTimeoutSeconds, message.receivedAtMonotonicMs, false);
  const initialRenewal = inFlight;

  const result = (): { status: 'healthy' } | { status: 'failed'; error: unknown } =>
    failure ?? { status: 'healthy' };

  const validateRemainingOwnership = (): void => {
    const now = performance.now();
    const receiptAgeMs = Math.max(0, now - message.receivedAtMonotonicMs);
    if (receiptAgeMs + RECEIPT_LIFETIME_SAFETY_MS + requestTimeoutMs >= MAX_RECEIPT_LIFETIME_MS) {
      throw new ReceiptOwnershipExpiredError(
        'SQS message reached the maximum 12-hour processing window',
      );
    }
    if (
      now + requestTimeoutMs >=
      currentVisibilityStartedAtMs + currentVisibilityTimeoutSeconds * 1_000
    ) {
      throw new ReceiptOwnershipExpiredError(
        'SQS visibility deadline elapsed before message completion could be confirmed',
      );
    }
  };

  return {
    async ready(): Promise<{ status: 'healthy' } | { status: 'failed'; error: unknown }> {
      await initialRenewal;
      return result();
    },
    async stop(): Promise<{ status: 'healthy' } | { status: 'failed'; error: unknown }> {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await inFlight;
      if (!failure) {
        try {
          validateRemainingOwnership();
        } catch (error) {
          failure = { status: 'failed', error };
        }
      }
      return result();
    },
  };
}

@Injectable()
export class SqsJobWorker {
  constructor(
    private readonly sqs: SqsService,
    @Inject(INFRASTRUCTURE_CONFIG)
    private readonly config: InfrastructureConfig,
  ) {}

  /**
   * Processes at most one message. Failed messages are never deleted: SQS's
   * redrive policy moves them to the DLQ after maxReceiveCount deliveries.
   */
  async processOne<Payload>(handler: JobHandler<Payload>): Promise<JobProcessingResult> {
    const [message] = await this.sqs.receive();
    if (!message) {
      return { status: 'idle' };
    }

    let job: JobEnvelope<Payload>;
    try {
      job = this.sqs.parseEnvelope<Payload>(message.body);
    } catch {
      return loggingContext.run(
        {
          correlationId:
            createSafeLegacyCorrelationId('message', message.messageId) ?? randomUUID(),
        },
        () =>
          this.handleFailure(
            message,
            undefined,
            new JobProcessingFailure('JOB_ENVELOPE_INVALID'),
          ),
      );
    }

    const diagnosticJobId = createSafeLogReference('job', job.id);
    return loggingContext.run(
      { ...job.correlation, ...(diagnosticJobId ? { jobId: diagnosticJobId } : {}) },
      async (): Promise<JobProcessingResult> => {
        try {
          const heartbeat = startVisibilityHeartbeat(
            this.sqs,
            message,
            this.config.sqs.visibilityTimeoutSeconds,
          );
          const heartbeatReady = await heartbeat.ready();
          if (heartbeatReady.status === 'failed') {
            if (heartbeatReady.error instanceof ReceiptOwnershipExpiredError) {
              throw heartbeatReady.error;
            }
            throw new JobProcessingFailure('SQS_VISIBILITY_HEARTBEAT_FAILED');
          }
          let processingFailed = false;
          try {
            await handler(job);
          } catch {
            processingFailed = true;
          }
          const heartbeatResult = await heartbeat.stop();
          if (
            heartbeatResult.status === 'failed' &&
            heartbeatResult.error instanceof ReceiptOwnershipExpiredError
          ) {
            throw heartbeatResult.error;
          }
          if (processingFailed) {
            throw new JobProcessingFailure('JOB_HANDLER_FAILED');
          }
          if (heartbeatResult.status === 'failed') {
            throw new JobProcessingFailure('SQS_VISIBILITY_HEARTBEAT_FAILED');
          }
          try {
            await deleteWithDeadline(
              this.sqs,
              message,
              visibilityRequestTimeoutMs(this.config.sqs.visibilityTimeoutSeconds),
            );
          } catch {
            throw new JobProcessingFailure('SQS_DELETE_FAILED');
          }
          structuredLogger.emit(LOG_EVENTS.jobProcessed, 'info', {
            outcome: 'success',
            ...diagnosticMessageField(message.messageId),
            ...diagnosticJobFields(job),
            receiveCount: message.receiveCount,
          });
          return { status: 'completed', messageId: message.messageId, jobId: job.id };
        } catch (error) {
          return this.handleFailure(message, job, error);
        }
      },
    );
  }

  private async handleFailure(
    message: ReceivedQueueMessage,
    job: JobEnvelope | undefined,
    error: unknown,
  ): Promise<JobProcessingResult> {
    const errorCode = processingErrorCode(error);
    if (error instanceof ReceiptOwnershipExpiredError) {
      structuredLogger.emit(LOG_EVENTS.jobOwnershipLost, 'error', {
        outcome: 'failure',
        errorCode,
        ...diagnosticMessageField(message.messageId),
        ...diagnosticJobFields(job),
        receiveCount: message.receiveCount,
      });
      return {
        status: 'ownership-lost',
        messageId: message.messageId,
        ...(job ? { jobId: job.id } : {}),
        receiveCount: message.receiveCount,
        errorCode,
      };
    }

    const exhausted = message.receiveCount >= this.config.sqs.maxReceiveCount;
    const retryDelaySeconds = exhausted
      ? 0
      : Math.min(
          this.config.sqs.retryBaseDelaySeconds * 2 ** (message.receiveCount - 1),
          this.config.sqs.retryMaxDelaySeconds,
        );

    try {
      await changeVisibilityWithDeadline(
        this.sqs,
        message,
        retryDelaySeconds,
        visibilityRequestTimeoutMs(this.config.sqs.visibilityTimeoutSeconds),
      );
    } catch {
      structuredLogger.emit(LOG_EVENTS.jobOwnershipLost, 'error', {
        outcome: 'failure',
        errorCode: 'SQS_VISIBILITY_UPDATE_FAILED',
        ...diagnosticMessageField(message.messageId),
        ...diagnosticJobFields(job),
        receiveCount: message.receiveCount,
      });
      return {
        status: 'ownership-lost',
        messageId: message.messageId,
        ...(job ? { jobId: job.id } : {}),
        receiveCount: message.receiveCount,
        errorCode: 'SQS_VISIBILITY_UPDATE_FAILED',
      };
    }

    structuredLogger.emit(
      exhausted ? LOG_EVENTS.jobAwaitingDeadLetter : LOG_EVENTS.jobRetryScheduled,
      exhausted ? 'error' : 'warn',
      {
        outcome: exhausted ? 'failure' : 'retry',
        errorCode,
        ...diagnosticMessageField(message.messageId),
        ...diagnosticJobFields(job),
        receiveCount: message.receiveCount,
        retryDelayMs: retryDelaySeconds * 1_000,
      },
    );
    return {
      status: exhausted ? 'awaiting-dead-letter' : 'retry-scheduled',
      messageId: message.messageId,
      ...(job ? { jobId: job.id } : {}),
      receiveCount: message.receiveCount,
      retryDelaySeconds,
      errorCode,
    };
  }
}
