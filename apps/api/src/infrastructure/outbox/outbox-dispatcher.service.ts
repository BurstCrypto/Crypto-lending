import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { JobOutboxRepository, type ClaimedOutboxJob } from './job-outbox.repository';
import {
  OUTBOX_DISPATCHER_OPTIONS,
  type OutboxDispatcherOptions,
} from './outbox-dispatcher.options';
import { OUTBOX_TRANSPORT, type OutboxTransport } from './outbox-transport.port';

export interface OutboxDispatchSummary {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  leaseLost: number;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Outbox transport failed';
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

  /**
   * Performs one bounded dispatch pass. Delivery is at-least-once: a process
   * crash after transport publication but before markPublished can redeliver
   * the same immutable envelope ID, which consumers must use for deduplication.
   */
  async dispatchBatch(): Promise<OutboxDispatchSummary> {
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

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.options.concurrency, jobs.length) },
      async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor];
          cursor += 1;
          if (job) {
            await this.dispatchOne(job, claimToken, summary);
          }
        }
      },
    );
    await Promise.all(workers);
    return summary;
  }

  private async dispatchOne(
    job: ClaimedOutboxJob,
    claimToken: string,
    summary: OutboxDispatchSummary,
  ): Promise<void> {
    try {
      await this.transport.publish({
        destination: job.destination,
        envelope: job.envelope,
        messageAttributes: job.messageAttributes,
      });
    } catch (error) {
      const nextAttempt = job.attempts + 1;
      const terminal = nextAttempt >= this.options.maxAttempts;
      const retryDelayMs = terminal
        ? 0
        : Math.min(this.options.retryBaseDelayMs * 2 ** job.attempts, this.options.retryMaxDelayMs);
      const transition = await this.repository.recordFailure(
        job.id,
        claimToken,
        failureMessage(error),
        { terminal, retryDelayMs },
      );
      if (transition === 'retry') {
        summary.retried += 1;
      } else if (transition === 'failed') {
        summary.failed += 1;
      } else {
        summary.leaseLost += 1;
      }
      return;
    }

    const marked = await this.repository.markPublished(job.id, claimToken);
    if (marked) {
      summary.published += 1;
    } else {
      summary.leaseLost += 1;
    }
  }
}
