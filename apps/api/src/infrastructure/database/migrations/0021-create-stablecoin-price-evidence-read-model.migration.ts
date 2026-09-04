import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createBalanceSyncReadModelMigration } from './0020-create-balance-sync-read-model.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const REGISTRY_MANIFEST = `crypto-lending:stablecoin-price-sources:MAINNET:v1:${REGISTRY_FINGERPRINT}:rows=12`;
const REGISTRY_BINDING_MARKERS = Object.freeze([
  REGISTRY_FINGERPRINT,
  'eip155:1',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '0xdac17f958d2ee523a2206206994597c13d831ec7',
  '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  'c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692',
  'usdc-usd.data.eth',
  'usdt-usd.data.eth',
  'pyusd-usd.data.eth',
] as const);
const READ_PRICE_EVIDENCE =
  'read_stablecoin_price_evidence(text,smallint,text,text,text,text,smallint,timestamp with time zone)';
const RECORD_PRICE_EVIDENCE =
  'record_stablecoin_price_evidence(uuid,text,text,timestamp with time zone,text,text,text,smallint,text,text,text,text,smallint,text,text,numeric,text,timestamp with time zone,timestamp with time zone,numeric,smallint,text,numeric,smallint,text,text,text)';
const HISTORY_GUARD = 'reject_stablecoin_price_history_mutation()';
const PROJECTION_GUARD = 'enforce_stablecoin_price_watermark_projection()';
const TABLES = Object.freeze([
  'stablecoin_price_source_registry',
  'stablecoin_price_evidence',
  'stablecoin_price_observations',
  'stablecoin_price_watermark_events',
  'stablecoin_price_source_watermarks',
] as const);
const EXPECTED_TRIGGER_BINDINGS = Object.freeze([
  ...TABLES.slice(0, 4).flatMap((table) => [
    {
      relation: table,
      trigger: `${table}_append_only_row`,
      functionIdentity: HISTORY_GUARD,
      triggerType: 27,
    },
    {
      relation: table,
      trigger: `${table}_append_only_truncate`,
      functionIdentity: HISTORY_GUARD,
      triggerType: 34,
    },
  ]),
  {
    relation: 'stablecoin_price_source_watermarks',
    trigger: 'stablecoin_price_watermarks_no_delete',
    functionIdentity: HISTORY_GUARD,
    triggerType: 11,
  },
  {
    relation: 'stablecoin_price_source_watermarks',
    trigger: 'stablecoin_price_watermarks_no_truncate',
    functionIdentity: HISTORY_GUARD,
    triggerType: 34,
  },
  {
    relation: 'stablecoin_price_source_watermarks',
    trigger: 'stablecoin_price_watermark_transition',
    functionIdentity: PROJECTION_GUARD,
    triggerType: 23,
  },
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
  'read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint)',
  'read_balance_sync_portfolio(uuid,jsonb,timestamp with time zone)',
] as const;
const PRIOR_WORKER_FUNCTIONS = [
  'verify_wallet_revocation_state()',
  'read_aave_v3_ethereum_finalized_checkpoint(text)',
  'record_aave_v3_ethereum_finalized_checkpoint(bigint,uuid,text,text,text,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone)',
  'recover_aave_v3_ethereum_finalized_checkpoint(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb)',
  'read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint)',
  'record_stablecoin_depeg_latch(bigint,uuid,text,text,smallint,text,text,text,smallint,timestamp with time zone,text,text,text,text,text)',
  'read_balance_sync_checkpoint(uuid,uuid,text)',
  'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
  'mark_balance_sync_checkpoint_stale(uuid,uuid,text,bigint,timestamp with time zone,text)',
  'replace_balance_sync_after_reorg(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
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
    throw new Error('Migration 0021 verifier anchor must occur exactly once');
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

function sourceColumns(prefix = ''): string {
  return `${prefix}registry_environment, ${prefix}registry_version,
        ${prefix}registry_fingerprint_sha256, ${prefix}stablecoin,
        ${prefix}network_id, ${prefix}asset_identity, ${prefix}asset_decimals,
        ${prefix}source_id, ${prefix}source_reference`;
}

function assetBinding(prefix = ''): string {
  return `${prefix}registry_environment = 'MAINNET'
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

function sourceBinding(prefix = ''): string {
  return `(${assetBinding(prefix)})
      AND (
        (${prefix}source_id = 'PYTH_CORE'
          AND ${prefix}source_reference = CASE ${prefix}stablecoin
            WHEN 'USDC' THEN 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
            WHEN 'USDT' THEN '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b'
            WHEN 'PYUSD' THEN 'c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692'
          END)
        OR (${prefix}source_id = 'CHAINLINK_DATA_FEEDS'
          AND ${prefix}source_reference = CASE ${prefix}stablecoin
            WHEN 'USDC' THEN 'usdc-usd.data.eth'
            WHEN 'USDT' THEN 'usdt-usd.data.eth'
            WHEN 'PYUSD' THEN 'pyusd-usd.data.eth'
          END)
      )`;
}

const CATALOG_VALUES = `
      ('MAINNET', 1, '${REGISTRY_FINGERPRINT}', 'USDC', 'eip155:1',
       '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6),
      ('MAINNET', 1, '${REGISTRY_FINGERPRINT}', 'USDT', 'eip155:1',
       '0xdac17f958d2ee523a2206206994597c13d831ec7', 6),
      ('MAINNET', 1, '${REGISTRY_FINGERPRINT}', 'PYUSD', 'eip155:1',
       '0x6c3ea9036406852006290770bedfcaba0e23a0e8', 6),
      ('MAINNET', 1, '${REGISTRY_FINGERPRINT}', 'USDC',
       'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
       'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6),
      ('MAINNET', 1, '${REGISTRY_FINGERPRINT}', 'USDT',
       'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
       'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6),
      ('MAINNET', 1, '${REGISTRY_FINGERPRINT}', 'PYUSD',
       'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
       '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 6)`;

const HISTORY_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'stablecoin price evidence history is append-only'
        USING ERRCODE = '55000';
    END;
    `;

const PROJECTION_GUARD_BODY = `
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.revision <> 1 OR NOT EXISTS (
          SELECT 1
          FROM stablecoin_price_watermark_events AS event
          INNER JOIN stablecoin_price_observations AS observation
            ON observation.observation_id = event.observation_id
            AND (${sourceColumns('observation.')}) = (${sourceColumns('event.')})
          WHERE event.event_id = NEW.last_event_id
            AND event.revision = NEW.revision
            AND event.previous_observation_id IS NULL
            AND event.previous_sequence IS NULL
            AND event.previous_update_id IS NULL
            AND event.previous_priced_at IS NULL
            AND event.previous_observed_at IS NULL
            AND (${sourceColumns('event.')}) = (${sourceColumns('NEW.')})
            AND observation.observation_id = NEW.current_observation_id
            AND observation.source_sequence = NEW.last_accepted_sequence
            AND observation.source_update_id = NEW.last_accepted_update_id
            AND observation.priced_at = NEW.last_accepted_priced_at
            AND observation.observed_at = NEW.last_accepted_observed_at
            AND event.accepted_at = NEW.updated_at
        ) THEN
          RAISE EXCEPTION 'invalid stablecoin price watermark insert'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      IF (${sourceColumns('NEW.')}) IS DISTINCT FROM (${sourceColumns('OLD.')})
        OR NEW.revision <> OLD.revision + 1
        OR NOT EXISTS (
          SELECT 1
          FROM stablecoin_price_watermark_events AS event
          INNER JOIN stablecoin_price_observations AS observation
            ON observation.observation_id = event.observation_id
            AND (${sourceColumns('observation.')}) = (${sourceColumns('event.')})
          WHERE event.event_id = NEW.last_event_id
            AND event.revision = NEW.revision
            AND (${sourceColumns('event.')}) = (${sourceColumns('NEW.')})
            AND event.previous_observation_id = OLD.current_observation_id
            AND event.previous_sequence = OLD.last_accepted_sequence
            AND event.previous_update_id = OLD.last_accepted_update_id
            AND event.previous_priced_at = OLD.last_accepted_priced_at
            AND event.previous_observed_at = OLD.last_accepted_observed_at
            AND observation.observation_id = NEW.current_observation_id
            AND observation.source_sequence = NEW.last_accepted_sequence
            AND observation.source_update_id = NEW.last_accepted_update_id
            AND observation.priced_at = NEW.last_accepted_priced_at
            AND observation.observed_at = NEW.last_accepted_observed_at
            AND event.accepted_at = NEW.updated_at
        )
      THEN
        RAISE EXCEPTION 'invalid stablecoin price watermark transition'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    `;

const RECORD_BODY = `
    DECLARE
      recorded_at timestamptz := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      current_watermark stablecoin_price_source_watermarks%ROWTYPE;
      replay_event stablecoin_price_watermark_events%ROWTYPE;
      replay_observation stablecoin_price_observations%ROWTYPE;
      replay_evidence stablecoin_price_evidence%ROWTYPE;
      next_revision bigint;
    BEGIN
      IF requested_evidence_id !~ '^[0-9a-f]{64}$'
        OR requested_evidence_actor_reference_id !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
        OR requested_evidence_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_observation_id !~ '^[0-9a-f]{64}$'
        OR requested_command_fingerprint !~ '^[0-9a-f]{64}$'
        OR requested_event_id !~ '^[0-9a-f]{64}$'
        OR requested_event_fingerprint !~ '^[0-9a-f]{64}$'
        OR NOT pg_catalog.isfinite(requested_verified_at)
        OR NOT pg_catalog.isfinite(requested_priced_at)
        OR NOT pg_catalog.isfinite(requested_observed_at)
        OR pg_catalog.date_trunc('milliseconds', requested_verified_at) <> requested_verified_at
        OR pg_catalog.date_trunc('milliseconds', requested_priced_at) <> requested_priced_at
        OR pg_catalog.date_trunc('milliseconds', requested_observed_at) <> requested_observed_at
        OR requested_priced_at > requested_observed_at
        OR requested_observed_at > requested_verified_at
        OR requested_verified_at > recorded_at + interval '5 seconds'
        OR requested_source_sequence <> pg_catalog.trunc(requested_source_sequence)
        OR requested_source_sequence < 1
        OR requested_source_sequence >
          999999999999999999999999999999999999999999999999999999999999999999999999999999
        OR requested_usd_rate_mantissa <> pg_catalog.trunc(requested_usd_rate_mantissa)
        OR requested_usd_rate_mantissa < 0
        OR requested_usd_rate_mantissa >
          999999999999999999999999999999999999999999999999999999999999999999999999999999
        OR requested_usd_rate_scale <> 8
        OR (
          requested_source_id = 'PYTH_CORE'
          AND (
            requested_source_update_id !~ '^[0-9a-f]{64}$'
            OR requested_confidence_kind <> 'PUBLISHED_ABSOLUTE_USD'
            OR requested_confidence_mantissa IS NULL
            OR requested_confidence_mantissa <> pg_catalog.trunc(requested_confidence_mantissa)
            OR requested_confidence_mantissa < 0
            OR requested_confidence_mantissa >
              999999999999999999999999999999999999999999999999999999999999999999999999999999
            OR requested_confidence_scale <> 8
          )
        )
        OR (
          requested_source_id = 'CHAINLINK_DATA_FEEDS'
          AND (
            requested_source_update_id <> requested_source_sequence::text
            OR requested_confidence_kind <> 'NOT_PUBLISHED'
            OR requested_confidence_mantissa IS NOT NULL
            OR requested_confidence_scale IS NOT NULL
          )
        )
      THEN
        RAISE EXCEPTION 'stablecoin price evidence rejected' USING ERRCODE = '22023';
      END IF;

      PERFORM 1
      FROM stablecoin_price_source_registry AS source_state
      WHERE (${sourceColumns('source_state.')}) = (
        requested_registry_environment, requested_registry_version,
        requested_registry_fingerprint, requested_stablecoin,
        requested_network_id, requested_asset_identity, requested_asset_decimals,
        requested_source_id, requested_source_reference
      )
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stablecoin price evidence rejected' USING ERRCODE = '22023';
      END IF;

      SELECT event_state.* INTO replay_event
      FROM stablecoin_price_watermark_events AS event_state
      WHERE event_state.event_id = requested_event_id;
      IF FOUND THEN
        SELECT observation_state.* INTO STRICT replay_observation
        FROM stablecoin_price_observations AS observation_state
        WHERE observation_state.observation_id = replay_event.observation_id;
        SELECT evidence_state.* INTO STRICT replay_evidence
        FROM stablecoin_price_evidence AS evidence_state
        WHERE evidence_state.evidence_id = replay_observation.evidence_id;
        IF replay_event.command_fingerprint_sha256 <> requested_command_fingerprint
          OR replay_event.event_fingerprint_sha256 <> requested_event_fingerprint
          OR replay_event.correlation_id <> requested_correlation_id
          OR replay_observation.observation_id <> requested_observation_id
          OR replay_observation.evidence_id <> requested_evidence_id
          OR replay_evidence.evidence_actor_reference_id <>
            requested_evidence_actor_reference_id
          OR replay_evidence.evidence_fingerprint_sha256 <> requested_evidence_fingerprint
          OR replay_evidence.verified_at <> requested_verified_at
          OR (${sourceColumns('replay_observation.')}) IS DISTINCT FROM (
            requested_registry_environment, requested_registry_version,
            requested_registry_fingerprint, requested_stablecoin,
            requested_network_id, requested_asset_identity, requested_asset_decimals,
            requested_source_id, requested_source_reference
          )
          OR replay_observation.source_sequence <> requested_source_sequence
          OR replay_observation.source_update_id <> requested_source_update_id
          OR replay_observation.priced_at <> requested_priced_at
          OR replay_observation.observed_at <> requested_observed_at
          OR replay_observation.usd_rate_mantissa <> requested_usd_rate_mantissa
          OR replay_observation.usd_rate_scale <> requested_usd_rate_scale
          OR replay_observation.confidence_kind <> requested_confidence_kind
          OR replay_observation.confidence_mantissa IS DISTINCT FROM
            requested_confidence_mantissa
          OR replay_observation.confidence_scale IS DISTINCT FROM requested_confidence_scale
        THEN
          RAISE EXCEPTION 'stablecoin price evidence command conflict' USING ERRCODE = 'P2101';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          replay_observation.observation_id, replay_event.revision;
        RETURN;
      END IF;

      IF EXISTS (
        SELECT 1 FROM stablecoin_price_watermark_events AS event_state
        WHERE event_state.command_fingerprint_sha256 = requested_command_fingerprint
           OR event_state.event_fingerprint_sha256 = requested_event_fingerprint
      ) THEN
        RAISE EXCEPTION 'stablecoin price evidence command conflict' USING ERRCODE = 'P2101';
      END IF;

      IF EXISTS (
        SELECT 1 FROM stablecoin_price_observations AS observation_state
        WHERE observation_state.observation_id = requested_observation_id
      ) OR EXISTS (
        SELECT 1 FROM stablecoin_price_observations AS observation_state
        WHERE (${sourceColumns('observation_state.')}) = (
          requested_registry_environment, requested_registry_version,
          requested_registry_fingerprint, requested_stablecoin,
          requested_network_id, requested_asset_identity, requested_asset_decimals,
          requested_source_id, requested_source_reference
        ) AND observation_state.source_update_id = requested_source_update_id
      ) THEN
        RETURN QUERY SELECT 'REPLAYED_UPDATE_ID'::text, requested_observation_id, NULL::bigint;
        RETURN;
      END IF;

      SELECT watermark_state.* INTO current_watermark
      FROM stablecoin_price_source_watermarks AS watermark_state
      WHERE (${sourceColumns('watermark_state.')}) = (
        requested_registry_environment, requested_registry_version,
        requested_registry_fingerprint, requested_stablecoin,
        requested_network_id, requested_asset_identity, requested_asset_decimals,
        requested_source_id, requested_source_reference
      )
      FOR UPDATE;

      IF FOUND AND (
        requested_source_sequence <= current_watermark.last_accepted_sequence
        OR requested_priced_at < current_watermark.last_accepted_priced_at
        OR requested_observed_at < current_watermark.last_accepted_observed_at
      ) THEN
        RETURN QUERY SELECT 'NON_MONOTONIC'::text, requested_observation_id, NULL::bigint;
        RETURN;
      END IF;

      INSERT INTO stablecoin_price_evidence (
        evidence_id, evidence_actor_reference_id, evidence_fingerprint_sha256,
        verified_at, recorded_at
      ) VALUES (
        requested_evidence_id, requested_evidence_actor_reference_id,
        requested_evidence_fingerprint, requested_verified_at, recorded_at
      ) ON CONFLICT (evidence_id) DO NOTHING;
      SELECT evidence_state.* INTO STRICT replay_evidence
      FROM stablecoin_price_evidence AS evidence_state
      WHERE evidence_state.evidence_id = requested_evidence_id;
      IF replay_evidence.evidence_actor_reference_id <> requested_evidence_actor_reference_id
        OR replay_evidence.evidence_fingerprint_sha256 <> requested_evidence_fingerprint
        OR replay_evidence.verified_at <> requested_verified_at
      THEN
        RAISE EXCEPTION 'stablecoin price evidence command conflict' USING ERRCODE = 'P2101';
      END IF;

      INSERT INTO stablecoin_price_observations (
        observation_id, evidence_id, correlation_id,
        registry_environment, registry_version, registry_fingerprint_sha256,
        stablecoin, network_id, asset_identity, asset_decimals,
        source_id, source_reference, source_sequence, source_update_id,
        priced_at, observed_at, usd_rate_mantissa, usd_rate_scale,
        confidence_kind, confidence_mantissa, confidence_scale, recorded_at
      ) VALUES (
        requested_observation_id, requested_evidence_id, requested_correlation_id,
        requested_registry_environment, requested_registry_version,
        requested_registry_fingerprint, requested_stablecoin, requested_network_id,
        requested_asset_identity, requested_asset_decimals, requested_source_id,
        requested_source_reference, requested_source_sequence, requested_source_update_id,
        requested_priced_at, requested_observed_at, requested_usd_rate_mantissa,
        requested_usd_rate_scale, requested_confidence_kind,
        requested_confidence_mantissa, requested_confidence_scale, recorded_at
      );

      next_revision := CASE WHEN current_watermark.revision IS NULL
        THEN 1 ELSE current_watermark.revision + 1 END;
      INSERT INTO stablecoin_price_watermark_events (
        event_id, observation_id, correlation_id,
        registry_environment, registry_version, registry_fingerprint_sha256,
        stablecoin, network_id, asset_identity, asset_decimals,
        source_id, source_reference, revision, previous_observation_id,
        previous_sequence, previous_update_id, previous_priced_at, previous_observed_at,
        command_fingerprint_sha256, event_fingerprint_sha256, accepted_at
      ) VALUES (
        requested_event_id, requested_observation_id, requested_correlation_id,
        requested_registry_environment, requested_registry_version,
        requested_registry_fingerprint, requested_stablecoin, requested_network_id,
        requested_asset_identity, requested_asset_decimals, requested_source_id,
        requested_source_reference, next_revision,
        current_watermark.current_observation_id, current_watermark.last_accepted_sequence,
        current_watermark.last_accepted_update_id, current_watermark.last_accepted_priced_at,
        current_watermark.last_accepted_observed_at, requested_command_fingerprint,
        requested_event_fingerprint, recorded_at
      );

      IF current_watermark.revision IS NULL THEN
        INSERT INTO stablecoin_price_source_watermarks (
          registry_environment, registry_version, registry_fingerprint_sha256,
          stablecoin, network_id, asset_identity, asset_decimals, source_id, source_reference,
          revision, current_observation_id, last_accepted_sequence, last_accepted_update_id,
          last_accepted_priced_at, last_accepted_observed_at, last_event_id, updated_at
        ) VALUES (
          requested_registry_environment, requested_registry_version,
          requested_registry_fingerprint, requested_stablecoin, requested_network_id,
          requested_asset_identity, requested_asset_decimals, requested_source_id,
          requested_source_reference, next_revision, requested_observation_id,
          requested_source_sequence, requested_source_update_id, requested_priced_at,
          requested_observed_at, requested_event_id, recorded_at
        );
      ELSE
        UPDATE stablecoin_price_source_watermarks AS watermark_state SET
          revision = next_revision,
          current_observation_id = requested_observation_id,
          last_accepted_sequence = requested_source_sequence,
          last_accepted_update_id = requested_source_update_id,
          last_accepted_priced_at = requested_priced_at,
          last_accepted_observed_at = requested_observed_at,
          last_event_id = requested_event_id,
          updated_at = recorded_at
        WHERE (${sourceColumns('watermark_state.')}) = (
          requested_registry_environment, requested_registry_version,
          requested_registry_fingerprint, requested_stablecoin,
          requested_network_id, requested_asset_identity, requested_asset_decimals,
          requested_source_id, requested_source_reference
        );
        IF NOT FOUND THEN
          RAISE EXCEPTION 'stablecoin price evidence rejected' USING ERRCODE = '40001';
        END IF;
      END IF;

      RETURN QUERY SELECT 'ACCEPTED'::text, requested_observation_id, next_revision;
    END;
    `;

const READ_BODY = `
    BEGIN
      IF NOT pg_catalog.isfinite(requested_evaluated_at)
        OR pg_catalog.date_trunc('milliseconds', requested_evaluated_at) <>
          requested_evaluated_at
        OR (SELECT pg_catalog.count(*)
            FROM stablecoin_price_source_registry AS requested_source
            WHERE requested_source.registry_environment = requested_registry_environment
              AND requested_source.registry_version = requested_registry_version
              AND requested_source.registry_fingerprint_sha256 = requested_registry_fingerprint
              AND requested_source.stablecoin = requested_stablecoin
              AND requested_source.network_id = requested_network_id
              AND requested_source.asset_identity = requested_asset_identity
              AND requested_source.asset_decimals = requested_asset_decimals) <> 2
      THEN
        RAISE EXCEPTION 'stablecoin price evidence read rejected' USING ERRCODE = '22023';
      END IF;

      RETURN QUERY
      SELECT source_state.source_id, source_state.source_reference,
        latest.observation_id, latest.evidence_id,
        latest.evidence_actor_reference_id, latest.evidence_fingerprint_sha256,
        latest.evidence_verified_at, latest.correlation_id, latest.source_sequence::text,
        latest.source_update_id, latest.priced_at, latest.observed_at,
        latest.usd_rate_mantissa::text, latest.usd_rate_scale,
        latest.confidence_kind, latest.confidence_mantissa::text,
        latest.confidence_scale, latest.event_id, latest.revision,
        latest.previous_observation_id, latest.previous_sequence::text,
        latest.previous_update_id, latest.previous_priced_at, latest.previous_observed_at,
        latest.event_fingerprint_sha256, latest.accepted_at
      FROM stablecoin_price_source_registry AS source_state
      LEFT JOIN LATERAL (
        SELECT observation.observation_id, observation.evidence_id,
          evidence.evidence_actor_reference_id, evidence.evidence_fingerprint_sha256,
          evidence.verified_at AS evidence_verified_at, observation.correlation_id,
          observation.source_sequence, observation.source_update_id,
          observation.priced_at, observation.observed_at, observation.usd_rate_mantissa,
          observation.usd_rate_scale, observation.confidence_kind,
          observation.confidence_mantissa, observation.confidence_scale,
          event.event_id, event.revision, event.previous_observation_id,
          event.previous_sequence, event.previous_update_id, event.previous_priced_at,
          event.previous_observed_at, event.event_fingerprint_sha256, event.accepted_at
        FROM stablecoin_price_watermark_events AS event
        INNER JOIN stablecoin_price_observations AS observation
          ON observation.observation_id = event.observation_id
          AND (${sourceColumns('observation.')}) = (${sourceColumns('event.')})
        INNER JOIN stablecoin_price_evidence AS evidence
          ON evidence.evidence_id = observation.evidence_id
        WHERE (${sourceColumns('event.')}) = (${sourceColumns('source_state.')})
          AND event.accepted_at <= requested_evaluated_at
          AND observation.observed_at <= requested_evaluated_at
        ORDER BY event.revision DESC
        LIMIT 1
      ) AS latest ON true
      WHERE source_state.registry_environment = requested_registry_environment
        AND source_state.registry_version = requested_registry_version
        AND source_state.registry_fingerprint_sha256 = requested_registry_fingerprint
        AND source_state.stablecoin = requested_stablecoin
        AND source_state.network_id = requested_network_id
        AND source_state.asset_identity = requested_asset_identity
        AND source_state.asset_decimals = requested_asset_decimals
      ORDER BY CASE source_state.source_id
        WHEN 'PYTH_CORE' THEN 1 WHEN 'CHAINLINK_DATA_FEEDS' THEN 2 ELSE 3 END;
    END;
    `;

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  return `CREATE TABLE stablecoin_price_source_registry (
      registry_environment text NOT NULL,
      registry_version smallint NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      stablecoin text NOT NULL,
      network_id text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      source_id text NOT NULL,
      source_reference text NOT NULL,
      CONSTRAINT stablecoin_price_source_registry_pk PRIMARY KEY (
        registry_environment, registry_version, registry_fingerprint_sha256,
        stablecoin, network_id, asset_identity, asset_decimals, source_id, source_reference
      ),
      CONSTRAINT stablecoin_price_source_registry_exact_check CHECK (${sourceBinding()})
    );
    COMMENT ON TABLE stablecoin_price_source_registry IS '${REGISTRY_MANIFEST}';
    INSERT INTO stablecoin_price_source_registry (
      registry_environment, registry_version, registry_fingerprint_sha256,
      stablecoin, network_id, asset_identity, asset_decimals, source_id, source_reference
    ) SELECT asset.*, source.source_id,
        CASE source.source_id
          WHEN 'PYTH_CORE' THEN CASE asset.stablecoin
            WHEN 'USDC' THEN 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
            WHEN 'USDT' THEN '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b'
            ELSE 'c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692'
          END
          ELSE pg_catalog.lower(asset.stablecoin) || '-usd.data.eth'
        END
      FROM (VALUES ${CATALOG_VALUES}) AS asset(
        registry_environment, registry_version, registry_fingerprint_sha256,
        stablecoin, network_id, asset_identity, asset_decimals
      ) CROSS JOIN (VALUES ('PYTH_CORE'), ('CHAINLINK_DATA_FEEDS')) AS source(source_id);

    CREATE TABLE stablecoin_price_evidence (
      evidence_id text PRIMARY KEY,
      evidence_actor_reference_id text NOT NULL,
      evidence_fingerprint_sha256 text NOT NULL,
      verified_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT stablecoin_price_evidence_id_check CHECK (evidence_id ~ '^[0-9a-f]{64}$'),
      CONSTRAINT stablecoin_price_evidence_actor_check CHECK (
        evidence_actor_reference_id ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
      ),
      CONSTRAINT stablecoin_price_evidence_fingerprint_check CHECK (
        evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT stablecoin_price_evidence_time_check CHECK (
        pg_catalog.isfinite(verified_at) AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', verified_at) = verified_at
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND verified_at <= recorded_at + interval '5 seconds'
      )
    );

    CREATE TABLE stablecoin_price_observations (
      observation_id text PRIMARY KEY,
      evidence_id text NOT NULL REFERENCES stablecoin_price_evidence(evidence_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      correlation_id uuid NOT NULL,
      registry_environment text NOT NULL,
      registry_version smallint NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      stablecoin text NOT NULL,
      network_id text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      source_id text NOT NULL,
      source_reference text NOT NULL,
      source_sequence numeric(78, 0) NOT NULL,
      source_update_id text NOT NULL,
      priced_at timestamptz NOT NULL,
      observed_at timestamptz NOT NULL,
      usd_rate_mantissa numeric(78, 0) NOT NULL,
      usd_rate_scale smallint NOT NULL,
      confidence_kind text NOT NULL,
      confidence_mantissa numeric(78, 0),
      confidence_scale smallint,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT stablecoin_price_observation_source_fk FOREIGN KEY (${sourceColumns()})
        REFERENCES stablecoin_price_source_registry (${sourceColumns()})
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT stablecoin_price_observation_digest_check CHECK (
        observation_id ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT stablecoin_price_observation_sequence_check CHECK (source_sequence >= 1),
      CONSTRAINT stablecoin_price_observation_update_check CHECK (
        (source_id = 'PYTH_CORE' AND source_update_id ~ '^[0-9a-f]{64}$')
        OR (source_id = 'CHAINLINK_DATA_FEEDS' AND source_update_id = source_sequence::text)
      ),
      CONSTRAINT stablecoin_price_observation_rate_check CHECK (
        usd_rate_mantissa >= 0 AND usd_rate_scale = 8
      ),
      CONSTRAINT stablecoin_price_observation_confidence_check CHECK (
        (source_id = 'PYTH_CORE' AND confidence_kind = 'PUBLISHED_ABSOLUTE_USD'
          AND confidence_mantissa >= 0 AND confidence_scale = 8)
        OR (source_id = 'CHAINLINK_DATA_FEEDS' AND confidence_kind = 'NOT_PUBLISHED'
          AND confidence_mantissa IS NULL AND confidence_scale IS NULL)
      ),
      CONSTRAINT stablecoin_price_observation_time_check CHECK (
        pg_catalog.isfinite(priced_at) AND pg_catalog.isfinite(observed_at)
        AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', priced_at) = priced_at
        AND pg_catalog.date_trunc('milliseconds', observed_at) = observed_at
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND priced_at <= observed_at AND observed_at <= recorded_at + interval '5 seconds'
      ),
      CONSTRAINT stablecoin_price_observation_exact_identity_unique UNIQUE (
        observation_id, ${sourceColumns()}
      ),
      CONSTRAINT stablecoin_price_observation_update_unique UNIQUE (
        ${sourceColumns()}, source_update_id
      ),
      CONSTRAINT stablecoin_price_observation_sequence_unique UNIQUE (
        ${sourceColumns()}, source_sequence
      )
    );

    CREATE TABLE stablecoin_price_watermark_events (
      event_id text PRIMARY KEY,
      observation_id text NOT NULL,
      correlation_id uuid NOT NULL,
      registry_environment text NOT NULL,
      registry_version smallint NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      stablecoin text NOT NULL,
      network_id text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      source_id text NOT NULL,
      source_reference text NOT NULL,
      revision bigint NOT NULL,
      previous_observation_id text,
      previous_sequence numeric(78, 0),
      previous_update_id text,
      previous_priced_at timestamptz,
      previous_observed_at timestamptz,
      command_fingerprint_sha256 text NOT NULL UNIQUE,
      event_fingerprint_sha256 text NOT NULL UNIQUE,
      accepted_at timestamptz NOT NULL,
      CONSTRAINT stablecoin_price_event_observation_fk FOREIGN KEY (
        observation_id, ${sourceColumns()}
      ) REFERENCES stablecoin_price_observations (
        observation_id, ${sourceColumns()}
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT stablecoin_price_event_previous_observation_fk FOREIGN KEY (
        previous_observation_id, ${sourceColumns()}
      ) REFERENCES stablecoin_price_observations (
        observation_id, ${sourceColumns()}
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT stablecoin_price_event_digest_check CHECK (
        event_id ~ '^[0-9a-f]{64}$'
        AND command_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND event_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT stablecoin_price_event_revision_unique UNIQUE (${sourceColumns()}, revision),
      CONSTRAINT stablecoin_price_event_prior_check CHECK (
        (revision = 1 AND previous_observation_id IS NULL AND previous_sequence IS NULL
          AND previous_update_id IS NULL AND previous_priced_at IS NULL
          AND previous_observed_at IS NULL)
        OR (revision > 1 AND previous_observation_id IS NOT NULL AND previous_sequence IS NOT NULL
          AND previous_update_id IS NOT NULL AND previous_priced_at IS NOT NULL
          AND previous_observed_at IS NOT NULL)
      ),
      CONSTRAINT stablecoin_price_event_time_check CHECK (
        pg_catalog.isfinite(accepted_at)
        AND pg_catalog.date_trunc('milliseconds', accepted_at) = accepted_at
        AND (previous_priced_at IS NULL OR (
          pg_catalog.isfinite(previous_priced_at)
          AND pg_catalog.isfinite(previous_observed_at)
          AND pg_catalog.date_trunc('milliseconds', previous_priced_at) = previous_priced_at
          AND pg_catalog.date_trunc('milliseconds', previous_observed_at) = previous_observed_at
          AND previous_priced_at <= previous_observed_at
        ))
      )
    );

    CREATE TABLE stablecoin_price_source_watermarks (
      registry_environment text NOT NULL,
      registry_version smallint NOT NULL,
      registry_fingerprint_sha256 text NOT NULL,
      stablecoin text NOT NULL,
      network_id text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      source_id text NOT NULL,
      source_reference text NOT NULL,
      revision bigint NOT NULL,
      current_observation_id text NOT NULL,
      last_accepted_sequence numeric(78, 0) NOT NULL,
      last_accepted_update_id text NOT NULL,
      last_accepted_priced_at timestamptz NOT NULL,
      last_accepted_observed_at timestamptz NOT NULL,
      last_event_id text NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT stablecoin_price_watermark_pk PRIMARY KEY (${sourceColumns()}),
      CONSTRAINT stablecoin_price_watermark_source_fk FOREIGN KEY (${sourceColumns()})
        REFERENCES stablecoin_price_source_registry (${sourceColumns()})
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT stablecoin_price_watermark_observation_fk FOREIGN KEY (
        current_observation_id, ${sourceColumns()}
      ) REFERENCES stablecoin_price_observations (
        observation_id, ${sourceColumns()}
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT stablecoin_price_watermark_event_fk FOREIGN KEY (last_event_id)
        REFERENCES stablecoin_price_watermark_events(event_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT stablecoin_price_watermark_revision_check CHECK (revision >= 1),
      CONSTRAINT stablecoin_price_watermark_time_check CHECK (
        pg_catalog.isfinite(last_accepted_priced_at)
        AND pg_catalog.isfinite(last_accepted_observed_at)
        AND pg_catalog.isfinite(updated_at)
        AND pg_catalog.date_trunc('milliseconds', last_accepted_priced_at) =
          last_accepted_priced_at
        AND pg_catalog.date_trunc('milliseconds', last_accepted_observed_at) =
          last_accepted_observed_at
        AND pg_catalog.date_trunc('milliseconds', updated_at) = updated_at
        AND last_accepted_priced_at <= last_accepted_observed_at
      )
    );

    CREATE FUNCTION reject_stablecoin_price_history_mutation()
    RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
    SET search_path = pg_catalog
    AS $function$${HISTORY_GUARD_BODY}$function$;
    CREATE FUNCTION enforce_stablecoin_price_watermark_projection()
    RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
    AS $function$${PROJECTION_GUARD_BODY}$function$;

    ${TABLES.slice(0, 4)
      .map(
        (table) => `CREATE TRIGGER ${table}_append_only_row
      BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_stablecoin_price_history_mutation();
    CREATE TRIGGER ${table}_append_only_truncate
      BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_stablecoin_price_history_mutation();
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${table}_append_only_row;
    ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${table}_append_only_truncate;`,
      )
      .join('\n    ')}
    CREATE TRIGGER stablecoin_price_watermarks_no_delete
      BEFORE DELETE ON stablecoin_price_source_watermarks
      FOR EACH ROW EXECUTE FUNCTION reject_stablecoin_price_history_mutation();
    CREATE TRIGGER stablecoin_price_watermarks_no_truncate
      BEFORE TRUNCATE ON stablecoin_price_source_watermarks
      FOR EACH STATEMENT EXECUTE FUNCTION reject_stablecoin_price_history_mutation();
    CREATE TRIGGER stablecoin_price_watermark_transition
      BEFORE INSERT OR UPDATE ON stablecoin_price_source_watermarks
      FOR EACH ROW EXECUTE FUNCTION enforce_stablecoin_price_watermark_projection();
    ALTER TABLE stablecoin_price_source_watermarks ENABLE ALWAYS TRIGGER
      stablecoin_price_watermarks_no_delete;
    ALTER TABLE stablecoin_price_source_watermarks ENABLE ALWAYS TRIGGER
      stablecoin_price_watermarks_no_truncate;
    ALTER TABLE stablecoin_price_source_watermarks ENABLE ALWAYS TRIGGER
      stablecoin_price_watermark_transition;

    CREATE FUNCTION record_stablecoin_price_evidence(
      requested_correlation_id uuid,
      requested_evidence_id text,
      requested_evidence_actor_reference_id text,
      requested_verified_at timestamptz,
      requested_evidence_fingerprint text,
      requested_observation_id text,
      requested_registry_environment text,
      requested_registry_version smallint,
      requested_registry_fingerprint text,
      requested_stablecoin text,
      requested_network_id text,
      requested_asset_identity text,
      requested_asset_decimals smallint,
      requested_source_id text,
      requested_source_reference text,
      requested_source_sequence numeric,
      requested_source_update_id text,
      requested_priced_at timestamptz,
      requested_observed_at timestamptz,
      requested_usd_rate_mantissa numeric,
      requested_usd_rate_scale smallint,
      requested_confidence_kind text,
      requested_confidence_mantissa numeric,
      requested_confidence_scale smallint,
      requested_command_fingerprint text,
      requested_event_id text,
      requested_event_fingerprint text
    ) RETURNS TABLE (record_outcome text, accepted_observation_id text, watermark_revision bigint)
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${RECORD_BODY}$function$;

    CREATE FUNCTION read_stablecoin_price_evidence(
      requested_registry_environment text,
      requested_registry_version smallint,
      requested_registry_fingerprint text,
      requested_stablecoin text,
      requested_network_id text,
      requested_asset_identity text,
      requested_asset_decimals smallint,
      requested_evaluated_at timestamptz
    ) RETURNS TABLE (
      source_id text, source_reference text, observation_id text, evidence_id text,
      evidence_actor_reference_id text, evidence_fingerprint_sha256 text,
      evidence_verified_at timestamptz, correlation_id uuid, source_sequence text,
      source_update_id text, priced_at timestamptz, observed_at timestamptz,
      usd_rate_mantissa text, usd_rate_scale smallint, confidence_kind text,
      confidence_mantissa text, confidence_scale smallint, event_id text, revision bigint,
      previous_observation_id text, previous_sequence text, previous_update_id text,
      previous_priced_at timestamptz, previous_observed_at timestamptz,
      event_fingerprint_sha256 text, accepted_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER STABLE PARALLEL UNSAFE
    AS $function$${READ_BODY}$function$;

    DO $set_stablecoin_price_function_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECORD_PRICE_EVIDENCE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${READ_PRICE_EVIDENCE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${PROJECTION_GUARD} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_stablecoin_price_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${READ_PRICE_EVIDENCE}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${RECORD_PRICE_EVIDENCE}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${HISTORY_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${PROJECTION_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    GRANT EXECUTE ON FUNCTION ${READ_PRICE_EVIDENCE} TO ${api};
    GRANT EXECUTE ON FUNCTION ${RECORD_PRICE_EVIDENCE} TO ${worker};`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  return `DO $refuse_stablecoin_price_evidence_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM stablecoin_price_evidence)
        OR EXISTS (SELECT 1 FROM stablecoin_price_observations)
        OR EXISTS (SELECT 1 FROM stablecoin_price_watermark_events)
        OR EXISTS (SELECT 1 FROM stablecoin_price_source_watermarks)
      THEN
        RAISE EXCEPTION 'cannot roll back stablecoin price evidence after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_stablecoin_price_evidence_history_loss$;
    REVOKE EXECUTE ON FUNCTION ${READ_PRICE_EVIDENCE} FROM ${api};
    REVOKE EXECUTE ON FUNCTION ${RECORD_PRICE_EVIDENCE} FROM ${worker};
    DROP FUNCTION ${READ_PRICE_EVIDENCE};
    DROP FUNCTION ${RECORD_PRICE_EVIDENCE};
    DROP TRIGGER stablecoin_price_watermark_transition ON stablecoin_price_source_watermarks;
    DROP TRIGGER stablecoin_price_watermarks_no_truncate ON stablecoin_price_source_watermarks;
    DROP TRIGGER stablecoin_price_watermarks_no_delete ON stablecoin_price_source_watermarks;
    ${TABLES.slice(0, 4)
      .toReversed()
      .map(
        (table) => `DROP TRIGGER ${table}_append_only_truncate ON ${table};
    DROP TRIGGER ${table}_append_only_row ON ${table};`,
      )
      .join('\n    ')}
    DROP FUNCTION ${PROJECTION_GUARD};
    DROP FUNCTION ${HISTORY_GUARD};
    DROP TABLE stablecoin_price_source_watermarks;
    DROP TABLE stablecoin_price_watermark_events;
    DROP TABLE stablecoin_price_observations;
    DROP TABLE stablecoin_price_evidence;
    DROP TABLE stablecoin_price_source_registry;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const previous = createBalanceSyncReadModelMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0020 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  let prior = previous.verifySql;
  if (cumulative) {
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(api, PRIOR_API_FUNCTIONS),
      functionAllowance(api, [...PRIOR_API_FUNCTIONS, READ_PRICE_EVIDENCE]),
    );
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(worker, PRIOR_WORKER_FUNCTIONS),
      functionAllowance(worker, [...PRIOR_WORKER_FUNCTIONS, RECORD_PRICE_EVIDENCE]),
    );
  }
  const ownerPredicate = cumulative
    ? `AND pg_catalog.bool_and(function_owner.rolname = ${owner})`
    : '';
  const relationOwner = cumulative ? owner : 'relation_owner.rolname';
  const typeOwner = cumulative ? owner : 'type_owner.rolname';
  const catalogVerifier = cumulative
    ? `SELECT pg_catalog.count(*) = 2
        AND pg_catalog.obj_description(
          pg_catalog.to_regclass('stablecoin_price_source_registry'), 'pg_class'
        ) = '${REGISTRY_MANIFEST}'
        AND pg_catalog.bool_and(CASE constraint_state.conname
          WHEN 'stablecoin_price_source_registry_pk' THEN
            constraint_state.contype = 'p'
            AND constraint_state.convalidated
            AND constraint_state.conkey = ARRAY[1,2,3,4,5,6,7,8,9]::smallint[]
          WHEN 'stablecoin_price_source_registry_exact_check' THEN
            constraint_state.contype = 'c'
            AND constraint_state.convalidated
            ${REGISTRY_BINDING_MARKERS.map(
              (marker) =>
                `AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(constraint_state.oid), '${marker}') > 0`,
            ).join('\n            ')}
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.conrelid =
          pg_catalog.to_regclass('stablecoin_price_source_registry')
        AND constraint_state.conname IN (
          'stablecoin_price_source_registry_pk',
          'stablecoin_price_source_registry_exact_check'
        )`
    : `SELECT pg_catalog.count(*) = 12
        AND pg_catalog.count(DISTINCT source_id) = 2
        AND pg_catalog.count(DISTINCT stablecoin) = 3
        AND pg_catalog.count(DISTINCT network_id) = 2
        AND pg_catalog.bool_and(${sourceBinding('catalog_state.')}) AS valid
      FROM stablecoin_price_source_registry AS catalog_state`;
  return `SELECT (
      prior.valid AND relations.valid AND types.valid AND functions.valid
      AND triggers.valid AND privileges.valid AND catalog.valid AND constraints.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 5
        AND pg_catalog.bool_and(relation.relkind = 'r')
        AND pg_catalog.bool_and(relation_owner.rolname = ${relationOwner}) AS valid
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      INNER JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND relation.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
    ) AS relations
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 5
        AND pg_catalog.bool_and(type_state.typtype = 'c')
        AND pg_catalog.bool_and(type_owner.rolname = ${typeOwner})
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
      INNER JOIN pg_catalog.pg_roles AS type_owner ON type_owner.oid = type_state.typowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND type_state.typname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
    ) AS types
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 4
        AND pg_catalog.bool_and(function_state.proparallel = 'u')
        AND pg_catalog.bool_and(NOT function_state.proleakproof)
        AND pg_catalog.bool_and(CASE function_state.oid
          WHEN pg_catalog.to_regprocedure('${READ_PRICE_EVIDENCE}') THEN
            function_state.prosecdef AND function_state.provolatile = 's'
          WHEN pg_catalog.to_regprocedure('${RECORD_PRICE_EVIDENCE}') THEN
            function_state.prosecdef AND function_state.provolatile = 'v'
          ELSE NOT function_state.prosecdef AND function_state.provolatile = 'v'
        END)
        AND pg_catalog.bool_and(CASE function_state.oid
          WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}') THEN
            function_state.proconfig = ARRAY['search_path=pg_catalog']::text[]
          ELSE function_state.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[] END)
        AND pg_catalog.bool_and(CASE function_state.oid
          WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}') THEN
            function_state.prorettype = pg_catalog.to_regtype('trigger')
          WHEN pg_catalog.to_regprocedure('${PROJECTION_GUARD}') THEN
            function_state.prorettype = pg_catalog.to_regtype('trigger')
          ELSE function_state.prorettype = pg_catalog.to_regtype('record')
        END)
        ${ownerPredicate} AS valid
      FROM pg_catalog.pg_proc AS function_state
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function_state.pronamespace
      INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = function_state.proowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND function_state.oid IN (
          pg_catalog.to_regprocedure('${READ_PRICE_EVIDENCE}'),
          pg_catalog.to_regprocedure('${RECORD_PRICE_EVIDENCE}'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'),
          pg_catalog.to_regprocedure('${PROJECTION_GUARD}')
        )
    ) AS functions
    CROSS JOIN (
      WITH expected_triggers(relation_name, trigger_name, function_identity, trigger_type) AS (
        VALUES ${EXPECTED_TRIGGER_BINDINGS.map(
          ({ relation, trigger, functionIdentity, triggerType }) =>
            `('${relation}', '${trigger}', '${functionIdentity}', ${triggerType})`,
        ).join(',\n          ')}
      )
      SELECT pg_catalog.count(*) = 11
        AND pg_catalog.count(trigger_state.oid) = 11
        AND pg_catalog.bool_and(
          trigger_state.oid IS NOT NULL
          AND NOT trigger_state.tgisinternal
          AND trigger_state.tgenabled = 'A'
          AND trigger_state.tgrelid = pg_catalog.to_regclass(expected_triggers.relation_name)
          AND trigger_state.tgfoid =
            pg_catalog.to_regprocedure(expected_triggers.function_identity)
          AND trigger_state.tgtype = expected_triggers.trigger_type
          AND trigger_state.tgnargs = 0
          AND trigger_state.tgconstraint = 0
          AND NOT trigger_state.tgdeferrable
          AND NOT trigger_state.tginitdeferred
          AND trigger_state.tgparentid = 0
          AND trigger_state.tgoldtable IS NULL
          AND trigger_state.tgnewtable IS NULL
        )
        AND (
          SELECT pg_catalog.count(*) = 11
          FROM pg_catalog.pg_trigger AS all_trigger_state
          WHERE NOT all_trigger_state.tgisinternal
            AND all_trigger_state.tgrelid IN (
              ${TABLES.map((table) => `pg_catalog.to_regclass('${table}')`).join(',\n              ')}
            )
        ) AS valid
      FROM expected_triggers
      LEFT JOIN pg_catalog.pg_trigger AS trigger_state
        ON trigger_state.tgrelid = pg_catalog.to_regclass(expected_triggers.relation_name)
        AND trigger_state.tgname = expected_triggers.trigger_name
    ) AS triggers
    CROSS JOIN (
      SELECT (
        pg_catalog.has_function_privilege(${api}, '${READ_PRICE_EVIDENCE}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${worker}, '${READ_PRICE_EVIDENCE}', 'EXECUTE')
        AND pg_catalog.has_function_privilege(${worker}, '${RECORD_PRICE_EVIDENCE}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${RECORD_PRICE_EVIDENCE}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${legacy}, '${READ_PRICE_EVIDENCE}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${legacy}, '${RECORD_PRICE_EVIDENCE}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('public', '${READ_PRICE_EVIDENCE}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('public', '${RECORD_PRICE_EVIDENCE}', 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS guarded_table
          INNER JOIN pg_catalog.pg_namespace AS guarded_namespace
            ON guarded_namespace.oid = guarded_table.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(guarded_table.relacl, pg_catalog.acldefault('r', guarded_table.relowner))
          ) AS acl
          LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
          WHERE guarded_namespace.nspname = pg_catalog.current_schema()
            AND guarded_table.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
            AND (acl.grantee = 0 OR grantee.rolname IN (${api}, ${worker}, ${legacy}, ${migration}))
        )
      ) AS valid
    ) AS privileges
    CROSS JOIN (
      ${catalogVerifier}
    ) AS catalog
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 3
        AND pg_catalog.bool_and(constraint_state.contype = 'u')
        AND pg_catalog.bool_and(constraint_state.convalidated) AS valid
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND constraint_state.conrelid = pg_catalog.to_regclass('stablecoin_price_observations')
        AND constraint_state.conname IN (
          'stablecoin_price_observation_exact_identity_unique',
          'stablecoin_price_observation_update_unique',
          'stablecoin_price_observation_sequence_unique'
        )
    ) AS constraints`;
}

export function createStablecoinPriceEvidenceReadModelMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0021',
    description: 'create durable exact-asset stablecoin price evidence read model',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0020'],
  };
}

export const createStablecoinPriceEvidenceReadModelMigrationV0021 =
  createStablecoinPriceEvidenceReadModelMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021 =
  createStablecoinPriceEvidenceReadModelMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
