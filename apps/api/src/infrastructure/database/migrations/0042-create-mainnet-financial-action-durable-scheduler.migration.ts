import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionWalletIdentityRotationRecoveryMigration } from './0040-preserve-mainnet-financial-action-recovery-through-wallet-identity-key-rotation.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const JOBS = 'mainnet_financial_action_scheduler_jobs';
const AUDIT = 'mainnet_financial_action_scheduler_events';
const MANUAL = 'mainnet_financial_action_scheduler_manual_reviews';
const ENQUEUE = 'enqueue_mainnet_financial_action_scheduler_job_v1';
const ENQUEUE_TRIGGER = 'enqueue_mainnet_financial_action_scheduler_event_v1';
const CLAIM = 'claim_mainnet_financial_action_scheduler_job_v1';
const COMPLETE = 'complete_mainnet_financial_action_scheduler_job_v1';
const JOB_GUARD = 'enforce_mainnet_financial_action_scheduler_job_v1';
const AUDIT_GUARD = 'enforce_mainnet_financial_action_scheduler_audit_v1';
const MANUAL_GUARD = 'enforce_mainnet_financial_action_scheduler_manual_review_v1';
const UINT64_MAX = '18446744073709551615';
const JOB_MANIFEST =
  'crypto-lending:mainnet-financial-action-scheduler-job:v1;event-derived;lease-fenced;owner-only;no-sign-broadcast-resubmit-or-settlement-authority';
const AUDIT_MANIFEST =
  'crypto-lending:mainnet-financial-action-scheduler-audit:v1;append-only;database-authored;owner-only';
const MANUAL_MANIFEST =
  'crypto-lending:mainnet-financial-action-scheduler-manual-review:v1;append-only;quarantine-only;owner-only';
// PostgreSQL-16 pg_constraint canonical digest for all three scheduler relations.
const SCHEDULER_CONSTRAINT_CATALOG_SHA256 =
  '961e1b033e8e8ebff81d4bf6eaeb696ff8fcd12dd20554372c2fdfe83d3762ad';
const SCHEDULER_COLUMN_CATALOG_SHA256 =
  '6fd6d2f10dfa34b5915cf6ebb7c7a6db1811346c2498f82bf3233294ad7f59dd';
const SCHEDULER_INDEX_CATALOG_SHA256 =
  'b7c60a85a4688a5950396fe7698a024a9304a43a556dd9a57cdcd51edae34042';

const FUNCTION_IDENTITIES = Object.freeze([
  `${JOB_GUARD}()`,
  `${AUDIT_GUARD}()`,
  `${MANUAL_GUARD}()`,
  `${ENQUEUE}(uuid)`,
  `${ENQUEUE_TRIGGER}()`,
  `${CLAIM}(text,integer)`,
  `${COMPLETE}(uuid,uuid,uuid,text,bigint,text,uuid,numeric,text)`,
]);

const AUTHORITY_COLUMNS = `
      may_authorize_financial_action boolean NOT NULL DEFAULT false,
      may_construct_transaction boolean NOT NULL DEFAULT false,
      api_may_sign boolean NOT NULL DEFAULT false,
      api_may_broadcast boolean NOT NULL DEFAULT false,
      may_resubmit_transaction boolean NOT NULL DEFAULT false,
      ledger_settlement_authority boolean NOT NULL DEFAULT false`;

const AUTHORITY_CHECK = `NOT may_authorize_financial_action
        AND NOT may_construct_transaction AND NOT api_may_sign
        AND NOT api_may_broadcast AND NOT may_resubmit_transaction
        AND NOT ledger_settlement_authority`;

const JOB_COLUMNS = Object.freeze([
  ['job_id', 'uuid', true],
  ['scheduler_version', 'smallint', true],
  ['account_id', 'uuid', true],
  ['intent_id', 'uuid', true],
  ['intent_record_fingerprint_sha256', 'text', true],
  ['source_event_id', 'uuid', true],
  ['lifecycle_revision', 'bigint', true],
  ['lifecycle_snapshot_sha256', 'text', true],
  ['lifecycle_stage', 'text', true],
  ['network_id', 'text', true],
  ['action_type', 'text', true],
  ['queue_name', 'text', true],
  ['purpose', 'text', true],
  ['chain_transaction_id', 'text', false],
  ['reconciliation_outcome', 'text', false],
  ['job_status', 'text', true],
  ['maximum_attempts', 'smallint', true],
  ['attempt_count', 'smallint', true],
  ['fencing_token', 'numeric(20,0)', true],
  ['lease_id', 'uuid', false],
  ['claimed_at', 'timestamp with time zone', false],
  ['lease_expires_at', 'timestamp with time zone', false],
  ['available_at', 'timestamp with time zone', true],
  ['last_completion_lease_id', 'uuid', false],
  ['last_completion_fencing_token', 'numeric(20,0)', false],
  ['last_requested_disposition', 'text', false],
  ['last_completion_outcome', 'text', false],
  ['last_completed_at', 'timestamp with time zone', false],
  ['last_completion_state_version', 'bigint', false],
  ['created_at', 'timestamp with time zone', true],
  ['updated_at', 'timestamp with time zone', true],
  ['state_version', 'bigint', true],
  ['state_fingerprint_sha256', 'text', true],
  ['may_authorize_financial_action', 'boolean', true],
  ['may_construct_transaction', 'boolean', true],
  ['api_may_sign', 'boolean', true],
  ['api_may_broadcast', 'boolean', true],
  ['may_resubmit_transaction', 'boolean', true],
  ['ledger_settlement_authority', 'boolean', true],
] as const);

const AUDIT_COLUMNS = Object.freeze([
  ['audit_event_id', 'uuid', true],
  ['job_id', 'uuid', true],
  ['state_version', 'bigint', true],
  ['transition', 'text', true],
  ['job_status', 'text', true],
  ['queue_name', 'text', true],
  ['intent_id', 'uuid', true],
  ['lifecycle_revision', 'bigint', true],
  ['lifecycle_snapshot_sha256', 'text', true],
  ['attempt_count', 'smallint', true],
  ['fencing_token', 'numeric(20,0)', true],
  ['subject_lease_id', 'uuid', false],
  ['requested_disposition', 'text', false],
  ['recorded_at', 'timestamp with time zone', true],
  ['audit_fingerprint_sha256', 'text', true],
  ['may_authorize_financial_action', 'boolean', true],
  ['may_construct_transaction', 'boolean', true],
  ['api_may_sign', 'boolean', true],
  ['api_may_broadcast', 'boolean', true],
  ['may_resubmit_transaction', 'boolean', true],
  ['ledger_settlement_authority', 'boolean', true],
] as const);

const MANUAL_COLUMNS = Object.freeze([
  ['case_id', 'uuid', true],
  ['job_id', 'uuid', true],
  ['account_id', 'uuid', true],
  ['intent_id', 'uuid', true],
  ['source_event_id', 'uuid', true],
  ['lifecycle_revision', 'bigint', true],
  ['lifecycle_snapshot_sha256', 'text', true],
  ['queue_name', 'text', true],
  ['reason', 'text', true],
  ['attempt_count', 'smallint', true],
  ['fencing_token', 'numeric(20,0)', true],
  ['recorded_at', 'timestamp with time zone', true],
  ['case_fingerprint_sha256', 'text', true],
  ['may_authorize_financial_action', 'boolean', true],
  ['may_construct_transaction', 'boolean', true],
  ['api_may_sign', 'boolean', true],
  ['api_may_broadcast', 'boolean', true],
  ['may_resubmit_transaction', 'boolean', true],
  ['ledger_settlement_authority', 'boolean', true],
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

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const start = source.indexOf(target);
  if (start < 0 || source.indexOf(target, start + target.length) >= 0) {
    throw new Error('Migration 0042 predecessor verifier anchor mismatch');
  }
  return `${source.slice(0, start)}${replacement}${source.slice(start + target.length)}`;
}

function epochMilliseconds(alias: string, column: string): string {
  return `CASE WHEN ${alias}.${column} IS NULL THEN NULL ELSE
            ((extract(epoch FROM ${alias}.${column}) * 1000)::bigint)::text END`;
}

function jobFingerprint(alias: string): string {
  return `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'CRYPTO_LENDING:MAINNET_ACTION:SCHEDULER_JOB:JSONB-ARRAY:v1',
          ${alias}.scheduler_version::text, ${alias}.job_id::text,
          ${alias}.account_id::text, ${alias}.intent_id::text,
          ${alias}.intent_record_fingerprint_sha256, ${alias}.source_event_id::text,
          ${alias}.lifecycle_revision::text, ${alias}.lifecycle_snapshot_sha256,
          ${alias}.lifecycle_stage, ${alias}.network_id, ${alias}.action_type,
          ${alias}.queue_name, ${alias}.purpose, ${alias}.chain_transaction_id,
          ${alias}.reconciliation_outcome, ${alias}.job_status,
          ${alias}.maximum_attempts::text, ${alias}.attempt_count::text,
          ${alias}.fencing_token::text, ${alias}.lease_id::text,
          ${epochMilliseconds(alias, 'claimed_at')},
          ${epochMilliseconds(alias, 'lease_expires_at')},
          ${epochMilliseconds(alias, 'available_at')},
          ${alias}.last_completion_lease_id::text,
          ${alias}.last_completion_fencing_token::text,
          ${alias}.last_requested_disposition, ${alias}.last_completion_outcome,
          ${epochMilliseconds(alias, 'last_completed_at')},
          ${alias}.last_completion_state_version::text,
          ${epochMilliseconds(alias, 'created_at')},
          ${epochMilliseconds(alias, 'updated_at')}, ${alias}.state_version::text,
          'false', 'false', 'false', 'false', 'false', 'false'
        )::text, 'UTF8')), 'hex')`;
}

function auditFingerprint(alias: string): string {
  return `pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(pg_catalog.jsonb_build_array(
          'CRYPTO_LENDING:MAINNET_ACTION:SCHEDULER_AUDIT:JSONB-ARRAY:v1',
          ${alias}.audit_event_id::text, ${alias}.job_id::text,
          ${alias}.state_version::text, ${alias}.transition, ${alias}.job_status,
          ${alias}.queue_name, ${alias}.intent_id::text,
          ${alias}.lifecycle_revision::text, ${alias}.lifecycle_snapshot_sha256,
          ${alias}.attempt_count::text, ${alias}.fencing_token::text,
          ${alias}.subject_lease_id::text, ${alias}.requested_disposition,
          ${epochMilliseconds(alias, 'recorded_at')},
          'false', 'false', 'false', 'false', 'false', 'false'
        )::text, 'UTF8')), 'hex')`;
}

function manualFingerprint(alias: string): string {
  return `pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(pg_catalog.jsonb_build_array(
          'CRYPTO_LENDING:MAINNET_ACTION:SCHEDULER_MANUAL_REVIEW:JSONB-ARRAY:v1',
          ${alias}.case_id::text, ${alias}.job_id::text, ${alias}.account_id::text,
          ${alias}.intent_id::text, ${alias}.source_event_id::text,
          ${alias}.lifecycle_revision::text, ${alias}.lifecycle_snapshot_sha256,
          ${alias}.queue_name, ${alias}.reason, ${alias}.attempt_count::text,
          ${alias}.fencing_token::text, ${epochMilliseconds(alias, 'recorded_at')},
          'false', 'false', 'false', 'false', 'false', 'false'
        )::text, 'UTF8')), 'hex')`;
}

const JOB_FINGERPRINT = jobFingerprint('NEW');

const JOB_GUARD_BODY = `
    DECLARE
      source_event mainnet_financial_action_events%ROWTYPE;
      source_intent mainnet_financial_action_intents%ROWTYPE;
      database_now timestamptz := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      derived_queue text;
      derived_purpose text;
      derived_maximum smallint;
    BEGIN
      SELECT event.* INTO STRICT source_event
      FROM mainnet_financial_action_events AS event
      WHERE event.event_id = NEW.source_event_id;
      SELECT intent.* INTO STRICT source_intent
      FROM mainnet_financial_action_intents AS intent
      WHERE intent.intent_id = source_event.intent_id;
      derived_queue := CASE source_event.stage
        WHEN 'PREPARED' THEN 'PRE_BROADCAST' ELSE 'RECONCILIATION' END;
      derived_purpose := CASE
        WHEN source_event.stage = 'PREPARED' THEN 'PRE_BROADCAST_SAFETY_REVIEW'
        WHEN source_event.stage IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')
          THEN 'POST_FINALITY_REVIEW'
        WHEN source_event.stage = 'REORG_QUARANTINED' THEN 'LIFECYCLE_QUARANTINE'
        ELSE 'RECONCILIATION_ADMISSION' END;
      derived_maximum := CASE WHEN derived_queue = 'PRE_BROADCAST' THEN 3 ELSE 12 END;
      IF NEW.scheduler_version IS DISTINCT FROM 1
        OR NEW.account_id IS DISTINCT FROM source_intent.account_id
        OR NEW.intent_id IS DISTINCT FROM source_intent.intent_id
        OR NEW.intent_record_fingerprint_sha256 IS DISTINCT FROM
          source_intent.intent_record_fingerprint_sha256
        OR NEW.lifecycle_revision IS DISTINCT FROM source_event.revision
        OR NEW.lifecycle_snapshot_sha256 IS DISTINCT FROM source_event.snapshot_sha256
        OR NEW.lifecycle_stage IS DISTINCT FROM source_event.stage
        OR NEW.network_id IS DISTINCT FROM source_intent.network_id
        OR NEW.action_type IS DISTINCT FROM source_intent.action_type
        OR NEW.queue_name IS DISTINCT FROM derived_queue
        OR NEW.purpose IS DISTINCT FROM derived_purpose
        OR NEW.chain_transaction_id IS DISTINCT FROM source_event.chain_transaction_id
        OR NEW.reconciliation_outcome IS DISTINCT FROM source_event.reconciliation_outcome
        OR NEW.maximum_attempts IS DISTINCT FROM derived_maximum
        OR NEW.may_authorize_financial_action IS DISTINCT FROM false
        OR NEW.may_construct_transaction IS DISTINCT FROM false
        OR NEW.api_may_sign IS DISTINCT FROM false
        OR NEW.api_may_broadcast IS DISTINCT FROM false
        OR NEW.may_resubmit_transaction IS DISTINCT FROM false
        OR NEW.ledger_settlement_authority IS DISTINCT FROM false
      THEN
        RAISE EXCEPTION 'mainnet financial action scheduler job source binding is invalid'
          USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'INSERT' THEN
        NEW.job_id := pg_catalog.gen_random_uuid();
        NEW.attempt_count := 0;
        NEW.fencing_token := 0;
        NEW.lease_id := NULL; NEW.claimed_at := NULL; NEW.lease_expires_at := NULL;
        NEW.available_at := database_now;
        NEW.last_completion_lease_id := NULL;
        NEW.last_completion_fencing_token := NULL;
        NEW.last_requested_disposition := NULL;
        NEW.last_completion_outcome := NULL;
        NEW.last_completed_at := NULL;
        NEW.last_completion_state_version := NULL;
        NEW.created_at := database_now; NEW.updated_at := database_now;
        NEW.state_version := 1;
      ELSE
        IF NEW.job_id IS DISTINCT FROM OLD.job_id
          OR NEW.scheduler_version IS DISTINCT FROM OLD.scheduler_version
          OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id
          OR NEW.account_id IS DISTINCT FROM OLD.account_id
          OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
          OR NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision
          OR NEW.lifecycle_snapshot_sha256 IS DISTINCT FROM OLD.lifecycle_snapshot_sha256
          OR NEW.created_at IS DISTINCT FROM OLD.created_at
          OR NEW.state_version IS DISTINCT FROM OLD.state_version + 1
          OR NEW.attempt_count < OLD.attempt_count
          OR NEW.fencing_token < OLD.fencing_token
          OR NEW.available_at < OLD.available_at
          OR OLD.job_status IN ('COMPLETED', 'SUPERSEDED', 'MANUAL_REVIEW')
          OR NOT (
            (NEW.job_status = 'LEASED'
              AND OLD.job_status IN ('READY', 'LEASED')
              AND NEW.attempt_count = OLD.attempt_count + 1
              AND NEW.fencing_token = OLD.fencing_token + 1
              AND NEW.lease_id IS DISTINCT FROM OLD.lease_id)
            OR (OLD.job_status = 'READY'
              AND NEW.job_status IN ('SUPERSEDED', 'MANUAL_REVIEW')
              AND NEW.attempt_count = OLD.attempt_count
              AND NEW.fencing_token = OLD.fencing_token)
            OR (OLD.job_status = 'LEASED'
              AND NEW.job_status IN ('READY', 'COMPLETED', 'SUPERSEDED', 'MANUAL_REVIEW')
              AND NEW.attempt_count = OLD.attempt_count
              AND NEW.fencing_token = OLD.fencing_token)
          )
        THEN
          RAISE EXCEPTION 'mainnet financial action scheduler job mutation is invalid'
            USING ERRCODE = '23514';
        END IF;
        NEW.updated_at := database_now;
      END IF;
      NEW.state_fingerprint_sha256 := ${JOB_FINGERPRINT};
      RETURN NEW;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action scheduler source event is unavailable'
        USING ERRCODE = '55000';
    END;`;

const AUDIT_GUARD_BODY = `
    DECLARE database_now timestamptz := pg_catalog.date_trunc(
      'milliseconds', pg_catalog.clock_timestamp()
    );
    BEGIN
      IF NEW.may_authorize_financial_action IS DISTINCT FROM false
        OR NEW.may_construct_transaction IS DISTINCT FROM false
        OR NEW.api_may_sign IS DISTINCT FROM false
        OR NEW.api_may_broadcast IS DISTINCT FROM false
        OR NEW.may_resubmit_transaction IS DISTINCT FROM false
        OR NEW.ledger_settlement_authority IS DISTINCT FROM false
      THEN RAISE EXCEPTION 'scheduler audit cannot carry financial authority'
        USING ERRCODE = '23514'; END IF;
      NEW.audit_event_id := pg_catalog.gen_random_uuid();
      NEW.recorded_at := database_now;
      NEW.audit_fingerprint_sha256 := ${auditFingerprint('NEW')};
      RETURN NEW;
    END;`;

const MANUAL_GUARD_BODY = `
    DECLARE
      selected_job ${JOBS}%ROWTYPE;
      database_now timestamptz := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
    BEGIN
      SELECT job.* INTO STRICT selected_job FROM ${JOBS} AS job
      WHERE job.job_id = NEW.job_id FOR SHARE;
      IF selected_job.job_status <> 'MANUAL_REVIEW'
        OR NEW.account_id IS DISTINCT FROM selected_job.account_id
        OR NEW.intent_id IS DISTINCT FROM selected_job.intent_id
        OR NEW.source_event_id IS DISTINCT FROM selected_job.source_event_id
        OR NEW.lifecycle_revision IS DISTINCT FROM selected_job.lifecycle_revision
        OR NEW.lifecycle_snapshot_sha256 IS DISTINCT FROM selected_job.lifecycle_snapshot_sha256
        OR NEW.queue_name IS DISTINCT FROM selected_job.queue_name
        OR NEW.attempt_count IS DISTINCT FROM selected_job.attempt_count
        OR NEW.fencing_token IS DISTINCT FROM selected_job.fencing_token
        OR NEW.may_authorize_financial_action IS DISTINCT FROM false
        OR NEW.may_construct_transaction IS DISTINCT FROM false
        OR NEW.api_may_sign IS DISTINCT FROM false
        OR NEW.api_may_broadcast IS DISTINCT FROM false
        OR NEW.may_resubmit_transaction IS DISTINCT FROM false
        OR NEW.ledger_settlement_authority IS DISTINCT FROM false
      THEN RAISE EXCEPTION 'scheduler manual-review binding is invalid'
        USING ERRCODE = '23514'; END IF;
      NEW.case_id := pg_catalog.gen_random_uuid();
      NEW.recorded_at := database_now;
      NEW.case_fingerprint_sha256 := ${manualFingerprint('NEW')};
      RETURN NEW;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'scheduler manual-review job is unavailable'
        USING ERRCODE = '55000';
    END;`;

const INSERT_AUDIT = `INSERT INTO ${AUDIT} (
        job_id, state_version, transition, job_status, queue_name, intent_id,
        lifecycle_revision, lifecycle_snapshot_sha256, attempt_count,
        fencing_token, subject_lease_id, requested_disposition
      ) VALUES (
        changed_job.job_id, changed_job.state_version, audit_transition,
        changed_job.job_status, changed_job.queue_name, changed_job.intent_id,
        changed_job.lifecycle_revision, changed_job.lifecycle_snapshot_sha256,
        changed_job.attempt_count, changed_job.fencing_token,
        audit_lease_id, audit_disposition
      )`;

const INSERT_MANUAL = `INSERT INTO ${MANUAL} (
        job_id, account_id, intent_id, source_event_id, lifecycle_revision,
        lifecycle_snapshot_sha256, queue_name, reason, attempt_count, fencing_token
      ) VALUES (
        changed_job.job_id, changed_job.account_id, changed_job.intent_id,
        changed_job.source_event_id, changed_job.lifecycle_revision,
        changed_job.lifecycle_snapshot_sha256, changed_job.queue_name,
        manual_reason, changed_job.attempt_count, changed_job.fencing_token
      )`;

const ENQUEUE_BODY = `
    DECLARE
      source_event mainnet_financial_action_events%ROWTYPE;
      source_intent mainnet_financial_action_intents%ROWTYPE;
      changed_job ${JOBS}%ROWTYPE;
      existing_job ${JOBS}%ROWTYPE;
      is_latest boolean;
      initial_status text;
      audit_transition text;
      audit_lease_id uuid := NULL;
      audit_disposition text := NULL;
      manual_reason text;
    BEGIN
      SELECT event.* INTO STRICT source_event
      FROM mainnet_financial_action_events AS event
      WHERE event.event_id = requested_source_event_id;
      SELECT intent.* INTO STRICT source_intent
      FROM mainnet_financial_action_intents AS intent
      WHERE intent.intent_id = source_event.intent_id FOR UPDATE;
      SELECT job.* INTO existing_job FROM ${JOBS} AS job
      WHERE job.source_event_id = source_event.event_id;
      IF FOUND THEN
        RETURN QUERY SELECT 'REPLAYED'::text, existing_job.job_id;
        RETURN;
      END IF;
      is_latest := NOT EXISTS (
        SELECT 1 FROM mainnet_financial_action_events AS later
        WHERE later.intent_id = source_event.intent_id
          AND later.revision > source_event.revision
      );
      IF is_latest THEN
        FOR existing_job IN
          SELECT job.* FROM ${JOBS} AS job
          WHERE job.intent_id = source_event.intent_id
            AND job.lifecycle_revision < source_event.revision
            AND job.job_status IN ('READY', 'LEASED')
          ORDER BY job.lifecycle_revision FOR UPDATE
        LOOP
          audit_lease_id := existing_job.lease_id;
          UPDATE ${JOBS} AS job SET
            job_status = 'SUPERSEDED', lease_id = NULL, claimed_at = NULL,
            lease_expires_at = NULL, state_version = job.state_version + 1
          WHERE job.job_id = existing_job.job_id RETURNING job.* INTO changed_job;
          audit_transition := 'SUPERSEDED';
          ${INSERT_AUDIT};
        END LOOP;
      END IF;
      initial_status := CASE
        WHEN source_event.stage = 'REORG_QUARANTINED' THEN 'MANUAL_REVIEW'
        WHEN is_latest THEN 'READY' ELSE 'SUPERSEDED' END;
      INSERT INTO ${JOBS} (
        scheduler_version, account_id, intent_id, intent_record_fingerprint_sha256,
        source_event_id, lifecycle_revision, lifecycle_snapshot_sha256,
        lifecycle_stage, network_id, action_type, queue_name, purpose,
        chain_transaction_id, reconciliation_outcome, job_status, maximum_attempts
      ) VALUES (
        1, source_intent.account_id, source_intent.intent_id,
        source_intent.intent_record_fingerprint_sha256, source_event.event_id,
        source_event.revision, source_event.snapshot_sha256, source_event.stage,
        source_intent.network_id, source_intent.action_type,
        CASE source_event.stage WHEN 'PREPARED' THEN 'PRE_BROADCAST'
          ELSE 'RECONCILIATION' END,
        CASE WHEN source_event.stage = 'PREPARED' THEN 'PRE_BROADCAST_SAFETY_REVIEW'
          WHEN source_event.stage IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')
            THEN 'POST_FINALITY_REVIEW'
          WHEN source_event.stage = 'REORG_QUARANTINED' THEN 'LIFECYCLE_QUARANTINE'
          ELSE 'RECONCILIATION_ADMISSION' END,
        source_event.chain_transaction_id, source_event.reconciliation_outcome,
        initial_status,
        CASE source_event.stage WHEN 'PREPARED' THEN 3 ELSE 12 END
      ) RETURNING * INTO changed_job;
      audit_transition := CASE WHEN initial_status = 'MANUAL_REVIEW'
        THEN 'MANUAL_REVIEW_REQUIRED' ELSE 'ENQUEUED' END;
      ${INSERT_AUDIT};
      IF initial_status = 'MANUAL_REVIEW' THEN
        manual_reason := 'LIFECYCLE_REORG_QUARANTINED';
        ${INSERT_MANUAL};
      END IF;
      RETURN QUERY SELECT 'ENQUEUED'::text, changed_job.job_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'scheduler lifecycle event is unavailable' USING ERRCODE = '55000';
    END;`;

const ENQUEUE_TRIGGER_BODY = `
    BEGIN
      PERFORM * FROM ${ENQUEUE}(NEW.event_id);
      RETURN NULL;
    END;`;

const CLAIM_BODY = `
    DECLARE
      changed_job ${JOBS}%ROWTYPE;
      database_now timestamptz;
      database_lease_id uuid;
      audit_transition text;
      audit_lease_id uuid;
      audit_disposition text := NULL;
      manual_reason text;
    BEGIN
      IF requested_queue_name NOT IN ('PRE_BROADCAST', 'RECONCILIATION')
        OR requested_lease_milliseconds IS NULL
        OR requested_lease_milliseconds < 1000
        OR requested_lease_milliseconds > 900000
      THEN RAISE EXCEPTION 'invalid scheduler claim request' USING ERRCODE = '22023'; END IF;
      LOOP
        database_now := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
        SELECT job.* INTO changed_job FROM ${JOBS} AS job
        WHERE job.queue_name = requested_queue_name
          AND ((job.job_status = 'READY' AND job.available_at <= database_now)
            OR (job.job_status = 'LEASED' AND job.lease_expires_at <= database_now))
          AND NOT EXISTS (
            SELECT 1 FROM mainnet_financial_action_events AS later
            WHERE later.intent_id = job.intent_id
              AND later.revision > job.lifecycle_revision
          )
        ORDER BY job.available_at, job.lifecycle_revision, job.job_id
        FOR UPDATE OF job SKIP LOCKED LIMIT 1;
        IF NOT FOUND THEN RETURN; END IF;
        IF changed_job.attempt_count >= changed_job.maximum_attempts
          OR changed_job.fencing_token >= ${UINT64_MAX}::numeric
        THEN
          manual_reason := CASE WHEN changed_job.fencing_token >= ${UINT64_MAX}::numeric
            THEN 'FENCING_TOKEN_EXHAUSTED' ELSE 'ATTEMPT_LIMIT_REACHED' END;
          audit_lease_id := changed_job.lease_id;
          UPDATE ${JOBS} AS job SET
            job_status = 'MANUAL_REVIEW', lease_id = NULL, claimed_at = NULL,
            lease_expires_at = NULL, state_version = job.state_version + 1
          WHERE job.job_id = changed_job.job_id RETURNING job.* INTO changed_job;
          audit_transition := 'MANUAL_REVIEW_REQUIRED';
          ${INSERT_AUDIT}; ${INSERT_MANUAL};
          CONTINUE;
        END IF;
        audit_transition := CASE WHEN changed_job.job_status = 'LEASED'
          THEN 'LEASE_RECOVERED' ELSE 'CLAIMED' END;
        database_lease_id := pg_catalog.gen_random_uuid();
        audit_lease_id := database_lease_id;
        UPDATE ${JOBS} AS job SET
          job_status = 'LEASED', attempt_count = job.attempt_count + 1,
          fencing_token = job.fencing_token + 1, lease_id = database_lease_id,
          claimed_at = database_now,
          lease_expires_at = database_now +
            requested_lease_milliseconds * interval '1 millisecond',
          state_version = job.state_version + 1
        WHERE job.job_id = changed_job.job_id RETURNING job.* INTO changed_job;
        ${INSERT_AUDIT};
        RETURN QUERY SELECT
          changed_job.scheduler_version, changed_job.job_id, changed_job.account_id,
          changed_job.intent_id, changed_job.intent_record_fingerprint_sha256,
          changed_job.network_id, changed_job.action_type,
          changed_job.lifecycle_revision, changed_job.lifecycle_snapshot_sha256,
          changed_job.lifecycle_stage, changed_job.queue_name, changed_job.purpose,
          changed_job.chain_transaction_id, changed_job.reconciliation_outcome,
          changed_job.attempt_count, changed_job.maximum_attempts,
          changed_job.lease_id, changed_job.fencing_token,
          changed_job.claimed_at, changed_job.lease_expires_at,
          false, false, false, false, false, false;
        RETURN;
      END LOOP;
    END;`;

const COMPLETE_BODY = `
    DECLARE
      changed_job ${JOBS}%ROWTYPE;
      database_now timestamptz;
      completion_outcome text;
      next_status text;
      manual_reason text;
      audit_transition text;
      audit_lease_id uuid := requested_lease_id;
      audit_disposition text := requested_disposition;
    BEGIN
      IF requested_job_id IS NULL OR requested_account_id IS NULL
        OR requested_intent_id IS NULL OR requested_queue_name IS NULL
        OR requested_lifecycle_revision IS NULL
        OR requested_lifecycle_snapshot_sha256 IS NULL
        OR requested_lease_id IS NULL OR requested_fencing_token IS NULL
        OR requested_disposition IS NULL
      THEN RAISE EXCEPTION 'invalid scheduler completion request'
        USING ERRCODE = '22023'; END IF;
      SELECT job.* INTO STRICT changed_job FROM ${JOBS} AS job
      WHERE job.job_id = requested_job_id FOR UPDATE;
      database_now := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF changed_job.account_id IS DISTINCT FROM requested_account_id
        OR changed_job.intent_id IS DISTINCT FROM requested_intent_id
        OR changed_job.queue_name IS DISTINCT FROM requested_queue_name
        OR changed_job.lifecycle_revision IS DISTINCT FROM requested_lifecycle_revision
        OR changed_job.lifecycle_snapshot_sha256 IS DISTINCT FROM requested_lifecycle_snapshot_sha256
      THEN RAISE EXCEPTION 'scheduler completion cursor conflict' USING ERRCODE = '40001'; END IF;
      IF changed_job.job_status <> 'LEASED' THEN
        IF changed_job.state_version = changed_job.last_completion_state_version
          AND changed_job.last_completion_lease_id = requested_lease_id
          AND changed_job.last_completion_fencing_token = requested_fencing_token
          AND changed_job.last_requested_disposition = requested_disposition
        THEN
          RETURN QUERY SELECT 'REPLAYED'::text, changed_job.last_completion_outcome,
            changed_job.job_status, changed_job.last_completed_at,
            changed_job.attempt_count, changed_job.maximum_attempts;
          RETURN;
        END IF;
        RAISE EXCEPTION 'scheduler completion lease is stale' USING ERRCODE = '40001';
      END IF;
      IF changed_job.lease_id IS DISTINCT FROM requested_lease_id
        OR changed_job.fencing_token IS DISTINCT FROM requested_fencing_token
        OR changed_job.lease_expires_at <= database_now
        OR EXISTS (
          SELECT 1 FROM mainnet_financial_action_events AS later
          WHERE later.intent_id = changed_job.intent_id
            AND later.revision > changed_job.lifecycle_revision
        )
      THEN RAISE EXCEPTION 'scheduler completion lease is stale' USING ERRCODE = '40001'; END IF;
      IF (changed_job.queue_name = 'PRE_BROADCAST' AND requested_disposition NOT IN (
          'PRE_BROADCAST_REVIEW_COMPLETED', 'RETRY_PRE_BROADCAST_REVIEW_ONLY',
          'PRE_BROADCAST_TERMINAL_FAILURE'
        )) OR (changed_job.queue_name = 'RECONCILIATION' AND requested_disposition NOT IN (
          'RECONCILIATION_COMPLETED', 'RETRY_RECONCILIATION_ONLY',
          'MANUAL_REVIEW_REQUIRED'
        ))
      THEN RAISE EXCEPTION 'scheduler completion disposition is invalid'
        USING ERRCODE = '22023'; END IF;
      IF requested_disposition IN (
        'PRE_BROADCAST_REVIEW_COMPLETED', 'RECONCILIATION_COMPLETED'
      ) THEN
        completion_outcome := 'COMPLETED'; next_status := 'COMPLETED';
      ELSIF requested_disposition IN (
        'RETRY_PRE_BROADCAST_REVIEW_ONLY', 'RETRY_RECONCILIATION_ONLY'
      ) AND changed_job.attempt_count < changed_job.maximum_attempts THEN
        completion_outcome := CASE changed_job.queue_name WHEN 'PRE_BROADCAST'
          THEN 'RELEASE_PRE_BROADCAST_ONLY' ELSE 'RELEASE_RECONCILIATION_ONLY' END;
        next_status := 'READY';
      ELSE
        next_status := 'MANUAL_REVIEW';
        IF requested_disposition = 'PRE_BROADCAST_TERMINAL_FAILURE' THEN
          completion_outcome := 'TERMINAL_FAILURE';
          manual_reason := 'PRE_BROADCAST_TERMINAL_FAILURE';
        ELSIF requested_disposition = 'MANUAL_REVIEW_REQUIRED' THEN
          completion_outcome := 'MANUAL_REVIEW_REQUIRED';
          manual_reason := 'MANUAL_REVIEW_REQUIRED';
        ELSE
          completion_outcome := 'ATTEMPT_LIMIT_REACHED';
          manual_reason := 'ATTEMPT_LIMIT_REACHED';
        END IF;
      END IF;
      UPDATE ${JOBS} AS job SET
        job_status = next_status, lease_id = NULL, claimed_at = NULL,
        lease_expires_at = NULL,
        available_at = CASE WHEN next_status = 'READY' THEN database_now +
          CASE changed_job.queue_name WHEN 'PRE_BROADCAST' THEN interval '250 milliseconds'
            ELSE interval '1 second' END ELSE job.available_at END,
        last_completion_lease_id = requested_lease_id,
        last_completion_fencing_token = requested_fencing_token,
        last_requested_disposition = requested_disposition,
        last_completion_outcome = completion_outcome,
        last_completed_at = database_now,
        last_completion_state_version = job.state_version + 1,
        state_version = job.state_version + 1
      WHERE job.job_id = changed_job.job_id RETURNING job.* INTO changed_job;
      audit_transition := CASE next_status
        WHEN 'READY' THEN 'RELEASED'
        WHEN 'COMPLETED' THEN 'COMPLETED'
        ELSE 'MANUAL_REVIEW_REQUIRED' END;
      ${INSERT_AUDIT};
      IF next_status = 'MANUAL_REVIEW' THEN ${INSERT_MANUAL}; END IF;
      RETURN QUERY SELECT 'RECORDED'::text, completion_outcome,
        changed_job.job_status, changed_job.last_completed_at,
        changed_job.attempt_count, changed_job.maximum_attempts;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'scheduler completion job is unavailable' USING ERRCODE = '40001';
    END;`;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const principals = [
    'PUBLIC',
    identifier(names.apiRuntimeRole, 'apiRuntimeRole'),
    identifier(names.workerRuntimeRole, 'workerRuntimeRole'),
    identifier(names.legacyRuntimeRole, 'legacyRuntimeRole'),
    identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole'),
    identifier(names.migrationRole, 'migrationRole'),
  ].join(', ');
  return `LOCK TABLE mainnet_financial_action_events IN ACCESS EXCLUSIVE MODE;

    CREATE TABLE ${JOBS} (
      job_id uuid NOT NULL,
      scheduler_version smallint NOT NULL,
      account_id uuid NOT NULL,
      intent_id uuid NOT NULL,
      intent_record_fingerprint_sha256 text NOT NULL,
      source_event_id uuid NOT NULL,
      lifecycle_revision bigint NOT NULL,
      lifecycle_snapshot_sha256 text NOT NULL,
      lifecycle_stage text NOT NULL,
      network_id text NOT NULL,
      action_type text NOT NULL,
      queue_name text NOT NULL,
      purpose text NOT NULL,
      chain_transaction_id text,
      reconciliation_outcome text,
      job_status text NOT NULL,
      maximum_attempts smallint NOT NULL,
      attempt_count smallint NOT NULL DEFAULT 0,
      fencing_token numeric(20,0) NOT NULL DEFAULT 0,
      lease_id uuid,
      claimed_at timestamptz,
      lease_expires_at timestamptz,
      available_at timestamptz NOT NULL,
      last_completion_lease_id uuid,
      last_completion_fencing_token numeric(20,0),
      last_requested_disposition text,
      last_completion_outcome text,
      last_completed_at timestamptz,
      last_completion_state_version bigint,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      state_version bigint NOT NULL,
      state_fingerprint_sha256 text NOT NULL,
      ${AUTHORITY_COLUMNS},
      CONSTRAINT mainnet_action_scheduler_job_pkey PRIMARY KEY (job_id),
      CONSTRAINT mainnet_action_scheduler_job_source_unique UNIQUE (source_event_id),
      CONSTRAINT mainnet_action_scheduler_job_cursor_unique UNIQUE (intent_id, lifecycle_revision),
      CONSTRAINT mainnet_action_scheduler_job_active_lease_unique UNIQUE (lease_id),
      CONSTRAINT mainnet_action_scheduler_job_event_id_fk FOREIGN KEY (source_event_id)
        REFERENCES mainnet_financial_action_events (event_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_scheduler_job_event_revision_fk FOREIGN KEY (
        intent_id, lifecycle_revision
      ) REFERENCES mainnet_financial_action_events (intent_id, revision)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_scheduler_job_event_snapshot_fk FOREIGN KEY (
        intent_id, lifecycle_snapshot_sha256
      ) REFERENCES mainnet_financial_action_events (intent_id, snapshot_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_scheduler_job_intent_fingerprint_fk
        FOREIGN KEY (intent_record_fingerprint_sha256)
        REFERENCES mainnet_financial_action_intents (intent_record_fingerprint_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_scheduler_job_digest_check CHECK (
        scheduler_version = 1 AND lifecycle_revision > 0
        AND lifecycle_snapshot_sha256 ~ '^[0-9a-f]{64}$'
        AND lifecycle_snapshot_sha256 <> repeat('0', 64)
        AND intent_record_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND intent_record_fingerprint_sha256 <> repeat('0', 64)
        AND state_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND state_fingerprint_sha256 <> repeat('0', 64)
      ),
      CONSTRAINT mainnet_action_scheduler_job_uuid_check CHECK (
        substring(job_id::text FROM 15 FOR 1) = '4'
        AND substring(job_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND (lease_id IS NULL OR (substring(lease_id::text FROM 15 FOR 1) = '4'
          AND substring(lease_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')))
        AND (last_completion_lease_id IS NULL OR (
          substring(last_completion_lease_id::text FROM 15 FOR 1) = '4'
          AND substring(last_completion_lease_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')))
      ),
      CONSTRAINT mainnet_action_scheduler_job_authority_check CHECK (${AUTHORITY_CHECK}),
      CONSTRAINT mainnet_action_scheduler_job_attempt_check CHECK (
        maximum_attempts IN (3, 12) AND attempt_count BETWEEN 0 AND maximum_attempts
        AND fencing_token BETWEEN 0 AND ${UINT64_MAX}::numeric
        AND state_version > 0
      ),
      CONSTRAINT mainnet_action_scheduler_job_lease_check CHECK (
        (job_status = 'LEASED') =
          (lease_id IS NOT NULL AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL)
        AND (job_status = 'LEASED' OR
          (lease_id IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL))
        AND (claimed_at IS NULL OR claimed_at < lease_expires_at)
        AND (claimed_at IS NULL OR lease_expires_at - claimed_at <= interval '15 minutes')
      ),
      CONSTRAINT mainnet_action_scheduler_job_time_check CHECK (
        isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at)
        AND date_trunc('milliseconds', available_at) = available_at
        AND date_trunc('milliseconds', created_at) = created_at
        AND date_trunc('milliseconds', updated_at) = updated_at
        AND (claimed_at IS NULL OR (isfinite(claimed_at) AND
          date_trunc('milliseconds', claimed_at) = claimed_at))
        AND (lease_expires_at IS NULL OR (isfinite(lease_expires_at) AND
          date_trunc('milliseconds', lease_expires_at) = lease_expires_at))
        AND (last_completed_at IS NULL OR (isfinite(last_completed_at) AND
          date_trunc('milliseconds', last_completed_at) = last_completed_at))
        AND created_at <= updated_at
      ),
      CONSTRAINT mainnet_action_scheduler_job_completion_check CHECK (
        (last_completion_lease_id IS NULL AND last_completion_fencing_token IS NULL
          AND last_requested_disposition IS NULL AND last_completion_outcome IS NULL
          AND last_completed_at IS NULL AND last_completion_state_version IS NULL)
        OR (last_completion_lease_id IS NOT NULL
          AND last_completion_fencing_token BETWEEN 1 AND ${UINT64_MAX}::numeric
          AND last_requested_disposition IN (
            'PRE_BROADCAST_REVIEW_COMPLETED', 'RETRY_PRE_BROADCAST_REVIEW_ONLY',
            'PRE_BROADCAST_TERMINAL_FAILURE', 'RECONCILIATION_COMPLETED',
            'RETRY_RECONCILIATION_ONLY', 'MANUAL_REVIEW_REQUIRED'
          )
          AND last_completion_outcome IN (
            'COMPLETED', 'TERMINAL_FAILURE', 'RELEASE_PRE_BROADCAST_ONLY',
            'RELEASE_RECONCILIATION_ONLY', 'MANUAL_REVIEW_REQUIRED',
            'ATTEMPT_LIMIT_REACHED'
          ) AND last_completed_at IS NOT NULL
          AND last_completion_state_version BETWEEN 2 AND state_version)
      ),
      CONSTRAINT mainnet_action_scheduler_job_shape_check CHECK (
        job_status IN ('READY', 'LEASED', 'COMPLETED', 'SUPERSEDED', 'MANUAL_REVIEW')
        AND network_id IN ('eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        AND action_type IN ('SUPPLY', 'WITHDRAW')
        AND ((queue_name = 'PRE_BROADCAST' AND maximum_attempts = 3
          AND purpose = 'PRE_BROADCAST_SAFETY_REVIEW'
          AND lifecycle_stage = 'PREPARED' AND lifecycle_revision = 1
          AND chain_transaction_id IS NULL AND reconciliation_outcome IS NULL)
        OR (queue_name = 'RECONCILIATION' AND maximum_attempts = 12
          AND chain_transaction_id IS NOT NULL AND (
            (lifecycle_stage IN ('WALLET_SIGNED_SUBMISSION_BOUND', 'BROADCAST_OUTCOME_AMBIGUOUS')
              AND purpose = 'RECONCILIATION_ADMISSION' AND reconciliation_outcome IS NULL)
            OR (lifecycle_stage = 'RECONCILIATION_AMBIGUOUS'
              AND purpose = 'RECONCILIATION_ADMISSION'
              AND reconciliation_outcome IN ('PENDING', 'UNKNOWN'))
            OR (lifecycle_stage IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE')
              AND purpose = 'POST_FINALITY_REVIEW'
              AND reconciliation_outcome = lifecycle_stage)
            OR (lifecycle_stage = 'REORG_QUARANTINED'
              AND purpose = 'LIFECYCLE_QUARANTINE'
              AND reconciliation_outcome = 'REORGED_OUT'
              AND job_status = 'MANUAL_REVIEW'))))
      )
    );
    COMMENT ON TABLE ${JOBS} IS '${JOB_MANIFEST}';
    CREATE INDEX mainnet_action_scheduler_job_claim_ready
      ON ${JOBS} (queue_name, available_at, lifecycle_revision, job_id)
      WHERE job_status = 'READY';
    CREATE INDEX mainnet_action_scheduler_job_claim_expired
      ON ${JOBS} (queue_name, lease_expires_at, lifecycle_revision, job_id)
      WHERE job_status = 'LEASED';
    CREATE INDEX mainnet_action_scheduler_job_intent_timeline
      ON ${JOBS} (intent_id, lifecycle_revision DESC);

    CREATE TABLE ${AUDIT} (
      audit_event_id uuid NOT NULL,
      job_id uuid NOT NULL,
      state_version bigint NOT NULL,
      transition text NOT NULL,
      job_status text NOT NULL,
      queue_name text NOT NULL,
      intent_id uuid NOT NULL,
      lifecycle_revision bigint NOT NULL,
      lifecycle_snapshot_sha256 text NOT NULL,
      attempt_count smallint NOT NULL,
      fencing_token numeric(20,0) NOT NULL,
      subject_lease_id uuid,
      requested_disposition text,
      recorded_at timestamptz NOT NULL,
      audit_fingerprint_sha256 text NOT NULL,
      ${AUTHORITY_COLUMNS},
      CONSTRAINT mainnet_action_scheduler_event_pkey PRIMARY KEY (audit_event_id),
      CONSTRAINT mainnet_action_scheduler_event_state_unique UNIQUE (job_id, state_version),
      CONSTRAINT mainnet_action_scheduler_event_fingerprint_unique UNIQUE (audit_fingerprint_sha256),
      CONSTRAINT mainnet_action_scheduler_event_job_fk FOREIGN KEY (job_id)
        REFERENCES ${JOBS} (job_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_scheduler_event_digest_check CHECK (
        lifecycle_revision > 0 AND state_version > 0
        AND lifecycle_snapshot_sha256 ~ '^[0-9a-f]{64}$'
        AND lifecycle_snapshot_sha256 <> repeat('0', 64)
        AND audit_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND audit_fingerprint_sha256 <> repeat('0', 64)
      ),
      CONSTRAINT mainnet_action_scheduler_event_uuid_check CHECK (
        substring(audit_event_id::text FROM 15 FOR 1) = '4'
        AND substring(audit_event_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND (subject_lease_id IS NULL OR (
          substring(subject_lease_id::text FROM 15 FOR 1) = '4'
          AND substring(subject_lease_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')))
      ),
      CONSTRAINT mainnet_action_scheduler_event_shape_check CHECK (
        queue_name IN ('PRE_BROADCAST', 'RECONCILIATION')
        AND attempt_count BETWEEN 0 AND 12
        AND fencing_token BETWEEN 0 AND ${UINT64_MAX}::numeric
        AND ((transition = 'ENQUEUED' AND job_status IN ('READY', 'SUPERSEDED')
            AND subject_lease_id IS NULL AND requested_disposition IS NULL)
          OR (transition IN ('CLAIMED', 'LEASE_RECOVERED') AND job_status = 'LEASED'
            AND subject_lease_id IS NOT NULL AND requested_disposition IS NULL
            AND attempt_count > 0 AND fencing_token > 0)
          OR (transition = 'RELEASED' AND job_status = 'READY'
            AND subject_lease_id IS NOT NULL
            AND requested_disposition IN (
              'RETRY_PRE_BROADCAST_REVIEW_ONLY', 'RETRY_RECONCILIATION_ONLY'
            ))
          OR (transition = 'COMPLETED' AND job_status = 'COMPLETED'
            AND subject_lease_id IS NOT NULL
            AND requested_disposition IN (
              'PRE_BROADCAST_REVIEW_COMPLETED', 'RECONCILIATION_COMPLETED'
            ))
          OR (transition = 'SUPERSEDED' AND job_status = 'SUPERSEDED'
            AND requested_disposition IS NULL)
          OR (transition = 'MANUAL_REVIEW_REQUIRED' AND job_status = 'MANUAL_REVIEW'
            AND (requested_disposition IS NULL OR requested_disposition IN (
              'RETRY_PRE_BROADCAST_REVIEW_ONLY', 'PRE_BROADCAST_TERMINAL_FAILURE',
              'RETRY_RECONCILIATION_ONLY', 'MANUAL_REVIEW_REQUIRED'
            ))))
      ),
      CONSTRAINT mainnet_action_scheduler_event_time_check CHECK (
        isfinite(recorded_at) AND date_trunc('milliseconds', recorded_at) = recorded_at
      ),
      CONSTRAINT mainnet_action_scheduler_event_authority_check CHECK (${AUTHORITY_CHECK})
    );
    COMMENT ON TABLE ${AUDIT} IS '${AUDIT_MANIFEST}';
    CREATE UNIQUE INDEX mainnet_action_scheduler_event_lease_grant_unique
      ON ${AUDIT} (subject_lease_id)
      WHERE transition IN ('CLAIMED', 'LEASE_RECOVERED');

    CREATE TABLE ${MANUAL} (
      case_id uuid NOT NULL,
      job_id uuid NOT NULL,
      account_id uuid NOT NULL,
      intent_id uuid NOT NULL,
      source_event_id uuid NOT NULL,
      lifecycle_revision bigint NOT NULL,
      lifecycle_snapshot_sha256 text NOT NULL,
      queue_name text NOT NULL,
      reason text NOT NULL,
      attempt_count smallint NOT NULL,
      fencing_token numeric(20,0) NOT NULL,
      recorded_at timestamptz NOT NULL,
      case_fingerprint_sha256 text NOT NULL,
      ${AUTHORITY_COLUMNS},
      CONSTRAINT mainnet_action_scheduler_manual_review_pkey PRIMARY KEY (case_id),
      CONSTRAINT mainnet_action_scheduler_manual_review_job_unique UNIQUE (job_id),
      CONSTRAINT mainnet_action_scheduler_manual_review_fingerprint_unique UNIQUE (case_fingerprint_sha256),
      CONSTRAINT mainnet_action_scheduler_manual_review_job_fk FOREIGN KEY (job_id)
        REFERENCES ${JOBS} (job_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_scheduler_manual_review_shape_check CHECK (
        lifecycle_revision > 0 AND queue_name IN ('PRE_BROADCAST', 'RECONCILIATION')
        AND reason IN ('ATTEMPT_LIMIT_REACHED', 'PRE_BROADCAST_TERMINAL_FAILURE',
          'MANUAL_REVIEW_REQUIRED', 'LIFECYCLE_REORG_QUARANTINED',
          'FENCING_TOKEN_EXHAUSTED')
        AND attempt_count BETWEEN 0 AND 12
        AND fencing_token BETWEEN 0 AND ${UINT64_MAX}::numeric
        AND lifecycle_snapshot_sha256 ~ '^[0-9a-f]{64}$'
        AND lifecycle_snapshot_sha256 <> repeat('0', 64)
        AND case_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND case_fingerprint_sha256 <> repeat('0', 64)
      ),
      CONSTRAINT mainnet_action_scheduler_manual_review_uuid_check CHECK (
        substring(case_id::text FROM 15 FOR 1) = '4'
        AND substring(case_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT mainnet_action_scheduler_manual_review_time_check CHECK (
        isfinite(recorded_at) AND date_trunc('milliseconds', recorded_at) = recorded_at
      ),
      CONSTRAINT mainnet_action_scheduler_manual_review_authority_check CHECK (${AUTHORITY_CHECK})
    );
    COMMENT ON TABLE ${MANUAL} IS '${MANUAL_MANIFEST}';

    CREATE FUNCTION ${JOB_GUARD}() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${JOB_GUARD_BODY}$function$;
    CREATE FUNCTION ${AUDIT_GUARD}() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${AUDIT_GUARD_BODY}$function$;
    CREATE FUNCTION ${MANUAL_GUARD}() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${MANUAL_GUARD_BODY}$function$;
    CREATE FUNCTION ${ENQUEUE}(requested_source_event_id uuid)
      RETURNS TABLE (enqueue_outcome text, result_job_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
      AS $function$${ENQUEUE_BODY}$function$;
    CREATE FUNCTION ${ENQUEUE_TRIGGER}() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${ENQUEUE_TRIGGER_BODY}$function$;
    CREATE FUNCTION ${CLAIM}(requested_queue_name text, requested_lease_milliseconds integer)
      RETURNS TABLE (
        scheduler_version smallint, job_id uuid, account_id uuid, intent_id uuid,
        intent_record_fingerprint_sha256 text, network_id text, action_type text,
        lifecycle_revision bigint, lifecycle_snapshot_sha256 text,
        lifecycle_stage text, queue_name text, purpose text,
        chain_transaction_id text, reconciliation_outcome text,
        attempt_count smallint, maximum_attempts smallint, lease_id uuid,
        fencing_token numeric, claimed_at timestamptz, lease_expires_at timestamptz,
        may_authorize_financial_action boolean, may_construct_transaction boolean,
        api_may_sign boolean, api_may_broadcast boolean,
        may_resubmit_transaction boolean, ledger_settlement_authority boolean
      ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE
      AS $function$${CLAIM_BODY}$function$;
    CREATE FUNCTION ${COMPLETE}(
      requested_job_id uuid, requested_account_id uuid, requested_intent_id uuid,
      requested_queue_name text, requested_lifecycle_revision bigint,
      requested_lifecycle_snapshot_sha256 text, requested_lease_id uuid,
      requested_fencing_token numeric, requested_disposition text
    ) RETURNS TABLE (
      record_outcome text, completion_outcome text, resulting_job_status text,
      server_completed_at timestamptz, attempt_count smallint,
      maximum_attempts smallint
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE
      AS $function$${COMPLETE_BODY}$function$;

    CREATE TRIGGER mainnet_action_scheduler_job_guard
      BEFORE INSERT OR UPDATE ON ${JOBS}
      FOR EACH ROW EXECUTE FUNCTION ${JOB_GUARD}();
    CREATE TRIGGER mainnet_action_scheduler_job_no_delete
      BEFORE DELETE OR TRUNCATE ON ${JOBS}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE TRIGGER mainnet_action_scheduler_audit_guard
      BEFORE INSERT ON ${AUDIT}
      FOR EACH ROW EXECUTE FUNCTION ${AUDIT_GUARD}();
    CREATE TRIGGER mainnet_action_scheduler_audit_append_only_row
      BEFORE UPDATE OR DELETE ON ${AUDIT}
      FOR EACH ROW EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE TRIGGER mainnet_action_scheduler_audit_append_only_truncate
      BEFORE TRUNCATE ON ${AUDIT}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE TRIGGER mainnet_action_scheduler_manual_guard
      BEFORE INSERT ON ${MANUAL}
      FOR EACH ROW EXECUTE FUNCTION ${MANUAL_GUARD}();
    CREATE TRIGGER mainnet_action_scheduler_manual_append_only_row
      BEFORE UPDATE OR DELETE ON ${MANUAL}
      FOR EACH ROW EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE TRIGGER mainnet_action_scheduler_manual_append_only_truncate
      BEFORE TRUNCATE ON ${MANUAL}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE TRIGGER mainnet_action_scheduler_after_lifecycle_event
      AFTER INSERT ON mainnet_financial_action_events
      FOR EACH ROW EXECUTE FUNCTION ${ENQUEUE_TRIGGER}();

    DO $scheduler_backfill$
    DECLARE event_record record;
    BEGIN
      FOR event_record IN SELECT event_id FROM mainnet_financial_action_events
        ORDER BY intent_id, revision
      LOOP PERFORM * FROM ${ENQUEUE}(event_record.event_id); END LOOP;
    END;
    $scheduler_backfill$;

    DO $set_scheduler_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${FUNCTION_IDENTITIES.map(
        (identity) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${identity} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );`,
      ).join('\n      ')}
    END;
    $set_scheduler_paths$;

    ${['mainnet_action_scheduler_job_guard', 'mainnet_action_scheduler_job_no_delete']
      .map((trigger) => `ALTER TABLE ${JOBS} ENABLE ALWAYS TRIGGER ${trigger};`)
      .join('\n    ')}
    ${[
      'mainnet_action_scheduler_audit_guard',
      'mainnet_action_scheduler_audit_append_only_row',
      'mainnet_action_scheduler_audit_append_only_truncate',
    ]
      .map((trigger) => `ALTER TABLE ${AUDIT} ENABLE ALWAYS TRIGGER ${trigger};`)
      .join('\n    ')}
    ${[
      'mainnet_action_scheduler_manual_guard',
      'mainnet_action_scheduler_manual_append_only_row',
      'mainnet_action_scheduler_manual_append_only_truncate',
    ]
      .map((trigger) => `ALTER TABLE ${MANUAL} ENABLE ALWAYS TRIGGER ${trigger};`)
      .join('\n    ')}
    ALTER TABLE mainnet_financial_action_events ENABLE ALWAYS TRIGGER
      mainnet_action_scheduler_after_lifecycle_event;

    REVOKE ALL PRIVILEGES ON TABLE ${JOBS}, ${AUDIT}, ${MANUAL} FROM ${principals};
    REVOKE ALL PRIVILEGES ON TYPE ${JOBS}, ${AUDIT}, ${MANUAL} FROM ${principals};
    ${FUNCTION_IDENTITIES.map(
      (identity) => `REVOKE ALL ON FUNCTION ${identity} FROM ${principals};`,
    ).join('\n    ')}`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const principals = [
    'PUBLIC',
    identifier(names.apiRuntimeRole, 'apiRuntimeRole'),
    identifier(names.workerRuntimeRole, 'workerRuntimeRole'),
    identifier(names.legacyRuntimeRole, 'legacyRuntimeRole'),
    identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole'),
    identifier(names.migrationRole, 'migrationRole'),
  ].join(', ');
  return `LOCK TABLE mainnet_financial_action_events, ${JOBS}, ${AUDIT}, ${MANUAL}
      IN ACCESS EXCLUSIVE MODE;
    DO $refuse_scheduler_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${JOBS})
        OR EXISTS (SELECT 1 FROM ${AUDIT}) OR EXISTS (SELECT 1 FROM ${MANUAL})
      THEN RAISE EXCEPTION 'cannot roll back durable mainnet scheduler history'
        USING ERRCODE = '55000'; END IF;
    END;
    $refuse_scheduler_history_loss$;
    ${FUNCTION_IDENTITIES.slice()
      .reverse()
      .map((identity) => `REVOKE ALL ON FUNCTION ${identity} FROM ${principals};`)
      .join('\n    ')}
    DROP TRIGGER mainnet_action_scheduler_after_lifecycle_event
      ON mainnet_financial_action_events;
    DROP TRIGGER mainnet_action_scheduler_manual_append_only_truncate ON ${MANUAL};
    DROP TRIGGER mainnet_action_scheduler_manual_append_only_row ON ${MANUAL};
    DROP TRIGGER mainnet_action_scheduler_manual_guard ON ${MANUAL};
    DROP TRIGGER mainnet_action_scheduler_audit_append_only_truncate ON ${AUDIT};
    DROP TRIGGER mainnet_action_scheduler_audit_append_only_row ON ${AUDIT};
    DROP TRIGGER mainnet_action_scheduler_audit_guard ON ${AUDIT};
    DROP TRIGGER mainnet_action_scheduler_job_no_delete ON ${JOBS};
    DROP TRIGGER mainnet_action_scheduler_job_guard ON ${JOBS};
    ${FUNCTION_IDENTITIES.slice()
      .reverse()
      .map((identity) => `DROP FUNCTION ${identity};`)
      .join('\n    ')}
    DROP TABLE ${MANUAL}; DROP TABLE ${AUDIT}; DROP TABLE ${JOBS};`;
}

function relationVerifier(
  names: BalanceConsumerPrincipalNames,
  table: string,
  manifest: string,
  columns: readonly (readonly [string, string, boolean])[],
  cumulative: boolean,
): string {
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const expected = columns
    .map(
      ([name, type, notNull], index) => `('${name}', '${type}', ${notNull}, ${String(index + 1)})`,
    )
    .join(',\n          ');
  return `SELECT pg_catalog.count(*) = ${columns.length}
      AND pg_catalog.count(attribute.attname) = ${columns.length}
      AND pg_catalog.bool_and(
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = expected.type_name
        AND attribute.attnotnull = expected.not_null AND attribute.attnum = expected.ordinal
      ) AND relation.relkind = 'r' AND relation.relpersistence = 'p'
      AND relation.relreplident = 'd' AND NOT relation.relrowsecurity
      AND NOT relation.relforcerowsecurity AND NOT relation.relispartition
      AND relation.relpartbound IS NULL
      AND pg_catalog.obj_description(relation.oid, 'pg_class') = '${manifest}'
      AND relation_owner.rolname = ${cumulative ? owner : 'relation_owner.rolname'}
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
        COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl WHERE acl.grantee <> relation.relowner)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute guarded
        CROSS JOIN LATERAL pg_catalog.aclexplode(guarded.attacl) acl
        WHERE guarded.attrelid = relation.oid AND guarded.attnum > 0
          AND NOT guarded.attisdropped AND acl.grantee <> relation.relowner
      )
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy
        WHERE policy.polrelid = relation.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite
        WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN')
      AND (SELECT row_type.typtype = 'c' AND row_type.typrelid = relation.oid
        AND row_type.typowner = relation.relowner
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
          row_type.typacl, pg_catalog.acldefault('T', row_type.typowner)
        )) acl WHERE acl.grantee <> row_type.typowner)
        FROM pg_catalog.pg_type row_type WHERE row_type.oid = relation.reltype)
      AS valid
    FROM (VALUES ${expected}) AS expected(column_name, type_name, not_null, ordinal)
    LEFT JOIN pg_catalog.pg_class relation ON relation.oid = pg_catalog.to_regclass('${table}')
    LEFT JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
      AND attribute.attname = expected.column_name AND NOT attribute.attisdropped
    LEFT JOIN pg_catalog.pg_roles relation_owner ON relation_owner.oid = relation.relowner
    GROUP BY relation.oid, relation.relkind, relation.relowner, relation_owner.rolname`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetFinancialActionWalletIdentityRotationRecoveryMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0040 must expose verification SQL');
  let prior = replaceExactlyOnce(
    previous.verifySql,
    `        ('mainnet_financial_action_events', 'mainnet_action_signed_submission_proof_after_event', 'validate_mainnet_financial_action_signed_submission_proof_v1()', 5, true, true)
      )
      SELECT pg_catalog.count(*) = 12 AND pg_catalog.count(trigger_record.oid) = 12`,
    `        ('mainnet_financial_action_events', 'mainnet_action_signed_submission_proof_after_event', 'validate_mainnet_financial_action_signed_submission_proof_v1()', 5, true, true),
        ('mainnet_financial_action_events',
          'mainnet_action_scheduler_after_lifecycle_event',
          '${ENQUEUE_TRIGGER}()', 5, false, false)
      )
      SELECT pg_catalog.count(*) = 13 AND pg_catalog.count(trigger_record.oid) = 13`,
  );
  prior = replaceExactlyOnce(
    prior,
    `          SELECT pg_catalog.count(*) = 12
          FROM pg_catalog.pg_trigger AS all_trigger`,
    `          SELECT pg_catalog.count(*) = 13
          FROM pg_catalog.pg_trigger AS all_trigger`,
  );
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const functions = [
    [FUNCTION_IDENTITIES[0], JOB_GUARD_BODY, false, 'trigger', [], []],
    [FUNCTION_IDENTITIES[1], AUDIT_GUARD_BODY, false, 'trigger', [], []],
    [FUNCTION_IDENTITIES[2], MANUAL_GUARD_BODY, false, 'trigger', [], []],
    [
      FUNCTION_IDENTITIES[3],
      ENQUEUE_BODY,
      true,
      'TABLE(enqueue_outcome text, result_job_id uuid)',
      ['requested_source_event_id'],
      ['uuid'],
    ],
    [FUNCTION_IDENTITIES[4], ENQUEUE_TRIGGER_BODY, false, 'trigger', [], []],
    [
      FUNCTION_IDENTITIES[5],
      CLAIM_BODY,
      false,
      'TABLE(scheduler_version smallint, job_id uuid, account_id uuid, intent_id uuid, intent_record_fingerprint_sha256 text, network_id text, action_type text, lifecycle_revision bigint, lifecycle_snapshot_sha256 text, lifecycle_stage text, queue_name text, purpose text, chain_transaction_id text, reconciliation_outcome text, attempt_count smallint, maximum_attempts smallint, lease_id uuid, fencing_token numeric, claimed_at timestamp with time zone, lease_expires_at timestamp with time zone, may_authorize_financial_action boolean, may_construct_transaction boolean, api_may_sign boolean, api_may_broadcast boolean, may_resubmit_transaction boolean, ledger_settlement_authority boolean)',
      ['requested_queue_name', 'requested_lease_milliseconds'],
      ['text', 'integer'],
    ],
    [
      FUNCTION_IDENTITIES[6],
      COMPLETE_BODY,
      false,
      'TABLE(record_outcome text, completion_outcome text, resulting_job_status text, server_completed_at timestamp with time zone, attempt_count smallint, maximum_attempts smallint)',
      [
        'requested_job_id',
        'requested_account_id',
        'requested_intent_id',
        'requested_queue_name',
        'requested_lifecycle_revision',
        'requested_lifecycle_snapshot_sha256',
        'requested_lease_id',
        'requested_fencing_token',
        'requested_disposition',
      ],
      ['uuid', 'uuid', 'uuid', 'text', 'bigint', 'text', 'uuid', 'numeric', 'text'],
    ],
  ] as const;
  const functionValues = functions
    .map(
      ([identity, body, strict, result, inputNames, inputTypes]) =>
        `('${identity}', '${sourceSha256(body)}', ${strict}, '${result}', ARRAY[${inputNames
          .map((name) => `'${name}'`)
          .join(', ')}]::text[], ARRAY[${inputTypes
          .map((type) => `'${type}'::regtype`)
          .join(', ')}]::oid[])`,
    )
    .join(',\n          ');
  return `SELECT (
      prior.valid AND jobs.valid AND audit.valid AND manual.valid AND columns.valid
      AND constraints.valid AND indexes.valid AND functions.valid
      AND triggers.valid AND data.valid
    ) AS valid
    FROM (${prior}) prior
    CROSS JOIN (${relationVerifier(names, JOBS, JOB_MANIFEST, JOB_COLUMNS, cumulative)}) jobs
    CROSS JOIN (${relationVerifier(names, AUDIT, AUDIT_MANIFEST, AUDIT_COLUMNS, cumulative)}) audit
    CROSS JOIN (${relationVerifier(names, MANUAL, MANUAL_MANIFEST, MANUAL_COLUMNS, cumulative)}) manual
    CROSS JOIN (
      WITH catalog_rows AS (
        SELECT relation.relname, attribute.attname, attribute.attnum,
          attribute.attnotnull,
          pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
          attribute.atthasdef, attribute.attidentity, attribute.attgenerated,
          attribute.attstorage, attribute.attcompression, attribute.attstattarget,
          COALESCE(pg_catalog.pg_get_expr(
            default_record.adbin, default_record.adrelid
          ), '-') AS default_expression,
          COALESCE(named_collation.collname, '-') AS collation_name,
          COALESCE((collation_namespace.nspname = 'pg_catalog')::text, '-')
            AS collation_is_catalog
        FROM pg_catalog.pg_class relation
        INNER JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = relation.oid
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
        LEFT JOIN pg_catalog.pg_attrdef default_record
          ON default_record.adrelid = relation.oid
          AND default_record.adnum = attribute.attnum
        LEFT JOIN pg_catalog.pg_collation named_collation
          ON named_collation.oid = attribute.attcollation
        LEFT JOIN pg_catalog.pg_namespace collation_namespace
          ON collation_namespace.oid = named_collation.collnamespace
        WHERE relation.oid IN (
          pg_catalog.to_regclass('${JOBS}'), pg_catalog.to_regclass('${AUDIT}'),
          pg_catalog.to_regclass('${MANUAL}')
        )
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            relname, attname, attnum, attnotnull, type_name, atthasdef,
            attidentity, attgenerated, attstorage, attcompression, attstattarget,
            default_expression, collation_name, collation_is_catalog
          ), E'\\n' ORDER BY relname, attnum) AS catalog_state
        FROM catalog_rows
      ) SELECT row_count = 79 AND COALESCE(pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(catalog_state, 'UTF8')
      ), 'hex') = '${SCHEDULER_COLUMN_CATALOG_SHA256}', false) AS valid
      FROM canonical
    ) columns
    CROSS JOIN (
      WITH catalog_rows AS (
        SELECT relation.relname, constraint_record.*,
          foreign_relation.relname AS foreign_relname,
          foreign_namespace.nspname AS foreign_nspname,
          backing_index.relname AS backing_name,
          backing_namespace.nspname AS backing_nspname
        FROM pg_catalog.pg_constraint constraint_record
        INNER JOIN pg_catalog.pg_class relation
          ON relation.oid = constraint_record.conrelid
        LEFT JOIN pg_catalog.pg_class foreign_relation
          ON foreign_relation.oid = constraint_record.confrelid
        LEFT JOIN pg_catalog.pg_namespace foreign_namespace
          ON foreign_namespace.oid = foreign_relation.relnamespace
        LEFT JOIN pg_catalog.pg_class backing_index
          ON backing_index.oid = constraint_record.conindid
        LEFT JOIN pg_catalog.pg_namespace backing_namespace
          ON backing_namespace.oid = backing_index.relnamespace
        WHERE constraint_record.conrelid IN (
          pg_catalog.to_regclass('${JOBS}'), pg_catalog.to_regclass('${AUDIT}'),
          pg_catalog.to_regclass('${MANUAL}')
        )
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
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
            COALESCE(pg_catalog.regexp_replace(
              pg_catalog.pg_get_constraintdef(oid, false), '[[:space:]]+', '', 'g'
            ), '-')
          ), E'\\n' ORDER BY relname, conname) AS catalog_state
        FROM catalog_rows
      )
      SELECT row_count = 33 AND COALESCE(pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(catalog_state, 'UTF8')
      ), 'hex') = '${SCHEDULER_CONSTRAINT_CATALOG_SHA256}', false) AS valid
      FROM canonical
    ) constraints
    CROSS JOIN (
      WITH catalog_rows AS (
        SELECT relation.relname, index_relation.relname AS index_name,
          index_record.*,
          pg_catalog.replace(pg_catalog.pg_get_indexdef(index_record.indexrelid),
            pg_catalog.current_schema(), '<schema>') AS index_definition,
          COALESCE(pg_catalog.pg_get_expr(
            index_record.indexprs, index_record.indrelid
          ), '-') AS expressions,
          COALESCE(pg_catalog.pg_get_expr(
            index_record.indpred, index_record.indrelid
          ), '-') AS predicate,
          access_method.amname
        FROM pg_catalog.pg_index index_record
        INNER JOIN pg_catalog.pg_class relation
          ON relation.oid = index_record.indrelid
        INNER JOIN pg_catalog.pg_class index_relation
          ON index_relation.oid = index_record.indexrelid
        INNER JOIN pg_catalog.pg_am access_method
          ON access_method.oid = index_relation.relam
        WHERE index_record.indrelid IN (
          pg_catalog.to_regclass('${JOBS}'), pg_catalog.to_regclass('${AUDIT}'),
          pg_catalog.to_regclass('${MANUAL}')
        )
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            relname, index_name, indisunique, indnullsnotdistinct, indisprimary,
            indisexclusion, indimmediate, indisclustered, indisvalid, indcheckxmin,
            indisready, indislive, indisreplident, indnatts, indnkeyatts,
            indkey::text, indcollation::text, indclass::text, indoption::text,
            index_definition, expressions || '|' || predicate || '|' || amname
          ), E'\\n' ORDER BY relname, index_name) AS catalog_state
        FROM catalog_rows
      ) SELECT row_count = 14 AND COALESCE(pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(catalog_state, 'UTF8')
      ), 'hex') = '${SCHEDULER_INDEX_CATALOG_SHA256}', false) AS valid
      FROM canonical
    ) indexes
    CROSS JOIN (
      WITH expected(
        function_identity, body_sha256, is_strict, result_shape,
        input_names, input_type_oids
      ) AS (VALUES
          ${functionValues}
      ) SELECT pg_catalog.count(*) = 7 AND pg_catalog.count(procedure.oid) = 7
        AND pg_catalog.bool_and(procedure.prokind = 'f' AND procedure.prosecdef
          AND NOT procedure.proleakproof AND procedure.provolatile = 'v'
          AND procedure.proparallel = 'u' AND procedure.proisstrict = expected.is_strict
          AND procedure.pronargdefaults = 0 AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid AND language.lanname = 'plpgsql'
          AND procedure.pronargs = pg_catalog.cardinality(expected.input_names)
          AND ARRAY(
            SELECT input_type FROM pg_catalog.unnest(procedure.proargtypes::oid[])
              WITH ORDINALITY AS input(input_type, ordinal) ORDER BY ordinal
          ) = expected.input_type_oids
          AND COALESCE(
            procedure.proargnames[1:procedure.pronargs], ARRAY[]::text[]
          ) = expected.input_names
          AND CASE WHEN expected.result_shape = 'trigger' THEN
            NOT procedure.proretset AND procedure.prorettype = 'trigger'::regtype
            AND procedure.proallargtypes IS NULL AND procedure.proargmodes IS NULL
          ELSE
            procedure.proretset AND procedure.prorettype = 'record'::regtype
            AND procedure.proallargtypes[1:procedure.pronargs] = expected.input_type_oids
            AND procedure.proargmodes[1:procedure.pronargs] =
              pg_catalog.array_fill('i'::"char", ARRAY[procedure.pronargs])
            AND pg_catalog.cardinality(procedure.proallargtypes) > procedure.pronargs
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.generate_series(
                procedure.pronargs + 1,
                pg_catalog.cardinality(procedure.proallargtypes)
              ) AS output(ordinal)
              WHERE procedure.proargmodes[output.ordinal] <> 't'::"char"
            )
          END
          AND pg_catalog.pg_get_function_result(procedure.oid) = expected.result_shape
          AND procedure.proconfig = ARRAY['search_path=pg_catalog, ' ||
            pg_catalog.current_schema() || ', pg_temp']::text[]
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            procedure.prosrc, 'UTF8')), 'hex') = expected.body_sha256
          AND function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT pg_catalog.has_function_privilege(${api}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${worker}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${legacy}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${balance}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${migration}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('public', expected.function_identity, 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
            procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
          )) acl WHERE acl.grantee <> procedure.proowner)
        ) AS valid FROM expected
      LEFT JOIN pg_catalog.pg_proc procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles function_owner ON function_owner.oid = procedure.proowner
    ) functions
    CROSS JOIN (
      WITH expected(table_name, trigger_name, function_identity, trigger_type) AS (VALUES
        ('${JOBS}', 'mainnet_action_scheduler_job_guard', '${JOB_GUARD}()', 23),
        ('${JOBS}', 'mainnet_action_scheduler_job_no_delete', 'reject_mainnet_action_history_mutation()', 42),
        ('${AUDIT}', 'mainnet_action_scheduler_audit_guard', '${AUDIT_GUARD}()', 7),
        ('${AUDIT}', 'mainnet_action_scheduler_audit_append_only_row', 'reject_mainnet_action_history_mutation()', 27),
        ('${AUDIT}', 'mainnet_action_scheduler_audit_append_only_truncate', 'reject_mainnet_action_history_mutation()', 34),
        ('${MANUAL}', 'mainnet_action_scheduler_manual_guard', '${MANUAL_GUARD}()', 7),
        ('${MANUAL}', 'mainnet_action_scheduler_manual_append_only_row', 'reject_mainnet_action_history_mutation()', 27),
        ('${MANUAL}', 'mainnet_action_scheduler_manual_append_only_truncate', 'reject_mainnet_action_history_mutation()', 34),
        ('mainnet_financial_action_events', 'mainnet_action_scheduler_after_lifecycle_event', '${ENQUEUE_TRIGGER}()', 5)
      ) SELECT pg_catalog.count(*) = 9 AND pg_catalog.count(trigger_record.oid) = 9
        AND pg_catalog.bool_and(trigger_record.tgenabled = 'A'
          AND NOT trigger_record.tgisinternal
          AND trigger_record.tgrelid = pg_catalog.to_regclass(expected.table_name)
          AND trigger_record.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
          AND trigger_record.tgtype = expected.trigger_type
          AND trigger_record.tgnargs = 0 AND trigger_record.tgparentid = 0
          AND NOT trigger_record.tgdeferrable AND NOT trigger_record.tginitdeferred
          AND trigger_record.tgconstraint = 0
          AND trigger_record.tgoldtable IS NULL AND trigger_record.tgnewtable IS NULL)
        AND (SELECT pg_catalog.count(*) = 8 FROM pg_catalog.pg_trigger all_trigger
          WHERE NOT all_trigger.tgisinternal AND all_trigger.tgrelid IN (
            pg_catalog.to_regclass('${JOBS}'), pg_catalog.to_regclass('${AUDIT}'),
            pg_catalog.to_regclass('${MANUAL}')
          ))
        AS valid FROM expected LEFT JOIN pg_catalog.pg_trigger trigger_record
        ON trigger_record.tgrelid = pg_catalog.to_regclass(expected.table_name)
        AND trigger_record.tgname = expected.trigger_name
    ) triggers
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1 FROM mainnet_financial_action_events event
        LEFT JOIN ${JOBS} job ON job.source_event_id = event.event_id
          AND job.intent_id = event.intent_id AND job.lifecycle_revision = event.revision
          AND job.lifecycle_snapshot_sha256 = event.snapshot_sha256
        WHERE job.job_id IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM ${JOBS} job
        LEFT JOIN ${AUDIT} audit ON audit.job_id = job.job_id
          AND audit.state_version = job.state_version
        WHERE audit.audit_event_id IS NULL
          OR audit.job_status IS DISTINCT FROM job.job_status
          OR audit.queue_name IS DISTINCT FROM job.queue_name
          OR audit.intent_id IS DISTINCT FROM job.intent_id
          OR audit.lifecycle_revision IS DISTINCT FROM job.lifecycle_revision
          OR audit.lifecycle_snapshot_sha256 IS DISTINCT FROM job.lifecycle_snapshot_sha256
          OR audit.attempt_count IS DISTINCT FROM job.attempt_count
          OR audit.fencing_token IS DISTINCT FROM job.fencing_token
      ) AND NOT EXISTS (
        SELECT 1 FROM ${JOBS} job LEFT JOIN ${MANUAL} manual ON manual.job_id = job.job_id
        WHERE (job.job_status = 'MANUAL_REVIEW') IS DISTINCT FROM (manual.case_id IS NOT NULL)
          OR (manual.case_id IS NOT NULL AND (
            manual.account_id IS DISTINCT FROM job.account_id
            OR manual.intent_id IS DISTINCT FROM job.intent_id
            OR manual.source_event_id IS DISTINCT FROM job.source_event_id
            OR manual.lifecycle_revision IS DISTINCT FROM job.lifecycle_revision
            OR manual.lifecycle_snapshot_sha256 IS DISTINCT FROM job.lifecycle_snapshot_sha256
            OR manual.queue_name IS DISTINCT FROM job.queue_name
            OR manual.attempt_count IS DISTINCT FROM job.attempt_count
            OR manual.fencing_token IS DISTINCT FROM job.fencing_token
          ))
      ) AND NOT EXISTS (
        SELECT 1 FROM ${JOBS} job WHERE job.state_fingerprint_sha256 IS DISTINCT FROM
          ${jobFingerprint('job')}
      ) AND NOT EXISTS (
        SELECT 1 FROM ${AUDIT} audit WHERE audit.audit_fingerprint_sha256 IS DISTINCT FROM
          ${auditFingerprint('audit')}
      ) AND NOT EXISTS (
        SELECT 1 FROM ${MANUAL} manual WHERE manual.case_fingerprint_sha256 IS DISTINCT FROM
          ${manualFingerprint('manual')}
      ) AND NOT EXISTS (
        SELECT 1 FROM ${JOBS} job
        LEFT JOIN LATERAL (
          SELECT pg_catalog.count(*) AS audit_count,
            pg_catalog.min(history.state_version) AS minimum_state_version,
            pg_catalog.max(history.state_version) AS maximum_state_version
          FROM ${AUDIT} history WHERE history.job_id = job.job_id
        ) history_state ON true
        WHERE history_state.audit_count <> job.state_version
          OR history_state.minimum_state_version <> 1
          OR history_state.maximum_state_version <> job.state_version
      ) AND NOT EXISTS (
        SELECT 1 FROM ${JOBS} job
        WHERE job.job_status IN ('READY', 'LEASED') AND EXISTS (
          SELECT 1 FROM mainnet_financial_action_events later
          WHERE later.intent_id = job.intent_id AND later.revision > job.lifecycle_revision
        )
      ) AND NOT EXISTS (
        WITH ordered AS (
          SELECT audit.*, job.lifecycle_stage AS source_stage,
            pg_catalog.lag(audit.job_status) OVER history AS previous_status,
            pg_catalog.lag(audit.attempt_count) OVER history AS previous_attempt,
            pg_catalog.lag(audit.fencing_token) OVER history AS previous_fence,
            pg_catalog.lag(audit.subject_lease_id) OVER history AS previous_subject_lease_id,
            pg_catalog.lag(audit.recorded_at) OVER history AS previous_recorded_at,
            job.account_id AS source_account_id, job.intent_id AS source_intent_id,
            job.lifecycle_revision AS source_revision,
            job.lifecycle_snapshot_sha256 AS source_snapshot,
            job.queue_name AS source_queue
          FROM ${AUDIT} audit INNER JOIN ${JOBS} job ON job.job_id = audit.job_id
          WINDOW history AS (PARTITION BY audit.job_id ORDER BY audit.state_version)
        )
        SELECT 1 FROM ordered audit WHERE
          audit.intent_id IS DISTINCT FROM audit.source_intent_id
          OR audit.lifecycle_revision IS DISTINCT FROM audit.source_revision
          OR audit.lifecycle_snapshot_sha256 IS DISTINCT FROM audit.source_snapshot
          OR audit.queue_name IS DISTINCT FROM audit.source_queue
          OR audit.previous_recorded_at > audit.recorded_at
          OR CASE WHEN audit.state_version = 1 THEN NOT (
            audit.attempt_count = 0 AND audit.fencing_token = 0
            AND audit.subject_lease_id IS NULL AND audit.requested_disposition IS NULL
            AND ((audit.source_stage = 'REORG_QUARANTINED'
                AND audit.transition = 'MANUAL_REVIEW_REQUIRED'
                AND audit.job_status = 'MANUAL_REVIEW')
              OR (audit.source_stage <> 'REORG_QUARANTINED'
                AND audit.transition = 'ENQUEUED'
                AND audit.job_status IN ('READY', 'SUPERSEDED')))
          ) ELSE NOT (
            (audit.transition = 'CLAIMED' AND audit.previous_status = 'READY'
              AND audit.job_status = 'LEASED'
              AND audit.attempt_count = audit.previous_attempt + 1
              AND audit.fencing_token = audit.previous_fence + 1
              AND audit.subject_lease_id IS NOT NULL)
            OR (audit.transition = 'LEASE_RECOVERED'
              AND audit.previous_status = 'LEASED' AND audit.job_status = 'LEASED'
              AND audit.attempt_count = audit.previous_attempt + 1
              AND audit.fencing_token = audit.previous_fence + 1
              AND audit.subject_lease_id IS NOT NULL
              AND audit.subject_lease_id IS DISTINCT FROM audit.previous_subject_lease_id)
            OR (audit.transition = 'RELEASED' AND audit.previous_status = 'LEASED'
              AND audit.job_status = 'READY'
              AND audit.attempt_count = audit.previous_attempt
              AND audit.fencing_token = audit.previous_fence
              AND audit.subject_lease_id = audit.previous_subject_lease_id)
            OR (audit.transition = 'COMPLETED' AND audit.previous_status = 'LEASED'
              AND audit.job_status = 'COMPLETED'
              AND audit.attempt_count = audit.previous_attempt
              AND audit.fencing_token = audit.previous_fence
              AND audit.subject_lease_id = audit.previous_subject_lease_id)
            OR (audit.transition = 'SUPERSEDED'
              AND audit.previous_status IN ('READY', 'LEASED')
              AND audit.job_status = 'SUPERSEDED'
              AND audit.attempt_count = audit.previous_attempt
              AND audit.fencing_token = audit.previous_fence
              AND audit.subject_lease_id IS NOT DISTINCT FROM CASE
                WHEN audit.previous_status = 'LEASED'
                  THEN audit.previous_subject_lease_id ELSE NULL END)
            OR (audit.transition = 'MANUAL_REVIEW_REQUIRED'
              AND audit.previous_status IN ('READY', 'LEASED')
              AND audit.job_status = 'MANUAL_REVIEW'
              AND audit.attempt_count = audit.previous_attempt
              AND audit.fencing_token = audit.previous_fence
              AND audit.subject_lease_id IS NOT DISTINCT FROM CASE
                WHEN audit.previous_status = 'LEASED'
                  THEN audit.previous_subject_lease_id ELSE NULL END)
          ) END
      ) AND NOT EXISTS (
        SELECT 1 FROM ${JOBS} job INNER JOIN ${AUDIT} audit
          ON audit.job_id = job.job_id AND audit.state_version = job.state_version
        WHERE (job.job_status = 'LEASED' AND (
            audit.transition NOT IN ('CLAIMED', 'LEASE_RECOVERED')
            OR audit.subject_lease_id IS DISTINCT FROM job.lease_id
            OR audit.fencing_token IS DISTINCT FROM job.fencing_token
            OR audit.recorded_at < job.claimed_at
            OR audit.recorded_at - job.claimed_at > interval '30 seconds'
          )) OR (audit.transition IN ('RELEASED', 'COMPLETED')
            OR (audit.transition = 'MANUAL_REVIEW_REQUIRED'
              AND audit.requested_disposition IS NOT NULL)) AND (
            job.last_completion_state_version IS DISTINCT FROM job.state_version
            OR audit.subject_lease_id IS DISTINCT FROM job.last_completion_lease_id
            OR audit.fencing_token IS DISTINCT FROM job.last_completion_fencing_token
            OR audit.requested_disposition IS DISTINCT FROM job.last_requested_disposition
            OR job.last_completion_outcome IS DISTINCT FROM CASE
              WHEN audit.transition = 'RELEASED' AND audit.queue_name = 'PRE_BROADCAST'
                THEN 'RELEASE_PRE_BROADCAST_ONLY'
              WHEN audit.transition = 'RELEASED' THEN 'RELEASE_RECONCILIATION_ONLY'
              WHEN audit.transition = 'COMPLETED' THEN 'COMPLETED'
              WHEN audit.requested_disposition = 'PRE_BROADCAST_TERMINAL_FAILURE'
                THEN 'TERMINAL_FAILURE'
              WHEN audit.requested_disposition = 'MANUAL_REVIEW_REQUIRED'
                THEN 'MANUAL_REVIEW_REQUIRED'
              ELSE 'ATTEMPT_LIMIT_REACHED' END
            OR audit.recorded_at < job.last_completed_at
            OR audit.recorded_at - job.last_completed_at > interval '30 seconds'
          )
      ) AND NOT EXISTS (
        SELECT 1 FROM ${JOBS} job WHERE job.queue_name = 'PRE_BROADCAST'
          AND (job.lifecycle_stage <> 'PREPARED' OR job.chain_transaction_id IS NOT NULL
            OR job.reconciliation_outcome IS NOT NULL)
      ) AS valid
    ) data`;
}

export function createMainnetFinancialActionDurableSchedulerMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0042',
    description: 'create dormant mainnet financial action durable two-queue scheduler',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0040'],
  };
}

export const createMainnetFinancialActionDurableSchedulerMigrationV0042 =
  createMainnetFinancialActionDurableSchedulerMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionDurableSchedulerTestSchemaMigrationV0042 =
  createMainnetFinancialActionDurableSchedulerMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
