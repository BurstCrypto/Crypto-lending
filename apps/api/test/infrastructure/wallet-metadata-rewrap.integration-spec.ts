import { randomBytes, randomUUID } from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { parseAccountId } from '../../src/accounts/domain/account-profile';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024 } from '../../src/infrastructure/database/migrations/0024-create-wallet-metadata-rewrap-boundary.migration';
import { WalletMetadataRewrapCoordinator } from '../../src/wallets/application/wallet-metadata-rewrap.coordinator';
import { PostgresWalletMetadataRewrapRepository } from '../../src/wallets/infrastructure/postgres/postgres-wallet-metadata-rewrap.repository';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  digestWalletIdentity,
  openWalletRegistrationValue,
  sealWalletRegistrationValue,
  type SealedWalletRegistrationValue,
} from '../../src/wallets/infrastructure/crypto/wallet-registration-crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const NETWORK_ID = 'eip155:1' as const;
const ADDRESS = '0x1111111111111111111111111111111111111111';
const MAINNET_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const KEY_V1 = Buffer.alloc(32, 41).toString('base64url');
const KEY_V2 = Buffer.alloc(32, 42).toString('base64url');
const IDENTITY_KEY = Buffer.alloc(32, 43).toString('base64url');

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Wallet metadata rewrap integration requires loopback PostgreSQL');
  }
}

function bytes(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function sealedParams(value: SealedWalletRegistrationValue): readonly unknown[] {
  return [value.keyVersion, bytes(value.ciphertext), bytes(value.iv), bytes(value.authTag)];
}

describeWithPostgres('wallet metadata rewrap boundary', () => {
  jest.setTimeout(30_000);

  const schema = `wallet_rewrap_${randomUUID().replaceAll('-', '')}`;
  const identityKey = createWalletRegistrationKey('identity-hmac', 1, IDENTITY_KEY);
  const identityKeys = createWalletRegistrationKeyRing('identity-hmac', 1, [identityKey]);
  const metadataKeyV1 = createWalletRegistrationKey('metadata-seal', 1, KEY_V1);
  const metadataKeyV2 = createWalletRegistrationKey('metadata-seal', 2, KEY_V2);
  const metadataKeys = createWalletRegistrationKeyRing('metadata-seal', 2, [
    metadataKeyV1,
    metadataKeyV2,
  ]);
  const addressDigest = digestWalletIdentity(identityKey, NETWORK_ID, ADDRESS);
  const accountId = parseAccountId(randomUUID());
  const walletId = randomUUID();
  const challengeId = randomUUID();
  const pendingChallengeId = randomUUID();
  const commandId = randomUUID();
  let adminPool: Pool;
  let pool: Pool;

  async function beginChallenge(
    client: Pool | PoolClient,
    input: Readonly<{
      challengeId: string;
      digest: Buffer;
      payload: SealedWalletRegistrationValue;
    }>,
  ): Promise<void> {
    const issuedAt = new Date();
    await client.query(
      `SELECT * FROM begin_wallet_ownership_challenge_rotatable(
        $1::uuid, $2::uuid, 'EVM_ERC4361_ERC191'::text,
        'eip155'::text, '1'::text, 'MAINNET'::text, 1::integer, $3::text,
        $4::smallint, $5::bytea, $6::bytea, $7::bytea,
        1::smallint, $8::bytea, 1::smallint, $9::bytea,
        1::smallint, $10::bytea, 1::smallint, $11::bytea,
        $12::timestamptz, $13::timestamptz, $14::uuid,
        ARRAY[1]::smallint[], ARRAY[$15::text]::text[]
      )`,
      [
        input.challengeId,
        accountId,
        MAINNET_FINGERPRINT,
        ...sealedParams(input.payload),
        input.digest,
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
        issuedAt,
        new Date(issuedAt.getTime() + 300_000),
        randomUUID(),
        input.digest.toString('hex'),
      ],
    );
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: testDatabaseUrl as string,
      options: `-c search_path=${schema}`,
    });
    const through0023 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(({ id }) => id <= '0023');
    await new MigrationRunner(pool, through0023).up();
    await pool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);

    const sealBase = {
      challengeId,
      accountId,
      networkId: NETWORK_ID,
      addressDigest,
    } as const;
    const challengePayload = sealWalletRegistrationValue(
      metadataKeyV1,
      { ...sealBase, field: 'challenge' },
      '{"fixture":"registration"}',
    );
    await beginChallenge(pool, {
      challengeId,
      digest: Buffer.from(addressDigest.value, 'hex'),
      payload: challengePayload,
    });
    const walletSealBase = { ...sealBase, walletId } as const;
    const encryptedAddress = sealWalletRegistrationValue(
      metadataKeyV1,
      { ...walletSealBase, field: 'address' },
      ADDRESS,
    );
    const encryptedMetadata = sealWalletRegistrationValue(
      metadataKeyV1,
      { ...walletSealBase, field: 'metadata' },
      JSON.stringify({
        schemaVersion: 1,
        proofKind: 'EVM_EIP191_EOA',
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

    const pendingDigest = randomBytes(32);
    const pendingPayload = sealWalletRegistrationValue(
      metadataKeyV1,
      {
        field: 'challenge',
        challengeId: pendingChallengeId,
        accountId,
        networkId: NETWORK_ID,
        addressDigest: {
          version: 1,
          value: pendingDigest.toString('hex') as typeof addressDigest.value,
        },
      },
      '{"fixture":"pending"}',
    );
    await beginChallenge(pool, {
      challengeId: pendingChallengeId,
      digest: pendingDigest,
      payload: pendingPayload,
    });

    await new MigrationRunner(pool, [
      ...through0023,
      createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024,
    ]).up();
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  it('backfills all pre-existing retained material and validates exact state', async () => {
    const registry = await pool.query<{
      source_kind: string;
      sealed_field: string;
      captured_by: string;
    }>(
      `SELECT source_kind, sealed_field, captured_by
       FROM wallet_metadata_seal_iv_registry
       ORDER BY source_kind, sealed_field`,
    );
    expect(registry.rows).toEqual([
      { source_kind: 'CHALLENGE', sealed_field: 'CHALLENGE', captured_by: 'BACKFILL' },
      { source_kind: 'WALLET', sealed_field: 'ADDRESS', captured_by: 'BACKFILL' },
      { source_kind: 'WALLET', sealed_field: 'METADATA', captured_by: 'BACKFILL' },
    ]);
    await expect(
      pool.query('SELECT verify_wallet_metadata_rewrap_state() AS valid'),
    ).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
    const verification = createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024.verifySql;
    if (!verification) throw new Error('0024 verifier required');
    await expect(pool.query(verification)).resolves.toMatchObject({ rows: [{ valid: true }] });
  });

  it('rejects a generic GUC bypass and stale, substituted, same-version, and duplicate requests', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_catalog.set_config(
          'crypto_lending.wallet_metadata_rewrap_command', $1, true
        )`,
        [randomUUID()],
      );
      await expect(
        client.query(`UPDATE registered_wallets SET address_iv = $1 WHERE wallet_id = $2`, [
          randomBytes(12),
          walletId,
        ]),
      ).rejects.toMatchObject({ code: '55000' });
      await client.query('ROLLBACK');

      await expect(
        pool.query(
          `SELECT rewrap_outcome FROM prepare_wallet_metadata_rewrap(
            $1::uuid, $2::uuid, $3::uuid, 1::smallint
          )`,
          [randomUUID(), accountId, walletId],
        ),
      ).resolves.toMatchObject({ rows: [{ rewrap_outcome: 'INVALID' }] });
      await expect(
        pool.query(
          `SELECT rewrap_outcome FROM prepare_wallet_metadata_rewrap(
            $1::uuid, $2::uuid, $3::uuid, 2::smallint
          )`,
          [randomUUID(), randomUUID(), walletId],
        ),
      ).resolves.toMatchObject({ rows: [{ rewrap_outcome: 'INVALID' }] });

      await client.query('BEGIN');
      const staleCommand = randomUUID();
      const prepared = await client.query<{ prepared_state_sha256: string }>(
        `SELECT prepared_state_sha256 FROM prepare_wallet_metadata_rewrap(
          $1::uuid, $2::uuid, $3::uuid, 2::smallint
        )`,
        [staleCommand, accountId, walletId],
      );
      await client.query(
        'ALTER TABLE registered_wallets DISABLE TRIGGER registered_wallet_seal_material_rewrap',
      );
      await client.query(
        'UPDATE registered_wallets SET address_ciphertext = $1 WHERE wallet_id = $2',
        [randomBytes(42), walletId],
      );
      await client.query(
        'ALTER TABLE registered_wallets ENABLE ALWAYS TRIGGER registered_wallet_seal_material_rewrap',
      );
      const stale = await client.query<{ rewrap_outcome: string }>(
        `SELECT rewrap_outcome FROM complete_wallet_metadata_rewrap(
          $1::uuid, $2::uuid, $3::uuid, $4::text,
          2::smallint, $5::bytea, $6::bytea, $7::bytea,
          2::smallint, $8::bytea, $9::bytea, $10::bytea
        )`,
        [
          staleCommand,
          accountId,
          walletId,
          prepared.rows[0]?.prepared_state_sha256,
          randomBytes(42),
          randomBytes(12),
          randomBytes(16),
          randomBytes(96),
          randomBytes(12),
          randomBytes(16),
        ],
      );
      expect(stale.rows).toEqual([{ rewrap_outcome: 'INVALID' }]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('atomically rewraps address and metadata, updates roster/resolver, and is idempotent', async () => {
    const repository = new PostgresWalletMetadataRewrapRepository(new PostgresService(pool));
    const coordinator = new WalletMetadataRewrapCoordinator(repository, {
      registryEnvironment: 'MAINNET',
      identityHmacKeys: identityKeys,
      metadataSealKeys: metadataKeys,
    });
    await expect(coordinator.rewrap({ commandId, accountId, walletId })).resolves.toEqual({
      status: 'completed',
      commandId,
    });
    await expect(coordinator.rewrap({ commandId, accountId, walletId })).resolves.toEqual({
      status: 'completed',
      commandId,
    });

    const wallet = await pool.query<{
      registered_by_challenge_id: string;
      address_digest: Buffer;
      address_key_version: number;
      address_ciphertext: Buffer;
      address_iv: Buffer;
      address_auth_tag: Buffer;
      metadata_key_version: number;
      metadata_ciphertext: Buffer;
      metadata_iv: Buffer;
      metadata_auth_tag: Buffer;
    }>('SELECT * FROM registered_wallets WHERE wallet_id = $1', [walletId]);
    const row = wallet.rows[0];
    if (!row) throw new Error('rewrapped wallet required');
    expect(row.address_digest).toEqual(Buffer.from(addressDigest.value, 'hex'));
    expect(row.address_key_version).toBe(2);
    expect(row.metadata_key_version).toBe(2);
    const binding = {
      walletId,
      challengeId: row.registered_by_challenge_id,
      accountId,
      networkId: NETWORK_ID,
      addressDigest,
    } as const;
    expect(
      openWalletRegistrationValue(
        metadataKeyV2,
        { ...binding, field: 'address' },
        {
          keyVersion: row.address_key_version,
          ciphertext: row.address_ciphertext.toString('base64url'),
          iv: row.address_iv.toString('base64url'),
          authTag: row.address_auth_tag.toString('base64url'),
        },
      ),
    ).toBe(ADDRESS);
    expect(
      JSON.parse(
        openWalletRegistrationValue(
          metadataKeyV2,
          { ...binding, field: 'metadata' },
          {
            keyVersion: row.metadata_key_version,
            ciphertext: row.metadata_ciphertext.toString('base64url'),
            iv: row.metadata_iv.toString('base64url'),
            authTag: row.metadata_auth_tag.toString('base64url'),
          },
        ),
      ),
    ).toMatchObject({ schemaVersion: 1, registryEnvironment: 'MAINNET' });

    const resolver = await pool.query<{ resolved_address_key_version: number }>(
      `SELECT resolved_address_key_version FROM resolve_active_wallet_address_ciphertext(
        $1::uuid, $2::uuid, $3::text
      )`,
      [accountId, walletId, NETWORK_ID],
    );
    expect(resolver.rows).toEqual([{ resolved_address_key_version: 2 }]);
    const roster = await pool.query<{ active_address_key_version: number }>(
      'SELECT active_address_key_version FROM list_active_wallet_registrations_rotatable($1)',
      [accountId],
    );
    expect(roster.rows).toEqual([{ active_address_key_version: 2 }]);

    const readiness = await repository.retirementReadiness(1);
    expect(readiness).toMatchObject({
      registeredAddressCount: 0,
      registeredMetadataCount: 0,
      retainedChallengeCount: 1,
      unexpiredChallengeCount: 1,
      ready: false,
    });
    const audit = await pool.query<{ event_type: string }>(
      'SELECT event_type FROM wallet_metadata_rewrap_audit_events ORDER BY occurred_at',
    );
    expect(audit.rows).toEqual([{ event_type: 'PREPARED' }, { event_type: 'COMPLETED' }]);
  });

  it('makes histories immutable and refuses rollback after the first preparation', async () => {
    await expect(
      pool.query('DELETE FROM wallet_metadata_rewrap_audit_events'),
    ).rejects.toMatchObject({
      code: '55000',
    });
    await expect(pool.query('TRUNCATE wallet_metadata_seal_iv_registry')).rejects.toMatchObject({
      code: '55000',
    });
    await expect(
      pool.query(createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024.downSql as string),
    ).rejects.toMatchObject({ code: '55000' });
  });
});
