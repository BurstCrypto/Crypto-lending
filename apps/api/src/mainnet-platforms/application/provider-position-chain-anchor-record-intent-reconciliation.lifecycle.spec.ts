import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as mainnetPlatformsFeature from '../index';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
  type ProviderPositionChainAnchorRecordIntentReconciliationPort,
  type ProviderPositionChainAnchorRecordIntentReconciliationResultV1,
  type ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
} from './ports/provider-position-chain-anchor-record-intent-reconciliation.port';
import {
  DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION,
  type ProviderPositionChainAnchorRecordIntentReconciliationLifecycleDependenciesV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationLifecycleErrorCode,
  type ProviderPositionChainAnchorRecordIntentReconciliationLifecyclePolicyV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationLifecycleTimer,
  type RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1,
} from './provider-position-chain-anchor-record-intent-reconciliation.lifecycle';

const START = Date.parse('2026-09-06T18:00:00.000Z');
const INTENT_FINGERPRINT = 'a'.repeat(64);
const EVIDENCE_FINGERPRINT = 'b'.repeat(64);
const DEADLINE_BINDING_FINGERPRINT = 'c'.repeat(64);
const PRODUCER_DEADLINE_AT = '2026-09-06T17:00:05.000Z';
const EVIDENCE_RECORDED_AT = '2026-09-06T17:00:01.000Z';
const LATE_EVIDENCE_RECORDED_AT = '2026-09-06T17:00:06.000Z';
const RESOLVED_AT = '2026-09-06T17:00:07.000Z';

type ExactKeys<T, Expected> = [keyof T] extends [Expected]
  ? [Expected] extends [keyof T]
    ? true
    : false
  : false;
type ExactType<T, Expected> = [T] extends [Expected]
  ? [Expected] extends [T]
    ? true
    : false
  : false;
type ExpectedRequestKeys = 'lifecycleVersion' | 'use' | 'mayAuthorizeFinancialAction' | 'signal';
type ExpectedResultKeys =
  | 'lifecycleVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'outcome'
  | 'attemptCount'
  | 'resolvedIntentCount'
  | 'deferredCount';
type RequestKeysAreExact = ExactKeys<
  RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1,
  ExpectedRequestKeys
>;
type ResultKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1,
  ExpectedResultKeys
>;
type ResultMayAuthorizeIsFalse = ExactType<
  ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1['mayAuthorizeFinancialAction'],
  false
>;
type ResultHasSensitiveIdentity =
  Extract<
    keyof ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1,
    | 'recordIntentFingerprintSha256'
    | 'evidenceFingerprintSha256'
    | 'deadlineBindingSha256'
    | 'token'
    | 'leaseToken'
    | 'rawToken'
  > extends never
    ? false
    : true;

const REQUEST_KEYS_ARE_EXACT: RequestKeysAreExact = true;
const RESULT_KEYS_ARE_EXACT: ResultKeysAreExact = true;
const RESULT_MAY_AUTHORIZE_IS_FALSE: ResultMayAuthorizeIsFalse = true;
const RESULT_HAS_SENSITIVE_IDENTITY: ResultHasSensitiveIdentity = false;

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, members)) as Readonly<T>;
}

function idleResult(): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return frozenNullPrototype({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    outcome: 'IDLE' as const,
  });
}

function recordedResult(): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return frozenNullPrototype({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    outcome: 'RECORDED' as const,
    recordIntentFingerprintSha256: INTENT_FINGERPRINT,
    evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
    deadlineBindingSha256: DEADLINE_BINDING_FINGERPRINT,
    producerDeadlineAt: PRODUCER_DEADLINE_AT,
    evidenceRecordedAt: EVIDENCE_RECORDED_AT,
    resolvedAt: RESOLVED_AT,
  });
}

function notRecordedResult(): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return frozenNullPrototype({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    outcome: 'NOT_RECORDED' as const,
    recordIntentFingerprintSha256: INTENT_FINGERPRINT,
    evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
    producerDeadlineAt: PRODUCER_DEADLINE_AT,
    resolvedAt: RESOLVED_AT,
  });
}

function deadlineViolationResult(): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return frozenNullPrototype({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    outcome: 'DEADLINE_VIOLATION' as const,
    recordIntentFingerprintSha256: INTENT_FINGERPRINT,
    evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
    producerDeadlineAt: PRODUCER_DEADLINE_AT,
    evidenceRecordedAt: LATE_EVIDENCE_RECORDED_AT,
    resolvedAt: RESOLVED_AT,
  });
}

function deferredWithoutLease(): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return frozenNullPrototype({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    outcome: 'DEFERRED' as const,
    recordIntentFingerprintSha256: null,
    evidenceFingerprintSha256: null,
    knownIntentState: null,
    uncertainPhase: 'LEASE_RECONCILIATION' as const,
    retryNotBefore: null,
  });
}

function deferredUntil(
  milliseconds: number,
): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return frozenNullPrototype({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    outcome: 'DEFERRED' as const,
    recordIntentFingerprintSha256: INTENT_FINGERPRINT,
    evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
    knownIntentState: 'UNKNOWN' as const,
    uncertainPhase: 'RECONCILE_RECORD' as const,
    retryNotBefore: new Date(milliseconds).toISOString(),
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({
    promise,
    resolve: (value: T): void => resolvePromise?.(value),
    reject: (error: unknown): void => rejectPromise?.(error),
  });
}

class MutableClock {
  constructor(public milliseconds = START) {}

  now(): Date {
    return new Date(this.milliseconds);
  }
}

interface ScheduledTimer {
  readonly handle: number;
  readonly milliseconds: number;
  readonly callback: () => void;
  cancelled: boolean;
  fired: boolean;
}

class ManualTimer implements ProviderPositionChainAnchorRecordIntentReconciliationLifecycleTimer {
  readonly scheduled: ScheduledTimer[] = [];
  readonly cancelledHandles: unknown[] = [];
  #nextHandle = 1;

  schedule(callback: () => void, milliseconds: number): number {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.scheduled.push({ handle, milliseconds, callback, cancelled: false, fired: false });
    return handle;
  }

  cancel(handle: unknown): void {
    this.cancelledHandles.push(handle);
    const scheduled = this.scheduled.find((candidate) => candidate.handle === handle);
    if (scheduled !== undefined) scheduled.cancelled = true;
  }

  pendingWithDelay(milliseconds: number): ScheduledTimer {
    const scheduled = this.scheduled.find(
      (candidate) =>
        candidate.milliseconds === milliseconds && !candidate.cancelled && !candidate.fired,
    );
    if (scheduled === undefined) throw new Error(`No pending ${milliseconds}ms timer`);
    return scheduled;
  }

  fire(scheduled: ScheduledTimer): void {
    if (scheduled.cancelled || scheduled.fired) throw new Error('Timer is not pending');
    scheduled.fired = true;
    scheduled.callback();
  }
}

type ReconciliationHandler = (
  request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  callIndex: number,
) => Promise<ProviderPositionChainAnchorRecordIntentReconciliationResultV1>;

class IssuingReconciliation implements ProviderPositionChainAnchorRecordIntentReconciliationPort {
  readonly reconciliationVersion =
    PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION;
  readonly requests: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1[] = [];
  readonly #issued = new WeakMap<
    object,
    Readonly<{
      request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1;
      result: ProviderPositionChainAnchorRecordIntentReconciliationResultV1;
    }>
  >();

  constructor(private readonly handler: ReconciliationHandler) {}

  async reconcileNext(
    request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): Promise<unknown> {
    const callIndex = this.requests.length;
    this.requests.push(request);
    const result = await this.handler(request, callIndex);
    this.#issued.set(result, Object.freeze({ request, result }));
    return result;
  }

  reviewResult(
    capability: unknown,
    request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 | null {
    if (typeof capability !== 'object' || capability === null) return null;
    const issued = this.#issued.get(capability);
    return issued?.request === request && issued.result === capability ? issued.result : null;
  }
}

const DEFAULT_POLICY: ProviderPositionChainAnchorRecordIntentReconciliationLifecyclePolicyV1 =
  Object.freeze({ maximumWorkItems: 8, maximumRunMilliseconds: 1_000 });

interface Fixture {
  readonly clock: MutableClock;
  readonly timer: ManualTimer;
  readonly reconciliation: ProviderPositionChainAnchorRecordIntentReconciliationPort;
  readonly lifecycle: DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle;
}

function fixture(
  handler: ReconciliationHandler = async () => idleResult(),
  policy: ProviderPositionChainAnchorRecordIntentReconciliationLifecyclePolicyV1 = DEFAULT_POLICY,
  timer: ManualTimer = new ManualTimer(),
): Fixture {
  const clock = new MutableClock();
  const reconciliation = new IssuingReconciliation(handler);
  const dependencies: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleDependenciesV1 =
    Object.freeze({ reconciliation, clock, timer, policy });
  return Object.freeze({
    clock,
    timer,
    reconciliation,
    lifecycle: new DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle(
      dependencies,
    ),
  });
}

function runRequest(
  signal = new AbortController().signal,
): RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1 {
  return Object.freeze({
    lifecycleVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_USE,
    mayAuthorizeFinancialAction: false,
    signal,
  });
}

function expectedLifecycleResult(
  outcome: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1['outcome'],
  attemptCount: number,
  resolvedIntentCount: number,
  deferredCount: number,
): Readonly<ProviderPositionChainAnchorRecordIntentReconciliationLifecycleResultV1> {
  return {
    lifecycleVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_RESULT_USE,
    mayAuthorizeFinancialAction: false,
    outcome,
    attemptCount,
    resolvedIntentCount,
    deferredCount,
  };
}

function expectFrozenNullPrototype(value: unknown): void {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.getPrototypeOf(value)).toBeNull();
}

async function expectFailure(
  operation: Promise<unknown> | (() => unknown),
  code: ProviderPositionChainAnchorRecordIntentReconciliationLifecycleErrorCode,
): Promise<void> {
  const expected = expect.objectContaining({
    name: 'ProviderPositionChainAnchorRecordIntentReconciliationLifecycleError',
    code,
    message: 'Provider position chain-anchor record-intent reconciliation lifecycle is unavailable',
  });
  if (typeof operation === 'function') expect(operation).toThrow(expected);
  else await expect(operation).rejects.toEqual(expected);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle', () => {
  it('keeps exact authority-free contracts and remains absent from runtime surfaces', () => {
    const source = readFileSync(
      join(__dirname, 'provider-position-chain-anchor-record-intent-reconciliation.lifecycle.ts'),
      'utf8',
    );
    const moduleSource = readFileSync(join(__dirname, '../mainnet-platforms.module.ts'), 'utf8');

    expect(REQUEST_KEYS_ARE_EXACT).toBe(true);
    expect(RESULT_KEYS_ARE_EXACT).toBe(true);
    expect(RESULT_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(RESULT_HAS_SENSITIVE_IDENTITY).toBe(false);
    expect(mainnetPlatformsFeature).not.toHaveProperty(
      'DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle',
    );
    expect(moduleSource).not.toContain(
      'provider-position-chain-anchor-record-intent-reconciliation.lifecycle',
    );
    expect(source).not.toMatch(
      /@(?:Injectable|Module)|NestFactory|createApplicationContext|process\.env|fetch\s*\(|setTimeout|setInterval|console\s*\.|logger\s*\.|https?:\/\//u,
    );
    expect(source).not.toMatch(/(?:raw|dispatch|lease)Token|withTransaction|\.query\s*\(/u);
  });

  it('is inert at construction and descriptor-captures every injected method', async () => {
    const value = fixture();
    const reconciliation = value.reconciliation as IssuingReconciliation;
    const forbiddenReconcile = jest.fn(async () => idleResult());
    const forbiddenReview = jest.fn(() => null);
    const forbiddenClock = jest.fn(() => new Date(0));
    const forbiddenSchedule = jest.fn();
    const forbiddenCancel = jest.fn();

    expect(reconciliation.requests).toHaveLength(0);
    expect(value.timer.scheduled).toHaveLength(0);
    Object.assign(reconciliation, {
      reconcileNext: forbiddenReconcile,
      reviewResult: forbiddenReview,
    });
    Object.assign(value.clock, { now: forbiddenClock });
    Object.assign(value.timer, { schedule: forbiddenSchedule, cancel: forbiddenCancel });

    const result = await value.lifecycle.run(runRequest());

    expect(result).toEqual(expectedLifecycleResult('IDLE', 1, 0, 0));
    expectFrozenNullPrototype(result);
    expect(reconciliation.requests).toHaveLength(1);
    expect(forbiddenReconcile).not.toHaveBeenCalled();
    expect(forbiddenReview).not.toHaveBeenCalled();
    expect(forbiddenClock).not.toHaveBeenCalled();
    expect(forbiddenSchedule).not.toHaveBeenCalled();
    expect(forbiddenCancel).not.toHaveBeenCalled();
    expect(value.timer.scheduled.map(({ milliseconds }) => milliseconds)).toEqual([1_000]);
  });

  it('builds a fresh exact request, authenticates it by identity, and stops on IDLE', async () => {
    const value = fixture();
    const external = new AbortController();

    const result = await value.lifecycle.run(runRequest(external.signal));
    const reconciliation = value.reconciliation as IssuingReconciliation;
    const sent = reconciliation.requests[0];

    expect(result).toEqual(expectedLifecycleResult('IDLE', 1, 0, 0));
    expect(sent).toBeDefined();
    expect(sent).toEqual({
      reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
      mayAuthorizeFinancialAction: false,
      signal: expect.any(AbortSignal),
    });
    expectFrozenNullPrototype(sent);
    expect(sent?.signal).not.toBe(external.signal);
    expect(sent?.signal.aborted).toBe(true);
    expect(reconciliation.requests).toHaveLength(1);
  });

  it('processes authenticated terminal outcomes strictly sequentially', async () => {
    const first = deferred<ProviderPositionChainAnchorRecordIntentReconciliationResultV1>();
    let active = 0;
    let maximumActive = 0;
    const outcomes = [
      recordedResult(),
      notRecordedResult(),
      deadlineViolationResult(),
      idleResult(),
    ];
    const value = fixture(async (_request, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const result = index === 0 ? await first.promise : (outcomes[index] ?? idleResult());
      active -= 1;
      return result;
    });

    const running = value.lifecycle.run(runRequest());
    await flushMicrotasks();
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(1);
    expect(maximumActive).toBe(1);

    first.resolve(outcomes[0] ?? recordedResult());
    await expect(running).resolves.toEqual(expectedLifecycleResult('IDLE', 4, 3, 0));
    expect(maximumActive).toBe(1);
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(4);
  });

  it('waits until an authenticated future retry time without spinning', async () => {
    const value = fixture(async (_request, index) =>
      index === 0 ? deferredUntil(START + 500) : idleResult(),
    );
    const running = value.lifecycle.run(runRequest());
    await flushMicrotasks();

    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(1);
    expect(value.timer.scheduled.map(({ milliseconds }) => milliseconds)).toEqual([1_000, 500]);
    await flushMicrotasks();
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(1);

    value.clock.milliseconds += 500;
    value.timer.fire(value.timer.pendingWithDelay(500));
    await expect(running).resolves.toEqual(expectedLifecycleResult('IDLE', 2, 0, 1));
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(2);
  });

  it('enforces a minimum retry delay when retryNotBefore is already past', async () => {
    const value = fixture(async (_request, index) =>
      index === 0 ? deferredUntil(START - 1_000) : idleResult(),
    );
    const running = value.lifecycle.run(runRequest());
    await flushMicrotasks();

    expect(value.timer.scheduled.map(({ milliseconds }) => milliseconds)).toEqual([1_000, 10]);
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(1);
    value.clock.milliseconds += 10;
    value.timer.fire(value.timer.pendingWithDelay(10));

    await expect(running).resolves.toEqual(expectedLifecycleResult('IDLE', 2, 0, 1));
  });

  it('returns DEFERRED without spinning when no safe retry time exists in this run', async () => {
    for (const result of [deferredWithoutLease(), deferredUntil(START + 1_000)]) {
      const value = fixture(async () => result);
      await expect(value.lifecycle.run(runRequest())).resolves.toEqual(
        expectedLifecycleResult('DEFERRED', 1, 0, 1),
      );
      expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(1);
      expect(value.timer.scheduled).toHaveLength(1);
    }
  });

  it('stops exactly at the configured work-item limit', async () => {
    const value = fixture(async () => recordedResult(), {
      maximumWorkItems: 2,
      maximumRunMilliseconds: 1_000,
    });

    await expect(value.lifecycle.run(runRequest())).resolves.toEqual(
      expectedLifecycleResult('WORK_LIMIT_REACHED', 2, 2, 0),
    );
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(2);
  });

  it('aborts at the run deadline and drains started reconciliation before returning', async () => {
    const gate = deferred<ProviderPositionChainAnchorRecordIntentReconciliationResultV1>();
    const value = fixture(async () => gate.promise, {
      maximumWorkItems: 8,
      maximumRunMilliseconds: 100,
    });
    const running = value.lifecycle.run(runRequest());
    let settled = false;
    void running.finally(() => {
      settled = true;
    });
    await flushMicrotasks();

    const sent = (value.reconciliation as IssuingReconciliation).requests[0];
    expect(sent?.signal.aborted).toBe(false);
    value.clock.milliseconds += 100;
    value.timer.fire(value.timer.pendingWithDelay(100));
    await flushMicrotasks();
    expect(sent?.signal.aborted).toBe(true);
    expect(settled).toBe(false);

    gate.resolve(deferredWithoutLease());
    await expect(running).resolves.toEqual(
      expectedLifecycleResult('RUN_DEADLINE_REACHED', 1, 0, 0),
    );
    expect(settled).toBe(true);
  });

  it('propagates external abort, then drains started reconciliation before returning', async () => {
    const gate = deferred<ProviderPositionChainAnchorRecordIntentReconciliationResultV1>();
    const value = fixture(async () => gate.promise);
    const controller = new AbortController();
    const running = value.lifecycle.run(runRequest(controller.signal));
    let settled = false;
    void running.finally(() => {
      settled = true;
    });
    await flushMicrotasks();

    const sent = (value.reconciliation as IssuingReconciliation).requests[0];
    controller.abort();
    await flushMicrotasks();
    expect(sent?.signal.aborted).toBe(true);
    expect(settled).toBe(false);

    gate.resolve(deferredWithoutLease());
    await expect(running).resolves.toEqual(expectedLifecycleResult('ABORTED', 1, 0, 0));
    expect(settled).toBe(true);
  });

  it('does no clock, timer, or reconciliation work for a pre-aborted request', async () => {
    const value = fixture();
    const controller = new AbortController();
    controller.abort();

    await expect(value.lifecycle.run(runRequest(controller.signal))).resolves.toEqual(
      expectedLifecycleResult('ABORTED', 0, 0, 0),
    );
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(0);
    expect(value.timer.scheduled).toHaveLength(0);
  });

  it('rejects concurrent runs but can be invoked again after the first drained run', async () => {
    const gate = deferred<ProviderPositionChainAnchorRecordIntentReconciliationResultV1>();
    const value = fixture(async (_request, index) => (index === 0 ? gate.promise : idleResult()));
    const controller = new AbortController();
    const first = value.lifecycle.run(runRequest(controller.signal));
    await flushMicrotasks();

    await expectFailure(value.lifecycle.run(runRequest()), 'ALREADY_RUNNING');
    controller.abort();
    gate.resolve(deferredWithoutLease());
    await expect(first).resolves.toEqual(expectedLifecycleResult('ABORTED', 1, 0, 0));
    await expect(value.lifecycle.run(runRequest())).resolves.toEqual(
      expectedLifecycleResult('IDLE', 1, 0, 0),
    );
  });

  it('rejects unauthenticated, cloned, and malformed reviewed results', async () => {
    const idle = idleResult();
    const unauthenticated: ProviderPositionChainAnchorRecordIntentReconciliationPort = {
      reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
      reconcileNext: async () => idle,
      reviewResult: () => null,
    };
    const cloneReview: ProviderPositionChainAnchorRecordIntentReconciliationPort = {
      reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
      reconcileNext: async () => idle,
      reviewResult: () => structuredClone(idle),
    };
    const malformed = frozenNullPrototype({ ...idle, unexpected: 'private-value' });
    const malformedReview: ProviderPositionChainAnchorRecordIntentReconciliationPort = {
      reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
      reconcileNext: async () => malformed,
      reviewResult: (capability) =>
        capability as ProviderPositionChainAnchorRecordIntentReconciliationResultV1,
    };

    for (const reconciliation of [unauthenticated, cloneReview, malformedReview]) {
      const value = fixture();
      const lifecycle = new DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle({
        reconciliation,
        clock: value.clock,
        timer: value.timer,
        policy: DEFAULT_POLICY,
      });
      await expectFailure(lifecycle.run(runRequest()), 'RESULT_AUTHENTICATION_FAILED');
    }
  });

  it('sanitizes reconciliation, clock, and timer failures', async () => {
    const secret = `${INTENT_FINGERPRINT}:postgresql://credential@private-host`;
    const rejected = fixture(async () => {
      throw new Error(secret);
    });
    await expectFailure(rejected.lifecycle.run(runRequest()), 'RECONCILIATION_UNAVAILABLE');

    const invalidClock = fixture();
    invalidClock.clock.milliseconds = Number.NaN;
    await expectFailure(invalidClock.lifecycle.run(runRequest()), 'CLOCK_UNAVAILABLE');

    const earlyTimer = fixture(async (_request, index) =>
      index === 0 ? deferredUntil(START + 100) : idleResult(),
    );
    const earlyRun = earlyTimer.lifecycle.run(runRequest());
    await flushMicrotasks();
    earlyTimer.timer.fire(earlyTimer.timer.pendingWithDelay(100));
    await expectFailure(earlyRun, 'TIMER_UNAVAILABLE');

    for (const error of [
      rejected.lifecycle.run(runRequest()),
      invalidClock.lifecycle.run(runRequest()),
    ]) {
      await error.catch((failure: unknown) => {
        expect(String(failure)).not.toContain(secret);
      });
    }
  });

  it('rejects a synchronously reentrant retry timer before another reconciliation call', async () => {
    class SynchronousRetryTimer extends ManualTimer {
      override schedule(callback: () => void, milliseconds: number): number {
        const handle = super.schedule(callback, milliseconds);
        if (this.scheduled.length === 2) callback();
        return handle;
      }
    }
    const value = fixture(
      async (_request, index) => (index === 0 ? deferredUntil(START + 100) : idleResult()),
      DEFAULT_POLICY,
      new SynchronousRetryTimer(),
    );

    await expectFailure(value.lifecycle.run(runRequest()), 'TIMER_UNAVAILABLE');
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(1);
    expect(value.timer.scheduled.map(({ milliseconds }) => milliseconds)).toEqual([1_000, 100]);
  });

  it('rejects invalid configuration, accessors, proxies, and policy bounds before work', async () => {
    const value = fixture();
    const validDependencies = {
      reconciliation: value.reconciliation,
      clock: value.clock,
      timer: value.timer,
      policy: DEFAULT_POLICY,
    };
    for (const policy of [
      { maximumWorkItems: 0, maximumRunMilliseconds: 1_000 },
      { maximumWorkItems: 65, maximumRunMilliseconds: 1_000 },
      { maximumWorkItems: 1.5, maximumRunMilliseconds: 1_000 },
      { maximumWorkItems: 1, maximumRunMilliseconds: 9 },
      { maximumWorkItems: 1, maximumRunMilliseconds: 30_001 },
    ]) {
      await expectFailure(
        () =>
          new DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle({
            ...validDependencies,
            policy,
          }),
        'INVALID_CONFIGURATION',
      );
    }

    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'now', { get: jest.fn(() => () => new Date(START)) });
    for (const dependencies of [
      { ...validDependencies, reconciliation: new Proxy(value.reconciliation, {}) },
      { ...validDependencies, clock: accessor },
      { ...validDependencies, timer: new Proxy(value.timer, {}) },
      { ...validDependencies, unexpected: true },
    ]) {
      await expectFailure(
        () =>
          new DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle(
            dependencies as ProviderPositionChainAnchorRecordIntentReconciliationLifecycleDependenciesV1,
          ),
        'INVALID_CONFIGURATION',
      );
    }
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(0);
    expect(value.timer.scheduled).toHaveLength(0);
  });

  it('rejects malformed run requests before any timer or reconciliation call', async () => {
    const value = fixture();
    const valid = runRequest();
    for (const malformed of [
      { ...valid, lifecycleVersion: 2 },
      { ...valid, use: 'FINANCIAL' },
      { ...valid, mayAuthorizeFinancialAction: true },
      { ...valid, signal: Object.freeze({ aborted: false }) },
      { ...valid, extra: true },
      new Proxy(valid, {}),
    ]) {
      await expectFailure(
        value.lifecycle.run(
          Object.freeze(
            malformed,
          ) as RunProviderPositionChainAnchorRecordIntentReconciliationLifecycleRequestV1,
        ),
        'INVALID_REQUEST',
      );
    }
    expect((value.reconciliation as IssuingReconciliation).requests).toHaveLength(0);
    expect(value.timer.scheduled).toHaveLength(0);
  });

  it('rejects a regressing clock and deadline or cleanup timer failures', async () => {
    const regressing = fixture(async () => recordedResult());
    const regressingPort = regressing.reconciliation as IssuingReconciliation;
    const original = regressingPort.reconcileNext.bind(regressingPort);
    Object.assign(regressingPort, {
      reconcileNext: async (
        request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
      ): Promise<unknown> => {
        const result = await original(request);
        regressing.clock.milliseconds = START - 1;
        return result;
      },
    });
    // Method capture occurs when the lifecycle is constructed, so build a new
    // lifecycle after installing this deliberate clock-regression adapter.
    const regressingLifecycle =
      new DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle({
        reconciliation: regressingPort,
        clock: regressing.clock,
        timer: regressing.timer,
        policy: DEFAULT_POLICY,
      });
    await expectFailure(regressingLifecycle.run(runRequest()), 'CLOCK_UNAVAILABLE');

    class ThrowingCancelTimer extends ManualTimer {
      override cancel(): void {
        throw new Error('private timer handle');
      }
    }
    const cleanup = fixture(async () => idleResult(), DEFAULT_POLICY, new ThrowingCancelTimer());
    await expectFailure(cleanup.lifecycle.run(runRequest()), 'TIMER_UNAVAILABLE');

    class EarlyDeadlineTimer extends ManualTimer {
      override schedule(callback: () => void, milliseconds: number): number {
        const handle = super.schedule(callback, milliseconds);
        callback();
        return handle;
      }
    }
    const earlyDeadline = fixture(
      async () => idleResult(),
      DEFAULT_POLICY,
      new EarlyDeadlineTimer(),
    );
    await expectFailure(earlyDeadline.lifecycle.run(runRequest()), 'TIMER_UNAVAILABLE');
  });
});
