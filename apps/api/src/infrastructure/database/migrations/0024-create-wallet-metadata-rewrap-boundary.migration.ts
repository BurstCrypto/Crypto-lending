import { createHash } from 'node:crypto';

import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createBalanceConsumerWalletAddressBoundaryMigration } from './0023-create-balance-consumer-wallet-address-boundary.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MAINNET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const PREPARE_REWRAP = 'prepare_wallet_metadata_rewrap(uuid,uuid,uuid,smallint)';
const COMPLETE_REWRAP =
  'complete_wallet_metadata_rewrap(uuid,uuid,uuid,text,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea)';
const RETIREMENT_READINESS = 'wallet_metadata_seal_key_retirement_readiness(smallint)';
const STATE_VERIFIER = 'verify_wallet_metadata_rewrap_state()';
const STATE_FINGERPRINT =
  'wallet_metadata_rewrap_state_sha256(smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea)';
const COMMAND_GUARD = 'enforce_wallet_metadata_rewrap_command_lifecycle()';
const HISTORY_GUARD = 'reject_wallet_metadata_rewrap_history_mutation()';
const MATERIAL_GUARD = 'guard_wallet_metadata_seal_material()';
const TABLES = Object.freeze([
  'wallet_metadata_seal_iv_registry',
  'wallet_metadata_rewrap_commands',
  'wallet_metadata_rewrap_audit_events',
] as const);
const IV_REGISTRY_MANIFEST =
  'crypto-lending:wallet-metadata-rewrap:v1;iv-registry=append-only;material=sha256;plaintext=forbidden';
const COMMAND_MANIFEST =
  'crypto-lending:wallet-metadata-rewrap:v1;scope=one-wallet;ttl=10m;state=optimistic;plaintext=forbidden';
const AUDIT_MANIFEST =
  'crypto-lending:wallet-metadata-rewrap:v1;audit=append-only;ciphertext=forbidden;plaintext=forbidden';

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value))
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`);
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
    throw new Error('Migration 0024 verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const STATE_FINGERPRINT_BODY = `
    SELECT pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_array(
            address_key_version,
            pg_catalog.encode(address_ciphertext, 'hex'),
            pg_catalog.encode(address_iv, 'hex'),
            pg_catalog.encode(address_auth_tag, 'hex'),
            metadata_key_version,
            pg_catalog.encode(metadata_ciphertext, 'hex'),
            pg_catalog.encode(metadata_iv, 'hex'),
            pg_catalog.encode(metadata_auth_tag, 'hex')
          )::text,
          'UTF8'
        )
      ),
      'hex'
    );
    `;

const COMMAND_GUARD_BODY = `
    DECLARE
      authorized_command text := pg_catalog.current_setting(
        'crypto_lending.wallet_metadata_rewrap_command', true
      );
    BEGIN
      IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'wallet metadata rewrap commands cannot be removed'
          USING ERRCODE = '55000';
      END IF;
      IF authorized_command IS DISTINCT FROM NEW.command_id::text
        OR NEW.command_id IS DISTINCT FROM OLD.command_id
        OR NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
        OR NEW.registered_by_challenge_id IS DISTINCT FROM OLD.registered_by_challenge_id
        OR NEW.chain_namespace IS DISTINCT FROM OLD.chain_namespace
        OR NEW.chain_reference IS DISTINCT FROM OLD.chain_reference
        OR NEW.registry_environment IS DISTINCT FROM OLD.registry_environment
        OR NEW.registry_version IS DISTINCT FROM OLD.registry_version
        OR NEW.registry_fingerprint_sha256 IS DISTINCT FROM OLD.registry_fingerprint_sha256
        OR NEW.from_address_key_version IS DISTINCT FROM OLD.from_address_key_version
        OR NEW.from_metadata_key_version IS DISTINCT FROM OLD.from_metadata_key_version
        OR NEW.target_key_version IS DISTINCT FROM OLD.target_key_version
        OR NEW.prepared_state_sha256 IS DISTINCT FROM OLD.prepared_state_sha256
        OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      THEN
        RAISE EXCEPTION 'invalid wallet metadata rewrap command transition'
          USING ERRCODE = '55000';
      END IF;

      IF OLD.status = 'PREPARED' AND NEW.status = 'COMPLETING' THEN
        IF OLD.result_state_sha256 IS NOT NULL
          OR NEW.result_state_sha256 !~ '^[0-9a-f]{64}$'
          OR OLD.completed_at IS NOT NULL
          OR NEW.completed_at IS NOT NULL
        THEN
          RAISE EXCEPTION 'invalid wallet metadata rewrap command transition'
            USING ERRCODE = '55000';
        END IF;
      ELSIF OLD.status = 'COMPLETING' AND NEW.status = 'COMPLETED' THEN
        IF OLD.result_state_sha256 IS NULL
          OR NEW.result_state_sha256 IS DISTINCT FROM OLD.result_state_sha256
          OR OLD.completed_at IS NOT NULL
          OR NEW.completed_at IS NULL
          OR NEW.completed_at < NEW.prepared_at
        THEN
          RAISE EXCEPTION 'invalid wallet metadata rewrap command transition'
            USING ERRCODE = '55000';
        END IF;
      ELSE
        RAISE EXCEPTION 'invalid wallet metadata rewrap command transition'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    `;

const HISTORY_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'wallet metadata rewrap evidence is append-only'
        USING ERRCODE = '55000';
    END;
    `;

const MATERIAL_GUARD_BODY = `
    DECLARE
      command wallet_metadata_rewrap_commands%ROWTYPE;
      command_setting text;
      source_identifier uuid;
      material_hash bytea;
    BEGIN
      IF TG_TABLE_NAME = 'wallet_ownership_challenges' THEN
        IF TG_OP = 'UPDATE' THEN
          IF NEW.challenge_payload_key_version IS NULL
            AND NEW.challenge_payload_ciphertext IS NULL
            AND NEW.challenge_payload_iv IS NULL
            AND NEW.challenge_payload_auth_tag IS NULL
          THEN
            RETURN NEW;
          END IF;
          IF NEW.challenge_payload_key_version IS DISTINCT FROM OLD.challenge_payload_key_version
            OR NEW.challenge_payload_ciphertext IS DISTINCT FROM OLD.challenge_payload_ciphertext
            OR NEW.challenge_payload_iv IS DISTINCT FROM OLD.challenge_payload_iv
            OR NEW.challenge_payload_auth_tag IS DISTINCT FROM OLD.challenge_payload_auth_tag
          THEN
            RAISE EXCEPTION 'wallet challenge sealed material is immutable'
              USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END IF;
        IF NEW.challenge_payload_key_version IS NULL
          AND NEW.challenge_payload_ciphertext IS NULL
          AND NEW.challenge_payload_iv IS NULL
          AND NEW.challenge_payload_auth_tag IS NULL
        THEN
          RETURN NEW;
        END IF;
        IF NEW.challenge_payload_key_version IS NULL
          OR NEW.challenge_payload_ciphertext IS NULL
          OR NEW.challenge_payload_iv IS NULL
          OR NEW.challenge_payload_auth_tag IS NULL
        THEN
          RAISE EXCEPTION 'wallet challenge sealed material is incomplete'
            USING ERRCODE = '23514';
        END IF;
        material_hash := pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.jsonb_build_array(
            NEW.challenge_payload_key_version,
            pg_catalog.encode(NEW.challenge_payload_ciphertext, 'hex'),
            pg_catalog.encode(NEW.challenge_payload_iv, 'hex'),
            pg_catalog.encode(NEW.challenge_payload_auth_tag, 'hex')
          )::text,
          'UTF8'
        ));
        INSERT INTO wallet_metadata_seal_iv_registry (
          source_kind, source_id, sealed_field, key_version, iv,
          material_sha256, captured_by
        ) VALUES (
          'CHALLENGE', NEW.challenge_id, 'CHALLENGE',
          NEW.challenge_payload_key_version, NEW.challenge_payload_iv,
          material_hash, 'RUNTIME'
        );
        RETURN NEW;
      END IF;

      IF TG_TABLE_NAME <> 'registered_wallets' THEN
        RAISE EXCEPTION 'unsupported wallet sealed material relation'
          USING ERRCODE = '55000';
      END IF;

      IF TG_OP = 'UPDATE' THEN
        command_setting := pg_catalog.current_setting(
          'crypto_lending.wallet_metadata_rewrap_command', true
        );
        IF command_setting IS NULL OR command_setting !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN
          RAISE EXCEPTION 'registered wallet sealed material is immutable'
            USING ERRCODE = '55000';
        END IF;
        SELECT rewrap_command.*
        INTO command
        FROM wallet_metadata_rewrap_commands AS rewrap_command
        WHERE rewrap_command.command_id = command_setting::uuid
          AND rewrap_command.account_id = OLD.account_id
          AND rewrap_command.wallet_id = OLD.wallet_id
          AND rewrap_command.status = 'COMPLETING'
        FOR UPDATE;
        IF NOT FOUND
          OR OLD.status <> 'ACTIVE'
          OR OLD.revoked_at IS NOT NULL
          OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
          OR NEW.account_id IS DISTINCT FROM OLD.account_id
          OR NEW.registered_by_challenge_id IS DISTINCT FROM OLD.registered_by_challenge_id
          OR NEW.chain_namespace IS DISTINCT FROM OLD.chain_namespace
          OR NEW.chain_reference IS DISTINCT FROM OLD.chain_reference
          OR NEW.registry_environment IS DISTINCT FROM OLD.registry_environment
          OR NEW.registry_version IS DISTINCT FROM OLD.registry_version
          OR NEW.registry_fingerprint_sha256 IS DISTINCT FROM OLD.registry_fingerprint_sha256
          OR NEW.address_digest_version IS DISTINCT FROM OLD.address_digest_version
          OR NEW.address_digest IS DISTINCT FROM OLD.address_digest
          OR NEW.address_encryption_algorithm IS DISTINCT FROM 'AES_256_GCM'
          OR NEW.metadata_encryption_algorithm IS DISTINCT FROM 'AES_256_GCM'
          OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
          OR command.registered_by_challenge_id IS DISTINCT FROM OLD.registered_by_challenge_id
          OR command.chain_namespace IS DISTINCT FROM OLD.chain_namespace
          OR command.chain_reference IS DISTINCT FROM OLD.chain_reference
          OR command.registry_environment IS DISTINCT FROM OLD.registry_environment
          OR command.registry_version IS DISTINCT FROM OLD.registry_version
          OR command.registry_fingerprint_sha256 IS DISTINCT FROM OLD.registry_fingerprint_sha256
          OR command.from_address_key_version IS DISTINCT FROM OLD.address_key_version
          OR command.from_metadata_key_version IS DISTINCT FROM OLD.metadata_key_version
          OR command.target_key_version IS DISTINCT FROM NEW.address_key_version
          OR command.target_key_version IS DISTINCT FROM NEW.metadata_key_version
          OR command.prepared_state_sha256 IS DISTINCT FROM wallet_metadata_rewrap_state_sha256(
            OLD.address_key_version, OLD.address_ciphertext, OLD.address_iv, OLD.address_auth_tag,
            OLD.metadata_key_version, OLD.metadata_ciphertext, OLD.metadata_iv, OLD.metadata_auth_tag
          )
          OR command.result_state_sha256 IS DISTINCT FROM wallet_metadata_rewrap_state_sha256(
            NEW.address_key_version, NEW.address_ciphertext, NEW.address_iv, NEW.address_auth_tag,
            NEW.metadata_key_version, NEW.metadata_ciphertext, NEW.metadata_iv, NEW.metadata_auth_tag
          )
        THEN
          RAISE EXCEPTION 'registered wallet sealed material is immutable'
            USING ERRCODE = '55000';
        END IF;
      END IF;

      source_identifier := NEW.wallet_id;
      material_hash := pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          NEW.address_key_version,
          pg_catalog.encode(NEW.address_ciphertext, 'hex'),
          pg_catalog.encode(NEW.address_iv, 'hex'),
          pg_catalog.encode(NEW.address_auth_tag, 'hex')
        )::text,
        'UTF8'
      ));
      INSERT INTO wallet_metadata_seal_iv_registry (
        source_kind, source_id, sealed_field, key_version, iv,
        material_sha256, captured_by
      ) VALUES (
        'WALLET', source_identifier, 'ADDRESS', NEW.address_key_version,
        NEW.address_iv, material_hash,
        CASE WHEN TG_OP = 'UPDATE' THEN 'REWRAP' ELSE 'RUNTIME' END
      );

      material_hash := pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          NEW.metadata_key_version,
          pg_catalog.encode(NEW.metadata_ciphertext, 'hex'),
          pg_catalog.encode(NEW.metadata_iv, 'hex'),
          pg_catalog.encode(NEW.metadata_auth_tag, 'hex')
        )::text,
        'UTF8'
      ));
      INSERT INTO wallet_metadata_seal_iv_registry (
        source_kind, source_id, sealed_field, key_version, iv,
        material_sha256, captured_by
      ) VALUES (
        'WALLET', source_identifier, 'METADATA', NEW.metadata_key_version,
        NEW.metadata_iv, material_hash,
        CASE WHEN TG_OP = 'UPDATE' THEN 'REWRAP' ELSE 'RUNTIME' END
      );
      RETURN NEW;
    END;
    `;

const PREPARE_REWRAP_BODY = `
    DECLARE
      target_wallet registered_wallets%ROWTYPE;
      existing_command wallet_metadata_rewrap_commands%ROWTYPE;
      policy_active_version smallint;
      verification_digest bytea;
      verification_count bigint;
      current_state_sha256 text;
      recorded_at timestamptz := pg_catalog.clock_timestamp();
    BEGIN
      rewrap_outcome := 'INVALID';
      IF requested_command_id IS NULL
        OR requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR requested_target_key_version IS NULL
        OR requested_target_key_version < 1
        OR pg_catalog.substring(requested_command_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_command_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.substring(requested_wallet_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_wallet_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
      THEN
        RETURN NEXT;
        RETURN;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_command_id::text, 56024)
      );
      SELECT rewrap_command.*
      INTO existing_command
      FROM wallet_metadata_rewrap_commands AS rewrap_command
      WHERE rewrap_command.command_id = requested_command_id
      FOR UPDATE;

      IF FOUND THEN
        IF existing_command.account_id IS DISTINCT FROM requested_account_id
          OR existing_command.wallet_id IS DISTINCT FROM requested_wallet_id
          OR existing_command.target_key_version IS DISTINCT FROM requested_target_key_version
        THEN
          RETURN NEXT;
          RETURN;
        END IF;
        IF existing_command.status = 'COMPLETED' THEN
          rewrap_outcome := 'COMPLETED';
          RETURN NEXT;
          RETURN;
        END IF;
        IF existing_command.status <> 'PREPARED'
          OR recorded_at >= existing_command.expires_at
        THEN
          RETURN NEXT;
          RETURN;
        END IF;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_wallet_id::text, 56025)
      );
      SELECT wallet.*
      INTO target_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
        AND wallet.revoked_at IS NULL
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
        AND (
          (wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
          OR (wallet.chain_namespace = 'solana'
            AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        )
        AND wallet.address_encryption_algorithm = 'AES_256_GCM'
        AND wallet.metadata_encryption_algorithm = 'AES_256_GCM'
        AND pg_catalog.octet_length(wallet.address_digest) = 32
        AND pg_catalog.octet_length(wallet.address_ciphertext) BETWEEN 1 AND 128
        AND pg_catalog.octet_length(wallet.address_iv) = 12
        AND pg_catalog.octet_length(wallet.address_auth_tag) = 16
        AND pg_catalog.octet_length(wallet.metadata_ciphertext) BETWEEN 1 AND 8192
        AND pg_catalog.octet_length(wallet.metadata_iv) = 12
        AND pg_catalog.octet_length(wallet.metadata_auth_tag) = 16
      FOR UPDATE;
      IF NOT FOUND
        OR requested_target_key_version <= target_wallet.address_key_version
        OR requested_target_key_version <= target_wallet.metadata_key_version
      THEN
        RETURN NEXT;
        RETURN;
      END IF;

      current_state_sha256 := wallet_metadata_rewrap_state_sha256(
        target_wallet.address_key_version,
        target_wallet.address_ciphertext,
        target_wallet.address_iv,
        target_wallet.address_auth_tag,
        target_wallet.metadata_key_version,
        target_wallet.metadata_ciphertext,
        target_wallet.metadata_iv,
        target_wallet.metadata_auth_tag
      );
      IF existing_command.command_id IS NOT NULL
        AND (
          existing_command.registered_by_challenge_id
            IS DISTINCT FROM target_wallet.registered_by_challenge_id
          OR existing_command.chain_namespace IS DISTINCT FROM target_wallet.chain_namespace
          OR existing_command.chain_reference IS DISTINCT FROM target_wallet.chain_reference
          OR existing_command.registry_environment IS DISTINCT FROM target_wallet.registry_environment
          OR existing_command.registry_version IS DISTINCT FROM target_wallet.registry_version
          OR existing_command.registry_fingerprint_sha256
            IS DISTINCT FROM target_wallet.registry_fingerprint_sha256
          OR existing_command.from_address_key_version
            IS DISTINCT FROM target_wallet.address_key_version
          OR existing_command.from_metadata_key_version
            IS DISTINCT FROM target_wallet.metadata_key_version
          OR existing_command.prepared_state_sha256 IS DISTINCT FROM current_state_sha256
        )
      THEN
        RETURN NEXT;
        RETURN;
      END IF;

      SELECT key_policy.active_write_version
      INTO policy_active_version
      FROM wallet_identity_key_policy AS key_policy
      WHERE key_policy.policy_name = 'wallet-registration-identity-hmac'
        AND key_policy.schema_version = 1
        AND key_policy.active_write_version = ANY (key_policy.accepted_read_versions);
      IF NOT FOUND THEN
        RETURN NEXT;
        RETURN;
      END IF;

      SELECT pg_catalog.count(*), (pg_catalog.array_agg(alias.address_digest))[1]
      INTO verification_count, verification_digest
      FROM registered_wallet_identity_digests AS alias
      WHERE alias.wallet_id = target_wallet.wallet_id
        AND alias.account_id = target_wallet.account_id
        AND alias.chain_namespace = target_wallet.chain_namespace
        AND alias.chain_reference = target_wallet.chain_reference
        AND alias.address_digest_version = policy_active_version
        AND alias.status = 'ACTIVE'
        AND alias.registered_at = target_wallet.registered_at
        AND alias.revoked_at IS NULL;
      IF verification_count <> 1 OR pg_catalog.octet_length(verification_digest) <> 32 THEN
        RETURN NEXT;
        RETURN;
      END IF;

      IF existing_command.command_id IS NULL THEN
        IF EXISTS (
          SELECT 1
          FROM wallet_metadata_rewrap_commands AS open_command
          WHERE open_command.wallet_id = requested_wallet_id
            AND open_command.status IN ('PREPARED', 'COMPLETING')
            AND open_command.expires_at > recorded_at
        ) THEN
          RETURN NEXT;
          RETURN;
        END IF;
        INSERT INTO wallet_metadata_rewrap_commands (
          command_id, account_id, wallet_id, registered_by_challenge_id,
          chain_namespace, chain_reference, registry_environment,
          registry_version, registry_fingerprint_sha256,
          from_address_key_version, from_metadata_key_version,
          target_key_version, prepared_state_sha256, prepared_at, expires_at
        ) VALUES (
          requested_command_id, requested_account_id, requested_wallet_id,
          target_wallet.registered_by_challenge_id,
          target_wallet.chain_namespace, target_wallet.chain_reference,
          target_wallet.registry_environment, target_wallet.registry_version,
          target_wallet.registry_fingerprint_sha256,
          target_wallet.address_key_version, target_wallet.metadata_key_version,
          requested_target_key_version, current_state_sha256,
          recorded_at, recorded_at + interval '10 minutes'
        );
        INSERT INTO wallet_metadata_rewrap_audit_events (
          command_id, event_type, from_address_key_version,
          from_metadata_key_version, target_key_version, state_sha256, occurred_at
        ) VALUES (
          requested_command_id, 'PREPARED', target_wallet.address_key_version,
          target_wallet.metadata_key_version, requested_target_key_version,
          current_state_sha256, recorded_at
        );
        SELECT rewrap_command.*
        INTO STRICT existing_command
        FROM wallet_metadata_rewrap_commands AS rewrap_command
        WHERE rewrap_command.command_id = requested_command_id;
      END IF;

      rewrap_outcome := 'PREPARED';
      prepared_command_id := requested_command_id;
      prepared_account_id := requested_account_id;
      prepared_wallet_id := requested_wallet_id;
      prepared_challenge_id := target_wallet.registered_by_challenge_id;
      prepared_chain_namespace := target_wallet.chain_namespace;
      prepared_chain_reference := target_wallet.chain_reference;
      prepared_registry_environment := target_wallet.registry_environment;
      prepared_registry_version := target_wallet.registry_version;
      prepared_registry_fingerprint_sha256 := target_wallet.registry_fingerprint_sha256;
      prepared_address_digest_version := target_wallet.address_digest_version;
      prepared_address_digest := target_wallet.address_digest;
      prepared_verification_digest_version := policy_active_version;
      prepared_verification_digest := verification_digest;
      prepared_address_key_version := target_wallet.address_key_version;
      prepared_address_ciphertext := target_wallet.address_ciphertext;
      prepared_address_iv := target_wallet.address_iv;
      prepared_address_auth_tag := target_wallet.address_auth_tag;
      prepared_metadata_key_version := target_wallet.metadata_key_version;
      prepared_metadata_ciphertext := target_wallet.metadata_ciphertext;
      prepared_metadata_iv := target_wallet.metadata_iv;
      prepared_metadata_auth_tag := target_wallet.metadata_auth_tag;
      prepared_state_sha256 := current_state_sha256;
      prepared_expires_at := existing_command.expires_at;
      RETURN NEXT;
    END;
    `;

const COMPLETE_REWRAP_BODY = `
    DECLARE
      target_command wallet_metadata_rewrap_commands%ROWTYPE;
      target_wallet registered_wallets%ROWTYPE;
      current_state_sha256 text;
      requested_state_sha256 text;
      recorded_at timestamptz := pg_catalog.clock_timestamp();
    BEGIN
      rewrap_outcome := 'INVALID';
      IF requested_command_id IS NULL
        OR requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR requested_prepared_state_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_address_key_version IS NULL
        OR requested_address_key_version < 1
        OR requested_address_ciphertext IS NULL
        OR pg_catalog.octet_length(requested_address_ciphertext) NOT BETWEEN 1 AND 128
        OR requested_address_iv IS NULL
        OR pg_catalog.octet_length(requested_address_iv) <> 12
        OR requested_address_auth_tag IS NULL
        OR pg_catalog.octet_length(requested_address_auth_tag) <> 16
        OR requested_metadata_key_version IS NULL
        OR requested_metadata_key_version < 1
        OR requested_metadata_ciphertext IS NULL
        OR pg_catalog.octet_length(requested_metadata_ciphertext) NOT BETWEEN 1 AND 8192
        OR requested_metadata_iv IS NULL
        OR pg_catalog.octet_length(requested_metadata_iv) <> 12
        OR requested_metadata_auth_tag IS NULL
        OR pg_catalog.octet_length(requested_metadata_auth_tag) <> 16
        OR pg_catalog.substring(requested_command_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_command_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
      THEN
        RETURN NEXT;
        RETURN;
      END IF;
      requested_state_sha256 := wallet_metadata_rewrap_state_sha256(
        requested_address_key_version, requested_address_ciphertext,
        requested_address_iv, requested_address_auth_tag,
        requested_metadata_key_version, requested_metadata_ciphertext,
        requested_metadata_iv, requested_metadata_auth_tag
      );

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_command_id::text, 56024)
      );
      SELECT rewrap_command.*
      INTO target_command
      FROM wallet_metadata_rewrap_commands AS rewrap_command
      WHERE rewrap_command.command_id = requested_command_id
      FOR UPDATE;
      IF NOT FOUND
        OR target_command.account_id IS DISTINCT FROM requested_account_id
        OR target_command.wallet_id IS DISTINCT FROM requested_wallet_id
        OR target_command.prepared_state_sha256
          IS DISTINCT FROM requested_prepared_state_sha256
      THEN
        RETURN NEXT;
        RETURN;
      END IF;
      IF target_command.status = 'COMPLETED' THEN
        IF target_command.target_key_version = requested_address_key_version
          AND target_command.target_key_version = requested_metadata_key_version
          AND target_command.result_state_sha256 = requested_state_sha256
        THEN
          rewrap_outcome := 'COMPLETED';
        END IF;
        RETURN NEXT;
        RETURN;
      END IF;
      IF target_command.status <> 'PREPARED' OR recorded_at >= target_command.expires_at THEN
        RETURN NEXT;
        RETURN;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_wallet_id::text, 56025)
      );
      SELECT wallet.*
      INTO target_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
      FOR UPDATE;
      IF NOT FOUND
        OR target_wallet.status <> 'ACTIVE'
        OR target_wallet.revoked_at IS NOT NULL
        OR target_wallet.registered_by_challenge_id
          IS DISTINCT FROM target_command.registered_by_challenge_id
        OR target_wallet.chain_namespace IS DISTINCT FROM target_command.chain_namespace
        OR target_wallet.chain_reference IS DISTINCT FROM target_command.chain_reference
        OR target_wallet.registry_environment IS DISTINCT FROM 'MAINNET'
        OR target_wallet.registry_environment IS DISTINCT FROM target_command.registry_environment
        OR target_wallet.registry_version IS DISTINCT FROM target_command.registry_version
        OR target_wallet.registry_fingerprint_sha256
          IS DISTINCT FROM target_command.registry_fingerprint_sha256
        OR target_wallet.address_key_version
          IS DISTINCT FROM target_command.from_address_key_version
        OR target_wallet.metadata_key_version
          IS DISTINCT FROM target_command.from_metadata_key_version
        OR requested_address_key_version IS DISTINCT FROM target_command.target_key_version
        OR requested_metadata_key_version IS DISTINCT FROM target_command.target_key_version
        OR requested_address_key_version <= target_wallet.address_key_version
        OR requested_metadata_key_version <= target_wallet.metadata_key_version
      THEN
        RETURN NEXT;
        RETURN;
      END IF;
      current_state_sha256 := wallet_metadata_rewrap_state_sha256(
        target_wallet.address_key_version, target_wallet.address_ciphertext,
        target_wallet.address_iv, target_wallet.address_auth_tag,
        target_wallet.metadata_key_version, target_wallet.metadata_ciphertext,
        target_wallet.metadata_iv, target_wallet.metadata_auth_tag
      );
      IF current_state_sha256 IS DISTINCT FROM target_command.prepared_state_sha256
        OR current_state_sha256 IS DISTINCT FROM requested_prepared_state_sha256
        OR requested_address_iv = target_wallet.address_iv
        OR requested_metadata_iv = target_wallet.metadata_iv
        OR requested_address_iv = requested_metadata_iv
        OR requested_address_ciphertext = target_wallet.address_ciphertext
        OR requested_metadata_ciphertext = target_wallet.metadata_ciphertext
        OR requested_address_ciphertext = requested_metadata_ciphertext
        OR requested_address_auth_tag = target_wallet.address_auth_tag
        OR requested_metadata_auth_tag = target_wallet.metadata_auth_tag
        OR requested_address_auth_tag = requested_metadata_auth_tag
      THEN
        RETURN NEXT;
        RETURN;
      END IF;

      PERFORM pg_catalog.set_config(
        'crypto_lending.wallet_metadata_rewrap_command', requested_command_id::text, true
      );
      UPDATE wallet_metadata_rewrap_commands AS rewrap_command
      SET status = 'COMPLETING', result_state_sha256 = requested_state_sha256
      WHERE rewrap_command.command_id = requested_command_id;

      UPDATE registered_wallets AS wallet
      SET address_key_version = requested_address_key_version,
          address_ciphertext = requested_address_ciphertext,
          address_iv = requested_address_iv,
          address_auth_tag = requested_address_auth_tag,
          metadata_key_version = requested_metadata_key_version,
          metadata_ciphertext = requested_metadata_ciphertext,
          metadata_iv = requested_metadata_iv,
          metadata_auth_tag = requested_metadata_auth_tag
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet metadata rewrap failed' USING ERRCODE = '55000';
      END IF;

      recorded_at := pg_catalog.clock_timestamp();
      UPDATE wallet_metadata_rewrap_commands AS rewrap_command
      SET status = 'COMPLETED', completed_at = recorded_at
      WHERE rewrap_command.command_id = requested_command_id;
      INSERT INTO wallet_metadata_rewrap_audit_events (
        command_id, event_type, from_address_key_version,
        from_metadata_key_version, target_key_version, state_sha256, occurred_at
      ) VALUES (
        requested_command_id, 'COMPLETED', target_command.from_address_key_version,
        target_command.from_metadata_key_version, target_command.target_key_version,
        requested_state_sha256, recorded_at
      );
      PERFORM pg_catalog.set_config(
        'crypto_lending.wallet_metadata_rewrap_command', '', true
      );
      rewrap_outcome := 'COMPLETED';
      RETURN NEXT;
    END;
    `;

const RETIREMENT_READINESS_BODY = `
    WITH counts AS (
      SELECT
        (SELECT pg_catalog.count(*) FROM registered_wallets
          WHERE address_key_version = candidate_key_version) AS address_count,
        (SELECT pg_catalog.count(*) FROM registered_wallets
          WHERE metadata_key_version = candidate_key_version) AS metadata_count,
        (SELECT pg_catalog.count(*) FROM wallet_ownership_challenges
          WHERE challenge_payload_key_version = candidate_key_version
            AND challenge_payload_ciphertext IS NOT NULL) AS challenge_count,
        (SELECT pg_catalog.count(*) FROM wallet_ownership_challenges
          WHERE challenge_payload_key_version = candidate_key_version
            AND challenge_payload_ciphertext IS NOT NULL
            AND status = 'PENDING'
            AND expires_at > pg_catalog.statement_timestamp()) AS live_challenge_count,
        (SELECT pg_catalog.count(*) FROM wallet_metadata_rewrap_commands
          WHERE status IN ('PREPARED', 'COMPLETING')
            AND expires_at > pg_catalog.statement_timestamp()
            AND (
              from_address_key_version = candidate_key_version
              OR from_metadata_key_version = candidate_key_version
              OR target_key_version = candidate_key_version
            )) AS command_count
    )
    SELECT
      candidate_key_version,
      address_count,
      metadata_count,
      challenge_count,
      live_challenge_count,
      command_count,
      address_count = 0
        AND metadata_count = 0
        AND challenge_count = 0
        AND live_challenge_count = 0
        AND command_count = 0
    FROM counts;
    `;

const STATE_VERIFIER_BODY = `
    SELECT
      NOT EXISTS (
        SELECT 1 FROM wallet_metadata_rewrap_commands WHERE status = 'COMPLETING'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM wallet_ownership_challenges AS challenge
        LEFT JOIN wallet_metadata_seal_iv_registry AS registry
          ON registry.source_kind = 'CHALLENGE'
          AND registry.source_id = challenge.challenge_id
          AND registry.sealed_field = 'CHALLENGE'
          AND registry.key_version = challenge.challenge_payload_key_version
          AND registry.iv = challenge.challenge_payload_iv
          AND registry.material_sha256 = pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.jsonb_build_array(
              challenge.challenge_payload_key_version,
              pg_catalog.encode(challenge.challenge_payload_ciphertext, 'hex'),
              pg_catalog.encode(challenge.challenge_payload_iv, 'hex'),
              pg_catalog.encode(challenge.challenge_payload_auth_tag, 'hex')
            )::text,
            'UTF8'
          ))
        WHERE challenge.challenge_payload_key_version IS NOT NULL
          AND registry.source_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM registered_wallets AS wallet
        LEFT JOIN wallet_metadata_seal_iv_registry AS registry
          ON registry.source_kind = 'WALLET'
          AND registry.source_id = wallet.wallet_id
          AND registry.sealed_field = 'ADDRESS'
          AND registry.key_version = wallet.address_key_version
          AND registry.iv = wallet.address_iv
          AND registry.material_sha256 = pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.jsonb_build_array(
              wallet.address_key_version,
              pg_catalog.encode(wallet.address_ciphertext, 'hex'),
              pg_catalog.encode(wallet.address_iv, 'hex'),
              pg_catalog.encode(wallet.address_auth_tag, 'hex')
            )::text,
            'UTF8'
          ))
        WHERE registry.source_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM registered_wallets AS wallet
        LEFT JOIN wallet_metadata_seal_iv_registry AS registry
          ON registry.source_kind = 'WALLET'
          AND registry.source_id = wallet.wallet_id
          AND registry.sealed_field = 'METADATA'
          AND registry.key_version = wallet.metadata_key_version
          AND registry.iv = wallet.metadata_iv
          AND registry.material_sha256 = pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.jsonb_build_array(
              wallet.metadata_key_version,
              pg_catalog.encode(wallet.metadata_ciphertext, 'hex'),
              pg_catalog.encode(wallet.metadata_iv, 'hex'),
              pg_catalog.encode(wallet.metadata_auth_tag, 'hex')
            )::text,
            'UTF8'
          ))
        WHERE registry.source_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM wallet_metadata_rewrap_commands AS rewrap_command
        LEFT JOIN wallet_metadata_rewrap_audit_events AS prepared
          ON prepared.command_id = rewrap_command.command_id
          AND prepared.event_type = 'PREPARED'
          AND prepared.state_sha256 = rewrap_command.prepared_state_sha256
        LEFT JOIN wallet_metadata_rewrap_audit_events AS completed
          ON completed.command_id = rewrap_command.command_id
          AND completed.event_type = 'COMPLETED'
          AND completed.state_sha256 = rewrap_command.result_state_sha256
        WHERE prepared.audit_id IS NULL
          OR (rewrap_command.status = 'COMPLETED' AND completed.audit_id IS NULL)
          OR (rewrap_command.status <> 'COMPLETED' AND completed.audit_id IS NOT NULL)
      );
    `;

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  return `LOCK TABLE wallet_ownership_challenges, registered_wallets
      IN SHARE ROW EXCLUSIVE MODE;

    CREATE TABLE wallet_metadata_seal_iv_registry (
      source_kind text NOT NULL,
      source_id uuid NOT NULL,
      sealed_field text NOT NULL,
      key_version smallint NOT NULL,
      iv bytea NOT NULL,
      material_sha256 bytea NOT NULL,
      captured_by text NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      CONSTRAINT wallet_metadata_seal_iv_registry_pk PRIMARY KEY (
        source_kind, source_id, sealed_field, key_version
      ),
      CONSTRAINT wallet_metadata_seal_iv_registry_source_check CHECK (
        (source_kind = 'CHALLENGE' AND sealed_field = 'CHALLENGE')
        OR (source_kind = 'WALLET' AND sealed_field IN ('ADDRESS', 'METADATA'))
      ),
      CONSTRAINT wallet_metadata_seal_iv_registry_shape_check CHECK (
        key_version > 0
        AND pg_catalog.octet_length(iv) = 12
        AND pg_catalog.octet_length(material_sha256) = 32
        AND captured_by IN ('BACKFILL', 'RUNTIME', 'REWRAP')
      ),
      CONSTRAINT wallet_metadata_seal_iv_registry_iv_unique UNIQUE (key_version, iv),
      CONSTRAINT wallet_metadata_seal_iv_registry_material_unique UNIQUE (material_sha256)
    );

    CREATE TABLE wallet_metadata_rewrap_commands (
      command_id uuid PRIMARY KEY,
      account_id uuid NOT NULL,
      wallet_id uuid NOT NULL,
      registered_by_challenge_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      registry_environment text NOT NULL,
      registry_version integer NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      from_address_key_version smallint NOT NULL,
      from_metadata_key_version smallint NOT NULL,
      target_key_version smallint NOT NULL,
      prepared_state_sha256 text NOT NULL,
      result_state_sha256 text,
      status text NOT NULL DEFAULT 'PREPARED',
      prepared_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      completed_at timestamptz,
      CONSTRAINT wallet_metadata_rewrap_command_uuid_v4_check CHECK (
        pg_catalog.substring(command_id::text, 15, 1) = '4'
        AND pg_catalog.substring(command_id::text, 20, 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT wallet_metadata_rewrap_command_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_metadata_rewrap_command_wallet_fk FOREIGN KEY (wallet_id)
        REFERENCES registered_wallets (wallet_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_metadata_rewrap_command_challenge_fk
        FOREIGN KEY (registered_by_challenge_id)
        REFERENCES wallet_ownership_challenges (challenge_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_metadata_rewrap_command_network_check CHECK (
        (chain_namespace = 'eip155' AND chain_reference = '1')
        OR (chain_namespace = 'solana'
          AND chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
      ),
      CONSTRAINT wallet_metadata_rewrap_command_registry_check CHECK (
        registry_environment = 'MAINNET'
        AND registry_version = 1
        AND registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
      ),
      CONSTRAINT wallet_metadata_rewrap_command_version_check CHECK (
        from_address_key_version > 0
        AND from_metadata_key_version > 0
        AND target_key_version > from_address_key_version
        AND target_key_version > from_metadata_key_version
      ),
      CONSTRAINT wallet_metadata_rewrap_command_fingerprint_check CHECK (
        prepared_state_sha256 ~ '^[0-9a-f]{64}$'
        AND (result_state_sha256 IS NULL OR result_state_sha256 ~ '^[0-9a-f]{64}$')
      ),
      CONSTRAINT wallet_metadata_rewrap_command_lifetime_check CHECK (
        expires_at = prepared_at + interval '10 minutes'
        AND (completed_at IS NULL OR completed_at >= prepared_at)
      ),
      CONSTRAINT wallet_metadata_rewrap_command_state_check CHECK (
        (status = 'PREPARED' AND result_state_sha256 IS NULL AND completed_at IS NULL)
        OR (status = 'COMPLETING'
          AND result_state_sha256 IS NOT NULL AND completed_at IS NULL)
        OR (status = 'COMPLETED'
          AND result_state_sha256 IS NOT NULL AND completed_at IS NOT NULL)
      )
    );
    CREATE INDEX wallet_metadata_rewrap_commands_wallet_timeline_idx
      ON wallet_metadata_rewrap_commands (wallet_id, prepared_at DESC, command_id);
    CREATE INDEX wallet_metadata_rewrap_commands_open_expiry_idx
      ON wallet_metadata_rewrap_commands (expires_at, wallet_id, command_id)
      WHERE status IN ('PREPARED', 'COMPLETING');

    CREATE TABLE wallet_metadata_rewrap_audit_events (
      audit_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      command_id uuid NOT NULL,
      event_type text NOT NULL,
      from_address_key_version smallint NOT NULL,
      from_metadata_key_version smallint NOT NULL,
      target_key_version smallint NOT NULL,
      state_sha256 text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
      CONSTRAINT wallet_metadata_rewrap_audit_command_fk FOREIGN KEY (command_id)
        REFERENCES wallet_metadata_rewrap_commands (command_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_metadata_rewrap_audit_event_unique UNIQUE (command_id, event_type),
      CONSTRAINT wallet_metadata_rewrap_audit_shape_check CHECK (
        event_type IN ('PREPARED', 'COMPLETED')
        AND from_address_key_version > 0
        AND from_metadata_key_version > 0
        AND target_key_version > from_address_key_version
        AND target_key_version > from_metadata_key_version
        AND state_sha256 ~ '^[0-9a-f]{64}$'
      )
    );

    COMMENT ON TABLE wallet_metadata_seal_iv_registry IS '${IV_REGISTRY_MANIFEST}';
    COMMENT ON TABLE wallet_metadata_rewrap_commands IS '${COMMAND_MANIFEST}';
    COMMENT ON TABLE wallet_metadata_rewrap_audit_events IS '${AUDIT_MANIFEST}';

    CREATE FUNCTION wallet_metadata_rewrap_state_sha256(
      address_key_version smallint,
      address_ciphertext bytea,
      address_iv bytea,
      address_auth_tag bytea,
      metadata_key_version smallint,
      metadata_ciphertext bytea,
      metadata_iv bytea,
      metadata_auth_tag bytea
    ) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${STATE_FINGERPRINT_BODY}$function$;

    INSERT INTO wallet_metadata_seal_iv_registry (
      source_kind, source_id, sealed_field, key_version, iv,
      material_sha256, captured_by, recorded_at
    )
    SELECT
      source_kind, source_id, sealed_field, key_version, iv,
      pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          key_version, pg_catalog.encode(ciphertext, 'hex'),
          pg_catalog.encode(iv, 'hex'), pg_catalog.encode(auth_tag, 'hex')
        )::text,
        'UTF8'
      )),
      'BACKFILL', recorded_at
    FROM (
      SELECT 'CHALLENGE'::text AS source_kind, challenge_id AS source_id,
             'CHALLENGE'::text AS sealed_field,
             challenge_payload_key_version AS key_version,
             challenge_payload_ciphertext AS ciphertext,
             challenge_payload_iv AS iv,
             challenge_payload_auth_tag AS auth_tag,
             created_at AS recorded_at
      FROM wallet_ownership_challenges
      WHERE challenge_payload_key_version IS NOT NULL
      UNION ALL
      SELECT 'WALLET', wallet_id, 'ADDRESS', address_key_version,
             address_ciphertext, address_iv, address_auth_tag, registered_at
      FROM registered_wallets
      UNION ALL
      SELECT 'WALLET', wallet_id, 'METADATA', metadata_key_version,
             metadata_ciphertext, metadata_iv, metadata_auth_tag, registered_at
      FROM registered_wallets
    ) AS retained_material;

    CREATE FUNCTION ${COMMAND_GUARD} RETURNS trigger
    LANGUAGE plpgsql PARALLEL UNSAFE
    SET search_path TO pg_catalog
    AS $function$${COMMAND_GUARD_BODY}$function$;
    CREATE FUNCTION ${HISTORY_GUARD} RETURNS trigger
    LANGUAGE plpgsql PARALLEL UNSAFE
    SET search_path TO pg_catalog
    AS $function$${HISTORY_GUARD_BODY}$function$;
    CREATE FUNCTION ${MATERIAL_GUARD} RETURNS trigger
    LANGUAGE plpgsql PARALLEL UNSAFE
    AS $function$${MATERIAL_GUARD_BODY}$function$;

    CREATE FUNCTION prepare_wallet_metadata_rewrap(
      requested_command_id uuid,
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_target_key_version smallint
    ) RETURNS TABLE (
      rewrap_outcome text,
      prepared_command_id uuid,
      prepared_account_id uuid,
      prepared_wallet_id uuid,
      prepared_challenge_id uuid,
      prepared_chain_namespace text,
      prepared_chain_reference text,
      prepared_registry_environment text,
      prepared_registry_version integer,
      prepared_registry_fingerprint_sha256 text,
      prepared_address_digest_version smallint,
      prepared_address_digest bytea,
      prepared_verification_digest_version smallint,
      prepared_verification_digest bytea,
      prepared_address_key_version smallint,
      prepared_address_ciphertext bytea,
      prepared_address_iv bytea,
      prepared_address_auth_tag bytea,
      prepared_metadata_key_version smallint,
      prepared_metadata_ciphertext bytea,
      prepared_metadata_iv bytea,
      prepared_metadata_auth_tag bytea,
      prepared_state_sha256 text,
      prepared_expires_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${PREPARE_REWRAP_BODY}$function$;

    CREATE FUNCTION complete_wallet_metadata_rewrap(
      requested_command_id uuid,
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_prepared_state_sha256 text,
      requested_address_key_version smallint,
      requested_address_ciphertext bytea,
      requested_address_iv bytea,
      requested_address_auth_tag bytea,
      requested_metadata_key_version smallint,
      requested_metadata_ciphertext bytea,
      requested_metadata_iv bytea,
      requested_metadata_auth_tag bytea
    ) RETURNS TABLE (rewrap_outcome text)
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${COMPLETE_REWRAP_BODY}$function$;

    CREATE FUNCTION wallet_metadata_seal_key_retirement_readiness(
      candidate_key_version smallint
    ) RETURNS TABLE (
      key_version smallint,
      registered_address_count bigint,
      registered_metadata_count bigint,
      retained_challenge_count bigint,
      unexpired_challenge_count bigint,
      open_rewrap_command_count bigint,
      ready boolean
    ) LANGUAGE sql SECURITY DEFINER STABLE STRICT PARALLEL UNSAFE ROWS 1
    AS $function$${RETIREMENT_READINESS_BODY}$function$;

    CREATE FUNCTION ${STATE_VERIFIER} RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE PARALLEL UNSAFE
    AS $function$${STATE_VERIFIER_BODY}$function$;

    DROP TRIGGER registered_wallet_identity_immutable ON registered_wallets;
    CREATE TRIGGER registered_wallet_identity_immutable
      BEFORE UPDATE OF
        wallet_id, account_id, registered_by_challenge_id,
        chain_namespace, chain_reference, registry_environment,
        registry_version, registry_fingerprint_sha256,
        address_digest_version, address_digest, registered_at
      ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION enforce_registered_wallet_identity_immutability();

    CREATE TRIGGER wallet_metadata_rewrap_command_lifecycle_row
      BEFORE UPDATE OR DELETE ON wallet_metadata_rewrap_commands
      FOR EACH ROW EXECUTE FUNCTION ${COMMAND_GUARD};
    CREATE TRIGGER wallet_metadata_rewrap_command_lifecycle_truncate
      BEFORE TRUNCATE ON wallet_metadata_rewrap_commands
      FOR EACH STATEMENT EXECUTE FUNCTION ${COMMAND_GUARD};
    CREATE TRIGGER wallet_metadata_rewrap_audit_append_only_row
      BEFORE UPDATE OR DELETE ON wallet_metadata_rewrap_audit_events
      FOR EACH ROW EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER wallet_metadata_rewrap_audit_append_only_truncate
      BEFORE TRUNCATE ON wallet_metadata_rewrap_audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER wallet_metadata_seal_iv_registry_append_only_row
      BEFORE UPDATE OR DELETE ON wallet_metadata_seal_iv_registry
      FOR EACH ROW EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER wallet_metadata_seal_iv_registry_append_only_truncate
      BEFORE TRUNCATE ON wallet_metadata_seal_iv_registry
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER wallet_challenge_seal_material_insert
      BEFORE INSERT ON wallet_ownership_challenges
      FOR EACH ROW EXECUTE FUNCTION ${MATERIAL_GUARD};
    CREATE TRIGGER registered_wallet_seal_material_insert
      BEFORE INSERT ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION ${MATERIAL_GUARD};
    CREATE TRIGGER registered_wallet_seal_material_rewrap
      BEFORE UPDATE OF
        address_encryption_algorithm, address_key_version, address_ciphertext,
        address_iv, address_auth_tag, metadata_encryption_algorithm,
        metadata_key_version, metadata_ciphertext, metadata_iv, metadata_auth_tag
      ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION ${MATERIAL_GUARD};

    ALTER TABLE wallet_metadata_rewrap_commands
      ENABLE ALWAYS TRIGGER wallet_metadata_rewrap_command_lifecycle_row;
    ALTER TABLE wallet_metadata_rewrap_commands
      ENABLE ALWAYS TRIGGER wallet_metadata_rewrap_command_lifecycle_truncate;
    ALTER TABLE wallet_metadata_rewrap_audit_events
      ENABLE ALWAYS TRIGGER wallet_metadata_rewrap_audit_append_only_row;
    ALTER TABLE wallet_metadata_rewrap_audit_events
      ENABLE ALWAYS TRIGGER wallet_metadata_rewrap_audit_append_only_truncate;
    ALTER TABLE wallet_metadata_seal_iv_registry
      ENABLE ALWAYS TRIGGER wallet_metadata_seal_iv_registry_append_only_row;
    ALTER TABLE wallet_metadata_seal_iv_registry
      ENABLE ALWAYS TRIGGER wallet_metadata_seal_iv_registry_append_only_truncate;
    ALTER TABLE wallet_ownership_challenges
      ENABLE ALWAYS TRIGGER wallet_challenge_seal_material_insert;
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_seal_material_insert;
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_seal_material_rewrap;
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_identity_immutable;

    DO $set_wallet_metadata_rewrap_paths$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        '${MATERIAL_GUARD}', '${PREPARE_REWRAP}',
        '${COMPLETE_REWRAP}', '${RETIREMENT_READINESS}', '${STATE_VERIFIER}'
      ] LOOP
        EXECUTE pg_catalog.format(
          'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
          migration_schema, function_identity, migration_schema
        );
      END LOOP;
    END;
    $set_wallet_metadata_rewrap_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${STATE_FINGERPRINT}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${COMMAND_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${HISTORY_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${MATERIAL_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${PREPARE_REWRAP}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${COMPLETE_REWRAP}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${RETIREMENT_READINESS}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${STATE_VERIFIER}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};`;
}

function createDownSql(): string {
  return `DO $refuse_used_wallet_metadata_rewrap_rollback$
    BEGIN
      IF EXISTS (SELECT 1 FROM wallet_metadata_rewrap_commands)
        OR EXISTS (SELECT 1 FROM wallet_metadata_rewrap_audit_events)
        OR EXISTS (
          SELECT 1 FROM wallet_metadata_seal_iv_registry
          WHERE captured_by <> 'BACKFILL'
        )
      THEN
        RAISE EXCEPTION 'cannot roll back wallet metadata rewrap boundary after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_used_wallet_metadata_rewrap_rollback$;

    DROP TRIGGER registered_wallet_seal_material_rewrap ON registered_wallets;
    DROP TRIGGER registered_wallet_seal_material_insert ON registered_wallets;
    DROP TRIGGER wallet_challenge_seal_material_insert ON wallet_ownership_challenges;
    DROP TRIGGER wallet_metadata_seal_iv_registry_append_only_truncate
      ON wallet_metadata_seal_iv_registry;
    DROP TRIGGER wallet_metadata_seal_iv_registry_append_only_row
      ON wallet_metadata_seal_iv_registry;
    DROP TRIGGER wallet_metadata_rewrap_audit_append_only_truncate
      ON wallet_metadata_rewrap_audit_events;
    DROP TRIGGER wallet_metadata_rewrap_audit_append_only_row
      ON wallet_metadata_rewrap_audit_events;
    DROP TRIGGER wallet_metadata_rewrap_command_lifecycle_truncate
      ON wallet_metadata_rewrap_commands;
    DROP TRIGGER wallet_metadata_rewrap_command_lifecycle_row
      ON wallet_metadata_rewrap_commands;

    DROP TRIGGER registered_wallet_identity_immutable ON registered_wallets;
    CREATE TRIGGER registered_wallet_identity_immutable
      BEFORE UPDATE ON registered_wallets
      FOR EACH ROW EXECUTE FUNCTION enforce_registered_wallet_identity_immutability();
    ALTER TABLE registered_wallets
      ENABLE ALWAYS TRIGGER registered_wallet_identity_immutable;

    DROP FUNCTION ${STATE_VERIFIER};
    DROP FUNCTION ${RETIREMENT_READINESS};
    DROP FUNCTION ${COMPLETE_REWRAP};
    DROP FUNCTION ${PREPARE_REWRAP};
    DROP FUNCTION ${MATERIAL_GUARD};
    DROP FUNCTION ${HISTORY_GUARD};
    DROP FUNCTION ${COMMAND_GUARD};
    DROP FUNCTION ${STATE_FINGERPRINT};
    DROP TABLE wallet_metadata_rewrap_audit_events;
    DROP TABLE wallet_metadata_rewrap_commands;
    DROP TABLE wallet_metadata_seal_iv_registry;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createBalanceConsumerWalletAddressBoundaryMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0023 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  let prior = priorMigration.verifySql;
  prior = replaceExactlyOnce(
    prior,
    `SELECT pg_catalog.count(*) = 12
        FROM pg_catalog.pg_trigger AS all_trigger_state`,
    `SELECT pg_catalog.count(*) = 14
        FROM pg_catalog.pg_trigger AS all_trigger_state`,
  );

  const functionIdentities = [
    STATE_FINGERPRINT,
    COMMAND_GUARD,
    HISTORY_GUARD,
    MATERIAL_GUARD,
    PREPARE_REWRAP,
    COMPLETE_REWRAP,
    RETIREMENT_READINESS,
    STATE_VERIFIER,
  ] as const;
  const constraintNames = [
    'wallet_metadata_seal_iv_registry_pk',
    'wallet_metadata_seal_iv_registry_source_check',
    'wallet_metadata_seal_iv_registry_shape_check',
    'wallet_metadata_seal_iv_registry_iv_unique',
    'wallet_metadata_seal_iv_registry_material_unique',
    'wallet_metadata_rewrap_command_uuid_v4_check',
    'wallet_metadata_rewrap_command_account_fk',
    'wallet_metadata_rewrap_command_wallet_fk',
    'wallet_metadata_rewrap_command_challenge_fk',
    'wallet_metadata_rewrap_command_network_check',
    'wallet_metadata_rewrap_command_registry_check',
    'wallet_metadata_rewrap_command_version_check',
    'wallet_metadata_rewrap_command_fingerprint_check',
    'wallet_metadata_rewrap_command_lifetime_check',
    'wallet_metadata_rewrap_command_state_check',
    'wallet_metadata_rewrap_audit_command_fk',
    'wallet_metadata_rewrap_audit_event_unique',
    'wallet_metadata_rewrap_audit_shape_check',
  ] as const;
  const dataShape = cumulative
    ? 'SELECT true AS valid'
    : 'SELECT verify_wallet_metadata_rewrap_state() AS valid';

  return `SELECT (
    prior.valid AND relations.valid AND types.valid AND functions.valid
    AND triggers.valid AND constraints.valid AND privileges.valid AND data_shape.valid
  ) AS valid
  FROM (${prior}) AS prior
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 3
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AND pg_catalog.bool_and(
        pg_catalog.obj_description(relation.oid, 'pg_class') = CASE relation.relname
          WHEN 'wallet_metadata_seal_iv_registry' THEN '${IV_REGISTRY_MANIFEST}'
          WHEN 'wallet_metadata_rewrap_commands' THEN '${COMMAND_MANIFEST}'
          WHEN 'wallet_metadata_rewrap_audit_events' THEN '${AUDIT_MANIFEST}'
          ELSE NULL
        END
      ) AS valid
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
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AND pg_catalog.bool_and(NOT function_state.proleakproof)
      AND pg_catalog.bool_and(CASE function_state.oid
        WHEN pg_catalog.to_regprocedure('${STATE_FINGERPRINT}')
          THEN NOT function_state.prosecdef AND function_state.provolatile = 'i'
            AND function_state.proparallel = 's' AND function_state.proisstrict
            AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('text')
        WHEN pg_catalog.to_regprocedure('${COMMAND_GUARD}')
          THEN NOT function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
            AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('trigger')
        WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}')
          THEN NOT function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
            AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('trigger')
        WHEN pg_catalog.to_regprocedure('${MATERIAL_GUARD}')
          THEN NOT function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
            AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('trigger')
        WHEN pg_catalog.to_regprocedure('${PREPARE_REWRAP}')
          THEN function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
            AND function_state.proretset AND function_state.prorows = 1
            AND function_state.prorettype = pg_catalog.to_regtype('record')
        WHEN pg_catalog.to_regprocedure('${COMPLETE_REWRAP}')
          THEN function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
            AND function_state.proretset AND function_state.prorows = 1
            AND function_state.prorettype = pg_catalog.to_regtype('text')
        WHEN pg_catalog.to_regprocedure('${RETIREMENT_READINESS}')
          THEN function_state.prosecdef AND function_state.provolatile = 's'
            AND function_state.proparallel = 'u' AND function_state.proisstrict
            AND function_state.proretset AND function_state.prorows = 1
            AND function_state.prorettype = pg_catalog.to_regtype('record')
        WHEN pg_catalog.to_regprocedure('${STATE_VERIFIER}')
          THEN function_state.prosecdef AND function_state.provolatile = 's'
            AND function_state.proparallel = 'u' AND NOT function_state.proisstrict
            AND NOT function_state.proretset
            AND function_state.prorettype = pg_catalog.to_regtype('boolean')
        ELSE false
      END)
      AND pg_catalog.bool_and(function_state.proconfig = CASE
        WHEN function_state.oid IN (
          pg_catalog.to_regprocedure('${STATE_FINGERPRINT}'),
          pg_catalog.to_regprocedure('${COMMAND_GUARD}'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}')
        ) THEN ARRAY['search_path=pg_catalog']::text[]
        ELSE ARRAY[
          'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
        ]::text[]
      END)
      AND pg_catalog.bool_and(
        pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(function_state.prosrc, 'UTF8')),
          'hex'
        ) = CASE function_state.oid
          WHEN pg_catalog.to_regprocedure('${STATE_FINGERPRINT}')
            THEN '${sourceSha256(STATE_FINGERPRINT_BODY)}'
          WHEN pg_catalog.to_regprocedure('${COMMAND_GUARD}')
            THEN '${sourceSha256(COMMAND_GUARD_BODY)}'
          WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}')
            THEN '${sourceSha256(HISTORY_GUARD_BODY)}'
          WHEN pg_catalog.to_regprocedure('${MATERIAL_GUARD}')
            THEN '${sourceSha256(MATERIAL_GUARD_BODY)}'
          WHEN pg_catalog.to_regprocedure('${PREPARE_REWRAP}')
            THEN '${sourceSha256(PREPARE_REWRAP_BODY)}'
          WHEN pg_catalog.to_regprocedure('${COMPLETE_REWRAP}')
            THEN '${sourceSha256(COMPLETE_REWRAP_BODY)}'
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
        ${functionIdentities.map((value) => `pg_catalog.to_regprocedure('${value}')`).join(',\n        ')}
      )
  ) AS functions
  CROSS JOIN (
    WITH expected_triggers(
      relation_name, trigger_name, function_identity, trigger_type, expected_columns
    ) AS (
      VALUES
        ('wallet_metadata_rewrap_commands', 'wallet_metadata_rewrap_command_lifecycle_row', '${COMMAND_GUARD}', 27, ARRAY[]::text[]),
        ('wallet_metadata_rewrap_commands', 'wallet_metadata_rewrap_command_lifecycle_truncate', '${COMMAND_GUARD}', 34, ARRAY[]::text[]),
        ('wallet_metadata_rewrap_audit_events', 'wallet_metadata_rewrap_audit_append_only_row', '${HISTORY_GUARD}', 27, ARRAY[]::text[]),
        ('wallet_metadata_rewrap_audit_events', 'wallet_metadata_rewrap_audit_append_only_truncate', '${HISTORY_GUARD}', 34, ARRAY[]::text[]),
        ('wallet_metadata_seal_iv_registry', 'wallet_metadata_seal_iv_registry_append_only_row', '${HISTORY_GUARD}', 27, ARRAY[]::text[]),
        ('wallet_metadata_seal_iv_registry', 'wallet_metadata_seal_iv_registry_append_only_truncate', '${HISTORY_GUARD}', 34, ARRAY[]::text[]),
        ('wallet_ownership_challenges', 'wallet_challenge_seal_material_insert', '${MATERIAL_GUARD}', 7, ARRAY[]::text[]),
        ('registered_wallets', 'registered_wallet_seal_material_insert', '${MATERIAL_GUARD}', 7, ARRAY[]::text[]),
        ('registered_wallets', 'registered_wallet_seal_material_rewrap', '${MATERIAL_GUARD}', 19, ARRAY[
          'address_encryption_algorithm', 'address_key_version', 'address_ciphertext',
          'address_iv', 'address_auth_tag', 'metadata_encryption_algorithm',
          'metadata_key_version', 'metadata_ciphertext', 'metadata_iv', 'metadata_auth_tag'
        ]::text[]),
        ('registered_wallets', 'registered_wallet_identity_immutable', 'enforce_registered_wallet_identity_immutability()', 19, ARRAY[
          'wallet_id', 'account_id', 'registered_by_challenge_id',
          'chain_namespace', 'chain_reference', 'registry_environment',
          'registry_version', 'registry_fingerprint_sha256',
          'address_digest_version', 'address_digest', 'registered_at'
        ]::text[])
    )
    SELECT pg_catalog.count(*) = 10
      AND pg_catalog.count(trigger_state.oid) = 10
      AND pg_catalog.bool_and(
        trigger_state.oid IS NOT NULL
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgenabled = 'A'
        AND trigger_state.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
        AND trigger_state.tgtype = expected.trigger_type
        AND trigger_state.tgnargs = 0
        AND trigger_state.tgqual IS NULL
        AND trigger_state.tgconstraint = 0
        AND NOT trigger_state.tgdeferrable
        AND NOT trigger_state.tginitdeferred
        AND trigger_state.tgparentid = 0
        AND trigger_state.tgoldtable IS NULL
        AND trigger_state.tgnewtable IS NULL
        AND COALESCE((
          SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY trigger_column.ordinality)
          FROM pg_catalog.unnest(trigger_state.tgattr::smallint[])
            WITH ORDINALITY AS trigger_column(attribute_number, ordinality)
          INNER JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = trigger_state.tgrelid
            AND attribute.attnum = trigger_column.attribute_number
        ), ARRAY[]::text[]) = expected.expected_columns
      )
      AND (
        SELECT pg_catalog.count(*) = 6
        FROM pg_catalog.pg_trigger AS exact_new_table_trigger
        WHERE NOT exact_new_table_trigger.tgisinternal
          AND exact_new_table_trigger.tgrelid IN (
            ${TABLES.map((table) => `pg_catalog.to_regclass('${table}')`).join(',\n            ')}
          )
      ) AS valid
    FROM expected_triggers AS expected
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
    SELECT (
      NOT pg_catalog.has_function_privilege(${api}, '${PREPARE_REWRAP}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${COMPLETE_REWRAP}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${RETIREMENT_READINESS}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${STATE_VERIFIER}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${STATE_VERIFIER}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${PREPARE_REWRAP}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${COMPLETE_REWRAP}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${RETIREMENT_READINESS}', 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS guarded_table
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = guarded_table.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(guarded_table.relacl, pg_catalog.acldefault('r', guarded_table.relowner))
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND guarded_table.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
          AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS guarded_function
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = guarded_function.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(guarded_function.proacl) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND guarded_function.oid IN (
            ${functionIdentities.map((value) => `pg_catalog.to_regprocedure('${value}')`).join(',\n            ')}
          )
          AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid IN (
          ${TABLES.map((table) => `pg_catalog.to_regclass('${table}')`).join(',\n          ')}
        )
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND (
            attribute.attname LIKE '%plaintext%'
            OR attribute.attname LIKE '%ciphertext%'
            OR attribute.attname LIKE '%auth_tag%'
            OR attribute.attname LIKE '%address_digest%'
          )
      )
    ) AS valid
  ) AS privileges
  CROSS JOIN (${dataShape}) AS data_shape`;
}

export function createWalletMetadataRewrapBoundaryMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0024',
    description: 'create guarded wallet address and metadata rewrap boundary',
    upSql: createUpSql(names),
    downSql: createDownSql(),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0023'],
  };
}

export const createWalletMetadataRewrapBoundaryMigrationV0024 =
  createWalletMetadataRewrapBoundaryMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createWalletMetadataRewrapBoundaryTestSchemaMigrationV0024 =
  createWalletMetadataRewrapBoundaryMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
