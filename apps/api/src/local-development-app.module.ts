import { Module } from '@nestjs/common';

import { AppModule } from './app.module';
import { EvmPublicTestnetModule } from './evm-public-testnet/evm-public-testnet.module';
import { LocalDemoModule } from './local-demo/local-demo.module';
import { PublicTestnetModule } from './public-testnet/public-testnet.module';

/** Development/test root; never imported by the production-safe root module. */
@Module({
  imports: [AppModule, LocalDemoModule, PublicTestnetModule, EvmPublicTestnetModule],
})
export class LocalDevelopmentAppModule {}
