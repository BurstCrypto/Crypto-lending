import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';

interface StoredMigration extends QueryResultRow {
  id: string;
  checksum: string;
}

function result<Row extends QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

class InMemoryMigrationDatabase {
  readonly applied = new Map<string, StoredMigration>();
  readonly indexes = new Map<string, string>();
  readonly queries: string[] = [];
  accountSchemaExists = false;
  authenticationSchemaExists = false;
  jobOutboxExists = false;
  jobOutboxLastErrorConstraintExists = false;
  ledgerIdempotencySchemaExists = false;
  ledgerSchemaExists = false;
  walletRegistrationSchemaExists = false;
  yieldOperationSchemaExists = false;
  migrationTableExists = false;
  oldVerifierValid = true;
  newVerifierValid = true;
  thirdVerifierValid = true;
  released = false;
  private transactionAppliedSnapshot: Map<string, StoredMigration> | undefined;
  private transactionAuthenticationSchemaExistsSnapshot: boolean | undefined;
  private transactionLedgerSchemaExistsSnapshot: boolean | undefined;
  private transactionLedgerIdempotencySchemaExistsSnapshot: boolean | undefined;
  private transactionWalletRegistrationSchemaExistsSnapshot: boolean | undefined;
  private transactionYieldOperationSchemaExistsSnapshot: boolean | undefined;

  readonly client = {
    query: async (text: string, values: readonly unknown[] = []): Promise<QueryResult> => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      this.queries.push(normalized);

      if (normalized === 'BEGIN') {
        this.transactionAppliedSnapshot = new Map(this.applied);
        this.transactionAuthenticationSchemaExistsSnapshot = this.authenticationSchemaExists;
        this.transactionLedgerSchemaExistsSnapshot = this.ledgerSchemaExists;
        this.transactionLedgerIdempotencySchemaExistsSnapshot = this.ledgerIdempotencySchemaExists;
        this.transactionWalletRegistrationSchemaExistsSnapshot =
          this.walletRegistrationSchemaExists;
        this.transactionYieldOperationSchemaExistsSnapshot = this.yieldOperationSchemaExists;
      } else if (normalized === 'COMMIT') {
        this.transactionAppliedSnapshot = undefined;
        this.transactionAuthenticationSchemaExistsSnapshot = undefined;
        this.transactionLedgerSchemaExistsSnapshot = undefined;
        this.transactionLedgerIdempotencySchemaExistsSnapshot = undefined;
        this.transactionWalletRegistrationSchemaExistsSnapshot = undefined;
        this.transactionYieldOperationSchemaExistsSnapshot = undefined;
      } else if (normalized === 'ROLLBACK') {
        if (this.transactionAppliedSnapshot) {
          this.applied.clear();
          for (const [id, migration] of this.transactionAppliedSnapshot) {
            this.applied.set(id, migration);
          }
        }
        if (this.transactionLedgerSchemaExistsSnapshot !== undefined) {
          this.ledgerSchemaExists = this.transactionLedgerSchemaExistsSnapshot;
        }
        if (this.transactionLedgerIdempotencySchemaExistsSnapshot !== undefined) {
          this.ledgerIdempotencySchemaExists =
            this.transactionLedgerIdempotencySchemaExistsSnapshot;
        }
        if (this.transactionAuthenticationSchemaExistsSnapshot !== undefined) {
          this.authenticationSchemaExists = this.transactionAuthenticationSchemaExistsSnapshot;
        }
        if (this.transactionWalletRegistrationSchemaExistsSnapshot !== undefined) {
          this.walletRegistrationSchemaExists =
            this.transactionWalletRegistrationSchemaExistsSnapshot;
        }
        if (this.transactionYieldOperationSchemaExistsSnapshot !== undefined) {
          this.yieldOperationSchemaExists = this.transactionYieldOperationSchemaExistsSnapshot;
        }
        this.transactionAppliedSnapshot = undefined;
        this.transactionAuthenticationSchemaExistsSnapshot = undefined;
        this.transactionLedgerSchemaExistsSnapshot = undefined;
        this.transactionLedgerIdempotencySchemaExistsSnapshot = undefined;
        this.transactionWalletRegistrationSchemaExistsSnapshot = undefined;
        this.transactionYieldOperationSchemaExistsSnapshot = undefined;
      } else if (normalized.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        this.migrationTableExists = true;
      } else if (normalized.startsWith("SELECT to_regclass('schema_migrations')")) {
        return result([
          {
            table_name: this.migrationTableExists ? 'schema_migrations' : null,
          },
        ]);
      } else if (normalized.includes('CREATE TABLE job_outbox')) {
        this.jobOutboxExists = true;
      } else if (normalized.includes('DROP TABLE IF EXISTS job_outbox')) {
        this.jobOutboxExists = false;
        this.jobOutboxLastErrorConstraintExists = false;
        this.indexes.clear();
      } else if (normalized.includes('ADD CONSTRAINT job_outbox_last_error_code_check')) {
        this.jobOutboxLastErrorConstraintExists = true;
      } else if (
        normalized.includes('DROP CONSTRAINT IF EXISTS job_outbox_last_error_code_check')
      ) {
        this.jobOutboxLastErrorConstraintExists = false;
      } else if (normalized.includes('CREATE TABLE accounts (')) {
        this.accountSchemaExists = true;
      } else if (normalized.includes('DROP TABLE IF EXISTS account_profile_audit')) {
        this.accountSchemaExists = false;
      } else if (normalized.includes('CREATE TABLE ledger_books (')) {
        this.ledgerSchemaExists = true;
      } else if (normalized.includes('CREATE TABLE ledger_command_idempotency (')) {
        this.ledgerIdempotencySchemaExists = true;
      } else if (normalized.includes('CREATE TABLE authentication_oidc_identities (')) {
        this.authenticationSchemaExists = true;
      } else if (normalized.includes('CREATE TABLE wallet_ownership_challenges (')) {
        this.walletRegistrationSchemaExists = true;
      } else if (normalized.includes('CREATE TABLE yield_operations (')) {
        this.yieldOperationSchemaExists = true;
      } else if (normalized === 'DROP TABLE yield_operations') {
        this.yieldOperationSchemaExists = false;
      } else if (normalized === 'DROP TABLE wallet_ownership_challenges') {
        this.walletRegistrationSchemaExists = false;
      } else if (normalized === 'DROP TABLE authentication_oidc_identities') {
        this.authenticationSchemaExists = false;
      } else if (normalized === 'DROP TABLE ledger_command_idempotency') {
        this.ledgerIdempotencySchemaExists = false;
      } else if (normalized === 'DROP TABLE ledger_books') {
        this.ledgerSchemaExists = false;
      } else if (normalized.startsWith('DROP INDEX CONCURRENTLY IF EXISTS')) {
        const indexName = normalized.split(' ').at(-1);
        if (indexName) this.indexes.delete(indexName);
      } else if (normalized.startsWith('CREATE INDEX CONCURRENTLY')) {
        const indexName = normalized.split(' ')[3];
        if (indexName) this.indexes.set(indexName, normalized);
      } else if (normalized === "SELECT 'old-verifier' AS verifier") {
        return result([{ valid: this.oldVerifierValid }]);
      } else if (normalized === "SELECT 'new-verifier' AS verifier") {
        return result([{ valid: this.newVerifierValid }]);
      } else if (normalized === "SELECT 'third-verifier' AS verifier") {
        return result([{ valid: this.thirdVerifierValid }]);
      } else if (
        normalized.startsWith('SELECT EXISTS') &&
        normalized.includes('pg_catalog.pg_index')
      ) {
        const indexName = [...this.indexes.keys()].find((name) => normalized.includes(`'${name}'`));
        const definition = indexName ? this.indexes.get(indexName) : undefined;
        const expectedTimestamp = normalized.includes("= 'published_at'")
          ? 'published_at'
          : 'failed_at';
        const expectedStatus = expectedTimestamp === 'published_at' ? 'published' : 'failed';
        return result([
          {
            valid: Boolean(
              definition?.includes(`ON job_outbox (${expectedTimestamp}, id)`) &&
              definition.includes(`WHERE status = '${expectedStatus}'`),
            ),
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND yield_operation.valid)') &&
        normalized.includes('yield_operation_commands_scope_unique')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists &&
              this.yieldOperationSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND wallet_registration.valid)') &&
        normalized.includes('registered_wallets_one_active_identity')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists &&
              this.walletRegistrationSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND authentication.valid)') &&
        normalized.includes('authentication_function_catalog')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists &&
              this.authenticationSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (prior.valid AND outbox_link.valid)') &&
        normalized.includes('ledger_command_idempotency')
      ) {
        return result([
          {
            valid:
              this.accountSchemaExists &&
              this.jobOutboxExists &&
              this.ledgerSchemaExists &&
              this.ledgerIdempotencySchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (principal.valid AND ledger.valid)') &&
        normalized.includes('ledger_touching_constraints')
      ) {
        return result([
          {
            valid: this.accountSchemaExists && this.jobOutboxExists && this.ledgerSchemaExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (') &&
        normalized.includes('job_outbox_schema_owner_all') &&
        normalized.includes('pg_catalog.pg_auth_members')
      ) {
        // This harness tests MigrationRunner control flow, not PostgreSQL ACL
        // semantics. The dedicated Docker principal suite executes 0005's
        // verifier against a real catalog and mutates every security boundary.
        return result([{ valid: this.accountSchemaExists && this.jobOutboxExists }]);
      } else if (
        normalized.startsWith('SELECT (') &&
        normalized.includes('job_outbox_last_error_code_check') &&
        normalized.includes('pg_catalog.pg_constraint')
      ) {
        return result([
          {
            valid: this.jobOutboxExists && this.jobOutboxLastErrorConstraintExists,
          },
        ]);
      } else if (
        normalized.startsWith('SELECT (') &&
        normalized.includes("to_regclass('account_profile_audit')")
      ) {
        return result([{ valid: this.accountSchemaExists }]);
      } else if (normalized.startsWith('INSERT INTO schema_migrations')) {
        const [id, , migrationChecksum] = values;
        this.applied.set(String(id), {
          id: String(id),
          checksum: String(migrationChecksum),
        });
      } else if (normalized.startsWith('DELETE FROM schema_migrations')) {
        this.applied.delete(String(values[0]));
      } else if (normalized.startsWith('SELECT id, checksum')) {
        const descending = normalized.endsWith('DESC');
        const rows = [...this.applied.values()].sort((left, right) =>
          descending ? right.id.localeCompare(left.id) : left.id.localeCompare(right.id),
        );
        return result(rows);
      }
      return result();
    },
    release: (): void => {
      this.released = true;
    },
  } as unknown as PoolClient;

  readonly pool = {
    connect: async (): Promise<PoolClient> => this.client,
  } as unknown as Pool;
}

describe('MigrationRunner', () => {
  it('migrates a blank database and rolls the migration back', async () => {
    const database = new InMemoryMigrationDatabase();
    const runner = new MigrationRunner(database.pool, DATABASE_MIGRATION_LIST);

    await expect(runner.up()).resolves.toEqual([
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
    ]);
    expect(database.jobOutboxExists).toBe(true);
    expect(database.applied.has('0001')).toBe(true);
    expect(database.applied.has('0002')).toBe(true);
    expect(database.applied.has('0003')).toBe(true);
    expect(database.applied.has('0004')).toBe(true);
    expect(database.applied.has('0005')).toBe(true);
    expect(database.applied.has('0006')).toBe(true);
    expect(database.applied.has('0007')).toBe(true);
    expect(database.applied.has('0008')).toBe(true);
    expect(database.applied.has('0009')).toBe(true);
    expect(database.applied.has('0010')).toBe(true);
    expect(database.applied.has('0011')).toBe(true);
    expect(database.applied.has('0012')).toBe(true);
    expect(database.accountSchemaExists).toBe(true);
    expect(database.ledgerSchemaExists).toBe(true);
    expect(database.jobOutboxLastErrorConstraintExists).toBe(true);
    expect(database.ledgerIdempotencySchemaExists).toBe(true);
    expect(database.authenticationSchemaExists).toBe(true);
    expect(database.walletRegistrationSchemaExists).toBe(true);
    expect(database.yieldOperationSchemaExists).toBe(true);
    expect(database.queries.filter((query) => query === 'BEGIN')).toHaveLength(10);
    expect(
      database.queries.filter((query) => query.startsWith('CREATE INDEX CONCURRENTLY')),
    ).toHaveLength(2);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();

    await expect(runner.up()).resolves.toEqual([]);
    await expect(runner.down(12)).resolves.toEqual([
      '0012',
      '0011',
      '0010',
      '0009',
      '0008',
      '0007',
      '0006',
      '0005',
      '0004',
      '0003',
      '0002',
      '0001',
    ]);
    expect(database.jobOutboxExists).toBe(false);
    expect(database.accountSchemaExists).toBe(false);
    expect(database.ledgerSchemaExists).toBe(false);
    expect(database.ledgerIdempotencySchemaExists).toBe(false);
    expect(database.authenticationSchemaExists).toBe(false);
    expect(database.walletRegistrationSchemaExists).toBe(false);
    expect(database.yieldOperationSchemaExists).toBe(false);
    expect(database.applied.size).toBe(0);
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0001 has not been applied',
    );
    expect(database.released).toBe(true);
  });

  it('requires drift repair before rolling back a cumulative verifier', async () => {
    const database = new InMemoryMigrationDatabase();
    const runner = new MigrationRunner(database.pool, DATABASE_MIGRATION_LIST);
    await runner.up();

    database.indexes.delete('job_outbox_failed_retention_idx');
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0003 schema verification failed',
    );
    await expect(runner.status()).rejects.toThrow(
      'Database migration 0003 schema verification failed',
    );
    await expect(runner.up()).rejects.toThrow('Database migration 0003 schema verification failed');

    await expect(runner.down(10)).rejects.toThrow(
      'Database migration 0003 schema verification failed',
    );
    expect(database.ledgerSchemaExists).toBe(true);
    database.indexes.set(
      'job_outbox_failed_retention_idx',
      "CREATE INDEX CONCURRENTLY job_outbox_failed_retention_idx ON job_outbox (failed_at, id) WHERE status = 'failed'",
    );
    await expect(runner.down(10)).resolves.toEqual([
      '0012',
      '0011',
      '0010',
      '0009',
      '0008',
      '0007',
      '0006',
      '0005',
      '0004',
      '0003',
    ]);
    await expect(runner.up()).resolves.toEqual([
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
    ]);
    expect(database.indexes.has('job_outbox_failed_retention_idx')).toBe(true);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });

  it('rejects a valid same-name retention index with the wrong definition', async () => {
    const database = new InMemoryMigrationDatabase();
    const runner = new MigrationRunner(database.pool, DATABASE_MIGRATION_LIST);
    await runner.up();

    database.indexes.set(
      'job_outbox_published_retention_idx',
      "CREATE INDEX CONCURRENTLY job_outbox_published_retention_idx ON job_outbox (id) WHERE status = 'published'",
    );

    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0002 schema verification failed',
    );
  });

  it('includes non-transactional execution policy in the immutable checksum', async () => {
    const database = new InMemoryMigrationDatabase();
    await new MigrationRunner(database.pool, DATABASE_MIGRATION_LIST).up();
    const mutated = DATABASE_MIGRATION_LIST.map((migration) =>
      migration.id === '0003' ? { ...migration, transactional: true } : migration,
    );

    await expect(new MigrationRunner(database.pool, mutated).up()).rejects.toThrow(
      'Applied migration 0003 has changed',
    );
  });

  it('uses an applied checksum-valid cumulative verifier instead of its superseded verifier', async () => {
    const database = new InMemoryMigrationDatabase();
    const migrations = [
      {
        id: '1000',
        description: 'old exact allowlist',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1001',
        description: 'cumulative exact allowlist',
        upSql: 'SELECT 1001',
        downSql: 'SELECT -1001',
        verifySql: "SELECT 'new-verifier' AS verifier",
        supersedesVerificationOf: ['1000'],
      },
    ] as const;
    const runner = new MigrationRunner(database.pool, migrations);

    const freshInvalidDatabase = new InMemoryMigrationDatabase();
    freshInvalidDatabase.oldVerifierValid = false;
    await expect(new MigrationRunner(freshInvalidDatabase.pool, migrations).up()).rejects.toThrow(
      'Database migration 1000 schema verification failed',
    );
    expect(freshInvalidDatabase.applied.has('1001')).toBe(false);

    await expect(runner.up()).resolves.toEqual(['1000', '1001']);
    database.oldVerifierValid = false;
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    await expect(runner.status()).resolves.toEqual([
      { id: '1000', description: 'old exact allowlist', applied: true },
      { id: '1001', description: 'cumulative exact allowlist', applied: true },
    ]);

    database.newVerifierValid = false;
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 1001 schema verification failed',
    );

    database.newVerifierValid = true;
    await expect(runner.down(1)).rejects.toThrow(
      'Database migration 1000 schema verification failed',
    );
    expect(database.applied.has('1001')).toBe(true);
    database.oldVerifierValid = true;
    await expect(runner.down(1)).resolves.toEqual(['1001']);
    expect(database.applied.has('1001')).toBe(false);
  });

  it('checks supersession metadata in the immutable checksum', async () => {
    const database = new InMemoryMigrationDatabase();
    const migrations = [
      {
        id: '1000',
        description: 'first verifier',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1001',
        description: 'second verifier',
        upSql: 'SELECT 1001',
        downSql: 'SELECT -1001',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1002',
        description: 'cumulative verifier',
        upSql: 'SELECT 1002',
        downSql: 'SELECT -1002',
        verifySql: "SELECT 'new-verifier' AS verifier",
        supersedesVerificationOf: ['1000'],
      },
    ] as const;
    await new MigrationRunner(database.pool, migrations).up();
    const mutated = migrations.map((migration) =>
      migration.id === '1002'
        ? { ...migration, supersedesVerificationOf: ['1001'] as const }
        : migration,
    );

    await expect(new MigrationRunner(database.pool, mutated).up()).rejects.toThrow(
      'Applied migration 1002 has changed',
    );
    database.oldVerifierValid = false;
    await expect(new MigrationRunner(database.pool, mutated).up()).rejects.toThrow(
      'Database migration 1000 schema verification failed',
    );
  });

  it('rejects invalid or ambiguous verifier supersession declarations', () => {
    const database = new InMemoryMigrationDatabase();
    const base = {
      description: 'synthetic verifier',
      upSql: 'SELECT 1',
      downSql: 'SELECT -1',
      verifySql: "SELECT 'old-verifier' AS verifier",
    };

    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          { id: '1001', ...base, supersedesVerificationOf: ['1002'] },
          { id: '1002', ...base },
        ]),
    ).toThrow('can only supersede an earlier configured verifier');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          { id: '1001', ...base, supersedesVerificationOf: [] },
        ]),
    ).toThrow('must have verification SQL to supersede a verifier');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          { id: '1001', ...base, supersedesVerificationOf: ['1000'] },
          { id: '1002', ...base, supersedesVerificationOf: ['1000'] },
        ]),
    ).toThrow('is superseded more than once');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', description: 'no verifier', upSql: 'SELECT 1', downSql: 'SELECT -1' },
          { id: '1001', ...base, supersedesVerificationOf: ['1000'] },
        ]),
    ).toThrow('without verification SQL');
    expect(
      () =>
        new MigrationRunner(database.pool, [
          { id: '1000', ...base },
          {
            id: '1001',
            ...base,
            transactional: false,
            supersedesVerificationOf: ['1000'],
          },
        ]),
    ).toThrow('must be transactional to supersede a verifier');
  });

  it('removes rolled-back superseders from multi-step verifier selection', async () => {
    const database = new InMemoryMigrationDatabase();
    const migrations = [
      {
        id: '1000',
        description: 'base verifier',
        upSql: 'SELECT 1000',
        downSql: 'SELECT -1000',
        verifySql: "SELECT 'old-verifier' AS verifier",
      },
      {
        id: '1001',
        description: 'middle cumulative verifier',
        upSql: 'SELECT 1001',
        downSql: 'SELECT -1001',
        verifySql: "SELECT 'new-verifier' AS verifier",
        supersedesVerificationOf: ['1000'],
      },
      {
        id: '1002',
        description: 'latest cumulative verifier',
        upSql: 'SELECT 1002',
        downSql: 'SELECT -1002',
        verifySql: "SELECT 'third-verifier' AS verifier",
        supersedesVerificationOf: ['1001'],
      },
    ] as const;
    const runner = new MigrationRunner(database.pool, migrations);
    await expect(runner.up()).resolves.toEqual(['1000', '1001', '1002']);

    await expect(runner.down(2)).resolves.toEqual(['1002', '1001']);
    expect(database.applied.has('1002')).toBe(false);
    expect(database.applied.has('1001')).toBe(false);
    expect(database.applied.has('1000')).toBe(true);
    expect(
      database.queries.filter((query) => query === "SELECT 'third-verifier' AS verifier"),
    ).toHaveLength(1);
    expect(
      database.queries.filter((query) => query === "SELECT 'new-verifier' AS verifier"),
    ).toHaveLength(2);
    expect(
      database.queries.filter((query) => query === "SELECT 'old-verifier' AS verifier"),
    ).toHaveLength(2);
  });
});
