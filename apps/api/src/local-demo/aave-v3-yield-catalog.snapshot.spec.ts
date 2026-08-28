import { AAVE_V3_YIELD_SNAPSHOT } from './aave-v3-yield-catalog.snapshot';

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

describe('Aave V3 local-demo yield snapshot', () => {
  it('binds the official GraphQL capture metadata without runtime egress', () => {
    expect(AAVE_V3_YIELD_SNAPSHOT).toMatchObject({
      schemaVersion: 1,
      snapshotId: 'aave-v3-public-api-2026-08-27T00:09:16.195Z',
      capturedAt: '2026-08-27T00:09:16.195Z',
      staleAfter: '2026-08-28T00:09:16.195Z',
      use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      source: {
        providerId: 'AAVE_PUBLIC_API',
        protocolId: 'AAVE_V3',
        reference: 'https://api.v3.aave.com/graphql',
        requestStartedAt: '2026-08-27T00:09:15.945Z',
        retrievedAt: '2026-08-27T00:09:16.195Z',
        requestBodySha256: '19e7ab9e9e80e7ebf47ecaaa2b89cd9721161cb82cf8623897420d12dcc1082e',
        responseSha256: 'ade2f90a3ba5542cd1d502ae6dea1f8b95ef1dfac80a7a5990389500b056c134',
        responseBytes: 2_327,
        rawResponseRetained: false,
      },
      mayAuthorizeFinancialAction: false,
    });
    expect(Date.parse(AAVE_V3_YIELD_SNAPSHOT.staleAfter)).toBe(
      Date.parse(AAVE_V3_YIELD_SNAPSHOT.capturedAt) + 24 * 60 * 60 * 1_000,
    );
    expect(Date.parse(AAVE_V3_YIELD_SNAPSHOT.source.requestStartedAt)).toBeLessThanOrEqual(
      Date.parse(AAVE_V3_YIELD_SNAPSHOT.source.retrievedAt),
    );
    expect(AAVE_V3_YIELD_SNAPSHOT.source.requestBodySha256).toMatch(SHA256);
    expect(AAVE_V3_YIELD_SNAPSHOT.source.responseSha256).toMatch(SHA256);
  });

  it('retains the three exact stablecoin observations with official pool and token identities', () => {
    expect(AAVE_V3_YIELD_SNAPSHOT.opportunities).toEqual([
      expect.objectContaining({
        marketId: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
        assetSymbol: 'USDC',
        assetContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        networkId: 'eip155:8453',
        supplyApyRateDecimal: '0.030971355791245742167875921',
        totalSupplyUsdDecimal: '177480406.6310846789128',
        totalBorrowUsdDecimal: '146118149.1126589071056',
        availableLiquidityUsdDecimal: '31362226.6433556342682',
        utilizationRateDecimal: '0.823291862495998711203455152',
        reserveFactorRateDecimal: '0.10',
      }),
      expect.objectContaining({
        marketId: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
        assetSymbol: 'USDC',
        assetContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        networkId: 'eip155:1',
        supplyApyRateDecimal: '0.098884748614322825628319949',
        totalSupplyUsdDecimal: '2079223526.38491297289368',
        totalBorrowUsdDecimal: '2025270598.6261549579563',
        availableLiquidityUsdDecimal: '53952926.20723198965879',
        utilizationRateDecimal: '0.974051406420310022203987122',
        reserveFactorRateDecimal: '0.10',
      }),
      expect.objectContaining({
        marketId: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
        assetSymbol: 'USDT',
        assetContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        networkId: 'eip155:1',
        supplyApyRateDecimal: '0.041491952326748560387498417',
        totalSupplyUsdDecimal: '2922148236.32074954660324',
        totalBorrowUsdDecimal: '2708783408.16643855376664',
        availableLiquidityUsdDecimal: '213364827.32304709491786',
        utilizationRateDecimal: '0.92698357163003176629998691',
        reserveFactorRateDecimal: '0.10',
      }),
    ]);
    expect(
      new Set(AAVE_V3_YIELD_SNAPSHOT.opportunities.map(({ opportunityId }) => opportunityId)),
    ).toHaveProperty('size', 3);

    for (const opportunity of AAVE_V3_YIELD_SNAPSHOT.opportunities) {
      expect(opportunity.assetDecimals).toBe(6);
      expect(opportunity.providerListed).toBe(true);
      expect(opportunity.riskClassification).toBe('NOT_ASSESSED');
      expect(opportunity.mayAuthorizeFinancialAction).toBe(false);
      expect(opportunity.providerObservedAt).toBe(AAVE_V3_YIELD_SNAPSHOT.capturedAt);
      for (const decimal of [
        opportunity.supplyApyRateDecimal,
        opportunity.totalSupplyUsdDecimal,
        opportunity.totalBorrowUsdDecimal,
        opportunity.availableLiquidityUsdDecimal,
        opportunity.utilizationRateDecimal,
        opportunity.reserveFactorRateDecimal,
      ]) {
        expect(decimal).toMatch(PLAIN_DECIMAL);
      }
      expect(
        compareDecimals(opportunity.totalSupplyUsdDecimal, opportunity.totalBorrowUsdDecimal),
      ).toBe(1);
      expect(
        compareDecimals(
          opportunity.totalSupplyUsdDecimal,
          opportunity.availableLiquidityUsdDecimal,
        ),
      ).toBe(1);
      expect(compareDecimals(opportunity.utilizationRateDecimal, '1')).not.toBe(1);
      expect(compareDecimals(opportunity.reserveFactorRateDecimal, '1')).not.toBe(1);
      expect(Object.isFrozen(opportunity)).toBe(true);
    }
  });

  it('deep-freezes the retained capture boundary', () => {
    expect(Object.isFrozen(AAVE_V3_YIELD_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(AAVE_V3_YIELD_SNAPSHOT.source)).toBe(true);
    expect(Object.isFrozen(AAVE_V3_YIELD_SNAPSHOT.opportunities)).toBe(true);
    expect(Object.isFrozen(AAVE_V3_YIELD_SNAPSHOT.disclosures)).toBe(true);
  });
});
