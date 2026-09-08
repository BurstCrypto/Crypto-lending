import { randomBytes, randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { parseAccountId, type AccountId } from '../../src/accounts/domain/account-profile';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039 } from '../../src/infrastructure/database/migrations/0039-persist-verified-mainnet-signed-submission-proof.migration';
import { createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040 } from '../../src/infrastructure/database/migrations/0040-preserve-mainnet-financial-action-recovery-through-wallet-identity-key-rotation.migration';
import { createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041 } from '../../src/infrastructure/database/migrations/0041-preserve-revoked-wallet-metadata-key-retirement.migration';
import type {
  PreparedWalletMetadataRewrap,
  WalletMetadataRewrapScope,
} from '../../src/wallets/application/ports/wallet-metadata-rewrap-repository.port';
import { WalletMetadataRewrapCoordinator } from '../../src/wallets/application/wallet-metadata-rewrap.coordinator';
import type { WalletOwnershipChainId } from '../../src/wallets/domain/wallet-identity';
import { PostgresWalletMetadataRewrapRepository } from '../../src/wallets/infrastructure/postgres/postgres-wallet-metadata-rewrap.repository';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  digestWalletIdentity,
  sealWalletRegistrationValue,
  type SealedWalletRegistrationValue,
  type WalletRegistrationDigestReference,
} from '../../src/wallets/infrastructure/crypto/wallet-registration-crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const MAINNET_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const IDENTITY_KEY_V1 = createWalletRegistrationKey(
  'identity-hmac',
  1,
  Buffer.alloc(32, 61).toString('base64url'),
);
const METADATA_KEY_V1 = createWalletRegistrationKey(
  'metadata-seal',
  1,
  Buffer.alloc(32, 62).toString('base64url'),
);
const METADATA_KEY_V2 = createWalletRegistrationKey(
  'metadata-seal',
  2,
  Buffer.alloc(32, 63).toString('base64url'),
);
const IDENTITY_KEYS = createWalletRegistrationKeyRing('identity-hmac', 1, [IDENTITY_KEY_V1]);
const METADATA_KEYS = createWalletRegistrationKeyRing('metadata-seal', 2, [
  METADATA_KEY_V1,
  METADATA_KEY_V2,
]);

interface WalletFixture {
  readonly accountId: AccountId;
  readonly walletId: string;
  readonly challengeId: string;
  readonly chainId: WalletOwnershipChainId;
  readonly address: string;
  readonly addressDigest: WalletRegistrationDigestReference<'address'>;
  readonly registeredAt: Date;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Revoked wallet metadata rewrap integration requires loopback PostgreSQL');
  }
}

function bytes(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function sealedParams(value: SealedWalletRegistrationValue): readonly unknown[] {
  return [value.keyVersion, bytes(value.ciphertext), bytes(value.iv), bytes(value.authTag)];
}

describeWithPostgres('migration 0041 revoked wallet metadata key retirement', () => {
  jest.setTimeout(60_000);

  const schema = `revoked_wallet_rewrap_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let pool: Pool;
  let repository: PostgresWalletMetadataRewrapRepository;
  let coordinator: WalletMetadataRewrapCoordinator;

  async function registerWallet(
    chainId: WalletOwnershipChainId,
    address: string,
  ): Promise<WalletFixture> {
    const accountId = parseAccountId(randomUUID());
    const walletId = randomUUID();
    const challengeId = randomUUID();
    const addressDigest = digestWalletIdentity(IDENTITY_KEY_V1, chainId, address);
    const [chainNamespace, chainReference] = chainId.split(':');
    if (!chainNamespace || !chainReference) throw new Error('chain fixture malformed');
    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);
    const sealBase = { challengeId, accountId, networkId: chainId, addressDigest } as const;
    const challengePayload = sealWalletRegistrationValue(
      METADATA_KEY_V2,
      { ...sealBase, field: 'challenge' },
      '{"fixture":"registration"}',
    );
    const issuedAt = new Date();
    await pool.query(
      `SELECT * FROM begin_wallet_ownership_challenge_rotatable(
        $1::uuid, $2::uuid, $3::text,
        $4::text, $5::text, 'MAINNET'::text, 1::integer, $6::text,
        $7::smallint, $8::bytea, $9::bytea, $10::bytea,
        1::smallint, $11::bytea, 1::smallint, $12::bytea,
        1::smallint, $13::bytea, 1::smallint, $14::bytea,
        $15::timestamptz, $16::timestamptz, $17::uuid,
        ARRAY[1]::smallint[], ARRAY[$18::text]::text[]
      )`,
      [
        challengeId,
        accountId,
        chainNamespace === 'eip155' ? 'EVM_ERC4361_ERC191' : 'SOLANA_SIWS_SIGN_IN',
        chainNamespace,
        chainReference,
        MAINNET_FINGERPRINT,
        ...sealedParams(challengePayload),
        Buffer.from(addressDigest.value, 'hex'),
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
        issuedAt,
        new Date(issuedAt.getTime() + 300_000),
        randomUUID(),
        addressDigest.value,
      ],
    );
    const walletSealBase = { ...sealBase, walletId } as const;
    const encryptedAddress = sealWalletRegistrationValue(
      METADATA_KEY_V1,
      { ...walletSealBase, field: 'address' },
      address,
    );
    const encryptedMetadata = sealWalletRegistrationValue(
      METADATA_KEY_V1,
      { ...walletSealBase, field: 'metadata' },
      JSON.stringify({
        schemaVersion: 1,
        proofKind: chainNamespace === 'eip155' ? 'EVM_EIP191_EOA' : 'SOLANA_ED25519',
        registryEnvironment: 'MAINNET',
        registryVersion: 1,
        registryFingerprintSha256: MAINNET_FINGERPRINT,
      }),
    );
    await pool.query(
      `SELECT * FROM complete_wallet_registration_rotatable(
        $1::uuid, $2::uuid, $3::uuid,
        $4::smallint, $5::bytea, $6::bytea, $7::bytea,
        $8::smallint, $9::bytea, $10::bytea, $11::bytea, $12::uuid
      )`,
      [
        challengeId,
        accountId,
        walletId,
        ...sealedParams(encryptedAddress),
        ...sealedParams(encryptedMetadata),
        randomUUID(),
      ],
    );
    const wallet = await pool.query<{ registered_at: Date }>(
      'SELECT registered_at FROM registered_wallets WHERE wallet_id = $1',
      [walletId],
    );
    const registeredAt = wallet.rows[0]?.registered_at;
    if (!(registeredAt instanceof Date)) throw new Error('registered wallet fixture missing');
    return Object.freeze({
      accountId,
      walletId,
      challengeId,
      chainId,
      address,
      addressDigest,
      registeredAt,
    });
  }

  async function revokeWallet(fixture: WalletFixture): Promise<Date> {
    const result = await pool.query<{ revocation_outcome: string }>(
      'SELECT revocation_outcome FROM revoke_wallet_registration($1, $2, $3)',
      [fixture.accountId, fixture.walletId, randomUUID()],
    );
    expect(result.rows).toEqual([{ revocation_outcome: 'REVOKED' }]);
    const wallet = await pool.query<{ revoked_at: Date }>(
      'SELECT revoked_at FROM registered_wallets WHERE wallet_id = $1',
      [fixture.walletId],
    );
    const revokedAt = wallet.rows[0]?.revoked_at;
    if (!(revokedAt instanceof Date)) throw new Error('revoked wallet fixture missing');
    return revokedAt;
  }

  function completionFor(
    fixture: WalletFixture,
    prepared: PreparedWalletMetadataRewrap,
  ): Parameters<PostgresWalletMetadataRewrapRepository['complete']>[0] {
    const binding = {
      walletId: fixture.walletId,
      challengeId: fixture.challengeId,
      accountId: fixture.accountId,
      networkId: fixture.chainId,
      addressDigest: fixture.addressDigest,
    } as const;
    return Object.freeze({
      commandId: prepared.commandId,
      accountId: fixture.accountId,
      walletId: fixture.walletId,
      targetKeyVersion: 2,
      preparedStateSha256: prepared.preparedStateSha256,
      encryptedAddress: sealWalletRegistrationValue(
        METADATA_KEY_V2,
        { ...binding, field: 'address' },
        fixture.address,
      ),
      encryptedMetadata: sealWalletRegistrationValue(
        METADATA_KEY_V2,
        { ...binding, field: 'metadata' },
        JSON.stringify({
          schemaVersion: 1,
          proofKind: fixture.chainId.startsWith('eip155:') ? 'EVM_EIP191_EOA' : 'SOLANA_ED25519',
          registryEnvironment: 'MAINNET',
          registryVersion: 1,
          registryFingerprintSha256: MAINNET_FINGERPRINT,
        }),
      ),
    });
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: testDatabaseUrl as string,
      options: `-c search_path=${schema}`,
    });
    const through0040 = [
      ...DATABASE_TEST_SCHEMA_MIGRATION_LIST,
      createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039,
      createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040,
    ];
    await new MigrationRunner(pool, [
      ...through0040,
      createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041,
    ]).up();
    repository = new PostgresWalletMetadataRewrapRepository(new PostgresService(pool));
    coordinator = new WalletMetadataRewrapCoordinator(repository, {
      registryEnvironment: 'MAINNET',
      identityHmacKeys: IDENTITY_KEYS,
      metadataSealKeys: METADATA_KEYS,
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  it('installs exact owner-only state and verifies an empty boundary', async () => {
    const verification = createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041.verifySql;
    if (!verification) throw new Error('0041 verifier required');
    await expect(pool.query(verification)).resolves.toMatchObject({ rows: [{ valid: true }] });
    await expect(
      pool.query('SELECT verify_wallet_metadata_revoked_rewrap_state_v1() AS valid'),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
    const acl = await pool.query<{ public_execute: boolean; api_execute: boolean }>(
      `SELECT
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS procedure
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
          ) AS acl
          WHERE procedure.oid = pg_catalog.to_regprocedure(
            'authorize_revoked_wallet_metadata_rewrap_v1(uuid)'
          ) AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute,
        pg_catalog.has_function_privilege(
          'crypto_api_runtime', 'authorize_revoked_wallet_metadata_rewrap_v1(uuid)', 'EXECUTE'
        ) AS api_execute`,
    );
    expect(acl.rows).toEqual([{ public_execute: false, api_execute: false }]);
  });

  it.each([
    {
      chainId: 'eip155:1' as const,
      address: '0x1111111111111111111111111111111111111111',
    },
    {
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const,
      address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    },
  ])('rewraps an exact revoked $chainId wallet without reactivation', async (network) => {
    const fixture = await registerWallet(network.chainId, network.address);
    const revokedAt = await revokeWallet(fixture);
    const commandId = randomUUID();
    await expect(
      coordinator.rewrap({ commandId, accountId: fixture.accountId, walletId: fixture.walletId }),
    ).resolves.toEqual({ status: 'completed', commandId });

    const wallet = await pool.query<{
      status: string;
      registered_at: Date;
      revoked_at: Date;
      address_key_version: number;
      metadata_key_version: number;
    }>('SELECT * FROM registered_wallets WHERE wallet_id = $1', [fixture.walletId]);
    expect(wallet.rows).toEqual([
      expect.objectContaining({
        status: 'REVOKED',
        registered_at: fixture.registeredAt,
        revoked_at: revokedAt,
        address_key_version: 2,
        metadata_key_version: 2,
      }),
    ]);
    const aliases = await pool.query<{ status: string; revoked_at: Date }>(
      `SELECT status, revoked_at FROM registered_wallet_identity_digests
       WHERE wallet_id = $1 ORDER BY address_digest_version`,
      [fixture.walletId],
    );
    expect(aliases.rows).toEqual([{ status: 'REVOKED', revoked_at: revokedAt }]);
    const authorization = await pool.query<{
      authorization_reason: string;
      verification_digest_sha256: Buffer;
    }>(
      `SELECT authorization_reason, verification_digest_sha256
       FROM wallet_metadata_revoked_rewrap_authorizations WHERE command_id = $1`,
      [commandId],
    );
    expect(authorization.rows[0]?.authorization_reason).toBe('PREPARED_WHILE_REVOKED');
    expect(authorization.rows[0]?.verification_digest_sha256).toHaveLength(32);
    expect(authorization.rows[0]?.verification_digest_sha256).not.toEqual(
      Buffer.from(fixture.addressDigest.value, 'hex'),
    );
    const activeList = await pool.query(
      'SELECT * FROM list_active_wallet_registrations_rotatable($1)',
      [fixture.accountId],
    );
    expect(activeList.rows).toEqual([]);
    const readiness = await repository.retirementReadiness(1);
    expect(readiness).toMatchObject({
      registeredAddressCount: 0,
      registeredMetadataCount: 0,
      retainedChallengeCount: 0,
      unexpiredChallengeCount: 0,
      openRewrapCommandCount: 0,
      ready: true,
    });
    if (network.chainId === 'eip155:1') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `ALTER TABLE wallet_identity_key_policy
           DISABLE TRIGGER wallet_identity_key_policy_immutable_row`,
        );
        await client.query(
          `ALTER TABLE wallet_identity_key_policy
           DISABLE TRIGGER wallet_identity_rotation_recovery_readiness`,
        );
        await client.query(
          `UPDATE wallet_identity_key_policy
           SET active_write_version = 2, accepted_read_versions = ARRAY[2]::smallint[]
           WHERE policy_name = 'wallet-registration-identity-hmac'`,
        );
        // Simulate a separately approved, completed v1 retirement. Transactional rollback
        // restores the production policy and both enforcement triggers after this assertion.
        await expect(
          client.query('SELECT verify_wallet_metadata_revoked_rewrap_state_v1() AS valid'),
        ).resolves.toMatchObject({ rows: [{ valid: true }] });
        await client.query('ROLLBACK');
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }
  });

  it('fails closed across revocation, then resumes through an audited retry', async () => {
    const fixture = await registerWallet('eip155:1', '0x2222222222222222222222222222222222222222');
    const scope: WalletMetadataRewrapScope = Object.freeze({
      commandId: randomUUID(),
      accountId: fixture.accountId,
      walletId: fixture.walletId,
      targetKeyVersion: 2,
    });
    const prepared = await repository.prepare(scope);
    if (prepared.status !== 'prepared') throw new Error('prepared fixture required');
    const revokedAt = await revokeWallet(fixture);

    await expect(repository.complete(completionFor(fixture, prepared))).resolves.toEqual({
      status: 'invalid',
    });
    await expect(
      coordinator.rewrap({
        commandId: scope.commandId,
        accountId: fixture.accountId,
        walletId: fixture.walletId,
      }),
    ).resolves.toEqual({ status: 'completed', commandId: scope.commandId });
    const evidence = await pool.query<{
      authorization_reason: string;
      registered_at: Date;
      revoked_at: Date;
    }>(
      `SELECT authorization_reason, registered_at, revoked_at
       FROM wallet_metadata_revoked_rewrap_authorizations WHERE command_id = $1`,
      [scope.commandId],
    );
    expect(evidence.rows).toEqual([
      {
        authorization_reason: 'REVOKED_AFTER_PREPARE',
        registered_at: fixture.registeredAt,
        revoked_at: revokedAt,
      },
    ]);
  });

  it('rechecks command expiry after a wallet-row lock wait before any mutation', async () => {
    const fixture = await registerWallet('eip155:1', '0x5555555555555555555555555555555555555555');
    const commandId = randomUUID();
    const prepared = await repository.prepare({
      commandId,
      accountId: fixture.accountId,
      walletId: fixture.walletId,
      targetKeyVersion: 2,
    });
    if (prepared.status !== 'prepared') throw new Error('expiry preparation required');
    await pool.query(
      `ALTER TABLE wallet_metadata_rewrap_commands
       DISABLE TRIGGER wallet_metadata_rewrap_command_lifecycle_row`,
    );
    await pool.query(
      `WITH database_time AS (
         SELECT pg_catalog.clock_timestamp() - interval '9 minutes 59 seconds' AS prepared_at
       )
       UPDATE wallet_metadata_rewrap_commands
       SET prepared_at = database_time.prepared_at,
           expires_at = database_time.prepared_at + interval '10 minutes'
       FROM database_time WHERE command_id = $1`,
      [commandId],
    );
    await pool.query(
      `ALTER TABLE wallet_metadata_rewrap_commands
       ENABLE ALWAYS TRIGGER wallet_metadata_rewrap_command_lifecycle_row`,
    );
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT wallet_id FROM registered_wallets WHERE wallet_id = $1 FOR UPDATE',
        [fixture.walletId],
      );
      const completion = repository.complete(completionFor(fixture, prepared));
      let observedLockWait = false;
      for (let attempt = 0; attempt < 20 && !observedLockWait; attempt += 1) {
        const activity = await adminPool.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_catalog.pg_stat_activity
             WHERE datname = pg_catalog.current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%complete_wallet_metadata_rewrap%'
           ) AS waiting`,
        );
        observedLockWait = activity.rows[0]?.waiting === true;
        if (!observedLockWait) {
          await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
      }
      expect(observedLockWait).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 2_500));
      await blocker.query('COMMIT');
      await expect(completion).resolves.toEqual({ status: 'invalid' });
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
    const wallet = await pool.query<{ address_key_version: number; status: string }>(
      'SELECT address_key_version, status FROM registered_wallets WHERE wallet_id = $1',
      [fixture.walletId],
    );
    expect(wallet.rows).toEqual([{ address_key_version: 1, status: 'ACTIVE' }]);
    const command = await pool.query<{ status: string; result_state_sha256: string | null }>(
      'SELECT status, result_state_sha256 FROM wallet_metadata_rewrap_commands WHERE command_id = $1',
      [commandId],
    );
    expect(command.rows).toEqual([{ status: 'PREPARED', result_state_sha256: null }]);
  });

  it('preserves the active-wallet path and rejects stale or forged authorization', async () => {
    const active = await registerWallet('eip155:1', '0x3333333333333333333333333333333333333333');
    const activeCommand = randomUUID();
    await expect(
      coordinator.rewrap({
        commandId: activeCommand,
        accountId: active.accountId,
        walletId: active.walletId,
      }),
    ).resolves.toEqual({ status: 'completed', commandId: activeCommand });
    await expect(
      pool.query(
        `SELECT rewrap_outcome FROM prepare_wallet_metadata_rewrap(
          $1::uuid, $2::uuid, $3::uuid, 2::smallint
        )`,
        [randomUUID(), active.accountId, active.walletId],
      ),
    ).resolves.toMatchObject({ rows: [{ rewrap_outcome: 'INVALID' }] });

    const revoked = await registerWallet('eip155:1', '0x4444444444444444444444444444444444444444');
    await revokeWallet(revoked);
    const forgedCommand = randomUUID();
    const prepared = await repository.prepare({
      commandId: forgedCommand,
      accountId: revoked.accountId,
      walletId: revoked.walletId,
      targetKeyVersion: 2,
    });
    if (prepared.status !== 'prepared') throw new Error('revoked preparation required');
    await expect(
      pool.query(
        `INSERT INTO wallet_metadata_revoked_rewrap_authorizations (
          command_id, account_id, wallet_id, registered_at, revoked_at,
          state_sha256, verification_digest_version, verification_digest_sha256,
          authorization_reason, authorized_at
        ) SELECT $1, account_id, wallet_id, registered_at, revoked_at,
          $2, 1, $3, 'PREPARED_WHILE_REVOKED', pg_catalog.clock_timestamp()
          FROM registered_wallets WHERE wallet_id = $4`,
        [randomUUID(), prepared.preparedStateSha256, randomBytes(32), revoked.walletId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        `UPDATE wallet_metadata_revoked_rewrap_authorizations
         SET state_sha256 = $1 WHERE command_id = $2`,
        [randomBytes(32).toString('hex'), forgedCommand],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query('TRUNCATE wallet_metadata_revoked_rewrap_authorizations'),
    ).rejects.toMatchObject({
      code: '55000',
    });
    await expect(
      repository.complete({
        ...completionFor(revoked, prepared),
        preparedStateSha256: randomBytes(32).toString('hex'),
      }),
    ).resolves.toEqual({ status: 'invalid' });
    await expect(
      pool.query('SELECT verify_wallet_metadata_revoked_rewrap_state_v1() AS valid'),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
  });

  it('refuses rollback even before use rather than restoring the revoked-wallet denial', async () => {
    await expect(
      pool.query(
        createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041.downSql as string,
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });
});
