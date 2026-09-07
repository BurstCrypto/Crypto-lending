import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../src/blockchain/domain/supported-asset-registry';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import type { DormantMainnetFinancialActionIntentInputV1 } from '../../src/mainnet-actions/domain/dormant-mainnet-financial-action';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
  type BindDormantMainnetFinancialActionSubmissionRequestV1,
  type DormantMainnetFinancialActionDatabaseConfirmedResultV1,
  type DormantMainnetFinancialActionDurableRequestV1,
  type PrepareDormantMainnetFinancialActionDurableRequestV1,
  type ReadDormantMainnetFinancialActionDurableRequestV1,
  type RecordDormantMainnetFinancialActionReconciliationRequestV1,
} from '../../src/mainnet-actions/application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';
import { PostgresDormantMainnetFinancialActionLifecycleDurableAdapter } from '../../src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter';
import {
  activeWalletRegistrationKey,
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  digestWalletIdentity,
  type WalletRegistrationDigestReference,
} from '../../src/wallets/infrastructure/crypto/wallet-registration-crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ETHEREUM_MAINNET = 'eip155:1' as const;
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const AAVE_V3_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const WALLET_ADDRESS = '0x1111111111111111111111111111111111111111';
const CHAIN_TRANSACTION_ID = `0x${'b'.repeat(64)}`;
const FINALIZED_BLOCK_ID = `0x${'c'.repeat(64)}`;
const MIGRATIONS_THROUGH_0034 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id <= '0034',
);

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

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Dormant mainnet lifecycle adapter integration requires loopback PostgreSQL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (
    serverVersionNum === undefined ||
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < 160_000 ||
    serverVersionNum >= 170_000
  ) {
    throw new Error('Dormant mainnet lifecycle adapter integration requires PostgreSQL 16');
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

async function registerActiveEthereumWallet(
  pool: Pool,
  accountId: string,
  parentAddressDigest: WalletRegistrationDigestReference<'address'>,
  acceptedAddressDigest: WalletRegistrationDigestReference<'address'>,
): Promise<string> {
  const challengeId = randomUUID();
  const walletId = randomUUID();
  const parentAddressDigestBytes = Buffer.from(parentAddressDigest.value, 'hex');
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  await pool.query(
    `INSERT INTO wallet_ownership_challenges (
       challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest, domain_digest_version, domain_digest,
       message_digest_version, message_digest, nonce_digest_version, nonce_digest,
       status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
     ) VALUES (
       $1, $2, 'EVM_ERC4361_ERC191', 'eip155', '1', 'MAINNET', $3, $4,
       $5, $6, 1, $7, 1, $8, 1, $9, 'REGISTERED',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() + interval '5 minutes',
       statement_timestamp() - interval '1 minute',
       statement_timestamp() - interval '1 minute'
     )`,
    [
      challengeId,
      accountId,
      registry.version,
      registry.fingerprintSha256,
      parentAddressDigest.version,
      parentAddressDigestBytes,
      randomBytes(32),
      randomBytes(32),
      randomBytes(32),
    ],
  );
  await pool.query(
    `INSERT INTO wallet_ownership_challenge_identity_digests (
       challenge_id, account_id, chain_namespace, chain_reference,
       address_digest_version, address_digest
     ) VALUES ($1, $2, 'eip155', '1', $3, $4)`,
    [challengeId, accountId, parentAddressDigest.version, parentAddressDigestBytes],
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
       $1, $2, $3, 'eip155', '1', 'MAINNET', $4, $5,
       $6, $7, 1, $8, $9, $10, 1, $11, $12, $13
     )`,
    [
      walletId,
      accountId,
      challengeId,
      registry.version,
      registry.fingerprintSha256,
      parentAddressDigest.version,
      parentAddressDigestBytes,
      Buffer.from('dormant-mainnet-adapter-address'),
      randomBytes(12),
      randomBytes(16),
      Buffer.from('dormant-mainnet-adapter-metadata'),
      randomBytes(12),
      randomBytes(16),
    ],
  );
  await pool.query(
    `INSERT INTO registered_wallet_identity_digests (
       wallet_id, account_id, chain_namespace, chain_reference,
       address_digest_version, address_digest, status, registered_at, revoked_at
     ) VALUES ($1, $2, 'eip155', '1', $3, $4, 'ACTIVE', statement_timestamp(), NULL)`,
    [
      walletId,
      accountId,
      acceptedAddressDigest.version,
      Buffer.from(acceptedAddressDigest.value, 'hex'),
    ],
  );
  await pool.query(
    'ALTER TABLE wallet_identity_key_policy DISABLE TRIGGER wallet_identity_key_policy_immutable_row',
  );
  try {
    await pool.query(
      `UPDATE wallet_identity_key_policy
       SET active_write_version = $1::smallint,
           accepted_read_versions = ARRAY[$1::smallint],
           updated_at = pg_catalog.clock_timestamp()
       WHERE policy_name = 'wallet-registration-identity-hmac'`,
      [acceptedAddressDigest.version],
    );
  } finally {
    await pool.query(
      'ALTER TABLE wallet_identity_key_policy ENABLE ALWAYS TRIGGER wallet_identity_key_policy_immutable_row',
    );
  }
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

async function provisionSubmittedYieldFixture(
  pool: Pool,
  parentAddressDigest: WalletRegistrationDigestReference<'address'>,
  acceptedAddressDigest: WalletRegistrationDigestReference<'address'>,
): Promise<YieldFixture> {
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
  const walletId = await registerActiveEthereumWallet(
    pool,
    accountId,
    parentAddressDigest,
    acceptedAddressDigest,
  );
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

  await createYieldOperation(pool, fixtureWithoutSubmission, at(0));
  await transitionYieldOperation(pool, fixtureWithoutSubmission, {
    expectedState: 'CREATED',
    nextState: 'QUOTED',
    reason: 'QUOTE_CREATED',
    effectiveAt: at(1_000),
  });
  await transitionYieldOperation(pool, fixtureWithoutSubmission, {
    expectedState: 'QUOTED',
    nextState: 'USER_APPROVED',
    reason: 'USER_APPROVAL_RECORDED',
    effectiveAt: at(2_000),
  });
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
  return { ...fixtureWithoutSubmission, submissionId: submitted.submission_id };
}

function commonRequest(
  signal: AbortSignal,
): Pick<
  PrepareDormantMainnetFinancialActionDurableRequestV1,
  'durableLifecycleVersion' | 'use' | 'mayAuthorizeFinancialAction' | 'signal'
> {
  return {
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
    mayAuthorizeFinancialAction: false as const,
    signal,
  };
}

function reviewConfirmed(
  adapter: PostgresDormantMainnetFinancialActionLifecycleDurableAdapter,
  capability: unknown,
  request: DormantMainnetFinancialActionDurableRequestV1,
): DormantMainnetFinancialActionDatabaseConfirmedResultV1 {
  const reviewed = adapter.reviewResult(capability, request);
  expect(reviewed).toBe(capability);
  if (reviewed?.outcome !== 'DATABASE_STATE_CONFIRMED') {
    throw new Error('Expected an exact reviewed database-confirmed capability');
  }
  return reviewed;
}

describeWithPostgres('PostgreSQL dormant mainnet financial action durable adapter', () => {
  jest.setTimeout(180_000);

  const schema = `mainnet_action_adapter_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = MIGRATIONS_THROUGH_0034.map(({ id }) => id);
  let adminPool: Pool | undefined;
  let operationPool: Pool | undefined;
  let postgres: PostgresService | undefined;
  let runner: MigrationRunner | undefined;
  let schemaCreated = false;
  let appliedMigrationIds: string[] = [];

  function requireOperationPool(): Pool {
    if (!operationPool) throw new Error('Dormant mainnet lifecycle operation pool is unavailable');
    return operationPool;
  }

  function requireRunner(): MigrationRunner {
    if (!runner) throw new Error('Dormant mainnet lifecycle migration runner is unavailable');
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
    postgres = new PostgresService(operationPool);
    runner = new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0034);
    appliedMigrationIds = await runner.up();
  });

  afterAll(async () => {
    try {
      if (postgres) await postgres.closeCancellableQueries();
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

  it('prepares, binds, directly reconciles UNKNOWN, and reads only reviewed non-authoritative state', async () => {
    expect(appliedMigrationIds).toEqual(expectedMigrationIds);
    await expect(requireRunner().assertUpToDate()).resolves.toBeUndefined();
    const pool = requireOperationPool();
    if (!postgres) throw new Error('Dormant mainnet lifecycle PostgresService is unavailable');
    const parentIdentityKey = createWalletRegistrationKey(
      'identity-hmac',
      1,
      randomBytes(32).toString('base64url'),
      'dormant-mainnet-adapter-parent-identity-v1',
    );
    const currentIdentityKey = createWalletRegistrationKey(
      'identity-hmac',
      2,
      randomBytes(32).toString('base64url'),
      'dormant-mainnet-adapter-current-identity-v2',
    );
    const identityKeyRing = createWalletRegistrationKeyRing('identity-hmac', 2, [
      currentIdentityKey,
    ]);
    const parentWalletAddressDigest = digestWalletIdentity(
      parentIdentityKey,
      ETHEREUM_MAINNET,
      WALLET_ADDRESS,
    );
    const currentWalletAddressDigest = digestWalletIdentity(
      activeWalletRegistrationKey(identityKeyRing),
      ETHEREUM_MAINNET,
      WALLET_ADDRESS,
    );
    const fixture = await provisionSubmittedYieldFixture(
      pool,
      parentWalletAddressDigest,
      currentWalletAddressDigest,
    );
    const identityBinding = await requiredRow<{
      parent_digest_version: number;
      accepted_read_versions: number[];
      current_alias_count: number;
    }>(
      pool,
      `SELECT wallet.address_digest_version AS parent_digest_version,
              policy.accepted_read_versions,
              (SELECT pg_catalog.count(*)::integer
               FROM registered_wallet_identity_digests AS alias
               WHERE alias.wallet_id = wallet.wallet_id
                 AND alias.address_digest_version = $2::smallint
                 AND alias.address_digest = pg_catalog.decode($3::text, 'hex')
                 AND alias.status = 'ACTIVE'
                 AND alias.revoked_at IS NULL) AS current_alias_count
       FROM registered_wallets AS wallet
       CROSS JOIN wallet_identity_key_policy AS policy
       WHERE wallet.wallet_id = $1::uuid
         AND policy.policy_name = 'wallet-registration-identity-hmac'`,
      [fixture.walletId, currentWalletAddressDigest.version, currentWalletAddressDigest.value],
    );
    expect(identityBinding).toEqual({
      parent_digest_version: 1,
      accepted_read_versions: [2],
      current_alias_count: 1,
    });
    const serverNow = await databaseNow(pool);
    const adapter = new PostgresDormantMainnetFinancialActionLifecycleDurableAdapter(
      postgres,
      Object.freeze({ now: () => serverNow }),
      identityKeyRing,
    );
    const signal = new AbortController().signal;
    const intentId = randomUUID();
    const volatileIntentCommitmentSha256 = digest();
    const intentInput: DormantMainnetFinancialActionIntentInputV1 = Object.freeze({
      schemaVersion: 1,
      intentId,
      accountId: fixture.accountId,
      walletRegistrationId: fixture.walletId,
      replayProtectionId: randomUUID(),
      idempotencyKeyDigestSha256: digest(),
      networkId: ETHEREUM_MAINNET,
      walletAddress: WALLET_ADDRESS,
      providerId: 'aave',
      protocolId: 'aave-v3',
      marketId: AAVE_V3_MARKET,
      assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
      assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
      assetSymbol: 'USDC',
      assetIdentity: ETHEREUM_USDC,
      action: 'SUPPLY',
      amountAtomic: '1000000',
      requestedValueUsdMicros: '1000000',
      maximumNetworkFeeAtomic: '1000000000000000',
      maximumNetworkFeeBasisPoints: 100,
      minimumPostActionNativeBalanceAtomic: '10000000000000000',
      allowanceMode: 'EXACT',
      allowanceAmountAtomic: '1000000',
      issuedAt: new Date(serverNow.getTime() - 1_000).toISOString(),
      expiresAt: new Date(serverNow.getTime() + 240_000).toISOString(),
    });
    const prepareRequest: PrepareDormantMainnetFinancialActionDurableRequestV1 = Object.freeze({
      ...commonRequest(signal),
      intentInput,
      authoritativeLinks: Object.freeze({
        yieldOperationId: fixture.operationId,
        yieldSubmissionId: fixture.submissionId,
        ledgerTransactionId: fixture.ledgerTransactionId,
        ledgerBookId: fixture.ledgerBookId,
      }),
      volatileIntentCommitment: Object.freeze({
        source: 'VOLATILE_IN_PROCESS_LIFECYCLE',
        encoding: 'VOLATILE_JSON_DOMAIN_V1',
        sha256: volatileIntentCommitmentSha256,
        mayServeAsDatabaseCursor: false,
      }),
      correlationId: randomUUID(),
    });

    const preparedCapability = await adapter.prepare(prepareRequest);
    const prepared = reviewConfirmed(adapter, preparedCapability, prepareRequest);
    expect(adapter.reviewResult(preparedCapability, { ...prepareRequest })).toBeNull();
    expect(prepared).toMatchObject({
      operation: 'PREPARE',
      databaseRecordOutcome: 'RECORDED',
      stage: 'PREPARED',
      volatileIntentCommitmentSha256,
      chainTransactionId: null,
      terminal: false,
      databaseReplayProtectionEnforced: true,
      ledgerSettlementAuthority: false,
    });
    expect(prepared.cursor).toMatchObject({
      accountId: fixture.accountId,
      intentId,
      networkId: ETHEREUM_MAINNET,
      lifecycleRevision: '1',
    });
    expect(prepared.cursor.currentSnapshotSha256).toMatch(SHA256);
    expect(prepared.cursor.intentRecordFingerprintSha256).toMatch(SHA256);
    expect(prepared.cursor.currentSnapshotSha256).not.toBe(
      prepared.cursor.intentRecordFingerprintSha256,
    );
    expect(Date.parse(prepared.effectiveAt)).toBeGreaterThanOrEqual(
      Date.parse(intentInput.issuedAt),
    );
    expect(Date.parse(prepared.effectiveAt)).toBeLessThanOrEqual(Date.parse(prepared.recordedAt));
    expect(Date.parse(prepared.effectiveAt)).toBeLessThan(Date.parse(intentInput.expiresAt));

    const mismatchedIntentId = randomUUID();
    const mismatchedPrepareRequest: PrepareDormantMainnetFinancialActionDurableRequestV1 =
      Object.freeze({
        ...prepareRequest,
        intentInput: Object.freeze({
          ...intentInput,
          intentId: mismatchedIntentId,
          replayProtectionId: randomUUID(),
          idempotencyKeyDigestSha256: digest(),
          walletAddress: '0x3333333333333333333333333333333333333333',
        }),
        volatileIntentCommitment: Object.freeze({
          ...prepareRequest.volatileIntentCommitment,
          sha256: digest(),
        }),
        correlationId: randomUUID(),
      });
    const mismatchedCapability = await adapter.prepare(mismatchedPrepareRequest);
    expect(adapter.reviewResult(mismatchedCapability, mismatchedPrepareRequest)).toMatchObject({
      outcome: 'DATABASE_OUTCOME_UNKNOWN',
      operation: 'PREPARE',
      lastConfirmedCursor: null,
      recoveryMode: 'READ_ONLY',
      mayAuthorizeFinancialAction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      automaticRetryAllowed: false,
      ledgerSettlementAuthority: false,
    });
    const mismatchedRows = await pool.query<{ intent_count: number }>(
      `SELECT pg_catalog.count(*)::integer AS intent_count
       FROM mainnet_financial_action_intents
       WHERE intent_id = $1::uuid`,
      [mismatchedIntentId],
    );
    expect(mismatchedRows.rows).toEqual([{ intent_count: 0 }]);

    const signedAt = await databaseNow(pool);
    const bindRequest: BindDormantMainnetFinancialActionSubmissionRequestV1 = Object.freeze({
      ...commonRequest(signal),
      cursor: prepared.cursor,
      correlationId: randomUUID(),
      transactionId: CHAIN_TRANSACTION_ID,
      walletSignedPayloadSha256: digest(),
      walletSignatureEvidenceSha256: digest(),
      signedAt: signedAt.toISOString(),
    });
    const boundCapability = await adapter.bindSubmission(bindRequest);
    const bound = reviewConfirmed(adapter, boundCapability, bindRequest);
    expect(bound).toMatchObject({
      operation: 'BIND_SUBMISSION',
      databaseRecordOutcome: 'RECORDED',
      stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      chainTransactionId: CHAIN_TRANSACTION_ID,
      reconciliationOutcome: null,
      terminal: false,
      ledgerSettlementAuthority: false,
    });
    expect(bound.cursor).toMatchObject({
      accountId: fixture.accountId,
      intentId,
      lifecycleRevision: '2',
      intentRecordFingerprintSha256: prepared.cursor.intentRecordFingerprintSha256,
    });
    expect(bound.cursor.currentSnapshotSha256).toMatch(SHA256);
    expect(bound.cursor.currentSnapshotSha256).not.toBe(prepared.cursor.currentSnapshotSha256);

    const reconciliationObservedAt = await databaseNow(pool);
    const observationId = randomUUID();
    const reconciliationRequest: RecordDormantMainnetFinancialActionReconciliationRequestV1 =
      Object.freeze({
        ...commonRequest(signal),
        cursor: bound.cursor,
        correlationId: randomUUID(),
        observationId,
        transactionId: CHAIN_TRANSACTION_ID,
        outcome: 'UNKNOWN',
        transactionPosition: null,
        transactionBlockId: null,
        finalizedPosition: '21000000',
        finalizedBlockId: FINALIZED_BLOCK_ID,
        effectEvidenceSha256: null,
        failureEvidenceSha256: null,
        sourceEvidenceSha256: digest(),
        observedAt: reconciliationObservedAt.toISOString(),
      });
    const reconciledCapability = await adapter.recordReconciliation(reconciliationRequest);
    const reconciled = reviewConfirmed(adapter, reconciledCapability, reconciliationRequest);
    expect(reconciled).toMatchObject({
      operation: 'RECORD_RECONCILIATION',
      databaseRecordOutcome: 'RECORDED',
      stage: 'RECONCILIATION_AMBIGUOUS',
      chainTransactionId: CHAIN_TRANSACTION_ID,
      submissionFingerprintSha256: bound.submissionFingerprintSha256,
      observationId,
      broadcastOutcome: null,
      reconciliationOutcome: 'UNKNOWN',
      transactionPosition: null,
      transactionBlockId: null,
      finalizedPosition: '21000000',
      finalizedBlockId: FINALIZED_BLOCK_ID,
      terminal: false,
      requiresManualReconciliation: false,
      ledgerSettlementAuthority: false,
    });
    expect(reconciled.cursor).toMatchObject({
      accountId: fixture.accountId,
      intentId,
      lifecycleRevision: '3',
      intentRecordFingerprintSha256: prepared.cursor.intentRecordFingerprintSha256,
    });
    expect(reconciled.cursor.currentSnapshotSha256).toMatch(SHA256);

    const readRequest: ReadDormantMainnetFinancialActionDurableRequestV1 = Object.freeze({
      ...commonRequest(signal),
      accountId: fixture.accountId,
      intentId,
    });
    const readCapability = await adapter.read(readRequest);
    const read = reviewConfirmed(adapter, readCapability, readRequest);
    expect(read).toMatchObject({
      operation: 'READ',
      databaseRecordOutcome: 'READ',
      stage: 'RECONCILIATION_AMBIGUOUS',
      chainTransactionId: CHAIN_TRANSACTION_ID,
      submissionFingerprintSha256: bound.submissionFingerprintSha256,
      observationId,
      broadcastOutcome: null,
      reconciliationOutcome: 'UNKNOWN',
      transactionPosition: null,
      finalizedPosition: '21000000',
      terminal: false,
      requiresManualReconciliation: false,
      ledgerSettlementAuthority: false,
    });
    expect(read.cursor).toEqual(reconciled.cursor);

    for (const result of [prepared, bound, reconciled, read]) {
      expect(result).toMatchObject({
        mayAuthorizeFinancialAction: false,
        apiMaySign: false,
        apiMayBroadcast: false,
        mayResendTransaction: false,
        automaticRetryAllowed: false,
        ledgerSettlementAuthority: false,
      });
    }

    const persisted = await requiredRow<{
      intent_count: number;
      event_count: number;
      evidence_count: number;
      ledger_authority_count: number;
    }>(
      pool,
      `SELECT
         (SELECT pg_catalog.count(*)::integer
          FROM mainnet_financial_action_intents
          WHERE intent_id = $1::uuid) AS intent_count,
         (SELECT pg_catalog.count(*)::integer
          FROM mainnet_financial_action_events
          WHERE intent_id = $1::uuid) AS event_count,
         (SELECT pg_catalog.count(*)::integer
          FROM mainnet_financial_action_evidence_claims
          WHERE intent_id = $1::uuid) AS evidence_count,
         (SELECT pg_catalog.count(*)::integer
          FROM mainnet_financial_action_events
          WHERE intent_id = $1::uuid
            AND ledger_settlement_authority) AS ledger_authority_count`,
      [intentId],
    );
    expect(persisted).toEqual({
      intent_count: 1,
      event_count: 3,
      evidence_count: 3,
      ledger_authority_count: 0,
    });

    const fixtureDependencies = await pool.query<{
      operation_state: string;
      wallet_status: string;
    }>(
      `SELECT operation.current_state AS operation_state,
              wallet.status AS wallet_status
       FROM yield_operations AS operation
       INNER JOIN registered_wallets AS wallet
         ON wallet.account_id = operation.actor_account_id
       WHERE operation.operation_id = $1::uuid
         AND wallet.wallet_id = $2::uuid`,
      [fixture.operationId, fixture.walletId],
    );
    expect(fixtureDependencies.rows).toEqual([
      { operation_state: 'SUBMITTED', wallet_status: 'ACTIVE' },
    ]);
  });
});
