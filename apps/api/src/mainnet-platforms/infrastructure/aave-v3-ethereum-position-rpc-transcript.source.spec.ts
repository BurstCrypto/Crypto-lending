import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import { DormantProviderPositionAdmissionCoordinator } from '../application/provider-position-admission.coordinator';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
  mainnetProviderPositionObservationPolicyFingerprintV1,
} from '../domain/mainnet-provider-position-observation-policy';
import { AaveV3EthereumPositionContextReader } from './aave-v3-ethereum-position-context.reader';
import { NodeProviderPositionAdmissionDeadlineRunner } from './node-provider-position-admission-deadline.runner';
import {
  BalanceJsonRpcTransportFailure,
  type BalanceJsonRpcRequest,
} from '../../blockchain-sync/infrastructure/rpc/balance-json-rpc';
import {
  NodeHttpsBalanceJsonRpcTransport,
  type BoundedBalanceJsonRpcResponse,
  type BoundedBalanceJsonRpcTransport,
} from '../../blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import {
  AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST as MANIFEST,
  AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR,
  AAVE_V3_ETHEREUM_POOL,
  AAVE_V3_ETHEREUM_PROTOCOL_DATA_PROVIDER,
} from '../../smart-lending/infrastructure/aave/aave-v3-ethereum-deployment.manifest';
import type { ReadProviderPositionAdmissionTargetRequestV1 } from '../application/provider-position-admission.coordinator';
import {
  AaveV3EthereumPositionRpcTranscriptSource,
  createAaveV3EthereumPositionRpcTranscriptSource,
} from './aave-v3-ethereum-position-rpc-transcript.source';
import {
  AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
  AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
  DormantAaveV3EthereumProviderPositionSource,
  type ReadAaveV3EthereumDurableTargetContextRequestV1,
  type ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1 as TranscriptRequest,
} from './dormant-aave-v3-ethereum-provider-position.source';

const NOW = Date.parse('2026-09-08T18:00:00.000Z');
const ACCOUNT = parseAccountId('11111111-1111-4111-8111-111111111111');
const WALLET = '22222222-2222-4222-8222-222222222222';
const ADDRESS = `0x${'a'.repeat(40)}`;
const FLOOR_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_HASH = `0x${'2'.repeat(64)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const BINDING = { sourceFamilyId: 'rpc-operator-a', sourceId: 'rpc-a' };
const FLOOR = { kind: 'EVM_BLOCK' as const, blockNumber: '100', blockHash: FLOOR_HASH };
const ASSETS = (['USDC', 'USDT'] as const).map((stablecoin) => ({
  stablecoin,
  networkId: 'eip155:1',
  identity: MANIFEST.assets[stablecoin].underlyingAsset,
  decimals: 6,
}));
const FAILURE = {
  name: 'AaveV3EthereumPositionRpcTranscriptUnavailableError',
  message: 'Aave V3 Ethereum position data is unavailable.',
  code: 'AAVE_V3_ETHEREUM_POSITION_RPC_TRANSCRIPT_UNAVAILABLE',
};

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}
function addressWords(addresses: readonly string[]): string {
  return `0x${addresses.map((address) => address.slice(2).padStart(64, '0')).join('')}`;
}
function header(number = '0x65', hash = BLOCK_HASH): Record<string, unknown> {
  return {
    number,
    hash,
    timestamp: `0x${Math.floor((NOW - 900_000) / 1000).toString(16)}`,
    transactions: [],
    extraData: '0x',
  };
}
function context(
  input: Pick<TranscriptRequest, 'accountId' | 'walletId' | 'correlationId'>,
): Record<string, unknown> {
  return {
    contextVersion: 1,
    use: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: input.accountId,
    walletId: input.walletId,
    correlationId: input.correlationId,
    networkId: 'eip155:1',
    contextSourceFamilyId: 'durable-postgres',
    contextSourceId: 'wallet-anchor-context',
    walletAddress: ADDRESS,
    continuityFloor: { ...FLOOR },
    resolvedAt: new Date(NOW).toISOString(),
  };
}
function request(overrides: Record<string, unknown> = {}): TranscriptRequest {
  const identity = { accountId: ACCOUNT, walletId: WALLET, correlationId: 'aave-position-read' };
  return {
    transcriptVersion: 1,
    use: AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    ...identity,
    walletAddress: ADDRESS,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: AAVE_V3_ETHEREUM_POOL,
    networkId: 'eip155:1',
    ...BINDING,
    expectedChainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    continuityFloor: { ...FLOOR },
    assets: ASSETS.map((asset) => ({ ...asset })),
    balanceReads: ASSETS.flatMap((asset) =>
      (['SUPPLY', 'BORROW'] as const).map((positionKind) => ({
        operationId: `${asset.stablecoin.toLowerCase()}-${positionKind.toLowerCase()}`,
        stablecoin: asset.stablecoin,
        positionKind,
        tokenAddress:
          positionKind === 'SUPPLY'
            ? MANIFEST.assets[asset.stablecoin].aToken
            : MANIFEST.assets[asset.stablecoin].variableDebtToken,
        callData: `0x70a08231${ADDRESS.slice(2).padStart(64, '0')}`,
      })),
    ),
    maximumResponseBytes: 65536,
    deadlineAt: new Date(NOW + 25_000).toISOString(),
    signal: new AbortController().signal,
    durableContext: context(identity),
    ...overrides,
  } as TranscriptRequest;
}

class RpcFixture implements BoundedBalanceJsonRpcTransport {
  readonly calls: { request: BalanceJsonRpcRequest; signal: AbortSignal; maximumBytes: number }[] =
    [];
  readonly wireBytes: number[] = [];
  padding = 0;
  allZero = false;
  transform: (value: unknown, request: BalanceJsonRpcRequest, index: number) => unknown = (value) =>
    value;
  async exchangeBounded(
    input: BalanceJsonRpcRequest,
    signal: AbortSignal,
    maximumBytes: number,
  ): Promise<BoundedBalanceJsonRpcResponse> {
    const index = this.calls.length;
    this.calls.push({ request: input, signal, maximumBytes });
    let result: unknown;
    if (input.method === 'eth_chainId') result = '0x1';
    else if (input.method === 'eth_getBlockByNumber')
      result = input.params[0] === '0x64' ? header('0x64', FLOOR_HASH) : header();
    else if (input.method === 'eth_call') {
      const call = input.params[0] as { to: string; data: string };
      if (call.to === AAVE_V3_ETHEREUM_PROTOCOL_DATA_PROVIDER) {
        const asset = Object.values(MANIFEST.assets).find((candidate) =>
          call.data.endsWith(candidate.underlyingAsset.slice(2)),
        );
        if (asset === undefined) throw new Error('unexpected mapping read');
        result = addressWords([asset.aToken, ZERO_ADDRESS, asset.variableDebtToken]);
      } else
        result = word(
          this.allZero
            ? 0n
            : call.to === MANIFEST.assets.USDC.aToken
              ? 1_234_567n
              : call.to === MANIFEST.assets.USDC.variableDebtToken
                ? 200_000n
                : 0n,
        );
    } else throw new Error('unexpected RPC method');
    const value = this.transform({ jsonrpc: '2.0', id: input.id, result }, input, index);
    const bodyBytes = Buffer.byteLength(JSON.stringify(value), 'utf8') + this.padding;
    if (bodyBytes > maximumBytes) throw new BalanceJsonRpcTransportFailure('PERMANENT');
    this.wireBytes.push(bodyBytes);
    return Object.freeze({ value, bodyBytes });
  }
}

function source(rpc = new RpcFixture()): {
  rpc: RpcFixture;
  reader: AaveV3EthereumPositionRpcTranscriptSource;
} {
  return { rpc, reader: new AaveV3EthereumPositionRpcTranscriptSource(BINDING, rpc) };
}

/** Fixture-only ownership evidence. No synthetic context is installed in runtime. */
function composePositionSource(
  reader: AaveV3EthereumPositionRpcTranscriptSource,
): DormantAaveV3EthereumProviderPositionSource {
  const issued = new WeakMap<object, ReadAaveV3EthereumDurableTargetContextRequestV1>();
  return new DormantAaveV3EthereumProviderPositionSource(
    {
      contextVersion: 1,
      sourceFamilyId: 'durable-postgres',
      sourceId: 'wallet-anchor-context',
      readContext: async (input) => {
        const result = context(input);
        issued.set(result, input);
        return result;
      },
      verifyContext: (candidate, input) =>
        typeof candidate === 'object' && candidate !== null && issued.get(candidate) === input,
    },
    reader,
    { now: () => new Date(Date.now()) },
  );
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Aave Ethereum position RPC transcript', () => {
  it.each([false, true])(
    'runs the stored-wallet, RPC and two-source admission path (divergence=%s)',
    async (divergent) => {
      const clock = { now: () => new Date(Date.now()) };
      const rpcA = new RpcFixture();
      const rpcB = new RpcFixture();
      if (divergent) rpcB.allZero = true;
      const bindings = [rpcA, rpcB].map((rpc, index) => {
        const sourceBinding = { sourceFamilyId: `rpc-operator-${index}`, sourceId: `rpc-${index}` };
        const storedContext = new AaveV3EthereumPositionContextReader(
          { resolveActiveAddress: async () => ADDRESS },
          {
            load: async (scope) => ({
              revision: 1,
              scope,
              currentObservation: null,
              lastFinalizedSource: {
                position: '100',
                hash: FLOOR_HASH,
                parentHash: BLOCK_HASH,
                selector: 'finalized',
                retrievedAt: new Date(NOW - 1000).toISOString(),
              },
              freshness: 'CURRENT',
              staleSince: null,
              lastFailureCode: null,
            }),
          },
        );
        return {
          ...sourceBinding,
          sourceKind: 'RPC' as const,
          networkId: 'eip155:1',
          source: new DormantAaveV3EthereumProviderPositionSource(
            storedContext,
            new AaveV3EthereumPositionRpcTranscriptSource(sourceBinding, rpc),
            clock,
          ),
        };
      });
      const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
      const content = {
        policyVersion: 1,
        use: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
        policyId: 'test-aave-read-policy',
        assetRegistryVersion: registry.version,
        assetRegistryFingerprintSha256: registry.fingerprintSha256,
        providers: [
          {
            providerId: 'aave',
            protocols: [
              {
                protocolId: 'aave-v3',
                markets: [
                  {
                    networkId: 'eip155:1',
                    marketId: AAVE_V3_ETHEREUM_POOL,
                    assets: ASSETS.map(({ stablecoin, identity }) => ({ stablecoin, identity })),
                  },
                ],
              },
            ],
          },
        ],
        sources: bindings.map(({ sourceId, sourceKind, networkId }) => ({
          sourceId,
          sourceKind,
          networkId,
        })),
      };
      const fingerprintSha256 = mainnetProviderPositionObservationPolicyFingerprintV1(content);
      const coordinator = new DormantProviderPositionAdmissionCoordinator(
        { ...content, fingerprintSha256 },
        fingerprintSha256,
        bindings,
        {
          readActiveWalletRegistrations: async () => [{ walletId: WALLET, networkId: 'eip155:1' }],
        },
        clock,
        new NodeProviderPositionAdmissionDeadlineRunner(clock),
        { deadlineMilliseconds: 5000, maximumConcurrency: 2 },
      );
      const pending = coordinator.admit({ accountId: ACCOUNT, correlationId: 'aave-pair-read' });
      if (divergent) await expect(pending).rejects.toMatchObject({ code: 'DIVERGENT_EVIDENCE' });
      else {
        const candidate = await pending;
        expect(candidate.targets).toHaveLength(1);
        expect(candidate.targets[0]).toMatchObject({
          status: 'COMPLETE',
          divergenceStatus: 'AGREED',
          providerId: 'aave',
          walletId: WALLET,
        });
        expect(candidate.targets[0]?.acceptedSources).toHaveLength(2);
        expect(candidate.targets[0]?.positions).toHaveLength(2);
        expect(candidate.mayAuthorizeFinancialAction).toBe(false);
        expect(candidate.mayCreatePositionSnapshot).toBe(false);
      }
      expect(rpcA.calls).toHaveLength(11);
      expect(rpcB.calls).toHaveLength(11);
    },
  );

  it('composes real RPC transcript parsing with the existing position reader', async () => {
    const { rpc, reader } = source();
    const input: ReadProviderPositionAdmissionTargetRequestV1 = {
      admissionVersion: 1,
      accountId: ACCOUNT,
      walletId: WALLET,
      correlationId: 'aave-position-read',
      deadlineAt: new Date(NOW + 25_000).toISOString(),
      signal: new AbortController().signal,
      ...BINDING,
      sourceKind: 'RPC',
      providerId: 'aave',
      protocolId: 'aave-v3',
      marketId: AAVE_V3_ETHEREUM_POOL,
      networkId: 'eip155:1',
      assets: ASSETS,
    };
    const result = await composePositionSource(reader).readTarget(input);
    expect(result).toMatchObject({
      accountId: ACCOUNT,
      walletId: WALLET,
      status: 'COMPLETE',
      mayAuthorizeFinancialAction: false,
      chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '101', blockHash: BLOCK_HASH },
      positions: [
        { positionKind: 'SUPPLY', balance: { atomic: '1234567', decimal: '1.234567' } },
        { positionKind: 'BORROW', balance: { atomic: '200000', decimal: '0.200000' } },
      ],
    });
    expect(rpc.calls).toHaveLength(11);
    for (const call of rpc.calls.filter(({ request: item }) => item.method === 'eth_call')) {
      expect(call.request.params[1]).toEqual({ blockHash: BLOCK_HASH, requireCanonical: true });
      expect(Object.keys(call.request.params[0] as object).sort()).toEqual(['data', 'to']);
    }
    expect(rpc.calls[1]?.request.params).toEqual(['finalized', false]);
    expect(rpc.calls[2]?.request.params).toEqual(['0x64', false]);
    expect(rpc.calls[9]?.request.params).toEqual(['0x65', false]);
  });

  it('reports empty positions only after reading every supply and debt balance', async () => {
    const { rpc, reader } = source();
    rpc.allZero = true;
    const input = request();
    const result = (await reader.readTranscript(input)) as { balanceReads: { result: string }[] };
    expect(result.balanceReads).toHaveLength(4);
    expect(result.balanceReads.every(({ result: balance }) => balance === word(0n))).toBe(true);
    expect(reader.verifyTranscript(result, input)).toBe(true);
  });

  it('permits one explicitly requested supported asset and bounds its exact calls', async () => {
    const input = request();
    const subset = {
      ...input,
      assets: input.assets.slice(1),
      balanceReads: input.balanceReads.slice(2),
    };
    const { rpc, reader } = source();
    await reader.readTranscript(subset);
    expect(rpc.calls).toHaveLength(8);
    expect(rpc.calls[3]?.request.params[0]).toEqual({
      to: AAVE_V3_ETHEREUM_PROTOCOL_DATA_PROVIDER,
      data: `${AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR}${MANIFEST.assets.USDT.underlyingAsset.slice(2).padStart(64, '0')}`,
    });
  });

  it('counts real body bytes including whitespace against one cumulative limit', async () => {
    const { rpc, reader } = source();
    rpc.padding = 1000;
    await reader.readTranscript(request());
    let remaining = 1024 * 1024;
    rpc.calls.forEach((call, index) => {
      expect(call.maximumBytes).toBe(remaining);
      remaining -= rpc.wireBytes[index]!;
    });
    expect(remaining).toBeGreaterThan(0);
  });

  it('stops the read plan when cumulative RPC responses exhaust the limit', async () => {
    const { rpc, reader } = source();
    rpc.padding = 256_000;
    await expect(reader.readTranscript(request())).rejects.toMatchObject(FAILURE);
    expect(rpc.calls.length).toBeLessThan(11);
    expect(rpc.calls.at(-1)?.maximumBytes).toBeLessThan(256_000);
  });

  it('accepts bounded Ethereum block replies containing transaction hashes without retaining those hashes', async () => {
    const { rpc, reader } = source();
    rpc.transform = (value, call) =>
      call.method === 'eth_getBlockByNumber'
        ? {
            ...(value as object),
            result: {
              ...(value as { result: object }).result,
              transactions: Array.from({ length: 1500 }, () => BLOCK_HASH),
            },
          }
        : value;
    const result = await reader.readTranscript(request());
    expect(rpc.wireBytes.some((bytes) => bytes > 65536)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(65536);
    expect(JSON.stringify(result)).not.toContain('transactions');
  });

  it.each([
    { providerId: 'compound' },
    { networkId: 'eip155:8453' },
    { expectedChainId: '0x2' },
    { blockSelector: 'latest' },
    { blockBinding: 'BLOCK_NUMBER_ONLY' },
    { marketId: ZERO_ADDRESS },
    { sourceFamilyId: 'other-operator' },
    { sourceId: 'other-source' },
    { walletAddress: ZERO_ADDRESS },
    { mayAuthorizeFinancialAction: true },
    { mayPersist: true },
    { maximumResponseBytes: 65537 },
    { assets: [] },
    { balanceReads: [] },
    { durableContext: {} },
    { extra: 'not allowed' },
    { deadlineAt: new Date(NOW).toISOString() },
    { deadlineAt: new Date(NOW + 30_001).toISOString() },
  ])('rejects an invalid plan before any RPC call %#', async (overrides) => {
    const { rpc, reader } = source();
    await expect(reader.readTranscript(request(overrides))).rejects.toMatchObject(FAILURE);
    expect(rpc.calls).toHaveLength(0);
  });

  it('rejects changed calldata, token identities, extra operations and duplicate assets before I/O', async () => {
    for (const mutate of [
      (input: TranscriptRequest) => ({
        ...input,
        balanceReads: input.balanceReads.map((operation) => ({
          ...operation,
          callData: '0x095ea7b3',
        })),
      }),
      (input: TranscriptRequest) => ({
        ...input,
        balanceReads: input.balanceReads.map((operation) => ({
          ...operation,
          tokenAddress: ZERO_ADDRESS,
        })),
      }),
      (input: TranscriptRequest) => ({
        ...input,
        balanceReads: [...input.balanceReads, input.balanceReads[0]!],
      }),
      (input: TranscriptRequest) => ({ ...input, assets: [input.assets[0]!, input.assets[0]!] }),
      (input: TranscriptRequest) => ({
        ...input,
        assets: input.assets.map((asset) => ({ ...asset, decimals: 18 })),
      }),
    ]) {
      const { rpc, reader } = source();
      await expect(reader.readTranscript(mutate(request()))).rejects.toMatchObject(FAILURE);
      expect(rpc.calls).toHaveLength(0);
    }
  });

  it('rejects unbound context and accessors without reading the accessor', async () => {
    const { rpc, reader } = source();
    const input = request();
    (input.durableContext as Record<string, unknown>).walletId =
      '44444444-4444-4444-8444-444444444444';
    await expect(reader.readTranscript(input)).rejects.toMatchObject(FAILURE);
    const getter = jest.fn(() => ADDRESS);
    const accessorInput = request();
    Object.defineProperty(accessorInput, 'walletAddress', { enumerable: true, get: getter });
    await expect(reader.readTranscript(accessorInput)).rejects.toMatchObject(FAILURE);
    await expect(reader.readTranscript(new Proxy(request(), {}))).rejects.toMatchObject(FAILURE);
    expect(getter).not.toHaveBeenCalled();
    expect(rpc.calls).toHaveLength(0);
  });

  it.each([
    ['wrong initial chain', 0, '0x2'],
    ['wrong final chain', 10, '0x2'],
    ['regressing finalized head', 1, header('0x63')],
    ['continuity hash mismatch', 2, header('0x64', BLOCK_HASH)],
    ['changed canonical block', 9, header('0x65', FLOOR_HASH)],
    ['old finalized head', 1, { ...header(), timestamp: '0x1' }],
    [
      'future finalized head',
      1,
      { ...header(), timestamp: `0x${(BigInt(NOW / 1000) + 1n).toString(16)}` },
    ],
    ['missing finalized header', 1, null],
    ['wrong reserve tokens', 3, addressWords([ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS])],
    ['dirty ABI padding', 3, `0x${'1'.repeat(192)}`],
    ['short balance', 5, '0x1'],
    ['oversized balance', 5, `0x${'a'.repeat(66)}`],
  ])('rejects %s without publishing partial positions', async (_name, index, changedResult) => {
    const { rpc, reader } = source();
    rpc.transform = (value, _request, callIndex) =>
      callIndex === index ? { ...(value as object), result: changedResult } : value;
    await expect(reader.readTranscript(request())).rejects.toMatchObject(FAILURE);
    expect(rpc.calls).toHaveLength(Number(index) + 1);
  });

  it('sanitizes JSON-RPC errors and mismatched response identifiers', async () => {
    const { rpc, reader } = source();
    rpc.transform = (value) => ({ ...(value as object), id: 'wrong' });
    await expect(reader.readTranscript(request())).rejects.toMatchObject(FAILURE);
    rpc.transform = (_value, input) => ({
      jsonrpc: '2.0',
      id: input.id,
      error: { code: -32000, message: 'secret provider detail' },
    });
    await expect(reader.readTranscript(request())).rejects.toMatchObject(FAILURE);
  });

  it('authenticates issued result and exact request identities without accepting clones', async () => {
    const { reader } = source();
    const input = request();
    const result = (await reader.readTranscript(input)) as object;
    expect(Object.isFrozen(result)).toBe(true);
    expect(reader.verifyTranscript({ ...result }, input)).toBe(false);
    expect(reader.verifyTranscript(result, { ...input })).toBe(false);
    expect(source().reader.verifyTranscript(result, input)).toBe(false);
    expect(reader.verifyTranscript(result, input)).toBe(true);
  });

  it('rejects mutation during I/O and never resumes that request', async () => {
    const { rpc, reader } = source();
    const input = request();
    rpc.transform = (value, _rpcRequest, index) => {
      if (index === 0)
        (input.durableContext as Record<string, unknown>).resolvedAt = new Date(
          NOW - 1,
        ).toISOString();
      return value;
    };
    await expect(reader.readTranscript(input)).rejects.toMatchObject(FAILURE);
  });

  it('permanently invalidates a proof after expiration or a clock rollback', async () => {
    for (const invalidTime of [NOW - 1, NOW + 25_000]) {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      const { reader } = source();
      const input = request();
      const result = await reader.readTranscript(input);
      jest.spyOn(Date, 'now').mockReturnValue(invalidTime);
      expect(reader.verifyTranscript(result, input)).toBe(false);
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      expect(reader.verifyTranscript(result, input)).toBe(false);
    }
  });

  it('rejects an already aborted request without network work', async () => {
    const { rpc, reader } = source();
    const controller = new AbortController();
    controller.abort();
    await expect(
      reader.readTranscript(request({ signal: controller.signal })),
    ).rejects.toMatchObject(FAILURE);
    expect(rpc.calls).toHaveLength(0);
  });

  it.each(['caller', 'deadline'] as const)(
    'drains accepted transport I/O after %s cancellation',
    async (kind) => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
      const controller = new AbortController();
      let drained = false;
      const exchange = jest.fn(
        (_input: BalanceJsonRpcRequest, signal: AbortSignal) =>
          new Promise<BoundedBalanceJsonRpcResponse>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                setTimeout(() => {
                  drained = true;
                  reject(new Error('private transport abort'));
                }, 10);
              },
              { once: true },
            );
          }),
      );
      const reader = new AaveV3EthereumPositionRpcTranscriptSource(BINDING, {
        exchangeBounded: exchange,
      });
      let settled = false;
      const pending = reader
        .readTranscript(request({ signal: controller.signal }))
        .catch((error: unknown) => {
          settled = true;
          throw error;
        });
      const checked = expect(pending).rejects.toMatchObject(FAILURE);
      if (kind === 'caller') controller.abort();
      else await jest.advanceTimersByTimeAsync(25_000);
      expect(settled).toBe(false);
      expect(drained).toBe(false);
      await jest.advanceTimersByTimeAsync(10);
      await checked;
      expect(drained).toBe(true);
      expect(exchange).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('captures the transport method and configures real HTTPS without import-time I/O', async () => {
    const rpc = new RpcFixture();
    const reader = new AaveV3EthereumPositionRpcTranscriptSource(BINDING, rpc);
    rpc.exchangeBounded = async () => {
      throw new Error('replacement must not execute');
    };
    await reader.readTranscript(request());
    const exchange = jest.spyOn(NodeHttpsBalanceJsonRpcTransport.prototype, 'exchangeBounded');
    createAaveV3EthereumPositionRpcTranscriptSource(BINDING, {
      networkId: 'eip155:1',
      hostname: 'rpc.vendor.dev',
      path: '/rpc',
      credential: { kind: 'NONE' },
    });
    expect(exchange).not.toHaveBeenCalled();
    expect(() =>
      createAaveV3EthereumPositionRpcTranscriptSource(BINDING, {
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        hostname: 'rpc.vendor.dev',
        path: '/rpc',
        credential: { kind: 'NONE' },
      }),
    ).toThrow();
  });
});
