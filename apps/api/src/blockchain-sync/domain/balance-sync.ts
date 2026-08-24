import { createHash } from 'node:crypto';

import {
  CHAIN_OBSERVATION_RESILIENCE_POLICY,
  chainObservationPolicyForNetwork,
  observationTierRule,
  type ChainObservationNetworkId,
  type ChainObservationSelector,
  type ChainObservationTier,
  type ChainObservationTierState,
} from '../../blockchain/domain/chain-observation-policy';
import type { SupportedStablecoin } from '../../blockchain/domain/supported-asset-registry';
import {
  createJobEnvelope,
  parseJobEnvelope,
  type JobCorrelationContext,
  type JobEnvelope,
} from '../../infrastructure/outbox/job-envelope';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]{0,77})$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const BALANCE_SYNC_JOB_KIND = 'blockchain.balance-sync' as const;
export const BALANCE_SYNC_JOB_VERSION = 1 as const;
export const BALANCE_SYNC_PAYLOAD_VERSION = 1 as const;

export const BALANCE_SYNC_POLICY = Object.freeze({
  maxAttempts: CHAIN_OBSERVATION_RESILIENCE_POLICY.reads.maxAttempts,
  retryBaseDelaySeconds: 5,
  retryMaximumDelaySeconds: 60,
  maximumPositionsPerObservation: 64,
  maximumRecoveryReadUnits: CHAIN_OBSERVATION_RESILIENCE_POLICY.recovery.maxReadUnitsPerJob,
  localExecutableTier: 'PROVISIONAL',
  providerFailureBehavior: 'PRESERVE_LAST_GOOD_AND_MARK_STALE',
  transactionSubmission: 'DISABLED',
} as const);

export type BalanceSyncJobCause = 'SCHEDULED' | 'RETRY' | 'MANUAL_RECOVERY';

export interface BalanceSyncJobPayload {
  readonly schemaVersion: typeof BALANCE_SYNC_PAYLOAD_VERSION;
  readonly accountId: string;
  readonly walletId: string;
  readonly networkId: ChainObservationNetworkId;
  readonly requiredTier: ChainObservationTier;
  readonly cause: BalanceSyncJobCause;
  readonly attempt: number;
  readonly rescanFromPosition: string | null;
}

export type BalanceSyncJobEnvelope = JobEnvelope<BalanceSyncJobPayload>;

export interface CreateDeterministicBalanceSyncJobOptions {
  readonly id: string;
  readonly occurredAt: string;
  readonly correlation: JobCorrelationContext;
}

export type BalanceSyncFailureCode =
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INVALID_DATA'
  | 'PERMANENT_PROVIDER_FAILURE'
  | 'REORG_RECOVERY_FAILED'
  | 'UNCLASSIFIED_FAILURE';

export class BalanceSyncIndexerFailure extends Error {
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: Exclude<BalanceSyncFailureCode, 'UNCLASSIFIED_FAILURE'>,
    options: Readonly<{ retryAfterSeconds?: number }> = {},
  ) {
    super(code);
    this.name = 'BalanceSyncIndexerFailure';
    if (
      options.retryAfterSeconds !== undefined &&
      (!Number.isSafeInteger(options.retryAfterSeconds) || options.retryAfterSeconds < 0)
    ) {
      throw new TypeError('retryAfterSeconds must be a non-negative safe integer');
    }
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type BalanceSyncFailureDisposition =
  | Readonly<{
      action: 'RETRY';
      delaySeconds: number;
      reason: 'TRANSIENT_FAILURE';
    }>
  | Readonly<{
      action: 'DEAD_LETTER';
      delaySeconds: null;
      reason: 'ATTEMPTS_EXHAUSTED' | 'NON_RETRYABLE_FAILURE' | 'RETRY_AFTER_EXCEEDS_BOUND';
    }>;

export interface BalanceSyncTierThreshold {
  readonly networkId: ChainObservationNetworkId;
  readonly tier: ChainObservationTier;
  readonly selector: ChainObservationSelector;
  readonly state: ChainObservationTierState;
  readonly locallyExecutable: boolean;
}

export interface BalanceSyncSourcePoint {
  readonly position: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly selector: ChainObservationSelector;
  readonly retrievedAt: string;
}

export interface BalanceSyncPosition {
  readonly positionId: string;
  readonly stablecoin: SupportedStablecoin;
  readonly assetIdentity: string;
  readonly amountAtomic: string;
}

export interface BalanceSyncObservation {
  readonly observationId: string;
  readonly accountId: string;
  readonly walletId: string;
  readonly networkId: ChainObservationNetworkId;
  readonly tier: ChainObservationTier;
  readonly source: BalanceSyncSourcePoint;
  readonly headAdvancedAt: string;
  readonly positions: readonly BalanceSyncPosition[];
}

export type BalanceSyncDomainErrorCode =
  'INVALID_BALANCE_SYNC_JOB' | 'INVALID_BALANCE_SYNC_POSITION' | 'INVALID_BALANCE_SYNC_OBSERVATION';

export class BalanceSyncDomainError extends Error {
  constructor(readonly code: BalanceSyncDomainErrorCode) {
    super(code);
    this.name = 'BalanceSyncDomainError';
  }
}

export function createDeterministicBalanceSyncJobEnvelope(
  payload: BalanceSyncJobPayload,
  options: CreateDeterministicBalanceSyncJobOptions,
): BalanceSyncJobEnvelope {
  const parsedPayload = parseBalanceSyncPayload(payload);
  return createJobEnvelope(BALANCE_SYNC_JOB_KIND, parsedPayload, {
    id: options.id,
    version: BALANCE_SYNC_JOB_VERSION,
    occurredAt: options.occurredAt,
    correlation: options.correlation,
  });
}

export function parseBalanceSyncJobEnvelope(value: unknown): BalanceSyncJobEnvelope {
  try {
    const envelope = parseJobEnvelope(value);
    if (envelope.kind !== BALANCE_SYNC_JOB_KIND || envelope.version !== BALANCE_SYNC_JOB_VERSION) {
      throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
    }
    return Object.freeze({
      ...envelope,
      payload: parseBalanceSyncPayload(envelope.payload),
    });
  } catch {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
  }
}

export function createBalanceSyncRetryEnvelope(
  parent: BalanceSyncJobEnvelope,
  occurredAt: string,
): BalanceSyncJobEnvelope {
  const parsedParent = parseBalanceSyncJobEnvelope(parent);
  const nextAttempt = parsedParent.payload.attempt + 1;
  if (nextAttempt > BALANCE_SYNC_POLICY.maxAttempts) {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
  }
  const retryId = `balance-sync:${digest(
    'crypto-lending:balance-sync-retry-job:v1',
    parsedParent.id,
    String(nextAttempt),
  )}`;
  return createDeterministicBalanceSyncJobEnvelope(
    Object.freeze({
      ...parsedParent.payload,
      cause: 'RETRY',
      attempt: nextAttempt,
    }),
    Object.freeze({
      id: retryId,
      occurredAt,
      correlation: parsedParent.correlation,
    }),
  );
}

export function decideBalanceSyncFailureDisposition(
  failureCode: BalanceSyncFailureCode,
  attempt: number,
  retryAfterSeconds?: number,
): BalanceSyncFailureDisposition {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > BALANCE_SYNC_POLICY.maxAttempts) {
    return deadLetter('NON_RETRYABLE_FAILURE');
  }
  const retryable =
    failureCode === 'RATE_LIMITED' ||
    failureCode === 'PROVIDER_TIMEOUT' ||
    failureCode === 'PROVIDER_UNAVAILABLE' ||
    failureCode === 'REORG_RECOVERY_FAILED';
  if (!retryable) return deadLetter('NON_RETRYABLE_FAILURE');
  if (attempt >= BALANCE_SYNC_POLICY.maxAttempts) return deadLetter('ATTEMPTS_EXHAUSTED');
  if (
    retryAfterSeconds !== undefined &&
    (!Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 0 ||
      retryAfterSeconds > BALANCE_SYNC_POLICY.retryMaximumDelaySeconds)
  ) {
    return deadLetter('RETRY_AFTER_EXCEEDS_BOUND');
  }
  const exponentialDelay = Math.min(
    BALANCE_SYNC_POLICY.retryBaseDelaySeconds * 2 ** (attempt - 1),
    BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,
  );
  return Object.freeze({
    action: 'RETRY',
    delaySeconds: Math.max(exponentialDelay, retryAfterSeconds ?? 0),
    reason: 'TRANSIENT_FAILURE',
  });
}

export function balanceSyncTierThreshold(
  networkId: string,
  tier: string,
): BalanceSyncTierThreshold | undefined {
  const policy = chainObservationPolicyForNetwork(networkId);
  const rule = observationTierRule(networkId, tier);
  if (!policy || !rule) return undefined;
  return Object.freeze({
    networkId: policy.networkId,
    tier: rule.tier,
    selector: rule.selector,
    state: rule.state,
    locallyExecutable:
      rule.tier === BALANCE_SYNC_POLICY.localExecutableTier && rule.state === 'ALLOWED',
  });
}

export function normalizeBalanceSyncPosition(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UNSIGNED_INTEGER_PATTERN.test(value) ||
    value.length > MAX_UINT256.length ||
    (value.length === MAX_UINT256.length && value > MAX_UINT256)
  ) {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_POSITION');
  }
  return value;
}

export function createBalanceSyncObservationId(
  input: Readonly<{
    accountId: string;
    walletId: string;
    networkId: ChainObservationNetworkId;
    tier: ChainObservationTier;
    source: Pick<BalanceSyncSourcePoint, 'position' | 'hash' | 'parentHash' | 'selector'>;
    positions: readonly BalanceSyncPosition[];
  }>,
): string {
  try {
    if (!UUID_V4_PATTERN.test(input.accountId) || !UUID_V4_PATTERN.test(input.walletId)) {
      throw new Error('invalid identity');
    }
    const threshold = balanceSyncTierThreshold(input.networkId, input.tier);
    if (!threshold || threshold.selector !== input.source.selector) {
      throw new Error('invalid tier');
    }
    const sourcePosition = normalizeBalanceSyncPosition(input.source.position);
    if (
      typeof input.source.hash !== 'string' ||
      typeof input.source.parentHash !== 'string' ||
      input.source.hash.length < 16 ||
      input.source.hash.length > 128 ||
      input.source.parentHash.length < 16 ||
      input.source.parentHash.length > 128 ||
      !Array.isArray(input.positions) ||
      input.positions.length > BALANCE_SYNC_POLICY.maximumPositionsPerObservation
    ) {
      throw new Error('invalid observation');
    }
    const canonicalPositions = [...input.positions]
      .map((position) => {
        if (
          typeof position.positionId !== 'string' ||
          !FINGERPRINT_PATTERN.test(position.positionId) ||
          typeof position.assetIdentity !== 'string' ||
          position.assetIdentity.length < 16 ||
          position.assetIdentity.length > 64 ||
          !['USDC', 'USDT', 'PYUSD'].includes(position.stablecoin)
        ) {
          throw new Error('invalid position');
        }
        return [
          position.positionId,
          position.stablecoin,
          position.assetIdentity,
          normalizeBalanceSyncPosition(position.amountAtomic),
        ] as const;
      })
      .sort((left, right) => compareCanonical(left.join('\0'), right.join('\0')));
    if (
      new Set(canonicalPositions.map(([positionId]) => positionId)).size !==
        canonicalPositions.length ||
      new Set(canonicalPositions.map(([, , assetIdentity]) => assetIdentity)).size !==
        canonicalPositions.length
    ) {
      throw new Error('duplicate position');
    }
    return digest(
      'crypto-lending:balance-sync-observation:v1',
      input.accountId,
      input.walletId,
      input.networkId,
      input.tier,
      sourcePosition,
      input.source.hash,
      input.source.parentHash,
      input.source.selector,
      JSON.stringify(canonicalPositions),
    );
  } catch {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_OBSERVATION');
  }
}

function parseBalanceSyncPayload(value: unknown): BalanceSyncJobPayload {
  const record = exactRecord(value, [
    'schemaVersion',
    'accountId',
    'walletId',
    'networkId',
    'requiredTier',
    'cause',
    'attempt',
    'rescanFromPosition',
  ]);
  const networkPolicy =
    typeof record.networkId === 'string'
      ? chainObservationPolicyForNetwork(record.networkId)
      : undefined;
  if (
    record.schemaVersion !== BALANCE_SYNC_PAYLOAD_VERSION ||
    typeof record.accountId !== 'string' ||
    !UUID_V4_PATTERN.test(record.accountId) ||
    typeof record.walletId !== 'string' ||
    !UUID_V4_PATTERN.test(record.walletId) ||
    !networkPolicy ||
    (record.requiredTier !== 'PROVISIONAL' &&
      record.requiredTier !== 'CANONICAL' &&
      record.requiredTier !== 'FINANCIAL') ||
    (record.cause !== 'SCHEDULED' &&
      record.cause !== 'RETRY' &&
      record.cause !== 'MANUAL_RECOVERY') ||
    typeof record.attempt !== 'number' ||
    !Number.isSafeInteger(record.attempt) ||
    record.attempt < 1 ||
    record.attempt > BALANCE_SYNC_POLICY.maxAttempts ||
    (record.rescanFromPosition !== null && typeof record.rescanFromPosition !== 'string')
  ) {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
  }
  const rescanFromPosition =
    record.rescanFromPosition === null
      ? null
      : normalizeBalanceSyncPosition(record.rescanFromPosition);
  if (
    (record.cause === 'SCHEDULED' && record.attempt !== 1) ||
    (record.cause === 'RETRY' && record.attempt < 2) ||
    (record.cause === 'MANUAL_RECOVERY' && rescanFromPosition === null)
  ) {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
  }
  return Object.freeze({
    schemaVersion: BALANCE_SYNC_PAYLOAD_VERSION,
    accountId: record.accountId,
    walletId: record.walletId,
    networkId: networkPolicy.networkId,
    requiredTier: record.requiredTier,
    cause: record.cause,
    attempt: record.attempt,
    rescanFromPosition,
  });
}

function deadLetter(
  reason: Extract<BalanceSyncFailureDisposition, { action: 'DEAD_LETTER' }>['reason'],
): BalanceSyncFailureDisposition {
  return Object.freeze({ action: 'DEAD_LETTER', delaySeconds: null, reason });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
  }
  const ownKeys = Object.keys(value);
  if (
    ownKeys.length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new BalanceSyncDomainError('INVALID_BALANCE_SYNC_JOB');
  }
  return value as Record<string, unknown>;
}

function digest(domain: string, ...parts: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([domain, ...parts]), 'utf8')
    .digest('hex');
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
