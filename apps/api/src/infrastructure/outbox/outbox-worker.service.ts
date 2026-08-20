import { performance } from 'node:perf_hooks';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  OUTBOX_DISPATCHER_OPTIONS,
  type OutboxDispatcherOptions,
} from './outbox-dispatcher.options';
import { OutboxDispatcher } from './outbox-dispatcher.service';

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

/**
 * Explicit entrypoint for a separately deployed outbox worker process. Importing
 * InfrastructureModule into an API replica does not start this polling loop.
 */
@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private running = false;

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    @Inject(OUTBOX_DISPATCHER_OPTIONS)
    private readonly options: OutboxDispatcherOptions,
  ) {}

  async run(signal: AbortSignal, pollIntervalMs = 1_000): Promise<void> {
    if (this.running) {
      throw new Error('Outbox worker is already running');
    }
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 60_000) {
      throw new Error('Outbox pollIntervalMs must be between 10 and 60000');
    }

    this.running = true;
    let nextCleanupAt = 0;
    try {
      while (!signal.aborted) {
        let cleanupBacklog = false;
        let claimedWork = false;
        try {
          const summary = await this.dispatcher.dispatchBatch(signal);
          claimedWork = summary.claimed > 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
          this.logger.error(`Outbox dispatch pass failed: ${message}`);
        }
        if (signal.aborted) {
          break;
        }

        if (performance.now() >= nextCleanupAt) {
          try {
            const deleted = await this.dispatcher.cleanupExpired();
            cleanupBacklog = deleted >= this.options.cleanupBatchSize;
            nextCleanupAt = cleanupBacklog
              ? performance.now()
              : performance.now() + this.options.cleanupIntervalMs;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown error';
            this.logger.error(`Outbox retention cleanup failed: ${message}`);
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
