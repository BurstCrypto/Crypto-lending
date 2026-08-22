import { Module } from '@nestjs/common';

import { AccountsModule } from './accounts/accounts.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [InfrastructureModule, AccountsModule, BlockchainModule, SystemModule],
})
export class AppModule {}
