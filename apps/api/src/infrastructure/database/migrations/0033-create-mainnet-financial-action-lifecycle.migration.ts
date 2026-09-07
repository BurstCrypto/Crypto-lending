import { createHash } from 'node:crypto';

import { createMainnetBalanceAgreementEvidenceV2Migration } from './0032-upgrade-mainnet-balance-agreement-evidence-v2.migration';
import {
  type BalanceConsumerPrincipalNames,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
} from './0028-suspend-generic-worker-balance-authority.migration';
import type { DatabaseMigration } from './migration';

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const ETHEREUM_MAINNET = 'eip155:1';
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const MAINNET_ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const UINT256_MAX =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const INTENT_TABLE = 'mainnet_financial_action_intents';
const EVENT_TABLE = 'mainnet_financial_action_events';
const EVIDENCE_TABLE = 'mainnet_financial_action_evidence_claims';
const INTENT_MANIFEST =
  'crypto-lending:mainnet-financial-action-intent:v1;clma-fp-1;normalized-authoritative-columns;legacy-json-digest-opaque;owner-only;runtime-unregistered';
const EVENT_MANIFEST =
  'crypto-lending:mainnet-financial-action-event:v1;clma-fp-1;append-only;canonical-public-chain-identities;caller-evidence-is-not-ledger-settlement';
const EVIDENCE_MANIFEST =
  'crypto-lending:mainnet-financial-action-evidence-claim:v1;global-digest-role-ownership;append-only';

const FINGERPRINT_BYTES = 'mainnet_action_fingerprint_bytes_v1(text,text[],text[])';
const FINGERPRINT = 'mainnet_action_fingerprint_v1(text,text[],text[])';
const CHAIN_IDENTITY_VALID = 'mainnet_action_chain_identity_valid(text,text,text)';
const REJECT_HISTORY = 'reject_mainnet_action_history_mutation()';
const ENFORCE_INTENT = 'enforce_mainnet_action_intent_linkage()';
const ENFORCE_EVENT = 'enforce_mainnet_action_event_transition()';
const VALIDATE_INTENT_COMPLETION = 'validate_mainnet_action_intent_completion()';
const VALIDATE_EVENT_EVIDENCE = 'validate_mainnet_action_event_evidence()';
const LIFECYCLE_RESULT = 'mainnet_action_lifecycle_result(uuid,uuid,text)';
const READ_LIFECYCLE = 'read_mainnet_financial_action_lifecycle(uuid,uuid)';
const PREPARE_INTENT =
  'prepare_mainnet_financial_action_lifecycle(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,integer,text,text,text,smallint,text,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,uuid)';
const BIND_SUBMISSION =
  'bind_mainnet_financial_action_submission(uuid,uuid,bigint,text,text,text,text,timestamp with time zone,uuid)';
const RECORD_BROADCAST =
  'record_mainnet_financial_action_broadcast_observation(uuid,uuid,bigint,text,uuid,text,text,text,timestamp with time zone,uuid)';
const RECORD_RECONCILIATION =
  'record_mainnet_financial_action_reconciliation_observation(uuid,uuid,bigint,text,uuid,text,text,numeric,text,numeric,text,text,text,text,timestamp with time zone,uuid)';

const ALL_FUNCTIONS = Object.freeze([
  FINGERPRINT_BYTES,
  FINGERPRINT,
  CHAIN_IDENTITY_VALID,
  REJECT_HISTORY,
  ENFORCE_INTENT,
  ENFORCE_EVENT,
  VALIDATE_INTENT_COMPLETION,
  VALIDATE_EVENT_EVIDENCE,
  LIFECYCLE_RESULT,
  READ_LIFECYCLE,
  PREPARE_INTENT,
  BIND_SUBMISSION,
  RECORD_BROADCAST,
  RECORD_RECONCILIATION,
] as const);

const FINGERPRINT_DOMAINS = Object.freeze([
  'CRYPTO_LENDING:MAINNET_ACTION:PERSISTED_INTENT:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:PREPARED_TRANSITION:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:WALLET_SUBMISSION:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:WALLET_BROADCAST_OBSERVATION:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_OBSERVATION:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:TRANSACTION_ID:FRAMED:v1',
  'CRYPTO_LENDING:MAINNET_ACTION:BLOCK_ID:FRAMED:v1',
] as const);

export const MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS = Object.freeze([
  Object.freeze({
    name: 'ethereum-intent',
    domain: 'CRYPTO_LENDING:MAINNET_ACTION:PERSISTED_INTENT:FRAMED:v1',
    fieldNames: Object.freeze([
      'fingerprintEncodingVersion',
      'intentId',
      'networkId',
      'amountAtomic',
    ]),
    fieldValues: Object.freeze([
      '1',
      '11111111-1111-4111-8111-111111111111',
      'eip155:1',
      '1000000',
    ]),
    encodedHex:
      '434c4d414650010006646f6d61696e010000003843525950544f5f4c454e44494e473a4d41494e4e45545f414354494f4e3a5045525349535445445f494e54454e543a4652414d45443a7631001a66696e6765727072696e74456e636f64696e6756657273696f6e0100000001310008696e74656e744964010000002431313131313131312d313131312d343131312d383131312d31313131313131313131313100096e6574776f726b496401000000086569703135353a31000c616d6f756e7441746f6d6963010000000731303030303030',
    sha256: 'e672e31e8e43af4e842b455732232f6edcb398b4be16b0e2481127877781b16c',
  }),
  Object.freeze({
    name: 'solana-submission',
    domain: 'CRYPTO_LENDING:MAINNET_ACTION:WALLET_SUBMISSION:FRAMED:v1',
    fieldNames: Object.freeze(['fingerprintEncodingVersion', 'networkId', 'transactionId']),
    fieldValues: Object.freeze([
      '1',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      '3vQB7B6MrGQZaxCuFg4oh',
    ]),
    encodedHex:
      '434c4d414650010006646f6d61696e010000003943525950544f5f4c454e44494e473a4d41494e4e45545f414354494f4e3a57414c4c45545f5355424d495353494f4e3a4652414d45443a7631001a66696e6765727072696e74456e636f64696e6756657273696f6e01000000013100096e6574776f726b49640100000027736f6c616e613a3565796b7434557346763850384e4a64545245705931767a714b715a4b766470000d7472616e73616374696f6e49640100000015337651423742364d7247515a617843754667346f68',
    sha256: '844539971400540a0c6feb03b8526c2ddb93e6bdf5707703bb1838a3f39a6c18',
  }),
  Object.freeze({
    name: 'null-reconciliation',
    domain: 'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_OBSERVATION:FRAMED:v1',
    fieldNames: Object.freeze([
      'fingerprintEncodingVersion',
      'transactionPosition',
      'transactionBlockId',
    ]),
    fieldValues: Object.freeze(['1', null, null]),
    encodedHex:
      '434c4d414650010006646f6d61696e010000004243525950544f5f4c454e44494e473a4d41494e4e45545f414354494f4e3a5245434f4e43494c494154494f4e5f4f42534552564154494f4e3a4652414d45443a7631001a66696e6765727072696e74456e636f64696e6756657273696f6e01000000013100137472616e73616374696f6e506f736974696f6e000000000000127472616e73616374696f6e426c6f636b49640000000000',
    sha256: '375d8c09095a24a75e2785193a02ee65ffd3484f07f2ebf9cef7a89ee2b268c9',
  }),
  Object.freeze({
    name: 'finalized-reconciliation',
    domain: 'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_OBSERVATION:FRAMED:v1',
    fieldNames: Object.freeze(['fingerprintEncodingVersion', 'outcome', 'effectEvidenceSha256']),
    fieldValues: Object.freeze([
      '1',
      'FINALIZED_SUCCESS',
      'abababababababababababababababababababababababababababababababab',
    ]),
    encodedHex:
      '434c4d414650010006646f6d61696e010000004243525950544f5f4c454e44494e473a4d41494e4e45545f414354494f4e3a5245434f4e43494c494154494f4e5f4f42534552564154494f4e3a4652414d45443a7631001a66696e6765727072696e74456e636f64696e6756657273696f6e01000000013100076f7574636f6d65010000001146494e414c495a45445f53554343455353001465666665637445766964656e6365536861323536010000004061626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162',
    sha256: 'aa3d5c5b03d86bbf5c047bfb1c967def4e0a977a2503f26e5b900f45411464e6',
  }),
  Object.freeze({
    name: 'genesis-snapshot',
    domain: 'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
    fieldNames: Object.freeze(['fingerprintEncodingVersion', 'previousSnapshotSha256']),
    fieldValues: Object.freeze(['1', null]),
    encodedHex:
      '434c4d414650010006646f6d61696e010000003043525950544f5f4c454e44494e473a4d41494e4e45545f414354494f4e3a534e415053484f543a4652414d45443a7631001a66696e6765727072696e74456e636f64696e6756657273696f6e010000000131001670726576696f7573536e617073686f745368613235360000000000',
    sha256: '0def9229fa93856e2f685e95123cb90b613697796da323feaf62830690099401',
  }),
  Object.freeze({
    name: 'later-snapshot',
    domain: 'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
    fieldNames: Object.freeze(['fingerprintEncodingVersion', 'previousSnapshotSha256']),
    fieldValues: Object.freeze([
      '1',
      'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
    ]),
    encodedHex:
      '434c4d414650010006646f6d61696e010000003043525950544f5f4c454e44494e473a4d41494e4e45545f414354494f4e3a534e415053484f543a4652414d45443a7631001a66696e6765727072696e74456e636f64696e6756657273696f6e010000000131001670726576696f7573536e617073686f74536861323536010000004063646364636463646364636463646364636463646364636463646364636463646364636463646364636463646364636463646364636463646364636463646364',
    sha256: 'dc0d788f3f58bb5d2081965970e0d6f019af062cc34fb4d5f322682ba3b5b281',
  }),
] as const);

/**
 * CLMA-FP-1 is deliberately distinct from the volatile domain recorder's
 * `${domain}\0${JSON.stringify(values)}` hashes. Migration 0033 stores that
 * old intent hash only as an opaque commitment and never treats it as a
 * persisted intent, transition, or snapshot fingerprint.
 */
const FINGERPRINT_BYTES_BODY = `
    DECLARE
      encoded bytea := pg_catalog.decode('434c4d41465001', 'hex');
      field_name text;
      field_value text;
      field_name_bytes bytea;
      field_value_bytes bytea;
      field_index integer;
      seen_names text[] := ARRAY['domain']::text[];
    BEGIN
      IF requested_domain NOT IN (
          ${FINGERPRINT_DOMAINS.map((domain) => `'${domain}'`).join(',\n          ')}
        )
        OR pg_catalog.array_ndims(requested_field_names) <> 1
        OR pg_catalog.array_ndims(requested_field_values) <> 1
        OR pg_catalog.array_lower(requested_field_names, 1) <> 1
        OR pg_catalog.array_lower(requested_field_values, 1) <> 1
        OR pg_catalog.cardinality(requested_field_names) NOT BETWEEN 1 AND 64
        OR pg_catalog.cardinality(requested_field_names)
          <> pg_catalog.cardinality(requested_field_values)
        OR requested_field_names[1] <> 'fingerprintEncodingVersion'
        OR requested_field_values[1] <> '1'
      THEN
        RAISE EXCEPTION 'invalid CLMA-FP-1 frame request' USING ERRCODE = '22023';
      END IF;

      field_name_bytes := pg_catalog.convert_to('domain', 'UTF8');
      field_value_bytes := pg_catalog.convert_to(requested_domain, 'UTF8');
      encoded := encoded
        || pg_catalog.int2send(pg_catalog.octet_length(field_name_bytes)::smallint)
        || field_name_bytes
        || pg_catalog.decode('01', 'hex')
        || pg_catalog.int4send(pg_catalog.octet_length(field_value_bytes))
        || field_value_bytes;

      FOR field_index IN 1..pg_catalog.cardinality(requested_field_names) LOOP
        field_name := requested_field_names[field_index];
        field_value := requested_field_values[field_index];
        IF field_name IS NULL
          OR field_name !~ '^[a-z][A-Za-z0-9]{0,63}$'
          OR field_name = ANY(seen_names)
        THEN
          RAISE EXCEPTION 'invalid CLMA-FP-1 field name' USING ERRCODE = '22023';
        END IF;
        seen_names := pg_catalog.array_append(seen_names, field_name);
        field_name_bytes := pg_catalog.convert_to(field_name, 'UTF8');
        encoded := encoded
          || pg_catalog.int2send(pg_catalog.octet_length(field_name_bytes)::smallint)
          || field_name_bytes;
        IF field_value IS NULL THEN
          encoded := encoded || pg_catalog.decode('00', 'hex') || pg_catalog.int4send(0);
        ELSE
          field_value_bytes := pg_catalog.convert_to(field_value, 'UTF8');
          IF pg_catalog.octet_length(field_value_bytes) > 16384 THEN
            RAISE EXCEPTION 'CLMA-FP-1 field value is too large' USING ERRCODE = '22023';
          END IF;
          encoded := encoded
            || pg_catalog.decode('01', 'hex')
            || pg_catalog.int4send(pg_catalog.octet_length(field_value_bytes))
            || field_value_bytes;
        END IF;
      END LOOP;
      RETURN encoded;
    END;`;

const FINGERPRINT_BODY = `
    BEGIN
      RETURN pg_catalog.encode(
        pg_catalog.sha256(
          mainnet_action_fingerprint_bytes_v1(
            requested_domain, requested_field_names, requested_field_values
          )
        ),
        'hex'
      );
    END;`;

const CHAIN_IDENTITY_VALID_BODY = `
    DECLARE
      alphabet CONSTANT text := '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      numeric_value numeric := 0;
      remaining numeric;
      digit integer;
      character_index integer;
      leading_zero_bytes integer := 0;
      decoded_bytes integer := 0;
      expected_bytes integer;
    BEGIN
      IF requested_network_id = 'eip155:1' THEN
        IF requested_kind IN ('TRANSACTION', 'BLOCK') THEN
          RETURN requested_identity ~ '^0x[0-9a-f]{64}$'
            AND requested_identity <> '0x' || pg_catalog.repeat('0', 64);
        END IF;
        RETURN requested_kind = 'MARKET_OR_ASSET'
          AND requested_identity ~ '^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$'
          AND requested_identity !~ '^0x0+$';
      END IF;
      IF requested_network_id
          <> 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
        OR requested_kind NOT IN ('TRANSACTION', 'BLOCK', 'MARKET_OR_ASSET')
        OR requested_identity !~ '^[1-9A-HJ-NP-Za-km-z]{32,90}$'
      THEN
        RETURN false;
      END IF;
      expected_bytes := CASE requested_kind WHEN 'TRANSACTION' THEN 64 ELSE 32 END;
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
      RETURN leading_zero_bytes + decoded_bytes = expected_bytes AND numeric_value <> 0;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;`;

const REJECT_HISTORY_BODY = `
    BEGIN
      RAISE EXCEPTION 'mainnet financial action history is append-only' USING ERRCODE = '55000';
    END;`;

const ENFORCE_INTENT_BODY = `
    DECLARE
      operation_state text;
      operation_type text;
      wallet_status text;
      wallet_environment text;
      wallet_namespace text;
      wallet_reference text;
      wallet_digest_version smallint;
      wallet_digest_hex text;
      database_prepared_at timestamptz;
      expected_network_id text;
      expected_fingerprint text;
    BEGIN
      SELECT
        operation.current_state,
        operation.operation_type,
        wallet.status,
        wallet.registry_environment,
        wallet.chain_namespace,
        wallet.chain_reference,
        wallet.address_digest_version,
        pg_catalog.encode(wallet.address_digest, 'hex')
      INTO STRICT
        operation_state,
        operation_type,
        wallet_status,
        wallet_environment,
        wallet_namespace,
        wallet_reference,
        wallet_digest_version,
        wallet_digest_hex
      FROM yield_operations AS operation
      INNER JOIN yield_operation_submissions AS submission
        ON submission.operation_id = operation.operation_id
      INNER JOIN ledger_transactions AS ledger_transaction
        ON ledger_transaction.transaction_id = operation.ledger_transaction_id
        AND ledger_transaction.book_id = operation.ledger_book_id
        AND ledger_transaction.tenant_account_id = operation.actor_account_id
      INNER JOIN registered_wallets AS wallet ON wallet.wallet_id = NEW.wallet_id
      WHERE operation.operation_id = NEW.yield_operation_id
        AND operation.actor_account_id = NEW.account_id
        AND operation.ledger_transaction_id = NEW.ledger_transaction_id
        AND operation.ledger_book_id = NEW.ledger_book_id
        AND submission.submission_id = NEW.yield_submission_id
        AND wallet.account_id = NEW.account_id
      FOR UPDATE OF operation, submission, ledger_transaction, wallet;

      expected_network_id := CASE
        WHEN wallet_namespace = 'eip155' AND wallet_reference = '1' THEN 'eip155:1'
        WHEN wallet_namespace = 'solana'
          AND wallet_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          THEN 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
        ELSE NULL
      END;
      database_prepared_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF operation_state <> 'SUBMITTED'
        OR NOT (
          (operation_type = 'ALLOCATE' AND NEW.action_type = 'SUPPLY')
          OR (operation_type = 'WITHDRAW' AND NEW.action_type = 'WITHDRAW')
          OR (operation_type = 'REBALANCE' AND NEW.action_type IN ('SUPPLY', 'WITHDRAW'))
        )
        OR wallet_status <> 'ACTIVE'
        OR wallet_environment <> 'MAINNET'
        OR expected_network_id IS NULL
        OR NEW.network_id IS DISTINCT FROM expected_network_id
        OR NEW.wallet_chain_namespace IS DISTINCT FROM wallet_namespace
        OR NEW.wallet_chain_reference IS DISTINCT FROM wallet_reference
        OR NEW.wallet_identity_digest_version IS DISTINCT FROM wallet_digest_version
        OR NEW.wallet_identity_digest_hex IS DISTINCT FROM wallet_digest_hex
        OR NEW.fingerprint_encoding_version <> 1
        OR NOT (
          (NEW.network_id = 'eip155:1' AND (
            (NEW.provider_id = 'aave' AND NEW.protocol_id = 'aave-v3')
            OR (NEW.provider_id = 'morpho' AND NEW.protocol_id = 'morpho-blue')
            OR (NEW.provider_id = 'compound' AND NEW.protocol_id = 'compound-iii')
            OR (NEW.provider_id = 'spark' AND NEW.protocol_id = 'sparklend')
            OR (NEW.provider_id = 'euler' AND NEW.protocol_id = 'euler-v2')
            OR (NEW.provider_id = 'gearbox' AND NEW.protocol_id = 'gearbox-v3')
          ))
          OR (NEW.network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' AND (
            (NEW.provider_id = 'kamino' AND NEW.protocol_id = 'kamino-lend')
            OR (NEW.provider_id = 'save' AND NEW.protocol_id = 'save-lend')
            OR (NEW.provider_id = 'project-0' AND NEW.protocol_id = 'marginfi-v2')
            OR (NEW.provider_id = 'jupiter' AND NEW.protocol_id = 'jupiter-lend')
          ))
        )
        OR NOT mainnet_action_chain_identity_valid(
          NEW.network_id, NEW.market_id, 'MARKET_OR_ASSET'
        )
        OR NEW.asset_registry_version <> 1
        OR NEW.asset_registry_fingerprint_sha256
          <> '${MAINNET_ASSET_REGISTRY_FINGERPRINT}'
        OR NEW.asset_decimals <> 6
        OR NOT (
          (NEW.network_id = 'eip155:1' AND (
            (NEW.asset_symbol = 'USDC'
              AND NEW.asset_identity = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
            OR (NEW.asset_symbol = 'USDT'
              AND NEW.asset_identity = '0xdac17f958d2ee523a2206206994597c13d831ec7')
            OR (NEW.asset_symbol = 'PYUSD'
              AND NEW.asset_identity = '0x6c3ea9036406852006290770bedfcaba0e23a0e8')
          ))
          OR (NEW.network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' AND (
            (NEW.asset_symbol = 'USDC'
              AND NEW.asset_identity = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
            OR (NEW.asset_symbol = 'USDT'
              AND NEW.asset_identity = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
            OR (NEW.asset_symbol = 'PYUSD'
              AND NEW.asset_identity = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo')
          ))
        )
        -- BORROW/REPAY have no truthful parent yield-operation type in migration 0012.
        OR NEW.action_type NOT IN ('SUPPLY', 'WITHDRAW')
        OR NEW.amount_atomic <= 0 OR NEW.amount_atomic > ${UINT256_MAX}::numeric
        OR NEW.requested_value_usd_micros <= 0
        OR NEW.requested_value_usd_micros > ${UINT256_MAX}::numeric
        OR NEW.maximum_network_fee_atomic < 0
        OR NEW.maximum_network_fee_atomic > ${UINT256_MAX}::numeric
        OR NEW.maximum_network_fee_basis_points NOT BETWEEN 0 AND 10000
        OR NEW.minimum_post_action_native_balance_atomic <= 0
        OR NEW.minimum_post_action_native_balance_atomic > ${UINT256_MAX}::numeric
        OR NEW.allowance_mode <> 'EXACT'
        OR NEW.allowance_amount_atomic < 0
        OR NEW.allowance_amount_atomic > ${UINT256_MAX}::numeric
        OR NEW.allowance_amount_atomic <> (
          CASE WHEN NEW.action_type = 'SUPPLY' THEN NEW.amount_atomic ELSE 0 END
        )
        OR NEW.signing_responsibility <> 'USER_WALLET_ONLY'
        OR NEW.broadcast_responsibility <> 'USER_WALLET_ONLY'
        OR NEW.may_authorize_financial_action
        OR NEW.api_may_sign
        OR NEW.api_may_broadcast
        OR NEW.cross_chain_execution_allowed
        OR NEW.automatic_resend_allowed
        OR NEW.automatic_fee_escalation_allowed
        OR NEW.volatile_intent_durable_replay_protection_verified
        OR NOT NEW.database_replay_protection_enforced
        OR NEW.ledger_settlement_authority
        OR NEW.issued_at > database_prepared_at
        OR NEW.expires_at <= database_prepared_at
        OR NEW.expires_at <= NEW.issued_at
        OR NEW.expires_at - NEW.issued_at > interval '5 minutes'
        OR pg_catalog.date_trunc('milliseconds', NEW.issued_at) <> NEW.issued_at
        OR pg_catalog.date_trunc('milliseconds', NEW.expires_at) <> NEW.expires_at
      THEN
        RAISE EXCEPTION 'mainnet financial action intent linkage is unavailable'
          USING ERRCODE = '42501';
      END IF;

      expected_fingerprint := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:PERSISTED_INTENT:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'intentId', 'accountId', 'yieldOperationId',
          'yieldSubmissionId', 'ledgerTransactionId', 'ledgerBookId', 'walletId',
          'walletChainNamespace', 'walletChainReference',
          'walletIdentityDigestVersion', 'walletIdentityDigestHex', 'networkId',
          'providerId', 'protocolId', 'marketId', 'assetRegistryVersion',
          'assetRegistryFingerprintSha256', 'assetSymbol', 'assetIdentity',
          'assetDecimals', 'actionType', 'amountAtomic', 'requestedValueUsdMicros',
          'maximumNetworkFeeAtomic', 'maximumNetworkFeeBasisPoints',
          'minimumPostActionNativeBalanceAtomic', 'allowanceMode',
          'allowanceAmountAtomic', 'idempotencyKeyDigestSha256',
          'replayProtectionId', 'issuedAtEpochMilliseconds', 'expiresAtEpochMilliseconds',
          'signingResponsibility', 'broadcastResponsibility',
          'mayAuthorizeFinancialAction', 'apiMaySign', 'apiMayBroadcast',
          'crossChainExecutionAllowed',
          'automaticResendAllowed', 'automaticFeeEscalationAllowed',
          'volatileIntentDurableReplayProtectionVerified',
          'databaseReplayProtectionEnforced',
          'ledgerSettlementAuthority', 'volatileIntentCommitmentSha256'
        ]::text[],
        ARRAY[
          '1', NEW.intent_id::text, NEW.account_id::text, NEW.yield_operation_id::text,
          NEW.yield_submission_id::text, NEW.ledger_transaction_id::text,
          NEW.ledger_book_id::text, NEW.wallet_id::text,
          NEW.wallet_chain_namespace, NEW.wallet_chain_reference,
          NEW.wallet_identity_digest_version::text, NEW.wallet_identity_digest_hex,
          NEW.network_id, NEW.provider_id, NEW.protocol_id, NEW.market_id,
          NEW.asset_registry_version::text, NEW.asset_registry_fingerprint_sha256,
          NEW.asset_symbol, NEW.asset_identity, NEW.asset_decimals::text,
          NEW.action_type, NEW.amount_atomic::text, NEW.requested_value_usd_micros::text,
          NEW.maximum_network_fee_atomic::text,
          NEW.maximum_network_fee_basis_points::text,
          NEW.minimum_post_action_native_balance_atomic::text, NEW.allowance_mode,
          NEW.allowance_amount_atomic::text, NEW.idempotency_key_digest_sha256,
          NEW.replay_protection_id::text,
          ((extract(epoch FROM NEW.issued_at) * 1000)::bigint)::text,
          ((extract(epoch FROM NEW.expires_at) * 1000)::bigint)::text,
          NEW.signing_responsibility, NEW.broadcast_responsibility,
          NEW.may_authorize_financial_action::text,
          NEW.api_may_sign::text, NEW.api_may_broadcast::text,
          NEW.cross_chain_execution_allowed::text,
          NEW.automatic_resend_allowed::text,
          NEW.automatic_fee_escalation_allowed::text,
          NEW.volatile_intent_durable_replay_protection_verified::text,
          NEW.database_replay_protection_enforced::text,
          NEW.ledger_settlement_authority::text,
          NEW.volatile_intent_commitment_sha256
        ]::text[]
      );
      NEW.intent_record_fingerprint_sha256 := expected_fingerprint;
      NEW.prepared_at := database_prepared_at;
      RETURN NEW;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action intent linkage is unavailable'
        USING ERRCODE = '42501';
    END;`;

const ENFORCE_EVENT_BODY = `
    DECLARE
      intent mainnet_financial_action_intents%ROWTYPE;
      previous_event mainnet_financial_action_events%ROWTYPE;
      submission_event mainnet_financial_action_events%ROWTYPE;
      last_reconciliation mainnet_financial_action_events%ROWTYPE;
      last_transaction_observation mainnet_financial_action_events%ROWTYPE;
      database_recorded_at timestamptz;
      expected_transition text;
      expected_snapshot text;
    BEGIN
      -- This intent row lock is the lifecycle's per-intent serialization primitive.
      SELECT stored.* INTO STRICT intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = NEW.intent_id
      FOR UPDATE;
      database_recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF NEW.fingerprint_encoding_version <> 1
        OR NEW.fingerprint_encoding_version <> intent.fingerprint_encoding_version
        OR NEW.network_id IS DISTINCT FROM intent.network_id
        OR NOT pg_catalog.isfinite(NEW.effective_at)
        OR NEW.effective_at > database_recorded_at
        OR pg_catalog.date_trunc('milliseconds', NEW.effective_at) <> NEW.effective_at
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action event' USING ERRCODE = '22023';
      END IF;

      IF NEW.revision = 1 THEN
        IF NEW.stage <> 'PREPARED'
          OR NEW.previous_snapshot_sha256 IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM mainnet_financial_action_events AS existing
            WHERE existing.intent_id = NEW.intent_id
          )
        THEN
          RAISE EXCEPTION 'mainnet financial action event compare-and-swap conflict'
            USING ERRCODE = '40001';
        END IF;
      ELSE
        SELECT stored.* INTO STRICT previous_event
        FROM mainnet_financial_action_events AS stored
        WHERE stored.intent_id = NEW.intent_id
        ORDER BY stored.revision DESC
        LIMIT 1;
        IF NEW.revision <> previous_event.revision + 1
          OR NEW.previous_snapshot_sha256 IS DISTINCT FROM previous_event.snapshot_sha256
          OR previous_event.terminal
          OR NOT (
            (previous_event.stage = 'PREPARED'
              AND NEW.stage = 'WALLET_SIGNED_SUBMISSION_BOUND')
            OR (previous_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
              AND NEW.stage = 'BROADCAST_OUTCOME_AMBIGUOUS')
            OR (previous_event.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
              AND NEW.stage IN (
                'RECONCILIATION_AMBIGUOUS', 'FINALIZED_SUCCESS',
                'FINALIZED_FAILURE', 'REORG_QUARANTINED'
              ))
            OR (previous_event.stage IN (
                'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
              ) AND NEW.stage IN (
                'RECONCILIATION_AMBIGUOUS', 'FINALIZED_SUCCESS',
                'FINALIZED_FAILURE', 'REORG_QUARANTINED'
              ))
          )
        THEN
          RAISE EXCEPTION 'mainnet financial action event compare-and-swap conflict'
            USING ERRCODE = '40001';
        END IF;
      END IF;

      IF NEW.stage <> 'PREPARED' THEN
        IF NOT mainnet_action_chain_identity_valid(
          intent.network_id, NEW.chain_transaction_id, 'TRANSACTION'
        ) THEN
          RAISE EXCEPTION 'invalid canonical mainnet transaction identity'
            USING ERRCODE = '22023';
        END IF;
        NEW.transaction_identity_sha256 := mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:TRANSACTION_ID:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'networkId', 'transactionId']::text[],
          ARRAY['1', intent.network_id, NEW.chain_transaction_id]::text[]
        );
        -- The first signed-bound event establishes the submission identity. Every
        -- later event must inherit that exact stored identity instead of trusting
        -- its caller.
        IF NEW.stage <> 'WALLET_SIGNED_SUBMISSION_BOUND' THEN
          SELECT stored.* INTO STRICT submission_event
          FROM mainnet_financial_action_events AS stored
          WHERE stored.intent_id = NEW.intent_id
            AND stored.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
          IF NEW.submission_fingerprint_sha256
              IS DISTINCT FROM submission_event.submission_fingerprint_sha256
            OR NEW.chain_transaction_id IS DISTINCT FROM submission_event.chain_transaction_id
            OR NEW.transaction_identity_sha256
              IS DISTINCT FROM submission_event.transaction_identity_sha256
          THEN
            RAISE EXCEPTION 'mainnet financial action submission identity conflict'
              USING ERRCODE = '23505';
          END IF;
        END IF;
      END IF;

      IF NEW.stage IN (
          'RECONCILIATION_AMBIGUOUS', 'FINALIZED_SUCCESS',
          'FINALIZED_FAILURE', 'REORG_QUARANTINED'
        )
      THEN
        IF NEW.transaction_block_id IS NULL THEN
          NEW.transaction_block_identity_sha256 := NULL;
        ELSE
          IF NOT mainnet_action_chain_identity_valid(
            intent.network_id, NEW.transaction_block_id, 'BLOCK'
          ) THEN
            RAISE EXCEPTION 'invalid canonical transaction block identity'
              USING ERRCODE = '22023';
          END IF;
          NEW.transaction_block_identity_sha256 := mainnet_action_fingerprint_v1(
            'CRYPTO_LENDING:MAINNET_ACTION:BLOCK_ID:FRAMED:v1',
            ARRAY['fingerprintEncodingVersion', 'networkId', 'blockId']::text[],
            ARRAY['1', intent.network_id, NEW.transaction_block_id]::text[]
          );
        END IF;
        IF NOT mainnet_action_chain_identity_valid(
          intent.network_id, NEW.finalized_block_id, 'BLOCK'
        ) THEN
          RAISE EXCEPTION 'invalid canonical finalized block identity'
            USING ERRCODE = '22023';
        END IF;
        NEW.finalized_block_identity_sha256 := mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:BLOCK_ID:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'networkId', 'blockId']::text[],
          ARRAY['1', intent.network_id, NEW.finalized_block_id]::text[]
        );

        SELECT stored.* INTO last_reconciliation
        FROM mainnet_financial_action_events AS stored
        WHERE stored.intent_id = NEW.intent_id
          AND stored.reconciliation_outcome IS NOT NULL
        ORDER BY stored.revision DESC
        LIMIT 1;
        SELECT stored.* INTO last_transaction_observation
        FROM mainnet_financial_action_events AS stored
        WHERE stored.intent_id = NEW.intent_id
          AND stored.reconciliation_outcome IS NOT NULL
          AND stored.transaction_position IS NOT NULL
        ORDER BY stored.revision DESC
        LIMIT 1;
        IF last_reconciliation.intent_id IS NOT NULL AND (
          NEW.effective_at < last_reconciliation.effective_at
          OR NEW.finalized_position < last_reconciliation.finalized_position
          OR (
            NEW.finalized_position = last_reconciliation.finalized_position
            AND NEW.finalized_block_id IS DISTINCT FROM last_reconciliation.finalized_block_id
            AND NEW.reconciliation_outcome <> 'REORGED_OUT'
          )
        ) THEN
          RAISE EXCEPTION 'non-monotonic mainnet financial action reconciliation'
            USING ERRCODE = '22000';
        END IF;
        IF last_transaction_observation.intent_id IS NOT NULL
          AND NEW.transaction_position IS NOT NULL
          AND (
            NEW.transaction_position
              IS DISTINCT FROM last_transaction_observation.transaction_position
            OR NEW.transaction_block_id
              IS DISTINCT FROM last_transaction_observation.transaction_block_id
          )
          AND NEW.reconciliation_outcome <> 'REORGED_OUT'
        THEN
          RAISE EXCEPTION 'non-monotonic mainnet financial action transaction anchor'
            USING ERRCODE = '22000';
        END IF;
        IF NEW.reconciliation_outcome = 'REORGED_OUT'
          AND last_transaction_observation.intent_id IS NOT NULL
          AND (
            NEW.transaction_position
              IS DISTINCT FROM last_transaction_observation.transaction_position
            OR NEW.transaction_block_id
              IS DISTINCT FROM last_transaction_observation.transaction_block_id
          )
        THEN
          RAISE EXCEPTION 'mainnet financial action reorg anchor conflict'
            USING ERRCODE = '22000';
        END IF;
      END IF;

      expected_transition := CASE NEW.stage
        WHEN 'PREPARED' THEN mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:PREPARED_TRANSITION:FRAMED:v1',
          ARRAY[
            'fingerprintEncodingVersion', 'intentId', 'intentRecordFingerprintSha256'
          ]::text[],
          ARRAY['1', intent.intent_id::text, intent.intent_record_fingerprint_sha256]::text[]
        )
        WHEN 'WALLET_SIGNED_SUBMISSION_BOUND' THEN mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:WALLET_SUBMISSION:FRAMED:v1',
          ARRAY[
            'fingerprintEncodingVersion', 'intentId', 'intentRecordFingerprintSha256',
            'networkId', 'walletId', 'chainTransactionId', 'transactionIdentitySha256',
            'walletSignedPayloadSha256', 'walletSignatureEvidenceSha256',
            'signedAtEpochMilliseconds'
          ]::text[],
          ARRAY[
            '1', intent.intent_id::text, intent.intent_record_fingerprint_sha256,
            intent.network_id, intent.wallet_id::text, NEW.chain_transaction_id,
            NEW.transaction_identity_sha256, NEW.wallet_signed_payload_sha256,
            NEW.wallet_signature_evidence_sha256,
            ((extract(epoch FROM NEW.effective_at) * 1000)::bigint)::text
          ]::text[]
        )
        WHEN 'BROADCAST_OUTCOME_AMBIGUOUS' THEN mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:WALLET_BROADCAST_OBSERVATION:FRAMED:v1',
          ARRAY[
            'fingerprintEncodingVersion', 'observationId', 'intentId',
            'submissionFingerprintSha256', 'networkId', 'chainTransactionId',
            'transactionIdentitySha256', 'outcome', 'evidenceSha256',
            'observedAtEpochMilliseconds'
          ]::text[],
          ARRAY[
            '1', NEW.observation_id::text, intent.intent_id::text,
            NEW.submission_fingerprint_sha256, intent.network_id,
            NEW.chain_transaction_id, NEW.transaction_identity_sha256,
            NEW.broadcast_outcome, NEW.wallet_broadcast_evidence_sha256,
            ((extract(epoch FROM NEW.effective_at) * 1000)::bigint)::text
          ]::text[]
        )
        ELSE mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_OBSERVATION:FRAMED:v1',
          ARRAY[
            'fingerprintEncodingVersion', 'observationId', 'intentId',
            'submissionFingerprintSha256', 'networkId', 'chainTransactionId',
            'transactionIdentitySha256', 'outcome', 'transactionPosition',
            'transactionBlockId', 'transactionBlockIdentitySha256', 'finalizedPosition',
            'finalizedBlockId', 'finalizedBlockIdentitySha256', 'effectEvidenceSha256',
            'failureEvidenceSha256', 'sourceEvidenceSha256',
            'observedAtEpochMilliseconds'
          ]::text[],
          ARRAY[
            '1', NEW.observation_id::text, intent.intent_id::text,
            NEW.submission_fingerprint_sha256, intent.network_id,
            NEW.chain_transaction_id, NEW.transaction_identity_sha256,
            NEW.reconciliation_outcome, NEW.transaction_position::text,
            NEW.transaction_block_id, NEW.transaction_block_identity_sha256,
            NEW.finalized_position::text, NEW.finalized_block_id,
            NEW.finalized_block_identity_sha256, NEW.effect_evidence_sha256,
            NEW.failure_evidence_sha256, NEW.source_evidence_sha256,
            ((extract(epoch FROM NEW.effective_at) * 1000)::bigint)::text
          ]::text[]
        )
      END;
      IF NEW.stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
        AND NEW.submission_fingerprint_sha256 IS DISTINCT FROM expected_transition
      THEN
        RAISE EXCEPTION 'mainnet financial action submission fingerprint conflict'
          USING ERRCODE = '23505';
      END IF;
      NEW.transition_fingerprint_sha256 := expected_transition;
      NEW.recorded_at := database_recorded_at;
      NEW.terminal := NEW.stage IN (
        'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORG_QUARANTINED'
      );
      NEW.requires_manual_reconciliation := NEW.stage = 'REORG_QUARANTINED';
      NEW.ledger_settlement_authority := false;
      expected_snapshot := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'intentId', 'revision', 'stage',
          'previousSnapshotSha256', 'transitionFingerprintSha256'
        ]::text[],
        ARRAY[
          '1', NEW.intent_id::text, NEW.revision::text, NEW.stage,
          NEW.previous_snapshot_sha256, NEW.transition_fingerprint_sha256
        ]::text[]
      );
      NEW.snapshot_sha256 := expected_snapshot;
      RETURN NEW;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action event predecessor is unavailable'
        USING ERRCODE = '40001';
    END;`;

const VALIDATE_INTENT_COMPLETION_BODY = `
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM mainnet_financial_action_events AS event
        WHERE event.intent_id = NEW.intent_id
          AND event.revision = 1
          AND event.stage = 'PREPARED'
      ) THEN
        RAISE EXCEPTION 'mainnet financial action intent requires one prepared event'
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;`;

const VALIDATE_EVENT_EVIDENCE_BODY = `
    DECLARE
      actual_claims text[];
      expected_claims text[];
    BEGIN
      SELECT COALESCE(
        pg_catalog.array_agg(
          claim.evidence_role || ':' || claim.evidence_digest_sha256
          ORDER BY claim.evidence_role
        ),
        ARRAY[]::text[]
      ) INTO actual_claims
      FROM mainnet_financial_action_evidence_claims AS claim
      WHERE claim.intent_id = NEW.intent_id AND claim.event_revision = NEW.revision;
      expected_claims := CASE NEW.stage
        WHEN 'PREPARED' THEN ARRAY[]::text[]
        WHEN 'WALLET_SIGNED_SUBMISSION_BOUND'
          THEN ARRAY[
            'WALLET_SIGNATURE_EVIDENCE:' || NEW.wallet_signature_evidence_sha256,
            'WALLET_SIGNED_PAYLOAD:' || NEW.wallet_signed_payload_sha256
          ]::text[]
        WHEN 'BROADCAST_OUTCOME_AMBIGUOUS'
          THEN ARRAY[
            'WALLET_BROADCAST_EVIDENCE:' || NEW.wallet_broadcast_evidence_sha256
          ]::text[]
        WHEN 'FINALIZED_SUCCESS'
          THEN ARRAY[
            'RECONCILIATION_EFFECT_EVIDENCE:' || NEW.effect_evidence_sha256,
            'RECONCILIATION_SOURCE_EVIDENCE:' || NEW.source_evidence_sha256
          ]::text[]
        WHEN 'FINALIZED_FAILURE'
          THEN ARRAY[
            'RECONCILIATION_FAILURE_EVIDENCE:' || NEW.failure_evidence_sha256,
            'RECONCILIATION_SOURCE_EVIDENCE:' || NEW.source_evidence_sha256
          ]::text[]
        ELSE ARRAY[
          'RECONCILIATION_SOURCE_EVIDENCE:' || NEW.source_evidence_sha256
        ]::text[]
      END;
      IF actual_claims IS DISTINCT FROM expected_claims THEN
        RAISE EXCEPTION 'mainnet financial action event evidence is incomplete'
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;`;

const LIFECYCLE_RESULT_BODY = `
    BEGIN
      IF requested_outcome NOT IN ('RECORDED', 'REPLAYED', 'READ') THEN
        RAISE EXCEPTION 'invalid mainnet financial action result outcome' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY
      SELECT
        requested_outcome,
        event.intent_id,
        event.stage,
        event.revision,
        event.snapshot_sha256,
        intent.intent_record_fingerprint_sha256,
        intent.volatile_intent_commitment_sha256,
        intent.fingerprint_encoding_version,
        intent.account_id,
        intent.yield_operation_id,
        intent.yield_submission_id,
        intent.ledger_transaction_id,
        intent.ledger_book_id,
        intent.wallet_id,
        intent.wallet_chain_namespace,
        intent.wallet_chain_reference,
        intent.wallet_identity_digest_version,
        intent.wallet_identity_digest_hex,
        intent.network_id,
        intent.provider_id,
        intent.protocol_id,
        intent.market_id,
        intent.asset_registry_version,
        intent.asset_registry_fingerprint_sha256,
        intent.asset_symbol,
        intent.asset_identity,
        intent.asset_decimals,
        intent.action_type,
        intent.amount_atomic,
        intent.requested_value_usd_micros,
        intent.maximum_network_fee_atomic,
        intent.maximum_network_fee_basis_points,
        intent.minimum_post_action_native_balance_atomic,
        intent.allowance_mode,
        intent.allowance_amount_atomic,
        intent.idempotency_key_digest_sha256,
        intent.replay_protection_id,
        event.chain_transaction_id,
        event.submission_fingerprint_sha256,
        event.observation_id,
        event.broadcast_outcome,
        event.reconciliation_outcome,
        event.transaction_position,
        event.transaction_block_id,
        event.transaction_block_identity_sha256,
        event.finalized_position,
        event.finalized_block_id,
        event.finalized_block_identity_sha256,
        retained_anchor.transaction_position,
        retained_anchor.transaction_block_id,
        retained_anchor.transaction_block_identity_sha256,
        event.effective_at,
        intent.expires_at,
        event.terminal,
        event.requires_manual_reconciliation,
        intent.database_replay_protection_enforced,
        event.ledger_settlement_authority,
        event.recorded_at
      FROM mainnet_financial_action_events AS event
      INNER JOIN mainnet_financial_action_intents AS intent
        ON intent.intent_id = event.intent_id
      LEFT JOIN LATERAL (
        SELECT anchor.transaction_position, anchor.transaction_block_id,
          anchor.transaction_block_identity_sha256
        FROM mainnet_financial_action_events AS anchor
        WHERE anchor.intent_id = event.intent_id
          AND anchor.reconciliation_outcome IS NOT NULL
          AND anchor.transaction_position IS NOT NULL
        ORDER BY anchor.revision DESC
        LIMIT 1
      ) AS retained_anchor ON true
      WHERE event.intent_id = requested_intent_id
        AND intent.account_id = requested_account_id
      ORDER BY event.revision DESC
      LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'mainnet financial action lifecycle is unavailable'
          USING ERRCODE = '55000';
      END IF;
    END;`;

const READ_LIFECYCLE_BODY = `
    BEGIN
      RETURN QUERY
      SELECT * FROM mainnet_action_lifecycle_result(
        requested_account_id, requested_intent_id, 'READ'
      );
    END;`;

function identifier(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value))
    throw new Error(`${name} must be a lowercase PostgreSQL identifier`);
  return `"${value}"`;
}

function literal(value: string, name: string): string {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(`${name} must contain only lowercase PostgreSQL identifier characters`);
  }
  return `'${value}'`;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sourceSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceExactlyOnce(source: string, target: string, replacement: string): string {
  const first = source.indexOf(target);
  if (first < 0 || source.indexOf(target, first + target.length) >= 0) {
    throw new Error('Expected exactly one predecessor verifier fragment');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + target.length)}`;
}

function resultColumns(): string {
  return `
      record_outcome text,
      result_intent_id uuid,
      lifecycle_stage text,
      lifecycle_revision bigint,
      current_snapshot_sha256 text,
      intent_record_fingerprint_sha256 text,
      volatile_intent_commitment_sha256 text,
      fingerprint_encoding_version smallint,
      account_id uuid,
      yield_operation_id uuid,
      yield_submission_id uuid,
      ledger_transaction_id uuid,
      ledger_book_id uuid,
      wallet_id uuid,
      wallet_chain_namespace text,
      wallet_chain_reference text,
      wallet_identity_digest_version smallint,
      wallet_identity_digest_hex text,
      network_id text,
      provider_id text,
      protocol_id text,
      market_id text,
      asset_registry_version integer,
      asset_registry_fingerprint_sha256 text,
      asset_symbol text,
      asset_identity text,
      asset_decimals smallint,
      action_type text,
      amount_atomic numeric,
      requested_value_usd_micros numeric,
      maximum_network_fee_atomic numeric,
      maximum_network_fee_basis_points integer,
      minimum_post_action_native_balance_atomic numeric,
      allowance_mode text,
      allowance_amount_atomic numeric,
      idempotency_key_digest_sha256 text,
      replay_protection_id uuid,
      chain_transaction_id text,
      submission_fingerprint_sha256 text,
      observation_id uuid,
      broadcast_outcome text,
      reconciliation_outcome text,
      transaction_position numeric,
      transaction_block_id text,
      transaction_block_identity_sha256 text,
      finalized_position numeric,
      finalized_block_id text,
      finalized_block_identity_sha256 text,
      last_observed_transaction_position numeric,
      last_observed_transaction_block_id text,
      last_observed_transaction_block_identity_sha256 text,
      effective_at timestamptz,
      expires_at timestamptz,
      terminal boolean,
      requires_manual_reconciliation boolean,
      database_replay_protection_enforced boolean,
      ledger_settlement_authority boolean,
      recorded_at timestamptz`;
}

const PREPARE_INTENT_BODY = `
    DECLARE
      existing_intent mainnet_financial_action_intents%ROWTYPE;
      inserted_intent mainnet_financial_action_intents%ROWTYPE;
      inserted_event mainnet_financial_action_events%ROWTYPE;
      wallet_digest_version smallint;
      wallet_digest_hex text;
      wallet_namespace text;
      wallet_reference text;
    BEGIN
      IF requested_volatile_intent_commitment_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_volatile_intent_commitment_sha256 = pg_catalog.repeat('0', 64)
        OR requested_idempotency_key_digest_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_idempotency_key_digest_sha256 = pg_catalog.repeat('0', 64)
        OR requested_network_id NOT IN (
          'eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
        )
        OR requested_asset_registry_version <> 1
        OR requested_asset_registry_fingerprint_sha256
          <> '${MAINNET_ASSET_REGISTRY_FINGERPRINT}'
        OR requested_asset_decimals <> 6
        OR requested_action_type NOT IN ('SUPPLY', 'WITHDRAW')
        OR requested_allowance_mode <> 'EXACT'
        OR requested_amount_atomic !~ '^(?:0|[1-9][0-9]{0,77})$'
        OR requested_requested_value_usd_micros !~ '^(?:0|[1-9][0-9]{0,77})$'
        OR requested_maximum_network_fee_atomic !~ '^(?:0|[1-9][0-9]{0,77})$'
        OR requested_minimum_post_action_native_balance_atomic
          !~ '^(?:0|[1-9][0-9]{0,77})$'
        OR requested_allowance_amount_atomic !~ '^(?:0|[1-9][0-9]{0,77})$'
        OR requested_maximum_network_fee_basis_points NOT BETWEEN 0 AND 10000
        OR NOT pg_catalog.isfinite(requested_issued_at)
        OR NOT pg_catalog.isfinite(requested_expires_at)
        OR pg_catalog.date_trunc('milliseconds', requested_issued_at) <> requested_issued_at
        OR pg_catalog.date_trunc('milliseconds', requested_expires_at) <> requested_expires_at
        OR substring(requested_intent_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_intent_id::text FROM 20 FOR 1) NOT IN ('8', '9', 'a', 'b')
        OR substring(requested_replay_protection_id::text FROM 15 FOR 1) <> '4'
        OR substring(requested_replay_protection_id::text FROM 20 FOR 1)
          NOT IN ('8', '9', 'a', 'b')
        OR pg_catalog.cardinality(ARRAY[
          requested_intent_id, requested_account_id, requested_wallet_id,
          requested_replay_protection_id
        ]::uuid[]) <> pg_catalog.cardinality(ARRAY(
          SELECT DISTINCT identity FROM pg_catalog.unnest(ARRAY[
            requested_intent_id, requested_account_id, requested_wallet_id,
            requested_replay_protection_id
          ]::uuid[]) AS identities(identity)
        ))
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action intent request' USING ERRCODE = '22023';
      END IF;

      SELECT stored.* INTO existing_intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
      FOR UPDATE;
      IF FOUND THEN
        IF existing_intent.account_id IS DISTINCT FROM requested_account_id
          OR existing_intent.yield_operation_id IS DISTINCT FROM requested_yield_operation_id
          OR existing_intent.yield_submission_id IS DISTINCT FROM requested_yield_submission_id
          OR existing_intent.ledger_transaction_id IS DISTINCT FROM requested_ledger_transaction_id
          OR existing_intent.ledger_book_id IS DISTINCT FROM requested_ledger_book_id
          OR existing_intent.wallet_id IS DISTINCT FROM requested_wallet_id
          OR existing_intent.network_id IS DISTINCT FROM requested_network_id
          OR existing_intent.provider_id IS DISTINCT FROM requested_provider_id
          OR existing_intent.protocol_id IS DISTINCT FROM requested_protocol_id
          OR existing_intent.market_id IS DISTINCT FROM requested_market_id
          OR existing_intent.asset_registry_version
            IS DISTINCT FROM requested_asset_registry_version
          OR existing_intent.asset_registry_fingerprint_sha256
            IS DISTINCT FROM requested_asset_registry_fingerprint_sha256
          OR existing_intent.asset_symbol IS DISTINCT FROM requested_asset_symbol
          OR existing_intent.asset_identity IS DISTINCT FROM requested_asset_identity
          OR existing_intent.asset_decimals IS DISTINCT FROM requested_asset_decimals
          OR existing_intent.action_type IS DISTINCT FROM requested_action_type
          OR existing_intent.amount_atomic IS DISTINCT FROM requested_amount_atomic::numeric
          OR existing_intent.requested_value_usd_micros
            IS DISTINCT FROM requested_requested_value_usd_micros::numeric
          OR existing_intent.maximum_network_fee_atomic
            IS DISTINCT FROM requested_maximum_network_fee_atomic::numeric
          OR existing_intent.maximum_network_fee_basis_points
            IS DISTINCT FROM requested_maximum_network_fee_basis_points
          OR existing_intent.minimum_post_action_native_balance_atomic
            IS DISTINCT FROM requested_minimum_post_action_native_balance_atomic::numeric
          OR existing_intent.allowance_mode IS DISTINCT FROM requested_allowance_mode
          OR existing_intent.allowance_amount_atomic
            IS DISTINCT FROM requested_allowance_amount_atomic::numeric
          OR existing_intent.volatile_intent_commitment_sha256
            IS DISTINCT FROM requested_volatile_intent_commitment_sha256
          OR existing_intent.idempotency_key_digest_sha256
            IS DISTINCT FROM requested_idempotency_key_digest_sha256
          OR existing_intent.replay_protection_id IS DISTINCT FROM requested_replay_protection_id
          OR existing_intent.issued_at IS DISTINCT FROM requested_issued_at
          OR existing_intent.expires_at IS DISTINCT FROM requested_expires_at
        THEN
          RAISE EXCEPTION 'mainnet financial action intent replay conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
          requested_account_id, requested_intent_id, 'REPLAYED'
        );
        RETURN;
      END IF;

      SELECT
        wallet.address_digest_version,
        pg_catalog.encode(wallet.address_digest, 'hex'),
        wallet.chain_namespace,
        wallet.chain_reference
      INTO STRICT wallet_digest_version, wallet_digest_hex, wallet_namespace, wallet_reference
      FROM registered_wallets AS wallet
      WHERE wallet.wallet_id = requested_wallet_id;

      INSERT INTO mainnet_financial_action_intents (
        intent_id,
        fingerprint_encoding_version,
        volatile_intent_commitment_sha256,
        intent_record_fingerprint_sha256,
        account_id,
        yield_operation_id,
        yield_submission_id,
        ledger_transaction_id,
        ledger_book_id,
        wallet_id,
        wallet_chain_namespace,
        wallet_chain_reference,
        wallet_identity_digest_version,
        wallet_identity_digest_hex,
        network_id,
        provider_id,
        protocol_id,
        market_id,
        asset_registry_version,
        asset_registry_fingerprint_sha256,
        asset_symbol,
        asset_identity,
        asset_decimals,
        action_type,
        amount_atomic,
        requested_value_usd_micros,
        maximum_network_fee_atomic,
        maximum_network_fee_basis_points,
        minimum_post_action_native_balance_atomic,
        allowance_mode,
        allowance_amount_atomic,
        idempotency_key_digest_sha256,
        replay_protection_id,
        issued_at,
        expires_at,
        signing_responsibility,
        broadcast_responsibility,
        may_authorize_financial_action,
        api_may_sign,
        api_may_broadcast,
        cross_chain_execution_allowed,
        automatic_resend_allowed,
        automatic_fee_escalation_allowed,
        volatile_intent_durable_replay_protection_verified,
        database_replay_protection_enforced,
        ledger_settlement_authority,
        correlation_id,
        prepared_at
      ) VALUES (
        requested_intent_id,
        1,
        requested_volatile_intent_commitment_sha256,
        requested_volatile_intent_commitment_sha256,
        requested_account_id,
        requested_yield_operation_id,
        requested_yield_submission_id,
        requested_ledger_transaction_id,
        requested_ledger_book_id,
        requested_wallet_id,
        wallet_namespace,
        wallet_reference,
        wallet_digest_version,
        wallet_digest_hex,
        requested_network_id,
        requested_provider_id,
        requested_protocol_id,
        requested_market_id,
        requested_asset_registry_version,
        requested_asset_registry_fingerprint_sha256,
        requested_asset_symbol,
        requested_asset_identity,
        requested_asset_decimals,
        requested_action_type,
        requested_amount_atomic::numeric,
        requested_requested_value_usd_micros::numeric,
        requested_maximum_network_fee_atomic::numeric,
        requested_maximum_network_fee_basis_points,
        requested_minimum_post_action_native_balance_atomic::numeric,
        requested_allowance_mode,
        requested_allowance_amount_atomic::numeric,
        requested_idempotency_key_digest_sha256,
        requested_replay_protection_id,
        requested_issued_at,
        requested_expires_at,
        'USER_WALLET_ONLY',
        'USER_WALLET_ONLY',
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        false,
        requested_correlation_id,
        requested_issued_at
      )
      ON CONFLICT DO NOTHING
      RETURNING * INTO inserted_intent;

      IF inserted_intent.intent_id IS NULL THEN
        SELECT stored.* INTO existing_intent
        FROM mainnet_financial_action_intents AS stored
        WHERE stored.intent_id = requested_intent_id
        FOR UPDATE;
        IF FOUND
          AND existing_intent.account_id = requested_account_id
          AND existing_intent.yield_operation_id = requested_yield_operation_id
          AND existing_intent.yield_submission_id = requested_yield_submission_id
          AND existing_intent.ledger_transaction_id = requested_ledger_transaction_id
          AND existing_intent.ledger_book_id = requested_ledger_book_id
          AND existing_intent.wallet_id = requested_wallet_id
          AND existing_intent.network_id = requested_network_id
          AND existing_intent.provider_id = requested_provider_id
          AND existing_intent.protocol_id = requested_protocol_id
          AND existing_intent.market_id = requested_market_id
          AND existing_intent.asset_registry_version = requested_asset_registry_version
          AND existing_intent.asset_registry_fingerprint_sha256
            = requested_asset_registry_fingerprint_sha256
          AND existing_intent.asset_symbol = requested_asset_symbol
          AND existing_intent.asset_identity = requested_asset_identity
          AND existing_intent.asset_decimals = requested_asset_decimals
          AND existing_intent.action_type = requested_action_type
          AND existing_intent.amount_atomic = requested_amount_atomic::numeric
          AND existing_intent.requested_value_usd_micros
            = requested_requested_value_usd_micros::numeric
          AND existing_intent.maximum_network_fee_atomic
            = requested_maximum_network_fee_atomic::numeric
          AND existing_intent.maximum_network_fee_basis_points
            = requested_maximum_network_fee_basis_points
          AND existing_intent.minimum_post_action_native_balance_atomic
            = requested_minimum_post_action_native_balance_atomic::numeric
          AND existing_intent.allowance_mode = requested_allowance_mode
          AND existing_intent.allowance_amount_atomic = requested_allowance_amount_atomic::numeric
          AND existing_intent.volatile_intent_commitment_sha256
            = requested_volatile_intent_commitment_sha256
          AND existing_intent.idempotency_key_digest_sha256
            = requested_idempotency_key_digest_sha256
          AND existing_intent.replay_protection_id = requested_replay_protection_id
          AND existing_intent.issued_at = requested_issued_at
          AND existing_intent.expires_at = requested_expires_at
        THEN
          RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
            requested_account_id, requested_intent_id, 'REPLAYED'
          );
          RETURN;
        END IF;
        RAISE EXCEPTION 'mainnet financial action idempotency or replay ownership conflict'
          USING ERRCODE = '23505';
      END IF;

      INSERT INTO mainnet_financial_action_events (
        intent_id, revision, fingerprint_encoding_version, stage,
        previous_snapshot_sha256, transition_fingerprint_sha256, snapshot_sha256,
        submission_fingerprint_sha256, network_id, chain_transaction_id,
        transaction_identity_sha256,
        observation_id, broadcast_outcome, reconciliation_outcome,
        transaction_position, transaction_block_id, transaction_block_identity_sha256,
        finalized_position, finalized_block_id, finalized_block_identity_sha256,
        wallet_signed_payload_sha256, wallet_signature_evidence_sha256,
        wallet_broadcast_evidence_sha256, source_evidence_sha256,
        effect_evidence_sha256, failure_evidence_sha256,
        effective_at, correlation_id, recorded_at, terminal,
        requires_manual_reconciliation, ledger_settlement_authority
      ) VALUES (
        inserted_intent.intent_id, 1, 1, 'PREPARED',
        NULL, inserted_intent.intent_record_fingerprint_sha256,
        inserted_intent.intent_record_fingerprint_sha256,
        NULL, inserted_intent.network_id, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL,
        inserted_intent.prepared_at, inserted_intent.correlation_id,
        inserted_intent.prepared_at, false, false, false
      ) RETURNING * INTO inserted_event;
      RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
        requested_account_id, requested_intent_id, 'RECORDED'
      );
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action wallet linkage is unavailable'
        USING ERRCODE = '42501';
    END;`;

const BIND_SUBMISSION_BODY = `
    DECLARE
      intent mainnet_financial_action_intents%ROWTYPE;
      current_event mainnet_financial_action_events%ROWTYPE;
      replay_event mainnet_financial_action_events%ROWTYPE;
      inserted_event mainnet_financial_action_events%ROWTYPE;
      database_recorded_at timestamptz;
      transaction_identity_sha256 text;
      submission_fingerprint text;
    BEGIN
      IF requested_expected_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_expected_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_wallet_signed_payload_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_wallet_signed_payload_sha256 = pg_catalog.repeat('0', 64)
        OR requested_wallet_signature_evidence_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_wallet_signature_evidence_sha256 = pg_catalog.repeat('0', 64)
        OR requested_wallet_signed_payload_sha256 = requested_wallet_signature_evidence_sha256
        OR NOT pg_catalog.isfinite(requested_signed_at)
        OR pg_catalog.date_trunc('milliseconds', requested_signed_at) <> requested_signed_at
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action submission' USING ERRCODE = '22023';
      END IF;
      SELECT stored.* INTO STRICT intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR UPDATE;
      IF NOT mainnet_action_chain_identity_valid(
        intent.network_id, requested_transaction_id, 'TRANSACTION'
      ) THEN
        RAISE EXCEPTION 'invalid mainnet financial action transaction identity'
          USING ERRCODE = '22023';
      END IF;
      transaction_identity_sha256 := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:TRANSACTION_ID:FRAMED:v1',
        ARRAY['fingerprintEncodingVersion', 'networkId', 'transactionId']::text[],
        ARRAY['1', intent.network_id, requested_transaction_id]::text[]
      );
      submission_fingerprint := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:WALLET_SUBMISSION:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'intentId', 'intentRecordFingerprintSha256',
          'networkId', 'walletId', 'chainTransactionId', 'transactionIdentitySha256',
          'walletSignedPayloadSha256', 'walletSignatureEvidenceSha256',
          'signedAtEpochMilliseconds'
        ]::text[],
        ARRAY[
          '1', intent.intent_id::text, intent.intent_record_fingerprint_sha256,
          intent.network_id, intent.wallet_id::text, requested_transaction_id,
          transaction_identity_sha256,
          requested_wallet_signed_payload_sha256,
          requested_wallet_signature_evidence_sha256,
          ((extract(epoch FROM requested_signed_at) * 1000)::bigint)::text
        ]::text[]
      );
      SELECT stored.* INTO replay_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.intent_id = intent.intent_id
        AND stored.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
      IF FOUND THEN
        IF replay_event.transition_fingerprint_sha256 <> submission_fingerprint
          OR replay_event.chain_transaction_id IS DISTINCT FROM requested_transaction_id
          OR replay_event.transaction_identity_sha256
            IS DISTINCT FROM transaction_identity_sha256
        THEN
          RAISE EXCEPTION 'mainnet financial action submission replay conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
          intent.account_id, intent.intent_id, 'REPLAYED'
        );
        RETURN;
      END IF;
      SELECT stored.* INTO STRICT current_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.intent_id = intent.intent_id
      ORDER BY stored.revision DESC LIMIT 1;
      database_recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF current_event.stage <> 'PREPARED'
        OR current_event.revision <> requested_expected_revision
        OR current_event.snapshot_sha256 <> requested_expected_snapshot_sha256
        OR requested_signed_at < intent.prepared_at
        OR requested_signed_at > database_recorded_at
        OR requested_signed_at >= intent.expires_at
        OR database_recorded_at >= intent.expires_at
        OR NOT EXISTS (
          SELECT 1
          FROM registered_wallets AS wallet
          INNER JOIN yield_operations AS operation
            ON operation.operation_id = intent.yield_operation_id
            AND operation.actor_account_id = intent.account_id
            AND operation.ledger_transaction_id = intent.ledger_transaction_id
            AND operation.ledger_book_id = intent.ledger_book_id
          WHERE wallet.wallet_id = intent.wallet_id
            AND wallet.account_id = intent.account_id
            AND wallet.status = 'ACTIVE'
            AND wallet.registry_environment = 'MAINNET'
            AND wallet.address_digest_version = intent.wallet_identity_digest_version
            AND pg_catalog.encode(wallet.address_digest, 'hex')
              = intent.wallet_identity_digest_hex
            AND wallet.chain_namespace = intent.wallet_chain_namespace
            AND wallet.chain_reference = intent.wallet_chain_reference
            AND (
              (intent.network_id = 'eip155:1'
                AND wallet.chain_namespace = 'eip155' AND wallet.chain_reference = '1')
              OR (intent.network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
                AND wallet.chain_namespace = 'solana'
                AND wallet.chain_reference = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
            )
            AND operation.current_state = 'SUBMITTED'
          FOR UPDATE OF wallet, operation
        )
      THEN
        RAISE EXCEPTION 'mainnet financial action submission compare-and-swap conflict'
          USING ERRCODE = '40001';
      END IF;
      INSERT INTO mainnet_financial_action_events (
        intent_id, revision, fingerprint_encoding_version, stage,
        previous_snapshot_sha256, transition_fingerprint_sha256, snapshot_sha256,
        submission_fingerprint_sha256, network_id, chain_transaction_id,
        transaction_identity_sha256,
        observation_id, broadcast_outcome, reconciliation_outcome,
        transaction_position, transaction_block_id, transaction_block_identity_sha256,
        finalized_position, finalized_block_id, finalized_block_identity_sha256,
        wallet_signed_payload_sha256, wallet_signature_evidence_sha256,
        wallet_broadcast_evidence_sha256, source_evidence_sha256,
        effect_evidence_sha256, failure_evidence_sha256,
        effective_at, correlation_id, recorded_at, terminal,
        requires_manual_reconciliation, ledger_settlement_authority
      ) VALUES (
        intent.intent_id, current_event.revision + 1, 1,
        'WALLET_SIGNED_SUBMISSION_BOUND', current_event.snapshot_sha256,
        submission_fingerprint, submission_fingerprint, submission_fingerprint,
        intent.network_id, requested_transaction_id, transaction_identity_sha256,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        requested_wallet_signed_payload_sha256,
        requested_wallet_signature_evidence_sha256,
        NULL, NULL, NULL, NULL,
        requested_signed_at, requested_correlation_id, database_recorded_at,
        false, false, false
      ) RETURNING * INTO inserted_event;
      INSERT INTO mainnet_financial_action_evidence_claims (
        evidence_digest_sha256, evidence_role, transition_fingerprint_sha256,
        intent_id, event_revision, recorded_at
      )
      SELECT claim.digest, claim.role, submission_fingerprint,
        intent.intent_id, inserted_event.revision, inserted_event.recorded_at
      FROM (VALUES
        (requested_wallet_signed_payload_sha256, 'WALLET_SIGNED_PAYLOAD'::text),
        (requested_wallet_signature_evidence_sha256, 'WALLET_SIGNATURE_EVIDENCE'::text)
      ) AS claim(digest, role)
      ORDER BY claim.digest;
      RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
        intent.account_id, intent.intent_id, 'RECORDED'
      );
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action lifecycle is unavailable'
        USING ERRCODE = '55000';
    END;`;

const RECORD_BROADCAST_BODY = `
    DECLARE
      intent mainnet_financial_action_intents%ROWTYPE;
      current_event mainnet_financial_action_events%ROWTYPE;
      submission_event mainnet_financial_action_events%ROWTYPE;
      replay_event mainnet_financial_action_events%ROWTYPE;
      inserted_event mainnet_financial_action_events%ROWTYPE;
      database_recorded_at timestamptz;
      transaction_identity_sha256 text;
      observation_fingerprint text;
    BEGIN
      IF requested_expected_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_expected_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_evidence_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_evidence_sha256 = pg_catalog.repeat('0', 64)
        OR requested_outcome NOT IN (
          'WALLET_REPORTED_SUBMITTED', 'WALLET_REPORTED_AMBIGUOUS',
          'WALLET_REPORTED_REJECTED'
        )
        OR NOT pg_catalog.isfinite(requested_observed_at)
        OR pg_catalog.date_trunc('milliseconds', requested_observed_at) <> requested_observed_at
      THEN
        RAISE EXCEPTION 'invalid wallet broadcast observation' USING ERRCODE = '22023';
      END IF;
      SELECT stored.* INTO STRICT intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR UPDATE;
      IF NOT mainnet_action_chain_identity_valid(
        intent.network_id, requested_transaction_id, 'TRANSACTION'
      ) THEN
        RAISE EXCEPTION 'invalid mainnet financial action transaction identity'
          USING ERRCODE = '22023';
      END IF;
      transaction_identity_sha256 := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:TRANSACTION_ID:FRAMED:v1',
        ARRAY['fingerprintEncodingVersion', 'networkId', 'transactionId']::text[],
        ARRAY['1', intent.network_id, requested_transaction_id]::text[]
      );
      SELECT stored.* INTO STRICT submission_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.intent_id = intent.intent_id
        AND stored.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
      IF submission_event.chain_transaction_id IS DISTINCT FROM requested_transaction_id
        OR submission_event.transaction_identity_sha256 <> transaction_identity_sha256
      THEN
        RAISE EXCEPTION 'mainnet financial action transaction identity conflict'
          USING ERRCODE = '23505';
      END IF;
      observation_fingerprint := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:WALLET_BROADCAST_OBSERVATION:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'observationId', 'intentId',
          'submissionFingerprintSha256', 'networkId', 'chainTransactionId',
          'transactionIdentitySha256', 'outcome', 'evidenceSha256',
          'observedAtEpochMilliseconds'
        ]::text[],
        ARRAY[
          '1', requested_observation_id::text, intent.intent_id::text,
          submission_event.submission_fingerprint_sha256, intent.network_id,
          requested_transaction_id, transaction_identity_sha256,
          requested_outcome, requested_evidence_sha256,
          ((extract(epoch FROM requested_observed_at) * 1000)::bigint)::text
        ]::text[]
      );
      SELECT stored.* INTO replay_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.observation_id = requested_observation_id;
      IF FOUND THEN
        IF replay_event.intent_id <> intent.intent_id
          OR replay_event.stage <> 'BROADCAST_OUTCOME_AMBIGUOUS'
          OR replay_event.transition_fingerprint_sha256 <> observation_fingerprint
          OR replay_event.chain_transaction_id IS DISTINCT FROM requested_transaction_id
        THEN
          RAISE EXCEPTION 'mainnet financial action observation ownership conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
          intent.account_id, intent.intent_id, 'REPLAYED'
        );
        RETURN;
      END IF;
      IF EXISTS (
        SELECT 1 FROM mainnet_financial_action_events AS stored
        WHERE stored.intent_id = intent.intent_id
          AND stored.stage = 'BROADCAST_OUTCOME_AMBIGUOUS'
      ) THEN
        RAISE EXCEPTION 'mainnet financial action broadcast attempt is already consumed'
          USING ERRCODE = '23505';
      END IF;
      SELECT stored.* INTO STRICT current_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.intent_id = intent.intent_id
      ORDER BY stored.revision DESC LIMIT 1;
      database_recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF current_event.stage <> 'WALLET_SIGNED_SUBMISSION_BOUND'
        OR current_event.revision <> requested_expected_revision
        OR current_event.snapshot_sha256 <> requested_expected_snapshot_sha256
        OR requested_observed_at < submission_event.effective_at
        OR requested_observed_at > database_recorded_at
      THEN
        RAISE EXCEPTION 'mainnet financial action broadcast compare-and-swap conflict'
          USING ERRCODE = '40001';
      END IF;
      INSERT INTO mainnet_financial_action_events (
        intent_id, revision, fingerprint_encoding_version, stage,
        previous_snapshot_sha256, transition_fingerprint_sha256, snapshot_sha256,
        submission_fingerprint_sha256, network_id, chain_transaction_id,
        transaction_identity_sha256,
        observation_id, broadcast_outcome, reconciliation_outcome,
        transaction_position, transaction_block_id, transaction_block_identity_sha256,
        finalized_position, finalized_block_id, finalized_block_identity_sha256,
        wallet_signed_payload_sha256, wallet_signature_evidence_sha256,
        wallet_broadcast_evidence_sha256, source_evidence_sha256,
        effect_evidence_sha256, failure_evidence_sha256,
        effective_at, correlation_id, recorded_at, terminal,
        requires_manual_reconciliation, ledger_settlement_authority
      ) VALUES (
        intent.intent_id, current_event.revision + 1, 1,
        'BROADCAST_OUTCOME_AMBIGUOUS', current_event.snapshot_sha256,
        observation_fingerprint, observation_fingerprint,
        submission_event.submission_fingerprint_sha256, intent.network_id,
        requested_transaction_id, transaction_identity_sha256,
        requested_observation_id, requested_outcome,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, requested_evidence_sha256, NULL, NULL, NULL,
        requested_observed_at, requested_correlation_id, database_recorded_at,
        false, false, false
      ) RETURNING * INTO inserted_event;
      INSERT INTO mainnet_financial_action_evidence_claims (
        evidence_digest_sha256, evidence_role, transition_fingerprint_sha256,
        intent_id, event_revision, recorded_at
      ) VALUES (
        requested_evidence_sha256, 'WALLET_BROADCAST_EVIDENCE',
        observation_fingerprint, intent.intent_id, inserted_event.revision,
        inserted_event.recorded_at
      );
      RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
        intent.account_id, intent.intent_id, 'RECORDED'
      );
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action lifecycle is unavailable'
        USING ERRCODE = '55000';
    END;`;

const RECORD_RECONCILIATION_BODY = `
    DECLARE
      intent mainnet_financial_action_intents%ROWTYPE;
      current_event mainnet_financial_action_events%ROWTYPE;
      submission_event mainnet_financial_action_events%ROWTYPE;
      broadcast_event mainnet_financial_action_events%ROWTYPE;
      replay_event mainnet_financial_action_events%ROWTYPE;
      inserted_event mainnet_financial_action_events%ROWTYPE;
      database_recorded_at timestamptz;
      evidence_floor_at timestamptz;
      transaction_identity_sha256 text;
      transaction_block_identity_sha256 text;
      finalized_block_identity_sha256 text;
      observation_fingerprint text;
      next_stage text;
    BEGIN
      IF requested_account_id IS NULL
        OR requested_intent_id IS NULL
        OR requested_expected_revision IS NULL
        OR requested_expected_snapshot_sha256 IS NULL
        OR requested_observation_id IS NULL
        OR requested_transaction_id IS NULL
        OR requested_outcome IS NULL
        OR requested_finalized_position IS NULL
        OR requested_finalized_block_id IS NULL
        OR requested_source_evidence_sha256 IS NULL
        OR requested_observed_at IS NULL
        OR requested_correlation_id IS NULL
        OR requested_expected_snapshot_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_expected_snapshot_sha256 = pg_catalog.repeat('0', 64)
        OR requested_source_evidence_sha256 !~ '^[0-9a-f]{64}$'
        OR requested_source_evidence_sha256 = pg_catalog.repeat('0', 64)
        OR requested_outcome NOT IN (
          'PENDING', 'UNKNOWN', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'
        )
        OR requested_finalized_position <> pg_catalog.trunc(requested_finalized_position)
        OR requested_finalized_position < 0
        OR requested_finalized_position > 18446744073709551615::numeric
        OR (requested_transaction_position IS NULL)
          <> (requested_transaction_block_id IS NULL)
        OR (requested_transaction_position IS NOT NULL AND (
          requested_transaction_position <> pg_catalog.trunc(requested_transaction_position)
          OR requested_transaction_position < 0
          OR requested_transaction_position > 18446744073709551615::numeric
        ))
        OR NOT pg_catalog.isfinite(requested_observed_at)
        OR pg_catalog.date_trunc('milliseconds', requested_observed_at) <> requested_observed_at
        OR requested_effect_evidence_sha256 IS NOT NULL AND (
          requested_effect_evidence_sha256 !~ '^[0-9a-f]{64}$'
          OR requested_effect_evidence_sha256 = pg_catalog.repeat('0', 64)
        )
        OR requested_failure_evidence_sha256 IS NOT NULL AND (
          requested_failure_evidence_sha256 !~ '^[0-9a-f]{64}$'
          OR requested_failure_evidence_sha256 = pg_catalog.repeat('0', 64)
        )
        OR requested_source_evidence_sha256 IN (
          requested_effect_evidence_sha256, requested_failure_evidence_sha256
        )
        OR NOT (
          (requested_outcome = 'UNKNOWN'
            AND requested_transaction_position IS NULL
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NULL)
          OR (requested_outcome = 'PENDING'
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NULL
            AND (requested_transaction_position IS NULL
              OR requested_finalized_position < requested_transaction_position))
          OR (requested_outcome = 'FINALIZED_SUCCESS'
            AND requested_transaction_position IS NOT NULL
            AND requested_finalized_position >= requested_transaction_position
            AND requested_effect_evidence_sha256 IS NOT NULL
            AND requested_failure_evidence_sha256 IS NULL)
          OR (requested_outcome = 'FINALIZED_FAILURE'
            AND requested_transaction_position IS NOT NULL
            AND requested_finalized_position >= requested_transaction_position
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NOT NULL)
          OR (requested_outcome = 'REORGED_OUT'
            AND requested_transaction_position IS NOT NULL
            AND requested_finalized_position >= requested_transaction_position
            AND requested_effect_evidence_sha256 IS NULL
            AND requested_failure_evidence_sha256 IS NULL)
        )
      THEN
        RAISE EXCEPTION 'invalid mainnet financial action reconciliation observation'
          USING ERRCODE = '22023';
      END IF;

      SELECT stored.* INTO STRICT intent
      FROM mainnet_financial_action_intents AS stored
      WHERE stored.intent_id = requested_intent_id
        AND stored.account_id = requested_account_id
      FOR UPDATE;
      IF NOT mainnet_action_chain_identity_valid(
        intent.network_id, requested_transaction_id, 'TRANSACTION'
      ) OR NOT mainnet_action_chain_identity_valid(
        intent.network_id, requested_finalized_block_id, 'BLOCK'
      ) OR (
        requested_transaction_block_id IS NOT NULL
        AND NOT mainnet_action_chain_identity_valid(
          intent.network_id, requested_transaction_block_id, 'BLOCK'
        )
      ) THEN
        RAISE EXCEPTION 'invalid canonical mainnet reconciliation identity'
          USING ERRCODE = '22023';
      END IF;
      transaction_identity_sha256 := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:TRANSACTION_ID:FRAMED:v1',
        ARRAY['fingerprintEncodingVersion', 'networkId', 'transactionId']::text[],
        ARRAY['1', intent.network_id, requested_transaction_id]::text[]
      );
      transaction_block_identity_sha256 := CASE
        WHEN requested_transaction_block_id IS NULL THEN NULL
        ELSE mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:BLOCK_ID:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'networkId', 'blockId']::text[],
          ARRAY['1', intent.network_id, requested_transaction_block_id]::text[]
        )
      END;
      finalized_block_identity_sha256 := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:BLOCK_ID:FRAMED:v1',
        ARRAY['fingerprintEncodingVersion', 'networkId', 'blockId']::text[],
        ARRAY['1', intent.network_id, requested_finalized_block_id]::text[]
      );
      SELECT stored.* INTO STRICT submission_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.intent_id = intent.intent_id
        AND stored.stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
      SELECT stored.* INTO broadcast_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.intent_id = intent.intent_id
        AND stored.stage = 'BROADCAST_OUTCOME_AMBIGUOUS';
      evidence_floor_at := COALESCE(
        broadcast_event.effective_at, submission_event.effective_at
      );
      IF submission_event.chain_transaction_id IS DISTINCT FROM requested_transaction_id
        OR submission_event.transaction_identity_sha256
          IS DISTINCT FROM transaction_identity_sha256
      THEN
        RAISE EXCEPTION 'mainnet financial action transaction identity conflict'
          USING ERRCODE = '23505';
      END IF;

      observation_fingerprint := mainnet_action_fingerprint_v1(
        'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_OBSERVATION:FRAMED:v1',
        ARRAY[
          'fingerprintEncodingVersion', 'observationId', 'intentId',
          'submissionFingerprintSha256', 'networkId', 'chainTransactionId',
          'transactionIdentitySha256', 'outcome', 'transactionPosition',
          'transactionBlockId', 'transactionBlockIdentitySha256', 'finalizedPosition',
          'finalizedBlockId', 'finalizedBlockIdentitySha256', 'effectEvidenceSha256',
          'failureEvidenceSha256', 'sourceEvidenceSha256',
          'observedAtEpochMilliseconds'
        ]::text[],
        ARRAY[
          '1', requested_observation_id::text, intent.intent_id::text,
          submission_event.submission_fingerprint_sha256, intent.network_id,
          requested_transaction_id, transaction_identity_sha256, requested_outcome,
          requested_transaction_position::text, requested_transaction_block_id,
          transaction_block_identity_sha256, requested_finalized_position::text,
          requested_finalized_block_id, finalized_block_identity_sha256,
          requested_effect_evidence_sha256, requested_failure_evidence_sha256,
          requested_source_evidence_sha256,
          ((extract(epoch FROM requested_observed_at) * 1000)::bigint)::text
        ]::text[]
      );
      SELECT stored.* INTO replay_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.observation_id = requested_observation_id;
      IF FOUND THEN
        IF replay_event.intent_id <> intent.intent_id
          OR replay_event.reconciliation_outcome IS NULL
          OR replay_event.transition_fingerprint_sha256 <> observation_fingerprint
          OR replay_event.chain_transaction_id IS DISTINCT FROM requested_transaction_id
        THEN
          RAISE EXCEPTION 'mainnet financial action observation ownership conflict'
            USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
          intent.account_id, intent.intent_id, 'REPLAYED'
        );
        RETURN;
      END IF;

      SELECT stored.* INTO STRICT current_event
      FROM mainnet_financial_action_events AS stored
      WHERE stored.intent_id = intent.intent_id
      ORDER BY stored.revision DESC LIMIT 1;
      database_recorded_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
      IF current_event.stage NOT IN (
          'WALLET_SIGNED_SUBMISSION_BOUND',
          'BROADCAST_OUTCOME_AMBIGUOUS', 'RECONCILIATION_AMBIGUOUS'
        )
        OR current_event.terminal
        OR current_event.revision <> requested_expected_revision
        OR current_event.snapshot_sha256 <> requested_expected_snapshot_sha256
        OR requested_observed_at < evidence_floor_at
        OR requested_observed_at > database_recorded_at
      THEN
        RAISE EXCEPTION 'mainnet financial action reconciliation compare-and-swap conflict'
          USING ERRCODE = '40001';
      END IF;
      next_stage := CASE requested_outcome
        WHEN 'FINALIZED_SUCCESS' THEN 'FINALIZED_SUCCESS'
        WHEN 'FINALIZED_FAILURE' THEN 'FINALIZED_FAILURE'
        WHEN 'REORGED_OUT' THEN 'REORG_QUARANTINED'
        ELSE 'RECONCILIATION_AMBIGUOUS'
      END;
      INSERT INTO mainnet_financial_action_events (
        intent_id, revision, fingerprint_encoding_version, stage,
        previous_snapshot_sha256, transition_fingerprint_sha256, snapshot_sha256,
        submission_fingerprint_sha256, network_id, chain_transaction_id,
        transaction_identity_sha256, observation_id, broadcast_outcome,
        reconciliation_outcome, transaction_position, transaction_block_id,
        transaction_block_identity_sha256, finalized_position, finalized_block_id,
        finalized_block_identity_sha256, wallet_signed_payload_sha256,
        wallet_signature_evidence_sha256, wallet_broadcast_evidence_sha256,
        source_evidence_sha256, effect_evidence_sha256, failure_evidence_sha256,
        effective_at, correlation_id, recorded_at, terminal,
        requires_manual_reconciliation, ledger_settlement_authority
      ) VALUES (
        intent.intent_id, current_event.revision + 1, 1, next_stage,
        current_event.snapshot_sha256, observation_fingerprint, observation_fingerprint,
        submission_event.submission_fingerprint_sha256, intent.network_id,
        requested_transaction_id, transaction_identity_sha256,
        requested_observation_id, NULL, requested_outcome,
        requested_transaction_position, requested_transaction_block_id,
        transaction_block_identity_sha256, requested_finalized_position,
        requested_finalized_block_id, finalized_block_identity_sha256,
        NULL, NULL, NULL, requested_source_evidence_sha256,
        requested_effect_evidence_sha256, requested_failure_evidence_sha256,
        requested_observed_at, requested_correlation_id, database_recorded_at,
        false, false, false
      ) RETURNING * INTO inserted_event;
      INSERT INTO mainnet_financial_action_evidence_claims (
        evidence_digest_sha256, evidence_role, transition_fingerprint_sha256,
        intent_id, event_revision, recorded_at
      )
      SELECT claim.digest, claim.role, observation_fingerprint,
        intent.intent_id, inserted_event.revision, inserted_event.recorded_at
      FROM (VALUES
        (requested_source_evidence_sha256, 'RECONCILIATION_SOURCE_EVIDENCE'::text),
        (requested_effect_evidence_sha256, 'RECONCILIATION_EFFECT_EVIDENCE'::text),
        (requested_failure_evidence_sha256, 'RECONCILIATION_FAILURE_EVIDENCE'::text)
      ) AS claim(digest, role)
      WHERE claim.digest IS NOT NULL
      ORDER BY claim.digest;
      RETURN QUERY SELECT * FROM mainnet_action_lifecycle_result(
        intent.account_id, intent.intent_id, 'RECORDED'
      );
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION 'mainnet financial action lifecycle is unavailable'
        USING ERRCODE = '55000';
    END;`;

function createTablesSql(): string {
  return `CREATE TABLE ${INTENT_TABLE} (
      intent_id uuid PRIMARY KEY,
      fingerprint_encoding_version smallint NOT NULL,
      volatile_intent_commitment_sha256 text NOT NULL,
      intent_record_fingerprint_sha256 text NOT NULL,
      account_id uuid NOT NULL,
      yield_operation_id uuid NOT NULL,
      yield_submission_id uuid NOT NULL,
      ledger_transaction_id uuid NOT NULL,
      ledger_book_id uuid NOT NULL,
      wallet_id uuid NOT NULL,
      wallet_chain_namespace text NOT NULL,
      wallet_chain_reference text NOT NULL,
      wallet_identity_digest_version smallint NOT NULL,
      wallet_identity_digest_hex text NOT NULL,
      network_id text NOT NULL,
      provider_id text NOT NULL,
      protocol_id text NOT NULL,
      market_id text NOT NULL,
      asset_registry_version integer NOT NULL,
      asset_registry_fingerprint_sha256 text NOT NULL,
      asset_symbol text NOT NULL,
      asset_identity text NOT NULL,
      asset_decimals smallint NOT NULL,
      action_type text NOT NULL,
      amount_atomic numeric(78,0) NOT NULL,
      requested_value_usd_micros numeric(78,0) NOT NULL,
      maximum_network_fee_atomic numeric(78,0) NOT NULL,
      maximum_network_fee_basis_points integer NOT NULL,
      minimum_post_action_native_balance_atomic numeric(78,0) NOT NULL,
      allowance_mode text NOT NULL,
      allowance_amount_atomic numeric(78,0) NOT NULL,
      idempotency_key_digest_sha256 text NOT NULL,
      replay_protection_id uuid NOT NULL,
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      signing_responsibility text NOT NULL,
      broadcast_responsibility text NOT NULL,
      may_authorize_financial_action boolean NOT NULL,
      api_may_sign boolean NOT NULL,
      api_may_broadcast boolean NOT NULL,
      cross_chain_execution_allowed boolean NOT NULL,
      automatic_resend_allowed boolean NOT NULL,
      automatic_fee_escalation_allowed boolean NOT NULL,
      volatile_intent_durable_replay_protection_verified boolean NOT NULL,
      database_replay_protection_enforced boolean NOT NULL,
      ledger_settlement_authority boolean NOT NULL,
      correlation_id uuid NOT NULL,
      prepared_at timestamptz NOT NULL,
      CONSTRAINT mainnet_action_intent_uuid_check CHECK (
        substring(intent_id::text FROM 15 FOR 1) = '4'
        AND substring(intent_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(replay_protection_id::text FROM 15 FOR 1) = '4'
        AND substring(replay_protection_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(correlation_id::text FROM 15 FOR 1) = '4'
        AND substring(correlation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT mainnet_action_intent_digest_check CHECK (
        fingerprint_encoding_version = 1
        AND volatile_intent_commitment_sha256 ~ '^[0-9a-f]{64}$'
        AND volatile_intent_commitment_sha256 <> repeat('0', 64)
        AND intent_record_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND intent_record_fingerprint_sha256 <> repeat('0', 64)
        AND wallet_identity_digest_version > 0
        AND wallet_identity_digest_hex ~ '^[0-9a-f]{64}$'
        AND wallet_identity_digest_hex <> repeat('0', 64)
        AND idempotency_key_digest_sha256 ~ '^[0-9a-f]{64}$'
        AND idempotency_key_digest_sha256 <> repeat('0', 64)
        AND asset_registry_fingerprint_sha256 = '${MAINNET_ASSET_REGISTRY_FINGERPRINT}'
      ),
      CONSTRAINT mainnet_action_intent_normalized_shape_check CHECK (
        network_id IN ('${ETHEREUM_MAINNET}', '${SOLANA_MAINNET}')
        AND asset_registry_version = 1 AND asset_decimals = 6
        AND action_type IN ('SUPPLY', 'WITHDRAW')
        AND amount_atomic > 0 AND amount_atomic <= ${UINT256_MAX}::numeric
        AND requested_value_usd_micros > 0
        AND requested_value_usd_micros <= ${UINT256_MAX}::numeric
        AND maximum_network_fee_atomic >= 0
        AND maximum_network_fee_atomic <= ${UINT256_MAX}::numeric
        AND maximum_network_fee_basis_points BETWEEN 0 AND 10000
        AND minimum_post_action_native_balance_atomic > 0
        AND minimum_post_action_native_balance_atomic <= ${UINT256_MAX}::numeric
        AND allowance_mode = 'EXACT'
        AND allowance_amount_atomic >= 0
        AND allowance_amount_atomic <= ${UINT256_MAX}::numeric
        AND allowance_amount_atomic = CASE
          WHEN action_type = 'SUPPLY' THEN amount_atomic ELSE 0
        END
        AND signing_responsibility = 'USER_WALLET_ONLY'
        AND broadcast_responsibility = 'USER_WALLET_ONLY'
        AND NOT may_authorize_financial_action
        AND NOT api_may_sign AND NOT api_may_broadcast
        AND NOT cross_chain_execution_allowed
        AND NOT automatic_resend_allowed AND NOT automatic_fee_escalation_allowed
        AND NOT volatile_intent_durable_replay_protection_verified
        AND database_replay_protection_enforced
        AND NOT ledger_settlement_authority
      ),
      CONSTRAINT mainnet_action_intent_time_check CHECK (
        isfinite(issued_at) AND isfinite(expires_at) AND isfinite(prepared_at)
        AND date_trunc('milliseconds', issued_at) = issued_at
        AND date_trunc('milliseconds', expires_at) = expires_at
        AND date_trunc('milliseconds', prepared_at) = prepared_at
        AND issued_at <= prepared_at AND prepared_at < expires_at
        AND expires_at > issued_at AND expires_at - issued_at <= interval '5 minutes'
      ),
      CONSTRAINT mainnet_action_intent_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_intent_yield_scope_fk FOREIGN KEY (
        yield_operation_id, account_id, ledger_transaction_id, ledger_book_id
      ) REFERENCES yield_operations (
        operation_id, actor_account_id, ledger_transaction_id, ledger_book_id
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_intent_yield_submission_fk FOREIGN KEY (yield_submission_id)
        REFERENCES yield_operation_submissions (submission_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_intent_ledger_scope_fk FOREIGN KEY (
        ledger_transaction_id, ledger_book_id, account_id
      ) REFERENCES ledger_transactions (transaction_id, book_id, tenant_account_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_intent_wallet_scope_fk FOREIGN KEY (
        wallet_id, account_id, wallet_chain_namespace, wallet_chain_reference
      ) REFERENCES registered_wallets (
        wallet_id, account_id, chain_namespace, chain_reference
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_intent_fingerprint_unique
        UNIQUE (intent_record_fingerprint_sha256),
      CONSTRAINT mainnet_action_intent_yield_operation_unique UNIQUE (yield_operation_id),
      CONSTRAINT mainnet_action_intent_yield_submission_unique UNIQUE (yield_submission_id),
      CONSTRAINT mainnet_action_intent_idempotency_unique
        UNIQUE (account_id, fingerprint_encoding_version, idempotency_key_digest_sha256),
      CONSTRAINT mainnet_action_intent_replay_unique
        UNIQUE (account_id, fingerprint_encoding_version, replay_protection_id)
    );

    CREATE TABLE ${EVENT_TABLE} (
      event_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
      intent_id uuid NOT NULL,
      revision bigint NOT NULL,
      fingerprint_encoding_version smallint NOT NULL,
      stage text NOT NULL,
      previous_snapshot_sha256 text,
      transition_fingerprint_sha256 text NOT NULL,
      snapshot_sha256 text NOT NULL,
      submission_fingerprint_sha256 text,
      network_id text NOT NULL,
      chain_transaction_id text,
      transaction_identity_sha256 text,
      observation_id uuid,
      broadcast_outcome text,
      reconciliation_outcome text,
      transaction_position numeric(20,0),
      transaction_block_id text,
      transaction_block_identity_sha256 text,
      finalized_position numeric(20,0),
      finalized_block_id text,
      finalized_block_identity_sha256 text,
      wallet_signed_payload_sha256 text,
      wallet_signature_evidence_sha256 text,
      wallet_broadcast_evidence_sha256 text,
      source_evidence_sha256 text,
      effect_evidence_sha256 text,
      failure_evidence_sha256 text,
      effective_at timestamptz NOT NULL,
      correlation_id uuid NOT NULL,
      recorded_at timestamptz NOT NULL,
      terminal boolean NOT NULL,
      requires_manual_reconciliation boolean NOT NULL,
      ledger_settlement_authority boolean NOT NULL,
      CONSTRAINT mainnet_action_event_pkey PRIMARY KEY (intent_id, revision),
      CONSTRAINT mainnet_action_event_id_unique UNIQUE (event_id),
      CONSTRAINT mainnet_action_event_snapshot_unique UNIQUE (intent_id, snapshot_sha256),
      CONSTRAINT mainnet_action_event_transition_unique
        UNIQUE (intent_id, revision, transition_fingerprint_sha256),
      CONSTRAINT mainnet_action_event_intent_fk FOREIGN KEY (intent_id)
        REFERENCES ${INTENT_TABLE} (intent_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_event_uuid_check CHECK (
        substring(event_id::text FROM 15 FOR 1) = '4'
        AND substring(event_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND substring(correlation_id::text FROM 15 FOR 1) = '4'
        AND substring(correlation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        AND (observation_id IS NULL OR (
          substring(observation_id::text FROM 15 FOR 1) = '4'
          AND substring(observation_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
        ))
      ),
      CONSTRAINT mainnet_action_event_digest_check CHECK (
        fingerprint_encoding_version = 1
        AND transition_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND transition_fingerprint_sha256 <> repeat('0', 64)
        AND snapshot_sha256 ~ '^[0-9a-f]{64}$'
        AND snapshot_sha256 <> repeat('0', 64)
        AND (previous_snapshot_sha256 IS NULL OR (
          previous_snapshot_sha256 ~ '^[0-9a-f]{64}$'
          AND previous_snapshot_sha256 <> repeat('0', 64)
        ))
        AND (submission_fingerprint_sha256 IS NULL OR (
          submission_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
          AND submission_fingerprint_sha256 <> repeat('0', 64)
        ))
        AND (transaction_identity_sha256 IS NULL OR (
          transaction_identity_sha256 ~ '^[0-9a-f]{64}$'
          AND transaction_identity_sha256 <> repeat('0', 64)
        ))
        AND (transaction_block_identity_sha256 IS NULL OR (
          transaction_block_identity_sha256 ~ '^[0-9a-f]{64}$'
          AND transaction_block_identity_sha256 <> repeat('0', 64)
        ))
        AND (finalized_block_identity_sha256 IS NULL OR (
          finalized_block_identity_sha256 ~ '^[0-9a-f]{64}$'
          AND finalized_block_identity_sha256 <> repeat('0', 64)
        ))
        AND (wallet_signed_payload_sha256 IS NULL
          OR wallet_signed_payload_sha256 ~ '^[0-9a-f]{64}$')
        AND (wallet_signature_evidence_sha256 IS NULL
          OR wallet_signature_evidence_sha256 ~ '^[0-9a-f]{64}$')
        AND (wallet_broadcast_evidence_sha256 IS NULL
          OR wallet_broadcast_evidence_sha256 ~ '^[0-9a-f]{64}$')
        AND (source_evidence_sha256 IS NULL
          OR source_evidence_sha256 ~ '^[0-9a-f]{64}$')
        AND (effect_evidence_sha256 IS NULL
          OR effect_evidence_sha256 ~ '^[0-9a-f]{64}$')
        AND (failure_evidence_sha256 IS NULL
          OR failure_evidence_sha256 ~ '^[0-9a-f]{64}$')
      ),
      CONSTRAINT mainnet_action_event_sequence_check CHECK (
        revision > 0
        AND (previous_snapshot_sha256 IS NULL) = (revision = 1)
      ),
      CONSTRAINT mainnet_action_event_time_check CHECK (
        isfinite(effective_at) AND isfinite(recorded_at)
        AND date_trunc('milliseconds', effective_at) = effective_at
        AND date_trunc('milliseconds', recorded_at) = recorded_at
        AND effective_at <= recorded_at
      ),
      CONSTRAINT mainnet_action_event_position_check CHECK (
        (transaction_position IS NULL OR transaction_position BETWEEN 0 AND 18446744073709551615)
        AND (finalized_position IS NULL OR finalized_position BETWEEN 0 AND 18446744073709551615)
      ),
      CONSTRAINT mainnet_action_event_authority_check CHECK (
        NOT ledger_settlement_authority
        AND terminal = (stage IN ('FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORG_QUARANTINED'))
        AND requires_manual_reconciliation = (stage = 'REORG_QUARANTINED')
      ),
      CONSTRAINT mainnet_action_event_shape_check CHECK (
        (stage = 'PREPARED'
          AND submission_fingerprint_sha256 IS NULL
          AND chain_transaction_id IS NULL AND transaction_identity_sha256 IS NULL
          AND observation_id IS NULL AND broadcast_outcome IS NULL
          AND reconciliation_outcome IS NULL AND transaction_position IS NULL
          AND transaction_block_id IS NULL AND transaction_block_identity_sha256 IS NULL
          AND finalized_position IS NULL AND finalized_block_id IS NULL
          AND finalized_block_identity_sha256 IS NULL
          AND wallet_signed_payload_sha256 IS NULL
          AND wallet_signature_evidence_sha256 IS NULL
          AND wallet_broadcast_evidence_sha256 IS NULL
          AND source_evidence_sha256 IS NULL AND effect_evidence_sha256 IS NULL
          AND failure_evidence_sha256 IS NULL)
        OR (stage = 'WALLET_SIGNED_SUBMISSION_BOUND'
          AND submission_fingerprint_sha256 IS NOT NULL
          AND chain_transaction_id IS NOT NULL AND transaction_identity_sha256 IS NOT NULL
          AND observation_id IS NULL AND broadcast_outcome IS NULL
          AND reconciliation_outcome IS NULL AND transaction_position IS NULL
          AND transaction_block_id IS NULL AND transaction_block_identity_sha256 IS NULL
          AND finalized_position IS NULL AND finalized_block_id IS NULL
          AND finalized_block_identity_sha256 IS NULL
          AND wallet_signed_payload_sha256 IS NOT NULL
          AND wallet_signature_evidence_sha256 IS NOT NULL
          AND wallet_signed_payload_sha256 <> wallet_signature_evidence_sha256
          AND wallet_broadcast_evidence_sha256 IS NULL
          AND source_evidence_sha256 IS NULL AND effect_evidence_sha256 IS NULL
          AND failure_evidence_sha256 IS NULL)
        OR (stage = 'BROADCAST_OUTCOME_AMBIGUOUS'
          AND submission_fingerprint_sha256 IS NOT NULL
          AND chain_transaction_id IS NOT NULL AND transaction_identity_sha256 IS NOT NULL
          AND observation_id IS NOT NULL
          AND broadcast_outcome IN (
            'WALLET_REPORTED_SUBMITTED', 'WALLET_REPORTED_AMBIGUOUS',
            'WALLET_REPORTED_REJECTED'
          )
          AND reconciliation_outcome IS NULL AND transaction_position IS NULL
          AND transaction_block_id IS NULL AND transaction_block_identity_sha256 IS NULL
          AND finalized_position IS NULL AND finalized_block_id IS NULL
          AND finalized_block_identity_sha256 IS NULL
          AND wallet_signed_payload_sha256 IS NULL
          AND wallet_signature_evidence_sha256 IS NULL
          AND wallet_broadcast_evidence_sha256 IS NOT NULL
          AND source_evidence_sha256 IS NULL AND effect_evidence_sha256 IS NULL
          AND failure_evidence_sha256 IS NULL)
        OR (stage IN (
            'RECONCILIATION_AMBIGUOUS', 'FINALIZED_SUCCESS',
            'FINALIZED_FAILURE', 'REORG_QUARANTINED'
          )
          AND submission_fingerprint_sha256 IS NOT NULL
          AND chain_transaction_id IS NOT NULL AND transaction_identity_sha256 IS NOT NULL
          AND observation_id IS NOT NULL AND broadcast_outcome IS NULL
          AND reconciliation_outcome IN (
            'PENDING', 'UNKNOWN', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'
          )
          AND (transaction_position IS NULL) = (transaction_block_id IS NULL)
          AND (transaction_position IS NULL)
            = (transaction_block_identity_sha256 IS NULL)
          AND finalized_position IS NOT NULL AND finalized_block_id IS NOT NULL
          AND finalized_block_identity_sha256 IS NOT NULL
          AND wallet_signed_payload_sha256 IS NULL
          AND wallet_signature_evidence_sha256 IS NULL
          AND wallet_broadcast_evidence_sha256 IS NULL
          AND source_evidence_sha256 IS NOT NULL
          AND (
            (reconciliation_outcome = 'UNKNOWN'
              AND stage = 'RECONCILIATION_AMBIGUOUS'
              AND transaction_position IS NULL
              AND effect_evidence_sha256 IS NULL AND failure_evidence_sha256 IS NULL)
            OR (reconciliation_outcome = 'PENDING'
              AND stage = 'RECONCILIATION_AMBIGUOUS'
              AND effect_evidence_sha256 IS NULL AND failure_evidence_sha256 IS NULL
              AND (transaction_position IS NULL OR finalized_position < transaction_position))
            OR (reconciliation_outcome = 'FINALIZED_SUCCESS'
              AND stage = 'FINALIZED_SUCCESS' AND transaction_position IS NOT NULL
              AND finalized_position >= transaction_position
              AND effect_evidence_sha256 IS NOT NULL AND failure_evidence_sha256 IS NULL)
            OR (reconciliation_outcome = 'FINALIZED_FAILURE'
              AND stage = 'FINALIZED_FAILURE' AND transaction_position IS NOT NULL
              AND finalized_position >= transaction_position
              AND effect_evidence_sha256 IS NULL AND failure_evidence_sha256 IS NOT NULL)
            OR (reconciliation_outcome = 'REORGED_OUT'
              AND stage = 'REORG_QUARANTINED' AND transaction_position IS NOT NULL
              AND finalized_position >= transaction_position
              AND effect_evidence_sha256 IS NULL AND failure_evidence_sha256 IS NULL)
          ))
      )
    );

    CREATE UNIQUE INDEX mainnet_action_event_signed_once
      ON ${EVENT_TABLE} (intent_id) WHERE stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
    CREATE UNIQUE INDEX mainnet_action_event_broadcast_once
      ON ${EVENT_TABLE} (intent_id) WHERE stage = 'BROADCAST_OUTCOME_AMBIGUOUS';
    CREATE UNIQUE INDEX mainnet_action_event_transaction_owner
      ON ${EVENT_TABLE} (network_id, chain_transaction_id)
      WHERE stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
    CREATE UNIQUE INDEX mainnet_action_event_transaction_fingerprint_owner
      ON ${EVENT_TABLE} (network_id, transaction_identity_sha256)
      WHERE stage = 'WALLET_SIGNED_SUBMISSION_BOUND';
    CREATE UNIQUE INDEX mainnet_action_event_observation_owner
      ON ${EVENT_TABLE} (observation_id) WHERE observation_id IS NOT NULL;
    CREATE INDEX mainnet_action_event_reconciliation_timeline
      ON ${EVENT_TABLE} (intent_id, revision DESC)
      WHERE reconciliation_outcome IS NOT NULL;

    CREATE TABLE ${EVIDENCE_TABLE} (
      evidence_digest_sha256 text PRIMARY KEY,
      evidence_role text NOT NULL,
      transition_fingerprint_sha256 text NOT NULL,
      intent_id uuid NOT NULL,
      event_revision bigint NOT NULL,
      recorded_at timestamptz NOT NULL,
      CONSTRAINT mainnet_action_evidence_digest_check CHECK (
        evidence_digest_sha256 ~ '^[0-9a-f]{64}$'
        AND evidence_digest_sha256 <> repeat('0', 64)
        AND transition_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
        AND transition_fingerprint_sha256 <> repeat('0', 64)
      ),
      CONSTRAINT mainnet_action_evidence_role_check CHECK (
        evidence_role IN (
          'WALLET_SIGNED_PAYLOAD', 'WALLET_SIGNATURE_EVIDENCE',
          'WALLET_BROADCAST_EVIDENCE', 'RECONCILIATION_SOURCE_EVIDENCE',
          'RECONCILIATION_EFFECT_EVIDENCE', 'RECONCILIATION_FAILURE_EVIDENCE'
        )
      ),
      CONSTRAINT mainnet_action_evidence_time_check CHECK (
        isfinite(recorded_at) AND date_trunc('milliseconds', recorded_at) = recorded_at
      ),
      CONSTRAINT mainnet_action_evidence_event_fk FOREIGN KEY (
        intent_id, event_revision, transition_fingerprint_sha256
      ) REFERENCES ${EVENT_TABLE} (
        intent_id, revision, transition_fingerprint_sha256
      ) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT mainnet_action_evidence_event_role_unique
        UNIQUE (intent_id, event_revision, evidence_role)
    );`;
}

function createUpSql(names: BalanceConsumerPrincipalNames): string {
  const api = identifier(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = identifier(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = identifier(names.migrationRole, 'migrationRole');
  const guardedRoles = `PUBLIC, ${api}, ${worker}, ${legacy}, ${balance}, ${migration}`;

  return `CREATE FUNCTION mainnet_action_fingerprint_bytes_v1(
      requested_domain text, requested_field_names text[], requested_field_values text[]
    ) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${FINGERPRINT_BYTES_BODY}$function$;

    CREATE FUNCTION mainnet_action_fingerprint_v1(
      requested_domain text, requested_field_names text[], requested_field_values text[]
    ) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $function$${FINGERPRINT_BODY}$function$;

    CREATE FUNCTION mainnet_action_chain_identity_valid(
      requested_network_id text, requested_identity text, requested_kind text
    ) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO pg_catalog
    AS $function$${CHAIN_IDENTITY_VALID_BODY}$function$;

    ${createTablesSql()}
    COMMENT ON TABLE ${INTENT_TABLE} IS '${INTENT_MANIFEST}';
    COMMENT ON TABLE ${EVENT_TABLE} IS '${EVENT_MANIFEST}';
    COMMENT ON TABLE ${EVIDENCE_TABLE} IS '${EVIDENCE_MANIFEST}';

    CREATE FUNCTION reject_mainnet_action_history_mutation()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${REJECT_HISTORY_BODY}$function$;
    CREATE FUNCTION enforce_mainnet_action_intent_linkage()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${ENFORCE_INTENT_BODY}$function$;
    CREATE FUNCTION enforce_mainnet_action_event_transition()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${ENFORCE_EVENT_BODY}$function$;
    CREATE FUNCTION validate_mainnet_action_intent_completion()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${VALIDATE_INTENT_COMPLETION_BODY}$function$;
    CREATE FUNCTION validate_mainnet_action_event_evidence()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
      AS $function$${VALIDATE_EVENT_EVIDENCE_BODY}$function$;

    CREATE TRIGGER mainnet_action_intent_linkage_before_insert
      BEFORE INSERT ON ${INTENT_TABLE}
      FOR EACH ROW EXECUTE FUNCTION enforce_mainnet_action_intent_linkage();
    CREATE CONSTRAINT TRIGGER mainnet_action_intent_completion_after_insert
      AFTER INSERT ON ${INTENT_TABLE} DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_mainnet_action_intent_completion();
    CREATE TRIGGER mainnet_action_event_transition_before_insert
      BEFORE INSERT ON ${EVENT_TABLE}
      FOR EACH ROW EXECUTE FUNCTION enforce_mainnet_action_event_transition();
    CREATE CONSTRAINT TRIGGER mainnet_action_event_evidence_after_insert
      AFTER INSERT ON ${EVENT_TABLE} DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_mainnet_action_event_evidence();
    ${[INTENT_TABLE, EVENT_TABLE, EVIDENCE_TABLE]
      .flatMap((table) => [
        `CREATE TRIGGER ${table}_append_only_row BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_mainnet_action_history_mutation();`,
        `CREATE TRIGGER ${table}_append_only_truncate BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_mainnet_action_history_mutation();`,
      ])
      .join('\n    ')}
    ${[INTENT_TABLE, EVENT_TABLE, EVIDENCE_TABLE]
      .flatMap((table) => [
        `ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${table}_append_only_row;`,
        `ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${table}_append_only_truncate;`,
      ])
      .join('\n    ')}
    ALTER TABLE ${INTENT_TABLE} ENABLE ALWAYS TRIGGER mainnet_action_intent_linkage_before_insert;
    ALTER TABLE ${INTENT_TABLE} ENABLE ALWAYS TRIGGER mainnet_action_intent_completion_after_insert;
    ALTER TABLE ${EVENT_TABLE} ENABLE ALWAYS TRIGGER mainnet_action_event_transition_before_insert;
    ALTER TABLE ${EVENT_TABLE} ENABLE ALWAYS TRIGGER mainnet_action_event_evidence_after_insert;

    CREATE FUNCTION mainnet_action_lifecycle_result(
      requested_account_id uuid, requested_intent_id uuid, requested_outcome text
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER STABLE STRICT PARALLEL UNSAFE
    AS $function$${LIFECYCLE_RESULT_BODY}$function$;
    CREATE FUNCTION read_mainnet_financial_action_lifecycle(
      requested_account_id uuid, requested_intent_id uuid
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER STABLE STRICT PARALLEL UNSAFE
    AS $function$${READ_LIFECYCLE_BODY}$function$;
    CREATE FUNCTION prepare_mainnet_financial_action_lifecycle(
      requested_intent_id uuid, requested_account_id uuid,
      requested_yield_operation_id uuid, requested_yield_submission_id uuid,
      requested_ledger_transaction_id uuid, requested_ledger_book_id uuid,
      requested_wallet_id uuid, requested_volatile_intent_commitment_sha256 text,
      requested_idempotency_key_digest_sha256 text, requested_replay_protection_id uuid,
      requested_network_id text, requested_provider_id text, requested_protocol_id text,
      requested_market_id text, requested_asset_registry_version integer,
      requested_asset_registry_fingerprint_sha256 text, requested_asset_symbol text,
      requested_asset_identity text, requested_asset_decimals smallint,
      requested_action_type text, requested_amount_atomic text,
      requested_requested_value_usd_micros text, requested_maximum_network_fee_atomic text,
      requested_maximum_network_fee_basis_points integer,
      requested_minimum_post_action_native_balance_atomic text,
      requested_allowance_mode text, requested_allowance_amount_atomic text,
      requested_issued_at timestamptz, requested_expires_at timestamptz,
      requested_correlation_id uuid
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${PREPARE_INTENT_BODY}$function$;
    CREATE FUNCTION bind_mainnet_financial_action_submission(
      requested_account_id uuid, requested_intent_id uuid, requested_expected_revision bigint,
      requested_expected_snapshot_sha256 text, requested_transaction_id text,
      requested_wallet_signed_payload_sha256 text,
      requested_wallet_signature_evidence_sha256 text, requested_signed_at timestamptz,
      requested_correlation_id uuid
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${BIND_SUBMISSION_BODY}$function$;
    CREATE FUNCTION record_mainnet_financial_action_broadcast_observation(
      requested_account_id uuid, requested_intent_id uuid, requested_expected_revision bigint,
      requested_expected_snapshot_sha256 text, requested_observation_id uuid,
      requested_transaction_id text, requested_outcome text, requested_evidence_sha256 text,
      requested_observed_at timestamptz, requested_correlation_id uuid
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE
    AS $function$${RECORD_BROADCAST_BODY}$function$;
    CREATE FUNCTION record_mainnet_financial_action_reconciliation_observation(
      requested_account_id uuid, requested_intent_id uuid, requested_expected_revision bigint,
      requested_expected_snapshot_sha256 text, requested_observation_id uuid,
      requested_transaction_id text, requested_outcome text,
      requested_transaction_position numeric, requested_transaction_block_id text,
      requested_finalized_position numeric, requested_finalized_block_id text,
      requested_effect_evidence_sha256 text, requested_failure_evidence_sha256 text,
      requested_source_evidence_sha256 text, requested_observed_at timestamptz,
      requested_correlation_id uuid
    ) RETURNS TABLE (${resultColumns()})
    LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
    AS $function$${RECORD_RECONCILIATION_BODY}$function$;

    DO $set_mainnet_action_function_paths$
    DECLARE migration_schema text := pg_catalog.current_schema();
    BEGIN
      ${[
        FINGERPRINT,
        REJECT_HISTORY,
        ENFORCE_INTENT,
        ENFORCE_EVENT,
        VALIDATE_INTENT_COMPLETION,
        VALIDATE_EVENT_EVIDENCE,
        LIFECYCLE_RESULT,
        READ_LIFECYCLE,
        PREPARE_INTENT,
        BIND_SUBMISSION,
        RECORD_BROADCAST,
        RECORD_RECONCILIATION,
      ]
        .map(
          (functionIdentity) => `EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.${functionIdentity} SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema, migration_schema
      );`,
        )
        .join('\n      ')}
    END;
    $set_mainnet_action_function_paths$;

    ${[INTENT_TABLE, EVENT_TABLE, EVIDENCE_TABLE]
      .flatMap((table) => [
        `REVOKE ALL PRIVILEGES ON TABLE ${table} FROM ${guardedRoles};`,
        `REVOKE ALL PRIVILEGES ON TYPE ${table} FROM ${guardedRoles};`,
      ])
      .join('\n    ')}
    ${ALL_FUNCTIONS.map(
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

  return `LOCK TABLE ${INTENT_TABLE}, ${EVENT_TABLE}, ${EVIDENCE_TABLE}
      IN ACCESS EXCLUSIVE MODE;
    DO $refuse_mainnet_action_history_loss$
    BEGIN
      IF EXISTS (SELECT 1 FROM ${INTENT_TABLE})
        OR EXISTS (SELECT 1 FROM ${EVENT_TABLE})
        OR EXISTS (SELECT 1 FROM ${EVIDENCE_TABLE})
      THEN
        RAISE EXCEPTION 'cannot roll back mainnet financial action lifecycle after use'
          USING ERRCODE = '55000';
      END IF;
    END;
    $refuse_mainnet_action_history_loss$;

    ${ALL_FUNCTIONS.map(
      (functionIdentity) => `REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guardedRoles};`,
    ).join('\n    ')}
    DROP FUNCTION ${RECORD_RECONCILIATION};
    DROP FUNCTION ${RECORD_BROADCAST};
    DROP FUNCTION ${BIND_SUBMISSION};
    DROP FUNCTION ${PREPARE_INTENT};
    DROP FUNCTION ${READ_LIFECYCLE};
    DROP FUNCTION ${LIFECYCLE_RESULT};
    ${[EVIDENCE_TABLE, EVENT_TABLE, INTENT_TABLE]
      .flatMap((table) => [
        `REVOKE ALL PRIVILEGES ON TABLE ${table} FROM ${guardedRoles};`,
        `REVOKE ALL PRIVILEGES ON TYPE ${table} FROM ${guardedRoles};`,
      ])
      .join('\n    ')}
    DROP TABLE ${EVIDENCE_TABLE};
    DROP TABLE ${EVENT_TABLE};
    DROP TABLE ${INTENT_TABLE};
    DROP FUNCTION ${VALIDATE_EVENT_EVIDENCE};
    DROP FUNCTION ${VALIDATE_INTENT_COMPLETION};
    DROP FUNCTION ${ENFORCE_EVENT};
    DROP FUNCTION ${ENFORCE_INTENT};
    DROP FUNCTION ${REJECT_HISTORY};
    DROP FUNCTION ${CHAIN_IDENTITY_VALID};
    DROP FUNCTION ${FINGERPRINT};
    DROP FUNCTION ${FINGERPRINT_BYTES};`;
}

type ExpectedColumn = readonly [name: string, type: string, notNull: boolean, hasDefault?: boolean];

const EXPECTED_COLUMNS = Object.freeze({
  [INTENT_TABLE]: Object.freeze([
    ['intent_id', 'uuid', true],
    ['fingerprint_encoding_version', 'smallint', true],
    ['volatile_intent_commitment_sha256', 'text', true],
    ['intent_record_fingerprint_sha256', 'text', true],
    ['account_id', 'uuid', true],
    ['yield_operation_id', 'uuid', true],
    ['yield_submission_id', 'uuid', true],
    ['ledger_transaction_id', 'uuid', true],
    ['ledger_book_id', 'uuid', true],
    ['wallet_id', 'uuid', true],
    ['wallet_chain_namespace', 'text', true],
    ['wallet_chain_reference', 'text', true],
    ['wallet_identity_digest_version', 'smallint', true],
    ['wallet_identity_digest_hex', 'text', true],
    ['network_id', 'text', true],
    ['provider_id', 'text', true],
    ['protocol_id', 'text', true],
    ['market_id', 'text', true],
    ['asset_registry_version', 'integer', true],
    ['asset_registry_fingerprint_sha256', 'text', true],
    ['asset_symbol', 'text', true],
    ['asset_identity', 'text', true],
    ['asset_decimals', 'smallint', true],
    ['action_type', 'text', true],
    ['amount_atomic', 'numeric(78,0)', true],
    ['requested_value_usd_micros', 'numeric(78,0)', true],
    ['maximum_network_fee_atomic', 'numeric(78,0)', true],
    ['maximum_network_fee_basis_points', 'integer', true],
    ['minimum_post_action_native_balance_atomic', 'numeric(78,0)', true],
    ['allowance_mode', 'text', true],
    ['allowance_amount_atomic', 'numeric(78,0)', true],
    ['idempotency_key_digest_sha256', 'text', true],
    ['replay_protection_id', 'uuid', true],
    ['issued_at', 'timestamp with time zone', true],
    ['expires_at', 'timestamp with time zone', true],
    ['signing_responsibility', 'text', true],
    ['broadcast_responsibility', 'text', true],
    ['may_authorize_financial_action', 'boolean', true],
    ['api_may_sign', 'boolean', true],
    ['api_may_broadcast', 'boolean', true],
    ['cross_chain_execution_allowed', 'boolean', true],
    ['automatic_resend_allowed', 'boolean', true],
    ['automatic_fee_escalation_allowed', 'boolean', true],
    ['volatile_intent_durable_replay_protection_verified', 'boolean', true],
    ['database_replay_protection_enforced', 'boolean', true],
    ['ledger_settlement_authority', 'boolean', true],
    ['correlation_id', 'uuid', true],
    ['prepared_at', 'timestamp with time zone', true],
  ] as const),
  [EVENT_TABLE]: Object.freeze([
    ['event_id', 'uuid', true, true],
    ['intent_id', 'uuid', true],
    ['revision', 'bigint', true],
    ['fingerprint_encoding_version', 'smallint', true],
    ['stage', 'text', true],
    ['previous_snapshot_sha256', 'text', false],
    ['transition_fingerprint_sha256', 'text', true],
    ['snapshot_sha256', 'text', true],
    ['submission_fingerprint_sha256', 'text', false],
    ['network_id', 'text', true],
    ['chain_transaction_id', 'text', false],
    ['transaction_identity_sha256', 'text', false],
    ['observation_id', 'uuid', false],
    ['broadcast_outcome', 'text', false],
    ['reconciliation_outcome', 'text', false],
    ['transaction_position', 'numeric(20,0)', false],
    ['transaction_block_id', 'text', false],
    ['transaction_block_identity_sha256', 'text', false],
    ['finalized_position', 'numeric(20,0)', false],
    ['finalized_block_id', 'text', false],
    ['finalized_block_identity_sha256', 'text', false],
    ['wallet_signed_payload_sha256', 'text', false],
    ['wallet_signature_evidence_sha256', 'text', false],
    ['wallet_broadcast_evidence_sha256', 'text', false],
    ['source_evidence_sha256', 'text', false],
    ['effect_evidence_sha256', 'text', false],
    ['failure_evidence_sha256', 'text', false],
    ['effective_at', 'timestamp with time zone', true],
    ['correlation_id', 'uuid', true],
    ['recorded_at', 'timestamp with time zone', true],
    ['terminal', 'boolean', true],
    ['requires_manual_reconciliation', 'boolean', true],
    ['ledger_settlement_authority', 'boolean', true],
  ] as const),
  [EVIDENCE_TABLE]: Object.freeze([
    ['evidence_digest_sha256', 'text', true],
    ['evidence_role', 'text', true],
    ['transition_fingerprint_sha256', 'text', true],
    ['intent_id', 'uuid', true],
    ['event_revision', 'bigint', true],
    ['recorded_at', 'timestamp with time zone', true],
  ] as const),
} as const) satisfies Readonly<Record<string, readonly ExpectedColumn[]>>;

type ExpectedConstraint = readonly [
  name: string,
  type: 'p' | 'u' | 'f' | 'c' | 't',
  keys: readonly number[] | null,
  referencedTable: string | null,
  referencedKeys: readonly number[] | null,
  backingIndex: string | null,
  definitionSha256: string,
];

// The definition digests are PostgreSQL-16 pg_get_constraintdef output with
// whitespace removed. Together with the catalog fields below, these pin the
// complete constraint expressions rather than merely accepting familiar names.
const EXPECTED_CONSTRAINTS = Object.freeze({
  [INTENT_TABLE]: Object.freeze([
    [
      `${INTENT_TABLE}_pkey`,
      'p',
      [1],
      null,
      null,
      `${INTENT_TABLE}_pkey`,
      'a8e775d60a9211cd6b5b5a3ef860ab0decdd6a6f6d743d71f82095702849d177',
    ],
    [
      'mainnet_action_intent_uuid_check',
      'c',
      [1, 33, 47],
      null,
      null,
      null,
      '7b47d829ead2f665337b9893e9b7a90328ed13adb0d2d332970205f2b1aac90c',
    ],
    [
      'mainnet_action_intent_digest_check',
      'c',
      [2, 3, 4, 13, 14, 32, 20],
      null,
      null,
      null,
      'ba62d294863d91ebddf7a8ba025b8aa62702826eaa2fcd1aeb9447928c4efd0c',
    ],
    [
      'mainnet_action_intent_normalized_shape_check',
      'c',
      [15, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46],
      null,
      null,
      null,
      '8a97bca9c11abe88e14c32cb7be154f2c5536df4187d5aed45da502419470ec0',
    ],
    [
      'mainnet_action_intent_time_check',
      'c',
      [34, 35, 48],
      null,
      null,
      null,
      '8f0fcd54a87507f82f690a6cf6d46216f3d8b8828ce5a68c6435b0ec160551ce',
    ],
    [
      'mainnet_action_intent_account_fk',
      'f',
      [5],
      'accounts',
      [1],
      'accounts_pkey',
      '9f8d24c3f0828724597df2bd4bfa60a287ad5cf043ce76b2dc07bcec4b049ac9',
    ],
    [
      'mainnet_action_intent_yield_scope_fk',
      'f',
      [6, 5, 8, 9],
      'yield_operations',
      [1, 2, 5, 6],
      'yield_operations_scope_unique',
      '9d7b7427408c41667c59d0d3fee3535f41ab25be0c0c190ad40216d2cf5a2ffd',
    ],
    [
      'mainnet_action_intent_yield_submission_fk',
      'f',
      [7],
      'yield_operation_submissions',
      [1],
      'yield_operation_submissions_pkey',
      '5d9e14090b602b867726cebb3d71241c9118f29be3958a92a1441810905368e4',
    ],
    [
      'mainnet_action_intent_ledger_scope_fk',
      'f',
      [8, 9, 5],
      'ledger_transactions',
      [1, 3, 2],
      'ledger_transactions_scope_unique',
      '2b670de1ba03831636d7ff58e879d296f63ca750255a757163dc81b6cfd6e83b',
    ],
    [
      'mainnet_action_intent_wallet_scope_fk',
      'f',
      [10, 5, 11, 12],
      'registered_wallets',
      [1, 2, 4, 5],
      'registered_wallet_balance_sync_scope_unique',
      'e8a355019bcf34415850a988bbf39a3e92f2aa8543c4d8960b727bab687c3f5b',
    ],
    [
      'mainnet_action_intent_fingerprint_unique',
      'u',
      [4],
      null,
      null,
      'mainnet_action_intent_fingerprint_unique',
      '0881e64e65e6c5a101b9cf33e9ba2b6d2e154cdb80dd82680f654a118b1c4fc1',
    ],
    [
      'mainnet_action_intent_yield_operation_unique',
      'u',
      [6],
      null,
      null,
      'mainnet_action_intent_yield_operation_unique',
      '0f2400996445b896c435266a3a08a026bff3977ad48e0e58d057ee7f782eb60b',
    ],
    [
      'mainnet_action_intent_yield_submission_unique',
      'u',
      [7],
      null,
      null,
      'mainnet_action_intent_yield_submission_unique',
      'c3236a7763e755953668d21a5be0b1fa90f761724f9a10d45a1d484f25b4009b',
    ],
    [
      'mainnet_action_intent_idempotency_unique',
      'u',
      [5, 2, 32],
      null,
      null,
      'mainnet_action_intent_idempotency_unique',
      '4f98be032e5c151604f0ebe20e6d859dddba38ae7d569ebebe89ccfd99b1e83d',
    ],
    [
      'mainnet_action_intent_replay_unique',
      'u',
      [5, 2, 33],
      null,
      null,
      'mainnet_action_intent_replay_unique',
      'b16419efdb808f44e99cafe43b11945035cbac55c715a97ccbc22ef59c7b40d5',
    ],
    [
      'mainnet_action_intent_completion_after_insert',
      't',
      null,
      null,
      null,
      null,
      'a5fc893149b88e6e958294fc1a4a285cbad41292c73d26f5f91873f312e3e311',
    ],
  ] as const),
  [EVENT_TABLE]: Object.freeze([
    [
      'mainnet_action_event_pkey',
      'p',
      [2, 3],
      null,
      null,
      'mainnet_action_event_pkey',
      '5fe46f0333b80408051890ea47646565a86d1d37652db25b82af381df05af1ce',
    ],
    [
      'mainnet_action_event_id_unique',
      'u',
      [1],
      null,
      null,
      'mainnet_action_event_id_unique',
      '22e36039fea2c4e4fdbdae8a46af45034c49862a679ac1dd0c8c89879bb2eca7',
    ],
    [
      'mainnet_action_event_snapshot_unique',
      'u',
      [2, 8],
      null,
      null,
      'mainnet_action_event_snapshot_unique',
      '002a661973ee0e285f7c51b517fbba281d39f571fba25ff5f56cba7c3ac743e0',
    ],
    [
      'mainnet_action_event_transition_unique',
      'u',
      [2, 3, 7],
      null,
      null,
      'mainnet_action_event_transition_unique',
      'a85a44487fb7e6bfe6aae6c28c9b65d554d6ccc06592f52667672033f47e4e19',
    ],
    [
      'mainnet_action_event_intent_fk',
      'f',
      [2],
      INTENT_TABLE,
      [1],
      `${INTENT_TABLE}_pkey`,
      '40dcf7c365aa09f4cf914a9d0e9a2a2e0f4ed02c00465d6eead3771ea8ec78bf',
    ],
    [
      'mainnet_action_event_uuid_check',
      'c',
      [1, 29, 13],
      null,
      null,
      null,
      '0035fd4352a8f7f113fa88aeb6a494528fafd097c3eee6c221c78fc58948a731',
    ],
    [
      'mainnet_action_event_digest_check',
      'c',
      [4, 7, 8, 6, 9, 12, 18, 21, 22, 23, 24, 25, 26, 27],
      null,
      null,
      null,
      '9c784168268a95470b30cfad6fd7b37376ce797213ddc6e8c590a2ee86a839b9',
    ],
    [
      'mainnet_action_event_sequence_check',
      'c',
      [3, 6],
      null,
      null,
      null,
      'e934d6a024df26bc7883f862ba192d809a744dee195b340b28e15bd791ac8884',
    ],
    [
      'mainnet_action_event_time_check',
      'c',
      [28, 30],
      null,
      null,
      null,
      'cf4542a5caace9844d054d96ba18a5442187ce74d53ad18edd8195ea29cf5d70',
    ],
    [
      'mainnet_action_event_position_check',
      'c',
      [16, 19],
      null,
      null,
      null,
      'a5e95b88e3d3d73e07b6b920f4895cf9fdfb6e580367cddb1fdafeab76cc293b',
    ],
    [
      'mainnet_action_event_authority_check',
      'c',
      [33, 31, 5, 32],
      null,
      null,
      null,
      'da0b8bd4812bbb6a9e3bb7c90a98c25e5d45a26b796a531db07dede0739907f6',
    ],
    [
      'mainnet_action_event_shape_check',
      'c',
      [5, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
      null,
      null,
      null,
      '4634dddcf5f98cba7f70c67731fa5a2b53a4587c52e692fa141dcff1bc576c06',
    ],
    [
      'mainnet_action_event_evidence_after_insert',
      't',
      null,
      null,
      null,
      null,
      'a5fc893149b88e6e958294fc1a4a285cbad41292c73d26f5f91873f312e3e311',
    ],
  ] as const),
  [EVIDENCE_TABLE]: Object.freeze([
    [
      `${EVIDENCE_TABLE}_pkey`,
      'p',
      [1],
      null,
      null,
      `${EVIDENCE_TABLE}_pkey`,
      '3d6b9c59f03b5987c16965b1371dd3a59d4cb1b366f80d8f1b4f618199404b24',
    ],
    [
      'mainnet_action_evidence_digest_check',
      'c',
      [1, 3],
      null,
      null,
      null,
      '4b8124ea7da8c7106ba9b40d5a969fa36049cfc56d77521456020fdbaf0f7002',
    ],
    [
      'mainnet_action_evidence_role_check',
      'c',
      [2],
      null,
      null,
      null,
      'a04b08c50a85a2d9b969e81f26144786f3d1174728102c3f2a6a22807df2ed49',
    ],
    [
      'mainnet_action_evidence_time_check',
      'c',
      [6],
      null,
      null,
      null,
      'ead180cd279b3b136ec18af45a0070db58a4661488fd67b9d0b1f18b92c8143e',
    ],
    [
      'mainnet_action_evidence_event_fk',
      'f',
      [4, 5, 3],
      EVENT_TABLE,
      [2, 3, 7],
      'mainnet_action_event_transition_unique',
      '4a6bb32f7e675b5d9355542e012ab7d7e436572ed1a9357f33dbc6c0beba47f8',
    ],
    [
      'mainnet_action_evidence_event_role_unique',
      'u',
      [4, 5, 2],
      null,
      null,
      'mainnet_action_evidence_event_role_unique',
      'a2c466e515f715da60ed1003a8a89cb515a8f38d57d741dbc1110f71fe30988a',
    ],
  ] as const),
} as const) satisfies Readonly<Record<string, readonly ExpectedConstraint[]>>;

type ExpectedIndex = Readonly<{
  table: string;
  name: string;
  keys: string;
  options: string;
  operatorClasses: readonly string[];
  unique: boolean;
  primary: boolean;
  predicate: string | null;
}>;

const EXPECTED_INDEXES = Object.freeze([
  {
    table: INTENT_TABLE,
    name: `${INTENT_TABLE}_pkey`,
    keys: '1',
    options: '0',
    operatorClasses: ['uuid_ops'],
    unique: true,
    primary: true,
    predicate: null,
  },
  {
    table: INTENT_TABLE,
    name: 'mainnet_action_intent_fingerprint_unique',
    keys: '4',
    options: '0',
    operatorClasses: ['text_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: INTENT_TABLE,
    name: 'mainnet_action_intent_yield_operation_unique',
    keys: '6',
    options: '0',
    operatorClasses: ['uuid_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: INTENT_TABLE,
    name: 'mainnet_action_intent_yield_submission_unique',
    keys: '7',
    options: '0',
    operatorClasses: ['uuid_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: INTENT_TABLE,
    name: 'mainnet_action_intent_idempotency_unique',
    keys: '5 2 32',
    options: '0 0 0',
    operatorClasses: ['uuid_ops', 'int2_ops', 'text_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: INTENT_TABLE,
    name: 'mainnet_action_intent_replay_unique',
    keys: '5 2 33',
    options: '0 0 0',
    operatorClasses: ['uuid_ops', 'int2_ops', 'uuid_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_pkey',
    keys: '2 3',
    options: '0 0',
    operatorClasses: ['uuid_ops', 'int8_ops'],
    unique: true,
    primary: true,
    predicate: null,
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_id_unique',
    keys: '1',
    options: '0',
    operatorClasses: ['uuid_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_snapshot_unique',
    keys: '2 8',
    options: '0 0',
    operatorClasses: ['uuid_ops', 'text_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_transition_unique',
    keys: '2 3 7',
    options: '0 0 0',
    operatorClasses: ['uuid_ops', 'int8_ops', 'text_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_signed_once',
    keys: '2',
    options: '0',
    operatorClasses: ['uuid_ops'],
    unique: true,
    primary: false,
    predicate: "(stage='WALLET_SIGNED_SUBMISSION_BOUND'::text)",
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_broadcast_once',
    keys: '2',
    options: '0',
    operatorClasses: ['uuid_ops'],
    unique: true,
    primary: false,
    predicate: "(stage='BROADCAST_OUTCOME_AMBIGUOUS'::text)",
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_transaction_owner',
    keys: '10 11',
    options: '0 0',
    operatorClasses: ['text_ops', 'text_ops'],
    unique: true,
    primary: false,
    predicate: "(stage='WALLET_SIGNED_SUBMISSION_BOUND'::text)",
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_transaction_fingerprint_owner',
    keys: '10 12',
    options: '0 0',
    operatorClasses: ['text_ops', 'text_ops'],
    unique: true,
    primary: false,
    predicate: "(stage='WALLET_SIGNED_SUBMISSION_BOUND'::text)",
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_observation_owner',
    keys: '13',
    options: '0',
    operatorClasses: ['uuid_ops'],
    unique: true,
    primary: false,
    predicate: '(observation_idISNOTNULL)',
  },
  {
    table: EVENT_TABLE,
    name: 'mainnet_action_event_reconciliation_timeline',
    keys: '2 3',
    options: '0 3',
    operatorClasses: ['uuid_ops', 'int8_ops'],
    unique: false,
    primary: false,
    predicate: '(reconciliation_outcomeISNOTNULL)',
  },
  {
    table: EVIDENCE_TABLE,
    name: `${EVIDENCE_TABLE}_pkey`,
    keys: '1',
    options: '0',
    operatorClasses: ['text_ops'],
    unique: true,
    primary: true,
    predicate: null,
  },
  {
    table: EVIDENCE_TABLE,
    name: 'mainnet_action_evidence_event_role_unique',
    keys: '4 5 2',
    options: '0 0 0',
    operatorClasses: ['uuid_ops', 'int8_ops', 'text_ops'],
    unique: true,
    primary: false,
    predicate: null,
  },
] as const satisfies readonly ExpectedIndex[]);

type FunctionExpectation = Readonly<{
  identity: string;
  body: string;
  securityDefiner: boolean;
  strict: boolean;
  volatility: 'i' | 's' | 'v';
  parallel: 's' | 'u';
  returnsSet: boolean;
  argumentCount: number;
  result: string;
  purePath: boolean;
}>;

function createVerifierSql(names: BalanceConsumerPrincipalNames, cumulative: boolean): string {
  const previous = createMainnetBalanceAgreementEvidenceV2Migration(names, {
    cumulativePrincipalVerification: cumulative,
  });
  if (!previous.verifySql) throw new Error('Migration 0032 must expose verification SQL');
  // The ledger-scope FK is inbound to ledger_transactions. Preserve every
  // predecessor attestation while rebasing the immutable-ledger catalog's one
  // additional FK constraint and its four PostgreSQL internal FK triggers.
  let prior = replaceExactlyOnce(
    previous.verifySql,
    '(SELECT object_count = 398 FROM constraint_catalog)',
    '(SELECT object_count = 399 FROM constraint_catalog)',
  );
  prior = replaceExactlyOnce(
    prior,
    '9c7de8437cd535aaedab9697db5b684b01fc0a8a65ecf000e1c76064608be2b5',
    '3291f470d23703afa13b7f3c3bc0c0d5c346390f1c5766c128ebe1f8f4681a7b',
  );
  prior = replaceExactlyOnce(
    prior,
    '(SELECT object_count = 360 FROM internal_fk_trigger_catalog)',
    '(SELECT object_count = 364 FROM internal_fk_trigger_catalog)',
  );
  prior = replaceExactlyOnce(
    prior,
    'f5f2a36b42302d1e4b2997b751a90083878ce19478d92fbeebe5cf78d71a3c19',
    'b39bc68b85033576e0859618ff402c8383edf3dd7c2773efb3e637a6623138f0',
  );

  const api = literal(names.apiRuntimeRole, 'apiRuntimeRole');
  const worker = literal(names.workerRuntimeRole, 'workerRuntimeRole');
  const legacy = literal(names.legacyRuntimeRole, 'legacyRuntimeRole');
  const balance = literal(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');
  const migration = literal(names.migrationRole, 'migrationRole');
  const owner = literal(names.schemaOwnerRole, 'schemaOwnerRole');
  const expectedOwner = cumulative ? owner : 'CURRENT_USER';
  const guardedRoles = [api, worker, legacy, balance, migration, "'public'"];
  const commonResult = `TABLE(${resultColumns()
    .replace(/\btimestamptz\b/gu, 'timestamp with time zone')
    .replace(/\s+/gu, ' ')
    .trim()})`;
  const functionExpectations: readonly FunctionExpectation[] = [
    {
      identity: FINGERPRINT_BYTES,
      body: FINGERPRINT_BYTES_BODY,
      securityDefiner: false,
      strict: true,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 3,
      result: 'bytea',
      purePath: true,
    },
    {
      identity: FINGERPRINT,
      body: FINGERPRINT_BODY,
      securityDefiner: false,
      strict: true,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 3,
      result: 'text',
      purePath: false,
    },
    {
      identity: CHAIN_IDENTITY_VALID,
      body: CHAIN_IDENTITY_VALID_BODY,
      securityDefiner: false,
      strict: true,
      volatility: 'i',
      parallel: 's',
      returnsSet: false,
      argumentCount: 3,
      result: 'boolean',
      purePath: true,
    },
    ...[
      [REJECT_HISTORY, REJECT_HISTORY_BODY],
      [ENFORCE_INTENT, ENFORCE_INTENT_BODY],
      [ENFORCE_EVENT, ENFORCE_EVENT_BODY],
      [VALIDATE_INTENT_COMPLETION, VALIDATE_INTENT_COMPLETION_BODY],
      [VALIDATE_EVENT_EVIDENCE, VALIDATE_EVENT_EVIDENCE_BODY],
    ].map(([identityValue, body]): FunctionExpectation => ({
      identity: identityValue ?? '',
      body: body ?? '',
      securityDefiner: true,
      strict: false,
      volatility: 'v',
      parallel: 'u',
      returnsSet: false,
      argumentCount: 0,
      result: 'trigger',
      purePath: false,
    })),
    {
      identity: LIFECYCLE_RESULT,
      body: LIFECYCLE_RESULT_BODY,
      securityDefiner: true,
      strict: true,
      volatility: 's',
      parallel: 'u',
      returnsSet: true,
      argumentCount: 3,
      result: commonResult,
      purePath: false,
    },
    {
      identity: READ_LIFECYCLE,
      body: READ_LIFECYCLE_BODY,
      securityDefiner: true,
      strict: true,
      volatility: 's',
      parallel: 'u',
      returnsSet: true,
      argumentCount: 2,
      result: commonResult,
      purePath: false,
    },
    ...[
      [PREPARE_INTENT, PREPARE_INTENT_BODY, 30, true],
      [BIND_SUBMISSION, BIND_SUBMISSION_BODY, 9, true],
      [RECORD_BROADCAST, RECORD_BROADCAST_BODY, 10, true],
      [RECORD_RECONCILIATION, RECORD_RECONCILIATION_BODY, 16, false],
    ].map(([identityValue, body, argumentCount, strict]): FunctionExpectation => ({
      identity: String(identityValue),
      body: String(body),
      securityDefiner: true,
      strict: Boolean(strict),
      volatility: 'v',
      parallel: 'u',
      returnsSet: true,
      argumentCount: Number(argumentCount),
      result: commonResult,
      purePath: false,
    })),
  ];
  const functionRows = functionExpectations
    .map(
      (expectation) => `(
          ${sqlText(expectation.identity)}, ${sqlText(sourceSha256(expectation.body))},
          ${expectation.securityDefiner}, ${expectation.strict},
          ${sqlText(expectation.volatility)}, ${sqlText(expectation.parallel)},
          ${expectation.returnsSet}, ${expectation.argumentCount},
          ${sqlText(expectation.result)}, ${expectation.purePath}
        )`,
    )
    .join(',\n        ');
  const columnRows = Object.entries(EXPECTED_COLUMNS)
    .flatMap(([table, columns]) =>
      columns.map((column, index) => {
        const [name, type, notNull, hasDefault] = column as ExpectedColumn;
        return `(${sqlText(table)}, ${index + 1}, ${sqlText(name)}, ${sqlText(type)}, ${notNull}, ${Boolean(
          hasDefault,
        )})`;
      }),
    )
    .join(',\n        ');
  const expectedColumnCount = Object.values(EXPECTED_COLUMNS).reduce(
    (count, columns) => count + columns.length,
    0,
  );
  const constraintRows = Object.entries(EXPECTED_CONSTRAINTS)
    .flatMap(([table, constraints]) =>
      constraints.map(
        ([name, type, keys, referencedTable, referencedKeys, backingIndex, definitionSha256]) =>
          `(
            ${sqlText(table)}, ${sqlText(name)}, ${sqlText(type)},
            ${keys === null ? 'NULL::smallint[]' : `ARRAY[${keys.join(',')}]::smallint[]`},
            ${referencedTable === null ? 'NULL::text' : sqlText(referencedTable)},
            ${
              referencedKeys === null
                ? 'NULL::smallint[]'
                : `ARRAY[${referencedKeys.join(',')}]::smallint[]`
            },
            ${backingIndex === null ? 'NULL::text' : sqlText(backingIndex)},
            ${sqlText(definitionSha256)}
          )`,
      ),
    )
    .join(',\n        ');
  const expectedConstraintCount = Object.values(EXPECTED_CONSTRAINTS).reduce(
    (count, constraints) => count + constraints.length,
    0,
  );
  const indexRows = EXPECTED_INDEXES.map(
    (expected) => `(
          ${sqlText(expected.table)}, ${sqlText(expected.name)},
          ${sqlText(expected.keys)}, ${sqlText(expected.options)},
          ARRAY[${expected.operatorClasses.map(sqlText).join(', ')}]::text[],
          ${expected.unique}, ${expected.primary},
          ${expected.predicate === null ? 'NULL::text' : sqlText(expected.predicate)}
        )`,
  ).join(',\n        ');
  const goldenRows = MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS.map((vector) => {
    const fieldNames = vector.fieldNames.map(sqlText).join(', ');
    const fieldValues = vector.fieldValues
      .map((value) => (value === null ? 'NULL' : sqlText(value)))
      .join(', ');
    return `(
          ${sqlText(vector.name)}, ${sqlText(vector.domain)},
          ARRAY[${fieldNames}]::text[], ARRAY[${fieldValues}]::text[],
          ${sqlText(vector.encodedHex)}, ${sqlText(vector.sha256)}
        )`;
  }).join(',\n        ');
  const triggerRows = `
        ('${INTENT_TABLE}', 'mainnet_action_intent_linkage_before_insert', '${ENFORCE_INTENT}', 7, false, false),
        ('${INTENT_TABLE}', 'mainnet_action_intent_completion_after_insert', '${VALIDATE_INTENT_COMPLETION}', 5, true, true),
        ('${INTENT_TABLE}', '${INTENT_TABLE}_append_only_row', '${REJECT_HISTORY}', 27, false, false),
        ('${INTENT_TABLE}', '${INTENT_TABLE}_append_only_truncate', '${REJECT_HISTORY}', 34, false, false),
        ('${EVENT_TABLE}', 'mainnet_action_event_transition_before_insert', '${ENFORCE_EVENT}', 7, false, false),
        ('${EVENT_TABLE}', 'mainnet_action_event_evidence_after_insert', '${VALIDATE_EVENT_EVIDENCE}', 5, true, true),
        ('${EVENT_TABLE}', '${EVENT_TABLE}_append_only_row', '${REJECT_HISTORY}', 27, false, false),
        ('${EVENT_TABLE}', '${EVENT_TABLE}_append_only_truncate', '${REJECT_HISTORY}', 34, false, false),
        ('${EVIDENCE_TABLE}', '${EVIDENCE_TABLE}_append_only_row', '${REJECT_HISTORY}', 27, false, false),
        ('${EVIDENCE_TABLE}', '${EVIDENCE_TABLE}_append_only_truncate', '${REJECT_HISTORY}', 34, false, false)`;

  return `SELECT (
      server_state.valid AND prior.valid AND relation_state.valid AND column_state.valid
      AND constraint_state.valid AND index_state.valid AND trigger_state.valid
      AND function_state.valid AND fingerprint_state.valid AND privilege_state.valid
    ) AS valid
    FROM (
      SELECT pg_catalog.current_setting('server_version_num')::integer >= 160000
        AND pg_catalog.current_setting('server_version_num')::integer < 170000 AS valid
    ) AS server_state
    CROSS JOIN (${prior}) AS prior
    CROSS JOIN (
      WITH expected(table_name, manifest) AS (VALUES
        ('${INTENT_TABLE}', '${INTENT_MANIFEST}'),
        ('${EVENT_TABLE}', '${EVENT_MANIFEST}'),
        ('${EVIDENCE_TABLE}', '${EVIDENCE_MANIFEST}')
      )
      SELECT pg_catalog.count(*) = 3 AND pg_catalog.count(relation.oid) = 3
        AND pg_catalog.bool_and(
          relation.relkind = 'r' AND relation.relpersistence = 'p'
          AND relation.relreplident = 'd'
          AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity
          AND NOT relation.relispartition
          AND relation.relpartbound IS NULL
          AND relation_owner.rolname = ${expectedOwner}
          AND (
            SELECT row_type.typtype = 'c' AND row_type.typrelid = relation.oid
              AND row_type_owner.oid = relation.relowner
            FROM pg_catalog.pg_type AS row_type
            INNER JOIN pg_catalog.pg_roles AS row_type_owner
              ON row_type_owner.oid = row_type.typowner
            WHERE row_type.oid = relation.reltype
          )
          AND pg_catalog.obj_description(relation.oid, 'pg_class') = expected.manifest
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = relation.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_rewrite AS rewrite
            WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN'
          )
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.relname = expected.table_name
        AND relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
      LEFT JOIN pg_catalog.pg_roles AS relation_owner ON relation_owner.oid = relation.relowner
    ) AS relation_state
    CROSS JOIN (
      WITH expected(table_name, ordinal, column_name, data_type, not_null, has_default) AS (VALUES
        ${columnRows}
      )
      SELECT pg_catalog.count(*) = ${expectedColumnCount}
        AND pg_catalog.count(attribute.attnum) = ${expectedColumnCount}
        AND pg_catalog.bool_and(
          attribute.attnum = expected.ordinal
          AND attribute.attname = expected.column_name
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            = expected.data_type
          AND attribute.attnotnull = expected.not_null
          AND attribute.attidentity = '' AND attribute.attgenerated = ''
          AND NOT attribute.atthasmissing
          AND attribute.attcollation = CASE WHEN expected.data_type = 'text'
            THEN pg_catalog.to_regcollation('pg_catalog.default')::oid ELSE 0::oid END
          AND (attribute_default.adbin IS NOT NULL) = expected.has_default
          AND (NOT expected.has_default OR pg_catalog.regexp_replace(
            pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid, false),
            '[[:space:]]+', '', 'g'
          ) = 'gen_random_uuid()')
        )
        AND (
          SELECT pg_catalog.count(*) = ${expectedColumnCount}
          FROM pg_catalog.pg_attribute AS all_attribute
          WHERE all_attribute.attrelid IN (
            pg_catalog.to_regclass('${INTENT_TABLE}'),
            pg_catalog.to_regclass('${EVENT_TABLE}'),
            pg_catalog.to_regclass('${EVIDENCE_TABLE}')
          ) AND all_attribute.attnum > 0 AND NOT all_attribute.attisdropped
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = pg_catalog.to_regclass(expected.table_name)
        AND attribute.attnum = expected.ordinal
      LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
        ON attribute_default.adrelid = attribute.attrelid
        AND attribute_default.adnum = attribute.attnum
    ) AS column_state
    CROSS JOIN (
      WITH expected(
        table_name, constraint_name, constraint_type, constraint_keys,
        referenced_table, referenced_keys, backing_index, definition_sha256
      ) AS (VALUES
        ${constraintRows}
      )
      SELECT pg_catalog.count(*) = ${expectedConstraintCount}
        AND pg_catalog.count(constraint_record.oid) = ${expectedConstraintCount}
        AND pg_catalog.bool_and(
          constraint_record.contype = expected.constraint_type::"char"
          AND constraint_record.convalidated AND constraint_record.conislocal
          AND constraint_record.coninhcount = 0
          AND constraint_record.connamespace =
            pg_catalog.to_regnamespace(pg_catalog.current_schema())
          AND constraint_record.contypid = 0::oid
          AND constraint_record.conparentid = 0::oid
          AND constraint_record.connoinherit = (expected.constraint_type <> 'c')
          AND constraint_record.conkey IS NOT DISTINCT FROM expected.constraint_keys
          AND constraint_record.confrelid = CASE WHEN expected.referenced_table IS NULL
            THEN 0::oid ELSE pg_catalog.to_regclass(expected.referenced_table) END
          AND constraint_record.confkey IS NOT DISTINCT FROM expected.referenced_keys
          AND constraint_record.conindid = CASE WHEN expected.backing_index IS NULL
            THEN 0::oid ELSE pg_catalog.to_regclass(expected.backing_index) END
          AND CASE expected.constraint_type
            WHEN 't' THEN constraint_record.condeferrable AND constraint_record.condeferred
            ELSE NOT constraint_record.condeferrable AND NOT constraint_record.condeferred
          END
          AND CASE expected.constraint_type
            WHEN 'f' THEN constraint_record.confupdtype = 'r'
              AND constraint_record.confdeltype = 'r'
              AND constraint_record.confmatchtype = 's'
              AND constraint_record.confdelsetcols IS NULL
              AND constraint_record.conpfeqop = constraint_record.conppeqop
              AND constraint_record.conpfeqop = constraint_record.conffeqop
              AND pg_catalog.cardinality(constraint_record.conpfeqop)
                = pg_catalog.cardinality(expected.constraint_keys)
            ELSE constraint_record.confupdtype = ' '
              AND constraint_record.confdeltype = ' '
              AND constraint_record.confmatchtype = ' '
              AND constraint_record.conpfeqop IS NULL
              AND constraint_record.conppeqop IS NULL
              AND constraint_record.conffeqop IS NULL
          END
          AND (constraint_record.conbin IS NOT NULL) = (expected.constraint_type = 'c')
          AND constraint_record.conexclop IS NULL
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            pg_catalog.regexp_replace(
              pg_catalog.pg_get_constraintdef(constraint_record.oid, false),
              '[[:space:]]+', '', 'g'
            ), 'UTF8'
          )), 'hex') = expected.definition_sha256
        ) AND (
          SELECT pg_catalog.count(*) = ${expectedConstraintCount}
          FROM pg_catalog.pg_constraint AS all_constraint
          WHERE all_constraint.conrelid IN (
            pg_catalog.to_regclass('${INTENT_TABLE}'),
            pg_catalog.to_regclass('${EVENT_TABLE}'),
            pg_catalog.to_regclass('${EVIDENCE_TABLE}')
          )
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_constraint AS constraint_record
        ON constraint_record.conrelid = pg_catalog.to_regclass(expected.table_name)
        AND constraint_record.conname = expected.constraint_name
    ) AS constraint_state
    CROSS JOIN (
      WITH expected(
        table_name, index_name, index_keys, index_options, operator_classes,
        unique_index, primary_index, predicate_expression
      ) AS (VALUES
        ${indexRows}
      )
      SELECT pg_catalog.count(*) = ${EXPECTED_INDEXES.length}
        AND pg_catalog.count(index_record.indexrelid) = ${EXPECTED_INDEXES.length}
        AND pg_catalog.bool_and(
          index_relation.relkind = 'i' AND index_relation.relpersistence = 'p'
          AND NOT index_relation.relispartition
          AND index_relation.relowner = table_relation.relowner
          AND index_owner.rolname = ${expectedOwner}
          AND index_record.indrelid = pg_catalog.to_regclass(expected.table_name)
          AND index_record.indisvalid AND index_record.indisready AND index_record.indislive
          AND index_record.indisunique = expected.unique_index
          AND index_record.indisprimary = expected.primary_index
          AND NOT index_record.indisexclusion AND index_record.indimmediate
          AND NOT index_record.indnullsnotdistinct
          AND NOT index_record.indisclustered AND NOT index_record.indcheckxmin
          AND NOT index_record.indisreplident
          AND access_method.amname = 'btree'
          AND index_record.indexprs IS NULL
          AND index_record.indkey = expected.index_keys::pg_catalog.int2vector
          AND index_record.indoption = expected.index_options::pg_catalog.int2vector
          AND (
            SELECT pg_catalog.array_agg(operator_class.opcname::text ORDER BY key_position)
            FROM pg_catalog.generate_series(
              0, index_record.indnkeyatts - 1
            ) AS positions(key_position)
            INNER JOIN pg_catalog.pg_opclass AS operator_class
              ON operator_class.oid = index_record.indclass[key_position]
            INNER JOIN pg_catalog.pg_namespace AS operator_namespace
              ON operator_namespace.oid = operator_class.opcnamespace
              AND operator_namespace.nspname = 'pg_catalog'
          ) = expected.operator_classes
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.generate_series(
              0, index_record.indnkeyatts - 1
            ) AS positions(key_position)
            INNER JOIN pg_catalog.pg_attribute AS indexed_attribute
              ON indexed_attribute.attrelid = index_record.indrelid
              AND indexed_attribute.attnum = index_record.indkey[key_position]
            WHERE index_record.indcollation[key_position]
              <> indexed_attribute.attcollation
          )
          AND CASE WHEN expected.predicate_expression IS NULL THEN
            index_record.indpred IS NULL
          ELSE pg_catalog.regexp_replace(
            pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid, false),
            '[[:space:]]+', '', 'g'
          ) = expected.predicate_expression END
          AND index_record.indnkeyatts = pg_catalog.array_length(
            pg_catalog.string_to_array(expected.index_keys, ' '), 1
          )
          AND index_record.indnatts = index_record.indnkeyatts
        ) AND (
          SELECT pg_catalog.count(*) = ${EXPECTED_INDEXES.length}
          FROM pg_catalog.pg_index AS all_index
          WHERE all_index.indrelid IN (
            pg_catalog.to_regclass('${INTENT_TABLE}'),
            pg_catalog.to_regclass('${EVENT_TABLE}'),
            pg_catalog.to_regclass('${EVIDENCE_TABLE}')
          )
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.relname = expected.index_name
        AND index_relation.relnamespace = pg_catalog.to_regnamespace(pg_catalog.current_schema())
      LEFT JOIN pg_catalog.pg_class AS table_relation
        ON table_relation.oid = pg_catalog.to_regclass(expected.table_name)
      LEFT JOIN pg_catalog.pg_index AS index_record
        ON index_record.indexrelid = index_relation.oid
        AND index_record.indrelid = table_relation.oid
      LEFT JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_relation.relam
      LEFT JOIN pg_catalog.pg_roles AS index_owner ON index_owner.oid = index_relation.relowner
    ) AS index_state
    CROSS JOIN (
      WITH expected(
        table_name, trigger_name, function_identity, trigger_type,
        expected_deferrable, expected_deferred
      ) AS (VALUES${triggerRows}
      )
      SELECT pg_catalog.count(*) = 10 AND pg_catalog.count(trigger_record.oid) = 10
        AND pg_catalog.bool_and(
          NOT trigger_record.tgisinternal AND trigger_record.tgenabled = 'A'
          AND trigger_record.tgfoid = pg_catalog.to_regprocedure(expected.function_identity)
          AND trigger_record.tgtype = expected.trigger_type
          AND trigger_record.tgnargs = 0 AND trigger_record.tgparentid = 0
          AND trigger_record.tgdeferrable = expected.expected_deferrable
          AND trigger_record.tginitdeferred = expected.expected_deferred
          AND trigger_record.tgoldtable IS NULL AND trigger_record.tgnewtable IS NULL
        ) AND (
          SELECT pg_catalog.count(*) = 10
          FROM pg_catalog.pg_trigger AS all_trigger
          WHERE all_trigger.tgrelid IN (
            pg_catalog.to_regclass('${INTENT_TABLE}'),
            pg_catalog.to_regclass('${EVENT_TABLE}'),
            pg_catalog.to_regclass('${EVIDENCE_TABLE}')
          ) AND NOT all_trigger.tgisinternal
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_trigger AS trigger_record
        ON trigger_record.tgrelid = pg_catalog.to_regclass(expected.table_name)
        AND trigger_record.tgname = expected.trigger_name
    ) AS trigger_state
    CROSS JOIN (
      WITH expected(
        function_identity, body_sha256, security_definer, strict_function,
        volatility, parallel_safety, returns_set, argument_count, result_type, pure_path
      ) AS (VALUES
        ${functionRows}
      )
      SELECT pg_catalog.count(*) = ${functionExpectations.length}
        AND pg_catalog.count(procedure.oid) = ${functionExpectations.length}
        AND pg_catalog.bool_and(
          function_owner.rolname = ${cumulative ? owner : 'function_owner.rolname'}
          AND procedure.prokind = 'f' AND NOT procedure.proleakproof
          AND procedure.prosecdef = expected.security_definer
          AND procedure.proisstrict = expected.strict_function
          AND procedure.provolatile = expected.volatility::"char"
          AND procedure.proparallel = expected.parallel_safety::"char"
          AND procedure.proretset = expected.returns_set
          AND procedure.pronargs = expected.argument_count
          AND procedure.pronargdefaults = 0 AND procedure.proargdefaults IS NULL
          AND procedure.provariadic = 0::oid
          AND language.lanname = 'plpgsql'
          AND pg_catalog.pg_get_function_result(procedure.oid) = expected.result_type
          AND procedure.proconfig = CASE WHEN expected.pure_path
            THEN ARRAY['search_path=pg_catalog']::text[]
            ELSE ARRAY[
              'search_path=pg_catalog, ' || pg_catalog.current_schema() || ', pg_temp'
            ]::text[]
          END
          AND pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')), 'hex'
          ) = expected.body_sha256
        ) AS valid
      FROM expected
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
      LEFT JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
      LEFT JOIN pg_catalog.pg_roles AS function_owner ON function_owner.oid = procedure.proowner
    ) AS function_state
    CROSS JOIN (
      WITH expected(name, domain, field_names, field_values, encoded_hex, digest) AS (VALUES
        ${goldenRows}
      )
      SELECT pg_catalog.count(*) = ${MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS.length}
        AND pg_catalog.bool_and(
          pg_catalog.encode(
            mainnet_action_fingerprint_bytes_v1(domain, field_names, field_values), 'hex'
          ) = encoded_hex
          AND mainnet_action_fingerprint_v1(domain, field_names, field_values) = digest
        )
        AND mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'left', 'right']::text[],
          ARRAY['1', 'ab', 'c']::text[]
        ) <> mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'left', 'right']::text[],
          ARRAY['1', 'a', 'bc']::text[]
        )
        AND mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'nullable']::text[], ARRAY['1', NULL]::text[]
        ) <> mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'nullable']::text[], ARRAY['1', '']::text[]
        )
        AND mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'a', 'b']::text[], ARRAY['1', 'x', 'y']::text[]
        ) <> mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'b', 'a']::text[], ARRAY['1', 'y', 'x']::text[]
        )
        AND mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'mutation']::text[], ARRAY['1', '0']::text[]
        ) <> mainnet_action_fingerprint_v1(
          'CRYPTO_LENDING:MAINNET_ACTION:SNAPSHOT:FRAMED:v1',
          ARRAY['fingerprintEncodingVersion', 'mutation']::text[], ARRAY['1', '1']::text[]
        )
        AND 'e672e31e8e43af4e842b455732232f6edcb398b4be16b0e2481127877781b16c'
          <> '90c6037f70d7672e2e3692333e242f1049474aa3006da7de5bc0d2611ac02598'
          AS valid
      FROM expected
    ) AS fingerprint_state
    CROSS JOIN (
      SELECT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS guarded_table
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(guarded_table.relacl, pg_catalog.acldefault('r', guarded_table.relowner))
        ) AS acl
        WHERE guarded_table.oid IN (
          pg_catalog.to_regclass('${INTENT_TABLE}'),
          pg_catalog.to_regclass('${EVENT_TABLE}'),
          pg_catalog.to_regclass('${EVIDENCE_TABLE}')
        ) AND acl.grantee <> guarded_table.relowner
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS guarded_attribute
        INNER JOIN pg_catalog.pg_class AS guarded_table
          ON guarded_table.oid = guarded_attribute.attrelid
        CROSS JOIN LATERAL pg_catalog.aclexplode(guarded_attribute.attacl) AS acl
        WHERE guarded_attribute.attrelid IN (
          pg_catalog.to_regclass('${INTENT_TABLE}'),
          pg_catalog.to_regclass('${EVENT_TABLE}'),
          pg_catalog.to_regclass('${EVIDENCE_TABLE}')
        ) AND guarded_attribute.attnum > 0 AND NOT guarded_attribute.attisdropped
          AND acl.grantee <> guarded_table.relowner
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_type AS guarded_type
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(guarded_type.typacl, pg_catalog.acldefault('T', guarded_type.typowner))
        ) AS acl
        WHERE guarded_type.oid IN (
          pg_catalog.to_regtype('${INTENT_TABLE}'),
          pg_catalog.to_regtype('${EVENT_TABLE}'),
          pg_catalog.to_regtype('${EVIDENCE_TABLE}')
        ) AND acl.grantee <> guarded_type.typowner
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS guarded_function
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(guarded_function.proacl, pg_catalog.acldefault('f', guarded_function.proowner))
        ) AS acl
        WHERE guarded_function.oid IN (
          ${ALL_FUNCTIONS.map(
            (functionIdentity) => `pg_catalog.to_regprocedure('${functionIdentity}')`,
          ).join(',\n          ')}
        ) AND acl.grantee <> guarded_function.proowner
      )
      AND ${guardedRoles
        .flatMap((role) => [
          ...[INTENT_TABLE, EVENT_TABLE, EVIDENCE_TABLE].map(
            (table) =>
              `NOT pg_catalog.has_table_privilege(${role}, '${table}', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
          ),
          ...ALL_FUNCTIONS.map(
            (functionIdentity) =>
              `NOT pg_catalog.has_function_privilege(${role}, '${functionIdentity}', 'EXECUTE')`,
          ),
        ])
        .join('\n      AND ')} AS valid
    ) AS privilege_state`;
}

export function createMainnetFinancialActionLifecycleMigration(
  names: BalanceConsumerPrincipalNames,
  options: Readonly<{ cumulativePrincipalVerification?: boolean }> = {},
): DatabaseMigration {
  const cumulative = options.cumulativePrincipalVerification !== false;
  return {
    id: '0033',
    description:
      'create dormant owner-only restart-safe mainnet financial action lifecycle persistence',
    upSql: createUpSql(names),
    downSql: createDownSql(names),
    verifySql: createVerifierSql(names, cumulative),
    supersedesVerificationOf: ['0032'],
  };
}

export const createMainnetFinancialActionLifecycleMigrationV0033 =
  createMainnetFinancialActionLifecycleMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS);

// NEVER FOR DEPLOYMENT: isolated-schema tests intentionally omit migration 0005.
export const createMainnetFinancialActionLifecycleTestSchemaMigrationV0033 =
  createMainnetFinancialActionLifecycleMigration(PRODUCTION_BALANCE_CONSUMER_PRINCIPALS, {
    cumulativePrincipalVerification: false,
  });
