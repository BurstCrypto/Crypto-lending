import { createHash } from 'node:crypto';

import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createLedgerCommandIdempotencyMigration,
  createLedgerCommandIdempotencyMigrationV0009,
  createLedgerCommandIdempotencyTestSchemaMigrationV0009,
} from './0009-create-ledger-command-idempotency.migration';
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

describe('createLedgerCommandIdempotencyMigration', () => {
  it('wires canonical and isolated 0009 variants after their exact 0008 predecessors', () => {
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
    ]);
    expect(DATABASE_MIGRATION_LIST.at(-22)).toBe(createLedgerCommandIdempotencyMigrationV0009);
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-22)).toBe(
      createLedgerCommandIdempotencyTestSchemaMigrationV0009,
    );
  });

  it('shares exact DDL and rollback while preserving cumulative verifier divergence', () => {
    const canonical = createLedgerCommandIdempotencyMigrationV0009;
    const isolated = createLedgerCommandIdempotencyTestSchemaMigrationV0009;

    expect(isolated.upSql).toEqual(canonical.upSql);
    expect(isolated.downSql).toEqual(canonical.downSql);
    expect(isolated.verifySql).not.toEqual(canonical.verifySql);
    expect(canonical.supersedesVerificationOf).toEqual(['0008']);
    expect(isolated.supersedesVerificationOf).toEqual(['0008']);
    expect(migrationChecksum(isolated)).not.toBe(migrationChecksum(canonical));
  });

  it('pins retained command identity, completion, and existing-outbox composition', () => {
    const upSql = joinedSql(createLedgerCommandIdempotencyMigrationV0009.upSql);

    expect(upSql).toContain('CREATE TABLE ledger_command_idempotency');
    expect(upSql).toContain('CREATE TABLE ledger_command_idempotency_results');
    expect(upSql).toContain('CREATE TABLE ledger_provider_submission_identities');
    expect(upSql).toContain("operation IN ('POST_JOURNAL', 'REVERSE_JOURNAL')");
    expect(upSql).toContain('contract_version = 1');
    expect(upSql).toContain('fingerprint_version = 1');
    expect(upSql).toContain('octet_length(key_digest) = 32');
    expect(upSql).toContain('octet_length(request_fingerprint) = 32');
    expect(upSql).toContain('ADD COLUMN ledger_command_id uuid');
    expect(upSql).toContain('ADD COLUMN ledger_journal_id uuid');
    expect(upSql).toContain('CREATE UNIQUE INDEX job_outbox_ledger_command_unique');
    expect(upSql).toContain('ledger command must complete in its claim transaction');
    expect(upSql).toContain("USING ERRCODE = 'L4301'");
  });

  it('exposes exactly the three fixed idempotency boundaries to the configured API role', () => {
    const names = {
      ...PRODUCTION_DATABASE_PRINCIPALS,
      apiRuntimeRole: 'kan43_custom_api',
      workerRuntimeRole: 'kan43_custom_worker',
      legacyRuntimeRole: 'kan43_custom_legacy',
    };
    const migration = createLedgerCommandIdempotencyMigration(names);
    const upSql = joinedSql(migration.upSql);
    const downSql = joinedSql(migration.downSql);

    expect(upSql).toMatch(
      /GRANT EXECUTE ON FUNCTION resolve_ledger_command_idempotency\([\s\S]+?TO "kan43_custom_api"/u,
    );
    expect(upSql).toMatch(
      /GRANT EXECUTE ON FUNCTION claim_ledger_command_idempotency\([\s\S]+?TO "kan43_custom_api"/u,
    );
    expect(upSql).toMatch(
      /GRANT EXECUTE ON FUNCTION complete_ledger_command_idempotency\([\s\S]+?TO "kan43_custom_api"/u,
    );
    expect(upSql).toContain(
      'GRANT INSERT (ledger_command_id, ledger_journal_id)\n      ON TABLE job_outbox',
    );
    expect(upSql).not.toContain('GRANT SELECT ON TABLE ledger_');
    expect(upSql).not.toMatch(/GRANT EXECUTE[\s\S]+?TO "kan43_custom_worker"/u);
    expect(downSql).toContain(
      'REVOKE INSERT (ledger_command_id, ledger_journal_id)\n       ON TABLE job_outbox',
    );
  });

  it('keeps provider identity inert, verifies exact catalogs, and refuses retained rollback', () => {
    const migration = createLedgerCommandIdempotencyMigrationV0009;
    const upSql = joinedSql(migration.upSql);
    const downSql = joinedSql(migration.downSql);
    const verifySql = migration.verifySql ?? '';

    expect(upSql).toContain('CONSTRAINT ledger_provider_submission_scope_unique UNIQUE');
    expect(upSql).toContain('BEFORE UPDATE OR DELETE ON ledger_provider_submission_identities');
    expect(upSql).not.toContain('GRANT INSERT ON TABLE ledger_provider_submission_identities');
    expect(verifySql).not.toBe('SELECT true AS valid');
    expect(verifySql).toContain('SELECT object_count = 30 FROM table_catalog');
    expect(verifySql).toContain('SELECT object_count = 29 FROM function_catalog');
    expect(verifySql).toContain('job_outbox_ledger_link_pair_check');
    expect(verifySql).toContain('resolve_ledger_command_idempotency');
    expect(downSql).toContain('cannot roll back retained ledger command identities');
  });
});
