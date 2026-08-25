import { randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const API_ROLE = 'crypto_api_runtime';
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

interface LedgerFixture {
  actorAccountId: string;
  assetRevisionId: string;
  bookId: string;
  configurationV1Id: string;
  configurationV2Id: string;
  feeEstimateV1Id: string;
  feeEstimateV2Id: string;
  feeRuleV1Id: string;
  feeRuleV2Id: string;
  payerAccountId: string;
  providerAccountId: string;
  providerRevisionId: string;
  quoteV1Id: string;
  quoteV1LegId: string;
  quoteV1RouteId: string;
  quoteV1TransactionId: string;
  quoteV2Id: string;
  quoteV2LegId: string;
  quoteV2RouteId: string;
  quoteV2TransactionId: string;
}

type FeeEventType = 'ACTUAL_FEE' | 'ADJUSTMENT';
type FeeReasonCode = 'ACTUAL_FEE_CONFIRMED' | 'ACCOUNTING_ADJUSTMENT_APPROVED';

interface FeePostingPlan {
  amountAtomic: string;
  effectiveAt: Date;
  eventType: FeeEventType;
  legId: string;
  observedAt: Date;
  postings: string;
  postToken: string;
  reasonCode: FeeReasonCode;
  transactionId: string;
}

interface FeePostingPlanInput {
  adjustsFeeComponentId: string | null;
  amountAtomic: string;
  effectiveAt: Date;
  eventType: FeeEventType;
  feeEstimateSnapshotId: string | null;
  feeRuleReferenceId: string;
  legId: string;
  observedAt: Date;
  quoteReferenceId: string;
  transactionId: string;
}

interface ReversalFixture {
  effectiveAt: Date;
  observedAt: Date;
  reasonCode: 'SOURCE_EVIDENCE_CORRECTED';
  reverseToken: string;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('KAN-78 fee snapshot integration test requires loopback PostgreSQL');
  }
}

async function queryAsRole<Row extends QueryResultRow>(
  pool: Pool,
  role: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
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

async function insertQuoteFeeSnapshot(
  client: PoolClient,
  input: {
    actorAccountId: string;
    amountAtomic: string;
    assetRevisionId: string;
    bookId: string;
    configurationRevisionId: string;
    feeEstimateSnapshotId: string;
    feeRuleReferenceId: string;
    legId: string;
    payerAccountId: string;
    providerAccountId: string;
    providerRevisionId: string;
    quoteReferenceId: string;
    routeReferenceId: string;
    transactionId: string;
    valuationSnapshotId: string;
  },
): Promise<void> {
  const observedAt = new Date(Date.now() - 600_000);
  await client.query(
    `INSERT INTO ledger_valuation_snapshots (
       valuation_snapshot_id, book_id, transaction_id, leg_id, tenant_account_id,
       journal_id, purpose, valuation_plan_line_number, valuation_role,
       fee_plan_line_number, availability, asset_revision_id,
       valued_amount_atomic, rounding_mode, source_reference_id,
       source_policy_reference_id, evidence_reference_id, observed_at,
       freshness_class, confidence_class, depeg_class
     ) VALUES (
       $1, $2, $3, $4, $5, NULL, 'QUOTE', NULL, 'FEE_COMPONENT', NULL,
       'UNAVAILABLE', $6, $7::numeric, 'ROUND_HALF_EVEN', $8, $9, $10, $11,
       'UNAVAILABLE', 'UNAVAILABLE', 'NOT_ASSESSED'
     )`,
    [
      input.valuationSnapshotId,
      input.bookId,
      input.transactionId,
      input.legId,
      input.actorAccountId,
      input.assetRevisionId,
      input.amountAtomic,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      observedAt,
    ],
  );
  await client.query(
    `INSERT INTO ledger_fee_estimate_snapshots (
       fee_estimate_snapshot_id, book_id, transaction_id, leg_id,
       tenant_account_id, estimate_line_number, quote_reference_id,
       route_reference_id, fee_rule_reference_id,
       provider_revision_reference_id, configuration_revision_reference_id,
       category, deduction_mode, asset_revision_id, amount_atomic,
       payer_account_id, recipient_account_id, valuation_snapshot_id,
       evidence_reference_type, evidence_environment, evidence_namespace_type,
       evidence_source_reference_id, evidence_policy_reference_id,
       evidence_revision_reference_id, canonical_locator_reference_id,
       external_locator_digest, evidence_observed_at
     ) VALUES (
       $1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10,
       'PROVIDER', 'ADDED_ON_TOP', $11, $12::numeric, $13, $14, $15,
       'QUOTE', 'TEST', 'QUOTE', $16, $17, $18, $19, $20, $21
     )`,
    [
      input.feeEstimateSnapshotId,
      input.bookId,
      input.transactionId,
      input.legId,
      input.actorAccountId,
      input.quoteReferenceId,
      input.routeReferenceId,
      input.feeRuleReferenceId,
      input.providerRevisionId,
      input.configurationRevisionId,
      input.assetRevisionId,
      input.amountAtomic,
      input.payerAccountId,
      input.providerAccountId,
      input.valuationSnapshotId,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomBytes(32),
      observedAt,
    ],
  );
}

async function provisionLedgerFixture(client: PoolClient): Promise<LedgerFixture> {
  const actorAccountId = randomUUID();
  const assetRevisionId = randomUUID();
  const book = await client.query<{ book_id: string }>(
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
  );
  const bookId = book.rows[0]?.book_id;
  if (!bookId) throw new Error('Operational ledger book was not provisioned');

  const fixture: LedgerFixture = {
    actorAccountId,
    assetRevisionId,
    bookId,
    configurationV1Id: randomUUID(),
    configurationV2Id: randomUUID(),
    feeEstimateV1Id: randomUUID(),
    feeEstimateV2Id: randomUUID(),
    feeRuleV1Id: randomUUID(),
    feeRuleV2Id: randomUUID(),
    payerAccountId: randomUUID(),
    providerAccountId: randomUUID(),
    providerRevisionId: randomUUID(),
    quoteV1Id: randomUUID(),
    quoteV1LegId: randomUUID(),
    quoteV1RouteId: randomUUID(),
    quoteV1TransactionId: randomUUID(),
    quoteV2Id: randomUUID(),
    quoteV2LegId: randomUUID(),
    quoteV2RouteId: randomUUID(),
    quoteV2TransactionId: randomUUID(),
  };

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO accounts (account_id, eligibility_status)
       VALUES ($1::uuid, 'UNKNOWN')`,
      [fixture.actorAccountId],
    );
    await client.query(
      `INSERT INTO ledger_assets (
         asset_revision_id, asset_id, definition_revision,
         network_reference_id, asset_kind, settlement_identity_digest,
         base_unit_decimals, metadata_source_reference_id
       ) VALUES ($1, $2, 1, $3, 'NATIVE', $4, 6, $5)`,
      [fixture.assetRevisionId, randomUUID(), randomUUID(), randomBytes(32), randomUUID()],
    );
    await client.query(
      `INSERT INTO ledger_accounts (
         ledger_account_id, book_id, asset_revision_id, owner_kind,
         owner_account_id, counterparty_reference_id, location_kind,
         location_reference_id, account_role
       ) VALUES
         ($1, $3, $4, 'ACCOUNT', $5, NULL, 'WALLET', $6, 'POSITION'),
         ($2, $3, $4, 'PROVIDER', NULL, $7, 'PROVIDER', $8, 'FEE_SINK')`,
      [
        fixture.payerAccountId,
        fixture.providerAccountId,
        fixture.bookId,
        fixture.assetRevisionId,
        fixture.actorAccountId,
        randomUUID(),
        fixture.providerRevisionId,
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO ledger_transactions (
         transaction_id, tenant_account_id, book_id, intent_type,
         quote_snapshot_reference_id, route_revision_reference_id,
         configuration_revision_reference_id
       ) VALUES
         ($1, $3, $4, 'FEE_ONLY', $5, $6, $7),
         ($2, $3, $4, 'FEE_ONLY', $8, $9, $10)`,
      [
        fixture.quoteV1TransactionId,
        fixture.quoteV2TransactionId,
        fixture.actorAccountId,
        fixture.bookId,
        fixture.quoteV1Id,
        fixture.quoteV1RouteId,
        fixture.configurationV1Id,
        fixture.quoteV2Id,
        fixture.quoteV2RouteId,
        fixture.configurationV2Id,
      ],
    );
    await client.query(
      `INSERT INTO ledger_legs (
         leg_id, transaction_id, book_id, tenant_account_id, leg_sequence,
         leg_kind, asset_revision_id, source_account_id,
         destination_account_id, expected_amount_atomic
       ) VALUES
         ($1, $3, $5, $6, 1, 'FEE_PAYMENT', $7, $8, $9, 80),
         ($2, $4, $5, $6, 1, 'FEE_PAYMENT', $7, $8, $9, 70)`,
      [
        fixture.quoteV1LegId,
        fixture.quoteV2LegId,
        fixture.quoteV1TransactionId,
        fixture.quoteV2TransactionId,
        fixture.bookId,
        fixture.actorAccountId,
        fixture.assetRevisionId,
        fixture.payerAccountId,
        fixture.providerAccountId,
      ],
    );
    await insertQuoteFeeSnapshot(client, {
      ...fixture,
      amountAtomic: '100',
      configurationRevisionId: fixture.configurationV1Id,
      feeEstimateSnapshotId: fixture.feeEstimateV1Id,
      feeRuleReferenceId: fixture.feeRuleV1Id,
      legId: fixture.quoteV1LegId,
      quoteReferenceId: fixture.quoteV1Id,
      routeReferenceId: fixture.quoteV1RouteId,
      transactionId: fixture.quoteV1TransactionId,
      valuationSnapshotId: randomUUID(),
    });
    await insertQuoteFeeSnapshot(client, {
      ...fixture,
      amountAtomic: '70',
      configurationRevisionId: fixture.configurationV2Id,
      feeEstimateSnapshotId: fixture.feeEstimateV2Id,
      feeRuleReferenceId: fixture.feeRuleV2Id,
      legId: fixture.quoteV2LegId,
      quoteReferenceId: fixture.quoteV2Id,
      routeReferenceId: fixture.quoteV2RouteId,
      transactionId: fixture.quoteV2TransactionId,
      valuationSnapshotId: randomUUID(),
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return fixture;
}

async function provisionAdjustmentLeg(
  client: PoolClient,
  fixture: LedgerFixture,
  adjustedJournalId: string,
): Promise<{ legId: string; transactionId: string }> {
  const transactionId = randomUUID();
  const legId = randomUUID();
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO ledger_transactions (
         transaction_id, tenant_account_id, book_id, intent_type,
         quote_snapshot_reference_id, route_revision_reference_id,
         configuration_revision_reference_id
       ) VALUES ($1, $2, $3, 'ADJUSTMENT', $4, $5, $6)`,
      [
        transactionId,
        fixture.actorAccountId,
        fixture.bookId,
        fixture.quoteV1Id,
        fixture.quoteV1RouteId,
        fixture.configurationV1Id,
      ],
    );
    await client.query(
      `INSERT INTO ledger_legs (
         leg_id, transaction_id, book_id, tenant_account_id, leg_sequence,
         leg_kind, asset_revision_id, source_account_id,
         destination_account_id, expected_amount_atomic, adjusts_journal_id
       ) VALUES ($1, $2, $3, $4, 1, 'ADJUSTMENT', $5, $6, $7, 20, $8)`,
      [
        legId,
        transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        fixture.assetRevisionId,
        fixture.payerAccountId,
        fixture.providerAccountId,
        adjustedJournalId,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { legId, transactionId };
}

async function provisionFeePostingPlan(
  client: PoolClient,
  fixture: LedgerFixture,
  input: FeePostingPlanInput,
): Promise<FeePostingPlan> {
  const postingPlanId = randomUUID();
  const postToken = randomBytes(32).toString('hex');
  const reasonCode: FeeReasonCode =
    input.eventType === 'ACTUAL_FEE' ? 'ACTUAL_FEE_CONFIRMED' : 'ACCOUNTING_ADJUSTMENT_APPROVED';

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO ledger_leg_posting_plans (
         posting_plan_id, leg_id, transaction_id, book_id,
         tenant_account_id, economic_event_type, reason_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        postingPlanId,
        input.legId,
        input.transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        input.eventType,
        reasonCode,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_posting_plan_lines (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         plan_line_number, ledger_account_id, asset_revision_id, side,
         amount_atomic
       ) VALUES
         ($1, $2, $3, $4, $5, 1, $6, $8, 'CREDIT', $9::numeric),
         ($1, $2, $3, $4, $5, 2, $7, $8, 'DEBIT', $9::numeric)`,
      [
        postingPlanId,
        input.legId,
        input.transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        fixture.payerAccountId,
        fixture.providerAccountId,
        fixture.assetRevisionId,
        input.amountAtomic,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_recognition_evidence (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         reference_type, environment, namespace_type, source_reference_id,
         canonical_locator_reference_id, external_locator_digest,
         recognition_policy_reference_id,
         recognition_evidence_revision_reference_id, effective_at, observed_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'FINALITY_EVIDENCE', 'TEST', 'EVIDENCE',
         $6, $7, $8, $9, $10, $11, $12
       )`,
      [
        postingPlanId,
        input.legId,
        input.transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        randomUUID(),
        randomUUID(),
        randomBytes(32),
        randomUUID(),
        randomUUID(),
        input.effectiveAt,
        input.observedAt,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_fee_plans (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         fee_plan_line_number, category, asset_revision_id, amount_atomic,
         payer_account_id, recipient_account_id, payer_line_number,
         recipient_line_number, payer_allocation_amount_atomic, deduction_mode,
         fee_rule_reference_id, quote_reference_id, fee_estimate_snapshot_id,
         adjusts_fee_component_id, evidence_reference_type,
         evidence_environment, evidence_namespace_type,
         evidence_source_reference_id, evidence_policy_reference_id,
         evidence_revision_reference_id, canonical_locator_reference_id,
         external_locator_digest, evidence_observed_at
       ) VALUES (
         $1, $2, $3, $4, $5, 1, 'PROVIDER', $6, $7::numeric,
         $8, $9, 1, 2, $7::numeric, 'ADDED_ON_TOP', $10, $11, $12, $13,
         'PROVIDER_EVENT', 'TEST', 'PROVIDER', $14, $15, $16, $17, $18, $19
       )`,
      [
        postingPlanId,
        input.legId,
        input.transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        fixture.assetRevisionId,
        input.amountAtomic,
        fixture.payerAccountId,
        fixture.providerAccountId,
        input.feeRuleReferenceId,
        input.quoteReferenceId,
        input.feeEstimateSnapshotId,
        input.adjustsFeeComponentId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomBytes(32),
        input.observedAt,
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_valuation_plans (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         valuation_plan_line_number, valuation_role, fee_plan_line_number,
         asset_revision_id, availability, valued_amount_atomic, rounding_mode,
         source_reference_id, source_policy_reference_id, evidence_reference_id,
         observed_at, freshness_class, confidence_class, depeg_class
       ) VALUES
         (
           $1, $2, $3, $4, $5, 1, 'JOURNAL_ASSET_TOTAL', NULL, $6,
           'UNAVAILABLE', $7::numeric, 'ROUND_HALF_EVEN', $8, $9, $10, $11,
           'UNAVAILABLE', 'UNAVAILABLE', 'NOT_ASSESSED'
         ),
         (
           $1, $2, $3, $4, $5, 2, 'FEE_COMPONENT', 1, $6,
           'UNAVAILABLE', $7::numeric, 'ROUND_HALF_EVEN', $12, $13, $14, $11,
           'UNAVAILABLE', 'UNAVAILABLE', 'NOT_ASSESSED'
         )`,
      [
        postingPlanId,
        input.legId,
        input.transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        fixture.assetRevisionId,
        input.amountAtomic,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        input.observedAt,
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO ledger_leg_posting_plan_seals (
         posting_plan_id, leg_id, transaction_id, book_id, tenant_account_id,
         economic_event_type, sealed_plan_digest, approval_reference_id
       ) SELECT $1, $2, $3, $4, $5, $6,
                compute_ledger_posting_plan_digest($1), $7`,
      [
        postingPlanId,
        input.legId,
        input.transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        input.eventType,
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
           pg_catalog.convert_to('KAN41:POST:v1', 'UTF8') ||
             pg_catalog.decode($2, 'hex')
         ),
         seal.sealed_plan_digest, $3, $4, $5, $6, $7, $7, $8,
         seal.approval_reference_id, clock_timestamp() + interval '1 hour'
       FROM ledger_leg_posting_plan_seals AS seal
       WHERE seal.posting_plan_id = $3`,
      [
        randomUUID(),
        postToken,
        postingPlanId,
        input.legId,
        input.transactionId,
        fixture.bookId,
        fixture.actorAccountId,
        randomUUID(),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return {
    amountAtomic: input.amountAtomic,
    effectiveAt: input.effectiveAt,
    eventType: input.eventType,
    legId: input.legId,
    observedAt: input.observedAt,
    postings: JSON.stringify([
      {
        accountId: fixture.payerAccountId,
        assetRevisionId: fixture.assetRevisionId,
        side: 'CREDIT',
        amountAtomic: input.amountAtomic,
      },
      {
        accountId: fixture.providerAccountId,
        assetRevisionId: fixture.assetRevisionId,
        side: 'DEBIT',
        amountAtomic: input.amountAtomic,
      },
    ]),
    postToken,
    reasonCode,
    transactionId: input.transactionId,
  };
}

async function postFeePlan(
  pool: Pool,
  fixture: LedgerFixture,
  posting: FeePostingPlan,
): Promise<string> {
  const result = await queryAsRole<{ journal_id: string }>(
    pool,
    API_ROLE,
    `SELECT post_ledger_journal_with_lifecycle(
       $1::text, $2::uuid, $3::uuid, $4::uuid, $5::text,
       $6::timestamptz, $7::timestamptz, $8::text, $9::uuid, $10::text
     ) AS journal_id`,
    [
      posting.postToken,
      fixture.bookId,
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
  const journalId = result.rows[0]?.journal_id;
  if (!journalId) throw new Error('Fee posting did not return a journal');
  return journalId;
}

async function advanceLegToSubmitted(
  pool: Pool,
  fixture: LedgerFixture,
  transactionId: string,
  legId: string,
): Promise<void> {
  const transitions = [
    [null, 'CREATED', 'INTENT_CREATED'],
    ['CREATED', 'QUOTED', 'QUOTE_CREATED'],
    ['QUOTED', 'USER_APPROVED', 'USER_APPROVAL_RECORDED'],
    ['USER_APPROVED', 'SUBMITTED', 'SUBMISSION_RECORDED'],
  ] as const;
  for (const [transitionIndex, [expectedState, nextState, reasonCode]] of transitions.entries()) {
    await queryAsRole(
      pool,
      API_ROLE,
      `SELECT transition_ledger_leg_state(
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
         $6::text, $7::timestamptz, $8::uuid
       )`,
      [
        fixture.actorAccountId,
        transactionId,
        legId,
        expectedState,
        nextState,
        reasonCode,
        new Date(Date.now() - 900_000 + transitionIndex * 1_000),
        randomUUID(),
      ],
    );
  }
}

async function provisionReversal(
  client: PoolClient,
  fixture: LedgerFixture,
  posting: FeePostingPlan,
  originalJournalId: string,
): Promise<ReversalFixture> {
  const reversalApprovalId = randomUUID();
  const approvalReferenceId = randomUUID();
  const effectiveAt = new Date(Date.now() - 60_000);
  const observedAt = new Date(Date.now() - 30_000);
  const reverseToken = randomBytes(32).toString('hex');

  await client.query('BEGIN');
  try {
    // KAN-42 owns approval provisioning. This remains an owner-only local fixture.
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
         $1, $2, $3, $4, $5, $6, 'SOURCE_EVIDENCE_CORRECTED', $7,
         $8, 'PROVIDER_EVENT', 'TEST', 'PROVIDER', $9, $10, $11, $12, $13,
         pg_catalog.decode(repeat('00', 32), 'hex')
       )`,
      [
        reversalApprovalId,
        originalJournalId,
        posting.transactionId,
        posting.legId,
        fixture.bookId,
        fixture.actorAccountId,
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
           pg_catalog.convert_to('KAN41:REVERSE:v1', 'UTF8') ||
             pg_catalog.decode($2, 'hex')
         ),
         approval.sealed_approval_digest, approval.reversal_approval_id,
         approval.original_journal_id, approval.leg_id, approval.transaction_id,
         approval.book_id, approval.tenant_account_id,
         approval.tenant_account_id, $3, approval.approval_reference_id,
         clock_timestamp() + interval '1 hour'
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
    reasonCode: 'SOURCE_EVIDENCE_CORRECTED',
    reverseToken,
  };
}

async function reverseJournal(
  pool: Pool,
  originalJournalId: string,
  reversal: ReversalFixture,
): Promise<string> {
  const result = await queryAsRole<{ journal_id: string }>(
    pool,
    API_ROLE,
    `SELECT reverse_ledger_journal_with_lifecycle(
       $1::text, $2::uuid, $3::text, $4::timestamptz,
       $5::timestamptz, $6::uuid
     ) AS journal_id`,
    [
      reversal.reverseToken,
      originalJournalId,
      reversal.reasonCode,
      reversal.effectiveAt,
      reversal.observedAt,
      randomUUID(),
    ],
  );
  const journalId = result.rows[0]?.journal_id;
  if (!journalId) throw new Error('Fee reversal did not return a journal');
  return journalId;
}

async function signedAccountTotals(
  pool: Pool,
  journalIds: readonly string[],
): Promise<Record<string, string>> {
  const result = await pool.query<{ ledger_account_id: string; signed_total: string }>(
    `SELECT line.ledger_account_id,
            sum(
              CASE WHEN line.side = 'DEBIT'
                THEN line.amount_atomic ELSE -line.amount_atomic
              END
            )::text AS signed_total
     FROM ledger_journal_lines AS line
     WHERE line.journal_id = ANY($1::uuid[])
     GROUP BY line.ledger_account_id`,
    [journalIds],
  );
  return Object.fromEntries(result.rows.map((row) => [row.ledger_account_id, row.signed_total]));
}

describeWithPostgres('KAN-78 immutable fee snapshot PostgreSQL integration', () => {
  jest.setTimeout(60_000);

  const schema = `kan78_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let ledgerPool: Pool;
  let runner: MigrationRunner;

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const fixtureIdentity = await adminPool.query<{
      bootstrap_role: string;
      database: string;
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
      max: 4,
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
      '0010',
      '0011',
      '0012',
      '0013',
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

  it('reaches the repair from an already-applied 0012 chain', async () => {
    const upgradeSchema = `kan78_upgrade_${randomUUID().replaceAll('-', '')}`;
    let upgradePool: Pool | undefined;
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(upgradeSchema)}`);
    try {
      upgradePool = new Pool({
        connectionString: testDatabaseUrl as string,
        max: 1,
        options: `-c search_path=${upgradeSchema}`,
      });
      const migrationsThrough0012 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
        ({ id }) => id !== '0013',
      );
      const preRepairRunner = new MigrationRunner(upgradePool, migrationsThrough0012);
      await expect(preRepairRunner.up()).resolves.toEqual([
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
      ]);
      await expect(preRepairRunner.assertUpToDate()).resolves.toBeUndefined();

      const repairRunner = new MigrationRunner(upgradePool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
      await expect(repairRunner.up()).resolves.toEqual(['0013']);
      await expect(repairRunner.assertUpToDate()).resolves.toBeUndefined();
    } finally {
      if (upgradePool) await upgradePool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(upgradeSchema)} CASCADE`);
    }
  });

  it('preserves quote revisions and settles fee changes with append-only facts', async () => {
    const fixtureOwner = await ledgerPool.connect();
    let fixture: LedgerFixture;
    try {
      fixture = await provisionLedgerFixture(fixtureOwner);
    } finally {
      fixtureOwner.release();
    }

    const quoteSnapshots = await ledgerPool.query<{
      amount_atomic: string;
      configuration_revision_reference_id: string;
      fee_estimate_snapshot_id: string;
      fee_rule_reference_id: string;
      quote_reference_id: string;
    }>(
      `SELECT fee_estimate_snapshot_id, quote_reference_id,
              fee_rule_reference_id, configuration_revision_reference_id,
              amount_atomic::text
       FROM ledger_fee_estimate_snapshots
       WHERE fee_estimate_snapshot_id = ANY($1::uuid[])`,
      [[fixture.feeEstimateV1Id, fixture.feeEstimateV2Id]],
    );
    expect(quoteSnapshots.rows).toEqual(
      expect.arrayContaining([
        {
          amount_atomic: '100',
          configuration_revision_reference_id: fixture.configurationV1Id,
          fee_estimate_snapshot_id: fixture.feeEstimateV1Id,
          fee_rule_reference_id: fixture.feeRuleV1Id,
          quote_reference_id: fixture.quoteV1Id,
        },
        {
          amount_atomic: '70',
          configuration_revision_reference_id: fixture.configurationV2Id,
          fee_estimate_snapshot_id: fixture.feeEstimateV2Id,
          fee_rule_reference_id: fixture.feeRuleV2Id,
          quote_reference_id: fixture.quoteV2Id,
        },
      ]),
    );
    await expect(
      ledgerPool.query(
        `UPDATE ledger_fee_estimate_snapshots
         SET amount_atomic = 999
         WHERE fee_estimate_snapshot_id = $1`,
        [fixture.feeEstimateV1Id],
      ),
    ).rejects.toMatchObject({ code: '55000' });

    const actualOwner = await ledgerPool.connect();
    let actualPosting: FeePostingPlan;
    try {
      actualPosting = await provisionFeePostingPlan(actualOwner, fixture, {
        adjustsFeeComponentId: null,
        amountAtomic: '80',
        effectiveAt: new Date(Date.now() - 480_000),
        eventType: 'ACTUAL_FEE',
        feeEstimateSnapshotId: fixture.feeEstimateV1Id,
        feeRuleReferenceId: fixture.feeRuleV1Id,
        legId: fixture.quoteV1LegId,
        observedAt: new Date(Date.now() - 420_000),
        quoteReferenceId: fixture.quoteV1Id,
        transactionId: fixture.quoteV1TransactionId,
      });
    } finally {
      actualOwner.release();
    }
    await advanceLegToSubmitted(
      ledgerPool,
      fixture,
      fixture.quoteV1TransactionId,
      fixture.quoteV1LegId,
    );
    const actualJournalId = await postFeePlan(ledgerPool, fixture, actualPosting);
    const actualFee = await ledgerPool.query<{
      adjusts_fee_component_id: string | null;
      amount_atomic: string;
      fee_component_id: string;
      fee_estimate_snapshot_id: string | null;
      stage: string;
    }>(
      `SELECT fee_component_id, fee_estimate_snapshot_id, stage,
              amount_atomic::text, adjusts_fee_component_id
       FROM ledger_fee_components
       WHERE journal_id = $1`,
      [actualJournalId],
    );
    expect(actualFee.rows).toEqual([
      {
        adjusts_fee_component_id: null,
        amount_atomic: '80',
        fee_component_id: expect.any(String),
        fee_estimate_snapshot_id: fixture.feeEstimateV1Id,
        stage: 'ACTUAL',
      },
    ]);
    const actualFeeComponentId = actualFee.rows[0]?.fee_component_id;
    if (!actualFeeComponentId) throw new Error('Actual fee component was not posted');
    await expect(signedAccountTotals(ledgerPool, [actualJournalId])).resolves.toEqual({
      [fixture.payerAccountId]: '-80',
      [fixture.providerAccountId]: '80',
    });

    const adjustmentOwner = await ledgerPool.connect();
    let adjustmentPosting: FeePostingPlan;
    try {
      const adjustmentLeg = await provisionAdjustmentLeg(adjustmentOwner, fixture, actualJournalId);
      await advanceLegToSubmitted(
        ledgerPool,
        fixture,
        adjustmentLeg.transactionId,
        adjustmentLeg.legId,
      );
      adjustmentPosting = await provisionFeePostingPlan(adjustmentOwner, fixture, {
        adjustsFeeComponentId: actualFeeComponentId,
        amountAtomic: '20',
        effectiveAt: new Date(Date.now() - 180_000),
        eventType: 'ADJUSTMENT',
        feeEstimateSnapshotId: null,
        feeRuleReferenceId: fixture.feeRuleV1Id,
        legId: adjustmentLeg.legId,
        observedAt: new Date(Date.now() - 120_000),
        quoteReferenceId: fixture.quoteV1Id,
        transactionId: adjustmentLeg.transactionId,
      });
    } finally {
      adjustmentOwner.release();
    }
    const adjustmentJournalId = await postFeePlan(ledgerPool, fixture, adjustmentPosting);
    const adjustmentFee = await ledgerPool.query<{
      adjusts_fee_component_id: string | null;
      amount_atomic: string;
      fee_component_id: string;
      fee_estimate_snapshot_id: string | null;
      reverses_fee_component_id: string | null;
      stage: string;
    }>(
      `SELECT fee_component_id, fee_estimate_snapshot_id, stage,
              amount_atomic::text, adjusts_fee_component_id,
              reverses_fee_component_id
       FROM ledger_fee_components
       WHERE journal_id = $1`,
      [adjustmentJournalId],
    );
    expect(adjustmentFee.rows).toEqual([
      {
        adjusts_fee_component_id: actualFeeComponentId,
        amount_atomic: '20',
        fee_component_id: expect.any(String),
        fee_estimate_snapshot_id: null,
        reverses_fee_component_id: null,
        stage: 'ADJUSTMENT',
      },
    ]);
    const adjustmentFeeComponentId = adjustmentFee.rows[0]?.fee_component_id;
    if (!adjustmentFeeComponentId) {
      throw new Error('Adjustment fee component was not posted');
    }
    await expect(
      signedAccountTotals(ledgerPool, [actualJournalId, adjustmentJournalId]),
    ).resolves.toEqual({
      [fixture.payerAccountId]: '-100',
      [fixture.providerAccountId]: '100',
    });

    const reversalOwner = await ledgerPool.connect();
    let reversal: ReversalFixture;
    try {
      reversal = await provisionReversal(
        reversalOwner,
        fixture,
        adjustmentPosting,
        adjustmentJournalId,
      );
    } finally {
      reversalOwner.release();
    }
    const reversalJournalId = await reverseJournal(ledgerPool, adjustmentJournalId, reversal);

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
      [adjustmentJournalId, reversalJournalId],
    );
    expect(exactOpposite.rows).toEqual([
      { amount_matches: true, original_side: 'CREDIT', reversal_side: 'DEBIT' },
      { amount_matches: true, original_side: 'DEBIT', reversal_side: 'CREDIT' },
    ]);

    const reversedFee = await ledgerPool.query<{
      adjusts_fee_component_id: string | null;
      amount_atomic: string;
      payer_account_id: string;
      recipient_account_id: string;
      reverses_fee_component_id: string | null;
      stage: string;
    }>(
      `SELECT stage, amount_atomic::text, payer_account_id,
              recipient_account_id, adjusts_fee_component_id,
              reverses_fee_component_id
       FROM ledger_fee_components
       WHERE journal_id = $1`,
      [reversalJournalId],
    );
    expect(reversedFee.rows).toEqual([
      {
        adjusts_fee_component_id: actualFeeComponentId,
        amount_atomic: '20',
        payer_account_id: fixture.providerAccountId,
        recipient_account_id: fixture.payerAccountId,
        reverses_fee_component_id: adjustmentFeeComponentId,
        stage: 'ADJUSTMENT',
      },
    ]);
    await expect(
      signedAccountTotals(ledgerPool, [actualJournalId, adjustmentJournalId, reversalJournalId]),
    ).resolves.toEqual({
      [fixture.payerAccountId]: '-80',
      [fixture.providerAccountId]: '80',
    });

    const journalBalances = await ledgerPool.query<{
      credits: string;
      debits: string;
      journal_id: string;
    }>(
      `SELECT journal_id,
              sum(amount_atomic) FILTER (WHERE side = 'DEBIT')::text AS debits,
              sum(amount_atomic) FILTER (WHERE side = 'CREDIT')::text AS credits
       FROM ledger_journal_lines
       WHERE journal_id = ANY($1::uuid[])
       GROUP BY journal_id`,
      [[actualJournalId, adjustmentJournalId, reversalJournalId]],
    );
    expect(journalBalances.rows).toHaveLength(3);
    expect(journalBalances.rows.every((row) => row.debits === row.credits)).toBe(true);

    await expect(
      ledgerPool.query(
        `SELECT
           (SELECT count(*)::integer
              FROM ledger_fee_estimate_snapshots
              WHERE fee_estimate_snapshot_id = ANY($1::uuid[])) AS estimates,
           (SELECT count(*)::integer
              FROM ledger_fee_components
              WHERE journal_id = ANY($2::uuid[])) AS components,
           (SELECT amount_atomic::text
              FROM ledger_fee_estimate_snapshots
              WHERE fee_estimate_snapshot_id = $3) AS quote_v1_amount`,
        [
          [fixture.feeEstimateV1Id, fixture.feeEstimateV2Id],
          [actualJournalId, adjustmentJournalId, reversalJournalId],
          fixture.feeEstimateV1Id,
        ],
      ),
    ).resolves.toMatchObject({
      rows: [{ components: 3, estimates: 2, quote_v1_amount: '100' }],
    });
    await expect(runner.assertUpToDate()).resolves.toBeUndefined();
  });
});
