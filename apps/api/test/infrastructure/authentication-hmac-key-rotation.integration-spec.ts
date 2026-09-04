import { randomBytes, randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { createAuthenticationHmacKeyRotationTestSchemaMigrationV0025 } from '../../src/infrastructure/database/migrations/0025-create-authentication-hmac-key-rotation.migration';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const ISSUER = 'https://identity.example.test/tenant';
const PROVIDER = 'primary';

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Authentication HMAC rotation integration requires loopback PostgreSQL');
  }
}

function digest(fill: number): Buffer {
  return Buffer.alloc(32, fill);
}

interface ClaimedAttempt {
  readonly attemptId: string;
  readonly nonce: Buffer;
}

describeWithPostgres('authentication HMAC key rotation boundary', () => {
  jest.setTimeout(30_000);

  const schema = `auth_hmac_${randomUUID().replaceAll('-', '')}`;
  const accountId = randomUUID();
  const identityId = randomUUID();
  const originalFamilyId = randomUUID();
  const originalCredentialId = randomUUID();
  const identityV1 = digest(41);
  const identityV2 = digest(42);
  const originalCredentialV1 = digest(43);
  const originalCsrfV1 = digest(44);
  const retainedFamilyV2 = randomUUID();
  const retainedCredentialIdV2 = randomUUID();
  const retainedCredentialV2 = digest(45);
  const retainedCsrfV2 = digest(46);
  let adminPool: Pool;
  let pool: Pool;

  async function beginAndClaim(
    client: Pool | PoolClient,
    flow: 'LOGIN' | 'REGISTRATION',
  ): Promise<ClaimedAttempt> {
    const attemptId = randomUUID();
    const state = randomBytes(32);
    const browser = randomBytes(32);
    const nonce = randomBytes(32);
    await client.query(
      `SELECT * FROM begin_authentication_login_attempt(
        $1::uuid, $2::text, $3::text, 1::smallint, $4::bytea,
        1::smallint, $5::bytea, 1::smallint, $6::bytea, 300::integer, $7::uuid
      )`,
      [attemptId, flow, ISSUER, state, browser, nonce, randomUUID()],
    );
    const claimed = await client.query<{ claim_outcome: string }>(
      `SELECT * FROM claim_authentication_login_attempt(
        $1::uuid, 1::smallint, $2::bytea, 1::smallint, $3::bytea, $4::uuid
      )`,
      [attemptId, state, browser, randomUUID()],
    );
    expect(claimed.rows).toEqual([expect.objectContaining({ claim_outcome: 'CLAIMED' })]);
    return { attemptId, nonce };
  }

  async function completeKeyringLogin(
    client: Pool | PoolClient,
    attempt: ClaimedAttempt,
    input: Readonly<{
      providerKey?: string;
      sessionFamilyId?: string;
      credentialId?: string;
      credentialDigest?: Buffer;
      csrfDigest?: Buffer;
    }> = {},
  ): Promise<{ readonly account_id: string; readonly credential_id: string }[]> {
    const result = await client.query<{ account_id: string; credential_id: string }>(
      `SELECT * FROM complete_auth_login_keyring(
        $1::uuid, $2::text, $3::text, 1::smallint, $4::bytea,
        ARRAY[1,2]::smallint[], ARRAY[$5::text,$6::text]::text[],
        $7::uuid, $8::uuid, $9::uuid, $10::uuid,
        2::smallint, $11::bytea, 2::smallint, $12::bytea,
        3600::integer, 86400::integer, NULL::text, NULL::text, NULL::text, $13::uuid
      )`,
      [
        attempt.attemptId,
        input.providerKey ?? PROVIDER,
        ISSUER,
        attempt.nonce,
        identityV1.toString('hex'),
        identityV2.toString('hex'),
        randomUUID(),
        randomUUID(),
        input.sessionFamilyId ?? randomUUID(),
        input.credentialId ?? randomUUID(),
        input.credentialDigest ?? randomBytes(32),
        input.csrfDigest ?? randomBytes(32),
        randomUUID(),
      ],
    );
    return result.rows;
  }

  async function transitionPolicies(
    activeWriteVersion: 1 | 2,
    acceptedReadVersions: readonly (1 | 2)[],
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DROP TRIGGER auth_hmac_key_policy_immutable_row ON auth_hmac_key_policies',
      );
      await client.query(
        `UPDATE auth_hmac_key_policies
         SET active_write_version = $1::smallint,
             accepted_read_versions = $2::smallint[]`,
        [activeWriteVersion, acceptedReadVersions],
      );
      await client.query(
        `CREATE TRIGGER auth_hmac_key_policy_immutable_row
         BEFORE UPDATE OR DELETE ON auth_hmac_key_policies
         FOR EACH ROW EXECUTE FUNCTION reject_auth_hmac_policy_mutation()`,
      );
      await client.query(
        'ALTER TABLE auth_hmac_key_policies ENABLE ALWAYS TRIGGER auth_hmac_key_policy_immutable_row',
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: testDatabaseUrl as string,
      options: `-c search_path=${schema}`,
    });
    const through0024 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(({ id }) => id <= '0024');
    await new MigrationRunner(pool, through0024).up();

    const registration = await beginAndClaim(pool, 'REGISTRATION');
    const created = await pool.query<{ login_outcome: string; account_id: string }>(
      `SELECT * FROM complete_authentication_login(
        $1::uuid, $2::text, 1::smallint, $3::bytea,
        1::smallint, $4::bytea, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
        1::smallint, $9::bytea, 1::smallint, $10::bytea,
        3600::integer, 86400::integer,
        'person@example.test'::text, NULL::text, 'US'::text, $11::uuid
      )`,
      [
        registration.attemptId,
        ISSUER,
        registration.nonce,
        identityV1,
        accountId,
        identityId,
        originalFamilyId,
        originalCredentialId,
        originalCredentialV1,
        originalCsrfV1,
        randomUUID(),
      ],
    );
    expect(created.rows).toEqual([
      expect.objectContaining({ login_outcome: 'AUTHENTICATED', account_id: accountId }),
    ]);

    await new MigrationRunner(pool, [
      ...through0024,
      createAuthenticationHmacKeyRotationTestSchemaMigrationV0025,
    ]).up();
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  it('installs an exact dormant version-one policy and validates live state', async () => {
    await expect(
      pool.query('SELECT verify_auth_hmac_rotation_state() AS valid'),
    ).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
    const verifier = createAuthenticationHmacKeyRotationTestSchemaMigrationV0025.verifySql;
    if (!verifier) throw new Error('0025 verifier required');
    await expect(pool.query(verifier)).resolves.toMatchObject({ rows: [{ valid: true }] });
    const policies = await pool.query(
      `SELECT purpose, active_write_version, accepted_read_versions
       FROM auth_hmac_key_policies ORDER BY purpose`,
    );
    expect(policies.rows).toEqual([
      { purpose: 'CSRF', active_write_version: 1, accepted_read_versions: [1] },
      { purpose: 'IDENTITY', active_write_version: 1, accepted_read_versions: [1] },
      { purpose: 'SESSION', active_write_version: 1, accepted_read_versions: [1] },
    ]);
  });

  it('atomically backfills exact provider aliases under concurrent first login', async () => {
    await transitionPolicies(1, [1, 2]);
    const predecessorOnly = await pool.query(
      `SELECT * FROM resolve_auth_session_keyring(
        $1::uuid, ARRAY[1]::smallint[], ARRAY[$2::text]::text[],
        true, ARRAY[1]::smallint[], ARRAY[$3::text]::text[], $4::uuid
      )`,
      [
        originalCredentialId,
        originalCredentialV1.toString('hex'),
        originalCsrfV1.toString('hex'),
        randomUUID(),
      ],
    );
    expect(predecessorOnly.rows[0]?.authentication_outcome).toBe('AUTHENTICATED');
    await transitionPolicies(2, [1, 2]);
    await expect(
      pool.query(
        `SELECT * FROM resolve_auth_session_keyring(
          $1::uuid, ARRAY[1]::smallint[], ARRAY[$2::text]::text[],
          false, NULL::smallint[], NULL::text[], $3::uuid
        )`,
        [originalCredentialId, originalCredentialV1.toString('hex'), randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '22023',
      message: 'invalid authentication key-ring request',
    });

    const [firstAttempt, secondAttempt] = await Promise.all([
      beginAndClaim(pool, 'LOGIN'),
      beginAndClaim(pool, 'LOGIN'),
    ]);
    const [first, second] = await Promise.all([
      completeKeyringLogin(pool, firstAttempt, {
        sessionFamilyId: retainedFamilyV2,
        credentialId: retainedCredentialIdV2,
        credentialDigest: retainedCredentialV2,
        csrfDigest: retainedCsrfV2,
      }),
      completeKeyringLogin(pool, secondAttempt),
    ]);
    expect(first[0]?.account_id).toBe(accountId);
    expect(second[0]?.account_id).toBe(accountId);
    const aliases = await pool.query(
      `SELECT identity_id, account_id, provider_key, issuer, subject_digest_version
       FROM auth_oidc_identity_digest_aliases ORDER BY subject_digest_version`,
    );
    expect(aliases.rows).toEqual([
      {
        identity_id: identityId,
        account_id: accountId,
        provider_key: PROVIDER,
        issuer: ISSUER,
        subject_digest_version: 1,
      },
      {
        identity_id: identityId,
        account_id: accountId,
        provider_key: PROVIDER,
        issuer: ISSUER,
        subject_digest_version: 2,
      },
    ]);
    const base = await pool.query(
      'SELECT subject_digest_version, subject_digest FROM authentication_oidc_identities',
    );
    expect(base.rows).toEqual([{ subject_digest_version: 2, subject_digest: identityV2 }]);
    await expect(
      pool.query('SELECT verify_auth_hmac_rotation_state() AS valid'),
    ).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
  });

  it('binds every session candidate before lifecycle or replay mutation and writes active successors', async () => {
    const wrongCredentialV1 = digest(50);
    const credentialV2Candidate = digest(51);
    const csrfV2Candidate = digest(52);
    const invalid = await pool.query(
      `SELECT * FROM resolve_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[],
        true, ARRAY[1,2]::smallint[], ARRAY[$4::text,$5::text]::text[], $6::uuid
      )`,
      [
        originalCredentialId,
        wrongCredentialV1.toString('hex'),
        credentialV2Candidate.toString('hex'),
        originalCsrfV1.toString('hex'),
        csrfV2Candidate.toString('hex'),
        randomUUID(),
      ],
    );
    expect(invalid.rows).toEqual([
      { authentication_outcome: 'INVALID', account_id: null, session_family_id: null },
    ]);
    await expect(
      pool.query(
        `SELECT status, revoked_at, revocation_reason
         FROM authentication_session_families WHERE session_family_id = $1`,
        [originalFamilyId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: 'ACTIVE', revoked_at: null, revocation_reason: null }],
    });

    const wrongCsrfVersion = await pool.query(
      `SELECT * FROM resolve_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[],
        true, ARRAY[1,2]::smallint[], ARRAY[$4::text,$5::text]::text[], $6::uuid
      )`,
      [
        originalCredentialId,
        originalCredentialV1.toString('hex'),
        credentialV2Candidate.toString('hex'),
        digest(53).toString('hex'),
        originalCsrfV1.toString('hex'),
        randomUUID(),
      ],
    );
    expect(wrongCsrfVersion.rows[0]?.authentication_outcome).toBe('INVALID');

    const authenticated = await pool.query(
      `SELECT * FROM resolve_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[],
        true, ARRAY[1,2]::smallint[], ARRAY[$4::text,$5::text]::text[], $6::uuid
      )`,
      [
        originalCredentialId,
        originalCredentialV1.toString('hex'),
        credentialV2Candidate.toString('hex'),
        originalCsrfV1.toString('hex'),
        csrfV2Candidate.toString('hex'),
        randomUUID(),
      ],
    );
    expect(authenticated.rows).toEqual([
      {
        authentication_outcome: 'AUTHENTICATED',
        account_id: accountId,
        session_family_id: originalFamilyId,
      },
    ]);

    const successorCredentialId = randomUUID();
    const successorCredentialV2 = digest(54);
    const successorCsrfV2 = digest(55);
    const rotated = await pool.query(
      `SELECT * FROM rotate_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[],
        $4::uuid, 2::smallint, $5::bytea, 2::smallint, $6::bytea, $7::uuid
      )`,
      [
        originalCredentialId,
        originalCredentialV1.toString('hex'),
        credentialV2Candidate.toString('hex'),
        successorCredentialId,
        successorCredentialV2,
        successorCsrfV2,
        randomUUID(),
      ],
    );
    expect(rotated.rows).toEqual([
      expect.objectContaining({
        rotation_outcome: 'ROTATED',
        credential_id: successorCredentialId,
      }),
    ]);
    await expect(
      pool.query(
        `SELECT credential_id, status, credential_digest_version, csrf_digest_version
         FROM authentication_session_credentials
         WHERE credential_id = ANY($1::uuid[]) ORDER BY generation`,
        [[originalCredentialId, successorCredentialId]],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          credential_id: originalCredentialId,
          status: 'ROTATED',
          credential_digest_version: 1,
          csrf_digest_version: 1,
        },
        {
          credential_id: successorCredentialId,
          status: 'ACTIVE',
          credential_digest_version: 2,
          csrf_digest_version: 2,
        },
      ],
    });

    const replayWithWrongMaterial = await pool.query(
      `SELECT * FROM resolve_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[],
        false, NULL::smallint[], NULL::text[], $4::uuid
      )`,
      [originalCredentialId, digest(56).toString('hex'), digest(57).toString('hex'), randomUUID()],
    );
    expect(replayWithWrongMaterial.rows[0]?.authentication_outcome).toBe('INVALID');
    await expect(
      pool.query(
        `SELECT family.status, predecessor.replay_detected_at, successor.status AS successor_status
         FROM authentication_session_families AS family
         INNER JOIN authentication_session_credentials AS predecessor
           ON predecessor.credential_id = $2
         INNER JOIN authentication_session_credentials AS successor
           ON successor.credential_id = $3
         WHERE family.session_family_id = $1`,
        [originalFamilyId, originalCredentialId, successorCredentialId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: 'ACTIVE', replay_detected_at: null, successor_status: 'ACTIVE' }],
    });

    const replay = await pool.query(
      `SELECT * FROM resolve_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[],
        false, NULL::smallint[], NULL::text[], $4::uuid
      )`,
      [
        originalCredentialId,
        originalCredentialV1.toString('hex'),
        credentialV2Candidate.toString('hex'),
        randomUUID(),
      ],
    );
    expect(replay.rows[0]?.authentication_outcome).toBe('REPLAYED');
    await expect(
      pool.query(
        `SELECT family.status, predecessor.replay_detected_at IS NOT NULL AS replay_recorded,
                successor.status AS successor_status
         FROM authentication_session_families AS family
         INNER JOIN authentication_session_credentials AS predecessor
           ON predecessor.credential_id = $2
         INNER JOIN authentication_session_credentials AS successor
           ON successor.credential_id = $3
         WHERE family.session_family_id = $1`,
        [originalFamilyId, originalCredentialId, successorCredentialId],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: 'COMPROMISED', replay_recorded: true, successor_status: 'REVOKED' }],
    });
  });

  it('requires an exact credential candidate before revocation', async () => {
    const wrong = await pool.query(
      `SELECT * FROM revoke_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[], $4::uuid
      )`,
      [
        retainedCredentialIdV2,
        digest(58).toString('hex'),
        digest(59).toString('hex'),
        randomUUID(),
      ],
    );
    expect(wrong.rows).toEqual([{ revocation_outcome: 'INVALID' }]);
    await expect(
      pool.query(
        'SELECT status FROM authentication_session_families WHERE session_family_id = $1',
        [retainedFamilyV2],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'ACTIVE' }] });

    const revoked = await pool.query(
      `SELECT * FROM revoke_auth_session_keyring(
        $1::uuid, ARRAY[1,2]::smallint[], ARRAY[$2::text,$3::text]::text[], $4::uuid
      )`,
      [
        retainedCredentialIdV2,
        digest(60).toString('hex'),
        retainedCredentialV2.toString('hex'),
        randomUUID(),
      ],
    );
    expect(revoked.rows).toEqual([{ revocation_outcome: 'REVOKED' }]);
  });

  it('charges every overlapping rate-limit bucket and denies when any candidate denies', async () => {
    const rateV1 = digest(61);
    const rateV2 = digest(62);
    for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
      await pool.query(
        `SELECT * FROM consume_authentication_rate_limit(
          'SESSION_ROTATE', 1::smallint, $1::bytea, 60::integer, 2::integer, $2::uuid
        )`,
        [rateV1, randomUUID()],
      );
    }
    const result = await pool.query(
      `SELECT * FROM consume_auth_rate_limit_keyring(
        'SESSION_ROTATE', ARRAY[1,2]::smallint[], ARRAY[$1::text,$2::text]::text[],
        60::integer, 2::integer, $3::uuid
      )`,
      [rateV1.toString('hex'), rateV2.toString('hex'), randomUUID()],
    );
    expect(result.rows).toEqual([
      expect.objectContaining({ rate_limit_outcome: 'LIMITED', remaining_count: 0 }),
    ]);
    await expect(
      pool.query(
        `SELECT subject_digest_version, request_count
         FROM authentication_rate_limit_buckets
         WHERE scope = 'SESSION_ROTATE'
           AND subject_digest IN ($1::bytea, $2::bytea)
         ORDER BY subject_digest_version`,
        [rateV1, rateV2],
      ),
    ).resolves.toMatchObject({
      rows: [
        { subject_digest_version: 1, request_count: 3 },
        { subject_digest_version: 2, request_count: 1 },
      ],
    });
  });

  it('rejects provider substitution, mutable evidence, malformed rings, and used rollback', async () => {
    const substitutedAttempt = await beginAndClaim(pool, 'LOGIN');
    await expect(
      completeKeyringLogin(pool, substitutedAttempt, { providerKey: 'shadow' }),
    ).rejects.toMatchObject({
      code: '55000',
      message: 'authentication identity alias conflict',
    });
    await expect(
      pool.query(
        `SELECT * FROM resolve_auth_session_keyring(
          $1::uuid, ARRAY[2,1]::smallint[], ARRAY[$2::text,$3::text]::text[],
          false, NULL::smallint[], NULL::text[], $4::uuid
        )`,
        [randomUUID(), digest(63).toString('hex'), digest(64).toString('hex'), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '22023', message: 'invalid authentication key-ring request' });
    await expect(
      pool.query(
        `UPDATE auth_oidc_identity_digest_aliases
         SET provider_key = 'shadow' WHERE identity_id = $1`,
        [identityId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        "UPDATE auth_hmac_key_policies SET accepted_read_versions = ARRAY[2]::smallint[] WHERE purpose = 'SESSION'",
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(createAuthenticationHmacKeyRotationTestSchemaMigrationV0025.downSql as string),
    ).rejects.toMatchObject({
      code: '55000',
      message: 'cannot roll back authentication HMAC rotation after use',
    });
  });

  it('reports only aggregate retirement gates and keeps exact state verifiable', async () => {
    const identity = await pool.query(
      "SELECT * FROM auth_hmac_key_retirement_readiness('IDENTITY', 1::smallint)",
    );
    expect(identity.rows).toEqual([
      {
        active_write_version: 2,
        candidate_is_accepted: true,
        blocking_identity_count: '0',
        blocking_credential_count: '0',
        blocking_rate_limit_count: '0',
        ready: true,
      },
    ]);
    const session = await pool.query(
      "SELECT * FROM auth_hmac_key_retirement_readiness('SESSION', 1::smallint)",
    );
    expect(session.rows).toEqual([
      expect.objectContaining({
        active_write_version: 2,
        candidate_is_accepted: true,
        blocking_identity_count: '0',
        blocking_rate_limit_count: '1',
        ready: false,
      }),
    ]);
    expect(Object.keys(session.rows[0] ?? {}).sort()).toEqual([
      'active_write_version',
      'blocking_credential_count',
      'blocking_identity_count',
      'blocking_rate_limit_count',
      'candidate_is_accepted',
      'ready',
    ]);
    await expect(
      pool.query('SELECT verify_auth_hmac_rotation_state() AS valid'),
    ).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
  });
});
