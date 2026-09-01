import {
  type AuthenticationFetch,
  isAbortFailure,
  readBoundedJson,
  retryAfterSeconds,
} from '../../authentication/http';
import { readAuthenticationCsrfToken } from '../../authentication/session-client';
import {
  assertOwnershipChallenge,
  assertOwnershipSignatureMatchesChallenge,
  assertWalletAccount,
  assertWalletConnection,
  type SiweOwnershipChallenge,
  type SiweOwnershipSignature,
  type WalletConnection,
} from '../wallet-adapter';
import type { InjectedEip1193WalletAdapter } from './adapter';
import type { EvmNetworkEnvironment } from './networks';

export const WALLET_OWNERSHIP_CHALLENGE_PATH = '/api/v1/wallets/ownership-challenges';
export const WALLET_OWNERSHIP_PROOF_PATH = '/api/v1/wallets/ownership-proofs';

export const WALLET_OWNERSHIP_HANDOFF_ERROR_CODES = Object.freeze({
  conflict: 'WALLET_OWNERSHIP_CONFLICT',
  rejected: 'WALLET_OWNERSHIP_REJECTED',
  unauthenticated: 'WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED',
  unavailable: 'WALLET_OWNERSHIP_UNAVAILABLE',
} as const);

export type WalletOwnershipHandoffErrorCode =
  (typeof WALLET_OWNERSHIP_HANDOFF_ERROR_CODES)[keyof typeof WALLET_OWNERSHIP_HANDOFF_ERROR_CODES];

const ERROR_MESSAGES: Readonly<Record<WalletOwnershipHandoffErrorCode, string>> = Object.freeze({
  WALLET_OWNERSHIP_CONFLICT: 'Wallet ownership conflicts with an existing registration',
  WALLET_OWNERSHIP_REJECTED: 'Wallet ownership request was rejected',
  WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED: 'Wallet ownership requires authentication',
  WALLET_OWNERSHIP_UNAVAILABLE: 'Wallet ownership service is unavailable',
});

export class WalletOwnershipHandoffError extends Error {
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: WalletOwnershipHandoffErrorCode,
    retryAfterSeconds?: number,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'WalletOwnershipHandoffError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface IssuedEvmOwnershipChallenge extends SiweOwnershipChallenge {
  readonly registryEnvironment: EvmNetworkEnvironment;
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export interface RegisteredEvmWalletResult {
  readonly status: 'registered' | 'already_registered';
  readonly walletId: string;
  readonly chainId: `eip155:${string}`;
  readonly address: string;
  readonly registeredAt: string;
  readonly registryEnvironment: EvmNetworkEnvironment;
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export interface IssueEvmOwnershipChallengeInput {
  readonly chainId: `eip155:${string}`;
  readonly address: string;
  readonly registryEnvironment: EvmNetworkEnvironment;
}

export interface SubmitEvmOwnershipProofInput {
  readonly challenge: IssuedEvmOwnershipChallenge;
  readonly signature: SiweOwnershipSignature;
}

export interface EvmWalletOwnershipClient {
  issueChallenge(
    input: IssueEvmOwnershipChallengeInput,
    signal?: AbortSignal,
  ): Promise<IssuedEvmOwnershipChallenge>;
  submitProof(
    input: SubmitEvmOwnershipProofInput,
    signal?: AbortSignal,
  ): Promise<RegisteredEvmWalletResult>;
}

export interface EvmWalletOwnershipHttpClientOptions {
  readonly fetch?: AuthenticationFetch;
  readonly cookieHeader?: string | (() => string);
  readonly publicOrigin?: string;
}

const CHALLENGE_RESPONSE_KEYS = new Set([
  'version',
  'challengeId',
  'messageFormat',
  'chainId',
  'address',
  'accountId',
  'message',
  'expiresAt',
  'registryEnvironment',
  'registryVersion',
  'registryFingerprintSha256',
]);
const REGISTRATION_RESPONSE_KEYS = new Set([
  'status',
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
const REGISTRY_FINGERPRINT = /^[0-9a-f]{64}$/u;
const NONCE = /^[a-zA-Z0-9]{8,64}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const OWNERSHIP_STATEMENT =
  'Verify this wallet for Crypto Lending. This proof does not authorize login, transactions, transfers, or loans.';
const POLICY_RESOURCE = '- urn:crypto-lending:wallet-ownership:v1';
const SUBJECT_RESOURCE = /^- urn:crypto-lending:wallet-subject-binding:hmac-sha-256:[0-9a-f]{64}$/u;
const OPERATION_RESOURCE = '- urn:crypto-lending:wallet-operation:register-wallet';

function fail(
  code: WalletOwnershipHandoffErrorCode = WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable,
  retry?: number,
): never {
  throw new WalletOwnershipHandoffError(code, retry);
}

function ownRecord(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !keys.has(key)) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor)) ||
      Object.keys(descriptors).length !== keys.size
    ) {
      fail();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error) {
    if (error instanceof WalletOwnershipHandoffError) throw error;
    fail();
  }
}

function canonicalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_DATE_TIME.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function positiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 1 && value <= 32_767;
}

function exactMessageLine(lines: readonly string[], prefix: string): string {
  const matches = lines.filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) fail();
  return matches[0]!.slice(prefix.length);
}

function normalizedOrigin(value: string | undefined): string {
  if (value === undefined) fail();
  try {
    const parsed = new URL(value);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
      parsed.origin !== value ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      fail();
    }
    return parsed.origin;
  } catch (error) {
    if (error instanceof WalletOwnershipHandoffError) throw error;
    fail();
  }
}

function parseChallenge(
  value: unknown,
  expected: IssueEvmOwnershipChallengeInput,
  publicOrigin: string,
): IssuedEvmOwnershipChallenge {
  const record = ownRecord(value, CHALLENGE_RESPONSE_KEYS);
  const registryEnvironment = record.registryEnvironment;
  if (
    record.version !== 1 ||
    record.messageFormat !== 'SIWE' ||
    typeof record.challengeId !== 'string' ||
    !UUID_V4.test(record.challengeId) ||
    record.chainId !== expected.chainId ||
    typeof record.address !== 'string' ||
    !EVM_ADDRESS.test(record.address) ||
    record.address !== expected.address.toLowerCase() ||
    typeof record.accountId !== 'string' ||
    !UUID_V4.test(record.accountId) ||
    typeof record.message !== 'string' ||
    record.message.length < 1 ||
    record.message.length > 4_096 ||
    /[\0\r]/u.test(record.message) ||
    !canonicalDateTime(record.expiresAt) ||
    (registryEnvironment !== 'MAINNET' && registryEnvironment !== 'TESTNET') ||
    registryEnvironment !== expected.registryEnvironment ||
    !positiveVersion(record.registryVersion) ||
    typeof record.registryFingerprintSha256 !== 'string' ||
    !REGISTRY_FINGERPRINT.test(record.registryFingerprintSha256)
  ) {
    fail();
  }

  const lines = record.message.split('\n');
  if (
    lines.length !== 17 ||
    lines[1]?.toLowerCase() !== record.address ||
    lines[2] !== '' ||
    lines[3] !== OWNERSHIP_STATEMENT ||
    lines[4] !== '' ||
    lines[13] !== 'Resources:' ||
    lines[14] !== POLICY_RESOURCE ||
    typeof lines[15] !== 'string' ||
    !SUBJECT_RESOURCE.test(lines[15]) ||
    lines[16] !== OPERATION_RESOURCE
  ) {
    fail();
  }
  if (exactMessageLine(lines, 'Chain ID: ') !== expected.chainId.slice('eip155:'.length)) fail();
  if (exactMessageLine(lines, 'Version: ') !== '1') fail();
  if (exactMessageLine(lines, 'Expiration Time: ') !== record.expiresAt) fail();
  if (exactMessageLine(lines, 'Request ID: ') !== record.challengeId) fail();
  const issuedAt = exactMessageLine(lines, 'Issued At: ');
  if (
    !canonicalDateTime(issuedAt) ||
    exactMessageLine(lines, 'Not Before: ') !== issuedAt ||
    Date.parse(issuedAt) >= Date.parse(record.expiresAt)
  ) {
    fail();
  }
  const nonce = exactMessageLine(lines, 'Nonce: ');
  if (!NONCE.test(nonce)) fail();

  const origin = normalizedOrigin(publicOrigin);
  const host = new URL(origin).host;
  if (
    lines[0] !== `${host} wants you to sign in with your Ethereum account:` ||
    exactMessageLine(lines, 'URI: ') !== `${origin}/`
  ) {
    fail();
  }

  const challenge = Object.freeze({
    id: record.challengeId,
    format: 'siwe' as const,
    chainId: record.chainId,
    address: record.address,
    nonce,
    expiresAt: record.expiresAt,
    message: record.message,
    registryEnvironment,
    registryVersion: record.registryVersion,
    registryFingerprintSha256: record.registryFingerprintSha256,
  });
  try {
    assertOwnershipChallenge(challenge);
  } catch {
    fail();
  }
  return challenge;
}

function parseRegistrationResult(
  value: unknown,
  expected: SubmitEvmOwnershipProofInput,
  responseStatus: number,
): RegisteredEvmWalletResult {
  const record = ownRecord(value, REGISTRATION_RESPONSE_KEYS);
  const expectedStatus = responseStatus === 201 ? 'registered' : 'already_registered';
  const status = record.status;
  const chainId = record.chainId;
  const registryEnvironment = record.registryEnvironment;
  if (
    (status !== 'registered' && status !== 'already_registered') ||
    status !== expectedStatus ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    typeof chainId !== 'string' ||
    chainId !== expected.challenge.chainId ||
    typeof record.address !== 'string' ||
    !EVM_ADDRESS.test(record.address) ||
    record.address !== expected.challenge.address.toLowerCase() ||
    !canonicalDateTime(record.registeredAt) ||
    (registryEnvironment !== 'MAINNET' && registryEnvironment !== 'TESTNET') ||
    registryEnvironment !== expected.challenge.registryEnvironment ||
    record.registryVersion !== expected.challenge.registryVersion ||
    record.registryFingerprintSha256 !== expected.challenge.registryFingerprintSha256
  ) {
    fail();
  }
  return Object.freeze({
    status,
    walletId: record.walletId,
    chainId: chainId as `eip155:${string}`,
    address: record.address,
    registeredAt: record.registeredAt,
    registryEnvironment,
    registryVersion: record.registryVersion,
    registryFingerprintSha256: record.registryFingerprintSha256,
  });
}

function browserCookieHeader(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

function browserPublicOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}

function requestInit(
  csrfToken: string,
  body: string,
  signal: AbortSignal | undefined,
): RequestInit {
  return {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    redirect: 'error',
    body,
    ...(signal === undefined ? {} : { signal }),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException('Request aborted', 'AbortError');
}

export class HttpEvmWalletOwnershipClient implements EvmWalletOwnershipClient {
  readonly #fetch: AuthenticationFetch;
  readonly #cookieHeader: string | (() => string);
  readonly #publicOrigin: string;

  constructor(options: EvmWalletOwnershipHttpClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
    this.#publicOrigin = normalizedOrigin(options.publicOrigin ?? browserPublicOrigin());
  }

  async issueChallenge(
    input: IssueEvmOwnershipChallengeInput,
    signal?: AbortSignal,
  ): Promise<IssuedEvmOwnershipChallenge> {
    try {
      assertWalletAccount({ chainId: input.chainId, address: input.address }, 'eip155');
    } catch {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
    }
    if (input.registryEnvironment !== 'MAINNET' && input.registryEnvironment !== 'TESTNET') {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
    }
    const response = await this.#post(
      WALLET_OWNERSHIP_CHALLENGE_PATH,
      JSON.stringify({ chainId: input.chainId, address: input.address.toLowerCase() }),
      signal,
    );
    if (response.status === 400) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
    if (response.status === 401) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated);
    if (response.status === 429 || response.status === 503) {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable, retryAfterSeconds(response));
    }
    if (response.status !== 201) fail();
    return parseChallenge(await this.#json(response), input, this.#publicOrigin);
  }

  async submitProof(
    input: SubmitEvmOwnershipProofInput,
    signal?: AbortSignal,
  ): Promise<RegisteredEvmWalletResult> {
    try {
      assertOwnershipSignatureMatchesChallenge(input.signature, input.challenge);
    } catch {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
    }
    const response = await this.#post(
      WALLET_OWNERSHIP_PROOF_PATH,
      JSON.stringify({
        kind: 'EVM_EIP191_EOA',
        challengeId: input.signature.challengeId,
        message: input.challenge.message,
        signature: input.signature.signature,
      }),
      signal,
    );
    if (response.status === 400) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
    if (response.status === 401) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated);
    if (response.status === 409) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.conflict);
    if (response.status === 503) {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable, retryAfterSeconds(response));
    }
    if (response.status !== 200 && response.status !== 201) fail();
    return parseRegistrationResult(await this.#json(response), input, response.status);
  }

  async #post(path: string, body: string, signal: AbortSignal | undefined): Promise<Response> {
    let csrfToken: string;
    try {
      const cookieHeader =
        typeof this.#cookieHeader === 'function' ? this.#cookieHeader() : this.#cookieHeader;
      csrfToken = readAuthenticationCsrfToken(cookieHeader);
    } catch {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated);
    }

    try {
      return await this.#fetch(path, requestInit(csrfToken, body, signal));
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      fail();
    }
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return await readBoundedJson(response);
    } catch {
      fail();
    }
  }
}

export interface CompleteEvmWalletOwnershipInput {
  readonly adapter: InjectedEip1193WalletAdapter;
  readonly connection: WalletConnection;
  readonly client: EvmWalletOwnershipClient;
  readonly signal?: AbortSignal;
}

/** Executes the exact KAN-56 issue -> sign -> submit handoff. */
export async function completeEvmWalletOwnershipRegistration(
  input: CompleteEvmWalletOwnershipInput,
): Promise<RegisteredEvmWalletResult> {
  try {
    assertWalletConnection(input.connection, 'eip155', input.adapter.connectorId);
  } catch {
    fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  }
  throwIfAborted(input.signal);

  const selected = input.connection.selectedAccount;
  if (!selected.chainId.startsWith('eip155:')) {
    fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  }
  const chainId = selected.chainId as `eip155:${string}`;
  const current = input.adapter.currentConnection();
  if (
    current === null ||
    current.connectionId !== input.connection.connectionId ||
    current.connectorId !== input.connection.connectorId ||
    current.selectedAccount.chainId !== chainId ||
    current.selectedAccount.address.toLowerCase() !== selected.address.toLowerCase()
  ) {
    fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  }
  const network = input.adapter.descriptor.supportedNetworks.find(
    (candidate) => candidate.chainId === chainId,
  );
  if (network === undefined) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  const challenge = await input.client.issueChallenge(
    {
      chainId,
      address: selected.address,
      registryEnvironment: network.environment,
    },
    input.signal,
  );
  throwIfAborted(input.signal);
  const signature = await input.adapter.signOwnershipChallenge(
    input.connection.connectionId,
    challenge,
  );
  if (signature.format !== 'siwe') fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  throwIfAborted(input.signal);
  return input.client.submitProof({ challenge, signature }, input.signal);
}
