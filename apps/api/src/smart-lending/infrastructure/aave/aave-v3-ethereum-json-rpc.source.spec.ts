import type { ReadAaveV3EthereumFinalizedRpcObservationRequest } from './aave-v3-ethereum-finalized-rpc.source';
import {
  AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN,
  AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
} from './aave-v3-ethereum-finalized-rpc.plan';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from './aave-v3-ethereum-deployment.manifest';
import {
  AaveV3EthereumJsonRpcSourceUnavailableError,
  FixedAaveV3EthereumJsonRpcSource,
} from './aave-v3-ethereum-json-rpc.source';
import { AaveV3EthereumDeploymentEvidenceAdapter } from './aave-v3-ethereum-deployment-evidence.adapter';

const ENDPOINT = 'https://rpc.example.com/';
const OTHER_ENDPOINT = 'https://other-rpc.example.com/';
const SOURCE_REFERENCE_ID = 'rpc-primary:ethereum-mainnet';
const CORRELATION_ID = '550e8400-e29b-41d4-a716-446655440000';
const BLOCK_HASH = `0x${'11'.repeat(32)}`;
const PARENT_HASH = `0x${'22'.repeat(32)}`;
const STATE_ROOT = `0x${'33'.repeat(32)}`;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

interface JsonRpcRequest {
  readonly jsonrpc: string;
  readonly id: number;
  readonly method: string;
  readonly params: readonly unknown[];
}

interface CapturedFetch {
  readonly input: string | URL | Request;
  readonly init: RequestInit;
  readonly request: JsonRpcRequest;
}

interface ResponseOptions {
  readonly status?: number;
  readonly contentType?: string | null;
  readonly contentLength?: string;
  readonly url?: string;
  readonly redirected?: boolean;
}

type RpcHandler = (request: JsonRpcRequest, callIndex: number) => Response | Promise<Response>;

const BLOCK_HEADER = Object.freeze({
  number: '0x1312d00',
  hash: BLOCK_HASH,
  parentHash: PARENT_HASH,
  stateRoot: STATE_ROOT,
  timestamp: '0x65000000',
});

const RAW_BLOCK = Object.freeze({
  ...BLOCK_HEADER,
  baseFeePerGas: '0x1',
  gasLimit: '0x1c9c380',
  transactions: Object.freeze([]),
});

function addressWord(value: string): string {
  return `0x${'0'.repeat(24)}${value.slice(2).toLowerCase()}`;
}

function reserveTuple(aToken: string, variableDebtToken: string): string {
  return `0x${addressWord(aToken).slice(2)}${addressWord(ZERO_ADDRESS).slice(2)}${addressWord(variableDebtToken).slice(2)}`;
}

function resultFor(request: JsonRpcRequest): unknown {
  const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;
  const byId: Readonly<Record<number, unknown>> = {
    1: '0x1',
    2: RAW_BLOCK,
    3: '0x6003',
    4: '0x6004',
    5: '0x6005',
    6: '0x6006',
    7: '0x6007',
    8: '0x6008',
    9: '0x6009',
    10: '0x600a',
    11: addressWord(manifest.contracts.poolProxy),
    12: addressWord(manifest.contracts.protocolDataProvider),
    13: addressWord(manifest.contracts.poolAddressesProvider),
    14: addressWord(manifest.contracts.poolAddressesProvider),
    15: addressWord(manifest.contracts.poolProxy),
    16: addressWord(manifest.contracts.poolImplementation),
    17: reserveTuple(manifest.assets.USDC.aToken, manifest.assets.USDC.variableDebtToken),
    18: reserveTuple(manifest.assets.USDT.aToken, manifest.assets.USDT.variableDebtToken),
    19: RAW_BLOCK,
  };
  const result = byId[request.id];
  if (result === undefined) throw new Error(`Unexpected synthetic RPC id ${request.id}`);
  return result;
}

function responseWithBody(body: string, options: ResponseOptions = {}): Response {
  const headers = new Headers();
  if (options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/json; charset=utf-8');
  }
  if (options.contentLength !== undefined) {
    headers.set('content-length', options.contentLength);
  }
  const response = new Response(body, { status: options.status ?? 200, headers });
  Object.defineProperty(response, 'url', { value: options.url ?? ENDPOINT });
  Object.defineProperty(response, 'redirected', { value: options.redirected ?? false });
  return response;
}

function responseFor(
  request: JsonRpcRequest,
  result: unknown = resultFor(request),
  options: ResponseOptions = {},
): Response {
  return responseWithBody(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), options);
}

function responseEnvelope(value: unknown, options: ResponseOptions = {}): Response {
  return responseWithBody(JSON.stringify(value), options);
}

function responseWithBytes(body: BodyInit | null, options: ResponseOptions = {}): Response {
  const response = new Response(body, {
    status: options.status ?? 200,
    ...(options.contentType === null
      ? {}
      : { headers: { 'content-type': options.contentType ?? 'application/json' } }),
  });
  Object.defineProperty(response, 'url', { value: options.url ?? ENDPOINT });
  Object.defineProperty(response, 'redirected', { value: options.redirected ?? false });
  return response;
}

function paddedResponse(request: JsonRpcRequest, result: unknown, totalBytes: number): Response {
  const serialized = JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
  if (serialized.length > totalBytes) throw new Error('Synthetic response budget is too small');
  return responseWithBody(serialized + ' '.repeat(totalBytes - serialized.length));
}

function fetchHarness(handler: RpcHandler = (request) => responseFor(request)): {
  readonly captured: CapturedFetch[];
  readonly fetchImplementation: typeof fetch;
  readonly mock: jest.Mock;
} {
  const captured: CapturedFetch[] = [];
  const mock = jest.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init === undefined || typeof init.body !== 'string') {
        throw new Error('Synthetic fetch received no JSON body');
      }
      const request = JSON.parse(init.body) as JsonRpcRequest;
      captured.push({ input, init, request });
      return handler(request, captured.length - 1);
    },
  );
  return { captured, fetchImplementation: mock as unknown as typeof fetch, mock };
}

function source(fetchImplementation: typeof fetch): FixedAaveV3EthereumJsonRpcSource {
  return new FixedAaveV3EthereumJsonRpcSource(
    { endpoint: ENDPOINT, sourceReferenceId: SOURCE_REFERENCE_ID },
    fetchImplementation,
  );
}

function validRequest(
  overrides: Partial<ReadAaveV3EthereumFinalizedRpcObservationRequest> = {},
): ReadAaveV3EthereumFinalizedRpcObservationRequest {
  return {
    correlationId: CORRELATION_ID,
    deadlineAt: new Date(Date.now() + 4_000).toISOString(),
    signal: new AbortController().signal,
    plan: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN,
    ...overrides,
  };
}

async function unavailable(
  candidate: FixedAaveV3EthereumJsonRpcSource,
  request: ReadAaveV3EthereumFinalizedRpcObservationRequest = validRequest(),
): Promise<AaveV3EthereumJsonRpcSourceUnavailableError> {
  let captured: unknown;
  try {
    await candidate.readFinalizedDeployment(request);
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(AaveV3EthereumJsonRpcSourceUnavailableError);
  expect(captured).toMatchObject({
    code: 'AAVE_V3_ETHEREUM_JSON_RPC_SOURCE_UNAVAILABLE',
    message: 'Aave V3 Ethereum JSON-RPC source is unavailable',
  });
  expect(captured).not.toHaveProperty('cause');
  return captured as AaveV3EthereumJsonRpcSourceUnavailableError;
}

async function waitForCallCount(captured: readonly CapturedFetch[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (captured.length === count) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${count} synthetic RPC calls`);
}

describe('FixedAaveV3EthereumJsonRpcSource', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('executes and maps the exact serial 19-call canonical-block transcript', async () => {
    const harness = fetchHarness();
    const observation = (await source(harness.fetchImplementation).readFinalizedDeployment(
      validRequest(),
    )) as Record<string, unknown>;

    expect(harness.captured).toHaveLength(19);
    expect(harness.captured.map(({ request }) => request.id)).toEqual(
      Array.from({ length: 19 }, (_unused, index) => index + 1),
    );
    expect(harness.captured[0]?.request).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_chainId',
      params: [],
    });
    expect(harness.captured[1]?.request).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_getBlockByNumber',
      params: ['finalized', false],
    });

    const blockParameter = { blockHash: BLOCK_HASH, requireCanonical: true };
    for (const [
      index,
      operation,
    ] of AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.operations.entries()) {
      const request = harness.captured[index + 2]?.request;
      const expectedParams =
        operation.method === 'eth_getCode'
          ? [operation.target, blockParameter]
          : [
              {
                to: operation.target,
                data: operation.calldata,
                ...(operation.from === undefined ? {} : { from: operation.from }),
              },
              blockParameter,
            ];
      expect(request).toEqual({
        jsonrpc: '2.0',
        id: index + 3,
        method: operation.method,
        params: expectedParams,
      });
    }
    expect(harness.captured[18]?.request).toEqual({
      jsonrpc: '2.0',
      id: 19,
      method: 'eth_getBlockByNumber',
      params: [BLOCK_HEADER.number, false],
    });

    const adminCall = harness.captured[15]?.request.params[0] as Record<string, unknown>;
    expect(adminCall).toEqual({
      to: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.contracts.poolProxy,
      data: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.selectors.implementation,
      from: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.contracts.poolAddressesProvider,
    });
    for (const request of harness.captured.slice(10, 18).map(({ request }) => request)) {
      if (request.id !== 16) expect(request.params[0]).not.toHaveProperty('from');
    }
    expect((harness.captured[16]?.request.params[0] as Record<string, unknown>).data).toBe(
      `${AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.selectors.getReserveTokensAddresses}${'0'.repeat(24)}${AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.underlyingAsset.slice(2)}`,
    );
    expect((harness.captured[17]?.request.params[0] as Record<string, unknown>).data).toBe(
      `${AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.selectors.getReserveTokensAddresses}${'0'.repeat(24)}${AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDT.underlyingAsset.slice(2)}`,
    );

    const signals = new Set<AbortSignal>();
    for (const captured of harness.captured) {
      expect(captured.input).toBe(ENDPOINT);
      expect(captured.init).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const headers = new Headers(captured.init.headers);
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('content-type')).toBe('application/json');
      expect(captured.init.signal).toBeInstanceOf(AbortSignal);
      signals.add(captured.init.signal as AbortSignal);
    }
    expect(signals.size).toBe(1);

    expect(observation).toMatchObject({
      schemaVersion: 1,
      sourceReferenceId: SOURCE_REFERENCE_ID,
      networkId: 'eip155:1',
      chainId: '0x1',
      blockSelector: 'finalized',
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      manifestFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.manifestFingerprintSha256,
      assetRegistryFingerprintSha256:
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.assetRegistryFingerprintSha256,
      readPlanFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
      finalizedBlockBefore: BLOCK_HEADER,
      finalizedBlockAfter: BLOCK_HEADER,
      code: {
        poolAddressesProvider: '0x6003',
        poolProxy: '0x6004',
        poolImplementation: '0x6005',
        protocolDataProvider: '0x6006',
        usdcAToken: '0x6007',
        usdcVariableDebtToken: '0x6008',
        usdtAToken: '0x6009',
        usdtVariableDebtToken: '0x600a',
      },
      calls: {
        providerGetPool: resultFor({ id: 11 } as JsonRpcRequest),
        providerGetPoolDataProvider: resultFor({ id: 12 } as JsonRpcRequest),
        poolAddressesProvider: resultFor({ id: 13 } as JsonRpcRequest),
        dataProviderAddressesProvider: resultFor({ id: 14 } as JsonRpcRequest),
        dataProviderPool: resultFor({ id: 15 } as JsonRpcRequest),
        poolImplementationFromAdmin: resultFor({ id: 16 } as JsonRpcRequest),
        usdcReserveTokens: resultFor({ id: 17 } as JsonRpcRequest),
        usdtReserveTokens: resultFor({ id: 18 } as JsonRpcRequest),
      },
    });
    expect(observation.sourceObservationId).toMatch(/^rpc-observation:[0-9a-f]{64}$/u);
    expect(Object.keys(observation.finalizedBlockBefore as Record<string, unknown>)).toEqual([
      'number',
      'hash',
      'parentHash',
      'stateRoot',
      'timestamp',
    ]);
    expect(observation.operationBlockBindings).toEqual(
      Object.fromEntries(
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.operations.map(({ operationId }) => [
          operationId,
          blockParameter,
        ]),
      ),
    );
  });

  it('produces a bundle accepted only as corroboration by the deployment adapter', async () => {
    const harness = fetchHarness();
    const adapter = new AaveV3EthereumDeploymentEvidenceAdapter(
      source(harness.fetchImplementation),
    );

    const evidence = await adapter.readCurrentDeploymentEvidence({
      evaluatedAt: new Date().toISOString(),
      correlationId: CORRELATION_ID,
    });

    expect(harness.captured).toHaveLength(19);
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC',
      sourceReferenceId: SOURCE_REFERENCE_ID,
      networkId: 'eip155:1',
      blockSelector: 'finalized',
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
    });
  });

  it.each([
    'http://rpc.example.com/',
    ['https://user', 'secret@rpc.example.com/'].join(':'),
    'https://rpc.example.com:444/',
    'https://rpc.example.com/?apiKey=secret',
    'https://rpc.example.com/#fragment',
    'https://127.0.0.1/',
    'https://169.254.169.254/',
    'https://[::1]/',
    'https://localhost/',
    'https://rpc.service.internal/',
    'https://rpc.example.invalid/',
  ])('rejects unsafe endpoint configuration before construction completes: %s', (endpoint) => {
    const harness = fetchHarness();

    expect(
      () =>
        new FixedAaveV3EthereumJsonRpcSource(
          { endpoint, sourceReferenceId: SOURCE_REFERENCE_ID },
          harness.fetchImplementation,
        ),
    ).toThrow(AaveV3EthereumJsonRpcSourceUnavailableError);
    expect(harness.mock).not.toHaveBeenCalled();
  });

  it('rejects a noncanonical plan before any HTTP I/O', async () => {
    const harness = fetchHarness();
    const clonedPlan = { ...AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN };

    await unavailable(
      source(harness.fetchImplementation),
      validRequest({
        plan: clonedPlan as typeof AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN,
      }),
    );

    expect(harness.mock).not.toHaveBeenCalled();
  });

  it('stops after a chain mismatch and after the first failed serial operation', async () => {
    const wrongChain = fetchHarness((request) => responseFor(request, '0x2'));
    await unavailable(source(wrongChain.fetchImplementation));
    expect(wrongChain.captured.map(({ request }) => request.id)).toEqual([1]);

    const failedOperation = fetchHarness((request) =>
      request.id === 5
        ? responseEnvelope({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32_000, message: 'private upstream detail' },
          })
        : responseFor(request),
    );
    await unavailable(source(failedOperation.fetchImplementation));
    expect(failedOperation.captured.map(({ request }) => request.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not issue the captured-number recheck until every state read completes', async () => {
    let releaseLastStateRead: ((response: Response) => void) | undefined;
    const heldStateRead = new Promise<Response>((resolve) => {
      releaseLastStateRead = resolve;
    });
    const harness = fetchHarness((request) =>
      request.id === 18 ? heldStateRead : responseFor(request),
    );

    const pending = source(harness.fetchImplementation).readFinalizedDeployment(validRequest());
    await waitForCallCount(harness.captured, 18);
    expect(harness.captured.map(({ request }) => request.id)).toEqual(
      Array.from({ length: 18 }, (_unused, index) => index + 1),
    );
    expect(harness.captured.some(({ request }) => request.id === 19)).toBe(false);

    releaseLastStateRead?.(responseFor(harness.captured[17]!.request));
    await pending;
    expect(harness.captured.at(-1)?.request).toEqual({
      jsonrpc: '2.0',
      id: 19,
      method: 'eth_getBlockByNumber',
      params: [BLOCK_HEADER.number, false],
    });
  });

  it.each([
    ['non-200 status', (request: JsonRpcRequest) => responseFor(request, '0x1', { status: 503 })],
    [
      'missing content type',
      (request: JsonRpcRequest) => responseFor(request, '0x1', { contentType: null }),
    ],
    [
      'non-JSON content type',
      (request: JsonRpcRequest) => responseFor(request, '0x1', { contentType: 'text/plain' }),
    ],
    [
      'redirected response',
      (request: JsonRpcRequest) => responseFor(request, '0x1', { redirected: true }),
    ],
    ['empty response URL', (request: JsonRpcRequest) => responseFor(request, '0x1', { url: '' })],
    [
      'changed response URL',
      (request: JsonRpcRequest) => responseFor(request, '0x1', { url: OTHER_ENDPOINT }),
    ],
    [
      'wrong response ID',
      (request: JsonRpcRequest) =>
        responseEnvelope({ jsonrpc: '2.0', id: request.id + 1, result: '0x1' }),
    ],
    [
      'JSON-RPC error envelope',
      (request: JsonRpcRequest) =>
        responseEnvelope({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32_000, message: 'sensitive provider detail' },
        }),
    ],
    [
      'extra envelope field',
      (request: JsonRpcRequest) =>
        responseEnvelope({ jsonrpc: '2.0', id: request.id, result: '0x1', extra: true }),
    ],
    ['malformed JSON', () => responseWithBody('{')],
    ['invalid UTF-8', () => responseWithBytes(new Uint8Array([0xff]))],
    ['null response body', () => responseWithBytes(null)],
    [
      'malformed content length',
      (request: JsonRpcRequest) => responseFor(request, '0x1', { contentLength: '01' }),
    ],
  ])('rejects %s with a strict sanitized transport envelope', async (_name, factory) => {
    const harness = fetchHarness((request) => factory(request));
    await unavailable(source(harness.fetchImplementation));
    expect(harness.captured.map(({ request }) => request.id)).toEqual([1]);
  });

  it('enforces declared and streamed aggregate response-byte limits', async () => {
    const maximum = AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.maximumAggregateResponseBytes;
    const declared = fetchHarness((request) =>
      responseFor(request, '0x1', { contentLength: String(maximum + 1) }),
    );
    await unavailable(source(declared.fetchImplementation));
    expect(declared.captured.map(({ request }) => request.id)).toEqual([1]);

    const firstBytes = 600_000;
    const secondBytes = maximum - firstBytes + 1;
    const streamed = fetchHarness((request) => {
      if (request.id === 1) return paddedResponse(request, '0x1', firstBytes);
      if (request.id === 2) return paddedResponse(request, RAW_BLOCK, secondBytes);
      return responseFor(request);
    });
    await unavailable(source(streamed.fetchImplementation));
    expect(streamed.captured.map(({ request }) => request.id)).toEqual([1, 2]);
  });

  it('accepts a valid transcript whose aggregate body bytes equal the exact limit', async () => {
    const maximum = AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.maximumAggregateResponseBytes;
    const laterResponseBytes = Array.from({ length: 18 }, (_unused, index) => index + 2).reduce(
      (total, id) => {
        const request = { id } as JsonRpcRequest;
        return (
          total +
          new TextEncoder().encode(
            JSON.stringify({ jsonrpc: '2.0', id, result: resultFor(request) }),
          ).byteLength
        );
      },
      0,
    );
    const harness = fetchHarness((request) =>
      request.id === 1
        ? paddedResponse(request, '0x1', maximum - laterResponseBytes)
        : responseFor(request),
    );

    await expect(
      source(harness.fetchImplementation).readFinalizedDeployment(validRequest()),
    ).resolves.toMatchObject({ chainId: '0x1' });
    expect(harness.captured).toHaveLength(19);
  });

  it('rejects pre-aborted and closed-deadline requests without HTTP I/O', async () => {
    const harness = fetchHarness();
    const controller = new AbortController();
    controller.abort();

    await unavailable(
      source(harness.fetchImplementation),
      validRequest({ signal: controller.signal }),
    );
    await unavailable(
      source(harness.fetchImplementation),
      validRequest({ deadlineAt: new Date(Date.now()).toISOString() }),
    );
    expect(harness.mock).not.toHaveBeenCalled();
  });

  it('links a caller abort to an in-flight request', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const mock = jest.fn((_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    });
    const pending = source(mock as unknown as typeof fetch).readFinalizedDeployment(
      validRequest({ signal: controller.signal }),
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'AAVE_V3_ETHEREUM_JSON_RPC_SOURCE_UNAVAILABLE',
    });

    controller.abort();
    await rejection;
    expect(observedSignal?.aborted).toBe(true);
  });

  it('aborts a stalled connection at the two-second connection ceiling', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
    let observedSignal: AbortSignal | undefined;
    const mock = jest.fn((_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    });
    const candidate = source(mock as unknown as typeof fetch);
    const pending = candidate.readFinalizedDeployment(
      validRequest({ deadlineAt: '2026-09-04T12:00:05.000Z' }),
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'AAVE_V3_ETHEREUM_JSON_RPC_SOURCE_UNAVAILABLE',
      message: 'Aave V3 Ethereum JSON-RPC source is unavailable',
    });
    expect(observedSignal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1_999);
    expect(observedSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejection;
    expect(observedSignal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts a stalled response body at the shared absolute deadline', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
    let observedSignal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({ start: () => undefined });
    const mock = jest.fn((_input: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      const response = new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      Object.defineProperty(response, 'url', { value: ENDPOINT });
      return Promise.resolve(response);
    });
    const pending = source(mock as unknown as typeof fetch).readFinalizedDeployment(
      validRequest({ deadlineAt: '2026-09-04T12:00:05.000Z' }),
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'AAVE_V3_ETHEREUM_JSON_RPC_SOURCE_UNAVAILABLE',
      message: 'Aave V3 Ethereum JSON-RPC source is unavailable',
    });
    await jest.advanceTimersByTimeAsync(4_999);
    expect(observedSignal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await rejection;
    expect(observedSignal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sanitizes thrown provider details without logging raw RPC material', async () => {
    const providerDetail = 'https://rpc.example.invalid/private-api-key';
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock = jest.fn(() => Promise.reject(new Error(providerDetail)));

    const captured = await unavailable(source(mock as unknown as typeof fetch));

    expect(String(captured)).not.toContain('private-api-key');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
