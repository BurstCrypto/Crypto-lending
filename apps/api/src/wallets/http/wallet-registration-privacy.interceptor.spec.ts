import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { WalletRegistrationPrivacyInterceptor } from './wallet-registration-privacy.interceptor';

describe('WalletRegistrationPrivacyInterceptor', () => {
  it('marks every wallet response private and origin/cookie variant before continuing', () => {
    const headers: Record<string, string> = {};
    const response = {
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
      }),
    };
    const context = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: jest.fn(() => of({ ok: true })) };

    const result = new WalletRegistrationPrivacyInterceptor().intercept(context, next);

    expect(headers).toEqual({
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Origin',
    });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });
});
