import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createProviderPositionChainAnchorEvidenceMigration } from './0029-create-provider-position-chain-anchor-evidence.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const EVIDENCE_TABLE = 'provider_position_chain_anchor_evidence';
const DEADLINE_TABLE = 'provider_position_chain_anchor_record_deadlines';
const DEADLINE_MANIFEST =
  'crypto-lending:provider-position-chain-anchor-record-deadline:v1;no-wallet-pii;append-only';
const DEADLINE_USE = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_DEADLINE_ONLY';
const EVIDENCE_USE = 'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_ONLY';
const DEADLINE_FINGERPRINT_DOMAIN =
  'crypto-lending:provider-position-chain-anchor-record-deadline-binding:v1';
const HISTORY_GUARD = 'reject_provider_position_chain_anchor_history_mutation()';
const DEADLINE_FINGERPRINT =
  'provider_position_chain_anchor_record_deadline_fingerprint(text,timestamp with time zone,timestamp with time zone)';
const DEADLINE_ROW_VALID =
  'provider_position_chain_anchor_record_deadline_row_valid(text,text,smallint,text,boolean,boolean,timestamp with time zone,timestamp with time zone)';
const GUARDED_RECORD_EVIDENCE =
  'record_provider_position_chain_anchor_evidence_guarded(text,text,text,text,text,jsonb,jsonb,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone,jsonb,timestamp with time zone,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text)';

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
    throw new Error('Migration 0030 predecessor verifier anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

const DEADLINE_FINGERPRINT_BODY = `
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          '${DEADLINE_FINGERPRINT_DOMAIN}',
          requested_evidence_fingerprint_sha256,
          pg_catalog.to_char(
            requested_producer_deadline_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          pg_catalog.to_char(
            requested_evidence_recorded_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )::text,
        'UTF8'
      )),
      'hex'
    );
    `;

const DEADLINE_ROW_VALID_BODY = `
    SELECT requested_deadline_binding_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_deadline_binding_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
      AND requested_evidence_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      AND requested_deadline_binding_version = 1
      AND requested_deadline_binding_use = '${DEADLINE_USE}'
      AND requested_may_authorize_financial_action = false
      AND requested_may_persist = false
      AND pg_catalog.isfinite(requested_producer_deadline_at)
      AND pg_catalog.isfinite(requested_evidence_recorded_at)
      AND pg_catalog.date_trunc('milliseconds', requested_producer_deadline_at)
        = requested_producer_deadline_at
      AND pg_catalog.date_trunc('milliseconds', requested_evidence_recorded_at)
        = requested_evidence_recorded_at
      AND requested_evidence_recorded_at < requested_producer_deadline_at
      AND requested_deadline_binding_sha256 =
        provider_position_chain_anchor_record_deadline_fingerprint(
          requested_evidence_fingerprint_sha256,
          requested_producer_deadline_at,
          requested_evidence_recorded_at
        );
    `;

const DEADLINE_ROW_VALID_CALL = `provider_position_chain_anchor_record_deadline_row_valid(
        deadline_binding_sha256,
        evidence_fingerprint_sha256,
        deadline_binding_version,
        deadline_binding_use,
        may_authorize_financial_action,
        may_persist,
        producer_deadline_at,
        evidence_recorded_at
      )`;
const DEADLINE_ROW_VALID_CALL_COMPACT = `${DEADLINE_ROW_VALID_CALL} IS TRUE`.replace(/\s+/gu, '');

const GUARDED_RECORD_EVIDENCE_BODY = `
    DECLARE
      prior provider_position_chain_anchor_evidence%ROWTYPE;
      deadline_binding provider_position_chain_anchor_record_deadlines%ROWTYPE;
      requested_read_binding_fingerprint text;
      requested_fingerprint text;
      database_started_at timestamptz;
      database_completed_at timestamptz;
      stored_outcome text;
      stored_fingerprint text;
      stored_recorded_at timestamptz;
      deadline_rejected boolean := false;
    BEGIN
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR requested_operation NOT IN ('RECORD', 'RECONCILE_ONLY')
        OR NOT pg_catalog.isfinite(requested_producer_deadline_at)
        OR pg_catalog.date_trunc('milliseconds', requested_producer_deadline_at)
          <> requested_producer_deadline_at
        OR requested_assessed_at >= requested_producer_deadline_at
        OR requested_producer_deadline_at > requested_assessed_at + interval '30 seconds'
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor record deadline request'
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
      IF provider_position_chain_anchor_evidence_row_valid(
        requested_fingerprint,
        requested_read_binding_fingerprint,
        1::smallint,
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
        requested_assessed_at
      ) IS DISTINCT FROM true
      THEN
        RAISE EXCEPTION 'invalid provider position chain anchor record deadline evidence'
          USING ERRCODE = '22023';
      END IF;

      -- RECORD and RECONCILE_ONLY serialize on migration 0029's exact binding.
      -- Under READ COMMITTED, a reconciliation that waits here observes the
      -- first transaction's committed row or its definitive absence.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_read_binding_fingerprint, 56029)
      );
      database_started_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );

      SELECT evidence.* INTO prior
      FROM provider_position_chain_anchor_evidence AS evidence
      WHERE evidence.read_binding_fingerprint_sha256 = requested_read_binding_fingerprint;
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
          RAISE EXCEPTION 'provider position chain anchor evidence reconciliation conflict'
            USING ERRCODE = '23505';
        END IF;

        SELECT deadline.* INTO deadline_binding
        FROM provider_position_chain_anchor_record_deadlines AS deadline
        WHERE deadline.evidence_fingerprint_sha256 = prior.evidence_fingerprint_sha256;
        IF NOT FOUND
          OR deadline_binding.deadline_binding_version IS DISTINCT FROM 1
          OR deadline_binding.deadline_binding_use IS DISTINCT FROM '${DEADLINE_USE}'
          OR deadline_binding.may_authorize_financial_action IS DISTINCT FROM false
          OR deadline_binding.may_persist IS DISTINCT FROM false
          OR deadline_binding.evidence_recorded_at IS DISTINCT FROM prior.recorded_at
          OR deadline_binding.producer_deadline_at
            IS DISTINCT FROM requested_producer_deadline_at
          OR deadline_binding.deadline_binding_sha256 IS DISTINCT FROM
            provider_position_chain_anchor_record_deadline_fingerprint(
              prior.evidence_fingerprint_sha256,
              requested_producer_deadline_at,
              prior.recorded_at
            )
          OR prior.recorded_at >= requested_producer_deadline_at
        THEN
          RETURN QUERY SELECT 'DEADLINE_VIOLATION'::text,
            prior.evidence_fingerprint_sha256, prior.recorded_at;
          RETURN;
        END IF;

        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior.evidence_fingerprint_sha256, prior.recorded_at;
        RETURN;
      END IF;

      IF requested_operation = 'RECONCILE_ONLY'
        OR database_started_at >= requested_producer_deadline_at
      THEN
        RETURN QUERY SELECT 'NOT_RECORDED'::text, NULL::text, NULL::timestamptz;
        RETURN;
      END IF;

      -- The exception block is a PostgreSQL subtransaction. Raising only the
      -- private deadline sentinel rolls back both the migration-0029 insert
      -- and its deadline binding before NOT_RECORDED is returned.
      BEGIN
        SELECT evidence.record_outcome,
          evidence.recorded_evidence_fingerprint_sha256,
          evidence.evidence_recorded_at
        INTO STRICT stored_outcome, stored_fingerprint, stored_recorded_at
        FROM record_provider_position_chain_anchor_evidence(
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
        ) AS evidence;

        IF stored_outcome <> 'RECORDED'
          OR stored_fingerprint IS DISTINCT FROM requested_fingerprint
          OR stored_recorded_at IS NULL
        THEN
          RAISE EXCEPTION 'invalid provider position chain anchor record result'
            USING ERRCODE = '21000';
        END IF;

        IF stored_recorded_at < requested_assessed_at
          OR stored_recorded_at >= requested_producer_deadline_at
        THEN
          RAISE EXCEPTION 'provider position chain anchor producer deadline exceeded'
            USING ERRCODE = 'P0030';
        END IF;

        INSERT INTO provider_position_chain_anchor_record_deadlines (
          deadline_binding_sha256,
          evidence_fingerprint_sha256,
          deadline_binding_version,
          deadline_binding_use,
          may_authorize_financial_action,
          may_persist,
          producer_deadline_at,
          evidence_recorded_at
        ) VALUES (
          provider_position_chain_anchor_record_deadline_fingerprint(
            stored_fingerprint,
            requested_producer_deadline_at,
            stored_recorded_at
          ),
          stored_fingerprint,
          1,
          '${DEADLINE_USE}',
          false,
          false,
          requested_producer_deadline_at,
          stored_recorded_at
        );

        database_completed_at := pg_catalog.date_trunc(
          'milliseconds', pg_catalog.clock_timestamp()
        );
        IF database_completed_at < database_started_at
          OR database_completed_at < stored_recorded_at
          OR database_completed_at >= requested_producer_deadline_at
        THEN
          RAISE EXCEPTION 'provider position chain anchor producer deadline exceeded'
            USING ERRCODE = 'P0030';
        END IF;
      EXCEPTION
        WHEN SQLSTATE 'P0030' THEN
          deadline_rejected := true;
      END;

      IF deadline_rejected THEN
        RETURN QUERY SELECT 'NOT_RECORDED'::text, NULL::text, NULL::timestamptz;
        RETURN;
      END IF;

      RETURN QUERY SELECT stored_outcome, stored_fingerprint, stored_recorded_at;
    END;
    `;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `LOCK TABLE ${EVIDENCE_TABLE} IN ACCESS EXCLUSIVE MODE;
    DO $refuse_unbound_provider_position_chain_anchor_history$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${EVIDENCE_TABLE}) THEN
        RAISE EXCEPTION
          'cannot install provider position chain anchor deadlines after evidence exists'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_unbound_provider_position_chain_anchor_history$;

    CREATE FUNCTION provider_position_chain_anchor_record_deadline_fingerprint(
      requested_evidence_fingerprint_sha256 text,
      requested_producer_deadline_at timestamptz,
      requested_evidence_recorded_at timestamptz
    ) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${DEADLINE_FINGERPRINT_BODY}$function$;

    CREATE FUNCTION provider_position_chain_anchor_record_deadline_row_valid(
      requested_deadline_binding_sha256 text,
      requested_evidence_fingerprint_sha256 text,
      requested_deadline_binding_version smallint,
      requested_deadline_binding_use text,
      requested_may_authorize_financial_action boolean,
      requested_may_persist boolean,
      requested_producer_deadline_at timestamptz,
      requested_evidence_recorded_at timestamptz
    ) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${DEADLINE_ROW_VALID_BODY}$function$;

    CREATE TABLE ${DEADLINE_TABLE} (
      deadline_binding_sha256 text NOT NULL,
      evidence_fingerprint_sha256 text NOT NULL,
      deadline_binding_version smallint NOT NULL,
      deadline_binding_use text NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      may_persist boolean NOT NULL,
      producer_deadline_at timestamptz NOT NULL,
      evidence_recorded_at timestamptz NOT NULL,
      CONSTRAINT ${DEADLINE_TABLE}_pkey PRIMARY KEY (evidence_fingerprint_sha256),
      CONSTRAINT provider_position_chain_anchor_deadline_binding_unique
        UNIQUE (deadline_binding_sha256),
      CONSTRAINT provider_position_chain_anchor_deadline_evidence_fk
        FOREIGN KEY (evidence_fingerprint_sha256)
        REFERENCES ${EVIDENCE_TABLE} (evidence_fingerprint_sha256)
        ON UPDATE NO ACTION ON DELETE NO ACTION,
      CONSTRAINT provider_position_chain_anchor_deadline_valid_check CHECK (
        ${DEADLINE_ROW_VALID_CALL} IS TRUE
      )
    );
    COMMENT ON TABLE ${DEADLINE_TABLE} IS '${DEADLINE_MANIFEST}';

    ALTER TABLE ${EVIDENCE_TABLE}
      ADD CONSTRAINT provider_position_chain_anchor_evidence_deadline_fk
      FOREIGN KEY (evidence_fingerprint_sha256)
      REFERENCES ${DEADLINE_TABLE} (evidence_fingerprint_sha256)
      ON UPDATE NO ACTION ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED;

    CREATE TRIGGER provider_position_chain_anchor_deadline_append_only_row
      BEFORE UPDATE OR DELETE ON ${DEADLINE_TABLE}
      FOR EACH ROW EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    CREATE TRIGGER provider_position_chain_anchor_deadline_append_only_truncate
      BEFORE TRUNCATE ON ${DEADLINE_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_provider_position_chain_anchor_history_mutation();
    ALTER TABLE ${DEADLINE_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_deadline_append_only_row;
    ALTER TABLE ${DEADLINE_TABLE} ENABLE ALWAYS TRIGGER
      provider_position_chain_anchor_deadline_append_only_truncate;

    CREATE FUNCTION record_provider_position_chain_anchor_evidence_guarded(
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
      requested_source_pair_approval_expires_at timestamptz,
      requested_producer_deadline_at timestamptz,
      requested_operation text
    ) RETURNS TABLE (
      record_outcome text,
      recorded_evidence_fingerprint_sha256 text,
      evidence_recorded_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${GUARDED_RECORD_EVIDENCE_BODY}$function$;

    DO $set_provider_position_chain_anchor_deadline_path$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${DEADLINE_ROW_VALID} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${GUARDED_RECORD_EVIDENCE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $set_provider_position_chain_anchor_deadline_path$;

    REVOKE ALL PRIVILEGES ON TABLE ${DEADLINE_TABLE} FROM ${guardedRoles};
    REVOKE ALL PRIVILEGES ON TYPE ${DEADLINE_TABLE} FROM ${guardedRoles};
    REVOKE ALL ON FUNCTION ${DEADLINE_FINGERPRINT} FROM ${guardedRoles};
    REVOKE ALL ON FUNCTION ${DEADLINE_ROW_VALID} FROM ${guardedRoles};
    REVOKE ALL ON FUNCTION ${GUARDED_RECORD_EVIDENCE} FROM ${guardedRoles};`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `LOCK TABLE ${EVIDENCE_TABLE},
      provider_position_chain_anchor_control_events,
      ${DEADLINE_TABLE}
      IN ACCESS EXCLUSIVE MODE;
    DO $refuse_provider_position_chain_anchor_deadline_downgrade$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${EVIDENCE_TABLE})
        OR EXISTS (SELECT 1 FROM provider_position_chain_anchor_control_events)
        OR EXISTS (SELECT 1 FROM ${DEADLINE_TABLE})
      THEN
        RAISE EXCEPTION
          'cannot roll back provider position chain anchor deadlines after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_provider_position_chain_anchor_deadline_downgrade$;
    REVOKE ALL ON FUNCTION ${GUARDED_RECORD_EVIDENCE} FROM ${guardedRoles};
    REVOKE ALL ON FUNCTION ${DEADLINE_ROW_VALID} FROM ${guardedRoles};
    REVOKE ALL ON FUNCTION ${DEADLINE_FINGERPRINT} FROM ${guardedRoles};
    DROP FUNCTION ${GUARDED_RECORD_EVIDENCE};
    ALTER TABLE ${EVIDENCE_TABLE}
      DROP CONSTRAINT provider_position_chain_anchor_evidence_deadline_fk;
    DROP TRIGGER provider_position_chain_anchor_deadline_append_only_truncate
      ON ${DEADLINE_TABLE};
    DROP TRIGGER provider_position_chain_anchor_deadline_append_only_row
      ON ${DEADLINE_TABLE};
    DROP TABLE ${DEADLINE_TABLE};
    DROP FUNCTION ${DEADLINE_ROW_VALID};
    DROP FUNCTION ${DEADLINE_FINGERPRINT};`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createProviderPositionChainAnchorEvidenceMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0029 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const guardedRoles = [api, worker, legacy, balance, migration, "'public'"];
  const priorConstraintCount = `SELECT pg_catalog.count(*) = 6
          FROM pg_catalog.pg_constraint AS all_constraint
          WHERE all_constraint.conrelid IN (
            pg_catalog.to_regclass('${EVIDENCE_TABLE}'),
            pg_catalog.to_regclass('provider_position_chain_anchor_control_events')
          )`;
  const prior = replaceExactlyOnce(
    previous.verifySql,
    priorConstraintCount,
    priorConstraintCount.replace('count(*) = 6', 'count(*) = 7'),
  );
  const deadlineFingerprintSha256 = sourceSha256(DEADLINE_FINGERPRINT_BODY);
  const deadlineRowValidSha256 = sourceSha256(DEADLINE_ROW_VALID_BODY);
  const guardedRecordSha256 = sourceSha256(GUARDED_RECORD_EVIDENCE_BODY);

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
          AND NOT relation.relrowsecurity
          AND NOT relation.relforcerowsecurity
          AND relation_owner.rolname = ${cumulative ? owner : 'relation_owner.rolname'}
          AND pg_catalog.obj_description(relation.oid, 'pg_class') = '${DEADLINE_MANIFEST}'
        ) AS valid
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      INNER JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND relation.relname = '${DEADLINE_TABLE}'
    ) AS relation
    CROSS JOIN (
      WITH expected(ordinal, column_name, data_type) AS (VALUES
        (1, 'deadline_binding_sha256', 'text'),
        (2, 'evidence_fingerprint_sha256', 'text'),
        (3, 'deadline_binding_version', 'smallint'),
        (4, 'deadline_binding_use', 'text'),
        (5, 'may_authorize_financial_action', 'boolean'),
        (6, 'may_persist', 'boolean'),
        (7, 'producer_deadline_at', 'timestamp with time zone'),
        (8, 'evidence_recorded_at', 'timestamp with time zone')
      )
      SELECT pg_catalog.count(*) = 8
        AND pg_catalog.count(attribute.attnum) = 8
        AND pg_catalog.bool_and(
          attribute.attnum = expected.ordinal
          AND attribute.attname = expected.column_name
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            = expected.data_type
          AND attribute.attnotnull
          AND attribute_default.adbin IS NULL
        )
        AND (
          SELECT pg_catalog.count(*) = 8
          FROM pg_catalog.pg_attribute AS all_attribute
          WHERE all_attribute.attrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND all_attribute.attnum > 0
            AND NOT all_attribute.attisdropped
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS guarded_attribute
          WHERE guarded_attribute.attrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND guarded_attribute.attnum > 0
            AND NOT guarded_attribute.attisdropped
            AND guarded_attribute.attname ~ '(account|wallet|address|cipher|digest)'
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
        AND attribute.attnum = expected.ordinal
      LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
        ON attribute_default.adrelid = attribute.attrelid
        AND attribute_default.adnum = attribute.attnum
    ) AS columns
    CROSS JOIN (
      WITH expected(index_name, indexed_column, primary_index) AS (VALUES
        ('${DEADLINE_TABLE}_pkey', 2::smallint, true),
        ('provider_position_chain_anchor_deadline_binding_unique', 1::smallint, false)
      )
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.count(index_state.indexrelid) = 2
        AND pg_catalog.bool_and(
          index_relation.relkind = 'i'
          AND index_relation.relpersistence = 'p'
          AND access_method.amname = 'btree'
          AND index_state.indisvalid
          AND index_state.indisready
          AND index_state.indislive
          AND index_state.indisunique
          AND index_state.indisprimary = expected.primary_index
          AND NOT index_state.indisexclusion
          AND index_state.indimmediate
          AND NOT index_state.indisclustered
          AND NOT index_state.indcheckxmin
          AND NOT index_state.indisreplident
          AND NOT index_state.indnullsnotdistinct
          AND index_state.indexprs IS NULL
          AND index_state.indpred IS NULL
          AND index_state.indnkeyatts = 1
          AND index_state.indnatts = 1
          AND index_state.indkey = CASE expected.indexed_column
            WHEN 1 THEN '1'::pg_catalog.int2vector
            WHEN 2 THEN '2'::pg_catalog.int2vector
            ELSE NULL
          END
          AND index_state.indoption = '0'::pg_catalog.int2vector
          AND operator_class.opcname = 'text_ops'
        )
        AND (
          SELECT pg_catalog.count(*) = 2
          FROM pg_catalog.pg_index AS all_index
          WHERE all_index.indrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.relname = expected.index_name
        AND index_relation.relnamespace =
          pg_catalog.to_regnamespace(pg_catalog.current_schema())
      LEFT JOIN pg_catalog.pg_index AS index_state
        ON index_state.indexrelid = index_relation.oid
        AND index_state.indrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
      LEFT JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      LEFT JOIN pg_catalog.pg_opclass AS operator_class
        ON operator_class.oid = index_state.indclass[0]
    ) AS indexes
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 5
        AND pg_catalog.bool_and(constraint_state.convalidated)
        AND pg_catalog.bool_and(CASE constraint_state.conname
          WHEN '${DEADLINE_TABLE}_pkey' THEN
            constraint_state.contype = 'p'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.conkey = ARRAY[2]::smallint[]
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
          WHEN 'provider_position_chain_anchor_deadline_binding_unique' THEN
            constraint_state.contype = 'u'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.conkey = ARRAY[1]::smallint[]
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
          WHEN 'provider_position_chain_anchor_deadline_evidence_fk' THEN
            constraint_state.contype = 'f'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.confrelid = pg_catalog.to_regclass('${EVIDENCE_TABLE}')
              AND constraint_state.conkey = ARRAY[2]::smallint[]
              AND constraint_state.confkey = ARRAY[1]::smallint[]
              AND constraint_state.confmatchtype = 's'
              AND constraint_state.confupdtype = 'a'
              AND constraint_state.confdeltype = 'a'
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
          WHEN 'provider_position_chain_anchor_evidence_deadline_fk' THEN
            constraint_state.contype = 'f'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${EVIDENCE_TABLE}')
              AND constraint_state.confrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.conkey = ARRAY[1]::smallint[]
              AND constraint_state.confkey = ARRAY[2]::smallint[]
              AND constraint_state.confmatchtype = 's'
              AND constraint_state.confupdtype = 'a'
              AND constraint_state.confdeltype = 'a'
              AND constraint_state.condeferrable
              AND constraint_state.condeferred
          WHEN 'provider_position_chain_anchor_deadline_valid_check' THEN
            constraint_state.contype = 'c'
              AND constraint_state.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
              AND constraint_state.conkey = ARRAY[1,2,3,4,5,6,7,8]::smallint[]
              AND NOT constraint_state.condeferrable
              AND NOT constraint_state.condeferred
              AND pg_catalog.regexp_replace(
                pg_catalog.pg_get_expr(
                  constraint_state.conbin, constraint_state.conrelid, false
                ),
                '[[:space:]]+', '', 'g'
              ) IN (
                '${DEADLINE_ROW_VALID_CALL_COMPACT}',
                '(${DEADLINE_ROW_VALID_CALL_COMPACT})'
              )
              AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_depend AS dependency
                WHERE dependency.classid = pg_catalog.to_regclass('pg_catalog.pg_constraint')
                  AND dependency.objid = constraint_state.oid
                  AND dependency.refclassid = pg_catalog.to_regclass('pg_catalog.pg_proc')
                  AND dependency.refobjid = pg_catalog.to_regprocedure('${DEADLINE_ROW_VALID}')
                  AND dependency.deptype = 'n'
              )
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_constraint AS constraint_state
      WHERE constraint_state.connamespace =
          pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND constraint_state.conname IN (
          '${DEADLINE_TABLE}_pkey',
          'provider_position_chain_anchor_deadline_binding_unique',
          'provider_position_chain_anchor_deadline_evidence_fk',
          'provider_position_chain_anchor_evidence_deadline_fk',
          'provider_position_chain_anchor_deadline_valid_check'
        )
        AND (
          SELECT pg_catalog.count(*) = 4
          FROM pg_catalog.pg_constraint AS all_constraint
          WHERE all_constraint.conrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
        )
        AND (
          SELECT pg_catalog.count(*) = 1
          FROM pg_catalog.pg_constraint AS reverse_constraint
          WHERE reverse_constraint.conrelid = pg_catalog.to_regclass('${EVIDENCE_TABLE}')
            AND reverse_constraint.conname =
              'provider_position_chain_anchor_evidence_deadline_fk'
        )
    ) AS constraints
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 3
        AND pg_catalog.bool_and(
          function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT procedure.proleakproof
          AND procedure.prokind = 'f'
          AND procedure.pronargdefaults = 0
          AND procedure.provariadic = 0
          AND procedure.proisstrict
          AND CASE procedure.oid
            WHEN pg_catalog.to_regprocedure('${DEADLINE_FINGERPRINT}') THEN
              NOT procedure.prosecdef
                AND procedure.provolatile = 'i'
                AND procedure.proparallel = 's'
                AND NOT procedure.proretset
                AND procedure.pronargs = 3
                AND language.lanname = 'sql'
                AND procedure.prorettype = pg_catalog.to_regtype('text')
                AND pg_catalog.pg_get_function_result(procedure.oid) = 'text'
                AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
                AND pg_catalog.encode(
                  pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
                  'hex'
                ) = '${deadlineFingerprintSha256}'
            WHEN pg_catalog.to_regprocedure('${DEADLINE_ROW_VALID}') THEN
              NOT procedure.prosecdef
                AND procedure.provolatile = 'i'
                AND procedure.proparallel = 's'
                AND NOT procedure.proretset
                AND procedure.pronargs = 8
                AND language.lanname = 'sql'
                AND procedure.prorettype = pg_catalog.to_regtype('boolean')
                AND pg_catalog.pg_get_function_result(procedure.oid) = 'boolean'
                AND procedure.proconfig = ARRAY[
                  'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
                ]::text[]
                AND pg_catalog.encode(
                  pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
                  'hex'
                ) = '${deadlineRowValidSha256}'
            WHEN pg_catalog.to_regprocedure('${GUARDED_RECORD_EVIDENCE}') THEN
              procedure.prosecdef
                AND procedure.provolatile = 'v'
                AND procedure.proparallel = 'u'
                AND procedure.proretset
                AND procedure.pronargs = 25
                AND language.lanname = 'plpgsql'
                AND procedure.prorettype = pg_catalog.to_regtype('record')
                AND pg_catalog.pg_get_function_result(procedure.oid) =
                  'TABLE(record_outcome text, recorded_evidence_fingerprint_sha256 text, evidence_recorded_at timestamp with time zone)'
                AND procedure.proconfig = ARRAY[
                  'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
                ]::text[]
                AND pg_catalog.encode(
                  pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
                  'hex'
                ) = '${guardedRecordSha256}'
            ELSE false
          END
        ) AS valid
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
      INNER JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      WHERE procedure.pronamespace =
          pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND procedure.oid IN (
          pg_catalog.to_regprocedure('${DEADLINE_FINGERPRINT}'),
          pg_catalog.to_regprocedure('${DEADLINE_ROW_VALID}'),
          pg_catalog.to_regprocedure('${GUARDED_RECORD_EVIDENCE}')
        )
    ) AS functions
    CROSS JOIN (
      WITH expected(trigger_name, trigger_type) AS (VALUES
        ('provider_position_chain_anchor_deadline_append_only_row', 27::smallint),
        ('provider_position_chain_anchor_deadline_append_only_truncate', 34::smallint)
      )
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.count(trigger.oid) = 2
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
        )
        AND (
          SELECT pg_catalog.count(*) = 2
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND NOT all_trigger.tgisinternal
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgrelid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
        AND trigger.tgname = expected.trigger_name
    ) AS triggers
    CROSS JOIN (
      SELECT
        ${guardedRoles
          .map(
            (role) =>
              `NOT pg_catalog.has_table_privilege(${role}, '${DEADLINE_TABLE}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
          )
          .join('\n        AND ')}
        AND ${guardedRoles
          .map((role) => `NOT pg_catalog.has_type_privilege(${role}, '${DEADLINE_TABLE}', 'USAGE')`)
          .join('\n        AND ')}
        AND ${guardedRoles
          .flatMap((role) =>
            [DEADLINE_FINGERPRINT, DEADLINE_ROW_VALID, GUARDED_RECORD_EVIDENCE].map(
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
          WHERE guarded_table.oid = pg_catalog.to_regclass('${DEADLINE_TABLE}')
            AND acl.grantee <> guarded_table.relowner
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_type AS guarded_type
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(guarded_type.typacl, pg_catalog.acldefault('T', guarded_type.typowner))
          ) AS acl
          WHERE guarded_type.oid = pg_catalog.to_regtype('${DEADLINE_TABLE}')
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
            pg_catalog.to_regprocedure('${DEADLINE_FINGERPRINT}'),
            pg_catalog.to_regprocedure('${DEADLINE_ROW_VALID}'),
            pg_catalog.to_regprocedure('${GUARDED_RECORD_EVIDENCE}')
          )
            AND acl.grantee <> guarded_function.proowner
        ) AS valid
    ) AS privileges`;
}

export function createProviderPositionChainAnchorRecordDeadlineMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0030',
    description:
      'bind dormant provider position chain anchor records to producer deadlines and reconciliation',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0029'],
  };
}

export const enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030 =
  createProviderPositionChainAnchorRecordDeadlineMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030 =
  createProviderPositionChainAnchorRecordDeadlineMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
