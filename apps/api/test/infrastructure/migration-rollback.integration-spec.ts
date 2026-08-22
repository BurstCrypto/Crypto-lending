import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('PostgreSQL migration rollback integration', () => {
  jest.setTimeout(15_000);

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
    const schemaBeforeLastErrorConstraint = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
      ({ id }) => id < '0006',
    );
    const preConstraintRunner = new MigrationRunner(migrationPool, schemaBeforeLastErrorConstraint);
    const runner = new MigrationRunner(migrationPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);

    await expect(preConstraintRunner.up()).resolves.toEqual(['0001', '0002', '0003', '0004']);
    await migrationPool.query(
      `INSERT INTO job_outbox (id, queue_name, payload, message_attributes, last_error)
       VALUES
         ('historical-raw', 'jobs', '{}'::jsonb, '{}'::jsonb, 'provider rejected bearer test-secret'),
         ('historical-allowed', 'jobs', '{}'::jsonb, '{}'::jsonb, 'OUTBOX_TRANSPORT_TIMEOUT'),
         ('historical-null', 'jobs', '{}'::jsonb, '{}'::jsonb, NULL)`,
    );

    await expect(runner.up()).resolves.toEqual(['0006', '0007', '0008', '0009', '0010']);
    const sanitizedLastErrors = await migrationPool.query<{
      id: string;
      last_error: string | null;
    }>(
      `SELECT id, last_error
       FROM job_outbox
       WHERE id LIKE 'historical-%'
       ORDER BY id`,
    );
    expect(sanitizedLastErrors.rows).toEqual([
      { id: 'historical-allowed', last_error: 'OUTBOX_TRANSPORT_TIMEOUT' },
      { id: 'historical-null', last_error: null },
      { id: 'historical-raw', last_error: 'OUTBOX_TRANSPORT_FAILED' },
    ]);
    await expect(
      migrationPool.query(
        `UPDATE job_outbox
         SET last_error = 'credential-shaped-provider-detail'
         WHERE id = 'historical-raw'`,
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'job_outbox_last_error_code_check',
    });
    await expect(
      migrationPool.query(
        `UPDATE job_outbox
         SET last_error = 'OUTBOX_TRANSPORT_TIMEOUT'
         WHERE id = 'historical-raw'`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

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

    await migrationPool.query(
      'ALTER TABLE job_outbox DROP CONSTRAINT job_outbox_last_error_code_check',
    );
    await expect(runner.assertUpToDate()).rejects.toThrow(
      'Database migration 0006 schema verification failed',
    );
    await migrationPool.query(
      `ALTER TABLE job_outbox
       ADD CONSTRAINT job_outbox_last_error_code_check
       CHECK (
         last_error IS NULL
         OR last_error IN ('OUTBOX_TRANSPORT_FAILED', 'OUTBOX_TRANSPORT_TIMEOUT')
       )`,
    );
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    await expect(runner.down(5)).resolves.toEqual(['0010', '0009', '0008', '0007', '0006']);
    await migrationPool.query(
      `UPDATE job_outbox
       SET last_error = 'legacy worker detail after rollback'
       WHERE id = 'historical-raw'`,
    );
    await expect(runner.up()).resolves.toEqual(['0006', '0007', '0008', '0009', '0010']);
    await expect(
      migrationPool.query<{ last_error: string }>(
        `SELECT last_error FROM job_outbox WHERE id = 'historical-raw'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ last_error: 'OUTBOX_TRANSPORT_FAILED' }],
    });

    await expect(runner.down(9)).resolves.toEqual([
      '0010',
      '0009',
      '0008',
      '0007',
      '0006',
      '0004',
      '0003',
      '0002',
      '0001',
    ]);
    const afterDown = await migrationPool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'job_outbox'`,
      [schema],
    );
    expect(afterDown.rows).toEqual([]);

    const ledgerObjectsAfterDown = await migrationPool.query<{
      object_kind: string;
      object_name: string;
    }>(
      `SELECT 'relation' AS object_kind, relation.relname AS object_name
       FROM pg_catalog.pg_class AS relation
       WHERE relation.relnamespace = pg_catalog.to_regnamespace($1)
         AND pg_catalog.left(relation.relname, 7) = 'ledger_'
       UNION ALL
       SELECT 'function' AS object_kind, procedure.proname AS object_name
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.pronamespace = pg_catalog.to_regnamespace($1)
         AND pg_catalog.strpos(procedure.proname, 'ledger') > 0
       ORDER BY object_kind, object_name`,
      [schema],
    );
    expect(ledgerObjectsAfterDown.rows).toEqual([]);

    const authenticationObjectsAfterDown = await migrationPool.query<{
      object_kind: string;
      object_name: string;
    }>(
      `SELECT 'relation' AS object_kind, relation.relname AS object_name
       FROM pg_catalog.pg_class AS relation
       WHERE relation.relnamespace = pg_catalog.to_regnamespace($1)
         AND relation.relname LIKE 'authentication\\_%' ESCAPE '\\'
       UNION ALL
       SELECT 'function' AS object_kind, procedure.proname AS object_name
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.pronamespace = pg_catalog.to_regnamespace($1)
         AND pg_catalog.strpos(procedure.proname, 'authentication') > 0
       ORDER BY object_kind, object_name`,
      [schema],
    );
    expect(authenticationObjectsAfterDown.rows).toEqual([]);

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

    const migrationRecordsAfterDown = await migrationPool.query<{ id: string }>(
      'SELECT id FROM schema_migrations WHERE id = ANY($1::text[]) ORDER BY id',
      [['0004', '0006', '0007', '0008', '0009', '0010']],
    );
    expect(migrationRecordsAfterDown.rows).toEqual([]);

    await expect(runner.up()).resolves.toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
    ]);
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });
});
