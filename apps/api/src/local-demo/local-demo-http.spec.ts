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
      expect(
        parseLocalDemoAllocationPreviewBody({ selection: { kind: 'PRESET', presetId } }),
      ).toEqual({ selection: { kind: 'PRESET', presetId } });
    },
  );

  it('accepts and defensively freezes the complete bounded custom filter contract', () => {
    const result = parseLocalDemoAllocationPreviewBody({
      selection: {
        kind: 'CUSTOM',
        liquidReserveBasisPoints: 2_500,
        filters: {
          assetSymbols: ['USDC', 'USDT'],
          providerIds: ['MORPHO'],
          networkIds: ['eip155:1', 'eip155:8453'],
          minimumApyBasisPoints: 300,
          minimumTvlUsdMinor: '100000000',
          minimumExitLiquidityUsdMinor: '50000000',
          maximumUtilizationBasisPoints: 9_500,
        },
      },
    });

    expect(result).toEqual({
      selection: {
        kind: 'CUSTOM',
        liquidReserveBasisPoints: 2_500,
        filters: {
          assetSymbols: ['USDC', 'USDT'],
          providerIds: ['MORPHO'],
          networkIds: ['eip155:1', 'eip155:8453'],
          minimumApyBasisPoints: 300,
          minimumTvlUsdMinor: '100000000',
          minimumExitLiquidityUsdMinor: '50000000',
          maximumUtilizationBasisPoints: 9_500,
        },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selection)).toBe(true);
    if (result.selection.kind !== 'CUSTOM') throw new Error('Expected custom selection');
    expect(Object.isFrozen(result.selection.filters)).toBe(true);
    expect(Object.isFrozen(result.selection.filters.assetSymbols)).toBe(true);
  });

  it('accepts a 99% reserve and rejects values that leave less than 1% for yield', () => {
    const body = {
      selection: {
        kind: 'CUSTOM',
        liquidReserveBasisPoints: 9_900,
        filters: {
          assetSymbols: ['USDC'],
          providerIds: ['MORPHO'],
          networkIds: ['eip155:1'],
          minimumApyBasisPoints: 0,
          minimumTvlUsdMinor: '0',
          minimumExitLiquidityUsdMinor: '0',
          maximumUtilizationBasisPoints: 10_000,
        },
      },
    };

    expect(parseLocalDemoAllocationPreviewBody(body).selection).toMatchObject({
      kind: 'CUSTOM',
      liquidReserveBasisPoints: 9_900,
    });
    for (const liquidReserveBasisPoints of [9_901, 10_000]) {
      expect(() =>
        parseLocalDemoAllocationPreviewBody({
          selection: { ...body.selection, liquidReserveBasisPoints },
        }),
      ).toThrow(LocalDemoBodyError);
    }
  });

  it.each([
    {},
    { presetId: 'BALANCED' },
    { selection: { kind: 'PRESET', presetId: 'CUSTOM' } },
    { selection: { kind: 'PRESET', presetId: 'BALANCED', amountUsdMinor: '1' } },
    { selection: { kind: 'PRESET', presetId: 'BALANCED' }, accountId: 'caller' },
    {
      selection: {
        kind: 'CUSTOM',
        liquidReserveBasisPoints: 2_500,
        filters: {
          assetSymbols: ['USDC'],
          providerIds: ['MORPHO'],
          networkIds: ['eip155:1'],
          minimumApyBasisPoints: 300,
          minimumTvlUsdMinor: '0',
          minimumExitLiquidityUsdMinor: '0',
          maximumUtilizationBasisPoints: 9_500,
          callerApyBasisPoints: 900,
        },
      },
    },
    Object.assign(Object.create({ selection: { kind: 'PRESET', presetId: 'BALANCED' } }), {}),
  ])('rejects malformed or caller-authored allocation preview input', (body) => {
    expect(() => parseLocalDemoAllocationPreviewBody(body)).toThrow(LocalDemoBodyError);
  });

  it.each([
    { field: 'assetSymbols', value: [] },
    { field: 'assetSymbols', value: ['USDC', 'USDC'] },
    { field: 'assetSymbols', value: ['DAI'] },
    { field: 'providerIds', value: [] },
    { field: 'providerIds', value: ['AAVE'] },
    { field: 'networkIds', value: ['eip155:11155111'] },
    { field: 'minimumApyBasisPoints', value: -1 },
    { field: 'minimumApyBasisPoints', value: 10_001 },
    { field: 'minimumApyBasisPoints', value: 1.5 },
    { field: 'minimumTvlUsdMinor', value: '01' },
    { field: 'minimumTvlUsdMinor', value: '1000000000000000000' },
    { field: 'minimumExitLiquidityUsdMinor', value: '-1' },
    { field: 'maximumUtilizationBasisPoints', value: 10_001 },
  ] as const)('rejects an invalid custom $field constraint', ({ field, value }) => {
    const filters: Record<string, unknown> = {
      assetSymbols: ['USDC'],
      providerIds: ['MORPHO'],
      networkIds: ['eip155:1'],
      minimumApyBasisPoints: 0,
      minimumTvlUsdMinor: '0',
      minimumExitLiquidityUsdMinor: '0',
      maximumUtilizationBasisPoints: 10_000,
    };
    filters[field] = value;
    expect(() =>
      parseLocalDemoAllocationPreviewBody({
        selection: { kind: 'CUSTOM', liquidReserveBasisPoints: 2_500, filters },
      }),
    ).toThrow(LocalDemoBodyError);
  });

  it('never evaluates accessors in the allocation request graph', () => {
    let invoked = false;
    const selection = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(selection, 'kind', {
      enumerable: true,
      get: () => {
        invoked = true;
        return 'PRESET';
      },
    });
    selection.presetId = 'BALANCED';

    expect(() => parseLocalDemoAllocationPreviewBody({ selection })).toThrow(LocalDemoBodyError);
    expect(invoked).toBe(false);
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
