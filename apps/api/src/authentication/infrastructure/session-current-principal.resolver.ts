import { Injectable } from '@nestjs/common';

import type {
  CurrentPrincipal,
  CurrentPrincipalResolver,
} from '../../accounts/auth/current-principal';
import { AuthenticationService } from '../application/authentication.service';

@Injectable()
export class SessionCurrentPrincipalResolver implements CurrentPrincipalResolver {
  constructor(private readonly authentication: AuthenticationService) {}

  resolve(request: unknown): Promise<CurrentPrincipal | null> {
    return this.authentication.resolve(request as Parameters<AuthenticationService['resolve']>[0]);
  }
}
