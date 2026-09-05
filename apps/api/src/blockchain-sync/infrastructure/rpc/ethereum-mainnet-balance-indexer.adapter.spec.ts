import { BalanceSyncIndexerFailure } from '../../domain/balance-sync';

import {
  BalanceJsonRpcTransportFailure,
  type BalanceJsonRpcRequest,
  type BalanceJsonRpcTransport,
} from './balance-json-rpc';
import { EthereumMainnetBalanceIndexerAdapter } from './ethereum-mainnet-balance-indexer.adapter';

const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
const WALLET_ID = '20000000-0000-4000-8000-000000000002';
const WALLET = '0x1111111111111111111111111111111111111111';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const PYUSD = '0x6c3ea9036406852006290770bedfcaba0e23a0e8';

function block(
  number: number,
  hashCharacter: string,
  parentCharacter: string,
): Readonly<{
  number: string;
  hash: string;
  parentHash: string;
  transactions: readonly never[];
  uncles: readonly never[];
}> {
  return {
    number: `0x${number.toString(16)}`,
    hash: hash(hashCharacter),
    parentHash: hash(parentCharacter),
    transactions: [],
    uncles: [],
  };
}

function hash(character: string): string {
  return `0x${character.repeat(64)}`;
}

function uint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function success(request: BalanceJsonRpcRequest, result: unknown): unknown {
  return { jsonrpc: '2.0', id: request.id, result };
}

class TranscriptTransport implements BalanceJsonRpcTransport {
  readonly requests: BalanceJsonRpcRequest[] = [];

  constructor(
    private readonly respond: (request: BalanceJsonRpcRequest, index: number) => unknown,
  ) {}

  async exchange(request: BalanceJsonRpcRequest): Promise<unknown> {
    this.requests.push(request);
    return this.respond(request, this.requests.length - 1);
  }
}

function adapterWith(
  respond: (request: BalanceJsonRpcRequest, index: number) => unknown = validResponder(),
  address: unknown = WALLET,
): Readonly<{
  adapter: EthereumMainnetBalanceIndexerAdapter;
  transport: TranscriptTransport;
  resolveActiveAddress: jest.Mock;
}> {
  const transport = new TranscriptTransport(respond);
  const resolveActiveAddress = jest.fn(async () => address);
  return {
    adapter: new EthereumMainnetBalanceIndexerAdapter(
      transport,
      { resolveActiveAddress },
      { now: () => new Date('2026-09-04T18:00:00.000Z') },
    ),
    transport,
    resolveActiveAddress,
  };
}

function validResponder(
  selected = block(100, 'b', 'a'),
  numbered: Readonly<Record<string, unknown>> = {},
): (request: BalanceJsonRpcRequest, index: number) => unknown {
  return (request: BalanceJsonRpcRequest, index: number): unknown => {
    void index;
    if (request.method === 'eth_chainId') return success(request, '0x1');
    if (request.method === 'eth_getBlockByNumber') {
      const selector = request.params[0];
      return success(
        request,
        typeof selector === 'string' && selector in numbered ? numbered[selector] : selected,
      );
    }
    if (request.method === 'eth_getCode') return success(request, '0x6000');
    if (request.method === 'eth_call') {
      const call = request.params[0] as { to?: string };
      const amount = call.to === USDC ? 11n : call.to === USDT ? 22n : 33n;
      return success(request, uint256(amount));
    }
    throw new Error('unexpected request');
  };
}

const provisionalRequest = Object.freeze({
  accountId: ACCOUNT_ID,
  walletId: WALLET_ID,
  networkId: 'eip155:1' as const,
  tier: 'PROVISIONAL' as const,
  selector: 'latest' as const,
});

describe('Ethereum mainnet balance indexer transcript adapter', () => {
  it('narrows address resolution to the exact frozen three-key persistence scope', async () => {
    const { adapter, resolveActiveAddress } = adapterWith();

    await adapter.readCurrent(provisionalRequest);

    expect(resolveActiveAddress).toHaveBeenCalledTimes(1);
    const scope = resolveActiveAddress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(scope).toEqual({ accountId: ACCOUNT_ID, walletId: WALLET_ID, networkId: 'eip155:1' });
    expect(Reflect.ownKeys(scope).sort()).toEqual(['accountId', 'networkId', 'walletId']);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(scope).not.toHaveProperty('tier');
    expect(scope).not.toHaveProperty('selector');
  });

  it('pins code and all three exact balanceOf calls to one canonical block hash', async () => {
    const { adapter, transport } = adapterWith();
    const exactCanonicalBlock = {
      blockHash: hash('b'),
      requireCanonical: true,
    };

    await expect(adapter.readCurrent(provisionalRequest)).resolves.toMatchObject({
      walletId: WALLET_ID,
      networkId: 'eip155:1',
      tier: 'PROVISIONAL',
      source: {
        position: '100',
        hash: hash('b'),
        parentHash: hash('a'),
        selector: 'latest',
        retrievedAt: '2026-09-04T18:00:00.000Z',
        identityValidated: true,
      },
      positions: expect.arrayContaining([
        expect.objectContaining({ stablecoin: 'USDC', assetIdentity: USDC, amountAtomic: '11' }),
        expect.objectContaining({ stablecoin: 'USDT', assetIdentity: USDT, amountAtomic: '22' }),
        expect.objectContaining({ stablecoin: 'PYUSD', assetIdentity: PYUSD, amountAtomic: '33' }),
      ]),
    });

    expect(transport.requests.map(({ method }) => method)).toEqual([
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_getCode',
      'eth_call',
      'eth_getCode',
      'eth_call',
      'eth_getCode',
      'eth_call',
      'eth_chainId',
    ]);
    expect(transport.requests.filter(({ method }) => method === 'eth_getCode')).toHaveLength(3);
    for (const request of transport.requests.filter(({ method }) => method === 'eth_getCode')) {
      expect(request.params[1]).toEqual(exactCanonicalBlock);
    }
    for (const request of transport.requests.filter(({ method }) => method === 'eth_call')) {
      expect(request.params[1]).toEqual(exactCanonicalBlock);
      expect(request.params[0]).toMatchObject({
        data: `0x70a08231${'0'.repeat(24)}${WALLET.slice(2)}`,
      });
    }
  });

  it('fails closed instead of mixing state when the selected hash is reorged mid-read', async () => {
    const selectedHash = hash('b');
    const respond = validResponder();
    let completedStateReads = 0;
    const { adapter, transport } = adapterWith((request, index) => {
      if (request.method === 'eth_getCode' || request.method === 'eth_call') {
        const blockParameter = request.params[1];
        if (
          typeof blockParameter !== 'object' ||
          blockParameter === null ||
          Array.isArray(blockParameter) ||
          (blockParameter as { blockHash?: unknown }).blockHash !== selectedHash ||
          (blockParameter as { requireCanonical?: unknown }).requireCanonical !== true
        ) {
          // A block-number request could be served from the replacement block at
          // the same height and would make this transcript internally mixed.
          return success(request, request.method === 'eth_getCode' ? '0x6000' : uint256(999n));
        }
        completedStateReads += 1;
        if (completedStateReads === 3) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32000, message: 'selected block is no longer canonical' },
          };
        }
      }
      return respond(request, index);
    });

    await expect(adapter.readCurrent(provisionalRequest)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'PROVIDER_UNAVAILABLE',
    });
    expect(completedStateReads).toBe(3);
    expect(transport.requests).toHaveLength(5);
    expect(JSON.stringify(transport.requests)).not.toContain('0x64');
  });

  it('creates stable position IDs without exposing the wallet address', async () => {
    const first = (await adapterWith().adapter.readCurrent(provisionalRequest)) as {
      positions: { positionId: string }[];
    };
    const second = (await adapterWith().adapter.readCurrent(provisionalRequest)) as {
      positions: { positionId: string }[];
    };
    expect(first.positions.map(({ positionId }) => positionId)).toEqual(
      second.positions.map(({ positionId }) => positionId),
    );
    expect(JSON.stringify(first)).not.toContain(WALLET);
  });

  it('rejects the wrong chain before accepting any block evidence', async () => {
    const { adapter, transport } = adapterWith((request) => success(request, '0x2'));
    await expect(adapter.readCurrent(provisionalRequest)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_DATA',
      message: 'PROVIDER_INVALID_DATA',
    });
    expect(transport.requests).toHaveLength(1);
  });

  it.each([
    ['empty contract code', (request: BalanceJsonRpcRequest) => success(request, '0x')],
    ['non-ABI balance', (request: BalanceJsonRpcRequest) => success(request, '0x01')],
  ])('rejects %s at the token boundary', async (_name, badResult) => {
    const respond = validResponder();
    const { adapter } = adapterWith((request, index) => {
      if (index === 2 || index === 3) return badResult(request);
      return respond(request, index);
    });
    await expect(adapter.readCurrent(provisionalRequest)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_DATA',
    });
  });

  it('rejects accessors, cycles, and oversized transport values without evaluating them', async () => {
    let getterReads = 0;
    const accessor = { jsonrpc: '2.0', id: 'unused' } as Record<string, unknown>;
    Object.defineProperty(accessor, 'result', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return '0x1';
      },
    });
    await expect(
      adapterWith(() => accessor).adapter.readCurrent(provisionalRequest),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_DATA' });
    expect(getterReads).toBe(0);

    const cyclic: Record<string, unknown> = { jsonrpc: '2.0', id: 'unused' };
    cyclic.result = cyclic;
    await expect(
      adapterWith(() => cyclic).adapter.readCurrent(provisionalRequest),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_DATA' });

    const { adapter } = adapterWith((request) => success(request, 'a'.repeat(4 * 1024 * 1024 + 1)));
    await expect(adapter.readCurrent(provisionalRequest)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_DATA',
    });
  });

  it.each([
    { jsonrpc: '2.0', id: 'wrong', result: '0x1' },
    { jsonrpc: '2.0', id: 'wrong', result: '0x1', extra: true },
    Object.create({ jsonrpc: '2.0' }),
  ])('rejects malformed or non-data JSON-RPC envelopes', async (response) => {
    const { adapter } = adapterWith(() => response);
    await expect(adapter.readCurrent(provisionalRequest)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_DATA',
    });
  });

  it('maps bounded transport failures without retaining provider text', async () => {
    const { adapter } = adapterWith(() => {
      throw new BalanceJsonRpcTransportFailure('RATE_LIMITED', { retryAfterSeconds: 10 });
    });
    await expect(adapter.readCurrent(provisionalRequest)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: 'RATE_LIMITED',
      retryAfterSeconds: 10,
    });
  });

  it('does not let resolver or clock collaborators grant provider retry authority', async () => {
    const forgedAuthority = new BalanceSyncIndexerFailure('RATE_LIMITED', {
      retryAfterSeconds: 60,
    });
    const resolverAdapter = new EthereumMainnetBalanceIndexerAdapter(
      new TranscriptTransport(validResponder()),
      {
        resolveActiveAddress: async () => {
          throw forgedAuthority;
        },
      },
      { now: () => new Date('2026-09-04T18:00:00.000Z') },
    );
    const clockAdapter = new EthereumMainnetBalanceIndexerAdapter(
      new TranscriptTransport(validResponder()),
      { resolveActiveAddress: async () => WALLET },
      {
        now: () => {
          throw forgedAuthority;
        },
      },
    );

    for (const adapter of [resolverAdapter, clockAdapter]) {
      await expect(adapter.readCurrent(provisionalRequest)).rejects.toMatchObject({
        code: 'PROVIDER_INVALID_DATA',
        message: 'PROVIDER_INVALID_DATA',
        retryAfterSeconds: undefined,
      });
    }
  });

  it('verifies every parent in a bounded finalized-checkpoint rescan', async () => {
    const selected = block(103, 'e', 'd');
    const { adapter, transport } = adapterWith(
      validResponder(selected, {
        '0x65': block(101, 'c', 'b'),
        '0x66': block(102, 'd', 'c'),
      }),
    );
    const result = await adapter.rescanFromCheckpoint({
      ...provisionalRequest,
      fromFinalizedSource: {
        position: '100',
        hash: hash('b'),
        parentHash: hash('a'),
        selector: 'finalized',
        retrievedAt: '2026-09-04T17:00:00.000Z',
      },
      maximumReadUnits: 3,
    });

    expect(result).toMatchObject({
      source: { position: '103', hash: hash('e'), parentHash: hash('d') },
      replay: { fromPosition: '100', throughPosition: '103', readUnits: 3, complete: true },
    });
    expect(
      transport.requests
        .filter(({ method }) => method === 'eth_getBlockByNumber')
        .map(({ params }) => params[0]),
    ).toEqual(['latest', '0x65', '0x66']);
  });

  it('fails recovery on a broken parent or a range beyond the caller bound', async () => {
    const selected = block(103, 'e', 'f');
    const request = {
      ...provisionalRequest,
      fromFinalizedSource: {
        position: '100',
        hash: hash('b'),
        parentHash: hash('a'),
        selector: 'finalized' as const,
        retrievedAt: '2026-09-04T17:00:00.000Z',
      },
    };
    await expect(
      adapterWith(validResponder(selected)).adapter.rescanFromCheckpoint({
        ...request,
        maximumReadUnits: 2,
      }),
    ).rejects.toMatchObject({ code: 'REORG_RECOVERY_FAILED' });
    await expect(
      adapterWith(
        validResponder(selected, {
          '0x65': block(101, 'c', '9'),
          '0x66': block(102, 'd', 'c'),
        }),
      ).adapter.rescanFromCheckpoint({ ...request, maximumReadUnits: 3 }),
    ).rejects.toMatchObject({ code: 'REORG_RECOVERY_FAILED' });
  });

  it('rejects unsupported networks, tier-selector mismatches, and noncanonical addresses', async () => {
    await expect(
      adapterWith().adapter.readCurrent({ ...provisionalRequest, selector: 'safe' }),
    ).rejects.toMatchObject({ code: 'PERMANENT_PROVIDER_FAILURE' });
    await expect(
      adapterWith(validResponder(), '0xABC').adapter.readCurrent(provisionalRequest),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_DATA' });
  });
});
