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
    const railwayMigrations = RAILWAY_DATABASE_MIGRATION_LIST.filter(({ id }) =>
      id.startsWith('9'),
    );
    expect(railwayMigrations.map(({ id }) => id)).toEqual(['9000', '9001', '9002', '9003']);
    expect(DATABASE_MIGRATION_LIST.some(({ id }) => id.startsWith('9'))).toBe(false);
    const [principals, jobQueue] = railwayMigrations;
    expect(jobQueue).toMatchObject({
      id: '9001',
      description: 'create durable Railway PostgreSQL job queue',
    });
    expect(jobQueue?.upSql).toContain('CREATE TABLE railway_job_queue');
    expect(principals).toMatchObject({
      id: '9000',
      description: 'enforce Railway database runtime principal boundaries',
    });
    expect(principals?.upSql).toContain(
      'GRANT SELECT, DELETE ON TABLE job_outbox TO crypto_worker_runtime',
    );
    expect(jobQueue?.upSql).toContain(
      'GRANT SELECT, INSERT, DELETE ON TABLE railway_job_queue TO crypto_worker_runtime',
    );
    expect(() => databaseMigrationsForDeployment({ DEPLOYMENT_TARGET: 'Railway' })).toThrow(
      'DEPLOYMENT_TARGET must be exactly railway',
    );
  });
});
