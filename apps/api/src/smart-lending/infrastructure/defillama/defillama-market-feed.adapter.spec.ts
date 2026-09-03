import {
  SMART_LENDING_PROVIDER_IDS,
  type SmartLendingProviderId,
} from '../../application/ports/live-lending-market-feed.port';
import type { SmartLendingExternalFeedClient } from '../external-feeds/smart-lending-external-feed.client';
import { SmartLendingExternalFeedDestination } from '../external-feeds/smart-lending-external-feed.types';
import {
  DefiLlamaMarketFeedAdapter,
  LiveLendingMarketFeedUnavailableError,
} from './defillama-market-feed.adapter';
import {
  DefiLlamaMarketFeedValidationError,
  parseDefiLlamaMarketFeed,
} from './defillama-market-feed.parser';

const EVALUATED_AT = '2026-09-03T12:00:00.000Z';
const CORRELATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ETHEREUM_USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

interface ProviderFixture {
  readonly providerId: SmartLendingProviderId;
  readonly project: string;
  readonly chain: 'Ethereum' | 'Solana';
}

const PROVIDERS: readonly ProviderFixture[] = Object.freeze([
  { providerId: 'aave', project: 'aave-v3', chain: 'Ethereum' },
  { providerId: 'morpho', project: 'morpho-blue', chain: 'Ethereum' },
  { providerId: 'compound', project: 'compound-v3', chain: 'Ethereum' },
  { providerId: 'spark', project: 'sparklend', chain: 'Ethereum' },
  { providerId: 'euler', project: 'euler-v2', chain: 'Ethereum' },
  { providerId: 'gearbox', project: 'gearbox', chain: 'Ethereum' },
  { providerId: 'kamino', project: 'kamino-lend', chain: 'Solana' },
  { providerId: 'save', project: 'save', chain: 'Solana' },
  { providerId: 'project-0', project: 'project-0', chain: 'Solana' },
  { providerId: 'jupiter', project: 'jupiter-lend', chain: 'Solana' },
]);

function poolId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function pool(
  provider: ProviderFixture,
  index: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    pool: poolId(index),
    chain: provider.chain,
    project: provider.project,
    symbol: 'USDC',
    tvlUsd: 1_000 + index,
    apyBase: 4.567,
    stablecoin: true,
    exposure: 'single',
    outlier: false,
    underlyingTokens: [provider.chain === 'Ethereum' ? ETHEREUM_USDC : SOLANA_USDC],
    ...overrides,
  };
}

function completePools(): Record<string, unknown>[] {
  return PROVIDERS.map((provider, index) => pool(provider, index + 1));
}

function externalFeed(implementation: () => Promise<unknown>): {
  readonly client: SmartLendingExternalFeedClient;
  readonly get: jest.Mock;
} {
  const get = jest.fn(implementation);
  return {
    client: { get } as unknown as SmartLendingExternalFeedClient,
    get,
  };
}

function request(): { readonly evaluatedAt: string; readonly correlationId: string } {
  return { evaluatedAt: EVALUATED_AT, correlationId: CORRELATION_ID };
}

describe('DefiLlamaMarketFeedAdapter', () => {
  it('uses only the fixed yields destination and returns all ten providers as corroboration', async () => {
    const feed = externalFeed(async () => ({
      data: completePools(),
      retrievedAt: '1999-01-01T00:00:00.000Z',
    }));
    const adapter = new DefiLlamaMarketFeedAdapter(feed.client);

    const snapshot = await adapter.readCurrentMarkets(request());

    expect(feed.get).toHaveBeenCalledTimes(1);
    expect(feed.get).toHaveBeenCalledWith(SmartLendingExternalFeedDestination.DefiLlamaYields, {});
    const query = feed.get.mock.calls[0]?.[1] as unknown;
    expect(Object.isFrozen(query)).toBe(true);
    expect(snapshot.providerCoverage).toEqual(SMART_LENDING_PROVIDER_IDS);
    expect(snapshot.observations.map(({ providerId }) => providerId)).toEqual(
      SMART_LENDING_PROVIDER_IDS,
    );
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      source: 'DEFILLAMA_YIELDS',
      use: 'INDICATIVE_CORROBORATION_ONLY',
      mayEstablishRecommendationEligibility: false,
      retrievedAt: EVALUATED_AT,
      validUntil: '2026-09-03T13:15:00.000Z',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.observations.every((observation) => Object.isFrozen(observation))).toBe(true);
    expect(snapshot.observations[0]).not.toHaveProperty('recommendationEligibility');
  });

  it('sanitizes upstream failures and parser failures without retaining their details', async () => {
    const upstream = externalFeed(async () => {
      throw new Error('secret upstream credential and response body');
    });
    const invalid = externalFeed(async () => ({ data: completePools().slice(1) }));

    await expect(
      new DefiLlamaMarketFeedAdapter(upstream.client).readCurrentMarkets(request()),
    ).rejects.toEqual(new LiveLendingMarketFeedUnavailableError());
    await expect(
      new DefiLlamaMarketFeedAdapter(invalid.client).readCurrentMarkets(request()),
    ).rejects.toEqual(new LiveLendingMarketFeedUnavailableError());

    try {
      await new DefiLlamaMarketFeedAdapter(upstream.client).readCurrentMarkets(request());
      throw new Error('expected adapter read to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(LiveLendingMarketFeedUnavailableError);
      expect((error as Error).message).toBe('Live lending market feed is unavailable');
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect((error as Error).message).not.toContain('credential');
    }
  });

  it('sanitizes malformed or accessor-backed trusted request timestamps', async () => {
    const feed = externalFeed(async () => ({ data: completePools() }));
    let getterCalls = 0;
    const malformed = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(malformed, 'evaluatedAt', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('untrusted accessor detail');
      },
    });

    await expect(
      new DefiLlamaMarketFeedAdapter(feed.client).readCurrentMarkets(
        malformed as unknown as ReturnType<typeof request>,
      ),
    ).rejects.toEqual(new LiveLendingMarketFeedUnavailableError());
    expect(getterCalls).toBe(1);
    expect(feed.get).not.toHaveBeenCalled();
  });

  it('rejects a non-v4 correlation ID before crossing the external-feed boundary', async () => {
    const feed = externalFeed(async () => ({ data: completePools() }));
    const adapter = new DefiLlamaMarketFeedAdapter(feed.client);

    await expect(
      adapter.readCurrentMarkets({ ...request(), correlationId: 'not-a-correlation-id' }),
    ).rejects.toEqual(new LiveLendingMarketFeedUnavailableError());
    await expect(
      adapter.readCurrentMarkets({
        ...request(),
        correlationId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).rejects.toEqual(new LiveLendingMarketFeedUnavailableError());
    expect(feed.get).not.toHaveBeenCalled();
  });
});

describe('parseDefiLlamaMarketFeed', () => {
  it('filters non-eligible rows and bounds each provider/asset group to the eight largest pools', () => {
    const aave = PROVIDERS[0];
    if (!aave) throw new Error('missing Aave fixture');
    const ineligible = [
      pool(aave, 101, { chain: 'Base' }),
      pool(aave, 102, { stablecoin: false }),
      pool(aave, 103, { exposure: 'multi' }),
      pool(aave, 104, { outlier: true }),
      pool(aave, 105, { symbol: 'DAI' }),
      pool(aave, 106, { pool: 'not-a-uuid' }),
      pool(aave, 107, { underlyingTokens: [ETHEREUM_USDC, ETHEREUM_USDT] }),
      pool(aave, 108, { underlyingTokens: [`0x${'f'.repeat(40)}`] }),
      pool(aave, 109, { symbol: 'USDT' }),
      pool(aave, 110, { apyBase: -1 }),
      pool(aave, 111, { tvlUsd: 1_000_000_000_000_001 }),
      null,
    ];
    const extraEligible = Array.from({ length: 12 }, (_value, index) =>
      pool(aave, 200 + index, { tvlUsd: 10_000 + index }),
    );

    const snapshot = parseDefiLlamaMarketFeed(
      { data: [...completePools(), ...ineligible, ...extraEligible] },
      EVALUATED_AT,
    );
    const aaveMarkets = snapshot.observations.filter(({ providerId }) => providerId === 'aave');

    expect(snapshot.providerCoverage).toEqual(SMART_LENDING_PROVIDER_IDS);
    expect(aaveMarkets).toHaveLength(8);
    expect(
      aaveMarkets.map(({ totalValueLockedUsdMantissa }) => totalValueLockedUsdMantissa),
    ).toEqual(
      [...aaveMarkets]
        .map(({ totalValueLockedUsdMantissa }) => totalValueLockedUsdMantissa)
        .sort((left, right) => (left > right ? -1 : left < right ? 1 : 0)),
    );
    expect(snapshot.observations.some(({ marketId }) => marketId === 'not-a-uuid')).toBe(false);
  });

  it('fails the entire snapshot closed when any required provider has no valid market', () => {
    const withoutJupiter = completePools().filter(({ project }) => project !== 'jupiter-lend');
    const invalidJupiter = pool(PROVIDERS[9] as ProviderFixture, 99, { outlier: true });

    expect(() =>
      parseDefiLlamaMarketFeed({ data: [...withoutJupiter, invalidJupiter] }, EVALUATED_AT),
    ).toThrow(DefiLlamaMarketFeedValidationError);
  });

  it('rejects malformed envelopes, non-exact arrays, and required rows backed by accessors', () => {
    const envelope = Object.create(null) as Record<string, unknown>;
    let envelopeGetterCalls = 0;
    Object.defineProperty(envelope, 'data', {
      enumerable: true,
      get: () => {
        envelopeGetterCalls += 1;
        return completePools();
      },
    });
    expect(() => parseDefiLlamaMarketFeed(envelope, EVALUATED_AT)).toThrow(
      DefiLlamaMarketFeedValidationError,
    );
    expect(envelopeGetterCalls).toBe(0);

    const sparse = new Array<unknown>(11);
    sparse[1] = completePools()[0];
    expect(() => parseDefiLlamaMarketFeed({ data: sparse }, EVALUATED_AT)).toThrow(
      DefiLlamaMarketFeedValidationError,
    );

    const decorated = completePools();
    Object.defineProperty(decorated, 'attackerKey', {
      enumerable: true,
      value: completePools()[0],
    });
    expect(() => parseDefiLlamaMarketFeed({ data: decorated }, EVALUATED_AT)).toThrow(
      DefiLlamaMarketFeedValidationError,
    );

    const symbolBearing = completePools();
    Object.defineProperty(symbolBearing, Symbol('attacker'), {
      enumerable: true,
      value: completePools()[0],
    });
    expect(() => parseDefiLlamaMarketFeed({ data: symbolBearing }, EVALUATED_AT)).toThrow(
      DefiLlamaMarketFeedValidationError,
    );

    const pools = completePools();
    const accessorRow = { ...pools[0] };
    let rowGetterCalls = 0;
    Object.defineProperty(accessorRow, 'project', {
      enumerable: true,
      get: () => {
        rowGetterCalls += 1;
        return 'aave-v3';
      },
    });
    pools[0] = accessorRow;
    expect(() => parseDefiLlamaMarketFeed({ data: pools }, EVALUATED_AT)).toThrow(
      DefiLlamaMarketFeedValidationError,
    );
    expect(rowGetterCalls).toBe(0);
  });

  it('floors base APY to basis points and scales TVL to 18 decimal places', () => {
    const pools = completePools();
    const aave = PROVIDERS[0];
    if (!aave) throw new Error('missing Aave fixture');
    const ordinaryId = poolId(301);
    const tinyId = poolId(302);
    pools.push(
      pool(aave, 301, { apyBase: 4.56789, tvlUsd: 123.456789 }),
      pool(aave, 302, { apyBase: 1e-7, tvlUsd: 1e-7 }),
    );

    const snapshot = parseDefiLlamaMarketFeed({ data: pools }, EVALUATED_AT);
    const ordinary = snapshot.observations.find(({ marketId }) => marketId === ordinaryId);
    const tiny = snapshot.observations.find(({ marketId }) => marketId === tinyId);

    expect(ordinary).toMatchObject({
      grossApyBasisPoints: 456n,
      totalValueLockedUsdMantissa: 123_456_789_000_000_000_000n,
    });
    expect(tiny).toMatchObject({
      grossApyBasisPoints: 0n,
      totalValueLockedUsdMantissa: 100_000_000_000n,
    });
  });

  it('uses a deterministic fingerprint independent of upstream row order', () => {
    const pools = completePools();
    const forward = parseDefiLlamaMarketFeed({ data: pools }, EVALUATED_AT);
    const reverse = parseDefiLlamaMarketFeed({ data: [...pools].reverse() }, EVALUATED_AT);

    expect(reverse.snapshotId).toBe(forward.snapshotId);
    expect(reverse.fingerprintSha256).toBe(forward.fingerprintSha256);
    expect(reverse.observations).toEqual(forward.observations);
  });
});
