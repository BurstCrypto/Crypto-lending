import { createHash } from 'node:crypto';

import {
  createGenericWorkerBalanceAuthoritySuspensionMigration,
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const EVIDENCE_TABLE = 'provider_position_chain_anchor_evidence';
const CONTROL_TABLE = 'provider_position_chain_anchor_control_events';
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MAINNET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const EVIDENCE_USE = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_ONLY';
const ASSESSMENT_USE = 'DORMANT_PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_ONLY';
const CONTROL_USE = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_CONTROL_ONLY';
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

const ANCHOR_VALID = 'provider_position_chain_anchor_valid(text,jsonb)';
const EVIDENCE_FINGERPRINT =
  'provider_position_chain_anchor_evidence_fingerprint(text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone,jsonb,timestamp with time zone,text,text,text,text,text,text,text,text,text,timestamp with time zone)';
const READ_BINDING_FINGERPRINT =
  'provider_position_chain_anchor_read_binding_fingerprint(text,text,text,text,text,jsonb,jsonb,timestamp with time zone)';
const EVIDENCE_ROW_VALID =
  'provider_position_chain_anchor_evidence_row_valid(text,text,smallint,text,boolean,boolean,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone,jsonb,timestamp with time zone,text,text,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone)';
const CONTROL_ROW_VALID =
  'provider_position_chain_anchor_control_row_valid(uuid,smallint,text,text,text,text,boolean,timestamp with time zone)';
const HISTORY_GUARD = 'reject_provider_position_chain_anchor_history_mutation()';
const RECORD_EVIDENCE =
  'record_provider_position_chain_anchor_evidence(text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone,jsonb,timestamp with time zone,text,text,text,text,text,text,text,text,text,timestamp with time zone)';
const CONTROL_EVIDENCE = 'invalidate_provider_position_chain_anchor_evidence(uuid,text,text,text)';
const READ_EVIDENCE =
  'read_provider_position_chain_anchor_evidence(uuid,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)';
const ALL_FUNCTIONS = Object.freeze([
  ANCHOR_VALID,
  READ_BINDING_FINGERPRINT,
  EVIDENCE_FINGERPRINT,
  EVIDENCE_ROW_VALID,
  CONTROL_ROW_VALID,
  HISTORY_GUARD,
  RECORD_EVIDENCE,
  CONTROL_EVIDENCE,
  READ_EVIDENCE,
] as const);

// This is the exact API function allowlist produced by migration 0025. Later
// migrations 0026-0028 change worker authority only, so 0029 extends this one
// catalog allowance with its single read capability.
const PRIOR_API_FUNCTIONS = Object.freeze([
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
  'complete_auth_login_keyring(uuid,text,text,smallint,bytea,smallint[],text[],uuid,uuid,uuid,uuid,smallint,bytea,smallint,bytea,integer,integer,text,text,text,uuid)',
  'resolve_auth_session_keyring(uuid,smallint[],text[],boolean,smallint[],text[],uuid)',
  'rotate_auth_session_keyring(uuid,smallint[],text[],uuid,smallint,bytea,smallint,bytea,uuid)',
  'revoke_auth_session_keyring(uuid,smallint[],text[],uuid)',
  'consume_auth_rate_limit_keyring(text,smallint[],text[],integer,integer,uuid)',
] as const);

const EVIDENCE_MANIFEST =
  'crypto-lending:provider-position-chain-anchor-evidence:v1;global-chain-facts;no-wallet-pii;append-only';
const CONTROL_MANIFEST =
  'crypto-lending:provider-position-chain-anchor-control:v1;append-only;fail-closed';

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

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0029 predecessor verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function predecessorFunctionAllowance(role: string, functions: readonly string[]): string {
  return `            OR (
              grantee.rolname = ${role}
              AND procedure.oid IN (
                ${functions.map((value) => `to_regprocedure('${value}')`).join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
}

function functionAllowance(role: string, functions: readonly string[]): string {
  return `            OR (
              grantee.rolname = ${role}
              AND procedure.oid IN (
                ${functions
                  .map((value) => `pg_catalog.to_regprocedure('${value}')`)
                  .join(',\n                ')}
              )
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )`;
}

const ANCHOR_VALID_BODY = `
    SELECT COALESCE(CASE requested_network_id
      WHEN '${ETHEREUM}' THEN
        pg_catalog.jsonb_typeof(requested_anchor) = 'object'
        AND (SELECT pg_catalog.array_agg(key ORDER BY key COLLATE "C")
          FROM pg_catalog.jsonb_object_keys(requested_anchor) AS keys(key))
          = ARRAY['blockHash', 'blockNumber', 'kind']::text[]
        AND requested_anchor ->> 'kind' = 'EVM_BLOCK'
        AND requested_anchor ->> 'blockNumber' ~ '^(0|[1-9][0-9]{0,77})$'
        AND pg_catalog.length(requested_anchor ->> 'blockNumber') <= 78
        AND (requested_anchor ->> 'blockNumber')::numeric <= ${MAX_UINT256}
        AND requested_anchor ->> 'blockHash' ~ '^0x[0-9a-f]{64}$'
        AND requested_anchor ->> 'blockHash' <> '0x' || pg_catalog.repeat('0', 64)
      WHEN '${SOLANA}' THEN
        pg_catalog.jsonb_typeof(requested_anchor) = 'object'
        AND (SELECT pg_catalog.array_agg(key ORDER BY key COLLATE "C")
          FROM pg_catalog.jsonb_object_keys(requested_anchor) AS keys(key))
          = ARRAY['kind', 'root', 'slot']::text[]
        AND requested_anchor ->> 'kind' = 'SOLANA_SLOT'
        AND requested_anchor ->> 'slot' ~ '^(0|[1-9][0-9]{0,19})$'
        AND requested_anchor ->> 'root' ~ '^(0|[1-9][0-9]{0,19})$'
        AND (requested_anchor ->> 'slot')::numeric <= 18446744073709551615
        AND (requested_anchor ->> 'root')::numeric <=
          (requested_anchor ->> 'slot')::numeric
      ELSE false
    END, false);
    `;

const READ_BINDING_FINGERPRINT_BODY = `
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'crypto-lending:provider-position-chain-anchor-read-binding:v1',
          requested_network_id,
          requested_source_family_id,
          requested_source_id,
          requested_source_kind,
          requested_source_observation_id,
          requested_continuity_floor,
          requested_chain_anchor,
          pg_catalog.to_char(
            requested_observed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )::text,
        'UTF8'
      )),
      'hex'
    );
    `;

const EVIDENCE_FINGERPRINT_BODY = `
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'crypto-lending:provider-position-chain-anchor-evidence:v1',
          requested_network_id,
          requested_source_family_id,
          requested_source_id,
          requested_source_kind,
          requested_source_observation_id,
          requested_continuity_floor,
          requested_chain_anchor,
          pg_catalog.to_char(
            requested_observed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          pg_catalog.to_char(
            requested_assessed_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          requested_agreed_current_head,
          pg_catalog.to_char(
            requested_current_head_advanced_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          requested_agreed_finalized_head,
          pg_catalog.to_char(
            requested_finalized_head_advanced_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          requested_identity_proof_sha256,
          requested_live_capability_proof_sha256,
          requested_lineage_proof_sha256,
          requested_primary_source_family_id,
          requested_primary_source_id,
          requested_corroborating_source_family_id,
          requested_corroborating_source_id,
          requested_source_pair_approval_id,
          requested_source_pair_registry_fingerprint_sha256,
          pg_catalog.to_char(
            requested_source_pair_approval_expires_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )::text,
        'UTF8'
      )),
      'hex'
    );
    `;

const EVIDENCE_ROW_VALID_BODY = `
    SELECT
      requested_evidence_version = 1
      AND requested_evidence_use = '${EVIDENCE_USE}'
      AND requested_may_authorize_financial_action = false
      AND requested_may_persist = false
      AND requested_network_id IN ('${ETHEREUM}', '${SOLANA}')
      AND requested_source_kind IN ('RPC', 'INDEXER', 'PROVIDER_API')
      AND requested_identity_status = 'VERIFIED'
      AND requested_progression_status = 'CURRENT'
      AND requested_finality_status = 'HEALTHY'
      AND requested_evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_evidence_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_read_binding_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_read_binding_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_identity_proof_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_identity_proof_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_live_capability_proof_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_live_capability_proof_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_lineage_proof_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_lineage_proof_sha256 <> pg_catalog.repeat('0', 64)
      AND provider_position_chain_anchor_valid(
        requested_network_id, requested_continuity_floor
      )
      AND provider_position_chain_anchor_valid(requested_network_id, requested_chain_anchor)
      AND provider_position_chain_anchor_valid(
        requested_network_id, requested_agreed_current_head
      )
      AND provider_position_chain_anchor_valid(
        requested_network_id, requested_agreed_finalized_head
      )
      AND (
        (
          requested_network_id = '${ETHEREUM}'
          AND (
            (requested_chain_anchor ->> 'blockNumber')::numeric
              > (requested_continuity_floor ->> 'blockNumber')::numeric
            OR (
              requested_chain_anchor ->> 'blockNumber'
                = requested_continuity_floor ->> 'blockNumber'
              AND requested_chain_anchor ->> 'blockHash'
                = requested_continuity_floor ->> 'blockHash'
            )
          )
          AND (
            (requested_agreed_current_head ->> 'blockNumber')::numeric
              > (requested_chain_anchor ->> 'blockNumber')::numeric
            OR (
              requested_agreed_current_head ->> 'blockNumber'
                = requested_chain_anchor ->> 'blockNumber'
              AND requested_agreed_current_head ->> 'blockHash'
                = requested_chain_anchor ->> 'blockHash'
            )
          )
          AND (
            (requested_agreed_finalized_head ->> 'blockNumber')::numeric
              < (requested_agreed_current_head ->> 'blockNumber')::numeric
            OR (
              requested_agreed_finalized_head ->> 'blockNumber'
                = requested_agreed_current_head ->> 'blockNumber'
              AND requested_agreed_finalized_head ->> 'blockHash'
                = requested_agreed_current_head ->> 'blockHash'
            )
          )
        )
        OR (
          requested_network_id = '${SOLANA}'
          AND (requested_chain_anchor ->> 'slot')::numeric
            >= (requested_continuity_floor ->> 'slot')::numeric
          AND (requested_chain_anchor ->> 'root')::numeric
            >= (requested_continuity_floor ->> 'root')::numeric
          AND (requested_agreed_current_head ->> 'slot')::numeric
            >= (requested_chain_anchor ->> 'slot')::numeric
          AND (requested_agreed_current_head ->> 'root')::numeric
            >= (requested_chain_anchor ->> 'root')::numeric
          AND (requested_agreed_finalized_head ->> 'slot')::numeric
            <= (requested_agreed_current_head ->> 'slot')::numeric
          AND (requested_agreed_finalized_head ->> 'root')::numeric
            <= (requested_agreed_current_head ->> 'root')::numeric
        )
      )
      AND pg_catalog.isfinite(requested_observed_at)
      AND pg_catalog.isfinite(requested_assessed_at)
      AND pg_catalog.isfinite(requested_current_head_advanced_at)
      AND pg_catalog.isfinite(requested_finalized_head_advanced_at)
      AND pg_catalog.isfinite(requested_source_pair_approval_expires_at)
      AND pg_catalog.isfinite(requested_recorded_at)
      AND pg_catalog.date_trunc('milliseconds', requested_observed_at)
        = requested_observed_at
      AND pg_catalog.date_trunc('milliseconds', requested_assessed_at)
        = requested_assessed_at
      AND pg_catalog.date_trunc('milliseconds', requested_current_head_advanced_at)
        = requested_current_head_advanced_at
      AND pg_catalog.date_trunc('milliseconds', requested_finalized_head_advanced_at)
        = requested_finalized_head_advanced_at
      AND pg_catalog.date_trunc('milliseconds', requested_source_pair_approval_expires_at)
        = requested_source_pair_approval_expires_at
      AND pg_catalog.date_trunc('milliseconds', requested_recorded_at) = requested_recorded_at
      AND requested_observed_at <= requested_assessed_at
      AND requested_current_head_advanced_at <= requested_assessed_at
      AND requested_finalized_head_advanced_at <= requested_assessed_at
      AND requested_assessed_at <= requested_recorded_at
      AND requested_recorded_at < requested_source_pair_approval_expires_at
      AND requested_source_family_id
        ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
      AND requested_source_id ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
      AND requested_source_observation_id
        ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$'
      AND (
        (
          requested_network_id = '${ETHEREUM}'
          AND requested_source_observation_id = 'ethereum-block-'
            || (requested_chain_anchor ->> 'blockNumber')
        )
        OR (
          requested_network_id = '${SOLANA}'
          AND requested_source_observation_id = 'solana-slot-'
            || (requested_chain_anchor ->> 'slot')
        )
      )
      AND requested_primary_source_family_id
        ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
      AND requested_primary_source_id
        ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
      AND requested_corroborating_source_family_id
        ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
      AND requested_corroborating_source_id
        ~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
      AND requested_primary_source_family_id <> requested_corroborating_source_family_id
      AND requested_primary_source_id <> requested_corroborating_source_id
      AND ROW(
        requested_primary_source_family_id COLLATE "C",
        requested_primary_source_id COLLATE "C"
      ) < ROW(
        requested_corroborating_source_family_id COLLATE "C",
        requested_corroborating_source_id COLLATE "C"
      )
      AND (
        (
          requested_source_family_id = requested_primary_source_family_id
          AND requested_source_id = requested_primary_source_id
        )
        OR (
          requested_source_family_id = requested_corroborating_source_family_id
          AND requested_source_id = requested_corroborating_source_id
        )
      )
      AND requested_source_pair_approval_id
        ~ '^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$'
      AND requested_source_pair_registry_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_source_pair_registry_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_read_binding_fingerprint_sha256 =
        provider_position_chain_anchor_read_binding_fingerprint(
          requested_network_id,
          requested_source_family_id,
          requested_source_id,
          requested_source_kind,
          requested_source_observation_id,
          requested_continuity_floor,
          requested_chain_anchor,
          requested_observed_at
        )
      AND requested_evidence_fingerprint_sha256 =
        provider_position_chain_anchor_evidence_fingerprint(
          requested_network_id,
          requested_source_family_id,
          requested_source_id,
          requested_source_kind,
          requested_source_observation_id,
          requested_continuity_floor,
          requested_chain_anchor,
          requested_observed_at,
          requested_assessed_at,
          requested_agreed_current_head,
          requested_current_head_advanced_at,
          requested_agreed_finalized_head,
          requested_finalized_head_advanced_at,
          requested_identity_proof_sha256,
          requested_live_capability_proof_sha256,
          requested_lineage_proof_sha256,
          requested_primary_source_family_id,
          requested_primary_source_id,
          requested_corroborating_source_family_id,
          requested_corroborating_source_id,
          requested_source_pair_approval_id,
          requested_source_pair_registry_fingerprint_sha256,
          requested_source_pair_approval_expires_at
        );
    `;

const CONTROL_ROW_VALID_BODY = `
    SELECT
      pg_catalog.substring(requested_event_id::text, 15, 1) = '4'
      AND pg_catalog.substring(requested_event_id::text, 20, 1) IN ('8', '9', 'a', 'b')
      AND requested_event_version = 1
      AND requested_event_use = '${CONTROL_USE}'
      AND requested_evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_evidence_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_control_action IN ('INVALIDATED', 'QUARANTINED')
      AND requested_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
      AND requested_active_control = true
      AND pg_catalog.isfinite(requested_recorded_at)
      AND pg_catalog.date_trunc('milliseconds', requested_recorded_at) = requested_recorded_at;
    `;

const EVIDENCE_ROW_VALID_CALL = `provider_position_chain_anchor_evidence_row_valid(
          evidence_fingerprint_sha256,
          read_binding_fingerprint_sha256,
          evidence_version,
          evidence_use,
          may_authorize_financial_action,
          may_persist,
          network_id,
          source_family_id,
          source_id,
          source_kind,
          source_observation_id,
          continuity_floor,
          chain_anchor,
          observed_at,
          assessed_at,
          agreed_current_head,
          current_head_advanced_at,
          agreed_finalized_head,
          finalized_head_advanced_at,
          identity_proof_sha256,
          live_capability_proof_sha256,
          lineage_proof_sha256,
          identity_status,
          progression_status,
          finality_status,
          primary_source_family_id,
          primary_source_id,
          corroborating_source_family_id,
          corroborating_source_id,
          source_pair_approval_id,
          source_pair_registry_fingerprint_sha256,
          source_pair_approval_expires_at,
          recorded_at
        )`;

const CONTROL_ROW_VALID_CALL = `provider_position_chain_anchor_control_row_valid(
          event_id,
          event_version,
          event_use,
          evidence_fingerprint_sha256,
          control_action,
          reason_code,
          active_control,
          recorded_at
        )`;
const EVIDENCE_ROW_VALID_CALL_COMPACT = `${EVIDENCE_ROW_VALID_CALL} IS TRUE`.replace(/\s+/gu, '');
const CONTROL_ROW_VALID_CALL_COMPACT = `${CONTROL_ROW_VALID_CALL} IS TRUE`.replace(/\s+/gu, '');

const HISTORY_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'provider position chain anchor history is append-only'
        USING ERRCODE = '55000';
    END;
    `;

const RECORD_EVIDENCE_BODY = `
    DECLARE
      prior provider_position_chain_anchor_evidence%ROWTYPE;
      requested_read_binding_fingerprint text;
      requested_fingerprint text;
      database_recorded_at timestamptz;
    BEGIN
      IF requested_network_id NOT IN ('${ETHEREUM}', '${SOLANA}')
        OR requested_source_family_id !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_source_id !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_source_kind NOT IN ('RPC', 'INDEXER', 'PROVIDER_API')
        OR requested_source_observation_id
          !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$'
        OR NOT provider_position_chain_anchor_valid(
          requested_network_id, requested_continuity_floor
        )
        OR NOT provider_position_chain_anchor_valid(
          requested_network_id, requested_chain_anchor
        )
        OR NOT provider_position_chain_anchor_valid(
          requested_network_id, requested_agreed_current_head
        )
        OR NOT provider_position_chain_anchor_valid(
          requested_network_id, requested_agreed_finalized_head
        )
        OR NOT (
          (
            requested_network_id = '${ETHEREUM}'
            AND requested_source_observation_id = 'ethereum-block-'
              || (requested_chain_anchor ->> 'blockNumber')
          )
          OR (
            requested_network_id = '${SOLANA}'
            AND requested_source_observation_id = 'solana-slot-'
              || (requested_chain_anchor ->> 'slot')
          )
        )
        OR requested_observed_at IS NULL
        OR requested_assessed_at IS NULL
        OR requested_current_head_advanced_at IS NULL
        OR requested_finalized_head_advanced_at IS NULL
        OR requested_source_pair_approval_expires_at IS NULL
        OR NOT pg_catalog.isfinite(requested_observed_at)
        OR NOT pg_catalog.isfinite(requested_assessed_at)
        OR NOT pg_catalog.isfinite(requested_current_head_advanced_at)
        OR NOT pg_catalog.isfinite(requested_finalized_head_advanced_at)
        OR NOT pg_catalog.isfinite(requested_source_pair_approval_expires_at)
        OR pg_catalog.date_trunc('milliseconds', requested_observed_at)
          <> requested_observed_at
        OR pg_catalog.date_trunc('milliseconds', requested_assessed_at)
          <> requested_assessed_at
        OR pg_catalog.date_trunc('milliseconds', requested_current_head_advanced_at)
          <> requested_current_head_advanced_at
        OR pg_catalog.date_trunc('milliseconds', requested_finalized_head_advanced_at)
          <> requested_finalized_head_advanced_at
        OR pg_catalog.date_trunc('milliseconds', requested_source_pair_approval_expires_at)
          <> requested_source_pair_approval_expires_at
        OR requested_observed_at > requested_assessed_at
        OR requested_current_head_advanced_at > requested_assessed_at
        OR requested_finalized_head_advanced_at > requested_assessed_at
        OR requested_assessed_at >= requested_source_pair_approval_expires_at
        OR requested_identity_proof_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_identity_proof_sha256 = pg_catalog.repeat('0', 64)
        OR requested_live_capability_proof_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_live_capability_proof_sha256 = pg_catalog.repeat('0', 64)
        OR requested_lineage_proof_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_lineage_proof_sha256 = pg_catalog.repeat('0', 64)
        OR requested_primary_source_family_id
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_primary_source_id
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_corroborating_source_family_id
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_corroborating_source_id
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_primary_source_family_id = requested_corroborating_source_family_id
        OR requested_primary_source_id = requested_corroborating_source_id
        OR ROW(
          requested_primary_source_family_id COLLATE "C",
          requested_primary_source_id COLLATE "C"
        ) >= ROW(
          requested_corroborating_source_family_id COLLATE "C",
          requested_corroborating_source_id COLLATE "C"
        )
        OR NOT (
          (
            requested_source_family_id = requested_primary_source_family_id
            AND requested_source_id = requested_primary_source_id
          )
          OR (
            requested_source_family_id = requested_corroborating_source_family_id
            AND requested_source_id = requested_corroborating_source_id
          )
        )
        OR requested_source_pair_approval_id
          !~ '^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$'
        OR requested_source_pair_registry_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_source_pair_registry_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR (
          requested_network_id = '${ETHEREUM}'
          AND NOT (
            (requested_chain_anchor ->> 'blockNumber')::numeric
              > (requested_continuity_floor ->> 'blockNumber')::numeric
            OR (
              requested_chain_anchor ->> 'blockNumber'
                = requested_continuity_floor ->> 'blockNumber'
              AND requested_chain_anchor ->> 'blockHash'
                = requested_continuity_floor ->> 'blockHash'
            )
          )
        )
        OR (
          requested_network_id = '${ETHEREUM}'
          AND NOT (
            (
              (requested_agreed_current_head ->> 'blockNumber')::numeric
                > (requested_chain_anchor ->> 'blockNumber')::numeric
              OR (
                requested_agreed_current_head ->> 'blockNumber'
                  = requested_chain_anchor ->> 'blockNumber'
                AND requested_agreed_current_head ->> 'blockHash'
                  = requested_chain_anchor ->> 'blockHash'
              )
            )
            AND (
              (requested_agreed_finalized_head ->> 'blockNumber')::numeric
                < (requested_agreed_current_head ->> 'blockNumber')::numeric
              OR (
                requested_agreed_finalized_head ->> 'blockNumber'
                  = requested_agreed_current_head ->> 'blockNumber'
                AND requested_agreed_finalized_head ->> 'blockHash'
                  = requested_agreed_current_head ->> 'blockHash'
              )
            )
          )
        )
        OR (
          requested_network_id = '${SOLANA}'
          AND (
            (requested_chain_anchor ->> 'slot')::numeric
              < (requested_continuity_floor ->> 'slot')::numeric
            OR (requested_chain_anchor ->> 'root')::numeric
              < (requested_continuity_floor ->> 'root')::numeric
            OR (requested_agreed_current_head ->> 'slot')::numeric
              < (requested_chain_anchor ->> 'slot')::numeric
            OR (requested_agreed_current_head ->> 'root')::numeric
              < (requested_chain_anchor ->> 'root')::numeric
            OR (requested_agreed_finalized_head ->> 'slot')::numeric
              > (requested_agreed_current_head ->> 'slot')::numeric
            OR (requested_agreed_finalized_head ->> 'root')::numeric
              > (requested_agreed_current_head ->> 'root')::numeric
          )
        )
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor evidence'
          USING ERRCODE = '22023';
      END IF;

      requested_read_binding_fingerprint :=
        provider_position_chain_anchor_read_binding_fingerprint(
          requested_network_id,
          requested_source_family_id,
          requested_source_id,
          requested_source_kind,
          requested_source_observation_id,
          requested_continuity_floor,
          requested_chain_anchor,
          requested_observed_at
        );
      requested_fingerprint := provider_position_chain_anchor_evidence_fingerprint(
        requested_network_id,
        requested_source_family_id,
        requested_source_id,
        requested_source_kind,
        requested_source_observation_id,
        requested_continuity_floor,
        requested_chain_anchor,
        requested_observed_at,
        requested_assessed_at,
        requested_agreed_current_head,
        requested_current_head_advanced_at,
        requested_agreed_finalized_head,
        requested_finalized_head_advanced_at,
        requested_identity_proof_sha256,
        requested_live_capability_proof_sha256,
        requested_lineage_proof_sha256,
        requested_primary_source_family_id,
        requested_primary_source_id,
        requested_corroborating_source_family_id,
        requested_corroborating_source_id,
        requested_source_pair_approval_id,
        requested_source_pair_registry_fingerprint_sha256,
        requested_source_pair_approval_expires_at
      );
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_read_binding_fingerprint, 56029)
      );

      SELECT evidence.* INTO prior
      FROM provider_position_chain_anchor_evidence AS evidence
      WHERE evidence.read_binding_fingerprint_sha256 = requested_read_binding_fingerprint
      FOR UPDATE;
      IF FOUND THEN
        IF prior.evidence_fingerprint_sha256 IS DISTINCT FROM requested_fingerprint
          OR prior.network_id IS DISTINCT FROM requested_network_id
          OR prior.source_family_id IS DISTINCT FROM requested_source_family_id
          OR prior.source_id IS DISTINCT FROM requested_source_id
          OR prior.source_kind IS DISTINCT FROM requested_source_kind
          OR prior.source_observation_id IS DISTINCT FROM requested_source_observation_id
          OR prior.continuity_floor IS DISTINCT FROM requested_continuity_floor
          OR prior.chain_anchor IS DISTINCT FROM requested_chain_anchor
          OR prior.observed_at IS DISTINCT FROM requested_observed_at
          OR prior.assessed_at IS DISTINCT FROM requested_assessed_at
          OR prior.agreed_current_head IS DISTINCT FROM requested_agreed_current_head
          OR prior.current_head_advanced_at
            IS DISTINCT FROM requested_current_head_advanced_at
          OR prior.agreed_finalized_head IS DISTINCT FROM requested_agreed_finalized_head
          OR prior.finalized_head_advanced_at
            IS DISTINCT FROM requested_finalized_head_advanced_at
          OR prior.identity_proof_sha256 IS DISTINCT FROM requested_identity_proof_sha256
          OR prior.live_capability_proof_sha256
            IS DISTINCT FROM requested_live_capability_proof_sha256
          OR prior.lineage_proof_sha256 IS DISTINCT FROM requested_lineage_proof_sha256
          OR prior.primary_source_family_id IS DISTINCT FROM requested_primary_source_family_id
          OR prior.primary_source_id IS DISTINCT FROM requested_primary_source_id
          OR prior.corroborating_source_family_id
            IS DISTINCT FROM requested_corroborating_source_family_id
          OR prior.corroborating_source_id IS DISTINCT FROM requested_corroborating_source_id
          OR prior.source_pair_approval_id IS DISTINCT FROM requested_source_pair_approval_id
          OR prior.source_pair_registry_fingerprint_sha256
            IS DISTINCT FROM requested_source_pair_registry_fingerprint_sha256
          OR prior.source_pair_approval_expires_at
            IS DISTINCT FROM requested_source_pair_approval_expires_at
        THEN
          RAISE EXCEPTION 'provider position chain anchor evidence replay conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior.evidence_fingerprint_sha256, prior.recorded_at;
        RETURN;
      END IF;

      database_recorded_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF requested_assessed_at > database_recorded_at
        OR database_recorded_at >= requested_source_pair_approval_expires_at
        OR database_recorded_at >= requested_current_head_advanced_at + CASE
          WHEN requested_network_id = '${ETHEREUM}' THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END
        OR database_recorded_at >= requested_finalized_head_advanced_at + CASE
          WHEN requested_network_id = '${ETHEREUM}' THEN interval '1800 seconds'
          ELSE interval '90 seconds'
        END
      THEN
        RAISE EXCEPTION 'provider position chain anchor evidence is not current'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO provider_position_chain_anchor_evidence (
        evidence_fingerprint_sha256,
        read_binding_fingerprint_sha256,
        evidence_version,
        evidence_use,
        may_authorize_financial_action,
        may_persist,
        network_id,
        source_family_id,
        source_id,
        source_kind,
        source_observation_id,
        continuity_floor,
        chain_anchor,
        observed_at,
        assessed_at,
        agreed_current_head,
        current_head_advanced_at,
        agreed_finalized_head,
        finalized_head_advanced_at,
        identity_proof_sha256,
        live_capability_proof_sha256,
        lineage_proof_sha256,
        identity_status,
        progression_status,
        finality_status,
        primary_source_family_id,
        primary_source_id,
        corroborating_source_family_id,
        corroborating_source_id,
        source_pair_approval_id,
        source_pair_registry_fingerprint_sha256,
        source_pair_approval_expires_at,
        recorded_at
      ) VALUES (
        requested_fingerprint,
        requested_read_binding_fingerprint,
        1,
        '${EVIDENCE_USE}',
        false,
        false,
        requested_network_id,
        requested_source_family_id,
        requested_source_id,
        requested_source_kind,
        requested_source_observation_id,
        requested_continuity_floor,
        requested_chain_anchor,
        requested_observed_at,
        requested_assessed_at,
        requested_agreed_current_head,
        requested_current_head_advanced_at,
        requested_agreed_finalized_head,
        requested_finalized_head_advanced_at,
        requested_identity_proof_sha256,
        requested_live_capability_proof_sha256,
        requested_lineage_proof_sha256,
        'VERIFIED',
        'CURRENT',
        'HEALTHY',
        requested_primary_source_family_id,
        requested_primary_source_id,
        requested_corroborating_source_family_id,
        requested_corroborating_source_id,
        requested_source_pair_approval_id,
        requested_source_pair_registry_fingerprint_sha256,
        requested_source_pair_approval_expires_at,
        database_recorded_at
      );

      RETURN QUERY SELECT 'RECORDED'::text, requested_fingerprint, database_recorded_at;
    END;
    `;

const CONTROL_EVIDENCE_BODY = `
    DECLARE
      prior provider_position_chain_anchor_control_events%ROWTYPE;
      locked_fingerprint text;
      database_recorded_at timestamptz;
    BEGIN
      IF pg_catalog.substring(requested_event_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_event_id::text, 20, 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_evidence_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_evidence_fingerprint_sha256 = pg_catalog.repeat('0', 64)
        OR requested_control_action NOT IN ('INVALIDATED', 'QUARANTINED')
        OR requested_reason_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor control event'
          USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_event_id::text, 56030)
      );
      SELECT event.* INTO prior
      FROM provider_position_chain_anchor_control_events AS event
      WHERE event.event_id = requested_event_id
      FOR UPDATE;
      IF FOUND THEN
        IF prior.evidence_fingerprint_sha256
            IS DISTINCT FROM requested_evidence_fingerprint_sha256
          OR prior.control_action IS DISTINCT FROM requested_control_action
          OR prior.reason_code IS DISTINCT FROM requested_reason_code
        THEN
          RAISE EXCEPTION 'provider position chain anchor control replay conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text, prior.event_id, prior.recorded_at;
        RETURN;
      END IF;

      SELECT evidence.evidence_fingerprint_sha256 INTO locked_fingerprint
      FROM provider_position_chain_anchor_evidence AS evidence
      WHERE evidence.evidence_fingerprint_sha256 = requested_evidence_fingerprint_sha256
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider position chain anchor evidence does not exist'
          USING ERRCODE = '23503';
      END IF;

      database_recorded_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      INSERT INTO provider_position_chain_anchor_control_events (
        event_id,
        event_version,
        event_use,
        evidence_fingerprint_sha256,
        control_action,
        reason_code,
        active_control,
        recorded_at
      ) VALUES (
        requested_event_id,
        1,
        '${CONTROL_USE}',
        locked_fingerprint,
        requested_control_action,
        requested_reason_code,
        true,
        database_recorded_at
      );
      RETURN QUERY SELECT 'RECORDED'::text, requested_event_id, database_recorded_at;
    END;
    `;

const READ_EVIDENCE_BODY = `
    DECLARE
      selected_evidence provider_position_chain_anchor_evidence%ROWTYPE;
      requested_chain_namespace text;
      requested_chain_reference text;
      requested_read_binding_fingerprint text;
      database_read_at timestamptz;
    BEGIN
      database_read_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR pg_catalog.substring(requested_account_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_account_id::text, 20, 1) NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.substring(requested_wallet_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_wallet_id::text, 20, 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_network_id NOT IN ('${ETHEREUM}', '${SOLANA}')
        OR requested_source_family_id !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_source_id !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR requested_source_kind NOT IN ('RPC', 'INDEXER', 'PROVIDER_API')
        OR requested_source_observation_id
          !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$'
        OR NOT provider_position_chain_anchor_valid(
          requested_network_id, requested_continuity_floor
        )
        OR NOT provider_position_chain_anchor_valid(requested_network_id, requested_chain_anchor)
        OR NOT (
          (
            requested_network_id = '${ETHEREUM}'
            AND requested_source_observation_id = 'ethereum-block-'
              || (requested_chain_anchor ->> 'blockNumber')
          )
          OR (
            requested_network_id = '${SOLANA}'
            AND requested_source_observation_id = 'solana-slot-'
              || (requested_chain_anchor ->> 'slot')
          )
        )
        OR NOT pg_catalog.isfinite(requested_observed_at)
        OR NOT pg_catalog.isfinite(requested_captured_at)
        OR NOT pg_catalog.isfinite(requested_evaluated_at)
        OR NOT pg_catalog.isfinite(requested_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_observed_at)
          <> requested_observed_at
        OR pg_catalog.date_trunc('milliseconds', requested_captured_at)
          <> requested_captured_at
        OR pg_catalog.date_trunc('milliseconds', requested_evaluated_at)
          <> requested_evaluated_at
        OR pg_catalog.date_trunc('milliseconds', requested_deadline_at)
          <> requested_deadline_at
        OR requested_observed_at > requested_captured_at
        OR requested_captured_at > requested_evaluated_at
        OR requested_evaluated_at >= requested_deadline_at
        OR requested_deadline_at > requested_evaluated_at + interval '30 seconds'
        OR requested_evaluated_at > database_read_at
        OR database_read_at >= requested_deadline_at
        OR (
          requested_network_id = '${ETHEREUM}'
          AND NOT (
            (requested_chain_anchor ->> 'blockNumber')::numeric
              > (requested_continuity_floor ->> 'blockNumber')::numeric
            OR (
              requested_chain_anchor ->> 'blockNumber'
                = requested_continuity_floor ->> 'blockNumber'
              AND requested_chain_anchor ->> 'blockHash'
                = requested_continuity_floor ->> 'blockHash'
            )
          )
        )
        OR (
          requested_network_id = '${SOLANA}'
          AND (
            (requested_chain_anchor ->> 'slot')::numeric
              < (requested_continuity_floor ->> 'slot')::numeric
            OR (requested_chain_anchor ->> 'root')::numeric
              < (requested_continuity_floor ->> 'root')::numeric
          )
        )
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor evidence read'
          USING ERRCODE = '22023';
      END IF;

      requested_chain_namespace := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN 'eip155' ELSE 'solana' END;
      requested_chain_reference := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN '1'
        ELSE '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' END;

      -- This is the same account lock used by revoke_wallet_registration.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56001)
      );
      PERFORM 1
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
        AND wallet.chain_namespace = requested_chain_namespace
        AND wallet.chain_reference = requested_chain_reference
        AND wallet.status = 'ACTIVE'
        AND wallet.revoked_at IS NULL
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${MAINNET_REGISTRY_FINGERPRINT}'
      FOR UPDATE OF wallet;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider position chain anchor read requires an active chain-bound wallet'
          USING ERRCODE = '42501';
      END IF;

      database_read_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF database_read_at >= requested_deadline_at THEN
        RETURN;
      END IF;

      requested_read_binding_fingerprint :=
        provider_position_chain_anchor_read_binding_fingerprint(
          requested_network_id,
          requested_source_family_id,
          requested_source_id,
          requested_source_kind,
          requested_source_observation_id,
          requested_continuity_floor,
          requested_chain_anchor,
          requested_observed_at
        );

      BEGIN
        SELECT evidence.* INTO STRICT selected_evidence
        FROM provider_position_chain_anchor_evidence AS evidence
        WHERE evidence.read_binding_fingerprint_sha256 = requested_read_binding_fingerprint
          AND evidence.network_id = requested_network_id
          AND evidence.source_family_id = requested_source_family_id
          AND evidence.source_id = requested_source_id
          AND evidence.source_kind = requested_source_kind
          AND evidence.source_observation_id = requested_source_observation_id
          AND evidence.continuity_floor = requested_continuity_floor
          AND evidence.chain_anchor = requested_chain_anchor
          AND evidence.observed_at = requested_observed_at
          AND evidence.assessed_at >= requested_observed_at
          AND evidence.assessed_at <= requested_captured_at
          AND evidence.recorded_at <= requested_evaluated_at
          AND requested_evaluated_at < evidence.source_pair_approval_expires_at
          AND database_read_at < evidence.source_pair_approval_expires_at
          AND requested_evaluated_at < evidence.current_head_advanced_at + CASE
            WHEN requested_network_id = '${ETHEREUM}' THEN interval '60 seconds'
            ELSE interval '15 seconds'
          END
          AND database_read_at < evidence.current_head_advanced_at + CASE
            WHEN requested_network_id = '${ETHEREUM}' THEN interval '60 seconds'
            ELSE interval '15 seconds'
          END
          AND requested_evaluated_at < evidence.finalized_head_advanced_at + CASE
            WHEN requested_network_id = '${ETHEREUM}' THEN interval '1800 seconds'
            ELSE interval '90 seconds'
          END
          AND database_read_at < evidence.finalized_head_advanced_at + CASE
            WHEN requested_network_id = '${ETHEREUM}' THEN interval '1800 seconds'
            ELSE interval '90 seconds'
          END
          AND evidence.identity_proof_sha256 ~ '^[0-9a-f]{64}$'
          AND evidence.identity_proof_sha256 <> pg_catalog.repeat('0', 64)
          AND evidence.live_capability_proof_sha256 ~ '^[0-9a-f]{64}$'
          AND evidence.live_capability_proof_sha256 <> pg_catalog.repeat('0', 64)
          AND evidence.lineage_proof_sha256 ~ '^[0-9a-f]{64}$'
          AND evidence.lineage_proof_sha256 <> pg_catalog.repeat('0', 64)
          AND provider_position_chain_anchor_valid(
            evidence.network_id, evidence.agreed_current_head
          )
          AND provider_position_chain_anchor_valid(
            evidence.network_id, evidence.agreed_finalized_head
          )
          AND ROW(
            evidence.primary_source_family_id COLLATE "C",
            evidence.primary_source_id COLLATE "C"
          ) < ROW(
            evidence.corroborating_source_family_id COLLATE "C",
            evidence.corroborating_source_id COLLATE "C"
          )
          AND (
            (
              evidence.source_family_id = evidence.primary_source_family_id
              AND evidence.source_id = evidence.primary_source_id
            )
            OR (
              evidence.source_family_id = evidence.corroborating_source_family_id
              AND evidence.source_id = evidence.corroborating_source_id
            )
          )
          AND (
            (
              evidence.network_id = '${ETHEREUM}'
              AND (
                (evidence.agreed_current_head ->> 'blockNumber')::numeric
                  > (evidence.chain_anchor ->> 'blockNumber')::numeric
                OR (
                  evidence.agreed_current_head ->> 'blockNumber'
                    = evidence.chain_anchor ->> 'blockNumber'
                  AND evidence.agreed_current_head ->> 'blockHash'
                    = evidence.chain_anchor ->> 'blockHash'
                )
              )
              AND (
                (evidence.agreed_finalized_head ->> 'blockNumber')::numeric
                  < (evidence.agreed_current_head ->> 'blockNumber')::numeric
                OR (
                  evidence.agreed_finalized_head ->> 'blockNumber'
                    = evidence.agreed_current_head ->> 'blockNumber'
                  AND evidence.agreed_finalized_head ->> 'blockHash'
                    = evidence.agreed_current_head ->> 'blockHash'
                )
              )
            )
            OR (
              evidence.network_id = '${SOLANA}'
              AND (evidence.agreed_current_head ->> 'slot')::numeric
                >= (evidence.chain_anchor ->> 'slot')::numeric
              AND (evidence.agreed_current_head ->> 'root')::numeric
                >= (evidence.chain_anchor ->> 'root')::numeric
              AND (evidence.agreed_finalized_head ->> 'slot')::numeric
                <= (evidence.agreed_current_head ->> 'slot')::numeric
              AND (evidence.agreed_finalized_head ->> 'root')::numeric
                <= (evidence.agreed_current_head ->> 'root')::numeric
            )
          )
          AND evidence.identity_status = 'VERIFIED'
          AND evidence.progression_status = 'CURRENT'
          AND evidence.finality_status = 'HEALTHY'
        FOR SHARE OF evidence;
      EXCEPTION
        WHEN NO_DATA_FOUND THEN
          RETURN;
        WHEN TOO_MANY_ROWS THEN
          RAISE EXCEPTION 'ambiguous provider position chain anchor evidence read'
            USING ERRCODE = '21000';
      END;

      database_read_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF database_read_at >= requested_deadline_at
        OR database_read_at >= selected_evidence.source_pair_approval_expires_at
        OR database_read_at >= selected_evidence.current_head_advanced_at + CASE
          WHEN requested_network_id = '${ETHEREUM}' THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END
        OR database_read_at >= selected_evidence.finalized_head_advanced_at + CASE
          WHEN requested_network_id = '${ETHEREUM}' THEN interval '1800 seconds'
          ELSE interval '90 seconds'
        END
      THEN
        RETURN;
      END IF;

      -- The share lock gives this read a total order with owner invalidation.
      IF EXISTS (
        SELECT 1
        FROM provider_position_chain_anchor_control_events AS control
        WHERE control.evidence_fingerprint_sha256 =
            selected_evidence.evidence_fingerprint_sha256
          AND control.active_control
          AND control.control_action IN ('INVALIDATED', 'QUARANTINED')
      ) THEN
        RETURN;
      END IF;

      database_read_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF database_read_at >= requested_deadline_at
        OR database_read_at >= selected_evidence.source_pair_approval_expires_at
        OR database_read_at >= selected_evidence.current_head_advanced_at + CASE
          WHEN requested_network_id = '${ETHEREUM}' THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END
        OR database_read_at >= selected_evidence.finalized_head_advanced_at + CASE
          WHEN requested_network_id = '${ETHEREUM}' THEN interval '1800 seconds'
          ELSE interval '90 seconds'
        END
      THEN
        RETURN;
      END IF;

      RETURN QUERY SELECT
        1::smallint,
        '${ASSESSMENT_USE}'::text,
        false,
        false,
        selected_evidence.network_id,
        selected_evidence.continuity_floor,
        selected_evidence.chain_anchor,
        selected_evidence.assessed_at,
        selected_evidence.identity_status,
        selected_evidence.progression_status,
        selected_evidence.finality_status;
    END;
    `;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `CREATE FUNCTION provider_position_chain_anchor_valid(
      requested_network_id text,
      requested_anchor jsonb
    ) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${ANCHOR_VALID_BODY}$function$;

    CREATE FUNCTION provider_position_chain_anchor_read_binding_fingerprint(
      requested_network_id text,
      requested_source_family_id text,
      requested_source_id text,
      requested_source_kind text,
      requested_source_observation_id text,
      requested_continuity_floor jsonb,
      requested_chain_anchor jsonb,
      requested_observed_at timestamptz
    ) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${READ_BINDING_FINGERPRINT_BODY}$function$;

    CREATE FUNCTION provider_position_chain_anchor_evidence_fingerprint(
      requested_network_id text,
      requested_source_family_id text,
      requested_source_id text,
      requested_source_kind text,
      requested_source_observation_id text,
      requested_continuity_floor jsonb,
      requested_chain_anchor jsonb,
      requested_observed_at timestamptz,
      requested_assessed_at timestamptz,
      requested_agreed_current_head jsonb,
      requested_current_head_advanced_at timestamptz,
      requested_agreed_finalized_head jsonb,
      requested_finalized_head_advanced_at timestamptz,
      requested_identity_proof_sha256 text,
      requested_live_capability_proof_sha256 text,
      requested_lineage_proof_sha256 text,
      requested_primary_source_family_id text,
      requested_primary_source_id text,
      requested_corroborating_source_family_id text,
      requested_corroborating_source_id text,
      requested_source_pair_approval_id text,
      requested_source_pair_registry_fingerprint_sha256 text,
      requested_source_pair_approval_expires_at timestamptz
    ) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${EVIDENCE_FINGERPRINT_BODY}$function$;

    CREATE FUNCTION provider_position_chain_anchor_evidence_row_valid(
      requested_evidence_fingerprint_sha256 text,
      requested_read_binding_fingerprint_sha256 text,
      requested_evidence_version smallint,
      requested_evidence_use text,
      requested_may_authorize_financial_action boolean,
      requested_may_persist boolean,
      requested_network_id text,
      requested_source_family_id text,
      requested_source_id text,
      requested_source_kind text,
      requested_source_observation_id text,
      requested_continuity_floor jsonb,
      requested_chain_anchor jsonb,
      requested_observed_at timestamptz,
      requested_assessed_at timestamptz,
      requested_agreed_current_head jsonb,
      requested_current_head_advanced_at timestamptz,
      requested_agreed_finalized_head jsonb,
      requested_finalized_head_advanced_at timestamptz,
      requested_identity_proof_sha256 text,
      requested_live_capability_proof_sha256 text,
      requested_lineage_proof_sha256 text,
      requested_identity_status text,
      requested_progression_status text,
      requested_finality_status text,
      requested_primary_source_family_id text,
      requested_primary_source_id text,
      requested_corroborating_source_family_id text,
      requested_corroborating_source_id text,
      requested_source_pair_approval_id text,
      requested_source_pair_registry_fingerprint_sha256 text,
      requested_source_pair_approval_expires_at timestamptz,
      requested_recorded_at timestamptz
    ) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${EVIDENCE_ROW_VALID_BODY}$function$;

    CREATE FUNCTION provider_position_chain_anchor_control_row_valid(
      requested_event_id uuid,
      requested_event_version smallint,
      requested_event_use text,
      requested_evidence_fingerprint_sha256 text,
      requested_control_action text,
      requested_reason_code text,
      requested_active_control boolean,
      requested_recorded_at timestamptz
    ) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${CONTROL_ROW_VALID_BODY}$function$;

    DO $set_provider_position_chain_anchor_validation_path$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${EVIDENCE_ROW_VALID} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_provider_position_chain_anchor_validation_path$;

    CREATE TABLE ${EVIDENCE_TABLE} (
      evidence_fingerprint_sha256 text PRIMARY KEY,
      read_binding_fingerprint_sha256 text NOT NULL,
      evidence_version smallint NOT NULL,
      evidence_use text NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      may_persist boolean NOT NULL,
      network_id text NOT NULL,
      source_family_id text NOT NULL,
      source_id text NOT NULL,
      source_kind text NOT NULL,
      source_observation_id text NOT NULL,
      continuity_floor jsonb NOT NULL,
      chain_anchor jsonb NOT NULL,
      observed_at timestamptz NOT NULL,
      assessed_at timestamptz NOT NULL,
      agreed_current_head jsonb NOT NULL,
      current_head_advanced_at timestamptz NOT NULL,
      agreed_finalized_head jsonb NOT NULL,
      finalized_head_advanced_at timestamptz NOT NULL,
      identity_proof_sha256 text NOT NULL,
      live_capability_proof_sha256 text NOT NULL,
      lineage_proof_sha256 text NOT NULL,
      identity_status text NOT NULL,
      progression_status text NOT NULL,
      finality_status text NOT NULL,
      primary_source_family_id text NOT NULL,
      primary_source_id text NOT NULL,
      corroborating_source_family_id text NOT NULL,
      corroborating_source_id text NOT NULL,
      source_pair_approval_id text NOT NULL,
      source_pair_registry_fingerprint_sha256 text NOT NULL,
      source_pair_approval_expires_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT provider_position_chain_anchor_read_binding_unique UNIQUE (
        read_binding_fingerprint_sha256
      ),
      CONSTRAINT provider_position_chain_anchor_evidence_valid_check CHECK (
        ${EVIDENCE_ROW_VALID_CALL} IS TRUE
      )
    );
    COMMENT ON TABLE ${EVIDENCE_TABLE} IS '${EVIDENCE_MANIFEST}';

    CREATE TABLE ${CONTROL_TABLE} (
      event_id uuid PRIMARY KEY,
      event_version smallint NOT NULL,
      event_use text NOT NULL,
      evidence_fingerprint_sha256 text NOT NULL,
      control_action text NOT NULL,
      reason_code text NOT NULL,
      active_control boolean NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT provider_position_chain_anchor_control_evidence_fk FOREIGN KEY (
        evidence_fingerprint_sha256
      ) REFERENCES ${EVIDENCE_TABLE} (evidence_fingerprint_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT provider_position_chain_anchor_control_valid_check CHECK (
        ${CONTROL_ROW_VALID_CALL} IS TRUE
      )
    );
    COMMENT ON TABLE ${CONTROL_TABLE} IS '${CONTROL_MANIFEST}';

    CREATE INDEX provider_position_chain_anchor_evidence_read_idx
      ON ${EVIDENCE_TABLE} (
        network_id,
        source_family_id,
        source_id,
        source_kind,
        source_observation_id,
        observed_at,
        assessed_at DESC,
        recorded_at DESC,
        evidence_fingerprint_sha256
      );
    CREATE INDEX provider_position_chain_anchor_control_active_idx
      ON ${CONTROL_TABLE} (evidence_fingerprint_sha256, recorded_at DESC, event_id)
      WHERE active_control;

    CREATE FUNCTION reject_provider_position_chain_anchor_history_mutation()
    RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
    SET search_path TO pg_catalog
    AS $function$${HISTORY_GUARD_BODY}$function$;
    CREATE TRIGGER provider_position_chain_anchor_evidence_append_only_row
      BEFORE UPDATE OR DELETE ON ${EVIDENCE_TABLE}
      FOR EACH ROW EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    CREATE TRIGGER provider_position_chain_anchor_evidence_append_only_truncate
      BEFORE TRUNCATE ON ${EVIDENCE_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    CREATE TRIGGER provider_position_chain_anchor_control_append_only_row
      BEFORE UPDATE OR DELETE ON ${CONTROL_TABLE}
      FOR EACH ROW EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    CREATE TRIGGER provider_position_chain_anchor_control_append_only_truncate
      BEFORE TRUNCATE ON ${CONTROL_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    ALTER TABLE ${EVIDENCE_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_evidence_append_only_row;
    ALTER TABLE ${EVIDENCE_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_evidence_append_only_truncate;
    ALTER TABLE ${CONTROL_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_control_append_only_row;
    ALTER TABLE ${CONTROL_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_control_append_only_truncate;

    CREATE FUNCTION record_provider_position_chain_anchor_evidence(
      requested_network_id text,
      requested_source_family_id text,
      requested_source_id text,
      requested_source_kind text,
      requested_source_observation_id text,
      requested_continuity_floor jsonb,
      requested_chain_anchor jsonb,
      requested_observed_at timestamptz,
      requested_assessed_at timestamptz,
      requested_agreed_current_head jsonb,
      requested_current_head_advanced_at timestamptz,
      requested_agreed_finalized_head jsonb,
      requested_finalized_head_advanced_at timestamptz,
      requested_identity_proof_sha256 text,
      requested_live_capability_proof_sha256 text,
      requested_lineage_proof_sha256 text,
      requested_primary_source_family_id text,
      requested_primary_source_id text,
      requested_corroborating_source_family_id text,
      requested_corroborating_source_id text,
      requested_source_pair_approval_id text,
      requested_source_pair_registry_fingerprint_sha256 text,
      requested_source_pair_approval_expires_at timestamptz
    ) RETURNS TABLE (
      record_outcome text,
      recorded_evidence_fingerprint_sha256 text,
      evidence_recorded_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RECORD_EVIDENCE_BODY}$function$;

    CREATE FUNCTION invalidate_provider_position_chain_anchor_evidence(
      requested_event_id uuid,
      requested_evidence_fingerprint_sha256 text,
      requested_control_action text,
      requested_reason_code text
    ) RETURNS TABLE (
      control_outcome text,
      recorded_event_id uuid,
      control_recorded_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${CONTROL_EVIDENCE_BODY}$function$;

    CREATE FUNCTION read_provider_position_chain_anchor_evidence(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text,
      requested_source_family_id text,
      requested_source_id text,
      requested_source_kind text,
      requested_source_observation_id text,
      requested_continuity_floor jsonb,
      requested_chain_anchor jsonb,
      requested_observed_at timestamptz,
      requested_captured_at timestamptz,
      requested_evaluated_at timestamptz,
      requested_deadline_at timestamptz
    ) RETURNS TABLE (
      reader_version smallint,
      assessment_use text,
      may_authorize_financial_action boolean,
      may_persist boolean,
      network_id text,
      continuity_floor jsonb,
      chain_anchor jsonb,
      assessed_at timestamptz,
      identity_status text,
      progression_status text,
      finality_status text
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${READ_EVIDENCE_BODY}$function$;

    DO $set_provider_position_chain_anchor_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECORD_EVIDENCE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${CONTROL_EVIDENCE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${READ_EVIDENCE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_provider_position_chain_anchor_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${EVIDENCE_TABLE}, ${CONTROL_TABLE}
      FROM ${guardedRoles};
    REVOKE ALL PRIVILEGES ON TYPE ${EVIDENCE_TABLE}, ${CONTROL_TABLE}
      FROM ${guardedRoles};
    ${ALL_FUNCTIONS.map(
      (functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guardedRoles};`,
    ).join('\n    ')}
    GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${api};`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `DO $refuse_provider_position_chain_anchor_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${EVIDENCE_TABLE})
        OR EXISTS (SELECT 1 FROM ${CONTROL_TABLE})
      THEN
        RAISE EXCEPTION 'cannot roll back provider position chain anchor evidence after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_provider_position_chain_anchor_history_loss$;
    REVOKE EXECUTE ON FUNCTION ${READ_EVIDENCE} FROM ${guardedRoles};
    DROP FUNCTION ${READ_EVIDENCE};
    DROP FUNCTION ${CONTROL_EVIDENCE};
    DROP FUNCTION ${RECORD_EVIDENCE};
    DROP TRIGGER provider_position_chain_anchor_control_append_only_truncate
      ON ${CONTROL_TABLE};
    DROP TRIGGER provider_position_chain_anchor_control_append_only_row
      ON ${CONTROL_TABLE};
    DROP TRIGGER provider_position_chain_anchor_evidence_append_only_truncate
      ON ${EVIDENCE_TABLE};
    DROP TRIGGER provider_position_chain_anchor_evidence_append_only_row
      ON ${EVIDENCE_TABLE};
    DROP FUNCTION ${HISTORY_GUARD};
    DROP TABLE ${CONTROL_TABLE};
    DROP TABLE ${EVIDENCE_TABLE};
    DROP FUNCTION ${CONTROL_ROW_VALID};
    DROP FUNCTION ${EVIDENCE_ROW_VALID};
    DROP FUNCTION ${EVIDENCE_FINGERPRINT};
    DROP FUNCTION ${READ_BINDING_FINGERPRINT};
    DROP FUNCTION ${ANCHOR_VALID};`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createGenericWorkerBalanceAuthoritySuspensionMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0028 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const prior = cumulative
    ? replaceExactlyOnce(
        previous.verifySql,
        predecessorFunctionAllowance(api, PRIOR_API_FUNCTIONS),
        functionAllowance(api, [...PRIOR_API_FUNCTIONS, READ_EVIDENCE]),
      )
    : previous.verifySql;
  const sources = [
    [ANCHOR_VALID, sourceSha256(ANCHOR_VALID_BODY)],
    [READ_BINDING_FINGERPRINT, sourceSha256(READ_BINDING_FINGERPRINT_BODY)],
    [EVIDENCE_FINGERPRINT, sourceSha256(EVIDENCE_FINGERPRINT_BODY)],
    [EVIDENCE_ROW_VALID, sourceSha256(EVIDENCE_ROW_VALID_BODY)],
    [CONTROL_ROW_VALID, sourceSha256(CONTROL_ROW_VALID_BODY)],
    [HISTORY_GUARD, sourceSha256(HISTORY_GUARD_BODY)],
    [RECORD_EVIDENCE, sourceSha256(RECORD_EVIDENCE_BODY)],
    [CONTROL_EVIDENCE, sourceSha256(CONTROL_EVIDENCE_BODY)],
    [READ_EVIDENCE, sourceSha256(READ_EVIDENCE_BODY)],
  ] as const;

  return `SELECT (
      prior.valid
      AND relations.valid
      AND columns.valid
      AND no_wallet_pii_columns.valid
      AND indexes.valid
      AND constraints.valid
      AND functions.valid
      AND triggers.valid
      AND privileges.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      WITH expected(table_name, manifest) AS (VALUES
        ('${EVIDENCE_TABLE}', '${EVIDENCE_MANIFEST}'),
        ('${CONTROL_TABLE}', '${CONTROL_MANIFEST}')
      )
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.count(relation.oid) = 2
        AND pg_catalog.bool_and(relation.relkind = 'r')
        AND pg_catalog.bool_and(relation.relpersistence = 'p')
        AND pg_catalog.bool_and(NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity)
        AND pg_catalog.bool_and(
          relation_owner.rolname = ${cumulative ? owner : 'relation_owner.rolname'}
        )
        AND pg_catalog.bool_and(
          pg_catalog.obj_description(relation.oid, 'pg_class') = expected.manifest
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND relation.relname = expected.table_name
      LEFT JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
    ) AS relations
    CROSS JOIN (
      WITH expected(table_name, ordinal, column_name, data_type) AS (VALUES
        ('${EVIDENCE_TABLE}', 1, 'evidence_fingerprint_sha256', 'text'),
        ('${EVIDENCE_TABLE}', 2, 'read_binding_fingerprint_sha256', 'text'),
        ('${EVIDENCE_TABLE}', 3, 'evidence_version', 'smallint'),
        ('${EVIDENCE_TABLE}', 4, 'evidence_use', 'text'),
        ('${EVIDENCE_TABLE}', 5, 'may_authorize_financial_action', 'boolean'),
        ('${EVIDENCE_TABLE}', 6, 'may_persist', 'boolean'),
        ('${EVIDENCE_TABLE}', 7, 'network_id', 'text'),
        ('${EVIDENCE_TABLE}', 8, 'source_family_id', 'text'),
        ('${EVIDENCE_TABLE}', 9, 'source_id', 'text'),
        ('${EVIDENCE_TABLE}', 10, 'source_kind', 'text'),
        ('${EVIDENCE_TABLE}', 11, 'source_observation_id', 'text'),
        ('${EVIDENCE_TABLE}', 12, 'continuity_floor', 'jsonb'),
        ('${EVIDENCE_TABLE}', 13, 'chain_anchor', 'jsonb'),
        ('${EVIDENCE_TABLE}', 14, 'observed_at', 'timestamp with time zone'),
        ('${EVIDENCE_TABLE}', 15, 'assessed_at', 'timestamp with time zone'),
        ('${EVIDENCE_TABLE}', 16, 'agreed_current_head', 'jsonb'),
        ('${EVIDENCE_TABLE}', 17, 'current_head_advanced_at', 'timestamp with time zone'),
        ('${EVIDENCE_TABLE}', 18, 'agreed_finalized_head', 'jsonb'),
        ('${EVIDENCE_TABLE}', 19, 'finalized_head_advanced_at', 'timestamp with time zone'),
        ('${EVIDENCE_TABLE}', 20, 'identity_proof_sha256', 'text'),
        ('${EVIDENCE_TABLE}', 21, 'live_capability_proof_sha256', 'text'),
        ('${EVIDENCE_TABLE}', 22, 'lineage_proof_sha256', 'text'),
        ('${EVIDENCE_TABLE}', 23, 'identity_status', 'text'),
        ('${EVIDENCE_TABLE}', 24, 'progression_status', 'text'),
        ('${EVIDENCE_TABLE}', 25, 'finality_status', 'text'),
        ('${EVIDENCE_TABLE}', 26, 'primary_source_family_id', 'text'),
        ('${EVIDENCE_TABLE}', 27, 'primary_source_id', 'text'),
        ('${EVIDENCE_TABLE}', 28, 'corroborating_source_family_id', 'text'),
        ('${EVIDENCE_TABLE}', 29, 'corroborating_source_id', 'text'),
        ('${EVIDENCE_TABLE}', 30, 'source_pair_approval_id', 'text'),
        ('${EVIDENCE_TABLE}', 31, 'source_pair_registry_fingerprint_sha256', 'text'),
        ('${EVIDENCE_TABLE}', 32, 'source_pair_approval_expires_at',
          'timestamp with time zone'),
        ('${EVIDENCE_TABLE}', 33, 'recorded_at', 'timestamp with time zone'),
        ('${CONTROL_TABLE}', 1, 'event_id', 'uuid'),
        ('${CONTROL_TABLE}', 2, 'event_version', 'smallint'),
        ('${CONTROL_TABLE}', 3, 'event_use', 'text'),
        ('${CONTROL_TABLE}', 4, 'evidence_fingerprint_sha256', 'text'),
        ('${CONTROL_TABLE}', 5, 'control_action', 'text'),
        ('${CONTROL_TABLE}', 6, 'reason_code', 'text'),
        ('${CONTROL_TABLE}', 7, 'active_control', 'boolean'),
        ('${CONTROL_TABLE}', 8, 'recorded_at', 'timestamp with time zone')
      )
      SELECT pg_catalog.count(*) = 41
        AND pg_catalog.count(attribute.attnum) = 41
        AND pg_catalog.bool_and(
          attribute.attnum = expected.ordinal
          AND attribute.attname = expected.column_name
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            = expected.data_type
          AND attribute.attnotnull
          AND attribute_default.adbin IS NULL
        )
        AND (
          SELECT pg_catalog.count(*) = 41
          FROM pg_catalog.pg_attribute AS all_attribute
          WHERE all_attribute.attrelid IN (
              pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
              pg_catalog.to_regclass('${CONTROL_TABLE}')
            )
            AND all_attribute.attnum > 0
            AND NOT all_attribute.attisdropped
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = pg_catalog.to_regclass(expected.table_name)
        AND attribute.attnum = expected.ordinal
      LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
        ON attribute_default.adrelid = attribute.attrelid
        AND attribute_default.adnum = attribute.attnum
    ) AS columns
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid IN (
            pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
            pg_catalog.to_regclass('${CONTROL_TABLE}')
          )
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attname ~ '(account|wallet|address|cipher|digest)'
      ) AS valid
    ) AS no_wallet_pii_columns
    CROSS JOIN (
      WITH expected(index_name, table_name) AS (VALUES
        ('provider_position_chain_anchor_evidence_read_idx', '${EVIDENCE_TABLE}'),
        ('provider_position_chain_anchor_control_active_idx', '${CONTROL_TABLE}')
      )
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.count(index_state.indexrelid) = 2
        AND (
          SELECT pg_catalog.count(*) = 5
          FROM pg_catalog.pg_index AS all_index
          WHERE all_index.indrelid IN (
            pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
            pg_catalog.to_regclass('${CONTROL_TABLE}')
          )
        )
        AND pg_catalog.bool_and(
          index_relation.relkind = 'i'
          AND index_relation.relpersistence = 'p'
          AND access_method.amname = 'btree'
          AND index_state.indisvalid
          AND index_state.indisready
          AND NOT index_state.indisunique
          AND NOT index_state.indisprimary
          AND NOT index_state.indisexclusion
          AND index_state.indimmediate
          AND NOT index_state.indisclustered
          AND NOT index_state.indcheckxmin
          AND NOT index_state.indisreplident
          AND NOT index_state.indnullsnotdistinct
          AND index_state.indexprs IS NULL
          AND index_state.indnkeyatts = index_state.indnatts
          AND CASE expected.index_name
            WHEN 'provider_position_chain_anchor_evidence_read_idx' THEN
              index_state.indkey = '7 8 9 10 11 14 15 33 1'::pg_catalog.int2vector
              AND index_state.indoption = '0 0 0 0 0 0 3 3 0'::pg_catalog.int2vector
              AND index_state.indpred IS NULL
              AND (
                SELECT pg_catalog.array_agg(
                  operator_class.opcname::text ORDER BY item.ordinal
                )
                FROM pg_catalog.unnest(index_state.indclass::oid[])
                  WITH ORDINALITY AS item(operator_class_oid, ordinal)
                INNER JOIN pg_catalog.pg_opclass AS operator_class
                  ON operator_class.oid = item.operator_class_oid
              ) = ARRAY[
                'text_ops', 'text_ops', 'text_ops', 'text_ops', 'text_ops',
                'timestamptz_ops', 'timestamptz_ops', 'timestamptz_ops', 'text_ops'
              ]::text[]
            WHEN 'provider_position_chain_anchor_control_active_idx' THEN
              index_state.indkey = '4 8 1'::pg_catalog.int2vector
              AND index_state.indoption = '0 3 0'::pg_catalog.int2vector
              AND pg_catalog.pg_get_expr(
                index_state.indpred, index_state.indrelid, false
              ) = 'active_control'
              AND (
                SELECT pg_catalog.array_agg(
                  operator_class.opcname::text ORDER BY item.ordinal
                )
                FROM pg_catalog.unnest(index_state.indclass::oid[])
                  WITH ORDINALITY AS item(operator_class_oid, ordinal)
                INNER JOIN pg_catalog.pg_opclass AS operator_class
                  ON operator_class.oid = item.operator_class_oid
              ) = ARRAY['text_ops', 'timestamptz_ops', 'uuid_ops']::text[]
            ELSE false
          END
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND index_relation.relname = expected.index_name
      LEFT JOIN pg_catalog.pg_index AS index_state
        ON index_state.indexrelid = index_relation.oid
        AND index_state.indrelid = pg_catalog.to_regclass(expected.table_name)
      LEFT JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_relation.relam
    ) AS indexes
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 6
        AND pg_catalog.bool_and(constraint_state.convalidated)
        AND pg_catalog.bool_and(
          NOT constraint_state.condeferrable
          AND NOT constraint_state.condeferred
          AND NOT constraint_state.connoinherit
          AND constraint_state.conislocal
          AND constraint_state.coninhcount = 0
        )
        AND pg_catalog.bool_and(CASE constraint_state.conname
          WHEN '${EVIDENCE_TABLE}_pkey' THEN
            constraint_state.contype = 'p'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${EVIDENCE_TABLE}')
              AND constraint_state.conkey = ARRAY[1]::smallint[]
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_index AS supporting_index
                WHERE supporting_index.indexrelid = constraint_state.conindid
                  AND supporting_index.indrelid = constraint_state.conrelid
                  AND supporting_index.indisprimary
                  AND supporting_index.indisunique
                  AND supporting_index.indisvalid
                  AND supporting_index.indisready
                  AND supporting_index.indkey = '1'::pg_catalog.int2vector
              )
          WHEN 'provider_position_chain_anchor_read_binding_unique' THEN
            constraint_state.contype = 'u'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${EVIDENCE_TABLE}')
              AND constraint_state.conkey = ARRAY[2]::smallint[]
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_index AS supporting_index
                WHERE supporting_index.indexrelid = constraint_state.conindid
                  AND supporting_index.indrelid = constraint_state.conrelid
                  AND NOT supporting_index.indisprimary
                  AND supporting_index.indisunique
                  AND supporting_index.indisvalid
                  AND supporting_index.indisready
                  AND supporting_index.indkey = '2'::pg_catalog.int2vector
              )
          WHEN 'provider_position_chain_anchor_evidence_valid_check' THEN
            constraint_state.contype = 'c'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${EVIDENCE_TABLE}')
              AND constraint_state.conkey = ARRAY[
                1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,
                18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33
              ]::smallint[]
              AND pg_catalog.regexp_replace(
                pg_catalog.pg_get_expr(
                  constraint_state.conbin, constraint_state.conrelid, false
                ),
                '[[:space:]]+', '', 'g'
              ) IN (
                '${EVIDENCE_ROW_VALID_CALL_COMPACT}',
                '(${EVIDENCE_ROW_VALID_CALL_COMPACT})'
              )
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_depend AS dependency
                WHERE dependency.classid = pg_catalog.to_regclass('pg_catalog.pg_constraint')
                  AND dependency.objid = constraint_state.oid
                  AND dependency.refclassid = pg_catalog.to_regclass('pg_catalog.pg_proc')
                  AND dependency.refobjid = pg_catalog.to_regprocedure('${EVIDENCE_ROW_VALID}')
                  AND dependency.deptype = 'n'
              )
          WHEN '${CONTROL_TABLE}_pkey' THEN
            constraint_state.contype = 'p'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${CONTROL_TABLE}')
              AND constraint_state.conkey = ARRAY[1]::smallint[]
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_index AS supporting_index
                WHERE supporting_index.indexrelid = constraint_state.conindid
                  AND supporting_index.indrelid = constraint_state.conrelid
                  AND supporting_index.indisprimary
                  AND supporting_index.indisunique
                  AND supporting_index.indisvalid
                  AND supporting_index.indisready
                  AND supporting_index.indkey = '1'::pg_catalog.int2vector
              )
          WHEN 'provider_position_chain_anchor_control_evidence_fk' THEN
            constraint_state.contype = 'f'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${CONTROL_TABLE}')
              AND constraint_state.confrelid = pg_catalog.to_regclass('${EVIDENCE_TABLE}')
              AND constraint_state.conkey = ARRAY[4]::smallint[]
              AND constraint_state.confkey = ARRAY[1]::smallint[]
              AND constraint_state.confmatchtype = 's'
              AND constraint_state.confupdtype = 'r'
              AND constraint_state.confdeltype = 'r'
          WHEN 'provider_position_chain_anchor_control_valid_check' THEN
            constraint_state.contype = 'c'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${CONTROL_TABLE}')
              AND constraint_state.conkey = ARRAY[1,2,3,4,5,6,7,8]::smallint[]
              AND pg_catalog.regexp_replace(
                pg_catalog.pg_get_expr(
                  constraint_state.conbin, constraint_state.conrelid, false
                ),
                '[[:space:]]+', '', 'g'
              ) IN (
                '${CONTROL_ROW_VALID_CALL_COMPACT}',
                '(${CONTROL_ROW_VALID_CALL_COMPACT})'
              )
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_depend AS dependency
                WHERE dependency.classid = pg_catalog.to_regclass('pg_catalog.pg_constraint')
                  AND dependency.objid = constraint_state.oid
                  AND dependency.refclassid = pg_catalog.to_regclass('pg_catalog.pg_proc')
                  AND dependency.refobjid = pg_catalog.to_regprocedure('${CONTROL_ROW_VALID}')
                  AND dependency.deptype = 'n'
              )
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.connamespace =
          pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND constraint_state.conrelid IN (
          pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
          pg_catalog.to_regclass('${CONTROL_TABLE}')
        )
        AND constraint_state.conname IN (
          '${EVIDENCE_TABLE}_pkey',
          'provider_position_chain_anchor_read_binding_unique',
          'provider_position_chain_anchor_evidence_valid_check',
          '${CONTROL_TABLE}_pkey',
          'provider_position_chain_anchor_control_evidence_fk',
          'provider_position_chain_anchor_control_valid_check'
        )
        AND (
          SELECT pg_catalog.count(*) = 6
          FROM pg_catalog.pg_constraint AS all_constraint
          WHERE all_constraint.conrelid IN (
            pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
            pg_catalog.to_regclass('${CONTROL_TABLE}')
          )
        )
    ) AS constraints
    CROSS JOIN (
      SELECT pg_catalog.count(*) = ${ALL_FUNCTIONS.length}
        AND pg_catalog.bool_and(
          function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
        )
        AND pg_catalog.bool_and(
          NOT procedure.proleakproof
          AND procedure.prokind = 'f'
          AND procedure.pronargdefaults = 0
          AND procedure.provariadic = 0
          AND procedure.proretset = (procedure.oid IN (
            pg_catalog.to_regprocedure('${RECORD_EVIDENCE}'),
            pg_catalog.to_regprocedure('${CONTROL_EVIDENCE}'),
            pg_catalog.to_regprocedure('${READ_EVIDENCE}')
          ))
        )
        AND pg_catalog.bool_and(language.lanname = CASE
          WHEN procedure.oid IN (
            pg_catalog.to_regprocedure('${ANCHOR_VALID}'),
            pg_catalog.to_regprocedure('${READ_BINDING_FINGERPRINT}'),
            pg_catalog.to_regprocedure('${EVIDENCE_FINGERPRINT}'),
            pg_catalog.to_regprocedure('${EVIDENCE_ROW_VALID}'),
            pg_catalog.to_regprocedure('${CONTROL_ROW_VALID}')
          ) THEN 'sql'
          ELSE 'plpgsql'
        END)
        AND pg_catalog.bool_and(procedure.prorettype = CASE procedure.oid
          WHEN pg_catalog.to_regprocedure('${ANCHOR_VALID}')
            THEN pg_catalog.to_regtype('boolean')
          WHEN pg_catalog.to_regprocedure('${READ_BINDING_FINGERPRINT}')
            THEN pg_catalog.to_regtype('text')
          WHEN pg_catalog.to_regprocedure('${EVIDENCE_FINGERPRINT}')
            THEN pg_catalog.to_regtype('text')
          WHEN pg_catalog.to_regprocedure('${EVIDENCE_ROW_VALID}')
            THEN pg_catalog.to_regtype('boolean')
          WHEN pg_catalog.to_regprocedure('${CONTROL_ROW_VALID}')
            THEN pg_catalog.to_regtype('boolean')
          WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}')
            THEN pg_catalog.to_regtype('trigger')
          ELSE pg_catalog.to_regtype('record')
        END)
        AND pg_catalog.bool_and(pg_catalog.pg_get_function_result(procedure.oid) =
          CASE procedure.oid
            WHEN pg_catalog.to_regprocedure('${ANCHOR_VALID}') THEN 'boolean'
            WHEN pg_catalog.to_regprocedure('${READ_BINDING_FINGERPRINT}') THEN 'text'
            WHEN pg_catalog.to_regprocedure('${EVIDENCE_FINGERPRINT}') THEN 'text'
            WHEN pg_catalog.to_regprocedure('${EVIDENCE_ROW_VALID}') THEN 'boolean'
            WHEN pg_catalog.to_regprocedure('${CONTROL_ROW_VALID}') THEN 'boolean'
            WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}') THEN 'trigger'
            WHEN pg_catalog.to_regprocedure('${RECORD_EVIDENCE}') THEN
              'TABLE(record_outcome text, recorded_evidence_fingerprint_sha256 text, evidence_recorded_at timestamp with time zone)'
            WHEN pg_catalog.to_regprocedure('${CONTROL_EVIDENCE}') THEN
              'TABLE(control_outcome text, recorded_event_id uuid, control_recorded_at timestamp with time zone)'
            WHEN pg_catalog.to_regprocedure('${READ_EVIDENCE}') THEN
              'TABLE(reader_version smallint, assessment_use text, may_authorize_financial_action boolean, may_persist boolean, network_id text, continuity_floor jsonb, chain_anchor jsonb, assessed_at timestamp with time zone, identity_status text, progression_status text, finality_status text)'
            ELSE NULL
          END
        )
        AND pg_catalog.bool_and(
          pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
            'hex'
          ) = CASE procedure.oid
            ${sources
              .map(
                ([identityValue, hash]) =>
                  `WHEN pg_catalog.to_regprocedure('${identityValue}') THEN '${hash}'`,
              )
              .join('\n            ')}
            ELSE NULL
          END
        )
        AND pg_catalog.bool_and(CASE procedure.oid
          WHEN pg_catalog.to_regprocedure('${ANCHOR_VALID}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${READ_BINDING_FINGERPRINT}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${EVIDENCE_FINGERPRINT}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${EVIDENCE_ROW_VALID}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          WHEN pg_catalog.to_regprocedure('${CONTROL_ROW_VALID}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'v'
              AND procedure.proparallel = 'u' AND NOT procedure.proisstrict
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${RECORD_EVIDENCE}') THEN
            procedure.prosecdef AND procedure.provolatile = 'v'
              AND procedure.proparallel = 'u' AND procedure.proisstrict
              AND procedure.proretset
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          WHEN pg_catalog.to_regprocedure('${CONTROL_EVIDENCE}') THEN
            procedure.prosecdef AND procedure.provolatile = 'v'
              AND procedure.proparallel = 'u' AND procedure.proisstrict
              AND procedure.proretset
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          WHEN pg_catalog.to_regprocedure('${READ_EVIDENCE}') THEN
            procedure.prosecdef AND procedure.provolatile = 'v'
              AND procedure.proparallel = 'u' AND procedure.proisstrict
              AND procedure.proretset
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
      INNER JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND procedure.oid IN (
          ${ALL_FUNCTIONS.map(
            (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
          ).join(',\n          ')}
        )
    ) AS functions
    CROSS JOIN (
      WITH expected(trigger_name, table_name, trigger_type) AS (VALUES
        ('provider_position_chain_anchor_evidence_append_only_row',
          '${EVIDENCE_TABLE}', 27::smallint),
        ('provider_position_chain_anchor_evidence_append_only_truncate',
          '${EVIDENCE_TABLE}', 34::smallint),
        ('provider_position_chain_anchor_control_append_only_row',
          '${CONTROL_TABLE}', 27::smallint),
        ('provider_position_chain_anchor_control_append_only_truncate',
          '${CONTROL_TABLE}', 34::smallint)
      )
      SELECT pg_catalog.count(*) = 4
        AND pg_catalog.count(trigger.oid) = 4
        AND pg_catalog.bool_and(
          trigger.tgenabled = 'A'
          AND trigger.tgfoid = pg_catalog.to_regprocedure('${HISTORY_GUARD}')
          AND trigger.tgtype = expected.trigger_type
          AND NOT trigger.tgisinternal
          AND trigger.tgnargs = 0
          AND trigger.tgattr = ''::pg_catalog.int2vector
          AND trigger.tgqual IS NULL
          AND trigger.tgoldtable IS NULL
          AND trigger.tgnewtable IS NULL
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgrelid = pg_catalog.to_regclass(expected.table_name)
        AND trigger.tgname = expected.trigger_name
      WHERE (
        SELECT pg_catalog.count(*) = 4
        FROM pg_catalog.pg_trigger AS all_trigger
        WHERE all_trigger.tgrelid IN (
            pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
            pg_catalog.to_regclass('${CONTROL_TABLE}')
          )
          AND NOT all_trigger.tgisinternal
      )
    ) AS triggers
    CROSS JOIN (
      SELECT
        ${[api, worker, legacy, balance, migration]
          .flatMap((role) => [
            `NOT pg_catalog.has_table_privilege(${role}, '${EVIDENCE_TABLE}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
            `NOT pg_catalog.has_table_privilege(${role}, '${CONTROL_TABLE}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
          ])
          .join('\n        AND ')}
        AND pg_catalog.has_function_privilege(${api}, '${READ_EVIDENCE}', 'EXECUTE')
        AND ${[worker, legacy, balance, migration, "'public'"]
          .map(
            (role) =>
              `NOT pg_catalog.has_function_privilege(${role}, '${READ_EVIDENCE}', 'EXECUTE')`,
          )
          .join('\n        AND ')}
        AND ${[api, worker, legacy, balance, migration, "'public'"]
          .flatMap((role) =>
            ALL_FUNCTIONS.filter((identityValue) => identityValue !== READ_EVIDENCE).map(
              (identityValue) =>
                `NOT pg_catalog.has_function_privilege(${role}, '${identityValue}', 'EXECUTE')`,
            ),
          )
          .join('\n        AND ')}
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS guarded_table
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(
              guarded_table.relacl,
              pg_catalog.acldefault('r', guarded_table.relowner)
            )
          ) AS acl
          LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
          WHERE guarded_table.oid IN (
              pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
              pg_catalog.to_regclass('${CONTROL_TABLE}')
            )
            AND acl.grantee <> guarded_table.relowner
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_type AS guarded_type
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(
              guarded_type.typacl,
              pg_catalog.acldefault('T', guarded_type.typowner)
            )
          ) AS acl
          WHERE guarded_type.oid IN (
              pg_catalog.to_regtype('${EVIDENCE_TABLE}'),
              pg_catalog.to_regtype('${CONTROL_TABLE}')
            )
            AND acl.grantee <> guarded_type.typowner
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS guarded_function
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(
              guarded_function.proacl,
              pg_catalog.acldefault('f', guarded_function.proowner)
            )
          ) AS acl
          LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
          WHERE guarded_function.oid IN (
              ${ALL_FUNCTIONS.map(
                (identityValue) => `pg_catalog.to_regprocedure('${identityValue}')`,
              ).join(',\n              ')}
            )
            AND acl.grantee <> guarded_function.proowner
            AND NOT (
              guarded_function.oid = pg_catalog.to_regprocedure('${READ_EVIDENCE}')
              AND grantee.rolname = ${api}
              AND acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
            )
        ) AS valid
    ) AS privileges`;
}

export function createProviderPositionChainAnchorEvidenceMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0029',
    description:
      'create dormant global Ethereum and Solana provider position chain anchor evidence',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0028'],
  };
}

export const createProviderPositionChainAnchorEvidenceMigrationV0029 =
  createProviderPositionChainAnchorEvidenceMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029 =
  createProviderPositionChainAnchorEvidenceMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
