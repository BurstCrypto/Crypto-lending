import * as dns from 'node:dns';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import * as https from 'node:https';
import * as tls from 'node:tls';
import type { TLSSocket } from 'node:tls';

import {
  BalanceJsonRpcTransportFailure,
  balanceRpcRequest,
  type BalanceJsonRpcRequest,
} from './balance-json-rpc';
import {
  NodeHttpsBalanceJsonRpcTransport,
  type NodeHttpsBalanceJsonRpcTransportConfig,
} from './node-https-balance-json-rpc.transport';

jest.mock('node:dns', () => ({
  NODATA: 'ENODATA',
  NOTFOUND: 'ENOTFOUND',
  Resolver: jest.fn(),
}));
jest.mock('node:https', () => ({ request: jest.fn() }));

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const PUBLIC_IPV4 = '8.8.8.8';
const PROVIDER_HOST = 'rpc.vendor.dev';
const IMPORT_RESOLVER_CALLS = (dns.Resolver as unknown as jest.Mock).mock.calls.length;
const IMPORT_HTTPS_CALLS = (https.request as unknown as jest.Mock).mock.calls.length;

interface HttpsCall {
  readonly options: Record<string, unknown>;
  readonly respond: (response: IncomingMessage) => void;
  readonly request: FakeRequest;
}

class FakeRequest extends EventEmitter {
  destroyed = false;
  closeOnDestroy = true;
  readonly destroy = jest.fn(() => {
    this.destroyed = true;
    if (this.closeOnDestroy) queueMicrotask(() => this.emit('close'));
  });
  readonly end = jest.fn();
}

type ResolverCallback = (error: NodeJS.ErrnoException | null, addresses: string[]) => void;

class FakeResolver {
  readonly cancel = jest.fn();
  readonly resolve4 = jest.fn((hostname: string, callback: ResolverCallback) => {
    resolverBehavior(this, 4, hostname, callback);
  });
  readonly resolve6 = jest.fn((hostname: string, callback: ResolverCallback) => {
    resolverBehavior(this, 6, hostname, callback);
  });

  constructor(readonly options: dns.ResolverOptions) {}
}

class FakeResponse extends EventEmitter {
  complete = true;
  destroyed = false;
  closeOnDestroy = true;
  httpVersion = '1.1';
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  rawTrailers: string[] = [];
  readonly destroy = jest.fn(() => {
    this.destroyed = true;
    if (this.closeOnDestroy) queueMicrotask(() => this.emit('close'));
  });

  constructor(
    readonly statusCode: number,
    readonly rawHeaders: string[],
  ) {
    super();
  }
}

class FakeTlsSocket extends EventEmitter {
  authorized = true;
  encrypted = true;
  remoteAddress: string | undefined = PUBLIC_IPV4;
  remoteFamily: string | number | undefined = 'IPv4';
  protocol: string | null = 'TLSv1.3';
  readonly destroy = jest.fn();
  readonly getProtocol = jest.fn(() => this.protocol);
}

const resolverConstructorMock = dns.Resolver as unknown as jest.Mock;
const requestMock = https.request as unknown as jest.Mock;
let httpsCalls: HttpsCall[];
let resolverInstances: FakeResolver[];
let resolverBehavior: (
  resolver: FakeResolver,
  family: 4 | 6,
  hostname: string,
  callback: ResolverCallback,
) => void;

function config(
  overrides: Partial<NodeHttpsBalanceJsonRpcTransportConfig> = {},
): NodeHttpsBalanceJsonRpcTransportConfig {
  return {
    networkId: ETHEREUM,
    hostname: PROVIDER_HOST,
    path: '/rpc',
    credential: { kind: 'NONE' },
    ...overrides,
  };
}

function rpc(method = 'eth_chainId', params: readonly unknown[] = []): BalanceJsonRpcRequest {
  return balanceRpcRequest(method, params);
}

function installLookup(
  addresses: readonly dns.LookupAddress[] = [{ address: PUBLIC_IPV4, family: 4 }],
): void {
  resolverBehavior = (_resolver, family, _hostname, callback) => {
    callback(
      null,
      addresses.filter((address) => address.family === family).map(({ address }) => address),
    );
  };
}

function holdLookup(): {
  resolve: (addresses?: readonly dns.LookupAddress[]) => void;
  reject: () => void;
} {
  let ipv4Callback: ResolverCallback | undefined;
  let ipv6Callback: ResolverCallback | undefined;
  resolverBehavior = (_resolver, family, _hostname, callback) => {
    if (family === 4) ipv4Callback = callback;
    else ipv6Callback = callback;
  };
  return {
    resolve: (addresses = [{ address: PUBLIC_IPV4, family: 4 }]) => {
      ipv4Callback?.(
        null,
        addresses.filter(({ family }) => family === 4).map(({ address }) => address),
      );
      ipv6Callback?.(
        null,
        addresses.filter(({ family }) => family === 6).map(({ address }) => address),
      );
    },
    reject: () =>
      ipv4Callback?.(Object.assign(new Error('private DNS detail'), { code: 'EAI_AGAIN' }), []),
  };
}

function socketFor(call: HttpsCall, overrides: Partial<FakeTlsSocket> = {}): FakeTlsSocket {
  const socket = Object.assign(new FakeTlsSocket(), overrides);
  call.request.emit('socket', socket as unknown as TLSSocket);
  return socket;
}

function secure(call: HttpsCall, overrides: Partial<FakeTlsSocket> = {}): FakeTlsSocket {
  const socket = socketFor(call, overrides);
  socket.emit('secureConnect');
  return socket;
}

function responseBody(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function jsonResponse(
  status: number,
  body: Buffer,
  extraHeaders: readonly string[] = [],
): FakeResponse {
  return new FakeResponse(status, [
    'Content-Type',
    'application/json; charset=utf-8',
    'Content-Length',
    String(body.length),
    ...extraHeaders,
  ]);
}

function chunkedJsonResponse(extraHeaders: readonly string[] = []): FakeResponse {
  return new FakeResponse(200, [
    'Content-Type',
    'application/json; charset=utf-8',
    'Transfer-Encoding',
    'chunked',
    ...extraHeaders,
  ]);
}

function deliver(call: HttpsCall, response: FakeResponse, chunks: readonly Uint8Array[]): void {
  call.respond(response as unknown as IncomingMessage);
  for (const chunk of chunks) response.emit('data', chunk);
  response.emit('end');
  response.emit('close');
}

async function expectFailure(
  promise: Promise<unknown>,
  code: 'TIMEOUT' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'PERMANENT',
  retryAfterSeconds?: number,
): Promise<void> {
  try {
    await promise;
    throw new Error('expected transport failure');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BalanceJsonRpcTransportFailure);
    expect(error).toMatchObject({
      code,
      message: code,
      retryAfterSeconds,
      name: 'BalanceJsonRpcTransportFailure',
    });
    expect(Object.isFrozen(error)).toBe(true);
  }
}

beforeEach(() => {
  jest.useRealTimers();
  resolverConstructorMock.mockReset();
  requestMock.mockReset();
  httpsCalls = [];
  resolverInstances = [];
  resolverBehavior = (_resolver, _family, _hostname, callback) => callback(null, []);
  resolverConstructorMock.mockImplementation((options: dns.ResolverOptions) => {
    const resolver = new FakeResolver(options);
    resolverInstances.push(resolver);
    return resolver;
  });
  requestMock.mockImplementation(
    (
      options: Record<string, unknown>,
      respond: (response: IncomingMessage) => void,
    ): ClientRequest => {
      const request = new FakeRequest();
      httpsCalls.push({ options, respond, request });
      return request as unknown as ClientRequest;
    },
  );
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Node HTTPS balance JSON-RPC transport response limits', () => {
  it('sequences DNS families and waits for both before opening HTTPS', async () => {
    let finishIpv4: ResolverCallback | undefined;
    let finishIpv6: ResolverCallback | undefined;
    resolverBehavior = (_resolver, family, _hostname, callback) => {
      if (family === 4) finishIpv4 = callback;
      else finishIpv6 = callback;
    };
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchangeBounded(
      rpc(),
      new AbortController().signal,
      64,
    );
    expect(finishIpv4).toBeDefined();
    expect(finishIpv6).toBeUndefined();
    expect(requestMock).not.toHaveBeenCalled();
    finishIpv4!(null, [PUBLIC_IPV4]);
    expect(finishIpv6).toBeDefined();
    expect(requestMock).not.toHaveBeenCalled();
    finishIpv6!(null, []);
    const call = httpsCalls[0]!;
    secure(call);
    const body = Buffer.from('{"result":"0x1"}');
    deliver(call, jsonResponse(200, body), [body]);
    call.request.emit('close');
    await expect(pending).resolves.toMatchObject({ value: { result: '0x1' } });
  });

  it.each(['content-length', 'chunked'] as const)(
    'retains exact body bytes for %s responses',
    async (framing) => {
      installLookup();
      const body = Buffer.from('  {"text":"é"} \n', 'utf8');
      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchangeBounded(
        rpc(),
        new AbortController().signal,
        body.length,
      );
      const call = httpsCalls[0]!;
      secure(call);
      deliver(call, framing === 'chunked' ? chunkedJsonResponse() : jsonResponse(200, body), [
        body,
      ]);
      call.request.emit('close');
      await expect(pending).resolves.toEqual({ value: { text: 'é' }, bodyBytes: body.length });
    },
  );

  it.each(['content-length', 'chunked'] as const)(
    'rejects a %s body above the caller limit before parsing',
    async (framing) => {
      installLookup();
      const body = Buffer.from(`{"x":"${'a'.repeat(100)}"}`);
      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchangeBounded(
        rpc(),
        new AbortController().signal,
        32,
      );
      const call = httpsCalls[0]!;
      secure(call);
      deliver(call, framing === 'chunked' ? chunkedJsonResponse() : jsonResponse(200, body), [
        body,
      ]);
      await expectFailure(pending, 'PERMANENT');
      expect(call.request.destroy).toHaveBeenCalled();
    },
  );

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 4 * 1024 * 1024 + 1])(
    'rejects invalid caller limit %s before DNS or HTTPS',
    async (limit) => {
      await expectFailure(
        new NodeHttpsBalanceJsonRpcTransport(config()).exchangeBounded(
          rpc(),
          new AbortController().signal,
          limit,
        ),
        'PERMANENT',
      );
      expect(resolverConstructorMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    },
  );
});

describe('Node HTTPS balance JSON-RPC transport', () => {
  it('performs no DNS, HTTPS, or timer work on import or construction', () => {
    expect(IMPORT_RESOLVER_CALLS).toBe(0);
    expect(IMPORT_HTTPS_CALLS).toBe(0);
    const timer = jest.spyOn(globalThis, 'setTimeout');

    const transport = new NodeHttpsBalanceJsonRpcTransport(config());

    expect(Object.isFrozen(transport)).toBe(true);
    expect(resolverConstructorMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
  });

  it('snapshots the exact endpoint and credential without retaining mutable config', async () => {
    installLookup();
    const mutable = {
      networkId: ETHEREUM,
      hostname: PROVIDER_HOST,
      path: '/rpc',
      credential: { kind: 'X_API_KEY_HEADER' as const, value: 'first-key' },
    };
    const transport = new NodeHttpsBalanceJsonRpcTransport(mutable);
    mutable.hostname = 'changed.vendor.dev';
    mutable.path = '/changed';
    mutable.credential.value = 'changed-key';

    const pending = transport.exchange(rpc(), new AbortController().signal);
    const call = httpsCalls[0];
    expect(call).toBeDefined();
    expect(call?.options).toMatchObject({ hostname: PROVIDER_HOST, path: '/rpc' });
    expect(call?.options.headers).toMatchObject({ 'x-api-key': 'first-key' });
    await expectFailureAfterAbort(pending, call);
  });

  it.each([
    [{ ...config(), extra: true }],
    [{ ...config(), networkId: 'eip155:10' }],
    [{ ...config(), hostname: 'RPC.vendor.dev' }],
    [{ ...config(), hostname: '127.0.0.1' }],
    [{ ...config(), hostname: 'rpc.example.com' }],
    [{ ...config(), path: '/rpc?secret=x' }],
    [{ ...config(), credential: { kind: 'NONE', value: 'extra' } }],
    [{ ...config(), credential: { kind: 'X_API_KEY_HEADER', value: 'bad\r\nheader' } }],
  ])('rejects a non-exact or unsafe configuration %#', (candidate) => {
    expect(
      () =>
        new NodeHttpsBalanceJsonRpcTransport(candidate as NodeHttpsBalanceJsonRpcTransportConfig),
    ).toThrow(new TypeError('invalid balance HTTPS transport configuration'));
  });

  it('rejects accessor-backed configuration without reading the accessor', () => {
    const read = jest.fn(() => PROVIDER_HOST);
    const candidate = config() as unknown as Record<string, unknown>;
    Object.defineProperty(candidate, 'hostname', { enumerable: true, get: read });

    expect(() => new NodeHttpsBalanceJsonRpcTransport(candidate as never)).toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['ethereum', config(), 'eth_chainId'],
    ['ethereum', config(), 'eth_getBlockByNumber'],
    ['ethereum', config(), 'eth_getCode'],
    ['ethereum', config(), 'eth_getStorageAt'],
    ['ethereum', config(), 'eth_call'],
    ['solana', config({ networkId: SOLANA }), 'getGenesisHash'],
    ['solana', config({ networkId: SOLANA }), 'getSlot'],
    ['solana', config({ networkId: SOLANA }), 'getBlock'],
    ['solana', config({ networkId: SOLANA }), 'getMultipleAccounts'],
    ['solana', config({ networkId: SOLANA }), 'getTokenAccountsByOwner'],
  ] as const)('admits the exact %s mainnet method %s', async (_chain, candidate, method) => {
    installLookup();
    const transport = new NodeHttpsBalanceJsonRpcTransport(candidate);

    const pending = transport.exchange(rpc(method), new AbortController().signal);

    expect(resolverConstructorMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
    await expectFailureAfterAbort(pending, httpsCalls[0]);
  });

  it.each([
    [config(), 'getSlot'],
    [config({ networkId: SOLANA }), 'eth_chainId'],
    [config(), 'web3_clientVersion'],
  ] as const)(
    'rejects a method outside its chain allowlist before DNS',
    async (candidate, method) => {
      const transport = new NodeHttpsBalanceJsonRpcTransport(candidate);

      const pending = transport.exchange(rpc(method), new AbortController().signal);

      await expectFailure(pending, 'PERMANENT');
      expect(resolverConstructorMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...rpc(), id: '0'.repeat(64) },
    { ...rpc(), jsonrpc: '1.0' },
    { ...rpc(), extra: true },
  ])('rejects a non-canonical request envelope before DNS %#', async (candidate) => {
    const transport = new NodeHttpsBalanceJsonRpcTransport(config());

    await expectFailure(
      transport.exchange(
        candidate as unknown as BalanceJsonRpcRequest,
        new AbortController().signal,
      ),
      'PERMANENT',
    );
    expect(resolverConstructorMock).not.toHaveBeenCalled();
  });

  it('rejects accessor-backed request data without evaluating it', async () => {
    const read = jest.fn(() => 'eth_chainId');
    const canonical = rpc();
    const candidate: Record<string, unknown> = {
      id: canonical.id,
      jsonrpc: canonical.jsonrpc,
      params: canonical.params,
    };
    Object.defineProperty(candidate, 'method', { enumerable: true, get: read });

    await expectFailure(
      new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
        candidate as unknown as BalanceJsonRpcRequest,
        new AbortController().signal,
      ),
      'PERMANENT',
    );
    expect(read).not.toHaveBeenCalled();
    expect(resolverConstructorMock).not.toHaveBeenCalled();
  });

  it('does zero DNS, request, or timer work for a genuinely pre-aborted signal', async () => {
    const controller = new AbortController();
    const privateRead = jest.fn(() => 'private abort detail');
    const reason = Object.create(null) as object;
    Object.defineProperty(reason, 'detail', { enumerable: true, get: privateRead });
    controller.abort(reason);
    const timer = jest.spyOn(globalThis, 'setTimeout');

    await expectFailure(
      new NodeHttpsBalanceJsonRpcTransport(config()).exchange(rpc(), controller.signal),
      'UNAVAILABLE',
    );

    expect(privateRead).not.toHaveBeenCalled();
    expect(resolverConstructorMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
  });

  it('rejects a forged AbortSignal without starting work', async () => {
    const signal = { aborted: false, addEventListener: jest.fn() } as unknown as AbortSignal;

    await expectFailure(
      new NodeHttpsBalanceJsonRpcTransport(config()).exchange(rpc(), signal),
      'PERMANENT',
    );
    expect(signal.addEventListener).not.toHaveBeenCalled();
    expect(resolverConstructorMock).not.toHaveBeenCalled();
  });

  it('aborts during DNS, starts no HTTPS request, and ignores a late DNS answer', async () => {
    const held = holdLookup();
    const controller = new AbortController();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      controller.signal,
    );
    const resolver = resolverInstances[0];

    controller.abort(new Error('private reason'));
    await expectFailure(pending, 'UNAVAILABLE');
    expect(resolver?.cancel).toHaveBeenCalledTimes(1);
    held.resolve();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    [4, dns.NODATA, '2001:4860:4860::8888', 6],
    [6, dns.NOTFOUND, PUBLIC_IPV4, 4],
  ] as const)(
    'treats an expected empty IPv%s DNS family as empty',
    async (emptyFamily, errorCode, publicAddress, expectedFamily) => {
      resolverBehavior = (_resolver, family, _hostname, callback) => {
        if (family === emptyFamily) {
          callback(Object.assign(new Error('empty family'), { code: errorCode }), []);
        } else {
          callback(null, [publicAddress]);
        }
      };
      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
        rpc(),
        new AbortController().signal,
      );
      const call = httpsCalls[0];

      expect(call?.options.family).toBe(expectedFamily);
      await expectFailureAfterAbort(pending, call);
    },
  );

  it('destroys accepted I/O on abort and late socket callbacks cannot send a body', async () => {
    installLookup();
    const controller = new AbortController();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      controller.signal,
    );
    const call = httpsCalls[0];
    expect(call).toBeDefined();
    const socket = socketFor(call!);

    controller.abort(new Error('private reason'));
    await expectFailure(pending, 'UNAVAILABLE');
    expect(call?.request.destroy).toHaveBeenCalledTimes(1);
    socket.emit('secureConnect');
    expect(call?.request.end).not.toHaveBeenCalled();
  });

  it('uses one bounded cancellable A+AAAA resolver and hands one numeric address to HTTPS', async () => {
    installLookup([
      { address: PUBLIC_IPV4, family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];

    expect(resolverConstructorMock).toHaveBeenCalledTimes(1);
    expect(resolverConstructorMock).toHaveBeenCalledWith({
      maxTimeout: 2_000,
      timeout: 2_000,
      tries: 1,
    });
    const resolver = resolverInstances[0];
    expect(resolver?.resolve4).toHaveBeenCalledTimes(1);
    expect(resolver?.resolve4.mock.calls[0]?.[0]).toBe(PROVIDER_HOST);
    expect(resolver?.resolve6).toHaveBeenCalledTimes(1);
    expect(resolver?.resolve6.mock.calls[0]?.[0]).toBe(PROVIDER_HOST);
    const suppliedLookup = call?.options.lookup as (
      hostname: string,
      options: dns.LookupOptions,
      callback: (error: Error | null, address: string, family: number) => void,
    ) => void;
    const handed = jest.fn();
    suppliedLookup(PROVIDER_HOST, { all: false }, handed);
    expect(handed).toHaveBeenCalledWith(null, PUBLIC_IPV4, 4);
    const handedAll = jest.fn();
    suppliedLookup(PROVIDER_HOST, { all: true }, handedAll);
    expect(handedAll).toHaveBeenCalledWith(null, [{ address: PUBLIC_IPV4, family: 4 }]);
    await expectFailureAfterAbort(pending, call);
  });

  it.each([
    [[{ address: '127.0.0.1', family: 4 }]],
    [[{ address: '10.0.0.1', family: 4 }]],
    [[{ address: '169.254.169.254', family: 4 }]],
    [[{ address: '::1', family: 6 }]],
    [[{ address: 'fc00::1', family: 6 }]],
    [
      [
        { address: PUBLIC_IPV4, family: 4 },
        { address: '192.168.1.1', family: 4 },
      ],
    ],
    [[]],
  ] as const)(
    'rejects the complete DNS answer set when any answer is non-public %#',
    async (answers) => {
      installLookup(answers as unknown as dns.LookupAddress[]);

      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
        rpc(),
        new AbortController().signal,
      );

      await expectFailure(pending, 'UNAVAILABLE');
      expect(requestMock).not.toHaveBeenCalled();
    },
  );

  it('rejects IPv6 space outside global unicast instead of treating a blacklist as public', async () => {
    installLookup([{ address: '4000::1', family: 6 }]);
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );

    if (httpsCalls[0] !== undefined) httpsCalls[0].request.emit('error', new Error('cleanup'));
    await expectFailure(pending, 'UNAVAILABLE');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    { remoteAddress: '1.1.1.1' },
    { remoteAddress: '127.0.0.1' },
    { authorized: false },
    { encrypted: false },
    { protocol: 'TLSv1.1' },
    { remoteFamily: 'IPv6' },
  ])('rejects a TLS socket that fails the pinned remote/TLS checks %#', async (overrides) => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    expect(call).toBeDefined();

    secure(call!, overrides);

    await expectFailure(pending, 'PERMANENT');
    expect(call?.request.end).not.toHaveBeenCalled();
    expect(call?.request.destroy).toHaveBeenCalledTimes(1);
  });

  it('pins HTTPS:443, TLS/SNI/identity, disables pooling, and sends only after secure TLS', async () => {
    installLookup();
    const request = rpc('eth_getBlockByNumber', ['finalized', false]);
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      request,
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    expect(call).toBeDefined();

    expect(call?.options).toMatchObject({
      agent: false,
      family: 4,
      hostname: PROVIDER_HOST,
      method: 'POST',
      minVersion: 'TLSv1.2',
      path: '/rpc',
      port: 443,
      rejectUnauthorized: true,
      servername: PROVIDER_HOST,
    });
    expect(call?.options.checkServerIdentity).toBe(tls.checkServerIdentity);
    expect(call?.options.headers).toEqual({
      accept: 'application/json',
      connection: 'close',
      'content-length': Buffer.byteLength(JSON.stringify(request)),
      'content-type': 'application/json',
    });
    expect(call?.request.end).not.toHaveBeenCalled();
    const socket = socketFor(call!);
    expect(call?.request.end).not.toHaveBeenCalled();

    socket.emit('secureConnect');

    expect(call?.request.end).toHaveBeenCalledTimes(1);
    expect(call?.request.end).toHaveBeenCalledWith(JSON.stringify(request));
    await expectFailureAfterAbort(pending, call);
  });

  it.each([
    [{ kind: 'NONE' as const }, undefined, undefined],
    [
      { kind: 'AUTHORIZATION_HEADER' as const, value: 'Bearer provider-token' },
      'Bearer provider-token',
      undefined,
    ],
    [{ kind: 'X_API_KEY_HEADER' as const, value: 'provider-token' }, undefined, 'provider-token'],
  ])('emits only the selected credential header %#', async (credential, authorization, apiKey) => {
    installLookup();
    const transport = new NodeHttpsBalanceJsonRpcTransport(config({ credential }));
    const pending = transport.exchange(rpc(), new AbortController().signal);
    const call = httpsCalls[0];
    const headers = call?.options.headers as Record<string, unknown>;

    expect(headers.authorization).toBe(authorization);
    expect(headers['x-api-key']).toBe(apiKey);
    expect(JSON.stringify(headers)).not.toContain('undefined');
    await expectFailureAfterAbort(pending, call);
  });

  it('applies the 2 second connect deadline to the cancellable A+AAAA resolver', async () => {
    jest.useFakeTimers();
    const held = holdLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const resolver = resolverInstances[0];
    const observed = jest.fn();
    void pending.catch(observed);

    await jest.advanceTimersByTimeAsync(2_000);
    const failedByConnectDeadline = observed.mock.calls.length === 1;
    await jest.advanceTimersByTimeAsync(3_000);

    expect(failedByConnectDeadline).toBe(true);
    expect(observed.mock.calls[0]?.[0]).toMatchObject({ code: 'TIMEOUT' });
    expect(resolver?.cancel).toHaveBeenCalledTimes(1);
    held.resolve();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('times out a TLS connection at 2 seconds and destroys the request', async () => {
    jest.useFakeTimers();
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    const assertion = expectFailure(pending, 'TIMEOUT');

    await jest.advanceTimersByTimeAsync(1_999);
    expect(call?.request.destroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await assertion;
    expect(call?.request.destroy).toHaveBeenCalledTimes(1);
  });

  it('retains the 5 second total deadline after TLS is secure', async () => {
    jest.useFakeTimers();
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const assertion = expectFailure(pending, 'TIMEOUT');

    await jest.advanceTimersByTimeAsync(4_999);
    expect(call?.request.destroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await assertion;
    expect(call?.request.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses the 250ms fallback when a destroyed request never reports close', async () => {
    jest.useFakeTimers();
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    expect(call).toBeDefined();
    call!.request.closeOnDestroy = false;
    secure(call!);
    const assertion = expectFailure(pending, 'PERMANENT');
    const settled = jest.fn();
    void assertion.then(settled);

    call?.respond(new FakeResponse(500, []) as unknown as IncomingMessage);
    await jest.advanceTimersByTimeAsync(249);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(call?.request.destroy).toHaveBeenCalledTimes(1);

    call?.request.emit('close');
    await jest.runAllTimersAsync();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['request-first', true],
    ['response-first', false],
  ] as const)('joins %s failure teardown before rejecting', async (_order, requestFirst) => {
    installLookup();
    const controller = new AbortController();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      controller.signal,
    );
    const call = httpsCalls[0];
    expect(call).toBeDefined();
    secure(call!);
    const response = new FakeResponse(200, [
      'Content-Type',
      'application/json',
      'Content-Length',
      '2',
    ]);
    call?.respond(response as unknown as IncomingMessage);
    call!.request.closeOnDestroy = requestFirst;
    response.closeOnDestroy = !requestFirst;
    const settled = jest.fn();
    void pending.then(settled, settled);

    controller.abort(new Error('private abort reason'));
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    if (requestFirst) response.emit('close');
    else call?.request.emit('close');
    await expectFailure(pending, 'UNAVAILABLE');
    expect(call?.request.destroy).toHaveBeenCalledTimes(1);
    expect(response.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, [], 'RATE_LIMITED', undefined],
    [429, ['Retry-After', '0'], 'RATE_LIMITED', 0],
    [429, ['Retry-After', '60'], 'RATE_LIMITED', 60],
    [502, [], 'UNAVAILABLE', undefined],
    [503, [], 'UNAVAILABLE', undefined],
    [301, ['Location', 'https://other.vendor.dev/rpc'], 'PERMANENT', undefined],
    [400, [], 'PERMANENT', undefined],
    [500, [], 'PERMANENT', undefined],
  ] as const)(
    'maps HTTP %s without retrying',
    async (status, rawHeaders, code, retryAfterSeconds) => {
      installLookup();
      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
        rpc(),
        new AbortController().signal,
      );
      const call = httpsCalls[0];
      secure(call!);
      call?.respond(new FakeResponse(status, [...rawHeaders]) as unknown as IncomingMessage);

      await expectFailure(pending, code, retryAfterSeconds);
      expect(resolverConstructorMock).toHaveBeenCalledTimes(1);
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(call?.request.destroy).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [['Retry-After', '61']],
    [['Retry-After', '-1']],
    [['Retry-After', '1.5']],
    [['Retry-After', '1', 'Retry-After', '2']],
    [['Retry-After']],
  ])('rejects an unbounded or malformed Retry-After header %#', async (rawHeaders) => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    call?.respond(new FakeResponse(429, rawHeaders) as unknown as IncomingMessage);

    await expectFailure(pending, 'PERMANENT');
  });

  it('returns a strict JSON response only after its complete declared body', async () => {
    installLookup();
    const request = rpc();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      request,
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const expected = { jsonrpc: '2.0', id: request.id, result: '0x1' };
    const body = responseBody(expected);
    const response = jsonResponse(200, body);

    deliver(call!, response, [body.subarray(0, 3), body.subarray(3)]);
    call?.request.emit('close');

    await expect(pending).resolves.toEqual(expected);
    expect(response.destroy).not.toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('returns a strict JSON response from one complete case-insensitive chunked body', async () => {
    installLookup();
    const request = rpc();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      request,
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const expected = { jsonrpc: '2.0', id: request.id, result: '0x1' };
    const body = responseBody(expected);
    const response = new FakeResponse(200, [
      'cOnTeNt-TyPe',
      'application/json',
      'tRaNsFeR-EnCoDiNg',
      'ChUnKeD',
    ]);

    deliver(call!, response, [body.subarray(0, 1), body.subarray(1, 7), body.subarray(7)]);
    call?.request.emit('close');

    await expect(pending).resolves.toEqual(expected);
    expect(response.destroy).not.toHaveBeenCalled();
  });

  it('keeps a successful exchange pending until the Connection-close request closes', async () => {
    installLookup();
    const request = rpc();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      request,
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const body = responseBody({ jsonrpc: '2.0', id: request.id, result: '0x1' });
    deliver(call!, jsonResponse(200, body), [body]);
    const settled = jest.fn();
    void pending.then(settled, settled);
    await Promise.resolve();
    const settledBeforeClose = settled.mock.calls.length > 0;

    call?.request.emit('close');
    await pending;
    expect(settledBeforeClose).toBe(false);
  });

  it.each([
    [['Content-Length', '2'], Buffer.from('{}')],
    [['Content-Type', 'application/json'], Buffer.from('{}')],
    [['Content-Type', 'text/plain', 'Content-Length', '2'], Buffer.from('{}')],
    [
      ['Content-Type', 'application/json', 'Content-Length', '2', 'Content-Encoding', 'gzip'],
      Buffer.from('{}'),
    ],
    [
      ['Content-Type', 'application/json', 'Content-Length', '2', 'Transfer-Encoding', 'chunked'],
      Buffer.from('{}'),
    ],
    [
      [
        'Content-Type',
        'application/json',
        'Transfer-Encoding',
        'chunked',
        'Content-Encoding',
        'gzip',
      ],
      Buffer.from('{}'),
    ],
    [
      ['Content-Type', 'application/json', 'Transfer-Encoding', 'chunked', 'Trailer', 'X-Checksum'],
      Buffer.from('{}'),
    ],
    [
      [
        'Content-Type',
        'application/json',
        'Transfer-Encoding',
        'chunked',
        'Transfer-Encoding',
        'chunked',
      ],
      Buffer.from('{}'),
    ],
    [['Content-Type', 'application/json', 'Transfer-Encoding', 'gzip'], Buffer.from('{}')],
    [['Content-Type', 'application/json', 'Transfer-Encoding', 'gzip, chunked'], Buffer.from('{}')],
    [['Content-Type', 'application/json', 'Transfer-Encoding', 'chunked; q=1'], Buffer.from('{}')],
    [['Content-Type', 'application/json', 'Transfer-Encoding', ''], Buffer.from('{}')],
    [
      ['Content-Type', 'application/json', 'Content-Length', '2', 'Content-Length', '2'],
      Buffer.from('{}'),
    ],
    [['Content-Type', 'application/json', 'Content-Length', '4194305'], Buffer.from('{}')],
    [['Content-Type', 'application/json', 'Content-Length', '02'], Buffer.from('{}')],
    [
      ['Bad Header', 'x', 'Content-Type', 'application/json', 'Content-Length', '2'],
      Buffer.from('{}'),
    ],
  ])('rejects unsafe or ambiguous response metadata %#', async (rawHeaders, body) => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const response = new FakeResponse(200, rawHeaders);
    call?.respond(response as unknown as IncomingMessage);
    response.emit('data', body);
    response.emit('end');

    await expectFailure(pending, 'PERMANENT');
    expect(response.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects received chunked trailers even when none were declared', async () => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const response = chunkedJsonResponse();
    response.rawTrailers.push('X-Checksum', 'private-trailer-value');

    deliver(call!, response, [Buffer.from('{}')]);

    await expectFailure(pending, 'PERMANENT');
    expect(response.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, 0, '1.0'],
    [2, 0, '2.0'],
  ] as const)(
    'rejects chunked framing on HTTP %s.%s',
    async (httpVersionMajor, httpVersionMinor, httpVersion) => {
      installLookup();
      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
        rpc(),
        new AbortController().signal,
      );
      const call = httpsCalls[0];
      secure(call!);
      const response = chunkedJsonResponse();
      response.httpVersion = httpVersion;
      response.httpVersionMajor = httpVersionMajor;
      response.httpVersionMinor = httpVersionMinor;

      deliver(call!, response, [Buffer.from('{}')]);

      await expectFailure(pending, 'PERMANENT');
    },
  );

  it('maps an incomplete chunked message that emits end to unavailable', async () => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const response = chunkedJsonResponse();
    response.complete = false;

    deliver(call!, response, [Buffer.from('{}')]);

    await expectFailure(pending, 'UNAVAILABLE');
  });

  it('rejects a chunked decoded body above the four MiB limit', async () => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const response = chunkedJsonResponse();

    deliver(call!, response, [Buffer.alloc(4 * 1024 * 1024 + 1, 0x20)]);

    await expectFailure(pending, 'PERMANENT');
  });

  it.each([
    ['fatal UTF-8', Buffer.from([0xc3, 0x28])],
    ['duplicate keys', Buffer.from('{"key":1,"key":2}')],
    ['escaped-equivalent duplicate keys', Buffer.from('{"key":1,"\\u006bey":2}')],
    ['depth above 32', Buffer.from(`${'['.repeat(34)}0${']'.repeat(34)}`)],
  ])('rejects %s in a JSON response', async (_caseName, body) => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    deliver(call!, jsonResponse(200, body), [body]);

    await expectFailure(pending, 'PERMANENT');
  });

  it('rejects JSON above the 200,000-node budget', async () => {
    installLookup();
    const body = Buffer.from(`[${'0,'.repeat(200_000)}0]`);
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    deliver(call!, jsonResponse(200, body), [body]);

    await expectFailure(pending, 'PERMANENT');
  });

  it.each(['content-length', 'chunked'] as const)(
    'rejects excessive %s response fragmentation within the byte limit',
    async (framing) => {
      installLookup();
      const chunkCount = 4_097;
      const body = Buffer.from(`"${'a'.repeat(chunkCount - 2)}"`);
      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
        rpc(),
        new AbortController().signal,
      );
      const call = httpsCalls[0];
      secure(call!);
      const response = framing === 'chunked' ? chunkedJsonResponse() : jsonResponse(200, body);
      deliver(
        call!,
        response,
        Array.from(body, (byte) => Uint8Array.of(byte)),
      );

      await expectFailure(pending, 'PERMANENT');
    },
  );

  it.each([
    ['declared length mismatch', true, [Buffer.from('{}')], 3],
    ['incomplete response', false, [Buffer.from('{}')], 2],
  ] as const)('maps a %s to unavailable', async (_caseName, complete, chunks, declaredLength) => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const response = new FakeResponse(200, [
      'Content-Type',
      'application/json',
      'Content-Length',
      String(declaredLength),
    ]);
    response.complete = complete;
    deliver(call!, response, chunks);

    await expectFailure(pending, 'UNAVAILABLE');
  });

  it.each([
    ['content-length', 'aborted'],
    ['content-length', 'error'],
    ['content-length', 'close'],
    ['chunked', 'aborted'],
    ['chunked', 'error'],
    ['chunked', 'close'],
  ] as const)('maps a premature %s response %s to unavailable', async (framing, event) => {
    installLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls[0];
    secure(call!);
    const response =
      framing === 'chunked'
        ? chunkedJsonResponse()
        : new FakeResponse(200, ['Content-Type', 'application/json', 'Content-Length', '2']);
    call?.respond(response as unknown as IncomingMessage);
    response.emit(event, new Error('private response detail'));

    await expectFailure(pending, 'UNAVAILABLE');
  });

  it.each(['content-length', 'chunked'] as const)(
    'aborts while a %s response body is streaming and ignores all late body events',
    async (framing) => {
      installLookup();
      const controller = new AbortController();
      const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
        rpc(),
        controller.signal,
      );
      const call = httpsCalls[0];
      secure(call!);
      const response =
        framing === 'chunked'
          ? chunkedJsonResponse()
          : new FakeResponse(200, ['Content-Type', 'application/json', 'Content-Length', '20']);
      call?.respond(response as unknown as IncomingMessage);
      response.emit('data', Buffer.from('{"private":'));
      const assertion = expectFailure(pending, 'UNAVAILABLE');

      controller.abort(new Error('private abort reason'));

      await assertion;
      expect(response.destroy).toHaveBeenCalledTimes(1);
      expect(call?.request.destroy).toHaveBeenCalledTimes(1);
      response.emit('data', Buffer.from('"late"}'));
      response.emit('end');
      response.emit('close');
      call?.request.emit('close');
    },
  );

  it('sanitizes synchronous DNS, HTTPS, request, and cleanup failures', async () => {
    const secret = 'secret-provider-host-detail';
    resolverConstructorMock.mockImplementationOnce(() => {
      throw new Error(secret);
    });
    const dnsFailure = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    await expectFailure(dnsFailure, 'UNAVAILABLE');

    installLookup();
    requestMock.mockImplementationOnce(() => {
      throw new Error(secret);
    });
    const httpsFailure = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    await expectFailure(httpsFailure, 'UNAVAILABLE');

    requestMock.mockImplementationOnce(
      (
        options: Record<string, unknown>,
        respond: (response: IncomingMessage) => void,
      ): ClientRequest => {
        const request = new FakeRequest();
        request.destroy.mockImplementation(() => {
          request.destroyed = true;
          queueMicrotask(() => request.emit('close'));
          throw new Error(secret);
        });
        httpsCalls.push({ options, respond, request });
        return request as unknown as ClientRequest;
      },
    );
    const requestFailure = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    const call = httpsCalls.at(-1);
    call?.request.emit('error', new Error(secret));
    await expectFailure(requestFailure, 'UNAVAILABLE');
  });

  it('never retries a DNS or HTTPS failure', async () => {
    const held = holdLookup();
    const pending = new NodeHttpsBalanceJsonRpcTransport(config()).exchange(
      rpc(),
      new AbortController().signal,
    );
    held.reject();

    await expectFailure(pending, 'UNAVAILABLE');
    expect(resolverConstructorMock).toHaveBeenCalledTimes(1);
    expect(requestMock).not.toHaveBeenCalled();
  });

  async function expectFailureAfterAbort(
    pending: Promise<unknown>,
    call: HttpsCall | undefined,
  ): Promise<void> {
    if (call !== undefined) call.request.emit('error', new Error('test cleanup'));
    await expectFailure(pending, 'UNAVAILABLE');
  }
});
