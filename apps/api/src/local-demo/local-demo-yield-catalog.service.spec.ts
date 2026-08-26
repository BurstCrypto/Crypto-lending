import {
  LocalDemoNoMatchingYieldOpportunitiesError,
  LocalDemoYieldCatalogUnavailableError,
  LocalDemoYieldCatalogService,
  assertLocalDemoCustomYieldFilters,
  type LocalDemoCustomYieldFilters,
} from './local-demo-yield-catalog.service';

function filters(
  overrides: Partial<LocalDemoCustomYieldFilters> = {},
): LocalDemoCustomYieldFilters {
  return Object.freeze({
    assetSymbols: Object.freeze(['USDC', 'USDT'] as const),
    providerIds: Object.freeze(['MORPHO'] as const),
    networkIds: Object.freeze(['eip155:1', 'eip155:8453'] as const),
    minimumApyBasisPoints: 0,
    minimumTvlUsdMinor: '0',
    minimumExitLiquidityUsdMinor: '0',
    maximumUtilizationBasisPoints: 10_000,
    ...overrides,
  });
}

describe('LocalDemoYieldCatalogService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns normalized exact Morpho observations without any runtime provider request', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network forbidden'));

    const result = new LocalDemoYieldCatalogService().read(new Date('2026-08-26T15:00:00.000Z'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      use: 'LOCAL_DEMO_SNAPSHOT_ONLY',
      mayAuthorizeFinancialAction: false,
      riskClassificationAvailable: false,
      snapshot: {
        provider: 'MORPHO_PUBLIC_API',
        freshness: 'CURRENT',
        staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
        riskClassification: 'NOT_ASSESSED',
      },
    });
    expect(result.opportunities).toHaveLength(5);
    expect(result.opportunities[0]).toMatchObject({
      provider: { id: 'MORPHO', name: 'Morpho' },
      protocol: { id: 'MORPHO_BLUE', name: 'Morpho Blue' },
      asset: { symbol: 'USDC', decimals: 6 },
      network: { id: 'eip155:8453', name: 'Base' },
      apy: {
        baseRateDecimal: '0.04440914291661858',
        baseBasisPoints: 444,
        providerFee: { status: 'REPORTED', rateDecimal: '0', basisPoints: 0 },
      },
      tvl: {
        sourceAmountUsdDecimal: '1477830502.194782',
        amountUsdMinor: '147783050219',
      },
      exitLiquidity: {
        sourceAmountUsdDecimal: '145826314.0535183',
        amountUsdMinor: '14582631405',
        interpretation: 'AVAILABLE_TO_BORROW_PROXY',
      },
      utilization: { rateDecimal: '0.901324059939928', basisPoints: 9013 },
      availability: {
        status: 'LISTED_ONLY',
        providerListed: true,
        depositsEnabled: 'NOT_VERIFIED',
        withdrawalsEnabled: 'NOT_VERIFIED',
      },
      provenance: {
        sourceKind: 'API',
        sourceReference: 'https://api.morpho.org/graphql',
        payloadSha256: '5afd26e631dc47617a3c6e84d0e04e0ac286ef8f175997611aabe937849723b4',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.opportunities)).toBe(true);
    expect(result.opportunities.every((opportunity) => Object.isFrozen(opportunity))).toBe(true);
  });

  it('labels age without disabling the permanently non-executable offline catalog', () => {
    const service = new LocalDemoYieldCatalogService();

    expect(service.read(new Date('2026-08-27T14:14:54.579Z')).snapshot.freshness).toBe('CURRENT');
    expect(service.read(new Date('2026-08-27T14:14:54.580Z')).snapshot.freshness).toBe('STALE');
    expect(service.select(null, new Date('2030-01-01T00:00:00.000Z'))).toMatchObject({
      metadata: { freshness: 'STALE', staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' },
      matchedOpportunities: { length: 5 },
      selectedOpportunities: { length: 3 },
    });
  });

  it('fails closed when the local clock predates the checked-in capture', () => {
    const service = new LocalDemoYieldCatalogService();

    expect(() => service.read(new Date('2026-08-26T14:14:54.579Z'))).toThrow(
      LocalDemoYieldCatalogUnavailableError,
    );
    expect(() => service.read(new Date(Number.NaN))).toThrow(LocalDemoYieldCatalogUnavailableError);
  });

  it('filters exact provider decimals and deterministically ranks base APY then opportunity ID', () => {
    const result = new LocalDemoYieldCatalogService().select(
      filters({
        assetSymbols: Object.freeze(['USDC']),
        networkIds: Object.freeze(['eip155:1']),
        minimumApyBasisPoints: 420,
        minimumTvlUsdMinor: '1000000000',
        minimumExitLiquidityUsdMinor: '100000000',
        maximumUtilizationBasisPoints: 9_100,
      }),
      new Date('2026-08-26T15:00:00.000Z'),
    );

    expect(result.matchedOpportunities.map(({ apy }) => apy.baseRateDecimal)).toEqual([
      '0.05210504022183349',
      '0.04205303220765344',
    ]);
    expect(result.selectedOpportunities).toEqual(result.matchedOpportunities);
  });

  it('fails closed for no matches and malformed internal filter constraints', () => {
    const service = new LocalDemoYieldCatalogService();

    expect(() => service.select(filters({ minimumApyBasisPoints: 10_000 }))).toThrow(
      LocalDemoNoMatchingYieldOpportunitiesError,
    );
    expect(() =>
      assertLocalDemoCustomYieldFilters(
        filters({ providerIds: Object.freeze(['MORPHO', 'MORPHO'] as const) }),
      ),
    ).toThrow(TypeError);
  });
});
