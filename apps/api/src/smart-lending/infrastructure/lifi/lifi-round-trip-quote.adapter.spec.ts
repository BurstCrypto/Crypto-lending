import type {
  LiveRoundTripBridgeQuote,
  ReadLiveRoundTripBridgeQuoteRequest,
} from '../../application/ports/live-bridge-route-quote-reader.port';
import type { SmartLendingExternalFeedClient } from '../external-feeds/smart-lending-external-feed.client';
import { SmartLendingExternalFeedDestination } from '../external-feeds/smart-lending-external-feed.types';
import {
  LifiRoundTripQuoteAdapter,
  LifiRoundTripQuoteUnavailableError,
} from './lifi-round-trip-quote.adapter';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const LIFI_SOLANA_CHAIN_ID = 1_151_111_081_099_710;
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ETHEREUM_USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ETHEREUM_WALLET = '0xde709f2102306220921060314715629080e2fb77';
const SOLANA_WALLET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const EVALUATED_AT = '2026-09-03T12:00:00.000Z';
const CORRELATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_AMOUNT = 10_000_000n;
const SOURCE_VALUE_USD = 10_000_000_000_000_000_000n;
const ENTRY_MINIMUM = 9_975_000n;
const EXIT_MINIMUM = 9_783_429n;

type JsonRecord = Record<string, unknown>;

interface ExternalFeedFixture {
  readonly client: SmartLendingExternalFeedClient;
  readonly get: jest.Mock;
}

interface LegFixtureOptions {
  readonly direction: 'entry' | 'exit';
  readonly id?: string;
  readonly tool?: string;
  readonly fromAmount?: bigint;
  readonly toAmountMin?: bigint;
  readonly gasCosts?: readonly unknown[];
}

function externalFeed(implementation: () => Promise<unknown>): ExternalFeedFixture {
  const get = jest.fn(implementation);
  return {
    client: { get } as unknown as SmartLendingExternalFeedClient,
    get,
  };
}

function routeRequest(
  overrides: Partial<ReadLiveRoundTripBridgeQuoteRequest> = {},
): ReadLiveRoundTripBridgeQuoteRequest {
  return {
    positionId: 'position-ethereum-usdc-1',
    opportunityId: 'opportunity-solana-usdc-1',
    source: {
      networkId: ETHEREUM,
      assetId: ETHEREUM_USDC,
      assetDecimals: 6,
      walletAddress: ETHEREUM_WALLET,
    },
    destination: {
      networkId: SOLANA,
      assetId: SOLANA_USDC,
      assetDecimals: 6,
      walletAddress: SOLANA_WALLET,
    },
    sourceAmountAtomic: SOURCE_AMOUNT,
    sourceAmountUsdMantissa: SOURCE_VALUE_USD,
    allowedBridgeProviderIds: ['relaydepository', 'polymerStandard'],
    evaluatedAt: EVALUATED_AT,
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

function lifiLeg(options: LegFixtureOptions): JsonRecord {
  const entry = options.direction === 'entry';
  const fromAmount = options.fromAmount ?? (entry ? SOURCE_AMOUNT : ENTRY_MINIMUM);
  const toAmountMin = options.toAmountMin ?? (entry ? ENTRY_MINIMUM : EXIT_MINIMUM);
  const fromChainId = entry ? 1 : LIFI_SOLANA_CHAIN_ID;
  const toChainId = entry ? LIFI_SOLANA_CHAIN_ID : 1;
  const fromTokenAddress = entry ? ETHEREUM_USDC : SOLANA_USDC;
  const toTokenAddress = entry ? SOLANA_USDC : ETHEREUM_USDC;
  const fromAddress = entry ? ETHEREUM_WALLET : SOLANA_WALLET;
  const toAddress = entry ? SOLANA_WALLET : ETHEREUM_WALLET;

  return {
    id: options.id ?? (entry ? 'entry-quote-reference' : 'exit-quote-reference'),
    type: 'lifi',
    tool: options.tool ?? (entry ? 'polymerStandard' : 'relaydepository'),
    action: {
      fromChainId,
      toChainId,
      fromToken: {
        address: fromTokenAddress,
        chainId: fromChainId,
        decimals: 6,
        coinKey: 'USDC',
      },
      toToken: {
        address: toTokenAddress,
        chainId: toChainId,
        decimals: 6,
        coinKey: 'USDC',
      },
      fromAmount: fromAmount.toString(),
      fromAddress,
      toAddress,
    },
    estimate: {
      tool: options.tool ?? (entry ? 'polymerStandard' : 'relaydepository'),
      fromAmount: fromAmount.toString(),
      toAmountMin: toAmountMin.toString(),
      gasCosts:
        options.gasCosts ??
        (entry
          ? [
              { amount: '1000', amountUSD: '0.3582000000000000001' },
              { amount: '1', amountUSD: '0.0000000000000000001' },
            ]
          : [{ amount: '1000', amountUSD: '0.0047849999999999999' }]),
      feeCosts: [{ amount: '25000', amountUSD: '0.025', included: true }],
    },
    includedSteps: [
      { type: 'protocol', tool: 'feeCollection' },
      { type: 'cross', tool: options.tool ?? (entry ? 'polymerStandard' : 'relaydepository') },
    ],
    transactionRequest: {
      data: '0xdeadbeef',
      value: '123',
    },
  };
}

function recordAt(parent: JsonRecord, key: string): JsonRecord {
  const value = parent[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid test fixture at ${key}`);
  }
  return value as JsonRecord;
}

function arrayAt(parent: JsonRecord, key: string): unknown[] {
  const value = parent[key];
  if (!Array.isArray(value)) throw new Error(`Invalid test fixture at ${key}`);
  return value;
}

function recordArrayEntry(parent: JsonRecord, key: string, index: number): JsonRecord {
  const value = arrayAt(parent, key)[index];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid test fixture at ${key}[${index}]`);
  }
  return value as JsonRecord;
}

async function expectUnavailable(
  adapter: LifiRoundTripQuoteAdapter,
  request: ReadLiveRoundTripBridgeQuoteRequest = routeRequest(),
): Promise<void> {
  await expect(adapter.readRoundTripQuote(request)).rejects.toEqual(
    new LifiRoundTripQuoteUnavailableError(),
  );
}

describe('LifiRoundTripQuoteAdapter', () => {
  it('binds both read-only quotes exactly and returns conservative round-trip evidence', async () => {
    let invocation = 0;
    const entry = lifiLeg({ direction: 'entry' });
    const exit = lifiLeg({ direction: 'exit' });
    const feed = externalFeed(async () => {
      invocation += 1;
      return invocation === 1 ? entry : exit;
    });
    const adapter = new LifiRoundTripQuoteAdapter(feed.client);

    const quote = await adapter.readRoundTripQuote(routeRequest());

    expect(feed.get).toHaveBeenCalledTimes(2);
    expect(feed.get.mock.calls).toEqual([
      [
        SmartLendingExternalFeedDestination.LifiQuote,
        {
          fromChain: '1',
          toChain: 'SOL',
          fromToken: ETHEREUM_USDC,
          toToken: SOLANA_USDC,
          fromAmount: '10000000',
          fromAddress: ETHEREUM_WALLET,
          toAddress: SOLANA_WALLET,
          slippage: '0.005',
          integrator: 'crypto-lending',
          allowBridges: 'polymerStandard,relaydepository',
          denyExchanges: 'all',
          allowDestinationCall: 'false',
          order: 'CHEAPEST',
        },
      ],
      [
        SmartLendingExternalFeedDestination.LifiQuote,
        {
          fromChain: 'SOL',
          toChain: '1',
          fromToken: SOLANA_USDC,
          toToken: ETHEREUM_USDC,
          fromAmount: '9975000',
          fromAddress: SOLANA_WALLET,
          toAddress: ETHEREUM_WALLET,
          slippage: '0.005',
          integrator: 'crypto-lending',
          allowBridges: 'polymerStandard,relaydepository',
          denyExchanges: 'all',
          allowDestinationCall: 'false',
          order: 'CHEAPEST',
        },
      ],
    ]);
    expect(feed.get.mock.calls.every((call) => Object.isFrozen(call[1]))).toBe(true);

    expect(quote).toStrictEqual({
      schemaVersion: 1,
      adapterId: 'lifi-round-trip-quote-v1',
      quoteReferenceId: expect.stringMatching(/^lifi-round-trip:[0-9a-f]{64}$/u),
      routeReferenceId: expect.stringMatching(/^lifi-route:[0-9a-f]{64}$/u),
      positionId: 'position-ethereum-usdc-1',
      opportunityId: 'opportunity-solana-usdc-1',
      sourceNetworkId: ETHEREUM,
      destinationNetworkId: SOLANA,
      sourceAssetId: ETHEREUM_USDC,
      destinationAssetId: SOLANA_USDC,
      quotedAt: EVALUATED_AT,
      validUntil: '2026-09-03T12:00:30.000Z',
      entry: {
        quoteReferenceId: 'entry-quote-reference',
        bridgeProviderId: 'polymerStandard',
        sourceAmountAtomic: SOURCE_AMOUNT,
        minimumDestinationAmountAtomic: ENTRY_MINIMUM,
        networkGasCostUsdMantissa: 358_200_000_000_000_002n,
        transferValueLossUsdMantissa: 25_000_000_000_000_000n,
      },
      exit: {
        quoteReferenceId: 'exit-quote-reference',
        bridgeProviderId: 'relaydepository',
        sourceAmountAtomic: ENTRY_MINIMUM,
        minimumDestinationAmountAtomic: EXIT_MINIMUM,
        networkGasCostUsdMantissa: 4_785_000_000_000_000n,
        transferValueLossUsdMantissa: 191_571_000_000_000_000n,
      },
      use: 'QUOTE_EVIDENCE_ONLY',
      includesTransactionPayload: false,
      mayAuthorizeTransaction: false,
      mayExecuteTransaction: false,
    });
    expect(quote.entry.bridgeProviderId).not.toBe(quote.exit.bridgeProviderId);
    expect(quote).not.toHaveProperty('transactionRequest');
    expect(quote.entry).not.toHaveProperty('feeCosts');
    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote.entry)).toBe(true);
    expect(Object.isFrozen(quote.exit)).toBe(true);
  });

  it('does not read or expose LI.FI transaction payloads or unrelated response fields', async () => {
    let payloadGetterCalls = 0;
    let unrelatedGetterCalls = 0;
    const entry = lifiLeg({ direction: 'entry' });
    Object.defineProperty(entry, 'transactionRequest', {
      enumerable: true,
      get: () => {
        payloadGetterCalls += 1;
        throw new Error('sign this attacker-controlled transaction');
      },
    });
    Object.defineProperty(entry, 'unrelatedFutureField', {
      enumerable: true,
      get: () => {
        unrelatedGetterCalls += 1;
        throw new Error('unrelated LI.FI response extension');
      },
    });
    let invocation = 0;
    const feed = externalFeed(async () => {
      invocation += 1;
      return invocation === 1 ? entry : lifiLeg({ direction: 'exit' });
    });

    const quote = await new LifiRoundTripQuoteAdapter(feed.client).readRoundTripQuote(
      routeRequest(),
    );

    expect(payloadGetterCalls).toBe(0);
    expect(unrelatedGetterCalls).toBe(0);
    expect(Object.keys(quote)).not.toContain('transactionRequest');
    expect(quote.includesTransactionPayload).toBe(false);
    expect(quote.mayAuthorizeTransaction).toBe(false);
    expect(quote.mayExecuteTransaction).toBe(false);
  });

  it('adds fees not included in minimum output and rejects ambiguous fee metadata', async () => {
    const entry = lifiLeg({ direction: 'entry' });
    recordAt(entry, 'estimate').feeCosts = [
      { amount: '0', amountUSD: '0', included: true },
      { amount: '25000', amountUSD: '0.025', included: true },
      { amount: '12345', amountUSD: '0.0123456789012345671', included: false },
    ];
    let invocation = 0;
    const feed = externalFeed(async () => {
      invocation += 1;
      return invocation === 1 ? entry : lifiLeg({ direction: 'exit' });
    });

    const quote = await new LifiRoundTripQuoteAdapter(feed.client).readRoundTripQuote(
      routeRequest(),
    );
    expect(quote.entry.transferValueLossUsdMantissa).toBe(37_345_678_901_234_568n);

    for (const invalidFeeCosts of [
      [{ amount: '10000', amountUSD: '0.01' }],
      [{ amount: '10000', amountUSD: '0.01', included: 'true' }],
      [{ amount: '10000', amountUSD: '1e-2', included: false }],
      [{ amount: '10000', amountUSD: '0', included: false }],
    ]) {
      const invalidEntry = lifiLeg({ direction: 'entry' });
      recordAt(invalidEntry, 'estimate').feeCosts = invalidFeeCosts;
      const invalidFeed = externalFeed(async () => invalidEntry);
      await expectUnavailable(new LifiRoundTripQuoteAdapter(invalidFeed.client));
      expect(invalidFeed.get).toHaveBeenCalledTimes(1);
    }
  });

  it('binds materially different normalized cost evidence to different route references', async () => {
    async function readWithEntryGas(amountUSD: string): Promise<LiveRoundTripBridgeQuote> {
      let invocation = 0;
      const feed = externalFeed(async () => {
        invocation += 1;
        return invocation === 1
          ? lifiLeg({ direction: 'entry', gasCosts: [{ amount: '1000', amountUSD }] })
          : lifiLeg({ direction: 'exit' });
      });
      return new LifiRoundTripQuoteAdapter(feed.client).readRoundTripQuote(routeRequest());
    }

    const lowerCost = await readWithEntryGas('0.1');
    const higherCost = await readWithEntryGas('0.2');

    expect(higherCost.entry.networkGasCostUsdMantissa).not.toBe(
      lowerCost.entry.networkGasCostUsdMantissa,
    );
    expect(higherCost.quoteReferenceId).not.toBe(lowerCost.quoteReferenceId);
    expect(higherCost.routeReferenceId).not.toBe(lowerCost.routeReferenceId);
  });

  it('fails closed before egress for malformed or policy-ineligible route requests', async () => {
    const feed = externalFeed(async () => lifiLeg({ direction: 'entry' }));
    const adapter = new LifiRoundTripQuoteAdapter(feed.client);
    const ethereumDestination = {
      networkId: ETHEREUM,
      assetId: ETHEREUM_USDC,
      assetDecimals: 6 as const,
      walletAddress: ETHEREUM_WALLET,
    };
    const invalidRequests: readonly ReadLiveRoundTripBridgeQuoteRequest[] = [
      routeRequest({ destination: ethereumDestination }),
      routeRequest({
        source: {
          networkId: ETHEREUM,
          assetId: ETHEREUM_USDT,
          assetDecimals: 6,
          walletAddress: ETHEREUM_WALLET,
        },
      }),
      routeRequest({ sourceAmountAtomic: 0n }),
      routeRequest({ sourceAmountUsdMantissa: 0n }),
      routeRequest({ evaluatedAt: '2026-09-03T12:00:00Z' }),
      routeRequest({ correlationId: 'not-a-uuid-v4' }),
      routeRequest({ allowedBridgeProviderIds: [] }),
      routeRequest({ allowedBridgeProviderIds: ['polymerStandard', 'polymerStandard'] }),
      routeRequest({ allowedBridgeProviderIds: ['bad,provider'] }),
      routeRequest({ allowedBridgeProviderIds: ['all', 'polymerStandard'] }),
    ];

    for (const invalid of invalidRequests) {
      await expectUnavailable(adapter, invalid);
    }
    expect(feed.get).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'estimate tool different from the selected bridge',
      mutate: (leg: JsonRecord) => {
        recordAt(leg, 'estimate').tool = 'unapprovedBridge';
      },
    },
    {
      name: 'wrong response type',
      mutate: (leg: JsonRecord) => {
        leg.type = 'route';
      },
    },
    {
      name: 'provider outside the server allowlist',
      mutate: (leg: JsonRecord) => {
        leg.tool = 'unapprovedBridge';
      },
    },
    {
      name: 'wrong source chain',
      mutate: (leg: JsonRecord) => {
        recordAt(leg, 'action').fromChainId = 10;
      },
    },
    {
      name: 'wrong source token',
      mutate: (leg: JsonRecord) => {
        recordAt(recordAt(leg, 'action'), 'fromToken').address = ETHEREUM_USDT;
      },
    },
    {
      name: 'wrong destination token decimals',
      mutate: (leg: JsonRecord) => {
        recordAt(recordAt(leg, 'action'), 'toToken').decimals = 18;
      },
    },
    {
      name: 'wrong token symbol',
      mutate: (leg: JsonRecord) => {
        recordAt(recordAt(leg, 'action'), 'toToken').coinKey = 'USDT';
      },
    },
    {
      name: 'wrong source wallet',
      mutate: (leg: JsonRecord) => {
        recordAt(leg, 'action').fromAddress = '0x52908400098527886e0f7030069857d2e4169ee7';
      },
    },
    {
      name: 'wrong destination wallet',
      mutate: (leg: JsonRecord) => {
        recordAt(leg, 'action').toAddress = SOLANA_USDC;
      },
    },
    {
      name: 'action amount different from the requested amount',
      mutate: (leg: JsonRecord) => {
        recordAt(leg, 'action').fromAmount = '9999999';
      },
    },
    {
      name: 'estimate amount different from the requested amount',
      mutate: (leg: JsonRecord) => {
        recordAt(leg, 'estimate').fromAmount = '9999999';
      },
    },
    {
      name: 'minimum output greater than the source amount',
      mutate: (leg: JsonRecord) => {
        recordAt(leg, 'estimate').toAmountMin = '10000001';
      },
    },
    {
      name: 'swap step despite exchanges being denied',
      mutate: (leg: JsonRecord) => {
        leg.includedSteps = [
          { type: 'swap', tool: 'uniswap' },
          { type: 'cross', tool: 'polymerStandard' },
        ];
      },
    },
    {
      name: 'cross step whose bridge differs from the allowlisted top-level tool',
      mutate: (leg: JsonRecord) => {
        leg.includedSteps = [
          { type: 'protocol', tool: 'feeCollection' },
          { type: 'cross', tool: 'unapprovedBridge' },
        ];
      },
    },
    {
      name: 'more than one cross-chain step',
      mutate: (leg: JsonRecord) => {
        leg.includedSteps = [
          { type: 'cross', tool: 'polymerStandard' },
          { type: 'cross', tool: 'polymerStandard' },
        ];
      },
    },
    {
      name: 'non-canonical gas cost',
      mutate: (leg: JsonRecord) => {
        recordArrayEntry(recordAt(leg, 'estimate'), 'gasCosts', 0).amountUSD = '1e-3';
      },
    },
  ])('rejects an entry quote with $name', async ({ mutate }) => {
    const entry = lifiLeg({ direction: 'entry' });
    mutate(entry);
    const feed = externalFeed(async () => entry);

    await expectUnavailable(new LifiRoundTripQuoteAdapter(feed.client));
    expect(feed.get).toHaveBeenCalledTimes(1);
  });

  it('rejects absent or unvalued network gas instead of treating it as free', async () => {
    for (const gasCosts of [
      [],
      [{ amount: '1', amountUSD: '0' }],
      [{ amount: '0', amountUSD: '0.01' }],
      [{ amountUSD: '0.01' }],
    ]) {
      const feed = externalFeed(async () => lifiLeg({ direction: 'entry', gasCosts }));
      await expectUnavailable(new LifiRoundTripQuoteAdapter(feed.client));
      expect(feed.get).toHaveBeenCalledTimes(1);
    }
  });

  it('validates the exit quote against the entry minimum and reverse route bindings', async () => {
    const invalidExit = lifiLeg({ direction: 'exit' });
    recordAt(invalidExit, 'action').fromAmount = SOURCE_AMOUNT.toString();
    recordAt(invalidExit, 'estimate').fromAmount = SOURCE_AMOUNT.toString();
    let invocation = 0;
    const feed = externalFeed(async () => {
      invocation += 1;
      return invocation === 1 ? lifiLeg({ direction: 'entry' }) : invalidExit;
    });

    await expectUnavailable(new LifiRoundTripQuoteAdapter(feed.client));
    expect(feed.get).toHaveBeenCalledTimes(2);
    expect(feed.get.mock.calls[1]?.[1]).toMatchObject({ fromAmount: ENTRY_MINIMUM.toString() });
  });

  it('sanitizes first- and second-leg upstream failures and stops after the failed leg', async () => {
    const firstFailure = externalFeed(async () => {
      throw new Error('secret LI.FI API key and raw response body');
    });
    const firstAdapter = new LifiRoundTripQuoteAdapter(firstFailure.client);

    await expectUnavailable(firstAdapter);
    expect(firstFailure.get).toHaveBeenCalledTimes(1);

    let invocation = 0;
    const secondFailure = externalFeed(async () => {
      invocation += 1;
      if (invocation === 1) return lifiLeg({ direction: 'entry' });
      throw new Error('sensitive reverse-route failure detail');
    });
    const secondAdapter = new LifiRoundTripQuoteAdapter(secondFailure.client);

    try {
      await secondAdapter.readRoundTripQuote(routeRequest());
      throw new Error('expected route quote to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(LifiRoundTripQuoteUnavailableError);
      expect(error).toMatchObject({
        code: 'LIFI_ROUND_TRIP_QUOTE_UNAVAILABLE',
        message: 'Cross-chain route quote is unavailable',
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(String(error)).not.toContain('sensitive');
    }
    expect(secondFailure.get).toHaveBeenCalledTimes(2);
  });

  it('rejects accessor-backed required response fields without invoking them', async () => {
    const topLevel = lifiLeg({ direction: 'entry' });
    let topLevelGetterCalls = 0;
    Object.defineProperty(topLevel, 'action', {
      enumerable: true,
      get: () => {
        topLevelGetterCalls += 1;
        throw new Error('malicious action accessor');
      },
    });
    const topLevelFeed = externalFeed(async () => topLevel);
    await expectUnavailable(new LifiRoundTripQuoteAdapter(topLevelFeed.client));
    expect(topLevelGetterCalls).toBe(0);

    const nested = lifiLeg({ direction: 'entry' });
    const fromToken = recordAt(recordAt(nested, 'action'), 'fromToken');
    let nestedGetterCalls = 0;
    Object.defineProperty(fromToken, 'address', {
      enumerable: true,
      get: () => {
        nestedGetterCalls += 1;
        throw new Error('malicious token accessor');
      },
    });
    const nestedFeed = externalFeed(async () => nested);
    await expectUnavailable(new LifiRoundTripQuoteAdapter(nestedFeed.client));
    expect(nestedGetterCalls).toBe(0);

    const gasAccessor = lifiLeg({ direction: 'entry' });
    const firstGas = recordArrayEntry(recordAt(gasAccessor, 'estimate'), 'gasCosts', 0);
    let gasGetterCalls = 0;
    Object.defineProperty(firstGas, 'amountUSD', {
      enumerable: true,
      get: () => {
        gasGetterCalls += 1;
        throw new Error('malicious gas accessor');
      },
    });
    const gasFeed = externalFeed(async () => gasAccessor);
    await expectUnavailable(new LifiRoundTripQuoteAdapter(gasFeed.client));
    expect(gasGetterCalls).toBe(0);
  });

  it('rejects sparse, decorated, symbol-bearing, and oversized upstream arrays', async () => {
    const sparse = lifiLeg({ direction: 'entry' });
    const sparseSteps = new Array<unknown>(2);
    sparseSteps[1] = { type: 'cross', tool: 'polymerStandard' };
    sparse.includedSteps = sparseSteps;

    const decorated = lifiLeg({ direction: 'entry' });
    const decoratedGas = arrayAt(recordAt(decorated, 'estimate'), 'gasCosts');
    Object.defineProperty(decoratedGas, 'attackerKey', {
      enumerable: true,
      value: { amountUSD: '0' },
    });

    const symbolBearing = lifiLeg({ direction: 'entry' });
    const symbolSteps = arrayAt(symbolBearing, 'includedSteps');
    Object.defineProperty(symbolSteps, Symbol('attacker'), {
      enumerable: true,
      value: { type: 'cross', tool: 'polymerStandard' },
    });

    const oversized = lifiLeg({ direction: 'entry' });
    oversized.includedSteps = Array.from({ length: 33 }, () => ({ type: 'protocol' }));

    for (const invalid of [sparse, decorated, symbolBearing, oversized]) {
      const feed = externalFeed(async () => invalid);
      await expectUnavailable(new LifiRoundTripQuoteAdapter(feed.client));
      expect(feed.get).toHaveBeenCalledTimes(1);
    }
  });
});
