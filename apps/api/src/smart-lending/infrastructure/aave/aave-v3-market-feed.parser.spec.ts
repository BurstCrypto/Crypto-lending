import type { ProviderNativeLendingMarketObservation } from '../../application/ports/provider-native-lending-market-reader.port';
import {
  AaveV3MarketFeedValidationError,
  parseAaveV3EthereumMarketFeed,
} from './aave-v3-market-feed.parser';
import {
  AAVE_V3_ETHEREUM_CORE_MARKET,
  AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST,
  AAVE_V3_ETHEREUM_MARKET_QUERY,
  AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256,
} from './aave-v3-market-feed.query';

const RETRIEVED_AT = '2026-09-03T18:00:00.000Z';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const MAX_UINT256 = ((1n << 256n) - 1n).toString();

function decimal(raw: string, decimals: number, value?: string): Record<string, unknown> {
  return {
    raw,
    decimals,
    value: value ?? decimalValue(raw, decimals),
  };
}

function decimalValue(raw: string, decimals: number): string {
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, '0');
  const splitAt = padded.length - decimals;
  const fraction = padded.slice(splitAt).replace(/0+$/u, '');
  return fraction.length === 0
    ? padded.slice(0, splitAt)
    : `${padded.slice(0, splitAt)}.${fraction}`;
}

function amount(raw: string, value?: string): Record<string, unknown> {
  return { amount: decimal(raw, 6, value) };
}

interface ReserveOptions {
  readonly symbol: string;
  readonly address: string;
  readonly apyRaw?: string;
  readonly totalRaw?: string;
  readonly capRaw?: string;
  readonly capReached?: boolean;
  readonly liquidityRaw?: string;
  readonly reserveFactorRaw?: string;
  readonly reserveFactorDecimals?: number;
  readonly frozen?: boolean;
  readonly paused?: boolean;
  readonly borrowInfo?: Record<string, unknown> | null;
}

function reserve(options: ReserveOptions): Record<string, unknown> {
  const totalRaw = options.totalRaw ?? '100000000';
  const capRaw = options.capRaw ?? '200000000';
  const reserveFactorDecimals = options.reserveFactorDecimals ?? 4;
  return {
    underlyingToken: {
      address: options.address,
      chainId: 1,
      symbol: options.symbol,
      decimals: 6,
    },
    size: amount(totalRaw),
    supplyInfo: {
      apy: decimal(options.apyRaw ?? '35929627642855128655257443', 27),
      supplyCap: amount(capRaw),
      supplyCapReached:
        options.capReached ?? (BigInt(capRaw) !== 0n && BigInt(totalRaw) >= BigInt(capRaw)),
      total: decimal(totalRaw, 6),
    },
    borrowInfo:
      options.borrowInfo === undefined
        ? {
            availableLiquidity: amount(options.liquidityRaw ?? '25000000'),
            reserveFactor: decimal(
              options.reserveFactorRaw ?? '1000',
              reserveFactorDecimals,
              options.reserveFactorRaw === undefined && reserveFactorDecimals === 4
                ? '0.10'
                : undefined,
            ),
          }
        : options.borrowInfo,
    isFrozen: options.frozen ?? false,
    isPaused: options.paused ?? false,
  };
}

function response(
  reserves: unknown[] = [
    reserve({
      symbol: 'USDT',
      address: USDT.toUpperCase().replace('0X', '0x'),
      apyRaw: '42777777777777777777777777',
      totalRaw: '80000000',
      capRaw: '0',
      liquidityRaw: '12000000',
    }),
    reserve({
      symbol: 'USDC',
      address: USDC,
      totalRaw: '2300027833428009',
      capRaw: '2500000000000000',
      liquidityRaw: '170300240144689',
    }),
    reserve({ symbol: 'WETH', address: WETH, borrowInfo: null }),
  ],
): Record<string, unknown> {
  return {
    data: {
      market: {
        address: AAVE_V3_ETHEREUM_CORE_MARKET.toUpperCase().replace('0X', '0x'),
        chain: { chainId: 1, isTestnet: false },
        reserves,
      },
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function marketOf(value: Record<string, unknown>): Record<string, unknown> {
  return (value.data as Record<string, unknown>).market as Record<string, unknown>;
}

function reservesOf(value: Record<string, unknown>): Array<Record<string, unknown>> {
  return marketOf(value).reserves as Array<Record<string, unknown>>;
}

function supplyOf(value: Record<string, unknown>, index: number): Record<string, unknown> {
  return reservesOf(value)[index]!.supplyInfo as Record<string, unknown>;
}

function expectInvalid(value: unknown, retrievedAt: unknown = RETRIEVED_AT): void {
  let captured: unknown;
  try {
    parseAaveV3EthereumMarketFeed(value, retrievedAt);
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(AaveV3MarketFeedValidationError);
  expect(captured).toMatchObject({
    code: 'AAVE_V3_MARKET_FEED_INVALID',
    message: 'Aave V3 market feed is invalid',
  });
}

describe('Aave V3 Ethereum provider-native market parser', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the shared provider observation independent of Aave reserve semantics', () => {
    const portableObservation: ProviderNativeLendingMarketObservation = Object.freeze({
      providerId: 'morpho',
      protocolId: 'morpho-blue',
      networkId: 'eip155:1',
      marketId: 'morpho-market',
      assetId: USDC,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      baseSupplyApyBasisPoints: 0n,
      totalSuppliedAtomic: 0n,
      providerSupplyStatus: 'UNKNOWN',
      evidenceReferenceId: 'morpho-native:evidence',
    });

    expect(portableObservation.providerSupplyStatus).toBe('UNKNOWN');
    expect(portableObservation).not.toHaveProperty('protocolSupplyCapAtomic');
    expect(portableObservation).not.toHaveProperty('reserveFactorBasisPoints');
    expect(portableObservation).not.toHaveProperty('isPaused');
    expect(portableObservation).not.toHaveProperty('isFrozen');
  });

  it('normalizes exactly the active Ethereum USDC and USDT reserves conservatively', () => {
    const snapshot = parseAaveV3EthereumMarketFeed(response(), RETRIEVED_AT);

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      sourceId: 'AAVE_V3_GRAPHQL',
      use: 'PROVIDER_NATIVE_CORROBORATION_ONLY',
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      sourceRequestFingerprintSha256: AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256,
      retrievedAt: RETRIEVED_AT,
      validUntil: '2026-09-03T18:01:00.000Z',
      providerCoverage: ['aave'],
    });
    expect(snapshot.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot).not.toHaveProperty('queryFingerprintSha256');
    expect(snapshot.snapshotId).toBe(`aave-v3-ethereum:${snapshot.fingerprintSha256}`);
    expect(snapshot.observations).toEqual([
      {
        providerId: 'aave',
        protocolId: 'aave-v3',
        networkId: 'eip155:1',
        marketId: AAVE_V3_ETHEREUM_CORE_MARKET,
        assetId: USDC,
        assetSymbol: 'USDC',
        assetDecimals: 6,
        baseSupplyApyBasisPoints: 359n,
        totalSuppliedAtomic: 2_300_027_833_428_009n,
        providerSupplyStatus: 'OPEN',
        protocolSupplyCapAtomic: 2_500_000_000_000_000n,
        protocolSupplyCapRemainingAtomic: 199_972_166_571_991n,
        protocolSupplyCapReached: false,
        reportedAvailableLiquidityAtomic: 170_300_240_144_689n,
        reserveFactorBasisPoints: 1_000n,
        isPaused: false,
        isFrozen: false,
        evidenceReferenceId: `aave-v3-graphql:usdc:${snapshot.fingerprintSha256}`,
      },
      {
        providerId: 'aave',
        protocolId: 'aave-v3',
        networkId: 'eip155:1',
        marketId: AAVE_V3_ETHEREUM_CORE_MARKET,
        assetId: USDT,
        assetSymbol: 'USDT',
        assetDecimals: 6,
        baseSupplyApyBasisPoints: 427n,
        totalSuppliedAtomic: 80_000_000n,
        providerSupplyStatus: 'OPEN',
        protocolSupplyCapAtomic: null,
        protocolSupplyCapRemainingAtomic: null,
        protocolSupplyCapReached: false,
        reportedAvailableLiquidityAtomic: 12_000_000n,
        reserveFactorBasisPoints: 1_000n,
        isPaused: false,
        isFrozen: false,
        evidenceReferenceId: `aave-v3-graphql:usdt:${snapshot.fingerprintSha256}`,
      },
    ]);
  });

  it('exports a closed read-only query body with no wallet or transaction surface', () => {
    expect(AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST).toEqual({
      operationName: 'SmartLendingAaveV3EthereumMarket',
      query: AAVE_V3_ETHEREUM_MARKET_QUERY,
      variables: {
        request: { address: AAVE_V3_ETHEREUM_CORE_MARKET, chainId: 1 },
      },
    });
    expect(AAVE_V3_ETHEREUM_MARKET_QUERY).toContain('market(request: $request)');
    expect(AAVE_V3_ETHEREUM_MARKET_QUERY).not.toMatch(
      /\b(?:mutation|user|transaction|execution|supply\s*\(|withdraw\s*\()\b/iu,
    );
    expect(AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST)).toBe(true);
    expect(Object.isFrozen(AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST.variables)).toBe(true);
    expect(Object.isFrozen(AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST.variables.request)).toBe(true);
  });

  it('deep-freezes normalized evidence and never exposes an execution property', () => {
    const snapshot = parseAaveV3EthereumMarketFeed(response(), RETRIEVED_AT);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.providerCoverage)).toBe(true);
    expect(Object.isFrozen(snapshot.observations)).toBe(true);
    expect(snapshot.observations.every(Object.isFrozen)).toBe(true);
    expect(
      JSON.stringify(snapshot, (_, value) => (typeof value === 'bigint' ? `${value}` : value)),
    ).not.toMatch(/transaction|execute|authorizeTransaction/iu);
  });

  it('sorts provider observations and creates deterministic content-bound evidence', () => {
    const original = response();
    const reordered = response([...((marketOf(original).reserves as unknown[]) ?? [])].reverse());
    const first = parseAaveV3EthereumMarketFeed(original, RETRIEVED_AT);
    const second = parseAaveV3EthereumMarketFeed(reordered, RETRIEVED_AT);
    expect(second).toEqual(first);

    const later = parseAaveV3EthereumMarketFeed(response(), '2026-09-03T18:00:01.000Z');
    expect(later.fingerprintSha256).not.toBe(first.fingerprintSha256);
    const changed = response();
    ((supplyOf(changed, 0).apy as Record<string, unknown>).raw as string) =
      '42777777777777777777777778';
    ((supplyOf(changed, 0).apy as Record<string, unknown>).value as string) =
      '0.042777777777777777777777778';
    expect(parseAaveV3EthereumMarketFeed(changed, RETRIEVED_AT).fingerprintSha256).not.toBe(
      first.fingerprintSha256,
    );
  });

  it.each([
    [
      'wrong market',
      (input: Record<string, unknown>) => (marketOf(input).address = `0x${'12'.repeat(20)}`),
    ],
    [
      'wrong chain',
      (input: Record<string, unknown>) =>
        ((marketOf(input).chain as Record<string, unknown>).chainId = 8453),
    ],
    [
      'testnet',
      (input: Record<string, unknown>) =>
        ((marketOf(input).chain as Record<string, unknown>).isTestnet = true),
    ],
  ])('rejects an invalid Ethereum Core binding: %s', (_name, mutate) => {
    const input = response();
    mutate(input);
    expectInvalid(input);
  });

  it('requires exactly one registry-bound USDC reserve and one registry-bound USDT reserve', () => {
    const missing = response();
    marketOf(missing).reserves = reservesOf(missing).filter(
      (entry) => (entry.underlyingToken as Record<string, unknown>).symbol !== 'USDT',
    );
    expectInvalid(missing);

    const duplicate = response();
    reservesOf(duplicate).push(clone(reservesOf(duplicate)[0]!));
    expectInvalid(duplicate);

    for (const mutation of [
      (token: Record<string, unknown>) => (token.address = `0x${'34'.repeat(20)}`),
      (token: Record<string, unknown>) => (token.symbol = 'USDC.e'),
      (token: Record<string, unknown>) => (token.decimals = 18),
      (token: Record<string, unknown>) => (token.chainId = 8453),
    ]) {
      const input = response();
      mutation(reservesOf(input)[1]!.underlyingToken as Record<string, unknown>);
      expectInvalid(input);
    }
  });

  it('ignores a structurally bounded unrelated reserve but fails a target without liquidity data', () => {
    expect(parseAaveV3EthereumMarketFeed(response(), RETRIEVED_AT).observations).toHaveLength(2);
    const input = response();
    reservesOf(input)[1]!.borrowInfo = null;
    expectInvalid(input);
  });

  it.each([
    ['GraphQL errors', () => ({ ...response(), errors: [] })],
    ['null data', () => ({ data: null })],
    ['null market', () => ({ data: { market: null } })],
    [
      'extra market field',
      () => {
        const input = response();
        marketOf(input).userState = null;
        return input;
      },
    ],
    [
      'extra reserve field',
      () => {
        const input = response();
        reservesOf(input)[0]!.transactionRequest = null;
        return input;
      },
    ],
  ])('rejects an unexpected response shape: %s', (_name, build) => {
    expectInvalid(build());
  });

  it('rejects oversized, sparse, accessor-backed, and proxy-backed collections', () => {
    expectInvalid(
      response(Array.from({ length: 129 }, () => reserve({ symbol: 'WETH', address: WETH }))),
    );

    const sparse = response();
    const sparseReserves = reservesOf(sparse);
    delete sparseReserves[1];
    expectInvalid(sparse);

    const accessor = response();
    const token = reservesOf(accessor)[1]!.underlyingToken as Record<string, unknown>;
    const getter = jest.fn(() => USDC);
    Object.defineProperty(token, 'address', { enumerable: true, get: getter });
    expectInvalid(accessor);
    expect(getter).not.toHaveBeenCalled();

    expectInvalid(
      new Proxy(response(), {
        ownKeys: () => {
          throw new Error('proxy trap');
        },
      }),
    );
  });

  it.each([
    ['negative raw', '-1'],
    ['leading-zero raw', '01'],
    ['hex raw', '0x1'],
    ['uint256 overflow', `${MAX_UINT256}0`],
  ])('rejects invalid atomic input: %s', (_name, raw) => {
    const input = response();
    const total = supplyOf(input, 1).total as Record<string, unknown>;
    total.raw = raw;
    expectInvalid(input);
  });

  it.each(['1e-6', '-0.1', '.1', '01', 'NaN', 'Infinity'])(
    'rejects a non-canonical redundant decimal value %s',
    (value) => {
      const input = response();
      (supplyOf(input, 1).apy as Record<string, unknown>).value = value;
      expectInvalid(input);
    },
  );

  it('accepts numerically equivalent trailing zeros but rejects contradictory redundant values', () => {
    const trailing = response();
    (
      (reservesOf(trailing)[1]!.borrowInfo as Record<string, unknown>).reserveFactor as Record<
        string,
        unknown
      >
    ).value = '0.1000';
    expect(parseAaveV3EthereumMarketFeed(trailing, RETRIEVED_AT).observations[0]).toMatchObject({
      reserveFactorBasisPoints: 1_000n,
    });

    const contradictory = response();
    (supplyOf(contradictory, 1).total as Record<string, unknown>).value = '1';
    expectInvalid(contradictory);
  });

  it('rejects invalid rate scales, rate bounds, and inconsistent duplicate totals', () => {
    const wrongApyScale = response();
    supplyOf(wrongApyScale, 1).apy = decimal('3592962764285512865525744', 26);
    expectInvalid(wrongApyScale);

    const wrongReserveFactorScale = response();
    (reservesOf(wrongReserveFactorScale)[1]!.borrowInfo as Record<string, unknown>).reserveFactor =
      decimal('100', 3);
    expectInvalid(wrongReserveFactorScale);

    const excessiveApy = response();
    supplyOf(excessiveApy, 1).apy = decimal('100000100000000000000000000000', 27);
    expectInvalid(excessiveApy);

    const excessiveReserveFactor = response();
    (reservesOf(excessiveReserveFactor)[1]!.borrowInfo as Record<string, unknown>).reserveFactor =
      decimal('10001', 4);
    expectInvalid(excessiveReserveFactor);

    const mismatchedSize = response();
    reservesOf(mismatchedSize)[1]!.size = amount('1');
    expectInvalid(mismatchedSize);
  });

  it('requires supply-cap status to agree with raw total and cap semantics', () => {
    const falseReached = response();
    supplyOf(falseReached, 1).supplyCapReached = true;
    expectInvalid(falseReached);

    const zeroReached = response();
    supplyOf(zeroReached, 0).supplyCapReached = true;
    expectInvalid(zeroReached);

    const overCap = response();
    const total = '2500000000000001';
    reservesOf(overCap)[1]!.size = amount(total);
    supplyOf(overCap, 1).total = decimal(total, 6);
    supplyOf(overCap, 1).supplyCapReached = true;
    expect(parseAaveV3EthereumMarketFeed(overCap, RETRIEVED_AT).observations[0]).toMatchObject({
      protocolSupplyCapRemainingAtomic: 0n,
      protocolSupplyCapReached: true,
      providerSupplyStatus: 'CLOSED',
    });
  });

  it.each([
    ['paused', { paused: true }],
    ['frozen', { frozen: true }],
    ['cap reached', { totalRaw: '200000000', capRaw: '200000000', capReached: true }],
  ])('retains %s as a closed provider signal without making it eligible', (_name, change) => {
    const input = response();
    reservesOf(input)[1] = reserve({ symbol: 'USDC', address: USDC, ...change });
    const snapshot = parseAaveV3EthereumMarketFeed(input, RETRIEVED_AT);
    expect(snapshot.observations[0]?.providerSupplyStatus).toBe('CLOSED');
    expect(snapshot.mayEstablishRecommendationEligibility).toBe(false);
  });

  it.each(['2026-09-03T18:00:00Z', '2026-09-03T18:00:00.000+00:00', 'invalid', '', null])(
    'rejects an untrusted retrieval timestamp %#',
    (retrievedAt) => {
      expectInvalid(response(), retrievedAt);
    },
  );
});
