import { createHash } from 'node:crypto';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CLMA_FP_1_MAGIC = Buffer.from('434c4d41465001', 'hex');
const CLMA_FP_1_FIELD_NAME = /^[a-z][A-Za-z0-9]{0,63}$/u;
const CLMA_FP_1_MAXIMUM_FIELDS = 64;
const CLMA_FP_1_MAXIMUM_VALUE_BYTES = 16_384;

export function isCanonicalSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Length framing prevents concatenation ambiguity between independently bound fields. */
export function sha256Framed(domain: string, fields: readonly string[]): string {
  const hash = createHash('sha256');
  const values = [domain, ...fields];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/**
 * Cross-runtime implementation of migration 0033's named CLMA-FP-1 frame.
 * It is intentionally distinct from {@link sha256Framed}: field names and
 * null presence are part of the database fingerprint contract.
 */
export function sha256ClmaFp1(
  domain: string,
  fieldNames: readonly string[],
  fieldValues: readonly (string | null)[],
): string {
  if (
    typeof domain !== 'string' ||
    Buffer.byteLength(domain, 'utf8') > CLMA_FP_1_MAXIMUM_VALUE_BYTES ||
    fieldNames.length < 1 ||
    fieldNames.length > CLMA_FP_1_MAXIMUM_FIELDS ||
    fieldNames.length !== fieldValues.length ||
    fieldNames[0] !== 'fingerprintEncodingVersion' ||
    fieldValues[0] !== '1'
  ) {
    throw new TypeError('Invalid CLMA-FP-1 frame.');
  }

  const seenNames = new Set<string>(['domain']);
  const chunks: Buffer[] = [CLMA_FP_1_MAGIC];
  const append = (name: string, value: string | null): void => {
    if (!CLMA_FP_1_FIELD_NAME.test(name) || seenNames.has(name)) {
      throw new TypeError('Invalid CLMA-FP-1 frame.');
    }
    seenNames.add(name);
    const nameBytes = Buffer.from(name, 'utf8');
    const nameLength = Buffer.alloc(2);
    nameLength.writeUInt16BE(nameBytes.length);
    const valueLength = Buffer.alloc(4);
    if (value === null) {
      valueLength.writeUInt32BE(0);
      chunks.push(nameLength, nameBytes, Buffer.from([0]), valueLength);
      return;
    }
    if (typeof value !== 'string') throw new TypeError('Invalid CLMA-FP-1 frame.');
    const valueBytes = Buffer.from(value, 'utf8');
    if (valueBytes.length > CLMA_FP_1_MAXIMUM_VALUE_BYTES) {
      throw new TypeError('Invalid CLMA-FP-1 frame.');
    }
    valueLength.writeUInt32BE(valueBytes.length);
    chunks.push(nameLength, nameBytes, Buffer.from([1]), valueLength, valueBytes);
  };

  const domainBytes = Buffer.from(domain, 'utf8');
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32BE(domainBytes.length);
  const domainName = Buffer.from('domain', 'utf8');
  const domainNameLength = Buffer.alloc(2);
  domainNameLength.writeUInt16BE(domainName.length);
  chunks.push(domainNameLength, domainName, Buffer.from([1]), domainLength, domainBytes);
  for (let index = 0; index < fieldNames.length; index += 1) {
    append(fieldNames[index] ?? '', fieldValues[index] ?? null);
  }
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}
