import { isProxy } from 'node:util/types';

import { decodeSolanaPublicKey } from '../../../blockchain/domain/solana-token-account';

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

export interface EthereumMainnetBalanceDeploymentIdentityVerificationRequest {
  readonly networkId: 'eip155:1';
  readonly sourcePosition: string;
  readonly sourceHash: string;
  readonly assetIdentities: readonly string[];
}

export interface SolanaMainnetBalanceDeploymentIdentityVerificationRequest {
  readonly networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  readonly sourcePosition: string;
  readonly sourceHash: string;
  readonly assetIdentities: readonly string[];
}

export type MainnetBalanceDeploymentIdentityVerificationRequest =
  | EthereumMainnetBalanceDeploymentIdentityVerificationRequest
  | SolanaMainnetBalanceDeploymentIdentityVerificationRequest;

export interface MainnetBalanceDeploymentIdentityVerificationClaims {
  readonly deploymentIdentityValidated: true;
  readonly approvedManifestFingerprintSha256: string;
  readonly observedIdentityFingerprintSha256: string;
}

export interface MainnetBalanceIndexerSourceCandidate
  extends BalanceIndexerSourceCandidate, MainnetBalanceDeploymentIdentityVerificationClaims {
  readonly identityValidated: true;
}

export interface MainnetBalanceIndexerCandidate extends Omit<BalanceIndexerCandidate, 'source'> {
  readonly source: MainnetBalanceIndexerSourceCandidate;
}

export type ReviewedMainnetBalanceDeploymentIdentityAttestation =
  MainnetBalanceDeploymentIdentityVerificationClaims;

declare const ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_VERIFIER: unique symbol;
declare const SOLANA_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_VERIFIER: unique symbol;

/** Opaque capability created only around a reviewed Ethereum implementation. */
export interface EthereumMainnetBalanceDeploymentIdentityVerifierPort {
  readonly [ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_VERIFIER]: true;
}

/** Opaque capability created only around a reviewed Solana implementation. */
export interface SolanaMainnetBalanceDeploymentIdentityVerifierPort {
  readonly [SOLANA_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_VERIFIER]: true;
}

export type EthereumMainnetBalanceDeploymentIdentityVerifierImplementation = (
  request: Readonly<EthereumMainnetBalanceDeploymentIdentityVerificationRequest>,
  execution: BalanceSyncExecutionContext,
) => Promise<unknown>;

export type SolanaMainnetBalanceDeploymentIdentityVerifierImplementation = (
  request: Readonly<SolanaMainnetBalanceDeploymentIdentityVerificationRequest>,
  execution: BalanceSyncExecutionContext,
) => Promise<unknown>;

const VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS = new WeakMap<object, AbortSignal>();
const VERIFIED_BALANCE_SYNC_ABORT_KINDS = new WeakMap<object, BalanceSyncExecutionAbortKind>();
const VERIFIED_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_VERIFIERS = new WeakMap<
  object,
  Readonly<{
    readonly networkId: MainnetBalanceDeploymentIdentityVerificationRequest['networkId'];
    readonly implementation: (
      request: MainnetBalanceDeploymentIdentityVerificationRequest,
      execution: BalanceSyncExecutionContext,
    ) => Promise<unknown>;
  }>
>();
const VERIFIED_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ATTESTATIONS = new WeakMap<
  object,
  Readonly<{
    readonly requestKey: string;
    readonly claims: ReviewedMainnetBalanceDeploymentIdentityAttestation;
  }>
>();
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
const EVENT_TARGET_ADD_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as EventTarget['addEventListener'] | undefined;
const EVENT_TARGET_REMOVE_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'removeEventListener',
)?.value as EventTarget['removeEventListener'] | undefined;
const PROMISE_RESOLVE = Promise.resolve;
const PROMISE_THEN = Promise.prototype.then;

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

/** Wraps a future reviewed implementation; this factory approves no manifest. */
export function createEthereumMainnetBalanceDeploymentIdentityVerifier(
  implementation: EthereumMainnetBalanceDeploymentIdentityVerifierImplementation,
): EthereumMainnetBalanceDeploymentIdentityVerifierPort {
  return createDeploymentIdentityVerifier('eip155:1', implementation) as never;
}

/** See the Ethereum factory; this remains inert until explicitly injected. */
export function createSolanaMainnetBalanceDeploymentIdentityVerifier(
  implementation: SolanaMainnetBalanceDeploymentIdentityVerifierImplementation,
): SolanaMainnetBalanceDeploymentIdentityVerifierPort {
  return createDeploymentIdentityVerifier(
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    implementation,
  ) as never;
}

export function attestEthereumMainnetBalanceDeploymentIdentity(
  verifier: EthereumMainnetBalanceDeploymentIdentityVerifierPort | undefined,
  request: EthereumMainnetBalanceDeploymentIdentityVerificationRequest,
  execution: BalanceSyncExecutionContext,
): Promise<unknown> {
  return issueDeploymentIdentityAttestation(verifier, request, execution, 'eip155:1');
}

export function attestSolanaMainnetBalanceDeploymentIdentity(
  verifier: SolanaMainnetBalanceDeploymentIdentityVerifierPort | undefined,
  request: SolanaMainnetBalanceDeploymentIdentityVerificationRequest,
  execution: BalanceSyncExecutionContext,
): Promise<unknown> {
  return issueDeploymentIdentityAttestation(
    verifier,
    request,
    execution,
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  );
}

/** Reviews the private brand without inspecting untrusted value properties. */
export function reviewMainnetBalanceDeploymentIdentityAttestation(
  value: unknown,
  expectedRequest: MainnetBalanceDeploymentIdentityVerificationRequest,
): Readonly<ReviewedMainnetBalanceDeploymentIdentityAttestation> | null {
  try {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
    const stored = VERIFIED_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ATTESTATIONS.get(value as object);
    const expectedKey = deploymentIdentityRequestKey(
      normalizeDeploymentIdentityRequest(expectedRequest),
    );
    return stored?.requestKey === expectedKey ? stored.claims : null;
  } catch {
    return null;
  }
}

function createDeploymentIdentityVerifier(
  networkId: MainnetBalanceDeploymentIdentityVerificationRequest['networkId'],
  implementation: (request: never, execution: BalanceSyncExecutionContext) => Promise<unknown>,
): object {
  if (typeof implementation !== 'function' || isProxy(implementation)) {
    throw new TypeError('invalid mainnet balance deployment identity verifier');
  }
  const verifier = frozenNullPrototype({ networkId });
  VERIFIED_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_VERIFIERS.set(
    verifier,
    frozenNullPrototype({ networkId, implementation: implementation as never }),
  );
  return verifier;
}

async function issueDeploymentIdentityAttestation(
  verifier: unknown,
  request: MainnetBalanceDeploymentIdentityVerificationRequest,
  execution: BalanceSyncExecutionContext,
  expectedNetworkId: MainnetBalanceDeploymentIdentityVerificationRequest['networkId'],
): Promise<unknown> {
  try {
    const executionBefore = reviewBalanceSyncExecutionContext(execution);
    const captured =
      typeof verifier === 'object' && verifier !== null
        ? VERIFIED_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_VERIFIERS.get(verifier)
        : undefined;
    const normalized = normalizeDeploymentIdentityRequest(request);
    if (
      executionBefore?.abortKind !== null ||
      !captured ||
      captured.networkId !== expectedNetworkId ||
      normalized.networkId !== expectedNetworkId
    ) {
      throw new TypeError('deployment identity verifier unavailable');
    }
    const operation = Reflect.apply(PROMISE_RESOLVE, Promise, [
      Reflect.apply(captured.implementation, undefined, [normalized, execution]),
    ]) as Promise<unknown>;
    const settled = await abortableDeploymentIdentityVerification(
      operation,
      executionBefore.signal,
    );
    if (reviewBalanceSyncExecutionContext(execution)?.abortKind !== null) {
      throw new TypeError('deployment identity verification aborted');
    }
    const claims = parseDeploymentIdentityClaims(settled.value);
    const attestation = frozenNullPrototype({ ...claims });
    VERIFIED_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ATTESTATIONS.set(
      attestation,
      frozenNullPrototype({ requestKey: deploymentIdentityRequestKey(normalized), claims }),
    );
    return attestation;
  } catch {
    throw new TypeError('mainnet balance deployment identity verification unavailable');
  }
}

function abortableDeploymentIdentityVerification(
  operation: Promise<unknown>,
  signal: AbortSignal,
): Promise<Readonly<{ readonly value: unknown }>> {
  if (
    EVENT_TARGET_ADD_EVENT_LISTENER === undefined ||
    EVENT_TARGET_REMOVE_EVENT_LISTENER === undefined ||
    ABORT_SIGNAL_ABORTED_GETTER === undefined
  ) {
    throw new TypeError('deployment identity abort authority unavailable');
  }
  return new Promise((resolve, reject) => {
    let completed = false;
    const finish = (outcome: 'RESOLVE' | 'REJECT', value?: unknown): void => {
      if (completed) return;
      completed = true;
      Reflect.apply(EVENT_TARGET_REMOVE_EVENT_LISTENER, signal, ['abort', onAbort]);
      if (outcome === 'RESOLVE') resolve(frozenNullPrototype({ value }));
      else reject(new TypeError('deployment identity verification unavailable'));
    };
    const onAbort = (): void => finish('REJECT');
    Reflect.apply(EVENT_TARGET_ADD_EVENT_LISTENER, signal, ['abort', onAbort, { once: true }]);
    Reflect.apply(PROMISE_THEN, operation, [
      (value: unknown) => finish('RESOLVE', value),
      () => finish('REJECT'),
    ]);
    if (Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) as boolean) onAbort();
  });
}

function normalizeDeploymentIdentityRequest(
  value: unknown,
): Readonly<MainnetBalanceDeploymentIdentityVerificationRequest> {
  const record = exactDataRecord(value, [
    'networkId',
    'sourcePosition',
    'sourceHash',
    'assetIdentities',
  ]);
  const networkId = record?.networkId;
  const sourcePosition = record?.sourcePosition;
  const sourceHash = record?.sourceHash;
  const identities = exactStringTuple(record?.assetIdentities, 3);
  const evm = networkId === 'eip155:1';
  const solana = networkId === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  if (
    (!evm && !solana) ||
    typeof sourcePosition !== 'string' ||
    !/^[1-9][0-9]{0,19}$/u.test(sourcePosition) ||
    BigInt(sourcePosition) > (1n << 64n) - 1n ||
    typeof sourceHash !== 'string' ||
    !(evm ? /^0x[0-9a-f]{64}$/u.test(sourceHash) : isCanonicalSolanaIdentity(sourceHash)) ||
    (evm ? sourceHash === `0x${'0'.repeat(64)}` : sourceHash === '1'.repeat(32)) ||
    identities === null ||
    identities.some(
      (identity, index) =>
        !(evm ? /^0x[0-9a-f]{40}$/u.test(identity) : isCanonicalSolanaIdentity(identity)) ||
        (evm ? identity === `0x${'0'.repeat(40)}` : identity === '1'.repeat(32)) ||
        (index > 0 && identities[index - 1]! >= identity),
    )
  ) {
    throw new TypeError('invalid deployment identity request');
  }
  return frozenNullPrototype({
    networkId,
    sourcePosition,
    sourceHash,
    assetIdentities: identities,
  }) as Readonly<MainnetBalanceDeploymentIdentityVerificationRequest>;
}

function isCanonicalSolanaIdentity(value: string): boolean {
  try {
    decodeSolanaPublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function parseDeploymentIdentityClaims(
  value: unknown,
): Readonly<MainnetBalanceDeploymentIdentityVerificationClaims> {
  const record = exactDataRecord(value, [
    'deploymentIdentityValidated',
    'approvedManifestFingerprintSha256',
    'observedIdentityFingerprintSha256',
  ]);
  const manifest = record?.approvedManifestFingerprintSha256;
  const observed = record?.observedIdentityFingerprintSha256;
  if (
    record?.deploymentIdentityValidated !== true ||
    typeof manifest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(manifest) ||
    manifest === '0'.repeat(64) ||
    typeof observed !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(observed) ||
    observed === '0'.repeat(64)
  ) {
    throw new TypeError('invalid deployment identity claims');
  }
  return frozenNullPrototype({
    deploymentIdentityValidated: true as const,
    approvedManifestFingerprintSha256: manifest,
    observedIdentityFingerprintSha256: observed,
  });
}

function deploymentIdentityRequestKey(
  request: Readonly<MainnetBalanceDeploymentIdentityVerificationRequest>,
): string {
  return [
    request.networkId,
    request.sourcePosition,
    request.sourceHash,
    ...request.assetIdentities,
  ].join('\0');
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value))
    return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return null;
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function exactStringTuple(value: unknown, length: number): readonly string[] | null {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    Reflect.ownKeys(descriptors).length !== length + 1 ||
    lengthDescriptor?.value !== length ||
    typeof lengthDescriptor.writable !== 'boolean' ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false
  ) {
    return null;
  }
  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      return null;
    }
    result.push(descriptor.value);
  }
  return Object.freeze(result);
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
