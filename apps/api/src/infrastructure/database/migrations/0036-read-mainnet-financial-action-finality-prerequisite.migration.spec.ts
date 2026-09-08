import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createMainnetFinancialActionFinalityPrerequisiteReadMigration,
  createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036,
  createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036,
} from './0036-read-mainnet-financial-action-finality-prerequisite.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0036 authenticated-finality prerequisite reads', () => {
  const migration = createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';

  it('supersedes 0035 and registers both variants last', () => {
    expect(migration).toMatchObject({ id: '0036', supersedesVerificationOf: ['0035'] });
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-1)).toBe(
      createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-1)).toBe(
      createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036,
    );
    expect(DATABASE_MIGRATION_LIST.map(({ id }) => id).slice(-8)).toEqual([
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
    ]);
  });

  it('creates two purpose-separated one-call reads with one exact 53-column contract', () => {
    expect(up.match(/CREATE FUNCTION read_mainnet_financial_action_/gu)).toHaveLength(2);
    expect(up).toContain('read_mainnet_financial_action_reconciliation_prerequisite_v1(');
    expect(up).toContain('read_mainnet_financial_action_post_finality_prerequisite_v1(');
    expect(up).toContain('LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE');
    expect(up).toContain(
      'LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE',
    );
    expect(up.match(/\n {6}account_id uuid,/gu)).toHaveLength(2);
    expect(up.match(/\n {6}verified_at timestamptz/gu)).toHaveLength(2);
    expect(up).not.toContain('requested_purpose');
  });

  it('revalidates the exact active account wallet and immutable transaction binding', () => {
    for (const marker of [
      'registered_wallet_identity_digests AS identity',
      "identity.status = 'ACTIVE'",
      'identity.revoked_at IS NULL',
      "wallet.status = 'ACTIVE'",
      'wallet.revoked_at IS NULL',
      "wallet.registry_environment = 'MAINNET'",
      'wallet.address_digest_version = selected_intent.wallet_identity_digest_version',
      "event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'",
      'submission_event.chain_transaction_id <> current_event.chain_transaction_id',
      'submission_event.wallet_signed_payload_sha256',
      'submission_event.wallet_signature_evidence_sha256',
      'pg_catalog.hashtextextended(requested_account_id::text, 56001)',
    ]) {
      expect(up).toContain(marker);
    }
  });

  it('selects exactly one live uncontrolled source/deployment authority pair', () => {
    for (const marker of [
      'authority_candidate_count <> 1',
      "source.authority_use =\n          'MAINNET_FINANCIAL_ACTION_RECONCILIATION_SOURCE_ONLY'",
      "deployment.authority_use =\n          'MAINNET_FINANCIAL_ACTION_RECONCILIATION_DEPLOYMENT_ONLY'",
      'deployment.provider_id = selected_intent.provider_id',
      'deployment.protocol_id = selected_intent.protocol_id',
      'deployment.market_id = selected_intent.market_id',
      'deployment.asset_registry_fingerprint_sha256 =',
      'deployment.asset_identity = selected_intent.asset_identity',
      'deployment.action_type = selected_intent.action_type',
      "control.authority_kind = 'SOURCE'",
      "control.authority_kind = 'DEPLOYMENT'",
      'FOR SHARE',
    ]) {
      expect(up).toContain(marker);
    }
    expect(up).not.toContain('INTO STRICT');
    expect(up).not.toContain('TOO_MANY_ROWS');
  });

  it('requires healthy migration-0029 evidence without overstating its facts', () => {
    for (const marker of [
      "selected_evidence.identity_status <> 'VERIFIED'",
      "selected_evidence.progression_status <> 'CURRENT'",
      "selected_evidence.finality_status <> 'HEALTHY'",
      'selected_evidence.source_pair_approval_expires_at',
      'selected_evidence.current_head_advanced_at',
      'selected_evidence.finalized_head_advanced_at',
      'chain_evidence_expires_at := LEAST(',
      "(selected_evidence.chain_anchor ->> 'blockNumber')::numeric >",
      "(selected_evidence.agreed_finalized_head ->> 'blockNumber')::numeric >",
      '18446744073709551615',
      "control.control_action IN ('INVALIDATED', 'QUARANTINED')",
      'does not prove transaction inclusion, sender, calldata/instructions',
      'receipt/meta, wallet-signature linkage, or protocol effect',
    ]) {
      expect(up).toContain(marker);
    }
    expect(up.match(/chain_evidence_expires_at := LEAST\(/gu)).toHaveLength(2);
    expect(
      up.match(/\(selected_evidence\.chain_anchor ->> 'blockNumber'\)::numeric >/gu),
    ).toHaveLength(2);
    expect(
      up.match(/\(selected_evidence\.agreed_finalized_head ->> 'blockNumber'\)::numeric >/gu),
    ).toHaveLength(2);
    expect(up).not.toContain('pg_catalog.least(');
  });

  it('admits only current ambiguous lifecycle cursors for reconciliation', () => {
    expect(up).toContain('current_event.revision <> requested_lifecycle_revision');
    expect(up).toContain('current_event.snapshot_sha256 <> requested_lifecycle_snapshot_sha256');
    expect(up).toContain("'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'");
    expect(up).toContain('OR current_event.terminal');
    expect(up).toContain('OR current_event.revision < 2');
    expect(up).toContain('NULL::text');
    expect(up).toContain('NULL::bigint');
  });

  it('binds post-finality reads to the terminal admission and fresh review cursor', () => {
    for (const marker of [
      "current_event.stage NOT IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')",
      'current_event.revision <> requested_terminal_revision',
      'current_event.transition_fingerprint_sha256 <>',
      'requested_terminal_transition_fingerprint_sha256',
      'requested_original_admission_fingerprint_sha256',
      'admission_match_count <> 1',
      'review_count <> requested_expected_review_revision',
      'latest_review.review_fingerprint_sha256 <>',
      'requested_expected_previous_review_fingerprint_sha256',
      "review.disposition = 'DEEP_REORG_QUARANTINED'",
      "'POST_FINALITY_REVIEW_INCONCLUSIVE'",
      'EVM hash lineage is deliberately left to the dual-source attestations',
      'original_admission.chain_anchor_evidence_fingerprint_sha256',
      'latest_review.chain_anchor_evidence_fingerprint_sha256',
    ]) {
      expect(up).toContain(marker);
    }
  });

  it('is owner-only, adds no state or runtime authority, and rolls back only its reads', () => {
    expect(up).not.toContain('CREATE TABLE');
    expect(up).not.toContain('CREATE TRIGGER');
    expect(up).not.toContain('INSERT INTO');
    expect(up).not.toContain('GRANT ');
    expect(up.match(/REVOKE ALL ON FUNCTION/gu)).toHaveLength(2);
    expect(down.match(/DROP FUNCTION/gu)).toHaveLength(2);
    expect(down).not.toContain('DROP TABLE');
    expect(down).not.toContain('0035');
  });

  it('verifies exact bodies, signatures, result metadata, owner, ACL, and predecessor', () => {
    for (const marker of [
      'prior.valid AND function_state.valid',
      'pg_catalog.count(*) = 2',
      'procedure.proargnames = expected.argument_names',
      "pg_catalog.array_to_string(procedure.proargtypes::oid[], ',') =",
      "pg_catalog.array_to_string(expected.input_type_oids, ',')",
      'procedure.proallargtypes = expected.all_type_oids',
      'procedure.proargmodes = expected.argument_modes',
      'procedure.proconfig = ARRAY[',
      'procedure.prosecdef',
      "procedure.provolatile = 'v'",
      "procedure.proparallel = 'u'",
      "pg_catalog.has_function_privilege(\n            'public'",
      'acl.grantee <> procedure.proowner',
    ]) {
      expect(verifier).toContain(marker);
    }
  });

  it('shares DDL with the isolated variant and rejects unsafe principal identifiers', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036.verifySql,
    );
    expect(() =>
      createMainnetFinancialActionFinalityPrerequisiteReadMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });
});
