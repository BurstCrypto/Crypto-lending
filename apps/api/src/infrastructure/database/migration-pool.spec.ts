import { createMigrationPool } from './migration-pool';

describe('createMigrationPool', () => {
  it('keeps migration concurrency at one with explicit lock and DDL timeouts', async () => {
    const pool = createMigrationPool({
      connectionString: 'postgresql://unused',
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
      lockTimeoutMs: 10_000,
      maxLifetimeSeconds: 1_800,
      poolMax: 99,
      statementTimeoutMs: 3_600_000,
      ssl: false,
    });

    expect(pool.options).toMatchObject({
      application_name: 'crypto-lending-migrations',
      lock_timeout: 10_000,
      max: 1,
      statement_timeout: 3_600_000,
    });
    await pool.end();
  });
});
