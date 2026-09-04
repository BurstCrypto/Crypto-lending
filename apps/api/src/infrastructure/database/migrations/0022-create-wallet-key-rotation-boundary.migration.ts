import { createHash } from 'node:crypto';

import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createStablecoinPriceEvidenceReadModelMigration } from './0021-create-stablecoin-price-evidence-read-model.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const BEGIN_ROTATABLE =
  'begin_wallet_ownership_challenge_rotatable(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid,smallint[],text[])';
const COMPLETE_ROTATABLE =
  'complete_wallet_registration_rotatable(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)';
const LIST_ROTATABLE = 'list_active_wallet_registrations_rotatable(uuid)';
const POLICY_GUARD = 'reject_wallet_identity_key_policy_mutation()';
const CHALLENGE_ALIAS_GUARD = 'reject_wallet_challenge_identity_digest_mutation()';
const WALLET_ALIAS_GUARD = 'enforce_wallet_identity_digest_lifecycle()';
const WALLET_INSERT_GUARD = 'enforce_registered_wallet_identity_digest_set()';
const WALLET_ALIAS_SYNC = 'synchronize_registered_wallet_identity_digests()';
const TABLES = Object.freeze([
  'wallet_identity_key_policy',
  'wallet_ownership_challenge_identity_digests',
  'registered_wallet_identity_digests',
] as const);
const POLICY_MANIFEST =
  'crypto-lending:wallet-key-rotation:v1;policy=identity-hmac;initial-active=1;accepted=1;runtime-mutation=denied';
const CHALLENGE_ALIAS_MANIFEST =
  'crypto-lending:wallet-key-rotation:v1;challenge-aliases=append-only;max-versions=3';
const WALLET_ALIAS_MANIFEST =
  'crypto-lending:wallet-key-rotation:v1;wallet-aliases=active-to-revoked;max-versions=3';

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

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0022 verifier anchor must occur exactly once');
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

const POLICY_MUTATION_BODY = `
    BEGIN
      RAISE EXCEPTION 'wallet identity key policy is migration-owned and immutable'
        USING ERRCODE = '55000';
    END;
    `;

const CHALLENGE_ALIAS_MUTATION_BODY = `
    BEGIN
      RAISE EXCEPTION 'wallet challenge identity digest history is append-only'
        USING ERRCODE = '55000';
    END;
    `;

const WALLET_ALIAS_LIFECYCLE_BODY = `
    DECLARE
      parent_wallet registered_wallets%ROWTYPE;
    BEGIN
      IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'wallet identity digest history cannot be removed'
          USING ERRCODE = '55000';
      END IF;

      SELECT wallet.*
      INTO parent_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = OLD.wallet_id;

      IF NOT FOUND
        OR OLD.status <> 'ACTIVE'
        OR NEW.status <> 'REVOKED'
        OR OLD.revoked_at IS NOT NULL
        OR NEW.revoked_at IS NULL
        OR parent_wallet.status <> 'REVOKED'
        OR parent_wallet.revoked_at IS DISTINCT FROM NEW.revoked_at
        OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
        OR NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.chain_namespace IS DISTINCT FROM OLD.chain_namespace
        OR NEW.chain_reference IS DISTINCT FROM OLD.chain_reference
        OR NEW.address_digest_version IS DISTINCT FROM OLD.address_digest_version
        OR NEW.address_digest IS DISTINCT FROM OLD.address_digest
        OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
      THEN
        RAISE EXCEPTION 'invalid wallet identity digest lifecycle transition'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    `;

const WALLET_INSERT_GUARD_BODY = `
    DECLARE
      policy wallet_identity_key_policy%ROWTYPE;
      challenge_versions smallint[];
      active_alias_digest bytea;
    BEGIN
      SELECT key_policy.*
      INTO STRICT policy
      FROM wallet_identity_key_policy AS key_policy
      WHERE key_policy.policy_name = 'wallet-registration-identity-hmac';

      SELECT pg_catalog.array_agg(alias.address_digest_version ORDER BY alias.address_digest_version),
             (pg_catalog.array_agg(alias.address_digest)
               FILTER (WHERE alias.address_digest_version = policy.active_write_version))[1]
      INTO challenge_versions, active_alias_digest
      FROM wallet_ownership_challenge_identity_digests AS alias
      WHERE alias.challenge_id = NEW.registered_by_challenge_id
        AND alias.account_id = NEW.account_id
        AND alias.chain_namespace = NEW.chain_namespace
        AND alias.chain_reference = NEW.chain_reference;

      IF challenge_versions IS DISTINCT FROM policy.accepted_read_versions
        OR NEW.address_digest_version <> policy.active_write_version
        OR active_alias_digest IS DISTINCT FROM NEW.address_digest
      THEN
        RAISE EXCEPTION 'wallet registration identity digest set is not admitted'
          USING ERRCODE = '55000';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM wallet_ownership_challenge_identity_digests AS candidate
        INNER JOIN registered_wallet_identity_digests AS existing
          ON existing.chain_namespace = candidate.chain_namespace
          AND existing.chain_reference = candidate.chain_reference
          AND existing.address_digest_version = candidate.address_digest_version
          AND existing.address_digest = candidate.address_digest
          AND existing.status = 'ACTIVE'
        WHERE candidate.challenge_id = NEW.registered_by_challenge_id
      ) THEN
        RAISE EXCEPTION 'wallet identity digest is already active'
          USING ERRCODE = '23505';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM wallet_ownership_challenge_identity_digests AS candidate
        INNER JOIN registered_wallet_identity_digests AS tombstone
          ON tombstone.chain_namespace = candidate.chain_namespace
          AND tombstone.chain_reference = candidate.chain_reference
          AND tombstone.address_digest_version = candidate.address_digest_version
          AND tombstone.address_digest = candidate.address_digest
          AND tombstone.status = 'REVOKED'
        INNER JOIN wallet_ownership_challenges AS challenge
          ON challenge.challenge_id = candidate.challenge_id
        WHERE candidate.challenge_id = NEW.registered_by_challenge_id
          AND challenge.created_at <= tombstone.revoked_at
      ) THEN
        RAISE EXCEPTION 'wallet ownership proof predates an identity-alias revocation'
          USING ERRCODE = 'W1601';
      END IF;
      RETURN NEW;
    END;
    `;

const WALLET_ALIAS_SYNC_BODY = `
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO registered_wallet_identity_digests (
          wallet_id,
          account_id,
          chain_namespace,
          chain_reference,
          address_digest_version,
          address_digest,
          status,
          registered_at,
          revoked_at
        )
        SELECT
          NEW.wallet_id,
          NEW.account_id,
          NEW.chain_namespace,
          NEW.chain_reference,
          alias.address_digest_version,
          alias.address_digest,
          NEW.status,
          NEW.registered_at,
          NEW.revoked_at
        FROM wallet_ownership_challenge_identity_digests AS alias
        WHERE alias.challenge_id = NEW.registered_by_challenge_id
        ORDER BY alias.address_digest_version;
        RETURN NEW;
      END IF;

      IF OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED' THEN
        UPDATE registered_wallet_identity_digests AS alias
        SET status = 'REVOKED', revoked_at = NEW.revoked_at
        WHERE alias.wallet_id = NEW.wallet_id
          AND alias.status = 'ACTIVE';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'wallet identity digest aliases are missing'
            USING ERRCODE = '55000';
        END IF;
      END IF;
      RETURN NEW;
    END;
    `;

const BEGIN_ROTATABLE_BODY = `
    DECLARE
      policy wallet_identity_key_policy%ROWTYPE;
      alias_index integer;
      decoded_digest bytea;
      created_challenge_id uuid;
      created_expires_at timestamptz;
    BEGIN
      SELECT key_policy.*
      INTO STRICT policy
      FROM wallet_identity_key_policy AS key_policy
      WHERE key_policy.policy_name = 'wallet-registration-identity-hmac';

      IF requested_identity_digest_versions IS NULL
        OR requested_identity_digests_hex IS NULL
        OR pg_catalog.array_lower(requested_identity_digest_versions, 1) <> 1
        OR pg_catalog.array_lower(requested_identity_digests_hex, 1) <> 1
        OR pg_catalog.cardinality(requested_identity_digest_versions)
          <> pg_catalog.cardinality(requested_identity_digests_hex)
        OR requested_identity_digest_versions IS DISTINCT FROM policy.accepted_read_versions
        OR requested_address_digest_version <> policy.active_write_version
        OR pg_catalog.array_position(requested_identity_digest_versions, NULL) IS NOT NULL
        OR pg_catalog.array_position(requested_identity_digests_hex, NULL) IS NOT NULL
      THEN
        RAISE EXCEPTION 'wallet identity key policy mismatch' USING ERRCODE = '55000';
      END IF;

      FOR alias_index IN 1..pg_catalog.cardinality(requested_identity_digest_versions) LOOP
        IF requested_identity_digests_hex[alias_index] !~ '^[0-9a-f]{64}$' THEN
          RAISE EXCEPTION 'invalid wallet identity digest alias' USING ERRCODE = '22023';
        END IF;
        decoded_digest := pg_catalog.decode(requested_identity_digests_hex[alias_index], 'hex');
        IF EXISTS (
          SELECT 1
          FROM pg_catalog.generate_series(1, alias_index - 1) AS prior(prior_index)
          WHERE requested_identity_digests_hex[prior.prior_index]
            = requested_identity_digests_hex[alias_index]
        ) THEN
          RAISE EXCEPTION 'duplicate wallet identity digest alias' USING ERRCODE = '22023';
        END IF;
        IF requested_identity_digest_versions[alias_index] = policy.active_write_version
          AND decoded_digest IS DISTINCT FROM requested_address_digest
        THEN
          RAISE EXCEPTION 'active wallet identity digest mismatch' USING ERRCODE = '22023';
        END IF;
      END LOOP;

      SELECT begun.challenge_id, begun.expires_at
      INTO STRICT created_challenge_id, created_expires_at
      FROM begin_wallet_ownership_challenge(
        requested_challenge_id,
        requested_account_id,
        requested_proof_scheme,
        requested_chain_namespace,
        requested_chain_reference,
        requested_registry_environment,
        requested_registry_version,
        requested_registry_fingerprint_sha256,
        requested_challenge_payload_key_version,
        requested_challenge_payload_ciphertext,
        requested_challenge_payload_iv,
        requested_challenge_payload_auth_tag,
        requested_address_digest_version,
        requested_address_digest,
        requested_domain_digest_version,
        requested_domain_digest,
        requested_message_digest_version,
        requested_message_digest,
        requested_nonce_digest_version,
        requested_nonce_digest,
        requested_issued_at,
        requested_expires_at,
        requested_correlation_id
      ) AS begun;

      INSERT INTO wallet_ownership_challenge_identity_digests (
        challenge_id,
        account_id,
        chain_namespace,
        chain_reference,
        address_digest_version,
        address_digest
      )
      SELECT
        created_challenge_id,
        requested_account_id,
        requested_chain_namespace,
        requested_chain_reference,
        requested_identity_digest_versions[entry.alias_index],
        pg_catalog.decode(requested_identity_digests_hex[entry.alias_index], 'hex')
      FROM pg_catalog.generate_series(
        1,
        pg_catalog.cardinality(requested_identity_digest_versions)
      ) AS entry(alias_index)
      ORDER BY entry.alias_index;

      RETURN QUERY SELECT created_challenge_id, created_expires_at;
    END;
    `;

const LIST_ROTATABLE_BODY = `
    DECLARE
      expected_count bigint;
      returned_count bigint;
    BEGIN
      SELECT pg_catalog.count(*)
      INTO STRICT expected_count
      FROM registered_wallets AS wallet
      WHERE wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE';

      IF expected_count > 32 THEN
        RAISE EXCEPTION 'active wallet registration capacity invariant failed'
          USING ERRCODE = '55000';
      END IF;

      RETURN QUERY
      SELECT
        wallet.active_wallet_id,
        wallet.active_account_id,
        wallet.active_registered_by_challenge_id,
        wallet.active_chain_namespace,
        wallet.active_chain_reference,
        wallet.active_registry_environment,
        wallet.active_registry_version,
        wallet.active_registry_fingerprint_sha256,
        wallet.active_address_digest_version,
        wallet.active_address_digest,
        alias.address_digest_version AS active_verification_digest_version,
        alias.address_digest AS active_verification_digest,
        wallet.active_address_key_version,
        wallet.active_address_ciphertext,
        wallet.active_address_iv,
        wallet.active_address_auth_tag,
        wallet.active_registered_at
      FROM list_active_wallet_registrations(requested_account_id) AS wallet
      INNER JOIN wallet_identity_key_policy AS policy
        ON policy.policy_name = 'wallet-registration-identity-hmac'
      INNER JOIN registered_wallet_identity_digests AS alias
        ON alias.wallet_id = wallet.active_wallet_id
        AND alias.account_id = wallet.active_account_id
        AND alias.chain_namespace = wallet.active_chain_namespace
        AND alias.chain_reference = wallet.active_chain_reference
        AND alias.address_digest_version = policy.active_write_version
        AND alias.status = 'ACTIVE'
      ORDER BY wallet.active_registered_at DESC, wallet.active_wallet_id;

      GET DIAGNOSTICS returned_count = ROW_COUNT;
      IF returned_count <> expected_count THEN
        RAISE EXCEPTION 'active wallet verification alias coverage is incomplete'
          USING ERRCODE = '55000';
      END IF;
    END;
    `;

const COMPLETE_ROTATABLE_BODY = `
    DECLARE
      ownership_challenge wallet_ownership_challenges%ROWTYPE;
      policy wallet_identity_key_policy%ROWTYPE;
      challenge_versions smallint[];
      active_alias_digest bytea;
      candidate_alias record;
      matched_wallet_id uuid;
      active_wallet registered_wallets%ROWTYPE;
      recorded_at timestamptz;
    BEGIN
      IF requested_challenge_id IS NULL OR requested_account_id IS NULL THEN
        RAISE EXCEPTION 'invalid rotatable wallet registration completion'
          USING ERRCODE = '22023';
      END IF;

      SELECT challenge.*
      INTO ownership_challenge
      FROM wallet_ownership_challenges AS challenge
      WHERE challenge.challenge_id = requested_challenge_id
        AND challenge.account_id = requested_account_id
      FOR UPDATE;

      recorded_at := pg_catalog.clock_timestamp();
      IF FOUND
        AND ownership_challenge.status = 'PENDING'
        AND recorded_at < ownership_challenge.expires_at
      THEN
        SELECT key_policy.*
        INTO STRICT policy
        FROM wallet_identity_key_policy AS key_policy
        WHERE key_policy.policy_name = 'wallet-registration-identity-hmac';

        SELECT pg_catalog.array_agg(alias.address_digest_version ORDER BY alias.address_digest_version),
               (pg_catalog.array_agg(alias.address_digest)
                 FILTER (WHERE alias.address_digest_version = policy.active_write_version))[1]
        INTO challenge_versions, active_alias_digest
        FROM wallet_ownership_challenge_identity_digests AS alias
        WHERE alias.challenge_id = ownership_challenge.challenge_id
          AND alias.account_id = ownership_challenge.account_id
          AND alias.chain_namespace = ownership_challenge.chain_namespace
          AND alias.chain_reference = ownership_challenge.chain_reference;

        IF challenge_versions IS DISTINCT FROM policy.accepted_read_versions
          OR ownership_challenge.address_digest_version <> policy.active_write_version
          OR active_alias_digest IS DISTINCT FROM ownership_challenge.address_digest
        THEN
          RAISE EXCEPTION 'wallet challenge identity digest set is not admitted'
            USING ERRCODE = '55000';
        END IF;

        FOR candidate_alias IN
          SELECT alias.address_digest_version, alias.address_digest
          FROM wallet_ownership_challenge_identity_digests AS alias
          WHERE alias.challenge_id = ownership_challenge.challenge_id
          ORDER BY alias.address_digest_version
        LOOP
          PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
              ownership_challenge.chain_namespace || ':'
                || ownership_challenge.chain_reference || ':'
                || candidate_alias.address_digest_version::text || ':'
                || pg_catalog.encode(candidate_alias.address_digest, 'hex'),
              56002
            )
          );
        END LOOP;

        recorded_at := pg_catalog.clock_timestamp();
        IF recorded_at < ownership_challenge.expires_at AND EXISTS (
          SELECT 1
          FROM wallet_ownership_challenge_identity_digests AS candidate
          INNER JOIN registered_wallet_identity_digests AS tombstone
            ON tombstone.chain_namespace = candidate.chain_namespace
            AND tombstone.chain_reference = candidate.chain_reference
            AND tombstone.address_digest_version = candidate.address_digest_version
            AND tombstone.address_digest = candidate.address_digest
            AND tombstone.status = 'REVOKED'
          WHERE candidate.challenge_id = ownership_challenge.challenge_id
            AND ownership_challenge.created_at <= tombstone.revoked_at
        ) THEN
          UPDATE wallet_ownership_challenges AS challenge
          SET status = 'REJECTED', completed_at = recorded_at,
              failure_reason = 'WALLET_REVOKED',
              challenge_payload_key_version = NULL,
              challenge_payload_ciphertext = NULL,
              challenge_payload_iv = NULL,
              challenge_payload_auth_tag = NULL,
              payload_destroyed_at = recorded_at
          WHERE challenge.challenge_id = ownership_challenge.challenge_id;

          INSERT INTO wallet_registration_audit_events (
            event_type, outcome, reason_code, challenge_id,
            account_id, correlation_id, occurred_at
          ) VALUES (
            'CHALLENGE_REJECTED', 'REJECTED', 'WALLET_REVOKED',
            ownership_challenge.challenge_id, requested_account_id,
            requested_correlation_id, recorded_at
          );
          RETURN QUERY SELECT 'REVOKED'::text, NULL::uuid, NULL::timestamptz;
          RETURN;
        END IF;

        SELECT alias.wallet_id
        INTO matched_wallet_id
        FROM wallet_ownership_challenge_identity_digests AS candidate
        INNER JOIN registered_wallet_identity_digests AS alias
          ON alias.chain_namespace = candidate.chain_namespace
          AND alias.chain_reference = candidate.chain_reference
          AND alias.address_digest_version = candidate.address_digest_version
          AND alias.address_digest = candidate.address_digest
          AND alias.status = 'ACTIVE'
        WHERE candidate.challenge_id = ownership_challenge.challenge_id
        ORDER BY alias.wallet_id
        LIMIT 1;

        IF FOUND THEN
          IF EXISTS (
            SELECT 1
            FROM wallet_ownership_challenge_identity_digests AS candidate
            INNER JOIN registered_wallet_identity_digests AS alias
              ON alias.chain_namespace = candidate.chain_namespace
              AND alias.chain_reference = candidate.chain_reference
              AND alias.address_digest_version = candidate.address_digest_version
              AND alias.address_digest = candidate.address_digest
              AND alias.status = 'ACTIVE'
            WHERE candidate.challenge_id = ownership_challenge.challenge_id
              AND alias.wallet_id <> matched_wallet_id
          ) THEN
            RAISE EXCEPTION 'wallet identity aliases resolve to multiple active wallets'
              USING ERRCODE = '55000';
          END IF;

          SELECT wallet.*
          INTO STRICT active_wallet
          FROM registered_wallets AS wallet
          WHERE wallet.wallet_id = matched_wallet_id
            AND wallet.status = 'ACTIVE'
          FOR UPDATE;

          recorded_at := pg_catalog.clock_timestamp();
          IF recorded_at < ownership_challenge.expires_at THEN
            IF active_wallet.account_id IS DISTINCT FROM requested_account_id THEN
              UPDATE wallet_ownership_challenges AS challenge
              SET status = 'REJECTED', completed_at = recorded_at,
                  failure_reason = 'OWNERSHIP_CONFLICT',
                  challenge_payload_key_version = NULL,
                  challenge_payload_ciphertext = NULL,
                  challenge_payload_iv = NULL,
                  challenge_payload_auth_tag = NULL,
                  payload_destroyed_at = recorded_at
              WHERE challenge.challenge_id = ownership_challenge.challenge_id;
              INSERT INTO wallet_registration_audit_events (
                event_type, outcome, reason_code, challenge_id,
                account_id, correlation_id, occurred_at
              ) VALUES (
                'CHALLENGE_REJECTED', 'REJECTED', 'OWNERSHIP_CONFLICT',
                ownership_challenge.challenge_id, requested_account_id,
                requested_correlation_id, recorded_at
              );
              RETURN QUERY SELECT
                'OWNERSHIP_CONFLICT'::text, NULL::uuid, NULL::timestamptz;
              RETURN;
            END IF;

            INSERT INTO registered_wallet_identity_digests (
              wallet_id, account_id, chain_namespace, chain_reference,
              address_digest_version, address_digest, status,
              registered_at, revoked_at
            )
            SELECT
              active_wallet.wallet_id,
              active_wallet.account_id,
              active_wallet.chain_namespace,
              active_wallet.chain_reference,
              candidate.address_digest_version,
              candidate.address_digest,
              'ACTIVE',
              active_wallet.registered_at,
              NULL::timestamptz
            FROM wallet_ownership_challenge_identity_digests AS candidate
            WHERE candidate.challenge_id = ownership_challenge.challenge_id
              AND NOT EXISTS (
                SELECT 1
                FROM registered_wallet_identity_digests AS existing
                WHERE existing.wallet_id = active_wallet.wallet_id
                  AND existing.address_digest_version = candidate.address_digest_version
                  AND existing.address_digest = candidate.address_digest
                  AND existing.status = 'ACTIVE'
              )
            ORDER BY candidate.address_digest_version;

            IF EXISTS (
              SELECT 1
              FROM wallet_ownership_challenge_identity_digests AS candidate
              LEFT JOIN registered_wallet_identity_digests AS admitted
                ON admitted.wallet_id = active_wallet.wallet_id
                AND admitted.account_id = active_wallet.account_id
                AND admitted.chain_namespace = candidate.chain_namespace
                AND admitted.chain_reference = candidate.chain_reference
                AND admitted.address_digest_version = candidate.address_digest_version
                AND admitted.address_digest = candidate.address_digest
                AND admitted.status = 'ACTIVE'
              WHERE candidate.challenge_id = ownership_challenge.challenge_id
                AND admitted.wallet_id IS NULL
            ) THEN
              RAISE EXCEPTION 'wallet identity alias backfill is incomplete'
                USING ERRCODE = '55000';
            END IF;

            UPDATE wallet_ownership_challenges AS challenge
            SET status = 'REGISTERED', completed_at = recorded_at,
                challenge_payload_key_version = NULL,
                challenge_payload_ciphertext = NULL,
                challenge_payload_iv = NULL,
                challenge_payload_auth_tag = NULL,
                payload_destroyed_at = recorded_at
            WHERE challenge.challenge_id = ownership_challenge.challenge_id;
            INSERT INTO wallet_registration_audit_events (
              event_type, outcome, reason_code, challenge_id, wallet_id,
              account_id, correlation_id, occurred_at
            ) VALUES (
              'WALLET_ALREADY_REGISTERED', 'SUCCEEDED', 'NONE',
              ownership_challenge.challenge_id, active_wallet.wallet_id,
              requested_account_id, requested_correlation_id, recorded_at
            );
            RETURN QUERY SELECT
              'ALREADY_REGISTERED'::text,
              active_wallet.wallet_id,
              active_wallet.registered_at;
            RETURN;
          END IF;
        END IF;
      END IF;

      RETURN QUERY
      SELECT completed.registration_outcome, completed.wallet_id, completed.registered_at
      FROM complete_wallet_registration_guarded(
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

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  return `DO $require_single_wallet_identity_version$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM wallet_ownership_challenges WHERE address_digest_version <> 1
      ) OR EXISTS (
        SELECT 1 FROM registered_wallets WHERE address_digest_version <> 1
      ) THEN
        RAISE EXCEPTION 'wallet identity version migration requires audited digest backfill'
          USING ERRCODE = '55000';
      END IF;
    END;
    $require_single_wallet_identity_version$;

    CREATE TABLE wallet_identity_key_policy (
      policy_name text PRIMARY KEY,
      schema_version smallint NOT NULL,
      active_write_version smallint NOT NULL,
      accepted_read_versions smallint[] NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      CONSTRAINT wallet_identity_key_policy_name_check CHECK (
        policy_name = 'wallet-registration-identity-hmac'
      ),
      CONSTRAINT wallet_identity_key_policy_schema_check CHECK (schema_version = 1),
      CONSTRAINT wallet_identity_key_policy_versions_check CHECK (
        pg_catalog.array_ndims(accepted_read_versions) = 1
        AND pg_catalog.array_lower(accepted_read_versions, 1) = 1
        AND pg_catalog.cardinality(accepted_read_versions) BETWEEN 1 AND 3
        AND accepted_read_versions[1] > 0
        AND (pg_catalog.cardinality(accepted_read_versions) < 2
          OR accepted_read_versions[2] > accepted_read_versions[1])
        AND (pg_catalog.cardinality(accepted_read_versions) < 3
          OR accepted_read_versions[3] > accepted_read_versions[2])
        AND active_write_version = accepted_read_versions[
          pg_catalog.cardinality(accepted_read_versions)
        ]
      )
    );
    INSERT INTO wallet_identity_key_policy (
      policy_name, schema_version, active_write_version, accepted_read_versions
    ) VALUES (
      'wallet-registration-identity-hmac', 1, 1, ARRAY[1]::smallint[]
    );

    CREATE TABLE wallet_ownership_challenge_identity_digests (
      challenge_id uuid NOT NULL,
      account_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      address_digest_version smallint NOT NULL,
      address_digest bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      CONSTRAINT wallet_challenge_identity_digest_pk PRIMARY KEY (
        challenge_id, address_digest_version
      ),
      CONSTRAINT wallet_challenge_identity_digest_challenge_fk FOREIGN KEY (challenge_id)
        REFERENCES wallet_ownership_challenges (challenge_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_challenge_identity_digest_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_challenge_identity_digest_shape_check CHECK (
        address_digest_version > 0
        AND pg_catalog.octet_length(address_digest) = 32
        AND chain_namespace IN ('eip155', 'solana')
        AND pg_catalog.octet_length(chain_reference) BETWEEN 1 AND 64
      )
    );
    CREATE INDEX wallet_challenge_identity_digest_lookup_idx
      ON wallet_ownership_challenge_identity_digests (
        chain_namespace, chain_reference, address_digest_version, address_digest, challenge_id
      );

    CREATE TABLE registered_wallet_identity_digests (
      wallet_id uuid NOT NULL,
      account_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      address_digest_version smallint NOT NULL,
      address_digest bytea NOT NULL,
      status text NOT NULL,
      registered_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CONSTRAINT registered_wallet_identity_digest_pk PRIMARY KEY (
        wallet_id, address_digest_version
      ),
      CONSTRAINT registered_wallet_identity_digest_wallet_fk FOREIGN KEY (wallet_id)
        REFERENCES registered_wallets (wallet_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT registered_wallet_identity_digest_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT registered_wallet_identity_digest_shape_check CHECK (
        address_digest_version > 0
        AND pg_catalog.octet_length(address_digest) = 32
        AND chain_namespace IN ('eip155', 'solana')
        AND pg_catalog.octet_length(chain_reference) BETWEEN 1 AND 64
      ),
      CONSTRAINT registered_wallet_identity_digest_lifecycle_check CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= registered_at)
      )
    );
    CREATE UNIQUE INDEX registered_wallet_identity_digest_one_active
      ON registered_wallet_identity_digests (
        chain_namespace, chain_reference, address_digest_version, address_digest
      ) WHERE status = 'ACTIVE';
    CREATE INDEX registered_wallet_identity_digest_revoked_timeline
      ON registered_wallet_identity_digests (
        chain_namespace, chain_reference, address_digest_version,
        address_digest, revoked_at DESC, wallet_id
      ) WHERE status = 'REVOKED';

    COMMENT ON TABLE wallet_identity_key_policy IS '${POLICY_MANIFEST}';
    COMMENT ON TABLE wallet_ownership_challenge_identity_digests
      IS '${CHALLENGE_ALIAS_MANIFEST}';
    COMMENT ON TABLE registered_wallet_identity_digests IS '${WALLET_ALIAS_MANIFEST}';

    INSERT INTO wallet_ownership_challenge_identity_digests (
      challenge_id, account_id, chain_namespace, chain_reference,
      address_digest_version, address_digest, created_at
    )
    SELECT challenge_id, account_id, chain_namespace, chain_reference,
           address_digest_version, address_digest, created_at
    FROM wallet_ownership_challenges;

    INSERT INTO registered_wallet_identity_digests (
      wallet_id, account_id, chain_namespace, chain_reference,
      address_digest_version, address_digest, status, registered_at, revoked_at
    )
    SELECT wallet_id, account_id, chain_namespace, chain_reference,
           address_digest_version, address_digest, status, registered_at, revoked_at
    FROM registered_wallets;

    CREATE FUNCTION ${POLICY_GUARD} RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog
    AS $function$${POLICY_MUTATION_BODY}$function$;
    CREATE FUNCTION ${CHALLENGE_ALIAS_GUARD} RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog
    AS $function$${CHALLENGE_ALIAS_MUTATION_BODY}$function$;
    CREATE FUNCTION ${WALLET_ALIAS_GUARD} RETURNS trigger
    LANGUAGE plpgsql
    AS $function$${WALLET_ALIAS_LIFECYCLE_BODY}$function$;
    CREATE FUNCTION ${WALLET_INSERT_GUARD} RETURNS trigger
    LANGUAGE plpgsql
    AS $function$${WALLET_INSERT_GUARD_BODY}$function$;
    CREATE FUNCTION ${WALLET_ALIAS_SYNC} RETURNS trigger
    LANGUAGE plpgsql
    AS $function$${WALLET_ALIAS_SYNC_BODY}$function$;

    CREATE TRIGGER wallet_identity_key_policy_immutable_row
      BEFORE UPDATE OR DELETE ON wallet_identity_key_policy
      FOR EACH ROW EXECUTE FUNCTION ${POLICY_GUARD};
    CREATE TRIGGER wallet_identity_key_policy_immutable_truncate
      BEFORE TRUNCATE ON wallet_identity_key_policy
      FOR EACH STATEMENT EXECUTE FUNCTION ${POLICY_GUARD};
    CREATE TRIGGER wallet_challenge_identity_digests_immutable_row
      BEFORE UPDATE OR DELETE ON wallet_ownership_challenge_identity_digests
      FOR EACH ROW EXECUTE FUNCTION ${CHALLENGE_ALIAS_GUARD};
    CREATE TRIGGER wallet_challenge_identity_digests_immutable_truncate
      BEFORE TRUNCATE ON wallet_ownership_challenge_identity_digests
      FOR EACH STATEMENT EXECUTE FUNCTION ${CHALLENGE_ALIAS_GUARD};
    CREATE TRIGGER registered_wallet_identity_digests_lifecycle_row
      BEFORE UPDATE OR DELETE ON registered_wallet_identity_digests
      FOR EACH ROW EXECUTE FUNCTION ${WALLET_ALIAS_GUARD};
    CREATE TRIGGER registered_wallet_identity_digests_immutable_truncate
      BEFORE TRUNCATE ON registered_wallet_identity_digests
      FOR EACH STATEMENT EXECUTE FUNCTION ${WALLET_ALIAS_GUARD};
    CREATE TRIGGER registered_wallet_identity_digest_set_guard
      BEFORE INSERT ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION ${WALLET_INSERT_GUARD};
    CREATE TRIGGER registered_wallet_identity_digest_sync
      AFTER INSERT OR UPDATE OF status ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION ${WALLET_ALIAS_SYNC};

    ALTER TABLE wallet_identity_key_policy
      ENABLE ALWAYS TRIGGER wallet_identity_key_policy_immutable_row;
    ALTER TABLE wallet_identity_key_policy
      ENABLE ALWAYS TRIGGER wallet_identity_key_policy_immutable_truncate;
    ALTER TABLE wallet_ownership_challenge_identity_digests
      ENABLE ALWAYS TRIGGER wallet_challenge_identity_digests_immutable_row;
    ALTER TABLE wallet_ownership_challenge_identity_digests
      ENABLE ALWAYS TRIGGER wallet_challenge_identity_digests_immutable_truncate;
    ALTER TABLE registered_wallet_identity_digests
      ENABLE ALWAYS TRIGGER registered_wallet_identity_digests_lifecycle_row;
    ALTER TABLE registered_wallet_identity_digests
      ENABLE ALWAYS TRIGGER registered_wallet_identity_digests_immutable_truncate;
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_identity_digest_set_guard;
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_identity_digest_sync;

    CREATE FUNCTION begin_wallet_ownership_challenge_rotatable(
      requested_challenge_id uuid,
      requested_account_id uuid,
      requested_proof_scheme text,
      requested_chain_namespace text,
      requested_chain_reference text,
      requested_registry_environment text,
      requested_registry_version integer,
      requested_registry_fingerprint_sha256 text,
      requested_challenge_payload_key_version smallint,
      requested_challenge_payload_ciphertext bytea,
      requested_challenge_payload_iv bytea,
      requested_challenge_payload_auth_tag bytea,
      requested_address_digest_version smallint,
      requested_address_digest bytea,
      requested_domain_digest_version smallint,
      requested_domain_digest bytea,
      requested_message_digest_version smallint,
      requested_message_digest bytea,
      requested_nonce_digest_version smallint,
      requested_nonce_digest bytea,
      requested_issued_at timestamptz,
      requested_expires_at timestamptz,
      requested_correlation_id uuid,
      requested_identity_digest_versions smallint[],
      requested_identity_digests_hex text[]
    ) RETURNS TABLE (challenge_id uuid, expires_at timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${BEGIN_ROTATABLE_BODY}$function$;

    CREATE FUNCTION complete_wallet_registration_rotatable(
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
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${COMPLETE_ROTATABLE_BODY}$function$;

    CREATE FUNCTION list_active_wallet_registrations_rotatable(
      requested_account_id uuid
    ) RETURNS TABLE (
      active_wallet_id uuid,
      active_account_id uuid,
      active_registered_by_challenge_id uuid,
      active_chain_namespace text,
      active_chain_reference text,
      active_registry_environment text,
      active_registry_version integer,
      active_registry_fingerprint_sha256 text,
      active_address_digest_version smallint,
      active_address_digest bytea,
      active_verification_digest_version smallint,
      active_verification_digest bytea,
      active_address_key_version smallint,
      active_address_ciphertext bytea,
      active_address_iv bytea,
      active_address_auth_tag bytea,
      active_registered_at timestamptz
    )
    LANGUAGE plpgsql SECURITY DEFINER STABLE STRICT PARALLEL UNSAFE
    ROWS 33
    AS $function$${LIST_ROTATABLE_BODY}$function$;

    DO $set_wallet_rotation_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${WALLET_ALIAS_GUARD} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${WALLET_INSERT_GUARD} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${WALLET_ALIAS_SYNC} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${BEGIN_ROTATABLE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${COMPLETE_ROTATABLE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${LIST_ROTATABLE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_wallet_rotation_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${POLICY_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${CHALLENGE_ALIAS_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${WALLET_ALIAS_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${WALLET_INSERT_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${WALLET_ALIAS_SYNC}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${BEGIN_ROTATABLE}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${COMPLETE_ROTATABLE}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${LIST_ROTATABLE}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    GRANT EXECUTE ON FUNCTION ${BEGIN_ROTATABLE} TO ${api};
    GRANT EXECUTE ON FUNCTION ${COMPLETE_ROTATABLE} TO ${api};
    GRANT EXECUTE ON FUNCTION ${LIST_ROTATABLE} TO ${api};`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  return `DO $refuse_wallet_identity_rotation_loss$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM wallet_identity_key_policy
        WHERE policy_name = 'wallet-registration-identity-hmac'
          AND schema_version = 1
          AND active_write_version = 1
          AND accepted_read_versions = ARRAY[1]::smallint[]
      ) OR EXISTS (
        SELECT 1
        FROM wallet_ownership_challenges AS challenge
        LEFT JOIN wallet_ownership_challenge_identity_digests AS alias
          ON alias.challenge_id = challenge.challenge_id
          AND alias.account_id = challenge.account_id
          AND alias.chain_namespace = challenge.chain_namespace
          AND alias.chain_reference = challenge.chain_reference
          AND alias.address_digest_version = challenge.address_digest_version
          AND alias.address_digest = challenge.address_digest
        WHERE challenge.address_digest_version <> 1 OR alias.challenge_id IS NULL
      ) OR EXISTS (
        SELECT 1
        FROM wallet_ownership_challenge_identity_digests AS alias
        WHERE alias.address_digest_version <> 1
      ) OR EXISTS (
        SELECT 1
        FROM registered_wallets AS wallet
        LEFT JOIN registered_wallet_identity_digests AS alias
          ON alias.wallet_id = wallet.wallet_id
          AND alias.account_id = wallet.account_id
          AND alias.chain_namespace = wallet.chain_namespace
          AND alias.chain_reference = wallet.chain_reference
          AND alias.address_digest_version = wallet.address_digest_version
          AND alias.address_digest = wallet.address_digest
          AND alias.status = wallet.status
          AND alias.registered_at = wallet.registered_at
          AND alias.revoked_at IS NOT DISTINCT FROM wallet.revoked_at
        WHERE wallet.address_digest_version <> 1 OR alias.wallet_id IS NULL
      ) OR EXISTS (
        SELECT 1 FROM registered_wallet_identity_digests
        WHERE address_digest_version <> 1
      ) THEN
        RAISE EXCEPTION 'cannot roll back wallet identity rotation after multi-version use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_wallet_identity_rotation_loss$;

    REVOKE EXECUTE ON FUNCTION ${BEGIN_ROTATABLE} FROM ${api};
    REVOKE EXECUTE ON FUNCTION ${COMPLETE_ROTATABLE} FROM ${api};
    REVOKE EXECUTE ON FUNCTION ${LIST_ROTATABLE} FROM ${api};
    DROP FUNCTION ${LIST_ROTATABLE};
    DROP FUNCTION ${COMPLETE_ROTATABLE};
    DROP FUNCTION ${BEGIN_ROTATABLE};
    DROP TRIGGER registered_wallet_identity_digest_sync ON registered_wallets;
    DROP TRIGGER registered_wallet_identity_digest_set_guard ON registered_wallets;
    DROP TRIGGER registered_wallet_identity_digests_immutable_truncate
      ON registered_wallet_identity_digests;
    DROP TRIGGER registered_wallet_identity_digests_lifecycle_row
      ON registered_wallet_identity_digests;
    DROP TRIGGER wallet_challenge_identity_digests_immutable_truncate
      ON wallet_ownership_challenge_identity_digests;
    DROP TRIGGER wallet_challenge_identity_digests_immutable_row
      ON wallet_ownership_challenge_identity_digests;
    DROP TRIGGER wallet_identity_key_policy_immutable_truncate
      ON wallet_identity_key_policy;
    DROP TRIGGER wallet_identity_key_policy_immutable_row
      ON wallet_identity_key_policy;
    DROP FUNCTION ${WALLET_ALIAS_SYNC};
    DROP FUNCTION ${WALLET_INSERT_GUARD};
    DROP FUNCTION ${WALLET_ALIAS_GUARD};
    DROP FUNCTION ${CHALLENGE_ALIAS_GUARD};
    DROP FUNCTION ${POLICY_GUARD};
    DROP TABLE registered_wallet_identity_digests;
    DROP TABLE wallet_ownership_challenge_identity_digests;
    DROP TABLE wallet_identity_key_policy;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createStablecoinPriceEvidenceReadModelMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0021 must expose verification SQL');
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
      functionAllowance(api, [
        ...PRIOR_API_FUNCTIONS,
        BEGIN_ROTATABLE,
        COMPLETE_ROTATABLE,
        LIST_ROTATABLE,
      ]),
    );
  }
  const dataShape = cumulative
    ? `SELECT pg_catalog.count(*) = 3
        AND pg_catalog.bool_and(
          pg_catalog.obj_description(relation.oid, 'pg_class') = CASE relation.relname
            WHEN 'wallet_identity_key_policy' THEN '${POLICY_MANIFEST}'
            WHEN 'wallet_ownership_challenge_identity_digests'
              THEN '${CHALLENGE_ALIAS_MANIFEST}'
            WHEN 'registered_wallet_identity_digests' THEN '${WALLET_ALIAS_MANIFEST}'
            ELSE NULL
          END
        ) AS valid
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND relation.relkind = 'r'
        AND relation.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})`
    : `SELECT (
        (SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(policy_name = 'wallet-registration-identity-hmac')
          AND pg_catalog.bool_and(schema_version = 1)
          AND pg_catalog.bool_and(active_write_version = 1)
          AND pg_catalog.bool_and(accepted_read_versions = ARRAY[1]::smallint[])
         FROM wallet_identity_key_policy)
        AND NOT EXISTS (
          SELECT 1
          FROM wallet_ownership_challenges AS challenge
          LEFT JOIN wallet_ownership_challenge_identity_digests AS alias
            ON alias.challenge_id = challenge.challenge_id
            AND alias.account_id = challenge.account_id
            AND alias.chain_namespace = challenge.chain_namespace
            AND alias.chain_reference = challenge.chain_reference
            AND alias.address_digest_version = challenge.address_digest_version
            AND alias.address_digest = challenge.address_digest
          WHERE alias.challenge_id IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM registered_wallets AS wallet
          LEFT JOIN registered_wallet_identity_digests AS alias
            ON alias.wallet_id = wallet.wallet_id
            AND alias.account_id = wallet.account_id
            AND alias.chain_namespace = wallet.chain_namespace
            AND alias.chain_reference = wallet.chain_reference
            AND alias.address_digest_version = wallet.address_digest_version
            AND alias.address_digest = wallet.address_digest
            AND alias.status = wallet.status
            AND alias.registered_at = wallet.registered_at
            AND alias.revoked_at IS NOT DISTINCT FROM wallet.revoked_at
          WHERE alias.wallet_id IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM wallet_ownership_challenge_identity_digests AS alias
          INNER JOIN wallet_ownership_challenges AS challenge
            ON challenge.challenge_id = alias.challenge_id
          WHERE alias.account_id IS DISTINCT FROM challenge.account_id
            OR alias.chain_namespace IS DISTINCT FROM challenge.chain_namespace
            OR alias.chain_reference IS DISTINCT FROM challenge.chain_reference
            OR alias.address_digest_version IS DISTINCT FROM challenge.address_digest_version
            OR alias.address_digest IS DISTINCT FROM challenge.address_digest
        )
        AND NOT EXISTS (
          SELECT 1
          FROM registered_wallet_identity_digests AS alias
          INNER JOIN registered_wallets AS wallet ON wallet.wallet_id = alias.wallet_id
          WHERE alias.account_id IS DISTINCT FROM wallet.account_id
            OR alias.chain_namespace IS DISTINCT FROM wallet.chain_namespace
            OR alias.chain_reference IS DISTINCT FROM wallet.chain_reference
            OR alias.address_digest_version IS DISTINCT FROM wallet.address_digest_version
            OR alias.address_digest IS DISTINCT FROM wallet.address_digest
            OR alias.status IS DISTINCT FROM wallet.status
            OR alias.registered_at IS DISTINCT FROM wallet.registered_at
            OR alias.revoked_at IS DISTINCT FROM wallet.revoked_at
        )
        AND (SELECT pg_catalog.count(*) FROM wallet_ownership_challenge_identity_digests)
          = (SELECT pg_catalog.count(*) FROM wallet_ownership_challenges)
        AND (SELECT pg_catalog.count(*) FROM registered_wallet_identity_digests)
          = (SELECT pg_catalog.count(*) FROM registered_wallets)
      ) AS valid`;
  return `SELECT (
    prior.valid AND relations.valid AND types.valid AND functions.valid
    AND triggers.valid AND privileges.valid AND data_shape.valid
  ) AS valid
  FROM (${prior}) AS prior
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 3
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AS valid
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND relation.relkind = 'r'
      AND relation.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
  ) AS relations
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 3
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
          AND guarded_type.typname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
          AND acl.privilege_type = 'USAGE'
          AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
      ) AS valid
    FROM pg_catalog.pg_type AS type_state
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_state.typnamespace
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND type_state.typtype = 'c'
      AND type_state.typname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
  ) AS types
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 8
      AND pg_catalog.bool_and(NOT function_state.proleakproof)
      AND pg_catalog.bool_and(function_state.proparallel = 'u')
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AND pg_catalog.bool_and(CASE function_state.oid
        WHEN pg_catalog.to_regprocedure('${BEGIN_ROTATABLE}')
          THEN function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.prorettype = pg_catalog.to_regtype('record')
            AND function_state.proretset AND NOT function_state.proisstrict
        WHEN pg_catalog.to_regprocedure('${COMPLETE_ROTATABLE}')
          THEN function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.prorettype = pg_catalog.to_regtype('record')
            AND function_state.proretset AND NOT function_state.proisstrict
        WHEN pg_catalog.to_regprocedure('${LIST_ROTATABLE}')
          THEN function_state.prosecdef AND function_state.provolatile = 's'
            AND function_state.prorettype = pg_catalog.to_regtype('record')
            AND function_state.proretset AND function_state.proisstrict
            AND function_state.prorows = 33
        ELSE NOT function_state.prosecdef AND function_state.provolatile = 'v'
          AND function_state.prorettype = pg_catalog.to_regtype('trigger')
          AND NOT function_state.proretset AND NOT function_state.proisstrict
      END)
      AND pg_catalog.bool_and(CASE function_state.oid
        WHEN pg_catalog.to_regprocedure('${POLICY_GUARD}')
          THEN function_state.proconfig = ARRAY['search_path=pg_catalog']::text[]
        WHEN pg_catalog.to_regprocedure('${CHALLENGE_ALIAS_GUARD}')
          THEN function_state.proconfig = ARRAY['search_path=pg_catalog']::text[]
        ELSE function_state.proconfig = ARRAY[
          'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
        ]::text[]
      END)
      AND pg_catalog.bool_and(
        pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8')),
          'hex'
        ) = CASE function_state.oid
          WHEN pg_catalog.to_regprocedure('${POLICY_GUARD}')
            THEN '${sourceSha256(POLICY_MUTATION_BODY)}'
          WHEN pg_catalog.to_regprocedure('${CHALLENGE_ALIAS_GUARD}')
            THEN '${sourceSha256(CHALLENGE_ALIAS_MUTATION_BODY)}'
          WHEN pg_catalog.to_regprocedure('${WALLET_ALIAS_GUARD}')
            THEN '${sourceSha256(WALLET_ALIAS_LIFECYCLE_BODY)}'
          WHEN pg_catalog.to_regprocedure('${WALLET_INSERT_GUARD}')
            THEN '${sourceSha256(WALLET_INSERT_GUARD_BODY)}'
          WHEN pg_catalog.to_regprocedure('${WALLET_ALIAS_SYNC}')
            THEN '${sourceSha256(WALLET_ALIAS_SYNC_BODY)}'
          WHEN pg_catalog.to_regprocedure('${BEGIN_ROTATABLE}')
            THEN '${sourceSha256(BEGIN_ROTATABLE_BODY)}'
          WHEN pg_catalog.to_regprocedure('${COMPLETE_ROTATABLE}')
            THEN '${sourceSha256(COMPLETE_ROTATABLE_BODY)}'
          WHEN pg_catalog.to_regprocedure('${LIST_ROTATABLE}')
            THEN '${sourceSha256(LIST_ROTATABLE_BODY)}'
          ELSE NULL
        END
      ) AS valid
    FROM pg_catalog.pg_proc AS function_state
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function_state.pronamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = function_state.proowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND function_state.oid IN (
        pg_catalog.to_regprocedure('${POLICY_GUARD}'),
        pg_catalog.to_regprocedure('${CHALLENGE_ALIAS_GUARD}'),
        pg_catalog.to_regprocedure('${WALLET_ALIAS_GUARD}'),
        pg_catalog.to_regprocedure('${WALLET_INSERT_GUARD}'),
        pg_catalog.to_regprocedure('${WALLET_ALIAS_SYNC}'),
        pg_catalog.to_regprocedure('${BEGIN_ROTATABLE}'),
        pg_catalog.to_regprocedure('${COMPLETE_ROTATABLE}'),
        pg_catalog.to_regprocedure('${LIST_ROTATABLE}')
      )
  ) AS functions
  CROSS JOIN (
    WITH expected_triggers(relation_name, trigger_name, function_identity, trigger_type) AS (
      VALUES
        ('wallet_identity_key_policy', 'wallet_identity_key_policy_immutable_row', '${POLICY_GUARD}', 27),
        ('wallet_identity_key_policy', 'wallet_identity_key_policy_immutable_truncate', '${POLICY_GUARD}', 34),
        ('wallet_ownership_challenge_identity_digests', 'wallet_challenge_identity_digests_immutable_row', '${CHALLENGE_ALIAS_GUARD}', 27),
        ('wallet_ownership_challenge_identity_digests', 'wallet_challenge_identity_digests_immutable_truncate', '${CHALLENGE_ALIAS_GUARD}', 34),
        ('registered_wallet_identity_digests', 'registered_wallet_identity_digests_lifecycle_row', '${WALLET_ALIAS_GUARD}', 27),
        ('registered_wallet_identity_digests', 'registered_wallet_identity_digests_immutable_truncate', '${WALLET_ALIAS_GUARD}', 34),
        ('registered_wallets', 'registered_wallet_identity_immutable', 'enforce_registered_wallet_identity_immutability()', 19),
        ('registered_wallets', 'registered_wallet_account_capacity', 'enforce_active_wallet_account_capacity()', 23),
        ('registered_wallets', 'registered_wallet_lifecycle', 'enforce_registered_wallet_lifecycle()', 19),
        ('registered_wallets', 'registered_wallet_revocation_tombstone', 'enforce_wallet_registration_revocation_tombstone()', 7),
        ('registered_wallets', 'registered_wallet_identity_digest_set_guard', '${WALLET_INSERT_GUARD}', 7),
        ('registered_wallets', 'registered_wallet_identity_digest_sync', '${WALLET_ALIAS_SYNC}', 21)
    )
    SELECT pg_catalog.count(*) = 12
      AND pg_catalog.count(trigger_state.oid) = 12
      AND pg_catalog.bool_and(
        trigger_state.oid IS NOT NULL
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgenabled = 'A'
        AND trigger_state.tgrelid = pg_catalog.to_regclass(expected_triggers.relation_name)
        AND trigger_state.tgfoid =
          pg_catalog.to_regprocedure(expected_triggers.function_identity)
        AND trigger_state.tgtype = expected_triggers.trigger_type
        AND trigger_state.tgnargs = 0
        AND trigger_state.tgqual IS NULL
        AND trigger_state.tgconstraint = 0
        AND NOT trigger_state.tgdeferrable
        AND NOT trigger_state.tginitdeferred
        AND trigger_state.tgparentid = 0
        AND trigger_state.tgoldtable IS NULL
        AND trigger_state.tgnewtable IS NULL
      )
      AND (
          SELECT pg_catalog.count(*) = 12
        FROM pg_catalog.pg_trigger AS all_trigger_state
        WHERE NOT all_trigger_state.tgisinternal
          AND all_trigger_state.tgrelid IN (
            pg_catalog.to_regclass('wallet_identity_key_policy'),
            pg_catalog.to_regclass('wallet_ownership_challenge_identity_digests'),
            pg_catalog.to_regclass('registered_wallet_identity_digests'),
            pg_catalog.to_regclass('registered_wallets')
          )
      ) AS valid
    FROM expected_triggers
    LEFT JOIN pg_catalog.pg_trigger AS trigger_state
      ON trigger_state.tgrelid = pg_catalog.to_regclass(expected_triggers.relation_name)
      AND trigger_state.tgname = expected_triggers.trigger_name
  ) AS triggers
  CROSS JOIN (
    SELECT (
      pg_catalog.has_function_privilege(${api}, '${BEGIN_ROTATABLE}', 'EXECUTE')
      AND pg_catalog.has_function_privilege(${api}, '${COMPLETE_ROTATABLE}', 'EXECUTE')
      AND pg_catalog.has_function_privilege(${api}, '${LIST_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('public', '${BEGIN_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('public', '${COMPLETE_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('public', '${LIST_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${BEGIN_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${COMPLETE_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${LIST_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${BEGIN_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${COMPLETE_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${LIST_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${migration}, '${BEGIN_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${migration}, '${COMPLETE_ROTATABLE}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${migration}, '${LIST_ROTATABLE}', 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS table_state
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = table_state.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(table_state.relacl, pg_catalog.acldefault('r', table_state.relowner))
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND table_state.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
          AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
      )
    ) AS valid
  ) AS privileges
  CROSS JOIN (${dataShape}) AS data_shape`;
}

export function createWalletKeyRotationBoundaryMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0022',
    description: 'create fail-closed wallet registration key rotation boundary',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0021'],
  };
}

export const createWalletKeyRotationBoundaryMigrationV0022 =
  createWalletKeyRotationBoundaryMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createWalletKeyRotationBoundaryTestSchemaMigrationV0022 =
  createWalletKeyRotationBoundaryMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
