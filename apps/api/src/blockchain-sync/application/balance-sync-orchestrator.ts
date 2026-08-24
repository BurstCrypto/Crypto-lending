import {
  chainObservationPolicyForNetwork,
  classifyChainObservationFreshness,
  decideChainContinuity,
  type ChainContinuityAction,
  type ChainObservationFreshnessDecision,
} from '../../blockchain/domain/chain-observation-policy';
import { supportedAssetRegistryForEnvironment } from '../../blockchain/domain/supported-asset-registry';
import {
  BALANCE_SYNC_POLICY,
  BalanceSyncIndexerFailure,
  balanceSyncTierThreshold,
  createBalanceSyncObservationId,
  createBalanceSyncRetryEnvelope,
  decideBalanceSyncFailureDisposition,
  normalizeBalanceSyncPosition,
  parseBalanceSyncJobEnvelope,
  type BalanceSyncFailureCode,
  type BalanceSyncJobEnvelope,
  type BalanceSyncObservation,
  type BalanceSyncPosition,
  type BalanceSyncSourcePoint,
} from '../domain/balance-sync';
import type {
  BalanceIndexerReadRequest,
  BalanceIndexerRescanRequest,
  BalanceSyncAlert,
  BalanceSyncCheckpoint,
  BalanceSyncCheckpointPort,
  BalanceSyncClockPort,
  BalanceSyncIndexerPort,
  BalanceSyncJobPort,
  BalanceSyncMetricEvent,
  BalanceSyncMetricsPort,
  BalanceSyncScope,
  BalanceSyncSuccessMode,
} from './ports/balance-sync.ports';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const EVM_BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const SOLANA_HASH_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/u;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type BalanceSyncOrchestratorErrorCode =
  | 'INVALID_BALANCE_SYNC_JOB'
  | 'INVALID_BALANCE_SYNC_CLOCK'
  | 'BALANCE_SYNC_CHECKPOINT_FAILED'
  | 'INVALID_BALANCE_SYNC_CHECKPOINT'
  | 'BALANCE_SYNC_JOB_DISPOSITION_FAILED';

export class BalanceSyncOrchestratorError extends Error {
  constructor(readonly code: BalanceSyncOrchestratorErrorCode) {
    super(code);
    this.name = 'BalanceSyncOrchestratorError';
  }
}

export type BalanceSyncProcessingResult =
  | Readonly<{
      status: 'COMPLETED';
      outcome: BalanceSyncSuccessMode | 'REORG_RECOVERED';
      jobId: string;
      observationId: string;
    }>
  | Readonly<{
      status: 'RETRY_SCHEDULED';
      jobId: string;
      retryJobId: string;
      failureCode: BalanceSyncFailureCode;
      delaySeconds: number;
    }>
  | Readonly<{
      status: 'DEAD_LETTERED';
      jobId: string;
      failureCode: BalanceSyncFailureCode;
      reason: 'ATTEMPTS_EXHAUSTED' | 'NON_RETRYABLE_FAILURE' | 'RETRY_AFTER_EXCEEDS_BOUND';
    }>;

interface NormalizedCandidate {
  readonly walletId: string;
  readonly networkId: BalanceSyncScope['networkId'];
  readonly tier: BalanceSyncJobEnvelope['payload']['requiredTier'];
  readonly source: BalanceSyncSourcePoint;
  readonly positions: readonly BalanceSyncPosition[];
}

interface RecoveryResult {
  readonly observation: BalanceSyncObservation;
  readonly lastFinalizedSource: BalanceSyncSourcePoint;
}

/**
 * Provider-neutral KAN-65 orchestration. All queue, checkpoint, indexer, clock,
 * and metric effects are injected; this class is not registered in a runtime
 * module and performs no network, timer, database, or cloud operation itself.
 */
export class BalanceSyncOrchestrator {
  constructor(
    private readonly jobs: BalanceSyncJobPort,
    private readonly checkpoints: BalanceSyncCheckpointPort,
    private readonly indexer: BalanceSyncIndexerPort,
    private readonly clock: BalanceSyncClockPort,
    private readonly metrics: BalanceSyncMetricsPort,
  ) {}

  async process(input: unknown): Promise<BalanceSyncProcessingResult> {
    let job: BalanceSyncJobEnvelope;
    try {
      job = parseBalanceSyncJobEnvelope(input);
    } catch {
      throw orchestratorError('INVALID_BALANCE_SYNC_JOB');
    }
    const now = clockTime(this.clock);
    if (Date.parse(job.occurredAt) > now.milliseconds) {
      throw orchestratorError('INVALID_BALANCE_SYNC_JOB');
    }
    const scope = Object.freeze({
      accountId: job.payload.accountId,
      walletId: job.payload.walletId,
      networkId: job.payload.networkId,
    });
    const checkpoint = await this.loadCheckpoint(scope, now.milliseconds);
    const threshold = balanceSyncTierThreshold(job.payload.networkId, job.payload.requiredTier);
    if (!threshold?.locallyExecutable) {
      return this.handleFailure(
        job,
        scope,
        checkpoint,
        now.canonical,
        'PERMANENT_PROVIDER_FAILURE',
      );
    }

    try {
      if (job.payload.cause === 'MANUAL_RECOVERY') {
        const recovery = await this.recoverFromReorg(job, scope, checkpoint, now);
        await this.commitRecovery(scope, checkpoint, recovery, now.canonical);
        this.recordMetric({
          event: 'REORG_RECOVERED',
          networkId: scope.networkId,
          tier: job.payload.requiredTier,
          attempt: job.payload.attempt,
          positionCount: recovery.observation.positions.length,
        });
        return Object.freeze({
          status: 'COMPLETED',
          outcome: 'REORG_RECOVERED',
          jobId: job.id,
          observationId: recovery.observation.observationId,
        });
      }

      const request: BalanceIndexerReadRequest = Object.freeze({
        ...scope,
        tier: job.payload.requiredTier,
        selector: threshold.selector,
      });
      const candidate = normalizeCandidate(
        await this.indexer.readCurrent(request),
        request,
        now.milliseconds,
      );
      const continuity = continuityAction(checkpoint?.currentObservation ?? null, candidate);
      if (
        continuity === 'RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR' ||
        continuity === 'VERIFY_BOUNDED_CONTINUITY_FROM_LAST_FINALIZED_CHECKPOINT'
      ) {
        this.recordAlert({
          code: 'REORG_DETECTED',
          networkId: scope.networkId,
          tier: job.payload.requiredTier,
          attempt: job.payload.attempt,
        });
        const recovery = await this.recoverFromReorg(job, scope, checkpoint, now);
        await this.commitRecovery(scope, checkpoint, recovery, now.canonical);
        this.recordMetric({
          event: 'REORG_RECOVERED',
          networkId: scope.networkId,
          tier: job.payload.requiredTier,
          attempt: job.payload.attempt,
          positionCount: recovery.observation.positions.length,
        });
        return Object.freeze({
          status: 'COMPLETED',
          outcome: 'REORG_RECOVERED',
          jobId: job.id,
          observationId: recovery.observation.observationId,
        });
      }
      if (
        continuity === 'QUARANTINE_FINALIZED_DISAGREEMENT' ||
        continuity === 'FAIL_CLOSED_BLOCKED_TIER'
      ) {
        throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
      }

      const freshness = freshnessForCandidate(
        scope,
        checkpoint?.currentObservation ?? null,
        candidate,
        now.milliseconds,
      );
      if (freshness.freshness !== 'CURRENT' || freshness.effectiveHeadAdvancedAtMs === null) {
        throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
      }
      const observation = createObservation(
        scope,
        candidate,
        new Date(freshness.effectiveHeadAdvancedAtMs).toISOString(),
      );
      let mode: BalanceSyncSuccessMode;
      if (!checkpoint?.currentObservation) {
        mode = 'CREATED';
      } else if (continuity === 'ACCEPT_NO_CHANGE') {
        if (checkpoint.currentObservation.observationId !== observation.observationId) {
          throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
        }
        mode = 'UNCHANGED';
      } else {
        mode = 'UPDATED';
      }
      await this.commitCurrent(scope, checkpoint, observation, mode, now.canonical);
      this.recordMetric({
        event: `SYNC_${mode}`,
        networkId: scope.networkId,
        tier: job.payload.requiredTier,
        attempt: job.payload.attempt,
        positionCount: observation.positions.length,
      });
      return Object.freeze({
        status: 'COMPLETED',
        outcome: mode,
        jobId: job.id,
        observationId: observation.observationId,
      });
    } catch (error) {
      const failure = failureFrom(error);
      if (failure.code === 'REORG_RECOVERY_FAILED') {
        this.recordAlert({
          code: 'REORG_RECOVERY_FAILED',
          networkId: scope.networkId,
          tier: job.payload.requiredTier,
          attempt: job.payload.attempt,
        });
      }
      return this.handleFailure(
        job,
        scope,
        checkpoint,
        now.canonical,
        failure.code,
        failure.retryAfterSeconds,
      );
    }
  }

  private async loadCheckpoint(
    scope: BalanceSyncScope,
    nowMs: number,
  ): Promise<BalanceSyncCheckpoint | null> {
    let value: BalanceSyncCheckpoint | null;
    try {
      value = await this.checkpoints.load(scope);
    } catch {
      throw orchestratorError('BALANCE_SYNC_CHECKPOINT_FAILED');
    }
    try {
      return validateCheckpoint(value, scope, nowMs);
    } catch {
      throw orchestratorError('INVALID_BALANCE_SYNC_CHECKPOINT');
    }
  }

  private async recoverFromReorg(
    job: BalanceSyncJobEnvelope,
    scope: BalanceSyncScope,
    checkpoint: BalanceSyncCheckpoint | null,
    now: Readonly<{ canonical: string; milliseconds: number }>,
  ): Promise<RecoveryResult> {
    const anchor = checkpoint?.lastFinalizedSource;
    if (
      !checkpoint ||
      !anchor ||
      (job.payload.rescanFromPosition !== null &&
        job.payload.rescanFromPosition !== anchor.position)
    ) {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    const threshold = balanceSyncTierThreshold(scope.networkId, job.payload.requiredTier);
    if (!threshold?.locallyExecutable) {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    const request: BalanceIndexerRescanRequest = Object.freeze({
      ...scope,
      tier: job.payload.requiredTier,
      selector: threshold.selector,
      fromFinalizedSource: anchor,
      maximumReadUnits: BALANCE_SYNC_POLICY.maximumRecoveryReadUnits,
    });
    let value: unknown;
    try {
      value = await this.indexer.rescanFromCheckpoint(request);
    } catch {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    const record = exactRecord(value, [
      'walletId',
      'networkId',
      'tier',
      'source',
      'positions',
      'replay',
    ]);
    const candidate = normalizeCandidate(
      {
        walletId: record.walletId,
        networkId: record.networkId,
        tier: record.tier,
        source: record.source,
        positions: record.positions,
      },
      request,
      now.milliseconds,
    );
    const replay = exactRecord(record.replay, [
      'fromPosition',
      'throughPosition',
      'readUnits',
      'complete',
    ]);
    if (
      replay.fromPosition !== anchor.position ||
      replay.throughPosition !== candidate.source.position ||
      replay.complete !== true ||
      typeof replay.readUnits !== 'number' ||
      !Number.isSafeInteger(replay.readUnits) ||
      replay.readUnits < 1 ||
      replay.readUnits > BALANCE_SYNC_POLICY.maximumRecoveryReadUnits
    ) {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    const recoveredContinuity = decideChainContinuity({
      networkId: scope.networkId,
      tier: job.payload.requiredTier,
      liveCapabilityProofValidated: false,
      previous: blockReference(anchor),
      candidate: blockReference(candidate.source),
    });
    if (
      recoveredContinuity.action === 'RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR' ||
      recoveredContinuity.action === 'QUARANTINE_FINALIZED_DISAGREEMENT' ||
      recoveredContinuity.action === 'FAIL_CLOSED_BLOCKED_TIER'
    ) {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    const freshness = freshnessForCandidate(scope, null, candidate, now.milliseconds);
    if (freshness.freshness !== 'CURRENT' || freshness.effectiveHeadAdvancedAtMs === null) {
      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');
    }
    return Object.freeze({
      observation: createObservation(
        scope,
        candidate,
        new Date(freshness.effectiveHeadAdvancedAtMs).toISOString(),
      ),
      lastFinalizedSource: anchor,
    });
  }

  private async commitCurrent(
    scope: BalanceSyncScope,
    checkpoint: BalanceSyncCheckpoint | null,
    observation: BalanceSyncObservation,
    mode: BalanceSyncSuccessMode,
    succeededAt: string,
  ): Promise<void> {
    try {
      await this.checkpoints.upsertCurrent(
        Object.freeze({
          scope,
          expectedRevision: checkpoint?.revision ?? null,
          observation,
          mode,
          succeededAt,
        }),
      );
    } catch {
      throw orchestratorError('BALANCE_SYNC_CHECKPOINT_FAILED');
    }
  }

  private async commitRecovery(
    scope: BalanceSyncScope,
    checkpoint: BalanceSyncCheckpoint | null,
    recovery: RecoveryResult,
    recoveredAt: string,
  ): Promise<void> {
    if (!checkpoint) throw orchestratorError('INVALID_BALANCE_SYNC_CHECKPOINT');
    try {
      await this.checkpoints.replaceProvisionalAfterReorg(
        Object.freeze({
          scope,
          expectedRevision: checkpoint.revision,
          lastFinalizedSource: recovery.lastFinalizedSource,
          replacement: recovery.observation,
          recoveredAt,
        }),
      );
    } catch {
      throw orchestratorError('BALANCE_SYNC_CHECKPOINT_FAILED');
    }
  }

  private async handleFailure(
    job: BalanceSyncJobEnvelope,
    scope: BalanceSyncScope,
    checkpoint: BalanceSyncCheckpoint | null,
    failedAt: string,
    failureCode: BalanceSyncFailureCode,
    retryAfterSeconds?: number,
  ): Promise<BalanceSyncProcessingResult> {
    try {
      await this.checkpoints.preserveLastGoodAndMarkStale(
        Object.freeze({
          scope,
          expectedRevision: checkpoint?.revision ?? null,
          failedAt,
          failureCode,
        }),
      );
    } catch {
      throw orchestratorError('BALANCE_SYNC_CHECKPOINT_FAILED');
    }
    const positionCount = checkpoint?.currentObservation?.positions.length ?? 0;
    this.recordMetric({
      event: 'STALE_MARKED',
      networkId: scope.networkId,
      tier: job.payload.requiredTier,
      attempt: job.payload.attempt,
      positionCount,
    });
    this.recordAlert({
      code: 'PROVIDER_FAILURE',
      networkId: scope.networkId,
      tier: job.payload.requiredTier,
      attempt: job.payload.attempt,
    });
    this.recordAlert({
      code: 'DATA_STALE',
      networkId: scope.networkId,
      tier: job.payload.requiredTier,
      attempt: job.payload.attempt,
    });

    const disposition = decideBalanceSyncFailureDisposition(
      failureCode,
      job.payload.attempt,
      retryAfterSeconds,
    );
    if (disposition.action === 'RETRY') {
      const retryEnvelope = createBalanceSyncRetryEnvelope(job, failedAt);
      try {
        await this.jobs.scheduleRetry(
          Object.freeze({
            envelope: retryEnvelope,
            delaySeconds: disposition.delaySeconds,
            failureCode,
          }),
        );
      } catch {
        throw orchestratorError('BALANCE_SYNC_JOB_DISPOSITION_FAILED');
      }
      this.recordMetric({
        event: 'RETRY_SCHEDULED',
        networkId: scope.networkId,
        tier: job.payload.requiredTier,
        attempt: job.payload.attempt,
        positionCount,
      });
      return Object.freeze({
        status: 'RETRY_SCHEDULED',
        jobId: job.id,
        retryJobId: retryEnvelope.id,
        failureCode,
        delaySeconds: disposition.delaySeconds,
      });
    }
    try {
      await this.jobs.deadLetter(
        Object.freeze({ envelope: job, failureCode, reason: disposition.reason }),
      );
    } catch {
      throw orchestratorError('BALANCE_SYNC_JOB_DISPOSITION_FAILED');
    }
    this.recordMetric({
      event: 'DEAD_LETTERED',
      networkId: scope.networkId,
      tier: job.payload.requiredTier,
      attempt: job.payload.attempt,
      positionCount,
    });
    this.recordAlert({
      code: 'DEAD_LETTERED',
      networkId: scope.networkId,
      tier: job.payload.requiredTier,
      attempt: job.payload.attempt,
    });
    return Object.freeze({
      status: 'DEAD_LETTERED',
      jobId: job.id,
      failureCode,
      reason: disposition.reason,
    });
  }

  private recordMetric(event: BalanceSyncMetricEvent): void {
    try {
      this.metrics.record(Object.freeze(event));
    } catch {
      // Metrics must not alter checkpoint or job disposition outcomes.
    }
  }

  private recordAlert(alert: BalanceSyncAlert): void {
    try {
      this.metrics.alert(Object.freeze(alert));
    } catch {
      // Alert adapters are observational only; durable job state remains authoritative.
    }
  }
}

function normalizeCandidate(
  value: unknown,
  request: BalanceIndexerReadRequest,
  nowMs: number,
): NormalizedCandidate {
  try {
    const record = exactRecord(value, ['walletId', 'networkId', 'tier', 'source', 'positions']);
    if (
      record.walletId !== request.walletId ||
      record.networkId !== request.networkId ||
      record.tier !== request.tier
    ) {
      throw new Error('candidate scope mismatch');
    }
    const source = parseSourcePoint(
      record.source,
      request.networkId,
      request.selector,
      nowMs,
      true,
    );
    if (
      !Array.isArray(record.positions) ||
      record.positions.length > BALANCE_SYNC_POLICY.maximumPositionsPerObservation
    ) {
      throw new Error('invalid positions');
    }
    const policy = chainObservationPolicyForNetwork(request.networkId);
    if (!policy) throw new Error('unsupported network');
    const registry = supportedAssetRegistryForEnvironment(policy.environment);
    const positions = record.positions.map((candidatePosition) => {
      const positionRecord = exactRecord(candidatePosition, [
        'positionId',
        'stablecoin',
        'assetIdentity',
        'amountAtomic',
      ]);
      if (
        typeof positionRecord.positionId !== 'string' ||
        !FINGERPRINT_PATTERN.test(positionRecord.positionId) ||
        typeof positionRecord.assetIdentity !== 'string' ||
        typeof positionRecord.stablecoin !== 'string'
      ) {
        throw new Error('invalid position');
      }
      const asset = registry.normalizeAsset(request.networkId, positionRecord.assetIdentity);
      if (
        !asset ||
        asset.identity !== positionRecord.assetIdentity ||
        asset.stablecoin !== positionRecord.stablecoin
      ) {
        throw new Error('unsupported position');
      }
      return Object.freeze({
        positionId: positionRecord.positionId,
        stablecoin: asset.stablecoin,
        assetIdentity: asset.identity,
        amountAtomic: normalizeBalanceSyncPosition(positionRecord.amountAtomic),
      });
    });
    positions.sort((left, right) => compareCanonical(left.assetIdentity, right.assetIdentity));
    if (
      new Set(positions.map(({ positionId }) => positionId)).size !== positions.length ||
      new Set(positions.map(({ assetIdentity }) => assetIdentity)).size !== positions.length
    ) {
      throw new Error('duplicate positions');
    }
    return Object.freeze({
      walletId: request.walletId,
      networkId: request.networkId,
      tier: request.tier,
      source,
      positions: Object.freeze(positions),
    });
  } catch (error) {
    if (error instanceof BalanceSyncIndexerFailure) throw error;
    throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
  }
}

function parseSourcePoint(
  value: unknown,
  networkId: BalanceSyncScope['networkId'],
  expectedSelector: BalanceSyncSourcePoint['selector'],
  nowMs: number,
  requireIdentity: boolean,
): BalanceSyncSourcePoint {
  const record = exactRecord(value, [
    'position',
    'hash',
    'parentHash',
    'selector',
    'retrievedAt',
    'identityValidated',
  ]);
  const isEvm = networkId.startsWith('eip155:');
  if (
    record.selector !== expectedSelector ||
    typeof record.hash !== 'string' ||
    typeof record.parentHash !== 'string' ||
    (isEvm
      ? !EVM_BLOCK_HASH_PATTERN.test(record.hash) || !EVM_BLOCK_HASH_PATTERN.test(record.parentHash)
      : !SOLANA_HASH_PATTERN.test(record.hash) || !SOLANA_HASH_PATTERN.test(record.parentHash)) ||
    (requireIdentity && record.identityValidated !== true)
  ) {
    throw new TypeError('invalid source point');
  }
  const normalizedHash = isEvm ? record.hash.toLowerCase() : record.hash;
  const normalizedParentHash = isEvm ? record.parentHash.toLowerCase() : record.parentHash;
  if (normalizedHash === normalizedParentHash) throw new TypeError('invalid source point');
  const position = normalizeBalanceSyncPosition(record.position);
  const retrievedAt = parseTimestamp(record.retrievedAt);
  if (retrievedAt.milliseconds > nowMs) throw new TypeError('future source point');
  return Object.freeze({
    position,
    hash: normalizedHash,
    parentHash: normalizedParentHash,
    selector: expectedSelector,
    retrievedAt: retrievedAt.canonical,
  });
}

function createObservation(
  scope: BalanceSyncScope,
  candidate: NormalizedCandidate,
  headAdvancedAt: string,
): BalanceSyncObservation {
  const observationId = createBalanceSyncObservationId({
    ...scope,
    tier: candidate.tier,
    source: candidate.source,
    positions: candidate.positions,
  });
  return Object.freeze({
    observationId,
    ...scope,
    tier: candidate.tier,
    source: candidate.source,
    headAdvancedAt,
    positions: candidate.positions,
  });
}

function continuityAction(
  current: BalanceSyncObservation | null,
  candidate: NormalizedCandidate,
): ChainContinuityAction {
  if (!current) return 'ACCEPT_APPEND';
  return decideChainContinuity({
    networkId: candidate.networkId,
    tier: candidate.tier,
    liveCapabilityProofValidated: false,
    previous: blockReference(current.source),
    candidate: blockReference(candidate.source),
  }).action;
}

function freshnessForCandidate(
  scope: BalanceSyncScope,
  current: BalanceSyncObservation | null,
  candidate: NormalizedCandidate,
  nowMs: number,
): ChainObservationFreshnessDecision {
  return classifyChainObservationFreshness({
    networkId: scope.networkId,
    nowMs,
    identityValidated: true,
    previous: current
      ? Object.freeze({
          position: BigInt(current.source.position),
          advancedAtMs: parseTimestamp(current.headAdvancedAt).milliseconds,
        })
      : null,
    candidate: Object.freeze({
      position: BigInt(candidate.source.position),
      retrievedAtMs: parseTimestamp(candidate.source.retrievedAt).milliseconds,
    }),
  });
}

function blockReference(source: BalanceSyncSourcePoint): Readonly<{
  position: bigint;
  hash: string;
  parentHash: string;
}> {
  return Object.freeze({
    position: BigInt(source.position),
    hash: source.hash,
    parentHash: source.parentHash,
  });
}

function validateCheckpoint(
  value: BalanceSyncCheckpoint | null,
  scope: BalanceSyncScope,
  nowMs: number,
): BalanceSyncCheckpoint | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !sameScope(value.scope, scope) ||
    !['CURRENT', 'STALE', 'UNAVAILABLE', 'QUARANTINED'].includes(value.freshness) ||
    (value.staleSince !== null &&
      (!isCanonicalTimestamp(value.staleSince) || Date.parse(value.staleSince) > nowMs)) ||
    (value.freshness === 'CURRENT'
      ? value.staleSince !== null || value.lastFailureCode !== null
      : value.staleSince === null || value.lastFailureCode === null) ||
    (value.lastFailureCode !== null && !isFailureCode(value.lastFailureCode))
  ) {
    throw new TypeError('invalid checkpoint');
  }
  if (value.currentObservation) {
    const observation = value.currentObservation;
    const threshold = balanceSyncTierThreshold(scope.networkId, observation.tier);
    if (!threshold?.locallyExecutable) throw new TypeError('invalid observation tier');
    const headAdvancedAt = parseTimestamp(observation.headAdvancedAt);
    if (headAdvancedAt.milliseconds > nowMs) throw new TypeError('future current observation');
    const candidate = normalizeCandidate(
      {
        walletId: observation.walletId,
        networkId: observation.networkId,
        tier: observation.tier,
        source: { ...observation.source, identityValidated: true },
        positions: observation.positions,
      },
      { ...scope, tier: observation.tier, selector: threshold.selector },
      nowMs,
    );
    const normalizedObservation = createObservation(scope, candidate, headAdvancedAt.canonical);
    if (
      observation.accountId !== scope.accountId ||
      observation.walletId !== scope.walletId ||
      observation.networkId !== scope.networkId ||
      normalizedObservation.observationId !== observation.observationId
    ) {
      throw new TypeError('invalid current observation');
    }
  }
  if (value.lastFinalizedSource) {
    const financial = balanceSyncTierThreshold(scope.networkId, 'FINANCIAL');
    if (!financial) throw new TypeError('missing financial threshold');
    parseSourcePoint(
      { ...value.lastFinalizedSource, identityValidated: true },
      scope.networkId,
      financial.selector,
      nowMs,
      true,
    );
    if (
      value.currentObservation &&
      BigInt(value.lastFinalizedSource.position) > BigInt(value.currentObservation.source.position)
    ) {
      throw new TypeError('finalized source is ahead of current observation');
    }
  }
  return value;
}

function isFailureCode(value: unknown): value is BalanceSyncFailureCode {
  return [
    'RATE_LIMITED',
    'PROVIDER_TIMEOUT',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_INVALID_DATA',
    'PERMANENT_PROVIDER_FAILURE',
    'REORG_RECOVERY_FAILED',
    'UNCLASSIFIED_FAILURE',
  ].includes(value as BalanceSyncFailureCode);
}

function failureFrom(error: unknown): Readonly<{
  code: BalanceSyncFailureCode;
  retryAfterSeconds?: number;
}> {
  if (error instanceof BalanceSyncIndexerFailure) {
    return error.retryAfterSeconds === undefined
      ? Object.freeze({ code: error.code })
      : Object.freeze({ code: error.code, retryAfterSeconds: error.retryAfterSeconds });
  }
  if (error instanceof BalanceSyncOrchestratorError) throw error;
  return Object.freeze({ code: 'UNCLASSIFIED_FAILURE' });
}

function clockTime(clock: BalanceSyncClockPort): Readonly<{
  canonical: string;
  milliseconds: number;
}> {
  let value: Date;
  try {
    value = clock.now();
  } catch {
    throw orchestratorError('INVALID_BALANCE_SYNC_CLOCK');
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw orchestratorError('INVALID_BALANCE_SYNC_CLOCK');
  }
  return Object.freeze({ canonical: value.toISOString(), milliseconds: value.getTime() });
}

function parseTimestamp(value: unknown): Readonly<{ canonical: string; milliseconds: number }> {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP_PATTERN.test(value)) {
    throw new TypeError('invalid timestamp');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError('invalid timestamp');
  }
  return Object.freeze({ canonical: value, milliseconds });
}

function isCanonicalTimestamp(value: string): boolean {
  try {
    parseTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected record');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('expected data record');
  }
  const ownKeys = Object.keys(value);
  if (
    ownKeys.length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new TypeError('unexpected record shape');
  }
  return value as Record<string, unknown>;
}

function sameScope(left: BalanceSyncScope, right: BalanceSyncScope): boolean {
  return (
    left.accountId === right.accountId &&
    left.walletId === right.walletId &&
    left.networkId === right.networkId
  );
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orchestratorError(code: BalanceSyncOrchestratorErrorCode): BalanceSyncOrchestratorError {
  return new BalanceSyncOrchestratorError(code);
}
