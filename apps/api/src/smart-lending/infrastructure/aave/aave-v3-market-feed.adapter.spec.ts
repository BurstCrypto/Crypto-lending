import type { ProviderNativeLendingMarketReader } from '../../application/ports/provider-native-lending-market-reader.port';
import type { AaveV3EthereumMarketExternalFeedClient } from '../external-feeds/smart-lending-external-feed.client';
import {
  AaveV3EthereumMarketFeedAdapter,
  AaveV3EthereumMarketUnavailableError,
} from './aave-v3-market-feed.adapter';
import * as parserModule from './aave-v3-market-feed.parser';
import type { AaveV3EthereumLendingMarketSnapshot } from './aave-v3-market-feed.parser';
import { AAVE_V3_ETHEREUM_CORE_MARKET } from './aave-v3-market-feed.query';

const EVALUATED_AT = '2026-09-03T18:00:00.000Z';
const CORRELATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

function decimal(raw: string, decimals: number, value: string): Record<string, unknown> {
  return { raw, decimals, value };
}

function amount(raw: string, value: string): Record<string, unknown> {
  return { amount: decimal(raw, 6, value) };
}

function reserve(
  symbol: 'USDC' | 'USDT',
  address: string,
  totalRaw: string,
  totalValue: string,
  capRaw: string,
  capValue: string,
): Record<string, unknown> {
  return {
    underlyingToken: { address, chainId: 1, symbol, decimals: 6 },
    size: amount(totalRaw, totalValue),
    supplyInfo: {
      apy: decimal('35929627642855128655257443', 27, '0.035929627642855128655257443'),
      supplyCap: amount(capRaw, capValue),
      supplyCapReached: false,
      total: decimal(totalRaw, 6, totalValue),
    },
    borrowInfo: {
      availableLiquidity: amount('12000000', '12'),
      reserveFactor: decimal('1000', 4, '0.10'),
    },
    isFrozen: false,
    isPaused: false,
  };
}

function validResponse(): Record<string, unknown> {
  return {
    data: {
      market: {
        address: AAVE_V3_ETHEREUM_CORE_MARKET,
        chain: { chainId: 1, isTestnet: false },
        reserves: [
          reserve('USDC', USDC, '100000000', '100', '200000000', '200'),
          reserve('USDT', USDT, '80000000', '80', '0', '0'),
        ],
      },
    },
  };
}

function externalFeed(implementation: () => Promise<unknown>): {
  readonly client: AaveV3EthereumMarketExternalFeedClient;
  readonly readEthereumCoreMarket: jest.Mock;
} {
  const readEthereumCoreMarket = jest.fn(implementation);
  return { client: { readEthereumCoreMarket }, readEthereumCoreMarket };
}

function request(): { readonly evaluatedAt: string; readonly correlationId: string } {
  return { evaluatedAt: EVALUATED_AT, correlationId: CORRELATION_ID };
}

describe('AaveV3EthereumMarketFeedAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('calls only the fixed Ethereum Core read and returns non-eligible provider evidence', async () => {
    const feed = externalFeed(async () => validResponse());
    const adapter = new AaveV3EthereumMarketFeedAdapter(feed.client);
    const genericReader: ProviderNativeLendingMarketReader = adapter;
    const snapshot = await adapter.readCurrentMarkets(request());

    expect(feed.readEthereumCoreMarket).toHaveBeenCalledTimes(1);
    expect(feed.readEthereumCoreMarket).toHaveBeenCalledWith();
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      sourceId: 'AAVE_V3_GRAPHQL',
      use: 'PROVIDER_NATIVE_CORROBORATION_ONLY',
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      retrievedAt: EVALUATED_AT,
      validUntil: '2026-09-03T18:01:00.000Z',
      providerCoverage: ['aave'],
    });
    expect(snapshot.observations.map(({ assetSymbol }) => assetSymbol)).toEqual(['USDC', 'USDT']);
    expect(
      snapshot.observations.every(({ providerSupplyStatus }) => providerSupplyStatus === 'OPEN'),
    ).toBe(true);
    expect(genericReader).toBe(adapter);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.observations.every(Object.isFrozen)).toBe(true);
  });

  it.each(['2026-09-03T18:00:00Z', '2026-09-03T18:00:00.000+00:00', 'invalid', '', null])(
    'rejects a non-canonical evaluatedAt before I/O: %#',
    async (evaluatedAt) => {
      const feed = externalFeed(async () => validResponse());
      await expect(
        new AaveV3EthereumMarketFeedAdapter(feed.client).readCurrentMarkets({
          ...request(),
          evaluatedAt: evaluatedAt as string,
        }),
      ).rejects.toEqual(new AaveV3EthereumMarketUnavailableError());
      expect(feed.readEthereumCoreMarket).not.toHaveBeenCalled();
    },
  );

  it.each([
    'not-a-correlation-id',
    'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  ])('rejects a non-canonical UUIDv4 before I/O: %s', async (correlationId) => {
    const feed = externalFeed(async () => validResponse());
    await expect(
      new AaveV3EthereumMarketFeedAdapter(feed.client).readCurrentMarkets({
        ...request(),
        correlationId,
      }),
    ).rejects.toEqual(new AaveV3EthereumMarketUnavailableError());
    expect(feed.readEthereumCoreMarket).not.toHaveBeenCalled();
  });

  it('sanitizes an accessor-backed request before crossing the external boundary', async () => {
    const feed = externalFeed(async () => validResponse());
    const malformed = Object.create(null) as Record<string, unknown>;
    const getter = jest.fn(() => {
      throw new Error('untrusted request detail');
    });
    Object.defineProperty(malformed, 'evaluatedAt', { enumerable: true, get: getter });

    await expect(
      new AaveV3EthereumMarketFeedAdapter(feed.client).readCurrentMarkets(
        malformed as unknown as ReturnType<typeof request>,
      ),
    ).rejects.toEqual(new AaveV3EthereumMarketUnavailableError());
    expect(getter).not.toHaveBeenCalled();
    expect(feed.readEthereumCoreMarket).not.toHaveBeenCalled();
  });

  it('sanitizes upstream and parser failures without retaining their details', async () => {
    const upstream = externalFeed(async () => {
      throw new Error('secret upstream response and credential');
    });
    const malformed = externalFeed(async () => ({ errors: [{ message: 'sensitive' }] }));

    await expect(
      new AaveV3EthereumMarketFeedAdapter(upstream.client).readCurrentMarkets(request()),
    ).rejects.toEqual(new AaveV3EthereumMarketUnavailableError());
    await expect(
      new AaveV3EthereumMarketFeedAdapter(malformed.client).readCurrentMarkets(request()),
    ).rejects.toEqual(new AaveV3EthereumMarketUnavailableError());

    try {
      await new AaveV3EthereumMarketFeedAdapter(upstream.client).readCurrentMarkets(request());
      throw new Error('expected adapter read to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AaveV3EthereumMarketUnavailableError);
      expect(error).toMatchObject({
        code: 'AAVE_V3_ETHEREUM_MARKET_UNAVAILABLE',
        message: 'Aave V3 Ethereum market data is unavailable',
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect((error as Error).message).not.toContain('credential');
    }
  });

  it.each([
    ['recommendation eligibility', 'mayEstablishRecommendationEligibility'],
    ['financial authorization', 'mayAuthorizeFinancialAction'],
  ] as const)('rejects a parser result that enables %s', async (_name, field) => {
    const feed = externalFeed(async () => validResponse());
    const parsed = parserModule.parseAaveV3EthereumMarketFeed(validResponse(), EVALUATED_AT);
    jest.spyOn(parserModule, 'parseAaveV3EthereumMarketFeed').mockReturnValue({
      ...parsed,
      [field]: true,
    } as unknown as AaveV3EthereumLendingMarketSnapshot);

    await expect(
      new AaveV3EthereumMarketFeedAdapter(feed.client).readCurrentMarkets(request()),
    ).rejects.toEqual(new AaveV3EthereumMarketUnavailableError());
  });
});
