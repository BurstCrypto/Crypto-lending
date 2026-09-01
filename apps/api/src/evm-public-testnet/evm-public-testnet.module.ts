import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { LocalDemoModule } from '../local-demo/local-demo.module';
import {
  LOCAL_DEMO_RUNTIME_CONFIG,
  type LocalDemoRuntimeConfig,
} from '../local-demo/local-demo-runtime.config';
import { PublicTestnetPrivacyInterceptor } from '../public-testnet/public-testnet-execution.http';
import {
  EVM_PUBLIC_TESTNET_EXECUTION_CONFIG,
  loadEvmPublicTestnetExecutionConfig,
  type EvmPublicTestnetExecutionConfig,
} from './evm-public-testnet.config';
import { EvmPublicTestnetController } from './evm-public-testnet.controller';
import {
  EVM_PUBLIC_TESTNET_EXECUTION_RPC,
  EVM_PUBLIC_TESTNET_WITHDRAWAL_RPC,
  FixedBaseSepoliaExecutionRpc,
} from './evm-public-testnet.rpc';
import { EvmPublicTestnetExecutionService } from './evm-public-testnet.service';
import { EvmPublicTestnetWithdrawalService } from './evm-public-testnet-withdrawal.service';

@Module({
  imports: [AccountsModule, AuthenticationModule, LocalDemoModule],
  controllers: [EvmPublicTestnetController],
  providers: [
    {
      provide: EVM_PUBLIC_TESTNET_EXECUTION_CONFIG,
      inject: [LOCAL_DEMO_RUNTIME_CONFIG],
      useFactory: (localDemoConfig: LocalDemoRuntimeConfig) =>
        loadEvmPublicTestnetExecutionConfig(process.env, localDemoConfig),
    },
    {
      provide: EVM_PUBLIC_TESTNET_EXECUTION_RPC,
      inject: [EVM_PUBLIC_TESTNET_EXECUTION_CONFIG],
      useFactory: (config: EvmPublicTestnetExecutionConfig) =>
        new FixedBaseSepoliaExecutionRpc(config),
    },
    {
      provide: EVM_PUBLIC_TESTNET_WITHDRAWAL_RPC,
      useExisting: EVM_PUBLIC_TESTNET_EXECUTION_RPC,
    },
    EvmPublicTestnetExecutionService,
    EvmPublicTestnetWithdrawalService,
    PublicTestnetPrivacyInterceptor,
  ],
})
export class EvmPublicTestnetModule {}
