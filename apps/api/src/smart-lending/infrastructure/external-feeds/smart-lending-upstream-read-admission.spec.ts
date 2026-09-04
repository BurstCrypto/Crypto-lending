import { parseAccountId, type AccountId } from '../../../accounts/domain/account-profile';
import {
  DISABLED_SMART_LENDING_UPSTREAM_READ_ADMISSION_POLICY,
  SMART_LENDING_SHARED_MARKET_READ_KEYS,
  SmartLendingUpstreamReadAdmission,
  SmartLendingUpstreamReadAdmissionConfigurationError,
  SmartLendingUpstreamReadAdmissionError,
  type SmartLendingAccountScopedLifiPolicy,
  type SmartLendingAccountScopedReadRequest,
  type SmartLendingMonotonicClock,
  type SmartLendingSharedMarketReadRequest,
  type SmartLendingUpstreamDestinationPolicy,
  type SmartLendingUpstreamReadAdmissionErrorCode,
  type SmartLendingUpstreamReadAdmissionPolicy,
  type SmartLendingUpstreamReadBudgetPolicy,
} from './smart-lending-upstream-read-admission';
import { SmartLendingExternalFeedDestination } from './smart-lending-external-feed.types';

const ACCOUNT_ONE = parseAccountId('00000000-0000-4000-8000-000000000001');
const ACCOUNT_TWO = parseAccountId('00000000-0000-4000-8000-000000000002');
const ACCOUNT_THREE = parseAccountId('00000000-0000-4000-8000-000000000003');
const ACCOUNT_FOUR = parseAccountId('00000000-0000-4000-8000-000000000004');

interface PolicyOverrides {
  readonly global?: Partial<SmartLendingUpstreamReadBudgetPolicy>;
  readonly account?: Partial<SmartLendingAccountScopedLifiPolicy>;
  readonly aave?: Partial<SmartLendingUpstreamDestinationPolicy>;
  readonly defiLlama?: Partial<SmartLendingUpstreamDestinationPolicy>;
  readonly lifi?: Partial<SmartLendingUpstreamDestinationPolicy>;
}

function budget(
  overrides: Partial<SmartLendingUpstreamReadBudgetPolicy> = {},
): SmartLendingUpstreamReadBudgetPolicy {
  return {
    maximumConcurrentRequests: 8,
    maximumInFlightWorkloadUnits: 100,
    rateWindowMilliseconds: 1_000,
    maximumStartsPerWindow: 20,
    maximumWorkloadUnitsPerWindow: 100,
    ...overrides,
  };
}

function destinationPolicy(
  overrides: Partial<SmartLendingUpstreamDestinationPolicy> = {},
): SmartLendingUpstreamDestinationPolicy {
  return {
    ...budget(overrides),
    timeoutMilliseconds: 10_000,
    circuitFailureThreshold: 3,
    circuitOpenMilliseconds: 1_000,
    ...overrides,
  };
}

function enabledPolicy(overrides: PolicyOverrides = {}): SmartLendingUpstreamReadAdmissionPolicy {
  return {
    mode: 'enabled',
    global: budget(overrides.global),
    accountScopedLifi: {
      ...budget(overrides.account),
      maximumTrackedAccounts: 20,
      ...overrides.account,
    },
    destinations: {
      [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: destinationPolicy(overrides.aave),
      [SmartLendingExternalFeedDestination.DefiLlamaYields]: destinationPolicy(overrides.defiLlama),
      [SmartLendingExternalFeedDestination.LifiQuote]: destinationPolicy(overrides.lifi),
    },
  };
}

function manualClock(initial = 0): Readonly<{
  clock: SmartLendingMonotonicClock;
  set(value: number): void;
}> {
  let value = initial;
  return Object.freeze({
    clock: Object.freeze({ nowMilliseconds: (): number => value }),
    set: (next: number): void => {
      value = next;
    },
  });
}

function controllable<Value>(): Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}> {
  let resolvePromise: ((value: Value) => void) | null = null;
  let rejectPromise: ((reason: unknown) => void) | null = null;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({
    promise,
    resolve: (value: Value): void => {
      if (!resolvePromise) throw new Error('test promise is not initialized');
      resolvePromise(value);
    },
    reject: (reason: unknown): void => {
      if (!rejectPromise) throw new Error('test promise is not initialized');
      rejectPromise(reason);
    },
  });
}

function aaveRequest(workloadUnits = 1, signal?: AbortSignal): SmartLendingSharedMarketReadRequest {
  const request = {
    destination: SmartLendingExternalFeedDestination.AaveV3EthereumMarket,
    readKey:
      SMART_LENDING_SHARED_MARKET_READ_KEYS[
        SmartLendingExternalFeedDestination.AaveV3EthereumMarket
      ],
    workloadUnits,
  } as const;
  return signal ? { ...request, signal } : request;
}

function defiLlamaRequest(
  workloadUnits = 1,
  signal?: AbortSignal,
): SmartLendingSharedMarketReadRequest {
  const request = {
    destination: SmartLendingExternalFeedDestination.DefiLlamaYields,
    readKey:
      SMART_LENDING_SHARED_MARKET_READ_KEYS[SmartLendingExternalFeedDestination.DefiLlamaYields],
    workloadUnits,
  } as const;
  return signal ? { ...request, signal } : request;
}

function lifiRequest(
  accountId: AccountId,
  workloadUnits = 1,
  signal?: AbortSignal,
): SmartLendingAccountScopedReadRequest {
  const request = {
    destination: SmartLendingExternalFeedDestination.LifiQuote,
    accountId,
    workloadUnits,
  } as const;
  return signal ? { ...request, signal } : request;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function expectAdmissionCode(
  promise: Promise<unknown>,
  code: SmartLendingUpstreamReadAdmissionErrorCode,
): Promise<SmartLendingUpstreamReadAdmissionError> {
  const result = await promise.then(
    () => Object.freeze({ resolved: true as const, error: null }),
    (error: unknown) => Object.freeze({ resolved: false as const, error }),
  );
  expect(result.resolved).toBe(false);
  if (result.resolved) throw new Error(`expected ${code}`);
  expect(result.error).toBeInstanceOf(SmartLendingUpstreamReadAdmissionError);
  const error = result.error as SmartLendingUpstreamReadAdmissionError;
  expect(error).toMatchObject({
    code,
    message: 'Smart-lending upstream read is unavailable',
  });
  expect(Object.isFrozen(error)).toBe(true);
  expect(Object.hasOwn(error, 'cause')).toBe(false);
  return error;
}

describe('SmartLendingUpstreamReadAdmission', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is deeply fail-closed by default and never invokes an upstream operation', async () => {
    expect(DISABLED_SMART_LENDING_UPSTREAM_READ_ADMISSION_POLICY).toEqual({
      mode: 'disabled',
      global: {
        maximumConcurrentRequests: 0,
        maximumInFlightWorkloadUnits: 0,
        rateWindowMilliseconds: 0,
        maximumStartsPerWindow: 0,
        maximumWorkloadUnitsPerWindow: 0,
      },
      accountScopedLifi: {
        maximumConcurrentRequests: 0,
        maximumInFlightWorkloadUnits: 0,
        rateWindowMilliseconds: 0,
        maximumStartsPerWindow: 0,
        maximumWorkloadUnitsPerWindow: 0,
        maximumTrackedAccounts: 0,
      },
      destinations: expect.any(Object),
    });
    expect(Object.isFrozen(DISABLED_SMART_LENDING_UPSTREAM_READ_ADMISSION_POLICY)).toBe(true);
    expect(Object.isFrozen(DISABLED_SMART_LENDING_UPSTREAM_READ_ADMISSION_POLICY.global)).toBe(
      true,
    );
    expect(
      Object.isFrozen(DISABLED_SMART_LENDING_UPSTREAM_READ_ADMISSION_POLICY.destinations),
    ).toBe(true);

    const operation = jest.fn(async () => 'unexpected');
    const admission = new SmartLendingUpstreamReadAdmission();
    await expectAdmissionCode(
      admission.readSharedMarket(aaveRequest(), operation),
      'UPSTREAM_READ_DISABLED',
    );
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_ONE), operation),
      'UPSTREAM_READ_DISABLED',
    );
    expect(operation).not.toHaveBeenCalled();
    expect(admission.snapshot()).toMatchObject({
      mode: 'disabled',
      clockHealthy: true,
      trackedAccountCount: 0,
      sharedFlightCount: 0,
    });
  });

  it('rejects non-exact, accessor-bearing, mixed-zero, fractional, and unsafe policies', () => {
    const accessorPolicy = enabledPolicy() as unknown as Record<string, unknown>;
    let accessorRead = false;
    Object.defineProperty(accessorPolicy, 'global', {
      enumerable: true,
      get: () => {
        accessorRead = true;
        return budget();
      },
    });
    const symbolPolicy = enabledPolicy() as unknown as Record<PropertyKey, unknown>;
    symbolPolicy[Symbol('hidden')] = 'value';

    const invalidPolicies: unknown[] = [
      accessorPolicy,
      symbolPolicy,
      enabledPolicy({ global: { maximumConcurrentRequests: 0 } }),
      enabledPolicy({ global: { maximumConcurrentRequests: 1.5 } }),
      enabledPolicy({ global: { maximumInFlightWorkloadUnits: Number.MAX_SAFE_INTEGER } }),
      enabledPolicy({ global: { rateWindowMilliseconds: 99 } }),
      enabledPolicy({ lifi: { timeoutMilliseconds: 0 } }),
      { ...enabledPolicy(), unexpected: 'https://attacker.invalid' },
    ];

    for (const policy of invalidPolicies) {
      expect(() => new SmartLendingUpstreamReadAdmission(policy as never)).toThrow(
        SmartLendingUpstreamReadAdmissionConfigurationError,
      );
    }
    expect(accessorRead).toBe(false);
  });

  it('copies policy values and accepts exact safe upper request-unit bounds', async () => {
    const input = enabledPolicy({
      global: {
        maximumInFlightWorkloadUnits: 1_000_000_000,
        maximumWorkloadUnitsPerWindow: 1_000_000_000,
      },
      aave: {
        maximumInFlightWorkloadUnits: 1_000_000_000,
        maximumWorkloadUnitsPerWindow: 1_000_000_000,
      },
    });
    const admission = new SmartLendingUpstreamReadAdmission(input);
    (input.global as { maximumConcurrentRequests: number }).maximumConcurrentRequests = 0;

    await expect(
      admission.readSharedMarket(aaveRequest(1_000_000), async () => 'ok'),
    ).resolves.toBe('ok');
    await expectAdmissionCode(
      admission.readSharedMarket(aaveRequest(1_000_001) as never, async () => 'unexpected'),
      'INVALID_ADMISSION_REQUEST',
    );
  });

  it('rejects malformed or personalized shared requests before invoking operations', async () => {
    const admission = new SmartLendingUpstreamReadAdmission(enabledPolicy());
    const operation = jest.fn(async () => 'unexpected');
    const invalidRequests: unknown[] = [
      { ...aaveRequest(), readKey: 'attacker-controlled' },
      { ...aaveRequest(), workloadUnits: 0 },
      { ...aaveRequest(), workloadUnits: 1.5 },
      { ...aaveRequest(), signal: {} },
      { ...aaveRequest(), url: 'https://attacker.invalid' },
      {
        destination: SmartLendingExternalFeedDestination.LifiQuote,
        readKey: 'account-personal-quote',
        workloadUnits: 1,
      },
      Object.create(aaveRequest()),
    ];

    for (const request of invalidRequests) {
      await expectAdmissionCode(
        admission.readSharedMarket(request as never, operation),
        'INVALID_ADMISSION_REQUEST',
      );
    }

    let accessorRead = false;
    const accessorRequest = Object.defineProperty(
      {
        destination: SmartLendingExternalFeedDestination.AaveV3EthereumMarket,
        workloadUnits: 1,
      },
      'readKey',
      {
        enumerable: true,
        get: () => {
          accessorRead = true;
          return SMART_LENDING_SHARED_MARKET_READ_KEYS.AAVE_V3_ETHEREUM_MARKET;
        },
      },
    );
    await expectAdmissionCode(
      admission.readSharedMarket(accessorRequest as never, operation),
      'INVALID_ADMISSION_REQUEST',
    );
    expect(accessorRead).toBe(false);
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects malformed account scope and pre-aborted callers without reserving capacity', async () => {
    const admission = new SmartLendingUpstreamReadAdmission(enabledPolicy());
    const operation = jest.fn(async () => 'unexpected');
    await expectAdmissionCode(
      admission.readAccountScoped(
        {
          ...lifiRequest(ACCOUNT_ONE),
          accountId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        } as never,
        operation,
      ),
      'INVALID_ADMISSION_REQUEST',
    );
    await expectAdmissionCode(
      admission.readAccountScoped(
        {
          ...lifiRequest(ACCOUNT_ONE),
          destination: SmartLendingExternalFeedDestination.AaveV3EthereumMarket,
        } as never,
        operation,
      ),
      'INVALID_ADMISSION_REQUEST',
    );
    const controller = new AbortController();
    controller.abort();
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 1, controller.signal), operation),
      'CALLER_ABORTED',
    );
    expect(operation).not.toHaveBeenCalled();
    expect(admission.snapshot().global).toMatchObject({
      inFlightRequests: 0,
      retainedStarts: 0,
    });
  });

  it('single-flights only shared market reads and charges one leader start and workload', async () => {
    const admission = new SmartLendingUpstreamReadAdmission(enabledPolicy());
    const upstream = controllable<Readonly<{ block: number }>>();
    const leader = jest.fn(() => upstream.promise);
    const ignoredFollower = jest.fn(async () => ({ block: 999 }));
    const reads = [admission.readSharedMarket(aaveRequest(4), leader)];
    for (let index = 0; index < 19; index += 1) {
      reads.push(admission.readSharedMarket(aaveRequest(4), ignoredFollower));
    }
    await flushMicrotasks();

    expect(leader).toHaveBeenCalledTimes(1);
    expect(ignoredFollower).not.toHaveBeenCalled();
    expect(admission.snapshot()).toMatchObject({
      global: {
        inFlightRequests: 1,
        inFlightWorkloadUnits: 4,
        retainedStarts: 1,
        retainedWorkloadUnits: 4,
      },
      sharedFlightCount: 1,
    });

    upstream.resolve(Object.freeze({ block: 123 }));
    await expect(Promise.all(reads)).resolves.toEqual(
      Array.from({ length: 20 }, () => ({ block: 123 })),
    );
    await flushMicrotasks();
    expect(admission.snapshot()).toMatchObject({
      global: { inFlightRequests: 0, retainedStarts: 1 },
      sharedFlightCount: 0,
    });

    const fresh = jest.fn(async () => ({ block: 124 }));
    await expect(admission.readSharedMarket(aaveRequest(4), fresh)).resolves.toEqual({
      block: 124,
    });
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(admission.snapshot().global.retainedStarts).toBe(2);
  });

  it('isolates shared follower cancellation from the shared upstream operation', async () => {
    const admission = new SmartLendingUpstreamReadAdmission(enabledPolicy());
    const upstream = controllable<string>();
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const operation = jest.fn(({ signal }: { signal: AbortSignal }) => {
      upstreamSignal = signal;
      return upstream.promise;
    });
    const cancelled = admission.readSharedMarket(aaveRequest(2, controller.signal), operation);
    const follower = admission.readSharedMarket(
      aaveRequest(2),
      jest.fn(async () => 'wrong'),
    );
    controller.abort();
    await expectAdmissionCode(cancelled, 'CALLER_ABORTED');
    await flushMicrotasks();

    expect(operation).toHaveBeenCalledTimes(1);
    expect(upstreamSignal?.aborted).toBe(false);
    expect(admission.snapshot().global.inFlightRequests).toBe(1);
    upstream.resolve('shared-result');
    await expect(follower).resolves.toBe('shared-result');
    expect(admission.snapshot().global.retainedStarts).toBe(1);
  });

  it('never coalesces account reads and enforces global, destination, account, and weight concurrency', async () => {
    const accountAdmission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ account: { maximumConcurrentRequests: 1 } }),
    );
    const first = controllable<string>();
    const firstRead = accountAdmission.readAccountScoped(
      lifiRequest(ACCOUNT_ONE),
      () => first.promise,
    );
    await flushMicrotasks();
    const sameAccountOperation = jest.fn(async () => 'unexpected');
    await expectAdmissionCode(
      accountAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE), sameAccountOperation),
      'CONCURRENCY_REJECTED',
    );
    expect(sameAccountOperation).not.toHaveBeenCalled();
    first.resolve('one');
    await expect(firstRead).resolves.toBe('one');

    const destinationAdmission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ lifi: { maximumConcurrentRequests: 2 } }),
    );
    const destinationOne = controllable<string>();
    const destinationTwo = controllable<string>();
    const destinationReadOne = destinationAdmission.readAccountScoped(
      lifiRequest(ACCOUNT_ONE),
      () => destinationOne.promise,
    );
    const destinationReadTwo = destinationAdmission.readAccountScoped(
      lifiRequest(ACCOUNT_TWO),
      () => destinationTwo.promise,
    );
    await flushMicrotasks();
    await expectAdmissionCode(
      destinationAdmission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'unexpected'),
      'CONCURRENCY_REJECTED',
    );
    destinationOne.resolve('one');
    destinationTwo.resolve('two');
    await Promise.all([destinationReadOne, destinationReadTwo]);

    const globalAdmission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ global: { maximumConcurrentRequests: 1 } }),
    );
    const globalPending = controllable<string>();
    const globalRead = globalAdmission.readSharedMarket(aaveRequest(), () => globalPending.promise);
    await flushMicrotasks();
    await expectAdmissionCode(
      globalAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE), async () => 'unexpected'),
      'CONCURRENCY_REJECTED',
    );
    globalPending.resolve('done');
    await globalRead;

    const weightAdmission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({
        global: { maximumInFlightWorkloadUnits: 3 },
        lifi: { maximumInFlightWorkloadUnits: 3 },
      }),
    );
    const weightedPending = controllable<string>();
    const weightedRead = weightAdmission.readAccountScoped(
      lifiRequest(ACCOUNT_ONE, 2),
      () => weightedPending.promise,
    );
    await flushMicrotasks();
    await expectAdmissionCode(
      weightAdmission.readAccountScoped(lifiRequest(ACCOUNT_TWO, 2), async () => 'unexpected'),
      'CONCURRENCY_REJECTED',
    );
    weightedPending.resolve('done');
    await weightedRead;
  });

  it('retains global, destination, and account start-rate units for the full sliding window', async () => {
    const clock = manualClock();
    const accountAdmission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ account: { maximumStartsPerWindow: 2, maximumWorkloadUnitsPerWindow: 3 } }),
      clock.clock,
    );
    await expect(
      accountAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 2), async () => 'success'),
    ).resolves.toBe('success');
    await expectAdmissionCode(
      accountAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 2), async () => 'unexpected'),
      'RATE_REJECTED',
    );
    await expectAdmissionCode(
      accountAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 1), async () => {
        throw new Error('private upstream failure');
      }),
      'UPSTREAM_FAILED',
    );
    await expectAdmissionCode(
      accountAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 1), async () => 'unexpected'),
      'RATE_REJECTED',
    );
    expect(accountAdmission.snapshot().global.retainedStarts).toBe(2);

    clock.set(999);
    await expectAdmissionCode(
      accountAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 1), async () => 'unexpected'),
      'RATE_REJECTED',
    );
    clock.set(1_000);
    await expect(
      accountAdmission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 1), async () => 'after-expiry'),
    ).resolves.toBe('after-expiry');

    const destinationAdmission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ aave: { maximumStartsPerWindow: 1 } }),
    );
    await destinationAdmission.readSharedMarket(aaveRequest(), async () => 'one');
    await expectAdmissionCode(
      destinationAdmission.readSharedMarket(aaveRequest(), async () => 'unexpected'),
      'RATE_REJECTED',
    );

    const globalAdmission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ global: { maximumStartsPerWindow: 1 } }),
    );
    await globalAdmission.readSharedMarket(aaveRequest(), async () => 'one');
    await expectAdmissionCode(
      globalAdmission.readSharedMarket(defiLlamaRequest(), async () => 'unexpected'),
      'RATE_REJECTED',
    );
  });

  it('bounds account cardinality, never evicts live windows, and omits account identifiers from snapshots', async () => {
    const clock = manualClock();
    const admission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ account: { maximumTrackedAccounts: 2 } }),
      clock.clock,
    );
    await admission.readAccountScoped(lifiRequest(ACCOUNT_TWO), async () => 'two');
    await admission.readAccountScoped(lifiRequest(ACCOUNT_ONE), async () => 'one');
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'unexpected'),
      'RATE_REJECTED',
    );
    const beforeExpiry = admission.snapshot();
    expect(beforeExpiry.trackedAccountCount).toBe(2);
    expect(JSON.stringify(beforeExpiry)).not.toContain(ACCOUNT_ONE);
    expect(JSON.stringify(beforeExpiry)).not.toContain(ACCOUNT_TWO);

    clock.set(1_000);
    await expect(
      admission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'three'),
    ).resolves.toBe('three');
    expect(admission.snapshot().trackedAccountCount).toBe(1);
  });

  it('holds physical capacity after an account timeout when the operation ignores abort', async () => {
    jest.useFakeTimers();
    const admission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({
        global: { maximumConcurrentRequests: 1 },
        lifi: { maximumConcurrentRequests: 1, timeoutMilliseconds: 50 },
      }),
    );
    const upstream = controllable<string>();
    let upstreamSignal: AbortSignal | undefined;
    const operation = jest.fn(({ signal }: { signal: AbortSignal }) => {
      upstreamSignal = signal;
      return upstream.promise;
    });
    const read = admission.readAccountScoped(lifiRequest(ACCOUNT_ONE, 3), operation);
    const observedTimeout = expectAdmissionCode(read, 'UPSTREAM_TIMEOUT');
    await flushMicrotasks();
    await jest.advanceTimersByTimeAsync(50);
    await observedTimeout;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(admission.snapshot().global).toMatchObject({
      inFlightRequests: 1,
      inFlightWorkloadUnits: 3,
      retainedStarts: 1,
      retainedWorkloadUnits: 3,
    });
    const blocked = jest.fn(async () => 'unexpected');
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_TWO), blocked),
      'CONCURRENCY_REJECTED',
    );
    expect(blocked).not.toHaveBeenCalled();

    upstream.resolve('late-success');
    await flushMicrotasks();
    expect(admission.snapshot().global).toMatchObject({
      inFlightRequests: 0,
      inFlightWorkloadUnits: 0,
      retainedStarts: 1,
    });
  });

  it('holds physical capacity after account caller abort but avoids all egress on pre-start abort', async () => {
    const admission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({
        global: { maximumConcurrentRequests: 1, maximumStartsPerWindow: 2 },
        account: { maximumStartsPerWindow: 2 },
        lifi: { maximumConcurrentRequests: 1, maximumStartsPerWindow: 2 },
      }),
    );
    const upstream = controllable<string>();
    const runningController = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const running = admission.readAccountScoped(
      lifiRequest(ACCOUNT_ONE, 2, runningController.signal),
      ({ signal }) => {
        upstreamSignal = signal;
        return upstream.promise;
      },
    );
    await flushMicrotasks();
    runningController.abort();
    await expectAdmissionCode(running, 'CALLER_ABORTED');
    expect(upstreamSignal?.aborted).toBe(true);
    expect(admission.snapshot().global.inFlightRequests).toBe(1);
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_TWO), async () => 'unexpected'),
      'CONCURRENCY_REJECTED',
    );
    upstream.resolve('late-success');
    await flushMicrotasks();
    expect(admission.snapshot().global.inFlightRequests).toBe(0);

    const preStartController = new AbortController();
    const preStartOperation = jest.fn(async () => 'unexpected');
    const preStart = admission.readAccountScoped(
      lifiRequest(ACCOUNT_THREE, 1, preStartController.signal),
      preStartOperation,
    );
    preStartController.abort();
    await expectAdmissionCode(preStart, 'CALLER_ABORTED');
    await flushMicrotasks();
    expect(preStartOperation).not.toHaveBeenCalled();
    expect(admission.snapshot().global).toMatchObject({
      inFlightRequests: 0,
      retainedStarts: 2,
      retainedWorkloadUnits: 3,
    });
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_FOUR), async () => 'unexpected'),
      'RATE_REJECTED',
    );
  });

  it('keeps a timed-out shared flight and its physical reservation until upstream really settles', async () => {
    jest.useFakeTimers();
    const admission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({
        global: { maximumConcurrentRequests: 1 },
        aave: { maximumConcurrentRequests: 1, timeoutMilliseconds: 50 },
      }),
    );
    const upstream = controllable<string>();
    const leader = jest.fn(() => upstream.promise);
    const first = admission.readSharedMarket(aaveRequest(5), leader);
    const observedTimeout = expectAdmissionCode(first, 'UPSTREAM_TIMEOUT');
    await flushMicrotasks();
    await jest.advanceTimersByTimeAsync(50);
    await observedTimeout;
    expect(admission.snapshot()).toMatchObject({
      global: { inFlightRequests: 1, inFlightWorkloadUnits: 5, retainedStarts: 1 },
      sharedFlightCount: 1,
    });

    const replacement = jest.fn(async () => 'replacement');
    await expectAdmissionCode(
      admission.readSharedMarket(aaveRequest(5), replacement),
      'UPSTREAM_TIMEOUT',
    );
    expect(replacement).not.toHaveBeenCalled();
    expect(admission.snapshot().global.retainedStarts).toBe(1);

    upstream.reject(new Error('late private rejection'));
    await flushMicrotasks();
    expect(admission.snapshot()).toMatchObject({
      global: { inFlightRequests: 0, retainedStarts: 1 },
      sharedFlightCount: 0,
    });
    await expect(admission.readSharedMarket(aaveRequest(), replacement)).resolves.toBe(
      'replacement',
    );
    expect(leader).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  it('opens, rejects, half-opens exactly once, reopens on failure, and closes on success', async () => {
    const clock = manualClock();
    const admission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ lifi: { circuitFailureThreshold: 2, circuitOpenMilliseconds: 1_000 } }),
      clock.clock,
    );
    for (let index = 0; index < 2; index += 1) {
      await expectAdmissionCode(
        admission.readAccountScoped(lifiRequest(ACCOUNT_ONE), async () => {
          throw new Error('upstream secret');
        }),
        'UPSTREAM_FAILED',
      );
    }
    expect(admission.snapshot().destinations.LIFI_QUOTE).toMatchObject({
      circuitState: 'OPEN',
      consecutiveFailures: 2,
    });
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_TWO), async () => 'unexpected'),
      'CIRCUIT_OPEN',
    );

    clock.set(1_000);
    const failedProbe = controllable<string>();
    const probe = admission.readAccountScoped(lifiRequest(ACCOUNT_TWO), () => failedProbe.promise);
    await flushMicrotasks();
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'unexpected'),
      'CIRCUIT_OPEN',
    );
    failedProbe.reject(new Error('probe failed'));
    await expectAdmissionCode(probe, 'UPSTREAM_FAILED');
    expect(admission.snapshot().destinations.LIFI_QUOTE.circuitState).toBe('OPEN');

    clock.set(2_000);
    await expect(
      admission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'healthy'),
    ).resolves.toBe('healthy');
    expect(admission.snapshot().destinations.LIFI_QUOTE).toMatchObject({
      circuitState: 'CLOSED',
      consecutiveFailures: 0,
    });
  });

  it('holds a neutral half-open permit through caller abort until physical completion', async () => {
    const clock = manualClock();
    const admission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ lifi: { circuitFailureThreshold: 1 } }),
      clock.clock,
    );
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_ONE), async () => {
        throw new Error('open');
      }),
      'UPSTREAM_FAILED',
    );
    clock.set(1_000);
    const upstream = controllable<string>();
    const controller = new AbortController();
    const probe = admission.readAccountScoped(
      lifiRequest(ACCOUNT_TWO, 1, controller.signal),
      () => upstream.promise,
    );
    await flushMicrotasks();
    controller.abort();
    await expectAdmissionCode(probe, 'CALLER_ABORTED');
    expect(admission.snapshot()).toMatchObject({
      destinations: { LIFI_QUOTE: { circuitState: 'HALF_OPEN', inFlightRequests: 1 } },
    });
    await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'unexpected'),
      'CIRCUIT_OPEN',
    );

    upstream.resolve('ignored-late-success');
    await flushMicrotasks();
    await expect(
      admission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'probe-success'),
    ).resolves.toBe('probe-success');
    expect(admission.snapshot().destinations.LIFI_QUOTE.circuitState).toBe('CLOSED');
  });

  it('ignores late outcomes from an older circuit generation', async () => {
    const clock = manualClock();
    const admission = new SmartLendingUpstreamReadAdmission(
      enabledPolicy({ lifi: { circuitFailureThreshold: 1 } }),
      clock.clock,
    );
    const oldOne = controllable<string>();
    const oldTwo = controllable<string>();
    const first = admission.readAccountScoped(lifiRequest(ACCOUNT_ONE), () => oldOne.promise);
    const second = admission.readAccountScoped(lifiRequest(ACCOUNT_TWO), () => oldTwo.promise);
    await flushMicrotasks();
    oldOne.reject(new Error('opens generation'));
    await expectAdmissionCode(first, 'UPSTREAM_FAILED');

    clock.set(1_000);
    await expect(
      admission.readAccountScoped(lifiRequest(ACCOUNT_THREE), async () => 'closes next generation'),
    ).resolves.toBe('closes next generation');
    expect(admission.snapshot().destinations.LIFI_QUOTE.circuitState).toBe('CLOSED');
    oldTwo.reject(new Error('stale failure'));
    await expectAdmissionCode(second, 'UPSTREAM_FAILED');
    expect(admission.snapshot().destinations.LIFI_QUOTE).toMatchObject({
      circuitState: 'CLOSED',
      consecutiveFailures: 0,
    });
  });

  it('fails closed permanently after a monotonic-clock rollback or invalid reading', async () => {
    const clock = manualClock(10);
    const admission = new SmartLendingUpstreamReadAdmission(enabledPolicy(), clock.clock);
    await admission.readSharedMarket(aaveRequest(), async () => 'ok');
    clock.set(9);
    const operation = jest.fn(async () => 'unexpected');
    await expectAdmissionCode(
      admission.readSharedMarket(defiLlamaRequest(), operation),
      'ADMISSION_CLOCK_INVALID',
    );
    clock.set(11);
    await expectAdmissionCode(
      admission.readSharedMarket(defiLlamaRequest(), operation),
      'ADMISSION_CLOCK_INVALID',
    );
    expect(operation).not.toHaveBeenCalled();
    expect(admission.snapshot().clockHealthy).toBe(false);

    const unsafeClock = Object.freeze({
      nowMilliseconds: (): number => Number.MAX_SAFE_INTEGER + 1,
    });
    const unsafeAdmission = new SmartLendingUpstreamReadAdmission(enabledPolicy(), unsafeClock);
    await expectAdmissionCode(
      unsafeAdmission.readSharedMarket(aaveRequest(), operation),
      'ADMISSION_CLOCK_INVALID',
    );
  });

  it('never leaks rejected request or upstream failure content through public errors or snapshots', async () => {
    const secret = 'wallet=0xdeadbeef provider-token=private';
    const admission = new SmartLendingUpstreamReadAdmission(enabledPolicy());
    const error = await expectAdmissionCode(
      admission.readAccountScoped(lifiRequest(ACCOUNT_ONE), async () => {
        throw new Error(secret);
      }),
      'UPSTREAM_FAILED',
    );
    expect(error.stack).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(admission.snapshot())).not.toContain(secret);
  });
});
