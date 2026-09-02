import {
  createActiveWalletRegistrationListMigration,
  createActiveWalletRegistrationListMigrationV0014,
  createActiveWalletRegistrationListTestSchemaMigrationV0014,
} from './0014-list-active-wallet-registrations.migration';

function joinedSql(sql: string | readonly string[]): string {
  return typeof sql === 'string' ? sql : sql.join('\n');
}

describe('migration 0014 account-scoped active wallet list', () => {
  it('adds one bounded security-definer read function with an exact API-only grant', () => {
    const canonical = createActiveWalletRegistrationListMigrationV0014;
    const isolated = createActiveWalletRegistrationListTestSchemaMigrationV0014;
    const sql = joinedSql(canonical.upSql);

    expect(canonical.id).toBe('0014');
    expect(canonical.supersedesVerificationOf).toEqual(['0013']);
    expect(isolated.supersedesVerificationOf).toEqual(['0013']);
    expect(canonical.upSql).toEqual(isolated.upSql);
    expect(canonical.downSql).toEqual(isolated.downSql);
    expect(sql).toContain(
      'CREATE FUNCTION list_active_wallet_registrations(requested_account_id uuid)',
    );
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('STABLE');
    expect(sql).toContain('STRICT');
    expect(sql).toContain('PARALLEL UNSAFE');
    expect(sql).toContain('ROWS 33');
    expect(sql).toContain('DO $validate_active_wallet_roster$');
    expect(sql).toContain("WHERE wallet.status = 'ACTIVE'");
    expect(sql).toContain('GROUP BY wallet.account_id');
    expect(sql).toContain('HAVING pg_catalog.count(*) > 32');
    expect(sql).toContain("USING ERRCODE = '23514'");
    expect(sql).toContain("wallet.registry_environment = 'MAINNET'");
    expect(sql).toContain("wallet.chain_reference IN ('1', '8453')");
    expect(sql).toContain("wallet.registry_environment = 'TESTNET'");
    expect(sql).toContain("wallet.chain_reference IN ('11155111', '84532')");
    expect(sql).toContain('existing active wallet registration is outside the launch allowlist');
    expect(sql).toContain("wallet.status = 'ACTIVE'");
    expect(sql).toContain('wallet.account_id = requested_account_id');
    expect(sql).toContain('ORDER BY wallet.registered_at DESC, wallet.wallet_id');
    expect(sql).toContain('LIMIT 33');
    expect(sql).toContain('CREATE FUNCTION enforce_active_wallet_account_capacity()');
    expect(sql).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(sql).toContain('active_wallet_count >= 32');
    expect(sql).toContain(
      'CREATE TRIGGER registered_wallet_account_capacity\n      BEFORE INSERT OR UPDATE OF status',
    );
    expect(sql).toContain('ENABLE ALWAYS TRIGGER registered_wallet_account_capacity');
    expect(sql).not.toContain('pgp_sym_decrypt');
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?registered_wallets/iu);
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION list_active_wallet_registrations(uuid) TO "crypto_api_runtime"',
    );
    expect(sql).toContain(
      'FROM PUBLIC, "crypto_api_runtime", "crypto_worker_runtime", "crypto_runtime"',
    );
  });

  it('extends the cumulative verifier without weakening direct table denial', () => {
    const verifier = createActiveWalletRegistrationListMigrationV0014.verifySql ?? '';

    expect(verifier).toContain('yield_operation.valid');
    expect(verifier).toContain("to_regprocedure('list_active_wallet_registrations(uuid)')");
    expect(verifier).toContain("language.lanname = 'sql'");
    expect(verifier).toContain("function_state.provolatile = 's'");
    expect(verifier).toContain("function_state.proparallel = 'u'");
    expect(verifier).toContain('function_state.prorows = 33');
    expect(verifier).toContain("'requested_account_id uuid'");
    expect(verifier).toContain('wallet_capacity.valid');
    expect(verifier).toContain('function_state.prosrc = $expected_cap_body$');
    expect(verifier).toContain('trigger_state.tgtype = 23');
    expect(verifier).toContain('function_state.prosrc = $expected_body$');
    expect(verifier).toContain("grantee.rolname = 'crypto_api_runtime'");
    expect(verifier).toContain("acl.privilege_type = 'EXECUTE'");
    expect(verifier).toContain('registered_wallets_one_active_identity');
    expect(verifier).toContain("'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'");
  });

  it('drops only the additive function on rollback', () => {
    expect(joinedSql(createActiveWalletRegistrationListMigrationV0014.downSql)).toBe(
      [
        'REVOKE EXECUTE ON FUNCTION list_active_wallet_registrations(uuid) FROM "crypto_api_runtime"',
        'DROP TRIGGER registered_wallet_account_capacity ON registered_wallets',
        'DROP FUNCTION enforce_active_wallet_account_capacity()',
        'DROP FUNCTION list_active_wallet_registrations(uuid)',
      ].join('\n'),
    );
  });

  it('retains principal-name validation through the cumulative prior verifier', () => {
    expect(() =>
      createActiveWalletRegistrationListMigration({
        apiLoginPrefix: 'crypto_api_login_',
        apiRuntimeRole: 'Crypto-Api',
        bootstrapRole: 'crypto_admin',
        legacyRuntimeRole: 'crypto_runtime',
        migrationRole: 'crypto_migration',
        schemaOwnerRole: 'crypto_schema_owner',
        workerLoginPrefix: 'crypto_worker_login_',
        workerRuntimeRole: 'crypto_worker_runtime',
      }),
    ).toThrow('apiRuntimeRole must be a lowercase PostgreSQL identifier');
  });
});
