import type { SmartLendingExternalFeedConfig } from './smart-lending-external-feed.config';
import {
  SmartLendingExternalFeedDestination,
  type LifiQuoteQuery,
  type SmartLendingExternalFeedQueryByDestination,
} from './smart-lending-external-feed.types';

export const SMART_LENDING_EXTERNAL_FEED_CLIENT = Symbol('SMART_LENDING_EXTERNAL_FEED_CLIENT');

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
  get<Destination extends SmartLendingExternalFeedDestination>(
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

function unavailable(code: SmartLendingExternalFeedErrorCode): never {
  throw new SmartLendingExternalFeedError(code);
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
    if (error instanceof SmartLendingExternalFeedError) throw error;
    return unavailable('INVALID_QUERY');
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

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
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
  if (response.body === null) return unavailable('INVALID_RESPONSE');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength === 0) continue;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        return unavailable('RESPONSE_TOO_LARGE');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof SmartLendingExternalFeedError) throw error;
    return unavailable('INVALID_RESPONSE');
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    return unavailable('INVALID_RESPONSE');
  }
}

export class FixedSmartLendingExternalFeedClient implements SmartLendingExternalFeedClient {
  constructor(
    private readonly config: SmartLendingExternalFeedConfig,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {}

  async get<Destination extends SmartLendingExternalFeedDestination>(
    destination: Destination,
    query: SmartLendingExternalFeedQueryByDestination[Destination],
  ): Promise<unknown> {
    if (this.config.mode !== 'enabled') return unavailable('FEEDS_DISABLED');
    if (!Object.hasOwn(DESTINATION_POLICIES, destination)) {
      return unavailable('INVALID_DESTINATION');
    }
    const policy = DESTINATION_POLICIES[destination];
    if (
      !Object.hasOwn(this.config.killSwitches, destination) ||
      this.config.killSwitches[destination] !== false
    ) {
      return unavailable('DESTINATION_DISABLED');
    }

    const endpoint = new URL(policy.endpoint);
    endpoint.search = queryParameters(destination, query).toString();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (
      destination === SmartLendingExternalFeedDestination.LifiQuote &&
      this.config.lifiApiKey !== null
    ) {
      headers['x-lifi-api-key'] = this.config.lifiApiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMilliseconds);
    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(endpoint, {
          method: 'GET',
          headers,
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
        if (
          response.status !== 200 ||
          response.redirected ||
          (response.url !== '' && response.url !== endpoint.href)
        ) {
          await cancelResponseBody(response);
          return unavailable('INVALID_RESPONSE');
        }
        return await boundedJson(response, policy.responseMaximumBytes);
      } catch (error) {
        if (error instanceof SmartLendingExternalFeedError) throw error;
        return unavailable('INVALID_RESPONSE');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
