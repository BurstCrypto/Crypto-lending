import { databaseMigrationsForDeployment } from './deployment-migrations';
import { DATABASE_MIGRATION_LIST } from './migrations';
import { RAILWAY_DATABASE_MIGRATION_LIST } from './railway-migrations';

describe('databaseMigrationsForDeployment', () => {
  it('selects the Railway owner-compatible list only for the exact target', () => {
    expect(databaseMigrationsForDeployment({ DEPLOYMENT_TARGET: 'railway' })).toBe(
      RAILWAY_DATABASE_MIGRATION_LIST,
    );
    expect(databaseMigrationsForDeployment({}, DATABASE_MIGRATION_LIST)).toBe(
      DATABASE_MIGRATION_LIST,
    );
    expect(RAILWAY_DATABASE_MIGRATION_LIST.at(-1)).toMatchObject({
      id: '9001',
      description: 'create durable Railway PostgreSQL job queue',
    });
    expect(RAILWAY_DATABASE_MIGRATION_LIST.at(-1)?.upSql).toContain(
      'CREATE TABLE railway_job_queue',
    );
    expect(RAILWAY_DATABASE_MIGRATION_LIST.at(-2)).toMatchObject({
      id: '9000',
      description: 'enforce Railway database runtime principal boundaries',
    });
    expect(RAILWAY_DATABASE_MIGRATION_LIST.at(-2)?.upSql).toContain(
      'GRANT SELECT, DELETE ON TABLE job_outbox TO crypto_worker_runtime',
    );
    expect(RAILWAY_DATABASE_MIGRATION_LIST.at(-1)?.upSql).toContain(
      'GRANT SELECT, INSERT, DELETE ON TABLE railway_job_queue TO crypto_worker_runtime',
    );
    expect(() => databaseMigrationsForDeployment({ DEPLOYMENT_TARGET: 'Railway' })).toThrow(
      'DEPLOYMENT_TARGET must be exactly railway',
    );
  });
});
