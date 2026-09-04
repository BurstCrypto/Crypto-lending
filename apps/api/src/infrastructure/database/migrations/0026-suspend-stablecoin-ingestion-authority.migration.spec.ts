import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createStablecoinIngestionAuthoritySuspensionMigration,
  suspendStablecoinIngestionAuthorityMigrationV0026,
  suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026,
} from './0026-suspend-stablecoin-ingestion-authority.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0026 stablecoin ingestion authority suspension', () => {
  it('is a forward-only superseder of the latest cumulative verifier', () => {
    const migration = suspendStablecoinIngestionAuthorityMigrationV0026;

    expect(migration.id).toBe('0026');
    expect(migration.supersedesVerificationOf).toEqual(['0025']);
    expect(sql(migration.downSql)).toContain(
      'cannot roll back suspended stablecoin ingestion authority because rollback would regrant',
    );
    expect(sql(migration.downSql)).not.toContain('GRANT');
  });

  it('removes every runtime mutation capability and restores only API reads', () => {
    const up = sql(suspendStablecoinIngestionAuthorityMigrationV0026.upSql);

    for (const identity of [
      'record_stablecoin_depeg_latch(',
      'clear_stablecoin_depeg_latch(',
      'record_stablecoin_price_evidence(',
    ]) {
      expect(up).toContain(`REVOKE ALL ON FUNCTION ${identity}`);
      expect(up).not.toContain(`GRANT EXECUTE ON FUNCTION ${identity}`);
    }
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint) TO "crypto_api_runtime"',
    );
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION read_stablecoin_price_evidence(text,smallint,text,text,text,text,smallint,timestamp with time zone) TO "crypto_api_runtime"',
    );
    expect(up).not.toMatch(/TO "crypto_worker_runtime"/u);
  });

  it('verifies inherited access, exact function ACLs, and direct object denial', () => {
    for (const verifier of [
      suspendStablecoinIngestionAuthorityMigrationV0026.verifySql ?? '',
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql ?? '',
    ]) {
      expect(verifier).toContain(
        "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'record_stablecoin_depeg_latch",
      );
      expect(verifier).toContain(
        "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'record_stablecoin_price_evidence",
      );
      expect(verifier).toContain(
        "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'clear_stablecoin_depeg_latch",
      );
      expect(verifier).toContain(
        "pg_catalog.has_function_privilege('crypto_api_runtime', 'read_stablecoin_depeg_latch",
      );
      expect(verifier).toContain("relation.relkind = 'S'");
      expect(verifier).toContain("relation.relname LIKE 'stablecoin\\_%' ESCAPE '\\'");
      expect(verifier).toContain("pg_catalog.acldefault('T', guarded_type.typowner)");
      expect(verifier).toContain('acl.grantee <> relation.relowner');
      expect(verifier).toContain('acl.grantee <> guarded_type.typowner');
    }
  });

  it('shares authority-changing SQL while retaining cumulative verifier isolation', () => {
    expect(suspendStablecoinIngestionAuthorityMigrationV0026.upSql).toEqual(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.upSql,
    );
    expect(suspendStablecoinIngestionAuthorityMigrationV0026.downSql).toEqual(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.downSql,
    );
    expect(suspendStablecoinIngestionAuthorityMigrationV0026.verifySql).not.toEqual(
      suspendStablecoinIngestionAuthorityTestSchemaMigrationV0026.verifySql,
    );
  });

  it('rejects unsafe principal identifiers through the cumulative predecessor', () => {
    expect(() =>
      createStablecoinIngestionAuthoritySuspensionMigration({
        ...PRODUCTION_DATABASE_PRINCIPALS,
        workerRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('workerRuntimeRole');
  });
});
