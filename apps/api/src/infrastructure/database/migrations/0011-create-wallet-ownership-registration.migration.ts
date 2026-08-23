import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createAuthenticationSessionsMigration } from './0010-create-authentication-sessions.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MAINNET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const TESTNET_REGISTRY_FINGERPRINT =
  '89c158de188fcde7d01642aadef226f3c93724bfe5b53a7f3fcce096180d5ca7';

const WALLET_REGISTRATION_TABLES = [
  'wallet_ownership_challenges',
  'registered_wallets',
  'wallet_registration_audit_events',
] as const;

const WALLET_REGISTRATION_FUNCTION_IDENTITIES = [
  'reject_wallet_registration_audit_mutation()',
  'enforce_wallet_ownership_challenge_binding_immutability()',
  'enforce_registered_wallet_identity_immutability()',
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
] as const;

const WALLET_REGISTRATION_API_FUNCTION_IDENTITIES = [
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
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

function createWalletRegistrationTablesSql(): string {
  return `
    CREATE TABLE wallet_ownership_challenges (
      challenge_id uuid PRIMARY KEY,
      account_id uuid NOT NULL,
      proof_scheme text NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      registry_environment text NOT NULL,
      registry_version integer NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      challenge_payload_key_version smallint,
      challenge_payload_ciphertext bytea,
      challenge_payload_iv bytea,
      challenge_payload_auth_tag bytea,
      payload_destroyed_at timestamptz,
      address_digest_version smallint NOT NULL,
      address_digest bytea NOT NULL,
      domain_digest_version smallint NOT NULL,
      domain_digest bytea NOT NULL,
      message_digest_version smallint NOT NULL,
      message_digest bytea NOT NULL,
      nonce_digest_version smallint NOT NULL,
      nonce_digest bytea NOT NULL,
      status text NOT NULL DEFAULT 'PENDING',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      completed_at timestamptz,
      replay_detected_at timestamptz,
      failure_reason text,
      CONSTRAINT wallet_ownership_challenge_id_uuid_v4_check CHECK (
        substring(challenge_id::text FROM 15 FOR 1) = '4'
        AND substring(challenge_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT wallet_ownership_challenge_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_ownership_challenge_proof_scheme_check CHECK (
        proof_scheme IN (
          'EVM_ERC4361_ERC191',
          'SOLANA_SIWS_SIGN_IN',
          'SOLANA_SIWS_SIGN_MESSAGE'
        )
      ),
      CONSTRAINT wallet_ownership_challenge_chain_check CHECK (
        (proof_scheme = 'EVM_ERC4361_ERC191'
          AND chain_namespace = 'eip155'
          AND chain_reference ~ '^[1-9][0-9]{0,18}$')
        OR (proof_scheme IN ('SOLANA_SIWS_SIGN_IN', 'SOLANA_SIWS_SIGN_MESSAGE')
          AND chain_namespace = 'solana'
          AND chain_reference ~ '^[1-9A-HJ-NP-Za-km-z]{32}$')
      ),
      CONSTRAINT wallet_ownership_challenge_registry_check CHECK (
        registry_version = 1
        AND (
          (registry_environment = 'MAINNET'
            AND registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
            AND (
              (chain_namespace = 'eip155' AND chain_reference IN ('1', '8453', '42161'))
              OR (chain_namespace = 'solana'
                AND chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
            ))
          OR (registry_environment = 'TESTNET'
            AND registry_fingerprint_sha256 = '${TESTNET_REGISTRY_FINGERPRINT}'
            AND (
              (chain_namespace = 'eip155'
                AND chain_reference IN ('11155111', '84532', '421614'))
              OR (chain_namespace = 'solana'
                AND chain_reference = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
            ))
        )
      ),
      CONSTRAINT wallet_ownership_challenge_payload_encryption_check CHECK (
        (challenge_payload_key_version IS NOT NULL
          AND challenge_payload_ciphertext IS NOT NULL
          AND challenge_payload_iv IS NOT NULL
          AND challenge_payload_auth_tag IS NOT NULL
          AND challenge_payload_key_version > 0
          AND octet_length(challenge_payload_ciphertext) BETWEEN 1 AND 16384
          AND octet_length(challenge_payload_iv) = 12
          AND octet_length(challenge_payload_auth_tag) = 16)
        OR (challenge_payload_key_version IS NULL
          AND challenge_payload_ciphertext IS NULL
          AND challenge_payload_iv IS NULL
          AND challenge_payload_auth_tag IS NULL)
      ),
      CONSTRAINT wallet_ownership_challenge_digest_versions_check CHECK (
        address_digest_version > 0
        AND domain_digest_version > 0
        AND message_digest_version > 0
        AND nonce_digest_version > 0
      ),
      CONSTRAINT wallet_ownership_challenge_digests_check CHECK (
        octet_length(address_digest) = 32
        AND octet_length(domain_digest) = 32
        AND octet_length(message_digest) = 32
        AND octet_length(nonce_digest) = 32
      ),
      CONSTRAINT wallet_ownership_challenge_message_unique UNIQUE (
        message_digest_version, message_digest
      ),
      CONSTRAINT wallet_ownership_challenge_nonce_unique UNIQUE (
        nonce_digest_version, nonce_digest
      ),
      CONSTRAINT wallet_ownership_challenge_status_check CHECK (
        status IN ('PENDING', 'REGISTERED', 'REJECTED', 'EXPIRED')
      ),
      CONSTRAINT wallet_ownership_challenge_failure_reason_check CHECK (
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
      ),
      CONSTRAINT wallet_ownership_challenge_lifetime_check CHECK (
        issued_at >= created_at - interval '30 seconds'
        AND issued_at <= created_at + interval '30 seconds'
        AND expires_at >= issued_at + interval '60 seconds'
        AND expires_at <= issued_at + interval '10 minutes'
      ),
      CONSTRAINT wallet_ownership_challenge_state_shape_check CHECK (
        (status = 'PENDING'
          AND completed_at IS NULL AND failure_reason IS NULL
          AND challenge_payload_key_version IS NOT NULL
          AND payload_destroyed_at IS NULL)
        OR (status = 'REGISTERED'
          AND completed_at IS NOT NULL AND failure_reason IS NULL
          AND challenge_payload_key_version IS NULL
          AND payload_destroyed_at IS NOT NULL)
        OR (status = 'REJECTED'
          AND completed_at IS NOT NULL AND failure_reason IS NOT NULL
          AND failure_reason <> 'EXPIRED'
          AND challenge_payload_key_version IS NULL
          AND payload_destroyed_at IS NOT NULL)
        OR (status = 'EXPIRED'
          AND completed_at IS NOT NULL AND failure_reason = 'EXPIRED'
          AND challenge_payload_key_version IS NULL
          AND payload_destroyed_at IS NOT NULL)
      ),
      CONSTRAINT wallet_ownership_challenge_time_order_check CHECK (
        (completed_at IS NULL OR completed_at >= created_at)
        AND (replay_detected_at IS NULL OR replay_detected_at >= created_at)
        AND (payload_destroyed_at IS NULL OR payload_destroyed_at >= created_at)
        AND (payload_destroyed_at IS NULL OR completed_at = payload_destroyed_at)
      )
    );

    CREATE INDEX wallet_ownership_challenge_account_timeline_idx
      ON wallet_ownership_challenges (account_id, created_at DESC, challenge_id);
    CREATE INDEX wallet_ownership_challenge_expiry_idx
      ON wallet_ownership_challenges (expires_at, challenge_id)
      WHERE status = 'PENDING';

    CREATE TABLE registered_wallets (
      wallet_id uuid PRIMARY KEY,
      account_id uuid NOT NULL,
      registered_by_challenge_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      registry_environment text NOT NULL,
      registry_version integer NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      address_digest_version smallint NOT NULL,
      address_digest bytea NOT NULL,
      address_encryption_algorithm text NOT NULL DEFAULT 'AES_256_GCM',
      address_key_version smallint NOT NULL,
      address_ciphertext bytea NOT NULL,
      address_iv bytea NOT NULL,
      address_auth_tag bytea NOT NULL,
      metadata_encryption_algorithm text NOT NULL DEFAULT 'AES_256_GCM',
      metadata_key_version smallint NOT NULL,
      metadata_ciphertext bytea NOT NULL,
      metadata_iv bytea NOT NULL,
      metadata_auth_tag bytea NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE',
      registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      revoked_at timestamptz,
      CONSTRAINT registered_wallet_id_uuid_v4_check CHECK (
        substring(wallet_id::text FROM 15 FOR 1) = '4'
        AND substring(wallet_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT registered_wallet_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT registered_wallet_challenge_fk FOREIGN KEY (registered_by_challenge_id)
        REFERENCES wallet_ownership_challenges (challenge_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT registered_wallet_challenge_unique UNIQUE (registered_by_challenge_id),
      CONSTRAINT registered_wallet_chain_check CHECK (
        (chain_namespace = 'eip155' AND chain_reference ~ '^[1-9][0-9]{0,18}$')
        OR (chain_namespace = 'solana'
          AND chain_reference ~ '^[1-9A-HJ-NP-Za-km-z]{32}$')
      ),
      CONSTRAINT registered_wallet_registry_check CHECK (
        registry_version = 1
        AND (
          (registry_environment = 'MAINNET'
            AND registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
            AND (
              (chain_namespace = 'eip155' AND chain_reference IN ('1', '8453', '42161'))
              OR (chain_namespace = 'solana'
                AND chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
            ))
          OR (registry_environment = 'TESTNET'
            AND registry_fingerprint_sha256 = '${TESTNET_REGISTRY_FINGERPRINT}'
            AND (
              (chain_namespace = 'eip155'
                AND chain_reference IN ('11155111', '84532', '421614'))
              OR (chain_namespace = 'solana'
                AND chain_reference = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
            ))
        )
      ),
      CONSTRAINT registered_wallet_address_digest_check CHECK (
        address_digest_version > 0 AND octet_length(address_digest) = 32
      ),
      CONSTRAINT registered_wallet_address_encryption_check CHECK (
        address_encryption_algorithm = 'AES_256_GCM'
        AND address_key_version > 0
        AND octet_length(address_ciphertext) BETWEEN 1 AND 512
        AND octet_length(address_iv) = 12
        AND octet_length(address_auth_tag) = 16
      ),
      CONSTRAINT registered_wallet_metadata_encryption_check CHECK (
        metadata_encryption_algorithm = 'AES_256_GCM'
        AND metadata_key_version > 0
        AND octet_length(metadata_ciphertext) BETWEEN 1 AND 16384
        AND octet_length(metadata_iv) = 12
        AND octet_length(metadata_auth_tag) = 16
      ),
      CONSTRAINT registered_wallet_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
      CONSTRAINT registered_wallet_status_time_check CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= registered_at)
      )
    );

    CREATE UNIQUE INDEX registered_wallets_one_active_identity
      ON registered_wallets (
        chain_namespace, chain_reference, address_digest_version, address_digest
      )
      WHERE status = 'ACTIVE';
    CREATE INDEX registered_wallets_account_timeline_idx
      ON registered_wallets (account_id, registered_at DESC, wallet_id);

    CREATE TABLE wallet_registration_audit_events (
      audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type text NOT NULL,
      outcome text NOT NULL,
      reason_code text NOT NULL,
      challenge_id uuid,
      wallet_id uuid,
      account_id uuid NOT NULL,
      correlation_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT wallet_registration_audit_id_uuid_v4_check CHECK (
        substring(audit_id::text FROM 15 FOR 1) = '4'
        AND substring(audit_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT wallet_registration_audit_challenge_fk FOREIGN KEY (challenge_id)
        REFERENCES wallet_ownership_challenges (challenge_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_registration_audit_wallet_fk FOREIGN KEY (wallet_id)
        REFERENCES registered_wallets (wallet_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_registration_audit_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_registration_audit_event_check CHECK (
        event_type IN (
          'CHALLENGE_STARTED',
          'CHALLENGE_REPLAY_DETECTED',
          'CHALLENGE_REJECTED',
          'CHALLENGE_EXPIRED',
          'WALLET_REGISTERED',
          'WALLET_ALREADY_REGISTERED'
        )
      ),
      CONSTRAINT wallet_registration_audit_outcome_check CHECK (
        outcome IN ('SUCCEEDED', 'REJECTED', 'DETECTED')
      ),
      CONSTRAINT wallet_registration_audit_reason_check CHECK (
        reason_code IN (
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
        )
      ),
      CONSTRAINT wallet_registration_audit_shape_check CHECK (
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
      )
    );

    CREATE INDEX wallet_registration_audit_account_timeline_idx
      ON wallet_registration_audit_events (account_id, occurred_at, audit_id);
    CREATE INDEX wallet_registration_audit_correlation_idx
      ON wallet_registration_audit_events (correlation_id, occurred_at, audit_id);
  `;
}

function createWalletRegistrationFunctionsSql(): string {
  return `
    CREATE FUNCTION reject_wallet_registration_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      RAISE EXCEPTION 'wallet registration audit events are append-only'
        USING ERRCODE = '55000';
    END;
    $function$;

    CREATE FUNCTION enforce_wallet_ownership_challenge_binding_immutability()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
        OR NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.proof_scheme IS DISTINCT FROM OLD.proof_scheme
        OR NEW.chain_namespace IS DISTINCT FROM OLD.chain_namespace
        OR NEW.chain_reference IS DISTINCT FROM OLD.chain_reference
        OR NEW.registry_environment IS DISTINCT FROM OLD.registry_environment
        OR NEW.registry_version IS DISTINCT FROM OLD.registry_version
        OR NEW.registry_fingerprint_sha256 IS DISTINCT FROM OLD.registry_fingerprint_sha256
        OR NEW.address_digest_version IS DISTINCT FROM OLD.address_digest_version
        OR NEW.address_digest IS DISTINCT FROM OLD.address_digest
        OR NEW.domain_digest_version IS DISTINCT FROM OLD.domain_digest_version
        OR NEW.domain_digest IS DISTINCT FROM OLD.domain_digest
        OR NEW.message_digest_version IS DISTINCT FROM OLD.message_digest_version
        OR NEW.message_digest IS DISTINCT FROM OLD.message_digest
        OR NEW.nonce_digest_version IS DISTINCT FROM OLD.nonce_digest_version
        OR NEW.nonce_digest IS DISTINCT FROM OLD.nonce_digest
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      THEN
        RAISE EXCEPTION 'wallet ownership challenge binding is immutable'
          USING ERRCODE = '23514';
      END IF;

      IF OLD.status = 'PENDING' AND NEW.status <> 'PENDING' THEN
        IF NEW.challenge_payload_key_version IS NOT NULL
          OR NEW.challenge_payload_ciphertext IS NOT NULL
          OR NEW.challenge_payload_iv IS NOT NULL
          OR NEW.challenge_payload_auth_tag IS NOT NULL
          OR NEW.payload_destroyed_at IS NULL
        THEN
          RAISE EXCEPTION 'terminal wallet challenge must destroy encrypted payload'
            USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.challenge_payload_key_version IS DISTINCT FROM OLD.challenge_payload_key_version
        OR NEW.challenge_payload_ciphertext IS DISTINCT FROM OLD.challenge_payload_ciphertext
        OR NEW.challenge_payload_iv IS DISTINCT FROM OLD.challenge_payload_iv
        OR NEW.challenge_payload_auth_tag IS DISTINCT FROM OLD.challenge_payload_auth_tag
        OR NEW.payload_destroyed_at IS DISTINCT FROM OLD.payload_destroyed_at
      THEN
        RAISE EXCEPTION 'wallet ownership challenge payload is immutable'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION enforce_registered_wallet_identity_immutability()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
        OR NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.registered_by_challenge_id IS DISTINCT FROM OLD.registered_by_challenge_id
        OR NEW.chain_namespace IS DISTINCT FROM OLD.chain_namespace
        OR NEW.chain_reference IS DISTINCT FROM OLD.chain_reference
        OR NEW.registry_environment IS DISTINCT FROM OLD.registry_environment
        OR NEW.registry_version IS DISTINCT FROM OLD.registry_version
        OR NEW.registry_fingerprint_sha256 IS DISTINCT FROM OLD.registry_fingerprint_sha256
        OR NEW.address_digest_version IS DISTINCT FROM OLD.address_digest_version
        OR NEW.address_digest IS DISTINCT FROM OLD.address_digest
        OR NEW.address_encryption_algorithm IS DISTINCT FROM OLD.address_encryption_algorithm
        OR NEW.address_key_version IS DISTINCT FROM OLD.address_key_version
        OR NEW.address_ciphertext IS DISTINCT FROM OLD.address_ciphertext
        OR NEW.address_iv IS DISTINCT FROM OLD.address_iv
        OR NEW.address_auth_tag IS DISTINCT FROM OLD.address_auth_tag
        OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
      THEN
        RAISE EXCEPTION 'registered wallet identity is immutable' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION begin_wallet_ownership_challenge(
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
      requested_correlation_id uuid
    ) RETURNS TABLE (
      challenge_id uuid,
      expires_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      recorded_at timestamptz := statement_timestamp();
      pending_challenge_count bigint;
    BEGIN
      IF requested_challenge_id IS NULL
        OR substring(requested_challenge_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_challenge_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_account_id IS NULL
        OR requested_proof_scheme IS NULL
        OR requested_proof_scheme NOT IN (
          'EVM_ERC4361_ERC191',
          'SOLANA_SIWS_SIGN_IN',
          'SOLANA_SIWS_SIGN_MESSAGE'
        )
        OR requested_chain_namespace IS NULL
        OR requested_chain_reference IS NULL
        OR NOT (
          (requested_proof_scheme = 'EVM_ERC4361_ERC191'
            AND requested_chain_namespace = 'eip155'
            AND requested_chain_reference ~ '^[1-9][0-9]{0,18}$')
          OR (requested_proof_scheme IN (
              'SOLANA_SIWS_SIGN_IN', 'SOLANA_SIWS_SIGN_MESSAGE'
            )
            AND requested_chain_namespace = 'solana'
            AND requested_chain_reference ~ '^[1-9A-HJ-NP-Za-km-z]{32}$')
        )
        OR requested_registry_environment IS NULL
        OR requested_registry_version IS DISTINCT FROM 1
        OR NOT (
          (requested_registry_environment = 'MAINNET'
            AND requested_registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
            AND (
              (requested_chain_namespace = 'eip155'
                AND requested_chain_reference IN ('1', '8453', '42161'))
              OR (requested_chain_namespace = 'solana'
                AND requested_chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
            ))
          OR (requested_registry_environment = 'TESTNET'
            AND requested_registry_fingerprint_sha256 = '${TESTNET_REGISTRY_FINGERPRINT}'
            AND (
              (requested_chain_namespace = 'eip155'
                AND requested_chain_reference IN ('11155111', '84532', '421614'))
              OR (requested_chain_namespace = 'solana'
                AND requested_chain_reference = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
            ))
        )
        OR requested_challenge_payload_key_version IS NULL
        OR requested_challenge_payload_key_version < 1
        OR requested_challenge_payload_ciphertext IS NULL
        OR octet_length(requested_challenge_payload_ciphertext) NOT BETWEEN 1 AND 16384
        OR requested_challenge_payload_iv IS NULL
        OR octet_length(requested_challenge_payload_iv) <> 12
        OR requested_challenge_payload_auth_tag IS NULL
        OR octet_length(requested_challenge_payload_auth_tag) <> 16
        OR requested_address_digest_version IS NULL
        OR requested_address_digest_version < 1
        OR requested_address_digest IS NULL
        OR octet_length(requested_address_digest) <> 32
        OR requested_domain_digest_version IS NULL
        OR requested_domain_digest_version < 1
        OR requested_domain_digest IS NULL
        OR octet_length(requested_domain_digest) <> 32
        OR requested_message_digest_version IS NULL
        OR requested_message_digest_version < 1
        OR requested_message_digest IS NULL
        OR octet_length(requested_message_digest) <> 32
        OR requested_nonce_digest_version IS NULL
        OR requested_nonce_digest_version < 1
        OR requested_nonce_digest IS NULL
        OR octet_length(requested_nonce_digest) <> 32
        OR requested_issued_at IS NULL
        OR requested_issued_at < recorded_at - interval '30 seconds'
        OR requested_issued_at > recorded_at + interval '30 seconds'
        OR requested_expires_at IS NULL
        OR requested_expires_at < requested_issued_at + interval '60 seconds'
        OR requested_expires_at > requested_issued_at + interval '10 minutes'
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid wallet ownership challenge' USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56001)
      );

      recorded_at := clock_timestamp();
      IF requested_issued_at < recorded_at - interval '30 seconds'
        OR requested_issued_at > recorded_at + interval '30 seconds'
        OR requested_expires_at <= recorded_at
      THEN
        RAISE EXCEPTION 'wallet ownership challenge expired while awaiting account lock'
          USING ERRCODE = '22023';
      END IF;

      SELECT pg_catalog.count(*)
      INTO pending_challenge_count
      FROM wallet_ownership_challenges AS challenge
      WHERE challenge.account_id = requested_account_id
        AND challenge.status = 'PENDING'
        AND challenge.expires_at > recorded_at;

      IF pending_challenge_count >= 5 THEN
        RAISE EXCEPTION 'wallet ownership pending challenge limit exceeded'
          USING ERRCODE = '54000';
      END IF;

      INSERT INTO wallet_ownership_challenges (
        challenge_id,
        account_id,
        proof_scheme,
        chain_namespace,
        chain_reference,
        registry_environment,
        registry_version,
        registry_fingerprint_sha256,
        challenge_payload_key_version,
        challenge_payload_ciphertext,
        challenge_payload_iv,
        challenge_payload_auth_tag,
        address_digest_version,
        address_digest,
        domain_digest_version,
        domain_digest,
        message_digest_version,
        message_digest,
        nonce_digest_version,
        nonce_digest,
        created_at,
        issued_at,
        expires_at
      ) VALUES (
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
        recorded_at,
        requested_issued_at,
        requested_expires_at
      );

      INSERT INTO wallet_registration_audit_events (
        event_type,
        outcome,
        reason_code,
        challenge_id,
        account_id,
        correlation_id,
        occurred_at
      ) VALUES (
        'CHALLENGE_STARTED',
        'SUCCEEDED',
        'NONE',
        requested_challenge_id,
        requested_account_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT requested_challenge_id, requested_expires_at;
    END;
    $function$;

    CREATE FUNCTION prepare_wallet_ownership_challenge(
      requested_challenge_id uuid,
      requested_account_id uuid,
      requested_correlation_id uuid
    ) RETURNS TABLE (
      prepare_outcome text,
      prepared_account_id uuid,
      prepared_proof_scheme text,
      prepared_chain_namespace text,
      prepared_chain_reference text,
      prepared_registry_environment text,
      prepared_registry_version integer,
      prepared_registry_fingerprint_sha256 text,
      prepared_challenge_payload_key_version smallint,
      prepared_challenge_payload_ciphertext bytea,
      prepared_challenge_payload_iv bytea,
      prepared_challenge_payload_auth_tag bytea,
      prepared_address_digest_version smallint,
      prepared_address_digest bytea,
      prepared_domain_digest_version smallint,
      prepared_domain_digest bytea,
      prepared_message_digest_version smallint,
      prepared_message_digest bytea,
      prepared_nonce_digest_version smallint,
      prepared_nonce_digest bytea,
      prepared_issued_at timestamptz,
      prepared_expires_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      ownership_challenge wallet_ownership_challenges%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
      replay_update_count bigint;
    BEGIN
      IF requested_challenge_id IS NULL
        OR requested_account_id IS NULL
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid wallet ownership challenge preparation'
          USING ERRCODE = '22023';
      END IF;

      SELECT challenge.*
      INTO ownership_challenge
      FROM wallet_ownership_challenges AS challenge
      WHERE challenge.challenge_id = requested_challenge_id
        AND challenge.account_id = requested_account_id
      FOR UPDATE;

      recorded_at := clock_timestamp();

      IF NOT FOUND THEN
        RETURN QUERY SELECT
          'INVALID'::text,
          NULL::uuid,
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::integer,
          NULL::text,
          NULL::smallint,
          NULL::bytea,
          NULL::bytea,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::timestamptz,
          NULL::timestamptz;
        RETURN;
      END IF;

      IF ownership_challenge.status <> 'PENDING' THEN
        UPDATE wallet_ownership_challenges AS challenge
        SET replay_detected_at = recorded_at
        WHERE challenge.challenge_id = requested_challenge_id
          AND challenge.replay_detected_at IS NULL;
        GET DIAGNOSTICS replay_update_count = ROW_COUNT;

        IF replay_update_count = 1 THEN
          INSERT INTO wallet_registration_audit_events (
            event_type,
            outcome,
            reason_code,
            challenge_id,
            account_id,
            correlation_id,
            occurred_at
          ) VALUES (
            'CHALLENGE_REPLAY_DETECTED',
            'DETECTED',
            'REPLAY',
            requested_challenge_id,
            requested_account_id,
            requested_correlation_id,
            recorded_at
          );
        END IF;

        RETURN QUERY SELECT
          'REPLAYED'::text,
          NULL::uuid,
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::integer,
          NULL::text,
          NULL::smallint,
          NULL::bytea,
          NULL::bytea,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::timestamptz,
          NULL::timestamptz;
        RETURN;
      END IF;

      IF recorded_at >= ownership_challenge.expires_at THEN
        UPDATE wallet_ownership_challenges AS challenge
        SET status = 'EXPIRED',
            completed_at = recorded_at,
            failure_reason = 'EXPIRED',
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
          'CHALLENGE_EXPIRED',
          'REJECTED',
          'EXPIRED',
          requested_challenge_id,
          requested_account_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT
          'EXPIRED'::text,
          NULL::uuid,
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::integer,
          NULL::text,
          NULL::smallint,
          NULL::bytea,
          NULL::bytea,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::smallint,
          NULL::bytea,
          NULL::timestamptz,
          NULL::timestamptz;
        RETURN;
      END IF;

      RETURN QUERY SELECT
        'READY'::text,
        ownership_challenge.account_id,
        ownership_challenge.proof_scheme,
        ownership_challenge.chain_namespace,
        ownership_challenge.chain_reference,
        ownership_challenge.registry_environment,
        ownership_challenge.registry_version,
        ownership_challenge.registry_fingerprint_sha256,
        ownership_challenge.challenge_payload_key_version,
        ownership_challenge.challenge_payload_ciphertext,
        ownership_challenge.challenge_payload_iv,
        ownership_challenge.challenge_payload_auth_tag,
        ownership_challenge.address_digest_version,
        ownership_challenge.address_digest,
        ownership_challenge.domain_digest_version,
        ownership_challenge.domain_digest,
        ownership_challenge.message_digest_version,
        ownership_challenge.message_digest,
        ownership_challenge.nonce_digest_version,
        ownership_challenge.nonce_digest,
        ownership_challenge.issued_at,
        ownership_challenge.expires_at;
    END;
    $function$;
  `;
}

function createWalletRegistrationCompletionFunctionsSql(): string {
  return `
    CREATE FUNCTION reject_wallet_ownership_challenge(
      requested_challenge_id uuid,
      requested_account_id uuid,
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
      ownership_challenge wallet_ownership_challenges%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
      recorded_reason text;
      replay_update_count bigint;
    BEGIN
      IF requested_challenge_id IS NULL
        OR requested_account_id IS NULL
        OR requested_failure_reason IS NULL
        OR requested_failure_reason NOT IN (
          'MALFORMED_PROOF',
          'SIGNATURE_INVALID',
          'WRONG_DOMAIN',
          'WRONG_USER',
          'WRONG_NETWORK',
          'WRONG_ADDRESS',
          'WRONG_MESSAGE',
          'WRONG_NONCE',
          'UNSUPPORTED_SCHEME'
        )
        OR requested_correlation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid wallet ownership challenge rejection'
          USING ERRCODE = '22023';
      END IF;

      SELECT challenge.*
      INTO ownership_challenge
      FROM wallet_ownership_challenges AS challenge
      WHERE challenge.challenge_id = requested_challenge_id
        AND challenge.account_id = requested_account_id
      FOR UPDATE;

      recorded_at := clock_timestamp();

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'INVALID'::text;
        RETURN;
      END IF;

      IF ownership_challenge.status <> 'PENDING' THEN
        UPDATE wallet_ownership_challenges AS challenge
        SET replay_detected_at = recorded_at
        WHERE challenge.challenge_id = requested_challenge_id
          AND challenge.replay_detected_at IS NULL;
        GET DIAGNOSTICS replay_update_count = ROW_COUNT;

        IF replay_update_count = 1 THEN
          INSERT INTO wallet_registration_audit_events (
            event_type,
            outcome,
            reason_code,
            challenge_id,
            account_id,
            correlation_id,
            occurred_at
          ) VALUES (
            'CHALLENGE_REPLAY_DETECTED',
            'DETECTED',
            'REPLAY',
            requested_challenge_id,
            requested_account_id,
            requested_correlation_id,
            recorded_at
          );
        END IF;

        RETURN QUERY SELECT 'REPLAYED'::text;
        RETURN;
      END IF;

      recorded_reason := CASE
        WHEN recorded_at >= ownership_challenge.expires_at THEN 'EXPIRED'
        ELSE requested_failure_reason
      END;

      UPDATE wallet_ownership_challenges AS challenge
      SET status = CASE WHEN recorded_reason = 'EXPIRED' THEN 'EXPIRED' ELSE 'REJECTED' END,
          completed_at = recorded_at,
          failure_reason = recorded_reason,
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
        CASE
          WHEN recorded_reason = 'EXPIRED' THEN 'CHALLENGE_EXPIRED'
          ELSE 'CHALLENGE_REJECTED'
        END,
        'REJECTED',
        recorded_reason,
        requested_challenge_id,
        requested_account_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT CASE
        WHEN recorded_reason = 'EXPIRED' THEN 'EXPIRED'::text
        ELSE 'REJECTED'::text
      END;
    END;
    $function$;

    CREATE FUNCTION complete_wallet_registration(
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
    AS $function$
    DECLARE
      ownership_challenge wallet_ownership_challenges%ROWTYPE;
      active_wallet registered_wallets%ROWTYPE;
      recorded_at timestamptz := clock_timestamp();
      replay_update_count bigint;
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
        RAISE EXCEPTION 'invalid wallet registration completion' USING ERRCODE = '22023';
      END IF;

      SELECT challenge.*
      INTO ownership_challenge
      FROM wallet_ownership_challenges AS challenge
      WHERE challenge.challenge_id = requested_challenge_id
        AND challenge.account_id = requested_account_id
      FOR UPDATE;

      recorded_at := clock_timestamp();

      IF NOT FOUND THEN
        RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      IF ownership_challenge.status <> 'PENDING' THEN
        UPDATE wallet_ownership_challenges AS challenge
        SET replay_detected_at = recorded_at
        WHERE challenge.challenge_id = requested_challenge_id
          AND challenge.replay_detected_at IS NULL;
        GET DIAGNOSTICS replay_update_count = ROW_COUNT;

        IF replay_update_count = 1 THEN
          INSERT INTO wallet_registration_audit_events (
            event_type,
            outcome,
            reason_code,
            challenge_id,
            account_id,
            correlation_id,
            occurred_at
          ) VALUES (
            'CHALLENGE_REPLAY_DETECTED',
            'DETECTED',
            'REPLAY',
            requested_challenge_id,
            requested_account_id,
            requested_correlation_id,
            recorded_at
          );
        END IF;

        RETURN QUERY SELECT 'REPLAYED'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      IF recorded_at >= ownership_challenge.expires_at THEN
        UPDATE wallet_ownership_challenges AS challenge
        SET status = 'EXPIRED',
            completed_at = recorded_at,
            failure_reason = 'EXPIRED',
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
          'CHALLENGE_EXPIRED',
          'REJECTED',
          'EXPIRED',
          requested_challenge_id,
          requested_account_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT 'EXPIRED'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

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

      IF recorded_at >= ownership_challenge.expires_at THEN
        UPDATE wallet_ownership_challenges AS challenge
        SET status = 'EXPIRED',
            completed_at = recorded_at,
            failure_reason = 'EXPIRED',
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
          'CHALLENGE_EXPIRED',
          'REJECTED',
          'EXPIRED',
          requested_challenge_id,
          requested_account_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT 'EXPIRED'::text, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;

      SELECT wallet.*
      INTO active_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.chain_namespace = ownership_challenge.chain_namespace
        AND wallet.chain_reference = ownership_challenge.chain_reference
        AND wallet.address_digest_version = ownership_challenge.address_digest_version
        AND wallet.address_digest = ownership_challenge.address_digest
        AND wallet.status = 'ACTIVE'
      FOR UPDATE;

      IF FOUND THEN
        IF active_wallet.account_id IS DISTINCT FROM requested_account_id THEN
          UPDATE wallet_ownership_challenges AS challenge
          SET status = 'REJECTED',
              completed_at = recorded_at,
              failure_reason = 'OWNERSHIP_CONFLICT',
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
            'OWNERSHIP_CONFLICT',
            requested_challenge_id,
            requested_account_id,
            requested_correlation_id,
            recorded_at
          );

          RETURN QUERY SELECT
            'OWNERSHIP_CONFLICT'::text, NULL::uuid, NULL::timestamptz;
          RETURN;
        END IF;

        UPDATE wallet_ownership_challenges AS challenge
        SET status = 'REGISTERED',
            completed_at = recorded_at,
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
          wallet_id,
          account_id,
          correlation_id,
          occurred_at
        ) VALUES (
          'WALLET_ALREADY_REGISTERED',
          'SUCCEEDED',
          'NONE',
          requested_challenge_id,
          active_wallet.wallet_id,
          requested_account_id,
          requested_correlation_id,
          recorded_at
        );

        RETURN QUERY SELECT
          'ALREADY_REGISTERED'::text,
          active_wallet.wallet_id,
          active_wallet.registered_at;
        RETURN;
      END IF;

      INSERT INTO registered_wallets (
        wallet_id,
        account_id,
        registered_by_challenge_id,
        chain_namespace,
        chain_reference,
        registry_environment,
        registry_version,
        registry_fingerprint_sha256,
        address_digest_version,
        address_digest,
        address_key_version,
        address_ciphertext,
        address_iv,
        address_auth_tag,
        metadata_key_version,
        metadata_ciphertext,
        metadata_iv,
        metadata_auth_tag,
        registered_at
      ) VALUES (
        requested_wallet_id,
        requested_account_id,
        requested_challenge_id,
        ownership_challenge.chain_namespace,
        ownership_challenge.chain_reference,
        ownership_challenge.registry_environment,
        ownership_challenge.registry_version,
        ownership_challenge.registry_fingerprint_sha256,
        ownership_challenge.address_digest_version,
        ownership_challenge.address_digest,
        requested_address_key_version,
        requested_address_ciphertext,
        requested_address_iv,
        requested_address_auth_tag,
        requested_metadata_key_version,
        requested_metadata_ciphertext,
        requested_metadata_iv,
        requested_metadata_auth_tag,
        recorded_at
      );

      UPDATE wallet_ownership_challenges AS challenge
      SET status = 'REGISTERED',
          completed_at = recorded_at,
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
        wallet_id,
        account_id,
        correlation_id,
        occurred_at
      ) VALUES (
        'WALLET_REGISTERED',
        'SUCCEEDED',
        'NONE',
        requested_challenge_id,
        requested_wallet_id,
        requested_account_id,
        requested_correlation_id,
        recorded_at
      );

      RETURN QUERY SELECT 'REGISTERED'::text, requested_wallet_id, recorded_at;
    END;
    $function$;
  `;
}

function createWalletRegistrationTriggersAndAclSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const tableList = WALLET_REGISTRATION_TABLES.join(', ');
  const functionIdentities = WALLET_REGISTRATION_FUNCTION_IDENTITIES.map(
    (identityValue) => `'${identityValue}'`,
  ).join(',\n        ');
  const revokeFunctions = WALLET_REGISTRATION_FUNCTION_IDENTITIES.map(
    (identityValue) =>
      `REVOKE ALL ON FUNCTION ${identityValue} FROM PUBLIC, ${api}, ${worker}, ${legacy};`,
  ).join('\n    ');
  const grantApiFunctions = WALLET_REGISTRATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `GRANT EXECUTE ON FUNCTION ${identityValue} TO ${api};`,
  ).join('\n    ');

  return `
    CREATE TRIGGER wallet_ownership_challenge_binding_immutable
      BEFORE UPDATE ON wallet_ownership_challenges
      FOR EACH ROW EXECUTE FUNCTION enforce_wallet_ownership_challenge_binding_immutability();

    CREATE TRIGGER registered_wallet_identity_immutable
      BEFORE UPDATE ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION enforce_registered_wallet_identity_immutability();

    CREATE TRIGGER wallet_registration_audit_append_only_row
      BEFORE UPDATE OR DELETE ON wallet_registration_audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_wallet_registration_audit_mutation();
    CREATE TRIGGER wallet_registration_audit_append_only_truncate
      BEFORE TRUNCATE ON wallet_registration_audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION reject_wallet_registration_audit_mutation();

    ALTER TABLE wallet_registration_audit_events
      ENABLE ALWAYS TRIGGER wallet_registration_audit_append_only_row;
    ALTER TABLE wallet_registration_audit_events
      ENABLE ALWAYS TRIGGER wallet_registration_audit_append_only_truncate;
    ALTER TABLE wallet_ownership_challenges
      ENABLE ALWAYS TRIGGER wallet_ownership_challenge_binding_immutable;
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_identity_immutable;

    DO $set_wallet_registration_function_paths$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        ${functionIdentities}
      ]
      LOOP
        IF function_identity NOT IN (
          'reject_wallet_registration_audit_mutation()',
          'enforce_wallet_ownership_challenge_binding_immutability()',
          'enforce_registered_wallet_identity_immutability()'
        ) THEN
          EXECUTE pg_catalog.format(
            'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
            migration_schema,
            function_identity,
            migration_schema
          );
        END IF;
      END LOOP;
    END;
    $set_wallet_registration_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${tableList}
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    ${revokeFunctions}

    ${grantApiFunctions}
  `;
}

function createWalletRegistrationDownSql(names: DatabasePrincipalNames): readonly string[] {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const revokeApiFunctions = WALLET_REGISTRATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `REVOKE EXECUTE ON FUNCTION ${identityValue} FROM ${api}`,
  );

  return [
    `DO $refuse_populated_wallet_registration_rollback$
     BEGIN
       IF EXISTS (SELECT 1 FROM wallet_ownership_challenges)
         OR EXISTS (SELECT 1 FROM registered_wallets)
         OR EXISTS (SELECT 1 FROM wallet_registration_audit_events)
       THEN
         RAISE EXCEPTION 'cannot roll back retained wallet ownership security state'
           USING ERRCODE = '55000';
       END IF;
     END;
     $refuse_populated_wallet_registration_rollback$;`,
    ...revokeApiFunctions,
    `DROP FUNCTION complete_wallet_registration(
       uuid, uuid, uuid, smallint, bytea, bytea, bytea,
       smallint, bytea, bytea, bytea, uuid
     )`,
    'DROP FUNCTION reject_wallet_ownership_challenge(uuid, uuid, text, uuid)',
    'DROP FUNCTION prepare_wallet_ownership_challenge(uuid, uuid, uuid)',
    `DROP FUNCTION begin_wallet_ownership_challenge(
       uuid, uuid, text, text, text, text, integer, text,
       smallint, bytea, bytea, bytea,
       smallint, bytea, smallint, bytea, smallint, bytea, smallint, bytea,
       timestamptz, timestamptz, uuid
     )`,
    'DROP TABLE wallet_registration_audit_events',
    'DROP TABLE registered_wallets',
    'DROP TABLE wallet_ownership_challenges',
    'DROP FUNCTION enforce_registered_wallet_identity_immutability()',
    'DROP FUNCTION enforce_wallet_ownership_challenge_binding_immutability()',
    'DROP FUNCTION reject_wallet_registration_audit_mutation()',
  ];
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0010 wallet verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function extendPriorVerifierForWalletRegistration(
  names: DatabasePrincipalNames,
  priorVerifier: string,
): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const authenticationAllowance = `            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                ${AUTHENTICATION_API_FUNCTION_IDENTITIES.map(
                  (identityValue) => `to_regprocedure('${identityValue}')`,
                ).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const walletAllowance = `${authenticationAllowance}
            OR (
              grantee.rolname = ${api}
              AND procedure.oid IN (
                ${WALLET_REGISTRATION_API_FUNCTION_IDENTITIES.map(
                  (identityValue) => `to_regprocedure('${identityValue}')`,
                ).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
  const walletTableLiterals = WALLET_REGISTRATION_TABLES.map((table) => `'${table}'`).join(', ');
  const loginTypePrivilegeAnchor =
    "              AND pg_catalog.has_type_privilege(login_role.oid, type_object.oid, 'USAGE')";
  const auditedTypePrivilegeAnchor =
    "        AND pg_catalog.has_type_privilege(audited_role.oid, type_object.oid, 'USAGE')";
  const loginTypePrivilegeReplacement = `              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class AS wallet_registration_row_table
                WHERE wallet_registration_row_table.oid = type_object.typrelid
                  AND wallet_registration_row_table.relnamespace =
                    pg_catalog.to_regnamespace(pg_catalog.current_schema())
                  AND wallet_registration_row_table.relkind = 'r'
                  AND wallet_registration_row_table.relname IN (${walletTableLiterals})
              )
${loginTypePrivilegeAnchor}`;
  const auditedTypePrivilegeReplacement = `        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS wallet_registration_row_table
          WHERE wallet_registration_row_table.oid = type_object.typrelid
            AND wallet_registration_row_table.relnamespace =
              pg_catalog.to_regnamespace(pg_catalog.current_schema())
            AND wallet_registration_row_table.relkind = 'r'
            AND wallet_registration_row_table.relname IN (${walletTableLiterals})
        )
${auditedTypePrivilegeAnchor}`;

  let verifier = replaceExactlyOnce(priorVerifier, authenticationAllowance, walletAllowance);
  verifier = replaceExactlyOnce(verifier, loginTypePrivilegeAnchor, loginTypePrivilegeReplacement);
  return replaceExactlyOnce(verifier, auditedTypePrivilegeAnchor, auditedTypePrivilegeReplacement);
}

function createWalletRegistrationVerifierSql(
  names: DatabasePrincipalNames,
  cumulativePrincipalVerification: boolean,
): string {
  const priorMigration = createAuthenticationSessionsMigration(names, {
    cumulativePrincipalVerification,
  });
  if (!priorMigration.verifySql) {
    throw new Error('Migration 0010 must expose verification SQL');
  }

  const priorVerifier = cumulativePrincipalVerification
    ? extendPriorVerifierForWalletRegistration(names, priorMigration.verifySql)
    : priorMigration.verifySql;
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const tableLiterals = WALLET_REGISTRATION_TABLES.map((table) => `'${table}'`).join(', ');
  const allFunctionRegprocedures = WALLET_REGISTRATION_FUNCTION_IDENTITIES.map(
    (identityValue) => `to_regprocedure('${identityValue}')`,
  ).join(',\n        ');
  const apiFunctionRegprocedures = WALLET_REGISTRATION_API_FUNCTION_IDENTITIES.map(
    (identityValue) => `to_regprocedure('${identityValue}')`,
  ).join(',\n        ');
  const ownerVerification = cumulativePrincipalVerification
    ? `AND table_owner.rolname = ${owner}`
    : '';
  const functionOwnerVerification = cumulativePrincipalVerification
    ? `AND function_owner.rolname = ${owner}`
    : '';

  const walletVerifier = `WITH wallet_registration_tables AS MATERIALIZED (
    SELECT table_state.*
    FROM pg_catalog.pg_class AS table_state
    WHERE table_state.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
      AND table_state.relkind = 'r'
      AND table_state.relname IN (${tableLiterals})
  ),
  wallet_registration_functions AS MATERIALIZED (
    SELECT procedure.*
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.pronamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
      AND procedure.oid IN (
        ${allFunctionRegprocedures}
      )
  ),
  wallet_registration_function_catalog AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS object_count,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          function_state.proname,
          pg_catalog.pg_get_function_identity_arguments(function_state.oid),
          pg_catalog.pg_get_function_result(function_state.oid),
          language.lanname,
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
                ' ' || pg_catalog.current_schema() || ',',
                ' __schema__,'
              ) ORDER BY config_state.ordinality
            )
            FROM pg_catalog.unnest(function_state.proconfig)
              WITH ORDINALITY AS config_state(config_value, ordinality)
          ),
          pg_catalog.replace(
            pg_catalog.replace(
              function_state.prosrc,
              pg_catalog.chr(13) || pg_catalog.chr(10),
              pg_catalog.chr(10)
            ),
            pg_catalog.chr(13),
            pg_catalog.chr(10)
          )
        ) ORDER BY
          function_state.proname,
          pg_catalog.pg_get_function_identity_arguments(function_state.oid)
      ) AS descriptor
    FROM wallet_registration_functions AS function_state
    INNER JOIN pg_catalog.pg_language AS language ON language.oid = function_state.prolang
  )
  SELECT (
    (SELECT pg_catalog.count(*) = ${WALLET_REGISTRATION_TABLES.length}
      FROM wallet_registration_tables)
    AND (SELECT pg_catalog.count(*) = ${WALLET_REGISTRATION_TABLES.length}
      FROM wallet_registration_tables AS table_state
      INNER JOIN pg_catalog.pg_roles AS table_owner ON table_owner.oid = table_state.relowner
      WHERE true ${ownerVerification})
    AND (SELECT pg_catalog.count(*) = ${WALLET_REGISTRATION_FUNCTION_IDENTITIES.length}
      FROM wallet_registration_functions)
    AND (SELECT object_count = 7 FROM wallet_registration_function_catalog)
    AND (
      SELECT pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(descriptor::text, 'UTF8')),
        'hex'
      ) = '07cec639ac59a7d5cf9a3214dea1c894c7ddd6bc7f40b5f7ac9fca2447508ef1'
      FROM wallet_registration_function_catalog
    )
    AND (SELECT pg_catalog.count(*) = ${WALLET_REGISTRATION_FUNCTION_IDENTITIES.length}
      FROM wallet_registration_functions AS function_state
      INNER JOIN pg_catalog.pg_roles AS function_owner
        ON function_owner.oid = function_state.proowner
      WHERE true ${functionOwnerVerification})
    AND NOT EXISTS (
      SELECT expected.oid
      FROM pg_catalog.unnest(ARRAY[
        ${allFunctionRegprocedures}
      ]::oid[]) AS expected(oid)
      WHERE expected.oid IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM wallet_registration_tables AS table_state
      CROSS JOIN pg_catalog.pg_roles AS runtime_role
      WHERE runtime_role.rolname IN (${api}, ${worker}, ${legacy})
        AND pg_catalog.has_table_privilege(
          runtime_role.oid,
          table_state.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM wallet_registration_tables AS table_state
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(table_state.relacl, pg_catalog.acldefault('r', table_state.relowner))
      ) AS acl
      WHERE acl.grantee <> table_state.relowner
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      INNER JOIN wallet_registration_tables AS table_state
        ON table_state.oid = attribute.attrelid
      WHERE attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND (
          attribute.attname IN (
            'address', 'canonical_address', 'domain', 'origin', 'uri',
            'message', 'nonce', 'signature', 'connection_metadata'
          )
          OR attribute.attname LIKE '%plaintext%'
        )
    )
    AND (SELECT pg_catalog.count(*) = 4
      FROM pg_catalog.pg_trigger AS trigger_state
      WHERE trigger_state.tgrelid IN (
          SELECT table_state.oid FROM wallet_registration_tables AS table_state
        )
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgenabled = 'A'
        AND trigger_state.tgname IN (
          'wallet_ownership_challenge_binding_immutable',
          'registered_wallet_identity_immutable',
          'wallet_registration_audit_append_only_row',
          'wallet_registration_audit_append_only_truncate'
        ))
    AND NOT EXISTS (
      SELECT expected.constraint_name
      FROM pg_catalog.unnest(ARRAY[
        'wallet_ownership_challenge_registry_check',
        'wallet_ownership_challenge_payload_encryption_check',
        'wallet_ownership_challenge_message_unique',
        'wallet_ownership_challenge_nonce_unique',
        'wallet_ownership_challenge_state_shape_check',
        'registered_wallet_registry_check',
        'registered_wallet_address_digest_check',
        'registered_wallet_address_encryption_check',
        'registered_wallet_metadata_encryption_check',
        'wallet_registration_audit_shape_check'
      ]::text[]) AS expected(constraint_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.connamespace =
            pg_catalog.to_regnamespace(pg_catalog.current_schema())
          AND constraint_state.conname = expected.constraint_name
          AND constraint_state.convalidated
      )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_state
      INNER JOIN pg_catalog.pg_class AS index_table
        ON index_table.oid = index_state.indexrelid
      WHERE index_table.relnamespace =
          pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND index_table.relname = 'registered_wallets_one_active_identity'
        AND index_state.indisunique
        AND index_state.indisvalid
        AND pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, false)
          = '(status = ''ACTIVE''::text)'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM wallet_registration_functions AS function_state
      WHERE function_state.oid IN (
          ${apiFunctionRegprocedures}
        )
        AND (
          NOT function_state.prosecdef
          OR function_state.proconfig IS DISTINCT FROM ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          OR NOT pg_catalog.has_function_privilege(${api}, function_state.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege(${worker}, function_state.oid, 'EXECUTE')
          OR pg_catalog.has_function_privilege(${legacy}, function_state.oid, 'EXECUTE')
        )
    )
    AND (SELECT pg_catalog.count(*) = 4
      FROM wallet_registration_functions AS function_state
      WHERE function_state.oid IN (
          to_regprocedure('${WALLET_REGISTRATION_API_FUNCTION_IDENTITIES[0]}'),
          to_regprocedure('${WALLET_REGISTRATION_API_FUNCTION_IDENTITIES[1]}'),
          to_regprocedure('${WALLET_REGISTRATION_API_FUNCTION_IDENTITIES[2]}'),
          to_regprocedure('${WALLET_REGISTRATION_API_FUNCTION_IDENTITIES[3]}')
        )
        AND function_state.provolatile = 'v'
        AND function_state.proparallel = 'u')
    AND NOT EXISTS (
      SELECT 1
      FROM wallet_registration_functions AS function_state
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
  ) AS valid`;

  return `SELECT (prior.valid AND wallet_registration.valid) AS valid
    FROM (${priorVerifier}) AS prior
    CROSS JOIN (${walletVerifier}) AS wallet_registration`;
}

export function createWalletOwnershipRegistrationMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulativePrincipalVerification = options.cumulativePrincipalVerification !== false;
  return {
    id: '0011',
    description: 'create replay-safe encrypted wallet ownership registration',
    upSql: [
      createWalletRegistrationTablesSql(),
      createWalletRegistrationFunctionsSql(),
      createWalletRegistrationCompletionFunctionsSql(),
      createWalletRegistrationTriggersAndAclSql(names),
    ],
    downSql: createWalletRegistrationDownSql(names),
    verifySql: createWalletRegistrationVerifierSql(names, cumulativePrincipalVerification),
    supersedesVerificationOf: ['0010'],
  };
}

export const createWalletOwnershipRegistrationMigrationV0011 =
  createWalletOwnershipRegistrationMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createWalletOwnershipRegistrationTestSchemaMigrationV0011 =
  createWalletOwnershipRegistrationMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
