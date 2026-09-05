import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { balanceSyncReceiptRetryMinimumDelaySeconds } from '../../blockchain-sync/application/fail-closed-balance-sync-job.port';
import {
  createSafeLegacyCorrelationId,
  createSafeLogReference,
  LOG_EVENTS,
  loggingContext,
  structuredLogger,
  type SafeLogFields,
} from '../logging';
import {
  applicationObservability,
  type ObservabilityJobErrorClass,
  type ObservabilityPort,
} from '../observability';
import type { PinnedSqsQueueReceiptPort } from './sqs-queue-receipt.port';
import type {
  JobEnvelope,
  JobProcessingErrorCode,
  JobProcessingResult,
  ReceivedQueueMessage,
} from './sqs.types';

export type JobHandler<Payload = unknown> = (job: JobEnvelope<Payload>) => Promise<void>;
export type SqsWorkerQueue = 'jobs' | 'balance';

export interface SqsJobWorkerPolicy {
  readonly maxReceiveCount: number;
  readonly visibilityTimeoutSeconds: number;
  readonly retryBaseDelaySeconds: number;
  readonly retryMaxDelaySeconds: number;
}

export function createSqsJobWorkerPolicy(policy: SqsJobWorkerPolicy): SqsJobWorkerPolicy {
  return Object.freeze({
    maxReceiveCount: policy.maxReceiveCount,
    visibilityTimeoutSeconds: policy.visibilityTimeoutSeconds,
    retryBaseDelaySeconds: policy.retryBaseDelaySeconds,
    retryMaxDelaySeconds: policy.retryMaxDelaySeconds,
  });
}

const MAX_RECEIPT_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const RECEIPT_LIFETIME_SAFETY_MS = 5_000;
const MAX_VISIBILITY_REQUEST_MS = 5_000;

class ReceiptOwnershipExpiredError extends Error {}

class JobProcessingFailure extends Error {
  constructor(
    readonly code: JobProcessingErrorCode,
    readonly receiptRetryMinimumDelaySeconds?: number,
  ) {
    super(code);
    this.name = 'JobProcessingFailure';
  }
}

function isReceiptOwnershipExpired(error: unknown): boolean {
  try {
    return error instanceof ReceiptOwnershipExpiredError;
  } catch {
    return false;
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
    if (isReceiptOwnershipExpired(error)) {
      return 'SQS_RECEIPT_OWNERSHIP_EXPIRED';
    }
    return error instanceof JobProcessingFailure ? error.code : 'JOB_PROCESSING_FAILED';
  } catch {
    return 'JOB_PROCESSING_FAILED';
  }
}

function observabilityErrorClass(code: JobProcessingErrorCode): ObservabilityJobErrorClass {
  switch (code) {
    case 'JOB_ENVELOPE_INVALID':
      return 'validation';
    case 'SQS_RECEIPT_OWNERSHIP_EXPIRED':
      return 'ownership_lost';
    case 'SQS_DELETE_FAILED':
    case 'SQS_VISIBILITY_HEARTBEAT_FAILED':
    case 'SQS_VISIBILITY_UPDATE_FAILED':
      return 'dependency';
    case 'JOB_HANDLER_FAILED':
    case 'JOB_PROCESSING_FAILED':
      return 'internal';
  }
}

function recordDiagnostic(work: () => unknown): void {
  try {
    work();
  } catch {
    // Telemetry adapters must never change queue or handler behavior.
  }
}

function runWithDiagnosticSpan<T>(
  span: { runAsync(work: () => Promise<T>): Promise<T> } | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    operationPromise ??= Promise.resolve().then(operation);
    return operationPromise;
  };
  if (span) {
    try {
      void Promise.resolve(span.runAsync(runOnce)).catch(() => undefined);
    } catch {
      // Fall through to the same cached business operation.
    }
  }
  return operationPromise ?? runOnce();
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
  sqs: PinnedSqsQueueReceiptPort,
  message: ReceivedQueueMessage,
  visibilityTimeoutSeconds: number,
  requestTimeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    await sqs.changeVisibility(message, visibilityTimeoutSeconds, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteWithDeadline(
  sqs: PinnedSqsQueueReceiptPort,
  message: ReceivedQueueMessage,
  requestTimeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    await sqs.delete(message, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function startVisibilityHeartbeat(
  sqs: PinnedSqsQueueReceiptPort,
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
  private inFlightJobs = 0;
  private readonly queue: SqsWorkerQueue;
  private readonly policy: Readonly<SqsJobWorkerPolicy>;

  constructor(
    private readonly sqs: PinnedSqsQueueReceiptPort,
    policy: SqsJobWorkerPolicy,
    private readonly observability: ObservabilityPort = applicationObservability,
    queue: SqsWorkerQueue = 'jobs',
  ) {
    if (queue !== 'jobs' && queue !== 'balance')
      throw new Error('Invalid SQS worker queue binding');
    this.queue = queue;
    this.policy = createSqsJobWorkerPolicy(policy);
  }

  /**
   * Processes at most one message. Failed messages are never deleted: SQS's
   * redrive policy moves them to the DLQ after maxReceiveCount deliveries.
   * Cancellation applies only while receiving; once processing starts, the
   * existing visibility and acknowledgement lifecycle runs to completion.
   */
  async processOne<Payload>(
    handler: JobHandler<Payload>,
    abortSignal?: AbortSignal,
  ): Promise<JobProcessingResult> {
    if (abortSignal?.aborted) {
      return { status: 'idle' };
    }

    let messages: ReceivedQueueMessage[];
    try {
      messages =
        abortSignal === undefined
          ? await this.sqs.receive()
          : await this.sqs.receive(1, 10, abortSignal);
    } catch (error) {
      if (abortSignal?.aborted) {
        return { status: 'idle' };
      }
      throw error;
    }

    const [message] = messages;
    if (abortSignal?.aborted || !message) {
      return { status: 'idle' };
    }

    this.inFlightJobs += 1;
    recordDiagnostic(() =>
      this.observability.recordWorkerSaturation({
        worker: 'job_consumer',
        inFlight: this.inFlightJobs,
      }),
    );
    recordDiagnostic(() =>
      this.observability.recordQueueEvent({ queue: this.queue, event: 'received' }),
    );

    try {
      return await this.processReceivedMessage(message, handler);
    } finally {
      this.inFlightJobs = Math.max(0, this.inFlightJobs - 1);
      recordDiagnostic(() =>
        this.observability.recordWorkerSaturation({
          worker: 'job_consumer',
          inFlight: this.inFlightJobs,
        }),
      );
    }
  }

  private async processReceivedMessage<Payload>(
    message: ReceivedQueueMessage,
    handler: JobHandler<Payload>,
  ): Promise<JobProcessingResult> {
    let job: JobEnvelope<Payload>;
    try {
      job = this.sqs.parseEnvelope<Payload>(message.body);
      if (
        (this.queue === 'jobs' && job.kind === 'blockchain.balance-sync') ||
        (this.queue === 'balance' && (job.kind !== 'blockchain.balance-sync' || job.version !== 1))
      ) {
        throw new JobProcessingFailure('JOB_ENVELOPE_INVALID');
      }
    } catch {
      return loggingContext.run(
        {
          correlationId:
            createSafeLegacyCorrelationId('message', message.messageId) ?? randomUUID(),
        },
        () =>
          this.handleFailure(message, undefined, new JobProcessingFailure('JOB_ENVELOPE_INVALID')),
      );
    }

    const diagnosticJobId = createSafeLogReference('job', job.id);
    return loggingContext.run(
      { ...job.correlation, ...(diagnosticJobId ? { jobId: diagnosticJobId } : {}) },
      async (): Promise<JobProcessingResult> => {
        let span;
        try {
          span = this.observability.startSpan({
            name: 'queue.process',
            kind: 'consumer',
            synthetic: false,
          });
        } catch {
          span = undefined;
        }
        const process = async (): Promise<JobProcessingResult> => {
          try {
            const heartbeat = startVisibilityHeartbeat(
              this.sqs,
              message,
              this.policy.visibilityTimeoutSeconds,
            );
            const heartbeatReady = await heartbeat.ready();
            if (heartbeatReady.status === 'failed') {
              if (isReceiptOwnershipExpired(heartbeatReady.error)) {
                throw heartbeatReady.error;
              }
              throw new JobProcessingFailure('SQS_VISIBILITY_HEARTBEAT_FAILED');
            }
            let handlerFailure: JobProcessingFailure | undefined;
            try {
              await handler(job);
            } catch (error) {
              handlerFailure = new JobProcessingFailure(
                'JOB_HANDLER_FAILED',
                this.queue === 'balance'
                  ? balanceSyncReceiptRetryMinimumDelaySeconds(error)
                  : undefined,
              );
            }
            const heartbeatResult = await heartbeat.stop();
            if (
              heartbeatResult.status === 'failed' &&
              isReceiptOwnershipExpired(heartbeatResult.error)
            ) {
              throw heartbeatResult.error;
            }
            if (handlerFailure) throw handlerFailure;
            if (heartbeatResult.status === 'failed') {
              throw new JobProcessingFailure('SQS_VISIBILITY_HEARTBEAT_FAILED');
            }
            try {
              await deleteWithDeadline(
                this.sqs,
                message,
                visibilityRequestTimeoutMs(this.policy.visibilityTimeoutSeconds),
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
            recordDiagnostic(() =>
              this.observability.recordQueueEvent({ queue: this.queue, event: 'completed' }),
            );
            return { status: 'completed', messageId: message.messageId, jobId: job.id };
          } catch (error) {
            return this.handleFailure(message, job, error);
          }
        };

        try {
          const result = await runWithDiagnosticSpan<JobProcessingResult>(span, process);
          recordDiagnostic(() => span?.end(result.status === 'completed' ? 'success' : 'failure'));
          return result;
        } catch (error) {
          recordDiagnostic(() => span?.end('failure'));
          throw error;
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
    if (isReceiptOwnershipExpired(error)) {
      recordDiagnostic(() =>
        this.observability.recordJobFailure({
          queue: this.queue,
          disposition: 'ownership_lost',
          errorClass: observabilityErrorClass(errorCode),
        }),
      );
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

    const exhausted = message.receiveCount >= this.policy.maxReceiveCount;
    const trustedMinimumDelaySeconds =
      error instanceof JobProcessingFailure ? error.receiptRetryMinimumDelaySeconds : undefined;
    const nativeRetryDelaySeconds = Math.min(
      this.policy.retryBaseDelaySeconds * 2 ** (message.receiveCount - 1),
      this.policy.retryMaxDelaySeconds,
    );
    const retryDelaySeconds = exhausted
      ? 0
      : Math.min(
          this.policy.retryMaxDelaySeconds,
          Math.max(nativeRetryDelaySeconds, trustedMinimumDelaySeconds ?? 0),
        );

    try {
      await changeVisibilityWithDeadline(
        this.sqs,
        message,
        retryDelaySeconds,
        visibilityRequestTimeoutMs(this.policy.visibilityTimeoutSeconds),
      );
    } catch {
      recordDiagnostic(() =>
        this.observability.recordJobFailure({
          queue: this.queue,
          disposition: 'ownership_lost',
          errorClass: 'dependency',
        }),
      );
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

    recordDiagnostic(() =>
      this.observability.recordJobFailure({
        queue: this.queue,
        disposition: exhausted ? 'awaiting_dead_letter' : 'retry_scheduled',
        errorClass: observabilityErrorClass(errorCode),
      }),
    );
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
