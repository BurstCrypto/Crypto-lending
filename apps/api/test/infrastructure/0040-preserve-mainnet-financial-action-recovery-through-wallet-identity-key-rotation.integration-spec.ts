import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../src/blockchain/domain/supported-asset-registry';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039 } from '../../src/infrastructure/database/migrations/0039-persist-verified-mainnet-signed-submission-proof.migration';
import { createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040 } from '../../src/infrastructure/database/migrations/0040-preserve-mainnet-financial-action-recovery-through-wallet-identity-key-rotation.migration';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const MIGRATIONS_THROUGH_0039 = [
  ...DATABASE_TEST_SCHEMA_MIGRATION_LIST,
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
const VERIFIED_BIND_SQL = `SELECT *
  FROM bind_verified_mainnet_financial_action_submission_v2(
    $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text,
    $8::uuid, $9::smallint, $10::text, $11::text, $12::text, $13::text,
    $14::text, $15::text, $16::numeric, $17::text
  )`;

type Queryable = Pick<PoolClient, 'query'>;

interface PreparedAction {
  accountId: string;
  intentId: string;
  walletId: string;
  preparedRevision: string;
  preparedSnapshot: string;
  transactionId: string;
}

interface LifecycleRow extends QueryResultRow {
  lifecycle_revision: string;
  current_snapshot_sha256: string;
}

interface YieldFixture {
  accountId: string;
  correlationId: string;
  ledgerBookId: string;
  ledgerTransactionId: string;
  operationId: string;
  planReferenceId: string;
  quoteReferenceId: string;
  submissionId: string;
  walletId: string;
}

interface RecoveryRow extends QueryResultRow {
  recovery_outcome: string;
  ready_lifecycle_revision: string;
  ready_lifecycle_stage: string;
  ready_active_write_version: number;
  ready_recovery_fingerprint_sha256: string;
}

interface ConstraintCatalogRow extends QueryResultRow {
  row_count: string;
  catalog_sha256: string;
}

interface ReadinessTriggerRow extends QueryResultRow {
  definition_sha256: string;
  trigger_type: number;
  enabled: string;
  deferrable: boolean;
  initially_deferred: boolean;
  has_qualifier: boolean;
}

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
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

async function registerEthereumWallet(
  queryable: Queryable,
  accountId: string,
  addressDigestHex: string,
): Promise<string> {
  const challengeId = randomUUID();
  const walletId = randomUUID();
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const addressDigest = Buffer.from(addressDigestHex, 'hex');
  await queryable.query(
    `INSERT INTO wallet_ownership_challenges (
       challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest, domain_digest_version, domain_digest,
       message_digest_version, message_digest, nonce_digest_version, nonce_digest,
       status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
     ) VALUES (
       $1, $2, 'EVM_ERC4361_ERC191', 'eip155', '1', 'MAINNET', $3, $4,
       1, $5, 1, $6, 1, $7, 1, $8, 'REGISTERED',
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
      addressDigest,
      randomBytes(32),
      randomBytes(32),
      randomBytes(32),
    ],
  );
  await queryable.query(
    `INSERT INTO wallet_ownership_challenge_identity_digests (
       challenge_id, account_id, chain_namespace, chain_reference,
       address_digest_version, address_digest
     ) VALUES ($1, $2, 'eip155', '1', 1, $3)`,
    [challengeId, accountId, addressDigest],
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
       $1, $2, $3, 'eip155', '1', 'MAINNET', $4, $5, 1, $6,
       1, $7, $8, $9, 1, $10, $11, $12
     )`,
    [
      walletId,
      accountId,
      challengeId,
      registry.version,
      registry.fingerprintSha256,
      addressDigest,
      Buffer.from('rotation-recovery-address'),
      randomBytes(12),
      randomBytes(16),
      Buffer.from('rotation-recovery-metadata'),
      randomBytes(12),
      randomBytes(16),
    ],
  );
  return walletId;
}

async function transitionYieldOperation(
  queryable: Queryable,
  fixture: Omit<YieldFixture, 'submissionId'>,
  expectedState: string,
  nextState: string,
  reason: string,
  effectiveAt: Date,
): Promise<{ submission_id: string | null }> {
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

async function provisionSubmittedYieldFixture(pool: Pool): Promise<YieldFixture> {
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
  const addressDigestHex = fingerprint('historical-' + randomUUID());
  const walletId = await registerEthereumWallet(pool, accountId, addressDigestHex);
  const fixture = {
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
      fixture.accountId,
      fixture.operationId,
      fixture.ledgerTransactionId,
      fixture.planReferenceId,
      fixture.quoteReferenceId,
      at(0),
      fixture.correlationId,
      fingerprint(),
      fingerprint(),
    ],
  );
  await transitionYieldOperation(pool, fixture, 'CREATED', 'QUOTED', 'QUOTE_CREATED', at(1_000));
  await transitionYieldOperation(
    pool,
    fixture,
    'QUOTED',
    'USER_APPROVED',
    'USER_APPROVAL_RECORDED',
    at(2_000),
  );
  const submitted = await withForcedDeferredConstraints(pool, async (client) => {
    const row = await transitionYieldOperation(
      client,
      fixture,
      'USER_APPROVED',
      'SUBMITTED',
      'SUBMISSION_RECORDED',
      at(3_000),
    );
    if (!row.submission_id) throw new Error('Yield submission was not created');
    const transition = row as typeof row & { transition_recorded_at: Date };
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
          occurredAt: transition.transition_recorded_at.toISOString(),
          correlation: {
            correlationId: fixture.correlationId,
            initiatorActorId: fixture.accountId,
            quoteId: fixture.quoteReferenceId,
            transactionId: fixture.ledgerTransactionId,
          },
          payload: {
            submissionId: row.submission_id,
            operationId: fixture.operationId,
            operationType: 'ALLOCATE',
            ledgerTransactionId: fixture.ledgerTransactionId,
            planReferenceId: fixture.planReferenceId,
            quoteReferenceId: fixture.quoteReferenceId,
          },
        },
        { operationType: 'ALLOCATE' },
      ],
    );
    return row;
  });
  if (!submitted.submission_id) throw new Error('Yield submission was not created');
  return { ...fixture, submissionId: submitted.submission_id };
}

async function prepareAndBindAction(pool: Pool): Promise<PreparedAction> {
  const fixture = await provisionSubmittedYieldFixture(pool);
  const wallet = await requiredRow<{ address_digest_version: number; address_digest_hex: string }>(
    pool,
    `SELECT address_digest_version,
       pg_catalog.encode(address_digest, 'hex') AS address_digest_hex
     FROM registered_wallets WHERE wallet_id = $1::uuid`,
    [fixture.walletId],
  );
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const intentId = randomUUID();
  const transactionId = `0x${fingerprint()}`;
  const now = await databaseNow(pool);
  const prepared = await requiredRow<LifecycleRow>(pool, PREPARE_LIFECYCLE_SQL, [
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
    ETHEREUM,
    'aave',
    'aave-v3',
    '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    registry.version,
    registry.fingerprintSha256,
    'USDT',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
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
    [wallet.address_digest_version],
    [wallet.address_digest_hex],
  ]);
  const bound = await requiredRow<LifecycleRow>(pool, VERIFIED_BIND_SQL, [
    fixture.accountId,
    intentId,
    prepared.lifecycle_revision,
    prepared.current_snapshot_sha256,
    transactionId,
    fingerprint(),
    fingerprint(),
    randomUUID(),
    1,
    fingerprint(),
    fingerprint(),
    fingerprint(),
    fingerprint(),
    fingerprint(),
    'ECDSA_SECP256K1_EIP1559',
    '42',
    null,
  ]);
  return {
    accountId: fixture.accountId,
    intentId,
    walletId: fixture.walletId,
    preparedRevision: bound.lifecycle_revision,
    preparedSnapshot: bound.current_snapshot_sha256,
    transactionId,
  };
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error('Unsafe PostgreSQL identifier');
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
    throw new Error('Migration 0040 integration requires a loopback PostgreSQL URL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (!serverVersionNum || serverVersionNum < 160_000 || serverVersionNum >= 170_000) {
    throw new Error('Migration 0040 integration requires PostgreSQL 16');
  }
}

describeWithPostgres(
  'migration 0040 revoked-wallet rotation recovery (guarded PostgreSQL 16)',
  () => {
    jest.setTimeout(180_000);

    const schema = `test_wallet_rotation_recovery_${randomUUID().replaceAll('-', '')}`;
    let adminPool: Pool | undefined;
    let operationPool: Pool | undefined;
    let schemaCreated = false;

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
        max: 2,
        options: `-c search_path=${schema} -c statement_timeout=15000 -c lock_timeout=5000`,
      });
      await new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0039).up();
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

    it('applies, exactly verifies, and pins the empty owner-only catalog', async () => {
      if (!operationPool) throw new Error('Migration 0040 operation pool is unavailable');
      const migration =
        createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040;
      await operationPool.query(sql(migration.upSql));

      const constraintCatalog = await operationPool.query<ConstraintCatalogRow>(`
      WITH catalog_rows AS (
        SELECT constraint_record.*,
          foreign_relation.relname AS foreign_relname,
          foreign_namespace.nspname AS foreign_nspname,
          backing_index.relname AS backing_name,
          backing_namespace.nspname AS backing_nspname
        FROM pg_catalog.pg_constraint AS constraint_record
        LEFT JOIN pg_catalog.pg_class AS foreign_relation
          ON foreign_relation.oid = constraint_record.confrelid
        LEFT JOIN pg_catalog.pg_namespace AS foreign_namespace
          ON foreign_namespace.oid = foreign_relation.relnamespace
        LEFT JOIN pg_catalog.pg_class AS backing_index
          ON backing_index.oid = constraint_record.conindid
        LEFT JOIN pg_catalog.pg_namespace AS backing_namespace
          ON backing_namespace.oid = backing_index.relnamespace
        WHERE constraint_record.conrelid =
          pg_catalog.to_regclass('mainnet_financial_action_revoked_wallet_recovery_aliases')
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            conname, contype, convalidated, conislocal, coninhcount,
            connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema()),
            contypid, conparentid, connoinherit, COALESCE(conkey::text, '-'),
            COALESCE(foreign_relname, '-'),
            COALESCE((foreign_nspname = pg_catalog.current_schema())::text, '-'),
            COALESCE(confkey::text, '-'), COALESCE(backing_name, '-'),
            COALESCE((backing_nspname = pg_catalog.current_schema())::text, '-'),
            condeferrable, condeferred, confupdtype, confdeltype, confmatchtype,
            COALESCE(confdelsetcols::text, '-'), COALESCE(conpfeqop::text, '-'),
            COALESCE(conppeqop::text, '-'), COALESCE(conffeqop::text, '-'),
            COALESCE(pg_catalog.regexp_replace(
              pg_catalog.pg_get_constraintdef(oid, false), '[[:space:]]+', '', 'g'
            ), '-')
          ), E'\\n' ORDER BY conname) AS catalog_state
        FROM catalog_rows
      )
      SELECT row_count::text,
        pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(catalog_state, 'UTF8')
        ), 'hex') AS catalog_sha256
      FROM canonical
    `);
      const readinessTrigger = await operationPool.query<ReadinessTriggerRow>(`
      SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.replace(
            pg_catalog.pg_get_triggerdef(trigger_record.oid, false),
            pg_catalog.quote_ident(pg_catalog.current_schema()) || '.',
            ''
          ), 'UTF8'
        )), 'hex') AS definition_sha256,
        trigger_record.tgtype AS trigger_type,
        trigger_record.tgenabled AS enabled,
        trigger_record.tgdeferrable AS deferrable,
        trigger_record.tginitdeferred AS initially_deferred,
        trigger_record.tgqual IS NOT NULL AS has_qualifier
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = pg_catalog.to_regclass('wallet_identity_key_policy')
        AND trigger_record.tgname = 'wallet_identity_rotation_recovery_readiness'
    `);

      expect(constraintCatalog.rows).toEqual([
        {
          row_count: '12',
          catalog_sha256: '2ee772bc204dc39503e465d7aabd88106ff7fa16be3b1039aed84e8d88f918b3',
        },
      ]);
      expect(readinessTrigger.rows).toEqual([
        {
          definition_sha256: 'def13f185661eacd3e405dba62b090e79dfdd4f301d64d196eade5a460574ce6',
          trigger_type: 17,
          enabled: 'A',
          deferrable: true,
          initially_deferred: true,
          has_qualifier: true,
        },
      ]);

      await expect(operationPool.query(migration.verifySql ?? '')).resolves.toMatchObject({
        rows: [{ valid: true }],
      });
    });

    it('rejects an incomplete rotation, atomically admits audited recovery, and refuses old material', async () => {
      if (!operationPool) throw new Error('Migration 0040 operation pool is unavailable');
      const action = await prepareAndBindAction(operationPool);
      await expect(
        operationPool.query<{ revocation_outcome: string }>(
          'SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)',
          [action.accountId, action.walletId, randomUUID()],
        ),
      ).resolves.toMatchObject({ rows: [{ revocation_outcome: 'REVOKED' }] });

      const incomplete = await operationPool.connect();
      try {
        await incomplete.query('BEGIN');
        await incomplete.query(
          `ALTER TABLE wallet_identity_key_policy
             DISABLE TRIGGER wallet_identity_key_policy_immutable_row`,
        );
        await incomplete.query(
          `UPDATE wallet_identity_key_policy
           SET active_write_version = 2,
               accepted_read_versions = ARRAY[1, 2]::smallint[],
               updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
           WHERE policy_name = 'wallet-registration-identity-hmac'`,
        );
        await expect(
          incomplete.query('SET CONSTRAINTS wallet_identity_rotation_recovery_readiness IMMEDIATE'),
        ).rejects.toMatchObject({ code: '55000' });
      } finally {
        await incomplete.query('ROLLBACK').catch(() => undefined);
        incomplete.release();
      }

      const historicalDigest = await requiredRow<{ digest_hex: string }>(
        operationPool,
        `SELECT pg_catalog.encode(address_digest, 'hex') AS digest_hex
         FROM registered_wallets WHERE wallet_id = $1::uuid`,
        [action.walletId],
      );
      const activeDigestHex = fingerprint('active-v2-' + randomUUID());
      const transition = await operationPool.connect();
      let recovered: RecoveryRow;
      try {
        await transition.query('BEGIN');
        await transition.query(
          `ALTER TABLE wallet_identity_key_policy
             DISABLE TRIGGER wallet_identity_key_policy_immutable_row`,
        );
        await transition.query(
          `UPDATE wallet_identity_key_policy
           SET active_write_version = 2,
               accepted_read_versions = ARRAY[1, 2]::smallint[],
               updated_at = pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
           WHERE policy_name = 'wallet-registration-identity-hmac'`,
        );
        recovered = await requiredRow<RecoveryRow>(
          transition,
          `SELECT * FROM ensure_revoked_mainnet_action_recovery_alias_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::smallint, $7::text
           )`,
          [
            action.accountId,
            action.intentId,
            action.walletId,
            action.preparedRevision,
            action.preparedSnapshot,
            2,
            activeDigestHex,
          ],
        );
        await transition.query(
          'SET CONSTRAINTS wallet_identity_rotation_recovery_readiness IMMEDIATE',
        );
        await transition.query(
          `ALTER TABLE wallet_identity_key_policy
             ENABLE ALWAYS TRIGGER wallet_identity_key_policy_immutable_row`,
        );
        await transition.query('COMMIT');
      } catch (error) {
        await transition.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        transition.release();
      }

      expect(recovered).toMatchObject({
        recovery_outcome: 'BACKFILLED',
        ready_lifecycle_revision: '2',
        ready_lifecycle_stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
        ready_active_write_version: 2,
        ready_recovery_fingerprint_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      await expect(
        operationPool.query(
          `SELECT status, pg_catalog.encode(address_digest, 'hex') AS digest_hex
           FROM registered_wallet_identity_digests
           WHERE wallet_id = $1::uuid AND address_digest_version = 2`,
          [action.walletId],
        ),
      ).resolves.toMatchObject({
        rows: [{ status: 'REVOKED', digest_hex: activeDigestHex }],
      });
      await expect(
        operationPool.query<RecoveryRow>(
          `SELECT * FROM ensure_revoked_mainnet_action_recovery_alias_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::smallint, $7::text
           )`,
          [
            action.accountId,
            action.intentId,
            action.walletId,
            action.preparedRevision,
            action.preparedSnapshot,
            2,
            activeDigestHex,
          ],
        ),
      ).resolves.toMatchObject({
        rows: [expect.objectContaining({ recovery_outcome: 'REPLAYED' })],
      });
      await expect(
        operationPool.query(
          `SELECT * FROM ensure_revoked_mainnet_action_recovery_alias_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::smallint, $7::text
           )`,
          [
            action.accountId,
            action.intentId,
            action.walletId,
            action.preparedRevision,
            action.preparedSnapshot,
            2,
            historicalDigest.digest_hex,
          ],
        ),
      ).rejects.toMatchObject({ code: '22023' });
    });

    it('refuses down after durable recovery history exists', async () => {
      if (!operationPool) throw new Error('Migration 0040 operation pool is unavailable');
      const migration =
        createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040;
      await expect(
        operationPool.query(
          `UPDATE mainnet_financial_action_revoked_wallet_recovery_aliases
           SET recovery_fingerprint_sha256 = pg_catalog.repeat('f', 64)`,
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(operationPool.query(sql(migration.downSql))).rejects.toMatchObject({
        code: '55000',
      });
      await expect(
        operationPool.query<{ count: string }>(
          `SELECT pg_catalog.count(*)::text AS count
           FROM mainnet_financial_action_revoked_wallet_recovery_aliases`,
        ),
      ).resolves.toMatchObject({ rows: [{ count: '1' }] });
    });
  },
);
