import { createHash } from 'node:crypto';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../../blockchain/domain/supported-asset-registry';
import type { StablecoinValuationAssetReference } from '../../domain/stablecoin-valuation-policy';
import {
  ChainlinkEthereumPriceTranscriptAdapter,
  createChainlinkEthereumFeedManifest,
  type ChainlinkEthereumFeedManifest,
  type ChainlinkEthereumFeedManifestDefinition,
  type ChainlinkEthereumFeedManifestEntryDefinition,
  type ChainlinkEthereumJsonRpcRequest,
} from './chainlink-ethereum-price-transcript.adapter';
import { StablecoinPriceTranscriptUnavailableError } from './stablecoin-price-transcript';

const OBSERVED_AT = '2026-09-04T12:00:30.000Z';
const UPDATED_AT_SECONDS = BigInt(Date.parse('2026-09-04T12:00:10.000Z') / 1_000);
const STARTED_AT_SECONDS = UPDATED_AT_SECONDS - 2n;
const BLOCK_AT_SECONDS = UPDATED_AT_SECONDS + 10n;
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const PARENT_HASH = `0x${'cd'.repeat(32)}`;
const STATE_ROOT = `0x${'ef'.repeat(32)}`;
const PROXY_CODES = Object.freeze({ USDC: '0x6001', USDT: '0x6002', PYUSD: '0x6003' });
const AGGREGATOR_CODES = Object.freeze({ USDC: '0x6101', USDT: '0x6102', PYUSD: '0x6103' });

function sha256Code(code: string): string {
  return createHash('sha256')
    .update(Buffer.from(code.slice(2), 'hex'))
    .digest('hex');
}

function entry(
  stablecoin: SupportedStablecoin,
  index: number,
  overrides: Partial<ChainlinkEthereumFeedManifestEntryDefinition> = {},
): ChainlinkEthereumFeedManifestEntryDefinition {
  const lower = stablecoin.toLowerCase();
  return {
    stablecoin,
    sourceReference: `${lower}-usd.data.eth`,
    proxyAddress: `0x${String(index).repeat(40)}`,
    aggregatorAddress: `0x${String(index + 6).repeat(40)}`,
    proxyRuntimeCodeSha256: sha256Code(PROXY_CODES[stablecoin]),
    aggregatorRuntimeCodeSha256: sha256Code(AGGREGATOR_CODES[stablecoin]),
    decimals: 8,
    description: `${stablecoin} / USD`,
    ...overrides,
  };
}

function manifestDefinition(
  overrides: Partial<ChainlinkEthereumFeedManifestDefinition> = {},
): ChainlinkEthereumFeedManifestDefinition {
  return {
    schemaVersion: 1,
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
    sourceNetworkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    feeds: [entry('USDC', 1), entry('USDT', 2), entry('PYUSD', 3)],
    ...overrides,
  };
}

function manifest(
  overrides: Partial<ChainlinkEthereumFeedManifestDefinition> = {},
): ChainlinkEthereumFeedManifest {
  return createChainlinkEthereumFeedManifest(manifestDefinition(overrides));
}

function asset(
  stablecoin: SupportedStablecoin,
  networkId = 'eip155:1',
): StablecoinValuationAssetReference {
  const row = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets.find(
    (candidate) =>
      candidate.stablecoin === stablecoin &&
      candidate.networkId === networkId &&
      candidate.activationState === 'ACTIVE',
  );
  if (!row) throw new Error('missing fixture asset');
  return {
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    stablecoin,
    networkId,
    identity: row.identity,
    decimals: row.decimals,
  };
}

function word(value: bigint): string {
  const unsigned = value < 0n ? (1n << 256n) + value : value;
  return unsigned.toString(16).padStart(64, '0');
}

function addressWord(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function abiString(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  const padded = Math.ceil(bytes.length / 32) * 32;
  return `0x${word(32n)}${word(BigInt(bytes.length))}${bytes.toString('hex').padEnd(padded * 2, '0')}`;
}

interface RoundOverrides {
  readonly roundId?: bigint;
  readonly answer?: bigint;
  readonly startedAt?: bigint;
  readonly updatedAt?: bigint;
  readonly answeredInRound?: bigint;
}

function roundData(overrides: RoundOverrides = {}): string {
  const roundId = overrides.roundId ?? 42n;
  return `0x${[
    roundId,
    overrides.answer ?? 99_980_000n,
    overrides.startedAt ?? STARTED_AT_SECONDS,
    overrides.updatedAt ?? UPDATED_AT_SECONDS,
    overrides.answeredInRound ?? roundId,
  ]
    .map(word)
    .join('')}`;
}

function block(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: '0x1234',
    hash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    stateRoot: STATE_ROOT,
    timestamp: `0x${BLOCK_AT_SECONDS.toString(16)}`,
    ...overrides,
  };
}

function rpcEnvelope(request: ChainlinkEthereumJsonRpcRequest, result: unknown): unknown {
  return { jsonrpc: '2.0', id: request.id, result };
}

function defaultResult(
  request: ChainlinkEthereumJsonRpcRequest,
  feed: ChainlinkEthereumFeedManifestEntryDefinition,
  options: Readonly<{ round?: string }> = {},
): unknown {
  switch (request.id) {
    case 1:
    case 10:
      return '0x1';
    case 2:
    case 9:
      return block();
    case 3:
      return PROXY_CODES[feed.stablecoin];
    case 4:
      return addressWord(feed.aggregatorAddress);
    case 5:
      return AGGREGATOR_CODES[feed.stablecoin];
    case 6:
      return `0x${word(BigInt(feed.decimals))}`;
    case 7:
      return abiString(feed.description);
    case 8:
      return options.round ?? roundData();
    default:
      throw new Error('unexpected synthetic request');
  }
}

function harness(
  feed: ChainlinkEthereumFeedManifestEntryDefinition,
  mutate: (
    request: ChainlinkEthereumJsonRpcRequest,
    defaultEnvelope: unknown,
  ) => unknown | Promise<unknown> = (_request, response) => response,
  options: Readonly<{ round?: string }> = {},
): {
  readonly requests: ChainlinkEthereumJsonRpcRequest[];
  readonly transport: { exchange: jest.Mock<Promise<unknown>, [ChainlinkEthereumJsonRpcRequest]> };
} {
  const requests: ChainlinkEthereumJsonRpcRequest[] = [];
  const exchange = jest.fn(async (request: ChainlinkEthereumJsonRpcRequest): Promise<unknown> => {
    requests.push(request);
    return mutate(request, rpcEnvelope(request, defaultResult(request, feed, options)));
  });
  return { requests, transport: { exchange } };
}

function adapter(
  exactManifest: ChainlinkEthereumFeedManifest,
  feed: ChainlinkEthereumFeedManifestEntryDefinition,
  mutate?: (
    request: ChainlinkEthereumJsonRpcRequest,
    response: unknown,
  ) => unknown | Promise<unknown>,
  options: Readonly<{ round?: string }> = {},
): {
  readonly candidate: ChainlinkEthereumPriceTranscriptAdapter;
  readonly requests: ChainlinkEthereumJsonRpcRequest[];
} {
  const source = harness(feed, mutate, options);
  return {
    candidate: new ChainlinkEthereumPriceTranscriptAdapter(
      exactManifest,
      exactManifest.manifestFingerprintSha256,
      source.transport,
      { now: () => new Date(OBSERVED_AT) },
    ),
    requests: source.requests,
  };
}

async function expectUnavailable(
  promise: Promise<unknown>,
): Promise<StablecoinPriceTranscriptUnavailableError> {
  let captured: unknown;
  try {
    await promise;
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(StablecoinPriceTranscriptUnavailableError);
  expect(captured).toMatchObject({
    code: 'STABLECOIN_PRICE_TRANSCRIPT_UNAVAILABLE',
    message: 'Stablecoin price transcript is unavailable',
  });
  expect(captured).not.toHaveProperty('cause');
  return captured as StablecoinPriceTranscriptUnavailableError;
}

describe('ChainlinkEthereumPriceTranscriptAdapter', () => {
  it.each([
    ['USDC', 'eip155:1'],
    ['USDT', 'eip155:1'],
    ['PYUSD', 'eip155:1'],
    ['USDC', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['USDT', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['PYUSD', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  ] as const)(
    'binds a finalized transcript to the exact %s asset on %s',
    async (coin, networkId) => {
      const exactManifest = manifest();
      const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === coin)!;
      const { candidate, requests } = adapter(exactManifest, feed);

      const result = await candidate.read({ asset: asset(coin, networkId) });

      expect(result).toMatchObject({
        schemaVersion: 1,
        sourceNetworkId: 'eip155:1',
        sourcePosition: '4660',
        sourceFinality: 'ETHEREUM_FINALIZED_BLOCK',
        sourceProofStatus: 'FINALIZED_ETHEREUM_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION',
        mayRecordAsVerifiedEvidence: false,
        observation: {
          asset: { stablecoin: coin, networkId },
          sourceId: 'CHAINLINK_DATA_FEEDS',
          sourceReference: `${coin.toLowerCase()}-usd.data.eth`,
          sourceSequence: '42',
          sourceUpdateId: '42',
          pricedAt: '2026-09-04T12:00:10.000Z',
          observedAt: OBSERVED_AT,
          usdRateMantissa: '99980000',
          usdRateScale: 8,
          confidence: { kind: 'NOT_PUBLISHED' },
        },
      });
      expect(result.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(Object.isFrozen(result)).toBe(true);
      expect(requests.map(({ id, method }) => [id, method])).toEqual([
        [1, 'eth_chainId'],
        [2, 'eth_getBlockByNumber'],
        [3, 'eth_getCode'],
        [4, 'eth_call'],
        [5, 'eth_getCode'],
        [6, 'eth_call'],
        [7, 'eth_call'],
        [8, 'eth_call'],
        [9, 'eth_getBlockByHash'],
        [10, 'eth_chainId'],
      ]);
      expect(requests[1]?.params).toEqual(['finalized', false]);
      for (const request of requests.slice(2, 8)) {
        expect(request.params.at(-1)).toEqual({ blockHash: BLOCK_HASH, requireCanonical: true });
      }
      expect(requests[8]?.params).toEqual([BLOCK_HASH, false]);
    },
  );

  it('normalizes extra source precision with integer round-half-even only', async () => {
    const definition = manifestDefinition();
    const adjustedFeeds = definition.feeds.map((feed) => ({ ...feed, decimals: 10 }));
    const exactManifest = manifest({ feeds: adjustedFeeds });
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const even = adapter(exactManifest, feed, undefined, {
      round: roundData({ answer: 10_000_000_050n }),
    });
    const odd = adapter(exactManifest, feed, undefined, {
      round: roundData({ answer: 10_000_000_150n }),
    });

    await expect(even.candidate.read({ asset: asset('USDC') })).resolves.toMatchObject({
      observation: { usdRateMantissa: '100000000' },
    });
    await expect(odd.candidate.read({ asset: asset('USDC') })).resolves.toMatchObject({
      observation: { usdRateMantissa: '100000002' },
    });
  });

  it.each([
    ['wrong chain', 1, '0x2'],
    ['empty proxy code', 3, '0x'],
    ['wrong proxy code', 3, '0x6000'],
    ['wrong aggregator', 4, addressWord(`0x${'f'.repeat(40)}`)],
    ['empty aggregator code', 5, '0x'],
    ['wrong decimals', 6, `0x${word(18n)}`],
    ['wrong description', 7, abiString('BTC / USD')],
    ['zero round', 8, roundData({ roundId: 0n, answeredInRound: 0n })],
    ['zero answer', 8, roundData({ answer: 0n })],
    ['negative answer', 8, roundData({ answer: -1n })],
    ['incomplete answer round', 8, roundData({ answeredInRound: 41n })],
    ['zero started timestamp', 8, roundData({ startedAt: 0n })],
    ['zero updated timestamp', 8, roundData({ updatedAt: 0n })],
    ['started after update', 8, roundData({ startedAt: UPDATED_AT_SECONDS + 1n })],
    ['update after block', 8, roundData({ updatedAt: BLOCK_AT_SECONDS + 1n })],
  ])('rejects %s', async (_name, responseId, result) => {
    const exactManifest = manifest();
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const { candidate, requests } = adapter(exactManifest, feed, (request, response) =>
      request.id === responseId ? rpcEnvelope(request, result) : response,
    );

    await expectUnavailable(candidate.read({ asset: asset('USDC') }));
    expect(requests.at(-1)?.id).toBeGreaterThanOrEqual(responseId);
    expect(requests.at(-1)?.id).toBeLessThanOrEqual(10);
  });

  it('rejects stale and future source timestamps against the injected trusted clock', async () => {
    const exactManifest = manifest();
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const stale = adapter(exactManifest, feed, undefined, {
      round: roundData({
        updatedAt: UPDATED_AT_SECONDS - 61n,
        startedAt: UPDATED_AT_SECONDS - 62n,
      }),
    });
    const futureClock = new ChainlinkEthereumPriceTranscriptAdapter(
      exactManifest,
      exactManifest.manifestFingerprintSha256,
      harness(feed).transport,
      { now: () => new Date('2026-09-04T12:00:15.000Z') },
    );

    await expectUnavailable(stale.candidate.read({ asset: asset('USDC') }));
    await expectUnavailable(futureClock.read({ asset: asset('USDC') }));
  });

  it('rejects a changed finalized block before returning evidence', async () => {
    const exactManifest = manifest();
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const { candidate, requests } = adapter(exactManifest, feed, (request, response) =>
      request.id === 9
        ? rpcEnvelope(request, block({ stateRoot: `0x${'11'.repeat(32)}` }))
        : response,
    );

    await expectUnavailable(candidate.read({ asset: asset('USDC') }));
    expect(requests.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it.each([
    ['wrong envelope ID', () => ({ jsonrpc: '2.0', id: 99, result: '0x1' })],
    [
      'error envelope',
      (request: ChainlinkEthereumJsonRpcRequest) => ({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -1, message: 'secret' },
      }),
    ],
    [
      'extra envelope key',
      (request: ChainlinkEthereumJsonRpcRequest) => ({
        jsonrpc: '2.0',
        id: request.id,
        result: '0x1',
        extra: true,
      }),
    ],
    ['custom prototype', () => Object.create({ jsonrpc: '2.0' })],
  ])('rejects a %s', async (_name, malformed) => {
    const exactManifest = manifest();
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const { candidate, requests } = adapter(exactManifest, feed, (request, response) =>
      request.id === 1 ? malformed(request) : response,
    );

    await expectUnavailable(candidate.read({ asset: asset('USDC') }));
    expect(requests).toHaveLength(1);
  });

  it('rejects accessors and symbols without invoking provider-controlled code', async () => {
    const exactManifest = manifest();
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const getter = jest.fn(() => '2.0');
    const accessor = Object.defineProperty({ id: 1, result: '0x1' }, 'jsonrpc', {
      enumerable: true,
      get: getter,
    });
    const symbolic = Object.assign(
      { jsonrpc: '2.0', id: 1, result: '0x1' },
      {
        [Symbol('hidden')]: true,
      },
    );
    for (const malformed of [accessor, symbolic]) {
      const { candidate } = adapter(exactManifest, feed, (request, response) =>
        request.id === 1 ? malformed : response,
      );
      await expectUnavailable(candidate.read({ asset: asset('USDC') }));
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('sanitizes transport and clock failures and never logs provider details', async () => {
    const exactManifest = manifest();
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const failedTransport = adapter(exactManifest, feed, () => {
      throw new Error('https://rpc.invalid/private-key');
    });
    const badClock = new ChainlinkEthereumPriceTranscriptAdapter(
      exactManifest,
      exactManifest.manifestFingerprintSha256,
      harness(feed).transport,
      { now: () => new Date(Number.NaN) },
    );

    const transportFailure = await expectUnavailable(
      failedTransport.candidate.read({ asset: asset('USDC') }),
    );
    await expectUnavailable(badClock.read({ asset: asset('USDC') }));
    expect(String(transportFailure)).not.toContain('private-key');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('requires an exact three-feed manifest and a separately supplied matching fingerprint', () => {
    const valid = manifest();
    expect(Object.isFrozen(valid)).toBe(true);
    expect(Object.isFrozen(valid.feeds)).toBe(true);
    expect(valid.manifestFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    const feed = valid.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;

    expect(
      () =>
        new ChainlinkEthereumPriceTranscriptAdapter(
          valid,
          '0'.repeat(64),
          harness(feed).transport,
          { now: () => new Date(OBSERVED_AT) },
        ),
    ).toThrow(StablecoinPriceTranscriptUnavailableError);
    expect(() =>
      createChainlinkEthereumFeedManifest(
        manifestDefinition({ feeds: manifestDefinition().feeds.slice(0, 2) }),
      ),
    ).toThrow(StablecoinPriceTranscriptUnavailableError);
    expect(() =>
      createChainlinkEthereumFeedManifest(
        manifestDefinition({
          feeds: [entry('USDC', 1), entry('USDC', 2), entry('PYUSD', 3)],
        }),
      ),
    ).toThrow(StablecoinPriceTranscriptUnavailableError);
    expect(() =>
      createChainlinkEthereumFeedManifest(
        manifestDefinition({
          feeds: [
            entry('USDC', 1, { sourceReference: 'eth-usd.data.eth' }),
            entry('USDT', 2),
            entry('PYUSD', 3),
          ],
        }),
      ),
    ).toThrow(StablecoinPriceTranscriptUnavailableError);
  });

  it('rejects non-data manifests and non-launch assets before transport use', async () => {
    const getter = jest.fn(() => 1);
    const badManifest = Object.defineProperty(
      { ...manifestDefinition(), schemaVersion: undefined },
      'schemaVersion',
      { enumerable: true, get: getter },
    );
    expect(() => createChainlinkEthereumFeedManifest(badManifest)).toThrow(
      StablecoinPriceTranscriptUnavailableError,
    );
    expect(getter).not.toHaveBeenCalled();

    const exactManifest = manifest();
    const feed = exactManifest.feeds.find(({ stablecoin }) => stablecoin === 'USDC')!;
    const source = harness(feed);
    const candidate = new ChainlinkEthereumPriceTranscriptAdapter(
      exactManifest,
      exactManifest.manifestFingerprintSha256,
      source.transport,
      { now: () => new Date(OBSERVED_AT) },
    );
    await expectUnavailable(
      candidate.read({ asset: { ...asset('USDC'), networkId: 'eip155:8453' } }),
    );
    await expectUnavailable(candidate.read({ asset: { ...asset('USDC'), decimals: 18 } }));
    expect(source.requests).toHaveLength(0);
  });
});
