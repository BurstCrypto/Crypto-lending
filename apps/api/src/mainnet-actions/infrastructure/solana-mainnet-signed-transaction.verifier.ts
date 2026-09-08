import { createPublicKey, verify as verifyNodeSignature } from 'node:crypto';

import { validateEd25519PublicKeyBytes } from '../../infrastructure/security/ed25519-public-key';
import { parseSolanaWalletAddress } from '../../wallets/domain/wallet-identity';
import {
  sha256Bytes,
  sha256Framed,
} from '../domain/mainnet-financial-action-signed-verification-digest';
import { encodeSolanaBase58 } from './solana-mainnet-public-key.codec';

export const SOLANA_MAINNET_SIGNED_TRANSACTION_MAXIMUM_BYTES = 1_232;

const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const ADVANCE_NONCE_ACCOUNT_INSTRUCTION = 4;

export type SolanaMainnetSignedTransactionVerificationCode =
  'INVALID_SOLANA_SIGNED_TRANSACTION' | 'UNSUPPORTED_SOLANA_TRANSACTION' | 'SOLANA_SIGNER_MISMATCH';

export class SolanaMainnetSignedTransactionVerificationError extends Error {
  constructor(readonly code: SolanaMainnetSignedTransactionVerificationCode) {
    super(code);
    this.name = 'SolanaMainnetSignedTransactionVerificationError';
  }
}

export interface VerifySolanaMainnetSignedTransactionInput {
  readonly signedTransactionBase64: string;
  readonly expectedWalletAddress: string;
}

export interface VerifiedSolanaInstructionAccount {
  readonly address: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface VerifiedSolanaInstruction {
  readonly programId: string;
  readonly accounts: readonly VerifiedSolanaInstructionAccount[];
  readonly dataHex: string;
}

export interface VerifiedSolanaMainnetSignedTransaction {
  readonly kind: 'VERIFIED_SOLANA_SIGNED_TRANSACTION';
  readonly networkId: typeof SOLANA_MAINNET;
  readonly messageVersion: 'legacy' | 0;
  readonly transactionId: string;
  readonly signerWalletAddress: string;
  readonly recentBlockhash: string;
  readonly instructions: readonly VerifiedSolanaInstruction[];
  readonly signedEnvelopeSha256: string;
  readonly signingPayloadSha256: string;
  readonly signatureEvidenceSha256: string;
  readonly chainReplayIdentitySha256: string;
}

function rejected(code: SolanaMainnetSignedTransactionVerificationCode): never {
  throw new SolanaMainnetSignedTransactionVerificationError(code);
}

interface ParsedSolanaEnvelope {
  readonly version: 'legacy' | 0;
  readonly signature: Buffer;
  readonly messageBytes: Buffer;
  readonly staticAccountKeys: readonly Buffer[];
  readonly recentBlockhash: string;
  readonly compiledInstructions: readonly {
    readonly programIdIndex: number;
    readonly accountKeyIndexes: readonly number[];
    readonly data: Buffer;
  }[];
  readonly isAccountSigner: (index: number) => boolean;
  readonly isAccountWritable: (index: number) => boolean;
}

/** Bounded canonical wire reader: https://solana.com/docs/core/transactions/structure */
function parseSignedEnvelope(serialized: Buffer): ParsedSolanaEnvelope {
  let offset = 0;
  const take = (length: number): Buffer => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > serialized.length)
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    const bytes = serialized.subarray(offset, offset + length);
    offset += length;
    return bytes;
  };
  const byte = (): number => take(1)[0] as number;
  const shortVectorLength = (): number => {
    let value = 0;
    for (let index = 0; index < 3; index += 1) {
      const next = byte();
      const payload = next & 0x7f;
      if ((index === 2 && next > 3) || (index > 0 && payload === 0 && next < 0x80))
        return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
      value += payload * 2 ** (index * 7);
      if (next < 0x80) return value;
    }
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  };
  if (shortVectorLength() !== 1) return rejected('UNSUPPORTED_SOLANA_TRANSACTION');
  const signature = take(64);
  const messageStart = offset;
  const prefix = byte();
  if (prefix > 0x80) return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  const version = prefix === 0x80 ? 0 : 'legacy';
  const requiredSignatures = version === 0 ? byte() : prefix;
  const readonlySignedAccounts = byte();
  const readonlyUnsignedAccounts = byte();
  if (requiredSignatures !== 1 || readonlySignedAccounts !== 0)
    return rejected('UNSUPPORTED_SOLANA_TRANSACTION');
  const keyCount = shortVectorLength();
  if (keyCount < 1 || keyCount > 256 || readonlyUnsignedAccounts > keyCount - 1)
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  const staticAccountKeys = Array.from({ length: keyCount }, () => take(32));
  const recentBlockhash = encodeSolanaBase58(take(32));
  const instructionCount = shortVectorLength();
  if (instructionCount > serialized.length - offset)
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  const compiledInstructions = Array.from({ length: instructionCount }, () => {
    const programIdIndex = byte();
    const accountKeyIndexes = Array.from(take(shortVectorLength()));
    const data = take(shortVectorLength());
    return { programIdIndex, accountKeyIndexes, data };
  });
  if (version === 0 && shortVectorLength() !== 0) return rejected('UNSUPPORTED_SOLANA_TRANSACTION');
  if (offset !== serialized.length) return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  if (
    compiledInstructions.some(
      ({ programIdIndex, accountKeyIndexes }) =>
        programIdIndex === 0 ||
        programIdIndex >= keyCount ||
        accountKeyIndexes.some((index) => index >= keyCount),
    )
  )
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  return {
    version,
    signature,
    messageBytes: serialized.subarray(messageStart),
    staticAccountKeys,
    recentBlockhash,
    compiledInstructions,
    isAccountSigner: (index: number): boolean => index === 0,
    isAccountWritable: (index: number): boolean => index < keyCount - readonlyUnsignedAccounts,
  };
}

function isAllZero(value: Uint8Array): boolean {
  let aggregate = 0;
  for (const byte of value) aggregate |= byte;
  return aggregate === 0;
}

function isDurableNonceAdvance(programId: string, data: Uint8Array): boolean {
  return (
    programId === SYSTEM_PROGRAM_ID &&
    data.length >= 4 &&
    Buffer.from(data).readUInt32LE(0) === ADVANCE_NONCE_ACCOUNT_INSTRUCTION
  );
}

/**
 * Verifies a complete canonical legacy or v0-without-ALT Solana transaction.
 * The initial dormant slice deliberately permits exactly one signer/fee payer
 * and rejects durable nonce instructions and unresolved lookup-table accounts.
 */
export function verifySolanaMainnetSignedTransaction(
  input: VerifySolanaMainnetSignedTransactionInput,
): VerifiedSolanaMainnetSignedTransaction {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.signedTransactionBase64 !== 'string' ||
    input.signedTransactionBase64.length === 0 ||
    input.signedTransactionBase64.length >
      Math.ceil(SOLANA_MAINNET_SIGNED_TRANSACTION_MAXIMUM_BYTES / 3) * 4 ||
    !CANONICAL_BASE64.test(input.signedTransactionBase64)
  ) {
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  }

  let expectedWalletAddress: string;
  try {
    expectedWalletAddress = parseSolanaWalletAddress(input.expectedWalletAddress);
  } catch {
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  }

  const serialized = Buffer.from(input.signedTransactionBase64, 'base64');
  if (
    serialized.length === 0 ||
    serialized.length > SOLANA_MAINNET_SIGNED_TRANSACTION_MAXIMUM_BYTES ||
    serialized.toString('base64') !== input.signedTransactionBase64
  ) {
    serialized.fill(0);
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  }

  let messageBytes: Uint8Array | undefined;
  try {
    const message = parseSignedEnvelope(serialized);

    const distinctStaticKeys = new Set(message.staticAccountKeys.map(encodeSolanaBase58));
    if (distinctStaticKeys.size !== message.staticAccountKeys.length) {
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    }

    const signerPublicKey = message.staticAccountKeys[0];
    const signature = message.signature;
    if (
      signerPublicKey === undefined ||
      signature === undefined ||
      signature.length !== 64 ||
      isAllZero(signature)
    ) {
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    }
    const signerWalletAddress = encodeSolanaBase58(signerPublicKey);
    if (signerWalletAddress !== expectedWalletAddress) {
      return rejected('SOLANA_SIGNER_MISMATCH');
    }

    try {
      validateEd25519PublicKeyBytes(signerPublicKey);
    } catch {
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    }
    messageBytes = message.messageBytes;
    try {
      const key = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, signerPublicKey]),
        format: 'der',
        type: 'spki',
      });
      if (!verifyNodeSignature(null, messageBytes, key, signature)) {
        return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
      }
    } catch (error) {
      if (error instanceof SolanaMainnetSignedTransactionVerificationError) throw error;
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    }

    const referencedStaticKeyIndexes = new Set<number>([0]);
    const instructions = message.compiledInstructions.map((instruction) => {
      const program = message.staticAccountKeys[instruction.programIdIndex];
      if (program === undefined) return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
      referencedStaticKeyIndexes.add(instruction.programIdIndex);
      const programId = encodeSolanaBase58(program);
      if (isDurableNonceAdvance(programId, instruction.data)) {
        return rejected('UNSUPPORTED_SOLANA_TRANSACTION');
      }
      const accounts = instruction.accountKeyIndexes.map((index) => {
        const account = message.staticAccountKeys[index];
        if (account === undefined) return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
        referencedStaticKeyIndexes.add(index);
        return Object.freeze({
          address: encodeSolanaBase58(account),
          isSigner: message.isAccountSigner(index),
          isWritable: message.isAccountWritable(index),
        });
      });
      return Object.freeze({
        programId,
        accounts: Object.freeze(accounts),
        dataHex: Buffer.from(instruction.data).toString('hex'),
      });
    });
    if (referencedStaticKeyIndexes.size !== message.staticAccountKeys.length) {
      return rejected('UNSUPPORTED_SOLANA_TRANSACTION');
    }
    const signedEnvelopeSha256 = sha256Bytes(serialized);
    const signingPayloadSha256 = sha256Bytes(messageBytes);
    const transactionId = encodeSolanaBase58(signature);

    return Object.freeze({
      kind: 'VERIFIED_SOLANA_SIGNED_TRANSACTION' as const,
      networkId: SOLANA_MAINNET,
      messageVersion: message.version,
      transactionId,
      signerWalletAddress,
      recentBlockhash: message.recentBlockhash,
      instructions: Object.freeze(instructions),
      signedEnvelopeSha256,
      signingPayloadSha256,
      signatureEvidenceSha256: sha256Framed('CLMA-SOLANA-SIGNATURE-EVIDENCE-1', [
        SOLANA_MAINNET,
        signerWalletAddress,
        transactionId,
      ]),
      chainReplayIdentitySha256: sha256Framed('CLMA-CHAIN-REPLAY-IDENTITY-1', [
        SOLANA_MAINNET,
        signerWalletAddress,
        message.recentBlockhash,
        signingPayloadSha256,
      ]),
    });
  } catch (error) {
    if (error instanceof SolanaMainnetSignedTransactionVerificationError) throw error;
    return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
  } finally {
    serialized.fill(0);
    messageBytes?.fill(0);
  }
}
