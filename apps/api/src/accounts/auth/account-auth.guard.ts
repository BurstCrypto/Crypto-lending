import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { parseAccountId } from '../domain/account-profile';
import { loggingContext } from '../../infrastructure/logging';
import {
  bindCurrentPrincipal,
  clearCurrentPrincipal,
  CURRENT_PRINCIPAL_RESOLVER,
  type CurrentPrincipal,
  type CurrentPrincipalResolver,
} from './current-principal';

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

function authenticationRequired(): UnauthorizedException {
  return new UnauthorizedException({
    error: 'Unauthorized',
    message: 'Authentication required',
    statusCode: HttpStatus.UNAUTHORIZED,
  });
}

function setAuthenticationFailureHeaders(response: unknown): void {
  if (
    typeof response === 'object' &&
    response !== null &&
    'setHeader' in response &&
    typeof response.setHeader === 'function'
  ) {
    const writer = response as HeaderWriter;
    writer.setHeader('WWW-Authenticate', 'Bearer');
    writer.setHeader('Cache-Control', 'private, no-store');
    writer.setHeader('Vary', 'Authorization');
  }
}

@Injectable()
export class AccountAuthGuard implements CanActivate {
  constructor(
    @Inject(CURRENT_PRINCIPAL_RESOLVER)
    private readonly resolver: CurrentPrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<unknown>();
    let resolved: CurrentPrincipal | null;

    clearCurrentPrincipal(request);
    try {
      resolved = await this.resolver.resolve(request);
      if (!resolved) {
        throw authenticationRequired();
      }
      const principal: CurrentPrincipal = Object.freeze({
        accountId: parseAccountId(resolved.accountId),
      });
      bindCurrentPrincipal(request, principal);
      loggingContext.bindActorId(principal.accountId);
    } catch {
      clearCurrentPrincipal(request);
      loggingContext.clearActorId();
      setAuthenticationFailureHeaders(http.getResponse<unknown>());
      throw authenticationRequired();
    }

    return true;
  }
}
