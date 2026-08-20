import { Module } from '@nestjs/common';

import { AccountsModule } from './accounts/accounts.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [InfrastructureModule, AccountsModule, SystemModule],
})
export class AppModule {}
