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
  readonly queries: string[] = [];
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

    await expect(runner.up()).resolves.toEqual(['0001']);
    expect(database.jobOutboxExists).toBe(true);
    expect(database.applied.has('0001')).toBe(true);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();

    await expect(runner.up()).resolves.toEqual([]);
    await expect(runner.down()).resolves.toEqual(['0001']);
    expect(database.jobOutboxExists).toBe(false);
    expect(database.applied.size).toBe(0);
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0001 has not been applied',
    );
    expect(database.released).toBe(true);
  });
});
