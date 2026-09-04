import { PostgresModule } from '../infrastructure/database/postgres.module';
import {
  BALANCE_SYNC_CHECKPOINT_PORT,
  BALANCE_SYNC_WALLET_ADDRESS_RESOLVER_PORT,
} from './application/ports/balance-sync.ports';
import { BlockchainSyncModule } from './blockchain-sync.module';
import { PostgresBalanceSyncCheckpointRepository } from './infrastructure/postgres/postgres-balance-sync-checkpoint.repository';
import { PostgresPortfolioBalanceReader } from './infrastructure/postgres/postgres-portfolio-balance.reader';

describe('BlockchainSyncModule durable boundaries', () => {
  it('registers PostgreSQL reads/checkpoints without an address resolver or live indexer', () => {
    expect(Reflect.getMetadata('imports', BlockchainSyncModule)).toEqual([PostgresModule]);
    const providers = Reflect.getMetadata('providers', BlockchainSyncModule) as readonly unknown[];
    expect(providers).toEqual([
      PostgresBalanceSyncCheckpointRepository,
      PostgresPortfolioBalanceReader,
      {
        provide: BALANCE_SYNC_CHECKPOINT_PORT,
        useExisting: PostgresBalanceSyncCheckpointRepository,
      },
    ]);
    expect(providers).not.toContainEqual(
      expect.objectContaining({ provide: BALANCE_SYNC_WALLET_ADDRESS_RESOLVER_PORT }),
    );
    expect(Reflect.getMetadata('exports', BlockchainSyncModule)).toEqual([
      BALANCE_SYNC_CHECKPOINT_PORT,
      PostgresBalanceSyncCheckpointRepository,
      PostgresPortfolioBalanceReader,
    ]);
  });
});
