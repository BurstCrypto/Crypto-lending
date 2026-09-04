import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  AuthenticationRateLimitDecision,
  AuthenticationRateLimiterPort,
  AuthenticationRateLimitRequest,
} from '../../application/ports/authentication-rate-limiter.port';
import { parseAuthenticationTransactionId } from '../../domain/authentication';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

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

@Injectable()
export class PostgresAuthenticationRateLimiter implements AuthenticationRateLimiterPort {
  constructor(private readonly postgres: PostgresService) {}

  async admit(request: AuthenticationRateLimitRequest): Promise<AuthenticationRateLimitDecision> {
    try {
      if (
        !Array.isArray(request.subjectDigests) ||
        request.subjectDigests.length < 1 ||
        request.subjectDigests.length > 3
      ) {
        throw new AuthenticationRateLimitPersistenceError();
      }
      let priorVersion = 0;
      const values = new Set<string>();
      for (const digest of request.subjectDigests) {
        if (
          !Number.isSafeInteger(digest.version) ||
          digest.version < 1 ||
          digest.version > 32_767 ||
          digest.version <= priorVersion ||
          !DIGEST_PATTERN.test(digest.value) ||
          values.has(digest.value)
        ) {
          throw new AuthenticationRateLimitPersistenceError();
        }
        priorVersion = digest.version;
        values.add(digest.value);
      }
      const result = await this.postgres.query<RateLimitRow>(
        `SELECT limited.rate_limit_outcome,
                limited.remaining_count,
                limited.retry_after_seconds
         FROM consume_auth_rate_limit_keyring(
           $1::text, $2::smallint[], $3::text[], $4::integer, $5::integer, $6::uuid
         ) AS limited`,
        [
          request.scope,
          request.subjectDigests.map(({ version }) => version),
          request.subjectDigests.map(({ value }) => value),
          request.windowSeconds,
          request.limitCount,
          parseAuthenticationTransactionId(request.correlationId),
        ],
      );
      const row = result.rows[0];
      if (!row || result.rows.length !== 1) {
        throw new AuthenticationRateLimitPersistenceError();
      }
      if (row.rate_limit_outcome === 'ALLOWED') {
        const remainingCount = exactInteger(row.remaining_count, 0, request.limitCount);
        if (row.retry_after_seconds !== 0) throw new AuthenticationRateLimitPersistenceError();
        return Object.freeze({ admitted: true, remainingCount });
      }
      if (row.rate_limit_outcome === 'LIMITED') {
        if (row.remaining_count !== 0) throw new AuthenticationRateLimitPersistenceError();
        return Object.freeze({
          admitted: false,
          retryAfterSeconds: exactInteger(row.retry_after_seconds, 1, request.windowSeconds),
        });
      }
      throw new AuthenticationRateLimitPersistenceError();
    } catch (error) {
      if (error instanceof AuthenticationRateLimitPersistenceError) throw error;
      throw new AuthenticationRateLimitPersistenceError();
    }
  }
}
