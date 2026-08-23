import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import {
  createImmutableLedgerTestSchemaMigrationV0007,
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
} from '../../src/infrastructure/database/migrations';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const API_ROLE = 'crypto_api_runtime';
const WORKER_ROLE = 'crypto_worker_runtime';
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const IMMUTABLE_LEDGER_MIGRATIONS = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id !== '0008' && id !== '0009' && id !== '0010' && id !== '0011',
);

interface PostingFixture {
  actorAccountId: string;
  assetRevisionId: string;
  bookId: string;
  destinationAccountId: string;
  effectiveAt: Date;
  eventType: 'SETTLEMENT';
  legId: string;
  observedAt: Date;
  postings: string;
  postToken: string;
  reasonCode: 'CHAIN_FINALITY_CONFIRMED';
  sourceAccountId: string;
  transactionId: string;
}

interface ReversalFixture {
  effectiveAt: Date;
  observedAt: Date;
  reasonCode: 'CHAIN_REORGANIZATION_CONFIRMED';
  reverseToken: string;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('KAN-41 ledger integration test requires a loopback PostgreSQL fixture');
  }
}

async function queryAsRole<Row extends QueryResultRow>(
  pool: Pool,
  role: string,
  text: string,
  values: readonly unknown[] = [],
  finish: 'COMMIT' | 'ROLLBACK' = 'COMMIT',
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    const result = await client.query<Row>(text, values as unknown[]);
    await client.query(finish);
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function provisionPostingPlan(client: PoolClient): Promise<PostingFixture> {
  const actorAccountId = randomUUID();
  const assetRevisionId = randomUUID();
  const assetId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const transactionId = randomUUID();
  const legId = randomUUID();
  const postingPlanId = randomUUID();
  const approvalReferenceId = randomUUID();
  const effectiveAt = new Date(Date.now() - 120_000);
  const observedAt = new Date(Date.now() - 60_000);
  const postToken = randomBytes(32).toString('hex');
  const book = await client.query<{ book_id: string }>(
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
  );
  const bookId = book.rows[0]?.book_id;
  if (!bookId) throw new Error('Operational ledger book was not provisioned');

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO accounts (account_id, eligibility_status)
       VALUES ($1::uuid, 'UNKNOWN')`,
      [actorAccountId],
    );
    await client.query(
      `INSERT INTO ledger_assets (
         asset_revision_id, asset_id, definition_revision,
         network_reference_id, asset_kind, settlement_identity_digest,
         base_unit_decimals, metadata_source_reference_id
       ) VALUES ($1, $2, 1, $3, 'NATIVE', $4, 6, $5)`,
      [assetRevisionId, assetId, randomUUID(), randomBytes(32), randomUUID()],
    );
    await client.query(
      `INSERT INTO ledger_accounts (
         ledger_account_id, book_id, asset_revision_id, owner_kind,
         owner_account_id, location_kind, location_reference_id, account_role
       ) VALUES
         ($1, $3, $4, 'ACCOUNT', $5, 'WALLET', $6, 'POSITION'),
         ($2, $3, $4, 'ACCOUNT', $5, 'CUSTODY', $7, 'POSITION')`,
      [
        sourceAccountId,
        destinationAccountId,
        bookId,
        assetRevisionId,
        actorAccountId,
        randomUUID(),
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO ledger_transactions (
         transaction_id, tenant_account_id, book_id, intent_type,
         configuration_revision_reference_id
       ) VALUES ($1, $2, $3, 'DIRECT_SETTLEMENT', $4)`,
      [transactionId, actorAccountId, bookId, randomUUID()],
    );
    await client.query(
      `INSERT INTO ledger_legs (
         leg_id, transaction_id, book_id, tenant_account_id, leg_sequence,
         leg_kind, asset_revision_id, source_account_id,
         destination_account_id, expected_amount_atomic
       ) VALUES ($1, $2, $3, $4, 1, 'SOURCE_TRANSFER', $5, $6, $7, 100)`,
      [
        legId,
        transactionId,
        bookId,
        actorAccountId,
        assetRevisionId,
        sourceAccountId,
        destinationAccountId,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_posting_plans (
         posting_plan_id, leg_id, transaction_id, book_id,
         tenant_account_id, economic_event_type, reason_code
       ) VALUES ($1, $2, $3, $4, $5, 'SETTLEMENT', 'CHAIN_FINALITY_CONFIRMED')`,
      [postingPlanId, legId, transactionId, bookId, actorAccountId],
    );
    await client.query(
      `INSERT INTO ledger_leg_posting_plan_lines (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         plan_line_number, ledger_account_id, asset_revision_id, side, amount_atomic
       ) VALUES
         ($1, $2, $3, $4, $5, 1, $6, $8, 'CREDIT', 100),
         ($1, $2, $3, $4, $5, 2, $7, $8, 'DEBIT', 100)`,
      [
        postingPlanId,
        legId,
        transactionId,
        bookId,
        actorAccountId,
        sourceAccountId,
        destinationAccountId,
        assetRevisionId,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_recognition_evidence (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         reference_type, environment, namespace_type, source_reference_id,
         canonical_locator_reference_id, external_locator_digest,
         recognition_policy_reference_id, recognition_evidence_revision_reference_id,
         effective_at, observed_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'FINALITY_EVIDENCE', 'TEST', 'EVIDENCE',
         $6, $7, $8, $9, $10, $11, $12
       )`,
      [
        postingPlanId,
        legId,
        transactionId,
        bookId,
        actorAccountId,
        randomUUID(),
        randomUUID(),
        randomBytes(32),
        randomUUID(),
        randomUUID(),
        effectiveAt,
        observedAt,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_valuation_plans (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         valuation_plan_line_number, valuation_role, asset_revision_id,
         availability, valued_amount_atomic, rounding_mode,
         source_reference_id, source_policy_reference_id, evidence_reference_id,
         observed_at, freshness_class, confidence_class, depeg_class
       ) VALUES (
         $1, $2, $3, $4, $5, 1, 'JOURNAL_ASSET_TOTAL', $6,
         'UNAVAILABLE', 100, 'ROUND_HALF_EVEN', $7, $8, $9,
         $10, 'UNAVAILABLE', 'UNAVAILABLE', 'NOT_ASSESSED'
       )`,
      [
        postingPlanId,
        legId,
        transactionId,
        bookId,
        actorAccountId,
        assetRevisionId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        observedAt,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_posting_plan_seals (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         economic_event_type, sealed_plan_digest, approval_reference_id
       ) SELECT $1, $2, $3, $4, $5, 'SETTLEMENT',
                compute_ledger_posting_plan_digest($1), $6`,
      [postingPlanId, legId, transactionId, bookId, actorAccountId, approvalReferenceId],
    );
    await client.query(
      `INSERT INTO ledger_command_capabilities (
         capability_id, capability_purpose, capability_scheme, token_encoding,
         hash_algorithm, hash_domain, capability_digest, target_digest,
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         issued_to_account_id, issuance_source_reference_id,
         approval_reference_id, expires_at
       ) SELECT
         $1, 'POST', 'BEARER_256_V1', 'LOWER_HEX_32', 'SHA256', 'KAN41:POST:v1',
         pg_catalog.sha256(
           pg_catalog.convert_to('KAN41:POST:v1', 'UTF8') || pg_catalog.decode($2, 'hex')
         ), seal.sealed_plan_digest, $3, $4, $5, $6, $7, $7, $8,
         seal.approval_reference_id, clock_timestamp() + interval '1 hour'
       FROM ledger_leg_posting_plan_seals AS seal
       WHERE seal.posting_plan_id = $3`,
      [
        randomUUID(),
        postToken,
        postingPlanId,
        legId,
        transactionId,
        bookId,
        actorAccountId,
        randomUUID(),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return {
    actorAccountId,
    assetRevisionId,
    bookId,
    destinationAccountId,
    effectiveAt,
    eventType: 'SETTLEMENT',
    legId,
    observedAt,
    postings: JSON.stringify([
      {
        accountId: sourceAccountId,
        assetRevisionId,
        side: 'CREDIT',
        amountAtomic: '100',
      },
      {
        accountId: destinationAccountId,
        assetRevisionId,
        side: 'DEBIT',
        amountAtomic: '100',
      },
    ]),
    postToken,
    reasonCode: 'CHAIN_FINALITY_CONFIRMED',
    sourceAccountId,
    transactionId,
  };
}

async function provisionReversal(
  client: PoolClient,
  posting: PostingFixture,
  originalJournalId: string,
): Promise<ReversalFixture> {
  const reversalApprovalId = randomUUID();
  const approvalReferenceId = randomUUID();
  const effectiveAt = new Date(Date.now() - 30_000);
  const observedAt = new Date(Date.now() - 10_000);
  const reverseToken = randomBytes(32).toString('hex');

  await client.query('BEGIN');
  try {
    // KAN-42 owns the privileged approval-provisioning command. This owner-only
    // fixture computes the same sealed digest while leaving the runtime API boundary untouched.
    await client.query(`
      ALTER TABLE ledger_reversal_approvals
        DISABLE TRIGGER ledger_reversal_approvals_append_only_row_trigger;
      ALTER TABLE ledger_reversal_approvals
        DISABLE TRIGGER ledger_reversal_approvals_integrity_trigger
    `);
    await client.query(
      `INSERT INTO ledger_reversal_approvals (
         reversal_approval_id, original_journal_id, transaction_id, leg_id,
         book_id, tenant_account_id, reason_code, approval_reference_id,
         evidence_reference_id, reference_type, environment, namespace_type,
         source_reference_id, canonical_locator_reference_id,
         external_locator_digest, effective_at, observed_at,
         sealed_approval_digest
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'CHAIN_REORGANIZATION_CONFIRMED', $7,
         $8, 'CHAIN_EVENT', 'TEST', 'CHAIN', $9, $10, $11, $12, $13,
         pg_catalog.decode(repeat('00', 32), 'hex')
       )`,
      [
        reversalApprovalId,
        originalJournalId,
        posting.transactionId,
        posting.legId,
        posting.bookId,
        posting.actorAccountId,
        approvalReferenceId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomBytes(32),
        effectiveAt,
        observedAt,
      ],
    );
    await client.query(
      `UPDATE ledger_reversal_approvals
       SET sealed_approval_digest = compute_ledger_reversal_approval_digest($1)
       WHERE reversal_approval_id = $1`,
      [reversalApprovalId],
    );
    await client.query(`
      ALTER TABLE ledger_reversal_approvals
        ENABLE ALWAYS TRIGGER ledger_reversal_approvals_append_only_row_trigger;
      ALTER TABLE ledger_reversal_approvals
        ENABLE ALWAYS TRIGGER ledger_reversal_approvals_integrity_trigger
    `);
    await client.query(
      `INSERT INTO ledger_command_capabilities (
         capability_id, capability_purpose, capability_scheme, token_encoding,
         hash_algorithm, hash_domain, capability_digest, target_digest,
         reversal_approval_id, original_journal_id, leg_id, transaction_id,
         book_id, tenant_account_id, issued_to_account_id,
         issuance_source_reference_id, approval_reference_id, expires_at
       ) SELECT
         $1, 'REVERSE', 'BEARER_256_V1', 'LOWER_HEX_32', 'SHA256',
         'KAN41:REVERSE:v1',
         pg_catalog.sha256(
           pg_catalog.convert_to('KAN41:REVERSE:v1', 'UTF8') || pg_catalog.decode($2, 'hex')
         ), approval.sealed_approval_digest, approval.reversal_approval_id,
         approval.original_journal_id, approval.leg_id, approval.transaction_id,
         approval.book_id, approval.tenant_account_id, approval.tenant_account_id,
         $3, approval.approval_reference_id, clock_timestamp() + interval '1 hour'
       FROM ledger_reversal_approvals AS approval
       WHERE approval.reversal_approval_id = $4`,
      [randomUUID(), reverseToken, randomUUID(), reversalApprovalId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return {
    effectiveAt,
    observedAt,
    reasonCode: 'CHAIN_REORGANIZATION_CONFIRMED',
    reverseToken,
  };
}

describeWithPostgres('KAN-41 immutable ledger PostgreSQL integration', () => {
  jest.setTimeout(60_000);

  const schema = `kan41_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let ledgerPool: Pool;
  let runner: MigrationRunner;

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
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
    ledgerPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 6,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(ledgerPool, IMMUTABLE_LEDGER_MIGRATIONS);
    await expect(runner.up()).resolves.toEqual(['0001', '0002', '0003', '0004', '0006', '0007']);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(API_ROLE)}, ${quoteIdentifier(WORKER_ROLE)}`,
    );
  });

  afterAll(async () => {
    if (ledgerPool) await ledgerPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('verifies the exact catalog and rejects catalog, ACL, and namespace drift', async () => {
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    const verifySql = createImmutableLedgerTestSchemaMigrationV0007.verifySql!;
    const mutations = [
      `CREATE TABLE kan41_counterfeit_book () INHERITS (ledger_books)`,
      `CREATE RULE kan41_shadow_insert AS ON INSERT TO ledger_books DO ALSO NOTHING`,
      `ALTER FUNCTION compute_ledger_posting_plan_digest(uuid) COST 101`,
      `ALTER TABLE ledger_books
         DISABLE TRIGGER ledger_books_append_only_row_trigger`,
      `DO $mutation$
       DECLARE
         internal_trigger_name text;
       BEGIN
         SELECT trigger_state.tgname
         INTO STRICT internal_trigger_name
         FROM pg_catalog.pg_trigger AS trigger_state
         INNER JOIN pg_catalog.pg_constraint AS constraint_state
           ON constraint_state.oid = trigger_state.tgconstraint
         WHERE constraint_state.conname = 'ledger_accounts_book_fk'
           AND trigger_state.tgrelid = to_regclass('ledger_accounts')
           AND trigger_state.tgisinternal
         ORDER BY trigger_state.tgtype
         LIMIT 1;
         EXECUTE pg_catalog.format(
           'ALTER TABLE ledger_accounts DISABLE TRIGGER %I', internal_trigger_name
         );
       END
       $mutation$`,
      `ALTER TABLE ledger_books DROP CONSTRAINT ledger_books_purpose_check`,
      `DROP INDEX ledger_journals_transaction_timeline_idx`,
      `GRANT SELECT (book_id) ON ledger_books TO ${quoteIdentifier(API_ROLE)}`,
      `GRANT EXECUTE ON FUNCTION compute_ledger_posting_plan_digest(uuid)
         TO ${quoteIdentifier(API_ROLE)}`,
      `CREATE TABLE kan41_external_book_reference (
         book_id uuid PRIMARY KEY REFERENCES ledger_books(book_id)
       )`,
      `CREATE SCHEMA "__schema__"`,
    ];

    const client = await ledgerPool.connect();
    try {
      for (const mutation of mutations) {
        await client.query('BEGIN');
        try {
          await client.query(mutation);
          await expect(client.query<{ valid: boolean }>(verifySql)).resolves.toMatchObject({
            rows: [{ valid: false }],
          });
        } finally {
          await client.query('ROLLBACK');
        }
      }
    } finally {
      client.release();
    }
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });

  it('exposes only one-time POST and exact REVERSE capabilities to the API role', async () => {
    await expect(
      queryAsRole(ledgerPool, API_ROLE, 'SELECT * FROM ledger_journals'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      queryAsRole(ledgerPool, API_ROLE, 'SELECT compute_ledger_posting_plan_digest($1::uuid)', [
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '42501' });

    const owner = await ledgerPool.connect();
    let posting: PostingFixture;
    try {
      posting = await provisionPostingPlan(owner);
    } finally {
      owner.release();
    }
    const post = (
      correlationId: string,
      token = posting.postToken,
      postings = posting.postings,
      finish: 'COMMIT' | 'ROLLBACK' = 'COMMIT',
    ): Promise<QueryResult<{ journal_id: string }>> =>
      queryAsRole<{ journal_id: string }>(
        ledgerPool,
        API_ROLE,
        `SELECT post_ledger_journal(
           $1::text, $2::uuid, $3::uuid, $4::uuid, $5::text,
           $6::timestamptz, $7::timestamptz, $8::text, $9::uuid, $10::text
         ) AS journal_id`,
        [
          token,
          posting.bookId,
          posting.transactionId,
          posting.legId,
          posting.eventType,
          posting.effectiveAt,
          posting.observedAt,
          posting.reasonCode,
          correlationId,
          postings,
        ],
        finish,
      );

    const wrongToken = `${posting.postToken.slice(0, -1)}${posting.postToken.endsWith('0') ? '1' : '0'}`;
    await expect(post(randomUUID(), wrongToken)).rejects.toMatchObject({ code: '42501' });
    const tamperedPostings = JSON.stringify([
      {
        accountId: posting.sourceAccountId,
        assetRevisionId: posting.assetRevisionId,
        side: 'CREDIT',
        amountAtomic: '100',
      },
      {
        accountId: posting.destinationAccountId,
        assetRevisionId: posting.assetRevisionId,
        side: 'DEBIT',
        amountAtomic: '99',
      },
    ]);
    await expect(post(randomUUID(), posting.postToken, tamperedPostings)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      queryAsRole(
        ledgerPool,
        API_ROLE,
        `SELECT reverse_ledger_journal(
           $1::text, $2::uuid, $3::text, $4::timestamptz,
           $5::timestamptz, $6::uuid
         )`,
        [
          posting.postToken,
          randomUUID(),
          'CHAIN_REORGANIZATION_CONFIRMED',
          posting.effectiveAt,
          posting.observedAt,
          randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const rolledBackPost = await post(
      randomUUID(),
      posting.postToken,
      posting.postings,
      'ROLLBACK',
    );
    expect(rolledBackPost.rows[0]?.journal_id).toBeDefined();
    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::integer FROM ledger_journals) AS journals,
           (SELECT count(*)::integer FROM ledger_command_capability_resolutions) AS resolutions`,
      ),
    ).resolves.toMatchObject({ rows: [{ journals: 0, resolutions: 0 }] });

    const attempts = await Promise.allSettled([post(randomUUID()), post(randomUUID())]);
    const successes = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<QueryResult<{ journal_id: string }>> =>
        attempt.status === 'fulfilled',
    );
    const failures = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
    );
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toMatchObject({ code: '42501' });
    const originalJournalId = successes[0]?.value.rows[0]?.journal_id;
    expect(originalJournalId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    await expect(post(randomUUID())).rejects.toMatchObject({ code: '42501' });

    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::integer FROM ledger_journals) AS journals,
           (SELECT count(*)::integer FROM ledger_journal_lines) AS lines,
           (SELECT count(*)::integer FROM ledger_external_evidence) AS evidence,
           (SELECT count(*)::integer FROM ledger_valuation_snapshots) AS valuations,
           (SELECT count(*)::integer FROM ledger_command_capability_resolutions) AS resolutions`,
      ),
    ).resolves.toMatchObject({
      rows: [{ journals: 1, lines: 2, evidence: 1, valuations: 1, resolutions: 1 }],
    });

    const reversalOwner = await ledgerPool.connect();
    let reversal: ReversalFixture;
    try {
      reversal = await provisionReversal(reversalOwner, posting, originalJournalId as string);
    } finally {
      reversalOwner.release();
    }
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    const reverse = (correlationId: string): Promise<QueryResult<{ journal_id: string }>> =>
      queryAsRole<{ journal_id: string }>(
        ledgerPool,
        API_ROLE,
        `SELECT reverse_ledger_journal(
           $1::text, $2::uuid, $3::text, $4::timestamptz,
           $5::timestamptz, $6::uuid
         ) AS journal_id`,
        [
          reversal.reverseToken,
          originalJournalId,
          reversal.reasonCode,
          reversal.effectiveAt,
          reversal.observedAt,
          correlationId,
        ],
      );
    const reversed = await reverse(randomUUID());
    const reversalJournalId = reversed.rows[0]?.journal_id;
    expect(reversalJournalId).toBeDefined();
    await expect(reverse(randomUUID())).rejects.toMatchObject({ code: '42501' });

    const exactOpposite = await ledgerPool.query<{
      amount_matches: boolean;
      original_side: string;
      reversal_side: string;
    }>(
      `SELECT original.side AS original_side,
              reversal.side AS reversal_side,
              original.amount_atomic = reversal.amount_atomic AS amount_matches
       FROM ledger_journal_lines AS original
       INNER JOIN ledger_journal_lines AS reversal
         ON reversal.line_number = original.line_number
       WHERE original.journal_id = $1
         AND reversal.journal_id = $2
       ORDER BY original.line_number`,
      [originalJournalId, reversalJournalId],
    );
    expect(exactOpposite.rows).toEqual([
      { original_side: 'CREDIT', reversal_side: 'DEBIT', amount_matches: true },
      { original_side: 'DEBIT', reversal_side: 'CREDIT', amount_matches: true },
    ]);
    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::integer FROM ledger_journals) AS journals,
           (SELECT count(*)::integer FROM ledger_journal_lines) AS lines,
           (SELECT count(*)::integer FROM ledger_external_evidence) AS evidence,
           (SELECT count(*)::integer FROM ledger_valuation_snapshots) AS valuations,
           (SELECT count(*)::integer FROM ledger_command_capability_resolutions) AS resolutions`,
      ),
    ).resolves.toMatchObject({
      rows: [{ journals: 2, lines: 4, evidence: 2, valuations: 2, resolutions: 2 }],
    });
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });

  it('refuses rollback once immutable financial facts exist', async () => {
    const owner = await ledgerPool.connect();
    let posting: PostingFixture;
    try {
      posting = await provisionPostingPlan(owner);
    } finally {
      owner.release();
    }
    await queryAsRole(
      ledgerPool,
      API_ROLE,
      `SELECT post_ledger_journal(
         $1::text, $2::uuid, $3::uuid, $4::uuid, $5::text,
         $6::timestamptz, $7::timestamptz, $8::text, $9::uuid, $10::text
       )`,
      [
        posting.postToken,
        posting.bookId,
        posting.transactionId,
        posting.legId,
        posting.eventType,
        posting.effectiveAt,
        posting.observedAt,
        posting.reasonCode,
        randomUUID(),
        posting.postings,
      ],
    );
    await expect(runner.down(1)).rejects.toMatchObject({ code: '55000' });
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    await expect(
      ledgerPool.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = '0007'"),
    ).resolves.toMatchObject({ rows: [{ id: '0007' }] });
  });
});
