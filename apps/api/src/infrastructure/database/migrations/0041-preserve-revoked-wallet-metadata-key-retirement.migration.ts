import { createHash } from 'node:crypto';

import { createWalletMetadataRewrapBoundaryMigration } from './0024-create-wallet-metadata-rewrap-boundary.migration';
import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import { createMainnetFinancialActionWalletIdentityRotationRecoveryMigration } from './0040-preserve-mainnet-financial-action-recovery-through-wallet-identity-key-rotation.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MAINNET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const AUTHORIZATION_TABLE = 'wallet_metadata_revoked_rewrap_authorizations';
const AUTHORIZATION_GUARD = 'enforce_wallet_metadata_revoked_rewrap_authorization_v1()';
const AUTHORIZE_REWRAP = 'authorize_revoked_wallet_metadata_rewrap_v1(uuid)';
const STATE_VERIFIER = 'verify_wallet_metadata_revoked_rewrap_state_v1()';
const MATERIAL_GUARD = 'guard_wallet_metadata_seal_material()';
const PREPARE_REWRAP = 'prepare_wallet_metadata_rewrap(uuid,uuid,uuid,smallint)';
const COMPLETE_REWRAP =
  'complete_wallet_metadata_rewrap(uuid,uuid,uuid,text,smallint,bytea,bytea,bytea,smallint,bytea,bytea,bytea)';
const AUTHORIZATION_MANIFEST =
  'crypto-lending:wallet-metadata-rewrap:v2;revoked=terminal;authorization=append-only;identity=digest-sha256;plaintext=forbidden';

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

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Migration 0041 SQL anchor must occur exactly once');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function functionBody(source: string, functionName: string): string {
  const functionStart = source.indexOf(`CREATE FUNCTION ${functionName}`);
  if (functionStart < 0)
    throw new Error(`Migration 0041 predecessor function missing: ${functionName}`);
  const bodyStartMarker = 'AS $function$';
  const bodyStart = source.indexOf(bodyStartMarker, functionStart);
  const bodyEnd = source.indexOf('$function$;', bodyStart + bodyStartMarker.length);
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new Error(`Migration 0041 predecessor function body missing: ${functionName}`);
  }
  return source.slice(bodyStart + bodyStartMarker.length, bodyEnd);
}

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceVerifierFunctionHash(source: string, identity: string, body: string): string {
  const anchor = `WHEN pg_catalog.to_regprocedure('${identity}')\n            THEN '`;
  const start = source.indexOf(anchor);
  if (start < 0 || source.indexOf(anchor, start + anchor.length) >= 0) {
    throw new Error(`Migration 0041 predecessor verifier hash missing: ${identity}`);
  }
  const digestStart = start + anchor.length;
  const digestEnd = source.indexOf("'", digestStart);
  if (digestEnd < 0 || !/^[0-9a-f]{64}$/u.test(source.slice(digestStart, digestEnd))) {
    throw new Error(`Migration 0041 predecessor verifier hash malformed: ${identity}`);
  }
  return `${source.slice(0, digestStart)}${sourceSha256(body)}${source.slice(digestEnd)}`;
}

const PREDECESSOR_UP = sql(
  createWalletMetadataRewrapBoundaryMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS).upSql,
);

const ORIGINAL_MATERIAL_GUARD_BODY = functionBody(
  PREDECESSOR_UP,
  'guard_wallet_metadata_seal_material()',
);
const ORIGINAL_PREPARE_REWRAP_BODY = functionBody(
  PREDECESSOR_UP,
  'prepare_wallet_metadata_rewrap(',
);
const ORIGINAL_COMPLETE_REWRAP_BODY = functionBody(
  PREDECESSOR_UP,
  'complete_wallet_metadata_rewrap(',
);

const REVOKED_AUTHORIZATION_PREDICATE = `(
          OLD.status = 'REVOKED'
          AND OLD.revoked_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM wallet_metadata_revoked_rewrap_authorizations AS evidence
            INNER JOIN registered_wallet_identity_digests AS alias
              ON alias.wallet_id = evidence.wallet_id
              AND alias.account_id = evidence.account_id
              AND alias.chain_namespace = OLD.chain_namespace
              AND alias.chain_reference = OLD.chain_reference
              AND alias.address_digest_version = evidence.verification_digest_version
              AND pg_catalog.sha256(alias.address_digest)
                = evidence.verification_digest_sha256
              AND alias.status = 'REVOKED'
              AND alias.registered_at = evidence.registered_at
              AND alias.revoked_at = evidence.revoked_at
            INNER JOIN wallet_identity_key_policy AS key_policy
              ON key_policy.policy_name = 'wallet-registration-identity-hmac'
              AND key_policy.schema_version = 1
              AND evidence.verification_digest_version
                = ANY (key_policy.accepted_read_versions)
            WHERE evidence.command_id = command.command_id
              AND evidence.account_id = OLD.account_id
              AND evidence.wallet_id = OLD.wallet_id
              AND evidence.registered_at = OLD.registered_at
              AND evidence.revoked_at = OLD.revoked_at
              AND evidence.state_sha256 = command.prepared_state_sha256
              AND (
                (evidence.authorization_reason = 'PREPARED_WHILE_REVOKED'
                  AND command.prepared_at >= OLD.revoked_at)
                OR (evidence.authorization_reason = 'REVOKED_AFTER_PREPARE'
                  AND command.prepared_at < OLD.revoked_at)
              )
          )
        )`;

const MATERIAL_GUARD_BODY = replaceExactlyOnce(
  ORIGINAL_MATERIAL_GUARD_BODY,
  `OR OLD.status <> 'ACTIVE'
          OR OLD.revoked_at IS NOT NULL`,
  `OR NOT (
          (OLD.status = 'ACTIVE' AND OLD.revoked_at IS NULL)
          OR ${REVOKED_AUTHORIZATION_PREDICATE}
        )`,
);

let prepareRewrapBody = replaceExactlyOnce(
  ORIGINAL_PREPARE_REWRAP_BODY,
  `policy_active_version smallint;
      verification_digest bytea;
      verification_count bigint;`,
  `policy_active_version smallint;
      policy_accepted_versions smallint[];
      verification_digest_version smallint;
      verification_digest bytea;
      verification_count bigint;
      authorization_succeeded boolean;`,
);
prepareRewrapBody = replaceExactlyOnce(
  prepareRewrapBody,
  `AND wallet.status = 'ACTIVE'
        AND wallet.revoked_at IS NULL`,
  `AND (
          (wallet.status = 'ACTIVE' AND wallet.revoked_at IS NULL)
          OR (wallet.status = 'REVOKED' AND wallet.revoked_at IS NOT NULL)
        )`,
);
prepareRewrapBody = replaceExactlyOnce(
  prepareRewrapBody,
  `SELECT key_policy.active_write_version
      INTO policy_active_version
      FROM wallet_identity_key_policy AS key_policy
      WHERE key_policy.policy_name = 'wallet-registration-identity-hmac'
        AND key_policy.schema_version = 1
        AND key_policy.active_write_version = ANY (key_policy.accepted_read_versions);
      IF NOT FOUND THEN
        RETURN NEXT;
        RETURN;
      END IF;

      SELECT pg_catalog.count(*), (pg_catalog.array_agg(alias.address_digest))[1]
      INTO verification_count, verification_digest
      FROM registered_wallet_identity_digests AS alias
      WHERE alias.wallet_id = target_wallet.wallet_id
        AND alias.account_id = target_wallet.account_id
        AND alias.chain_namespace = target_wallet.chain_namespace
        AND alias.chain_reference = target_wallet.chain_reference
        AND alias.address_digest_version = policy_active_version
        AND alias.status = 'ACTIVE'
        AND alias.registered_at = target_wallet.registered_at
        AND alias.revoked_at IS NULL;
      IF verification_count <> 1 OR pg_catalog.octet_length(verification_digest) <> 32 THEN
        RETURN NEXT;
        RETURN;
      END IF;`,
  `SELECT key_policy.active_write_version, key_policy.accepted_read_versions
      INTO policy_active_version, policy_accepted_versions
      FROM wallet_identity_key_policy AS key_policy
      WHERE key_policy.policy_name = 'wallet-registration-identity-hmac'
        AND key_policy.schema_version = 1
        AND key_policy.active_write_version = ANY (key_policy.accepted_read_versions);
      IF NOT FOUND THEN
        RETURN NEXT;
        RETURN;
      END IF;

      IF target_wallet.status = 'ACTIVE' THEN
        verification_digest_version := policy_active_version;
      ELSE
        SELECT alias.address_digest_version
        INTO verification_digest_version
        FROM registered_wallet_identity_digests AS alias
        WHERE alias.wallet_id = target_wallet.wallet_id
          AND alias.account_id = target_wallet.account_id
          AND alias.chain_namespace = target_wallet.chain_namespace
          AND alias.chain_reference = target_wallet.chain_reference
          AND alias.address_digest_version = ANY (policy_accepted_versions)
          AND alias.status = 'REVOKED'
          AND alias.registered_at = target_wallet.registered_at
          AND alias.revoked_at = target_wallet.revoked_at
        ORDER BY alias.address_digest_version DESC
        LIMIT 1;
        IF NOT FOUND THEN
          RETURN NEXT;
          RETURN;
        END IF;
      END IF;

      SELECT pg_catalog.count(*), (pg_catalog.array_agg(alias.address_digest))[1]
      INTO verification_count, verification_digest
      FROM registered_wallet_identity_digests AS alias
      WHERE alias.wallet_id = target_wallet.wallet_id
        AND alias.account_id = target_wallet.account_id
        AND alias.chain_namespace = target_wallet.chain_namespace
        AND alias.chain_reference = target_wallet.chain_reference
        AND alias.address_digest_version = verification_digest_version
        AND alias.status = target_wallet.status
        AND alias.registered_at = target_wallet.registered_at
        AND alias.revoked_at IS NOT DISTINCT FROM target_wallet.revoked_at;
      IF verification_count <> 1 OR pg_catalog.octet_length(verification_digest) <> 32 THEN
        RETURN NEXT;
        RETURN;
      END IF;`,
);
prepareRewrapBody = replaceExactlyOnce(
  prepareRewrapBody,
  `rewrap_outcome := 'PREPARED';`,
  `IF target_wallet.status = 'REVOKED' THEN
        SELECT authorize_revoked_wallet_metadata_rewrap_v1(requested_command_id)
        INTO authorization_succeeded;
        IF authorization_succeeded IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'revoked wallet metadata rewrap authorization failed'
            USING ERRCODE = '55000';
        END IF;
      END IF;

      rewrap_outcome := 'PREPARED';`,
);
prepareRewrapBody = replaceExactlyOnce(
  prepareRewrapBody,
  `prepared_verification_digest_version := policy_active_version;`,
  `prepared_verification_digest_version := verification_digest_version;`,
);
prepareRewrapBody = replaceExactlyOnce(
  prepareRewrapBody,
  `FOR UPDATE;

      IF FOUND THEN
        IF existing_command.account_id`,
  `FOR UPDATE;

      recorded_at := pg_catalog.clock_timestamp();
      IF FOUND THEN
        IF existing_command.account_id`,
);
prepareRewrapBody = replaceExactlyOnce(
  prepareRewrapBody,
  `IF existing_command.command_id IS NULL THEN
        IF EXISTS (`,
  `recorded_at := pg_catalog.clock_timestamp();
      IF existing_command.command_id IS NOT NULL
        AND recorded_at >= existing_command.expires_at
      THEN
        RETURN NEXT;
        RETURN;
      END IF;

      IF existing_command.command_id IS NULL THEN
        IF EXISTS (`,
);
const PREPARE_REWRAP_BODY = prepareRewrapBody;

const COMPLETION_REVOKED_AUTHORIZATION_PREDICATE = `(
          target_wallet.status = 'REVOKED'
          AND target_wallet.revoked_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM wallet_metadata_revoked_rewrap_authorizations AS evidence
            INNER JOIN registered_wallet_identity_digests AS alias
              ON alias.wallet_id = evidence.wallet_id
              AND alias.account_id = evidence.account_id
              AND alias.chain_namespace = target_wallet.chain_namespace
              AND alias.chain_reference = target_wallet.chain_reference
              AND alias.address_digest_version = evidence.verification_digest_version
              AND pg_catalog.sha256(alias.address_digest)
                = evidence.verification_digest_sha256
              AND alias.status = 'REVOKED'
              AND alias.registered_at = evidence.registered_at
              AND alias.revoked_at = evidence.revoked_at
            INNER JOIN wallet_identity_key_policy AS key_policy
              ON key_policy.policy_name = 'wallet-registration-identity-hmac'
              AND key_policy.schema_version = 1
              AND evidence.verification_digest_version
                = ANY (key_policy.accepted_read_versions)
            WHERE evidence.command_id = target_command.command_id
              AND evidence.account_id = target_wallet.account_id
              AND evidence.wallet_id = target_wallet.wallet_id
              AND evidence.registered_at = target_wallet.registered_at
              AND evidence.revoked_at = target_wallet.revoked_at
              AND evidence.state_sha256 = target_command.prepared_state_sha256
              AND (
                (evidence.authorization_reason = 'PREPARED_WHILE_REVOKED'
                  AND target_command.prepared_at >= target_wallet.revoked_at)
                OR (evidence.authorization_reason = 'REVOKED_AFTER_PREPARE'
                  AND target_command.prepared_at < target_wallet.revoked_at)
              )
          )
        )`;

let completeRewrapBody = replaceExactlyOnce(
  ORIGINAL_COMPLETE_REWRAP_BODY,
  `OR target_wallet.status <> 'ACTIVE'
        OR target_wallet.revoked_at IS NOT NULL`,
  `OR NOT (
          (target_wallet.status = 'ACTIVE' AND target_wallet.revoked_at IS NULL)
          OR ${COMPLETION_REVOKED_AUTHORIZATION_PREDICATE}
        )`,
);
completeRewrapBody = replaceExactlyOnce(
  completeRewrapBody,
  `PERFORM pg_catalog.set_config(
        'crypto_lending.wallet_metadata_rewrap_command', requested_command_id::text, true
      );`,
  `recorded_at := pg_catalog.clock_timestamp();
      IF recorded_at >= target_command.expires_at THEN
        RETURN NEXT;
        RETURN;
      END IF;

      PERFORM pg_catalog.set_config(
        'crypto_lending.wallet_metadata_rewrap_command', requested_command_id::text, true
      );`,
);
const COMPLETE_REWRAP_BODY = completeRewrapBody;

const AUTHORIZATION_GUARD_BODY = `
    DECLARE
      authorized_command text := pg_catalog.current_setting(
        'crypto_lending.wallet_metadata_revoked_rewrap_command', true
      );
      target_command wallet_metadata_rewrap_commands%ROWTYPE;
      target_wallet registered_wallets%ROWTYPE;
      matching_aliases bigint;
      current_state_sha256 text;
    BEGIN
      IF TG_OP = 'TRUNCATE' OR TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION 'revoked wallet metadata rewrap authorization is append-only'
          USING ERRCODE = '55000';
      END IF;
      IF authorized_command IS DISTINCT FROM NEW.command_id::text THEN
        RAISE EXCEPTION 'revoked wallet metadata rewrap authorization is owner-controlled'
          USING ERRCODE = '55000';
      END IF;

      SELECT command.* INTO target_command
      FROM wallet_metadata_rewrap_commands AS command
      WHERE command.command_id = NEW.command_id;
      SELECT wallet.* INTO target_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = NEW.wallet_id;
      IF target_command.command_id IS NULL
        OR target_wallet.wallet_id IS NULL
        OR target_command.status <> 'PREPARED'
        OR target_command.account_id IS DISTINCT FROM target_wallet.account_id
        OR target_command.wallet_id IS DISTINCT FROM target_wallet.wallet_id
        OR target_command.registered_by_challenge_id
          IS DISTINCT FROM target_wallet.registered_by_challenge_id
        OR target_command.chain_namespace IS DISTINCT FROM target_wallet.chain_namespace
        OR target_command.chain_reference IS DISTINCT FROM target_wallet.chain_reference
        OR target_command.registry_environment IS DISTINCT FROM target_wallet.registry_environment
        OR target_command.registry_version IS DISTINCT FROM target_wallet.registry_version
        OR target_command.registry_fingerprint_sha256
          IS DISTINCT FROM target_wallet.registry_fingerprint_sha256
        OR target_wallet.status <> 'REVOKED'
        OR target_wallet.revoked_at IS NULL
        OR NEW.account_id IS DISTINCT FROM target_wallet.account_id
        OR NEW.wallet_id IS DISTINCT FROM target_wallet.wallet_id
        OR NEW.registered_at IS DISTINCT FROM target_wallet.registered_at
        OR NEW.revoked_at IS DISTINCT FROM target_wallet.revoked_at
        OR NEW.state_sha256 IS DISTINCT FROM target_command.prepared_state_sha256
        OR NEW.authorization_reason IS DISTINCT FROM (
          CASE
            WHEN target_command.prepared_at >= target_wallet.revoked_at
              THEN 'PREPARED_WHILE_REVOKED'
            ELSE 'REVOKED_AFTER_PREPARE'
          END
        )
      THEN
        RAISE EXCEPTION 'invalid revoked wallet metadata rewrap authorization'
          USING ERRCODE = '55000';
      END IF;

      current_state_sha256 := wallet_metadata_rewrap_state_sha256(
        target_wallet.address_key_version, target_wallet.address_ciphertext,
        target_wallet.address_iv, target_wallet.address_auth_tag,
        target_wallet.metadata_key_version, target_wallet.metadata_ciphertext,
        target_wallet.metadata_iv, target_wallet.metadata_auth_tag
      );
      IF current_state_sha256 IS DISTINCT FROM target_command.prepared_state_sha256 THEN
        RAISE EXCEPTION 'invalid revoked wallet metadata rewrap authorization'
          USING ERRCODE = '55000';
      END IF;

      SELECT pg_catalog.count(*) INTO matching_aliases
      FROM registered_wallet_identity_digests AS alias
      INNER JOIN wallet_identity_key_policy AS key_policy
        ON key_policy.policy_name = 'wallet-registration-identity-hmac'
        AND key_policy.schema_version = 1
        AND alias.address_digest_version = ANY (key_policy.accepted_read_versions)
      WHERE alias.wallet_id = target_wallet.wallet_id
        AND alias.account_id = target_wallet.account_id
        AND alias.chain_namespace = target_wallet.chain_namespace
        AND alias.chain_reference = target_wallet.chain_reference
        AND alias.address_digest_version = NEW.verification_digest_version
        AND pg_catalog.sha256(alias.address_digest) = NEW.verification_digest_sha256
        AND alias.status = 'REVOKED'
        AND alias.registered_at = target_wallet.registered_at
        AND alias.revoked_at = target_wallet.revoked_at;
      NEW.authorized_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF matching_aliases <> 1 OR NEW.authorized_at >= target_command.expires_at THEN
        RAISE EXCEPTION 'invalid revoked wallet metadata rewrap authorization'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    `;

const AUTHORIZE_REWRAP_BODY = `
    DECLARE
      target_command wallet_metadata_rewrap_commands%ROWTYPE;
      target_wallet registered_wallets%ROWTYPE;
      existing_authorization wallet_metadata_revoked_rewrap_authorizations%ROWTYPE;
      verification_version smallint;
      verification_digest_sha256 bytea;
      current_state_sha256 text;
      authorization_reason text;
      recorded_at timestamptz;
    BEGIN
      IF requested_command_id IS NULL
        OR pg_catalog.substring(requested_command_id::text, 15, 1) <> '4'
        OR pg_catalog.substring(requested_command_id::text, 20, 1)
          NOT IN ('8', '9', 'a', 'b')
      THEN
        RETURN false;
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(requested_command_id::text, 56024)
      );
      SELECT command.* INTO target_command
      FROM wallet_metadata_rewrap_commands AS command
      WHERE command.command_id = requested_command_id
      FOR UPDATE;
      IF NOT FOUND OR target_command.status <> 'PREPARED'
        OR pg_catalog.clock_timestamp() >= target_command.expires_at
      THEN
        RETURN false;
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(target_command.wallet_id::text, 56025)
      );
      SELECT wallet.* INTO target_wallet
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = target_command.wallet_id
        AND wallet.account_id = target_command.account_id
      FOR UPDATE;
      IF NOT FOUND
        OR target_wallet.status <> 'REVOKED'
        OR target_wallet.revoked_at IS NULL
        OR target_wallet.registered_by_challenge_id
          IS DISTINCT FROM target_command.registered_by_challenge_id
        OR target_wallet.chain_namespace IS DISTINCT FROM target_command.chain_namespace
        OR target_wallet.chain_reference IS DISTINCT FROM target_command.chain_reference
        OR target_wallet.registry_environment IS DISTINCT FROM 'MAINNET'
        OR target_wallet.registry_environment IS DISTINCT FROM target_command.registry_environment
        OR target_wallet.registry_version IS DISTINCT FROM 1
        OR target_wallet.registry_version IS DISTINCT FROM target_command.registry_version
        OR target_wallet.registry_fingerprint_sha256 IS DISTINCT FROM
          '${MAINNET_REGISTRY_FINGERPRINT}'
        OR target_wallet.registry_fingerprint_sha256
          IS DISTINCT FROM target_command.registry_fingerprint_sha256
        OR target_wallet.address_key_version
          IS DISTINCT FROM target_command.from_address_key_version
        OR target_wallet.metadata_key_version
          IS DISTINCT FROM target_command.from_metadata_key_version
      THEN
        RETURN false;
      END IF;
      current_state_sha256 := wallet_metadata_rewrap_state_sha256(
        target_wallet.address_key_version, target_wallet.address_ciphertext,
        target_wallet.address_iv, target_wallet.address_auth_tag,
        target_wallet.metadata_key_version, target_wallet.metadata_ciphertext,
        target_wallet.metadata_iv, target_wallet.metadata_auth_tag
      );
      IF current_state_sha256 IS DISTINCT FROM target_command.prepared_state_sha256 THEN
        RETURN false;
      END IF;

      SELECT alias.address_digest_version, pg_catalog.sha256(alias.address_digest)
      INTO verification_version, verification_digest_sha256
      FROM registered_wallet_identity_digests AS alias
      INNER JOIN wallet_identity_key_policy AS key_policy
        ON key_policy.policy_name = 'wallet-registration-identity-hmac'
        AND key_policy.schema_version = 1
        AND alias.address_digest_version = ANY (key_policy.accepted_read_versions)
      WHERE alias.wallet_id = target_wallet.wallet_id
        AND alias.account_id = target_wallet.account_id
        AND alias.chain_namespace = target_wallet.chain_namespace
        AND alias.chain_reference = target_wallet.chain_reference
        AND alias.status = 'REVOKED'
        AND alias.registered_at = target_wallet.registered_at
        AND alias.revoked_at = target_wallet.revoked_at
      ORDER BY alias.address_digest_version DESC
      LIMIT 1;
      IF NOT FOUND OR pg_catalog.octet_length(verification_digest_sha256) <> 32 THEN
        RETURN false;
      END IF;
      recorded_at := pg_catalog.date_trunc(
        'milliseconds', pg_catalog.clock_timestamp()
      );
      IF recorded_at >= target_command.expires_at THEN
        RETURN false;
      END IF;
      authorization_reason := CASE
        WHEN target_command.prepared_at >= target_wallet.revoked_at
          THEN 'PREPARED_WHILE_REVOKED'
        ELSE 'REVOKED_AFTER_PREPARE'
      END;

      SELECT evidence.* INTO existing_authorization
      FROM wallet_metadata_revoked_rewrap_authorizations AS evidence
      WHERE evidence.command_id = requested_command_id;
      IF FOUND THEN
        RETURN existing_authorization.account_id = target_wallet.account_id
          AND existing_authorization.wallet_id = target_wallet.wallet_id
          AND existing_authorization.registered_at = target_wallet.registered_at
          AND existing_authorization.revoked_at = target_wallet.revoked_at
          AND existing_authorization.state_sha256 = current_state_sha256
          AND existing_authorization.verification_digest_version = verification_version
          AND existing_authorization.verification_digest_sha256 = verification_digest_sha256
          AND existing_authorization.authorization_reason = authorization_reason;
      END IF;

      PERFORM pg_catalog.set_config(
        'crypto_lending.wallet_metadata_revoked_rewrap_command',
        requested_command_id::text, true
      );
      INSERT INTO wallet_metadata_revoked_rewrap_authorizations (
        command_id, account_id, wallet_id, registered_at, revoked_at,
        state_sha256, verification_digest_version, verification_digest_sha256,
        authorization_reason, authorized_at
      ) VALUES (
        requested_command_id, target_wallet.account_id, target_wallet.wallet_id,
        target_wallet.registered_at, target_wallet.revoked_at,
        current_state_sha256, verification_version, verification_digest_sha256,
        authorization_reason, recorded_at
      );
      PERFORM pg_catalog.set_config(
        'crypto_lending.wallet_metadata_revoked_rewrap_command', '', true
      );
      RETURN true;
    END;
    `;

const STATE_VERIFIER_BODY = `
    SELECT
      NOT EXISTS (
        SELECT 1
        FROM wallet_metadata_revoked_rewrap_authorizations AS evidence
        LEFT JOIN wallet_metadata_rewrap_commands AS command
          ON command.command_id = evidence.command_id
          AND command.account_id = evidence.account_id
          AND command.wallet_id = evidence.wallet_id
          AND command.prepared_state_sha256 = evidence.state_sha256
        LEFT JOIN registered_wallets AS wallet
          ON wallet.wallet_id = evidence.wallet_id
          AND wallet.account_id = evidence.account_id
          AND wallet.status = 'REVOKED'
          AND wallet.registered_at = evidence.registered_at
          AND wallet.revoked_at = evidence.revoked_at
          AND wallet.registered_by_challenge_id = command.registered_by_challenge_id
          AND wallet.chain_namespace = command.chain_namespace
          AND wallet.chain_reference = command.chain_reference
          AND wallet.registry_environment = command.registry_environment
          AND wallet.registry_version = command.registry_version
          AND wallet.registry_fingerprint_sha256 = command.registry_fingerprint_sha256
        LEFT JOIN registered_wallet_identity_digests AS alias
          ON alias.wallet_id = evidence.wallet_id
          AND alias.account_id = evidence.account_id
          AND alias.chain_namespace = wallet.chain_namespace
          AND alias.chain_reference = wallet.chain_reference
          AND alias.address_digest_version = evidence.verification_digest_version
          AND pg_catalog.sha256(alias.address_digest)
            = evidence.verification_digest_sha256
          AND alias.status = 'REVOKED'
          AND alias.registered_at = evidence.registered_at
          AND alias.revoked_at = evidence.revoked_at
        LEFT JOIN wallet_identity_key_policy AS key_policy
          ON key_policy.policy_name = 'wallet-registration-identity-hmac'
          AND key_policy.schema_version = 1
        WHERE command.command_id IS NULL
          OR wallet.wallet_id IS NULL
          OR alias.wallet_id IS NULL
          OR key_policy.policy_name IS NULL
          OR (
            command.status = 'PREPARED'
            AND command.expires_at > pg_catalog.statement_timestamp()
            AND evidence.verification_digest_version
              <> ALL (key_policy.accepted_read_versions)
          )
          OR evidence.authorization_reason IS DISTINCT FROM (
            CASE
              WHEN command.prepared_at >= evidence.revoked_at
                THEN 'PREPARED_WHILE_REVOKED'
              ELSE 'REVOKED_AFTER_PREPARE'
            END
          )
          OR evidence.authorized_at >= command.expires_at
          OR evidence.authorized_at < CASE
            WHEN evidence.authorization_reason = 'PREPARED_WHILE_REVOKED'
              THEN command.prepared_at
            ELSE evidence.revoked_at
          END
      )
      AND NOT EXISTS (
        SELECT 1
        FROM wallet_metadata_rewrap_commands AS command
        INNER JOIN registered_wallets AS wallet
          ON wallet.wallet_id = command.wallet_id
          AND wallet.account_id = command.account_id
          AND wallet.status = 'REVOKED'
          AND wallet.revoked_at IS NOT NULL
        INNER JOIN registered_wallet_identity_digests AS alias
          ON alias.wallet_id = wallet.wallet_id
          AND alias.account_id = wallet.account_id
          AND alias.chain_namespace = wallet.chain_namespace
          AND alias.chain_reference = wallet.chain_reference
          AND alias.status = 'REVOKED'
          AND alias.registered_at = wallet.registered_at
          AND alias.revoked_at = wallet.revoked_at
        INNER JOIN wallet_identity_key_policy AS key_policy
          ON key_policy.policy_name = 'wallet-registration-identity-hmac'
          AND key_policy.schema_version = 1
          AND alias.address_digest_version = ANY (key_policy.accepted_read_versions)
        LEFT JOIN wallet_metadata_revoked_rewrap_authorizations AS evidence
          ON evidence.command_id = command.command_id
        WHERE command.status = 'PREPARED'
          AND command.expires_at > pg_catalog.statement_timestamp()
          AND command.prepared_at >= wallet.revoked_at
          AND command.prepared_state_sha256 = wallet_metadata_rewrap_state_sha256(
            wallet.address_key_version, wallet.address_ciphertext,
            wallet.address_iv, wallet.address_auth_tag,
            wallet.metadata_key_version, wallet.metadata_ciphertext,
            wallet.metadata_iv, wallet.metadata_auth_tag
          )
          AND evidence.command_id IS NULL
      );
    `;

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const balanceConsumer = identifier(
    names.balanceConsumerRuntimeRole,
    'balanceConsumerRuntimeRole',
  );
  const guarded = `PUBLIC, ${api}, ${worker}, ${legacy}, ${migration}, ${balanceConsumer}`;
  return `LOCK TABLE registered_wallets, registered_wallet_identity_digests,
      wallet_identity_key_policy, wallet_metadata_rewrap_commands,
      wallet_metadata_rewrap_audit_events, wallet_metadata_seal_iv_registry
      IN ACCESS EXCLUSIVE MODE;

    CREATE TABLE ${AUTHORIZATION_TABLE} (
      command_id uuid PRIMARY KEY,
      account_id uuid NOT NULL,
      wallet_id uuid NOT NULL,
      registered_at timestamptz NOT NULL,
      revoked_at timestamptz NOT NULL,
      state_sha256 text NOT NULL,
      verification_digest_version smallint NOT NULL,
      verification_digest_sha256 bytea NOT NULL,
      authorization_reason text NOT NULL,
      authorized_at timestamptz NOT NULL,
      CONSTRAINT wallet_metadata_revoked_rewrap_authorization_command_fk
        FOREIGN KEY (command_id) REFERENCES wallet_metadata_rewrap_commands (command_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_metadata_revoked_rewrap_authorization_account_fk
        FOREIGN KEY (account_id) REFERENCES accounts (account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_metadata_revoked_rewrap_authorization_wallet_fk
        FOREIGN KEY (wallet_id) REFERENCES registered_wallets (wallet_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT wallet_metadata_revoked_rewrap_authorization_shape_check CHECK (
        revoked_at >= registered_at
        AND state_sha256 ~ '^[0-9a-f]{64}$'
        AND verification_digest_version > 0
        AND pg_catalog.octet_length(verification_digest_sha256) = 32
        AND authorization_reason IN (
          'PREPARED_WHILE_REVOKED', 'REVOKED_AFTER_PREPARE'
        )
        AND authorized_at >= registered_at
      )
    );
    COMMENT ON TABLE ${AUTHORIZATION_TABLE} IS '${AUTHORIZATION_MANIFEST}';

    CREATE FUNCTION ${AUTHORIZATION_GUARD} RETURNS trigger
    LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
    AS $function$${AUTHORIZATION_GUARD_BODY}$function$;
    CREATE FUNCTION authorize_revoked_wallet_metadata_rewrap_v1(
      requested_command_id uuid
    ) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${AUTHORIZE_REWRAP_BODY}$function$;
    CREATE FUNCTION ${STATE_VERIFIER} RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE PARALLEL UNSAFE
    AS $function$${STATE_VERIFIER_BODY}$function$;

    CREATE OR REPLACE FUNCTION ${MATERIAL_GUARD} RETURNS trigger
    LANGUAGE plpgsql PARALLEL UNSAFE
    AS $function$${MATERIAL_GUARD_BODY}$function$;
    CREATE OR REPLACE FUNCTION prepare_wallet_metadata_rewrap(
      requested_command_id uuid,
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_target_key_version smallint
    ) RETURNS TABLE (
      rewrap_outcome text,
      prepared_command_id uuid,
      prepared_account_id uuid,
      prepared_wallet_id uuid,
      prepared_challenge_id uuid,
      prepared_chain_namespace text,
      prepared_chain_reference text,
      prepared_registry_environment text,
      prepared_registry_version integer,
      prepared_registry_fingerprint_sha256 text,
      prepared_address_digest_version smallint,
      prepared_address_digest bytea,
      prepared_verification_digest_version smallint,
      prepared_verification_digest bytea,
      prepared_address_key_version smallint,
      prepared_address_ciphertext bytea,
      prepared_address_iv bytea,
      prepared_address_auth_tag bytea,
      prepared_metadata_key_version smallint,
      prepared_metadata_ciphertext bytea,
      prepared_metadata_iv bytea,
      prepared_metadata_auth_tag bytea,
      prepared_state_sha256 text,
      prepared_expires_at timestamptz
    ) LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${PREPARE_REWRAP_BODY}$function$;
    CREATE OR REPLACE FUNCTION complete_wallet_metadata_rewrap(
      requested_command_id uuid,
      requested_account_id uuid,
      requested_wallet_id uuid,
      requested_prepared_state_sha256 text,
      requested_address_key_version smallint,
      requested_address_ciphertext bytea,
      requested_address_iv bytea,
      requested_address_auth_tag bytea,
      requested_metadata_key_version smallint,
      requested_metadata_ciphertext bytea,
      requested_metadata_iv bytea,
      requested_metadata_auth_tag bytea
    ) RETURNS TABLE (rewrap_outcome text)
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE ROWS 1
    AS $function$${COMPLETE_REWRAP_BODY}$function$;

    CREATE TRIGGER wallet_revoked_rewrap_auth_insert
      BEFORE INSERT ON ${AUTHORIZATION_TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${AUTHORIZATION_GUARD};
    CREATE TRIGGER wallet_revoked_rewrap_auth_append_row
      BEFORE UPDATE OR DELETE ON ${AUTHORIZATION_TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${AUTHORIZATION_GUARD};
    CREATE TRIGGER wallet_revoked_rewrap_auth_append_truncate
      BEFORE TRUNCATE ON ${AUTHORIZATION_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION ${AUTHORIZATION_GUARD};
    ALTER TABLE ${AUTHORIZATION_TABLE}
      ENABLE ALWAYS TRIGGER wallet_revoked_rewrap_auth_insert;
    ALTER TABLE ${AUTHORIZATION_TABLE}
      ENABLE ALWAYS TRIGGER wallet_revoked_rewrap_auth_append_row;
    ALTER TABLE ${AUTHORIZATION_TABLE}
      ENABLE ALWAYS TRIGGER wallet_revoked_rewrap_auth_append_truncate;
    DO $set_revoked_wallet_metadata_rewrap_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${[
        AUTHORIZATION_GUARD,
        AUTHORIZE_REWRAP,
        STATE_VERIFIER,
        MATERIAL_GUARD,
        PREPARE_REWRAP,
        COMPLETE_REWRAP,
      ]
        .map(
          (functionIdentity) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${functionIdentity} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );`,
        )
        .join('\n      ')}
    END;
    $set_revoked_wallet_metadata_rewrap_paths$;

    DO $backfill_revoked_wallet_metadata_rewrap_authorizations$
    DECLARE candidate record;
    BEGIN
      FOR candidate IN
        SELECT command.command_id
        FROM wallet_metadata_rewrap_commands AS command
        INNER JOIN registered_wallets AS wallet
          ON wallet.wallet_id = command.wallet_id
          AND wallet.account_id = command.account_id
          AND wallet.status = 'REVOKED'
          AND wallet.revoked_at IS NOT NULL
        WHERE command.status = 'PREPARED'
          AND command.expires_at > pg_catalog.clock_timestamp()
          AND command.prepared_state_sha256 = wallet_metadata_rewrap_state_sha256(
            wallet.address_key_version, wallet.address_ciphertext,
            wallet.address_iv, wallet.address_auth_tag,
            wallet.metadata_key_version, wallet.metadata_ciphertext,
            wallet.metadata_iv, wallet.metadata_auth_tag
          )
        ORDER BY command.prepared_at, command.command_id
      LOOP
        PERFORM authorize_revoked_wallet_metadata_rewrap_v1(candidate.command_id);
      END LOOP;
    END;
    $backfill_revoked_wallet_metadata_rewrap_authorizations$;

    REVOKE ALL PRIVILEGES ON TABLE ${AUTHORIZATION_TABLE} FROM ${guarded};
    REVOKE ALL PRIVILEGES ON TYPE ${AUTHORIZATION_TABLE} FROM ${guarded};
    ${[
      AUTHORIZATION_GUARD,
      AUTHORIZE_REWRAP,
      STATE_VERIFIER,
      MATERIAL_GUARD,
      PREPARE_REWRAP,
      COMPLETE_REWRAP,
    ]
      .map((functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guarded};`)
      .join('\n    ')}`;
}

function createDownSql(): string {
  return `DO $refuse_revoked_wallet_metadata_rewrap_rollback$
    BEGIN
      RAISE EXCEPTION 'cannot roll back revoked wallet metadata rewrap protection'
        USING ERRCODE = '55000';
    END;
    $refuse_revoked_wallet_metadata_rewrap_rollback$;`;
}

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const priorMigration = createMainnetFinancialActionWalletIdentityRotationRecoveryMigration(
    names,
    {
      cumulativePrincipalVerification: cumulative,
    },
  );
  if (!priorMigration.verifySql) throw new Error('Migration 0040 must expose verification SQL');
  let prior = priorMigration.verifySql;
  prior = replaceVerifierFunctionHash(prior, MATERIAL_GUARD, MATERIAL_GUARD_BODY);
  prior = replaceVerifierFunctionHash(prior, PREPARE_REWRAP, PREPARE_REWRAP_BODY);
  prior = replaceVerifierFunctionHash(prior, COMPLETE_REWRAP, COMPLETE_REWRAP_BODY);

  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const functionSpecs = [
    {
      identity: AUTHORIZATION_GUARD,
      arguments: [] as const,
      returnType: 'trigger',
      securityDefiner: false,
      volatility: 'v',
      returnsSet: false,
      rows: 0,
      body: AUTHORIZATION_GUARD_BODY,
    },
    {
      identity: AUTHORIZE_REWRAP,
      arguments: ['uuid'] as const,
      returnType: 'boolean',
      securityDefiner: true,
      volatility: 'v',
      returnsSet: false,
      rows: 0,
      body: AUTHORIZE_REWRAP_BODY,
    },
    {
      identity: STATE_VERIFIER,
      arguments: [] as const,
      returnType: 'boolean',
      securityDefiner: true,
      volatility: 's',
      returnsSet: false,
      rows: 0,
      body: STATE_VERIFIER_BODY,
    },
  ] as const;
  const expectedFunctions = functionSpecs
    .map(
      (spec) => `(
          '${spec.identity}'::text,
          ARRAY[${spec.arguments.map((argument) => `'${argument}'::regtype::oid`).join(', ')}]::oid[],
          '${spec.returnType}'::regtype::oid,
          ${String(spec.securityDefiner)}, '${spec.volatility}'::char,
          ${String(spec.returnsSet)}, ${String(spec.rows)}::real,
          '${sourceSha256(spec.body)}'::text
        )`,
    )
    .join(',\n        ');

  return `SELECT (
    prior.valid AND relation_state.valid AND column_state.valid
    AND index_state.valid AND constraint_state.valid
    AND function_state.valid AND trigger_state.valid
    AND privilege_state.valid AND data_state.valid
  ) AS valid
  FROM (${prior}) AS prior
  CROSS JOIN (
    SELECT relation.relkind = 'r'
      AND relation.relpersistence = 'p'
      AND relation.relreplident = 'd'
      AND relation.relnatts = 10
      AND relation.relchecks = 1
      AND relation.relhasindex
      AND relation.relhastriggers
      AND NOT relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
      AND NOT relation.relispartition
      AND relation.relpartbound IS NULL
      AND access_method.amname = 'heap'
      AND owner_role.rolname = ${cumulative ? owner : 'owner_role.rolname'}
      AND pg_catalog.obj_description(relation.oid, 'pg_class') = '${AUTHORIZATION_MANIFEST}'
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = relation.oid
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite
        WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN'
      )
      AS valid
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    INNER JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation.relowner
    INNER JOIN pg_catalog.pg_am AS access_method ON access_method.oid = relation.relam
    WHERE namespace.nspname = pg_catalog.current_schema()
      AND relation.relname = '${AUTHORIZATION_TABLE}'
  ) AS relation_state
  CROSS JOIN (
    WITH expected(ordinal, column_name, type_name, not_null, default_expression) AS (VALUES
      (1, 'command_id', 'uuid', true, NULL::text),
      (2, 'account_id', 'uuid', true, NULL::text),
      (3, 'wallet_id', 'uuid', true, NULL::text),
      (4, 'registered_at', 'timestamp with time zone', true, NULL::text),
      (5, 'revoked_at', 'timestamp with time zone', true, NULL::text),
      (6, 'state_sha256', 'text', true, NULL::text),
      (7, 'verification_digest_version', 'smallint', true, NULL::text),
      (8, 'verification_digest_sha256', 'bytea', true, NULL::text),
      (9, 'authorization_reason', 'text', true, NULL::text),
      (10, 'authorized_at', 'timestamp with time zone', true, NULL::text)
    ), actual AS (
      SELECT attribute.attnum::integer AS ordinal,
        attribute.attname::text AS column_name,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
        attribute.attnotnull AS not_null,
        pg_catalog.pg_get_expr(default_state.adbin, default_state.adrelid) AS default_expression
      FROM pg_catalog.pg_attribute AS attribute
      LEFT JOIN pg_catalog.pg_attrdef AS default_state
        ON default_state.adrelid = attribute.attrelid
        AND default_state.adnum = attribute.attnum
      WHERE attribute.attrelid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    )
    SELECT pg_catalog.count(*) = 10
      AND pg_catalog.count(actual.column_name) = 10
      AND pg_catalog.bool_and(actual.ordinal = expected.ordinal)
      AND pg_catalog.bool_and(actual.type_name = expected.type_name)
      AND pg_catalog.bool_and(actual.not_null = expected.not_null)
      AND pg_catalog.bool_and(actual.default_expression IS NOT DISTINCT FROM expected.default_expression)
      AS valid
    FROM expected LEFT JOIN actual USING (column_name)
  ) AS column_state
  CROSS JOIN (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        index_relation.relname = '${AUTHORIZATION_TABLE}_pkey'
        AND index_relation.relkind = 'i'
        AND index_relation.relpersistence = 'p'
        AND access_method.amname = 'btree'
        AND index_record.indisvalid
        AND index_record.indisready
        AND index_record.indislive
        AND index_record.indisunique
        AND index_record.indisprimary
        AND NOT index_record.indisexclusion
        AND index_record.indimmediate
        AND NOT index_record.indisclustered
        AND NOT index_record.indcheckxmin
        AND NOT index_record.indisreplident
        AND NOT index_record.indnullsnotdistinct
        AND index_record.indexprs IS NULL
        AND index_record.indpred IS NULL
        AND index_record.indnkeyatts = 1
        AND index_record.indnatts = 1
        AND index_record.indkey = '1'::pg_catalog.int2vector
        AND index_record.indoption = '0'::pg_catalog.int2vector
        AND operator_class.opcname = 'uuid_ops'
      ) AS valid
    FROM pg_catalog.pg_index AS index_record
    INNER JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_record.indexrelid
    INNER JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_relation.relam
    INNER JOIN pg_catalog.pg_opclass AS operator_class
      ON operator_class.oid = index_record.indclass[0]
    WHERE index_record.indrelid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
  ) AS index_state
  CROSS JOIN (
    WITH expected(constraint_name, constraint_type, definition_sha256) AS (VALUES
      ('${AUTHORIZATION_TABLE}_pkey', 'p'::char,
        '${sourceSha256('PRIMARY KEY (command_id)')}'::text),
      ('wallet_metadata_revoked_rewrap_authorization_command_fk', 'f'::char,
        '${sourceSha256('FOREIGN KEY (command_id) REFERENCES wallet_metadata_rewrap_commands(command_id) ON UPDATE RESTRICT ON DELETE RESTRICT')}'::text),
      ('wallet_metadata_revoked_rewrap_authorization_account_fk', 'f'::char,
        '${sourceSha256('FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON UPDATE RESTRICT ON DELETE RESTRICT')}'::text),
      ('wallet_metadata_revoked_rewrap_authorization_wallet_fk', 'f'::char,
        '${sourceSha256('FOREIGN KEY (wallet_id) REFERENCES registered_wallets(wallet_id) ON UPDATE RESTRICT ON DELETE RESTRICT')}'::text),
      ('wallet_metadata_revoked_rewrap_authorization_shape_check', 'c'::char,
        'e58566172fc75d9365f2038610fd0a93927ac389b28c56e4e646ea33aa005f71'::text)
    )
    SELECT pg_catalog.count(*) = 5
      AND pg_catalog.count(constraint_state.oid) = 5
      AND pg_catalog.bool_and(constraint_state.contype = expected.constraint_type)
      AND pg_catalog.bool_and(constraint_state.convalidated)
      AND pg_catalog.bool_and(
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.pg_get_constraintdef(constraint_state.oid, false), 'UTF8'
        )), 'hex') = expected.definition_sha256
      )
      AND (
        SELECT pg_catalog.count(*) = 5
        FROM pg_catalog.pg_constraint AS all_constraint
        WHERE all_constraint.conrelid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
      ) AS valid
    FROM expected
    LEFT JOIN pg_catalog.pg_constraint AS constraint_state
      ON constraint_state.conrelid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
      AND constraint_state.conname = expected.constraint_name
  ) AS constraint_state
  CROSS JOIN (
    WITH expected(
      function_identity, argument_types, return_type, security_definer,
      volatility, returns_set, estimated_rows, body_sha256
    ) AS (VALUES ${expectedFunctions}), checked AS (
      SELECT expected.*, procedure.oid,
        language.lanname,
        owner_role.rolname AS owner_name,
        procedure.prosecdef, procedure.provolatile, procedure.proretset,
        procedure.prorows, procedure.prorettype, procedure.proparallel,
        procedure.proleakproof, procedure.proisstrict, procedure.proconfig,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex')
          AS actual_body_sha256,
        COALESCE((
          SELECT pg_catalog.array_agg(argument_type ORDER BY argument_position)
          FROM pg_catalog.unnest(procedure.proargtypes)
            WITH ORDINALITY AS argument(argument_type, argument_position)
        ), ARRAY[]::oid[]) AS actual_argument_types
      FROM expected
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
    )
    SELECT pg_catalog.count(*) = 3 AND pg_catalog.count(oid) = 3
      AND pg_catalog.bool_and(lanname = CASE
        WHEN function_identity = '${STATE_VERIFIER}' THEN 'sql' ELSE 'plpgsql' END)
      AND pg_catalog.bool_and(owner_name = ${cumulative ? owner : 'owner_name'})
      AND pg_catalog.bool_and(prosecdef = security_definer)
      AND pg_catalog.bool_and(provolatile = volatility)
      AND pg_catalog.bool_and(proretset = returns_set)
      AND pg_catalog.bool_and(prorows = estimated_rows)
      AND pg_catalog.bool_and(prorettype = return_type)
      AND pg_catalog.bool_and(proparallel = 'u' AND NOT proleakproof AND NOT proisstrict)
      AND pg_catalog.bool_and(proconfig = ARRAY[
        'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
      ]::text[])
      AND pg_catalog.bool_and(actual_argument_types = argument_types)
      AND pg_catalog.bool_and(actual_body_sha256 = body_sha256) AS valid
    FROM checked
  ) AS function_state
  CROSS JOIN (
    WITH expected(
      table_name, trigger_name, function_identity, trigger_type, expected_columns
    ) AS (VALUES
      ('${AUTHORIZATION_TABLE}', 'wallet_revoked_rewrap_auth_insert',
        '${AUTHORIZATION_GUARD}', 7, ARRAY[]::text[]),
      ('${AUTHORIZATION_TABLE}', 'wallet_revoked_rewrap_auth_append_row',
        '${AUTHORIZATION_GUARD}', 27, ARRAY[]::text[]),
      ('${AUTHORIZATION_TABLE}', 'wallet_revoked_rewrap_auth_append_truncate',
        '${AUTHORIZATION_GUARD}', 34, ARRAY[]::text[])
    )
    SELECT pg_catalog.count(*) = 3 AND pg_catalog.count(trigger_state.oid) = 3
      AND pg_catalog.bool_and(trigger_state.tgenabled = 'A')
      AND pg_catalog.bool_and(NOT trigger_state.tgisinternal)
      AND pg_catalog.bool_and(trigger_state.tgfoid = pg_catalog.to_regprocedure(expected.function_identity))
      AND pg_catalog.bool_and(trigger_state.tgtype = expected.trigger_type)
      AND pg_catalog.bool_and(trigger_state.tgnargs = 0 AND trigger_state.tgqual IS NULL)
      AND pg_catalog.bool_and(trigger_state.tgconstraint = 0
        AND NOT trigger_state.tgdeferrable AND NOT trigger_state.tginitdeferred)
      AND pg_catalog.bool_and(trigger_state.tgparentid = 0
        AND trigger_state.tgoldtable IS NULL AND trigger_state.tgnewtable IS NULL)
      AND pg_catalog.bool_and(COALESCE((
        SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY trigger_column.ordinality)
        FROM pg_catalog.unnest(trigger_state.tgattr::smallint[])
          WITH ORDINALITY AS trigger_column(attribute_number, ordinality)
        INNER JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = trigger_state.tgrelid
          AND attribute.attnum = trigger_column.attribute_number
      ), ARRAY[]::text[]) = expected.expected_columns)
      AND (
        SELECT pg_catalog.count(*) = 3
        FROM pg_catalog.pg_trigger AS all_trigger
        WHERE all_trigger.tgrelid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
          AND NOT all_trigger.tgisinternal
      ) AS valid
    FROM expected
    LEFT JOIN pg_catalog.pg_trigger AS trigger_state
      ON trigger_state.tgrelid = pg_catalog.to_regclass(expected.table_name)
      AND trigger_state.tgname = expected.trigger_name
  ) AS trigger_state
  CROSS JOIN (
    SELECT NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) AS acl
      WHERE relation.oid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
        AND acl.grantee <> relation.relowner
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_type AS row_type
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(row_type.typacl, pg_catalog.acldefault('T', row_type.typowner))
      ) AS acl
      WHERE row_type.oid = pg_catalog.to_regtype('${AUTHORIZATION_TABLE}')
        AND acl.grantee <> row_type.typowner
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
      INNER JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
      WHERE attribute.attrelid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND acl.grantee <> relation.relowner
    ) AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
      WHERE procedure.oid IN (
        ${functionSpecs.map((spec) => `pg_catalog.to_regprocedure('${spec.identity}')`).join(',\n        ')}
      ) AND acl.grantee <> procedure.proowner
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = pg_catalog.to_regclass('${AUTHORIZATION_TABLE}')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND (attribute.attname LIKE '%plaintext%'
          OR attribute.attname LIKE '%ciphertext%'
          OR attribute.attname LIKE '%auth_tag%'
          OR attribute.attname = 'address_digest')
    ) AS valid
  ) AS privilege_state
  CROSS JOIN (SELECT ${STATE_VERIFIER} AS valid) AS data_state`;
}

export function createRevokedWalletMetadataKeyRetirementMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0041',
    description: 'preserve revoked wallet metadata key retirement through guarded rewrap',
    upSql: createUpSql(names),
    downSql: createDownSql(),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0040'],
  };
}

export const createRevokedWalletMetadataKeyRetirementMigrationV0041 =
  createRevokedWalletMetadataKeyRetirementMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createRevokedWalletMetadataKeyRetirementTestSchemaMigrationV0041 =
  createRevokedWalletMetadataKeyRetirementMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
