import type {
  InfrastructureHealth,
  InfrastructureHealthService,
} from '../health/infrastructure-health.service';
import { assertOutboxWorkerHealthy } from './outbox-worker-health';

function healthService(result: InfrastructureHealth): Pick<InfrastructureHealthService, 'check'> {
  return {
    check: jest.fn().mockResolvedValue(result) as InfrastructureHealthService['check'],
  };
}

describe('assertOutboxWorkerHealthy', () => {
  it('accepts a worker whose required dependencies and migrations are ready', async () => {
    await expect(
      assertOutboxWorkerHealthy(
        healthService({
          status: 'ok',
          checks: {
            postgres: { status: 'up', latencyMs: 1 },
            redis: { status: 'up', latencyMs: 2 },
            sqs: { status: 'up', latencyMs: 3 },
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('fails with the names of unavailable dependencies', async () => {
    await expect(
      assertOutboxWorkerHealthy(
        healthService({
          status: 'degraded',
          checks: {
            postgres: { status: 'down', latencyMs: 1, error: 'migration missing' },
            redis: { status: 'up', latencyMs: 2 },
            sqs: { status: 'down', latencyMs: 3, error: 'queue unavailable' },
          },
        }),
      ),
    ).rejects.toThrow('Outbox worker dependencies are not ready: postgres, sqs');
  });
});
