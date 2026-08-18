import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from './redis.tokens';

export interface RedisSetOptions {
  ttlSeconds?: number;
  onlyIfAbsent?: boolean;
}

@Injectable()
export class RedisService implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, options: RedisSetOptions = {}): Promise<boolean> {
    if (options.ttlSeconds !== undefined) {
      if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 1) {
        throw new Error('Redis ttlSeconds must be a positive integer');
      }
      const result = options.onlyIfAbsent
        ? await this.client.set(key, value, 'EX', options.ttlSeconds, 'NX')
        : await this.client.set(key, value, 'EX', options.ttlSeconds);
      return result === 'OK';
    }

    const result = options.onlyIfAbsent
      ? await this.client.set(key, value, 'NX')
      : await this.client.set(key, value);
    return result === 'OK';
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async setJson<T>(key: string, value: T, options: RedisSetOptions = {}): Promise<boolean> {
    return this.set(key, JSON.stringify(value), options);
  }

  async delete(...keys: string[]): Promise<number> {
    return keys.length === 0 ? 0 : this.client.del(...keys);
  }

  async healthCheck(): Promise<void> {
    const response = await this.client.ping();
    if (response !== 'PONG') {
      throw new Error('Redis PING returned an unexpected response');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect(false);
    }
  }
}
