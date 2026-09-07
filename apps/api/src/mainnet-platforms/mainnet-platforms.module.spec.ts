import { MODULE_METADATA } from '@nestjs/common/constants';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';
import { MAINNET_PROVIDER_POSITION_READER } from './application/ports/mainnet-provider-position-reader.port';
import { MainnetPlatformsController } from './http/mainnet-platforms.controller';
import { MainnetPlatformsPrivacyInterceptor } from './http/mainnet-platforms-privacy.interceptor';
import { ProviderPositionReadRuntimeRegistration } from './infrastructure/provider-position-read-runtime.registration';
import { MainnetPlatformsModule } from './mainnet-platforms.module';

describe('MainnetPlatformsModule', () => {
  it('uses only the production account boundary and its isolated read-only providers', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      MainnetPlatformsModule,
    ) as unknown[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      MainnetPlatformsModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      MainnetPlatformsModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      MainnetPlatformsModule,
    ) as unknown[];

    expect(imports).toEqual([AccountsModule, AuthenticationModule]);
    expect(controllers).toEqual([MainnetPlatformsController]);
    expect(providers.slice(0, 3)).toEqual([
      MainnetPlatformDirectoryService,
      MainnetPlatformsPrivacyInterceptor,
      ProviderPositionReadRuntimeRegistration,
    ]);
    expect(providers[3]).toEqual(
      expect.objectContaining({
        provide: MAINNET_PROVIDER_POSITION_READER,
        inject: [ProviderPositionReadRuntimeRegistration],
        useFactory: expect.any(Function),
      }),
    );
    expect(exports).toEqual([MainnetPlatformDirectoryService, MAINNET_PROVIDER_POSITION_READER]);

    const readerProvider = providers[3] as {
      useFactory: (
        registration: ProviderPositionReadRuntimeRegistration,
      ) => ProviderPositionReadRuntimeRegistration['reader'];
    };
    const registration = new ProviderPositionReadRuntimeRegistration();
    expect(readerProvider.useFactory(registration)).toBe(registration.reader);
  });
});
