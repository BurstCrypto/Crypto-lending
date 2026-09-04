import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import {
  createMorphoBlueEthereumMarketManifest,
  MorphoBlueEthereumFinalizedTranscriptAdapter,
  MORPHO_BLUE_ETHEREUM_ADDRESS,
  MORPHO_BLUE_ID_TO_MARKET_PARAMS_SELECTOR,
  MORPHO_BLUE_IS_IRM_ENABLED_SELECTOR,
  MORPHO_BLUE_IS_LLTV_ENABLED_SELECTOR,
  MORPHO_BLUE_MARKET_SELECTOR,
  MorphoBlueEthereumTranscriptUnavailableError,
  type MorphoBlueEthereumJsonRpcRequest,
  type MorphoBlueEthereumMarketManifest,
  type MorphoBlueEthereumMarketManifestDefinition,
} from './morpho-blue-ethereum-finalized-transcript.adapter';

const NOW = new Date('2026-09-04T12:00:00.000Z');
const BLOCK_SECONDS = BigInt(NOW.getTime() / 1_000) - 600n;
const BLOCK_HASH = `0x${'1'.repeat(64)}`;
const PARENT_HASH = `0x${'2'.repeat(64)}`;
const STATE_ROOT = `0x${'3'.repeat(64)}`;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const PYUSD = '0x6c3ea9036406852006290770bedfcaba0e23a0e8';
const COLLATERAL = '0x1111111111111111111111111111111111111111';
const ORACLE = '0x2222222222222222222222222222222222222222';
const IRM = '0x870ac11d48b15db9a138cf899d20f13f79ba00bc';
const LLTV = 860_000_000_000_000_000n;
const MORPHO_CODE = '0x60016000556002600055';
const LOAN_CODE = '0x6002600055';
const COLLATERAL_CODE = '0x6003600055';
const ORACLE_CODE = '0x6004600055';
const IRM_CODE = '0x6005600055';
const TRUE_WORD = `0x${'0'.repeat(63)}1`;

function runtimeHash(code: string): string {
  return keccak256(code as Hex);
}

function marketId(
  loanToken: string,
  collateralToken = COLLATERAL,
  oracle = ORACLE,
  irm = IRM,
  lltv = LLTV,
): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [loanToken as Address, collateralToken as Address, oracle as Address, irm as Address, lltv],
    ),
  );
}

function definition(
  stablecoin: 'USDC' | 'USDT' | 'PYUSD' = 'USDC',
): MorphoBlueEthereumMarketManifestDefinition {
  const loanToken = { USDC, USDT, PYUSD }[stablecoin];
  return {
    schemaVersion: 1,
    use: 'DORMANT_MORPHO_BLUE_MARKET_CORROBORATION_ONLY',
    registryVersion: 1,
    registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumFinalizedBlockAgeSeconds: '1800',
    deployment: {
      kind: 'DIRECT_NON_PROXY',
      morphoAddress: MORPHO_BLUE_ETHEREUM_ADDRESS,
      morphoRuntimeCodeKeccak256: runtimeHash(MORPHO_CODE),
      implementationAddress: MORPHO_BLUE_ETHEREUM_ADDRESS,
      implementationRuntimeCodeKeccak256: runtimeHash(MORPHO_CODE),
    },
    market: {
      marketId: marketId(loanToken),
      loanStablecoin: stablecoin,
      loanToken,
      collateralToken: COLLATERAL,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV.toString(10),
      loanTokenRuntimeCodeKeccak256: runtimeHash(LOAN_CODE),
      collateralTokenRuntimeCodeKeccak256: runtimeHash(COLLATERAL_CODE),
      oracleRuntimeCodeKeccak256: runtimeHash(ORACLE_CODE),
      irmRuntimeCodeKeccak256: runtimeHash(IRM_CODE),
    },
  };
}

function block(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    number: '0x1234',
    hash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    stateRoot: STATE_ROOT,
    timestamp: `0x${BLOCK_SECONDS.toString(16)}`,
    ...overrides,
  };
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function addressWord(value: string): string {
  return `${'0'.repeat(24)}${value.slice(2)}`;
}

function encodeParams(
  market: MorphoBlueEthereumMarketManifest['market'],
  overrides: Partial<
    Readonly<{
      loanToken: string;
      collateralToken: string;
      oracle: string;
      irm: string;
      lltv: bigint;
    }>
  > = {},
): string {
  return `0x${addressWord(overrides.loanToken ?? market.loanToken)}${addressWord(
    overrides.collateralToken ?? market.collateralToken,
  )}${addressWord(overrides.oracle ?? market.oracle)}${addressWord(
    overrides.irm ?? market.irm,
  )}${word(overrides.lltv ?? BigInt(market.lltv))}`;
}

function encodeState(
  overrides: Partial<
    Readonly<{
      totalSupplyAssets: bigint;
      totalSupplyShares: bigint;
      totalBorrowAssets: bigint;
      totalBorrowShares: bigint;
      lastUpdate: bigint;
      fee: bigint;
    }>
  > = {},
): string {
  return `0x${[
    overrides.totalSupplyAssets ?? 1_000_000_000n,
    overrides.totalSupplyShares ?? 999_000_000n,
    overrides.totalBorrowAssets ?? 700_000_000n,
    overrides.totalBorrowShares ?? 699_000_000n,
    overrides.lastUpdate ?? BLOCK_SECONDS - 60n,
    overrides.fee ?? 100_000_000_000_000_000n,
  ]
    .map(word)
    .join('')}`;
}

type ExchangeOverride = (
  request: MorphoBlueEthereumJsonRpcRequest,
  defaultResult: unknown,
) => unknown | Promise<unknown>;

function harness(
  manifest = createMorphoBlueEthereumMarketManifest(definition()),
  overrides: Readonly<Record<number, ExchangeOverride>> = {},
  clockValue: unknown = NOW,
): Readonly<{
  adapter: MorphoBlueEthereumFinalizedTranscriptAdapter;
  exchange: jest.Mock<Promise<unknown>, [MorphoBlueEthereumJsonRpcRequest]>;
}> {
  const defaults: readonly unknown[] = [
    '0x1',
    block(),
    MORPHO_CODE,
    LOAN_CODE,
    COLLATERAL_CODE,
    ORACLE_CODE,
    IRM_CODE,
    encodeParams(manifest.market),
    encodeState(),
    TRUE_WORD,
    TRUE_WORD,
    block(),
    '0x1',
  ];
  const exchange = jest.fn<Promise<unknown>, [MorphoBlueEthereumJsonRpcRequest]>(
    async (request) => {
      const defaultResult = defaults[request.id - 1];
      const override = overrides[request.id];
      if (override) return override(request, defaultResult);
      return { jsonrpc: '2.0', id: request.id, result: defaultResult };
    },
  );
  const clock = {
    now: (): Date => clockValue as Date,
  };
  return Object.freeze({
    adapter: new MorphoBlueEthereumFinalizedTranscriptAdapter(
      manifest,
      manifest.manifestFingerprintSha256,
      { exchange },
      clock,
    ),
    exchange,
  });
}

function request(manifest: MorphoBlueEthereumMarketManifest): Readonly<{
  marketId: string;
  loanStablecoin: 'USDC' | 'USDT' | 'PYUSD';
}> {
  return {
    marketId: manifest.market.marketId,
    loanStablecoin: manifest.market.loanStablecoin,
  };
}

function clone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function unavailable(): Readonly<{ code: string; message: string }> {
  return {
    code: 'MORPHO_BLUE_ETHEREUM_TRANSCRIPT_UNAVAILABLE',
    message: 'Morpho Blue Ethereum transcript is unavailable',
  };
}

describe('MorphoBlueEthereumFinalizedTranscriptAdapter', () => {
  it.each(['USDC', 'USDT', 'PYUSD'] as const)(
    'strictly binds a dormant raw %s market transcript',
    async (stablecoin) => {
      const manifest = createMorphoBlueEthereumMarketManifest(definition(stablecoin));
      const { adapter } = harness(manifest);

      const candidate = await adapter.read(request(manifest));

      expect(candidate).toMatchObject({
        providerId: 'morpho',
        protocolId: 'morpho-blue',
        networkId: 'eip155:1',
        sourcePosition: '4660',
        sourceFinality: 'ETHEREUM_FINALIZED_BLOCK',
        sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND',
        interestAccrualStatus: 'NOT_ACCRUED_RAW_MARKET_STORAGE',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        market: {
          marketId: manifest.market.marketId,
          loanStablecoin: stablecoin,
          loanToken: manifest.market.loanToken,
          collateralToken: COLLATERAL,
          oracle: ORACLE,
          irm: IRM,
          lltv: LLTV.toString(10),
        },
        rawState: {
          totalSupplyAssets: '1000000000',
          totalSupplyShares: '999000000',
          totalBorrowAssets: '700000000',
          totalBorrowShares: '699000000',
          lastUpdate: (BLOCK_SECONDS - 60n).toString(10),
          fee: '100000000000000000',
        },
      });
      expect(candidate.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(candidate.staleAfter).toBe(
        new Date(Number((BLOCK_SECONDS + 1_800n) * 1_000n)).toISOString(),
      );
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.block)).toBe(true);
      expect(Object.isFrozen(candidate.market)).toBe(true);
      expect(Object.isFrozen(candidate.rawState)).toBe(true);
      expect(JSON.stringify(candidate)).not.toMatch(/apy|rate|price|capacity|supplyStatus/iu);
    },
  );

  it('executes the exact finalized, EIP-1898-bound thirteen-request plan', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter, exchange } = harness(manifest);

    await adapter.read(request(manifest));

    expect(exchange).toHaveBeenCalledTimes(13);
    expect(exchange.mock.calls.map(([rpc]) => rpc.method)).toEqual([
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_getCode',
      'eth_getCode',
      'eth_getCode',
      'eth_getCode',
      'eth_getCode',
      'eth_call',
      'eth_call',
      'eth_call',
      'eth_call',
      'eth_getBlockByNumber',
      'eth_chainId',
    ]);
    expect(exchange.mock.calls[1]?.[0].params).toEqual(['finalized', false]);
    expect(exchange.mock.calls.map(([rpc]) => rpc.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    const canonicalBlock = { blockHash: BLOCK_HASH, requireCanonical: true };
    expect(exchange.mock.calls.slice(2, 7).map(([rpc]) => rpc.params[0])).toEqual([
      MORPHO_BLUE_ETHEREUM_ADDRESS,
      manifest.market.loanToken,
      manifest.market.collateralToken,
      manifest.market.oracle,
      manifest.market.irm,
    ]);
    for (const index of [2, 3, 4, 5, 6]) {
      expect(exchange.mock.calls[index]?.[0].params[1]).toEqual(canonicalBlock);
    }
    for (const index of [7, 8, 9, 10]) {
      const rpc = exchange.mock.calls[index]?.[0];
      expect(rpc?.params[1]).toEqual(canonicalBlock);
      expect(rpc?.params[0]).toEqual(expect.objectContaining({ to: MORPHO_BLUE_ETHEREUM_ADDRESS }));
    }
    expect(exchange.mock.calls[7]?.[0].params[0]).toEqual({
      to: MORPHO_BLUE_ETHEREUM_ADDRESS,
      data: `${MORPHO_BLUE_ID_TO_MARKET_PARAMS_SELECTOR}${manifest.market.marketId.slice(2)}`,
    });
    expect(exchange.mock.calls[8]?.[0].params[0]).toEqual({
      to: MORPHO_BLUE_ETHEREUM_ADDRESS,
      data: `${MORPHO_BLUE_MARKET_SELECTOR}${manifest.market.marketId.slice(2)}`,
    });
    expect((exchange.mock.calls[9]?.[0].params[0] as Readonly<{ data: string }>).data).toBe(
      `${MORPHO_BLUE_IS_IRM_ENABLED_SELECTOR}${addressWord(IRM)}`,
    );
    expect((exchange.mock.calls[10]?.[0].params[0] as Readonly<{ data: string }>).data).toBe(
      `${MORPHO_BLUE_IS_LLTV_ENABLED_SELECTOR}${word(LLTV)}`,
    );
    expect(exchange.mock.calls[11]?.[0].params).toEqual(['0x1234', false]);
    expect(exchange.mock.calls.every(([rpc]) => Object.isFrozen(rpc))).toBe(true);
    expect(exchange.mock.calls.every(([rpc]) => Object.isFrozen(rpc.params))).toBe(true);
  });

  it('accepts its canonical manifest with a matching embedded fingerprint', () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    expect(createMorphoBlueEthereumMarketManifest(manifest)).toBeInstanceOf(Object);
    expect(createMorphoBlueEthereumMarketManifest(manifest)).toEqual(manifest);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.deployment)).toBe(true);
    expect(Object.isFrozen(manifest.market)).toBe(true);
  });

  it.each([
    ['wrong schema', (raw: Record<string, unknown>) => (raw.schemaVersion = 2)],
    ['wrong use', (raw: Record<string, unknown>) => (raw.use = 'LIVE')],
    [
      'wrong registry',
      (raw: Record<string, unknown>) => (raw.registryFingerprintSha256 = '0'.repeat(64)),
    ],
    ['wrong network', (raw: Record<string, unknown>) => (raw.networkId = 'eip155:8453')],
    ['wrong chain', (raw: Record<string, unknown>) => (raw.chainId = '0x2')],
    ['wrong selector', (raw: Record<string, unknown>) => (raw.blockSelector = 'latest')],
    ['wrong binding', (raw: Record<string, unknown>) => (raw.blockBinding = 'NUMBER')],
    ['zero age', (raw: Record<string, unknown>) => (raw.maximumFinalizedBlockAgeSeconds = '0')],
    [
      'noncanonical age',
      (raw: Record<string, unknown>) => (raw.maximumFinalizedBlockAgeSeconds = '01800'),
    ],
    [
      'excessive age',
      (raw: Record<string, unknown>) => (raw.maximumFinalizedBlockAgeSeconds = '3601'),
    ],
  ])('rejects manifest scope substitution: %s', (_name, mutate) => {
    const raw = clone(definition());
    mutate(raw);
    expect(() => createMorphoBlueEthereumMarketManifest(raw)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );
  });

  it.each([
    ['wrong Morpho address', 'morphoAddress', '0x9999999999999999999999999999999999999999'],
    [
      'wrong implementation address',
      'implementationAddress',
      '0x9999999999999999999999999999999999999999',
    ],
    ['proxy claim', 'kind', 'PROXY'],
    ['zero code hash', 'morphoRuntimeCodeKeccak256', `0x${'0'.repeat(64)}`],
    ['different implementation hash', 'implementationRuntimeCodeKeccak256', `0x${'9'.repeat(64)}`],
  ])('rejects deployment identity substitution: %s', (_name, key, value) => {
    const raw = clone(definition());
    const deployment = raw.deployment as Record<string, unknown>;
    deployment[key] = value;
    expect(() => createMorphoBlueEthereumMarketManifest(raw)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );
  });

  it.each([
    ['wrong market id', 'marketId', `0x${'9'.repeat(64)}`],
    ['stablecoin mismatch', 'loanStablecoin', 'USDT'],
    ['uppercase loan address', 'loanToken', USDC.toUpperCase()],
    ['zero collateral', 'collateralToken', `0x${'0'.repeat(40)}`],
    ['duplicate dependency', 'oracle', COLLATERAL],
    ['zero LLTV', 'lltv', '0'],
    ['noncanonical LLTV', 'lltv', '0860000000000000000'],
    ['LLTV at one', 'lltv', '1000000000000000000'],
    ['bad loan hash', 'loanTokenRuntimeCodeKeccak256', '0x1234'],
    ['zero IRM hash', 'irmRuntimeCodeKeccak256', `0x${'0'.repeat(64)}`],
  ])('rejects market identity substitution: %s', (_name, key, value) => {
    const raw = clone(definition());
    const market = raw.market as Record<string, unknown>;
    market[key] = value;
    expect(() => createMorphoBlueEthereumMarketManifest(raw)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );
  });

  it('rejects an embedded or separately supplied fingerprint mismatch', () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const embedded = clone(manifest);
    embedded.manifestFingerprintSha256 = '9'.repeat(64);
    expect(() => createMorphoBlueEthereumMarketManifest(embedded)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );
    expect(
      () =>
        new MorphoBlueEthereumFinalizedTranscriptAdapter(
          manifest,
          '9'.repeat(64),
          { exchange: async () => ({}) },
          { now: () => NOW },
        ),
    ).toThrow(MorphoBlueEthereumTranscriptUnavailableError);
  });

  it('rejects accessors, symbols, custom prototypes, cycles, and oversized manifests without invoking accessors', () => {
    const getter = jest.fn(() => 1);
    const accessor = clone(definition());
    Object.defineProperty(accessor, 'chainId', { enumerable: true, get: getter });
    expect(() => createMorphoBlueEthereumMarketManifest(accessor)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );
    expect(getter).not.toHaveBeenCalled();

    const symbol = clone(definition());
    Object.defineProperty(symbol, Symbol('hidden'), { enumerable: true, value: true });
    expect(() => createMorphoBlueEthereumMarketManifest(symbol)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );

    const custom = Object.assign(Object.create({ inherited: true }), definition());
    expect(() => createMorphoBlueEthereumMarketManifest(custom)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );

    const cycle = clone(definition());
    cycle.self = cycle;
    expect(() => createMorphoBlueEthereumMarketManifest(cycle)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );

    const oversized = clone(definition());
    oversized.padding = 'x'.repeat(25_000);
    expect(() => createMorphoBlueEthereumMarketManifest(oversized)).toThrow(
      MorphoBlueEthereumTranscriptUnavailableError,
    );
  });

  it('requires the exact manifest-bound request', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter, exchange } = harness(manifest);
    await expect(
      adapter.read({ marketId: `0x${'9'.repeat(64)}`, loanStablecoin: 'USDC' }),
    ).rejects.toMatchObject(unavailable());
    await expect(
      adapter.read({ marketId: manifest.market.marketId, loanStablecoin: 'USDT' }),
    ).rejects.toMatchObject(unavailable());
    await expect(
      adapter.read({ ...request(manifest), extra: true } as never),
    ).rejects.toMatchObject(unavailable());
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each([1, 13])('rejects a chain-id mismatch at request %i', async (id) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter } = harness(manifest, {
      [id]: (rpc) => ({ jsonrpc: '2.0', id: rpc.id, result: '0x2' }),
    });
    await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
  });

  it.each([
    [3, 'Morpho'],
    [4, 'loan token'],
    [5, 'collateral'],
    [6, 'oracle'],
    [7, 'IRM'],
  ])('rejects a mismatched %s runtime hash', async (id) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter } = harness(manifest, {
      [id]: (rpc) => ({ jsonrpc: '2.0', id: rpc.id, result: '0x6000' }),
    });
    await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
  });

  it.each([
    ['loan token', { loanToken: '0x9999999999999999999999999999999999999999' }],
    ['collateral', { collateralToken: '0x9999999999999999999999999999999999999999' }],
    ['oracle', { oracle: '0x9999999999999999999999999999999999999999' }],
    ['IRM', { irm: '0x9999999999999999999999999999999999999999' }],
    ['LLTV', { lltv: LLTV - 1n }],
  ])('rejects a mismatched on-chain market %s', async (_name, changed) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter } = harness(manifest, {
      8: (rpc) => ({
        jsonrpc: '2.0',
        id: rpc.id,
        result: encodeParams(manifest.market, changed),
      }),
    });
    await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
  });

  it('rejects noncanonical or incomplete ABI market-parameter results', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const valid = encodeParams(manifest.market);
    for (const result of [
      '0x',
      `${valid}00`,
      valid.toUpperCase(),
      `0x${'1'.repeat(24)}${valid.slice(26)}`,
    ]) {
      const { adapter } = harness(manifest, {
        8: (rpc) => ({ jsonrpc: '2.0', id: rpc.id, result }),
      });
      await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
    }
  });

  it.each([
    ['uncreated market', encodeState({ lastUpdate: 0n })],
    ['future last update', encodeState({ lastUpdate: BLOCK_SECONDS + 1n })],
    ['fee above WAD', encodeState({ fee: 1_000_000_000_000_000_001n })],
    ['borrow assets without shares', encodeState({ totalBorrowAssets: 1n, totalBorrowShares: 0n })],
    ['borrow shares without assets', encodeState({ totalBorrowAssets: 0n, totalBorrowShares: 1n })],
    [
      'borrow assets above supply assets',
      encodeState({ totalSupplyAssets: 1n, totalBorrowAssets: 2n, totalBorrowShares: 2n }),
    ],
    [
      'supply assets without supply shares',
      encodeState({
        totalSupplyAssets: 1n,
        totalSupplyShares: 0n,
        totalBorrowAssets: 0n,
        totalBorrowShares: 0n,
      }),
    ],
    ['uint128 overflow', `0x${word(1n << 128n)}${encodeState().slice(66)}`],
    ['extra ABI word', `${encodeState()}${word(0n)}`],
    ['uppercase ABI', encodeState().toUpperCase()],
  ])('rejects malformed or incomplete raw market state: %s', async (_name, result) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter } = harness(manifest, {
      9: (rpc) => ({ jsonrpc: '2.0', id: rpc.id, result }),
    });
    await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
  });

  it.each([
    [
      'newly created empty market',
      encodeState({
        totalSupplyAssets: 0n,
        totalSupplyShares: 0n,
        totalBorrowAssets: 0n,
        totalBorrowShares: 0n,
      }),
    ],
    [
      'zero-assets loss state with outstanding supply shares',
      encodeState({
        totalSupplyAssets: 0n,
        totalSupplyShares: 1n,
        totalBorrowAssets: 0n,
        totalBorrowShares: 0n,
      }),
    ],
  ])('preserves valid but non-actionable raw semantics for a %s', async (_name, result) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter } = harness(manifest, {
      9: (rpc) => ({ jsonrpc: '2.0', id: rpc.id, result }),
    });
    const candidate = await adapter.read(request(manifest));
    expect(candidate.mayPersist).toBe(false);
    expect(candidate.interestAccrualStatus).toBe('NOT_ACCRUED_RAW_MARKET_STORAGE');
  });

  it.each([
    [10, `0x${'0'.repeat(64)}`],
    [11, `0x${'0'.repeat(64)}`],
    [10, `0x${'0'.repeat(63)}2`],
    [11, '0x1'],
  ])('requires canonical true governance-enabled results at request %i', async (id, result) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter } = harness(manifest, {
      [id]: (rpc) => ({ jsonrpc: '2.0', id: rpc.id, result }),
    });
    await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
  });

  it.each([
    ['zero block', { number: '0x0' }],
    ['noncanonical number', { number: '0x01' }],
    ['zero hash', { hash: `0x${'0'.repeat(64)}` }],
    ['uppercase hash', { hash: BLOCK_HASH.toUpperCase() }],
    ['missing state root', { stateRoot: undefined }],
    ['extra block field', { unknown: 'value' }],
  ])('rejects malformed finalized headers: %s', async (_name, changed) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const change = changed as Readonly<Record<string, unknown>>;
    const malformed: Record<string, unknown> = { ...block(), ...change };
    if (Object.hasOwn(change, 'stateRoot') && change.stateRoot === undefined) {
      delete malformed.stateRoot;
    }
    const { adapter } = harness(manifest, {
      2: (rpc) => ({ jsonrpc: '2.0', id: rpc.id, result: malformed }),
    });
    await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
  });

  it.each(['number', 'hash', 'parentHash', 'stateRoot', 'timestamp'] as const)(
    'rejects a %s mismatch in the final header/hash recheck',
    async (field) => {
      const manifest = createMorphoBlueEthereumMarketManifest(definition());
      const replacement =
        field === 'number'
          ? '0x1235'
          : field === 'timestamp'
            ? `0x${(BLOCK_SECONDS + 1n).toString(16)}`
            : `0x${'9'.repeat(64)}`;
      const { adapter } = harness(manifest, {
        12: (rpc) => ({
          jsonrpc: '2.0',
          id: rpc.id,
          result: block({ [field]: replacement }),
        }),
      });
      await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
    },
  );

  it('rejects future and stale finalized blocks, with equality treated as stale', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    for (const observedAt of [
      new Date(Number((BLOCK_SECONDS - 1n) * 1_000n)),
      new Date(Number((BLOCK_SECONDS + 1_800n) * 1_000n)),
      new Date(Number((BLOCK_SECONDS + 1_801n) * 1_000n)),
    ]) {
      const { adapter } = harness(manifest, {}, observedAt);
      await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
    }
  });

  it.each([new Date('invalid'), '2026-09-04T12:00:00.000Z', new (class extends Date {})()])(
    'rejects a malformed injected clock value',
    async (clockValue) => {
      const manifest = createMorphoBlueEthereumMarketManifest(definition());
      const { adapter } = harness(manifest, {}, clockValue);
      await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
    },
  );

  it('uses intrinsic Date methods without invoking adversarial instance overrides', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const clockValue = new Date(NOW.getTime());
    const getTime = jest.fn(() => Number.NaN);
    const toISOString = jest.fn(() => 'forged');
    Object.defineProperties(clockValue, {
      getTime: { enumerable: true, value: getTime },
      toISOString: { enumerable: true, value: toISOString },
    });
    const { adapter } = harness(manifest, {}, clockValue);

    await expect(adapter.read(request(manifest))).resolves.toMatchObject({
      observedAt: NOW.toISOString(),
    });
    expect(getTime).not.toHaveBeenCalled();
    expect(toISOString).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong id', () => ({ jsonrpc: '2.0', id: 99, result: '0x1' })],
    [
      'wrong version',
      (rpc: MorphoBlueEthereumJsonRpcRequest) => ({ jsonrpc: '1.0', id: rpc.id, result: '0x1' }),
    ],
    [
      'extra key',
      (rpc: MorphoBlueEthereumJsonRpcRequest) => ({
        jsonrpc: '2.0',
        id: rpc.id,
        result: '0x1',
        extra: true,
      }),
    ],
    [
      'RPC error',
      (rpc: MorphoBlueEthereumJsonRpcRequest) => ({
        jsonrpc: '2.0',
        id: rpc.id,
        error: { code: -1 },
      }),
    ],
  ])('rejects malformed JSON-RPC envelopes: %s', async (_name, response) => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const { adapter } = harness(manifest, { 1: (rpc) => response(rpc) });
    await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
  });

  it('rejects accessor, symbol, custom-prototype, and cyclic RPC responses without invoking accessors', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const getter = jest.fn(() => '0x1');
    const accessor: Record<string, unknown> = { jsonrpc: '2.0', id: 1 };
    Object.defineProperty(accessor, 'result', { enumerable: true, get: getter });
    const symbol = { jsonrpc: '2.0', id: 1, result: '0x1' };
    Object.defineProperty(symbol, Symbol('hidden'), { enumerable: true, value: true });
    const custom = Object.assign(Object.create({ inherited: true }), {
      jsonrpc: '2.0',
      id: 1,
      result: '0x1',
    });
    const cyclic: Record<string, unknown> = { jsonrpc: '2.0', id: 1 };
    cyclic.result = cyclic;
    for (const response of [accessor, symbol, custom, cyclic]) {
      const { adapter } = harness(manifest, { 1: () => response });
      await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects oversized responses, oversized runtime code, empty code, and uppercase hex code', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const cases: readonly [number, unknown][] = [
      [1, { jsonrpc: '2.0', id: 1, result: 'x'.repeat(2 * 1024 * 1024) }],
      [3, `0x${'00'.repeat(49_153)}`],
      [3, '0x'],
      [3, MORPHO_CODE.toUpperCase()],
    ];
    for (const [id, responseOrResult] of cases) {
      const { adapter } = harness(manifest, {
        [id]: (rpc) =>
          id === 1 ? responseOrResult : { jsonrpc: '2.0', id: rpc.id, result: responseOrResult },
      });
      await expect(adapter.read(request(manifest))).rejects.toMatchObject(unavailable());
    }
  });

  it('sanitizes transport failures and never logs raw upstream data', async () => {
    const manifest = createMorphoBlueEthereumMarketManifest(definition());
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { adapter } = harness(manifest, {
      6: async () => {
        throw new Error('https://secret-rpc.invalid/?token=super-secret');
      },
    });

    const error = await adapter.read(request(manifest)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MorphoBlueEthereumTranscriptUnavailableError);
    expect(error).toMatchObject(unavailable());
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('secret');
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
