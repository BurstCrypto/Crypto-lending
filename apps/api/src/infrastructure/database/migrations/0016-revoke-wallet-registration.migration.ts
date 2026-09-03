import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createMainnetWalletLaunchNarrowingMigration } from './0015-narrow-mainnet-wallet-launch.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const REVOKE_WALLET_FUNCTION_IDENTITY = 'revoke_wallet_registration(uuid,uuid,uuid)';
const WALLET_LIFECYCLE_FUNCTION_IDENTITY = 'enforce_registered_wallet_lifecycle()';
const WALLET_LIFECYCLE_TRIGGER = 'registered_wallet_lifecycle';
const REVOKED_WALLET_IDENTITY_INDEX = 'registered_wallets_revoked_identity_timeline_idx';
const REVOCATION_TOMBSTONE_FUNCTION_IDENTITY = 'enforce_wallet_registration_revocation_tombstone()';
const REVOCATION_TOMBSTONE_TRIGGER = 'registered_wallet_revocation_tombstone';
const CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY =
  'enforce_wallet_challenge_revocation_tombstone()';
const CHALLENGE_REVOCATION_TOMBSTONE_TRIGGER = 'wallet_challenge_revocation_tombstone';
const REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY = 'verify_wallet_revocation_state()';
const GUARDED_COMPLETION_FUNCTION_IDENTITY =
  'complete_wallet_registration_guarded(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)';
const REVOCATION_CONSTRAINT_DEFINITION_SHA256 =
  '34ebe5f121d1278f6367098ea3927efd66935dea994cf0b4da3a55bfca06170e';

const STALE_ACTIVE_WALLET_QUERY = `SELECT 1
        FROM registered_wallets AS active_wallet
        INNER JOIN wallet_ownership_challenges AS registration_challenge
          ON registration_challenge.challenge_id = active_wallet.registered_by_challenge_id
        INNER JOIN registered_wallets AS tombstone
          ON tombstone.chain_namespace = active_wallet.chain_namespace
          AND tombstone.chain_reference = active_wallet.chain_reference
          AND tombstone.address_digest_version = active_wallet.address_digest_version
          AND tombstone.address_digest = active_wallet.address_digest
          AND tombstone.status = 'REVOKED'
        WHERE active_wallet.status = 'ACTIVE'
          AND registration_challenge.created_at <= tombstone.revoked_at`;

const REVOCATION_STATE_VERIFIER_BODY = `
    SELECT NOT EXISTS (
      ${STALE_ACTIVE_WALLET_QUERY}
    )
    `;

const PRIOR_WALLET_API_FUNCTION_IDENTITIES = [
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'list_active_wallet_registrations(uuid)',
] as const;

const REVOKE_WALLET_BODY = `
    DECLARE
      target_wallet registered_wallets%ROWTYPE;
      revoked_wallet_id uuid;
      recorded_at timestamptz;
    BEGIN
      IF requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR substring(requested_wallet_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_wallet_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_correlation_id IS NULL
        OR substring(requested_correlation_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_correlation_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
      THEN
        RAISE EXCEPTION 'invalid wallet registration revocation' USING ERRCODE = '22023';
      END IF;

      SELECT wallet.*
      INTO target_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id;

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'UNCHANGED'::text;
        RETURN;
      END IF;

      -- Makes same-account challenge creation occur strictly before or after revocation.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56001)
      );

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          target_wallet.chain_namespace || ':'
            || target_wallet.chain_reference || ':'
            || target_wallet.address_digest_version::text || ':'
            || pg_catalog.encode(target_wallet.address_digest, 'hex'),
          56002
        )
      );

      recorded_at := clock_timestamp();
      UPDATE registered_wallets AS wallet
      SET status = 'REVOKED',
          revoked_at = recorded_at
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
      RETURNING wallet.wallet_id INTO revoked_wallet_id;

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'UNCHANGED'::text;
        RETURN;
      END IF;

      INSERT INTO wallet_registration_audit_events (
        event_type,
        outcome,
        reason_code,
        wallet_id,
        account_id,
        correlation_id,
        occurred_at
      ) VALUES (
        'WALLET_REVOKED',
        'SUCCEEDED',
        'NONE',
        revoked_wallet_id,
        requested_account_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT 'REVOKED'::text;
    END;
    `;

const REVOCATION_TOMBSTONE_BODY = `
    BEGIN
      IF NEW.status = 'ACTIVE' AND EXISTS (
        SELECT 1
        FROM wallet_ownership_challenges AS challenge
        INNER JOIN registered_wallets AS tombstone
          ON tombstone.chain_namespace = NEW.chain_namespace
          AND tombstone.chain_reference = NEW.chain_reference
          AND tombstone.address_digest_version = NEW.address_digest_version
          AND tombstone.address_digest = NEW.address_digest
          AND tombstone.status = 'REVOKED'
        WHERE challenge.challenge_id = NEW.registered_by_challenge_id
          AND challenge.chain_namespace = NEW.chain_namespace
          AND challenge.chain_reference = NEW.chain_reference
          AND challenge.address_digest_version = NEW.address_digest_version
          AND challenge.address_digest = NEW.address_digest
          AND challenge.created_at <= tombstone.revoked_at
      ) THEN
        RAISE EXCEPTION 'wallet ownership proof predates the latest revocation'
          USING ERRCODE = 'W1601';
      END IF;
      RETURN NEW;
    END;
    `;

const CHALLENGE_REVOCATION_TOMBSTONE_BODY = `
    BEGIN
      IF OLD.status = 'PENDING'
        AND NEW.status = 'REGISTERED'
        AND EXISTS (
          SELECT 1
          FROM registered_wallets AS tombstone
          WHERE tombstone.chain_namespace = OLD.chain_namespace
            AND tombstone.chain_reference = OLD.chain_reference
            AND tombstone.address_digest_version = OLD.address_digest_version
            AND tombstone.address_digest = OLD.address_digest
            AND tombstone.status = 'REVOKED'
            AND OLD.created_at <= tombstone.revoked_at
        )
      THEN
        RAISE EXCEPTION 'wallet ownership proof predates the latest revocation'
          USING ERRCODE = 'W1601';
      END IF;
      RETURN NEW;
    END;
    `;

const GUARDED_COMPLETION_BODY = `
    DECLARE
      ownership_challenge wallet_ownership_challenges%ROWTYPE;
      recorded_at timestamptz;
    BEGIN
      IF requested_challenge_id IS NULL
        OR requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR substring(requested_wallet_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_wallet_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_address_key_version IS NULL
        OR requested_address_key_version < 1
        OR requested_address_ciphertext IS NULL
        OR octet_length(requested_address_ciphertext) NOT BETWEEN 1 AND 512
        OR requested_address_iv IS NULL
        OR octet_length(requested_address_iv) <> 12
        OR requested_address_auth_tag IS NULL
        OR octet_length(requested_address_auth_tag) <> 16
        OR requested_metadata_key_version IS NULL
        OR requested_metadata_key_version < 1
        OR requested_metadata_ciphertext IS NULL
        OR octet_length(requested_metadata_ciphertext) NOT BETWEEN 1 AND 16384
        OR requested_metadata_iv IS NULL
        OR octet_length(requested_metadata_iv) <> 12
        OR requested_metadata_auth_tag IS NULL
        OR octet_length(requested_metadata_auth_tag) <> 16
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid guarded wallet registration completion'
          USING ERRCODE = '22023';
      END IF;

      SELECT challenge.*
      INTO ownership_challenge
      FROM wallet_ownership_challenges AS challenge
      WHERE challenge.challenge_id = requested_challenge_id
        AND challenge.account_id = requested_account_id
      FOR UPDATE;

      recorded_at := clock_timestamp();
      IF FOUND
        AND ownership_challenge.status = 'PENDING'
        AND recorded_at < ownership_challenge.expires_at
      THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            ownership_challenge.chain_namespace || ':'
              || ownership_challenge.chain_reference || ':'
              || ownership_challenge.address_digest_version::text || ':'
              || pg_catalog.encode(ownership_challenge.address_digest, 'hex'),
            56002
          )
        );

        recorded_at := clock_timestamp();
        IF recorded_at < ownership_challenge.expires_at
          AND EXISTS (
            SELECT 1
            FROM registered_wallets AS tombstone
            WHERE tombstone.chain_namespace = ownership_challenge.chain_namespace
              AND tombstone.chain_reference = ownership_challenge.chain_reference
              AND tombstone.address_digest_version = ownership_challenge.address_digest_version
              AND tombstone.address_digest = ownership_challenge.address_digest
              AND tombstone.status = 'REVOKED'
              AND ownership_challenge.created_at <= tombstone.revoked_at
          )
        THEN
          UPDATE wallet_ownership_challenges AS challenge
          SET status = 'REJECTED',
              completed_at = recorded_at,
              failure_reason = 'WALLET_REVOKED',
              challenge_payload_key_version = NULL,
              challenge_payload_ciphertext = NULL,
              challenge_payload_iv = NULL,
              challenge_payload_auth_tag = NULL,
              payload_destroyed_at = recorded_at
          WHERE challenge.challenge_id = requested_challenge_id;

          INSERT INTO wallet_registration_audit_events (
            event_type,
            outcome,
            reason_code,
            challenge_id,
            account_id,
            correlation_id,
            occurred_at
          ) VALUES (
            'CHALLENGE_REJECTED',
            'REJECTED',
            'WALLET_REVOKED',
            requested_challenge_id,
            requested_account_id,
            requested_correlation_id,
            recorded_at
          );

          RETURN QUERY SELECT 'REVOKED'::text, NULL::uuid, NULL::timestamptz;
          RETURN;
        END IF;
      END IF;

      RETURN QUERY
      SELECT completed.registration_outcome, completed.wallet_id, completed.registered_at
      FROM complete_wallet_registration(
        requested_challenge_id,
        requested_account_id,
        requested_wallet_id,
        requested_address_key_version,
        requested_address_ciphertext,
        requested_address_iv,
        requested_address_auth_tag,
        requested_metadata_key_version,
        requested_metadata_ciphertext,
        requested_metadata_iv,
        requested_metadata_auth_tag,
        requested_correlation_id
      ) AS completed;
    END;
    `;

const WALLET_LIFECYCLE_BODY = `
    BEGIN
      IF OLD.status = 'REVOKED'
        AND (
          NEW.status IS DISTINCT FROM OLD.status
          OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
        )
      THEN
        RAISE EXCEPTION 'revoked wallet registration is terminal' USING ERRCODE = '23514';
      END IF;

      IF OLD.status = 'ACTIVE'
        AND NOT (
          (NEW.status = 'ACTIVE' AND NEW.revoked_at IS NULL)
          OR (NEW.status = 'REVOKED' AND NEW.revoked_at IS NOT NULL)
        )
      THEN
        RAISE EXCEPTION 'invalid wallet registration lifecycle transition'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    `;

const AUDIT_EVENT_CHECK = `CHECK (event_type IN (
      'CHALLENGE_STARTED',
      'CHALLENGE_REPLAY_DETECTED',
      'CHALLENGE_REJECTED',
      'CHALLENGE_EXPIRED',
      'WALLET_REGISTERED',
      'WALLET_ALREADY_REGISTERED',
      'WALLET_REVOKED'
    ))`;

const AUDIT_REASON_CHECK = `CHECK (reason_code IN (
      'NONE',
      'EXPIRED',
      'REPLAY',
      'MALFORMED_PROOF',
      'SIGNATURE_INVALID',
      'WRONG_DOMAIN',
      'WRONG_USER',
      'WRONG_NETWORK',
      'WRONG_ADDRESS',
      'WRONG_MESSAGE',
      'WRONG_NONCE',
      'UNSUPPORTED_SCHEME',
      'OWNERSHIP_CONFLICT',
      'WALLET_REVOKED'
    ))`;

const AUDIT_SHAPE_CHECK = `CHECK (
      (event_type = 'CHALLENGE_STARTED'
        AND outcome = 'SUCCEEDED' AND reason_code = 'NONE'
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type = 'CHALLENGE_REPLAY_DETECTED'
        AND outcome = 'DETECTED' AND reason_code = 'REPLAY'
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type = 'CHALLENGE_REJECTED'
        AND outcome = 'REJECTED'
        AND reason_code NOT IN ('NONE', 'EXPIRED', 'REPLAY')
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type = 'CHALLENGE_EXPIRED'
        AND outcome = 'REJECTED' AND reason_code = 'EXPIRED'
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type IN ('WALLET_REGISTERED', 'WALLET_ALREADY_REGISTERED')
        AND outcome = 'SUCCEEDED' AND reason_code = 'NONE'
        AND challenge_id IS NOT NULL AND wallet_id IS NOT NULL)
      OR (event_type = 'WALLET_REVOKED'
        AND outcome = 'SUCCEEDED' AND reason_code = 'NONE'
        AND challenge_id IS NULL AND wallet_id IS NOT NULL)
    )`;

const CHALLENGE_FAILURE_REASON_CHECK = `CHECK (
      failure_reason IS NULL
      OR failure_reason IN (
        'EXPIRED',
        'MALFORMED_PROOF',
        'SIGNATURE_INVALID',
        'WRONG_DOMAIN',
        'WRONG_USER',
        'WRONG_NETWORK',
        'WRONG_ADDRESS',
        'WRONG_MESSAGE',
        'WRONG_NONCE',
        'UNSUPPORTED_SCHEME',
        'OWNERSHIP_CONFLICT',
        'WALLET_REVOKED'
      )
    )`;

const LEGACY_AUDIT_EVENT_CHECK = `CHECK (event_type IN (
      'CHALLENGE_STARTED',
      'CHALLENGE_REPLAY_DETECTED',
      'CHALLENGE_REJECTED',
      'CHALLENGE_EXPIRED',
      'WALLET_REGISTERED',
      'WALLET_ALREADY_REGISTERED'
    ))`;

const LEGACY_AUDIT_REASON_CHECK = `CHECK (reason_code IN (
      'NONE',
      'EXPIRED',
      'REPLAY',
      'MALFORMED_PROOF',
      'SIGNATURE_INVALID',
      'WRONG_DOMAIN',
      'WRONG_USER',
      'WRONG_NETWORK',
      'WRONG_ADDRESS',
      'WRONG_MESSAGE',
      'WRONG_NONCE',
      'UNSUPPORTED_SCHEME',
      'OWNERSHIP_CONFLICT'
    ))`;

const LEGACY_AUDIT_SHAPE_CHECK = `CHECK (
      (event_type = 'CHALLENGE_STARTED'
        AND outcome = 'SUCCEEDED' AND reason_code = 'NONE'
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type = 'CHALLENGE_REPLAY_DETECTED'
        AND outcome = 'DETECTED' AND reason_code = 'REPLAY'
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type = 'CHALLENGE_REJECTED'
        AND outcome = 'REJECTED'
        AND reason_code NOT IN ('NONE', 'EXPIRED', 'REPLAY')
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type = 'CHALLENGE_EXPIRED'
        AND outcome = 'REJECTED' AND reason_code = 'EXPIRED'
        AND challenge_id IS NOT NULL AND wallet_id IS NULL)
      OR (event_type IN ('WALLET_REGISTERED', 'WALLET_ALREADY_REGISTERED')
        AND outcome = 'SUCCEEDED' AND reason_code = 'NONE'
        AND challenge_id IS NOT NULL AND wallet_id IS NOT NULL)
    )`;

const LEGACY_CHALLENGE_FAILURE_REASON_CHECK = `CHECK (
      failure_reason IS NULL
      OR failure_reason IN (
        'EXPIRED',
        'MALFORMED_PROOF',
        'SIGNATURE_INVALID',
        'WRONG_DOMAIN',
        'WRONG_USER',
        'WRONG_NETWORK',
        'WRONG_ADDRESS',
        'WRONG_MESSAGE',
        'WRONG_NONCE',
        'UNSUPPORTED_SCHEME',
        'OWNERSHIP_CONFLICT'
      )
    )`;

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
    throw new Error('Migration 0016 verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function walletFunctionAllowance(api: string, functions: readonly string[]): string {
  return `            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                ${functions
                  .map((identityValue) => `to_regprocedure('${identityValue}')`)
                  .join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
}

function extendPriorVerifier(names: DatabasePrincipalNames, priorVerifier: string): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const guardedApiFunctions = [
    ...PRIOR_WALLET_API_FUNCTION_IDENTITIES,
    REVOKE_WALLET_FUNCTION_IDENTITY,
    GUARDED_COMPLETION_FUNCTION_IDENTITY,
    REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY,
  ];
  return replaceExactlyOnce(
    priorVerifier,
    walletFunctionAllowance(api, PRIOR_WALLET_API_FUNCTION_IDENTITIES),
    `${walletFunctionAllowance(api, guardedApiFunctions)}
${walletFunctionAllowance(worker, [REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY])}`,
  );
}

function replaceAuditConstraintsSql(
  eventCheck: string,
  reasonCheck: string,
  shapeCheck: string,
  challengeFailureReasonCheck: string,
): string {
  return `ALTER TABLE wallet_ownership_challenges
      DROP CONSTRAINT wallet_ownership_challenge_failure_reason_check,
      ADD CONSTRAINT wallet_ownership_challenge_failure_reason_check
        ${challengeFailureReasonCheck};
    ALTER TABLE wallet_registration_audit_events
      DROP CONSTRAINT wallet_registration_audit_shape_check,
      DROP CONSTRAINT wallet_registration_audit_reason_check,
      DROP CONSTRAINT wallet_registration_audit_event_check,
      ADD CONSTRAINT wallet_registration_audit_event_check ${eventCheck},
      ADD CONSTRAINT wallet_registration_audit_reason_check ${reasonCheck},
      ADD CONSTRAINT wallet_registration_audit_shape_check ${shapeCheck};`;
}

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  return `${replaceAuditConstraintsSql(
    AUDIT_EVENT_CHECK,
    AUDIT_REASON_CHECK,
    AUDIT_SHAPE_CHECK,
    CHALLENGE_FAILURE_REASON_CHECK,
  )}

    CREATE FUNCTION ${WALLET_LIFECYCLE_FUNCTION_IDENTITY}
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$${WALLET_LIFECYCLE_BODY}$function$;

    CREATE TRIGGER ${WALLET_LIFECYCLE_TRIGGER}
      BEFORE UPDATE OF status, revoked_at ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION ${WALLET_LIFECYCLE_FUNCTION_IDENTITY};
    ALTER TABLE registered_wallets ENABLE ALWAYS TRIGGER ${WALLET_LIFECYCLE_TRIGGER};

    CREATE INDEX ${REVOKED_WALLET_IDENTITY_INDEX}
      ON registered_wallets (
        chain_namespace,
        chain_reference,
        address_digest_version,
        address_digest,
        revoked_at DESC,
        wallet_id
      )
      WHERE status = 'REVOKED';

    CREATE FUNCTION ${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$${REVOCATION_TOMBSTONE_BODY}$function$;

    CREATE TRIGGER ${REVOCATION_TOMBSTONE_TRIGGER}
      BEFORE INSERT ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION ${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY};
    ALTER TABLE registered_wallets ENABLE ALWAYS TRIGGER ${REVOCATION_TOMBSTONE_TRIGGER};

    CREATE FUNCTION ${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$${CHALLENGE_REVOCATION_TOMBSTONE_BODY}$function$;

    CREATE TRIGGER ${CHALLENGE_REVOCATION_TOMBSTONE_TRIGGER}
      BEFORE UPDATE OF status ON wallet_ownership_challenges
      FOR EACH ROW EXECUTE FUNCTION ${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY};
    ALTER TABLE wallet_ownership_challenges
      ENABLE ALWAYS TRIGGER ${CHALLENGE_REVOCATION_TOMBSTONE_TRIGGER};

    DO $reject_existing_stale_active_wallets$
    BEGIN
      IF EXISTS (
        ${STALE_ACTIVE_WALLET_QUERY}
      ) THEN
        RAISE EXCEPTION 'active wallet ownership proof predates a revocation'
          USING ERRCODE = '55000';
      END IF;
    END;
    $reject_existing_stale_active_wallets$;

    CREATE FUNCTION ${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY}
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    PARALLEL UNSAFE
    AS $function$${REVOCATION_STATE_VERIFIER_BODY}$function$;

    CREATE FUNCTION revoke_wallet_registration(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_correlation_id uuid
    ) RETURNS TABLE (revocation_outcome text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$${REVOKE_WALLET_BODY}$function$;

    CREATE FUNCTION complete_wallet_registration_guarded(
      requested_challenge_id uuid,
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_address_key_version smallint,
      requested_address_ciphertext bytea,
      requested_address_iv bytea,
      requested_address_auth_tag bytea,
      requested_metadata_key_version smallint,
      requested_metadata_ciphertext bytea,
      requested_metadata_iv bytea,
      requested_metadata_auth_tag bytea,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      registration_outcome text,
      wallet_id uuid,
      registered_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$${GUARDED_COMPLETION_BODY}$function$;

    DO $set_wallet_revoke_function_path$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${REVOKE_WALLET_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${GUARDED_COMPLETION_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_wallet_revoke_function_path$;

    REVOKE ALL ON FUNCTION ${REVOKE_WALLET_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${WALLET_LIFECYCLE_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${GUARDED_COMPLETION_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    GRANT EXECUTE ON FUNCTION ${REVOKE_WALLET_FUNCTION_IDENTITY} TO ${api};
    GRANT EXECUTE ON FUNCTION ${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY}
      TO ${api}, ${worker};
    GRANT EXECUTE ON FUNCTION ${GUARDED_COMPLETION_FUNCTION_IDENTITY} TO ${api};`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  return `DO $prevent_wallet_revocation_audit_loss$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM wallet_registration_audit_events
        WHERE event_type = 'WALLET_REVOKED' OR reason_code = 'WALLET_REVOKED'
      ) OR EXISTS (
        SELECT 1 FROM wallet_ownership_challenges
        WHERE failure_reason = 'WALLET_REVOKED'
      ) OR EXISTS (
        SELECT 1 FROM registered_wallets
        WHERE status = 'REVOKED'
      ) THEN
        RAISE EXCEPTION 'cannot roll back wallet revocation after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $prevent_wallet_revocation_audit_loss$;

    REVOKE EXECUTE ON FUNCTION ${REVOKE_WALLET_FUNCTION_IDENTITY} FROM ${api};
    REVOKE EXECUTE ON FUNCTION ${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY}
      FROM ${api}, ${worker};
    REVOKE EXECUTE ON FUNCTION ${GUARDED_COMPLETION_FUNCTION_IDENTITY} FROM ${api};
    DROP FUNCTION ${GUARDED_COMPLETION_FUNCTION_IDENTITY};
    DROP FUNCTION ${REVOKE_WALLET_FUNCTION_IDENTITY};
    DROP FUNCTION ${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY};
    DROP TRIGGER ${CHALLENGE_REVOCATION_TOMBSTONE_TRIGGER} ON wallet_ownership_challenges;
    DROP FUNCTION ${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY};
    DROP TRIGGER ${REVOCATION_TOMBSTONE_TRIGGER} ON registered_wallets;
    DROP FUNCTION ${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY};
    DROP INDEX ${REVOKED_WALLET_IDENTITY_INDEX};
    DROP TRIGGER ${WALLET_LIFECYCLE_TRIGGER} ON registered_wallets;
    DROP FUNCTION ${WALLET_LIFECYCLE_FUNCTION_IDENTITY};
    ${replaceAuditConstraintsSql(
      LEGACY_AUDIT_EVENT_CHECK,
      LEGACY_AUDIT_REASON_CHECK,
      LEGACY_AUDIT_SHAPE_CHECK,
      LEGACY_CHALLENGE_FAILURE_REASON_CHECK,
    )}`;
}

function createVerifierSql(
  names: DatabasePrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createMainnetWalletLaunchNarrowingMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0015 must expose verification SQL');
  const priorVerifier = cumulativePrincipalVerification
    ? extendPriorVerifier(names, priorMigration.verifySql)
    : priorMigration.verifySql;
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const ownerVerification = cumulativePrincipalVerification
    ? `AND function_owner.rolname = ${owner}`
    : '';

  const stateFunctionVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'sql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 's'
      AND function_state.proparallel = 'u'
      AND function_state.prosecdef
      AND NOT function_state.proleakproof
      AND NOT function_state.proisstrict
      AND NOT function_state.proretset
      AND function_state.pronargs = 0
      AND function_state.pronargdefaults = 0
      AND pg_catalog.pg_get_function_result(function_state.oid) = 'boolean'
      AND function_state.proconfig = ARRAY[
        'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
      ]::text[]
      AND function_state.prosrc = $expected_state_body$${REVOCATION_STATE_VERIFIER_BODY}$expected_state_body$
      AND pg_catalog.has_function_privilege(${api}, function_state.oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege(${worker}, function_state.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, function_state.oid, 'EXECUTE')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS allowed_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(allowed_function.proacl, pg_catalog.acldefault('f', allowed_function.proowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE allowed_function.oid =
          to_regprocedure('${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY}')
        AND acl.grantee <> allowed_function.proowner
        AND NOT (
          grantee.rolname IN (${api}, ${worker})
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
        )
    )
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid = to_regprocedure('${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  const revokeVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'plpgsql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 'v'
      AND function_state.proparallel = 'u'
      AND function_state.prosecdef
      AND NOT function_state.proleakproof
      AND NOT function_state.proisstrict
      AND function_state.proretset
      AND function_state.pronargs = 3
      AND function_state.pronargdefaults = 0
      AND pg_catalog.pg_get_function_identity_arguments(function_state.oid) =
        'requested_account_id uuid, requested_wallet_id uuid, requested_correlation_id uuid'
      AND pg_catalog.pg_get_function_result(function_state.oid) =
        'TABLE(revocation_outcome text)'
      AND function_state.proconfig = ARRAY[
        'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
      ]::text[]
      AND function_state.prosrc = $expected_revoke_body$${REVOKE_WALLET_BODY}$expected_revoke_body$
      AND pg_catalog.has_function_privilege(${api}, function_state.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, function_state.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, function_state.oid, 'EXECUTE')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS allowed_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(allowed_function.proacl, pg_catalog.acldefault('f', allowed_function.proowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE allowed_function.oid = to_regprocedure('${REVOKE_WALLET_FUNCTION_IDENTITY}')
        AND acl.grantee <> allowed_function.proowner
        AND NOT (
          grantee.rolname = ${api}
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
        )
    )
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid = to_regprocedure('${REVOKE_WALLET_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  const guardedCompletionVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'plpgsql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 'v'
      AND function_state.proparallel = 'u'
      AND function_state.prosecdef
      AND NOT function_state.proleakproof
      AND NOT function_state.proisstrict
      AND function_state.proretset
      AND function_state.pronargs = 12
      AND function_state.pronargdefaults = 0
      AND pg_catalog.pg_get_function_identity_arguments(function_state.oid) =
        'requested_challenge_id uuid, requested_account_id uuid, requested_wallet_id uuid, requested_address_key_version smallint, requested_address_ciphertext bytea, requested_address_iv bytea, requested_address_auth_tag bytea, requested_metadata_key_version smallint, requested_metadata_ciphertext bytea, requested_metadata_iv bytea, requested_metadata_auth_tag bytea, requested_correlation_id uuid'
      AND pg_catalog.pg_get_function_result(function_state.oid) =
        'TABLE(registration_outcome text, wallet_id uuid, registered_at timestamp with time zone)'
      AND function_state.proconfig = ARRAY[
        'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
      ]::text[]
      AND function_state.prosrc = $expected_guarded_completion_body$${GUARDED_COMPLETION_BODY}$expected_guarded_completion_body$
      AND pg_catalog.has_function_privilege(${api}, function_state.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, function_state.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, function_state.oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege(
        ${api},
        to_regprocedure('${PRIOR_WALLET_API_FUNCTION_IDENTITIES[3]}'),
        'EXECUTE'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS allowed_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(allowed_function.proacl, pg_catalog.acldefault('f', allowed_function.proowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE allowed_function.oid = to_regprocedure('${GUARDED_COMPLETION_FUNCTION_IDENTITY}')
        AND acl.grantee <> allowed_function.proowner
        AND NOT (
          grantee.rolname = ${api}
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
        )
    )
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid = to_regprocedure('${GUARDED_COMPLETION_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  const lifecycleVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'plpgsql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 'v'
      AND function_state.proparallel = 'u'
      AND NOT function_state.prosecdef
      AND NOT function_state.proleakproof
      AND NOT function_state.proisstrict
      AND NOT function_state.proretset
      AND function_state.pronargs = 0
      AND function_state.pronargdefaults = 0
      AND pg_catalog.pg_get_function_result(function_state.oid) = 'trigger'
      AND function_state.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND function_state.prosrc = $expected_lifecycle_body$${WALLET_LIFECYCLE_BODY}$expected_lifecycle_body$
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS denied_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(denied_function.proacl, pg_catalog.acldefault('f', denied_function.proowner))
      ) AS acl
      WHERE denied_function.oid = to_regprocedure('${WALLET_LIFECYCLE_FUNCTION_IDENTITY}')
        AND acl.grantee <> denied_function.proowner
    )
    AND (SELECT pg_catalog.count(*) = 1
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid = pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', pg_catalog.current_schema(), 'registered_wallets')
        )
        AND trigger_state.tgfoid = to_regprocedure('${WALLET_LIFECYCLE_FUNCTION_IDENTITY}')
        AND trigger_state.tgname = '${WALLET_LIFECYCLE_TRIGGER}'
        AND trigger_state.tgtype = 19
        AND trigger_state.tgenabled = 'A'
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgqual IS NULL
        AND trigger_state.tgnargs = 0
        AND (
          SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY selected.ordinality)
          FROM pg_catalog.unnest(trigger_state.tgattr::smallint[])
            WITH ORDINALITY AS selected(attnum, ordinality)
          INNER JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = trigger_state.tgrelid
            AND attribute.attnum = selected.attnum
        ) = ARRAY['status', 'revoked_at']::text[]
        AND pg_catalog.strpos(
          pg_catalog.pg_get_triggerdef(trigger_state.oid, false),
          'BEFORE UPDATE OF status, revoked_at ON'
        ) > 0)
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid = to_regprocedure('${WALLET_LIFECYCLE_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  const tombstoneVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'plpgsql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 'v'
      AND function_state.proparallel = 'u'
      AND NOT function_state.prosecdef
      AND NOT function_state.proleakproof
      AND NOT function_state.proisstrict
      AND NOT function_state.proretset
      AND function_state.pronargs = 0
      AND function_state.pronargdefaults = 0
      AND pg_catalog.pg_get_function_result(function_state.oid) = 'trigger'
      AND function_state.proconfig = ARRAY[
        'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
      ]::text[]
      AND function_state.prosrc = $expected_tombstone_body$${REVOCATION_TOMBSTONE_BODY}$expected_tombstone_body$
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS denied_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(denied_function.proacl, pg_catalog.acldefault('f', denied_function.proowner))
      ) AS acl
      WHERE denied_function.oid = to_regprocedure('${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}')
        AND acl.grantee <> denied_function.proowner
    )
    AND (SELECT pg_catalog.count(*) = 1
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid = pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', pg_catalog.current_schema(), 'registered_wallets')
        )
        AND trigger_state.tgfoid = to_regprocedure('${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}')
        AND trigger_state.tgname = '${REVOCATION_TOMBSTONE_TRIGGER}'
        AND trigger_state.tgtype = 7
        AND trigger_state.tgenabled = 'A'
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgqual IS NULL
        AND trigger_state.tgnargs = 0)
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid = to_regprocedure('${REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  const challengeTombstoneVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(
      language.lanname = 'plpgsql'
      AND function_state.prokind = 'f'
      AND function_state.provolatile = 'v'
      AND function_state.proparallel = 'u'
      AND NOT function_state.prosecdef
      AND NOT function_state.proleakproof
      AND NOT function_state.proisstrict
      AND NOT function_state.proretset
      AND function_state.pronargs = 0
      AND function_state.pronargdefaults = 0
      AND pg_catalog.pg_get_function_result(function_state.oid) = 'trigger'
      AND function_state.proconfig = ARRAY[
        'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
      ]::text[]
      AND function_state.prosrc = $expected_challenge_tombstone_body$${CHALLENGE_REVOCATION_TOMBSTONE_BODY}$expected_challenge_tombstone_body$
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS denied_function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(denied_function.proacl, pg_catalog.acldefault('f', denied_function.proowner))
      ) AS acl
      WHERE denied_function.oid =
          to_regprocedure('${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}')
        AND acl.grantee <> denied_function.proowner
    )
    AND (SELECT pg_catalog.count(*) = 1
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid = pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', pg_catalog.current_schema(), 'wallet_ownership_challenges')
        )
        AND trigger_state.tgfoid =
          to_regprocedure('${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}')
        AND trigger_state.tgname = '${CHALLENGE_REVOCATION_TOMBSTONE_TRIGGER}'
        AND trigger_state.tgtype = 19
        AND trigger_state.tgenabled = 'A'
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgqual IS NULL
        AND trigger_state.tgnargs = 0
        AND (
          SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY selected.ordinality)
          FROM pg_catalog.unnest(trigger_state.tgattr::smallint[])
            WITH ORDINALITY AS selected(attnum, ordinality)
          INNER JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = trigger_state.tgrelid
            AND attribute.attnum = selected.attnum
        ) = ARRAY['status']::text[]
        AND pg_catalog.strpos(
          pg_catalog.pg_get_triggerdef(trigger_state.oid, false),
          'BEFORE UPDATE OF status ON'
        ) > 0)
  ) AS valid
  FROM pg_catalog.pg_proc AS function_state
  INNER JOIN pg_catalog.pg_namespace AS namespace_state
    ON namespace_state.oid = function_state.pronamespace
  INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
  WHERE namespace_state.nspname = pg_catalog.current_schema()
    AND function_state.oid =
      to_regprocedure('${CHALLENGE_REVOCATION_TOMBSTONE_FUNCTION_IDENTITY}')
    ${ownerVerification}`;

  const revokedIndexVerifier = `SELECT (
    pg_catalog.count(*) = 1
    AND pg_catalog.bool_and(index_state.indisvalid)
    AND pg_catalog.bool_and(index_state.indisready)
    AND pg_catalog.bool_and(NOT index_state.indisunique)
    AND pg_catalog.bool_and(index_state.indnkeyatts = 6)
    AND pg_catalog.bool_and(index_state.indoption::text = '0 0 0 0 3 0')
    AND pg_catalog.bool_and(
      pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, false) =
        '(status = ''REVOKED''::text)'
    )
    AND pg_catalog.bool_and((
      SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY selected.ordinality)
      FROM pg_catalog.unnest(index_state.indkey::smallint[])
        WITH ORDINALITY AS selected(attnum, ordinality)
      INNER JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = index_state.indrelid
        AND attribute.attnum = selected.attnum
    ) = ARRAY[
      'chain_namespace',
      'chain_reference',
      'address_digest_version',
      'address_digest',
      'revoked_at',
      'wallet_id'
    ]::text[])
  ) AS valid
  FROM pg_catalog.pg_index AS index_state
  INNER JOIN pg_catalog.pg_class AS index_table ON index_table.oid = index_state.indexrelid
  INNER JOIN pg_catalog.pg_class AS indexed_table ON indexed_table.oid = index_state.indrelid
  WHERE index_table.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
    AND index_table.relname = '${REVOKED_WALLET_IDENTITY_INDEX}'
    AND indexed_table.relname = 'registered_wallets'`;

  const constraintVerifier = `SELECT (
    pg_catalog.count(*) = 4
    AND pg_catalog.bool_and(constraint_state.convalidated)
    AND pg_catalog.bool_and(constraint_state.contype = 'c')
    AND pg_catalog.bool_and(
      (
        constraint_state.conname = 'wallet_ownership_challenge_failure_reason_check'
        AND constraint_state.conrelid = pg_catalog.to_regclass(
          pg_catalog.format('%I.%I', pg_catalog.current_schema(), 'wallet_ownership_challenges')
        )
      )
      OR (
        constraint_state.conname IN (
          'wallet_registration_audit_event_check',
          'wallet_registration_audit_reason_check',
          'wallet_registration_audit_shape_check'
        )
        AND constraint_state.conrelid = pg_catalog.to_regclass(
          pg_catalog.format(
            '%I.%I',
            pg_catalog.current_schema(),
            'wallet_registration_audit_events'
          )
        )
      )
    )
    AND pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.string_agg(
            constraint_state.conname || pg_catalog.chr(31)
              || pg_catalog.pg_get_constraintdef(constraint_state.oid, false),
            pg_catalog.chr(30) ORDER BY constraint_state.conname
          ),
          'UTF8'
        )
      ),
      'hex'
    ) = '${REVOCATION_CONSTRAINT_DEFINITION_SHA256}'
  ) AS valid
  FROM pg_catalog.pg_constraint AS constraint_state
  WHERE constraint_state.connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
    AND constraint_state.conname IN (
      'wallet_ownership_challenge_failure_reason_check',
      'wallet_registration_audit_event_check',
      'wallet_registration_audit_reason_check',
      'wallet_registration_audit_shape_check'
    )`;

  const registrationStateVerifier = `SELECT ${REVOCATION_STATE_VERIFIER_FUNCTION_IDENTITY} AS valid`;

  return `SELECT (
      prior.valid
      AND state_function.valid
      AND revoke_function.valid
      AND guarded_completion.valid
      AND lifecycle.valid
      AND tombstone.valid
      AND challenge_tombstone.valid
      AND revoked_index.valid
      AND constraints.valid
      AND registration_state.valid
    ) AS valid
    FROM (${priorVerifier}) AS prior
    CROSS JOIN (${stateFunctionVerifier}) AS state_function
    CROSS JOIN (${revokeVerifier}) AS revoke_function
    CROSS JOIN (${guardedCompletionVerifier}) AS guarded_completion
    CROSS JOIN (${lifecycleVerifier}) AS lifecycle
    CROSS JOIN (${tombstoneVerifier}) AS tombstone
    CROSS JOIN (${challengeTombstoneVerifier}) AS challenge_tombstone
    CROSS JOIN (${revokedIndexVerifier}) AS revoked_index
    CROSS JOIN (${constraintVerifier}) AS constraints
    CROSS JOIN (${registrationStateVerifier}) AS registration_state`;
}

export function createWalletRegistrationRevocationMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0016',
    description: 'add account-scoped audited wallet registration revocation',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0015'],
  };
}

export const createWalletRegistrationRevocationMigrationV0016 =
  createWalletRegistrationRevocationMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createWalletRegistrationRevocationTestSchemaMigrationV0016 =
  createWalletRegistrationRevocationMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
