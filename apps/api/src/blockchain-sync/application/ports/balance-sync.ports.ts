import type {
  ChainObservationSelector,
  ChainObservationTier,
} from '../../../blockchain/domain/chain-observation-policy';
import type {
  BalanceSyncFailureCode,
  BalanceSyncJobEnvelope,
  BalanceSyncObservation,
  BalanceSyncPosition,
  BalanceSyncSourcePoint,
} from '../../domain/balance-sync';

export const BALANCE_SYNC_CHECKPOINT_PORT = Symbol('BALANCE_SYNC_CHECKPOINT_PORT');
export const BALANCE_SYNC_WALLET_ADDRESS_RESOLVER_PORT = Symbol(
  'BALANCE_SYNC_WALLET_ADDRESS_RESOLVER_PORT',
);

export interface BalanceSyncScope {
  readonly accountId: string;
  readonly walletId: string;
  readonly networkId: BalanceSyncJobEnvelope['payload']['networkId'];
}

/**
 * Required boundary for any future live indexer. Its implementation must resolve
 * and decrypt only the exact active wallet in `scope`. The concrete PostgreSQL
 * implementation and narrow database function remain unregistered/dormant.
 * The untrusted result remains `unknown` until a chain-specific indexer validates
 * the Ethereum or Solana address canonically.
 */
export interface BalanceSyncWalletAddressResolverPort {
  resolveActiveAddress(
    scope: BalanceSyncScope,
    context: BalanceSyncExecutionContext,
  ): Promise<unknown>;
}

export interface BalanceIndexerSourceCandidate {
  readonly position: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly selector: ChainObservationSelector;
  readonly retrievedAt: string;
  readonly identityValidated: boolean;
}

export interface BalanceIndexerCandidate {
  readonly walletId: string;
  readonly networkId: BalanceSyncScope['networkId'];
  readonly tier: ChainObservationTier;
  readonly source: BalanceIndexerSourceCandidate;
  readonly positions: readonly BalanceSyncPosition[];
}

export interface BalanceIndexerReadRequest extends BalanceSyncScope {
  readonly tier: ChainObservationTier;
  readonly selector: ChainObservationSelector;
}

export interface BalanceIndexerRescanRequest extends BalanceIndexerReadRequest {
  readonly fromFinalizedSource: BalanceSyncSourcePoint;
  readonly maximumReadUnits: number;
}

export interface BalanceIndexerRescanResult extends BalanceIndexerCandidate {
  readonly replay: Readonly<{
    readonly fromPosition: string;
    readonly throughPosition: string;
    readonly readUnits: number;
    readonly complete: boolean;
  }>;
}

export type BalanceSyncExecutionAbortKind = 'SHUTDOWN' | 'DEADLINE';

export interface BalanceSyncExecutionContext {
  readonly signal: AbortSignal;
}

export interface ReviewedBalanceSyncExecutionContext {
  readonly signal: AbortSignal;
  readonly abortKind: BalanceSyncExecutionAbortKind | null;
}

export interface BalanceSyncExecutionContextOwner {
  readonly context: BalanceSyncExecutionContext;
  readonly abort: (kind: BalanceSyncExecutionAbortKind) => void;
}

const VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS = new WeakMap<object, AbortSignal>();
const VERIFIED_BALANCE_SYNC_ABORT_KINDS = new WeakMap<object, BalanceSyncExecutionAbortKind>();
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)?.get;
const ABORT_CONTROLLER_SIGNAL_GETTER = Object.getOwnPropertyDescriptor(
  AbortController.prototype,
  'signal',
)?.get;
const ABORT_CONTROLLER_ABORT = Object.getOwnPropertyDescriptor(AbortController.prototype, 'abort')
  ?.value as ((reason?: unknown) => void) | undefined;

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

/**
 * Creates one privately controlled execution signal. Abort classification is
 * retained out of band, so downstream code never needs to inspect a reason.
 */
export function createBalanceSyncExecutionContext(): Readonly<BalanceSyncExecutionContextOwner> {
  if (
    ABORT_SIGNAL_ABORTED_GETTER === undefined ||
    ABORT_CONTROLLER_SIGNAL_GETTER === undefined ||
    typeof ABORT_CONTROLLER_ABORT !== 'function'
  ) {
    throw new TypeError('balance sync execution context is unavailable');
  }
  const controller = new AbortController();
  const signal = Reflect.apply(ABORT_CONTROLLER_SIGNAL_GETTER, controller, []) as AbortSignal;
  const context = frozenNullPrototype<BalanceSyncExecutionContext>({ signal });
  VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS.set(context, signal);
  const abort = (kind: BalanceSyncExecutionAbortKind): void => {
    if (kind !== 'SHUTDOWN' && kind !== 'DEADLINE') {
      throw new TypeError('invalid balance sync execution abort kind');
    }
    const aborted = Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) as boolean;
    if (aborted) return;
    VERIFIED_BALANCE_SYNC_ABORT_KINDS.set(signal, kind);
    Reflect.apply(ABORT_CONTROLLER_ABORT, controller, []);
  };
  return frozenNullPrototype<BalanceSyncExecutionContextOwner>({ context, abort });
}

/** Recognizes only exact contexts minted by this module, without reading input properties. */
export function reviewBalanceSyncExecutionContext(
  value: unknown,
): Readonly<ReviewedBalanceSyncExecutionContext> | null {
  try {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
    const signal = VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS.get(value as object);
    if (signal === undefined || ABORT_SIGNAL_ABORTED_GETTER === undefined) return null;
    const aborted = Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) as boolean;
    return frozenNullPrototype({
      signal,
      abortKind: aborted ? (VERIFIED_BALANCE_SYNC_ABORT_KINDS.get(signal) ?? 'SHUTDOWN') : null,
    });
  } catch {
    return null;
  }
}

const INERT_BALANCE_SYNC_EXECUTION_OWNER = createBalanceSyncExecutionContext();

/** Branded non-aborting context for direct, inert unit-level API compatibility only. */
export const INERT_BALANCE_SYNC_EXECUTION_CONTEXT = INERT_BALANCE_SYNC_EXECUTION_OWNER.context;

/** No concrete RPC/indexer adapter is registered by KAN-65. */
export interface BalanceSyncIndexerPort {
  readCurrent(
    request: BalanceIndexerReadRequest,
    context: BalanceSyncExecutionContext,
  ): Promise<unknown>;
  rescanFromCheckpoint(
    request: BalanceIndexerRescanRequest,
    context: BalanceSyncExecutionContext,
  ): Promise<unknown>;
}

export interface BalanceSyncCheckpoint {
  readonly revision: number;
  readonly scope: BalanceSyncScope;
  readonly currentObservation: BalanceSyncObservation | null;
  readonly lastFinalizedSource: BalanceSyncSourcePoint | null;
  readonly freshness: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'QUARANTINED';
  readonly staleSince: string | null;
  readonly lastFailureCode: BalanceSyncFailureCode | null;
}

export type BalanceSyncSuccessMode = 'CREATED' | 'UPDATED' | 'UNCHANGED';

export interface BalanceSyncCheckpointPort {
  load(
    scope: BalanceSyncScope,
    context: BalanceSyncExecutionContext,
  ): Promise<BalanceSyncCheckpoint | null>;
  upsertCurrent(
    input: Readonly<{
      scope: BalanceSyncScope;
      expectedRevision: number | null;
      observation: BalanceSyncObservation;
      mode: BalanceSyncSuccessMode;
      succeededAt: string;
    }>,
    context: BalanceSyncExecutionContext,
  ): Promise<void>;
  replaceProvisionalAfterReorg(
    input: Readonly<{
      scope: BalanceSyncScope;
      expectedRevision: number;
      lastFinalizedSource: BalanceSyncSourcePoint;
      replacement: BalanceSyncObservation;
      recoveredAt: string;
    }>,
    context: BalanceSyncExecutionContext,
  ): Promise<void>;
  preserveLastGoodAndMarkStale(
    input: Readonly<{
      scope: BalanceSyncScope;
      expectedRevision: number | null;
      failedAt: string;
      failureCode: BalanceSyncFailureCode;
    }>,
    context: BalanceSyncExecutionContext,
  ): Promise<void>;
}

export interface BalanceSyncJobPort {
  scheduleRetry(
    input: Readonly<{
      envelope: BalanceSyncJobEnvelope;
      delaySeconds: number;
      failureCode: BalanceSyncFailureCode;
    }>,
  ): Promise<void>;
  deadLetter(
    input: Readonly<{
      envelope: BalanceSyncJobEnvelope;
      failureCode: BalanceSyncFailureCode;
      reason: 'ATTEMPTS_EXHAUSTED' | 'NON_RETRYABLE_FAILURE' | 'RETRY_AFTER_EXCEEDS_BOUND';
    }>,
  ): Promise<void>;
}

export type BalanceSyncMetricEvent = Readonly<{
  event:
    | 'SYNC_CREATED'
    | 'SYNC_UPDATED'
    | 'SYNC_UNCHANGED'
    | 'REORG_RECOVERED'
    | 'STALE_MARKED'
    | 'RETRY_SCHEDULED'
    | 'DEAD_LETTERED';
  networkId: BalanceSyncScope['networkId'];
  tier: ChainObservationTier;
  attempt: number;
  positionCount: number;
}>;

export type BalanceSyncAlert = Readonly<{
  code:
    | 'DATA_STALE'
    | 'PROVIDER_FAILURE'
    | 'REORG_DETECTED'
    | 'REORG_RECOVERY_FAILED'
    | 'DEAD_LETTERED';
  networkId: BalanceSyncScope['networkId'];
  tier: ChainObservationTier;
  attempt: number;
}>;

/** Metrics are bounded labels only; wallet IDs, addresses, hashes, and amounts are forbidden. */
export interface BalanceSyncMetricsPort {
  record(event: BalanceSyncMetricEvent): void;
  alert(alert: BalanceSyncAlert): void;
}

export interface BalanceSyncClockPort {
  now(): Date;
}
