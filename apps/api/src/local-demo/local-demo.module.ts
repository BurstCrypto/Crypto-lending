import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { WalletsModule } from '../wallets/wallets.module';
import { LocalDemoAllocationService } from './local-demo-allocation.service';
import { LocalDemoPrivacyInterceptor } from './local-demo-http';
import { LOCAL_EVM_CHAIN_RUNTIME, LoopbackLocalEvmChainRuntime } from './local-evm-chain.runtime';
import { LocalDemoPortfolioService } from './local-demo-portfolio.service';
import { LOCAL_DEMO_RUNTIME_CONFIG, loadLocalDemoRuntimeConfig } from './local-demo-runtime.config';
import { LocalDemoWalletService } from './local-demo-wallet.service';
import { LocalDemoYieldCatalogService } from './local-demo-yield-catalog.service';
import { LocalDemoController } from './local-demo.controller';

@Module({
  imports: [AccountsModule, AuthenticationModule, WalletsModule],
  controllers: [LocalDemoController],
  providers: [
    {
      provide: LOCAL_DEMO_RUNTIME_CONFIG,
      useFactory: loadLocalDemoRuntimeConfig,
    },
    {
      provide: LOCAL_EVM_CHAIN_RUNTIME,
      inject: [LOCAL_DEMO_RUNTIME_CONFIG],
      useFactory: (config: ReturnType<typeof loadLocalDemoRuntimeConfig>) =>
        new LoopbackLocalEvmChainRuntime(config),
    },
    LocalDemoWalletService,
    LocalDemoPortfolioService,
    LocalDemoYieldCatalogService,
    LocalDemoAllocationService,
    LocalDemoPrivacyInterceptor,
  ],
})
export class LocalDemoModule {}
