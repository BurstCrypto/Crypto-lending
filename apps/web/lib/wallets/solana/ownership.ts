import {
  type AuthenticationFetch,
  isAbortFailure,
  readBoundedJson,
  retryAfterSeconds,
} from '../../authentication/http';
import { readAuthenticationCsrfToken } from '../../authentication/session-client';
import { createRequestDeadline, type RequestDeadline } from '../../http/bounded-response';
import { MAINNET_WALLET_REGISTRY } from '../mainnet-network-policy';
import {
  WALLET_OWNERSHIP_CHALLENGE_PATH,
  WALLET_OWNERSHIP_HANDOFF_ERROR_CODES,
  WALLET_OWNERSHIP_PROOF_PATH,
  WalletOwnershipHandoffError,
  type WalletOwnershipHandoffErrorCode,
} from '../eip1193/ownership';
import {
  assertOwnershipChallenge,
  assertOwnershipSignatureMatchesChallenge,
  assertWalletConnection,
  toSolanaEd25519OwnershipProofWire,
  type OwnershipSignature,
  type SiwsMessageOwnershipChallenge,
  type SupportedSolanaCaipChainId,
  type WalletAdapter,
  type WalletConnection,
} from '../wallet-adapter';

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
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const REGISTRY_FINGERPRINT = /^[0-9a-f]{64}$/u;
const NONCE = /^[a-zA-Z0-9]{8,64}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const OWNERSHIP_STATEMENT =
  'Verify this wallet for Crypto Lending. This proof does not authorize login, transactions, transfers, or loans.';
const POLICY_RESOURCE = '- urn:crypto-lending:wallet-ownership:v1';
const SUBJECT_RESOURCE = /^- urn:crypto-lending:wallet-subject-binding:hmac-sha-256:[0-9a-f]{64}$/u;
const OPERATION_RESOURCE = '- urn:crypto-lending:wallet-operation:register-wallet';

export interface IssuedSolanaOwnershipChallenge extends SiwsMessageOwnershipChallenge {
  readonly chainId: SupportedSolanaCaipChainId;
  readonly registryEnvironment: 'MAINNET' | 'TESTNET';
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export interface RegisteredSolanaWalletResult {
  readonly status: 'registered' | 'already_registered';
  readonly walletId: string;
  readonly chainId: SupportedSolanaCaipChainId;
  readonly address: string;
  readonly registeredAt: string;
  readonly registryEnvironment: 'MAINNET' | 'TESTNET';
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export interface IssueSolanaOwnershipChallengeInput {
  readonly chainId: SupportedSolanaCaipChainId;
  readonly address: string;
  readonly registryEnvironment: 'MAINNET' | 'TESTNET';
}

export interface SubmitSolanaOwnershipProofInput {
  readonly challenge: IssuedSolanaOwnershipChallenge;
  readonly signature: OwnershipSignature;
}

export interface SolanaWalletOwnershipClient {
  issueChallenge(
    input: IssueSolanaOwnershipChallengeInput,
    signal?: AbortSignal,
  ): Promise<IssuedSolanaOwnershipChallenge>;
  submitProof(
    input: SubmitSolanaOwnershipProofInput,
    signal?: AbortSignal,
  ): Promise<RegisteredSolanaWalletResult>;
}

export interface SolanaWalletOwnershipHttpClientOptions {
  readonly fetch?: AuthenticationFetch;
  readonly cookieHeader?: string | (() => string);
  readonly publicOrigin?: string;
}

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
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 32_767;
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
  expected: IssueSolanaOwnershipChallengeInput,
  publicOrigin: string,
): IssuedSolanaOwnershipChallenge {
  const record = ownRecord(value, CHALLENGE_RESPONSE_KEYS);
  const registryEnvironment = record.registryEnvironment;
  if (
    record.version !== 1 ||
    record.messageFormat !== 'SIWS' ||
    typeof record.challengeId !== 'string' ||
    !UUID_V4.test(record.challengeId) ||
    record.chainId !== expected.chainId ||
    typeof record.address !== 'string' ||
    !SOLANA_ADDRESS.test(record.address) ||
    record.address !== expected.address ||
    record.accountId !== `${expected.chainId}:${expected.address}` ||
    typeof record.message !== 'string' ||
    record.message.length < 1 ||
    record.message.length > 4_096 ||
    /[\0\r]/u.test(record.message) ||
    !canonicalDateTime(record.expiresAt) ||
    (registryEnvironment !== 'MAINNET' && registryEnvironment !== 'TESTNET') ||
    registryEnvironment !== expected.registryEnvironment ||
    !positiveVersion(record.registryVersion) ||
    typeof record.registryFingerprintSha256 !== 'string' ||
    !REGISTRY_FINGERPRINT.test(record.registryFingerprintSha256) ||
    (registryEnvironment === MAINNET_WALLET_REGISTRY.environment &&
      (record.registryVersion !== MAINNET_WALLET_REGISTRY.version ||
        record.registryFingerprintSha256 !== MAINNET_WALLET_REGISTRY.fingerprintSha256))
  ) {
    fail();
  }

  const lines = record.message.split('\n');
  if (
    lines.length !== 17 ||
    lines[1] !== record.address ||
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
  if (exactMessageLine(lines, 'Chain ID: ') !== expected.chainId) fail();
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
    lines[0] !== `${host} wants you to sign in with your Solana account:` ||
    exactMessageLine(lines, 'URI: ') !== `${origin}/`
  ) {
    fail();
  }

  const challenge = Object.freeze({
    id: record.challengeId,
    format: 'siws-message' as const,
    chainId: expected.chainId,
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
  expected: SubmitSolanaOwnershipProofInput,
  responseStatus: number,
): RegisteredSolanaWalletResult {
  const record = ownRecord(value, REGISTRATION_RESPONSE_KEYS);
  const expectedStatus = responseStatus === 201 ? 'registered' : 'already_registered';
  const status = record.status;
  const registryEnvironment = record.registryEnvironment;
  if (
    (status !== 'registered' && status !== 'already_registered') ||
    status !== expectedStatus ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    record.chainId !== expected.challenge.chainId ||
    record.address !== expected.challenge.address ||
    !canonicalDateTime(record.registeredAt) ||
    (registryEnvironment !== 'MAINNET' && registryEnvironment !== 'TESTNET') ||
    registryEnvironment !== expected.challenge.registryEnvironment ||
    record.registryVersion !== expected.challenge.registryVersion ||
    record.registryFingerprintSha256 !== expected.challenge.registryFingerprintSha256 ||
    (registryEnvironment === MAINNET_WALLET_REGISTRY.environment &&
      (record.registryVersion !== MAINNET_WALLET_REGISTRY.version ||
        record.registryFingerprintSha256 !== MAINNET_WALLET_REGISTRY.fingerprintSha256))
  ) {
    fail();
  }
  return Object.freeze({
    status,
    walletId: record.walletId,
    chainId: expected.challenge.chainId,
    address: expected.challenge.address,
    registeredAt: record.registeredAt,
    registryEnvironment,
    registryVersion: expected.challenge.registryVersion,
    registryFingerprintSha256: expected.challenge.registryFingerprintSha256,
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

export class HttpSolanaWalletOwnershipClient implements SolanaWalletOwnershipClient {
  readonly #fetch: AuthenticationFetch;
  readonly #cookieHeader: string | (() => string);
  readonly #publicOrigin: string;

  constructor(options: SolanaWalletOwnershipHttpClientOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
    this.#publicOrigin = normalizedOrigin(options.publicOrigin ?? browserPublicOrigin());
  }

  async issueChallenge(
    input: IssueSolanaOwnershipChallengeInput,
    signal?: AbortSignal,
  ): Promise<IssuedSolanaOwnershipChallenge> {
    throwIfAborted(signal);
    const request = createRequestDeadline(signal);
    try {
      const response = await this.#post(
        WALLET_OWNERSHIP_CHALLENGE_PATH,
        JSON.stringify({ chainId: input.chainId, address: input.address }),
        request,
        signal,
      );
      if (response.status === 400) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
      if (response.status === 401) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated);
      if (response.status === 429 || response.status === 503) {
        fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable, retryAfterSeconds(response));
      }
      if (response.status !== 201) fail();
      return parseChallenge(await this.#json(response, request, signal), input, this.#publicOrigin);
    } finally {
      request.dispose();
    }
  }

  async submitProof(
    input: SubmitSolanaOwnershipProofInput,
    signal?: AbortSignal,
  ): Promise<RegisteredSolanaWalletResult> {
    let body: string;
    try {
      assertOwnershipSignatureMatchesChallenge(input.signature, input.challenge);
      body = JSON.stringify(toSolanaEd25519OwnershipProofWire(input.signature, input.challenge));
    } catch {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
    }
    const request = createRequestDeadline(signal);
    try {
      const response = await this.#post(WALLET_OWNERSHIP_PROOF_PATH, body, request, signal);
      if (response.status === 400) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
      if (response.status === 401) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated);
      if (response.status === 409) fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.conflict);
      if (response.status === 503) {
        fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unavailable, retryAfterSeconds(response));
      }
      if (response.status !== 200 && response.status !== 201) fail();
      return parseRegistrationResult(
        await this.#json(response, request, signal),
        input,
        response.status,
      );
    } finally {
      request.dispose();
    }
  }

  async #post(
    path: string,
    body: string,
    request: RequestDeadline,
    callerSignal: AbortSignal | undefined,
  ): Promise<Response> {
    let csrfToken: string;
    try {
      const cookieHeader =
        typeof this.#cookieHeader === 'function' ? this.#cookieHeader() : this.#cookieHeader;
      csrfToken = readAuthenticationCsrfToken(cookieHeader);
    } catch {
      fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.unauthenticated);
    }
    try {
      return await request.waitFor(this.#fetch(path, requestInit(csrfToken, body, request.signal)));
    } catch (error) {
      if (request.didTimeout()) fail();
      if (isAbortFailure(error, callerSignal)) throw error;
      fail();
    }
  }

  async #json(
    response: Response,
    request: RequestDeadline,
    callerSignal: AbortSignal | undefined,
  ): Promise<unknown> {
    try {
      return await readBoundedJson(response, request.signal);
    } catch (error) {
      if (request.didTimeout()) fail();
      if (callerSignal?.aborted === true) throw error;
      fail();
    }
  }
}

export interface CompleteSolanaWalletOwnershipInput {
  readonly adapter: WalletAdapter;
  readonly connection: WalletConnection;
  readonly client: SolanaWalletOwnershipClient;
  readonly signal?: AbortSignal;
}

/** Executes the exact issue -> SIWS signMessage -> Ed25519 proof handoff. */
export async function completeSolanaWalletOwnershipRegistration(
  input: CompleteSolanaWalletOwnershipInput,
): Promise<RegisteredSolanaWalletResult> {
  try {
    assertWalletConnection(input.connection, 'solana', input.adapter.connectorId);
  } catch {
    fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  }
  throwIfAborted(input.signal);
  const selected = input.connection.selectedAccount;
  if (!selected.chainId.startsWith('solana:')) {
    fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  }
  const challenge = await input.client.issueChallenge(
    {
      chainId: selected.chainId as SupportedSolanaCaipChainId,
      address: selected.address,
      registryEnvironment: 'MAINNET',
    },
    input.signal,
  );
  throwIfAborted(input.signal);
  const signature = await input.adapter.signOwnershipChallenge(
    input.connection.connectionId,
    challenge,
  );
  if (signature.format !== 'siws-message') {
    fail(WALLET_OWNERSHIP_HANDOFF_ERROR_CODES.rejected);
  }
  throwIfAborted(input.signal);
  return input.client.submitProof({ challenge, signature }, input.signal);
}
