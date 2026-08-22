import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createLedgerCommandIdempotencyMigration } from './0009-create-ledger-command-idempotency.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

const AUTHENTICATION_TABLES = [
  'authentication_oidc_identities',
  'authentication_login_attempts',
  'authentication_session_families',
  'authentication_session_credentials',
  'authentication_audit_events',
  'authentication_rate_limit_buckets',
] as const;

const AUTHENTICATION_FUNCTION_IDENTITIES = [
  'reject_authentication_audit_mutation()',
  'begin_authentication_login_attempt(uuid,text,text,smallint,bytea,smallint,bytea,smallint,bytea,integer,uuid)',
  'claim_authentication_login_attempt(uuid,smallint,bytea,smallint,bytea,uuid)',
  'reject_claimed_authentication_login_attempt(uuid,text,uuid)',
  'complete_authentication_login(uuid,text,smallint,bytea,smallint,bytea,uuid,uuid,uuid,uuid,smallint,bytea,smallint,bytea,integer,integer,text,text,text,uuid)',
  'resolve_authentication_session(uuid,smallint,bytea,boolean,smallint,bytea,uuid)',
  'rotate_authentication_session(uuid,smallint,bytea,uuid,smallint,bytea,smallint,bytea,uuid)',
  'revoke_authentication_session(uuid,smallint,bytea,uuid)',
  'consume_authentication_rate_limit(text,smallint,bytea,integer,integer,uuid)',
] as const;

const AUTHENTICATION_API_FUNCTION_IDENTITIES = [
  'begin_authentication_login_attempt(uuid,text,text,smallint,bytea,smallint,bytea,smallint,bytea,integer,uuid)',
  'claim_authentication_login_attempt(uuid,smallint,bytea,smallint,bytea,uuid)',
  'reject_claimed_authentication_login_attempt(uuid,text,uuid)',
  'complete_authentication_login(uuid,text,smallint,bytea,smallint,bytea,uuid,uuid,uuid,uuid,smallint,bytea,smallint,bytea,integer,integer,text,text,text,uuid)',
  'resolve_authentication_session(uuid,smallint,bytea,boolean,smallint,bytea,uuid)',
  'rotate_authentication_session(uuid,smallint,bytea,uuid,smallint,bytea,smallint,bytea,uuid)',
  'revoke_authentication_session(uuid,smallint,bytea,uuid)',
  'consume_authentication_rate_limit(text,smallint,bytea,integer,integer,uuid)',
] as const;

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`);
  }
  return `"${value}"`;
}

function literal(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return `'${value}'`;
}

function createAuthenticationTablesSql(): string {
  return `
    CREATE TABLE authentication_oidc_identities (
      identity_id uuid PRIMARY KEY,
      account_id uuid NOT NULL,
      issuer text NOT NULL,
      subject_digest_version smallint NOT NULL,
      subject_digest bytea NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      disabled_at timestamptz,
      CONSTRAINT authentication_oidc_identity_id_uuid_v4_check CHECK (
        substring(identity_id::text FROM 15 FOR 1) = '4'
        AND substring(identity_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT authentication_oidc_identity_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_oidc_identity_account_unique UNIQUE (account_id),
      CONSTRAINT authentication_oidc_identity_issuer_check CHECK (
        char_length(issuer) BETWEEN 9 AND 2048
        AND issuer = btrim(issuer)
        AND issuer ~ '^https://[^[:space:]?#]+$'
      ),
      CONSTRAINT authentication_oidc_identity_subject_version_check CHECK (
        subject_digest_version > 0
      ),
      CONSTRAINT authentication_oidc_identity_subject_digest_check CHECK (
        octet_length(subject_digest) = 32
      ),
      CONSTRAINT authentication_oidc_identity_subject_unique UNIQUE (
        issuer, subject_digest_version, subject_digest
      ),
      CONSTRAINT authentication_oidc_identity_status_check CHECK (
        status IN ('ACTIVE', 'DISABLED')
      ),
      CONSTRAINT authentication_oidc_identity_status_time_check CHECK (
        (status = 'ACTIVE' AND disabled_at IS NULL)
        OR (status = 'DISABLED' AND disabled_at IS NOT NULL AND disabled_at >= created_at)
      )
    );

    CREATE TABLE authentication_login_attempts (
      attempt_id uuid PRIMARY KEY,
      flow text NOT NULL,
      issuer text NOT NULL,
      state_digest_version smallint NOT NULL,
      state_digest bytea NOT NULL,
      browser_binding_digest_version smallint NOT NULL,
      browser_binding_digest bytea NOT NULL,
      nonce_digest_version smallint NOT NULL,
      nonce_digest bytea NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL,
      claimed_at timestamptz,
      completed_at timestamptz,
      replay_detected_at timestamptz,
      account_id uuid,
      failure_reason text,
      CONSTRAINT authentication_login_attempt_id_uuid_v4_check CHECK (
        substring(attempt_id::text FROM 15 FOR 1) = '4'
        AND substring(attempt_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT authentication_login_attempt_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_login_attempt_flow_check CHECK (
        flow IN ('LOGIN', 'REGISTRATION')
      ),
      CONSTRAINT authentication_login_attempt_issuer_check CHECK (
        char_length(issuer) BETWEEN 9 AND 2048
        AND issuer = btrim(issuer)
        AND issuer ~ '^https://[^[:space:]?#]+$'
      ),
      CONSTRAINT authentication_login_attempt_digest_versions_check CHECK (
        state_digest_version > 0
        AND browser_binding_digest_version > 0
        AND nonce_digest_version > 0
      ),
      CONSTRAINT authentication_login_attempt_digests_check CHECK (
        octet_length(state_digest) = 32
        AND octet_length(browser_binding_digest) = 32
        AND octet_length(nonce_digest) = 32
      ),
      CONSTRAINT authentication_login_attempt_state_unique UNIQUE (
        state_digest_version, state_digest
      ),
      CONSTRAINT authentication_login_attempt_status_check CHECK (
        status IN ('PENDING', 'CLAIMED', 'SUCCEEDED', 'REJECTED')
      ),
      CONSTRAINT authentication_login_attempt_failure_reason_check CHECK (
        failure_reason IS NULL
        OR failure_reason IN (
          'EXPIRED',
          'IDENTITY_DISABLED',
          'UNMAPPED_IDENTITY',
          'PROVIDER_ERROR',
          'TOKEN_INVALID',
          'IDENTITY_INVALID'
        )
      ),
      CONSTRAINT authentication_login_attempt_lifetime_check CHECK (
        expires_at > created_at
        AND expires_at <= created_at + interval '15 minutes'
      ),
      CONSTRAINT authentication_login_attempt_state_shape_check CHECK (
        (status = 'PENDING'
          AND claimed_at IS NULL AND completed_at IS NULL
          AND account_id IS NULL AND failure_reason IS NULL)
        OR (status = 'CLAIMED'
          AND claimed_at IS NOT NULL AND completed_at IS NULL
          AND account_id IS NULL AND failure_reason IS NULL)
        OR (status = 'SUCCEEDED'
          AND claimed_at IS NOT NULL AND completed_at IS NOT NULL
          AND account_id IS NOT NULL AND failure_reason IS NULL)
        OR (status = 'REJECTED'
          AND completed_at IS NOT NULL AND account_id IS NULL
          AND failure_reason IS NOT NULL)
      ),
      CONSTRAINT authentication_login_attempt_time_order_check CHECK (
        (claimed_at IS NULL OR claimed_at >= created_at)
        AND (completed_at IS NULL OR completed_at >= created_at)
        AND (replay_detected_at IS NULL OR replay_detected_at >= created_at)
      )
    );

    CREATE TABLE authentication_session_families (
      session_family_id uuid PRIMARY KEY,
      account_id uuid NOT NULL,
      identity_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      idle_ttl_seconds integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      idle_expires_at timestamptz NOT NULL,
      absolute_expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      revocation_reason text,
      CONSTRAINT authentication_session_family_id_uuid_v4_check CHECK (
        substring(session_family_id::text FROM 15 FOR 1) = '4'
        AND substring(session_family_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT authentication_session_family_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_session_family_identity_fk FOREIGN KEY (identity_id)
        REFERENCES authentication_oidc_identities (identity_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_session_family_status_check CHECK (
        status IN ('ACTIVE', 'REVOKED', 'COMPROMISED')
      ),
      CONSTRAINT authentication_session_family_idle_ttl_check CHECK (
        idle_ttl_seconds BETWEEN 60 AND 2592000
      ),
      CONSTRAINT authentication_session_family_expiry_check CHECK (
        idle_expires_at > created_at
        AND absolute_expires_at > created_at
        AND idle_expires_at <= absolute_expires_at
      ),
      CONSTRAINT authentication_session_family_revocation_reason_check CHECK (
        revocation_reason IS NULL
        OR revocation_reason IN ('LOGOUT', 'REPLAY', 'EXPIRED', 'ADMINISTRATIVE')
      ),
      CONSTRAINT authentication_session_family_state_shape_check CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL AND revocation_reason IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
        OR (status = 'COMPROMISED' AND revoked_at IS NOT NULL AND revocation_reason = 'REPLAY')
      )
    );

    CREATE TABLE authentication_session_credentials (
      credential_id uuid PRIMARY KEY,
      session_family_id uuid NOT NULL,
      generation integer NOT NULL,
      credential_digest_version smallint NOT NULL,
      credential_digest bytea NOT NULL,
      csrf_digest_version smallint NOT NULL,
      csrf_digest bytea NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      predecessor_credential_id uuid,
      issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      replay_detected_at timestamptz,
      revoked_at timestamptz,
      CONSTRAINT authentication_session_credential_id_uuid_v4_check CHECK (
        substring(credential_id::text FROM 15 FOR 1) = '4'
        AND substring(credential_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT authentication_session_credential_family_fk FOREIGN KEY (session_family_id)
        REFERENCES authentication_session_families (session_family_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_session_credential_family_identity_unique UNIQUE (
        session_family_id, credential_id
      ),
      CONSTRAINT authentication_session_credential_predecessor_fk FOREIGN KEY (
        session_family_id, predecessor_credential_id
      ) REFERENCES authentication_session_credentials (session_family_id, credential_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_session_credential_generation_unique UNIQUE (
        session_family_id, generation
      ),
      CONSTRAINT authentication_session_credential_generation_check CHECK (
        generation > 0
        AND ((generation = 1 AND predecessor_credential_id IS NULL)
          OR (generation > 1 AND predecessor_credential_id IS NOT NULL))
      ),
      CONSTRAINT authentication_session_credential_digest_versions_check CHECK (
        credential_digest_version > 0 AND csrf_digest_version > 0
      ),
      CONSTRAINT authentication_session_credential_digests_check CHECK (
        octet_length(credential_digest) = 32 AND octet_length(csrf_digest) = 32
      ),
      CONSTRAINT authentication_session_credential_digest_unique UNIQUE (
        credential_digest_version, credential_digest
      ),
      CONSTRAINT authentication_session_credential_status_check CHECK (
        status IN ('ACTIVE', 'ROTATED', 'REVOKED')
      ),
      CONSTRAINT authentication_session_credential_expiry_check CHECK (expires_at > issued_at),
      CONSTRAINT authentication_session_credential_state_shape_check CHECK (
        (status = 'ACTIVE'
          AND consumed_at IS NULL AND replay_detected_at IS NULL AND revoked_at IS NULL)
        OR (status = 'ROTATED'
          AND consumed_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
      )
    );

    CREATE UNIQUE INDEX authentication_session_one_active_credential
      ON authentication_session_credentials (session_family_id)
      WHERE status = 'ACTIVE';

    CREATE TABLE authentication_audit_events (
      audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL,
      outcome text NOT NULL,
      reason_code text NOT NULL,
      attempt_id uuid,
      identity_id uuid,
      account_id uuid,
      session_family_id uuid,
      credential_id uuid,
      correlation_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT authentication_audit_id_uuid_v4_check CHECK (
        substring(audit_id::text FROM 15 FOR 1) = '4'
        AND substring(audit_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT authentication_audit_attempt_fk FOREIGN KEY (attempt_id)
        REFERENCES authentication_login_attempts (attempt_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_audit_identity_fk FOREIGN KEY (identity_id)
        REFERENCES authentication_oidc_identities (identity_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_audit_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_audit_session_fk FOREIGN KEY (session_family_id)
        REFERENCES authentication_session_families (session_family_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_audit_credential_fk FOREIGN KEY (credential_id)
        REFERENCES authentication_session_credentials (credential_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT authentication_audit_event_check CHECK (event_type IN (
        'LOGIN_ATTEMPT_STARTED',
        'CALLBACK_CLAIMED',
        'CALLBACK_REJECTED',
        'CALLBACK_REPLAY_DETECTED',
        'IDENTITY_CREATED',
        'LOGIN_SUCCEEDED',
        'SESSION_ISSUED',
        'SESSION_ROTATED',
        'SESSION_REPLAY_DETECTED',
        'SESSION_REVOKED',
        'RATE_LIMITED'
      )),
      CONSTRAINT authentication_audit_outcome_check CHECK (
        outcome IN ('SUCCEEDED', 'REJECTED', 'DETECTED')
      ),
      CONSTRAINT authentication_audit_reason_check CHECK (
        reason_code IN (
          'NONE', 'EXPIRED', 'IDENTITY_DISABLED', 'UNMAPPED_IDENTITY',
          'PROVIDER_ERROR', 'TOKEN_INVALID', 'IDENTITY_INVALID',
          'REPLAY', 'LOGOUT', 'RATE_LIMIT'
        )
      )
    );

    CREATE TABLE authentication_rate_limit_buckets (
      scope text NOT NULL,
      subject_digest_version smallint NOT NULL,
      subject_digest bytea NOT NULL,
      window_started_at timestamptz NOT NULL,
      window_seconds integer NOT NULL,
      limit_count integer NOT NULL,
      request_count integer NOT NULL,
      limited_audited_at timestamptz,
      CONSTRAINT authentication_rate_limit_scope_check CHECK (
        scope IN ('LOGIN_START', 'CALLBACK', 'SESSION_ROTATE')
      ),
      CONSTRAINT authentication_rate_limit_digest_check CHECK (
        subject_digest_version > 0 AND octet_length(subject_digest) = 32
      ),
      CONSTRAINT authentication_rate_limit_policy_check CHECK (
        window_seconds BETWEEN 1 AND 3600 AND limit_count BETWEEN 1 AND 10000
      ),
      CONSTRAINT authentication_rate_limit_count_check CHECK (
        request_count BETWEEN 1 AND limit_count + 1
      ),
      CONSTRAINT authentication_rate_limit_bucket_pk PRIMARY KEY (
        scope,
        subject_digest_version,
        subject_digest,
        window_started_at,
        window_seconds
      )
    );

    CREATE INDEX authentication_rate_limit_retention_index
      ON authentication_rate_limit_buckets (window_started_at);
  `;
}

function createAuthenticationFunctionsSql(): string {
  return `
    CREATE FUNCTION reject_authentication_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      RAISE EXCEPTION 'authentication audit events are append-only' USING ERRCODE = '55000';
    END;
    $function$;

    CREATE FUNCTION begin_authentication_login_attempt(
      requested_attempt_id uuid,
      requested_flow text,
      requested_issuer text,
      requested_state_digest_version smallint,
      requested_state_digest bytea,
      requested_browser_binding_digest_version smallint,
      requested_browser_binding_digest bytea,
      requested_nonce_digest_version smallint,
      requested_nonce_digest bytea,
      requested_ttl_seconds integer,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      attempt_id uuid,
      expires_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      recorded_at timestamptz := clock_timestamp();
      recorded_expires_at timestamptz;
    BEGIN
      IF requested_attempt_id IS NULL
        OR substring(requested_attempt_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_attempt_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_flow IS NULL OR requested_flow NOT IN ('LOGIN', 'REGISTRATION')
        OR requested_issuer IS NULL
        OR char_length(requested_issuer) NOT BETWEEN 9 AND 2048
        OR requested_issuer IS DISTINCT FROM btrim(requested_issuer)
        OR requested_issuer !~ '^https://[^[:space:]?#]+$'
        OR requested_state_digest_version IS NULL OR requested_state_digest_version < 1
        OR requested_browser_binding_digest_version IS NULL
        OR requested_browser_binding_digest_version < 1
        OR requested_nonce_digest_version IS NULL OR requested_nonce_digest_version < 1
        OR requested_state_digest IS NULL OR octet_length(requested_state_digest) <> 32
        OR requested_browser_binding_digest IS NULL
        OR octet_length(requested_browser_binding_digest) <> 32
        OR requested_nonce_digest IS NULL OR octet_length(requested_nonce_digest) <> 32
        OR requested_ttl_seconds IS NULL OR requested_ttl_seconds NOT BETWEEN 30 AND 900
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication login attempt' USING ERRCODE = '22023';
      END IF;

      recorded_expires_at := recorded_at + requested_ttl_seconds * interval '1 second';

      INSERT INTO authentication_login_attempts (
        attempt_id,
        flow,
        issuer,
        state_digest_version,
        state_digest,
        browser_binding_digest_version,
        browser_binding_digest,
        nonce_digest_version,
        nonce_digest,
        created_at,
        expires_at
      ) VALUES (
        requested_attempt_id,
        requested_flow,
        requested_issuer,
        requested_state_digest_version,
        requested_state_digest,
        requested_browser_binding_digest_version,
        requested_browser_binding_digest,
        requested_nonce_digest_version,
        requested_nonce_digest,
        recorded_at,
        recorded_expires_at
      );

      INSERT INTO authentication_audit_events (
        event_type, outcome, reason_code, attempt_id, correlation_id, occurred_at
      ) VALUES (
        'LOGIN_ATTEMPT_STARTED',
        'SUCCEEDED',
        'NONE',
        requested_attempt_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT requested_attempt_id, recorded_expires_at;
    END;
    $function$;

    CREATE FUNCTION claim_authentication_login_attempt(
      requested_attempt_id uuid,
      requested_state_digest_version smallint,
      requested_state_digest bytea,
      requested_browser_binding_digest_version smallint,
      requested_browser_binding_digest bytea,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      claim_outcome text,
      claimed_flow text,
      claimed_issuer text,
      claimed_nonce_digest_version smallint,
      claimed_nonce_digest bytea
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      login_attempt authentication_login_attempts%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
      replay_update_count bigint;
    BEGIN
      IF requested_attempt_id IS NULL
        OR requested_state_digest_version IS NULL OR requested_state_digest_version < 1
        OR requested_state_digest IS NULL OR octet_length(requested_state_digest) <> 32
        OR requested_browser_binding_digest_version IS NULL
        OR requested_browser_binding_digest_version < 1
        OR requested_browser_binding_digest IS NULL
        OR octet_length(requested_browser_binding_digest) <> 32
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication callback claim' USING ERRCODE = '22023';
      END IF;

      SELECT attempt.*
      INTO login_attempt
      FROM authentication_login_attempts AS attempt
      WHERE attempt.attempt_id = requested_attempt_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN QUERY SELECT
          'INVALID'::text, NULL::text, NULL::text, NULL::smallint, NULL::bytea;
        RETURN;
      END IF;

      IF login_attempt.state_digest_version IS DISTINCT FROM requested_state_digest_version
        OR login_attempt.state_digest IS DISTINCT FROM requested_state_digest
        OR login_attempt.browser_binding_digest_version
          IS DISTINCT FROM requested_browser_binding_digest_version
        OR login_attempt.browser_binding_digest IS DISTINCT FROM requested_browser_binding_digest
      THEN
        RETURN QUERY SELECT
          'INVALID'::text, NULL::text, NULL::text, NULL::smallint, NULL::bytea;
        RETURN;
      END IF;

      IF login_attempt.status <> 'PENDING' THEN
        UPDATE authentication_login_attempts AS attempt
        SET replay_detected_at = recorded_at
        WHERE attempt.attempt_id = requested_attempt_id
          AND attempt.replay_detected_at IS NULL;
        GET DIAGNOSTICS replay_update_count = ROW_COUNT;

        IF replay_update_count = 1
          AND NOT EXISTS (
            SELECT 1
            FROM authentication_audit_events AS audit
            WHERE audit.attempt_id = requested_attempt_id
              AND audit.event_type = 'CALLBACK_REPLAY_DETECTED'
          )
        THEN
          INSERT INTO authentication_audit_events (
            event_type, outcome, reason_code, attempt_id, correlation_id, occurred_at
          ) VALUES (
            'CALLBACK_REPLAY_DETECTED',
            'DETECTED',
            'REPLAY',
            requested_attempt_id,
            requested_correlation_id,
            recorded_at
          );
        END IF;

        RETURN QUERY SELECT
          'REPLAYED'::text, NULL::text, NULL::text, NULL::smallint, NULL::bytea;
        RETURN;
      END IF;

      IF recorded_at >= login_attempt.expires_at THEN
        UPDATE authentication_login_attempts AS attempt
        SET status = 'REJECTED', completed_at = recorded_at, failure_reason = 'EXPIRED'
        WHERE attempt.attempt_id = requested_attempt_id;

        INSERT INTO authentication_audit_events (
          event_type, outcome, reason_code, attempt_id, correlation_id, occurred_at
        ) VALUES (
          'CALLBACK_REJECTED',
          'REJECTED',
          'EXPIRED',
          requested_attempt_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT
          'EXPIRED'::text, NULL::text, NULL::text, NULL::smallint, NULL::bytea;
        RETURN;
      END IF;

      UPDATE authentication_login_attempts AS attempt
      SET status = 'CLAIMED', claimed_at = recorded_at
      WHERE attempt.attempt_id = requested_attempt_id;

      INSERT INTO authentication_audit_events (
        event_type, outcome, reason_code, attempt_id, correlation_id, occurred_at
      ) VALUES (
        'CALLBACK_CLAIMED',
        'SUCCEEDED',
        'NONE',
        requested_attempt_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT
        'CLAIMED'::text,
        login_attempt.flow,
        login_attempt.issuer,
        login_attempt.nonce_digest_version,
        login_attempt.nonce_digest;
    END;
    $function$;

    CREATE FUNCTION reject_claimed_authentication_login_attempt(
      requested_attempt_id uuid,
      requested_failure_reason text,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      rejection_outcome text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      login_attempt authentication_login_attempts%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
    BEGIN
      IF requested_attempt_id IS NULL
        OR requested_failure_reason IS NULL
        OR requested_failure_reason NOT IN (
          'PROVIDER_ERROR', 'TOKEN_INVALID', 'IDENTITY_INVALID'
        )
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication callback rejection'
          USING ERRCODE = '22023';
      END IF;

      SELECT attempt.*
      INTO login_attempt
      FROM authentication_login_attempts AS attempt
      WHERE attempt.attempt_id = requested_attempt_id
      FOR UPDATE;

      IF NOT FOUND
        OR login_attempt.status = 'PENDING'
        OR (login_attempt.status = 'REJECTED' AND login_attempt.claimed_at IS NULL)
      THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;

      IF login_attempt.status = 'CLAIMED' THEN
        UPDATE authentication_login_attempts AS attempt
        SET status = 'REJECTED',
            completed_at = recorded_at,
            failure_reason = requested_failure_reason
        WHERE attempt.attempt_id = requested_attempt_id
          AND attempt.status = 'CLAIMED';

        INSERT INTO authentication_audit_events (
          event_type, outcome, reason_code, attempt_id, correlation_id, occurred_at
        ) VALUES (
          'CALLBACK_REJECTED',
          'REJECTED',
          requested_failure_reason,
          requested_attempt_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT 'REJECTED'::text;
        RETURN;
      END IF;

      UPDATE authentication_login_attempts AS attempt
      SET replay_detected_at = recorded_at
      WHERE attempt.attempt_id = requested_attempt_id
        AND attempt.status = 'REJECTED'
        AND attempt.replay_detected_at IS NULL;

      IF NOT EXISTS (
        SELECT 1
        FROM authentication_audit_events AS audit
        WHERE audit.attempt_id = requested_attempt_id
          AND audit.event_type = 'CALLBACK_REPLAY_DETECTED'
      )
      THEN
        INSERT INTO authentication_audit_events (
          event_type, outcome, reason_code, attempt_id, account_id,
          correlation_id, occurred_at
        ) VALUES (
          'CALLBACK_REPLAY_DETECTED',
          'DETECTED',
          'REPLAY',
          requested_attempt_id,
          login_attempt.account_id,
          requested_correlation_id,
          recorded_at
        );
      END IF;

      RETURN QUERY SELECT 'REPLAYED'::text;
    END;
    $function$;

    CREATE FUNCTION complete_authentication_login(
      requested_attempt_id uuid,
      requested_verified_issuer text,
      requested_nonce_digest_version smallint,
      requested_nonce_digest bytea,
      requested_subject_digest_version smallint,
      requested_subject_digest bytea,
      requested_account_id uuid,
      requested_identity_id uuid,
      requested_session_family_id uuid,
      requested_credential_id uuid,
      requested_credential_digest_version smallint,
      requested_credential_digest bytea,
      requested_csrf_digest_version smallint,
      requested_csrf_digest bytea,
      requested_idle_ttl_seconds integer,
      requested_absolute_ttl_seconds integer,
      requested_registration_contact_email text,
      requested_registration_contact_phone text,
      requested_registration_residency_country_code text,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      login_outcome text,
      account_id uuid,
      session_family_id uuid,
      credential_id uuid,
      idle_expires_at timestamptz,
      absolute_expires_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      login_attempt authentication_login_attempts%ROWTYPE;
      mapped_identity authentication_oidc_identities%ROWTYPE;
      mapped_account_id uuid;
      mapped_identity_id uuid;
      recorded_at timestamptz := clock_timestamp();
      recorded_idle_expires_at timestamptz;
      recorded_absolute_expires_at timestamptz;
    BEGIN
      IF requested_attempt_id IS NULL
        OR requested_verified_issuer IS NULL
        OR requested_nonce_digest_version IS NULL OR requested_nonce_digest_version < 1
        OR requested_nonce_digest IS NULL OR octet_length(requested_nonce_digest) <> 32
        OR requested_subject_digest_version IS NULL OR requested_subject_digest_version < 1
        OR requested_subject_digest IS NULL OR octet_length(requested_subject_digest) <> 32
        OR requested_account_id IS NULL
        OR substring(requested_account_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_account_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_identity_id IS NULL
        OR substring(requested_identity_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_identity_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_session_family_id IS NULL
        OR substring(requested_session_family_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_session_family_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_credential_id IS NULL
        OR substring(requested_credential_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_credential_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_credential_digest_version IS NULL
        OR requested_credential_digest_version < 1
        OR requested_credential_digest IS NULL
        OR octet_length(requested_credential_digest) <> 32
        OR requested_csrf_digest_version IS NULL OR requested_csrf_digest_version < 1
        OR requested_csrf_digest IS NULL OR octet_length(requested_csrf_digest) <> 32
        OR requested_idle_ttl_seconds IS NULL
        OR requested_idle_ttl_seconds NOT BETWEEN 60 AND 2592000
        OR requested_absolute_ttl_seconds IS NULL
        OR requested_absolute_ttl_seconds NOT BETWEEN 300 AND 7776000
        OR requested_idle_ttl_seconds > requested_absolute_ttl_seconds
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication login completion' USING ERRCODE = '22023';
      END IF;

      SELECT attempt.*
      INTO login_attempt
      FROM authentication_login_attempts AS attempt
      WHERE attempt.attempt_id = requested_attempt_id
      FOR UPDATE;

      IF NOT FOUND
        OR login_attempt.status <> 'CLAIMED'
        OR login_attempt.issuer IS DISTINCT FROM requested_verified_issuer
        OR login_attempt.nonce_digest_version IS DISTINCT FROM requested_nonce_digest_version
        OR login_attempt.nonce_digest IS DISTINCT FROM requested_nonce_digest
      THEN
        RAISE EXCEPTION 'authentication login completion rejected' USING ERRCODE = '28000';
      END IF;

      IF recorded_at >= login_attempt.expires_at THEN
        UPDATE authentication_login_attempts AS attempt
        SET status = 'REJECTED', completed_at = recorded_at, failure_reason = 'EXPIRED'
        WHERE attempt.attempt_id = requested_attempt_id
          AND attempt.status = 'CLAIMED';

        INSERT INTO authentication_audit_events (
          event_type, outcome, reason_code, attempt_id, correlation_id, occurred_at
        ) VALUES (
          'CALLBACK_REJECTED',
          'REJECTED',
          'EXPIRED',
          requested_attempt_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT
          'REJECTED'::text,
          NULL::uuid,
          NULL::uuid,
          NULL::uuid,
          NULL::timestamptz,
          NULL::timestamptz;
        RETURN;
      END IF;

      IF (login_attempt.flow = 'LOGIN'
          AND (requested_registration_contact_email IS NOT NULL
            OR requested_registration_contact_phone IS NOT NULL
            OR requested_registration_residency_country_code IS NOT NULL))
        OR (login_attempt.flow = 'REGISTRATION'
          AND (requested_registration_contact_email IS NULL
            OR requested_registration_residency_country_code IS NULL))
      THEN
        RAISE EXCEPTION 'authentication registration profile does not match login flow'
          USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          requested_verified_issuer || ':' || requested_subject_digest_version::text || ':'
            || pg_catalog.encode(requested_subject_digest, 'hex'),
          37001
        )
      );

      SELECT identity.*
      INTO mapped_identity
      FROM authentication_oidc_identities AS identity
      WHERE identity.issuer = requested_verified_issuer
        AND identity.subject_digest_version = requested_subject_digest_version
        AND identity.subject_digest = requested_subject_digest
      FOR UPDATE;

      IF FOUND THEN
        IF mapped_identity.status <> 'ACTIVE' THEN
          UPDATE authentication_login_attempts AS attempt
          SET status = 'REJECTED', completed_at = recorded_at,
              failure_reason = 'IDENTITY_DISABLED'
          WHERE attempt.attempt_id = requested_attempt_id;

          INSERT INTO authentication_audit_events (
            event_type, outcome, reason_code, attempt_id, identity_id, account_id,
            correlation_id, occurred_at
          ) VALUES (
            'CALLBACK_REJECTED',
            'REJECTED',
            'IDENTITY_DISABLED',
            requested_attempt_id,
            mapped_identity.identity_id,
            mapped_identity.account_id,
            requested_correlation_id,
            recorded_at
          );

          RETURN QUERY SELECT
            'REJECTED'::text,
            NULL::uuid,
            NULL::uuid,
            NULL::uuid,
            NULL::timestamptz,
            NULL::timestamptz;
          RETURN;
        END IF;

        mapped_account_id := mapped_identity.account_id;
        mapped_identity_id := mapped_identity.identity_id;
      ELSE
        IF login_attempt.flow = 'LOGIN' THEN
          UPDATE authentication_login_attempts AS attempt
          SET status = 'REJECTED', completed_at = recorded_at,
              failure_reason = 'UNMAPPED_IDENTITY'
          WHERE attempt.attempt_id = requested_attempt_id;

          INSERT INTO authentication_audit_events (
            event_type, outcome, reason_code, attempt_id, correlation_id, occurred_at
          ) VALUES (
            'CALLBACK_REJECTED',
            'REJECTED',
            'UNMAPPED_IDENTITY',
            requested_attempt_id,
            requested_correlation_id,
            recorded_at
          );

          RETURN QUERY SELECT
            'REJECTED'::text,
            NULL::uuid,
            NULL::uuid,
            NULL::uuid,
            NULL::timestamptz,
            NULL::timestamptz;
          RETURN;
        END IF;

        PERFORM provisioned.profile_account_id
        FROM provision_account_profile(
          requested_account_id,
          requested_registration_contact_email,
          requested_registration_contact_phone,
          requested_registration_residency_country_code,
          requested_account_id,
          requested_correlation_id::text
        ) AS provisioned;

        INSERT INTO authentication_oidc_identities (
          identity_id,
          account_id,
          issuer,
          subject_digest_version,
          subject_digest,
          created_at
        ) VALUES (
          requested_identity_id,
          requested_account_id,
          requested_verified_issuer,
          requested_subject_digest_version,
          requested_subject_digest,
          recorded_at
        );

        mapped_account_id := requested_account_id;
        mapped_identity_id := requested_identity_id;

        INSERT INTO authentication_audit_events (
          event_type, outcome, reason_code, attempt_id, identity_id, account_id,
          correlation_id, occurred_at
        ) VALUES (
          'IDENTITY_CREATED',
          'SUCCEEDED',
          'NONE',
          requested_attempt_id,
          mapped_identity_id,
          mapped_account_id,
          requested_correlation_id,
          recorded_at
        );
      END IF;

      recorded_absolute_expires_at :=
        recorded_at + requested_absolute_ttl_seconds * interval '1 second';
      recorded_idle_expires_at :=
        recorded_at + requested_idle_ttl_seconds * interval '1 second';

      INSERT INTO authentication_session_families (
        session_family_id,
        account_id,
        identity_id,
        idle_ttl_seconds,
        created_at,
        idle_expires_at,
        absolute_expires_at
      ) VALUES (
        requested_session_family_id,
        mapped_account_id,
        mapped_identity_id,
        requested_idle_ttl_seconds,
        recorded_at,
        recorded_idle_expires_at,
        recorded_absolute_expires_at
      );

      INSERT INTO authentication_session_credentials (
        credential_id,
        session_family_id,
        generation,
        credential_digest_version,
        credential_digest,
        csrf_digest_version,
        csrf_digest,
        issued_at,
        expires_at
      ) VALUES (
        requested_credential_id,
        requested_session_family_id,
        1,
        requested_credential_digest_version,
        requested_credential_digest,
        requested_csrf_digest_version,
        requested_csrf_digest,
        recorded_at,
        recorded_idle_expires_at
      );

      UPDATE authentication_login_attempts AS attempt
      SET status = 'SUCCEEDED', completed_at = recorded_at, account_id = mapped_account_id
      WHERE attempt.attempt_id = requested_attempt_id;

      INSERT INTO authentication_audit_events (
        event_type, outcome, reason_code, attempt_id, identity_id, account_id,
        session_family_id, credential_id, correlation_id, occurred_at
      ) VALUES
        (
          'LOGIN_SUCCEEDED', 'SUCCEEDED', 'NONE', requested_attempt_id,
          mapped_identity_id, mapped_account_id, requested_session_family_id,
          requested_credential_id, requested_correlation_id, recorded_at
        ),
        (
          'SESSION_ISSUED', 'SUCCEEDED', 'NONE', requested_attempt_id,
          mapped_identity_id, mapped_account_id, requested_session_family_id,
          requested_credential_id, requested_correlation_id, recorded_at
        );

      RETURN QUERY SELECT
        'AUTHENTICATED'::text,
        mapped_account_id,
        requested_session_family_id,
        requested_credential_id,
        recorded_idle_expires_at,
        recorded_absolute_expires_at;
    END;
    $function$;
  `;
}

function createAuthenticationSessionFunctionsSql(): string {
  return `
    CREATE FUNCTION resolve_authentication_session(
      requested_credential_id uuid,
      requested_credential_digest_version smallint,
      requested_credential_digest bytea,
      requested_require_csrf boolean,
      requested_csrf_digest_version smallint,
      requested_csrf_digest bytea,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      authentication_outcome text,
      account_id uuid,
      session_family_id uuid
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      located_family_id uuid;
      session_family authentication_session_families%ROWTYPE;
      session_credential authentication_session_credentials%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
      replay_update_count bigint;
    BEGIN
      IF requested_credential_id IS NULL
        OR requested_credential_digest_version IS NULL
        OR requested_credential_digest_version < 1
        OR requested_credential_digest IS NULL
        OR octet_length(requested_credential_digest) <> 32
        OR requested_require_csrf IS NULL
        OR (
          requested_require_csrf
          AND (
            requested_csrf_digest_version IS NULL
            OR requested_csrf_digest_version < 1
            OR requested_csrf_digest IS NULL
            OR octet_length(requested_csrf_digest) <> 32
          )
        )
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication session credential' USING ERRCODE = '22023';
      END IF;

      SELECT credential.session_family_id
      INTO located_family_id
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id;

      IF located_family_id IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      SELECT family.*
      INTO session_family
      FROM authentication_session_families AS family
      WHERE family.session_family_id = located_family_id
      FOR UPDATE;

      SELECT credential.*
      INTO session_credential
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id
        AND credential.session_family_id = located_family_id
      FOR UPDATE;

      IF NOT FOUND
        OR session_credential.credential_digest_version
          IS DISTINCT FROM requested_credential_digest_version
        OR session_credential.credential_digest IS DISTINCT FROM requested_credential_digest
      THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      IF session_credential.status = 'ROTATED' THEN
        UPDATE authentication_session_credentials AS credential
        SET replay_detected_at = COALESCE(credential.replay_detected_at, recorded_at)
        WHERE credential.credential_id = requested_credential_id
          AND credential.replay_detected_at IS NULL;
        GET DIAGNOSTICS replay_update_count = ROW_COUNT;

        IF session_family.status = 'ACTIVE' THEN
          UPDATE authentication_session_families AS family
          SET status = 'COMPROMISED', revoked_at = recorded_at, revocation_reason = 'REPLAY'
          WHERE family.session_family_id = located_family_id;

          UPDATE authentication_session_credentials AS credential
          SET status = 'REVOKED', revoked_at = recorded_at
          WHERE credential.session_family_id = located_family_id
            AND credential.status = 'ACTIVE';
        END IF;

        IF replay_update_count = 1 THEN
          INSERT INTO authentication_audit_events (
            event_type, outcome, reason_code, identity_id, account_id,
            session_family_id, credential_id, correlation_id, occurred_at
          ) VALUES (
            'SESSION_REPLAY_DETECTED',
            'DETECTED',
            'REPLAY',
            session_family.identity_id,
            session_family.account_id,
            located_family_id,
            requested_credential_id,
            requested_correlation_id,
            recorded_at
          );
        END IF;

        RETURN QUERY SELECT 'REPLAYED'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      IF session_credential.status <> 'ACTIVE' OR session_family.status <> 'ACTIVE' THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      IF recorded_at >= session_credential.expires_at
        OR recorded_at >= session_family.idle_expires_at
        OR recorded_at >= session_family.absolute_expires_at
      THEN
        UPDATE authentication_session_families AS family
        SET status = 'REVOKED', revoked_at = recorded_at, revocation_reason = 'EXPIRED'
        WHERE family.session_family_id = located_family_id;

        UPDATE authentication_session_credentials AS credential
        SET status = 'REVOKED', revoked_at = recorded_at
        WHERE credential.session_family_id = located_family_id
          AND credential.status = 'ACTIVE';

        INSERT INTO authentication_audit_events (
          event_type, outcome, reason_code, identity_id, account_id,
          session_family_id, credential_id, correlation_id, occurred_at
        ) VALUES (
          'SESSION_REVOKED',
          'REJECTED',
          'EXPIRED',
          session_family.identity_id,
          session_family.account_id,
          located_family_id,
          requested_credential_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT 'EXPIRED'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      IF requested_require_csrf
        AND (
          session_credential.csrf_digest_version
            IS DISTINCT FROM requested_csrf_digest_version
          OR session_credential.csrf_digest IS DISTINCT FROM requested_csrf_digest
        )
      THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      RETURN QUERY SELECT
        'AUTHENTICATED'::text,
        session_family.account_id,
        session_family.session_family_id;
    END;
    $function$;

    CREATE FUNCTION rotate_authentication_session(
      requested_credential_id uuid,
      requested_credential_digest_version smallint,
      requested_credential_digest bytea,
      requested_new_credential_id uuid,
      requested_new_credential_digest_version smallint,
      requested_new_credential_digest bytea,
      requested_new_csrf_digest_version smallint,
      requested_new_csrf_digest bytea,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      rotation_outcome text,
      credential_id uuid,
      expires_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      located_family_id uuid;
      session_family authentication_session_families%ROWTYPE;
      session_credential authentication_session_credentials%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
      recorded_expires_at timestamptz;
      replay_update_count bigint;
    BEGIN
      IF requested_credential_id IS NULL
        OR requested_credential_digest_version IS NULL
        OR requested_credential_digest_version < 1
        OR requested_credential_digest IS NULL
        OR octet_length(requested_credential_digest) <> 32
        OR requested_new_credential_id IS NULL
        OR substring(requested_new_credential_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_new_credential_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_new_credential_id = requested_credential_id
        OR requested_new_credential_digest_version IS NULL
        OR requested_new_credential_digest_version < 1
        OR requested_new_credential_digest IS NULL
        OR octet_length(requested_new_credential_digest) <> 32
        OR requested_new_csrf_digest_version IS NULL
        OR requested_new_csrf_digest_version < 1
        OR requested_new_csrf_digest IS NULL
        OR octet_length(requested_new_csrf_digest) <> 32
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication session rotation' USING ERRCODE = '22023';
      END IF;

      SELECT credential.session_family_id
      INTO located_family_id
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id;

      IF located_family_id IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      SELECT family.*
      INTO session_family
      FROM authentication_session_families AS family
      WHERE family.session_family_id = located_family_id
      FOR UPDATE;

      SELECT credential.*
      INTO session_credential
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id
        AND credential.session_family_id = located_family_id
      FOR UPDATE;

      IF NOT FOUND
        OR session_credential.credential_digest_version
          IS DISTINCT FROM requested_credential_digest_version
        OR session_credential.credential_digest IS DISTINCT FROM requested_credential_digest
      THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      IF session_credential.status = 'ROTATED' THEN
        UPDATE authentication_session_credentials AS credential
        SET replay_detected_at = COALESCE(credential.replay_detected_at, recorded_at)
        WHERE credential.credential_id = requested_credential_id
          AND credential.replay_detected_at IS NULL;
        GET DIAGNOSTICS replay_update_count = ROW_COUNT;

        IF session_family.status = 'ACTIVE' THEN
          UPDATE authentication_session_families AS family
          SET status = 'COMPROMISED', revoked_at = recorded_at, revocation_reason = 'REPLAY'
          WHERE family.session_family_id = located_family_id;

          UPDATE authentication_session_credentials AS credential
          SET status = 'REVOKED', revoked_at = recorded_at
          WHERE credential.session_family_id = located_family_id
            AND credential.status = 'ACTIVE';
        END IF;

        IF replay_update_count = 1 THEN
          INSERT INTO authentication_audit_events (
            event_type, outcome, reason_code, identity_id, account_id,
            session_family_id, credential_id, correlation_id, occurred_at
          ) VALUES (
            'SESSION_REPLAY_DETECTED',
            'DETECTED',
            'REPLAY',
            session_family.identity_id,
            session_family.account_id,
            located_family_id,
            requested_credential_id,
            requested_correlation_id,
            recorded_at
          );
        END IF;

        RETURN QUERY SELECT 'REPLAYED'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      IF session_credential.status <> 'ACTIVE'
        OR session_family.status <> 'ACTIVE'
        OR recorded_at >= session_credential.expires_at
        OR recorded_at >= session_family.idle_expires_at
        OR recorded_at >= session_family.absolute_expires_at
      THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      recorded_expires_at := LEAST(
        recorded_at + session_family.idle_ttl_seconds * interval '1 second',
        session_family.absolute_expires_at
      );

      UPDATE authentication_session_credentials AS credential
      SET status = 'ROTATED', consumed_at = recorded_at
      WHERE credential.credential_id = requested_credential_id;

      INSERT INTO authentication_session_credentials (
        credential_id,
        session_family_id,
        generation,
        credential_digest_version,
        credential_digest,
        csrf_digest_version,
        csrf_digest,
        predecessor_credential_id,
        issued_at,
        expires_at
      ) VALUES (
        requested_new_credential_id,
        located_family_id,
        session_credential.generation + 1,
        requested_new_credential_digest_version,
        requested_new_credential_digest,
        requested_new_csrf_digest_version,
        requested_new_csrf_digest,
        requested_credential_id,
        recorded_at,
        recorded_expires_at
      );

      UPDATE authentication_session_families AS family
      SET idle_expires_at = recorded_expires_at
      WHERE family.session_family_id = located_family_id;

      INSERT INTO authentication_audit_events (
        event_type, outcome, reason_code, identity_id, account_id,
        session_family_id, credential_id, correlation_id, occurred_at
      ) VALUES (
        'SESSION_ROTATED',
        'SUCCEEDED',
        'NONE',
        session_family.identity_id,
        session_family.account_id,
        located_family_id,
        requested_new_credential_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT
        'ROTATED'::text,
        requested_new_credential_id,
        recorded_expires_at;
    END;
    $function$;

    CREATE FUNCTION revoke_authentication_session(
      requested_credential_id uuid,
      requested_credential_digest_version smallint,
      requested_credential_digest bytea,
      requested_correlation_id uuid
    ) RETURNS TABLE (revocation_outcome text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      located_family_id uuid;
      session_family authentication_session_families%ROWTYPE;
      session_credential authentication_session_credentials%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
      replay_update_count bigint;
    BEGIN
      IF requested_credential_id IS NULL
        OR requested_credential_digest_version IS NULL
        OR requested_credential_digest_version < 1
        OR requested_credential_digest IS NULL
        OR octet_length(requested_credential_digest) <> 32
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication session revocation' USING ERRCODE = '22023';
      END IF;

      SELECT credential.session_family_id
      INTO located_family_id
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id;

      IF located_family_id IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;

      SELECT family.*
      INTO session_family
      FROM authentication_session_families AS family
      WHERE family.session_family_id = located_family_id
      FOR UPDATE;

      SELECT credential.*
      INTO session_credential
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id
        AND credential.session_family_id = located_family_id
      FOR UPDATE;

      IF NOT FOUND
        OR session_credential.credential_digest_version
          IS DISTINCT FROM requested_credential_digest_version
        OR session_credential.credential_digest IS DISTINCT FROM requested_credential_digest
      THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;

      IF session_credential.status = 'ROTATED' THEN
        UPDATE authentication_session_credentials AS credential
        SET replay_detected_at = COALESCE(credential.replay_detected_at, recorded_at)
        WHERE credential.credential_id = requested_credential_id
          AND credential.replay_detected_at IS NULL;
        GET DIAGNOSTICS replay_update_count = ROW_COUNT;

        IF session_family.status = 'ACTIVE' THEN
          UPDATE authentication_session_families AS family
          SET status = 'COMPROMISED', revoked_at = recorded_at, revocation_reason = 'REPLAY'
          WHERE family.session_family_id = located_family_id;

          UPDATE authentication_session_credentials AS credential
          SET status = 'REVOKED', revoked_at = recorded_at
          WHERE credential.session_family_id = located_family_id
            AND credential.status = 'ACTIVE';
        END IF;

        IF replay_update_count = 1 THEN
          INSERT INTO authentication_audit_events (
            event_type, outcome, reason_code, identity_id, account_id,
            session_family_id, credential_id, correlation_id, occurred_at
          ) VALUES (
            'SESSION_REPLAY_DETECTED',
            'DETECTED',
            'REPLAY',
            session_family.identity_id,
            session_family.account_id,
            located_family_id,
            requested_credential_id,
            requested_correlation_id,
            recorded_at
          );
        END IF;

        RETURN QUERY SELECT 'REPLAYED'::text;
        RETURN;
      END IF;

      IF session_family.status <> 'ACTIVE' THEN
        RETURN QUERY SELECT 'REVOKED'::text;
        RETURN;
      END IF;

      IF session_credential.status <> 'ACTIVE' THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;

      UPDATE authentication_session_families AS family
      SET status = 'REVOKED', revoked_at = recorded_at, revocation_reason = 'LOGOUT'
      WHERE family.session_family_id = located_family_id;

      UPDATE authentication_session_credentials AS credential
      SET status = 'REVOKED', revoked_at = recorded_at
      WHERE credential.session_family_id = located_family_id
        AND credential.status = 'ACTIVE';

      INSERT INTO authentication_audit_events (
        event_type, outcome, reason_code, identity_id, account_id,
        session_family_id, credential_id, correlation_id, occurred_at
      ) VALUES (
        'SESSION_REVOKED',
        'SUCCEEDED',
        'LOGOUT',
        session_family.identity_id,
        session_family.account_id,
        located_family_id,
        requested_credential_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT 'REVOKED'::text;
    END;
    $function$;

    CREATE FUNCTION consume_authentication_rate_limit(
      requested_scope text,
      requested_subject_digest_version smallint,
      requested_subject_digest bytea,
      requested_window_seconds integer,
      requested_limit_count integer,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      rate_limit_outcome text,
      remaining_count integer,
      retry_after_seconds integer
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      recorded_at timestamptz := clock_timestamp();
      bucket_started_at timestamptz;
      recorded_request_count integer;
      recorded_limit_count integer;
      recorded_limited_audited_at timestamptz;
      audit_update_count bigint;
    BEGIN
      IF requested_scope NOT IN ('LOGIN_START', 'CALLBACK', 'SESSION_ROTATE')
        OR requested_subject_digest_version IS NULL
        OR requested_subject_digest_version < 1
        OR requested_subject_digest IS NULL
        OR octet_length(requested_subject_digest) <> 32
        OR requested_window_seconds IS NULL OR requested_window_seconds NOT BETWEEN 1 AND 3600
        OR requested_limit_count IS NULL OR requested_limit_count NOT BETWEEN 1 AND 10000
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid authentication rate limit request' USING ERRCODE = '22023';
      END IF;

      bucket_started_at := pg_catalog.to_timestamp(
        pg_catalog.floor(
          EXTRACT(EPOCH FROM recorded_at) / requested_window_seconds
        ) * requested_window_seconds
      );

      INSERT INTO authentication_rate_limit_buckets AS bucket (
        scope,
        subject_digest_version,
        subject_digest,
        window_started_at,
        window_seconds,
        limit_count,
        request_count
      ) VALUES (
        requested_scope,
        requested_subject_digest_version,
        requested_subject_digest,
        bucket_started_at,
        requested_window_seconds,
        requested_limit_count,
        1
      )
      ON CONFLICT (
        scope,
        subject_digest_version,
        subject_digest,
        window_started_at,
        window_seconds
      ) DO UPDATE
      SET request_count = LEAST(bucket.request_count + 1, bucket.limit_count + 1)
      WHERE bucket.limit_count = EXCLUDED.limit_count
      RETURNING bucket.request_count, bucket.limit_count, bucket.limited_audited_at
      INTO recorded_request_count, recorded_limit_count, recorded_limited_audited_at;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'authentication rate limit policy conflict' USING ERRCODE = '55000';
      END IF;

      IF recorded_request_count > recorded_limit_count THEN
        IF recorded_limited_audited_at IS NULL THEN
          UPDATE authentication_rate_limit_buckets AS bucket
          SET limited_audited_at = recorded_at
          WHERE bucket.scope = requested_scope
            AND bucket.subject_digest_version = requested_subject_digest_version
            AND bucket.subject_digest = requested_subject_digest
            AND bucket.window_started_at = bucket_started_at
            AND bucket.window_seconds = requested_window_seconds
            AND bucket.limited_audited_at IS NULL;
          GET DIAGNOSTICS audit_update_count = ROW_COUNT;

          IF audit_update_count = 1 THEN
            INSERT INTO authentication_audit_events (
              event_type, outcome, reason_code, correlation_id, occurred_at
            ) VALUES (
              'RATE_LIMITED',
              'REJECTED',
              'RATE_LIMIT',
              requested_correlation_id,
              recorded_at
            );
          END IF;
        END IF;

        RETURN QUERY SELECT
          'LIMITED'::text,
          0,
          GREATEST(
            1,
            pg_catalog.ceil(
              EXTRACT(EPOCH FROM (
                bucket_started_at + requested_window_seconds * interval '1 second' - recorded_at
              ))
            )::integer
          );
        RETURN;
      END IF;

      RETURN QUERY SELECT
        'ALLOWED'::text,
        recorded_limit_count - recorded_request_count,
        0;
    END;
    $function$;
  `;
}

function createAuthenticationTriggersAndAclSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const tableList = AUTHENTICATION_TABLES.join(', ');
  const functionIdentities = AUTHENTICATION_FUNCTION_IDENTITIES.map(
    (identityValue) => `'${identityValue}'`,
  ).join(',\n        ');
  const revokeFunctions = AUTHENTICATION_FUNCTION_IDENTITIES.map(
    (identityValue) =>
      `REVOKE ALL ON FUNCTION ${identityValue} FROM PUBLIC, ${api}, ${worker}, ${legacy};`,
  ).join('\n    ');
  const grantApiFunctions = AUTHENTICATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `GRANT EXECUTE ON FUNCTION ${identityValue} TO ${api};`,
  ).join('\n    ');

  return `
    CREATE TRIGGER authentication_audit_append_only_row
      BEFORE UPDATE OR DELETE ON authentication_audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_authentication_audit_mutation();
    CREATE TRIGGER authentication_audit_append_only_truncate
      BEFORE TRUNCATE ON authentication_audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION reject_authentication_audit_mutation();

    ALTER TABLE authentication_audit_events
      ENABLE ALWAYS TRIGGER authentication_audit_append_only_row;
    ALTER TABLE authentication_audit_events
      ENABLE ALWAYS TRIGGER authentication_audit_append_only_truncate;

    DO $set_authentication_function_paths$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        ${functionIdentities}
      ]
      LOOP
        IF function_identity <> 'reject_authentication_audit_mutation()' THEN
          EXECUTE pg_catalog.format(
            'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
            migration_schema,
            function_identity,
            migration_schema
          );
        END IF;
      END LOOP;
    END;
    $set_authentication_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${tableList}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    ${revokeFunctions}

    ${grantApiFunctions}
  `;
}

function createAuthenticationDownSql(names: DatabasePrincipalNames): readonly string[] {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const revokeApiFunctions = AUTHENTICATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `REVOKE EXECUTE ON FUNCTION ${identityValue} FROM ${api}`,
  );

  return [
    `DO $refuse_populated_authentication_rollback$
     BEGIN
       IF EXISTS (SELECT 1 FROM authentication_oidc_identities)
         OR EXISTS (SELECT 1 FROM authentication_login_attempts)
         OR EXISTS (SELECT 1 FROM authentication_session_families)
         OR EXISTS (SELECT 1 FROM authentication_session_credentials)
         OR EXISTS (SELECT 1 FROM authentication_audit_events)
         OR EXISTS (SELECT 1 FROM authentication_rate_limit_buckets)
       THEN
         RAISE EXCEPTION 'cannot roll back retained authentication security state'
           USING ERRCODE = '55000';
       END IF;
     END;
     $refuse_populated_authentication_rollback$;`,
    ...revokeApiFunctions,
    'DROP FUNCTION consume_authentication_rate_limit(text, smallint, bytea, integer, integer, uuid)',
    'DROP FUNCTION revoke_authentication_session(uuid, smallint, bytea, uuid)',
    `DROP FUNCTION rotate_authentication_session(
       uuid, smallint, bytea, uuid, smallint, bytea, smallint, bytea, uuid
     )`,
    `DROP FUNCTION resolve_authentication_session(
       uuid, smallint, bytea, boolean, smallint, bytea, uuid
     )`,
    `DROP FUNCTION complete_authentication_login(
       uuid, text, smallint, bytea, smallint, bytea, uuid, uuid, uuid, uuid,
       smallint, bytea, smallint, bytea, integer, integer, text, text, text, uuid
     )`,
    'DROP FUNCTION reject_claimed_authentication_login_attempt(uuid, text, uuid)',
    `DROP FUNCTION claim_authentication_login_attempt(
       uuid, smallint, bytea, smallint, bytea, uuid
     )`,
    `DROP FUNCTION begin_authentication_login_attempt(
       uuid, text, text, smallint, bytea, smallint, bytea, smallint, bytea, integer, uuid
     )`,
    'DROP TABLE authentication_audit_events',
    'DROP TABLE authentication_session_credentials',
    'DROP TABLE authentication_session_families',
    'DROP TABLE authentication_login_attempts',
    'DROP TABLE authentication_oidc_identities',
    'DROP TABLE authentication_rate_limit_buckets',
    'DROP FUNCTION reject_authentication_audit_mutation()',
  ];
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0009 authentication verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function extendPriorVerifierForAuthentication(
  names: DatabasePrincipalNames,
  priorVerifier: string,
): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const authenticationTableLiterals = AUTHENTICATION_TABLES.map((table) => `'${table}'`).join(', ');
  const completeIdempotencyAllowanceTail = `                to_regprocedure(
                  'complete_ledger_command_idempotency(uuid,uuid,uuid)'
                )
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const authenticationFunctionAllowance = `${completeIdempotencyAllowanceTail}
            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                ${AUTHENTICATION_API_FUNCTION_IDENTITIES.map(
                  (identityValue) => `to_regprocedure('${identityValue}')`,
                ).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const loginTypePrivilegeAnchor =
    "              AND pg_catalog.has_type_privilege(login_role.oid, type_object.oid, 'USAGE')";
  const auditedTypePrivilegeAnchor =
    "        AND pg_catalog.has_type_privilege(audited_role.oid, type_object.oid, 'USAGE')";
  const loginTypePrivilegeReplacement = `              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class AS authentication_row_table
                WHERE authentication_row_table.oid = type_object.typrelid
                  AND authentication_row_table.relnamespace =
                    pg_catalog.to_regnamespace(pg_catalog.current_schema())
                  AND authentication_row_table.relkind = 'r'
                  AND authentication_row_table.relname IN (${authenticationTableLiterals})
              )
${loginTypePrivilegeAnchor}`;
  const auditedTypePrivilegeReplacement = `        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS authentication_row_table
          WHERE authentication_row_table.oid = type_object.typrelid
            AND authentication_row_table.relnamespace =
              pg_catalog.to_regnamespace(pg_catalog.current_schema())
            AND authentication_row_table.relkind = 'r'
            AND authentication_row_table.relname IN (${authenticationTableLiterals})
        )
${auditedTypePrivilegeAnchor}`;

  let verifier = replaceExactlyOnce(
    priorVerifier,
    completeIdempotencyAllowanceTail,
    authenticationFunctionAllowance,
  );
  verifier = replaceExactlyOnce(verifier, loginTypePrivilegeAnchor, loginTypePrivilegeReplacement);
  return replaceExactlyOnce(verifier, auditedTypePrivilegeAnchor, auditedTypePrivilegeReplacement);
}

function createAuthenticationVerifierSql(
  names: DatabasePrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createLedgerCommandIdempotencyMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) {
    throw new Error('Migration 0009 must expose verification SQL');
  }

  const priorVerifier = cumulativePrincipalVerification
    ? extendPriorVerifierForAuthentication(names, priorMigration.verifySql)
    : priorMigration.verifySql;
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const authenticationTableLiterals = AUTHENTICATION_TABLES.map((table) => `'${table}'`).join(', ');
  const allFunctionRegprocedures = AUTHENTICATION_FUNCTION_IDENTITIES.map(
    (identityValue) => `to_regprocedure('${identityValue}')`,
  ).join(',\n        ');
  const apiFunctionRegprocedures = AUTHENTICATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `to_regprocedure('${identityValue}')`,
  ).join(',\n        ');
  const ownerVerification = cumulativePrincipalVerification
    ? `AND table_owner.rolname = ${owner}`
    : '';
  const functionOwnerVerification = cumulativePrincipalVerification
    ? `AND function_owner.rolname = ${owner}`
    : '';

  const authenticationVerifier = `WITH authentication_verifier_context AS MATERIALIZED (
    SELECT
      pg_catalog.current_schema() AS target_schema,
      pg_catalog.to_regnamespace(pg_catalog.current_schema()) AS target_namespace,
      pg_catalog.format('%I.', pg_catalog.current_schema()) AS qualified_schema_prefix
  ),
  authentication_tables AS MATERIALIZED (
    SELECT table_state.*
    FROM authentication_verifier_context AS context
    INNER JOIN pg_catalog.pg_class AS table_state
      ON table_state.relnamespace = context.target_namespace
     AND table_state.relkind = 'r'
     AND table_state.relname LIKE 'authentication\\_%' ESCAPE '\\'
  ),
  authentication_columns AS MATERIALIZED (
    SELECT
      table_state.relname AS table_name,
      attribute.*,
      default_state.oid AS default_oid,
      default_state.adbin,
      default_state.adrelid,
      collation_namespace.nspname AS collation_schema,
      collation_state.collname AS collation_name
    FROM authentication_tables AS table_state
    INNER JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = table_state.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef AS default_state
      ON default_state.adrelid = attribute.attrelid
     AND default_state.adnum = attribute.attnum
    LEFT JOIN pg_catalog.pg_collation AS collation_state
      ON collation_state.oid = attribute.attcollation
    LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
      ON collation_namespace.oid = collation_state.collnamespace
  ),
  authentication_constraints AS MATERIALIZED (
    SELECT constraint_state.*
    FROM pg_catalog.pg_constraint AS constraint_state
    WHERE constraint_state.conrelid IN (
      SELECT table_state.oid FROM authentication_tables AS table_state
    )
  ),
  authentication_table_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          table_state.relname,
          table_state.relkind,
          table_state.relpersistence,
          table_state.relrowsecurity,
          table_state.relforcerowsecurity,
          table_state.relreplident,
          table_state.relispartition,
          table_state.relhassubclass,
          table_state.relhasrules,
          table_state.reloptions,
          CASE
            WHEN table_state.reltablespace = 0 THEN NULL
            ELSE tablespace.spcname
          END
        ) ORDER BY table_state.relname
      ) AS descriptor
    FROM authentication_tables AS table_state
    LEFT JOIN pg_catalog.pg_tablespace AS tablespace
      ON tablespace.oid = table_state.reltablespace
  ),
  authentication_column_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          column_state.table_name,
          column_state.attnum,
          column_state.attname,
          pg_catalog.format_type(column_state.atttypid, column_state.atttypmod),
          column_state.attnotnull,
          column_state.attidentity,
          column_state.attgenerated,
          column_state.attndims,
          CASE
            WHEN column_state.default_oid IS NULL THEN NULL
            ELSE pg_catalog.pg_get_expr(
              column_state.adbin,
              column_state.adrelid,
              false
            )
          END,
          CASE
            WHEN column_state.attcollation = 0 THEN NULL
            ELSE column_state.collation_schema || '.' || column_state.collation_name
          END,
          column_state.attacl::text,
          column_state.attstorage,
          column_state.attcompression
        ) ORDER BY column_state.table_name, column_state.attnum
      ) AS descriptor
    FROM authentication_columns AS column_state
  ),
  authentication_constraint_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          table_state.relname,
          constraint_state.conname,
          constraint_state.contype,
          constraint_state.condeferrable,
          constraint_state.condeferred,
          constraint_state.convalidated,
          constraint_state.connoinherit,
          COALESCE(referenced_table.relname, ''),
          constraint_state.confupdtype,
          constraint_state.confdeltype,
          constraint_state.confmatchtype,
          constraint_state.conkey::text,
          constraint_state.confkey::text,
          pg_catalog.replace(
            pg_catalog.pg_get_constraintdef(constraint_state.oid, false),
            context.qualified_schema_prefix,
            '__schema__.'
          )
        ) ORDER BY table_state.relname, constraint_state.conname
      ) AS descriptor
    FROM authentication_verifier_context AS context
    INNER JOIN authentication_constraints AS constraint_state ON true
    INNER JOIN pg_catalog.pg_class AS table_state
      ON table_state.oid = constraint_state.conrelid
    LEFT JOIN pg_catalog.pg_class AS referenced_table
      ON referenced_table.oid = constraint_state.confrelid
  ),
  authentication_index_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          table_state.relname,
          index_table.relname,
          index_state.indisunique,
          index_state.indisprimary,
          index_state.indisexclusion,
          index_state.indimmediate,
          index_state.indisclustered,
          index_state.indisvalid,
          index_state.indcheckxmin,
          index_state.indisready,
          index_state.indislive,
          index_state.indisreplident,
          index_state.indnullsnotdistinct,
          index_state.indnatts,
          index_state.indnkeyatts,
          index_state.indkey::text,
          index_state.indoption::text,
          pg_catalog.pg_get_expr(index_state.indexprs, index_state.indrelid, false),
          pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, false),
          index_table.reloptions,
          pg_catalog.replace(
            pg_catalog.pg_get_indexdef(index_state.indexrelid, 0, false),
            context.qualified_schema_prefix,
            '__schema__.'
          )
        ) ORDER BY table_state.relname, index_table.relname
      ) AS descriptor
    FROM authentication_verifier_context AS context
    INNER JOIN authentication_tables AS table_state ON true
    INNER JOIN pg_catalog.pg_index AS index_state
      ON index_state.indrelid = table_state.oid
    INNER JOIN pg_catalog.pg_class AS index_table
      ON index_table.oid = index_state.indexrelid
  ),
  authentication_triggers AS MATERIALIZED (
    SELECT
      table_state.relname AS table_name,
      trigger_state.*,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS function_arguments
    FROM authentication_tables AS table_state
    INNER JOIN pg_catalog.pg_trigger AS trigger_state
      ON trigger_state.tgrelid = table_state.oid
     AND NOT trigger_state.tgisinternal
    INNER JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_state.tgfoid
  ),
  authentication_trigger_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          trigger_state.table_name,
          trigger_state.tgname,
          trigger_state.proname,
          trigger_state.function_arguments,
          trigger_state.tgtype,
          trigger_state.tgenabled,
          trigger_state.tgdeferrable,
          trigger_state.tginitdeferred,
          trigger_state.tgattr::text,
          pg_catalog.pg_get_expr(trigger_state.tgqual, trigger_state.tgrelid, false),
          pg_catalog.replace(
            pg_catalog.pg_get_triggerdef(trigger_state.oid, false),
            context.qualified_schema_prefix,
            '__schema__.'
          )
        ) ORDER BY trigger_state.table_name, trigger_state.tgname
      ) AS descriptor
    FROM authentication_verifier_context AS context
    INNER JOIN authentication_triggers AS trigger_state ON true
  ),
  authentication_internal_fk_trigger_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          child_table.relname,
          constraint_state.conname,
          CASE
            WHEN target_namespace.nspname = context.target_schema THEN '__schema__'
            ELSE target_namespace.nspname
          END,
          target_table.relname,
          referenced_table.relname,
          procedure.proname,
          pg_catalog.pg_get_function_identity_arguments(procedure.oid),
          trigger_state.tgtype,
          trigger_state.tgenabled,
          trigger_state.tgisinternal,
          trigger_state.tgdeferrable,
          trigger_state.tginitdeferred,
          trigger_state.tgattr::text,
          pg_catalog.pg_get_expr(trigger_state.tgqual, trigger_state.tgrelid, false)
        ) ORDER BY
          child_table.relname,
          constraint_state.conname,
          target_namespace.nspname,
          target_table.relname,
          procedure.proname,
          trigger_state.tgtype
      ) AS descriptor
    FROM authentication_verifier_context AS context
    INNER JOIN authentication_constraints AS constraint_state
      ON constraint_state.contype = 'f'
    INNER JOIN pg_catalog.pg_class AS child_table
      ON child_table.oid = constraint_state.conrelid
    INNER JOIN pg_catalog.pg_trigger AS trigger_state
      ON trigger_state.tgconstraint = constraint_state.oid
    INNER JOIN pg_catalog.pg_class AS target_table
      ON target_table.oid = trigger_state.tgrelid
    INNER JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_table.relnamespace
    LEFT JOIN pg_catalog.pg_class AS referenced_table
      ON referenced_table.oid = trigger_state.tgconstrrelid
    INNER JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_state.tgfoid
  ),
  authentication_functions AS MATERIALIZED (
    SELECT
      procedure.*,
      language.lanname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
      pg_catalog.pg_get_function_result(procedure.oid) AS function_result
    FROM authentication_verifier_context AS context
    INNER JOIN pg_catalog.pg_proc AS procedure
      ON procedure.pronamespace = context.target_namespace
     AND pg_catalog.strpos(procedure.proname, 'authentication') > 0
    INNER JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
  ),
  authentication_function_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          function_state.proname,
          function_state.identity_arguments,
          function_state.function_result,
          function_state.lanname,
          function_state.prokind,
          function_state.provolatile,
          function_state.proparallel,
          function_state.prosecdef,
          function_state.proleakproof,
          function_state.proisstrict,
          function_state.proretset,
          function_state.pronargs,
          function_state.pronargdefaults,
          function_state.procost,
          function_state.prorows,
          (
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.replace(
                config_state.config_value,
                ' ' || context.target_schema || ',',
                ' __schema__,'
              ) ORDER BY config_state.ordinality
            )
            FROM pg_catalog.unnest(function_state.proconfig)
              WITH ORDINALITY AS config_state(config_value, ordinality)
          ),
          pg_catalog.replace(
            pg_catalog.replace(
              pg_catalog.replace(
                function_state.prosrc,
                context.qualified_schema_prefix,
                '__schema__.'
              ),
              pg_catalog.chr(13) || pg_catalog.chr(10),
              pg_catalog.chr(10)
            ),
            pg_catalog.chr(13),
            pg_catalog.chr(10)
          )
        ) ORDER BY function_state.proname, function_state.identity_arguments
      ) AS descriptor
    FROM authentication_verifier_context AS context
    INNER JOIN authentication_functions AS function_state ON true
  )
  SELECT (
    (SELECT object_count = 6 FROM authentication_table_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '57e22b3edfc18f15b17da5e1c05eb773cf3bc000a95d01565e13ae67c01078c2'
      FROM authentication_table_catalog
    )
    AND (SELECT object_count = 68 FROM authentication_column_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = 'e3f5eaa3807ae6d0a0213133d0812f15f80d21f7db926b56e06f73410850dd7d'
      FROM authentication_column_catalog
    )
    AND (SELECT object_count = 60 FROM authentication_constraint_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '7bf71693dc6d98a9fd48ff53539e62312c2e8f8afb3c369f173da3a2ebfd1dab'
      FROM authentication_constraint_catalog
    )
    AND (SELECT object_count = 14 FROM authentication_index_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '002f18c68a19d938fabd416a95a61cc815ae243fd30d493a35d7aca90c1681a4'
      FROM authentication_index_catalog
    )
    AND (SELECT object_count = 2 FROM authentication_trigger_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = 'bfd9fd44d0da79b207d7ddf7a964e18b1401d6ec94a6ad4937bb6215fe60c88c'
      FROM authentication_trigger_catalog
    )
    AND (SELECT object_count = 44 FROM authentication_internal_fk_trigger_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '262b80cc1802004ac534aa836f7bb64f0e04c3424ea1843594b2c0dda44dd359'
      FROM authentication_internal_fk_trigger_catalog
    )
    AND (SELECT object_count = 9 FROM authentication_function_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = 'dde40e442b2b8eaae476367ebcb122d3c495ec60f64de4a4ca23b1ee612c0d64'
      FROM authentication_function_catalog
    )
    AND (SELECT pg_catalog.count(DISTINCT table_state.relowner) = 1
      FROM authentication_tables AS table_state)
    AND NOT EXISTS (
      SELECT 1
      FROM authentication_functions AS function_state
      WHERE function_state.proowner IS DISTINCT FROM (
        SELECT pg_catalog.min(table_state.relowner)
        FROM authentication_tables AS table_state
      )
    )
    AND (SELECT pg_catalog.count(*) = ${AUTHENTICATION_TABLES.length}
     FROM pg_catalog.pg_class AS table_state
     INNER JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = table_state.relnamespace
     INNER JOIN pg_catalog.pg_roles AS table_owner
       ON table_owner.oid = table_state.relowner
     WHERE namespace.nspname = pg_catalog.current_schema()
       AND table_state.relkind = 'r'
       AND table_state.relname IN (${authenticationTableLiterals})
       ${ownerVerification})
    AND (SELECT pg_catalog.count(*) = ${AUTHENTICATION_TABLES.length}
      FROM pg_catalog.pg_class AS table_state
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_state.relnamespace
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND table_state.relkind = 'r'
        AND table_state.relname LIKE 'authentication\\_%' ESCAPE '\\')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS table_state
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_state.relnamespace
      CROSS JOIN pg_catalog.pg_roles AS audited_role
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND table_state.relkind = 'r'
        AND table_state.relname IN (${authenticationTableLiterals})
        AND audited_role.rolname IN (${api}, ${worker}, ${legacy})
        AND pg_catalog.has_table_privilege(audited_role.oid, table_state.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS table_state
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_state.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(table_state.relacl, pg_catalog.acldefault('r', table_state.relowner))
      ) AS acl
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND table_state.relkind = 'r'
        AND table_state.relname IN (${authenticationTableLiterals})
        AND acl.grantee = 0
        AND acl.privilege_type IN (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM authentication_tables AS table_state
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(table_state.relacl, pg_catalog.acldefault('r', table_state.relowner))
      ) AS acl
      WHERE acl.grantee <> table_state.relowner
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS table_state
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_state.relnamespace
      CROSS JOIN pg_catalog.pg_roles AS audited_role
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND table_state.relkind = 'r'
        AND table_state.relname IN (${authenticationTableLiterals})
        AND audited_role.rolname IN (${api}, ${worker}, ${legacy})
        AND pg_catalog.has_any_column_privilege(
          audited_role.oid, table_state.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      INNER JOIN pg_catalog.pg_class AS table_state
        ON table_state.oid = attribute.attrelid
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_state.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND table_state.relname IN (${authenticationTableLiterals})
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND acl.grantee = 0
    )
    AND (SELECT pg_catalog.count(*) = ${AUTHENTICATION_FUNCTION_IDENTITIES.length}
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      INNER JOIN pg_catalog.pg_roles AS function_owner
        ON function_owner.oid = procedure.proowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND procedure.oid IN (
          ${allFunctionRegprocedures}
        )
        ${functionOwnerVerification})
    AND (SELECT pg_catalog.count(*) = ${AUTHENTICATION_FUNCTION_IDENTITIES.length}
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND procedure.proname LIKE '%authentication%')
    AND NOT EXISTS (
      SELECT expected.oid
      FROM pg_catalog.unnest(ARRAY[
        ${allFunctionRegprocedures}
      ]::oid[]) AS expected(oid)
      WHERE expected.oid IS NULL
    )
    AND NOT EXISTS (
      SELECT procedure.oid
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND procedure.oid IN (
          ${apiFunctionRegprocedures}
        )
        AND (
          NOT procedure.prosecdef
          OR procedure.provolatile <> 'v'
          OR procedure.proparallel <> 'u'
          OR procedure.proconfig IS DISTINCT FROM ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          OR NOT pg_catalog.has_function_privilege(${api}, procedure.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege(${worker}, procedure.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege(${legacy}, procedure.oid, 'EXECUTE')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE procedure.oid IN (
        ${allFunctionRegprocedures}
      )
        AND (
          acl.grantee = 0
          OR grantee.rolname IN (${worker}, ${legacy})
          OR acl.is_grantable
          OR (
            grantee.rolname = ${api}
            AND procedure.oid = to_regprocedure('reject_authentication_audit_mutation()')
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM authentication_functions AS function_state
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(function_state.proacl, pg_catalog.acldefault('f', function_state.proowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE acl.grantee <> function_state.proowner
        AND NOT (
          grantee.rolname = ${api}
          AND function_state.oid IN (
            ${apiFunctionRegprocedures}
          )
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
        )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid = to_regclass('authentication_audit_events')
        AND trigger_state.tgname = 'authentication_audit_append_only_row'
        AND trigger_state.tgenabled = 'A'
        AND NOT trigger_state.tgisinternal
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid = to_regclass('authentication_audit_events')
        AND trigger_state.tgname = 'authentication_audit_append_only_truncate'
        AND trigger_state.tgenabled = 'A'
        AND NOT trigger_state.tgisinternal
    )
    AND to_regclass('authentication_session_one_active_credential') IS NOT NULL
    AND to_regclass('authentication_rate_limit_retention_index') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.conrelid = to_regclass('authentication_oidc_identities')
        AND constraint_state.conname = 'authentication_oidc_identity_subject_unique'
        AND constraint_state.contype = 'u'
        AND constraint_state.convalidated
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.conrelid = to_regclass('authentication_login_attempts')
        AND constraint_state.conname = 'authentication_login_attempt_state_unique'
        AND constraint_state.contype = 'u'
        AND constraint_state.convalidated
    )
  ) AS valid`;

  return `SELECT (prior.valid AND authentication.valid) AS valid
    FROM (${priorVerifier}) AS prior
    CROSS JOIN (${authenticationVerifier}) AS authentication`;
}

export function createAuthenticationSessionsMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0010',
    description: 'create OIDC identity mapping and replay-safe authentication sessions',
    upSql: [
      createAuthenticationTablesSql(),
      createAuthenticationFunctionsSql(),
      createAuthenticationSessionFunctionsSql(),
      createAuthenticationTriggersAndAclSql(names),
    ],
    downSql: createAuthenticationDownSql(names),
    verifySql: createAuthenticationVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0009'],
  };
}

export const createAuthenticationSessionsMigrationV0010 = createAuthenticationSessionsMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createAuthenticationSessionsTestSchemaMigrationV0010 =
  createAuthenticationSessionsMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
