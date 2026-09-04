import { randomBytes, randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021 } from '../../src/infrastructure/database/migrations/0021-create-stablecoin-price-evidence-read-model.migration';
import { createWalletKeyRotationBoundaryTestSchemaMigrationV0022 } from '../../src/infrastructure/database/migrations/0022-create-wallet-key-rotation-boundary.migration';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const MAINNET_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Wallet key rotation integration requires a loopback PostgreSQL fixture');
  }
}

describeWithPostgres('wallet registration key rotation boundary', () => {
  jest.setTimeout(30_000);

  const schema = `wallet_rotation_${randomUUID().replaceAll('-', '')}`;
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
    const configured = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(({ id }) => id <= '0022');
    for (const migration of [
      createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021,
      createWalletKeyRotationBoundaryTestSchemaMigrationV0022,
    ]) {
      if (!configured.some((candidate) => candidate.id === migration.id))
        configured.push(migration);
    }
    await new MigrationRunner(pool, configured).up();
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  async function beginRotatable(input: {
    accountId: string;
    challengeId: string;
    versions: readonly number[];
    digests: readonly Buffer[];
  }): Promise<void> {
    const issuedAt = new Date();
    const activeDigest = input.digests.at(-1);
    if (!activeDigest) throw new Error('active digest fixture required');
    await pool.query(
      `SELECT * FROM begin_wallet_ownership_challenge_rotatable(
        $1::uuid, $2::uuid, 'EVM_ERC4361_ERC191'::text,
        'eip155'::text, '1'::text, 'MAINNET'::text, 1::integer, $3::text,
        1::smallint, $4::bytea, $5::bytea, $6::bytea,
        $7::smallint, $8::bytea, 1::smallint, $9::bytea,
        1::smallint, $10::bytea, 1::smallint, $11::bytea,
        $12::timestamptz, $13::timestamptz, $14::uuid,
        $15::smallint[], $16::text[]
      )`,
      [
        input.challengeId,
        input.accountId,
        MAINNET_FINGERPRINT,
        randomBytes(48),
        randomBytes(12),
        randomBytes(16),
        input.versions.at(-1),
        activeDigest,
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
        issuedAt,
        new Date(issuedAt.getTime() + 120_000),
        randomUUID(),
        input.versions,
        input.digests.map((digest) => digest.toString('hex')),
      ],
    );
  }

  async function completeRotatable(accountId: string, challengeId: string): Promise<string> {
    const result = await pool.query<{ registration_outcome: string }>(
      `SELECT registration_outcome
       FROM complete_wallet_registration_rotatable(
         $1::uuid, $2::uuid, $3::uuid,
         1::smallint, $4::bytea, $5::bytea, $6::bytea,
         1::smallint, $7::bytea, $8::bytea, $9::bytea,
         $10::uuid
       )`,
      [
        challengeId,
        accountId,
        randomUUID(),
        randomBytes(42),
        randomBytes(12),
        randomBytes(16),
        randomBytes(96),
        randomBytes(12),
        randomBytes(16),
        randomUUID(),
      ],
    );
    const outcome = result.rows[0]?.registration_outcome;
    if (!outcome) throw new Error('registration outcome expected');
    return outcome;
  }

  it('verifies the exact immutable singleton policy and least-privilege schema', async () => {
    const verification = createWalletKeyRotationBoundaryTestSchemaMigrationV0022.verifySql;
    if (!verification) throw new Error('migration 0022 verification SQL required');
    await expect(pool.query<{ valid: boolean }>(verification)).resolves.toMatchObject({
      rows: [{ valid: true }],
    });

    await expect(
      pool.query(`UPDATE wallet_identity_key_policy SET active_write_version = 2`),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(`TRUNCATE wallet_ownership_challenge_identity_digests`),
    ).rejects.toMatchObject({ code: '55000' });

    await pool.query(
      `DROP TRIGGER registered_wallet_identity_digest_set_guard ON registered_wallets`,
    );
    await pool.query(`CREATE TRIGGER registered_wallet_identity_digest_set_guard
      BEFORE INSERT ON registered_wallet_identity_digests
      FOR EACH ROW EXECUTE FUNCTION enforce_registered_wallet_identity_digest_set()`);
    await expect(pool.query<{ valid: boolean }>(verification)).resolves.toMatchObject({
      rows: [{ valid: false }],
    });
    await pool.query(
      `DROP TRIGGER registered_wallet_identity_digest_set_guard
       ON registered_wallet_identity_digests`,
    );
    await pool.query(`CREATE TRIGGER registered_wallet_identity_digest_set_guard
      BEFORE INSERT ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION enforce_registered_wallet_identity_digest_set()`);
    await pool.query(`ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_identity_digest_set_guard`);

    await pool.query(`CREATE TRIGGER unexpected_wallet_rotation_trigger
      BEFORE INSERT ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION enforce_registered_wallet_identity_digest_set()`);
    await expect(pool.query<{ valid: boolean }>(verification)).resolves.toMatchObject({
      rows: [{ valid: false }],
    });
    await pool.query(`DROP TRIGGER unexpected_wallet_rotation_trigger ON registered_wallets`);

    await pool.query(`ALTER FUNCTION list_active_wallet_registrations_rotatable(uuid)
      RENAME TO list_active_wallet_registrations_rotatable_expected`);
    await pool.query(`CREATE FUNCTION list_active_wallet_registrations_rotatable(integer)
      RETURNS boolean LANGUAGE sql AS 'SELECT true'`);
    await expect(pool.query<{ valid: boolean }>(verification)).resolves.toMatchObject({
      rows: [{ valid: false }],
    });
    await pool.query(`DROP FUNCTION list_active_wallet_registrations_rotatable(integer)`);
    await pool.query(`ALTER FUNCTION list_active_wallet_registrations_rotatable_expected(uuid)
      RENAME TO list_active_wallet_registrations_rotatable`);
    await expect(pool.query<{ valid: boolean }>(verification)).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
  });

  it('makes legacy admission fail closed when no exact digest-alias set exists', async () => {
    const accountId = randomUUID();
    const challengeId = randomUUID();
    const issuedAt = new Date();
    await pool.query(`INSERT INTO accounts (account_id) VALUES ($1)`, [accountId]);
    await pool.query(
      `SELECT * FROM begin_wallet_ownership_challenge(
        $1::uuid, $2::uuid, 'EVM_ERC4361_ERC191'::text,
        'eip155'::text, '1'::text, 'MAINNET'::text, 1::integer, $3::text,
        1::smallint, $4::bytea, $5::bytea, $6::bytea,
        1::smallint, $7::bytea, 1::smallint, $8::bytea,
        1::smallint, $9::bytea, 1::smallint, $10::bytea,
        $11::timestamptz, $12::timestamptz, $13::uuid
      )`,
      [
        challengeId,
        accountId,
        MAINNET_FINGERPRINT,
        randomBytes(48),
        randomBytes(12),
        randomBytes(16),
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
        issuedAt,
        new Date(issuedAt.getTime() + 120_000),
        randomUUID(),
      ],
    );

    await expect(completeRotatable(accountId, challengeId)).rejects.toMatchObject({
      code: '55000',
    });
  });

  it('backfills a fresh re-proof and prevents cross-version duplicate ownership atomically', async () => {
    const accountA = randomUUID();
    const accountB = randomUUID();
    const originalChallenge = randomUUID();
    const reproofChallenge = randomUUID();
    const conflictingChallenge = randomUUID();
    const digests = [randomBytes(32), randomBytes(32)] as const;
    await pool.query(`INSERT INTO accounts (account_id) VALUES ($1), ($2)`, [accountA, accountB]);
    await beginRotatable({
      accountId: accountA,
      challengeId: originalChallenge,
      versions: [1],
      digests: [digests[0]],
    });
    await expect(completeRotatable(accountA, originalChallenge)).resolves.toBe('REGISTERED');

    await pool.query(`ALTER TABLE wallet_identity_key_policy
      DISABLE TRIGGER wallet_identity_key_policy_immutable_row`);
    await pool.query(`UPDATE wallet_identity_key_policy
      SET active_write_version = 2,
          accepted_read_versions = ARRAY[1, 2]::smallint[],
          updated_at = clock_timestamp()`);
    await pool.query(`ALTER TABLE wallet_identity_key_policy
      ENABLE ALWAYS TRIGGER wallet_identity_key_policy_immutable_row`);

    await beginRotatable({
      accountId: accountA,
      challengeId: reproofChallenge,
      versions: [1, 2],
      digests,
    });
    await expect(completeRotatable(accountA, reproofChallenge)).resolves.toBe('ALREADY_REGISTERED');

    await pool.query(`ALTER TABLE wallet_identity_key_policy
      DISABLE TRIGGER wallet_identity_key_policy_immutable_row`);
    await pool.query(`UPDATE wallet_identity_key_policy
      SET accepted_read_versions = ARRAY[2]::smallint[],
          updated_at = clock_timestamp()`);
    await pool.query(`ALTER TABLE wallet_identity_key_policy
      ENABLE ALWAYS TRIGGER wallet_identity_key_policy_immutable_row`);

    const roster = await pool.query<{
      active_address_digest_version: number;
      active_verification_digest_version: number;
      active_verification_digest: Buffer;
    }>(
      `SELECT active_address_digest_version,
              active_verification_digest_version,
              active_verification_digest
       FROM list_active_wallet_registrations_rotatable($1::uuid)`,
      [accountA],
    );
    expect(roster.rows).toEqual([
      expect.objectContaining({
        active_address_digest_version: 1,
        active_verification_digest_version: 2,
        active_verification_digest: digests[1],
      }),
    ]);

    await beginRotatable({
      accountId: accountB,
      challengeId: conflictingChallenge,
      versions: [2],
      digests: [digests[1]],
    });
    await expect(completeRotatable(accountB, conflictingChallenge)).resolves.toBe(
      'OWNERSHIP_CONFLICT',
    );

    const state = await pool.query<{
      active_wallets: string;
      active_aliases: string;
      versions: number[];
    }>(`SELECT
      (SELECT count(*) FROM registered_wallets WHERE status = 'ACTIVE')::text AS active_wallets,
      count(*)::text AS active_aliases,
      array_agg(address_digest_version ORDER BY address_digest_version) AS versions
      FROM registered_wallet_identity_digests WHERE status = 'ACTIVE'`);
    expect(state.rows).toEqual([{ active_wallets: '1', active_aliases: '2', versions: [1, 2] }]);
  });

  it('synchronizes every identity alias on revocation and refuses lossy rollback', async () => {
    const active = await pool.query<{ wallet_id: string; account_id: string }>(
      `SELECT wallet_id, account_id FROM registered_wallets WHERE status = 'ACTIVE'`,
    );
    const wallet = active.rows[0];
    if (!wallet) throw new Error('active wallet fixture expected');
    await expect(
      pool.query(`SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)`, [
        wallet.account_id,
        wallet.wallet_id,
        randomUUID(),
      ]),
    ).resolves.toMatchObject({ rows: [{ revocation_outcome: 'REVOKED' }] });

    const aliases = await pool.query<{ status: string; revoked_at: Date | null }>(
      `SELECT status, revoked_at FROM registered_wallet_identity_digests
       WHERE wallet_id = $1 ORDER BY address_digest_version`,
      [wallet.wallet_id],
    );
    expect(aliases.rows).toHaveLength(2);
    expect(aliases.rows.every((alias) => alias.status === 'REVOKED' && alias.revoked_at)).toBe(
      true,
    );

    await expect(
      pool.query(createWalletKeyRotationBoundaryTestSchemaMigrationV0022.downSql as string),
    ).rejects.toMatchObject({ code: '55000' });
  });
});
