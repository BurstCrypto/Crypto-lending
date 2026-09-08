import { createPublicKey, timingSafeEqual, verify as verifyNodeSignature } from 'node:crypto';

import { VersionedTransaction } from '@solana/web3.js';

import { validateEd25519PublicKeyBytes } from '../../infrastructure/security/ed25519-public-key';
import { parseSolanaWalletAddress } from '../../wallets/domain/wallet-identity';
import {
  sha256Bytes,
  sha256Framed,
} from '../domain/mainnet-financial-action-signed-verification-digest';

export const SOLANA_MAINNET_SIGNED_TRANSACTION_MAXIMUM_BYTES = 1_232;

const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function encodeBase58(value: Uint8Array): string {
  const digits = [0];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeroBytes = 0;
  while (leadingZeroBytes < value.length && value[leadingZeroBytes] === 0) {
    leadingZeroBytes += 1;
  }
  const significantDigits = digits.length === 1 && digits[0] === 0 ? [] : digits;
  return (
    '1'.repeat(leadingZeroBytes) +
    significantDigits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('')
  );
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
  let canonical: Uint8Array | undefined;
  try {
    const transaction = VersionedTransaction.deserialize(serialized);
    canonical = transaction.serialize();
    if (!sameBytes(canonical, serialized)) return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');

    const { message } = transaction;
    if (
      (transaction.version !== 'legacy' && transaction.version !== 0) ||
      message.addressTableLookups.length !== 0 ||
      message.header.numRequiredSignatures !== 1 ||
      message.header.numReadonlySignedAccounts !== 0 ||
      transaction.signatures.length !== 1 ||
      message.staticAccountKeys.length === 0 ||
      !message.isAccountSigner(0) ||
      !message.isAccountWritable(0)
    ) {
      return rejected('UNSUPPORTED_SOLANA_TRANSACTION');
    }

    const distinctStaticKeys = new Set(message.staticAccountKeys.map((key) => key.toBase58()));
    if (distinctStaticKeys.size !== message.staticAccountKeys.length) {
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    }

    const signerPublicKey = message.staticAccountKeys[0];
    const signature = transaction.signatures[0];
    if (
      signerPublicKey === undefined ||
      signature === undefined ||
      signature.length !== 64 ||
      isAllZero(signature)
    ) {
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    }
    const signerWalletAddress = signerPublicKey.toBase58();
    if (signerWalletAddress !== expectedWalletAddress) {
      return rejected('SOLANA_SIGNER_MISMATCH');
    }

    try {
      validateEd25519PublicKeyBytes(signerPublicKey.toBytes());
    } catch {
      return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
    }
    messageBytes = message.serialize();
    try {
      const key = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, signerPublicKey.toBuffer()]),
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
      const programId = program.toBase58();
      if (isDurableNonceAdvance(programId, instruction.data)) {
        return rejected('UNSUPPORTED_SOLANA_TRANSACTION');
      }
      const accounts = instruction.accountKeyIndexes.map((index) => {
        const account = message.staticAccountKeys[index];
        if (account === undefined) return rejected('INVALID_SOLANA_SIGNED_TRANSACTION');
        referencedStaticKeyIndexes.add(index);
        return Object.freeze({
          address: account.toBase58(),
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
    const transactionId = encodeBase58(signature);

    return Object.freeze({
      kind: 'VERIFIED_SOLANA_SIGNED_TRANSACTION' as const,
      networkId: SOLANA_MAINNET,
      messageVersion: transaction.version,
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
    canonical?.fill(0);
  }
}
