import {
  SOLANA_DEVNET_CHAIN,
  SOLANA_WALLET_LAB_DOMAIN,
  SOLANA_WALLET_LAB_ORIGIN,
  type DevnetSignInInput,
  type SolanaOwnershipCapability,
  type SolanaOwnershipVerification,
  type SolanaOwnershipVerificationFailure,
  type SolanaOwnershipVerificationOptions,
  type SolanaOwnershipVerificationRequest,
  type SolanaSignInResult,
  type SolanaSignMessageResult,
} from './types';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DEFAULT_ISSUED_AT_TOLERANCE_MS = 10 * 60 * 1_000;
const MAX_ADDRESS_LENGTH = 64;
const MAX_INPUT_STRING_LENGTH = 2_048;
const MAX_MESSAGE_LENGTH = 16_384;
const MAX_RESOURCES = 32;
const NONCE_PATTERN = /^[a-zA-Z0-9]{8,64}$/u;

type OwnershipMethod = Exclude<SolanaOwnershipCapability, null>;
type OwnershipProof = SolanaSignInResult | SolanaSignMessageResult;

function isBytes(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    'BYTES_PER_ELEMENT' in value &&
    value.BYTES_PER_ELEMENT === 1 &&
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function decodeBase58(value: string): Uint8Array | null {
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) return null;

  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) return null;
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

  let leadingZeroes = 0;
  while (value[leadingZeroes] === '1') leadingZeroes += 1;
  const significantLength = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  const decoded = new Uint8Array(leadingZeroes + significantLength);
  for (let index = 0; index < significantLength; index += 1) {
    decoded[decoded.length - index - 1] = bytes[index] ?? 0;
  }
  return decoded;
}

function blocked(
  method: OwnershipMethod,
  reason: SolanaOwnershipVerificationFailure,
): SolanaOwnershipVerification {
  return { status: 'blocked', reason, method, chain: SOLANA_DEVNET_CHAIN };
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_INPUT_STRING_LENGTH;
}

function parseDate(value: string): number | null {
  if (/\r|\n/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNow(options: SolanaOwnershipVerificationOptions): number | null {
  if (options.now === undefined) return Date.now();
  const now = options.now instanceof Date ? options.now.getTime() : options.now;
  return Number.isFinite(now) ? now : null;
}

function validateProof(
  proof: OwnershipProof,
  method: OwnershipMethod,
): SolanaOwnershipVerificationFailure | null {
  if (
    proof.method !== method ||
    proof.chain !== SOLANA_DEVNET_CHAIN ||
    proof.signatureType !== 'ed25519' ||
    typeof proof.address !== 'string' ||
    proof.account.address !== proof.address ||
    !isBytes(proof.account.publicKey) ||
    proof.account.publicKey.length !== 32 ||
    !isBytes(proof.signedMessage) ||
    proof.signedMessage.length === 0 ||
    proof.signedMessage.length > MAX_MESSAGE_LENGTH ||
    !isBytes(proof.signature) ||
    proof.signature.length !== 64
  ) {
    return 'invalid_proof';
  }

  const addressBytes = decodeBase58(proof.address);
  return addressBytes?.length === 32 && bytesEqual(addressBytes, proof.account.publicKey)
    ? null
    : 'account_mismatch';
}

function snapshotProof<T extends OwnershipProof>(proof: T): T {
  return {
    ...proof,
    account: {
      address: proof.account.address,
      publicKey: Uint8Array.from(proof.account.publicKey),
    },
    signedMessage: Uint8Array.from(proof.signedMessage),
    signature: Uint8Array.from(proof.signature),
  } as T;
}

function snapshotSignInInput(input: DevnetSignInInput): DevnetSignInInput {
  return {
    ...input,
    ...(input.resources === undefined ? {} : { resources: [...input.resources] }),
  };
}

function validateSignInInput(input: DevnetSignInInput): boolean {
  if (
    !isBoundedString(input.domain) ||
    !isBoundedString(input.address) ||
    !isBoundedString(input.uri) ||
    !isBoundedString(input.nonce) ||
    !isBoundedString(input.issuedAt) ||
    !isBoundedString(input.expirationTime) ||
    !isBoundedString(input.requestId) ||
    input.version !== '1' ||
    input.chainId !== SOLANA_DEVNET_CHAIN ||
    !NONCE_PATTERN.test(input.nonce) ||
    /\r|\n/u.test(input.requestId)
  ) {
    return false;
  }
  if (
    input.statement !== undefined &&
    (!isBoundedString(input.statement) || /\r|\n/u.test(input.statement))
  ) {
    return false;
  }
  if (input.notBefore !== undefined && !isBoundedString(input.notBefore)) return false;
  if (
    input.resources !== undefined &&
    (!Array.isArray(input.resources) ||
      input.resources.length > MAX_RESOURCES ||
      input.resources.some((resource) => {
        if (!isBoundedString(resource) || /\r|\n/u.test(resource)) return true;
        try {
          new URL(resource);
          return false;
        } catch {
          return true;
        }
      }))
  ) {
    return false;
  }
  return true;
}

/**
 * Constructs the exact UTF-8 SIWS message defined by Phantom's published Wallet Standard
 * algorithm. Verification still needs to validate the input policy and Ed25519 signature.
 */
export function createDevnetSignInMessage(input: DevnetSignInInput): Uint8Array {
  let message = `${input.domain} wants you to sign in with your Solana account:\n${input.address}`;
  if (input.statement !== undefined) message += `\n\n${input.statement}`;

  const fields = [
    `URI: ${input.uri}`,
    `Version: ${input.version}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  ];
  if (input.notBefore !== undefined) fields.push(`Not Before: ${input.notBefore}`);
  fields.push(`Request ID: ${input.requestId}`);
  if (input.resources !== undefined) {
    fields.push('Resources:', ...input.resources.map((resource) => `- ${resource}`));
  }
  message += `\n\n${fields.join('\n')}`;
  return new TextEncoder().encode(message);
}

function bufferFromBytes(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

async function verifySignature(
  proof: OwnershipProof,
  options: SolanaOwnershipVerificationOptions,
): Promise<SolanaOwnershipVerificationFailure | null> {
  const subtle =
    options.subtle === undefined
      ? typeof globalThis.crypto === 'object'
        ? globalThis.crypto.subtle
        : null
      : options.subtle;
  if (subtle === null || subtle === undefined) return 'crypto_unavailable';

  try {
    const key = await subtle.importKey(
      'raw',
      bufferFromBytes(proof.account.publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const valid = await subtle.verify(
      { name: 'Ed25519' },
      key,
      bufferFromBytes(proof.signature),
      bufferFromBytes(proof.signedMessage),
    );
    return valid ? null : 'invalid_signature';
  } catch (error) {
    let name: unknown;
    try {
      name = typeof error === 'object' && error !== null ? Reflect.get(error, 'name') : undefined;
    } catch {
      // Keep WebCrypto failures sanitized.
    }
    return name === 'NotSupportedError' ? 'crypto_unavailable' : 'verification_failed';
  }
}

async function verifySignIn(
  request: Extract<SolanaOwnershipVerificationRequest, { method: 'solana:signIn' }>,
  options: SolanaOwnershipVerificationOptions,
): Promise<SolanaOwnershipVerification> {
  const proofFailure = validateProof(request.result, request.method);
  if (proofFailure !== null) return blocked(request.method, proofFailure);
  const input = snapshotSignInInput(request.input);
  const proof = snapshotProof(request.result);
  if (!validateSignInInput(input)) return blocked(request.method, 'invalid_expected_input');
  if (proof.address !== input.address) return blocked(request.method, 'account_mismatch');

  let expectedOrigin: URL;
  let requestUri: URL;
  try {
    expectedOrigin = new URL(request.expectedOrigin);
    requestUri = new URL(input.uri);
  } catch {
    return blocked(request.method, 'invalid_expected_input');
  }
  if (
    expectedOrigin.username !== '' ||
    expectedOrigin.password !== '' ||
    requestUri.username !== '' ||
    requestUri.password !== ''
  ) {
    return blocked(request.method, 'invalid_expected_input');
  }
  if (
    request.expectedOrigin !== SOLANA_WALLET_LAB_ORIGIN ||
    expectedOrigin.origin !== SOLANA_WALLET_LAB_ORIGIN ||
    requestUri.origin !== SOLANA_WALLET_LAB_ORIGIN ||
    requestUri.origin !== expectedOrigin.origin ||
    input.domain !== SOLANA_WALLET_LAB_DOMAIN ||
    requestUri.host !== SOLANA_WALLET_LAB_DOMAIN
  ) {
    return blocked(request.method, 'origin_mismatch');
  }

  const now = getNow(options);
  const tolerance = options.issuedAtToleranceMs ?? DEFAULT_ISSUED_AT_TOLERANCE_MS;
  const issuedAt = parseDate(input.issuedAt);
  const expirationTime = parseDate(input.expirationTime);
  const notBefore = input.notBefore === undefined ? null : parseDate(input.notBefore);
  if (
    now === null ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    issuedAt === null ||
    expirationTime === null ||
    (input.notBefore !== undefined && notBefore === null)
  ) {
    return blocked(request.method, 'invalid_time');
  }
  if (Math.abs(issuedAt - now) > tolerance) {
    return blocked(request.method, 'issued_at_out_of_range');
  }
  if (expirationTime <= now) return blocked(request.method, 'expired');
  if (expirationTime <= issuedAt || (notBefore !== null && notBefore >= expirationTime)) {
    return blocked(request.method, 'invalid_time');
  }
  if (notBefore !== null && notBefore > now) return blocked(request.method, 'not_yet_valid');

  if (!bytesEqual(proof.signedMessage, createDevnetSignInMessage(input))) {
    return blocked(request.method, 'message_mismatch');
  }
  const signatureFailure = await verifySignature(proof, options);
  if (signatureFailure !== null) return blocked(request.method, signatureFailure);
  return {
    status: 'locally-verified',
    reason: null,
    method: request.method,
    chain: SOLANA_DEVNET_CHAIN,
    address: proof.address,
  };
}

async function verifySignMessage(
  request: Extract<SolanaOwnershipVerificationRequest, { method: 'solana:signMessage' }>,
  options: SolanaOwnershipVerificationOptions,
): Promise<SolanaOwnershipVerification> {
  const proofFailure = validateProof(request.result, request.method);
  if (proofFailure !== null) return blocked(request.method, proofFailure);
  const proof = snapshotProof(request.result);
  const expectedMessage = isBytes(request.expectedMessage)
    ? Uint8Array.from(request.expectedMessage)
    : request.expectedMessage;
  if (
    typeof request.expectedAddress !== 'string' ||
    !isBytes(expectedMessage) ||
    expectedMessage.length === 0 ||
    expectedMessage.length > MAX_MESSAGE_LENGTH
  ) {
    return blocked(request.method, 'invalid_expected_input');
  }
  if (proof.address !== request.expectedAddress) {
    return blocked(request.method, 'account_mismatch');
  }
  if (!bytesEqual(proof.signedMessage, expectedMessage)) {
    return blocked(request.method, 'message_mismatch');
  }
  const signatureFailure = await verifySignature(proof, options);
  if (signatureFailure !== null) return blocked(request.method, signatureFailure);
  return {
    status: 'locally-verified',
    reason: null,
    method: request.method,
    chain: SOLANA_DEVNET_CHAIN,
    address: proof.address,
  };
}

/**
 * Locally verifies exact-message ownership. `locally-verified` is not a session: a server must
 * still issue and atomically consume the nonce/request ID to prevent replay.
 */
export async function verifySolanaOwnership(
  request: SolanaOwnershipVerificationRequest,
  options: SolanaOwnershipVerificationOptions = {},
): Promise<SolanaOwnershipVerification> {
  try {
    return request.method === 'solana:signIn'
      ? await verifySignIn(request, options)
      : await verifySignMessage(request, options);
  } catch {
    return blocked(request.method, 'verification_failed');
  }
}
