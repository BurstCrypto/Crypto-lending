import type { JobEnvelope, JobProcessingResult } from '../../infrastructure/sqs/sqs.types';

export interface BalanceSyncConsumerQueueWorkerPort {
  processOne(handler: (job: JobEnvelope) => Promise<void>): Promise<JobProcessingResult>;
}

export interface BalanceSyncConsumerDispatcherPort {
  dispatch(value: unknown): Promise<void>;
}

export interface BalanceSyncConsumerPolicy {
  readonly idleDelayMs: number;
  readonly dependencyFailureBaseDelayMs: number;
  readonly dependencyFailureMaxDelayMs: number;
}

export type BalanceSyncConsumerWait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export const DEFAULT_BALANCE_SYNC_CONSUMER_POLICY = Object.freeze({
  idleDelayMs: 1_000,
  dependencyFailureBaseDelayMs: 250,
  dependencyFailureMaxDelayMs: 30_000,
}) satisfies BalanceSyncConsumerPolicy;

export type BalanceSyncConsumerErrorCode =
  | 'BALANCE_SYNC_CONSUMER_ALREADY_RUNNING'
  | 'INVALID_BALANCE_SYNC_CONSUMER_POLICY'
  | 'INVALID_BALANCE_SYNC_CONSUMER_SIGNAL';

export class BalanceSyncConsumerError extends Error {
  constructor(readonly code: BalanceSyncConsumerErrorCode) {
    super(code);
    this.name = 'BalanceSyncConsumerError';
    Object.freeze(this);
  }
}

/**
 * Explicit, separately started poll loop. Construction and import are inert;
 * no timers or queue calls occur until `run` is invoked by a future gated CLI.
 */
export class BalanceSyncConsumerService {
  private readonly policy: Readonly<BalanceSyncConsumerPolicy>;
  private running = false;

  constructor(
    private readonly worker: BalanceSyncConsumerQueueWorkerPort,
    private readonly dispatcher: BalanceSyncConsumerDispatcherPort,
    policy: BalanceSyncConsumerPolicy = DEFAULT_BALANCE_SYNC_CONSUMER_POLICY,
    private readonly wait: BalanceSyncConsumerWait = waitForNextPoll,
  ) {
    this.policy = validatePolicy(policy);
  }

  async run(signal: AbortSignal): Promise<void> {
    if (!(signal instanceof AbortSignal)) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_SIGNAL');
    }
    if (this.running) {
      throw new BalanceSyncConsumerError('BALANCE_SYNC_CONSUMER_ALREADY_RUNNING');
    }

    this.running = true;
    let consecutiveFailures = 0;
    try {
      while (!signal.aborted) {
        let result: JobProcessingResult;
        try {
          result = await this.worker.processOne((job) => this.dispatcher.dispatch(job));
        } catch {
          consecutiveFailures += 1;
          await this.waitAfterFailure(consecutiveFailures, signal);
          continue;
        }
        if (signal.aborted) break;

        if (result.status === 'completed') {
          consecutiveFailures = 0;
          continue;
        }
        if (result.status === 'idle') {
          consecutiveFailures = 0;
          await this.wait(this.policy.idleDelayMs, signal);
          continue;
        }

        consecutiveFailures += 1;
        await this.waitAfterFailure(consecutiveFailures, signal);
      }
    } finally {
      this.running = false;
    }
  }

  private async waitAfterFailure(failureCount: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const exponent = Math.min(Math.max(failureCount - 1, 0), 30);
    const delay = Math.min(
      this.policy.dependencyFailureMaxDelayMs,
      this.policy.dependencyFailureBaseDelayMs * 2 ** exponent,
    );
    await this.wait(delay, signal);
  }
}

function validatePolicy(value: BalanceSyncConsumerPolicy): Readonly<BalanceSyncConsumerPolicy> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY');
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [
      'idleDelayMs',
      'dependencyFailureBaseDelayMs',
      'dependencyFailureMaxDelayMs',
    ] as const;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some(
        (key) => typeof key !== 'string' || !expectedKeys.some((expected) => expected === key),
      )
    ) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY');
    }
    const parsed = Object.create(null) as Record<(typeof expectedKeys)[number], number>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !('value' in descriptor) ||
        descriptor.enumerable !== true ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 10 ||
        descriptor.value > 60_000
      ) {
        throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY');
      }
      parsed[key] = descriptor.value as number;
    }
    if (parsed.dependencyFailureBaseDelayMs > parsed.dependencyFailureMaxDelayMs) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY');
    }
    return Object.freeze({
      idleDelayMs: parsed.idleDelayMs,
      dependencyFailureBaseDelayMs: parsed.dependencyFailureBaseDelayMs,
      dependencyFailureMaxDelayMs: parsed.dependencyFailureMaxDelayMs,
    });
  } catch (error) {
    if (error instanceof BalanceSyncConsumerError) throw error;
    throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY');
  }
}

function waitForNextPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) {
      finish();
    }
  });
}
