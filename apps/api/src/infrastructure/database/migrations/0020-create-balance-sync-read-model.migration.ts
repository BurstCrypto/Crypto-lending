import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createStablecoinDepegLatchMigration } from './0019-create-stablecoin-depeg-latches.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

const READ_CHECKPOINT = 'read_balance_sync_checkpoint(uuid,uuid,text)';
const RECORD_CURRENT =
  'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)';
const MARK_STALE =
  'mark_balance_sync_checkpoint_stale(uuid,uuid,text,bigint,timestamp with time zone,text)';
const REPLACE_AFTER_REORG =
  'replace_balance_sync_after_reorg(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)';
const RECORD_FINALIZED_ANCHOR =
  'record_balance_sync_finalized_anchor(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,timestamp with time zone)';
const READ_PORTFOLIO = 'read_balance_sync_portfolio(uuid,jsonb,timestamp with time zone)';
const PERSIST_OBSERVATION =
  'persist_balance_sync_observation(uuid,uuid,text,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)';
const HISTORY_GUARD = 'reject_balance_sync_history_mutation()';
const PROJECTION_GUARD = 'enforce_balance_sync_checkpoint_projection()';

const TABLES = Object.freeze([
  'balance_sync_observations',
  'balance_sync_observation_positions',
  'balance_sync_checkpoint_events',
  'balance_sync_checkpoints',
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
] as const;

const PRIOR_WORKER_FUNCTIONS = [
  'verify_wallet_revocation_state()',
  'read_aave_v3_ethereum_finalized_checkpoint(text)',
  'record_aave_v3_ethereum_finalized_checkpoint(bigint,uuid,text,text,text,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone)',
  'recover_aave_v3_ethereum_finalized_checkpoint(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,jsonb)',
  'read_stablecoin_depeg_latch(text,smallint,text,text,text,text,smallint)',
  'record_stablecoin_depeg_latch(bigint,uuid,text,text,smallint,text,text,text,smallint,timestamp with time zone,text,text,text,text,text)',
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
    throw new Error('Migration 0020 verifier anchor must occur exactly once');
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

const NETWORK_BINDING = `network_id IN ('${ETHEREUM}', '${SOLANA}')
        AND (
          (network_id = '${ETHEREUM}'
            AND chain_namespace = 'eip155' AND chain_reference = '1')
          OR (network_id = '${SOLANA}'
            AND chain_namespace = 'solana'
            AND chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        )`;

const ASSET_BINDING = `(
          (stablecoin = 'USDC' AND network_id = '${ETHEREUM}'
            AND asset_identity = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
          OR (stablecoin = 'USDT' AND network_id = '${ETHEREUM}'
            AND asset_identity = '0xdac17f958d2ee523a2206206994597c13d831ec7')
          OR (stablecoin = 'PYUSD' AND network_id = '${ETHEREUM}'
            AND asset_identity = '0x6c3ea9036406852006290770bedfcaba0e23a0e8')
          OR (stablecoin = 'USDC' AND network_id = '${SOLANA}'
            AND asset_identity = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
          OR (stablecoin = 'USDT' AND network_id = '${SOLANA}'
            AND asset_identity = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
          OR (stablecoin = 'PYUSD' AND network_id = '${SOLANA}'
            AND asset_identity = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo')
        )`;

const ACTIVE_WALLET_GUARD = `
      PERFORM 1
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
        AND (
          (requested_network_id = '${ETHEREUM}'
            AND wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
          OR (requested_network_id = '${SOLANA}'
            AND wallet.chain_namespace = 'solana'
            AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        )
      FOR UPDATE OF wallet;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'balance sync scope is not an active mainnet wallet'
          USING ERRCODE = '42501';
      END IF;`;

const OBSERVATION_VALIDATION = `
      IF requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR requested_network_id IS NULL
        OR requested_network_id NOT IN ('${ETHEREUM}', '${SOLANA}')
        OR requested_tier IS NULL OR requested_tier <> 'PROVISIONAL'
        OR requested_observation_id IS NULL
        OR requested_observation_id !~ '^[0-9a-f]{64}$'
        OR requested_source_position IS NULL
        OR requested_source_position < 0
        OR requested_source_position > 18446744073709551615
        OR pg_catalog.scale(requested_source_position) <> 0
        OR requested_source_hash IS NULL
        OR requested_source_parent_hash IS NULL
        OR requested_selector IS NULL
        OR requested_retrieved_at IS NULL
        OR requested_head_advanced_at IS NULL
        OR NOT pg_catalog.isfinite(requested_retrieved_at)
        OR NOT pg_catalog.isfinite(requested_head_advanced_at)
        OR pg_catalog.date_trunc('milliseconds', requested_retrieved_at) <> requested_retrieved_at
        OR pg_catalog.date_trunc('milliseconds', requested_head_advanced_at)
          <> requested_head_advanced_at
        OR requested_head_advanced_at > requested_succeeded_at
        OR requested_retrieved_at > requested_succeeded_at
        OR requested_source_hash = requested_source_parent_hash
        OR (
          requested_network_id = '${ETHEREUM}' AND (
            requested_selector <> 'latest'
            OR requested_source_hash !~ '^0x[0-9a-f]{64}$'
            OR requested_source_parent_hash !~ '^0x[0-9a-f]{64}$'
          )
        ) OR (
          requested_network_id = '${SOLANA}' AND (
            requested_selector <> 'confirmed'
            OR requested_source_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
            OR requested_source_parent_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          )
        )
      THEN
        RAISE EXCEPTION 'invalid balance sync observation'
          USING ERRCODE = '22023';
      END IF;

      IF requested_positions IS NULL
        OR pg_catalog.jsonb_typeof(requested_positions) <> 'array'
        OR pg_catalog.jsonb_array_length(requested_positions) <> 3
        OR pg_catalog.octet_length(requested_positions::text) > 8192
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(requested_positions) AS candidate(value)
          WHERE pg_catalog.jsonb_typeof(candidate.value) <> 'object'
            OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(candidate.value)) <> 4
            OR NOT candidate.value ?& ARRAY[
              'positionId', 'stablecoin', 'assetIdentity', 'amountAtomic'
            ]
            OR pg_catalog.jsonb_typeof(candidate.value -> 'positionId') <> 'string'
            OR pg_catalog.jsonb_typeof(candidate.value -> 'stablecoin') <> 'string'
            OR pg_catalog.jsonb_typeof(candidate.value -> 'assetIdentity') <> 'string'
            OR pg_catalog.jsonb_typeof(candidate.value -> 'amountAtomic') <> 'string'
        )
      THEN
        RAISE EXCEPTION 'invalid balance sync positions payload'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_to_recordset(requested_positions)
          AS position("positionId" text, stablecoin text, "assetIdentity" text, "amountAtomic" text)
        WHERE position."positionId" !~ '^[0-9a-f]{64}$'
          OR position."amountAtomic" !~ '^(0|[1-9][0-9]{0,77})$'
          OR pg_catalog.length(position."amountAtomic") > 78
          OR position."amountAtomic"::numeric >
            115792089237316195423570985008687907853269984665640564039457584007913129639935
          OR NOT (
            (position.stablecoin = 'USDC' AND requested_network_id = '${ETHEREUM}'
              AND position."assetIdentity" = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
            OR (position.stablecoin = 'USDT' AND requested_network_id = '${ETHEREUM}'
              AND position."assetIdentity" = '0xdac17f958d2ee523a2206206994597c13d831ec7')
            OR (position.stablecoin = 'PYUSD' AND requested_network_id = '${ETHEREUM}'
              AND position."assetIdentity" = '0x6c3ea9036406852006290770bedfcaba0e23a0e8')
            OR (position.stablecoin = 'USDC' AND requested_network_id = '${SOLANA}'
              AND position."assetIdentity" = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
            OR (position.stablecoin = 'USDT' AND requested_network_id = '${SOLANA}'
              AND position."assetIdentity" = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
            OR (position.stablecoin = 'PYUSD' AND requested_network_id = '${SOLANA}'
              AND position."assetIdentity" = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo')
          )
      ) OR (
        SELECT pg_catalog.count(DISTINCT position."positionId") = 3
          AND pg_catalog.count(DISTINCT position.stablecoin) = 3
          AND pg_catalog.count(DISTINCT position."assetIdentity") = 3
        FROM pg_catalog.jsonb_to_recordset(requested_positions)
          AS position("positionId" text, stablecoin text, "assetIdentity" text, "amountAtomic" text)
      ) IS NOT TRUE
      THEN
        RAISE EXCEPTION 'invalid balance sync position binding'
          USING ERRCODE = '22023';
      END IF;`;

function resultColumns(prefix = ''): string {
  return `${prefix}checkpoint_revision bigint,
      ${prefix}checkpoint_account_id uuid,
      ${prefix}checkpoint_wallet_id uuid,
      ${prefix}checkpoint_network_id text,
      ${prefix}checkpoint_current_observation_id text,
      ${prefix}checkpoint_freshness text,
      ${prefix}checkpoint_stale_since timestamptz,
      ${prefix}checkpoint_last_failure_code text,
      ${prefix}checkpoint_last_finalized_position numeric,
      ${prefix}checkpoint_last_finalized_hash text,
      ${prefix}checkpoint_last_finalized_parent_hash text,
      ${prefix}checkpoint_last_finalized_selector text,
      ${prefix}checkpoint_last_finalized_retrieved_at timestamptz,
      ${prefix}observation_tier text,
      ${prefix}observation_source_position numeric,
      ${prefix}observation_source_hash text,
      ${prefix}observation_source_parent_hash text,
      ${prefix}observation_selector text,
      ${prefix}observation_retrieved_at timestamptz,
      ${prefix}observation_head_advanced_at timestamptz,
      ${prefix}observation_positions jsonb`;
}

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');

  return `ALTER TABLE registered_wallets
      ADD CONSTRAINT registered_wallet_balance_sync_scope_unique
      UNIQUE (wallet_id, account_id, chain_namespace, chain_reference);

    CREATE TABLE balance_sync_observations (
      observation_id text PRIMARY KEY,
      account_id uuid NOT NULL,
      wallet_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      network_id text NOT NULL,
      registry_environment text NOT NULL DEFAULT 'MAINNET',
      registry_version smallint NOT NULL DEFAULT 1,
      registry_fingerprint_sha256 text NOT NULL DEFAULT '${REGISTRY_FINGERPRINT}',
      tier text NOT NULL,
      source_position numeric(20, 0) NOT NULL,
      source_hash text NOT NULL,
      source_parent_hash text NOT NULL,
      selector text NOT NULL,
      retrieved_at timestamptz NOT NULL,
      head_advanced_at timestamptz NOT NULL,
      accepted_at timestamptz NOT NULL,
      CONSTRAINT balance_sync_observation_scope_fk FOREIGN KEY (
        wallet_id, account_id, chain_namespace, chain_reference
      ) REFERENCES registered_wallets (
        wallet_id, account_id, chain_namespace, chain_reference
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_observation_id_check CHECK (
        observation_id ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT balance_sync_observation_network_check CHECK (${NETWORK_BINDING}),
      CONSTRAINT balance_sync_observation_registry_check CHECK (
        registry_environment = 'MAINNET'
        AND registry_version = 1
        AND registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
      ),
      CONSTRAINT balance_sync_observation_tier_check CHECK (tier = 'PROVISIONAL'),
      CONSTRAINT balance_sync_observation_source_position_check CHECK (
        source_position >= 0 AND source_position <= 18446744073709551615
      ),
      CONSTRAINT balance_sync_observation_source_check CHECK (
        source_hash <> source_parent_hash
        AND (
          (network_id = '${ETHEREUM}' AND selector = 'latest'
            AND source_hash ~ '^0x[0-9a-f]{64}$'
            AND source_parent_hash ~ '^0x[0-9a-f]{64}$')
          OR (network_id = '${SOLANA}' AND selector = 'confirmed'
            AND source_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
            AND source_parent_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$')
        )
      ),
      CONSTRAINT balance_sync_observation_time_check CHECK (
        pg_catalog.isfinite(retrieved_at)
        AND pg_catalog.isfinite(head_advanced_at)
        AND pg_catalog.isfinite(accepted_at)
        AND pg_catalog.date_trunc('milliseconds', retrieved_at) = retrieved_at
        AND pg_catalog.date_trunc('milliseconds', head_advanced_at) = head_advanced_at
        AND pg_catalog.date_trunc('milliseconds', accepted_at) = accepted_at
        AND retrieved_at <= accepted_at
        AND head_advanced_at <= accepted_at
      ),
      CONSTRAINT balance_sync_observation_network_identity_unique
        UNIQUE (observation_id, network_id),
      CONSTRAINT balance_sync_observation_scope_identity_unique UNIQUE (
        observation_id, account_id, wallet_id, chain_namespace, chain_reference, network_id
      )
    );

    CREATE TABLE balance_sync_observation_positions (
      observation_id text NOT NULL,
      network_id text NOT NULL,
      position_id text NOT NULL,
      stablecoin text NOT NULL,
      asset_identity text NOT NULL,
      amount_atomic text NOT NULL,
      CONSTRAINT balance_sync_position_observation_fk FOREIGN KEY (observation_id, network_id)
        REFERENCES balance_sync_observations (observation_id, network_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_position_pk PRIMARY KEY (observation_id, position_id),
      CONSTRAINT balance_sync_position_asset_unique
        UNIQUE (observation_id, asset_identity),
      CONSTRAINT balance_sync_position_stablecoin_unique
        UNIQUE (observation_id, stablecoin),
      CONSTRAINT balance_sync_position_id_check CHECK (position_id ~ '^[0-9a-f]{64}$'),
      CONSTRAINT balance_sync_position_amount_check CHECK (
        amount_atomic ~ '^(0|[1-9][0-9]{0,77})$'
        AND pg_catalog.length(amount_atomic) <= 78
        AND amount_atomic::numeric <=
          115792089237316195423570985008687907853269984665640564039457584007913129639935
      ),
      CONSTRAINT balance_sync_position_asset_check CHECK (${ASSET_BINDING})
    );

    CREATE TABLE balance_sync_checkpoint_events (
      event_id text PRIMARY KEY,
      account_id uuid NOT NULL,
      wallet_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      network_id text NOT NULL,
      revision bigint NOT NULL,
      expected_revision bigint,
      event_type text NOT NULL,
      transition_mode text NOT NULL,
      current_observation_id text,
      freshness text NOT NULL,
      stale_since timestamptz,
      last_failure_code text,
      last_finalized_position numeric(20, 0),
      last_finalized_hash text,
      last_finalized_parent_hash text,
      last_finalized_selector text,
      last_finalized_retrieved_at timestamptz,
      effective_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT balance_sync_event_scope_fk FOREIGN KEY (
        wallet_id, account_id, chain_namespace, chain_reference
      ) REFERENCES registered_wallets (
        wallet_id, account_id, chain_namespace, chain_reference
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_event_observation_scope_fk FOREIGN KEY (
        current_observation_id, account_id, wallet_id,
        chain_namespace, chain_reference, network_id
      ) REFERENCES balance_sync_observations (
        observation_id, account_id, wallet_id,
        chain_namespace, chain_reference, network_id
      )
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_event_id_check CHECK (event_id ~ '^[0-9a-f]{64}$'),
      CONSTRAINT balance_sync_event_network_check CHECK (${NETWORK_BINDING}),
      CONSTRAINT balance_sync_event_revision_check CHECK (
        revision >= 1
        AND (expected_revision IS NULL OR expected_revision >= 1)
        AND revision = COALESCE(expected_revision, 0) + 1
      ),
      CONSTRAINT balance_sync_event_type_check CHECK (
        (event_type = 'CURRENT_ACCEPTED'
          AND transition_mode IN ('CREATED', 'UPDATED', 'UNCHANGED'))
        OR (event_type = 'MARKED_STALE' AND transition_mode = 'STALE')
        OR (event_type = 'REORG_RECOVERED' AND transition_mode = 'REORG_RECOVERED')
        OR (event_type = 'FINALIZED_ANCHOR_RECORDED'
          AND transition_mode = 'FINALIZED_ANCHOR')
      ),
      CONSTRAINT balance_sync_event_freshness_check CHECK (
        freshness IN ('CURRENT', 'STALE', 'UNAVAILABLE', 'QUARANTINED')
        AND (
          (freshness = 'CURRENT' AND stale_since IS NULL AND last_failure_code IS NULL)
          OR (freshness <> 'CURRENT'
            AND stale_since IS NOT NULL AND last_failure_code IS NOT NULL)
        )
        AND (current_observation_id IS NOT NULL OR freshness = 'UNAVAILABLE')
      ),
      CONSTRAINT balance_sync_event_failure_check CHECK (
        last_failure_code IS NULL OR last_failure_code IN (
          'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE',
          'PROVIDER_INVALID_DATA', 'PERMANENT_PROVIDER_FAILURE',
          'REORG_RECOVERY_FAILED', 'UNCLASSIFIED_FAILURE'
        )
      ),
      CONSTRAINT balance_sync_event_finalized_shape_check CHECK (
        (last_finalized_position IS NULL
          AND last_finalized_hash IS NULL
          AND last_finalized_parent_hash IS NULL
          AND last_finalized_selector IS NULL
          AND last_finalized_retrieved_at IS NULL)
        OR (last_finalized_position BETWEEN 0 AND 18446744073709551615
          AND last_finalized_hash IS NOT NULL
          AND last_finalized_parent_hash IS NOT NULL
          AND last_finalized_hash <> last_finalized_parent_hash
          AND last_finalized_selector = 'finalized'
          AND (
            (network_id = '${ETHEREUM}'
              AND last_finalized_hash ~ '^0x[0-9a-f]{64}$'
              AND last_finalized_parent_hash ~ '^0x[0-9a-f]{64}$')
            OR (network_id = '${SOLANA}'
              AND last_finalized_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
              AND last_finalized_parent_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$')
          )
          AND last_finalized_retrieved_at IS NOT NULL
          AND pg_catalog.isfinite(last_finalized_retrieved_at)
          AND pg_catalog.date_trunc('milliseconds', last_finalized_retrieved_at)
            = last_finalized_retrieved_at)
      ),
      CONSTRAINT balance_sync_event_time_check CHECK (
        pg_catalog.isfinite(effective_at)
        AND pg_catalog.isfinite(recorded_at)
        AND pg_catalog.date_trunc('milliseconds', effective_at) = effective_at
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND effective_at <= recorded_at + interval '30 seconds'
      ),
      CONSTRAINT balance_sync_event_scope_revision_unique
        UNIQUE (account_id, wallet_id, network_id, revision)
    );

    CREATE TABLE balance_sync_checkpoints (
      account_id uuid NOT NULL,
      wallet_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      network_id text NOT NULL,
      revision bigint NOT NULL,
      current_observation_id text,
      freshness text NOT NULL,
      stale_since timestamptz,
      last_failure_code text,
      last_finalized_position numeric(20, 0),
      last_finalized_hash text,
      last_finalized_parent_hash text,
      last_finalized_selector text,
      last_finalized_retrieved_at timestamptz,
      last_event_id text NOT NULL UNIQUE,
      updated_at timestamptz NOT NULL,
      CONSTRAINT balance_sync_checkpoint_pk PRIMARY KEY (account_id, wallet_id, network_id),
      CONSTRAINT balance_sync_checkpoint_scope_fk FOREIGN KEY (
        wallet_id, account_id, chain_namespace, chain_reference
      ) REFERENCES registered_wallets (
        wallet_id, account_id, chain_namespace, chain_reference
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_checkpoint_observation_scope_fk FOREIGN KEY (
        current_observation_id, account_id, wallet_id,
        chain_namespace, chain_reference, network_id
      ) REFERENCES balance_sync_observations (
        observation_id, account_id, wallet_id,
        chain_namespace, chain_reference, network_id
      )
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_checkpoint_event_fk FOREIGN KEY (last_event_id)
        REFERENCES balance_sync_checkpoint_events (event_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_checkpoint_network_check CHECK (${NETWORK_BINDING}),
      CONSTRAINT balance_sync_checkpoint_revision_check CHECK (revision >= 1),
      CONSTRAINT balance_sync_checkpoint_freshness_check CHECK (
        freshness IN ('CURRENT', 'STALE', 'UNAVAILABLE', 'QUARANTINED')
        AND (
          (freshness = 'CURRENT' AND stale_since IS NULL AND last_failure_code IS NULL)
          OR (freshness <> 'CURRENT'
            AND stale_since IS NOT NULL AND last_failure_code IS NOT NULL)
        )
        AND (current_observation_id IS NOT NULL OR freshness = 'UNAVAILABLE')
      ),
      CONSTRAINT balance_sync_checkpoint_finalized_shape_check CHECK (
        (last_finalized_position IS NULL
          AND last_finalized_hash IS NULL
          AND last_finalized_parent_hash IS NULL
          AND last_finalized_selector IS NULL
          AND last_finalized_retrieved_at IS NULL)
        OR (last_finalized_position BETWEEN 0 AND 18446744073709551615
          AND last_finalized_hash IS NOT NULL
          AND last_finalized_parent_hash IS NOT NULL
          AND last_finalized_hash <> last_finalized_parent_hash
          AND last_finalized_selector = 'finalized'
          AND (
            (network_id = '${ETHEREUM}'
              AND last_finalized_hash ~ '^0x[0-9a-f]{64}$'
              AND last_finalized_parent_hash ~ '^0x[0-9a-f]{64}$')
            OR (network_id = '${SOLANA}'
              AND last_finalized_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
              AND last_finalized_parent_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$')
          )
          AND last_finalized_retrieved_at IS NOT NULL
          AND pg_catalog.isfinite(last_finalized_retrieved_at)
          AND pg_catalog.date_trunc('milliseconds', last_finalized_retrieved_at)
            = last_finalized_retrieved_at)
      ),
      CONSTRAINT balance_sync_checkpoint_time_check CHECK (
        pg_catalog.isfinite(updated_at)
        AND pg_catalog.date_trunc('milliseconds', updated_at) = updated_at
      )
    );

    CREATE INDEX balance_sync_observation_scope_timeline_idx
      ON balance_sync_observations (
        account_id, wallet_id, network_id, source_position DESC, observation_id
      );
    CREATE INDEX balance_sync_event_scope_timeline_idx
      ON balance_sync_checkpoint_events (
        account_id, wallet_id, network_id, revision DESC, event_id
      );

    CREATE FUNCTION ${HISTORY_GUARD}
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$
    BEGIN
      RAISE EXCEPTION 'balance sync history is append-only' USING ERRCODE = '55000';
    END;
    $function$;

    CREATE FUNCTION ${PROJECTION_GUARD}
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      event balance_sync_checkpoint_events%ROWTYPE;
      observation balance_sync_observations%ROWTYPE;
      position_count bigint;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'balance sync checkpoint deletion is forbidden' USING ERRCODE = '55000';
      END IF;
      IF TG_OP = 'UPDATE' AND (
        NEW.account_id IS DISTINCT FROM OLD.account_id
        OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
        OR NEW.chain_namespace IS DISTINCT FROM OLD.chain_namespace
        OR NEW.chain_reference IS DISTINCT FROM OLD.chain_reference
        OR NEW.network_id IS DISTINCT FROM OLD.network_id
        OR NEW.revision <> OLD.revision + 1
      ) THEN
        RAISE EXCEPTION 'invalid balance sync checkpoint transition'
          USING ERRCODE = '23514';
      END IF;

      SELECT * INTO event
      FROM balance_sync_checkpoint_events AS checkpoint_event
      WHERE checkpoint_event.event_id = NEW.last_event_id;
      IF NOT FOUND
        OR event.account_id IS DISTINCT FROM NEW.account_id
        OR event.wallet_id IS DISTINCT FROM NEW.wallet_id
        OR event.network_id IS DISTINCT FROM NEW.network_id
        OR event.chain_namespace IS DISTINCT FROM NEW.chain_namespace
        OR event.chain_reference IS DISTINCT FROM NEW.chain_reference
        OR event.revision IS DISTINCT FROM NEW.revision
        OR event.current_observation_id IS DISTINCT FROM NEW.current_observation_id
        OR event.freshness IS DISTINCT FROM NEW.freshness
        OR event.stale_since IS DISTINCT FROM NEW.stale_since
        OR event.last_failure_code IS DISTINCT FROM NEW.last_failure_code
        OR event.last_finalized_position IS DISTINCT FROM NEW.last_finalized_position
        OR event.last_finalized_hash IS DISTINCT FROM NEW.last_finalized_hash
        OR event.last_finalized_parent_hash IS DISTINCT FROM NEW.last_finalized_parent_hash
        OR event.last_finalized_selector IS DISTINCT FROM NEW.last_finalized_selector
        OR event.last_finalized_retrieved_at IS DISTINCT FROM NEW.last_finalized_retrieved_at
        OR event.recorded_at IS DISTINCT FROM NEW.updated_at
      THEN
        RAISE EXCEPTION 'balance sync projection is not bound to its event'
          USING ERRCODE = '23514';
      END IF;

      IF TG_OP = 'UPDATE' AND OLD.last_finalized_position IS NOT NULL AND (
        NEW.last_finalized_position IS NULL
        OR NEW.last_finalized_position < OLD.last_finalized_position
        OR (NEW.last_finalized_position = OLD.last_finalized_position AND (
          NEW.last_finalized_hash IS DISTINCT FROM OLD.last_finalized_hash
          OR NEW.last_finalized_parent_hash IS DISTINCT FROM OLD.last_finalized_parent_hash
          OR NEW.last_finalized_selector IS DISTINCT FROM OLD.last_finalized_selector
          OR NEW.last_finalized_retrieved_at IS DISTINCT FROM OLD.last_finalized_retrieved_at
        ))
      ) THEN
        RAISE EXCEPTION 'finalized balance sync facts are immutable'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.current_observation_id IS NOT NULL THEN
        SELECT * INTO observation
        FROM balance_sync_observations AS current_observation
        WHERE current_observation.observation_id = NEW.current_observation_id;
        SELECT pg_catalog.count(*) INTO position_count
        FROM balance_sync_observation_positions AS position
        WHERE position.observation_id = NEW.current_observation_id;
        IF observation.observation_id IS NULL
          OR observation.account_id IS DISTINCT FROM NEW.account_id
          OR observation.wallet_id IS DISTINCT FROM NEW.wallet_id
          OR observation.network_id IS DISTINCT FROM NEW.network_id
          OR position_count <> 3
        THEN
          RAISE EXCEPTION 'invalid balance sync current observation projection'
            USING ERRCODE = '23514';
        END IF;
        IF NEW.last_finalized_position IS NOT NULL AND (
          NEW.last_finalized_position > observation.source_position
          OR (NEW.last_finalized_position = observation.source_position AND (
            NEW.last_finalized_hash IS DISTINCT FROM observation.source_hash
            OR NEW.last_finalized_parent_hash
              IS DISTINCT FROM observation.source_parent_hash
          ))
          OR (observation.source_position = NEW.last_finalized_position + 1
            AND observation.source_parent_hash IS DISTINCT FROM NEW.last_finalized_hash)
        ) THEN
          RAISE EXCEPTION 'balance sync projection diverges from its finalized anchor'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER balance_sync_observations_append_only_row
      BEFORE UPDATE OR DELETE ON balance_sync_observations
      FOR EACH ROW EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_observations_append_only_truncate
      BEFORE TRUNCATE ON balance_sync_observations
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_positions_append_only_row
      BEFORE UPDATE OR DELETE ON balance_sync_observation_positions
      FOR EACH ROW EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_positions_append_only_truncate
      BEFORE TRUNCATE ON balance_sync_observation_positions
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_events_append_only_row
      BEFORE UPDATE OR DELETE ON balance_sync_checkpoint_events
      FOR EACH ROW EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_events_append_only_truncate
      BEFORE TRUNCATE ON balance_sync_checkpoint_events
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_checkpoints_no_delete
      BEFORE DELETE ON balance_sync_checkpoints
      FOR EACH ROW EXECUTE FUNCTION ${PROJECTION_GUARD};
    CREATE TRIGGER balance_sync_checkpoints_no_truncate
      BEFORE TRUNCATE ON balance_sync_checkpoints
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_checkpoint_transition
      BEFORE INSERT OR UPDATE ON balance_sync_checkpoints
      FOR EACH ROW EXECUTE FUNCTION ${PROJECTION_GUARD};

    ALTER TABLE balance_sync_observations
      ENABLE ALWAYS TRIGGER balance_sync_observations_append_only_row;
    ALTER TABLE balance_sync_observations
      ENABLE ALWAYS TRIGGER balance_sync_observations_append_only_truncate;
    ALTER TABLE balance_sync_observation_positions
      ENABLE ALWAYS TRIGGER balance_sync_positions_append_only_row;
    ALTER TABLE balance_sync_observation_positions
      ENABLE ALWAYS TRIGGER balance_sync_positions_append_only_truncate;
    ALTER TABLE balance_sync_checkpoint_events
      ENABLE ALWAYS TRIGGER balance_sync_events_append_only_row;
    ALTER TABLE balance_sync_checkpoint_events
      ENABLE ALWAYS TRIGGER balance_sync_events_append_only_truncate;
    ALTER TABLE balance_sync_checkpoints
      ENABLE ALWAYS TRIGGER balance_sync_checkpoints_no_delete;
    ALTER TABLE balance_sync_checkpoints
      ENABLE ALWAYS TRIGGER balance_sync_checkpoints_no_truncate;
    ALTER TABLE balance_sync_checkpoints
      ENABLE ALWAYS TRIGGER balance_sync_checkpoint_transition;

    CREATE FUNCTION persist_balance_sync_observation(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text,
      requested_tier text,
      requested_observation_id text,
      requested_source_position numeric,
      requested_source_hash text,
      requested_source_parent_hash text,
      requested_selector text,
      requested_retrieved_at timestamptz,
      requested_head_advanced_at timestamptz,
      requested_positions jsonb,
      requested_succeeded_at timestamptz
    ) RETURNS void
    LANGUAGE plpgsql
    VOLATILE
    PARALLEL UNSAFE
    AS $function$
    DECLARE
      expected_observation_id text;
      serialized_positions text;
      normalized_positions jsonb;
      stored_positions jsonb;
      stored_observation balance_sync_observations%ROWTYPE;
      inserted_rows bigint;
      requested_chain_namespace text;
      requested_chain_reference text;
    BEGIN
      IF requested_succeeded_at IS NULL
        OR NOT pg_catalog.isfinite(requested_succeeded_at)
        OR pg_catalog.date_trunc('milliseconds', requested_succeeded_at)
          <> requested_succeeded_at
        OR requested_succeeded_at >
          pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
            + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid balance sync success timestamp'
          USING ERRCODE = '22023';
      END IF;
      ${OBSERVATION_VALIDATION}

      requested_chain_namespace := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN 'eip155' ELSE 'solana'
      END;
      requested_chain_reference := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN '1'
        ELSE '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      END;

      SELECT '[' || pg_catalog.string_agg(
        '[' || pg_catalog.to_json(position."positionId")::text || ','
          || pg_catalog.to_json(position.stablecoin)::text || ','
          || pg_catalog.to_json(position."assetIdentity")::text || ','
          || pg_catalog.to_json(position."amountAtomic")::text || ']',
        ',' ORDER BY position."positionId", position.stablecoin,
          position."assetIdentity", position."amountAtomic"
      ) || ']',
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'positionId', position."positionId",
          'stablecoin', position.stablecoin,
          'assetIdentity', position."assetIdentity",
          'amountAtomic', position."amountAtomic"
        ) ORDER BY position."positionId", position.stablecoin,
          position."assetIdentity", position."amountAtomic"
      )
      INTO STRICT serialized_positions, normalized_positions
      FROM pg_catalog.jsonb_to_recordset(requested_positions)
        AS position("positionId" text, stablecoin text, "assetIdentity" text, "amountAtomic" text);

      expected_observation_id := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          '['
            || pg_catalog.to_json('crypto-lending:balance-sync-observation:v1'::text)::text || ','
            || pg_catalog.to_json(requested_account_id::text)::text || ','
            || pg_catalog.to_json(requested_wallet_id::text)::text || ','
            || pg_catalog.to_json(requested_network_id)::text || ','
            || pg_catalog.to_json(requested_tier)::text || ','
            || pg_catalog.to_json(requested_source_position::text)::text || ','
            || pg_catalog.to_json(requested_source_hash)::text || ','
            || pg_catalog.to_json(requested_source_parent_hash)::text || ','
            || pg_catalog.to_json(requested_selector)::text || ','
            || pg_catalog.to_json(serialized_positions)::text
          || ']',
          'UTF8'
        )),
        'hex'
      );
      IF requested_observation_id <> expected_observation_id THEN
        RAISE EXCEPTION 'balance sync observation fingerprint mismatch'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO balance_sync_observations (
        observation_id, account_id, wallet_id, chain_namespace, chain_reference,
        network_id, tier, source_position, source_hash, source_parent_hash,
        selector, retrieved_at, head_advanced_at, accepted_at
      ) VALUES (
        requested_observation_id, requested_account_id, requested_wallet_id,
        requested_chain_namespace, requested_chain_reference, requested_network_id,
        requested_tier, requested_source_position, requested_source_hash,
        requested_source_parent_hash, requested_selector, requested_retrieved_at,
        requested_head_advanced_at, requested_succeeded_at
      ) ON CONFLICT (observation_id) DO NOTHING;
      GET DIAGNOSTICS inserted_rows = ROW_COUNT;

      IF inserted_rows = 1 THEN
        INSERT INTO balance_sync_observation_positions (
          observation_id, network_id, position_id, stablecoin, asset_identity, amount_atomic
        )
        SELECT requested_observation_id, requested_network_id,
          position."positionId", position.stablecoin,
          position."assetIdentity", position."amountAtomic"
        FROM pg_catalog.jsonb_to_recordset(requested_positions)
          AS position("positionId" text, stablecoin text, "assetIdentity" text, "amountAtomic" text);
        RETURN;
      END IF;

      SELECT * INTO stored_observation
      FROM balance_sync_observations AS observation
      WHERE observation.observation_id = requested_observation_id;
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'positionId', position.position_id,
          'stablecoin', position.stablecoin,
          'assetIdentity', position.asset_identity,
          'amountAtomic', position.amount_atomic
        ) ORDER BY position.position_id, position.stablecoin,
          position.asset_identity, position.amount_atomic
      ) INTO stored_positions
      FROM balance_sync_observation_positions AS position
      WHERE position.observation_id = requested_observation_id;

      IF stored_observation.observation_id IS NULL
        OR stored_observation.account_id IS DISTINCT FROM requested_account_id
        OR stored_observation.wallet_id IS DISTINCT FROM requested_wallet_id
        OR stored_observation.network_id IS DISTINCT FROM requested_network_id
        OR stored_observation.tier IS DISTINCT FROM requested_tier
        OR stored_observation.source_position IS DISTINCT FROM requested_source_position
        OR stored_observation.source_hash IS DISTINCT FROM requested_source_hash
        OR stored_observation.source_parent_hash IS DISTINCT FROM requested_source_parent_hash
        OR stored_observation.selector IS DISTINCT FROM requested_selector
        OR stored_observation.retrieved_at IS DISTINCT FROM requested_retrieved_at
        OR stored_observation.head_advanced_at IS DISTINCT FROM requested_head_advanced_at
        OR stored_positions IS DISTINCT FROM normalized_positions
      THEN
        RAISE EXCEPTION 'balance sync observation replay conflict'
          USING ERRCODE = 'D2001';
      END IF;
    END;
    $function$;

    CREATE FUNCTION read_balance_sync_checkpoint(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    ROWS 1
    AS $function$
    BEGIN
      IF requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR requested_network_id IS NULL
        OR requested_network_id NOT IN ('${ETHEREUM}', '${SOLANA}')
      THEN
        RAISE EXCEPTION 'unsupported balance sync network' USING ERRCODE = '22023';
      END IF;
      PERFORM 1 FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
        AND ((requested_network_id = '${ETHEREUM}'
          AND wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
          OR (requested_network_id = '${SOLANA}'
          AND wallet.chain_namespace = 'solana'
          AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'))
      FOR KEY SHARE OF wallet;
      IF NOT FOUND THEN RETURN; END IF;

      RETURN QUERY
      SELECT checkpoint.revision,
        checkpoint.account_id, checkpoint.wallet_id, checkpoint.network_id,
        checkpoint.current_observation_id, checkpoint.freshness,
        checkpoint.stale_since, checkpoint.last_failure_code,
        checkpoint.last_finalized_position, checkpoint.last_finalized_hash,
        checkpoint.last_finalized_parent_hash, checkpoint.last_finalized_selector,
        checkpoint.last_finalized_retrieved_at,
        observation.tier, observation.source_position, observation.source_hash,
        observation.source_parent_hash, observation.selector, observation.retrieved_at,
        observation.head_advanced_at,
        CASE WHEN observation.observation_id IS NULL THEN NULL::jsonb ELSE (
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'positionId', position.position_id,
              'stablecoin', position.stablecoin,
              'assetIdentity', position.asset_identity,
              'amountAtomic', position.amount_atomic
            ) ORDER BY position.asset_identity
          )
          FROM balance_sync_observation_positions AS position
          WHERE position.observation_id = observation.observation_id
        ) END
      FROM balance_sync_checkpoints AS checkpoint
      LEFT JOIN balance_sync_observations AS observation
        ON observation.observation_id = checkpoint.current_observation_id
      WHERE checkpoint.account_id = requested_account_id
        AND checkpoint.wallet_id = requested_wallet_id
        AND checkpoint.network_id = requested_network_id;
    END;
    $function$;

    CREATE FUNCTION record_balance_sync_current(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text,
      requested_expected_revision bigint,
      requested_mode text,
      requested_observation_id text,
      requested_source_position numeric,
      requested_source_hash text,
      requested_source_parent_hash text,
      requested_selector text,
      requested_retrieved_at timestamptz,
      requested_head_advanced_at timestamptz,
      requested_positions jsonb,
      requested_succeeded_at timestamptz
    ) RETURNS TABLE (
      write_outcome text,
      checkpoint_revision bigint,
      checkpoint_event_id text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    ROWS 1
    AS $function$
    DECLARE
      current_checkpoint balance_sync_checkpoints%ROWTYPE;
      current_observation balance_sync_observations%ROWTYPE;
      prior_event balance_sync_checkpoint_events%ROWTYPE;
      resulting_revision bigint;
      generated_event_id text;
      requested_chain_namespace text;
      requested_chain_reference text;
    BEGIN
      IF requested_mode IS NULL OR requested_mode NOT IN ('CREATED', 'UPDATED', 'UNCHANGED') THEN
        RAISE EXCEPTION 'invalid balance sync success mode' USING ERRCODE = '22023';
      END IF;
      IF requested_expected_revision IS NOT NULL AND requested_expected_revision < 1 THEN
        RAISE EXCEPTION 'invalid balance sync expected revision' USING ERRCODE = '22023';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        requested_account_id::text || ':' || requested_wallet_id::text
          || ':' || requested_network_id,
        62001
      ));
      ${ACTIVE_WALLET_GUARD}
      PERFORM persist_balance_sync_observation(
        requested_account_id, requested_wallet_id, requested_network_id,
        'PROVISIONAL', requested_observation_id, requested_source_position,
        requested_source_hash, requested_source_parent_hash, requested_selector,
        requested_retrieved_at, requested_head_advanced_at, requested_positions,
        requested_succeeded_at
      );

      generated_event_id := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'crypto-lending:balance-sync-checkpoint-event:v1',
          requested_account_id, requested_wallet_id, requested_network_id,
          requested_expected_revision, requested_mode, requested_observation_id,
          extract(epoch FROM requested_succeeded_at) * 1000
        )::text,
        'UTF8'
      )), 'hex');
      SELECT * INTO prior_event FROM balance_sync_checkpoint_events AS event
      WHERE event.event_id = generated_event_id;
      IF FOUND THEN
        IF prior_event.account_id IS DISTINCT FROM requested_account_id
          OR prior_event.wallet_id IS DISTINCT FROM requested_wallet_id
          OR prior_event.network_id IS DISTINCT FROM requested_network_id
          OR prior_event.expected_revision IS DISTINCT FROM requested_expected_revision
          OR prior_event.transition_mode IS DISTINCT FROM requested_mode
          OR prior_event.current_observation_id IS DISTINCT FROM requested_observation_id
          OR prior_event.effective_at IS DISTINCT FROM requested_succeeded_at
        THEN
          RAISE EXCEPTION 'balance sync event replay conflict' USING ERRCODE = 'D2002';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior_event.revision, prior_event.event_id;
        RETURN;
      END IF;

      SELECT * INTO current_checkpoint
      FROM balance_sync_checkpoints AS checkpoint
      WHERE checkpoint.account_id = requested_account_id
        AND checkpoint.wallet_id = requested_wallet_id
        AND checkpoint.network_id = requested_network_id
      FOR UPDATE;

      IF NOT FOUND THEN
        IF requested_expected_revision IS NOT NULL OR requested_mode <> 'CREATED' THEN
          RAISE EXCEPTION 'balance sync checkpoint revision conflict'
            USING ERRCODE = '40001';
        END IF;
        resulting_revision := 1;
      ELSE
        IF requested_expected_revision IS DISTINCT FROM current_checkpoint.revision
          OR requested_mode = 'CREATED'
          OR current_checkpoint.current_observation_id IS NULL
        THEN
          RAISE EXCEPTION 'balance sync checkpoint revision conflict'
            USING ERRCODE = '40001';
        END IF;
        SELECT * INTO STRICT current_observation
        FROM balance_sync_observations AS observation
        WHERE observation.observation_id = current_checkpoint.current_observation_id;
        IF requested_mode = 'UNCHANGED' AND (
          requested_observation_id <> current_checkpoint.current_observation_id
          OR requested_source_position <> current_observation.source_position
          OR requested_source_hash <> current_observation.source_hash
          OR requested_source_parent_hash <> current_observation.source_parent_hash
        ) THEN
          RAISE EXCEPTION 'balance sync unchanged observation mismatch'
            USING ERRCODE = '23514';
        ELSIF requested_mode = 'UPDATED' AND (
          requested_source_position <> current_observation.source_position + 1
          OR requested_source_parent_hash <> current_observation.source_hash
          OR requested_head_advanced_at < current_observation.head_advanced_at
        ) THEN
          RAISE EXCEPTION 'balance sync source is not a monotonic append'
            USING ERRCODE = '23514';
        END IF;
        resulting_revision := current_checkpoint.revision + 1;
      END IF;

      requested_chain_namespace := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN 'eip155' ELSE 'solana'
      END;
      requested_chain_reference := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN '1'
        ELSE '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      END;
      INSERT INTO balance_sync_checkpoint_events (
        event_id, account_id, wallet_id, chain_namespace, chain_reference,
        network_id, revision, expected_revision, event_type, transition_mode,
        current_observation_id, freshness, stale_since, last_failure_code,
        last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
        last_finalized_selector, last_finalized_retrieved_at, effective_at, recorded_at
      ) VALUES (
        generated_event_id, requested_account_id, requested_wallet_id,
        requested_chain_namespace, requested_chain_reference, requested_network_id,
        resulting_revision, requested_expected_revision, 'CURRENT_ACCEPTED', requested_mode,
        requested_observation_id, 'CURRENT', NULL, NULL,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_position END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_hash END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_parent_hash END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_selector END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_retrieved_at END,
        requested_succeeded_at,
        pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
      );

      INSERT INTO balance_sync_checkpoints (
        account_id, wallet_id, chain_namespace, chain_reference, network_id,
        revision, current_observation_id, freshness, stale_since, last_failure_code,
        last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
        last_finalized_selector, last_finalized_retrieved_at, last_event_id, updated_at
      ) SELECT event.account_id, event.wallet_id, event.chain_namespace,
          event.chain_reference, event.network_id, event.revision,
          event.current_observation_id, event.freshness, event.stale_since,
          event.last_failure_code, event.last_finalized_position,
          event.last_finalized_hash, event.last_finalized_parent_hash,
          event.last_finalized_selector, event.last_finalized_retrieved_at,
          event.event_id, event.recorded_at
        FROM balance_sync_checkpoint_events AS event
        WHERE event.event_id = generated_event_id
      ON CONFLICT (account_id, wallet_id, network_id) DO UPDATE SET
        revision = EXCLUDED.revision,
        current_observation_id = EXCLUDED.current_observation_id,
        freshness = EXCLUDED.freshness,
        stale_since = EXCLUDED.stale_since,
        last_failure_code = EXCLUDED.last_failure_code,
        last_finalized_position = EXCLUDED.last_finalized_position,
        last_finalized_hash = EXCLUDED.last_finalized_hash,
        last_finalized_parent_hash = EXCLUDED.last_finalized_parent_hash,
        last_finalized_selector = EXCLUDED.last_finalized_selector,
        last_finalized_retrieved_at = EXCLUDED.last_finalized_retrieved_at,
        last_event_id = EXCLUDED.last_event_id,
        updated_at = EXCLUDED.updated_at;

      RETURN QUERY SELECT 'APPLIED'::text, resulting_revision, generated_event_id;
    END;
    $function$;

    CREATE FUNCTION mark_balance_sync_checkpoint_stale(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text,
      requested_expected_revision bigint,
      requested_failed_at timestamptz,
      requested_failure_code text
    ) RETURNS TABLE (
      write_outcome text,
      checkpoint_revision bigint,
      checkpoint_event_id text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    ROWS 1
    AS $function$
    DECLARE
      current_checkpoint balance_sync_checkpoints%ROWTYPE;
      prior_event balance_sync_checkpoint_events%ROWTYPE;
      resulting_revision bigint;
      resulting_freshness text;
      generated_event_id text;
      requested_chain_namespace text;
      requested_chain_reference text;
      recorded_at timestamptz;
    BEGIN
      recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR requested_network_id IS NULL
        OR requested_network_id NOT IN ('${ETHEREUM}', '${SOLANA}')
        OR (requested_expected_revision IS NOT NULL AND requested_expected_revision < 1)
        OR requested_failed_at IS NULL
        OR NOT pg_catalog.isfinite(requested_failed_at)
        OR pg_catalog.date_trunc('milliseconds', requested_failed_at) <> requested_failed_at
        OR requested_failed_at > recorded_at + interval '30 seconds'
        OR requested_failure_code IS NULL
        OR requested_failure_code NOT IN (
          'RATE_LIMITED', 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE',
          'PROVIDER_INVALID_DATA', 'PERMANENT_PROVIDER_FAILURE',
          'REORG_RECOVERY_FAILED', 'UNCLASSIFIED_FAILURE'
        )
      THEN
        RAISE EXCEPTION 'invalid balance sync stale transition' USING ERRCODE = '22023';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        requested_account_id::text || ':' || requested_wallet_id::text
          || ':' || requested_network_id,
        62001
      ));
      ${ACTIVE_WALLET_GUARD}
      generated_event_id := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'crypto-lending:balance-sync-checkpoint-event:v1',
          requested_account_id, requested_wallet_id, requested_network_id,
          requested_expected_revision, 'STALE', requested_failure_code,
          extract(epoch FROM requested_failed_at) * 1000
        )::text,
        'UTF8'
      )), 'hex');
      SELECT * INTO prior_event FROM balance_sync_checkpoint_events AS event
      WHERE event.event_id = generated_event_id;
      IF FOUND THEN
        IF prior_event.account_id IS DISTINCT FROM requested_account_id
          OR prior_event.wallet_id IS DISTINCT FROM requested_wallet_id
          OR prior_event.network_id IS DISTINCT FROM requested_network_id
          OR prior_event.expected_revision IS DISTINCT FROM requested_expected_revision
          OR prior_event.transition_mode <> 'STALE'
          OR prior_event.last_failure_code IS DISTINCT FROM requested_failure_code
          OR prior_event.effective_at IS DISTINCT FROM requested_failed_at
        THEN
          RAISE EXCEPTION 'balance sync stale event replay conflict' USING ERRCODE = 'D2002';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior_event.revision, prior_event.event_id;
        RETURN;
      END IF;

      SELECT * INTO current_checkpoint
      FROM balance_sync_checkpoints AS checkpoint
      WHERE checkpoint.account_id = requested_account_id
        AND checkpoint.wallet_id = requested_wallet_id
        AND checkpoint.network_id = requested_network_id
      FOR UPDATE;
      IF NOT FOUND THEN
        IF requested_expected_revision IS NOT NULL THEN
          RAISE EXCEPTION 'balance sync checkpoint revision conflict'
            USING ERRCODE = '40001';
        END IF;
        resulting_revision := 1;
        resulting_freshness := 'UNAVAILABLE';
      ELSE
        IF requested_expected_revision IS DISTINCT FROM current_checkpoint.revision THEN
          RAISE EXCEPTION 'balance sync checkpoint revision conflict'
            USING ERRCODE = '40001';
        END IF;
        resulting_revision := current_checkpoint.revision + 1;
        resulting_freshness := CASE
          WHEN current_checkpoint.current_observation_id IS NULL THEN 'UNAVAILABLE'
          ELSE 'STALE'
        END;
      END IF;
      requested_chain_namespace := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN 'eip155' ELSE 'solana'
      END;
      requested_chain_reference := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN '1'
        ELSE '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      END;

      INSERT INTO balance_sync_checkpoint_events (
        event_id, account_id, wallet_id, chain_namespace, chain_reference,
        network_id, revision, expected_revision, event_type, transition_mode,
        current_observation_id, freshness, stale_since, last_failure_code,
        last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
        last_finalized_selector, last_finalized_retrieved_at, effective_at, recorded_at
      ) VALUES (
        generated_event_id, requested_account_id, requested_wallet_id,
        requested_chain_namespace, requested_chain_reference, requested_network_id,
        resulting_revision, requested_expected_revision, 'MARKED_STALE', 'STALE',
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.current_observation_id END,
        resulting_freshness, requested_failed_at, requested_failure_code,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_position END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_hash END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_parent_hash END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_selector END,
        CASE WHEN current_checkpoint.account_id IS NULL THEN NULL
          ELSE current_checkpoint.last_finalized_retrieved_at END,
        requested_failed_at, recorded_at
      );
      INSERT INTO balance_sync_checkpoints (
        account_id, wallet_id, chain_namespace, chain_reference, network_id,
        revision, current_observation_id, freshness, stale_since, last_failure_code,
        last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
        last_finalized_selector, last_finalized_retrieved_at, last_event_id, updated_at
      ) SELECT event.account_id, event.wallet_id, event.chain_namespace,
          event.chain_reference, event.network_id, event.revision,
          event.current_observation_id, event.freshness, event.stale_since,
          event.last_failure_code, event.last_finalized_position,
          event.last_finalized_hash, event.last_finalized_parent_hash,
          event.last_finalized_selector, event.last_finalized_retrieved_at,
          event.event_id, event.recorded_at
        FROM balance_sync_checkpoint_events AS event
        WHERE event.event_id = generated_event_id
      ON CONFLICT (account_id, wallet_id, network_id) DO UPDATE SET
        revision = EXCLUDED.revision,
        current_observation_id = EXCLUDED.current_observation_id,
        freshness = EXCLUDED.freshness,
        stale_since = EXCLUDED.stale_since,
        last_failure_code = EXCLUDED.last_failure_code,
        last_finalized_position = EXCLUDED.last_finalized_position,
        last_finalized_hash = EXCLUDED.last_finalized_hash,
        last_finalized_parent_hash = EXCLUDED.last_finalized_parent_hash,
        last_finalized_selector = EXCLUDED.last_finalized_selector,
        last_finalized_retrieved_at = EXCLUDED.last_finalized_retrieved_at,
        last_event_id = EXCLUDED.last_event_id,
        updated_at = EXCLUDED.updated_at;
      RETURN QUERY SELECT 'APPLIED'::text, resulting_revision, generated_event_id;
    END;
    $function$;

    CREATE FUNCTION record_balance_sync_finalized_anchor(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text,
      requested_expected_revision bigint,
      requested_finalized_position numeric,
      requested_finalized_hash text,
      requested_finalized_parent_hash text,
      requested_finalized_selector text,
      requested_finalized_retrieved_at timestamptz,
      requested_anchored_at timestamptz
    ) RETURNS TABLE (
      write_outcome text,
      checkpoint_revision bigint,
      checkpoint_event_id text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    ROWS 1
    AS $function$
    DECLARE
      current_checkpoint balance_sync_checkpoints%ROWTYPE;
      current_observation balance_sync_observations%ROWTYPE;
      prior_event balance_sync_checkpoint_events%ROWTYPE;
      resulting_revision bigint;
      generated_event_id text;
      recorded_at timestamptz;
    BEGIN
      recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR requested_network_id IS NULL
        OR requested_network_id NOT IN ('${ETHEREUM}', '${SOLANA}')
        OR requested_expected_revision IS NULL OR requested_expected_revision < 1
        OR requested_finalized_position IS NULL
        OR requested_finalized_position < 0
        OR requested_finalized_position > 18446744073709551615
        OR pg_catalog.scale(requested_finalized_position) <> 0
        OR requested_finalized_selector IS NULL
        OR requested_finalized_selector <> 'finalized'
        OR requested_finalized_hash IS NULL
        OR requested_finalized_parent_hash IS NULL
        OR requested_finalized_hash = requested_finalized_parent_hash
        OR requested_finalized_retrieved_at IS NULL
        OR requested_anchored_at IS NULL
        OR NOT pg_catalog.isfinite(requested_finalized_retrieved_at)
        OR NOT pg_catalog.isfinite(requested_anchored_at)
        OR pg_catalog.date_trunc('milliseconds', requested_finalized_retrieved_at)
          <> requested_finalized_retrieved_at
        OR pg_catalog.date_trunc('milliseconds', requested_anchored_at) <> requested_anchored_at
        OR requested_finalized_retrieved_at > requested_anchored_at
        OR requested_anchored_at > recorded_at + interval '30 seconds'
        OR (requested_network_id = '${ETHEREUM}' AND (
          requested_finalized_hash !~ '^0x[0-9a-f]{64}$'
          OR requested_finalized_parent_hash !~ '^0x[0-9a-f]{64}$'
        ))
        OR (requested_network_id = '${SOLANA}' AND (
          requested_finalized_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          OR requested_finalized_parent_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
        ))
      THEN
        RAISE EXCEPTION 'invalid finalized balance sync anchor' USING ERRCODE = '22023';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        requested_account_id::text || ':' || requested_wallet_id::text
          || ':' || requested_network_id,
        62001
      ));
      ${ACTIVE_WALLET_GUARD}
      generated_event_id := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'crypto-lending:balance-sync-checkpoint-event:v1',
          requested_account_id, requested_wallet_id, requested_network_id,
          requested_expected_revision, 'FINALIZED_ANCHOR', requested_finalized_position,
          requested_finalized_hash, requested_finalized_parent_hash,
          extract(epoch FROM requested_finalized_retrieved_at) * 1000,
          extract(epoch FROM requested_anchored_at) * 1000
        )::text,
        'UTF8'
      )), 'hex');
      SELECT * INTO prior_event FROM balance_sync_checkpoint_events AS event
      WHERE event.event_id = generated_event_id;
      IF FOUND THEN
        IF prior_event.account_id IS DISTINCT FROM requested_account_id
          OR prior_event.wallet_id IS DISTINCT FROM requested_wallet_id
          OR prior_event.network_id IS DISTINCT FROM requested_network_id
          OR prior_event.expected_revision IS DISTINCT FROM requested_expected_revision
          OR prior_event.event_type <> 'FINALIZED_ANCHOR_RECORDED'
          OR prior_event.transition_mode <> 'FINALIZED_ANCHOR'
          OR prior_event.last_finalized_position
            IS DISTINCT FROM requested_finalized_position
          OR prior_event.last_finalized_hash IS DISTINCT FROM requested_finalized_hash
          OR prior_event.last_finalized_parent_hash
            IS DISTINCT FROM requested_finalized_parent_hash
          OR prior_event.last_finalized_selector
            IS DISTINCT FROM requested_finalized_selector
          OR prior_event.last_finalized_retrieved_at
            IS DISTINCT FROM requested_finalized_retrieved_at
          OR prior_event.effective_at IS DISTINCT FROM requested_anchored_at
        THEN
          RAISE EXCEPTION 'finalized balance sync anchor replay conflict'
            USING ERRCODE = 'D2002';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior_event.revision, prior_event.event_id;
        RETURN;
      END IF;

      SELECT * INTO current_checkpoint
      FROM balance_sync_checkpoints AS checkpoint
      WHERE checkpoint.account_id = requested_account_id
        AND checkpoint.wallet_id = requested_wallet_id
        AND checkpoint.network_id = requested_network_id
      FOR UPDATE;
      IF NOT FOUND
        OR current_checkpoint.revision IS DISTINCT FROM requested_expected_revision
        OR current_checkpoint.current_observation_id IS NULL
      THEN
        RAISE EXCEPTION 'balance sync checkpoint revision conflict'
          USING ERRCODE = '40001';
      END IF;
      SELECT * INTO STRICT current_observation
      FROM balance_sync_observations AS observation
      WHERE observation.observation_id = current_checkpoint.current_observation_id;
      IF requested_finalized_position > current_observation.source_position
        OR (requested_finalized_position = current_observation.source_position AND (
          requested_finalized_hash <> current_observation.source_hash
          OR requested_finalized_parent_hash <> current_observation.source_parent_hash
        ))
        OR (current_observation.source_position = requested_finalized_position + 1
          AND current_observation.source_parent_hash <> requested_finalized_hash)
        OR (current_checkpoint.last_finalized_position IS NOT NULL AND (
          requested_finalized_position <= current_checkpoint.last_finalized_position
        ))
      THEN
        RAISE EXCEPTION 'finalized balance sync anchor is not a monotonic ancestor'
          USING ERRCODE = '23514';
      END IF;
      resulting_revision := current_checkpoint.revision + 1;
      INSERT INTO balance_sync_checkpoint_events (
        event_id, account_id, wallet_id, chain_namespace, chain_reference,
        network_id, revision, expected_revision, event_type, transition_mode,
        current_observation_id, freshness, stale_since, last_failure_code,
        last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
        last_finalized_selector, last_finalized_retrieved_at, effective_at, recorded_at
      ) VALUES (
        generated_event_id, current_checkpoint.account_id, current_checkpoint.wallet_id,
        current_checkpoint.chain_namespace, current_checkpoint.chain_reference,
        current_checkpoint.network_id, resulting_revision, requested_expected_revision,
        'FINALIZED_ANCHOR_RECORDED', 'FINALIZED_ANCHOR',
        current_checkpoint.current_observation_id, current_checkpoint.freshness,
        current_checkpoint.stale_since, current_checkpoint.last_failure_code,
        requested_finalized_position, requested_finalized_hash,
        requested_finalized_parent_hash, requested_finalized_selector,
        requested_finalized_retrieved_at, requested_anchored_at, recorded_at
      );
      UPDATE balance_sync_checkpoints AS checkpoint SET
        revision = event.revision,
        last_finalized_position = event.last_finalized_position,
        last_finalized_hash = event.last_finalized_hash,
        last_finalized_parent_hash = event.last_finalized_parent_hash,
        last_finalized_selector = event.last_finalized_selector,
        last_finalized_retrieved_at = event.last_finalized_retrieved_at,
        last_event_id = event.event_id,
        updated_at = event.recorded_at
      FROM balance_sync_checkpoint_events AS event
      WHERE checkpoint.account_id = requested_account_id
        AND checkpoint.wallet_id = requested_wallet_id
        AND checkpoint.network_id = requested_network_id
        AND event.event_id = generated_event_id;
      RETURN QUERY SELECT 'APPLIED'::text, resulting_revision, generated_event_id;
    END;
    $function$;

    CREATE FUNCTION replace_balance_sync_after_reorg(
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_network_id text,
      requested_expected_revision bigint,
      requested_finalized_position numeric,
      requested_finalized_hash text,
      requested_finalized_parent_hash text,
      requested_finalized_selector text,
      requested_finalized_retrieved_at timestamptz,
      requested_replacement_observation_id text,
      requested_replacement_position numeric,
      requested_replacement_hash text,
      requested_replacement_parent_hash text,
      requested_replacement_selector text,
      requested_replacement_retrieved_at timestamptz,
      requested_replacement_head_advanced_at timestamptz,
      requested_replacement_positions jsonb,
      requested_recovered_at timestamptz
    ) RETURNS TABLE (
      write_outcome text,
      checkpoint_revision bigint,
      checkpoint_event_id text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    ROWS 1
    AS $function$
    DECLARE
      current_checkpoint balance_sync_checkpoints%ROWTYPE;
      prior_event balance_sync_checkpoint_events%ROWTYPE;
      resulting_revision bigint;
      generated_event_id text;
    BEGIN
      IF requested_account_id IS NULL
        OR requested_wallet_id IS NULL
        OR requested_network_id IS NULL
        OR requested_network_id NOT IN ('${ETHEREUM}', '${SOLANA}')
        OR requested_expected_revision IS NULL OR requested_expected_revision < 1
        OR requested_finalized_position IS NULL
        OR requested_finalized_position < 0
        OR requested_finalized_position > 18446744073709551615
        OR pg_catalog.scale(requested_finalized_position) <> 0
        OR requested_finalized_selector IS NULL
        OR requested_finalized_selector <> 'finalized'
        OR requested_finalized_hash IS NULL
        OR requested_finalized_parent_hash IS NULL
        OR requested_finalized_hash = requested_finalized_parent_hash
        OR requested_finalized_retrieved_at IS NULL
        OR NOT pg_catalog.isfinite(requested_finalized_retrieved_at)
        OR pg_catalog.date_trunc('milliseconds', requested_finalized_retrieved_at)
          <> requested_finalized_retrieved_at
        OR requested_recovered_at IS NULL
        OR NOT pg_catalog.isfinite(requested_recovered_at)
        OR pg_catalog.date_trunc('milliseconds', requested_recovered_at)
          <> requested_recovered_at
        OR requested_finalized_retrieved_at > requested_recovered_at
        OR (requested_network_id = '${ETHEREUM}' AND (
          requested_finalized_hash !~ '^0x[0-9a-f]{64}$'
          OR requested_finalized_parent_hash !~ '^0x[0-9a-f]{64}$'
        ))
        OR (requested_network_id = '${SOLANA}' AND (
          requested_finalized_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          OR requested_finalized_parent_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
        ))
      THEN
        RAISE EXCEPTION 'invalid finalized balance sync recovery anchor'
          USING ERRCODE = '22023';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        requested_account_id::text || ':' || requested_wallet_id::text
          || ':' || requested_network_id,
        62001
      ));
      ${ACTIVE_WALLET_GUARD}
      PERFORM persist_balance_sync_observation(
        requested_account_id, requested_wallet_id, requested_network_id,
        'PROVISIONAL', requested_replacement_observation_id,
        requested_replacement_position, requested_replacement_hash,
        requested_replacement_parent_hash, requested_replacement_selector,
        requested_replacement_retrieved_at, requested_replacement_head_advanced_at,
        requested_replacement_positions, requested_recovered_at
      );
      generated_event_id := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'crypto-lending:balance-sync-checkpoint-event:v1',
          requested_account_id, requested_wallet_id, requested_network_id,
          requested_expected_revision, 'REORG_RECOVERED',
          requested_finalized_position, requested_finalized_hash,
          requested_finalized_parent_hash, requested_replacement_observation_id,
          extract(epoch FROM requested_recovered_at) * 1000
        )::text,
        'UTF8'
      )), 'hex');
      SELECT * INTO prior_event FROM balance_sync_checkpoint_events AS event
      WHERE event.event_id = generated_event_id;
      IF FOUND THEN
        IF prior_event.account_id IS DISTINCT FROM requested_account_id
          OR prior_event.wallet_id IS DISTINCT FROM requested_wallet_id
          OR prior_event.network_id IS DISTINCT FROM requested_network_id
          OR prior_event.expected_revision IS DISTINCT FROM requested_expected_revision
          OR prior_event.transition_mode <> 'REORG_RECOVERED'
          OR prior_event.current_observation_id
            IS DISTINCT FROM requested_replacement_observation_id
          OR prior_event.last_finalized_position
            IS DISTINCT FROM requested_finalized_position
          OR prior_event.last_finalized_hash IS DISTINCT FROM requested_finalized_hash
          OR prior_event.last_finalized_parent_hash
            IS DISTINCT FROM requested_finalized_parent_hash
          OR prior_event.last_finalized_selector
            IS DISTINCT FROM requested_finalized_selector
          OR prior_event.last_finalized_retrieved_at
            IS DISTINCT FROM requested_finalized_retrieved_at
          OR prior_event.effective_at IS DISTINCT FROM requested_recovered_at
        THEN
          RAISE EXCEPTION 'balance sync recovery replay conflict' USING ERRCODE = 'D2002';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior_event.revision, prior_event.event_id;
        RETURN;
      END IF;

      SELECT * INTO current_checkpoint
      FROM balance_sync_checkpoints AS checkpoint
      WHERE checkpoint.account_id = requested_account_id
        AND checkpoint.wallet_id = requested_wallet_id
        AND checkpoint.network_id = requested_network_id
      FOR UPDATE;
      IF NOT FOUND
        OR current_checkpoint.revision IS DISTINCT FROM requested_expected_revision
        OR current_checkpoint.current_observation_id IS NULL
        OR current_checkpoint.last_finalized_position
          IS DISTINCT FROM requested_finalized_position
        OR current_checkpoint.last_finalized_hash IS DISTINCT FROM requested_finalized_hash
        OR current_checkpoint.last_finalized_parent_hash
          IS DISTINCT FROM requested_finalized_parent_hash
        OR current_checkpoint.last_finalized_selector
          IS DISTINCT FROM requested_finalized_selector
        OR current_checkpoint.last_finalized_retrieved_at
          IS DISTINCT FROM requested_finalized_retrieved_at
      THEN
        RAISE EXCEPTION 'balance sync recovery checkpoint binding mismatch'
          USING ERRCODE = '40001';
      END IF;
      IF requested_replacement_position < requested_finalized_position
        OR (requested_replacement_position = requested_finalized_position AND (
          requested_replacement_hash <> requested_finalized_hash
          OR requested_replacement_parent_hash <> requested_finalized_parent_hash
        ))
        OR (requested_replacement_position = requested_finalized_position + 1
          AND requested_replacement_parent_hash <> requested_finalized_hash)
      THEN
        RAISE EXCEPTION 'balance sync recovery is not anchored'
          USING ERRCODE = '23514';
      END IF;
      resulting_revision := current_checkpoint.revision + 1;
      INSERT INTO balance_sync_checkpoint_events (
        event_id, account_id, wallet_id, chain_namespace, chain_reference,
        network_id, revision, expected_revision, event_type, transition_mode,
        current_observation_id, freshness, stale_since, last_failure_code,
        last_finalized_position, last_finalized_hash, last_finalized_parent_hash,
        last_finalized_selector, last_finalized_retrieved_at, effective_at, recorded_at
      ) VALUES (
        generated_event_id, current_checkpoint.account_id, current_checkpoint.wallet_id,
        current_checkpoint.chain_namespace, current_checkpoint.chain_reference,
        current_checkpoint.network_id, resulting_revision, requested_expected_revision,
        'REORG_RECOVERED', 'REORG_RECOVERED', requested_replacement_observation_id,
        'CURRENT', NULL, NULL, current_checkpoint.last_finalized_position,
        current_checkpoint.last_finalized_hash,
        current_checkpoint.last_finalized_parent_hash,
        current_checkpoint.last_finalized_selector,
        current_checkpoint.last_finalized_retrieved_at,
        requested_recovered_at,
        pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
      );
      UPDATE balance_sync_checkpoints AS checkpoint SET
        revision = event.revision,
        current_observation_id = event.current_observation_id,
        freshness = event.freshness,
        stale_since = event.stale_since,
        last_failure_code = event.last_failure_code,
        last_event_id = event.event_id,
        updated_at = event.recorded_at
      FROM balance_sync_checkpoint_events AS event
      WHERE checkpoint.account_id = requested_account_id
        AND checkpoint.wallet_id = requested_wallet_id
        AND checkpoint.network_id = requested_network_id
        AND event.event_id = generated_event_id;
      RETURN QUERY SELECT 'APPLIED'::text, resulting_revision, generated_event_id;
    END;
    $function$;

    CREATE FUNCTION read_balance_sync_portfolio(
      requested_account_id uuid,
      requested_expected_wallets jsonb,
      requested_evaluated_at timestamptz
    ) RETURNS TABLE (
      target_wallet_id uuid,
      target_network_id text,
      target_status text,
      target_freshness text,
      checkpoint_revision bigint,
      current_observation_id text,
      source_position numeric,
      asset_identity text,
      amount_atomic text,
      observed_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    VOLATILE
    PARALLEL UNSAFE
    ROWS 96
    AS $function$
    DECLARE
      actual_wallets jsonb;
      normalized_expected_wallets jsonb;
      recorded_at timestamptz;
    BEGIN
      recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF requested_evaluated_at IS NULL
        OR NOT pg_catalog.isfinite(requested_evaluated_at)
        OR pg_catalog.date_trunc('milliseconds', requested_evaluated_at)
          <> requested_evaluated_at
        OR requested_evaluated_at > recorded_at + interval '30 seconds'
        OR requested_expected_wallets IS NULL
        OR pg_catalog.jsonb_typeof(requested_expected_wallets) <> 'array'
        OR pg_catalog.jsonb_array_length(requested_expected_wallets) > 32
        OR pg_catalog.octet_length(requested_expected_wallets::text) > 8192
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_array_elements(requested_expected_wallets) AS expected(value)
          WHERE pg_catalog.jsonb_typeof(expected.value) <> 'object'
            OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(expected.value)) <> 2
            OR NOT expected.value ?& ARRAY['walletId', 'networkId']
            OR pg_catalog.jsonb_typeof(expected.value -> 'walletId') <> 'string'
            OR pg_catalog.jsonb_typeof(expected.value -> 'networkId') <> 'string'
        )
      THEN
        RAISE EXCEPTION 'invalid expected portfolio wallet roster' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_to_recordset(requested_expected_wallets)
          AS expected("walletId" text, "networkId" text)
        WHERE expected."walletId" !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR expected."networkId" NOT IN ('${ETHEREUM}', '${SOLANA}')
      ) OR (
        SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT expected."walletId")
        FROM pg_catalog.jsonb_to_recordset(requested_expected_wallets)
          AS expected("walletId" text, "networkId" text)
      ) IS NOT TRUE
      THEN
        RAISE EXCEPTION 'invalid expected portfolio wallet binding' USING ERRCODE = '22023';
      END IF;

      -- Registration/revocation and the active-wallet cap use these account-scoped
      -- locks. Taking them in the same order makes the roster an exact, stable input
      -- for the complete read rather than merely two matching snapshots.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56001)
      );
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56003)
      );

      SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'walletId', expected."walletId",
          'networkId', expected."networkId"
        ) ORDER BY expected."walletId", expected."networkId"
      ), '[]'::jsonb)
      INTO STRICT normalized_expected_wallets
      FROM pg_catalog.jsonb_to_recordset(requested_expected_wallets)
        AS expected("walletId" text, "networkId" text);

      PERFORM wallet.wallet_id
      FROM registered_wallets AS wallet
      WHERE wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
        AND ((wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
          OR (wallet.chain_namespace = 'solana'
            AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'))
      ORDER BY wallet.wallet_id
      FOR SHARE OF wallet;

      SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'walletId', wallet.wallet_id::text,
          'networkId', CASE WHEN wallet.chain_namespace = 'eip155'
            THEN '${ETHEREUM}' ELSE '${SOLANA}' END
        ) ORDER BY wallet.wallet_id,
          CASE WHEN wallet.chain_namespace = 'eip155' THEN '${ETHEREUM}' ELSE '${SOLANA}' END
      ), '[]'::jsonb)
      INTO STRICT actual_wallets
      FROM registered_wallets AS wallet
      WHERE wallet.account_id = requested_account_id
        AND wallet.status = 'ACTIVE'
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${REGISTRY_FINGERPRINT}'
        AND ((wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
          OR (wallet.chain_namespace = 'solana'
            AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));

      IF actual_wallets IS DISTINCT FROM normalized_expected_wallets THEN
        RAISE EXCEPTION 'portfolio wallet roster changed during balance read'
          USING ERRCODE = '40001';
      END IF;

      RETURN QUERY
      WITH expected AS (
        SELECT candidate."walletId"::uuid AS wallet_id,
          candidate."networkId" AS network_id
        FROM pg_catalog.jsonb_to_recordset(normalized_expected_wallets)
          AS candidate("walletId" text, "networkId" text)
      ), classified AS (
        SELECT expected.wallet_id, expected.network_id,
          checkpoint.revision, checkpoint.current_observation_id,
          checkpoint.freshness, observation.source_position,
          observation.retrieved_at, observation.head_advanced_at,
          CASE
            WHEN checkpoint.current_observation_id IS NULL
              OR checkpoint.freshness IN ('UNAVAILABLE', 'QUARANTINED')
              OR observation.head_advanced_at > requested_evaluated_at
              OR requested_evaluated_at - observation.head_advanced_at > CASE
                WHEN expected.network_id = '${ETHEREUM}' THEN interval '15 minutes'
                ELSE interval '2 minutes'
              END
              THEN 'UNAVAILABLE'
            ELSE 'COMPLETE'
          END AS coverage_status,
          CASE
            WHEN checkpoint.current_observation_id IS NULL
              OR checkpoint.freshness IN ('UNAVAILABLE', 'QUARANTINED')
              OR observation.head_advanced_at > requested_evaluated_at
              OR requested_evaluated_at - observation.head_advanced_at > CASE
                WHEN expected.network_id = '${ETHEREUM}' THEN interval '15 minutes'
                ELSE interval '2 minutes'
              END
              THEN NULL::text
            WHEN checkpoint.freshness = 'CURRENT'
              AND requested_evaluated_at - observation.head_advanced_at <= CASE
                WHEN expected.network_id = '${ETHEREUM}' THEN interval '60 seconds'
                ELSE interval '15 seconds'
              END
              THEN 'CURRENT'
            ELSE 'STALE'
          END AS balance_freshness
        FROM expected
        LEFT JOIN balance_sync_checkpoints AS checkpoint
          ON checkpoint.account_id = requested_account_id
          AND checkpoint.wallet_id = expected.wallet_id
          AND checkpoint.network_id = expected.network_id
        LEFT JOIN balance_sync_observations AS observation
          ON observation.observation_id = checkpoint.current_observation_id
      )
      SELECT classified.wallet_id, classified.network_id,
        classified.coverage_status, classified.balance_freshness,
        classified.revision,
        CASE WHEN classified.coverage_status = 'COMPLETE'
          THEN classified.current_observation_id ELSE NULL END,
        CASE WHEN classified.coverage_status = 'COMPLETE'
          THEN classified.source_position ELSE NULL END,
        CASE WHEN classified.coverage_status = 'COMPLETE'
          THEN position.asset_identity ELSE NULL END,
        CASE WHEN classified.coverage_status = 'COMPLETE'
          THEN position.amount_atomic ELSE NULL END,
        CASE WHEN classified.coverage_status = 'COMPLETE'
          THEN classified.retrieved_at ELSE NULL END
      FROM classified
      LEFT JOIN balance_sync_observation_positions AS position
        ON position.observation_id = classified.current_observation_id
        AND classified.coverage_status = 'COMPLETE'
      ORDER BY classified.wallet_id, classified.network_id, position.asset_identity;
    END;
    $function$;

    DO $set_balance_sync_function_paths$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
      function_identity text;
    BEGIN
      FOREACH function_identity IN ARRAY ARRAY[
        '${READ_CHECKPOINT}', '${RECORD_CURRENT}', '${MARK_STALE}',
        '${REPLACE_AFTER_REORG}', '${RECORD_FINALIZED_ANCHOR}',
        '${READ_PORTFOLIO}', '${PERSIST_OBSERVATION}', '${PROJECTION_GUARD}'
      ] LOOP
        EXECUTE pg_catalog.format(
          'ALTER FUNCTION %I.%s SET search_path TO pg_catalog, %I, pg_temp',
          migration_schema, function_identity, migration_schema
        );
      END LOOP;
    END;
    $set_balance_sync_function_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLES.join(', ')}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${READ_CHECKPOINT}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${RECORD_CURRENT}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${MARK_STALE}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${REPLACE_AFTER_REORG}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${RECORD_FINALIZED_ANCHOR}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${READ_PORTFOLIO}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${PERSIST_OBSERVATION}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${HISTORY_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    REVOKE ALL ON FUNCTION ${PROJECTION_GUARD}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    GRANT EXECUTE ON FUNCTION ${READ_CHECKPOINT} TO ${worker};
    GRANT EXECUTE ON FUNCTION ${RECORD_CURRENT} TO ${worker};
    GRANT EXECUTE ON FUNCTION ${MARK_STALE} TO ${worker};
    GRANT EXECUTE ON FUNCTION ${REPLACE_AFTER_REORG} TO ${worker};
    GRANT EXECUTE ON FUNCTION ${READ_PORTFOLIO} TO ${api};
`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  return `DO $refuse_balance_sync_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM balance_sync_observations)
        OR EXISTS (SELECT 1 FROM balance_sync_observation_positions)
        OR EXISTS (SELECT 1 FROM balance_sync_checkpoint_events)
        OR EXISTS (SELECT 1 FROM balance_sync_checkpoints)
      THEN
        RAISE EXCEPTION 'cannot roll back balance sync read model after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_balance_sync_history_loss$;
    REVOKE EXECUTE ON FUNCTION ${READ_PORTFOLIO} FROM ${api};
    REVOKE EXECUTE ON FUNCTION ${READ_CHECKPOINT} FROM ${worker};
    REVOKE EXECUTE ON FUNCTION ${RECORD_CURRENT} FROM ${worker};
    REVOKE EXECUTE ON FUNCTION ${MARK_STALE} FROM ${worker};
    REVOKE EXECUTE ON FUNCTION ${REPLACE_AFTER_REORG} FROM ${worker};
    DROP FUNCTION ${READ_PORTFOLIO};
    DROP FUNCTION ${READ_CHECKPOINT};
    DROP FUNCTION ${REPLACE_AFTER_REORG};
    DROP FUNCTION ${RECORD_FINALIZED_ANCHOR};
    DROP FUNCTION ${MARK_STALE};
    DROP FUNCTION ${RECORD_CURRENT};
    DROP FUNCTION ${PERSIST_OBSERVATION};
    DROP TRIGGER balance_sync_checkpoint_transition ON balance_sync_checkpoints;
    DROP TRIGGER balance_sync_checkpoints_no_truncate ON balance_sync_checkpoints;
    DROP TRIGGER balance_sync_checkpoints_no_delete ON balance_sync_checkpoints;
    DROP TRIGGER balance_sync_events_append_only_truncate ON balance_sync_checkpoint_events;
    DROP TRIGGER balance_sync_events_append_only_row ON balance_sync_checkpoint_events;
    DROP TRIGGER balance_sync_positions_append_only_truncate
      ON balance_sync_observation_positions;
    DROP TRIGGER balance_sync_positions_append_only_row
      ON balance_sync_observation_positions;
    DROP TRIGGER balance_sync_observations_append_only_truncate ON balance_sync_observations;
    DROP TRIGGER balance_sync_observations_append_only_row ON balance_sync_observations;
    DROP FUNCTION ${PROJECTION_GUARD};
    DROP FUNCTION ${HISTORY_GUARD};
    DROP TABLE balance_sync_checkpoints;
    DROP TABLE balance_sync_checkpoint_events;
    DROP TABLE balance_sync_observation_positions;
    DROP TABLE balance_sync_observations;
    ALTER TABLE registered_wallets
      DROP CONSTRAINT registered_wallet_balance_sync_scope_unique;`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const priorMigration = createStablecoinDepegLatchMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!priorMigration.verifySql) throw new Error('Migration 0019 must expose verification SQL');
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
      functionAllowance(api, [...PRIOR_API_FUNCTIONS, READ_PORTFOLIO]),
    );
    prior = replaceExactlyOnce(
      prior,
      functionAllowance(worker, PRIOR_WORKER_FUNCTIONS),
      functionAllowance(worker, [
        ...PRIOR_WORKER_FUNCTIONS,
        READ_CHECKPOINT,
        RECORD_CURRENT,
        MARK_STALE,
        REPLACE_AFTER_REORG,
      ]),
    );
  }
  const ownerPredicate = cumulative
    ? `AND pg_catalog.bool_and(function_owner.rolname = ${owner})`
    : '';
  const relationOwner = cumulative ? owner : 'relation_owner.rolname';
  const typeOwner = cumulative ? owner : 'type_owner.rolname';
  const functionIdentities = [
    READ_CHECKPOINT,
    RECORD_CURRENT,
    MARK_STALE,
    REPLACE_AFTER_REORG,
    RECORD_FINALIZED_ANCHOR,
    READ_PORTFOLIO,
    PERSIST_OBSERVATION,
    HISTORY_GUARD,
    PROJECTION_GUARD,
  ];

  return `SELECT (
      prior.valid AND relations.valid AND types.valid AND functions.valid
      AND triggers.valid AND privileges.valid AND scope_constraint.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 4
        AND pg_catalog.bool_and(relation.relkind = 'r')
        AND pg_catalog.bool_and(relation_owner.rolname = ${relationOwner}) AS valid
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      INNER JOIN pg_catalog.pg_roles AS relation_owner
        ON relation_owner.oid = relation.relowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND relation.relname IN (${TABLES.map((table) => `'${table}'`).join(', ')})
    ) AS relations
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 4
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
      SELECT pg_catalog.count(*) = 9
        AND pg_catalog.bool_and(function_state.provolatile = 'v')
        AND pg_catalog.bool_and(function_state.proparallel = 'u')
        AND pg_catalog.bool_and(NOT function_state.proleakproof)
        AND pg_catalog.bool_and(
          CASE WHEN function_state.proname IN (
            'persist_balance_sync_observation',
            'reject_balance_sync_history_mutation',
            'enforce_balance_sync_checkpoint_projection'
          ) THEN NOT function_state.prosecdef ELSE function_state.prosecdef END
        )
        AND pg_catalog.bool_and(
          CASE WHEN function_state.proname = 'reject_balance_sync_history_mutation'
            THEN function_state.proconfig = ARRAY['search_path=pg_catalog']::text[]
            ELSE function_state.proconfig = ARRAY[
              'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
            ]::text[] END
        )
        ${ownerPredicate} AS valid
      FROM pg_catalog.pg_proc AS function_state
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function_state.pronamespace
      INNER JOIN pg_catalog.pg_roles AS function_owner
        ON function_owner.oid = function_state.proowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND function_state.oid IN (
          ${functionIdentities.map((identityValue) => `pg_catalog.to_regprocedure('${identityValue}')`).join(',\n          ')}
        )
    ) AS functions
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 9
        AND pg_catalog.bool_and(trigger_state.oid IS NOT NULL
          AND NOT trigger_state.tgisinternal
          AND trigger_state.tgenabled = 'A'
          AND trigger_state.tgfoid = expected.function_oid
          AND trigger_state.tgtype = expected.trigger_type) AS valid
      FROM (VALUES
        ('balance_sync_observations_append_only_row',
          pg_catalog.to_regclass('balance_sync_observations'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'), 27::smallint),
        ('balance_sync_observations_append_only_truncate',
          pg_catalog.to_regclass('balance_sync_observations'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'), 34::smallint),
        ('balance_sync_positions_append_only_row',
          pg_catalog.to_regclass('balance_sync_observation_positions'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'), 27::smallint),
        ('balance_sync_positions_append_only_truncate',
          pg_catalog.to_regclass('balance_sync_observation_positions'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'), 34::smallint),
        ('balance_sync_events_append_only_row',
          pg_catalog.to_regclass('balance_sync_checkpoint_events'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'), 27::smallint),
        ('balance_sync_events_append_only_truncate',
          pg_catalog.to_regclass('balance_sync_checkpoint_events'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'), 34::smallint),
        ('balance_sync_checkpoints_no_delete',
          pg_catalog.to_regclass('balance_sync_checkpoints'),
          pg_catalog.to_regprocedure('${PROJECTION_GUARD}'), 11::smallint),
        ('balance_sync_checkpoints_no_truncate',
          pg_catalog.to_regclass('balance_sync_checkpoints'),
          pg_catalog.to_regprocedure('${HISTORY_GUARD}'), 34::smallint),
        ('balance_sync_checkpoint_transition',
          pg_catalog.to_regclass('balance_sync_checkpoints'),
          pg_catalog.to_regprocedure('${PROJECTION_GUARD}'), 23::smallint)
      ) AS expected(trigger_name, relation_oid, function_oid, trigger_type)
      LEFT JOIN pg_catalog.pg_trigger AS trigger_state
        ON trigger_state.tgname = expected.trigger_name
        AND trigger_state.tgrelid = expected.relation_oid
    ) AS triggers
    CROSS JOIN (
      SELECT (
        pg_catalog.has_function_privilege(${worker}, '${READ_CHECKPOINT}', 'EXECUTE')
        AND pg_catalog.has_function_privilege(${worker}, '${RECORD_CURRENT}', 'EXECUTE')
        AND pg_catalog.has_function_privilege(${worker}, '${MARK_STALE}', 'EXECUTE')
        AND pg_catalog.has_function_privilege(${worker}, '${REPLACE_AFTER_REORG}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${READ_CHECKPOINT}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${RECORD_CURRENT}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${MARK_STALE}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${REPLACE_AFTER_REORG}', 'EXECUTE')
        AND pg_catalog.has_function_privilege(${api}, '${READ_PORTFOLIO}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${worker}, '${READ_PORTFOLIO}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${RECORD_FINALIZED_ANCHOR}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${worker}, '${RECORD_FINALIZED_ANCHOR}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${api}, '${PERSIST_OBSERVATION}', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege(${worker}, '${PERSIST_OBSERVATION}', 'EXECUTE')
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
      SELECT pg_catalog.count(*) = 3
        AND pg_catalog.bool_and(constraint_state.convalidated) AS valid
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND (
          (constraint_state.conrelid = pg_catalog.to_regclass('registered_wallets')
            AND constraint_state.conname = 'registered_wallet_balance_sync_scope_unique'
            AND constraint_state.contype = 'u')
          OR (constraint_state.conrelid = pg_catalog.to_regclass('balance_sync_checkpoint_events')
            AND constraint_state.conname = 'balance_sync_event_observation_scope_fk'
            AND constraint_state.contype = 'f')
          OR (constraint_state.conrelid = pg_catalog.to_regclass('balance_sync_checkpoints')
            AND constraint_state.conname = 'balance_sync_checkpoint_observation_scope_fk'
            AND constraint_state.contype = 'f')
        )
    ) AS scope_constraint`;
}

export function createBalanceSyncReadModelMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0020',
    description: 'create durable Ethereum and Solana balance sync read model',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0019'],
  };
}

export const createBalanceSyncReadModelMigrationV0020 = createBalanceSyncReadModelMigration(
  PRODUCTION_DATABASE_PRINCIPALS,
);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createBalanceSyncReadModelTestSchemaMigrationV0020 =
  createBalanceSyncReadModelMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
