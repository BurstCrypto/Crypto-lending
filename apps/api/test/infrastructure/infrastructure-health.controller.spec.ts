import { HttpException, HttpStatus } from '@nestjs/common';

import { InfrastructureHealthController } from '../../src/infrastructure/health/infrastructure-health.controller';
import type { InfrastructureHealthService } from '../../src/infrastructure/health/infrastructure-health.service';

describe('InfrastructureHealthController', () => {
  it('returns readiness details when every dependency is up', async () => {
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
    const controller = new InfrastructureHealthController(health);

    await expect(controller.checkDependencies()).resolves.toEqual({
      status: 'ok',
      checks: {
        postgres: { status: 'up', latencyMs: 1 },
        redis: { status: 'up', latencyMs: 2 },
        sqs: { status: 'up', latencyMs: 3 },
      },
    });
  });

  it('returns 503 without exposing raw dependency errors when degraded', async () => {
    const health = {
      check: jest.fn().mockResolvedValue({
        status: 'degraded',
        checks: {
          postgres: { status: 'up', latencyMs: 1 },
          redis: {
            status: 'down',
            latencyMs: 2,
            error: 'connect ECONNREFUSED redis.internal:6379',
          },
          sqs: { status: 'up', latencyMs: 3 },
        },
      }),
    } as unknown as InfrastructureHealthService;
    const controller = new InfrastructureHealthController(health);

    let captured: unknown;
    try {
      await controller.checkDependencies();
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(HttpException);
    const exception = captured as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(exception.getResponse()).toEqual({
      status: 'degraded',
      checks: {
        postgres: { status: 'up', latencyMs: 1 },
        redis: { status: 'down', latencyMs: 2 },
        sqs: { status: 'up', latencyMs: 3 },
      },
    });
    expect(JSON.stringify(exception.getResponse())).not.toContain('ECONNREFUSED');
  });
});
