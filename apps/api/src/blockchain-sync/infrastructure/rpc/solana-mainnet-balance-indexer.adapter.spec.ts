import type { BalanceJsonRpcRequest, BalanceJsonRpcTransport } from './balance-json-rpc';
import { BalanceSyncIndexerFailure } from '../../domain/balance-sync';
import {
  decodeSolanaPublicKey,
  SOLANA_TOKEN_PROGRAM_IDS,
  type SolanaTokenProgramId,
} from '../../../blockchain/domain/solana-token-account';
import { SolanaMainnetBalanceIndexerAdapter } from './solana-mainnet-balance-indexer.adapter';

const ACCOUNT_ID = '10000000-0000-4000-8000-000000000001';
const WALLET_ID = '20000000-0000-4000-8000-000000000002';
const WALLET = 'A1TMhSGzQxMr1TboBKtgixKz1sS6REASMxPo1qsyTSJd';
const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_ACCOUNT = 'BGocb4GEpbTFm8UFV2VsDSaBXHELPfAXrvd4vtt8QWrA';

function success(request: BalanceJsonRpcRequest, result: unknown): unknown {
  return { jsonrpc: '2.0', id: request.id, result };
}

function block(
  slot: number,
  blockhash: string,
  parentSlot: number,
  previousBlockhash: string,
): Readonly<{
  blockHeight: number;
  blockTime: number;
  blockhash: string;
  parentSlot: number;
  previousBlockhash: string;
  rewards: readonly never[];
}> {
  return {
    blockHeight: slot,
    blockTime: 1_788_543_000,
    blockhash,
    parentSlot,
    previousBlockhash,
    rewards: [],
  };
}

interface TokenAccountTranscript {
  pubkey: string;
  account: {
    data: [string, 'base64'];
    executable: boolean;
    lamports: number;
    owner: string;
    rentEpoch: number;
    space: number;
  };
}

function tokenProgramForMint(mint: string): SolanaTokenProgramId {
  return mint === PYUSD ? SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022 : SOLANA_TOKEN_PROGRAM_IDS.LEGACY;
}

function tokenAccount(
  mint: string,
  amount: string,
  pubkey = TOKEN_ACCOUNT,
  owner = WALLET,
): TokenAccountTranscript {
  const program = tokenProgramForMint(mint);
  const space = program === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022 ? 182 : 165;
  const data = Buffer.alloc(space);
  data.set(decodeSolanaPublicKey(mint), 0);
  data.set(decodeSolanaPublicKey(owner), 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data[108] = 1;
  if (program === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022) data[165] = 2;
  return {
    pubkey,
    account: {
      data: [data.toString('base64'), 'base64'],
      executable: false,
      lamports: 2_039_280,
      owner: program,
      rentEpoch: 1,
      space,
    },
  };
}

class TranscriptTransport implements BalanceJsonRpcTransport {
  readonly requests: BalanceJsonRpcRequest[] = [];

  constructor(private readonly respond: (request: BalanceJsonRpcRequest) => unknown) {}

  async exchange(request: BalanceJsonRpcRequest): Promise<unknown> {
    this.requests.push(request);
    return this.respond(request);
  }
}

function validResponder(
  slot = 100,
  blocks: Readonly<Record<number, unknown>> = {
    100: block(100, USDC, 99, PYUSD),
  },
  tokenResult?: (mint: string) => unknown,
): (request: BalanceJsonRpcRequest) => unknown {
  return (request: BalanceJsonRpcRequest): unknown => {
    if (request.method === 'getGenesisHash') return success(request, GENESIS);
    if (request.method === 'getSlot') return success(request, slot);
    if (request.method === 'getTokenAccountsByOwner') {
      const filter = request.params[1] as { mint?: string };
      const mint = filter.mint ?? '';
      return success(
        request,
        tokenResult?.(mint) ?? {
          context: { apiVersion: '3.1.8', slot },
          value: [tokenAccount(mint, mint === USDC ? '11' : mint === USDT ? '22' : '33')],
        },
      );
    }
    if (request.method === 'getBlock') {
      return success(request, blocks[request.params[0] as number] ?? null);
    }
    throw new Error('unexpected request');
  };
}

function adapterWith(
  respond: (request: BalanceJsonRpcRequest) => unknown = validResponder(),
  address: unknown = WALLET,
): Readonly<{
  adapter: SolanaMainnetBalanceIndexerAdapter;
  transport: TranscriptTransport;
  resolveActiveAddress: jest.Mock;
}> {
  const transport = new TranscriptTransport(respond);
  const resolveActiveAddress = jest.fn(async () => address);
  return {
    adapter: new SolanaMainnetBalanceIndexerAdapter(
      transport,
      { resolveActiveAddress },
      { now: () => new Date('2026-09-04T18:00:00.000Z') },
    ),
    transport,
    resolveActiveAddress,
  };
}

const canonicalRequest = Object.freeze({
  accountId: ACCOUNT_ID,
  walletId: WALLET_ID,
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const,
  tier: 'CANONICAL' as const,
  selector: 'confirmed' as const,
});

const provisionalRequest = Object.freeze({
  ...canonicalRequest,
  tier: 'PROVISIONAL' as const,
});

describe('Solana mainnet balance indexer transcript adapter', () => {
  it('narrows address resolution to the exact frozen three-key persistence scope', async () => {
    const { adapter, resolveActiveAddress } = adapterWith();

    await adapter.readCurrent(provisionalRequest);

    expect(resolveActiveAddress).toHaveBeenCalledTimes(1);
    const scope = resolveActiveAddress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(scope).toEqual({
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      networkId: canonicalRequest.networkId,
    });
    expect(Reflect.ownKeys(scope).sort()).toEqual(['accountId', 'networkId', 'walletId']);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(scope).not.toHaveProperty('tier');
    expect(scope).not.toHaveProperty('selector');
  });

  it('does not let resolver or clock collaborators grant provider retry authority', async () => {
    const forgedAuthority = new BalanceSyncIndexerFailure('RATE_LIMITED', {
      retryAfterSeconds: 60,
    });
    const resolverAdapter = new SolanaMainnetBalanceIndexerAdapter(
      new TranscriptTransport(validResponder()),
      {
        resolveActiveAddress: async () => {
          throw forgedAuthority;
        },
      },
      { now: () => new Date('2026-09-04T18:00:00.000Z') },
    );
    const clockAdapter = new SolanaMainnetBalanceIndexerAdapter(
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

  it('keeps processed balance indexing explicitly unavailable without making an RPC call', async () => {
    let addressReads = 0;
    const transport = new TranscriptTransport(() => {
      throw new Error('must not call transport');
    });
    const adapter = new SolanaMainnetBalanceIndexerAdapter(
      transport,
      {
        resolveActiveAddress: async () => {
          addressReads += 1;
          return WALLET;
        },
      },
      { now: () => new Date('2026-09-04T18:00:00.000Z') },
    );
    await expect(
      adapter.readCurrent({ ...canonicalRequest, tier: 'PROVISIONAL', selector: 'processed' }),
    ).rejects.toMatchObject({ code: 'PERMANENT_PROVIDER_FAILURE' });
    expect(transport.requests).toHaveLength(0);
    expect(addressReads).toBe(0);
  });

  it('serves provisional display balances from one parent-linked confirmed slot', async () => {
    const { adapter, transport } = adapterWith();
    await expect(adapter.readCurrent(provisionalRequest)).resolves.toMatchObject({
      walletId: WALLET_ID,
      networkId: canonicalRequest.networkId,
      tier: 'PROVISIONAL',
      source: {
        position: '100',
        hash: USDC,
        parentHash: PYUSD,
        selector: 'confirmed',
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
      'getGenesisHash',
      'getSlot',
      'getTokenAccountsByOwner',
      'getTokenAccountsByOwner',
      'getTokenAccountsByOwner',
      'getBlock',
      'getGenesisHash',
    ]);
    for (const request of transport.requests.filter(
      ({ method }) => method === 'getTokenAccountsByOwner',
    )) {
      expect(request.params[0]).toBe(WALLET);
      expect(request.params[2]).toEqual({
        commitment: 'confirmed',
        encoding: 'base64',
        minContextSlot: 100,
      });
    }
    expect(transport.requests.find(({ method }) => method === 'getBlock')?.params).toEqual([
      100,
      { commitment: 'confirmed', transactionDetails: 'none', rewards: false },
    ]);
  });

  it('accepts a bounded extension-capable PYUSD account owned by Token-2022', async () => {
    const { adapter, transport } = adapterWith();
    const result = (await adapter.readCurrent(provisionalRequest)) as {
      positions: Array<{ assetIdentity: string; amountAtomic: string }>;
    };

    expect(result.positions).toContainEqual(
      expect.objectContaining({ assetIdentity: PYUSD, amountAtomic: '33' }),
    );
    expect(
      transport.requests.find(
        (request) =>
          request.method === 'getTokenAccountsByOwner' &&
          (request.params[1] as { mint?: unknown }).mint === PYUSD,
      )?.params[1],
    ).toEqual({ mint: PYUSD });
  });

  it('supports finalized transcript validation without treating it as live production proof', async () => {
    const { adapter } = adapterWith();
    await expect(
      adapter.readCurrent({ ...canonicalRequest, tier: 'FINANCIAL', selector: 'finalized' }),
    ).resolves.toMatchObject({ tier: 'FINANCIAL', source: { selector: 'finalized' } });
  });

  it('also parses confirmed canonical transcripts while leaving their live-proof gate external', async () => {
    await expect(adapterWith().adapter.readCurrent(canonicalRequest)).resolves.toMatchObject({
      tier: 'CANONICAL',
      source: { selector: 'confirmed' },
    });
  });

  it('sums multiple canonical token accounts with an exact uint256 bound', async () => {
    const { adapter } = adapterWith(
      validResponder(100, undefined, (mint) => ({
        context: { slot: 100 },
        value: [tokenAccount(mint, '7', TOKEN_ACCOUNT), tokenAccount(mint, '8', TOKEN_PROGRAM)],
      })),
    );
    const result = (await adapter.readCurrent(canonicalRequest)) as {
      positions: { amountAtomic: string }[];
    };
    expect(result.positions.map(({ amountAtomic }) => amountAtomic)).toEqual(['15', '15', '15']);
  });

  it.each([
    [
      'context drift',
      (mint: string) => ({ context: { slot: 101 }, value: [tokenAccount(mint, '1')] }),
    ],
    [
      'wrong embedded mint',
      (mint: string) => {
        const value = tokenAccount(mint, '1');
        if (mint === PYUSD) {
          const bytes = Buffer.from(value.account.data[0], 'base64');
          bytes.set(decodeSolanaPublicKey(USDC), 0);
          value.account.data[0] = bytes.toString('base64');
        }
        return { context: { slot: 100 }, value: [value] };
      },
    ],
    [
      'wrong owner',
      (mint: string) => ({
        context: { slot: 100 },
        value: [tokenAccount(mint, '1', TOKEN_ACCOUNT, USDC)],
      }),
    ],
    [
      'wrong token program owner',
      (mint: string) => {
        const value = tokenAccount(mint, '1');
        value.account.owner =
          value.account.owner === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022
            ? SOLANA_TOKEN_PROGRAM_IDS.LEGACY
            : SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022;
        return { context: { slot: 100 }, value: [value] };
      },
    ],
    [
      'noncanonical base64',
      (mint: string) => {
        const value = tokenAccount(mint, '1');
        if (mint === PYUSD) value.account.data[0] = `${value.account.data[0]}\n`;
        return { context: { slot: 100 }, value: [value] };
      },
    ],
    [
      'mismatched Token-2022 spaces',
      (mint: string) => {
        const value = tokenAccount(mint, '1');
        if (mint === PYUSD) value.account.space = 183;
        return { context: { slot: 100 }, value: [value] };
      },
    ],
    [
      'unbounded Token-2022 space',
      (mint: string) => {
        const value = tokenAccount(mint, '1');
        if (mint === PYUSD) {
          value.account.space = 4_097;
          value.account.data[0] = Buffer.alloc(4_097).toString('base64');
        }
        return { context: { slot: 100 }, value: [value] };
      },
    ],
    [
      'malformed Token-2022 account discriminator',
      (mint: string) => {
        const value = tokenAccount(mint, '1');
        if (mint === PYUSD) {
          const bytes = Buffer.from(value.account.data[0], 'base64');
          bytes[165] = 1;
          value.account.data[0] = bytes.toString('base64');
        }
        return { context: { slot: 100 }, value: [value] };
      },
    ],
    [
      'duplicate account',
      (mint: string) => ({
        context: { slot: 100 },
        value: [tokenAccount(mint, '1'), tokenAccount(mint, '2')],
      }),
    ],
    [
      'unexpected field',
      (mint: string) => ({
        context: { slot: 100 },
        value: [{ ...tokenAccount(mint, '1'), extra: true }],
      }),
    ],
  ])('rejects %s in untrusted encoded account data', async (_name, tokenResult) => {
    const { adapter } = adapterWith(validResponder(100, undefined, tokenResult));
    await expect(adapter.readCurrent(canonicalRequest)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_DATA',
    });
  });

  it('sums maximum on-chain u64 amounts without Number coercion', async () => {
    const maximum = ((1n << 64n) - 1n).toString(10);
    const { adapter } = adapterWith(
      validResponder(100, undefined, (mint) => ({
        context: { slot: 100 },
        value: [tokenAccount(mint, maximum, TOKEN_ACCOUNT), tokenAccount(mint, '1', TOKEN_PROGRAM)],
      })),
    );
    const result = (await adapter.readCurrent(canonicalRequest)) as {
      positions: Array<{ amountAtomic: string }>;
    };
    expect(result.positions.map(({ amountAtomic }) => amountAtomic)).toEqual([
      '18446744073709551616',
      '18446744073709551616',
      '18446744073709551616',
    ]);
  });

  it('rejects more than the bounded account count', async () => {
    const { adapter } = adapterWith(
      validResponder(100, undefined, (mint) => ({
        context: { slot: 100 },
        value: Array.from({ length: 513 }, () => tokenAccount(mint, '1')),
      })),
    );
    await expect(adapter.readCurrent(canonicalRequest)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_DATA',
    });
  });

  it('proves lineage across skipped slots without inventing a skipped parent', async () => {
    const blocks = {
      101: block(101, USDC, 100, PYUSD),
      102: null,
      103: block(103, USDT, 101, USDC),
    };
    const { adapter, transport } = adapterWith(validResponder(103, blocks));
    const result = await adapter.rescanFromCheckpoint({
      ...canonicalRequest,
      fromFinalizedSource: {
        position: '100',
        hash: PYUSD,
        parentHash: TOKEN_PROGRAM,
        selector: 'finalized',
        retrievedAt: '2026-09-04T17:00:00.000Z',
      },
      maximumReadUnits: 3,
    });
    expect(result).toMatchObject({
      source: { position: '103', hash: USDT, parentHash: USDC },
      replay: { fromPosition: '100', throughPosition: '103', readUnits: 3, complete: true },
    });
    expect(
      transport.requests
        .filter(({ method }) => method === 'getBlock')
        .map(({ params }) => params[0]),
    ).toEqual([103, 101, 102]);
  });

  it('fails closed on broken parent linkage, bound exhaustion, identity mismatch, and invalid addresses', async () => {
    const recovery = {
      ...canonicalRequest,
      fromFinalizedSource: {
        position: '100',
        hash: PYUSD,
        parentHash: TOKEN_PROGRAM,
        selector: 'finalized' as const,
        retrievedAt: '2026-09-04T17:00:00.000Z',
      },
    };
    await expect(
      adapterWith(
        validResponder(103, { 101: block(101, USDC, 99, PYUSD), 103: block(103, USDT, 101, USDC) }),
      ).adapter.rescanFromCheckpoint({ ...recovery, maximumReadUnits: 3 }),
    ).rejects.toMatchObject({ code: 'REORG_RECOVERY_FAILED' });
    await expect(
      adapterWith(
        validResponder(103, { 103: block(103, USDT, 101, USDC) }),
      ).adapter.rescanFromCheckpoint({ ...recovery, maximumReadUnits: 2 }),
    ).rejects.toMatchObject({ code: 'REORG_RECOVERY_FAILED' });
    await expect(
      adapterWith((request) => success(request, 'wrong-genesis')).adapter.readCurrent(
        canonicalRequest,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_DATA' });
    await expect(
      adapterWith(validResponder(), 'not-base58').adapter.readCurrent(canonicalRequest),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_DATA' });
  });
});
