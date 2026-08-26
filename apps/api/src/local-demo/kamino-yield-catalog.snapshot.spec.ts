import { KAMINO_YIELD_SNAPSHOT } from './kamino-yield-catalog.snapshot';

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

describe('Kamino local-demo yield snapshot', () => {
  it('binds the official main-market metrics endpoint and immutable capture metadata', () => {
    expect(KAMINO_YIELD_SNAPSHOT).toMatchObject({
      schemaVersion: 1,
      snapshotId: 'kamino-public-api-2026-08-26T21:20:06.659Z',
      capturedAt: '2026-08-26T21:20:06.659Z',
      staleAfter: '2026-08-27T21:20:06.659Z',
      use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      source: {
        providerId: 'KAMINO_PUBLIC_API',
        protocolId: 'KAMINO_LEND',
        reference:
          'https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics?env=mainnet-beta',
        responseSha256: '5e818a2e995ef0b0e1cfc1f6a2762cac5825a4d470d0bf1835e52b5f9b16f109',
        rawResponseRetained: false,
      },
      mayAuthorizeFinancialAction: false,
    });
    expect(Date.parse(KAMINO_YIELD_SNAPSHOT.staleAfter)).toBe(
      Date.parse(KAMINO_YIELD_SNAPSHOT.capturedAt) + 24 * 60 * 60 * 1_000,
    );
    expect(KAMINO_YIELD_SNAPSHOT.source.responseSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('retains the exact USDC reserve observation without claiming execution availability', () => {
    expect(KAMINO_YIELD_SNAPSHOT.opportunities).toHaveLength(1);
    const opportunity = KAMINO_YIELD_SNAPSHOT.opportunities[0];
    expect(opportunity).toEqual({
      opportunityId:
        'kamino-lend:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF:D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
      marketId: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
      reserveId: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
      assetSymbol: 'USDC',
      assetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      assetDecimals: 6,
      networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      networkName: 'Solana',
      supplyApyRateDecimal: '0.04542148187048922',
      totalSupplyUsdDecimal: '109125834.79081585224',
      totalBorrowUsdDecimal: '100844813.2475332357427599269456163239444',
      providerObservedAt: '2026-08-26T21:20:06.659Z',
      providerListed: true,
      riskClassification: 'NOT_ASSESSED',
      mayAuthorizeFinancialAction: false,
    });
    if (opportunity === undefined) throw new TypeError('missing Kamino fixture opportunity');
    expect(
      compareDecimals(opportunity.totalSupplyUsdDecimal, opportunity.totalBorrowUsdDecimal),
    ).toBe(1);
    expect(opportunity.mayAuthorizeFinancialAction).toBe(false);
  });

  it('deep-freezes the retained capture boundary', () => {
    expect(Object.isFrozen(KAMINO_YIELD_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(KAMINO_YIELD_SNAPSHOT.source)).toBe(true);
    expect(Object.isFrozen(KAMINO_YIELD_SNAPSHOT.opportunities)).toBe(true);
    expect(Object.isFrozen(KAMINO_YIELD_SNAPSHOT.opportunities[0])).toBe(true);
    expect(Object.isFrozen(KAMINO_YIELD_SNAPSHOT.disclosures)).toBe(true);
  });
});
