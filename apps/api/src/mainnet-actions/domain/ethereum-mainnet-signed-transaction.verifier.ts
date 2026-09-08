import {
  hexToBytes,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  type Hex,
  type TransactionSerialized,
} from 'viem';

import { parseEvmWalletAddress } from '../../wallets/domain/wallet-identity';
import { sha256Bytes, sha256Framed } from './mainnet-financial-action-signed-verification-digest';

export const ETHEREUM_MAINNET_SIGNED_TRANSACTION_MAXIMUM_BYTES = 128 * 1_024;

const LOWERCASE_TYPE_2_TRANSACTION = /^0x02(?:[0-9a-f]{2})+$/u;
const CANONICAL_UINT256 = /^(?:0|[1-9][0-9]*)$/u;
const SECP256K1_ORDER = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
);
const SECP256K1_HALF_ORDER = SECP256K1_ORDER >> 1n;

export type EthereumMainnetSignedTransactionVerificationCode =
  | 'INVALID_ETHEREUM_SIGNED_TRANSACTION'
  | 'UNSUPPORTED_ETHEREUM_TRANSACTION'
  | 'ETHEREUM_SIGNER_MISMATCH'
  | 'ETHEREUM_NETWORK_FEE_LIMIT_EXCEEDED';

export class EthereumMainnetSignedTransactionVerificationError extends Error {
  constructor(readonly code: EthereumMainnetSignedTransactionVerificationCode) {
    super(code);
    this.name = 'EthereumMainnetSignedTransactionVerificationError';
  }
}

export interface VerifyEthereumMainnetSignedTransactionInput {
  readonly signedTransaction: string;
  readonly expectedWalletAddress: string;
  readonly maximumNetworkFeeAtomic: string;
}

export interface VerifiedEthereumMainnetSignedTransaction {
  readonly kind: 'VERIFIED_ETHEREUM_EIP1559_TRANSACTION';
  readonly networkId: 'eip155:1';
  readonly transactionId: string;
  readonly signerWalletAddress: string;
  readonly nonce: string;
  readonly transactionTarget: string;
  readonly calldata: string;
  readonly gasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  readonly maximumNetworkFeeAtomic: string;
  readonly signedEnvelopeSha256: string;
  readonly signingPayloadSha256: string;
  readonly signatureEvidenceSha256: string;
  readonly chainReplayIdentitySha256: string;
}

function rejected(code: EthereumMainnetSignedTransactionVerificationCode): never {
  throw new EthereumMainnetSignedTransactionVerificationError(code);
}

function parseMaximumNetworkFee(value: unknown): bigint {
  if (typeof value !== 'string' || !CANONICAL_UINT256.test(value)) {
    return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
  }
  try {
    const parsed = BigInt(value);
    if (parsed >= 1n << 256n) return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
    return parsed;
  } catch {
    return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
  }
}

function signatureScalar(value: Hex | undefined): bigint {
  if (value === undefined || !/^0x[0-9a-f]{64}$/u.test(value)) {
    return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
  }
  try {
    return BigInt(value);
  } catch {
    return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
  }
}

/**
 * Pure, offline verification for the deliberately narrow first Ethereum slice:
 * canonical, signed EIP-1559 transactions on chain 1 from an EOA. Dynamic
 * nonce, balance, code, and deployment facts remain outside this claim.
 */
export async function verifyEthereumMainnetSignedTransaction(
  input: VerifyEthereumMainnetSignedTransactionInput,
): Promise<VerifiedEthereumMainnetSignedTransaction> {
  if (
    typeof input !== 'object' ||
    input === null ||
    !LOWERCASE_TYPE_2_TRANSACTION.test(input.signedTransaction) ||
    (input.signedTransaction.length - 2) / 2 > ETHEREUM_MAINNET_SIGNED_TRANSACTION_MAXIMUM_BYTES
  ) {
    return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
  }

  let expectedWalletAddress: string;
  try {
    expectedWalletAddress = parseEvmWalletAddress(input.expectedWalletAddress);
  } catch {
    return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
  }
  const maximumNetworkFee = parseMaximumNetworkFee(input.maximumNetworkFeeAtomic);
  const raw = input.signedTransaction as `0x02${string}`;
  const envelopeBytes = Buffer.from(raw.slice(2), 'hex');

  try {
    const transaction = parseTransaction(raw);
    if (
      transaction.type !== 'eip1559' ||
      transaction.chainId !== 1 ||
      transaction.to === undefined ||
      transaction.gas === undefined ||
      transaction.gas <= 0n ||
      transaction.maxFeePerGas === undefined ||
      transaction.maxFeePerGas <= 0n ||
      transaction.maxPriorityFeePerGas === undefined ||
      transaction.maxPriorityFeePerGas < 0n ||
      transaction.maxPriorityFeePerGas > transaction.maxFeePerGas ||
      (transaction.value ?? 0n) !== 0n ||
      (transaction.accessList?.length ?? 0) !== 0 ||
      transaction.r === undefined ||
      transaction.s === undefined ||
      transaction.yParity === undefined ||
      (transaction.yParity !== 0 && transaction.yParity !== 1)
    ) {
      return rejected('UNSUPPORTED_ETHEREUM_TRANSACTION');
    }

    const r = signatureScalar(transaction.r);
    const s = signatureScalar(transaction.s);
    if (r <= 0n || r >= SECP256K1_ORDER || s <= 0n || s > SECP256K1_HALF_ORDER) {
      return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
    }

    const canonical = serializeTransaction(transaction);
    if (canonical !== raw) return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');

    const feeUpperBound = transaction.gas * transaction.maxFeePerGas;
    if (feeUpperBound > maximumNetworkFee) {
      return rejected('ETHEREUM_NETWORK_FEE_LIMIT_EXCEEDED');
    }

    let signerWalletAddress: string;
    try {
      signerWalletAddress = parseEvmWalletAddress(
        await recoverTransactionAddress({
          serializedTransaction: raw as TransactionSerialized,
        }),
      );
    } catch {
      return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
    }
    if (signerWalletAddress !== expectedWalletAddress) {
      return rejected('ETHEREUM_SIGNER_MISMATCH');
    }

    const { r: _r, s: _s, v: _v, yParity: _yParity, ...unsignedTransaction } = transaction;
    void _r;
    void _s;
    void _v;
    void _yParity;
    const signingPayload = serializeTransaction(unsignedTransaction);
    const transactionId = keccak256(raw);
    const nonce = String(transaction.nonce ?? 0);
    const signatureEvidenceSha256 = sha256Framed('CLMA-EVM-SIGNATURE-EVIDENCE-1', [
      'eip155:1',
      signerWalletAddress,
      String(transaction.yParity),
      transaction.r,
      transaction.s,
    ]);

    return Object.freeze({
      kind: 'VERIFIED_ETHEREUM_EIP1559_TRANSACTION' as const,
      networkId: 'eip155:1' as const,
      transactionId,
      signerWalletAddress,
      nonce,
      transactionTarget: parseEvmWalletAddress(transaction.to),
      calldata: (transaction.data ?? '0x').toLowerCase(),
      gasLimit: transaction.gas.toString(),
      maxFeePerGas: transaction.maxFeePerGas.toString(),
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
      maximumNetworkFeeAtomic: maximumNetworkFee.toString(),
      signedEnvelopeSha256: sha256Bytes(envelopeBytes),
      signingPayloadSha256: sha256Bytes(hexToBytes(signingPayload)),
      signatureEvidenceSha256,
      chainReplayIdentitySha256: sha256Framed('CLMA-CHAIN-REPLAY-IDENTITY-1', [
        'eip155:1',
        signerWalletAddress,
        nonce,
      ]),
    });
  } catch (error) {
    if (error instanceof EthereumMainnetSignedTransactionVerificationError) throw error;
    return rejected('INVALID_ETHEREUM_SIGNED_TRANSACTION');
  } finally {
    envelopeBytes.fill(0);
  }
}
