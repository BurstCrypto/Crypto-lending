import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createMainnetBalanceAgreementEvidenceMigration,
  createMainnetBalanceAgreementEvidenceMigrationV0027,
  createMainnetBalanceAgreementEvidenceTestSchemaMigrationV0027,
} from './0027-create-mainnet-balance-agreement-evidence.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0027 mainnet balance agreement evidence', () => {
  it('extends migration 0026 without restoring suspended stablecoin ingestion', () => {
    const migration = createMainnetBalanceAgreementEvidenceMigrationV0027;

    expect(migration.id).toBe('0027');
    expect(migration.supersedesVerificationOf).toEqual(['0026']);
    expect(migration.verifySql).toContain(
      'SELECT (prior.valid AND function_privileges.valid AND direct_objects.valid)',
    );
    expect(migration.verifySql).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'record_stablecoin_price_evidence",
    );
    expect(sql(migration.upSql)).not.toContain(
      'GRANT EXECUTE ON FUNCTION record_stablecoin_price_evidence',
    );
  });

  it('creates a separate complete-envelope table without changing the provisional read model', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);

    expect(up).toContain('CREATE TABLE balance_sync_financial_agreement_evidence');
    expect(up).toContain('agreement_envelope jsonb NOT NULL');
    expect(up).toContain('agreement_fingerprint_sha256 text PRIMARY KEY');
    expect(up).toContain('agreement_version smallint NOT NULL');
    expect(up).toContain('may_persist boolean NOT NULL');
    expect(up).toContain('may_authorize_financial_action boolean NOT NULL');
    expect(up).toContain('source_pair_registry_fingerprint_sha256 text NOT NULL');
    expect(up).toContain('source_pair_approval_expires_at timestamptz NOT NULL');
    expect(up).toContain('position_set_fingerprint_sha256 text NOT NULL');
    expect(up).toContain('primary_candidate_fingerprint_sha256 text NOT NULL');
    expect(up).toContain('corroborating_candidate_fingerprint_sha256 text NOT NULL');
    expect(up).toContain('recorded_at timestamptz NOT NULL');
    expect(up).not.toContain('ALTER TABLE balance_sync_observations');
    expect(up).not.toContain("tier = 'PROVISIONAL'");
  });

  it('enforces the exact dormant financial envelope and coordinator v1 hashes', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);

    for (const marker of [
      'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY',
      "requested_envelope -> 'mayPersist' <> 'false'::jsonb",
      "requested_envelope -> 'mayAuthorizeFinancialAction' <> 'false'::jsonb",
      "observation ->> 'tier' <> 'FINANCIAL'",
      "source_point ->> 'selector' <> 'finalized'",
      'crypto-lending:balance-position:v1',
      'crypto-lending:mainnet-balance-position-set:v1',
      'crypto-lending:mainnet-balance-source-attestation:v1',
      'crypto-lending:mainnet-balance-two-source-agreement:v1',
      "agreement - 'agreementFingerprintSha256'",
    ]) {
      expect(up).toContain(marker);
    }
    expect(up).toContain('canonical_mainnet_balance_agreement_json');
    expect(up).toContain('ORDER BY entry.key COLLATE "C"');
    expect(up).toContain('ORDER BY object_key COLLATE "C"');
    expect(up).toContain('pg_catalog.sha256(pg_catalog.convert_to(');
    expect(up).toContain(
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    );
  });

  it('allows only the two requested mainnets and the three exact active assets per chain', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);

    for (const expected of [
      'eip155:1',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0xdac17f958d2ee523a2206206994597c13d831ec7',
      '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    ]) {
      expect(up).toContain(expected);
    }
    expect(up).not.toContain('eip155:8453');
    expect(up).not.toContain('eip155:42161');
  });

  it('requires exact checkpoints, ordered independent attestations, and later retrieval time', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);

    expect(up).toContain("checkpoint ->> 'kind' <> 'ETHEREUM_BLOCK'");
    expect(up).toContain("checkpoint ->> 'kind' <> 'SOLANA_ROOTED_BLOCK'");
    expect(up).toContain("checkpoint ->> 'rootDerivation' <> 'FINALIZED_SLOT_IS_ROOTED'");
    expect(up).toContain("primary_attestation ->> 'role' <> 'PRIMARY'");
    expect(up).toContain("corroborating_attestation ->> 'role' <> 'CORROBORATING'");
    expect(up).toMatch(
      /primary_attestation ->> 'sourceFamilyId'\s+= corroborating_attestation ->> 'sourceFamilyId'/u,
    );
    expect(up).toContain("source_point ->> 'retrievedAt' <> later_retrieved_at");
    expect(up).toContain('GREATEST(primary_retrieved_at, corroborating_retrieved_at)');
  });

  it('round-trips every timestamp and rejects zero identities and fingerprints', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);

    expect(up).toContain('pg_catalog.jsonb_path_exists(');
    expect(up).toContain("'strict $.** ? (@ == null)'::pg_catalog.jsonpath");
    expect(up.match(/AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'/gu)).toHaveLength(4);
    for (const timestampField of [
      "source_point ->> 'retrievedAt'",
      "primary_attestation ->> 'retrievedAt'",
      "corroborating_attestation ->> 'retrievedAt'",
      "agreement ->> 'sourcePairApprovalExpiresAt'",
    ]) {
      expect(up).toContain(`<> ${timestampField}`);
    }
    expect(up).toContain("source_hash = '0x' || pg_catalog.repeat('0', 64)");
    expect(up).toContain("source_hash = '11111111111111111111111111111111'");
    expect(up.match(/= pg_catalog\.repeat\('0', 64\)/gu)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('binds each insert to a locked active registry-v1 wallet and current approval', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);

    expect(up).toContain('FROM registered_wallets AS wallet');
    expect(up).toContain("wallet.status = 'ACTIVE'");
    expect(up).toContain("wallet.registry_environment = 'MAINNET'");
    expect(up).toContain('wallet.registry_version = 1');
    expect(up).toContain('FOR UPDATE OF wallet');
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.verifySql).toContain(
      'constraint_record.confkey = ARRAY[1,2,4,5]::smallint[]',
    );
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.verifySql).toContain(
      "constraint_record.conmatchtype = 's'",
    );
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.verifySql).toContain(
      'NOT constraint_record.condeferrable',
    );
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.verifySql).toContain(
      'NOT constraint_record.condeferred',
    );
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.verifySql).toContain(
      'NOT constraint_record.connoinherit',
    );
    expect(up).toContain('approval_expires_at <= requested_recorded_at');
    expect(up).toContain("pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())");
    expect(
      up.match(/mainnet_balance_financial_agreement_envelope_valid\(/gu)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
  });

  it('has deterministic idempotent replay and collision-conflict outcomes', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);

    expect(up).toContain("RETURN QUERY SELECT 'RECORDED'::text");
    expect(up.match(/'IDEMPOTENT_REPLAY'::text/gu)).toHaveLength(3);
    expect(up.match(/mainnet balance financial agreement replay conflict/gu)).toHaveLength(3);
    expect(up).toContain("USING ERRCODE = '23505'");
    expect(up).toContain('ON CONFLICT (agreement_fingerprint_sha256) DO NOTHING');
  });

  it('keeps every object owner-only and protects both row and truncate mutation paths', () => {
    const up = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql);
    const verifier = createMainnetBalanceAgreementEvidenceMigrationV0027.verifySql ?? '';

    expect(up).not.toContain('GRANT EXECUTE');
    expect(up).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE balance_sync_financial_agreement_evidence FROM PUBLIC',
    );
    expect(up).toContain('BEFORE UPDATE OR DELETE ON balance_sync_financial_agreement_evidence');
    expect(up).toContain('BEFORE TRUNCATE ON balance_sync_financial_agreement_evidence');
    expect(up.match(/ENABLE ALWAYS TRIGGER/gu)).toHaveLength(2);
    expect(verifier).toContain('acl.grantee <> guarded_table.relowner');
    expect(verifier).toContain('acl.grantee <> guarded_function.proowner');
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_api_runtime', 'record_balance_sync_financial_agreement_evidence(jsonb)', 'EXECUTE')",
    );
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'record_balance_sync_financial_agreement_evidence(jsonb)', 'EXECUTE')",
    );
  });

  it('rolls back only while unused and never weakens migration 0026', () => {
    const down = sql(createMainnetBalanceAgreementEvidenceMigrationV0027.downSql);

    expect(down).toContain('IF EXISTS (SELECT 1 FROM balance_sync_financial_agreement_evidence)');
    expect(down).toContain("USING ERRCODE = '55000'");
    expect(down).toContain(
      'REVOKE EXECUTE ON FUNCTION record_balance_sync_financial_agreement_evidence(jsonb)',
    );
    expect(down).toContain('DROP TABLE balance_sync_financial_agreement_evidence');
    expect(down).not.toContain('record_stablecoin_price_evidence');
    expect(down).not.toContain('GRANT');
  });

  it('shares DDL while isolating cumulative principal verification', () => {
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.upSql).toEqual(
      createMainnetBalanceAgreementEvidenceTestSchemaMigrationV0027.upSql,
    );
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.downSql).toEqual(
      createMainnetBalanceAgreementEvidenceTestSchemaMigrationV0027.downSql,
    );
    expect(createMainnetBalanceAgreementEvidenceMigrationV0027.verifySql).not.toEqual(
      createMainnetBalanceAgreementEvidenceTestSchemaMigrationV0027.verifySql,
    );
  });

  it('rejects unsafe principal identifiers through the cumulative predecessor', () => {
    expect(() =>
      createMainnetBalanceAgreementEvidenceMigration({
        ...PRODUCTION_DATABASE_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });
});
