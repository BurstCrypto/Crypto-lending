import { performance } from 'node:perf_hooks';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { LOG_EVENTS, structuredLogger } from '../logging';
import {
  OUTBOX_DISPATCHER_OPTIONS,
  type OutboxDispatcherOptions,
} from './outbox-dispatcher.options';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { PostgresJobQueueConsumer } from './postgres-job-queue-consumer.service';

function waitForNextPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    function onAbort(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function validateOutboxPollIntervalMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 60_000) {
    throw new Error('Outbox pollIntervalMs must be between 10 and 60000');
  }
  return value;
}

/**
 * Explicit entrypoint for a separately deployed outbox worker process. Importing
 * InfrastructureModule into an API replica does not start this polling loop.
 */
@Injectable()
export class OutboxWorker {
  private running = false;
  private static readonly MAX_CONSECUTIVE_DISPATCH_FAILURES = 5;

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    @Inject(OUTBOX_DISPATCHER_OPTIONS)
    private readonly options: OutboxDispatcherOptions,
    @Optional() private readonly postgresQueue?: PostgresJobQueueConsumer,
  ) {}

  async run(signal: AbortSignal, pollIntervalMs = 1_000): Promise<void> {
    if (this.running) {
      throw new Error('Outbox worker is already running');
    }
    pollIntervalMs = validateOutboxPollIntervalMs(pollIntervalMs);

    this.running = true;
    let nextCleanupAt = 0;
    let dispatchFailureReported = false;
    let consecutiveDispatchFailures = 0;
    let cleanupFailureReported = false;
    try {
      while (!signal.aborted) {
        let cleanupBacklog = false;
        let claimedWork = false;
        try {
          const summary = await this.dispatcher.dispatchBatch(signal);
          if (this.postgresQueue) {
            await this.postgresQueue.processBatch();
          }
          dispatchFailureReported = false;
          consecutiveDispatchFailures = 0;
          claimedWork = summary.claimed > 0;
          if (claimedWork) {
            structuredLogger.emit(LOG_EVENTS.outboxDispatchCompleted, 'info', {
              outcome: 'success',
              ...summary,
            });
          }
        } catch {
          consecutiveDispatchFailures += 1;
          if (!dispatchFailureReported) {
            structuredLogger.emit(LOG_EVENTS.outboxDispatchFailed, 'error', {
              outcome: 'failure',
              errorCode: 'OUTBOX_DISPATCH_PASS_FAILED',
            });
            dispatchFailureReported = true;
          }
          if (consecutiveDispatchFailures >= OutboxWorker.MAX_CONSECUTIVE_DISPATCH_FAILURES) {
            throw new Error('Outbox worker exceeded its consecutive dispatch failure limit');
          }
        }
        if (signal.aborted) {
          break;
        }

        if (performance.now() >= nextCleanupAt) {
          try {
            const deleted = await this.dispatcher.cleanupExpired();
            if (this.postgresQueue) {
              await this.postgresQueue.cleanupExpired();
            }
            cleanupFailureReported = false;
            cleanupBacklog = deleted >= this.options.cleanupBatchSize;
            if (deleted > 0) {
              structuredLogger.emit(LOG_EVENTS.outboxCleanupCompleted, 'info', {
                outcome: 'success',
                deleted,
              });
            }
            nextCleanupAt = cleanupBacklog
              ? performance.now()
              : performance.now() + this.options.cleanupIntervalMs;
          } catch {
            if (!cleanupFailureReported) {
              structuredLogger.emit(LOG_EVENTS.outboxCleanupFailed, 'error', {
                outcome: 'failure',
                errorCode: 'OUTBOX_CLEANUP_FAILED',
              });
              cleanupFailureReported = true;
            }
            nextCleanupAt = performance.now() + this.options.cleanupIntervalMs;
          }
        }
        if (signal.aborted) {
          break;
        }
        if (claimedWork || cleanupBacklog) {
          continue;
        }
        await waitForNextPoll(pollIntervalMs, signal);
      }
    } finally {
      this.running = false;
    }
  }
}
