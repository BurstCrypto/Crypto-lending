import type { SmartLendingExternalFeedConfig } from './smart-lending-external-feed.config';
import { AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST } from '../aave/aave-v3-market-feed.query';
import {
  SmartLendingExternalFeedDestination,
  type LifiQuoteQuery,
  type SmartLendingExternalFeedGetDestination,
  type SmartLendingExternalFeedQueryByDestination,
} from './smart-lending-external-feed.types';

export const SMART_LENDING_EXTERNAL_FEED_CLIENT = Symbol('SMART_LENDING_EXTERNAL_FEED_CLIENT');
export const AAVE_V3_ETHEREUM_MARKET_EXTERNAL_FEED_CLIENT = Symbol(
  'AAVE_V3_ETHEREUM_MARKET_EXTERNAL_FEED_CLIENT',
);

export interface AaveV3EthereumMarketExternalFeedClient {
  readEthereumCoreMarket(): Promise<unknown>;
}

export type SmartLendingExternalFeedErrorCode =
  | 'FEEDS_DISABLED'
  | 'DESTINATION_DISABLED'
  | 'INVALID_DESTINATION'
  | 'INVALID_QUERY'
  | 'REQUEST_FAILED'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE';

export class SmartLendingExternalFeedError extends Error {
  constructor(readonly code: SmartLendingExternalFeedErrorCode) {
    super('Smart-lending external feed is unavailable');
    this.name = 'SmartLendingExternalFeedError';
  }
}

export interface SmartLendingExternalFeedClient {
  get<Destination extends SmartLendingExternalFeedGetDestination>(
    destination: Destination,
    query: SmartLendingExternalFeedQueryByDestination[Destination],
  ): Promise<unknown>;
}

interface DestinationPolicy {
  readonly endpoint: string;
  readonly timeoutMilliseconds: number;
  readonly responseMaximumBytes: number;
}

const DESTINATION_POLICIES: Readonly<
  Record<SmartLendingExternalFeedDestination, DestinationPolicy>
> = Object.freeze({
  [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: Object.freeze({
    endpoint: 'https://api.v3.aave.com/graphql',
    timeoutMilliseconds: 7_000,
    responseMaximumBytes: 2 * 1_024 * 1_024,
  }),
  [SmartLendingExternalFeedDestination.DefiLlamaYields]: Object.freeze({
    endpoint: 'https://yields.llama.fi/pools',
    timeoutMilliseconds: 10_000,
    responseMaximumBytes: 32 * 1_024 * 1_024,
  }),
  [SmartLendingExternalFeedDestination.LifiQuote]: Object.freeze({
    endpoint: 'https://li.quest/v1/quote',
    timeoutMilliseconds: 7_000,
    responseMaximumBytes: 1_024 * 1_024,
  }),
});

const LIFI_KEYS = Object.freeze([
  'fromChain',
  'toChain',
  'fromToken',
  'toToken',
  'fromAmount',
  'fromAddress',
  'toAddress',
  'slippage',
  'integrator',
  'allowBridges',
  'denyExchanges',
  'allowDestinationCall',
  'order',
] as const);
const LIFI_REQUIRED_KEYS = Object.freeze([
  'fromChain',
  'toChain',
  'fromToken',
  'toToken',
  'fromAmount',
  'fromAddress',
  'toAddress',
  'slippage',
  'integrator',
  'allowBridges',
  'denyExchanges',
  'allowDestinationCall',
  'order',
] as const);
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const ATOMIC_AMOUNT = /^[1-9][0-9]{0,77}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const BRIDGE_LIST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:,[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,15}$/u;
const RESERVED_TOOL_KEYWORDS = new Set(['all', 'none', 'default']);
const MAX_RESPONSE_CHUNKS = 4_096;

function unavailable(code: SmartLendingExternalFeedErrorCode): never {
  throw new SmartLendingExternalFeedError(code);
}

function sanitizedFailure(error: unknown, fallback: SmartLendingExternalFeedErrorCode): never {
  let code: SmartLendingExternalFeedErrorCode | undefined;
  try {
    if (
      error instanceof SmartLendingExternalFeedError &&
      Object.getPrototypeOf(error) === SmartLendingExternalFeedError.prototype
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      if (
        descriptor &&
        'value' in descriptor &&
        typeof descriptor.value === 'string' &&
        [
          'FEEDS_DISABLED',
          'DESTINATION_DISABLED',
          'INVALID_DESTINATION',
          'INVALID_QUERY',
          'REQUEST_FAILED',
          'INVALID_RESPONSE',
          'RESPONSE_TOO_LARGE',
        ].includes(descriptor.value)
      ) {
        code = descriptor.value as SmartLendingExternalFeedErrorCode;
      }
    }
  } catch {
    // Hostile thrown values cannot escape this boundary through reflection.
  }
  return unavailable(code ?? fallback);
}

function ownDataRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return unavailable('INVALID_QUERY');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return unavailable('INVALID_QUERY');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return unavailable('INVALID_QUERY');
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return unavailable('INVALID_QUERY');
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    return sanitizedFailure(error, 'INVALID_QUERY');
  }
}

function ethereum(chain: unknown): boolean {
  return chain === '1';
}

function solana(chain: unknown): boolean {
  return chain === 'SOL';
}

function addressForChain(value: unknown, chain: unknown): value is string {
  return (
    typeof value === 'string' &&
    ((ethereum(chain) && EVM_ADDRESS.test(value)) || (solana(chain) && SOLANA_ADDRESS.test(value)))
  );
}

function explicitBridgeList(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    BRIDGE_LIST.test(value) &&
    value
      .split(',')
      .every((bridgeProviderId) => !RESERVED_TOOL_KEYWORDS.has(bridgeProviderId.toLowerCase()))
  );
}

function validateLifiQuery(value: unknown): LifiQuoteQuery {
  const record = ownDataRecord(value);
  const keys = Object.keys(record);
  if (
    LIFI_REQUIRED_KEYS.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !LIFI_KEYS.includes(key as (typeof LIFI_KEYS)[number])) ||
    !(
      (ethereum(record.fromChain) && solana(record.toChain)) ||
      (solana(record.fromChain) && ethereum(record.toChain))
    ) ||
    typeof record.fromToken !== 'string' ||
    !TOKEN.test(record.fromToken) ||
    typeof record.toToken !== 'string' ||
    !TOKEN.test(record.toToken) ||
    typeof record.fromAmount !== 'string' ||
    !ATOMIC_AMOUNT.test(record.fromAmount) ||
    !addressForChain(record.fromAddress, record.fromChain) ||
    !addressForChain(record.toAddress, record.toChain) ||
    record.slippage !== '0.005' ||
    record.integrator !== 'crypto-lending' ||
    !explicitBridgeList(record.allowBridges) ||
    record.denyExchanges !== 'all' ||
    record.allowDestinationCall !== 'false' ||
    record.order !== 'CHEAPEST'
  ) {
    return unavailable('INVALID_QUERY');
  }
  return Object.freeze({ ...record }) as unknown as LifiQuoteQuery;
}

function queryParameters(
  destination: SmartLendingExternalFeedDestination,
  value: unknown,
): URLSearchParams {
  if (destination === SmartLendingExternalFeedDestination.DefiLlamaYields) {
    if (Object.keys(ownDataRecord(value)).length !== 0) return unavailable('INVALID_QUERY');
    return new URLSearchParams();
  }
  if (destination !== SmartLendingExternalFeedDestination.LifiQuote) {
    return unavailable('INVALID_DESTINATION');
  }
  const query = validateLifiQuery(value);
  const parameters = new URLSearchParams();
  for (const key of LIFI_KEYS) {
    const parameter = query[key];
    if (parameter !== undefined) parameters.set(key, parameter);
  }
  return parameters;
}

function jsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup failure never changes the sanitized external-feed error contract.
  }
}

function parseJsonWithoutDuplicateKeys(text: string): unknown {
  let index = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;

  const invalid = (): never => unavailable('INVALID_RESPONSE');
  const whitespace = (): void => {
    while (
      text[index] === ' ' ||
      text[index] === '\t' ||
      text[index] === '\r' ||
      text[index] === '\n'
    ) {
      index += 1;
    }
  };
  const string = (): string => {
    if (text[index] !== '"') return invalid();
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text.charCodeAt(index);
      if (character === 0x22) {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          return invalid();
        }
      }
      if (character < 0x20) return invalid();
      if (character !== 0x5c) {
        index += 1;
        continue;
      }
      index += 1;
      const escaped = text[index];
      if (escaped === 'u') {
        if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) return invalid();
        index += 5;
        continue;
      }
      if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped ?? '')) return invalid();
      index += 1;
    }
    return invalid();
  };
  const number = (): void => {
    numberPattern.lastIndex = index;
    if (!numberPattern.exec(text)) return invalid();
    index = numberPattern.lastIndex;
  };
  const value = (depth: number): void => {
    if (depth > 64) return invalid();
    whitespace();
    if (text[index] === '"') {
      string();
      return;
    }
    if (text[index] === '{') {
      object(depth + 1);
      return;
    }
    if (text[index] === '[') {
      list(depth + 1);
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    number();
  };
  const object = (depth: number): void => {
    index += 1;
    whitespace();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set<string>();
    while (index < text.length) {
      const key = string();
      if (keys.has(key)) return invalid();
      keys.add(key);
      whitespace();
      if (text[index] !== ':') return invalid();
      index += 1;
      value(depth);
      whitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') return invalid();
      index += 1;
      whitespace();
    }
    return invalid();
  };
  const list = (depth: number): void => {
    index += 1;
    whitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      value(depth);
      whitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') return invalid();
      index += 1;
      whitespace();
    }
    return invalid();
  };

  whitespace();
  value(0);
  whitespace();
  if (index !== text.length) return invalid();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return invalid();
  }
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  let chunkCount = 0;
  let cancellation: Promise<void> | undefined;
  const cancelLockedReader = (): Promise<void> => {
    cancellation ??= (async () => {
      try {
        await reader?.cancel();
      } catch {
        // Cleanup failure never changes the classified response failure.
      }
    })();
    return cancellation;
  };
  const cancelReader = (): void => {
    void cancelLockedReader();
  };
  try {
    if (!jsonContentType(response.headers.get('content-type'))) {
      await cancelResponseBody(response);
      return unavailable('INVALID_RESPONSE');
    }
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
    ) {
      await cancelResponseBody(response);
      return unavailable('RESPONSE_TOO_LARGE');
    }
    const body = response.body;
    if (body === null) return unavailable('INVALID_RESPONSE');
    reader = body.getReader();
    signal.addEventListener('abort', cancelReader, { once: true });
    if (signal.aborted) {
      await cancelLockedReader();
      return unavailable('REQUEST_FAILED');
    }
    for (;;) {
      const next = await reader.read();
      if (next.done === true) break;
      if (next.done !== false || !(next.value instanceof Uint8Array)) {
        return unavailable('INVALID_RESPONSE');
      }
      chunkCount += 1;
      if (chunkCount > MAX_RESPONSE_CHUNKS) {
        await cancelLockedReader();
        return unavailable('RESPONSE_TOO_LARGE');
      }
      const chunkLength = next.value.byteLength;
      if (chunkLength > maximumBytes - length) {
        await cancelLockedReader();
        return unavailable('RESPONSE_TOO_LARGE');
      }
      const chunk = Uint8Array.from(next.value);
      if (chunk.byteLength === 0) continue;
      length += chunk.byteLength;
      chunks.push(chunk);
    }
    if (signal.aborted) return unavailable('REQUEST_FAILED');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return parseJsonWithoutDuplicateKeys(text);
  } catch (error) {
    return sanitizedFailure(error, 'INVALID_RESPONSE');
  } finally {
    signal.removeEventListener('abort', cancelReader);
    try {
      reader?.releaseLock();
    } catch {
      // Cleanup failure never changes the sanitized external-feed error contract.
    }
  }
}

interface LockedJsonRequest {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

async function requestJson(
  fetchImplementation: typeof fetch,
  endpoint: URL,
  policy: DestinationPolicy,
  request: LockedJsonRequest,
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const expectedEndpoint = endpoint.href;
  const operation = async (): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImplementation(new URL(expectedEndpoint), {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
    } catch {
      return unavailable('REQUEST_FAILED');
    }
    try {
      const status = response.status;
      const redirected = response.redirected;
      const responseUrl = response.url;
      if (status !== 200 || redirected || responseUrl !== expectedEndpoint) {
        await cancelResponseBody(response);
        return unavailable('INVALID_RESPONSE');
      }
      return await boundedJson(response, policy.responseMaximumBytes, controller.signal);
    } catch (error) {
      return sanitizedFailure(error, 'INVALID_RESPONSE');
    }
  };
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new SmartLendingExternalFeedError('REQUEST_FAILED'));
    }, policy.timeoutMilliseconds);
  });
  try {
    return await Promise.race([operation(), timedOut]);
  } catch (error) {
    return sanitizedFailure(error, 'REQUEST_FAILED');
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export class FixedSmartLendingExternalFeedClient
  implements SmartLendingExternalFeedClient, AaveV3EthereumMarketExternalFeedClient
{
  constructor(
    private readonly config: SmartLendingExternalFeedConfig,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {}

  async get<Destination extends SmartLendingExternalFeedGetDestination>(
    destination: Destination,
    query: SmartLendingExternalFeedQueryByDestination[Destination],
  ): Promise<unknown> {
    const policy = this.enabledPolicy(destination);
    const endpoint = new URL(policy.endpoint);
    endpoint.search = queryParameters(destination, query).toString();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (
      destination === SmartLendingExternalFeedDestination.LifiQuote &&
      this.config.mode === 'enabled' &&
      this.config.lifiApiKey !== null
    ) {
      headers['x-lifi-api-key'] = this.config.lifiApiKey;
    }

    return requestJson(this.fetchImplementation, endpoint, policy, {
      method: 'GET',
      headers,
    });
  }

  async readEthereumCoreMarket(): Promise<unknown> {
    const policy = this.enabledPolicy(SmartLendingExternalFeedDestination.AaveV3EthereumMarket);
    const endpoint = new URL(policy.endpoint);
    const body = JSON.stringify(AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST);
    return requestJson(this.fetchImplementation, endpoint, policy, {
      method: 'POST',
      headers: Object.freeze({
        accept: 'application/json',
        'content-type': 'application/json',
      }),
      body,
    });
  }

  private enabledPolicy(destination: SmartLendingExternalFeedDestination): DestinationPolicy {
    if (this.config.mode !== 'enabled') return unavailable('FEEDS_DISABLED');
    if (!Object.hasOwn(DESTINATION_POLICIES, destination)) {
      return unavailable('INVALID_DESTINATION');
    }
    if (
      !Object.hasOwn(this.config.killSwitches, destination) ||
      this.config.killSwitches[destination] !== false
    ) {
      return unavailable('DESTINATION_DISABLED');
    }
    return DESTINATION_POLICIES[destination];
  }
}
