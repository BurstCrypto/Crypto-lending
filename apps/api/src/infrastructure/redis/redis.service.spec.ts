import type { Redis } from 'ioredis';

import { RedisOperationError, RedisService } from './redis.service';

function redisClient(overrides: Partial<Redis> = {}): Redis {
  return {
    status: 'ready',
    ping: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  } as unknown as Redis;
}

describe('RedisService', () => {
  it.each([
    [
      'WRONGPASS invalid username-password pair at rediss://user:do-not-log@cache',
      'authentication rejected',
    ],
    ['NOPERM this user has no permissions', 'operation not permitted'],
    ['Command timed out after 2000ms for sensitive-value', 'operation timed out'],
    ['connect ECONNREFUSED cache.internal:6379', 'service unavailable'],
    ['unexpected raw failure with sensitive-value', 'operation failed'],
  ] as const)('classifies and redacts PING failure: %s', async (rawMessage, kind) => {
    const service = new RedisService(
      redisClient({ ping: jest.fn().mockRejectedValue(new Error(rawMessage)) }),
    );

    let captured: unknown;
    try {
      await service.healthCheck();
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(RedisOperationError);
    expect(captured).toMatchObject({ kind });
    expect((captured as Error).message).toBe(`Redis PING failed: ${kind}`);
    expect(JSON.stringify(captured)).not.toContain('do-not-log');
    expect(JSON.stringify(captured)).not.toContain('sensitive-value');
  });

  it('accepts only the reviewed PING readiness response', async () => {
    const service = new RedisService(redisClient({ ping: jest.fn().mockResolvedValue('PONG') }));
    await expect(service.healthCheck()).resolves.toBeUndefined();
  });

  it('redacts an unexpected PING response', async () => {
    const service = new RedisService(
      redisClient({ ping: jest.fn().mockResolvedValue('unexpected-sensitive-response') }),
    );
    await expect(service.healthCheck()).rejects.toThrow('Redis PING failed: operation failed');
  });

  it('uses the reviewed QUIT command for a ready connection', async () => {
    const quit = jest.fn().mockResolvedValue('OK');
    const disconnect = jest.fn();
    const service = new RedisService(redisClient({ quit, disconnect }));

    await service.onApplicationShutdown();

    expect(quit).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('disconnects without exposing a failed QUIT response', async () => {
    const quit = jest.fn().mockRejectedValue(new Error('do-not-log shutdown credential'));
    const disconnect = jest.fn();
    const service = new RedisService(redisClient({ quit, disconnect }));

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledWith(false);
  });
});
