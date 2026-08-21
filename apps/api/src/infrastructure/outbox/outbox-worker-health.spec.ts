import type { MigrationRunner } from '../database/migration-runner.service';
import type { PostgresService } from '../database/postgres.service';
import type { SqsHealthPort } from '../health/sqs-health.port';
import {
  assertOutboxWorkerHealthy,
  type OutboxWorkerHealth,
  OutboxWorkerHealthService,
} from './outbox-worker-health';

function healthService(result: OutboxWorkerHealth): Pick<OutboxWorkerHealthService, 'check'> {
  return { check: jest.fn().mockResolvedValue(result) };
}

describe('OutboxWorkerHealthService', () => {
  it('checks only PostgreSQL, migrations, and SQS', async () => {
    const postgres = { healthCheck: jest.fn().mockResolvedValue(undefined) };
    const migrations = { assertUpToDate: jest.fn().mockResolvedValue(undefined) };
    const sqs = { healthCheck: jest.fn().mockResolvedValue(undefined) };
    const health = new OutboxWorkerHealthService(
      postgres as unknown as PostgresService,
      migrations as unknown as MigrationRunner,
      sqs as SqsHealthPort,
    );

    await expect(health.check()).resolves.toEqual({
      status: 'ok',
      checks: { postgres: { status: 'up' }, sqs: { status: 'up' } },
    });
    expect(postgres.healthCheck).toHaveBeenCalledTimes(1);
    expect(migrations.assertUpToDate).toHaveBeenCalledTimes(1);
    expect(sqs.healthCheck).toHaveBeenCalledTimes(1);
  });

  it('reports dependency names without exposing raw failures', async () => {
    const health = new OutboxWorkerHealthService(
      {
        healthCheck: jest.fn().mockRejectedValue(new Error('database-secret')),
      } as unknown as PostgresService,
      { assertUpToDate: jest.fn() } as unknown as MigrationRunner,
      { healthCheck: jest.fn().mockRejectedValue(new Error('queue-secret')) },
    );

    const result = await health.check();
    expect(result).toEqual({
      status: 'degraded',
      checks: { postgres: { status: 'down' }, sqs: { status: 'down' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('assertOutboxWorkerHealthy', () => {
  it('accepts a worker whose required dependencies and migrations are ready', async () => {
    await expect(
      assertOutboxWorkerHealthy(
        healthService({
          status: 'ok',
          checks: { postgres: { status: 'up' }, sqs: { status: 'up' } },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('fails with only the names of unavailable dependencies', async () => {
    await expect(
      assertOutboxWorkerHealthy(
        healthService({
          status: 'degraded',
          checks: { postgres: { status: 'down' }, sqs: { status: 'down' } },
        }),
      ),
    ).rejects.toThrow('Outbox worker dependencies are not ready: postgres, sqs');
  });
});
