import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';

import {
  INFRASTRUCTURE_CONFIG,
  InfrastructureConfigModule,
} from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.tokens';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [INFRASTRUCTURE_CONFIG],
      useFactory: (config: InfrastructureConfig): Redis =>
        new Redis(config.redis.url, {
          keyPrefix: config.redis.keyPrefix,
          lazyConnect: true,
          enableReadyCheck: true,
          connectTimeout: config.redis.connectTimeoutMs,
          commandTimeout: config.redis.commandTimeoutMs,
          maxRetriesPerRequest: 2,
          retryStrategy: (attempt) => Math.min(attempt * 100, 2_000),
        }),
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
