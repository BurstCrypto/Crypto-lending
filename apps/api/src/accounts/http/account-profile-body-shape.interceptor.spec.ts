import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';

import { AccountProfileBodyShapeInterceptor } from './account-profile-body-shape.interceptor';

function context(body: unknown, method = 'PATCH'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ body, method }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of('ok') };

describe('AccountProfileBodyShapeInterceptor', () => {
  const interceptor = new AccountProfileBodyShapeInterceptor();

  it('permits only a non-empty plain record of profile fields', () => {
    expect(
      interceptor.intercept(context({ contactEmail: 'user@example.com' }), next),
    ).toBeDefined();
    expect(interceptor.intercept(context(undefined, 'GET'), next)).toBeDefined();
  });

  it.each([
    undefined,
    null,
    [],
    'contactEmail=user@example.com',
    {},
    { accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    JSON.parse('{"__proto__":{"polluted":true},"contactEmail":"safe@example.com"}'),
    { constructor: { prototype: { polluted: true } }, contactEmail: 'safe@example.com' },
    Object.assign(Object.create({ contactEmail: 'inherited@example.com' }) as object, {
      contactPhone: '+13035550123',
    }),
  ])('rejects a dangerous or non-allowlisted raw body', (body) => {
    expect(() => interceptor.intercept(context(body), next)).toThrow(BadRequestException);
  });
});
