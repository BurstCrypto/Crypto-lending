import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from './redis.tokens';

export type RedisFailureKind =
  | 'authentication rejected'
  | 'operation not permitted'
  | 'operation timed out'
  | 'service unavailable'
  | 'operation failed';

export class RedisOperationError extends Error {
  constructor(
    operation: string,
    readonly kind: RedisFailureKind,
  ) {
    super(`Redis ${operation} failed: ${kind}`);
    this.name = 'RedisOperationError';
  }
}

function redisFailureKind(error: unknown): RedisFailureKind {
  const message = error instanceof Error ? error.message : '';
  if (/WRONGPASS|NOAUTH|AUTH failed|invalid username-password/iu.test(message)) {
    return 'authentication rejected';
  }
  if (/NOPERM|permission/iu.test(message)) {
    return 'operation not permitted';
  }
  if (/timeout|timed out|ETIMEDOUT/iu.test(message)) {
    return 'operation timed out';
  }
  if (/ECONN|EHOST|ENET|socket|connection|stream/iu.test(message)) {
    return 'service unavailable';
  }
  return 'operation failed';
}

@Injectable()
export class RedisService implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async healthCheck(): Promise<void> {
    let response: string;
    try {
      response = await this.client.ping();
    } catch (error) {
      throw new RedisOperationError('PING', redisFailureKind(error));
    }
    if (response !== 'PONG') {
      throw new RedisOperationError('PING', 'operation failed');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'end') return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect(false);
    }
  }
}
