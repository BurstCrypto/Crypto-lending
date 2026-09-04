import type { QueryResult } from 'pg';

import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import { AUTHENTICATION_OPAQUE_DIGEST_VERSION } from '../../application/ports/authentication-repository.port';
import {
  AuthenticationRateLimitPersistenceError,
  PostgresAuthenticationRateLimiter,
} from './postgres-authentication-rate-limiter';

const CORRELATION_ID = '08f1e2d4-a534-4a70-999e-972f711c1ec8';
const DIGEST = Object.freeze({
  version: AUTHENTICATION_OPAQUE_DIGEST_VERSION,
  value: 'ab'.repeat(32),
});
const DIGEST_V2 = Object.freeze({ version: 2, value: 'cd'.repeat(32) });

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
        subjectDigests: [DIGEST, DIGEST_V2],
        windowSeconds: 60,
        limitCount: 5,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ admitted: true, remainingCount: 4 });
    expect(query.mock.calls[0]?.[0]).toContain('consume_auth_rate_limit_keyring');
    expect(query.mock.calls[0]?.[1]?.[1]).toEqual([1, 2]);
    expect(query.mock.calls[0]?.[1]?.[2]).toEqual([DIGEST.value, DIGEST_V2.value]);
  });

  it('returns a bounded retry delay when the database closes the gate', async () => {
    const { limiter } = harness([
      { rate_limit_outcome: 'LIMITED', remaining_count: 0, retry_after_seconds: 17 },
    ]);
    await expect(
      limiter.admit({
        scope: 'CALLBACK',
        subjectDigests: [DIGEST],
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
        subjectDigests: [DIGEST],
        windowSeconds: 60,
        limitCount: 5,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(AuthenticationRateLimitPersistenceError);
  });

  it.each([
    [DIGEST_V2, DIGEST],
    [DIGEST, { version: 2, value: DIGEST.value }],
  ] as const)(
    'rejects reordered or duplicate rate-limit candidates before SQL',
    async (...digests) => {
      const { limiter, query } = harness([
        { rate_limit_outcome: 'ALLOWED', remaining_count: 4, retry_after_seconds: 0 },
      ]);
      await expect(
        limiter.admit({
          scope: 'LOGIN_START',
          subjectDigests: digests,
          windowSeconds: 60,
          limitCount: 5,
          correlationId: CORRELATION_ID,
        }),
      ).rejects.toBeInstanceOf(AuthenticationRateLimitPersistenceError);
      expect(query).not.toHaveBeenCalled();
    },
  );
});
