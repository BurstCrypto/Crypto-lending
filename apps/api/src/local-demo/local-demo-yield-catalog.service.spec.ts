import {
  LOCAL_DEMO_YIELD_ECOSYSTEMS,
  LOCAL_DEMO_YIELD_PROVIDER_IDS,
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
    providerIds: LOCAL_DEMO_YIELD_PROVIDER_IDS,
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

  it('returns only sanitized managed-rate snapshot status without runtime network access', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network forbidden'));

    const result = new LocalDemoYieldCatalogService().read(new Date('2026-08-26T22:00:00.000Z'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY',
      mayAuthorizeFinancialAction: false,
      riskClassificationAvailable: false,
      strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND',
      ecosystems: ['EVM', 'SOLANA'],
      snapshot: {
        id: 'managed-rate-snapshot-v2',
        capturedAt: '2026-08-26T21:20:06.659Z',
        staleAfter: '2026-08-27T14:14:54.580Z',
        freshness: 'CURRENT',
        staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
        riskClassification: 'NOT_ASSESSED',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /morpho|provider|protocol|market|opportunit|provenance|sourceReference|payloadSha256|normalizer|endpoint|graphql/iu,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ecosystems)).toBe(true);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });

  it('labels age without disabling the permanently non-executable offline snapshot', () => {
    const service = new LocalDemoYieldCatalogService();

    expect(service.read(new Date('2026-08-27T14:14:54.579Z')).snapshot.freshness).toBe('CURRENT');
    expect(service.read(new Date('2026-08-27T14:14:54.580Z')).snapshot.freshness).toBe('STALE');
    expect(service.select(null, new Date('2030-01-01T00:00:00.000Z'))).toMatchObject({
      metadata: { freshness: 'STALE', staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE' },
      matchedOpportunities: { length: 6 },
      selectedOpportunities: { length: 3 },
    });
  });

  it('fails closed when the local clock predates the checked-in capture', () => {
    const service = new LocalDemoYieldCatalogService();

    expect(() => service.read(new Date('2026-08-26T21:20:06.658Z'))).toThrow(
      LocalDemoYieldCatalogUnavailableError,
    );
    expect(() => service.read(new Date(Number.NaN))).toThrow(LocalDemoYieldCatalogUnavailableError);
  });

  it('filters exact server-confidential observations and ranks deterministically', () => {
    const result = new LocalDemoYieldCatalogService().select(
      filters({
        assetSymbols: Object.freeze(['USDC']),
        networkIds: Object.freeze(['eip155:1']),
        minimumApyBasisPoints: 420,
        minimumTvlUsdMinor: '1000000000',
        minimumExitLiquidityUsdMinor: '100000000',
        maximumUtilizationBasisPoints: 9_100,
      }),
      new Date('2026-08-26T22:00:00.000Z'),
    );

    expect(result.matchedOpportunities.map(({ apy }) => apy.baseRateDecimal)).toEqual([
      '0.05210504022183349',
      '0.04205303220765344',
    ]);
    expect(result.selectedOpportunities).toEqual(result.matchedOpportunities);
  });

  it('selects up to the top two opportunities in every requested ecosystem', () => {
    const result = new LocalDemoYieldCatalogService().select(
      null,
      new Date('2026-08-26T22:00:00.000Z'),
    );

    expect(LOCAL_DEMO_YIELD_ECOSYSTEMS).toEqual(['EVM', 'SOLANA']);
    expect(result.selectedOpportunities.map(({ ecosystem }) => ecosystem)).toEqual([
      'EVM',
      'SOLANA',
      'EVM',
    ]);
    expect(result.selectedOpportunities.map(({ apy }) => apy.baseRateDecimal)).toEqual([
      '0.05210504022183349',
      '0.04542148187048922',
      '0.04440914291661858',
    ]);
    expect(
      result.selectedOpportunities.filter(({ ecosystem }) => ecosystem === 'EVM'),
    ).toHaveLength(2);
    expect(
      result.selectedOpportunities.filter(({ ecosystem }) => ecosystem === 'SOLANA'),
    ).toHaveLength(1);
    expect(new Set(result.selectedOpportunities.map(({ provider }) => provider.id))).toEqual(
      new Set(['MORPHO', 'KAMINO']),
    );
    const solana = result.selectedOpportunities.find(({ ecosystem }) => ecosystem === 'SOLANA');
    expect(solana).toMatchObject({
      ecosystem: 'SOLANA',
      provider: { id: 'KAMINO', name: 'Kamino' },
      protocol: {
        id: 'KAMINO_LEND',
        name: 'Kamino Lend',
        marketId: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
      },
      asset: {
        symbol: 'USDC',
        contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
      },
      network: {
        id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        name: 'Solana',
      },
      apy: {
        baseRateDecimal: '0.04542148187048922',
        baseBasisPoints: 454,
        providerFee: { status: 'NOT_REPORTED', rateDecimal: null, basisPoints: null },
      },
      tvl: {
        sourceAmountUsdDecimal: '109125834.79081585224',
        amountUsdMinor: '10912583479',
      },
      exitLiquidity: {
        sourceAmountUsdDecimal: '8281021.5432826164972400730543836760556',
        amountUsdMinor: '828102154',
      },
      utilization: { rateDecimal: '0.924114930628878394', basisPoints: 9241 },
      availability: {
        status: 'LISTED_ONLY',
        providerListed: true,
        depositsEnabled: 'NOT_VERIFIED',
        withdrawalsEnabled: 'NOT_VERIFIED',
      },
      provenance: {
        payloadSha256: '5e818a2e995ef0b0e1cfc1f6a2762cac5825a4d470d0bf1835e52b5f9b16f109',
        normalizerId: 'kamino-local-demo-snapshot',
      },
    });
    expect(Object.isFrozen(result.selectedOpportunities)).toBe(true);
  });

  it('fails closed for no internal matches and malformed internal constraints', () => {
    const service = new LocalDemoYieldCatalogService();
    const providerId = LOCAL_DEMO_YIELD_PROVIDER_IDS[0];

    expect(() => service.select(filters({ minimumApyBasisPoints: 10_000 }))).toThrow(
      LocalDemoNoMatchingYieldOpportunitiesError,
    );
    expect(() =>
      assertLocalDemoCustomYieldFilters(
        filters({ providerIds: Object.freeze([providerId, providerId]) }),
      ),
    ).toThrow(TypeError);
  });
});
