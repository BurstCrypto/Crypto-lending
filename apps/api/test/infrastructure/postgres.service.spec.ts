import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { createPostgresPool } from '../../src/infrastructure/database/postgres.module';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { testInfrastructureConfig } from './fixtures';

function result(rows: QueryResultRow[] = []): QueryResult {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe('PostgresService', () => {
  it('applies bounded connection acquisition, idle, and lifetime settings to the pool', async () => {
    const pool = createPostgresPool({
      ...testInfrastructureConfig(),
      database: {
        connectionString: 'postgresql://unused',
        connectionTimeoutMs: 2_500,
        idleTimeoutMs: 45_000,
        lockTimeoutMs: 4_000,
        maxLifetimeSeconds: 900,
        poolMax: 7,
        statementTimeoutMs: 8_000,
        ssl: false,
      },
    });

    expect(pool.options).toMatchObject({
      application_name: 'crypto-lending-api',
      connectionTimeoutMillis: 2_500,
      idleTimeoutMillis: 45_000,
      lock_timeout: 4_000,
      max: 7,
      maxLifetimeSeconds: 900,
      statement_timeout: 8_000,
    });
    await pool.end();
  });

  it('binds production runtime capability roles through connection startup options', async () => {
    const apiPool = createPostgresPool({
      ...testInfrastructureConfig(),
      workload: 'api',
      database: {
        ...testInfrastructureConfig().database,
        connectionString: 'postgresql://unused',
        sessionRole: 'crypto_api_runtime',
      },
    });
    expect(apiPool.options.options).toBe(
      '-c role=crypto_api_runtime -c search_path=public,pg_temp',
    );
    await apiPool.end();

    expect(() =>
      createPostgresPool({
        ...testInfrastructureConfig(),
        workload: 'worker',
        database: {
          ...testInfrastructureConfig().database,
          sessionRole: 'crypto_api_runtime',
        },
      }),
    ).toThrow('does not match worker workload');
  });

  function setup(): {
    service: PostgresService;
    query: jest.Mock<Promise<QueryResult>, [string, unknown[]?]>;
    release: jest.Mock<void, []>;
  } {
    const query = jest.fn<Promise<QueryResult>, [string, unknown[]?]>();
    query.mockResolvedValue(result());
    const release = jest.fn<void, []>();
    const client = { query, release } as unknown as PoolClient;
    const pool = {
      connect: jest.fn().mockResolvedValue(client),
      query: jest.fn().mockResolvedValue(result()),
      end: jest.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    return { service: new PostgresService(pool), query, release };
  }

  it('commits work and routes repository queries through the active client', async () => {
    const { service, query, release } = setup();

    const value = await service.withTransaction(async () => {
      await service.query('INSERT INTO example(id) VALUES ($1)', ['one']);
      return 'committed';
    });

    expect(value).toBe('committed');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE',
      'INSERT INTO example(id) VALUES ($1)',
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and preserves the original application error', async () => {
    const { service, query, release } = setup();
    const failure = new Error('write rejected');

    await expect(
      service.withTransaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE',
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('retries a serializable transaction after SQLSTATE 40001', async () => {
    const { service, query } = setup();
    const serializationFailure = Object.assign(new Error('retry transaction'), {
      code: '40001',
    });
    let attempt = 0;

    const value = await service.withTransaction(
      async () => {
        attempt += 1;
        if (attempt === 1) {
          throw serializationFailure;
        }
        return 42;
      },
      { isolationLevel: 'serializable', maxRetries: 1, retryDelayMs: 0 },
    );

    expect(value).toBe(42);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE',
      'ROLLBACK',
      'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE',
      'COMMIT',
    ]);
  });
});
