import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { LOG_EVENTS, loggingContext, structuredLogger } from '../logging';
import {
  JobOutboxRepository,
  type ClaimedOutboxJob,
  type OutboxFailureCode,
} from './job-outbox.repository';
import {
  OUTBOX_DISPATCHER_OPTIONS,
  type OutboxDispatcherOptions,
} from './outbox-dispatcher.options';
import {
  OUTBOX_TRANSPORT,
  type OutboxTransport,
  type OutboxTransportBatchResult,
  type OutboxTransportReceipt,
} from './outbox-transport.port';

export interface OutboxDispatchSummary {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  leaseLost: number;
}

class OutboxTransportTimeoutError extends Error {}

function failureCode(error: unknown): OutboxFailureCode {
  return error instanceof OutboxTransportTimeoutError
    ? 'OUTBOX_TRANSPORT_TIMEOUT'
    : 'OUTBOX_TRANSPORT_FAILED';
}

@Injectable()
export class OutboxDispatcher {
  private readonly dispatcherInstanceId = `${hostname()}:${process.pid}:${randomUUID()}`;

  constructor(
    private readonly repository: JobOutboxRepository,
    @Inject(OUTBOX_TRANSPORT) private readonly transport: OutboxTransport,
    @Inject(OUTBOX_DISPATCHER_OPTIONS)
    private readonly options: OutboxDispatcherOptions,
  ) {}

  async cleanupExpired(): Promise<number> {
    return this.repository.deleteExpired({
      batchSize: this.options.cleanupBatchSize,
      failedRetentionMs: this.options.failedRetentionMs,
      publishedRetentionMs: this.options.publishedRetentionMs,
    });
  }

  /**
   * Performs one bounded dispatch pass. Delivery is at-least-once: a process
   * crash after transport publication but before markPublished can redeliver
   * the same immutable envelope ID, which consumers must use for deduplication.
   */
  async dispatchBatch(shutdownSignal?: AbortSignal): Promise<OutboxDispatchSummary> {
    if (shutdownSignal?.aborted) {
      return { claimed: 0, published: 0, retried: 0, failed: 0, leaseLost: 0 };
    }

    const claimToken = `${this.dispatcherInstanceId}:${randomUUID()}`;
    const jobs = await this.repository.claimBatch({
      dispatcherId: claimToken,
      batchSize: this.options.batchSize,
      leaseMs: this.options.leaseMs,
      maxAttempts: this.options.maxAttempts,
    });
    const summary: OutboxDispatchSummary = {
      claimed: jobs.length,
      published: 0,
      retried: 0,
      failed: 0,
      leaseLost: 0,
    };

    const transportBatchSize =
      this.transport.publishBatch &&
      Number.isSafeInteger(this.transport.maxBatchSize) &&
      (this.transport.maxBatchSize ?? 0) > 1
        ? (this.transport.maxBatchSize ?? 1)
        : 1;
    const batches: ClaimedOutboxJob[][] = [];
    for (let index = 0; index < jobs.length; index += transportBatchSize) {
      batches.push(jobs.slice(index, index + transportBatchSize));
    }

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.options.concurrency, batches.length) },
      async () => {
        while (cursor < batches.length) {
          const batch = batches[cursor];
          cursor += 1;
          if (batch) {
            await this.dispatchMany(batch, claimToken, summary, shutdownSignal);
          }
        }
      },
    );
    await Promise.all(workers);
    return summary;
  }

  private async dispatchMany(
    jobs: readonly ClaimedOutboxJob[],
    claimToken: string,
    summary: OutboxDispatchSummary,
    shutdownSignal?: AbortSignal,
  ): Promise<void> {
    if (shutdownSignal?.aborted) {
      summary.leaseLost += jobs.length;
      return;
    }
    if (jobs.length === 1 || !this.transport.publishBatch) {
      await Promise.all(
        jobs.map((job) => this.dispatchOne(job, claimToken, summary, shutdownSignal)),
      );
      return;
    }

    let results: readonly OutboxTransportBatchResult[];
    try {
      results = await this.withTransportDeadline(
        (abortSignal) =>
          this.transport.publishBatch!(
            jobs.map((job) => ({
              destination: job.destination,
              envelope: job.envelope,
              messageAttributes: job.messageAttributes,
            })),
            abortSignal,
          ),
        shutdownSignal,
      );
      if (results.length !== jobs.length) {
        throw new Error('Outbox transport returned an invalid batch result count');
      }
    } catch (error) {
      if (shutdownSignal?.aborted) {
        summary.leaseLost += jobs.length;
        return;
      }
      await Promise.all(
        jobs.map((job) => this.recordTransportFailure(job, claimToken, error, summary)),
      );
      return;
    }

    if (shutdownSignal?.aborted) {
      // SQS can accept a batch immediately before shutdown. Persist every
      // confirmed success so those immutable IDs are not needlessly
      // republished after their leases expire. Failed or omitted entries are
      // left untouched for normal lease recovery rather than starting new
      // retry work during shutdown.
      await Promise.all(
        jobs.map(async (job, index) => {
          if (results[index]?.status === 'published') {
            await this.markTransportPublished(job, claimToken, summary, results[index].receipt);
          } else {
            summary.leaseLost += 1;
          }
        }),
      );
      return;
    }
    await Promise.all(
      jobs.map(async (job, index) => {
        const result = results[index];
        if (result?.status === 'published') {
          await this.markTransportPublished(job, claimToken, summary, result.receipt);
        } else {
          await this.recordTransportFailure(
            job,
            claimToken,
            result?.error ?? new Error('Outbox transport omitted a batch result'),
            summary,
          );
        }
      }),
    );
  }

  private async dispatchOne(
    job: ClaimedOutboxJob,
    claimToken: string,
    summary: OutboxDispatchSummary,
    shutdownSignal?: AbortSignal,
  ): Promise<void> {
    return loggingContext.run(
      { ...job.envelope.correlation, jobId: job.id },
      async (): Promise<void> => {
        if (shutdownSignal?.aborted) {
          summary.leaseLost += 1;
          return;
        }
        let receipt: OutboxTransportReceipt;
        try {
          receipt = await this.withTransportDeadline(
            (abortSignal) =>
              this.transport.publish(
                {
                  destination: job.destination,
                  envelope: job.envelope,
                  messageAttributes: job.messageAttributes,
                },
                abortSignal,
              ),
            shutdownSignal,
          );
        } catch (error) {
          if (shutdownSignal?.aborted) {
            summary.leaseLost += 1;
            return;
          }
          await this.recordTransportFailure(job, claimToken, error, summary);
          return;
        }

        await this.markTransportPublished(job, claimToken, summary, receipt);
      },
    );
  }

  private async withTransportDeadline<T>(
    operation: (abortSignal: AbortSignal) => Promise<T>,
    shutdownSignal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutError = new OutboxTransportTimeoutError(
      `Outbox transport timed out after ${this.options.publishTimeoutMs}ms`,
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError);
    }, this.options.publishTimeoutMs);
    timeout.unref();
    const onShutdown = (): void => controller.abort(shutdownSignal?.reason);
    if (shutdownSignal?.aborted) {
      onShutdown();
    } else {
      shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
    }

    try {
      return await operation(controller.signal);
    } catch (error) {
      if (timedOut) {
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      shutdownSignal?.removeEventListener('abort', onShutdown);
    }
  }

  private async markTransportPublished(
    job: ClaimedOutboxJob,
    claimToken: string,
    summary: OutboxDispatchSummary,
    receipt: OutboxTransportReceipt = {},
  ): Promise<void> {
    return loggingContext.run(
      { ...job.envelope.correlation, jobId: job.id },
      async (): Promise<void> => {
        const marked = await this.repository.markPublished(job.id, claimToken);
        if (marked) {
          summary.published += 1;
          structuredLogger.emit(LOG_EVENTS.jobPublished, 'info', {
            outcome: 'success',
            jobId: job.id,
            jobKind: job.envelope.kind,
            ...(receipt.transportMessageId ? { messageId: receipt.transportMessageId } : {}),
          });
        } else {
          summary.leaseLost += 1;
          structuredLogger.emit(LOG_EVENTS.jobPublishFailed, 'warn', {
            outcome: 'failure',
            errorCode: 'OUTBOX_LEASE_LOST',
            jobId: job.id,
            jobKind: job.envelope.kind,
          });
        }
      },
    );
  }

  private async recordTransportFailure(
    job: ClaimedOutboxJob,
    claimToken: string,
    error: unknown,
    summary: OutboxDispatchSummary,
  ): Promise<void> {
    return loggingContext.run(
      { ...job.envelope.correlation, jobId: job.id },
      async (): Promise<void> => {
        const nextAttempt = job.attempts + 1;
        const terminal = nextAttempt >= this.options.maxAttempts;
        const retryDelayMs = terminal
          ? 0
          : Math.min(
              this.options.retryBaseDelayMs * 2 ** job.attempts,
              this.options.retryMaxDelayMs,
            );
        const code = failureCode(error);
        const transition = await this.repository.recordFailure(job.id, claimToken, code, {
          terminal,
          retryDelayMs,
        });
        if (transition === 'retry') {
          summary.retried += 1;
        } else if (transition === 'failed') {
          summary.failed += 1;
        } else {
          summary.leaseLost += 1;
        }
        structuredLogger.emit(LOG_EVENTS.jobPublishFailed, terminal ? 'error' : 'warn', {
          outcome: transition === 'retry' ? 'retry' : 'failure',
          errorCode: transition === 'lease-lost' ? 'OUTBOX_LEASE_LOST' : code,
          jobId: job.id,
          jobKind: job.envelope.kind,
          retryCount: nextAttempt,
          retryDelayMs,
        });
      },
    );
  }
}
