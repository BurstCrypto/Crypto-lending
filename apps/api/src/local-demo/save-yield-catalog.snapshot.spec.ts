import { SAVE_YIELD_SNAPSHOT } from './save-yield-catalog.snapshot';

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

describe('Save local-demo yield snapshot', () => {
  it('binds the official Solana RPC and Save configuration capture metadata', () => {
    expect(SAVE_YIELD_SNAPSHOT).toMatchObject({
      schemaVersion: 1,
      snapshotId: 'save-official-sources-2026-08-27T00:08:51.427Z',
      capturedAt: '2026-08-27T00:08:51.427Z',
      staleAfter: '2026-08-28T00:08:51.427Z',
      use: 'LOCAL_DEMO_STATIC_CAPTURE_ONLY',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      source: {
        providerId: 'SAVE_OFFICIAL_SOURCES',
        protocolId: 'SOLEND',
        rpcReference: 'https://api.mainnet-beta.solana.com',
        rpcMethod: 'getAccountInfo',
        configurationReference:
          'https://api.save.finance/v1/markets/configs?scope=all&deployment=production',
        requestStartedAt: '2026-08-27T00:08:50.938Z',
        retrievedAt: '2026-08-27T00:08:51.427Z',
        requestBodySha256: '2941db8af5f6c9f1de4504686f076fe47450e57710ab2c1bc61effc3a34a0ba3',
        responseSha256: 'da1d8940bca670134d141bf33e7c0062dce12d975dbe423eb59a67ef40adeebb',
        accountDataSha256: 'cec996f11df59b3491bf800c520a780502fcf92f8f45cca04a428d21473c83d8',
        rawResponseRetained: false,
      },
      mayAuthorizeFinancialAction: false,
    });
    expect(Date.parse(SAVE_YIELD_SNAPSHOT.staleAfter)).toBe(
      Date.parse(SAVE_YIELD_SNAPSHOT.capturedAt) + 24 * 60 * 60 * 1_000,
    );
    expect(Date.parse(SAVE_YIELD_SNAPSHOT.source.requestStartedAt)).toBeLessThanOrEqual(
      Date.parse(SAVE_YIELD_SNAPSHOT.source.retrievedAt),
    );
    for (const digest of [
      SAVE_YIELD_SNAPSHOT.source.requestBodySha256,
      SAVE_YIELD_SNAPSHOT.source.responseSha256,
      SAVE_YIELD_SNAPSHOT.source.accountDataSha256,
    ]) {
      expect(digest).toMatch(SHA256);
    }
  });

  it('retains the exact main-pool USDC observation without claiming execution availability', () => {
    expect(SAVE_YIELD_SNAPSHOT.opportunities).toHaveLength(1);
    const opportunity = SAVE_YIELD_SNAPSHOT.opportunities[0];
    expect(opportunity).toEqual({
      opportunityId:
        'solend:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY:BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
      marketId: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
      reserveId: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
      assetSymbol: 'USDC',
      assetMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      assetDecimals: 6,
      networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      networkName: 'Solana',
      supplyApyRateDecimal: '0.02035785858499506',
      totalSupplyUsdDecimal: '22361108.292043261296455330735951113561',
      totalBorrowUsdDecimal: '16522350.95610992622941903620301953544388',
      availableLiquidityUsdDecimal: '5838758.08804183145367',
      utilizationRateDecimal: '0.7388878129204920274',
      protocolTakeRateDecimal: '0.2',
      providerObservedAt: '2026-08-27T00:02:40.000Z',
      contextSlot: 441_981_658,
      lastUpdateSlot: 441_980_637,
      providerListed: true,
      riskClassification: 'NOT_ASSESSED',
      mayAuthorizeFinancialAction: false,
    });
    if (opportunity === undefined) throw new TypeError('missing Save fixture opportunity');
    expect(Date.parse(opportunity.providerObservedAt)).toBeLessThanOrEqual(
      Date.parse(SAVE_YIELD_SNAPSHOT.capturedAt),
    );
    expect(opportunity.lastUpdateSlot).toBeLessThanOrEqual(opportunity.contextSlot);
    expect(
      compareDecimals(opportunity.totalSupplyUsdDecimal, opportunity.totalBorrowUsdDecimal),
    ).toBe(1);
    expect(
      compareDecimals(opportunity.totalSupplyUsdDecimal, opportunity.availableLiquidityUsdDecimal),
    ).toBe(1);
    expect(compareDecimals(opportunity.utilizationRateDecimal, '1')).not.toBe(1);
    expect(compareDecimals(opportunity.protocolTakeRateDecimal, '1')).not.toBe(1);
    expect(opportunity.mayAuthorizeFinancialAction).toBe(false);
  });

  it('deep-freezes the retained capture boundary', () => {
    expect(Object.isFrozen(SAVE_YIELD_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(SAVE_YIELD_SNAPSHOT.source)).toBe(true);
    expect(Object.isFrozen(SAVE_YIELD_SNAPSHOT.opportunities)).toBe(true);
    expect(Object.isFrozen(SAVE_YIELD_SNAPSHOT.opportunities[0])).toBe(true);
    expect(Object.isFrozen(SAVE_YIELD_SNAPSHOT.disclosures)).toBe(true);
  });
});
