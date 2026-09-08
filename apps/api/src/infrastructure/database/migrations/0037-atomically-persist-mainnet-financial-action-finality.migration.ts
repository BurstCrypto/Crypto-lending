import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionFinalityPrerequisiteReadMigration } from './0036-read-mainnet-financial-action-finality-prerequisite.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MAINNET_WALLET_AND_ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

const SOURCE_AUTHORITY_TABLE = 'mainnet_financial_action_reconciliation_source_authorities';
const DEPLOYMENT_AUTHORITY_TABLE = 'mainnet_financial_action_reconciliation_deployment_authorities';

const RECORD_ADMISSION_V1 = 'record_authenticated_mainnet_financial_action_reconciliation_v1';
const RECORD_ADMISSION_V2 = 'record_authenticated_mainnet_financial_action_reconciliation_v2';
const RECORD_REVIEW_V1 = 'record_mainnet_financial_action_post_finality_review_v1';
const RECORD_REVIEW_V2 = 'record_mainnet_financial_action_post_finality_review_v2';

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

const RECORD_ADMISSION_V2_IDENTITY = `${RECORD_ADMISSION_V2}(${RECORD_ADMISSION_ARGUMENTS.map(([, type]) => type).join(',')})`;
const RECORD_REVIEW_V2_IDENTITY = `${RECORD_REVIEW_V2}(${RECORD_REVIEW_ARGUMENTS.map(([, type]) => type).join(',')})`;

const ADMISSION_CALL_ARGUMENTS = RECORD_ADMISSION_ARGUMENTS.map(([name]) => name).join(
  ',\n        ',
);
const REVIEW_CALL_ARGUMENTS = RECORD_REVIEW_ARGUMENTS.map(([name]) => name).join(',\n        ');

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

function canonicalResult(value: string): string {
  return `TABLE(${value
    .replace(/\btimestamptz\b/gu, 'timestamp with time zone')
    .replace(/\s+/gu, ' ')
    .trim()})`;
}

const ADVISORY_SERIALIZATION = `
      intent_lock_key := pg_catalog.hashtextextended(requested_intent_id::text, 56037);
      operation_lock_key := pg_catalog.hashtextextended(operation_id::text, 56038);
      -- Operation-ID serialization makes the following existence test stable;
      -- per-intent serialization then excludes every other v2 writer/CAS.
      PERFORM pg_catalog.pg_advisory_xact_lock(operation_lock_key);
      PERFORM pg_catalog.pg_advisory_xact_lock(intent_lock_key);`;

const LOCK_AUTHORITY_CANDIDATES = `
      -- SHARE prevents a new source/deployment candidate from appearing after
      -- migration 0036 has proved that the live candidate pair is unique.
      LOCK TABLE ${SOURCE_AUTHORITY_TABLE}, ${DEPLOYMENT_AUTHORITY_TABLE}
        IN SHARE MODE;`;

const ORDERED_ROW_LOCKS = `
      FOREACH target_key IN ARRAY evidence_targets LOOP
        PERFORM 1
        FROM provider_position_chain_anchor_evidence AS evidence
        WHERE evidence.evidence_fingerprint_sha256 = target_key
        FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'mainnet finality evidence target is unavailable'
            USING ERRCODE = '55000';
        END IF;
      END LOOP;

      FOREACH target_key IN ARRAY source_targets LOOP
        PERFORM 1
        FROM ${SOURCE_AUTHORITY_TABLE} AS source
        WHERE source.source_authority_id =
            pg_catalog.split_part(target_key, '|', 1)::uuid
          AND source.authority_fingerprint_sha256 =
            pg_catalog.split_part(target_key, '|', 2)
        FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'mainnet finality source authority target is unavailable'
            USING ERRCODE = '55000';
        END IF;
      END LOOP;

      FOREACH target_key IN ARRAY deployment_targets LOOP
        PERFORM 1
        FROM ${DEPLOYMENT_AUTHORITY_TABLE} AS deployment
        WHERE deployment.deployment_authority_id =
            pg_catalog.split_part(target_key, '|', 1)::uuid
          AND deployment.authority_fingerprint_sha256 =
            pg_catalog.split_part(target_key, '|', 2)
        FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'mainnet finality deployment authority target is unavailable'
            USING ERRCODE = '55000';
        END IF;
      END LOOP;`;

const INTENT_AND_WALLET_LOCK = `
      -- Migration 0033 serializes every lifecycle append on the intent row.
      SELECT stored.* INTO selected_intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mainnet financial action intent is unavailable'
          USING ERRCODE = '55000';
      END IF;

      -- This is the account lock used by revoke_wallet_registration.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56001)
      );
      PERFORM 1
      FROM registered_wallets AS wallet
      INNER JOIN registered_wallet_identity_digests AS identity
        ON identity.wallet_id = wallet.wallet_id
        AND identity.account_id = wallet.account_id
        AND identity.chain_namespace = wallet.chain_namespace
        AND identity.chain_reference = wallet.chain_reference
        AND identity.address_digest_version =
          selected_intent.wallet_identity_digest_version
        AND identity.address_digest = pg_catalog.decode(
          selected_intent.wallet_identity_digest_hex, 'hex'
        )
        AND identity.status = 'ACTIVE'
        AND identity.revoked_at IS NULL
      WHERE wallet.wallet_id = selected_intent.wallet_id
        AND wallet.account_id = selected_intent.account_id
        AND wallet.chain_namespace = selected_intent.wallet_chain_namespace
        AND wallet.chain_reference = selected_intent.wallet_chain_reference
        AND wallet.address_digest_version =
          selected_intent.wallet_identity_digest_version
        AND wallet.address_digest = pg_catalog.decode(
          selected_intent.wallet_identity_digest_hex, 'hex'
        )
        AND wallet.status = 'ACTIVE'
        AND wallet.revoked_at IS NULL
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 =
          '${MAINNET_WALLET_AND_ASSET_REGISTRY_FINGERPRINT}'
        AND (
          (selected_intent.network_id = '${ETHEREUM}'
            AND wallet.chain_namespace = 'eip155'
            AND wallet.chain_reference = '1')
          OR
          (selected_intent.network_id = '${SOLANA}'
            AND wallet.chain_namespace = 'solana'
            AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        )
      FOR SHARE OF wallet, identity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mainnet financial action wallet is unavailable'
          USING ERRCODE = '55000';
      END IF;`;

const CONTROL_RECHECK = `
      IF EXISTS (
          SELECT 1
          FROM provider_position_chain_anchor_control_events AS control
          WHERE control.evidence_fingerprint_sha256 = ANY(evidence_targets)
            AND control.active_control
            AND control.control_action IN ('INVALIDATED', 'QUARANTINED')
        ) OR EXISTS (
          SELECT 1
          FROM mainnet_financial_action_reconciliation_authority_controls AS control
          WHERE control.active_control
            AND (
              (control.authority_kind = 'SOURCE'
                AND (
                  control.source_authority_id::text || '|' ||
                    control.authority_fingerprint_sha256
                ) = ANY(source_targets))
              OR
              (control.authority_kind = 'DEPLOYMENT'
                AND (
                  control.deployment_authority_id::text || '|' ||
                    control.authority_fingerprint_sha256
                ) = ANY(deployment_targets))
            )
        )
      THEN
        RAISE EXCEPTION 'mainnet finality persistence target is controlled'
          USING ERRCODE = '55000';
      END IF;`;

const ADMISSION_BODY = `
    DECLARE
      operation_id uuid := requested_observation_id;
      intent_lock_key bigint;
      operation_lock_key bigint;
      operation_exists boolean;
      evidence_targets text[];
      source_targets text[];
      deployment_targets text[];
      target_key text;
      selected_intent mainnet_financial_action_intents%ROWTYPE;
      prerequisite record;
      delegated record;
      effective_expires_at timestamptz;
      database_finished_at timestamptz;
    BEGIN
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR requested_intent_id IS NULL
        OR operation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid atomic authenticated reconciliation persistence request'
          USING ERRCODE = '22023';
      END IF;
${ADVISORY_SERIALIZATION}

      SELECT pg_catalog.count(*) = 1 INTO operation_exists
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.observation_id = operation_id;
      IF operation_exists THEN
        -- Immutable idempotent replay is not persistence. The v1 function is
        -- the single conflict oracle and this branch cannot create a row.
        RETURN QUERY SELECT * FROM ${RECORD_ADMISSION_V1}(
          ${ADMISSION_CALL_ARGUMENTS}
        );
        RETURN;
      END IF;

${LOCK_AUTHORITY_CANDIDATES}
      evidence_targets := ARRAY[
        requested_chain_anchor_evidence_fingerprint_sha256
      ]::text[];
      source_targets := ARRAY[
        requested_source_authority_id::text || '|' ||
          requested_source_authority_fingerprint_sha256
      ]::text[];
      deployment_targets := ARRAY[
        requested_deployment_authority_id::text || '|' ||
          requested_deployment_authority_fingerprint_sha256
      ]::text[];
${ORDERED_ROW_LOCKS}
${INTENT_AND_WALLET_LOCK}

      -- Re-read the operation target after the intent lock. New v2 writers
      -- share the advisory lock and v1 has no runtime callsite outside v2.
      IF EXISTS (
        SELECT 1
        FROM mainnet_financial_action_reconciliation_admissions AS admission
        WHERE admission.observation_id = operation_id
      ) THEN
        RAISE EXCEPTION 'authenticated reconciliation operation changed while locking'
          USING ERRCODE = '40001';
      END IF;
${CONTROL_RECHECK}

      SELECT * INTO prerequisite
      FROM read_mainnet_financial_action_reconciliation_prerequisite_v1(
        requested_account_id, requested_intent_id, requested_expected_revision,
        requested_expected_snapshot_sha256,
        requested_chain_anchor_evidence_fingerprint_sha256, requested_deadline_at
      );
      IF NOT FOUND
        OR prerequisite.account_id IS DISTINCT FROM requested_account_id
        OR prerequisite.intent_id IS DISTINCT FROM requested_intent_id
        OR prerequisite.intent_record_fingerprint_sha256 IS DISTINCT FROM
          selected_intent.intent_record_fingerprint_sha256
        OR prerequisite.wallet_registration_id IS DISTINCT FROM selected_intent.wallet_id
        OR prerequisite.wallet_identity_digest_version IS DISTINCT FROM
          selected_intent.wallet_identity_digest_version
        OR prerequisite.wallet_identity_digest_hex IS DISTINCT FROM
          selected_intent.wallet_identity_digest_hex
        OR prerequisite.lifecycle_revision IS DISTINCT FROM requested_expected_revision
        OR prerequisite.lifecycle_snapshot_sha256 IS DISTINCT FROM
          requested_expected_snapshot_sha256
        OR prerequisite.transaction_id IS DISTINCT FROM requested_transaction_id
        OR prerequisite.chain_anchor_evidence_fingerprint_sha256 IS DISTINCT FROM
          requested_chain_anchor_evidence_fingerprint_sha256
        OR prerequisite.source_authority_id IS DISTINCT FROM requested_source_authority_id
        OR prerequisite.source_authority_fingerprint_sha256 IS DISTINCT FROM
          requested_source_authority_fingerprint_sha256
        OR prerequisite.deployment_authority_id IS DISTINCT FROM
          requested_deployment_authority_id
        OR prerequisite.deployment_authority_fingerprint_sha256 IS DISTINCT FROM
          requested_deployment_authority_fingerprint_sha256
        OR (
          prerequisite.network_id = '${ETHEREUM}' AND (
            prerequisite.agreed_finalized_head ->> 'blockNumber' IS DISTINCT FROM
              requested_finalized_position::text
            OR prerequisite.agreed_finalized_head ->> 'blockHash' IS DISTINCT FROM
              requested_finalized_block_id
            OR (requested_transaction_position IS NOT NULL AND (
              prerequisite.chain_anchor ->> 'blockNumber' IS DISTINCT FROM
                requested_transaction_position::text
              OR prerequisite.chain_anchor ->> 'blockHash' IS DISTINCT FROM
                requested_transaction_block_id
            ))
          )
        )
        OR (
          prerequisite.network_id = '${SOLANA}' AND (
            prerequisite.agreed_finalized_head ->> 'root' IS DISTINCT FROM
              requested_finalized_position::text
            OR (requested_transaction_position IS NOT NULL
              AND prerequisite.chain_anchor ->> 'slot' IS DISTINCT FROM
                requested_transaction_position::text)
          )
        )
      THEN
        RAISE EXCEPTION 'fresh reconciliation prerequisite does not bind persistence'
          USING ERRCODE = '55000';
      END IF;

      effective_expires_at := LEAST(
        requested_deadline_at,
        prerequisite.chain_anchor_evidence_expires_at,
        prerequisite.source_authority_expires_at,
        prerequisite.deployment_authority_expires_at
      );
      SELECT * INTO STRICT delegated FROM ${RECORD_ADMISSION_V1}(
        ${ADMISSION_CALL_ARGUMENTS}
      );
      database_finished_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF delegated.admission_outcome IS DISTINCT FROM 'RECORDED'
        OR database_finished_at >= effective_expires_at
      THEN
        RAISE EXCEPTION 'authenticated reconciliation expired before durable completion'
          USING ERRCODE = '57014';
      END IF;
      RETURN QUERY SELECT
        delegated.admission_outcome,
        delegated.admission_fingerprint_sha256,
        delegated.admitted_event_revision,
        delegated.admitted_transition_fingerprint_sha256,
        delegated.lifecycle_stage,
        delegated.lifecycle_revision,
        delegated.current_snapshot_sha256,
        delegated.source_evidence_sha256,
        delegated.effect_evidence_sha256,
        delegated.failure_evidence_sha256,
        delegated.terminal,
        delegated.requires_manual_reconciliation,
        delegated.ledger_settlement_authority,
        delegated.recorded_at;
    END;`;

const POST_FINALITY_BODY = `
    DECLARE
      operation_id uuid := requested_review_id;
      intent_lock_key bigint;
      operation_lock_key bigint;
      operation_exists boolean;
      evidence_targets text[];
      source_targets text[];
      deployment_targets text[];
      target_key text;
      selected_intent mainnet_financial_action_intents%ROWTYPE;
      terminal_event mainnet_financial_action_events%ROWTYPE;
      original_admission mainnet_financial_action_reconciliation_admissions%ROWTYPE;
      latest_review mainnet_financial_action_post_finality_reviews%ROWTYPE;
      prior_reaffirmation mainnet_financial_action_post_finality_reviews%ROWTYPE;
      effective_state text;
      prerequisite record;
      delegated record;
      effective_expires_at timestamptz;
      database_finished_at timestamptz;
    BEGIN
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR requested_intent_id IS NULL
        OR operation_id IS NULL
      THEN
        RAISE EXCEPTION 'invalid atomic post-finality persistence request'
          USING ERRCODE = '22023';
      END IF;
${ADVISORY_SERIALIZATION}

      SELECT pg_catalog.count(*) = 1 INTO operation_exists
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.review_id = operation_id;
      IF operation_exists THEN
        -- Immutable idempotent replay is not persistence. The v1 function is
        -- the single conflict oracle and this branch cannot create a row.
        RETURN QUERY SELECT * FROM ${RECORD_REVIEW_V1}(
          ${REVIEW_CALL_ARGUMENTS}
        );
        RETURN;
      END IF;

${LOCK_AUTHORITY_CANDIDATES}
      -- Snapshot every safety-relevant lineage target before taking row locks:
      -- the candidate, original admission, latest review, and the most recent
      -- FINALITY_REAFFIRMED high-water mark. The lock set stays bounded.
      SELECT pg_catalog.array_agg(target ORDER BY target COLLATE "C")
      INTO evidence_targets
      FROM (
        SELECT requested_chain_anchor_evidence_fingerprint_sha256 AS target
        UNION
        SELECT admission.chain_anchor_evidence_fingerprint_sha256
        FROM mainnet_financial_action_reconciliation_admissions AS admission
        WHERE admission.intent_id = requested_intent_id
          AND admission.admitted_event_revision = requested_terminal_revision
        UNION
        SELECT review.chain_anchor_evidence_fingerprint_sha256
        FROM mainnet_financial_action_post_finality_reviews AS review
        WHERE review.intent_id = requested_intent_id
          AND (
            review.review_revision = (
              SELECT pg_catalog.max(candidate.review_revision)
              FROM mainnet_financial_action_post_finality_reviews AS candidate
              WHERE candidate.intent_id = requested_intent_id
            )
            OR review.review_revision = (
              SELECT pg_catalog.max(candidate.review_revision)
              FROM mainnet_financial_action_post_finality_reviews AS candidate
              WHERE candidate.intent_id = requested_intent_id
                AND candidate.disposition = 'FINALITY_REAFFIRMED'
            )
          )
      ) AS targets
      WHERE target IS NOT NULL;

      SELECT pg_catalog.array_agg(target ORDER BY target COLLATE "C")
      INTO source_targets
      FROM (
        SELECT requested_source_authority_id::text || '|' ||
          requested_source_authority_fingerprint_sha256 AS target
        UNION
        SELECT admission.source_authority_id::text || '|' ||
          admission.source_authority_fingerprint_sha256
        FROM mainnet_financial_action_reconciliation_admissions AS admission
        WHERE admission.intent_id = requested_intent_id
          AND admission.admitted_event_revision = requested_terminal_revision
        UNION
        SELECT review.source_authority_id::text || '|' ||
          review.source_authority_fingerprint_sha256
        FROM mainnet_financial_action_post_finality_reviews AS review
        WHERE review.intent_id = requested_intent_id
          AND (
            review.review_revision = (
              SELECT pg_catalog.max(candidate.review_revision)
              FROM mainnet_financial_action_post_finality_reviews AS candidate
              WHERE candidate.intent_id = requested_intent_id
            )
            OR review.review_revision = (
              SELECT pg_catalog.max(candidate.review_revision)
              FROM mainnet_financial_action_post_finality_reviews AS candidate
              WHERE candidate.intent_id = requested_intent_id
                AND candidate.disposition = 'FINALITY_REAFFIRMED'
            )
          )
      ) AS targets
      WHERE target IS NOT NULL;

      SELECT pg_catalog.array_agg(target ORDER BY target COLLATE "C")
      INTO deployment_targets
      FROM (
        SELECT requested_deployment_authority_id::text || '|' ||
          requested_deployment_authority_fingerprint_sha256 AS target
        UNION
        SELECT admission.deployment_authority_id::text || '|' ||
          admission.deployment_authority_fingerprint_sha256
        FROM mainnet_financial_action_reconciliation_admissions AS admission
        WHERE admission.intent_id = requested_intent_id
          AND admission.admitted_event_revision = requested_terminal_revision
        UNION
        SELECT review.deployment_authority_id::text || '|' ||
          review.deployment_authority_fingerprint_sha256
        FROM mainnet_financial_action_post_finality_reviews AS review
        WHERE review.intent_id = requested_intent_id
          AND (
            review.review_revision = (
              SELECT pg_catalog.max(candidate.review_revision)
              FROM mainnet_financial_action_post_finality_reviews AS candidate
              WHERE candidate.intent_id = requested_intent_id
            )
            OR review.review_revision = (
              SELECT pg_catalog.max(candidate.review_revision)
              FROM mainnet_financial_action_post_finality_reviews AS candidate
              WHERE candidate.intent_id = requested_intent_id
                AND candidate.disposition = 'FINALITY_REAFFIRMED'
            )
          )
      ) AS targets
      WHERE target IS NOT NULL;
${ORDERED_ROW_LOCKS}
${INTENT_AND_WALLET_LOCK}

      SELECT event.* INTO terminal_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
      ORDER BY event.revision DESC
      LIMIT 1;
      IF NOT FOUND
        OR terminal_event.revision IS DISTINCT FROM requested_terminal_revision
        OR terminal_event.snapshot_sha256 IS DISTINCT FROM
          requested_terminal_snapshot_sha256
      THEN
        RAISE EXCEPTION 'post-finality terminal compare-and-swap conflict'
          USING ERRCODE = '40001';
      END IF;

      SELECT admission.* INTO original_admission
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.intent_id = terminal_event.intent_id
        AND admission.admitted_event_revision = terminal_event.revision
        AND admission.admitted_transition_fingerprint_sha256 =
          terminal_event.transition_fingerprint_sha256;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'post-finality original admission is unavailable'
          USING ERRCODE = '55000';
      END IF;

      SELECT review.* INTO latest_review
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.intent_id = selected_intent.intent_id
      ORDER BY review.review_revision DESC
      LIMIT 1;
      IF (latest_review.review_id IS NULL AND (
          requested_expected_review_revision <> 0
          OR requested_expected_previous_review_fingerprint_sha256 IS NOT NULL
        )) OR (latest_review.review_id IS NOT NULL AND (
          latest_review.review_revision IS DISTINCT FROM requested_expected_review_revision
          OR latest_review.review_fingerprint_sha256 IS DISTINCT FROM
            requested_expected_previous_review_fingerprint_sha256
        ))
      THEN
        RAISE EXCEPTION 'post-finality review compare-and-swap conflict'
          USING ERRCODE = '40001';
      END IF;

      SELECT review.* INTO prior_reaffirmation
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.intent_id = selected_intent.intent_id
        AND review.disposition = 'FINALITY_REAFFIRMED'
      ORDER BY review.review_revision DESC
      LIMIT 1;
      IF NOT (
          original_admission.chain_anchor_evidence_fingerprint_sha256 =
            ANY(evidence_targets)
        )
        OR NOT (
          original_admission.source_authority_id::text || '|' ||
            original_admission.source_authority_fingerprint_sha256 =
              ANY(source_targets)
        )
        OR NOT (
          original_admission.deployment_authority_id::text || '|' ||
            original_admission.deployment_authority_fingerprint_sha256 =
              ANY(deployment_targets)
        )
        OR (latest_review.review_id IS NOT NULL AND (
          NOT (latest_review.chain_anchor_evidence_fingerprint_sha256 =
            ANY(evidence_targets))
          OR NOT (
            latest_review.source_authority_id::text || '|' ||
              latest_review.source_authority_fingerprint_sha256 = ANY(source_targets)
          )
          OR NOT (
            latest_review.deployment_authority_id::text || '|' ||
              latest_review.deployment_authority_fingerprint_sha256 =
                ANY(deployment_targets)
          )
        ))
        OR (prior_reaffirmation.review_id IS NOT NULL AND (
          NOT (prior_reaffirmation.chain_anchor_evidence_fingerprint_sha256 =
            ANY(evidence_targets))
          OR NOT (
            prior_reaffirmation.source_authority_id::text || '|' ||
              prior_reaffirmation.source_authority_fingerprint_sha256 =
                ANY(source_targets)
          )
          OR NOT (
            prior_reaffirmation.deployment_authority_id::text || '|' ||
              prior_reaffirmation.deployment_authority_fingerprint_sha256 =
                ANY(deployment_targets)
          )
        ))
      THEN
        RAISE EXCEPTION 'post-finality dependency target changed while locking'
          USING ERRCODE = '40001';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM mainnet_financial_action_post_finality_reviews AS review
        WHERE review.review_id = operation_id
      ) THEN
        RAISE EXCEPTION 'post-finality operation changed while locking'
          USING ERRCODE = '40001';
      END IF;

      effective_state := CASE
        WHEN latest_review.review_id IS NULL
          THEN 'AUTHENTICATED_FINALITY_RECORDED'
        WHEN latest_review.disposition = 'FINALITY_REAFFIRMED'
          THEN 'AUTHENTICATED_FINALITY_RECORDED'
        WHEN latest_review.disposition = 'REVIEW_INCONCLUSIVE'
          THEN 'POST_FINALITY_REVIEW_INCONCLUSIVE'
        ELSE NULL
      END;
      IF effective_state IS NULL THEN
        RAISE EXCEPTION 'post-finality state is permanently quarantined'
          USING ERRCODE = '55000';
      END IF;
${CONTROL_RECHECK}

      SELECT * INTO prerequisite
      FROM read_mainnet_financial_action_post_finality_prerequisite_v1(
        requested_account_id, requested_intent_id, requested_terminal_revision,
        requested_terminal_snapshot_sha256,
        requested_chain_anchor_evidence_fingerprint_sha256,
        terminal_event.transition_fingerprint_sha256,
        original_admission.admission_fingerprint_sha256,
        requested_expected_review_revision,
        requested_expected_previous_review_fingerprint_sha256,
        effective_state, requested_deadline_at
      );
      IF NOT FOUND
        OR prerequisite.account_id IS DISTINCT FROM requested_account_id
        OR prerequisite.intent_id IS DISTINCT FROM requested_intent_id
        OR prerequisite.intent_record_fingerprint_sha256 IS DISTINCT FROM
          selected_intent.intent_record_fingerprint_sha256
        OR prerequisite.wallet_registration_id IS DISTINCT FROM selected_intent.wallet_id
        OR prerequisite.wallet_identity_digest_version IS DISTINCT FROM
          selected_intent.wallet_identity_digest_version
        OR prerequisite.wallet_identity_digest_hex IS DISTINCT FROM
          selected_intent.wallet_identity_digest_hex
        OR prerequisite.lifecycle_revision IS DISTINCT FROM requested_terminal_revision
        OR prerequisite.lifecycle_snapshot_sha256 IS DISTINCT FROM
          requested_terminal_snapshot_sha256
        OR prerequisite.terminal_transition_fingerprint_sha256 IS DISTINCT FROM
          terminal_event.transition_fingerprint_sha256
        OR prerequisite.original_admission_fingerprint_sha256 IS DISTINCT FROM
          original_admission.admission_fingerprint_sha256
        OR prerequisite.expected_review_revision IS DISTINCT FROM
          requested_expected_review_revision
        OR prerequisite.expected_previous_review_fingerprint_sha256 IS DISTINCT FROM
          requested_expected_previous_review_fingerprint_sha256
        OR prerequisite.effective_safety_state IS DISTINCT FROM effective_state
        OR prerequisite.transaction_id IS DISTINCT FROM requested_transaction_id
        OR prerequisite.terminal_transaction_position IS DISTINCT FROM
          requested_transaction_position
        OR prerequisite.chain_anchor_evidence_fingerprint_sha256 IS DISTINCT FROM
          requested_chain_anchor_evidence_fingerprint_sha256
        OR prerequisite.source_authority_id IS DISTINCT FROM requested_source_authority_id
        OR prerequisite.source_authority_fingerprint_sha256 IS DISTINCT FROM
          requested_source_authority_fingerprint_sha256
        OR prerequisite.deployment_authority_id IS DISTINCT FROM
          requested_deployment_authority_id
        OR prerequisite.deployment_authority_fingerprint_sha256 IS DISTINCT FROM
          requested_deployment_authority_fingerprint_sha256
        OR (
          prerequisite.network_id = '${ETHEREUM}' AND (
            prerequisite.chain_anchor ->> 'blockNumber' IS DISTINCT FROM
              requested_transaction_position::text
            OR prerequisite.chain_anchor ->> 'blockHash' IS DISTINCT FROM
              requested_transaction_block_id
            OR prerequisite.agreed_finalized_head ->> 'blockNumber' IS DISTINCT FROM
              requested_finalized_position::text
            OR prerequisite.agreed_finalized_head ->> 'blockHash' IS DISTINCT FROM
              requested_finalized_block_id
          )
        )
        OR (
          prerequisite.network_id = '${SOLANA}' AND (
            prerequisite.chain_anchor ->> 'slot' IS DISTINCT FROM
              requested_transaction_position::text
            OR prerequisite.agreed_finalized_head ->> 'root' IS DISTINCT FROM
              requested_finalized_position::text
          )
        )
      THEN
        RAISE EXCEPTION 'fresh post-finality prerequisite does not bind persistence'
          USING ERRCODE = '55000';
      END IF;

      effective_expires_at := LEAST(
        requested_deadline_at,
        prerequisite.chain_anchor_evidence_expires_at,
        prerequisite.source_authority_expires_at,
        prerequisite.deployment_authority_expires_at
      );
      SELECT * INTO STRICT delegated FROM ${RECORD_REVIEW_V1}(
        ${REVIEW_CALL_ARGUMENTS}
      );
      database_finished_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF delegated.record_outcome IS DISTINCT FROM 'RECORDED'
        OR database_finished_at >= effective_expires_at
      THEN
        RAISE EXCEPTION 'post-finality review expired before durable completion'
          USING ERRCODE = '57014';
      END IF;
      RETURN QUERY SELECT
        delegated.record_outcome,
        delegated.review_fingerprint_sha256,
        delegated.review_revision,
        delegated.current_review_revision,
        delegated.current_review_fingerprint_sha256,
        delegated.current_review_disposition,
        delegated.effective_safety_state,
        delegated.requires_manual_review,
        delegated.ledger_settlement_authority,
        delegated.recorded_at;
    END;`;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `CREATE FUNCTION ${RECORD_ADMISSION_V2}(
      ${RECORD_ADMISSION_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${ADMISSION_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE
    AS $function$${ADMISSION_BODY}$function$;

    CREATE FUNCTION ${RECORD_REVIEW_V2}(
      ${RECORD_REVIEW_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${REVIEW_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE
    AS $function$${POST_FINALITY_BODY}$function$;

    DO $set_atomic_finality_persistence_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECORD_ADMISSION_V2_IDENTITY}
          SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECORD_REVIEW_V2_IDENTITY}
          SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_atomic_finality_persistence_paths$;

    REVOKE ALL ON FUNCTION ${RECORD_ADMISSION_V2_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECORD_REVIEW_V2_IDENTITY} FROM ${guarded};`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `REVOKE ALL ON FUNCTION ${RECORD_REVIEW_V2_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECORD_ADMISSION_V2_IDENTITY} FROM ${guarded};
    DROP FUNCTION ${RECORD_REVIEW_V2_IDENTITY};
    DROP FUNCTION ${RECORD_ADMISSION_V2_IDENTITY};`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetFinancialActionFinalityPrerequisiteReadMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0036 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const expectations = [
    {
      identity: RECORD_ADMISSION_V2_IDENTITY,
      body: ADMISSION_BODY,
      arguments: RECORD_ADMISSION_ARGUMENTS,
      result: ADMISSION_RESULT,
    },
    {
      identity: RECORD_REVIEW_V2_IDENTITY,
      body: POST_FINALITY_BODY,
      arguments: RECORD_REVIEW_ARGUMENTS,
      result: REVIEW_RESULT,
    },
  ] as const;
  const values = expectations
    .map(({ identity: functionIdentity, body, arguments: inputs, result }) => {
      const resultArguments = result.split(',').map((column) => {
        const [name = '', ...typeParts] = column.trim().split(/\s+/u);
        return [name, typeParts.join(' ').replace('timestamptz', 'timestamp with time zone')];
      });
      const inputNames = inputs.map(([name]) => `'${name}'`);
      const outputNames = resultArguments.map(([name]) => `'${name}'`);
      const inputTypes = inputs.map(([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`);
      const allTypes = [
        ...inputTypes,
        ...resultArguments.map(([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`),
      ];
      const modes = [
        ...inputs.map(() => `'i'::"char"`),
        ...resultArguments.map(() => `'t'::"char"`),
      ];
      return `('${functionIdentity}', '${sourceSha256(body)}', '${canonicalResult(result)}',
          ARRAY[${[...inputNames, ...outputNames].join(', ')}]::text[],
          ARRAY[${inputTypes.join(', ')}]::oid[],
          ARRAY[${allTypes.join(', ')}]::oid[],
          ARRAY[${modes.join(', ')}]::"char"[])`;
    })
    .join(',\n        ');

  return `SELECT (prior.valid AND function_state.valid) AS valid
    FROM (${previous.verifySql}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.count(procedure.oid) = 2
        AND pg_catalog.bool_and(
          procedure.prokind = 'f'
          AND NOT procedure.proleakproof
          AND procedure.prosecdef
          AND NOT procedure.proisstrict
          AND procedure.provolatile = 'v'
          AND procedure.proparallel = 'u'
          AND procedure.proretset
          AND procedure.pronargs = pg_catalog.cardinality(expected.input_type_oids)
          AND procedure.pronargdefaults = 0
          AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND procedure.proargnames = expected.argument_names
          AND pg_catalog.array_to_string(procedure.proargtypes::oid[], ',') =
            pg_catalog.array_to_string(expected.input_type_oids, ',')
          AND procedure.proallargtypes = expected.all_type_oids
          AND procedure.proargmodes = expected.argument_modes
          AND language.lanname = 'plpgsql'
          AND pg_catalog.pg_get_function_result(procedure.oid) = expected.function_result
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = expected.body_sha256
          AND function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT pg_catalog.has_function_privilege(
            ${api}, expected.function_identity, 'EXECUTE'
          )
          AND NOT pg_catalog.has_function_privilege(
            ${worker}, expected.function_identity, 'EXECUTE'
          )
          AND NOT pg_catalog.has_function_privilege(
            ${legacy}, expected.function_identity, 'EXECUTE'
          )
          AND NOT pg_catalog.has_function_privilege(
            ${balance}, expected.function_identity, 'EXECUTE'
          )
          AND NOT pg_catalog.has_function_privilege(
            ${migration}, expected.function_identity, 'EXECUTE'
          )
          AND NOT pg_catalog.has_function_privilege(
            'public', expected.function_identity, 'EXECUTE'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
            ) AS acl
            WHERE acl.grantee <> procedure.proowner
          )
        ) AS valid
      FROM (VALUES
        ${values}
      ) AS expected(
        function_identity, body_sha256, function_result, argument_names,
        input_type_oids, all_type_oids, argument_modes
      )
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS function_state`;
}

export function createMainnetFinancialActionAtomicFinalityPersistenceMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0037',
    description: 'atomically persist authenticated mainnet action finality after fresh gates',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0036'],
  };
}

export const createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037 =
  createMainnetFinancialActionAtomicFinalityPersistenceMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
  );

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037 =
  createMainnetFinancialActionAtomicFinalityPersistenceMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
    { cumulativePrincipalVerification: false },
  );
