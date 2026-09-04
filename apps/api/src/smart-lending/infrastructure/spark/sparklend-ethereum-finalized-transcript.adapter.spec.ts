import { createHash } from 'node:crypto';

import {
  SparkLendEthereumFinalizedTranscriptAdapter,
  SparkLendTranscriptUnavailableError,
  type SparkLendJsonRpcRequest,
  type SparkLendJsonRpcTransport,
} from './sparklend-ethereum-finalized-transcript.adapter';
import { sparkLendManifestFingerprintSha256 } from './sparklend-ethereum-usdc.manifest';

const C = {
  provider: '0x02c3ea4e34c0cbd694d2adfa2c690eecbc1793ee',
  pool: '0xc13e21b648a5ee794902342038ff3adab66be987',
  configurator: '0x542dba469bde58faee189ffb60c6b49ce60e0738',
  implementation: '0x5ae329203e00f76891094dcfedd5aca082a50e1b',
  dataProvider: '0xfc21d6d146e6086b8359705c8b28512a983db0cb',
  usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  spToken: '0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815',
  spTokenImplementation: '0x6175ddec3b9b38c88157c10a01ed4a3fa8639cc6',
} as const;
const codes = Object.freeze(
  Object.fromEntries(
    Object.keys(C).map((key, index) => [key, `0x60${String(index + 1).padStart(2, '0')}`]),
  ) as Record<keyof typeof C, string>,
);
const digest = (code: string): string =>
  createHash('sha256')
    .update(Buffer.from(code.slice(2), 'hex'))
    .digest('hex');
const manifest = {
  schemaVersion: 1,
  providerId: 'spark',
  protocolId: 'sparklend',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  maximumBlockAgeSeconds: '3600',
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  marketId: 'sparklend-ethereum-usdc',
  contracts: C,
  asset: { symbol: 'USDC', decimals: 6 },
  runtimeCodeSha256: Object.fromEntries(
    Object.entries(codes).map(([key, code]) => [key, digest(code)]),
  ),
  source: {
    repository: 'sparkdotfi/spark-address-registry',
    commit: 'ecea29bd2a1546bbbf4999e486b3c04f0e10b748',
    contractsPath: 'src/SparkLend.sol',
    assetPath: 'src/Ethereum.sol',
  },
} as const;
const fingerprint = sparkLendManifestFingerprintSha256(manifest);
const HASH = `0x${'a'.repeat(64)}`;
const block = {
  number: '0x10',
  hash: HASH,
  parentHash: `0x${'b'.repeat(64)}`,
  stateRoot: `0x${'c'.repeat(64)}`,
  timestamp: '0x6592001c',
};
const word = (value: bigint): string => value.toString(16).padStart(64, '0');
const words = (...values: bigint[]): string => `0x${values.map(word).join('')}`;
const address = (value: string): string => `0x${'0'.repeat(24)}${value.slice(2)}`;
const config = [6n, 0n, 0n, 0n, 0n, 0n, 1n, 0n, 1n, 0n];
const reserve = [
  0n,
  0n,
  5_000_000n,
  0n,
  1_000_000n,
  50_000_000_000_000_000_000_000_000n,
  0n,
  0n,
  0n,
  1n,
  1n,
  90n,
];

class Transcript implements SparkLendJsonRpcTransport {
  readonly requests: SparkLendJsonRpcRequest[] = [];
  mutation?: (request: SparkLendJsonRpcRequest, result: unknown) => unknown;
  async exchange(request: SparkLendJsonRpcRequest): Promise<unknown> {
    this.requests.push(request);
    let result: unknown;
    if (request.method === 'eth_chainId') result = '0x1';
    else if (request.method === 'eth_getBlockByNumber') result = block;
    else if (request.method === 'eth_getCode')
      result =
        codes[
          Object.entries(C).find(([, value]) => value === request.params[0])?.[0] as keyof typeof C
        ];
    else {
      const data = (request.params[0] as { data: string }).data;
      if (data === '0x631adfca') result = address(C.configurator);
      else if (data === '0x026b1d5f') result = address(C.pool);
      else if (data === '0x0542975c') result = address(C.provider);
      else if (data === '0x5c60da1b')
        result = address(
          (request.params[0] as { to: string }).to === C.pool
            ? C.implementation
            : C.spTokenImplementation,
        );
      else if (data === '0x7535d246') result = address(C.pool);
      else if (data === '0xb16a19de') result = address(C.usdc);
      else if (data === '0x313ce567') result = words(6n);
      else if (data.startsWith('0x3e150141')) result = words(...config);
      else if (data.startsWith('0xb55d9904')) result = words(0n);
      else if (data.startsWith('0x35ea6a75')) result = words(...reserve);
      else if (data === '0x18160ddd') result = words(5_000_000n);
      else if (data.startsWith('0x46fbe558')) result = words(0n, 10n);
      else result = '0x';
    }
    result = this.mutation?.(request, result) ?? result;
    return { jsonrpc: '2.0', id: request.id, result };
  }
}
function adapter(
  transport = new Transcript(),
  clock = new Date('2024-01-01T00:00:00.000Z'),
): SparkLendEthereumFinalizedTranscriptAdapter {
  return new SparkLendEthereumFinalizedTranscriptAdapter(manifest, fingerprint, transport, {
    now: () => clock,
  });
}
async function reject(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(SparkLendTranscriptUnavailableError);
}

describe('SparkLendEthereumFinalizedTranscriptAdapter', () => {
  it('builds only a dormant, non-persistable USDC candidate from a hash-bound transcript', async () => {
    const transport = new Transcript();
    const result = await adapter(transport).readFinalizedUSDC({ selector: 'finalized' });
    expect(result).toMatchObject({
      use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE',
      sourceTrust: 'SINGLE_UNTRUSTED_RPC',
      mayPersist: false,
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      observation: {
        totalSuppliedAtomic: 5_000_000n,
        liquidityRateRay: 50_000_000_000_000_000_000_000_000n,
        annualizedSupplyAprBasisPoints: 500n,
        supplyCapAtomic: 10_000_000n,
        supplyCapRemainingAtomic: 5_000_000n,
        supplyStatus: 'OPEN',
      },
    });
    expect(transport.requests).toHaveLength(27);
    transport.requests
      .filter(({ method }) => method === 'eth_call' || method === 'eth_getCode')
      .forEach(({ params }) =>
        expect(params.at(-1)).toEqual({ blockHash: HASH, requireCanonical: true }),
      );
    expect(transport.requests[14]?.params[0]).toEqual({
      to: C.pool,
      data: '0x5c60da1b',
      from: C.provider,
    });
    expect(transport.requests[15]?.params[0]).toEqual({
      to: C.spToken,
      data: '0x5c60da1b',
      from: C.configurator,
    });
    expect(transport.requests[25]?.params).toEqual(['0x10', false]);
  });

  it('requires the separately supplied manifest fingerprint', () => {
    expect(
      () =>
        new SparkLendEthereumFinalizedTranscriptAdapter(
          manifest,
          '0'.repeat(64),
          new Transcript(),
          { now: () => new Date() },
        ),
    ).toThrow(SparkLendTranscriptUnavailableError);
  });
  it('rejects manifest identity or code drift', () => {
    expect(
      () =>
        new SparkLendEthereumFinalizedTranscriptAdapter(
          { ...manifest, contracts: { ...C, pool: C.provider } },
          fingerprint,
          new Transcript(),
          { now: () => new Date() },
        ),
    ).toThrow(SparkLendTranscriptUnavailableError);
  });
  it('rejects a non-finalized selector before I/O', async () =>
    reject(adapter().readFinalizedUSDC({ selector: 'latest' })));

  it.each([
    ['wrong chain', 1, '0x2'],
    ['proxy code drift', 4, '0x6009'],
    ['wrong configurator relationship', 11, address(C.provider)],
    ['wrong provider/pool relationship', 12, address(C.provider)],
    ['wrong pool/provider relationship', 13, address(C.pool)],
    ['wrong data-provider relationship', 14, address(C.pool)],
    ['wrong pool implementation', 15, address(C.provider)],
    ['wrong spToken implementation', 16, address(C.provider)],
    ['wrong spToken pool', 17, address(C.provider)],
    ['wrong underlying', 18, address(C.provider)],
    ['wrong asset decimals', 19, words(18n)],
    ['wrong spToken decimals', 20, words(18n)],
    ['disabled reserve', 21, words(...config.map((value, index) => (index === 8 ? 0n : value)))],
    ['frozen reserve', 21, words(...config.map((value, index) => (index === 9 ? 1n : value)))],
    ['paused reserve', 22, words(1n)],
    ['malformed reserve ABI', 23, '0x01'],
    [
      'excessive total',
      23,
      words(...reserve.map((value, index) => (index === 2 ? 10n ** 22n : value))),
    ],
    [
      'excessive rate',
      23,
      words(...reserve.map((value, index) => (index === 5 ? 11n * 10n ** 27n : value))),
    ],
    ['total mismatch', 24, words(1n)],
    ['cap reached', 25, words(0n, 5n)],
    ['reorg', 26, { ...block, hash: `0x${'d'.repeat(64)}` }],
    ['chain drift', 27, '0x2'],
  ])('fails closed on %s', async (_name, id, replacement) => {
    const transport = new Transcript();
    transport.mutation = (request, value) => (request.id === id ? replacement : value);
    await reject(adapter(transport).readFinalizedUSDC({ selector: 'finalized' }));
  });

  it('rejects a future block timestamp', async () => {
    const transport = new Transcript();
    transport.mutation = (request, value) =>
      request.method === 'eth_getBlockByNumber' ? { ...block, timestamp: '0xffffffff' } : value;
    await reject(adapter(transport).readFinalizedUSDC({ selector: 'finalized' }));
  });
  it('rejects a stale block at the exclusive freshness boundary', async () => {
    const transport = new Transcript();
    const boundary = new Date((Number(BigInt(block.timestamp)) + 3_600) * 1_000);
    await reject(adapter(transport, boundary).readFinalizedUSDC({ selector: 'finalized' }));
  });
  it('accepts the last second before staleness and exposes staleAfter', async () => {
    const staleAfterSeconds = Number(BigInt(block.timestamp)) + 3_600;
    const result = await adapter(
      new Transcript(),
      new Date((staleAfterSeconds - 1) * 1_000),
    ).readFinalizedUSDC({ selector: 'finalized' });
    expect(result.staleAfter).toBe(new Date(staleAfterSeconds * 1_000).toISOString());
  });
  it.each(['getTime', 'toISOString'] as const)(
    'rejects a clock Date with overridden %s',
    async (method) => {
      const value = new Date('2024-01-01T00:00:00.000Z');
      Object.defineProperty(value, method, {
        value: () => (method === 'getTime' ? 0 : '2024-01-01T00:00:00.000Z'),
      });
      await reject(adapter(new Transcript(), value).readFinalizedUSDC({ selector: 'finalized' }));
    },
  );
  it('rejects Date subclasses from the clock', async () => {
    class CustomDate extends Date {}
    await reject(
      adapter(new Transcript(), new CustomDate('2024-01-01T00:00:00.000Z')).readFinalizedUSDC({
        selector: 'finalized',
      }),
    );
  });
  it('rejects an unexpected JSON-RPC envelope field', async () => {
    const transport = new Transcript();
    const original = transport.exchange.bind(transport);
    transport.exchange = async (request): Promise<unknown> => ({
      ...((await original(request)) as object),
      extra: true,
    });
    await reject(adapter(transport).readFinalizedUSDC({ selector: 'finalized' }));
  });
  it('rejects exact-shape violations and oversized JSON', async () => {
    const transport = new Transcript();
    const original = transport.exchange.bind(transport);
    transport.exchange = async (request): Promise<unknown> =>
      request.id === 1
        ? { jsonrpc: '2.0', id: 1, result: 'x'.repeat(1_048_577) }
        : original(request);
    await reject(adapter(transport).readFinalizedUSDC({ selector: 'finalized' }));
  });
  it('does not invoke response accessors', async () => {
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
    await reject(adapter(transport).readFinalizedUSDC({ selector: 'finalized' }));
    expect(invoked).toBe(false);
  });
  it('sanitizes transport errors', async () => {
    const transport = new Transcript();
    transport.exchange = async (): Promise<never> => {
      throw new Error('rpc key secret');
    };
    await expect(adapter(transport).readFinalizedUSDC({ selector: 'finalized' })).rejects.toEqual(
      expect.objectContaining({
        code: 'SPARKLEND_TRANSCRIPT_UNAVAILABLE',
        message: 'SparkLend finalized transcript is unavailable',
      }),
    );
  });
});
