import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import {
  LocalDemoBodyError,
  LocalDemoPrivacyInterceptor,
  parseLocalDemoAllocationPreviewBody,
  parseLocalDemoConnectBody,
  parseLocalDemoDisconnectBody,
} from './local-demo-http';

describe('local demo HTTP boundary', () => {
  it.each(['MORE_LIQUID', 'BALANCED', 'MORE_YIELD'] as const)(
    'accepts only the %s allocation preset identifier',
    (presetId) => {
      expect(parseLocalDemoAllocationPreviewBody({ presetId })).toEqual({ presetId });
    },
  );

  it.each([
    {},
    { presetId: 'CUSTOM' },
    { presetId: 'BALANCED', amountUsdMinor: '1' },
    Object.assign(Object.create({ presetId: 'BALANCED' }), {}),
  ])('rejects malformed or caller-authored allocation preview input', (body) => {
    expect(() => parseLocalDemoAllocationPreviewBody(body)).toThrow(LocalDemoBodyError);
  });

  it.each(['EVM', 'SOLANA'] as const)('accepts the allowlisted %s candidate', (namespace) => {
    expect(parseLocalDemoConnectBody({ namespace })).toEqual({ namespace });
  });

  it.each([
    {},
    { namespace: 'eip155' },
    { namespace: 'EVM', address: '0x1234' },
    Object.assign(Object.create({ namespace: 'EVM' }), {}),
  ])('rejects malformed or caller-authored wallet material', (body) => {
    expect(() => parseLocalDemoConnectBody(body)).toThrow(LocalDemoBodyError);
  });

  it('accepts only a canonical connection identifier for disconnect', () => {
    expect(
      parseLocalDemoDisconnectBody({ connectionId: '11111111-1111-4111-8111-111111111111' }),
    ).toEqual({ connectionId: '11111111-1111-4111-8111-111111111111' });
    expect(() => parseLocalDemoDisconnectBody({ connectionId: '../wallet' })).toThrow(
      LocalDemoBodyError,
    );
  });

  it('marks every synthetic response private and non-cacheable', () => {
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ ok: true }) } as CallHandler;

    new LocalDemoPrivacyInterceptor().intercept(context, next);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    expect(setHeader).toHaveBeenCalledWith('Vary', 'Cookie, Origin');
    expect(setHeader).toHaveBeenCalledWith('X-Crypto-Lending-Demo-Mode', 'synthetic-local');
  });
});
