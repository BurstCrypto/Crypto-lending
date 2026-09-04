import { performance } from 'node:perf_hooks';

import { parseAccountId, type AccountId } from '../../../accounts/domain/account-profile';
import { SmartLendingExternalFeedDestination } from './smart-lending-external-feed.types';

const MAX_CONCURRENT_REQUESTS = 1_024;
const MAX_WORKLOAD_UNITS = 1_000_000_000;
const MAX_REQUEST_WORKLOAD_UNITS = 1_000_000;
const MAX_STARTS_PER_WINDOW = 1_000_000;
const MIN_RATE_WINDOW_MILLISECONDS = 100;
const MAX_RATE_WINDOW_MILLISECONDS = 3_600_000;
const MAX_TIMEOUT_MILLISECONDS = 60_000;
const MAX_CIRCUIT_FAILURE_THRESHOLD = 100;
const MAX_TRACKED_ACCOUNTS = 100_000;

const ALL_DESTINATIONS = Object.freeze([
  SmartLendingExternalFeedDestination.AaveV3EthereumMarket,
  SmartLendingExternalFeedDestination.DefiLlamaYields,
  SmartLendingExternalFeedDestination.LifiQuote,
] as const);

export type SmartLendingSharedMarketDestination =
  | SmartLendingExternalFeedDestination.AaveV3EthereumMarket
  | SmartLendingExternalFeedDestination.DefiLlamaYields;

export const SMART_LENDING_SHARED_MARKET_READ_KEYS = Object.freeze({
  [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: 'aave-v3-ethereum-core-market-v1',
  [SmartLendingExternalFeedDestination.DefiLlamaYields]:
    'defillama-ethereum-solana-market-universe-v1',
} as const);

type SharedMarketReadKeyByDestination = typeof SMART_LENDING_SHARED_MARKET_READ_KEYS;

export type SmartLendingSharedMarketReadRequest = {
  readonly [Destination in SmartLendingSharedMarketDestination]: Readonly<{
    destination: Destination;
    readKey: SharedMarketReadKeyByDestination[Destination];
    /** Operator-defined relative workload only; this is not money or provider billing. */
    workloadUnits: number;
    signal?: AbortSignal;
  }>;
}[SmartLendingSharedMarketDestination];

export interface SmartLendingAccountScopedReadRequest {
  readonly destination: SmartLendingExternalFeedDestination.LifiQuote;
  readonly accountId: AccountId;
  /** Operator-defined relative workload only; this is not money or provider billing. */
  readonly workloadUnits: number;
  readonly signal?: AbortSignal;
}

export interface SmartLendingUpstreamReadExecutionContext {
  readonly signal: AbortSignal;
}

export type SmartLendingUpstreamReadOperation<Value> = (
  context: SmartLendingUpstreamReadExecutionContext,
) => Promise<Value>;

export interface SmartLendingUpstreamReadBudgetPolicy {
  readonly maximumConcurrentRequests: number;
  readonly maximumInFlightWorkloadUnits: number;
  readonly rateWindowMilliseconds: number;
  readonly maximumStartsPerWindow: number;
  readonly maximumWorkloadUnitsPerWindow: number;
}

export interface SmartLendingUpstreamDestinationPolicy extends SmartLendingUpstreamReadBudgetPolicy {
  readonly timeoutMilliseconds: number;
  readonly circuitFailureThreshold: number;
  readonly circuitOpenMilliseconds: number;
}

export interface SmartLendingAccountScopedLifiPolicy extends SmartLendingUpstreamReadBudgetPolicy {
  readonly maximumTrackedAccounts: number;
}

export interface SmartLendingUpstreamReadAdmissionPolicy {
  readonly mode: 'disabled' | 'enabled';
  readonly global: SmartLendingUpstreamReadBudgetPolicy;
  readonly accountScopedLifi: SmartLendingAccountScopedLifiPolicy;
  readonly destinations: Readonly<
    Record<SmartLendingExternalFeedDestination, SmartLendingUpstreamDestinationPolicy>
  >;
}

const ZERO_BUDGET: SmartLendingUpstreamReadBudgetPolicy = Object.freeze({
  maximumConcurrentRequests: 0,
  maximumInFlightWorkloadUnits: 0,
  rateWindowMilliseconds: 0,
  maximumStartsPerWindow: 0,
  maximumWorkloadUnitsPerWindow: 0,
});

const ZERO_DESTINATION_POLICY: SmartLendingUpstreamDestinationPolicy = Object.freeze({
  ...ZERO_BUDGET,
  timeoutMilliseconds: 0,
  circuitFailureThreshold: 0,
  circuitOpenMilliseconds: 0,
});

export const DISABLED_SMART_LENDING_UPSTREAM_READ_ADMISSION_POLICY: SmartLendingUpstreamReadAdmissionPolicy =
  Object.freeze({
    mode: 'disabled',
    global: ZERO_BUDGET,
    accountScopedLifi: Object.freeze({
      ...ZERO_BUDGET,
      maximumTrackedAccounts: 0,
    }),
    destinations: Object.freeze({
      [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: ZERO_DESTINATION_POLICY,
      [SmartLendingExternalFeedDestination.DefiLlamaYields]: ZERO_DESTINATION_POLICY,
      [SmartLendingExternalFeedDestination.LifiQuote]: ZERO_DESTINATION_POLICY,
    }),
  });

export type SmartLendingUpstreamReadAdmissionErrorCode =
  | 'UPSTREAM_READ_DISABLED'
  | 'INVALID_ADMISSION_REQUEST'
  | 'CONCURRENCY_REJECTED'
  | 'RATE_REJECTED'
  | 'CIRCUIT_OPEN'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_FAILED'
  | 'CALLER_ABORTED'
  | 'ADMISSION_CLOCK_INVALID';

export class SmartLendingUpstreamReadAdmissionError extends Error {
  constructor(readonly code: SmartLendingUpstreamReadAdmissionErrorCode) {
    super('Smart-lending upstream read is unavailable');
    this.name = 'SmartLendingUpstreamReadAdmissionError';
    Object.freeze(this);
  }
}

export class SmartLendingUpstreamReadAdmissionConfigurationError extends Error {
  constructor() {
    super('Invalid smart-lending upstream-read admission policy');
    this.name = 'SmartLendingUpstreamReadAdmissionConfigurationError';
    Object.freeze(this);
  }
}

export interface SmartLendingMonotonicClock {
  nowMilliseconds(): number;
}

export const SYSTEM_SMART_LENDING_MONOTONIC_CLOCK: SmartLendingMonotonicClock = Object.freeze({
  nowMilliseconds: () => Math.floor(performance.now()),
});

export type SmartLendingUpstreamCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface SmartLendingUpstreamReadAdmissionSnapshot {
  readonly mode: 'disabled' | 'enabled';
  readonly clockHealthy: boolean;
  readonly global: Readonly<{
    inFlightRequests: number;
    inFlightWorkloadUnits: number;
    retainedStarts: number;
    retainedWorkloadUnits: number;
  }>;
  readonly destinations: Readonly<
    Record<
      SmartLendingExternalFeedDestination,
      Readonly<{
        circuitState: SmartLendingUpstreamCircuitState;
        consecutiveFailures: number;
        inFlightRequests: number;
        inFlightWorkloadUnits: number;
        retainedStarts: number;
        retainedWorkloadUnits: number;
      }>
    >
  >;
  readonly trackedAccountCount: number;
  readonly sharedFlightCount: number;
}

interface RateEntry {
  readonly startedAt: number;
  readonly workloadUnits: number;
}

interface BudgetState {
  inFlightRequests: number;
  inFlightWorkloadUnits: number;
  rateEntries: RateEntry[];
  retainedWorkloadUnits: number;
}

interface CircuitState {
  phase: SmartLendingUpstreamCircuitState;
  consecutiveFailures: number;
  generation: number;
  openUntil: number;
  halfOpenProbeInFlight: boolean;
}

interface DestinationState extends BudgetState {
  readonly circuit: CircuitState;
}

interface CircuitPermit {
  readonly generation: number;
  readonly phase: 'CLOSED' | 'HALF_OPEN';
}

interface Reservation {
  readonly destination: SmartLendingExternalFeedDestination;
  readonly workloadUnits: number;
  readonly accountId: AccountId | null;
  readonly circuitPermit: CircuitPermit;
  circuitDisposition: 'PENDING' | 'RECORDED' | 'NEUTRAL';
  physicalReleased: boolean;
}

type InternalOutcome<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{
      ok: false;
      code: 'UPSTREAM_TIMEOUT' | 'UPSTREAM_FAILED' | 'CALLER_ABORTED' | 'ADMISSION_CLOCK_INVALID';
    }>;

interface LeaderExecution<Value> {
  readonly outcome: Promise<InternalOutcome<Value>>;
  readonly physicalCompletion: Promise<void>;
  isPhysicallyComplete(): boolean;
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | null = null;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve: (value: Value): void => {
      if (resolvePromise === null) throw new Error('invalid deferred state');
      resolvePromise(value);
    },
  });
}

const BUDGET_KEYS = Object.freeze([
  'maximumConcurrentRequests',
  'maximumInFlightWorkloadUnits',
  'rateWindowMilliseconds',
  'maximumStartsPerWindow',
  'maximumWorkloadUnitsPerWindow',
] as const);
const DESTINATION_POLICY_KEYS = Object.freeze([
  ...BUDGET_KEYS,
  'timeoutMilliseconds',
  'circuitFailureThreshold',
  'circuitOpenMilliseconds',
] as const);
const ACCOUNT_POLICY_KEYS = Object.freeze([...BUDGET_KEYS, 'maximumTrackedAccounts'] as const);

function configurationError(): never {
  throw new SmartLendingUpstreamReadAdmissionConfigurationError();
}

function admissionError(code: SmartLendingUpstreamReadAdmissionErrorCode): never {
  throw new SmartLendingUpstreamReadAdmissionError(code);
}

function exactDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) configurationError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) configurationError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) =>
          typeof key !== 'string' || (!requiredKeys.includes(key) && !optionalKeys.includes(key)),
      ) ||
      requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(
        (descriptor) => !descriptor.enumerable || !('value' in descriptor),
      )
    ) {
      configurationError();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) configurationError();
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof SmartLendingUpstreamReadAdmissionConfigurationError) throw error;
    return configurationError();
  }
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    configurationError();
  }
  return value as number;
}

function isZeroBudget(record: Readonly<Record<string, unknown>>): boolean {
  return BUDGET_KEYS.every((key) => record[key] === 0);
}

function parseBudget(
  value: unknown,
  keys: readonly string[],
): SmartLendingUpstreamReadBudgetPolicy {
  const record = exactDataRecord(value, keys);
  const zero = isZeroBudget(record);
  return Object.freeze({
    maximumConcurrentRequests: safeInteger(
      record.maximumConcurrentRequests,
      zero ? 0 : 1,
      MAX_CONCURRENT_REQUESTS,
    ),
    maximumInFlightWorkloadUnits: safeInteger(
      record.maximumInFlightWorkloadUnits,
      zero ? 0 : 1,
      MAX_WORKLOAD_UNITS,
    ),
    rateWindowMilliseconds: safeInteger(
      record.rateWindowMilliseconds,
      zero ? 0 : MIN_RATE_WINDOW_MILLISECONDS,
      MAX_RATE_WINDOW_MILLISECONDS,
    ),
    maximumStartsPerWindow: safeInteger(
      record.maximumStartsPerWindow,
      zero ? 0 : 1,
      MAX_STARTS_PER_WINDOW,
    ),
    maximumWorkloadUnitsPerWindow: safeInteger(
      record.maximumWorkloadUnitsPerWindow,
      zero ? 0 : 1,
      MAX_WORKLOAD_UNITS,
    ),
  });
}

function parseDestinationPolicy(value: unknown): SmartLendingUpstreamDestinationPolicy {
  const record = exactDataRecord(value, DESTINATION_POLICY_KEYS);
  const budget = parseBudget(record, DESTINATION_POLICY_KEYS);
  const disabled = budget.maximumConcurrentRequests === 0;
  const timeoutMilliseconds = safeInteger(
    record.timeoutMilliseconds,
    disabled ? 0 : 1,
    MAX_TIMEOUT_MILLISECONDS,
  );
  const circuitFailureThreshold = safeInteger(
    record.circuitFailureThreshold,
    disabled ? 0 : 1,
    MAX_CIRCUIT_FAILURE_THRESHOLD,
  );
  const circuitOpenMilliseconds = safeInteger(
    record.circuitOpenMilliseconds,
    disabled ? 0 : MIN_RATE_WINDOW_MILLISECONDS,
    MAX_RATE_WINDOW_MILLISECONDS,
  );
  if (
    disabled !==
    (timeoutMilliseconds === 0 && circuitFailureThreshold === 0 && circuitOpenMilliseconds === 0)
  ) {
    configurationError();
  }
  return Object.freeze({
    ...budget,
    timeoutMilliseconds,
    circuitFailureThreshold,
    circuitOpenMilliseconds,
  });
}

function parseAccountPolicy(value: unknown): SmartLendingAccountScopedLifiPolicy {
  const record = exactDataRecord(value, ACCOUNT_POLICY_KEYS);
  const budget = parseBudget(record, ACCOUNT_POLICY_KEYS);
  const maximumTrackedAccounts = safeInteger(
    record.maximumTrackedAccounts,
    budget.maximumConcurrentRequests === 0 ? 0 : 1,
    MAX_TRACKED_ACCOUNTS,
  );
  if ((budget.maximumConcurrentRequests === 0) !== (maximumTrackedAccounts === 0)) {
    configurationError();
  }
  return Object.freeze({ ...budget, maximumTrackedAccounts });
}

function parsePolicy(value: unknown): SmartLendingUpstreamReadAdmissionPolicy {
  const record = exactDataRecord(value, ['mode', 'global', 'accountScopedLifi', 'destinations']);
  if (record.mode !== 'disabled' && record.mode !== 'enabled') configurationError();
  const global = parseBudget(record.global, BUDGET_KEYS);
  const accountScopedLifi = parseAccountPolicy(record.accountScopedLifi);
  const destinationRecord = exactDataRecord(record.destinations, ALL_DESTINATIONS);
  const destinations = Object.freeze({
    [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: parseDestinationPolicy(
      destinationRecord[SmartLendingExternalFeedDestination.AaveV3EthereumMarket],
    ),
    [SmartLendingExternalFeedDestination.DefiLlamaYields]: parseDestinationPolicy(
      destinationRecord[SmartLendingExternalFeedDestination.DefiLlamaYields],
    ),
    [SmartLendingExternalFeedDestination.LifiQuote]: parseDestinationPolicy(
      destinationRecord[SmartLendingExternalFeedDestination.LifiQuote],
    ),
  });
  const enabledDestinations = ALL_DESTINATIONS.filter(
    (destination) => destinations[destination].maximumConcurrentRequests > 0,
  );
  if (record.mode === 'disabled') {
    if (
      global.maximumConcurrentRequests !== 0 ||
      accountScopedLifi.maximumConcurrentRequests !== 0 ||
      enabledDestinations.length !== 0
    ) {
      configurationError();
    }
  } else if (
    global.maximumConcurrentRequests === 0 ||
    enabledDestinations.length === 0 ||
    destinations[SmartLendingExternalFeedDestination.LifiQuote].maximumConcurrentRequests > 0 !==
      accountScopedLifi.maximumConcurrentRequests > 0
  ) {
    configurationError();
  }
  return Object.freeze({ mode: record.mode, global, accountScopedLifi, destinations });
}

function budgetState(): BudgetState {
  return {
    inFlightRequests: 0,
    inFlightWorkloadUnits: 0,
    rateEntries: [],
    retainedWorkloadUnits: 0,
  };
}

function destinationState(): DestinationState {
  return {
    ...budgetState(),
    circuit: {
      phase: 'CLOSED',
      consecutiveFailures: 0,
      generation: 0,
      openUntil: 0,
      halfOpenProbeInFlight: false,
    },
  };
}

function purgeRateWindow(
  state: BudgetState,
  policy: SmartLendingUpstreamReadBudgetPolicy,
  now: number,
): void {
  if (state.rateEntries.length === 0) return;
  const cutoff = now - policy.rateWindowMilliseconds;
  let expired = 0;
  let expiredUnits = 0;
  while (expired < state.rateEntries.length) {
    const entry = state.rateEntries[expired];
    if (!entry || entry.startedAt > cutoff) break;
    expiredUnits += entry.workloadUnits;
    expired += 1;
  }
  if (expired === 0) return;
  state.rateEntries = state.rateEntries.slice(expired);
  state.retainedWorkloadUnits -= expiredUnits;
}

function budgetAllows(
  state: BudgetState | undefined,
  policy: SmartLendingUpstreamReadBudgetPolicy,
  workloadUnits: number,
): 'allowed' | 'concurrency' | 'rate' {
  const inFlightRequests = state?.inFlightRequests ?? 0;
  const inFlightUnits = state?.inFlightWorkloadUnits ?? 0;
  const starts = state?.rateEntries.length ?? 0;
  const retainedUnits = state?.retainedWorkloadUnits ?? 0;
  if (
    inFlightRequests >= policy.maximumConcurrentRequests ||
    inFlightUnits > policy.maximumInFlightWorkloadUnits - workloadUnits
  ) {
    return 'concurrency';
  }
  if (
    starts >= policy.maximumStartsPerWindow ||
    retainedUnits > policy.maximumWorkloadUnitsPerWindow - workloadUnits
  ) {
    return 'rate';
  }
  return 'allowed';
}

function reserveBudget(state: BudgetState, workloadUnits: number, now: number): void {
  state.inFlightRequests += 1;
  state.inFlightWorkloadUnits += workloadUnits;
  state.rateEntries.push(Object.freeze({ startedAt: now, workloadUnits }));
  state.retainedWorkloadUnits += workloadUnits;
}

function releaseBudget(state: BudgetState, workloadUnits: number): void {
  state.inFlightRequests -= 1;
  state.inFlightWorkloadUnits -= workloadUnits;
  if (state.inFlightRequests < 0 || state.inFlightWorkloadUnits < 0) {
    throw new Error('invalid admission state');
  }
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof AbortSignal)) admissionError('INVALID_ADMISSION_REQUEST');
  return value;
}

function parseWorkloadUnits(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_REQUEST_WORKLOAD_UNITS
  ) {
    admissionError('INVALID_ADMISSION_REQUEST');
  }
  return value as number;
}

function requestRecord(
  value: unknown,
  requiredKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  try {
    return exactDataRecord(value, requiredKeys, ['signal']);
  } catch {
    return admissionError('INVALID_ADMISSION_REQUEST');
  }
}

function parseSharedRequest(value: unknown): Readonly<{
  destination: SmartLendingSharedMarketDestination;
  readKey: string;
  workloadUnits: number;
  signal: AbortSignal | undefined;
}> {
  const record = requestRecord(value, ['destination', 'readKey', 'workloadUnits']);
  const destination = record.destination;
  if (
    destination !== SmartLendingExternalFeedDestination.AaveV3EthereumMarket &&
    destination !== SmartLendingExternalFeedDestination.DefiLlamaYields
  ) {
    admissionError('INVALID_ADMISSION_REQUEST');
  }
  const readKey = record.readKey;
  if (
    typeof readKey !== 'string' ||
    readKey !== SMART_LENDING_SHARED_MARKET_READ_KEYS[destination]
  ) {
    admissionError('INVALID_ADMISSION_REQUEST');
  }
  return Object.freeze({
    destination,
    readKey,
    workloadUnits: parseWorkloadUnits(record.workloadUnits),
    signal: parseSignal(record.signal),
  });
}

function parseAccountRequest(value: unknown): Readonly<{
  destination: SmartLendingExternalFeedDestination.LifiQuote;
  accountId: AccountId;
  workloadUnits: number;
  signal: AbortSignal | undefined;
}> {
  const record = requestRecord(value, ['destination', 'accountId', 'workloadUnits']);
  if (record.destination !== SmartLendingExternalFeedDestination.LifiQuote) {
    admissionError('INVALID_ADMISSION_REQUEST');
  }
  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return admissionError('INVALID_ADMISSION_REQUEST');
  }
  return Object.freeze({
    destination: record.destination,
    accountId,
    workloadUnits: parseWorkloadUnits(record.workloadUnits),
    signal: parseSignal(record.signal),
  });
}

function rejectAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) admissionError('CALLER_ABORTED');
}

function outcomeValue<Value>(outcome: InternalOutcome<Value>): Value {
  if (!outcome.ok) admissionError(outcome.code);
  return outcome.value;
}

/**
 * In-process admission for dormant read-only Ethereum/Solana upstreams.
 * Workload units are operator-selected relative weights, not currency, vendor
 * quota, or spend protection. Multi-task enforcement requires an approved
 * distributed limiter before these currently unwired reads can be activated.
 * A timeout or account-caller abort settles that caller promptly but retains
 * physical concurrency and weight until the operation promise actually settles.
 */
export class SmartLendingUpstreamReadAdmission {
  private readonly policy: SmartLendingUpstreamReadAdmissionPolicy;
  private readonly globalState = budgetState();
  private readonly destinationStates: Record<
    SmartLendingExternalFeedDestination,
    DestinationState
  > = {
    [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: destinationState(),
    [SmartLendingExternalFeedDestination.DefiLlamaYields]: destinationState(),
    [SmartLendingExternalFeedDestination.LifiQuote]: destinationState(),
  };
  private readonly accountStates = new Map<AccountId, BudgetState>();
  private readonly sharedFlights = new Map<string, LeaderExecution<unknown>>();
  private lastObservedTime = -1;
  private clockHealthy = true;

  constructor(
    policy: SmartLendingUpstreamReadAdmissionPolicy = DISABLED_SMART_LENDING_UPSTREAM_READ_ADMISSION_POLICY,
    private readonly clock: SmartLendingMonotonicClock = SYSTEM_SMART_LENDING_MONOTONIC_CLOCK,
  ) {
    this.policy = parsePolicy(policy);
    if (!clock || typeof clock.nowMilliseconds !== 'function') configurationError();
  }

  /**
   * Coalesces only fixed, non-personal market reads. A waiter's abort affects
   * only that waiter; it never cancels the shared leader's upstream operation.
   */
  async readSharedMarket<Value>(
    requestValue: SmartLendingSharedMarketReadRequest,
    operation: SmartLendingUpstreamReadOperation<Value>,
  ): Promise<Value> {
    const request = parseSharedRequest(requestValue);
    if (typeof operation !== 'function') admissionError('INVALID_ADMISSION_REQUEST');
    rejectAborted(request.signal);
    this.assertEnabled(request.destination);

    const flightKey = `${request.destination}\u0000${request.readKey}`;
    const existing = this.sharedFlights.get(flightKey) as LeaderExecution<Value> | undefined;
    if (existing && !existing.isPhysicallyComplete()) {
      return this.waitForSharedOutcome(existing.outcome, request.signal);
    }
    if (existing) this.sharedFlights.delete(flightKey);

    const reservation = this.reserve(request.destination, request.workloadUnits, null);
    const execution = this.startLeader<Value>(reservation, operation);
    this.sharedFlights.set(flightKey, execution as LeaderExecution<unknown>);
    void execution.physicalCompletion.then(() => {
      if (this.sharedFlights.get(flightKey) === execution) this.sharedFlights.delete(flightKey);
    });
    return this.waitForSharedOutcome(execution.outcome, request.signal);
  }

  /** Account-scoped LI.FI quote reads are never coalesced across callers. */
  async readAccountScoped<Value>(
    requestValue: SmartLendingAccountScopedReadRequest,
    operation: SmartLendingUpstreamReadOperation<Value>,
  ): Promise<Value> {
    const request = parseAccountRequest(requestValue);
    if (typeof operation !== 'function') admissionError('INVALID_ADMISSION_REQUEST');
    rejectAborted(request.signal);
    this.assertEnabled(request.destination);
    const reservation = this.reserve(request.destination, request.workloadUnits, request.accountId);
    const execution = this.startLeader(reservation, operation, request.signal);
    return outcomeValue(await execution.outcome);
  }

  snapshot(): SmartLendingUpstreamReadAdmissionSnapshot {
    const destinationSnapshot = Object.fromEntries(
      ALL_DESTINATIONS.map((destination) => {
        const state = this.destinationStates[destination];
        return [
          destination,
          Object.freeze({
            circuitState: state.circuit.phase,
            consecutiveFailures: state.circuit.consecutiveFailures,
            inFlightRequests: state.inFlightRequests,
            inFlightWorkloadUnits: state.inFlightWorkloadUnits,
            retainedStarts: state.rateEntries.length,
            retainedWorkloadUnits: state.retainedWorkloadUnits,
          }),
        ];
      }),
    ) as Record<
      SmartLendingExternalFeedDestination,
      SmartLendingUpstreamReadAdmissionSnapshot['destinations'][SmartLendingExternalFeedDestination]
    >;
    return Object.freeze({
      mode: this.policy.mode,
      clockHealthy: this.clockHealthy,
      global: Object.freeze({
        inFlightRequests: this.globalState.inFlightRequests,
        inFlightWorkloadUnits: this.globalState.inFlightWorkloadUnits,
        retainedStarts: this.globalState.rateEntries.length,
        retainedWorkloadUnits: this.globalState.retainedWorkloadUnits,
      }),
      destinations: Object.freeze(destinationSnapshot),
      trackedAccountCount: this.accountStates.size,
      sharedFlightCount: this.sharedFlights.size,
    });
  }

  private assertEnabled(destination: SmartLendingExternalFeedDestination): void {
    if (
      this.policy.mode !== 'enabled' ||
      this.policy.destinations[destination].maximumConcurrentRequests === 0
    ) {
      admissionError('UPSTREAM_READ_DISABLED');
    }
    if (!this.clockHealthy) admissionError('ADMISSION_CLOCK_INVALID');
  }

  private now(): number {
    let value: unknown;
    try {
      value = this.clock.nowMilliseconds();
    } catch {
      this.clockHealthy = false;
      return admissionError('ADMISSION_CLOCK_INVALID');
    }
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < 0 ||
      (value as number) < this.lastObservedTime
    ) {
      this.clockHealthy = false;
      return admissionError('ADMISSION_CLOCK_INVALID');
    }
    this.lastObservedTime = value as number;
    return value as number;
  }

  private reserve(
    destination: SmartLendingExternalFeedDestination,
    workloadUnits: number,
    accountId: AccountId | null,
  ): Reservation {
    const now = this.now();
    const destinationPolicy = this.policy.destinations[destination];
    const destinationState = this.destinationStates[destination];
    purgeRateWindow(this.globalState, this.policy.global, now);
    purgeRateWindow(destinationState, destinationPolicy, now);
    this.pruneAccountStates(now);

    let accountState: BudgetState | undefined;
    if (accountId !== null) {
      accountState = this.accountStates.get(accountId);
      if (accountState) {
        purgeRateWindow(accountState, this.policy.accountScopedLifi, now);
      } else if (this.accountStates.size >= this.policy.accountScopedLifi.maximumTrackedAccounts) {
        admissionError('RATE_REJECTED');
      }
    }

    const budgetResults = [
      budgetAllows(this.globalState, this.policy.global, workloadUnits),
      budgetAllows(destinationState, destinationPolicy, workloadUnits),
      ...(accountId === null
        ? []
        : [budgetAllows(accountState, this.policy.accountScopedLifi, workloadUnits)]),
    ];
    if (budgetResults.includes('concurrency')) admissionError('CONCURRENCY_REJECTED');
    if (budgetResults.includes('rate')) admissionError('RATE_REJECTED');

    const circuitPermit = this.reserveCircuit(destinationState.circuit, now);
    if (accountId !== null && !accountState) {
      accountState = budgetState();
      this.accountStates.set(accountId, accountState);
    }
    reserveBudget(this.globalState, workloadUnits, now);
    reserveBudget(destinationState, workloadUnits, now);
    if (accountState) reserveBudget(accountState, workloadUnits, now);
    return {
      destination,
      workloadUnits,
      accountId,
      circuitPermit,
      circuitDisposition: 'PENDING',
      physicalReleased: false,
    };
  }

  private reserveCircuit(circuit: CircuitState, now: number): CircuitPermit {
    if (circuit.phase === 'OPEN') {
      if (now < circuit.openUntil) admissionError('CIRCUIT_OPEN');
      circuit.phase = 'HALF_OPEN';
      circuit.halfOpenProbeInFlight = false;
    }
    if (circuit.phase === 'HALF_OPEN') {
      if (circuit.halfOpenProbeInFlight) admissionError('CIRCUIT_OPEN');
      circuit.halfOpenProbeInFlight = true;
      return Object.freeze({ generation: circuit.generation, phase: 'HALF_OPEN' });
    }
    return Object.freeze({ generation: circuit.generation, phase: 'CLOSED' });
  }

  private pruneAccountStates(now: number): void {
    const policy = this.policy.accountScopedLifi;
    if (policy.maximumTrackedAccounts === 0 || this.accountStates.size === 0) return;
    const removable: AccountId[] = [];
    for (const [accountId, state] of this.accountStates) {
      purgeRateWindow(state, policy, now);
      if (state.inFlightRequests === 0 && state.rateEntries.length === 0) removable.push(accountId);
    }
    removable.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const accountId of removable) this.accountStates.delete(accountId);
  }

  private startLeader<Value>(
    reservation: Reservation,
    operation: SmartLendingUpstreamReadOperation<Value>,
    callerSignal?: AbortSignal,
  ): LeaderExecution<Value> {
    const destinationPolicy = this.policy.destinations[reservation.destination];
    const controller = new AbortController();
    const context = Object.freeze({ signal: controller.signal });
    const outcome = deferred<InternalOutcome<Value>>();
    const physicalCompletion = deferred<void>();
    const lifecycle: {
      logicalSettled: boolean;
      operationStarted: boolean;
      physicallyComplete: boolean;
      timeout: ReturnType<typeof setTimeout> | undefined;
      callerAborted: (() => void) | undefined;
    } = {
      logicalSettled: false,
      operationStarted: false,
      physicallyComplete: false,
      timeout: undefined,
      callerAborted: undefined,
    };

    const finishLogical = (candidate: InternalOutcome<Value>): void => {
      if (lifecycle.logicalSettled) return;
      lifecycle.logicalSettled = true;
      if (lifecycle.timeout !== undefined) clearTimeout(lifecycle.timeout);
      if (lifecycle.callerAborted) {
        callerSignal?.removeEventListener('abort', lifecycle.callerAborted);
      }
      let finalOutcome = candidate;
      try {
        this.recordLogicalOutcome(reservation, candidate);
      } catch {
        this.clockHealthy = false;
        reservation.circuitDisposition = 'NEUTRAL';
        finalOutcome = Object.freeze({ ok: false, code: 'ADMISSION_CLOCK_INVALID' });
      }
      outcome.resolve(finalOutcome);
    };

    const finishPhysical = (): void => {
      if (lifecycle.physicallyComplete) return;
      lifecycle.physicallyComplete = true;
      try {
        this.releasePhysicalReservation(reservation);
      } catch {
        this.clockHealthy = false;
      } finally {
        physicalCompletion.resolve(undefined);
      }
    };

    lifecycle.callerAborted = (): void => {
      try {
        controller.abort();
      } finally {
        finishLogical(Object.freeze({ ok: false, code: 'CALLER_ABORTED' }));
        if (!lifecycle.operationStarted) finishPhysical();
      }
    };
    lifecycle.timeout = setTimeout(() => {
      try {
        controller.abort();
      } finally {
        finishLogical(Object.freeze({ ok: false, code: 'UPSTREAM_TIMEOUT' }));
      }
    }, destinationPolicy.timeoutMilliseconds);
    lifecycle.timeout.unref?.();
    if (callerSignal) {
      callerSignal.addEventListener('abort', lifecycle.callerAborted, { once: true });
      if (callerSignal.aborted) lifecycle.callerAborted();
    }

    void Promise.resolve().then(async () => {
      if (lifecycle.logicalSettled || lifecycle.physicallyComplete) return;
      lifecycle.operationStarted = true;
      try {
        const value = await operation(context);
        finishLogical(Object.freeze({ ok: true, value }));
      } catch {
        finishLogical(Object.freeze({ ok: false, code: 'UPSTREAM_FAILED' }));
      } finally {
        finishPhysical();
      }
    });

    return Object.freeze({
      outcome: outcome.promise,
      physicalCompletion: physicalCompletion.promise,
      isPhysicallyComplete: (): boolean => lifecycle.physicallyComplete,
    });
  }

  private recordLogicalOutcome<Value>(
    reservation: Reservation,
    outcome: InternalOutcome<Value>,
  ): void {
    if (reservation.circuitDisposition !== 'PENDING') {
      throw new Error('duplicate logical admission outcome');
    }
    const destinationState = this.destinationStates[reservation.destination];
    if (!outcome.ok && outcome.code === 'CALLER_ABORTED') {
      reservation.circuitDisposition = 'NEUTRAL';
      return;
    }
    const now = this.now();
    if (outcome.ok) {
      this.recordCircuitSuccess(destinationState.circuit, reservation.circuitPermit);
    } else {
      this.recordCircuitFailure(
        destinationState.circuit,
        reservation.circuitPermit,
        this.policy.destinations[reservation.destination],
        now,
      );
    }
    reservation.circuitDisposition = 'RECORDED';
  }

  private releasePhysicalReservation(reservation: Reservation): void {
    if (reservation.physicalReleased) throw new Error('duplicate physical admission release');
    reservation.physicalReleased = true;
    const destinationState = this.destinationStates[reservation.destination];
    releaseBudget(this.globalState, reservation.workloadUnits);
    releaseBudget(destinationState, reservation.workloadUnits);
    if (reservation.accountId !== null) {
      const accountState = this.accountStates.get(reservation.accountId);
      if (!accountState) throw new Error('missing account admission state');
      releaseBudget(accountState, reservation.workloadUnits);
    }
    if (reservation.circuitDisposition === 'NEUTRAL') {
      this.releaseNeutralCircuitPermit(destinationState.circuit, reservation.circuitPermit);
    }
  }

  private releaseNeutralCircuitPermit(circuit: CircuitState, permit: CircuitPermit): void {
    if (
      permit.phase === 'HALF_OPEN' &&
      circuit.phase === 'HALF_OPEN' &&
      circuit.generation === permit.generation
    ) {
      circuit.halfOpenProbeInFlight = false;
    }
  }

  private recordCircuitSuccess(circuit: CircuitState, permit: CircuitPermit): void {
    if (circuit.generation !== permit.generation) return;
    if (permit.phase === 'HALF_OPEN') {
      if (circuit.phase !== 'HALF_OPEN') return;
      circuit.phase = 'CLOSED';
      circuit.consecutiveFailures = 0;
      circuit.halfOpenProbeInFlight = false;
      circuit.openUntil = 0;
      circuit.generation += 1;
      return;
    }
    if (circuit.phase === 'CLOSED') circuit.consecutiveFailures = 0;
  }

  private recordCircuitFailure(
    circuit: CircuitState,
    permit: CircuitPermit,
    policy: SmartLendingUpstreamDestinationPolicy,
    now: number,
  ): void {
    if (circuit.generation !== permit.generation) return;
    if (permit.phase === 'HALF_OPEN') {
      if (circuit.phase !== 'HALF_OPEN') return;
      this.openCircuit(circuit, policy, now);
      return;
    }
    if (circuit.phase !== 'CLOSED') return;
    circuit.consecutiveFailures += 1;
    if (circuit.consecutiveFailures >= policy.circuitFailureThreshold) {
      this.openCircuit(circuit, policy, now);
    }
  }

  private openCircuit(
    circuit: CircuitState,
    policy: SmartLendingUpstreamDestinationPolicy,
    now: number,
  ): void {
    circuit.phase = 'OPEN';
    circuit.consecutiveFailures = policy.circuitFailureThreshold;
    circuit.halfOpenProbeInFlight = false;
    circuit.openUntil =
      now > Number.MAX_SAFE_INTEGER - policy.circuitOpenMilliseconds
        ? Number.MAX_SAFE_INTEGER
        : now + policy.circuitOpenMilliseconds;
    circuit.generation += 1;
  }

  private async waitForSharedOutcome<Value>(
    flight: Promise<InternalOutcome<Value>>,
    signal: AbortSignal | undefined,
  ): Promise<Value> {
    if (!signal) return outcomeValue(await flight);
    rejectAborted(signal);
    const outcome = await new Promise<InternalOutcome<Value>>((resolve) => {
      let settled = false;
      const finish = (value: InternalOutcome<Value>): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', aborted);
        resolve(value);
      };
      const aborted = (): void => finish(Object.freeze({ ok: false, code: 'CALLER_ABORTED' }));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      void flight.then(finish);
    });
    return outcomeValue(outcome);
  }
}
