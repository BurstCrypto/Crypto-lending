import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ETHEREUM_MAINNET = 'eip155:1';
const MAINNET_ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const AAVE_V3_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const CHAIN_TRANSACTION_ID = `0x${'b'.repeat(64)}`;
const FINALIZED_BLOCK_ID = `0x${'c'.repeat(64)}`;
const MIGRATIONS_THROUGH_0033 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id <= '0033',
);

const PREPARE_SQL = `SELECT *
  FROM prepare_mainnet_financial_action_lifecycle(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
    $7::uuid, $8::text, $9::text, $10::uuid, $11::text, $12::text,
    $13::text, $14::text, $15::integer, $16::text, $17::text, $18::text,
    $19::smallint, $20::text, $21::text, $22::text, $23::text,
    $24::integer, $25::text, $26::text, $27::text, $28::timestamptz,
    $29::timestamptz, $30::uuid
  )`;
const BIND_SQL = `SELECT *
  FROM bind_mainnet_financial_action_submission(
    $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text,
    $7::text, $8::timestamptz, $9::uuid
  )`;
const RECONCILE_SQL = `SELECT *
  FROM record_mainnet_financial_action_reconciliation_observation(
    $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text,
    $7::text, $8::numeric, $9::text, $10::numeric, $11::text,
    $12::text, $13::text, $14::text, $15::timestamptz, $16::uuid
  )`;

type Queryable = Pick<PoolClient, 'query'>;

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
  current_state: string;
  next_state: string;
  operation_id: string;
  outcome: string;
  submission_id: string | null;
  transition_recorded_at: Date;
}

interface LifecycleRow extends QueryResultRow {
  record_outcome: string;
  result_intent_id: string;
  lifecycle_stage: string;
  lifecycle_revision: string;
  current_snapshot_sha256: string;
  chain_transaction_id: string | null;
  submission_fingerprint_sha256: string | null;
  observation_id: string | null;
  broadcast_outcome: string | null;
  reconciliation_outcome: string | null;
  transaction_position: string | null;
  finalized_position: string | null;
  terminal: boolean;
  requires_manual_reconciliation: boolean;
  database_replay_protection_enforced: boolean;
  ledger_settlement_authority: boolean;
}

interface HistoryCounts extends QueryResultRow {
  event_count: number;
  evidence_count: number;
  signed_count: number;
  broadcast_count: number;
  reconciliation_count: number;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Mainnet financial action transition integration requires loopback PostgreSQL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (
    serverVersionNum === undefined ||
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < 160_000 ||
    serverVersionNum >= 170_000
  ) {
    throw new Error('Mainnet financial action transition integration requires PostgreSQL 16');
  }
}

function digest(): string {
  return randomBytes(32).toString('hex');
}

async function requiredRow<Row extends QueryResultRow>(
  queryable: Queryable,
  sql: string,
  values: unknown[],
): Promise<Row> {
  const result = await queryable.query<Row>(sql, values);
  const row = result.rows[0];
  if (!row || result.rows.length !== 1) throw new Error('Expected exactly one PostgreSQL row');
  return row;
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

async function withForcedDeferredConstraints<Row>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<Row>,
): Promise<Row> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await callback(client);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function registerEthereumWallet(pool: Pool, accountId: string): Promise<string> {
  const challengeId = randomUUID();
  const walletId = randomUUID();
  const addressDigest = randomBytes(32);
  await pool.query(
    `INSERT INTO wallet_ownership_challenges (
       challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest, domain_digest_version, domain_digest,
       message_digest_version, message_digest, nonce_digest_version, nonce_digest,
       status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
     ) VALUES (
       $1, $2, 'EVM_ERC4361_ERC191', 'eip155', '1', 'MAINNET', 1, $3,
       1, $4, 1, $5, 1, $6, 1, $7, 'REGISTERED',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() + interval '5 minutes',
       statement_timestamp() - interval '1 minute',
       statement_timestamp() - interval '1 minute'
     )`,
    [
      challengeId,
      accountId,
      MAINNET_ASSET_REGISTRY_FINGERPRINT,
      addressDigest,
      randomBytes(32),
      randomBytes(32),
      randomBytes(32),
    ],
  );
  await pool.query(
    `INSERT INTO wallet_ownership_challenge_identity_digests (
       challenge_id, account_id, chain_namespace, chain_reference,
       address_digest_version, address_digest
     ) VALUES ($1, $2, 'eip155', '1', 1, $3)`,
    [challengeId, accountId, addressDigest],
  );
  await pool.query(
    `INSERT INTO registered_wallets (
       wallet_id, account_id, registered_by_challenge_id,
       chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest,
       address_key_version, address_ciphertext, address_iv, address_auth_tag,
       metadata_key_version, metadata_ciphertext, metadata_iv, metadata_auth_tag
     ) VALUES (
       $1, $2, $3, 'eip155', '1', 'MAINNET', 1, $4,
       1, $5, 1, $6, $7, $8, 1, $9, $10, $11
     )`,
    [
      walletId,
      accountId,
      challengeId,
      MAINNET_ASSET_REGISTRY_FINGERPRINT,
      addressDigest,
      Buffer.from('mainnet-action-transition-address'),
      randomBytes(12),
      randomBytes(16),
      Buffer.from('mainnet-action-transition-metadata'),
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
    `SELECT created.*
     FROM create_yield_operation(
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
  transition: Readonly<{
    expectedState: string;
    nextState: string;
    reason: string;
    effectiveAt: Date;
  }>,
): Promise<YieldCommandRow> {
  return requiredRow<YieldCommandRow>(
    queryable,
    `SELECT transitioned.*
     FROM transition_yield_operation(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
       $6::timestamptz, NULL::uuid, $7::uuid, 1::smallint,
       $8::text, 1::smallint, $9::text
     ) AS transitioned`,
    [
      fixture.accountId,
      fixture.operationId,
      transition.expectedState,
      transition.nextState,
      transition.reason,
      transition.effectiveAt,
      fixture.correlationId,
      digest(),
      digest(),
    ],
  );
}

async function provisionFixture(pool: Pool): Promise<YieldFixture> {
  const accountId = randomUUID();
  const ledgerTransactionId = randomUUID();
  const ledgerBook = await requiredRow<{ book_id: string }>(
    pool,
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
    [],
  );
  await pool.query(
    `INSERT INTO accounts (account_id, eligibility_status)
     VALUES ($1::uuid, 'UNKNOWN')`,
    [accountId],
  );
  await pool.query(
    `INSERT INTO ledger_transactions (
       transaction_id, tenant_account_id, book_id, intent_type,
       configuration_revision_reference_id
     ) VALUES ($1, $2, $3, 'DIRECT_SETTLEMENT', $4)`,
    [ledgerTransactionId, accountId, ledgerBook.book_id, randomUUID()],
  );
  const walletId = await registerEthereumWallet(pool, accountId);
  const fixtureWithoutSubmission = {
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
  const at = (offsetMilliseconds: number): Date =>
    new Date(now.getTime() - 60_000 + offsetMilliseconds);

  await expect(createYieldOperation(pool, fixtureWithoutSubmission, at(0))).resolves.toMatchObject({
    operation_id: fixtureWithoutSubmission.operationId,
    current_state: 'CREATED',
    next_state: 'CREATED',
    outcome: 'COMMITTED',
  });
  await expect(
    transitionYieldOperation(pool, fixtureWithoutSubmission, {
      expectedState: 'CREATED',
      nextState: 'QUOTED',
      reason: 'QUOTE_CREATED',
      effectiveAt: at(1_000),
    }),
  ).resolves.toMatchObject({ current_state: 'QUOTED', next_state: 'QUOTED' });
  await expect(
    transitionYieldOperation(pool, fixtureWithoutSubmission, {
      expectedState: 'QUOTED',
      nextState: 'USER_APPROVED',
      reason: 'USER_APPROVAL_RECORDED',
      effectiveAt: at(2_000),
    }),
  ).resolves.toMatchObject({ current_state: 'USER_APPROVED', next_state: 'USER_APPROVED' });
  const submitted = await withForcedDeferredConstraints(pool, async (client) => {
    const row = await transitionYieldOperation(client, fixtureWithoutSubmission, {
      expectedState: 'USER_APPROVED',
      nextState: 'SUBMITTED',
      reason: 'SUBMISSION_RECORDED',
      effectiveAt: at(3_000),
    });
    if (!row.submission_id) throw new Error('Yield submission was not created');
    const envelope = Object.freeze({
      id: row.submission_id,
      kind: 'yield.operation.submit',
      version: 1,
      occurredAt: row.transition_recorded_at.toISOString(),
      correlation: Object.freeze({
        correlationId: fixtureWithoutSubmission.correlationId,
        initiatorActorId: fixtureWithoutSubmission.accountId,
        quoteId: fixtureWithoutSubmission.quoteReferenceId,
        transactionId: fixtureWithoutSubmission.ledgerTransactionId,
      }),
      payload: Object.freeze({
        submissionId: row.submission_id,
        operationId: fixtureWithoutSubmission.operationId,
        operationType: 'ALLOCATE',
        ledgerTransactionId: fixtureWithoutSubmission.ledgerTransactionId,
        planReferenceId: fixtureWithoutSubmission.planReferenceId,
        quoteReferenceId: fixtureWithoutSubmission.quoteReferenceId,
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
  expect(submitted).toMatchObject({ current_state: 'SUBMITTED', next_state: 'SUBMITTED' });
  return { ...fixtureWithoutSubmission, submissionId: submitted.submission_id };
}

async function historyCounts(pool: Pool, intentId: string): Promise<HistoryCounts> {
  return requiredRow<HistoryCounts>(
    pool,
    `SELECT
       pg_catalog.count(*)::integer AS event_count,
       pg_catalog.count(*) FILTER (
         WHERE event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
       )::integer AS signed_count,
       pg_catalog.count(*) FILTER (
         WHERE event.stage = 'BROADCAST_OUTCOME_AMBIGUOUS'
       )::integer AS broadcast_count,
       pg_catalog.count(*) FILTER (
         WHERE event.reconciliation_outcome IS NOT NULL
       )::integer AS reconciliation_count,
       (SELECT pg_catalog.count(*)::integer
        FROM mainnet_financial_action_evidence_claims AS claim
        WHERE claim.intent_id = $1::uuid) AS evidence_count
     FROM mainnet_financial_action_events AS event
     WHERE event.intent_id = $1::uuid`,
    [intentId],
  );
}

describeWithPostgres('mainnet financial action lifecycle transition PostgreSQL controls', () => {
  jest.setTimeout(180_000);

  const schema = `mainnet_action_flow_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = MIGRATIONS_THROUGH_0033.map(({ id }) => id);
  let adminPool: Pool | undefined;
  let operationPool: Pool | undefined;
  let runner: MigrationRunner | undefined;
  let schemaCreated = false;
  let appliedMigrationIds: string[] = [];

  function requireOperationPool(): Pool {
    if (!operationPool) throw new Error('Mainnet financial action transition pool is unavailable');
    return operationPool;
  }

  function requireRunner(): MigrationRunner {
    if (!runner) throw new Error('Mainnet financial action transition runner is unavailable');
    return runner;
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
      max: 3,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0033);
    appliedMigrationIds = await runner.up();
  });

  afterAll(async () => {
    try {
      if (operationPool) await operationPool.end();
    } finally {
      if (adminPool) {
        try {
          if (schemaCreated) {
            await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
          }
        } finally {
          await adminPool.end();
        }
      }
    }
  });

  it('reconciles a signed submission directly after wallet revocation and operation failure', async () => {
    expect(appliedMigrationIds).toEqual(expectedMigrationIds);
    await expect(requireRunner().assertUpToDate()).resolves.toBeUndefined();
    const pool = requireOperationPool();
    const fixture = await provisionFixture(pool);
    const intentId = randomUUID();
    const replayProtectionId = randomUUID();
    const intentCorrelationId = randomUUID();
    const preparationClock = await databaseNow(pool);
    const issuedAt = new Date(preparationClock.getTime() - 1_000);
    const expiresAt = new Date(issuedAt.getTime() + 240_000);

    const prepared = await withForcedDeferredConstraints(pool, (client) =>
      requiredRow<LifecycleRow>(client, PREPARE_SQL, [
        intentId,
        fixture.accountId,
        fixture.operationId,
        fixture.submissionId,
        fixture.ledgerTransactionId,
        fixture.ledgerBookId,
        fixture.walletId,
        digest(),
        digest(),
        replayProtectionId,
        ETHEREUM_MAINNET,
        'aave',
        'aave-v3',
        AAVE_V3_MARKET,
        1,
        MAINNET_ASSET_REGISTRY_FINGERPRINT,
        'USDC',
        ETHEREUM_USDC,
        6,
        'SUPPLY',
        '1000000',
        '1000000',
        '1000000000000000',
        100,
        '10000000000000000',
        'EXACT',
        '1000000',
        issuedAt,
        expiresAt,
        intentCorrelationId,
      ]),
    );
    expect(prepared).toMatchObject({
      record_outcome: 'RECORDED',
      result_intent_id: intentId,
      lifecycle_stage: 'PREPARED',
      lifecycle_revision: '1',
      chain_transaction_id: null,
      terminal: false,
      database_replay_protection_enforced: true,
      ledger_settlement_authority: false,
    });
    expect(prepared.current_snapshot_sha256).toMatch(SHA256);

    const signedAt = await databaseNow(pool);
    const signedPayloadDigest = digest();
    const signatureEvidenceDigest = digest();
    const bound = await withForcedDeferredConstraints(pool, (client) =>
      requiredRow<LifecycleRow>(client, BIND_SQL, [
        fixture.accountId,
        intentId,
        prepared.lifecycle_revision,
        prepared.current_snapshot_sha256,
        CHAIN_TRANSACTION_ID,
        signedPayloadDigest,
        signatureEvidenceDigest,
        signedAt,
        randomUUID(),
      ]),
    );
    expect(bound).toMatchObject({
      record_outcome: 'RECORDED',
      result_intent_id: intentId,
      lifecycle_stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      lifecycle_revision: '2',
      chain_transaction_id: CHAIN_TRANSACTION_ID,
      broadcast_outcome: null,
      reconciliation_outcome: null,
      terminal: false,
    });
    expect(bound.current_snapshot_sha256).toMatch(SHA256);
    expect(bound.submission_fingerprint_sha256).toMatch(SHA256);

    await expect(
      pool.query<{ revocation_outcome: string }>(
        'SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)',
        [fixture.accountId, fixture.walletId, randomUUID()],
      ),
    ).resolves.toMatchObject({ rows: [{ revocation_outcome: 'REVOKED' }] });
    const failureAt = await databaseNow(pool);
    await expect(
      transitionYieldOperation(pool, fixture, {
        expectedState: 'SUBMITTED',
        nextState: 'FAILED',
        reason: 'PROVIDER_REJECTED',
        effectiveAt: failureAt,
      }),
    ).resolves.toMatchObject({ current_state: 'FAILED', next_state: 'FAILED' });

    const degradedDependencies = await pool.query<{
      wallet_status: string;
      operation_state: string;
    }>(
      `SELECT wallet.status AS wallet_status,
              operation.current_state AS operation_state
       FROM registered_wallets AS wallet
       CROSS JOIN yield_operations AS operation
       WHERE wallet.wallet_id = $1::uuid
         AND operation.operation_id = $2::uuid`,
      [fixture.walletId, fixture.operationId],
    );
    expect(degradedDependencies.rows).toEqual([
      { wallet_status: 'REVOKED', operation_state: 'FAILED' },
    ]);

    const reconciliationObservationId = randomUUID();
    const sourceEvidenceDigest = digest();
    const reconciliationObservedAt = await databaseNow(pool);
    const reconciled = await withForcedDeferredConstraints(pool, (client) =>
      requiredRow<LifecycleRow>(client, RECONCILE_SQL, [
        fixture.accountId,
        intentId,
        bound.lifecycle_revision,
        bound.current_snapshot_sha256,
        reconciliationObservationId,
        CHAIN_TRANSACTION_ID,
        'UNKNOWN',
        null,
        null,
        '21000000',
        FINALIZED_BLOCK_ID,
        null,
        null,
        sourceEvidenceDigest,
        reconciliationObservedAt,
        randomUUID(),
      ]),
    );
    expect(reconciled).toMatchObject({
      record_outcome: 'RECORDED',
      result_intent_id: intentId,
      lifecycle_stage: 'RECONCILIATION_AMBIGUOUS',
      lifecycle_revision: '3',
      chain_transaction_id: CHAIN_TRANSACTION_ID,
      submission_fingerprint_sha256: bound.submission_fingerprint_sha256,
      observation_id: reconciliationObservationId,
      broadcast_outcome: null,
      reconciliation_outcome: 'UNKNOWN',
      transaction_position: null,
      finalized_position: '21000000',
      terminal: false,
      requires_manual_reconciliation: false,
      database_replay_protection_enforced: true,
      ledger_settlement_authority: false,
    });

    expect(await historyCounts(pool, intentId)).toMatchObject({
      event_count: 3,
      evidence_count: 3,
      signed_count: 1,
      broadcast_count: 0,
      reconciliation_count: 1,
    });
    await expect(
      pool.query(RECONCILE_SQL, [
        fixture.accountId,
        intentId,
        bound.lifecycle_revision,
        bound.current_snapshot_sha256,
        randomUUID(),
        CHAIN_TRANSACTION_ID,
        'UNKNOWN',
        null,
        null,
        '21000000',
        FINALIZED_BLOCK_ID,
        null,
        null,
        digest(),
        await databaseNow(pool),
        randomUUID(),
      ]),
    ).rejects.toMatchObject({
      code: '40001',
      message: 'mainnet financial action reconciliation compare-and-swap conflict',
    });
    expect(await historyCounts(pool, intentId)).toMatchObject({
      event_count: 3,
      evidence_count: 3,
      signed_count: 1,
      broadcast_count: 0,
      reconciliation_count: 1,
    });

    const retained = await pool.query<{
      automatic_resend_allowed: boolean;
      wallet_broadcast_evidence_count: number;
    }>(
      `SELECT intent.automatic_resend_allowed,
              (SELECT pg_catalog.count(*)::integer
               FROM mainnet_financial_action_evidence_claims AS claim
               WHERE claim.intent_id = intent.intent_id
                 AND claim.evidence_role = 'WALLET_BROADCAST_EVIDENCE')
                AS wallet_broadcast_evidence_count
       FROM mainnet_financial_action_intents AS intent
       WHERE intent.intent_id = $1::uuid`,
      [intentId],
    );
    expect(retained.rows).toEqual([
      { automatic_resend_allowed: false, wallet_broadcast_evidence_count: 0 },
    ]);
  });
});
