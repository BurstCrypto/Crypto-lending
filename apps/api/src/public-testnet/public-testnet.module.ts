import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { LocalDemoModule } from '../local-demo/local-demo.module';
import {
  PUBLIC_TESTNET_EXECUTION_CONFIG,
  loadPublicTestnetExecutionConfig,
  type PublicTestnetExecutionConfig,
} from './public-testnet-execution.config';
import { PublicTestnetExecutionController } from './public-testnet-execution.controller';
import { PublicTestnetPrivacyInterceptor } from './public-testnet-execution.http';
import {
  PUBLIC_TESTNET_EXECUTION_RPC,
  FixedSolanaDevnetExecutionRpc,
} from './public-testnet-execution.rpc';
import { PublicTestnetExecutionService } from './public-testnet-execution.service';
import { PublicTestnetWithdrawalController } from './public-testnet-withdrawal.controller';
import { PublicTestnetWithdrawalService } from './public-testnet-withdrawal.service';
import {
  LOCAL_DEMO_RUNTIME_CONFIG,
  type LocalDemoRuntimeConfig,
} from '../local-demo/local-demo-runtime.config';

@Module({
  imports: [AccountsModule, AuthenticationModule, LocalDemoModule],
  controllers: [PublicTestnetExecutionController, PublicTestnetWithdrawalController],
  providers: [
    {
      provide: PUBLIC_TESTNET_EXECUTION_CONFIG,
      inject: [LOCAL_DEMO_RUNTIME_CONFIG],
      useFactory: (localDemoConfig: LocalDemoRuntimeConfig) =>
        loadPublicTestnetExecutionConfig(process.env, localDemoConfig),
    },
    {
      provide: PUBLIC_TESTNET_EXECUTION_RPC,
      inject: [PUBLIC_TESTNET_EXECUTION_CONFIG],
      useFactory: (config: PublicTestnetExecutionConfig) =>
        new FixedSolanaDevnetExecutionRpc(config),
    },
    PublicTestnetExecutionService,
    PublicTestnetWithdrawalService,
    PublicTestnetPrivacyInterceptor,
  ],
})
export class PublicTestnetModule {}
