import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient, QueryConfig, QueryResult, QueryResultRow } from 'pg';

import type { DatabaseMigration } from './migrations';
import { PostgresService } from './postgres.service';
import { DATABASE_MIGRATIONS, POSTGRES_POOL } from './postgres.tokens';

const MIGRATION_LOCK_KEY = 1_923_307_433;
const MIGRATION_LOCK_RETRY_MILLISECONDS = 25;
const MIGRATION_LOCK_ACQUISITION_TIMEOUT_MILLISECONDS = 30_000;

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

interface MigrationVerification {
  valid: boolean;
}

interface AdvisoryLockAttempt {
  acquired: boolean;
}

interface AdvisoryLockRelease {
  released: boolean;
}

interface MigrationQueryExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | QueryConfig,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

const CANCELLABLE_MIGRATION_READINESS_UNAVAILABLE =
  'Cancellable database migration readiness is unavailable';

function checksum(migration: DatabaseMigration): string {
  const checksumSql = (sql: string | readonly string[]): string =>
    typeof sql === 'string' ? sql : sql.join('\0statement\0');
  const hash = createHash('sha256')
    .update(migration.id)
    .update('\0')
    .update(checksumSql(migration.upSql))
    .update('\0')
    .update(checksumSql(migration.downSql));
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

function snapshotMigration(migration: DatabaseMigration): DatabaseMigration {
  const snapshotSql = (sql: string | readonly string[]): string | readonly string[] =>
    typeof sql === 'string' ? sql : Object.freeze([...sql]);
  return Object.freeze({
    id: migration.id,
    description: migration.description,
    upSql: snapshotSql(migration.upSql),
    downSql: snapshotSql(migration.downSql),
    ...(migration.verifySql === undefined ? {} : { verifySql: migration.verifySql }),
    ...(migration.supersedesVerificationOf === undefined
      ? {}
      : { supersedesVerificationOf: Object.freeze([...migration.supersedesVerificationOf]) }),
    ...(migration.transactional === undefined ? {} : { transactional: migration.transactional }),
  });
}

@Injectable()
export class MigrationRunner {
  private readonly migrations: readonly DatabaseMigration[];
  private readonly expectedChecksums: ReadonlyMap<string, string>;

  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(DATABASE_MIGRATIONS) migrations: readonly DatabaseMigration[],
    @Optional() private readonly postgres?: PostgresService,
  ) {
    this.migrations = Object.freeze(migrations.map(snapshotMigration));
    const identifiers = new Set<string>();
    for (const migration of this.migrations) {
      if (identifiers.has(migration.id)) {
        throw new Error(`Duplicate database migration id: ${migration.id}`);
      }
      if (migration.transactional === false && !migration.verifySql?.trim()) {
        throw new Error(
          `Non-transactional database migration ${migration.id} requires verification SQL`,
        );
      }
      identifiers.add(migration.id);
    }

    const migrationIndexById = new Map(
      this.migrations.map((migration, migrationIndex) => [migration.id, migrationIndex]),
    );
    const supersededIdentifiers = new Set<string>();
    for (const [migrationIndex, migration] of this.migrations.entries()) {
      const superseded = migration.supersedesVerificationOf;
      if (superseded === undefined) continue;
      if (migration.transactional === false) {
        throw new Error(
          `Database migration ${migration.id} must be transactional to supersede a verifier`,
        );
      }
      if (superseded.length === 0 || !migration.verifySql?.trim()) {
        throw new Error(
          `Database migration ${migration.id} must have verification SQL to supersede a verifier`,
        );
      }
      for (const supersededId of superseded) {
        const supersededIndex = migrationIndexById.get(supersededId);
        if (supersededIndex === undefined || supersededIndex >= migrationIndex) {
          throw new Error(
            `Database migration ${migration.id} can only supersede an earlier configured verifier`,
          );
        }
        if (!this.migrations[supersededIndex]?.verifySql?.trim()) {
          throw new Error(
            `Database migration ${migration.id} cannot supersede migration ${supersededId} without verification SQL`,
          );
        }
        if (supersededIdentifiers.has(supersededId)) {
          throw new Error(
            `Database migration verifier ${supersededId} is superseded more than once`,
          );
        }
        supersededIdentifiers.add(supersededId);
      }
    }

    // Migration SQL and its verifier grow with every cumulative boundary. Keep
    // readiness deterministic without repeatedly hashing the same immutable
    // application artifact on every load-balancer probe.
    this.expectedChecksums = new Map(
      this.migrations.map((migration) => [migration.id, checksum(migration)]),
    );
  }

  async up(): Promise<string[]> {
    return this.withMigrationLock(async (client) => {
      await this.ensureMigrationTable(client);
      const applied = await this.appliedMigrations(client);
      const appliedById = new Map(applied.map((migration) => [migration.id, migration]));
      const supersededVerificationIds = this.supersededVerificationIds(appliedById);
      const completed: string[] = [];

      for (const migration of this.migrations) {
        const existing = appliedById.get(migration.id);
        const expectedChecksum = this.expectedChecksum(migration.id);
        if (existing) {
          if (existing.checksum !== expectedChecksum) {
            throw new Error(
              `Applied migration ${migration.id} has changed; create a new migration instead`,
            );
          }
          if (!supersededVerificationIds.has(migration.id)) {
            await this.assertMigrationVerified(client, migration);
          }
          continue;
        }

        await this.runMigration(client, migration, async () => {
          await this.executeSql(client, migration.upSql);
          await this.assertMigrationVerified(client, migration);
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
      const remainingApplied = new Map(
        applied.map((appliedMigration) => [appliedMigration.id, appliedMigration]),
      );
      const byId = new Map(this.migrations.map((migration) => [migration.id, migration]));
      const rolledBack: string[] = [];

      for (const row of applied.slice(0, steps)) {
        const migration = byId.get(row.id);
        if (!migration) {
          throw new Error(`Cannot roll back unknown migration ${row.id}`);
        }
        if (row.checksum !== this.expectedChecksum(migration.id)) {
          throw new Error(`Cannot roll back modified migration ${row.id}`);
        }

        await this.runMigration(client, migration, async () => {
          await this.executeSql(client, migration.downSql);
          await client.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
          if (migration.supersedesVerificationOf !== undefined) {
            const appliedAfterRollback = new Map(remainingApplied);
            appliedAfterRollback.delete(migration.id);
            const stillSuperseded = this.supersededVerificationIds(appliedAfterRollback);
            for (const remainingMigration of this.migrations) {
              if (
                appliedAfterRollback.has(remainingMigration.id) &&
                !stillSuperseded.has(remainingMigration.id)
              ) {
                await this.assertMigrationVerified(client, remainingMigration);
              }
            }
          }
        });
        remainingApplied.delete(migration.id);
        rolledBack.push(migration.id);
      }
      return rolledBack;
    });
  }

  async status(): Promise<MigrationStatus[]> {
    return this.withMigrationLock(async (client) => {
      await this.ensureMigrationTable(client);
      const applied = new Map(
        (await this.appliedMigrations(client)).map((migration) => [
          migration.id,
          migration.checksum,
        ]),
      );
      for (const migration of this.migrations) {
        const appliedChecksum = applied.get(migration.id);
        if (appliedChecksum && appliedChecksum !== this.expectedChecksum(migration.id)) {
          throw new Error(`Database migration ${migration.id} checksum does not match`);
        }
      }
      const supersededVerificationIds = this.supersededVerificationIds(applied);
      for (const migration of this.migrations) {
        if (applied.has(migration.id) && !supersededVerificationIds.has(migration.id)) {
          await this.assertMigrationVerified(client, migration);
        }
      }
      return this.migrations.map((migration) => ({
        id: migration.id,
        description: migration.description,
        applied: applied.has(migration.id),
      }));
    });
  }

  /** Read-only readiness check; migrations remain an explicit deployment step. */
  async assertUpToDate(signal?: AbortSignal): Promise<void> {
    if (signal !== undefined) {
      const postgres = this.postgres;
      if (postgres === undefined) {
        throw new Error(CANCELLABLE_MIGRATION_READINESS_UNAVAILABLE);
      }
      const executor: MigrationQueryExecutor = {
        query: <Row extends QueryResultRow = QueryResultRow>(
          queryTextOrConfig: string | QueryConfig,
          values?: unknown[],
        ): Promise<QueryResult<Row>> =>
          postgres.queryWithCancellation<Row>(queryTextOrConfig, values, signal),
      };
      await this.assertUpToDateWithExecutor(executor);
      return;
    }

    const client = await this.pool.connect();
    try {
      await this.assertUpToDateWithExecutor(client);
    } finally {
      client.release();
    }
  }

  private async assertUpToDateWithExecutor(executor: MigrationQueryExecutor): Promise<void> {
    const table = await executor.query<MigrationTableLookup>(
      "SELECT to_regclass('schema_migrations')::text AS table_name",
    );
    if (!table.rows[0]?.table_name) {
      throw new Error('Database migrations have not been initialized');
    }

    const appliedById = new Map(
      (await this.appliedMigrations(executor)).map((migration) => [
        migration.id,
        migration.checksum,
      ]),
    );
    for (const migration of this.migrations) {
      const appliedChecksum = appliedById.get(migration.id);
      if (!appliedChecksum) {
        throw new Error(`Database migration ${migration.id} has not been applied`);
      }
      if (appliedChecksum !== this.expectedChecksum(migration.id)) {
        throw new Error(`Database migration ${migration.id} checksum does not match`);
      }
    }
    const supersededVerificationIds = this.supersededVerificationIds(appliedById);
    for (const migration of this.migrations) {
      if (!supersededVerificationIds.has(migration.id)) {
        await this.assertMigrationVerified(executor, migration);
      }
    }
  }

  private async withMigrationLock<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let acquired = false;
    let failed = false;
    let workError: unknown;
    let workResult: T | undefined;
    try {
      await this.acquireMigrationLock(client);
      acquired = true;
      workResult = await work(client);
    } catch (error) {
      failed = true;
      workError = error;
    }

    let releaseError: Error | undefined;
    if (acquired) {
      try {
        const released = await client.query<AdvisoryLockRelease>(
          'SELECT pg_advisory_unlock($1) AS released',
          [MIGRATION_LOCK_KEY],
        );
        if (released.rows.length !== 1 || released.rows[0]?.released !== true) {
          releaseError = new Error('Database migration lock release failed');
        }
      } catch {
        releaseError = new Error('Database migration lock release failed');
      }
    }
    try {
      if (releaseError) client.release(releaseError);
      else client.release();
    } catch {
      releaseError = new Error('Database migration lock release failed');
    }

    if (failed) throw workError;
    if (releaseError) throw releaseError;
    return workResult as T;
  }

  private async acquireMigrationLock(client: PoolClient): Promise<void> {
    // A blocking pg_advisory_lock() call keeps its implicit transaction open.
    // That can deadlock with CREATE INDEX CONCURRENTLY in the lock holder,
    // because the index build must wait for transactions that started before
    // its final validation phase. Failed try-lock probes finish immediately and
    // preserve the same global, session-level exclusion without that cycle.
    const deadline = Date.now() + MIGRATION_LOCK_ACQUISITION_TIMEOUT_MILLISECONDS;
    for (;;) {
      let attempt: QueryResult<AdvisoryLockAttempt>;
      try {
        attempt = await client.query<AdvisoryLockAttempt>(
          'SELECT pg_try_advisory_lock($1) AS acquired',
          [MIGRATION_LOCK_KEY],
        );
      } catch {
        throw new Error('Database migration lock acquisition failed');
      }
      if (attempt.rows.length !== 1 || typeof attempt.rows[0]?.acquired !== 'boolean') {
        throw new Error('Database migration lock acquisition failed');
      }
      if (attempt.rows[0].acquired) return;
      const remainingMilliseconds = deadline - Date.now();
      if (remainingMilliseconds <= 0) {
        throw new Error('Database migration lock acquisition timed out');
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(MIGRATION_LOCK_RETRY_MILLISECONDS, remainingMilliseconds)),
      );
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
    client: MigrationQueryExecutor,
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

  private async runMigration(
    client: PoolClient,
    migration: DatabaseMigration,
    work: () => Promise<void>,
  ): Promise<void> {
    if (migration.transactional === false) {
      await work();
      return;
    }
    await this.inTransaction(client, work);
  }

  private async executeSql(client: PoolClient, sql: string | readonly string[]): Promise<void> {
    const statements = typeof sql === 'string' ? [sql] : sql;
    for (const statement of statements) {
      await client.query(statement);
    }
  }

  private async assertMigrationVerified(
    client: MigrationQueryExecutor,
    migration: DatabaseMigration,
  ): Promise<void> {
    if (!migration.verifySql) {
      return;
    }
    const result = await client.query<MigrationVerification>(migration.verifySql);
    if (result.rows.length !== 1 || result.rows[0]?.valid !== true) {
      throw new Error(`Database migration ${migration.id} schema verification failed`);
    }
  }

  private supersededVerificationIds(
    appliedById: ReadonlyMap<string, AppliedMigration | string>,
  ): ReadonlySet<string> {
    const superseded = new Set<string>();
    for (const migration of this.migrations) {
      const applied = appliedById.get(migration.id);
      const appliedChecksum = typeof applied === 'string' ? applied : applied?.checksum;
      if (appliedChecksum !== this.expectedChecksum(migration.id)) continue;
      for (const supersededId of migration.supersedesVerificationOf ?? []) {
        superseded.add(supersededId);
      }
    }
    return superseded;
  }

  private expectedChecksum(migrationId: string): string {
    const expected = this.expectedChecksums.get(migrationId);
    if (!expected) {
      throw new Error(`Database migration ${migrationId} has no configured checksum`);
    }
    return expected;
  }
}
