import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import {
  createMainnetFinancialActionRevocationRecoveryMigration,
  createMainnetFinancialActionRevocationRecoveryMigrationV0038,
  createMainnetFinancialActionRevocationRecoveryTestSchemaMigrationV0038,
} from './0038-preserve-mainnet-financial-action-recovery-after-wallet-revocation.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

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

describe('migration 0038 wallet-revocation recovery correction', () => {
  const migration = createMainnetFinancialActionRevocationRecoveryMigrationV0038;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';
  const reconciliation = definition(
    up,
    'read_mainnet_financial_action_reconciliation_prerequisite_v2',
  );
  const postFinality = definition(
    up,
    'read_mainnet_financial_action_post_finality_prerequisite_v2',
  );
  const admission = definition(
    up,
    'record_authenticated_mainnet_financial_action_reconciliation_v3',
  );
  const review = definition(up, 'record_mainnet_financial_action_post_finality_review_v3');
  const recovery = definition(up, 'read_mainnet_financial_action_recovery_wallet_v1');

  it('supersedes immutable 0037 and registers production and test variants last', () => {
    expect(migration).toMatchObject({ id: '0038', supersedesVerificationOf: ['0037'] });
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-1)).toBe(
      createMainnetFinancialActionRevocationRecoveryMigrationV0038,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-1)).toBe(
      createMainnetFinancialActionRevocationRecoveryTestSchemaMigrationV0038,
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

  it('creates only the five versioned corrective functions with pinned extraction counts', () => {
    expect(
      up.match(/CREATE FUNCTION read_mainnet_financial_action_reconciliation_prerequisite_v2\(/gu),
    ).toHaveLength(1);
    expect(
      up.match(/CREATE FUNCTION read_mainnet_financial_action_post_finality_prerequisite_v2\(/gu),
    ).toHaveLength(1);
    expect(
      up.match(
        /CREATE FUNCTION record_authenticated_mainnet_financial_action_reconciliation_v3\(/gu,
      ),
    ).toHaveLength(1);
    expect(
      up.match(/CREATE FUNCTION record_mainnet_financial_action_post_finality_review_v3\(/gu),
    ).toHaveLength(1);
    expect(
      up.match(/CREATE FUNCTION read_mainnet_financial_action_recovery_wallet_v1\(/gu),
    ).toHaveLength(1);
    expect(up).not.toContain(
      'CREATE FUNCTION read_mainnet_financial_action_reconciliation_prerequisite_v1(',
    );
    expect(up).not.toContain(
      'CREATE FUNCTION read_mainnet_financial_action_post_finality_prerequisite_v1(',
    );
    expect(up).not.toContain(
      'CREATE FUNCTION record_authenticated_mainnet_financial_action_reconciliation_v2(',
    );
    expect(up).not.toContain(
      'CREATE FUNCTION record_mainnet_financial_action_post_finality_review_v2(',
    );
    expect(up.match(/\$function\$;/gu)).toHaveLength(5);
  });

  it('admits historical identity only when signing committed before revocation', () => {
    for (const generated of [reconciliation, postFinality, admission, review]) {
      expect(generated).toContain('identity.registered_at = wallet.registered_at');
      expect(generated).toContain('identity.status = wallet.status');
      expect(generated).toContain('identity.revoked_at IS NOT DISTINCT FROM wallet.revoked_at');
      expect(generated).not.toContain("identity.status = 'ACTIVE'");
      expect(generated).toContain("wallet.status = 'REVOKED'");
      expect(generated).toContain("signed_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'");
      expect(generated).toContain('signed_event.recorded_at <= wallet.revoked_at');
      expect(generated).toContain('pg_catalog.hashtextextended(requested_account_id::text, 56001)');
    }
    expect(reconciliation).toMatch(
      /current_event\.stage NOT IN \(\s*'WALLET_SIGNED_SUBMISSION_BOUND'/u,
    );
    expect(postFinality).not.toMatch(
      /current_event\.stage NOT IN \(\s*'WALLET_SIGNED_SUBMISSION_BOUND'/u,
    );
  });

  it('uses corrected prerequisites for fresh writes but leaves immutable replay first', () => {
    for (const [wrapper, prerequisite, replayDelegate] of [
      [
        admission,
        'read_mainnet_financial_action_reconciliation_prerequisite_v2(',
        'record_authenticated_mainnet_financial_action_reconciliation_v1(',
      ],
      [
        review,
        'read_mainnet_financial_action_post_finality_prerequisite_v2(',
        'record_mainnet_financial_action_post_finality_review_v1(',
      ],
    ] as const) {
      const replay = wrapper.indexOf('IF operation_exists THEN');
      const delegate = wrapper.indexOf(replayDelegate, replay);
      const walletGate = wrapper.indexOf('registered_wallets AS wallet', replay);
      const prerequisiteGate = wrapper.indexOf(prerequisite, replay);
      expect(replay).toBeGreaterThanOrEqual(0);
      expect(delegate).toBeGreaterThan(replay);
      expect(walletGate).toBeGreaterThan(delegate);
      expect(prerequisiteGate).toBeGreaterThan(delegate);
      expect(wrapper.match(new RegExp(prerequisite.replace('(', '\\('), 'gu'))).toHaveLength(1);
    }
  });

  it('exposes one exact intent-scoped recovery wallet without new-action authority', () => {
    for (const marker of [
      "requested_purpose NOT IN ('RECONCILIATION_ADMISSION', 'POST_FINALITY_REVIEW')",
      "current_event.stage NOT IN (\n              'WALLET_SIGNED_SUBMISSION_BOUND'",
      "current_event.stage NOT IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')",
      'mainnet_financial_action_reconciliation_admissions AS admission',
      'submission_event.recorded_at <= wallet.revoked_at',
      "key_policy.policy_name = 'wallet-registration-identity-hmac'",
      'verification_identity.address_digest_version = key_policy.active_write_version',
      'wallet.address_ciphertext',
      "selected_intent.network_id = 'eip155:1'",
      "selected_intent.network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'",
      "requested_deadline_at > database_verified_at + interval '30 seconds'",
      'FOR SHARE OF wallet, historical_identity, verification_identity, key_policy',
    ]) {
      expect(recovery).toContain(marker);
    }
    expect(recovery).toContain('WHERE stored.intent_id = requested_intent_id');
    expect(recovery).toContain('AND stored.account_id = requested_account_id');
    expect(recovery).not.toContain('INSERT INTO');
    expect(recovery).not.toContain('UPDATE ');
    expect(recovery).not.toContain('DELETE FROM');
    expect(recovery).not.toContain('prepare_mainnet_financial_action');
    expect(recovery).not.toContain('append_mainnet_financial_action_event');
  });

  it('keeps every corrective boundary owner-only and verifies exact bodies and ACLs', () => {
    expect(up).not.toContain('CREATE TABLE');
    expect(up).not.toContain('CREATE TRIGGER');
    expect(up).not.toContain('GRANT ');
    expect(up.match(/REVOKE ALL ON FUNCTION/gu)).toHaveLength(5);
    expect(down.match(/DROP FUNCTION/gu)).toHaveLength(5);
    expect(down).not.toContain('DROP TABLE');
    for (const marker of [
      'prior.valid AND clones.valid AND recovery.valid',
      'pg_catalog.count(*) = 4',
      'procedure.proargnames = predecessor.proargnames',
      'procedure.proargtypes = predecessor.proargtypes',
      'procedure.proallargtypes = predecessor.proallargtypes',
      'expected.body_sha256',
      'acl.grantee <> procedure.proowner',
      'pg_catalog.count(*) = 1',
      'read_mainnet_financial_action_recovery_wallet_v1',
    ]) {
      expect(verifier).toContain(marker);
    }
  });

  it('shares DDL with the isolated variant and rejects unsafe principals', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionRevocationRecoveryTestSchemaMigrationV0038.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionRevocationRecoveryTestSchemaMigrationV0038.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionRevocationRecoveryTestSchemaMigrationV0038.verifySql,
    );
    expect(() =>
      createMainnetFinancialActionRevocationRecoveryMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        workerRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('workerRuntimeRole');
  });
});
