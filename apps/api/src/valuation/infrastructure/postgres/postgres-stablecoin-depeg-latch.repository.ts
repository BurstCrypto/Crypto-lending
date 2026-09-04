import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  ClearStablecoinDepegLatchOutcome,
  ClearStablecoinDepegLatchRequest,
  ClearStablecoinDepegLatchResult,
  RecordStablecoinDepegLatchOutcome,
  RecordStablecoinDepegLatchRequest,
  RecordStablecoinDepegLatchResult,
  StablecoinDepegLatch,
  StablecoinDepegLatchRepository,
} from '../../application/ports/stablecoin-depeg-latch.port';
import {
  normalizeClearStablecoinDepegLatchCommand,
  normalizeRecordStablecoinDepegLatchCommand,
  normalizeStablecoinDepegLatchAsset,
} from '../../domain/stablecoin-depeg-latch';
import type { StablecoinValuationAssetReference } from '../../domain/stablecoin-valuation-policy';

const SHA256 = /^[0-9a-f]{64}$/u;
const REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const PROJECTION_COLUMNS = Object.freeze([
  'projection_schema_version',
  'projection_registry_environment',
  'projection_registry_version',
  'projection_registry_fingerprint',
  'projection_stablecoin',
  'projection_network_id',
  'projection_asset_identity',
  'projection_asset_decimals',
  'projection_revision',
  'projection_status',
  'projection_latch_id',
  'projection_latched_at',
  'projection_depeg_evidence_fingerprint',
  'projection_evidence_actor_reference_id',
  'projection_clear_id',
  'projection_cleared_at',
  'projection_risk_approver_reference_id',
  'projection_last_event_id',
  'projection_last_event_fingerprint',
  'projection_updated_at',
] as const);

interface ProjectionRow extends QueryResultRow {
  projection_schema_version: number | null;
  projection_registry_environment: string | null;
  projection_registry_version: number | null;
  projection_registry_fingerprint: string | null;
  projection_stablecoin: string | null;
  projection_network_id: string | null;
  projection_asset_identity: string | null;
  projection_asset_decimals: number | null;
  projection_revision: string | null;
  projection_status: string | null;
  projection_latch_id: string | null;
  projection_latched_at: Date | null;
  projection_depeg_evidence_fingerprint: string | null;
  projection_evidence_actor_reference_id: string | null;
  projection_clear_id: string | null;
  projection_cleared_at: Date | null;
  projection_risk_approver_reference_id: string | null;
  projection_last_event_id: string | null;
  projection_last_event_fingerprint: string | null;
  projection_updated_at: Date | null;
}

interface RecordRow extends ProjectionRow {
  record_outcome: string;
}

interface ClearRow extends ProjectionRow {
  clear_outcome: string;
}

export class StablecoinDepegLatchPersistenceError extends Error {
  readonly code = 'STABLECOIN_DEPEG_LATCH_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Stablecoin depeg latch persistence failed');
    this.name = 'StablecoinDepegLatchPersistenceError';
  }
}

function persistenceFailure(): never {
  throw new StablecoinDepegLatchPersistenceError();
}

function ownRow<Row extends QueryResultRow>(
  value: unknown,
  additionalColumns: readonly string[] = [],
): Row {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return persistenceFailure();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return persistenceFailure();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = [...additionalColumns, ...PROJECTION_COLUMNS];
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return persistenceFailure();
    }
    for (const key of expected) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return persistenceFailure();
    }
    return value as Row;
  } catch (error) {
    if (error instanceof StablecoinDepegLatchPersistenceError) throw error;
    return persistenceFailure();
  }
}

function oneRow<Row extends QueryResultRow>(
  rows: readonly Row[],
  additionalColumns: readonly string[] = [],
): Row {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) return persistenceFailure();
  return ownRow<Row>(rows[0], additionalColumns);
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return persistenceFailure();
  return value.toISOString();
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return persistenceFailure();
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !REFERENCE.test(value)) return persistenceFailure();
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) {
    return persistenceFailure();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return persistenceFailure();
  return parsed;
}

function isNullProjection(row: ProjectionRow): boolean {
  return PROJECTION_COLUMNS.every((column) => row[column] === null);
}

function mapProjection(row: ProjectionRow): StablecoinDepegLatch | null {
  if (isNullProjection(row)) return null;
  const asset = normalizeStablecoinDepegLatchAsset({
    registryEnvironment: row.projection_registry_environment,
    registryVersion: row.projection_registry_version,
    registryFingerprintSha256: row.projection_registry_fingerprint,
    stablecoin: row.projection_stablecoin,
    networkId: row.projection_network_id,
    identity: row.projection_asset_identity,
    decimals: row.projection_asset_decimals,
  });
  if (row.projection_schema_version !== 1) return persistenceFailure();
  const status = row.projection_status;
  if (status !== 'LATCHED' && status !== 'CLEARED') return persistenceFailure();
  const clearId = row.projection_clear_id;
  const clearedAt = row.projection_cleared_at;
  const approver = row.projection_risk_approver_reference_id;
  const latchId = digest(row.projection_latch_id);
  const evidenceActorReferenceId = reference(row.projection_evidence_actor_reference_id);
  const lastEventId = digest(row.projection_last_event_id);
  const latchedAtText = timestamp(row.projection_latched_at);
  const updatedAtText = timestamp(row.projection_updated_at);
  const latchedAtMilliseconds = Date.parse(latchedAtText);
  const updatedAtMilliseconds = Date.parse(updatedAtText);
  if (
    (status === 'LATCHED' &&
      (clearId !== null ||
        clearedAt !== null ||
        approver !== null ||
        lastEventId !== latchId ||
        updatedAtMilliseconds < latchedAtMilliseconds)) ||
    (status === 'CLEARED' &&
      (typeof clearId !== 'string' ||
        !(clearedAt instanceof Date) ||
        typeof approver !== 'string' ||
        lastEventId !== clearId ||
        approver === evidenceActorReferenceId ||
        clearedAt.getTime() < latchedAtMilliseconds ||
        updatedAtMilliseconds < clearedAt.getTime()))
  ) {
    return persistenceFailure();
  }
  return Object.freeze({
    schemaVersion: 1,
    asset,
    revision: revision(row.projection_revision),
    status,
    latchId,
    latchedAt: latchedAtText,
    depegEvidenceFingerprintSha256: digest(row.projection_depeg_evidence_fingerprint),
    evidenceActorReferenceId,
    clearId: clearId === null ? null : digest(clearId),
    clearedAt: clearedAt === null ? null : timestamp(clearedAt),
    riskApproverReferenceId: approver === null ? null : reference(approver),
    lastEventId,
    lastEventFingerprintSha256: digest(row.projection_last_event_fingerprint),
    updatedAt: updatedAtText,
  });
}

function recordOutcome(value: unknown): RecordStablecoinDepegLatchOutcome {
  if (
    value !== 'LATCHED' &&
    value !== 'RELATCHED' &&
    value !== 'IDEMPOTENT_REPLAY' &&
    value !== 'ALREADY_LATCHED' &&
    value !== 'REVISION_CONFLICT'
  ) {
    return persistenceFailure();
  }
  return value;
}

function clearOutcome(value: unknown): ClearStablecoinDepegLatchOutcome {
  if (
    value !== 'CLEARED' &&
    value !== 'IDEMPOTENT_REPLAY' &&
    value !== 'LATCH_NOT_FOUND' &&
    value !== 'LATCH_STATUS_MISMATCH' &&
    value !== 'REVISION_CONFLICT' &&
    value !== 'LATCH_BINDING_MISMATCH' &&
    value !== 'AUTHORIZATION_EXPIRED'
  ) {
    return persistenceFailure();
  }
  return value;
}

/**
 * Dormant adapter. No Nest module registers it. The migration grants runtime
 * roles read and worker latch-only access; no runtime role can execute clear.
 */
@Injectable()
export class PostgresStablecoinDepegLatchRepository implements StablecoinDepegLatchRepository {
  constructor(private readonly postgres: PostgresService) {}

  async loadCurrent(
    assetValue: StablecoinValuationAssetReference,
  ): Promise<StablecoinDepegLatch | null> {
    try {
      const asset = normalizeStablecoinDepegLatchAsset(assetValue);
      const result = await this.postgres.query<ProjectionRow>(
        `SELECT projection.*
         FROM read_stablecoin_depeg_latch(
           $1::text, $2::smallint, $3::text, $4::text,
           $5::text, $6::text, $7::smallint
         ) AS projection`,
        [
          asset.registryEnvironment,
          asset.registryVersion,
          asset.registryFingerprintSha256,
          asset.stablecoin,
          asset.networkId,
          asset.identity,
          asset.decimals,
        ],
      );
      if (result.rows.length === 0) return null;
      return mapProjection(oneRow(result.rows));
    } catch (error) {
      if (error instanceof StablecoinDepegLatchPersistenceError) throw error;
      return persistenceFailure();
    }
  }

  async record(
    request: RecordStablecoinDepegLatchRequest,
  ): Promise<RecordStablecoinDepegLatchResult> {
    try {
      const command = normalizeRecordStablecoinDepegLatchCommand(request);
      const asset = command.asset;
      const result = await this.postgres.query<RecordRow>(
        `SELECT recorded.*
         FROM record_stablecoin_depeg_latch(
           $1::bigint, $2::uuid, $3::text, $4::text, $5::smallint,
           $6::text, $7::text, $8::text, $9::smallint, $10::timestamptz,
           $11::text, $12::text, $13::text, $14::text, $15::text
         ) AS recorded`,
        [
          command.expectedRevision,
          command.correlationId,
          command.latchId,
          asset.registryEnvironment,
          asset.registryVersion,
          asset.registryFingerprintSha256,
          asset.stablecoin,
          asset.networkId,
          asset.decimals,
          command.latchedAt,
          asset.identity,
          command.evidenceActorReferenceId,
          command.depegEvidenceFingerprintSha256,
          command.commandFingerprintSha256,
          command.eventFingerprintSha256,
        ],
      );
      const row = oneRow<RecordRow>(result.rows, ['record_outcome']);
      const outcome = recordOutcome(row.record_outcome);
      const latch = mapProjection(row);
      if (
        (latch === null && outcome !== 'REVISION_CONFLICT') ||
        (latch !== null &&
          (outcome === 'LATCHED' || outcome === 'RELATCHED' || outcome === 'ALREADY_LATCHED') &&
          latch.status !== 'LATCHED')
      ) {
        return persistenceFailure();
      }
      return Object.freeze({
        outcome,
        latch,
      });
    } catch (error) {
      if (error instanceof StablecoinDepegLatchPersistenceError) throw error;
      return persistenceFailure();
    }
  }

  async clear(request: ClearStablecoinDepegLatchRequest): Promise<ClearStablecoinDepegLatchResult> {
    try {
      const command = normalizeClearStablecoinDepegLatchCommand(request);
      const asset = command.asset;
      const result = await this.postgres.query<ClearRow>(
        `SELECT cleared.*
         FROM clear_stablecoin_depeg_latch(
           $1::uuid, $2::text, $3::smallint, $4::text, $5::text,
           $6::text, $7::smallint, $8::text, $9::text, $10::timestamptz,
           $11::bigint, $12::text, $13::text, $14::text, $15::text,
           $16::text, $17::timestamptz, $18::timestamptz, $19::timestamptz,
           $20::timestamptz, $21::timestamptz, $22::uuid, $23::text,
           $24::text, $25::text, $26::text
         ) AS cleared`,
        [
          command.correlationId,
          asset.registryEnvironment,
          asset.registryVersion,
          asset.registryFingerprintSha256,
          asset.stablecoin,
          asset.networkId,
          asset.decimals,
          asset.identity,
          command.clearId,
          command.latchedAt,
          command.expectedRevision,
          command.latchId,
          command.recoveryEvidenceFingerprintSha256,
          command.evidenceActorReferenceId,
          command.riskApproverReferenceId,
          command.riskApproverRole,
          command.clearedAt,
          command.authorizationIssuedAt,
          command.authorizationNotBefore,
          command.authorizationExpiresAt,
          command.evaluatedAt,
          command.authorizationNonce,
          command.authorizationFingerprintSha256,
          command.authorizationId,
          command.commandFingerprintSha256,
          command.eventFingerprintSha256,
        ],
      );
      const row = oneRow<ClearRow>(result.rows, ['clear_outcome']);
      const outcome = clearOutcome(row.clear_outcome);
      const latch = mapProjection(row);
      if (
        (outcome === 'LATCH_NOT_FOUND' && latch !== null) ||
        (outcome !== 'LATCH_NOT_FOUND' && latch === null) ||
        (outcome === 'CLEARED' && latch?.status !== 'CLEARED') ||
        (outcome === 'LATCH_STATUS_MISMATCH' && latch?.status !== 'CLEARED') ||
        (outcome === 'LATCH_BINDING_MISMATCH' && latch?.status !== 'LATCHED')
      ) {
        return persistenceFailure();
      }
      return Object.freeze({
        outcome,
        latch,
      });
    } catch (error) {
      if (error instanceof StablecoinDepegLatchPersistenceError) throw error;
      return persistenceFailure();
    }
  }
}
