import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { VersionController } from './version.controller';

@Module({
  controllers: [HealthController, VersionController],
})
export class SystemModule {}
