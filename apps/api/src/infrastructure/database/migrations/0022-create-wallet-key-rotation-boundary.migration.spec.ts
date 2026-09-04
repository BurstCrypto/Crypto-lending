import {
  createWalletKeyRotationBoundaryMigration,
  createWalletKeyRotationBoundaryMigrationV0022,
  createWalletKeyRotationBoundaryTestSchemaMigrationV0022,
} from './0022-create-wallet-key-rotation-boundary.migration';

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

describe('migration 0022 wallet key rotation boundary', () => {
  it('adds a locked identity policy and immutable challenge and wallet digest aliases', () => {
    const migration = createWalletKeyRotationBoundaryMigrationV0022;
    const up = sql(migration.upSql);

    expect(migration.id).toBe('0022');
    expect(migration.supersedesVerificationOf).toEqual(['0021']);
    expect(up).toContain('CREATE TABLE wallet_identity_key_policy');
    expect(up).toContain('CREATE TABLE wallet_ownership_challenge_identity_digests');
    expect(up).toContain('CREATE TABLE registered_wallet_identity_digests');
    expect(up).toContain('accepted_read_versions) BETWEEN 1 AND 3');
    expect(up).toContain('1, 1, ARRAY[1]::smallint[]');
    expect(up).toContain('wallet identity key policy is migration-owned and immutable');
    expect(up).toContain('wallet challenge identity digest history is append-only');
    expect(up).toContain('ENABLE ALWAYS TRIGGER');
  });

  it('requires an exact policy-version alias set and locks every alias before completion', () => {
    const up = sql(createWalletKeyRotationBoundaryMigrationV0022.upSql);

    expect(up).toContain(
      'requested_identity_digest_versions IS DISTINCT FROM policy.accepted_read_versions',
    );
    expect(up).toContain('requested_address_digest_version <> policy.active_write_version');
    expect(up).toContain('duplicate wallet identity digest alias');
    expect(up).toContain('ORDER BY alias.address_digest_version');
    expect(up).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(up).toContain('wallet identity aliases resolve to multiple active wallets');
    expect(up).toContain('OWNERSHIP_CONFLICT');
    expect(up).toContain('WALLET_ALREADY_REGISTERED');
    expect(up).toContain('wallet identity alias backfill is incomplete');
    expect(up).toContain('WALLET_REVOKED');
    expect(up).toContain('CREATE FUNCTION list_active_wallet_registrations_rotatable');
    expect(up).toContain('active_verification_digest_version smallint');
  });

  it('guards legacy completion paths at the table and synchronizes revocation aliases', () => {
    const up = sql(createWalletKeyRotationBoundaryMigrationV0022.upSql);

    expect(up).toContain('CREATE TRIGGER registered_wallet_identity_digest_set_guard');
    expect(up).toContain('BEFORE INSERT ON registered_wallets');
    expect(up).toContain('wallet identity digest is already active');
    expect(up).toContain('wallet ownership proof predates an identity-alias revocation');
    expect(up).toContain('CREATE TRIGGER registered_wallet_identity_digest_sync');
    expect(up).toContain('AFTER INSERT OR UPDATE OF status ON registered_wallets');
    expect(up).toContain("SET status = 'REVOKED', revoked_at = NEW.revoked_at");
  });

  it('grants only the three guarded entry points to the API runtime', () => {
    const up = sql(createWalletKeyRotationBoundaryMigrationV0022.upSql);

    expect(up).toContain('GRANT EXECUTE ON FUNCTION begin_wallet_ownership_challenge_rotatable');
    expect(up).toContain('GRANT EXECUTE ON FUNCTION complete_wallet_registration_rotatable');
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION list_active_wallet_registrations_rotatable(uuid)',
    );
    expect(up).not.toMatch(/GRANT EXECUTE ON FUNCTION .* TO "crypto_worker_runtime"/u);
    expect(up).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE) ON/u);
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TYPE wallet_identity_key_policy');
  });

  it('refuses rollback after any multi-version identity use but preserves version-one parents', () => {
    const down = sql(createWalletKeyRotationBoundaryMigrationV0022.downSql);

    expect(down).toContain('DO $refuse_wallet_identity_rotation_loss$');
    expect(down).toContain('cannot roll back wallet identity rotation after multi-version use');
    expect(down).toContain('WHERE address_digest_version <> 1');
    expect(down).not.toContain('DELETE FROM');
  });

  it('binds exact function source hashes, signatures, and trigger relations in verification', () => {
    const verify = createWalletKeyRotationBoundaryMigrationV0022.verifySql ?? '';

    expect(verify).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8'))",
    );
    expect(verify).toContain(
      "pg_catalog.to_regprocedure('list_active_wallet_registrations_rotatable(uuid)')",
    );
    expect(verify).toContain('WITH expected_triggers(relation_name, trigger_name');
    expect(verify).toContain('SELECT pg_catalog.count(*) = 12');
  });

  it('shares DDL with isolated tests and rejects invalid principal identifiers', () => {
    expect(createWalletKeyRotationBoundaryMigrationV0022.upSql).toEqual(
      createWalletKeyRotationBoundaryTestSchemaMigrationV0022.upSql,
    );
    expect(createWalletKeyRotationBoundaryMigrationV0022.downSql).toEqual(
      createWalletKeyRotationBoundaryTestSchemaMigrationV0022.downSql,
    );
    expect(createWalletKeyRotationBoundaryMigrationV0022.verifySql).not.toEqual(
      createWalletKeyRotationBoundaryTestSchemaMigrationV0022.verifySql,
    );
    expect(() =>
      createWalletKeyRotationBoundaryMigration({
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
