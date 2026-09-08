import { createHash } from 'node:crypto';

import {
  createImmutableLedgerMigration,
  createImmutableLedgerMigrationV0007,
  createImmutableLedgerTestSchemaMigrationV0007,
} from './0007-create-immutable-ledger.migration';
import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';
import type { DatabaseMigration } from './migration';

function migrationChecksum(migration: DatabaseMigration): string {
  const sql = (value: string | readonly string[]): string =>
    typeof value === 'string' ? value : value.join('\0statement\0');
  const hash = createHash('sha256')
    .update(migration.id)
    .update('\0')
    .update(sql(migration.upSql))
    .update('\0')
    .update(sql(migration.downSql));
  if (migration.transactional !== undefined) {
    hash.update('\0transactional\0').update(String(migration.transactional));
  }
  if (migration.verifySql !== undefined) {
    hash.update('\0verify\0').update(migration.verifySql);
  }
  if (migration.supersedesVerificationOf !== undefined) {
    hash
      .update('\0supersedes-verification-of\0')
      .update(migration.supersedesVerificationOf.join('\0'));
  }
  return hash.digest('hex');
}

function joinedSql(sql: string | readonly string[]): string {
  return typeof sql === 'string' ? sql : sql.join('\n');
}

describe('createImmutableLedgerMigration', () => {
  it('wires the canonical and isolated-schema migration orders explicitly', () => {
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
      '0021',
      '0022',
      '0023',
      '0024',
      '0025',
      '0026',
      '0027',
      '0028',
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
      '0037',
      '0038',
    ]);
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.map(({ id }) => id)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
      '0021',
      '0022',
      '0023',
      '0024',
      '0025',
      '0026',
      '0027',
      '0028',
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
      '0037',
      '0038',
    ]);
    expect(DATABASE_MIGRATION_LIST.at(-32)).toBe(createImmutableLedgerMigrationV0007);
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-32)).toBe(
      createImmutableLedgerTestSchemaMigrationV0007,
    );
  });

  it('keeps test DDL and rollback byte-identical while isolating verification metadata', () => {
    const canonical = createImmutableLedgerMigrationV0007;
    const isolated = createImmutableLedgerTestSchemaMigrationV0007;

    expect(isolated.upSql).toEqual(canonical.upSql);
    expect(isolated.downSql).toEqual(canonical.downSql);
    expect(isolated.verifySql).not.toEqual(canonical.verifySql);
    expect(canonical.supersedesVerificationOf).toEqual(['0005']);
    expect(isolated.supersedesVerificationOf).toBeUndefined();
    expect(migrationChecksum(isolated)).not.toBe(migrationChecksum(canonical));
  });

  it('exempts only the exact ledger table row types from cumulative principal checks', () => {
    const cumulativeVerifier = createImmutableLedgerMigrationV0007.verifySql ?? '';
    const isolatedVerifier = createImmutableLedgerTestSchemaMigrationV0007.verifySql ?? '';
    const ledgerTables = [
      'ledger_books',
      'ledger_assets',
      'ledger_accounts',
      'ledger_transactions',
      'ledger_legs',
      'ledger_leg_posting_plans',
      'ledger_leg_posting_plan_lines',
      'ledger_leg_recognition_evidence',
      'ledger_leg_valuation_plans',
      'ledger_leg_fee_plans',
      'ledger_leg_posting_plan_seals',
      'ledger_journals',
      'ledger_journal_lines',
      'ledger_reversal_approvals',
      'ledger_command_capabilities',
      'ledger_command_capability_resolutions',
      'ledger_valuation_snapshots',
      'ledger_fee_estimate_snapshots',
      'ledger_fee_components',
      'ledger_external_evidence',
      'ledger_external_evidence_claims',
      'ledger_journal_external_reference_usages',
    ];
    const exactAllowList = ledgerTables.map((table) => `'${table}'`).join(', ');
    const rowTypeAllowLists = [
      ...cumulativeVerifier.matchAll(
        /AS ledger_row_table[\s\S]*?ledger_row_table\.relname IN \(([^)]+)\)/gu,
      ),
    ].map((match) => match[1]);

    expect(cumulativeVerifier.match(/AS ledger_row_table/gu)).toHaveLength(2);
    expect(cumulativeVerifier.match(/type_object\.typrelid/gu)).toHaveLength(2);
    expect(rowTypeAllowLists).toEqual([exactAllowList, exactAllowList]);
    for (const table of ledgerTables) {
      expect(cumulativeVerifier).toContain(`'${table}'`);
    }
    expect(cumulativeVerifier).not.toContain("'nonledger_composite'");
    expect(isolatedVerifier).not.toContain('AS ledger_row_table');
  });

  it('builds a cumulative verifier and exact capability ACLs for custom principals', () => {
    const names = {
      ...PRODUCTION_DATABASE_PRINCIPALS,
      schemaOwnerRole: 'kan41_custom_owner',
      apiRuntimeRole: 'kan41_custom_api',
      workerRuntimeRole: 'kan41_custom_worker',
      legacyRuntimeRole: 'kan41_custom_legacy',
      apiLoginPrefix: 'kan41_custom_api_',
      workerLoginPrefix: 'kan41_custom_worker_',
    };
    const migration = createImmutableLedgerMigration(names);
    const upSql = joinedSql(migration.upSql);

    expect(migration.supersedesVerificationOf).toEqual(['0005']);
    expect(migration.verifySql).toContain("role_state.rolname = 'kan41_custom_owner'");
    expect(migration.verifySql).toContain("role_state.rolname = 'kan41_custom_api'");
    expect(upSql).toMatch(
      /GRANT EXECUTE ON FUNCTION post_ledger_journal\(\s*text, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text\s*\) TO "kan41_custom_api"/u,
    );
    expect(upSql).toMatch(
      /GRANT EXECUTE ON FUNCTION reverse_ledger_journal\(\s*text, uuid, text, timestamptz, timestamptz, uuid\s*\) TO "kan41_custom_api"/u,
    );
    expect(upSql).not.toContain('GRANT SELECT ON TABLE ledger_');
    expect(upSql).not.toContain('requested_actor_account_id');
    expect(upSql).not.toContain('requested_journal_id');
  });

  it('pins append-only integrity, hardened paths, verifier drift, and populated rollback refusal', () => {
    const migration = createImmutableLedgerMigrationV0007;
    const upSql = joinedSql(migration.upSql);
    const downSql = joinedSql(migration.downSql);
    const verifySql = migration.verifySql ?? '';

    expect(upSql).toContain('SECURITY DEFINER');
    expect(upSql).toContain('SET search_path TO pg_catalog, %I, pg_temp');
    expect(upSql).toContain('ENABLE ALWAYS TRIGGER');
    expect(upSql).toContain('BEFORE UPDATE OR DELETE ON ledger_journals');
    expect(upSql).toContain('BEFORE TRUNCATE ON ledger_journals');
    expect(verifySql).toContain('ledger_touching_constraints AS MATERIALIZED');
    expect(verifySql).toContain('pg_catalog.pg_inherits');
    expect(verifySql).toContain('pg_catalog.pg_rewrite');
    expect(verifySql).toContain("namespace_state.nspname = '__schema__'");
    expect(verifySql).toContain('function_state.prosrc');
    expect(downSql).toContain('refusing to roll back populated immutable ledger tables');
  });
});
