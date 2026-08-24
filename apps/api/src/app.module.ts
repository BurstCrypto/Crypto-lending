import { Module } from '@nestjs/common';

import { AccountsModule } from './accounts/accounts.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { SystemModule } from './system/system.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    InfrastructureModule,
    AccountsModule,
    BlockchainModule,
    WalletsModule,
    PortfolioModule,
    SystemModule,
  ],
})
export class AppModule {}
