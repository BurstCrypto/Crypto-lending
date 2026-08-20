import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('PostgreSQL migration rollback integration', () => {
  const schema = `kan33_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let migrationPool: Pool;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    migrationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      options: `-c search_path=${schema}`,
    });
  });

  afterAll(async () => {
    if (migrationPool) {
      await migrationPool.end();
    }
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  it('applies up on a blank schema and removes its objects on down', async () => {
    const runner = new MigrationRunner(migrationPool, DATABASE_MIGRATION_LIST);

    await expect(runner.up()).resolves.toEqual(['0001', '0002', '0003', '0004']);
    const afterUp = await migrationPool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'job_outbox'`,
      [schema],
    );
    expect(afterUp.rows).toEqual([{ table_name: 'job_outbox' }]);
    const retentionIndexes = await migrationPool.query<{
      index_name: string;
      is_valid: boolean;
    }>(
      `SELECT index_class.relname AS index_name, index_state.indisvalid AS is_valid
       FROM pg_catalog.pg_index AS index_state
       INNER JOIN pg_catalog.pg_class AS index_class
         ON index_class.oid = index_state.indexrelid
       INNER JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = index_class.relnamespace
       WHERE namespace.nspname = $1
         AND index_class.relname = ANY($2::text[])
       ORDER BY index_class.relname`,
      [schema, ['job_outbox_failed_retention_idx', 'job_outbox_published_retention_idx']],
    );
    expect(retentionIndexes.rows).toEqual([
      { index_name: 'job_outbox_failed_retention_idx', is_valid: true },
      { index_name: 'job_outbox_published_retention_idx', is_valid: true },
    ]);

    const accountTables = await migrationPool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = ANY($2::text[])
       ORDER BY table_name`,
      [schema, ['accounts', 'account_profiles', 'account_profile_audit']],
    );
    expect(accountTables.rows).toEqual([
      { table_name: 'account_profile_audit' },
      { table_name: 'account_profiles' },
      { table_name: 'accounts' },
    ]);

    await expect(runner.down(4)).resolves.toEqual(['0004', '0003', '0002', '0001']);
    const afterDown = await migrationPool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'job_outbox'`,
      [schema],
    );
    expect(afterDown.rows).toEqual([]);

    const accountObjectsAfterDown = await migrationPool.query<{
      object_kind: string;
      object_name: string;
    }>(
      `SELECT 'table' AS object_kind, table_name AS object_name
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = ANY($2::text[])
       UNION ALL
       SELECT 'function' AS object_kind, routine_name AS object_name
       FROM information_schema.routines
       WHERE routine_schema = $1
         AND routine_name = ANY($3::text[])
       ORDER BY object_kind, object_name`,
      [
        schema,
        ['accounts', 'account_profiles', 'account_profile_audit'],
        [
          'enforce_account_immutability',
          'enforce_account_profile_update',
          'provision_account_profile',
          'reject_account_profile_audit_mutation',
          'update_account_profile',
        ],
      ],
    );
    expect(accountObjectsAfterDown.rows).toEqual([]);

    const migrationRecordAfterDown = await migrationPool.query<{ id: string }>(
      'SELECT id FROM schema_migrations WHERE id = $1',
      ['0004'],
    );
    expect(migrationRecordAfterDown.rows).toEqual([]);

    await expect(runner.up()).resolves.toEqual(['0001', '0002', '0003', '0004']);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });
});
