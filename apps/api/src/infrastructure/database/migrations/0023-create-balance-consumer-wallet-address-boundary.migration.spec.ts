import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createBalanceConsumerWalletAddressBoundaryMigration,
  createBalanceConsumerWalletAddressBoundaryMigrationV0023,
  createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023,
} from './0023-create-balance-consumer-wallet-address-boundary.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0023 balance consumer wallet address boundary', () => {
  it('creates one exact mainnet-only definer function with no table grant', () => {
    const up = sql(createBalanceConsumerWalletAddressBoundaryMigrationV0023.upSql);
    expect(createBalanceConsumerWalletAddressBoundaryMigrationV0023.id).toBe('0023');
    expect(
      createBalanceConsumerWalletAddressBoundaryMigrationV0023.supersedesVerificationOf,
    ).toEqual(['0022']);
    expect(up).toContain(
      'CREATE FUNCTION resolve_active_wallet_address_ciphertext(\n      requested_account_id uuid',
    );
    expect(up).toContain('LANGUAGE sql\n    SECURITY DEFINER\n    STABLE\n    STRICT');
    expect(up).toContain("requested_network_id IN (\n        'eip155:1'");
    expect(up).toContain("'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'");
    expect(up).toContain("wallet.status = 'ACTIVE'");
    expect(up).toContain("wallet.registry_environment = 'MAINNET'");
    expect(up).toContain('alias.address_digest_version = ANY (policy.accepted_read_versions)');
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text) TO "crypto_worker_runtime"',
    );
    expect(up).not.toMatch(/GRANT\s+SELECT\s+ON/iu);
    expect(up).not.toContain('metadata_ciphertext');
    expect(up).not.toContain('active_verification_digest');
  });

  it('binds the verifier to exact signature, owner, body, path, ACL, and table denial', () => {
    const verifier = createBalanceConsumerWalletAddressBoundaryMigrationV0023.verifySql ?? '';
    expect(verifier).toContain(
      "function_state.oid = pg_catalog.to_regprocedure('resolve_active_wallet_address_ciphertext(uuid,uuid,text)')",
    );
    expect(verifier).toContain("owner_role.rolname = 'crypto_schema_owner'");
    expect(verifier).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8'))",
    );
    expect(verifier).toMatch(/\) = '[0-9a-f]{64}'/u);
    expect(verifier).toContain(
      "'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'",
    );
    expect(verifier).toContain("grantee.rolname = 'crypto_worker_runtime'");
    expect(verifier).toContain(
      "NOT pg_catalog.has_table_privilege(\n          'crypto_worker_runtime', 'registered_wallet_identity_digests', 'SELECT'",
    );
    expect(verifier).toContain(
      "to_regprocedure('resolve_active_wallet_address_ciphertext(uuid,uuid,text)')",
    );
  });

  it('revokes before a dependency-safe rollback without pretending the read boundary owns data', () => {
    const down = sql(createBalanceConsumerWalletAddressBoundaryMigrationV0023.downSql);
    expect(down).toContain(
      'REVOKE EXECUTE ON FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)',
    );
    expect(down).toContain(
      'DROP FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text) RESTRICT',
    );
    expect(down).not.toContain('registered_wallets');
    expect(down).not.toContain('balance_sync_checkpoints');
  });

  it('rejects unsafe principal substitutions and separates production/test verifiers', () => {
    expect(() =>
      createBalanceConsumerWalletAddressBoundaryMigration({
        ...PRODUCTION_DATABASE_PRINCIPALS,
        workerRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('workerRuntimeRole');
    expect(createBalanceConsumerWalletAddressBoundaryMigrationV0023.upSql).toEqual(
      createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023.upSql,
    );
    expect(createBalanceConsumerWalletAddressBoundaryMigrationV0023.downSql).toEqual(
      createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023.downSql,
    );
    expect(createBalanceConsumerWalletAddressBoundaryMigrationV0023.verifySql).not.toEqual(
      createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023.verifySql,
    );
  });
});
