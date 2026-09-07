import { Injectable } from '@nestjs/common';

import type {
  CurrentPrincipal,
  CurrentPrincipalResolver,
} from '../../accounts/auth/current-principal';
import { AuthenticationRateLimitedError } from '../application/authentication.errors';
import { AuthenticationService } from '../application/authentication.service';
import {
  AuthenticationClientAddressResolver,
  type AuthenticationClientAddressRequest,
} from '../http/authentication-client-address';
import { SessionResolutionAdmission } from './session-resolution-admission';

@Injectable()
export class SessionCurrentPrincipalResolver implements CurrentPrincipalResolver {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly clientAddresses: AuthenticationClientAddressResolver,
    private readonly admission: SessionResolutionAdmission,
  ) {}

  async resolve(request: unknown): Promise<CurrentPrincipal | null> {
    const sourceAddress = this.clientAddresses.resolve(
      request as AuthenticationClientAddressRequest,
    );
    const decision = this.admission.tryAcquire(sourceAddress);
    if (!decision.admitted) {
      throw new AuthenticationRateLimitedError(decision.retryAfterSeconds);
    }
    try {
      return await this.authentication.resolve(
        request as Parameters<AuthenticationService['resolve']>[0],
      );
    } finally {
      decision.lease.release();
    }
  }
}
