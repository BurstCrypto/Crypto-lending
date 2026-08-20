import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import {
  readCurrentPrincipal,
  type CurrentPrincipal as AuthenticatedPrincipal,
} from './current-principal';

export function requireCurrentPrincipal(context: ExecutionContext): AuthenticatedPrincipal {
  const principal = readCurrentPrincipal(context.switchToHttp().getRequest<unknown>());
  if (!principal) {
    throw new UnauthorizedException('Authentication required');
  }
  return principal;
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal =>
    requireCurrentPrincipal(context),
);
