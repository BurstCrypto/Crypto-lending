import { createHash, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039 } from '../../src/infrastructure/database/migrations/0039-persist-verified-mainnet-signed-submission-proof.migration';
import { createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040 } from '../../src/infrastructure/database/migrations/0040-preserve-mainnet-financial-action-recovery-through-wallet-identity-key-rotation.migration';
import { createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041 } from '../../src/infrastructure/database/migrations/0041-preserve-revoked-wallet-metadata-key-retirement.migration';
import { createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042 } from '../../src/infrastructure/database/migrations/0042-create-mainnet-financial-action-durable-scheduler.migration';
import type { DatabaseMigration } from '../../src/infrastructure/database/migrations/migration';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const UINT64_MAX = '18446744073709551615';
const MIGRATIONS_THROUGH_0042 = [
  ...DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(({ id }) => id <= '0038'),
  createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039,
  createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040,
  createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041,
  createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042,
];
const CLAIM_SQL = `SELECT * FROM claim_mainnet_financial_action_scheduler_job_v1(
  $1::text, $2::integer
)`;
const COMPLETE_SQL = `SELECT * FROM complete_mainnet_financial_action_scheduler_job_v1(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::text,
  $7::uuid, $8::numeric, $9::text
)`;

type Queryable = Pick<PoolClient, 'query'> | Pick<Pool, 'query'>;

interface IntentFixture {
  readonly accountId: string;
  readonly intentId: string;
  readonly intentFingerprint: string;
  readonly networkId: 'eip155:1' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
}

interface EventFixture {
  readonly eventId: string;
  readonly revision: number;
  readonly snapshot: string;
}

interface ClaimRow extends QueryResultRow {
  scheduler_version: number;
  job_id: string;
  account_id: string;
  intent_id: string;
  intent_record_fingerprint_sha256: string;
  network_id: string;
  action_type: string;
  lifecycle_revision: string;
  lifecycle_snapshot_sha256: string;
  lifecycle_stage: string;
  queue_name: 'PRE_BROADCAST' | 'RECONCILIATION';
  purpose: string;
  chain_transaction_id: string | null;
  reconciliation_outcome: string | null;
  attempt_count: number;
  maximum_attempts: number;
  lease_id: string;
  fencing_token: string;
  claimed_at: Date;
  lease_expires_at: Date;
}

interface CompletionRow extends QueryResultRow {
  record_outcome: 'RECORDED' | 'REPLAYED';
  completion_outcome: string;
  resulting_job_status: string;
  server_completed_at: Date;
  attempt_count: number;
  maximum_attempts: number;
}

function fingerprint(label: string = randomUUID()): string {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function schedulerOnlyVerifier(): string {
  const source = createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.verifySql;
  if (!source) throw new Error('Scheduler verifier is unavailable');
  const priorStartMarker = '\n    FROM (';
  const priorEndMarker = ') prior\n    CROSS JOIN (';
  const priorStart = source.indexOf(priorStartMarker);
  const priorEnd = source.lastIndexOf(priorEndMarker);
  if (priorStart < 0 || priorEnd <= priorStart) {
    throw new Error('Scheduler verifier predecessor boundary drifted');
  }
  return `${source.slice(0, priorStart + priorStartMarker.length)}SELECT true AS valid${source.slice(priorEnd)}`;
}

function schedulerOnlyVerifierDetails(): string {
  return schedulerOnlyVerifier().replace(
    /^SELECT \([\s\S]*?\) AS valid\n[ ]{4}FROM /u,
    `SELECT prior.valid AS prior_valid, jobs.valid AS jobs_valid,
      audit.valid AS audit_valid, manual.valid AS manual_valid,
      columns.valid AS columns_valid, constraints.valid AS constraints_valid,
      indexes.valid AS indexes_valid, functions.valid AS functions_valid,
      triggers.valid AS triggers_valid, data.valid AS data_valid
    FROM `,
  );
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Scheduler integration tests require a loopback PostgreSQL URL');
  }
}

function requirePostgres16(serverVersion: number | undefined): void {
  if (serverVersion === undefined || Math.floor(serverVersion / 10_000) !== 16) {
    throw new Error('Scheduler integration tests require PostgreSQL 16');
  }
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

async function installMinimalLifecycleSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE FUNCTION reject_mainnet_action_history_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN RAISE EXCEPTION 'immutable history' USING ERRCODE = '55000'; END;
      $function$;
    CREATE TABLE mainnet_financial_action_intents (
      intent_id uuid PRIMARY KEY,
      account_id uuid NOT NULL,
      intent_record_fingerprint_sha256 text NOT NULL UNIQUE,
      network_id text NOT NULL,
      action_type text NOT NULL
    );
    CREATE TABLE mainnet_financial_action_events (
      event_id uuid NOT NULL UNIQUE,
      intent_id uuid NOT NULL REFERENCES mainnet_financial_action_intents (intent_id),
      revision bigint NOT NULL,
      snapshot_sha256 text NOT NULL,
      stage text NOT NULL,
      chain_transaction_id text,
      reconciliation_outcome text,
      PRIMARY KEY (intent_id, revision),
      UNIQUE (intent_id, snapshot_sha256)
    );
  `);
}

async function applyWithoutIntermediateVerification(
  pool: Pool,
  migrations: readonly DatabaseMigration[],
): Promise<void> {
  for (const migration of migrations) {
    const statements = Array.isArray(migration.upSql) ? migration.upSql : [migration.upSql];
    if (migration.transactional === false) {
      for (const statement of statements) await pool.query(statement);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of statements) await client.query(statement);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertIntent(
  queryable: Queryable,
  networkId: IntentFixture['networkId'] = 'eip155:1',
): Promise<IntentFixture> {
  const fixture: IntentFixture = {
    accountId: randomUUID(),
    intentId: randomUUID(),
    intentFingerprint: fingerprint(),
    networkId,
  };
  await queryable.query(
    `INSERT INTO mainnet_financial_action_intents (
      intent_id, account_id, intent_record_fingerprint_sha256, network_id, action_type
    ) VALUES ($1::uuid, $2::uuid, $3::text, $4::text, 'SUPPLY')`,
    [fixture.intentId, fixture.accountId, fixture.intentFingerprint, fixture.networkId],
  );
  return fixture;
}

async function insertEvent(
  queryable: Queryable,
  intent: IntentFixture,
  revision: number,
  stage:
    | 'PREPARED'
    | 'WALLET_SIGNED_SUBMISSION_BOUND'
    | 'RECONCILIATION_AMBIGUOUS'
    | 'FINALIZED_SUCCESS'
    | 'REORG_QUARANTINED',
  reconciliationOutcome: string | null = null,
): Promise<EventFixture> {
  const event: EventFixture = {
    eventId: randomUUID(),
    revision,
    snapshot: fingerprint(),
  };
  const transactionId = stage === 'PREPARED' ? null : `0x${fingerprint()}`;
  await queryable.query(
    `INSERT INTO mainnet_financial_action_events (
      event_id, intent_id, revision, snapshot_sha256, stage,
      chain_transaction_id, reconciliation_outcome
    ) VALUES ($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text)`,
    [
      event.eventId,
      intent.intentId,
      event.revision,
      event.snapshot,
      stage,
      transactionId,
      reconciliationOutcome,
    ],
  );
  return event;
}

async function claim(
  queryable: Queryable,
  queue: ClaimRow['queue_name'],
  leaseMilliseconds = 5_000,
): Promise<ClaimRow | undefined> {
  const result = await queryable.query<ClaimRow>(CLAIM_SQL, [queue, leaseMilliseconds]);
  return result.rows[0];
}

async function complete(
  queryable: Queryable,
  claimed: ClaimRow,
  disposition: string,
  overrides: Readonly<{
    jobId?: string;
    leaseId?: string;
    fencingToken?: string;
    snapshot?: string;
  }> = {},
): Promise<CompletionRow> {
  return requiredRow<CompletionRow>(queryable, COMPLETE_SQL, [
    overrides.jobId ?? claimed.job_id,
    claimed.account_id,
    claimed.intent_id,
    claimed.queue_name,
    claimed.lifecycle_revision,
    overrides.snapshot ?? claimed.lifecycle_snapshot_sha256,
    overrides.leaseId ?? claimed.lease_id,
    overrides.fencingToken ?? claimed.fencing_token,
    disposition,
  ]);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describeWithPostgres('migration 0042 durable scheduler (guarded PostgreSQL 16)', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const fullSchema = `scheduler_full_${suffix}`;
  const functionalSchema = `scheduler_functions_${suffix}`;
  let adminPool: Pool;
  let fullPool: Pool;
  let functionalPool: Pool;
  let preexistingIntent: IntentFixture;
  let preexistingEvent: EventFixture;

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const server = await adminPool.query<{ server_version_num: number }>(
      `SELECT pg_catalog.current_setting('server_version_num')::integer AS server_version_num`,
    );
    requirePostgres16(server.rows[0]?.server_version_num);
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(fullSchema)}`);
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(functionalSchema)}`);
    fullPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 2,
      options: `-c search_path=${fullSchema} -c statement_timeout=45000 -c lock_timeout=4000`,
    });
    functionalPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 6,
      options: `-c search_path=${functionalSchema} -c statement_timeout=45000 -c lock_timeout=4000`,
    });
    await installMinimalLifecycleSchema(functionalPool);
    preexistingIntent = await insertIntent(functionalPool);
    preexistingEvent = await insertEvent(functionalPool, preexistingIntent, 1, 'PREPARED');
    await functionalPool.query(
      sql(createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.upSql),
    );
  }, 60_000);

  afterAll(async () => {
    if (functionalPool) await functionalPool.end();
    if (fullPool) await fullPool.end();
    if (adminPool) {
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(functionalSchema)} CASCADE`);
        await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(fullSchema)} CASCADE`);
      } finally {
        await adminPool.end();
      }
    }
  }, 30_000);

  it('applies and exactly verifies against the real predecessor catalog', async () => {
    await applyWithoutIntermediateVerification(fullPool, MIGRATIONS_THROUGH_0042);
    await expect(
      fullPool.query(
        createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.verifySql ?? '',
      ),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
  }, 60_000);

  it('transactionally backfills and exactly deduplicates prepared lifecycle state', async () => {
    const job = await requiredRow<{
      job_id: string;
      queue_name: string;
      job_status: string;
      maximum_attempts: number;
    }>(
      functionalPool,
      `SELECT job_id, queue_name, job_status, maximum_attempts
       FROM mainnet_financial_action_scheduler_jobs WHERE source_event_id = $1::uuid`,
      [preexistingEvent.eventId],
    );
    expect(job).toMatchObject({
      queue_name: 'PRE_BROADCAST',
      job_status: 'READY',
      maximum_attempts: 3,
    });
    await expect(
      requiredRow(
        functionalPool,
        `SELECT * FROM enqueue_mainnet_financial_action_scheduler_job_v1($1::uuid)`,
        [preexistingEvent.eventId],
      ),
    ).resolves.toMatchObject({ enqueue_outcome: 'REPLAYED', result_job_id: job.job_id });
    const claimed = await claim(functionalPool, 'PRE_BROADCAST');
    expect(claimed).toBeDefined();
    await complete(functionalPool, claimed as ClaimRow, 'PRE_BROADCAST_REVIEW_COMPLETED');
  });

  it('never returns signed or UNKNOWN lifecycle work to pre-broadcast', async () => {
    const intent = await insertIntent(functionalPool, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    await insertEvent(functionalPool, intent, 1, 'PREPARED');
    const signed = await insertEvent(functionalPool, intent, 2, 'WALLET_SIGNED_SUBMISSION_BOUND');
    const unknown = await insertEvent(
      functionalPool,
      intent,
      3,
      'RECONCILIATION_AMBIGUOUS',
      'UNKNOWN',
    );
    const jobs = await functionalPool.query<{
      source_event_id: string;
      queue_name: string;
      lifecycle_stage: string;
      reconciliation_outcome: string | null;
      job_status: string;
    }>(
      `SELECT source_event_id, queue_name, lifecycle_stage, reconciliation_outcome, job_status
       FROM mainnet_financial_action_scheduler_jobs WHERE intent_id = $1::uuid
       ORDER BY lifecycle_revision`,
      [intent.intentId],
    );
    expect(jobs.rows).toEqual([
      expect.objectContaining({ queue_name: 'PRE_BROADCAST', job_status: 'SUPERSEDED' }),
      expect.objectContaining({
        source_event_id: signed.eventId,
        queue_name: 'RECONCILIATION',
        job_status: 'SUPERSEDED',
      }),
      expect.objectContaining({
        source_event_id: unknown.eventId,
        queue_name: 'RECONCILIATION',
        lifecycle_stage: 'RECONCILIATION_AMBIGUOUS',
        reconciliation_outcome: 'UNKNOWN',
        job_status: 'READY',
      }),
    ]);
    expect(await claim(functionalPool, 'PRE_BROADCAST')).toBeUndefined();
    const claimed = await claim(functionalPool, 'RECONCILIATION');
    expect(claimed).toMatchObject({ lifecycle_stage: 'RECONCILIATION_AMBIGUOUS' });
    await complete(functionalPool, claimed as ClaimRow, 'RECONCILIATION_COMPLETED');
  });

  it('rolls lifecycle-derived enqueue back with the source transaction', async () => {
    const intent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, intent, 1, 'PREPARED');
    const client = await functionalPool.connect();
    try {
      await client.query('BEGIN');
      const signed = await insertEvent(client, intent, 2, 'WALLET_SIGNED_SUBMISSION_BOUND');
      await expect(
        client.query(
          `SELECT 1 FROM mainnet_financial_action_scheduler_jobs WHERE source_event_id = $1`,
          [signed.eventId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const remaining = await functionalPool.query<{
      lifecycle_revision: string;
      job_status: string;
    }>(
      `SELECT lifecycle_revision, job_status FROM mainnet_financial_action_scheduler_jobs
       WHERE intent_id = $1::uuid`,
      [intent.intentId],
    );
    expect(remaining.rows).toEqual([{ lifecycle_revision: '1', job_status: 'READY' }]);
    const claimed = await claim(functionalPool, 'PRE_BROADCAST');
    await complete(functionalPool, claimed as ClaimRow, 'PRE_BROADCAST_REVIEW_COMPLETED');
  });

  it('claims once under concurrency and enforces release fencing and exact lost-ACK replay', async () => {
    const intent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, intent, 1, 'PREPARED');
    const claims = await Promise.all([
      functionalPool.query<ClaimRow>(CLAIM_SQL, ['PRE_BROADCAST', 5_000]),
      functionalPool.query<ClaimRow>(CLAIM_SQL, ['PRE_BROADCAST', 5_000]),
    ]);
    const rows = claims.flatMap(({ rows: claimedRows }) => claimedRows);
    expect(rows).toHaveLength(1);
    const first = rows[0] as ClaimRow;
    expect(first).toMatchObject({ attempt_count: 1, fencing_token: '1' });
    expect(first.lease_id).toMatch(/^[0-9a-f-]{36}$/u);
    const released = await complete(functionalPool, first, 'RETRY_PRE_BROADCAST_REVIEW_ONLY');
    expect(released).toMatchObject({
      record_outcome: 'RECORDED',
      completion_outcome: 'RELEASE_PRE_BROADCAST_ONLY',
      resulting_job_status: 'READY',
    });
    await expect(
      complete(functionalPool, first, 'RETRY_PRE_BROADCAST_REVIEW_ONLY'),
    ).resolves.toMatchObject({ record_outcome: 'REPLAYED' });
    expect(await claim(functionalPool, 'PRE_BROADCAST')).toBeUndefined();
    await wait(275);
    const second = (await claim(functionalPool, 'PRE_BROADCAST')) as ClaimRow;
    expect(second).toMatchObject({ attempt_count: 2, fencing_token: '2' });
    expect(second.lease_id).not.toBe(first.lease_id);
    await expect(
      complete(functionalPool, first, 'PRE_BROADCAST_REVIEW_COMPLETED'),
    ).rejects.toMatchObject({ code: '40001' });
    await complete(functionalPool, second, 'PRE_BROADCAST_REVIEW_COMPLETED');
  });

  it('recovers an expired lease and rejects its copied stale capability', async () => {
    const intent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, intent, 1, 'PREPARED');
    const expired = (await claim(functionalPool, 'PRE_BROADCAST', 1_000)) as ClaimRow;
    await wait(1_250);
    const recovered = (await claim(functionalPool, 'PRE_BROADCAST', 5_000)) as ClaimRow;
    expect(recovered).toMatchObject({
      job_id: expired.job_id,
      attempt_count: 2,
      fencing_token: '2',
    });
    await expect(
      complete(functionalPool, expired, 'PRE_BROADCAST_REVIEW_COMPLETED'),
    ).rejects.toMatchObject({ code: '40001' });
    await complete(functionalPool, recovered, 'PRE_BROADCAST_REVIEW_COMPLETED');
    const transitions = await functionalPool.query<{ transition: string }>(
      `SELECT transition FROM mainnet_financial_action_scheduler_events
       WHERE job_id = $1::uuid ORDER BY state_version`,
      [expired.job_id],
    );
    expect(transitions.rows.map(({ transition }) => transition)).toEqual([
      'ENQUEUED',
      'CLAIMED',
      'LEASE_RECOVERED',
      'COMPLETED',
    ]);
  });

  it('rejects completion when its row-lock wait crosses lease expiry', async () => {
    const intent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, intent, 1, 'PREPARED');
    const expiring = (await claim(functionalPool, 'PRE_BROADCAST', 1_000)) as ClaimRow;
    const blocker = await functionalPool.connect();
    const waiter = await functionalPool.connect();
    let blockerTransactionOpen = false;
    let completionAttempt:
      | Promise<
          | { readonly ok: true; readonly value: CompletionRow }
          | { readonly ok: false; readonly error: unknown }
        >
      | undefined;

    try {
      await blocker.query('BEGIN');
      blockerTransactionOpen = true;
      await blocker.query(
        `SELECT 1 FROM mainnet_financial_action_scheduler_jobs
         WHERE job_id = $1::uuid FOR UPDATE`,
        [expiring.job_id],
      );
      const { backend_pid: waiterPid } = await requiredRow<{ backend_pid: number }>(
        waiter,
        'SELECT pg_catalog.pg_backend_pid()::integer AS backend_pid',
      );
      completionAttempt = complete(waiter, expiring, 'PRE_BROADCAST_REVIEW_COMPLETED').then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      let lockObserved = false;
      for (let observation = 0; observation < 100; observation += 1) {
        const state = await requiredRow<{ blocked: boolean }>(
          functionalPool,
          `SELECT COALESCE((
             SELECT wait_event_type = 'Lock'
             FROM pg_catalog.pg_stat_activity WHERE pid = $1::integer
           ), false) AS blocked`,
          [waiterPid],
        );
        if (state.blocked) {
          lockObserved = true;
          break;
        }
        await wait(20);
      }

      await blocker.query('SELECT pg_catalog.pg_sleep(1.2)');
      await blocker.query('COMMIT');
      blockerTransactionOpen = false;
      const completionResult = await completionAttempt;
      expect(lockObserved).toBe(true);
      expect(completionResult.ok).toBe(false);
      if (completionResult.ok) {
        throw new Error('Completion unexpectedly survived an expired lease');
      }
      expect(completionResult.error).toMatchObject({ code: '40001' });
    } finally {
      if (blockerTransactionOpen) await blocker.query('ROLLBACK').catch(() => undefined);
      if (completionAttempt) await completionAttempt;
      waiter.release();
      blocker.release();
    }

    const recovered = (await claim(functionalPool, 'PRE_BROADCAST', 5_000)) as ClaimRow;
    expect(recovered).toMatchObject({
      job_id: expiring.job_id,
      attempt_count: 2,
      fencing_token: '2',
    });
    await complete(functionalPool, recovered, 'PRE_BROADCAST_REVIEW_COMPLETED');
  });

  it('rejects a current lease copied onto a different exact job cursor', async () => {
    const firstIntent = await insertIntent(functionalPool);
    const secondIntent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, firstIntent, 1, 'PREPARED');
    await insertEvent(functionalPool, secondIntent, 1, 'PREPARED');
    const first = (await claim(functionalPool, 'PRE_BROADCAST')) as ClaimRow;
    const second = (await claim(functionalPool, 'PRE_BROADCAST')) as ClaimRow;
    await expect(
      functionalPool.query(COMPLETE_SQL, [
        second.job_id,
        second.account_id,
        second.intent_id,
        second.queue_name,
        second.lifecycle_revision,
        second.lifecycle_snapshot_sha256,
        first.lease_id,
        first.fencing_token,
        'PRE_BROADCAST_REVIEW_COMPLETED',
      ]),
    ).rejects.toMatchObject({ code: '40001' });
    await complete(functionalPool, first, 'PRE_BROADCAST_REVIEW_COMPLETED');
    await complete(functionalPool, second, 'PRE_BROADCAST_REVIEW_COMPLETED');
  });

  it('atomically quarantines both queues at their exact attempt limits', async () => {
    const preparedIntent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, preparedIntent, 1, 'PREPARED');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = (await claim(functionalPool, 'PRE_BROADCAST')) as ClaimRow;
      expect(claimed.attempt_count).toBe(attempt);
      const completion = await complete(functionalPool, claimed, 'RETRY_PRE_BROADCAST_REVIEW_ONLY');
      if (attempt < 3) await wait(275);
      else expect(completion.completion_outcome).toBe('ATTEMPT_LIMIT_REACHED');
    }

    const reconciliationIntent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, reconciliationIntent, 1, 'PREPARED');
    await insertEvent(functionalPool, reconciliationIntent, 2, 'WALLET_SIGNED_SUBMISSION_BOUND');
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const claimed = (await claim(functionalPool, 'RECONCILIATION')) as ClaimRow;
      expect(claimed).toMatchObject({ attempt_count: attempt, maximum_attempts: 12 });
      const completion = await complete(functionalPool, claimed, 'RETRY_RECONCILIATION_ONLY');
      if (attempt < 12) await wait(1_200);
      else expect(completion.completion_outcome).toBe('ATTEMPT_LIMIT_REACHED');
    }
    const cases = await functionalPool.query<{
      queue_name: string;
      reason: string;
      attempt_count: number;
    }>(
      `SELECT queue_name, reason, attempt_count
       FROM mainnet_financial_action_scheduler_manual_reviews
       WHERE intent_id IN ($1::uuid, $2::uuid) ORDER BY queue_name`,
      [preparedIntent.intentId, reconciliationIntent.intentId],
    );
    expect(cases.rows).toEqual([
      { queue_name: 'PRE_BROADCAST', reason: 'ATTEMPT_LIMIT_REACHED', attempt_count: 3 },
      { queue_name: 'RECONCILIATION', reason: 'ATTEMPT_LIMIT_REACHED', attempt_count: 12 },
    ]);
    expect(await claim(functionalPool, 'PRE_BROADCAST')).toBeUndefined();
    expect(await claim(functionalPool, 'RECONCILIATION')).toBeUndefined();
  }, 25_000);

  it('persists post-finality review and lifecycle quarantine without resubmission authority', async () => {
    const finalIntent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, finalIntent, 1, 'PREPARED');
    await insertEvent(functionalPool, finalIntent, 2, 'WALLET_SIGNED_SUBMISSION_BOUND');
    await insertEvent(functionalPool, finalIntent, 3, 'FINALIZED_SUCCESS', 'FINALIZED_SUCCESS');
    const finalized = (await claim(functionalPool, 'RECONCILIATION')) as ClaimRow;
    expect(finalized).toMatchObject({
      purpose: 'POST_FINALITY_REVIEW',
      lifecycle_stage: 'FINALIZED_SUCCESS',
      reconciliation_outcome: 'FINALIZED_SUCCESS',
      may_authorize_financial_action: false,
      may_construct_transaction: false,
      api_may_sign: false,
      api_may_broadcast: false,
      may_resubmit_transaction: false,
      ledger_settlement_authority: false,
    });
    await complete(functionalPool, finalized, 'RECONCILIATION_COMPLETED');

    const reorgIntent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, reorgIntent, 1, 'PREPARED');
    await insertEvent(functionalPool, reorgIntent, 2, 'WALLET_SIGNED_SUBMISSION_BOUND');
    await insertEvent(functionalPool, reorgIntent, 3, 'REORG_QUARANTINED', 'REORGED_OUT');
    await expect(
      requiredRow(
        functionalPool,
        `SELECT job.job_status, manual.reason
         FROM mainnet_financial_action_scheduler_jobs job
         INNER JOIN mainnet_financial_action_scheduler_manual_reviews manual
           ON manual.job_id = job.job_id
         WHERE job.intent_id = $1::uuid AND job.lifecycle_revision = 3`,
        [reorgIntent.intentId],
      ),
    ).resolves.toMatchObject({
      job_status: 'MANUAL_REVIEW',
      reason: 'LIFECYCLE_REORG_QUARANTINED',
    });
  });

  it('verifies populated history and rejects a re-fingerprinted impossible predecessor', async () => {
    const intent = await insertIntent(functionalPool);
    await insertEvent(functionalPool, intent, 1, 'PREPARED');
    const expired = (await claim(functionalPool, 'PRE_BROADCAST', 1_000)) as ClaimRow;
    await wait(1_250);
    const recoveredClaim = (await claim(functionalPool, 'PRE_BROADCAST', 5_000)) as ClaimRow;
    expect(recoveredClaim.job_id).toBe(expired.job_id);
    await expect(functionalPool.query(schedulerOnlyVerifierDetails())).resolves.toMatchObject({
      rows: [
        {
          prior_valid: true,
          jobs_valid: true,
          audit_valid: true,
          manual_valid: true,
          columns_valid: true,
          // The minimal fixture intentionally does not reproduce predecessor index names;
          // the real-catalog test above proves the cumulative constraint digest.
          constraints_valid: false,
          indexes_valid: true,
          functions_valid: true,
          triggers_valid: true,
          data_valid: true,
        },
      ],
    });
    const recovered = await requiredRow<{ audit_event_id: string }>(
      functionalPool,
      `SELECT audit_event_id FROM mainnet_financial_action_scheduler_events
       WHERE job_id = $1::uuid AND transition = 'LEASE_RECOVERED'`,
      [recoveredClaim.job_id],
    );
    const client = await functionalPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `ALTER TABLE mainnet_financial_action_scheduler_events DISABLE TRIGGER
          mainnet_action_scheduler_audit_append_only_row`,
      );
      await client.query(
        `UPDATE mainnet_financial_action_scheduler_events
         SET transition = 'CLAIMED' WHERE audit_event_id = $1::uuid`,
        [recovered.audit_event_id],
      );
      await client.query(
        `UPDATE mainnet_financial_action_scheduler_events AS audit SET
          audit_fingerprint_sha256 = pg_catalog.encode(pg_catalog.sha256(
            pg_catalog.convert_to(pg_catalog.jsonb_build_array(
              'CRYPTO_LENDING:MAINNET_ACTION:SCHEDULER_AUDIT:JSONB-ARRAY:v1',
              audit.audit_event_id::text, audit.job_id::text, audit.state_version::text,
              audit.transition, audit.job_status, audit.queue_name, audit.intent_id::text,
              audit.lifecycle_revision::text, audit.lifecycle_snapshot_sha256,
              audit.attempt_count::text, audit.fencing_token::text,
              audit.subject_lease_id::text, audit.requested_disposition,
              ((extract(epoch FROM audit.recorded_at) * 1000)::bigint)::text,
              'false', 'false', 'false', 'false', 'false', 'false'
            )::text, 'UTF8')), 'hex')
         WHERE audit.audit_event_id = $1::uuid`,
        [recovered.audit_event_id],
      );
      await client.query(
        `ALTER TABLE mainnet_financial_action_scheduler_events ENABLE ALWAYS TRIGGER
          mainnet_action_scheduler_audit_append_only_row`,
      );
      await expect(client.query(schedulerOnlyVerifierDetails())).resolves.toMatchObject({
        rows: [{ data_valid: false }],
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await complete(functionalPool, recoveredClaim, 'PRE_BROADCAST_REVIEW_COMPLETED');
  });

  it('rejects tamper, preserves immutable history, denies ACLs, and refuses unsafe down', async () => {
    const manual = await requiredRow<{ job_id: string }>(
      functionalPool,
      `SELECT job_id FROM mainnet_financial_action_scheduler_manual_reviews LIMIT 1`,
    );
    await expect(
      functionalPool.query(
        `UPDATE mainnet_financial_action_scheduler_jobs
         SET may_resubmit_transaction = true, state_version = state_version + 1
         WHERE job_id = $1::uuid`,
        [manual.job_id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      functionalPool.query(
        `UPDATE mainnet_financial_action_scheduler_events SET transition = 'COMPLETED'
         WHERE job_id = $1::uuid`,
        [manual.job_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      functionalPool.query(
        `DELETE FROM mainnet_financial_action_scheduler_manual_reviews
         WHERE job_id = $1::uuid`,
        [manual.job_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    const acl = await requiredRow<{
      table_nonowner_acl: string;
      function_nonowner_acl: string;
    }>(
      functionalPool,
      `SELECT
        (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_class relation
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
           relation.relacl, pg_catalog.acldefault('r', relation.relowner)
         )) acl WHERE relation.oid IN (
           pg_catalog.to_regclass('mainnet_financial_action_scheduler_jobs'),
           pg_catalog.to_regclass('mainnet_financial_action_scheduler_events'),
           pg_catalog.to_regclass('mainnet_financial_action_scheduler_manual_reviews')
         ) AND acl.grantee <> relation.relowner) AS table_nonowner_acl,
        (SELECT pg_catalog.count(*)::text FROM pg_catalog.pg_proc procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
           procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
         )) acl WHERE procedure.proname LIKE '%mainnet_financial_action_scheduler%'
           AND procedure.pronamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
           AND acl.grantee <> procedure.proowner) AS function_nonowner_acl`,
    );
    expect(acl).toEqual({ table_nonowner_acl: '0', function_nonowner_acl: '0' });
    await expect(
      functionalPool.query(
        sql(createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.downSql),
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('reverses only an empty scheduler catalog', async () => {
    const schema = `scheduler_down_${suffix}`;
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    const pool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 1,
      options: `-c search_path=${schema}`,
    });
    try {
      await installMinimalLifecycleSchema(pool);
      await pool.query(
        sql(createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.upSql),
      );
      await expect(
        pool.query(
          sql(createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042.downSql),
        ),
      ).resolves.toBeDefined();
      const relation = await requiredRow<{ jobs: string | null }>(
        pool,
        `SELECT pg_catalog.to_regclass('mainnet_financial_action_scheduler_jobs')::text AS jobs`,
      );
      expect(relation.jobs).toBeNull();
    } finally {
      await pool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    }
  });

  it('rejects invalid leases and proves the fence upper bound in PostgreSQL', async () => {
    await expect(functionalPool.query(CLAIM_SQL, ['PRE_BROADCAST', 999])).rejects.toMatchObject({
      code: '22023',
    });
    await expect(
      functionalPool.query(CLAIM_SQL, ['RECONCILIATION', 900_001]),
    ).rejects.toMatchObject({ code: '22023' });
    expect(UINT64_MAX).toBe('18446744073709551615');
    const definition = await requiredRow<{ definition: string }>(
      functionalPool,
      `SELECT pg_catalog.pg_get_constraintdef(oid, false) AS definition
       FROM pg_catalog.pg_constraint
       WHERE conrelid = pg_catalog.to_regclass('mainnet_financial_action_scheduler_jobs')
         AND conname = 'mainnet_action_scheduler_job_attempt_check'`,
    );
    expect(definition.definition).toContain(UINT64_MAX);
  });
});
