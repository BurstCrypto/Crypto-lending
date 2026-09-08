import {
  createMainnetBalanceAgreementEvidenceV2Migration,
  createMainnetBalanceAgreementEvidenceV2MigrationV0032,
  createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032,
} from './0032-upgrade-mainnet-balance-agreement-evidence-v2.migration';
import { PRODUCTION_BALANCE_CONSUMER_PRINCIPALS } from './0028-suspend-generic-worker-balance-authority.migration';
import { DATABASE_MIGRATION_LIST, DATABASE_TEST_SCHEMA_MIGRATION_LIST } from './index';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0032 deployment-aware mainnet balance agreement evidence', () => {
  const migration = createMainnetBalanceAgreementEvidenceV2MigrationV0032;
  const up = sql(migration.upSql);
  const down = sql(migration.downSql);
  const verifier = migration.verifySql ?? '';

  it('extends the cumulative 0031 verifier and registers both variants before 0033', () => {
    expect(migration.id).toBe('0032');
    expect(migration.supersedesVerificationOf).toEqual(['0031']);
    expect(migration.transactional).not.toBe(false);
    expect(DATABASE_MIGRATION_LIST.at(-7)).toBe(
      createMainnetBalanceAgreementEvidenceV2MigrationV0032,
    );
    expect(DATABASE_TEST_SCHEMA_MIGRATION_LIST.at(-7)).toBe(
      createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032,
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
    expect(verifier).toContain('provider_position_chain_anchor_record_intents');
  });

  it('creates a separate append-only V2 table without rewriting V1 objects or rows', () => {
    expect(up).toContain('CREATE TABLE balance_sync_financial_agreement_evidence_v2');
    expect(up).toContain('approved_manifest_fingerprint_sha256 text NOT NULL');
    expect(up).toContain('observed_identity_fingerprint_sha256 text NOT NULL');
    expect(up).not.toMatch(/CREATE TABLE balance_sync_financial_agreement_evidence\s*\(/u);
    expect(up).not.toContain('ALTER TABLE balance_sync_financial_agreement_evidence ');
    expect(up).not.toMatch(/\bUPDATE balance_sync_financial_agreement_evidence\b/u);
    expect(up).not.toContain(
      'CREATE OR REPLACE FUNCTION mainnet_balance_financial_agreement_envelope_valid',
    );
    expect(up).not.toContain(
      'CREATE OR REPLACE FUNCTION record_balance_sync_financial_agreement_evidence',
    );
    expect(up).not.toContain('DISABLE TRIGGER');
    expect(up).toContain('owner-only;append-only;runtime-unregistered;v1-preserved');
    expect(up.match(/ENABLE ALWAYS TRIGGER/gu)).toHaveLength(2);
  });

  it('accepts only deployment-aware V2 rows with required flattened bindings', () => {
    expect(up).toContain('agreement_version = 2');
    expect(up).not.toContain('agreement_version = 1');
    expect(up).toContain(
      'mainnet_balance_financial_agreement_envelope_v2_valid(agreement_envelope, recorded_at)',
    );
    expect(up).toContain("approved_manifest_fingerprint_sha256 ~ '^[0-9a-f]{64}$'");
    expect(up).toContain("observed_identity_fingerprint_sha256 ~ '^[0-9a-f]{64}$'");
    expect(up).not.toContain('DEFAULT');
  });

  it('reproduces the coordinator V2 schema and fingerprint element order', () => {
    for (const marker of [
      "requested_envelope ->> 'agreementVersion' <> '2'",
      'EXACT_CHECKPOINT_BALANCE_AND_DEPLOYMENT_IDENTITY_MATCH',
      'crypto-lending:mainnet-balance-position-set:v1',
      'crypto-lending:mainnet-balance-source-attestation:v2',
      'crypto-lending:mainnet-balance-two-source-agreement:v2',
      "'approvedManifestFingerprintSha256'",
      "'observedIdentityFingerprintSha256'",
      "'deploymentIdentityValidated'",
      "source_point ->> 'approvedManifestFingerprintSha256'",
      "source_point ->> 'observedIdentityFingerprintSha256'",
    ]) {
      expect(up).toContain(marker);
    }
    expect(up).toMatch(
      /sourceFamilyId'.+sourceId'.+approvedManifestFingerprintSha256'.+observedIdentityFingerprintSha256'.+primary_source/su,
    );
    expect(up).toMatch(
      /agreement:v2', 2,.+account_id,.+approvedManifestFingerprintSha256'.+observedIdentityFingerprintSha256'.+observation/su,
    );
    expect(up).toContain("requested_envelope -> 'mayPersist' <> 'false'::jsonb");
    expect(up).toContain("requested_envelope -> 'mayAuthorizeFinancialAction' <> 'false'::jsonb");
  });

  it('hashes V2 position ids with bytea separators without invoking PostgreSQL NUL text', () => {
    expect(up).not.toContain('pg_catalog.chr(0)');
    expect(up.match(/pg_catalog\.decode\('00', 'hex'\)/gu)).toHaveLength(4);
    for (const part of [
      'crypto-lending:balance-position:v1',
      'account_id',
      'wallet_id',
      'network_id',
      'expected_asset',
    ]) {
      expect(up).toContain(
        `pg_catalog.convert_to(${part.startsWith('crypto-') ? `'${part}'` : part}, 'UTF8')`,
      );
    }
  });

  it('requires every coordinator-declared V2 string to retain its JSON string type', () => {
    expect(up.match(/<> 'string'/gu)).toHaveLength(51);
    expect(
      up.match(
        /pg_catalog\.jsonb_typeof\(\s*(?:source_point|agreement|primary_attestation|corroborating_attestation) -> '(?:approvedManifestFingerprintSha256|observedIdentityFingerprintSha256)'\s*\) <> 'string'/gu,
      ),
    ).toHaveLength(8);
  });

  it('binds both deployment fingerprints across the candidate, agreement, and attestations', () => {
    for (const path of [
      "agreement_envelope -> 'agreement' ->> 'approvedManifestFingerprintSha256'",
      "agreement_envelope -> 'agreement' ->> 'observedIdentityFingerprintSha256'",
      "agreement_envelope -> 'observationCandidate' -> 'source'",
      "agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 0",
      "agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1",
    ]) {
      expect(up).toContain(path);
    }
    expect(up).toContain("primary_attestation -> 'deploymentIdentityValidated' <> 'true'::jsonb");
    expect(up).toContain(
      "corroborating_attestation -> 'deploymentIdentityValidated' <> 'true'::jsonb",
    );
  });

  it('requires canonical nonzero 32-byte Solana block identities', () => {
    expect(up).toContain('mainnet_balance_solana_block_identity_v2_valid');
    expect(up).toContain("'^[1-9A-HJ-NP-Za-km-z]{32,44}$'");
    expect(up).toContain('numeric_value := numeric_value * 58 + digit');
    expect(up).toContain('leading_zero_bytes + decoded_bytes = 32');
    expect(up).toContain('numeric_value <> 0');
    expect(up).toContain('NOT mainnet_balance_solana_block_identity_v2_valid(source_parent_hash)');
  });

  it('uses a separate owner-only V2 writer with version-aware replay', () => {
    expect(up).toContain('CREATE FUNCTION record_balance_sync_financial_agreement_evidence_v2');
    expect(up).toContain('LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE');
    expect(up).toContain(
      'prior.agreement_version <> 2 OR prior.agreement_envelope <> requested_envelope',
    );
    expect(up).toContain(
      'prior.agreement_version = 2 AND prior.agreement_envelope = requested_envelope',
    );
    expect(up.match(/FROM balance_sync_financial_agreement_evidence AS evidence/gu)).toHaveLength(
      3,
    );
    expect(up).toContain('mainnet balance agreement fingerprint collides with v1 evidence');
    expect(up).toContain('ON CONFLICT (agreement_fingerprint_sha256) DO NOTHING');
    expect(up).toContain("wallet.status = 'ACTIVE'");
    expect(up).toContain("wallet.registry_environment = 'MAINNET'");
    expect(up).toContain('FOR UPDATE OF wallet');
    expect(up).not.toContain('GRANT ');
    for (const role of [
      'crypto_api_runtime',
      'crypto_worker_runtime',
      'crypto_runtime',
      'crypto_balance_consumer_runtime',
      'crypto_migration',
    ]) {
      expect(up).toContain(role);
    }
  });

  it('pins the extended schema, function bodies, constraints, and owner-only ACLs', () => {
    expect(verifier).toContain("(31, 'approved_manifest_fingerprint_sha256', 'text')");
    expect(verifier).toContain("(32, 'observed_identity_fingerprint_sha256', 'text')");
    expect(verifier).toContain('AND attribute.attnotnull');
    expect(verifier).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8'))",
    );
    expect(verifier).toContain('constraint_record.convalidated');
    expect(verifier).toContain("relation.relpersistence = 'p'");
    expect(verifier).toContain('NOT relation.relrowsecurity');
    expect(verifier).toContain('NOT relation.relforcerowsecurity');
    expect(verifier).toContain('NOT relation.relispartition');
    expect(verifier).toContain('FROM pg_catalog.pg_policy AS policy');
    expect(verifier).toContain('FROM pg_catalog.pg_rewrite AS rewrite');
    expect(verifier).toContain("attribute.attidentity = ''");
    expect(verifier).toContain("attribute.attgenerated = ''");
    expect(verifier).toContain('string_type.typcollation');
    expect(verifier).toContain('pg_catalog.aclexplode(guarded_attribute.attacl)');
    expect(verifier).toContain('NOT guarded_attribute.attisdropped');
    expect(verifier).toContain('procedure.pronargdefaults = 0');
    expect(verifier).toContain("language.lanname = 'plpgsql'");
    expect(verifier).toContain('procedure.proargtypes::text');
    expect(verifier).toContain("'recorded_agreement_fingerprint_sha256', 'evidence_recorded_at'");
    expect(verifier).toContain(`'i'::"char", 't'::"char", 't'::"char", 't'::"char"`);
    expect(verifier).toContain('acl.grantee <> guarded_function.proowner');
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_balance_consumer_runtime', 'record_balance_sync_financial_agreement_evidence_v2(jsonb)', 'EXECUTE')",
    );
  });

  it('pins all four V2 CHECK expressions to reviewed PostgreSQL 16 deparser hashes', () => {
    expect(
      verifier.match(/pg_catalog\.current_setting\('server_version_num'\)::integer >= 160000/gu),
    ).toHaveLength(1);
    expect(
      verifier.match(/pg_catalog\.current_setting\('server_version_num'\)::integer < 170000/gu),
    ).toHaveLength(1);
    expect(verifier.match(/server_state\.valid AND prior\.valid/gu)).toHaveLength(1);

    const checkExpressionHashes = Array.from(
      verifier.matchAll(
        /WHEN '(balance_sync_financial_agreement_v2_[a-z_]+_check)' THEN '([0-9a-f]{64})'/gu,
      ),
      (match) => [match[1], match[2]],
    );

    expect(checkExpressionHashes).toEqual([
      [
        'balance_sync_financial_agreement_v2_column_binding_check',
        '020c7a59d085f7b3ceebdc434a29a71172abfb36a85c4e10cf98cc7b2a76ca43',
      ],
      [
        'balance_sync_financial_agreement_v2_envelope_check',
        'ce3ccb4a34937a960276c59d13bd36b2c325b334adaafb75f8f7f1188a0fbe2c',
      ],
      [
        'balance_sync_financial_agreement_v2_network_check',
        'e408d79f63011e3e1370023a5d12af0da65a7c079d0cfc2461f728157518c6d4',
      ],
      [
        'balance_sync_financial_agreement_v2_static_state_check',
        'd92728ecaced60440ac887d5ace48ab8cc5b79c7ec81d645985aee4b3e414344',
      ],
    ]);
    expect(new Set(checkExpressionHashes.map(([, hash]) => hash)).size).toBe(4);
    expect(
      verifier.match(
        /pg_catalog\.pg_get_expr\(\s*constraint_record\.conbin, constraint_record\.conrelid, false\s*\)/gu,
      ),
    ).toHaveLength(1);
    expect(verifier).toContain('constraint_record.conbin, constraint_record.conrelid, false');
    expect(verifier).toContain('WHEN constraint_record.conbin IS NULL THEN false');
    expect(verifier).toContain('pg_catalog.convert_to(\n                pg_catalog.pg_get_expr(');
    expect(verifier).toContain("'UTF8'\n              )),\n              'hex'");
    expect(verifier).toContain('ELSE COALESCE(');
    expect(verifier).toContain('ELSE NULL\n            END,\n            false');
  });

  it('rolls back only while V2 is unused and never changes the V1 boundary', () => {
    expect(down).toContain(
      'LOCK TABLE balance_sync_financial_agreement_evidence_v2 IN ACCESS EXCLUSIVE MODE',
    );
    expect(down).toContain(
      'IF EXISTS (SELECT 1 FROM balance_sync_financial_agreement_evidence_v2)',
    );
    expect(down).toContain("USING ERRCODE = '55000'");
    expect(down).toContain('DROP TABLE balance_sync_financial_agreement_evidence_v2');
    expect(down).not.toMatch(
      /\b(?:ALTER|UPDATE|DELETE|TRUNCATE|DROP)\s+(?:TABLE\s+)?balance_sync_financial_agreement_evidence(?:\s|;)/u,
    );
    expect(down).not.toContain('DROP FUNCTION record_balance_sync_financial_agreement_evidence(');
    expect(down).not.toContain('GRANT ');
  });

  it('shares DDL while isolating cumulative principal verification', () => {
    expect(migration.upSql).toEqual(
      createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032.upSql,
    );
    expect(migration.downSql).toEqual(
      createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032.downSql,
    );
    expect(migration.verifySql).not.toEqual(
      createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032.verifySql,
    );
  });

  it('rejects unsafe principal identifiers through the cumulative predecessor', () => {
    expect(() =>
      createMainnetBalanceAgreementEvidenceV2Migration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });
});
