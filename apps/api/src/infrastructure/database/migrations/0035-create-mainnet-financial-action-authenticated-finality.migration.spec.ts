import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createMainnetFinancialActionAuthenticatedFinalityMigration,
  createMainnetFinancialActionAuthenticatedFinalityMigrationV0035,
  createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035,
} from './0035-create-mainnet-financial-action-authenticated-finality.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0035 authenticated mainnet action finality', () => {
  const migration = createMainnetFinancialActionAuthenticatedFinalityMigrationV0035;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';

  it('supersedes 0034 and registers production and test variants before 0036', () => {
    expect(migration).toMatchObject({ id: '0035', supersedesVerificationOf: ['0034'] });
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-4)).toBe(
      createMainnetFinancialActionAuthenticatedFinalityMigrationV0035,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-4)).toBe(
      createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035,
    );
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id).slice(-9)).toEqual([
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
      '0037',
      '0038',
    ]);
  });

  it('creates empty Ethereum and Solana evidence authority gates and append-only control', () => {
    for (const table of [
      'mainnet_financial_action_reconciliation_source_authorities',
      'mainnet_financial_action_reconciliation_deployment_authorities',
      'mainnet_financial_action_reconciliation_authority_controls',
      'mainnet_financial_action_reconciliation_admissions',
      'mainnet_financial_action_post_finality_reviews',
    ]) {
      expect(up).toContain(`CREATE TABLE ${table} (`);
      expect(up).toContain(`BEFORE UPDATE OR DELETE ON ${table}`);
      expect(up).toContain(`BEFORE TRUNCATE ON ${table}`);
    }
    expect(up).toContain("network_id IN ('eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')");
    expect(up).toContain('EMPTY BY DEFAULT. Owner-installed');
    expect(up).not.toContain('GRANT ');
  });

  it('pins exact purpose, source-pair, deployment, asset, and action authority bindings', () => {
    for (const marker of [
      "authority_use = 'MAINNET_FINANCIAL_ACTION_RECONCILIATION_SOURCE_ONLY'",
      'chain_evidence.source_pair_approval_id <>',
      'source_authority.source_pair_approval_id',
      "authority_use = 'MAINNET_FINANCIAL_ACTION_RECONCILIATION_DEPLOYMENT_ONLY'",
      'deployment_authority.asset_registry_version <> intent.asset_registry_version',
      'deployment_authority.asset_registry_fingerprint_sha256 <>',
      'deployment_authority.asset_symbol <> intent.asset_symbol',
      'deployment_authority.asset_identity <> intent.asset_identity',
      'deployment_authority.asset_decimals <> intent.asset_decimals',
      'deployment_authority.action_type <> intent.action_type',
    ]) {
      expect(up).toContain(marker);
    }
    expect(up).toContain('FOR SHARE');
    expect(up).toContain("control.control_action IN ('INVALIDATED', 'QUARANTINED')");
    expect(up).toContain("control_action IN ('SUSPENDED', 'REVOKED')");
  });

  it('validates every required mutation scalar before evidence lookup', () => {
    const admissionValidation = up.indexOf(
      "RAISE EXCEPTION 'invalid authenticated mainnet financial action reconciliation'",
    );
    const gate = up.indexOf('SELECT source.* INTO STRICT source_authority', admissionValidation);
    const reviewValidation = up.indexOf(
      "RAISE EXCEPTION 'invalid mainnet financial action post-finality review'",
    );
    expect(admissionValidation).toBeGreaterThan(-1);
    expect(admissionValidation).toBeLessThan(gate);
    expect(reviewValidation).toBeGreaterThan(gate);
    for (const marker of [
      'requested_account_id IS NULL',
      'requested_intent_id IS NULL',
      'requested_observation_id IS NULL',
      'requested_review_id IS NULL',
      'requested_correlation_id IS NULL',
      'requested_source_authority_id IS NULL',
      'requested_deployment_authority_id IS NULL',
      'requested_deadline_at IS NULL',
    ]) {
      expect(up).toContain(marker);
    }
    expect(up).toContain("USING ERRCODE = '22023'");
  });

  it('admits exactly one legacy reconciliation call atomically behind a deferred guard', () => {
    expect(
      up.match(/FROM record_mainnet_financial_action_reconciliation_observation\(/gu),
    ).toHaveLength(1);
    expect(up).toContain(
      'CREATE CONSTRAINT TRIGGER mainnet_action_reconciliation_requires_authenticated_admission',
    );
    expect(up).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(up).toContain(
      'SET CONSTRAINTS mainnet_action_reconciliation_requires_authenticated_admission DEFERRED',
    );
    expect(up).toContain('expectedRevision');
    expect(up).toContain('expectedSnapshotSha256');
    expect(up).toContain('deadlineAtEpochMilliseconds');
    expect(up).toContain('correlationId');
    expect(up).toContain('ledger_settlement_authority boolean');
  });

  it('always binds finalized heads while making transaction-anchor binding null-safe', () => {
    expect(up).not.toContain("requested_outcome <> 'UNKNOWN'");
    expect(up).toContain("chain_evidence.agreed_finalized_head ->> 'kind' <> 'EVM_BLOCK'");
    expect(up).toContain(
      "chain_evidence.agreed_finalized_head ->> 'blockNumber' <>\n              requested_finalized_position::text",
    );
    expect(up).toContain("chain_evidence.agreed_finalized_head ->> 'kind' <> 'SOLANA_SLOT'");
    expect(up).toContain('OR (requested_transaction_position IS NOT NULL AND (');
  });

  it('persists exact admission recovery and applies a sticky post-finality quarantine overlay', () => {
    expect(up).toContain('original_admission_fingerprint_sha256 text NOT NULL');
    expect(up).toContain('mainnet_action_post_finality_review_admission_fk FOREIGN KEY');
    expect(up).toContain("requested_disposition = 'DEEP_REORG_QUARANTINED'");
    expect(up).toContain("RAISE EXCEPTION 'post-finality quarantine is permanent'");
    expect(up).toContain('current_admission.admission_fingerprint_sha256');
    expect(up).toContain('current_event.transition_fingerprint_sha256');
    expect(up).toContain('current_event.transaction_block_id');
    expect(up).toContain('current_review_revision bigint');
    expect(up).toContain('current_review_fingerprint_sha256 text');
    expect(up).toContain('current_review_disposition text');
    expect(up).toContain('pg_catalog.hashtextextended(requested_review_id::text, 56036)');
    expect(up).toContain('pg_catalog.hashtextextended(requested_event_id::text, 56035)');
    expect(up).toContain('may_authorize_financial_action boolean');
    expect(up).toContain('may_resend_transaction boolean');
  });

  it('is history-safe in both directions and preserves migrations 0033 and 0034', () => {
    expect(up).toContain('LOCK TABLE mainnet_financial_action_events IN ACCESS EXCLUSIVE MODE');
    expect(up).toContain(
      'authenticated finality requires empty mainnet action reconciliation history',
    );
    for (const table of [
      'mainnet_financial_action_reconciliation_source_authorities',
      'mainnet_financial_action_reconciliation_deployment_authorities',
      'mainnet_financial_action_reconciliation_authority_controls',
      'mainnet_financial_action_reconciliation_admissions',
      'mainnet_financial_action_post_finality_reviews',
    ]) {
      expect(down).toContain(`EXISTS (SELECT 1 FROM ${table})`);
    }
    expect(down).not.toContain('DROP FUNCTION prepare_mainnet_financial_action_lifecycle');
    expect(down).not.toContain(
      'DROP FUNCTION record_mainnet_financial_action_reconciliation_observation',
    );
  });

  it('pins owner-only functions, exact relations, constraints, indexes, and triggers', () => {
    for (const marker of [
      'column_state.valid',
      'constraint_state.valid',
      'index_state.valid',
      'trigger_state.valid',
      'pg_get_constraintdef',
      'pg_get_indexdef',
      'obj_description',
      'attribute.attnotnull',
      'trigger_record.tgtype = expected.trigger_type',
      'procedure.proargnames',
      'procedure.proconfig = ARRAY[',
      'procedure.prosecdef',
      "has_function_privilege('public'",
    ]) {
      expect(verifier).toContain(marker);
    }
  });

  it('shares DDL with the isolated variant and rejects unsafe principal identifiers', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035.verifySql,
    );
    expect(() =>
      createMainnetFinancialActionAuthenticatedFinalityMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });
});
