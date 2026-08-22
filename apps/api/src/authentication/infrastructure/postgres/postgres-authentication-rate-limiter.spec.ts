import type { QueryResult } from 'pg';

import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import { AUTHENTICATION_DIGEST_VERSION } from '../../application/ports/authentication-repository.port';
import {
  AuthenticationRateLimitPersistenceError,
  PostgresAuthenticationRateLimiter,
} from './postgres-authentication-rate-limiter';

const CORRELATION_ID = '08f1e2d4-a534-4a70-999e-972f711c1ec8';
const DIGEST = Object.freeze({ version: AUTHENTICATION_DIGEST_VERSION, value: 'ab'.repeat(32) });

function harness(rows: Record<string, unknown>[]): {
  readonly limiter: PostgresAuthenticationRateLimiter;
  readonly query: jest.Mock;
} {
  const result: QueryResult = {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
  const query = jest.fn().mockResolvedValue(result);
  return {
    limiter: new PostgresAuthenticationRateLimiter({ query } as unknown as PostgresService),
    query,
  };
}

describe('PostgresAuthenticationRateLimiter', () => {
  it('returns the database-authored remaining budget without exposing the subject', async () => {
    const { limiter, query } = harness([
      { rate_limit_outcome: 'ALLOWED', remaining_count: 4, retry_after_seconds: 0 },
    ]);

    await expect(
      limiter.admit({
        scope: 'LOGIN_START',
        subjectDigest: DIGEST,
        windowSeconds: 60,
        limitCount: 5,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ admitted: true, remainingCount: 4 });
    expect(query.mock.calls[0]?.[0]).toContain('consume_authentication_rate_limit');
    expect(query.mock.calls[0]?.[1]).not.toContain(DIGEST.value);
    expect(query.mock.calls[0]?.[1]?.[2]).toEqual(Buffer.from(DIGEST.value, 'hex'));
  });

  it('returns a bounded retry delay when the database closes the gate', async () => {
    const { limiter } = harness([
      { rate_limit_outcome: 'LIMITED', remaining_count: 0, retry_after_seconds: 17 },
    ]);
    await expect(
      limiter.admit({
        scope: 'CALLBACK',
        subjectDigest: DIGEST,
        windowSeconds: 60,
        limitCount: 5,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ admitted: false, retryAfterSeconds: 17 });
  });

  it('rejects malformed database results and digest input', async () => {
    const malformed = harness([
      { rate_limit_outcome: 'ALLOWED', remaining_count: -1, retry_after_seconds: 0 },
    ]);
    await expect(
      malformed.limiter.admit({
        scope: 'SESSION_ROTATE',
        subjectDigest: DIGEST,
        windowSeconds: 60,
        limitCount: 5,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(AuthenticationRateLimitPersistenceError);
  });
});
