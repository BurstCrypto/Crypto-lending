import { Global, Module } from '@nestjs/common';

import { loadInfrastructureConfig } from './infrastructure.config';

export const INFRASTRUCTURE_CONFIG = Symbol('INFRASTRUCTURE_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: INFRASTRUCTURE_CONFIG,
      useFactory: loadInfrastructureConfig,
    },
  ],
  exports: [INFRASTRUCTURE_CONFIG],
})
export class InfrastructureConfigModule {}
