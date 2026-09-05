import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  AuthenticationRateLimitDecision,
  AuthenticationRateLimiterPort,
  AuthenticationRateLimitRequest,
  AuthenticationRateLimitScope,
} from '../../application/ports/authentication-rate-limiter.port';
import { parseAuthenticationTransactionId } from '../../domain/authentication';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const RATE_LIMIT_COLUMNS = Object.freeze([
  'rate_limit_outcome',
  'remaining_count',
  'retry_after_seconds',
] as const);

interface RateLimitRow extends QueryResultRow {
  rate_limit_outcome: string;
  remaining_count: number;
  retry_after_seconds: number;
}

export class AuthenticationRateLimitPersistenceError extends Error {
  constructor() {
    super('Authentication rate limit operation failed');
    this.name = 'AuthenticationRateLimitPersistenceError';
  }
}

function exactInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new AuthenticationRateLimitPersistenceError();
  }
  return value as number;
}

function rateLimitScope(value: unknown): AuthenticationRateLimitScope {
  if (value !== 'LOGIN_START' && value !== 'CALLBACK' && value !== 'SESSION_ROTATE') {
    throw new AuthenticationRateLimitPersistenceError();
  }
  return value;
}

function rateLimitRow(value: unknown): RateLimitRow {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new AuthenticationRateLimitPersistenceError();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new AuthenticationRateLimitPersistenceError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== RATE_LIMIT_COLUMNS.length ||
      keys.some(
        (key) =>
          typeof key !== 'string' || !(RATE_LIMIT_COLUMNS as readonly string[]).includes(key),
      )
    ) {
      throw new AuthenticationRateLimitPersistenceError();
    }
    const result = Object.create(null) as RateLimitRow;
    for (const column of RATE_LIMIT_COLUMNS) {
      const descriptor = descriptors[column];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new AuthenticationRateLimitPersistenceError();
      }
      result[column] = descriptor.value as never;
    }
    return result;
  } catch {
    throw new AuthenticationRateLimitPersistenceError();
  }
}

function oneRateLimitRow(rows: unknown): RateLimitRow {
  try {
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new AuthenticationRateLimitPersistenceError();
    }
    return rateLimitRow(rows[0]);
  } catch {
    throw new AuthenticationRateLimitPersistenceError();
  }
}

@Injectable()
export class PostgresAuthenticationRateLimiter implements AuthenticationRateLimiterPort {
  constructor(private readonly postgres: PostgresService) {}

  async admit(request: AuthenticationRateLimitRequest): Promise<AuthenticationRateLimitDecision> {
    try {
      const subjectDigests = request.subjectDigests;
      if (
        !Array.isArray(subjectDigests) ||
        subjectDigests.length < 1 ||
        subjectDigests.length > 3
      ) {
        throw new AuthenticationRateLimitPersistenceError();
      }
      let priorVersion = 0;
      const values = new Set<string>();
      const versions: number[] = [];
      const digests: string[] = [];
      for (const digest of subjectDigests) {
        const version = digest.version;
        const value = digest.value;
        if (
          !Number.isSafeInteger(version) ||
          version < 1 ||
          version > 32_767 ||
          version <= priorVersion ||
          !DIGEST_PATTERN.test(value) ||
          values.has(value)
        ) {
          throw new AuthenticationRateLimitPersistenceError();
        }
        priorVersion = version;
        values.add(value);
        versions.push(version);
        digests.push(value);
      }
      const scope = rateLimitScope(request.scope);
      const windowSeconds = exactInteger(request.windowSeconds, 1, 3_600);
      const limitCount = exactInteger(request.limitCount, 1, 10_000);
      const result = await this.postgres.query<RateLimitRow>(
        `SELECT limited.rate_limit_outcome,
                limited.remaining_count,
                limited.retry_after_seconds
         FROM consume_auth_rate_limit_keyring(
           $1::text, $2::smallint[], $3::text[], $4::integer, $5::integer, $6::uuid
         ) AS limited
         LIMIT 2`,
        [
          scope,
          versions,
          digests,
          windowSeconds,
          limitCount,
          parseAuthenticationTransactionId(request.correlationId),
        ],
      );
      const row = oneRateLimitRow(result.rows);
      if (row.rate_limit_outcome === 'ALLOWED') {
        const remainingCount = exactInteger(row.remaining_count, 0, limitCount);
        if (row.retry_after_seconds !== 0) throw new AuthenticationRateLimitPersistenceError();
        return Object.freeze({ admitted: true, remainingCount });
      }
      if (row.rate_limit_outcome === 'LIMITED') {
        if (row.remaining_count !== 0) throw new AuthenticationRateLimitPersistenceError();
        return Object.freeze({
          admitted: false,
          retryAfterSeconds: exactInteger(row.retry_after_seconds, 1, windowSeconds),
        });
      }
      throw new AuthenticationRateLimitPersistenceError();
    } catch {
      throw new AuthenticationRateLimitPersistenceError();
    }
  }
}
