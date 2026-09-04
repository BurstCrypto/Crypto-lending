import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  AaveV3EthereumFinalizedCheckpoint,
  AaveV3EthereumFinalizedCheckpointQuarantineReason,
  AaveV3EthereumFinalizedCheckpointRecordOutcome,
  AaveV3EthereumFinalizedCheckpointRecoveryOutcome,
  AaveV3EthereumFinalizedCheckpointRepository,
  RecoverAaveV3EthereumFinalizedCheckpointRequest,
  RecoverAaveV3EthereumFinalizedCheckpointResult,
  RecordAaveV3EthereumFinalizedCheckpointRequest,
  RecordAaveV3EthereumFinalizedCheckpointResult,
} from '../../application/ports/aave-v3-ethereum-finalized-checkpoint.port';
import { normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand } from '../../domain/aave-v3-ethereum-finalized-checkpoint-recovery';
import {
  AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING,
  normalizeAaveV3EthereumFinalizedCheckpointCommand,
} from '../../domain/aave-v3-ethereum-finalized-checkpoint';

const OPAQUE_REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const UINT64_DECIMAL = /^(?:[1-9][0-9]{0,19})$/u;
const MAX_UINT64 = (1n << 64n) - 1n;

interface CheckpointRow extends QueryResultRow {
  checkpoint_schema_version: number | null;
  checkpoint_deployment_id: string | null;
  checkpoint_network_id: string | null;
  checkpoint_source_reference_id: string | null;
  checkpoint_manifest_fingerprint: string | null;
  checkpoint_registry_fingerprint: string | null;
  checkpoint_read_plan_fingerprint: string | null;
  checkpoint_revision: string | null;
  checkpoint_status: string | null;
  checkpoint_block_number: string | null;
  checkpoint_block_hash: string | null;
  checkpoint_parent_hash: string | null;
  checkpoint_state_root: string | null;
  checkpoint_block_timestamp: Date | null;
  checkpoint_source_observation_id: string | null;
  checkpoint_evidence_fingerprint: string | null;
  checkpoint_content_fingerprint: string | null;
  checkpoint_observed_at: Date | null;
  checkpoint_finalized_advanced_at: Date | null;
  checkpoint_last_validated_at: Date | null;
  checkpoint_quarantine_reason: string | null;
  checkpoint_quarantined_at: Date | null;
}

interface RecordRow extends CheckpointRow {
  record_outcome: string;
}

interface RecoveryRow extends CheckpointRow {
  recovery_outcome: string;
}

export class AaveV3EthereumFinalizedCheckpointPersistenceError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_PERSISTENCE_FAILED' as const;

  constructor() {
    super('Aave V3 Ethereum finalized checkpoint persistence failed');
    this.name = 'AaveV3EthereumFinalizedCheckpointPersistenceError';
  }
}

function persistenceFailure(): never {
  throw new AaveV3EthereumFinalizedCheckpointPersistenceError();
}

function oneRow<Row extends QueryResultRow>(rows: readonly Row[]): Row {
  const row = rows[0];
  if (!row || rows.length !== 1) return persistenceFailure();
  return row;
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
  if (typeof value !== 'string' || !OPAQUE_REFERENCE.test(value)) return persistenceFailure();
  return value;
}

function hash(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !BLOCK_HASH.test(value)) return persistenceFailure();
  return value as `0x${string}`;
}

function revision(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) return persistenceFailure();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return persistenceFailure();
  return parsed;
}

function blockNumber(value: unknown): bigint {
  if (typeof value !== 'string' || !UINT64_DECIMAL.test(value)) return persistenceFailure();
  const parsed = BigInt(value);
  if (parsed < 1n || parsed > MAX_UINT64) return persistenceFailure();
  return parsed;
}

function quarantineReason(
  value: unknown,
): AaveV3EthereumFinalizedCheckpointQuarantineReason | null {
  if (value === null) return null;
  if (
    value !== 'FINALIZED_HEIGHT_REGRESSION' &&
    value !== 'FINALIZED_BLOCK_DIVERGENCE' &&
    value !== 'FINALIZED_PARENT_MISMATCH' &&
    value !== 'FINALIZED_TIMESTAMP_REGRESSION' &&
    value !== 'SAME_BLOCK_EVIDENCE_DIVERGENCE'
  ) {
    return persistenceFailure();
  }
  return value;
}

function recordOutcome(value: unknown): AaveV3EthereumFinalizedCheckpointRecordOutcome {
  if (
    value !== 'CREATED' &&
    value !== 'ADVANCED' &&
    value !== 'REOBSERVED' &&
    value !== 'CONTINUITY_REQUIRED' &&
    value !== 'QUARANTINED' &&
    value !== 'ALREADY_QUARANTINED' &&
    value !== 'OBSERVATION_TIME_REGRESSION' &&
    value !== 'REVISION_CONFLICT' &&
    value !== 'IDEMPOTENT_REPLAY'
  ) {
    return persistenceFailure();
  }
  return value;
}

function recoveryOutcome(value: unknown): AaveV3EthereumFinalizedCheckpointRecoveryOutcome {
  if (
    value !== 'BACKFILLED' &&
    value !== 'RECOVERED' &&
    value !== 'IDEMPOTENT_REPLAY' &&
    value !== 'CHECKPOINT_NOT_FOUND' &&
    value !== 'CHECKPOINT_STATUS_MISMATCH' &&
    value !== 'REVISION_CONFLICT' &&
    value !== 'HEAD_BINDING_MISMATCH' &&
    value !== 'AUTHORIZATION_EXPIRED'
  ) {
    return persistenceFailure();
  }
  return value;
}

function isNullCheckpoint(row: CheckpointRow): boolean {
  return Object.entries(row)
    .filter(([key]) => key.startsWith('checkpoint_'))
    .every(([, value]) => value === null);
}

function mapCheckpoint(row: CheckpointRow): AaveV3EthereumFinalizedCheckpoint | null {
  if (isNullCheckpoint(row)) return null;
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  const status = row.checkpoint_status;
  if (
    row.checkpoint_schema_version !== binding.schemaVersion ||
    row.checkpoint_deployment_id !== binding.deploymentId ||
    row.checkpoint_network_id !== binding.networkId ||
    row.checkpoint_manifest_fingerprint !== binding.deploymentManifestFingerprintSha256 ||
    row.checkpoint_registry_fingerprint !== binding.assetRegistryFingerprintSha256 ||
    row.checkpoint_read_plan_fingerprint !== binding.readPlanFingerprintSha256 ||
    (status !== 'ACTIVE' && status !== 'QUARANTINED')
  ) {
    return persistenceFailure();
  }
  const reason = quarantineReason(row.checkpoint_quarantine_reason);
  const quarantinedAt =
    row.checkpoint_quarantined_at === null ? null : timestamp(row.checkpoint_quarantined_at);
  if (
    (status === 'ACTIVE' && (reason !== null || quarantinedAt !== null)) ||
    (status === 'QUARANTINED' && (reason === null || quarantinedAt === null))
  ) {
    return persistenceFailure();
  }
  return Object.freeze({
    schemaVersion: 1,
    deploymentId: binding.deploymentId,
    networkId: binding.networkId,
    sourceReferenceId: reference(row.checkpoint_source_reference_id),
    deploymentManifestFingerprintSha256: digest(row.checkpoint_manifest_fingerprint),
    assetRegistryFingerprintSha256: digest(row.checkpoint_registry_fingerprint),
    readPlanFingerprintSha256: digest(row.checkpoint_read_plan_fingerprint),
    revision: revision(row.checkpoint_revision),
    status,
    finalizedBlock: Object.freeze({
      number: blockNumber(row.checkpoint_block_number),
      hash: hash(row.checkpoint_block_hash),
      parentHash: hash(row.checkpoint_parent_hash),
      stateRoot: hash(row.checkpoint_state_root),
      timestamp: timestamp(row.checkpoint_block_timestamp),
    }),
    sourceObservationId: reference(row.checkpoint_source_observation_id),
    evidenceFingerprintSha256: digest(row.checkpoint_evidence_fingerprint),
    contentFingerprintSha256: digest(row.checkpoint_content_fingerprint),
    observedAt: timestamp(row.checkpoint_observed_at),
    finalizedAdvancedAt: timestamp(row.checkpoint_finalized_advanced_at),
    lastValidatedAt: timestamp(row.checkpoint_last_validated_at),
    quarantineReason: reason,
    quarantinedAt,
  });
}

/**
 * Durable adapter candidate for the worker-owned checkpoint capability. It is
 * deliberately absent from SmartLendingModule until provider, egress, live
 * finality, continuity, and operational ownership gates are approved.
 */
@Injectable()
export class PostgresAaveV3EthereumFinalizedCheckpointRepository implements AaveV3EthereumFinalizedCheckpointRepository {
  constructor(private readonly postgres: PostgresService) {}

  async loadCurrent(sourceReferenceId: string): Promise<AaveV3EthereumFinalizedCheckpoint | null> {
    try {
      const result = await this.postgres.query<CheckpointRow>(
        `SELECT checkpoint.*
         FROM read_aave_v3_ethereum_finalized_checkpoint($1::text) AS checkpoint`,
        [reference(sourceReferenceId)],
      );
      if (result.rows.length === 0) return null;
      return mapCheckpoint(oneRow(result.rows));
    } catch (error) {
      if (error instanceof AaveV3EthereumFinalizedCheckpointPersistenceError) throw error;
      return persistenceFailure();
    }
  }

  async record(
    request: RecordAaveV3EthereumFinalizedCheckpointRequest,
  ): Promise<RecordAaveV3EthereumFinalizedCheckpointResult> {
    try {
      const command = normalizeAaveV3EthereumFinalizedCheckpointCommand(request);
      const result = await this.postgres.query<RecordRow>(
        `SELECT recorded.*
         FROM record_aave_v3_ethereum_finalized_checkpoint(
           $1::bigint, $2::uuid, $3::text, $4::text, $5::text,
           $6::text, $7::text, $8::numeric, $9::text, $10::text,
           $11::text, $12::timestamptz, $13::timestamptz
         ) AS recorded`,
        [
          command.expectedRevision,
          command.correlationId,
          command.sourceReferenceId,
          command.sourceObservationId,
          command.evidenceFingerprintSha256,
          command.contentFingerprintSha256,
          command.commandFingerprintSha256,
          command.finalizedBlock.number.toString(),
          command.finalizedBlock.hash,
          command.finalizedBlock.parentHash,
          command.finalizedBlock.stateRoot,
          command.finalizedBlock.timestamp,
          command.observedAt,
        ],
      );
      const row = oneRow(result.rows);
      return Object.freeze({
        outcome: recordOutcome(row.record_outcome),
        checkpoint: mapCheckpoint(row),
      });
    } catch (error) {
      if (error instanceof AaveV3EthereumFinalizedCheckpointPersistenceError) throw error;
      return persistenceFailure();
    }
  }

  async recover(
    request: RecoverAaveV3EthereumFinalizedCheckpointRequest,
  ): Promise<RecoverAaveV3EthereumFinalizedCheckpointResult> {
    return this.applyVerifiedLineage(request, 'QUARANTINE_RECOVERY');
  }

  async backfill(
    request: RecoverAaveV3EthereumFinalizedCheckpointRequest,
  ): Promise<RecoverAaveV3EthereumFinalizedCheckpointResult> {
    return this.applyVerifiedLineage(request, 'CONTINUITY_BACKFILL');
  }

  private async applyVerifiedLineage(
    request: RecoverAaveV3EthereumFinalizedCheckpointRequest,
    expectedOperation: 'CONTINUITY_BACKFILL' | 'QUARANTINE_RECOVERY',
  ): Promise<RecoverAaveV3EthereumFinalizedCheckpointResult> {
    try {
      const command = normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(request);
      if (command.operation !== expectedOperation) return persistenceFailure();
      const lastGood = command.expectedLastGoodBlock;
      const target = command.recoverThroughBlock;
      const result = await this.postgres.query<RecoveryRow>(
        `SELECT recovered.*
         FROM recover_aave_v3_ethereum_finalized_checkpoint(
           $1::uuid, $2::text, $3::uuid, $4::text, $5::text,
           $6::text, $7::text, $8::text, $9::text, $10::bigint,
           $11::text, $12::text, $13::timestamptz, $14::timestamptz,
           $15::numeric, $16::text, $17::text, $18::text,
           $19::timestamptz, $20::text, $21::numeric, $22::text,
           $23::text, $24::text, $25::timestamptz, $26::timestamptz,
           $27::timestamptz, $28::timestamptz, $29::jsonb
         ) AS recovered`,
        [
          command.recoveryId,
          command.commandFingerprintSha256,
          command.nonce,
          command.authorizationFingerprintSha256,
          command.sourceReferenceId,
          command.corroboratingSourceReferenceId,
          command.authorizedByReferenceId,
          command.sourcePairIndependenceApprovalId,
          command.operation,
          command.expectedRevision,
          command.expectedStatus,
          command.expectedQuarantineReason,
          command.expectedQuarantinedAt,
          command.expectedLastValidatedAt,
          lastGood.number.toString(),
          lastGood.hash,
          lastGood.parentHash,
          lastGood.stateRoot,
          lastGood.timestamp,
          command.expectedLastGoodContentFingerprintSha256,
          target.number.toString(),
          target.hash,
          target.parentHash,
          target.stateRoot,
          target.timestamp,
          command.issuedAt,
          command.expiresAt,
          command.evaluatedAt,
          command.serializedLineage,
        ],
      );
      const row = oneRow(result.rows);
      return Object.freeze({
        outcome: recoveryOutcome(row.recovery_outcome),
        checkpoint: mapCheckpoint(row),
      });
    } catch (error) {
      if (error instanceof AaveV3EthereumFinalizedCheckpointPersistenceError) throw error;
      return persistenceFailure();
    }
  }
}
