import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import { MainnetPlatformsPrivacyInterceptor } from './mainnet-platforms-privacy.interceptor';

describe('MainnetPlatformsPrivacyInterceptor', () => {
  it('marks every successful directory response private before continuing', () => {
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
    const next: CallHandler = { handle: jest.fn(() => of(MAINNET_RESPONSE)) };

    const result = new MainnetPlatformsPrivacyInterceptor().intercept(context, next);

    expect(headers).toEqual({
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Origin',
    });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });
});

const MAINNET_RESPONSE = Object.freeze({ ok: true });
