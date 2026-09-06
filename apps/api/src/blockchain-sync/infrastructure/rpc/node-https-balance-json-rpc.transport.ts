import * as dns from 'node:dns';
import type { ClientRequest, IncomingMessage } from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity, type TLSSocket } from 'node:tls';
import { TextDecoder } from 'node:util';

import {
  BalanceJsonRpcTransportFailure,
  balanceRpcRequest,
  type BalanceJsonRpcRequest,
  type BalanceJsonRpcTransport,
} from './balance-json-rpc';

const ETHEREUM_MAINNET = 'eip155:1';
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CONNECT_TIMEOUT_MS = 2_000;
const TOTAL_TIMEOUT_MS = 5_000;
const IO_CLOSE_TIMEOUT_MS = 250;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 200_000;
const MAX_RESPONSE_CHUNKS = 4_096;

const ALLOWED_METHODS = Object.freeze({
  [ETHEREUM_MAINNET]: new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']),
  [SOLANA_MAINNET]: new Set(['getGenesisHash', 'getSlot', 'getBlock', 'getTokenAccountsByOwner']),
});

export type NodeHttpsBalanceRpcNetworkId = typeof ETHEREUM_MAINNET | typeof SOLANA_MAINNET;

export type NodeHttpsBalanceRpcCredential =
  | Readonly<{ kind: 'NONE' }>
  | Readonly<{ kind: 'AUTHORIZATION_HEADER'; value: string }>
  | Readonly<{ kind: 'X_API_KEY_HEADER'; value: string }>;

export interface NodeHttpsBalanceJsonRpcTransportConfig {
  readonly networkId: NodeHttpsBalanceRpcNetworkId;
  readonly hostname: string;
  readonly path: string;
  readonly credential: NodeHttpsBalanceRpcCredential;
}

interface ReviewedConfig {
  readonly networkId: NodeHttpsBalanceRpcNetworkId;
  readonly hostname: string;
  readonly path: string;
  readonly credential: NodeHttpsBalanceRpcCredential;
}

interface ReviewedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

type ReviewedResponseMetadata =
  Readonly<{ framing: 'CONTENT_LENGTH'; contentLength: number }> | Readonly<{ framing: 'CHUNKED' }>;

interface ExchangeState {
  settled: boolean;
  request: ClientRequest | undefined;
  response: IncomingMessage | undefined;
  totalTimer: NodeJS.Timeout | undefined;
  connectTimer: NodeJS.Timeout | undefined;
  closeTimer: NodeJS.Timeout | undefined;
  abortListener: (() => void) | undefined;
  resolver: dns.Resolver | undefined;
  requestClosed: boolean;
  responseClosed: boolean;
  onRequestClose: (() => void) | undefined;
  onResponseClose: (() => void) | undefined;
}

const CONFIGS = new WeakMap<NodeHttpsBalanceJsonRpcTransport, ReviewedConfig>();

/**
 * Dormant mainnet HTTPS capsule. Construction and import perform no I/O. The
 * application does not export, register, configure, or instantiate this class.
 */
export class NodeHttpsBalanceJsonRpcTransport implements BalanceJsonRpcTransport {
  constructor(config: NodeHttpsBalanceJsonRpcTransportConfig) {
    CONFIGS.set(this, reviewConfig(config));
    Object.freeze(this);
  }

  exchange(request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown> {
    const config = CONFIGS.get(this);
    if (config === undefined) return Promise.reject(permanentFailure());

    let reviewedRequest: BalanceJsonRpcRequest;
    try {
      reviewedRequest = reviewRequest(request, config.networkId);
      if (readSignalAborted(signal)) return Promise.reject(unavailableFailure());
    } catch (error) {
      return Promise.reject(isFailure(error) ? error : permanentFailure());
    }

    let body: string;
    try {
      body = JSON.stringify(reviewedRequest);
      if (Buffer.byteLength(body, 'utf8') > MAX_JSON_BYTES) throw new Error('oversized request');
    } catch {
      return Promise.reject(permanentFailure());
    }

    return new Promise((resolve, reject) => {
      const state: ExchangeState = {
        settled: false,
        request: undefined,
        response: undefined,
        totalTimer: undefined,
        connectTimer: undefined,
        closeTimer: undefined,
        abortListener: undefined,
        resolver: undefined,
        requestClosed: false,
        responseClosed: false,
        onRequestClose: undefined,
        onResponseClose: undefined,
      };

      const cleanup = (): void => {
        clearTimer(state.totalTimer);
        clearTimer(state.connectTimer);
        state.totalTimer = undefined;
        state.connectTimer = undefined;
        if (state.abortListener !== undefined) {
          try {
            AbortSignal.prototype.removeEventListener.call(signal, 'abort', state.abortListener);
          } catch {
            // A genuine AbortSignal should not fail removal. Cleanup stays best effort.
          }
          state.abortListener = undefined;
        }
      };

      const settleFailure = (failure: BalanceJsonRpcTransportFailure): void => {
        if (state.settled) return;
        state.settled = true;
        cleanup();
        cancelResolver(state.resolver);
        state.resolver = undefined;
        let failureFinished = false;
        const finishFailure = (): void => {
          if (failureFinished) return;
          failureFinished = true;
          clearTimer(state.closeTimer);
          state.closeTimer = undefined;
          state.onRequestClose = undefined;
          state.onResponseClose = undefined;
          reject(failure);
        };
        const awaitRequestClose = state.request !== undefined && !state.requestClosed;
        const awaitResponseClose = state.response !== undefined && !state.responseClosed;
        const finishWhenClosed = (): void => {
          if (
            (state.request === undefined || state.requestClosed) &&
            (state.response === undefined || state.responseClosed)
          ) {
            finishFailure();
          }
        };
        if (awaitRequestClose || awaitResponseClose) {
          state.onRequestClose = finishWhenClosed;
          state.onResponseClose = finishWhenClosed;
          try {
            state.closeTimer = scheduleTimer(finishFailure, IO_CLOSE_TIMEOUT_MS);
          } catch {
            state.onRequestClose = undefined;
            state.onResponseClose = undefined;
          }
        }
        destroyResponse(state.response);
        destroyRequest(state.request);
        if (state.closeTimer === undefined) finishFailure();
        else finishWhenClosed();
      };

      const settleSuccess = (value: unknown): void => {
        if (state.settled) return;
        state.settled = true;
        cleanup();
        resolve(value);
      };

      const onAbort = (): void => settleFailure(unavailableFailure());
      state.abortListener = onAbort;

      try {
        AbortSignal.prototype.addEventListener.call(signal, 'abort', onAbort, { once: true });
        if (readSignalAborted(signal)) {
          onAbort();
          return;
        }
        state.totalTimer = scheduleTimer(() => settleFailure(timeoutFailure()), TOTAL_TIMEOUT_MS);
        state.connectTimer = scheduleTimer(
          () => settleFailure(timeoutFailure()),
          CONNECT_TIMEOUT_MS,
        );
      } catch {
        settleFailure(permanentFailure());
        return;
      }

      const resolver = resolvePublicAddresses(config.hostname, (addresses) => {
        state.resolver = undefined;
        if (state.settled) return;
        if (addresses === null) {
          settleFailure(unavailableFailure());
          return;
        }
        if (readSignalAbortedSafely(signal)) {
          onAbort();
          return;
        }

        const selected = addresses[0];
        if (selected === undefined) {
          settleFailure(unavailableFailure());
          return;
        }

        try {
          const openedRequest = openRequest(
            config,
            selected,
            body,
            state,
            settleFailure,
            settleSuccess,
          );
          state.request = openedRequest;
          if (state.settled) destroyRequest(openedRequest);
        } catch {
          settleFailure(unavailableFailure());
        }
      });
      state.resolver = resolver ?? undefined;
      if (state.settled) {
        cancelResolver(state.resolver);
        state.resolver = undefined;
      }
    });
  }
}

function openRequest(
  config: ReviewedConfig,
  address: ReviewedAddress,
  body: string,
  state: ExchangeState,
  settleFailure: (failure: BalanceJsonRpcTransportFailure) => void,
  settleSuccess: (value: unknown) => void,
): ClientRequest {
  const headers: Record<string, string | number> = {
    accept: 'application/json',
    connection: 'close',
    'content-length': Buffer.byteLength(body, 'utf8'),
    'content-type': 'application/json',
  };
  if (config.credential.kind === 'AUTHORIZATION_HEADER') {
    headers.authorization = config.credential.value;
  } else if (config.credential.kind === 'X_API_KEY_HEADER') {
    headers['x-api-key'] = config.credential.value;
  }

  let secure = false;
  let bodySent = false;
  let responseParsed = false;
  let parsedResponse: unknown;
  let requestClosed = false;
  const clientRequest = https.request(
    {
      agent: false,
      checkServerIdentity,
      family: address.family,
      headers,
      hostname: config.hostname,
      lookup: (_hostname, options, callback) => {
        if (options.all === true) {
          callback(null, [address]);
          return;
        }
        callback(null, address.address, address.family);
      },
      method: 'POST',
      minVersion: 'TLSv1.2',
      path: config.path,
      port: 443,
      rejectUnauthorized: true,
      servername: config.hostname,
    },
    (response) => {
      state.response = response;
      state.responseClosed = false;
      response.once('close', () => {
        state.responseClosed = true;
        state.onResponseClose?.();
        if (!state.settled && responseParsed && requestClosed) {
          settleSuccess(parsedResponse);
        }
      });
      if (state.settled) {
        destroyResponse(response);
        return;
      }
      if (!secure || !bodySent) {
        settleFailure(permanentFailure());
        return;
      }
      consumeResponse(response, settleFailure, (value) => {
        responseParsed = true;
        parsedResponse = value;
        if (requestClosed && state.responseClosed) settleSuccess(value);
      });
    },
  );

  clientRequest.on('error', () => settleFailure(unavailableFailure()));
  clientRequest.once('close', () => {
    requestClosed = true;
    state.requestClosed = true;
    state.onRequestClose?.();
    if (state.settled) return;
    if (responseParsed) {
      if (state.responseClosed) settleSuccess(parsedResponse);
      return;
    }
    settleFailure(unavailableFailure());
  });
  clientRequest.once('socket', (socket) => {
    socket.on('error', () => settleFailure(unavailableFailure()));
    socket.once('close', () => {
      if (!state.settled && !responseParsed) settleFailure(unavailableFailure());
    });
    socket.once('secureConnect', () => {
      if (state.settled) return;
      if (!reviewSecureSocket(socket, address)) {
        settleFailure(permanentFailure());
        return;
      }
      secure = true;
      clearTimer(state.connectTimer);
      state.connectTimer = undefined;
      try {
        bodySent = true;
        clientRequest.end(body);
      } catch {
        settleFailure(unavailableFailure());
      }
    });
  });
  return clientRequest;
}

function consumeResponse(
  response: IncomingMessage,
  settleFailure: (failure: BalanceJsonRpcTransportFailure) => void,
  settleSuccess: (value: unknown) => void,
): void {
  const statusCode = response.statusCode;
  if (statusCode === 429) {
    const retryAfter = reviewRetryAfter(response.rawHeaders);
    settleFailure(
      retryAfter === null
        ? permanentFailure()
        : new BalanceJsonRpcTransportFailure(
            'RATE_LIMITED',
            retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter },
          ),
    );
    return;
  }
  if (statusCode === 502 || statusCode === 503) {
    settleFailure(unavailableFailure());
    return;
  }
  if (statusCode !== 200) {
    settleFailure(permanentFailure());
    return;
  }

  const metadata = reviewResponseMetadata(
    response.rawHeaders,
    response.httpVersionMajor,
    response.httpVersionMinor,
  );
  if (metadata === null) {
    settleFailure(permanentFailure());
    return;
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let ended = false;
  const maximumResponseBytes =
    metadata.framing === 'CONTENT_LENGTH' ? metadata.contentLength : MAX_JSON_BYTES;

  response.on('data', (chunk: unknown) => {
    if (ended) return;
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      ended = true;
      settleFailure(permanentFailure());
      return;
    }
    const buffer = Buffer.from(chunk);
    if (
      buffer.length === 0 ||
      chunks.length >= MAX_RESPONSE_CHUNKS ||
      receivedBytes > maximumResponseBytes - buffer.length
    ) {
      ended = true;
      settleFailure(permanentFailure());
      return;
    }
    receivedBytes += buffer.length;
    chunks.push(buffer);
  });
  response.once('aborted', () => {
    if (ended) return;
    ended = true;
    settleFailure(unavailableFailure());
  });
  response.on('error', () => {
    if (ended) return;
    ended = true;
    settleFailure(unavailableFailure());
  });
  response.once('end', () => {
    if (ended) return;
    ended = true;
    if (
      !response.complete ||
      (metadata.framing === 'CONTENT_LENGTH' && receivedBytes !== metadata.contentLength)
    ) {
      settleFailure(unavailableFailure());
      return;
    }
    if (!hasNoResponseTrailers(response.rawTrailers)) {
      settleFailure(permanentFailure());
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      settleSuccess(parseStrictJson(text));
    } catch {
      settleFailure(permanentFailure());
    }
  });
  response.once('close', () => {
    if (ended) return;
    ended = true;
    settleFailure(unavailableFailure());
  });
}

function reviewConfig(value: unknown): ReviewedConfig {
  try {
    const record = exactDataRecord(value, ['credential', 'hostname', 'networkId', 'path']);
    const networkId = record.networkId;
    const hostname = record.hostname;
    const path = record.path;
    if (networkId !== ETHEREUM_MAINNET && networkId !== SOLANA_MAINNET) {
      throw new Error('invalid network');
    }
    if (typeof hostname !== 'string' || !isCanonicalPublicHostname(hostname)) {
      throw new Error('invalid hostname');
    }
    if (typeof path !== 'string' || !isCanonicalPath(path)) {
      throw new Error('invalid path');
    }
    const credential = reviewCredential(record.credential);
    return Object.freeze({ credential, hostname, networkId, path });
  } catch {
    throw new TypeError('invalid balance HTTPS transport configuration');
  }
}

function reviewCredential(value: unknown): NodeHttpsBalanceRpcCredential {
  const record = dataRecord(value);
  const keys = Object.keys(record).sort();
  if (keys.length === 1 && keys[0] === 'kind' && record.kind === 'NONE') {
    return Object.freeze({ kind: 'NONE' });
  }
  if (
    keys.length === 2 &&
    keys[0] === 'kind' &&
    keys[1] === 'value' &&
    (record.kind === 'AUTHORIZATION_HEADER' || record.kind === 'X_API_KEY_HEADER') &&
    typeof record.value === 'string' &&
    record.value === record.value.trim() &&
    /^[\x20-\x7e]{1,2048}$/u.test(record.value)
  ) {
    return Object.freeze({ kind: record.kind, value: record.value });
  }
  throw new TypeError('invalid balance HTTPS transport configuration');
}

function reviewRequest(
  value: unknown,
  networkId: NodeHttpsBalanceRpcNetworkId,
): BalanceJsonRpcRequest {
  try {
    const record = exactDataRecord(value, ['id', 'jsonrpc', 'method', 'params']);
    if (record.jsonrpc !== '2.0' || typeof record.method !== 'string') {
      throw new Error('invalid request');
    }
    const canonical = balanceRpcRequest(record.method, record.params as readonly unknown[]);
    if (record.id !== canonical.id || !ALLOWED_METHODS[networkId].has(canonical.method)) {
      throw new Error('invalid request');
    }
    return canonical;
  } catch {
    throw permanentFailure();
  }
}

function resolvePublicAddresses(
  hostname: string,
  callback: (addresses: readonly ReviewedAddress[] | null) => void,
): dns.Resolver | null {
  let resolver: dns.Resolver;
  try {
    resolver = new dns.Resolver({
      maxTimeout: CONNECT_TIMEOUT_MS,
      timeout: CONNECT_TIMEOUT_MS,
      tries: 1,
    });
  } catch {
    callback(null);
    return null;
  }

  let completed = false;
  let pendingFamilies = 2;
  let ipv4Addresses: readonly string[] = [];
  let ipv6Addresses: readonly string[] = [];

  const finishFamily = (
    family: 4 | 6,
    error: NodeJS.ErrnoException | null,
    rawAddresses: unknown,
  ): void => {
    if (completed) return;
    try {
      if (error !== null && error.code !== dns.NODATA && error.code !== dns.NOTFOUND) {
        completed = true;
        cancelResolver(resolver);
        callback(null);
        return;
      }
      const addressesForFamily = error === null ? rawAddresses : [];
      if (
        !Array.isArray(addressesForFamily) ||
        addressesForFamily.some((address) => typeof address !== 'string')
      ) {
        throw new Error('invalid DNS response');
      }
      if (family === 4) ipv4Addresses = [...(addressesForFamily as string[])];
      else ipv6Addresses = [...(addressesForFamily as string[])];
      pendingFamilies -= 1;
      if (pendingFamilies !== 0) return;
      const raw = [
        ...ipv4Addresses.map((address) => ({ address, family: 4 as const })),
        ...ipv6Addresses.map((address) => ({ address, family: 6 as const })),
      ];
      if (raw.length < 1 || raw.length > 32) throw new Error('invalid DNS response');
      const addresses = raw.map(reviewAddress);
      completed = true;
      callback(Object.freeze(addresses));
    } catch {
      completed = true;
      cancelResolver(resolver);
      callback(null);
    }
  };

  try {
    resolver.resolve4(hostname, (error, addresses) => finishFamily(4, error, addresses));
    if (!completed) {
      resolver.resolve6(hostname, (error, addresses) => finishFamily(6, error, addresses));
    }
  } catch {
    completed = true;
    cancelResolver(resolver);
    callback(null);
  }
  return resolver;
}

function reviewAddress(value: unknown): ReviewedAddress {
  const record = exactDataRecord(value, ['address', 'family']);
  if (
    typeof record.address !== 'string' ||
    (record.family !== 4 && record.family !== 6) ||
    isIP(record.address) !== record.family ||
    !isPublicIpAddress(record.address, record.family)
  ) {
    throw new Error('invalid address');
  }
  return Object.freeze({ address: record.address, family: record.family });
}

function reviewSecureSocket(socket: unknown, expected: ReviewedAddress): boolean {
  try {
    if (typeof socket !== 'object' || socket === null) return false;
    const candidate = socket as TLSSocket & {
      authorized?: boolean;
      encrypted?: boolean;
      getProtocol?: () => string | null;
    };
    const protocol = candidate.getProtocol?.call(candidate);
    return (
      candidate.authorized === true &&
      (candidate.authorizationError === null || candidate.authorizationError === undefined) &&
      candidate.encrypted === true &&
      (protocol === 'TLSv1.2' || protocol === 'TLSv1.3') &&
      candidate.remoteAddress === expected.address &&
      normalizeRemoteFamily(candidate.remoteFamily) === expected.family &&
      isPublicIpAddress(expected.address, expected.family)
    );
  } catch {
    return false;
  }
}

function reviewResponseMetadata(
  rawHeaders: readonly string[] | undefined,
  httpVersionMajor: number | undefined,
  httpVersionMinor: number | undefined,
): ReviewedResponseMetadata | null {
  const headers = parseRawHeaders(rawHeaders);
  if (headers === null) return null;
  if (headers.has('content-encoding') || headers.has('trailer')) return null;
  const contentTypes = headers.get('content-type');
  const contentLengths = headers.get('content-length');
  const transferEncodings = headers.get('transfer-encoding');
  if (
    contentTypes?.length !== 1 ||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(contentTypes[0] ?? '') ||
    (contentLengths === undefined) === (transferEncodings === undefined)
  ) {
    return null;
  }
  if (transferEncodings !== undefined) {
    if (
      httpVersionMajor !== 1 ||
      httpVersionMinor !== 1 ||
      transferEncodings.length !== 1 ||
      !/^chunked$/iu.test(transferEncodings[0] ?? '')
    ) {
      return null;
    }
    return Object.freeze({ framing: 'CHUNKED' as const });
  }
  const rawContentLength = contentLengths?.[0];
  if (contentLengths?.length !== 1 || !/^(?:[1-9][0-9]{0,6})$/u.test(rawContentLength ?? '')) {
    return null;
  }
  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_JSON_BYTES) return null;
  return Object.freeze({ framing: 'CONTENT_LENGTH' as const, contentLength });
}

function hasNoResponseTrailers(rawTrailers: readonly string[] | undefined): boolean {
  return Array.isArray(rawTrailers) && rawTrailers.length === 0;
}

function reviewRetryAfter(rawHeaders: readonly string[] | undefined): number | undefined | null {
  const headers = parseRawHeaders(rawHeaders);
  if (headers === null) return null;
  const values = headers.get('retry-after');
  if (values === undefined) return undefined;
  if (values.length !== 1 || !/^(?:0|[1-9][0-9]?)$/u.test(values[0] ?? '')) return null;
  const seconds = Number(values[0]);
  return Number.isSafeInteger(seconds) && seconds <= 60 ? seconds : null;
}

function parseRawHeaders(rawHeaders: readonly string[] | undefined): Map<string, string[]> | null {
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0 || rawHeaders.length > 256) {
    return null;
  }
  const headers = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const rawName = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (
      typeof rawName !== 'string' ||
      typeof value !== 'string' ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(rawName) ||
      /[\r\n\0]/u.test(value)
    ) {
      return null;
    }
    const name = rawName.toLowerCase();
    const values = headers.get(name) ?? [];
    values.push(value.trim());
    headers.set(name, values);
  }
  return headers;
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  const record = dataRecord(value);
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== [...expectedKeys].sort()[index])
  ) {
    throw new Error('invalid record');
  }
  return record;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid record');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid record');
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) throw new Error('invalid record');
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('invalid record');
    result[key] = descriptor.value;
  }
  return result;
}

function isCanonicalPublicHostname(hostname: string): boolean {
  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    hostname !== hostname.toLowerCase() ||
    hostname.endsWith('.') ||
    isIP(hostname) !== 0 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      hostname,
    )
  ) {
    return false;
  }
  return !(
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.example.com') ||
    hostname.endsWith('.example.net') ||
    hostname.endsWith('.example.org')
  );
}

function isCanonicalPath(path: string): boolean {
  if (path === '/') return true;
  return (
    path.length <= 256 &&
    /^\/(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(?:\/(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*))*$/u.test(
      path,
    ) &&
    !path.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

function normalizeRemoteFamily(value: unknown): 4 | 6 | null {
  if (value === 4 || value === 'IPv4') return 4;
  if (value === 6 || value === 'IPv6') return 6;
  return null;
}

function isPublicIpAddress(address: string, family: 4 | 6): boolean {
  return family === 4 ? isPublicIpv4(address) : isPublicIpv6(address);
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0, c = 0] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPublicIpv6(address: string): boolean {
  const words = parseIpv6(address);
  if (words === null) return false;
  const first = words[0] ?? 0;
  const second = words[1] ?? 0;
  const allZeroPrefix = words.slice(0, 6).every((word) => word === 0);
  const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if ((first & 0xe000) !== 0x2000) return false;
  return !(
    words.every((word) => word === 0) ||
    words.slice(0, 7).every((word) => word === 0) ||
    allZeroPrefix ||
    ipv4Mapped ||
    (first === 0x0064 && second === 0xff9b) ||
    first === 0x0100 ||
    (first === 0x2001 && second <= 0x01ff) ||
    (first === 0x2001 && second === 0x0db8) ||
    first === 0x2002 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  );
}

function parseIpv6(address: string): readonly number[] | null {
  if (address.includes('%')) return null;
  let input = address;
  const embeddedIpv4 = input.match(/(?:^|:)([0-9]+(?:\.[0-9]+){3})$/u)?.[1];
  const embeddedWords: number[] = [];
  if (embeddedIpv4 !== undefined) {
    if (isIP(embeddedIpv4) !== 4) return null;
    const parts = embeddedIpv4.split('.').map(Number);
    embeddedWords.push(((parts[0] ?? 0) << 8) | (parts[1] ?? 0));
    embeddedWords.push(((parts[2] ?? 0) << 8) | (parts[3] ?? 0));
    input = input.slice(0, -embeddedIpv4.length) + 'v4';
  }
  if (input.split('::').length > 2) return null;
  const [leftText = '', rightText = ''] = input.split('::');
  const convert = (text: string): number[] | null => {
    if (text === '') return [];
    const tokens = text.split(':');
    const result: number[] = [];
    for (const token of tokens) {
      if (token === 'v4') {
        result.push(...embeddedWords);
      } else if (!/^[0-9a-fA-F]{1,4}$/u.test(token)) {
        return null;
      } else {
        result.push(Number.parseInt(token, 16));
      }
    }
    return result;
  };
  const left = convert(leftText);
  const right = convert(rightText);
  if (left === null || right === null) return null;
  if (!input.includes('::')) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function parseStrictJson(text: string): unknown {
  let index = 0;
  let nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;

  const skipWhitespace = (): void => {
    while (
      index < text.length &&
      (text[index] === ' ' || text[index] === '\t' || text[index] === '\n' || text[index] === '\r')
    ) {
      index += 1;
    }
  };

  const parseString = (): string => {
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        const value = JSON.parse(text.slice(start, index)) as unknown;
        if (typeof value !== 'string') throw new Error('invalid JSON');
        return value;
      }
      if (character === '\\') {
        index += 1;
        const escaped = text[index];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) {
            throw new Error('invalid JSON');
          }
          index += 5;
          continue;
        }
        if (escaped === undefined || !/["\\/bfnrt]/u.test(escaped)) {
          throw new Error('invalid JSON');
        }
        index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        throw new Error('invalid JSON');
      }
      index += 1;
    }
    throw new Error('invalid JSON');
  };

  const parseValue = (depth: number): unknown => {
    nodes += 1;
    if (depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES) throw new Error('invalid JSON');
    skipWhitespace();
    const character = text[index];
    if (character === '"') return parseString();
    if (character === '{') {
      index += 1;
      skipWhitespace();
      const result = Object.create(null) as Record<string, unknown>;
      const keys = new Set<string>();
      if (text[index] === '}') {
        index += 1;
        return result;
      }
      while (index < text.length) {
        if (text[index] !== '"') throw new Error('invalid JSON');
        const key = parseString();
        if (keys.has(key)) throw new Error('duplicate JSON key');
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') throw new Error('invalid JSON');
        index += 1;
        result[key] = parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return result;
        }
        if (text[index] !== ',') throw new Error('invalid JSON');
        index += 1;
        skipWhitespace();
      }
      throw new Error('invalid JSON');
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      const result: unknown[] = [];
      if (text[index] === ']') {
        index += 1;
        return result;
      }
      while (index < text.length) {
        result.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return result;
        }
        if (text[index] !== ',') throw new Error('invalid JSON');
        index += 1;
      }
      throw new Error('invalid JSON');
    }
    for (const [literal, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return value;
      }
    }
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(text);
    if (match === null) throw new Error('invalid JSON');
    index += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) throw new Error('invalid JSON');
    return Object.is(number, -0) ? 0 : number;
  };

  const result = parseValue(0);
  skipWhitespace();
  if (index !== text.length) throw new Error('invalid JSON');
  return result;
}

function readSignalAborted(signal: AbortSignal): boolean {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
  if (getter === undefined) throw new Error('invalid abort signal');
  return getter.call(signal) as boolean;
}

function readSignalAbortedSafely(signal: AbortSignal): boolean {
  try {
    return readSignalAborted(signal);
  } catch {
    return true;
  }
}

function scheduleTimer(callback: () => void, milliseconds: number): NodeJS.Timeout {
  const timer = setTimeout(callback, milliseconds);
  try {
    timer.unref();
  } catch {
    clearTimer(timer);
    throw new Error('timer setup failed');
  }
  return timer;
}

function clearTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer === undefined) return;
  try {
    clearTimeout(timer);
  } catch {
    // Native timer cleanup should not fail; settlement must remain deterministic.
  }
}

function cancelResolver(resolver: dns.Resolver | undefined): void {
  if (resolver === undefined) return;
  try {
    resolver.cancel();
  } catch {
    // Resolver cancellation is best effort after a bounded terminal decision.
  }
}

function destroyRequest(request: ClientRequest | undefined): void {
  if (request === undefined || request.destroyed) return;
  try {
    request.destroy();
  } catch {
    // The public failure is already bounded.
  }
}

function destroyResponse(response: IncomingMessage | undefined): void {
  if (response === undefined || response.destroyed) return;
  try {
    response.destroy();
  } catch {
    // The public failure is already bounded.
  }
}

function isFailure(value: unknown): value is BalanceJsonRpcTransportFailure {
  return value instanceof BalanceJsonRpcTransportFailure;
}

function timeoutFailure(): BalanceJsonRpcTransportFailure {
  return new BalanceJsonRpcTransportFailure('TIMEOUT');
}

function unavailableFailure(): BalanceJsonRpcTransportFailure {
  return new BalanceJsonRpcTransportFailure('UNAVAILABLE');
}

function permanentFailure(): BalanceJsonRpcTransportFailure {
  return new BalanceJsonRpcTransportFailure('PERMANENT');
}
