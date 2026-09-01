import { MODULE_METADATA } from '@nestjs/common/constants';

import { PublicTestnetExecutionController } from './public-testnet-execution.controller';
import { PublicTestnetExecutionService } from './public-testnet-execution.service';
import { PublicTestnetModule } from './public-testnet.module';
import { PublicTestnetWithdrawalController } from './public-testnet-withdrawal.controller';
import { PublicTestnetWithdrawalService } from './public-testnet-withdrawal.service';

describe('PublicTestnetModule', () => {
  it('registers isolated deposit and withdrawal controllers and stateful services', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PublicTestnetModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      PublicTestnetModule,
    ) as unknown[];

    expect(controllers).toEqual([
      PublicTestnetExecutionController,
      PublicTestnetWithdrawalController,
    ]);
    expect(providers).toContain(PublicTestnetExecutionService);
    expect(providers).toContain(PublicTestnetWithdrawalService);
    expect(PublicTestnetWithdrawalService).not.toBe(PublicTestnetExecutionService);
  });
});
