import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

import {
  LOCAL_DEMO_ALLOCATION_PREVIEW_BODY_SCHEMA,
  LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA,
  LOCAL_DEMO_YIELD_CATALOG_RESPONSE_SCHEMA,
  LocalDemoBodyError,
  LocalDemoPrivacyInterceptor,
  parseLocalDemoAllocationPreviewBody,
  parseLocalDemoConnectBody,
  parseLocalDemoDisconnectBody,
} from './local-demo-http';

describe('local demo HTTP boundary', () => {
  const portfolioSnapshotId = 'local-demo-portfolio:0123456789abcdef0123456789abcdef';

  it.each(['MORE_LIQUID', 'BALANCED', 'MORE_YIELD'] as const)(
    'accepts only the %s allocation preset identifier',
    (presetId) => {
      const result = parseLocalDemoAllocationPreviewBody({
        portfolioSnapshotId,
        selection: { kind: 'PRESET', presetId },
      });

      expect(result).toEqual({ portfolioSnapshotId, selection: { kind: 'PRESET', presetId } });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.selection)).toBe(true);
    },
  );

  it.each([
    {},
    { presetId: 'BALANCED' },
    { selection: { kind: 'PRESET', presetId: 'CUSTOM' } },
    { selection: { kind: 'CUSTOM', presetId: 'BALANCED' } },
    {
      selection: {
        kind: 'CUSTOM',
        liquidReserveBasisPoints: 2_500,
        filters: { providerIds: ['MORPHO'], networkIds: ['eip155:1'] },
      },
    },
    { selection: { kind: 'PRESET', presetId: 'BALANCED', amountUsdMinor: '1' } },
    { selection: { kind: 'PRESET', presetId: 'BALANCED', modeledCostUsdMinor: '1' } },
    { selection: { kind: 'PRESET', presetId: 'BALANCED' }, accountId: 'caller' },
    {
      portfolioSnapshotId: 'local-demo-portfolio:../stale',
      selection: { kind: 'PRESET', presetId: 'BALANCED' },
    },
    Object.assign(Object.create({ selection: { kind: 'PRESET', presetId: 'BALANCED' } }), {}),
  ])('rejects malformed, custom, or caller-authored allocation input', (body) => {
    expect(() => parseLocalDemoAllocationPreviewBody(body)).toThrow(LocalDemoBodyError);
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

    expect(() => parseLocalDemoAllocationPreviewBody({ portfolioSnapshotId, selection })).toThrow(
      LocalDemoBodyError,
    );
    expect(invoked).toBe(false);
  });

  it('publishes preset-only request and provider-private aggregate response schemas', () => {
    expect(LOCAL_DEMO_ALLOCATION_PREVIEW_BODY_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['portfolioSnapshotId', 'selection'],
      properties: {
        selection: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'presetId'],
          properties: {
            kind: { type: 'string', enum: ['PRESET'] },
            presetId: {
              type: 'string',
              enum: ['MORE_LIQUID', 'BALANCED', 'MORE_YIELD'],
            },
          },
        },
      },
    });
    expect(LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining([
        'rateSnapshot',
        'portfolioSnapshotId',
        'sourceCapitalByEcosystem',
        'allocations',
        'managedYieldComposition',
        'compositionSummary',
        'executionCost',
        'capitalIncludedInProjectionUsdMinor',
        'yieldProjection',
      ]),
      properties: {
        executionCost: {
          additionalProperties: false,
          required: ['actualLocalOperation', 'modeledScenario', 'publicExecution'],
          properties: {
            actualLocalOperation: {
              properties: {
                status: { type: 'string', enum: ['NO_EXECUTION'] },
                amountUsdMinor: { type: 'string', enum: ['0'] },
              },
            },
            modeledScenario: {
              properties: {
                modelId: { type: 'string', enum: ['LOCAL_DEMO_ALLOCATION_COST_V2'] },
                isQuote: { type: 'boolean', enum: [false] },
                totalUsdMinor: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
              },
            },
            publicExecution: {
              properties: {
                status: { type: 'string', enum: ['UNQUOTED'] },
                amountUsdMinor: { type: 'string', nullable: true, enum: [null] },
              },
            },
          },
        },
        yieldProjection: {
          properties: {
            firstPositiveDayAfterFees: {
              properties: {
                calculationMethod: {
                  type: 'string',
                  enum: ['FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES'],
                },
                modelHorizonDays: { type: 'integer', enum: [365] },
              },
            },
          },
        },
      },
    });

    const publicSchemas = JSON.stringify([
      LOCAL_DEMO_YIELD_CATALOG_RESPONSE_SCHEMA,
      LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA,
    ]);
    for (const component of [
      'NETWORK',
      'CONVERSION',
      'CROSS_ECOSYSTEM_TRANSFER',
      'MARKET_IMPACT',
      'ROUTING',
    ]) {
      expect(publicSchemas).toContain(`"${component}"`);
    }
    for (const forbidden of [
      'MORPHO',
      'eip155:',
      '"provider"',
      '"protocol"',
      '"marketId"',
      '"opportunity"',
      '"opportunities"',
      '"sourceReference"',
      '"payloadSha256"',
      '"normalizerId"',
    ]) {
      expect(publicSchemas).not.toContain(forbidden);
    }
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
