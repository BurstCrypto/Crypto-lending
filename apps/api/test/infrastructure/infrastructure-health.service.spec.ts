import type { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import type { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { InfrastructureHealthService } from '../../src/infrastructure/health/infrastructure-health.service';
import type { RedisService } from '../../src/infrastructure/redis/redis.service';
import type { SqsService } from '../../src/infrastructure/sqs/sqs.service';

describe('InfrastructureHealthService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

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

  it('coalesces all concurrent checks into one bounded dependency pass', async () => {
    let releaseDependencies: (() => void) | undefined;
    const dependenciesReleased = new Promise<void>((resolve) => {
      releaseDependencies = resolve;
    });
    const postgres = {
      healthCheck: jest.fn().mockReturnValue(dependenciesReleased),
    } as unknown as PostgresService;
    const migrations = {
      assertUpToDate: jest.fn().mockResolvedValue(undefined),
    } as unknown as MigrationRunner;
    const redis = {
      healthCheck: jest.fn().mockReturnValue(dependenciesReleased),
    } as unknown as RedisService;
    const sqs = {
      healthCheck: jest.fn().mockReturnValue(dependenciesReleased),
    } as unknown as SqsService;
    const health = new InfrastructureHealthService(postgres, migrations, redis, sqs);

    const first = health.check(2_000);
    const second = health.check(500);

    expect(postgres.healthCheck).toHaveBeenCalledTimes(1);
    expect(redis.healthCheck).toHaveBeenCalledTimes(1);
    expect(sqs.healthCheck).toHaveBeenCalledTimes(1);

    releaseDependencies?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toBe(firstResult);
    expect(migrations.assertUpToDate).toHaveBeenCalledTimes(1);
  });

  it('reuses a completed result only for the brief cache lifetime', async () => {
    let now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const postgres = {
      healthCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as PostgresService;
    const migrations = {
      assertUpToDate: jest.fn().mockResolvedValue(undefined),
    } as unknown as MigrationRunner;
    const redis = {
      healthCheck: jest.fn().mockRejectedValue(new Error('cache unavailable')),
    } as unknown as RedisService;
    const sqs = {
      healthCheck: jest.fn().mockResolvedValue(undefined),
    } as unknown as SqsService;
    const health = new InfrastructureHealthService(postgres, migrations, redis, sqs);

    const first = await health.check();
    const cached = await health.check();
    now += 5_001;
    const refreshed = await health.check();

    expect(first.status).toBe('degraded');
    expect(cached).toBe(first);
    expect(refreshed).not.toBe(first);
    expect(postgres.healthCheck).toHaveBeenCalledTimes(2);
    expect(migrations.assertUpToDate).toHaveBeenCalledTimes(2);
    expect(redis.healthCheck).toHaveBeenCalledTimes(2);
    expect(sqs.healthCheck).toHaveBeenCalledTimes(2);
  });

  it('preserves the caller-provided dependency timeout', async () => {
    jest.useFakeTimers();
    const never = new Promise<void>(() => undefined);
    const postgres = {
      healthCheck: jest.fn().mockReturnValue(never),
    } as unknown as PostgresService;
    const migrations = {
      assertUpToDate: jest.fn().mockResolvedValue(undefined),
    } as unknown as MigrationRunner;
    const redis = {
      healthCheck: jest.fn().mockReturnValue(never),
    } as unknown as RedisService;
    const sqs = {
      healthCheck: jest.fn().mockReturnValue(never),
    } as unknown as SqsService;
    const health = new InfrastructureHealthService(postgres, migrations, redis, sqs);

    const pending = health.check(25);
    await jest.advanceTimersByTimeAsync(24);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        postgres: { status: 'down', error: 'Health check timed out after 25ms' },
        redis: { status: 'down', error: 'Health check timed out after 25ms' },
        sqs: { status: 'down', error: 'Health check timed out after 25ms' },
      },
    });
    const sqsSignal = (sqs.healthCheck as jest.Mock).mock.calls[0]?.[0] as AbortSignal | undefined;
    expect(sqsSignal?.aborted).toBe(true);
  });

  it('does not overlap dependency work that outlives its readiness timeout', async () => {
    jest.useFakeTimers();
    let releaseDependencies: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseDependencies = resolve;
    });
    const postgres = {
      healthCheck: jest.fn().mockReturnValue(blocked),
    } as unknown as PostgresService;
    const migrations = {
      assertUpToDate: jest.fn().mockResolvedValue(undefined),
    } as unknown as MigrationRunner;
    const redis = {
      healthCheck: jest.fn().mockReturnValue(blocked),
    } as unknown as RedisService;
    const sqs = {
      healthCheck: jest.fn().mockReturnValue(blocked),
    } as unknown as SqsService;
    const health = new InfrastructureHealthService(postgres, migrations, redis, sqs);

    const first = health.check(25);
    await jest.advanceTimersByTimeAsync(25);
    await expect(first).resolves.toMatchObject({ status: 'degraded' });

    await jest.advanceTimersByTimeAsync(5_001);
    const second = health.check(25);
    expect(postgres.healthCheck).toHaveBeenCalledTimes(1);
    expect(redis.healthCheck).toHaveBeenCalledTimes(1);
    expect(sqs.healthCheck).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(25);
    await expect(second).resolves.toMatchObject({ status: 'degraded' });
    releaseDependencies?.();
    await Promise.resolve();
  });
});
