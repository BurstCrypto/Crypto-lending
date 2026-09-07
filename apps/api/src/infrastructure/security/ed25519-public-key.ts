import { types as utilTypes } from 'node:util';

const FIELD_MODULUS = (1n << 255n) - 19n;
const SUBGROUP_ORDER = (1n << 252n) + 27742317777372353535851937790883648493n;
const CURVE_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const SQRT_MINUS_ONE =
  19681161376707505956807079304988542015446066515923890162744021073123829784752n;

interface ExtendedEd25519Point {
  readonly x: bigint;
  readonly y: bigint;
  readonly z: bigint;
  readonly t: bigint;
}

export class Ed25519PublicKeyInvalidError extends Error {
  constructor() {
    super('Ed25519 public key is invalid');
    this.name = 'Ed25519PublicKeyInvalidError';
  }
}

function invalid(): never {
  throw new Ed25519PublicKeyInvalidError();
}

function modulo(value: bigint): bigint {
  const remainder = value % FIELD_MODULUS;
  return remainder < 0n ? remainder + FIELD_MODULUS : remainder;
}

function modularPower(base: bigint, exponent: bigint): bigint {
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

function littleEndianInteger(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return value;
}

function decodePoint(value: unknown): ExtendedEd25519Point {
  if (
    !(value instanceof Uint8Array) ||
    utilTypes.isProxy(value) ||
    (Object.getPrototypeOf(value) !== Uint8Array.prototype &&
      Object.getPrototypeOf(value) !== Buffer.prototype) ||
    value.byteLength !== 32
  ) {
    return invalid();
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = value[index] ?? 0;
  const xSign = (bytes[31] ?? 0) >>> 7;
  bytes[31] = (bytes[31] ?? 0) & 0x7f;
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

  return Object.freeze({ x, y, z: 1n, t: modulo(x * y) });
}

function addPoints(left: ExtendedEd25519Point, right: ExtendedEd25519Point): ExtendedEd25519Point {
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

function doublePoint(point: ExtendedEd25519Point): ExtendedEd25519Point {
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

function multiplyPoint(point: ExtendedEd25519Point, scalar: bigint): ExtendedEd25519Point {
  let result: ExtendedEd25519Point = Object.freeze({ x: 0n, y: 1n, z: 1n, t: 0n });
  let addend = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) result = addPoints(result, addend);
    addend = doublePoint(addend);
    remaining >>= 1n;
  }
  return result;
}

function isIdentity(point: ExtendedEd25519Point): boolean {
  return modulo(point.x) === 0n && modulo(point.y - point.z) === 0n;
}

/**
 * Decodes a canonical Ed25519 point and requires a nonidentity member of the
 * prime-order subgroup. DER/algorithm acceptance alone is not sufficient for
 * a signature-verification trust boundary.
 */
export function validateEd25519PublicKeyBytes(value: unknown): true {
  try {
    const point = decodePoint(value);
    if (isIdentity(point) || !isIdentity(multiplyPoint(point, SUBGROUP_ORDER))) return invalid();
    return true;
  } catch (error) {
    if (error instanceof Ed25519PublicKeyInvalidError) throw error;
    return invalid();
  }
}

export function isValidEd25519PublicKeyBytes(value: unknown): boolean {
  try {
    return validateEd25519PublicKeyBytes(value);
  } catch {
    return false;
  }
}
