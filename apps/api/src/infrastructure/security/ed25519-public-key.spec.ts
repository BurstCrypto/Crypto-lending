import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

import {
  Ed25519PublicKeyInvalidError,
  isValidEd25519PublicKeyBytes,
  validateEd25519PublicKeyBytes,
} from './ed25519-public-key';

const RFC_8032_VECTORS = Object.freeze([
  Object.freeze({
    seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  }),
  Object.freeze({
    seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
  }),
]);

const ED25519_TORSION_SUBGROUP = Object.freeze([
  '0100000000000000000000000000000000000000000000000000000000000000',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  '0000000000000000000000000000000000000000000000000000000000000080',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
  '0000000000000000000000000000000000000000000000000000000000000000',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
]);

function privateKeyFromSeed(seedHex: string): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(seedHex, 'hex'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}

function rawPublicKey(seedHex: string): Buffer {
  return createPublicKey(privateKeyFromSeed(seedHex))
    .export({ format: 'der', type: 'spki' })
    .subarray(12);
}

function littleEndian(value: bigint): Buffer {
  const result = Buffer.alloc(32);
  let remaining = value;
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function modularPower(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    remaining >>= 1n;
  }
  return result;
}

describe('Ed25519 public-key subgroup validation', () => {
  it('accepts deterministic RFC 8032 prime-subgroup keys', () => {
    for (const vector of RFC_8032_VECTORS) {
      const derived = rawPublicKey(vector.seed);
      expect(derived.toString('hex')).toBe(vector.publicKey);
      expect(validateEd25519PublicKeyBytes(derived)).toBe(true);
      expect(isValidEd25519PublicKeyBytes(Buffer.from(vector.publicKey, 'hex'))).toBe(true);
    }
  });

  it('rejects every point in the order-eight torsion subgroup', () => {
    for (const encoding of ED25519_TORSION_SUBGROUP) {
      const point = Buffer.from(encoding, 'hex');
      expect(isValidEd25519PublicKeyBytes(point)).toBe(false);
      expect(() => validateEd25519PublicKeyBytes(point)).toThrow(Ed25519PublicKeyInvalidError);
    }
  });

  it('rejects noncanonical and negative-zero encodings', () => {
    const fieldModulus = (1n << 255n) - 19n;
    const negativeZeroIdentity = Buffer.alloc(32);
    negativeZeroIdentity[0] = 1;
    negativeZeroIdentity[31] = 0x80;
    for (const encoding of [negativeZeroIdentity, littleEndian(fieldModulus)]) {
      expect(isValidEd25519PublicKeyBytes(encoding)).toBe(false);
    }
  });

  it('rejects a canonical mixed-order curve point', () => {
    const fieldModulus = (1n << 255n) - 19n;
    const basepointY = (4n * modularPower(5n, fieldModulus - 2n, fieldModulus)) % fieldModulus;
    const mixedEncoding = littleEndian((fieldModulus - basepointY) % fieldModulus);
    mixedEncoding[31] = (mixedEncoding[31] ?? 0) | 0x80;
    expect(isValidEd25519PublicKeyBytes(mixedEncoding)).toBe(false);
  });

  it('rejects wrong lengths, non-byte values, proxies, and subclasses without iterating', () => {
    let iterated = false;
    class ExoticBytes extends Uint8Array {
      override [Symbol.iterator](): ArrayIterator<number> {
        iterated = true;
        return super[Symbol.iterator]();
      }
    }
    const exotic = new ExoticBytes(32);
    const proxied = new Proxy(Uint8Array.from(rawPublicKey(RFC_8032_VECTORS[0]!.seed)), {});
    for (const value of [Buffer.alloc(31), Buffer.alloc(33), 'bytes', null, proxied, exotic]) {
      expect(isValidEd25519PublicKeyBytes(value)).toBe(false);
    }
    expect(iterated).toBe(false);
  });
});
