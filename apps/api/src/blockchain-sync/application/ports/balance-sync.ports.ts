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

export interface BalanceSyncScope {
  readonly accountId: string;
  readonly walletId: string;
  readonly networkId: BalanceSyncJobEnvelope['payload']['networkId'];
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

/** No concrete RPC/indexer adapter is registered by KAN-65. */
export interface BalanceSyncIndexerPort {
  readCurrent(request: BalanceIndexerReadRequest): Promise<unknown>;
  rescanFromCheckpoint(request: BalanceIndexerRescanRequest): Promise<unknown>;
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
  load(scope: BalanceSyncScope): Promise<BalanceSyncCheckpoint | null>;
  upsertCurrent(
    input: Readonly<{
      scope: BalanceSyncScope;
      expectedRevision: number | null;
      observation: BalanceSyncObservation;
      mode: BalanceSyncSuccessMode;
      succeededAt: string;
    }>,
  ): Promise<void>;
  replaceProvisionalAfterReorg(
    input: Readonly<{
      scope: BalanceSyncScope;
      expectedRevision: number;
      lastFinalizedSource: BalanceSyncSourcePoint;
      replacement: BalanceSyncObservation;
      recoveredAt: string;
    }>,
  ): Promise<void>;
  preserveLastGoodAndMarkStale(
    input: Readonly<{
      scope: BalanceSyncScope;
      expectedRevision: number | null;
      failedAt: string;
      failureCode: BalanceSyncFailureCode;
    }>,
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
