import type { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import type { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { InfrastructureHealthService } from '../../src/infrastructure/health/infrastructure-health.service';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';
import type { SqsService } from '../../src/infrastructure/sqs/sqs.service';

describe('InfrastructureHealthService', () => {
  it('reports all configured dependencies as healthy', async () => {
    const postgres = {
      healthCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as PostgresService;
    const migrations = {
      assertUpToDate: jest.fn().mockResolvedValue(undefined),
    } as unknown as MigrationRunner;
    const redis = {
      healthCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;
    const sqs = {
      healthCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const health = new InfrastructureHealthService(postgres, migrations, redis, sqs);

    await expect(health.check()).resolves.toMatchObject({
      status: 'ok',
      checks: {
        postgres: { status: 'up' },
        redis: { status: 'up' },
        sqs: { status: 'up' },
      },
    });
  });

  it('reports degraded without hiding which dependency failed', async () => {
    const postgres = {
      healthCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as PostgresService;
    const migrations = {
      assertUpToDate: jest.fn().mockResolvedValue(undefined),
    } as unknown as MigrationRunner;
    const redis = {
      healthCheck: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as RedisService;
    const sqs = {
      healthCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const health = new InfrastructureHealthService(postgres, migrations, redis, sqs);

    await expect(health.check()).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        postgres: { status: 'up' },
        redis: { status: 'down', error: 'connection refused' },
        sqs: { status: 'up' },
      },
    });
  });
});
