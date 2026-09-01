import { Module } from '@nestjs/common';

import { AccountsModule } from './accounts/accounts.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { EvmPublicTestnetModule } from './evm-public-testnet/evm-public-testnet.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { LocalDemoModule } from './local-demo/local-demo.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PublicTestnetModule } from './public-testnet/public-testnet.module';
import { SystemModule } from './system/system.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [
    InfrastructureModule,
    AccountsModule,
    BlockchainModule,
    WalletsModule,
    PortfolioModule,
    LocalDemoModule,
    PublicTestnetModule,
    EvmPublicTestnetModule,
    SystemModule,
  ],
})
export class AppModule {}
