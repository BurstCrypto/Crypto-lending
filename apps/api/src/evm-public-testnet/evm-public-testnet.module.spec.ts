import { MODULE_METADATA } from '@nestjs/common/constants';

import { LocalDemoModule } from '../local-demo/local-demo.module';
import { PUBLIC_TESTNET_EXECUTION_RPC } from '../public-testnet/public-testnet-execution.rpc';
import { PublicTestnetExecutionService } from '../public-testnet/public-testnet-execution.service';
import { EVM_PUBLIC_TESTNET_EXECUTION_CONFIG } from './evm-public-testnet.config';
import { EvmPublicTestnetController } from './evm-public-testnet.controller';
import { EvmPublicTestnetModule } from './evm-public-testnet.module';
import { EVM_PUBLIC_TESTNET_EXECUTION_RPC } from './evm-public-testnet.rpc';
import { EvmPublicTestnetExecutionService } from './evm-public-testnet.service';

describe('EvmPublicTestnetModule', () => {
  it('registers one isolated controller, service, config, and RPC provider', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      EvmPublicTestnetModule,
    ) as unknown[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      EvmPublicTestnetModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      EvmPublicTestnetModule,
    ) as unknown[];

    expect(imports).toContain(LocalDemoModule);
    expect(controllers).toEqual([EvmPublicTestnetController]);
    expect(providers).toContain(EvmPublicTestnetExecutionService);
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: EVM_PUBLIC_TESTNET_EXECUTION_CONFIG }),
        expect.objectContaining({ provide: EVM_PUBLIC_TESTNET_EXECUTION_RPC }),
      ]),
    );
  });

  it('cannot share the Solana RPC token or its stateful intent store', () => {
    expect(EVM_PUBLIC_TESTNET_EXECUTION_RPC).not.toBe(PUBLIC_TESTNET_EXECUTION_RPC);
    expect(EvmPublicTestnetExecutionService).not.toBe(PublicTestnetExecutionService);
  });
});
