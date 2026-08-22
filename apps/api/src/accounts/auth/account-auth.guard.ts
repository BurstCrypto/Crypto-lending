import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { parseAccountId } from '../domain/account-profile';
import {
  AuthenticationRateLimitedError,
  AuthenticationUnavailableError,
} from '../../authentication/application/authentication.errors';
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

function setAuthenticationFailureHeaders(response: unknown, retryAfterSeconds?: number): void {
  if (
    typeof response === 'object' &&
    response !== null &&
    'setHeader' in response &&
    typeof response.setHeader === 'function'
  ) {
    const writer = response as HeaderWriter;
    writer.setHeader('Cache-Control', 'private, no-store');
    writer.setHeader('Vary', 'Cookie, Origin');
    if (retryAfterSeconds !== undefined) {
      writer.setHeader('Retry-After', String(retryAfterSeconds));
    }
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
    } catch (error) {
      clearCurrentPrincipal(request);
      loggingContext.clearActorId();
      if (error instanceof AuthenticationRateLimitedError) {
        setAuthenticationFailureHeaders(http.getResponse<unknown>(), error.retryAfterSeconds);
        throw new HttpException('Authentication request rejected', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (error instanceof AuthenticationUnavailableError) {
        setAuthenticationFailureHeaders(http.getResponse<unknown>(), 1);
        throw new HttpException('Authentication unavailable', HttpStatus.SERVICE_UNAVAILABLE);
      }
      setAuthenticationFailureHeaders(http.getResponse<unknown>());
      throw authenticationRequired();
    }

    return true;
  }
}
