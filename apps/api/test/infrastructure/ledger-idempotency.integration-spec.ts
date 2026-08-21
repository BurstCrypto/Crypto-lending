import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import {
  createLedgerCommandIdempotencyTestSchemaMigrationV0009,
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
} from '../../src/infrastructure/database/migrations';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const API_ROLE = 'crypto_api_runtime';
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

interface PostingFixture {
  actorAccountId: string;
  assetRevisionId: string;
  bookId: string;
  destinationAccountId: string;
  effectiveAt: Date;
  legId: string;
  observedAt: Date;
  postings: string;
  postToken: string;
  sourceAccountId: string;
  transactionId: string;
}

interface CommandResult {
  commandId: string;
  journalId: string;
  outboxId: string;
  outcome: 'CLAIMED' | 'REPLAYED';
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('KAN-43 idempotency integration test requires a loopback PostgreSQL fixture');
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

async function provisionPostingPlan(client: PoolClient): Promise<PostingFixture> {
  const actorAccountId = randomUUID();
  const assetRevisionId = randomUUID();
  const sourceAccountId = randomUUID();
  const destinationAccountId = randomUUID();
  const transactionId = randomUUID();
  const legId = randomUUID();
  const postingPlanId = randomUUID();
  const effectiveAt = new Date(Date.now() - 120_000);
  const observedAt = new Date(Date.now() - 60_000);
  const postToken = randomBytes(32).toString('hex');
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

  await client.query('BEGIN');
  try {
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
      [postingPlanId, legId, transactionId, bookId, actorAccountId, randomUUID()],
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
    legId,
    observedAt,
    postToken,
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
    sourceAccountId,
    transactionId,
  };
}

async function advanceLegToSubmitted(pool: Pool, fixture: PostingFixture): Promise<void> {
  const transitions = [
    [null, 'CREATED', 'INTENT_CREATED'],
    ['CREATED', 'QUOTED', 'QUOTE_CREATED'],
    ['QUOTED', 'USER_APPROVED', 'USER_APPROVAL_RECORDED'],
    ['USER_APPROVED', 'SUBMITTED', 'SUBMISSION_RECORDED'],
  ] as const;
  for (const [expectedState, nextState, reason] of transitions) {
    await queryAsRole(
      pool,
      `SELECT transition_ledger_leg_state(
         $1, $2, $3, $4, $5, $6, $7, $8
       )`,
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

async function executeIdempotentPost(
  pool: Pool,
  fixture: PostingFixture,
  keyDigest: string,
  requestFingerprint: string,
  completeWithWrongOutbox = false,
): Promise<CommandResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(API_ROLE)}`);
    const claimed = await client.query<{
      command_id: string;
      journal_id: string | null;
      outbox_id: string;
      outcome: 'CLAIMED' | 'REPLAYED';
    }>(
      `SELECT * FROM claim_ledger_command_idempotency(
         $1::uuid, 'POST_JOURNAL', 1::smallint, $2::text,
         1::smallint, $3::text
       )`,
      [fixture.actorAccountId, keyDigest, requestFingerprint],
    );
    const claim = claimed.rows[0];
    if (!claim) throw new Error('Idempotency claim did not return a row');

    if (claim.outcome === 'REPLAYED') {
      if (!claim.journal_id) throw new Error('Replay did not return its journal');
      await client.query('COMMIT');
      return {
        commandId: claim.command_id,
        journalId: claim.journal_id,
        outboxId: claim.outbox_id,
        outcome: claim.outcome,
      };
    }

    const posted = await client.query<{ journal_id: string }>(
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
    const journalId = posted.rows[0]?.journal_id;
    if (!journalId) throw new Error('Posting did not return a journal');

    await client.query(
      `INSERT INTO job_outbox (
         id, queue_name, payload, message_attributes,
         ledger_command_id, ledger_journal_id
       ) VALUES ($1, 'jobs', $2::jsonb, '{}'::jsonb, $3, $4)`,
      [
        claim.outbox_id,
        JSON.stringify({ journalId, operation: 'POST_JOURNAL' }),
        claim.command_id,
        journalId,
      ],
    );
    await client.query(`SELECT complete_ledger_command_idempotency($1, $2, $3) AS journal_id`, [
      claim.command_id,
      journalId,
      completeWithWrongOutbox ? randomUUID() : claim.outbox_id,
    ]);
    await client.query('COMMIT');
    return {
      commandId: claim.command_id,
      journalId,
      outboxId: claim.outbox_id,
      outcome: claim.outcome,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describeWithPostgres('KAN-43 ledger command idempotency PostgreSQL integration', () => {
  jest.setTimeout(120_000);

  const schema = `kan43_${randomUUID().replaceAll('-', '')}`;
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
    runner = new MigrationRunner(ledgerPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
    await expect(runner.up()).resolves.toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0006',
      '0007',
      '0008',
      '0009',
    ]);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(API_ROLE)}`,
    );
    await ledgerPool.query(
      `GRANT INSERT (id, queue_name, payload, message_attributes)
       ON TABLE job_outbox TO ${quoteIdentifier(API_ROLE)}`,
    );
  });

  afterAll(async () => {
    if (ledgerPool) await ledgerPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('verifies the cumulative idempotency and outbox-link catalog', async () => {
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    await expect(
      ledgerPool.query(createLedgerCommandIdempotencyTestSchemaMigrationV0009.verifySql!),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
  });

  it('does not allow a claim header to commit without its journal and outbox result', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();

    await expect(
      queryAsRole(
        ledgerPool,
        `SELECT * FROM claim_ledger_command_idempotency(
           $1::uuid, 'POST_JOURNAL', 1::smallint, $2,
           1::smallint, $3
         )`,
        [fixture.actorAccountId, randomBytes(32).toString('hex'), randomBytes(32).toString('hex')],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      ledgerPool.query(
        `SELECT count(*)::int AS commands
         FROM ledger_command_idempotency
         WHERE actor_account_id = $1`,
        [fixture.actorAccountId],
      ),
    ).resolves.toMatchObject({ rows: [{ commands: 0 }] });
  });

  it('returns the original result for an identical replay and rejects a changed fingerprint', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();
    await advanceLegToSubmitted(ledgerPool, fixture);
    const keyDigest = randomBytes(32).toString('hex');
    const fingerprint = randomBytes(32).toString('hex');

    const first = await executeIdempotentPost(ledgerPool, fixture, keyDigest, fingerprint);
    const replay = await executeIdempotentPost(ledgerPool, fixture, keyDigest, fingerprint);

    expect(first.outcome).toBe('CLAIMED');
    expect(replay).toEqual({ ...first, outcome: 'REPLAYED' });
    await expect(
      queryAsRole<{ journal_id: string }>(
        ledgerPool,
        `SELECT * FROM resolve_ledger_command_idempotency(
           $1::uuid, 'POST_JOURNAL', 1::smallint, $2,
           1::smallint, $3
         )`,
        [fixture.actorAccountId, keyDigest, fingerprint],
      ),
    ).resolves.toMatchObject({ rows: [{ journal_id: first.journalId }] });
    await expect(
      queryAsRole(
        ledgerPool,
        `SELECT * FROM claim_ledger_command_idempotency(
           $1::uuid, 'POST_JOURNAL', 1::smallint, $2,
           1::smallint, $3
         )`,
        [fixture.actorAccountId, keyDigest, randomBytes(32).toString('hex')],
      ),
    ).rejects.toMatchObject({ code: 'L4301' });

    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::int FROM ledger_journals WHERE leg_id = $1) AS journals,
           (SELECT count(*)::int FROM ledger_leg_lifecycle_events
             WHERE leg_id = $1 AND next_state = 'SETTLED') AS settled_events,
           (SELECT count(*)::int FROM ledger_command_idempotency
             WHERE command_id = $2) AS commands,
           (SELECT count(*)::int FROM ledger_command_idempotency_results
             WHERE command_id = $2) AS results,
           (SELECT count(*)::int FROM job_outbox
             WHERE ledger_command_id = $2) AS outbox_rows`,
        [fixture.legId, first.commandId],
      ),
    ).resolves.toMatchObject({
      rows: [{ journals: 1, settled_events: 1, commands: 1, results: 1, outbox_rows: 1 }],
    });
  });

  it('linearizes concurrent identical claims to one journal and one outbox row', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();
    await advanceLegToSubmitted(ledgerPool, fixture);
    const keyDigest = randomBytes(32).toString('hex');
    const fingerprint = randomBytes(32).toString('hex');

    const results = await Promise.all([
      executeIdempotentPost(ledgerPool, fixture, keyDigest, fingerprint),
      executeIdempotentPost(ledgerPool, fixture, keyDigest, fingerprint),
    ]);

    expect(results.map(({ outcome }) => outcome).sort()).toEqual(['CLAIMED', 'REPLAYED']);
    expect(new Set(results.map(({ commandId }) => commandId)).size).toBe(1);
    expect(new Set(results.map(({ journalId }) => journalId)).size).toBe(1);
    expect(new Set(results.map(({ outboxId }) => outboxId)).size).toBe(1);
    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::int FROM ledger_journals WHERE leg_id = $1) AS journals,
           (SELECT count(*)::int FROM job_outbox
             WHERE ledger_command_id = $2) AS outbox_rows,
           (SELECT count(*)::int FROM ledger_command_idempotency_results
             WHERE command_id = $2) AS results`,
        [fixture.legId, results[0]?.commandId],
      ),
    ).resolves.toMatchObject({ rows: [{ journals: 1, outbox_rows: 1, results: 1 }] });
  });

  it('rolls claim, journal, lifecycle, and outbox effects back when completion rejects', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();
    await advanceLegToSubmitted(ledgerPool, fixture);

    await expect(
      executeIdempotentPost(
        ledgerPool,
        fixture,
        randomBytes(32).toString('hex'),
        randomBytes(32).toString('hex'),
        true,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::int FROM ledger_journals WHERE leg_id = $1) AS journals,
           (SELECT count(*)::int FROM ledger_leg_lifecycle_events
             WHERE leg_id = $1 AND next_state = 'SETTLED') AS settled_events,
           (SELECT count(*)::int FROM ledger_command_idempotency
             WHERE actor_account_id = $2) AS commands,
           (SELECT count(*)::int FROM job_outbox
             WHERE ledger_journal_id IN (
               SELECT journal_id FROM ledger_journals WHERE leg_id = $1
             )) AS outbox_rows`,
        [fixture.legId, fixture.actorAccountId],
      ),
    ).resolves.toMatchObject({
      rows: [{ journals: 0, settled_events: 0, commands: 0, outbox_rows: 0 }],
    });
  });

  it('retains the command result after generic terminal outbox cleanup', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();
    await advanceLegToSubmitted(ledgerPool, fixture);
    const result = await executeIdempotentPost(
      ledgerPool,
      fixture,
      randomBytes(32).toString('hex'),
      randomBytes(32).toString('hex'),
    );

    await ledgerPool.query(
      `UPDATE job_outbox
       SET status = 'published', published_at = clock_timestamp()
       WHERE id = $1`,
      [result.outboxId],
    );
    await ledgerPool.query('DELETE FROM job_outbox WHERE id = $1', [result.outboxId]);
    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::int FROM job_outbox WHERE id = $1) AS outbox_rows,
           (SELECT count(*)::int FROM ledger_command_idempotency_results
             WHERE command_id = $2 AND journal_id = $3) AS retained_results`,
        [result.outboxId, result.commandId, result.journalId],
      ),
    ).resolves.toMatchObject({ rows: [{ outbox_rows: 0, retained_results: 1 }] });
  });

  it('keeps provider submission identities leg-qualified and refuses populated rollback', async () => {
    const client = await ledgerPool.connect();
    const fixture = await provisionPostingPlan(client);
    client.release();
    const providerReference = randomUUID();
    const keyDigest = randomBytes(32);
    const fingerprint = randomBytes(32);
    const values = [
      fixture.actorAccountId,
      fixture.bookId,
      fixture.transactionId,
      fixture.legId,
      providerReference,
      keyDigest,
      fingerprint,
    ];
    const insert = `INSERT INTO ledger_provider_submission_identities (
       actor_account_id, book_id, transaction_id, leg_id,
       provider_revision_reference_id, contract_version,
       key_digest, fingerprint_version, request_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, 1, $6, 1, $7)`;

    await ledgerPool.query(insert, values);
    await expect(ledgerPool.query(insert, values)).rejects.toMatchObject({ code: '23505' });
    await expect(runner.down(1)).rejects.toMatchObject({ code: '55000' });
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });
});
