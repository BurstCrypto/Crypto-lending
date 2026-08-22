import { Buffer } from 'node:buffer';

import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../../infrastructure/database/postgres.service';
import type {
  AuthenticationRateLimitDecision,
  AuthenticationRateLimiterPort,
  AuthenticationRateLimitRequest,
} from '../../application/ports/authentication-rate-limiter.port';
import { AUTHENTICATION_DIGEST_VERSION } from '../../application/ports/authentication-repository.port';
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
        request.subjectDigest.version !== AUTHENTICATION_DIGEST_VERSION ||
        !DIGEST_PATTERN.test(request.subjectDigest.value)
      ) {
        throw new AuthenticationRateLimitPersistenceError();
      }
      const result = await this.postgres.query<RateLimitRow>(
        `SELECT limited.rate_limit_outcome,
                limited.remaining_count,
                limited.retry_after_seconds
         FROM consume_authentication_rate_limit(
           $1::text, $2::smallint, $3::bytea, $4::integer, $5::integer, $6::uuid
         ) AS limited`,
        [
          request.scope,
          request.subjectDigest.version,
          Buffer.from(request.subjectDigest.value, 'hex'),
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
