import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';

import { INFRASTRUCTURE_CONFIG } from '../config/infrastructure-config.module';
import { MigrationRunner } from './migration-runner.service';
import { PostgresModule } from './postgres.module';
import { POSTGRES_POOL } from './postgres.tokens';
import { createPostgresPool } from './runtime-postgres-pool';

describe('PostgresModule', () => {
  it('wires the extracted runtime pool factory by identity', () => {
    const providers = Reflect.getMetadata('providers', PostgresModule) as unknown[];
    const postgresPoolProviders = providers.filter(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === POSTGRES_POOL,
    );

    expect(postgresPoolProviders).toHaveLength(1);
    expect(postgresPoolProviders[0]).toEqual({
      provide: POSTGRES_POOL,
      inject: [INFRASTRUCTURE_CONFIG],
      useFactory: createPostgresPool,
    });
  });

  it('injects optional cancellable PostgreSQL support into migration readiness', async () => {
    const pool = {
      connect: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
    } as unknown as Pool;
    const moduleRef = await Test.createTestingModule({ imports: [PostgresModule] })
      .overrideProvider(POSTGRES_POOL)
      .useValue(pool)
      .compile();
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(
        moduleRef.get(MigrationRunner).assertUpToDate(controller.signal),
      ).rejects.toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED' });
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });
});
