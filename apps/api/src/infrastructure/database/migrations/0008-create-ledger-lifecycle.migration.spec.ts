import { createHash } from 'node:crypto';

import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createLedgerLifecycleMigration,
  createLedgerLifecycleMigrationV0008,
  createLedgerLifecycleTestSchemaMigrationV0008,
} from './0008-create-ledger-lifecycle.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';
import type { DatabaseMigration } from './migration';

function joinedSql(sql: string | readonly string[]): string {
  return typeof sql === 'string' ? sql : sql.join('\n');
}

function migrationChecksum(migration: DatabaseMigration): string {
  const sql = (value: string | readonly string[]): string =>
    typeof value === 'string' ? value : value.join('\0statement\0');
  const hash = createHash('sha256')
    .update(migration.id)
    .update('\0')
    .update(sql(migration.upSql))
    .update('\0')
    .update(sql(migration.downSql));
  if (migration.verifySql !== undefined) hash.update('\0verify\0').update(migration.verifySql);
  if (migration.supersedesVerificationOf !== undefined) {
    hash
      .update('\0supersedes-verification-of\0')
      .update(migration.supersedesVerificationOf.join('\0'));
  }
  return hash.digest('hex');
}

describe('createLedgerLifecycleMigration', () => {
  it('wires canonical and isolated 0008 variants after their exact 0007 predecessors', () => {
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
    ]);
    expect(DATABASE_MIGRATION_LIST.at(-26)).toBe(createLedgerLifecycleMigrationV0008);
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-26)).toBe(
      createLedgerLifecycleTestSchemaMigrationV0008,
    );
  });

  it('shares exact DDL and rollback while preserving cumulative verifier divergence', () => {
    const canonical = createLedgerLifecycleMigrationV0008;
    const isolated = createLedgerLifecycleTestSchemaMigrationV0008;

    expect(isolated.upSql).toEqual(canonical.upSql);
    expect(isolated.downSql).toEqual(canonical.downSql);
    expect(isolated.verifySql).not.toEqual(canonical.verifySql);
    expect(canonical.supersedesVerificationOf).toEqual(['0007']);
    expect(isolated.supersedesVerificationOf).toEqual(['0007']);
    expect(migrationChecksum(isolated)).not.toBe(migrationChecksum(canonical));
  });

  it('pins the approved lifecycle and recovery graphs with append-only history', () => {
    const upSql = joinedSql(createLedgerLifecycleMigrationV0008.upSql);

    expect(upSql).toContain("('SUBMITTED', 'SETTLED', 'SETTLEMENT_RECORDED')");
    expect(upSql).toContain("('PENDING', 'SETTLED', 'SETTLEMENT_RECORDED')");
    expect(upSql).toContain("('SETTLED', 'REVERSED', 'FULL_REVERSAL_RECORDED')");
    expect(upSql).toContain("('NOT_REQUIRED', 'REQUIRED', 'RECOVERY_REQUIRED')");
    expect(upSql).toContain('CREATE TABLE ledger_transaction_lifecycle_events');
    expect(upSql).toContain('CREATE TABLE ledger_leg_lifecycle_events');
    expect(upSql).toContain('CREATE TABLE ledger_recovery_state_events');
    expect(upSql).toContain('NEW.recorded_at := clock_timestamp()');
    expect(upSql).toContain('BEFORE UPDATE OR DELETE ON ledger_leg_lifecycle_events');
    expect(upSql).toContain('ENABLE ALWAYS TRIGGER ledger_leg_lifecycle_append_row');
    expect(upSql).toContain("USING ERRCODE = 'L4201'");
  });

  it('exposes only fixed transition and composition boundaries to the API role', () => {
    const names = {
      ...PRODUCTION_DATABASE_PRINCIPALS,
      apiRuntimeRole: 'kan42_custom_api',
      workerRuntimeRole: 'kan42_custom_worker',
      legacyRuntimeRole: 'kan42_custom_legacy',
    };
    const migration = createLedgerLifecycleMigration(names);
    const upSql = joinedSql(migration.upSql);
    const downSql = joinedSql(migration.downSql);

    expect(upSql).toMatch(
      /REVOKE EXECUTE ON FUNCTION post_ledger_journal\([\s\S]+?FROM "kan42_custom_api"/u,
    );
    expect(upSql).toMatch(
      /GRANT EXECUTE ON FUNCTION transition_ledger_transaction_state\([\s\S]+?TO "kan42_custom_api"/u,
    );
    expect(upSql).toMatch(
      /GRANT EXECUTE ON FUNCTION post_ledger_journal_with_lifecycle\([\s\S]+?TO "kan42_custom_api"/u,
    );
    expect(upSql).toContain('SET search_path TO pg_catalog, %I, pg_temp');
    expect(upSql).not.toContain('GRANT SELECT ON TABLE ledger_');
    expect(downSql).toMatch(
      /GRANT EXECUTE ON FUNCTION post_ledger_journal\([\s\S]+?TO "kan42_custom_api"/u,
    );
  });

  it('extends exact catalog and seed verification and refuses populated rollback', () => {
    const migration = createLedgerLifecycleMigrationV0008;
    const verifySql = migration.verifySql ?? '';
    const downSql = joinedSql(migration.downSql);

    expect(verifySql).not.toBe('SELECT true AS valid');
    expect(verifySql).toContain('SELECT object_count = 27 FROM table_catalog');
    expect(verifySql).toContain('SELECT object_count = 24 FROM function_catalog');
    expect(joinedSql(migration.upSql)).toContain(
      'CONSTRAINT ledger_lifecycle_rules_transition_check',
    );
    expect(joinedSql(migration.upSql)).toContain(
      'CONSTRAINT ledger_recovery_rules_transition_check',
    );
    expect(verifySql).toContain('post_ledger_journal_with_lifecycle');
    expect(verifySql).not.toContain(
      "function_state.proname IN ('post_ledger_journal', 'reverse_ledger_journal')",
    );
    expect(downSql).toContain('cannot roll back immutable ledger lifecycle history');
  });
});
