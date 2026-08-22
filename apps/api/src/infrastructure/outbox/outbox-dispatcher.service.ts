import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { createSafeLogReference, LOG_EVENTS, loggingContext, structuredLogger } from '../logging';
import {
  applicationObservability,
  OBSERVABILITY_PORT,
  type ObservabilityJobErrorClass,
  type ObservabilityPort,
  type ObservabilitySpanHandle,
} from '../observability';
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

function recordDiagnostic(work: () => unknown): void {
  try {
    work();
  } catch {
    // Telemetry must never change outbox delivery or persistence behavior.
  }
}

function runWithDiagnosticSpan<T>(
  span: ObservabilitySpanHandle | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    operationPromise ??= Promise.resolve().then(operation);
    return operationPromise;
  };
  if (span) {
    try {
      // The trusted in-process adapter invokes runOnce synchronously inside its
      // context. We never await the diagnostic runner itself: a faulty adapter
      // cannot skip, repeat, or stall publication.
      void Promise.resolve(span.runAsync(runOnce)).catch(() => undefined);
    } catch {
      // Fall through to the same cached business operation.
    }
  }
  return operationPromise ?? runOnce();
}

function diagnosticJobFields(job: ClaimedOutboxJob): {
  readonly jobId?: string;
  readonly jobKind: string;
} {
  const jobId = createSafeLogReference('job', job.id);
  return { ...(jobId ? { jobId } : {}), jobKind: job.envelope.kind };
}

function diagnosticMessageField(messageId: string | undefined): { readonly messageId?: string } {
  const safeMessageId = createSafeLogReference('message', messageId);
  return safeMessageId ? { messageId: safeMessageId } : {};
}

function failureCode(error: unknown): OutboxFailureCode {
  try {
    return error instanceof OutboxTransportTimeoutError
      ? 'OUTBOX_TRANSPORT_TIMEOUT'
      : 'OUTBOX_TRANSPORT_FAILED';
  } catch {
    return 'OUTBOX_TRANSPORT_FAILED';
  }
}

function observabilityErrorClass(code: OutboxFailureCode): ObservabilityJobErrorClass {
  return code === 'OUTBOX_TRANSPORT_TIMEOUT' ? 'timeout' : 'dependency';
}

@Injectable()
export class OutboxDispatcher {
  private readonly dispatcherInstanceId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private inFlightDispatchers = 0;

  constructor(
    private readonly repository: JobOutboxRepository,
    @Inject(OUTBOX_TRANSPORT) private readonly transport: OutboxTransport,
    @Inject(OUTBOX_DISPATCHER_OPTIONS)
    private readonly options: OutboxDispatcherOptions,
    @Optional()
    @Inject(OBSERVABILITY_PORT)
    private readonly observability: ObservabilityPort = applicationObservability,
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
        this.changeWorkerInFlight(1);
        try {
          while (cursor < batches.length) {
            const batch = batches[cursor];
            cursor += 1;
            if (batch) {
              await this.dispatchMany(batch, claimToken, summary, shutdownSignal);
            }
          }
        } finally {
          this.changeWorkerInFlight(-1);
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

    const spans = jobs.map((job) => this.startPublishSpan(job));
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
      for (const span of spans) this.completePublish(span, 'failure');
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
            this.completePublish(spans[index], 'success');
            await this.markTransportPublished(job, claimToken, summary, results[index].receipt);
          } else {
            this.completePublish(spans[index], 'failure');
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
          this.completePublish(spans[index], 'success');
          await this.markTransportPublished(job, claimToken, summary, result.receipt);
        } else {
          this.completePublish(spans[index], 'failure');
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
    const diagnosticJobId = createSafeLogReference('job', job.id);
    return loggingContext.run(
      { ...job.envelope.correlation, ...(diagnosticJobId ? { jobId: diagnosticJobId } : {}) },
      async (): Promise<void> => {
        if (shutdownSignal?.aborted) {
          summary.leaseLost += 1;
          return;
        }
        const span = this.startPublishSpan(job);
        let receipt: OutboxTransportReceipt;
        try {
          receipt = await runWithDiagnosticSpan(span, () =>
            this.withTransportDeadline(
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
            ),
          );
        } catch (error) {
          this.completePublish(span, 'failure');
          if (shutdownSignal?.aborted) {
            summary.leaseLost += 1;
            return;
          }
          await this.recordTransportFailure(job, claimToken, error, summary);
          return;
        }

        this.completePublish(span, 'success');
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
    const diagnosticJobId = createSafeLogReference('job', job.id);
    return loggingContext.run(
      { ...job.envelope.correlation, ...(diagnosticJobId ? { jobId: diagnosticJobId } : {}) },
      async (): Promise<void> => {
        const marked = await this.repository.markPublished(job.id, claimToken);
        if (marked) {
          summary.published += 1;
          structuredLogger.emit(LOG_EVENTS.jobPublished, 'info', {
            outcome: 'success',
            ...diagnosticJobFields(job),
            ...diagnosticMessageField(receipt.transportMessageId),
          });
        } else {
          summary.leaseLost += 1;
          structuredLogger.emit(LOG_EVENTS.jobPublishFailed, 'warn', {
            outcome: 'failure',
            errorCode: 'OUTBOX_LEASE_LOST',
            ...diagnosticJobFields(job),
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
    const diagnosticJobId = createSafeLogReference('job', job.id);
    return loggingContext.run(
      { ...job.envelope.correlation, ...(diagnosticJobId ? { jobId: diagnosticJobId } : {}) },
      async (): Promise<void> => {
        const code = failureCode(error);
        const nextAttempt = job.attempts + 1;
        const terminal = nextAttempt >= this.options.maxAttempts;
        const retryDelayMs = terminal
          ? 0
          : Math.min(
              this.options.retryBaseDelayMs * 2 ** job.attempts,
              this.options.retryMaxDelayMs,
            );
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
        recordDiagnostic(() =>
          this.observability.recordJobFailure({
            queue: 'outbox',
            disposition:
              transition === 'retry'
                ? 'retry_scheduled'
                : transition === 'failed'
                  ? 'failed'
                  : 'ownership_lost',
            errorClass:
              transition === 'lease-lost' ? 'ownership_lost' : observabilityErrorClass(code),
          }),
        );
        structuredLogger.emit(LOG_EVENTS.jobPublishFailed, terminal ? 'error' : 'warn', {
          outcome: transition === 'retry' ? 'retry' : 'failure',
          errorCode: transition === 'lease-lost' ? 'OUTBOX_LEASE_LOST' : code,
          ...diagnosticJobFields(job),
          retryCount: nextAttempt,
          retryDelayMs,
        });
      },
    );
  }

  private startPublishSpan(job: ClaimedOutboxJob): ObservabilitySpanHandle | undefined {
    const diagnosticJobId = createSafeLogReference('job', job.id);
    return loggingContext.run(
      { ...job.envelope.correlation, ...(diagnosticJobId ? { jobId: diagnosticJobId } : {}) },
      (): ObservabilitySpanHandle | undefined => {
        try {
          return this.observability.startSpan({
            name: 'queue.publish',
            kind: 'producer',
            synthetic: false,
          });
        } catch {
          return undefined;
        }
      },
    );
  }

  private completePublish(
    span: ObservabilitySpanHandle | undefined,
    outcome: 'success' | 'failure',
  ): void {
    recordDiagnostic(() => span?.end(outcome));
    if (outcome === 'success') {
      recordDiagnostic(() =>
        this.observability.recordQueueEvent({ queue: 'outbox', event: 'published' }),
      );
    }
  }

  private changeWorkerInFlight(delta: 1 | -1): void {
    this.inFlightDispatchers = Math.max(0, this.inFlightDispatchers + delta);
    recordDiagnostic(() =>
      this.observability.recordWorkerSaturation({
        worker: 'outbox_dispatcher',
        inFlight: this.inFlightDispatchers,
        capacity: this.options.concurrency,
      }),
    );
  }
}
