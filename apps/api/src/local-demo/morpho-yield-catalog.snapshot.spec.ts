import { createHash } from 'node:crypto';

import { MORPHO_YIELD_SNAPSHOT } from './morpho-yield-catalog.snapshot';

const PLAIN_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

describe('Morpho local-demo yield snapshot', () => {
  it('binds the exact official query and capture metadata without runtime egress', () => {
    const requestBody = JSON.stringify({ query: MORPHO_YIELD_SNAPSHOT.source.query });

    expect(createHash('sha256').update(requestBody).digest('hex')).toBe(
      MORPHO_YIELD_SNAPSHOT.source.requestBodySha256,
    );
    expect(MORPHO_YIELD_SNAPSHOT.source).toMatchObject({
      reference: 'https://api.morpho.org/graphql',
      responseSha256: '5afd26e631dc47617a3c6e84d0e04e0ac286ef8f175997611aabe937849723b4',
      responseBytes: 4_762,
      rawResponseRetained: false,
      retrievedAt: MORPHO_YIELD_SNAPSHOT.capturedAt,
    });
    expect(Date.parse(MORPHO_YIELD_SNAPSHOT.staleAfter)).toBe(
      Date.parse(MORPHO_YIELD_SNAPSHOT.capturedAt) + 24 * 60 * 60 * 1_000,
    );
    expect(MORPHO_YIELD_SNAPSHOT.mayAuthorizeFinancialAction).toBe(false);
  });

  it('keeps all five provider observations exact, internally reconciled, and non-executable', () => {
    expect(MORPHO_YIELD_SNAPSHOT.opportunities).toHaveLength(5);
    expect(
      new Set(MORPHO_YIELD_SNAPSHOT.opportunities.map(({ opportunityId }) => opportunityId)),
    ).toHaveProperty('size', 5);

    for (const opportunity of MORPHO_YIELD_SNAPSHOT.opportunities) {
      expect(opportunity.providerListed).toBe(true);
      expect(opportunity.riskClassification).toBe('NOT_ASSESSED');
      expect(opportunity.mayAuthorizeFinancialAction).toBe(false);
      expect(Date.parse(opportunity.providerObservedAt)).toBeLessThanOrEqual(
        Date.parse(MORPHO_YIELD_SNAPSHOT.capturedAt),
      );
      expect(BigInt(opportunity.supplyAssetsAtomic) - BigInt(opportunity.borrowAssetsAtomic)).toBe(
        BigInt(opportunity.exitLiquidityAssetsAtomic),
      );

      for (const decimal of [
        opportunity.apyRateDecimal,
        opportunity.tvlUsdDecimal,
        opportunity.exitLiquidityUsdDecimal,
        opportunity.utilizationRateDecimal,
        opportunity.providerFeeRateDecimal,
      ]) {
        expect(decimal).toMatch(PLAIN_DECIMAL);
      }

      expect(Number(opportunity.apyRateDecimal)).toBeGreaterThanOrEqual(0);
      expect(Number(opportunity.utilizationRateDecimal)).toBeGreaterThanOrEqual(0);
      expect(Number(opportunity.utilizationRateDecimal)).toBeLessThanOrEqual(1);
      expect(Object.isFrozen(opportunity)).toBe(true);
      expect(Object.isFrozen(opportunity.rewardAprs)).toBe(true);
    }
  });

  it('retains reward APR separately from the provider base supply APY', () => {
    const rewarded = MORPHO_YIELD_SNAPSHOT.opportunities.find(
      ({ marketId }) =>
        marketId === '0xe3df58f9d3011b7481ff36b939fa5f8da642f34ea5792d25d3958dbf1efa26d7',
    );

    expect(rewarded).toMatchObject({
      apyRateDecimal: '0.05210504022183349',
      rewardAprs: [
        {
          assetSymbol: 'USDC',
          rateDecimal: '0.017398639912427037',
        },
      ],
    });
    expect(Object.isFrozen(MORPHO_YIELD_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(MORPHO_YIELD_SNAPSHOT.source)).toBe(true);
    expect(Object.isFrozen(MORPHO_YIELD_SNAPSHOT.opportunities)).toBe(true);
    expect(Object.isFrozen(MORPHO_YIELD_SNAPSHOT.disclosures)).toBe(true);
  });
});
