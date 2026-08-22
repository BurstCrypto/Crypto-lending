import { Module } from '@nestjs/common';

import { CURRENT_PRINCIPAL_RESOLVER } from '../accounts/auth/current-principal';
import { PostgresModule } from '../infrastructure/database/postgres.module';
import { AuthenticationService } from './application/authentication.service';
import { AUTHENTICATION_RATE_LIMITER } from './application/ports/authentication-rate-limiter.port';
import { AUTHENTICATION_REPOSITORY } from './application/ports/authentication-repository.port';
import { OIDC_CLIENT } from './application/ports/oidc-client.port';
import { AuthenticationController } from './http/authentication.controller';
import { AuthenticationClientAddressResolver } from './http/authentication-client-address';
import {
  AUTHENTICATION_CLIENT_ADDRESS_CONFIG,
  loadAuthenticationClientAddressConfig,
} from './infrastructure/config/authentication-client-address.config';
import { AUTHENTICATION_CONFIG } from './infrastructure/config/authentication-config.provider';
import { loadAuthenticationConfig } from './infrastructure/config/authentication.config';
import { ManagedOidcClient } from './infrastructure/oidc/managed-oidc.client';
import { PostgresAuthenticationRateLimiter } from './infrastructure/postgres/postgres-authentication-rate-limiter';
import { PostgresAuthenticationRepository } from './infrastructure/postgres/postgres-authentication.repository';
import { SessionCurrentPrincipalResolver } from './infrastructure/session-current-principal.resolver';

@Module({
  imports: [PostgresModule],
  controllers: [AuthenticationController],
  providers: [
    { provide: AUTHENTICATION_CONFIG, useFactory: loadAuthenticationConfig },
    {
      provide: AUTHENTICATION_CLIENT_ADDRESS_CONFIG,
      useFactory: loadAuthenticationClientAddressConfig,
    },
    AuthenticationClientAddressResolver,
    PostgresAuthenticationRepository,
    { provide: AUTHENTICATION_REPOSITORY, useExisting: PostgresAuthenticationRepository },
    PostgresAuthenticationRateLimiter,
    { provide: AUTHENTICATION_RATE_LIMITER, useExisting: PostgresAuthenticationRateLimiter },
    {
      provide: OIDC_CLIENT,
      inject: [AUTHENTICATION_CONFIG],
      useFactory: (
        config: ReturnType<typeof loadAuthenticationConfig>,
      ): ManagedOidcClient | null =>
        config.mode === 'oidc' ? new ManagedOidcClient(config) : null,
    },
    AuthenticationService,
    SessionCurrentPrincipalResolver,
    { provide: CURRENT_PRINCIPAL_RESOLVER, useExisting: SessionCurrentPrincipalResolver },
  ],
  exports: [AuthenticationService, CURRENT_PRINCIPAL_RESOLVER],
})
export class AuthenticationModule {}
