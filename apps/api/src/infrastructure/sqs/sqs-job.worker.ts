import { performance } from 'node:perf_hooks';

import { Inject, Injectable } from '@nestjs/common';

import { INFRASTRUCTURE_CONFIG } from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { SqsService } from './sqs.service';
import type { JobEnvelope, JobProcessingResult, ReceivedQueueMessage } from './sqs.types';

export type JobHandler<Payload = unknown> = (job: JobEnvelope<Payload>) => Promise<void>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Job handler failed';
}

const MAX_RECEIPT_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const RECEIPT_LIFETIME_SAFETY_MS = 5_000;
const MAX_VISIBILITY_REQUEST_MS = 5_000;

class ReceiptOwnershipExpiredError extends Error {}

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

    let job: JobEnvelope<Payload> | undefined;
    try {
      job = this.sqs.parseEnvelope<Payload>(message.body);
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
        throw new Error('SQS visibility heartbeat failed', { cause: heartbeatReady.error });
      }
      let processingError: unknown;
      let processingFailed = false;
      try {
        await handler(job);
      } catch (error) {
        processingFailed = true;
        processingError = error;
      }
      const heartbeatResult = await heartbeat.stop();
      if (
        heartbeatResult.status === 'failed' &&
        heartbeatResult.error instanceof ReceiptOwnershipExpiredError
      ) {
        throw heartbeatResult.error;
      }
      if (processingFailed) {
        throw processingError;
      }
      if (heartbeatResult.status === 'failed') {
        throw new Error('SQS visibility heartbeat failed', { cause: heartbeatResult.error });
      }
      await deleteWithDeadline(
        this.sqs,
        message,
        visibilityRequestTimeoutMs(this.config.sqs.visibilityTimeoutSeconds),
      );
      return { status: 'completed', messageId: message.messageId, jobId: job.id };
    } catch (error) {
      if (error instanceof ReceiptOwnershipExpiredError) {
        return {
          status: 'ownership-lost',
          messageId: message.messageId,
          ...(job ? { jobId: job.id } : {}),
          receiveCount: message.receiveCount,
          error: errorMessage(error),
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
      } catch (visibilityError) {
        return {
          status: 'ownership-lost',
          messageId: message.messageId,
          ...(job ? { jobId: job.id } : {}),
          receiveCount: message.receiveCount,
          error: `${errorMessage(error)}; visibility update failed: ${errorMessage(visibilityError)}`,
        };
      }
      return {
        status: exhausted ? 'awaiting-dead-letter' : 'retry-scheduled',
        messageId: message.messageId,
        ...(job ? { jobId: job.id } : {}),
        receiveCount: message.receiveCount,
        retryDelaySeconds,
        error: errorMessage(error),
      };
    }
  }
}
