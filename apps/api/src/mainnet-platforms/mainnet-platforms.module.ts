import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';
import { MainnetPlatformsController } from './http/mainnet-platforms.controller';
import { MainnetPlatformsPrivacyInterceptor } from './http/mainnet-platforms-privacy.interceptor';

@Module({
  imports: [AccountsModule, AuthenticationModule],
  controllers: [MainnetPlatformsController],
  providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],
  exports: [MainnetPlatformDirectoryService],
})
export class MainnetPlatformsModule {}
