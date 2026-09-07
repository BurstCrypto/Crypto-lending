import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifyNodeSignature,
} from 'node:crypto';

import { hashMessage, recoverMessageAddress, type Hex } from 'viem';

import { validateEd25519PublicKeyBytes } from '../../infrastructure/security/ed25519-public-key';
import {
  formatWalletAccountId,
  parseEvmWalletAddress,
  parseSolanaWalletAddress,
  parseWalletAccountId,
  parseWalletAddress,
  parseWalletChainId,
  solanaWalletAddressBytes,
  walletNamespaceOf,
  type EvmWalletAddress,
  type SolanaWalletAddress,
  type WalletAccountId,
  type WalletAddress,
  type WalletOwnershipChainId,
} from './wallet-identity';

const CHALLENGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHALLENGE_NONCE_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const EOA_SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/u;
const CONTRACT_SIGNATURE_PATTERN = /^0x(?:[0-9a-f]{2}){1,4096}$/u;
const SECP256K1_ORDER = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
);
const SECP256K1_HALF_ORDER = SECP256K1_ORDER / 2n;
const MAX_MESSAGE_BYTES = 4_096;
const MAX_DATE_EPOCH_MILLISECONDS = 8_640_000_000_000_000;
const SUBJECT_BINDING_RESOURCE_PREFIX = 'urn:crypto-lending:wallet-subject-binding:hmac-sha-256:';
const OPERATION_RESOURCE = 'urn:crypto-lending:wallet-operation:register-wallet';
const POLICY_RESOURCE = 'urn:crypto-lending:wallet-ownership:v1';
const OWNERSHIP_STATEMENT =
  'Verify this wallet for Crypto Lending. This proof does not authorize login, transactions, transfers, or loans.';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'buffer',
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteLength',
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteOffset',
)?.get;

export const WALLET_OWNERSHIP_CHALLENGE_VERSION = 1 as const;
export const WALLET_OWNERSHIP_MAX_TTL_MILLISECONDS = 5 * 60 * 1_000;
export const WALLET_OWNERSHIP_OPERATIONS = Object.freeze(['REGISTER_WALLET'] as const);
export const WALLET_OWNERSHIP_PROOF_KINDS = Object.freeze([
  'EVM_EIP191_EOA',
  'EVM_ERC1271',
  'SOLANA_ED25519',
] as const);

export type WalletOwnershipOperation = (typeof WALLET_OWNERSHIP_OPERATIONS)[number];
export type WalletOwnershipProofKind = (typeof WALLET_OWNERSHIP_PROOF_KINDS)[number];
export type WalletChallengeState = 'PENDING' | 'CONSUMED';

declare const walletChallengeIdBrand: unique symbol;
declare const walletChallengeNonceBrand: unique symbol;
declare const walletDigestBrand: unique symbol;
declare const walletOriginBrand: unique symbol;
declare const walletUriBrand: unique symbol;

export type WalletChallengeId = string & { readonly [walletChallengeIdBrand]: true };
export type WalletChallengeNonce = string & { readonly [walletChallengeNonceBrand]: true };
export type WalletDigest<Purpose extends string> = string & {
  readonly [walletDigestBrand]: Purpose;
};
export type WalletOrigin = string & { readonly [walletOriginBrand]: true };
export type WalletUri = string & { readonly [walletUriBrand]: true };

export type WalletOwnershipValidationCode =
  | 'INVALID_CHALLENGE_ID'
  | 'INVALID_CHALLENGE_NONCE'
  | 'INVALID_DIGEST'
  | 'INVALID_ORIGIN'
  | 'INVALID_URI'
  | 'INVALID_OPERATION'
  | 'INVALID_CHALLENGE_TIME'
  | 'INVALID_CHALLENGE_RECORD';

export class WalletOwnershipValidationError extends Error {
  constructor(readonly code: WalletOwnershipValidationCode) {
    super(code);
    this.name = 'WalletOwnershipValidationError';
  }
}

export interface CreateWalletOwnershipChallengeInput {
  readonly challengeId: WalletChallengeId;
  readonly subjectBindingDigest: WalletDigest<'subject-binding'>;
  readonly chainId: WalletOwnershipChainId;
  readonly address: WalletAddress;
  readonly origin: WalletOrigin;
  readonly uri: WalletUri;
  readonly operation: WalletOwnershipOperation;
  readonly nonce: WalletChallengeNonce;
  readonly issuedAtEpochMilliseconds: number;
  readonly expiresAtEpochMilliseconds: number;
}

export interface PublicWalletOwnershipChallenge {
  readonly version: typeof WALLET_OWNERSHIP_CHALLENGE_VERSION;
  readonly challengeId: WalletChallengeId;
  readonly messageFormat: 'SIWE' | 'SIWS';
  readonly chainId: WalletOwnershipChainId;
  readonly address: WalletAddress;
  readonly accountId: WalletAccountId;
  /** The only returned value containing the raw challenge nonce. */
  readonly message: string;
  readonly expiresAt: string;
}

/**
 * Safe persistence representation. It deliberately contains neither the raw nonce nor
 * the signed message. The proof must echo the exact message and satisfy both digests.
 */
export interface WalletOwnershipChallengeRecord {
  readonly version: typeof WALLET_OWNERSHIP_CHALLENGE_VERSION;
  readonly challengeId: WalletChallengeId;
  readonly subjectBindingDigest: WalletDigest<'subject-binding'>;
  readonly chainId: WalletOwnershipChainId;
  readonly address: WalletAddress;
  readonly accountId: WalletAccountId;
  readonly origin: WalletOrigin;
  readonly uri: WalletUri;
  readonly operation: WalletOwnershipOperation;
  readonly issuedAtEpochMilliseconds: number;
  readonly expiresAtEpochMilliseconds: number;
  readonly nonceDigest: WalletDigest<'challenge-nonce'>;
  readonly messageDigest: WalletDigest<'challenge-message'>;
}

export interface CreatedWalletOwnershipChallenge {
  readonly publicChallenge: PublicWalletOwnershipChallenge;
  readonly record: WalletOwnershipChallengeRecord;
}

export interface EvmEip191WalletOwnershipProof {
  readonly kind: 'EVM_EIP191_EOA';
  readonly challengeId: WalletChallengeId;
  readonly message: string;
  readonly signature: string;
}

export interface EvmErc1271WalletOwnershipProof {
  readonly kind: 'EVM_ERC1271';
  readonly challengeId: WalletChallengeId;
  readonly message: string;
  readonly signature: string;
}

export interface SolanaEd25519WalletOwnershipProof {
  readonly kind: 'SOLANA_ED25519';
  readonly challengeId: WalletChallengeId;
  readonly address: SolanaWalletAddress;
  readonly publicKey: Uint8Array;
  readonly signedMessage: Uint8Array;
  readonly signature: Uint8Array;
}

export type WalletOwnershipProof =
  | EvmEip191WalletOwnershipProof
  | EvmErc1271WalletOwnershipProof
  | SolanaEd25519WalletOwnershipProof;

export interface WalletOwnershipVerificationRequest {
  readonly record: WalletOwnershipChallengeRecord;
  readonly proof: WalletOwnershipProof;
  readonly expectedSubjectBindingDigest: WalletDigest<'subject-binding'>;
  readonly expectedOrigin: WalletOrigin;
  readonly expectedOperation: WalletOwnershipOperation;
  readonly challengeState: WalletChallengeState;
  readonly nowEpochMilliseconds: number;
}

export type Erc1271VerificationDecision = 'VALID' | 'INVALID' | 'UNAVAILABLE';

/**
 * An adapter may implement this port after an approved RPC boundary exists. This domain
 * never performs a provider or network call itself and fails closed without the port.
 */
export interface Erc1271ContractSignatureVerifierPort {
  verify(
    input: Readonly<{
      challengeId: WalletChallengeId;
      chainId: WalletOwnershipChainId;
      contractAddress: EvmWalletAddress;
      eip191MessageHash: Hex;
      signature: Hex;
    }>,
  ): Promise<Erc1271VerificationDecision>;
}

export interface WalletOwnershipVerificationOptions {
  readonly erc1271Verifier?: Erc1271ContractSignatureVerifierPort;
}

export type WalletOwnershipRejectionReason =
  | 'MALFORMED_REQUEST'
  | 'CHALLENGE_REPLAYED'
  | 'CHALLENGE_NOT_YET_VALID'
  | 'CHALLENGE_EXPIRED'
  | 'BINDING_MISMATCH'
  | 'MESSAGE_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'CONTRACT_VERIFICATION_UNAVAILABLE';

export type WalletOwnershipVerificationResult =
  | Readonly<{
      status: 'VERIFIED';
      challengeId: WalletChallengeId;
      proofKind: WalletOwnershipProofKind;
      chainId: WalletOwnershipChainId;
      address: WalletAddress;
      accountId: WalletAccountId;
      messageDigest: WalletDigest<'challenge-message'>;
    }>
  | Readonly<{
      status: 'REJECTED';
      reason: WalletOwnershipRejectionReason;
    }>;

const CHALLENGE_RECORD_KEYS = new Set([
  'version',
  'challengeId',
  'subjectBindingDigest',
  'chainId',
  'address',
  'accountId',
  'origin',
  'uri',
  'operation',
  'issuedAtEpochMilliseconds',
  'expiresAtEpochMilliseconds',
  'nonceDigest',
  'messageDigest',
]);

const CREATE_CHALLENGE_KEYS = new Set([
  'challengeId',
  'subjectBindingDigest',
  'chainId',
  'address',
  'origin',
  'uri',
  'operation',
  'nonce',
  'issuedAtEpochMilliseconds',
  'expiresAtEpochMilliseconds',
]);

const VERIFICATION_REQUEST_KEYS = new Set([
  'record',
  'proof',
  'expectedSubjectBindingDigest',
  'expectedOrigin',
  'expectedOperation',
  'challengeState',
  'nowEpochMilliseconds',
]);

const EOA_PROOF_KEYS = new Set(['kind', 'challengeId', 'message', 'signature']);
const ERC1271_PROOF_KEYS = EOA_PROOF_KEYS;
const SOLANA_PROOF_KEYS = new Set([
  'kind',
  'challengeId',
  'address',
  'publicKey',
  'signedMessage',
  'signature',
]);

function fail(code: WalletOwnershipValidationCode): never {
  throw new WalletOwnershipValidationError(code);
}

function ownDataRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  code: WalletOwnershipValidationCode,
): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !allowedKeys.has(key),
      ) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      fail(code);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ('value' in descriptor) result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof WalletOwnershipValidationError) throw error;
    fail(code);
  }
}

function parseSafeEpochMilliseconds(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_DATE_EPOCH_MILLISECONDS
  ) {
    fail('INVALID_CHALLENGE_TIME');
  }
  return value as number;
}

function validateChallengeWindow(issuedAt: number, expiresAt: number): void {
  if (expiresAt <= issuedAt || expiresAt - issuedAt > WALLET_OWNERSHIP_MAX_TTL_MILLISECONDS) {
    fail('INVALID_CHALLENGE_TIME');
  }
}

export function parseWalletChallengeId(value: unknown): WalletChallengeId {
  if (typeof value !== 'string' || !CHALLENGE_ID_PATTERN.test(value)) {
    fail('INVALID_CHALLENGE_ID');
  }
  return value as WalletChallengeId;
}

/** A 32-byte CSPRNG nonce encoded for ERC-4361's alphanumeric nonce grammar. */
export function parseWalletChallengeNonce(value: unknown): WalletChallengeNonce {
  if (typeof value !== 'string' || !CHALLENGE_NONCE_PATTERN.test(value)) {
    fail('INVALID_CHALLENGE_NONCE');
  }
  return value as WalletChallengeNonce;
}

export function parseWalletDigest<Purpose extends string>(value: unknown): WalletDigest<Purpose> {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail('INVALID_DIGEST');
  }
  return value as WalletDigest<Purpose>;
}

export function parseWalletOrigin(value: unknown): WalletOrigin {
  if (typeof value !== 'string' || value.length > 255) fail('INVALID_ORIGIN');
  try {
    const parsed = new URL(value);
    const localHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]');
    if (
      (parsed.protocol !== 'https:' && !localHttp) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.origin !== value
    ) {
      fail('INVALID_ORIGIN');
    }
    return value as WalletOrigin;
  } catch (error) {
    if (error instanceof WalletOwnershipValidationError) throw error;
    fail('INVALID_ORIGIN');
  }
}

export function parseWalletUri(value: unknown, expectedOriginValue: unknown): WalletUri {
  const expectedOrigin = parseWalletOrigin(expectedOriginValue);
  if (typeof value !== 'string' || value.length > 1_024) fail('INVALID_URI');
  try {
    const parsed = new URL(value);
    if (
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== '' ||
      parsed.origin !== expectedOrigin ||
      parsed.toString() !== value
    ) {
      fail('INVALID_URI');
    }
    return value as WalletUri;
  } catch (error) {
    if (error instanceof WalletOwnershipValidationError) throw error;
    fail('INVALID_URI');
  }
}

export function parseWalletOwnershipOperation(value: unknown): WalletOwnershipOperation {
  if (value !== 'REGISTER_WALLET') fail('INVALID_OPERATION');
  return value;
}

function sha256<Purpose extends string>(domain: string, bytes: Uint8Array): WalletDigest<Purpose> {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(bytes);
  return hash.digest('hex') as WalletDigest<Purpose>;
}

export function hashWalletChallengeNonce(nonceValue: unknown): WalletDigest<'challenge-nonce'> {
  const nonce = parseWalletChallengeNonce(nonceValue);
  return sha256('crypto-lending:wallet-challenge-nonce:v1', Buffer.from(nonce, 'hex'));
}

export function hashWalletOwnershipMessage(
  messageValue: unknown,
): WalletDigest<'challenge-message'> {
  const message = parseBoundedMessage(messageValue);
  return sha256('crypto-lending:wallet-ownership-message:v1', Buffer.from(message, 'utf8'));
}

function timingSafeDigestEqual(left: string, right: string): boolean {
  if (!DIGEST_PATTERN.test(left) || !DIGEST_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function parseBoundedMessage(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\r') ||
    value.includes('\0') ||
    containsUnpairedSurrogate(value) ||
    Buffer.byteLength(value, 'utf8') > MAX_MESSAGE_BYTES
  ) {
    fail('INVALID_CHALLENGE_RECORD');
  }
  return value;
}

function messageChainReference(chainId: WalletOwnershipChainId): string {
  return walletNamespaceOf(chainId) === 'eip155' ? chainId.slice('eip155:'.length) : chainId;
}

function createCanonicalMessage(
  record: Pick<
    WalletOwnershipChallengeRecord,
    | 'challengeId'
    | 'subjectBindingDigest'
    | 'chainId'
    | 'address'
    | 'origin'
    | 'uri'
    | 'operation'
    | 'issuedAtEpochMilliseconds'
    | 'expiresAtEpochMilliseconds'
  >,
  nonce: WalletChallengeNonce,
): string {
  const namespaceLabel = walletNamespaceOf(record.chainId) === 'eip155' ? 'Ethereum' : 'Solana';
  const domain = new URL(record.origin).host;
  const issuedAt = new Date(record.issuedAtEpochMilliseconds).toISOString();
  const expiresAt = new Date(record.expiresAtEpochMilliseconds).toISOString();
  return (
    `${domain} wants you to sign in with your ${namespaceLabel} account:\n` +
    `${record.address}\n\n` +
    `${OWNERSHIP_STATEMENT}\n\n` +
    `URI: ${record.uri}\n` +
    `Version: 1\n` +
    `Chain ID: ${messageChainReference(record.chainId)}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Expiration Time: ${expiresAt}\n` +
    `Not Before: ${issuedAt}\n` +
    `Request ID: ${record.challengeId}\n` +
    `Resources:\n` +
    `- ${POLICY_RESOURCE}\n` +
    `- ${SUBJECT_BINDING_RESOURCE_PREFIX}${record.subjectBindingDigest}\n` +
    `- ${OPERATION_RESOURCE}`
  );
}

function snapshotChallengeRecord(
  record: WalletOwnershipChallengeRecord,
): WalletOwnershipChallengeRecord {
  return Object.freeze({ ...record });
}

export function createWalletOwnershipChallenge(
  input: CreateWalletOwnershipChallengeInput,
): CreatedWalletOwnershipChallenge {
  const inputRecord = ownDataRecord(input, CREATE_CHALLENGE_KEYS, 'INVALID_CHALLENGE_RECORD');
  const challengeId = parseWalletChallengeId(inputRecord.challengeId);
  const subjectBindingDigest = parseWalletDigest<'subject-binding'>(
    inputRecord.subjectBindingDigest,
  );
  const chainId = parseWalletChainId(inputRecord.chainId);
  const address = parseWalletAddress(chainId, inputRecord.address);
  const accountId = formatWalletAccountId(chainId, address);
  const origin = parseWalletOrigin(inputRecord.origin);
  const uri = parseWalletUri(inputRecord.uri, origin);
  const operation = parseWalletOwnershipOperation(inputRecord.operation);
  const nonce = parseWalletChallengeNonce(inputRecord.nonce);
  const issuedAtEpochMilliseconds = parseSafeEpochMilliseconds(
    inputRecord.issuedAtEpochMilliseconds,
  );
  const expiresAtEpochMilliseconds = parseSafeEpochMilliseconds(
    inputRecord.expiresAtEpochMilliseconds,
  );
  validateChallengeWindow(issuedAtEpochMilliseconds, expiresAtEpochMilliseconds);

  const messageInput = Object.freeze({
    challengeId,
    subjectBindingDigest,
    chainId,
    address,
    origin,
    uri,
    operation,
    issuedAtEpochMilliseconds,
    expiresAtEpochMilliseconds,
  });
  const message = createCanonicalMessage(messageInput, nonce);
  const record = snapshotChallengeRecord({
    version: WALLET_OWNERSHIP_CHALLENGE_VERSION,
    ...messageInput,
    accountId,
    nonceDigest: hashWalletChallengeNonce(nonce),
    messageDigest: hashWalletOwnershipMessage(message),
  });
  const publicChallenge = Object.freeze({
    version: WALLET_OWNERSHIP_CHALLENGE_VERSION,
    challengeId,
    messageFormat: walletNamespaceOf(chainId) === 'eip155' ? 'SIWE' : 'SIWS',
    chainId,
    address,
    accountId,
    message,
    expiresAt: new Date(expiresAtEpochMilliseconds).toISOString(),
  } as const);
  return Object.freeze({ publicChallenge, record });
}

export function parseWalletOwnershipChallengeRecord(
  value: unknown,
): WalletOwnershipChallengeRecord {
  const record = ownDataRecord(value, CHALLENGE_RECORD_KEYS, 'INVALID_CHALLENGE_RECORD');
  if (record.version !== WALLET_OWNERSHIP_CHALLENGE_VERSION) fail('INVALID_CHALLENGE_RECORD');
  const challengeId = parseWalletChallengeId(record.challengeId);
  const subjectBindingDigest = parseWalletDigest<'subject-binding'>(record.subjectBindingDigest);
  const chainId = parseWalletChainId(record.chainId);
  const address = parseWalletAddress(chainId, record.address);
  const accountId = parseWalletAccountId(record.accountId);
  if (accountId !== formatWalletAccountId(chainId, address)) fail('INVALID_CHALLENGE_RECORD');
  const origin = parseWalletOrigin(record.origin);
  const uri = parseWalletUri(record.uri, origin);
  const operation = parseWalletOwnershipOperation(record.operation);
  const issuedAtEpochMilliseconds = parseSafeEpochMilliseconds(record.issuedAtEpochMilliseconds);
  const expiresAtEpochMilliseconds = parseSafeEpochMilliseconds(record.expiresAtEpochMilliseconds);
  validateChallengeWindow(issuedAtEpochMilliseconds, expiresAtEpochMilliseconds);
  return snapshotChallengeRecord({
    version: WALLET_OWNERSHIP_CHALLENGE_VERSION,
    challengeId,
    subjectBindingDigest,
    chainId,
    address,
    accountId,
    origin,
    uri,
    operation,
    issuedAtEpochMilliseconds,
    expiresAtEpochMilliseconds,
    nonceDigest: parseWalletDigest<'challenge-nonce'>(record.nonceDigest),
    messageDigest: parseWalletDigest<'challenge-message'>(record.messageDigest),
  });
}

function copyBytes(value: unknown, expectedLength: number | null): Uint8Array {
  try {
    if (
      TYPED_ARRAY_BUFFER_GETTER === undefined ||
      TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
      TYPED_ARRAY_BYTE_OFFSET_GETTER === undefined ||
      !ArrayBuffer.isView(value)
    ) {
      fail('INVALID_CHALLENGE_RECORD');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) {
      fail('INVALID_CHALLENGE_RECORD');
    }
    const buffer = TYPED_ARRAY_BUFFER_GETTER.call(value) as ArrayBufferLike;
    const byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value) as number;
    const byteOffset = TYPED_ARRAY_BYTE_OFFSET_GETTER.call(value) as number;
    if (
      !(buffer instanceof ArrayBuffer) ||
      (expectedLength !== null && byteLength !== expectedLength) ||
      (expectedLength === null && (byteLength === 0 || byteLength > MAX_MESSAGE_BYTES))
    ) {
      fail('INVALID_CHALLENGE_RECORD');
    }
    const source = new Uint8Array(buffer, byteOffset, byteLength);
    const snapshot = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) {
      snapshot[index] = source[index] ?? 0;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof WalletOwnershipValidationError) throw error;
    fail('INVALID_CHALLENGE_RECORD');
  }
}

function parseCanonicalEoaSignature(value: unknown): Hex {
  if (typeof value !== 'string' || !EOA_SIGNATURE_PATTERN.test(value)) {
    fail('INVALID_CHALLENGE_RECORD');
  }
  const r = BigInt(`0x${value.slice(2, 66)}`);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const recoveryByte = value.slice(130, 132);
  if (
    r <= 0n ||
    r >= SECP256K1_ORDER ||
    s <= 0n ||
    s > SECP256K1_HALF_ORDER ||
    (recoveryByte !== '00' &&
      recoveryByte !== '01' &&
      recoveryByte !== '1b' &&
      recoveryByte !== '1c')
  ) {
    fail('INVALID_CHALLENGE_RECORD');
  }
  return value as Hex;
}

function parseContractSignature(value: unknown): Hex {
  if (typeof value !== 'string' || !CONTRACT_SIGNATURE_PATTERN.test(value)) {
    fail('INVALID_CHALLENGE_RECORD');
  }
  return value as Hex;
}

function parseWalletOwnershipProof(value: unknown): WalletOwnershipProof {
  const kindRecord = ownDataRecord(
    value,
    new Set([...EOA_PROOF_KEYS, ...SOLANA_PROOF_KEYS]),
    'INVALID_CHALLENGE_RECORD',
  );
  const kind = kindRecord.kind;
  const allowedKeys =
    kind === 'EVM_EIP191_EOA'
      ? EOA_PROOF_KEYS
      : kind === 'EVM_ERC1271'
        ? ERC1271_PROOF_KEYS
        : kind === 'SOLANA_ED25519'
          ? SOLANA_PROOF_KEYS
          : null;
  if (allowedKeys === null) fail('INVALID_CHALLENGE_RECORD');
  const proof = ownDataRecord(value, allowedKeys, 'INVALID_CHALLENGE_RECORD');
  const challengeId = parseWalletChallengeId(proof.challengeId);
  if (kind === 'EVM_EIP191_EOA') {
    return Object.freeze({
      kind,
      challengeId,
      message: parseBoundedMessage(proof.message),
      signature: parseCanonicalEoaSignature(proof.signature),
    });
  }
  if (kind === 'EVM_ERC1271') {
    return Object.freeze({
      kind,
      challengeId,
      message: parseBoundedMessage(proof.message),
      signature: parseContractSignature(proof.signature),
    });
  }
  return Object.freeze({
    kind: 'SOLANA_ED25519',
    challengeId,
    address: parseSolanaWalletAddress(proof.address),
    publicKey: copyBytes(proof.publicKey, 32),
    signedMessage: copyBytes(proof.signedMessage, null),
    signature: copyBytes(proof.signature, 64),
  });
}

function parseVerificationRequest(value: unknown): WalletOwnershipVerificationRequest {
  const request = ownDataRecord(value, VERIFICATION_REQUEST_KEYS, 'INVALID_CHALLENGE_RECORD');
  const challengeState = request.challengeState;
  if (challengeState !== 'PENDING' && challengeState !== 'CONSUMED') {
    fail('INVALID_CHALLENGE_RECORD');
  }
  return Object.freeze({
    record: parseWalletOwnershipChallengeRecord(request.record),
    proof: parseWalletOwnershipProof(request.proof),
    expectedSubjectBindingDigest: parseWalletDigest<'subject-binding'>(
      request.expectedSubjectBindingDigest,
    ),
    expectedOrigin: parseWalletOrigin(request.expectedOrigin),
    expectedOperation: parseWalletOwnershipOperation(request.expectedOperation),
    challengeState,
    nowEpochMilliseconds: parseSafeEpochMilliseconds(request.nowEpochMilliseconds),
  });
}

function decodeCanonicalUtf8(value: Uint8Array): string {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    fail('INVALID_CHALLENGE_RECORD');
  }
  const encoded = Buffer.from(decoded, 'utf8');
  if (encoded.length !== value.length || !timingSafeEqual(encoded, value)) {
    fail('INVALID_CHALLENGE_RECORD');
  }
  return parseBoundedMessage(decoded);
}

function validateAndExtractNonce(
  messageValue: unknown,
  record: WalletOwnershipChallengeRecord,
): WalletChallengeNonce | null {
  let message: string;
  try {
    message = parseBoundedMessage(messageValue);
  } catch {
    return null;
  }
  const lines = message.split('\n');
  if (lines.length !== 17) return null;
  const nonceLine = lines[8];
  if (nonceLine === undefined || !nonceLine.startsWith('Nonce: ')) return null;
  let nonce: WalletChallengeNonce;
  try {
    nonce = parseWalletChallengeNonce(nonceLine.slice('Nonce: '.length));
  } catch {
    return null;
  }
  const canonicalMessage = createCanonicalMessage(record, nonce);
  if (
    canonicalMessage !== message ||
    !timingSafeDigestEqual(hashWalletChallengeNonce(nonce), record.nonceDigest) ||
    !timingSafeDigestEqual(hashWalletOwnershipMessage(message), record.messageDigest)
  ) {
    return null;
  }
  return nonce;
}

function rejected(reason: WalletOwnershipRejectionReason): WalletOwnershipVerificationResult {
  return Object.freeze({ status: 'REJECTED', reason });
}

function verified(
  record: WalletOwnershipChallengeRecord,
  proofKind: WalletOwnershipProofKind,
): WalletOwnershipVerificationResult {
  return Object.freeze({
    status: 'VERIFIED',
    challengeId: record.challengeId,
    proofKind,
    chainId: record.chainId,
    address: record.address,
    accountId: record.accountId,
    messageDigest: record.messageDigest,
  });
}

function verifySolanaSignature(
  record: WalletOwnershipChallengeRecord,
  proof: SolanaEd25519WalletOwnershipProof,
): boolean {
  try {
    if (proof.address !== record.address) return false;
    const expectedPublicKey = solanaWalletAddressBytes(proof.address);
    if (!timingSafeEqual(expectedPublicKey, proof.publicKey)) return false;
    validateEd25519PublicKeyBytes(proof.publicKey);
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(proof.publicKey)]),
      format: 'der',
      type: 'spki',
    });
    return verifyNodeSignature(
      null,
      Buffer.from(proof.signedMessage),
      publicKey,
      Buffer.from(proof.signature),
    );
  } catch {
    return false;
  }
}

/**
 * Verifies provider-neutral ownership evidence only. Atomic single-use consumption and
 * registration must occur in one repository transaction after this result; a stale PENDING
 * snapshot alone is not a concurrency boundary.
 */
export async function verifyWalletOwnershipProof(
  requestValue: WalletOwnershipVerificationRequest,
  options: WalletOwnershipVerificationOptions = {},
): Promise<WalletOwnershipVerificationResult> {
  let request: WalletOwnershipVerificationRequest;
  try {
    request = parseVerificationRequest(requestValue);
  } catch {
    return rejected('MALFORMED_REQUEST');
  }

  const { record, proof } = request;
  if (request.challengeState !== 'PENDING') return rejected('CHALLENGE_REPLAYED');
  if (request.nowEpochMilliseconds < record.issuedAtEpochMilliseconds) {
    return rejected('CHALLENGE_NOT_YET_VALID');
  }
  if (request.nowEpochMilliseconds >= record.expiresAtEpochMilliseconds) {
    return rejected('CHALLENGE_EXPIRED');
  }
  if (
    !timingSafeDigestEqual(request.expectedSubjectBindingDigest, record.subjectBindingDigest) ||
    request.expectedOrigin !== record.origin ||
    request.expectedOperation !== record.operation ||
    proof.challengeId !== record.challengeId
  ) {
    return rejected('BINDING_MISMATCH');
  }

  let message: string;
  if (proof.kind === 'SOLANA_ED25519') {
    if (walletNamespaceOf(record.chainId) !== 'solana') return rejected('BINDING_MISMATCH');
    try {
      message = decodeCanonicalUtf8(proof.signedMessage);
    } catch {
      return rejected('MESSAGE_MISMATCH');
    }
  } else {
    if (walletNamespaceOf(record.chainId) !== 'eip155') return rejected('BINDING_MISMATCH');
    message = proof.message;
  }
  if (validateAndExtractNonce(message, record) === null) {
    return rejected('MESSAGE_MISMATCH');
  }

  if (proof.kind === 'SOLANA_ED25519') {
    return verifySolanaSignature(record, proof)
      ? verified(record, proof.kind)
      : rejected('SIGNATURE_INVALID');
  }

  if (proof.kind === 'EVM_EIP191_EOA') {
    try {
      const recoveredAddress = await recoverMessageAddress({
        message,
        signature: proof.signature as Hex,
      });
      return parseEvmWalletAddress(recoveredAddress) === record.address
        ? verified(record, proof.kind)
        : rejected('SIGNATURE_INVALID');
    } catch {
      return rejected('SIGNATURE_INVALID');
    }
  }

  const verifier = options.erc1271Verifier;
  if (verifier === undefined) return rejected('CONTRACT_VERIFICATION_UNAVAILABLE');
  try {
    const decision = await verifier.verify(
      Object.freeze({
        challengeId: record.challengeId,
        chainId: record.chainId,
        contractAddress: record.address as EvmWalletAddress,
        eip191MessageHash: hashMessage(message),
        signature: proof.signature as Hex,
      }),
    );
    return decision === 'VALID'
      ? verified(record, proof.kind)
      : decision === 'INVALID'
        ? rejected('SIGNATURE_INVALID')
        : rejected('CONTRACT_VERIFICATION_UNAVAILABLE');
  } catch {
    return rejected('CONTRACT_VERIFICATION_UNAVAILABLE');
  }
}
