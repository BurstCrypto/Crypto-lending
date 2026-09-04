import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createAuthenticationHmacKeyRotationMigration,
  createAuthenticationHmacKeyRotationMigrationV0025,
  createAuthenticationHmacKeyRotationTestSchemaMigrationV0025,
} from './0025-create-authentication-hmac-key-rotation.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

describe('migration 0025 authentication HMAC key rotation', () => {
  it('creates bounded policies, append-only identity aliases, and atomic key-ring functions', () => {
    const migration = createAuthenticationHmacKeyRotationMigrationV0025;
    const up = sql(migration.upSql);
    expect(migration.id).toBe('0025');
    expect(migration.supersedesVerificationOf).toEqual(['0024']);
    expect(up).toContain('CREATE TABLE auth_hmac_key_policies');
    expect(up).toContain('CREATE TABLE auth_oidc_identity_digest_aliases');
    expect(up).toContain('pg_catalog.cardinality(accepted_read_versions) BETWEEN 1 AND 3');
    expect(up).toContain('active_write_version = ANY(accepted_read_versions)');
    expect(up).toContain('<@ session_policy.accepted_read_versions IS NOT TRUE');
    expect(up).toContain(
      'NOT session_policy.active_write_version = ANY(requested_credential_digest_versions)',
    );
    expect(up).toContain('CREATE FUNCTION complete_auth_login_keyring(');
    expect(up).toContain('CREATE FUNCTION resolve_auth_session_keyring(');
    expect(up).toContain('CREATE FUNCTION consume_auth_rate_limit_keyring(');
    expect(up).toContain('minimum_remaining := LEAST');
    expect(up).toContain('any_limited := true');
    expect(up).toContain('requested_provider_key ||');
    expect(up).toContain('ENABLE ALWAYS TRIGGER auth_oidc_identity_alias_append_only_row');
  });

  it('grants only key-ring runtime entry points to the API role', () => {
    const up = sql(createAuthenticationHmacKeyRotationMigrationV0025.upSql);
    for (const identity of [
      'complete_auth_login_keyring',
      'resolve_auth_session_keyring',
      'rotate_auth_session_keyring',
      'revoke_auth_session_keyring',
      'consume_auth_rate_limit_keyring',
    ]) {
      expect(up).toContain(`GRANT EXECUTE ON FUNCTION ${identity}`);
    }
    expect(up).not.toContain(
      'GRANT EXECUTE ON FUNCTION auth_hmac_key_retirement_readiness(text,smallint)',
    );
    expect(up).not.toContain('GRANT EXECUTE ON FUNCTION verify_auth_hmac_rotation_state()');
    expect(up).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/iu);
  });

  it('pins exact function sources, triggers, constraints, ACLs, and live data shape', () => {
    const verifier = createAuthenticationHmacKeyRotationMigrationV0025.verifySql ?? '';
    expect(verifier).toContain("owner_role.rolname = 'crypto_schema_owner'");
    expect(verifier).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8'))",
    );
    expect(verifier).toContain('auth_oidc_identity_alias_append_only_row');
    expect(verifier).toContain('auth_oidc_identity_digest_alias_lookup_unique');
    expect(verifier).toContain(
      "NOT pg_catalog.has_function_privilege('crypto_api_runtime', 'auth_hmac_key_retirement_readiness",
    );
    expect(createAuthenticationHmacKeyRotationTestSchemaMigrationV0025.verifySql).toContain(
      'SELECT verify_auth_hmac_rotation_state() AS valid',
    );
  });

  it('refuses rollback after aliases, policy transition, or versioned retained state', () => {
    const down = sql(createAuthenticationHmacKeyRotationMigrationV0025.downSql);
    expect(down).toContain('cannot roll back authentication HMAC rotation after use');
    expect(down).toContain('SELECT 1 FROM auth_oidc_identity_digest_aliases');
    expect(down).toContain('credential_digest_version <> 1 OR csrf_digest_version <> 1');
    expect(down).toContain('subject_digest_version <> 1');
  });

  it('rejects unsafe principals and separates cumulative from isolated verification', () => {
    expect(() =>
      createAuthenticationHmacKeyRotationMigration({
        ...PRODUCTION_DATABASE_PRINCIPALS,
        apiRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('apiRuntimeRole');
    expect(createAuthenticationHmacKeyRotationMigrationV0025.upSql).toEqual(
      createAuthenticationHmacKeyRotationTestSchemaMigrationV0025.upSql,
    );
    expect(createAuthenticationHmacKeyRotationMigrationV0025.verifySql).not.toEqual(
      createAuthenticationHmacKeyRotationTestSchemaMigrationV0025.verifySql,
    );
  });
});
