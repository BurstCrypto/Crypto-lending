/**
 * Normalized boundary for external wallet SDK adapters.
 *
 * Product modules must not retain vendor provider objects. An adapter translates
 * vendor events and sessions into these chain-qualified values, while signature
 * verification remains a server responsibility.
 */

export const WALLET_NAMESPACES = ['eip155', 'solana'] as const;

export const SOLANA_CAIP_CHAIN_IDS = {
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
} as const;

export const SOLANA_WALLET_STANDARD_CHAINS = {
  mainnet: 'solana:mainnet',
  devnet: 'solana:devnet',
} as const;

export type WalletNamespace = (typeof WALLET_NAMESPACES)[number];
export type ChainId = `${WalletNamespace}:${string}`;
export type SupportedSolanaCluster = keyof typeof SOLANA_CAIP_CHAIN_IDS;
export type SupportedSolanaCaipChainId =
  (typeof SOLANA_CAIP_CHAIN_IDS)[SupportedSolanaCluster];
export type SolanaWalletStandardChain =
  (typeof SOLANA_WALLET_STANDARD_CHAINS)[SupportedSolanaCluster];

const SOLANA_CAIP_TO_WALLET_STANDARD = new Map<
  SupportedSolanaCaipChainId,
  SolanaWalletStandardChain
>([
  [SOLANA_CAIP_CHAIN_IDS.mainnet, SOLANA_WALLET_STANDARD_CHAINS.mainnet],
  [SOLANA_CAIP_CHAIN_IDS.devnet, SOLANA_WALLET_STANDARD_CHAINS.devnet],
]);

export function solanaWalletStandardChainForCaip(
  chainId: ChainId,
): SolanaWalletStandardChain {
  const chain = SOLANA_CAIP_TO_WALLET_STANDARD.get(chainId as SupportedSolanaCaipChainId);
  if (chain === undefined) {
    throw new TypeError('Solana chain ID is not in the supported CAIP allowlist');
  }
  return chain;
}

export interface WalletAccount {
  readonly chainId: ChainId;
  readonly address: string;
}

export interface WalletScope {
  readonly chainId: ChainId;
  /** Approved provider methods/features for this chain. */
  readonly methods: readonly string[];
  /** Approved provider events for this chain. */
  readonly events: readonly string[];
}

export interface WalletConnection {
  /** Opaque application ID for this connection, not a provider-supplied label. */
  readonly connectionId: string;
  /** Stable identifier for the configured adapter, such as `metamask`. */
  readonly connectorId: string;
  /** Optional remote transport ID. It must never be used as application identity. */
  readonly transportSessionId?: string;
  readonly accounts: readonly WalletAccount[];
  readonly approvedScopes: readonly WalletScope[];
  /** Explicit selection; it is not implicitly `accounts[0]`. */
  readonly selectedAccount: WalletAccount;
  readonly restored: boolean;
}

export interface WalletConnectOptions {
  readonly signal?: AbortSignal;
}

export interface WalletRestoreOptions {
  readonly signal?: AbortSignal;
}

interface OwnershipChallengeBase {
  readonly id: string;
  readonly chainId: ChainId;
  readonly address: string;
  readonly nonce: string;
  readonly expiresAt: string;
}

export interface SiweOwnershipChallenge extends OwnershipChallengeBase {
  readonly format: 'siwe';
  /** Exact server-issued ERC-4361 message. The browser must not rewrite it. */
  readonly message: string;
}

export interface SiwsMessageOwnershipChallenge extends OwnershipChallengeBase {
  readonly format: 'siws-message';
  /** Exact canonical fallback message, encoded as UTF-8 before signing. */
  readonly message: string;
}

export interface SiwsSignInInput {
  readonly domain: string;
  readonly address: string;
  readonly statement?: string;
  readonly uri: string;
  readonly version: '1';
  /** Wallet Standard alias corresponding to the challenge's canonical CAIP ID. */
  readonly chainId: SolanaWalletStandardChain;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
  readonly notBefore?: string;
  readonly requestId: string;
  readonly resources?: readonly string[];
}

export interface SiwsSignInOwnershipChallenge extends OwnershipChallengeBase {
  readonly format: 'siws-sign-in';
  /** Structured input; the wallet, not the dapp, constructs the signed message. */
  readonly input: SiwsSignInInput;
}

export type OwnershipChallenge =
  SiweOwnershipChallenge | SiwsMessageOwnershipChallenge | SiwsSignInOwnershipChallenge;

interface OwnershipSignatureBase {
  readonly challengeId: string;
  readonly chainId: ChainId;
  readonly address: string;
}

export interface SiweOwnershipSignature extends OwnershipSignatureBase {
  readonly format: 'siwe';
  readonly signature: string;
}

export interface SiwsMessageOwnershipSignature extends OwnershipSignatureBase {
  readonly format: 'siws-message';
  readonly signedMessage: Uint8Array;
  readonly signature: Uint8Array;
  readonly signatureType?: 'ed25519';
}

export interface SiwsSignInOwnershipSignature extends OwnershipSignatureBase {
  readonly format: 'siws-sign-in';
  readonly account: {
    readonly address: string;
    readonly publicKey: Uint8Array;
  };
  readonly signedMessage: Uint8Array;
  readonly signature: Uint8Array;
  readonly signatureType?: 'ed25519';
}

export type OwnershipSignature =
  SiweOwnershipSignature | SiwsMessageOwnershipSignature | SiwsSignInOwnershipSignature;

interface OwnershipSignatureWireBase {
  readonly challengeId: string;
  readonly chainId: ChainId;
  readonly address: string;
}

export interface SiweOwnershipSignatureWire extends OwnershipSignatureWireBase {
  readonly format: 'siwe';
  readonly signature: string;
}

export interface SiwsMessageOwnershipSignatureWire extends OwnershipSignatureWireBase {
  readonly format: 'siws-message';
  /** Base64url without padding. */
  readonly signedMessage: string;
  /** Base64url without padding. */
  readonly signature: string;
  readonly signatureType?: 'ed25519';
}

export interface SiwsSignInOwnershipSignatureWire extends OwnershipSignatureWireBase {
  readonly format: 'siws-sign-in';
  readonly account: {
    readonly address: string;
    /** Base64url without padding. */
    readonly publicKey: string;
  };
  /** Base64url without padding. */
  readonly signedMessage: string;
  /** Base64url without padding. */
  readonly signature: string;
  readonly signatureType?: 'ed25519';
}

/** JSON-safe DTO. The API must still correlate it with the stored challenge. */
export type OwnershipSignatureWire =
  SiweOwnershipSignatureWire | SiwsMessageOwnershipSignatureWire | SiwsSignInOwnershipSignatureWire;

/** Exact KAN-56 `POST /ownership-proofs` Solana body. */
export interface SolanaEd25519OwnershipProofWire {
  readonly kind: 'SOLANA_ED25519';
  readonly challengeId: string;
  readonly address: string;
  /** Canonical unpadded base64url. */
  readonly publicKey: string;
  /** Canonical unpadded base64url. */
  readonly signedMessage: string;
  /** Canonical unpadded base64url. */
  readonly signature: string;
}

export interface WalletProviderError {
  readonly code: string | number;
  readonly message: string;
  readonly recoverable: boolean;
}

export type WalletEvent =
  | {
      readonly type: 'accountsChanged';
      /** Required even when the provider reports an empty account list. */
      readonly connectionId: string;
      readonly connectorId: string;
      readonly connection: WalletConnection | null;
    }
  | {
      readonly type: 'chainChanged';
      readonly connection: WalletConnection;
    }
  | {
      /** Includes WalletConnect namespace/method/event approval changes. */
      readonly type: 'sessionUpdated';
      readonly connection: WalletConnection;
    }
  | {
      readonly type: 'disconnect' | 'sessionExpired';
      readonly connectionId: string;
      readonly connectorId: string;
      readonly error?: WalletProviderError;
    };

export type UnsubscribeWalletListener = () => void;

export interface WalletAdapter {
  readonly connectorId: string;
  readonly namespace: WalletNamespace;

  /** Starts an interactive, user-requested connection. */
  connect(options?: WalletConnectOptions): Promise<WalletConnection>;

  /**
   * Waits for the SDK's non-interactive restoration attempt. Returning null is
   * different from rejecting an interactive connect request.
   */
  restore(options?: WalletRestoreOptions): Promise<WalletConnection | null>;

  /** Disconnects exactly one application-owned connection. */
  disconnect(connectionId: string): Promise<void>;

  /** Signs only the exact challenge previously issued by the API. */
  signOwnershipChallenge(
    connectionId: string,
    challenge: OwnershipChallenge,
  ): Promise<OwnershipSignature>;

  /** Registers one normalized listener and returns exact cleanup for it. */
  subscribe(listener: (event: WalletEvent) => void): UnsubscribeWalletListener;
}

const EVM_CHAIN_ID_PATTERN = /^eip155:(?:0|[1-9][0-9]*)$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NONCE_PATTERN = /^[a-zA-Z0-9]{8,64}$/;
const CANONICAL_UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_ADDRESS_LENGTH = 256;
const MAX_MESSAGE_LENGTH = 16_384;
const MAX_ACCOUNTS = 64;
const MAX_SCOPES = 64;
const MAX_SCOPE_ITEMS = 64;
const MAX_RESOURCES = 32;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertBoundedString(
  value: unknown,
  label: string,
  maximumLength = MAX_IDENTIFIER_LENGTH,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
}

function assertStringList(
  value: unknown,
  label: string,
  maximumItems = MAX_SCOPE_ITEMS,
): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${label} must be an array`);
  }

  const seen = new Set<string>();
  for (const item of value) {
    assertBoundedString(item, `${label} item`);
    if (seen.has(item)) {
      throw new TypeError(`${label} items must be unique`);
    }
    seen.add(item);
  }
}

function namespaceOf(chainId: string): WalletNamespace {
  return chainId.slice(0, chainId.indexOf(':')) as WalletNamespace;
}

function isSupportedChainId(chainId: string): chainId is ChainId {
  return (
    EVM_CHAIN_ID_PATTERN.test(chainId) ||
    SOLANA_CAIP_TO_WALLET_STANDARD.has(chainId as SupportedSolanaCaipChainId)
  );
}

function assertAddress(address: string, namespace: WalletNamespace): void {
  const solanaPublicKey = namespace === 'solana' ? decodeBase58(address) : null;
  const valid =
    namespace === 'eip155'
      ? EVM_ADDRESS_PATTERN.test(address)
      : solanaPublicKey?.byteLength === 32 && solanaPublicKey.some((byte) => byte !== 0);

  if (!valid) {
    throw new TypeError(`wallet account address is invalid for ${namespace}`);
  }
}

function decodeBase58(address: string): Uint8Array | null {
  if (!SOLANA_ADDRESS_PATTERN.test(address)) {
    return null;
  }

  const bytes = [0];
  for (const character of address) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) {
      return null;
    }
    for (let index = 0; index < bytes.length; index += 1) {
      carry += (bytes[index] ?? 0) * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroBytes = 0;
  while (address[leadingZeroBytes] === '1') {
    leadingZeroBytes += 1;
  }
  const significantBytes = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  const decoded = new Uint8Array(leadingZeroBytes + significantBytes);
  for (let index = 0; index < significantBytes; index += 1) {
    decoded[decoded.length - index - 1] = bytes[index] ?? 0;
  }
  return decoded;
}

function isCanonicalUtcDateTime(value: string): boolean {
  if (!CANONICAL_UTC_DATE_TIME_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function assertWalletAccount(
  value: unknown,
  expectedNamespace?: WalletNamespace,
): asserts value is WalletAccount {
  assertRecord(value, 'wallet account');
  assertBoundedString(value.chainId, 'wallet account chainId');
  assertBoundedString(value.address, 'wallet account address', MAX_ADDRESS_LENGTH);

  if (!isSupportedChainId(value.chainId)) {
    throw new TypeError('wallet account chainId must be a supported chain-qualified ID');
  }

  if (expectedNamespace !== undefined && namespaceOf(value.chainId) !== expectedNamespace) {
    throw new TypeError('wallet account namespace does not match the adapter namespace');
  }

  assertAddress(value.address, namespaceOf(value.chainId));
}

function accountKey(account: WalletAccount): string {
  const address =
    namespaceOf(account.chainId) === 'eip155' ? account.address.toLowerCase() : account.address;
  return `${account.chainId}\u0000${address}`;
}

function addressesEqual(chainId: ChainId, left: string, right: string): boolean {
  return namespaceOf(chainId) === 'eip155'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertWalletScope(
  value: unknown,
  expectedNamespace?: WalletNamespace,
): asserts value is WalletScope {
  assertRecord(value, 'wallet scope');
  assertBoundedString(value.chainId, 'wallet scope chainId');
  if (!isSupportedChainId(value.chainId)) {
    throw new TypeError('wallet scope chainId must be a supported chain-qualified ID');
  }
  if (expectedNamespace !== undefined && namespaceOf(value.chainId) !== expectedNamespace) {
    throw new TypeError('wallet scope namespace does not match the adapter namespace');
  }
  assertStringList(value.methods, 'wallet scope methods');
  assertStringList(value.events, 'wallet scope events');
}

/**
 * Validates untrusted SDK output before it enters application state.
 */
export function assertWalletConnection(
  value: unknown,
  expectedNamespace?: WalletNamespace,
  expectedConnectorId?: string,
): asserts value is WalletConnection {
  assertRecord(value, 'wallet connection');
  assertBoundedString(value.connectionId, 'wallet connection connectionId');
  assertBoundedString(value.connectorId, 'wallet connection connectorId');
  if (value.transportSessionId !== undefined) {
    assertBoundedString(value.transportSessionId, 'wallet connection transportSessionId');
  }
  if (expectedConnectorId !== undefined && value.connectorId !== expectedConnectorId) {
    throw new TypeError('wallet connection connector does not match the adapter connector');
  }

  if (
    !Array.isArray(value.accounts) ||
    value.accounts.length === 0 ||
    value.accounts.length > MAX_ACCOUNTS
  ) {
    throw new TypeError(`wallet connection must contain 1-${MAX_ACCOUNTS} accounts`);
  }

  const seenAccounts = new Set<string>();
  for (const account of value.accounts) {
    assertWalletAccount(account, expectedNamespace);
    const key = accountKey(account);
    if (seenAccounts.has(key)) {
      throw new TypeError('wallet connection accounts must be unique');
    }
    seenAccounts.add(key);
  }

  if (
    !Array.isArray(value.approvedScopes) ||
    value.approvedScopes.length === 0 ||
    value.approvedScopes.length > MAX_SCOPES
  ) {
    throw new TypeError(`wallet connection must contain 1-${MAX_SCOPES} approved scopes`);
  }

  const scopesByChain = new Set<string>();
  for (const scope of value.approvedScopes) {
    assertWalletScope(scope, expectedNamespace);
    if (scopesByChain.has(scope.chainId)) {
      throw new TypeError('wallet connection approved scopes must be unique by chain');
    }
    scopesByChain.add(scope.chainId);
  }

  for (const account of value.accounts) {
    if (!scopesByChain.has(account.chainId)) {
      throw new TypeError('every wallet account chain must have an approved scope');
    }
  }

  assertWalletAccount(value.selectedAccount, expectedNamespace);
  if (!seenAccounts.has(accountKey(value.selectedAccount))) {
    throw new TypeError('selected wallet account must exist in the connection accounts');
  }

  if (typeof value.restored !== 'boolean') {
    throw new TypeError('wallet connection restored must be a boolean');
  }
}

export function assertOwnershipChallenge(value: unknown): asserts value is OwnershipChallenge {
  assertRecord(value, 'ownership challenge');
  assertBoundedString(value.id, 'ownership challenge id');
  assertBoundedString(value.chainId, 'ownership challenge chainId');
  assertBoundedString(value.address, 'ownership challenge address', MAX_ADDRESS_LENGTH);
  assertBoundedString(value.nonce, 'ownership challenge nonce');
  assertBoundedString(value.expiresAt, 'ownership challenge expiresAt');

  if (
    value.format !== 'siwe' &&
    value.format !== 'siws-message' &&
    value.format !== 'siws-sign-in'
  ) {
    throw new TypeError('ownership challenge format is unsupported');
  }

  if (!isSupportedChainId(value.chainId)) {
    throw new TypeError('ownership challenge chainId must be a supported chain-qualified ID');
  }

  const expectedNamespace: WalletNamespace = value.format === 'siwe' ? 'eip155' : 'solana';
  if (namespaceOf(value.chainId) !== expectedNamespace) {
    throw new TypeError('ownership challenge format does not match its chain namespace');
  }

  assertAddress(value.address, expectedNamespace);

  if (!NONCE_PATTERN.test(value.nonce)) {
    throw new TypeError('ownership challenge nonce must be 8-64 alphanumeric characters');
  }

  if (!isCanonicalUtcDateTime(value.expiresAt)) {
    throw new TypeError('ownership challenge expiresAt must be a canonical UTC date-time');
  }

  if (value.format === 'siwe' || value.format === 'siws-message') {
    assertBoundedString(value.message, 'ownership challenge message', MAX_MESSAGE_LENGTH);
    return;
  }

  assertSiwsSignInInput(value.input, {
    address: value.address,
    chainId: value.chainId as ChainId,
    expiresAt: value.expiresAt,
    nonce: value.nonce,
  });
}

function assertOptionalBoundedString(value: unknown, label: string): void {
  if (value !== undefined) {
    assertBoundedString(value, label, MAX_MESSAGE_LENGTH);
  }
}

function assertSiwsSignInInput(
  value: unknown,
  challenge: Pick<OwnershipChallengeBase, 'address' | 'chainId' | 'expiresAt' | 'nonce'>,
): asserts value is SiwsSignInInput {
  assertRecord(value, 'SIWS sign-in input');
  assertBoundedString(value.domain, 'SIWS sign-in domain');
  assertBoundedString(value.address, 'SIWS sign-in address', MAX_ADDRESS_LENGTH);
  assertOptionalBoundedString(value.statement, 'SIWS sign-in statement');
  assertBoundedString(value.uri, 'SIWS sign-in URI');
  assertBoundedString(value.chainId, 'SIWS sign-in chainId');
  assertBoundedString(value.nonce, 'SIWS sign-in nonce');
  assertBoundedString(value.issuedAt, 'SIWS sign-in issuedAt');
  assertBoundedString(value.expirationTime, 'SIWS sign-in expirationTime');
  assertOptionalBoundedString(value.notBefore, 'SIWS sign-in notBefore');
  assertBoundedString(value.requestId, 'SIWS sign-in requestId');

  if (value.version !== '1') {
    throw new TypeError('SIWS sign-in version must be 1');
  }
  if (value.chainId !== solanaWalletStandardChainForCaip(challenge.chainId)) {
    throw new TypeError('SIWS sign-in chainId must match the challenge CAIP cluster');
  }
  if (value.address !== challenge.address) {
    throw new TypeError('SIWS sign-in address must match the challenge');
  }
  if (value.nonce !== challenge.nonce) {
    throw new TypeError('SIWS sign-in nonce must match the challenge');
  }
  if (value.expirationTime !== challenge.expiresAt) {
    throw new TypeError('SIWS sign-in expiration must match the challenge');
  }
  if (!isCanonicalUtcDateTime(value.issuedAt)) {
    throw new TypeError('SIWS sign-in issuedAt must be a canonical UTC date-time');
  }
  if (!isCanonicalUtcDateTime(value.expirationTime)) {
    throw new TypeError('SIWS sign-in expirationTime must be a canonical UTC date-time');
  }
  const notBefore = value.notBefore;
  if (notBefore !== undefined) {
    assertBoundedString(notBefore, 'SIWS sign-in notBefore');
    if (!isCanonicalUtcDateTime(notBefore)) {
      throw new TypeError('SIWS sign-in notBefore must be a canonical UTC date-time');
    }
  }
  if (value.resources !== undefined) {
    assertStringList(value.resources, 'SIWS sign-in resources', MAX_RESOURCES);
  }

  if (typeof value.statement === 'string' && /[\r\n]/.test(value.statement)) {
    throw new TypeError('SIWS sign-in statement must not contain newlines');
  }

  let uri: URL;
  try {
    uri = new URL(value.uri);
  } catch {
    throw new TypeError('SIWS sign-in URI must be an absolute URL');
  }
  if (uri.host !== value.domain) {
    throw new TypeError('SIWS sign-in domain must match the URI host');
  }
  if (uri.protocol !== 'https:' && uri.hostname !== 'localhost' && uri.hostname !== '127.0.0.1') {
    throw new TypeError('SIWS sign-in URI must use HTTPS outside local development');
  }

  const issuedAt = Date.parse(value.issuedAt);
  const expirationTime = Date.parse(value.expirationTime);
  if (expirationTime <= issuedAt) {
    throw new TypeError('SIWS sign-in expirationTime must be after issuedAt');
  }
  if (notBefore !== undefined && Date.parse(notBefore) > expirationTime) {
    throw new TypeError('SIWS sign-in notBefore must not be after expirationTime');
  }

  for (const resource of value.resources ?? []) {
    try {
      new URL(resource);
    } catch {
      throw new TypeError('SIWS sign-in resources must be absolute URLs');
    }
  }
}

export function assertOwnershipChallengeTargetsConnection(
  challenge: OwnershipChallenge,
  connection: WalletConnection,
): void {
  assertOwnershipChallenge(challenge);
  assertWalletConnection(connection);

  const selected = connection.selectedAccount;
  if (
    selected.chainId !== challenge.chainId ||
    !addressesEqual(challenge.chainId, selected.address, challenge.address)
  ) {
    throw new TypeError('ownership challenge must target the selected wallet account');
  }

  const approvedScope = connection.approvedScopes.find(
    (scope) => scope.chainId === challenge.chainId,
  );
  const requiredMethod =
    challenge.format === 'siwe'
      ? 'personal_sign'
      : challenge.format === 'siws-sign-in'
        ? 'solana:signIn'
        : 'solana:signMessage';
  if (!approvedScope?.methods.includes(requiredMethod)) {
    throw new TypeError(`wallet connection has not approved ${requiredMethod}`);
  }
}

function assertBytes(
  value: unknown,
  label: string,
  expectedLength?: number,
  maximumLength = MAX_MESSAGE_LENGTH,
): asserts value is Uint8Array {
  const byteLength = (value as Uint8Array | null | undefined)?.byteLength;
  const isUint8Array =
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]' &&
    (value as Uint8Array).BYTES_PER_ELEMENT === 1;
  if (!isUint8Array || byteLength === 0) {
    throw new TypeError(`${label} must be non-empty bytes`);
  }
  if (expectedLength !== undefined && byteLength !== expectedLength) {
    throw new TypeError(`${label} must contain ${expectedLength} bytes`);
  }
  if (byteLength !== undefined && byteLength > maximumLength) {
    throw new TypeError(`${label} must not exceed ${maximumLength} bytes`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  );
}

/**
 * Checks adapter output correlation before forwarding it to the API. This is
 * deliberately not cryptographic verification.
 */
export function assertOwnershipSignatureMatchesChallenge(
  signature: unknown,
  challenge: OwnershipChallenge,
): asserts signature is OwnershipSignature {
  assertOwnershipChallenge(challenge);
  assertRecord(signature, 'ownership signature');
  if (signature.format !== challenge.format) {
    throw new TypeError('ownership signature format does not match the issued challenge');
  }
  assertBoundedString(signature.challengeId, 'ownership signature challengeId');
  assertBoundedString(signature.chainId, 'ownership signature chainId');
  assertBoundedString(signature.address, 'ownership signature address', MAX_ADDRESS_LENGTH);

  if (
    signature.challengeId !== challenge.id ||
    signature.chainId !== challenge.chainId ||
    !addressesEqual(challenge.chainId, signature.address, challenge.address)
  ) {
    throw new TypeError('ownership signature does not match the issued challenge');
  }

  if (signature.format === 'siwe' && challenge.format === 'siwe') {
    assertBoundedString(signature.signature, 'ownership signature value', MAX_MESSAGE_LENGTH);
    return;
  }

  assertBytes(signature.signature, 'ownership signature value', 64, 64);
  assertBytes(signature.signedMessage, 'ownership signed message');
  if (signature.signatureType !== undefined && signature.signatureType !== 'ed25519') {
    throw new TypeError('SIWS signature type must be ed25519');
  }

  if (signature.format === 'siws-message' && challenge.format === 'siws-message') {
    const expectedMessage = new TextEncoder().encode(challenge.message);
    if (!bytesEqual(signature.signedMessage, expectedMessage)) {
      throw new TypeError('SIWS signed message does not match the issued challenge');
    }
    return;
  }

  if (signature.format !== 'siws-sign-in' || challenge.format !== 'siws-sign-in') {
    throw new TypeError('ownership signature format does not match the issued challenge');
  }

  assertRecord(signature.account, 'SIWS sign-in account');
  assertBoundedString(
    signature.account.address,
    'SIWS sign-in account address',
    MAX_ADDRESS_LENGTH,
  );
  assertAddress(signature.account.address, 'solana');
  assertBytes(signature.account.publicKey, 'SIWS sign-in account public key', 32, 32);
  if (
    signature.account.address !== challenge.address ||
    signature.address !== signature.account.address
  ) {
    throw new TypeError('SIWS sign-in account does not match the issued challenge');
  }
  const decodedAddress = decodeBase58(signature.account.address);
  if (decodedAddress === null || !bytesEqual(decodedAddress, signature.account.publicKey)) {
    throw new TypeError('SIWS sign-in public key does not match its account address');
  }
}

export function walletBytesToBase64Url(value: Uint8Array): string {
  assertBytes(value, 'wallet wire bytes');
  let binary = '';
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function base64UrlToWalletBytes(
  value: string,
  maximumLength = MAX_MESSAGE_LENGTH,
): Uint8Array {
  if (
    !Number.isSafeInteger(maximumLength) ||
    maximumLength <= 0 ||
    maximumLength > MAX_MESSAGE_LENGTH
  ) {
    throw new TypeError(`wallet byte limit must be between 1 and ${MAX_MESSAGE_LENGTH}`);
  }
  assertBoundedString(value, 'wallet base64url value', Math.ceil((maximumLength * 4) / 3) + 4);
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) {
    throw new TypeError('wallet base64url value is malformed');
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError('wallet base64url value is malformed');
  }
  if (binary.length === 0 || binary.length > maximumLength) {
    throw new TypeError(`wallet base64url value must decode to 1-${maximumLength} bytes`);
  }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (walletBytesToBase64Url(decoded) !== value) {
    throw new TypeError('wallet base64url value is not canonical');
  }
  return decoded;
}

export function toOwnershipSignatureWire(signature: OwnershipSignature): OwnershipSignatureWire {
  if (signature.format === 'siwe') {
    return { ...signature };
  }

  const common = {
    challengeId: signature.challengeId,
    chainId: signature.chainId,
    address: signature.address,
    signedMessage: walletBytesToBase64Url(signature.signedMessage),
    signature: walletBytesToBase64Url(signature.signature),
  };
  const signatureType =
    signature.signatureType === undefined ? {} : { signatureType: signature.signatureType };

  if (signature.format === 'siws-message') {
    return {
      ...common,
      ...signatureType,
      format: 'siws-message',
    };
  }

  return {
    ...common,
    ...signatureType,
    format: 'siws-sign-in',
    account: {
      address: signature.account.address,
      publicKey: walletBytesToBase64Url(signature.account.publicKey),
    },
  };
}

/**
 * Translates the exact canonical-message SIWS result to KAN-56's provider-neutral
 * Ed25519 proof body. Structured `solana:signIn` remains fail-closed until the
 * server challenge/verification boundary supports wallet-constructed messages.
 */
export function toSolanaEd25519OwnershipProofWire(
  signature: unknown,
  challenge: SiwsMessageOwnershipChallenge,
): SolanaEd25519OwnershipProofWire {
  assertOwnershipSignatureMatchesChallenge(signature, challenge);
  if (signature.format !== 'siws-message') {
    throw new TypeError('KAN-56 accepts only canonical-message SIWS proofs');
  }
  const publicKey = decodeBase58(signature.address);
  if (publicKey === null || publicKey.byteLength !== 32) {
    throw new TypeError('SIWS address must decode to a 32-byte public key');
  }
  return {
    kind: 'SOLANA_ED25519',
    challengeId: signature.challengeId,
    address: signature.address,
    publicKey: walletBytesToBase64Url(publicKey),
    signedMessage: walletBytesToBase64Url(signature.signedMessage),
    signature: walletBytesToBase64Url(signature.signature),
  };
}
