import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';
import { MAINNET_PROVIDER_POSITION_READER } from './application/ports/mainnet-provider-position-reader.port';
import { MainnetPlatformsController } from './http/mainnet-platforms.controller';
import { MainnetPlatformsPrivacyInterceptor } from './http/mainnet-platforms-privacy.interceptor';
import { ProviderPositionReadRuntimeRegistration } from './infrastructure/provider-position-read-runtime.registration';

@Module({
  imports: [AccountsModule, AuthenticationModule],
  controllers: [MainnetPlatformsController],
  providers: [
    MainnetPlatformDirectoryService,
    MainnetPlatformsPrivacyInterceptor,
    ProviderPositionReadRuntimeRegistration,
    {
      provide: MAINNET_PROVIDER_POSITION_READER,
      inject: [ProviderPositionReadRuntimeRegistration],
      useFactory: (registration: ProviderPositionReadRuntimeRegistration) => registration.reader,
    },
  ],
  exports: [MainnetPlatformDirectoryService, MAINNET_PROVIDER_POSITION_READER],
})
export class MainnetPlatformsModule {}
