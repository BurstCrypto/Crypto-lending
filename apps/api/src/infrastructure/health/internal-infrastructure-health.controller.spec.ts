import { InternalInfrastructureHealthController } from './internal-infrastructure-health.controller';
import type { InfrastructureHealthService } from './infrastructure-health.service';

describe('InternalInfrastructureHealthController', () => {
  it('serves the shared dependency result without consuming public admission capacity', async () => {
    const health = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        checks: {
          postgres: { status: 'up', latencyMs: 1 },
          redis: { status: 'up', latencyMs: 2 },
          sqs: { status: 'up', latencyMs: 3 },
        },
      }),
    } as unknown as InfrastructureHealthService;
    const controller = new InternalInfrastructureHealthController(health);

    await expect(controller.checkDependencies()).resolves.toMatchObject({ status: 'ok' });
    expect(health.check).toHaveBeenCalledTimes(1);
  });
});
