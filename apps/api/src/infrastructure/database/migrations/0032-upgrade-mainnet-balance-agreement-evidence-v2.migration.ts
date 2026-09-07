import { createHash } from 'node:crypto';

import { createMainnetBalanceAgreementEvidenceMigration } from './0027-create-mainnet-balance-agreement-evidence.migration';
import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createProviderPositionChainAnchorRecordIntentMigration } from './0031-create-provider-position-chain-anchor-record-intents.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const V1_TABLE = 'balance_sync_financial_agreement_evidence';
const TABLE = 'balance_sync_financial_agreement_evidence_v2';
const TABLE_MANIFEST =
  'crypto-lending:mainnet-balance-two-source-agreement-evidence:v2;owner-only;append-only;runtime-unregistered;v1-preserved';
const HISTORY_GUARD = 'reject_mainnet_balance_financial_agreement_mutation()';
const SOLANA_IDENTITY = 'mainnet_balance_solana_block_identity_v2_valid(text)';
const VALIDATE_ENVELOPE =
  'mainnet_balance_financial_agreement_envelope_v2_valid(jsonb,timestamp with time zone)';
const RECORD_AGREEMENT = 'record_balance_sync_financial_agreement_evidence_v2(jsonb)';
const V2_FUNCTIONS = Object.freeze([SOLANA_IDENTITY, VALIDATE_ENVELOPE, RECORD_AGREEMENT] as const);
const V2_CHECK_EXPRESSION_SHA256 = Object.freeze([
  [
    'balance_sync_financial_agreement_v2_column_binding_check',
    '020c7a59d085f7b3ceebdc434a29a71172abfb36a85c4e10cf98cc7b2a76ca43',
  ],
  [
    'balance_sync_financial_agreement_v2_envelope_check',
    'ce3ccb4a34937a960276c59d13bd36b2c325b334adaafb75f8f7f1188a0fbe2c',
  ],
  [
    'balance_sync_financial_agreement_v2_network_check',
    'e408d79f63011e3e1370023a5d12af0da65a7c079d0cfc2461f728157518c6d4',
  ],
  [
    'balance_sync_financial_agreement_v2_static_state_check',
    'd92728ecaced60440ac887d5ace48ab8cc5b79c7ec81d645985aee4b3e414344',
  ],
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

function oneSql(value: string | readonly string[], name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must expose one SQL string`);
  return value;
}

function replaceExactly(
  source: string,
  target: string,
  replacement: string,
  expectedCount = 1,
): string {
  const parts = source.split(target);
  if (parts.length - 1 !== expectedCount) {
    throw new Error(
      `Migration 0032 predecessor anchor must occur ${expectedCount} time(s): ${target.slice(0, 80)}`,
    );
  }
  return parts.join(replacement);
}

function betweenExactly(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = startIndex < 0 ? -1 : source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0 || source.indexOf(start, startIndex + start.length) >= 0) {
    throw new Error('Migration 0032 predecessor boundaries must occur exactly once');
  }
  return source.slice(startIndex + start.length, endIndex);
}

const SOLANA_IDENTITY_BODY = `
    DECLARE
      alphabet CONSTANT text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      numeric_value numeric := 0;
      remaining numeric;
      digit integer;
      character_index integer;
      leading_zero_bytes integer := 0;
      decoded_bytes integer := 0;
    BEGIN
      IF requested_identity !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN
        RETURN false;
      END IF;
      FOR character_index IN 1..pg_catalog.length(requested_identity) LOOP
        digit := pg_catalog.strpos(
          alphabet, pg_catalog.substr(requested_identity, character_index, 1)
        ) - 1;
        IF digit < 0 THEN RETURN false; END IF;
        numeric_value := numeric_value * 58 + digit;
      END LOOP;
      WHILE leading_zero_bytes < pg_catalog.length(requested_identity)
        AND pg_catalog.substr(requested_identity, leading_zero_bytes + 1, 1) = '1'
      LOOP
        leading_zero_bytes := leading_zero_bytes + 1;
      END LOOP;
      remaining := numeric_value;
      WHILE remaining > 0 LOOP
        decoded_bytes := decoded_bytes + 1;
        remaining := pg_catalog.trunc(remaining / 256);
      END LOOP;
      RETURN leading_zero_bytes + decoded_bytes = 32 AND numeric_value <> 0;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;`;

type V2SqlParts = Readonly<{
  createTableSql: string;
  validateEnvelopeBody: string;
  recordAgreementBody: string;
}>;

function createV2SqlParts(names: BalanceConsumerPrincipalNames): V2SqlParts {
  const v1 = createMainnetBalanceAgreementEvidenceMigration(names);
  const v1Up = oneSql(v1.upSql, 'Migration 0027');

  let validateEnvelopeBody = betweenExactly(
    v1Up,
    'AS $function$\n    DECLARE\n      observation jsonb;',
    '$function$;\n\n    CREATE TABLE balance_sync_financial_agreement_evidence',
  );
  validateEnvelopeBody = `
    DECLARE
      observation jsonb;${validateEnvelopeBody}`;
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "        OR requested_envelope -> 'agreementVersion' <> '1'::jsonb",
    `        OR pg_catalog.jsonb_typeof(requested_envelope -> 'agreementVersion') <> 'number'
        OR requested_envelope ->> 'agreementVersion' <> '2'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "        OR requested_envelope ->> 'use' <> 'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY'",
    `        OR pg_catalog.jsonb_typeof(requested_envelope -> 'use') <> 'string'
        OR requested_envelope ->> 'use'
          <> 'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "        OR requested_envelope ->> 'accountId'",
    `        OR pg_catalog.jsonb_typeof(requested_envelope -> 'accountId') <> 'string'
        OR requested_envelope ->> 'accountId'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "        OR observation ->> 'walletId'",
    `        OR pg_catalog.jsonb_typeof(observation -> 'walletId') <> 'string'
        OR pg_catalog.jsonb_typeof(observation -> 'networkId') <> 'string'
        OR pg_catalog.jsonb_typeof(observation -> 'tier') <> 'string'
        OR observation ->> 'walletId'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `          ARRAY['hash', 'identityValidated', 'parentHash', 'position', 'retrievedAt', 'selector']::text[]`,
    `          ARRAY[
            'approvedManifestFingerprintSha256', 'deploymentIdentityValidated', 'hash',
            'identityValidated', 'observedIdentityFingerprintSha256', 'parentHash',
            'position', 'retrievedAt', 'selector'
          ]::text[]`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "        OR source_point -> 'identityValidated' <> 'true'::jsonb",
    `        OR pg_catalog.jsonb_typeof(source_point -> 'position') <> 'string'
        OR pg_catalog.jsonb_typeof(source_point -> 'hash') <> 'string'
        OR pg_catalog.jsonb_typeof(source_point -> 'parentHash') <> 'string'
        OR pg_catalog.jsonb_typeof(source_point -> 'selector') <> 'string'
        OR pg_catalog.jsonb_typeof(source_point -> 'retrievedAt') <> 'string'
        OR source_point -> 'identityValidated' <> 'true'::jsonb
        OR source_point -> 'deploymentIdentityValidated' <> 'true'::jsonb
        OR pg_catalog.jsonb_typeof(
          source_point -> 'approvedManifestFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          source_point -> 'observedIdentityFingerprintSha256'
        ) <> 'string'
        OR source_point ->> 'approvedManifestFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR source_point ->> 'approvedManifestFingerprintSha256' = pg_catalog.repeat('0', 64)
        OR source_point ->> 'observedIdentityFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR source_point ->> 'observedIdentityFingerprintSha256' = pg_catalog.repeat('0', 64)`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `        network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' AND (
          source_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          OR source_parent_hash !~ '^[1-9A-HJ-NP-Za-km-z]{32,88}$'
          OR source_hash = '11111111111111111111111111111111'
          OR source_parent_hash = '11111111111111111111111111111111'
        )`,
    `        network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' AND (
          NOT mainnet_balance_solana_block_identity_v2_valid(source_hash)
          OR NOT mainnet_balance_solana_block_identity_v2_valid(source_parent_hash)
        )`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `      expected_position_id := pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(
            'crypto-lending:balance-position:v1' || pg_catalog.chr(0)
              || account_id || pg_catalog.chr(0) || wallet_id || pg_catalog.chr(0)
              || network_id || pg_catalog.chr(0) || expected_asset,
            'UTF8'
          )),
          'hex'
        );`,
    `      expected_position_id := pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to('crypto-lending:balance-position:v1', 'UTF8')
              || pg_catalog.decode('00', 'hex')
              || pg_catalog.convert_to(account_id, 'UTF8')
              || pg_catalog.decode('00', 'hex')
              || pg_catalog.convert_to(wallet_id, 'UTF8')
              || pg_catalog.decode('00', 'hex')
              || pg_catalog.convert_to(network_id, 'UTF8')
              || pg_catalog.decode('00', 'hex')
              || pg_catalog.convert_to(expected_asset, 'UTF8')
          ),
          'hex'
        );`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "          OR pg_catalog.jsonb_typeof(position_entry -> 'amountAtomic') <> 'string'",
    `          OR pg_catalog.jsonb_typeof(position_entry -> 'positionId') <> 'string'
          OR pg_catalog.jsonb_typeof(position_entry -> 'stablecoin') <> 'string'
          OR pg_catalog.jsonb_typeof(position_entry -> 'assetIdentity') <> 'string'
          OR pg_catalog.jsonb_typeof(position_entry -> 'amountAtomic') <> 'string'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `          ARRAY[
            'agreementFingerprintSha256', 'checkpoint', 'positionSetFingerprintSha256',
            'sourceAttestations', 'sourcePairApprovalExpiresAt',
            'sourcePairRegistryFingerprintSha256', 'status'
          ]::text[]`,
    `          ARRAY[
            'agreementFingerprintSha256', 'approvedManifestFingerprintSha256', 'checkpoint',
            'observedIdentityFingerprintSha256', 'positionSetFingerprintSha256',
            'sourceAttestations', 'sourcePairApprovalExpiresAt',
            'sourcePairRegistryFingerprintSha256', 'status'
          ]::text[]`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "        OR agreement ->> 'status' <> 'EXACT_CHECKPOINT_AND_BALANCE_MATCH'",
    `        OR pg_catalog.jsonb_typeof(agreement -> 'status') <> 'string'
        OR pg_catalog.jsonb_typeof(
          agreement -> 'sourcePairRegistryFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(agreement -> 'sourcePairApprovalExpiresAt') <> 'string'
        OR pg_catalog.jsonb_typeof(
          agreement -> 'positionSetFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(agreement -> 'agreementFingerprintSha256') <> 'string'
        OR pg_catalog.jsonb_typeof(
          agreement -> 'approvedManifestFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          agreement -> 'observedIdentityFingerprintSha256'
        ) <> 'string'
        OR agreement ->> 'status'
          <> 'EXACT_CHECKPOINT_BALANCE_AND_DEPLOYMENT_IDENTITY_MATCH'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `        OR agreement ->> 'agreementFingerprintSha256' = pg_catalog.repeat('0', 64)
      THEN`,
    `        OR agreement ->> 'agreementFingerprintSha256' = pg_catalog.repeat('0', 64)
        OR agreement ->> 'approvedManifestFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR agreement ->> 'approvedManifestFingerprintSha256' = pg_catalog.repeat('0', 64)
        OR agreement ->> 'observedIdentityFingerprintSha256' !~ '^[0-9a-f]{64}$'
        OR agreement ->> 'observedIdentityFingerprintSha256' = pg_catalog.repeat('0', 64)
        OR agreement ->> 'approvedManifestFingerprintSha256'
          <> source_point ->> 'approvedManifestFingerprintSha256'
        OR agreement ->> 'observedIdentityFingerprintSha256'
          <> source_point ->> 'observedIdentityFingerprintSha256'
      THEN`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `          ARRAY[
            'candidateFingerprintSha256', 'chainIdentityValidated', 'checkpoint', 'networkId',
            'positionSetFingerprintSha256', 'retrievedAt', 'role', 'sourceFamilyId', 'sourceId'
          ]::text[]`,
    `          ARRAY[
            'approvedManifestFingerprintSha256', 'candidateFingerprintSha256',
            'chainIdentityValidated', 'checkpoint', 'deploymentIdentityValidated', 'networkId',
            'observedIdentityFingerprintSha256', 'positionSetFingerprintSha256', 'retrievedAt',
            'role', 'sourceFamilyId', 'sourceId'
          ]::text[]`,
    2,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "          OR checkpoint ->> 'kind' <> 'ETHEREUM_BLOCK'",
    `          OR pg_catalog.jsonb_typeof(checkpoint -> 'kind') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'blockNumber') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'blockHash') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'parentBlockHash') <> 'string'
          OR checkpoint ->> 'kind' <> 'ETHEREUM_BLOCK'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    "          OR checkpoint ->> 'kind' <> 'SOLANA_ROOTED_BLOCK'",
    `          OR pg_catalog.jsonb_typeof(checkpoint -> 'kind') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'finalizedSlot') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'blockIdentity') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'parentBlockIdentity') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'rootSlot') <> 'string'
          OR pg_catalog.jsonb_typeof(checkpoint -> 'rootDerivation') <> 'string'
          OR checkpoint ->> 'kind' <> 'SOLANA_ROOTED_BLOCK'`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `        OR corroborating_attestation -> 'chainIdentityValidated' <> 'true'::jsonb
        OR primary_attestation -> 'checkpoint' <> checkpoint`,
    `        OR corroborating_attestation -> 'chainIdentityValidated' <> 'true'::jsonb
        OR primary_attestation -> 'deploymentIdentityValidated' <> 'true'::jsonb
        OR corroborating_attestation -> 'deploymentIdentityValidated' <> 'true'::jsonb
        OR pg_catalog.jsonb_typeof(primary_attestation -> 'role') <> 'string'
        OR pg_catalog.jsonb_typeof(primary_attestation -> 'sourceFamilyId') <> 'string'
        OR pg_catalog.jsonb_typeof(primary_attestation -> 'sourceId') <> 'string'
        OR pg_catalog.jsonb_typeof(primary_attestation -> 'networkId') <> 'string'
        OR pg_catalog.jsonb_typeof(primary_attestation -> 'retrievedAt') <> 'string'
        OR pg_catalog.jsonb_typeof(
          primary_attestation -> 'positionSetFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          primary_attestation -> 'candidateFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          primary_attestation -> 'approvedManifestFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          primary_attestation -> 'observedIdentityFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(corroborating_attestation -> 'role') <> 'string'
        OR pg_catalog.jsonb_typeof(
          corroborating_attestation -> 'sourceFamilyId'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(corroborating_attestation -> 'sourceId') <> 'string'
        OR pg_catalog.jsonb_typeof(corroborating_attestation -> 'networkId') <> 'string'
        OR pg_catalog.jsonb_typeof(corroborating_attestation -> 'retrievedAt') <> 'string'
        OR pg_catalog.jsonb_typeof(
          corroborating_attestation -> 'positionSetFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          corroborating_attestation -> 'candidateFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          corroborating_attestation -> 'approvedManifestFingerprintSha256'
        ) <> 'string'
        OR pg_catalog.jsonb_typeof(
          corroborating_attestation -> 'observedIdentityFingerprintSha256'
        ) <> 'string'
        OR primary_attestation ->> 'approvedManifestFingerprintSha256'
          <> agreement ->> 'approvedManifestFingerprintSha256'
        OR corroborating_attestation ->> 'approvedManifestFingerprintSha256'
          <> agreement ->> 'approvedManifestFingerprintSha256'
        OR primary_attestation ->> 'observedIdentityFingerprintSha256'
          <> agreement ->> 'observedIdentityFingerprintSha256'
        OR corroborating_attestation ->> 'observedIdentityFingerprintSha256'
          <> agreement ->> 'observedIdentityFingerprintSha256'
        OR primary_attestation -> 'checkpoint' <> checkpoint`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    'crypto-lending:mainnet-balance-source-attestation:v1',
    'crypto-lending:mainnet-balance-source-attestation:v2',
    2,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `            primary_attestation ->> 'sourceFamilyId', primary_attestation ->> 'sourceId',
            primary_source, checkpoint, computed_position_set_fingerprint`,
    `            primary_attestation ->> 'sourceFamilyId', primary_attestation ->> 'sourceId',
            source_point ->> 'approvedManifestFingerprintSha256',
            source_point ->> 'observedIdentityFingerprintSha256',
            primary_source, checkpoint, computed_position_set_fingerprint`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `            corroborating_attestation ->> 'sourceFamilyId',
            corroborating_attestation ->> 'sourceId', corroborating_source, checkpoint,
            computed_position_set_fingerprint`,
    `            corroborating_attestation ->> 'sourceFamilyId',
            corroborating_attestation ->> 'sourceId',
            source_point ->> 'approvedManifestFingerprintSha256',
            source_point ->> 'observedIdentityFingerprintSha256',
            corroborating_source, checkpoint, computed_position_set_fingerprint`,
  );
  validateEnvelopeBody = replaceExactly(
    validateEnvelopeBody,
    `            'crypto-lending:mainnet-balance-two-source-agreement:v1', 1,
            'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY', account_id, observation,`,
    `            'crypto-lending:mainnet-balance-two-source-agreement:v2', 2,
            'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY', account_id,
            source_point ->> 'approvedManifestFingerprintSha256',
            source_point ->> 'observedIdentityFingerprintSha256', observation,`,
  );

  let recordAgreementBody = betweenExactly(
    v1Up,
    'AS $function$\n    DECLARE\n      prior balance_sync_financial_agreement_evidence%ROWTYPE;',
    '$function$;\n\n    DO $set_mainnet_balance_financial_agreement_paths$',
  );
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    'balance_sync_financial_agreement_evidence',
    TABLE,
    4,
  );
  recordAgreementBody = `
    DECLARE
      prior balance_sync_financial_agreement_evidence_v2%ROWTYPE;
      v1_prior balance_sync_financial_agreement_evidence%ROWTYPE;${recordAgreementBody}`;
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    'IF prior.agreement_envelope <> requested_envelope THEN',
    'IF prior.agreement_version <> 2 OR prior.agreement_envelope <> requested_envelope THEN',
    2,
  );
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    'mainnet_balance_financial_agreement_envelope_valid(',
    'mainnet_balance_financial_agreement_envelope_v2_valid(',
    2,
  );
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    `      SELECT evidence.* INTO prior
      FROM ${TABLE} AS evidence
      WHERE evidence.agreement_fingerprint_sha256 = requested_fingerprint
      FOR UPDATE;`,
    `      SELECT evidence.* INTO v1_prior
      FROM ${V1_TABLE} AS evidence
      WHERE evidence.agreement_fingerprint_sha256 = requested_fingerprint
      FOR UPDATE;
      IF FOUND THEN
        RAISE EXCEPTION 'mainnet balance agreement fingerprint collides with v1 evidence'
          USING ERRCODE = '23505';
      END IF;

      SELECT evidence.* INTO prior
      FROM ${TABLE} AS evidence
      WHERE evidence.agreement_fingerprint_sha256 = requested_fingerprint
      FOR UPDATE;`,
    3,
  );
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    `        corroborating_retrieved_at, corroborating_candidate_fingerprint_sha256,
        agreement_envelope, recorded_at`,
    `        corroborating_retrieved_at, corroborating_candidate_fingerprint_sha256,
        approved_manifest_fingerprint_sha256, observed_identity_fingerprint_sha256,
        agreement_envelope, recorded_at`,
  );
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    "        requested_fingerprint, 1, 'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY', false, false,",
    "        requested_fingerprint, 2, 'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY', false, false,",
  );
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    `        corroborating_attestation ->> 'candidateFingerprintSha256',
        requested_envelope, database_recorded_at`,
    `        corroborating_attestation ->> 'candidateFingerprintSha256',
        agreement ->> 'approvedManifestFingerprintSha256',
        agreement ->> 'observedIdentityFingerprintSha256',
        requested_envelope, database_recorded_at`,
  );
  recordAgreementBody = replaceExactly(
    recordAgreementBody,
    'IF prior.agreement_envelope = requested_envelope THEN',
    'IF prior.agreement_version = 2 AND prior.agreement_envelope = requested_envelope THEN',
  );

  let createTableBody = betweenExactly(
    v1Up,
    '    CREATE TABLE balance_sync_financial_agreement_evidence (\n',
    '\n    );\n    COMMENT ON TABLE balance_sync_financial_agreement_evidence',
  );
  createTableBody = replaceExactly(
    createTableBody,
    `      agreement_envelope jsonb NOT NULL,
      recorded_at timestamptz NOT NULL,`,
    `      agreement_envelope jsonb NOT NULL,
      recorded_at timestamptz NOT NULL,
      approved_manifest_fingerprint_sha256 text NOT NULL,
      observed_identity_fingerprint_sha256 text NOT NULL,`,
  );
  createTableBody = replaceExactly(
    createTableBody,
    '        AND agreement_version = 1',
    `        AND agreement_version = 2
        AND approved_manifest_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND approved_manifest_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND observed_identity_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND observed_identity_fingerprint_sha256 <> pg_catalog.repeat('0', 64)`,
  );
  createTableBody = replaceExactly(
    createTableBody,
    'mainnet_balance_financial_agreement_envelope_valid(agreement_envelope, recorded_at)',
    'mainnet_balance_financial_agreement_envelope_v2_valid(agreement_envelope, recorded_at)',
  );
  createTableBody = replaceExactly(
    createTableBody,
    `        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1
          ->> 'candidateFingerprintSha256' = corroborating_candidate_fingerprint_sha256`,
    `        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1
          ->> 'candidateFingerprintSha256' = corroborating_candidate_fingerprint_sha256
        AND agreement_envelope -> 'agreement' ->> 'approvedManifestFingerprintSha256'
          = approved_manifest_fingerprint_sha256
        AND agreement_envelope -> 'agreement' ->> 'observedIdentityFingerprintSha256'
          = observed_identity_fingerprint_sha256
        AND agreement_envelope -> 'observationCandidate' -> 'source'
          ->> 'approvedManifestFingerprintSha256' = approved_manifest_fingerprint_sha256
        AND agreement_envelope -> 'observationCandidate' -> 'source'
          ->> 'observedIdentityFingerprintSha256' = observed_identity_fingerprint_sha256
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 0
          ->> 'approvedManifestFingerprintSha256' = approved_manifest_fingerprint_sha256
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 0
          ->> 'observedIdentityFingerprintSha256' = observed_identity_fingerprint_sha256
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1
          ->> 'approvedManifestFingerprintSha256' = approved_manifest_fingerprint_sha256
        AND agreement_envelope -> 'agreement' -> 'sourceAttestations' -> 1
          ->> 'observedIdentityFingerprintSha256' = observed_identity_fingerprint_sha256`,
  );
  createTableBody = replaceExactly(
    createTableBody,
    'balance_sync_financial_agreement_',
    'balance_sync_financial_agreement_v2_',
    5,
  );

  return {
    createTableSql: `CREATE TABLE ${TABLE} (\n${createTableBody}\n    )`,
    validateEnvelopeBody,
    recordAgreementBody,
  };
}

function createUpSql(names: BalanceConsumerPrincipalNames, parts: V2SqlParts): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `CREATE FUNCTION mainnet_balance_solana_block_identity_v2_valid(
      requested_identity text
    ) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${SOLANA_IDENTITY_BODY}$function$;

    CREATE FUNCTION mainnet_balance_financial_agreement_envelope_v2_valid(
      requested_envelope jsonb, requested_recorded_at timestamptz
    ) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${parts.validateEnvelopeBody}$function$;

    ${parts.createTableSql};
    COMMENT ON TABLE ${TABLE} IS '${TABLE_MANIFEST}';

    CREATE TRIGGER balance_sync_financial_agreement_v2_append_only_row
      BEFORE UPDATE OR DELETE ON ${TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${HISTORY_GUARD};
    CREATE TRIGGER balance_sync_financial_agreement_v2_append_only_truncate
      BEFORE TRUNCATE ON ${TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION ${HISTORY_GUARD};
    ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER
      balance_sync_financial_agreement_v2_append_only_row;
    ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER
      balance_sync_financial_agreement_v2_append_only_truncate;

    CREATE FUNCTION record_balance_sync_financial_agreement_evidence_v2(
      requested_envelope jsonb
    ) RETURNS TABLE (
      record_outcome text,
      recorded_agreement_fingerprint_sha256 text,
      evidence_recorded_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${parts.recordAgreementBody}$function$;

    DO $set_mainnet_balance_financial_agreement_v2_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${VALIDATE_ENVELOPE} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${RECORD_AGREEMENT} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );
    END;
    $set_mainnet_balance_financial_agreement_v2_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${TABLE} FROM ${guardedRoles};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLE} FROM ${guardedRoles};
    ${V2_FUNCTIONS.map(
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

  return `LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE;

    DO $refuse_mainnet_balance_financial_agreement_v2_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${TABLE}) THEN
        RAISE EXCEPTION 'cannot roll back deployment-aware mainnet balance agreement evidence after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_mainnet_balance_financial_agreement_v2_history_loss$;

    REVOKE EXECUTE ON FUNCTION ${RECORD_AGREEMENT} FROM ${guardedRoles};
    DROP FUNCTION ${RECORD_AGREEMENT};
    DROP TRIGGER balance_sync_financial_agreement_v2_append_only_truncate ON ${TABLE};
    DROP TRIGGER balance_sync_financial_agreement_v2_append_only_row ON ${TABLE};
    REVOKE ALL PRIVILEGES ON TABLE ${TABLE} FROM ${guardedRoles};
    REVOKE ALL PRIVILEGES ON TYPE ${TABLE} FROM ${guardedRoles};
    DROP TABLE ${TABLE};
    REVOKE EXECUTE ON FUNCTION ${VALIDATE_ENVELOPE} FROM ${guardedRoles};
    REVOKE EXECUTE ON FUNCTION ${SOLANA_IDENTITY} FROM ${guardedRoles};
    DROP FUNCTION ${VALIDATE_ENVELOPE};
    DROP FUNCTION ${SOLANA_IDENTITY};`;
}

function createVerifierSql(
  names: BalanceConsumerPrincipalNames,
  cumulative: boolean,
  parts: V2SqlParts,
): string {
  const previous = createProviderPositionChainAnchorRecordIntentMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0031 must expose verification SQL');

  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const guardedRoles = [api, worker, legacy, balance, migration, "'public'"];
  const expectedFunctionSources = [
    [SOLANA_IDENTITY, sourceSha256(SOLANA_IDENTITY_BODY)],
    [VALIDATE_ENVELOPE, sourceSha256(parts.validateEnvelopeBody)],
    [RECORD_AGREEMENT, sourceSha256(parts.recordAgreementBody)],
  ] as const;
  const expectedCheckExpressionHashes = V2_CHECK_EXPRESSION_SHA256.map(
    ([constraintName, hash]) => `WHEN '${constraintName}' THEN '${hash}'`,
  ).join('\n              ');

  return `SELECT (
      prior.valid AND relation_state.valid AND column_state.valid AND type_state.valid
      AND function_state.valid AND trigger_state.valid
      AND constraint_state.valid AND privilege_state.valid
    ) AS valid
    FROM (${previous.verifySql}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(relation.relkind = 'r')
        AND pg_catalog.bool_and(relation.relpersistence = 'p')
        AND pg_catalog.bool_and(NOT relation.relrowsecurity)
        AND pg_catalog.bool_and(NOT relation.relforcerowsecurity)
        AND pg_catalog.bool_and(NOT relation.relispartition)
        AND pg_catalog.bool_and(owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'})
        AND pg_catalog.bool_and(
          pg_catalog.obj_description(relation.oid, 'pg_class') = '${TABLE_MANIFEST}'
        )
        AND pg_catalog.bool_and(NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
        ))
        AND pg_catalog.bool_and(NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite
          WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN'
        )) AS valid
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
        (30, 'recorded_at', 'timestamp with time zone'),
        (31, 'approved_manifest_fingerprint_sha256', 'text'),
        (32, 'observed_identity_fingerprint_sha256', 'text')
      )
      SELECT pg_catalog.count(*) = 32
        AND pg_catalog.count(attribute.attnum) = 32
        AND pg_catalog.bool_and(
          attribute.attnum = expected.ordinal
          AND attribute.attname = expected.column_name
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            = expected.data_type
          AND attribute.attnotnull
          AND attribute.attidentity = ''
          AND attribute.attgenerated = ''
          AND attribute.attcollation = CASE
            WHEN expected.data_type = 'text' THEN (
              SELECT string_type.typcollation
              FROM pg_catalog.pg_type AS string_type
              WHERE string_type.oid = pg_catalog.to_regtype('text')
            )
            ELSE 0::oid
          END
          AND attribute_default.adbin IS NULL
        )
        AND (
          SELECT pg_catalog.count(*) = 32
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
      SELECT pg_catalog.count(*) = ${V2_FUNCTIONS.length}
        AND pg_catalog.bool_and(function_owner.rolname = ${
          cumulative ? owner : 'function_owner.rolname'
        })
        AND pg_catalog.bool_and(NOT procedure.proleakproof)
        AND pg_catalog.bool_and(
          procedure.prokind = 'f'
          AND procedure.prolang = (
            SELECT language.oid FROM pg_catalog.pg_language AS language
            WHERE language.lanname = 'plpgsql'
          )
          AND procedure.pronargdefaults = 0
          AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
        )
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
          WHEN pg_catalog.to_regprocedure('${SOLANA_IDENTITY}') THEN
            procedure.pronargs = 1
              AND procedure.proargtypes::text
                = pg_catalog.to_regtype('text')::oid::text
              AND procedure.proallargtypes IS NULL
              AND procedure.proargmodes IS NULL
              AND procedure.proargnames = ARRAY['requested_identity']::text[]
              AND NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND NOT procedure.proretset
              AND procedure.prorettype = pg_catalog.to_regtype('boolean')
              AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          WHEN pg_catalog.to_regprocedure('${VALIDATE_ENVELOPE}') THEN
            procedure.pronargs = 2
              AND procedure.proargtypes::text
                = pg_catalog.to_regtype('jsonb')::oid::text || ' '
                  || pg_catalog.to_regtype('timestamp with time zone')::oid::text
              AND procedure.proallargtypes IS NULL
              AND procedure.proargmodes IS NULL
              AND procedure.proargnames = ARRAY[
                'requested_envelope', 'requested_recorded_at'
              ]::text[]
              AND NOT procedure.prosecdef AND procedure.provolatile = 'i'
              AND procedure.proparallel = 's' AND procedure.proisstrict
              AND NOT procedure.proretset
              AND procedure.prorettype = pg_catalog.to_regtype('boolean')
              AND procedure.proconfig = ARRAY[
                'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
              ]::text[]
          WHEN pg_catalog.to_regprocedure('${RECORD_AGREEMENT}') THEN
            procedure.pronargs = 1
              AND procedure.proargtypes::text
                = pg_catalog.to_regtype('jsonb')::oid::text
              AND procedure.proallargtypes = ARRAY[
                pg_catalog.to_regtype('jsonb')::oid,
                pg_catalog.to_regtype('text')::oid,
                pg_catalog.to_regtype('text')::oid,
                pg_catalog.to_regtype('timestamp with time zone')::oid
              ]::oid[]
              AND procedure.proargmodes = ARRAY[
                'i'::"char", 't'::"char", 't'::"char", 't'::"char"
              ]::"char"[]
              AND procedure.proargnames = ARRAY[
                'requested_envelope', 'record_outcome',
                'recorded_agreement_fingerprint_sha256', 'evidence_recorded_at'
              ]::text[]
              AND procedure.prosecdef AND procedure.provolatile = 'v'
              AND procedure.proparallel = 'u' AND procedure.proisstrict
              AND procedure.proretset
              AND procedure.prorettype = pg_catalog.to_regtype('record')
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
          ${V2_FUNCTIONS.map(
            (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
          ).join(',\n          ')}
        )
    ) AS function_state
    CROSS JOIN (
      WITH expected(trigger_name, trigger_type) AS (VALUES
        ('balance_sync_financial_agreement_v2_append_only_row', 27::smallint),
        ('balance_sync_financial_agreement_v2_append_only_truncate', 34::smallint)
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
        )
        AND pg_catalog.bool_and(CASE
          WHEN constraint_record.contype <> 'c' THEN true
          WHEN constraint_record.conbin IS NULL THEN false
          ELSE COALESCE(
            pg_catalog.encode(
              pg_catalog.sha256(pg_catalog.convert_to(
                pg_catalog.pg_get_expr(
                  constraint_record.conbin, constraint_record.conrelid, false
                ),
                'UTF8'
              )),
              'hex'
            ) = CASE constraint_record.conname
              ${expectedCheckExpressionHashes}
              ELSE NULL
            END,
            false
          )
        END)
        AND pg_catalog.bool_and(CASE constraint_record.conname
          WHEN '${TABLE}_pkey' THEN constraint_record.contype = 'p'
            AND constraint_record.connoinherit
            AND constraint_record.conkey = ARRAY[1]::smallint[]
          WHEN 'balance_sync_financial_agreement_v2_wallet_scope_fk'
            THEN constraint_record.contype = 'f'
              AND constraint_record.connoinherit
              AND constraint_record.confrelid = pg_catalog.to_regclass('registered_wallets')
              AND constraint_record.conkey = ARRAY[7,6,8,9]::smallint[]
              AND constraint_record.confkey = ARRAY[1,2,4,5]::smallint[]
              AND constraint_record.confmatchtype = 's'
              AND constraint_record.confupdtype = 'r' AND constraint_record.confdeltype = 'r'
          WHEN 'balance_sync_financial_agreement_v2_static_state_check'
            THEN constraint_record.contype = 'c'
              AND NOT constraint_record.connoinherit
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'agreement_version = 2'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'approved_manifest_fingerprint_sha256'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'observed_identity_fingerprint_sha256'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'may_authorize_financial_action = false'
              ) > 0
          WHEN 'balance_sync_financial_agreement_v2_network_check'
            THEN constraint_record.contype = 'c'
              AND NOT constraint_record.connoinherit
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid), 'eip155:1'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
              ) > 0
          WHEN 'balance_sync_financial_agreement_v2_envelope_check'
            THEN constraint_record.contype = 'c'
              AND NOT constraint_record.connoinherit
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'mainnet_balance_financial_agreement_envelope_v2_valid'
              ) > 0
          WHEN 'balance_sync_financial_agreement_v2_column_binding_check'
            THEN constraint_record.contype = 'c'
              AND NOT constraint_record.connoinherit
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'approvedManifestFingerprintSha256'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_record.oid),
                'observedIdentityFingerprintSha256'
              ) > 0
          ELSE false
        END) AS valid
      FROM pg_catalog.pg_constraint AS constraint_record
      WHERE constraint_record.connamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
        AND constraint_record.conrelid = pg_catalog.to_regclass('${TABLE}')
        AND constraint_record.conname IN (
          '${TABLE}_pkey',
          'balance_sync_financial_agreement_v2_wallet_scope_fk',
          'balance_sync_financial_agreement_v2_static_state_check',
          'balance_sync_financial_agreement_v2_network_check',
          'balance_sync_financial_agreement_v2_envelope_check',
          'balance_sync_financial_agreement_v2_column_binding_check'
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
        FROM pg_catalog.pg_attribute AS guarded_attribute
        INNER JOIN pg_catalog.pg_class AS guarded_table
          ON guarded_table.oid = guarded_attribute.attrelid
        CROSS JOIN LATERAL pg_catalog.aclexplode(guarded_attribute.attacl) AS acl
        WHERE guarded_attribute.attrelid = pg_catalog.to_regclass('${TABLE}')
          AND guarded_attribute.attnum > 0
          AND NOT guarded_attribute.attisdropped
          AND acl.grantee <> guarded_table.relowner
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS guarded_function
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            guarded_function.proacl,
            pg_catalog.acldefault('f', guarded_function.proowner)
          )
        ) AS acl
        WHERE guarded_function.oid IN (
          ${V2_FUNCTIONS.map(
            (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
          ).join(',\n          ')}
        )
          AND acl.grantee <> guarded_function.proowner
      )
      AND ${guardedRoles
        .flatMap((role) => [
          `NOT pg_catalog.has_table_privilege(${role}, '${TABLE}', 'SELECT')`,
          ...V2_FUNCTIONS.map(
            (functionIdentity) =>
              `NOT pg_catalog.has_function_privilege(${role}, '${functionIdentity}', 'EXECUTE')`,
          ),
        ])
        .join('\n      AND ')} AS valid
    ) AS privilege_state`;
}

export function createMainnetBalanceAgreementEvidenceV2Migration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  const parts = createV2SqlParts(names);
  return {
    id: '0032',
    description:
      'create dormant owner-only deployment-aware mainnet balance agreement evidence v2 boundary',
    upSql: createUpSql(names, parts),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative, parts),
    supersedesVerificationOf: ['0031'],
  };
}

export const createMainnetBalanceAgreementEvidenceV2MigrationV0032 =
  createMainnetBalanceAgreementEvidenceV2Migration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032 =
  createMainnetBalanceAgreementEvidenceV2Migration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
