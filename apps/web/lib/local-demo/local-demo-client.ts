import {
  AuthenticationUnauthenticatedError,
  readAuthenticationCsrfToken,
  type AuthenticationFetch,
} from '@/lib/authentication';
import { isAbortFailure, readBoundedJson, retryAfterSeconds } from '@/lib/authentication/http';
import { assertWalletAccount, type ChainId } from '@/lib/wallets/wallet-adapter';

import {
  parseLocalDemoPortfolioResponse,
  type LocalDemoBalanceApiResponse,
} from './local-demo-portfolio-response';

export const LOCAL_DEMO_WALLETS_PATH = '/api/v1/local-demo/wallets';
export const LOCAL_DEMO_PORTFOLIO_PATH = '/api/v1/local-demo/portfolio';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const MAX_REGISTERED_WALLETS = 2;
const LOCAL_DEMO_CONNECTOR_NETWORKS = Object.freeze({
  EVM: 'eip155:11155111',
  SOLANA: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
} as const);

export type LocalDemoWalletNamespace = 'EVM' | 'SOLANA';
export type LocalDemoApiErrorCode =
  'CONFLICT' | 'INVALID_RESPONSE' | 'UNAUTHENTICATED' | 'UNAVAILABLE';

export class LocalDemoApiError extends Error {
  constructor(
    readonly code: LocalDemoApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      code === 'UNAUTHENTICATED'
        ? 'Authentication is required.'
        : code === 'CONFLICT'
          ? 'The local demo wallet is already in use.'
          : 'The local demo is unavailable.',
    );
    this.name = 'LocalDemoApiError';
  }
}

export interface LocalDemoWalletProjection {
  readonly connectionId: string;
  readonly walletId: string;
  readonly label: string;
  readonly namespace: LocalDemoWalletNamespace;
  readonly chainId: ChainId;
  readonly address: string;
  readonly registeredAt: string;
}

export interface LocalDemoApiClientOptions {
  readonly cookieHeader?: string | (() => string);
  readonly fetch?: AuthenticationFetch;
}

function fail(code: LocalDemoApiErrorCode = 'INVALID_RESPONSE', retry?: number): never {
  throw new LocalDemoApiError(code, retry);
}

function ownDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.length ||
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expectedKeys.includes(key),
      ) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      return fail();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error) {
    if (error instanceof LocalDemoApiError) throw error;
    return fail();
  }
}

function safeText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    FORBIDDEN_TEXT.test(value)
  ) {
    return fail();
  }
  return value;
}

function parseProjection(value: unknown): LocalDemoWalletProjection {
  const record = ownDataRecord(value, [
    'connectionId',
    'walletId',
    'label',
    'namespace',
    'chainId',
    'address',
    'registeredAt',
  ]);
  const connectionId = safeText(record.connectionId, 256);
  const walletId = safeText(record.walletId, 36);
  const label = safeText(record.label, 64);
  const chainId = safeText(record.chainId, 96);
  const address = safeText(record.address, 128);
  const registeredAt = safeText(record.registeredAt, 24);
  if (!UUID_V4.test(connectionId) || !UUID_V4.test(walletId) || connectionId !== walletId) {
    return fail();
  }
  if (record.namespace !== 'EVM' && record.namespace !== 'SOLANA') return fail();
  if (chainId !== LOCAL_DEMO_CONNECTOR_NETWORKS[record.namespace]) return fail();
  const registeredDate = new Date(registeredAt);
  if (
    !CANONICAL_TIMESTAMP.test(registeredAt) ||
    !Number.isFinite(registeredDate.getTime()) ||
    registeredDate.toISOString() !== registeredAt
  ) {
    return fail();
  }
  const adapterNamespace = record.namespace === 'EVM' ? 'eip155' : 'solana';
  try {
    assertWalletAccount({ chainId, address }, adapterNamespace);
  } catch {
    return fail();
  }
  if (record.namespace === 'EVM' && address !== address.toLowerCase()) return fail();
  return Object.freeze({
    connectionId,
    walletId,
    label,
    namespace: record.namespace,
    chainId: chainId as ChainId,
    address,
    registeredAt,
  });
}

export function parseLocalDemoWallets(value: unknown): readonly LocalDemoWalletProjection[] {
  try {
    if (!Array.isArray(value) || value.length > MAX_REGISTERED_WALLETS) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [...value.map((_, index) => String(index)), 'length'];
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expectedKeys.includes(key),
      ) ||
      expectedKeys.some(
        (key) => !Object.hasOwn(descriptors, key) || !('value' in descriptors[key]!),
      )
    ) {
      return fail();
    }
    const wallets = Object.freeze(value.map((wallet) => parseProjection(wallet)));
    if (
      new Set(wallets.map(({ connectionId }) => connectionId)).size !== wallets.length ||
      new Set(wallets.map(({ walletId }) => walletId)).size !== wallets.length ||
      new Set(wallets.map(({ namespace }) => namespace)).size !== wallets.length ||
      new Set(wallets.map(({ chainId, address }) => `${chainId}\0${address}`)).size !==
        wallets.length
    ) {
      return fail();
    }
    return wallets;
  } catch (error) {
    if (error instanceof LocalDemoApiError) throw error;
    return fail();
  }
}

function browserCookieHeader(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

function requestInit(
  method: 'GET' | 'POST' | 'DELETE',
  signal: AbortSignal | undefined,
  body?: string,
  csrfToken?: string,
): RequestInit {
  return {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfToken === undefined ? {} : { 'X-CSRF-Token': csrfToken }),
    },
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal }),
  };
}

export class LocalDemoApiClient {
  readonly #cookieHeader: string | (() => string);
  readonly #fetch: AuthenticationFetch;

  constructor(options: LocalDemoApiClientOptions = {}) {
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  }

  async listWallets(signal?: AbortSignal): Promise<readonly LocalDemoWalletProjection[]> {
    const response = await this.#request(
      LOCAL_DEMO_WALLETS_PATH,
      requestInit('GET', signal),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    return parseLocalDemoWallets(await this.#json(response));
  }

  async registerWallet(
    namespace: LocalDemoWalletNamespace,
    signal?: AbortSignal,
  ): Promise<LocalDemoWalletProjection> {
    const response = await this.#unsafeRequest('POST', JSON.stringify({ namespace }), signal);
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 409) return fail('CONFLICT');
    if (response.status !== 201) {
      return fail('UNAVAILABLE', retryAfterSeconds(response));
    }
    const projection = parseProjection(await this.#json(response));
    if (projection.namespace !== namespace) return fail();
    return projection;
  }

  async disconnectWallet(connectionId: string, signal?: AbortSignal): Promise<void> {
    if (!UUID_V4.test(connectionId)) return fail();
    const response = await this.#unsafeRequest('DELETE', JSON.stringify({ connectionId }), signal);
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 204) return fail('UNAVAILABLE', retryAfterSeconds(response));
  }

  async readPortfolio(signal?: AbortSignal): Promise<LocalDemoBalanceApiResponse> {
    const response = await this.#request(
      LOCAL_DEMO_PORTFOLIO_PATH,
      requestInit('GET', signal),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parseLocalDemoPortfolioResponse(await this.#json(response));
    } catch {
      return fail();
    }
  }

  async #unsafeRequest(
    method: 'POST' | 'DELETE',
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    let csrfToken: string;
    try {
      const cookieHeader =
        typeof this.#cookieHeader === 'function' ? this.#cookieHeader() : this.#cookieHeader;
      csrfToken = readAuthenticationCsrfToken(cookieHeader);
    } catch {
      return fail('UNAUTHENTICATED');
    }
    return this.#request(
      LOCAL_DEMO_WALLETS_PATH,
      requestInit(method, signal, body, csrfToken),
      signal,
    );
  }

  async #request(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    try {
      return await this.#fetch(path, init);
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      return fail('UNAVAILABLE');
    }
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return await readBoundedJson(response);
    } catch {
      return fail();
    }
  }
}

export function isLocalDemoUnauthenticated(error: unknown): boolean {
  return (
    (error instanceof LocalDemoApiError && error.code === 'UNAUTHENTICATED') ||
    error instanceof AuthenticationUnauthenticatedError
  );
}
