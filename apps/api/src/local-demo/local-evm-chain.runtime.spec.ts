import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { EvmBalanceReadFailure } from '../blockchain/application/ports/evm-stablecoin-balance-indexer.ports';
import {
  normalizeEvmAddress,
  normalizeEvmBlockHash,
  normalizeEvmBlockNumber,
} from '../blockchain/domain/evm-stablecoin-position';
import { LOCAL_EVM_DEVELOPMENT_MANIFEST } from '../blockchain/domain/local-evm-development';
import {
  LocalEvmDevelopmentRuntimeError,
  LoopbackLocalEvmChainRuntime,
} from './local-evm-chain.runtime';
import type { LocalDemoRuntimeConfig } from './local-demo-runtime.config';

const CONTROL_URL = 'http://127.0.0.1:18546/control';
const CONTROL_DOMAIN = 'crypto-lending:local-evm-control:v2';
const CONTROL_LAUNCH_ID = '0123456789abcdef0123456789abcdef';
const CONTROL_CAPABILITY = '1111111111111111111111111111111111111111111111111111111111111111';
const NODE_INSTANCE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NODE_INSTANCE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WALLET_ADDRESS = normalizeEvmAddress('0x1111111111111111111111111111111111111111');
const CONTRACT_ADDRESS = normalizeEvmAddress(
  LOCAL_EVM_DEVELOPMENT_MANIFEST.assets[0]?.contractAddress,
);
const BLOCK_HASH = normalizeEvmBlockHash(`0x${'ab'.repeat(32)}`);
const PARENT_HASH = normalizeEvmBlockHash(`0x${'01'.repeat(32)}`);

const enabled: LocalDemoRuntimeConfig = Object.freeze({
  mode: 'enabled',
  apiHost: '127.0.0.1',
  publicOrigin: 'http://127.0.0.1:3000',
  localEvmRpcUrl: 'http://127.0.0.1:18545',
  localEvmControl: Object.freeze({
    url: CONTROL_URL,
    launchId: CONTROL_LAUNCH_ID,
    capability: CONTROL_CAPABILITY,
  }),
});

function mockFetch(): jest.MockedFunction<typeof fetch> {
  return jest.fn() as jest.MockedFunction<typeof fetch>;
}

function responseAt(url: string, body: unknown): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  Object.defineProperty(response, 'url', { configurable: true, value: url });
  return response;
}

function rpcResponse(id: number, result: unknown, extra: Record<string, unknown> = {}): Response {
  return responseAt(`${LOCAL_EVM_DEVELOPMENT_MANIFEST.rpc.url}/`, {
    jsonrpc: '2.0',
    id,
    result,
    ...extra,
  });
}

function controlProof(message: readonly unknown[]): string {
  return createHmac('sha256', Buffer.from(CONTROL_CAPABILITY, 'hex'))
    .update(JSON.stringify(message), 'utf8')
    .digest('hex');
}

function controlResponse(
  request: Record<string, unknown>,
  nodeInstanceId: string = NODE_INSTANCE_A,
  proof?: string,
): Response {
  const result = { nodeInstanceId };
  const status = 'RUNNING';
  return responseAt(CONTROL_URL, {
    schemaVersion: 2,
    runtimeIdentity: LOCAL_EVM_DEVELOPMENT_MANIFEST.runtimeIdentity,
    launchId: request.launchId,
    nonce: request.nonce,
    action: request.action,
    status,
    result,
    proof:
      proof ??
      controlProof([
        CONTROL_DOMAIN,
        'response',
        request.launchId,
        request.nonce,
        request.action,
        status,
        result,
      ]),
  });
}

function pinnedBalanceRequest(): Parameters<LoopbackLocalEvmChainRuntime['readTokenBalances']>[0] {
  return {
    expectedNetworkId: LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId,
    walletAddress: WALLET_ADDRESS,
    contractAddresses: Object.freeze([CONTRACT_ADDRESS]),
    sourceBlock: Object.freeze({
      number: normalizeEvmBlockNumber('1'),
      hash: BLOCK_HASH,
      parentHash: PARENT_HASH,
      selector: 'latest' as const,
    }),
  };
}

function pinnedBlock(hash: string = BLOCK_HASH): Readonly<{
  number: string;
  hash: string;
  parentHash: string;
  transactions: readonly unknown[];
}> {
  return {
    number: '0x1',
    hash,
    parentHash: PARENT_HASH,
    transactions: [],
  };
}

describe('LoopbackLocalEvmChainRuntime', () => {
  it('reads only the fixed loopback identity and normalizes an exact block', async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(rpcResponse(1, '0x7a69'))
      .mockResolvedValueOnce(
        rpcResponse(2, {
          number: '0x0',
          hash: `0x${'ab'.repeat(32)}`,
          parentHash: `0x${'00'.repeat(32)}`,
          transactions: [],
        }),
      );
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(runtime.readChainIdentity({ expectedNetworkId: 'eip155:31337' })).resolves.toBe(
      '0x7a69',
    );
    await expect(
      runtime.readSourceBlock({ expectedNetworkId: 'eip155:31337', selector: 'latest' }),
    ).resolves.toEqual({
      number: '0',
      hash: `0x${'ab'.repeat(32)}`,
      parentHash: `0x${'00'.repeat(32)}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url === 'http://127.0.0.1:18545')).toBe(true);
  });

  it('rejects an RPC envelope with any extra field', async () => {
    const fetchMock = mockFetch().mockResolvedValueOnce(
      rpcResponse(1, '0x7a69', {
        unexpected: true,
      }),
    );
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);
    await expect(
      runtime.readChainIdentity({ expectedNetworkId: 'eip155:31337' }),
    ).rejects.toBeInstanceOf(EvmBalanceReadFailure);
  });

  it('rejects disabled or drifted configuration before performing I/O', async () => {
    const fetchMock = mockFetch();
    const disabled = new LoopbackLocalEvmChainRuntime({ mode: 'disabled' }, fetchMock);
    await expect(
      disabled.readChainIdentity({ expectedNetworkId: 'eip155:31337' }),
    ).rejects.toMatchObject({ code: 'PERMANENT_FAILURE' });
    expect(fetchMock).not.toHaveBeenCalled();

    const drifted = new LoopbackLocalEvmChainRuntime(
      {
        ...enabled,
        localEvmRpcUrl: 'http://localhost:18545',
      } as unknown as LocalDemoRuntimeConfig,
      fetchMock,
    );
    await expect(
      drifted.readChainIdentity({ expectedNetworkId: 'eip155:31337' }),
    ).rejects.toMatchObject({ code: 'PERMANENT_FAILURE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('authenticates STATUS and returns the exact node generation', async () => {
    const fetchMock = mockFetch().mockImplementationOnce(async (url, init) => {
      expect(url).toBe(CONTROL_URL);
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(request).toMatchObject({
        schemaVersion: 2,
        action: 'STATUS',
        payload: null,
      });
      return controlResponse(request);
    });
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(runtime.readNodeInstanceId()).resolves.toBe(NODE_INSTANCE_A);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an authenticated STATUS result with any extra field', async () => {
    const fetchMock = mockFetch().mockImplementationOnce(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const result = { nodeInstanceId: NODE_INSTANCE_A, unexpected: true };
      return responseAt(CONTROL_URL, {
        schemaVersion: 2,
        runtimeIdentity: LOCAL_EVM_DEVELOPMENT_MANIFEST.runtimeIdentity,
        launchId: request.launchId,
        nonce: request.nonce,
        action: request.action,
        status: 'RUNNING',
        result,
        proof: controlProof([
          CONTROL_DOMAIN,
          'response',
          request.launchId,
          request.nonce,
          request.action,
          'RUNNING',
          result,
        ]),
      });
    });
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(runtime.readNodeInstanceId()).rejects.toBeInstanceOf(
      LocalEvmDevelopmentRuntimeError,
    );
  });

  it('brackets SET_BALANCES with authenticated STATUS requests for the same node generation', async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchMock = mockFetch().mockImplementation(async (url, init) => {
      expect(url).toBe(CONTROL_URL);
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      expect(Object.keys(request)).toEqual([
        'schemaVersion',
        'runtimeIdentity',
        'launchId',
        'nonce',
        'action',
        'payload',
        'proof',
      ]);
      expect(request).toMatchObject({
        schemaVersion: 2,
        runtimeIdentity: LOCAL_EVM_DEVELOPMENT_MANIFEST.runtimeIdentity,
        launchId: CONTROL_LAUNCH_ID,
        nonce: expect.stringMatching(/^[0-9a-f]{32}$/u),
        proof: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      expect(request.proof).toBe(
        controlProof([
          CONTROL_DOMAIN,
          'request',
          request.launchId,
          request.nonce,
          request.action,
          request.payload,
        ]),
      );
      return controlResponse(request);
    });
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(
      runtime.seedWalletBalances([
        {
          walletAddress: '0x1111111111111111111111111111111111111111',
          balanceAtomic: '123456789',
        },
      ]),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requests.map(({ action }) => action)).toEqual(['STATUS', 'SET_BALANCES', 'STATUS']);
    expect(requests.map(({ payload }) => payload)).toEqual([
      null,
      [
        {
          walletAddress: WALLET_ADDRESS,
          balanceAtomic: '123456789',
        },
      ],
      null,
    ]);
  });

  it('refuses an unowned control response with an invalid proof', async () => {
    const fetchMock = mockFetch().mockImplementationOnce(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return controlResponse(request, NODE_INSTANCE_A, '00'.repeat(32));
    });
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(
      runtime.seedWalletBalances([
        {
          walletAddress: WALLET_ADDRESS,
          balanceAtomic: '1',
        },
      ]),
    ).rejects.toBeInstanceOf(LocalEvmDevelopmentRuntimeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(CONTROL_URL);
  });

  it('fails closed when the node generation changes after SET_BALANCES', async () => {
    let requestCount = 0;
    const fetchMock = mockFetch().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestCount += 1;
      return controlResponse(request, requestCount === 3 ? NODE_INSTANCE_B : NODE_INSTANCE_A);
    });
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(
      runtime.seedWalletBalances([{ walletAddress: WALLET_ADDRESS, balanceAtomic: '1' }]),
    ).rejects.toBeInstanceOf(LocalEvmDevelopmentRuntimeError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('pins contract code around every call and rechecks the exact source block afterward', async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(rpcResponse(1, pinnedBlock()))
      .mockResolvedValueOnce(
        rpcResponse(2, LOCAL_EVM_DEVELOPMENT_MANIFEST.mockStablecoinRuntimeBytecode),
      )
      .mockResolvedValueOnce(rpcResponse(3, `0x${123n.toString(16).padStart(64, '0')}`))
      .mockResolvedValueOnce(
        rpcResponse(4, LOCAL_EVM_DEVELOPMENT_MANIFEST.mockStablecoinRuntimeBytecode),
      )
      .mockResolvedValueOnce(rpcResponse(5, pinnedBlock()));
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(runtime.readTokenBalances(pinnedBalanceRequest())).resolves.toEqual({
      sourceBlockNumber: '1',
      sourceBlockHash: BLOCK_HASH,
      balances: [{ contractAddress: CONTRACT_ADDRESS, balanceAtomic: '123' }],
    });
    const calls = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)) as { method: string; params: unknown[] },
    );
    expect(calls.map(({ method }) => method)).toEqual([
      'eth_getBlockByNumber',
      'eth_getCode',
      'eth_call',
      'eth_getCode',
      'eth_getBlockByNumber',
    ]);
    expect(calls[1]?.params).toEqual([CONTRACT_ADDRESS, '0x1']);
    expect(calls[2]?.params[1]).toBe('0x1');
    expect(calls[3]?.params).toEqual([CONTRACT_ADDRESS, '0x1']);
    expect(calls[4]?.params).toEqual(['0x1', false]);
  });

  it('fails closed when pinned contract code changes after the balance call', async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(rpcResponse(1, pinnedBlock()))
      .mockResolvedValueOnce(
        rpcResponse(2, LOCAL_EVM_DEVELOPMENT_MANIFEST.mockStablecoinRuntimeBytecode),
      )
      .mockResolvedValueOnce(rpcResponse(3, `0x${123n.toString(16).padStart(64, '0')}`))
      .mockResolvedValueOnce(rpcResponse(4, '0x00'));
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(runtime.readTokenBalances(pinnedBalanceRequest())).rejects.toMatchObject({
      code: 'PERMANENT_FAILURE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('fails closed when the pinned block tuple drifts after balance reads', async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(rpcResponse(1, pinnedBlock()))
      .mockResolvedValueOnce(
        rpcResponse(2, LOCAL_EVM_DEVELOPMENT_MANIFEST.mockStablecoinRuntimeBytecode),
      )
      .mockResolvedValueOnce(rpcResponse(3, `0x${123n.toString(16).padStart(64, '0')}`))
      .mockResolvedValueOnce(
        rpcResponse(4, LOCAL_EVM_DEVELOPMENT_MANIFEST.mockStablecoinRuntimeBytecode),
      )
      .mockResolvedValueOnce(rpcResponse(5, pinnedBlock(`0x${'cd'.repeat(32)}`)));
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);

    await expect(runtime.readTokenBalances(pinnedBalanceRequest())).rejects.toMatchObject({
      code: 'PERMANENT_FAILURE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('validates seed records without invoking accessors or contacting control', async () => {
    const fetchMock = mockFetch();
    const runtime = new LoopbackLocalEvmChainRuntime(enabled, fetchMock);
    const getter = jest.fn(() => '0x1111111111111111111111111111111111111111');
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(hostile, {
      walletAddress: { enumerable: true, get: getter },
      balanceAtomic: { enumerable: true, value: '1' },
      [Symbol('hostile')]: { enumerable: true, get: getter },
    });

    await expect(runtime.seedWalletBalances([hostile as never])).rejects.toBeInstanceOf(
      LocalEvmDevelopmentRuntimeError,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
