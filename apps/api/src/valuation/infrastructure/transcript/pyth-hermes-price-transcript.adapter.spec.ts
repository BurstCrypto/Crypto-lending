import { createHash } from 'node:crypto';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../../blockchain/domain/supported-asset-registry';
import type { StablecoinValuationAssetReference } from '../../domain/stablecoin-valuation-policy';
import {
  PythHermesPriceTranscriptAdapter,
  type PythHermesLatestPriceTranscriptRequest,
} from './pyth-hermes-price-transcript.adapter';
import { StablecoinPriceTranscriptUnavailableError } from './stablecoin-price-transcript';

const OBSERVED_AT = '2026-09-04T12:00:30.000Z';
const PUBLISH_TIME = Date.parse('2026-09-04T12:00:10.000Z') / 1_000;
const UPDATE_BYTES = 'aabbccdd';
const FEED_IDS = Object.freeze({
  USDC: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT: '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  PYUSD: 'c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692',
});

function asset(
  stablecoin: SupportedStablecoin,
  networkId = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
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

interface PriceOverrides {
  readonly price?: unknown;
  readonly conf?: unknown;
  readonly expo?: unknown;
  readonly publish_time?: unknown;
}

function price(overrides: PriceOverrides = {}): Record<string, unknown> {
  return {
    price: '99980000',
    conf: '5000',
    expo: -8,
    publish_time: PUBLISH_TIME,
    ...overrides,
  };
}

interface ResponseOverrides {
  readonly updateBytes?: unknown;
  readonly id?: unknown;
  readonly price?: unknown;
  readonly emaPrice?: unknown;
  readonly metadata?: unknown;
  readonly binary?: unknown;
  readonly parsed?: unknown;
}

function response(
  stablecoin: SupportedStablecoin,
  overrides: ResponseOverrides = {},
): Record<string, unknown> {
  const parsed = {
    id: overrides.id ?? FEED_IDS[stablecoin],
    price: overrides.price ?? price(),
    ema_price: overrides.emaPrice ?? price({ price: '99979000', conf: '5100' }),
    metadata:
      overrides.metadata ??
      ({
        slot: 85_480_034,
        proof_available_time: PUBLISH_TIME + 1,
        prev_publish_time: PUBLISH_TIME - 1,
      } satisfies Record<string, unknown>),
  };
  return {
    binary:
      overrides.binary ??
      ({ encoding: 'hex', data: [overrides.updateBytes ?? UPDATE_BYTES] } satisfies Record<
        string,
        unknown
      >),
    parsed: overrides.parsed ?? [parsed],
  };
}

function harness(value: unknown): {
  readonly requests: PythHermesLatestPriceTranscriptRequest[];
  readonly transport: {
    exchange: jest.Mock<Promise<unknown>, [PythHermesLatestPriceTranscriptRequest]>;
  };
} {
  const requests: PythHermesLatestPriceTranscriptRequest[] = [];
  const exchange = jest.fn(async (request: PythHermesLatestPriceTranscriptRequest) => {
    requests.push(request);
    return value;
  });
  return { requests, transport: { exchange } };
}

function adapter(
  value: unknown,
  observedAt = OBSERVED_AT,
): {
  readonly candidate: PythHermesPriceTranscriptAdapter;
  readonly requests: PythHermesLatestPriceTranscriptRequest[];
} {
  const source = harness(value);
  return {
    candidate: new PythHermesPriceTranscriptAdapter(source.transport, {
      now: () => new Date(observedAt),
    }),
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

describe('PythHermesPriceTranscriptAdapter', () => {
  it.each([
    ['USDC', 'eip155:1'],
    ['USDT', 'eip155:1'],
    ['PYUSD', 'eip155:1'],
    ['USDC', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['USDT', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['PYUSD', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  ] as const)(
    'binds one exact %s feed to the exact launch asset on %s',
    async (coin, networkId) => {
      const { candidate, requests } = adapter(response(coin));

      const result = await candidate.read({ asset: asset(coin, networkId) });

      expect(requests).toEqual([
        {
          schemaVersion: 1,
          operation: 'LATEST_PRICE_UPDATES',
          source: 'PYTH_CORE',
          sourceNetworkId: 'pythnet:mainnet',
          feedIds: [FEED_IDS[coin]],
          encoding: 'hex',
          parsed: true,
          ignoreInvalidPriceIds: false,
        },
      ]);
      expect(result).toMatchObject({
        schemaVersion: 1,
        sourceNetworkId: 'pythnet:mainnet',
        sourcePosition: '85480034',
        sourceFinality: 'PYTH_HERMES_METADATA_UNVERIFIED',
        sourceProofStatus: 'PYTH_BINARY_UPDATE_SIGNATURE_UNVERIFIED',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION',
        mayRecordAsVerifiedEvidence: false,
        observation: {
          asset: { stablecoin: coin, networkId },
          sourceId: 'PYTH_CORE',
          sourceReference: FEED_IDS[coin],
          sourceSequence: '85480034',
          sourceUpdateId: createHash('sha256')
            .update(Buffer.from(UPDATE_BYTES, 'hex'))
            .digest('hex'),
          pricedAt: '2026-09-04T12:00:10.000Z',
          observedAt: OBSERVED_AT,
          usdRateMantissa: '99980000',
          usdRateScale: 8,
          confidence: {
            kind: 'PUBLISHED_ABSOLUTE_USD',
            mantissa: '5000',
            scale: 8,
          },
        },
      });
      expect(result.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(requests[0])).toBe(true);
      expect(Object.isFrozen(requests[0]?.feedIds)).toBe(true);
    },
  );

  it('normalizes price with half-even and confidence with a conservative ceiling', async () => {
    const exactHalfEven = response('USDC', {
      price: price({ price: '10000000050', conf: '1', expo: -10 }),
      emaPrice: price({ price: '10000000050', conf: '1', expo: -10 }),
    });
    const aboveHalfOdd = response('USDC', {
      price: price({ price: '10000000150', conf: '100', expo: -10 }),
      emaPrice: price({ price: '10000000150', conf: '100', expo: -10 }),
    });

    await expect(
      adapter(exactHalfEven).candidate.read({ asset: asset('USDC') }),
    ).resolves.toMatchObject({
      observation: {
        usdRateMantissa: '100000000',
        confidence: { mantissa: '1' },
      },
    });
    await expect(
      adapter(aboveHalfOdd).candidate.read({ asset: asset('USDC') }),
    ).resolves.toMatchObject({
      observation: {
        usdRateMantissa: '100000002',
        confidence: { mantissa: '1' },
      },
    });
  });

  it.each([
    ['wrong feed id', { id: FEED_IDS.USDT }],
    ['empty update bytes', { updateBytes: '' }],
    ['odd update bytes', { updateBytes: 'abc' }],
    ['uppercase update bytes', { updateBytes: 'AABB' }],
    ['zero price', { price: price({ price: '0' }) }],
    ['negative price', { price: price({ price: '-1' }) }],
    ['noncanonical price', { price: price({ price: '099980000' }) }],
    ['oversized price', { price: price({ price: (1n << 63n).toString() }) }],
    ['negative confidence', { price: price({ conf: '-1' }) }],
    ['oversized confidence', { price: price({ conf: (1n << 64n).toString() }) }],
    ['positive exponent', { price: price({ expo: 1 }) }],
    ['overly precise exponent', { price: price({ expo: -37 }) }],
    ['fractional exponent', { price: price({ expo: -8.5 }) }],
    ['missing publish time', { price: { price: '1', conf: '1', expo: -8 } }],
    ['mismatched EMA time', { emaPrice: price({ publish_time: PUBLISH_TIME - 1 }) }],
    [
      'zero slot',
      {
        metadata: {
          slot: 0,
          proof_available_time: PUBLISH_TIME + 1,
          prev_publish_time: PUBLISH_TIME - 1,
        },
      },
    ],
    [
      'fractional slot',
      {
        metadata: {
          slot: 1.5,
          proof_available_time: PUBLISH_TIME + 1,
          prev_publish_time: PUBLISH_TIME - 1,
        },
      },
    ],
    [
      'proof before publication',
      {
        metadata: {
          slot: 1,
          proof_available_time: PUBLISH_TIME - 1,
          prev_publish_time: PUBLISH_TIME - 1,
        },
      },
    ],
    [
      'previous time after publication',
      {
        metadata: {
          slot: 1,
          proof_available_time: PUBLISH_TIME + 1,
          prev_publish_time: PUBLISH_TIME + 1,
        },
      },
    ],
    ['normalized zero price', { price: price({ price: '1', expo: -36 }) }],
  ])('rejects %s', async (_name, overrides) => {
    await expectUnavailable(
      adapter(response('USDC', overrides)).candidate.read({ asset: asset('USDC') }),
    );
  });

  it.each([
    ['wrong binary encoding', { binary: { encoding: 'base64', data: [UPDATE_BYTES] } }],
    ['two binary updates', { binary: { encoding: 'hex', data: [UPDATE_BYTES, UPDATE_BYTES] } }],
    ['empty parsed list', { parsed: [] }],
    ['two parsed prices', { parsed: [{}, {}] }],
    ['extra envelope field', { extra: true }],
  ])('rejects %s', async (_name, mutation) => {
    const malformed = Object.assign(response('USDC'), mutation);
    await expectUnavailable(adapter(malformed).candidate.read({ asset: asset('USDC') }));
  });

  it('rejects stale, future, and future-proof timestamps', async () => {
    const stalePublishTime = PUBLISH_TIME - 41;
    const stale = response('USDC', {
      price: price({ publish_time: stalePublishTime }),
      emaPrice: price({ publish_time: stalePublishTime }),
      metadata: {
        slot: 1,
        proof_available_time: stalePublishTime + 1,
        prev_publish_time: stalePublishTime - 1,
      },
    });
    const futurePublishTime = PUBLISH_TIME + 21;
    const future = response('USDC', {
      price: price({ publish_time: futurePublishTime }),
      emaPrice: price({ publish_time: futurePublishTime }),
      metadata: {
        slot: 1,
        proof_available_time: futurePublishTime + 1,
        prev_publish_time: futurePublishTime - 1,
      },
    });
    const futureProof = response('USDC', {
      metadata: {
        slot: 1,
        proof_available_time: PUBLISH_TIME + 21,
        prev_publish_time: PUBLISH_TIME - 1,
      },
    });

    await expectUnavailable(adapter(stale).candidate.read({ asset: asset('USDC') }));
    await expectUnavailable(adapter(future).candidate.read({ asset: asset('USDC') }));
    await expectUnavailable(adapter(futureProof).candidate.read({ asset: asset('USDC') }));
  });

  it('rejects accessors, custom prototypes, symbols, and sparse arrays without invoking code', async () => {
    const getter = jest.fn(() => ({ encoding: 'hex', data: [UPDATE_BYTES] }));
    const accessor = Object.defineProperty({ parsed: [] }, 'binary', {
      enumerable: true,
      get: getter,
    });
    const custom = Object.create({ binary: {}, parsed: [] });
    const symbolic = Object.assign(response('USDC'), { [Symbol('hidden')]: true });
    const sparseData = response('USDC', {
      binary: { encoding: 'hex', data: new Array(1) },
    });

    for (const malformed of [accessor, custom, symbolic, sparseData]) {
      await expectUnavailable(adapter(malformed).candidate.read({ asset: asset('USDC') }));
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('enforces update and aggregate response size bounds', async () => {
    const tooLarge = 'aa'.repeat(512 * 1024 + 1);
    await expectUnavailable(
      adapter(response('USDC', { updateBytes: tooLarge })).candidate.read({ asset: asset('USDC') }),
    );
    const hugeIgnoredString = 'x'.repeat(1024 * 1024);
    await expectUnavailable(
      adapter({ ...response('USDC'), ignored: hugeIgnoredString }).candidate.read({
        asset: asset('USDC'),
      }),
    );
  });

  it('rejects non-launch assets before transport use', async () => {
    const source = adapter(response('USDC'));
    await expectUnavailable(
      source.candidate.read({ asset: { ...asset('USDC'), networkId: 'eip155:8453' } }),
    );
    await expectUnavailable(source.candidate.read({ asset: { ...asset('USDC'), decimals: 18 } }));
    expect(source.requests).toHaveLength(0);
  });

  it('sanitizes provider and clock failures without logging raw details', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const transport = {
      exchange: jest.fn(() => Promise.reject(new Error('bearer private-provider-token'))),
    };
    const failed = new PythHermesPriceTranscriptAdapter(transport, {
      now: () => new Date(OBSERVED_AT),
    });
    const badClock = adapter(response('USDC'), 'invalid-date');

    const providerError = await expectUnavailable(failed.read({ asset: asset('USDC') }));
    await expectUnavailable(badClock.candidate.read({ asset: asset('USDC') }));
    expect(String(providerError)).not.toContain('private-provider-token');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});
