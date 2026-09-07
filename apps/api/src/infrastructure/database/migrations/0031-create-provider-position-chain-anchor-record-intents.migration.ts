import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createProviderPositionChainAnchorRecordDeadlineMigration } from './0030-enforce-provider-position-chain-anchor-record-deadline.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const EVIDENCE_TABLE = 'provider_position_chain_anchor_evidence';
const CONTROL_TABLE = 'provider_position_chain_anchor_control_events';
const DEADLINE_TABLE = 'provider_position_chain_anchor_record_deadlines';
const INTENT_TABLE = 'provider_position_chain_anchor_record_intents';
const INTENT_USE = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_ONLY';
const EVIDENCE_USE = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_ONLY';
const INTENT_MANIFEST =
  'crypto-lending:provider-position-chain-anchor-record-intent:v1;no-wallet-pii;retained;one-shot';
const INTENT_FINGERPRINT_DOMAIN = 'crypto-lending:provider-position-chain-anchor-record-intent:v1';
const DISPATCH_TOKEN_DOMAIN =
  'crypto-lending:provider-position-chain-anchor-record-dispatch-token:v1';
const RECONCILIATION_LEASE_TOKEN_DOMAIN =
  'crypto-lending:provider-position-chain-anchor-reconciliation-lease-token:v1';
const TERMINAL_STATES = Object.freeze([
  'RECORDED',
  'IDEMPOTENT_REPLAY',
  'NOT_RECORDED',
  'DEADLINE_VIOLATION',
] as const);

const EVIDENCE_FIELDS = Object.freeze([
  ['network_id', 'requested_network_id', 'text'],
  ['source_family_id', 'requested_source_family_id', 'text'],
  ['source_id', 'requested_source_id', 'text'],
  ['source_kind', 'requested_source_kind', 'text'],
  ['source_observation_id', 'requested_source_observation_id', 'text'],
  ['continuity_floor', 'requested_continuity_floor', 'jsonb'],
  ['chain_anchor', 'requested_chain_anchor', 'jsonb'],
  ['observed_at', 'requested_observed_at', 'timestamptz'],
  ['assessed_at', 'requested_assessed_at', 'timestamptz'],
  ['agreed_current_head', 'requested_agreed_current_head', 'jsonb'],
  ['current_head_advanced_at', 'requested_current_head_advanced_at', 'timestamptz'],
  ['agreed_finalized_head', 'requested_agreed_finalized_head', 'jsonb'],
  ['finalized_head_advanced_at', 'requested_finalized_head_advanced_at', 'timestamptz'],
  ['identity_proof_sha256', 'requested_identity_proof_sha256', 'text'],
  ['live_capability_proof_sha256', 'requested_live_capability_proof_sha256', 'text'],
  ['lineage_proof_sha256', 'requested_lineage_proof_sha256', 'text'],
  ['primary_source_family_id', 'requested_primary_source_family_id', 'text'],
  ['primary_source_id', 'requested_primary_source_id', 'text'],
  ['corroborating_source_family_id', 'requested_corroborating_source_family_id', 'text'],
  ['corroborating_source_id', 'requested_corroborating_source_id', 'text'],
  ['source_pair_approval_id', 'requested_source_pair_approval_id', 'text'],
  [
    'source_pair_registry_fingerprint_sha256',
    'requested_source_pair_registry_fingerprint_sha256',
    'text',
  ],
  ['source_pair_approval_expires_at', 'requested_source_pair_approval_expires_at', 'timestamptz'],
] as const);

const EVIDENCE_TYPES = EVIDENCE_FIELDS.map(([, , type]) =>
  type === 'timestamptz' ? 'timestamp with time zone' : type,
).join(',');
const INTENT_FINGERPRINT =
  'provider_position_chain_anchor_record_intent_fingerprint(text,timestamp with time zone)';
const DISPATCH_TOKEN_FINGERPRINT =
  'provider_chain_anchor_record_dispatch_token_fingerprint(text,bytea)';
const RECONCILIATION_LEASE_TOKEN_FINGERPRINT =
  'provider_chain_anchor_reconciliation_lease_token_fingerprint(text,bytea)';
const HEADER_VALID = `provider_position_chain_anchor_record_intent_header_valid(text,text,text,smallint,text,boolean,boolean,timestamp with time zone,timestamp with time zone,${EVIDENCE_TYPES})`;
const LIFECYCLE_VALID =
  'provider_position_chain_anchor_record_intent_lifecycle_valid(text,smallint,text,timestamp with time zone,timestamp with time zone,bigint,text,timestamp with time zone,timestamp with time zone,text,timestamp with time zone,text,timestamp with time zone,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone)';
const TRANSITION_GUARD = 'enforce_provider_position_chain_anchor_record_intent_transition()';
const DEADLINE_INTENT_GUARD = 'enforce_provider_chain_anchor_record_deadline_intent_binding()';
const PREPARE_INTENT = `prepare_provider_position_chain_anchor_record_intent(${EVIDENCE_TYPES},timestamp with time zone)`;
const CLAIM_DISPATCH = 'claim_provider_position_chain_anchor_record_dispatch(text,bytea)';
const EXECUTE_RECORD = 'execute_provider_position_chain_anchor_record_intent(text,bytea)';
const MARK_UNKNOWN = 'mark_provider_position_chain_anchor_record_intent_unknown(text,bytea)';
const LEASE_RECONCILIATION =
  'lease_provider_chain_anchor_record_intent_reconciliation(bytea,interval)';
const RECONCILE_INTENT = 'reconcile_provider_position_chain_anchor_record_intent(text,bytea)';
const RELEASE_RECONCILIATION =
  'release_provider_chain_anchor_record_intent_reconciliation(text,bytea,text,timestamp with time zone)';
const ALL_FUNCTIONS = Object.freeze([
  INTENT_FINGERPRINT,
  DISPATCH_TOKEN_FINGERPRINT,
  RECONCILIATION_LEASE_TOKEN_FINGERPRINT,
  HEADER_VALID,
  LIFECYCLE_VALID,
  TRANSITION_GUARD,
  DEADLINE_INTENT_GUARD,
  PREPARE_INTENT,
  CLAIM_DISPATCH,
  EXECUTE_RECORD,
  MARK_UNKNOWN,
  LEASE_RECONCILIATION,
  RECONCILE_INTENT,
  RELEASE_RECONCILIATION,
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

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0031 predecessor verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function evidenceDeclarations(indent: string): string {
  return EVIDENCE_FIELDS.map(([, parameter, type]) => `${indent}${parameter} ${type}`).join(',\n');
}

function evidenceColumns(indent: string, qualifier = ''): string {
  return EVIDENCE_FIELDS.map(([column]) => `${indent}${qualifier}${column}`).join(',\n');
}

function evidenceParameters(indent: string, qualifier = ''): string {
  return EVIDENCE_FIELDS.map(
    ([column, parameter]) => `${indent}${qualifier ? `${qualifier}${column}` : parameter}`,
  ).join(',\n');
}

function evidenceComparisons(prior = 'prior'): string {
  return EVIDENCE_FIELDS.map(
    ([column, parameter]) => `          OR ${prior}.${column} IS DISTINCT FROM ${parameter}`,
  ).join('\n');
}

const INTENT_FINGERPRINT_BODY = `
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          '${INTENT_FINGERPRINT_DOMAIN}',
          requested_evidence_fingerprint_sha256,
          pg_catalog.to_char(
            requested_producer_deadline_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )::text,
        'UTF8'
      )),
      'hex'
    );
    `;

const DISPATCH_TOKEN_FINGERPRINT_BODY = `
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          '${DISPATCH_TOKEN_DOMAIN}',
          requested_record_intent_fingerprint_sha256,
          pg_catalog.encode(requested_raw_dispatch_token, 'hex')
        )::text,
        'UTF8'
      )),
      'hex'
    );
    `;

const RECONCILIATION_LEASE_TOKEN_FINGERPRINT_BODY = `
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          '${RECONCILIATION_LEASE_TOKEN_DOMAIN}',
          requested_record_intent_fingerprint_sha256,
          pg_catalog.encode(requested_raw_lease_token, 'hex')
        )::text,
        'UTF8'
      )),
      'hex'
    );
    `;

const EVIDENCE_VALIDATION_ARGUMENTS = evidenceParameters('          ');

const HEADER_VALID_BODY = `
    SELECT requested_record_intent_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_record_intent_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_evidence_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_read_binding_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_read_binding_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_record_intent_version = 1
      AND requested_record_intent_use = '${INTENT_USE}'
      AND requested_may_authorize_financial_action = false
      AND requested_may_persist = false
      AND pg_catalog.isfinite(requested_prepared_at)
      AND pg_catalog.isfinite(requested_producer_deadline_at)
      AND pg_catalog.date_trunc('milliseconds', requested_prepared_at) = requested_prepared_at
      AND pg_catalog.date_trunc('milliseconds', requested_producer_deadline_at)
        = requested_producer_deadline_at
      AND requested_assessed_at <= requested_prepared_at
      AND requested_prepared_at < requested_producer_deadline_at
      AND requested_assessed_at < requested_producer_deadline_at
      AND requested_producer_deadline_at <= requested_assessed_at + interval '30 seconds'
      AND requested_read_binding_fingerprint_sha256 =
        provider_position_chain_anchor_read_binding_fingerprint(
${evidenceParameters('          ').split(',\n').slice(0, 8).join(',\n')}
        )
      AND requested_evidence_fingerprint_sha256 =
        provider_position_chain_anchor_evidence_fingerprint(
${EVIDENCE_VALIDATION_ARGUMENTS}
        )
      AND requested_record_intent_fingerprint_sha256 =
        provider_position_chain_anchor_record_intent_fingerprint(
          requested_evidence_fingerprint_sha256,
          requested_producer_deadline_at
        )
      AND provider_position_chain_anchor_evidence_row_valid(
          requested_evidence_fingerprint_sha256,
          requested_read_binding_fingerprint_sha256,
          1::smallint,
          '${EVIDENCE_USE}',
          false,
          false,
${evidenceParameters('          ').split(',\n').slice(0, 16).join(',\n')},
          'VERIFIED',
          'CURRENT',
          'HEALTHY',
${evidenceParameters('          ').split(',\n').slice(16).join(',\n')},
          requested_prepared_at
        ) IS TRUE;
    `;

const LIFECYCLE_VALID_BODY = `
    SELECT COALESCE(
      requested_record_state IN (
        'NEW', 'RECORD_DISPATCHED', 'UNKNOWN',
        'RECORDED', 'IDEMPOTENT_REPLAY', 'NOT_RECORDED', 'DEADLINE_VIOLATION'
      )
      AND requested_record_dispatch_count IN (0, 1)
      AND requested_reconciliation_attempt_count >= 0
      AND pg_catalog.isfinite(requested_reconcile_not_before)
      AND pg_catalog.date_trunc('milliseconds', requested_reconcile_not_before)
        = requested_reconcile_not_before
      AND requested_reconcile_not_before >= requested_producer_deadline_at
      AND (
        requested_record_dispatch_token_sha256 IS NULL
        OR (
          requested_record_dispatch_token_sha256 ~ '^[0-9a-f]{64}$'
          AND requested_record_dispatch_token_sha256 <> pg_catalog.repeat('0', 64)
        )
      )
      AND (
        requested_record_dispatched_at IS NULL
        OR (
          pg_catalog.isfinite(requested_record_dispatched_at)
          AND pg_catalog.date_trunc('milliseconds', requested_record_dispatched_at)
            = requested_record_dispatched_at
          AND requested_record_dispatched_at >= requested_prepared_at
        )
      )
      AND (
        requested_evidence_recorded_at IS NULL
        OR (
          pg_catalog.isfinite(requested_evidence_recorded_at)
          AND pg_catalog.date_trunc('milliseconds', requested_evidence_recorded_at)
            = requested_evidence_recorded_at
        )
      )
      AND (
        requested_resolved_at IS NULL
        OR (
          pg_catalog.isfinite(requested_resolved_at)
          AND pg_catalog.date_trunc('milliseconds', requested_resolved_at)
            = requested_resolved_at
          AND requested_resolved_at >= requested_prepared_at
          AND (
            requested_record_dispatched_at IS NULL
            OR requested_resolved_at >= requested_record_dispatched_at
          )
        )
      )
      AND (
        (
          requested_reconciliation_lease_token_sha256 IS NULL
          AND requested_reconciliation_lease_acquired_at IS NULL
          AND requested_reconciliation_lease_expires_at IS NULL
        )
        OR (
          requested_reconciliation_lease_token_sha256 ~ '^[0-9a-f]{64}$'
          AND requested_reconciliation_lease_token_sha256 <> pg_catalog.repeat('0', 64)
          AND pg_catalog.isfinite(requested_reconciliation_lease_acquired_at)
          AND pg_catalog.isfinite(requested_reconciliation_lease_expires_at)
          AND pg_catalog.date_trunc(
            'milliseconds', requested_reconciliation_lease_acquired_at
          ) = requested_reconciliation_lease_acquired_at
          AND pg_catalog.date_trunc(
            'milliseconds', requested_reconciliation_lease_expires_at
          ) = requested_reconciliation_lease_expires_at
          AND requested_reconciliation_lease_acquired_at
            < requested_reconciliation_lease_expires_at
          AND requested_reconciliation_lease_acquired_at >= requested_prepared_at
          AND requested_reconciliation_lease_acquired_at >= requested_producer_deadline_at
          AND requested_reconciliation_lease_acquired_at >= requested_reconcile_not_before
          AND requested_reconciliation_lease_expires_at
            <= requested_reconciliation_lease_acquired_at + interval '60 seconds'
        )
      )
      AND (
        (
          requested_last_reconciliation_error_code IS NULL
          AND requested_last_reconciliation_error_at IS NULL
        )
        OR (
          requested_last_reconciliation_error_code IN (
            'ANCHOR_RECONCILIATION_TRANSPORT_FAILED',
            'ANCHOR_RECONCILIATION_TRANSPORT_TIMEOUT',
            'ANCHOR_RECONCILIATION_DATABASE_UNAVAILABLE',
            'ANCHOR_RECONCILIATION_CANCELLED'
          )
          AND pg_catalog.isfinite(requested_last_reconciliation_error_at)
          AND pg_catalog.date_trunc(
            'milliseconds', requested_last_reconciliation_error_at
          ) = requested_last_reconciliation_error_at
          AND requested_last_reconciliation_error_at >= requested_prepared_at
        )
      )
      AND (
        (
          requested_record_state = 'NEW'
          AND requested_record_dispatch_count = 0
          AND requested_record_dispatch_token_sha256 IS NULL
          AND requested_record_dispatched_at IS NULL
          AND requested_deadline_binding_sha256 IS NULL
          AND requested_evidence_recorded_at IS NULL
          AND requested_resolved_at IS NULL
          AND requested_resolution_code IS NULL
        )
        OR (
          requested_record_state IN ('RECORD_DISPATCHED', 'UNKNOWN')
          AND requested_record_dispatch_count = 1
          AND requested_record_dispatch_token_sha256 ~ '^[0-9a-f]{64}$'
          AND requested_record_dispatch_token_sha256 <> pg_catalog.repeat('0', 64)
          AND pg_catalog.isfinite(requested_record_dispatched_at)
          AND pg_catalog.date_trunc('milliseconds', requested_record_dispatched_at)
            = requested_record_dispatched_at
          AND requested_record_dispatched_at < requested_producer_deadline_at
          AND requested_deadline_binding_sha256 IS NULL
          AND requested_evidence_recorded_at IS NULL
          AND requested_resolved_at IS NULL
          AND requested_resolution_code IS NULL
        )
        OR (
          requested_record_state IN ('RECORDED', 'IDEMPOTENT_REPLAY')
          AND requested_record_dispatch_count = 1
          AND requested_record_dispatch_token_sha256 ~ '^[0-9a-f]{64}$'
          AND requested_record_dispatch_token_sha256 <> pg_catalog.repeat('0', 64)
          AND pg_catalog.isfinite(requested_record_dispatched_at)
          AND requested_record_dispatched_at < requested_producer_deadline_at
          AND requested_deadline_binding_sha256 ~ '^[0-9a-f]{64}$'
          AND requested_deadline_binding_sha256 =
            provider_position_chain_anchor_record_deadline_fingerprint(
              requested_evidence_fingerprint_sha256,
              requested_producer_deadline_at,
              requested_evidence_recorded_at
            )
          AND pg_catalog.isfinite(requested_evidence_recorded_at)
          AND requested_evidence_recorded_at >= requested_prepared_at
          AND requested_evidence_recorded_at >= requested_record_dispatched_at
          AND requested_evidence_recorded_at < requested_producer_deadline_at
          AND pg_catalog.isfinite(requested_resolved_at)
          AND requested_resolved_at >= requested_evidence_recorded_at
          AND requested_resolution_code = requested_record_state
          AND requested_reconciliation_lease_token_sha256 IS NULL
        )
        OR (
          requested_record_state = 'NOT_RECORDED'
          AND (
            (
              requested_record_dispatch_count = 0
              AND requested_record_dispatch_token_sha256 IS NULL
              AND requested_record_dispatched_at IS NULL
            )
            OR (
              requested_record_dispatch_count = 1
              AND requested_record_dispatch_token_sha256 ~ '^[0-9a-f]{64}$'
              AND pg_catalog.isfinite(requested_record_dispatched_at)
              AND requested_record_dispatched_at < requested_producer_deadline_at
            )
          )
          AND requested_deadline_binding_sha256 IS NULL
          AND requested_evidence_recorded_at IS NULL
          AND pg_catalog.isfinite(requested_resolved_at)
          AND requested_resolved_at >= requested_producer_deadline_at
          AND requested_resolution_code = 'NOT_RECORDED'
          AND requested_reconciliation_lease_token_sha256 IS NULL
        )
        OR (
          requested_record_state = 'DEADLINE_VIOLATION'
          AND requested_record_dispatch_count = 1
          AND requested_record_dispatch_token_sha256 ~ '^[0-9a-f]{64}$'
          AND pg_catalog.isfinite(requested_record_dispatched_at)
          AND requested_record_dispatched_at < requested_producer_deadline_at
          AND requested_deadline_binding_sha256 IS NULL
          AND pg_catalog.isfinite(requested_evidence_recorded_at)
          AND pg_catalog.date_trunc('milliseconds', requested_evidence_recorded_at)
            = requested_evidence_recorded_at
          AND requested_evidence_recorded_at >= requested_prepared_at
          AND requested_evidence_recorded_at >= requested_record_dispatched_at
          AND pg_catalog.isfinite(requested_resolved_at)
          AND requested_resolved_at >= requested_producer_deadline_at
          AND requested_resolved_at >= requested_evidence_recorded_at
          AND requested_resolution_code = 'DEADLINE_VIOLATION'
          AND requested_reconciliation_lease_token_sha256 IS NULL
        )
      ),
      false
    );
    `;

const HEADER_VALID_CALL = `provider_position_chain_anchor_record_intent_header_valid(
          record_intent_fingerprint_sha256,
          evidence_fingerprint_sha256,
          read_binding_fingerprint_sha256,
          record_intent_version,
          record_intent_use,
          may_authorize_financial_action,
          may_persist,
          prepared_at,
          producer_deadline_at,
${evidenceColumns('          ')}
        )`;
const LIFECYCLE_VALID_CALL = `provider_position_chain_anchor_record_intent_lifecycle_valid(
          record_state,
          record_dispatch_count,
          record_dispatch_token_sha256,
          record_dispatched_at,
          reconcile_not_before,
          reconciliation_attempt_count,
          reconciliation_lease_token_sha256,
          reconciliation_lease_acquired_at,
          reconciliation_lease_expires_at,
          last_reconciliation_error_code,
          last_reconciliation_error_at,
          deadline_binding_sha256,
          evidence_recorded_at,
          resolved_at,
          resolution_code,
          evidence_fingerprint_sha256,
          producer_deadline_at,
          prepared_at
        )`;
const HEADER_VALID_CALL_COMPACT = `${HEADER_VALID_CALL} IS TRUE`.replace(/\s+/gu, '');
const LIFECYCLE_VALID_CALL_COMPACT = `${LIFECYCLE_VALID_CALL} IS TRUE`.replace(/\s+/gu, '');

const IMMUTABLE_COLUMNS = Object.freeze([
  'record_intent_fingerprint_sha256',
  'evidence_fingerprint_sha256',
  'read_binding_fingerprint_sha256',
  'record_intent_version',
  'record_intent_use',
  'may_authorize_financial_action',
  'may_persist',
  'prepared_at',
  'producer_deadline_at',
  ...EVIDENCE_FIELDS.map(([column]) => column),
]);

function unchangedLifecycleColumns(columns: readonly string[]): string {
  return columns
    .map((column) => `NEW.${column} IS NOT DISTINCT FROM OLD.${column}`)
    .join('\n          AND ');
}

const DISPATCH_FIELDS = Object.freeze([
  'record_dispatch_count',
  'record_dispatch_token_sha256',
  'record_dispatched_at',
]);
const LEASE_FIELDS = Object.freeze([
  'reconciliation_lease_token_sha256',
  'reconciliation_lease_acquired_at',
  'reconciliation_lease_expires_at',
]);
const ERROR_FIELDS = Object.freeze([
  'last_reconciliation_error_code',
  'last_reconciliation_error_at',
]);
const RESOLUTION_FIELDS = Object.freeze([
  'deadline_binding_sha256',
  'evidence_recorded_at',
  'resolved_at',
  'resolution_code',
]);

const TRANSITION_GUARD_BODY = `
    BEGIN
      IF ${IMMUTABLE_COLUMNS.map((column) => `OLD.${column} IS DISTINCT FROM NEW.${column}`).join(
        '\n        OR ',
      )}
      THEN
        RAISE EXCEPTION 'provider position chain anchor record intent header is immutable'
          USING ERRCODE = '55000';
      END IF;

      IF OLD.record_state IN (${TERMINAL_STATES.map((state) => `'${state}'`).join(', ')})
      THEN
        RAISE EXCEPTION 'provider position chain anchor record intent is terminal'
          USING ERRCODE = '55000';
      END IF;
      IF NOT (
        OLD.record_state = NEW.record_state
        OR (OLD.record_state = 'NEW' AND NEW.record_state IN ('RECORD_DISPATCHED', 'NOT_RECORDED'))
        OR (
          OLD.record_state = 'RECORD_DISPATCHED'
          AND NEW.record_state IN (
            'UNKNOWN', 'RECORDED', 'IDEMPOTENT_REPLAY',
            'NOT_RECORDED', 'DEADLINE_VIOLATION'
          )
        )
        OR (
          OLD.record_state = 'UNKNOWN'
          AND NEW.record_state IN (
            'RECORDED', 'IDEMPOTENT_REPLAY', 'NOT_RECORDED', 'DEADLINE_VIOLATION'
          )
        )
      ) THEN
        RAISE EXCEPTION 'invalid provider position chain anchor record intent transition'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.record_dispatch_count < OLD.record_dispatch_count
        OR NEW.record_dispatch_count > OLD.record_dispatch_count + 1
        OR (
          OLD.record_dispatch_count = 1
          AND (
            NEW.record_dispatch_token_sha256
              IS DISTINCT FROM OLD.record_dispatch_token_sha256
            OR NEW.record_dispatched_at IS DISTINCT FROM OLD.record_dispatched_at
          )
        )
        OR NEW.reconciliation_attempt_count < OLD.reconciliation_attempt_count
        OR NEW.reconciliation_attempt_count > OLD.reconciliation_attempt_count + 1
        OR (
          NEW.reconciliation_lease_token_sha256 IS NOT NULL
          AND NEW.reconciliation_lease_token_sha256
            IS DISTINCT FROM OLD.reconciliation_lease_token_sha256
          AND NEW.reconciliation_attempt_count
            <> OLD.reconciliation_attempt_count + 1
        )
        OR (
          NEW.reconciliation_attempt_count = OLD.reconciliation_attempt_count + 1
          AND (
            NEW.reconciliation_lease_token_sha256 IS NULL
            OR NEW.reconciliation_lease_token_sha256
              IS NOT DISTINCT FROM OLD.reconciliation_lease_token_sha256
          )
        )
        OR (
          NEW.reconciliation_lease_token_sha256
            IS NOT DISTINCT FROM OLD.reconciliation_lease_token_sha256
          AND (
            NEW.reconciliation_lease_acquired_at
              IS DISTINCT FROM OLD.reconciliation_lease_acquired_at
            OR NEW.reconciliation_lease_expires_at
              IS DISTINCT FROM OLD.reconciliation_lease_expires_at
          )
        )
        OR NEW.reconcile_not_before < OLD.reconcile_not_before
        OR (
          OLD.last_reconciliation_error_at IS NOT NULL
          AND (
            NEW.last_reconciliation_error_code IS NULL
            OR NEW.last_reconciliation_error_at IS NULL
            OR NEW.last_reconciliation_error_at < OLD.last_reconciliation_error_at
          )
        )
        OR (
          OLD.reconciliation_lease_token_sha256 IS NOT NULL
          AND NEW.reconciliation_lease_token_sha256 IS NOT NULL
          AND NEW.reconciliation_lease_token_sha256
            IS DISTINCT FROM OLD.reconciliation_lease_token_sha256
          AND OLD.reconciliation_lease_expires_at > pg_catalog.clock_timestamp()
        )
      THEN
        RAISE EXCEPTION 'provider position chain anchor record intent lifecycle is not monotonic'
          USING ERRCODE = '55000';
      END IF;

      IF NOT (
        (
          OLD.record_state = 'NEW'
          AND NEW.record_state = 'RECORD_DISPATCHED'
          AND ${unchangedLifecycleColumns([
            'reconcile_not_before',
            'reconciliation_attempt_count',
            ...LEASE_FIELDS,
            ...ERROR_FIELDS,
            ...RESOLUTION_FIELDS,
          ])}
        )
        OR (
          OLD.record_state = 'NEW'
          AND NEW.record_state = 'NOT_RECORDED'
          AND pg_catalog.clock_timestamp() >= OLD.producer_deadline_at
          AND ${unchangedLifecycleColumns([
            ...DISPATCH_FIELDS,
            'reconcile_not_before',
            'reconciliation_attempt_count',
            ...ERROR_FIELDS,
            'deadline_binding_sha256',
            'evidence_recorded_at',
          ])}
          AND NEW.reconciliation_lease_token_sha256 IS NULL
          AND NEW.reconciliation_lease_acquired_at IS NULL
          AND NEW.reconciliation_lease_expires_at IS NULL
          AND OLD.resolved_at IS NULL
          AND NEW.resolved_at IS NOT NULL
          AND OLD.resolution_code IS NULL
          AND NEW.resolution_code = 'NOT_RECORDED'
        )
        OR (
          OLD.record_state = 'RECORD_DISPATCHED'
          AND NEW.record_state = 'UNKNOWN'
          AND ${unchangedLifecycleColumns([
            ...DISPATCH_FIELDS,
            'reconcile_not_before',
            'reconciliation_attempt_count',
            ...LEASE_FIELDS,
            ...ERROR_FIELDS,
            ...RESOLUTION_FIELDS,
          ])}
        )
        OR (
          OLD.record_state IN ('RECORD_DISPATCHED', 'UNKNOWN')
          AND NEW.record_state IN (
            'RECORDED', 'IDEMPOTENT_REPLAY', 'NOT_RECORDED', 'DEADLINE_VIOLATION'
          )
          AND ${unchangedLifecycleColumns([
            ...DISPATCH_FIELDS,
            'reconcile_not_before',
            'reconciliation_attempt_count',
            ...ERROR_FIELDS,
          ])}
          AND NEW.reconciliation_lease_token_sha256 IS NULL
          AND NEW.reconciliation_lease_acquired_at IS NULL
          AND NEW.reconciliation_lease_expires_at IS NULL
          AND OLD.deadline_binding_sha256 IS NULL
          AND OLD.evidence_recorded_at IS NULL
          AND OLD.resolved_at IS NULL
          AND OLD.resolution_code IS NULL
        )
        OR (
          OLD.record_state = NEW.record_state
          AND OLD.record_state IN ('NEW', 'RECORD_DISPATCHED', 'UNKNOWN')
          AND ${unchangedLifecycleColumns([
            ...DISPATCH_FIELDS,
            'reconcile_not_before',
            ...ERROR_FIELDS,
            ...RESOLUTION_FIELDS,
          ])}
          AND NEW.reconciliation_attempt_count = OLD.reconciliation_attempt_count + 1
          AND NEW.reconciliation_lease_token_sha256 IS NOT NULL
          AND NEW.reconciliation_lease_token_sha256
            IS DISTINCT FROM OLD.reconciliation_lease_token_sha256
          AND NEW.reconciliation_lease_acquired_at IS NOT NULL
          AND NEW.reconciliation_lease_expires_at IS NOT NULL
        )
        OR (
          OLD.record_state IN ('NEW', 'RECORD_DISPATCHED', 'UNKNOWN')
          AND NEW.record_state = (CASE
            WHEN OLD.record_dispatch_count = 1 THEN 'UNKNOWN'
            ELSE 'NEW'
          END)
          AND ${unchangedLifecycleColumns([
            ...DISPATCH_FIELDS,
            'reconciliation_attempt_count',
            ...RESOLUTION_FIELDS,
          ])}
          AND OLD.reconciliation_lease_token_sha256 IS NOT NULL
          AND OLD.reconciliation_lease_acquired_at IS NOT NULL
          AND OLD.reconciliation_lease_expires_at IS NOT NULL
          AND NEW.reconciliation_lease_token_sha256 IS NULL
          AND NEW.reconciliation_lease_acquired_at IS NULL
          AND NEW.reconciliation_lease_expires_at IS NULL
          AND NEW.last_reconciliation_error_code IS NOT NULL
          AND NEW.last_reconciliation_error_at IS NOT NULL
          AND NEW.last_reconciliation_error_at >= OLD.reconciliation_lease_acquired_at
          AND NEW.reconcile_not_before >= OLD.reconcile_not_before
          AND NEW.reconcile_not_before >= NEW.last_reconciliation_error_at
          AND NEW.reconcile_not_before
            <= NEW.last_reconciliation_error_at + interval '5 minutes'
        )
      ) THEN
        RAISE EXCEPTION 'invalid provider position chain anchor record intent mutation shape'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    `;

const PREPARE_INTENT_BODY = `
    DECLARE
      prior provider_position_chain_anchor_record_intents%ROWTYPE;
      matching_intent_count bigint;
      computed_read_binding_fingerprint text;
      computed_evidence_fingerprint text;
      computed_record_intent_fingerprint text;
      database_prepared_at timestamptz;
    BEGIN
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR NOT pg_catalog.isfinite(requested_producer_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_producer_deadline_at)
          <> requested_producer_deadline_at
        OR requested_assessed_at >= requested_producer_deadline_at
        OR requested_producer_deadline_at > requested_assessed_at + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor record intent deadline'
          USING ERRCODE = '22023';
      END IF;

      computed_read_binding_fingerprint :=
        provider_position_chain_anchor_read_binding_fingerprint(
${evidenceParameters('          ').split(',\n').slice(0, 8).join(',\n')}
        );
      computed_evidence_fingerprint :=
        provider_position_chain_anchor_evidence_fingerprint(
${evidenceParameters('          ')}
        );
      computed_record_intent_fingerprint :=
        provider_position_chain_anchor_record_intent_fingerprint(
          computed_evidence_fingerprint,
          requested_producer_deadline_at
        );
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(computed_read_binding_fingerprint, 56031)
      );
      database_prepared_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF database_prepared_at >= requested_producer_deadline_at
        OR provider_position_chain_anchor_record_intent_header_valid(
          computed_record_intent_fingerprint,
          computed_evidence_fingerprint,
          computed_read_binding_fingerprint,
          1::smallint,
          '${INTENT_USE}',
          false,
          false,
          database_prepared_at,
          requested_producer_deadline_at,
${evidenceParameters('          ')}
        ) IS DISTINCT FROM true
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor record intent evidence'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO provider_position_chain_anchor_record_intents (
        record_intent_fingerprint_sha256,
        evidence_fingerprint_sha256,
        read_binding_fingerprint_sha256,
        record_intent_version,
        record_intent_use,
        may_authorize_financial_action,
        may_persist,
        prepared_at,
        producer_deadline_at,
${evidenceColumns('        ')},
        record_state,
        record_dispatch_count,
        record_dispatch_token_sha256,
        record_dispatched_at,
        reconcile_not_before,
        reconciliation_attempt_count,
        reconciliation_lease_token_sha256,
        reconciliation_lease_acquired_at,
        reconciliation_lease_expires_at,
        last_reconciliation_error_code,
        last_reconciliation_error_at,
        deadline_binding_sha256,
        evidence_recorded_at,
        resolved_at,
        resolution_code
      ) VALUES (
        computed_record_intent_fingerprint,
        computed_evidence_fingerprint,
        computed_read_binding_fingerprint,
        1,
        '${INTENT_USE}',
        false,
        false,
        database_prepared_at,
        requested_producer_deadline_at,
${evidenceParameters('        ')},
        'NEW',
        0,
        NULL,
        NULL,
        requested_producer_deadline_at,
        0,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
      ) ON CONFLICT DO NOTHING;

      SELECT pg_catalog.count(*) INTO matching_intent_count
      FROM provider_position_chain_anchor_record_intents AS intent
      WHERE intent.record_intent_fingerprint_sha256 = computed_record_intent_fingerprint
        OR intent.evidence_fingerprint_sha256 = computed_evidence_fingerprint
        OR intent.read_binding_fingerprint_sha256 = computed_read_binding_fingerprint;
      IF matching_intent_count <> 1 THEN
        RAISE EXCEPTION 'provider position chain anchor record intent conflict cardinality'
          USING ERRCODE = '23505';
      END IF;
      SELECT intent.* INTO STRICT prior
      FROM provider_position_chain_anchor_record_intents AS intent
      WHERE intent.record_intent_fingerprint_sha256 = computed_record_intent_fingerprint
        OR intent.evidence_fingerprint_sha256 = computed_evidence_fingerprint
        OR intent.read_binding_fingerprint_sha256 = computed_read_binding_fingerprint
      FOR UPDATE;
      IF prior.record_intent_fingerprint_sha256
          IS DISTINCT FROM computed_record_intent_fingerprint
        OR prior.evidence_fingerprint_sha256 IS DISTINCT FROM computed_evidence_fingerprint
        OR prior.read_binding_fingerprint_sha256
          IS DISTINCT FROM computed_read_binding_fingerprint
        OR prior.record_intent_version IS DISTINCT FROM 1
        OR prior.record_intent_use IS DISTINCT FROM '${INTENT_USE}'
        OR prior.may_authorize_financial_action IS DISTINCT FROM false
        OR prior.may_persist IS DISTINCT FROM false
        OR prior.producer_deadline_at IS DISTINCT FROM requested_producer_deadline_at
${evidenceComparisons()}
      THEN
        RAISE EXCEPTION 'provider position chain anchor record intent replay conflict'
          USING ERRCODE = '23505';
      END IF;

      RETURN QUERY SELECT
        prior.record_state,
        prior.record_intent_fingerprint_sha256,
        prior.evidence_fingerprint_sha256,
        prior.read_binding_fingerprint_sha256,
        prior.deadline_binding_sha256,
        prior.evidence_recorded_at,
        prior.resolved_at,
        prior.producer_deadline_at;
    END;
    `;

const CLAIM_DISPATCH_BODY = `
    DECLARE
      intent provider_position_chain_anchor_record_intents%ROWTYPE;
      requested_dispatch_token_sha256 text;
      database_claimed_at timestamptz;
    BEGIN
      IF pg_catalog.octet_length(requested_raw_dispatch_token) <> 32
        OR requested_raw_dispatch_token =
          pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor dispatch token'
          USING ERRCODE = '22023';
      END IF;
      SELECT stored.* INTO intent
      FROM provider_position_chain_anchor_record_intents AS stored
      WHERE stored.record_intent_fingerprint_sha256 = requested_record_intent_fingerprint_sha256
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider position chain anchor record intent does not exist'
          USING ERRCODE = '23503';
      END IF;
      requested_dispatch_token_sha256 :=
        provider_chain_anchor_record_dispatch_token_fingerprint(
          intent.record_intent_fingerprint_sha256,
          requested_raw_dispatch_token
        );

      IF intent.record_state = 'NEW' THEN
        database_claimed_at := pg_catalog.date_trunc(
          'milliseconds', pg_catalog.clock_timestamp()
        );
        IF database_claimed_at < intent.prepared_at THEN
          RAISE EXCEPTION 'provider position chain anchor database clock regressed'
            USING ERRCODE = '55000';
        ELSIF database_claimed_at >= intent.producer_deadline_at THEN
          UPDATE provider_position_chain_anchor_record_intents
          SET record_state = 'NOT_RECORDED',
            reconciliation_lease_token_sha256 = NULL,
            reconciliation_lease_acquired_at = NULL,
            reconciliation_lease_expires_at = NULL,
            resolved_at = database_claimed_at,
            resolution_code = 'NOT_RECORDED'
          WHERE record_intent_fingerprint_sha256 =
            requested_record_intent_fingerprint_sha256
          RETURNING * INTO intent;
        ELSE
          UPDATE provider_position_chain_anchor_record_intents
          SET record_state = 'RECORD_DISPATCHED',
            record_dispatch_count = 1,
            record_dispatch_token_sha256 = requested_dispatch_token_sha256,
            record_dispatched_at = database_claimed_at,
            reconcile_not_before = producer_deadline_at
          WHERE record_intent_fingerprint_sha256 =
            requested_record_intent_fingerprint_sha256
          RETURNING * INTO intent;
        END IF;
      ELSIF intent.record_dispatch_count <> 1
        OR intent.record_dispatch_token_sha256
          IS DISTINCT FROM requested_dispatch_token_sha256
      THEN
        RAISE EXCEPTION 'provider position chain anchor record dispatch claim conflict'
          USING ERRCODE = '23505';
      END IF;

      RETURN QUERY SELECT
        intent.record_state,
        intent.record_intent_fingerprint_sha256,
        intent.evidence_fingerprint_sha256,
        intent.read_binding_fingerprint_sha256,
        intent.deadline_binding_sha256,
        intent.evidence_recorded_at,
        intent.resolved_at,
        intent.producer_deadline_at;
    END;
    `;

const EXECUTE_RECORD_BODY = `
    DECLARE
      intent provider_position_chain_anchor_record_intents%ROWTYPE;
      requested_dispatch_token_sha256 text;
      stored_outcome text;
      stored_fingerprint text;
      stored_recorded_at timestamptz;
      stored_deadline_binding text;
      database_started_at timestamptz;
      database_resolved_at timestamptz;
    BEGIN
      IF pg_catalog.octet_length(requested_raw_dispatch_token) <> 32
        OR requested_raw_dispatch_token =
          pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor dispatch token'
          USING ERRCODE = '22023';
      END IF;
      -- The durable intent row is always locked before migration 0030 takes
      -- its read-binding advisory lock.
      SELECT stored.* INTO intent
      FROM provider_position_chain_anchor_record_intents AS stored
      WHERE stored.record_intent_fingerprint_sha256 = requested_record_intent_fingerprint_sha256
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider position chain anchor record intent does not exist'
          USING ERRCODE = '23503';
      END IF;
      requested_dispatch_token_sha256 :=
        provider_chain_anchor_record_dispatch_token_fingerprint(
          intent.record_intent_fingerprint_sha256,
          requested_raw_dispatch_token
        );
      IF intent.record_dispatch_count <> 1
        OR intent.record_dispatch_token_sha256
          IS DISTINCT FROM requested_dispatch_token_sha256
      THEN
        RAISE EXCEPTION 'provider position chain anchor record dispatch token conflict'
          USING ERRCODE = '23505';
      END IF;

      -- A committed prior execution is terminal. Any non-dispatch state is
      -- returned without entering migration 0030's RECORD path again.
      IF intent.record_state <> 'RECORD_DISPATCHED' THEN
        RETURN QUERY SELECT
          intent.record_state,
          intent.record_intent_fingerprint_sha256,
          intent.evidence_fingerprint_sha256,
          intent.read_binding_fingerprint_sha256,
          intent.deadline_binding_sha256,
          intent.evidence_recorded_at,
          intent.resolved_at,
          intent.producer_deadline_at;
        RETURN;
      END IF;

      database_started_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF database_started_at < intent.record_dispatched_at
        OR database_started_at >= intent.producer_deadline_at
      THEN
        RAISE EXCEPTION 'provider position chain anchor record intent deadline expired'
          USING ERRCODE = '55000';
      END IF;

      SET CONSTRAINTS provider_position_chain_anchor_evidence_deadline_fk,
        provider_position_chain_anchor_deadline_intent_fk,
        provider_position_chain_anchor_deadline_intent_terminal_check DEFERRED;

      SELECT guarded.record_outcome,
        guarded.recorded_evidence_fingerprint_sha256,
        guarded.evidence_recorded_at
      INTO STRICT stored_outcome, stored_fingerprint, stored_recorded_at
      FROM record_provider_position_chain_anchor_evidence_guarded(
${evidenceParameters('        ', 'intent.')},
        intent.producer_deadline_at,
        'RECORD'
      ) AS guarded;
      IF stored_outcome NOT IN (
        'RECORDED', 'IDEMPOTENT_REPLAY', 'NOT_RECORDED'
      ) OR (
        stored_outcome IN ('RECORDED', 'IDEMPOTENT_REPLAY')
        AND (
          stored_fingerprint IS DISTINCT FROM intent.evidence_fingerprint_sha256
          OR stored_recorded_at IS NULL
        )
      ) OR (
        stored_outcome = 'NOT_RECORDED'
        AND (stored_fingerprint IS NOT NULL OR stored_recorded_at IS NOT NULL)
      ) THEN
        RAISE EXCEPTION 'invalid provider position chain anchor record outcome'
          USING ERRCODE = '21000';
      END IF;

      stored_deadline_binding := NULL;
      IF stored_outcome IN ('RECORDED', 'IDEMPOTENT_REPLAY') THEN
        SELECT deadline.deadline_binding_sha256 INTO STRICT stored_deadline_binding
        FROM provider_position_chain_anchor_record_deadlines AS deadline
        WHERE deadline.evidence_fingerprint_sha256 = intent.evidence_fingerprint_sha256
          AND deadline.producer_deadline_at = intent.producer_deadline_at
          AND deadline.evidence_recorded_at = stored_recorded_at;
        IF stored_deadline_binding IS DISTINCT FROM
          provider_position_chain_anchor_record_deadline_fingerprint(
            intent.evidence_fingerprint_sha256,
            intent.producer_deadline_at,
            stored_recorded_at
          )
        THEN
          RAISE EXCEPTION 'provider position chain anchor record binding conflict'
            USING ERRCODE = '23505';
        END IF;
      END IF;

      database_resolved_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF database_resolved_at < database_started_at THEN
        RAISE EXCEPTION 'provider position chain anchor database clock regressed'
          USING ERRCODE = '55000';
      END IF;
      UPDATE provider_position_chain_anchor_record_intents
      SET record_state = stored_outcome,
        reconciliation_lease_token_sha256 = NULL,
        reconciliation_lease_acquired_at = NULL,
        reconciliation_lease_expires_at = NULL,
        deadline_binding_sha256 = stored_deadline_binding,
        evidence_recorded_at = CASE
          WHEN stored_outcome = 'NOT_RECORDED' THEN NULL
          ELSE stored_recorded_at
        END,
        resolved_at = database_resolved_at,
        resolution_code = stored_outcome
      WHERE record_intent_fingerprint_sha256 = intent.record_intent_fingerprint_sha256
      RETURNING * INTO intent;

      RETURN QUERY SELECT
        intent.record_state,
        intent.record_intent_fingerprint_sha256,
        intent.evidence_fingerprint_sha256,
        intent.read_binding_fingerprint_sha256,
        intent.deadline_binding_sha256,
        intent.evidence_recorded_at,
        intent.resolved_at,
        intent.producer_deadline_at;
    END;
    `;

const MARK_UNKNOWN_BODY = `
    DECLARE
      intent provider_position_chain_anchor_record_intents%ROWTYPE;
      requested_dispatch_token_sha256 text;
    BEGIN
      IF pg_catalog.octet_length(requested_raw_dispatch_token) <> 32
        OR requested_raw_dispatch_token =
          pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor dispatch token'
          USING ERRCODE = '22023';
      END IF;
      SELECT stored.* INTO intent
      FROM provider_position_chain_anchor_record_intents AS stored
      WHERE stored.record_intent_fingerprint_sha256 = requested_record_intent_fingerprint_sha256
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider position chain anchor record intent does not exist'
          USING ERRCODE = '23503';
      END IF;
      requested_dispatch_token_sha256 :=
        provider_chain_anchor_record_dispatch_token_fingerprint(
          intent.record_intent_fingerprint_sha256,
          requested_raw_dispatch_token
        );
      IF intent.record_dispatch_count <> 1
        OR intent.record_dispatch_token_sha256
          IS DISTINCT FROM requested_dispatch_token_sha256
      THEN
        RAISE EXCEPTION 'provider position chain anchor record dispatch token conflict'
          USING ERRCODE = '23505';
      END IF;
      IF intent.record_state = 'RECORD_DISPATCHED' THEN
        UPDATE provider_position_chain_anchor_record_intents
        SET record_state = 'UNKNOWN',
          reconcile_not_before = pg_catalog.greatest(
            reconcile_not_before, producer_deadline_at
          )
        WHERE record_intent_fingerprint_sha256 = intent.record_intent_fingerprint_sha256
        RETURNING * INTO intent;
      ELSIF intent.record_state = 'NEW' THEN
        RAISE EXCEPTION 'provider position chain anchor record intent was not dispatched'
          USING ERRCODE = '55000';
      END IF;

      RETURN QUERY SELECT
        intent.record_state,
        intent.record_intent_fingerprint_sha256,
        intent.evidence_fingerprint_sha256,
        intent.read_binding_fingerprint_sha256,
        intent.deadline_binding_sha256,
        intent.evidence_recorded_at,
        intent.resolved_at,
        intent.producer_deadline_at;
    END;
    `;

const DEADLINE_INTENT_GUARD_BODY = `
    DECLARE
      intent provider_position_chain_anchor_record_intents%ROWTYPE;
    BEGIN
      SELECT stored.* INTO intent
      FROM provider_position_chain_anchor_record_intents AS stored
      WHERE stored.evidence_fingerprint_sha256 = NEW.evidence_fingerprint_sha256
        AND stored.producer_deadline_at = NEW.producer_deadline_at;
      IF NOT FOUND
        OR intent.record_state NOT IN ('RECORDED', 'IDEMPOTENT_REPLAY')
        OR intent.deadline_binding_sha256 IS DISTINCT FROM NEW.deadline_binding_sha256
        OR intent.evidence_recorded_at IS DISTINCT FROM NEW.evidence_recorded_at
      THEN
        RAISE EXCEPTION
          'provider position chain anchor deadline lacks a terminal record intent binding'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    `;

const LEASE_RECONCILIATION_BODY = `
    DECLARE
      intent provider_position_chain_anchor_record_intents%ROWTYPE;
      requested_lease_token_sha256 text;
      database_scanned_at timestamptz;
      database_leased_at timestamptz;
      database_lease_expires_at timestamptz;
    BEGIN
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR pg_catalog.octet_length(requested_raw_lease_token) <> 32
        OR requested_raw_lease_token =
          pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
        OR requested_lease_duration < interval '5 seconds'
        OR requested_lease_duration > interval '60 seconds'
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor reconciliation lease'
          USING ERRCODE = '22023';
      END IF;
      database_scanned_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );

      SELECT stored.* INTO intent
      FROM provider_position_chain_anchor_record_intents AS stored
      WHERE (
          (
            stored.record_state = 'NEW'
            AND stored.producer_deadline_at <= database_scanned_at
            AND stored.reconcile_not_before <= database_scanned_at
          )
          OR (
            stored.record_state IN ('RECORD_DISPATCHED', 'UNKNOWN')
            AND stored.reconcile_not_before <= database_scanned_at
            AND stored.producer_deadline_at <= database_scanned_at
          )
        )
        AND (
          stored.reconciliation_lease_token_sha256 IS NULL
          OR stored.reconciliation_lease_expires_at <= database_scanned_at
        )
      ORDER BY stored.producer_deadline_at,
        stored.reconcile_not_before,
        stored.prepared_at,
        stored.record_intent_fingerprint_sha256
      FOR UPDATE SKIP LOCKED
      LIMIT 1;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      database_leased_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF database_leased_at < database_scanned_at
        OR database_leased_at < intent.producer_deadline_at
        OR database_leased_at < intent.reconcile_not_before
        OR (
          intent.reconciliation_lease_token_sha256 IS NOT NULL
          AND intent.reconciliation_lease_expires_at > database_leased_at
        )
      THEN
        RAISE EXCEPTION 'provider position chain anchor reconciliation lease race'
          USING ERRCODE = '55000';
      END IF;
      requested_lease_token_sha256 :=
        provider_chain_anchor_reconciliation_lease_token_fingerprint(
          intent.record_intent_fingerprint_sha256,
          requested_raw_lease_token
        );

      database_lease_expires_at := pg_catalog.date_trunc(
        'milliseconds', database_leased_at + requested_lease_duration
      );
      UPDATE provider_position_chain_anchor_record_intents
      SET reconciliation_attempt_count = reconciliation_attempt_count + 1,
        reconciliation_lease_token_sha256 = requested_lease_token_sha256,
        reconciliation_lease_acquired_at = database_leased_at,
        reconciliation_lease_expires_at = database_lease_expires_at
      WHERE record_intent_fingerprint_sha256 = intent.record_intent_fingerprint_sha256
      RETURNING * INTO intent;

      RETURN QUERY SELECT
        intent.record_intent_fingerprint_sha256,
        intent.evidence_fingerprint_sha256,
        intent.record_state,
        intent.producer_deadline_at,
        intent.reconciliation_attempt_count,
        intent.reconciliation_lease_acquired_at,
        intent.reconciliation_lease_expires_at;
    END;
    `;

const RECONCILE_INTENT_BODY = `
    DECLARE
      intent provider_position_chain_anchor_record_intents%ROWTYPE;
      requested_lease_token_sha256 text;
      stored_outcome text;
      stored_fingerprint text;
      stored_recorded_at timestamptz;
      stored_deadline_binding text;
      database_started_at timestamptz;
      database_resolved_at timestamptz;
    BEGIN
      IF pg_catalog.octet_length(requested_raw_lease_token) <> 32
        OR requested_raw_lease_token =
          pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor reconciliation lease token'
          USING ERRCODE = '22023';
      END IF;
      SELECT stored.* INTO intent
      FROM provider_position_chain_anchor_record_intents AS stored
      WHERE stored.record_intent_fingerprint_sha256 = requested_record_intent_fingerprint_sha256
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider position chain anchor record intent does not exist'
          USING ERRCODE = '23503';
      END IF;
      database_started_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      requested_lease_token_sha256 :=
        provider_chain_anchor_reconciliation_lease_token_fingerprint(
          intent.record_intent_fingerprint_sha256,
          requested_raw_lease_token
        );
      IF intent.reconciliation_lease_token_sha256
          IS DISTINCT FROM requested_lease_token_sha256
        OR intent.reconciliation_lease_acquired_at IS NULL
        OR database_started_at < intent.reconciliation_lease_acquired_at
        OR intent.reconciliation_lease_expires_at <= database_started_at
      THEN
        RAISE EXCEPTION 'provider position chain anchor reconciliation lease conflict'
          USING ERRCODE = '55000';
      END IF;
      IF database_started_at < intent.producer_deadline_at
        OR database_started_at < intent.reconcile_not_before
      THEN
        RAISE EXCEPTION 'provider position chain anchor reconciliation is premature'
          USING ERRCODE = '55000';
      END IF;

      IF intent.record_state = 'NEW' THEN
        database_resolved_at := pg_catalog.date_trunc(
          'milliseconds', pg_catalog.clock_timestamp()
        );
        IF database_resolved_at < database_started_at THEN
          RAISE EXCEPTION 'provider position chain anchor database clock regressed'
            USING ERRCODE = '55000';
        END IF;
        UPDATE provider_position_chain_anchor_record_intents
        SET record_state = 'NOT_RECORDED',
          reconciliation_lease_token_sha256 = NULL,
          reconciliation_lease_acquired_at = NULL,
          reconciliation_lease_expires_at = NULL,
          deadline_binding_sha256 = NULL,
          evidence_recorded_at = NULL,
          resolved_at = database_resolved_at,
          resolution_code = 'NOT_RECORDED'
        WHERE record_intent_fingerprint_sha256 = intent.record_intent_fingerprint_sha256
        RETURNING * INTO intent;
        RETURN QUERY SELECT
          intent.record_state,
          intent.record_intent_fingerprint_sha256,
          intent.evidence_fingerprint_sha256,
          intent.read_binding_fingerprint_sha256,
          intent.deadline_binding_sha256,
          intent.evidence_recorded_at,
          intent.resolved_at,
          intent.producer_deadline_at;
        RETURN;
      END IF;
      IF intent.record_state NOT IN ('RECORD_DISPATCHED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'provider position chain anchor record intent is not reconcilable'
          USING ERRCODE = '55000';
      END IF;

      -- Reconciliation has no caller-selectable operation and no RECORD branch.
      SELECT guarded.record_outcome,
        guarded.recorded_evidence_fingerprint_sha256,
        guarded.evidence_recorded_at
      INTO STRICT stored_outcome, stored_fingerprint, stored_recorded_at
      FROM record_provider_position_chain_anchor_evidence_guarded(
${evidenceParameters('        ', 'intent.')},
        intent.producer_deadline_at,
        'RECONCILE_ONLY'
      ) AS guarded;
      IF stored_outcome NOT IN (
        'IDEMPOTENT_REPLAY', 'NOT_RECORDED', 'DEADLINE_VIOLATION'
      ) OR (
        stored_outcome IN ('IDEMPOTENT_REPLAY', 'DEADLINE_VIOLATION')
        AND (
          stored_fingerprint IS DISTINCT FROM intent.evidence_fingerprint_sha256
          OR stored_recorded_at IS NULL
        )
      ) OR (
        stored_outcome = 'NOT_RECORDED'
        AND (stored_fingerprint IS NOT NULL OR stored_recorded_at IS NOT NULL)
      ) THEN
        RAISE EXCEPTION 'invalid provider position chain anchor reconciliation outcome'
          USING ERRCODE = '21000';
      END IF;

      stored_deadline_binding := NULL;
      IF stored_outcome = 'IDEMPOTENT_REPLAY' THEN
        SELECT deadline.deadline_binding_sha256 INTO STRICT stored_deadline_binding
        FROM provider_position_chain_anchor_record_deadlines AS deadline
        WHERE deadline.evidence_fingerprint_sha256 = intent.evidence_fingerprint_sha256
          AND deadline.producer_deadline_at = intent.producer_deadline_at
          AND deadline.evidence_recorded_at = stored_recorded_at;
        IF stored_deadline_binding IS DISTINCT FROM
          provider_position_chain_anchor_record_deadline_fingerprint(
            intent.evidence_fingerprint_sha256,
            intent.producer_deadline_at,
            stored_recorded_at
          )
        THEN
          RAISE EXCEPTION 'provider position chain anchor reconciliation binding conflict'
            USING ERRCODE = '23505';
        END IF;
      END IF;

      database_resolved_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF database_resolved_at < database_started_at THEN
        RAISE EXCEPTION 'provider position chain anchor database clock regressed'
          USING ERRCODE = '55000';
      END IF;
      UPDATE provider_position_chain_anchor_record_intents
      SET record_state = stored_outcome,
        reconciliation_lease_token_sha256 = NULL,
        reconciliation_lease_acquired_at = NULL,
        reconciliation_lease_expires_at = NULL,
        deadline_binding_sha256 = stored_deadline_binding,
        evidence_recorded_at = CASE
          WHEN stored_outcome = 'NOT_RECORDED' THEN NULL
          ELSE stored_recorded_at
        END,
        resolved_at = database_resolved_at,
        resolution_code = stored_outcome
      WHERE record_intent_fingerprint_sha256 = intent.record_intent_fingerprint_sha256
      RETURNING * INTO intent;

      RETURN QUERY SELECT
        intent.record_state,
        intent.record_intent_fingerprint_sha256,
        intent.evidence_fingerprint_sha256,
        intent.read_binding_fingerprint_sha256,
        intent.deadline_binding_sha256,
        intent.evidence_recorded_at,
        intent.resolved_at,
        intent.producer_deadline_at;
    END;
    `;

const RELEASE_RECONCILIATION_BODY = `
    DECLARE
      intent provider_position_chain_anchor_record_intents%ROWTYPE;
      requested_lease_token_sha256 text;
      database_released_at timestamptz;
    BEGIN
      IF pg_catalog.octet_length(requested_raw_lease_token) <> 32
        OR requested_raw_lease_token =
          pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex')
        OR requested_error_code NOT IN (
          'ANCHOR_RECONCILIATION_TRANSPORT_FAILED',
          'ANCHOR_RECONCILIATION_TRANSPORT_TIMEOUT',
          'ANCHOR_RECONCILIATION_DATABASE_UNAVAILABLE',
          'ANCHOR_RECONCILIATION_CANCELLED'
        )
        OR NOT pg_catalog.isfinite(requested_reconcile_not_before)
        OR pg_catalog.date_trunc('milliseconds', requested_reconcile_not_before)
          <> requested_reconcile_not_before
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor reconciliation release'
          USING ERRCODE = '22023';
      END IF;
      SELECT stored.* INTO intent
      FROM provider_position_chain_anchor_record_intents AS stored
      WHERE stored.record_intent_fingerprint_sha256 = requested_record_intent_fingerprint_sha256
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider position chain anchor record intent does not exist'
          USING ERRCODE = '23503';
      END IF;
      database_released_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      requested_lease_token_sha256 :=
        provider_chain_anchor_reconciliation_lease_token_fingerprint(
          intent.record_intent_fingerprint_sha256,
          requested_raw_lease_token
        );
      IF intent.record_state NOT IN ('NEW', 'RECORD_DISPATCHED', 'UNKNOWN')
        OR intent.reconciliation_lease_token_sha256
          IS DISTINCT FROM requested_lease_token_sha256
        OR intent.reconciliation_lease_acquired_at IS NULL
        OR database_released_at < intent.reconciliation_lease_acquired_at
        OR intent.reconciliation_lease_expires_at <= database_released_at
        OR requested_reconcile_not_before < intent.producer_deadline_at
        OR requested_reconcile_not_before < database_released_at
        OR requested_reconcile_not_before > database_released_at + interval '5 minutes'
      THEN
        RAISE EXCEPTION 'provider position chain anchor reconciliation release conflict'
          USING ERRCODE = '55000';
      END IF;

      UPDATE provider_position_chain_anchor_record_intents
      SET record_state = CASE
          WHEN record_dispatch_count = 1 THEN 'UNKNOWN'
          ELSE 'NEW'
        END,
        reconcile_not_before = pg_catalog.greatest(
          reconcile_not_before, requested_reconcile_not_before, producer_deadline_at
        ),
        reconciliation_lease_token_sha256 = NULL,
        reconciliation_lease_acquired_at = NULL,
        reconciliation_lease_expires_at = NULL,
        last_reconciliation_error_code = requested_error_code,
        last_reconciliation_error_at = database_released_at
      WHERE record_intent_fingerprint_sha256 = intent.record_intent_fingerprint_sha256
      RETURNING * INTO intent;

      RETURN QUERY SELECT
        intent.record_intent_fingerprint_sha256,
        intent.evidence_fingerprint_sha256,
        intent.record_state,
        intent.reconcile_not_before,
        intent.reconciliation_attempt_count,
        intent.last_reconciliation_error_code,
        intent.last_reconciliation_error_at;
    END;
    `;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `LOCK TABLE ${EVIDENCE_TABLE}, ${DEADLINE_TABLE} IN ACCESS EXCLUSIVE MODE;
    DO $refuse_unrecoverable_provider_position_chain_anchor_intent_history$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${EVIDENCE_TABLE})
        OR EXISTS (SELECT 1 FROM ${DEADLINE_TABLE})
      THEN
        RAISE EXCEPTION
          'cannot install provider position chain anchor record intents after record history exists'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_unrecoverable_provider_position_chain_anchor_intent_history$;

    CREATE FUNCTION provider_position_chain_anchor_record_intent_fingerprint(
      requested_evidence_fingerprint_sha256 text,
      requested_producer_deadline_at timestamptz
    ) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${INTENT_FINGERPRINT_BODY}$function$;

    CREATE FUNCTION provider_chain_anchor_record_dispatch_token_fingerprint(
      requested_record_intent_fingerprint_sha256 text,
      requested_raw_dispatch_token bytea
    ) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${DISPATCH_TOKEN_FINGERPRINT_BODY}$function$;

    CREATE FUNCTION provider_chain_anchor_reconciliation_lease_token_fingerprint(
      requested_record_intent_fingerprint_sha256 text,
      requested_raw_lease_token bytea
    ) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${RECONCILIATION_LEASE_TOKEN_FINGERPRINT_BODY}$function$;

    CREATE FUNCTION provider_position_chain_anchor_record_intent_header_valid(
      requested_record_intent_fingerprint_sha256 text,
      requested_evidence_fingerprint_sha256 text,
      requested_read_binding_fingerprint_sha256 text,
      requested_record_intent_version smallint,
      requested_record_intent_use text,
      requested_may_authorize_financial_action boolean,
      requested_may_persist boolean,
      requested_prepared_at timestamptz,
      requested_producer_deadline_at timestamptz,
${evidenceDeclarations('      ')}
    ) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${HEADER_VALID_BODY}$function$;

    CREATE FUNCTION provider_position_chain_anchor_record_intent_lifecycle_valid(
      requested_record_state text,
      requested_record_dispatch_count smallint,
      requested_record_dispatch_token_sha256 text,
      requested_record_dispatched_at timestamptz,
      requested_reconcile_not_before timestamptz,
      requested_reconciliation_attempt_count bigint,
      requested_reconciliation_lease_token_sha256 text,
      requested_reconciliation_lease_acquired_at timestamptz,
      requested_reconciliation_lease_expires_at timestamptz,
      requested_last_reconciliation_error_code text,
      requested_last_reconciliation_error_at timestamptz,
      requested_deadline_binding_sha256 text,
      requested_evidence_recorded_at timestamptz,
      requested_resolved_at timestamptz,
      requested_resolution_code text,
      requested_evidence_fingerprint_sha256 text,
      requested_producer_deadline_at timestamptz,
      requested_prepared_at timestamptz
    ) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $function$${LIFECYCLE_VALID_BODY}$function$;

    DO $set_provider_position_chain_anchor_intent_validation_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${HEADER_VALID} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${LIFECYCLE_VALID} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_provider_position_chain_anchor_intent_validation_paths$;

    CREATE TABLE ${INTENT_TABLE} (
      record_intent_fingerprint_sha256 text NOT NULL,
      evidence_fingerprint_sha256 text NOT NULL,
      read_binding_fingerprint_sha256 text NOT NULL,
      record_intent_version smallint NOT NULL,
      record_intent_use text NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      may_persist boolean NOT NULL,
      prepared_at timestamptz NOT NULL,
      producer_deadline_at timestamptz NOT NULL,
${EVIDENCE_FIELDS.map(([column, , type]) => `      ${column} ${type} NOT NULL`).join(',\n')},
      record_state text NOT NULL,
      record_dispatch_count smallint NOT NULL,
      record_dispatch_token_sha256 text,
      record_dispatched_at timestamptz,
      reconcile_not_before timestamptz NOT NULL,
      reconciliation_attempt_count bigint NOT NULL,
      reconciliation_lease_token_sha256 text,
      reconciliation_lease_acquired_at timestamptz,
      reconciliation_lease_expires_at timestamptz,
      last_reconciliation_error_code text,
      last_reconciliation_error_at timestamptz,
      deadline_binding_sha256 text,
      evidence_recorded_at timestamptz,
      resolved_at timestamptz,
      resolution_code text,
      CONSTRAINT ${INTENT_TABLE}_pkey PRIMARY KEY (record_intent_fingerprint_sha256),
      CONSTRAINT provider_position_chain_anchor_record_intent_evidence_unique
        UNIQUE (evidence_fingerprint_sha256),
      CONSTRAINT provider_chain_anchor_intent_read_binding_unique
        UNIQUE (read_binding_fingerprint_sha256),
      CONSTRAINT provider_chain_anchor_intent_evidence_deadline_unique
        UNIQUE (evidence_fingerprint_sha256, producer_deadline_at),
      CONSTRAINT provider_chain_anchor_intent_deadline_binding_fk
        FOREIGN KEY (deadline_binding_sha256)
        REFERENCES ${DEADLINE_TABLE} (deadline_binding_sha256)
        ON UPDATE NO ACTION ON DELETE NO ACTION
        DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT provider_position_chain_anchor_record_intent_header_valid_check CHECK (
        ${HEADER_VALID_CALL} IS TRUE
      ),
      CONSTRAINT provider_chain_anchor_intent_lifecycle_valid_check CHECK (
        ${LIFECYCLE_VALID_CALL} IS TRUE
      )
    );
    COMMENT ON TABLE ${INTENT_TABLE} IS '${INTENT_MANIFEST}';

    CREATE UNIQUE INDEX provider_position_chain_anchor_record_dispatch_token_unique
      ON ${INTENT_TABLE} (record_dispatch_token_sha256)
      WHERE record_dispatch_token_sha256 IS NOT NULL;
    CREATE UNIQUE INDEX provider_chain_anchor_reconciliation_lease_token_unique
      ON ${INTENT_TABLE} (reconciliation_lease_token_sha256)
      WHERE reconciliation_lease_token_sha256 IS NOT NULL;
    CREATE INDEX provider_position_chain_anchor_record_intent_reconcile_scan_idx
      ON ${INTENT_TABLE} (
        record_state,
        reconcile_not_before,
        producer_deadline_at,
        prepared_at,
        record_intent_fingerprint_sha256
      ) WHERE record_state = ANY (
        ARRAY['NEW'::text, 'RECORD_DISPATCHED'::text, 'UNKNOWN'::text]
      );

    ALTER TABLE ${DEADLINE_TABLE}
      ADD CONSTRAINT provider_position_chain_anchor_deadline_intent_fk
      FOREIGN KEY (evidence_fingerprint_sha256, producer_deadline_at)
      REFERENCES ${INTENT_TABLE} (evidence_fingerprint_sha256, producer_deadline_at)
      ON UPDATE NO ACTION ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED;

    CREATE FUNCTION enforce_provider_position_chain_anchor_record_intent_transition()
    RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
    SET search_path TO pg_catalog
    AS $function$${TRANSITION_GUARD_BODY}$function$;
    CREATE TRIGGER provider_position_chain_anchor_record_intent_transition
      BEFORE UPDATE ON ${INTENT_TABLE}
      FOR EACH ROW EXECUTE FUNCTION
        enforce_provider_position_chain_anchor_record_intent_transition();
    CREATE TRIGGER provider_position_chain_anchor_record_intent_retain_row
      BEFORE DELETE ON ${INTENT_TABLE}
      FOR EACH ROW EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    CREATE TRIGGER provider_position_chain_anchor_record_intent_retain_truncate
      BEFORE TRUNCATE ON ${INTENT_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    ALTER TABLE ${INTENT_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_record_intent_transition;
    ALTER TABLE ${INTENT_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_record_intent_retain_row;
    ALTER TABLE ${INTENT_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_record_intent_retain_truncate;

    CREATE FUNCTION enforce_provider_chain_anchor_record_deadline_intent_binding()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${DEADLINE_INTENT_GUARD_BODY}$function$;
    DO $set_provider_position_chain_anchor_deadline_intent_guard_path$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${DEADLINE_INTENT_GUARD} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_provider_position_chain_anchor_deadline_intent_guard_path$;
    CREATE CONSTRAINT TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check
      AFTER INSERT ON ${DEADLINE_TABLE}
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION
        enforce_provider_chain_anchor_record_deadline_intent_binding();
    ALTER TABLE ${DEADLINE_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_deadline_intent_terminal_check;

    CREATE FUNCTION prepare_provider_position_chain_anchor_record_intent(
${evidenceDeclarations('      ')},
      requested_producer_deadline_at timestamptz
    ) RETURNS TABLE (
      intent_state text,
      prepared_record_intent_fingerprint_sha256 text,
      prepared_evidence_fingerprint_sha256 text,
      prepared_read_binding_fingerprint_sha256 text,
      prepared_deadline_binding_sha256 text,
      prepared_evidence_recorded_at timestamptz,
      prepared_resolved_at timestamptz,
      prepared_producer_deadline_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${PREPARE_INTENT_BODY}$function$;

    CREATE FUNCTION claim_provider_position_chain_anchor_record_dispatch(
      requested_record_intent_fingerprint_sha256 text,
      requested_raw_dispatch_token bytea
    ) RETURNS TABLE (
      intent_state text,
      claimed_record_intent_fingerprint_sha256 text,
      claimed_evidence_fingerprint_sha256 text,
      claimed_read_binding_fingerprint_sha256 text,
      claimed_deadline_binding_sha256 text,
      claimed_evidence_recorded_at timestamptz,
      claimed_resolved_at timestamptz,
      claimed_producer_deadline_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${CLAIM_DISPATCH_BODY}$function$;

    CREATE FUNCTION execute_provider_position_chain_anchor_record_intent(
      requested_record_intent_fingerprint_sha256 text,
      requested_raw_dispatch_token bytea
    ) RETURNS TABLE (
      intent_state text,
      executed_record_intent_fingerprint_sha256 text,
      executed_evidence_fingerprint_sha256 text,
      executed_read_binding_fingerprint_sha256 text,
      executed_deadline_binding_sha256 text,
      executed_evidence_recorded_at timestamptz,
      executed_resolved_at timestamptz,
      executed_producer_deadline_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${EXECUTE_RECORD_BODY}$function$;

    CREATE FUNCTION mark_provider_position_chain_anchor_record_intent_unknown(
      requested_record_intent_fingerprint_sha256 text,
      requested_raw_dispatch_token bytea
    ) RETURNS TABLE (
      intent_state text,
      marked_record_intent_fingerprint_sha256 text,
      marked_evidence_fingerprint_sha256 text,
      marked_read_binding_fingerprint_sha256 text,
      marked_deadline_binding_sha256 text,
      marked_evidence_recorded_at timestamptz,
      marked_resolved_at timestamptz,
      marked_producer_deadline_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${MARK_UNKNOWN_BODY}$function$;

    CREATE FUNCTION lease_provider_chain_anchor_record_intent_reconciliation(
      requested_raw_lease_token bytea,
      requested_lease_duration interval
    ) RETURNS TABLE (
      leased_record_intent_fingerprint_sha256 text,
      leased_evidence_fingerprint_sha256 text,
      leased_intent_state text,
      leased_producer_deadline_at timestamptz,
      leased_reconciliation_attempt_count bigint,
      leased_at timestamptz,
      lease_expires_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${LEASE_RECONCILIATION_BODY}$function$;

    CREATE FUNCTION reconcile_provider_position_chain_anchor_record_intent(
      requested_record_intent_fingerprint_sha256 text,
      requested_raw_lease_token bytea
    ) RETURNS TABLE (
      intent_state text,
      reconciled_record_intent_fingerprint_sha256 text,
      reconciled_evidence_fingerprint_sha256 text,
      reconciled_read_binding_fingerprint_sha256 text,
      reconciled_deadline_binding_sha256 text,
      reconciled_evidence_recorded_at timestamptz,
      reconciled_resolved_at timestamptz,
      reconciled_producer_deadline_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RECONCILE_INTENT_BODY}$function$;

    CREATE FUNCTION release_provider_chain_anchor_record_intent_reconciliation(
      requested_record_intent_fingerprint_sha256 text,
      requested_raw_lease_token bytea,
      requested_error_code text,
      requested_reconcile_not_before timestamptz
    ) RETURNS TABLE (
      released_record_intent_fingerprint_sha256 text,
      released_evidence_fingerprint_sha256 text,
      released_intent_state text,
      released_reconcile_not_before timestamptz,
      released_reconciliation_attempt_count bigint,
      released_error_code text,
      released_error_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RELEASE_RECONCILIATION_BODY}$function$;

    DO $set_provider_position_chain_anchor_record_intent_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${[
        PREPARE_INTENT,
        CLAIM_DISPATCH,
        EXECUTE_RECORD,
        MARK_UNKNOWN,
        LEASE_RECONCILIATION,
        RECONCILE_INTENT,
        RELEASE_RECONCILIATION,
      ]
        .map(
          (functionIdentity) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${functionIdentity} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );`,
        )
        .join('\n      ')}
    END;
    $set_provider_position_chain_anchor_record_intent_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${INTENT_TABLE} FROM ${guardedRoles};
    REVOKE ALL PRIVILEGES ON TYPE ${INTENT_TABLE} FROM ${guardedRoles};
    ${ALL_FUNCTIONS.map(
      (functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guardedRoles};`,
    ).join('\n    ')}`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `LOCK TABLE ${EVIDENCE_TABLE},
      ${CONTROL_TABLE},
      ${DEADLINE_TABLE},
      ${INTENT_TABLE}
      IN ACCESS EXCLUSIVE MODE;
    DO $refuse_provider_position_chain_anchor_record_intent_downgrade$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${EVIDENCE_TABLE})
        OR EXISTS (SELECT 1 FROM ${CONTROL_TABLE})
        OR EXISTS (SELECT 1 FROM ${DEADLINE_TABLE})
        OR EXISTS (SELECT 1 FROM ${INTENT_TABLE})
      THEN
        RAISE EXCEPTION
          'cannot roll back provider position chain anchor record intents after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_provider_position_chain_anchor_record_intent_downgrade$;

    ${ALL_FUNCTIONS.map(
      (functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guardedRoles};`,
    ).join('\n    ')}
    REVOKE ALL PRIVILEGES ON TYPE ${INTENT_TABLE} FROM ${guardedRoles};
    REVOKE ALL PRIVILEGES ON TABLE ${INTENT_TABLE} FROM ${guardedRoles};

    DROP TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check
      ON ${DEADLINE_TABLE};
    ALTER TABLE ${DEADLINE_TABLE}
      DROP CONSTRAINT provider_position_chain_anchor_deadline_intent_fk;
    ${[
      RELEASE_RECONCILIATION,
      RECONCILE_INTENT,
      LEASE_RECONCILIATION,
      MARK_UNKNOWN,
      EXECUTE_RECORD,
      CLAIM_DISPATCH,
      PREPARE_INTENT,
      DEADLINE_INTENT_GUARD,
    ]
      .map((functionIdentity) => `DROP FUNCTION ${functionIdentity};`)
      .join('\n    ')}
    DROP TRIGGER provider_position_chain_anchor_record_intent_retain_truncate
      ON ${INTENT_TABLE};
    DROP TRIGGER provider_position_chain_anchor_record_intent_retain_row
      ON ${INTENT_TABLE};
    DROP TRIGGER provider_position_chain_anchor_record_intent_transition
      ON ${INTENT_TABLE};
    DROP FUNCTION ${TRANSITION_GUARD};
    DROP TABLE ${INTENT_TABLE};
    DROP FUNCTION ${LIFECYCLE_VALID};
    DROP FUNCTION ${HEADER_VALID};
    DROP FUNCTION ${RECONCILIATION_LEASE_TOKEN_FINGERPRINT};
    DROP FUNCTION ${DISPATCH_TOKEN_FINGERPRINT};
    DROP FUNCTION ${INTENT_FINGERPRINT};`;
}

const INTENT_COLUMNS = Object.freeze([
  ['record_intent_fingerprint_sha256', 'text', true],
  ['evidence_fingerprint_sha256', 'text', true],
  ['read_binding_fingerprint_sha256', 'text', true],
  ['record_intent_version', 'smallint', true],
  ['record_intent_use', 'text', true],
  ['may_authorize_financial_action', 'boolean', true],
  ['may_persist', 'boolean', true],
  ['prepared_at', 'timestamp with time zone', true],
  ['producer_deadline_at', 'timestamp with time zone', true],
  ...EVIDENCE_FIELDS.map(
    ([column, , type]) =>
      [column, type === 'timestamptz' ? 'timestamp with time zone' : type, true] as const,
  ),
  ['record_state', 'text', true],
  ['record_dispatch_count', 'smallint', true],
  ['record_dispatch_token_sha256', 'text', false],
  ['record_dispatched_at', 'timestamp with time zone', false],
  ['reconcile_not_before', 'timestamp with time zone', true],
  ['reconciliation_attempt_count', 'bigint', true],
  ['reconciliation_lease_token_sha256', 'text', false],
  ['reconciliation_lease_acquired_at', 'timestamp with time zone', false],
  ['reconciliation_lease_expires_at', 'timestamp with time zone', false],
  ['last_reconciliation_error_code', 'text', false],
  ['last_reconciliation_error_at', 'timestamp with time zone', false],
  ['deadline_binding_sha256', 'text', false],
  ['evidence_recorded_at', 'timestamp with time zone', false],
  ['resolved_at', 'timestamp with time zone', false],
  ['resolution_code', 'text', false],
] as const);

const COMMON_INTENT_RESULT =
  'intent_state text, record_intent_fingerprint_sha256 text, evidence_fingerprint_sha256 text, read_binding_fingerprint_sha256 text, deadline_binding_sha256 text, evidence_recorded_at timestamp with time zone, resolved_at timestamp with time zone, producer_deadline_at timestamp with time zone';

type FunctionExpectation = Readonly<{
  identity: string;
  body: string;
  securityDefiner: boolean;
  strict: boolean;
  volatility: 'i' | 'v';
  parallel: 's' | 'u';
  returnsSet: boolean;
  argumentCount: number;
  language: 'sql' | 'plpgsql';
  result: string;
  purePath: boolean;
}>;

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createProviderPositionChainAnchorRecordDeadlineMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0030 must expose verification SQL');
  const priorDeadlineConstraintCount = `SELECT pg_catalog.count(*) = 4
          FROM pg_catalog.pg_constraint AS all_constraint
          WHERE all_constraint.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')`;
  const priorDeadlineTriggerCount = `SELECT pg_catalog.count(*) = 2
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND NOT all_trigger.tgisinternal`;
  let prior = replaceExactlyOnce(
    previous.verifySql,
    priorDeadlineConstraintCount,
    priorDeadlineConstraintCount.replace('count(*) = 4', 'count(*) = 6'),
  );
  prior = replaceExactlyOnce(
    prior,
    priorDeadlineTriggerCount,
    priorDeadlineTriggerCount.replace('count(*) = 2', 'count(*) = 3'),
  );

  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const guardedRoles = [api, worker, legacy, balance, migration, "'public'"];
  const functionExpectations: readonly FunctionExpectation[] = [
    {
      identity: INTENT_FINGERPRINT,
      body: INTENT_FINGERPRINT_BODY,
      securityDefiner: false,
      strict: true,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 2,
      language: 'sql',
      result: 'text',
      purePath: true,
    },
    {
      identity: DISPATCH_TOKEN_FINGERPRINT,
      body: DISPATCH_TOKEN_FINGERPRINT_BODY,
      securityDefiner: false,
      strict: true,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 2,
      language: 'sql',
      result: 'text',
      purePath: true,
    },
    {
      identity: RECONCILIATION_LEASE_TOKEN_FINGERPRINT,
      body: RECONCILIATION_LEASE_TOKEN_FINGERPRINT_BODY,
      securityDefiner: false,
      strict: true,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 2,
      language: 'sql',
      result: 'text',
      purePath: true,
    },
    {
      identity: HEADER_VALID,
      body: HEADER_VALID_BODY,
      securityDefiner: false,
      strict: true,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 32,
      language: 'sql',
      result: 'boolean',
      purePath: false,
    },
    {
      identity: LIFECYCLE_VALID,
      body: LIFECYCLE_VALID_BODY,
      securityDefiner: false,
      strict: false,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 18,
      language: 'sql',
      result: 'boolean',
      purePath: false,
    },
    {
      identity: TRANSITION_GUARD,
      body: TRANSITION_GUARD_BODY,
      securityDefiner: false,
      strict: false,
      volatility: 'v',
      parallel: 'u',
      returnsSet: false,
      argumentCount: 0,
      language: 'plpgsql',
      result: 'trigger',
      purePath: true,
    },
    {
      identity: DEADLINE_INTENT_GUARD,
      body: DEADLINE_INTENT_GUARD_BODY,
      securityDefiner: true,
      strict: false,
      volatility: 'v',
      parallel: 'u',
      returnsSet: false,
      argumentCount: 0,
      language: 'plpgsql',
      result: 'trigger',
      purePath: false,
    },
    {
      identity: PREPARE_INTENT,
      body: PREPARE_INTENT_BODY,
      securityDefiner: true,
      strict: true,
      volatility: 'v',
      parallel: 'u',
      returnsSet: true,
      argumentCount: 24,
      language: 'plpgsql',
      result:
        'TABLE(intent_state text, prepared_record_intent_fingerprint_sha256 text, prepared_evidence_fingerprint_sha256 text, prepared_read_binding_fingerprint_sha256 text, prepared_deadline_binding_sha256 text, prepared_evidence_recorded_at timestamp with time zone, prepared_resolved_at timestamp with time zone, prepared_producer_deadline_at timestamp with time zone)',
      purePath: false,
    },
    ...[
      [CLAIM_DISPATCH, CLAIM_DISPATCH_BODY, 'claimed'],
      [EXECUTE_RECORD, EXECUTE_RECORD_BODY, 'executed'],
      [MARK_UNKNOWN, MARK_UNKNOWN_BODY, 'marked'],
      [RECONCILE_INTENT, RECONCILE_INTENT_BODY, 'reconciled'],
    ].map(([identity, body, prefix]): FunctionExpectation => ({
      identity: identity ?? '',
      body: body ?? '',
      securityDefiner: true,
      strict: true,
      volatility: 'v',
      parallel: 'u',
      returnsSet: true,
      argumentCount: 2,
      language: 'plpgsql',
      result: `TABLE(${COMMON_INTENT_RESULT.replace(
        'record_intent_fingerprint_sha256',
        `${prefix}_record_intent_fingerprint_sha256`,
      )
        .replace('evidence_fingerprint_sha256', `${prefix}_evidence_fingerprint_sha256`)
        .replace('read_binding_fingerprint_sha256', `${prefix}_read_binding_fingerprint_sha256`)
        .replace('deadline_binding_sha256', `${prefix}_deadline_binding_sha256`)
        .replace('evidence_recorded_at', `${prefix}_evidence_recorded_at`)
        .replace('resolved_at', `${prefix}_resolved_at`)
        .replace('producer_deadline_at', `${prefix}_producer_deadline_at`)})`,
      purePath: false,
    })),
    {
      identity: LEASE_RECONCILIATION,
      body: LEASE_RECONCILIATION_BODY,
      securityDefiner: true,
      strict: true,
      volatility: 'v',
      parallel: 'u',
      returnsSet: true,
      argumentCount: 2,
      language: 'plpgsql',
      result:
        'TABLE(leased_record_intent_fingerprint_sha256 text, leased_evidence_fingerprint_sha256 text, leased_intent_state text, leased_producer_deadline_at timestamp with time zone, leased_reconciliation_attempt_count bigint, leased_at timestamp with time zone, lease_expires_at timestamp with time zone)',
      purePath: false,
    },
    {
      identity: RELEASE_RECONCILIATION,
      body: RELEASE_RECONCILIATION_BODY,
      securityDefiner: true,
      strict: true,
      volatility: 'v',
      parallel: 'u',
      returnsSet: true,
      argumentCount: 4,
      language: 'plpgsql',
      result:
        'TABLE(released_record_intent_fingerprint_sha256 text, released_evidence_fingerprint_sha256 text, released_intent_state text, released_reconcile_not_before timestamp with time zone, released_reconciliation_attempt_count bigint, released_error_code text, released_error_at timestamp with time zone)',
      purePath: false,
    },
  ];

  const functionRows = functionExpectations
    .map(
      (expected) => `(
          '${expected.identity}',
          '${sourceSha256(expected.body)}',
          ${String(expected.securityDefiner)},
          ${String(expected.strict)},
          '${expected.volatility}',
          '${expected.parallel}',
          ${String(expected.returnsSet)},
          ${expected.argumentCount},
          '${expected.language}',
          '${expected.result}',
          ${String(expected.purePath)}
        )`,
    )
    .join(',\n        ');

  return `SELECT (
      prior.valid
      AND relation.valid
      AND columns.valid
      AND indexes.valid
      AND constraints.valid
      AND functions.valid
      AND triggers.valid
      AND privileges.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.count(relation.oid) = 1
        AND pg_catalog.bool_and(
          relation.relkind = 'r'
          AND relation.relpersistence = 'p'
          AND relation.relreplident = 'd'
          AND NOT relation.relrowsecurity
          AND NOT relation.relforcerowsecurity
          AND relation_owner.rolname = ${cumulative ? owner : 'relation_owner.rolname'}
          AND (
            SELECT row_type_owner.rolname = ${cumulative ? owner : 'row_type_owner.rolname'}
              AND row_type.typtype = 'c'
              AND row_type.typrelid = relation.oid
            FROM pg_catalog.pg_type AS row_type
            INNER JOIN pg_catalog.pg_roles AS row_type_owner
              ON row_type_owner.oid = row_type.typowner
            WHERE row_type.oid = relation.reltype
          )
          AND pg_catalog.obj_description(relation.oid, 'pg_class') = '${INTENT_MANIFEST}'
        ) AS valid
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      INNER JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND relation.relname = '${INTENT_TABLE}'
    ) AS relation
    CROSS JOIN (
      WITH expected(ordinal, column_name, data_type, not_null) AS (VALUES
        ${INTENT_COLUMNS.map(
          ([column, dataType, notNull], index) =>
            `(${index + 1}, '${column}', '${dataType}', ${String(notNull)})`,
        ).join(',\n        ')}
      )
      SELECT pg_catalog.count(*) = ${INTENT_COLUMNS.length}
        AND pg_catalog.count(attribute.attnum) = ${INTENT_COLUMNS.length}
        AND pg_catalog.bool_and(
          attribute.attnum = expected.ordinal
          AND attribute.attname = expected.column_name
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            = expected.data_type
          AND attribute.attnotnull = expected.not_null
          AND attribute_default.adbin IS NULL
        )
        AND (
          SELECT pg_catalog.count(*) = ${INTENT_COLUMNS.length}
          FROM pg_catalog.pg_attribute AS all_attribute
          WHERE all_attribute.attrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
            AND all_attribute.attnum > 0
            AND NOT all_attribute.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS guarded_attribute
          WHERE guarded_attribute.attrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
            AND guarded_attribute.attnum > 0
            AND NOT guarded_attribute.attisdropped
            AND guarded_attribute.attname ~
              '(^|_)(account|wallet|address|correlation|request|actor|endpoint|credential)(_|$)|raw_(proof|token|error)|(proof|token|error)_raw'
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
        AND attribute.attnum = expected.ordinal
      LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
        ON attribute_default.adrelid = attribute.attrelid
        AND attribute_default.adnum = attribute.attnum
    ) AS columns
    CROSS JOIN (
      WITH expected(
        index_name,
        index_keys,
        index_options,
        operator_classes,
        unique_index,
        primary_index,
        predicate_expression
      )
      AS (VALUES
        ('${INTENT_TABLE}_pkey', '1', '0', ARRAY['text_ops']::text[], true, true, NULL::text),
        ('provider_position_chain_anchor_record_intent_evidence_unique', '2', '0', ARRAY['text_ops']::text[], true, false, NULL::text),
        ('provider_chain_anchor_intent_read_binding_unique', '3', '0', ARRAY['text_ops']::text[], true, false, NULL::text),
        ('provider_chain_anchor_intent_evidence_deadline_unique', '2 9', '0 0', ARRAY['text_ops', 'timestamptz_ops']::text[], true, false, NULL::text),
        ('provider_position_chain_anchor_record_dispatch_token_unique', '35', '0', ARRAY['text_ops']::text[], true, false, 'record_dispatch_token_sha256ISNOTNULL'),
        ('provider_chain_anchor_reconciliation_lease_token_unique', '39', '0', ARRAY['text_ops']::text[], true, false, 'reconciliation_lease_token_sha256ISNOTNULL'),
        ('provider_position_chain_anchor_record_intent_reconcile_scan_idx', '33 37 9 8 1', '0 0 0 0 0', ARRAY['text_ops', 'timestamptz_ops', 'timestamptz_ops', 'timestamptz_ops', 'text_ops']::text[], false, false, 'record_state=ANY(ARRAY[''NEW''::text,''RECORD_DISPATCHED''::text,''UNKNOWN''::text])')
      )
      SELECT pg_catalog.count(*) = 7
        AND pg_catalog.count(index_state.indexrelid) = 7
        AND pg_catalog.bool_and(
          index_relation.relkind = 'i'
          AND index_relation.relpersistence = 'p'
          AND access_method.amname = 'btree'
          AND index_state.indisvalid
          AND index_state.indisready
          AND index_state.indislive
          AND index_state.indisunique = expected.unique_index
          AND index_state.indisprimary = expected.primary_index
          AND NOT index_state.indisexclusion
          AND index_state.indimmediate
          AND NOT index_state.indnullsnotdistinct
          AND NOT index_state.indisclustered
          AND NOT index_state.indcheckxmin
          AND NOT index_state.indisreplident
          AND index_state.indexprs IS NULL
          AND index_state.indkey = expected.index_keys::pg_catalog.int2vector
          AND index_state.indoption = expected.index_options::pg_catalog.int2vector
          AND (
            SELECT pg_catalog.array_agg(operator_class.opcname::text ORDER BY key_position)
            FROM pg_catalog.generate_series(
              0, index_state.indnkeyatts - 1
            ) AS positions(key_position)
            INNER JOIN pg_catalog.pg_opclass AS operator_class
              ON operator_class.oid = index_state.indclass[key_position]
          ) = expected.operator_classes
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.generate_series(
              0, index_state.indnkeyatts - 1
            ) AS positions(key_position)
            INNER JOIN pg_catalog.pg_attribute AS indexed_attribute
              ON indexed_attribute.attrelid = index_state.indrelid
              AND indexed_attribute.attnum = index_state.indkey[key_position]
            WHERE index_state.indcollation[key_position]
              <> indexed_attribute.attcollation
          )
          AND CASE WHEN expected.predicate_expression IS NULL THEN
            index_state.indpred IS NULL
          ELSE
            pg_catalog.regexp_replace(
              pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, false),
              '[[:space:]]+', '', 'g'
            ) IN (
              expected.predicate_expression,
              '(' || expected.predicate_expression || ')'
            )
          END
          AND index_state.indnkeyatts = pg_catalog.array_length(
            pg_catalog.string_to_array(expected.index_keys, ' '), 1
          )
          AND index_state.indnatts = index_state.indnkeyatts
        )
        AND (
          SELECT pg_catalog.count(*) = 7
          FROM pg_catalog.pg_index AS all_index
          WHERE all_index.indrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.relname = expected.index_name
        AND index_relation.relnamespace =
          pg_catalog.to_regnamespace(pg_catalog.current_schema())
      LEFT JOIN pg_catalog.pg_index AS index_state
        ON index_state.indexrelid = index_relation.oid
        AND index_state.indrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
      LEFT JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_relation.relam
    ) AS indexes
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 9
        AND pg_catalog.bool_and(constraint_state.convalidated)
        AND pg_catalog.bool_and(
          constraint_state.conislocal
          AND constraint_state.coninhcount = 0
        )
        AND pg_catalog.bool_and(CASE constraint_state.conname
          WHEN '${INTENT_TABLE}_pkey' THEN
            constraint_state.contype = 'p'
              AND constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND constraint_state.conkey = ARRAY[1]::smallint[]
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
          WHEN 'provider_position_chain_anchor_record_intent_evidence_unique' THEN
            constraint_state.contype = 'u'
              AND constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND constraint_state.conkey = ARRAY[2]::smallint[]
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
          WHEN 'provider_chain_anchor_intent_read_binding_unique' THEN
            constraint_state.contype = 'u'
              AND constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND constraint_state.conkey = ARRAY[3]::smallint[]
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
          WHEN 'provider_chain_anchor_intent_evidence_deadline_unique' THEN
            constraint_state.contype = 'u'
              AND constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND constraint_state.conkey = ARRAY[2,9]::smallint[]
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
          WHEN 'provider_chain_anchor_intent_deadline_binding_fk' THEN
            constraint_state.contype = 'f'
              AND constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND constraint_state.confrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.conkey = ARRAY[44]::smallint[]
              AND constraint_state.confkey = ARRAY[1]::smallint[]
              AND constraint_state.confmatchtype = 's'
              AND constraint_state.confupdtype = 'a'
              AND constraint_state.confdeltype = 'a'
              AND constraint_state.condeferrable
              AND constraint_state.condeferred
          WHEN 'provider_position_chain_anchor_record_intent_header_valid_check' THEN
            constraint_state.contype = 'c'
              AND NOT constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
              AND pg_catalog.regexp_replace(
                pg_catalog.pg_get_expr(constraint_state.conbin, constraint_state.conrelid, false),
                '[[:space:]]+', '', 'g'
              ) IN ('${HEADER_VALID_CALL_COMPACT}', '(${HEADER_VALID_CALL_COMPACT})')
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_depend AS dependency
                WHERE dependency.classid = pg_catalog.to_regclass('pg_catalog.pg_constraint')
                  AND dependency.objid = constraint_state.oid
                  AND dependency.refclassid = pg_catalog.to_regclass('pg_catalog.pg_proc')
                  AND dependency.refobjid = pg_catalog.to_regprocedure('${HEADER_VALID}')
                  AND dependency.deptype = 'n'
              )
          WHEN 'provider_chain_anchor_intent_lifecycle_valid_check' THEN
            constraint_state.contype = 'c'
              AND NOT constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
              AND pg_catalog.regexp_replace(
                pg_catalog.pg_get_expr(constraint_state.conbin, constraint_state.conrelid, false),
                '[[:space:]]+', '', 'g'
              ) IN ('${LIFECYCLE_VALID_CALL_COMPACT}', '(${LIFECYCLE_VALID_CALL_COMPACT})')
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_depend AS dependency
                WHERE dependency.classid = pg_catalog.to_regclass('pg_catalog.pg_constraint')
                  AND dependency.objid = constraint_state.oid
                  AND dependency.refclassid = pg_catalog.to_regclass('pg_catalog.pg_proc')
                  AND dependency.refobjid = pg_catalog.to_regprocedure('${LIFECYCLE_VALID}')
                  AND dependency.deptype = 'n'
              )
          WHEN 'provider_position_chain_anchor_deadline_intent_fk' THEN
            constraint_state.contype = 'f'
              AND constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.confrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
              AND constraint_state.conkey = ARRAY[2,7]::smallint[]
              AND constraint_state.confkey = ARRAY[2,9]::smallint[]
              AND constraint_state.confmatchtype = 's'
              AND constraint_state.confupdtype = 'a'
              AND constraint_state.confdeltype = 'a'
              AND constraint_state.condeferrable
              AND constraint_state.condeferred
          WHEN 'provider_position_chain_anchor_deadline_intent_terminal_check' THEN
            constraint_state.contype = 't'
              AND constraint_state.connoinherit
              AND constraint_state.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.confrelid = 0
              AND constraint_state.conkey IS NULL
              AND constraint_state.confkey IS NULL
              AND constraint_state.condeferrable
              AND constraint_state.condeferred
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.connamespace =
          pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND constraint_state.conname IN (
          '${INTENT_TABLE}_pkey',
          'provider_position_chain_anchor_record_intent_evidence_unique',
          'provider_chain_anchor_intent_read_binding_unique',
          'provider_chain_anchor_intent_evidence_deadline_unique',
          'provider_chain_anchor_intent_deadline_binding_fk',
          'provider_position_chain_anchor_record_intent_header_valid_check',
          'provider_chain_anchor_intent_lifecycle_valid_check',
          'provider_position_chain_anchor_deadline_intent_fk',
          'provider_position_chain_anchor_deadline_intent_terminal_check'
        )
        AND (
          SELECT pg_catalog.count(*) = 7
          FROM pg_catalog.pg_constraint AS own_constraint
          WHERE own_constraint.conrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
        )
        AND (
          SELECT pg_catalog.count(*) = 1
          FROM pg_catalog.pg_constraint AS sidecar_constraint
          WHERE sidecar_constraint.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND sidecar_constraint.conname = 'provider_position_chain_anchor_deadline_intent_fk'
        )
        AND (
          SELECT pg_catalog.count(*) = 1
          FROM pg_catalog.pg_constraint AS trigger_constraint
          WHERE trigger_constraint.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND trigger_constraint.conname =
              'provider_position_chain_anchor_deadline_intent_terminal_check'
        )
    ) AS constraints
    CROSS JOIN (
      WITH expected(
        function_identity,
        body_sha256,
        security_definer,
        strict_function,
        volatility,
        parallel_safety,
        returns_set,
        argument_count,
        language_name,
        result_type,
        pure_path
      ) AS (VALUES
        ${functionRows}
      )
      SELECT pg_catalog.count(*) = ${functionExpectations.length}
        AND pg_catalog.count(procedure.oid) = ${functionExpectations.length}
        AND pg_catalog.bool_and(
          function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT procedure.proleakproof
          AND procedure.prokind = 'f'
          AND procedure.prosecdef = expected.security_definer
          AND procedure.proisstrict = expected.strict_function
          AND procedure.provolatile = expected.volatility::"char"
          AND procedure.proparallel = expected.parallel_safety::"char"
          AND procedure.proretset = expected.returns_set
          AND procedure.pronargs = expected.argument_count
          AND procedure.pronargdefaults = 0
          AND procedure.provariadic = 0
          AND language.lanname = expected.language_name
          AND pg_catalog.pg_get_function_result(procedure.oid) = expected.result_type
          AND procedure.proconfig = CASE WHEN expected.pure_path
            THEN ARRAY['search_path=pg_catalog']::text[]
            ELSE ARRAY[
              'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
            ]::text[]
          END
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
            'hex'
          ) = expected.body_sha256
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    ) AS functions
    CROSS JOIN (
      WITH expected(trigger_name, relation_name, trigger_type, function_identity, constraint_trigger)
      AS (VALUES
        ('provider_position_chain_anchor_record_intent_transition', '${INTENT_TABLE}', 19::smallint, '${TRANSITION_GUARD}', false),
        ('provider_position_chain_anchor_record_intent_retain_row', '${INTENT_TABLE}', 11::smallint, 'reject_provider_position_chain_anchor_history_mutation()', false),
        ('provider_position_chain_anchor_record_intent_retain_truncate', '${INTENT_TABLE}', 34::smallint, 'reject_provider_position_chain_anchor_history_mutation()', false),
        ('provider_position_chain_anchor_deadline_intent_terminal_check', '${DEADLINE_TABLE}', 5::smallint, '${DEADLINE_INTENT_GUARD}', true)
      )
      SELECT pg_catalog.count(*) = 4
        AND pg_catalog.count(trigger.oid) = 4
        AND pg_catalog.bool_and(
          trigger.tgenabled = 'A'
          AND trigger.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
          AND trigger.tgtype = expected.trigger_type
          AND NOT trigger.tgisinternal
          AND trigger.tgnargs = 0
          AND trigger.tgattr = ''::pg_catalog.int2vector
          AND trigger.tgqual IS NULL
          AND trigger.tgoldtable IS NULL
          AND trigger.tgnewtable IS NULL
          AND CASE WHEN expected.constraint_trigger THEN
            trigger.tgconstraint = (
              SELECT constraint_state.oid
              FROM pg_catalog.pg_constraint AS constraint_state
              WHERE constraint_state.connamespace =
                  pg_catalog.to_regnamespace(pg_catalog.current_schema())
                AND constraint_state.conname = expected.trigger_name
            )
          ELSE trigger.tgconstraint = 0 END
          AND trigger.tgdeferrable = expected.constraint_trigger
          AND trigger.tginitdeferred = expected.constraint_trigger
        )
        AND (
          SELECT pg_catalog.count(*) = 3
          FROM pg_catalog.pg_trigger AS intent_trigger
          WHERE intent_trigger.tgrelid = pg_catalog.to_regclass('${INTENT_TABLE}')
            AND NOT intent_trigger.tgisinternal
        )
        AND (
          SELECT pg_catalog.count(*) = 1
          FROM pg_catalog.pg_trigger AS deadline_trigger
          WHERE deadline_trigger.tgrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND deadline_trigger.tgname =
              'provider_position_chain_anchor_deadline_intent_terminal_check'
            AND NOT deadline_trigger.tgisinternal
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgrelid = pg_catalog.to_regclass(expected.relation_name)
        AND trigger.tgname = expected.trigger_name
    ) AS triggers
    CROSS JOIN (
      SELECT
        ${guardedRoles
          .map(
            (role) =>
              `NOT pg_catalog.has_table_privilege(${role}, '${INTENT_TABLE}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
          )
          .join('\n        AND ')}
        AND ${guardedRoles
          .map((role) => `NOT pg_catalog.has_type_privilege(${role}, '${INTENT_TABLE}', 'USAGE')`)
          .join('\n        AND ')}
        AND ${guardedRoles
          .flatMap((role) =>
            ALL_FUNCTIONS.map(
              (functionIdentity) =>
                `NOT pg_catalog.has_function_privilege(${role}, '${functionIdentity}', 'EXECUTE')`,
            ),
          )
          .join('\n        AND ')}
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS guarded_table
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(guarded_table.relacl, pg_catalog.acldefault('r', guarded_table.relowner))
          ) AS acl
          WHERE guarded_table.oid = pg_catalog.to_regclass('${INTENT_TABLE}')
            AND acl.grantee <> guarded_table.relowner
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_type AS guarded_type
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(guarded_type.typacl, pg_catalog.acldefault('T', guarded_type.typowner))
          ) AS acl
          WHERE guarded_type.oid = pg_catalog.to_regtype('${INTENT_TABLE}')
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
          WHERE guarded_function.oid IN (
            ${ALL_FUNCTIONS.map(
              (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
            ).join(',\n            ')}
          )
            AND acl.grantee <> guarded_function.proowner
        ) AS valid
    ) AS privileges`;
}

export function createProviderPositionChainAnchorRecordIntentMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0031',
    description:
      'retain one-shot provider position chain anchor record intents and source-only reconciliation',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0030'],
  };
}

export const createProviderPositionChainAnchorRecordIntentMigrationV0031 =
  createProviderPositionChainAnchorRecordIntentMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031 =
  createProviderPositionChainAnchorRecordIntentMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
