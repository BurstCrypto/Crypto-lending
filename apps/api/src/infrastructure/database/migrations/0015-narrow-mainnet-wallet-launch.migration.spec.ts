import {
  createMainnetWalletLaunchNarrowingMigration,
  createMainnetWalletLaunchNarrowingMigrationV0015,
  createMainnetWalletLaunchNarrowingTestSchemaMigrationV0015,
} from './0015-narrow-mainnet-wallet-launch.migration';

function joinedSql(sql: string | readonly string[]): string {
  return typeof sql === 'string' ? sql : sql.join('\n');
}

describe('migration 0015 mainnet wallet launch narrowing', () => {
  it('fails closed on legacy active non-launch mainnet rows before replacing the trigger', () => {
    const sql = joinedSql(createMainnetWalletLaunchNarrowingMigrationV0015.upSql);

    expect(sql).toContain('DO $validate_mainnet_active_wallet_launch_scope$');
    expect(sql).toContain("wallet.registry_environment = 'MAINNET'");
    expect(sql).toContain("wallet.chain_reference = '1'");
    expect(sql).toContain("wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'");
    expect(sql).toContain('existing active mainnet wallet registration is outside');
    expect(sql).toContain("USING ERRCODE = '23514'");
    expect(sql).not.toContain("wallet.chain_reference = '8453'");
    expect(sql).not.toContain("wallet.chain_reference IN ('1', '8453')");
  });

  it('enforces the exact production and retained testnet allowlists on every activation', () => {
    const canonical = createMainnetWalletLaunchNarrowingMigrationV0015;
    const isolated = createMainnetWalletLaunchNarrowingTestSchemaMigrationV0015;
    const sql = joinedSql(canonical.upSql);

    expect(canonical.id).toBe('0015');
    expect(canonical.supersedesVerificationOf).toEqual(['0014']);
    expect(isolated.supersedesVerificationOf).toEqual(['0014']);
    expect(canonical.upSql).toEqual(isolated.upSql);
    expect(canonical.downSql).toEqual(isolated.downSql);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION enforce_active_wallet_account_capacity()');
    expect(sql).toContain("NEW.registry_environment = 'MAINNET'");
    expect(sql).toContain("NEW.chain_reference = '1'");
    expect(sql).toContain("NEW.registry_environment = 'TESTNET'");
    expect(sql).toContain("NEW.chain_reference IN ('11155111', '84532')");
    expect(sql).toContain('active wallet registration is outside the production launch allowlist');
    expect(sql).not.toContain("NEW.chain_reference = '8453'");
    expect(sql).not.toContain("NEW.chain_reference IN ('1', '8453')");
  });

  it('retains the cumulative verifier while pinning the replacement trigger body', () => {
    const canonical = createMainnetWalletLaunchNarrowingMigrationV0015.verifySql ?? '';
    const isolated = createMainnetWalletLaunchNarrowingTestSchemaMigrationV0015.verifySql ?? '';

    expect(canonical).not.toEqual(isolated);
    for (const verifier of [canonical, isolated]) {
      expect(verifier).toContain('function_state.prosrc = $expected_cap_body$');
      expect(verifier).toContain("NEW.registry_environment = 'MAINNET'");
      expect(verifier).toContain("NEW.chain_reference = '1'");
      expect(verifier).toContain("NEW.chain_reference IN ('11155111', '84532')");
      expect(verifier).not.toContain("NEW.chain_reference IN ('1', '8453')");
      expect(verifier).toContain('list_active_wallet_registrations(uuid)');
    }
  });

  it('restores the exact capacity-only trigger behavior on rollback', () => {
    const down = joinedSql(createMainnetWalletLaunchNarrowingMigrationV0015.downSql);

    expect(down).toContain('CREATE OR REPLACE FUNCTION enforce_active_wallet_account_capacity()');
    expect(down).toContain("OR (TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE')");
    expect(down).not.toContain('production launch allowlist');
  });

  it('delegates custom principal validation to the cumulative predecessor', () => {
    expect(() =>
      createMainnetWalletLaunchNarrowingMigration({
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
