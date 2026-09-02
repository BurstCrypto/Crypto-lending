import { MODULE_METADATA } from '@nestjs/common/constants';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';
import { MAINNET_PROVIDER_POSITION_READER } from './application/ports/mainnet-provider-position-reader.port';
import { MainnetPlatformsController } from './http/mainnet-platforms.controller';
import { MainnetPlatformsPrivacyInterceptor } from './http/mainnet-platforms-privacy.interceptor';
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

    expect(imports).toEqual([AccountsModule, AuthenticationModule]);
    expect(controllers).toEqual([MainnetPlatformsController]);
    expect(providers).toEqual([
      MainnetPlatformDirectoryService,
      MainnetPlatformsPrivacyInterceptor,
    ]);
    expect(providers).not.toContainEqual(
      expect.objectContaining({ provide: MAINNET_PROVIDER_POSITION_READER }),
    );
  });
});
