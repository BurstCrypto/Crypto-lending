import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionAuthenticatedFinalityMigration } from './0035-create-mainnet-financial-action-authenticated-finality.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MAINNET_WALLET_AND_ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

const RECONCILIATION_READ_IDENTITY =
  'read_mainnet_financial_action_reconciliation_prerequisite_v1(uuid,uuid,bigint,text,text,timestamp with time zone)';
const POST_FINALITY_READ_IDENTITY =
  'read_mainnet_financial_action_post_finality_prerequisite_v1(uuid,uuid,bigint,text,text,text,text,bigint,text,text,timestamp with time zone)';

const RECONCILIATION_ARGUMENTS = Object.freeze([
  ['requested_account_id', 'uuid'],
  ['requested_intent_id', 'uuid'],
  ['requested_lifecycle_revision', 'bigint'],
  ['requested_lifecycle_snapshot_sha256', 'text'],
  ['requested_chain_anchor_evidence_fingerprint_sha256', 'text'],
  ['requested_deadline_at', 'timestamp with time zone'],
] as const);

const POST_FINALITY_ARGUMENTS = Object.freeze([
  ['requested_account_id', 'uuid'],
  ['requested_intent_id', 'uuid'],
  ['requested_terminal_revision', 'bigint'],
  ['requested_terminal_snapshot_sha256', 'text'],
  ['requested_chain_anchor_evidence_fingerprint_sha256', 'text'],
  ['requested_terminal_transition_fingerprint_sha256', 'text'],
  ['requested_original_admission_fingerprint_sha256', 'text'],
  ['requested_expected_review_revision', 'bigint'],
  ['requested_expected_previous_review_fingerprint_sha256', 'text'],
  ['requested_effective_safety_state', 'text'],
  ['requested_deadline_at', 'timestamp with time zone'],
] as const);

const RESULT_COLUMNS = `
      account_id uuid,
      intent_id uuid,
      intent_record_fingerprint_sha256 text,
      wallet_registration_id uuid,
      wallet_identity_digest_version smallint,
      wallet_identity_digest_hex text,
      network_id text,
      lifecycle_revision bigint,
      lifecycle_snapshot_sha256 text,
      lifecycle_stage text,
      transaction_id text,
      wallet_signed_payload_sha256 text,
      wallet_signature_evidence_sha256 text,
      chain_anchor_evidence_fingerprint_sha256 text,
      chain_anchor jsonb,
      agreed_finalized_head jsonb,
      chain_anchor_evidence_expires_at timestamptz,
      source_authority_id uuid,
      source_authority_fingerprint_sha256 text,
      source_authority_expires_at timestamptz,
      source_pair_approval_id text,
      source_pair_registry_fingerprint_sha256 text,
      primary_source_family_id text,
      primary_source_id text,
      primary_source_kind text,
      corroborating_source_family_id text,
      corroborating_source_id text,
      corroborating_source_kind text,
      deployment_authority_id uuid,
      deployment_authority_fingerprint_sha256 text,
      deployment_authority_expires_at timestamptz,
      primary_deployment_manifest_fingerprint_sha256 text,
      primary_observed_identity_fingerprint_sha256 text,
      corroborating_deployment_manifest_fingerprint_sha256 text,
      corroborating_observed_identity_fingerprint_sha256 text,
      provider_id text,
      protocol_id text,
      market_id text,
      asset_registry_version integer,
      asset_registry_fingerprint_sha256 text,
      asset_symbol text,
      asset_identity text,
      asset_decimals smallint,
      action_type text,
      amount_atomic numeric,
      terminal_transition_fingerprint_sha256 text,
      original_admission_fingerprint_sha256 text,
      terminal_transaction_position numeric,
      terminal_transaction_block_id text,
      expected_review_revision bigint,
      expected_previous_review_fingerprint_sha256 text,
      effective_safety_state text,
      verified_at timestamptz`;

const RESULT_ARGUMENTS = Object.freeze(
  RESULT_COLUMNS.split(',').map((column) => {
    const [name = '', ...typeParts] = column.trim().split(/\s+/u);
    return [name, typeParts.join(' ').replace('timestamptz', 'timestamp with time zone')] as const;
  }),
);

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

const AUTHORITY_CANDIDATE_PREDICATE = `
        source.authority_version = 1
        AND source.authority_use =
          'MAINNET_FINANCIAL_ACTION_RECONCILIATION_SOURCE_ONLY'
        AND NOT source.may_authorize_financial_action
        AND source.network_id = selected_evidence.network_id
        AND source.primary_source_family_id = selected_evidence.primary_source_family_id
        AND source.primary_source_id = selected_evidence.primary_source_id
        AND source.corroborating_source_family_id =
          selected_evidence.corroborating_source_family_id
        AND source.corroborating_source_id = selected_evidence.corroborating_source_id
        AND source.source_pair_approval_id = selected_evidence.source_pair_approval_id
        AND source.source_pair_registry_fingerprint_sha256 =
          selected_evidence.source_pair_registry_fingerprint_sha256
        AND (
          (selected_evidence.source_family_id = source.primary_source_family_id
            AND selected_evidence.source_id = source.primary_source_id
            AND selected_evidence.source_kind = source.primary_source_kind)
          OR
          (selected_evidence.source_family_id = source.corroborating_source_family_id
            AND selected_evidence.source_id = source.corroborating_source_id
            AND selected_evidence.source_kind = source.corroborating_source_kind)
        )
        AND source.approved_at <= database_verified_at
        AND database_verified_at < source.expires_at
        AND selected_evidence.source_pair_approval_expires_at <= source.expires_at
        AND deployment.authority_version = 1
        AND deployment.authority_use =
          'MAINNET_FINANCIAL_ACTION_RECONCILIATION_DEPLOYMENT_ONLY'
        AND NOT deployment.may_authorize_financial_action
        AND deployment.source_authority_fingerprint_sha256 =
          source.authority_fingerprint_sha256
        AND deployment.network_id = source.network_id
        AND deployment.provider_id = selected_intent.provider_id
        AND deployment.protocol_id = selected_intent.protocol_id
        AND deployment.market_id = selected_intent.market_id
        AND deployment.asset_registry_version = selected_intent.asset_registry_version
        AND deployment.asset_registry_fingerprint_sha256 =
          selected_intent.asset_registry_fingerprint_sha256
        AND deployment.asset_symbol = selected_intent.asset_symbol
        AND deployment.asset_identity = selected_intent.asset_identity
        AND deployment.asset_decimals = selected_intent.asset_decimals
        AND deployment.action_type = selected_intent.action_type
        AND deployment.approved_at >= source.approved_at
        AND deployment.approved_at <= database_verified_at
        AND database_verified_at < deployment.expires_at
        AND deployment.expires_at <= source.expires_at
        AND NOT EXISTS (
          SELECT 1
          FROM mainnet_financial_action_reconciliation_authority_controls AS control
          WHERE control.active_control
            AND (
              (control.authority_kind = 'SOURCE'
                AND control.source_authority_id = source.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  source.authority_fingerprint_sha256)
              OR
              (control.authority_kind = 'DEPLOYMENT'
                AND control.deployment_authority_id =
                  deployment.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  deployment.authority_fingerprint_sha256)
            )
        )`;

const COMMON_STATE_BODY = `
      SELECT stored.* INTO selected_intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id;
      IF NOT FOUND THEN RETURN; END IF;

      SELECT evidence.* INTO selected_evidence
      FROM provider_position_chain_anchor_evidence AS evidence
      WHERE evidence.evidence_fingerprint_sha256 =
        requested_chain_anchor_evidence_fingerprint_sha256
      FOR SHARE;
      IF NOT FOUND THEN RETURN; END IF;

      -- Migration 0029 authenticates global head continuity/finality only. It
      -- does not prove transaction inclusion, sender, calldata/instructions,
      -- receipt/meta, wallet-signature linkage, or protocol effect.

      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      SELECT pg_catalog.count(*),
        (pg_catalog.array_agg(
          source.source_authority_id ORDER BY source.source_authority_id::text
        ))[1],
        (pg_catalog.array_agg(
          deployment.deployment_authority_id
          ORDER BY deployment.deployment_authority_id::text
        ))[1]
      INTO authority_candidate_count, selected_source_authority_id,
        selected_deployment_authority_id
      FROM mainnet_financial_action_reconciliation_source_authorities AS source
      INNER JOIN mainnet_financial_action_reconciliation_deployment_authorities
        AS deployment
        ON deployment.source_authority_id = source.source_authority_id
      WHERE ${AUTHORITY_CANDIDATE_PREDICATE};
      IF authority_candidate_count <> 1 THEN RETURN; END IF;

      SELECT source.* INTO selected_source_authority
      FROM mainnet_financial_action_reconciliation_source_authorities AS source
      WHERE source.source_authority_id = selected_source_authority_id
      FOR SHARE;
      IF NOT FOUND THEN RETURN; END IF;
      SELECT deployment.* INTO selected_deployment_authority
      FROM mainnet_financial_action_reconciliation_deployment_authorities AS deployment
      WHERE deployment.deployment_authority_id = selected_deployment_authority_id
      FOR SHARE;
      IF NOT FOUND THEN RETURN; END IF;

      -- Migration 0033 serializes every event append on this intent row.
      SELECT stored.* INTO selected_intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR SHARE;
      IF NOT FOUND THEN RETURN; END IF;

      -- This is the account lock used by wallet revocation.
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
        AND identity.address_digest_version = selected_intent.wallet_identity_digest_version
        AND identity.address_digest = pg_catalog.decode(
          selected_intent.wallet_identity_digest_hex, 'hex'
        )
        AND identity.status = 'ACTIVE'
        AND identity.revoked_at IS NULL
      WHERE wallet.wallet_id = selected_intent.wallet_id
        AND wallet.account_id = selected_intent.account_id
        AND wallet.chain_namespace = selected_intent.wallet_chain_namespace
        AND wallet.chain_reference = selected_intent.wallet_chain_reference
        AND wallet.address_digest_version = selected_intent.wallet_identity_digest_version
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
            AND wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
          OR
          (selected_intent.network_id = '${SOLANA}'
            AND wallet.chain_namespace = 'solana'
            AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        )
      FOR SHARE OF wallet, identity;
      IF NOT FOUND THEN RETURN; END IF;

      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      chain_evidence_expires_at := LEAST(
        selected_evidence.source_pair_approval_expires_at,
        selected_evidence.current_head_advanced_at + CASE
          WHEN selected_intent.network_id = '${ETHEREUM}'
            THEN interval '60 seconds' ELSE interval '15 seconds' END,
        selected_evidence.finalized_head_advanced_at + CASE
          WHEN selected_intent.network_id = '${ETHEREUM}'
            THEN interval '1800 seconds' ELSE interval '90 seconds' END
      );
      IF database_verified_at >= requested_deadline_at
        OR database_verified_at >= chain_evidence_expires_at
        OR selected_intent.network_id <> selected_evidence.network_id
        OR selected_intent.network_id <> selected_source_authority.network_id
        OR selected_intent.network_id <> selected_deployment_authority.network_id
        OR selected_intent.asset_registry_version <> 1
        OR selected_intent.asset_registry_fingerprint_sha256 <>
          '${MAINNET_WALLET_AND_ASSET_REGISTRY_FINGERPRINT}'
        OR selected_intent.action_type NOT IN ('SUPPLY', 'WITHDRAW')
        OR selected_intent.amount_atomic <= 0
        OR selected_evidence.evidence_version <> 1
        OR selected_evidence.evidence_use <>
          'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_ONLY'
        OR selected_evidence.may_authorize_financial_action
        OR selected_evidence.may_persist
        OR selected_evidence.identity_status <> 'VERIFIED'
        OR selected_evidence.progression_status <> 'CURRENT'
        OR selected_evidence.finality_status <> 'HEALTHY'
        OR NOT provider_position_chain_anchor_valid(
          selected_evidence.network_id, selected_evidence.chain_anchor
        )
        OR NOT provider_position_chain_anchor_valid(
          selected_evidence.network_id, selected_evidence.agreed_finalized_head
        )
        OR (
          selected_intent.network_id = '${ETHEREUM}' AND (
            (selected_evidence.chain_anchor ->> 'blockNumber')::numeric >
              18446744073709551615
            OR (selected_evidence.agreed_finalized_head ->> 'blockNumber')::numeric >
              18446744073709551615
          )
        )
        OR selected_source_authority.source_authority_id <>
          selected_deployment_authority.source_authority_id
        OR selected_source_authority.authority_fingerprint_sha256 <>
          selected_deployment_authority.source_authority_fingerprint_sha256
        OR selected_source_authority.approved_at > database_verified_at
        OR database_verified_at >= selected_source_authority.expires_at
        OR selected_deployment_authority.approved_at > database_verified_at
        OR database_verified_at >= selected_deployment_authority.expires_at
        OR selected_evidence.source_pair_approval_expires_at >
          selected_source_authority.expires_at
        OR selected_deployment_authority.approved_at <
          selected_source_authority.approved_at
        OR selected_deployment_authority.expires_at >
          selected_source_authority.expires_at
        OR EXISTS (
          SELECT 1 FROM provider_position_chain_anchor_control_events AS control
          WHERE control.evidence_fingerprint_sha256 =
              selected_evidence.evidence_fingerprint_sha256
            AND control.active_control
            AND control.control_action IN ('INVALIDATED', 'QUARANTINED')
        )
        OR EXISTS (
          SELECT 1
          FROM mainnet_financial_action_reconciliation_authority_controls AS control
          WHERE control.active_control AND (
            (control.authority_kind = 'SOURCE'
              AND control.source_authority_id =
                selected_source_authority.source_authority_id
              AND control.authority_fingerprint_sha256 =
                selected_source_authority.authority_fingerprint_sha256)
            OR
            (control.authority_kind = 'DEPLOYMENT'
              AND control.deployment_authority_id =
                selected_deployment_authority.deployment_authority_id
              AND control.authority_fingerprint_sha256 =
                selected_deployment_authority.authority_fingerprint_sha256)
          )
        )
        OR (
          SELECT pg_catalog.count(*)
          FROM mainnet_financial_action_reconciliation_source_authorities AS source
          INNER JOIN mainnet_financial_action_reconciliation_deployment_authorities
            AS deployment
            ON deployment.source_authority_id = source.source_authority_id
          WHERE ${AUTHORITY_CANDIDATE_PREDICATE}
        ) <> 1
      THEN
        RETURN;
      END IF;`;

const COMMON_DECLARATIONS = `
      selected_intent mainnet_financial_action_intents%ROWTYPE;
      current_event mainnet_financial_action_events%ROWTYPE;
      submission_event mainnet_financial_action_events%ROWTYPE;
      selected_evidence provider_position_chain_anchor_evidence%ROWTYPE;
      selected_source_authority
        mainnet_financial_action_reconciliation_source_authorities%ROWTYPE;
      selected_deployment_authority
        mainnet_financial_action_reconciliation_deployment_authorities%ROWTYPE;
      selected_source_authority_id uuid;
      selected_deployment_authority_id uuid;
      authority_candidate_count bigint;
      database_verified_at timestamptz;
      chain_evidence_expires_at timestamptz;`;

const COMMON_RESULT_PREFIX = `
        selected_intent.account_id,
        selected_intent.intent_id,
        selected_intent.intent_record_fingerprint_sha256,
        selected_intent.wallet_id,
        selected_intent.wallet_identity_digest_version,
        selected_intent.wallet_identity_digest_hex,
        selected_intent.network_id,
        current_event.revision,
        current_event.snapshot_sha256,
        current_event.stage,
        current_event.chain_transaction_id,
        submission_event.wallet_signed_payload_sha256,
        submission_event.wallet_signature_evidence_sha256,
        selected_evidence.evidence_fingerprint_sha256,
        selected_evidence.chain_anchor,
        selected_evidence.agreed_finalized_head,
        chain_evidence_expires_at,
        selected_source_authority.source_authority_id,
        selected_source_authority.authority_fingerprint_sha256,
        selected_source_authority.expires_at,
        selected_source_authority.source_pair_approval_id,
        selected_source_authority.source_pair_registry_fingerprint_sha256,
        selected_source_authority.primary_source_family_id,
        selected_source_authority.primary_source_id,
        selected_source_authority.primary_source_kind,
        selected_source_authority.corroborating_source_family_id,
        selected_source_authority.corroborating_source_id,
        selected_source_authority.corroborating_source_kind,
        selected_deployment_authority.deployment_authority_id,
        selected_deployment_authority.authority_fingerprint_sha256,
        selected_deployment_authority.expires_at,
        selected_deployment_authority.primary_deployment_manifest_fingerprint_sha256,
        selected_deployment_authority.primary_observed_identity_fingerprint_sha256,
        selected_deployment_authority.corroborating_deployment_manifest_fingerprint_sha256,
        selected_deployment_authority.corroborating_observed_identity_fingerprint_sha256,
        selected_intent.provider_id,
        selected_intent.protocol_id,
        selected_intent.market_id,
        selected_intent.asset_registry_version,
        selected_intent.asset_registry_fingerprint_sha256,
        selected_intent.asset_symbol,
        selected_intent.asset_identity,
        selected_intent.asset_decimals,
        selected_intent.action_type,
        selected_intent.amount_atomic,`;

const RECONCILIATION_READ_BODY = `
    DECLARE${COMMON_DECLARATIONS}
    BEGIN
      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR pg_catalog.substring(requested_account_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_account_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.substring(requested_intent_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_intent_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR requested_lifecycle_revision < 2
        OR requested_lifecycle_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_lifecycle_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_chain_anchor_evidence_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_chain_anchor_evidence_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR NOT pg_catalog.isfinite(requested_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_deadline_at) <>
          requested_deadline_at
        OR database_verified_at >= requested_deadline_at
        OR requested_deadline_at > database_verified_at + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action reconciliation prerequisite read'
          USING ERRCODE = '22023';
      END IF;

${COMMON_STATE_BODY}

      SELECT event.* INTO current_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
      ORDER BY event.revision DESC
      LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;
      SELECT event.* INTO submission_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
      IF NOT FOUND THEN RETURN; END IF;

      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF current_event.revision <> requested_lifecycle_revision
        OR current_event.snapshot_sha256 <> requested_lifecycle_snapshot_sha256
        OR current_event.stage NOT IN (
          'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
        )
        OR current_event.terminal
        OR current_event.revision < 2
        OR current_event.chain_transaction_id IS NULL
        OR submission_event.revision <> 2
        OR submission_event.chain_transaction_id IS NULL
        OR submission_event.chain_transaction_id <> current_event.chain_transaction_id
        OR submission_event.wallet_signed_payload_sha256 IS NULL
        OR submission_event.wallet_signature_evidence_sha256 IS NULL
        OR submission_event.wallet_signed_payload_sha256 =
          submission_event.wallet_signature_evidence_sha256
        OR NOT mainnet_action_chain_identity_valid(
          selected_intent.network_id, current_event.chain_transaction_id, 'TRANSACTION'
        )
        OR (
          current_event.finalized_position IS NOT NULL
          AND (
            (selected_intent.network_id = '${ETHEREUM}'
              AND (selected_evidence.agreed_finalized_head ->> 'blockNumber')::numeric <
                current_event.finalized_position)
            OR
            (selected_intent.network_id = '${SOLANA}'
              AND (selected_evidence.agreed_finalized_head ->> 'root')::numeric <
                current_event.finalized_position)
          )
        )
        OR database_verified_at >= requested_deadline_at
        OR database_verified_at >= chain_evidence_expires_at
        OR database_verified_at >= selected_source_authority.expires_at
        OR database_verified_at >= selected_deployment_authority.expires_at
      THEN
        RETURN;
      END IF;

      RETURN QUERY SELECT${COMMON_RESULT_PREFIX}
        NULL::text,
        NULL::text,
        NULL::numeric,
        NULL::text,
        NULL::bigint,
        NULL::text,
        NULL::text,
        database_verified_at;
    END;`;

const POST_FINALITY_READ_BODY = `
    DECLARE${COMMON_DECLARATIONS}
      original_admission mainnet_financial_action_reconciliation_admissions%ROWTYPE;
      latest_review mainnet_financial_action_post_finality_reviews%ROWTYPE;
      admission_match_count bigint;
      review_count bigint;
    BEGIN
      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF requested_account_id IS NULL
        OR requested_intent_id IS NULL
        OR requested_terminal_revision IS NULL
        OR requested_terminal_snapshot_sha256 IS NULL
        OR requested_chain_anchor_evidence_fingerprint_sha256 IS NULL
        OR requested_terminal_transition_fingerprint_sha256 IS NULL
        OR requested_original_admission_fingerprint_sha256 IS NULL
        OR requested_expected_review_revision IS NULL
        OR requested_effective_safety_state IS NULL
        OR requested_deadline_at IS NULL
        OR pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR pg_catalog.substring(requested_account_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_account_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.substring(requested_intent_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_intent_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR requested_terminal_revision < 3
        OR requested_expected_review_revision < 0
        OR requested_expected_review_revision >= 9223372036854775807
        OR (requested_expected_previous_review_fingerprint_sha256 IS NULL) <>
          (requested_expected_review_revision = 0)
        OR requested_terminal_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_terminal_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_chain_anchor_evidence_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_chain_anchor_evidence_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR requested_terminal_transition_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_terminal_transition_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR requested_original_admission_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_original_admission_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR (requested_expected_previous_review_fingerprint_sha256 IS NOT NULL AND (
          requested_expected_previous_review_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
          OR requested_expected_previous_review_fingerprint_sha256 =
            pg_catalog.repeat('0', 64)
        ))
        OR requested_effective_safety_state NOT IN (
          'AUTHENTICATED_FINALITY_RECORDED',
          'POST_FINALITY_REVIEW_INCONCLUSIVE'
        )
        OR NOT pg_catalog.isfinite(requested_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_deadline_at) <>
          requested_deadline_at
        OR database_verified_at >= requested_deadline_at
        OR requested_deadline_at > database_verified_at + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action post-finality prerequisite read'
          USING ERRCODE = '22023';
      END IF;

${COMMON_STATE_BODY}

      SELECT event.* INTO current_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
      ORDER BY event.revision DESC
      LIMIT 1;
      IF NOT FOUND THEN RETURN; END IF;
      SELECT event.* INTO submission_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
      IF NOT FOUND THEN RETURN; END IF;

      SELECT pg_catalog.count(*) INTO admission_match_count
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.admission_fingerprint_sha256 =
          requested_original_admission_fingerprint_sha256
        AND admission.intent_id = current_event.intent_id
        AND admission.admitted_event_revision = current_event.revision
        AND admission.admitted_transition_fingerprint_sha256 =
          current_event.transition_fingerprint_sha256
        AND admission.admitted_event_snapshot_sha256 = current_event.snapshot_sha256;
      IF admission_match_count <> 1 THEN RETURN; END IF;
      SELECT admission.* INTO original_admission
      FROM mainnet_financial_action_reconciliation_admissions AS admission
      WHERE admission.admission_fingerprint_sha256 =
        requested_original_admission_fingerprint_sha256
      FOR SHARE;
      IF NOT FOUND THEN RETURN; END IF;

      SELECT pg_catalog.count(*) INTO review_count
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.intent_id = selected_intent.intent_id;
      SELECT review.* INTO latest_review
      FROM mainnet_financial_action_post_finality_reviews AS review
      WHERE review.intent_id = selected_intent.intent_id
      ORDER BY review.review_revision DESC
      LIMIT 1;

      database_verified_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF current_event.revision <> requested_terminal_revision
        OR current_event.snapshot_sha256 <> requested_terminal_snapshot_sha256
        OR current_event.transition_fingerprint_sha256 <>
          requested_terminal_transition_fingerprint_sha256
        OR current_event.stage NOT IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')
        OR NOT current_event.terminal
        OR current_event.revision < 3
        OR current_event.chain_transaction_id IS NULL
        OR current_event.transaction_position IS NULL
        OR current_event.transaction_block_id IS NULL
        OR current_event.finalized_position IS NULL
        OR current_event.finalized_block_id IS NULL
        OR submission_event.revision <> 2
        OR submission_event.chain_transaction_id <> current_event.chain_transaction_id
        OR submission_event.wallet_signed_payload_sha256 IS NULL
        OR submission_event.wallet_signature_evidence_sha256 IS NULL
        OR original_admission.network_id <> selected_intent.network_id
        OR original_admission.chain_transaction_id <> current_event.chain_transaction_id
        OR original_admission.admitted_event_snapshot_sha256 <> current_event.snapshot_sha256
        OR original_admission.transaction_position <> current_event.transaction_position
        OR original_admission.transaction_block_id <> current_event.transaction_block_id
        OR original_admission.finalized_position <> current_event.finalized_position
        OR original_admission.finalized_block_id <> current_event.finalized_block_id
        OR (
          (current_event.stage = 'FINALIZED_SUCCESS'
            AND original_admission.reconciliation_outcome <> 'FINALIZED_SUCCESS')
          OR
          (current_event.stage = 'FINALIZED_FAILURE'
            AND original_admission.reconciliation_outcome <> 'FINALIZED_FAILURE')
        )
        OR original_admission.may_authorize_financial_action
        OR original_admission.may_resend_transaction
        OR original_admission.ledger_settlement_authority
        OR NOT mainnet_action_chain_identity_valid(
          selected_intent.network_id, current_event.chain_transaction_id, 'TRANSACTION'
        )
        OR NOT mainnet_action_chain_identity_valid(
          selected_intent.network_id, current_event.transaction_block_id, 'BLOCK'
        )
        -- EVM hash lineage is deliberately left to the dual-source attestations
        -- so both terminal reaffirmation and replacement lineage remain reachable.
        OR (
          selected_intent.network_id = '${ETHEREUM}' AND (
            selected_evidence.chain_anchor ->> 'kind' <> 'EVM_BLOCK'
            OR selected_evidence.chain_anchor ->> 'blockNumber' <>
              current_event.transaction_position::text
            OR (selected_evidence.agreed_finalized_head ->> 'blockNumber')::numeric <
              current_event.transaction_position
          )
        )
        OR (
          selected_intent.network_id = '${SOLANA}' AND (
            selected_evidence.chain_anchor ->> 'kind' <> 'SOLANA_SLOT'
            OR selected_evidence.chain_anchor ->> 'slot' <>
              current_event.transaction_position::text
            OR (selected_evidence.agreed_finalized_head ->> 'root')::numeric <
              current_event.transaction_position
          )
        )
        OR EXISTS (
          SELECT 1
          FROM mainnet_financial_action_post_finality_reviews AS review
          WHERE review.intent_id = selected_intent.intent_id
            AND review.disposition = 'DEEP_REORG_QUARANTINED'
        )
        OR EXISTS (
          SELECT 1
          FROM provider_position_chain_anchor_control_events AS control
          WHERE control.active_control
            AND control.control_action IN ('INVALIDATED', 'QUARANTINED')
            AND control.evidence_fingerprint_sha256 IN (
              original_admission.chain_anchor_evidence_fingerprint_sha256,
              latest_review.chain_anchor_evidence_fingerprint_sha256
            )
        )
        OR EXISTS (
          SELECT 1
          FROM mainnet_financial_action_reconciliation_authority_controls AS control
          WHERE control.active_control AND (
            (control.authority_kind = 'SOURCE' AND (
              (control.source_authority_id = original_admission.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  original_admission.source_authority_fingerprint_sha256)
              OR
              (control.source_authority_id = latest_review.source_authority_id
                AND control.authority_fingerprint_sha256 =
                  latest_review.source_authority_fingerprint_sha256)
            ))
            OR
            (control.authority_kind = 'DEPLOYMENT' AND (
              (control.deployment_authority_id =
                  original_admission.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  original_admission.deployment_authority_fingerprint_sha256)
              OR
              (control.deployment_authority_id = latest_review.deployment_authority_id
                AND control.authority_fingerprint_sha256 =
                  latest_review.deployment_authority_fingerprint_sha256)
            ))
          )
        )
        OR review_count <> requested_expected_review_revision
        OR (
          requested_expected_review_revision = 0 AND (
            latest_review.review_id IS NOT NULL
            OR requested_expected_previous_review_fingerprint_sha256 IS NOT NULL
            OR requested_effective_safety_state <>
              'AUTHENTICATED_FINALITY_RECORDED'
          )
        )
        OR (
          requested_expected_review_revision > 0 AND (
            latest_review.review_id IS NULL
            OR latest_review.review_revision <> requested_expected_review_revision
            OR latest_review.review_fingerprint_sha256 <>
              requested_expected_previous_review_fingerprint_sha256
            OR latest_review.terminal_event_revision <> current_event.revision
            OR latest_review.terminal_transition_fingerprint_sha256 <>
              current_event.transition_fingerprint_sha256
            OR latest_review.terminal_snapshot_sha256 <> current_event.snapshot_sha256
            OR latest_review.original_admission_fingerprint_sha256 <>
              original_admission.admission_fingerprint_sha256
            OR latest_review.chain_transaction_id <> current_event.chain_transaction_id
            OR latest_review.transaction_position <> current_event.transaction_position
            OR latest_review.transaction_block_id <> current_event.transaction_block_id
            OR latest_review.disposition NOT IN (
              'FINALITY_REAFFIRMED', 'REVIEW_INCONCLUSIVE'
            )
            OR (
              (latest_review.disposition = 'REVIEW_INCONCLUSIVE'
                AND requested_effective_safety_state <>
                  'POST_FINALITY_REVIEW_INCONCLUSIVE')
              OR
              (latest_review.disposition = 'FINALITY_REAFFIRMED'
                AND requested_effective_safety_state <>
                  'AUTHENTICATED_FINALITY_RECORDED')
            )
          )
        )
        OR database_verified_at >= requested_deadline_at
        OR database_verified_at >= chain_evidence_expires_at
        OR database_verified_at >= selected_source_authority.expires_at
        OR database_verified_at >= selected_deployment_authority.expires_at
      THEN
        RETURN;
      END IF;

      RETURN QUERY SELECT${COMMON_RESULT_PREFIX}
        current_event.transition_fingerprint_sha256,
        original_admission.admission_fingerprint_sha256,
        current_event.transaction_position,
        current_event.transaction_block_id,
        requested_expected_review_revision,
        requested_expected_previous_review_fingerprint_sha256,
        requested_effective_safety_state,
        database_verified_at;
    END;`;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `CREATE FUNCTION read_mainnet_financial_action_reconciliation_prerequisite_v1(
      ${RECONCILIATION_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${RESULT_COLUMNS})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RECONCILIATION_READ_BODY}$function$;

    CREATE FUNCTION read_mainnet_financial_action_post_finality_prerequisite_v1(
      ${POST_FINALITY_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${RESULT_COLUMNS})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE
    AS $function$${POST_FINALITY_READ_BODY}$function$;

    DO $set_mainnet_action_prerequisite_read_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECONCILIATION_READ_IDENTITY}
          SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${POST_FINALITY_READ_IDENTITY}
          SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_mainnet_action_prerequisite_read_paths$;

    REVOKE ALL ON FUNCTION ${RECONCILIATION_READ_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${POST_FINALITY_READ_IDENTITY} FROM ${guarded};`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `REVOKE ALL ON FUNCTION ${POST_FINALITY_READ_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECONCILIATION_READ_IDENTITY} FROM ${guarded};
    DROP FUNCTION ${POST_FINALITY_READ_IDENTITY};
    DROP FUNCTION ${RECONCILIATION_READ_IDENTITY};`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetFinancialActionAuthenticatedFinalityMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0035 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const expectations = [
    {
      identity: RECONCILIATION_READ_IDENTITY,
      body: RECONCILIATION_READ_BODY,
      arguments: RECONCILIATION_ARGUMENTS,
      strict: true,
    },
    {
      identity: POST_FINALITY_READ_IDENTITY,
      body: POST_FINALITY_READ_BODY,
      arguments: POST_FINALITY_ARGUMENTS,
      strict: false,
    },
  ] as const;
  const values = expectations
    .map(({ identity: functionIdentity, body, arguments: inputArguments, strict }) => {
      const inputNames = inputArguments.map(([name]) => `'${name}'`);
      const outputNames = RESULT_ARGUMENTS.map(([name]) => `'${name}'`);
      const inputTypes = inputArguments.map(
        ([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`,
      );
      const allTypes = [
        ...inputTypes,
        ...RESULT_ARGUMENTS.map(([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`),
      ];
      const modes = [
        ...inputArguments.map(() => `'i'::"char"`),
        ...RESULT_ARGUMENTS.map(() => `'t'::"char"`),
      ];
      return `('${functionIdentity}', '${sourceSha256(body)}', ${strict},
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
          AND procedure.proisstrict = expected.is_strict
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
          AND pg_catalog.pg_get_function_result(procedure.oid) =
            '${canonicalResult(RESULT_COLUMNS)}'
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
        function_identity, body_sha256, is_strict, argument_names,
        input_type_oids, all_type_oids, argument_modes
      )
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS function_state`;
}

export function createMainnetFinancialActionFinalityPrerequisiteReadMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0036',
    description: 'add owner-only dormant authenticated mainnet action finality prerequisite reads',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0035'],
  };
}

export const createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036 =
  createMainnetFinancialActionFinalityPrerequisiteReadMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
  );

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036 =
  createMainnetFinancialActionFinalityPrerequisiteReadMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
    { cumulativePrincipalVerification: false },
  );
