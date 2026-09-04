import { CHAIN_OBSERVATION_REGISTRY_BINDINGS } from '../../../blockchain/domain/chain-observation-policy';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from '../../../smart-lending/infrastructure/aave/aave-v3-ethereum-deployment.manifest';
import { AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256 } from '../../../smart-lending/infrastructure/aave/aave-v3-ethereum-finalized-rpc.plan';
import {
  createAaveV3EthereumFinalizedCheckpointMigration,
  createAaveV3EthereumFinalizedCheckpointMigrationV0017,
  createAaveV3EthereumFinalizedCheckpointTestSchemaMigrationV0017,
} from './0017-create-aave-finalized-checkpoints.migration';

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

describe('migration 0017 Aave Ethereum finalized checkpoints', () => {
  it('creates a fixed source-scoped append-only checkpoint store', () => {
    const migration = createAaveV3EthereumFinalizedCheckpointMigrationV0017;
    const up = sql(migration.upSql);

    expect(migration.id).toBe('0017');
    expect(migration.supersedesVerificationOf).toEqual(['0016']);
    expect(up).toContain('CREATE TABLE aave_v3_ethereum_finalized_checkpoint_events');
    expect(up).toContain('CREATE TABLE aave_v3_ethereum_finalized_checkpoint_heads');
    expect(up).toContain('CREATE TABLE aave_v3_ethereum_finalized_checkpoint_recovery_events');
    expect(up).toContain('CREATE TABLE aave_v3_ethereum_finalized_checkpoint_recovery_lineage');
    expect(up).toContain('CREATE TABLE aave_v3_ethereum_finalized_checkpoint_recovery_sources');
    expect(up).toContain('numeric(20,0)');
    expect(up).toContain('18446744073709551615');
    expect(up).toContain(AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256);
    expect(up).toContain(CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256);
    expect(up).toContain(AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256);
    expect(up).toContain('aave_checkpoint_events_append_only_row');
    expect(up).toContain('aave_checkpoint_events_append_only_truncate');
    expect(up).toContain('ENABLE ALWAYS TRIGGER');
    expect(up).toContain('aave_checkpoint_recovery_sources_append_only_truncate');
  });

  it('permits recovery only through the worker-owned bounded authorization function', () => {
    const up = sql(createAaveV3EthereumFinalizedCheckpointMigrationV0017.upSql);

    expect(up).toContain('CREATE FUNCTION recover_aave_v3_ethereum_finalized_checkpoint');
    expect(up).toContain(
      'requested_target_block_number - requested_expected_last_good_block_number > 64',
    );
    expect(up).toContain("requested_expires_at - requested_issued_at > interval '15 minutes'");
    expect(up).toContain(
      'requested_source_reference_id = requested_corroborating_source_reference_id',
    );
    expect(up).toContain('entry_parent_hash <> prior_block_hash');
    expect(up).toContain("WHEN 'CONTINUITY_BACKFILL' THEN 'BACKFILLED'");
    expect(up).toContain("'AUTHORIZED_CONTIGUOUS_BACKFILL'");
    expect(up).toContain("ELSE 'AUTHORIZED_CONTIGUOUS_LINEAGE'");
    expect(up).toContain("OLD.status = 'QUARANTINED'");
    expect(up).toContain("recovery.operation = 'CONTINUITY_BACKFILL'");
    expect(up).toContain("recovery.operation = 'QUARANTINE_RECOVERY'");
    expect(up).toContain('aave_v3_ethereum_finalized_checkpoint_recovery_events AS recovery');
    expect(
      up.match(/recorded_at := pg_catalog\.date_trunc\('milliseconds', clock_timestamp\(\)\);/gu),
    ).toHaveLength(2);
    expect(up).not.toContain('DELETE FROM aave_v3_ethereum_finalized_checkpoint_events');
  });

  it('serializes absent and existing heads and preserves a sticky quarantine', () => {
    const up = sql(createAaveV3EthereumFinalizedCheckpointMigrationV0017.upSql);

    expect(up).toContain('pg_catalog.hashtextextended(requested_correlation_id::text, 57001)');
    expect(up).toContain('pg_catalog.hashtextextended(requested_source_reference_id, 57002)');
    expect(up).toContain('FOR UPDATE');
    expect(up).toContain("OLD.status = 'QUARANTINED'");
    expect(up).toContain("decision := 'CONTINUITY_REQUIRED'");
    expect(up).toContain("reason := 'FINALIZED_HEIGHT_GAP'");
    expect(up).toContain("reason := 'FINALIZED_HEIGHT_REGRESSION'");
    expect(up).toContain("reason := 'FINALIZED_BLOCK_DIVERGENCE'");
    expect(up).toContain("reason := 'FINALIZED_PARENT_MISMATCH'");
    expect(up).toContain("reason := 'SAME_BLOCK_EVIDENCE_DIVERGENCE'");
    expect(up).not.toContain('DELETE FROM aave_v3_ethereum_finalized_checkpoint_events');
  });

  it('treats fresh observation IDs at identical block content as healthy re-observations', () => {
    const up = sql(createAaveV3EthereumFinalizedCheckpointMigrationV0017.upSql);
    const sameBlockStart = up.indexOf('ELSIF requested_block_number = current_good.block_number');
    const timestampBranch = up.indexOf(
      'ELSIF requested_block_timestamp <= current_good.block_timestamp',
      sameBlockStart,
    );
    const sameBlockBranch = up.slice(sameBlockStart, timestampBranch);

    expect(sameBlockBranch).toContain("decision := 'REOBSERVED'");
    expect(sameBlockBranch).toContain(
      'requested_content_fingerprint = current_good.content_fingerprint_sha256',
    );
    expect(sameBlockBranch).not.toContain(
      'requested_source_observation_id = current_good.source_observation_id',
    );
  });

  it('exposes reads to API and worker while reserving writes to the worker role', () => {
    const up = sql(createAaveV3EthereumFinalizedCheckpointMigrationV0017.upSql);

    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION read_aave_v3_ethereum_finalized_checkpoint(text) TO "crypto_api_runtime", "crypto_worker_runtime"',
    );
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION record_aave_v3_ethereum_finalized_checkpoint(bigint,uuid,text,text,text,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone) TO "crypto_worker_runtime"',
    );
    expect(up).toContain('GRANT EXECUTE ON FUNCTION recover_aave_v3_ethereum_finalized_checkpoint');
    expect(up).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE) ON/u);
    expect(up).toContain(
      'REVOKE ALL PRIVILEGES ON TYPE aave_v3_ethereum_finalized_checkpoint_events',
    );
    expect(up).toContain(
      'FROM PUBLIC, "crypto_api_runtime", "crypto_worker_runtime", "crypto_runtime", "crypto_migration"',
    );
    expect(up).toContain('SECURITY DEFINER');
    expect(up).toContain('SET search_path TO pg_catalog, %I, pg_temp');
  });

  it('pins cumulative schema and ACL verification and shares DDL with the isolated fixture', () => {
    const production = createAaveV3EthereumFinalizedCheckpointMigrationV0017;
    const isolated = createAaveV3EthereumFinalizedCheckpointTestSchemaMigrationV0017;

    expect(production.upSql).toEqual(isolated.upSql);
    expect(production.downSql).toEqual(isolated.downSql);
    expect(production.verifySql).not.toEqual(isolated.verifySql);
    for (const verifier of [production.verifySql ?? '', isolated.verifySql ?? '']) {
      expect(verifier).toContain('aave_v3_ethereum_finalized_checkpoint_events');
      expect(verifier).toContain('aave_v3_ethereum_finalized_checkpoint_heads');
      expect(verifier).toContain('read_aave_v3_ethereum_finalized_checkpoint');
      expect(verifier).toContain('record_aave_v3_ethereum_finalized_checkpoint');
      expect(verifier).toContain('recover_aave_v3_ethereum_finalized_checkpoint');
      expect(verifier).toContain('aave_v3_ethereum_finalized_checkpoint_recovery_events');
      expect(verifier).toContain('aave_checkpoint_events_append_only_row');
      expect(verifier).toContain('aave_checkpoint_head_transition');
      expect(verifier).toContain("pg_catalog.acldefault('T', guarded_type.typowner)");
      expect(verifier).toContain("acl.privilege_type = 'USAGE'");
    }
  });

  it('refuses rollback after any checkpoint history has been written', () => {
    const down = sql(createAaveV3EthereumFinalizedCheckpointMigrationV0017.downSql);

    expect(down).toContain('DO $refuse_aave_checkpoint_history_loss$');
    expect(down).toContain('cannot roll back Aave finalized checkpoints after use');
    expect(down).not.toContain('DELETE FROM');
    expect(down).toContain('DROP TABLE aave_v3_ethereum_finalized_checkpoint_events');
    expect(down).toContain('DROP TABLE aave_v3_ethereum_finalized_checkpoint_recovery_events');
    expect(down).not.toContain('DROP TYPE aave_v3_ethereum_finalized_checkpoint');
  });

  it('delegates custom principal validation to the cumulative predecessor', () => {
    expect(() =>
      createAaveV3EthereumFinalizedCheckpointMigration({
        bootstrapRole: 'valid_bootstrap',
        schemaOwnerRole: 'valid_owner',
        migrationRole: 'valid_migrator',
        apiRuntimeRole: 'INVALID-API',
        workerRuntimeRole: 'valid_worker',
        apiLoginPrefix: 'valid_api_login_',
        workerLoginPrefix: 'valid_worker_login_',
        legacyRuntimeRole: 'valid_legacy',
      }),
    ).toThrow('apiRuntimeRole');
  });
});
