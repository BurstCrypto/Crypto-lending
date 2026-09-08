import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionLifecycleMigration } from './0033-create-mainnet-financial-action-lifecycle.migration';
import { createMainnetFinancialActionRevocationRecoveryMigration } from './0038-preserve-mainnet-financial-action-recovery-after-wallet-revocation.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const PROOF_TABLE = 'mainnet_financial_action_signed_submission_proofs';
const PROOF_MANIFEST =
  'crypto-lending:mainnet-financial-action-signed-submission-proof:v1;digest-only;append-only;exact-event-bound;owner-only;no-sign-broadcast-resend-or-settlement-authority';
const PROOF_GUARD = 'enforce_mainnet_financial_action_signed_submission_proof_v1';
const COMPLETENESS_GUARD = 'validate_mainnet_financial_action_signed_submission_proof_v1';
const VERIFIED_BIND = 'bind_verified_mainnet_financial_action_submission_v2';
const OLD_BIND = 'bind_mainnet_financial_action_submission';
const OLD_BIND_IDENTITY = `${OLD_BIND}(uuid,uuid,bigint,text,text,text,text,timestamp with time zone,uuid)`;
const PROOF_GUARD_IDENTITY = `${PROOF_GUARD}()`;
const COMPLETENESS_GUARD_IDENTITY = `${COMPLETENESS_GUARD}()`;
const VERIFIED_BIND_IDENTITY = `${VERIFIED_BIND}(uuid,uuid,bigint,text,text,text,text,uuid,smallint,text,text,text,text,text,text,numeric,text)`;
const UINT64_MAX = '18446744073709551615';
const OLD_BIND_RESULT_COLUMNS_SHA256 =
  'b19f764d00c1ac06fbca4c8780fd93b234946dc2024f1df2d77283b5f7d16670';
// PostgreSQL-16 pg_get_constraintdef/catalog digest; fails closed on definition drift.
const PROOF_CONSTRAINT_CATALOG_SHA256 =
  '20413b4daef74e267fe5a1f35e896985a7a2fd4df428fdbde4da859be21e4fa0';

const PROOF_COLUMNS = Object.freeze([
  ['intent_id', 'uuid', true],
  ['event_revision', 'bigint', true],
  ['event_id', 'uuid', true],
  ['event_transition_fingerprint_sha256', 'text', true],
  ['proof_version', 'smallint', true],
  ['verifier_version', 'smallint', true],
  ['intent_record_fingerprint_sha256', 'text', true],
  ['verification_intent_fingerprint_sha256', 'text', true],
  ['network_id', 'text', true],
  ['chain_transaction_id', 'text', true],
  ['transaction_identity_sha256', 'text', true],
  ['signed_envelope_sha256', 'text', true],
  ['signing_payload_sha256', 'text', true],
  ['signature_evidence_sha256', 'text', true],
  ['provider_write_manifest_fingerprint_sha256', 'text', true],
  ['provider_action_binding_sha256', 'text', true],
  ['chain_replay_identity_sha256', 'text', true],
  ['signature_scheme', 'text', true],
  ['ethereum_nonce', 'numeric(20,0)', false],
  ['solana_recent_blockhash', 'text', false],
  ['server_received_and_verified_at', 'timestamp with time zone', true],
  ['recorded_at', 'timestamp with time zone', true],
  ['proof_fingerprint_sha256', 'text', true],
] as const);

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return `"${value}"`;
}

function literal(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return `'${value}'`;
}

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const start = source.indexOf(target);
  if (start < 0 || source.indexOf(target, start + target.length) >= 0) {
    throw new Error('Migration 0039 predecessor verifier anchor mismatch');
  }
  return `${source.slice(0, start)}${replacement}${source.slice(start + target.length)}`;
}

function oldBindResultColumns(names: BalanceConsumerPrincipalNames): string {
  const source = sql(createMainnetFinancialActionLifecycleMigration(names).upSql);
  const startMarker = `CREATE FUNCTION ${OLD_BIND}(`;
  const start = source.indexOf(startMarker);
  if (start < 0 || source.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error('Migration 0039 requires exactly one immutable 0033 bind function');
  }
  const definitionEnd = source.indexOf('$function$;', start);
  if (definitionEnd < 0) throw new Error('Migration 0039 cannot read the 0033 bind definition');
  const definition = source.slice(start, definitionEnd);
  const resultStartMarker = ') RETURNS TABLE (';
  const resultStart = definition.indexOf(resultStartMarker);
  const resultEndMarker = ')\n    LANGUAGE plpgsql';
  const resultEnd = definition.indexOf(resultEndMarker, resultStart);
  if (
    resultStart < 0 ||
    definition.indexOf(resultStartMarker, resultStart + resultStartMarker.length) >= 0 ||
    resultEnd < 0
  ) {
    throw new Error('Migration 0039 cannot pin the immutable 0033 bind result');
  }
  const result = definition.slice(resultStart + resultStartMarker.length, resultEnd);
  if (sourceSha256(result) !== OLD_BIND_RESULT_COLUMNS_SHA256) {
    throw new Error('Migration 0039 immutable 0033 bind result drifted');
  }
  return result;
}

const PROOF_FINGERPRINT = `pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
          'CRYPTO_LENDING:MAINNET_ACTION:SIGNED_SUBMISSION_PROOF:JSONB-ARRAY:v1',
          '1', NEW.proof_version::text, NEW.verifier_version::text,
          NEW.intent_id::text, NEW.event_revision::text, NEW.event_id::text,
          NEW.event_transition_fingerprint_sha256,
          NEW.intent_record_fingerprint_sha256,
          NEW.verification_intent_fingerprint_sha256,
          NEW.network_id, NEW.chain_transaction_id, NEW.transaction_identity_sha256,
          NEW.signed_envelope_sha256, NEW.signing_payload_sha256,
          NEW.signature_evidence_sha256,
          NEW.provider_write_manifest_fingerprint_sha256,
          NEW.provider_action_binding_sha256, NEW.chain_replay_identity_sha256,
          NEW.signature_scheme, NEW.ethereum_nonce::text, NEW.solana_recent_blockhash,
          ((extract(epoch FROM NEW.server_received_and_verified_at)
            * 1000)::bigint)::text,
          ((extract(epoch FROM database_recorded_at) * 1000)::bigint)::text
        )::text, 'UTF8')), 'hex'
      )`;

const PROOF_GUARD_BODY = `
    DECLARE
      selected_intent mainnet_financial_action_intents%ROWTYPE;
      signed_event mainnet_financial_action_events%ROWTYPE;
      database_recorded_at timestamptz;
    BEGIN
      SELECT stored.* INTO STRICT selected_intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = NEW.intent_id
      FOR UPDATE;
      SELECT event.* INTO STRICT signed_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = NEW.intent_id
        AND event.revision = NEW.event_revision
        AND event.event_id = NEW.event_id
        AND event.transition_fingerprint_sha256 =
          NEW.event_transition_fingerprint_sha256
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
      FOR SHARE;
      NEW.server_received_and_verified_at := signed_event.effective_at;
      database_recorded_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF NEW.proof_version IS DISTINCT FROM 1
        OR NEW.verifier_version IS DISTINCT FROM 1
        OR NEW.verification_intent_fingerprint_sha256 IS NULL
        OR NEW.verification_intent_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.verification_intent_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR NEW.signed_envelope_sha256 IS NULL
        OR NEW.signed_envelope_sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.signed_envelope_sha256 = pg_catalog.repeat('0', 64)
        OR NEW.provider_write_manifest_fingerprint_sha256 IS NULL
        OR NEW.provider_write_manifest_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.provider_write_manifest_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR NEW.provider_action_binding_sha256 IS NULL
        OR NEW.provider_action_binding_sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.provider_action_binding_sha256 = pg_catalog.repeat('0', 64)
        OR NEW.chain_replay_identity_sha256 IS NULL
        OR NEW.chain_replay_identity_sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.chain_replay_identity_sha256 = pg_catalog.repeat('0', 64)
        OR NEW.intent_record_fingerprint_sha256 IS DISTINCT FROM
          selected_intent.intent_record_fingerprint_sha256
        OR NEW.network_id IS DISTINCT FROM selected_intent.network_id
        OR NEW.network_id IS DISTINCT FROM signed_event.network_id
        OR NEW.chain_transaction_id IS DISTINCT FROM signed_event.chain_transaction_id
        OR NEW.transaction_identity_sha256 IS DISTINCT FROM
          signed_event.transaction_identity_sha256
        OR NEW.signing_payload_sha256 IS DISTINCT FROM
          signed_event.wallet_signed_payload_sha256
        OR NEW.signature_evidence_sha256 IS DISTINCT FROM
          signed_event.wallet_signature_evidence_sha256
        OR NEW.signing_payload_sha256 = NEW.signature_evidence_sha256
        OR NOT pg_catalog.isfinite(NEW.server_received_and_verified_at)
        OR pg_catalog.date_trunc(
          'milliseconds', NEW.server_received_and_verified_at
        ) <> NEW.server_received_and_verified_at
        OR NEW.server_received_and_verified_at <> signed_event.effective_at
        OR NEW.server_received_and_verified_at > database_recorded_at
        OR database_recorded_at - NEW.server_received_and_verified_at > interval '30 seconds'
        OR NOT (
          (NEW.network_id = '${ETHEREUM}'
            AND NEW.signature_scheme = 'ECDSA_SECP256K1_EIP1559'
            AND NEW.ethereum_nonce IS NOT NULL
            AND NEW.ethereum_nonce BETWEEN 0 AND ${UINT64_MAX}::numeric
            AND NEW.solana_recent_blockhash IS NULL)
          OR
          (NEW.network_id = '${SOLANA}'
            AND NEW.signature_scheme = 'ED25519_SOLANA_TRANSACTION'
            AND NEW.ethereum_nonce IS NULL
            AND NEW.solana_recent_blockhash IS NOT NULL
            AND mainnet_action_chain_identity_valid(
              '${SOLANA}', NEW.solana_recent_blockhash, 'BLOCK'
            ))
        )
      THEN
        RAISE EXCEPTION 'invalid verified mainnet signed-submission proof'
          USING ERRCODE = '22023';
      END IF;
      NEW.recorded_at := database_recorded_at;
      NEW.proof_fingerprint_sha256 := ${PROOF_FINGERPRINT};
      RETURN NEW;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'verified mainnet signed-submission event is unavailable'
        USING ERRCODE = '55000';
    END;`;

const COMPLETENESS_GUARD_BODY = `
    BEGIN
      IF NEW.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
        AND NOT EXISTS (
          SELECT 1
          FROM ${PROOF_TABLE} AS proof
          WHERE proof.intent_id = NEW.intent_id
            AND proof.event_revision = NEW.revision
            AND proof.event_id = NEW.event_id
            AND proof.event_transition_fingerprint_sha256 =
              NEW.transition_fingerprint_sha256
            AND proof.network_id = NEW.network_id
            AND proof.chain_transaction_id = NEW.chain_transaction_id
            AND proof.transaction_identity_sha256 = NEW.transaction_identity_sha256
            AND proof.signing_payload_sha256 = NEW.wallet_signed_payload_sha256
            AND proof.signature_evidence_sha256 =
              NEW.wallet_signature_evidence_sha256
        )
      THEN
        RAISE EXCEPTION 'signed-bound mainnet action lacks verified submission proof'
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;`;

const VERIFIED_BIND_BODY = `
    DECLARE
      selected_intent mainnet_financial_action_intents%ROWTYPE;
      signed_event mainnet_financial_action_events%ROWTYPE;
      existing_proof ${PROOF_TABLE}%ROWTYPE;
      database_verified_at timestamptz;
    BEGIN
      IF requested_account_id IS NULL OR requested_intent_id IS NULL
        OR requested_expected_revision IS NULL
        OR requested_expected_revision NOT BETWEEN 1 AND 9223372036854775806
        OR requested_expected_snapshot_sha256 IS NULL
        OR requested_expected_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_expected_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_transaction_id IS NULL
        OR requested_signing_payload_sha256 IS NULL
        OR requested_signature_evidence_sha256 IS NULL
        OR requested_correlation_id IS NULL
        OR requested_verifier_version IS DISTINCT FROM 1
        OR requested_verification_intent_fingerprint_sha256 IS NULL
        OR requested_verification_intent_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_verification_intent_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR requested_signed_envelope_sha256 IS NULL
        OR requested_signed_envelope_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_signed_envelope_sha256 = pg_catalog.repeat('0', 64)
        OR requested_provider_write_manifest_fingerprint_sha256 IS NULL
        OR requested_provider_write_manifest_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_provider_write_manifest_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR requested_provider_action_binding_sha256 IS NULL
        OR requested_provider_action_binding_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_provider_action_binding_sha256 = pg_catalog.repeat('0', 64)
        OR requested_chain_replay_identity_sha256 IS NULL
        OR requested_chain_replay_identity_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_chain_replay_identity_sha256 = pg_catalog.repeat('0', 64)
        OR requested_signature_scheme IS NULL
      THEN
        RAISE EXCEPTION 'invalid verified mainnet signed-submission bind'
          USING ERRCODE = '22023';
      END IF;
      SELECT stored.* INTO STRICT selected_intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR UPDATE;
      IF NOT (
        (selected_intent.network_id = '${ETHEREUM}'
          AND requested_signature_scheme = 'ECDSA_SECP256K1_EIP1559'
          AND requested_ethereum_nonce IS NOT NULL
          AND requested_ethereum_nonce BETWEEN 0 AND ${UINT64_MAX}::numeric
          AND requested_solana_recent_blockhash IS NULL)
        OR
        (selected_intent.network_id = '${SOLANA}'
          AND requested_signature_scheme = 'ED25519_SOLANA_TRANSACTION'
          AND requested_ethereum_nonce IS NULL
          AND requested_solana_recent_blockhash IS NOT NULL
          AND mainnet_action_chain_identity_valid(
            '${SOLANA}', requested_solana_recent_blockhash, 'BLOCK'
          ))
      ) THEN
        RAISE EXCEPTION 'verified mainnet signed-submission chain proof is invalid'
          USING ERRCODE = '22023';
      END IF;

      SELECT event.* INTO signed_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
      FOR SHARE;
      IF FOUND THEN
      SELECT proof.* INTO existing_proof
      FROM ${PROOF_TABLE} AS proof
      WHERE proof.intent_id = selected_intent.intent_id
        AND proof.event_revision = signed_event.revision
      FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'signed-bound mainnet action lacks immutable verification proof'
            USING ERRCODE = '55000';
        END IF;
        IF existing_proof.event_id <> signed_event.event_id
          OR signed_event.revision <> requested_expected_revision + 1
          OR signed_event.previous_snapshot_sha256 <>
            requested_expected_snapshot_sha256
          OR existing_proof.event_transition_fingerprint_sha256 <>
            signed_event.transition_fingerprint_sha256
          OR existing_proof.proof_version <> 1
          OR existing_proof.verifier_version <> requested_verifier_version
          OR existing_proof.intent_record_fingerprint_sha256 <>
            selected_intent.intent_record_fingerprint_sha256
          OR existing_proof.verification_intent_fingerprint_sha256 <>
            requested_verification_intent_fingerprint_sha256
          OR existing_proof.network_id <> selected_intent.network_id
          OR existing_proof.chain_transaction_id <> requested_transaction_id
          OR existing_proof.transaction_identity_sha256 <>
            signed_event.transaction_identity_sha256
          OR existing_proof.signed_envelope_sha256 <>
            requested_signed_envelope_sha256
          OR existing_proof.signing_payload_sha256 <>
            requested_signing_payload_sha256
          OR existing_proof.signature_evidence_sha256 <>
            requested_signature_evidence_sha256
          OR existing_proof.provider_write_manifest_fingerprint_sha256 <>
            requested_provider_write_manifest_fingerprint_sha256
          OR existing_proof.provider_action_binding_sha256 <>
            requested_provider_action_binding_sha256
          OR existing_proof.chain_replay_identity_sha256 <>
            requested_chain_replay_identity_sha256
          OR existing_proof.signature_scheme <> requested_signature_scheme
          OR existing_proof.ethereum_nonce IS DISTINCT FROM requested_ethereum_nonce
          OR existing_proof.solana_recent_blockhash IS DISTINCT FROM
            requested_solana_recent_blockhash
          OR signed_event.effective_at <>
            existing_proof.server_received_and_verified_at
        THEN
          RAISE EXCEPTION 'verified mainnet signed-submission proof replay conflict'
            USING ERRCODE = '23505';
        END IF;
        database_verified_at := existing_proof.server_received_and_verified_at;
        RETURN QUERY SELECT *
        FROM ${OLD_BIND}(
          requested_account_id, requested_intent_id, requested_expected_revision,
          requested_expected_snapshot_sha256, requested_transaction_id,
          requested_signing_payload_sha256, requested_signature_evidence_sha256,
          database_verified_at, requested_correlation_id
        );
        RETURN;
      END IF;

      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      RETURN QUERY SELECT *
      FROM ${OLD_BIND}(
        requested_account_id, requested_intent_id, requested_expected_revision,
        requested_expected_snapshot_sha256, requested_transaction_id,
        requested_signing_payload_sha256, requested_signature_evidence_sha256,
        database_verified_at, requested_correlation_id
      );
      SELECT event.* INTO STRICT signed_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
      FOR SHARE;

      INSERT INTO ${PROOF_TABLE} (
        intent_id, event_revision, event_id,
        event_transition_fingerprint_sha256, proof_version, verifier_version,
        intent_record_fingerprint_sha256,
        verification_intent_fingerprint_sha256, network_id,
        chain_transaction_id, transaction_identity_sha256,
        signed_envelope_sha256, signing_payload_sha256,
        signature_evidence_sha256, provider_write_manifest_fingerprint_sha256,
        provider_action_binding_sha256, chain_replay_identity_sha256,
        signature_scheme, ethereum_nonce, solana_recent_blockhash,
        server_received_and_verified_at
      ) VALUES (
        selected_intent.intent_id, signed_event.revision, signed_event.event_id,
        signed_event.transition_fingerprint_sha256, 1, requested_verifier_version,
        selected_intent.intent_record_fingerprint_sha256,
        requested_verification_intent_fingerprint_sha256,
        selected_intent.network_id, signed_event.chain_transaction_id,
        signed_event.transaction_identity_sha256, requested_signed_envelope_sha256,
        requested_signing_payload_sha256, requested_signature_evidence_sha256,
        requested_provider_write_manifest_fingerprint_sha256,
        requested_provider_action_binding_sha256,
        requested_chain_replay_identity_sha256, requested_signature_scheme,
        requested_ethereum_nonce, requested_solana_recent_blockhash,
        NULL
      );
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'verified mainnet signed-submission lifecycle is unavailable'
        USING ERRCODE = '55000';
    END;`;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `LOCK TABLE mainnet_financial_action_events IN ACCESS EXCLUSIVE MODE;
    DO $refuse_unverified_signed_submission_history$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM mainnet_financial_action_events
        WHERE stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
      ) THEN
        RAISE EXCEPTION 'pre-existing signed-bound history lacks immutable verification proof'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_unverified_signed_submission_history$;

    CREATE TABLE ${PROOF_TABLE} (
      intent_id uuid NOT NULL,
      event_revision bigint NOT NULL,
      event_id uuid NOT NULL,
      event_transition_fingerprint_sha256 text NOT NULL,
      proof_version smallint NOT NULL,
      verifier_version smallint NOT NULL,
      intent_record_fingerprint_sha256 text NOT NULL,
      verification_intent_fingerprint_sha256 text NOT NULL,
      network_id text NOT NULL,
      chain_transaction_id text NOT NULL,
      transaction_identity_sha256 text NOT NULL,
      signed_envelope_sha256 text NOT NULL,
      signing_payload_sha256 text NOT NULL,
      signature_evidence_sha256 text NOT NULL,
      provider_write_manifest_fingerprint_sha256 text NOT NULL,
      provider_action_binding_sha256 text NOT NULL,
      chain_replay_identity_sha256 text NOT NULL,
      signature_scheme text NOT NULL,
      ethereum_nonce numeric(20,0),
      solana_recent_blockhash text,
      server_received_and_verified_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      proof_fingerprint_sha256 text NOT NULL,
      CONSTRAINT mainnet_action_signed_submission_proof_pkey
        PRIMARY KEY (intent_id, event_revision),
      CONSTRAINT mainnet_action_signed_submission_proof_event_id_unique UNIQUE (event_id),
      CONSTRAINT mainnet_action_signed_submission_proof_fingerprint_unique
        UNIQUE (proof_fingerprint_sha256),
      CONSTRAINT mainnet_action_signed_submission_proof_envelope_unique
        UNIQUE (signed_envelope_sha256),
      CONSTRAINT mainnet_action_signed_submission_proof_replay_identity_unique
        UNIQUE (chain_replay_identity_sha256),
      CONSTRAINT mainnet_action_signed_submission_proof_event_fk FOREIGN KEY (
        intent_id, event_revision, event_transition_fingerprint_sha256
      ) REFERENCES mainnet_financial_action_events (
        intent_id, revision, transition_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_signed_submission_proof_event_id_fk FOREIGN KEY (event_id)
        REFERENCES mainnet_financial_action_events (event_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_signed_submission_proof_intent_fingerprint_fk
        FOREIGN KEY (intent_record_fingerprint_sha256)
        REFERENCES mainnet_financial_action_intents (intent_record_fingerprint_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_signed_submission_proof_digest_check CHECK (
        proof_version = 1 AND verifier_version = 1
        AND event_revision >= 2
        AND event_transition_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND event_transition_fingerprint_sha256 <> repeat('0', 64)
        AND intent_record_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND intent_record_fingerprint_sha256 <> repeat('0', 64)
        AND verification_intent_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND verification_intent_fingerprint_sha256 <> repeat('0', 64)
        AND transaction_identity_sha256 ~ '^[0-9a-f]{64}$'
        AND transaction_identity_sha256 <> repeat('0', 64)
        AND signed_envelope_sha256 ~ '^[0-9a-f]{64}$'
        AND signed_envelope_sha256 <> repeat('0', 64)
        AND signing_payload_sha256 ~ '^[0-9a-f]{64}$'
        AND signing_payload_sha256 <> repeat('0', 64)
        AND signature_evidence_sha256 ~ '^[0-9a-f]{64}$'
        AND signature_evidence_sha256 <> repeat('0', 64)
        AND signing_payload_sha256 <> signature_evidence_sha256
        AND provider_write_manifest_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND provider_write_manifest_fingerprint_sha256 <> repeat('0', 64)
        AND provider_action_binding_sha256 ~ '^[0-9a-f]{64}$'
        AND provider_action_binding_sha256 <> repeat('0', 64)
        AND chain_replay_identity_sha256 ~ '^[0-9a-f]{64}$'
        AND chain_replay_identity_sha256 <> repeat('0', 64)
        AND proof_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND proof_fingerprint_sha256 <> repeat('0', 64)
      ),
      CONSTRAINT mainnet_action_signed_submission_proof_chain_shape_check CHECK (
        (network_id = '${ETHEREUM}'
          AND signature_scheme = 'ECDSA_SECP256K1_EIP1559'
          AND ethereum_nonce IS NOT NULL
          AND ethereum_nonce BETWEEN 0 AND ${UINT64_MAX}::numeric
          AND solana_recent_blockhash IS NULL)
        OR
        (network_id = '${SOLANA}'
          AND signature_scheme = 'ED25519_SOLANA_TRANSACTION'
          AND ethereum_nonce IS NULL
          AND solana_recent_blockhash IS NOT NULL)
      ),
      CONSTRAINT mainnet_action_signed_submission_proof_time_check CHECK (
        isfinite(server_received_and_verified_at) AND isfinite(recorded_at)
        AND date_trunc('milliseconds', server_received_and_verified_at) =
          server_received_and_verified_at
        AND date_trunc('milliseconds', recorded_at) = recorded_at
        AND server_received_and_verified_at <= recorded_at
        AND recorded_at - server_received_and_verified_at <= interval '30 seconds'
      )
    );
    COMMENT ON TABLE ${PROOF_TABLE} IS '${PROOF_MANIFEST}';

    CREATE FUNCTION ${PROOF_GUARD}()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${PROOF_GUARD_BODY}$function$;
    CREATE FUNCTION ${COMPLETENESS_GUARD}()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${COMPLETENESS_GUARD_BODY}$function$;
    CREATE FUNCTION ${VERIFIED_BIND}(
      requested_account_id uuid, requested_intent_id uuid,
      requested_expected_revision bigint, requested_expected_snapshot_sha256 text,
      requested_transaction_id text, requested_signing_payload_sha256 text,
      requested_signature_evidence_sha256 text,
      requested_correlation_id uuid, requested_verifier_version smallint,
      requested_verification_intent_fingerprint_sha256 text,
      requested_signed_envelope_sha256 text,
      requested_provider_write_manifest_fingerprint_sha256 text,
      requested_provider_action_binding_sha256 text,
      requested_chain_replay_identity_sha256 text, requested_signature_scheme text,
      requested_ethereum_nonce numeric, requested_solana_recent_blockhash text
    ) RETURNS TABLE (${oldBindResultColumns(names)})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE
    AS $function$${VERIFIED_BIND_BODY}$function$;

    CREATE TRIGGER mainnet_action_signed_submission_proof_before_insert
      BEFORE INSERT ON ${PROOF_TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${PROOF_GUARD}();
    CREATE CONSTRAINT TRIGGER mainnet_action_signed_submission_proof_after_event
      AFTER INSERT ON mainnet_financial_action_events
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ${COMPLETENESS_GUARD}();
    CREATE TRIGGER mainnet_action_signed_submission_proof_append_only_row
      BEFORE UPDATE OR DELETE ON ${PROOF_TABLE}
      FOR EACH ROW EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE TRIGGER mainnet_action_signed_submission_proof_append_only_truncate
      BEFORE TRUNCATE ON ${PROOF_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    ALTER TABLE ${PROOF_TABLE} ENABLE ALWAYS TRIGGER
      mainnet_action_signed_submission_proof_before_insert;
    ALTER TABLE mainnet_financial_action_events ENABLE ALWAYS TRIGGER
      mainnet_action_signed_submission_proof_after_event;
    ALTER TABLE ${PROOF_TABLE} ENABLE ALWAYS TRIGGER
      mainnet_action_signed_submission_proof_append_only_row;
    ALTER TABLE ${PROOF_TABLE} ENABLE ALWAYS TRIGGER
      mainnet_action_signed_submission_proof_append_only_truncate;

    DO $set_signed_submission_proof_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${[PROOF_GUARD_IDENTITY, COMPLETENESS_GUARD_IDENTITY, VERIFIED_BIND_IDENTITY]
        .map(
          (functionIdentity) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${functionIdentity}
          SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );`,
        )
        .join('\n      ')}
    END;
    $set_signed_submission_proof_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${PROOF_TABLE} FROM ${guarded};
    REVOKE ALL PRIVILEGES ON TYPE ${PROOF_TABLE} FROM ${guarded};
    ${[PROOF_GUARD_IDENTITY, COMPLETENESS_GUARD_IDENTITY, VERIFIED_BIND_IDENTITY]
      .map((functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guarded};`)
      .join('\n    ')}`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `LOCK TABLE mainnet_financial_action_events, ${PROOF_TABLE}
      IN ACCESS EXCLUSIVE MODE;
    DO $refuse_verified_signed_submission_proof_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${PROOF_TABLE})
        OR EXISTS (
          SELECT 1 FROM mainnet_financial_action_events
          WHERE stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
        )
      THEN
        RAISE EXCEPTION 'cannot roll back verified signed-submission proof history'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_verified_signed_submission_proof_loss$;
    REVOKE ALL ON FUNCTION ${VERIFIED_BIND_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${COMPLETENESS_GUARD_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${PROOF_GUARD_IDENTITY} FROM ${guarded};
    DROP FUNCTION ${VERIFIED_BIND_IDENTITY};
    DROP TRIGGER mainnet_action_signed_submission_proof_after_event
      ON mainnet_financial_action_events;
    DROP TRIGGER mainnet_action_signed_submission_proof_append_only_truncate
      ON ${PROOF_TABLE};
    DROP TRIGGER mainnet_action_signed_submission_proof_append_only_row
      ON ${PROOF_TABLE};
    DROP TRIGGER mainnet_action_signed_submission_proof_before_insert
      ON ${PROOF_TABLE};
    DROP FUNCTION ${COMPLETENESS_GUARD_IDENTITY};
    DROP FUNCTION ${PROOF_GUARD_IDENTITY};
    DROP TABLE ${PROOF_TABLE};`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetFinancialActionRevocationRecoveryMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0038 must expose verification SQL');
  let prior = replaceExactlyOnce(
    previous.verifySql,
    `        ('mainnet_financial_action_events', 'mainnet_action_reconciliation_requires_authenticated_admission', 'require_mainnet_financial_action_reconciliation_admission()', 5, true, true)
      )
      SELECT pg_catalog.count(*) = 11 AND pg_catalog.count(trigger_record.oid) = 11`,
    `        ('mainnet_financial_action_events', 'mainnet_action_reconciliation_requires_authenticated_admission', 'require_mainnet_financial_action_reconciliation_admission()', 5, true, true),
        ('mainnet_financial_action_events', 'mainnet_action_signed_submission_proof_after_event', '${COMPLETENESS_GUARD_IDENTITY}', 5, true, true)
      )
      SELECT pg_catalog.count(*) = 12 AND pg_catalog.count(trigger_record.oid) = 12`,
  );
  prior = replaceExactlyOnce(
    prior,
    `          SELECT pg_catalog.count(*) = 11
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid IN (`,
    `          SELECT pg_catalog.count(*) = 12
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid IN (`,
  );
  prior = replaceExactlyOnce(
    prior,
    `            'mainnet_financial_action_events',
            'mainnet_action_reconciliation_requires_authenticated_admission',
            't', NULL::smallint[], NULL::text, NULL::smallint[], NULL::text,
            'a5fc893149b88e6e958294fc1a4a285cbad41292c73d26f5f91873f312e3e311'
          )
      )
      SELECT pg_catalog.count(*) = 36
        AND pg_catalog.count(constraint_record.oid) = 36`,
    `            'mainnet_financial_action_events',
            'mainnet_action_reconciliation_requires_authenticated_admission',
            't', NULL::smallint[], NULL::text, NULL::smallint[], NULL::text,
            'a5fc893149b88e6e958294fc1a4a285cbad41292c73d26f5f91873f312e3e311'
          ), (
            'mainnet_financial_action_events',
            'mainnet_action_signed_submission_proof_after_event',
            't', NULL::smallint[], NULL::text, NULL::smallint[], NULL::text,
            'a5fc893149b88e6e958294fc1a4a285cbad41292c73d26f5f91873f312e3e311'
          )
      )
      SELECT pg_catalog.count(*) = 37
        AND pg_catalog.count(constraint_record.oid) = 37`,
  );
  prior = replaceExactlyOnce(
    prior,
    `          SELECT pg_catalog.count(*) = 36
          FROM pg_catalog.pg_constraint AS all_constraint`,
    `          SELECT pg_catalog.count(*) = 37
          FROM pg_catalog.pg_constraint AS all_constraint`,
  );
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const expectedColumns = PROOF_COLUMNS.map(
    ([name, type, notNull], index) => `('${name}', '${type}', ${notNull}, ${String(index + 1)})`,
  ).join(',\n          ');
  return `SELECT (
      prior.valid AND relation_state.valid AND constraint_state.valid
      AND function_state.valid AND trigger_state.valid AND data_state.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = ${PROOF_COLUMNS.length}
        AND pg_catalog.count(attribute.attname) = ${PROOF_COLUMNS.length}
        AND pg_catalog.bool_and(
          pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = expected.type_name
          AND attribute.attnotnull = expected.not_null
          AND attribute.attnum = expected.ordinal
        )
        AND relation.relkind = 'r'
        AND relation.relpersistence = 'p' AND relation.relreplident = 'd'
        AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity
        AND NOT relation.relispartition AND relation.relpartbound IS NULL
        AND pg_catalog.obj_description(relation.oid, 'pg_class') = '${PROOF_MANIFEST}'
        AND relation_owner.rolname = ${cumulative ? owner : 'relation_owner.rolname'}
        AND NOT pg_catalog.has_table_privilege(${api}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${worker}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${legacy}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${balance}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${migration}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege('public', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite
          WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(
            COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
          ) AS acl WHERE acl.grantee <> relation.relowner
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS guarded_attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(guarded_attribute.attacl) AS acl
          WHERE guarded_attribute.attrelid = relation.oid
            AND guarded_attribute.attnum > 0 AND NOT guarded_attribute.attisdropped
            AND acl.grantee <> relation.relowner
        )
        AND (
          SELECT row_type.typtype = 'c' AND row_type.typrelid = relation.oid
            AND row_type_owner.oid = relation.relowner
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.aclexplode(
                COALESCE(row_type.typacl, pg_catalog.acldefault('T', row_type.typowner))
              ) AS acl WHERE acl.grantee <> row_type.typowner
            )
          FROM pg_catalog.pg_type AS row_type
          INNER JOIN pg_catalog.pg_roles AS row_type_owner
            ON row_type_owner.oid = row_type.typowner
          WHERE row_type.oid = relation.reltype
        )
        AS valid
      FROM (VALUES
          ${expectedColumns}
      ) AS expected(column_name, type_name, not_null, ordinal)
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.oid = pg_catalog.to_regclass('${PROOF_TABLE}')
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
        AND attribute.attname = expected.column_name
        AND NOT attribute.attisdropped
      LEFT JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
      GROUP BY relation.oid, relation.relkind, relation.relowner,
        relation_owner.rolname
    ) AS relation_state
    CROSS JOIN (
      WITH catalog_rows AS (
        SELECT constraint_record.*,
          foreign_relation.relname AS foreign_relname,
          foreign_namespace.nspname AS foreign_nspname,
          backing_index.relname AS backing_name,
          backing_namespace.nspname AS backing_nspname
        FROM pg_catalog.pg_constraint AS constraint_record
        LEFT JOIN pg_catalog.pg_class AS foreign_relation
          ON foreign_relation.oid = constraint_record.confrelid
        LEFT JOIN pg_catalog.pg_namespace AS foreign_namespace
          ON foreign_namespace.oid = foreign_relation.relnamespace
        LEFT JOIN pg_catalog.pg_class AS backing_index
          ON backing_index.oid = constraint_record.conindid
        LEFT JOIN pg_catalog.pg_namespace AS backing_namespace
          ON backing_namespace.oid = backing_index.relnamespace
        WHERE constraint_record.conrelid = pg_catalog.to_regclass('${PROOF_TABLE}')
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            conname, contype, convalidated, conislocal, coninhcount,
            connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema()),
            contypid, conparentid, connoinherit, COALESCE(conkey::text, '-'),
            COALESCE(foreign_relname, '-'),
            COALESCE((foreign_nspname = pg_catalog.current_schema())::text, '-'),
            COALESCE(confkey::text, '-'), COALESCE(backing_name, '-'),
            COALESCE((backing_nspname = pg_catalog.current_schema())::text, '-'),
            condeferrable, condeferred, confupdtype, confdeltype, confmatchtype,
            COALESCE(confdelsetcols::text, '-'), COALESCE(conpfeqop::text, '-'),
            COALESCE(conppeqop::text, '-'), COALESCE(conffeqop::text, '-'),
            COALESCE(pg_catalog.regexp_replace(
              pg_catalog.pg_get_constraintdef(oid, false), '[[:space:]]+', '', 'g'
            ), '-')
          ), E'\\n' ORDER BY conname) AS catalog_state
        FROM catalog_rows
      )
      SELECT row_count = 11 AND COALESCE(
        pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(catalog_state, 'UTF8')
        ), 'hex') = '${PROOF_CONSTRAINT_CATALOG_SHA256}', false
      ) AS valid
      FROM canonical
    ) AS constraint_state
    CROSS JOIN (
      WITH predecessor AS (
        SELECT procedure.*
        FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = pg_catalog.to_regprocedure('${OLD_BIND_IDENTITY}')
      ), expected(
        function_identity, body_sha256, is_strict, input_names, input_type_oids,
        is_verified_bind
      ) AS (VALUES
        ('${PROOF_GUARD_IDENTITY}', '${sourceSha256(PROOF_GUARD_BODY)}', false,
          ARRAY[]::text[], ARRAY[]::oid[], false),
        ('${COMPLETENESS_GUARD_IDENTITY}', '${sourceSha256(COMPLETENESS_GUARD_BODY)}', false,
          ARRAY[]::text[], ARRAY[]::oid[], false),
        ('${VERIFIED_BIND_IDENTITY}', '${sourceSha256(VERIFIED_BIND_BODY)}', false,
          ARRAY[
            'requested_account_id', 'requested_intent_id',
            'requested_expected_revision', 'requested_expected_snapshot_sha256',
            'requested_transaction_id', 'requested_signing_payload_sha256',
            'requested_signature_evidence_sha256',
            'requested_correlation_id', 'requested_verifier_version',
            'requested_verification_intent_fingerprint_sha256',
            'requested_signed_envelope_sha256',
            'requested_provider_write_manifest_fingerprint_sha256',
            'requested_provider_action_binding_sha256',
            'requested_chain_replay_identity_sha256', 'requested_signature_scheme',
            'requested_ethereum_nonce', 'requested_solana_recent_blockhash'
          ]::text[], ARRAY[
            'uuid'::regtype, 'uuid'::regtype, 'bigint'::regtype, 'text'::regtype,
            'text'::regtype, 'text'::regtype, 'text'::regtype,
            'uuid'::regtype, 'smallint'::regtype,
            'text'::regtype, 'text'::regtype, 'text'::regtype, 'text'::regtype,
            'text'::regtype, 'text'::regtype, 'numeric'::regtype, 'text'::regtype
          ]::oid[], true)
      )
      SELECT pg_catalog.count(*) = 3
        AND pg_catalog.count(procedure.oid) = 3
        AND pg_catalog.bool_and(
          procedure.prokind = 'f' AND procedure.prosecdef
          AND NOT procedure.proleakproof
          AND procedure.provolatile = 'v' AND procedure.proparallel = 'u'
          AND procedure.proisstrict = expected.is_strict
          AND procedure.pronargdefaults = 0 AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND procedure.pronargs = pg_catalog.cardinality(expected.input_names)
          AND ARRAY(
            SELECT input_type
            FROM pg_catalog.unnest(procedure.proargtypes::oid[])
              WITH ORDINALITY AS input(input_type, ordinal)
            ORDER BY ordinal
          ) = expected.input_type_oids
          AND COALESCE(
            procedure.proargnames[1:procedure.pronargs], ARRAY[]::text[]
          ) = expected.input_names
          AND language.lanname = 'plpgsql'
          AND CASE WHEN expected.is_verified_bind THEN
            procedure.proretset = predecessor.proretset
            AND procedure.prorettype = predecessor.prorettype
            AND pg_catalog.pg_get_function_result(procedure.oid) =
              pg_catalog.pg_get_function_result(predecessor.oid)
            AND procedure.proallargtypes[1:procedure.pronargs] = expected.input_type_oids
            AND procedure.proargmodes[1:procedure.pronargs] =
              pg_catalog.array_fill('i'::"char", ARRAY[procedure.pronargs])
            AND procedure.proargnames[procedure.pronargs + 1:] =
              predecessor.proargnames[predecessor.pronargs + 1:]
            AND procedure.proallargtypes[procedure.pronargs + 1:] =
              predecessor.proallargtypes[predecessor.pronargs + 1:]
            AND procedure.proargmodes[procedure.pronargs + 1:] =
              predecessor.proargmodes[predecessor.pronargs + 1:]
          ELSE
            NOT procedure.proretset AND procedure.prorettype = 'trigger'::regtype
            AND pg_catalog.pg_get_function_result(procedure.oid) = 'trigger'
            AND procedure.proallargtypes IS NULL AND procedure.proargmodes IS NULL
            AND procedure.proargnames IS NULL
          END
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = expected.body_sha256
          AND function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT pg_catalog.has_function_privilege(${api}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${worker}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${legacy}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${balance}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${migration}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('public', expected.function_identity, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
            ) AS acl WHERE acl.grantee <> procedure.proowner
          )
        ) AS valid
      FROM expected
      CROSS JOIN predecessor
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS function_state
    CROSS JOIN (
      WITH expected(
        table_name, trigger_name, function_identity, trigger_type,
        expected_deferrable, expected_deferred
      ) AS (VALUES
        ('${PROOF_TABLE}', 'mainnet_action_signed_submission_proof_before_insert',
          '${PROOF_GUARD_IDENTITY}', 7, false, false),
        ('mainnet_financial_action_events',
          'mainnet_action_signed_submission_proof_after_event',
          '${COMPLETENESS_GUARD_IDENTITY}', 5, true, true),
        ('${PROOF_TABLE}', 'mainnet_action_signed_submission_proof_append_only_row',
          'reject_mainnet_action_history_mutation()', 27, false, false),
        ('${PROOF_TABLE}', 'mainnet_action_signed_submission_proof_append_only_truncate',
          'reject_mainnet_action_history_mutation()', 34, false, false)
      )
      SELECT pg_catalog.count(*) = 4
        AND pg_catalog.count(trigger_record.oid) = 4
        AND pg_catalog.bool_and(
          trigger_record.tgenabled = 'A'
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgrelid = pg_catalog.to_regclass(expected.table_name)
          AND trigger_record.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
          AND trigger_record.tgtype = expected.trigger_type
          AND trigger_record.tgnargs = 0 AND trigger_record.tgparentid = 0
          AND trigger_record.tgdeferrable = expected.expected_deferrable
          AND trigger_record.tginitdeferred = expected.expected_deferred
          AND trigger_record.tgoldtable IS NULL AND trigger_record.tgnewtable IS NULL
          AND CASE WHEN expected.expected_deferrable THEN
            trigger_record.tgconstraint <> 0
            AND constraint_record.condeferrable AND constraint_record.condeferred
            ELSE trigger_record.tgconstraint = 0
          END
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger_record
        ON trigger_record.tgrelid = pg_catalog.to_regclass(expected.table_name)
        AND trigger_record.tgname = expected.trigger_name
      LEFT JOIN pg_catalog.pg_constraint AS constraint_record
        ON constraint_record.oid = trigger_record.tgconstraint
    ) AS trigger_state
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM mainnet_financial_action_events AS event
        LEFT JOIN ${PROOF_TABLE} AS proof
          ON proof.intent_id = event.intent_id
          AND proof.event_revision = event.revision
          AND proof.event_id = event.event_id
          AND proof.event_transition_fingerprint_sha256 = event.transition_fingerprint_sha256
          AND proof.network_id = event.network_id
          AND proof.chain_transaction_id = event.chain_transaction_id
          AND proof.transaction_identity_sha256 = event.transaction_identity_sha256
          AND proof.signing_payload_sha256 = event.wallet_signed_payload_sha256
          AND proof.signature_evidence_sha256 = event.wallet_signature_evidence_sha256
        WHERE event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
          AND proof.intent_id IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM ${PROOF_TABLE} AS proof
        LEFT JOIN mainnet_financial_action_events AS event
          ON event.intent_id = proof.intent_id
          AND event.revision = proof.event_revision
          AND event.event_id = proof.event_id
          AND event.transition_fingerprint_sha256 =
            proof.event_transition_fingerprint_sha256
          AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
        WHERE event.intent_id IS NULL
      ) AS valid
    ) AS data_state`;
}

export function createVerifiedMainnetSignedSubmissionProofMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0039',
    description: 'persist cryptographically verified mainnet signed-submission proof',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0038'],
  };
}

export const createVerifiedMainnetSignedSubmissionProofMigrationV0039 =
  createVerifiedMainnetSignedSubmissionProofMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createVerifiedMainnetSignedSubmissionProofTestSchemaMigrationV0039 =
  createVerifiedMainnetSignedSubmissionProofMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
