import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import test from 'node:test';

import {
  Ed25519PublicKeyInvalidError,
  isValidEd25519PublicKeyBytes,
  validateEd25519PublicKeyBytes,
} from './validate-ed25519-public-key.mjs';

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

function privateKeyFromSeed(seedHex) {
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return createPrivateKey({
    key: Buffer.concat([prefix, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
}

function rawPublicKey(key) {
  return createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12);
}

function littleEndian(value) {
  const result = Buffer.alloc(32);
  let remaining = value;
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function modularPower(base, exponent, modulus) {
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

test('accepts deterministic RFC 8032 prime-subgroup public keys', () => {
  for (const vector of RFC_8032_VECTORS) {
    const derived = rawPublicKey(privateKeyFromSeed(vector.seed));
    assert.equal(derived.toString('hex'), vector.publicKey);
    assert.equal(validateEd25519PublicKeyBytes(derived), true);
    assert.equal(isValidEd25519PublicKeyBytes(Buffer.from(vector.publicKey, 'hex')), true);
  }
});

test('rejects identity, small-order, negative-zero, and noncanonical encodings', () => {
  const fieldModulus = (1n << 255n) - 19n;
  const identity = Buffer.alloc(32);
  identity[0] = 1;
  const negativeZeroIdentity = Buffer.from(identity);
  negativeZeroIdentity[31] |= 0x80;
  const orderTwo = littleEndian(fieldModulus - 1n);
  const orderFour = Buffer.alloc(32);
  const noncanonicalY = littleEndian(fieldModulus);
  for (const invalidKey of [identity, negativeZeroIdentity, orderTwo, orderFour, noncanonicalY]) {
    assert.equal(isValidEd25519PublicKeyBytes(invalidKey), false);
    assert.throws(() => validateEd25519PublicKeyBytes(invalidKey), Ed25519PublicKeyInvalidError);
  }
});

test('rejects a canonical curve point outside the prime-order subgroup', () => {
  // B + (0,-1) = (-x_B,-y_B). It is a valid canonical point with a nonzero
  // order-two component, so structural or curve-membership checks alone miss it.
  const fieldModulus = (1n << 255n) - 19n;
  const basepointY = (4n * modularPower(5n, fieldModulus - 2n, fieldModulus)) % fieldModulus;
  const mixedY = (fieldModulus - basepointY) % fieldModulus;
  const mixedEncoding = littleEndian(mixedY);
  // The basepoint x coordinate is even; -x is odd.
  mixedEncoding[31] |= 0x80;
  assert.equal(isValidEd25519PublicKeyBytes(mixedEncoding), false);
});

test('rejects wrong lengths and non-byte inputs', () => {
  for (const value of [Buffer.alloc(31), Buffer.alloc(33), 'not bytes', null, {}]) {
    assert.equal(isValidEd25519PublicKeyBytes(value), false);
  }
});
