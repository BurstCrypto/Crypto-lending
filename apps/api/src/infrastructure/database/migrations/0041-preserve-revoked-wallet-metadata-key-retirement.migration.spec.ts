import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createRevokedWalletMetadataKeyRetirementMigration,
  createRevokedWalletMetadataKeyRetirementMigrationV0041,
  createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041,
} from './0041-preserve-revoked-wallet-metadata-key-retirement.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE FUNCTION ${name}`);
  const replaceStart = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  const actualStart = replaceStart >= 0 ? replaceStart : start;
  const end = source.indexOf('$function$;', actualStart);
  expect(actualStart).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(actualStart);
  return source.slice(actualStart, end + '$function$;'.length);
}

describe('migration 0041 revoked wallet metadata key retirement', () => {
  const migration = createRevokedWalletMetadataKeyRetirementMigrationV0041;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';
  const authorize = functionBody(up, 'authorize_revoked_wallet_metadata_rewrap_v1(');
  const prepare = functionBody(up, 'prepare_wallet_metadata_rewrap(');
  const complete = functionBody(up, 'complete_wallet_metadata_rewrap(');
  const materialGuard = functionBody(up, 'guard_wallet_metadata_seal_material()');

  it('is an unregistered cumulative successor to 0040', () => {
    expect(migration).toMatchObject({ id: '0041', supersedesVerificationOf: ['0040'] });
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.some(({ id }) => id === '0041')).toBe(false);
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.some(({ id }) => id === '0041')).toBe(false);
  });

  it('stores append-only digest authorization without address or sealed material', () => {
    const table = up.slice(
      up.indexOf('CREATE TABLE wallet_metadata_revoked_rewrap_authorizations'),
      up.indexOf('COMMENT ON TABLE wallet_metadata_revoked_rewrap_authorizations'),
    );
    for (const marker of [
      'command_id uuid PRIMARY KEY',
      'registered_at timestamptz NOT NULL',
      'revoked_at timestamptz NOT NULL',
      'state_sha256 text NOT NULL',
      'verification_digest_version smallint NOT NULL',
      'verification_digest_sha256 bytea NOT NULL',
      "'PREPARED_WHILE_REVOKED', 'REVOKED_AFTER_PREPARE'",
      'FOREIGN KEY (command_id) REFERENCES wallet_metadata_rewrap_commands',
      'FOREIGN KEY (wallet_id) REFERENCES registered_wallets',
    ]) {
      expect(table).toContain(marker);
    }
    for (const forbidden of [
      'address_digest bytea',
      'address_ciphertext',
      'metadata_ciphertext',
      'auth_tag',
      'plaintext',
      'private_key',
      'signed_transaction',
    ]) {
      expect(table).not.toContain(forbidden);
    }
    expect(up).toContain('wallet_revoked_rewrap_auth_append_row');
    expect(up).toContain('wallet_revoked_rewrap_auth_append_truncate');
    expect(up.match(/ENABLE ALWAYS TRIGGER/gu)).toHaveLength(3);
  });

  it('authorizes only an exact terminal revoked wallet and deterministic accepted alias', () => {
    expect(authorize).toContain("target_wallet.status <> 'REVOKED'");
    expect(authorize).toContain('target_wallet.revoked_at IS NULL');
    expect(authorize).toContain(
      'alias.address_digest_version = ANY (key_policy.accepted_read_versions)',
    );
    expect(authorize).toContain('ORDER BY alias.address_digest_version DESC');
    expect(authorize).toContain('pg_catalog.sha256(alias.address_digest)');
    expect(authorize).toContain(
      'current_state_sha256 IS DISTINCT FROM target_command.prepared_state_sha256',
    );
    expect(authorize).toContain(
      'target_wallet.registered_by_challenge_id\n          IS DISTINCT FROM target_command.registered_by_challenge_id',
    );
    expect(authorize).toContain("target_wallet.registry_environment IS DISTINCT FROM 'MAINNET'");
    expect(authorize).toContain('target_wallet.registry_fingerprint_sha256 IS DISTINCT FROM');
    expect(authorize).toContain('authorization_reason := CASE');
    expect(authorize).toContain('pg_catalog.clock_timestamp()');
    expect(authorize).toContain('recorded_at >= target_command.expires_at');
    expect(authorize).not.toContain('UPDATE registered_wallets');
    expect(authorize).not.toContain('INSERT INTO registered_wallet_identity_digests');
  });

  it('keeps the active prepare path and adds an exact revoked prepare path', () => {
    expect(prepare).toContain("(wallet.status = 'ACTIVE' AND wallet.revoked_at IS NULL)");
    expect(prepare).toContain("(wallet.status = 'REVOKED' AND wallet.revoked_at IS NOT NULL)");
    expect(prepare).toContain('verification_digest_version := policy_active_version');
    expect(prepare).toContain('alias.address_digest_version = ANY (policy_accepted_versions)');
    expect(prepare).toContain('ORDER BY alias.address_digest_version DESC');
    expect(prepare).toContain("IF target_wallet.status = 'REVOKED' THEN");
    expect(prepare).toContain(
      'SELECT authorize_revoked_wallet_metadata_rewrap_v1(requested_command_id)',
    );
    expect(prepare).toContain(
      'prepared_verification_digest_version := verification_digest_version',
    );
    expect(prepare).toContain('prepared_address_digest := target_wallet.address_digest');
    expect(prepare.match(/recorded_at := pg_catalog.clock_timestamp\(\)/gu)).toHaveLength(2);
  });

  it('completes a revoked command only through exact authorization and never changes status', () => {
    for (const source of [complete, materialGuard]) {
      expect(source).toContain('wallet_metadata_revoked_rewrap_authorizations');
      expect(source).toContain("alias.status = 'REVOKED'");
      expect(source).toContain(
        'evidence.verification_digest_version\n                = ANY (key_policy.accepted_read_versions)',
      );
      expect(source).toContain('evidence.registered_at');
      expect(source).toContain('evidence.revoked_at');
      expect(source).toContain('evidence.state_sha256');
    }
    expect(complete).toContain(
      "(target_wallet.status = 'ACTIVE' AND target_wallet.revoked_at IS NULL)",
    );
    expect(complete).toContain("target_wallet.status = 'REVOKED'");
    expect(complete).not.toContain("SET status = 'ACTIVE'");
    expect(complete).not.toContain('revoked_at = NULL');
    expect(complete.match(/recorded_at := pg_catalog.clock_timestamp\(\)/gu)).toHaveLength(2);
    expect(complete).toContain('recorded_at >= target_command.expires_at');
    expect(materialGuard).toContain('NEW.status IS DISTINCT FROM OLD.status');
    expect(materialGuard).toContain('NEW.revoked_at IS DISTINCT FROM OLD.revoked_at');
    expect(materialGuard).toContain('NEW.registered_at IS DISTINCT FROM OLD.registered_at');
  });

  it('retains IV/material uniqueness and allows no runtime or external authority', () => {
    expect(up).toContain('wallet_metadata_seal_iv_registry');
    expect(complete).toContain('requested_address_iv = target_wallet.address_iv');
    expect(complete).toContain('requested_metadata_iv = target_wallet.metadata_iv');
    expect(complete).toContain('requested_address_iv = requested_metadata_iv');
    expect(up).not.toContain('GRANT ');
    expect(up.match(/REVOKE ALL ON FUNCTION/gu)).toHaveLength(6);
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TABLE');
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TYPE');
    for (const forbidden of [
      'http://',
      'https://',
      'fetch(',
      'axios',
      'private_key',
      'broadcast',
      'sendTransaction',
      'may_authorize_financial_action',
      'ledger_settlement_authority',
    ]) {
      expect(up).not.toContain(forbidden);
    }
  });

  it('verifies exact bodies, ordered argument catalogs, ACLs, triggers, and state', () => {
    for (const marker of [
      'prior.valid AND relation_state.valid AND column_state.valid',
      'index_state.valid AND constraint_state.valid',
      'function_state.valid AND trigger_state.valid',
      'pg_catalog.pg_get_constraintdef(constraint_state.oid, false)',
      'body_sha256',
      'procedure.prosrc',
      'FROM pg_catalog.unnest(procedure.proargtypes)',
      'WITH ORDINALITY AS argument(argument_type, argument_position)',
      'actual_argument_types = argument_types',
      "trigger_state.tgenabled = 'A'",
      'trigger_state.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)',
      'pg_catalog.aclexplode',
      "relation.relpersistence = 'p'",
      "index_record.indkey = '1'::pg_catalog.int2vector",
      'acl.grantee <> relation.relowner',
      'verify_wallet_metadata_revoked_rewrap_state_v1() AS valid',
    ]) {
      expect(verifier).toContain(marker);
    }
    expect(up).toContain('command.prepared_at >= wallet.revoked_at');
    expect(up).toContain('evidence.authorized_at >= command.expires_at');
    expect(up).toContain("command.status = 'PREPARED'");
    expect(up).toContain('evidence.verification_digest_version');
    expect(verifier).toContain(
      'COALESCE((\n          SELECT pg_catalog.array_agg(argument_type ORDER BY argument_position)',
    );
  });

  it('refuses every rollback because restoring the old guard would reopen revoked state', () => {
    expect(down).toContain(
      "RAISE EXCEPTION 'cannot roll back revoked wallet metadata rewrap protection'",
    );
    expect(down).toContain("USING ERRCODE = '55000'");
    expect(down).not.toContain('DROP TABLE');
    expect(down).not.toContain('DROP FUNCTION');
    expect(down).not.toContain('GRANT ');
  });

  it('shares DDL with the isolated test variant and rejects unsafe principal names', () => {
    expect(migration.upSql).toEqual(
      createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041.upSql,
    );
    expect(migration.downSql).toEqual(
      createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041.verifySql,
    );
    expect(() =>
      createRevokedWalletMetadataKeyRetirementMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        apiRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('apiRuntimeRole');
  });
});
