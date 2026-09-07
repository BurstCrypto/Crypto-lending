import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../src/blockchain/domain/supported-asset-registry';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import {
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
  type DatabaseMigration,
} from '../../src/infrastructure/database/migrations';
import {
  createWalletRegistrationKey,
  digestWalletIdentity,
  type WalletRegistrationDigestReference,
} from '../../src/wallets/infrastructure/crypto/wallet-registration-crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ETHEREUM_ADDRESS = '0x1111111111111111111111111111111111111111';
const SOLANA_ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const FUNCTION_IDENTITY =
  'prepare_mainnet_financial_action_lifecycle_v2(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,integer,text,text,text,smallint,text,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,uuid,smallint[],text[])';
const PREPARE_V2_SQL = `SELECT *
  FROM prepare_mainnet_financial_action_lifecycle_v2(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
    $8::text, $9::text, $10::uuid, $11::text, $12::text, $13::text, $14::text,
    $15::integer, $16::text, $17::text, $18::text, $19::smallint, $20::text,
    $21::text, $22::text, $23::text, $24::integer, $25::text, $26::text,
    $27::text, $28::timestamptz, $29::timestamptz, $30::uuid,
    $31::smallint[], $32::text[]
  )`;
const MIGRATIONS_THROUGH_0034 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id <= '0034',
);

type Queryable = Pick<PoolClient, 'query'>;
type NetworkId = typeof ETHEREUM | typeof SOLANA;

interface NetworkFixture {
  readonly networkId: NetworkId;
  readonly namespace: 'eip155' | 'solana';
  readonly reference: string;
  readonly proofScheme: 'EVM_ERC4361_ERC191' | 'SOLANA_SIWS_SIGN_MESSAGE';
  readonly address: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly assetSymbol: 'USDT' | 'PYUSD';
  readonly assetIdentity: string;
}

interface YieldFixture {
  readonly accountId: string;
  readonly correlationId: string;
  readonly ledgerBookId: string;
  readonly ledgerTransactionId: string;
  readonly operationId: string;
  readonly planReferenceId: string;
  readonly quoteReferenceId: string;
  readonly submissionId: string;
  readonly walletId: string;
}

interface YieldCommandRow extends QueryResultRow {
  submission_id: string | null;
  transition_recorded_at: Date;
}

interface PreparedRow extends QueryResultRow {
  record_outcome: 'RECORDED' | 'REPLAYED';
  lifecycle_stage: string;
  lifecycle_revision: string;
  current_snapshot_sha256: string;
  wallet_identity_digest_version: number;
  wallet_identity_digest_hex: string;
  ledger_settlement_authority: boolean;
  effective_at: Date;
}

interface HistoryCounts extends QueryResultRow {
  intent_count: number;
  event_count: number;
  evidence_count: number;
}

const ETHEREUM_FIXTURE: NetworkFixture = Object.freeze({
  networkId: ETHEREUM,
  namespace: 'eip155',
  reference: '1',
  proofScheme: 'EVM_ERC4361_ERC191',
  address: ETHEREUM_ADDRESS,
  providerId: 'aave',
  protocolId: 'aave-v3',
  marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
  assetSymbol: 'USDT',
  assetIdentity: '0xdac17f958d2ee523a2206206994597c13d831ec7',
});

const SOLANA_FIXTURE: NetworkFixture = Object.freeze({
  networkId: SOLANA,
  namespace: 'solana',
  reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  proofScheme: 'SOLANA_SIWS_SIGN_MESSAGE',
  address: SOLANA_ADDRESS,
  providerId: 'kamino',
  protocolId: 'kamino-lend',
  marketId: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  assetSymbol: 'PYUSD',
  assetIdentity: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
});

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Wallet identity binding integration requires loopback PostgreSQL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (
    serverVersionNum === undefined ||
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < 160_000 ||
    serverVersionNum >= 170_000
  ) {
    throw new Error('Wallet identity binding integration requires PostgreSQL 16');
  }
}

function digest(): string {
  return randomBytes(32).toString('hex');
}

function identityDigest(
  network: NetworkFixture,
  version: number,
  address = network.address,
): WalletRegistrationDigestReference<'address'> {
  const key = createWalletRegistrationKey(
    'identity-hmac',
    version,
    randomBytes(32).toString('base64url'),
    `binding-integration-${network.namespace}-v${version}-${randomBytes(4).toString('hex')}`,
  );
  return digestWalletIdentity(key, network.networkId, address);
}

async function requiredRow<Row extends QueryResultRow>(
  queryable: Queryable,
  sql: string,
  values: unknown[],
): Promise<Row> {
  const result = await queryable.query<Row>(sql, values);
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new Error('Expected exactly one PostgreSQL row');
  }
  return result.rows[0];
}

async function databaseNow(queryable: Queryable): Promise<Date> {
  const row = await requiredRow<{ database_now: Date }>(
    queryable,
    `SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
       AS database_now`,
    [],
  );
  return row.database_now;
}

async function historyCounts(queryable: Queryable): Promise<HistoryCounts> {
  return requiredRow<HistoryCounts>(
    queryable,
    `SELECT
       (SELECT pg_catalog.count(*)::integer FROM mainnet_financial_action_intents)
         AS intent_count,
       (SELECT pg_catalog.count(*)::integer FROM mainnet_financial_action_events)
         AS event_count,
       (SELECT pg_catalog.count(*)::integer FROM mainnet_financial_action_evidence_claims)
         AS evidence_count`,
    [],
  );
}

async function withForcedDeferredConstraints<Row>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<Row>,
): Promise<Row> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function registerWallet(
  queryable: Queryable,
  accountId: string,
  network: NetworkFixture,
  parentDigest: WalletRegistrationDigestReference<'address'>,
): Promise<string> {
  const challengeId = randomUUID();
  const walletId = randomUUID();
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const parentDigestBytes = Buffer.from(parentDigest.value, 'hex');
  await queryable.query(
    `INSERT INTO wallet_ownership_challenges (
       challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest, domain_digest_version, domain_digest,
       message_digest_version, message_digest, nonce_digest_version, nonce_digest,
       status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'MAINNET', $6, $7, $8, $9,
       1, $10, 1, $11, 1, $12, 'REGISTERED',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() + interval '5 minutes',
       statement_timestamp() - interval '1 minute',
       statement_timestamp() - interval '1 minute'
     )`,
    [
      challengeId,
      accountId,
      network.proofScheme,
      network.namespace,
      network.reference,
      registry.version,
      registry.fingerprintSha256,
      parentDigest.version,
      parentDigestBytes,
      randomBytes(32),
      randomBytes(32),
      randomBytes(32),
    ],
  );
  await queryable.query(
    `INSERT INTO wallet_ownership_challenge_identity_digests (
       challenge_id, account_id, chain_namespace, chain_reference,
       address_digest_version, address_digest
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      challengeId,
      accountId,
      network.namespace,
      network.reference,
      parentDigest.version,
      parentDigestBytes,
    ],
  );
  await queryable.query(
    `INSERT INTO registered_wallets (
       wallet_id, account_id, registered_by_challenge_id,
       chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest,
       address_key_version, address_ciphertext, address_iv, address_auth_tag,
       metadata_key_version, metadata_ciphertext, metadata_iv, metadata_auth_tag
     ) VALUES (
       $1, $2, $3, $4, $5, 'MAINNET', $6, $7, $8, $9,
       1, $10, $11, $12, 1, $13, $14, $15
     )`,
    [
      walletId,
      accountId,
      challengeId,
      network.namespace,
      network.reference,
      registry.version,
      registry.fingerprintSha256,
      parentDigest.version,
      parentDigestBytes,
      Buffer.from('mainnet-action-binding-address'),
      randomBytes(12),
      randomBytes(16),
      Buffer.from('mainnet-action-binding-metadata'),
      randomBytes(12),
      randomBytes(16),
    ],
  );
  return walletId;
}

async function createYieldOperation(
  queryable: Queryable,
  fixture: Omit<YieldFixture, 'submissionId'>,
  effectiveAt: Date,
): Promise<YieldCommandRow> {
  return requiredRow<YieldCommandRow>(
    queryable,
    `SELECT created.* FROM create_yield_operation(
       $1::uuid, $2::uuid, 'ALLOCATE', $3::uuid, $4::uuid, $5::uuid,
       $6::timestamptz, $7::uuid, 1::smallint, $8::text, 1::smallint, $9::text
     ) AS created`,
    [
      fixture.accountId,
      fixture.operationId,
      fixture.ledgerTransactionId,
      fixture.planReferenceId,
      fixture.quoteReferenceId,
      effectiveAt,
      fixture.correlationId,
      digest(),
      digest(),
    ],
  );
}

async function transitionYieldOperation(
  queryable: Queryable,
  fixture: Pick<YieldFixture, 'accountId' | 'operationId' | 'correlationId'>,
  expectedState: string,
  nextState: string,
  reason: string,
  effectiveAt: Date,
): Promise<YieldCommandRow> {
  return requiredRow<YieldCommandRow>(
    queryable,
    `SELECT transitioned.* FROM transition_yield_operation(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
       $6::timestamptz, NULL::uuid, $7::uuid, 1::smallint,
       $8::text, 1::smallint, $9::text
     ) AS transitioned`,
    [
      fixture.accountId,
      fixture.operationId,
      expectedState,
      nextState,
      reason,
      effectiveAt,
      fixture.correlationId,
      digest(),
      digest(),
    ],
  );
}

async function provisionSubmittedYieldFixture(
  pool: Pool,
  network: NetworkFixture,
  parentDigest: WalletRegistrationDigestReference<'address'>,
): Promise<YieldFixture> {
  const accountId = randomUUID();
  const ledgerTransactionId = randomUUID();
  const ledgerBook = await requiredRow<{ book_id: string }>(
    pool,
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
    [],
  );
  await pool.query("INSERT INTO accounts (account_id, eligibility_status) VALUES ($1, 'UNKNOWN')", [
    accountId,
  ]);
  await pool.query(
    `INSERT INTO ledger_transactions (
       transaction_id, tenant_account_id, book_id, intent_type,
       configuration_revision_reference_id
     ) VALUES ($1, $2, $3, 'DIRECT_SETTLEMENT', $4)`,
    [ledgerTransactionId, accountId, ledgerBook.book_id, randomUUID()],
  );
  const walletId = await registerWallet(pool, accountId, network, parentDigest);
  const base = {
    accountId,
    correlationId: randomUUID(),
    ledgerBookId: ledgerBook.book_id,
    ledgerTransactionId,
    operationId: randomUUID(),
    planReferenceId: randomUUID(),
    quoteReferenceId: randomUUID(),
    walletId,
  };
  const now = await databaseNow(pool);
  const at = (offset: number): Date => new Date(now.getTime() - 60_000 + offset);
  await createYieldOperation(pool, base, at(0));
  await transitionYieldOperation(pool, base, 'CREATED', 'QUOTED', 'QUOTE_CREATED', at(1_000));
  await transitionYieldOperation(
    pool,
    base,
    'QUOTED',
    'USER_APPROVED',
    'USER_APPROVAL_RECORDED',
    at(2_000),
  );
  const submitted = await withForcedDeferredConstraints(pool, async (client) => {
    const row = await transitionYieldOperation(
      client,
      base,
      'USER_APPROVED',
      'SUBMITTED',
      'SUBMISSION_RECORDED',
      at(3_000),
    );
    if (!row.submission_id) throw new Error('Yield submission was not created');
    const envelope = Object.freeze({
      id: row.submission_id,
      kind: 'yield.operation.submit',
      version: 1,
      occurredAt: row.transition_recorded_at.toISOString(),
      correlation: Object.freeze({
        correlationId: base.correlationId,
        initiatorActorId: base.accountId,
        quoteId: base.quoteReferenceId,
        transactionId: base.ledgerTransactionId,
      }),
      payload: Object.freeze({
        submissionId: row.submission_id,
        operationId: base.operationId,
        operationType: 'ALLOCATE',
        ledgerTransactionId: base.ledgerTransactionId,
        planReferenceId: base.planReferenceId,
        quoteReferenceId: base.quoteReferenceId,
      }),
    });
    await client.query(
      `SELECT enqueue_reviewed_job_v1(
         $1::text, 'jobs'::text, $2::jsonb, $3::jsonb, NULL::text, NULL::text
       )`,
      [row.submission_id, envelope, { operationType: 'ALLOCATE' }],
    );
    return row;
  });
  if (!submitted.submission_id) throw new Error('Yield submission was not created');
  return { ...base, submissionId: submitted.submission_id };
}

async function prepareValues(
  queryable: Queryable,
  fixture: YieldFixture,
  network: NetworkFixture,
  candidates: readonly WalletRegistrationDigestReference<'address'>[],
): Promise<unknown[]> {
  const now = await databaseNow(queryable);
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  return [
    randomUUID(),
    fixture.accountId,
    fixture.operationId,
    fixture.submissionId,
    fixture.ledgerTransactionId,
    fixture.ledgerBookId,
    fixture.walletId,
    digest(),
    digest(),
    randomUUID(),
    network.networkId,
    network.providerId,
    network.protocolId,
    network.marketId,
    registry.version,
    registry.fingerprintSha256,
    network.assetSymbol,
    network.assetIdentity,
    6,
    'SUPPLY',
    '1000000',
    '1000000',
    '1000000000000000',
    100,
    '10000000000000000',
    'EXACT',
    '1000000',
    new Date(now.getTime() - 1_000),
    new Date(now.getTime() + 240_000),
    randomUUID(),
    candidates.map(({ version }) => version),
    candidates.map(({ value }) => value),
  ];
}

async function addActiveAlias(
  queryable: Queryable,
  fixture: YieldFixture,
  network: NetworkFixture,
  candidate: WalletRegistrationDigestReference<'address'>,
): Promise<void> {
  await queryable.query(
    `INSERT INTO registered_wallet_identity_digests (
       wallet_id, account_id, chain_namespace, chain_reference,
       address_digest_version, address_digest, status, registered_at, revoked_at
     ) VALUES ($1, $2, $3, $4, $5, pg_catalog.decode($6, 'hex'),
       'ACTIVE', statement_timestamp(), NULL)`,
    [
      fixture.walletId,
      fixture.accountId,
      network.namespace,
      network.reference,
      candidate.version,
      candidate.value,
    ],
  );
}

async function setIdentityPolicy(
  queryable: Queryable,
  activeVersion: number,
  acceptedVersions: readonly number[],
): Promise<void> {
  await queryable.query(
    'ALTER TABLE wallet_identity_key_policy DISABLE TRIGGER wallet_identity_key_policy_immutable_row',
  );
  try {
    await queryable.query(
      `UPDATE wallet_identity_key_policy
       SET active_write_version = $1::smallint,
           accepted_read_versions = $2::smallint[],
           updated_at = pg_catalog.clock_timestamp()
       WHERE policy_name = 'wallet-registration-identity-hmac'`,
      [activeVersion, acceptedVersions],
    );
  } finally {
    await queryable.query(
      'ALTER TABLE wallet_identity_key_policy ENABLE ALWAYS TRIGGER wallet_identity_key_policy_immutable_row',
    );
  }
}

async function removeRotationAliasForTest(
  queryable: Queryable,
  fixture: YieldFixture,
  version: number,
): Promise<void> {
  await queryable.query(
    'ALTER TABLE registered_wallet_identity_digests DISABLE TRIGGER registered_wallet_identity_digests_lifecycle_row',
  );
  try {
    await queryable.query(
      `DELETE FROM registered_wallet_identity_digests
       WHERE wallet_id = $1::uuid AND address_digest_version = $2::smallint`,
      [fixture.walletId, version],
    );
  } finally {
    await queryable.query(
      'ALTER TABLE registered_wallet_identity_digests ENABLE ALWAYS TRIGGER registered_wallet_identity_digests_lifecycle_row',
    );
  }
}

async function waitUntilBlockedOnLock(adminPool: Pool, processId: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await adminPool.query<{ wait_event_type: string | null }>(
      `SELECT wait_event_type FROM pg_catalog.pg_stat_activity WHERE pid = $1`,
      [processId],
    );
    if (state.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected the V2 replay to wait on the existing intent lock');
}

describeWithPostgres('mainnet financial action wallet identity binding migration', () => {
  jest.setTimeout(180_000);

  const schema = `mainnet_action_wallet_binding_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = MIGRATIONS_THROUGH_0034.map(({ id }) => id);
  let adminPool: Pool | undefined;
  let operationPool: Pool | undefined;
  let runner: MigrationRunner | undefined;
  let schemaCreated = false;

  function requireOperationPool(): Pool {
    if (!operationPool) throw new Error('Wallet identity binding pool is unavailable');
    return operationPool;
  }

  function requireAdminPool(): Pool {
    if (!adminPool) throw new Error('Wallet identity binding admin pool is unavailable');
    return adminPool;
  }

  function requireRunner(): MigrationRunner {
    if (!runner) throw new Error('Wallet identity binding runner is unavailable');
    return runner;
  }

  function migration0034(): DatabaseMigration {
    const migration = MIGRATIONS_THROUGH_0034.find(({ id }) => id === '0034');
    if (!migration?.verifySql) throw new Error('Migration 0034 verifier is unavailable');
    return migration;
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const server = await adminPool.query<{ server_version_num: number }>(
      `SELECT pg_catalog.current_setting('server_version_num')::integer
         AS server_version_num`,
    );
    requirePostgres16(server.rows[0]?.server_version_num);
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    schemaCreated = true;
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0034);
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      try {
        if (schemaCreated) {
          await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
        }
      } finally {
        await adminPool.end();
      }
    }
  });

  it('applies and verifies the exact owner-only V2 function without runtime grants', async () => {
    await expect(requireRunner().up()).resolves.toEqual(expectedMigrationIds);
    await expect(requireRunner().assertUpToDate()).resolves.toBeUndefined();
    await expect(
      requireOperationPool().query<{ valid: boolean }>(migration0034().verifySql ?? ''),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });

    const privileges = await requireOperationPool().query<{
      role_name: string;
      v1_execute: boolean;
      v2_execute: boolean;
    }>(
      `SELECT role_name,
              pg_catalog.has_function_privilege(
                role_name, 'prepare_mainnet_financial_action_lifecycle(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,integer,text,text,text,smallint,text,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,uuid)', 'EXECUTE'
              ) AS v1_execute,
              pg_catalog.has_function_privilege(role_name, $1, 'EXECUTE') AS v2_execute
       FROM pg_catalog.unnest($2::text[]) AS roles(role_name)`,
      [
        FUNCTION_IDENTITY,
        [
          'public',
          'crypto_api_runtime',
          'crypto_worker_runtime',
          'crypto_runtime',
          'crypto_balance_consumer_runtime',
          'crypto_migration',
        ],
      ],
    );
    expect(privileges.rows).toHaveLength(6);
    expect(privileges.rows.every(({ v1_execute, v2_execute }) => !v1_execute && !v2_execute)).toBe(
      true,
    );
  });

  it('rejects cross-wallet and hostile candidate arrays atomically before V1 history', async () => {
    const pool = requireOperationPool();
    const digestA = identityDigest(ETHEREUM_FIXTURE, 1);
    const digestB = identityDigest(
      ETHEREUM_FIXTURE,
      1,
      '0x2222222222222222222222222222222222222222',
    );
    const fixture = await provisionSubmittedYieldFixture(pool, ETHEREUM_FIXTURE, digestA);
    await registerWallet(pool, fixture.accountId, ETHEREUM_FIXTURE, digestB);
    const values = await prepareValues(pool, fixture, ETHEREUM_FIXTURE, [digestA]);
    const before = await historyCounts(pool);

    const hostileCandidates: readonly [unknown, unknown][] = [
      [[digestB.version], [digestB.value]],
      [null, [digestA.value]],
      [[digestA.version], null],
      [[], []],
      [[digestA.version], []],
      [
        [2, 1],
        [digest(), digest()],
      ],
      [
        [1, 1],
        [digest(), digest()],
      ],
      [[0], [digestA.value]],
      [
        [1, 2, 3, 4],
        [digest(), digest(), digest(), digest()],
      ],
      [[1], [digestA.value.toUpperCase()]],
      [[1], [digestA.value.slice(1)]],
      [
        [1, 2],
        [digestA.value, digestA.value],
      ],
      ['[0:0]={1}', `[0:0]={${digestA.value}}`],
      ['{{1}}', `{{${digestA.value}}}`],
    ];
    for (const [versions, digests] of hostileCandidates) {
      await expect(
        pool.query(PREPARE_V2_SQL, [...values.slice(0, 30), versions, digests]),
      ).rejects.toMatchObject({ code: '22023' });
    }
    expect(await historyCounts(pool)).toEqual(before);
  });

  it('binds real ephemeral Ethereum and Solana HMAC candidates in one call each', async () => {
    const pool = requireOperationPool();
    for (const network of [ETHEREUM_FIXTURE, SOLANA_FIXTURE]) {
      const addressDigest = identityDigest(network, 1);
      const fixture = await provisionSubmittedYieldFixture(pool, network, addressDigest);
      const values = await prepareValues(pool, fixture, network, [addressDigest]);
      const result = await pool.query<PreparedRow>(PREPARE_V2_SQL, values);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        record_outcome: 'RECORDED',
        lifecycle_stage: 'PREPARED',
        lifecycle_revision: '1',
        wallet_identity_digest_version: 1,
        wallet_identity_digest_hex: addressDigest.value,
        ledger_settlement_authority: false,
      });
    }
  });

  it('supports current aliases after parent-key retirement and preserves intent-first concurrency', async () => {
    const pool = requireOperationPool();
    const parentDigest = identityDigest(ETHEREUM_FIXTURE, 1);
    const currentDigest = identityDigest(ETHEREUM_FIXTURE, 2);
    const fixture = await provisionSubmittedYieldFixture(pool, ETHEREUM_FIXTURE, parentDigest);
    await addActiveAlias(pool, fixture, ETHEREUM_FIXTURE, currentDigest);
    await setIdentityPolicy(pool, 2, [2]);
    const values = await prepareValues(pool, fixture, ETHEREUM_FIXTURE, [currentDigest]);
    const before = await historyCounts(pool);

    await expect(
      pool.query(PREPARE_V2_SQL, [...values.slice(0, 30), [1], [parentDigest.value]]),
    ).rejects.toMatchObject({ code: '22023' });
    expect(await historyCounts(pool)).toEqual(before);

    const prepared = await requiredRow<PreparedRow>(pool, PREPARE_V2_SQL, values);
    expect(prepared).toMatchObject({
      record_outcome: 'RECORDED',
      lifecycle_stage: 'PREPARED',
      lifecycle_revision: '1',
      wallet_identity_digest_version: 1,
      wallet_identity_digest_hex: parentDigest.value,
    });

    const locker = await pool.connect();
    const replayer = await pool.connect();
    try {
      await locker.query('BEGIN');
      await replayer.query('BEGIN');
      await locker.query("SET LOCAL lock_timeout = '5s'");
      await replayer.query("SET LOCAL lock_timeout = '5s'");
      await locker.query(
        `SELECT 1 FROM mainnet_financial_action_intents
         WHERE intent_id = $1::uuid FOR UPDATE`,
        [values[0]],
      );
      const replayerPid = await requiredRow<{ pid: number }>(
        replayer,
        'SELECT pg_catalog.pg_backend_pid() AS pid',
        [],
      );
      const replayPromise = replayer.query<PreparedRow>(PREPARE_V2_SQL, values);
      await waitUntilBlockedOnLock(requireAdminPool(), replayerPid.pid);
      const signedAt = await databaseNow(locker);
      const bound = await locker.query<PreparedRow>(
        `SELECT * FROM bind_mainnet_financial_action_submission(
           $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text,
           $6::text, $7::text, $8::timestamptz, $9::uuid
         )`,
        [
          fixture.accountId,
          values[0],
          prepared.lifecycle_revision,
          prepared.current_snapshot_sha256,
          `0x${'b'.repeat(64)}`,
          digest(),
          digest(),
          signedAt,
          randomUUID(),
        ],
      );
      expect(bound.rows[0]).toMatchObject({ lifecycle_stage: 'WALLET_SIGNED_SUBMISSION_BOUND' });
      await locker.query('COMMIT');
      const replayed = await replayPromise;
      expect(replayed.rows[0]).toMatchObject({
        record_outcome: 'REPLAYED',
        lifecycle_stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      });
      await replayer.query('COMMIT');
    } catch (error) {
      await locker.query('ROLLBACK').catch(() => undefined);
      await replayer.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      locker.release();
      replayer.release();
    }

    const revocation = await pool.connect();
    try {
      await revocation.query('BEGIN');
      await revocation.query(
        'SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)',
        [fixture.accountId, fixture.walletId, randomUUID()],
      );
      const afterReconciliationSafeBind = await historyCounts(revocation);
      await expect(revocation.query(PREPARE_V2_SQL, values)).rejects.toMatchObject({
        code: '22023',
      });
      await revocation.query('ROLLBACK');
      expect(await historyCounts(pool)).toEqual(afterReconciliationSafeBind);
    } finally {
      await revocation.query('ROLLBACK').catch(() => undefined);
      revocation.release();
    }
    await setIdentityPolicy(pool, 1, [1]);
    await removeRotationAliasForTest(pool, fixture, currentDigest.version);
  });

  it('refuses to remove 0034 after lifecycle use and keeps its verifier true', async () => {
    await expect(requireRunner().down(1)).rejects.toMatchObject({ code: '55000' });
    await expect(
      requireOperationPool().query<{ valid: boolean }>(migration0034().verifySql ?? ''),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
  });
});
