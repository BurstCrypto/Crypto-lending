import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import {
  createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013,
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
} from '../../src/infrastructure/database/migrations';
import { JobOutboxRepository } from '../../src/infrastructure/outbox/job-outbox.repository';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

interface YieldFixture {
  readonly actorAccountId: string;
  readonly correlationId: string;
  readonly ledgerTransactionId: string;
  readonly operationId: string;
  readonly planReferenceId: string;
  readonly quoteReferenceId: string;
}

interface YieldCommandRow extends QueryResultRow {
  command_id: string;
  operation_id: string;
  current_state: string;
  transition_event_id: string;
  actor_account_id: string;
  previous_state: string | null;
  next_state: string;
  reason_code: string;
  ledger_transaction_id: string;
  submission_id: string | null;
  outcome: 'COMMITTED' | 'REPLAYED';
}

interface TransitionRequest {
  readonly expectedState: string;
  readonly nextState: string;
  readonly reason: string;
  readonly effectiveAt: Date;
  readonly keyDigest: string;
  readonly requestFingerprint: string;
}

type Queryable = Pick<PoolClient, 'query'>;

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('KAN-186 integration test requires a loopback PostgreSQL fixture');
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
  if (result.rows.length !== 1 || !row) throw new Error('Expected exactly one command result');
  return row;
}

async function provisionYieldFixture(pool: Pool): Promise<YieldFixture> {
  const actorAccountId = randomUUID();
  const ledgerTransactionId = randomUUID();
  const book = await pool.query<{ book_id: string }>(
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
  );
  const bookId = book.rows[0]?.book_id;
  if (!bookId) throw new Error('Operational ledger book was not provisioned');

  await pool.query(
    `INSERT INTO accounts (account_id, eligibility_status)
     VALUES ($1::uuid, 'UNKNOWN')`,
    [actorAccountId],
  );
  await pool.query(
    `INSERT INTO ledger_transactions (
       transaction_id, tenant_account_id, book_id, intent_type,
       configuration_revision_reference_id
     ) VALUES ($1, $2, $3, 'DIRECT_SETTLEMENT', $4)`,
    [ledgerTransactionId, actorAccountId, bookId, randomUUID()],
  );

  return {
    actorAccountId,
    correlationId: randomUUID(),
    ledgerTransactionId,
    operationId: randomUUID(),
    planReferenceId: randomUUID(),
    quoteReferenceId: randomUUID(),
  };
}

async function createOperation(
  queryable: Queryable,
  fixture: YieldFixture,
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
      fixture.actorAccountId,
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

async function transitionOperation(
  queryable: Queryable,
  fixture: YieldFixture,
  request: TransitionRequest,
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
      fixture.actorAccountId,
      fixture.operationId,
      request.expectedState,
      request.nextState,
      request.reason,
      request.effectiveAt,
      fixture.correlationId,
      request.keyDigest,
      request.requestFingerprint,
    ],
  );
}

describeWithPostgres('KAN-186 yield operation PostgreSQL controls', () => {
  jest.setTimeout(90_000);

  const schema = `kan186_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let operationPool: Pool;
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
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(operationPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
    await expect(runner.up()).resolves.toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
    ]);
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('commits one submission for an exact retry and keeps every transition immutable', async () => {
    const fixture = await provisionYieldFixture(operationPool);
    const baseTime = Date.now() - 60_000;
    const at = (offset: number): Date => new Date(baseTime + offset);

    await expect(createOperation(operationPool, fixture, at(0))).resolves.toMatchObject({
      operation_id: fixture.operationId,
      current_state: 'CREATED',
      previous_state: null,
      next_state: 'CREATED',
      reason_code: 'INTENT_CREATED',
      outcome: 'COMMITTED',
    });
    await transitionOperation(operationPool, fixture, {
      expectedState: 'CREATED',
      nextState: 'QUOTED',
      reason: 'QUOTE_CREATED',
      effectiveAt: at(1_000),
      keyDigest: digest(),
      requestFingerprint: digest(),
    });
    await transitionOperation(operationPool, fixture, {
      expectedState: 'QUOTED',
      nextState: 'USER_APPROVED',
      reason: 'USER_APPROVAL_RECORDED',
      effectiveAt: at(2_000),
      keyDigest: digest(),
      requestFingerprint: digest(),
    });

    const submitRequest: TransitionRequest = {
      expectedState: 'USER_APPROVED',
      nextState: 'SUBMITTED',
      reason: 'SUBMISSION_RECORDED',
      effectiveAt: at(3_000),
      keyDigest: digest(),
      requestFingerprint: digest(),
    };
    const submitClient = await operationPool.connect();
    let committed: YieldCommandRow;
    try {
      await submitClient.query('BEGIN');
      committed = await transitionOperation(submitClient, fixture, submitRequest);
      if (!committed.submission_id) throw new Error('Submission identifier was not created');
      await submitClient.query(
        `INSERT INTO job_outbox (id, queue_name, payload, message_attributes)
         VALUES ($1, 'jobs', $2::jsonb, '{}'::jsonb)`,
        [
          committed.submission_id,
          JSON.stringify({
            id: committed.submission_id,
            kind: 'yield.operation.submit',
            operationId: fixture.operationId,
          }),
        ],
      );
      await submitClient.query('COMMIT');
    } catch (error) {
      await submitClient.query('ROLLBACK');
      throw error;
    } finally {
      submitClient.release();
    }

    const replayed = await transitionOperation(operationPool, fixture, submitRequest);
    expect(replayed).toMatchObject({
      command_id: committed.command_id,
      transition_event_id: committed.transition_event_id,
      submission_id: committed.submission_id,
      current_state: 'SUBMITTED',
      outcome: 'REPLAYED',
    });

    await expect(
      transitionOperation(operationPool, fixture, {
        ...submitRequest,
        requestFingerprint: digest(),
      }),
    ).rejects.toMatchObject({ code: 'Y8601' });

    const durableCounts = await operationPool.query<{
      command_count: number;
      outbox_count: number;
      submission_count: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM yield_operation_commands) AS command_count,
         (SELECT count(*)::integer FROM yield_operation_submissions) AS submission_count,
         (SELECT count(*)::integer FROM job_outbox
          WHERE id = $1::text) AS outbox_count`,
      [committed.submission_id],
    );
    expect(durableCounts.rows).toEqual([
      { command_count: 4, submission_count: 1, outbox_count: 1 },
    ]);

    await transitionOperation(operationPool, fixture, {
      expectedState: 'SUBMITTED',
      nextState: 'PENDING',
      reason: 'OUTCOME_PENDING',
      effectiveAt: at(4_000),
      keyDigest: digest(),
      requestFingerprint: digest(),
    });
    await expect(transitionOperation(operationPool, fixture, submitRequest)).resolves.toMatchObject(
      {
        command_id: committed.command_id,
        transition_event_id: committed.transition_event_id,
        current_state: 'SUBMITTED',
        outcome: 'REPLAYED',
      },
    );

    await operationPool.query(
      `UPDATE job_outbox
       SET status = 'published',
           published_at = clock_timestamp() - INTERVAL '2 minutes',
           failed_at = NULL,
           locked_by = NULL,
           locked_until = NULL
       WHERE id = $1::text`,
      [committed.submission_id],
    );
    const unrelatedOutboxId = randomUUID();
    await operationPool.query(
      `INSERT INTO job_outbox (
         id, queue_name, payload, message_attributes, status, published_at
       ) VALUES (
         $1::text, 'jobs', $2::jsonb, '{}'::jsonb, 'published',
         clock_timestamp() - INTERVAL '2 minutes'
       )`,
      [
        unrelatedOutboxId,
        JSON.stringify({
          id: unrelatedOutboxId,
          kind: 'test.unrelated-retention-candidate',
        }),
      ],
    );
    const outboxRepository = new JobOutboxRepository(new PostgresService(operationPool));
    await expect(
      outboxRepository.deleteExpired({
        batchSize: 2,
        failedRetentionMs: 60_000,
        publishedRetentionMs: 60_000,
      }),
    ).resolves.toBe(2);
    await expect(
      operationPool.query(
        `SELECT
           (SELECT count(*)::integer FROM yield_operation_commands
            WHERE command_id = $1::uuid) AS command_count,
           (SELECT count(*)::integer FROM yield_operation_submissions
            WHERE command_id = $1::uuid) AS submission_count,
           (SELECT count(*)::integer FROM job_outbox
            WHERE id IN ($2::text, $3::text)) AS outbox_count`,
        [committed.command_id, committed.submission_id, unrelatedOutboxId],
      ),
    ).resolves.toMatchObject({
      rows: [{ command_count: 1, submission_count: 1, outbox_count: 0 }],
    });
    await expect(transitionOperation(operationPool, fixture, submitRequest)).resolves.toMatchObject(
      {
        command_id: committed.command_id,
        submission_id: committed.submission_id,
        current_state: 'SUBMITTED',
        outcome: 'REPLAYED',
      },
    );

    await expect(
      transitionOperation(operationPool, fixture, {
        expectedState: 'PENDING',
        nextState: 'USER_APPROVED',
        reason: 'USER_APPROVAL_RECORDED',
        effectiveAt: at(5_000),
        keyDigest: digest(),
        requestFingerprint: digest(),
      }),
    ).rejects.toMatchObject({ code: 'L4201' });

    const rejectedCommandCounts = await operationPool.query<{
      command_count: number;
      ledger_event_count: number;
      transition_count: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM yield_operation_commands) AS command_count,
         (SELECT count(*)::integer
          FROM yield_operation_transition_events AS yield_event
          INNER JOIN ledger_transaction_lifecycle_events AS ledger_event
            ON ledger_event.lifecycle_event_id = yield_event.transition_event_id
          WHERE yield_event.operation_id = $1) AS ledger_event_count,
         (SELECT count(*)::integer FROM yield_operation_transition_events
          WHERE operation_id = $1) AS transition_count`,
      [fixture.operationId],
    );
    expect(rejectedCommandCounts.rows).toEqual([
      { command_count: 5, ledger_event_count: 5, transition_count: 5 },
    ]);

    const audit = await operationPool.query<{
      actor_account_id: string;
      correlation_id: string;
      effective_at: Date;
      ledger_journal_id: string | null;
      ledger_transaction_id: string;
      next_state: string;
      previous_state: string | null;
      reason_code: string;
      recorded_at: Date;
    }>(
      `SELECT actor_account_id, correlation_id, effective_at,
              ledger_journal_id, ledger_transaction_id, next_state,
              previous_state, reason_code, recorded_at
       FROM yield_operation_transition_events
       WHERE operation_id = $1
       ORDER BY event_sequence`,
      [fixture.operationId],
    );
    expect(
      audit.rows.map(({ previous_state, next_state, reason_code }) => ({
        previous_state,
        next_state,
        reason_code,
      })),
    ).toEqual([
      { previous_state: null, next_state: 'CREATED', reason_code: 'INTENT_CREATED' },
      { previous_state: 'CREATED', next_state: 'QUOTED', reason_code: 'QUOTE_CREATED' },
      {
        previous_state: 'QUOTED',
        next_state: 'USER_APPROVED',
        reason_code: 'USER_APPROVAL_RECORDED',
      },
      {
        previous_state: 'USER_APPROVED',
        next_state: 'SUBMITTED',
        reason_code: 'SUBMISSION_RECORDED',
      },
      {
        previous_state: 'SUBMITTED',
        next_state: 'PENDING',
        reason_code: 'OUTCOME_PENDING',
      },
    ]);
    for (const transition of audit.rows) {
      expect(transition).toMatchObject({
        actor_account_id: fixture.actorAccountId,
        correlation_id: fixture.correlationId,
        ledger_transaction_id: fixture.ledgerTransactionId,
        ledger_journal_id: null,
      });
      expect(transition.effective_at).toBeInstanceOf(Date);
      expect(transition.recorded_at).toBeInstanceOf(Date);
    }

    await expect(
      operationPool.query(
        `UPDATE yield_operation_transition_events
         SET reason_code = 'PREFLIGHT_FAILED'
         WHERE operation_id = $1`,
        [fixture.operationId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
    await expect(
      operationPool.query(createLedgerFeeAdjustmentIntegrityTestSchemaMigrationV0013.verifySql!),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
  });
});
