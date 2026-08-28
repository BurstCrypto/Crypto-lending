import { ADDITIONAL_PROVIDER_YIELD_SNAPSHOT } from './additional-provider-yield-catalog.snapshot';

const PLAIN_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function exactDecimal(value: string): Readonly<{ numerator: bigint; scale: number }> {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(value);
  if (!match || match[1] === undefined) throw new TypeError('invalid fixture decimal');
  const fraction = match[2] ?? '';
  return Object.freeze({ numerator: BigInt(`${match[1]}${fraction}`), scale: fraction.length });
}

function compareDecimals(leftValue: string, rightValue: string): number {
  const left = exactDecimal(leftValue);
  const right = exactDecimal(rightValue);
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = left.numerator * 10n ** BigInt(scale - left.scale);
  const rightScaled = right.numerator * 10n ** BigInt(scale - right.scale);
  return leftScaled === rightScaled ? 0 : leftScaled > rightScaled ? 1 : -1;
}

describe('additional-provider local-demo yield snapshot', () => {
  it('retains exactly six distinct provider, protocol, and network identities', () => {
    const opportunities = ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.opportunities;

    expect(
      opportunities.map(
        ({
          opportunityId,
          ecosystem,
          providerId,
          providerName,
          protocolId,
          protocolName,
          marketId,
          assetContract,
          assetDecimals,
          networkId,
          networkName,
          source,
        }) => ({
          opportunityId,
          ecosystem,
          providerId,
          providerName,
          protocolId,
          protocolName,
          marketId,
          assetContract,
          assetDecimals,
          networkId,
          networkName,
          sourceKind: source.kind,
          sourceReference: source.reference,
        }),
      ),
    ).toEqual([
      {
        opportunityId: 'compound-iii:eip155:8453:0xb125E6687d4313864e53df431d5425969c15Eb2F:USDC',
        ecosystem: 'EVM',
        providerId: 'COMPOUND',
        providerName: 'Compound',
        protocolId: 'COMPOUND_III',
        protocolName: 'Compound III',
        marketId: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
        assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        assetDecimals: 6,
        networkId: 'eip155:8453',
        networkName: 'Base',
        sourceKind: 'ON_CHAIN',
        sourceReference:
          'https://raw.githubusercontent.com/compound-finance/comet/f766f51583c23acc33b2a7824654ef2029a96804/deployments/base/usdc/roots.json',
      },
      {
        opportunityId: 'moonwell-v2:eip155:8453:0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22:USDC',
        ecosystem: 'EVM',
        providerId: 'MOONWELL',
        providerName: 'Moonwell',
        protocolId: 'MOONWELL_V2',
        protocolName: 'Moonwell V2',
        marketId: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',
        assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        assetDecimals: 6,
        networkId: 'eip155:8453',
        networkName: 'Base',
        sourceKind: 'API',
        sourceReference: 'https://api.moonwell.fi/v1/markets/USDC?chain=base',
      },
      {
        opportunityId: 'sparklend:eip155:1:0xC13e21B648A5Ee794902342038FF3aDAB66BE987:USDC',
        ecosystem: 'EVM',
        providerId: 'SPARK',
        providerName: 'Spark',
        protocolId: 'SPARKLEND',
        protocolName: 'SparkLend',
        marketId: '0xC13e21B648A5Ee794902342038FF3aDAB66BE987',
        assetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        assetDecimals: 6,
        networkId: 'eip155:1',
        networkName: 'Ethereum',
        sourceKind: 'ON_CHAIN',
        sourceReference:
          'https://github.com/sparkdotfi/spark-address-registry/blob/master/src/SparkLend.sol',
      },
      {
        opportunityId: 'venus-core:eip155:56:0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8:USDC',
        ecosystem: 'EVM',
        providerId: 'VENUS',
        providerName: 'Venus',
        protocolId: 'VENUS_CORE_POOL',
        protocolName: 'Venus Core Pool',
        marketId: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
        assetContract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        assetDecimals: 18,
        networkId: 'eip155:56',
        networkName: 'BNB Smart Chain',
        sourceKind: 'API',
        sourceReference:
          'https://api.venus.io/markets?chainId=56&address=0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8&limit=1',
      },
      {
        opportunityId: 'euler-v2:eip155:8453:0x07954BEB7e137101A7cbb3e47864C684aEC50524:USDC',
        ecosystem: 'EVM',
        providerId: 'EULER',
        providerName: 'Euler',
        protocolId: 'EULER_V2',
        protocolName: 'Euler V2',
        marketId: '0x07954BEB7e137101A7cbb3e47864C684aEC50524',
        assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        assetDecimals: 6,
        networkId: 'eip155:8453',
        networkName: 'Base',
        sourceKind: 'API',
        sourceReference:
          'https://v3.euler.finance/v3/evk/vaults?chainId=8453&asset=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&minTvl=100000&limit=100',
      },
      {
        opportunityId:
          'marginfi-v2:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB:USDC',
        ecosystem: 'SOLANA',
        providerId: 'P0',
        providerName: 'P0',
        protocolId: 'MARGINFI_V2',
        protocolName: 'marginfi v2',
        marketId: '2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB',
        assetContract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        assetDecimals: 6,
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        networkName: 'Solana',
        sourceKind: 'ON_CHAIN',
        sourceReference: 'https://github.com/0dotxyz/p0-ts-sdk',
      },
    ]);

    expect(opportunities).toHaveLength(6);
    expect(new Set(opportunities.map(({ opportunityId }) => opportunityId)).size).toBe(6);
    expect(new Set(opportunities.map(({ providerId }) => providerId)).size).toBe(6);
    expect(new Set(opportunities.map(({ protocolId }) => protocolId)).size).toBe(6);
    expect(new Set(opportunities.map(({ source }) => source.id)).size).toBe(6);
    expect(JSON.stringify(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT)).not.toMatch(/drift/iu);
  });

  it('binds coherent capture times and SHA-256 provenance', () => {
    const capturedAt = Date.parse(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.capturedAt);
    const staleAfter = Date.parse(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.staleAfter);

    expect(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT).toMatchObject({
      schemaVersion: 1,
      snapshotId: 'additional-providers-2026-08-27T01:04:48.000Z',
      capturedAt: '2026-08-27T01:04:48.000Z',
      staleAfter: '2026-08-28T01:04:48.000Z',
      source: {
        providerId: 'MULTI_PROVIDER_OFFICIAL_SOURCES',
        rawResponseRetained: false,
      },
    });
    expect(Number.isFinite(capturedAt)).toBe(true);
    expect(staleAfter).toBe(capturedAt + 24 * 60 * 60 * 1_000);

    for (const opportunity of ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.opportunities) {
      const providerObservedAt = Date.parse(opportunity.providerObservedAt);
      const retrievedAt = Date.parse(opportunity.source.retrievedAt);
      expect(Number.isFinite(providerObservedAt)).toBe(true);
      expect(Number.isFinite(retrievedAt)).toBe(true);
      expect(providerObservedAt).toBeLessThanOrEqual(retrievedAt);
      expect(retrievedAt).toBeLessThanOrEqual(capturedAt);
      expect(opportunity.source.reference).toMatch(/^https:\/\//u);
      expect(opportunity.source.payloadSha256).toMatch(SHA256);

      for (const attribute of opportunity.source.attributes) {
        if (attribute.key.endsWith('sha256')) expect(attribute.value).toMatch(SHA256);
      }
    }
  });

  it("retains P0's exact pinned-SDK and Solana RPC capture evidence", () => {
    const opportunity = ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.opportunities.find(
      ({ providerId }) => providerId === 'P0',
    );
    if (!opportunity) throw new TypeError('missing P0 fixture');

    expect(opportunity).toMatchObject({
      supplyApyRateDecimal: '0.031252082831978',
      totalSupplyUsdDecimal: '9697689.250588862922',
      totalBorrowUsdDecimal: '7629518.824874962349',
      availableLiquidityUsdDecimal: '2068170.425713900573',
      utilizationRateDecimal: '0.78673574990162556888',
      providerObservedAt: '2026-08-27T01:02:13.000Z',
      source: {
        kind: 'ON_CHAIN',
        id: 'solana:441990796:2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB',
        reference: 'https://github.com/0dotxyz/p0-ts-sdk',
        retrievedAt: '2026-08-27T01:04:47.998Z',
        payloadSha256: '04fff651b4baa1e7de05b436dc508f471c6f3200a49e257aaf1df75398a795b0',
      },
    });

    const attributes = Object.fromEntries(
      opportunity.source.attributes.map(({ key, value }) => [key, value]),
    );
    expect(attributes).toEqual({
      'chain.slot': '441990796',
      'market.asset_tag': 'DEFAULT',
      'market.operational_state': 'Operational',
      'rate.raw_lending_apr': '0.030773732397326756',
      'rate.normalization': 'HOURLY_COMPOUNDING',
      'rate.compounding_periods_per_year': '8766',
      'rate.compounding_convention': 'SDK_365.25_DAY_YEAR_HOURLY',
      'sdk.package': '@0dotxyz/p0-ts-sdk',
      'sdk.version': '2.7.3',
      'sdk.commit': 'ebfe29cee843307242144039e604050f86e9d054',
      'rpc.reference': 'https://api.mainnet-beta.solana.com',
      'rpc.method': 'getAccountInfo',
      'valuation.usd_basis': 'USDC_UNITS_AT_LOCAL_1_USD_DISPLAY_PROXY',
      'snapshot.bank_account_sha256':
        '04fff651b4baa1e7de05b436dc508f471c6f3200a49e257aaf1df75398a795b0',
    });

    const lendingApr = Number(attributes['rate.raw_lending_apr']);
    const periodsPerYear = Number(attributes['rate.compounding_periods_per_year']);
    const normalizedApy = (1 + lendingApr / periodsPerYear) ** periodsPerYear - 1;
    expect(Math.abs(normalizedApy - Number(opportunity.supplyApyRateDecimal))).toBeLessThan(1e-12);
    expect(JSON.stringify(opportunity)).not.toMatch(/jupiter/iu);
  });

  it('keeps every point-in-time economic observation internally sane', () => {
    for (const opportunity of ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.opportunities) {
      const decimals = [
        opportunity.supplyApyRateDecimal,
        opportunity.totalSupplyUsdDecimal,
        opportunity.totalBorrowUsdDecimal,
        opportunity.availableLiquidityUsdDecimal,
        opportunity.utilizationRateDecimal,
      ];
      for (const decimal of decimals) expect(decimal).toMatch(PLAIN_DECIMAL);

      expect(compareDecimals(opportunity.supplyApyRateDecimal, '0')).toBe(1);
      expect(compareDecimals(opportunity.supplyApyRateDecimal, '1')).not.toBe(1);
      expect(compareDecimals(opportunity.totalSupplyUsdDecimal, '0')).toBe(1);
      expect(compareDecimals(opportunity.totalBorrowUsdDecimal, '0')).toBe(1);
      expect(compareDecimals(opportunity.availableLiquidityUsdDecimal, '0')).toBe(1);
      expect(
        compareDecimals(opportunity.totalSupplyUsdDecimal, opportunity.totalBorrowUsdDecimal),
      ).toBe(1);
      expect(
        compareDecimals(
          opportunity.totalSupplyUsdDecimal,
          opportunity.availableLiquidityUsdDecimal,
        ),
      ).not.toBe(-1);
      expect(compareDecimals(opportunity.utilizationRateDecimal, '0')).toBe(1);
      expect(compareDecimals(opportunity.utilizationRateDecimal, '1')).not.toBe(1);

      const utilization = Number(opportunity.utilizationRateDecimal);
      const impliedUtilization =
        Number(opportunity.totalBorrowUsdDecimal) / Number(opportunity.totalSupplyUsdDecimal);
      expect(Math.abs(utilization - impliedUtilization)).toBeLessThan(1e-8);
    }
  });

  it('deep-freezes a non-executable, risk-not-assessed fixture boundary', () => {
    expect(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT).toMatchObject({
      use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      mayAuthorizeFinancialAction: false,
    });
    expect(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.disclosures).toEqual(
      expect.arrayContaining([
        'No opportunity has a risk, eligibility, or execution approval.',
        'Only base supply APY is retained; reward and promotional APRs are excluded.',
      ]),
    );
    expect(Object.isFrozen(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.source)).toBe(true);
    expect(Object.isFrozen(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.opportunities)).toBe(true);
    expect(Object.isFrozen(ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.disclosures)).toBe(true);

    for (const opportunity of ADDITIONAL_PROVIDER_YIELD_SNAPSHOT.opportunities) {
      expect(opportunity).toMatchObject({
        assetSymbol: 'USDC',
        providerListed: true,
        riskClassification: 'NOT_ASSESSED',
        mayAuthorizeFinancialAction: false,
      });
      expect(Object.isFrozen(opportunity)).toBe(true);
      expect(Object.isFrozen(opportunity.source)).toBe(true);
      expect(Object.isFrozen(opportunity.source.attributes)).toBe(true);
      for (const attribute of opportunity.source.attributes) {
        expect(Object.isFrozen(attribute)).toBe(true);
      }
    }
  });
});
