import { randomBytes, randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { bootstrapRailwayDatabase } from '../../src/infrastructure/database/railway-database-bootstrap';
import { RAILWAY_DATABASE_MIGRATION_LIST } from '../../src/infrastructure/database/railway-migrations';
import { postgresStartupOptions } from '../../src/infrastructure/database/postgres-startup-options';

const adminUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1' && adminUrl;
const describeWithPostgres = enabled ? describe : describe.skip;

function databaseUrl(base: string, database: string, username?: string, password?: string): string {
  const value = new URL(base);
  value.pathname = `/${database}`;
  if (username) value.username = username;
  if (password) value.password = password;
  return value.toString();
}

describeWithPostgres('Railway database principal boundaries', () => {
  const database = `railway_${randomBytes(8).toString('hex')}`;
  const apiPassword = `api-${randomBytes(24).toString('base64url')}`;
  const workerPassword = `worker-${randomBytes(24).toString('base64url')}`;
  let ownerUrl: string;

  beforeAll(async () => {
    const cluster = new Pool({ connectionString: adminUrl! });
    try {
      await cluster.query(`CREATE DATABASE "${database}"`);
    } finally {
      await cluster.end();
    }
    ownerUrl = databaseUrl(adminUrl!, database);
    const owner = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      await bootstrapRailwayDatabase(owner, {
        workload: 'api',
        username: 'crypto_api_login_railway',
        password: apiPassword,
      });
      await bootstrapRailwayDatabase(owner, {
        workload: 'worker',
        username: 'crypto_worker_login_railway',
        password: workerPassword,
      });
    } finally {
      await owner.end();
    }
    const migrationPool = new Pool({
      connectionString: ownerUrl,
      max: 1,
      options: postgresStartupOptions('crypto_schema_owner'),
    });
    try {
      await new MigrationRunner(migrationPool, RAILWAY_DATABASE_MIGRATION_LIST).up();
      // Every deploy re-verifies the entire applied chain before doing work.
      // A second run must remain valid and report no changes.
      await expect(
        new MigrationRunner(migrationPool, RAILWAY_DATABASE_MIGRATION_LIST).up(),
      ).resolves.toEqual([]);
    } finally {
      await migrationPool.end();
    }
  }, 120_000);

  afterAll(async () => {
    if (!adminUrl) return;
    const cluster = new Pool({ connectionString: adminUrl });
    try {
      await cluster.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    } finally {
      await cluster.end();
    }
  });

  it('prevents each login from assuming the owner or sibling capability', async () => {
    const api = new Pool({
      connectionString: databaseUrl(ownerUrl, database, 'crypto_api_login_railway', apiPassword),
      options: postgresStartupOptions('crypto_api_runtime'),
    });
    const worker = new Pool({
      connectionString: databaseUrl(
        ownerUrl,
        database,
        'crypto_worker_login_railway',
        workerPassword,
      ),
      options: postgresStartupOptions('crypto_worker_runtime'),
    });
    try {
      await expect(api.query('SET ROLE crypto_schema_owner')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(api.query('SET ROLE crypto_worker_runtime')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(worker.query('SET ROLE crypto_schema_owner')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(worker.query('SET ROLE crypto_api_runtime')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await Promise.all([api.end(), worker.end()]);
    }
  });

  it('repairs an unexpected capability-to-owner membership before runtime starts', async () => {
    const owner = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      await owner.query('GRANT crypto_schema_owner TO crypto_api_runtime');
      await bootstrapRailwayDatabase(owner, {
        workload: 'api',
        username: 'crypto_api_login_railway',
        password: apiPassword,
      });
      const result = await owner.query<{ elevated: boolean }>(
        `SELECT pg_catalog.pg_has_role(
           'crypto_api_runtime', 'crypto_schema_owner', 'MEMBER'
         ) AS elevated`,
      );
      expect(result.rows).toEqual([{ elevated: false }]);
    } finally {
      await owner.end();
    }
  });

  it('keeps API outbox admission function-only and reserves claims for the worker', async () => {
    const api = new Pool({
      connectionString: databaseUrl(ownerUrl, database, 'crypto_api_login_railway', apiPassword),
      options: postgresStartupOptions('crypto_api_runtime'),
    });
    const worker = new Pool({
      connectionString: databaseUrl(
        ownerUrl,
        database,
        'crypto_worker_login_railway',
        workerPassword,
      ),
      options: postgresStartupOptions('crypto_worker_runtime'),
    });
    try {
      await expect(
        new MigrationRunner(api, RAILWAY_DATABASE_MIGRATION_LIST).assertMigrationRecordsUpToDate(),
      ).resolves.toBeUndefined();
      await expect(
        new MigrationRunner(
          worker,
          RAILWAY_DATABASE_MIGRATION_LIST,
        ).assertMigrationRecordsUpToDate(),
      ).resolves.toBeUndefined();
      const privilege = await api.query<{ admitted: boolean }>(
        `SELECT pg_catalog.has_function_privilege(
           current_user,
           'enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)',
           'EXECUTE'
         ) AS admitted`,
      );
      expect(privilege.rows).toEqual([{ admitted: true }]);
      await expect(
        api.query(
          `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
           VALUES ($1, 'jobs', '{}'::jsonb, '{}'::jsonb)`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        worker.query(
          `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
           VALUES ($1, 'jobs', '{}'::jsonb, '{}'::jsonb)`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await Promise.all([api.end(), worker.end()]);
    }
  });
});
