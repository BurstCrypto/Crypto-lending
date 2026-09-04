import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createWalletMetadataRewrapBoundaryMigration,
  createWalletMetadataRewrapBoundaryMigrationV0024,
  createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024,
} from './0024-create-wallet-metadata-rewrap-boundary.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0024 wallet metadata rewrap boundary', () => {
  it('creates a dormant bounded state machine and retains no superseded ciphertext', () => {
    const migration = createWalletMetadataRewrapBoundaryMigrationV0024;
    const up = sql(migration.upSql);
    expect(migration.id).toBe('0024');
    expect(migration.supersedesVerificationOf).toEqual(['0023']);
    expect(up).toContain('LOCK TABLE wallet_ownership_challenges, registered_wallets');
    expect(up).toContain('CREATE TABLE wallet_metadata_seal_iv_registry');
    expect(up).toContain('CREATE TABLE wallet_metadata_rewrap_commands');
    expect(up).toContain('CREATE TABLE wallet_metadata_rewrap_audit_events');
    expect(up).toContain("recorded_at + interval '10 minutes'");
    expect(up).toContain("status = 'ACTIVE'");
    expect(up).toContain("registry_environment = 'MAINNET'");
    expect(up).toContain("wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1'");
    expect(up).toContain('requested_target_key_version <= target_wallet.address_key_version');
    expect(up).toContain('requested_address_iv = target_wallet.address_iv');
    expect(up).toContain('requested_address_iv = requested_metadata_iv');
    expect(up).toContain('SET address_key_version = requested_address_key_version');
    const stateTableDefinitions = up.slice(
      up.indexOf('CREATE TABLE wallet_metadata_seal_iv_registry'),
      up.indexOf('COMMENT ON TABLE wallet_metadata_seal_iv_registry'),
    );
    expect(stateTableDefinitions).not.toMatch(
      /(?:plaintext|ciphertext|auth_tag|address_digest)\s+(?:text|bytea)/iu,
    );
  });

  it('backfills every retained sealed field before installing insert and update guards', () => {
    const up = sql(createWalletMetadataRewrapBoundaryMigrationV0024.upSql);
    const backfill = up.indexOf('INSERT INTO wallet_metadata_seal_iv_registry (');
    const challengeSource = up.indexOf("SELECT 'CHALLENGE'::text AS source_kind", backfill);
    const addressSource = up.indexOf("SELECT 'WALLET', wallet_id, 'ADDRESS'", backfill);
    const metadataSource = up.indexOf("SELECT 'WALLET', wallet_id, 'METADATA'", backfill);
    const firstGuard = up.indexOf('CREATE TRIGGER wallet_challenge_seal_material_insert');
    expect(backfill).toBeGreaterThan(-1);
    expect(challengeSource).toBeGreaterThan(backfill);
    expect(addressSource).toBeGreaterThan(challengeSource);
    expect(metadataSource).toBeGreaterThan(addressSource);
    expect(firstGuard).toBeGreaterThan(metadataSource);
    expect(up).toContain(
      'CONSTRAINT wallet_metadata_seal_iv_registry_iv_unique UNIQUE (key_version, iv)',
    );
    expect(up).toContain(
      'CONSTRAINT wallet_metadata_seal_iv_registry_material_unique UNIQUE (material_sha256)',
    );
    expect(up).toContain(
      'NEW.challenge_payload_key_version IS NULL\n          AND NEW.challenge_payload_ciphertext IS NULL',
    );
  });

  it('keeps identity immutable and admits cipher updates only through an exact completing command', () => {
    const up = sql(createWalletMetadataRewrapBoundaryMigrationV0024.upSql);
    expect(up).toContain('CREATE TRIGGER registered_wallet_identity_immutable');
    expect(up).toContain('address_digest_version, address_digest, registered_at');
    expect(up).toContain('CREATE TRIGGER registered_wallet_seal_material_rewrap');
    expect(up).toContain(
      "current_setting(\n          'crypto_lending.wallet_metadata_rewrap_command', true",
    );
    expect(up).toContain("rewrap_command.status = 'COMPLETING'");
    expect(up).toContain(
      'command.prepared_state_sha256 IS DISTINCT FROM wallet_metadata_rewrap_state_sha256(',
    );
    expect(up).toContain(
      "set_config(\n        'crypto_lending.wallet_metadata_rewrap_command', '', true",
    );
    expect(up).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/iu);
  });

  it('grants no runtime role a rewrap, count, or verifier capability', () => {
    const up = sql(createWalletMetadataRewrapBoundaryMigrationV0024.upSql);
    expect(up).not.toMatch(/GRANT\s+/iu);
    for (const identity of [
      'prepare_wallet_metadata_rewrap(uuid,uuid,uuid,smallint)',
      'complete_wallet_metadata_rewrap(uuid,uuid,uuid,text,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea)',
      'wallet_metadata_seal_key_retirement_readiness(smallint)',
      'verify_wallet_metadata_rewrap_state()',
    ]) {
      expect(up).toContain(
        `REVOKE ALL ON FUNCTION ${identity}\n      FROM PUBLIC, "crypto_api_runtime", "crypto_worker_runtime", "crypto_runtime", "crypto_migration"`,
      );
    }
  });

  it('binds exact sources, triggers, ACLs, constraints, and live data shape', () => {
    const verifier = createWalletMetadataRewrapBoundaryMigrationV0024.verifySql ?? '';
    expect(verifier).toContain("owner_role.rolname = 'crypto_schema_owner'");
    expect(verifier).toContain("pg_catalog.to_regprocedure('prepare_wallet_metadata_rewrap");
    expect(verifier).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8'))",
    );
    expect(verifier).toContain('wallet_metadata_rewrap_command_lifecycle_row');
    expect(verifier).toContain('registered_wallet_seal_material_rewrap');
    expect(verifier).toContain('expected.expected_columns');
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_api_runtime', 'prepare_wallet_metadata_rewrap",
    );
    expect(createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024.verifySql).toContain(
      'SELECT verify_wallet_metadata_rewrap_state() AS valid',
    );
    expect(verifier).toContain('wallet_metadata_rewrap_command_state_check');
  });

  it('refuses rollback after preparation, rewrap, or runtime IV admission', () => {
    const down = sql(createWalletMetadataRewrapBoundaryMigrationV0024.downSql);
    expect(down).toContain('cannot roll back wallet metadata rewrap boundary after use');
    expect(down).toContain('SELECT 1 FROM wallet_metadata_rewrap_commands');
    expect(down).toContain("WHERE captured_by <> 'BACKFILL'");
    expect(down).toContain('CREATE TRIGGER registered_wallet_identity_immutable');
    expect(down).toContain('BEFORE UPDATE ON registered_wallets');
  });

  it('rejects unsafe principals and separates production/test cumulative verification', () => {
    expect(() =>
      createWalletMetadataRewrapBoundaryMigration({
        ...PRODUCTION_DATABASE_PRINCIPALS,
        apiRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('apiRuntimeRole');
    expect(createWalletMetadataRewrapBoundaryMigrationV0024.upSql).toEqual(
      createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024.upSql,
    );
    expect(createWalletMetadataRewrapBoundaryMigrationV0024.downSql).toEqual(
      createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024.downSql,
    );
    expect(createWalletMetadataRewrapBoundaryMigrationV0024.verifySql).not.toEqual(
      createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024.verifySql,
    );
  });
});
