import {
  createBalanceSyncReadModelMigration,
  createBalanceSyncReadModelMigrationV0020,
  createBalanceSyncReadModelTestSchemaMigrationV0020,
} from './0020-create-balance-sync-read-model.migration';

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

describe('migration 0020 balance sync read model', () => {
  it('creates immutable observation and checkpoint history with one guarded projection', () => {
    const migration = createBalanceSyncReadModelMigrationV0020;
    const up = sql(migration.upSql);

    expect(migration.id).toBe('0020');
    expect(migration.supersedesVerificationOf).toEqual(['0019']);
    expect(up).toContain('CREATE TABLE balance_sync_observations');
    expect(up).toContain('CREATE TABLE balance_sync_observation_positions');
    expect(up).toContain('CREATE TABLE balance_sync_checkpoint_events');
    expect(up).toContain('CREATE TABLE balance_sync_checkpoints');
    expect(up).toContain('balance sync history is append-only');
    expect(up).toContain('ENABLE ALWAYS TRIGGER');
    expect(up).toContain('balance sync projection is not bound to its event');
    expect(up).toContain('balance_sync_event_observation_scope_fk');
    expect(up).toContain('balance_sync_checkpoint_observation_scope_fk');
    expect(up).toContain('finalized balance sync facts are immutable');
    expect(up).not.toContain('DELETE FROM balance_sync_');
  });

  it('is restricted to exact Ethereum and Solana mainnets and six registry assets', () => {
    const up = sql(createBalanceSyncReadModelMigrationV0020.upSql);

    expect(up).toContain("network_id IN ('eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')");
    expect(up).toContain('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    expect(up).toContain('0xdac17f958d2ee523a2206206994597c13d831ec7');
    expect(up).toContain('0x6c3ea9036406852006290770bedfcaba0e23a0e8');
    expect(up).toContain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(up).toContain('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    expect(up).toContain('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo');
    expect(up).toContain(
      "network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' AND selector = 'confirmed'",
    );
    expect(up).not.toContain("selector = 'processed'");
    expect(up).not.toContain('eip155:8453');
    expect(up).not.toContain('eip155:42161');
  });

  it('locks the exact active wallet and admits only bounded canonical observations', () => {
    const up = sql(createBalanceSyncReadModelMigrationV0020.upSql);

    expect(up).toContain('FOR UPDATE OF wallet');
    expect(up).toContain('FOR KEY SHARE OF wallet');
    expect(up).toContain("wallet.status = 'ACTIVE'");
    expect(up).toContain("wallet.registry_environment = 'MAINNET'");
    expect(up).toContain(
      "wallet.registry_fingerprint_sha256 = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d'",
    );
    expect(up).toContain('pg_catalog.jsonb_array_length(requested_positions) <> 3');
    expect(up).toContain('pg_catalog.octet_length(requested_positions::text) > 8192');
    expect(up).toContain(
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    );
    expect(up).toContain('balance sync observation fingerprint mismatch');
    expect(up).toContain('requested_source_position <> current_observation.source_position + 1');
    expect(up).toContain('requested_source_parent_hash <> current_observation.source_hash');
    expect(up).toContain('requested_account_id::text, 56001');
    expect(up).toContain('requested_account_id::text, 56003');
  });

  it('keeps the finalized-anchor capability dormant while granting exact read/write roles', () => {
    const up = sql(createBalanceSyncReadModelMigrationV0020.upSql);

    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION read_balance_sync_checkpoint(uuid,uuid,text) TO "crypto_worker_runtime"',
    );
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION read_balance_sync_portfolio(uuid,jsonb,timestamp with time zone) TO "crypto_api_runtime"',
    );
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone) TO "crypto_worker_runtime"',
    );
    expect(up).not.toMatch(/GRANT EXECUTE ON FUNCTION record_balance_sync_finalized_anchor/u);
    expect(up).toContain("'IDEMPOTENT_REPLAY'::text");
    expect(up).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE) ON/u);
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TYPE balance_sync_observations');
  });

  it('verifies exact function signatures and trigger-to-table semantics', () => {
    const verifier = createBalanceSyncReadModelTestSchemaMigrationV0020.verifySql ?? '';

    expect(verifier).toContain(
      "function_state.oid IN (\n          pg_catalog.to_regprocedure('read_balance_sync_checkpoint(uuid,uuid,text)')",
    );
    expect(verifier).toContain(
      "('balance_sync_observations_append_only_row',\n          pg_catalog.to_regclass('balance_sync_observations')",
    );
    expect(verifier).toContain(
      "pg_catalog.to_regprocedure('reject_balance_sync_history_mutation()'), 27::smallint",
    );
    expect(verifier).toContain(
      "pg_catalog.to_regprocedure('enforce_balance_sync_checkpoint_projection()'), 23::smallint",
    );
    expect(verifier).toContain('trigger_state.tgfoid = expected.function_oid');
    expect(verifier).toContain('trigger_state.tgtype = expected.trigger_type');
  });

  it('makes portfolio coverage roster-bound and dynamically stale or unavailable', () => {
    const up = sql(createBalanceSyncReadModelMigrationV0020.upSql);

    expect(up).toContain('actual_wallets IS DISTINCT FROM normalized_expected_wallets');
    expect(up).toContain("THEN interval '15 minutes'");
    expect(up).toContain("ELSE interval '2 minutes'");
    expect(up).toContain("THEN interval '60 seconds'");
    expect(up).toContain("ELSE interval '15 seconds'");
    expect(up).toContain("THEN 'UNAVAILABLE'");
    expect(up).toContain("THEN 'CURRENT'");
  });

  it('refuses rollback after any durable use', () => {
    const down = sql(createBalanceSyncReadModelMigrationV0020.downSql);

    expect(down).toContain('DO $refuse_balance_sync_history_loss$');
    expect(down).toContain('cannot roll back balance sync read model after use');
    expect(down).not.toContain('DELETE FROM');
    expect(down.indexOf('DROP TABLE balance_sync_checkpoints')).toBeLessThan(
      down.indexOf('DROP TABLE balance_sync_observations'),
    );
  });

  it('shares DDL with isolated tests and delegates invalid principal validation', () => {
    expect(createBalanceSyncReadModelMigrationV0020.upSql).toEqual(
      createBalanceSyncReadModelTestSchemaMigrationV0020.upSql,
    );
    expect(createBalanceSyncReadModelMigrationV0020.downSql).toEqual(
      createBalanceSyncReadModelTestSchemaMigrationV0020.downSql,
    );
    expect(createBalanceSyncReadModelMigrationV0020.verifySql).not.toEqual(
      createBalanceSyncReadModelTestSchemaMigrationV0020.verifySql,
    );
    expect(() =>
      createBalanceSyncReadModelMigration({
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
