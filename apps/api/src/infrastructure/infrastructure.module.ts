import { Module } from '@nestjs/common';

import { InfrastructureConfigModule } from './config/infrastructure-config.module';
import { PostgresModule } from './database/postgres.module';
import { InfrastructureHealthController } from './health/infrastructure-health.controller';
import { InfrastructureHealthService } from './health/infrastructure-health.service';
import { OutboxModule } from './outbox/outbox.module';
import { RedisModule } from './redis/redis.module';
import { SqsModule } from './sqs/sqs.module';

@Module({
  imports: [InfrastructureConfigModule, PostgresModule, RedisModule, SqsModule, OutboxModule],
  controllers: [InfrastructureHealthController],
  providers: [InfrastructureHealthService],
  exports: [PostgresModule, RedisModule, OutboxModule, InfrastructureHealthService],
})
export class InfrastructureModule {}
