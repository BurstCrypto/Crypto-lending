import { parseAccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  LocalDemoAllocationService,
  type LocalDemoAllocationPresetId,
  type LocalDemoAllocationPreviewResponse,
  type LocalDemoAllocationSelection,
} from './local-demo-allocation.service';
import { LocalDemoYieldCatalogService } from './local-demo-yield-catalog.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CORRELATION: JobCorrelationContext = Object.freeze({
  correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  initiatorActorId: ACCOUNT_ID,
});
const AS_OF = '2026-08-24T18:30:00.000Z';
const SNAPSHOT_TIME = new Date('2026-08-26T15:00:00.000Z');

function preset(presetId: LocalDemoAllocationPresetId): LocalDemoAllocationSelection {
  return Object.freeze({ kind: 'PRESET', presetId });
}

function fixture(
  grossCapitalUsdMinor = '700000',
  availableStablecoin: 'USDC' | 'USDT' = 'USDC',
): Readonly<{
  service: LocalDemoAllocationService;
  read: jest.Mock;
}> {
  const read = jest.fn(async () => ({
    asOf: AS_OF,
    portfolioValueUsdMinor: '9999999',
    buyingPower: { status: 'AVAILABLE', amountUsdMinor: grossCapitalUsdMinor },
    wallets: [
      {
        chains: [
          {
            assets: [
              {
                stablecoin: availableStablecoin,
                buyingPowerUsdMinor: grossCapitalUsdMinor,
              },
            ],
          },
        ],
      },
    ],
  }));
  return {
    service: new LocalDemoAllocationService({ read } as never, new LocalDemoYieldCatalogService()),
    read,
  };
}

function componentAmounts(
  result: LocalDemoAllocationPreviewResponse,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      result.executionCost.modeledScenario.components.map(({ code, amountUsdMinor }) => [
        code,
        amountUsdMinor,
      ]),
    ),
  );
}

function parseDecimal(value: string): Readonly<{ numerator: bigint; scale: number }> {
  const [whole, fraction = ''] = value.split('.');
  if (whole === undefined) throw new TypeError('missing decimal whole part');
  return Object.freeze({ numerator: BigInt(`${whole}${fraction}`), scale: fraction.length });
}

function divideAmountEvenly(total: bigint, count: number): readonly bigint[] {
  const divisor = BigInt(count);
  const quotient = total / divisor;
  const remainder = Number(total % divisor);
  return Object.freeze(
    Array.from({ length: count }, (_, index) => quotient + (index < remainder ? 1n : 0n)),
  );
}

function accruedYieldAtDay(managedYieldCapitalUsdMinor: string, day: number): bigint {
  const opportunities = new LocalDemoYieldCatalogService().select(
    null,
    SNAPSHOT_TIME,
  ).selectedOpportunities;
  const amounts = divideAmountEvenly(BigInt(managedYieldCapitalUsdMinor), opportunities.length);
  const rates = opportunities.map(({ apy }) => parseDecimal(apy.baseRateDecimal));
  const maximumScale = rates.reduce((maximum, { scale }) => Math.max(maximum, scale), 0);
  const denominator = 10n ** BigInt(maximumScale);
  const numerator = opportunities.reduce((total, _opportunity, index) => {
    const rate = rates[index];
    const amount = amounts[index];
    if (rate === undefined || amount === undefined) throw new TypeError('missing projection input');
    return total + amount * rate.numerator * 10n ** BigInt(maximumScale - rate.scale);
  }, 0n);
  return (numerator * BigInt(day)) / (365n * denominator);
}

function collectKeys(value: unknown, keys = new Set<string>()): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (typeof value !== 'object' || value === null) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

describe('LocalDemoAllocationService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(SNAPSHOT_TIME);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    {
      presetId: 'MORE_LIQUID',
      reserveBasisPoints: 6_000,
      allocationAmounts: ['419729', '279819'],
      components: { NETWORK: '326', CONVERSION: '0', MARKET_IMPACT: '66', ROUTING: '60' },
      totalCost: '452',
      projectedCapital: '699548',
      effectiveApyBasisPoints: 187,
      annualYield: '13130',
      annualYieldAfterFees: '12678',
      firstPositiveDay: 13,
    },
    {
      presetId: 'BALANCED',
      reserveBasisPoints: 3_000,
      allocationAmounts: ['209816', '489571'],
      components: { NETWORK: '438', CONVERSION: '0', MARKET_IMPACT: '115', ROUTING: '60' },
      totalCost: '613',
      projectedCapital: '699387',
      effectiveApyBasisPoints: 328,
      annualYield: '22973',
      annualYieldAfterFees: '22360',
      firstPositiveDay: 10,
    },
    {
      presetId: 'MORE_YIELD',
      reserveBasisPoints: 1_500,
      allocationAmounts: ['104896', '594410'],
      components: { NETWORK: '494', CONVERSION: '0', MARKET_IMPACT: '140', ROUTING: '60' },
      totalCost: '694',
      projectedCapital: '699306',
      effectiveApyBasisPoints: 398,
      annualYield: '27892',
      annualYieldAfterFees: '27198',
      firstPositiveDay: 10,
    },
  ] as const)(
    'projects the $7k $presetId preset with exact modeled costs and recovery',
    async ({
      presetId,
      reserveBasisPoints,
      allocationAmounts,
      components,
      totalCost,
      projectedCapital,
      effectiveApyBasisPoints,
      annualYield,
      annualYieldAfterFees,
      firstPositiveDay,
    }) => {
      const { service, read } = fixture();
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('network forbidden'));

      const result = await service.preview(ACCOUNT_ID, CORRELATION, preset(presetId));

      expect(read).toHaveBeenCalledWith(ACCOUNT_ID, CORRELATION);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.selection).toMatchObject({
        kind: 'PRESET',
        presetId,
        liquidReserveBasisPoints: reserveBasisPoints,
      });
      expect(result.rateSnapshot).toEqual({
        id: 'managed-rate-snapshot-v1',
        capturedAt: '2026-08-26T14:14:54.580Z',
        staleAfter: '2026-08-27T14:14:54.580Z',
        freshness: 'CURRENT',
        staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
        riskClassificationAvailable: false,
        riskClassification: 'NOT_ASSESSED',
      });
      expect(result.allocations.map(({ percentageBasisPoints }) => percentageBasisPoints)).toEqual([
        reserveBasisPoints,
        10_000 - reserveBasisPoints,
      ]);
      expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual(
        allocationAmounts,
      );
      expect(componentAmounts(result)).toEqual(components);
      expect(result.executionCost.modeledScenario).toMatchObject({
        status: 'AVAILABLE',
        modelId: 'LOCAL_DEMO_ALLOCATION_COST_V1',
        isQuote: false,
        costBasisCapitalUsdMinor: '700000',
        fundingTreatment: 'DEDUCT_FROM_GROSS_BEFORE_PROJECTION',
        rounding: 'CEIL_EACH_VARIABLE_COMPONENT_TO_USD_MINOR',
        totalUsdMinor: totalCost,
      });
      expect(result.executionCost.actualLocalOperation).toEqual({
        status: 'NO_EXECUTION',
        amountUsdMinor: '0',
      });
      expect(result.executionCost.publicExecution).toEqual({
        status: 'UNQUOTED',
        amountUsdMinor: null,
      });
      expect(result.capitalIncludedInProjectionUsdMinor).toBe(projectedCapital);
      expect(result.yieldProjection).toEqual({
        source: 'MANAGED_RATE_SNAPSHOT',
        calculationMethod: 'INTERNAL_POSITION_WEIGHTED_EXACT_BASE_APY',
        effectiveApyBasisPoints,
        projectedAnnualYieldUsdMinor: annualYield,
        projectedAnnualYieldAfterFeesUsdMinor: annualYieldAfterFees,
        firstPositiveDayAfterFees: {
          calculationMethod: 'FIRST_WHOLE_DAY_VISIBLE_YIELD_EXCEEDS_ESTIMATED_FEES',
          status: 'RECOVERED_WITHIN_HORIZON',
          day: firstPositiveDay,
          modelHorizonDays: 365,
        },
      });

      const allocated = result.allocations.reduce(
        (total, allocation) => total + BigInt(allocation.amountUsdMinor),
        0n,
      );
      const modeledCost = BigInt(result.executionCost.modeledScenario.totalUsdMinor);
      expect(allocated).toBe(BigInt(projectedCapital));
      expect(allocated + modeledCost).toBe(700_000n);
      expect(BigInt(annualYield) - modeledCost).toBe(BigInt(annualYieldAfterFees));

      const managedYieldCapital = result.allocations[1]?.amountUsdMinor;
      if (managedYieldCapital === undefined) throw new TypeError('missing managed allocation');
      expect(accruedYieldAtDay(managedYieldCapital, firstPositiveDay - 1)).toBeLessThanOrEqual(
        modeledCost,
      );
      expect(accruedYieldAtDay(managedYieldCapital, firstPositiveDay)).toBeGreaterThanOrEqual(
        modeledCost + 1n,
      );

      const responseKeys = collectKeys(result);
      for (const forbidden of [
        'provider',
        'protocol',
        'marketId',
        'opportunity',
        'opportunities',
        'sourceReference',
        'payloadSha256',
        'normalizerId',
        'attributes',
      ]) {
        expect(responseKeys).not.toContain(forbidden);
      }
      expect(JSON.stringify(result)).not.toMatch(/morpho|eip155:|0x[0-9a-f]{40,64}/iu);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.allocations)).toBe(true);
      expect(Object.isFrozen(result.executionCost.modeledScenario.components)).toBe(true);
    },
  );

  it('varies all four modeled components from server-owned capital and asset inputs', async () => {
    const sevenThousandUsdc = await fixture('700000', 'USDC').service.preview(
      ACCOUNT_ID,
      CORRELATION,
      preset('BALANCED'),
    );
    const elevenThousandUsdc = await fixture('1100000', 'USDC').service.preview(
      ACCOUNT_ID,
      CORRELATION,
      preset('BALANCED'),
    );
    const sevenThousandUsdt = await fixture('700000', 'USDT').service.preview(
      ACCOUNT_ID,
      CORRELATION,
      preset('BALANCED'),
    );

    expect(componentAmounts(sevenThousandUsdc)).toEqual({
      NETWORK: '438',
      CONVERSION: '0',
      MARKET_IMPACT: '115',
      ROUTING: '60',
    });
    expect(componentAmounts(elevenThousandUsdc)).toEqual({
      NETWORK: '587',
      CONVERSION: '0',
      MARKET_IMPACT: '181',
      ROUTING: '60',
    });
    expect(componentAmounts(sevenThousandUsdt)).toEqual({
      NETWORK: '438',
      CONVERSION: '588',
      MARKET_IMPACT: '115',
      ROUTING: '60',
    });
    expect(sevenThousandUsdt.executionCost.modeledScenario.totalUsdMinor).toBe('1201');
  });

  it('fails closed when the modeled cost exhausts the available capital', async () => {
    const { service } = fixture('1');

    await expect(service.preview(ACCOUNT_ID, CORRELATION, preset('BALANCED'))).rejects.toThrow(
      'local demo modeled cost exhausts capital',
    );
  });

  it('keeps a stale server-owned rate snapshot explicitly non-executable', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const { service } = fixture();

    const result = await service.preview(ACCOUNT_ID, CORRELATION, preset('BALANCED'));

    expect(result.rateSnapshot).toMatchObject({
      id: 'managed-rate-snapshot-v1',
      freshness: 'STALE',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      riskClassification: 'NOT_ASSESSED',
    });
    expect(result.mayAuthorizeFinancialAction).toBe(false);
  });
});
