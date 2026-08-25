import {
  createLedgerFeeAdjustmentIntegrityMigration,
  createLedgerFeeAdjustmentIntegrityMigrationV0013,
  createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013,
} from './0013-repair-ledger-fee-adjustment-integrity.migration';

function joinedSql(sql: string | readonly string[]): string {
  return typeof sql === 'string' ? sql : sql.join('\n');
}

describe('migration 0013 immutable fee-adjustment integrity repair', () => {
  it('registers a forward-only stage-aware repair with a cumulative verifier', () => {
    const canonical = createLedgerFeeAdjustmentIntegrityMigrationV0013;
    const isolated = createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013;

    expect(canonical.id).toBe('0013');
    expect(canonical.description).toBe(
      'repair immutable ledger fee-adjustment integrity stage matching',
    );
    expect(canonical.supersedesVerificationOf).toEqual(['0012']);
    expect(isolated.supersedesVerificationOf).toEqual(['0012']);
    expect(canonical.upSql).toEqual(isolated.upSql);
    expect(canonical.downSql).toEqual(isolated.downSql);

    const upSql = joinedSql(canonical.upSql);
    expect(upSql).toContain("WHEN target_event_type = 'ADJUSTMENT' THEN 'ADJUSTMENT'");
    expect(upSql).toContain("ELSE 'ACTUAL'");
    expect(upSql).toContain("to_regprocedure('assert_ledger_journal_integrity(uuid)')");
    expect(upSql).toContain('pg_catalog.pg_get_functiondef(target_function)');
    expect(upSql).toContain('expected_occurrences <> 1');
    expect(upSql).toContain(
      'ledger journal integrity function does not match the expected repair source',
    );

    const verifier = canonical.verifySql ?? '';
    expect(verifier).toContain('yield_operation.valid');
    expect(verifier).toContain("function_state.proname = 'assert_ledger_journal_integrity'");
    expect(verifier).toContain("WHEN target_event_type = 'ADJUSTMENT' THEN 'ADJUSTMENT'");
    expect(verifier).toContain("AND component.stage = 'ACTUAL'");
    expect(verifier).toContain('pg_catalog.bool_and');
  });

  it('blocks rollback after any immutable adjustment component exists', () => {
    const downSql = joinedSql(createLedgerFeeAdjustmentIntegrityMigrationV0013.downSql);

    expect(downSql).toContain('FROM ledger_fee_components AS component');
    expect(downSql).toContain("component.stage = 'ADJUSTMENT'");
    expect(downSql).toContain(
      'cannot roll back fee-adjustment integrity after adjustment facts exist',
    );
    expect(downSql).toContain("AND component.stage = 'ACTUAL'");
  });

  it('retains principal-name validation through the cumulative prior verifier', () => {
    expect(() =>
      createLedgerFeeAdjustmentIntegrityMigration({
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
