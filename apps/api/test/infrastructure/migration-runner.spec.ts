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
  jobOutboxExists = false;
  migrationTableExists = false;
  released = false;

  readonly client = {
    query: async (text: string, values: readonly unknown[] = []): Promise<QueryResult> => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      this.queries.push(normalized);

      if (normalized.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
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
        this.indexes.clear();
      } else if (normalized.includes('CREATE TABLE accounts (')) {
        this.accountSchemaExists = true;
      } else if (normalized.includes('DROP TABLE IF EXISTS account_profile_audit')) {
        this.accountSchemaExists = false;
      } else if (normalized.startsWith('DROP INDEX CONCURRENTLY IF EXISTS')) {
        const indexName = normalized.split(' ').at(-1);
        if (indexName) this.indexes.delete(indexName);
      } else if (normalized.startsWith('CREATE INDEX CONCURRENTLY')) {
        const indexName = normalized.split(' ')[3];
        if (indexName) this.indexes.set(indexName, normalized);
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

    await expect(runner.up()).resolves.toEqual(['0001', '0002', '0003', '0004', '0005']);
    expect(database.jobOutboxExists).toBe(true);
    expect(database.applied.has('0001')).toBe(true);
    expect(database.applied.has('0002')).toBe(true);
    expect(database.applied.has('0003')).toBe(true);
    expect(database.applied.has('0004')).toBe(true);
    expect(database.applied.has('0005')).toBe(true);
    expect(database.accountSchemaExists).toBe(true);
    expect(database.queries.filter((query) => query === 'BEGIN')).toHaveLength(3);
    expect(
      database.queries.filter((query) => query.startsWith('CREATE INDEX CONCURRENTLY')),
    ).toHaveLength(2);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();

    await expect(runner.up()).resolves.toEqual([]);
    await expect(runner.down(5)).resolves.toEqual(['0005', '0004', '0003', '0002', '0001']);
    expect(database.jobOutboxExists).toBe(false);
    expect(database.accountSchemaExists).toBe(false);
    expect(database.applied.size).toBe(0);
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0001 has not been applied',
    );
    expect(database.released).toBe(true);
  });

  it('detects missing non-transactional schema state and supports an explicit repair path', async () => {
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

    await expect(runner.down(3)).resolves.toEqual(['0005', '0004', '0003']);
    await expect(runner.up()).resolves.toEqual(['0003', '0004', '0005']);
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
});
