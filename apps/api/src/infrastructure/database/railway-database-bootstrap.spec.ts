import type { Pool } from 'pg';

import { bootstrapRailwayDatabase } from './railway-database-bootstrap';

describe('bootstrapRailwayDatabase', () => {
  it('creates only fixed capability roles and commits atomically', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

    await bootstrapRailwayDatabase(
      { query } as unknown as Pick<Pool, 'query'>,
      { workload: 'api', username: 'crypto_api_login_railway', password: 'test-secret' },
    );

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.stringContaining("('crypto_schema_owner', false, false)"),
      expect.stringContaining("pg_catalog.set_config('crypto.runtime_login'"),
      expect.stringContaining('CREATE ROLE %I LOGIN NOINHERIT'),
      'COMMIT',
    ]);
    expect(query.mock.calls[2]?.[0]).toContain(
      'GRANT crypto_schema_owner, crypto_migration TO CURRENT_USER',
    );
    expect(query.mock.calls[2]?.[0]).toContain("('crypto_migration', false, false)");
    expect(query.mock.calls[2]?.[0]).toContain('ALTER SCHEMA public OWNER TO crypto_schema_owner');
    expect(query.mock.calls[3]?.[1]).toEqual([
      'crypto_api_login_railway',
      'test-secret',
      'crypto_api_runtime',
    ]);
    expect(query.mock.calls[4]?.[0]).toContain(
      'REVOKE crypto_schema_owner, crypto_migration, crypto_api_runtime, crypto_worker_runtime',
    );
  });

  it('rolls back and preserves the bootstrap error', async () => {
    const failure = new Error('bootstrap failed');
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      bootstrapRailwayDatabase(
        { query } as unknown as Pick<Pool, 'query'>,
        { workload: 'worker', username: 'crypto_worker_login_railway', password: 'secret' },
      ),
    ).rejects.toBe(failure);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.any(String), 'ROLLBACK']);
  });

  it('rejects a login that does not exactly match its workload before querying', async () => {
    const query = jest.fn();
    await expect(
      bootstrapRailwayDatabase(
        { query } as unknown as Pick<Pool, 'query'>,
        { workload: 'api', username: 'crypto_worker_login_railway', password: 'secret' },
      ),
    ).rejects.toThrow('fixed login');
    expect(query).not.toHaveBeenCalled();
  });
});
