import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { PostgresModule } from '../infrastructure/database/postgres.module';
import { WALLET_REGISTRATION_REPOSITORY } from './application/ports/wallet-registration-repository.port';
import {
  SYSTEM_WALLET_REGISTRATION_CLOCK,
  WALLET_REGISTRATION_CLOCK,
  WalletRegistrationService,
} from './application/wallet-registration.service';
import { WalletRegistrationController } from './http/wallet-registration.controller';
import { WalletRegistrationPrivacyInterceptor } from './http/wallet-registration-privacy.interceptor';
import {
  WALLET_REGISTRATION_CONFIG,
  loadWalletRegistrationConfig,
} from './infrastructure/config/wallet-registration.config';
import { PostgresWalletRegistrationRepository } from './infrastructure/postgres/postgres-wallet-registration.repository';

@Module({
  imports: [AccountsModule, AuthenticationModule, PostgresModule],
  controllers: [WalletRegistrationController],
  providers: [
    { provide: WALLET_REGISTRATION_CONFIG, useFactory: loadWalletRegistrationConfig },
    {
      provide: WALLET_REGISTRATION_CLOCK,
      useValue: SYSTEM_WALLET_REGISTRATION_CLOCK,
    },
    PostgresWalletRegistrationRepository,
    {
      provide: WALLET_REGISTRATION_REPOSITORY,
      useExisting: PostgresWalletRegistrationRepository,
    },
    WalletRegistrationService,
    WalletRegistrationPrivacyInterceptor,
  ],
  exports: [WalletRegistrationService],
})
export class WalletsModule {}
