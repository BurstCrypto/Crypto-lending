import type { QueryResult } from 'pg';

import { parseAccountId } from '../../../accounts/domain/account-profile';
import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import {
  AUTHENTICATION_OPAQUE_DIGEST_VERSION,
  type AuthenticationDigestReference,
  type ClaimedAuthenticationRejectionReason,
  type CompleteAuthenticationLoginRequest,
} from '../../application/ports/authentication-repository.port';
import { parseOidcProviderKey, parseOidcSubject } from '../../domain/authentication';
import {
  AuthenticationPersistenceError,
  PostgresAuthenticationRepository,
} from './postgres-authentication.repository';

const ATTEMPT_ID = 'b4c78068-fe5b-46ee-9c74-a62908679656';
const ACCOUNT_ID = parseAccountId('fd2354fa-67c0-495c-a0f7-310bd3db7a6d');
const IDENTITY_ID = 'fabfcdf7-6558-43e8-9b35-fc77af07b6c5';
const FAMILY_ID = '39563e7d-8f41-4b47-803b-968cf99a9f2e';
const CREDENTIAL_ID = '17565582-f383-4d97-895a-14513135603b';
const SUCCESSOR_ID = 'a14653b8-f30c-49cf-8d59-1c4f9c971dea';
const CORRELATION_ID = '08f1e2d4-a534-4a70-999e-972f711c1ec8';
const DIGEST: AuthenticationDigestReference = Object.freeze({
  version: AUTHENTICATION_OPAQUE_DIGEST_VERSION,
  value: 'ab'.repeat(32),
});
const DIGEST_V2: AuthenticationDigestReference = Object.freeze({
  version: 2,
  value: 'cd'.repeat(32),
});

function result<Row extends Record<string, unknown>>(rows: Row[]): QueryResult<Row> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows };
}

function harness(rows: Record<string, unknown>[]): {
  repository: PostgresAuthenticationRepository;
  query: jest.Mock;
} {
  const query = jest.fn().mockResolvedValue(result(rows));
  return {
    repository: new PostgresAuthenticationRepository({ query } as unknown as PostgresService),
    query,
  };
}

function loginCompletionRequest(): CompleteAuthenticationLoginRequest {
  return {
    transactionId: ATTEMPT_ID,
    flow: 'login',
    identity: {
      providerKey: parseOidcProviderKey('fixture'),
      issuer: 'https://issuer.example',
      subject: parseOidcSubject('subject-case-sensitive'),
      issuedAtEpochSeconds: 1,
      expiresAtEpochSeconds: 2,
    },
    nonceDigest: DIGEST,
    subjectDigests: [DIGEST],
    proposedAccountId: ACCOUNT_ID,
    proposedIdentityId: IDENTITY_ID,
    proposedSessionFamilyId: FAMILY_ID,
    proposedCredentialId: CREDENTIAL_ID,
    credentialDigest: DIGEST,
    csrfDigest: DIGEST,
    idleTtlSeconds: 3600,
    absoluteTtlSeconds: 604800,
    correlationId: CORRELATION_ID,
  };
}

describe('PostgresAuthenticationRepository', () => {
  it('begins and claims a state plus browser-bound one-use transaction', async () => {
    const expiresAt = new Date('2030-01-01T00:05:00.000Z');
    const begun = harness([{ attempt_id: ATTEMPT_ID, expires_at: expiresAt }]);
    await expect(
      begun.repository.beginTransaction({
        transactionId: ATTEMPT_ID,
        flow: 'login',
        issuer: 'https://issuer.example',
        stateDigest: DIGEST,
        browserBindingDigest: DIGEST,
        nonceDigest: DIGEST,
        ttlSeconds: 300,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ transactionId: ATTEMPT_ID, expiresAt });
    expect(begun.query.mock.calls[0]?.[0]).toMatch(
      /begin_authentication_login_attempt[\s\S]+AS begun\s+LIMIT 2/u,
    );
    expect(begun.query.mock.calls[0]?.[1]?.[1]).toBe('LOGIN');
    expect(begun.query.mock.calls[0]?.[1]).not.toContain(DIGEST.value);

    const claimed = harness([
      {
        claim_outcome: 'CLAIMED',
        claimed_flow: 'LOGIN',
        claimed_issuer: 'https://issuer.example',
        claimed_nonce_digest_version: 1,
        claimed_nonce_digest: Buffer.from(DIGEST.value, 'hex'),
      },
    ]);
    await expect(
      claimed.repository.claimTransaction({
        transactionId: ATTEMPT_ID,
        stateDigest: DIGEST,
        browserBindingDigest: DIGEST,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({
      status: 'claimed',
      flow: 'login',
      issuer: 'https://issuer.example',
      nonceDigest: DIGEST,
    });
    expect(claimed.query.mock.calls[0]?.[0]).toMatch(/AS claimed\s+LIMIT 2/u);
  });

  it.each([
    ['INVALID', 'invalid'],
    ['EXPIRED', 'expired'],
    ['REPLAYED', 'replayed'],
  ] as const)('maps closed callback outcome %s', async (outcome, status) => {
    const { repository } = harness([
      {
        claim_outcome: outcome,
        claimed_flow: null,
        claimed_issuer: null,
        claimed_nonce_digest_version: null,
        claimed_nonce_digest: null,
      },
    ]);
    await expect(
      repository.claimTransaction({
        transactionId: ATTEMPT_ID,
        stateDigest: DIGEST,
        browserBindingDigest: DIGEST,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ status });
  });

  it.each(['PROVIDER_ERROR', 'TOKEN_INVALID', 'IDENTITY_INVALID'] as const)(
    'terminalizes a claimed attempt with fixed reason %s',
    async (reason) => {
      const { repository, query } = harness([{ rejection_outcome: 'REJECTED' }]);

      await expect(
        repository.rejectClaimedTransaction({
          transactionId: ATTEMPT_ID,
          reason,
          correlationId: CORRELATION_ID,
        }),
      ).resolves.toEqual({ status: 'rejected' });
      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/reject_claimed_authentication_login_attempt[\s\S]+LIMIT 2/u),
        [ATTEMPT_ID, reason, CORRELATION_ID],
      );
    },
  );

  it.each([
    ['REJECTED', 'rejected'],
    ['REPLAYED', 'replayed'],
    ['INVALID', 'invalid'],
  ] as const)('maps closed terminal rejection outcome %s', async (outcome, status) => {
    const { repository } = harness([{ rejection_outcome: outcome }]);
    await expect(
      repository.rejectClaimedTransaction({
        transactionId: ATTEMPT_ID,
        reason: 'TOKEN_INVALID',
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ status });
  });

  it('rejects a forged terminal reason before issuing SQL', async () => {
    const { repository, query } = harness([{ rejection_outcome: 'REJECTED' }]);
    await expect(
      repository.rejectClaimedTransaction({
        transactionId: ATTEMPT_ID,
        reason: 'raw-token-canary' as ClaimedAuthenticationRejectionReason,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(AuthenticationPersistenceError);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    { rows: [{ rejection_outcome: 'UNKNOWN' }] },
    { rows: [{ rejection_outcome: 'REJECTED' }, { rejection_outcome: 'REJECTED' }] },
  ])('rejects malformed terminalization result shapes', async ({ rows }) => {
    const { repository } = harness(rows);
    await expect(
      repository.rejectClaimedTransaction({
        transactionId: ATTEMPT_ID,
        reason: 'IDENTITY_INVALID',
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(AuthenticationPersistenceError);
  });

  it('maps identity and issues the first session atomically', async () => {
    const idleExpiresAt = new Date('2030-01-01T01:00:00.000Z');
    const absoluteExpiresAt = new Date('2030-01-08T00:00:00.000Z');
    const { repository, query } = harness([
      {
        login_outcome: 'AUTHENTICATED',
        account_id: ACCOUNT_ID,
        session_family_id: FAMILY_ID,
        credential_id: CREDENTIAL_ID,
        idle_expires_at: idleExpiresAt,
        absolute_expires_at: absoluteExpiresAt,
      },
    ]);
    await expect(repository.completeLogin(loginCompletionRequest())).resolves.toEqual({
      status: 'authenticated',
      accountId: ACCOUNT_ID,
      sessionFamilyId: FAMILY_ID,
      credentialId: CREDENTIAL_ID,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    expect(query.mock.calls[0]?.[0]).toMatch(/complete_auth_login_keyring[\s\S]+LIMIT 2/u);
    expect(query.mock.calls[0]?.[1]?.slice(17, 20)).toEqual([null, null, null]);
  });

  it.each([
    ['session family', { session_family_id: SUCCESSOR_ID }],
    ['credential', { credential_id: SUCCESSOR_ID }],
  ] as const)('rejects a mismatched issued %s identifier', async (_label, override) => {
    const idleExpiresAt = new Date('2030-01-01T01:00:00.000Z');
    const absoluteExpiresAt = new Date('2030-01-08T00:00:00.000Z');
    const { repository } = harness([
      {
        login_outcome: 'AUTHENTICATED',
        account_id: ACCOUNT_ID,
        session_family_id: FAMILY_ID,
        credential_id: CREDENTIAL_ID,
        idle_expires_at: idleExpiresAt,
        absolute_expires_at: absoluteExpiresAt,
        ...override,
      },
    ]);

    await expect(repository.completeLogin(loginCompletionRequest())).rejects.toEqual(
      expect.objectContaining({
        name: 'AuthenticationPersistenceError',
        message: 'Authentication persistence operation failed',
      }),
    );
  });

  it('passes required registration profile data only through atomic completion', async () => {
    const idleExpiresAt = new Date('2030-01-01T01:00:00.000Z');
    const absoluteExpiresAt = new Date('2030-01-08T00:00:00.000Z');
    const { repository, query } = harness([
      {
        login_outcome: 'AUTHENTICATED',
        account_id: ACCOUNT_ID,
        session_family_id: FAMILY_ID,
        credential_id: CREDENTIAL_ID,
        idle_expires_at: idleExpiresAt,
        absolute_expires_at: absoluteExpiresAt,
      },
    ]);

    await repository.completeLogin({
      transactionId: ATTEMPT_ID,
      flow: 'registration',
      registration: {
        contactEmail: 'person@example.test',
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
      },
      identity: {
        providerKey: parseOidcProviderKey('fixture'),
        issuer: 'https://issuer.example',
        subject: parseOidcSubject('subject-case-sensitive'),
        issuedAtEpochSeconds: 1,
        expiresAtEpochSeconds: 2,
      },
      nonceDigest: DIGEST,
      subjectDigests: [DIGEST],
      proposedAccountId: ACCOUNT_ID,
      proposedIdentityId: IDENTITY_ID,
      proposedSessionFamilyId: FAMILY_ID,
      proposedCredentialId: CREDENTIAL_ID,
      credentialDigest: DIGEST,
      csrfDigest: DIGEST,
      idleTtlSeconds: 3600,
      absoluteTtlSeconds: 604800,
      correlationId: CORRELATION_ID,
    });

    expect(query.mock.calls[0]?.[1]?.slice(17, 20)).toEqual(['person@example.test', null, 'US']);
  });

  it('resolves with optional CSRF and maps replay without exposing an account', async () => {
    const authenticated = harness([
      {
        authentication_outcome: 'AUTHENTICATED',
        account_id: ACCOUNT_ID,
        session_family_id: FAMILY_ID,
      },
    ]);
    await expect(
      authenticated.repository.resolveSession({
        credentialId: CREDENTIAL_ID,
        credentialDigests: [DIGEST],
        csrf: { required: true, digests: [DIGEST] },
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({
      status: 'authenticated',
      accountId: ACCOUNT_ID,
      sessionFamilyId: FAMILY_ID,
    });
    expect(authenticated.query.mock.calls[0]?.[0]).toMatch(/AS resolved\s+LIMIT 2/u);

    const replayed = harness([
      { authentication_outcome: 'REPLAYED', account_id: null, session_family_id: null },
    ]);
    await expect(
      replayed.repository.resolveSession({
        credentialId: CREDENTIAL_ID,
        credentialDigests: [DIGEST],
        csrf: { required: false },
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ status: 'replayed' });
  });

  it('rotates and revokes through fixed functions', async () => {
    const expiresAt = new Date('2030-01-01T01:00:00.000Z');
    const rotated = harness([
      { rotation_outcome: 'ROTATED', credential_id: SUCCESSOR_ID, expires_at: expiresAt },
    ]);
    await expect(
      rotated.repository.rotateSession({
        credentialId: CREDENTIAL_ID,
        credentialDigests: [DIGEST],
        successorCredentialId: SUCCESSOR_ID,
        successorCredentialDigest: DIGEST,
        successorCsrfDigest: DIGEST,
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ status: 'rotated', credentialId: SUCCESSOR_ID, expiresAt });
    expect(rotated.query.mock.calls[0]?.[0]).toMatch(/AS rotated\s+LIMIT 2/u);

    const mismatched = harness([
      { rotation_outcome: 'ROTATED', credential_id: ATTEMPT_ID, expires_at: expiresAt },
    ]);
    await expect(
      mismatched.repository.rotateSession({
        credentialId: CREDENTIAL_ID,
        credentialDigests: [DIGEST],
        successorCredentialId: SUCCESSOR_ID,
        successorCredentialDigest: DIGEST,
        successorCsrfDigest: DIGEST,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(AuthenticationPersistenceError);

    const revoked = harness([{ revocation_outcome: 'REVOKED' }]);
    await expect(
      revoked.repository.revokeSession({
        credentialId: SUCCESSOR_ID,
        credentialDigests: [DIGEST],
        correlationId: CORRELATION_ID,
      }),
    ).resolves.toEqual({ status: 'revoked' });
    expect(revoked.query.mock.calls[0]?.[0]).toMatch(/AS revoked\s+LIMIT 2/u);
  });

  it.each([
    [DIGEST_V2, DIGEST],
    [DIGEST, { version: 2, value: DIGEST.value }],
    [DIGEST, DIGEST],
  ] as const)(
    'rejects unsorted or duplicate credential candidates before SQL',
    async (...digests) => {
      const { repository, query } = harness([
        { authentication_outcome: 'INVALID', account_id: null, session_family_id: null },
      ]);
      await expect(
        repository.resolveSession({
          credentialId: CREDENTIAL_ID,
          credentialDigests: digests,
          csrf: { required: false },
          correlationId: CORRELATION_ID,
        }),
      ).rejects.toBeInstanceOf(AuthenticationPersistenceError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed result shapes', async () => {
    const malformed = harness([]);
    await expect(
      malformed.repository.beginTransaction({
        transactionId: ATTEMPT_ID,
        flow: 'login',
        issuer: 'https://issuer.example',
        stateDigest: DIGEST,
        browserBindingDigest: DIGEST,
        nonceDigest: DIGEST,
        ttlSeconds: 300,
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toBeInstanceOf(AuthenticationPersistenceError);
  });

  it('rejects ambiguous or mismatched login-attempt creation results without leaking them', async () => {
    const expiresAt = new Date('2030-01-01T00:05:00.000Z');
    const request = {
      transactionId: ATTEMPT_ID,
      flow: 'login' as const,
      issuer: 'https://issuer.example',
      stateDigest: DIGEST,
      browserBindingDigest: DIGEST,
      nonceDigest: DIGEST,
      ttlSeconds: 300,
      correlationId: CORRELATION_ID,
    };

    const ambiguous = harness([
      { attempt_id: ATTEMPT_ID, expires_at: expiresAt },
      { attempt_id: ATTEMPT_ID, expires_at: expiresAt },
    ]);
    await expect(ambiguous.repository.beginTransaction(request)).rejects.toBeInstanceOf(
      AuthenticationPersistenceError,
    );

    const otherAttemptId = 'e7df3d56-df55-4bd0-90c2-8b40821634ca';
    const mismatched = harness([{ attempt_id: otherAttemptId, expires_at: expiresAt }]);
    let thrown: unknown;
    try {
      await mismatched.repository.beginTransaction(request);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuthenticationPersistenceError);
    expect(thrown).toMatchObject({ message: 'Authentication persistence operation failed' });
    expect(String(thrown)).not.toContain(otherAttemptId);
  });
});
