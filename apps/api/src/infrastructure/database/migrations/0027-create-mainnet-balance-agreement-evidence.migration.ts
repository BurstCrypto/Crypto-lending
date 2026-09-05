import { createHash } from 'node:crypto';

import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createStablecoinIngestionAuthoritySuspensionMigration } from './0026-suspend-stablecoin-ingestion-authority.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const TABLE = 'balance_sync_financial_agreement_evidence';
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const AGREEMENT_USE = 'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY';
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

const EXACT_KEYS = 'mainnet_balance_agreement_has_exact_keys(jsonb,text[])';
const CANONICAL_JSON = 'canonical_mainnet_balance_agreement_json(jsonb)';
const VALIDATE_ENVELOPE =
  'mainnet_balance_financial_agreement_envelope_valid(jsonb,timestamp with time zone)';
const HISTORY_GUARD = 'reject_mainnet_balance_financial_agreement_mutation()';
const RECORD_AGREEMENT = 'record_balance_sync_financial_agreement_evidence(jsonb)';
const ALL_FUNCTIONS = Object.freeze([
  EXACT_KEYS,
  CANONICAL_JSON,
  VALIDATE_ENVELOPE,
  HISTORY_GUARD,
  RECORD_AGREEMENT,
] as const);

const TABLE_MANIFEST =
  'crypto-lending:mainnet-balance-two-source-agreement-evidence:v1;owner-only;append-only;runtime-unregistered';

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

const EXACT_KEYS_BODY = `
    SELECT pg_catalog.jsonb_typeof(requested_value) = 'object'
      AND (
        SELECT pg_catalog.array_agg(object_key ORDER BY object_key COLLATE "C")
        FROM pg_catalog.jsonb_object_keys(requested_value) AS key_set(object_key)
      ) = (
        SELECT pg_catalog.array_agg(expected_key ORDER BY expected_key COLLATE "C")
        FROM pg_catalog.unnest(expected_keys) AS expected(expected_key)
      );`;

const CANONICAL_JSON_BODY = `
    DECLARE
      result text;
      object_key text;
      child jsonb;
    BEGIN
      CASE pg_catalog.jsonb_typeof(requested_value)
        WHEN 'object' THEN
          result := '{';
          FOR object_key, child IN
            SELECT entry.key, entry.value
            FROM pg_catalog.jsonb_each(requested_value) AS entry
            ORDER BY entry.key COLLATE "C"
          LOOP
            IF result <> '{' THEN result := result || ','; END IF;
            result := result || pg_catalog.to_jsonb(object_key)::text || ':'
              || canonical_mainnet_balance_agreement_json(child);
          END LOOP;
          RETURN result || '}';
        WHEN 'array' THEN
          result := '[';
          FOR child IN
            SELECT entry.value
            FROM pg_catalog.jsonb_array_elements(requested_value)
              WITH ORDINALITY AS entry(value, element_index)
            ORDER BY entry.element_index
          LOOP
            IF result <> '[' THEN result := result || ','; END IF;
            result := result || canonical_mainnet_balance_agreement_json(child);
          END LOOP;
          RETURN result || ']';
        ELSE
          RETURN requested_value::text;
      END CASE;
    END;`;

const VALIDATE_ENVELOPE_BODY = `
    DECLARE
      observation jsonb;
      source_point jsonb;
      positions jsonb;
      agreement jsonb;
      checkpoint jsonb;
      attestations jsonb;
      primary_attestation jsonb;
      corroborating_attestation jsonb;
      primary_source jsonb;
      corroborating_source jsonb;
      position_entry jsonb;
      network_id text;
      account_id text;
      wallet_id text;
      source_position text;
      source_hash text;
      source_parent_hash text;
      primary_retrieved_at timestamptz;
      corroborating_retrieved_at timestamptz;
      source_retrieved_at timestamptz;
      approval_expires_at timestamptz;
      later_retrieved_at text;
      expected_asset text;
      expected_stablecoin text;
      expected_position_id text;
      computed_position_set_fingerprint text;
      computed_candidate_fingerprint text;
      computed_agreement_fingerprint text;
      position_index integer;
    BEGIN
      IF requested_recorded_at IS NULL
        OR NOT pg_catalog.isfinite(requested_recorded_at)
        OR pg_catalog.date_trunc('milliseconds', requested_recorded_at) <> requested_recorded_at
        OR pg_catalog.octet_length(requested_envelope::text) > 32768
        OR pg_catalog.jsonb_path_exists(
          requested_envelope,
          'strict $.** ? (@ == null)'::pg_catalog.jsonpath
        )
        OR NOT mainnet_balance_agreement_has_exact_keys(
          requested_envelope,
          ARRAY[
            'accountId', 'agreement', 'agreementVersion', 'mayAuthorizeFinancialAction',
            'mayPersist', 'observationCandidate', 'use'
          ]::text[]
        )
        OR requested_envelope -> 'agreementVersion' <> '1'::jsonb
        OR requested_envelope ->> 'use' <> '${AGREEMENT_USE}'
        OR requested_envelope -> 'mayPersist' <> 'false'::jsonb
        OR requested_envelope -> 'mayAuthorizeFinancialAction' <> 'false'::jsonb
        OR requested_envelope ->> 'accountId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN
        RETURN false;
      END IF;

      account_id := requested_envelope ->> 'accountId';
      observation := requested_envelope -> 'observationCandidate';
      IF NOT mainnet_balance_agreement_has_exact_keys(
          observation, ARRAY['networkId', 'positions', 'source', 'tier', 'walletId']::text[]
        )
        OR observation ->> 'walletId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR observation ->> 'networkId' NOT IN ('${ETHEREUM}', '${SOLANA}')
        OR observation ->> 'tier' <> 'FINANCIAL'
      THEN
        RETURN false;
      END IF;
      wallet_id := observation ->> 'walletId';
      network_id := observation ->> 'networkId';

      source_point := observation -> 'source';
      IF NOT mainnet_balance_agreement_has_exact_keys(
          source_point,
          ARRAY['hash', 'identityValidated', 'parentHash', 'position', 'retrievedAt', 'selector']::text[]
        )
        OR source_point ->> 'position' !~ '^[1-9][0-9]{0,19}$'
        OR (source_point ->> 'position')::numeric > 18446744073709551615
        OR source_point ->> 'selector' <> 'finalized'
        OR source_point -> 'identityValidated' <> 'true'::jsonb
        OR source_point ->> 'retrievedAt'
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      THEN
        RETURN false;
      END IF;
      source_position := source_point ->> 'position';
      source_hash := source_point ->> 'hash';
      source_parent_hash := source_point ->> 'parentHash';
      IF source_hash = source_parent_hash OR (
        network_id = '${ETHEREUM}' AND (
          source_hash !~ '^0x[0-9a-f]{64}$'
          OR source_parent_hash !~ '^0x[0-9a-f]{64}$'
          OR source_hash = '0x' || pg_catalog.repeat('0', 64)
          OR source_parent_hash = '0x' || pg_catalog.repeat('0', 64)
        )
      ) OR (
        network_id = '${SOLANA}' AND (
          source_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          OR source_parent_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          OR source_hash = '11111111111111111111111111111111'
          OR source_parent_hash = '11111111111111111111111111111111'
        )
      ) THEN
        RETURN false;
      END IF;

      positions := observation -> 'positions';
      IF pg_catalog.jsonb_typeof(positions) <> 'array'
        OR pg_catalog.jsonb_array_length(positions) <> 3
      THEN
        RETURN false;
      END IF;
      FOR position_index IN 0..2 LOOP
        position_entry := positions -> position_index;
        IF NOT mainnet_balance_agreement_has_exact_keys(
            position_entry,
            ARRAY['amountAtomic', 'assetIdentity', 'positionId', 'stablecoin']::text[]
          )
          OR pg_catalog.jsonb_typeof(position_entry -> 'amountAtomic') <> 'string'
          OR position_entry ->> 'amountAtomic' !~ '^(0|[1-9][0-9]{0,77})$'
          OR pg_catalog.length(position_entry ->> 'amountAtomic') > 78
          OR (position_entry ->> 'amountAtomic')::numeric > ${MAX_UINT256}
        THEN
          RETURN false;
        END IF;
        IF network_id = '${ETHEREUM}' THEN
          expected_asset := (ARRAY[
            '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xdac17f958d2ee523a2206206994597c13d831ec7'
          ]::text[])[position_index + 1];
          expected_stablecoin := (ARRAY['PYUSD', 'USDC', 'USDT']::text[])[position_index + 1];
        ELSE
          expected_asset := (ARRAY[
            '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
          ]::text[])[position_index + 1];
          expected_stablecoin := (ARRAY['PYUSD', 'USDC', 'USDT']::text[])[position_index + 1];
        END IF;
        expected_position_id := pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(
            'crypto-lending:balance-position:v1' || pg_catalog.chr(0)
              || account_id || pg_catalog.chr(0) || wallet_id || pg_catalog.chr(0)
              || network_id || pg_catalog.chr(0) || expected_asset,
            'UTF8'
          )),
          'hex'
        );
        IF position_entry ->> 'assetIdentity' <> expected_asset
          OR position_entry ->> 'stablecoin' <> expected_stablecoin
          OR position_entry ->> 'positionId' <> expected_position_id
        THEN
          RETURN false;
        END IF;
      END LOOP;

      computed_position_set_fingerprint := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          canonical_mainnet_balance_agreement_json(pg_catalog.jsonb_build_array(
            'crypto-lending:mainnet-balance-position-set:v1',
            network_id,
            (
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
                entry.value ->> 'positionId', entry.value ->> 'stablecoin',
                entry.value ->> 'assetIdentity', entry.value ->> 'amountAtomic'
              ) ORDER BY entry.element_index)
              FROM pg_catalog.jsonb_array_elements(positions)
                WITH ORDINALITY AS entry(value, element_index)
            )
          )),
          'UTF8'
        )),
        'hex'
      );

      agreement := requested_envelope -> 'agreement';
      IF NOT mainnet_balance_agreement_has_exact_keys(
          agreement,
          ARRAY[
            'agreementFingerprintSha256', 'checkpoint', 'positionSetFingerprintSha256',
            'sourceAttestations', 'sourcePairApprovalExpiresAt',
            'sourcePairRegistryFingerprintSha256', 'status'
          ]::text[]
        )
        OR agreement ->> 'status' <> 'EXACT_CHECKPOINT_AND_BALANCE_MATCH'
        OR agreement ->> 'sourcePairRegistryFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR agreement ->> 'sourcePairRegistryFingerprintSha256' = pg_catalog.repeat('0', 64)
        OR agreement ->> 'sourcePairApprovalExpiresAt'
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        OR agreement ->> 'positionSetFingerprintSha256' = pg_catalog.repeat('0', 64)
        OR agreement ->> 'positionSetFingerprintSha256' <> computed_position_set_fingerprint
        OR agreement ->> 'agreementFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR agreement ->> 'agreementFingerprintSha256' = pg_catalog.repeat('0', 64)
      THEN
        RETURN false;
      END IF;

      checkpoint := agreement -> 'checkpoint';
      IF network_id = '${ETHEREUM}' THEN
        IF NOT mainnet_balance_agreement_has_exact_keys(
            checkpoint, ARRAY['blockHash', 'blockNumber', 'kind', 'parentBlockHash']::text[]
          )
          OR checkpoint ->> 'kind' <> 'ETHEREUM_BLOCK'
          OR checkpoint ->> 'blockNumber' <> source_position
          OR checkpoint ->> 'blockHash' <> source_hash
          OR checkpoint ->> 'parentBlockHash' <> source_parent_hash
        THEN
          RETURN false;
        END IF;
      ELSE
        IF NOT mainnet_balance_agreement_has_exact_keys(
            checkpoint,
            ARRAY[
              'blockIdentity', 'finalizedSlot', 'kind', 'parentBlockIdentity',
              'rootDerivation', 'rootSlot'
            ]::text[]
          )
          OR checkpoint ->> 'kind' <> 'SOLANA_ROOTED_BLOCK'
          OR checkpoint ->> 'finalizedSlot' <> source_position
          OR checkpoint ->> 'rootSlot' <> source_position
          OR checkpoint ->> 'rootDerivation' <> 'FINALIZED_SLOT_IS_ROOTED'
          OR checkpoint ->> 'blockIdentity' <> source_hash
          OR checkpoint ->> 'parentBlockIdentity' <> source_parent_hash
        THEN
          RETURN false;
        END IF;
      END IF;

      attestations := agreement -> 'sourceAttestations';
      IF pg_catalog.jsonb_typeof(attestations) <> 'array'
        OR pg_catalog.jsonb_array_length(attestations) <> 2
      THEN
        RETURN false;
      END IF;
      primary_attestation := attestations -> 0;
      corroborating_attestation := attestations -> 1;
      IF NOT mainnet_balance_agreement_has_exact_keys(
          primary_attestation,
          ARRAY[
            'candidateFingerprintSha256', 'chainIdentityValidated', 'checkpoint', 'networkId',
            'positionSetFingerprintSha256', 'retrievedAt', 'role', 'sourceFamilyId', 'sourceId'
          ]::text[]
        )
        OR NOT mainnet_balance_agreement_has_exact_keys(
          corroborating_attestation,
          ARRAY[
            'candidateFingerprintSha256', 'chainIdentityValidated', 'checkpoint', 'networkId',
            'positionSetFingerprintSha256', 'retrievedAt', 'role', 'sourceFamilyId', 'sourceId'
          ]::text[]
        )
        OR primary_attestation ->> 'role' <> 'PRIMARY'
        OR corroborating_attestation ->> 'role' <> 'CORROBORATING'
        OR primary_attestation ->> 'networkId' <> network_id
        OR corroborating_attestation ->> 'networkId' <> network_id
        OR primary_attestation -> 'chainIdentityValidated' <> 'true'::jsonb
        OR corroborating_attestation -> 'chainIdentityValidated' <> 'true'::jsonb
        OR primary_attestation -> 'checkpoint' <> checkpoint
        OR corroborating_attestation -> 'checkpoint' <> checkpoint
        OR primary_attestation ->> 'positionSetFingerprintSha256'
          <> computed_position_set_fingerprint
        OR corroborating_attestation ->> 'positionSetFingerprintSha256'
          <> computed_position_set_fingerprint
        OR primary_attestation ->> 'sourceFamilyId'
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR corroborating_attestation ->> 'sourceFamilyId'
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR primary_attestation ->> 'sourceId'
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR corroborating_attestation ->> 'sourceId'
          !~ '^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$'
        OR primary_attestation ->> 'sourceFamilyId'
          = corroborating_attestation ->> 'sourceFamilyId'
        OR primary_attestation ->> 'sourceId' = corroborating_attestation ->> 'sourceId'
        OR primary_attestation ->> 'retrievedAt'
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        OR corroborating_attestation ->> 'retrievedAt'
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        OR primary_attestation ->> 'candidateFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR primary_attestation ->> 'candidateFingerprintSha256' = pg_catalog.repeat('0', 64)
        OR corroborating_attestation ->> 'candidateFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR corroborating_attestation ->> 'candidateFingerprintSha256'
          = pg_catalog.repeat('0', 64)
      THEN
        RETURN false;
      END IF;

      primary_retrieved_at := (primary_attestation ->> 'retrievedAt')::timestamptz;
      corroborating_retrieved_at := (corroborating_attestation ->> 'retrievedAt')::timestamptz;
      source_retrieved_at := (source_point ->> 'retrievedAt')::timestamptz;
      approval_expires_at := (agreement ->> 'sourcePairApprovalExpiresAt')::timestamptz;
      IF NOT pg_catalog.isfinite(primary_retrieved_at)
        OR NOT pg_catalog.isfinite(corroborating_retrieved_at)
        OR NOT pg_catalog.isfinite(source_retrieved_at)
        OR NOT pg_catalog.isfinite(approval_expires_at)
        OR pg_catalog.date_trunc('milliseconds', primary_retrieved_at) <> primary_retrieved_at
        OR pg_catalog.date_trunc('milliseconds', corroborating_retrieved_at)
          <> corroborating_retrieved_at
        OR pg_catalog.date_trunc('milliseconds', source_retrieved_at) <> source_retrieved_at
        OR pg_catalog.date_trunc('milliseconds', approval_expires_at) <> approval_expires_at
        OR pg_catalog.to_char(
          source_retrieved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) <> source_point ->> 'retrievedAt'
        OR pg_catalog.to_char(
          primary_retrieved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) <> primary_attestation ->> 'retrievedAt'
        OR pg_catalog.to_char(
          corroborating_retrieved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) <> corroborating_attestation ->> 'retrievedAt'
        OR pg_catalog.to_char(
          approval_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) <> agreement ->> 'sourcePairApprovalExpiresAt'
        OR primary_retrieved_at > requested_recorded_at
        OR corroborating_retrieved_at > requested_recorded_at
        OR approval_expires_at <= requested_recorded_at
        OR primary_retrieved_at >= approval_expires_at
        OR corroborating_retrieved_at >= approval_expires_at
        OR requested_recorded_at - primary_retrieved_at > CASE
          WHEN network_id = '${ETHEREUM}' THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END
        OR requested_recorded_at - corroborating_retrieved_at > CASE
          WHEN network_id = '${ETHEREUM}' THEN interval '60 seconds'
          ELSE interval '15 seconds'
        END
      THEN
        RETURN false;
      END IF;
      later_retrieved_at := CASE
        WHEN primary_retrieved_at >= corroborating_retrieved_at
          THEN primary_attestation ->> 'retrievedAt'
        ELSE corroborating_attestation ->> 'retrievedAt'
      END;
      IF source_point ->> 'retrievedAt' <> later_retrieved_at
        OR (source_point ->> 'retrievedAt')::timestamptz
          <> GREATEST(primary_retrieved_at, corroborating_retrieved_at)
      THEN
        RETURN false;
      END IF;

      primary_source := source_point || pg_catalog.jsonb_build_object(
        'retrievedAt', primary_attestation ->> 'retrievedAt'
      );
      corroborating_source := source_point || pg_catalog.jsonb_build_object(
        'retrievedAt', corroborating_attestation ->> 'retrievedAt'
      );
      computed_candidate_fingerprint := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          canonical_mainnet_balance_agreement_json(pg_catalog.jsonb_build_array(
            'crypto-lending:mainnet-balance-source-attestation:v1',
            agreement ->> 'sourcePairRegistryFingerprintSha256', account_id, wallet_id,
            network_id, 'FINANCIAL', 'finalized', 'PRIMARY',
            primary_attestation ->> 'sourceFamilyId', primary_attestation ->> 'sourceId',
            primary_source, checkpoint, computed_position_set_fingerprint
          )),
          'UTF8'
        )),
        'hex'
      );
      IF primary_attestation ->> 'candidateFingerprintSha256'
        <> computed_candidate_fingerprint
      THEN
        RETURN false;
      END IF;

      computed_candidate_fingerprint := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          canonical_mainnet_balance_agreement_json(pg_catalog.jsonb_build_array(
            'crypto-lending:mainnet-balance-source-attestation:v1',
            agreement ->> 'sourcePairRegistryFingerprintSha256', account_id, wallet_id,
            network_id, 'FINANCIAL', 'finalized', 'CORROBORATING',
            corroborating_attestation ->> 'sourceFamilyId',
            corroborating_attestation ->> 'sourceId', corroborating_source, checkpoint,
            computed_position_set_fingerprint
          )),
          'UTF8'
        )),
        'hex'
      );
      IF corroborating_attestation ->> 'candidateFingerprintSha256'
        <> computed_candidate_fingerprint
      THEN
        RETURN false;
      END IF;

      computed_agreement_fingerprint := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(
          canonical_mainnet_balance_agreement_json(pg_catalog.jsonb_build_array(
            'crypto-lending:mainnet-balance-two-source-agreement:v1', 1,
            '${AGREEMENT_USE}', account_id, observation,
            agreement - 'agreementFingerprintSha256'
          )),
          'UTF8'
        )),
        'hex'
      );
      RETURN agreement ->> 'agreementFingerprintSha256' = computed_agreement_fingerprint;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;`;

const HISTORY_GUARD_BODY = `
    BEGIN
      RAISE EXCEPTION 'mainnet balance financial agreement evidence is append-only'
        USING ERRCODE = '55000';
    END;`;

const RECORD_AGREEMENT_BODY = `
    DECLARE
      prior balance_sync_financial_agreement_evidence%ROWTYPE;
      observation jsonb;
      source_point jsonb;
      agreement jsonb;
      primary_attestation jsonb;
      corroborating_attestation jsonb;
      requested_fingerprint text;
      requested_account_id uuid;
      requested_wallet_id uuid;
      requested_network_id text;
      requested_chain_namespace text;
      requested_chain_reference text;
      database_recorded_at timestamptz;
    BEGIN
      IF pg_catalog.jsonb_typeof(requested_envelope) <> 'object'
        OR pg_catalog.octet_length(requested_envelope::text) > 32768
        OR requested_envelope -> 'agreement' ->> 'agreementFingerprintSha256'
          !~ '^[0-9a-f]{64}$'
      THEN
        RAISE EXCEPTION 'invalid mainnet balance financial agreement evidence'
          USING ERRCODE = '22023';
      END IF;
      requested_fingerprint :=
        requested_envelope -> 'agreement' ->> 'agreementFingerprintSha256';

      SELECT evidence.* INTO prior
      FROM balance_sync_financial_agreement_evidence AS evidence
      WHERE evidence.agreement_fingerprint_sha256 = requested_fingerprint
      FOR UPDATE;
      IF FOUND THEN
        IF prior.agreement_envelope <> requested_envelope THEN
          RAISE EXCEPTION 'mainnet balance financial agreement replay conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior.agreement_fingerprint_sha256, prior.recorded_at;
        RETURN;
      END IF;

      database_recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF NOT mainnet_balance_financial_agreement_envelope_valid(
        requested_envelope, database_recorded_at
      ) THEN
        RAISE EXCEPTION 'invalid mainnet balance financial agreement evidence'
          USING ERRCODE = '22023';
      END IF;

      observation := requested_envelope -> 'observationCandidate';
      source_point := observation -> 'source';
      agreement := requested_envelope -> 'agreement';
      primary_attestation := agreement -> 'sourceAttestations' -> 0;
      corroborating_attestation := agreement -> 'sourceAttestations' -> 1;
      requested_account_id := (requested_envelope ->> 'accountId')::uuid;
      requested_wallet_id := (observation ->> 'walletId')::uuid;
      requested_network_id := observation ->> 'networkId';
      requested_chain_namespace := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN 'eip155' ELSE 'solana' END;
      requested_chain_reference := CASE
        WHEN requested_network_id = '${ETHEREUM}' THEN '1'
        ELSE '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' END;

      PERFORM 1
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
        AND wallet.chain_namespace = requested_chain_namespace
        AND wallet.chain_reference = requested_chain_reference
        AND wallet.status = 'ACTIVE'
        AND wallet.registry_environment = 'MAINNET'
        AND wallet.registry_version = 1
        AND wallet.registry_fingerprint_sha256 = '${ASSET_REGISTRY_FINGERPRINT}'
      FOR UPDATE OF wallet;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mainnet balance agreement scope is not an active registered wallet'
          USING ERRCODE = '42501';
      END IF;

      SELECT evidence.* INTO prior
      FROM balance_sync_financial_agreement_evidence AS evidence
      WHERE evidence.agreement_fingerprint_sha256 = requested_fingerprint
      FOR UPDATE;
      IF FOUND THEN
        IF prior.agreement_envelope <> requested_envelope THEN
          RAISE EXCEPTION 'mainnet balance financial agreement replay conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior.agreement_fingerprint_sha256, prior.recorded_at;
        RETURN;
      END IF;

      database_recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF NOT mainnet_balance_financial_agreement_envelope_valid(
        requested_envelope, database_recorded_at
      ) THEN
        RAISE EXCEPTION 'mainnet balance financial agreement evidence is no longer current'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO balance_sync_financial_agreement_evidence (
        agreement_fingerprint_sha256, agreement_version, agreement_use,
        may_persist, may_authorize_financial_action,
        account_id, wallet_id, chain_namespace, chain_reference, network_id,
        tier, selector, source_position, source_hash, source_parent_hash,
        retrieved_at, checkpoint_kind, source_pair_registry_fingerprint_sha256,
        source_pair_approval_expires_at, position_set_fingerprint_sha256,
        primary_source_family_id, primary_source_id, primary_retrieved_at,
        primary_candidate_fingerprint_sha256,
        corroborating_source_family_id, corroborating_source_id,
        corroborating_retrieved_at, corroborating_candidate_fingerprint_sha256,
        agreement_envelope, recorded_at
      ) VALUES (
        requested_fingerprint, 1, '${AGREEMENT_USE}', false, false,
        requested_account_id, requested_wallet_id, requested_chain_namespace,
        requested_chain_reference, requested_network_id, 'FINANCIAL', 'finalized',
        (source_point ->> 'position')::numeric, source_point ->> 'hash',
        source_point ->> 'parentHash', (source_point ->> 'retrievedAt')::timestamptz,
        agreement -> 'checkpoint' ->> 'kind',
        agreement ->> 'sourcePairRegistryFingerprintSha256',
        (agreement ->> 'sourcePairApprovalExpiresAt')::timestamptz,
        agreement ->> 'positionSetFingerprintSha256',
        primary_attestation ->> 'sourceFamilyId', primary_attestation ->> 'sourceId',
        (primary_attestation ->> 'retrievedAt')::timestamptz,
        primary_attestation ->> 'candidateFingerprintSha256',
        corroborating_attestation ->> 'sourceFamilyId',
        corroborating_attestation ->> 'sourceId',
        (corroborating_attestation ->> 'retrievedAt')::timestamptz,
        corroborating_attestation ->> 'candidateFingerprintSha256',
        requested_envelope, database_recorded_at
      ) ON CONFLICT (agreement_fingerprint_sha256) DO NOTHING;

      IF FOUND THEN
        RETURN QUERY SELECT 'RECORDED'::text, requested_fingerprint, database_recorded_at;
        RETURN;
      END IF;
      SELECT evidence.* INTO prior
      FROM balance_sync_financial_agreement_evidence AS evidence
      WHERE evidence.agreement_fingerprint_sha256 = requested_fingerprint
      FOR UPDATE;
      IF prior.agreement_envelope = requested_envelope THEN
        RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,
          prior.agreement_fingerprint_sha256, prior.recorded_at;
        RETURN;
      END IF;
      RAISE EXCEPTION 'mainnet balance financial agreement replay conflict'
        USING ERRCODE = '23505';
    END;`;

function createUpSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${migration}`;

  return `CREATE FUNCTION mainnet_balance_agreement_has_exact_keys(
      requested_value jsonb, expected_keys text[]
    ) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${EXACT_KEYS_BODY}$function$;

    CREATE FUNCTION canonical_mainnet_balance_agreement_json(requested_value jsonb)
    RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${CANONICAL_JSON_BODY}$function$;

    CREATE FUNCTION mainnet_balance_financial_agreement_envelope_valid(
      requested_envelope jsonb, requested_recorded_at timestamptz
    ) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${VALIDATE_ENVELOPE_BODY}$function$;

    CREATE TABLE ${TABLE} (
      agreement_fingerprint_sha256 text PRIMARY KEY,
      agreement_version smallint NOT NULL,
      agreement_use text NOT NULL,
      may_persist boolean NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      account_id uuid NOT NULL,
      wallet_id uuid NOT NULL,
      chain_namespace text NOT NULL,
      chain_reference text NOT NULL,
      network_id text NOT NULL,
      tier text NOT NULL,
      selector text NOT NULL,
      source_position numeric(20, 0) NOT NULL,
      source_hash text NOT NULL,
      source_parent_hash text NOT NULL,
      retrieved_at timestamptz NOT NULL,
      checkpoint_kind text NOT NULL,
      source_pair_registry_fingerprint_sha256 text NOT NULL,
      source_pair_approval_expires_at timestamptz NOT NULL,
      position_set_fingerprint_sha256 text NOT NULL,
      primary_source_family_id text NOT NULL,
      primary_source_id text NOT NULL,
      primary_retrieved_at timestamptz NOT NULL,
      primary_candidate_fingerprint_sha256 text NOT NULL,
      corroborating_source_family_id text NOT NULL,
      corroborating_source_id text NOT NULL,
      corroborating_retrieved_at timestamptz NOT NULL,
      corroborating_candidate_fingerprint_sha256 text NOT NULL,
      agreement_envelope jsonb NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT balance_sync_financial_agreement_wallet_scope_fk FOREIGN KEY (
        wallet_id, account_id, chain_namespace, chain_reference
      ) REFERENCES registered_wallets (
        wallet_id, account_id, chain_namespace, chain_reference
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT balance_sync_financial_agreement_static_state_check CHECK (
        agreement_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND agreement_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND agreement_version = 1
        AND agreement_use = '${AGREEMENT_USE}'
        AND may_persist = false
        AND may_authorize_financial_action = false
        AND tier = 'FINANCIAL'
        AND selector = 'finalized'
        AND source_position > 0 AND source_position <= 18446744073709551615
        AND source_hash <> source_parent_hash
        AND source_pair_registry_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND source_pair_registry_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND position_set_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND position_set_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND primary_candidate_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND primary_candidate_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND corroborating_candidate_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND corroborating_candidate_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND primary_source_family_id <> corroborating_source_family_id
        AND primary_source_id <> corroborating_source_id
        AND pg_catalog.date_trunc('milliseconds', recorded_at) = recorded_at
        AND source_pair_approval_expires_at > recorded_at
      ),
      CONSTRAINT balance_sync_financial_agreement_network_check CHECK (
        (network_id = '${ETHEREUM}' AND chain_namespace = 'eip155'
          AND chain_reference = '1' AND checkpoint_kind = 'ETHEREUM_BLOCK'
          AND source_hash ~ '^0x[0-9a-f]{64}$'
          AND source_parent_hash ~ '^0x[0-9a-f]{64}$')
        OR (network_id = '${SOLANA}' AND chain_namespace = 'solana'
          AND chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          AND checkpoint_kind = 'SOLANA_ROOTED_BLOCK'
          AND source_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          AND source_parent_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$')
      ),
      CONSTRAINT balance_sync_financial_agreement_envelope_check CHECK (
        mainnet_balance_financial_agreement_envelope_valid(agreement_envelope, recorded_at)
      ),
      CONSTRAINT balance_sync_financial_agreement_column_binding_check CHECK (
        agreement_envelope -> 'agreement' ->> 'agreementFingerprintSha256'
          = agreement_fingerprint_sha256
        AND (agreement_envelope ->> 'agreementVersion')::smallint = agreement_version
        AND agreement_envelope ->> 'use' = agreement_use
        AND (agreement_envelope ->> 'mayPersist')::boolean = may_persist
        AND (agreement_envelope ->> 'mayAuthorizeFinancialAction')::boolean
          = may_authorize_financial_action
        AND (agreement_envelope ->> 'accountId')::uuid = account_id
        AND (agreement_envelope -> 'observationCandidate' ->> 'walletId')::uuid = wallet_id
        AND agreement_envelope -> 'observationCandidate' ->> 'networkId' = network_id
        AND agreement_envelope -> 'observationCandidate' ->> 'tier' = tier
        AND agreement_envelope -> 'observationCandidate' -> 'source' ->> 'selector' = selector
        AND (agreement_envelope -> 'observationCandidate' -> 'source' ->> 'position')::numeric
          = source_position
        AND agreement_envelope -> 'observationCandidate' -> 'source' ->> 'hash' = source_hash
        AND agreement_envelope -> 'observationCandidate' -> 'source' ->> 'parentHash'
          = source_parent_hash
        AND (agreement_envelope -> 'observationCandidate' -> 'source' ->> 'retrievedAt')::timestamptz
          = retrieved_at
        AND agreement_envelope -> 'agreement' -> 'checkpoint' ->> 'kind' = checkpoint_kind
        AND agreement_envelope -> 'agreement' ->> 'sourcePairRegistryFingerprintSha256'
          = source_pair_registry_fingerprint_sha256
        AND (agreement_envelope -> 'agreement' ->> 'sourcePairApprovalExpiresAt')::timestamptz
          = source_pair_approval_expires_at
        AND agreement_envelope -> 'agreement' ->> 'positionSetFingerprintSha256'
          = position_set_fingerprint_sha256
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 0 ->> 'sourceFamilyId'
          = primary_source_family_id
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 0 ->> 'sourceId'
          = primary_source_id
        AND (agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 0 ->> 'retrievedAt')::timestamptz
          = primary_retrieved_at
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 0
          ->> 'candidateFingerprintSha256' = primary_candidate_fingerprint_sha256
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1 ->> 'sourceFamilyId'
          = corroborating_source_family_id
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1 ->> 'sourceId'
          = corroborating_source_id
        AND (agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1 ->> 'retrievedAt')::timestamptz
          = corroborating_retrieved_at
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1
          ->> 'candidateFingerprintSha256' = corroborating_candidate_fingerprint_sha256
      )
    );
    COMMENT ON TABLE ${TABLE} IS '${TABLE_MANIFEST}';

    CREATE FUNCTION reject_mainnet_balance_financial_agreement_mutation()
    RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
    SET search_path TO pg_catalog
    AS $function$${HISTORY_GUARD_BODY}$function$;
    CREATE TRIGGER balance_sync_financial_agreement_append_only_row
      BEFORE UPDATE OR DELETE ON ${TABLE}
      FOR EACH ROW EXECUTE FUNCTION reject_mainnet_balance_financial_agreement_mutation();
    CREATE TRIGGER balance_sync_financial_agreement_append_only_truncate
      BEFORE TRUNCATE ON ${TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_mainnet_balance_financial_agreement_mutation();
    ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER
      balance_sync_financial_agreement_append_only_row;
    ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER
      balance_sync_financial_agreement_append_only_truncate;

    CREATE FUNCTION record_balance_sync_financial_agreement_evidence(
      requested_envelope jsonb
    ) RETURNS TABLE (
      record_outcome text,
      recorded_agreement_fingerprint_sha256 text,
      evidence_recorded_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RECORD_AGREEMENT_BODY}$function$;

    DO $set_mainnet_balance_financial_agreement_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${CANONICAL_JSON} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${VALIDATE_ENVELOPE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECORD_AGREEMENT} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_mainnet_balance_financial_agreement_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${TABLE} FROM ${guardedRoles};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLE} FROM ${guardedRoles};
    ${ALL_FUNCTIONS.map(
      (functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guardedRoles};`,
    ).join('\n    ')}`;
}

function createDownSql(names: DatabasePrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  return `DO $refuse_mainnet_balance_financial_agreement_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${TABLE}) THEN
        RAISE EXCEPTION 'cannot roll back mainnet balance financial agreement evidence after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_mainnet_balance_financial_agreement_history_loss$;
    REVOKE EXECUTE ON FUNCTION ${RECORD_AGREEMENT}
      FROM PUBLIC, ${api}, ${worker}, ${legacy}, ${migration};
    DROP FUNCTION ${RECORD_AGREEMENT};
    DROP TRIGGER balance_sync_financial_agreement_append_only_truncate ON ${TABLE};
    DROP TRIGGER balance_sync_financial_agreement_append_only_row ON ${TABLE};
    DROP FUNCTION ${HISTORY_GUARD};
    DROP TABLE ${TABLE};
    DROP FUNCTION ${VALIDATE_ENVELOPE};
    DROP FUNCTION ${CANONICAL_JSON};
    DROP FUNCTION ${EXACT_KEYS};`;
}

function createVerifierSql(names: DatabasePrincipalNames, cumulative: boolean): string {
  const previous = createStablecoinIngestionAuthoritySuspensionMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0026 must expose verification SQL');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const expectedFunctionSources = [
    [EXACT_KEYS, sourceSha256(EXACT_KEYS_BODY)],
    [CANONICAL_JSON, sourceSha256(CANONICAL_JSON_BODY)],
    [VALIDATE_ENVELOPE, sourceSha256(VALIDATE_ENVELOPE_BODY)],
    [HISTORY_GUARD, sourceSha256(HISTORY_GUARD_BODY)],
    [RECORD_AGREEMENT, sourceSha256(RECORD_AGREEMENT_BODY)],
  ] as const;

  return `SELECT (
      prior.valid AND relation_state.valid AND column_state.valid AND type_state.valid
      AND function_state.valid AND trigger_state.valid
      AND constraint_state.valid AND privilege_state.valid
    ) AS valid
    FROM (${previous.verifySql}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(relation.relkind = 'r')
        AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
        AND pg_catalog.bool_and(
          pg_catalog.obj_description(relation.oid, 'pg_class') = '${TABLE_MANIFEST}'
        ) AS valid
      FROM pg_catalog.pg_class AS relation
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND relation.relname = '${TABLE}'
    ) AS relation_state
    CROSS JOIN (
      WITH expected(ordinal, column_name, data_type) AS (VALUES
        (1, 'agreement_fingerprint_sha256', 'text'),
        (2, 'agreement_version', 'smallint'),
        (3, 'agreement_use', 'text'),
        (4, 'may_persist', 'boolean'),
        (5, 'may_authorize_financial_action', 'boolean'),
        (6, 'account_id', 'uuid'),
        (7, 'wallet_id', 'uuid'),
        (8, 'chain_namespace', 'text'),
        (9, 'chain_reference', 'text'),
        (10, 'network_id', 'text'),
        (11, 'tier', 'text'),
        (12, 'selector', 'text'),
        (13, 'source_position', 'numeric(20,0)'),
        (14, 'source_hash', 'text'),
        (15, 'source_parent_hash', 'text'),
        (16, 'retrieved_at', 'timestamp with time zone'),
        (17, 'checkpoint_kind', 'text'),
        (18, 'source_pair_registry_fingerprint_sha256', 'text'),
        (19, 'source_pair_approval_expires_at', 'timestamp with time zone'),
        (20, 'position_set_fingerprint_sha256', 'text'),
        (21, 'primary_source_family_id', 'text'),
        (22, 'primary_source_id', 'text'),
        (23, 'primary_retrieved_at', 'timestamp with time zone'),
        (24, 'primary_candidate_fingerprint_sha256', 'text'),
        (25, 'corroborating_source_family_id', 'text'),
        (26, 'corroborating_source_id', 'text'),
        (27, 'corroborating_retrieved_at', 'timestamp with time zone'),
        (28, 'corroborating_candidate_fingerprint_sha256', 'text'),
        (29, 'agreement_envelope', 'jsonb'),
        (30, 'recorded_at', 'timestamp with time zone')
      )
      SELECT pg_catalog.count(*) = 30
        AND pg_catalog.count(attribute.attnum) = 30
        AND pg_catalog.bool_and(
          attribute.attnum = expected.ordinal
          AND attribute.attname = expected.column_name
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            = expected.data_type
          AND attribute.attnotnull AND attribute_default.adbin IS NULL
        )
        AND (
          SELECT pg_catalog.count(*) = 30
          FROM pg_catalog.pg_attribute AS all_attribute
          WHERE all_attribute.attrelid = pg_catalog.to_regclass('${TABLE}')
            AND all_attribute.attnum > 0 AND NOT all_attribute.attisdropped
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = pg_catalog.to_regclass('${TABLE}')
        AND attribute.attnum = expected.ordinal
      LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
        ON attribute_default.adrelid = attribute.attrelid
        AND attribute_default.adnum = attribute.attnum
    ) AS column_state
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(type_owner.rolname = ${cumulative ? owner : 'type_owner.rolname'})
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_type AS guarded_type
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(guarded_type.typacl, pg_catalog.acldefault('T', guarded_type.typowner))
          ) AS acl
          WHERE guarded_type.oid = pg_catalog.to_regtype('${TABLE}')
            AND acl.grantee <> guarded_type.typowner
        ) AS valid
      FROM pg_catalog.pg_type AS table_type
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_type.typnamespace
      INNER JOIN pg_catalog.pg_roles AS type_owner ON type_owner.oid = table_type.typowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND table_type.typtype = 'c' AND table_type.typname = '${TABLE}'
    ) AS type_state
    CROSS JOIN (
      SELECT pg_catalog.count(*) = ${ALL_FUNCTIONS.length}
        AND pg_catalog.bool_and(function_owner.rolname = ${
          cumulative ? owner : 'function_owner.rolname'
        })
        AND pg_catalog.bool_and(NOT procedure.proleakproof)
        AND pg_catalog.bool_and(
          pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = CASE procedure.oid
            ${expectedFunctionSources
              .map(
                ([identityValue, hash]) =>
                  `WHEN pg_catalog.to_regprocedure('${identityValue}') THEN '${hash}'`,
              )
              .join('\n            ')}
            ELSE NULL
          END
        )
        AND pg_catalog.bool_and(CASE procedure.oid
          WHEN pg_catalog.to_regprocedure('${EXACT_KEYS}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.prorettype = pg_catalog.to_regtype('boolean')
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${CANONICAL_JSON}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.prorettype = pg_catalog.to_regtype('text')
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          WHEN pg_catalog.to_regprocedure('${VALIDATE_ENVELOPE}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND procedure.prorettype = pg_catalog.to_regtype('boolean')
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          WHEN pg_catalog.to_regprocedure('${HISTORY_GUARD}') THEN
            NOT procedure.prosecdef AND procedure.provolatile = 'v'
              AND procedure.proparallel = 'u' AND NOT procedure.proisstrict
              AND procedure.prorettype = pg_catalog.to_regtype('trigger')
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${RECORD_AGREEMENT}') THEN
            procedure.prosecdef AND procedure.provolatile = 'v'
              AND procedure.proparallel = 'u' AND procedure.proisstrict
              AND procedure.proretset AND procedure.prorettype = pg_catalog.to_regtype('record')
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      INNER JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
      WHERE namespace.nspname = pg_catalog.current_schema()
        AND procedure.oid IN (
          ${ALL_FUNCTIONS.map(
            (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
          ).join(',\n          ')}
        )
    ) AS function_state
    CROSS JOIN (
      WITH expected(trigger_name, trigger_type) AS (VALUES
        ('balance_sync_financial_agreement_append_only_row', 27::smallint),
        ('balance_sync_financial_agreement_append_only_truncate', 34::smallint)
      )
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.count(trigger.oid) = 2
        AND pg_catalog.bool_and(
          trigger.oid IS NOT NULL AND NOT trigger.tgisinternal
          AND trigger.tgenabled = 'A'
          AND trigger.tgfoid = pg_catalog.to_regprocedure('${HISTORY_GUARD}')
          AND trigger.tgtype = expected.trigger_type
          AND trigger.tgnargs = 0 AND trigger.tgconstraint = 0
          AND NOT trigger.tgdeferrable AND NOT trigger.tginitdeferred
          AND trigger.tgparentid = 0 AND trigger.tgoldtable IS NULL
          AND trigger.tgnewtable IS NULL
        )
        AND (
          SELECT pg_catalog.count(*) = 2
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid = pg_catalog.to_regclass('${TABLE}')
            AND NOT all_trigger.tgisinternal
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgrelid = pg_catalog.to_regclass('${TABLE}')
        AND trigger.tgname = expected.trigger_name
    ) AS trigger_state
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 6
        AND pg_catalog.bool_and(constraint_record.convalidated)
        AND pg_catalog.bool_and(
          NOT constraint_record.condeferrable
          AND NOT constraint_record.condeferred
          AND NOT constraint_record.connoinherit
        )
        AND pg_catalog.bool_and(CASE constraint_record.conname
          WHEN '${TABLE}_pkey' THEN constraint_record.contype = 'p'
            AND constraint_record.conkey = ARRAY[1]::smallint[]
          WHEN 'balance_sync_financial_agreement_wallet_scope_fk'
            THEN constraint_record.contype = 'f'
              AND constraint_record.confrelid = pg_catalog.to_regclass('registered_wallets')
              AND constraint_record.conkey = ARRAY[7,6,8,9]::smallint[]
              AND constraint_record.confkey = ARRAY[1,2,4,5]::smallint[]
              AND constraint_record.conmatchtype = 's'
              AND constraint_record.confupdtype = 'r' AND constraint_record.confdeltype = 'r'
          WHEN 'balance_sync_financial_agreement_static_state_check'
            THEN constraint_record.contype = 'c'
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'may_authorize_financial_action = false'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'source_pair_approval_expires_at > recorded_at'
              ) > 0
          WHEN 'balance_sync_financial_agreement_network_check'
            THEN constraint_record.contype = 'c'
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid), '${ETHEREUM}'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid), '${SOLANA}'
              ) > 0
          WHEN 'balance_sync_financial_agreement_envelope_check'
            THEN constraint_record.contype = 'c'
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'mainnet_balance_financial_agreement_envelope_valid'
              ) > 0
          WHEN 'balance_sync_financial_agreement_column_binding_check'
            THEN constraint_record.contype = 'c'
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'agreement_fingerprint_sha256'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'corroborating_candidate_fingerprint_sha256'
              ) > 0
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND constraint_record.conrelid = pg_catalog.to_regclass('${TABLE}')
        AND constraint_record.conname IN (
          '${TABLE}_pkey', 'balance_sync_financial_agreement_wallet_scope_fk',
          'balance_sync_financial_agreement_static_state_check',
          'balance_sync_financial_agreement_network_check',
          'balance_sync_financial_agreement_envelope_check',
          'balance_sync_financial_agreement_column_binding_check'
        )
        AND (
          SELECT pg_catalog.count(*) = 6
          FROM pg_catalog.pg_constraint AS all_constraint
          WHERE all_constraint.conrelid = pg_catalog.to_regclass('${TABLE}')
        )
    ) AS constraint_state
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS guarded_table
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(guarded_table.relacl, pg_catalog.acldefault('r', guarded_table.relowner))
        ) AS acl
        WHERE guarded_table.oid = pg_catalog.to_regclass('${TABLE}')
          AND acl.grantee <> guarded_table.relowner
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS guarded_function
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(guarded_function.proacl, pg_catalog.acldefault('f', guarded_function.proowner))
        ) AS acl
        WHERE guarded_function.oid IN (
          ${ALL_FUNCTIONS.map(
            (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
          ).join(',\n          ')}
        ) AND acl.grantee <> guarded_function.proowner
      )
      AND NOT pg_catalog.has_table_privilege(${api}, '${TABLE}', 'SELECT')
      AND NOT pg_catalog.has_table_privilege(${worker}, '${TABLE}', 'SELECT')
      AND NOT pg_catalog.has_table_privilege(${legacy}, '${TABLE}', 'SELECT')
      AND NOT pg_catalog.has_table_privilege(${migration}, '${TABLE}', 'SELECT')
      AND ${[api, worker, legacy, migration, "'public'"]
        .flatMap((role) =>
          ALL_FUNCTIONS.map(
            (functionIdentity) =>
              `NOT pg_catalog.has_function_privilege(${role}, '${functionIdentity}', 'EXECUTE')`,
          ),
        )
        .join('\n      AND ')} AS valid
    ) AS privilege_state`;
}

export function createMainnetBalanceAgreementEvidenceMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0027',
    description: 'create dormant owner-only mainnet balance agreement evidence boundary',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0026'],
  };
}

export const createMainnetBalanceAgreementEvidenceMigrationV0027 =
  createMainnetBalanceAgreementEvidenceMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createMainnetBalanceAgreementEvidenceTestSchemaMigrationV0027 =
  createMainnetBalanceAgreementEvidenceMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
