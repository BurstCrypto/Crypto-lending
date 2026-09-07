import { isProxy } from 'node:util/types';

import {
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
  type ProviderPositionChainAnchorRecordIntentReconciliationPort,
  type ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
} from './ports/provider-position-chain-anchor-record-intent-reconciliation.port';

export const PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION =
  1 as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_ONLY' as const;
export const PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_RESULT_USE =
  'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_RESULT_ONLY' as const;

const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_SHA256 = '0'.repeat(64);
const MAX_WORK_ITEMS = 64;
const MIN_RUN_MILLISECONDS = 10;
const MAX_RUN_MILLISECONDS = 30_000;
const MIN_RETRY_DELAY_MILLISECONDS = 10;

const DEPENDENCY_KEYS = Object.freeze(['reconciliation', 'clock', 'timer', 'policy'] as const);
const POLICY_KEYS = Object.freeze(['maximumWorkItems', 'maximumRunMilliseconds'] as const);
const RUN_REQUEST_KEYS = Object.freeze([
  'lifecycleVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'signal',
] as const);
const COMMON_RESULT_KEYS = Object.freeze([
  'reconciliationVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'outcome',
] as const);
const TERMINAL_COMMON_KEYS = Object.freeze([
  ...COMMON_RESULT_KEYS,
  'recordIntentFingerprintSha256',
  'evidenceFingerprintSha256',
  'producerDeadlineAt',
  'resolvedAt',
] as const);
const RECORDED_RESULT_KEYS = Object.freeze([
  ...TERMINAL_COMMON_KEYS,
  'deadlineBindingSha256',
  'evidenceRecordedAt',
] as const);
const DEADLINE_VIOLATION_RESULT_KEYS = Object.freeze([
  ...TERMINAL_COMMON_KEYS,
  'evidenceRecordedAt',
] as const);
const DEFERRED_RESULT_KEYS = Object.freeze([
  ...COMMON_RESULT_KEYS,
  'recordIntentFingerprintSha256',
  'evidenceFingerprintSha256',
  'knownIntentState',
  'uncertainPhase',
  'retryNotBefore',
] as const);

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as EventTarget['addEventListener'] | undefined;
const REMOVE_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'removeEventListener',
)?.value as EventTarget['removeEventListener'] | undefined;
const DATE_GET_TIME = Object.getOwnPropertyDescriptor(Date.prototype, 'getTime')?.value as
  ((this: Date) => number) | undefined;
const DATE_TO_ISO_STRING = Object.getOwnPropertyDescriptor(Date.prototype, 'toISOString')?.value as
  ((this: Date) => string) | undefined;
const DATE_PARSE = Date.parse;
const ABORT_CONTROLLER_CONSTRUCTOR = AbortController;
const ABORT_CONTROLLER_ABORT = Object.getOwnPropertyDescriptor(AbortController.prototype, 'abort')
  ?.value as AbortController['abort'] | undefined;

export interface ProviderPositionChainAnchorRecordIntentReconciliationLifecycleClock {
  readonly now: () => Date;
}

/** Timer capability is injected; importing or constructing the lifecycle starts no timer. */
export interface ProviderPositionChainAnchorRecordIntentReconciliationLifecycleTimer {
  readonly schedule: (callback: () => void, milliseconds: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

export interface ProviderPositionChainAnchorRecordIntentReconciliationLifecyclePolicyV1 {
  readonly maximumWorkItems: number;
  readonly maximumRunMilliseconds: number;
}

export interface ProviderPositionChainAnchorRecordIntentReconciliationLifecycleDependenciesV1 {
  readonly reconciliation: ProviderPositionChainAnchorRecordIntentReconciliationPort;
  readonly clock: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleClock;
  readonly timer: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleTimer;
  readonly policy: ProviderPositionChainAnchorRecordIntentReconciliationLifecyclePolicyV1;
}

export interface RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1 {
  readonly lifecycleVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly signal: AbortSignal;
}

export type ProviderPositionChainAnchorRecordIntentReconciliationLifecycleOutcome =
  'IDLE' | 'WORK_LIMIT_REACHED' | 'RUN_DEADLINE_REACHED' | 'DEFERRED' | 'ABORTED';

export interface ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1 {
  readonly lifecycleVersion: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION;
  readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_RESULT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly outcome: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleOutcome;
  readonly attemptCount: number;
  readonly resolvedIntentCount: number;
  readonly deferredCount: number;
}

export type ProviderPositionChainAnchorRecordIntentReconciliationLifecycleErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'ALREADY_RUNNING'
  | 'CLOCK_UNAVAILABLE'
  | 'TIMER_UNAVAILABLE'
  | 'RECONCILIATION_UNAVAILABLE'
  | 'RESULT_AUTHENTICATION_FAILED'
  | 'SIGNAL_UNAVAILABLE';

export class ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError extends Error {
  constructor(
    readonly code: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleErrorCode,
  ) {
    super('Provider position chain-anchor record-intent reconciliation lifecycle is unavailable');
    this.name = 'ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface CapturedMethod {
  readonly receiver: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

interface CapturedReconciliation {
  readonly reconcileNext: CapturedMethod;
  readonly reviewResult: CapturedMethod;
}

interface CapturedTimer {
  readonly schedule: CapturedMethod;
  readonly cancel: CapturedMethod;
}

interface ReviewedSignal {
  readonly value: AbortSignal;
  readonly aborted: () => boolean;
  readonly add: (listener: EventListener) => void;
  readonly remove: (listener: EventListener) => void;
}

interface ReviewedDependencies {
  readonly reconciliation: CapturedReconciliation;
  readonly readClock: CapturedMethod;
  readonly timer: CapturedTimer;
  readonly maximumWorkItems: number;
  readonly maximumRunMilliseconds: number;
}

interface ReviewedReconciliationResult {
  readonly outcome: 'IDLE' | 'RECORDED' | 'NOT_RECORDED' | 'DEADLINE_VIOLATION' | 'DEFERRED';
  readonly retryNotBeforeMilliseconds: number | null;
}

interface RunCounts {
  attempts: number;
  resolved: number;
  deferred: number;
}

type InvocationOutcome = Readonly<{ ok: true; capability: unknown }> | Readonly<{ ok: false }>;

type WaitOutcome = 'ELAPSED' | 'ABORTED';

function fail(
  code: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleErrorCode,
): never {
  throw new ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError(code);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, members)) as Readonly<T>;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: 'INVALID_CONFIGURATION' | 'INVALID_REQUEST' | 'RESULT_AUTHENTICATION_FAILED',
  requireFrozen = false,
  requireNullPrototype = false,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      (requireFrozen && !Object.isFrozen(value))
    ) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (requireNullPrototype && prototype !== null) ||
      (!requireNullPrototype && prototype !== null && prototype !== Object.prototype)
    ) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError) {
      throw error;
    }
    return fail(code);
  }
}

function stableDataMember(value: unknown, key: PropertyKey): unknown {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return undefined;
    }
    let current: object | null = value;
    for (
      let depth = 0;
      current !== null &&
      current !== Object.prototype &&
      current !== Function.prototype &&
      depth < 8;
      depth += 1
    ) {
      if (isProxy(current)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function captureMethod(value: unknown, key: string): Readonly<CapturedMethod> {
  const method = stableDataMember(value, key);
  if (
    typeof method !== 'function' ||
    isProxy(method) ||
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver: value,
    method: method as (...arguments_: readonly unknown[]) => unknown,
  });
}

function reviewedPositiveInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail('INVALID_CONFIGURATION');
  }
  return value as number;
}

function reviewedDependencies(value: unknown): Readonly<ReviewedDependencies> {
  const dependencies = exactDataRecord(value, DEPENDENCY_KEYS, 'INVALID_CONFIGURATION');
  const reconciliationVersion = stableDataMember(
    dependencies.reconciliation,
    'reconciliationVersion',
  );
  if (
    reconciliationVersion !== PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const reconcileNext = captureMethod(dependencies.reconciliation, 'reconcileNext');
  const reviewResult = captureMethod(dependencies.reconciliation, 'reviewResult');
  if (reconcileNext.method === reviewResult.method) return fail('INVALID_CONFIGURATION');

  const readClock = captureMethod(dependencies.clock, 'now');
  const schedule = captureMethod(dependencies.timer, 'schedule');
  const cancel = captureMethod(dependencies.timer, 'cancel');
  if (schedule.method === cancel.method) return fail('INVALID_CONFIGURATION');

  const policy = exactDataRecord(dependencies.policy, POLICY_KEYS, 'INVALID_CONFIGURATION');
  return Object.freeze({
    reconciliation: Object.freeze({ reconcileNext, reviewResult }),
    readClock,
    timer: Object.freeze({ schedule, cancel }),
    maximumWorkItems: reviewedPositiveInteger(policy.maximumWorkItems, 1, MAX_WORK_ITEMS),
    maximumRunMilliseconds: reviewedPositiveInteger(
      policy.maximumRunMilliseconds,
      MIN_RUN_MILLISECONDS,
      MAX_RUN_MILLISECONDS,
    ),
  });
}

function reviewedSignal(
  value: unknown,
  code: 'INVALID_REQUEST' | 'SIGNAL_UNAVAILABLE',
): ReviewedSignal {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype ||
      ABORTED_GETTER === undefined ||
      ADD_EVENT_LISTENER === undefined ||
      REMOVE_EVENT_LISTENER === undefined
    ) {
      return fail(code);
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return Object.freeze({
      value: value as AbortSignal,
      aborted: (): boolean => Reflect.apply(ABORTED_GETTER, value, []) as boolean,
      add: (listener: EventListener): void => {
        Reflect.apply(ADD_EVENT_LISTENER, value, ['abort', listener, { once: true }]);
      },
      remove: (listener: EventListener): void => {
        Reflect.apply(REMOVE_EVENT_LISTENER, value, ['abort', listener]);
      },
    });
  } catch (error) {
    if (error instanceof ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError) {
      throw error;
    }
    return fail(code);
  }
}

function reviewedRunRequest(value: unknown): Readonly<{
  request: RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1;
  signal: ReviewedSignal;
}> {
  const record = exactDataRecord(value, RUN_REQUEST_KEYS, 'INVALID_REQUEST', true);
  if (
    record.lifecycleVersion !==
      PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_USE ||
    record.mayAuthorizeFinancialAction !== false
  ) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({
    request: value as RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1,
    signal: reviewedSignal(record.signal, 'INVALID_REQUEST'),
  });
}

function genuinePromise(value: unknown): value is Promise<unknown> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      !isProxy(value) &&
      Object.getPrototypeOf(value) === Promise.prototype
    );
  } catch {
    return false;
  }
}

function canonicalTimestamp(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !CANONICAL_TIMESTAMP.test(value) ||
    DATE_TO_ISO_STRING === undefined
  ) {
    return fail('RESULT_AUTHENTICATION_FAILED');
  }
  const milliseconds = Reflect.apply(DATE_PARSE, Date, [value]) as number;
  if (!Number.isSafeInteger(milliseconds)) return fail('RESULT_AUTHENTICATION_FAILED');
  try {
    if (Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) !== value) {
      return fail('RESULT_AUTHENTICATION_FAILED');
    }
  } catch {
    return fail('RESULT_AUTHENTICATION_FAILED');
  }
  return milliseconds;
}

function nonzeroSha256(value: unknown): void {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) {
    return fail('RESULT_AUTHENTICATION_FAILED');
  }
}

function reviewedCommonResult(record: Record<string, unknown>): void {
  if (
    record.reconciliationVersion !==
      PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION ||
    record.use !== PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE ||
    record.mayAuthorizeFinancialAction !== false
  ) {
    return fail('RESULT_AUTHENTICATION_FAILED');
  }
}

function reviewedTerminalResult(
  value: unknown,
  keys: readonly string[],
  outcome: 'RECORDED' | 'NOT_RECORDED' | 'DEADLINE_VIOLATION',
): ReviewedReconciliationResult {
  const record = exactDataRecord(value, keys, 'RESULT_AUTHENTICATION_FAILED', true, true);
  reviewedCommonResult(record);
  if (record.outcome !== outcome) return fail('RESULT_AUTHENTICATION_FAILED');
  nonzeroSha256(record.recordIntentFingerprintSha256);
  nonzeroSha256(record.evidenceFingerprintSha256);
  const producerDeadlineAt = canonicalTimestamp(record.producerDeadlineAt);
  const resolvedAt = canonicalTimestamp(record.resolvedAt);
  if (resolvedAt < producerDeadlineAt) return fail('RESULT_AUTHENTICATION_FAILED');

  if (outcome === 'RECORDED') {
    nonzeroSha256(record.deadlineBindingSha256);
    const evidenceRecordedAt = canonicalTimestamp(record.evidenceRecordedAt);
    if (evidenceRecordedAt >= producerDeadlineAt || resolvedAt < evidenceRecordedAt) {
      return fail('RESULT_AUTHENTICATION_FAILED');
    }
  } else if (outcome === 'DEADLINE_VIOLATION') {
    const evidenceRecordedAt = canonicalTimestamp(record.evidenceRecordedAt);
    if (resolvedAt < evidenceRecordedAt) return fail('RESULT_AUTHENTICATION_FAILED');
  }

  return Object.freeze({ outcome, retryNotBeforeMilliseconds: null });
}

function reviewedDeferredResult(value: unknown): ReviewedReconciliationResult {
  const record = exactDataRecord(
    value,
    DEFERRED_RESULT_KEYS,
    'RESULT_AUTHENTICATION_FAILED',
    true,
    true,
  );
  reviewedCommonResult(record);
  if (record.outcome !== 'DEFERRED') return fail('RESULT_AUTHENTICATION_FAILED');

  const hasLeaseIdentity = record.recordIntentFingerprintSha256 !== null;
  if (
    hasLeaseIdentity !== (record.evidenceFingerprintSha256 !== null) ||
    hasLeaseIdentity !== (record.knownIntentState !== null) ||
    hasLeaseIdentity !== (record.retryNotBefore !== null)
  ) {
    return fail('RESULT_AUTHENTICATION_FAILED');
  }
  if (!hasLeaseIdentity) {
    if (record.uncertainPhase !== 'LEASE_RECONCILIATION') {
      return fail('RESULT_AUTHENTICATION_FAILED');
    }
    return Object.freeze({ outcome: 'DEFERRED' as const, retryNotBeforeMilliseconds: null });
  }

  nonzeroSha256(record.recordIntentFingerprintSha256);
  nonzeroSha256(record.evidenceFingerprintSha256);
  if (
    (record.knownIntentState !== 'NEW' &&
      record.knownIntentState !== 'RECORD_DISPATCHED' &&
      record.knownIntentState !== 'UNKNOWN') ||
    record.uncertainPhase !== 'RECONCILE_RECORD'
  ) {
    return fail('RESULT_AUTHENTICATION_FAILED');
  }
  return Object.freeze({
    outcome: 'DEFERRED' as const,
    retryNotBeforeMilliseconds: canonicalTimestamp(record.retryNotBefore),
  });
}

function reviewedPortResult(value: unknown): ReviewedReconciliationResult {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      !Object.isFrozen(value) ||
      Object.getPrototypeOf(value) !== null
    ) {
      return fail('RESULT_AUTHENTICATION_FAILED');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'outcome');
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('RESULT_AUTHENTICATION_FAILED');
    }
    switch (descriptor.value) {
      case 'IDLE': {
        const record = exactDataRecord(
          value,
          COMMON_RESULT_KEYS,
          'RESULT_AUTHENTICATION_FAILED',
          true,
          true,
        );
        reviewedCommonResult(record);
        return Object.freeze({ outcome: 'IDLE' as const, retryNotBeforeMilliseconds: null });
      }
      case 'RECORDED':
        return reviewedTerminalResult(value, RECORDED_RESULT_KEYS, 'RECORDED');
      case 'NOT_RECORDED':
        return reviewedTerminalResult(value, TERMINAL_COMMON_KEYS, 'NOT_RECORDED');
      case 'DEADLINE_VIOLATION':
        return reviewedTerminalResult(value, DEADLINE_VIOLATION_RESULT_KEYS, 'DEADLINE_VIOLATION');
      case 'DEFERRED':
        return reviewedDeferredResult(value);
      default:
        return fail('RESULT_AUTHENTICATION_FAILED');
    }
  } catch (error) {
    if (error instanceof ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError) {
      throw error;
    }
    return fail('RESULT_AUTHENTICATION_FAILED');
  }
}

function runResult(
  outcome: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleOutcome,
  counts: RunCounts,
): Readonly<ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1> {
  return frozenNullPrototype({
    lifecycleVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    outcome,
    attemptCount: counts.attempts,
    resolvedIntentCount: counts.resolved,
    deferredCount: counts.deferred,
  });
}

/**
 * Dormant direct-import-only bounded runner. It processes record-intent
 * reconciliation sequentially and starts no work until `run` is called. It
 * has no provider, network, persistence, logging, or financial-action port and
 * is intentionally absent from Nest modules, feature barrels, and CLIs.
 */
export class DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle {
  readonly #dependencies: Readonly<ReviewedDependencies>;
  #running = false;

  constructor(
    dependencies: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleDependenciesV1,
  ) {
    this.#dependencies = reviewedDependencies(dependencies);
  }

  async run(
    requestInput: RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1,
  ): Promise<Readonly<ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1>> {
    const request = reviewedRunRequest(requestInput);
    if (this.#running) return fail('ALREADY_RUNNING');
    this.#running = true;
    try {
      return await this.#runReviewed(request.signal);
    } finally {
      this.#running = false;
    }
  }

  async #runReviewed(
    externalSignal: ReviewedSignal,
  ): Promise<Readonly<ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1>> {
    const counts: RunCounts = { attempts: 0, resolved: 0, deferred: 0 };
    if (externalSignal.aborted()) return runResult('ABORTED', counts);

    const startedAt = this.#clockMilliseconds();
    const deadlineAt = startedAt + this.#dependencies.maximumRunMilliseconds;
    if (!Number.isSafeInteger(deadlineAt)) return fail('CLOCK_UNAVAILABLE');

    if (ABORT_CONTROLLER_ABORT === undefined) return fail('SIGNAL_UNAVAILABLE');
    const controller = new ABORT_CONTROLLER_CONSTRUCTOR();
    const internalSignal = reviewedSignal(controller.signal, 'SIGNAL_UNAVAILABLE');
    let externalAborted = false;
    let deadlineReached = false;
    let runtimeFailed = false;
    let listening = false;
    let deadlineTimerCreated = false;
    let deadlineTimer: unknown;
    const abortInternal = (): void => {
      try {
        Reflect.apply(ABORT_CONTROLLER_ABORT, controller, []);
      } catch {
        runtimeFailed = true;
      }
    };
    const onExternalAbort: EventListener = () => {
      externalAborted = true;
      abortInternal();
    };

    try {
      try {
        externalSignal.add(onExternalAbort);
        listening = true;
        if (externalSignal.aborted()) {
          externalAborted = true;
          abortInternal();
        }
      } catch {
        return fail('SIGNAL_UNAVAILABLE');
      }
      if (externalAborted) return runResult('ABORTED', counts);

      try {
        deadlineTimer = this.#schedule(() => {
          if (!deadlineTimerCreated) {
            runtimeFailed = true;
            abortInternal();
            return;
          }
          const observedAt = this.#tryClockMilliseconds();
          if (observedAt === null || observedAt < deadlineAt) runtimeFailed = true;
          else deadlineReached = true;
          abortInternal();
        }, this.#dependencies.maximumRunMilliseconds);
        deadlineTimerCreated = true;
      } catch {
        return fail('TIMER_UNAVAILABLE');
      }
      if (runtimeFailed) return fail('TIMER_UNAVAILABLE');

      while (counts.attempts < this.#dependencies.maximumWorkItems) {
        const preflight = this.#currentStatus(
          counts,
          startedAt,
          deadlineAt,
          externalSignal,
          externalAborted,
          deadlineReached,
          runtimeFailed,
        );
        if (preflight !== null) return preflight;

        const reconcileRequest =
          frozenNullPrototype<ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1>({
            reconciliationVersion:
              PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
            use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
            mayAuthorizeFinancialAction: false,
            signal: internalSignal.value,
          });
        counts.attempts += 1;
        const invocation = await this.#invoke(reconcileRequest);
        if (!invocation.ok) {
          const interrupted = this.#currentStatus(
            counts,
            startedAt,
            deadlineAt,
            externalSignal,
            externalAborted,
            deadlineReached,
            runtimeFailed,
          );
          if (interrupted !== null) return interrupted;
          return fail('RECONCILIATION_UNAVAILABLE');
        }

        const reviewed = this.#authenticateResult(invocation.capability, reconcileRequest);
        const completed = this.#currentStatus(
          counts,
          startedAt,
          deadlineAt,
          externalSignal,
          externalAborted,
          deadlineReached,
          runtimeFailed,
        );
        if (completed !== null) return completed;

        if (reviewed.outcome === 'IDLE') return runResult('IDLE', counts);
        if (reviewed.outcome !== 'DEFERRED') {
          counts.resolved += 1;
          continue;
        }

        counts.deferred += 1;
        if (reviewed.retryNotBeforeMilliseconds === null) {
          return runResult('DEFERRED', counts);
        }
        if (counts.attempts >= this.#dependencies.maximumWorkItems) {
          return runResult('WORK_LIMIT_REACHED', counts);
        }

        const now = this.#monotonicClockMilliseconds(startedAt);
        const retryAt = Math.max(
          reviewed.retryNotBeforeMilliseconds,
          now + MIN_RETRY_DELAY_MILLISECONDS,
        );
        if (!Number.isSafeInteger(retryAt) || retryAt >= deadlineAt) {
          return runResult('DEFERRED', counts);
        }
        const wait = await this.#wait(retryAt - now, internalSignal);
        if (wait === 'ABORTED') {
          const interrupted = this.#currentStatus(
            counts,
            startedAt,
            deadlineAt,
            externalSignal,
            externalAborted,
            deadlineReached,
            runtimeFailed,
          );
          if (interrupted !== null) return interrupted;
          return fail('TIMER_UNAVAILABLE');
        }
        if (this.#monotonicClockMilliseconds(startedAt) < retryAt) {
          return fail('TIMER_UNAVAILABLE');
        }
      }
      return runResult('WORK_LIMIT_REACHED', counts);
    } finally {
      abortInternal();
      let cleanupFailure: 'TIMER_UNAVAILABLE' | 'SIGNAL_UNAVAILABLE' | null = runtimeFailed
        ? 'TIMER_UNAVAILABLE'
        : null;
      if (deadlineTimerCreated) {
        try {
          this.#cancel(deadlineTimer);
        } catch {
          cleanupFailure = 'TIMER_UNAVAILABLE';
        }
      }
      if (listening) {
        try {
          externalSignal.remove(onExternalAbort);
        } catch {
          cleanupFailure ??= 'SIGNAL_UNAVAILABLE';
        }
      }
      if (cleanupFailure !== null) fail(cleanupFailure);
    }
  }

  #currentStatus(
    counts: RunCounts,
    startedAt: number,
    deadlineAt: number,
    externalSignal: ReviewedSignal,
    externalAborted: boolean,
    deadlineReached: boolean,
    runtimeFailed: boolean,
  ): Readonly<ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1> | null {
    if (runtimeFailed) return fail('TIMER_UNAVAILABLE');
    let isExternallyAborted: boolean;
    try {
      isExternallyAborted = externalSignal.aborted();
    } catch {
      return fail('SIGNAL_UNAVAILABLE');
    }
    if (externalAborted || isExternallyAborted) return runResult('ABORTED', counts);
    const observedAt = this.#monotonicClockMilliseconds(startedAt);
    if (deadlineReached || observedAt >= deadlineAt) {
      return runResult('RUN_DEADLINE_REACHED', counts);
    }
    return null;
  }

  async #invoke(
    request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): Promise<InvocationOutcome> {
    try {
      const operation = Reflect.apply(
        this.#dependencies.reconciliation.reconcileNext.method,
        this.#dependencies.reconciliation.reconcileNext.receiver,
        [request],
      ) as unknown;
      if (!genuinePromise(operation)) return Object.freeze({ ok: false as const });
      try {
        return Object.freeze({ ok: true as const, capability: await operation });
      } catch {
        return Object.freeze({ ok: false as const });
      }
    } catch {
      return Object.freeze({ ok: false as const });
    }
  }

  #authenticateResult(
    capability: unknown,
    request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): ReviewedReconciliationResult {
    let reviewed: unknown;
    try {
      reviewed = Reflect.apply(
        this.#dependencies.reconciliation.reviewResult.method,
        this.#dependencies.reconciliation.reviewResult.receiver,
        [capability, request],
      );
    } catch {
      return fail('RESULT_AUTHENTICATION_FAILED');
    }
    if (reviewed !== capability) return fail('RESULT_AUTHENTICATION_FAILED');
    return reviewedPortResult(reviewed);
  }

  #clockMilliseconds(): number {
    if (DATE_GET_TIME === undefined) return fail('CLOCK_UNAVAILABLE');
    let value: unknown;
    try {
      value = Reflect.apply(
        this.#dependencies.readClock.method,
        this.#dependencies.readClock.receiver,
        [],
      );
    } catch {
      return fail('CLOCK_UNAVAILABLE');
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Date.prototype
    ) {
      return fail('CLOCK_UNAVAILABLE');
    }
    try {
      const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
      if (!Number.isSafeInteger(milliseconds)) return fail('CLOCK_UNAVAILABLE');
      return milliseconds;
    } catch {
      return fail('CLOCK_UNAVAILABLE');
    }
  }

  #tryClockMilliseconds(): number | null {
    try {
      return this.#clockMilliseconds();
    } catch {
      return null;
    }
  }

  #monotonicClockMilliseconds(startedAt: number): number {
    const milliseconds = this.#clockMilliseconds();
    if (milliseconds < startedAt) return fail('CLOCK_UNAVAILABLE');
    return milliseconds;
  }

  #schedule(callback: () => void, milliseconds: number): unknown {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) {
      return fail('TIMER_UNAVAILABLE');
    }
    return Reflect.apply(
      this.#dependencies.timer.schedule.method,
      this.#dependencies.timer.schedule.receiver,
      [callback, milliseconds],
    );
  }

  #cancel(handle: unknown): void {
    Reflect.apply(
      this.#dependencies.timer.cancel.method,
      this.#dependencies.timer.cancel.receiver,
      [handle],
    );
  }

  #wait(milliseconds: number, signal: ReviewedSignal): Promise<WaitOutcome> {
    return new Promise<WaitOutcome>((resolve, reject) => {
      let settled = false;
      let listening = false;
      let timerCreated = false;
      let timer: unknown;

      const settle = (
        outcome: WaitOutcome,
        requestedFailure: 'TIMER_UNAVAILABLE' | 'SIGNAL_UNAVAILABLE' | null = null,
      ): void => {
        if (settled) return;
        settled = true;
        let cleanupFailure = requestedFailure;
        if (timerCreated) {
          try {
            this.#cancel(timer);
          } catch {
            cleanupFailure = 'TIMER_UNAVAILABLE';
          }
        }
        if (listening) {
          try {
            signal.remove(onAbort);
          } catch {
            cleanupFailure ??= 'SIGNAL_UNAVAILABLE';
          }
          listening = false;
        }
        if (cleanupFailure !== null)
          reject(
            new ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError(cleanupFailure),
          );
        else resolve(outcome);
      };
      const onAbort: EventListener = () => {
        settle('ABORTED');
      };

      try {
        signal.add(onAbort);
        listening = true;
        if (signal.aborted()) {
          settle('ABORTED');
          return;
        }
        let callbackBeforeScheduleReturn = false;
        timer = this.#schedule(() => {
          if (!timerCreated) {
            callbackBeforeScheduleReturn = true;
            return;
          }
          settle('ELAPSED');
        }, milliseconds);
        timerCreated = true;
        if (callbackBeforeScheduleReturn) {
          settle('ELAPSED', 'TIMER_UNAVAILABLE');
          return;
        }
        if (signal.aborted()) settle('ABORTED');
      } catch {
        settle('ABORTED', 'TIMER_UNAVAILABLE');
      }
    });
  }
}
