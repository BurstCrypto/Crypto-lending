import { Module } from '@nestjs/common';

import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [InfrastructureModule, SystemModule],
})
export class AppModule {}
