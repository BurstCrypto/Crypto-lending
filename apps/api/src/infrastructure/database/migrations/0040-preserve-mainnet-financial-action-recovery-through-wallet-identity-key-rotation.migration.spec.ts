import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createMainnetFinancialActionWalletIdentityRotationRecoveryMigration,
  createMainnetFinancialActionWalletIdentityRotationRecoveryMigrationV0040,
  createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040,
} from './0040-preserve-mainnet-financial-action-recovery-through-wallet-identity-key-rotation.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function definition(source: string, name: string): string {
  const start = source.indexOf(`CREATE FUNCTION ${name}(`);
  const end = source.indexOf('$function$;', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + '$function$;'.length);
}

describe('migration 0040 revoked-wallet identity-rotation recovery', () => {
  const migration = createMainnetFinancialActionWalletIdentityRotationRecoveryMigrationV0040;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';
  const guard = definition(up, 'enforce_revoked_mainnet_action_recovery_alias_v1');
  const recovery = definition(up, 'ensure_revoked_mainnet_action_recovery_alias_v1');
  const readiness = definition(up, 'require_revoked_mainnet_action_recovery_readiness_v1');

  it('is an unregistered transactional successor to immutable 0039', () => {
    expect(migration).toMatchObject({
      id: '0040',
      supersedesVerificationOf: ['0039'],
    });
    expect(migration.transactional).not.toBe(false);
  });

  it('creates one digest-only append history and exactly three owner-only functions', () => {
    expect(
      up.match(/CREATE TABLE mainnet_financial_action_revoked_wallet_recovery_aliases/gu),
    ).toHaveLength(1);
    expect(up.match(/CREATE FUNCTION /gu)).toHaveLength(3);
    expect(up.match(/\$function\$;/gu)).toHaveLength(3);
    expect(up).toContain('active_address_digest bytea NOT NULL');
    expect(up).toContain('recovery_fingerprint_sha256 text NOT NULL');
    expect(up).toContain('BEFORE UPDATE OR DELETE');
    expect(up).toContain('BEFORE TRUNCATE');
    expect(up.match(/ENABLE ALWAYS TRIGGER/gu)).toHaveLength(4);
    expect(up).not.toMatch(/address_(ciphertext|iv|auth_tag)/u);
    expect(up).not.toContain('wallet_address');
    expect(up).not.toContain('CREATE EXTENSION');
  });

  it('accepts no time, status, network, purpose, or historical-key material from its caller', () => {
    const signature = recovery.slice(0, recovery.indexOf(') RETURNS TABLE'));
    expect(signature).toContain('requested_account_id uuid');
    expect(signature).toContain('requested_intent_id uuid');
    expect(signature).toContain('requested_wallet_id uuid');
    expect(signature).toContain('requested_lifecycle_revision bigint');
    expect(signature).toContain('requested_lifecycle_snapshot_sha256 text');
    expect(signature).toContain('requested_active_write_version smallint');
    expect(signature).toContain('requested_active_write_digest_hex text');
    for (const forbidden of [
      'requested_at',
      'requested_status',
      'requested_network',
      'requested_purpose',
      'requested_historical',
      'requested_address',
    ]) {
      expect(signature).not.toContain(forbidden);
    }
    expect(recovery).toContain(
      "pg_catalog.current_setting('transaction_isolation') <> 'read committed'",
    );
    expect(recovery).toContain("'milliseconds', pg_catalog.clock_timestamp()");
  });

  it('binds fresh writes to one revoked mainnet wallet and an unresolved verified obligation', () => {
    for (const marker of [
      "target_wallet.status <> 'REVOKED'",
      "selected_intent.network_id = 'eip155:1'",
      "selected_intent.network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'",
      'current_event.revision <> requested_lifecycle_revision',
      'current_event.snapshot_sha256 <> requested_lifecycle_snapshot_sha256',
      "'WALLET_SIGNED_SUBMISSION_BOUND'",
      "'BROADCAST_OUTCOME_AMBIGUOUS'",
      "'RECONCILIATION_AMBIGUOUS'",
      'OR current_event.terminal',
      'OR current_event.requires_manual_reconciliation',
      'event.revision = 2',
      'mainnet_financial_action_signed_submission_proofs AS proof',
      'proof.proof_fingerprint_sha256',
      'signed_event.recorded_at > target_wallet.revoked_at',
    ]) {
      expect(recovery).toContain(marker);
    }
    for (const forbiddenStage of ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORG_QUARANTINED']) {
      expect(recovery).not.toContain(forbiddenStage);
    }
  });

  it('requires exactly the active policy version and inserts only a revoked alias', () => {
    expect(recovery).toContain('policy.active_write_version = requested_active_write_version');
    expect(recovery).toContain('policy.active_write_version = ANY(policy.accepted_read_versions)');
    expect(recovery).toContain("requested_active_write_digest_hex !~ '^[0-9a-f]{64}$'");
    expect(recovery).toContain('pg_catalog.decode(requested_active_write_digest_hex');
    expect(recovery).toContain(
      'requested_active_write_version <= historical_identity.address_digest_version',
    );
    expect(recovery).toContain('identity.address_digest_version < requested_active_write_version');
    expect(recovery).toContain(
      "identity.address_digest = pg_catalog.decode(\n          requested_active_write_digest_hex, 'hex'",
    );
    expect(recovery).toMatch(
      /INSERT INTO registered_wallet_identity_digests[\s\S]*?'REVOKED', target_wallet\.registered_at, target_wallet\.revoked_at/u,
    );
    expect(recovery).not.toMatch(/UPDATE registered_wallets/u);
    expect(recovery).not.toMatch(/SET status = 'ACTIVE'/u);
    expect(recovery).not.toContain('wallet_ownership_challenges');
  });

  it('blocks an active-version transition until the complete eligible recovery set is ready', () => {
    expect(up).toContain('CREATE CONSTRAINT TRIGGER wallet_identity_rotation_recovery_readiness');
    expect(up).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(up).toContain(
      'WHEN (OLD.active_write_version IS DISTINCT FROM NEW.active_write_version)',
    );
    expect(readiness).toContain('NEW.active_write_version <= OLD.active_write_version');
    expect(readiness).toContain('LOCK TABLE');
    expect(readiness).toContain('mainnet_financial_action_intents,');
    expect(readiness).toContain('mainnet_financial_action_events,');
    expect(readiness).toContain('mainnet_financial_action_signed_submission_proofs,');
    expect(readiness).toContain('registered_wallets,');
    expect(readiness).toContain('wallet_ownership_challenge_identity_digests,');
    expect(readiness).toContain('wallet_ownership_challenges,');
    expect(readiness).toContain('wallet_registration_audit_events,');
    expect(readiness).toContain('registered_wallet_identity_digests,');
    expect(readiness).toContain('IN SHARE MODE');
    expect(readiness).toContain('current_policy.active_write_version <> NEW.active_write_version');
    expect(readiness).toContain("wallet.status = 'REVOKED'");
    expect(readiness).toContain("signed_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'");
    expect(readiness).toContain("'BROADCAST_OUTCOME_AMBIGUOUS'");
    expect(readiness).toContain("'RECONCILIATION_AMBIGUOUS'");
    expect(readiness).toContain('NOT current_event.terminal');
    expect(readiness).toContain('NOT current_event.requires_manual_reconciliation');
    expect(readiness).toContain(
      'wallet_ownership_challenge_identity_digests AS challenge_identity',
    );
    expect(readiness).toContain('wallet_registration_audit_events AS registration_audit');
    expect(readiness).toContain("'WALLET_REGISTERED', 'WALLET_ALREADY_REGISTERED'");
    expect(readiness).toContain(
      'mainnet_financial_action_revoked_wallet_recovery_aliases AS audit',
    );
    expect(readiness).toContain(
      'wallet identity rotation would strand revoked signed-bound recovery',
    );
    for (const excludedStage of ['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORG_QUARANTINED']) {
      expect(readiness).not.toContain(excludedStage);
    }
  });

  it('uses stable lock ordering and immutable replay before a fresh cursor decision', () => {
    const intentLock = recovery.indexOf('mainnet_financial_action_intents AS intent');
    const accountLock = recovery.indexOf(
      'pg_catalog.hashtextextended(requested_account_id::text, 56001)',
    );
    const walletLock = recovery.indexOf('registered_wallets AS wallet', accountLock);
    const policyLock = recovery.indexOf('wallet_identity_key_policy AS policy', walletLock);
    const identityLock = recovery.indexOf('56002', policyLock);
    const replay = recovery.indexOf(
      'IF FOUND THEN',
      recovery.indexOf('SELECT recovery.* INTO existing_recovery'),
    );
    const currentCursor = recovery.indexOf('SELECT event.* INTO current_event');
    expect(intentLock).toBeGreaterThanOrEqual(0);
    expect(accountLock).toBeGreaterThan(intentLock);
    expect(walletLock).toBeGreaterThan(accountLock);
    expect(policyLock).toBeGreaterThan(walletLock);
    expect(identityLock).toBeGreaterThan(policyLock);
    expect(replay).toBeGreaterThan(identityLock);
    expect(currentCursor).toBeGreaterThan(replay);
    expect(recovery).toContain("'REPLAYED'::text");
    expect(recovery).toContain("USING ERRCODE = '23505'");
  });

  it('rechecks every binding in an insert guard and records a framed fingerprint', () => {
    for (const marker of [
      'expected_fingerprint := pg_catalog.encode(pg_catalog.sha256(',
      'CRYPTO_LENDING:MAINNET_ACTION:REVOKED_WALLET_RECOVERY_ALIAS:FRAMED:v1',
      "'fingerprintEncodingVersion'",
      "historical_identity.status = 'REVOKED'",
      "active_identity.status = 'REVOKED'",
      'key_policy.active_write_version = NEW.address_digest_version',
      'triggering_event.stage IN (',
      'NOT triggering_event.terminal',
      'NOT triggering_event.requires_manual_reconciliation',
      'proof.proof_fingerprint_sha256',
      'later_event.revision > triggering_event.revision',
      "USING ERRCODE = '23514'",
    ]) {
      expect(guard).toContain(marker);
    }
    expect(guard).not.toContain('RETURN QUERY');
  });

  it('grants no runtime authority and pins exact bodies, catalog, ACLs, and data readiness', () => {
    expect(up).not.toContain('GRANT ');
    expect(up).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE mainnet_financial_action_revoked_wallet_recovery_aliases FROM PUBLIC',
    );
    expect(up).toContain('REVOKE ALL ON FUNCTION ensure_revoked_mainnet_action_recovery_alias_v1');
    for (const marker of [
      'prior.valid AND relation_state.valid AND constraint_state.valid',
      'pg_catalog.count(*) = 21',
      'relation.relrowsecurity',
      'acl.grantee <> relation.relowner',
      'row_count = 12',
      'procedure.prosrc',
      'procedure.proconfig = ARRAY[',
      'pg_catalog.unnest(procedure.proargtypes::oid[])',
      'WITH ORDINALITY AS input(input_type, ordinal)',
      'pg_catalog.count(*) = 3 AND pg_catalog.count(trigger_record.oid) = 3',
      'readiness_trigger.tgtype = 17',
      'readiness_constraint.condeferrable AND readiness_constraint.condeferred',
      'audit.recovery_fingerprint_sha256 <>',
      'signed_submission_proof_fingerprint_sha256',
    ]) {
      expect(verifier).toContain(marker);
    }
    expect(verifier).toContain(
      'SELECT pg_catalog.count(*) = 3 AND pg_catalog.count(procedure.oid) = 3',
    );
    expect(verifier).not.toContain('procedure.proargtypes::oid[] = expected.input_type_oids');
    expect(up).not.toMatch(/api_may_(sign|broadcast)/u);
    expect(up).not.toContain('ledger_settlement_authority');
    expect(up).not.toContain('automatic_resend_allowed');
  });

  it('refuses down after any recovery and never removes registered-wallet aliases', () => {
    const policyLock = down.indexOf('LOCK TABLE wallet_identity_key_policy');
    const aliasLock = down.indexOf('LOCK TABLE registered_wallet_identity_digests');
    const refusal = down.indexOf(
      'IF EXISTS (SELECT 1 FROM mainnet_financial_action_revoked_wallet_recovery_aliases)',
    );
    const drop = down.indexOf(
      'DROP TABLE mainnet_financial_action_revoked_wallet_recovery_aliases',
    );
    expect(policyLock).toBeGreaterThanOrEqual(0);
    expect(aliasLock).toBeGreaterThan(policyLock);
    expect(refusal).toBeGreaterThan(aliasLock);
    expect(drop).toBeGreaterThan(refusal);
    expect(down).toContain("USING ERRCODE = '55000'");
    expect(down).toContain('policy.active_write_version = 1');
    expect(down).toContain('policy.accepted_read_versions = ARRAY[1]::smallint[]');
    expect(down).not.toContain('DELETE FROM registered_wallet_identity_digests');
    expect(down).not.toContain('DROP TABLE registered_wallet_identity_digests');
  });

  it('shares DDL with the isolated variant and rejects unsafe principal names', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040.verifySql,
    );
    expect(() =>
      createMainnetFinancialActionWalletIdentityRotationRecoveryMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        apiRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('apiRuntimeRole');
  });
});
