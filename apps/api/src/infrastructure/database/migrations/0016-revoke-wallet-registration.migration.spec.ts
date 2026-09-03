import {
  createWalletRegistrationRevocationMigration,
  createWalletRegistrationRevocationMigrationV0016,
  createWalletRegistrationRevocationTestSchemaMigrationV0016,
} from './0016-revoke-wallet-registration.migration';

function joinedSql(sql: string | readonly string[]): string {
  return typeof sql === 'string' ? sql : sql.join('\n');
}

describe('migration 0016 wallet registration revocation', () => {
  it('adds fixed security-definer removal and guarded-completion boundaries without table grants', () => {
    const canonical = createWalletRegistrationRevocationMigrationV0016;
    const isolated = createWalletRegistrationRevocationTestSchemaMigrationV0016;
    const sql = joinedSql(canonical.upSql);

    expect(canonical.id).toBe('0016');
    expect(canonical.supersedesVerificationOf).toEqual(['0015']);
    expect(isolated.supersedesVerificationOf).toEqual(['0015']);
    expect(canonical.upSql).toEqual(isolated.upSql);
    expect(canonical.downSql).toEqual(isolated.downSql);
    expect(sql).toContain('CREATE FUNCTION revoke_wallet_registration(');
    expect(sql).toContain('CREATE FUNCTION verify_wallet_revocation_state()');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path TO pg_catalog, %I, pg_temp');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION revoke_wallet_registration(uuid,uuid,uuid)');
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION verify_wallet_revocation_state()\n      TO "crypto_api_runtime", "crypto_worker_runtime"',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION complete_wallet_registration_guarded(uuid,uuid,uuid',
    );
    expect(sql).not.toContain(
      'REVOKE EXECUTE ON FUNCTION complete_wallet_registration(uuid,uuid,uuid',
    );
    expect(sql).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
  });

  it('serializes revocation and rejects proofs older than identity-wide tombstones', () => {
    const sql = joinedSql(createWalletRegistrationRevocationMigrationV0016.upSql);
    const accountLock = sql.indexOf('requested_account_id::text, 56001');
    const identityLock = sql.indexOf('56002');
    const walletUpdate = sql.indexOf("SET status = 'REVOKED'");
    const tombstoneComparison = sql.indexOf(
      'ownership_challenge.created_at <= tombstone.revoked_at',
    );

    expect(accountLock).toBeGreaterThan(-1);
    expect(identityLock).toBeGreaterThan(accountLock);
    expect(walletUpdate).toBeGreaterThan(identityLock);
    expect(tombstoneComparison).toBeGreaterThan(-1);
    expect(sql).toContain("USING ERRCODE = 'W1601'");
    expect(sql).toContain("ownership_challenge.status = 'PENDING'");
    expect(sql).toContain("failure_reason = 'WALLET_REVOKED'");
    expect(sql).toContain('challenge_payload_ciphertext = NULL');
    expect(sql).toContain("OLD.status = 'PENDING'");
    expect(sql).toContain("NEW.status = 'REGISTERED'");
    expect(sql).toContain('OLD.created_at <= tombstone.revoked_at');
    expect(sql).not.toContain('NEW.created_at <= tombstone.revoked_at');
    expect(sql).toContain('ENABLE ALWAYS TRIGGER wallet_challenge_revocation_tombstone');
    expect(sql).toContain('DO $reject_existing_stale_active_wallets$');
    expect(sql).toContain('active wallet ownership proof predates a revocation');
    expect(sql).toContain('registration_challenge.created_at <= tombstone.revoked_at');
    expect(sql).toContain("RETURN QUERY SELECT 'UNCHANGED'::text");
  });

  it('records a single successful revocation event and makes revoked rows terminal', () => {
    const sql = joinedSql(createWalletRegistrationRevocationMigrationV0016.upSql);

    expect(sql).toContain("'WALLET_REVOKED',\n        'SUCCEEDED',\n        'NONE'");
    expect(sql).toContain("event_type = 'WALLET_REVOKED'");
    expect(sql).toContain("OLD.status = 'REVOKED'");
    expect(sql).toContain('revoked wallet registration is terminal');
    expect(sql).toContain('ENABLE ALWAYS TRIGGER registered_wallet_lifecycle');
    expect(sql).toContain('CREATE INDEX registered_wallets_revoked_identity_timeline_idx');
    expect(sql).toContain("WHERE status = 'REVOKED'");
  });

  it('pins cumulative verification for body, ACL, constraints, and lifecycle trigger', () => {
    const canonical = createWalletRegistrationRevocationMigrationV0016.verifySql ?? '';
    const isolated = createWalletRegistrationRevocationTestSchemaMigrationV0016.verifySql ?? '';

    expect(canonical).not.toEqual(isolated);
    for (const verifier of [canonical, isolated]) {
      expect(verifier).toContain('function_state.prosrc = $expected_revoke_body$');
      expect(verifier).toContain('function_state.prosrc = $expected_state_body$');
      expect(verifier).toContain('function_state.prosrc = $expected_guarded_completion_body$');
      expect(verifier).toContain('function_state.prosrc = $expected_lifecycle_body$');
      expect(verifier).toContain('function_state.prosrc = $expected_tombstone_body$');
      expect(verifier).toContain('function_state.prosrc = $expected_challenge_tombstone_body$');
      expect(verifier).toContain('revoke_wallet_registration(uuid,uuid,uuid)');
      expect(verifier).toContain('verify_wallet_revocation_state()');
      expect(verifier).toContain('registered_wallet_lifecycle');
      expect(verifier).toContain('registered_wallet_revocation_tombstone');
      expect(verifier).toContain('wallet_challenge_revocation_tombstone');
      expect(verifier).toContain('registered_wallets_revoked_identity_timeline_idx');
      expect(verifier).toContain("ARRAY['status', 'revoked_at']::text[]");
      expect(verifier).toContain("ARRAY['status']::text[]");
      expect(verifier).toContain('trigger_state.tgqual IS NULL');
      expect(verifier).toContain('trigger_state.tgnargs = 0');
      expect(verifier).toContain("index_state.indoption::text = '0 0 0 0 3 0'");
      expect(verifier).toContain("'wallet_registration_audit_shape_check'");
      expect(verifier).toContain("'wallet_ownership_challenges'");
      expect(verifier).toContain("'wallet_registration_audit_events'");
      expect(verifier).toContain('constraint_state.conrelid = pg_catalog.to_regclass(');
      expect(verifier).toContain('registration_state.valid');
      expect(verifier).toContain(
        "= '34ebe5f121d1278f6367098ea3927efd66935dea994cf0b4da3a55bfca06170e'",
      );
      expect(verifier).not.toContain(
        "pg_catalog.pg_get_constraintdef(constraint_state.oid, false),\n        'WALLET_REVOKED'",
      );
    }
  });

  it('refuses rollback after use rather than deleting audit history', () => {
    const down = joinedSql(createWalletRegistrationRevocationMigrationV0016.downSql);

    expect(down).toContain('DO $prevent_wallet_revocation_audit_loss$');
    expect(down).toContain('cannot roll back wallet revocation after use');
    expect(down).toContain("SELECT 1 FROM registered_wallets\n        WHERE status = 'REVOKED'");
    expect(down).not.toContain('DELETE FROM wallet_registration_audit_events');
    expect(down).toContain('DROP FUNCTION revoke_wallet_registration(uuid,uuid,uuid)');
  });

  it('delegates custom principal validation to the cumulative predecessor', () => {
    expect(() =>
      createWalletRegistrationRevocationMigration({
        bootstrapRole: 'postgres',
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
