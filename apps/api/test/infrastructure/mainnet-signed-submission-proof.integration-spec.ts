import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../src/blockchain/domain/supported-asset-registry';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039 } from '../../src/infrastructure/database/migrations/0039-persist-verified-mainnet-signed-submission-proof.migration';
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
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MIGRATIONS_THROUGH_0038 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id <= '0038',
);
const MIGRATIONS_THROUGH_0039 = [
  ...MIGRATIONS_THROUGH_0038,
  createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039,
];
const PREPARE_LIFECYCLE_SQL = `SELECT *
  FROM prepare_mainnet_financial_action_lifecycle_v2(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
    $8::text, $9::text, $10::uuid, $11::text, $12::text, $13::text, $14::text,
    $15::integer, $16::text, $17::text, $18::text, $19::smallint, $20::text,
    $21::text, $22::text, $23::text, $24::integer, $25::text, $26::text,
    $27::text, $28::timestamptz, $29::timestamptz, $30::uuid,
    $31::smallint[], $32::text[]
  )`;
const LEGACY_BIND_SQL = `SELECT * FROM bind_mainnet_financial_action_submission(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text,
  $8::timestamptz, $9::uuid
)`;
const VERIFIED_BIND_SQL = `SELECT *
  FROM bind_verified_mainnet_financial_action_submission_v2(
    $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text,
    $8::uuid, $9::smallint, $10::text, $11::text, $12::text, $13::text,
    $14::text, $15::text, $16::numeric, $17::text
  )`;

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

interface PreparedLifecycleRow extends QueryResultRow {
  lifecycle_revision: string;
  current_snapshot_sha256: string;
}

interface PreparedAction extends YieldFixture {
  readonly intentId: string;
  readonly preparedRevision: string;
  readonly preparedSnapshot: string;
  readonly transactionId: string;
  readonly network: NetworkFixture;
}

interface BoundLifecycleRow extends QueryResultRow {
  record_outcome: string;
  lifecycle_stage: string;
  lifecycle_revision: string;
  current_snapshot_sha256: string;
}

interface ProofRow extends QueryResultRow {
  intent_id: string;
  event_revision: string;
  event_id: string;
  event_transition_fingerprint_sha256: string;
  verifier_version: number;
  verification_intent_fingerprint_sha256: string;
  network_id: string;
  chain_transaction_id: string;
  signed_envelope_sha256: string;
  signing_payload_sha256: string;
  signature_evidence_sha256: string;
  provider_write_manifest_fingerprint_sha256: string;
  provider_action_binding_sha256: string;
  chain_replay_identity_sha256: string;
  signature_scheme: string;
  ethereum_nonce: string | null;
  solana_recent_blockhash: string | null;
  server_received_and_verified_at: Date;
  recorded_at: Date;
  proof_fingerprint_sha256: string;
}

const ETHEREUM_FIXTURE: NetworkFixture = Object.freeze({
  networkId: ETHEREUM,
  namespace: 'eip155',
  reference: '1',
  proofScheme: 'EVM_ERC4361_ERC191',
  address: '0x1111111111111111111111111111111111111111',
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
  address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  providerId: 'kamino',
  protocolId: 'kamino-lend',
  marketId: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  assetSymbol: 'PYUSD',
  assetIdentity: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
});

function base58(value: Uint8Array): string {
  const digits = [0];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  while (value[zeros] === 0) zeros += 1;
  return (
    '1'.repeat(zeros) +
    (digits.length === 1 && digits[0] === 0 ? [] : digits)
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('')
  );
}

function fingerprint(label: string = randomUUID()): string {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

async function requiredRow<Row extends QueryResultRow>(
  queryable: Queryable,
  statement: string,
  values: readonly unknown[] = [],
): Promise<Row> {
  const result = await queryable.query<Row>(statement, [...values]);
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new Error('Expected exactly one PostgreSQL row');
  }
  return result.rows[0];
}

async function databaseNow(queryable: Queryable): Promise<Date> {
  return (
    await requiredRow<{ database_now: Date }>(
      queryable,
      `SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
         AS database_now`,
    )
  ).database_now;
}

function walletDigest(network: NetworkFixture): WalletRegistrationDigestReference<'address'> {
  const key = createWalletRegistrationKey(
    'identity-hmac',
    1,
    randomBytes(32).toString('base64url'),
    `signed-proof-${network.namespace}-${randomBytes(4).toString('hex')}`,
  );
  return digestWalletIdentity(key, network.networkId, network.address);
}

async function registerWallet(
  queryable: Queryable,
  accountId: string,
  network: NetworkFixture,
  addressDigest: WalletRegistrationDigestReference<'address'>,
): Promise<string> {
  const challengeId = randomUUID();
  const walletId = randomUUID();
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const addressDigestBytes = Buffer.from(addressDigest.value, 'hex');
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
      addressDigest.version,
      addressDigestBytes,
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
      addressDigest.version,
      addressDigestBytes,
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
      addressDigest.version,
      addressDigestBytes,
      Buffer.from('signed-proof-address'),
      randomBytes(12),
      randomBytes(16),
      Buffer.from('signed-proof-metadata'),
      randomBytes(12),
      randomBytes(16),
    ],
  );
  return walletId;
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

async function transitionYieldOperation(
  queryable: Queryable,
  fixture: Omit<YieldFixture, 'submissionId'>,
  expectedState: string,
  nextState: string,
  reason: string,
  effectiveAt: Date,
): Promise<{ submission_id: string | null; transition_recorded_at: Date }> {
  return requiredRow(
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
      fingerprint(),
      fingerprint(),
    ],
  );
}

async function provisionSubmittedYieldFixture(
  pool: Pool,
  network: NetworkFixture,
): Promise<{
  fixture: YieldFixture;
  addressDigest: WalletRegistrationDigestReference<'address'>;
}> {
  const accountId = randomUUID();
  const ledgerTransactionId = randomUUID();
  const ledgerBook = await requiredRow<{ book_id: string }>(
    pool,
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
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
  const addressDigest = walletDigest(network);
  const walletId = await registerWallet(pool, accountId, network, addressDigest);
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
  await requiredRow(
    pool,
    `SELECT created.* FROM create_yield_operation(
       $1::uuid, $2::uuid, 'ALLOCATE', $3::uuid, $4::uuid, $5::uuid,
       $6::timestamptz, $7::uuid, 1::smallint, $8::text, 1::smallint, $9::text
     ) AS created`,
    [
      base.accountId,
      base.operationId,
      base.ledgerTransactionId,
      base.planReferenceId,
      base.quoteReferenceId,
      at(0),
      base.correlationId,
      fingerprint(),
      fingerprint(),
    ],
  );
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
    await client.query(
      `SELECT enqueue_reviewed_job_v1(
         $1::text, 'jobs'::text, $2::jsonb, $3::jsonb, NULL::text, NULL::text
       )`,
      [
        row.submission_id,
        {
          id: row.submission_id,
          kind: 'yield.operation.submit',
          version: 1,
          occurredAt: row.transition_recorded_at.toISOString(),
          correlation: {
            correlationId: base.correlationId,
            initiatorActorId: base.accountId,
            quoteId: base.quoteReferenceId,
            transactionId: base.ledgerTransactionId,
          },
          payload: {
            submissionId: row.submission_id,
            operationId: base.operationId,
            operationType: 'ALLOCATE',
            ledgerTransactionId: base.ledgerTransactionId,
            planReferenceId: base.planReferenceId,
            quoteReferenceId: base.quoteReferenceId,
          },
        },
        { operationType: 'ALLOCATE' },
      ],
    );
    return row;
  });
  if (!submitted.submission_id) throw new Error('Yield submission was not created');
  return { fixture: { ...base, submissionId: submitted.submission_id }, addressDigest };
}

async function prepareAction(
  pool: Pool,
  network: NetworkFixture,
  expiresInMilliseconds = 240_000,
): Promise<PreparedAction> {
  const { fixture, addressDigest } = await provisionSubmittedYieldFixture(pool, network);
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const intentId = randomUUID();
  const now = await databaseNow(pool);
  const transactionId =
    network.networkId === ETHEREUM ? `0x${fingerprint()}` : base58(new Uint8Array(randomBytes(64)));
  const prepared = await requiredRow<PreparedLifecycleRow>(pool, PREPARE_LIFECYCLE_SQL, [
    intentId,
    fixture.accountId,
    fixture.operationId,
    fixture.submissionId,
    fixture.ledgerTransactionId,
    fixture.ledgerBookId,
    fixture.walletId,
    fingerprint(),
    fingerprint(),
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
    new Date(now.getTime() + expiresInMilliseconds),
    randomUUID(),
    [addressDigest.version],
    [addressDigest.value],
  ]);
  return {
    ...fixture,
    intentId,
    preparedRevision: prepared.lifecycle_revision,
    preparedSnapshot: prepared.current_snapshot_sha256,
    transactionId,
    network,
  };
}

function proofValues(
  action: PreparedAction,
  overrides: Readonly<{
    chainReplayIdentity?: string;
    ethereumNonce?: string | null;
    solanaRecentBlockhash?: string | null;
  }> = {},
): unknown[] {
  const ethereum = action.network.networkId === ETHEREUM;
  return [
    action.accountId,
    action.intentId,
    action.preparedRevision,
    action.preparedSnapshot,
    action.transactionId,
    fingerprint(),
    fingerprint(),
    randomUUID(),
    1,
    fingerprint(),
    fingerprint(),
    fingerprint(),
    fingerprint(),
    overrides.chainReplayIdentity ?? fingerprint(),
    ethereum ? 'ECDSA_SECP256K1_EIP1559' : 'ED25519_SOLANA_TRANSACTION',
    overrides.ethereumNonce === undefined ? (ethereum ? '42' : null) : overrides.ethereumNonce,
    overrides.solanaRecentBlockhash === undefined
      ? ethereum
        ? null
        : base58(new Uint8Array(randomBytes(32)))
      : overrides.solanaRecentBlockhash,
  ];
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Signed-submission proof integration requires loopback PostgreSQL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (
    serverVersionNum === undefined ||
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < 160_000 ||
    serverVersionNum >= 170_000
  ) {
    throw new Error('Signed-submission proof integration requires PostgreSQL 16');
  }
}

describeWithPostgres('migration 0039 signed proof (guarded PostgreSQL 16)', () => {
  jest.setTimeout(180_000);

  const schema = `test_signed_proof_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool | undefined;
  let operationPool: Pool | undefined;
  let runner: MigrationRunner | undefined;
  let schemaCreated = false;

  function requireOperationPool(): Pool {
    if (!operationPool) throw new Error('signed-proof operation pool is unavailable');
    return operationPool;
  }

  function requireRunner(): MigrationRunner {
    if (!runner) throw new Error('signed-proof migration runner is unavailable');
    return runner;
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const server = await adminPool.query<{ server_version_num: number }>(
      `SELECT pg_catalog.current_setting('server_version_num')::integer AS server_version_num`,
    );
    requirePostgres16(server.rows[0]?.server_version_num);
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    schemaCreated = true;
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 6,
      options: `-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=4000`,
    });
    runner = new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0039);
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

  it('applies, exactly verifies, and reverses an empty owner-only catalog', async () => {
    await expect(requireRunner().up()).resolves.toEqual(
      MIGRATIONS_THROUGH_0039.map(({ id }) => id),
    );
    await expect(requireRunner().assertUpToDate()).resolves.toBeUndefined();
    await expect(
      requireOperationPool().query<{ valid: boolean }>(
        createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039.verifySql ?? '',
      ),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });

    const acl = await requiredRow<{
      table_nonowner_acl: string;
      column_nonowner_acl: string;
      type_nonowner_acl: string;
      function_nonowner_acl: string;
    }>(
      requireOperationPool(),
      `SELECT
        (SELECT pg_catalog.count(*)::text
         FROM pg_catalog.pg_class AS relation
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
           relation.relacl, pg_catalog.acldefault('r', relation.relowner)
         )) AS acl
         WHERE relation.oid = pg_catalog.to_regclass(
           'mainnet_financial_action_signed_submission_proofs'
         ) AND acl.grantee <> relation.relowner) AS table_nonowner_acl,
        (SELECT pg_catalog.count(*)::text
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = pg_catalog.to_regclass(
           'mainnet_financial_action_signed_submission_proofs'
         ) AND attribute.attnum > 0 AND NOT attribute.attisdropped
           AND acl.grantee <> (
             SELECT relation.relowner FROM pg_catalog.pg_class AS relation
             WHERE relation.oid = attribute.attrelid
           )) AS column_nonowner_acl,
        (SELECT pg_catalog.count(*)::text
         FROM pg_catalog.pg_type AS row_type
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
           row_type.typacl, pg_catalog.acldefault('T', row_type.typowner)
         )) AS acl
         WHERE row_type.oid = 'mainnet_financial_action_signed_submission_proofs'::regtype
           AND acl.grantee <> row_type.typowner) AS type_nonowner_acl,
        (SELECT pg_catalog.count(*)::text
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
           procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
         )) AS acl
         WHERE procedure.pronamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
           AND procedure.proname IN (
             'enforce_mainnet_financial_action_signed_submission_proof_v1',
             'validate_mainnet_financial_action_signed_submission_proof_v1',
             'bind_verified_mainnet_financial_action_submission_v2'
           ) AND acl.grantee <> procedure.proowner) AS function_nonowner_acl`,
    );
    expect(acl).toEqual({
      table_nonowner_acl: '0',
      column_nonowner_acl: '0',
      type_nonowner_acl: '0',
      function_nonowner_acl: '0',
    });

    await expect(requireRunner().down()).resolves.toEqual(['0039']);
    await expect(
      requireOperationPool().query(
        `SELECT pg_catalog.to_regclass(
           'mainnet_financial_action_signed_submission_proofs'
         ) AS proof_table`,
      ),
    ).resolves.toMatchObject({ rows: [{ proof_table: null }] });
    await expect(requireRunner().up()).resolves.toEqual(['0039']);
  });

  it('refuses migration when immutable signed-bound history already exists', async () => {
    if (!adminPool) throw new Error('signed-proof admin pool is unavailable');
    const isolatedSchema = `test_signed_history_${randomUUID().replaceAll('-', '')}`;
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(isolatedSchema)}`);
    const isolatedPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 2,
      options: `-c search_path=${isolatedSchema} -c statement_timeout=5000`,
    });
    try {
      await new MigrationRunner(isolatedPool, MIGRATIONS_THROUGH_0038).up();
      const action = await prepareAction(isolatedPool, ETHEREUM_FIXTURE);
      const signedAt = await databaseNow(isolatedPool);
      await isolatedPool.query(LEGACY_BIND_SQL, [
        action.accountId,
        action.intentId,
        action.preparedRevision,
        action.preparedSnapshot,
        action.transactionId,
        fingerprint(),
        fingerprint(),
        signedAt,
        randomUUID(),
      ]);
      await expect(
        new MigrationRunner(isolatedPool, MIGRATIONS_THROUGH_0039).up(),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        isolatedPool.query(
          `SELECT pg_catalog.to_regclass(
             'mainnet_financial_action_signed_submission_proofs'
           ) AS proof_table`,
        ),
      ).resolves.toMatchObject({ rows: [{ proof_table: null }] });
    } finally {
      await isolatedPool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(isolatedSchema)} CASCADE`);
    }
  });

  it.each([
    ['Ethereum', ETHEREUM_FIXTURE],
    ['Solana', SOLANA_FIXTURE],
  ] as const)(
    'records and exactly replays %s proof but rejects conflicts',
    async (_name, network) => {
      const pool = requireOperationPool();
      const action = await prepareAction(pool, network);
      const values = proofValues(action);
      const recorded = await requiredRow<BoundLifecycleRow>(pool, VERIFIED_BIND_SQL, values);
      expect(recorded).toMatchObject({
        record_outcome: 'RECORDED',
        lifecycle_stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      });
      const proof = await requiredRow<ProofRow>(
        pool,
        `SELECT * FROM mainnet_financial_action_signed_submission_proofs
       WHERE intent_id = $1::uuid`,
        [action.intentId],
      );
      expect(proof).toMatchObject({
        intent_id: action.intentId,
        event_revision: recorded.lifecycle_revision,
        verifier_version: 1,
        verification_intent_fingerprint_sha256: values[9],
        network_id: network.networkId,
        chain_transaction_id: action.transactionId,
        signed_envelope_sha256: values[10],
        signing_payload_sha256: values[5],
        signature_evidence_sha256: values[6],
        provider_write_manifest_fingerprint_sha256: values[11],
        provider_action_binding_sha256: values[12],
        chain_replay_identity_sha256: values[13],
        signature_scheme: values[14],
        ethereum_nonce: network.networkId === ETHEREUM ? '42' : null,
        solana_recent_blockhash: values[16],
        proof_fingerprint_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      expect(proof.recorded_at.getTime()).toBeGreaterThanOrEqual(
        proof.server_received_and_verified_at.getTime(),
      );
      await expect(pool.query<BoundLifecycleRow>(VERIFIED_BIND_SQL, values)).resolves.toMatchObject(
        {
          rows: [
            expect.objectContaining({
              record_outcome: 'REPLAYED',
              lifecycle_revision: recorded.lifecycle_revision,
            }),
          ],
        },
      );
      const wrongRevision = [...values];
      wrongRevision[2] = (BigInt(String(values[2])) + 1n).toString();
      await expect(pool.query(VERIFIED_BIND_SQL, wrongRevision)).rejects.toMatchObject({
        code: '23505',
      });
      const wrongSnapshot = [...values];
      wrongSnapshot[3] = fingerprint('wrong-original-prepared-snapshot');
      await expect(pool.query(VERIFIED_BIND_SQL, wrongSnapshot)).rejects.toMatchObject({
        code: '23505',
      });
      const conflict = [...values];
      conflict[12] = fingerprint('conflicting-provider-binding');
      await expect(pool.query(VERIFIED_BIND_SQL, conflict)).rejects.toMatchObject({
        code: '23505',
      });
      await expect(
        pool.query<{ count: string }>(
          `SELECT pg_catalog.count(*)::text AS count
         FROM mainnet_financial_action_signed_submission_proofs
         WHERE intent_id = $1::uuid`,
          [action.intentId],
        ),
      ).resolves.toMatchObject({ rows: [{ count: '1' }] });
    },
  );

  it('rejects Ethereum signer-and-nonce replay identity across intents atomically', async () => {
    const pool = requireOperationPool();
    const chainReplayIdentity = fingerprint('one-ethereum-signer-and-nonce');
    const first = await prepareAction(pool, ETHEREUM_FIXTURE);
    await pool.query(
      VERIFIED_BIND_SQL,
      proofValues(first, { chainReplayIdentity, ethereumNonce: '81' }),
    );
    const second = await prepareAction(pool, ETHEREUM_FIXTURE);
    await expect(
      pool.query(
        VERIFIED_BIND_SQL,
        proofValues(second, { chainReplayIdentity, ethereumNonce: '81' }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `SELECT latest.stage, pg_catalog.count(proof.intent_id)::text AS proof_count
         FROM mainnet_financial_action_events AS latest
         LEFT JOIN mainnet_financial_action_signed_submission_proofs AS proof
           ON proof.intent_id = latest.intent_id
         WHERE latest.intent_id = $1::uuid
           AND latest.revision = (
             SELECT pg_catalog.max(event.revision)
             FROM mainnet_financial_action_events AS event
             WHERE event.intent_id = $1::uuid
           )
         GROUP BY latest.stage`,
        [second.intentId],
      ),
    ).resolves.toMatchObject({ rows: [{ stage: 'PREPARED', proof_count: '0' }] });
  });

  it('rolls back direct old-binder bypass at deferred commit time', async () => {
    const pool = requireOperationPool();
    const action = await prepareAction(pool, SOLANA_FIXTURE);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query(LEGACY_BIND_SQL, [
          action.accountId,
          action.intentId,
          action.preparedRevision,
          action.preparedSnapshot,
          action.transactionId,
          fingerprint(),
          fingerprint(),
          await databaseNow(client),
          randomUUID(),
        ]),
      ).resolves.toMatchObject({
        rows: [expect.objectContaining({ lifecycle_stage: 'WALLET_SIGNED_SUBMISSION_BOUND' })],
      });
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    await expect(
      pool.query(
        `SELECT stage FROM mainnet_financial_action_events
         WHERE intent_id = $1::uuid ORDER BY revision DESC LIMIT 1`,
        [action.intentId],
      ),
    ).resolves.toMatchObject({ rows: [{ stage: 'PREPARED' }] });
  });

  it('accepts no caller timestamp and rejects a bind after intent expiry', async () => {
    const pool = requireOperationPool();
    const signature = await requiredRow<{
      input_names: string[];
      timestamp_input_count: string;
    }>(
      pool,
      `SELECT procedure.proargnames[1:procedure.pronargs] AS input_names,
          (SELECT pg_catalog.count(*)::text
           FROM pg_catalog.unnest(procedure.proargtypes::oid[]) AS input_type
           WHERE input_type = 'timestamp with time zone'::regtype) AS timestamp_input_count
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = pg_catalog.to_regprocedure(
         'bind_verified_mainnet_financial_action_submission_v2(uuid,uuid,bigint,text,text,text,text,uuid,smallint,text,text,text,text,text,text,numeric,text)'
       )`,
    );
    expect(signature.timestamp_input_count).toBe('0');
    expect(signature.input_names).not.toContain('requested_server_received_and_verified_at');
    expect(signature.input_names).not.toContain('requested_signed_at');

    const action = await prepareAction(pool, ETHEREUM_FIXTURE, 1_500);
    const attemptedBackdate = new Date((await databaseNow(pool)).getTime() - 300_000);
    const values = proofValues(action);
    await expect(
      pool.query(
        `SELECT * FROM bind_verified_mainnet_financial_action_submission_v2(
           $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text,
           $8::timestamptz, $9::uuid, $10::smallint, $11::text, $12::text,
           $13::text, $14::text, $15::text, $16::text, $17::numeric, $18::text
         )`,
        [...values.slice(0, 7), attemptedBackdate, ...values.slice(7)],
      ),
    ).rejects.toMatchObject({ code: '42883' });
    await pool.query('SELECT pg_catalog.pg_sleep(1.7)');
    await expect(pool.query(VERIFIED_BIND_SQL, values)).rejects.toMatchObject({
      code: '40001',
    });
    await expect(
      pool.query<{ proof_count: string; event_count: string }>(
        `SELECT
          (SELECT pg_catalog.count(*)::text
           FROM mainnet_financial_action_signed_submission_proofs
           WHERE intent_id = $1::uuid) AS proof_count,
          (SELECT pg_catalog.count(*)::text
           FROM mainnet_financial_action_events
           WHERE intent_id = $1::uuid
             AND stage = 'WALLET_SIGNED_SUBMISSION_BOUND') AS event_count`,
        [action.intentId],
      ),
    ).resolves.toMatchObject({ rows: [{ proof_count: '0', event_count: '0' }] });

    const replayAction = await prepareAction(pool, SOLANA_FIXTURE, 2_000);
    const replayValues = proofValues(replayAction);
    await expect(pool.query(VERIFIED_BIND_SQL, replayValues)).resolves.toMatchObject({
      rows: [{ record_outcome: 'RECORDED' }],
    });
    await pool.query('SELECT pg_catalog.pg_sleep(2.2)');
    await expect(pool.query(VERIFIED_BIND_SQL, replayValues)).resolves.toMatchObject({
      rows: [{ record_outcome: 'REPLAYED' }],
    });
  });

  it('rejects history mutation, detects catalog tamper, and refuses unsafe down', async () => {
    const pool = requireOperationPool();
    const existing = await requiredRow<{ intent_id: string }>(
      pool,
      'SELECT intent_id FROM mainnet_financial_action_signed_submission_proofs LIMIT 1',
    );
    await expect(
      pool.query(
        `UPDATE mainnet_financial_action_signed_submission_proofs
         SET verifier_version = verifier_version WHERE intent_id = $1::uuid`,
        [existing.intent_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        'DELETE FROM mainnet_financial_action_signed_submission_proofs WHERE intent_id = $1::uuid',
        [existing.intent_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `ALTER TABLE mainnet_financial_action_signed_submission_proofs DISABLE TRIGGER
           mainnet_action_signed_submission_proof_before_insert`,
      );
      await expect(
        client.query<{ valid: boolean }>(
          createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039.verifySql ?? '',
        ),
      ).resolves.toMatchObject({ rows: [{ valid: false }] });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    await expect(requireRunner().down()).rejects.toMatchObject({ code: '55000' });
  });
});
