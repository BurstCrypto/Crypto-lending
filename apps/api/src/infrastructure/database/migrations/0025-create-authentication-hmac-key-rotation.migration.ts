import { createHash } from 'node:crypto';

import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createWalletMetadataRewrapBoundaryMigration } from './0024-create-wallet-metadata-rewrap-boundary.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const POLICY_TABLE = 'auth_hmac_key_policies';
const ALIAS_TABLE = 'auth_oidc_identity_digest_aliases';
const CANDIDATE_VALIDATOR = 'auth_digest_candidate_set_valid(smallint[],text[])';
const POLICY_GUARD = 'reject_auth_hmac_policy_mutation()';
const ALIAS_GUARD = 'reject_auth_identity_alias_mutation()';
const COMPLETE_LOGIN =
  'complete_auth_login_keyring(uuid,text,text,smallint,bytea,smallint[],text[],uuid,uuid,uuid,uuid,smallint,bytea,smallint,bytea,integer,integer,text,text,text,uuid)';
const RESOLVE_SESSION =
  'resolve_auth_session_keyring(uuid,smallint[],text[],boolean,smallint[],text[],uuid)';
const ROTATE_SESSION =
  'rotate_auth_session_keyring(uuid,smallint[],text[],uuid,smallint,bytea,smallint,bytea,uuid)';
const REVOKE_SESSION = 'revoke_auth_session_keyring(uuid,smallint[],text[],uuid)';
const CONSUME_RATE_LIMIT =
  'consume_auth_rate_limit_keyring(text,smallint[],text[],integer,integer,uuid)';
const RETIREMENT_READINESS = 'auth_hmac_key_retirement_readiness(text,smallint)';
const STATE_VERIFIER = 'verify_auth_hmac_rotation_state()';
const POLICY_MANIFEST =
  'crypto-lending:auth-hmac-rotation:v1;purposes=identity,session,csrf;max-accepted=3;migration-owned';
const ALIAS_MANIFEST =
  'crypto-lending:auth-hmac-rotation:v1;oidc-aliases=append-only;provider-issuer-account-bound;max-versions=3';

const PRIOR_API_FUNCTIONS = [
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'list_active_wallet_registrations(uuid)',
  'revoke_wallet_registration(uuid,uuid,uuid)',
  'complete_wallet_registration_guarded(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'verify_wallet_revocation_state()',
  'read_aave_v3_ethereum_finalized_checkpoint(text)',
  'enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)',
  'read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint)',
  'read_balance_sync_portfolio(uuid,jsonb,timestamp with time zone)',
  'read_stablecoin_price_evidence(text,smallint,text,text,text,text,smallint,timestamp with time zone)',
  'begin_wallet_ownership_challenge_rotatable(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid,smallint[],text[])',
  'complete_wallet_registration_rotatable(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'list_active_wallet_registrations_rotatable(uuid)',
] as const;

const RUNTIME_FUNCTIONS = Object.freeze([
  COMPLETE_LOGIN,
  RESOLVE_SESSION,
  ROTATE_SESSION,
  REVOKE_SESSION,
  CONSUME_RATE_LIMIT,
] as const);
const ALL_FUNCTIONS = Object.freeze([
  CANDIDATE_VALIDATOR,
  POLICY_GUARD,
  ALIAS_GUARD,
  ...RUNTIME_FUNCTIONS,
  RETIREMENT_READINESS,
  STATE_VERIFIER,
] as const);

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

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0025 verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function functionAllowance(role: string, functions: readonly string[]): string {
  return `            OR (
              grantee.rolname = ${role}
              AND procedure.oid IN (
                ${functions.map((value) => `to_regprocedure('${value}')`).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
}

const CANDIDATE_VALIDATOR_BODY = `
    BEGIN
      RETURN candidate_versions IS NOT NULL
        AND candidate_digests_hex IS NOT NULL
        AND pg_catalog.array_ndims(candidate_versions) = 1
        AND pg_catalog.array_ndims(candidate_digests_hex) = 1
        AND pg_catalog.array_lower(candidate_versions, 1) = 1
        AND pg_catalog.array_lower(candidate_digests_hex, 1) = 1
        AND pg_catalog.cardinality(candidate_versions) BETWEEN 1 AND 3
        AND pg_catalog.cardinality(candidate_versions)
          = pg_catalog.cardinality(candidate_digests_hex)
        AND pg_catalog.array_position(candidate_versions, NULL) IS NULL
        AND pg_catalog.array_position(candidate_digests_hex, NULL) IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.generate_subscripts(candidate_versions, 1) AS entry(candidate_index)
          WHERE candidate_versions[entry.candidate_index] < 1
            OR candidate_versions[entry.candidate_index] > 32767
            OR (entry.candidate_index > 1 AND candidate_versions[entry.candidate_index]
              <= candidate_versions[entry.candidate_index - 1])
            OR candidate_digests_hex[entry.candidate_index] !~ '^[0-9a-f]{64}$'
        )
        AND (
          SELECT pg_catalog.count(DISTINCT digest_value)
          FROM pg_catalog.unnest(candidate_digests_hex) AS digest(digest_value)
        ) = pg_catalog.cardinality(candidate_digests_hex);
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    `;

const POLICY_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'authentication key policy is migration-owned'
        USING ERRCODE = '55000';
    END;
    `;

const ALIAS_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'authentication identity aliases are append-only'
        USING ERRCODE = '55000';
    END;
    `;

const COMPLETE_LOGIN_BODY = `
    DECLARE
      identity_policy auth_hmac_key_policies%ROWTYPE;
      session_policy auth_hmac_key_policies%ROWTYPE;
      csrf_policy auth_hmac_key_policies%ROWTYPE;
      login_attempt authentication_login_attempts%ROWTYPE;
      mapped_identity authentication_oidc_identities%ROWTYPE;
      mapped_identity_id uuid;
      alias_identity_ids uuid[];
      base_identity_ids uuid[];
      active_identity_index integer;
      active_identity_digest bytea;
      candidate_index integer;
      completed record;
      prior_alias auth_oidc_identity_digest_aliases%ROWTYPE;
    BEGIN
      SELECT policy.* INTO STRICT identity_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'IDENTITY';
      SELECT policy.* INTO STRICT session_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'SESSION';
      SELECT policy.* INTO STRICT csrf_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'CSRF';

      IF requested_provider_key IS NULL
        OR requested_provider_key !~ '^[a-z][a-z0-9_-]{0,31}$'
        OR requested_verified_issuer IS NULL
        OR pg_catalog.char_length(requested_verified_issuer) NOT BETWEEN 9 AND 2048
        OR requested_verified_issuer <> pg_catalog.btrim(requested_verified_issuer)
        OR requested_verified_issuer !~ '^https://[^[:space:]?#]+$'
        OR NOT auth_digest_candidate_set_valid(
          requested_subject_digest_versions, requested_subject_digests_hex
        )
        OR requested_subject_digest_versions
          <@ identity_policy.accepted_read_versions IS NOT TRUE
        OR NOT identity_policy.active_write_version = ANY(requested_subject_digest_versions)
        OR requested_credential_digest_version
          IS DISTINCT FROM session_policy.active_write_version
        OR requested_csrf_digest_version IS DISTINCT FROM csrf_policy.active_write_version
        OR requested_credential_digest IS NULL
        OR pg_catalog.octet_length(requested_credential_digest) <> 32
        OR requested_csrf_digest IS NULL
        OR pg_catalog.octet_length(requested_csrf_digest) <> 32
      THEN
        RAISE EXCEPTION 'invalid authentication key-ring request' USING ERRCODE = '22023';
      END IF;

      active_identity_index := pg_catalog.array_position(
        requested_subject_digest_versions, identity_policy.active_write_version
      );
      IF active_identity_index IS NULL THEN
        RAISE EXCEPTION 'invalid authentication key-ring request' USING ERRCODE = '22023';
      END IF;
      active_identity_digest := pg_catalog.decode(
        requested_subject_digests_hex[active_identity_index], 'hex'
      );

      SELECT attempt.* INTO login_attempt
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

      IF (login_attempt.flow = 'LOGIN'
          AND (requested_registration_contact_email IS NOT NULL
            OR requested_registration_contact_phone IS NOT NULL
            OR requested_registration_residency_country_code IS NOT NULL))
        OR (login_attempt.flow = 'REGISTRATION'
          AND (requested_registration_contact_email IS NULL
            OR requested_registration_residency_country_code IS NULL))
      THEN
        RAISE EXCEPTION 'invalid authentication key-ring request' USING ERRCODE = '22023';
      END IF;

      IF pg_catalog.clock_timestamp() >= login_attempt.expires_at THEN
        SELECT result.* INTO STRICT completed
        FROM complete_authentication_login(
          requested_attempt_id, requested_verified_issuer,
          requested_nonce_digest_version, requested_nonce_digest,
          identity_policy.active_write_version, active_identity_digest,
          requested_account_id, requested_identity_id, requested_session_family_id,
          requested_credential_id, requested_credential_digest_version,
          requested_credential_digest, requested_csrf_digest_version,
          requested_csrf_digest, requested_idle_ttl_seconds,
          requested_absolute_ttl_seconds, requested_registration_contact_email,
          requested_registration_contact_phone,
          requested_registration_residency_country_code, requested_correlation_id
        ) AS result;
        RETURN QUERY SELECT completed.login_outcome, completed.account_id,
          completed.session_family_id, completed.credential_id,
          completed.idle_expires_at, completed.absolute_expires_at;
        RETURN;
      END IF;

      FOR candidate_index IN 1..pg_catalog.cardinality(requested_subject_digest_versions) LOOP
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
          requested_provider_key || ':' || requested_verified_issuer || ':' ||
          requested_subject_digest_versions[candidate_index]::text || ':' ||
          requested_subject_digests_hex[candidate_index], 57025
        ));
      END LOOP;

      SELECT pg_catalog.array_agg(DISTINCT alias.identity_id ORDER BY alias.identity_id)
      INTO alias_identity_ids
      FROM auth_oidc_identity_digest_aliases AS alias
      WHERE alias.provider_key = requested_provider_key
        AND alias.issuer = requested_verified_issuer
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.generate_subscripts(
            requested_subject_digest_versions, 1
          ) AS candidate(candidate_index)
          WHERE alias.subject_digest_version
              = requested_subject_digest_versions[candidate.candidate_index]
            AND alias.subject_digest = pg_catalog.decode(
              requested_subject_digests_hex[candidate.candidate_index], 'hex'
            )
        );
      IF COALESCE(pg_catalog.cardinality(alias_identity_ids), 0) > 1 THEN
        RAISE EXCEPTION 'authentication identity alias conflict' USING ERRCODE = '55000';
      END IF;

      SELECT pg_catalog.array_agg(DISTINCT identity.identity_id ORDER BY identity.identity_id)
      INTO base_identity_ids
      FROM authentication_oidc_identities AS identity
      WHERE identity.issuer = requested_verified_issuer
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.generate_subscripts(
            requested_subject_digest_versions, 1
          ) AS candidate(candidate_index)
          WHERE identity.subject_digest_version
              = requested_subject_digest_versions[candidate.candidate_index]
            AND identity.subject_digest = pg_catalog.decode(
              requested_subject_digests_hex[candidate.candidate_index], 'hex'
            )
        );
      IF COALESCE(pg_catalog.cardinality(base_identity_ids), 0) > 1
        OR (
          pg_catalog.cardinality(alias_identity_ids) = 1
          AND pg_catalog.cardinality(base_identity_ids) = 1
          AND alias_identity_ids[1] IS DISTINCT FROM base_identity_ids[1]
        )
      THEN
        RAISE EXCEPTION 'authentication identity alias conflict' USING ERRCODE = '55000';
      END IF;

      mapped_identity_id := COALESCE(alias_identity_ids[1], base_identity_ids[1]);
      IF mapped_identity_id IS NOT NULL THEN
        SELECT identity.* INTO STRICT mapped_identity
        FROM authentication_oidc_identities AS identity
        WHERE identity.identity_id = mapped_identity_id
        FOR UPDATE;
        IF mapped_identity.issuer IS DISTINCT FROM requested_verified_issuer THEN
          RAISE EXCEPTION 'authentication identity alias conflict' USING ERRCODE = '55000';
        END IF;

        IF mapped_identity.status = 'ACTIVE'
          AND (
            mapped_identity.subject_digest_version
              IS DISTINCT FROM identity_policy.active_write_version
            OR mapped_identity.subject_digest IS DISTINCT FROM active_identity_digest
          )
        THEN
          UPDATE authentication_oidc_identities AS identity
          SET subject_digest_version = identity_policy.active_write_version,
              subject_digest = active_identity_digest
          WHERE identity.identity_id = mapped_identity.identity_id;
        END IF;
      END IF;

      SELECT result.* INTO STRICT completed
      FROM complete_authentication_login(
        requested_attempt_id, requested_verified_issuer,
        requested_nonce_digest_version, requested_nonce_digest,
        CASE WHEN mapped_identity_id IS NULL OR mapped_identity.status = 'ACTIVE'
          THEN identity_policy.active_write_version
          ELSE mapped_identity.subject_digest_version END,
        CASE WHEN mapped_identity_id IS NULL OR mapped_identity.status = 'ACTIVE'
          THEN active_identity_digest ELSE mapped_identity.subject_digest END,
        requested_account_id, requested_identity_id, requested_session_family_id,
        requested_credential_id, requested_credential_digest_version,
        requested_credential_digest, requested_csrf_digest_version,
        requested_csrf_digest, requested_idle_ttl_seconds,
        requested_absolute_ttl_seconds, requested_registration_contact_email,
        requested_registration_contact_phone,
        requested_registration_residency_country_code, requested_correlation_id
      ) AS result;

      IF completed.login_outcome = 'AUTHENTICATED' THEN
        mapped_identity_id := COALESCE(mapped_identity_id, requested_identity_id);
        IF completed.account_id IS NULL THEN
          RAISE EXCEPTION 'authentication identity alias conflict' USING ERRCODE = '55000';
        END IF;
        FOR candidate_index IN 1..pg_catalog.cardinality(requested_subject_digest_versions) LOOP
          SELECT alias.* INTO prior_alias
          FROM auth_oidc_identity_digest_aliases AS alias
          WHERE alias.identity_id = mapped_identity_id
            AND alias.subject_digest_version
              = requested_subject_digest_versions[candidate_index];
          IF FOUND THEN
            IF prior_alias.account_id IS DISTINCT FROM completed.account_id
              OR prior_alias.provider_key IS DISTINCT FROM requested_provider_key
              OR prior_alias.issuer IS DISTINCT FROM requested_verified_issuer
              OR prior_alias.subject_digest IS DISTINCT FROM pg_catalog.decode(
                requested_subject_digests_hex[candidate_index], 'hex'
              )
            THEN
              RAISE EXCEPTION 'authentication identity alias conflict' USING ERRCODE = '55000';
            END IF;
          ELSE
            INSERT INTO auth_oidc_identity_digest_aliases (
              identity_id, account_id, provider_key, issuer,
              subject_digest_version, subject_digest
            ) VALUES (
              mapped_identity_id, completed.account_id, requested_provider_key,
              requested_verified_issuer,
              requested_subject_digest_versions[candidate_index],
              pg_catalog.decode(requested_subject_digests_hex[candidate_index], 'hex')
            );
          END IF;
        END LOOP;
      END IF;

      RETURN QUERY SELECT completed.login_outcome, completed.account_id,
        completed.session_family_id, completed.credential_id,
        completed.idle_expires_at, completed.absolute_expires_at;
    END;
    `;

const RESOLVE_SESSION_BODY = `
    DECLARE
      session_policy auth_hmac_key_policies%ROWTYPE;
      csrf_policy auth_hmac_key_policies%ROWTYPE;
      located_family_id uuid;
      session_credential authentication_session_credentials%ROWTYPE;
      matched_credential_index integer;
      matched_csrf_index integer;
    BEGIN
      SELECT policy.* INTO STRICT session_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'SESSION';
      SELECT policy.* INTO STRICT csrf_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'CSRF';
      IF NOT auth_digest_candidate_set_valid(
          requested_credential_digest_versions, requested_credential_digests_hex
        )
        OR requested_credential_digest_versions
          <@ session_policy.accepted_read_versions IS NOT TRUE
        OR NOT session_policy.active_write_version = ANY(requested_credential_digest_versions)
        OR requested_require_csrf IS NULL
        OR (requested_require_csrf AND (
          NOT auth_digest_candidate_set_valid(
            requested_csrf_digest_versions, requested_csrf_digests_hex
          )
          OR requested_csrf_digest_versions
            <@ csrf_policy.accepted_read_versions IS NOT TRUE
          OR NOT csrf_policy.active_write_version = ANY(requested_csrf_digest_versions)
        ))
        OR (NOT requested_require_csrf AND (
          requested_csrf_digest_versions IS NOT NULL
          OR requested_csrf_digests_hex IS NOT NULL
        ))
      THEN
        RAISE EXCEPTION 'invalid authentication key-ring request' USING ERRCODE = '22023';
      END IF;

      SELECT credential.session_family_id INTO located_family_id
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id;
      IF located_family_id IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;
      PERFORM 1 FROM authentication_session_families AS family
      WHERE family.session_family_id = located_family_id FOR UPDATE;
      SELECT credential.* INTO session_credential
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id
        AND credential.session_family_id = located_family_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      SELECT candidate.candidate_index INTO matched_credential_index
      FROM pg_catalog.generate_subscripts(
        requested_credential_digest_versions, 1
      ) AS candidate(candidate_index)
      WHERE requested_credential_digest_versions[candidate.candidate_index]
          = session_credential.credential_digest_version
        AND pg_catalog.decode(
          requested_credential_digests_hex[candidate.candidate_index], 'hex'
        ) = session_credential.credential_digest;
      IF matched_credential_index IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
        RETURN;
      END IF;

      IF requested_require_csrf THEN
        SELECT candidate.candidate_index INTO matched_csrf_index
        FROM pg_catalog.generate_subscripts(
          requested_csrf_digest_versions, 1
        ) AS candidate(candidate_index)
        WHERE requested_csrf_digest_versions[candidate.candidate_index]
            = session_credential.csrf_digest_version
          AND pg_catalog.decode(
            requested_csrf_digests_hex[candidate.candidate_index], 'hex'
          ) = session_credential.csrf_digest;
        IF matched_csrf_index IS NULL THEN
          RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::uuid;
          RETURN;
        END IF;
      END IF;

      RETURN QUERY
      SELECT resolved.authentication_outcome, resolved.account_id, resolved.session_family_id
      FROM resolve_authentication_session(
        requested_credential_id,
        session_credential.credential_digest_version,
        session_credential.credential_digest,
        requested_require_csrf,
        CASE WHEN requested_require_csrf THEN session_credential.csrf_digest_version ELSE NULL END,
        CASE WHEN requested_require_csrf THEN session_credential.csrf_digest ELSE NULL END,
        requested_correlation_id
      ) AS resolved;
    END;
    `;

const ROTATE_SESSION_BODY = `
    DECLARE
      session_policy auth_hmac_key_policies%ROWTYPE;
      csrf_policy auth_hmac_key_policies%ROWTYPE;
      located_family_id uuid;
      session_credential authentication_session_credentials%ROWTYPE;
      matched_credential_index integer;
    BEGIN
      SELECT policy.* INTO STRICT session_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'SESSION';
      SELECT policy.* INTO STRICT csrf_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'CSRF';
      IF NOT auth_digest_candidate_set_valid(
          requested_credential_digest_versions, requested_credential_digests_hex
        )
        OR requested_credential_digest_versions
          <@ session_policy.accepted_read_versions IS NOT TRUE
        OR NOT session_policy.active_write_version = ANY(requested_credential_digest_versions)
        OR requested_new_credential_digest_version
          IS DISTINCT FROM session_policy.active_write_version
        OR requested_new_csrf_digest_version IS DISTINCT FROM csrf_policy.active_write_version
      THEN
        RAISE EXCEPTION 'invalid authentication key-ring request' USING ERRCODE = '22023';
      END IF;

      SELECT credential.session_family_id INTO located_family_id
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id;
      IF located_family_id IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;
      PERFORM 1 FROM authentication_session_families AS family
      WHERE family.session_family_id = located_family_id FOR UPDATE;
      SELECT credential.* INTO session_credential
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id
        AND credential.session_family_id = located_family_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;
      SELECT candidate.candidate_index INTO matched_credential_index
      FROM pg_catalog.generate_subscripts(
        requested_credential_digest_versions, 1
      ) AS candidate(candidate_index)
      WHERE requested_credential_digest_versions[candidate.candidate_index]
          = session_credential.credential_digest_version
        AND pg_catalog.decode(
          requested_credential_digests_hex[candidate.candidate_index], 'hex'
        ) = session_credential.credential_digest;
      IF matched_credential_index IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      RETURN QUERY
      SELECT rotated.rotation_outcome, rotated.credential_id, rotated.expires_at
      FROM rotate_authentication_session(
        requested_credential_id,
        session_credential.credential_digest_version,
        session_credential.credential_digest,
        requested_new_credential_id,
        requested_new_credential_digest_version,
        requested_new_credential_digest,
        requested_new_csrf_digest_version,
        requested_new_csrf_digest,
        requested_correlation_id
      ) AS rotated;
    END;
    `;

const REVOKE_SESSION_BODY = `
    DECLARE
      session_policy auth_hmac_key_policies%ROWTYPE;
      located_family_id uuid;
      session_credential authentication_session_credentials%ROWTYPE;
      matched_credential_index integer;
    BEGIN
      SELECT policy.* INTO STRICT session_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'SESSION';
      IF NOT auth_digest_candidate_set_valid(
          requested_credential_digest_versions, requested_credential_digests_hex
        )
        OR requested_credential_digest_versions
          <@ session_policy.accepted_read_versions IS NOT TRUE
        OR NOT session_policy.active_write_version = ANY(requested_credential_digest_versions)
      THEN
        RAISE EXCEPTION 'invalid authentication key-ring request' USING ERRCODE = '22023';
      END IF;

      SELECT credential.session_family_id INTO located_family_id
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id;
      IF located_family_id IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;
      PERFORM 1 FROM authentication_session_families AS family
      WHERE family.session_family_id = located_family_id FOR UPDATE;
      SELECT credential.* INTO session_credential
      FROM authentication_session_credentials AS credential
      WHERE credential.credential_id = requested_credential_id
        AND credential.session_family_id = located_family_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;
      SELECT candidate.candidate_index INTO matched_credential_index
      FROM pg_catalog.generate_subscripts(
        requested_credential_digest_versions, 1
      ) AS candidate(candidate_index)
      WHERE requested_credential_digest_versions[candidate.candidate_index]
          = session_credential.credential_digest_version
        AND pg_catalog.decode(
          requested_credential_digests_hex[candidate.candidate_index], 'hex'
        ) = session_credential.credential_digest;
      IF matched_credential_index IS NULL THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;

      RETURN QUERY
      SELECT revoked.revocation_outcome
      FROM revoke_authentication_session(
        requested_credential_id,
        session_credential.credential_digest_version,
        session_credential.credential_digest,
        requested_correlation_id
      ) AS revoked;
    END;
    `;

const CONSUME_RATE_LIMIT_BODY = `
    DECLARE
      session_policy auth_hmac_key_policies%ROWTYPE;
      candidate_index integer;
      candidate_result record;
      any_limited boolean := false;
      minimum_remaining integer := requested_limit_count;
      maximum_retry integer := 0;
    BEGIN
      SELECT policy.* INTO STRICT session_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = 'SESSION';
      IF NOT auth_digest_candidate_set_valid(
          requested_subject_digest_versions, requested_subject_digests_hex
        )
        OR requested_subject_digest_versions
          <@ session_policy.accepted_read_versions IS NOT TRUE
        OR NOT session_policy.active_write_version = ANY(requested_subject_digest_versions)
      THEN
        RAISE EXCEPTION 'invalid authentication key-ring request' USING ERRCODE = '22023';
      END IF;

      FOR candidate_index IN 1..pg_catalog.cardinality(requested_subject_digest_versions) LOOP
        SELECT limited.* INTO STRICT candidate_result
        FROM consume_authentication_rate_limit(
          requested_scope,
          requested_subject_digest_versions[candidate_index],
          pg_catalog.decode(requested_subject_digests_hex[candidate_index], 'hex'),
          requested_window_seconds,
          requested_limit_count,
          requested_correlation_id
        ) AS limited;
        minimum_remaining := LEAST(minimum_remaining, candidate_result.remaining_count);
        IF candidate_result.rate_limit_outcome = 'LIMITED' THEN
          any_limited := true;
          maximum_retry := GREATEST(maximum_retry, candidate_result.retry_after_seconds);
        ELSIF candidate_result.rate_limit_outcome <> 'ALLOWED' THEN
          RAISE EXCEPTION 'authentication rate limit result invalid' USING ERRCODE = '55000';
        END IF;
      END LOOP;

      IF any_limited THEN
        RETURN QUERY SELECT 'LIMITED'::text, 0, maximum_retry;
      ELSE
        RETURN QUERY SELECT 'ALLOWED'::text, minimum_remaining, 0;
      END IF;
    END;
    `;

const RETIREMENT_READINESS_BODY = `
    DECLARE
      key_policy auth_hmac_key_policies%ROWTYPE;
      identity_blockers bigint := 0;
      credential_blockers bigint := 0;
      rate_limit_blockers bigint := 0;
      recorded_at timestamptz := pg_catalog.clock_timestamp();
    BEGIN
      IF requested_purpose NOT IN ('IDENTITY', 'SESSION', 'CSRF')
        OR requested_version IS NULL OR requested_version < 1
      THEN
        RAISE EXCEPTION 'invalid authentication key retirement query' USING ERRCODE = '22023';
      END IF;
      SELECT policy.* INTO STRICT key_policy
      FROM auth_hmac_key_policies AS policy WHERE policy.purpose = requested_purpose;

      IF requested_purpose = 'IDENTITY' THEN
        SELECT pg_catalog.count(*) INTO identity_blockers
        FROM authentication_oidc_identities AS identity
        WHERE identity.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM auth_oidc_identity_digest_aliases AS alias
            WHERE alias.identity_id = identity.identity_id
              AND alias.account_id = identity.account_id
              AND alias.issuer = identity.issuer
              AND alias.subject_digest_version = key_policy.active_write_version
          );
      ELSE
        SELECT pg_catalog.count(*) INTO credential_blockers
        FROM authentication_session_credentials AS credential
        INNER JOIN authentication_session_families AS family
          ON family.session_family_id = credential.session_family_id
        WHERE family.status = 'ACTIVE'
          AND family.absolute_expires_at > recorded_at
          AND credential.status IN ('ACTIVE', 'ROTATED')
          AND credential.expires_at > recorded_at
          AND CASE requested_purpose
            WHEN 'SESSION' THEN credential.credential_digest_version = requested_version
            ELSE credential.csrf_digest_version = requested_version
          END;
        IF requested_purpose = 'SESSION' THEN
          SELECT pg_catalog.count(*) INTO rate_limit_blockers
          FROM authentication_rate_limit_buckets AS bucket
          WHERE bucket.subject_digest_version = requested_version
            AND bucket.window_started_at
              + bucket.window_seconds * interval '1 second' > recorded_at;
        END IF;
      END IF;

      RETURN QUERY SELECT
        key_policy.active_write_version,
        requested_version = ANY(key_policy.accepted_read_versions),
        identity_blockers,
        credential_blockers,
        rate_limit_blockers,
        requested_version <> key_policy.active_write_version
          AND identity_blockers = 0
          AND credential_blockers = 0
          AND rate_limit_blockers = 0;
    END;
    `;

const STATE_VERIFIER_BODY = `
    DECLARE
      valid_state boolean;
    BEGIN
      SELECT (
        (SELECT pg_catalog.count(*) = 3
          AND pg_catalog.bool_and(policy.schema_version = 1)
          AND pg_catalog.bool_and(policy.purpose IN ('IDENTITY', 'SESSION', 'CSRF'))
         FROM auth_hmac_key_policies AS policy)
        AND NOT EXISTS (
          SELECT 1
          FROM auth_oidc_identity_digest_aliases AS alias
          LEFT JOIN authentication_oidc_identities AS identity
            ON identity.identity_id = alias.identity_id
          WHERE identity.identity_id IS NULL
            OR identity.account_id IS DISTINCT FROM alias.account_id
            OR identity.issuer IS DISTINCT FROM alias.issuer
        )
        AND NOT EXISTS (
          SELECT alias.identity_id
          FROM auth_oidc_identity_digest_aliases AS alias
          GROUP BY alias.identity_id
          HAVING pg_catalog.count(*) > 3
        )
        AND NOT EXISTS (
          SELECT 1
          FROM authentication_oidc_identities AS identity
          INNER JOIN auth_hmac_key_policies AS policy ON policy.purpose = 'IDENTITY'
          WHERE EXISTS (
              SELECT 1 FROM auth_oidc_identity_digest_aliases AS any_alias
              WHERE any_alias.identity_id = identity.identity_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM auth_oidc_identity_digest_aliases AS active_alias
              WHERE active_alias.identity_id = identity.identity_id
                AND active_alias.account_id = identity.account_id
                AND active_alias.issuer = identity.issuer
                AND active_alias.subject_digest_version = policy.active_write_version
                AND active_alias.subject_digest_version = identity.subject_digest_version
                AND active_alias.subject_digest = identity.subject_digest
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM auth_oidc_identity_digest_aliases AS alias
          CROSS JOIN auth_hmac_key_policies AS policy
          WHERE policy.purpose = 'IDENTITY'
            AND NOT alias.subject_digest_version = ANY(policy.accepted_read_versions)
        )
        AND NOT EXISTS (
          SELECT 1 FROM authentication_oidc_identities AS identity
          CROSS JOIN auth_hmac_key_policies AS policy
          WHERE policy.purpose = 'IDENTITY'
            AND EXISTS (
              SELECT 1 FROM auth_oidc_identity_digest_aliases AS any_alias
              WHERE any_alias.identity_id = identity.identity_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM auth_oidc_identity_digest_aliases AS active_alias
              WHERE active_alias.identity_id = identity.identity_id
                AND active_alias.subject_digest_version = policy.active_write_version
                AND active_alias.subject_digest = identity.subject_digest
                AND identity.subject_digest_version = policy.active_write_version
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM authentication_session_credentials AS credential
          INNER JOIN authentication_session_families AS family
            ON family.session_family_id = credential.session_family_id
          CROSS JOIN auth_hmac_key_policies AS session_policy
          CROSS JOIN auth_hmac_key_policies AS csrf_policy
          WHERE session_policy.purpose = 'SESSION' AND csrf_policy.purpose = 'CSRF'
            AND family.status = 'ACTIVE'
            AND family.absolute_expires_at > pg_catalog.clock_timestamp()
            AND credential.status IN ('ACTIVE', 'ROTATED')
            AND credential.expires_at > pg_catalog.clock_timestamp()
            AND (
              NOT credential.credential_digest_version
                = ANY(session_policy.accepted_read_versions)
              OR NOT credential.csrf_digest_version = ANY(csrf_policy.accepted_read_versions)
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM authentication_rate_limit_buckets AS bucket
          CROSS JOIN auth_hmac_key_policies AS policy
          WHERE policy.purpose = 'SESSION'
            AND bucket.window_started_at
              + bucket.window_seconds * interval '1 second' > pg_catalog.clock_timestamp()
            AND NOT bucket.subject_digest_version = ANY(policy.accepted_read_versions)
        )
      ) INTO valid_state;
      RETURN COALESCE(valid_state, false);
    END;
    `;

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const runtimeGrants = RUNTIME_FUNCTIONS.map(
    (functionIdentity) => `GRANT EXECUTE ON FUNCTION ${functionIdentity} TO ${api};`,
  ).join('\n    ');
  const revokes = ALL_FUNCTIONS.map(
    (functionIdentity) =>
      `REVOKE ALL ON FUNCTION ${functionIdentity}\n      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};`,
  ).join('\n    ');
  return `DO $require_legacy_auth_hmac_version_one$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM authentication_oidc_identities
        WHERE subject_digest_version <> 1
      ) OR EXISTS (
        SELECT 1 FROM authentication_session_credentials
        WHERE credential_digest_version <> 1 OR csrf_digest_version <> 1
      ) OR EXISTS (
        SELECT 1 FROM authentication_rate_limit_buckets
        WHERE subject_digest_version <> 1
      ) THEN
        RAISE EXCEPTION 'authentication HMAC rotation requires an audited version backfill'
          USING ERRCODE = '55000';
      END IF;
    END;
    $require_legacy_auth_hmac_version_one$;

    CREATE TABLE auth_hmac_key_policies (
      purpose text PRIMARY KEY,
      schema_version smallint NOT NULL,
      active_write_version smallint NOT NULL,
      accepted_read_versions smallint[] NOT NULL,
      created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      CONSTRAINT auth_hmac_key_policy_purpose_check CHECK (
        purpose IN ('IDENTITY', 'SESSION', 'CSRF')
      ),
      CONSTRAINT auth_hmac_key_policy_schema_check CHECK (schema_version = 1),
      CONSTRAINT auth_hmac_key_policy_versions_check CHECK (
        pg_catalog.array_ndims(accepted_read_versions) = 1
        AND pg_catalog.array_lower(accepted_read_versions, 1) = 1
        AND pg_catalog.cardinality(accepted_read_versions) BETWEEN 1 AND 3
        AND accepted_read_versions[1] > 0
        AND (pg_catalog.cardinality(accepted_read_versions) < 2
          OR accepted_read_versions[2] > accepted_read_versions[1])
        AND (pg_catalog.cardinality(accepted_read_versions) < 3
          OR accepted_read_versions[3] > accepted_read_versions[2])
        AND active_write_version = ANY(accepted_read_versions)
      )
    );
    INSERT INTO auth_hmac_key_policies (
      purpose, schema_version, active_write_version, accepted_read_versions
    ) VALUES
      ('IDENTITY', 1, 1, ARRAY[1]::smallint[]),
      ('SESSION', 1, 1, ARRAY[1]::smallint[]),
      ('CSRF', 1, 1, ARRAY[1]::smallint[]);

    CREATE TABLE auth_oidc_identity_digest_aliases (
      identity_id uuid NOT NULL,
      account_id uuid NOT NULL,
      provider_key text NOT NULL,
      issuer text NOT NULL,
      subject_digest_version smallint NOT NULL,
      subject_digest bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      CONSTRAINT auth_oidc_identity_digest_alias_pk PRIMARY KEY (
        identity_id, subject_digest_version
      ),
      CONSTRAINT auth_oidc_identity_digest_alias_lookup_unique UNIQUE (
        provider_key, issuer, subject_digest_version, subject_digest
      ),
      CONSTRAINT auth_oidc_identity_digest_alias_provider_check CHECK (
        provider_key ~ '^[a-z][a-z0-9_-]{0,31}$'
      ),
      CONSTRAINT auth_oidc_identity_digest_alias_issuer_check CHECK (
        pg_catalog.char_length(issuer) BETWEEN 9 AND 2048
        AND issuer = pg_catalog.btrim(issuer)
        AND issuer ~ '^https://[^[:space:]?#]+$'
      ),
      CONSTRAINT auth_oidc_identity_digest_alias_digest_check CHECK (
        subject_digest_version > 0 AND pg_catalog.octet_length(subject_digest) = 32
      )
    );

    COMMENT ON TABLE auth_hmac_key_policies IS '${POLICY_MANIFEST}';
    COMMENT ON TABLE auth_oidc_identity_digest_aliases IS '${ALIAS_MANIFEST}';

    CREATE FUNCTION auth_digest_candidate_set_valid(
      candidate_versions smallint[], candidate_digests_hex text[]
    ) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path = pg_catalog
    AS $function$${CANDIDATE_VALIDATOR_BODY}$function$;
    CREATE FUNCTION reject_auth_hmac_policy_mutation()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
    AS $function$${POLICY_GUARD_BODY}$function$;
    CREATE FUNCTION reject_auth_identity_alias_mutation()
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
    AS $function$${ALIAS_GUARD_BODY}$function$;

    CREATE TRIGGER auth_hmac_key_policy_immutable_row
      BEFORE UPDATE OR DELETE ON auth_hmac_key_policies
      FOR EACH ROW EXECUTE FUNCTION reject_auth_hmac_policy_mutation();
    CREATE TRIGGER auth_hmac_key_policy_immutable_truncate
      BEFORE TRUNCATE ON auth_hmac_key_policies
      FOR EACH STATEMENT EXECUTE FUNCTION reject_auth_hmac_policy_mutation();
    CREATE TRIGGER auth_oidc_identity_alias_append_only_row
      BEFORE UPDATE OR DELETE ON auth_oidc_identity_digest_aliases
      FOR EACH ROW EXECUTE FUNCTION reject_auth_identity_alias_mutation();
    CREATE TRIGGER auth_oidc_identity_alias_append_only_truncate
      BEFORE TRUNCATE ON auth_oidc_identity_digest_aliases
      FOR EACH STATEMENT EXECUTE FUNCTION reject_auth_identity_alias_mutation();
    ALTER TABLE auth_hmac_key_policies
      ENABLE ALWAYS TRIGGER auth_hmac_key_policy_immutable_row;
    ALTER TABLE auth_hmac_key_policies
      ENABLE ALWAYS TRIGGER auth_hmac_key_policy_immutable_truncate;
    ALTER TABLE auth_oidc_identity_digest_aliases
      ENABLE ALWAYS TRIGGER auth_oidc_identity_alias_append_only_row;
    ALTER TABLE auth_oidc_identity_digest_aliases
      ENABLE ALWAYS TRIGGER auth_oidc_identity_alias_append_only_truncate;

    CREATE FUNCTION complete_auth_login_keyring(
      requested_attempt_id uuid,
      requested_provider_key text,
      requested_verified_issuer text,
      requested_nonce_digest_version smallint,
      requested_nonce_digest bytea,
      requested_subject_digest_versions smallint[],
      requested_subject_digests_hex text[],
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
      login_outcome text, account_id uuid, session_family_id uuid,
      credential_id uuid, idle_expires_at timestamptz, absolute_expires_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${COMPLETE_LOGIN_BODY}$function$;

    CREATE FUNCTION resolve_auth_session_keyring(
      requested_credential_id uuid,
      requested_credential_digest_versions smallint[],
      requested_credential_digests_hex text[],
      requested_require_csrf boolean,
      requested_csrf_digest_versions smallint[],
      requested_csrf_digests_hex text[],
      requested_correlation_id uuid
    ) RETURNS TABLE (
      authentication_outcome text, account_id uuid, session_family_id uuid
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${RESOLVE_SESSION_BODY}$function$;

    CREATE FUNCTION rotate_auth_session_keyring(
      requested_credential_id uuid,
      requested_credential_digest_versions smallint[],
      requested_credential_digests_hex text[],
      requested_new_credential_id uuid,
      requested_new_credential_digest_version smallint,
      requested_new_credential_digest bytea,
      requested_new_csrf_digest_version smallint,
      requested_new_csrf_digest bytea,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      rotation_outcome text, credential_id uuid, expires_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${ROTATE_SESSION_BODY}$function$;

    CREATE FUNCTION revoke_auth_session_keyring(
      requested_credential_id uuid,
      requested_credential_digest_versions smallint[],
      requested_credential_digests_hex text[],
      requested_correlation_id uuid
    ) RETURNS TABLE (revocation_outcome text)
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${REVOKE_SESSION_BODY}$function$;

    CREATE FUNCTION consume_auth_rate_limit_keyring(
      requested_scope text,
      requested_subject_digest_versions smallint[],
      requested_subject_digests_hex text[],
      requested_window_seconds integer,
      requested_limit_count integer,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      rate_limit_outcome text, remaining_count integer, retry_after_seconds integer
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${CONSUME_RATE_LIMIT_BODY}$function$;

    CREATE FUNCTION auth_hmac_key_retirement_readiness(
      requested_purpose text, requested_version smallint
    ) RETURNS TABLE (
      active_write_version smallint,
      candidate_is_accepted boolean,
      blocking_identity_count bigint,
      blocking_credential_count bigint,
      blocking_rate_limit_count bigint,
      ready boolean
    ) LANGUAGE plpgsql SECURITY DEFINER STABLE STRICT PARALLEL UNSAFE ROWS 1
    AS $function$${RETIREMENT_READINESS_BODY}$function$;

    CREATE FUNCTION verify_auth_hmac_rotation_state()
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER STABLE PARALLEL UNSAFE
    AS $function$${STATE_VERIFIER_BODY}$function$;

    DO $set_auth_hmac_rotation_paths$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        ${ALL_FUNCTIONS.filter(
          (value) =>
            value !== CANDIDATE_VALIDATOR && value !== POLICY_GUARD && value !== ALIAS_GUARD,
        )
          .map((value) => `'${value}'`)
          .join(',\n        ')}
      ] LOOP
        EXECUTE pg_catalog.format(
          'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
          migration_schema, function_identity, migration_schema
        );
      END LOOP;
    END;
    $set_auth_hmac_rotation_paths$;

    REVOKE ALL PRIVILEGES ON TABLE auth_hmac_key_policies,
      auth_oidc_identity_digest_aliases
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON TYPE auth_hmac_key_policies,
      auth_oidc_identity_digest_aliases
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    ${revokes}
    ${runtimeGrants}`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return `DO $refuse_used_auth_hmac_rotation_rollback$
    BEGIN
      IF EXISTS (SELECT 1 FROM auth_oidc_identity_digest_aliases)
        OR EXISTS (
          SELECT 1 FROM auth_hmac_key_policies
          WHERE schema_version <> 1 OR active_write_version <> 1
            OR accepted_read_versions <> ARRAY[1]::smallint[]
        )
        OR EXISTS (
          SELECT 1 FROM authentication_oidc_identities
          WHERE subject_digest_version <> 1
        )
        OR EXISTS (
          SELECT 1 FROM authentication_session_credentials
          WHERE credential_digest_version <> 1 OR csrf_digest_version <> 1
        )
        OR EXISTS (
          SELECT 1 FROM authentication_rate_limit_buckets
          WHERE subject_digest_version <> 1
        )
      THEN
        RAISE EXCEPTION 'cannot roll back authentication HMAC rotation after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_used_auth_hmac_rotation_rollback$;

    ${RUNTIME_FUNCTIONS.map(
      (functionIdentity) => `REVOKE EXECUTE ON FUNCTION ${functionIdentity} FROM ${api};`,
    ).join('\n    ')}
    DROP TRIGGER auth_oidc_identity_alias_append_only_truncate
      ON auth_oidc_identity_digest_aliases;
    DROP TRIGGER auth_oidc_identity_alias_append_only_row
      ON auth_oidc_identity_digest_aliases;
    DROP TRIGGER auth_hmac_key_policy_immutable_truncate ON auth_hmac_key_policies;
    DROP TRIGGER auth_hmac_key_policy_immutable_row ON auth_hmac_key_policies;
    DROP FUNCTION ${STATE_VERIFIER};
    DROP FUNCTION ${RETIREMENT_READINESS};
    DROP FUNCTION ${CONSUME_RATE_LIMIT};
    DROP FUNCTION ${REVOKE_SESSION};
    DROP FUNCTION ${ROTATE_SESSION};
    DROP FUNCTION ${RESOLVE_SESSION};
    DROP FUNCTION ${COMPLETE_LOGIN};
    DROP FUNCTION ${ALIAS_GUARD};
    DROP FUNCTION ${POLICY_GUARD};
    DROP FUNCTION ${CANDIDATE_VALIDATOR};
    DROP TABLE auth_oidc_identity_digest_aliases;
    DROP TABLE auth_hmac_key_policies;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createWalletMetadataRewrapBoundaryMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0024 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  let prior = priorMigration.verifySql;
  if (cumulative) {
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(api, PRIOR_API_FUNCTIONS),
      functionAllowance(api, [...PRIOR_API_FUNCTIONS, ...RUNTIME_FUNCTIONS]),
    );
  }
  const dataShape = cumulative
    ? `SELECT true AS valid`
    : `SELECT verify_auth_hmac_rotation_state() AS valid`;
  const constraintNames = [
    'auth_hmac_key_policies_pkey',
    'auth_hmac_key_policy_purpose_check',
    'auth_hmac_key_policy_schema_check',
    'auth_hmac_key_policy_versions_check',
    'auth_oidc_identity_digest_alias_pk',
    'auth_oidc_identity_digest_alias_lookup_unique',
    'auth_oidc_identity_digest_alias_provider_check',
    'auth_oidc_identity_digest_alias_issuer_check',
    'auth_oidc_identity_digest_alias_digest_check',
  ] as const;

  return `SELECT (
    prior.valid AND relations.valid AND types.valid AND functions.valid
    AND triggers.valid AND constraints.valid AND privileges.valid AND data_shape.valid
  ) AS valid
  FROM (${prior}) AS prior
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AND pg_catalog.bool_and(
        pg_catalog.obj_description(relation.oid, 'pg_class') = CASE relation.relname
          WHEN '${POLICY_TABLE}' THEN '${POLICY_MANIFEST}'
          WHEN '${ALIAS_TABLE}' THEN '${ALIAS_MANIFEST}'
          ELSE NULL
        END
      ) AS valid
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND relation.relkind = 'r'
      AND relation.relname IN ('${POLICY_TABLE}', '${ALIAS_TABLE}')
  ) AS relations
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type AS guarded_type
        INNER JOIN pg_catalog.pg_namespace AS guarded_namespace
          ON guarded_namespace.oid = guarded_type.typnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(guarded_type.typacl, pg_catalog.acldefault('T', guarded_type.typowner))
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE guarded_namespace.nspname = pg_catalog.current_schema()
          AND guarded_type.typname IN ('${POLICY_TABLE}', '${ALIAS_TABLE}')
          AND acl.privilege_type = 'USAGE'
          AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
      ) AS valid
    FROM pg_catalog.pg_type AS type_state
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_state.typnamespace
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND type_state.typtype = 'c'
      AND type_state.typname IN ('${POLICY_TABLE}', '${ALIAS_TABLE}')
  ) AS types
  CROSS JOIN (
    SELECT pg_catalog.count(*) = ${ALL_FUNCTIONS.length}
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AND pg_catalog.bool_and(NOT function_state.proleakproof)
      AND pg_catalog.bool_and(CASE function_state.oid
        WHEN pg_catalog.to_regprocedure('${CANDIDATE_VALIDATOR}')
          THEN NOT function_state.prosecdef AND function_state.provolatile = 'i'
            AND function_state.proparallel = 's' AND function_state.proisstrict
            AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('boolean')
        WHEN pg_catalog.to_regprocedure('${POLICY_GUARD}')
          THEN NOT function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proparallel = 'u' AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('trigger')
        WHEN pg_catalog.to_regprocedure('${ALIAS_GUARD}')
          THEN NOT function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proparallel = 'u' AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('trigger')
        WHEN pg_catalog.to_regprocedure('${RETIREMENT_READINESS}')
          THEN function_state.prosecdef AND function_state.provolatile = 's'
            AND function_state.proparallel = 'u' AND function_state.proisstrict
            AND function_state.proretset AND function_state.prorows = 1
        WHEN pg_catalog.to_regprocedure('${STATE_VERIFIER}')
          THEN function_state.prosecdef AND function_state.provolatile = 's'
            AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
            AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('boolean')
        ELSE function_state.oid IN (
            ${RUNTIME_FUNCTIONS.map((value) => `pg_catalog.to_regprocedure('${value}')`).join(',\n            ')}
          )
          AND function_state.prosecdef AND function_state.provolatile = 'v'
          AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
          AND function_state.proretset AND function_state.prorows = 1
      END)
      AND pg_catalog.bool_and(function_state.proconfig = CASE
        WHEN function_state.oid IN (
          pg_catalog.to_regprocedure('${CANDIDATE_VALIDATOR}'),
          pg_catalog.to_regprocedure('${POLICY_GUARD}'),
          pg_catalog.to_regprocedure('${ALIAS_GUARD}')
        ) THEN ARRAY['search_path=pg_catalog']::text[]
        ELSE ARRAY['search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp']::text[]
      END)
      AND pg_catalog.bool_and(
        pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8')), 'hex'
        ) = CASE function_state.oid
          WHEN pg_catalog.to_regprocedure('${CANDIDATE_VALIDATOR}')
            THEN '${sourceSha256(CANDIDATE_VALIDATOR_BODY)}'
          WHEN pg_catalog.to_regprocedure('${POLICY_GUARD}')
            THEN '${sourceSha256(POLICY_GUARD_BODY)}'
          WHEN pg_catalog.to_regprocedure('${ALIAS_GUARD}')
            THEN '${sourceSha256(ALIAS_GUARD_BODY)}'
          WHEN pg_catalog.to_regprocedure('${COMPLETE_LOGIN}')
            THEN '${sourceSha256(COMPLETE_LOGIN_BODY)}'
          WHEN pg_catalog.to_regprocedure('${RESOLVE_SESSION}')
            THEN '${sourceSha256(RESOLVE_SESSION_BODY)}'
          WHEN pg_catalog.to_regprocedure('${ROTATE_SESSION}')
            THEN '${sourceSha256(ROTATE_SESSION_BODY)}'
          WHEN pg_catalog.to_regprocedure('${REVOKE_SESSION}')
            THEN '${sourceSha256(REVOKE_SESSION_BODY)}'
          WHEN pg_catalog.to_regprocedure('${CONSUME_RATE_LIMIT}')
            THEN '${sourceSha256(CONSUME_RATE_LIMIT_BODY)}'
          WHEN pg_catalog.to_regprocedure('${RETIREMENT_READINESS}')
            THEN '${sourceSha256(RETIREMENT_READINESS_BODY)}'
          WHEN pg_catalog.to_regprocedure('${STATE_VERIFIER}')
            THEN '${sourceSha256(STATE_VERIFIER_BODY)}'
          ELSE NULL
        END
      ) AS valid
    FROM pg_catalog.pg_proc AS function_state
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = function_state.pronamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = function_state.proowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND function_state.oid IN (
        ${ALL_FUNCTIONS.map((value) => `pg_catalog.to_regprocedure('${value}')`).join(',\n        ')}
      )
  ) AS functions
  CROSS JOIN (
    WITH expected(relation_name, trigger_name, function_identity, trigger_type, columns) AS (
      VALUES
        ('${POLICY_TABLE}', 'auth_hmac_key_policy_immutable_row', '${POLICY_GUARD}', 27, ARRAY[]::text[]),
        ('${POLICY_TABLE}', 'auth_hmac_key_policy_immutable_truncate', '${POLICY_GUARD}', 34, ARRAY[]::text[]),
        ('${ALIAS_TABLE}', 'auth_oidc_identity_alias_append_only_row', '${ALIAS_GUARD}', 27, ARRAY[]::text[]),
        ('${ALIAS_TABLE}', 'auth_oidc_identity_alias_append_only_truncate', '${ALIAS_GUARD}', 34, ARRAY[]::text[])
    )
    SELECT pg_catalog.count(*) = 4
      AND pg_catalog.count(trigger_state.oid) = 4
      AND pg_catalog.bool_and(
        trigger_state.oid IS NOT NULL AND NOT trigger_state.tgisinternal
        AND trigger_state.tgenabled = 'A'
        AND trigger_state.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
        AND trigger_state.tgtype = expected.trigger_type
        AND trigger_state.tgnargs = 0 AND trigger_state.tgqual IS NULL
        AND COALESCE((
          SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY selected.ordinality)
          FROM pg_catalog.unnest(trigger_state.tgattr::smallint[])
            WITH ORDINALITY AS selected(attribute_number, ordinality)
          INNER JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = trigger_state.tgrelid
            AND attribute.attnum = selected.attribute_number
        ), ARRAY[]::text[]) = expected.columns
      ) AS valid
    FROM expected
    LEFT JOIN pg_catalog.pg_trigger AS trigger_state
      ON trigger_state.tgrelid = pg_catalog.to_regclass(expected.relation_name)
      AND trigger_state.tgname = expected.trigger_name
  ) AS triggers
  CROSS JOIN (
    SELECT pg_catalog.count(*) = ${constraintNames.length}
      AND pg_catalog.bool_and(constraint_state.convalidated) AS valid
    FROM pg_catalog.pg_constraint AS constraint_state
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = constraint_state.connamespace
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND constraint_state.conname IN (
        ${constraintNames.map((value) => `'${value}'`).join(',\n        ')}
      )
  ) AS constraints
  CROSS JOIN (
    SELECT NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS guarded_table
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = guarded_table.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(guarded_table.relacl, pg_catalog.acldefault('r', guarded_table.relowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND guarded_table.relname IN ('${POLICY_TABLE}', '${ALIAS_TABLE}')
        AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS guarded_function
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = guarded_function.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(guarded_function.proacl, pg_catalog.acldefault('f', guarded_function.proowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND guarded_function.oid IN (
          ${ALL_FUNCTIONS.map((value) => `pg_catalog.to_regprocedure('${value}')`).join(',\n          ')}
        )
        AND (
          acl.grantee = 0 OR grantee.rolname IN (${worker}, ${legacy}, ${migration})
          OR acl.is_grantable
          OR (grantee.rolname = ${api} AND guarded_function.oid NOT IN (
            ${RUNTIME_FUNCTIONS.map((value) => `pg_catalog.to_regprocedure('${value}')`).join(',\n            ')}
          ))
        )
    ) AND NOT EXISTS (
      SELECT expected.oid
      FROM pg_catalog.unnest(ARRAY[
        ${RUNTIME_FUNCTIONS.map((value) => `pg_catalog.to_regprocedure('${value}')`).join(',\n        ')}
      ]::oid[]) AS expected(oid)
      WHERE expected.oid IS NULL
        OR NOT pg_catalog.has_function_privilege(${api}, expected.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege(${worker}, expected.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege(${legacy}, expected.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege(${migration}, expected.oid, 'EXECUTE')
    ) AND NOT pg_catalog.has_function_privilege(${api}, '${RETIREMENT_READINESS}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${STATE_VERIFIER}', 'EXECUTE')
    AS valid
  ) AS privileges
  CROSS JOIN (${dataShape}) AS data_shape`;
}

export function createAuthenticationHmacKeyRotationMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0025',
    description: 'create overlapping authentication HMAC key rotation boundary',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0024'],
  };
}

export const createAuthenticationHmacKeyRotationMigrationV0025 =
  createAuthenticationHmacKeyRotationMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createAuthenticationHmacKeyRotationTestSchemaMigrationV0025 =
  createAuthenticationHmacKeyRotationMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
