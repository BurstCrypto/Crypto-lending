const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Canonical base58 only; this decoder accepts public program IDs as well as wallets. */
export function decodeCanonicalSolanaPublicKey(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value)) {
    throw new TypeError('Invalid Solana public key');
  }
  let integer = 0n;
  for (const character of value) integer = integer * 58n + BigInt(ALPHABET.indexOf(character));
  if (integer >= 1n << 256n) throw new TypeError('Invalid Solana public key');
  const bytes = Buffer.from(integer.toString(16).padStart(64, '0'), 'hex');
  if (encodeSolanaBase58(bytes) !== value) throw new TypeError('Invalid Solana public key');
  return bytes;
}

export function encodeSolanaBase58(bytes: Uint8Array): string {
  let integer = 0n;
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  for (const byte of bytes) integer = integer * 256n + BigInt(byte);
  let result = '';
  while (integer > 0n) {
    result = (ALPHABET[Number(integer % 58n)] ?? '') + result;
    integer /= 58n;
  }
  return '1'.repeat(leadingZeros) + result;
}
