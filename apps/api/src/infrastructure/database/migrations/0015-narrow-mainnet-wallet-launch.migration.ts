import {
  type DatabasePrincipalNames,
  PRODUCTION_DATABASE_PRINCIPALS,
} from './0005-enforce-database-principal-boundaries.migration';
import { createActiveWalletRegistrationListMigration } from './0014-list-active-wallet-registrations.migration';
import type { DatabaseMigration } from './migration';

const ACTIVE_WALLET_CAP_FUNCTION_IDENTITY = 'enforce_active_wallet_account_capacity()';
const MAX_ACTIVE_WALLETS = 32;

const MAINNET_ACTIVE_WALLET_PREFLIGHT = `
    DO $validate_mainnet_active_wallet_launch_scope$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM registered_wallets AS wallet
        WHERE wallet.status = 'ACTIVE'
          AND wallet.registry_environment = 'MAINNET'
          AND NOT (
            (wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
            OR (wallet.chain_namespace = 'solana'
              AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
          )
      ) THEN
        RAISE EXCEPTION 'existing active mainnet wallet registration is outside the production launch allowlist'
          USING ERRCODE = '23514';
      END IF;
    END;
    $validate_mainnet_active_wallet_launch_scope$;
`;

const ACTIVE_WALLET_CAP_BODY_V0014 = `
    DECLARE
      active_wallet_count bigint;
    BEGIN
      IF NEW.status <> 'ACTIVE'
        OR (TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE')
      THEN
        RETURN NEW;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(NEW.account_id::text, 56003)
      );
      EXECUTE pg_catalog.format(
        'SELECT pg_catalog.count(*) FROM %s AS wallet
         WHERE wallet.account_id = $1 AND wallet.status = ''ACTIVE''',
        TG_RELID::pg_catalog.regclass
      )
      INTO STRICT active_wallet_count
      USING NEW.account_id;

      IF active_wallet_count >= ${MAX_ACTIVE_WALLETS} THEN
        RAISE EXCEPTION 'active wallet registration capacity reached'
          USING ERRCODE = '54000';
      END IF;
      RETURN NEW;
    END;
    `;

const ACTIVE_WALLET_CAP_BODY_V0015 = `
    DECLARE
      active_wallet_count bigint;
    BEGIN
      IF NEW.status <> 'ACTIVE' THEN
        RETURN NEW;
      END IF;

      IF NOT (
        (NEW.registry_environment = 'MAINNET' AND (
          (NEW.chain_namespace = 'eip155' AND NEW.chain_reference = '1')
          OR (NEW.chain_namespace = 'solana'
            AND NEW.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
        ))
        OR (NEW.registry_environment = 'TESTNET' AND (
          (NEW.chain_namespace = 'eip155' AND NEW.chain_reference IN ('11155111', '84532'))
          OR (NEW.chain_namespace = 'solana'
            AND NEW.chain_reference = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1')
        ))
      ) THEN
        RAISE EXCEPTION 'active wallet registration is outside the production launch allowlist'
          USING ERRCODE = '23514';
      END IF;

      IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' THEN
        RETURN NEW;
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(NEW.account_id::text, 56003)
      );
      EXECUTE pg_catalog.format(
        'SELECT pg_catalog.count(*) FROM %s AS wallet
         WHERE wallet.account_id = $1 AND wallet.status = ''ACTIVE''',
        TG_RELID::pg_catalog.regclass
      )
      INTO STRICT active_wallet_count
      USING NEW.account_id;

      IF active_wallet_count >= ${MAX_ACTIVE_WALLETS} THEN
        RAISE EXCEPTION 'active wallet registration capacity reached'
          USING ERRCODE = '54000';
      END IF;
      RETURN NEW;
    END;
    `;

function replaceCapacityFunction(body: string): string {
  return `CREATE OR REPLACE FUNCTION ${ACTIVE_WALLET_CAP_FUNCTION_IDENTITY}
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $function$${body}$function$;`;
}

function replaceExpectedCapacityBody(priorVerifier: string): string {
  const opening = 'AND function_state.prosrc = $expected_cap_body$';
  const closing = '$expected_cap_body$';
  const openingIndex = priorVerifier.indexOf(opening);
  if (openingIndex < 0 || priorVerifier.indexOf(opening, openingIndex + opening.length) >= 0) {
    throw new Error('Migration 0015 capacity verifier anchor must occur exactly once');
  }
  const bodyStart = openingIndex + opening.length;
  const closingIndex = priorVerifier.indexOf(closing, bodyStart);
  if (closingIndex < 0) throw new Error('Migration 0015 capacity verifier terminator is missing');
  return `${priorVerifier.slice(0, bodyStart)}${ACTIVE_WALLET_CAP_BODY_V0015}${priorVerifier.slice(closingIndex)}`;
}

export function createMainnetWalletLaunchNarrowingMigration(
  names: DatabasePrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const priorMigration = createActiveWalletRegistrationListMigration(names, options);
  if (!priorMigration.verifySql) throw new Error('Migration 0014 must expose verification SQL');
  return {
    id: '0015',
    description: 'narrow active mainnet wallet registrations to Ethereum and Solana',
    upSql: `${MAINNET_ACTIVE_WALLET_PREFLIGHT}
    ${replaceCapacityFunction(ACTIVE_WALLET_CAP_BODY_V0015)}`,
    downSql: replaceCapacityFunction(ACTIVE_WALLET_CAP_BODY_V0014),
    verifySql: replaceExpectedCapacityBody(priorMigration.verifySql),
    supersedesVerificationOf: ['0014'],
  };
}

export const createMainnetWalletLaunchNarrowingMigrationV0015 =
  createMainnetWalletLaunchNarrowingMigration(PRODUCTION_DATABASE_PRINCIPALS);

/** NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005. */
export const createMainnetWalletLaunchNarrowingTestSchemaMigrationV0015 =
  createMainnetWalletLaunchNarrowingMigration(PRODUCTION_DATABASE_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
