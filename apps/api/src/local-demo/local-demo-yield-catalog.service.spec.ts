import {
  LOCAL_DEMO_YIELD_ECOSYSTEMS,
  LOCAL_DEMO_YIELD_PROVIDER_IDS,
  LocalDemoNoMatchingYieldOpportunitiesError,
  LocalDemoYieldCatalogUnavailableError,
  LocalDemoYieldCatalogService,
  assertLocalDemoEconomicSnapshotConsistency,
  assertLocalDemoCustomYieldFilters,
  deriveLocalDemoManagedRateWindow,
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

  it('derives the conservative overlap window from every component', () => {
    const result = deriveLocalDemoManagedRateWindow([
      {
        capturedAt: '2026-08-26T20:00:00.000Z',
        staleAfter: '2026-08-28T00:00:00.000Z',
      },
      {
        capturedAt: '2026-08-26T21:00:00.000Z',
        staleAfter: '2026-08-27T12:00:00.000Z',
      },
      {
        capturedAt: '2026-08-27T00:00:00.000Z',
        staleAfter: '2026-08-27T18:00:00.000Z',
      },
    ]);

    expect(result).toEqual({
      capturedAt: '2026-08-27T00:00:00.000Z',
      staleAfter: '2026-08-27T12:00:00.000Z',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(() =>
      deriveLocalDemoManagedRateWindow([
        {
          capturedAt: '2026-08-27T12:00:00.000Z',
          staleAfter: '2026-08-27T12:00:00.000Z',
        },
      ]),
    ).toThrow(TypeError);
  });

  it('rejects economically inconsistent captured provider observations', () => {
    const valid = Object.freeze({
      totalSupplyUsdDecimal: '1000',
      totalBorrowUsdDecimal: '750',
      availableLiquidityUsdDecimal: '250',
      utilizationRateDecimal: '0.75',
      protocolShareRateDecimal: '0.2',
      observedAt: '2026-08-27T00:00:00.000Z',
      retrievedAt: '2026-08-27T00:01:00.000Z',
      capturedAt: '2026-08-27T00:01:00.000Z',
    });

    expect(() => assertLocalDemoEconomicSnapshotConsistency(valid)).not.toThrow();
    for (const overrides of [
      { totalBorrowUsdDecimal: '1001' },
      { availableLiquidityUsdDecimal: '1001' },
      { utilizationRateDecimal: '0.5' },
      { availableLiquidityUsdDecimal: '100' },
      { protocolShareRateDecimal: '1.0001' },
      { observedAt: '2026-08-27T00:02:00.000Z' },
    ]) {
      expect(() => assertLocalDemoEconomicSnapshotConsistency({ ...valid, ...overrides })).toThrow(
        TypeError,
      );
    }
  });

  it('returns only sanitized managed-rate snapshot status without runtime network access', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network forbidden'));

    const result = new LocalDemoYieldCatalogService().read(new Date('2026-08-27T01:05:00.000Z'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY',
      mayAuthorizeFinancialAction: false,
      riskClassificationAvailable: false,
      strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND',
      ecosystems: ['EVM', 'SOLANA'],
      snapshot: {
        id: 'managed-rate-snapshot-v3',
        capturedAt: '2026-08-27T01:04:48.000Z',
        staleAfter: '2026-08-27T14:14:54.580Z',
        freshness: 'CURRENT',
        staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
        riskClassification: 'NOT_ASSESSED',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /morpho|kamino|aave|save|solend|compound|moonwell|spark|venus|euler|marginfi|provider|protocol|market|reserve|opportunit|provenance|sourceReference|payloadSha256|normalizer|endpoint|graphql/iu,
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
      matchedOpportunities: { length: 16 },
      selectedOpportunities: { length: 4 },
    });
  });

  it('fails closed when the local clock predates the checked-in capture', () => {
    const service = new LocalDemoYieldCatalogService();

    expect(() => service.read(new Date('2026-08-27T01:04:47.999Z'))).toThrow(
      LocalDemoYieldCatalogUnavailableError,
    );
    expect(() => service.read(new Date(Number.NaN))).toThrow(LocalDemoYieldCatalogUnavailableError);
  });

  it('filters exact server-confidential observations and keeps selection provider-distinct', () => {
    const result = new LocalDemoYieldCatalogService().select(
      filters({
        assetSymbols: Object.freeze(['USDC']),
        networkIds: Object.freeze(['eip155:1']),
        minimumApyBasisPoints: 420,
        minimumTvlUsdMinor: '1000000000',
        minimumExitLiquidityUsdMinor: '100000000',
        maximumUtilizationBasisPoints: 9_100,
      }),
      new Date('2026-08-27T01:05:00.000Z'),
    );

    expect(result.matchedOpportunities.map(({ apy }) => apy.baseRateDecimal)).toEqual([
      '0.05210504022183349',
      '0.04205303220765344',
    ]);
    expect(result.selectedOpportunities.map(({ apy }) => apy.baseRateDecimal)).toEqual([
      '0.05210504022183349',
    ]);
  });

  it('selects up to the top two opportunities in every requested ecosystem', () => {
    const result = new LocalDemoYieldCatalogService().select(
      null,
      new Date('2026-08-27T01:05:00.000Z'),
    );

    expect(LOCAL_DEMO_YIELD_ECOSYSTEMS).toEqual(['EVM', 'SOLANA']);
    expect(result.selectedOpportunities.map(({ ecosystem }) => ecosystem)).toEqual([
      'EVM',
      'EVM',
      'SOLANA',
      'SOLANA',
    ]);
    expect(result.selectedOpportunities.map(({ apy }) => apy.baseRateDecimal)).toEqual([
      '0.098884748614322825628319949',
      '0.09226853285021493',
      '0.04542148187048922',
      '0.031252082831978',
    ]);
    expect(
      result.selectedOpportunities.filter(({ ecosystem }) => ecosystem === 'EVM'),
    ).toHaveLength(2);
    expect(
      result.selectedOpportunities.filter(({ ecosystem }) => ecosystem === 'SOLANA'),
    ).toHaveLength(2);
    expect(new Set(result.selectedOpportunities.map(({ provider }) => provider.id))).toEqual(
      new Set(['AAVE', 'EULER', 'KAMINO', 'P0']),
    );
    for (const ecosystem of LOCAL_DEMO_YIELD_ECOSYSTEMS) {
      const selected = result.selectedOpportunities.filter(
        (opportunity) => opportunity.ecosystem === ecosystem,
      );
      expect(new Set(selected.map(({ provider }) => provider.id)).size).toBe(selected.length);
    }
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

  it('normalizes all ten distinct private providers into selectable local candidates', () => {
    const service = new LocalDemoYieldCatalogService();

    expect(LOCAL_DEMO_YIELD_PROVIDER_IDS).toHaveLength(10);
    expect(new Set(LOCAL_DEMO_YIELD_PROVIDER_IDS).size).toBe(10);
    for (const providerId of LOCAL_DEMO_YIELD_PROVIDER_IDS) {
      const networkIds =
        providerId === 'KAMINO' || providerId === 'SAVE' || providerId === 'P0'
          ? Object.freeze(['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'] as const)
          : Object.freeze(['eip155:1', 'eip155:56', 'eip155:8453'] as const);
      const result = service.select(
        filters({
          providerIds: Object.freeze([providerId]),
          networkIds,
        }),
        new Date('2026-08-27T01:05:00.000Z'),
      );

      expect(result.selectedOpportunities).toHaveLength(1);
      expect(result.selectedOpportunities[0]?.provider.id).toBe(providerId);
    }
  });

  it('binds each additional provider to its exact server-owned identity tuple', () => {
    const result = new LocalDemoYieldCatalogService().select(
      null,
      new Date('2026-08-27T01:05:00.000Z'),
    );
    const additionalProviderIds = new Set([
      'COMPOUND',
      'MOONWELL',
      'SPARK',
      'VENUS',
      'EULER',
      'P0',
    ]);
    const identities = Object.fromEntries(
      result.matchedOpportunities
        .filter(({ provider }) => additionalProviderIds.has(provider.id))
        .map(({ provider, protocol, asset, network, provenance }) => [
          provider.id,
          {
            provider,
            protocol,
            asset,
            network,
            sourceKind: provenance.sourceKind,
            sourceReference: provenance.sourceReference,
          },
        ]),
    );

    expect(identities).toEqual({
      COMPOUND: {
        provider: { id: 'COMPOUND', name: 'Compound' },
        protocol: {
          id: 'COMPOUND_III',
          name: 'Compound III',
          marketId: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
        },
        asset: {
          symbol: 'USDC',
          contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          decimals: 6,
        },
        network: { id: 'eip155:8453', name: 'Base' },
        sourceKind: 'ON_CHAIN',
        sourceReference:
          'https://raw.githubusercontent.com/compound-finance/comet/f766f51583c23acc33b2a7824654ef2029a96804/deployments/base/usdc/roots.json',
      },
      MOONWELL: {
        provider: { id: 'MOONWELL', name: 'Moonwell' },
        protocol: {
          id: 'MOONWELL_V2',
          name: 'Moonwell V2',
          marketId: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
        },
        asset: {
          symbol: 'USDC',
          contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          decimals: 6,
        },
        network: { id: 'eip155:8453', name: 'Base' },
        sourceKind: 'API',
        sourceReference: 'https://api.moonwell.fi/v1/markets/USDC?chain=base',
      },
      SPARK: {
        provider: { id: 'SPARK', name: 'Spark' },
        protocol: {
          id: 'SPARKLEND',
          name: 'SparkLend',
          marketId: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987',
        },
        asset: {
          symbol: 'USDC',
          contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          decimals: 6,
        },
        network: { id: 'eip155:1', name: 'Ethereum' },
        sourceKind: 'ON_CHAIN',
        sourceReference:
          'https://github.com/sparkdotfi/spark-address-registry/blob/master/src/SparkLend.sol',
      },
      VENUS: {
        provider: { id: 'VENUS', name: 'Venus' },
        protocol: {
          id: 'VENUS_CORE_POOL',
          name: 'Venus Core Pool',
          marketId: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
        },
        asset: {
          symbol: 'USDC',
          contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
          decimals: 18,
        },
        network: { id: 'eip155:56', name: 'BNB Smart Chain' },
        sourceKind: 'API',
        sourceReference:
          'https://api.venus.io/markets?chainId=56&address=0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8&limit=1',
      },
      EULER: {
        provider: { id: 'EULER', name: 'Euler' },
        protocol: {
          id: 'EULER_V2',
          name: 'Euler V2',
          marketId: '0x07954BEB7e137101A7cbb3e47864C684aEC50524',
        },
        asset: {
          symbol: 'USDC',
          contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          decimals: 6,
        },
        network: { id: 'eip155:8453', name: 'Base' },
        sourceKind: 'API',
        sourceReference:
          'https://v3.euler.finance/v3/evk/vaults?chainId=8453&asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&minTvl=100000&limit=100',
      },
      P0: {
        provider: { id: 'P0', name: 'P0' },
        protocol: {
          id: 'MARGINFI_V2',
          name: 'marginfi v2',
          marketId: '2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB',
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
        sourceKind: 'ON_CHAIN',
        sourceReference: 'https://github.com/0dotxyz/p0-ts-sdk',
      },
    });
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
