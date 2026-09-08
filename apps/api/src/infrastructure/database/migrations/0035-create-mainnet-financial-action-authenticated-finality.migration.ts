import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionWalletIdentityBindingMigration } from './0034-bind-mainnet-financial-action-wallet-identity.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

const SOURCE_AUTHORITY_TABLE = 'mainnet_financial_action_reconciliation_source_authorities';
const DEPLOYMENT_AUTHORITY_TABLE = 'mainnet_financial_action_reconciliation_deployment_authorities';
const AUTHORITY_CONTROL_TABLE = 'mainnet_financial_action_reconciliation_authority_controls';
const ADMISSION_TABLE = 'mainnet_financial_action_reconciliation_admissions';
const REVIEW_TABLE = 'mainnet_financial_action_post_finality_reviews';

const HISTORY_GUARD = 'reject_mainnet_financial_action_authenticated_finality_history_mutation()';
const ADMISSION_GUARD = 'require_mainnet_financial_action_reconciliation_admission()';
const FINALITY_FINGERPRINT_BYTES =
  'mainnet_action_authenticated_finality_fingerprint_bytes_v1(text,text[],text[])';
const FINALITY_FINGERPRINT =
  'mainnet_action_authenticated_finality_fingerprint_v1(text,text[],text[])';
const FINALITY_FINGERPRINT_DOMAINS = Object.freeze([
  'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_SOURCE_AUTHORITY:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_DEPLOYMENT_AUTHORITY:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_SOURCE_EVIDENCE:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_EFFECT_EVIDENCE:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_FAILURE_EVIDENCE:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_RECONCILIATION_ADMISSION:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:POST_FINALITY_REVIEW:FRAMED:v1',
]);
const RECORD_ADMISSION_ARGUMENTS = Object.freeze([
  ['requested_account_id', 'uuid'],
  ['requested_intent_id', 'uuid'],
  ['requested_expected_revision', 'bigint'],
  ['requested_expected_snapshot_sha256', 'text'],
  ['requested_observation_id', 'uuid'],
  ['requested_transaction_id', 'text'],
  ['requested_outcome', 'text'],
  ['requested_transaction_position', 'numeric'],
  ['requested_transaction_block_id', 'text'],
  ['requested_finalized_position', 'numeric'],
  ['requested_finalized_block_id', 'text'],
  ['requested_chain_anchor_evidence_fingerprint_sha256', 'text'],
  ['requested_source_authority_id', 'uuid'],
  ['requested_source_authority_fingerprint_sha256', 'text'],
  ['requested_deployment_authority_id', 'uuid'],
  ['requested_deployment_authority_fingerprint_sha256', 'text'],
  ['requested_primary_attestation_sha256', 'text'],
  ['requested_corroborating_attestation_sha256', 'text'],
  ['requested_transaction_evidence_sha256', 'text'],
  ['requested_effect_evidence_sha256', 'text'],
  ['requested_failure_evidence_sha256', 'text'],
  ['requested_observed_at', 'timestamp with time zone'],
  ['requested_deadline_at', 'timestamp with time zone'],
  ['requested_correlation_id', 'uuid'],
] as const);

const RECORD_REVIEW_ARGUMENTS = Object.freeze([
  ['requested_account_id', 'uuid'],
  ['requested_intent_id', 'uuid'],
  ['requested_terminal_revision', 'bigint'],
  ['requested_terminal_snapshot_sha256', 'text'],
  ['requested_expected_review_revision', 'bigint'],
  ['requested_expected_previous_review_fingerprint_sha256', 'text'],
  ['requested_review_id', 'uuid'],
  ['requested_disposition', 'text'],
  ['requested_lineage_status', 'text'],
  ['requested_transaction_id', 'text'],
  ['requested_transaction_position', 'numeric'],
  ['requested_transaction_block_id', 'text'],
  ['requested_finalized_position', 'numeric'],
  ['requested_finalized_block_id', 'text'],
  ['requested_chain_anchor_evidence_fingerprint_sha256', 'text'],
  ['requested_source_authority_id', 'uuid'],
  ['requested_source_authority_fingerprint_sha256', 'text'],
  ['requested_deployment_authority_id', 'uuid'],
  ['requested_deployment_authority_fingerprint_sha256', 'text'],
  ['requested_primary_attestation_sha256', 'text'],
  ['requested_corroborating_attestation_sha256', 'text'],
  ['requested_transaction_evidence_sha256', 'text'],
  ['requested_observed_at', 'timestamp with time zone'],
  ['requested_deadline_at', 'timestamp with time zone'],
  ['requested_correlation_id', 'uuid'],
] as const);

const RECORD_ADMISSION_IDENTITY = `record_authenticated_mainnet_financial_action_reconciliation_v1(${RECORD_ADMISSION_ARGUMENTS.map(([, type]) => type).join(',')})`;
const RECORD_REVIEW_IDENTITY = `record_mainnet_financial_action_post_finality_review_v1(${RECORD_REVIEW_ARGUMENTS.map(([, type]) => type).join(',')})`;
const CONTROL_AUTHORITY_ARGUMENTS = Object.freeze([
  ['requested_event_id', 'uuid'],
  ['requested_authority_kind', 'text'],
  ['requested_source_authority_id', 'uuid'],
  ['requested_deployment_authority_id', 'uuid'],
  ['requested_authority_fingerprint_sha256', 'text'],
  ['requested_control_action', 'text'],
  ['requested_reason_code', 'text'],
] as const);
const CONTROL_AUTHORITY_IDENTITY = `control_mainnet_financial_action_reconciliation_authority_v1(${CONTROL_AUTHORITY_ARGUMENTS.map(([, type]) => type).join(',')})`;
const READ_EFFECTIVE_IDENTITY =
  'read_mainnet_financial_action_effective_safety_state_v1(uuid,uuid)';

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

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0035 predecessor verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

const HISTORY_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'mainnet financial action authenticated finality history is append-only'
        USING ERRCODE = '55000';
    END;`;

const ADMISSION_GUARD_BODY = `
    BEGIN
      IF NEW.reconciliation_outcome IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM mainnet_financial_action_reconciliation_admissions AS admission
          WHERE admission.intent_id = NEW.intent_id
            AND admission.admitted_event_revision = NEW.revision
            AND admission.admitted_transition_fingerprint_sha256 =
              NEW.transition_fingerprint_sha256
            AND admission.observation_id = NEW.observation_id
        )
      THEN
        RAISE EXCEPTION 'mainnet financial action reconciliation lacks authenticated admission'
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;`;

const FINALITY_FINGERPRINT_BYTES_BODY = `
    DECLARE
      encoded bytea := pg_catalog.decode('434c4d41465001', 'hex');
      field_name text;
      field_value text;
      field_name_bytes bytea;
      field_value_bytes bytea;
      field_index integer;
      seen_names text[] := ARRAY['domain']::text[];
    BEGIN
      IF requested_domain IS NULL
        OR requested_field_names IS NULL
        OR requested_field_values IS NULL
        OR requested_domain NOT IN (
          ${FINALITY_FINGERPRINT_DOMAINS.map((domain) => `'${domain}'`).join(',\n          ')}
        )
        OR pg_catalog.array_ndims(requested_field_names) <> 1
        OR pg_catalog.array_ndims(requested_field_values) <> 1
        OR pg_catalog.array_lower(requested_field_names, 1) <> 1
        OR pg_catalog.array_lower(requested_field_values, 1) <> 1
        OR pg_catalog.cardinality(requested_field_names) NOT BETWEEN 1 AND 64
        OR pg_catalog.cardinality(requested_field_names) <>
          pg_catalog.cardinality(requested_field_values)
        OR requested_field_names[1] <> 'fingerprintEncodingVersion'
        OR requested_field_values[1] <> '1'
      THEN
        RAISE EXCEPTION 'invalid CLMA-AF-FP-1 frame request' USING ERRCODE = '22023';
      END IF;
      field_name_bytes := pg_catalog.convert_to('domain', 'UTF8');
      field_value_bytes := pg_catalog.convert_to(requested_domain, 'UTF8');
      encoded := encoded
        || pg_catalog.int2send(pg_catalog.octet_length(field_name_bytes)::smallint)
        || field_name_bytes || pg_catalog.decode('01', 'hex')
        || pg_catalog.int4send(pg_catalog.octet_length(field_value_bytes))
        || field_value_bytes;
      FOR field_index IN 1..pg_catalog.cardinality(requested_field_names) LOOP
        field_name := requested_field_names[field_index];
        field_value := requested_field_values[field_index];
        IF field_name IS NULL
          OR field_name !~ '^[a-z][A-Za-z0-9]{0,63}$'
          OR field_name = ANY(seen_names)
        THEN
          RAISE EXCEPTION 'invalid CLMA-AF-FP-1 field name' USING ERRCODE = '22023';
        END IF;
        seen_names := pg_catalog.array_append(seen_names, field_name);
        field_name_bytes := pg_catalog.convert_to(field_name, 'UTF8');
        encoded := encoded
          || pg_catalog.int2send(pg_catalog.octet_length(field_name_bytes)::smallint)
          || field_name_bytes;
        IF field_value IS NULL THEN
          encoded := encoded || pg_catalog.decode('00', 'hex') || pg_catalog.int4send(0);
        ELSE
          field_value_bytes := pg_catalog.convert_to(field_value, 'UTF8');
          IF pg_catalog.octet_length(field_value_bytes) > 16384 THEN
            RAISE EXCEPTION 'CLMA-AF-FP-1 field value is too large' USING ERRCODE = '22023';
          END IF;
          encoded := encoded || pg_catalog.decode('01', 'hex')
            || pg_catalog.int4send(pg_catalog.octet_length(field_value_bytes))
            || field_value_bytes;
        END IF;
      END LOOP;
      RETURN encoded;
    END;`;

const FINALITY_FINGERPRINT_BODY = `
    BEGIN
      RETURN pg_catalog.encode(
        pg_catalog.sha256(
          mainnet_action_authenticated_finality_fingerprint_bytes_v1(
            requested_domain, requested_field_names, requested_field_values
          )
        ),
        'hex'
      );
    END;`;

function digestValidation(name: string): string {
  return `(${name} ~ '^[0-9a-f]{64}$' AND ${name} <> pg_catalog.repeat('0', 64))`;
}

const CONTROL_AUTHORITY_BODY = `
    DECLARE
      replay mainnet_financial_action_reconciliation_authority_controls%ROWTYPE;
      source_authority mainnet_financial_action_reconciliation_source_authorities%ROWTYPE;
      deployment_authority mainnet_financial_action_reconciliation_deployment_authorities%ROWTYPE;
      database_recorded_at timestamptz;
    BEGIN
      IF requested_event_id IS NULL
        OR requested_authority_kind IS NULL
        OR requested_authority_fingerprint_sha256 IS NULL
        OR requested_control_action IS NULL
        OR requested_reason_code IS NULL
        OR pg_catalog.substring(requested_event_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_event_id::text, 20, 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_authority_kind NOT IN ('SOURCE', 'DEPLOYMENT')
        OR (requested_source_authority_id IS NULL) <> (requested_authority_kind = 'DEPLOYMENT')
        OR (requested_deployment_authority_id IS NULL) <> (requested_authority_kind = 'SOURCE')
        OR NOT ${digestValidation('requested_authority_fingerprint_sha256')}
        OR requested_control_action NOT IN ('SUSPENDED', 'REVOKED')
        OR requested_reason_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action authority control event'
          USING ERRCODE = '22023';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_event_id::text, 56035)
      );
      SELECT event.* INTO replay
      FROM mainnet_financial_action_reconciliation_authority_controls AS event
      WHERE event.event_id = requested_event_id;
      IF FOUND THEN
        IF replay.authority_kind <> requested_authority_kind
          OR replay.source_authority_id IS DISTINCT FROM requested_source_authority_id
          OR replay.deployment_authority_id IS DISTINCT FROM requested_deployment_authority_id
          OR replay.authority_fingerprint_sha256 <>
            requested_authority_fingerprint_sha256
          OR replay.control_action <> requested_control_action
          OR replay.reason_code <> requested_reason_code
        THEN
          RAISE EXCEPTION 'mainnet financial action authority control replay conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT 'REPLAYED'::text, replay.event_id, replay.recorded_at;
        RETURN;
      END IF;

      IF requested_authority_kind = 'SOURCE' THEN
        SELECT source.* INTO STRICT source_authority
        FROM mainnet_financial_action_reconciliation_source_authorities AS source
        WHERE source.source_authority_id = requested_source_authority_id
          AND source.authority_fingerprint_sha256 = requested_authority_fingerprint_sha256
        FOR UPDATE;
      ELSE
        SELECT deployment.* INTO STRICT deployment_authority
        FROM mainnet_financial_action_reconciliation_deployment_authorities AS deployment
        WHERE deployment.deployment_authority_id = requested_deployment_authority_id
          AND deployment.authority_fingerprint_sha256 =
            requested_authority_fingerprint_sha256;
        SELECT source.* INTO STRICT source_authority
        FROM mainnet_financial_action_reconciliation_source_authorities AS source
        WHERE source.source_authority_id = deployment_authority.source_authority_id
          AND source.authority_fingerprint_sha256 =
            deployment_authority.source_authority_fingerprint_sha256
        FOR UPDATE;
        SELECT deployment.* INTO STRICT deployment_authority
        FROM mainnet_financial_action_reconciliation_deployment_authorities AS deployment
        WHERE deployment.deployment_authority_id = requested_deployment_authority_id
          AND deployment.authority_fingerprint_sha256 =
            requested_authority_fingerprint_sha256
        FOR UPDATE;
      END IF;
      database_recorded_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      INSERT INTO mainnet_financial_action_reconciliation_authority_controls (
        event_id, authority_kind, source_authority_id, deployment_authority_id,
        authority_fingerprint_sha256, control_action, reason_code, active_control,
        recorded_at
      ) VALUES (
        requested_event_id, requested_authority_kind, requested_source_authority_id,
        requested_deployment_authority_id, requested_authority_fingerprint_sha256,
        requested_control_action, requested_reason_code, true, database_recorded_at
      );
      RETURN QUERY SELECT 'RECORDED'::text, requested_event_id, database_recorded_at;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action authority is unavailable'
        USING ERRCODE = '55000';
    END;`;

const AUTHORITY_GATE_BODY = `
      SELECT source.* INTO STRICT source_authority
      FROM mainnet_financial_action_reconciliation_source_authorities AS source
      WHERE source.source_authority_id = requested_source_authority_id
        AND source.authority_fingerprint_sha256 =
          requested_source_authority_fingerprint_sha256
      FOR SHARE;
      SELECT deployment.* INTO STRICT deployment_authority
      FROM mainnet_financial_action_reconciliation_deployment_authorities AS deployment
      WHERE deployment.deployment_authority_id = requested_deployment_authority_id
        AND deployment.authority_fingerprint_sha256 =
          requested_deployment_authority_fingerprint_sha256
        AND deployment.source_authority_id = source_authority.source_authority_id
        AND deployment.source_authority_fingerprint_sha256 =
          source_authority.authority_fingerprint_sha256
      FOR SHARE;
      SELECT evidence.* INTO STRICT chain_evidence
      FROM provider_position_chain_anchor_evidence AS evidence
      WHERE evidence.evidence_fingerprint_sha256 =
          requested_chain_anchor_evidence_fingerprint_sha256
      FOR SHARE;

      database_checked_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF source_authority.network_id <> chain_evidence.network_id
        OR deployment_authority.network_id <> source_authority.network_id
        OR chain_evidence.primary_source_family_id <>
          source_authority.primary_source_family_id
        OR chain_evidence.primary_source_id <> source_authority.primary_source_id
        OR chain_evidence.corroborating_source_family_id <>
          source_authority.corroborating_source_family_id
        OR chain_evidence.corroborating_source_id <>
          source_authority.corroborating_source_id
        OR chain_evidence.source_pair_registry_fingerprint_sha256 <>
          source_authority.source_pair_registry_fingerprint_sha256
        OR chain_evidence.source_pair_approval_id <>
          source_authority.source_pair_approval_id
        OR NOT (
          (chain_evidence.source_family_id = source_authority.primary_source_family_id
            AND chain_evidence.source_id = source_authority.primary_source_id
            AND chain_evidence.source_kind = source_authority.primary_source_kind)
          OR
          (chain_evidence.source_family_id = source_authority.corroborating_source_family_id
            AND chain_evidence.source_id = source_authority.corroborating_source_id
            AND chain_evidence.source_kind = source_authority.corroborating_source_kind)
        )
        OR chain_evidence.source_pair_approval_expires_at > source_authority.expires_at
        OR deployment_authority.approved_at < source_authority.approved_at
        OR deployment_authority.expires_at > source_authority.expires_at
        OR chain_evidence.identity_status <> 'VERIFIED'
        OR chain_evidence.progression_status <> 'CURRENT'
        OR chain_evidence.finality_status <> 'HEALTHY'
        OR database_checked_at < source_authority.approved_at
        OR database_checked_at < deployment_authority.approved_at
        OR database_checked_at >= source_authority.expires_at
        OR database_checked_at >= deployment_authority.expires_at
        OR database_checked_at >= chain_evidence.source_pair_approval_expires_at
        OR database_checked_at >= chain_evidence.current_head_advanced_at + (CASE
          WHEN source_authority.network_id = '${ETHEREUM}'
            THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END)
        OR database_checked_at >= chain_evidence.finalized_head_advanced_at + (CASE
          WHEN source_authority.network_id = '${ETHEREUM}'
            THEN interval '1800 seconds'
          ELSE interval '90 seconds'
        END)
        OR EXISTS (
          SELECT 1
          FROM provider_position_chain_anchor_control_events AS control
          WHERE control.evidence_fingerprint_sha256 =
              chain_evidence.evidence_fingerprint_sha256
            AND control.active_control
            AND control.control_action IN ('INVALIDATED', 'QUARANTINED')
        )
        OR EXISTS (
          SELECT 1
          FROM mainnet_financial_action_reconciliation_authority_controls AS control
          WHERE control.active_control
            AND (
              (control.authority_kind = 'SOURCE'
                AND control.source_authority_id = source_authority.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  source_authority.authority_fingerprint_sha256)
              OR (control.authority_kind = 'DEPLOYMENT'
                AND control.deployment_authority_id =
                  deployment_authority.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  deployment_authority.authority_fingerprint_sha256)
            )
        )
      THEN
        RAISE EXCEPTION 'mainnet financial action reconciliation authority is unavailable'
          USING ERRCODE = '55000';
      END IF;`;

const RECORD_ADMISSION_BODY = `
    DECLARE
      source_authority mainnet_financial_action_reconciliation_source_authorities%ROWTYPE;
      deployment_authority mainnet_financial_action_reconciliation_deployment_authorities%ROWTYPE;
      chain_evidence provider_position_chain_anchor_evidence%ROWTYPE;
      intent mainnet_financial_action_intents%ROWTYPE;
      submission_event mainnet_financial_action_events%ROWTYPE;
      prior_admission mainnet_financial_action_reconciliation_admissions%ROWTYPE;
      admitted_event mainnet_financial_action_events%ROWTYPE;
      lifecycle_result record;
      database_checked_at timestamptz;
      database_recorded_at timestamptz;
      source_claim text;
      effect_claim text;
      failure_claim text;
      admission_fingerprint text;
    BEGIN
      IF requested_account_id IS NULL
        OR requested_intent_id IS NULL
        OR requested_expected_revision IS NULL
        OR requested_expected_snapshot_sha256 IS NULL
        OR requested_observation_id IS NULL
        OR requested_transaction_id IS NULL
        OR requested_outcome IS NULL
        OR requested_finalized_position IS NULL
        OR requested_finalized_block_id IS NULL
        OR requested_chain_anchor_evidence_fingerprint_sha256 IS NULL
        OR requested_source_authority_id IS NULL
        OR requested_source_authority_fingerprint_sha256 IS NULL
        OR requested_deployment_authority_id IS NULL
        OR requested_deployment_authority_fingerprint_sha256 IS NULL
        OR requested_primary_attestation_sha256 IS NULL
        OR requested_corroborating_attestation_sha256 IS NULL
        OR requested_transaction_evidence_sha256 IS NULL
        OR requested_observed_at IS NULL
        OR requested_deadline_at IS NULL
        OR requested_correlation_id IS NULL
        OR requested_expected_revision < 2
        OR NOT ${digestValidation('requested_expected_snapshot_sha256')}
        OR pg_catalog.substring(requested_observation_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_observation_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR requested_outcome NOT IN (
          'PENDING', 'UNKNOWN', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'
        )
        OR NOT ${digestValidation('requested_chain_anchor_evidence_fingerprint_sha256')}
        OR NOT ${digestValidation('requested_source_authority_fingerprint_sha256')}
        OR NOT ${digestValidation('requested_deployment_authority_fingerprint_sha256')}
        OR NOT ${digestValidation('requested_primary_attestation_sha256')}
        OR NOT ${digestValidation('requested_corroborating_attestation_sha256')}
        OR NOT ${digestValidation('requested_transaction_evidence_sha256')}
        OR requested_primary_attestation_sha256 IN (
          requested_corroborating_attestation_sha256,
          requested_transaction_evidence_sha256
        )
        OR requested_corroborating_attestation_sha256 =
          requested_transaction_evidence_sha256
        OR NOT pg_catalog.isfinite(requested_observed_at)
        OR NOT pg_catalog.isfinite(requested_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_observed_at) <>
          requested_observed_at
        OR pg_catalog.date_trunc('milliseconds', requested_deadline_at) <>
          requested_deadline_at
        OR requested_observed_at >= requested_deadline_at
        OR requested_deadline_at > requested_observed_at + interval '30 seconds'
        OR pg_catalog.substring(requested_correlation_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_correlation_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR (requested_transaction_position IS NULL) <>
          (requested_transaction_block_id IS NULL)
        OR requested_finalized_position <> pg_catalog.trunc(requested_finalized_position)
        OR requested_finalized_position NOT BETWEEN 0 AND 18446744073709551615
        OR (requested_transaction_position IS NOT NULL AND (
          requested_transaction_position <> pg_catalog.trunc(requested_transaction_position)
          OR requested_transaction_position NOT BETWEEN 0 AND 18446744073709551615
        ))
        OR (requested_effect_evidence_sha256 IS NOT NULL AND
          NOT ${digestValidation('requested_effect_evidence_sha256')})
        OR (requested_failure_evidence_sha256 IS NOT NULL AND
          NOT ${digestValidation('requested_failure_evidence_sha256')})
        OR NOT (
          (requested_outcome = 'UNKNOWN'
            AND requested_transaction_position IS NULL
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NULL)
          OR (requested_outcome = 'PENDING'
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NULL
            AND (requested_transaction_position IS NULL
              OR requested_finalized_position < requested_transaction_position))
          OR (requested_outcome = 'FINALIZED_SUCCESS'
            AND requested_transaction_position IS NOT NULL
            AND requested_finalized_position >= requested_transaction_position
            AND requested_effect_evidence_sha256 IS NOT NULL
            AND requested_failure_evidence_sha256 IS NULL)
          OR (requested_outcome = 'FINALIZED_FAILURE'
            AND requested_transaction_position IS NOT NULL
            AND requested_finalized_position >= requested_transaction_position
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NOT NULL)
          OR (requested_outcome = 'REORGED_OUT'
            AND requested_transaction_position IS NOT NULL
            AND requested_finalized_position >= requested_transaction_position
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NULL)
        )
      THEN
        RAISE EXCEPTION 'invalid authenticated mainnet financial action reconciliation'
          USING ERRCODE = '22023';
      END IF;

      source_claim := mainnet_action_authenticated_finality_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_SOURCE_EVIDENCE:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'intentId', 'observationId',
          'chainAnchorEvidenceFingerprintSha256', 'sourceAuthorityId',
          'sourceAuthorityFingerprintSha256', 'deploymentAuthorityId',
          'deploymentAuthorityFingerprintSha256', 'primaryAttestationSha256',
          'corroboratingAttestationSha256', 'transactionEvidenceSha256'
        ]::text[],
        ARRAY[
          '1', requested_intent_id::text, requested_observation_id::text,
          requested_chain_anchor_evidence_fingerprint_sha256,
          requested_source_authority_id::text,
          requested_source_authority_fingerprint_sha256,
          requested_deployment_authority_id::text,
          requested_deployment_authority_fingerprint_sha256,
          requested_primary_attestation_sha256,
          requested_corroborating_attestation_sha256,
          requested_transaction_evidence_sha256
        ]::text[]
      );
      effect_claim := CASE WHEN requested_effect_evidence_sha256 IS NULL THEN NULL ELSE
        mainnet_action_authenticated_finality_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_EFFECT_EVIDENCE:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'intentId', 'observationId', 'evidenceSha256'],
          ARRAY['1', requested_intent_id::text, requested_observation_id::text,
            requested_effect_evidence_sha256]::text[]
        ) END;
      failure_claim := CASE WHEN requested_failure_evidence_sha256 IS NULL THEN NULL ELSE
        mainnet_action_authenticated_finality_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_FAILURE_EVIDENCE:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'intentId', 'observationId', 'evidenceSha256'],
          ARRAY['1', requested_intent_id::text, requested_observation_id::text,
            requested_failure_evidence_sha256]::text[]
        ) END;
      admission_fingerprint := mainnet_action_authenticated_finality_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:AUTHENTICATED_RECONCILIATION_ADMISSION:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'accountId', 'intentId', 'expectedRevision',
          'expectedSnapshotSha256', 'observationId',
          'transactionId', 'outcome', 'transactionPosition', 'transactionBlockId',
          'finalizedPosition', 'finalizedBlockId', 'sourceEvidenceSha256',
          'effectEvidenceSha256', 'failureEvidenceSha256', 'observedAtEpochMilliseconds',
          'deadlineAtEpochMilliseconds', 'correlationId'
        ]::text[],
        ARRAY[
          '1', requested_account_id::text, requested_intent_id::text,
          requested_expected_revision::text, requested_expected_snapshot_sha256,
          requested_observation_id::text, requested_transaction_id, requested_outcome,
          requested_transaction_position::text, requested_transaction_block_id,
          requested_finalized_position::text, requested_finalized_block_id,
          source_claim, effect_claim, failure_claim,
          ((pg_catalog.date_part('epoch', requested_observed_at) * 1000)::bigint)::text,
          ((pg_catalog.date_part('epoch', requested_deadline_at) * 1000)::bigint)::text,
          requested_correlation_id::text
        ]::text[]
      );
      SELECT admission.* INTO prior_admission
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.observation_id = requested_observation_id;
      IF FOUND THEN
        IF prior_admission.intent_id <> requested_intent_id
          OR prior_admission.admission_fingerprint_sha256 <> admission_fingerprint
        THEN
          RAISE EXCEPTION 'authenticated reconciliation admission replay conflict'
            USING ERRCODE = '23505';
        END IF;
        SELECT * INTO STRICT lifecycle_result
        FROM mainnet_action_lifecycle_result(
          requested_account_id, requested_intent_id, 'READ'
        );
        RETURN QUERY SELECT
          'REPLAYED'::text, prior_admission.admission_fingerprint_sha256,
          prior_admission.admitted_event_revision,
          prior_admission.admitted_transition_fingerprint_sha256,
          lifecycle_result.lifecycle_stage, lifecycle_result.lifecycle_revision,
          lifecycle_result.current_snapshot_sha256,
          prior_admission.source_evidence_sha256,
          prior_admission.effect_evidence_sha256,
          prior_admission.failure_evidence_sha256,
          lifecycle_result.terminal, lifecycle_result.requires_manual_reconciliation,
          false, prior_admission.recorded_at;
        RETURN;
      END IF;
      IF EXISTS (
        SELECT 1 FROM mainnet_financial_action_events AS event
        WHERE event.observation_id = requested_observation_id
      ) THEN
        RAISE EXCEPTION 'unadmitted reconciliation history cannot be authenticated'
          USING ERRCODE = '55000';
      END IF;

${AUTHORITY_GATE_BODY}

      SELECT stored.* INTO STRICT intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR UPDATE;
      SELECT admission.* INTO prior_admission
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.observation_id = requested_observation_id;
      IF FOUND THEN
        IF prior_admission.intent_id <> requested_intent_id
          OR prior_admission.admission_fingerprint_sha256 <> admission_fingerprint
        THEN
          RAISE EXCEPTION 'authenticated reconciliation admission replay conflict'
            USING ERRCODE = '23505';
        END IF;
        SELECT * INTO STRICT lifecycle_result
        FROM mainnet_action_lifecycle_result(
          requested_account_id, requested_intent_id, 'READ'
        );
        RETURN QUERY SELECT
          'REPLAYED'::text, prior_admission.admission_fingerprint_sha256,
          prior_admission.admitted_event_revision,
          prior_admission.admitted_transition_fingerprint_sha256,
          lifecycle_result.lifecycle_stage, lifecycle_result.lifecycle_revision,
          lifecycle_result.current_snapshot_sha256,
          prior_admission.source_evidence_sha256,
          prior_admission.effect_evidence_sha256,
          prior_admission.failure_evidence_sha256,
          lifecycle_result.terminal, lifecycle_result.requires_manual_reconciliation,
          false, prior_admission.recorded_at;
        RETURN;
      END IF;
      SELECT event.* INTO STRICT submission_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = intent.intent_id
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';

      database_checked_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF intent.network_id <> source_authority.network_id
        OR deployment_authority.provider_id <> intent.provider_id
        OR deployment_authority.protocol_id <> intent.protocol_id
        OR deployment_authority.market_id <> intent.market_id
        OR deployment_authority.asset_registry_version <> intent.asset_registry_version
        OR deployment_authority.asset_registry_fingerprint_sha256 <>
          intent.asset_registry_fingerprint_sha256
        OR deployment_authority.asset_symbol <> intent.asset_symbol
        OR deployment_authority.asset_identity <> intent.asset_identity
        OR deployment_authority.asset_decimals <> intent.asset_decimals
        OR deployment_authority.action_type <> intent.action_type
        OR submission_event.chain_transaction_id <> requested_transaction_id
        OR requested_observed_at < source_authority.approved_at
        OR requested_observed_at < deployment_authority.approved_at
        OR requested_observed_at < chain_evidence.assessed_at
        OR requested_observed_at < chain_evidence.recorded_at
        OR requested_observed_at > database_checked_at
        OR database_checked_at >= requested_deadline_at
        OR database_checked_at >= source_authority.expires_at
        OR database_checked_at >= deployment_authority.expires_at
        OR database_checked_at >= chain_evidence.source_pair_approval_expires_at
        OR database_checked_at >= chain_evidence.current_head_advanced_at + (CASE
          WHEN intent.network_id = '${ETHEREUM}' THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END)
        OR database_checked_at >= chain_evidence.finalized_head_advanced_at + (CASE
          WHEN intent.network_id = '${ETHEREUM}' THEN interval '1800 seconds'
          ELSE interval '90 seconds'
        END)
        OR NOT mainnet_action_chain_identity_valid(
          intent.network_id, requested_transaction_id, 'TRANSACTION'
        )
        OR NOT mainnet_action_chain_identity_valid(
          intent.network_id, requested_finalized_block_id, 'BLOCK'
        )
        OR (requested_transaction_block_id IS NOT NULL AND
          NOT mainnet_action_chain_identity_valid(
            intent.network_id, requested_transaction_block_id, 'BLOCK'
          ))
        OR (intent.network_id = '${ETHEREUM}'
          AND requested_outcome IN (
            'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'
          )
          AND requested_finalized_position = requested_transaction_position
          AND requested_finalized_block_id <> requested_transaction_block_id)
        OR (
          intent.network_id = '${ETHEREUM}'
          AND (
            chain_evidence.agreed_finalized_head ->> 'kind' <> 'EVM_BLOCK'
            OR chain_evidence.agreed_finalized_head ->> 'blockNumber' <>
              requested_finalized_position::text
            OR chain_evidence.agreed_finalized_head ->> 'blockHash' <>
              requested_finalized_block_id
            OR (requested_transaction_position IS NOT NULL AND (
              chain_evidence.chain_anchor ->> 'kind' <> 'EVM_BLOCK'
              OR chain_evidence.chain_anchor ->> 'blockNumber' <>
                requested_transaction_position::text
              OR chain_evidence.chain_anchor ->> 'blockHash' <>
                requested_transaction_block_id
            ))
          )
        )
        OR (
          intent.network_id = '${SOLANA}'
          AND (
            chain_evidence.agreed_finalized_head ->> 'kind' <> 'SOLANA_SLOT'
            OR chain_evidence.agreed_finalized_head ->> 'root' <>
              requested_finalized_position::text
            OR (requested_transaction_position IS NOT NULL AND (
              chain_evidence.chain_anchor ->> 'kind' <> 'SOLANA_SLOT'
              OR chain_evidence.chain_anchor ->> 'slot' <>
                requested_transaction_position::text
            ))
          )
        )
      THEN
        RAISE EXCEPTION 'authenticated mainnet financial action evidence does not bind intent'
          USING ERRCODE = '22023';
      END IF;

      SET CONSTRAINTS mainnet_action_reconciliation_requires_authenticated_admission DEFERRED;
      SELECT * INTO STRICT lifecycle_result
      FROM record_mainnet_financial_action_reconciliation_observation(
        requested_account_id, requested_intent_id, requested_expected_revision,
        requested_expected_snapshot_sha256, requested_observation_id,
        requested_transaction_id, requested_outcome, requested_transaction_position,
        requested_transaction_block_id, requested_finalized_position,
        requested_finalized_block_id, effect_claim, failure_claim, source_claim,
        requested_observed_at, requested_correlation_id
      );
      SELECT event.* INTO STRICT admitted_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = intent.intent_id
        AND event.observation_id = requested_observation_id;
      database_recorded_at := admitted_event.recorded_at;
      INSERT INTO mainnet_financial_action_reconciliation_admissions (
        admission_fingerprint_sha256, observation_id, intent_id,
        admitted_event_revision, admitted_transition_fingerprint_sha256,
        admitted_event_snapshot_sha256, network_id, chain_transaction_id,
        reconciliation_outcome, transaction_position, transaction_block_id,
        finalized_position, finalized_block_id,
        chain_anchor_evidence_fingerprint_sha256,
        source_authority_id, source_authority_fingerprint_sha256,
        deployment_authority_id, deployment_authority_fingerprint_sha256,
        primary_attestation_sha256, corroborating_attestation_sha256,
        transaction_evidence_sha256, source_evidence_sha256,
        effect_evidence_sha256, failure_evidence_sha256,
        observed_at, deadline_at, correlation_id, recorded_at
      ) VALUES (
        admission_fingerprint, requested_observation_id, intent.intent_id,
        admitted_event.revision, admitted_event.transition_fingerprint_sha256,
        admitted_event.snapshot_sha256, intent.network_id, requested_transaction_id,
        requested_outcome, requested_transaction_position, requested_transaction_block_id,
        requested_finalized_position, requested_finalized_block_id,
        chain_evidence.evidence_fingerprint_sha256,
        source_authority.source_authority_id, source_authority.authority_fingerprint_sha256,
        deployment_authority.deployment_authority_id,
        deployment_authority.authority_fingerprint_sha256,
        requested_primary_attestation_sha256, requested_corroborating_attestation_sha256,
        requested_transaction_evidence_sha256, source_claim, effect_claim, failure_claim,
        requested_observed_at, requested_deadline_at, requested_correlation_id,
        database_recorded_at
      );
      RETURN QUERY SELECT
        'RECORDED'::text, admission_fingerprint, admitted_event.revision,
        admitted_event.transition_fingerprint_sha256,
        lifecycle_result.lifecycle_stage, lifecycle_result.lifecycle_revision,
        lifecycle_result.current_snapshot_sha256, source_claim, effect_claim, failure_claim,
        lifecycle_result.terminal, lifecycle_result.requires_manual_reconciliation,
        false, database_recorded_at;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'authenticated mainnet financial action evidence is unavailable'
        USING ERRCODE = '55000';
    END;`;

const RECORD_REVIEW_BODY = `
    DECLARE
      source_authority mainnet_financial_action_reconciliation_source_authorities%ROWTYPE;
      deployment_authority mainnet_financial_action_reconciliation_deployment_authorities%ROWTYPE;
      chain_evidence provider_position_chain_anchor_evidence%ROWTYPE;
      intent mainnet_financial_action_intents%ROWTYPE;
      terminal_event mainnet_financial_action_events%ROWTYPE;
      original_admission mainnet_financial_action_reconciliation_admissions%ROWTYPE;
      latest_review mainnet_financial_action_post_finality_reviews%ROWTYPE;
      prior_reaffirmation mainnet_financial_action_post_finality_reviews%ROWTYPE;
      replay_review mainnet_financial_action_post_finality_reviews%ROWTYPE;
      database_checked_at timestamptz;
      database_recorded_at timestamptz;
      review_fingerprint text;
      authority_controlled boolean;
      effective_state text;
    BEGIN
      IF requested_account_id IS NULL
        OR requested_intent_id IS NULL
        OR requested_terminal_revision IS NULL
        OR requested_terminal_snapshot_sha256 IS NULL
        OR requested_expected_review_revision IS NULL
        OR requested_review_id IS NULL
        OR requested_disposition IS NULL
        OR requested_lineage_status IS NULL
        OR requested_transaction_id IS NULL
        OR requested_transaction_position IS NULL
        OR requested_transaction_block_id IS NULL
        OR requested_finalized_position IS NULL
        OR requested_finalized_block_id IS NULL
        OR requested_chain_anchor_evidence_fingerprint_sha256 IS NULL
        OR requested_source_authority_id IS NULL
        OR requested_source_authority_fingerprint_sha256 IS NULL
        OR requested_deployment_authority_id IS NULL
        OR requested_deployment_authority_fingerprint_sha256 IS NULL
        OR requested_primary_attestation_sha256 IS NULL
        OR requested_corroborating_attestation_sha256 IS NULL
        OR requested_transaction_evidence_sha256 IS NULL
        OR requested_observed_at IS NULL
        OR requested_deadline_at IS NULL
        OR requested_correlation_id IS NULL
        OR requested_terminal_revision < 3
        OR NOT ${digestValidation('requested_terminal_snapshot_sha256')}
        OR requested_expected_review_revision < 0
        OR (requested_expected_previous_review_fingerprint_sha256 IS NULL) <>
          (requested_expected_review_revision = 0)
        OR (requested_expected_previous_review_fingerprint_sha256 IS NOT NULL AND
          NOT ${digestValidation('requested_expected_previous_review_fingerprint_sha256')})
        OR pg_catalog.substring(requested_review_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_review_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR requested_disposition NOT IN (
          'FINALITY_REAFFIRMED', 'REVIEW_INCONCLUSIVE', 'DEEP_REORG_QUARANTINED'
        )
        OR requested_lineage_status NOT IN ('CANONICAL', 'UNKNOWN', 'CONFLICT')
        OR NOT (
          (requested_disposition = 'FINALITY_REAFFIRMED'
            AND requested_lineage_status = 'CANONICAL')
          OR (requested_disposition = 'REVIEW_INCONCLUSIVE'
            AND requested_lineage_status = 'UNKNOWN')
          OR (requested_disposition = 'DEEP_REORG_QUARANTINED'
            AND requested_lineage_status = 'CONFLICT')
        )
        OR requested_transaction_position <> pg_catalog.trunc(requested_transaction_position)
        OR requested_transaction_position NOT BETWEEN 0 AND 18446744073709551615
        OR requested_finalized_position <> pg_catalog.trunc(requested_finalized_position)
        OR requested_finalized_position NOT BETWEEN 0 AND 18446744073709551615
        OR NOT ${digestValidation('requested_chain_anchor_evidence_fingerprint_sha256')}
        OR NOT ${digestValidation('requested_source_authority_fingerprint_sha256')}
        OR NOT ${digestValidation('requested_deployment_authority_fingerprint_sha256')}
        OR NOT ${digestValidation('requested_primary_attestation_sha256')}
        OR NOT ${digestValidation('requested_corroborating_attestation_sha256')}
        OR NOT ${digestValidation('requested_transaction_evidence_sha256')}
        OR requested_primary_attestation_sha256 IN (
          requested_corroborating_attestation_sha256,
          requested_transaction_evidence_sha256
        )
        OR requested_corroborating_attestation_sha256 =
          requested_transaction_evidence_sha256
        OR NOT pg_catalog.isfinite(requested_observed_at)
        OR NOT pg_catalog.isfinite(requested_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_observed_at) <>
          requested_observed_at
        OR pg_catalog.date_trunc('milliseconds', requested_deadline_at) <>
          requested_deadline_at
        OR requested_observed_at >= requested_deadline_at
        OR requested_deadline_at > requested_observed_at + interval '30 seconds'
        OR pg_catalog.substring(requested_correlation_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_correlation_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action post-finality review'
          USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_review_id::text, 56036)
      );

      SELECT review.* INTO replay_review
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.review_id = requested_review_id;
      IF FOUND THEN
        IF replay_review.intent_id <> requested_intent_id
          OR replay_review.terminal_event_revision <> requested_terminal_revision
          OR replay_review.terminal_snapshot_sha256 <> requested_terminal_snapshot_sha256
          OR replay_review.review_revision <> requested_expected_review_revision + 1
          OR replay_review.previous_review_fingerprint_sha256 IS DISTINCT FROM
            requested_expected_previous_review_fingerprint_sha256
          OR replay_review.disposition <> requested_disposition
          OR replay_review.lineage_status <> requested_lineage_status
          OR replay_review.chain_transaction_id <> requested_transaction_id
          OR replay_review.transaction_position <> requested_transaction_position
          OR replay_review.transaction_block_id <> requested_transaction_block_id
          OR replay_review.finalized_position <> requested_finalized_position
          OR replay_review.finalized_block_id <> requested_finalized_block_id
          OR replay_review.chain_anchor_evidence_fingerprint_sha256 <>
            requested_chain_anchor_evidence_fingerprint_sha256
          OR replay_review.source_authority_id <> requested_source_authority_id
          OR replay_review.source_authority_fingerprint_sha256 <>
            requested_source_authority_fingerprint_sha256
          OR replay_review.deployment_authority_id <> requested_deployment_authority_id
          OR replay_review.deployment_authority_fingerprint_sha256 <>
            requested_deployment_authority_fingerprint_sha256
          OR replay_review.primary_attestation_sha256 <>
            requested_primary_attestation_sha256
          OR replay_review.corroborating_attestation_sha256 <>
            requested_corroborating_attestation_sha256
          OR replay_review.transaction_evidence_sha256 <>
            requested_transaction_evidence_sha256
          OR replay_review.observed_at <> requested_observed_at
          OR replay_review.deadline_at <> requested_deadline_at
          OR replay_review.correlation_id <> requested_correlation_id
          OR NOT EXISTS (
            SELECT 1 FROM mainnet_financial_action_intents AS stored
            WHERE stored.intent_id = requested_intent_id
              AND stored.account_id = requested_account_id
          )
        THEN
          RAISE EXCEPTION 'post-finality review replay conflict' USING ERRCODE = '23505';
        END IF;
        SELECT admission.* INTO STRICT original_admission
        FROM mainnet_financial_action_reconciliation_admissions AS admission
        WHERE admission.admission_fingerprint_sha256 =
          replay_review.original_admission_fingerprint_sha256;
        SELECT review.* INTO latest_review
        FROM mainnet_financial_action_post_finality_reviews AS review
        WHERE review.intent_id = requested_intent_id
        ORDER BY review.review_revision DESC LIMIT 1;
        authority_controlled := EXISTS (
          SELECT 1
          FROM mainnet_financial_action_reconciliation_authority_controls AS control
          WHERE control.active_control AND (
            (control.authority_kind = 'SOURCE' AND (
              (control.source_authority_id = original_admission.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  original_admission.source_authority_fingerprint_sha256)
              OR (control.source_authority_id = latest_review.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  latest_review.source_authority_fingerprint_sha256)
            )) OR (control.authority_kind = 'DEPLOYMENT' AND (
              (control.deployment_authority_id = original_admission.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  original_admission.deployment_authority_fingerprint_sha256)
              OR (control.deployment_authority_id = latest_review.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  latest_review.deployment_authority_fingerprint_sha256)
            ))
          )
        );
        effective_state := CASE
          WHEN EXISTS (
            SELECT 1 FROM mainnet_financial_action_post_finality_reviews AS prior
            WHERE prior.intent_id = requested_intent_id
              AND prior.disposition = 'DEEP_REORG_QUARANTINED'
          ) THEN 'DEEP_REORG_QUARANTINED'
          WHEN authority_controlled THEN 'AUTHORITY_CONTROLLED_QUARANTINED'
          WHEN latest_review.disposition = 'REVIEW_INCONCLUSIVE'
            THEN 'POST_FINALITY_REVIEW_INCONCLUSIVE'
          ELSE 'AUTHENTICATED_FINALITY_RECORDED'
        END;
        RETURN QUERY SELECT 'REPLAYED'::text, replay_review.review_fingerprint_sha256,
          replay_review.review_revision, latest_review.review_revision,
          latest_review.review_fingerprint_sha256, latest_review.disposition, effective_state,
          effective_state <> 'AUTHENTICATED_FINALITY_RECORDED', false,
          replay_review.recorded_at;
        RETURN;
      END IF;

${AUTHORITY_GATE_BODY}

      SELECT stored.* INTO STRICT intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR UPDATE;
      SELECT event.* INTO STRICT terminal_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = intent.intent_id
      ORDER BY event.revision DESC
      LIMIT 1;
      database_checked_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF terminal_event.revision <> requested_terminal_revision
        OR terminal_event.snapshot_sha256 <> requested_terminal_snapshot_sha256
        OR terminal_event.stage NOT IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')
        OR NOT terminal_event.terminal
        OR terminal_event.chain_transaction_id <> requested_transaction_id
        OR terminal_event.transaction_position <> requested_transaction_position
        OR intent.network_id <> source_authority.network_id
        OR deployment_authority.provider_id <> intent.provider_id
        OR deployment_authority.protocol_id <> intent.protocol_id
        OR deployment_authority.market_id <> intent.market_id
        OR deployment_authority.asset_registry_version <> intent.asset_registry_version
        OR deployment_authority.asset_registry_fingerprint_sha256 <>
          intent.asset_registry_fingerprint_sha256
        OR deployment_authority.asset_symbol <> intent.asset_symbol
        OR deployment_authority.asset_identity <> intent.asset_identity
        OR deployment_authority.asset_decimals <> intent.asset_decimals
        OR deployment_authority.action_type <> intent.action_type
        OR requested_observed_at < terminal_event.effective_at
        OR requested_observed_at < source_authority.approved_at
        OR requested_observed_at < deployment_authority.approved_at
        OR requested_observed_at < chain_evidence.assessed_at
        OR requested_observed_at < chain_evidence.recorded_at
        OR requested_observed_at > database_checked_at
        OR database_checked_at >= requested_deadline_at
        OR database_checked_at >= source_authority.expires_at
        OR database_checked_at >= deployment_authority.expires_at
        OR database_checked_at >= chain_evidence.source_pair_approval_expires_at
        OR database_checked_at >= chain_evidence.current_head_advanced_at + (CASE
          WHEN intent.network_id = '${ETHEREUM}' THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END)
        OR database_checked_at >= chain_evidence.finalized_head_advanced_at + (CASE
          WHEN intent.network_id = '${ETHEREUM}' THEN interval '1800 seconds'
          ELSE interval '90 seconds'
        END)
        OR NOT mainnet_action_chain_identity_valid(
          intent.network_id, requested_transaction_id, 'TRANSACTION'
        )
        OR NOT mainnet_action_chain_identity_valid(
          intent.network_id, requested_transaction_block_id, 'BLOCK'
        )
        OR NOT mainnet_action_chain_identity_valid(
          intent.network_id, requested_finalized_block_id, 'BLOCK'
        )
        OR (requested_disposition IN ('FINALITY_REAFFIRMED', 'REVIEW_INCONCLUSIVE')
          AND requested_transaction_block_id <> terminal_event.transaction_block_id)
        OR (requested_disposition = 'DEEP_REORG_QUARANTINED'
          AND requested_transaction_block_id = terminal_event.transaction_block_id)
        OR (
          intent.network_id = '${ETHEREUM}' AND (
            chain_evidence.chain_anchor ->> 'kind' <> 'EVM_BLOCK'
            OR chain_evidence.chain_anchor ->> 'blockNumber' <>
              requested_transaction_position::text
            OR chain_evidence.chain_anchor ->> 'blockHash' <>
              requested_transaction_block_id
            OR chain_evidence.agreed_finalized_head ->> 'blockNumber' <>
              requested_finalized_position::text
            OR chain_evidence.agreed_finalized_head ->> 'blockHash' <>
              requested_finalized_block_id
          )
        )
        OR (
          intent.network_id = '${SOLANA}' AND (
            chain_evidence.chain_anchor ->> 'kind' <> 'SOLANA_SLOT'
            OR chain_evidence.chain_anchor ->> 'slot' <>
              requested_transaction_position::text
            OR chain_evidence.agreed_finalized_head ->> 'root' <>
              requested_finalized_position::text
          )
        )
        OR (requested_disposition IN (
            'FINALITY_REAFFIRMED', 'DEEP_REORG_QUARANTINED'
          ) AND (
            requested_finalized_position < requested_transaction_position
            OR (intent.network_id = '${ETHEREUM}'
              AND requested_finalized_position = requested_transaction_position
              AND requested_finalized_block_id <> requested_transaction_block_id)
          ))
      THEN
        RAISE EXCEPTION 'post-finality evidence does not bind terminal action'
          USING ERRCODE = '22023';
      END IF;
      SELECT admission.* INTO STRICT original_admission
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.intent_id = terminal_event.intent_id
        AND admission.admitted_event_revision = terminal_event.revision
        AND admission.admitted_transition_fingerprint_sha256 =
          terminal_event.transition_fingerprint_sha256;

      review_fingerprint := mainnet_action_authenticated_finality_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:POST_FINALITY_REVIEW:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'reviewId', 'intentId', 'terminalRevision',
          'terminalSnapshotSha256', 'reviewRevision', 'previousReviewFingerprintSha256',
          'originalAdmissionFingerprintSha256',
          'disposition', 'lineageStatus', 'transactionId', 'transactionPosition',
          'transactionBlockId', 'finalizedPosition', 'finalizedBlockId',
          'chainAnchorEvidenceFingerprintSha256', 'sourceAuthorityId',
          'sourceAuthorityFingerprintSha256', 'deploymentAuthorityId',
          'deploymentAuthorityFingerprintSha256', 'primaryAttestationSha256',
          'corroboratingAttestationSha256', 'transactionEvidenceSha256',
          'observedAtEpochMilliseconds', 'deadlineAtEpochMilliseconds', 'correlationId'
        ]::text[],
        ARRAY[
          '1', requested_review_id::text, intent.intent_id::text,
          requested_terminal_revision::text, requested_terminal_snapshot_sha256,
          (requested_expected_review_revision + 1)::text,
          requested_expected_previous_review_fingerprint_sha256,
          original_admission.admission_fingerprint_sha256,
          requested_disposition, requested_lineage_status, requested_transaction_id,
          requested_transaction_position::text, requested_transaction_block_id,
          requested_finalized_position::text, requested_finalized_block_id,
          chain_evidence.evidence_fingerprint_sha256,
          source_authority.source_authority_id::text,
          source_authority.authority_fingerprint_sha256,
          deployment_authority.deployment_authority_id::text,
          deployment_authority.authority_fingerprint_sha256,
          requested_primary_attestation_sha256,
          requested_corroborating_attestation_sha256,
          requested_transaction_evidence_sha256,
          ((pg_catalog.date_part('epoch', requested_observed_at) * 1000)::bigint)::text,
          ((pg_catalog.date_part('epoch', requested_deadline_at) * 1000)::bigint)::text,
          requested_correlation_id::text
        ]::text[]
      );
      SELECT review.* INTO latest_review
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.intent_id = intent.intent_id
      ORDER BY review.review_revision DESC
      LIMIT 1;
      IF (latest_review.review_id IS NULL AND (
          requested_expected_review_revision <> 0
          OR requested_expected_previous_review_fingerprint_sha256 IS NOT NULL
        )) OR (latest_review.review_id IS NOT NULL AND (
          latest_review.review_revision <> requested_expected_review_revision
          OR latest_review.review_fingerprint_sha256 <>
            requested_expected_previous_review_fingerprint_sha256
          OR requested_observed_at < latest_review.observed_at
        ))
      THEN
        RAISE EXCEPTION 'post-finality review compare-and-swap conflict'
          USING ERRCODE = '40001';
      END IF;
      IF latest_review.disposition = 'DEEP_REORG_QUARANTINED'
        AND requested_disposition <> 'DEEP_REORG_QUARANTINED'
      THEN
        RAISE EXCEPTION 'post-finality quarantine is permanent' USING ERRCODE = '55000';
      END IF;
      SELECT review.* INTO prior_reaffirmation
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.intent_id = intent.intent_id
        AND review.disposition = 'FINALITY_REAFFIRMED'
      ORDER BY review.finalized_position DESC, review.review_revision DESC
      LIMIT 1;
      IF requested_disposition = 'FINALITY_REAFFIRMED'
        AND (
          requested_finalized_position < original_admission.finalized_position
          OR (requested_finalized_position = original_admission.finalized_position
            AND requested_finalized_block_id <> original_admission.finalized_block_id)
          OR (prior_reaffirmation.review_id IS NOT NULL AND (
            requested_finalized_position < prior_reaffirmation.finalized_position
            OR (requested_finalized_position = prior_reaffirmation.finalized_position
              AND requested_finalized_block_id <> prior_reaffirmation.finalized_block_id)
          ))
        )
      THEN
        RAISE EXCEPTION 'post-finality reaffirmation regressed' USING ERRCODE = '22023';
      END IF;

      database_recorded_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      INSERT INTO mainnet_financial_action_post_finality_reviews (
        review_fingerprint_sha256, review_id, intent_id, review_revision,
        previous_review_fingerprint_sha256, terminal_event_revision,
        terminal_transition_fingerprint_sha256, terminal_snapshot_sha256,
        original_admission_fingerprint_sha256,
        disposition, lineage_status, network_id, chain_transaction_id,
        transaction_position, transaction_block_id, finalized_position,
        finalized_block_id, chain_anchor_evidence_fingerprint_sha256,
        source_authority_id, source_authority_fingerprint_sha256,
        deployment_authority_id, deployment_authority_fingerprint_sha256,
        primary_attestation_sha256, corroborating_attestation_sha256,
        transaction_evidence_sha256, observed_at, deadline_at, correlation_id,
        may_authorize_financial_action, may_resend_transaction,
        ledger_settlement_authority, recorded_at
      ) VALUES (
        review_fingerprint, requested_review_id, intent.intent_id,
        requested_expected_review_revision + 1,
        requested_expected_previous_review_fingerprint_sha256,
        terminal_event.revision, terminal_event.transition_fingerprint_sha256,
        terminal_event.snapshot_sha256, original_admission.admission_fingerprint_sha256,
        requested_disposition,
        requested_lineage_status, intent.network_id, requested_transaction_id,
        requested_transaction_position, requested_transaction_block_id,
        requested_finalized_position, requested_finalized_block_id,
        chain_evidence.evidence_fingerprint_sha256,
        source_authority.source_authority_id, source_authority.authority_fingerprint_sha256,
        deployment_authority.deployment_authority_id,
        deployment_authority.authority_fingerprint_sha256,
        requested_primary_attestation_sha256, requested_corroborating_attestation_sha256,
        requested_transaction_evidence_sha256, requested_observed_at,
        requested_deadline_at, requested_correlation_id, false, false, false,
        database_recorded_at
      );
      effective_state := CASE
        WHEN requested_disposition = 'DEEP_REORG_QUARANTINED'
          THEN 'DEEP_REORG_QUARANTINED'
        WHEN requested_disposition = 'REVIEW_INCONCLUSIVE'
          THEN 'POST_FINALITY_REVIEW_INCONCLUSIVE'
        ELSE 'AUTHENTICATED_FINALITY_RECORDED'
      END;
      RETURN QUERY SELECT 'RECORDED'::text, review_fingerprint,
        requested_expected_review_revision + 1,
        requested_expected_review_revision + 1, review_fingerprint,
        requested_disposition, effective_state,
        effective_state <> 'AUTHENTICATED_FINALITY_RECORDED', false,
        database_recorded_at;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'post-finality evidence is unavailable' USING ERRCODE = '55000';
    END;`;

const READ_EFFECTIVE_BODY = `
    DECLARE
      intent mainnet_financial_action_intents%ROWTYPE;
      current_event mainnet_financial_action_events%ROWTYPE;
      current_admission mainnet_financial_action_reconciliation_admissions%ROWTYPE;
      latest_review mainnet_financial_action_post_finality_reviews%ROWTYPE;
      authenticated boolean;
      authority_controlled boolean;
      effective_state text;
    BEGIN
      SELECT stored.* INTO STRICT intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id;
      SELECT event.* INTO STRICT current_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = intent.intent_id
      ORDER BY event.revision DESC LIMIT 1;
      SELECT admission.* INTO current_admission
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.intent_id = current_event.intent_id
        AND admission.admitted_event_revision = current_event.revision
        AND admission.admitted_transition_fingerprint_sha256 =
          current_event.transition_fingerprint_sha256;
      SELECT review.* INTO latest_review
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.intent_id = intent.intent_id
      ORDER BY review.review_revision DESC LIMIT 1;
      authenticated := current_event.reconciliation_outcome IS NOT NULL
        AND current_admission.admission_fingerprint_sha256 IS NOT NULL;
      authority_controlled := EXISTS (
        SELECT 1
        FROM mainnet_financial_action_reconciliation_authority_controls AS control
        WHERE control.active_control
          AND (
            (control.authority_kind = 'SOURCE' AND (
              (control.source_authority_id = current_admission.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  current_admission.source_authority_fingerprint_sha256)
              OR (control.source_authority_id = latest_review.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  latest_review.source_authority_fingerprint_sha256)
            ))
            OR (control.authority_kind = 'DEPLOYMENT' AND (
              (control.deployment_authority_id = current_admission.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  current_admission.deployment_authority_fingerprint_sha256)
              OR (control.deployment_authority_id = latest_review.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  latest_review.deployment_authority_fingerprint_sha256)
            ))
          )
      );
      effective_state := CASE
        WHEN EXISTS (
          SELECT 1 FROM mainnet_financial_action_post_finality_reviews AS review
          WHERE review.intent_id = intent.intent_id
            AND review.disposition = 'DEEP_REORG_QUARANTINED'
        ) THEN 'DEEP_REORG_QUARANTINED'
        WHEN authority_controlled THEN 'AUTHORITY_CONTROLLED_QUARANTINED'
        WHEN latest_review.disposition = 'REVIEW_INCONCLUSIVE'
          THEN 'POST_FINALITY_REVIEW_INCONCLUSIVE'
        WHEN current_event.stage = 'REORG_QUARANTINED'
          THEN 'REORG_QUARANTINED'
        WHEN current_event.stage IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')
          AND authenticated THEN 'AUTHENTICATED_FINALITY_RECORDED'
        WHEN current_event.terminal THEN 'UNAUTHENTICATED_TERMINAL_QUARANTINED'
        ELSE 'RECONCILIATION_PENDING'
      END;
      RETURN QUERY SELECT current_event.stage, intent.network_id, current_event.revision,
        current_event.snapshot_sha256, current_event.transition_fingerprint_sha256,
        current_admission.admission_fingerprint_sha256,
        current_event.chain_transaction_id, current_event.transaction_position,
        current_event.transaction_block_id, authenticated,
        latest_review.review_revision, latest_review.review_fingerprint_sha256,
        latest_review.disposition, effective_state,
        effective_state IN (
          'DEEP_REORG_QUARANTINED', 'POST_FINALITY_REVIEW_INCONCLUSIVE',
          'AUTHORITY_CONTROLLED_QUARANTINED', 'REORG_QUARANTINED',
          'UNAUTHENTICATED_TERMINAL_QUARANTINED'
        ), false, false, false;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action lifecycle is unavailable'
        USING ERRCODE = '55000';
    END;`;

const ADMISSION_RESULT = `
      admission_outcome text,
      admission_fingerprint_sha256 text,
      admitted_event_revision bigint,
      admitted_transition_fingerprint_sha256 text,
      lifecycle_stage text,
      lifecycle_revision bigint,
      current_snapshot_sha256 text,
      source_evidence_sha256 text,
      effect_evidence_sha256 text,
      failure_evidence_sha256 text,
      terminal boolean,
      requires_manual_reconciliation boolean,
      ledger_settlement_authority boolean,
      recorded_at timestamptz`;

const REVIEW_RESULT = `
      record_outcome text,
      review_fingerprint_sha256 text,
      review_revision bigint,
      current_review_revision bigint,
      current_review_fingerprint_sha256 text,
      current_review_disposition text,
      effective_safety_state text,
      requires_manual_review boolean,
      ledger_settlement_authority boolean,
      recorded_at timestamptz`;

const CONTROL_RESULT = `
      record_outcome text,
      recorded_event_id uuid,
      recorded_at timestamptz`;

const READ_RESULT = `
      lifecycle_stage text,
      network_id text,
      lifecycle_revision bigint,
      current_snapshot_sha256 text,
      current_transition_fingerprint_sha256 text,
      admission_fingerprint_sha256 text,
      chain_transaction_id text,
      transaction_position numeric,
      transaction_block_id text,
      authenticated_reconciliation boolean,
      review_revision bigint,
      review_fingerprint_sha256 text,
      latest_review_disposition text,
      effective_safety_state text,
      requires_manual_review boolean,
      may_authorize_financial_action boolean,
      may_resend_transaction boolean,
      ledger_settlement_authority boolean`;

function createTablesSql(): string {
  return `CREATE TABLE ${SOURCE_AUTHORITY_TABLE} (
      source_authority_id uuid PRIMARY KEY,
      authority_fingerprint_sha256 text NOT NULL UNIQUE,
      authority_version smallint NOT NULL,
      authority_use text NOT NULL,
      network_id text NOT NULL,
      primary_source_family_id text NOT NULL,
      primary_source_id text NOT NULL,
      primary_source_kind text NOT NULL,
      corroborating_source_family_id text NOT NULL,
      corroborating_source_id text NOT NULL,
      corroborating_source_kind text NOT NULL,
      source_pair_approval_id text NOT NULL,
      source_pair_registry_fingerprint_sha256 text NOT NULL,
      approved_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      CONSTRAINT mainnet_action_reconciliation_source_authority_identity_unique
        UNIQUE (source_authority_id, authority_fingerprint_sha256),
      CONSTRAINT mainnet_action_reconciliation_source_authority_uuid_check CHECK (
        pg_catalog.substring(source_authority_id::text, 15, 1) = '4'
        AND pg_catalog.substring(source_authority_id::text, 20, 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT mainnet_action_reconciliation_source_authority_shape_check CHECK (
        authority_version = 1
        AND authority_use = 'MAINNET_FINANCIAL_ACTION_RECONCILIATION_SOURCE_ONLY'
        AND network_id IN ('${ETHEREUM}', '${SOLANA}')
        AND primary_source_family_id ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        AND primary_source_id ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        AND corroborating_source_family_id ~
          '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        AND corroborating_source_id ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        AND primary_source_kind IN ('RPC', 'INDEXER', 'PROVIDER_API')
        AND corroborating_source_kind IN ('RPC', 'INDEXER', 'PROVIDER_API')
        AND source_pair_approval_id ~ '^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$'
        AND primary_source_family_id <> corroborating_source_family_id
        AND primary_source_id <> corroborating_source_id
        AND ROW(primary_source_family_id COLLATE "C", primary_source_id COLLATE "C")
          < ROW(corroborating_source_family_id COLLATE "C",
            corroborating_source_id COLLATE "C")
        AND ${digestValidation('source_pair_registry_fingerprint_sha256')}
        AND NOT may_authorize_financial_action
      ),
      CONSTRAINT mainnet_action_reconciliation_source_authority_time_check CHECK (
        pg_catalog.isfinite(approved_at) AND pg_catalog.isfinite(expires_at)
        AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', approved_at) = approved_at
        AND pg_catalog.date_trunc('milliseconds', expires_at) = expires_at
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND approved_at <= recorded_at AND recorded_at < expires_at
        AND expires_at <= approved_at + interval '90 days'
      ),
      CONSTRAINT mainnet_action_reconciliation_source_authority_fingerprint_check CHECK (
        authority_fingerprint_sha256 = mainnet_action_authenticated_finality_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_SOURCE_AUTHORITY:FRAMED:v1',
          ARRAY[
            'fingerprintEncodingVersion', 'sourceAuthorityId', 'authorityUse', 'networkId',
            'primarySourceFamilyId', 'primarySourceId', 'primarySourceKind',
            'corroboratingSourceFamilyId', 'corroboratingSourceId',
            'corroboratingSourceKind', 'sourcePairApprovalId',
            'sourcePairRegistryFingerprintSha256',
            'approvedAtEpochMilliseconds', 'expiresAtEpochMilliseconds'
          ]::text[],
          ARRAY[
            '1', source_authority_id::text, authority_use, network_id,
            primary_source_family_id, primary_source_id, primary_source_kind,
            corroborating_source_family_id, corroborating_source_id,
            corroborating_source_kind, source_pair_approval_id,
            source_pair_registry_fingerprint_sha256,
            ((pg_catalog.date_part('epoch', approved_at) * 1000)::bigint)::text,
            ((pg_catalog.date_part('epoch', expires_at) * 1000)::bigint)::text
          ]::text[]
        )
      )
    );
    COMMENT ON TABLE ${SOURCE_AUTHORITY_TABLE} IS
      'EMPTY BY DEFAULT. Owner-installed, purpose-bound source authority only; grants no runtime or financial authority.';

    CREATE TABLE ${DEPLOYMENT_AUTHORITY_TABLE} (
      deployment_authority_id uuid PRIMARY KEY,
      authority_fingerprint_sha256 text NOT NULL UNIQUE,
      authority_version smallint NOT NULL,
      authority_use text NOT NULL,
      source_authority_id uuid NOT NULL,
      source_authority_fingerprint_sha256 text NOT NULL,
      network_id text NOT NULL,
      provider_id text NOT NULL,
      protocol_id text NOT NULL,
      market_id text NOT NULL,
      asset_registry_version integer NOT NULL,
      asset_registry_fingerprint_sha256 text NOT NULL,
      asset_symbol text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      action_type text NOT NULL,
      primary_deployment_manifest_fingerprint_sha256 text NOT NULL,
      primary_observed_identity_fingerprint_sha256 text NOT NULL,
      corroborating_deployment_manifest_fingerprint_sha256 text NOT NULL,
      corroborating_observed_identity_fingerprint_sha256 text NOT NULL,
      approved_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      CONSTRAINT mainnet_action_reconciliation_deployment_identity_unique
        UNIQUE (deployment_authority_id, authority_fingerprint_sha256),
      CONSTRAINT mainnet_action_reconciliation_deployment_source_fk FOREIGN KEY (
        source_authority_id, source_authority_fingerprint_sha256
      ) REFERENCES ${SOURCE_AUTHORITY_TABLE} (
        source_authority_id, authority_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_reconciliation_deployment_uuid_check CHECK (
        pg_catalog.substring(deployment_authority_id::text, 15, 1) = '4'
        AND pg_catalog.substring(deployment_authority_id::text, 20, 1)
          IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT mainnet_action_reconciliation_deployment_shape_check CHECK (
        authority_version = 1
        AND authority_use = 'MAINNET_FINANCIAL_ACTION_RECONCILIATION_DEPLOYMENT_ONLY'
        AND network_id IN ('${ETHEREUM}', '${SOLANA}')
        AND provider_id ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        AND protocol_id ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        AND pg_catalog.length(market_id) BETWEEN 1 AND 128
        AND asset_registry_version > 0
        AND ${digestValidation('asset_registry_fingerprint_sha256')}
        AND asset_symbol IN ('USDC', 'USDT', 'PYUSD')
        AND pg_catalog.length(asset_identity) BETWEEN 1 AND 128
        AND asset_decimals = 6
        AND action_type IN ('SUPPLY', 'WITHDRAW')
        AND ${digestValidation('source_authority_fingerprint_sha256')}
        AND ${digestValidation('primary_deployment_manifest_fingerprint_sha256')}
        AND ${digestValidation('primary_observed_identity_fingerprint_sha256')}
        AND ${digestValidation('corroborating_deployment_manifest_fingerprint_sha256')}
        AND ${digestValidation('corroborating_observed_identity_fingerprint_sha256')}
        AND primary_deployment_manifest_fingerprint_sha256 <>
          primary_observed_identity_fingerprint_sha256
        AND primary_deployment_manifest_fingerprint_sha256 <>
          corroborating_deployment_manifest_fingerprint_sha256
        AND primary_deployment_manifest_fingerprint_sha256 <>
          corroborating_observed_identity_fingerprint_sha256
        AND primary_observed_identity_fingerprint_sha256 <>
          corroborating_deployment_manifest_fingerprint_sha256
        AND primary_observed_identity_fingerprint_sha256 <>
          corroborating_observed_identity_fingerprint_sha256
        AND corroborating_deployment_manifest_fingerprint_sha256 <>
          corroborating_observed_identity_fingerprint_sha256
        AND NOT may_authorize_financial_action
      ),
      CONSTRAINT mainnet_action_reconciliation_deployment_time_check CHECK (
        pg_catalog.isfinite(approved_at) AND pg_catalog.isfinite(expires_at)
        AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', approved_at) = approved_at
        AND pg_catalog.date_trunc('milliseconds', expires_at) = expires_at
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND approved_at <= recorded_at AND recorded_at < expires_at
        AND expires_at <= approved_at + interval '90 days'
      ),
      CONSTRAINT mainnet_action_reconciliation_deployment_fingerprint_check CHECK (
        authority_fingerprint_sha256 = mainnet_action_authenticated_finality_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_DEPLOYMENT_AUTHORITY:FRAMED:v1',
          ARRAY[
            'fingerprintEncodingVersion', 'deploymentAuthorityId', 'sourceAuthorityId',
            'sourceAuthorityFingerprintSha256', 'networkId', 'providerId', 'protocolId',
            'marketId', 'assetRegistryVersion', 'assetRegistryFingerprintSha256',
            'assetSymbol', 'assetIdentity', 'assetDecimals', 'actionType',
            'primaryDeploymentManifestFingerprintSha256',
            'primaryObservedIdentityFingerprintSha256',
            'corroboratingDeploymentManifestFingerprintSha256',
            'corroboratingObservedIdentityFingerprintSha256',
            'approvedAtEpochMilliseconds', 'expiresAtEpochMilliseconds'
          ]::text[],
          ARRAY[
            '1', deployment_authority_id::text, source_authority_id::text,
            source_authority_fingerprint_sha256, network_id, provider_id, protocol_id,
            market_id, asset_registry_version::text, asset_registry_fingerprint_sha256,
            asset_symbol, asset_identity, asset_decimals::text, action_type,
            primary_deployment_manifest_fingerprint_sha256,
            primary_observed_identity_fingerprint_sha256,
            corroborating_deployment_manifest_fingerprint_sha256,
            corroborating_observed_identity_fingerprint_sha256,
            ((pg_catalog.date_part('epoch', approved_at) * 1000)::bigint)::text,
            ((pg_catalog.date_part('epoch', expires_at) * 1000)::bigint)::text
          ]::text[]
        )
      )
    );
    COMMENT ON TABLE ${DEPLOYMENT_AUTHORITY_TABLE} IS
      'EMPTY BY DEFAULT. Owner-installed exact source deployment identity gate; grants no runtime or financial authority.';

    CREATE TABLE ${AUTHORITY_CONTROL_TABLE} (
      event_id uuid PRIMARY KEY,
      authority_kind text NOT NULL,
      source_authority_id uuid,
      deployment_authority_id uuid,
      authority_fingerprint_sha256 text NOT NULL,
      control_action text NOT NULL,
      reason_code text NOT NULL,
      active_control boolean NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT mainnet_action_reconciliation_control_source_fk FOREIGN KEY (
        source_authority_id, authority_fingerprint_sha256
      ) REFERENCES ${SOURCE_AUTHORITY_TABLE} (
        source_authority_id, authority_fingerprint_sha256
      )
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_reconciliation_control_deployment_fk FOREIGN KEY (
        deployment_authority_id, authority_fingerprint_sha256
      ) REFERENCES ${DEPLOYMENT_AUTHORITY_TABLE} (
        deployment_authority_id, authority_fingerprint_sha256
      )
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_reconciliation_control_shape_check CHECK (
        pg_catalog.substring(event_id::text, 15, 1) = '4'
        AND pg_catalog.substring(event_id::text, 20, 1) IN ('8', '9', 'a', 'b')
        AND authority_kind IN ('SOURCE', 'DEPLOYMENT')
        AND (source_authority_id IS NULL) = (authority_kind = 'DEPLOYMENT')
        AND (deployment_authority_id IS NULL) = (authority_kind = 'SOURCE')
        AND ${digestValidation('authority_fingerprint_sha256')}
        AND control_action IN ('SUSPENDED', 'REVOKED')
        AND reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
        AND active_control
        AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
      )
    );
    COMMENT ON TABLE ${AUTHORITY_CONTROL_TABLE} IS
      'Append-only owner control stream. Any suspension or revocation permanently disables the exact source or deployment authority fingerprint.';

    CREATE TABLE ${ADMISSION_TABLE} (
      admission_fingerprint_sha256 text PRIMARY KEY,
      observation_id uuid NOT NULL UNIQUE,
      intent_id uuid NOT NULL,
      admitted_event_revision bigint NOT NULL,
      admitted_transition_fingerprint_sha256 text NOT NULL,
      admitted_event_snapshot_sha256 text NOT NULL,
      network_id text NOT NULL,
      chain_transaction_id text NOT NULL,
      reconciliation_outcome text NOT NULL,
      transaction_position numeric(20,0),
      transaction_block_id text,
      finalized_position numeric(20,0) NOT NULL,
      finalized_block_id text NOT NULL,
      chain_anchor_evidence_fingerprint_sha256 text NOT NULL,
      source_authority_id uuid NOT NULL,
      source_authority_fingerprint_sha256 text NOT NULL,
      deployment_authority_id uuid NOT NULL,
      deployment_authority_fingerprint_sha256 text NOT NULL,
      primary_attestation_sha256 text NOT NULL,
      corroborating_attestation_sha256 text NOT NULL,
      transaction_evidence_sha256 text NOT NULL,
      source_evidence_sha256 text NOT NULL,
      effect_evidence_sha256 text,
      failure_evidence_sha256 text,
      observed_at timestamptz NOT NULL,
      deadline_at timestamptz NOT NULL,
      correlation_id uuid NOT NULL,
      may_authorize_financial_action boolean NOT NULL DEFAULT false,
      may_resend_transaction boolean NOT NULL DEFAULT false,
      ledger_settlement_authority boolean NOT NULL DEFAULT false,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT mainnet_action_reconciliation_admission_event_fk FOREIGN KEY (
        intent_id, admitted_event_revision, admitted_transition_fingerprint_sha256
      ) REFERENCES mainnet_financial_action_events (
        intent_id, revision, transition_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT mainnet_action_reconciliation_admission_review_binding_unique UNIQUE (
        admission_fingerprint_sha256, intent_id, admitted_event_revision,
        admitted_transition_fingerprint_sha256
      ),
      CONSTRAINT mainnet_action_reconciliation_admission_chain_evidence_fk FOREIGN KEY (
        chain_anchor_evidence_fingerprint_sha256
      ) REFERENCES provider_position_chain_anchor_evidence (evidence_fingerprint_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_reconciliation_admission_source_authority_fk FOREIGN KEY (
        source_authority_id, source_authority_fingerprint_sha256
      ) REFERENCES ${SOURCE_AUTHORITY_TABLE} (
        source_authority_id, authority_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_reconciliation_admission_deployment_authority_fk FOREIGN KEY (
        deployment_authority_id, deployment_authority_fingerprint_sha256
      ) REFERENCES ${DEPLOYMENT_AUTHORITY_TABLE} (
        deployment_authority_id, authority_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_reconciliation_admission_shape_check CHECK (
        network_id IN ('${ETHEREUM}', '${SOLANA}')
        AND reconciliation_outcome IN (
          'PENDING', 'UNKNOWN', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'
        )
        AND admitted_event_revision >= 3
        AND (transaction_position IS NULL) = (transaction_block_id IS NULL)
        AND finalized_position BETWEEN 0 AND 18446744073709551615
        AND (transaction_position IS NULL
          OR transaction_position BETWEEN 0 AND 18446744073709551615)
        AND NOT may_authorize_financial_action
        AND NOT may_resend_transaction
        AND NOT ledger_settlement_authority
        AND mainnet_action_chain_identity_valid(network_id, chain_transaction_id, 'TRANSACTION')
        AND mainnet_action_chain_identity_valid(network_id, finalized_block_id, 'BLOCK')
        AND (transaction_block_id IS NULL OR
          mainnet_action_chain_identity_valid(network_id, transaction_block_id, 'BLOCK'))
      ),
      CONSTRAINT mainnet_action_reconciliation_admission_digest_check CHECK (
        ${[
          'admission_fingerprint_sha256',
          'admitted_transition_fingerprint_sha256',
          'admitted_event_snapshot_sha256',
          'chain_anchor_evidence_fingerprint_sha256',
          'source_authority_fingerprint_sha256',
          'deployment_authority_fingerprint_sha256',
          'primary_attestation_sha256',
          'corroborating_attestation_sha256',
          'transaction_evidence_sha256',
          'source_evidence_sha256',
        ]
          .map(digestValidation)
          .join('\n        AND ')}
        AND (effect_evidence_sha256 IS NULL OR ${digestValidation('effect_evidence_sha256')})
        AND (failure_evidence_sha256 IS NULL OR ${digestValidation('failure_evidence_sha256')})
        AND primary_attestation_sha256 <> corroborating_attestation_sha256
        AND primary_attestation_sha256 <> transaction_evidence_sha256
        AND corroborating_attestation_sha256 <> transaction_evidence_sha256
      ),
      CONSTRAINT mainnet_action_reconciliation_admission_time_check CHECK (
        pg_catalog.isfinite(observed_at) AND pg_catalog.isfinite(deadline_at)
        AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', observed_at) = observed_at
        AND pg_catalog.date_trunc('milliseconds', deadline_at) = deadline_at
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND observed_at <= recorded_at AND recorded_at < deadline_at
        AND deadline_at <= observed_at + interval '30 seconds'
      )
    );
    COMMENT ON TABLE ${ADMISSION_TABLE} IS
      'Append-only authenticated-evidence admission linked atomically to one migration-0033 reconciliation event; never grants settlement or resend authority.';

    CREATE TABLE ${REVIEW_TABLE} (
      review_fingerprint_sha256 text PRIMARY KEY,
      review_id uuid NOT NULL UNIQUE,
      intent_id uuid NOT NULL,
      review_revision bigint NOT NULL,
      previous_review_fingerprint_sha256 text,
      terminal_event_revision bigint NOT NULL,
      terminal_transition_fingerprint_sha256 text NOT NULL,
      terminal_snapshot_sha256 text NOT NULL,
      original_admission_fingerprint_sha256 text NOT NULL,
      disposition text NOT NULL,
      lineage_status text NOT NULL,
      network_id text NOT NULL,
      chain_transaction_id text NOT NULL,
      transaction_position numeric(20,0) NOT NULL,
      transaction_block_id text NOT NULL,
      finalized_position numeric(20,0) NOT NULL,
      finalized_block_id text NOT NULL,
      chain_anchor_evidence_fingerprint_sha256 text NOT NULL,
      source_authority_id uuid NOT NULL,
      source_authority_fingerprint_sha256 text NOT NULL,
      deployment_authority_id uuid NOT NULL,
      deployment_authority_fingerprint_sha256 text NOT NULL,
      primary_attestation_sha256 text NOT NULL,
      corroborating_attestation_sha256 text NOT NULL,
      transaction_evidence_sha256 text NOT NULL,
      observed_at timestamptz NOT NULL,
      deadline_at timestamptz NOT NULL,
      correlation_id uuid NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      may_resend_transaction boolean NOT NULL,
      ledger_settlement_authority boolean NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT mainnet_action_post_finality_review_revision_unique
        UNIQUE (intent_id, review_revision),
      CONSTRAINT mainnet_action_post_finality_review_previous_fk FOREIGN KEY (
        previous_review_fingerprint_sha256
      ) REFERENCES ${REVIEW_TABLE} (review_fingerprint_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_post_finality_review_terminal_fk FOREIGN KEY (
        intent_id, terminal_event_revision, terminal_transition_fingerprint_sha256
      ) REFERENCES mainnet_financial_action_events (
        intent_id, revision, transition_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_post_finality_review_admission_fk FOREIGN KEY (
        original_admission_fingerprint_sha256, intent_id, terminal_event_revision,
        terminal_transition_fingerprint_sha256
      ) REFERENCES ${ADMISSION_TABLE} (
        admission_fingerprint_sha256, intent_id, admitted_event_revision,
        admitted_transition_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_post_finality_review_chain_evidence_fk FOREIGN KEY (
        chain_anchor_evidence_fingerprint_sha256
      ) REFERENCES provider_position_chain_anchor_evidence (evidence_fingerprint_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_post_finality_review_source_authority_fk FOREIGN KEY (
        source_authority_id, source_authority_fingerprint_sha256
      ) REFERENCES ${SOURCE_AUTHORITY_TABLE} (
        source_authority_id, authority_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_post_finality_review_deployment_authority_fk FOREIGN KEY (
        deployment_authority_id, deployment_authority_fingerprint_sha256
      ) REFERENCES ${DEPLOYMENT_AUTHORITY_TABLE} (
        deployment_authority_id, authority_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_post_finality_review_shape_check CHECK (
        review_revision > 0
        AND (previous_review_fingerprint_sha256 IS NULL) = (review_revision = 1)
        AND terminal_event_revision >= 3
        AND disposition IN (
          'FINALITY_REAFFIRMED', 'REVIEW_INCONCLUSIVE', 'DEEP_REORG_QUARANTINED'
        )
        AND lineage_status IN ('CANONICAL', 'UNKNOWN', 'CONFLICT')
        AND ((disposition = 'FINALITY_REAFFIRMED' AND lineage_status = 'CANONICAL')
          OR (disposition = 'REVIEW_INCONCLUSIVE' AND lineage_status = 'UNKNOWN')
          OR (disposition = 'DEEP_REORG_QUARANTINED' AND lineage_status = 'CONFLICT'))
        AND network_id IN ('${ETHEREUM}', '${SOLANA}')
        AND transaction_position BETWEEN 0 AND 18446744073709551615
        AND finalized_position BETWEEN 0 AND 18446744073709551615
        AND NOT may_authorize_financial_action
        AND NOT may_resend_transaction
        AND NOT ledger_settlement_authority
        AND mainnet_action_chain_identity_valid(network_id, chain_transaction_id, 'TRANSACTION')
        AND mainnet_action_chain_identity_valid(network_id, transaction_block_id, 'BLOCK')
        AND mainnet_action_chain_identity_valid(network_id, finalized_block_id, 'BLOCK')
      ),
      CONSTRAINT mainnet_action_post_finality_review_digest_check CHECK (
        ${[
          'review_fingerprint_sha256',
          'terminal_transition_fingerprint_sha256',
          'terminal_snapshot_sha256',
          'original_admission_fingerprint_sha256',
          'chain_anchor_evidence_fingerprint_sha256',
          'source_authority_fingerprint_sha256',
          'deployment_authority_fingerprint_sha256',
          'primary_attestation_sha256',
          'corroborating_attestation_sha256',
          'transaction_evidence_sha256',
        ]
          .map(digestValidation)
          .join('\n        AND ')}
        AND (previous_review_fingerprint_sha256 IS NULL OR
          ${digestValidation('previous_review_fingerprint_sha256')})
        AND primary_attestation_sha256 <> corroborating_attestation_sha256
        AND primary_attestation_sha256 <> transaction_evidence_sha256
        AND corroborating_attestation_sha256 <> transaction_evidence_sha256
      ),
      CONSTRAINT mainnet_action_post_finality_review_time_check CHECK (
        pg_catalog.isfinite(observed_at) AND pg_catalog.isfinite(deadline_at)
        AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', observed_at) = observed_at
        AND pg_catalog.date_trunc('milliseconds', deadline_at) = deadline_at
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND observed_at <= recorded_at AND recorded_at < deadline_at
        AND deadline_at <= observed_at + interval '30 seconds'
      )
    );
    COMMENT ON TABLE ${REVIEW_TABLE} IS
      'Append-only post-terminal safety overlay. Deep-reorg quarantine is permanent and never rewrites migration-0033 or authorizes ledger reversal.';

    CREATE INDEX mainnet_action_reconciliation_admission_intent_revision_idx
      ON ${ADMISSION_TABLE} (intent_id, admitted_event_revision DESC);
    CREATE INDEX mainnet_action_authority_control_source_active_idx
      ON ${AUTHORITY_CONTROL_TABLE} (
        source_authority_id, authority_fingerprint_sha256, recorded_at DESC, event_id
      ) WHERE active_control AND authority_kind = 'SOURCE';
    CREATE INDEX mainnet_action_authority_control_deployment_active_idx
      ON ${AUTHORITY_CONTROL_TABLE} (
        deployment_authority_id, authority_fingerprint_sha256, recorded_at DESC, event_id
      ) WHERE active_control AND authority_kind = 'DEPLOYMENT';
    CREATE INDEX mainnet_action_post_finality_review_latest_idx
      ON ${REVIEW_TABLE} (intent_id, review_revision DESC);
    CREATE INDEX mainnet_action_post_finality_review_quarantine_idx
      ON ${REVIEW_TABLE} (intent_id, review_revision DESC)
      WHERE disposition = 'DEEP_REORG_QUARANTINED';`;
}

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  const functions = [
    FINALITY_FINGERPRINT_BYTES,
    FINALITY_FINGERPRINT,
    HISTORY_GUARD,
    ADMISSION_GUARD,
    CONTROL_AUTHORITY_IDENTITY,
    RECORD_ADMISSION_IDENTITY,
    RECORD_REVIEW_IDENTITY,
    READ_EFFECTIVE_IDENTITY,
  ];
  const tables = [
    SOURCE_AUTHORITY_TABLE,
    DEPLOYMENT_AUTHORITY_TABLE,
    AUTHORITY_CONTROL_TABLE,
    ADMISSION_TABLE,
    REVIEW_TABLE,
  ];
  const appendOnlyTriggers = [
    [SOURCE_AUTHORITY_TABLE, 'mainnet_action_source_authority_append'],
    [DEPLOYMENT_AUTHORITY_TABLE, 'mainnet_action_deployment_authority_append'],
    [AUTHORITY_CONTROL_TABLE, 'mainnet_action_authority_control_append'],
    [ADMISSION_TABLE, 'mainnet_action_admission_append'],
    [REVIEW_TABLE, 'mainnet_action_post_finality_append'],
  ] as const;

  return `LOCK TABLE mainnet_financial_action_events IN ACCESS EXCLUSIVE MODE;
    DO $refuse_unadmitted_reconciliation_history$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM mainnet_financial_action_events
        WHERE reconciliation_outcome IS NOT NULL
      ) THEN
        RAISE EXCEPTION
          'authenticated finality requires empty mainnet action reconciliation history'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_unadmitted_reconciliation_history$;

    CREATE FUNCTION mainnet_action_authenticated_finality_fingerprint_bytes_v1(
      requested_domain text, requested_field_names text[], requested_field_values text[]
    ) RETURNS bytea
    LANGUAGE plpgsql SECURITY DEFINER IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${FINALITY_FINGERPRINT_BYTES_BODY}$function$;
    CREATE FUNCTION mainnet_action_authenticated_finality_fingerprint_v1(
      requested_domain text, requested_field_names text[], requested_field_values text[]
    ) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${FINALITY_FINGERPRINT_BODY}$function$;

    ${createTablesSql()}

    CREATE FUNCTION ${HISTORY_GUARD}
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${HISTORY_GUARD_BODY}$function$;
    CREATE FUNCTION ${ADMISSION_GUARD}
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${ADMISSION_GUARD_BODY}$function$;

    ${appendOnlyTriggers
      .map(
        ([table, trigger]) => `CREATE TRIGGER ${trigger}_row
      BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER ${trigger}_truncate
      BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${trigger}_row;
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${trigger}_truncate;`,
      )
      .join('\n    ')}

    CREATE CONSTRAINT TRIGGER mainnet_action_reconciliation_requires_authenticated_admission
      AFTER INSERT ON mainnet_financial_action_events
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ${ADMISSION_GUARD};
    ALTER TABLE mainnet_financial_action_events ENABLE ALWAYS TRIGGER
      mainnet_action_reconciliation_requires_authenticated_admission;

    CREATE FUNCTION control_mainnet_financial_action_reconciliation_authority_v1(
      ${CONTROL_AUTHORITY_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${CONTROL_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${CONTROL_AUTHORITY_BODY}$function$;

    CREATE FUNCTION record_authenticated_mainnet_financial_action_reconciliation_v1(
      ${RECORD_ADMISSION_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${ADMISSION_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${RECORD_ADMISSION_BODY}$function$;

    CREATE FUNCTION record_mainnet_financial_action_post_finality_review_v1(
      ${RECORD_REVIEW_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${REVIEW_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${RECORD_REVIEW_BODY}$function$;

    CREATE FUNCTION read_mainnet_financial_action_effective_safety_state_v1(
      requested_account_id uuid, requested_intent_id uuid
    ) RETURNS TABLE (${READ_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER STABLE STRICT PARALLEL UNSAFE
    AS $function$${READ_EFFECTIVE_BODY}$function$;

    DO $set_authenticated_finality_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${functions
        .map(
          (fn) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${fn} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );`,
        )
        .join('\n      ')}
    END;
    $set_authenticated_finality_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${tables.join(', ')} FROM ${guarded};
    REVOKE ALL PRIVILEGES ON TYPE ${tables.join(', ')} FROM ${guarded};
    ${functions.map((fn) => `REVOKE ALL ON FUNCTION ${fn} FROM ${guarded};`).join('\n    ')}`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  const tables = [
    SOURCE_AUTHORITY_TABLE,
    DEPLOYMENT_AUTHORITY_TABLE,
    AUTHORITY_CONTROL_TABLE,
    ADMISSION_TABLE,
    REVIEW_TABLE,
  ];
  const functions = [
    CONTROL_AUTHORITY_IDENTITY,
    RECORD_ADMISSION_IDENTITY,
    RECORD_REVIEW_IDENTITY,
    READ_EFFECTIVE_IDENTITY,
  ];
  const fingerprintFunctions = [FINALITY_FINGERPRINT, FINALITY_FINGERPRINT_BYTES];

  return `LOCK TABLE mainnet_financial_action_events, ${tables.join(', ')}
      IN ACCESS EXCLUSIVE MODE;
    DO $refuse_authenticated_finality_history_loss$
    BEGIN
      IF ${tables.map((table) => `EXISTS (SELECT 1 FROM ${table})`).join('\n        OR ')}
      THEN
        RAISE EXCEPTION 'cannot roll back authenticated mainnet action finality after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_authenticated_finality_history_loss$;

    ${functions.map((fn) => `REVOKE ALL ON FUNCTION ${fn} FROM ${guarded};`).join('\n    ')}
    ${fingerprintFunctions
      .map((fn) => `REVOKE ALL ON FUNCTION ${fn} FROM ${guarded};`)
      .join('\n    ')}
    REVOKE ALL ON FUNCTION ${ADMISSION_GUARD} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${HISTORY_GUARD} FROM ${guarded};
    DROP TRIGGER mainnet_action_reconciliation_requires_authenticated_admission
      ON mainnet_financial_action_events;
    DROP FUNCTION ${functions.join(';\n    DROP FUNCTION ')};
    DROP FUNCTION ${ADMISSION_GUARD};
    DROP TABLE ${REVIEW_TABLE}, ${ADMISSION_TABLE}, ${AUTHORITY_CONTROL_TABLE},
      ${DEPLOYMENT_AUTHORITY_TABLE}, ${SOURCE_AUTHORITY_TABLE};
    DROP FUNCTION ${fingerprintFunctions.join(';\n    DROP FUNCTION ')};
    DROP FUNCTION ${HISTORY_GUARD};`;
}

function canonicalResult(value: string): string {
  return `TABLE(${value
    .replace(/\btimestamptz\b/gu, 'timestamp with time zone')
    .replace(/\s+/gu, ' ')
    .trim()})`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetFinancialActionWalletIdentityBindingMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0034 must expose verification SQL');
  let prior = replaceExactlyOnce(
    previous.verifySql,
    `        ('mainnet_financial_action_evidence_claims', 'mainnet_financial_action_evidence_claims_append_only_truncate', 'reject_mainnet_action_history_mutation()', 34, false, false)
      )
      SELECT pg_catalog.count(*) = 10 AND pg_catalog.count(trigger_record.oid) = 10`,
    `        ('mainnet_financial_action_evidence_claims', 'mainnet_financial_action_evidence_claims_append_only_truncate', 'reject_mainnet_action_history_mutation()', 34, false, false),
        ('mainnet_financial_action_events', 'mainnet_action_reconciliation_requires_authenticated_admission', '${ADMISSION_GUARD}', 5, true, true)
      )
      SELECT pg_catalog.count(*) = 11 AND pg_catalog.count(trigger_record.oid) = 11`,
  );
  prior = replaceExactlyOnce(
    prior,
    `          SELECT pg_catalog.count(*) = 10
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid IN (
            pg_catalog.to_regclass('mainnet_financial_action_intents'),
            pg_catalog.to_regclass('mainnet_financial_action_events'),
            pg_catalog.to_regclass('mainnet_financial_action_evidence_claims')`,
    `          SELECT pg_catalog.count(*) = 11
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid IN (
            pg_catalog.to_regclass('mainnet_financial_action_intents'),
            pg_catalog.to_regclass('mainnet_financial_action_events'),
            pg_catalog.to_regclass('mainnet_financial_action_evidence_claims')`,
  );
  prior = replaceExactlyOnce(
    prior,
    `      )
      SELECT pg_catalog.count(*) = 35
        AND pg_catalog.count(constraint_record.oid) = 35`,
    `        , (
            'mainnet_financial_action_events',
            'mainnet_action_reconciliation_requires_authenticated_admission',
            't', NULL::smallint[], NULL::text, NULL::smallint[], NULL::text,
            'a5fc893149b88e6e958294fc1a4a285cbad41292c73d26f5f91873f312e3e311'
          )
      )
      SELECT pg_catalog.count(*) = 36
        AND pg_catalog.count(constraint_record.oid) = 36`,
  );
  prior = replaceExactlyOnce(
    prior,
    `          SELECT pg_catalog.count(*) = 35
          FROM pg_catalog.pg_constraint AS all_constraint`,
    `          SELECT pg_catalog.count(*) = 36
          FROM pg_catalog.pg_constraint AS all_constraint`,
  );
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const guardedRolePredicates = (identityExpression: string): string =>
    [api, worker, legacy, balance, migration, "'public'"]
      .map(
        (role) =>
          `NOT pg_catalog.has_function_privilege(${role}, ${identityExpression}, 'EXECUTE')`,
      )
      .join('\n            AND ');
  const functionExpectations = [
    {
      identity: FINALITY_FINGERPRINT_BYTES,
      body: FINALITY_FINGERPRINT_BYTES_BODY,
      result: 'bytea',
      arguments: [
        ['requested_domain', 'text'],
        ['requested_field_names', 'text[]'],
        ['requested_field_values', 'text[]'],
      ] as const,
      volatility: 'i',
      parallel: 's',
      strict: true,
      set: false,
    },
    {
      identity: FINALITY_FINGERPRINT,
      body: FINALITY_FINGERPRINT_BODY,
      result: 'text',
      arguments: [
        ['requested_domain', 'text'],
        ['requested_field_names', 'text[]'],
        ['requested_field_values', 'text[]'],
      ] as const,
      volatility: 'i',
      parallel: 's',
      strict: true,
      set: false,
    },
    {
      identity: HISTORY_GUARD,
      body: HISTORY_GUARD_BODY,
      result: 'trigger',
      arguments: [] as readonly (readonly [string, string])[],
      volatility: 'v',
      parallel: 'u',
      strict: false,
      set: false,
    },
    {
      identity: ADMISSION_GUARD,
      body: ADMISSION_GUARD_BODY,
      result: 'trigger',
      arguments: [] as readonly (readonly [string, string])[],
      volatility: 'v',
      parallel: 'u',
      strict: false,
      set: false,
    },
    {
      identity: CONTROL_AUTHORITY_IDENTITY,
      body: CONTROL_AUTHORITY_BODY,
      result: canonicalResult(CONTROL_RESULT),
      arguments: CONTROL_AUTHORITY_ARGUMENTS,
      volatility: 'v',
      parallel: 'u',
      strict: false,
      set: true,
    },
    {
      identity: RECORD_ADMISSION_IDENTITY,
      body: RECORD_ADMISSION_BODY,
      result: canonicalResult(ADMISSION_RESULT),
      arguments: RECORD_ADMISSION_ARGUMENTS,
      volatility: 'v',
      parallel: 'u',
      strict: false,
      set: true,
    },
    {
      identity: RECORD_REVIEW_IDENTITY,
      body: RECORD_REVIEW_BODY,
      result: canonicalResult(REVIEW_RESULT),
      arguments: RECORD_REVIEW_ARGUMENTS,
      volatility: 'v',
      parallel: 'u',
      strict: false,
      set: true,
    },
    {
      identity: READ_EFFECTIVE_IDENTITY,
      body: READ_EFFECTIVE_BODY,
      result: canonicalResult(READ_RESULT),
      arguments: [
        ['requested_account_id', 'uuid'],
        ['requested_intent_id', 'uuid'],
      ] as const,
      volatility: 's',
      parallel: 'u',
      strict: true,
      set: true,
    },
  ];
  const functionValues = functionExpectations
    .map(({ identity: fn, body, result, arguments: args, volatility, parallel, strict, set }) => {
      const inputNames = args.map(([name]) => `'${name}'`).join(', ');
      return `('${fn}', '${sourceSha256(body)}', '${result}', '${volatility}', '${parallel}', ${strict}, ${set},
        ARRAY[${inputNames}]::text[])`;
    })
    .join(',\n        ');

  return `SELECT (
      prior.valid
      AND relation_state.valid
      AND column_state.valid
      AND constraint_state.valid
      AND function_state.valid
      AND trigger_state.valid
      AND index_state.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      WITH expected(table_name, manifest) AS (VALUES
        ('${SOURCE_AUTHORITY_TABLE}',
          'EMPTY BY DEFAULT. Owner-installed, purpose-bound source authority only; grants no runtime or financial authority.'),
        ('${DEPLOYMENT_AUTHORITY_TABLE}',
          'EMPTY BY DEFAULT. Owner-installed exact source deployment identity gate; grants no runtime or financial authority.'),
        ('${AUTHORITY_CONTROL_TABLE}',
          'Append-only owner control stream. Any suspension or revocation permanently disables the exact source or deployment authority fingerprint.'),
        ('${ADMISSION_TABLE}',
          'Append-only authenticated-evidence admission linked atomically to one migration-0033 reconciliation event; never grants settlement or resend authority.'),
        ('${REVIEW_TABLE}',
          'Append-only post-terminal safety overlay. Deep-reorg quarantine is permanent and never rewrites migration-0033 or authorizes ledger reversal.')
      )
      SELECT pg_catalog.count(*) = 5 AND pg_catalog.count(relation.oid) = 5
        AND pg_catalog.bool_and(
          relation.relkind = 'r'
          AND relation.relpersistence = 'p'
          AND relation.relreplident = 'd'
          AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity
          AND NOT relation.relispartition AND relation.relpartbound IS NULL
          AND relation_owner.rolname = ${cumulative ? owner : 'relation_owner.rolname'}
          AND (
            SELECT row_type.typtype = 'c' AND row_type.typrelid = relation.oid
              AND row_type_owner.oid = relation.relowner
            FROM pg_catalog.pg_type AS row_type
            INNER JOIN pg_catalog.pg_roles AS row_type_owner
              ON row_type_owner.oid = row_type.typowner
            WHERE row_type.oid = relation.reltype
          )
          AND pg_catalog.obj_description(relation.oid, 'pg_class') = expected.manifest
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policy AS policy
            WHERE policy.polrelid = relation.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite
            WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
            ) AS acl
            WHERE acl.grantee <> relation.relowner
          )
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.relname = expected.table_name
        AND relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
      LEFT JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
    ) AS relation_state
    CROSS JOIN (
      WITH target AS (
        SELECT relation.oid, relation.relname
        FROM pg_catalog.pg_class AS relation
        WHERE relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
          AND relation.relname IN (
            '${SOURCE_AUTHORITY_TABLE}', '${DEPLOYMENT_AUTHORITY_TABLE}',
            '${AUTHORITY_CONTROL_TABLE}', '${ADMISSION_TABLE}', '${REVIEW_TABLE}'
          )
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            target.relname, attribute.attnum, attribute.attname,
            pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            attribute.attnotnull, attribute.attidentity, attribute.attgenerated,
            attribute.atthasmissing,
            CASE WHEN attribute.attcollation = 0 THEN '-'
              ELSE collation_namespace.nspname || '.' || column_collation.collname END,
            COALESCE(pg_catalog.regexp_replace(
              pg_catalog.pg_get_expr(
                attribute_default.adbin, attribute_default.adrelid, false
              ), '[[:space:]]+', '', 'g'
            ), '-')
          ), E'\\n' ORDER BY target.relname, attribute.attnum) AS catalog_state
        FROM target
        INNER JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = target.oid
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
        LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
          ON attribute_default.adrelid = attribute.attrelid
          AND attribute_default.adnum = attribute.attnum
        LEFT JOIN pg_catalog.pg_collation AS column_collation
          ON column_collation.oid = attribute.attcollation
        LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
          ON collation_namespace.oid = column_collation.collnamespace
      )
      SELECT row_count = 113 AND COALESCE(
        pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(catalog_state, 'UTF8')
        ), 'hex') = 'a045efae0d83cb59b584bd95c7bd15f4d35ca2f013caa35f8a8475c654d165a6',
        false
      ) AS valid
      FROM canonical
    ) AS column_state
    CROSS JOIN (
      WITH target AS (
        SELECT relation.oid, relation.relname
        FROM pg_catalog.pg_class AS relation
        WHERE relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
          AND relation.relname IN (
            '${SOURCE_AUTHORITY_TABLE}', '${DEPLOYMENT_AUTHORITY_TABLE}',
            '${AUTHORITY_CONTROL_TABLE}', '${ADMISSION_TABLE}', '${REVIEW_TABLE}'
          )
      ), catalog_rows AS (
        SELECT target.relname, constraint_record.*,
          foreign_relation.relname AS foreign_relname,
          foreign_namespace.nspname AS foreign_nspname,
          backing_index.relname AS backing_name,
          backing_namespace.nspname AS backing_nspname
        FROM target
        INNER JOIN pg_catalog.pg_constraint AS constraint_record
          ON constraint_record.conrelid = target.oid
        LEFT JOIN pg_catalog.pg_class AS foreign_relation
          ON foreign_relation.oid = constraint_record.confrelid
        LEFT JOIN pg_catalog.pg_namespace AS foreign_namespace
          ON foreign_namespace.oid = foreign_relation.relnamespace
        LEFT JOIN pg_catalog.pg_class AS backing_index
          ON backing_index.oid = constraint_record.conindid
        LEFT JOIN pg_catalog.pg_namespace AS backing_namespace
          ON backing_namespace.oid = backing_index.relnamespace
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            relname, conname, contype, convalidated, conislocal, coninhcount,
            connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema()),
            contypid, conparentid, connoinherit, COALESCE(conkey::text, '-'),
            COALESCE(foreign_relname, '-'),
            COALESCE((foreign_nspname = pg_catalog.current_schema())::text, '-'),
            COALESCE(confkey::text, '-'), COALESCE(backing_name, '-'),
            COALESCE((backing_nspname = pg_catalog.current_schema())::text, '-'),
            condeferrable, condeferred, confupdtype, confdeltype, confmatchtype,
            COALESCE(confdelsetcols::text, '-'), COALESCE(conpfeqop::text, '-'),
            COALESCE(conppeqop::text, '-'), COALESCE(conffeqop::text, '-'),
            conbin IS NOT NULL,
            COALESCE(pg_catalog.regexp_replace(
              pg_catalog.pg_get_constraintdef(oid, false), '[[:space:]]+', '', 'g'
            ), '-')
          ), E'\\n' ORDER BY relname, conname) AS catalog_state
        FROM catalog_rows
      )
      SELECT row_count = 41 AND COALESCE(
        pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(catalog_state, 'UTF8')
        ), 'hex') = 'd1d7e45ceaf3048927988ec677015cf99e0792b3db42e8a25bca25a6858a059d',
        false
      ) AS valid
      FROM canonical
    ) AS constraint_state
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 8
        AND pg_catalog.count(procedure.oid) = 8
        AND pg_catalog.bool_and(
          procedure.prokind = 'f'
          AND NOT procedure.proleakproof
          AND procedure.prosecdef
          AND procedure.proisstrict = expected.is_strict
          AND procedure.provolatile = expected.volatility::"char"
          AND procedure.proparallel = expected.parallel_safety::"char"
          AND procedure.proretset = expected.returns_set
          AND procedure.pronargs = pg_catalog.cardinality(expected.input_names)
          AND procedure.pronargdefaults = 0
          AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND COALESCE(procedure.proargnames[1:procedure.pronargs], ARRAY[]::text[])
            = expected.input_names
          AND language.lanname = 'plpgsql'
          AND pg_catalog.pg_get_function_result(procedure.oid) = expected.expected_result
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = expected.body_sha256
          AND function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND ${guardedRolePredicates('expected.function_identity')}
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
            ) AS acl
            WHERE acl.grantee <> procedure.proowner
          )
        ) AS valid
      FROM (VALUES
        ${functionValues}
      ) AS expected(
        function_identity, body_sha256, expected_result, volatility, parallel_safety,
        is_strict, returns_set, input_names
      )
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
        ('${SOURCE_AUTHORITY_TABLE}', 'mainnet_action_source_authority_append_row',
          '${HISTORY_GUARD}', 27, false, false),
        ('${SOURCE_AUTHORITY_TABLE}', 'mainnet_action_source_authority_append_truncate',
          '${HISTORY_GUARD}', 34, false, false),
        ('${DEPLOYMENT_AUTHORITY_TABLE}', 'mainnet_action_deployment_authority_append_row',
          '${HISTORY_GUARD}', 27, false, false),
        ('${DEPLOYMENT_AUTHORITY_TABLE}',
          'mainnet_action_deployment_authority_append_truncate',
          '${HISTORY_GUARD}', 34, false, false),
        ('${AUTHORITY_CONTROL_TABLE}', 'mainnet_action_authority_control_append_row',
          '${HISTORY_GUARD}', 27, false, false),
        ('${AUTHORITY_CONTROL_TABLE}', 'mainnet_action_authority_control_append_truncate',
          '${HISTORY_GUARD}', 34, false, false),
        ('${ADMISSION_TABLE}', 'mainnet_action_admission_append_row',
          '${HISTORY_GUARD}', 27, false, false),
        ('${ADMISSION_TABLE}', 'mainnet_action_admission_append_truncate',
          '${HISTORY_GUARD}', 34, false, false),
        ('${REVIEW_TABLE}', 'mainnet_action_post_finality_append_row',
          '${HISTORY_GUARD}', 27, false, false),
        ('${REVIEW_TABLE}', 'mainnet_action_post_finality_append_truncate',
          '${HISTORY_GUARD}', 34, false, false),
        ('mainnet_financial_action_events',
          'mainnet_action_reconciliation_requires_authenticated_admission',
          '${ADMISSION_GUARD}', 5, true, true)
      )
      SELECT pg_catalog.count(*) = 11
        AND pg_catalog.count(trigger.oid) = 11
        AND pg_catalog.bool_and(
          NOT trigger.tgisinternal AND trigger.tgenabled = 'A'
          AND trigger.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
          AND trigger.tgtype = expected.trigger_type
          AND trigger.tgnargs = 0 AND trigger.tgparentid = 0
          AND trigger.tgdeferrable = expected.expected_deferrable
          AND trigger.tginitdeferred = expected.expected_deferred
          AND trigger.tgoldtable IS NULL AND trigger.tgnewtable IS NULL
        ) AND (
          SELECT pg_catalog.count(*) = 10
          FROM pg_catalog.pg_trigger AS target_trigger
          WHERE target_trigger.tgrelid IN (
            pg_catalog.to_regclass('${SOURCE_AUTHORITY_TABLE}'),
            pg_catalog.to_regclass('${DEPLOYMENT_AUTHORITY_TABLE}'),
            pg_catalog.to_regclass('${AUTHORITY_CONTROL_TABLE}'),
            pg_catalog.to_regclass('${ADMISSION_TABLE}'),
            pg_catalog.to_regclass('${REVIEW_TABLE}')
          ) AND NOT target_trigger.tgisinternal
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgrelid = pg_catalog.to_regclass(expected.table_name)
        AND trigger.tgname = expected.trigger_name
    ) AS trigger_state
    CROSS JOIN (
      WITH target AS (
        SELECT relation.oid, relation.relname, relation.relowner
        FROM pg_catalog.pg_class AS relation
        WHERE relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
          AND relation.relname IN (
            '${SOURCE_AUTHORITY_TABLE}', '${DEPLOYMENT_AUTHORITY_TABLE}',
            '${AUTHORITY_CONTROL_TABLE}', '${ADMISSION_TABLE}', '${REVIEW_TABLE}'
          )
      ), catalog_rows AS (
        SELECT target.relname AS table_name, target.relowner AS table_owner,
          index_record.*, index_relation.relname AS index_name,
          index_relation.relkind, index_relation.relpersistence,
          index_relation.relispartition, index_relation.relowner AS index_owner,
          access_method.amname
        FROM target
        INNER JOIN pg_catalog.pg_index AS index_record
          ON index_record.indrelid = target.oid
        INNER JOIN pg_catalog.pg_class AS index_relation
          ON index_relation.oid = index_record.indexrelid
        INNER JOIN pg_catalog.pg_am AS access_method
          ON access_method.oid = index_relation.relam
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            table_name, index_name, relkind, relpersistence, relispartition,
            index_owner = table_owner, indisvalid, indisready, indislive,
            indisunique, indisprimary, indisexclusion, indimmediate,
            indnullsnotdistinct, indisclustered, indcheckxmin, indisreplident,
            amname, indkey::text, indoption::text, indclass::text,
            indcollation::text, indnkeyatts, indnatts,
            pg_catalog.regexp_replace(
              pg_catalog.replace(
                pg_catalog.pg_get_indexdef(indexrelid, 0, false),
                pg_catalog.quote_ident(pg_catalog.current_schema()) || '.', ''
              ),
              '[[:space:]]+', '', 'g'
            )
          ), E'\\n' ORDER BY table_name, index_name) AS catalog_state
        FROM catalog_rows
      )
      SELECT row_count = 18 AND COALESCE(
        pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(catalog_state, 'UTF8')
        ), 'hex') = '52ee845680b5fe24bd135fa829040efeec62de5ebc2e2ae243b09e0eaa8a8216',
        false
      ) AS valid
      FROM canonical
    ) AS index_state`;
}

export function createMainnetFinancialActionAuthenticatedFinalityMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0035',
    description:
      'add dormant authenticated mainnet action reconciliation and post-finality safety overlay',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0034'],
  };
}

export const createMainnetFinancialActionAuthenticatedFinalityMigrationV0035 =
  createMainnetFinancialActionAuthenticatedFinalityMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
  );

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035 =
  createMainnetFinancialActionAuthenticatedFinalityMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
    { cumulativePrincipalVerification: false },
  );
