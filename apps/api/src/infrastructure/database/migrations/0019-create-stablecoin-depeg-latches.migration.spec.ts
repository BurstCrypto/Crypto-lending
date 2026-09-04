import {
  createStablecoinDepegLatchMigration,
  createStablecoinDepegLatchMigrationV0019,
  createStablecoinDepegLatchTestSchemaMigrationV0019,
} from './0019-create-stablecoin-depeg-latches.migration';

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

describe('migration 0019 stablecoin depeg latches', () => {
  it('creates an exact KAN-61 mainnet-bound append-only event log and sticky projection', () => {
    const migration = createStablecoinDepegLatchMigrationV0019;
    const up = sql(migration.upSql);

    expect(migration.id).toBe('0019');
    expect(migration.supersedesVerificationOf).toEqual(['0018']);
    expect(up).toContain('CREATE TABLE stablecoin_depeg_latch_events');
    expect(up).toContain('CREATE TABLE stablecoin_depeg_latch_projections');
    expect(up).toContain('5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d');
    expect(up).toContain("network_id = 'eip155:1'");
    expect(up).toContain("network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'");
    expect(up).not.toContain('eip155:8453');
    expect(up).toContain('stablecoin_depeg_latch_events_append_only_row');
    expect(up).toContain('stablecoin_depeg_latch_events_append_only_truncate');
    expect(up).toContain('ENABLE ALWAYS TRIGGER');
    expect(up).toContain('pg_catalog.isfinite(effective_at)');
    expect(up).toContain('pg_catalog.isfinite(updated_at)');
    expect(up).toContain('NOT pg_catalog.isfinite(requested_latched_at)');
    expect(up).toContain('NOT pg_catalog.isfinite(requested_authorization_expires_at)');
    expect(up).not.toContain('DELETE FROM stablecoin_depeg_latch_events');
    expect(up).not.toContain('UPDATE stablecoin_depeg_latch_events');
  });

  it('serializes latches per command, event, and exact asset while rejecting conflicts', () => {
    const up = sql(createStablecoinDepegLatchMigrationV0019.upSql);

    expect(up).toContain('pg_catalog.hashtextextended(requested_correlation_id::text, 59001)');
    expect(up).toContain('pg_catalog.hashtextextended(requested_latch_id, 59002)');
    expect(up).toContain('pg_catalog.jsonb_build_array');
    expect(up).toContain('FOR UPDATE');
    expect(up).toContain('stablecoin depeg latch idempotency conflict');
    expect(up).toMatch(
      /prior_event\.depeg_evidence_fingerprint_sha256 <>\s+requested_depeg_evidence_fingerprint/u,
    );
    expect(up).toContain('prior_event.authorization_nonce <> requested_authorization_nonce');
    expect(up).toMatch(
      /prior_event\.recovery_evidence_fingerprint_sha256 <>\s+requested_recovery_evidence_fingerprint/u,
    );
    expect(up).toContain('CONSTRAINT stablecoin_depeg_latch_event_asset_revision_unique UNIQUE');
    expect(up).toContain('command_fingerprint_sha256 text NOT NULL UNIQUE');
    expect(up).toContain('event_fingerprint_sha256 text NOT NULL UNIQUE');
    expect(up).toContain("decision := 'IDEMPOTENT_REPLAY'");
    expect(up).toContain("decision := 'ALREADY_LATCHED'");
    expect(up).toContain("decision := 'REVISION_CONFLICT'");
    expect(up).toContain('requested_latched_at < current_projection.cleared_at');
    expect(up).toContain('NEW.latched_at < OLD.cleared_at');
    expect(up).toContain('stablecoin depeg relatch evidence predates prior clear');
    expect(up).toContain("USING ERRCODE = '22023'");
    expect(up).toContain('IS NOT TRUE');
  });

  it('makes clear one-use, bounded, maker/checker separated, and owner-only', () => {
    const up = sql(createStablecoinDepegLatchMigrationV0019.upSql);
    const clearGrant = /GRANT EXECUTE ON FUNCTION clear_stablecoin_depeg_latch/gu;

    expect(up).toContain('CREATE FUNCTION clear_stablecoin_depeg_latch');
    expect(up).toContain(
      'requested_evidence_actor_reference_id = requested_risk_approver_reference_id',
    );
    expect(up).toContain("requested_risk_approver_role <> 'RISK_APPROVER'");
    expect(up).toContain("interval '15 minutes'");
    expect(up).toContain('recorded_at >= requested_authorization_expires_at');
    expect(up).toContain('pg_catalog.hashtextextended(requested_authorization_nonce::text, 59004)');
    expect(up).toContain('authorization_nonce uuid UNIQUE');
    expect(up).toContain('authorization_fingerprint_sha256 text UNIQUE');
    expect(up).toContain('authorization_id text UNIQUE');
    expect(up).toContain('stablecoin depeg latch recovery authorization replay');
    expect(up.match(clearGrant)).toBeNull();
    expect(up).toContain(
      'REVOKE ALL ON FUNCTION clear_stablecoin_depeg_latch(uuid,text,smallint,text,text,text,smallint,text,text,timestamp with time zone,bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,text,text,text)',
    );
  });

  it('grants only read to API and read/latch to worker and removes table and composite-type ACLs', () => {
    const up = sql(createStablecoinDepegLatchMigrationV0019.upSql);

    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint) TO "crypto_api_runtime", "crypto_worker_runtime"',
    );
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION record_stablecoin_depeg_latch(bigint,uuid,text,text,smallint,text,text,text,smallint,timestamp with time zone,text,text,text,text,text) TO "crypto_worker_runtime"',
    );
    expect(up).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE) ON/u);
    expect(up).toContain(
      'REVOKE ALL PRIVILEGES ON TYPE stablecoin_depeg_latch_events, stablecoin_depeg_latch_projections',
    );
    expect(up).toContain(
      'FROM PUBLIC, "crypto_api_runtime", "crypto_worker_runtime", "crypto_runtime", "crypto_migration"',
    );
    expect(up).toContain('SECURITY DEFINER');
    expect(up).toContain('SET search_path TO pg_catalog, %I, pg_temp');
  });

  it('verifies exact negative clear ACLs, type ACLs, triggers, and shares isolated DDL', () => {
    const production = createStablecoinDepegLatchMigrationV0019;
    const isolated = createStablecoinDepegLatchTestSchemaMigrationV0019;

    expect(production.upSql).toEqual(isolated.upSql);
    expect(production.downSql).toEqual(isolated.downSql);
    expect(production.verifySql).not.toEqual(isolated.verifySql);
    for (const verifier of [production.verifySql ?? '', isolated.verifySql ?? '']) {
      expect(verifier).toContain('stablecoin_depeg_latch_events');
      expect(verifier).toContain('stablecoin_depeg_latch_projections');
      expect(verifier).toContain('stablecoin_depeg_latch_projection_transition');
      expect(verifier).toContain("pg_catalog.acldefault('T', guarded_type.typowner)");
      expect(verifier).toContain("acl.privilege_type = 'USAGE'");
      expect(verifier).toContain(
        "NOT pg_catalog.has_function_privilege('crypto_api_runtime', 'clear_stablecoin_depeg_latch",
      );
      expect(verifier).toContain(
        "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'clear_stablecoin_depeg_latch",
      );
    }
  });

  it('refuses rollback once an event or projection exists and never deletes history', () => {
    const down = sql(createStablecoinDepegLatchMigrationV0019.downSql);

    expect(down).toContain('DO $refuse_stablecoin_depeg_latch_history_loss$');
    expect(down).toContain('cannot roll back stablecoin depeg latches after use');
    expect(down).not.toContain('DELETE FROM');
    expect(down.indexOf('DROP TABLE stablecoin_depeg_latch_projections')).toBeLessThan(
      down.indexOf('DROP TABLE stablecoin_depeg_latch_events'),
    );
  });

  it('delegates invalid custom principal validation to the cumulative predecessor', () => {
    expect(() =>
      createStablecoinDepegLatchMigration({
        bootstrapRole: 'valid_bootstrap',
        schemaOwnerRole: 'valid_owner',
        migrationRole: 'valid_migration',
        apiRuntimeRole: 'INVALID-API',
        workerRuntimeRole: 'valid_worker',
        apiLoginPrefix: 'valid_api_login_',
        workerLoginPrefix: 'valid_worker_login_',
        legacyRuntimeRole: 'valid_legacy',
      }),
    ).toThrow('apiRuntimeRole');
  });
});
