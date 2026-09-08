import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionLifecycleMigrationV0033 } from './0033-create-mainnet-financial-action-lifecycle.migration';
import {
  createMainnetFinancialActionWalletIdentityBindingMigration,
  createMainnetFinancialActionWalletIdentityBindingMigrationV0034,
  createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034,
} from './0034-bind-mainnet-financial-action-wallet-identity.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0034 mainnet financial action wallet identity binding', () => {
  const migration = createMainnetFinancialActionWalletIdentityBindingMigrationV0034;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';
  const functionIdentity =
    'prepare_mainnet_financial_action_lifecycle_v2(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,integer,text,text,text,smallint,text,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,uuid,smallint[],text[])';

  it('supersedes 0033 and registers both variants immediately before 0035', () => {
    expect(migration).toMatchObject({ id: '0034', supersedesVerificationOf: ['0033'] });
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-4)).toBe(
      createMainnetFinancialActionWalletIdentityBindingMigrationV0034,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-4)).toBe(
      createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034,
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

  it('adds one versioned 32-argument wrapper and leaves 0033 unchanged', () => {
    expect(up).toContain('CREATE FUNCTION prepare_mainnet_financial_action_lifecycle_v2(');
    expect(up).toContain('requested_wallet_identity_digest_versions smallint[]');
    expect(up).toContain('requested_wallet_identity_digests_hex text[]');
    expect(
      up.match(/RETURN QUERY SELECT \* FROM prepare_mainnet_financial_action_lifecycle\(/gu),
    ).toHaveLength(1);
    expect(createMainnetFinancialActionLifecycleMigrationV0033.upSql).not.toContain(
      'prepare_mainnet_financial_action_lifecycle_v2',
    );
    expect(up).not.toContain('CREATE TABLE');
    expect(up).not.toContain('ALTER TABLE');
  });

  it('validates a bounded exact key ring and every digest before wallet lookup', () => {
    const validation = up.indexOf(
      "RAISE EXCEPTION 'invalid mainnet financial action wallet identity candidates'",
    );
    const walletLookup = up.indexOf('INNER JOIN registered_wallets AS wallet');
    const delegate = up.indexOf(
      'RETURN QUERY SELECT * FROM prepare_mainnet_financial_action_lifecycle(',
    );
    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(walletLookup);
    expect(walletLookup).toBeLessThan(delegate);
    for (const marker of [
      'cardinality(requested_wallet_identity_digest_versions) NOT BETWEEN 1 AND 3',
      'requested_wallet_identity_digest_versions[candidate_index] <= 0',
      '<= requested_wallet_identity_digest_versions[candidate_index - 1]',
      "!~ '^[0-9a-f]{64}$'",
      'count(DISTINCT candidate.digest_hex)',
      'IS DISTINCT FROM policy_accepted_read_versions',
    ]) {
      expect(up).toContain(marker);
    }
    expect(up).toContain("USING ERRCODE = '22023'");
  });

  it('locks and binds the exact active account wallet network and all aliases atomically', () => {
    const policyLock = up.indexOf("policy.policy_name = 'wallet-registration-identity-hmac'");
    const intentLock = up.indexOf('FROM mainnet_financial_action_intents AS stored');
    const linkageLock = up.indexOf('FROM yield_operations AS operation');
    expect(up).toContain("policy.policy_name = 'wallet-registration-identity-hmac'");
    expect(up).toContain('FOR SHARE');
    expect(policyLock).toBeLessThan(intentLock);
    expect(intentLock).toBeLessThan(linkageLock);
    expect(up).toContain('WHERE stored.intent_id = requested_intent_id');
    expect(up).toContain('wallet.wallet_id = requested_wallet_id');
    expect(up).toContain('wallet.account_id = requested_account_id');
    expect(up).toContain("wallet.status = 'ACTIVE'");
    expect(up).toContain("wallet.registry_environment = 'MAINNET'");
    expect(up).toContain(
      "requested_network_id = wallet.chain_namespace || ':' || wallet.chain_reference",
    );
    expect(up).toContain('FOR UPDATE OF operation, submission, ledger_transaction, wallet');
    expect(up).toContain('INNER JOIN registered_wallet_identity_digests AS alias');
    expect(up).toContain('requested_wallet_identity_digests_hex[candidate.candidate_index]');
    expect(up).toContain('alias.revoked_at IS NULL');
    expect(up).not.toContain('wallet.address_digest_version');
    expect(up).not.toContain('wallet.address_digest,');
  });

  it('accepts no plaintext, HMAC key, grant, signer, broadcaster, or retry authority', () => {
    expect(up).not.toMatch(
      /wallet_address|plaintext|hmac_key|secret|credential|signer|broadcaster/iu,
    );
    expect(up).not.toContain('GRANT ');
    expect(up).not.toContain('job_outbox');
    expect(up).not.toMatch(/sendTransaction|sendRawTransaction|eth_sendRawTransaction/u);
    expect(up.match(/prepare_mainnet_financial_action_lifecycle\(/gu)).toHaveLength(1);
    for (const role of [
      'PUBLIC',
      'crypto_api_runtime',
      'crypto_worker_runtime',
      'crypto_runtime',
      'crypto_balance_consumer_runtime',
      'crypto_migration',
    ]) {
      expect(up).toContain(role);
    }
  });

  it('refuses to bless legacy history and refuses rollback after any lifecycle use', () => {
    for (const source of [up, down]) {
      expect(source).toContain(
        'LOCK TABLE mainnet_financial_action_intents, mainnet_financial_action_events, mainnet_financial_action_evidence_claims IN ACCESS EXCLUSIVE MODE',
      );
      for (const table of [
        'mainnet_financial_action_intents',
        'mainnet_financial_action_events',
        'mainnet_financial_action_evidence_claims',
      ]) {
        expect(source).toContain(`EXISTS (SELECT 1 FROM ${table})`);
      }
      expect(source).toContain("USING ERRCODE = '55000'");
    }
    expect(down).toContain(`DROP FUNCTION ${functionIdentity}`);
    expect(down).not.toContain('DROP FUNCTION prepare_mainnet_financial_action_lifecycle(');
    expect(down).not.toContain('DROP TABLE');
  });

  it('pins the exact owner-only function body, result, path, and ACL', () => {
    expect(verifier).toContain('mainnet_financial_action_intents');
    expect(verifier).toContain(functionIdentity);
    expect(verifier).toContain('procedure.pronargs = 32');
    expect(verifier).toContain('procedure.proargnames = ARRAY[');
    expect(verifier).toContain('procedure.proargtypes = ARRAY[');
    expect(verifier).toContain('procedure.proargmodes = pg_catalog.array_cat(');
    expect(verifier).toContain("'requested_wallet_identity_digest_versions'");
    expect(verifier).toContain("'smallint[]'::pg_catalog.regtype::pg_catalog.oid");
    expect(verifier).toContain('procedure.prosecdef');
    expect(verifier).toContain('NOT procedure.proisstrict');
    expect(verifier).toContain("procedure.provolatile = 'v'");
    expect(verifier).toContain("procedure.proparallel = 'u'");
    expect(verifier).toContain('search_path=pg_catalog, ');
    expect(verifier).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8'))",
    );
    expect(verifier).toContain('crypto_schema_owner');
    expect(verifier).toContain("has_function_privilege('public'");
    expect(verifier).toContain('acl.grantee <> procedure.proowner');
    expect(verifier).toContain('ledger_settlement_authority boolean');
  });

  it('shares DDL with the isolated variant and rejects unsafe principals', () => {
    expect(migration.upSql).toEqual(
      createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034.verifySql,
    );
    expect(() =>
      createMainnetFinancialActionWalletIdentityBindingMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });
});
