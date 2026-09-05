import type { DormantBalanceSyncConsumerResource } from './balance-sync-consumer.resource';

const DEPENDENCY_KEYS = Object.freeze(['resource', 'signal', 'operatorEvents'] as const);
const RESOURCE_KEYS = Object.freeze(['run', 'close'] as const);
const OPERATOR_PORT_KEYS = Object.freeze(['record'] as const);

export type BalanceSyncConsumerLifecycleEvent = Readonly<{
  event: 'STARTED' | 'STOPPED' | 'PREMATURE_RUN_EXIT' | 'RUN_FAILED' | 'CLOSE_FAILED';
}>;

export interface BalanceSyncConsumerLifecycleOperatorPort {
  readonly record: (event: BalanceSyncConsumerLifecycleEvent) => void | Promise<void>;
}

export interface DormantBalanceSyncConsumerLifecycleDependencies {
  readonly resource: Readonly<DormantBalanceSyncConsumerResource>;
  readonly signal: AbortSignal;
  readonly operatorEvents: BalanceSyncConsumerLifecycleOperatorPort;
}

export interface DormantBalanceSyncConsumerLifecycleCoordinator {
  readonly run: () => Promise<void>;
}

class BalanceSyncConsumerLifecycleConfigurationError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_INVALID' as const;

  constructor() {
    super('Balance sync consumer lifecycle configuration is invalid');
    this.name = 'BalanceSyncConsumerLifecycleConfigurationError';
  }
}

class BalanceSyncConsumerLifecycleAlreadyStartedError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_ALREADY_STARTED' as const;

  constructor() {
    super('Balance sync consumer lifecycle is already started');
    this.name = 'BalanceSyncConsumerLifecycleAlreadyStartedError';
  }
}

class BalanceSyncConsumerLifecycleSignalError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_SIGNAL_INVALID' as const;

  constructor() {
    super('Balance sync consumer lifecycle signal is invalid');
    this.name = 'BalanceSyncConsumerLifecycleSignalError';
  }
}

class BalanceSyncConsumerLifecyclePrematureExitError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_PREMATURE_RUN_EXIT' as const;

  constructor() {
    super('Balance sync consumer lifecycle run exited before shutdown');
    this.name = 'BalanceSyncConsumerLifecyclePrematureExitError';
  }
}

class BalanceSyncConsumerLifecycleRunError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_RUN_FAILED' as const;

  constructor() {
    super('Balance sync consumer lifecycle run failed');
    this.name = 'BalanceSyncConsumerLifecycleRunError';
  }
}

class BalanceSyncConsumerLifecycleCloseError extends Error {
  readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CLOSE_FAILED' as const;

  constructor() {
    super('Balance sync consumer lifecycle close failed');
    this.name = 'BalanceSyncConsumerLifecycleCloseError';
  }
}

interface ReviewedSignal {
  readonly aborted: () => boolean;
  readonly addAbortListener: (listener: () => void) => void;
  readonly removeAbortListener: (listener: () => void) => void;
}

interface ReviewedDependencies {
  readonly runResource: (signal: AbortSignal) => Promise<void>;
  readonly closeResource: () => Promise<void>;
  readonly signal: ReviewedSignal;
  readonly recordEvent: (event: BalanceSyncConsumerLifecycleEvent) => void | Promise<void>;
}

function invalidConfiguration(): never {
  throw new BalanceSyncConsumerLifecycleConfigurationError();
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidConfiguration();
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return invalidConfiguration();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return invalidConfiguration();
  }
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalidConfiguration();
    record[key] = descriptor.value;
  }
  return record;
}

function reviewedResource(value: unknown): Readonly<{
  runResource: (signal: AbortSignal) => Promise<void>;
  closeResource: () => Promise<void>;
}> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidConfiguration();
  }
  if (Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) {
    return invalidConfiguration();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== RESOURCE_KEYS.length ||
    keys.some(
      (key) => typeof key !== 'string' || !RESOURCE_KEYS.some((expected) => expected === key),
    )
  ) {
    return invalidConfiguration();
  }
  for (const key of RESOURCE_KEYS) {
    const descriptor = descriptors[key];
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      descriptor.configurable !== false ||
      descriptor.writable !== false ||
      typeof descriptor.value !== 'function'
    ) {
      return invalidConfiguration();
    }
  }
  return Object.freeze({
    runResource: descriptors.run?.value as (signal: AbortSignal) => Promise<void>,
    closeResource: descriptors.close?.value as () => Promise<void>,
  });
}

function reviewedSignal(value: unknown): ReviewedSignal {
  const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
  if (!abortedGetter) return invalidConfiguration();
  const aborted = (): boolean => abortedGetter.call(value) as boolean;
  aborted();
  return Object.freeze({
    aborted,
    addAbortListener: (listener: () => void): void => {
      EventTarget.prototype.addEventListener.call(value, 'abort', listener, { once: true });
    },
    removeAbortListener: (listener: () => void): void => {
      EventTarget.prototype.removeEventListener.call(value, 'abort', listener);
    },
  });
}

function reviewedOperatorPort(
  value: unknown,
): (event: BalanceSyncConsumerLifecycleEvent) => void | Promise<void> {
  const record = exactDataRecord(value, OPERATOR_PORT_KEYS).record;
  if (typeof record !== 'function') return invalidConfiguration();
  return record as (event: BalanceSyncConsumerLifecycleEvent) => void | Promise<void>;
}

function reviewedDependencies(value: unknown): ReviewedDependencies {
  try {
    const dependencies = exactDataRecord(value, DEPENDENCY_KEYS);
    const resource = reviewedResource(dependencies.resource);
    return Object.freeze({
      ...resource,
      signal: reviewedSignal(dependencies.signal),
      recordEvent: reviewedOperatorPort(dependencies.operatorEvents),
    });
  } catch {
    return invalidConfiguration();
  }
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function lifecycleEvent(
  event: BalanceSyncConsumerLifecycleEvent['event'],
): BalanceSyncConsumerLifecycleEvent {
  return frozenNullPrototype({ event });
}

function recordEvent(
  recorder: (event: BalanceSyncConsumerLifecycleEvent) => void | Promise<void>,
  event: BalanceSyncConsumerLifecycleEvent['event'],
): void {
  try {
    void Promise.resolve(recorder(lifecycleEvent(event))).catch(() => undefined);
  } catch {
    // Operator diagnostics cannot replace the fixed lifecycle outcome.
  }
}

async function closeResource(close: () => Promise<void>): Promise<boolean> {
  try {
    await Promise.resolve().then(close);
    return true;
  } catch {
    return false;
  }
}

async function executeLifecycle(reviewed: ReviewedDependencies): Promise<void> {
  const controller = new AbortController();
  let stopRequested = false;
  let listening = false;
  let runHandoffComplete = false;
  let closeOperation: Promise<boolean> | undefined;
  let wakeProgress!: () => void;
  const progress = new Promise<void>((resolve) => {
    wakeProgress = resolve;
  });
  const beginClose = (): Promise<boolean> => {
    if (closeOperation !== undefined) return closeOperation;
    closeOperation = closeResource(reviewed.closeResource);
    void closeOperation.then(() => {
      wakeProgress();
    });
    return closeOperation;
  };
  const requestStop = (): void => {
    if (stopRequested) return;
    stopRequested = true;
    try {
      controller.abort(new Error('Balance sync consumer lifecycle stop requested'));
    } finally {
      if (runHandoffComplete) void beginClose();
    }
  };

  try {
    if (reviewed.signal.aborted()) {
      requestStop();
    } else {
      reviewed.signal.addAbortListener(requestStop);
      listening = true;
      if (reviewed.signal.aborted()) requestStop();
    }
  } catch {
    if (listening) {
      try {
        reviewed.signal.removeAbortListener(requestStop);
      } catch {
        // The fixed signal error below remains the only boundary detail.
      }
    }
    const closed = await closeResource(reviewed.closeResource);
    if (!closed) {
      recordEvent(reviewed.recordEvent, 'CLOSE_FAILED');
      throw new BalanceSyncConsumerLifecycleCloseError();
    }
    throw new BalanceSyncConsumerLifecycleSignalError();
  }

  let runFailed = false;
  let runSettled = false;
  let runFailureReported = false;
  let runOperation: Promise<void> | undefined;
  try {
    runOperation = Promise.resolve(reviewed.runResource(controller.signal));
  } catch {
    runFailed = true;
    runSettled = true;
  }
  let observedRun: Promise<void> | undefined;
  if (runOperation !== undefined) {
    observedRun = runOperation.then(
      () => {
        runSettled = true;
        wakeProgress();
      },
      () => {
        runFailed = true;
        runSettled = true;
        wakeProgress();
      },
    );
  }
  runHandoffComplete = true;

  if (runOperation !== undefined) {
    if (!stopRequested) recordEvent(reviewed.recordEvent, 'STARTED');
    if (stopRequested) void beginClose();
    await progress;
  } else if (stopRequested) {
    void beginClose();
  }

  const prematureExit = runSettled && !runFailed && !stopRequested;
  if (!stopRequested && runSettled && listening) {
    try {
      reviewed.signal.removeAbortListener(requestStop);
      listening = false;
    } catch {
      // Listener cleanup cannot replace the fixed lifecycle outcome.
    }
  }

  if (runFailed) {
    recordEvent(reviewed.recordEvent, 'RUN_FAILED');
    runFailureReported = true;
  } else if (prematureExit) recordEvent(reviewed.recordEvent, 'PREMATURE_RUN_EXIT');

  const closed = await beginClose();
  if (!closed) {
    if (listening) {
      try {
        reviewed.signal.removeAbortListener(requestStop);
      } catch {
        // Listener cleanup cannot replace the fixed close outcome.
      }
    }
    recordEvent(reviewed.recordEvent, 'CLOSE_FAILED');
    throw new BalanceSyncConsumerLifecycleCloseError();
  }

  if (observedRun !== undefined && !runSettled) await observedRun;
  if (listening) {
    try {
      reviewed.signal.removeAbortListener(requestStop);
    } catch {
      // Listener cleanup cannot replace the fixed lifecycle outcome.
    }
  }
  if (runFailed && !runFailureReported) recordEvent(reviewed.recordEvent, 'RUN_FAILED');
  if (runFailed) throw new BalanceSyncConsumerLifecycleRunError();
  if (prematureExit) throw new BalanceSyncConsumerLifecyclePrematureExitError();
  recordEvent(reviewed.recordEvent, 'STOPPED');
}

/**
 * Inert, provider-neutral lifecycle shell for the dormant aggregate. It owns no
 * process listeners or runtime registration; an approved future runtime must
 * explicitly invoke the one-shot `run` method.
 */
export function createDormantBalanceSyncConsumerLifecycleCoordinator(
  dependencies: DormantBalanceSyncConsumerLifecycleDependencies,
): Readonly<DormantBalanceSyncConsumerLifecycleCoordinator> {
  const reviewed = reviewedDependencies(dependencies);
  let started = false;
  let operation: Promise<void> | undefined;

  const run = (): Promise<void> => {
    if (started) {
      return Promise.reject(new BalanceSyncConsumerLifecycleAlreadyStartedError());
    }
    started = true;
    operation = Promise.resolve().then(() => executeLifecycle(reviewed));
    return operation;
  };

  return frozenNullPrototype<DormantBalanceSyncConsumerLifecycleCoordinator>({ run });
}
