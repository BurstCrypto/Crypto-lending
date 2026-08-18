import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';

import type { DatabaseMigration } from './migrations';
import { DATABASE_MIGRATIONS, POSTGRES_POOL } from './postgres.tokens';

const MIGRATION_LOCK_KEY = 1_923_307_433;

export interface MigrationStatus {
  id: string;
  description: string;
  applied: boolean;
}

interface AppliedMigration {
  id: string;
  checksum: string;
}

interface MigrationTableLookup {
  table_name: string | null;
}

function checksum(migration: DatabaseMigration): string {
  return createHash('sha256')
    .update(migration.id)
    .update('\0')
    .update(migration.upSql)
    .update('\0')
    .update(migration.downSql)
    .digest('hex');
}

@Injectable()
export class MigrationRunner {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(DATABASE_MIGRATIONS)
    private readonly migrations: readonly DatabaseMigration[],
  ) {
    const identifiers = new Set<string>();
    for (const migration of migrations) {
      if (identifiers.has(migration.id)) {
        throw new Error(`Duplicate database migration id: ${migration.id}`);
      }
      identifiers.add(migration.id);
    }
  }

  async up(): Promise<string[]> {
    return this.withMigrationLock(async (client) => {
      await this.ensureMigrationTable(client);
      const applied = await this.appliedMigrations(client);
      const appliedById = new Map(applied.map((migration) => [migration.id, migration]));
      const completed: string[] = [];

      for (const migration of this.migrations) {
        const existing = appliedById.get(migration.id);
        const expectedChecksum = checksum(migration);
        if (existing) {
          if (existing.checksum !== expectedChecksum) {
            throw new Error(
              `Applied migration ${migration.id} has changed; create a new migration instead`,
            );
          }
          continue;
        }

        await this.inTransaction(client, async () => {
          await client.query(migration.upSql);
          await client.query(
            `INSERT INTO schema_migrations (id, description, checksum)
             VALUES ($1, $2, $3)`,
            [migration.id, migration.description, expectedChecksum],
          );
        });
        completed.push(migration.id);
      }
      return completed;
    });
  }

  async down(steps = 1): Promise<string[]> {
    if (!Number.isInteger(steps) || steps < 1) {
      throw new Error('Migration rollback steps must be a positive integer');
    }

    return this.withMigrationLock(async (client) => {
      await this.ensureMigrationTable(client);
      const applied = await this.appliedMigrations(client, true);
      const byId = new Map(this.migrations.map((migration) => [migration.id, migration]));
      const rolledBack: string[] = [];

      for (const row of applied.slice(0, steps)) {
        const migration = byId.get(row.id);
        if (!migration) {
          throw new Error(`Cannot roll back unknown migration ${row.id}`);
        }
        if (row.checksum !== checksum(migration)) {
          throw new Error(`Cannot roll back modified migration ${row.id}`);
        }

        await this.inTransaction(client, async () => {
          await client.query(migration.downSql);
          await client.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
        });
        rolledBack.push(migration.id);
      }
      return rolledBack;
    });
  }

  async status(): Promise<MigrationStatus[]> {
    return this.withMigrationLock(async (client) => {
      await this.ensureMigrationTable(client);
      const applied = new Set(
        (await this.appliedMigrations(client)).map((migration) => migration.id),
      );
      return this.migrations.map((migration) => ({
        id: migration.id,
        description: migration.description,
        applied: applied.has(migration.id),
      }));
    });
  }

  /** Read-only readiness check; migrations remain an explicit deployment step. */
  async assertUpToDate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const table = await client.query<MigrationTableLookup>(
        "SELECT to_regclass('schema_migrations')::text AS table_name",
      );
      if (!table.rows[0]?.table_name) {
        throw new Error('Database migrations have not been initialized');
      }

      const appliedById = new Map(
        (await this.appliedMigrations(client)).map((migration) => [
          migration.id,
          migration.checksum,
        ]),
      );
      for (const migration of this.migrations) {
        const appliedChecksum = appliedById.get(migration.id);
        if (!appliedChecksum) {
          throw new Error(`Database migration ${migration.id} has not been applied`);
        }
        if (appliedChecksum !== checksum(migration)) {
          throw new Error(`Database migration ${migration.id} checksum does not match`);
        }
      }
    } finally {
      client.release();
    }
  }

  private async withMigrationLock<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      return await work(client);
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      } finally {
        client.release();
      }
    }
  }

  private async ensureMigrationTable(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        description text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private async appliedMigrations(
    client: PoolClient,
    descending = false,
  ): Promise<AppliedMigration[]> {
    const direction = descending ? 'DESC' : 'ASC';
    const result = await client.query<AppliedMigration>(
      `SELECT id, checksum FROM schema_migrations ORDER BY id ${direction}`,
    );
    return result.rows;
  }

  private async inTransaction(client: PoolClient, work: () => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await work();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}
