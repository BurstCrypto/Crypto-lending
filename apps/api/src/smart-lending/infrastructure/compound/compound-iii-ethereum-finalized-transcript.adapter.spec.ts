import { createHash } from 'node:crypto';

import {
  CompoundIIIEthereumFinalizedTranscriptAdapter,
  CompoundIIITranscriptUnavailableError,
  type CompoundIIIJsonRpcRequest,
  type CompoundIIIJsonRpcTransport,
} from './compound-iii-ethereum-finalized-transcript.adapter';
import { compoundIIIUSDCManifestFingerprintSha256 } from './compound-iii-ethereum-usdc.manifest';

const PROXY = '0xc3d688b66703497daa19211eedff47f25384cdc3';
const ADMIN = '0x1111111111111111111111111111111111111111';
const IMPLEMENTATION = '0x2222222222222222222222222222222222222222';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const CODES = { proxy: '0x6001', implementation: '0x6002', asset: '0x6003' } as const;
const sha = (code: string): string =>
  createHash('sha256')
    .update(Buffer.from(code.slice(2), 'hex'))
    .digest('hex');
const manifest = {
  schemaVersion: 1,
  providerId: 'compound',
  protocolId: 'compound-iii',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  maximumBlockAgeSeconds: '3600',
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  marketId: 'compound-iii-ethereum-usdc',
  cometProxy: PROXY,
  proxyAdmin: ADMIN,
  implementation: IMPLEMENTATION,
  baseAsset: { symbol: 'USDC', address: USDC, decimals: 6, scale: '1000000' },
  runtimeCodeSha256: {
    cometProxy: sha(CODES.proxy),
    implementation: sha(CODES.implementation),
    baseAsset: sha(CODES.asset),
  },
  officialSource: {
    repository: 'compound-finance/comet',
    commit: 'f766f51583c23acc33b2a7824654ef2029a96804',
    deploymentPath: 'deployments/mainnet/usdc',
  },
} as const;
const fingerprint = compoundIIIUSDCManifestFingerprintSha256(manifest);
const HASH = `0x${'a'.repeat(64)}`;
const PARENT = `0x${'b'.repeat(64)}`;
const STATE = `0x${'c'.repeat(64)}`;
const block = {
  number: '0x10',
  hash: HASH,
  parentHash: PARENT,
  stateRoot: STATE,
  timestamp: '0x6592001c',
};
const abi = (value: bigint): string => `0x${value.toString(16).padStart(64, '0')}`;
const addressWord = (address: string): string => `0x${'0'.repeat(24)}${address.slice(2)}`;

class Transcript implements CompoundIIIJsonRpcTransport {
  readonly requests: CompoundIIIJsonRpcRequest[] = [];
  mutation?: (request: CompoundIIIJsonRpcRequest, result: unknown) => unknown;
  async exchange(request: CompoundIIIJsonRpcRequest): Promise<unknown> {
    this.requests.push(request);
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getBlockByNumber') result = block;
    else if (request.method === 'eth_getCode') {
      const address = request.params[0];
      result =
        address === PROXY
          ? CODES.proxy
          : address === IMPLEMENTATION
            ? CODES.implementation
            : CODES.asset;
    } else {
      const call = request.params[0] as { data: string };
      if (call.data === '0x5c60da1b') result = addressWord(IMPLEMENTATION);
      else if (call.data === '0xc55dae63') result = addressWord(USDC);
      else if (call.data === '0x44c1e5eb') result = abi(1_000_000n);
      else if (call.data === '0x313ce567') result = abi(6n);
      else if (call.data === '0x18160ddd') result = abi(5_000_000n);
      else if (call.data === '0x7eb71131') result = abi(500_000_000_000_000_000n);
      else if (call.data.startsWith('0xd955759d')) result = abi(1_000_000_000n);
      else if (call.data === '0x0bc47ad1') result = abi(0n);
      else result = '0x';
    }
    result = this.mutation?.(request, result) ?? result;
    return { jsonrpc: '2.0', id: request.id, result };
  }
}

function adapter(transport = new Transcript()): CompoundIIIEthereumFinalizedTranscriptAdapter {
  return new CompoundIIIEthereumFinalizedTranscriptAdapter(manifest, fingerprint, transport, {
    now: () => new Date('2024-01-01T00:00:00.000Z'),
  });
}
const rejected = async (candidate: Promise<unknown>): Promise<void> =>
  expect(candidate).rejects.toBeInstanceOf(CompoundIIITranscriptUnavailableError);

describe('CompoundIIIEthereumFinalizedTranscriptAdapter', () => {
  it('produces a dormant non-persistable USDC candidate from one internally consistent transcript', async () => {
    const transport = new Transcript();
    const result = await adapter(transport).readFinalizedMarket({ selector: 'finalized' });
    expect(result).toMatchObject({
      use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE',
      authenticity: 'SINGLE_UNTRUSTED_RPC_TRANSCRIPT',
      mayPersist: false,
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      observation: {
        totalSuppliedAtomic: 5_000_000n,
        utilizationFactor: 500_000_000_000_000_000n,
        supplyRatePerSecondFactor: 1_000_000_000n,
        annualizedSupplyAprBasisPoints: 315n,
        providerSupplyStatus: 'OPEN',
      },
      staleAfter: '2024-01-01T00:58:20.000Z',
    });
    expect(transport.requests).toHaveLength(16);
    for (const request of transport.requests.filter(
      ({ method }) => method === 'eth_call' || method === 'eth_getCode',
    )) {
      expect(request.params.at(-1)).toEqual({ blockHash: HASH, requireCanonical: true });
    }
    expect(transport.requests[5]?.params[0]).toEqual({
      to: PROXY,
      data: '0x5c60da1b',
      from: ADMIN,
    });
    expect((transport.requests[12]?.params[0] as { data: string }).data).toBe(
      `0xd955759d${abi(500_000_000_000_000_000n).slice(2)}`,
    );
    expect(transport.requests[14]?.params).toEqual(['0x10', false]);
  });

  it('rejects at the exclusive stale boundary', async () => {
    const transport = new Transcript();
    const staleAt = new Date((Number(BigInt(block.timestamp)) + 3_600) * 1_000);
    const reader = new CompoundIIIEthereumFinalizedTranscriptAdapter(
      manifest,
      fingerprint,
      transport,
      { now: () => staleAt },
    );
    await rejected(reader.readFinalizedMarket({ selector: 'finalized' }));
  });

  it('accepts the last second before staleness and exposes staleAfter', async () => {
    const staleAfterSeconds = Number(BigInt(block.timestamp)) + 3_600;
    const reader = new CompoundIIIEthereumFinalizedTranscriptAdapter(
      manifest,
      fingerprint,
      new Transcript(),
      { now: () => new Date((staleAfterSeconds - 1) * 1_000) },
    );
    await expect(reader.readFinalizedMarket({ selector: 'finalized' })).resolves.toMatchObject({
      staleAfter: new Date(staleAfterSeconds * 1_000).toISOString(),
    });
  });

  it.each(['getTime', 'toISOString'] as const)(
    'rejects a clock Date with overridden %s',
    async (method) => {
      const value = new Date('2024-01-01T00:00:00.000Z');
      Object.defineProperty(value, method, {
        value: () => (method === 'getTime' ? 0 : '2024-01-01T00:00:00.000Z'),
      });
      const reader = new CompoundIIIEthereumFinalizedTranscriptAdapter(
        manifest,
        fingerprint,
        new Transcript(),
        { now: () => value },
      );
      await rejected(reader.readFinalizedMarket({ selector: 'finalized' }));
    },
  );

  it('rejects clock Date subclasses', async () => {
    class CustomDate extends Date {}
    const reader = new CompoundIIIEthereumFinalizedTranscriptAdapter(
      manifest,
      fingerprint,
      new Transcript(),
      { now: () => new CustomDate('2024-01-01T00:00:00.000Z') },
    );
    await rejected(reader.readFinalizedMarket({ selector: 'finalized' }));
  });

  it('requires a separately pinned exact manifest fingerprint', () => {
    expect(
      () =>
        new CompoundIIIEthereumFinalizedTranscriptAdapter(
          manifest,
          '0'.repeat(64),
          new Transcript(),
          { now: () => new Date() },
        ),
    ).toThrow(CompoundIIITranscriptUnavailableError);
  });

  it('strictly accepts validated standard header array fields', async () => {
    const transport = new Transcript();
    transport.mutation = (request, value) =>
      request.method === 'eth_getBlockByNumber'
        ? { ...(value as object), transactions: [], uncles: [], withdrawals: [] }
        : value;
    await expect(
      adapter(transport).readFinalizedMarket({ selector: 'finalized' }),
    ).resolves.toMatchObject({ mayPersist: false });
  });

  it('rejects noncanonical manifest addresses', () => {
    expect(
      () =>
        new CompoundIIIEthereumFinalizedTranscriptAdapter(
          { ...manifest, proxyAdmin: ADMIN.toUpperCase() },
          fingerprint,
          new Transcript(),
          { now: () => new Date() },
        ),
    ).toThrow(CompoundIIITranscriptUnavailableError);
  });

  it('rejects an invalid selector before transport', async () =>
    rejected(adapter().readFinalizedMarket({ selector: 'latest' })));

  it.each([
    ['wrong chain', (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 1 ? '0x5' : v)],
    [
      'malformed block',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 2 ? { ...block, number: '0x00' } : v),
    ],
    ['wrong proxy code', (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 3 ? '0x6004' : v)],
    [
      'empty implementation code',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 4 ? '0x' : v),
    ],
    [
      'wrong implementation accessor',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 6 ? addressWord(ADMIN) : v),
    ],
    [
      'wrong base asset',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 7 ? addressWord(ADMIN) : v),
    ],
    ['wrong base scale', (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 8 ? abi(1n) : v)],
    [
      'wrong comet decimals',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 9 ? abi(18n) : v),
    ],
    [
      'wrong asset decimals',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 10 ? abi(18n) : v),
    ],
    ['short ABI result', (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 11 ? '0x01' : v)],
    [
      'uint64 rate overflow',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 13 ? abi(1n << 64n) : v),
    ],
    ['invalid boolean', (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 14 ? abi(2n) : v)],
    [
      'replaced block',
      (r: CompoundIIIJsonRpcRequest, v: unknown) =>
        r.id === 15 ? { ...block, hash: `0x${'d'.repeat(64)}` } : v,
    ],
    [
      'changed state root',
      (r: CompoundIIIJsonRpcRequest, v: unknown) =>
        r.id === 15 ? { ...block, stateRoot: `0x${'d'.repeat(64)}` } : v,
    ],
    [
      'chain changed after reads',
      (r: CompoundIIIJsonRpcRequest, v: unknown) => (r.id === 16 ? '0x2' : v),
    ],
  ])('fails closed on %s', async (_name, mutation) => {
    const transport = new Transcript();
    transport.mutation = mutation;
    await rejected(adapter(transport).readFinalizedMarket({ selector: 'finalized' }));
  });

  it('rejects an unexpected response field', async () => {
    const transport = new Transcript();
    const original = transport.exchange.bind(transport);
    transport.exchange = async (request): Promise<unknown> => ({
      ...((await original(request)) as object),
      extra: true,
    });
    await rejected(adapter(transport).readFinalizedMarket({ selector: 'finalized' }));
  });

  it('rejects oversized plain data', async () => {
    const transport = new Transcript();
    transport.mutation = (request, value) => (request.id === 1 ? 'x'.repeat(1_048_577) : value);
    await rejected(adapter(transport).readFinalizedMarket({ selector: 'finalized' }));
  });

  it('does not invoke accessors in an untrusted response', async () => {
    const transport = new Transcript();
    let invoked = false;
    transport.exchange = async (): Promise<unknown> =>
      Object.defineProperty({ jsonrpc: '2.0', id: 1 }, 'result', {
        enumerable: true,
        get: () => {
          invoked = true;
          return '0x1';
        },
      });
    await rejected(adapter(transport).readFinalizedMarket({ selector: 'finalized' }));
    expect(invoked).toBe(false);
  });

  it('sanitizes transport failures', async () => {
    const transport = new Transcript();
    transport.exchange = async (): Promise<never> => {
      throw new Error('secret endpoint credential');
    };
    await expect(adapter(transport).readFinalizedMarket({ selector: 'finalized' })).rejects.toEqual(
      expect.objectContaining({
        message: 'Compound III finalized transcript is unavailable',
        code: 'COMPOUND_III_TRANSCRIPT_UNAVAILABLE',
      }),
    );
  });
});
