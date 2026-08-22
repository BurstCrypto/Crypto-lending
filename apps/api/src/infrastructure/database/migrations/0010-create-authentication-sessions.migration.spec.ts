import { PRODUCTION_DATABASE_PRINCIPALS } from './0005-enforce-database-principal-boundaries.migration';
import {
  createAuthenticationSessionsMigration,
  createAuthenticationSessionsMigrationV0010,
  createAuthenticationSessionsTestSchemaMigrationV0010,
} from './0010-create-authentication-sessions.migration';

function joinedSql(sql: string | readonly string[]): string {
  return typeof sql === 'string' ? sql : sql.join('\n');
}

describe('createAuthenticationSessionsMigration', () => {
  it('publishes matching production and isolated DDL with cumulative verifier divergence', () => {
    const canonical = createAuthenticationSessionsMigrationV0010;
    const isolated = createAuthenticationSessionsTestSchemaMigrationV0010;

    expect(canonical.id).toBe('0010');
    expect(canonical.upSql).toEqual(isolated.upSql);
    expect(canonical.downSql).toEqual(isolated.downSql);
    expect(canonical.verifySql).not.toEqual(isolated.verifySql);
    expect(canonical.supersedesVerificationOf).toEqual(['0009']);
    expect(isolated.supersedesVerificationOf).toEqual(['0009']);
  });

  it('pins exact issuer and HMAC-subject identity to one platform account', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);
    const identityTableSql = sql.slice(
      sql.indexOf('CREATE TABLE authentication_oidc_identities'),
      sql.indexOf('CREATE TABLE authentication_login_attempts'),
    );

    expect(sql).toContain('CREATE TABLE authentication_oidc_identities');
    expect(sql).toContain(
      'CONSTRAINT authentication_oidc_identity_account_unique UNIQUE (account_id)',
    );
    expect(sql).toContain('issuer, subject_digest_version, subject_digest');
    expect(sql).toContain('octet_length(subject_digest) = 32');
    expect(sql).toContain('identity.issuer = requested_verified_issuer');
    expect(sql).toContain('identity.subject_digest = requested_subject_digest');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(identityTableSql).not.toMatch(/\bsubject\s+text\b/iu);
    expect(identityTableSql).not.toMatch(/\bemail\b/iu);
  });

  it('persists flow and provisions a profile only for an unmapped registration', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);
    const rejectUnmappedLogin = sql.indexOf("IF login_attempt.flow = 'LOGIN' THEN");
    const provisionRegistration = sql.indexOf('PERFORM provisioned.profile_account_id');

    expect(sql).toContain('flow text NOT NULL');
    expect(sql).toContain("flow IN ('LOGIN', 'REGISTRATION')");
    expect(sql).toContain("requested_flow NOT IN ('LOGIN', 'REGISTRATION')");
    expect(sql).toContain('claimed_flow text');
    expect(sql).toContain('login_attempt.flow,');
    expect(sql).toContain('requested_registration_contact_email text');
    expect(sql).toContain('requested_registration_contact_phone text');
    expect(sql).toContain('requested_registration_residency_country_code text');
    expect(sql).toContain("failure_reason = 'UNMAPPED_IDENTITY'");
    expect(sql).toContain("'UNMAPPED_IDENTITY'");
    expect(sql).toContain('FROM provision_account_profile(');
    expect(sql).toContain('requested_registration_contact_email IS NULL');
    expect(sql).toContain('requested_registration_residency_country_code IS NULL');
    expect(rejectUnmappedLogin).toBeGreaterThan(-1);
    expect(provisionRegistration).toBeGreaterThan(rejectUnmappedLogin);
  });

  it('makes state, browser binding, and nonce digest-bound and callback state one-use', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);

    expect(sql).toContain('state_digest bytea NOT NULL');
    expect(sql).toContain('browser_binding_digest bytea NOT NULL');
    expect(sql).toContain('nonce_digest bytea NOT NULL');
    expect(sql).toContain('authentication_login_attempt_state_unique UNIQUE');
    expect(sql).toContain("status IN ('PENDING', 'CLAIMED', 'SUCCEEDED', 'REJECTED')");
    expect(sql).toContain("IF login_attempt.status <> 'PENDING' THEN");
    expect(sql).toContain("'CALLBACK_REPLAY_DETECTED'");
    expect(sql).toContain(
      'login_attempt.browser_binding_digest IS DISTINCT FROM requested_browser_binding_digest',
    );
    expect(sql).toContain('login_attempt.nonce_digest IS DISTINCT FROM requested_nonce_digest');
  });

  it('terminalizes claimed callback failures through a closed replay-safe boundary', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);
    const functionStart = sql.indexOf(
      'CREATE FUNCTION reject_claimed_authentication_login_attempt(',
    );
    const functionEnd = sql.indexOf(
      'CREATE FUNCTION complete_authentication_login(',
      functionStart,
    );
    const rejectionFunction = sql.slice(functionStart, functionEnd);

    expect(functionStart).toBeGreaterThan(-1);
    expect(rejectionFunction).toContain(
      "requested_failure_reason NOT IN (\n          'PROVIDER_ERROR', 'TOKEN_INVALID', 'IDENTITY_INVALID'",
    );
    expect(rejectionFunction).toContain("IF login_attempt.status = 'CLAIMED' THEN");
    expect(rejectionFunction).toContain("SET status = 'REJECTED'");
    expect(rejectionFunction).toContain('failure_reason = requested_failure_reason');
    expect(rejectionFunction).toContain("RETURN QUERY SELECT 'REJECTED'::text");
    expect(rejectionFunction).toContain("RETURN QUERY SELECT 'REPLAYED'::text");
    expect(rejectionFunction).toContain("RETURN QUERY SELECT 'INVALID'::text");
    expect(rejectionFunction).toContain("attempt.status = 'REJECTED'");
    expect(rejectionFunction).not.toContain("attempt.status = 'SUCCEEDED'");
    expect(rejectionFunction).toContain("audit.event_type = 'CALLBACK_REPLAY_DETECTED'");
    expect(rejectionFunction).not.toMatch(/provider_(?:payload|message)|token_value/iu);
  });

  it('terminalizes a correctly bound claimed completion that has expired', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);
    const functionStart = sql.indexOf('CREATE FUNCTION complete_authentication_login(');
    const functionEnd = sql.indexOf('CREATE FUNCTION resolve_authentication_session(');
    const completionFunction = sql.slice(functionStart, functionEnd);
    const mismatchRejection = completionFunction.indexOf(
      "RAISE EXCEPTION 'authentication login completion rejected'",
    );
    const expiryTerminalization = completionFunction.indexOf(
      'IF recorded_at >= login_attempt.expires_at THEN',
    );

    expect(functionStart).toBeGreaterThan(-1);
    expect(mismatchRejection).toBeGreaterThan(-1);
    expect(expiryTerminalization).toBeGreaterThan(mismatchRejection);
    expect(completionFunction.slice(0, mismatchRejection)).not.toContain(
      'recorded_at >= login_attempt.expires_at',
    );
    expect(completionFunction.slice(expiryTerminalization)).toContain(
      "SET status = 'REJECTED', completed_at = recorded_at, failure_reason = 'EXPIRED'",
    );
    expect(completionFunction.slice(expiryTerminalization)).toContain("'CALLBACK_REJECTED'");
    expect(completionFunction.slice(expiryTerminalization)).toContain("'EXPIRED'");
    expect(completionFunction.slice(expiryTerminalization)).toContain(
      "RETURN QUERY SELECT\n          'REJECTED'::text",
    );
  });

  it('rotates opaque credentials atomically and revokes the family on predecessor replay', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);

    expect(sql).toContain('CREATE TABLE authentication_session_families');
    expect(sql).toContain('CREATE TABLE authentication_session_credentials');
    expect(sql).toContain('octet_length(credential_digest) = 32');
    expect(sql).toContain('authentication_session_one_active_credential');
    expect(sql).toContain("SET status = 'ROTATED', consumed_at = recorded_at");
    expect(sql).toContain('session_credential.generation + 1');
    expect(sql).toContain('predecessor_credential_id');
    expect(sql).toContain("IF session_credential.status = 'ROTATED' THEN");
    expect(sql).toContain(
      "SET status = 'COMPROMISED', revoked_at = recorded_at, revocation_reason = 'REPLAY'",
    );
    expect(sql).toContain("'SESSION_REPLAY_DETECTED'");
    expect(sql).toContain("SET status = 'REVOKED', revoked_at = recorded_at");
    expect(sql).toContain("revocation_reason = 'LOGOUT'");
  });

  it('keeps audit append-only, closed, and free of generic payload storage', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);

    expect(sql).toContain('CREATE TABLE authentication_audit_events');
    expect(sql).toContain('authentication_audit_event_check CHECK');
    expect(sql).toContain('authentication_audit_outcome_check CHECK');
    expect(sql).toContain('authentication_audit_reason_check CHECK');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON authentication_audit_events');
    expect(sql).toContain('BEFORE TRUNCATE ON authentication_audit_events');
    expect(sql).toContain('ENABLE ALWAYS TRIGGER authentication_audit_append_only_row');
    expect(sql).not.toContain('jsonb');
    expect(sql).not.toMatch(/provider_(?:payload|message|detail)|user_agent|ip_address/iu);
  });

  it('uses a saturating atomic fixed-window limiter and audits only the first denial', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);

    expect(sql).toContain('CREATE TABLE authentication_rate_limit_buckets');
    expect(sql).toContain("scope IN ('LOGIN_START', 'CALLBACK', 'SESSION_ROTATE')");
    expect(sql).toContain('ON CONFLICT (');
    expect(sql).toContain(
      'SET request_count = LEAST(bucket.request_count + 1, bucket.limit_count + 1)',
    );
    expect(sql).toContain('WHERE bucket.limit_count = EXCLUDED.limit_count');
    expect(sql).toContain('AND bucket.limited_audited_at IS NULL');
    expect(sql).toContain("'RATE_LIMITED'");
    expect(sql).toContain("'LIMITED'::text");
  });

  it('grants only the eight explicit definer boundaries to the API role', () => {
    const names = {
      ...PRODUCTION_DATABASE_PRINCIPALS,
      apiRuntimeRole: 'kan37_custom_api',
      workerRuntimeRole: 'kan37_custom_worker',
      legacyRuntimeRole: 'kan37_custom_legacy',
    };
    const migration = createAuthenticationSessionsMigration(names);
    const sql = joinedSql(migration.upSql);
    const grants = sql.match(/GRANT EXECUTE ON FUNCTION [^;]+ TO "kan37_custom_api";/gu) ?? [];

    expect(grants).toHaveLength(8);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION complete_authentication_login(');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION reject_claimed_authentication_login_attempt(');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION consume_authentication_rate_limit(');
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION reject_authentication_audit_mutation\(\) TO "kan37_custom_api"/u,
    );
    expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]+?TO "kan37_custom_worker"/u);
    expect(sql).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON TABLE authentication_/u);
    expect(sql).toContain(
      'FROM PUBLIC, "kan37_custom_api", "kan37_custom_worker", "kan37_custom_legacy"',
    );
  });

  it('pins every API function search path and verifies the inherited 0009 boundary', () => {
    const canonicalVerifier = createAuthenticationSessionsMigrationV0010.verifySql ?? '';
    const isolatedVerifier = createAuthenticationSessionsTestSchemaMigrationV0010.verifySql ?? '';
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.upSql);

    expect(sql).toContain('SET search_path TO pg_catalog, %I, pg_temp');
    expect(canonicalVerifier).toContain('prior.valid AND authentication.valid');
    expect(canonicalVerifier).toContain('complete_ledger_command_idempotency');
    expect(canonicalVerifier).toContain('authentication_row_table');
    expect(canonicalVerifier).toContain('begin_authentication_login_attempt');
    expect(canonicalVerifier).toContain("procedure.provolatile <> 'v'");
    expect(canonicalVerifier).toContain("procedure.proparallel <> 'u'");
    expect(canonicalVerifier).toContain('authentication_session_one_active_credential');
    expect(canonicalVerifier).toContain(
      'SELECT object_count = 68 FROM authentication_column_catalog',
    );
    expect(canonicalVerifier).toContain(
      'SELECT object_count = 60 FROM authentication_constraint_catalog',
    );
    expect(canonicalVerifier).toContain(
      'SELECT object_count = 14 FROM authentication_index_catalog',
    );
    expect(canonicalVerifier).toContain(
      'SELECT object_count = 44 FROM authentication_internal_fk_trigger_catalog',
    );
    expect(canonicalVerifier).toContain(
      'SELECT object_count = 9 FROM authentication_function_catalog',
    );
    expect(isolatedVerifier).toContain('prior.valid AND authentication.valid');
    expect(isolatedVerifier).not.toContain('authentication_row_table');
  });

  it('refuses rollback after any retained identity, replay, audit, or limiter state exists', () => {
    const sql = joinedSql(createAuthenticationSessionsMigrationV0010.downSql);

    expect(sql).toContain('cannot roll back retained authentication security state');
    expect(sql).toContain('EXISTS (SELECT 1 FROM authentication_oidc_identities)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM authentication_session_credentials)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM authentication_audit_events)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM authentication_rate_limit_buckets)');
  });
});
