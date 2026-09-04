import { Module } from '@nestjs/common';

import { PostgresModule } from '../infrastructure/database/postgres.module';
import { BALANCE_SYNC_CHECKPOINT_PORT } from './application/ports/balance-sync.ports';
import { PostgresBalanceSyncCheckpointRepository } from './infrastructure/postgres/postgres-balance-sync-checkpoint.repository';
import { PostgresPortfolioBalanceReader } from './infrastructure/postgres/postgres-portfolio-balance.reader';

/**
 * Durable balance-sync capabilities only. Wallet-address resolution,
 * RPC/indexer, and queue-consumer capabilities remain absent, so importing this
 * module performs no chain or queue I/O and cannot start synchronization by
 * itself.
 */
@Module({
  imports: [PostgresModule],
  providers: [
    PostgresBalanceSyncCheckpointRepository,
    PostgresPortfolioBalanceReader,
    {
      provide: BALANCE_SYNC_CHECKPOINT_PORT,
      useExisting: PostgresBalanceSyncCheckpointRepository,
    },
  ],
  exports: [
    BALANCE_SYNC_CHECKPOINT_PORT,
    PostgresBalanceSyncCheckpointRepository,
    PostgresPortfolioBalanceReader,
  ],
})
export class BlockchainSyncModule {}
