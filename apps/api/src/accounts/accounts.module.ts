import { Module } from '@nestjs/common';

import { ACCOUNT_PROFILE_REPOSITORY } from './application/account-profile.repository.port';
import { AccountProfileService } from './application/account-profile.service';
import { AccountAuthGuard } from './auth/account-auth.guard';
import { AccountProfileBodyShapeInterceptor } from './http/account-profile-body-shape.interceptor';
import { AccountProfileController } from './http/account-profile.controller';
import { AccountProfilePrivacyInterceptor } from './http/account-profile-privacy.interceptor';
import { PostgresAccountProfileRepository } from './infrastructure/postgres-account-profile.repository';
import { AuthenticationModule } from '../authentication/authentication.module';
import { PostgresModule } from '../infrastructure/database/postgres.module';

@Module({
  imports: [PostgresModule, AuthenticationModule],
  controllers: [AccountProfileController],
  providers: [
    AccountProfileService,
    AccountAuthGuard,
    AccountProfileBodyShapeInterceptor,
    AccountProfilePrivacyInterceptor,
    PostgresAccountProfileRepository,
    {
      provide: ACCOUNT_PROFILE_REPOSITORY,
      useExisting: PostgresAccountProfileRepository,
    },
  ],
  exports: [AccountProfileService],
})
export class AccountsModule {}
