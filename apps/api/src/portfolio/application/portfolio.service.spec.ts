import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  type StablecoinPriceObservation,
  type StablecoinValuationAssetReference,
} from '../../valuation';
import type {
  IndexedPortfolioBalanceObservation,
  IndexedPortfolioBalanceSnapshot,
  PortfolioBalanceReader,
  ReadPortfolioBalancesRequest,
} from './ports/portfolio-balance-reader.port';
import type {
  PortfolioPriceEvidenceReader,
  PortfolioPriceEvidenceSnapshot,
  ReadPortfolioPriceEvidenceRequest,
} from './ports/portfolio-price-evidence-reader.port';
import type { UnifiedPortfolio } from '../domain/unified-portfolio';
import { PortfolioService, type PortfolioClock } from './portfolio.service';
import { PortfolioUnavailableError } from './portfolio.errors';

const ACCOUNT_ID = parseAccountId('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
const CORRELATION_ID = '99999999-9999-4999-8999-999999999999';
const EVALUATED_AT = '2026-08-24T18:00:00.000Z';
const WALLET_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALLET_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WALLET_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const SOLANA_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

function balance(
  overrides: Partial<IndexedPortfolioBalanceObservation> &
    Pick<
      IndexedPortfolioBalanceObservation,
      'observationId' | 'walletId' | 'networkId' | 'assetIdentity' | 'amountAtomic'
    >,
): IndexedPortfolioBalanceObservation {
  return {
    observedAt: '2026-08-24T17:59:50.000Z',
    freshnessClass: 'CURRENT',
    ...overrides,
  };
}

function elevenThousandDollarSnapshot(): IndexedPortfolioBalanceSnapshot {
  return {
    snapshotId: 'idx5-snapshot-11000',
    capturedAt: '2026-08-24T17:59:59.000Z',
    freshnessClass: 'CURRENT',
    observations: [
      balance({
        observationId: '11111111-1111-4111-8111-111111111111',
        walletId: WALLET_A,
        networkId: 'eip155:1',
        assetIdentity: ETHEREUM_USDC,
        amountAtomic: '5000000000',
      }),
      balance({
        observationId: '22222222-2222-4222-8222-222222222222',
        walletId: WALLET_A,
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        assetIdentity: SOLANA_USDT,
        amountAtomic: '2500000000',
      }),
      balance({
        observationId: '33333333-3333-4333-8333-333333333333',
        walletId: WALLET_B,
        networkId: 'eip155:8453',
        assetIdentity: BASE_USDC,
        amountAtomic: '3500000000',
      }),
    ],
  };
}

class FakeBalanceReader implements PortfolioBalanceReader {
  readonly requests: ReadPortfolioBalancesRequest[] = [];
  snapshot: IndexedPortfolioBalanceSnapshot = elevenThousandDollarSnapshot();
  failure: Error | null = null;

  readCurrentBalances(
    request: ReadPortfolioBalancesRequest,
  ): Promise<IndexedPortfolioBalanceSnapshot> {
    this.requests.push(request);
    if (this.failure !== null) return Promise.reject(this.failure);
    return Promise.resolve(this.snapshot);
  }
}

class FakePriceReader implements PortfolioPriceEvidenceReader {
  readonly requests: ReadPortfolioPriceEvidenceRequest[] = [];
  readonly failedAssets = new Set<string>();
  ageMs = 10_000;
  malformed = false;

  readPriceEvidence(
    request: ReadPortfolioPriceEvidenceRequest,
  ): Promise<PortfolioPriceEvidenceSnapshot> {
    this.requests.push(request);
    const key = `${request.asset.networkId}:${request.asset.identity}`;
    if (this.failedAssets.has(key)) {
      return Promise.reject(new Error('secret provider host and API response'));
    }
    if (this.malformed) {
      return Promise.resolve({
        snapshotId: 'invalid snapshot ID with spaces',
        observations: [],
        sourceWatermarks: [],
      });
    }
    return Promise.resolve({
      snapshotId: `price-${request.asset.stablecoin}-${this.requests.length}`,
      sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
      observations: this.observations(request.asset, request.evaluatedAt),
    });
  }

  private observations(
    asset: StablecoinValuationAssetReference,
    evaluatedAt: string,
  ): readonly StablecoinPriceObservation[] {
    const pricedAt = new Date(Date.parse(evaluatedAt) - this.ageMs).toISOString();
    return [
      {
        asset,
        sourceId: 'PYTH_CORE',
        sourceReference: STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin].PYTH_CORE,
        sourceSequence: '1',
        sourceUpdateId: '1'.repeat(64),
        pricedAt,
        observedAt: evaluatedAt,
        usdRateMantissa: '100000000',
        usdRateScale: 8,
        confidence: {
          kind: 'PUBLISHED_ABSOLUTE_USD',
          mantissa: '0',
          scale: 8,
        },
      },
      {
        asset,
        sourceId: 'CHAINLINK_DATA_FEEDS',
        sourceReference:
          STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin].CHAINLINK_DATA_FEEDS,
        sourceSequence: '1',
        sourceUpdateId: '1',
        pricedAt,
        observedAt: evaluatedAt,
        usdRateMantissa: '100000000',
        usdRateScale: 8,
        confidence: { kind: 'NOT_PUBLISHED' },
      },
    ];
  }
}

const clock: PortfolioClock = {
  now: () => new Date(EVALUATED_AT),
};

function service(
  balances = new FakeBalanceReader(),
  prices = new FakePriceReader(),
): {
  readonly service: PortfolioService;
  readonly balances: FakeBalanceReader;
  readonly prices: FakePriceReader;
} {
  return {
    service: new PortfolioService(balances, prices, clock),
    balances,
    prices,
  };
}

async function read(portfolio: PortfolioService): Promise<UnifiedPortfolio> {
  return portfolio.readUnifiedPortfolio({
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
  });
}

describe('PortfolioService', () => {
  it("reconciles the epic's fragmented holdings to an exact $11,000 source breakdown", async () => {
    const fixture = service();

    const result = await read(fixture.service);

    expect(result.overallTotal).toEqual({
      usdValue: {
        currency: 'USD',
        mantissa: '11000000000000000000000',
        scale: 18,
        decimal: '11000.000000000000000000',
      },
      freshnessClass: 'CURRENT',
      completeness: 'COMPLETE',
      sourceCount: 3,
      includedSourceCount: 3,
    });
    expect(result.walletTotals).toEqual([
      expect.objectContaining({
        walletId: WALLET_A,
        usdValue: expect.objectContaining({ decimal: '7500.000000000000000000' }),
        sourceCount: 2,
      }),
      expect.objectContaining({
        walletId: WALLET_B,
        usdValue: expect.objectContaining({ decimal: '3500.000000000000000000' }),
        sourceCount: 1,
      }),
    ]);
    expect(result.chainTotals).toEqual([
      expect.objectContaining({
        networkId: 'eip155:1',
        usdValue: expect.objectContaining({ decimal: '5000.000000000000000000' }),
      }),
      expect.objectContaining({
        networkId: 'eip155:8453',
        usdValue: expect.objectContaining({ decimal: '3500.000000000000000000' }),
      }),
      expect.objectContaining({
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        usdValue: expect.objectContaining({ decimal: '2500.000000000000000000' }),
      }),
    ]);
    expect(result.assetTotals).toEqual([
      expect.objectContaining({
        stablecoin: 'USDC',
        usdValue: expect.objectContaining({ decimal: '8500.000000000000000000' }),
      }),
      expect.objectContaining({
        stablecoin: 'USDT',
        usdValue: expect.objectContaining({ decimal: '2500.000000000000000000' }),
      }),
    ]);
    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({
      walletId: WALLET_A,
      networkId: 'eip155:1',
      balance: { atomic: '5000000000', decimals: 6, decimal: '5000.000000' },
      includedInOverallTotal: true,
      valuation: {
        availability: 'AVAILABLE',
        policyApprovalState: 'PENDING_EXTERNAL_APPROVAL',
        reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
        mayIncreaseBuyingPower: false,
        mayAuthorizeFinancialUse: false,
      },
    });
    expect(result).toMatchObject({
      schemaVersion: 1,
      asOf: EVALUATED_AT,
      balanceSnapshot: {
        snapshotId: 'idx5-snapshot-11000',
        capturedAt: '2026-08-24T17:59:59.000Z',
        freshnessClass: 'CURRENT',
      },
      oldestBalanceObservedAt: '2026-08-24T17:59:50.000Z',
      reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
      mayIncreaseBuyingPower: false,
      mayAuthorizeFinancialUse: false,
    });
    expect(fixture.prices.requests).toHaveLength(3);
  });

  it('binds the balance read to only the authenticated account and trusted clock', async () => {
    const fixture = service();

    await read(fixture.service);

    expect(fixture.balances.requests).toEqual([
      {
        accountId: ACCOUNT_ID,
        evaluatedAt: EVALUATED_AT,
        correlationId: CORRELATION_ID,
      },
    ]);
    expect(JSON.stringify(fixture.balances.snapshot)).not.toContain(ACCOUNT_ID);
  });

  it('keeps stale indexed balances in reporting value while flagging every affected total', async () => {
    const fixture = service();
    fixture.balances.snapshot = {
      ...fixture.balances.snapshot,
      observations: fixture.balances.snapshot.observations.map((observation) =>
        observation.walletId === WALLET_A && observation.networkId.startsWith('solana:')
          ? { ...observation, freshnessClass: 'STALE' as const }
          : observation,
      ),
    };

    const result = await read(fixture.service);

    expect(result.overallTotal).toMatchObject({
      usdValue: { decimal: '11000.000000000000000000' },
      freshnessClass: 'STALE',
      completeness: 'COMPLETE',
    });
    expect(result.walletTotals.find(({ walletId }) => walletId === WALLET_A)).toMatchObject({
      freshnessClass: 'STALE',
    });
    expect(result.sources.find(({ networkId }) => networkId.startsWith('solana:'))).toMatchObject({
      balanceFreshnessClass: 'STALE',
      freshnessClass: 'STALE',
      includedInOverallTotal: true,
    });
  });

  it('excludes unsupported assets without calling the price boundary or inflating the total', async () => {
    const fixture = service();
    fixture.balances.snapshot = {
      ...fixture.balances.snapshot,
      observations: [
        ...fixture.balances.snapshot.observations,
        balance({
          observationId: '44444444-4444-4444-8444-444444444444',
          walletId: WALLET_C,
          networkId: 'eip155:1',
          assetIdentity: `0x${'44'.repeat(20)}`,
          amountAtomic: '900000000000000000000000000000',
        }),
      ],
    };

    const result = await read(fixture.service);

    expect(result.overallTotal).toMatchObject({
      usdValue: { decimal: '11000.000000000000000000' },
      freshnessClass: 'UNAVAILABLE',
      completeness: 'PARTIAL',
      sourceCount: 4,
      includedSourceCount: 3,
    });
    expect(result.excludedSources).toEqual([
      expect.objectContaining({
        walletId: WALLET_C,
        reason: 'UNSUPPORTED_ASSET',
        includedInOverallTotal: false,
      }),
    ]);
    expect(result.walletTotals.find(({ walletId }) => walletId === WALLET_C)).toMatchObject({
      usdValue: null,
      freshnessClass: 'UNAVAILABLE',
      completeness: 'UNAVAILABLE',
    });
    expect(fixture.prices.requests).toHaveLength(3);
  });

  it('preserves an unpriced supported balance but excludes it from every monetary total', async () => {
    const fixture = service();
    fixture.prices.failedAssets.add(`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${SOLANA_USDT}`);

    const result = await read(fixture.service);

    expect(result.overallTotal).toMatchObject({
      usdValue: { decimal: '8500.000000000000000000' },
      freshnessClass: 'UNAVAILABLE',
      completeness: 'PARTIAL',
      sourceCount: 3,
      includedSourceCount: 2,
    });
    expect(result.sources.find(({ asset }) => asset.stablecoin === 'USDT')).toMatchObject({
      includedInOverallTotal: false,
      usdValue: null,
      freshnessClass: 'UNAVAILABLE',
      valuation: {
        priceSnapshotId: null,
        availability: 'UNAVAILABLE',
        freshnessClass: 'UNAVAILABLE',
        reasons: ['NO_ELIGIBLE_SOURCE'],
      },
    });
    expect(result.assetTotals.find(({ stablecoin }) => stablecoin === 'USDT')).toMatchObject({
      usdValue: null,
      completeness: 'UNAVAILABLE',
    });
    expect(JSON.stringify(result)).not.toContain('secret provider host');
  });

  it('treats stale price evidence as unavailable instead of silently reusing it', async () => {
    const fixture = service();
    fixture.prices.ageMs = 60_001;

    const result = await read(fixture.service);

    expect(result.overallTotal).toMatchObject({
      usdValue: null,
      freshnessClass: 'UNAVAILABLE',
      completeness: 'UNAVAILABLE',
      sourceCount: 3,
      includedSourceCount: 0,
    });
    expect(result.sources.every((source) => !source.includedInOverallTotal)).toBe(true);
    expect(result.sources.every((source) => source.valuation.availability === 'UNAVAILABLE')).toBe(
      true,
    );
  });

  it('represents a successful empty current snapshot as exact zero, not unavailable data', async () => {
    const fixture = service();
    fixture.balances.snapshot = {
      snapshotId: 'idx5-empty-snapshot',
      capturedAt: '2026-08-24T17:59:59.000Z',
      freshnessClass: 'CURRENT',
      observations: [],
    };

    const result = await read(fixture.service);

    expect(result.overallTotal).toEqual({
      usdValue: {
        currency: 'USD',
        mantissa: '0',
        scale: 18,
        decimal: '0.000000000000000000',
      },
      freshnessClass: 'CURRENT',
      completeness: 'COMPLETE',
      sourceCount: 0,
      includedSourceCount: 0,
    });
    expect(result.sources).toEqual([]);
    expect(fixture.prices.requests).toEqual([]);
  });

  it('never presents an old empty account snapshot as a fresh zero', async () => {
    const fixture = service();
    fixture.balances.snapshot = {
      snapshotId: 'idx5-stale-empty-snapshot',
      capturedAt: '2026-08-24T17:00:00.000Z',
      freshnessClass: 'STALE',
      observations: [],
    };

    const result = await read(fixture.service);

    expect(result.balanceSnapshot.freshnessClass).toBe('STALE');
    expect(result.overallTotal).toMatchObject({
      usdValue: { decimal: '0.000000000000000000' },
      freshnessClass: 'STALE',
      completeness: 'COMPLETE',
      sourceCount: 0,
    });
  });

  it('fails the whole read closed for unavailable, malformed, or duplicate balance snapshots', async () => {
    const fixture = service();
    fixture.balances.failure = new Error('database DSN and sensitive row detail');
    await expect(read(fixture.service)).rejects.toEqual(new PortfolioUnavailableError());

    fixture.balances.failure = null;
    const first = fixture.balances.snapshot.observations[0];
    if (!first) throw new Error('fixture missing');
    fixture.balances.snapshot = {
      ...fixture.balances.snapshot,
      observations: [first, { ...first }],
    };
    await expect(read(fixture.service)).rejects.toEqual(new PortfolioUnavailableError());
    await expect(read(fixture.service)).rejects.not.toThrow('database DSN');
  });

  it('reduces malformed price evidence to unavailable valuation without exposing raw fields', async () => {
    const fixture = service();
    fixture.prices.malformed = true;

    const result = await read(fixture.service);

    expect(result.overallTotal.usdValue).toBeNull();
    expect(result.sources.every((source) => source.valuation.priceSnapshotId === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('invalid snapshot ID with spaces');
  });

  it('rejects untrusted request correlation and clock values before a balance read', async () => {
    const fixture = service();
    await expect(
      fixture.service.readUnifiedPortfolio({
        accountId: ACCOUNT_ID,
        correlationId: 'not-a-correlation',
      }),
    ).rejects.toEqual(new PortfolioUnavailableError());
    expect(fixture.balances.requests).toEqual([]);

    const badClockService = new PortfolioService(fixture.balances, fixture.prices, {
      now: () => new Date('invalid'),
    });
    await expect(read(badClockService)).rejects.toEqual(new PortfolioUnavailableError());
    expect(fixture.balances.requests).toEqual([]);
  });
});
