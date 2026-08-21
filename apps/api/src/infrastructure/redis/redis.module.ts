import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';

import {
  INFRASTRUCTURE_CONFIG,
  InfrastructureConfigModule,
} from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.tokens';

export function createRedisClient(config: InfrastructureConfig): Redis {
  if (config.workload !== 'api' || !config.redis) {
    throw new Error('Redis client creation is restricted to the API workload');
  }
  const encrypted = new URL(config.redis.url).protocol === 'rediss:';
  const client = new Redis(config.redis.url, {
    lazyConnect: true,
    // INFO is not part of the reviewed application ACL. PING is the explicit
    // readiness operation and is bounded by the health service timeout.
    enableReadyCheck: false,
    // ioredis otherwise emits CLIENT SETINFO on every connection. Suppressing
    // it keeps the wire-level command set identical to the reviewed ACL.
    disableClientInfo: true,
    db: 0,
    // Do not inherit a process-wide TLS weakening. Production configuration
    // also rejects NODE_TLS_REJECT_UNAUTHORIZED entirely.
    ...(encrypted ? { tls: { rejectUnauthorized: true } } : {}),
    connectTimeout: config.redis.connectTimeoutMs,
    commandTimeout: config.redis.commandTimeoutMs,
    maxRetriesPerRequest: 2,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
  });
  // Prevent ioredis from printing an unhandled event with transport details.
  // Readiness receives a sanitized operation error from RedisService.
  client.on('error', () => undefined);
  return client;
}

@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [INFRASTRUCTURE_CONFIG],
      useFactory: createRedisClient,
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
