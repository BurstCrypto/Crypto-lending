import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import {
  createLedgerLifecycleTestSchemaMigrationV0008,
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
} from '../../src/infrastructure/database/migrations';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const API_ROLE = 'crypto_api_runtime';
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const LEDGER_LIFECYCLE_MIGRATIONS = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id !== '0009',
);

interface LedgerScopeFixture {
  actorAccountId: string;
  assetRevisionId: string;
  bookId: string;
  destinationAccountId: string;
  legId: string;
  sourceAccountId: string;
  transactionId: string;
}

interface PostingFixture extends LedgerScopeFixture {
  effectiveAt: Date;
  observedAt: Date;
  postToken: string;
  postings: string;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('KAN-42 lifecycle integration test requires a loopback PostgreSQL fixture');
  }
}

async function queryAsRole<Row extends QueryResultRow>(
  pool: Pool,
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(API_ROLE)}`);
    const result = await client.query<Row>(text, values as unknown[]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function provisionLedgerScope(client: PoolClient): Promise<LedgerScopeFixture> {
  const actorAccountId = randomUUID();
  const assetRevisionId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const transactionId = randomUUID();
  const legId = randomUUID();
  const book = await client.query<{ book_id: string }>(
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
  );
  const bookId = book.rows[0]?.book_id;
  if (!bookId) throw new Error('Operational ledger book was not provisioned');

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
    [assetRevisionId, randomUUID(), randomUUID(), randomBytes(32), randomUUID()],
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

  return {
    actorAccountId,
    assetRevisionId,
    bookId,
    destinationAccountId,
    legId,
    sourceAccountId,
    transactionId,
  };
}

async function provisionPostingPlan(client: PoolClient): Promise<PostingFixture> {
  const scope = await provisionLedgerScope(client);
  const postingPlanId = randomUUID();
  const effectiveAt = new Date(Date.now() - 120_000);
  const observedAt = new Date(Date.now() - 60_000);
  const postToken = randomBytes(32).toString('hex');

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO ledger_leg_posting_plans (
         posting_plan_id, leg_id, transaction_id, book_id,
         tenant_account_id, economic_event_type, reason_code
       ) VALUES ($1, $2, $3, $4, $5, 'SETTLEMENT', 'CHAIN_FINALITY_CONFIRMED')`,
      [postingPlanId, scope.legId, scope.transactionId, scope.bookId, scope.actorAccountId],
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
        scope.legId,
        scope.transactionId,
        scope.bookId,
        scope.actorAccountId,
        scope.sourceAccountId,
        scope.destinationAccountId,
        scope.assetRevisionId,
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
        scope.legId,
        scope.transactionId,
        scope.bookId,
        scope.actorAccountId,
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
        scope.legId,
        scope.transactionId,
        scope.bookId,
        scope.actorAccountId,
        scope.assetRevisionId,
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
      [
        postingPlanId,
        scope.legId,
        scope.transactionId,
        scope.bookId,
        scope.actorAccountId,
        randomUUID(),
      ],
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
        scope.legId,
        scope.transactionId,
        scope.bookId,
        scope.actorAccountId,
        randomUUID(),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return {
    ...scope,
    effectiveAt,
    observedAt,
    postToken,
    postings: JSON.stringify([
      {
        accountId: scope.sourceAccountId,
        assetRevisionId: scope.assetRevisionId,
        side: 'CREDIT',
        amountAtomic: '100',
      },
      {
        accountId: scope.destinationAccountId,
        assetRevisionId: scope.assetRevisionId,
        side: 'DEBIT',
        amountAtomic: '100',
      },
    ]),
  };
}

async function provisionReversal(
  client: PoolClient,
  posting: PostingFixture,
  originalJournalId: string,
): Promise<{ effectiveAt: Date; observedAt: Date; reverseToken: string }> {
  const reversalApprovalId = randomUUID();
  const effectiveAt = new Date(Date.now() - 30_000);
  const observedAt = new Date(Date.now() - 10_000);
  const reverseToken = randomBytes(32).toString('hex');

  await client.query('BEGIN');
  try {
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
        randomUUID(),
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

  return { effectiveAt, observedAt, reverseToken };
}

const lifecycleSteps = [
  [null, 'CREATED', 'INTENT_CREATED'],
  ['CREATED', 'QUOTED', 'QUOTE_CREATED'],
  ['QUOTED', 'USER_APPROVED', 'USER_APPROVAL_RECORDED'],
  ['USER_APPROVED', 'SUBMITTED', 'SUBMISSION_RECORDED'],
] as const;

async function advanceLifecycle(
  pool: Pool,
  fixture: LedgerScopeFixture,
  target: 'TRANSACTION' | 'LEG',
  throughPending = false,
): Promise<void> {
  for (const [expectedState, nextState, reason] of lifecycleSteps) {
    if (target === 'TRANSACTION') {
      await queryAsRole(
        pool,
        `SELECT transition_ledger_transaction_state(
           $1, $2, $3, $4, $5, $6, $7
         ) AS event_id`,
        [
          fixture.actorAccountId,
          fixture.transactionId,
          expectedState,
          nextState,
          reason,
          new Date(Date.now() - 1_000),
          randomUUID(),
        ],
      );
    } else {
      await queryAsRole(
        pool,
        `SELECT transition_ledger_leg_state(
           $1, $2, $3, $4, $5, $6, $7, $8
         ) AS event_id`,
        [
          fixture.actorAccountId,
          fixture.transactionId,
          fixture.legId,
          expectedState,
          nextState,
          reason,
          new Date(Date.now() - 1_000),
          randomUUID(),
        ],
      );
    }
  }
  if (!throughPending) return;

  const args = [
    fixture.actorAccountId,
    fixture.transactionId,
    ...(target === 'LEG' ? [fixture.legId] : []),
    'SUBMITTED',
    'PENDING',
    'OUTCOME_PENDING',
    new Date(Date.now() - 1_000),
    randomUUID(),
  ];
  await queryAsRole(
    pool,
    target === 'LEG'
      ? `SELECT transition_ledger_leg_state(
           $1, $2, $3, $4, $5, $6, $7, $8
         ) AS event_id`
      : `SELECT transition_ledger_transaction_state(
           $1, $2, $3, $4, $5, $6, $7
         ) AS event_id`,
    args,
  );
}

describeWithPostgres('KAN-42 ledger lifecycle PostgreSQL integration', () => {
  jest.setTimeout(90_000);

  const schema = `kan42_${randomUUID().replaceAll('-', '')}`;
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
    runner = new MigrationRunner(ledgerPool, LEDGER_LIFECYCLE_MIGRATIONS);
    await expect(runner.up()).resolves.toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0006',
      '0007',
      '0008',
    ]);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(API_ROLE)}`,
    );
  });

  afterAll(async () => {
    if (ledgerPool) await ledgerPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('verifies the cumulative lifecycle catalog and immutable rule registries', async () => {
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    await expect(
      ledgerPool.query(createLedgerLifecycleTestSchemaMigrationV0008.verifySql!),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::int FROM ledger_lifecycle_transition_rules) AS lifecycle_rules,
           (SELECT count(*)::int FROM ledger_recovery_transition_rules) AS recovery_rules`,
      ),
    ).resolves.toMatchObject({ rows: [{ lifecycle_rules: 32, recovery_rules: 4 }] });
  });

  it('enforces compare-current transitions without appending on rejection', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionLedgerScope(client);
    client.release();

    const created = await queryAsRole<{ event_id: string }>(
      ledgerPool,
      `SELECT transition_ledger_transaction_state(
         $1, $2, NULL, 'CREATED', 'INTENT_CREATED', $3, $4
       ) AS event_id`,
      [fixture.actorAccountId, fixture.transactionId, new Date(), randomUUID()],
    );
    expect(created.rows[0]?.event_id).toMatch(/^[0-9a-f-]{36}$/u);

    await expect(
      queryAsRole(
        ledgerPool,
        `SELECT transition_ledger_transaction_state(
           $1, $2, 'QUOTED', 'USER_APPROVED',
           'USER_APPROVAL_RECORDED', $3, $4
         )`,
        [fixture.actorAccountId, fixture.transactionId, new Date(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: 'L4201' });

    await expect(
      ledgerPool.query(
        `SELECT event_sequence, previous_state, next_state
         FROM ledger_transaction_lifecycle_events
         WHERE transaction_id = $1`,
        [fixture.transactionId],
      ),
    ).resolves.toMatchObject({
      rows: [{ event_sequence: '1', previous_state: null, next_state: 'CREATED' }],
    });

    await expect(
      queryAsRole(
        ledgerPool,
        `SELECT transition_ledger_recovery_state(
           $1, $2, $3, 'NOT_REQUIRED', 'REQUIRED',
           'RECOVERY_REQUIRED', $4, $5
         ) AS event_id`,
        [fixture.actorAccountId, fixture.transactionId, fixture.legId, new Date(), randomUUID()],
      ),
    ).resolves.toMatchObject({ rows: [{ event_id: expect.any(String) }] });
  });

  it('serializes concurrent compare-current commands to one appended transition', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionLedgerScope(client);
    client.release();
    await advanceLifecycle(ledgerPool, fixture, 'LEG');

    const commands = [randomUUID(), randomUUID()].map((correlationId) =>
      queryAsRole(
        ledgerPool,
        `SELECT transition_ledger_leg_state(
           $1, $2, $3, 'SUBMITTED', 'PENDING',
           'OUTCOME_PENDING', $4, $5
         ) AS event_id`,
        [fixture.actorAccountId, fixture.transactionId, fixture.legId, new Date(), correlationId],
      ),
    );
    const results = await Promise.allSettled(commands);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'L4201' } });

    await expect(
      ledgerPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM ledger_leg_lifecycle_events
         WHERE leg_id = $1`,
        [fixture.legId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '5' }] });
  });

  it.each([false, true])(
    'posts and settles atomically from %s pending state',
    async (throughPending) => {
      const client = await ledgerPool.connect();
      const fixture = await provisionPostingPlan(client);
      client.release();
      await advanceLifecycle(ledgerPool, fixture, 'LEG', throughPending);

      const result = await queryAsRole<{ journal_id: string }>(
        ledgerPool,
        `SELECT post_ledger_journal_with_lifecycle(
           $1, $2, $3, $4, 'SETTLEMENT', $5, $6,
           'CHAIN_FINALITY_CONFIRMED', $7, $8
         ) AS journal_id`,
        [
          fixture.postToken,
          fixture.bookId,
          fixture.transactionId,
          fixture.legId,
          fixture.effectiveAt,
          fixture.observedAt,
          randomUUID(),
          fixture.postings,
        ],
      );
      const journalId = result.rows[0]?.journal_id;
      expect(journalId).toMatch(/^[0-9a-f-]{36}$/u);
      await expect(
        ledgerPool.query(
          `SELECT previous_state, next_state, reason_code, journal_id
           FROM ledger_leg_lifecycle_events
           WHERE leg_id = $1
           ORDER BY event_sequence DESC
           LIMIT 1`,
          [fixture.legId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            previous_state: throughPending ? 'PENDING' : 'SUBMITTED',
            next_state: 'SETTLED',
            reason_code: 'SETTLEMENT_RECORDED',
            journal_id: journalId,
          },
        ],
      });
    },
  );

  it('rolls journal effects back when the associated lifecycle transition is unavailable', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();

    await expect(
      queryAsRole(
        ledgerPool,
        `SELECT post_ledger_journal_with_lifecycle(
           $1, $2, $3, $4, 'SETTLEMENT', $5, $6,
           'CHAIN_FINALITY_CONFIRMED', $7, $8
         )`,
        [
          fixture.postToken,
          fixture.bookId,
          fixture.transactionId,
          fixture.legId,
          fixture.effectiveAt,
          fixture.observedAt,
          randomUUID(),
          fixture.postings,
        ],
      ),
    ).rejects.toMatchObject({ code: 'L4201' });

    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::int FROM ledger_journals
            WHERE leg_id = $1) AS journals,
           (SELECT count(*)::int FROM ledger_command_capability_resolutions
            WHERE outcome = 'CONSUMED'
              AND capability_id IN (
                SELECT capability_id FROM ledger_command_capabilities WHERE leg_id = $1
              )) AS resolutions`,
        [fixture.legId],
      ),
    ).resolves.toMatchObject({ rows: [{ journals: 0, resolutions: 0 }] });
  });

  it('records an exact reversal journal and lifecycle event in one call', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();
    await advanceLifecycle(ledgerPool, fixture, 'TRANSACTION');
    await advanceLifecycle(ledgerPool, fixture, 'LEG');

    const posted = await queryAsRole<{ journal_id: string }>(
      ledgerPool,
      `SELECT post_ledger_journal_with_lifecycle(
         $1, $2, $3, $4, 'SETTLEMENT', $5, $6,
         'CHAIN_FINALITY_CONFIRMED', $7, $8
       ) AS journal_id`,
      [
        fixture.postToken,
        fixture.bookId,
        fixture.transactionId,
        fixture.legId,
        fixture.effectiveAt,
        fixture.observedAt,
        randomUUID(),
        fixture.postings,
      ],
    );
    const originalJournalId = posted.rows[0]?.journal_id;
    if (!originalJournalId) throw new Error('Posting wrapper did not return a journal');

    await queryAsRole(
      ledgerPool,
      `SELECT transition_ledger_transaction_state(
         $1, $2, 'SUBMITTED', 'SETTLED',
         'SETTLEMENT_RECORDED', $3, $4
       )`,
      [fixture.actorAccountId, fixture.transactionId, fixture.effectiveAt, randomUUID()],
    );

    const reversalClient = await ledgerPool.connect();
    const reversal = await provisionReversal(reversalClient, fixture, originalJournalId);
    reversalClient.release();
    const reversed = await queryAsRole<{ journal_id: string }>(
      ledgerPool,
      `SELECT reverse_ledger_journal_with_lifecycle(
         $1, $2, 'CHAIN_REORGANIZATION_CONFIRMED', $3, $4, $5
       ) AS journal_id`,
      [
        reversal.reverseToken,
        originalJournalId,
        reversal.effectiveAt,
        reversal.observedAt,
        randomUUID(),
      ],
    );
    const reversalJournalId = reversed.rows[0]?.journal_id;
    expect(reversalJournalId).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(
      ledgerPool.query(
        `SELECT event.previous_state, event.next_state, event.journal_id,
                journal.reverses_journal_id
         FROM ledger_leg_lifecycle_events AS event
         INNER JOIN ledger_journals AS journal ON journal.journal_id = event.journal_id
         WHERE event.leg_id = $1
         ORDER BY event.event_sequence DESC
         LIMIT 1`,
        [fixture.legId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          previous_state: 'SETTLED',
          next_state: 'REVERSED',
          journal_id: reversalJournalId,
          reverses_journal_id: originalJournalId,
        },
      ],
    });
    await expect(
      queryAsRole(
        ledgerPool,
        `SELECT transition_ledger_transaction_state(
           $1, $2, 'SETTLED', 'REVERSED',
           'FULL_REVERSAL_RECORDED', $3, $4
         )`,
        [fixture.actorAccountId, fixture.transactionId, reversal.effectiveAt, randomUUID()],
      ),
    ).resolves.toBeDefined();
  });

  it('refuses rollback after this test appends lifecycle history', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionLedgerScope(client);
    client.release();
    await queryAsRole(
      ledgerPool,
      `SELECT transition_ledger_transaction_state(
         $1, $2, NULL, 'CREATED', 'INTENT_CREATED', $3, $4
       )`,
      [fixture.actorAccountId, fixture.transactionId, new Date(), randomUUID()],
    );

    await expect(runner.down(1)).rejects.toMatchObject({ code: '55000' });
    await expect(
      ledgerPool.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = '0008'"),
    ).resolves.toMatchObject({ rows: [{ id: '0008' }] });
  });
});
