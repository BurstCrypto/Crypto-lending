import { MODULE_METADATA } from '@nestjs/common/constants';

import {
  DormantBalanceSyncConsumerRuntimeModule,
  startBalanceSyncConsumerRuntime,
} from './balance-sync-consumer.runtime';

describe('dormant balance sync consumer runtime', () => {
  it('has no imports, providers, controllers, or exports', () => {
    for (const metadataKey of [
      MODULE_METADATA.IMPORTS,
      MODULE_METADATA.PROVIDERS,
      MODULE_METADATA.CONTROLLERS,
      MODULE_METADATA.EXPORTS,
    ]) {
      const metadata = Reflect.getMetadata(metadataKey, DormantBalanceSyncConsumerRuntimeModule) as
        readonly unknown[] | undefined;

      expect(metadata ?? []).toEqual([]);
    }
  });

  it('rejects with the fixed not-composed error without starting a runtime', async () => {
    await expect(startBalanceSyncConsumerRuntime({} as never)).rejects.toEqual(
      new Error('BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED'),
    );
  });
});
