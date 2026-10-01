import { createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';

const messages = new WeakMap<VersionedTransaction, Buffer>();

/** Internal builder boundary. Call only on the transaction constructed from the admitted intent. */
export function rememberSolanaDestination(transaction: VersionedTransaction): VersionedTransaction {
  if (messages.has(transaction)) throw new Error('DESTINATION_ALREADY_PREPARED');
  messages.set(transaction, Buffer.from(transaction.message.serialize()));
  return transaction;
}

/** The browser broadcasts these verified bytes, never a wallet-modified message. */
export function verifySignedSolanaDestination(
  prepared: VersionedTransaction,
  signed: VersionedTransaction,
): Uint8Array {
  const expected = messages.get(prepared);
  const message = Buffer.from(signed.message.serialize());
  if (
    !expected?.equals(message) ||
    signed.signatures.length !== signed.message.header.numRequiredSignatures
  ) {
    throw new Error('SIGNED_DESTINATION_TRANSACTION_MISMATCH');
  }
  for (let index = 0; index < signed.signatures.length; index += 1) {
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        signed.message.staticAccountKeys[index]!.toBuffer(),
      ]),
      format: 'der',
      type: 'spki',
    });
    if (!verify(null, message, publicKey, signed.signatures[index]!))
      throw new Error('INVALID_DESTINATION_SIGNATURE');
  }
  const serialized = signed.serialize();
  if (serialized.length > 1232) throw new Error('DESTINATION_TRANSACTION_TOO_LARGE');
  return serialized;
}
