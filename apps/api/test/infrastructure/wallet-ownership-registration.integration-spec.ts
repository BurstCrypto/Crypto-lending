import { randomBytes, randomUUID } from 'node:crypto';

import { Pool, type QueryResult } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const MAINNET_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('KAN-56 wallet integration requires a loopback PostgreSQL fixture');
  }
}

describeWithPostgres('wallet ownership registration persistence', () => {
  jest.setTimeout(20_000);

  const schema = `kan56_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let pool: Pool;

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: testDatabaseUrl as string,
      options: `-c search_path=${schema}`,
    });
    await new MigrationRunner(pool, DATABASE_TEST_SCHEMA_MIGRATION_LIST).up();
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  const digest = (fill: number): Buffer => Buffer.alloc(32, fill);
  const iv = (fill: number): Buffer => Buffer.alloc(12, fill);
  const tag = (fill: number): Buffer => Buffer.alloc(16, fill);

  async function waitUntilChallengeExpired(challengeId: string): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const timing = await pool.query<{ expired: boolean }>(
        `SELECT clock_timestamp() >= expires_at AS expired
         FROM wallet_ownership_challenges
         WHERE challenge_id = $1`,
        [challengeId],
      );
      if (timing.rows[0]?.expired === true) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Challenge did not expire according to the PostgreSQL clock');
  }

  async function beginChallenge(input: {
    challengeId: string;
    accountId: string;
    addressDigest: Buffer;
    messageDigest: Buffer;
    nonceDigest: Buffer;
    payloadFill?: number;
  }): Promise<void> {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 120_000);
    const fill = input.payloadFill ?? 20;
    await pool.query(
      `SELECT *
       FROM begin_wallet_ownership_challenge(
         $1::uuid, $2::uuid, 'EVM_ERC4361_ERC191'::text,
         'eip155'::text, '1'::text, 'MAINNET'::text, 1::integer, $3::text,
         1::smallint, $4::bytea, $5::bytea, $6::bytea,
         1::smallint, $7::bytea, 1::smallint, $8::bytea,
         1::smallint, $9::bytea, 1::smallint, $10::bytea,
         $11::timestamptz, $12::timestamptz, $13::uuid
       )`,
      [
        input.challengeId,
        input.accountId,
        MAINNET_FINGERPRINT,
        Buffer.from(`sealed-challenge-${fill}`),
        iv(fill),
        tag(fill),
        input.addressDigest,
        digest(fill + 1),
        input.messageDigest,
        input.nonceDigest,
        issuedAt,
        expiresAt,
        randomUUID(),
      ],
    );
  }

  it('enforces the post-0015 Ethereum and Solana active-wallet launch boundary in PostgreSQL', async () => {
    const accountId = randomUUID();
    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);

    async function insertWallet(
      chain: Readonly<{ proofScheme: string; namespace: string; reference: string }>,
      status: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
    ): Promise<string> {
      const challengeId = randomUUID();
      const walletId = randomUUID();
      const addressDigest = randomBytes(32);
      await pool.query(
        `INSERT INTO wallet_ownership_challenges (
           challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
           registry_environment, registry_version, registry_fingerprint_sha256,
           challenge_payload_key_version, challenge_payload_ciphertext,
           challenge_payload_iv, challenge_payload_auth_tag,
           address_digest_version, address_digest, domain_digest_version, domain_digest,
           message_digest_version, message_digest, nonce_digest_version, nonce_digest,
           issued_at, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'MAINNET', 1, $6,
           1, $7, $8, $9, 1, $10, 1, $11, 1, $12, 1, $13,
           clock_timestamp(), clock_timestamp() + interval '5 minutes'
         )`,
        [
          challengeId,
          accountId,
          chain.proofScheme,
          chain.namespace,
          chain.reference,
          MAINNET_FINGERPRINT,
          Buffer.from('launch-boundary-challenge'),
          randomBytes(12),
          randomBytes(16),
          addressDigest,
          randomBytes(32),
          randomBytes(32),
          randomBytes(32),
        ],
      );
      await pool.query(
        `INSERT INTO registered_wallets (
           wallet_id, account_id, registered_by_challenge_id,
           chain_namespace, chain_reference,
           registry_environment, registry_version, registry_fingerprint_sha256,
           address_digest_version, address_digest,
           address_key_version, address_ciphertext, address_iv, address_auth_tag,
           metadata_key_version, metadata_ciphertext, metadata_iv, metadata_auth_tag,
           status, registered_at, revoked_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'MAINNET', 1, $6,
           1, $7, 1, $8, $9, $10, 1, $11, $12, $13,
           $14, clock_timestamp() - interval '1 second',
           CASE WHEN $14 = 'REVOKED' THEN clock_timestamp() ELSE NULL END
         )`,
        [
          walletId,
          accountId,
          challengeId,
          chain.namespace,
          chain.reference,
          MAINNET_FINGERPRINT,
          addressDigest,
          Buffer.from('launch-boundary-address'),
          randomBytes(12),
          randomBytes(16),
          Buffer.from('launch-boundary-metadata'),
          randomBytes(12),
          randomBytes(16),
          status,
        ],
      );
      return walletId;
    }

    const ethereum = {
      proofScheme: 'EVM_ERC4361_ERC191',
      namespace: 'eip155',
      reference: '1',
    };
    const solana = {
      proofScheme: 'SOLANA_SIWS_SIGN_MESSAGE',
      namespace: 'solana',
      reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    };
    const base = {
      proofScheme: 'EVM_ERC4361_ERC191',
      namespace: 'eip155',
      reference: '8453',
    };

    await expect(insertWallet(ethereum)).resolves.toEqual(expect.any(String));
    await expect(insertWallet(solana)).resolves.toEqual(expect.any(String));
    await expect(insertWallet(base)).rejects.toMatchObject({ code: '23514' });

    const revokedBaseWalletId = await insertWallet(base, 'REVOKED');
    await expect(
      pool.query(
        `UPDATE registered_wallets
         SET status = 'ACTIVE', revoked_at = NULL
         WHERE wallet_id = $1`,
        [revokedBaseWalletId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('registers once, rejects conflicts/replays, shreds terminal payloads, and limits pending rows', async () => {
    const accountA = randomUUID();
    const accountB = randomUUID();
    await pool.query('INSERT INTO accounts (account_id) VALUES ($1), ($2)', [accountA, accountB]);

    const addressDigest = digest(1);
    const firstChallenge = randomUUID();
    await beginChallenge({
      challengeId: firstChallenge,
      accountId: accountA,
      addressDigest,
      messageDigest: digest(2),
      nonceDigest: digest(3),
    });

    const prepared = await pool.query<{
      prepare_outcome: string;
      prepared_account_id: string;
      prepared_registry_fingerprint_sha256: string;
      prepared_challenge_payload_ciphertext: Buffer;
    }>('SELECT * FROM prepare_wallet_ownership_challenge($1, $2, $3)', [
      firstChallenge,
      accountA,
      randomUUID(),
    ]);
    expect(prepared.rows).toHaveLength(1);
    expect(prepared.rows[0]).toMatchObject({
      prepare_outcome: 'READY',
      prepared_account_id: accountA,
      prepared_registry_fingerprint_sha256: MAINNET_FINGERPRINT,
    });
    expect(prepared.rows[0]?.prepared_challenge_payload_ciphertext).toEqual(
      Buffer.from('sealed-challenge-20'),
    );

    const walletId = randomUUID();
    const completed = await pool.query<{
      registration_outcome: string;
      wallet_id: string;
    }>(
      `SELECT registration_outcome, wallet_id FROM complete_wallet_registration(
         $1, $2, $3,
         1::smallint, $4::bytea, $5::bytea, $6::bytea,
         1::smallint, $7::bytea, $8::bytea, $9::bytea,
         $10
       )`,
      [
        firstChallenge,
        accountA,
        walletId,
        Buffer.from('sealed-address'),
        iv(30),
        tag(30),
        Buffer.from('sealed-metadata'),
        iv(31),
        tag(31),
        randomUUID(),
      ],
    );
    expect(completed.rows).toEqual([{ registration_outcome: 'REGISTERED', wallet_id: walletId }]);

    const terminal = await pool.query<{
      status: string;
      challenge_payload_ciphertext: Buffer | null;
      payload_destroyed_at: Date | null;
    }>(
      `SELECT status, challenge_payload_ciphertext, payload_destroyed_at
       FROM wallet_ownership_challenges WHERE challenge_id = $1`,
      [firstChallenge],
    );
    expect(terminal.rows[0]).toMatchObject({
      status: 'REGISTERED',
      challenge_payload_ciphertext: null,
      payload_destroyed_at: expect.any(Date),
    });

    const replay = await pool.query<{ prepare_outcome: string }>(
      'SELECT prepare_outcome FROM prepare_wallet_ownership_challenge($1, $2, $3)',
      [firstChallenge, accountA, randomUUID()],
    );
    expect(replay.rows).toEqual([{ prepare_outcome: 'REPLAYED' }]);

    const sameAccountChallenge = randomUUID();
    await beginChallenge({
      challengeId: sameAccountChallenge,
      accountId: accountA,
      addressDigest,
      messageDigest: digest(4),
      nonceDigest: digest(5),
    });
    const sameAccount = await pool.query<{ registration_outcome: string; wallet_id: string }>(
      `SELECT registration_outcome, wallet_id FROM complete_wallet_registration(
         $1, $2, $3, 1::smallint, $4, $5, $6, 1::smallint, $7, $8, $9, $10
       )`,
      [
        sameAccountChallenge,
        accountA,
        randomUUID(),
        Buffer.from('unused-address'),
        iv(32),
        tag(32),
        Buffer.from('unused-metadata'),
        iv(33),
        tag(33),
        randomUUID(),
      ],
    );
    expect(sameAccount.rows).toEqual([
      { registration_outcome: 'ALREADY_REGISTERED', wallet_id: walletId },
    ]);

    const conflictingChallenge = randomUUID();
    await beginChallenge({
      challengeId: conflictingChallenge,
      accountId: accountB,
      addressDigest,
      messageDigest: digest(6),
      nonceDigest: digest(7),
    });
    const conflict = await pool.query<{
      registration_outcome: string;
      wallet_id: string | null;
      registered_at: Date | null;
    }>(
      `SELECT * FROM complete_wallet_registration(
         $1, $2, $3, 1::smallint, $4, $5, $6, 1::smallint, $7, $8, $9, $10
       )`,
      [
        conflictingChallenge,
        accountB,
        randomUUID(),
        Buffer.from('opaque-address'),
        iv(34),
        tag(34),
        Buffer.from('opaque-metadata'),
        iv(35),
        tag(35),
        randomUUID(),
      ],
    );
    expect(conflict.rows).toEqual([
      { registration_outcome: 'OWNERSHIP_CONFLICT', wallet_id: null, registered_at: null },
    ]);

    const rejectedChallenge = randomUUID();
    await beginChallenge({
      challengeId: rejectedChallenge,
      accountId: accountA,
      addressDigest: digest(8),
      messageDigest: digest(9),
      nonceDigest: digest(10),
    });
    const rejected = await pool.query<{ rejection_outcome: string }>(
      'SELECT * FROM reject_wallet_ownership_challenge($1, $2, $3, $4)',
      [rejectedChallenge, accountA, 'SIGNATURE_INVALID', randomUUID()],
    );
    expect(rejected.rows).toEqual([{ rejection_outcome: 'REJECTED' }]);

    const rejectedPayload = await pool.query<{ challenge_payload_ciphertext: Buffer | null }>(
      'SELECT challenge_payload_ciphertext FROM wallet_ownership_challenges WHERE challenge_id = $1',
      [rejectedChallenge],
    );
    expect(rejectedPayload.rows).toEqual([{ challenge_payload_ciphertext: null }]);

    const expiredChallenge = randomUUID();
    await pool.query(
      `INSERT INTO wallet_ownership_challenges (
         challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
         registry_environment, registry_version, registry_fingerprint_sha256,
         challenge_payload_key_version, challenge_payload_ciphertext,
         challenge_payload_iv, challenge_payload_auth_tag,
         address_digest_version, address_digest, domain_digest_version, domain_digest,
         message_digest_version, message_digest, nonce_digest_version, nonce_digest,
         created_at, issued_at, expires_at
       ) VALUES (
         $1, $2, 'EVM_ERC4361_ERC191', 'eip155', '1',
         'MAINNET', 1, $3, 1, $4, $5, $6,
         1, $7, 1, $8, 1, $9, 1, $10,
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '2 minutes',
         clock_timestamp() - interval '1 minute'
       )`,
      [
        expiredChallenge,
        accountA,
        MAINNET_FINGERPRINT,
        Buffer.from('expired-payload'),
        iv(36),
        tag(36),
        digest(11),
        digest(12),
        digest(13),
        digest(14),
      ],
    );
    const expired = await pool.query<{ prepare_outcome: string }>(
      'SELECT prepare_outcome FROM prepare_wallet_ownership_challenge($1, $2, $3)',
      [expiredChallenge, accountA, randomUUID()],
    );
    expect(expired.rows).toEqual([{ prepare_outcome: 'EXPIRED' }]);
    await expect(
      pool.query(
        `UPDATE wallet_registration_audit_events SET reason_code = 'NONE'
         WHERE challenge_id = $1`,
        [expiredChallenge],
      ),
    ).rejects.toMatchObject({ code: '55000' });

    for (let index = 0; index < 5; index += 1) {
      await beginChallenge({
        challengeId: randomUUID(),
        accountId: accountA,
        addressDigest: digest(50 + index),
        messageDigest: digest(60 + index),
        nonceDigest: digest(70 + index),
        payloadFill: 80 + index,
      });
    }
    await expect(
      beginChallenge({
        challengeId: randomUUID(),
        accountId: accountA,
        addressDigest: digest(90),
        messageDigest: digest(91),
        nonceDigest: digest(92),
      }),
    ).rejects.toMatchObject({ code: '54000' });
  });

  it('serializes concurrent registrations at the 32-active-wallet account cap', async () => {
    const accountId = randomUUID();
    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);

    async function issueChallenge(): Promise<string> {
      const challengeId = randomUUID();
      await beginChallenge({
        challengeId,
        accountId,
        addressDigest: randomBytes(32),
        messageDigest: randomBytes(32),
        nonceDigest: randomBytes(32),
      });
      return challengeId;
    }

    async function completeChallenge(challengeId: string, fill: number): Promise<QueryResult> {
      return pool.query(
        `SELECT * FROM complete_wallet_registration(
           $1, $2, $3, 1::smallint, $4, $5, $6, 1::smallint, $7, $8, $9, $10
         )`,
        [
          challengeId,
          accountId,
          randomUUID(),
          Buffer.from(`capacity-address-${fill}`),
          iv(fill),
          tag(fill),
          Buffer.from(`capacity-metadata-${fill}`),
          iv(fill + 1),
          tag(fill + 1),
          randomUUID(),
        ],
      );
    }

    for (let index = 0; index < 31; index += 1) {
      await completeChallenge(await issueChallenge(), 120 + index);
    }

    const contenders = await Promise.all([issueChallenge(), issueChallenge()]);
    const outcomes = await Promise.allSettled([
      completeChallenge(contenders[0]!, 200),
      completeChallenge(contenders[1]!, 202),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: '54000' });

    await expect(
      pool.query<{ wallet_count: number }>(
        `SELECT pg_catalog.count(*)::integer AS wallet_count
         FROM list_active_wallet_registrations($1::uuid)`,
        [accountId],
      ),
    ).resolves.toMatchObject({ rows: [{ wallet_count: 32 }] });
  });

  it('rechecks expiry after a completion waits for the challenge row lock', async () => {
    const accountId = randomUUID();
    const challengeId = randomUUID();
    const applicationName = `kan56_lock_${randomUUID()}`;
    const issuedAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 4_000);

    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);
    await pool.query(
      `INSERT INTO wallet_ownership_challenges (
         challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
         registry_environment, registry_version, registry_fingerprint_sha256,
         challenge_payload_key_version, challenge_payload_ciphertext,
         challenge_payload_iv, challenge_payload_auth_tag,
         address_digest_version, address_digest, domain_digest_version, domain_digest,
         message_digest_version, message_digest, nonce_digest_version, nonce_digest,
         created_at, issued_at, expires_at
       ) VALUES (
         $1, $2, 'EVM_ERC4361_ERC191', 'eip155', '1',
         'MAINNET', 1, $3, 1, $4, $5, $6,
         1, $7, 1, $8, 1, $9, 1, $10,
         $11, $11, $12
       )`,
      [
        challengeId,
        accountId,
        MAINNET_FINGERPRINT,
        Buffer.from('lock-wait-payload'),
        iv(100),
        tag(100),
        digest(101),
        digest(102),
        digest(103),
        digest(104),
        issuedAt,
        expiresAt,
      ],
    );

    const lockClient = await pool.connect();
    const completionClient = await pool.connect();
    let completionPromise:
      | Promise<
          QueryResult<{
            registration_outcome: string;
            wallet_id: string | null;
            registered_at: Date | null;
          }>
        >
      | undefined;

    try {
      await completionClient.query("SELECT set_config('application_name', $1, false)", [
        applicationName,
      ]);
      await lockClient.query('BEGIN');
      await lockClient.query(
        'SELECT challenge_id FROM wallet_ownership_challenges WHERE challenge_id = $1 FOR UPDATE',
        [challengeId],
      );

      completionPromise = completionClient.query(
        `SELECT * FROM complete_wallet_registration(
           $1, $2, $3, 1::smallint, $4, $5, $6, 1::smallint, $7, $8, $9, $10
         )`,
        [
          challengeId,
          accountId,
          randomUUID(),
          Buffer.from('lock-wait-address'),
          iv(105),
          tag(105),
          Buffer.from('lock-wait-metadata'),
          iv(106),
          tag(106),
          randomUUID(),
        ],
      );

      let isWaitingForLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await adminPool.query<{ blocker_count: number }>(
          `SELECT pg_catalog.cardinality(pg_catalog.pg_blocking_pids(pid)) AS blocker_count
           FROM pg_catalog.pg_stat_activity
           WHERE application_name = $1`,
          [applicationName],
        );
        if ((activity.rows[0]?.blocker_count ?? 0) > 0) {
          isWaitingForLock = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }

      expect(isWaitingForLock).toBe(true);
      await waitUntilChallengeExpired(challengeId);

      await lockClient.query('COMMIT');
      const completed = await completionPromise;
      completionPromise = undefined;
      expect(completed.rows).toEqual([
        { registration_outcome: 'EXPIRED', wallet_id: null, registered_at: null },
      ]);
    } finally {
      await lockClient.query('ROLLBACK').catch(() => undefined);
      lockClient.release();
      if (completionPromise) await completionPromise.catch(() => undefined);
      completionClient.release();
    }

    const terminal = await pool.query<{
      status: string;
      challenge_payload_ciphertext: Buffer | null;
      payload_destroyed_at: Date | null;
    }>(
      `SELECT status, challenge_payload_ciphertext, payload_destroyed_at
       FROM wallet_ownership_challenges WHERE challenge_id = $1`,
      [challengeId],
    );
    expect(terminal.rows).toEqual([
      {
        status: 'EXPIRED',
        challenge_payload_ciphertext: null,
        payload_destroyed_at: expect.any(Date),
      },
    ]);
  });

  it('rechecks expiry after a completion waits for the wallet identity advisory lock', async () => {
    const accountId = randomUUID();
    const challengeId = randomUUID();
    const applicationName = `kan56_wallet_lock_${randomUUID()}`;
    const addressDigest = digest(111);
    const issuedAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 4_000);

    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);
    await pool.query(
      `INSERT INTO wallet_ownership_challenges (
         challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
         registry_environment, registry_version, registry_fingerprint_sha256,
         challenge_payload_key_version, challenge_payload_ciphertext,
         challenge_payload_iv, challenge_payload_auth_tag,
         address_digest_version, address_digest, domain_digest_version, domain_digest,
         message_digest_version, message_digest, nonce_digest_version, nonce_digest,
         created_at, issued_at, expires_at
       ) VALUES (
         $1, $2, 'EVM_ERC4361_ERC191', 'eip155', '1',
         'MAINNET', 1, $3, 1, $4, $5, $6,
         1, $7, 1, $8, 1, $9, 1, $10,
         $11, $11, $12
       )`,
      [
        challengeId,
        accountId,
        MAINNET_FINGERPRINT,
        Buffer.from('wallet-lock-wait-payload'),
        iv(110),
        tag(110),
        addressDigest,
        digest(112),
        digest(113),
        digest(114),
        issuedAt,
        expiresAt,
      ],
    );

    const lockClient = await pool.connect();
    const completionClient = await pool.connect();
    let completionPromise:
      | Promise<
          QueryResult<{
            registration_outcome: string;
            wallet_id: string | null;
            registered_at: Date | null;
          }>
        >
      | undefined;

    try {
      await completionClient.query("SELECT set_config('application_name', $1, false)", [
        applicationName,
      ]);
      await lockClient.query('BEGIN');
      await lockClient.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended(
             'eip155:1:1:' || pg_catalog.encode($1::bytea, 'hex'),
             56002
           )
         )`,
        [addressDigest],
      );

      completionPromise = completionClient.query(
        `SELECT * FROM complete_wallet_registration(
           $1, $2, $3, 1::smallint, $4, $5, $6, 1::smallint, $7, $8, $9, $10
         )`,
        [
          challengeId,
          accountId,
          randomUUID(),
          Buffer.from('wallet-lock-wait-address'),
          iv(115),
          tag(115),
          Buffer.from('wallet-lock-wait-metadata'),
          iv(116),
          tag(116),
          randomUUID(),
        ],
      );

      let isWaitingForLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await adminPool.query<{ blocker_count: number }>(
          `SELECT pg_catalog.cardinality(pg_catalog.pg_blocking_pids(pid)) AS blocker_count
           FROM pg_catalog.pg_stat_activity
           WHERE application_name = $1`,
          [applicationName],
        );
        if ((activity.rows[0]?.blocker_count ?? 0) > 0) {
          isWaitingForLock = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }

      expect(isWaitingForLock).toBe(true);
      await waitUntilChallengeExpired(challengeId);

      await lockClient.query('COMMIT');
      const completed = await completionPromise;
      completionPromise = undefined;
      expect(completed.rows).toEqual([
        { registration_outcome: 'EXPIRED', wallet_id: null, registered_at: null },
      ]);
    } finally {
      await lockClient.query('ROLLBACK').catch(() => undefined);
      lockClient.release();
      if (completionPromise) await completionPromise.catch(() => undefined);
      completionClient.release();
    }

    const terminal = await pool.query<{
      status: string;
      challenge_payload_ciphertext: Buffer | null;
      payload_destroyed_at: Date | null;
    }>(
      `SELECT status, challenge_payload_ciphertext, payload_destroyed_at
       FROM wallet_ownership_challenges WHERE challenge_id = $1`,
      [challengeId],
    );
    expect(terminal.rows).toEqual([
      {
        status: 'EXPIRED',
        challenge_payload_ciphertext: null,
        payload_destroyed_at: expect.any(Date),
      },
    ]);
    const wallets = await pool.query<{ wallet_count: string }>(
      `SELECT count(*) AS wallet_count
       FROM registered_wallets
       WHERE chain_namespace = 'eip155'
         AND chain_reference = '1'
         AND address_digest_version = 1
         AND address_digest = $1`,
      [addressDigest],
    );
    expect(wallets.rows).toEqual([{ wallet_count: '0' }]);
  });
});
