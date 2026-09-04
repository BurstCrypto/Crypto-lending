import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { PostgresBalanceSyncWalletAddressResolver } from '../../src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-wallet-address.resolver';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023 } from '../../src/infrastructure/database/migrations/0023-create-balance-consumer-wallet-address-boundary.migration';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { parseWalletAddress } from '../../src/wallets/domain/wallet-identity';
import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  digestWalletIdentity,
  sealWalletRegistrationValue,
} from '../../src/wallets/infrastructure/crypto/wallet-registration-crypto';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MAINNET_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const SOLANA_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Balance consumer integration requires loopback PostgreSQL');
  }
}

async function asRole<Row extends QueryResultRow>(
  pool: Pool,
  role: string,
  sql: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    const result = await client.query<Row>(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describeWithPostgres('balance consumer wallet address boundary', () => {
  jest.setTimeout(30_000);

  const schema = `balance_address_${randomBytes(8).toString('hex')}`;
  const metadataV1 = createWalletRegistrationKey(
    'metadata-seal',
    1,
    Buffer.alloc(32, 31).toString('base64url'),
    'consumer-metadata-v1',
  );
  const metadataV2 = createWalletRegistrationKey(
    'metadata-seal',
    2,
    Buffer.alloc(32, 32).toString('base64url'),
    'consumer-metadata-v2',
  );
  const identityKey = createWalletRegistrationKey(
    'identity-hmac',
    1,
    Buffer.alloc(32, 33).toString('base64url'),
    'fixture-identity-v1',
  );
  let adminPool: Pool;
  let pool: Pool;
  let postgres: PostgresService;
  let accountId: string;
  let ethereumWalletId: string;
  let solanaWalletId: string;

  async function register(
    networkId: typeof ETHEREUM | typeof SOLANA,
    addressValue: string,
  ): Promise<string> {
    const address = parseWalletAddress(networkId, addressValue);
    const challengeId = randomUUID();
    const walletId = randomUUID();
    const digest = digestWalletIdentity(identityKey, networkId, address);
    const issuedAt = new Date();
    const ethereum = networkId === ETHEREUM;
    await pool.query(
      `SELECT * FROM begin_wallet_ownership_challenge_rotatable(
        $1::uuid, $2::uuid, $3::text,
        $4::text, $5::text, 'MAINNET'::text, 1::integer, $6::text,
        1::smallint, $7::bytea, $8::bytea, $9::bytea,
        $10::smallint, $11::bytea, 1::smallint, $12::bytea,
        1::smallint, $13::bytea, 1::smallint, $14::bytea,
        $15::timestamptz, $16::timestamptz, $17::uuid,
        ARRAY[1]::smallint[], ARRAY[$18]::text[]
      )`,
      [
        challengeId,
        accountId,
        ethereum ? 'EVM_ERC4361_ERC191' : 'SOLANA_SIWS_SIGN_MESSAGE',
        ethereum ? 'eip155' : 'solana',
        networkId.slice(networkId.indexOf(':') + 1),
        MAINNET_FINGERPRINT,
        randomBytes(48),
        randomBytes(12),
        randomBytes(16),
        digest.version,
        Buffer.from(digest.value, 'hex'),
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
        issuedAt,
        new Date(issuedAt.getTime() + 120_000),
        randomUUID(),
        digest.value,
      ],
    );
    const sealed = sealWalletRegistrationValue(
      metadataV1,
      {
        field: 'address',
        walletId,
        challengeId,
        accountId,
        networkId,
        addressDigest: digest,
      },
      address,
    );
    const completion = await pool.query<{ registration_outcome: string; wallet_id: string }>(
      `SELECT registration_outcome, wallet_id
       FROM complete_wallet_registration_rotatable(
         $1::uuid, $2::uuid, $3::uuid,
         $4::smallint, $5::bytea, $6::bytea, $7::bytea,
         1::smallint, $8::bytea, $9::bytea, $10::bytea,
         $11::uuid
       )`,
      [
        challengeId,
        accountId,
        walletId,
        sealed.keyVersion,
        Buffer.from(sealed.ciphertext, 'base64url'),
        Buffer.from(sealed.iv, 'base64url'),
        Buffer.from(sealed.authTag, 'base64url'),
        randomBytes(64),
        randomBytes(12),
        randomBytes(16),
        randomUUID(),
      ],
    );
    expect(completion.rows).toEqual([{ registration_outcome: 'REGISTERED', wallet_id: walletId }]);
    return walletId;
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    const fixtureIdentity = await adminPool.query<{
      database: string;
      bootstrap_role: string;
      marker: string | null;
    }>(
      `SELECT pg_catalog.current_database() AS database,
              session_user AS bootstrap_role,
              pg_catalog.current_setting(
                'crypto_lending.local_principal_fixture', true
              ) AS marker`,
    );
    assertLocalPrincipalFixture({
      database: fixtureIdentity.rows[0]?.database ?? '',
      bootstrapRole: fixtureIdentity.rows[0]?.bootstrap_role ?? '',
      marker: fixtureIdentity.rows[0]?.marker ?? null,
    });
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole)}`,
    );
    pool = new Pool({
      connectionString: testDatabaseUrl as string,
      options: `-c search_path=${schema}`,
    });
    postgres = new PostgresService(pool);
    await new MigrationRunner(pool, DATABASE_TEST_SCHEMA_MIGRATION_LIST).up();
    accountId = randomUUID();
    await pool.query(`INSERT INTO accounts (account_id) VALUES ($1::uuid)`, [accountId]);
    ethereumWalletId = await register(ETHEREUM, EVM_ADDRESS);
    solanaWalletId = await register(SOLANA, SOLANA_ADDRESS);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('verifies the exact function and runtime ACL without protected table reads', async () => {
    const verifier = createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023.verifySql;
    if (!verifier) throw new Error('migration 0023 verifier required');
    await expect(pool.query<{ valid: boolean }>(verifier)).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
    await expect(
      asRole(
        pool,
        PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole,
        `SELECT * FROM resolve_active_wallet_address_ciphertext($1::uuid, $2::uuid, $3::text)`,
        [accountId, ethereumWalletId, ETHEREUM],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asRole(
        pool,
        PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
        `SELECT address_ciphertext FROM registered_wallets WHERE wallet_id = $1::uuid`,
        [ethereumWalletId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    [ETHEREUM, () => ethereumWalletId, EVM_ADDRESS],
    [SOLANA, () => solanaWalletId, SOLANA_ADDRESS],
  ] as const)(
    'resolves only the exact active %s scope through the worker role',
    async (networkId, walletId, expectedAddress) => {
      const resolver = new PostgresBalanceSyncWalletAddressResolver(postgres, {
        mode: 'enabled',
        walletMetadataSealKeys: createWalletRegistrationKeyRing('metadata-seal', 2, [
          metadataV1,
          metadataV2,
        ]),
      });
      await expect(
        postgres.withTransaction(async (client: PoolClient) => {
          await client.query(
            `SET LOCAL ROLE ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole)}`,
          );
          return resolver.resolveActiveAddress({
            accountId,
            walletId: walletId(),
            networkId,
          });
        }),
      ).resolves.toBe(expectedAddress);
    },
  );

  it('returns no ciphertext for mismatched or non-launch scope and fails after revocation', async () => {
    const exactSql = `SELECT * FROM resolve_active_wallet_address_ciphertext($1::uuid, $2::uuid, $3::text)`;
    const wrongAccount = await asRole(
      pool,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      exactSql,
      [randomUUID(), ethereumWalletId, ETHEREUM],
    );
    const wrongNetwork = await asRole(
      pool,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      exactSql,
      [accountId, ethereumWalletId, SOLANA],
    );
    const unsupportedNetwork = await asRole(
      pool,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      exactSql,
      [accountId, ethereumWalletId, 'eip155:8453'],
    );
    expect(wrongAccount.rows).toEqual([]);
    expect(wrongNetwork.rows).toEqual([]);
    expect(unsupportedNetwork.rows).toEqual([]);

    await pool.query(`SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)`, [
      accountId,
      ethereumWalletId,
      randomUUID(),
    ]);
    const revoked = await asRole(pool, PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole, exactSql, [
      accountId,
      ethereumWalletId,
      ETHEREUM,
    ]);
    expect(revoked.rows).toEqual([]);
  });

  it('detects search-path and ACL tampering', async () => {
    const verifier = createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023.verifySql;
    if (!verifier) throw new Error('migration 0023 verifier required');
    await pool.query(
      `ALTER FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)
       SET search_path TO pg_catalog, pg_temp`,
    );
    await expect(pool.query<{ valid: boolean }>(verifier)).resolves.toMatchObject({
      rows: [{ valid: false }],
    });
    await pool.query(
      `ALTER FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)
       SET search_path TO pg_catalog, ${quoteIdentifier(schema)}, pg_temp`,
    );
    await pool.query(
      `GRANT EXECUTE ON FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)
       TO ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)}`,
    );
    await expect(pool.query<{ valid: boolean }>(verifier)).resolves.toMatchObject({
      rows: [{ valid: false }],
    });
    await pool.query(
      `REVOKE EXECUTE ON FUNCTION resolve_active_wallet_address_ciphertext(uuid,uuid,text)
       FROM ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)}`,
    );
    await expect(pool.query<{ valid: boolean }>(verifier)).resolves.toMatchObject({
      rows: [{ valid: true }],
    });

    const upSql = createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023.upSql;
    if (typeof upSql !== 'string') throw new Error('migration 0023 SQL string required');
    const restoreSql = upSql.replace(
      'CREATE FUNCTION resolve_active_wallet_address_ciphertext(',
      'CREATE OR REPLACE FUNCTION resolve_active_wallet_address_ciphertext(',
    );
    const tamperedSql = restoreSql.replace(
      "wallet.status = 'ACTIVE'",
      "wallet.status IN ('ACTIVE')",
    );
    expect(tamperedSql).not.toBe(restoreSql);
    await pool.query(tamperedSql);
    await expect(pool.query<{ valid: boolean }>(verifier)).resolves.toMatchObject({
      rows: [{ valid: false }],
    });
    await pool.query(restoreSql);
    await expect(pool.query<{ valid: boolean }>(verifier)).resolves.toMatchObject({
      rows: [{ valid: true }],
    });
  });

  it('rolls back the stateless boundary after revocation without deleting wallet data', async () => {
    await pool.query(`SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)`, [
      accountId,
      solanaWalletId,
      randomUUID(),
    ]);
    await expect(
      pool.query(
        createBalanceConsumerWalletAddressBoundaryTestSchemaMigrationV0023.downSql as string,
      ),
    ).resolves.toBeDefined();
    const wallets = await pool.query<{ wallet_count: string }>(
      `SELECT count(*)::text AS wallet_count FROM registered_wallets`,
    );
    expect(wallets.rows).toEqual([{ wallet_count: '2' }]);
    expect(
      await pool.query(`SELECT to_regprocedure($1::text) AS resolver`, [
        `"${schema}".resolve_active_wallet_address_ciphertext(uuid,uuid,text)`,
      ]),
    ).toMatchObject({ rows: [{ resolver: null }] });
  });
});
