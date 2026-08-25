import { randomBytes, randomUUID } from 'node:crypto';

import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Controller, Post, UseGuards, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';
import request from 'supertest';

import { AccountAuthGuard } from '../../src/accounts/auth/account-auth.guard';
import type { CurrentPrincipal as AuthenticatedPrincipal } from '../../src/accounts/auth/current-principal';
import { CURRENT_PRINCIPAL_RESOLVER } from '../../src/accounts/auth/current-principal';
import { CurrentPrincipal } from '../../src/accounts/auth/current-principal.decorator';
import { parseAccountId } from '../../src/accounts/domain/account-profile';
import { configureApplication } from '../../src/application';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import {
  createLedgerCommandIdempotencyTestSchemaMigrationV0009,
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
} from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import {
  createSafeLogReference,
  loggingContext,
  structuredLogger,
  StructuredLogger,
  type StructuredLogRecord,
} from '../../src/infrastructure/logging';
import { parseJobEnvelope, type JobEnvelope } from '../../src/infrastructure/outbox/job-envelope';
import { JobOutboxRepository } from '../../src/infrastructure/outbox/job-outbox.repository';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/outbox-dispatcher.service';
import { TransactionalJobPublisher } from '../../src/infrastructure/outbox/transactional-job-publisher.service';
import { SqsJobWorker } from '../../src/infrastructure/sqs/sqs-job.worker';
import { SqsService } from '../../src/infrastructure/sqs/sqs.service';
import { LedgerService } from '../../src/ledger/application/ledger.service';
import { createLedgerCapability } from '../../src/ledger/application/ledger-capability-resolver.port';
import { parseLedgerActorAccountId } from '../../src/ledger/domain/ledger';
import { PostgresLedgerRepository } from '../../src/ledger/infrastructure/postgres-ledger.repository';
import { testInfrastructureConfig, testOutboxDispatcherOptions } from './fixtures';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const API_ROLE = 'crypto_api_runtime';
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const LEDGER_IDEMPOTENCY_MIGRATIONS = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id !== '0010' && id !== '0011' && id !== '0012' && id !== '0013',
);

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

interface CorrelationTraceResponse {
  readonly journalId: string;
}

let handleCorrelationTraceRequest:
  ((principal: AuthenticatedPrincipal) => Promise<CorrelationTraceResponse>) | undefined;

@UseGuards(AccountAuthGuard)
@Controller('test/kan51-ledger-trace')
class Kan51LedgerTraceController {
  @Post()
  async execute(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<CorrelationTraceResponse> {
    if (!handleCorrelationTraceRequest) {
      throw new Error('KAN-51 trace fixture is unavailable');
    }
    return handleCorrelationTraceRequest(principal);
  }
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string, resource = 'PostgreSQL'): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error(`Ledger integration test requires a loopback ${resource} fixture`);
  }
}

async function createKan51TestQueues(
  client: SQSClient,
  maxReceiveCount: number,
): Promise<{ queueUrl: string; deadLetterQueueUrl: string }> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const deadLetter = await client.send(
    new CreateQueueCommand({
      QueueName: `kan51-${suffix}-dlq`,
      Attributes: { MessageRetentionPeriod: '300' },
    }),
  );
  if (!deadLetter.QueueUrl) {
    throw new Error('LocalStack did not return the KAN-51 test DLQ URL');
  }

  const attributes = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: deadLetter.QueueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const deadLetterArn = attributes.Attributes?.QueueArn;
  if (!deadLetterArn) {
    throw new Error('LocalStack did not return the KAN-51 test DLQ ARN');
  }

  const source = await client.send(
    new CreateQueueCommand({
      QueueName: `kan51-${suffix}-jobs`,
      Attributes: {
        VisibilityTimeout: '5',
        ReceiveMessageWaitTimeSeconds: '0',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: deadLetterArn,
          maxReceiveCount: String(maxReceiveCount),
        }),
      },
    }),
  );
  if (!source.QueueUrl) {
    await client.send(new DeleteQueueCommand({ QueueUrl: deadLetter.QueueUrl }));
    throw new Error('LocalStack did not return the KAN-51 test source queue URL');
  }

  return {
    queueUrl: source.QueueUrl,
    deadLetterQueueUrl: deadLetter.QueueUrl,
  };
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
    runner = new MigrationRunner(ledgerPool, LEDGER_IDEMPOTENCY_MIGRATIONS);
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

  it('traces one API request through its committed ledger event, outbox job, and worker', async () => {
    const privateKeyCanary = ['-----BEGIN PRIVATE', 'KEY-----KAN51-canary'].join(' ');
    const tokenCanary = ['Bearer', 'KAN51-token-canary'].join(' ');
    const credentialCanary = [
      'postgresql://kan51-user',
      'kan51-password@private.invalid/database',
    ].join(':');
    const signatureCanary = '0xKAN51-raw-signature-canary';
    const idempotencyCanary = 'KAN51-idempotency-token-canary';
    const apiLines: string[] = [];
    const workerLines: string[] = [];
    const apiLogger = new StructuredLogger({
      workload: 'api',
      environment: { NODE_ENV: 'test' },
      sink: (line) => apiLines.push(line),
    });
    const workerLogger = new StructuredLogger({
      workload: 'worker',
      environment: { NODE_ENV: 'test' },
      sink: (line) => workerLines.push(line),
    });
    const structuredEmit = jest
      .spyOn(structuredLogger, 'emit')
      .mockImplementation((event, level, fields) => workerLogger.emit(event, level, fields));
    const sqsEndpoint = process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566';
    requireLoopback(sqsEndpoint, 'SQS');
    const sqsClient = new SQSClient({
      endpoint: sqsEndpoint,
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      maxAttempts: 1,
    });
    let app: INestApplication | undefined;
    let queueUrl: string | undefined;
    let deadLetterQueueUrl: string | undefined;
    const traceDatabase = `kan51_${randomUUID().replaceAll('-', '')}`;
    let traceDatabaseCreated = false;
    let tracePool: Pool | undefined;

    try {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(traceDatabase)}`);
      traceDatabaseCreated = true;
      const traceDatabaseUrl = new URL(testDatabaseUrl as string);
      traceDatabaseUrl.pathname = `/${traceDatabase}`;
      const activeTracePool = new Pool({
        connectionString: traceDatabaseUrl.toString(),
        max: 6,
      });
      tracePool = activeTracePool;
      const traceMigrations = new MigrationRunner(activeTracePool, LEDGER_IDEMPOTENCY_MIGRATIONS);
      await expect(traceMigrations.up()).resolves.toEqual([
        '0001',
        '0002',
        '0003',
        '0004',
        '0006',
        '0007',
        '0008',
        '0009',
      ]);
      const client = await activeTracePool.connect();
      const fixture = await provisionPostingPlan(client);
      client.release();
      await advanceLegToSubmitted(activeTracePool, fixture);

      const queues = await createKan51TestQueues(sqsClient, 3);
      queueUrl = queues.queueUrl;
      deadLetterQueueUrl = queues.deadLetterQueueUrl;
      const jobConfig = testInfrastructureConfig({
        endpoint: sqsEndpoint,
        queueUrl,
        deadLetterQueueUrl,
        requestTimeoutMs: 5_000,
        visibilityTimeoutSeconds: 5,
      });
      const postgres = new PostgresService(activeTracePool);
      const outboxRepository = new JobOutboxRepository(postgres);
      const publisher = new TransactionalJobPublisher(outboxRepository);
      const ledgerRepository = new PostgresLedgerRepository(postgres, publisher);
      handleCorrelationTraceRequest = async (principal) => {
        const actorAccountId = parseLedgerActorAccountId(principal.accountId);
        const ledger = new LedgerService(
          ledgerRepository,
          { resolve: async () => actorAccountId },
          {
            resolvePosting: async () => createLedgerCapability('POST', fixture.postToken),
            resolveReversal: async () => null,
          },
        );
        const journalId = await ledger.postJournal(
          {
            bookId: fixture.bookId,
            transactionId: fixture.transactionId,
            legId: fixture.legId,
            economicEventType: 'SETTLEMENT',
            effectiveAt: fixture.effectiveAt,
            observedAt: fixture.observedAt,
            reason: 'CHAIN_FINALITY_CONFIRMED',
            postings: [
              {
                accountId: fixture.sourceAccountId,
                assetRevisionId: fixture.assetRevisionId,
                side: 'CREDIT',
                amountAtomic: '100',
              },
              {
                accountId: fixture.destinationAccountId,
                assetRevisionId: fixture.assetRevisionId,
                side: 'DEBIT',
                amountAtomic: '100',
              },
            ],
          },
          idempotencyCanary,
        );
        return { journalId };
      };

      const testingModule = await Test.createTestingModule({
        controllers: [Kan51LedgerTraceController],
        providers: [
          AccountAuthGuard,
          {
            provide: CURRENT_PRINCIPAL_RESOLVER,
            useValue: {
              resolve: (requestValue: unknown) => {
                const authorization = (requestValue as { headers?: { authorization?: unknown } })
                  .headers?.authorization;
                return authorization === tokenCanary
                  ? { accountId: parseAccountId(fixture.actorAccountId) }
                  : null;
              },
            },
          },
        ],
      }).compile();
      app = testingModule.createNestApplication();
      configureApplication(app, { requestLogger: apiLogger });
      await app.init();

      const response = await request(app.getHttpServer())
        .post('/api/v1/test/kan51-ledger-trace')
        .query({ accessToken: tokenCanary })
        .set('Authorization', tokenCanary)
        .set('X-Account-Id', randomUUID())
        .set('X-Provider-Credential', credentialCanary)
        .set('X-Wallet-Signature', signatureCanary)
        .send({ privateKey: privateKeyCanary })
        .expect(201);
      const requestId = response.headers['x-request-id'];
      const journalId = (response.body as CorrelationTraceResponse).journalId;
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(journalId).toMatch(/^[0-9a-f-]{36}$/u);

      const apiRecords = apiLines.map((line) => JSON.parse(line) as StructuredLogRecord);
      expect(apiRecords).toHaveLength(1);
      expect(apiRecords[0]).toMatchObject({
        event: 'http.request.completed',
        workload: 'api',
        correlationId: requestId,
        requestId,
        initiatorActorId: fixture.actorAccountId,
        method: 'POST',
        statusCode: 201,
        outcome: 'success',
      });

      const trace = await activeTracePool.query<{
        correlation_id: string;
        journal_id: string;
        outbox_id: string;
        payload: unknown;
        status: string;
        transaction_id: string;
      }>(
        `SELECT journal.journal_id,
                journal.transaction_id,
                journal.correlation_id,
                outbox.id AS outbox_id,
                outbox.payload,
                outbox.status
         FROM ledger_journals AS journal
         INNER JOIN job_outbox AS outbox
           ON outbox.ledger_journal_id = journal.journal_id
         WHERE journal.journal_id = $1`,
        [journalId],
      );
      expect(trace.rows).toHaveLength(1);
      const traceRow = trace.rows[0];
      expect(traceRow).toMatchObject({
        journal_id: journalId,
        transaction_id: fixture.transactionId,
        correlation_id: requestId,
        status: 'pending',
      });
      const envelope = parseJobEnvelope(traceRow?.payload);
      expect(envelope).toMatchObject({
        id: traceRow?.outbox_id,
        kind: 'ledger.journal-committed',
        version: 1,
        correlation: {
          correlationId: requestId,
          requestId,
          initiatorActorId: fixture.actorAccountId,
          transactionId: fixture.transactionId,
          ledgerEventId: journalId,
        },
        payload: { journalId, operation: 'POST_JOURNAL' },
      });

      const sqs = new SqsService(sqsClient, jobConfig);
      const dispatcher = new OutboxDispatcher(
        outboxRepository,
        sqs,
        testOutboxDispatcherOptions({ batchSize: 1, concurrency: 1 }),
      );
      await expect(dispatcher.dispatchBatch()).resolves.toEqual({
        claimed: 1,
        published: 1,
        retried: 0,
        failed: 0,
        leaseLost: 0,
      });

      let handlerContext: unknown;
      let handledJob: JobEnvelope | undefined;
      const worker = new SqsJobWorker(sqs, jobConfig);
      await expect(
        worker.processOne(async (job) => {
          handlerContext = loggingContext.current();
          handledJob = job;
        }),
      ).resolves.toMatchObject({
        status: 'completed',
        jobId: traceRow?.outbox_id,
      });
      expect(handledJob).toEqual(envelope);
      expect(handlerContext).toMatchObject({
        correlationId: requestId,
        requestId,
        initiatorActorId: fixture.actorAccountId,
        transactionId: fixture.transactionId,
        ledgerEventId: journalId,
        jobId: createSafeLogReference('job', traceRow?.outbox_id),
      });

      const workerRecords = workerLines.map((line) => JSON.parse(line) as StructuredLogRecord);
      for (const event of ['job.published', 'job.processed']) {
        expect(workerRecords).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event,
              workload: 'worker',
              correlationId: requestId,
              requestId,
              initiatorActorId: fixture.actorAccountId,
              transactionId: fixture.transactionId,
              ledgerEventId: journalId,
              jobId: createSafeLogReference('job', traceRow?.outbox_id),
              jobKind: 'ledger.journal-committed',
              outcome: 'success',
            }),
          ]),
        );
      }
      for (const record of [...apiRecords, ...workerRecords]) {
        expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
      }

      const capturedOutput = [...apiLines, ...workerLines, JSON.stringify(traceRow?.payload)].join(
        '\n',
      );
      for (const prohibited of [
        privateKeyCanary,
        tokenCanary,
        credentialCanary,
        signatureCanary,
        idempotencyCanary,
        fixture.postToken,
      ]) {
        expect(capturedOutput).not.toContain(prohibited);
      }
      expect(workerLines.join('\n')).not.toContain(traceRow?.outbox_id);
    } finally {
      handleCorrelationTraceRequest = undefined;
      structuredEmit.mockRestore();
      if (app) await app.close();
      if (queueUrl) {
        await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
      }
      if (deadLetterQueueUrl) {
        await sqsClient
          .send(new DeleteQueueCommand({ QueueUrl: deadLetterQueueUrl }))
          .catch(() => undefined);
      }
      if (tracePool) await tracePool.end();
      if (traceDatabaseCreated) {
        await adminPool.query(`DROP DATABASE ${quoteIdentifier(traceDatabase)}`);
      }
      sqsClient.destroy();
    }
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
