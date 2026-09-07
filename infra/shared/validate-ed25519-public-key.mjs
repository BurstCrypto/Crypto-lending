/**
 * Pure, offline validation of a compressed Ed25519 public point.
 *
 * Generic DER parsers commonly accept encodings which are structurally valid
 * Ed25519 SubjectPublicKeyInfo values but whose point is the identity, has a
 * small order, or is outside the prime-order subgroup. Signature-verification
 * behavior for those points is not a trust boundary. This validator decodes
 * the RFC 8032 point itself and requires a non-identity point P satisfying
 * [L]P = identity, where L is the prime subgroup order.
 */

import { types as utilTypes } from 'node:util';

const FIELD_MODULUS = (1n << 255n) - 19n;
const SUBGROUP_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;
const CURVE_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const SQRT_MINUS_ONE =
  19681161376707505956807079304988542015446066515923890162744021073123829784752n;

export class Ed25519PublicKeyInvalidError extends Error {
  constructor() {
    super('Ed25519 public key is invalid');
    this.name = 'Ed25519PublicKeyInvalidError';
  }
}

function invalid() {
  throw new Ed25519PublicKeyInvalidError();
}

function modulo(value) {
  const remainder = value % FIELD_MODULUS;
  return remainder < 0n ? remainder + FIELD_MODULUS : remainder;
}

function modularPower(base, exponent) {
  let result = 1n;
  let factor = modulo(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = modulo(result * factor);
    factor = modulo(factor * factor);
    remaining >>= 1n;
  }
  return result;
}

function littleEndianInteger(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

function decodePoint(value) {
  if (!(value instanceof Uint8Array) || utilTypes.isProxy(value) || value.byteLength !== 32) {
    return invalid();
  }
  const bytes = Uint8Array.from(value);
  const xSign = bytes[31] >>> 7;
  bytes[31] &= 0x7f;
  const y = littleEndianInteger(bytes);
  if (y >= FIELD_MODULUS) return invalid();

  const ySquared = modulo(y * y);
  const numerator = modulo(ySquared - 1n);
  const denominator = modulo(CURVE_D * ySquared + 1n);
  if (denominator === 0n) return invalid();
  const xSquared = modulo(numerator * modularPower(denominator, FIELD_MODULUS - 2n));
  let x = modularPower(xSquared, (FIELD_MODULUS + 3n) >> 3n);
  if (modulo(x * x - xSquared) !== 0n) x = modulo(x * SQRT_MINUS_ONE);
  if (modulo(x * x - xSquared) !== 0n || (x === 0n && xSign === 1)) return invalid();
  if (Number(x & 1n) !== xSign) x = FIELD_MODULUS - x;

  return Object.freeze({
    x,
    y,
    z: 1n,
    t: modulo(x * y),
  });
}

function addPoints(left, right) {
  const a = modulo((left.y - left.x) * (right.y - right.x));
  const b = modulo((left.y + left.x) * (right.y + right.x));
  const c = modulo(2n * CURVE_D * left.t * right.t);
  const d = modulo(2n * left.z * right.z);
  const e = modulo(b - a);
  const f = modulo(d - c);
  const g = modulo(d + c);
  const h = modulo(b + a);
  return Object.freeze({
    x: modulo(e * f),
    y: modulo(g * h),
    z: modulo(f * g),
    t: modulo(e * h),
  });
}

function doublePoint(point) {
  const a = modulo(point.x * point.x);
  const b = modulo(point.y * point.y);
  const c = modulo(2n * point.z * point.z);
  const d = modulo(-a);
  const e = modulo((point.x + point.y) * (point.x + point.y) - a - b);
  const g = modulo(d + b);
  const f = modulo(g - c);
  const h = modulo(d - b);
  return Object.freeze({
    x: modulo(e * f),
    y: modulo(g * h),
    z: modulo(f * g),
    t: modulo(e * h),
  });
}

function multiplyPoint(point, scalar) {
  let result = Object.freeze({ x: 0n, y: 1n, z: 1n, t: 0n });
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addPoints(result, addend);
    addend = doublePoint(addend);
    remaining >>= 1n;
  }
  return result;
}

function isIdentity(point) {
  return modulo(point.x) === 0n && modulo(point.y - point.z) === 0n;
}

export function validateEd25519PublicKeyBytes(value) {
  try {
    const point = decodePoint(value);
    if (isIdentity(point) || !isIdentity(multiplyPoint(point, SUBGROUP_ORDER))) return invalid();
    return true;
  } catch (error) {
    if (error instanceof Ed25519PublicKeyInvalidError) throw error;
    return invalid();
  }
}

export function isValidEd25519PublicKeyBytes(value) {
  try {
    return validateEd25519PublicKeyBytes(value);
  } catch {
    return false;
  }
}
