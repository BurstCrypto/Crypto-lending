import { PublicKey } from '@solana/web3.js';
import { fail } from './policy';

export function solanaAddress(value: unknown, signer = true): string {
  if (typeof value !== 'string' || value.length > 44) return fail('Enter a Solana public address.');
  try {
    const key = new PublicKey(value);
    if (
      key.toBase58() !== value ||
      key.equals(PublicKey.default) ||
      (signer && !PublicKey.isOnCurve(key.toBytes()))
    )
      return fail('Invalid Solana wallet address.');
    return value;
  } catch {
    return fail('Invalid Solana public address.');
  }
}
