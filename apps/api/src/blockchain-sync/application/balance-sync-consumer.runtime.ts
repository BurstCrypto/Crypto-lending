import { Module } from '@nestjs/common';

import { PostgresModule } from '../../infrastructure/database/postgres.module';
import { SqsModule } from '../../infrastructure/sqs/sqs.module';
import type { BalanceConsumerRuntimeModule } from './balance-sync-consumer.cli-mode';

/**
 * This module is intentionally reachable only through the dynamically imported
 * runtime boundary. It must remain unregistered while source activation is off.
 */
@Module({ imports: [PostgresModule, SqsModule] })
export class DormantBalanceSyncConsumerRuntimeModule {}

export const startBalanceSyncConsumerRuntime: BalanceConsumerRuntimeModule['startBalanceSyncConsumerRuntime'] =
  () => Promise.reject(new Error('BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED'));
