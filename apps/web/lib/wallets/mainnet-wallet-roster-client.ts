import {
  isAbortFailure,
  readBoundedJson,
  retryAfterSeconds,
  type AuthenticationFetch,
} from '../authentication/http';
import { readAuthenticationCsrfToken } from '../authentication/session-client';
import {
  MAINNET_WALLET_NETWORKS,
  MAINNET_WALLET_REGISTRY,
  mainnetWalletAddressHint,
  type MainnetWalletNetworkId,
} from './mainnet-network-policy';
import { solanaPublicKeyBytesForAddress } from './wallet-adapter';

export const MAINNET_WALLET_ROSTER_PATH = '/api/v1/wallets';

const RESPONSE_KEYS = new Set(['version', 'wallets']);
const WALLET_KEYS = new Set([
  'walletId',
  'chainId',
  'address',
  'registeredAt',
  'registryEnvironment',
  'registryVersion',
  'registryFingerprintSha256',
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_WALLETS = 32;

export type MainnetWalletRosterErrorCode = 'INVALID_RESPONSE' | 'UNAUTHENTICATED' | 'UNAVAILABLE';

export class MainnetWalletRosterError extends Error {
  constructor(
    readonly code: MainnetWalletRosterErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code === 'UNAUTHENTICATED' ? 'Authentication is required.' : 'Wallet list unavailable.');
    this.name = 'MainnetWalletRosterError';
  }
}

export interface MainnetRegisteredWalletSummary {
  readonly walletId: string;
  readonly chainId: MainnetWalletNetworkId;
  readonly addressHint: string;
  readonly registeredAt: string;
}

export interface MainnetWalletRoster {
  readonly version: 1;
  readonly wallets: readonly MainnetRegisteredWalletSummary[];
}

export interface MainnetWalletRosterReader {
  readWallets(signal?: AbortSignal): Promise<MainnetWalletRoster>;
}

export interface MainnetWalletRosterClient extends MainnetWalletRosterReader {
  removeWallet(walletId: string, signal?: AbortSignal): Promise<void>;
}

export interface MainnetWalletRosterClientOptions {
  readonly fetch?: AuthenticationFetch;
  readonly cookieHeader?: string | (() => string);
}

function fail(code: MainnetWalletRosterErrorCode = 'INVALID_RESPONSE', retry?: number): never {
  throw new MainnetWalletRosterError(code, retry);
}

function exactRecord(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.size ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.has(key)) ||
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
    if (error instanceof MainnetWalletRosterError) throw error;
    return fail();
  }
}

function boundedArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAX_WALLETS) return fail();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = [
      ...Array.from({ length: value.length }, (_, index) => String(index)),
      'length',
    ];
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expected.includes(key),
      ) ||
      expected.some((key) => !Object.hasOwn(descriptors, key) || !('value' in descriptors[key]!))
    ) {
      return fail();
    }
    return expected
      .slice(0, -1)
      .map((key) => ('value' in descriptors[key]! ? descriptors[key]!.value : undefined));
  } catch (error) {
    if (error instanceof MainnetWalletRosterError) throw error;
    return fail();
  }
}

function canonicalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_DATE_TIME.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function mainnetChainId(value: unknown): MainnetWalletNetworkId {
  if (
    typeof value !== 'string' ||
    !MAINNET_WALLET_NETWORKS.some((network) => network.chainId === value)
  ) {
    return fail();
  }
  return value as MainnetWalletNetworkId;
}

function canonicalAddress(chainId: MainnetWalletNetworkId, value: unknown): string {
  if (typeof value !== 'string') return fail();
  if (chainId.startsWith('eip155:')) {
    if (!EVM_ADDRESS.test(value)) return fail();
    return value;
  }
  if (!SOLANA_ADDRESS.test(value)) return fail();
  try {
    if (solanaPublicKeyBytesForAddress(value).length !== 32) return fail();
  } catch {
    return fail();
  }
  return value;
}

function parseWallet(value: unknown): MainnetRegisteredWalletSummary & {
  readonly identity: string;
} {
  const record = exactRecord(value, WALLET_KEYS);
  const chainId = mainnetChainId(record.chainId);
  const address = canonicalAddress(chainId, record.address);
  if (
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    !canonicalDateTime(record.registeredAt) ||
    record.registryEnvironment !== MAINNET_WALLET_REGISTRY.environment ||
    record.registryVersion !== MAINNET_WALLET_REGISTRY.version ||
    record.registryFingerprintSha256 !== MAINNET_WALLET_REGISTRY.fingerprintSha256
  ) {
    return fail();
  }
  return Object.freeze({
    walletId: record.walletId,
    chainId,
    addressHint: mainnetWalletAddressHint(chainId, address),
    registeredAt: record.registeredAt,
    identity: `${chainId}\u0000${address}`,
  });
}

export function parseMainnetWalletRosterResponse(value: unknown): MainnetWalletRoster {
  const record = exactRecord(value, RESPONSE_KEYS);
  if (record.version !== 1) return fail();
  const parsed = boundedArray(record.wallets).map(parseWallet);
  if (
    new Set(parsed.map(({ walletId }) => walletId)).size !== parsed.length ||
    new Set(parsed.map(({ identity }) => identity)).size !== parsed.length
  ) {
    return fail();
  }
  return Object.freeze({
    version: 1,
    wallets: Object.freeze(
      parsed.map((wallet) =>
        Object.freeze({
          walletId: wallet.walletId,
          chainId: wallet.chainId,
          addressHint: wallet.addressHint,
          registeredAt: wallet.registeredAt,
        }),
      ),
    ),
  });
}

function readRequestInit(signal: AbortSignal | undefined): RequestInit {
  return {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  };
}

function removeRequestInit(csrfToken: string, signal: AbortSignal | undefined): RequestInit {
  return {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  };
}

function browserCookieHeader(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException('Request aborted', 'AbortError');
}

export class HttpMainnetWalletRosterClient implements MainnetWalletRosterClient {
  readonly #fetch: AuthenticationFetch;
  readonly #cookieHeader: string | (() => string);

  constructor(options: MainnetWalletRosterClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
  }

  async readWallets(signal?: AbortSignal): Promise<MainnetWalletRoster> {
    let response: Response;
    try {
      response = await this.#fetch(MAINNET_WALLET_ROSTER_PATH, readRequestInit(signal));
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      return fail('UNAVAILABLE');
    }
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 503) return fail('UNAVAILABLE', retryAfterSeconds(response));
    if (response.status !== 200) return fail('UNAVAILABLE');
    try {
      return parseMainnetWalletRosterResponse(await readBoundedJson(response));
    } catch (error) {
      if (error instanceof MainnetWalletRosterError) throw error;
      return fail('INVALID_RESPONSE');
    }
  }

  async removeWallet(walletId: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!UUID_V4.test(walletId)) return fail('UNAVAILABLE');

    let csrfToken: string;
    try {
      const cookieHeader =
        typeof this.#cookieHeader === 'function' ? this.#cookieHeader() : this.#cookieHeader;
      csrfToken = readAuthenticationCsrfToken(cookieHeader);
    } catch {
      return fail('UNAUTHENTICATED');
    }

    let response: Response;
    try {
      response = await this.#fetch(
        `${MAINNET_WALLET_ROSTER_PATH}/${walletId}`,
        removeRequestInit(csrfToken, signal),
      );
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      return fail('UNAVAILABLE');
    }

    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 429 || response.status === 503) {
      return fail('UNAVAILABLE', retryAfterSeconds(response));
    }
    if (response.status !== 204) return fail('UNAVAILABLE');
  }
}
