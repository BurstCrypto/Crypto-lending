import { parseAccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  LocalDemoAllocationService,
  type LocalDemoAllocationPresetId,
  type LocalDemoAllocationSelection,
} from './local-demo-allocation.service';
import {
  LocalDemoNoMatchingYieldOpportunitiesError,
  LocalDemoYieldCatalogService,
  type LocalDemoCustomYieldFilters,
} from './local-demo-yield-catalog.service';

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

function custom(
  overrides: Partial<LocalDemoCustomYieldFilters> = {},
): LocalDemoAllocationSelection {
  return Object.freeze({
    kind: 'CUSTOM',
    liquidReserveBasisPoints: 2_500,
    filters: Object.freeze({
      assetSymbols: Object.freeze(['USDC', 'USDT'] as const),
      providerIds: Object.freeze(['MORPHO'] as const),
      networkIds: Object.freeze(['eip155:1', 'eip155:8453'] as const),
      minimumApyBasisPoints: 0,
      minimumTvlUsdMinor: '0',
      minimumExitLiquidityUsdMinor: '0',
      maximumUtilizationBasisPoints: 10_000,
      ...overrides,
    }),
  });
}

function fixture(grossCapitalUsdMinor = '1100000'): Readonly<{
  service: LocalDemoAllocationService;
  read: jest.Mock;
}> {
  const read = jest.fn(async () => ({
    asOf: AS_OF,
    portfolioValueUsdMinor: '9999999',
    buyingPower: { status: 'AVAILABLE', amountUsdMinor: grossCapitalUsdMinor },
  }));
  return {
    service: new LocalDemoAllocationService({ read } as never, new LocalDemoYieldCatalogService()),
    read,
  };
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
    ['MORE_LIQUID', 6_000, [6_000, 1_334, 1_333, 1_333], '20646', 187],
    ['BALANCED', 3_000, [3_000, 2_334, 2_333, 2_333], '36132', 328],
    ['MORE_YIELD', 1_500, [1_500, 2_834, 2_833, 2_833], '43874', 398],
  ] as const)(
    'projects %s over the same trusted ranked snapshot without external I/O',
    async (
      presetId,
      reserveBasisPoints,
      expectedWeights,
      projectedAnnualYield,
      effectiveApyBasisPoints,
    ) => {
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
        filters: null,
      });
      expect(result.catalog).toEqual({
        snapshotId: 'morpho-public-api-2026-08-26T14:14:54.580Z',
        capturedAt: '2026-08-26T14:14:54.580Z',
        staleAfter: '2026-08-27T14:14:54.580Z',
        freshness: 'CURRENT',
        staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
        riskClassificationAvailable: false,
        riskClassification: 'NOT_ASSESSED',
        matchedOpportunityCount: 5,
        selectedOpportunityCount: 3,
      });
      expect(result.allocations.map(({ percentageBasisPoints }) => percentageBasisPoints)).toEqual(
        expectedWeights,
      );
      expect(result.allocations.slice(1).map(({ allocationId }) => allocationId)).toEqual([
        'morpho-blue:eip155:1:0xe3df58f9d3011b7481ff36b939fa5f8da642f34ea5792d25d3958dbf1efa26d7',
        'morpho-blue:eip155:8453:0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
        'morpho-blue:eip155:8453:0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda',
      ]);
      const highestApy = result.allocations[1]?.opportunity;
      expect(highestApy?.apy).toMatchObject({
        baseRateDecimal: '0.05210504022183349',
        baseBasisPoints: 521,
        providerFee: { status: 'REPORTED', rateDecimal: '0', basisPoints: 0 },
        rewardAprs: [
          { assetSymbol: 'USDC', rateDecimal: '0.017398639912427037', basisPoints: 173 },
        ],
      });
      expect(highestApy?.provenance.payloadSha256).toBe(
        '5afd26e631dc47617a3c6e84d0e04e0ac286ef8f175997611aabe937849723b4',
      );
      expect(result.executionCost).toEqual({
        treatment: 'LOCAL_DEMO_ZERO_NO_EXECUTION',
        modeledLocalAmountUsdMinor: '0',
        publicExecutionCostStatus: 'UNQUOTED',
      });
      expect(result.capitalIncludedInProjectionUsdMinor).toBe(result.grossCapitalUsdMinor);
      expect(result.yieldProjection).toMatchObject({
        source: 'MORPHO_PUBLIC_API_SNAPSHOT',
        calculationMethod: 'POSITION_WEIGHTED_EXACT_BASE_APY',
        effectiveApyBasisPoints,
        projectedAnnualYieldUsdMinor: projectedAnnualYield,
      });
      expect(
        result.allocations.reduce(
          (total, allocation) => total + BigInt(allocation.amountUsdMinor),
          0n,
        ),
      ).toBe(1_100_000n);
      const yieldAmounts = result.allocations
        .slice(1)
        .map(({ amountUsdMinor }) => BigInt(amountUsdMinor));
      expect(yieldAmounts[0]! - yieldAmounts.at(-1)!).toBeLessThanOrEqual(1n);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.allocations)).toBe(true);
      expect(Object.isFrozen(highestApy?.apy.rewardAprs)).toBe(true);
    },
  );

  it('re-filters custom constraints server-side and allocates only the deterministic match', async () => {
    const { service } = fixture();
    const selection = custom({
      assetSymbols: Object.freeze(['USDT']),
      networkIds: Object.freeze(['eip155:1']),
      minimumApyBasisPoints: 300,
      minimumTvlUsdMinor: '1000000000',
      minimumExitLiquidityUsdMinor: '100000000',
      maximumUtilizationBasisPoints: 9_000,
    });

    const result = await service.preview(ACCOUNT_ID, CORRELATION, selection);

    expect(result.selection).toMatchObject({
      kind: 'CUSTOM',
      presetId: null,
      liquidReserveBasisPoints: 2_500,
    });
    expect(result.catalog).toMatchObject({
      matchedOpportunityCount: 1,
      selectedOpportunityCount: 1,
    });
    expect(result.allocations.map(({ percentageBasisPoints }) => percentageBasisPoints)).toEqual([
      2_500, 7_500,
    ]);
    expect(result.allocations[1]?.opportunity).toMatchObject({
      asset: { symbol: 'USDT' },
      network: { id: 'eip155:1' },
      apy: { baseRateDecimal: '0.030244914978243814', baseBasisPoints: 302 },
      exitLiquidity: { interpretation: 'AVAILABLE_TO_BORROW_PROXY' },
    });
    expect(result.executionCost.modeledLocalAmountUsdMinor).toBe('0');
    expect(result.yieldProjection.effectiveApyBasisPoints).toBe(226);
    expect(result.yieldProjection.projectedAnnualYieldUsdMinor).toBe('24952');
  });

  it('keeps the closed 99% reserve boundary locally calculable', async () => {
    const { service } = fixture();
    const selection = Object.freeze({
      ...custom({ assetSymbols: Object.freeze(['USDT']) }),
      liquidReserveBasisPoints: 9_900,
    });

    const result = await service.preview(ACCOUNT_ID, CORRELATION, selection);

    expect(result.allocations.map(({ percentageBasisPoints }) => percentageBasisPoints)).toEqual([
      9_900, 100,
    ]);
    expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual([
      '1089000',
      '11000',
    ]);
    expect(result.executionCost.modeledLocalAmountUsdMinor).toBe('0');

    await expect(
      service.preview(
        ACCOUNT_ID,
        CORRELATION,
        Object.freeze({ ...selection, liquidReserveBasisPoints: 9_901 }),
      ),
    ).rejects.toThrow(TypeError);
  });

  it('fails closed when valid custom filters have no trusted match', async () => {
    const { service } = fixture();

    await expect(
      service.preview(ACCOUNT_ID, CORRELATION, custom({ minimumApyBasisPoints: 10_000 })),
    ).rejects.toBeInstanceOf(LocalDemoNoMatchingYieldOpportunitiesError);
  });

  it('uses eligible buying power, apportions indivisible cents, and never trusts portfolio value', async () => {
    const { service } = fixture('10001');

    const result = await service.preview(ACCOUNT_ID, CORRELATION, preset('BALANCED'));

    expect(result.grossCapitalUsdMinor).toBe('10001');
    expect(
      result.allocations.reduce(
        (total, allocation) => total + BigInt(allocation.amountUsdMinor),
        0n,
      ),
    ).toBe(10_001n);
    expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual([
      '3000',
      '2334',
      '2334',
      '2333',
    ]);
    expect(result.executionCost.modeledLocalAmountUsdMinor).toBe('0');
  });

  it('keeps a stale snapshot usable only as an explicitly non-executable offline estimate', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const { service } = fixture('0');

    const result = await service.preview(ACCOUNT_ID, CORRELATION, preset('BALANCED'));

    expect(result.catalog).toMatchObject({
      freshness: 'STALE',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      riskClassification: 'NOT_ASSESSED',
    });
    expect(result.mayAuthorizeFinancialAction).toBe(false);
    expect(result.executionCost.modeledLocalAmountUsdMinor).toBe('0');
    expect(result.yieldProjection.projectedAnnualYieldUsdMinor).toBe('0');
  });
});
