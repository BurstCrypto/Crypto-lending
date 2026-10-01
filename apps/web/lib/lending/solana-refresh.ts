import { VersionedTransaction } from '@solana/web3.js';
import type { BridgeStep } from '../mainnet/bridge-types';

type SolanaReview = NonNullable<BridgeStep['solana']>;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** An unsigned review may get a new blockhash, but its accounts and instructions are immutable. */
export function assertRefreshedSolanaReview(original: SolanaReview, refreshed: SolanaReview) {
  const fail = () => {
    throw new Error('The refreshed Solana transaction differs from the review.');
  };
  if (
    original.version !== refreshed.version ||
    !Number.isSafeInteger(refreshed.contextSlot) ||
    refreshed.contextSlot < original.contextSlot ||
    !Number.isSafeInteger(refreshed.lastValidBlockHeight) ||
    refreshed.lastValidBlockHeight < original.lastValidBlockHeight
  )
    fail();
  const before = VersionedTransaction.deserialize(decode(original.serialized));
  const after = VersionedTransaction.deserialize(decode(refreshed.serialized));
  for (const [transaction, review] of [
    [before, original],
    [after, refreshed],
  ] as const) {
    if (
      transaction.version !== review.version ||
      encode(transaction.message.serialize()) !== review.message ||
      encode(transaction.serialize()) !== review.serialized ||
      transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))
    )
      fail();
  }
  after.message.recentBlockhash = before.message.recentBlockhash;
  if (encode(after.message.serialize()) !== original.message) fail();
}
