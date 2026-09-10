import type { Pool } from 'pg';

import { loadMigrationDatabaseConfig } from '../config/infrastructure.config';
import {
  bootstrapRailwayDatabase,
  sanitizeBootstrapMigrationEnvironment,
} from './railway-database-bootstrap';

describe('bootstrapRailwayDatabase', () => {
  it('creates only fixed capability roles and commits atomically', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

    await bootstrapRailwayDatabase({ query } as unknown as Pick<Pool, 'query'>, {
      workload: 'api',
      username: 'crypto_api_login_railway',
      password: 'test-secret',
    });

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
      bootstrapRailwayDatabase({ query } as unknown as Pick<Pool, 'query'>, {
        workload: 'worker',
        username: 'crypto_worker_login_railway',
        password: 'secret',
      }),
    ).rejects.toBe(failure);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', expect.any(String), 'ROLLBACK']);
  });

  it('rejects a login that does not exactly match its workload before querying', async () => {
    const query = jest.fn();
    await expect(
      bootstrapRailwayDatabase({ query } as unknown as Pick<Pool, 'query'>, {
        workload: 'api',
        username: 'crypto_worker_login_railway',
        password: 'secret',
      }),
    ).rejects.toThrow('fixed login');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('sanitizeBootstrapMigrationEnvironment', () => {
  function apiServiceEnvironment(): NodeJS.ProcessEnv {
    // The environment the API service carries when it runs the bootstrap
    // preDeploy: runtime DB + Redis credentials alongside the migration URL.
    return {
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      DEPLOYMENT_TARGET: 'railway',
      APPLICATION_WORKLOAD: 'api',
      MIGRATION_DATABASE_URL: 'postgresql://postgres:pw@postgres.railway.internal:5432/railway',
      DATABASE_RUNTIME_HOST: 'postgres.railway.internal',
      DATABASE_RUNTIME_PORT: '5432',
      DATABASE_RUNTIME_NAME: 'railway',
      DATABASE_RUNTIME_USERNAME: 'crypto_api_login_railway',
      DATABASE_RUNTIME_PASSWORD: 'railway-simple',
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      REDIS_URL: 'redis://default:pw@redis.railway.internal:6379',
    };
  }

  it('strips the runtime workload, database, and Redis variables', () => {
    const sanitized = sanitizeBootstrapMigrationEnvironment(apiServiceEnvironment());
    expect(sanitized.APPLICATION_WORKLOAD).toBeUndefined();
    expect(sanitized.REDIS_URL).toBeUndefined();
    expect(Object.keys(sanitized).filter((name) => name.startsWith('DATABASE_RUNTIME_'))).toEqual(
      [],
    );
    expect(sanitized.MIGRATION_DATABASE_URL).toBe(
      'postgresql://postgres:pw@postgres.railway.internal:5432/railway',
    );
  });

  it('yields an environment the privileged migration loader accepts', () => {
    // Regression: the old CLI stripped APPLICATION_WORKLOAD and DATABASE_RUNTIME_*
    // but left REDIS_URL, so loadMigrationDatabaseConfig threw "must not receive
    // Redis configuration" and crashed the API bootstrap on every deploy.
    const raw = apiServiceEnvironment();
    const legacyStrip = { ...raw };
    delete legacyStrip.APPLICATION_WORKLOAD;
    for (const name of Object.keys(legacyStrip)) {
      if (name.startsWith('DATABASE_RUNTIME_')) delete legacyStrip[name];
    }
    expect(() => loadMigrationDatabaseConfig(legacyStrip)).toThrow(/Redis/u);

    const sanitized = sanitizeBootstrapMigrationEnvironment(raw);
    expect(loadMigrationDatabaseConfig(sanitized).sessionRole).toBe('crypto_schema_owner');
  });

  it('does not mutate the source environment', () => {
    const raw = apiServiceEnvironment();
    sanitizeBootstrapMigrationEnvironment(raw);
    expect(raw.REDIS_URL).toBe('redis://default:pw@redis.railway.internal:6379');
    expect(raw.APPLICATION_WORKLOAD).toBe('api');
  });
});
