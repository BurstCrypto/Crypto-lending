import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { WalletsModule } from '../wallets/wallets.module';
import { LocalDemoPrivacyInterceptor } from './local-demo-http';
import { LocalDemoPortfolioService } from './local-demo-portfolio.service';
import { LOCAL_DEMO_RUNTIME_CONFIG, loadLocalDemoRuntimeConfig } from './local-demo-runtime.config';
import { LocalDemoWalletService } from './local-demo-wallet.service';
import { LocalDemoController } from './local-demo.controller';

@Module({
  imports: [AccountsModule, AuthenticationModule, WalletsModule],
  controllers: [LocalDemoController],
  providers: [
    {
      provide: LOCAL_DEMO_RUNTIME_CONFIG,
      useFactory: loadLocalDemoRuntimeConfig,
    },
    LocalDemoWalletService,
    LocalDemoPortfolioService,
    LocalDemoPrivacyInterceptor,
  ],
})
export class LocalDemoModule {}
