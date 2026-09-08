import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createMainnetFinancialActionAtomicFinalityPersistenceMigration,
  createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037,
  createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037,
} from './0037-atomically-persist-mainnet-financial-action-finality.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function body(source: string, functionName: string, end: string): string {
  const startIndex = source.indexOf(`CREATE FUNCTION ${functionName}`);
  const endIndex = source.indexOf(end, startIndex + 1);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('migration 0037 atomic authenticated-finality persistence', () => {
  const migration = createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';
  const admission = body(
    up,
    'record_authenticated_mainnet_financial_action_reconciliation_v2',
    'CREATE FUNCTION record_mainnet_financial_action_post_finality_review_v2',
  );
  const review = body(
    up,
    'record_mainnet_financial_action_post_finality_review_v2',
    'DO $set_atomic_finality_persistence_paths$',
  );

  it('supersedes 0036 and registers both variants last', () => {
    expect(migration).toMatchObject({ id: '0037', supersedesVerificationOf: ['0036'] });
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-1)).toBe(
      createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-1)).toBe(
      createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037,
    );
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id).slice(-9)).toEqual([
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
      '0037',
    ]);
  });

  it('keeps the exact 0035 24/25-input and 14/10-output contracts', () => {
    expect(up.match(/CREATE FUNCTION record_.*_v2\(/gu)).toHaveLength(2);
    expect(
      admission.match(
        /requested_[a-z0-9_]+ (?:uuid|bigint|text|numeric|timestamp with time zone)/gu,
      ),
    ).toHaveLength(24);
    expect(
      review.match(/requested_[a-z0-9_]+ (?:uuid|bigint|text|numeric|timestamp with time zone)/gu),
    ).toHaveLength(25);
    expect(admission).toContain('admission_outcome text');
    expect(admission).toContain('ledger_settlement_authority boolean');
    expect(review).toContain('record_outcome text');
    expect(review).toContain('effective_safety_state text');
    expect(up.match(/CALLED ON NULL INPUT PARALLEL UNSAFE/gu)).toHaveLength(2);
  });

  it('refuses non-READ-COMMITTED transactions and serializes operation then intent', () => {
    for (const functionBody of [admission, review]) {
      const isolation = functionBody.indexOf("transaction_isolation') <> 'read committed'");
      const operation = functionBody.indexOf('pg_advisory_xact_lock(operation_lock_key)');
      const intent = functionBody.indexOf('pg_advisory_xact_lock(intent_lock_key)');
      const replay = functionBody.indexOf('IF operation_exists THEN');
      expect(isolation).toBeGreaterThanOrEqual(0);
      expect(operation).toBeGreaterThan(isolation);
      expect(intent).toBeGreaterThan(operation);
      expect(replay).toBeGreaterThan(intent);
      expect(functionBody).toContain(
        'pg_catalog.hashtextextended(requested_intent_id::text, 56037)',
      );
    }
  });

  it('preserves immutable replay before every fresh-write gate and delegates conflict proof', () => {
    for (const [functionBody, v1] of [
      [admission, 'record_authenticated_mainnet_financial_action_reconciliation_v1'],
      [review, 'record_mainnet_financial_action_post_finality_review_v1'],
    ] as const) {
      const replay = functionBody.indexOf('IF operation_exists THEN');
      const delegate = functionBody.indexOf(`RETURN QUERY SELECT * FROM ${v1}(`, replay);
      const authorityTableLock = functionBody.indexOf('LOCK TABLE', replay);
      const wallet = functionBody.indexOf('registered_wallets AS wallet', replay);
      const prerequisite = functionBody.indexOf('read_mainnet_financial_action_', replay);
      expect(delegate).toBeGreaterThan(replay);
      expect(authorityTableLock).toBeGreaterThan(delegate);
      expect(wallet).toBeGreaterThan(delegate);
      expect(prerequisite).toBeGreaterThan(delegate);
      expect(functionBody.slice(replay, authorityTableLock)).not.toContain('INSERT INTO');
    }
  });

  it('freezes authority candidates and locks unique targets in global C order', () => {
    for (const functionBody of [admission, review]) {
      expect(functionBody).toContain(
        'LOCK TABLE mainnet_financial_action_reconciliation_source_authorities, mainnet_financial_action_reconciliation_deployment_authorities',
      );
      expect(functionBody).toContain('IN SHARE MODE');
      const evidence = functionBody.indexOf('FOREACH target_key IN ARRAY evidence_targets');
      const source = functionBody.indexOf('FOREACH target_key IN ARRAY source_targets');
      const deployment = functionBody.indexOf('FOREACH target_key IN ARRAY deployment_targets');
      const intent = functionBody.indexOf('FOR UPDATE;', deployment);
      const wallet = functionBody.indexOf('registered_wallets AS wallet', intent);
      expect(source).toBeGreaterThan(evidence);
      expect(deployment).toBeGreaterThan(source);
      expect(intent).toBeGreaterThan(deployment);
      expect(wallet).toBeGreaterThan(intent);
    }
    expect(review.match(/ORDER BY target COLLATE "C"/gu)).toHaveLength(3);
  });

  it('snapshots original, latest, and the bounded prior reaffirmation dependency', () => {
    for (const marker of [
      'mainnet_financial_action_reconciliation_admissions AS admission',
      'admission.admitted_event_revision = requested_terminal_revision',
      'SELECT pg_catalog.max(candidate.review_revision)',
      "candidate.disposition = 'FINALITY_REAFFIRMED'",
      'review.chain_anchor_evidence_fingerprint_sha256',
      'review.source_authority_id::text',
      'review.deployment_authority_id::text',
    ]) {
      expect(review).toContain(marker);
    }
    expect(review.match(/candidate\.disposition = 'FINALITY_REAFFIRMED'/gu)).toHaveLength(3);
  });

  it('locks the exact current mainnet wallet and active digest alias after intent UPDATE', () => {
    for (const functionBody of [admission, review]) {
      for (const marker of [
        'pg_catalog.hashtextextended(requested_account_id::text, 56001)',
        'registered_wallet_identity_digests AS identity',
        "identity.status = 'ACTIVE'",
        'identity.revoked_at IS NULL',
        "wallet.status = 'ACTIVE'",
        'wallet.revoked_at IS NULL',
        "wallet.registry_environment = 'MAINNET'",
        'wallet.registry_version = 1',
        'FOR SHARE OF wallet, identity',
        ETHEREUM_MARKER,
        SOLANA_MARKER,
      ]) {
        expect(functionBody).toContain(marker);
      }
    }
  });

  it('rechecks evidence and authority controls only after every target is locked', () => {
    for (const functionBody of [admission, review]) {
      const deployment = functionBody.indexOf('FOREACH target_key IN ARRAY deployment_targets');
      const controls = functionBody.indexOf(
        'provider_position_chain_anchor_control_events AS control',
        deployment,
      );
      expect(controls).toBeGreaterThan(deployment);
      expect(functionBody).toContain("control.control_action IN ('INVALIDATED', 'QUARANTINED')");
      expect(functionBody).toContain("control.authority_kind = 'SOURCE'");
      expect(functionBody).toContain("control.authority_kind = 'DEPLOYMENT'");
    }
  });

  it('freshly invokes 0036 after intent/wallet locking and exactly binds selected authorities', () => {
    expect(admission).toContain('read_mainnet_financial_action_reconciliation_prerequisite_v1(');
    expect(review).toContain('read_mainnet_financial_action_post_finality_prerequisite_v1(');
    for (const functionBody of [admission, review]) {
      const intent = functionBody.indexOf('FOR UPDATE;');
      const prerequisite = functionBody.indexOf('read_mainnet_financial_action_', intent);
      expect(prerequisite).toBeGreaterThan(intent);
      expect(functionBody).toContain(
        'prerequisite.source_authority_id IS DISTINCT FROM requested_source_authority_id',
      );
      expect(functionBody).toContain('prerequisite.deployment_authority_id IS DISTINCT FROM');
    }
  });

  it('delegates one new write to unchanged v1 and rolls it back after expiry', () => {
    expect(
      admission.match(/record_authenticated_mainnet_financial_action_reconciliation_v1\(/gu),
    ).toHaveLength(2);
    expect(
      review.match(/record_mainnet_financial_action_post_finality_review_v1\(/gu),
    ).toHaveLength(2);
    for (const functionBody of [admission, review]) {
      expect(functionBody).toContain('effective_expires_at := LEAST(');
      expect(functionBody).not.toContain('pg_catalog.least(');
      expect(functionBody).toContain('database_finished_at >= effective_expires_at');
      expect(functionBody).toContain("IS DISTINCT FROM 'RECORDED'");
    }
  });

  it('is owner-only, adds no state or grant, and rolls back only v2 wrappers', () => {
    expect(up).not.toContain('CREATE TABLE');
    expect(up).not.toContain('CREATE TRIGGER');
    expect(up).not.toContain('GRANT ');
    expect(up.match(/REVOKE ALL ON FUNCTION/gu)).toHaveLength(2);
    expect(down.match(/DROP FUNCTION/gu)).toHaveLength(2);
    expect(down).not.toContain('_v1');
    expect(down).not.toContain('DROP TABLE');
  });

  it('hashes both exact bodies and verifies catalog, owner, ACL, and 0036', () => {
    for (const marker of [
      'prior.valid AND function_state.valid',
      'pg_catalog.count(*) = 2',
      'procedure.proargnames = expected.argument_names',
      "pg_catalog.array_to_string(procedure.proargtypes::oid[], ',') =",
      'procedure.proallargtypes = expected.all_type_oids',
      'procedure.proargmodes = expected.argument_modes',
      'procedure.proconfig = ARRAY[',
      'procedure.prosecdef',
      'NOT procedure.proisstrict',
      "procedure.provolatile = 'v'",
      "procedure.proparallel = 'u'",
      'expected.body_sha256',
      'acl.grantee <> procedure.proowner',
      'read_mainnet_financial_action_post_finality_prerequisite_v1',
    ]) {
      expect(verifier).toContain(marker);
    }
  });

  it('shares DDL with the isolated variant and rejects unsafe principals', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037.verifySql,
    );
    expect(() =>
      createMainnetFinancialActionAtomicFinalityPersistenceMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });
});

const ETHEREUM_MARKER = "selected_intent.network_id = 'eip155:1'";
const SOLANA_MARKER = "selected_intent.network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'";
