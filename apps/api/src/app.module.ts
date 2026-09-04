import { Module } from '@nestjs/common';

import { AccountsModule } from './accounts/accounts.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { MainnetPlatformsModule } from './mainnet-platforms/mainnet-platforms.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { SmartLendingModule } from './smart-lending/smart-lending.module';
import { SystemModule } from './system/system.module';
import { WalletsModule } from './wallets/wallets.module';

/**
 * Production root. Development-only modules deliberately live in a separate,
 * lazily loaded root so importing this class cannot execute their module-level
 * code or pull public-testnet SDKs into the production startup graph.
 */
@Module({
  imports: [
    InfrastructureModule,
    AccountsModule,
    BlockchainModule,
    WalletsModule,
    PortfolioModule,
    MainnetPlatformsModule,
    SmartLendingModule,
    SystemModule,
  ],
})
export class AppModule {}
