import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';

import { INFRASTRUCTURE_CONFIG } from '../infrastructure/config/infrastructure-config.module';
import type { InfrastructureConfig } from '../infrastructure/config/infrastructure.config';
import { POSTGRES_POOL } from '../infrastructure/database/postgres.tokens';
import { AuthenticationModule } from './authentication.module';
import { SessionResolutionAdmission } from './infrastructure/session-resolution-admission';

function infrastructureConfig(poolMax: number): InfrastructureConfig {
  return { database: { poolMax } } as unknown as InfrastructureConfig;
}

function inertPool(): Pool {
  return {
    end: jest.fn().mockResolvedValue(undefined),
  } as unknown as Pool;
}

describe('AuthenticationModule session-resolution admission bootstrap', () => {
  it('injects one admission singleton configured below the runtime database pool', async () => {
    const module = await Test.createTestingModule({ imports: [AuthenticationModule] })
      .overrideProvider(INFRASTRUCTURE_CONFIG)
      .useValue(infrastructureConfig(3))
      .overrideProvider(POSTGRES_POOL)
      .useValue(inertPool())
      .compile();
    const app = module.createNestApplication();
    await app.init();

    try {
      const boundary = module.get(SessionResolutionAdmission);
      expect(module.get(SessionResolutionAdmission)).toBe(boundary);
      const first = boundary.tryAcquire('198.51.100.80');
      const second = boundary.tryAcquire('198.51.100.81');
      expect(first.admitted).toBe(true);
      expect(second.admitted).toBe(true);
      expect(boundary.tryAcquire('198.51.100.82')).toEqual({
        admitted: false,
        retryAfterSeconds: 1,
      });
      if (first.admitted) first.lease.release();
      if (second.admitted) second.lease.release();
    } finally {
      await app.close();
    }
  });

  it('fails module startup when no database connection can remain outside resolution', async () => {
    await expect(
      Test.createTestingModule({ imports: [AuthenticationModule] })
        .overrideProvider(INFRASTRUCTURE_CONFIG)
        .useValue(infrastructureConfig(1))
        .overrideProvider(POSTGRES_POOL)
        .useValue(inertPool())
        .compile(),
    ).rejects.toThrow('Database pool capacity must be an integer between 2 and 100');
  });
});
