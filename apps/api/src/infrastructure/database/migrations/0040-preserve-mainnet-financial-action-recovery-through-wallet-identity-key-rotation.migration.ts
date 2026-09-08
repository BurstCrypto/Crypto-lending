import { createHash } from 'node:crypto';

import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createVerifiedMainnetSignedSubmissionProofMigration } from './0039-persist-verified-mainnet-signed-submission-proof.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const RECOVERY_TABLE = 'mainnet_financial_action_revoked_wallet_recovery_aliases';
const RECOVERY_MANIFEST =
  'crypto-lending:mainnet-action-revoked-wallet-recovery-alias:v1;active-write-version-only;eligible-unresolved-signed-bound-only;append-only;owner-only;digest-only;no-wallet-reactivation-login-network-sign-broadcast-resend-or-settlement-authority';
const RECOVERY_GUARD = 'enforce_revoked_mainnet_action_recovery_alias_v1';
const RECOVERY_FUNCTION = 'ensure_revoked_mainnet_action_recovery_alias_v1';
const RECOVERY_READINESS_GUARD = 'require_revoked_mainnet_action_recovery_readiness_v1';
const RECOVERY_GUARD_IDENTITY = `${RECOVERY_GUARD}()`;
const RECOVERY_FUNCTION_IDENTITY = `${RECOVERY_FUNCTION}(uuid,uuid,uuid,bigint,text,smallint,text)`;
const RECOVERY_READINESS_GUARD_IDENTITY = `${RECOVERY_READINESS_GUARD}()`;
const RECOVERY_FINGERPRINT_DOMAIN =
  'CRYPTO_LENDING:MAINNET_ACTION:REVOKED_WALLET_RECOVERY_ALIAS:FRAMED:v1';
// "CRMARFP" followed by the binary encoding version. Every field below is
// length-framed, non-null, and ordered; this avoids widening migration 0033's
// deliberately closed fingerprint-domain allowlist.
const RECOVERY_FINGERPRINT_FRAME_PREFIX_HEX = '43524d4152465001';
const CONSTRAINT_CATALOG_SHA256 =
  '2ee772bc204dc39503e465d7aabd88106ff7fa16be3b1039aed84e8d88f918b3';
const READINESS_TRIGGER_DEFINITION_SHA256 =
  'def13f185661eacd3e405dba62b090e79dfdd4f301d64d196eade5a460574ce6';

const RECOVERY_COLUMNS = Object.freeze([
  ['account_id', 'uuid', true],
  ['triggering_intent_id', 'uuid', true],
  ['intent_record_fingerprint_sha256', 'text', true],
  ['wallet_id', 'uuid', true],
  ['network_id', 'text', true],
  ['address_digest_version', 'smallint', true],
  ['active_address_digest', 'bytea', true],
  ['triggering_event_revision', 'bigint', true],
  ['triggering_event_snapshot_sha256', 'text', true],
  ['triggering_event_transition_fingerprint_sha256', 'text', true],
  ['triggering_event_stage', 'text', true],
  ['signed_event_revision', 'bigint', true],
  ['signed_event_transition_fingerprint_sha256', 'text', true],
  ['signed_submission_proof_fingerprint_sha256', 'text', true],
  ['wallet_registered_at', 'timestamp with time zone', true],
  ['wallet_revoked_at', 'timestamp with time zone', true],
  ['signed_bound_recorded_at', 'timestamp with time zone', true],
  ['triggering_event_recorded_at', 'timestamp with time zone', true],
  ['key_policy_updated_at', 'timestamp with time zone', true],
  ['recovered_at', 'timestamp with time zone', true],
  ['recovery_fingerprint_sha256', 'text', true],
] as const);

const RECOVERY_ARGUMENTS = Object.freeze([
  ['requested_account_id', 'uuid'],
  ['requested_intent_id', 'uuid'],
  ['requested_wallet_id', 'uuid'],
  ['requested_lifecycle_revision', 'bigint'],
  ['requested_lifecycle_snapshot_sha256', 'text'],
  ['requested_active_write_version', 'smallint'],
  ['requested_active_write_digest_hex', 'text'],
] as const);

const RECOVERY_RESULT = `
      recovery_outcome text,
      ready_account_id uuid,
      ready_intent_id uuid,
      ready_wallet_id uuid,
      ready_network_id text,
      ready_lifecycle_revision bigint,
      ready_lifecycle_snapshot_sha256 text,
      ready_lifecycle_stage text,
      ready_active_write_version smallint,
      ready_recovered_at timestamptz,
      ready_recovery_fingerprint_sha256 text`;

const FINGERPRINT_FIELD_NAMES = Object.freeze([
  'fingerprintEncodingVersion',
  'accountId',
  'intentId',
  'intentRecordFingerprintSha256',
  'walletId',
  'networkId',
  'activeWriteVersion',
  'activeWriteDigestHex',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'lifecycleTransitionFingerprintSha256',
  'lifecycleStage',
  'signedEventRevision',
  'signedEventTransitionFingerprintSha256',
  'signedSubmissionProofFingerprintSha256',
  'walletRegisteredAtEpochMilliseconds',
  'walletRevokedAtEpochMilliseconds',
  'signedBoundRecordedAtEpochMilliseconds',
  'lifecycleEventRecordedAtEpochMilliseconds',
  'keyPolicyUpdatedAtEpochMilliseconds',
  'recoveredAtEpochMilliseconds',
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
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0040 predecessor verifier anchor mismatch');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function epochMilliseconds(value: string): string {
  return `((pg_catalog.date_part('epoch', ${value}) * 1000)::bigint)::text`;
}

function framedFingerprintField(name: string, value: string): string {
  return `pg_catalog.int2send(${String(Buffer.byteLength(name, 'utf8'))}::smallint)
          || pg_catalog.convert_to('${name}', 'UTF8')
          || pg_catalog.decode('01', 'hex')
          || pg_catalog.int4send(pg_catalog.octet_length(pg_catalog.convert_to(${value}, 'UTF8')))
          || pg_catalog.convert_to(${value}, 'UTF8')`;
}

function recoveryFingerprint(prefix: string): string {
  const values = [
    `'1'`,
    `${prefix}.account_id::text`,
    `${prefix}.triggering_intent_id::text`,
    `${prefix}.intent_record_fingerprint_sha256`,
    `${prefix}.wallet_id::text`,
    `${prefix}.network_id`,
    `${prefix}.address_digest_version::text`,
    `pg_catalog.encode(${prefix}.active_address_digest, 'hex')`,
    `${prefix}.triggering_event_revision::text`,
    `${prefix}.triggering_event_snapshot_sha256`,
    `${prefix}.triggering_event_transition_fingerprint_sha256`,
    `${prefix}.triggering_event_stage`,
    `${prefix}.signed_event_revision::text`,
    `${prefix}.signed_event_transition_fingerprint_sha256`,
    `${prefix}.signed_submission_proof_fingerprint_sha256`,
    epochMilliseconds(`${prefix}.wallet_registered_at`),
    epochMilliseconds(`${prefix}.wallet_revoked_at`),
    epochMilliseconds(`${prefix}.signed_bound_recorded_at`),
    epochMilliseconds(`${prefix}.triggering_event_recorded_at`),
    epochMilliseconds(`${prefix}.key_policy_updated_at`),
    epochMilliseconds(`${prefix}.recovered_at`),
  ];
  if (values.length !== FINGERPRINT_FIELD_NAMES.length) {
    throw new Error('Migration 0040 recovery fingerprint field mismatch');
  }
  const framedFields = [
    framedFingerprintField('domain', `'${RECOVERY_FINGERPRINT_DOMAIN}'`),
    ...FINGERPRINT_FIELD_NAMES.map((name, index) =>
      framedFingerprintField(name, values[index] ?? 'NULL::text'),
    ),
  ];
  return `pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.decode('${RECOVERY_FINGERPRINT_FRAME_PREFIX_HEX}', 'hex')
          || ${framedFields.join('\n          || ')}
      ), 'hex')`;
}

function missingRecoveryReadiness(activeWriteVersion: string): string {
  return `EXISTS (
        SELECT 1
        FROM mainnet_financial_action_intents AS intent
        INNER JOIN registered_wallets AS wallet
          ON wallet.wallet_id = intent.wallet_id
          AND wallet.account_id = intent.account_id
          AND wallet.chain_namespace = intent.wallet_chain_namespace
          AND wallet.chain_reference = intent.wallet_chain_reference
        CROSS JOIN LATERAL (
          SELECT event.*
          FROM mainnet_financial_action_events AS event
          WHERE event.intent_id = intent.intent_id
          ORDER BY event.revision DESC LIMIT 1
        ) AS current_event
        INNER JOIN mainnet_financial_action_events AS signed_event
          ON signed_event.intent_id = intent.intent_id
          AND signed_event.revision = 2
          AND signed_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
        INNER JOIN mainnet_financial_action_signed_submission_proofs AS proof
          ON proof.intent_id = signed_event.intent_id
          AND proof.event_revision = signed_event.revision
          AND proof.event_id = signed_event.event_id
          AND proof.event_transition_fingerprint_sha256 =
            signed_event.transition_fingerprint_sha256
          AND proof.intent_record_fingerprint_sha256 = intent.intent_record_fingerprint_sha256
          AND proof.network_id = signed_event.network_id
          AND proof.chain_transaction_id = signed_event.chain_transaction_id
          AND proof.transaction_identity_sha256 = signed_event.transaction_identity_sha256
          AND proof.signing_payload_sha256 = signed_event.wallet_signed_payload_sha256
          AND proof.signature_evidence_sha256 = signed_event.wallet_signature_evidence_sha256
        WHERE wallet.status = 'REVOKED' AND wallet.revoked_at IS NOT NULL
          AND wallet.registry_environment = 'MAINNET' AND wallet.registry_version = 1
          AND wallet.address_digest_version = intent.wallet_identity_digest_version
          AND wallet.address_digest = pg_catalog.decode(intent.wallet_identity_digest_hex, 'hex')
          AND (
            (intent.network_id = '${ETHEREUM}'
              AND wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
            OR
            (intent.network_id = '${SOLANA}'
              AND wallet.chain_namespace = 'solana'
              AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
          )
          AND current_event.stage IN (
            'WALLET_SIGNED_SUBMISSION_BOUND',
            'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
          )
          AND NOT current_event.terminal
          AND NOT current_event.requires_manual_reconciliation
          AND current_event.chain_transaction_id = signed_event.chain_transaction_id
          AND current_event.transaction_identity_sha256 =
            signed_event.transaction_identity_sha256
          AND signed_event.recorded_at <= wallet.revoked_at
          AND (
            NOT EXISTS (
              SELECT 1
              FROM registered_wallet_identity_digests AS historical_identity
              WHERE historical_identity.wallet_id = wallet.wallet_id
                AND historical_identity.account_id = wallet.account_id
                AND historical_identity.chain_namespace = wallet.chain_namespace
                AND historical_identity.chain_reference = wallet.chain_reference
                AND historical_identity.address_digest_version =
                  intent.wallet_identity_digest_version
                AND historical_identity.address_digest = wallet.address_digest
                AND historical_identity.status = 'REVOKED'
                AND historical_identity.registered_at = wallet.registered_at
                AND historical_identity.revoked_at = wallet.revoked_at
            )
            OR NOT (
              EXISTS (
                SELECT 1
                FROM registered_wallet_identity_digests AS active_identity
                INNER JOIN wallet_ownership_challenge_identity_digests AS challenge_identity
                  ON challenge_identity.account_id = wallet.account_id
                  AND challenge_identity.chain_namespace = wallet.chain_namespace
                  AND challenge_identity.chain_reference = wallet.chain_reference
                  AND challenge_identity.address_digest_version =
                    active_identity.address_digest_version
                  AND challenge_identity.address_digest = active_identity.address_digest
                INNER JOIN wallet_ownership_challenges AS challenge
                  ON challenge.challenge_id = challenge_identity.challenge_id
                  AND challenge.account_id = challenge_identity.account_id
                  AND challenge.chain_namespace = challenge_identity.chain_namespace
                  AND challenge.chain_reference = challenge_identity.chain_reference
                  AND challenge.status = 'REGISTERED'
                  AND challenge.completed_at IS NOT NULL
                  AND challenge.payload_destroyed_at = challenge.completed_at
                  AND challenge.challenge_payload_key_version IS NULL
                  AND challenge.challenge_payload_ciphertext IS NULL
                  AND challenge.challenge_payload_iv IS NULL
                  AND challenge.challenge_payload_auth_tag IS NULL
                INNER JOIN wallet_registration_audit_events AS registration_audit
                  ON registration_audit.challenge_id = challenge.challenge_id
                  AND registration_audit.wallet_id = wallet.wallet_id
                  AND registration_audit.account_id = wallet.account_id
                  AND registration_audit.event_type IN (
                    'WALLET_REGISTERED', 'WALLET_ALREADY_REGISTERED'
                  )
                  AND registration_audit.outcome = 'SUCCEEDED'
                  AND registration_audit.reason_code = 'NONE'
                  AND registration_audit.occurred_at = challenge.completed_at
                WHERE active_identity.wallet_id = wallet.wallet_id
                  AND active_identity.account_id = wallet.account_id
                  AND active_identity.chain_namespace = wallet.chain_namespace
                  AND active_identity.chain_reference = wallet.chain_reference
                  AND active_identity.address_digest_version = ${activeWriteVersion}
                  AND active_identity.status = 'REVOKED'
                  AND active_identity.registered_at = wallet.registered_at
                  AND active_identity.revoked_at = wallet.revoked_at
              )
              OR EXISTS (
                SELECT 1
                FROM registered_wallet_identity_digests AS active_identity
                INNER JOIN ${RECOVERY_TABLE} AS audit
                  ON audit.wallet_id = active_identity.wallet_id
                  AND audit.account_id = active_identity.account_id
                  AND audit.address_digest_version = active_identity.address_digest_version
                  AND audit.active_address_digest = active_identity.address_digest
                  AND audit.triggering_intent_id = intent.intent_id
                  AND audit.intent_record_fingerprint_sha256 =
                    intent.intent_record_fingerprint_sha256
                  AND audit.network_id = intent.network_id
                  AND audit.triggering_event_revision = current_event.revision
                  AND audit.triggering_event_snapshot_sha256 = current_event.snapshot_sha256
                  AND audit.triggering_event_transition_fingerprint_sha256 =
                    current_event.transition_fingerprint_sha256
                  AND audit.triggering_event_stage = current_event.stage
                  AND audit.signed_event_revision = signed_event.revision
                  AND audit.signed_event_transition_fingerprint_sha256 =
                    signed_event.transition_fingerprint_sha256
                  AND audit.signed_submission_proof_fingerprint_sha256 =
                    proof.proof_fingerprint_sha256
                  AND audit.wallet_registered_at = wallet.registered_at
                  AND audit.wallet_revoked_at = wallet.revoked_at
                  AND audit.signed_bound_recorded_at = signed_event.recorded_at
                  AND audit.triggering_event_recorded_at = current_event.recorded_at
                  AND audit.recovery_fingerprint_sha256 = ${recoveryFingerprint('audit')}
                WHERE active_identity.wallet_id = wallet.wallet_id
                  AND active_identity.account_id = wallet.account_id
                  AND active_identity.chain_namespace = wallet.chain_namespace
                  AND active_identity.chain_reference = wallet.chain_reference
                  AND active_identity.address_digest_version = ${activeWriteVersion}
                  AND active_identity.status = 'REVOKED'
                  AND active_identity.registered_at = wallet.registered_at
                  AND active_identity.revoked_at = wallet.revoked_at
              )
            )
          )
      )`;
}

const RECOVERY_GUARD_BODY = `
    DECLARE
      expected_fingerprint text;
    BEGIN
      expected_fingerprint := ${recoveryFingerprint('NEW')};
      IF NEW.recovery_fingerprint_sha256 IS DISTINCT FROM expected_fingerprint
        OR NOT EXISTS (
          SELECT 1
          FROM mainnet_financial_action_intents AS intent
          INNER JOIN registered_wallets AS wallet
            ON wallet.wallet_id = NEW.wallet_id
            AND wallet.account_id = NEW.account_id
          INNER JOIN registered_wallet_identity_digests AS historical_identity
            ON historical_identity.wallet_id = wallet.wallet_id
            AND historical_identity.account_id = wallet.account_id
            AND historical_identity.chain_namespace = wallet.chain_namespace
            AND historical_identity.chain_reference = wallet.chain_reference
            AND historical_identity.address_digest_version =
              intent.wallet_identity_digest_version
            AND historical_identity.address_digest = pg_catalog.decode(
              intent.wallet_identity_digest_hex, 'hex'
            )
            AND historical_identity.status = 'REVOKED'
            AND historical_identity.registered_at = wallet.registered_at
            AND historical_identity.revoked_at = wallet.revoked_at
          INNER JOIN registered_wallet_identity_digests AS active_identity
            ON active_identity.wallet_id = wallet.wallet_id
            AND active_identity.account_id = wallet.account_id
            AND active_identity.chain_namespace = wallet.chain_namespace
            AND active_identity.chain_reference = wallet.chain_reference
            AND active_identity.address_digest_version = NEW.address_digest_version
            AND active_identity.address_digest = NEW.active_address_digest
            AND active_identity.status = 'REVOKED'
            AND active_identity.registered_at = wallet.registered_at
            AND active_identity.revoked_at = wallet.revoked_at
          INNER JOIN wallet_identity_key_policy AS key_policy
            ON key_policy.policy_name = 'wallet-registration-identity-hmac'
            AND key_policy.schema_version = 1
            AND key_policy.active_write_version = NEW.address_digest_version
            AND key_policy.active_write_version = ANY(key_policy.accepted_read_versions)
            AND key_policy.updated_at = NEW.key_policy_updated_at
          INNER JOIN mainnet_financial_action_events AS triggering_event
            ON triggering_event.intent_id = intent.intent_id
            AND triggering_event.revision = NEW.triggering_event_revision
            AND triggering_event.snapshot_sha256 = NEW.triggering_event_snapshot_sha256
            AND triggering_event.transition_fingerprint_sha256 =
              NEW.triggering_event_transition_fingerprint_sha256
            AND triggering_event.stage = NEW.triggering_event_stage
            AND triggering_event.recorded_at = NEW.triggering_event_recorded_at
          INNER JOIN mainnet_financial_action_events AS signed_event
            ON signed_event.intent_id = intent.intent_id
            AND signed_event.revision = NEW.signed_event_revision
            AND signed_event.transition_fingerprint_sha256 =
              NEW.signed_event_transition_fingerprint_sha256
            AND signed_event.recorded_at = NEW.signed_bound_recorded_at
          INNER JOIN mainnet_financial_action_signed_submission_proofs AS proof
            ON proof.intent_id = signed_event.intent_id
            AND proof.event_revision = signed_event.revision
            AND proof.event_id = signed_event.event_id
            AND proof.event_transition_fingerprint_sha256 =
              signed_event.transition_fingerprint_sha256
            AND proof.intent_record_fingerprint_sha256 =
              intent.intent_record_fingerprint_sha256
            AND proof.network_id = signed_event.network_id
            AND proof.chain_transaction_id = signed_event.chain_transaction_id
            AND proof.transaction_identity_sha256 = signed_event.transaction_identity_sha256
            AND proof.signing_payload_sha256 = signed_event.wallet_signed_payload_sha256
            AND proof.signature_evidence_sha256 = signed_event.wallet_signature_evidence_sha256
            AND proof.proof_fingerprint_sha256 =
              NEW.signed_submission_proof_fingerprint_sha256
          WHERE intent.intent_id = NEW.triggering_intent_id
            AND intent.account_id = NEW.account_id
            AND intent.wallet_id = NEW.wallet_id
            AND intent.intent_record_fingerprint_sha256 =
              NEW.intent_record_fingerprint_sha256
            AND intent.network_id = NEW.network_id
            AND intent.wallet_chain_namespace = wallet.chain_namespace
            AND intent.wallet_chain_reference = wallet.chain_reference
            AND wallet.status = 'REVOKED'
            AND wallet.revoked_at IS NOT NULL
            AND wallet.registered_at = NEW.wallet_registered_at
            AND wallet.revoked_at = NEW.wallet_revoked_at
            AND wallet.address_digest_version = intent.wallet_identity_digest_version
            AND wallet.address_digest = pg_catalog.decode(
              intent.wallet_identity_digest_hex, 'hex'
            )
            AND wallet.registry_environment = 'MAINNET'
            AND wallet.registry_version = 1
            AND (
              (intent.network_id = '${ETHEREUM}'
                AND wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
              OR
              (intent.network_id = '${SOLANA}'
                AND wallet.chain_namespace = 'solana'
                AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
            )
            AND triggering_event.stage IN (
              'WALLET_SIGNED_SUBMISSION_BOUND',
              'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
            )
            AND NOT triggering_event.terminal
            AND NOT triggering_event.requires_manual_reconciliation
            AND triggering_event.chain_transaction_id = signed_event.chain_transaction_id
            AND triggering_event.transaction_identity_sha256 =
              signed_event.transaction_identity_sha256
            AND signed_event.revision = 2
            AND signed_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
            AND signed_event.chain_transaction_id IS NOT NULL
            AND signed_event.wallet_signed_payload_sha256 IS NOT NULL
            AND signed_event.wallet_signature_evidence_sha256 IS NOT NULL
            AND signed_event.wallet_signed_payload_sha256 <>
              signed_event.wallet_signature_evidence_sha256
            AND signed_event.recorded_at <= wallet.revoked_at
            AND wallet.registered_at <= signed_event.recorded_at
            AND signed_event.recorded_at <= triggering_event.recorded_at
            AND triggering_event.recorded_at <= NEW.recovered_at
            AND key_policy.updated_at <= NEW.recovered_at
            AND NOT EXISTS (
              SELECT 1
              FROM mainnet_financial_action_events AS later_event
              WHERE later_event.intent_id = triggering_event.intent_id
                AND later_event.revision > triggering_event.revision
                AND later_event.recorded_at <= NEW.recovered_at
            )
        )
      THEN
        RAISE EXCEPTION 'revoked wallet recovery alias audit is invalid'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;`;

const RECOVERY_READINESS_GUARD_BODY = `
    DECLARE
      current_policy wallet_identity_key_policy%ROWTYPE;
    BEGIN
      IF OLD.active_write_version IS NOT DISTINCT FROM NEW.active_write_version THEN
        RETURN NEW;
      END IF;
      IF NEW.policy_name <> 'wallet-registration-identity-hmac'
        OR NEW.schema_version <> 1
        OR NEW.active_write_version <= OLD.active_write_version
        OR NEW.active_write_version <>
          NEW.accepted_read_versions[pg_catalog.cardinality(NEW.accepted_read_versions)]
        OR NOT (NEW.active_write_version = ANY(NEW.accepted_read_versions))
        OR NOT pg_catalog.isfinite(NEW.updated_at)
        OR pg_catalog.date_trunc('milliseconds', NEW.updated_at) <> NEW.updated_at
        OR NEW.updated_at <= OLD.updated_at
      THEN
        RAISE EXCEPTION 'invalid wallet identity active-version transition'
          USING ERRCODE = '55000';
      END IF;

      -- These SHARE locks make the commit-time global eligibility snapshot stable.
      LOCK TABLE
        mainnet_financial_action_intents,
        mainnet_financial_action_events,
        mainnet_financial_action_signed_submission_proofs,
        registered_wallets,
        wallet_ownership_challenge_identity_digests,
        wallet_ownership_challenges,
        wallet_registration_audit_events,
        registered_wallet_identity_digests,
        ${RECOVERY_TABLE}
      IN SHARE MODE;

      SELECT policy.* INTO current_policy
      FROM wallet_identity_key_policy AS policy
      WHERE policy.policy_name = NEW.policy_name
      FOR SHARE;
      -- A later update in the same transaction owns the final deferred check.
      IF NOT FOUND OR current_policy.active_write_version <> NEW.active_write_version THEN
        RETURN NEW;
      END IF;

      IF ${missingRecoveryReadiness('NEW.active_write_version')} THEN
        RAISE EXCEPTION 'wallet identity rotation would strand revoked signed-bound recovery'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;`;

const RECOVERY_FUNCTION_BODY = `
    DECLARE
      selected_intent mainnet_financial_action_intents%ROWTYPE;
      target_wallet registered_wallets%ROWTYPE;
      key_policy wallet_identity_key_policy%ROWTYPE;
      historical_identity registered_wallet_identity_digests%ROWTYPE;
      verification_identity registered_wallet_identity_digests%ROWTYPE;
      current_event mainnet_financial_action_events%ROWTYPE;
      signed_event mainnet_financial_action_events%ROWTYPE;
      signed_proof mainnet_financial_action_signed_submission_proofs%ROWTYPE;
      existing_recovery ${RECOVERY_TABLE}%ROWTYPE;
      created_recovery ${RECOVERY_TABLE}%ROWTYPE;
      database_recovered_at timestamptz;
      alias_was_backfilled boolean := false;
    BEGIN
      IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
        OR pg_catalog.substring(requested_account_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_account_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.substring(requested_intent_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_intent_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.substring(requested_wallet_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_wallet_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
        OR requested_lifecycle_revision < 2
        OR requested_lifecycle_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_lifecycle_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_active_write_version <= 0
        OR requested_active_write_digest_hex !~ '^[0-9a-f]{64}$'
      THEN
        RAISE EXCEPTION 'invalid revoked wallet recovery alias request'
          USING ERRCODE = '22023';
      END IF;

      -- Event append is serialized on this immutable intent row by migration 0033.
      SELECT intent.* INTO selected_intent
      FROM mainnet_financial_action_intents AS intent
      WHERE intent.intent_id = requested_intent_id
        AND intent.account_id = requested_account_id
        AND intent.wallet_id = requested_wallet_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'revoked wallet recovery obligation is unavailable'
          USING ERRCODE = '55000';
      END IF;

      -- Match revocation/challenge ordering before taking wallet and identity locks.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_account_id::text, 56001)
      );

      SELECT wallet.* INTO target_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id
        AND wallet.account_id = requested_account_id
      FOR UPDATE;
      IF NOT FOUND
        OR target_wallet.status <> 'REVOKED'
        OR target_wallet.revoked_at IS NULL
        OR target_wallet.address_digest_version < 1
        OR target_wallet.address_digest_version <>
          selected_intent.wallet_identity_digest_version
        OR pg_catalog.encode(target_wallet.address_digest, 'hex') <>
          selected_intent.wallet_identity_digest_hex
        OR target_wallet.chain_namespace <> selected_intent.wallet_chain_namespace
        OR target_wallet.chain_reference <> selected_intent.wallet_chain_reference
        OR target_wallet.registry_environment <> 'MAINNET'
        OR target_wallet.registry_version <> 1
        OR NOT (
          (selected_intent.network_id = '${ETHEREUM}'
            AND target_wallet.chain_namespace = 'eip155'
            AND target_wallet.chain_reference = '1')
          OR
          (selected_intent.network_id = '${SOLANA}'
            AND target_wallet.chain_namespace = 'solana'
            AND target_wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        )
      THEN
        RAISE EXCEPTION 'revoked wallet recovery identity is unavailable'
          USING ERRCODE = '55000';
      END IF;

      SELECT policy.* INTO key_policy
      FROM wallet_identity_key_policy AS policy
      WHERE policy.policy_name = 'wallet-registration-identity-hmac'
        AND policy.schema_version = 1
        AND policy.active_write_version = requested_active_write_version
        AND policy.active_write_version = ANY(policy.accepted_read_versions)
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'active wallet identity write version is unavailable'
          USING ERRCODE = '55000';
      END IF;

      SELECT identity.* INTO historical_identity
      FROM registered_wallet_identity_digests AS identity
      WHERE identity.wallet_id = target_wallet.wallet_id
        AND identity.account_id = target_wallet.account_id
        AND identity.chain_namespace = target_wallet.chain_namespace
        AND identity.chain_reference = target_wallet.chain_reference
        AND identity.address_digest_version = selected_intent.wallet_identity_digest_version
        AND identity.address_digest = target_wallet.address_digest
        AND identity.status = 'REVOKED'
        AND identity.registered_at = target_wallet.registered_at
        AND identity.revoked_at = target_wallet.revoked_at
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'historical wallet recovery identity is unavailable'
          USING ERRCODE = '55000';
      END IF;
      IF requested_active_write_version <= historical_identity.address_digest_version THEN
        RAISE EXCEPTION 'active wallet identity recovery material is not a forward rotation'
          USING ERRCODE = '22023';
      END IF;
      PERFORM identity.wallet_id
      FROM registered_wallet_identity_digests AS identity
      WHERE identity.wallet_id = target_wallet.wallet_id
        AND identity.address_digest_version < requested_active_write_version
        AND identity.address_digest = pg_catalog.decode(
          requested_active_write_digest_hex, 'hex'
        )
      FOR SHARE;
      IF FOUND THEN
        RAISE EXCEPTION 'active wallet identity recovery material is not a forward rotation'
          USING ERRCODE = '22023';
      END IF;

      -- Serialize this exact new-version HMAC identity against wallet registration.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          target_wallet.chain_namespace || ':' || target_wallet.chain_reference || ':'
            || requested_active_write_version::text || ':'
            || requested_active_write_digest_hex,
          56002
        )
      );

      SELECT identity.* INTO verification_identity
      FROM registered_wallet_identity_digests AS identity
      WHERE identity.wallet_id = target_wallet.wallet_id
        AND identity.address_digest_version = requested_active_write_version
      FOR SHARE;

      SELECT recovery.* INTO existing_recovery
      FROM ${RECOVERY_TABLE} AS recovery
      WHERE recovery.triggering_intent_id = requested_intent_id
        AND recovery.triggering_event_revision = requested_lifecycle_revision
        AND recovery.address_digest_version = requested_active_write_version
      FOR SHARE;
      IF FOUND THEN
        IF existing_recovery.account_id <> requested_account_id
          OR existing_recovery.wallet_id <> requested_wallet_id
          OR existing_recovery.triggering_event_snapshot_sha256 <>
            requested_lifecycle_snapshot_sha256
          OR existing_recovery.active_address_digest <>
            pg_catalog.decode(requested_active_write_digest_hex, 'hex')
          OR verification_identity.wallet_id IS NULL
          OR verification_identity.account_id <> target_wallet.account_id
          OR verification_identity.chain_namespace <> target_wallet.chain_namespace
          OR verification_identity.chain_reference <> target_wallet.chain_reference
          OR verification_identity.address_digest <>
            pg_catalog.decode(requested_active_write_digest_hex, 'hex')
          OR verification_identity.status <> 'REVOKED'
          OR verification_identity.registered_at <> target_wallet.registered_at
          OR verification_identity.revoked_at <> target_wallet.revoked_at
        THEN
          RAISE EXCEPTION 'revoked wallet recovery alias replay conflicts'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT
          'REPLAYED'::text,
          existing_recovery.account_id,
          existing_recovery.triggering_intent_id,
          existing_recovery.wallet_id,
          existing_recovery.network_id,
          existing_recovery.triggering_event_revision,
          existing_recovery.triggering_event_snapshot_sha256,
          existing_recovery.triggering_event_stage,
          existing_recovery.address_digest_version,
          existing_recovery.recovered_at,
          existing_recovery.recovery_fingerprint_sha256;
        RETURN;
      END IF;

      SELECT event.* INTO current_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
      ORDER BY event.revision DESC LIMIT 1
      FOR SHARE;
      SELECT event.* INTO signed_event
      FROM mainnet_financial_action_events AS event
      WHERE event.intent_id = selected_intent.intent_id
        AND event.revision = 2
        AND event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
      FOR SHARE;
      IF current_event.intent_id IS NULL
        OR signed_event.intent_id IS NULL
        OR current_event.revision <> requested_lifecycle_revision
        OR current_event.snapshot_sha256 <> requested_lifecycle_snapshot_sha256
        OR current_event.stage NOT IN (
          'WALLET_SIGNED_SUBMISSION_BOUND',
          'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
        )
        OR current_event.terminal
        OR current_event.requires_manual_reconciliation
        OR signed_event.chain_transaction_id IS NULL
        OR signed_event.wallet_signed_payload_sha256 IS NULL
        OR signed_event.wallet_signature_evidence_sha256 IS NULL
        OR signed_event.wallet_signed_payload_sha256 =
          signed_event.wallet_signature_evidence_sha256
        OR current_event.chain_transaction_id IS DISTINCT FROM signed_event.chain_transaction_id
        OR current_event.transaction_identity_sha256 IS DISTINCT FROM
          signed_event.transaction_identity_sha256
        OR signed_event.recorded_at > target_wallet.revoked_at
      THEN
        RAISE EXCEPTION 'revoked wallet recovery obligation is not eligible'
          USING ERRCODE = '55000';
      END IF;

      SELECT proof.* INTO signed_proof
      FROM mainnet_financial_action_signed_submission_proofs AS proof
      WHERE proof.intent_id = signed_event.intent_id
        AND proof.event_revision = signed_event.revision
        AND proof.event_id = signed_event.event_id
        AND proof.event_transition_fingerprint_sha256 =
          signed_event.transition_fingerprint_sha256
        AND proof.intent_record_fingerprint_sha256 =
          selected_intent.intent_record_fingerprint_sha256
        AND proof.network_id = signed_event.network_id
        AND proof.chain_transaction_id = signed_event.chain_transaction_id
        AND proof.transaction_identity_sha256 = signed_event.transaction_identity_sha256
        AND proof.signing_payload_sha256 = signed_event.wallet_signed_payload_sha256
        AND proof.signature_evidence_sha256 = signed_event.wallet_signature_evidence_sha256
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'verified signed-submission proof is unavailable'
          USING ERRCODE = '55000';
      END IF;

      IF verification_identity.wallet_id IS NOT NULL THEN
        IF verification_identity.account_id <> target_wallet.account_id
          OR verification_identity.chain_namespace <> target_wallet.chain_namespace
          OR verification_identity.chain_reference <> target_wallet.chain_reference
          OR verification_identity.address_digest <>
            pg_catalog.decode(requested_active_write_digest_hex, 'hex')
          OR verification_identity.status <> 'REVOKED'
          OR verification_identity.registered_at <> target_wallet.registered_at
          OR verification_identity.revoked_at <> target_wallet.revoked_at
        THEN
          RAISE EXCEPTION 'active-version recovery alias conflicts'
            USING ERRCODE = '23505';
        END IF;
      ELSE
        INSERT INTO registered_wallet_identity_digests (
          wallet_id, account_id, chain_namespace, chain_reference,
          address_digest_version, address_digest, status, registered_at, revoked_at
        ) VALUES (
          target_wallet.wallet_id, target_wallet.account_id,
          target_wallet.chain_namespace, target_wallet.chain_reference,
          requested_active_write_version,
          pg_catalog.decode(requested_active_write_digest_hex, 'hex'),
          'REVOKED', target_wallet.registered_at, target_wallet.revoked_at
        );
        alias_was_backfilled := true;
      END IF;

      database_recovered_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF database_recovered_at < target_wallet.revoked_at
        OR database_recovered_at < current_event.recorded_at
        OR database_recovered_at < key_policy.updated_at
      THEN
        RAISE EXCEPTION 'database recovery clock is invalid'
          USING ERRCODE = '55000';
      END IF;

      created_recovery.account_id := selected_intent.account_id;
      created_recovery.triggering_intent_id := selected_intent.intent_id;
      created_recovery.intent_record_fingerprint_sha256 :=
        selected_intent.intent_record_fingerprint_sha256;
      created_recovery.wallet_id := target_wallet.wallet_id;
      created_recovery.network_id := selected_intent.network_id;
      created_recovery.address_digest_version := requested_active_write_version;
      created_recovery.active_address_digest :=
        pg_catalog.decode(requested_active_write_digest_hex, 'hex');
      created_recovery.triggering_event_revision := current_event.revision;
      created_recovery.triggering_event_snapshot_sha256 := current_event.snapshot_sha256;
      created_recovery.triggering_event_transition_fingerprint_sha256 :=
        current_event.transition_fingerprint_sha256;
      created_recovery.triggering_event_stage := current_event.stage;
      created_recovery.signed_event_revision := signed_event.revision;
      created_recovery.signed_event_transition_fingerprint_sha256 :=
        signed_event.transition_fingerprint_sha256;
      created_recovery.signed_submission_proof_fingerprint_sha256 :=
        signed_proof.proof_fingerprint_sha256;
      created_recovery.wallet_registered_at := target_wallet.registered_at;
      created_recovery.wallet_revoked_at := target_wallet.revoked_at;
      created_recovery.signed_bound_recorded_at := signed_event.recorded_at;
      created_recovery.triggering_event_recorded_at := current_event.recorded_at;
      created_recovery.key_policy_updated_at := key_policy.updated_at;
      created_recovery.recovered_at := database_recovered_at;
      created_recovery.recovery_fingerprint_sha256 :=
        ${recoveryFingerprint('created_recovery')};

      INSERT INTO ${RECOVERY_TABLE} (
        account_id, triggering_intent_id, intent_record_fingerprint_sha256,
        wallet_id, network_id, address_digest_version, active_address_digest,
        triggering_event_revision, triggering_event_snapshot_sha256,
        triggering_event_transition_fingerprint_sha256, triggering_event_stage,
        signed_event_revision, signed_event_transition_fingerprint_sha256,
        signed_submission_proof_fingerprint_sha256,
        wallet_registered_at, wallet_revoked_at, signed_bound_recorded_at,
        triggering_event_recorded_at, key_policy_updated_at, recovered_at,
        recovery_fingerprint_sha256
      ) VALUES (
        created_recovery.account_id, created_recovery.triggering_intent_id,
        created_recovery.intent_record_fingerprint_sha256, created_recovery.wallet_id,
        created_recovery.network_id, created_recovery.address_digest_version,
        created_recovery.active_address_digest,
        created_recovery.triggering_event_revision,
        created_recovery.triggering_event_snapshot_sha256,
        created_recovery.triggering_event_transition_fingerprint_sha256,
        created_recovery.triggering_event_stage, created_recovery.signed_event_revision,
        created_recovery.signed_event_transition_fingerprint_sha256,
        created_recovery.signed_submission_proof_fingerprint_sha256,
        created_recovery.wallet_registered_at, created_recovery.wallet_revoked_at,
        created_recovery.signed_bound_recorded_at,
        created_recovery.triggering_event_recorded_at,
        created_recovery.key_policy_updated_at, created_recovery.recovered_at,
        created_recovery.recovery_fingerprint_sha256
      ) RETURNING * INTO created_recovery;

      RETURN QUERY SELECT
        CASE WHEN alias_was_backfilled THEN 'BACKFILLED' ELSE 'ALIAS_ALREADY_PRESENT' END,
        created_recovery.account_id,
        created_recovery.triggering_intent_id,
        created_recovery.wallet_id,
        created_recovery.network_id,
        created_recovery.triggering_event_revision,
        created_recovery.triggering_event_snapshot_sha256,
        created_recovery.triggering_event_stage,
        created_recovery.address_digest_version,
        created_recovery.recovered_at,
        created_recovery.recovery_fingerprint_sha256;
    END;`;

function canonicalResult(value: string): string {
  return `TABLE(${value
    .replace(/\btimestamptz\b/gu, 'timestamp with time zone')
    .replace(/\s+/gu, ' ')
    .trim()})`;
}

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `CREATE TABLE ${RECOVERY_TABLE} (
      account_id uuid NOT NULL,
      triggering_intent_id uuid NOT NULL,
      intent_record_fingerprint_sha256 text NOT NULL,
      wallet_id uuid NOT NULL,
      network_id text NOT NULL,
      address_digest_version smallint NOT NULL,
      active_address_digest bytea NOT NULL,
      triggering_event_revision bigint NOT NULL,
      triggering_event_snapshot_sha256 text NOT NULL,
      triggering_event_transition_fingerprint_sha256 text NOT NULL,
      triggering_event_stage text NOT NULL,
      signed_event_revision bigint NOT NULL,
      signed_event_transition_fingerprint_sha256 text NOT NULL,
      signed_submission_proof_fingerprint_sha256 text NOT NULL,
      wallet_registered_at timestamptz NOT NULL,
      wallet_revoked_at timestamptz NOT NULL,
      signed_bound_recorded_at timestamptz NOT NULL,
      triggering_event_recorded_at timestamptz NOT NULL,
      key_policy_updated_at timestamptz NOT NULL,
      recovered_at timestamptz NOT NULL,
      recovery_fingerprint_sha256 text NOT NULL,
      CONSTRAINT mainnet_action_recovery_alias_pkey PRIMARY KEY (
        triggering_intent_id, triggering_event_revision, address_digest_version
      ),
      CONSTRAINT mainnet_action_recovery_alias_fingerprint_unique
        UNIQUE (recovery_fingerprint_sha256),
      CONSTRAINT mainnet_action_recovery_alias_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_intent_fk FOREIGN KEY (triggering_intent_id)
        REFERENCES mainnet_financial_action_intents (intent_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_intent_fingerprint_fk
        FOREIGN KEY (intent_record_fingerprint_sha256)
        REFERENCES mainnet_financial_action_intents (intent_record_fingerprint_sha256)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_wallet_fk FOREIGN KEY (wallet_id)
        REFERENCES registered_wallets (wallet_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_identity_fk FOREIGN KEY (
        wallet_id, address_digest_version
      ) REFERENCES registered_wallet_identity_digests (
        wallet_id, address_digest_version
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_event_fk FOREIGN KEY (
        triggering_intent_id, triggering_event_revision,
        triggering_event_transition_fingerprint_sha256
      ) REFERENCES mainnet_financial_action_events (
        intent_id, revision, transition_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_signed_event_fk FOREIGN KEY (
        triggering_intent_id, signed_event_revision,
        signed_event_transition_fingerprint_sha256
      ) REFERENCES mainnet_financial_action_events (
        intent_id, revision, transition_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_proof_fk
        FOREIGN KEY (signed_submission_proof_fingerprint_sha256)
        REFERENCES mainnet_financial_action_signed_submission_proofs (
          proof_fingerprint_sha256
        ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_recovery_alias_shape_check CHECK (
        network_id IN ('${ETHEREUM}', '${SOLANA}')
        AND address_digest_version > 0
        AND pg_catalog.octet_length(active_address_digest) = 32
        AND triggering_event_revision >= 2
        AND signed_event_revision = 2
        AND triggering_event_stage IN (
          'WALLET_SIGNED_SUBMISSION_BOUND',
          'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
        )
        AND intent_record_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND intent_record_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND triggering_event_snapshot_sha256 ~ '^[0-9a-f]{64}$'
        AND triggering_event_snapshot_sha256 <> pg_catalog.repeat('0', 64)
        AND triggering_event_transition_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND triggering_event_transition_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND signed_event_transition_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND signed_event_transition_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND signed_submission_proof_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND signed_submission_proof_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
        AND recovery_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND recovery_fingerprint_sha256 <> pg_catalog.repeat('0', 64)
      ),
      CONSTRAINT mainnet_action_recovery_alias_time_check CHECK (
        pg_catalog.isfinite(wallet_registered_at)
        AND pg_catalog.isfinite(wallet_revoked_at)
        AND pg_catalog.isfinite(signed_bound_recorded_at)
        AND pg_catalog.isfinite(triggering_event_recorded_at)
        AND pg_catalog.isfinite(key_policy_updated_at)
        AND pg_catalog.isfinite(recovered_at)
        AND pg_catalog.date_trunc('milliseconds', key_policy_updated_at) =
          key_policy_updated_at
        AND pg_catalog.date_trunc('milliseconds', recovered_at) = recovered_at
        AND wallet_registered_at <= signed_bound_recorded_at
        AND signed_bound_recorded_at <= wallet_revoked_at
        AND signed_bound_recorded_at <= triggering_event_recorded_at
        AND wallet_revoked_at <= recovered_at
        AND triggering_event_recorded_at <= recovered_at
        AND key_policy_updated_at <= recovered_at
      )
    );
    COMMENT ON TABLE ${RECOVERY_TABLE} IS '${RECOVERY_MANIFEST}';

    CREATE FUNCTION ${RECOVERY_GUARD}()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${RECOVERY_GUARD_BODY}$function$;
    CREATE FUNCTION ${RECOVERY_FUNCTION}(
      ${RECOVERY_ARGUMENTS.map(([name, type]) => `${name} ${type}`).join(',\n      ')}
    ) RETURNS TABLE (${RECOVERY_RESULT})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RECOVERY_FUNCTION_BODY}$function$;
    CREATE FUNCTION ${RECOVERY_READINESS_GUARD}()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${RECOVERY_READINESS_GUARD_BODY}$function$;

    CREATE TRIGGER mainnet_action_recovery_alias_before_insert
      BEFORE INSERT ON ${RECOVERY_TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${RECOVERY_GUARD}();
    CREATE TRIGGER mainnet_action_recovery_alias_append_only_row
      BEFORE UPDATE OR DELETE ON ${RECOVERY_TABLE}
      FOR EACH ROW EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE TRIGGER mainnet_action_recovery_alias_append_only_truncate
      BEFORE TRUNCATE ON ${RECOVERY_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_mainnet_action_history_mutation();
    CREATE CONSTRAINT TRIGGER wallet_identity_rotation_recovery_readiness
      AFTER UPDATE ON wallet_identity_key_policy
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      WHEN (OLD.active_write_version IS DISTINCT FROM NEW.active_write_version)
      EXECUTE FUNCTION ${RECOVERY_READINESS_GUARD}();
    ALTER TABLE ${RECOVERY_TABLE} ENABLE ALWAYS TRIGGER
      mainnet_action_recovery_alias_before_insert;
    ALTER TABLE ${RECOVERY_TABLE} ENABLE ALWAYS TRIGGER
      mainnet_action_recovery_alias_append_only_row;
    ALTER TABLE ${RECOVERY_TABLE} ENABLE ALWAYS TRIGGER
      mainnet_action_recovery_alias_append_only_truncate;
    ALTER TABLE wallet_identity_key_policy ENABLE ALWAYS TRIGGER
      wallet_identity_rotation_recovery_readiness;

    DO $set_recovery_alias_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${[RECOVERY_GUARD_IDENTITY, RECOVERY_FUNCTION_IDENTITY, RECOVERY_READINESS_GUARD_IDENTITY]
        .map(
          (functionIdentity) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${functionIdentity}
          SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );`,
        )
        .join('\n      ')}
    END;
    $set_recovery_alias_paths$;

    REVOKE ALL PRIVILEGES ON TABLE ${RECOVERY_TABLE} FROM ${guarded};
    REVOKE ALL PRIVILEGES ON TYPE ${RECOVERY_TABLE} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECOVERY_GUARD_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECOVERY_FUNCTION_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECOVERY_READINESS_GUARD_IDENTITY} FROM ${guarded};`;
}

function createDownSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;
  return `LOCK TABLE wallet_identity_key_policy IN ACCESS EXCLUSIVE MODE;
    LOCK TABLE registered_wallet_identity_digests, ${RECOVERY_TABLE}
      IN ACCESS EXCLUSIVE MODE;
    DO $refuse_recovery_alias_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${RECOVERY_TABLE}) THEN
        RAISE EXCEPTION 'cannot roll back revoked wallet recovery alias history'
          USING ERRCODE = '55000';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM wallet_identity_key_policy AS policy
        WHERE policy.policy_name = 'wallet-registration-identity-hmac'
          AND policy.schema_version = 1
          AND policy.active_write_version = 1
          AND policy.accepted_read_versions = ARRAY[1]::smallint[]
      ) THEN
        RAISE EXCEPTION 'cannot roll back after wallet identity policy transition'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_recovery_alias_history_loss$;
    DROP TRIGGER wallet_identity_rotation_recovery_readiness
      ON wallet_identity_key_policy;
    REVOKE ALL ON FUNCTION ${RECOVERY_READINESS_GUARD_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECOVERY_FUNCTION_IDENTITY} FROM ${guarded};
    REVOKE ALL ON FUNCTION ${RECOVERY_GUARD_IDENTITY} FROM ${guarded};
    DROP FUNCTION ${RECOVERY_FUNCTION_IDENTITY};
    DROP TRIGGER mainnet_action_recovery_alias_append_only_truncate ON ${RECOVERY_TABLE};
    DROP TRIGGER mainnet_action_recovery_alias_append_only_row ON ${RECOVERY_TABLE};
    DROP TRIGGER mainnet_action_recovery_alias_before_insert ON ${RECOVERY_TABLE};
    DROP FUNCTION ${RECOVERY_READINESS_GUARD_IDENTITY};
    DROP FUNCTION ${RECOVERY_GUARD_IDENTITY};
    DROP TABLE ${RECOVERY_TABLE};`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createVerifiedMainnetSignedSubmissionProofMigration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0039 must expose verification SQL');
  const prior = replaceExactlyOnce(
    previous.verifySql,
    `      AND (
          SELECT pg_catalog.count(*) = 14
        FROM pg_catalog.pg_trigger AS all_trigger_state
        WHERE NOT all_trigger_state.tgisinternal
          AND all_trigger_state.tgrelid IN (
            pg_catalog.to_regclass('wallet_identity_key_policy'),
            pg_catalog.to_regclass('wallet_ownership_challenge_identity_digests'),
            pg_catalog.to_regclass('registered_wallet_identity_digests'),
            pg_catalog.to_regclass('registered_wallets')
          )
      ) AS valid
    FROM expected_triggers`,
    `      AND (
          SELECT pg_catalog.count(*) = 15
        FROM pg_catalog.pg_trigger AS all_trigger_state
        WHERE NOT all_trigger_state.tgisinternal
          AND all_trigger_state.tgrelid IN (
            pg_catalog.to_regclass('wallet_identity_key_policy'),
            pg_catalog.to_regclass('wallet_ownership_challenge_identity_digests'),
            pg_catalog.to_regclass('registered_wallet_identity_digests'),
            pg_catalog.to_regclass('registered_wallets')
          )
      )
      AND (
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            readiness_trigger.tgenabled = 'A'
            AND NOT readiness_trigger.tgisinternal
            AND readiness_trigger.tgrelid =
              pg_catalog.to_regclass('wallet_identity_key_policy')
            AND readiness_trigger.tgfoid =
              pg_catalog.to_regprocedure('${RECOVERY_READINESS_GUARD_IDENTITY}')
            AND readiness_trigger.tgtype = 17
            AND readiness_trigger.tgnargs = 0
            AND readiness_trigger.tgattr = ''::int2vector
            AND readiness_trigger.tgqual IS NOT NULL
            AND readiness_trigger.tgconstraint = readiness_constraint.oid
            AND readiness_trigger.tgdeferrable AND readiness_trigger.tginitdeferred
            AND readiness_trigger.tgparentid = 0
            AND readiness_trigger.tgoldtable IS NULL
            AND readiness_trigger.tgnewtable IS NULL
            AND readiness_constraint.contype = 't'
            AND readiness_constraint.conrelid =
              pg_catalog.to_regclass('wallet_identity_key_policy')
            AND readiness_constraint.convalidated
            AND readiness_constraint.condeferrable AND readiness_constraint.condeferred
            AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
              pg_catalog.replace(
                pg_catalog.pg_get_triggerdef(readiness_trigger.oid, false),
                pg_catalog.quote_ident(pg_catalog.current_schema()) || '.',
                ''
              ), 'UTF8'
            )), 'hex') = '${READINESS_TRIGGER_DEFINITION_SHA256}'
          )
        FROM pg_catalog.pg_trigger AS readiness_trigger
        INNER JOIN pg_catalog.pg_constraint AS readiness_constraint
          ON readiness_constraint.oid = readiness_trigger.tgconstraint
        WHERE readiness_trigger.tgrelid =
            pg_catalog.to_regclass('wallet_identity_key_policy')
          AND readiness_trigger.tgname = 'wallet_identity_rotation_recovery_readiness'
      ) AS valid
    FROM expected_triggers`,
  );
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const expectedColumns = RECOVERY_COLUMNS.map(
    ([name, type, notNull], index) => `('${name}', '${type}', ${notNull}, ${String(index + 1)})`,
  ).join(',\n          ');
  const resultArguments = RECOVERY_RESULT.split(',').map((column) => {
    const [name = '', ...typeParts] = column.trim().split(/\s+/u);
    return [name, typeParts.join(' ').replace('timestamptz', 'timestamp with time zone')] as const;
  });
  const inputTypes = RECOVERY_ARGUMENTS.map(
    ([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`,
  );
  const allTypes = [
    ...inputTypes,
    ...resultArguments.map(([, type]) => `'${type}'::pg_catalog.regtype::pg_catalog.oid`),
  ];

  return `SELECT (
      prior.valid AND relation_state.valid AND constraint_state.valid
      AND function_state.valid AND trigger_state.valid AND data_state.valid
    ) AS valid
    FROM (${prior}) AS prior
    CROSS JOIN (
      SELECT pg_catalog.count(*) = ${RECOVERY_COLUMNS.length}
        AND pg_catalog.count(attribute.attname) = ${RECOVERY_COLUMNS.length}
        AND pg_catalog.bool_and(
          pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = expected.type_name
          AND attribute.attnotnull = expected.not_null
          AND attribute.attnum = expected.ordinal
          AND NOT attribute.atthasdef
          AND attribute.attidentity = '' AND attribute.attgenerated = ''
        )
        AND relation.relkind = 'r'
        AND relation.relpersistence = 'p' AND relation.relreplident = 'd'
        AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity
        AND NOT relation.relispartition AND relation.relpartbound IS NULL
        AND pg_catalog.obj_description(relation.oid, 'pg_class') = '${RECOVERY_MANIFEST}'
        AND relation_owner.rolname = ${cumulative ? owner : 'relation_owner.rolname'}
        AND NOT pg_catalog.has_table_privilege(${api}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${worker}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${legacy}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${balance}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege(${migration}, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege('public', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = relation.oid
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite
          WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(
            COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
          ) AS acl WHERE acl.grantee <> relation.relowner
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute AS guarded_attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(guarded_attribute.attacl) AS acl
          WHERE guarded_attribute.attrelid = relation.oid
            AND guarded_attribute.attnum > 0 AND NOT guarded_attribute.attisdropped
            AND acl.grantee <> relation.relowner
        )
        AND (
          SELECT row_type.typtype = 'c' AND row_type.typrelid = relation.oid
            AND row_type.typowner = relation.relowner
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.aclexplode(
                COALESCE(row_type.typacl, pg_catalog.acldefault('T', row_type.typowner))
              ) AS acl WHERE acl.grantee <> row_type.typowner
            )
          FROM pg_catalog.pg_type AS row_type WHERE row_type.oid = relation.reltype
        )
        AS valid
      FROM (VALUES
          ${expectedColumns}
      ) AS expected(column_name, type_name, not_null, ordinal)
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.oid = pg_catalog.to_regclass('${RECOVERY_TABLE}')
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
        AND attribute.attname = expected.column_name AND NOT attribute.attisdropped
      LEFT JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
      GROUP BY relation.oid, relation.relkind, relation.relowner, relation_owner.rolname
    ) AS relation_state
    CROSS JOIN (
      WITH catalog_rows AS (
        SELECT constraint_record.*,
          foreign_relation.relname AS foreign_relname,
          foreign_namespace.nspname AS foreign_nspname,
          backing_index.relname AS backing_name,
          backing_namespace.nspname AS backing_nspname
        FROM pg_catalog.pg_constraint AS constraint_record
        LEFT JOIN pg_catalog.pg_class AS foreign_relation
          ON foreign_relation.oid = constraint_record.confrelid
        LEFT JOIN pg_catalog.pg_namespace AS foreign_namespace
          ON foreign_namespace.oid = foreign_relation.relnamespace
        LEFT JOIN pg_catalog.pg_class AS backing_index
          ON backing_index.oid = constraint_record.conindid
        LEFT JOIN pg_catalog.pg_namespace AS backing_namespace
          ON backing_namespace.oid = backing_index.relnamespace
        WHERE constraint_record.conrelid = pg_catalog.to_regclass('${RECOVERY_TABLE}')
      ), canonical AS (
        SELECT pg_catalog.count(*) AS row_count,
          pg_catalog.string_agg(pg_catalog.format(
            '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
            conname, contype, convalidated, conislocal, coninhcount,
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
          ), E'\\n' ORDER BY conname) AS catalog_state
        FROM catalog_rows
      )
      SELECT row_count = 12 AND COALESCE(
        pg_catalog.encode(pg_catalog.sha256(
          pg_catalog.convert_to(catalog_state, 'UTF8')
        ), 'hex') = '${CONSTRAINT_CATALOG_SHA256}', false
      ) AS valid
      FROM canonical
    ) AS constraint_state
    CROSS JOIN (
      WITH expected(
        function_identity, body_sha256, is_strict, input_names, input_type_oids,
        result_text
      ) AS (VALUES
        ('${RECOVERY_GUARD_IDENTITY}', '${sourceSha256(RECOVERY_GUARD_BODY)}', false,
          ARRAY[]::text[], ARRAY[]::oid[], 'trigger'),
        ('${RECOVERY_FUNCTION_IDENTITY}', '${sourceSha256(RECOVERY_FUNCTION_BODY)}', true,
          ARRAY[${RECOVERY_ARGUMENTS.map(([name]) => `'${name}'`).join(', ')}]::text[],
          ARRAY[${inputTypes.join(', ')}]::oid[], '${canonicalResult(RECOVERY_RESULT)}'),
        ('${RECOVERY_READINESS_GUARD_IDENTITY}',
          '${sourceSha256(RECOVERY_READINESS_GUARD_BODY)}', false,
          ARRAY[]::text[], ARRAY[]::oid[], 'trigger')
      )
      SELECT pg_catalog.count(*) = 3 AND pg_catalog.count(procedure.oid) = 3
        AND pg_catalog.bool_and(
          procedure.prokind = 'f' AND procedure.prosecdef AND NOT procedure.proleakproof
          AND procedure.provolatile = 'v' AND procedure.proparallel = 'u'
          AND procedure.proisstrict = expected.is_strict
          AND procedure.pronargdefaults = 0 AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND procedure.pronargs = pg_catalog.cardinality(expected.input_names)
          AND ARRAY(
            SELECT input_type
            FROM pg_catalog.unnest(procedure.proargtypes::oid[])
              WITH ORDINALITY AS input(input_type, ordinal)
            ORDER BY ordinal
          ) = expected.input_type_oids
          AND COALESCE(
            procedure.proargnames[1:procedure.pronargs], ARRAY[]::text[]
          ) = expected.input_names
          AND pg_catalog.pg_get_function_result(procedure.oid) = expected.result_text
          AND CASE WHEN expected.result_text = 'trigger' THEN
            NOT procedure.proretset AND procedure.prorettype = 'trigger'::regtype
            AND procedure.proallargtypes IS NULL AND procedure.proargmodes IS NULL
            AND procedure.proargnames IS NULL
          ELSE
            procedure.proretset AND procedure.prorettype = 'record'::regtype
            AND procedure.proallargtypes = ARRAY[${allTypes.join(', ')}]::oid[]
            AND procedure.proargmodes = ARRAY[
              ${[
                ...RECOVERY_ARGUMENTS.map(() => `'i'::"char"`),
                ...resultArguments.map(() => `'t'::"char"`),
              ].join(', ')}
            ]::"char"[]
            AND procedure.proargnames = ARRAY[
              ${[
                ...RECOVERY_ARGUMENTS.map(([name]) => `'${name}'`),
                ...resultArguments.map(([name]) => `'${name}'`),
              ].join(', ')}
            ]::text[]
          END
          AND language.lanname = 'plpgsql'
          AND procedure.proconfig = ARRAY[
            'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
          ]::text[]
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = expected.body_sha256
          AND function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND NOT pg_catalog.has_function_privilege(${api}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${worker}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${legacy}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${balance}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(${migration}, expected.function_identity, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('public', expected.function_identity, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
            ) AS acl WHERE acl.grantee <> procedure.proowner
          )
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS function_state
    CROSS JOIN (
      WITH expected(trigger_name, function_identity, trigger_type) AS (VALUES
        ('mainnet_action_recovery_alias_before_insert', '${RECOVERY_GUARD_IDENTITY}', 7),
        ('mainnet_action_recovery_alias_append_only_row',
          'reject_mainnet_action_history_mutation()', 27),
        ('mainnet_action_recovery_alias_append_only_truncate',
          'reject_mainnet_action_history_mutation()', 34)
      )
      SELECT pg_catalog.count(*) = 3 AND pg_catalog.count(trigger_record.oid) = 3
        AND pg_catalog.bool_and(
          trigger_record.tgenabled = 'A' AND NOT trigger_record.tgisinternal
          AND trigger_record.tgrelid = pg_catalog.to_regclass('${RECOVERY_TABLE}')
          AND trigger_record.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
          AND trigger_record.tgtype = expected.trigger_type
          AND trigger_record.tgnargs = 0 AND trigger_record.tgparentid = 0
          AND NOT trigger_record.tgdeferrable AND NOT trigger_record.tginitdeferred
          AND trigger_record.tgconstraint = 0
          AND trigger_record.tgoldtable IS NULL AND trigger_record.tgnewtable IS NULL
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger_record
        ON trigger_record.tgrelid = pg_catalog.to_regclass('${RECOVERY_TABLE}')
        AND trigger_record.tgname = expected.trigger_name
    ) AS trigger_state
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1 FROM ${RECOVERY_TABLE} AS audit
        WHERE audit.recovery_fingerprint_sha256 <>
          ${recoveryFingerprint('audit')}
          OR NOT EXISTS (
            SELECT 1
            FROM mainnet_financial_action_intents AS intent
            INNER JOIN registered_wallets AS wallet
              ON wallet.wallet_id = audit.wallet_id AND wallet.account_id = audit.account_id
            INNER JOIN registered_wallet_identity_digests AS historical_identity
              ON historical_identity.wallet_id = wallet.wallet_id
              AND historical_identity.address_digest_version =
                intent.wallet_identity_digest_version
              AND historical_identity.address_digest = pg_catalog.decode(
                intent.wallet_identity_digest_hex, 'hex'
              )
              AND historical_identity.status = 'REVOKED'
              AND historical_identity.registered_at = wallet.registered_at
              AND historical_identity.revoked_at = wallet.revoked_at
            INNER JOIN registered_wallet_identity_digests AS active_identity
              ON active_identity.wallet_id = wallet.wallet_id
              AND active_identity.address_digest_version = audit.address_digest_version
              AND active_identity.address_digest = audit.active_address_digest
              AND active_identity.status = 'REVOKED'
              AND active_identity.registered_at = wallet.registered_at
              AND active_identity.revoked_at = wallet.revoked_at
            INNER JOIN mainnet_financial_action_events AS triggering_event
              ON triggering_event.intent_id = audit.triggering_intent_id
              AND triggering_event.revision = audit.triggering_event_revision
              AND triggering_event.snapshot_sha256 = audit.triggering_event_snapshot_sha256
              AND triggering_event.transition_fingerprint_sha256 =
                audit.triggering_event_transition_fingerprint_sha256
              AND triggering_event.stage = audit.triggering_event_stage
              AND triggering_event.recorded_at = audit.triggering_event_recorded_at
            INNER JOIN mainnet_financial_action_events AS signed_event
              ON signed_event.intent_id = audit.triggering_intent_id
              AND signed_event.revision = audit.signed_event_revision
              AND signed_event.transition_fingerprint_sha256 =
                audit.signed_event_transition_fingerprint_sha256
              AND signed_event.recorded_at = audit.signed_bound_recorded_at
            INNER JOIN mainnet_financial_action_signed_submission_proofs AS proof
              ON proof.proof_fingerprint_sha256 =
                audit.signed_submission_proof_fingerprint_sha256
              AND proof.intent_id = signed_event.intent_id
              AND proof.event_revision = signed_event.revision
              AND proof.event_id = signed_event.event_id
              AND proof.event_transition_fingerprint_sha256 =
                signed_event.transition_fingerprint_sha256
              AND proof.intent_record_fingerprint_sha256 =
                intent.intent_record_fingerprint_sha256
              AND proof.network_id = signed_event.network_id
              AND proof.chain_transaction_id = signed_event.chain_transaction_id
              AND proof.transaction_identity_sha256 = signed_event.transaction_identity_sha256
              AND proof.signing_payload_sha256 = signed_event.wallet_signed_payload_sha256
              AND proof.signature_evidence_sha256 = signed_event.wallet_signature_evidence_sha256
            WHERE intent.intent_id = audit.triggering_intent_id
              AND intent.account_id = audit.account_id
              AND intent.wallet_id = audit.wallet_id
              AND intent.intent_record_fingerprint_sha256 =
                audit.intent_record_fingerprint_sha256
              AND intent.network_id = audit.network_id
              AND intent.wallet_chain_namespace = wallet.chain_namespace
              AND intent.wallet_chain_reference = wallet.chain_reference
              AND wallet.status = 'REVOKED' AND wallet.revoked_at IS NOT NULL
              AND wallet.registered_at = audit.wallet_registered_at
              AND wallet.revoked_at = audit.wallet_revoked_at
              AND wallet.address_digest_version = intent.wallet_identity_digest_version
              AND wallet.address_digest = pg_catalog.decode(
                intent.wallet_identity_digest_hex, 'hex'
              )
              AND triggering_event.stage IN (
                'WALLET_SIGNED_SUBMISSION_BOUND',
                'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
              )
              AND NOT triggering_event.terminal
              AND NOT triggering_event.requires_manual_reconciliation
              AND triggering_event.chain_transaction_id = signed_event.chain_transaction_id
              AND triggering_event.transaction_identity_sha256 =
                signed_event.transaction_identity_sha256
              AND signed_event.revision = 2
              AND signed_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
              AND signed_event.recorded_at <= wallet.revoked_at
              AND signed_event.recorded_at <= triggering_event.recorded_at
              AND triggering_event.recorded_at <= audit.recovered_at
              AND NOT EXISTS (
                SELECT 1 FROM mainnet_financial_action_events AS later_event
                WHERE later_event.intent_id = triggering_event.intent_id
                  AND later_event.revision > triggering_event.revision
                  AND later_event.recorded_at <= audit.recovered_at
              )
          )
      ) AND NOT COALESCE((
        SELECT ${missingRecoveryReadiness('key_policy.active_write_version')}
        FROM wallet_identity_key_policy AS key_policy
        WHERE key_policy.policy_name = 'wallet-registration-identity-hmac'
          AND key_policy.schema_version = 1
          AND key_policy.active_write_version = ANY(key_policy.accepted_read_versions)
      ), true) AS valid
    ) AS data_state`;
}

export function createMainnetFinancialActionWalletIdentityRotationRecoveryMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0040',
    description: 'preserve revoked-wallet recovery through identity-HMAC key rotation',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0039'],
  };
}

export const createMainnetFinancialActionWalletIdentityRotationRecoveryMigrationV0040 =
  createMainnetFinancialActionWalletIdentityRotationRecoveryMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
  );

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionWalletIdentityRotationRecoveryTestSchemaMigrationV0040 =
  createMainnetFinancialActionWalletIdentityRotationRecoveryMigration(
    PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
    { cumulativePrincipalVerification: false },
  );
