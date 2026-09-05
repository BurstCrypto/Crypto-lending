import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  BalanceSyncCheckpoint,
  BalanceSyncCheckpointPort,
  BalanceSyncExecutionContext,
  BalanceSyncScope,
  BalanceSyncSuccessMode,
} from '../../application/ports/balance-sync.ports';
import { reviewBalanceSyncExecutionContext } from '../../application/ports/balance-sync.ports';
import {
  BALANCE_SYNC_POLICY,
  createBalanceSyncObservationId,
  normalizeBalanceSyncPosition,
  type BalanceSyncFailureCode,
  type BalanceSyncObservation,
  type BalanceSyncPosition,
  type BalanceSyncSourcePoint,
} from '../../domain/balance-sync';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ETHEREUM_HASH = /^0x[0-9a-f]{64}$/u;
const SOLANA_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const FAILURE_CODES = Object.freeze([
  'RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INVALID_DATA',
  'PERMANENT_PROVIDER_FAILURE',
  'REORG_RECOVERY_FAILED',
  'UNCLASSIFIED_FAILURE',
] as const);

type LaunchNetworkId = typeof ETHEREUM | typeof SOLANA;
type LaunchBalanceSyncScope = Readonly<{
  accountId: string;
  walletId: string;
  networkId: LaunchNetworkId;
}>;

const CHECKPOINT_COLUMNS = Object.freeze([
  'checkpoint_revision',
  'checkpoint_account_id',
  'checkpoint_wallet_id',
  'checkpoint_network_id',
  'checkpoint_current_observation_id',
  'checkpoint_freshness',
  'checkpoint_stale_since',
  'checkpoint_last_failure_code',
  'checkpoint_last_finalized_position',
  'checkpoint_last_finalized_hash',
  'checkpoint_last_finalized_parent_hash',
  'checkpoint_last_finalized_selector',
  'checkpoint_last_finalized_retrieved_at',
  'observation_tier',
  'observation_source_position',
  'observation_source_hash',
  'observation_source_parent_hash',
  'observation_selector',
  'observation_retrieved_at',
  'observation_head_advanced_at',
  'observation_positions',
] as const);

interface CheckpointRow extends QueryResultRow {
  checkpoint_revision: string;
  checkpoint_account_id: string;
  checkpoint_wallet_id: string;
  checkpoint_network_id: string;
  checkpoint_current_observation_id: string | null;
  checkpoint_freshness: string;
  checkpoint_stale_since: Date | null;
  checkpoint_last_failure_code: string | null;
  checkpoint_last_finalized_position: string | null;
  checkpoint_last_finalized_hash: string | null;
  checkpoint_last_finalized_parent_hash: string | null;
  checkpoint_last_finalized_selector: string | null;
  checkpoint_last_finalized_retrieved_at: Date | null;
  observation_tier: string | null;
  observation_source_position: string | null;
  observation_source_hash: string | null;
  observation_source_parent_hash: string | null;
  observation_selector: string | null;
  observation_retrieved_at: Date | null;
  observation_head_advanced_at: Date | null;
  observation_positions: unknown;
}

interface WriteRow extends QueryResultRow {
  write_outcome: string;
  checkpoint_revision: string;
  checkpoint_event_id: string;
}

export class BalanceSyncCheckpointPersistenceError extends Error {
  readonly code = 'BALANCE_SYNC_CHECKPOINT_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Balance sync checkpoint persistence failed');
    this.name = 'BalanceSyncCheckpointPersistenceError';
  }
}

function fail(): never {
  throw new BalanceSyncCheckpointPersistenceError();
}

function activeExecutionSignal(context: unknown): AbortSignal {
  const reviewed = reviewBalanceSyncExecutionContext(context);
  if (reviewed === null || reviewed.abortKind !== null) return fail();
  return reviewed.signal;
}

function dataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof BalanceSyncCheckpointPersistenceError) throw error;
    return fail();
  }
}

function dataArray(value: unknown, expectedLength: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const length = descriptors.length;
    if (
      !length ||
      !('value' in length) ||
      length.value !== expectedLength ||
      length.enumerable !== false ||
      Reflect.ownKeys(descriptors).length !== expectedLength + 1
    ) {
      return fail();
    }
    return Object.freeze(
      Array.from({ length: expectedLength }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
        return descriptor.value;
      }),
    );
  } catch (error) {
    if (error instanceof BalanceSyncCheckpointPersistenceError) throw error;
    return fail();
  }
}

function launchNetwork(value: unknown): LaunchNetworkId {
  if (value !== ETHEREUM && value !== SOLANA) return fail();
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail();
  return value;
}

function timestamp(value: unknown): string {
  const canonical = value instanceof Date ? value.toISOString() : value;
  if (typeof canonical !== 'string' || !CANONICAL_TIMESTAMP.test(canonical)) return fail();
  const milliseconds = Date.parse(canonical);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== canonical) {
    return fail();
  }
  return canonical;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return fail();
  return value;
}

function revision(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  const serialized = typeof value === 'number' ? String(value) : value;
  if (typeof serialized !== 'string' || !/^[1-9][0-9]*$/u.test(serialized)) return fail();
  const parsed = Number(serialized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fail();
  return parsed;
}

function sourcePosition(value: unknown): string {
  const normalized = normalizeBalanceSyncPosition(value);
  if (BigInt(normalized) > UINT64_MAX) return fail();
  return normalized;
}

function sourceHash(value: unknown, networkId: LaunchNetworkId): string {
  if (
    typeof value !== 'string' ||
    !(networkId === ETHEREUM ? ETHEREUM_HASH.test(value) : SOLANA_HASH.test(value))
  ) {
    return fail();
  }
  return value;
}

function scope(value: unknown): LaunchBalanceSyncScope {
  const record = dataRecord(value, ['accountId', 'walletId', 'networkId']);
  return Object.freeze({
    accountId: uuid(record.accountId),
    walletId: uuid(record.walletId),
    networkId: launchNetwork(record.networkId),
  });
}

function failureCode(value: unknown): BalanceSyncFailureCode {
  if (!FAILURE_CODES.includes(value as (typeof FAILURE_CODES)[number])) return fail();
  return value as BalanceSyncFailureCode;
}

function positions(value: unknown, networkId: LaunchNetworkId): readonly BalanceSyncPosition[] {
  const normalized = dataArray(value, 3).map((candidate) => {
    const record = dataRecord(candidate, [
      'positionId',
      'stablecoin',
      'assetIdentity',
      'amountAtomic',
    ]);
    const asset =
      typeof record.assetIdentity === 'string'
        ? MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(networkId, record.assetIdentity)
        : undefined;
    if (
      !asset ||
      asset.activationState !== 'ACTIVE' ||
      asset.identity !== record.assetIdentity ||
      asset.stablecoin !== record.stablecoin ||
      typeof record.positionId !== 'string' ||
      !SHA256.test(record.positionId)
    ) {
      return fail();
    }
    return Object.freeze({
      positionId: record.positionId,
      stablecoin: asset.stablecoin,
      assetIdentity: asset.identity,
      amountAtomic: normalizeBalanceSyncPosition(record.amountAtomic),
    });
  });
  normalized.sort((left, right) => left.positionId.localeCompare(right.positionId));
  if (
    new Set(normalized.map(({ positionId }) => positionId)).size !== 3 ||
    new Set(normalized.map(({ stablecoin }) => stablecoin)).size !== 3 ||
    new Set(normalized.map(({ assetIdentity }) => assetIdentity)).size !== 3
  ) {
    return fail();
  }
  return Object.freeze(normalized);
}

function source(
  value: unknown,
  networkId: LaunchNetworkId,
  selector: 'latest' | 'confirmed' | 'finalized',
): BalanceSyncSourcePoint {
  const record = dataRecord(value, ['position', 'hash', 'parentHash', 'selector', 'retrievedAt']);
  if (record.selector !== selector) return fail();
  const hash = sourceHash(record.hash, networkId);
  const parentHash = sourceHash(record.parentHash, networkId);
  if (hash === parentHash) return fail();
  return Object.freeze({
    position: sourcePosition(record.position),
    hash,
    parentHash,
    selector,
    retrievedAt: timestamp(record.retrievedAt),
  });
}

function observation(
  value: unknown,
  expectedScope: LaunchBalanceSyncScope,
): BalanceSyncObservation {
  const record = dataRecord(value, [
    'observationId',
    'accountId',
    'walletId',
    'networkId',
    'tier',
    'source',
    'headAdvancedAt',
    'positions',
  ]);
  const parsedScope = scope({
    accountId: record.accountId,
    walletId: record.walletId,
    networkId: record.networkId,
  });
  if (
    parsedScope.accountId !== expectedScope.accountId ||
    parsedScope.walletId !== expectedScope.walletId ||
    parsedScope.networkId !== expectedScope.networkId ||
    record.tier !== BALANCE_SYNC_POLICY.localExecutableTier
  ) {
    return fail();
  }
  const expectedSelector = parsedScope.networkId === ETHEREUM ? 'latest' : 'confirmed';
  const parsedSource = source(record.source, parsedScope.networkId, expectedSelector);
  const parsedPositions = positions(record.positions, parsedScope.networkId);
  const observationId = digest(record.observationId);
  if (
    observationId !==
    createBalanceSyncObservationId({
      ...parsedScope,
      tier: 'PROVISIONAL',
      source: parsedSource,
      positions: parsedPositions,
    })
  ) {
    return fail();
  }
  return Object.freeze({
    observationId,
    ...parsedScope,
    tier: 'PROVISIONAL',
    source: parsedSource,
    headAdvancedAt: timestamp(record.headAdvancedAt),
    positions: parsedPositions,
  });
}

function writeResult(rows: readonly WriteRow[], expectedRevision: number): void {
  const row = rows[0];
  if (!row || rows.length !== 1) return fail();
  const record = dataRecord(row, ['write_outcome', 'checkpoint_revision', 'checkpoint_event_id']);
  if (
    (record.write_outcome !== 'APPLIED' && record.write_outcome !== 'IDEMPOTENT_REPLAY') ||
    revision(record.checkpoint_revision) !== expectedRevision ||
    typeof record.checkpoint_event_id !== 'string' ||
    !SHA256.test(record.checkpoint_event_id)
  ) {
    return fail();
  }
}

function oneCheckpointRow(rows: readonly CheckpointRow[]): CheckpointRow {
  const row = rows[0];
  if (!row || rows.length !== 1) return fail();
  dataRecord(row, CHECKPOINT_COLUMNS);
  return row;
}

function mapCheckpoint(
  row: CheckpointRow,
  expectedScope: LaunchBalanceSyncScope,
): BalanceSyncCheckpoint {
  const parsedScope = scope({
    accountId: row.checkpoint_account_id,
    walletId: row.checkpoint_wallet_id,
    networkId: row.checkpoint_network_id,
  });
  if (
    parsedScope.accountId !== expectedScope.accountId ||
    parsedScope.walletId !== expectedScope.walletId ||
    parsedScope.networkId !== expectedScope.networkId
  ) {
    return fail();
  }
  const freshness = row.checkpoint_freshness;
  if (
    freshness !== 'CURRENT' &&
    freshness !== 'STALE' &&
    freshness !== 'UNAVAILABLE' &&
    freshness !== 'QUARANTINED'
  ) {
    return fail();
  }
  const staleSince =
    row.checkpoint_stale_since === null ? null : timestamp(row.checkpoint_stale_since);
  const lastFailureCode =
    row.checkpoint_last_failure_code === null
      ? null
      : failureCode(row.checkpoint_last_failure_code);
  if (
    (freshness === 'CURRENT' && (staleSince !== null || lastFailureCode !== null)) ||
    (freshness !== 'CURRENT' && (staleSince === null || lastFailureCode === null))
  ) {
    return fail();
  }

  let currentObservation: BalanceSyncObservation | null = null;
  if (row.checkpoint_current_observation_id !== null) {
    if (
      row.observation_tier !== 'PROVISIONAL' ||
      row.observation_source_position === null ||
      row.observation_source_hash === null ||
      row.observation_source_parent_hash === null ||
      row.observation_selector === null ||
      row.observation_retrieved_at === null ||
      row.observation_head_advanced_at === null
    ) {
      return fail();
    }
    currentObservation = observation(
      {
        observationId: row.checkpoint_current_observation_id,
        ...parsedScope,
        tier: row.observation_tier,
        source: {
          position: row.observation_source_position,
          hash: row.observation_source_hash,
          parentHash: row.observation_source_parent_hash,
          selector: row.observation_selector,
          retrievedAt: row.observation_retrieved_at,
        },
        headAdvancedAt: row.observation_head_advanced_at,
        positions: row.observation_positions,
      },
      parsedScope,
    );
  } else if (
    row.observation_tier !== null ||
    row.observation_source_position !== null ||
    row.observation_source_hash !== null ||
    row.observation_source_parent_hash !== null ||
    row.observation_selector !== null ||
    row.observation_retrieved_at !== null ||
    row.observation_head_advanced_at !== null ||
    row.observation_positions !== null ||
    freshness !== 'UNAVAILABLE'
  ) {
    return fail();
  }

  const finalizedValues = [
    row.checkpoint_last_finalized_position,
    row.checkpoint_last_finalized_hash,
    row.checkpoint_last_finalized_parent_hash,
    row.checkpoint_last_finalized_selector,
    row.checkpoint_last_finalized_retrieved_at,
  ];
  let lastFinalizedSource: BalanceSyncSourcePoint | null;
  if (finalizedValues.every((value) => value === null)) {
    lastFinalizedSource = null;
  } else if (finalizedValues.some((value) => value === null)) {
    return fail();
  } else {
    lastFinalizedSource = source(
      {
        position: row.checkpoint_last_finalized_position,
        hash: row.checkpoint_last_finalized_hash,
        parentHash: row.checkpoint_last_finalized_parent_hash,
        selector: row.checkpoint_last_finalized_selector,
        retrievedAt: row.checkpoint_last_finalized_retrieved_at,
      },
      parsedScope.networkId,
      'finalized',
    );
  }

  return Object.freeze({
    revision: revision(row.checkpoint_revision) ?? fail(),
    scope: parsedScope,
    currentObservation,
    lastFinalizedSource,
    freshness,
    staleSince,
    lastFailureCode,
  });
}

@Injectable()
export class PostgresBalanceSyncCheckpointRepository implements BalanceSyncCheckpointPort {
  constructor(private readonly postgres: PostgresService) {}

  async load(
    input: BalanceSyncScope,
    context: BalanceSyncExecutionContext,
  ): Promise<BalanceSyncCheckpoint | null> {
    try {
      const signal = activeExecutionSignal(context);
      const parsedScope = scope(input);
      const result = await this.postgres.queryWithCancellation<CheckpointRow>(
        `SELECT checkpoint.*
         FROM read_balance_sync_checkpoint($1::uuid, $2::uuid, $3::text) AS checkpoint`,
        [parsedScope.accountId, parsedScope.walletId, parsedScope.networkId],
        signal,
      );
      activeExecutionSignal(context);
      if (result.rows.length === 0) return null;
      return mapCheckpoint(oneCheckpointRow(result.rows), parsedScope);
    } catch (error) {
      if (error instanceof BalanceSyncCheckpointPersistenceError) throw error;
      return fail();
    }
  }

  async upsertCurrent(
    input: Parameters<BalanceSyncCheckpointPort['upsertCurrent']>[0],
    context: BalanceSyncExecutionContext,
  ): Promise<void> {
    try {
      const signal = activeExecutionSignal(context);
      const record = dataRecord(input, [
        'scope',
        'expectedRevision',
        'observation',
        'mode',
        'succeededAt',
      ]);
      const parsedScope = scope(record.scope);
      const expectedRevision = revision(record.expectedRevision, true);
      const parsedObservation = observation(record.observation, parsedScope);
      const mode = record.mode as BalanceSyncSuccessMode;
      if (mode !== 'CREATED' && mode !== 'UPDATED' && mode !== 'UNCHANGED') return fail();
      const succeededAt = timestamp(record.succeededAt);
      const result = await this.postgres.queryWithCancellation<WriteRow>(
        `SELECT written.* FROM record_balance_sync_current(
           $1::uuid, $2::uuid, $3::text, $4::bigint, $5::text,
           $6::text, $7::numeric, $8::text, $9::text, $10::text,
           $11::timestamptz, $12::timestamptz, $13::jsonb, $14::timestamptz
         ) AS written`,
        [
          parsedScope.accountId,
          parsedScope.walletId,
          parsedScope.networkId,
          expectedRevision,
          mode,
          parsedObservation.observationId,
          parsedObservation.source.position,
          parsedObservation.source.hash,
          parsedObservation.source.parentHash,
          parsedObservation.source.selector,
          parsedObservation.source.retrievedAt,
          parsedObservation.headAdvancedAt,
          JSON.stringify(parsedObservation.positions),
          succeededAt,
        ],
        signal,
      );
      activeExecutionSignal(context);
      writeResult(result.rows, (expectedRevision ?? 0) + 1);
    } catch (error) {
      if (error instanceof BalanceSyncCheckpointPersistenceError) throw error;
      return fail();
    }
  }

  async replaceProvisionalAfterReorg(
    input: Parameters<BalanceSyncCheckpointPort['replaceProvisionalAfterReorg']>[0],
    context: BalanceSyncExecutionContext,
  ): Promise<void> {
    try {
      const signal = activeExecutionSignal(context);
      const record = dataRecord(input, [
        'scope',
        'expectedRevision',
        'lastFinalizedSource',
        'replacement',
        'recoveredAt',
      ]);
      const parsedScope = scope(record.scope);
      const expectedRevision = revision(record.expectedRevision) ?? fail();
      const anchor = source(record.lastFinalizedSource, parsedScope.networkId, 'finalized');
      const replacement = observation(record.replacement, parsedScope);
      const recoveredAt = timestamp(record.recoveredAt);
      const result = await this.postgres.queryWithCancellation<WriteRow>(
        `SELECT written.* FROM replace_balance_sync_after_reorg(
           $1::uuid, $2::uuid, $3::text, $4::bigint,
           $5::numeric, $6::text, $7::text, $8::text, $9::timestamptz,
           $10::text, $11::numeric, $12::text, $13::text, $14::text,
           $15::timestamptz, $16::timestamptz, $17::jsonb, $18::timestamptz
         ) AS written`,
        [
          parsedScope.accountId,
          parsedScope.walletId,
          parsedScope.networkId,
          expectedRevision,
          anchor.position,
          anchor.hash,
          anchor.parentHash,
          anchor.selector,
          anchor.retrievedAt,
          replacement.observationId,
          replacement.source.position,
          replacement.source.hash,
          replacement.source.parentHash,
          replacement.source.selector,
          replacement.source.retrievedAt,
          replacement.headAdvancedAt,
          JSON.stringify(replacement.positions),
          recoveredAt,
        ],
        signal,
      );
      activeExecutionSignal(context);
      writeResult(result.rows, expectedRevision + 1);
    } catch (error) {
      if (error instanceof BalanceSyncCheckpointPersistenceError) throw error;
      return fail();
    }
  }

  async preserveLastGoodAndMarkStale(
    input: Parameters<BalanceSyncCheckpointPort['preserveLastGoodAndMarkStale']>[0],
    context: BalanceSyncExecutionContext,
  ): Promise<void> {
    try {
      const signal = activeExecutionSignal(context);
      const record = dataRecord(input, ['scope', 'expectedRevision', 'failedAt', 'failureCode']);
      const parsedScope = scope(record.scope);
      const expectedRevision = revision(record.expectedRevision, true);
      const failedAt = timestamp(record.failedAt);
      const parsedFailureCode = failureCode(record.failureCode);
      const result = await this.postgres.queryWithCancellation<WriteRow>(
        `SELECT written.* FROM mark_balance_sync_checkpoint_stale(
           $1::uuid, $2::uuid, $3::text, $4::bigint, $5::timestamptz, $6::text
         ) AS written`,
        [
          parsedScope.accountId,
          parsedScope.walletId,
          parsedScope.networkId,
          expectedRevision,
          failedAt,
          parsedFailureCode,
        ],
        signal,
      );
      activeExecutionSignal(context);
      writeResult(result.rows, (expectedRevision ?? 0) + 1);
    } catch (error) {
      if (error instanceof BalanceSyncCheckpointPersistenceError) throw error;
      return fail();
    }
  }
}
