import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createReviewedJobOutboxAdmissionMigration } from './0018-enforce-reviewed-job-outbox-admission.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const READ_FUNCTION_IDENTITY =
  'read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint)';
const RECORD_FUNCTION_IDENTITY =
  'record_stablecoin_depeg_latch(bigint,uuid,text,text,smallint,text,text,text,smallint,timestamp with time zone,text,text,text,text,text)';
const CLEAR_FUNCTION_IDENTITY =
  'clear_stablecoin_depeg_latch(uuid,text,smallint,text,text,text,smallint,text,text,timestamp with time zone,bigint,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,text,text,text,text)';
const EVENT_GUARD_FUNCTION_IDENTITY = 'reject_stablecoin_depeg_latch_history_mutation()';
const PROJECTION_GUARD_FUNCTION_IDENTITY = 'enforce_stablecoin_depeg_latch_projection()';
const TABLES = Object.freeze([
  'stablecoin_depeg_latch_events',
  'stablecoin_depeg_latch_projections',
] as const);

const PRIOR_API_FUNCTIONS = [
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
] as const;
const PRIOR_WORKER_FUNCTIONS = [
  'verify_wallet_revocation_state()',
  'read_aave_v3_ethereum_finalized_checkpoint(text)',
  'record_aave_v3_ethereum_finalized_checkpoint(bigint,uuid,text,text,text,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone)',
  'recover_aave_v3_ethereum_finalized_checkpoint(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb)',
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

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0019 verifier anchor must occur exactly once');
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

function assetBinding(prefix = ''): string {
  return `
      ${prefix}registry_environment = 'MAINNET'
      AND ${prefix}registry_version = 1
      AND ${prefix}registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
      AND ${prefix}asset_decimals = 6
      AND (
        (${prefix}stablecoin = 'USDC' AND ${prefix}network_id = 'eip155:1'
          AND ${prefix}asset_identity = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
        OR (${prefix}stablecoin = 'USDT' AND ${prefix}network_id = 'eip155:1'
          AND ${prefix}asset_identity = '0xdac17f958d2ee523a2206206994597c13d831ec7')
        OR (${prefix}stablecoin = 'PYUSD' AND ${prefix}network_id = 'eip155:1'
          AND ${prefix}asset_identity = '0x6c3ea9036406852006290770bedfcaba0e23a0e8')
        OR (${prefix}stablecoin = 'USDC'
          AND ${prefix}network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          AND ${prefix}asset_identity = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
        OR (${prefix}stablecoin = 'USDT'
          AND ${prefix}network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          AND ${prefix}asset_identity = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
        OR (${prefix}stablecoin = 'PYUSD'
          AND ${prefix}network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          AND ${prefix}asset_identity = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo')
      )`;
}

function assetColumns(prefix = ''): string {
  return `${prefix}registry_environment, ${prefix}registry_version,
        ${prefix}registry_fingerprint_sha256, ${prefix}stablecoin,
        ${prefix}network_id, ${prefix}asset_identity, ${prefix}asset_decimals`;
}

function resultColumns(): string {
  return `
      projection_schema_version smallint,
      projection_registry_environment text,
      projection_registry_version smallint,
      projection_registry_fingerprint text,
      projection_stablecoin text,
      projection_network_id text,
      projection_asset_identity text,
      projection_asset_decimals smallint,
      projection_revision bigint,
      projection_status text,
      projection_latch_id text,
      projection_latched_at timestamptz,
      projection_depeg_evidence_fingerprint text,
      projection_evidence_actor_reference_id text,
      projection_clear_id text,
      projection_cleared_at timestamptz,
      projection_risk_approver_reference_id text,
      projection_last_event_id text,
      projection_last_event_fingerprint text,
      projection_updated_at timestamptz`;
}

function nullProjection(): string {
  return `NULL::smallint, NULL::text, NULL::smallint, NULL::text, NULL::text,
        NULL::text, NULL::text, NULL::smallint, NULL::bigint, NULL::text,
        NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::text,
        NULL::timestamptz, NULL::text, NULL::text, NULL::text, NULL::timestamptz`;
}

const EVENT_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'stablecoin depeg latch history is append-only'
        USING ERRCODE = '55000';
    END;
    `;

const PROJECTION_GUARD_BODY = `
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.revision <> 1
          OR NEW.status <> 'LATCHED'
          OR NEW.clear_id IS NOT NULL
          OR NEW.cleared_at IS NOT NULL
          OR NEW.risk_approver_reference_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM stablecoin_depeg_latch_events AS event
            WHERE event.event_id = NEW.last_event_id
              AND event.event_type = 'LATCHED'
              AND event.revision = NEW.revision
              AND (${assetColumns('event.')}) = (${assetColumns('NEW.')})
              AND event.latch_id = NEW.latch_id
              AND event.effective_at = NEW.latched_at
              AND event.depeg_evidence_fingerprint_sha256 =
                NEW.depeg_evidence_fingerprint_sha256
              AND event.evidence_actor_reference_id = NEW.evidence_actor_reference_id
              AND event.event_fingerprint_sha256 = NEW.last_event_fingerprint_sha256
              AND event.recorded_at = NEW.updated_at
          )
        THEN
          RAISE EXCEPTION 'invalid stablecoin depeg latch projection insert'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      IF (${assetColumns('NEW.')}) IS DISTINCT FROM (${assetColumns('OLD.')})
        OR NEW.revision <> OLD.revision + 1
      THEN
        RAISE EXCEPTION 'invalid stablecoin depeg latch projection transition'
          USING ERRCODE = '23514';
      END IF;

      IF OLD.status = 'CLEARED' THEN
        IF NEW.status <> 'LATCHED'
          OR NEW.latched_at < OLD.cleared_at
          OR NEW.clear_id IS NOT NULL
          OR NEW.cleared_at IS NOT NULL
          OR NEW.risk_approver_reference_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1
            FROM stablecoin_depeg_latch_events AS event
            WHERE event.event_id = NEW.last_event_id
              AND event.event_type = 'LATCHED'
              AND event.revision = NEW.revision
              AND (${assetColumns('event.')}) = (${assetColumns('NEW.')})
              AND event.latch_id = NEW.latch_id
              AND event.effective_at = NEW.latched_at
              AND event.depeg_evidence_fingerprint_sha256 =
                NEW.depeg_evidence_fingerprint_sha256
              AND event.evidence_actor_reference_id = NEW.evidence_actor_reference_id
              AND event.event_fingerprint_sha256 = NEW.last_event_fingerprint_sha256
              AND event.recorded_at = NEW.updated_at
          )
        THEN
          RAISE EXCEPTION 'invalid stablecoin depeg relatch projection transition'
            USING ERRCODE = '23514';
        END IF;
      ELSIF OLD.status = 'LATCHED' THEN
        IF NEW.status <> 'CLEARED'
          OR NEW.latch_id <> OLD.latch_id
          OR NEW.latched_at <> OLD.latched_at
          OR NEW.depeg_evidence_fingerprint_sha256 <>
            OLD.depeg_evidence_fingerprint_sha256
          OR NEW.evidence_actor_reference_id <> OLD.evidence_actor_reference_id
          OR NEW.clear_id IS NULL
          OR NEW.cleared_at IS NULL
          OR NEW.risk_approver_reference_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM stablecoin_depeg_latch_events AS event
            WHERE event.event_id = NEW.last_event_id
              AND event.event_type = 'CLEARED'
              AND event.revision = NEW.revision
              AND (${assetColumns('event.')}) = (${assetColumns('NEW.')})
              AND event.latch_id = OLD.latch_id
              AND event.effective_at = NEW.cleared_at
              AND event.evidence_actor_reference_id = OLD.evidence_actor_reference_id
              AND event.risk_approver_reference_id = NEW.risk_approver_reference_id
              AND event.event_fingerprint_sha256 = NEW.last_event_fingerprint_sha256
              AND event.recorded_at = NEW.updated_at
          )
        THEN
          RAISE EXCEPTION 'invalid stablecoin depeg clear projection transition'
            USING ERRCODE = '23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'invalid stablecoin depeg latch projection state'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    `;

const READ_BODY = `
      SELECT
        1::smallint,
        projection.registry_environment,
        projection.registry_version,
        projection.registry_fingerprint_sha256,
        projection.stablecoin,
        projection.network_id,
        projection.asset_identity,
        projection.asset_decimals,
        projection.revision,
        projection.status,
        projection.latch_id,
        projection.latched_at,
        projection.depeg_evidence_fingerprint_sha256,
        projection.evidence_actor_reference_id,
        projection.clear_id,
        projection.cleared_at,
        projection.risk_approver_reference_id,
        projection.last_event_id,
        projection.last_event_fingerprint_sha256,
        projection.updated_at
      FROM stablecoin_depeg_latch_projections AS projection
      WHERE (${assetColumns('projection.')}) = (
        ${assetColumns('requested_')}
      )
    `;

const RECORD_BODY = `
    DECLARE
      recorded_at timestamptz := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      current_projection stablecoin_depeg_latch_projections%ROWTYPE;
      prior_event stablecoin_depeg_latch_events%ROWTYPE;
      prior_count integer;
      decision text;
      resulting_revision bigint;
    BEGIN
      IF (requested_expected_revision IS NOT NULL AND requested_expected_revision < 1)
        OR requested_correlation_id IS NULL
        OR requested_latch_id IS NULL
        OR requested_latched_at IS NULL
        OR requested_evidence_actor_reference_id IS NULL
        OR requested_depeg_evidence_fingerprint IS NULL
        OR requested_command_fingerprint IS NULL
        OR requested_event_fingerprint IS NULL
        OR NOT pg_catalog.isfinite(requested_latched_at)
        OR substring(requested_correlation_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_correlation_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_latch_id !~ '^[0-9a-f]{64}$'
        OR requested_evidence_actor_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_depeg_evidence_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_command_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_event_fingerprint !~ '^[0-9a-f]{64}$'
        OR (${assetBinding('requested_')}) IS NOT TRUE
        OR requested_latched_at > recorded_at + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid stablecoin depeg latch command' USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_correlation_id::text, 59001)
      );
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_latch_id, 59002)
      );
      SELECT pg_catalog.count(*) INTO prior_count
      FROM stablecoin_depeg_latch_events AS event
      WHERE event.event_id = requested_latch_id
        OR event.correlation_id = requested_correlation_id;
      IF prior_count > 0 THEN
        IF prior_count <> 1 THEN
          RAISE EXCEPTION 'stablecoin depeg latch idempotency conflict'
            USING ERRCODE = 'D1901';
        END IF;
        SELECT event.* INTO STRICT prior_event
        FROM stablecoin_depeg_latch_events AS event
        WHERE event.event_id = requested_latch_id
          OR event.correlation_id = requested_correlation_id;
        IF prior_event.event_type <> 'LATCHED'
          OR prior_event.event_id <> requested_latch_id
          OR prior_event.correlation_id <> requested_correlation_id
          OR prior_event.revision <> (
            CASE WHEN requested_expected_revision IS NULL
              THEN 1 ELSE requested_expected_revision + 1 END
          )
          OR prior_event.latch_id <> requested_latch_id
          OR prior_event.effective_at <> requested_latched_at
          OR prior_event.evaluated_at <> requested_latched_at
          OR prior_event.depeg_evidence_fingerprint_sha256 <>
            requested_depeg_evidence_fingerprint
          OR prior_event.evidence_actor_reference_id <>
            requested_evidence_actor_reference_id
          OR prior_event.command_fingerprint_sha256 <> requested_command_fingerprint
          OR prior_event.event_fingerprint_sha256 <> requested_event_fingerprint
          OR (${assetColumns('prior_event.')}) <> (${assetColumns('requested_')})
        THEN
          RAISE EXCEPTION 'stablecoin depeg latch idempotency conflict'
            USING ERRCODE = 'D1901';
        END IF;
        decision := 'IDEMPOTENT_REPLAY';
        RETURN QUERY SELECT decision, projection.*
        FROM read_stablecoin_depeg_latch(
          ${assetColumns('requested_')}
        ) AS projection;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'stablecoin depeg latch projection missing'
            USING ERRCODE = '55000';
        END IF;
        RETURN;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          pg_catalog.jsonb_build_array(${assetColumns('requested_')})::text, 59003
        )
      );
      SELECT projection.* INTO current_projection
      FROM stablecoin_depeg_latch_projections AS projection
      WHERE (${assetColumns('projection.')}) = (${assetColumns('requested_')})
      FOR UPDATE;

      IF NOT FOUND THEN
        IF requested_expected_revision IS NOT NULL THEN
          decision := 'REVISION_CONFLICT';
          RETURN QUERY SELECT decision, ${nullProjection()};
          RETURN;
        END IF;
        decision := 'LATCHED';
        resulting_revision := 1;
      ELSIF requested_expected_revision IS NULL
        OR requested_expected_revision <> current_projection.revision
      THEN
        decision := 'REVISION_CONFLICT';
        RETURN QUERY SELECT decision, projection.*
        FROM read_stablecoin_depeg_latch(${assetColumns('requested_')}) AS projection;
        RETURN;
      ELSIF current_projection.status = 'LATCHED' THEN
        decision := 'ALREADY_LATCHED';
        RETURN QUERY SELECT decision, projection.*
        FROM read_stablecoin_depeg_latch(${assetColumns('requested_')}) AS projection;
        RETURN;
      ELSE
        IF requested_latched_at < current_projection.cleared_at THEN
          RAISE EXCEPTION 'stablecoin depeg relatch evidence predates prior clear'
            USING ERRCODE = '22023';
        END IF;
        decision := 'RELATCHED';
        resulting_revision := current_projection.revision + 1;
      END IF;

      recorded_at := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      INSERT INTO stablecoin_depeg_latch_events (
        event_id, correlation_id, event_type, registry_environment,
        registry_version, registry_fingerprint_sha256, stablecoin, network_id,
        asset_identity, asset_decimals, revision, latch_id,
        depeg_evidence_fingerprint_sha256, recovery_evidence_fingerprint_sha256,
        evidence_actor_reference_id, risk_approver_reference_id,
        risk_approver_role, authorization_id, authorization_nonce,
        authorization_fingerprint_sha256, authorization_issued_at,
        authorization_not_before, authorization_expires_at,
        command_fingerprint_sha256, event_fingerprint_sha256,
        effective_at, evaluated_at, recorded_at
      ) VALUES (
        requested_latch_id, requested_correlation_id, 'LATCHED',
        ${assetColumns('requested_')}, resulting_revision, requested_latch_id,
        requested_depeg_evidence_fingerprint, NULL,
        requested_evidence_actor_reference_id, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, requested_command_fingerprint,
        requested_event_fingerprint, requested_latched_at,
        requested_latched_at, recorded_at
      );

      IF decision = 'LATCHED' THEN
        INSERT INTO stablecoin_depeg_latch_projections (
          ${assetColumns()}, revision, status, latch_id, latched_at,
          depeg_evidence_fingerprint_sha256, evidence_actor_reference_id,
          clear_id, cleared_at, risk_approver_reference_id, last_event_id,
          last_event_fingerprint_sha256, updated_at
        ) VALUES (
          ${assetColumns('requested_')}, resulting_revision, 'LATCHED',
          requested_latch_id, requested_latched_at,
          requested_depeg_evidence_fingerprint,
          requested_evidence_actor_reference_id, NULL, NULL, NULL,
          requested_latch_id, requested_event_fingerprint, recorded_at
        );
      ELSE
        UPDATE stablecoin_depeg_latch_projections AS projection
        SET revision = resulting_revision,
            status = 'LATCHED',
            latch_id = requested_latch_id,
            latched_at = requested_latched_at,
            depeg_evidence_fingerprint_sha256 = requested_depeg_evidence_fingerprint,
            evidence_actor_reference_id = requested_evidence_actor_reference_id,
            clear_id = NULL,
            cleared_at = NULL,
            risk_approver_reference_id = NULL,
            last_event_id = requested_latch_id,
            last_event_fingerprint_sha256 = requested_event_fingerprint,
            updated_at = recorded_at
        WHERE (${assetColumns('projection.')}) = (${assetColumns('requested_')});
      END IF;

      RETURN QUERY SELECT decision, projection.*
      FROM read_stablecoin_depeg_latch(${assetColumns('requested_')}) AS projection;
    END;
    `;

const CLEAR_BODY = `
    DECLARE
      recorded_at timestamptz := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      current_projection stablecoin_depeg_latch_projections%ROWTYPE;
      prior_event stablecoin_depeg_latch_events%ROWTYPE;
      prior_count integer;
      decision text;
      resulting_revision bigint;
    BEGIN
      IF requested_correlation_id IS NULL
        OR requested_expected_revision IS NULL
        OR requested_clear_id IS NULL
        OR requested_latch_id IS NULL
        OR requested_latched_at IS NULL
        OR requested_recovery_evidence_fingerprint IS NULL
        OR requested_evidence_actor_reference_id IS NULL
        OR requested_risk_approver_reference_id IS NULL
        OR requested_risk_approver_role IS NULL
        OR requested_cleared_at IS NULL
        OR requested_authorization_issued_at IS NULL
        OR requested_authorization_not_before IS NULL
        OR requested_authorization_expires_at IS NULL
        OR requested_evaluated_at IS NULL
        OR requested_authorization_fingerprint IS NULL
        OR requested_authorization_id IS NULL
        OR requested_command_fingerprint IS NULL
        OR requested_event_fingerprint IS NULL
        OR NOT pg_catalog.isfinite(requested_latched_at)
        OR NOT pg_catalog.isfinite(requested_cleared_at)
        OR NOT pg_catalog.isfinite(requested_authorization_issued_at)
        OR NOT pg_catalog.isfinite(requested_authorization_not_before)
        OR NOT pg_catalog.isfinite(requested_authorization_expires_at)
        OR NOT pg_catalog.isfinite(requested_evaluated_at)
        OR substring(requested_correlation_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_correlation_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_expected_revision < 1
        OR requested_clear_id !~ '^[0-9a-f]{64}$'
        OR requested_latch_id !~ '^[0-9a-f]{64}$'
        OR requested_clear_id = requested_latch_id
        OR requested_recovery_evidence_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_evidence_actor_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_risk_approver_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_evidence_actor_reference_id = requested_risk_approver_reference_id
        OR requested_risk_approver_role <> 'RISK_APPROVER'
        OR requested_authorization_nonce IS NULL
        OR substring(requested_authorization_nonce::text FROM 15 FOR 1) <> '4'
        OR substring(requested_authorization_nonce::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR requested_authorization_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_authorization_id <>
          'stablecoin-depeg-latch-recovery:' || requested_authorization_fingerprint
        OR requested_command_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_event_fingerprint !~ '^[0-9a-f]{64}$'
        OR (${assetBinding('requested_')}) IS NOT TRUE
        OR requested_latched_at > requested_authorization_issued_at
        OR requested_cleared_at <> requested_authorization_issued_at
        OR requested_authorization_issued_at > requested_authorization_not_before
        OR requested_authorization_not_before > requested_evaluated_at
        OR requested_evaluated_at >= requested_authorization_expires_at
        OR requested_authorization_expires_at <= requested_authorization_issued_at
        OR requested_authorization_expires_at - requested_authorization_issued_at >
          interval '15 minutes'
        OR requested_evaluated_at > recorded_at + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid stablecoin depeg latch recovery command'
          USING ERRCODE = '22023';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_correlation_id::text, 59001)
      );
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_clear_id, 59002)
      );
      SELECT pg_catalog.count(*) INTO prior_count
      FROM stablecoin_depeg_latch_events AS event
      WHERE event.event_id = requested_clear_id
        OR event.correlation_id = requested_correlation_id;
      IF prior_count > 0 THEN
        IF prior_count <> 1 THEN
          RAISE EXCEPTION 'stablecoin depeg latch recovery idempotency conflict'
            USING ERRCODE = 'D1902';
        END IF;
        SELECT event.* INTO STRICT prior_event
        FROM stablecoin_depeg_latch_events AS event
        WHERE event.event_id = requested_clear_id
          OR event.correlation_id = requested_correlation_id;
        IF prior_event.event_type <> 'CLEARED'
          OR prior_event.event_id <> requested_clear_id
          OR prior_event.correlation_id <> requested_correlation_id
          OR prior_event.revision <> requested_expected_revision + 1
          OR prior_event.latch_id <> requested_latch_id
          OR prior_event.recovery_evidence_fingerprint_sha256 <>
            requested_recovery_evidence_fingerprint
          OR prior_event.evidence_actor_reference_id <>
            requested_evidence_actor_reference_id
          OR prior_event.risk_approver_reference_id <>
            requested_risk_approver_reference_id
          OR prior_event.risk_approver_role <> requested_risk_approver_role
          OR prior_event.authorization_id <> requested_authorization_id
          OR prior_event.authorization_nonce <> requested_authorization_nonce
          OR prior_event.authorization_fingerprint_sha256 <>
            requested_authorization_fingerprint
          OR prior_event.authorization_issued_at <>
            requested_authorization_issued_at
          OR prior_event.authorization_not_before <>
            requested_authorization_not_before
          OR prior_event.authorization_expires_at <>
            requested_authorization_expires_at
          OR prior_event.effective_at <> requested_cleared_at
          OR prior_event.evaluated_at <> requested_evaluated_at
          OR prior_event.command_fingerprint_sha256 <> requested_command_fingerprint
          OR prior_event.event_fingerprint_sha256 <> requested_event_fingerprint
          OR (${assetColumns('prior_event.')}) <> (${assetColumns('requested_')})
        THEN
          RAISE EXCEPTION 'stablecoin depeg latch recovery idempotency conflict'
            USING ERRCODE = 'D1902';
        END IF;
        decision := 'IDEMPOTENT_REPLAY';
        RETURN QUERY SELECT decision, projection.*
        FROM read_stablecoin_depeg_latch(${assetColumns('requested_')}) AS projection;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'stablecoin depeg latch projection missing'
            USING ERRCODE = '55000';
        END IF;
        RETURN;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_authorization_nonce::text, 59004)
      );
      IF EXISTS (
        SELECT 1
        FROM stablecoin_depeg_latch_events AS event
        WHERE event.authorization_nonce = requested_authorization_nonce
          OR event.authorization_fingerprint_sha256 = requested_authorization_fingerprint
          OR event.authorization_id = requested_authorization_id
          OR event.recovery_evidence_fingerprint_sha256 =
            requested_recovery_evidence_fingerprint
      ) THEN
        RAISE EXCEPTION 'stablecoin depeg latch recovery authorization replay'
          USING ERRCODE = 'D1903';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          pg_catalog.jsonb_build_array(${assetColumns('requested_')})::text, 59003
        )
      );
      SELECT projection.* INTO current_projection
      FROM stablecoin_depeg_latch_projections AS projection
      WHERE (${assetColumns('projection.')}) = (${assetColumns('requested_')})
      FOR UPDATE;
      IF NOT FOUND THEN
        decision := 'LATCH_NOT_FOUND';
        RETURN QUERY SELECT decision, ${nullProjection()};
        RETURN;
      END IF;

      recorded_at := pg_catalog.date_trunc('milliseconds', clock_timestamp());
      IF recorded_at < requested_authorization_not_before
        OR recorded_at >= requested_authorization_expires_at
      THEN
        decision := 'AUTHORIZATION_EXPIRED';
      ELSIF current_projection.revision <> requested_expected_revision THEN
        decision := 'REVISION_CONFLICT';
      ELSIF current_projection.status <> 'LATCHED' THEN
        decision := 'LATCH_STATUS_MISMATCH';
      ELSIF current_projection.latch_id <> requested_latch_id
        OR current_projection.latched_at <> requested_latched_at
        OR current_projection.evidence_actor_reference_id <>
          requested_evidence_actor_reference_id
      THEN
        decision := 'LATCH_BINDING_MISMATCH';
      END IF;
      IF decision IS NOT NULL THEN
        RETURN QUERY SELECT decision, projection.*
        FROM read_stablecoin_depeg_latch(${assetColumns('requested_')}) AS projection;
        RETURN;
      END IF;

      resulting_revision := current_projection.revision + 1;
      INSERT INTO stablecoin_depeg_latch_events (
        event_id, correlation_id, event_type, registry_environment,
        registry_version, registry_fingerprint_sha256, stablecoin, network_id,
        asset_identity, asset_decimals, revision, latch_id,
        depeg_evidence_fingerprint_sha256, recovery_evidence_fingerprint_sha256,
        evidence_actor_reference_id, risk_approver_reference_id,
        risk_approver_role, authorization_id, authorization_nonce,
        authorization_fingerprint_sha256, authorization_issued_at,
        authorization_not_before, authorization_expires_at,
        command_fingerprint_sha256, event_fingerprint_sha256,
        effective_at, evaluated_at, recorded_at
      ) VALUES (
        requested_clear_id, requested_correlation_id, 'CLEARED',
        ${assetColumns('requested_')}, resulting_revision, requested_latch_id,
        current_projection.depeg_evidence_fingerprint_sha256,
        requested_recovery_evidence_fingerprint,
        requested_evidence_actor_reference_id,
        requested_risk_approver_reference_id, requested_risk_approver_role,
        requested_authorization_id, requested_authorization_nonce,
        requested_authorization_fingerprint, requested_authorization_issued_at,
        requested_authorization_not_before, requested_authorization_expires_at,
        requested_command_fingerprint, requested_event_fingerprint,
        requested_cleared_at, requested_evaluated_at, recorded_at
      );

      UPDATE stablecoin_depeg_latch_projections AS projection
      SET revision = resulting_revision,
          status = 'CLEARED',
          clear_id = requested_clear_id,
          cleared_at = requested_cleared_at,
          risk_approver_reference_id = requested_risk_approver_reference_id,
          last_event_id = requested_clear_id,
          last_event_fingerprint_sha256 = requested_event_fingerprint,
          updated_at = recorded_at
      WHERE (${assetColumns('projection.')}) = (${assetColumns('requested_')});

      decision := 'CLEARED';
      RETURN QUERY SELECT decision, projection.*
      FROM read_stablecoin_depeg_latch(${assetColumns('requested_')}) AS projection;
    END;
    `;

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  return `CREATE TABLE stablecoin_depeg_latch_events (
      event_id text PRIMARY KEY,
      correlation_id uuid NOT NULL UNIQUE,
      event_type text NOT NULL CHECK (event_type IN ('LATCHED', 'CLEARED')),
      registry_environment text NOT NULL,
      registry_version smallint NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      stablecoin text NOT NULL,
      network_id text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      revision bigint NOT NULL CHECK (revision >= 1),
      latch_id text NOT NULL,
      depeg_evidence_fingerprint_sha256 text NOT NULL,
      recovery_evidence_fingerprint_sha256 text UNIQUE,
      evidence_actor_reference_id text NOT NULL,
      risk_approver_reference_id text,
      risk_approver_role text,
      authorization_id text UNIQUE,
      authorization_nonce uuid UNIQUE,
      authorization_fingerprint_sha256 text UNIQUE,
      authorization_issued_at timestamptz,
      authorization_not_before timestamptz,
      authorization_expires_at timestamptz,
      command_fingerprint_sha256 text NOT NULL UNIQUE,
      event_fingerprint_sha256 text NOT NULL UNIQUE,
      effective_at timestamptz NOT NULL,
      evaluated_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT stablecoin_depeg_latch_event_asset_check CHECK (${assetBinding()}),
      CONSTRAINT stablecoin_depeg_latch_event_digest_check CHECK (
        event_id ~ '^[0-9a-f]{64}$'
        AND latch_id ~ '^[0-9a-f]{64}$'
        AND depeg_evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND command_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND event_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND (recovery_evidence_fingerprint_sha256 IS NULL
          OR recovery_evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$')
        AND (authorization_fingerprint_sha256 IS NULL
          OR authorization_fingerprint_sha256 ~ '^[0-9a-f]{64}$')
      ),
      CONSTRAINT stablecoin_depeg_latch_event_actor_check CHECK (
        evidence_actor_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND (risk_approver_reference_id IS NULL
          OR risk_approver_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$')
      ),
      CONSTRAINT stablecoin_depeg_latch_event_time_check CHECK (
        pg_catalog.isfinite(effective_at)
        AND pg_catalog.isfinite(evaluated_at)
        AND pg_catalog.isfinite(recorded_at)
        AND (authorization_issued_at IS NULL OR pg_catalog.isfinite(authorization_issued_at))
        AND (authorization_not_before IS NULL OR pg_catalog.isfinite(authorization_not_before))
        AND (authorization_expires_at IS NULL OR pg_catalog.isfinite(authorization_expires_at))
        AND effective_at <= evaluated_at
        AND evaluated_at <= recorded_at + interval '30 seconds'
      ),
      CONSTRAINT stablecoin_depeg_latch_event_shape_check CHECK (
        (
          event_type = 'LATCHED'
          AND event_id = latch_id
          AND recovery_evidence_fingerprint_sha256 IS NULL
          AND risk_approver_reference_id IS NULL
          AND risk_approver_role IS NULL
          AND authorization_id IS NULL
          AND authorization_nonce IS NULL
          AND authorization_fingerprint_sha256 IS NULL
          AND authorization_issued_at IS NULL
          AND authorization_not_before IS NULL
          AND authorization_expires_at IS NULL
          AND effective_at = evaluated_at
        ) OR (
          event_type = 'CLEARED'
          AND event_id <> latch_id
          AND recovery_evidence_fingerprint_sha256 IS NOT NULL
          AND risk_approver_reference_id IS NOT NULL
          AND risk_approver_reference_id <> evidence_actor_reference_id
          AND risk_approver_role = 'RISK_APPROVER'
          AND authorization_id =
            'stablecoin-depeg-latch-recovery:' || authorization_fingerprint_sha256
          AND authorization_nonce IS NOT NULL
          AND authorization_fingerprint_sha256 IS NOT NULL
          AND authorization_issued_at IS NOT NULL
          AND authorization_not_before IS NOT NULL
          AND authorization_expires_at IS NOT NULL
          AND effective_at = authorization_issued_at
          AND authorization_issued_at <= authorization_not_before
          AND authorization_not_before <= evaluated_at
          AND evaluated_at < authorization_expires_at
          AND authorization_expires_at - authorization_issued_at <= interval '15 minutes'
          AND recorded_at >= authorization_not_before
          AND recorded_at < authorization_expires_at
        )
      ),
      CONSTRAINT stablecoin_depeg_latch_event_asset_revision_unique UNIQUE (
        registry_environment, registry_version, registry_fingerprint_sha256,
        stablecoin, network_id, asset_identity, asset_decimals, revision
      ),
      CONSTRAINT stablecoin_depeg_latch_event_latch_fk FOREIGN KEY (latch_id)
        REFERENCES stablecoin_depeg_latch_events(event_id)
        DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE stablecoin_depeg_latch_projections (
      registry_environment text NOT NULL,
      registry_version smallint NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      stablecoin text NOT NULL,
      network_id text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      revision bigint NOT NULL CHECK (revision >= 1),
      status text NOT NULL CHECK (status IN ('LATCHED', 'CLEARED')),
      latch_id text NOT NULL,
      latched_at timestamptz NOT NULL,
      depeg_evidence_fingerprint_sha256 text NOT NULL,
      evidence_actor_reference_id text NOT NULL,
      clear_id text,
      cleared_at timestamptz,
      risk_approver_reference_id text,
      last_event_id text NOT NULL,
      last_event_fingerprint_sha256 text NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT stablecoin_depeg_latch_projection_pk PRIMARY KEY (
        registry_environment, registry_version, registry_fingerprint_sha256,
        stablecoin, network_id, asset_identity, asset_decimals
      ),
      CONSTRAINT stablecoin_depeg_latch_projection_asset_check CHECK (${assetBinding()}),
      CONSTRAINT stablecoin_depeg_latch_projection_digest_check CHECK (
        latch_id ~ '^[0-9a-f]{64}$'
        AND depeg_evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND last_event_id ~ '^[0-9a-f]{64}$'
        AND last_event_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND (clear_id IS NULL OR clear_id ~ '^[0-9a-f]{64}$')
      ),
      CONSTRAINT stablecoin_depeg_latch_projection_actor_check CHECK (
        evidence_actor_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        AND (risk_approver_reference_id IS NULL
          OR risk_approver_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$')
      ),
      CONSTRAINT stablecoin_depeg_latch_projection_shape_check CHECK (
        pg_catalog.isfinite(latched_at)
        AND pg_catalog.isfinite(updated_at)
        AND (cleared_at IS NULL OR pg_catalog.isfinite(cleared_at))
        AND ((status = 'LATCHED' AND clear_id IS NULL AND cleared_at IS NULL
          AND risk_approver_reference_id IS NULL AND last_event_id = latch_id)
        OR (status = 'CLEARED' AND clear_id IS NOT NULL AND cleared_at IS NOT NULL
          AND risk_approver_reference_id IS NOT NULL AND last_event_id = clear_id
          AND cleared_at >= latched_at))
      ),
      CONSTRAINT stablecoin_depeg_latch_projection_latch_fk FOREIGN KEY (latch_id)
        REFERENCES stablecoin_depeg_latch_events(event_id),
      CONSTRAINT stablecoin_depeg_latch_projection_last_event_fk FOREIGN KEY (last_event_id)
        REFERENCES stablecoin_depeg_latch_events(event_id)
    );

    CREATE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY}
    RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
    AS $function$${EVENT_GUARD_BODY}$function$;
    CREATE TRIGGER stablecoin_depeg_latch_events_append_only_row
      BEFORE UPDATE OR DELETE ON stablecoin_depeg_latch_events
      FOR EACH ROW EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER stablecoin_depeg_latch_events_append_only_truncate
      BEFORE TRUNCATE ON stablecoin_depeg_latch_events
      FOR EACH STATEMENT EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER stablecoin_depeg_latch_projection_delete_row
      BEFORE DELETE ON stablecoin_depeg_latch_projections
      FOR EACH ROW EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    CREATE TRIGGER stablecoin_depeg_latch_projection_truncate
      BEFORE TRUNCATE ON stablecoin_depeg_latch_projections
      FOR EACH STATEMENT EXECUTE FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    ALTER TABLE stablecoin_depeg_latch_events
      ENABLE ALWAYS TRIGGER stablecoin_depeg_latch_events_append_only_row;
    ALTER TABLE stablecoin_depeg_latch_events
      ENABLE ALWAYS TRIGGER stablecoin_depeg_latch_events_append_only_truncate;
    ALTER TABLE stablecoin_depeg_latch_projections
      ENABLE ALWAYS TRIGGER stablecoin_depeg_latch_projection_delete_row;
    ALTER TABLE stablecoin_depeg_latch_projections
      ENABLE ALWAYS TRIGGER stablecoin_depeg_latch_projection_truncate;

    CREATE FUNCTION ${PROJECTION_GUARD_FUNCTION_IDENTITY}
    RETURNS trigger LANGUAGE plpgsql
    AS $function$${PROJECTION_GUARD_BODY}$function$;
    CREATE TRIGGER stablecoin_depeg_latch_projection_transition
      BEFORE INSERT OR UPDATE ON stablecoin_depeg_latch_projections
      FOR EACH ROW EXECUTE FUNCTION ${PROJECTION_GUARD_FUNCTION_IDENTITY};
    ALTER TABLE stablecoin_depeg_latch_projections
      ENABLE ALWAYS TRIGGER stablecoin_depeg_latch_projection_transition;

    CREATE FUNCTION read_stablecoin_depeg_latch(
      requested_registry_environment text,
      requested_registry_version smallint,
      requested_registry_fingerprint_sha256 text,
      requested_stablecoin text,
      requested_network_id text,
      requested_asset_identity text,
      requested_asset_decimals smallint
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER STABLE PARALLEL UNSAFE
    AS $function$
    BEGIN
      IF (${assetBinding('requested_')}) IS NOT TRUE THEN
        RAISE EXCEPTION 'invalid stablecoin depeg latch asset' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY ${READ_BODY};
    END;
    $function$;

    CREATE FUNCTION record_stablecoin_depeg_latch(
      requested_expected_revision bigint,
      requested_correlation_id uuid,
      requested_latch_id text,
      requested_registry_environment text,
      requested_registry_version smallint,
      requested_registry_fingerprint_sha256 text,
      requested_stablecoin text,
      requested_network_id text,
      requested_asset_decimals smallint,
      requested_latched_at timestamptz,
      requested_asset_identity text,
      requested_evidence_actor_reference_id text,
      requested_depeg_evidence_fingerprint text,
      requested_command_fingerprint text,
      requested_event_fingerprint text
    ) RETURNS TABLE (record_outcome text, ${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${RECORD_BODY}$function$;

    CREATE FUNCTION clear_stablecoin_depeg_latch(
      requested_correlation_id uuid,
      requested_registry_environment text,
      requested_registry_version smallint,
      requested_registry_fingerprint_sha256 text,
      requested_stablecoin text,
      requested_network_id text,
      requested_asset_decimals smallint,
      requested_asset_identity text,
      requested_clear_id text,
      requested_latched_at timestamptz,
      requested_expected_revision bigint,
      requested_latch_id text,
      requested_recovery_evidence_fingerprint text,
      requested_evidence_actor_reference_id text,
      requested_risk_approver_reference_id text,
      requested_risk_approver_role text,
      requested_cleared_at timestamptz,
      requested_authorization_issued_at timestamptz,
      requested_authorization_not_before timestamptz,
      requested_authorization_expires_at timestamptz,
      requested_evaluated_at timestamptz,
      requested_authorization_nonce uuid,
      requested_authorization_fingerprint text,
      requested_authorization_id text,
      requested_command_fingerprint text,
      requested_event_fingerprint text
    ) RETURNS TABLE (clear_outcome text, ${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${CLEAR_BODY}$function$;

    DO $set_stablecoin_depeg_latch_function_paths$
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
        'ALTER FUNCTION %I.${CLEAR_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${PROJECTION_GUARD_FUNCTION_IDENTITY} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_stablecoin_depeg_latch_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${READ_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${RECORD_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${CLEAR_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${PROJECTION_GUARD_FUNCTION_IDENTITY}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    GRANT EXECUTE ON FUNCTION ${READ_FUNCTION_IDENTITY} TO ${api}, ${worker};
    GRANT EXECUTE ON FUNCTION ${RECORD_FUNCTION_IDENTITY} TO ${worker};`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  return `DO $refuse_stablecoin_depeg_latch_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM stablecoin_depeg_latch_events)
        OR EXISTS (SELECT 1 FROM stablecoin_depeg_latch_projections)
      THEN
        RAISE EXCEPTION 'cannot roll back stablecoin depeg latches after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_stablecoin_depeg_latch_history_loss$;
    REVOKE EXECUTE ON FUNCTION ${RECORD_FUNCTION_IDENTITY} FROM ${worker};
    REVOKE EXECUTE ON FUNCTION ${READ_FUNCTION_IDENTITY} FROM ${api}, ${worker};
    DROP FUNCTION ${CLEAR_FUNCTION_IDENTITY};
    DROP FUNCTION ${RECORD_FUNCTION_IDENTITY};
    DROP FUNCTION ${READ_FUNCTION_IDENTITY};
    DROP TRIGGER stablecoin_depeg_latch_projection_transition
      ON stablecoin_depeg_latch_projections;
    DROP FUNCTION ${PROJECTION_GUARD_FUNCTION_IDENTITY};
    DROP TRIGGER stablecoin_depeg_latch_projection_truncate
      ON stablecoin_depeg_latch_projections;
    DROP TRIGGER stablecoin_depeg_latch_projection_delete_row
      ON stablecoin_depeg_latch_projections;
    DROP TABLE stablecoin_depeg_latch_projections;
    DROP TRIGGER stablecoin_depeg_latch_events_append_only_truncate
      ON stablecoin_depeg_latch_events;
    DROP TRIGGER stablecoin_depeg_latch_events_append_only_row
      ON stablecoin_depeg_latch_events;
    DROP FUNCTION ${EVENT_GUARD_FUNCTION_IDENTITY};
    DROP TABLE stablecoin_depeg_latch_events;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createReviewedJobOutboxAdmissionMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0018 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  let prior = priorMigration.verifySql;
  if (cumulative) {
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(api, PRIOR_API_FUNCTIONS),
      functionAllowance(api, [...PRIOR_API_FUNCTIONS, READ_FUNCTION_IDENTITY]),
    );
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(worker, PRIOR_WORKER_FUNCTIONS),
      functionAllowance(worker, [
        ...PRIOR_WORKER_FUNCTIONS,
        READ_FUNCTION_IDENTITY,
        RECORD_FUNCTION_IDENTITY,
      ]),
    );
  }
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
    SELECT pg_catalog.count(*) = 2
      AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
      AS valid
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND relation.relkind = 'r'
      AND relation.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
  ) AS relations
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 2
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
          AND guarded_type.typname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
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
      AND type_state.typname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
  ) AS types
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 5
      AND pg_catalog.bool_and(
        NOT function_state.proleakproof
        AND function_state.proparallel = 'u'
        ${ownerCheck}
        AND CASE function_state.proname
          WHEN 'read_stablecoin_depeg_latch' THEN
            function_state.prosecdef AND function_state.provolatile = 's'
          WHEN 'record_stablecoin_depeg_latch' THEN
            function_state.prosecdef AND function_state.provolatile = 'v'
          WHEN 'clear_stablecoin_depeg_latch' THEN
            function_state.prosecdef AND function_state.provolatile = 'v'
          ELSE NOT function_state.prosecdef
        END
        AND CASE function_state.proname
          WHEN 'reject_stablecoin_depeg_latch_history_mutation' THEN
            function_state.proconfig = ARRAY['search_path=pg_catalog']::text[]
          ELSE function_state.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
        END
      ) AS valid
    FROM pg_catalog.pg_proc AS function_state
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function_state.pronamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = function_state.proowner
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND function_state.proname IN (
        'read_stablecoin_depeg_latch',
        'record_stablecoin_depeg_latch',
        'clear_stablecoin_depeg_latch',
        'reject_stablecoin_depeg_latch_history_mutation',
        'enforce_stablecoin_depeg_latch_projection'
      )
  ) AS functions
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 5
      AND pg_catalog.bool_and(NOT trigger_state.tgisinternal AND trigger_state.tgenabled = 'A')
      AS valid
    FROM pg_catalog.pg_trigger AS trigger_state
    WHERE trigger_state.tgrelid IN (
      pg_catalog.to_regclass('stablecoin_depeg_latch_events'),
      pg_catalog.to_regclass('stablecoin_depeg_latch_projections')
    )
      AND trigger_state.tgname IN (
        'stablecoin_depeg_latch_events_append_only_row',
        'stablecoin_depeg_latch_events_append_only_truncate',
        'stablecoin_depeg_latch_projection_delete_row',
        'stablecoin_depeg_latch_projection_truncate',
        'stablecoin_depeg_latch_projection_transition'
      )
  ) AS triggers
  CROSS JOIN (
    SELECT (
      pg_catalog.has_function_privilege(${api}, '${READ_FUNCTION_IDENTITY}', 'EXECUTE')
      AND pg_catalog.has_function_privilege(${worker}, '${READ_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${READ_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${migration}, '${READ_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${RECORD_FUNCTION_IDENTITY}', 'EXECUTE')
      AND pg_catalog.has_function_privilege(${worker}, '${RECORD_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${RECORD_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${migration}, '${RECORD_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${api}, '${CLEAR_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${worker}, '${CLEAR_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${legacy}, '${CLEAR_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(${migration}, '${CLEAR_FUNCTION_IDENTITY}', 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS table_state
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = table_state.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            table_state.relacl,
            pg_catalog.acldefault('r', table_state.relowner)
          )
        ) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND table_state.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
          AND (
            acl.grantee = 0
            OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration})
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        INNER JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
        LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = pg_catalog.current_schema()
          AND procedure.proname IN (
            'read_stablecoin_depeg_latch',
            'record_stablecoin_depeg_latch',
            'clear_stablecoin_depeg_latch',
            'reject_stablecoin_depeg_latch_history_mutation',
            'enforce_stablecoin_depeg_latch_projection'
          )
          AND (
            acl.grantee = 0
            OR NOT (
              acl.privilege_type = 'EXECUTE'
              AND NOT acl.is_grantable
              AND (
                acl.grantee = procedure.proowner
                OR (procedure.proname = 'read_stablecoin_depeg_latch'
                  AND grantee.rolname IN (${api}, ${worker}))
                OR (procedure.proname = 'record_stablecoin_depeg_latch'
                  AND grantee.rolname = ${worker})
              )
            )
          )
      )
    ) AS valid
  ) AS privileges`;
}

export function createStablecoinDepegLatchMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0019',
    description: 'create durable append-only stablecoin depeg latches',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0018'],
  };
}

export const createStablecoinDepegLatchMigrationV0019 = createStablecoinDepegLatchMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createStablecoinDepegLatchTestSchemaMigrationV0019 =
  createStablecoinDepegLatchMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
