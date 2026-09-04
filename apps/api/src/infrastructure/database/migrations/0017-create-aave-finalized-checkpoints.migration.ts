import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createWalletRegistrationRevocationMigration } from './0016-revoke-wallet-registration.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MANIFEST_FINGERPRINT = '5a322f54a2209b0bb79ccd7cb415fd501c10c5ce9be8e6caa15e9d7badf548a7';
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const READ_PLAN_FINGERPRINT = '332f1ec7b3f5d96ca0631f1de6b7ffbf764a2795abebe8f9d1df60075d374c4f';
const READ_FUNCTION_IDENTITY = 'read_aave_v3_ethereum_finalized_checkpoint(text)';
const RECORD_FUNCTION_IDENTITY =
  'record_aave_v3_ethereum_finalized_checkpoint(bigint,uuid,text,text,text,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone)';
const RECOVER_FUNCTION_IDENTITY =
  'recover_aave_v3_ethereum_finalized_checkpoint(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb)';
const EVENT_GUARD_FUNCTION_IDENTITY = 'reject_aave_v3_ethereum_checkpoint_event_mutation()';
const HEAD_GUARD_FUNCTION_IDENTITY = 'enforce_aave_v3_ethereum_checkpoint_head_transition()';

const PRIOR_API_FUNCTIONS = [
  'begin_wallet_ownership_challenge(uuid,uuid,text,text,text,text,integer,text,smallint,bytea,bytea,bytea,smallint,bytea,smallint,bytea,smallint,bytea,smallint,bytea,timestamp with time zone,timestamp with time zone,uuid)',
  'prepare_wallet_ownership_challenge(uuid,uuid,uuid)',
  'reject_wallet_ownership_challenge(uuid,uuid,text,uuid)',
  'complete_wallet_registration(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'list_active_wallet_registrations(uuid)',
  'revoke_wallet_registration(uuid,uuid,uuid)',
  'complete_wallet_registration_guarded(uuid,uuid,uuid,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea,uuid)',
  'verify_wallet_revocation_state()',
] as const;
const PRIOR_WORKER_FUNCTIONS = ['verify_wallet_revocation_state()'] as const;

const EVENT_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'Aave finalized checkpoint events are append-only'
        USING ERRCODE = '55000';
    END;
    `;

const HEAD_GUARD_BODY = `
    BEGIN
      IF NEW.source_reference_id IS DISTINCT FROM OLD.source_reference_id
        OR NEW.deployment_manifest_fingerprint_sha256 IS DISTINCT FROM OLD.deployment_manifest_fingerprint_sha256
        OR NEW.asset_registry_fingerprint_sha256 IS DISTINCT FROM OLD.asset_registry_fingerprint_sha256
        OR NEW.read_plan_fingerprint_sha256 IS DISTINCT FROM OLD.read_plan_fingerprint_sha256
        OR NEW.revision <> OLD.revision + 1
        OR NEW.last_validated_at < OLD.last_validated_at
        OR NEW.finalized_advanced_at < OLD.finalized_advanced_at
      THEN
        RAISE EXCEPTION 'invalid Aave finalized checkpoint head transition'
          USING ERRCODE = '23514';
      END IF;

      IF OLD.status = 'QUARANTINED' THEN
        IF NEW.status <> 'ACTIVE'
          OR NEW.quarantine_reason IS NOT NULL
          OR NEW.quarantined_at IS NOT NULL
          OR NEW.quarantine_event_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM aave_v3_ethereum_finalized_checkpoint_recovery_events AS recovery
            WHERE recovery.source_reference_id = OLD.source_reference_id
              AND recovery.operation = 'QUARANTINE_RECOVERY'
              AND recovery.expected_status = 'QUARANTINED'
              AND recovery.expected_revision = OLD.revision
              AND recovery.resulting_revision = NEW.revision
              AND recovery.expected_quarantine_reason = OLD.quarantine_reason
              AND recovery.expected_quarantined_at =
                pg_catalog.date_trunc('milliseconds', OLD.quarantined_at)
              AND recovery.expected_last_good_event_id = OLD.last_good_event_id
              AND recovery.expected_last_validated_at = OLD.last_validated_at
              AND recovery.recovered_checkpoint_event_id = NEW.last_good_event_id
          )
        THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery transition'
            USING ERRCODE = '23514';
        END IF;
      ELSIF EXISTS (
        SELECT 1
        FROM aave_v3_ethereum_finalized_checkpoint_events AS event
        WHERE event.event_id = NEW.last_good_event_id
          AND event.source_reference_id = OLD.source_reference_id
          AND event.outcome = 'BACKFILLED'
      ) THEN
        IF NEW.status <> 'ACTIVE'
          OR NEW.quarantine_reason IS NOT NULL
          OR NEW.quarantined_at IS NOT NULL
          OR NEW.quarantine_event_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM aave_v3_ethereum_finalized_checkpoint_recovery_events AS recovery
            WHERE recovery.source_reference_id = OLD.source_reference_id
              AND recovery.operation = 'CONTINUITY_BACKFILL'
              AND recovery.expected_status = 'ACTIVE'
              AND recovery.expected_revision = OLD.revision
              AND recovery.resulting_revision = NEW.revision
              AND recovery.expected_quarantine_reason IS NULL
              AND recovery.expected_quarantined_at IS NULL
              AND recovery.expected_last_good_event_id = OLD.last_good_event_id
              AND recovery.expected_last_validated_at = OLD.last_validated_at
              AND recovery.recovered_checkpoint_event_id = NEW.last_good_event_id
          )
        THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint backfill transition'
            USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.status = 'QUARANTINED' THEN
        IF OLD.status <> 'ACTIVE'
          OR NEW.quarantine_reason IS NULL
          OR NEW.quarantined_at IS NULL
          OR NEW.quarantine_event_id IS NULL
          OR NEW.last_good_event_id IS DISTINCT FROM OLD.last_good_event_id
          OR NEW.finalized_advanced_at IS DISTINCT FROM OLD.finalized_advanced_at
          OR NEW.last_validated_at IS DISTINCT FROM OLD.last_validated_at
          OR NOT EXISTS (
            SELECT 1
            FROM aave_v3_ethereum_finalized_checkpoint_events AS quarantine
            WHERE quarantine.event_id = NEW.quarantine_event_id
              AND quarantine.source_reference_id = OLD.source_reference_id
              AND quarantine.expected_revision = OLD.revision
              AND quarantine.resulting_revision = NEW.revision
              AND quarantine.outcome = 'QUARANTINED'
              AND quarantine.reason_code = NEW.quarantine_reason
              AND quarantine.recorded_at = NEW.quarantined_at
              AND quarantine.recorded_at = NEW.updated_at
          )
        THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint quarantine transition'
            USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.status = 'ACTIVE' THEN
        IF NEW.quarantine_reason IS NOT NULL
          OR NEW.quarantined_at IS NOT NULL
          OR NEW.quarantine_event_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM aave_v3_ethereum_finalized_checkpoint_events AS candidate
            INNER JOIN aave_v3_ethereum_finalized_checkpoint_events AS previous
              ON previous.event_id = OLD.last_good_event_id
              AND previous.source_reference_id = OLD.source_reference_id
            WHERE candidate.event_id = NEW.last_good_event_id
              AND candidate.source_reference_id = OLD.source_reference_id
              AND candidate.expected_revision = OLD.revision
              AND candidate.resulting_revision = NEW.revision
              AND candidate.outcome IN ('ADVANCED', 'REOBSERVED')
              AND candidate.observed_at = NEW.last_validated_at
              AND candidate.recorded_at = NEW.updated_at
              AND (
                (
                  candidate.outcome = 'ADVANCED'
                  AND candidate.block_number = previous.block_number + 1
                  AND candidate.parent_hash = previous.block_hash
                  AND candidate.block_timestamp > previous.block_timestamp
                  AND NEW.finalized_advanced_at = candidate.observed_at
                ) OR (
                  candidate.outcome = 'REOBSERVED'
                  AND candidate.block_number = previous.block_number
                  AND candidate.block_hash = previous.block_hash
                  AND candidate.parent_hash = previous.parent_hash
                  AND candidate.state_root = previous.state_root
                  AND candidate.block_timestamp = previous.block_timestamp
                  AND candidate.content_fingerprint_sha256 =
                    previous.content_fingerprint_sha256
                  AND NEW.finalized_advanced_at = OLD.finalized_advanced_at
                )
              )
          )
        THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint active transition'
            USING ERRCODE = '23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'invalid Aave finalized checkpoint head status'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    `;

const READ_BODY = `
      SELECT
        1::smallint AS checkpoint_schema_version,
        'AAVE_V3_ETHEREUM'::text AS checkpoint_deployment_id,
        'eip155:1'::text AS checkpoint_network_id,
        head.source_reference_id AS checkpoint_source_reference_id,
        head.deployment_manifest_fingerprint_sha256 AS checkpoint_manifest_fingerprint,
        head.asset_registry_fingerprint_sha256 AS checkpoint_registry_fingerprint,
        head.read_plan_fingerprint_sha256 AS checkpoint_read_plan_fingerprint,
        head.revision AS checkpoint_revision,
        head.status AS checkpoint_status,
        good.block_number AS checkpoint_block_number,
        good.block_hash AS checkpoint_block_hash,
        good.parent_hash AS checkpoint_parent_hash,
        good.state_root AS checkpoint_state_root,
        good.block_timestamp AS checkpoint_block_timestamp,
        good.source_observation_id AS checkpoint_source_observation_id,
        good.evidence_fingerprint_sha256 AS checkpoint_evidence_fingerprint,
        good.content_fingerprint_sha256 AS checkpoint_content_fingerprint,
        good.observed_at AS checkpoint_observed_at,
        head.finalized_advanced_at AS checkpoint_finalized_advanced_at,
        head.last_validated_at AS checkpoint_last_validated_at,
        head.quarantine_reason AS checkpoint_quarantine_reason,
        head.quarantined_at AS checkpoint_quarantined_at
      FROM aave_v3_ethereum_finalized_checkpoint_heads AS head
      INNER JOIN aave_v3_ethereum_finalized_checkpoint_events AS good
        ON good.event_id = head.last_good_event_id
      WHERE head.source_reference_id = requested_source_reference_id
    `;

const RECORD_BODY = `
    DECLARE
      recorded_at timestamptz := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      current_head aave_v3_ethereum_finalized_checkpoint_heads%ROWTYPE;
      current_good aave_v3_ethereum_finalized_checkpoint_events%ROWTYPE;
      prior_event aave_v3_ethereum_finalized_checkpoint_events%ROWTYPE;
      decision text;
      reason text;
      resulting_revision bigint;
      candidate_is_good boolean := false;
      advances_finalized boolean := false;
    BEGIN
      IF requested_correlation_id IS NULL
        OR substring(requested_correlation_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_correlation_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_source_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_source_observation_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_evidence_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_content_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_command_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_block_number < 1
        OR requested_block_number > 18446744073709551615
        OR requested_block_number <> trunc(requested_block_number)
        OR requested_block_hash !~ '^0x[0-9a-f]{64}$'
        OR requested_parent_hash !~ '^0x[0-9a-f]{64}$'
        OR requested_state_root !~ '^0x[0-9a-f]{64}$'
        OR requested_block_hash = '0x' || repeat('0', 64)
        OR requested_parent_hash = '0x' || repeat('0', 64)
        OR requested_state_root = '0x' || repeat('0', 64)
        OR requested_block_hash = requested_parent_hash
        OR requested_block_timestamp > requested_observed_at
        OR requested_observed_at > recorded_at + interval '30 seconds'
        OR (requested_expected_revision IS NOT NULL AND requested_expected_revision < 1)
      THEN
        RAISE EXCEPTION 'invalid Aave finalized checkpoint command' USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_correlation_id::text, 57001)
      );
      SELECT event.* INTO prior_event
      FROM aave_v3_ethereum_finalized_checkpoint_events AS event
      WHERE event.event_id = requested_correlation_id;
      IF FOUND THEN
        IF prior_event.command_fingerprint_sha256 <> requested_command_fingerprint THEN
          RAISE EXCEPTION 'Aave finalized checkpoint idempotency conflict'
            USING ERRCODE = 'A1701';
        END IF;
        decision := 'IDEMPOTENT_REPLAY';
        RETURN QUERY
        SELECT decision, checkpoint.*
        FROM read_aave_v3_ethereum_finalized_checkpoint(requested_source_reference_id) AS checkpoint;
        IF NOT FOUND THEN
          RETURN QUERY SELECT decision, NULL::smallint, NULL::text, NULL::text, NULL::text,
            NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::numeric,
            NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text, NULL::text,
            NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
            NULL::text, NULL::timestamptz;
        END IF;
        RETURN;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_source_reference_id, 57002)
      );
      SELECT head.* INTO current_head
      FROM aave_v3_ethereum_finalized_checkpoint_heads AS head
      WHERE head.source_reference_id = requested_source_reference_id
      FOR UPDATE;

      IF NOT FOUND THEN
        IF requested_expected_revision IS NULL THEN
          decision := 'CREATED';
          reason := 'NONE';
          resulting_revision := 1;
          candidate_is_good := true;
          advances_finalized := true;
        ELSE
          decision := 'REVISION_CONFLICT';
          reason := 'EXPECTED_REVISION_MISMATCH';
        END IF;
      ELSE
        SELECT event.* INTO STRICT current_good
        FROM aave_v3_ethereum_finalized_checkpoint_events AS event
        WHERE event.event_id = current_head.last_good_event_id;

        IF requested_expected_revision IS NULL
          OR requested_expected_revision <> current_head.revision
        THEN
          decision := 'REVISION_CONFLICT';
          reason := 'EXPECTED_REVISION_MISMATCH';
        ELSIF current_head.status = 'QUARANTINED' THEN
          decision := 'ALREADY_QUARANTINED';
          reason := 'CHECKPOINT_QUARANTINED';
        ELSIF requested_observed_at < current_head.last_validated_at THEN
          decision := 'OBSERVATION_TIME_REGRESSION';
          reason := 'OBSERVATION_TIME_REGRESSION';
        ELSIF requested_block_number < current_good.block_number THEN
          decision := 'QUARANTINED';
          reason := 'FINALIZED_HEIGHT_REGRESSION';
          resulting_revision := current_head.revision + 1;
        ELSIF requested_block_number = current_good.block_number THEN
          IF requested_block_hash = current_good.block_hash
            AND requested_parent_hash = current_good.parent_hash
            AND requested_state_root = current_good.state_root
            AND requested_block_timestamp = current_good.block_timestamp
            AND requested_content_fingerprint = current_good.content_fingerprint_sha256
          THEN
            decision := 'REOBSERVED';
            reason := 'NONE';
            resulting_revision := current_head.revision + 1;
            candidate_is_good := true;
          ELSIF requested_block_hash = current_good.block_hash
            AND requested_parent_hash = current_good.parent_hash
            AND requested_state_root = current_good.state_root
            AND requested_block_timestamp = current_good.block_timestamp
          THEN
            decision := 'QUARANTINED';
            reason := 'SAME_BLOCK_EVIDENCE_DIVERGENCE';
            resulting_revision := current_head.revision + 1;
          ELSE
            decision := 'QUARANTINED';
            reason := 'FINALIZED_BLOCK_DIVERGENCE';
            resulting_revision := current_head.revision + 1;
          END IF;
        ELSIF requested_block_timestamp <= current_good.block_timestamp THEN
          decision := 'QUARANTINED';
          reason := 'FINALIZED_TIMESTAMP_REGRESSION';
          resulting_revision := current_head.revision + 1;
        ELSIF requested_block_number = current_good.block_number + 1 THEN
          IF requested_parent_hash <> current_good.block_hash THEN
            decision := 'QUARANTINED';
            reason := 'FINALIZED_PARENT_MISMATCH';
            resulting_revision := current_head.revision + 1;
          ELSE
            decision := 'ADVANCED';
            reason := 'NONE';
            resulting_revision := current_head.revision + 1;
            candidate_is_good := true;
            advances_finalized := true;
          END IF;
        ELSIF requested_parent_hash = current_good.block_hash THEN
          decision := 'QUARANTINED';
          reason := 'FINALIZED_PARENT_MISMATCH';
          resulting_revision := current_head.revision + 1;
        ELSE
          decision := 'CONTINUITY_REQUIRED';
          reason := 'FINALIZED_HEIGHT_GAP';
        END IF;
      END IF;

      INSERT INTO aave_v3_ethereum_finalized_checkpoint_events (
        event_id, source_reference_id, command_fingerprint_sha256,
        expected_revision, resulting_revision, outcome, reason_code,
        source_observation_id, evidence_fingerprint_sha256,
        content_fingerprint_sha256, block_number, block_hash, parent_hash,
        state_root, block_timestamp, observed_at, recorded_at
      ) VALUES (
        requested_correlation_id, requested_source_reference_id,
        requested_command_fingerprint, requested_expected_revision,
        resulting_revision, decision, reason, requested_source_observation_id,
        requested_evidence_fingerprint, requested_content_fingerprint,
        requested_block_number, requested_block_hash, requested_parent_hash,
        requested_state_root, requested_block_timestamp, requested_observed_at,
        recorded_at
      );

      IF decision = 'CREATED' THEN
        INSERT INTO aave_v3_ethereum_finalized_checkpoint_heads (
          source_reference_id, revision, status, last_good_event_id,
          finalized_advanced_at, last_validated_at, updated_at
        ) VALUES (
          requested_source_reference_id, resulting_revision, 'ACTIVE',
          requested_correlation_id, requested_observed_at, requested_observed_at,
          recorded_at
        );
      ELSIF candidate_is_good THEN
        UPDATE aave_v3_ethereum_finalized_checkpoint_heads AS head
        SET revision = resulting_revision,
            last_good_event_id = requested_correlation_id,
            finalized_advanced_at = CASE WHEN advances_finalized
              THEN requested_observed_at ELSE head.finalized_advanced_at END,
            last_validated_at = requested_observed_at,
            updated_at = recorded_at
        WHERE head.source_reference_id = requested_source_reference_id;
      ELSIF decision = 'QUARANTINED' THEN
        UPDATE aave_v3_ethereum_finalized_checkpoint_heads AS head
        SET revision = resulting_revision,
            status = 'QUARANTINED',
            quarantine_reason = reason,
            quarantined_at = recorded_at,
            quarantine_event_id = requested_correlation_id,
            updated_at = recorded_at
        WHERE head.source_reference_id = requested_source_reference_id;
      END IF;

      RETURN QUERY
      SELECT decision, checkpoint.*
      FROM read_aave_v3_ethereum_finalized_checkpoint(requested_source_reference_id) AS checkpoint;
      IF NOT FOUND THEN
        RETURN QUERY SELECT decision, NULL::smallint, NULL::text, NULL::text, NULL::text,
          NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::numeric,
          NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text, NULL::text,
          NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
          NULL::text, NULL::timestamptz;
      END IF;
    END;
    `;

const RECOVERY_BODY = `
    DECLARE
      recorded_at timestamptz := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      current_head aave_v3_ethereum_finalized_checkpoint_heads%ROWTYPE;
      current_good aave_v3_ethereum_finalized_checkpoint_events%ROWTYPE;
      prior_recovery aave_v3_ethereum_finalized_checkpoint_recovery_events%ROWTYPE;
      lineage_entry jsonb;
      entry_key_count integer;
      entry_sequence integer;
      entry_block_number numeric;
      entry_block_hash text;
      entry_parent_hash text;
      entry_state_root text;
      entry_block_timestamp timestamptz;
      entry_content_fingerprint text;
      entry_primary_observation_id text;
      entry_primary_evidence_fingerprint text;
      entry_primary_observed_at timestamptz;
      entry_corroborating_observation_id text;
      entry_corroborating_evidence_fingerprint text;
      entry_corroborating_observed_at timestamptz;
      prior_block_number numeric;
      prior_block_hash text;
      prior_block_timestamp timestamptz;
      final_primary_observation_id text;
      final_primary_evidence_fingerprint text;
      final_primary_observed_at timestamptz;
      final_corroborating_observed_at timestamptz;
      final_content_fingerprint text;
      lineage_length integer;
      resulting_revision bigint;
      decision text;
    BEGIN
      IF requested_recovery_id IS NULL
        OR substring(requested_recovery_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_recovery_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_authorization_nonce IS NULL
        OR substring(requested_authorization_nonce::text FROM 15 FOR 1) <> '4'
        OR substring(requested_authorization_nonce::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_command_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_authorization_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_source_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_corroborating_source_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_source_reference_id = requested_corroborating_source_reference_id
        OR requested_authorized_by_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_source_pair_independence_approval_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_operation IS NULL
        OR requested_expected_status IS NULL
        OR requested_expected_revision IS NULL
        OR requested_expected_last_validated_at IS NULL
        OR requested_expected_revision < 1
        OR NOT (
          (
            requested_operation = 'CONTINUITY_BACKFILL'
            AND requested_expected_status = 'ACTIVE'
            AND requested_expected_quarantine_reason IS NULL
            AND requested_expected_quarantined_at IS NULL
          ) OR (
            requested_operation = 'QUARANTINE_RECOVERY'
            AND requested_expected_status = 'QUARANTINED'
            AND requested_expected_revision >= 2
            AND requested_expected_quarantine_reason IN (
              'FINALIZED_HEIGHT_REGRESSION', 'FINALIZED_BLOCK_DIVERGENCE',
              'FINALIZED_PARENT_MISMATCH', 'FINALIZED_TIMESTAMP_REGRESSION',
              'SAME_BLOCK_EVIDENCE_DIVERGENCE'
            )
            AND requested_expected_quarantined_at IS NOT NULL
          )
        )
        OR requested_expected_last_good_block_number < 1
        OR requested_expected_last_good_block_number > 18446744073709551615
        OR requested_expected_last_good_block_number <> trunc(requested_expected_last_good_block_number)
        OR requested_expected_last_good_block_hash !~ '^0x[0-9a-f]{64}$'
        OR requested_expected_last_good_parent_hash !~ '^0x[0-9a-f]{64}$'
        OR requested_expected_last_good_state_root !~ '^0x[0-9a-f]{64}$'
        OR requested_expected_last_good_block_hash = '0x' || repeat('0', 64)
        OR requested_expected_last_good_parent_hash = '0x' || repeat('0', 64)
        OR requested_expected_last_good_state_root = '0x' || repeat('0', 64)
        OR requested_expected_last_good_content_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_target_block_number <= requested_expected_last_good_block_number
        OR requested_target_block_number > 18446744073709551615
        OR requested_target_block_number <> trunc(requested_target_block_number)
        OR requested_target_block_hash !~ '^0x[0-9a-f]{64}$'
        OR requested_target_parent_hash !~ '^0x[0-9a-f]{64}$'
        OR requested_target_state_root !~ '^0x[0-9a-f]{64}$'
        OR requested_target_block_hash = '0x' || repeat('0', 64)
        OR requested_target_parent_hash = '0x' || repeat('0', 64)
        OR requested_target_state_root = '0x' || repeat('0', 64)
        OR requested_target_block_hash = requested_target_parent_hash
        OR requested_expected_last_good_block_hash = requested_expected_last_good_parent_hash
        OR requested_expected_last_good_block_timestamp > requested_expected_last_validated_at
        OR requested_expected_last_validated_at > requested_issued_at
        OR (
          requested_expected_quarantined_at IS NOT NULL
          AND requested_expected_quarantined_at > requested_issued_at
        )
        OR requested_issued_at > requested_evaluated_at
        OR requested_evaluated_at >= requested_expires_at
        OR requested_expires_at <= requested_issued_at
        OR requested_expires_at - requested_issued_at > interval '15 minutes'
        OR requested_evaluated_at > recorded_at + interval '30 seconds'
        OR requested_target_block_number - requested_expected_last_good_block_number > 64
        OR pg_catalog.jsonb_typeof(requested_lineage) <> 'array'
      THEN
        RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery command'
          USING ERRCODE = '22023';
      END IF;

      lineage_length := pg_catalog.jsonb_array_length(requested_lineage);
      IF lineage_length < 1
        OR lineage_length > 64
        OR requested_target_block_number - requested_expected_last_good_block_number <> lineage_length
      THEN
        RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery lineage bound'
          USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_recovery_id::text, 57003)
      );
      SELECT recovery.* INTO prior_recovery
      FROM aave_v3_ethereum_finalized_checkpoint_recovery_events AS recovery
      WHERE recovery.recovery_id = requested_recovery_id;
      IF FOUND THEN
        IF prior_recovery.command_fingerprint_sha256 <> requested_command_fingerprint THEN
          RAISE EXCEPTION 'Aave finalized checkpoint recovery idempotency conflict'
            USING ERRCODE = 'A1702';
        END IF;
        decision := 'IDEMPOTENT_REPLAY';
        RETURN QUERY
        SELECT decision, checkpoint.*
        FROM read_aave_v3_ethereum_finalized_checkpoint(requested_source_reference_id) AS checkpoint;
        IF NOT FOUND THEN
          RETURN QUERY SELECT decision, NULL::smallint, NULL::text, NULL::text, NULL::text,
            NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::numeric,
            NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text, NULL::text,
            NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
            NULL::text, NULL::timestamptz;
        END IF;
        RETURN;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM aave_v3_ethereum_finalized_checkpoint_recovery_events AS recovery
        WHERE recovery.authorization_nonce = requested_authorization_nonce
          OR recovery.authorization_fingerprint_sha256 = requested_authorization_fingerprint
      ) THEN
        RAISE EXCEPTION 'Aave finalized checkpoint recovery authorization replay'
          USING ERRCODE = 'A1703';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_source_reference_id, 57002)
      );
      SELECT head.* INTO current_head
      FROM aave_v3_ethereum_finalized_checkpoint_heads AS head
      WHERE head.source_reference_id = requested_source_reference_id
      FOR UPDATE;
      IF NOT FOUND THEN
        decision := 'CHECKPOINT_NOT_FOUND';
        RETURN QUERY SELECT decision, NULL::smallint, NULL::text, NULL::text, NULL::text,
          NULL::text, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::numeric,
          NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text, NULL::text,
          NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
          NULL::text, NULL::timestamptz;
        RETURN;
      END IF;

      -- Re-read the database clock after the per-source lock. An authorization
      -- that expires while queued behind another writer must never mutate the
      -- checkpoint using the function-entry timestamp.
      recorded_at := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      IF recorded_at < requested_issued_at OR recorded_at >= requested_expires_at THEN
        decision := 'AUTHORIZATION_EXPIRED';
      ELSIF current_head.revision <> requested_expected_revision THEN
        decision := 'REVISION_CONFLICT';
      ELSIF current_head.status <> requested_expected_status THEN
        decision := 'CHECKPOINT_STATUS_MISMATCH';
      END IF;
      IF decision IS NOT NULL THEN
        RETURN QUERY
        SELECT decision, checkpoint.*
        FROM read_aave_v3_ethereum_finalized_checkpoint(requested_source_reference_id) AS checkpoint;
        RETURN;
      END IF;

      SELECT event.* INTO STRICT current_good
      FROM aave_v3_ethereum_finalized_checkpoint_events AS event
      WHERE event.event_id = current_head.last_good_event_id;
      IF current_head.quarantine_reason IS DISTINCT FROM requested_expected_quarantine_reason
        OR pg_catalog.date_trunc('milliseconds', current_head.quarantined_at) IS DISTINCT FROM
          requested_expected_quarantined_at
        OR pg_catalog.date_trunc('milliseconds', current_head.last_validated_at) <>
          requested_expected_last_validated_at
        OR current_good.block_number <> requested_expected_last_good_block_number
        OR current_good.block_hash <> requested_expected_last_good_block_hash
        OR current_good.parent_hash <> requested_expected_last_good_parent_hash
        OR current_good.state_root <> requested_expected_last_good_state_root
        OR current_good.block_timestamp <> requested_expected_last_good_block_timestamp
        OR current_good.content_fingerprint_sha256 <> requested_expected_last_good_content_fingerprint
      THEN
        decision := 'HEAD_BINDING_MISMATCH';
        RETURN QUERY
        SELECT decision, checkpoint.*
        FROM read_aave_v3_ethereum_finalized_checkpoint(requested_source_reference_id) AS checkpoint;
        RETURN;
      END IF;

      prior_block_number := requested_expected_last_good_block_number;
      prior_block_hash := requested_expected_last_good_block_hash;
      prior_block_timestamp := requested_expected_last_good_block_timestamp;
      FOR lineage_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(requested_lineage)
      LOOP
        IF pg_catalog.jsonb_typeof(lineage_entry) <> 'object' THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery lineage entry'
            USING ERRCODE = '22023';
        END IF;
        SELECT pg_catalog.count(*) INTO entry_key_count
        FROM pg_catalog.jsonb_object_keys(lineage_entry);
        IF entry_key_count <> 13 OR NOT (lineage_entry ?& ARRAY[
          'sequence', 'blockNumber', 'blockHash', 'parentHash', 'stateRoot',
          'blockTimestamp', 'contentFingerprintSha256', 'primarySourceObservationId',
          'primaryEvidenceFingerprintSha256', 'primaryObservedAt',
          'corroboratingSourceObservationId', 'corroboratingEvidenceFingerprintSha256',
          'corroboratingObservedAt'
        ]) THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery lineage shape'
            USING ERRCODE = '22023';
        END IF;
        IF pg_catalog.jsonb_typeof(lineage_entry -> 'sequence') <> 'number'
          OR (lineage_entry ->> 'sequence') !~ '^[1-9][0-9]{0,2}$'
          OR (lineage_entry ->> 'blockNumber') IS NULL
          OR (lineage_entry ->> 'blockNumber') !~ '^[1-9][0-9]{0,19}$'
          OR (lineage_entry ->> 'blockHash') IS NULL
          OR (lineage_entry ->> 'blockHash') !~ '^0x[0-9a-f]{64}$'
          OR (lineage_entry ->> 'parentHash') IS NULL
          OR (lineage_entry ->> 'parentHash') !~ '^0x[0-9a-f]{64}$'
          OR (lineage_entry ->> 'stateRoot') IS NULL
          OR (lineage_entry ->> 'stateRoot') !~ '^0x[0-9a-f]{64}$'
          OR (lineage_entry ->> 'blockHash') = '0x' || repeat('0', 64)
          OR (lineage_entry ->> 'parentHash') = '0x' || repeat('0', 64)
          OR (lineage_entry ->> 'stateRoot') = '0x' || repeat('0', 64)
          OR (lineage_entry ->> 'contentFingerprintSha256') IS NULL
          OR (lineage_entry ->> 'contentFingerprintSha256') !~ '^[0-9a-f]{64}$'
          OR (lineage_entry ->> 'primarySourceObservationId') IS NULL
          OR (lineage_entry ->> 'primarySourceObservationId') !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
          OR (lineage_entry ->> 'primaryEvidenceFingerprintSha256') IS NULL
          OR (lineage_entry ->> 'primaryEvidenceFingerprintSha256') !~ '^[0-9a-f]{64}$'
          OR (lineage_entry ->> 'corroboratingSourceObservationId') IS NULL
          OR (lineage_entry ->> 'corroboratingSourceObservationId') !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
          OR (lineage_entry ->> 'corroboratingEvidenceFingerprintSha256') IS NULL
          OR (lineage_entry ->> 'corroboratingEvidenceFingerprintSha256') !~ '^[0-9a-f]{64}$'
        THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery lineage value'
            USING ERRCODE = '22023';
        END IF;

        entry_sequence := (lineage_entry ->> 'sequence')::integer;
        entry_block_number := (lineage_entry ->> 'blockNumber')::numeric;
        entry_block_hash := lineage_entry ->> 'blockHash';
        entry_parent_hash := lineage_entry ->> 'parentHash';
        entry_state_root := lineage_entry ->> 'stateRoot';
        entry_block_timestamp := (lineage_entry ->> 'blockTimestamp')::timestamptz;
        entry_content_fingerprint := lineage_entry ->> 'contentFingerprintSha256';
        entry_primary_observation_id := lineage_entry ->> 'primarySourceObservationId';
        entry_primary_evidence_fingerprint := lineage_entry ->> 'primaryEvidenceFingerprintSha256';
        entry_primary_observed_at := (lineage_entry ->> 'primaryObservedAt')::timestamptz;
        entry_corroborating_observation_id := lineage_entry ->> 'corroboratingSourceObservationId';
        entry_corroborating_evidence_fingerprint :=
          lineage_entry ->> 'corroboratingEvidenceFingerprintSha256';
        entry_corroborating_observed_at :=
          (lineage_entry ->> 'corroboratingObservedAt')::timestamptz;

        IF entry_sequence <> entry_block_number - requested_expected_last_good_block_number
          OR entry_sequence > lineage_length
          OR entry_block_number <> prior_block_number + 1
          OR entry_parent_hash <> prior_block_hash
          OR entry_block_hash = entry_parent_hash
          OR entry_block_timestamp <= prior_block_timestamp
          OR entry_block_timestamp > entry_primary_observed_at
          OR entry_block_timestamp > entry_corroborating_observed_at
          OR entry_primary_observed_at < requested_issued_at
          OR entry_corroborating_observed_at < requested_issued_at
          OR entry_primary_observed_at > requested_evaluated_at
          OR entry_corroborating_observed_at > requested_evaluated_at
          OR entry_primary_evidence_fingerprint = entry_corroborating_evidence_fingerprint
          OR entry_primary_observation_id = entry_corroborating_observation_id
        THEN
          RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery continuity'
            USING ERRCODE = '22023';
        END IF;
        prior_block_number := entry_block_number;
        prior_block_hash := entry_block_hash;
        prior_block_timestamp := entry_block_timestamp;
        final_primary_observation_id := entry_primary_observation_id;
        final_primary_evidence_fingerprint := entry_primary_evidence_fingerprint;
        final_primary_observed_at := entry_primary_observed_at;
        final_corroborating_observed_at := entry_corroborating_observed_at;
        final_content_fingerprint := entry_content_fingerprint;
      END LOOP;

      IF prior_block_number <> requested_target_block_number
        OR prior_block_hash <> requested_target_block_hash
        OR entry_parent_hash <> requested_target_parent_hash
        OR entry_state_root <> requested_target_state_root
        OR prior_block_timestamp <> requested_target_block_timestamp
      THEN
        RAISE EXCEPTION 'invalid Aave finalized checkpoint recovery target'
          USING ERRCODE = '22023';
      END IF;

      -- The bounded verifier is deliberately small, but expiry is checked at
      -- the mutation boundary as well so execution can never outlive the
      -- narrowly issued capability.
      recorded_at := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      IF recorded_at < requested_issued_at OR recorded_at >= requested_expires_at THEN
        decision := 'AUTHORIZATION_EXPIRED';
        RETURN QUERY
        SELECT decision, checkpoint.*
        FROM read_aave_v3_ethereum_finalized_checkpoint(requested_source_reference_id) AS checkpoint;
        RETURN;
      END IF;

      resulting_revision := current_head.revision + 1;
      decision := CASE requested_operation
        WHEN 'CONTINUITY_BACKFILL' THEN 'BACKFILLED'
        ELSE 'RECOVERED'
      END;
      INSERT INTO aave_v3_ethereum_finalized_checkpoint_events (
        event_id, source_reference_id, command_fingerprint_sha256,
        expected_revision, resulting_revision, outcome, reason_code,
        source_observation_id, evidence_fingerprint_sha256,
        content_fingerprint_sha256, block_number, block_hash, parent_hash,
        state_root, block_timestamp, observed_at, recorded_at
      ) VALUES (
        requested_recovery_id, requested_source_reference_id,
        requested_command_fingerprint, requested_expected_revision,
        resulting_revision, decision,
        CASE requested_operation
          WHEN 'CONTINUITY_BACKFILL' THEN 'AUTHORIZED_CONTIGUOUS_BACKFILL'
          ELSE 'AUTHORIZED_CONTIGUOUS_LINEAGE'
        END,
        final_primary_observation_id, final_primary_evidence_fingerprint,
        final_content_fingerprint, requested_target_block_number,
        requested_target_block_hash, requested_target_parent_hash,
        requested_target_state_root, requested_target_block_timestamp,
        final_primary_observed_at, recorded_at
      );

      INSERT INTO aave_v3_ethereum_finalized_checkpoint_recovery_events (
        recovery_id, source_reference_id, corroborating_source_reference_id,
        authorization_nonce, authorization_fingerprint_sha256,
        command_fingerprint_sha256, authorized_by_reference_id,
        source_pair_independence_approval_id, operation, expected_revision,
        resulting_revision, expected_status, expected_quarantine_reason,
        expected_quarantined_at, expected_last_validated_at,
        expected_last_good_event_id, expected_last_good_block_number,
        expected_last_good_block_hash, expected_last_good_parent_hash,
        expected_last_good_state_root, expected_last_good_block_timestamp,
        expected_last_good_content_fingerprint_sha256,
        recovered_checkpoint_event_id, target_block_number, target_block_hash,
        target_parent_hash, target_state_root, target_block_timestamp,
        lineage_length, issued_at, expires_at, evaluated_at, recorded_at
      ) VALUES (
        requested_recovery_id, requested_source_reference_id,
        requested_corroborating_source_reference_id, requested_authorization_nonce,
        requested_authorization_fingerprint, requested_command_fingerprint,
        requested_authorized_by_reference_id,
        requested_source_pair_independence_approval_id,
        requested_operation, requested_expected_revision, resulting_revision,
        requested_expected_status, requested_expected_quarantine_reason,
        requested_expected_quarantined_at, requested_expected_last_validated_at,
        current_head.last_good_event_id, requested_expected_last_good_block_number,
        requested_expected_last_good_block_hash,
        requested_expected_last_good_parent_hash,
        requested_expected_last_good_state_root,
        requested_expected_last_good_block_timestamp,
        requested_expected_last_good_content_fingerprint, requested_recovery_id,
        requested_target_block_number, requested_target_block_hash,
        requested_target_parent_hash, requested_target_state_root,
        requested_target_block_timestamp, lineage_length, requested_issued_at,
        requested_expires_at, requested_evaluated_at, recorded_at
      );

      FOR lineage_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(requested_lineage)
      LOOP
        entry_sequence := (lineage_entry ->> 'sequence')::integer;
        INSERT INTO aave_v3_ethereum_finalized_checkpoint_recovery_lineage (
          recovery_id, sequence_number, block_number, block_hash, parent_hash,
          state_root, block_timestamp, content_fingerprint_sha256
        ) VALUES (
          requested_recovery_id, entry_sequence,
          (lineage_entry ->> 'blockNumber')::numeric,
          lineage_entry ->> 'blockHash', lineage_entry ->> 'parentHash',
          lineage_entry ->> 'stateRoot',
          (lineage_entry ->> 'blockTimestamp')::timestamptz,
          lineage_entry ->> 'contentFingerprintSha256'
        );
        INSERT INTO aave_v3_ethereum_finalized_checkpoint_recovery_sources (
          recovery_id, sequence_number, source_role, source_reference_id,
          source_observation_id, evidence_fingerprint_sha256, observed_at
        ) VALUES
          (
            requested_recovery_id, entry_sequence, 'PRIMARY',
            requested_source_reference_id,
            lineage_entry ->> 'primarySourceObservationId',
            lineage_entry ->> 'primaryEvidenceFingerprintSha256',
            (lineage_entry ->> 'primaryObservedAt')::timestamptz
          ),
          (
            requested_recovery_id, entry_sequence, 'CORROBORATING',
            requested_corroborating_source_reference_id,
            lineage_entry ->> 'corroboratingSourceObservationId',
            lineage_entry ->> 'corroboratingEvidenceFingerprintSha256',
            (lineage_entry ->> 'corroboratingObservedAt')::timestamptz
          );
      END LOOP;

      UPDATE aave_v3_ethereum_finalized_checkpoint_heads AS head
      SET revision = resulting_revision,
          status = 'ACTIVE',
          last_good_event_id = requested_recovery_id,
          finalized_advanced_at = GREATEST(
            final_primary_observed_at, final_corroborating_observed_at
          ),
          last_validated_at = GREATEST(
            final_primary_observed_at, final_corroborating_observed_at
          ),
          quarantine_reason = NULL,
          quarantined_at = NULL,
          quarantine_event_id = NULL,
          updated_at = recorded_at
      WHERE head.source_reference_id = requested_source_reference_id;

      RETURN QUERY
      SELECT decision, checkpoint.*
      FROM read_aave_v3_ethereum_finalized_checkpoint(requested_source_reference_id) AS checkpoint;
    END;
    `;

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value))
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`);
  return `"${value}"`;
}

function literal(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value))
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  return `'${value}'`;
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0017 verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
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

function extendPriorVerifier(names: DatabasePrincipalNames, prior: string): string {
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const oldAllowance = `${functionAllowance(api, PRIOR_API_FUNCTIONS)}
${functionAllowance(worker, PRIOR_WORKER_FUNCTIONS)}`;
  const newAllowance = `${functionAllowance(api, [...PRIOR_API_FUNCTIONS, READ_FUNCTION_IDENTITY])}
${functionAllowance(worker, [
  ...PRIOR_WORKER_FUNCTIONS,
  READ_FUNCTION_IDENTITY,
  RECORD_FUNCTION_IDENTITY,
  RECOVER_FUNCTION_IDENTITY,
])}`;
  return replaceExactlyOnce(prior, oldAllowance, newAllowance);
}

function resultColumns(): string {
  return `
      checkpoint_schema_version smallint,
      checkpoint_deployment_id text,
      checkpoint_network_id text,
      checkpoint_source_reference_id text,
      checkpoint_manifest_fingerprint text,
      checkpoint_registry_fingerprint text,
      checkpoint_read_plan_fingerprint text,
      checkpoint_revision bigint,
      checkpoint_status text,
      checkpoint_block_number numeric,
      checkpoint_block_hash text,
      checkpoint_parent_hash text,
      checkpoint_state_root text,
      checkpoint_block_timestamp timestamptz,
      checkpoint_source_observation_id text,
      checkpoint_evidence_fingerprint text,
      checkpoint_content_fingerprint text,
      checkpoint_observed_at timestamptz,
      checkpoint_finalized_advanced_at timestamptz,
      checkpoint_last_validated_at timestamptz,
      checkpoint_quarantine_reason text,
      checkpoint_quarantined_at timestamptz`;
}

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  return `CREATE TABLE aave_v3_ethereum_finalized_checkpoint_events (
      event_id uuid PRIMARY KEY,
      source_reference_id text NOT NULL,
      deployment_manifest_fingerprint_sha256 text NOT NULL DEFAULT '${MANIFEST_FINGERPRINT}',
      asset_registry_fingerprint_sha256 text NOT NULL DEFAULT '${REGISTRY_FINGERPRINT}',
      read_plan_fingerprint_sha256 text NOT NULL DEFAULT '${READ_PLAN_FINGERPRINT}',
      command_fingerprint_sha256 text NOT NULL,
      expected_revision bigint,
      resulting_revision bigint,
      outcome text NOT NULL,
      reason_code text NOT NULL,
      source_observation_id text NOT NULL,
      evidence_fingerprint_sha256 text NOT NULL,
      content_fingerprint_sha256 text NOT NULL,
      block_number numeric(20,0) NOT NULL,
      block_hash text NOT NULL,
      parent_hash text NOT NULL,
      state_root text NOT NULL,
      block_timestamp timestamptz NOT NULL,
      observed_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT aave_checkpoint_event_manifest_check CHECK (
        deployment_manifest_fingerprint_sha256 = '${MANIFEST_FINGERPRINT}'
      ),
      CONSTRAINT aave_checkpoint_event_registry_check CHECK (
        asset_registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
      ),
      CONSTRAINT aave_checkpoint_event_plan_check CHECK (
        read_plan_fingerprint_sha256 = '${READ_PLAN_FINGERPRINT}'
      ),
      CONSTRAINT aave_checkpoint_event_source_check CHECK (
        source_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND source_observation_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
      ),
      CONSTRAINT aave_checkpoint_event_digest_check CHECK (
        command_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND content_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT aave_checkpoint_event_block_check CHECK (
        block_number BETWEEN 1 AND 18446744073709551615
        AND block_hash ~ '^0x[0-9a-f]{64}$'
        AND parent_hash ~ '^0x[0-9a-f]{64}$'
        AND state_root ~ '^0x[0-9a-f]{64}$'
        AND block_hash <> '0x' || repeat('0', 64)
        AND parent_hash <> '0x' || repeat('0', 64)
        AND state_root <> '0x' || repeat('0', 64)
        AND block_hash <> parent_hash
        AND block_timestamp <= observed_at
        AND observed_at <= recorded_at + interval '30 seconds'
      ),
      CONSTRAINT aave_checkpoint_event_outcome_check CHECK (
        outcome IN (
          'CREATED', 'ADVANCED', 'REOBSERVED', 'CONTINUITY_REQUIRED',
          'QUARANTINED', 'ALREADY_QUARANTINED',
          'OBSERVATION_TIME_REGRESSION', 'REVISION_CONFLICT',
          'BACKFILLED', 'RECOVERED'
        )
      ),
      CONSTRAINT aave_checkpoint_event_revision_check CHECK (
        (outcome = 'CREATED' AND expected_revision IS NULL AND resulting_revision = 1)
        OR (outcome IN ('ADVANCED', 'REOBSERVED', 'QUARANTINED', 'BACKFILLED', 'RECOVERED')
          AND expected_revision IS NOT NULL
          AND resulting_revision = expected_revision + 1)
        OR (outcome NOT IN (
          'CREATED', 'ADVANCED', 'REOBSERVED', 'QUARANTINED', 'BACKFILLED', 'RECOVERED'
        )
          AND resulting_revision IS NULL)
      ),
      CONSTRAINT aave_checkpoint_event_reason_check CHECK (
        (outcome IN ('CREATED', 'ADVANCED', 'REOBSERVED') AND reason_code = 'NONE')
        OR (outcome = 'BACKFILLED' AND reason_code = 'AUTHORIZED_CONTIGUOUS_BACKFILL')
        OR (outcome = 'RECOVERED' AND reason_code = 'AUTHORIZED_CONTIGUOUS_LINEAGE')
        OR (outcome = 'QUARANTINED' AND reason_code IN (
          'FINALIZED_HEIGHT_REGRESSION', 'FINALIZED_BLOCK_DIVERGENCE',
          'FINALIZED_PARENT_MISMATCH', 'FINALIZED_TIMESTAMP_REGRESSION',
          'SAME_BLOCK_EVIDENCE_DIVERGENCE'
        ))
        OR (outcome = 'CONTINUITY_REQUIRED' AND reason_code = 'FINALIZED_HEIGHT_GAP')
        OR (outcome = 'ALREADY_QUARANTINED' AND reason_code = 'CHECKPOINT_QUARANTINED')
        OR (outcome = 'OBSERVATION_TIME_REGRESSION' AND reason_code = 'OBSERVATION_TIME_REGRESSION')
        OR (outcome = 'REVISION_CONFLICT' AND reason_code = 'EXPECTED_REVISION_MISMATCH')
      ),
      CONSTRAINT aave_checkpoint_event_source_revision_unique
        UNIQUE (source_reference_id, resulting_revision),
      CONSTRAINT aave_checkpoint_event_source_identity_unique
        UNIQUE (source_reference_id, event_id)
    );

    CREATE TABLE aave_v3_ethereum_finalized_checkpoint_heads (
      source_reference_id text PRIMARY KEY,
      deployment_manifest_fingerprint_sha256 text NOT NULL DEFAULT '${MANIFEST_FINGERPRINT}',
      asset_registry_fingerprint_sha256 text NOT NULL DEFAULT '${REGISTRY_FINGERPRINT}',
      read_plan_fingerprint_sha256 text NOT NULL DEFAULT '${READ_PLAN_FINGERPRINT}',
      revision bigint NOT NULL CHECK (revision >= 1),
      status text NOT NULL CHECK (status IN ('ACTIVE', 'QUARANTINED')),
      last_good_event_id uuid NOT NULL,
      finalized_advanced_at timestamptz NOT NULL,
      last_validated_at timestamptz NOT NULL,
      quarantine_reason text,
      quarantined_at timestamptz,
      quarantine_event_id uuid,
      updated_at timestamptz NOT NULL,
      CONSTRAINT aave_checkpoint_head_manifest_check CHECK (
        deployment_manifest_fingerprint_sha256 = '${MANIFEST_FINGERPRINT}'
      ),
      CONSTRAINT aave_checkpoint_head_registry_check CHECK (
        asset_registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
      ),
      CONSTRAINT aave_checkpoint_head_plan_check CHECK (
        read_plan_fingerprint_sha256 = '${READ_PLAN_FINGERPRINT}'
      ),
      CONSTRAINT aave_checkpoint_head_source_check CHECK (
        source_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
      ),
      CONSTRAINT aave_checkpoint_head_time_check CHECK (
        finalized_advanced_at <= last_validated_at AND last_validated_at <= updated_at + interval '30 seconds'
      ),
      CONSTRAINT aave_checkpoint_head_quarantine_check CHECK (
        (status = 'ACTIVE' AND quarantine_reason IS NULL AND quarantined_at IS NULL AND quarantine_event_id IS NULL)
        OR (status = 'QUARANTINED' AND quarantine_reason IS NOT NULL AND quarantined_at IS NOT NULL AND quarantine_event_id IS NOT NULL)
      ),
      CONSTRAINT aave_checkpoint_head_last_good_fk FOREIGN KEY (
        source_reference_id, last_good_event_id
      ) REFERENCES aave_v3_ethereum_finalized_checkpoint_events(source_reference_id, event_id),
      CONSTRAINT aave_checkpoint_head_quarantine_event_fk FOREIGN KEY (
        source_reference_id, quarantine_event_id
      ) REFERENCES aave_v3_ethereum_finalized_checkpoint_events(source_reference_id, event_id)
    );

    CREATE TABLE aave_v3_ethereum_finalized_checkpoint_recovery_events (
      recovery_id uuid PRIMARY KEY,
      source_reference_id text NOT NULL,
      corroborating_source_reference_id text NOT NULL,
      authorization_nonce uuid NOT NULL UNIQUE,
      authorization_fingerprint_sha256 text NOT NULL UNIQUE,
      command_fingerprint_sha256 text NOT NULL,
      authorized_by_reference_id text NOT NULL,
      source_pair_independence_approval_id text NOT NULL,
      operation text NOT NULL,
      expected_revision bigint NOT NULL,
      resulting_revision bigint NOT NULL,
      expected_status text NOT NULL,
      expected_quarantine_reason text,
      expected_quarantined_at timestamptz,
      expected_last_validated_at timestamptz NOT NULL,
      expected_last_good_event_id uuid NOT NULL,
      expected_last_good_block_number numeric(20,0) NOT NULL,
      expected_last_good_block_hash text NOT NULL,
      expected_last_good_parent_hash text NOT NULL,
      expected_last_good_state_root text NOT NULL,
      expected_last_good_block_timestamp timestamptz NOT NULL,
      expected_last_good_content_fingerprint_sha256 text NOT NULL,
      recovered_checkpoint_event_id uuid NOT NULL,
      target_block_number numeric(20,0) NOT NULL,
      target_block_hash text NOT NULL,
      target_parent_hash text NOT NULL,
      target_state_root text NOT NULL,
      target_block_timestamp timestamptz NOT NULL,
      lineage_length smallint NOT NULL,
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      evaluated_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT aave_checkpoint_recovery_source_check CHECK (
        source_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND corroborating_source_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND source_reference_id <> corroborating_source_reference_id
        AND authorized_by_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND source_pair_independence_approval_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
      ),
      CONSTRAINT aave_checkpoint_recovery_digest_check CHECK (
        authorization_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND command_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND expected_last_good_content_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT aave_checkpoint_recovery_revision_check CHECK (
        expected_revision >= 1 AND resulting_revision = expected_revision + 1
      ),
      CONSTRAINT aave_checkpoint_recovery_reason_check CHECK (
        (
          operation = 'CONTINUITY_BACKFILL'
          AND expected_status = 'ACTIVE'
          AND expected_quarantine_reason IS NULL
          AND expected_quarantined_at IS NULL
        ) OR (
          operation = 'QUARANTINE_RECOVERY'
          AND expected_status = 'QUARANTINED'
          AND expected_revision >= 2
          AND expected_quarantine_reason IN (
            'FINALIZED_HEIGHT_REGRESSION', 'FINALIZED_BLOCK_DIVERGENCE',
            'FINALIZED_PARENT_MISMATCH', 'FINALIZED_TIMESTAMP_REGRESSION',
            'SAME_BLOCK_EVIDENCE_DIVERGENCE'
          )
          AND expected_quarantined_at IS NOT NULL
        )
      ),
      CONSTRAINT aave_checkpoint_recovery_block_check CHECK (
        expected_last_good_block_number BETWEEN 1 AND 18446744073709551615
        AND target_block_number BETWEEN 1 AND 18446744073709551615
        AND target_block_number > expected_last_good_block_number
        AND target_block_number - expected_last_good_block_number = lineage_length
        AND lineage_length BETWEEN 1 AND 64
        AND expected_last_good_block_hash ~ '^0x[0-9a-f]{64}$'
        AND expected_last_good_parent_hash ~ '^0x[0-9a-f]{64}$'
        AND expected_last_good_state_root ~ '^0x[0-9a-f]{64}$'
        AND target_block_hash ~ '^0x[0-9a-f]{64}$'
        AND target_parent_hash ~ '^0x[0-9a-f]{64}$'
        AND target_state_root ~ '^0x[0-9a-f]{64}$'
        AND expected_last_good_block_hash <> '0x' || repeat('0', 64)
        AND expected_last_good_parent_hash <> '0x' || repeat('0', 64)
        AND expected_last_good_state_root <> '0x' || repeat('0', 64)
        AND target_block_hash <> '0x' || repeat('0', 64)
        AND target_parent_hash <> '0x' || repeat('0', 64)
        AND target_state_root <> '0x' || repeat('0', 64)
        AND expected_last_good_block_hash <> expected_last_good_parent_hash
        AND target_block_hash <> target_parent_hash
        AND expected_last_good_block_timestamp < target_block_timestamp
      ),
      CONSTRAINT aave_checkpoint_recovery_time_check CHECK (
        expected_last_good_block_timestamp <= expected_last_validated_at
        AND expected_last_validated_at <= issued_at
        AND (expected_quarantined_at IS NULL OR expected_quarantined_at <= issued_at)
        AND issued_at <= evaluated_at
        AND evaluated_at < expires_at
        AND expires_at > issued_at
        AND expires_at - issued_at <= interval '15 minutes'
        AND recorded_at >= issued_at AND recorded_at < expires_at
        AND evaluated_at <= recorded_at + interval '30 seconds'
      ),
      CONSTRAINT aave_checkpoint_recovery_last_good_fk FOREIGN KEY (
        source_reference_id, expected_last_good_event_id
      ) REFERENCES aave_v3_ethereum_finalized_checkpoint_events(source_reference_id, event_id),
      CONSTRAINT aave_checkpoint_recovery_result_fk FOREIGN KEY (
        source_reference_id, recovered_checkpoint_event_id
      ) REFERENCES aave_v3_ethereum_finalized_checkpoint_events(source_reference_id, event_id),
      CONSTRAINT aave_checkpoint_recovery_result_unique
        UNIQUE (source_reference_id, resulting_revision),
      CONSTRAINT aave_checkpoint_recovery_result_event_unique
        UNIQUE (source_reference_id, recovered_checkpoint_event_id)
    );

    CREATE TABLE aave_v3_ethereum_finalized_checkpoint_recovery_lineage (
      recovery_id uuid NOT NULL,
      sequence_number smallint NOT NULL,
      block_number numeric(20,0) NOT NULL,
      block_hash text NOT NULL,
      parent_hash text NOT NULL,
      state_root text NOT NULL,
      block_timestamp timestamptz NOT NULL,
      content_fingerprint_sha256 text NOT NULL,
      CONSTRAINT aave_checkpoint_recovery_lineage_pk
        PRIMARY KEY (recovery_id, sequence_number),
      CONSTRAINT aave_checkpoint_recovery_lineage_recovery_fk
        FOREIGN KEY (recovery_id)
        REFERENCES aave_v3_ethereum_finalized_checkpoint_recovery_events(recovery_id),
      CONSTRAINT aave_checkpoint_recovery_lineage_sequence_check CHECK (
        sequence_number BETWEEN 1 AND 64
      ),
      CONSTRAINT aave_checkpoint_recovery_lineage_block_check CHECK (
        block_number BETWEEN 1 AND 18446744073709551615
        AND block_hash ~ '^0x[0-9a-f]{64}$'
        AND parent_hash ~ '^0x[0-9a-f]{64}$'
        AND state_root ~ '^0x[0-9a-f]{64}$'
        AND block_hash <> '0x' || repeat('0', 64)
        AND parent_hash <> '0x' || repeat('0', 64)
        AND state_root <> '0x' || repeat('0', 64)
        AND block_hash <> parent_hash
        AND content_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      )
    );

    CREATE TABLE aave_v3_ethereum_finalized_checkpoint_recovery_sources (
      recovery_id uuid NOT NULL,
      sequence_number smallint NOT NULL,
      source_role text NOT NULL CHECK (source_role IN ('PRIMARY', 'CORROBORATING')),
      source_reference_id text NOT NULL,
      source_observation_id text NOT NULL,
      evidence_fingerprint_sha256 text NOT NULL,
      observed_at timestamptz NOT NULL,
      CONSTRAINT aave_checkpoint_recovery_sources_pk
        PRIMARY KEY (recovery_id, sequence_number, source_role),
      CONSTRAINT aave_checkpoint_recovery_sources_lineage_fk
        FOREIGN KEY (recovery_id, sequence_number)
        REFERENCES aave_v3_ethereum_finalized_checkpoint_recovery_lineage(
          recovery_id, sequence_number
        ),
      CONSTRAINT aave_checkpoint_recovery_sources_reference_check CHECK (
        source_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND source_observation_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT aave_checkpoint_recovery_source_observation_unique
        UNIQUE (source_reference_id, source_observation_id),
      CONSTRAINT aave_checkpoint_recovery_evidence_unique
        UNIQUE (evidence_fingerprint_sha256)
    );

    CREATE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY}
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
    AS $function$${EVENT_GUARD_BODY}$function$;
    CREATE TRIGGER aave_checkpoint_events_append_only_row
      BEFORE UPDATE OR DELETE ON aave_v3_ethereum_finalized_checkpoint_events
      FOR EACH ROW EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER aave_checkpoint_events_append_only_truncate
      BEFORE TRUNCATE ON aave_v3_ethereum_finalized_checkpoint_events
      FOR EACH STATEMENT EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_events
      ENABLE ALWAYS TRIGGER aave_checkpoint_events_append_only_row;
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_events
      ENABLE ALWAYS TRIGGER aave_checkpoint_events_append_only_truncate;
    CREATE TRIGGER aave_checkpoint_recovery_events_append_only_row
      BEFORE UPDATE OR DELETE ON aave_v3_ethereum_finalized_checkpoint_recovery_events
      FOR EACH ROW EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER aave_checkpoint_recovery_events_append_only_truncate
      BEFORE TRUNCATE ON aave_v3_ethereum_finalized_checkpoint_recovery_events
      FOR EACH STATEMENT EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER aave_checkpoint_recovery_lineage_append_only_row
      BEFORE UPDATE OR DELETE ON aave_v3_ethereum_finalized_checkpoint_recovery_lineage
      FOR EACH ROW EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER aave_checkpoint_recovery_lineage_append_only_truncate
      BEFORE TRUNCATE ON aave_v3_ethereum_finalized_checkpoint_recovery_lineage
      FOR EACH STATEMENT EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER aave_checkpoint_recovery_sources_append_only_row
      BEFORE UPDATE OR DELETE ON aave_v3_ethereum_finalized_checkpoint_recovery_sources
      FOR EACH ROW EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER aave_checkpoint_recovery_sources_append_only_truncate
      BEFORE TRUNCATE ON aave_v3_ethereum_finalized_checkpoint_recovery_sources
      FOR EACH STATEMENT EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_recovery_events
      ENABLE ALWAYS TRIGGER aave_checkpoint_recovery_events_append_only_row;
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_recovery_events
      ENABLE ALWAYS TRIGGER aave_checkpoint_recovery_events_append_only_truncate;
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_recovery_lineage
      ENABLE ALWAYS TRIGGER aave_checkpoint_recovery_lineage_append_only_row;
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_recovery_lineage
      ENABLE ALWAYS TRIGGER aave_checkpoint_recovery_lineage_append_only_truncate;
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_recovery_sources
      ENABLE ALWAYS TRIGGER aave_checkpoint_recovery_sources_append_only_row;
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_recovery_sources
      ENABLE ALWAYS TRIGGER aave_checkpoint_recovery_sources_append_only_truncate;

    CREATE FUNCTION ${HEAD_GUARD_FUNCTION_IDENTITY}
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
    AS $function$${HEAD_GUARD_BODY}$function$;
    CREATE TRIGGER aave_checkpoint_head_transition
      BEFORE UPDATE ON aave_v3_ethereum_finalized_checkpoint_heads
      FOR EACH ROW EXECUTE FUNCTION ${HEAD_GUARD_FUNCTION_IDENTITY};
    ALTER TABLE aave_v3_ethereum_finalized_checkpoint_heads
      ENABLE ALWAYS TRIGGER aave_checkpoint_head_transition;

    CREATE FUNCTION read_aave_v3_ethereum_finalized_checkpoint(
      requested_source_reference_id text
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE sql SECURITY DEFINER STABLE PARALLEL UNSAFE
    AS $function$${READ_BODY}$function$;

    CREATE FUNCTION record_aave_v3_ethereum_finalized_checkpoint(
      requested_expected_revision bigint,
      requested_correlation_id uuid,
      requested_source_reference_id text,
      requested_source_observation_id text,
      requested_evidence_fingerprint text,
      requested_content_fingerprint text,
      requested_command_fingerprint text,
      requested_block_number numeric,
      requested_block_hash text,
      requested_parent_hash text,
      requested_state_root text,
      requested_block_timestamp timestamptz,
      requested_observed_at timestamptz
    ) RETURNS TABLE (record_outcome text, ${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${RECORD_BODY}$function$;

    CREATE FUNCTION recover_aave_v3_ethereum_finalized_checkpoint(
      requested_recovery_id uuid,
      requested_command_fingerprint text,
      requested_authorization_nonce uuid,
      requested_authorization_fingerprint text,
      requested_source_reference_id text,
      requested_corroborating_source_reference_id text,
      requested_authorized_by_reference_id text,
      requested_source_pair_independence_approval_id text,
      requested_operation text,
      requested_expected_revision bigint,
      requested_expected_status text,
      requested_expected_quarantine_reason text,
      requested_expected_quarantined_at timestamptz,
      requested_expected_last_validated_at timestamptz,
      requested_expected_last_good_block_number numeric,
      requested_expected_last_good_block_hash text,
      requested_expected_last_good_parent_hash text,
      requested_expected_last_good_state_root text,
      requested_expected_last_good_block_timestamp timestamptz,
      requested_expected_last_good_content_fingerprint text,
      requested_target_block_number numeric,
      requested_target_block_hash text,
      requested_target_parent_hash text,
      requested_target_state_root text,
      requested_target_block_timestamp timestamptz,
      requested_issued_at timestamptz,
      requested_expires_at timestamptz,
      requested_evaluated_at timestamptz,
      requested_lineage jsonb
    ) RETURNS TABLE (recovery_outcome text, ${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${RECOVERY_BODY}$function$;

    DO $set_aave_checkpoint_function_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${READ_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECORD_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECOVER_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${HEAD_GUARD_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_aave_checkpoint_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE aave_v3_ethereum_finalized_checkpoint_events,
      aave_v3_ethereum_finalized_checkpoint_heads,
      aave_v3_ethereum_finalized_checkpoint_recovery_events,
      aave_v3_ethereum_finalized_checkpoint_recovery_lineage,
      aave_v3_ethereum_finalized_checkpoint_recovery_sources
      FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL PRIVILEGES ON TYPE aave_v3_ethereum_finalized_checkpoint_events,
      aave_v3_ethereum_finalized_checkpoint_heads,
      aave_v3_ethereum_finalized_checkpoint_recovery_events,
      aave_v3_ethereum_finalized_checkpoint_recovery_lineage,
      aave_v3_ethereum_finalized_checkpoint_recovery_sources
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${READ_FUNCTION_IDENTITY} FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${RECORD_FUNCTION_IDENTITY} FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${RECOVER_FUNCTION_IDENTITY} FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY} FROM PUBLIC, ${api}, ${worker}, ${legacy};
    REVOKE ALL ON FUNCTION ${HEAD_GUARD_FUNCTION_IDENTITY} FROM PUBLIC, ${api}, ${worker}, ${legacy};
    GRANT EXECUTE ON FUNCTION ${READ_FUNCTION_IDENTITY} TO ${api}, ${worker};
    GRANT EXECUTE ON FUNCTION ${RECORD_FUNCTION_IDENTITY} TO ${worker};
    GRANT EXECUTE ON FUNCTION ${RECOVER_FUNCTION_IDENTITY} TO ${worker};`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  return `DO $refuse_aave_checkpoint_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM aave_v3_ethereum_finalized_checkpoint_events)
        OR EXISTS (SELECT 1 FROM aave_v3_ethereum_finalized_checkpoint_heads)
      THEN
        RAISE EXCEPTION 'cannot roll back Aave finalized checkpoints after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_aave_checkpoint_history_loss$;
    REVOKE EXECUTE ON FUNCTION ${RECOVER_FUNCTION_IDENTITY} FROM ${worker};
    REVOKE EXECUTE ON FUNCTION ${RECORD_FUNCTION_IDENTITY} FROM ${worker};
    REVOKE EXECUTE ON FUNCTION ${READ_FUNCTION_IDENTITY} FROM ${api}, ${worker};
    DROP FUNCTION ${RECOVER_FUNCTION_IDENTITY};
    DROP FUNCTION ${RECORD_FUNCTION_IDENTITY};
    DROP FUNCTION ${READ_FUNCTION_IDENTITY};
    DROP TRIGGER aave_checkpoint_head_transition ON aave_v3_ethereum_finalized_checkpoint_heads;
    DROP FUNCTION ${HEAD_GUARD_FUNCTION_IDENTITY};
    DROP TABLE aave_v3_ethereum_finalized_checkpoint_heads;
    DROP TRIGGER aave_checkpoint_recovery_sources_append_only_truncate ON aave_v3_ethereum_finalized_checkpoint_recovery_sources;
    DROP TRIGGER aave_checkpoint_recovery_sources_append_only_row ON aave_v3_ethereum_finalized_checkpoint_recovery_sources;
    DROP TRIGGER aave_checkpoint_recovery_lineage_append_only_truncate ON aave_v3_ethereum_finalized_checkpoint_recovery_lineage;
    DROP TRIGGER aave_checkpoint_recovery_lineage_append_only_row ON aave_v3_ethereum_finalized_checkpoint_recovery_lineage;
    DROP TRIGGER aave_checkpoint_recovery_events_append_only_truncate ON aave_v3_ethereum_finalized_checkpoint_recovery_events;
    DROP TRIGGER aave_checkpoint_recovery_events_append_only_row ON aave_v3_ethereum_finalized_checkpoint_recovery_events;
    DROP TABLE aave_v3_ethereum_finalized_checkpoint_recovery_sources;
    DROP TABLE aave_v3_ethereum_finalized_checkpoint_recovery_lineage;
    DROP TABLE aave_v3_ethereum_finalized_checkpoint_recovery_events;
    DROP TRIGGER aave_checkpoint_events_append_only_truncate ON aave_v3_ethereum_finalized_checkpoint_events;
    DROP TRIGGER aave_checkpoint_events_append_only_row ON aave_v3_ethereum_finalized_checkpoint_events;
    DROP FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    DROP TABLE aave_v3_ethereum_finalized_checkpoint_events;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createWalletRegistrationRevocationMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0016 must expose verification SQL');
  const prior = cumulative
    ? extendPriorVerifier(names, priorMigration.verifySql)
    : priorMigration.verifySql;
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const ownerCheck = cumulative ? `AND owner_role.rolname = ${owner}` : '';
  return `SELECT (
    prior.valid
    AND relations.valid
    AND types.valid
    AND functions.valid
    AND triggers.valid
    AND privileges.valid
  ) AS valid
  FROM (${prior}) AS prior
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 5
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'}) AS valid
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND relation.relkind = 'r'
      AND relation.relname IN (
        'aave_v3_ethereum_finalized_checkpoint_events',
        'aave_v3_ethereum_finalized_checkpoint_heads',
        'aave_v3_ethereum_finalized_checkpoint_recovery_events',
        'aave_v3_ethereum_finalized_checkpoint_recovery_lineage',
        'aave_v3_ethereum_finalized_checkpoint_recovery_sources'
      )
  ) AS relations
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 5
      AND pg_catalog.bool_and(type_state.typtype = 'c')
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type AS guarded_type
        INNER JOIN pg_catalog.pg_namespace AS guarded_namespace
          ON guarded_namespace.oid = guarded_type.typnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            guarded_type.typacl,
            pg_catalog.acldefault('T', guarded_type.typowner)
          )
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE guarded_namespace.nspname = pg_catalog.current_schema()
          AND guarded_type.typname IN (
            'aave_v3_ethereum_finalized_checkpoint_events',
            'aave_v3_ethereum_finalized_checkpoint_heads',
            'aave_v3_ethereum_finalized_checkpoint_recovery_events',
            'aave_v3_ethereum_finalized_checkpoint_recovery_lineage',
            'aave_v3_ethereum_finalized_checkpoint_recovery_sources'
          )
          AND acl.privilege_type = 'USAGE'
          AND (
            acl.grantee = 0
            OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration})
          )
      ) AS valid
    FROM pg_catalog.pg_type AS type_state
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_state.typnamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = type_state.typowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND type_state.typname IN (
        'aave_v3_ethereum_finalized_checkpoint_events',
        'aave_v3_ethereum_finalized_checkpoint_heads',
        'aave_v3_ethereum_finalized_checkpoint_recovery_events',
        'aave_v3_ethereum_finalized_checkpoint_recovery_lineage',
        'aave_v3_ethereum_finalized_checkpoint_recovery_sources'
      )
  ) AS types
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 5
      AND pg_catalog.bool_and(
        NOT function_state.proleakproof
        AND function_state.proparallel = 'u'
        ${ownerCheck}
        AND CASE function_state.proname
          WHEN 'read_aave_v3_ethereum_finalized_checkpoint' THEN
            function_state.prosecdef AND function_state.provolatile = 's'
            AND function_state.proconfig = ARRAY[
              'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
            ]::text[]
          WHEN 'record_aave_v3_ethereum_finalized_checkpoint' THEN
            function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proconfig = ARRAY[
              'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
            ]::text[]
          WHEN 'recover_aave_v3_ethereum_finalized_checkpoint' THEN
            function_state.prosecdef AND function_state.provolatile = 'v'
            AND function_state.proconfig = ARRAY[
              'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
            ]::text[]
          WHEN 'enforce_aave_v3_ethereum_checkpoint_head_transition' THEN
            NOT function_state.prosecdef
            AND function_state.proconfig = ARRAY[
              'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
            ]::text[]
          ELSE NOT function_state.prosecdef
        END
      ) AS valid
    FROM pg_catalog.pg_proc AS function_state
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function_state.pronamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = function_state.proowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND function_state.proname IN (
        'read_aave_v3_ethereum_finalized_checkpoint',
        'record_aave_v3_ethereum_finalized_checkpoint',
        'recover_aave_v3_ethereum_finalized_checkpoint',
        'reject_aave_v3_ethereum_checkpoint_event_mutation',
        'enforce_aave_v3_ethereum_checkpoint_head_transition'
      )
  ) AS functions
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 9
      AND pg_catalog.bool_and(NOT trigger_state.tgisinternal AND trigger_state.tgenabled = 'A') AS valid
    FROM pg_catalog.pg_trigger AS trigger_state
    WHERE trigger_state.tgrelid IN (
      pg_catalog.to_regclass('aave_v3_ethereum_finalized_checkpoint_events'),
      pg_catalog.to_regclass('aave_v3_ethereum_finalized_checkpoint_heads'),
      pg_catalog.to_regclass('aave_v3_ethereum_finalized_checkpoint_recovery_events'),
      pg_catalog.to_regclass('aave_v3_ethereum_finalized_checkpoint_recovery_lineage'),
      pg_catalog.to_regclass('aave_v3_ethereum_finalized_checkpoint_recovery_sources')
    )
      AND trigger_state.tgname IN (
        'aave_checkpoint_events_append_only_row',
        'aave_checkpoint_events_append_only_truncate',
        'aave_checkpoint_recovery_events_append_only_row',
        'aave_checkpoint_recovery_events_append_only_truncate',
        'aave_checkpoint_recovery_lineage_append_only_row',
        'aave_checkpoint_recovery_lineage_append_only_truncate',
        'aave_checkpoint_recovery_sources_append_only_row',
        'aave_checkpoint_recovery_sources_append_only_truncate',
        'aave_checkpoint_head_transition'
      )
  ) AS triggers
  CROSS JOIN (
    SELECT (
      pg_catalog.has_function_privilege(${api}, '${READ_FUNCTION_IDENTITY}', 'EXECUTE')
      AND pg_catalog.has_function_privilege(${worker}, '${READ_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${READ_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${RECORD_FUNCTION_IDENTITY}', 'EXECUTE')
      AND pg_catalog.has_function_privilege(${worker}, '${RECORD_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${RECORD_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${RECOVER_FUNCTION_IDENTITY}', 'EXECUTE')
      AND pg_catalog.has_function_privilege(${worker}, '${RECOVER_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${RECOVER_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_table_privilege(${api}, 'aave_v3_ethereum_finalized_checkpoint_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${worker}, 'aave_v3_ethereum_finalized_checkpoint_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${api}, 'aave_v3_ethereum_finalized_checkpoint_heads', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${worker}, 'aave_v3_ethereum_finalized_checkpoint_heads', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${api}, 'aave_v3_ethereum_finalized_checkpoint_recovery_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${worker}, 'aave_v3_ethereum_finalized_checkpoint_recovery_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${api}, 'aave_v3_ethereum_finalized_checkpoint_recovery_lineage', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${worker}, 'aave_v3_ethereum_finalized_checkpoint_recovery_lineage', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${api}, 'aave_v3_ethereum_finalized_checkpoint_recovery_sources', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT pg_catalog.has_table_privilege(${worker}, 'aave_v3_ethereum_finalized_checkpoint_recovery_sources', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    ) AS valid
  ) AS privileges`;
}

export function createAaveV3EthereumFinalizedCheckpointMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0017',
    description: 'add durable Aave Ethereum finalized checkpoints and bounded quarantine recovery',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0016'],
  };
}

export const createAaveV3EthereumFinalizedCheckpointMigrationV0017 =
  createAaveV3EthereumFinalizedCheckpointMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createAaveV3EthereumFinalizedCheckpointTestSchemaMigrationV0017 =
  createAaveV3EthereumFinalizedCheckpointMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
