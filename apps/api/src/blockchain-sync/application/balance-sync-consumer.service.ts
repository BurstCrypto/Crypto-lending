import type { JobEnvelope, JobProcessingResult } from '../../infrastructure/sqs/sqs.types';
import {
  createBalanceSyncExecutionContext,
  reviewBalanceSyncExecutionContext,
  type BalanceSyncExecutionContext,
} from './ports/balance-sync.ports';

export interface BalanceSyncConsumerQueueWorkerPort {
  processOne(
    handler: (job: JobEnvelope) => Promise<void>,
    abortSignal: AbortSignal,
  ): Promise<JobProcessingResult>;
}

export interface BalanceSyncConsumerDispatcherPort {
  dispatch(value: unknown, context: BalanceSyncExecutionContext): Promise<void>;
}

export interface BalanceSyncConsumerPolicy {
  readonly idleDelayMs: number;
  readonly dependencyFailureBaseDelayMs: number;
  readonly dependencyFailureMaxDelayMs: number;
  /** Propagates one deadline through resolution, RPC, and checkpoint persistence. */
  readonly jobTimeoutMs: number;
}

export type BalanceSyncConsumerWait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export const DEFAULT_BALANCE_SYNC_CONSUMER_POLICY = Object.freeze({
  idleDelayMs: 1_000,
  dependencyFailureBaseDelayMs: 250,
  dependencyFailureMaxDelayMs: 30_000,
  jobTimeoutMs: 10_800_000,
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
    const parentSignal = reviewAbortSignal(signal);
    if (parentSignal === null) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_SIGNAL');
    }
    if (this.running) {
      throw new BalanceSyncConsumerError('BALANCE_SYNC_CONSUMER_ALREADY_RUNNING');
    }

    const runOwner = createBalanceSyncExecutionContext();
    const ownedExecution = reviewBalanceSyncExecutionContext(runOwner.context);
    if (ownedExecution === null) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_SIGNAL');
    }
    const reviewedSignal = reviewAbortSignal(ownedExecution.signal);
    if (reviewedSignal === null) {
      throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_SIGNAL');
    }
    const relayShutdown = (): void => runOwner.abort('SHUTDOWN');
    let listeningForShutdown = false;
    if (parentSignal.aborted()) {
      relayShutdown();
    } else {
      parentSignal.add(relayShutdown);
      listeningForShutdown = true;
      if (parentSignal.aborted()) relayShutdown();
    }

    this.running = true;
    let consecutiveFailures = 0;
    try {
      while (!reviewedSignal.aborted()) {
        let result: JobProcessingResult;
        try {
          result = await this.worker.processOne(
            (job) => this.dispatchAccepted(job, reviewedSignal),
            ownedExecution.signal,
          );
        } catch {
          consecutiveFailures += 1;
          await this.waitAfterFailure(consecutiveFailures, ownedExecution.signal);
          continue;
        }
        if (reviewedSignal.aborted()) break;

        if (result.status === 'completed') {
          consecutiveFailures = 0;
          continue;
        }
        if (result.status === 'idle') {
          consecutiveFailures = 0;
          await this.wait(this.policy.idleDelayMs, ownedExecution.signal);
          continue;
        }

        consecutiveFailures += 1;
        await this.waitAfterFailure(consecutiveFailures, ownedExecution.signal);
      }
    } finally {
      runOwner.abort('SHUTDOWN');
      if (listeningForShutdown) parentSignal.remove(relayShutdown);
      this.running = false;
    }
  }

  private async dispatchAccepted(job: JobEnvelope, runSignal: ReviewedAbortSignal): Promise<void> {
    const owner = createBalanceSyncExecutionContext();
    const relayShutdown = (): void => owner.abort('SHUTDOWN');
    let listening = false;
    if (runSignal.aborted()) {
      relayShutdown();
    } else {
      runSignal.add(relayShutdown);
      listening = true;
      if (runSignal.aborted()) relayShutdown();
    }
    const deadline = setTimeout(() => owner.abort('DEADLINE'), this.policy.jobTimeoutMs);
    deadline.unref?.();
    try {
      await this.dispatcher.dispatch(job, owner.context);
    } finally {
      clearTimeout(deadline);
      if (listening) runSignal.remove(relayShutdown);
    }
  }

  private async waitAfterFailure(failureCount: number, signal: AbortSignal): Promise<void> {
    if (abortSignalAborted(signal)) return;
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
      'jobTimeoutMs',
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
      const minimum = key === 'jobTimeoutMs' ? 7_200_000 : 10;
      const maximum = key === 'jobTimeoutMs' ? 21_600_000 : 60_000;
      if (
        !descriptor ||
        !('value' in descriptor) ||
        descriptor.enumerable !== true ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < minimum ||
        descriptor.value > maximum
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
      jobTimeoutMs: parsed.jobTimeoutMs,
    });
  } catch (error) {
    if (error instanceof BalanceSyncConsumerError) throw error;
    throw new BalanceSyncConsumerError('INVALID_BALANCE_SYNC_CONSUMER_POLICY');
  }
}

function waitForNextPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  const reviewed = reviewAbortSignal(signal);
  if (reviewed === null || reviewed.aborted()) return Promise.resolve();
  return new Promise((resolve) => {
    function finish(): void {
      clearTimeout(timeout);
      reviewed?.remove(finish);
      resolve();
    }
    const timeout = setTimeout(finish, milliseconds);
    reviewed.add(finish);
    if (reviewed.aborted()) {
      finish();
    }
  });
}

interface ReviewedAbortSignal {
  readonly aborted: () => boolean;
  readonly add: (listener: EventListener) => void;
  readonly remove: (listener: EventListener) => void;
}

const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)?.get;
const EVENT_TARGET_ADD_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as EventTarget['addEventListener'] | undefined;
const EVENT_TARGET_REMOVE_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'removeEventListener',
)?.value as EventTarget['removeEventListener'] | undefined;

function reviewAbortSignal(value: unknown): Readonly<ReviewedAbortSignal> | null {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      ABORT_SIGNAL_ABORTED_GETTER === undefined ||
      typeof EVENT_TARGET_ADD_EVENT_LISTENER !== 'function' ||
      typeof EVENT_TARGET_REMOVE_EVENT_LISTENER !== 'function'
    ) {
      return null;
    }
    const signal = value as AbortSignal;
    Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []);
    return Object.freeze({
      aborted: (): boolean => Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) as boolean,
      add: (listener: EventListener): void => {
        Reflect.apply(EVENT_TARGET_ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
      },
      remove: (listener: EventListener): void => {
        Reflect.apply(EVENT_TARGET_REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
      },
    });
  } catch {
    return null;
  }
}

function abortSignalAborted(signal: AbortSignal): boolean {
  return reviewAbortSignal(signal)?.aborted() ?? true;
}
