import { createHash } from 'node:crypto';

import {
  GearboxV3EthereumFinalizedTranscriptAdapter,
  GearboxV3TranscriptUnavailableError,
  type GearboxV3JsonRpcRequest,
  type GearboxV3JsonRpcTransport,
} from './gearbox-v3-ethereum-finalized-transcript.adapter';
import { gearboxV3ManifestFingerprintSha256 } from './gearbox-v3-ethereum-usdc.manifest';

const C = {
  addressProvider: '0x9ea7b04da02a5373317d745c1571c84aad03321d',
  contractsRegister: '0xa50d4e7d8946a7c90652339cdbd262c375d54d99',
  pool: '0xda00000035fef4082f78def6a8903bee419fbf8e',
  underlying: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
} as const;
const codes = {
  addressProvider: '0x6001',
  contractsRegister: '0x6002',
  pool: '0x6003',
  underlying: '0x6004',
} as const;
const digest = (value: string): string =>
  createHash('sha256')
    .update(Buffer.from(value.slice(2), 'hex'))
    .digest('hex');
const manifest = {
  schemaVersion: 1,
  providerId: 'gearbox',
  protocolId: 'gearbox-v3',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  maximumBlockAgeSeconds: '3600',
  marketId: 'gearbox-v3-ethereum-usdc',
  deploymentModel: 'DIRECT_IMMUTABLE_POOL_V3_00',
  contracts: C,
  asset: { symbol: 'USDC', decimals: 6 },
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  runtimeCodeSha256: Object.fromEntries(
    Object.entries(codes).map(([key, code]) => [key, digest(code)]),
  ),
  officialSource: {
    securityRepository: 'Gearbox-protocol/security',
    securityCommit: '684522eae18dea73a8aecda25d8743bfa724446a',
    deploymentPath: 'bug-bounty/v3-scope.md',
    coreRepository: 'Gearbox-protocol/core-v3',
    coreCommit: 'e16559ae82f0f24c3dc29693c444f40d676ebff9',
    poolPath: 'contracts/pool/PoolV3.sol',
    interfacePath: 'contracts/interfaces/IPoolV3.sol',
  },
} as const;
const fingerprint = gearboxV3ManifestFingerprintSha256(manifest);
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
const addressAbi = (address: string): string => `0x${'0'.repeat(24)}${address.slice(2)}`;

class Transcript implements GearboxV3JsonRpcTransport {
  readonly requests: GearboxV3JsonRpcRequest[] = [];
  mutation?: (request: GearboxV3JsonRpcRequest, result: unknown) => unknown;
  async exchange(request: GearboxV3JsonRpcRequest): Promise<unknown> {
    this.requests.push(request);
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getBlockByNumber') result = block;
    else if (request.method === 'eth_getCode') {
      const address = request.params[0];
      result = Object.entries(C).find(([, value]) => value === address)?.[0];
      result = result === undefined ? '0x' : codes[result as keyof typeof codes];
    } else {
      const call = request.params[0] as { to: string; data: string };
      if (call.data.startsWith('0x57b5a1c6')) result = addressAbi(C.contractsRegister);
      else if (call.data.startsWith('0x5b16ebb7')) result = abi(1n);
      else if (call.data === '0x2954018c') result = addressAbi(C.addressProvider);
      else if (call.data === '0x2495a599' || call.data === '0x38d52e0f')
        result = addressAbi(C.underlying);
      else if (call.data === '0x54fd4d50') result = abi(300n);
      else if (call.data === '0x313ce567') result = abi(6n);
      else if (call.data === '0x74375359') result = abi(2_000_000n);
      else if (call.data === '0xfe14112d') result = abi(5_000_000n);
      else if (call.data === '0x18160ddd') result = abi(4_500_000n);
      else if (call.data === '0xad2961a3') result = abi(50_000_000_000_000_000_000_000_000n);
      else if (call.data === '0x5c975abb') result = abi(0n);
      else if (call.data === '0x183ace90') result = abi(100_000_000_000_000n);
      else result = '0x';
    }
    result = this.mutation?.(request, result) ?? result;
    return { jsonrpc: '2.0', id: request.id, result };
  }
}

function adapter(
  transport = new Transcript(),
  now = new Date('2024-01-01T00:00:00.000Z'),
): GearboxV3EthereumFinalizedTranscriptAdapter {
  return new GearboxV3EthereumFinalizedTranscriptAdapter(manifest, fingerprint, transport, {
    now: () => now,
  });
}
const rejected = async (candidate: Promise<unknown>): Promise<void> =>
  expect(candidate).rejects.toBeInstanceOf(GearboxV3TranscriptUnavailableError);

describe('GearboxV3EthereumFinalizedTranscriptAdapter', () => {
  it('emits only a dormant single-source raw USDC candidate', async () => {
    const transport = new Transcript();
    const result = await adapter(transport).readFinalizedUSDCMarket({ selector: 'finalized' });
    expect(result).toMatchObject({
      use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE',
      authenticity: 'SINGLE_UNTRUSTED_RPC',
      registryStatus: 'REGISTERED_POOL_AT_SELECTED_BLOCK',
      mayPersist: false,
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      staleAfter: '2024-01-01T00:58:20.000Z',
      observation: {
        availableLiquidityAtomic: 2_000_000n,
        expectedLiquidityAtomic: 5_000_000n,
        shareSupplyAtomic: 4_500_000n,
        rawSupplyRateRay: 50_000_000_000_000_000_000_000_000n,
        paused: false,
        totalDebtLimitAtomic: 100_000_000_000_000n,
      },
    });
    expect(transport.requests).toHaveLength(22);
    for (const request of transport.requests.filter(
      ({ method }) => method === 'eth_call' || method === 'eth_getCode',
    ))
      expect(request.params.at(-1)).toEqual({ blockHash: HASH, requireCanonical: true });
    expect(transport.requests[6]?.params[0]).toEqual({
      to: C.addressProvider,
      data: `0x57b5a1c6${Buffer.from('CONTRACTS_REGISTER').toString('hex').padEnd(64, '0')}${'0'.repeat(64)}`,
    });
    expect(transport.requests[20]?.params).toEqual(['0x10', false]);
  });

  it('requires a separately pinned fingerprint', () => {
    expect(
      () =>
        new GearboxV3EthereumFinalizedTranscriptAdapter(
          manifest,
          '0'.repeat(64),
          new Transcript(),
          { now: () => new Date() },
        ),
    ).toThrow(GearboxV3TranscriptUnavailableError);
  });
  it('rejects an invalid selector before transport', async () =>
    rejected(adapter().readFinalizedUSDCMarket({ selector: 'latest' })));

  it.each([
    ['wrong chain', 1, '0x5'],
    ['malformed header', 2, { ...block, number: '0x00' }],
    ['wrong provider code', 3, '0x6005'],
    ['empty pool code', 5, '0x'],
    ['wrong register relationship', 7, addressAbi(C.pool)],
    ['unregistered pool', 8, abi(0n)],
    ['wrong address provider', 9, addressAbi(C.pool)],
    ['wrong underlying', 10, addressAbi(C.pool)],
    ['wrong ERC4626 asset', 11, addressAbi(C.pool)],
    ['wrong version', 12, abi(310n)],
    ['wrong pool decimals', 13, abi(18n)],
    ['wrong asset decimals', 14, abi(18n)],
    ['malformed liquidity ABI', 15, '0x01'],
    ['excess liquidity', 15, abi(1_000_000_000_000_000_000_000_001n)],
    ['excess rate', 18, abi(1_001n * 10n ** 27n)],
    ['invalid paused bool', 19, abi(2n)],
    ['reorged header', 21, { ...block, hash: `0x${'d'.repeat(64)}` }],
    ['changed parent', 21, { ...block, parentHash: `0x${'d'.repeat(64)}` }],
    ['chain changes', 22, '0x2'],
  ])('fails closed on %s', async (_name, id, value) => {
    const transport = new Transcript();
    transport.mutation = (request, original) => (request.id === id ? value : original);
    await rejected(adapter(transport).readFinalizedUSDCMarket({ selector: 'finalized' }));
  });

  it('rejects future and stale finalized replays, including equality', async () => {
    await rejected(
      adapter(new Transcript(), new Date('2023-12-31T23:58:19.000Z')).readFinalizedUSDCMarket({
        selector: 'finalized',
      }),
    );
    await rejected(
      adapter(new Transcript(), new Date('2024-01-01T00:58:20.000Z')).readFinalizedUSDCMarket({
        selector: 'finalized',
      }),
    );
    await expect(
      adapter(new Transcript(), new Date('2024-01-01T00:58:19.000Z')).readFinalizedUSDCMarket({
        selector: 'finalized',
      }),
    ).resolves.toMatchObject({ staleAfter: '2024-01-01T00:58:20.000Z' });
  });

  it.each(['getTime', 'toISOString'] as const)(
    'rejects a clock Date with overridden %s',
    async (method) => {
      const value = new Date('2024-01-01T00:00:00.000Z');
      Object.defineProperty(value, method, {
        value: () => (method === 'getTime' ? 0 : '2024-01-01T00:00:00.000Z'),
      });
      await rejected(
        adapter(new Transcript(), value).readFinalizedUSDCMarket({ selector: 'finalized' }),
      );
    },
  );
  it('rejects clock Date subclasses', async () => {
    class CustomDate extends Date {}
    await rejected(
      adapter(new Transcript(), new CustomDate('2024-01-01T00:00:00.000Z')).readFinalizedUSDCMarket(
        { selector: 'finalized' },
      ),
    );
  });

  it('rejects unexpected response keys and oversized plain data', async () => {
    const extra = new Transcript();
    const original = extra.exchange.bind(extra);
    extra.exchange = async (request): Promise<unknown> => ({
      ...((await original(request)) as object),
      extra: true,
    });
    await rejected(adapter(extra).readFinalizedUSDCMarket({ selector: 'finalized' }));
    const huge = new Transcript();
    huge.mutation = (request, value) => (request.id === 1 ? 'x'.repeat(1_048_577) : value);
    await rejected(adapter(huge).readFinalizedUSDCMarket({ selector: 'finalized' }));
  });

  it('does not invoke accessors in untrusted data', async () => {
    let invoked = false;
    const transport = new Transcript();
    transport.exchange = async (): Promise<unknown> =>
      Object.defineProperty({ jsonrpc: '2.0', id: 1 }, 'result', {
        enumerable: true,
        get: () => {
          invoked = true;
          return '0x1';
        },
      });
    await rejected(adapter(transport).readFinalizedUSDCMarket({ selector: 'finalized' }));
    expect(invoked).toBe(false);
  });

  it('sanitizes transport failures', async () => {
    const transport = new Transcript();
    transport.exchange = async (): Promise<never> => {
      throw new Error('secret endpoint credential');
    };
    await expect(
      adapter(transport).readFinalizedUSDCMarket({ selector: 'finalized' }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'GEARBOX_V3_TRANSCRIPT_UNAVAILABLE',
        message: 'Gearbox V3 finalized transcript is unavailable',
      }),
    );
  });
});
