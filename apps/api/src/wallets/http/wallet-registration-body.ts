import {
  parseWalletChallengeId,
  type WalletOwnershipProof,
} from '../domain/wallet-ownership-proof';
import { parseSolanaWalletAddress } from '../domain/wallet-identity';

const ISSUE_KEYS = new Set(['chainId', 'address']);
const EVM_PROOF_KEYS = new Set(['kind', 'challengeId', 'message', 'signature']);
const SOLANA_PROOF_KEYS = new Set([
  'kind',
  'challengeId',
  'address',
  'publicKey',
  'signedMessage',
  'signature',
]);
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const EVM_EOA_SIGNATURE = /^0x[0-9a-f]{130}$/u;

export interface IssueWalletOwnershipChallengeBody {
  readonly chainId: string;
  readonly address: string;
}

export class WalletRegistrationBodyError extends Error {
  readonly code = 'WALLET_REGISTRATION_BODY_INVALID' as const;

  constructor() {
    super('Wallet registration request body is invalid');
    this.name = 'WalletRegistrationBodyError';
  }
}

function fail(): never {
  throw new WalletRegistrationBodyError();
}

function ownDataRecord(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !keys.has(key)) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      return fail();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ('value' in descriptor) record[key] = descriptor.value;
    }
    if (Object.keys(record).length !== keys.size) return fail();
    return record;
  } catch (error) {
    if (error instanceof WalletRegistrationBodyError) throw error;
    return fail();
  }
}

function boundedText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[\0\r]/u.test(value)
  ) {
    return fail();
  }
  return value;
}

function canonicalBase64Url(value: unknown, expectedBytes: number | null): Uint8Array {
  const text = boundedText(value, 5_462);
  if (!BASE64URL.test(text)) return fail();
  try {
    const bytes = Buffer.from(text, 'base64url');
    if (
      bytes.toString('base64url') !== text ||
      (expectedBytes !== null && bytes.length !== expectedBytes) ||
      (expectedBytes === null && (bytes.length < 1 || bytes.length > 4_096))
    ) {
      return fail();
    }
    return Uint8Array.from(bytes);
  } catch {
    return fail();
  }
}

export function parseIssueWalletOwnershipChallengeBody(
  value: unknown,
): IssueWalletOwnershipChallengeBody {
  const record = ownDataRecord(value, ISSUE_KEYS);
  return Object.freeze({
    chainId: boundedText(record.chainId, 96),
    address: boundedText(record.address, 128),
  });
}

export function parseSubmitWalletOwnershipProofBody(value: unknown): WalletOwnershipProof {
  try {
    let kind: unknown;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
      if (!descriptor || !('value' in descriptor)) return fail();
      kind = descriptor.value;
    } catch {
      return fail();
    }

    if (kind === 'EVM_EIP191_EOA') {
      const proof = ownDataRecord(value, EVM_PROOF_KEYS);
      const signature = boundedText(proof.signature, 132);
      if (!EVM_EOA_SIGNATURE.test(signature)) return fail();
      return Object.freeze({
        kind,
        challengeId: parseWalletChallengeId(proof.challengeId),
        message: boundedText(proof.message, 4_096),
        signature,
      });
    }
    if (kind === 'SOLANA_ED25519') {
      const proof = ownDataRecord(value, SOLANA_PROOF_KEYS);
      return Object.freeze({
        kind,
        challengeId: parseWalletChallengeId(proof.challengeId),
        address: parseSolanaWalletAddress(boundedText(proof.address, 44)),
        publicKey: canonicalBase64Url(proof.publicKey, 32),
        signedMessage: canonicalBase64Url(proof.signedMessage, null),
        signature: canonicalBase64Url(proof.signature, 64),
      });
    }
    return fail();
  } catch (error) {
    if (error instanceof WalletRegistrationBodyError) throw error;
    return fail();
  }
}

export const ISSUE_WALLET_OWNERSHIP_CHALLENGE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['chainId', 'address'],
  properties: {
    chainId: { type: 'string', maxLength: 96 },
    address: { type: 'string', maxLength: 128 },
  },
});

export const SUBMIT_WALLET_OWNERSHIP_PROOF_SCHEMA = Object.freeze({
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'challengeId', 'message', 'signature'],
      properties: {
        kind: { type: 'string', enum: ['EVM_EIP191_EOA'] },
        challengeId: { type: 'string', format: 'uuid' },
        message: { type: 'string', maxLength: 4_096 },
        signature: { type: 'string', minLength: 132, maxLength: 132 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'challengeId', 'address', 'publicKey', 'signedMessage', 'signature'],
      properties: {
        kind: { type: 'string', enum: ['SOLANA_ED25519'] },
        challengeId: { type: 'string', format: 'uuid' },
        address: { type: 'string', maxLength: 44 },
        publicKey: { type: 'string', minLength: 43, maxLength: 43 },
        signedMessage: { type: 'string', maxLength: 5_462 },
        signature: { type: 'string', minLength: 86, maxLength: 86 },
      },
    },
  ],
});
