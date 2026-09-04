import { createHash } from 'node:crypto';

import { STABLECOIN_VALUATION_POLICY } from '../../domain/stablecoin-valuation-policy';

const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/u;
const MAXIMUM_DECIMAL_DIGITS = 78;
const MAXIMUM_UNIX_SECONDS = 253_402_300_799n;

export class StablecoinPriceTranscriptUnavailableError extends Error {
  readonly code = 'STABLECOIN_PRICE_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Stablecoin price transcript is unavailable');
    this.name = 'StablecoinPriceTranscriptUnavailableError';
  }
}

export function transcriptUnavailable(): never {
  throw new StablecoinPriceTranscriptUnavailableError();
}

export function dataRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return transcriptUnavailable();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return transcriptUnavailable();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return transcriptUnavailable();
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return transcriptUnavailable();
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof StablecoinPriceTranscriptUnavailableError) throw error;
    return transcriptUnavailable();
  }
}

export function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value);
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    return transcriptUnavailable();
  }
  return record;
}

export function allowedDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value);
  const actual = Object.keys(record);
  if (
    requiredKeys.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowedKeys.includes(key))
  ) {
    return transcriptUnavailable();
  }
  return record;
}

export interface TranscriptBounds {
  readonly maximumBytes: number;
  readonly maximumNodes: number;
  readonly maximumDepth: number;
  readonly maximumArrayLength: number;
}

/** Inspect descriptors rather than reading properties, so accessors never run. */
export function assertBoundedData(value: unknown, bounds: TranscriptBounds): void {
  try {
    const seen = new WeakSet<object>();
    let bytes = 0;
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): void => {
      nodes += 1;
      if (nodes > bounds.maximumNodes || depth > bounds.maximumDepth) {
        return transcriptUnavailable();
      }
      if (candidate === null || typeof candidate === 'boolean') {
        bytes += 5;
      } else if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate)) return transcriptUnavailable();
        bytes += 32;
      } else if (typeof candidate === 'string') {
        bytes += Buffer.byteLength(candidate, 'utf8') + 2;
      } else if (typeof candidate === 'object') {
        if (seen.has(candidate)) return transcriptUnavailable();
        seen.add(candidate);
        const array = Array.isArray(candidate);
        const prototype = Object.getPrototypeOf(candidate);
        if (
          (array && prototype !== Array.prototype) ||
          (!array && prototype !== Object.prototype && prototype !== null) ||
          Object.getOwnPropertySymbols(candidate).length !== 0
        ) {
          return transcriptUnavailable();
        }
        const descriptors = Object.getOwnPropertyDescriptors(candidate);
        const enumerableKeys: string[] = [];
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (array && key === 'length') continue;
          if (!descriptor.enumerable || !('value' in descriptor)) return transcriptUnavailable();
          enumerableKeys.push(key);
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          visit(descriptor.value, depth + 1);
        }
        if (array) {
          if (
            candidate.length > bounds.maximumArrayLength ||
            enumerableKeys.length !== candidate.length ||
            enumerableKeys.some((key, index) => key !== String(index))
          ) {
            return transcriptUnavailable();
          }
        }
      } else {
        return transcriptUnavailable();
      }
      if (bytes > bounds.maximumBytes) return transcriptUnavailable();
    };
    visit(value, 0);
  } catch (error) {
    if (error instanceof StablecoinPriceTranscriptUnavailableError) throw error;
    return transcriptUnavailable();
  }
}

export function canonicalObservedAt(clockValue: unknown): string {
  if (!(clockValue instanceof Date) || !Number.isFinite(clockValue.getTime())) {
    return transcriptUnavailable();
  }
  const timestamp = clockValue.toISOString();
  if (!CANONICAL_TIMESTAMP.test(timestamp)) return transcriptUnavailable();
  return timestamp;
}

export function unixSecondsToTimestamp(value: bigint): string {
  if (value < 0n || value > MAXIMUM_UNIX_SECONDS) return transcriptUnavailable();
  const milliseconds = Number(value * 1_000n);
  if (!Number.isSafeInteger(milliseconds)) return transcriptUnavailable();
  const timestamp = new Date(milliseconds).toISOString();
  if (!CANONICAL_TIMESTAMP.test(timestamp)) return transcriptUnavailable();
  return timestamp;
}

export function assertCurrentSourceTime(pricedAt: string, observedAt: string): void {
  const pricedAtMilliseconds = Date.parse(pricedAt);
  const observedAtMilliseconds = Date.parse(observedAt);
  if (
    !Number.isSafeInteger(pricedAtMilliseconds) ||
    !Number.isSafeInteger(observedAtMilliseconds) ||
    pricedAtMilliseconds > observedAtMilliseconds ||
    observedAtMilliseconds - pricedAtMilliseconds >
      STABLECOIN_VALUATION_POLICY.freshness.currentWithinMs
  ) {
    return transcriptUnavailable();
  }
}

export function canonicalUnsignedInteger(value: unknown, maximum: bigint): bigint {
  if (
    typeof value !== 'string' ||
    value.length > MAXIMUM_DECIMAL_DIGITS ||
    !CANONICAL_UNSIGNED_INTEGER.test(value)
  ) {
    return transcriptUnavailable();
  }
  const parsed = BigInt(value);
  if (parsed > maximum) return transcriptUnavailable();
  return parsed;
}

export function positiveCanonicalInteger(value: unknown, maximum: bigint): bigint {
  const parsed = canonicalUnsignedInteger(value, maximum);
  if (parsed === 0n) return transcriptUnavailable();
  return parsed;
}

/**
 * Normalize an unsigned fixed-point value to 8 decimals. Prices use
 * round-half-even; confidence widths round upward so precision loss cannot
 * understate uncertainty.
 */
export function normalizeUnsignedFixedDecimal(
  mantissa: bigint,
  sourceScale: number,
  rounding: 'HALF_EVEN' | 'CEILING',
): string {
  if (mantissa < 0n || !Number.isSafeInteger(sourceScale) || sourceScale < 0 || sourceScale > 36) {
    return transcriptUnavailable();
  }
  const targetScale = STABLECOIN_VALUATION_POLICY.bounds.normalizedUsdRateScale;
  let result: bigint;
  if (sourceScale <= targetScale) {
    result = mantissa * 10n ** BigInt(targetScale - sourceScale);
  } else {
    const divisor = 10n ** BigInt(sourceScale - targetScale);
    const quotient = mantissa / divisor;
    const remainder = mantissa % divisor;
    if (rounding === 'CEILING') {
      result = remainder === 0n ? quotient : quotient + 1n;
    } else {
      const doubled = remainder * 2n;
      result =
        doubled > divisor || (doubled === divisor && quotient % 2n !== 0n)
          ? quotient + 1n
          : quotient;
    }
  }
  const canonical = result.toString(10);
  if (canonical.length > MAXIMUM_DECIMAL_DIGITS) return transcriptUnavailable();
  return canonical;
}

export function sha256HexBytes(value: string): string {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) return transcriptUnavailable();
  return createHash('sha256').update(Buffer.from(value, 'hex')).digest('hex');
}

export function fingerprintTranscript(domain: string, values: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify([domain, ...values]), 'utf8')
    .digest('hex');
}
