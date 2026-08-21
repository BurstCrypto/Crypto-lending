import { HttpStatus, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { parseAccountId, type AccountId } from '../domain/account-profile';
import { loggingContext } from '../../infrastructure/logging';
import { AccountAuthGuard } from './account-auth.guard';
import {
  DENY_ALL_CURRENT_PRINCIPAL_RESOLVER,
  readCurrentPrincipal,
  type CurrentPrincipalResolver,
} from './current-principal';
import { requireCurrentPrincipal } from './current-principal.decorator';

const ACCOUNT_ID = parseAccountId('0f27af0b-48b2-4f1b-b3d4-cd531a0b4458');
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';

function httpContext(
  request: unknown,
  responseHeaders: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          responseHeaders[name] = value;
        },
      }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('AccountAuthGuard', () => {
  it('binds only the validated principal returned by the configured resolver', async () => {
    const request = { headers: { 'x-account-id': 'attacker-controlled' } };
    const resolver: CurrentPrincipalResolver = {
      resolve: jest.fn().mockResolvedValue({ accountId: ACCOUNT_ID, ignored: 'not-bound' }),
    };
    const guard = new AccountAuthGuard(resolver);

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    const principal = readCurrentPrincipal(request);
    expect(principal).toEqual({ accountId: ACCOUNT_ID });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(requireCurrentPrincipal(httpContext(request))).toBe(principal);
  });

  it('binds only the verified principal as the correlated initiating actor', async () => {
    const guard = new AccountAuthGuard({ resolve: () => ({ accountId: ACCOUNT_ID }) });

    await loggingContext.run({ correlationId: REQUEST_ID }, async () => {
      await expect(
        guard.canActivate(
          httpContext({ headers: { 'x-account-id': 'attacker-controlled-actor' } }),
        ),
      ).resolves.toBe(true);
      expect(loggingContext.requireCurrent()).toEqual({
        correlationId: REQUEST_ID,
        initiatorActorId: ACCOUNT_ID,
      });
    });
  });

  it.each([
    DENY_ALL_CURRENT_PRINCIPAL_RESOLVER,
    { resolve: () => null },
    { resolve: () => ({ accountId: 'not-a-valid-account-id' as AccountId }) },
    {
      resolve: () => {
        throw new Error('resolver details must not escape');
      },
    },
  ] satisfies CurrentPrincipalResolver[])(
    'fails closed with generic bearer semantics',
    async (resolver) => {
      const headers: Record<string, string> = {};
      const guard = new AccountAuthGuard(resolver);

      let captured: unknown;
      try {
        await guard.canActivate(httpContext({ headers: { 'x-account-id': ACCOUNT_ID } }, headers));
      } catch (error) {
        captured = error;
      }

      expect(captured).toBeInstanceOf(UnauthorizedException);
      expect((captured as UnauthorizedException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect((captured as UnauthorizedException).getResponse()).toEqual({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
      expect(JSON.stringify((captured as UnauthorizedException).getResponse())).not.toContain(
        ACCOUNT_ID,
      );
      expect(headers).toEqual({
        'Cache-Control': 'private, no-store',
        Vary: 'Authorization',
        'WWW-Authenticate': 'Bearer',
      });
    },
  );

  it('does not allow the parameter decorator to operate without the guard binding', () => {
    expect(() => requireCurrentPrincipal(httpContext({}))).toThrow(UnauthorizedException);
  });

  it('clears a prior binding before a repeated resolution fails closed', async () => {
    const request = {};
    await new AccountAuthGuard({ resolve: () => ({ accountId: ACCOUNT_ID }) }).canActivate(
      httpContext(request),
    );
    expect(readCurrentPrincipal(request)).toEqual({ accountId: ACCOUNT_ID });

    await expect(
      new AccountAuthGuard(DENY_ALL_CURRENT_PRINCIPAL_RESOLVER).canActivate(httpContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(readCurrentPrincipal(request)).toBeUndefined();
  });
});
