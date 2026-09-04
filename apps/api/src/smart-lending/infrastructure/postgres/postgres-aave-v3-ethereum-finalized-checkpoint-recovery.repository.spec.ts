import type { QueryResult } from 'pg';

import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import type { RecoverAaveV3EthereumFinalizedCheckpointRequest } from '../../application/ports/aave-v3-ethereum-finalized-checkpoint.port';
import * as recoveryDomain from '../../domain/aave-v3-ethereum-finalized-checkpoint-recovery';
import { AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING } from '../../domain/aave-v3-ethereum-finalized-checkpoint';
import {
  AaveV3EthereumFinalizedCheckpointPersistenceError,
  PostgresAaveV3EthereumFinalizedCheckpointRepository,
} from './postgres-aave-v3-ethereum-finalized-checkpoint.repository';

const LAST_HASH = `0x${'11'.repeat(32)}` as const;
const LAST_PARENT = `0x${'10'.repeat(32)}` as const;
const LAST_STATE = `0x${'31'.repeat(32)}` as const;
const TARGET_HASH = `0x${'13'.repeat(32)}` as const;
const TARGET_PARENT = `0x${'12'.repeat(32)}` as const;
const TARGET_STATE = `0x${'33'.repeat(32)}` as const;

function queryResult(rows: Record<string, unknown>[]): QueryResult {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

function checkpointRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  return {
    checkpoint_schema_version: 1,
    checkpoint_deployment_id: binding.deploymentId,
    checkpoint_network_id: binding.networkId,
    checkpoint_source_reference_id: 'rpc-primary:recovery',
    checkpoint_manifest_fingerprint: binding.deploymentManifestFingerprintSha256,
    checkpoint_registry_fingerprint: binding.assetRegistryFingerprintSha256,
    checkpoint_read_plan_fingerprint: binding.readPlanFingerprintSha256,
    checkpoint_revision: '3',
    checkpoint_status: 'ACTIVE',
    checkpoint_block_number: '20000002',
    checkpoint_block_hash: TARGET_HASH,
    checkpoint_parent_hash: TARGET_PARENT,
    checkpoint_state_root: TARGET_STATE,
    checkpoint_block_timestamp: new Date('2026-09-04T12:00:24.000Z'),
    checkpoint_source_observation_id: 'rpc-observation:primary-2',
    checkpoint_evidence_fingerprint: '44'.repeat(32),
    checkpoint_content_fingerprint: '55'.repeat(32),
    checkpoint_observed_at: new Date('2026-09-04T12:02:00.000Z'),
    checkpoint_finalized_advanced_at: new Date('2026-09-04T12:02:05.000Z'),
    checkpoint_last_validated_at: new Date('2026-09-04T12:02:05.000Z'),
    checkpoint_quarantine_reason: null,
    checkpoint_quarantined_at: null,
    ...overrides,
  };
}

function normalizedCommand(): recoveryDomain.NormalizedAaveV3EthereumFinalizedCheckpointRecoveryCommand {
  const lineage: readonly recoveryDomain.NormalizedAaveV3EthereumRecoveryLineageEntry[] =
    Object.freeze([
      Object.freeze({
        sequence: 1,
        block: Object.freeze({
          number: 20_000_001n,
          hash: TARGET_PARENT,
          parentHash: LAST_HASH,
          stateRoot: `0x${'32'.repeat(32)}` as const,
          timestamp: '2026-09-04T12:00:12.000Z',
        }),
        contentFingerprintSha256: '66'.repeat(32),
        primary: Object.freeze({
          sourceReferenceId: 'rpc-primary:recovery',
          sourceObservationId: 'rpc-observation:primary-1',
          evidenceFingerprintSha256: '77'.repeat(32),
          observedAt: '2026-09-04T12:02:00.000Z',
        }),
        corroborating: Object.freeze({
          sourceReferenceId: 'rpc-secondary:recovery',
          sourceObservationId: 'rpc-observation:secondary-1',
          evidenceFingerprintSha256: '88'.repeat(32),
          observedAt: '2026-09-04T12:02:05.000Z',
        }),
      }),
      Object.freeze({
        sequence: 2,
        block: Object.freeze({
          number: 20_000_002n,
          hash: TARGET_HASH,
          parentHash: TARGET_PARENT,
          stateRoot: TARGET_STATE,
          timestamp: '2026-09-04T12:00:24.000Z',
        }),
        contentFingerprintSha256: '55'.repeat(32),
        primary: Object.freeze({
          sourceReferenceId: 'rpc-primary:recovery',
          sourceObservationId: 'rpc-observation:primary-2',
          evidenceFingerprintSha256: '44'.repeat(32),
          observedAt: '2026-09-04T12:02:00.000Z',
        }),
        corroborating: Object.freeze({
          sourceReferenceId: 'rpc-secondary:recovery',
          sourceObservationId: 'rpc-observation:secondary-2',
          evidenceFingerprintSha256: '99'.repeat(32),
          observedAt: '2026-09-04T12:02:05.000Z',
        }),
      }),
    ]);
  return Object.freeze({
    evaluatedAt: '2026-09-04T12:05:00.000Z',
    recoveryId: '550e8400-e29b-41d4-a716-446655440011',
    authorizationFingerprintSha256: 'aa'.repeat(32),
    commandFingerprintSha256: 'bb'.repeat(32),
    nonce: '550e8400-e29b-41d4-a716-446655440010',
    sourceReferenceId: 'rpc-primary:recovery',
    corroboratingSourceReferenceId: 'rpc-secondary:recovery',
    authorizedByReferenceId: 'operations-approver:recovery',
    sourcePairIndependenceApprovalId: 'source-pair-approval:recovery',
    operation: 'QUARANTINE_RECOVERY',
    expectedRevision: 2,
    expectedStatus: 'QUARANTINED',
    expectedQuarantineReason: 'FINALIZED_PARENT_MISMATCH',
    expectedQuarantinedAt: '2026-09-04T12:01:00.000Z',
    expectedLastValidatedAt: '2026-09-04T12:00:30.000Z',
    expectedLastGoodBlock: Object.freeze({
      number: 20_000_000n,
      hash: LAST_HASH,
      parentHash: LAST_PARENT,
      stateRoot: LAST_STATE,
      timestamp: '2026-09-04T12:00:00.000Z',
    }),
    expectedLastGoodContentFingerprintSha256: 'cc'.repeat(32),
    recoverThroughBlock: lineage[1]!.block,
    issuedAt: '2026-09-04T12:01:00.000Z',
    expiresAt: '2026-09-04T12:10:00.000Z',
    lineage,
    serializedLineage: JSON.stringify([{ sequence: 1 }, { sequence: 2 }]),
  });
}

describe('Postgres Aave finalized checkpoint recovery repository', () => {
  afterEach(() => jest.restoreAllMocks());

  it('passes only the normalized, head-bound authorization and bounded lineage', async () => {
    const command = normalizedCommand();
    jest
      .spyOn(recoveryDomain, 'normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand')
      .mockReturnValue(command);
    const query = jest
      .fn()
      .mockResolvedValue(queryResult([{ recovery_outcome: 'RECOVERED', ...checkpointRow() }]));
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository({
      query,
    } as unknown as PostgresService);

    await expect(
      repository.recover({} as RecoverAaveV3EthereumFinalizedCheckpointRequest),
    ).resolves.toMatchObject({
      outcome: 'RECOVERED',
      checkpoint: { revision: 3, status: 'ACTIVE', finalizedBlock: { hash: TARGET_HASH } },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('recover_aave_v3_ethereum_finalized_checkpoint');
    expect(query.mock.calls[0]?.[1]).toEqual([
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
      '20000000',
      LAST_HASH,
      LAST_PARENT,
      LAST_STATE,
      '2026-09-04T12:00:00.000Z',
      command.expectedLastGoodContentFingerprintSha256,
      '20000002',
      TARGET_HASH,
      TARGET_PARENT,
      TARGET_STATE,
      '2026-09-04T12:00:24.000Z',
      command.issuedAt,
      command.expiresAt,
      command.evaluatedAt,
      command.serializedLineage,
    ]);
  });

  it.each([
    'CHECKPOINT_NOT_FOUND',
    'CHECKPOINT_STATUS_MISMATCH',
    'REVISION_CONFLICT',
    'HEAD_BINDING_MISMATCH',
    'AUTHORIZATION_EXPIRED',
    'IDEMPOTENT_REPLAY',
  ])('maps the fail-closed %s outcome', async (outcome) => {
    jest
      .spyOn(recoveryDomain, 'normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand')
      .mockReturnValue(normalizedCommand());
    const nullCheckpoint = Object.fromEntries(
      Object.keys(checkpointRow()).map((key) => [key, null]),
    );
    const query = jest.fn().mockResolvedValue(
      queryResult([
        {
          recovery_outcome: outcome,
          ...(outcome === 'CHECKPOINT_NOT_FOUND' ? nullCheckpoint : checkpointRow()),
        },
      ]),
    );
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository({
      query,
    } as unknown as PostgresService);

    await expect(
      repository.recover({} as RecoverAaveV3EthereumFinalizedCheckpointRequest),
    ).resolves.toMatchObject({
      outcome,
      checkpoint: outcome === 'CHECKPOINT_NOT_FOUND' ? null : expect.any(Object),
    });
  });

  it('keeps active continuity backfill and quarantine recovery entry points distinct', async () => {
    const backfillCommand = Object.freeze({
      ...normalizedCommand(),
      operation: 'CONTINUITY_BACKFILL' as const,
      expectedStatus: 'ACTIVE' as const,
      expectedQuarantineReason: null,
      expectedQuarantinedAt: null,
    });
    jest
      .spyOn(recoveryDomain, 'normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand')
      .mockReturnValue(backfillCommand);
    const query = jest
      .fn()
      .mockResolvedValue(queryResult([{ recovery_outcome: 'BACKFILLED', ...checkpointRow() }]));
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository({
      query,
    } as unknown as PostgresService);

    await expect(
      repository.backfill({} as RecoverAaveV3EthereumFinalizedCheckpointRequest),
    ).resolves.toMatchObject({ outcome: 'BACKFILLED' });
    await expect(
      repository.recover({} as RecoverAaveV3EthereumFinalizedCheckpointRequest),
    ).rejects.toBeInstanceOf(AaveV3EthereumFinalizedCheckpointPersistenceError);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('sanitizes validation, database, and malformed result failures', async () => {
    jest
      .spyOn(recoveryDomain, 'normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand')
      .mockReturnValue(normalizedCommand());
    const query = jest.fn().mockRejectedValue(new Error('postgres credential=super-secret'));
    const repository = new PostgresAaveV3EthereumFinalizedCheckpointRepository({
      query,
    } as unknown as PostgresService);

    await expect(
      repository.recover({} as RecoverAaveV3EthereumFinalizedCheckpointRequest),
    ).rejects.toBeInstanceOf(AaveV3EthereumFinalizedCheckpointPersistenceError);
    query.mockResolvedValue(queryResult([{ recovery_outcome: 'UNKNOWN', ...checkpointRow() }]));
    await expect(
      repository.recover({} as RecoverAaveV3EthereumFinalizedCheckpointRequest),
    ).rejects.toEqual(
      expect.objectContaining({
        message: 'Aave V3 Ethereum finalized checkpoint persistence failed',
      }),
    );
  });
});
