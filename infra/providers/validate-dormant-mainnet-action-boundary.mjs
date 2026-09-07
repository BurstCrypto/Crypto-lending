import { createHash } from 'node:crypto';
import { opendirSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACTION_BOUNDARY_PATH =
  'apps/api/src/mainnet-actions/domain/dormant-mainnet-financial-action.ts';
export const ACTION_BOUNDARY_SPEC_PATH =
  'apps/api/src/mainnet-actions/domain/dormant-mainnet-financial-action.spec.ts';
export const ACTION_LIFECYCLE_PATH =
  'apps/api/src/mainnet-actions/domain/dormant-mainnet-financial-action-lifecycle.ts';
export const ACTION_LIFECYCLE_SPEC_PATH =
  'apps/api/src/mainnet-actions/domain/dormant-mainnet-financial-action-lifecycle.spec.ts';
export const ACTION_LIFECYCLE_DURABLE_PORT_PATH =
  'apps/api/src/mainnet-actions/application/ports/dormant-mainnet-financial-action-lifecycle-durable.port.ts';
const PROHIBITED_ACTION_LIFECYCLE_DATABASE_CODEC_PATH =
  'apps/api/src/mainnet-actions/application/dormant-mainnet-financial-action-lifecycle-database.codec.ts';
export const ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH =
  'apps/api/src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter.ts';
export const ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_PATH =
  'apps/api/src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter.spec.ts';
export const ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_PATH =
  'apps/api/test/infrastructure/postgres-dormant-mainnet-financial-action-lifecycle-durable-adapter.integration-spec.ts';
export const ACTION_LIFECYCLE_MIGRATION_PATH =
  'apps/api/src/infrastructure/database/migrations/0033-create-mainnet-financial-action-lifecycle.migration.ts';
export const ACTION_LIFECYCLE_MIGRATION_SPEC_PATH =
  'apps/api/src/infrastructure/database/migrations/0033-create-mainnet-financial-action-lifecycle.migration.spec.ts';
export const DATABASE_MIGRATION_INDEX_PATH =
  'apps/api/src/infrastructure/database/migrations/index.ts';
export const MAX_ACTION_BOUNDARY_FILE_BYTES = 512 * 1024;
export const MAX_ACTION_BOUNDARY_RUNTIME_FILES = 4_096;
export const MAX_ACTION_BOUNDARY_RUNTIME_BYTES = 24 * 1024 * 1024;
export const MAX_ACTION_BOUNDARY_RUNTIME_DIRECTORIES = 4_096;
export const MAX_ACTION_BOUNDARY_RUNTIME_DEPTH = 64;
export const MAX_ACTION_BOUNDARY_RUNTIME_ENTRIES = 16_384;
export const REVIEWED_ACTION_BOUNDARY_SHA256 =
  'a6a206a47aae1af0b0587eb43b0576029a5a3541ccbd9e3b58452b29f872878a';
export const REVIEWED_ACTION_BOUNDARY_SPEC_SHA256 =
  '73d17b293472e51b8adca3294b19627941e3f43eec9e3e467df569e1a2cb422b';
export const REVIEWED_ACTION_LIFECYCLE_SHA256 =
  '87436578870cc361d9bc8c63f9e72a5c28fb37d09c1cbb685d49662288e660db';
export const REVIEWED_ACTION_LIFECYCLE_SPEC_SHA256 =
  'ba4f5acc5d10497178c0c3c4ff7a89435f03e33bc2efbc7f6024bf090069cc86';
export const REVIEWED_ACTION_LIFECYCLE_DURABLE_PORT_SHA256 =
  '389a0e898f1a411ae4d01c53ce82d72b1672633a071d7f7a7c8d01e1c61e9cd3';
export const REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SHA256 =
  '5b4052709e040b16c3f788fc784c3f30cb2bc0129a0f369680eb6d534dd696df';
export const REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_SHA256 =
  'f9c976efdeee588087a54a72e30d132e5dbd81345197c7fde8d84bf801702906';
export const REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_SHA256 =
  'a71f07935cbc5354d5654f7b1f51ac528f2012d6914840daf26acb5f3b6c40c9';
export const REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256 =
  'c3840f3b3cd7de0e7dbf159c335fbe0784e55e81c936defdf618c9b0092ffa27';
export const REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256 =
  '7015c5fc30584e868cbdc2df3a376479521d1972f516134d4e95c595a4b7816e';
export const REVIEWED_DATABASE_MIGRATION_INDEX_SHA256 =
  '6ec4f52c67e555070782c3b0a87950ff887e1f513cd92567534ee9dd9393a78b';
export const ACTION_BOUNDARY_INPUT_ERROR =
  'Dormant mainnet action boundary inputs must be stable, single-link regular UTF-8 files at canonical paths inside the repository and within the reviewed size limits.';

export const EXPECTED_ACTIONS = Object.freeze(['SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY']);
export const EXPECTED_PROVIDER_CANDIDATES = Object.freeze([
  Object.freeze(['aave', 'aave-v3', 'eip155:1']),
  Object.freeze(['morpho', 'morpho-blue', 'eip155:1']),
  Object.freeze(['compound', 'compound-iii', 'eip155:1']),
  Object.freeze(['spark', 'sparklend', 'eip155:1']),
  Object.freeze(['euler', 'euler-v2', 'eip155:1']),
  Object.freeze(['gearbox', 'gearbox-v3', 'eip155:1']),
  Object.freeze(['kamino', 'kamino-lend', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']),
  Object.freeze(['save', 'save-lend', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']),
  Object.freeze(['project-0', 'marginfi-v2', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']),
  Object.freeze(['jupiter', 'jupiter-lend', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']),
]);

const API_SOURCE_ROOT = 'apps/api/src';
const BOUNDARY_IMPORT_STEM = 'dormant-mainnet-financial-action';
const LIFECYCLE_IMPORT_STEM = 'dormant-mainnet-financial-action-lifecycle';
const EXPECTED_IMPORTS = Object.freeze([
  'node:util/types',
  '../../blockchain/domain/mainnet-launch-network-policy',
  '../../blockchain/domain/supported-asset-registry',
  '../../wallets/domain/wallet-identity',
]);
const EXPECTED_LIFECYCLE_IMPORTS = Object.freeze([
  'node:crypto',
  'node:util/types',
  '../../wallets/domain/wallet-identity',
  './dormant-mainnet-financial-action',
]);
const EXPECTED_DURABLE_PORT_IMPORTS = Object.freeze([
  '../../domain/dormant-mainnet-financial-action',
]);
const EXPECTED_POSTGRES_ADAPTER_IMPORTS = Object.freeze([
  'node:util/types',
  '../../infrastructure/database/postgres.service',
  '../../blockchain/domain/supported-asset-registry',
  '../domain/dormant-mainnet-financial-action',
  '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
]);
const EXPECTED_POSTGRES_ADAPTER_SPEC_IMPORTS = Object.freeze([
  '../../blockchain/domain/supported-asset-registry',
  '../../infrastructure/database/postgres.service',
  '../domain/dormant-mainnet-financial-action',
  '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
  './postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter',
]);
const EXPECTED_POSTGRES_ADAPTER_INTEGRATION_SPEC_IMPORTS = Object.freeze([
  'node:crypto',
  'pg',
  'pg',
  '../../src/blockchain/domain/supported-asset-registry',
  '../../src/infrastructure/database/migration-runner.service',
  '../../src/infrastructure/database/migrations',
  '../../src/infrastructure/database/postgres.service',
  '../../src/mainnet-actions/domain/dormant-mainnet-financial-action',
  '../../src/mainnet-actions/application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
  '../../src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter',
]);
const EXPECTED_DURABLE_PORT_EXPORTS = Object.freeze([
  'DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION',
  'DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE',
  'DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE',
  'MAINNET_FINANCIAL_ACTION_DATABASE_FINGERPRINT_ENCODING',
  'MainnetFinancialActionDatabaseNetworkId',
  'DormantMainnetFinancialActionDurableOperation',
  'DormantMainnetFinancialActionDatabaseStage',
  'DormantMainnetFinancialActionDatabaseRecordOutcome',
  'DormantMainnetWalletBroadcastDatabaseOutcome',
  'DormantMainnetReconciliationDatabaseOutcome',
  'DormantMainnetFinancialActionVolatileCommitmentV1',
  'DormantMainnetFinancialActionClmaDatabaseCursorV1',
  'DormantMainnetFinancialActionAuthoritativeLinksV1',
  'PrepareDormantMainnetFinancialActionDurableRequestV1',
  'BindDormantMainnetFinancialActionSubmissionRequestV1',
  'RecordDormantMainnetFinancialActionBroadcastRequestV1',
  'RecordDormantMainnetFinancialActionReconciliationRequestV1',
  'ReadDormantMainnetFinancialActionDurableRequestV1',
  'DormantMainnetFinancialActionDurableRequestV1',
  'DormantMainnetFinancialActionDatabaseConfirmedResultV1',
  'DormantMainnetFinancialActionPreWalletDatabaseOutcomeUnknownV1',
  'DormantMainnetFinancialActionPostWalletDatabaseOutcomeUnknownV1',
  'DormantMainnetFinancialActionDatabaseOutcomeUnknownV1',
  'DormantMainnetFinancialActionDurableResultV1',
  'DormantMainnetFinancialActionLifecycleDurablePort',
]);
const EXPECTED_POSTGRES_ADAPTER_EXPORTS = Object.freeze([
  'DormantMainnetFinancialActionLifecycleClock',
  'PostgresDormantMainnetFinancialActionLifecycleDurableAdapter',
]);
const EXPECTED_POSTGRES_ADAPTER_SQL_CONSTANTS = Object.freeze([
  'PREPARE_SQL',
  'BIND_SUBMISSION_SQL',
  'RECORD_BROADCAST_SQL',
  'RECORD_RECONCILIATION_SQL',
  'READ_SQL',
]);
const EXPECTED_POSTGRES_ADAPTER_SQL_FUNCTIONS = Object.freeze([
  'prepare_mainnet_financial_action_lifecycle',
  'bind_mainnet_financial_action_submission',
  'record_mainnet_financial_action_broadcast_observation',
  'record_mainnet_financial_action_reconciliation_observation',
  'read_mainnet_financial_action_lifecycle',
]);
const EXPECTED_PRODUCTION_MIGRATION_TAIL = Object.freeze([
  'createProviderPositionChainAnchorEvidenceMigrationV0029',
  'enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030',
  'createProviderPositionChainAnchorRecordIntentMigrationV0031',
  'createMainnetBalanceAgreementEvidenceV2MigrationV0032',
  'createMainnetFinancialActionLifecycleMigrationV0033',
]);
const EXPECTED_TEST_MIGRATION_TAIL = Object.freeze([
  'createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029',
  'enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030',
  'createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031',
  'createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032',
  'createMainnetFinancialActionLifecycleTestSchemaMigrationV0033',
]);
const EXPECTED_FINGERPRINT_GOLDEN_SHA256 = Object.freeze([
  'e672e31e8e43af4e842b455732232f6edcb398b4be16b0e2481127877781b16c',
  '844539971400540a0c6feb03b8526c2ddb93e6bdf5707703bb1838a3f39a6c18',
  '375d8c09095a24a75e2785193a02ee65ffd3484f07f2ebf9cef7a89ee2b268c9',
  'aa3d5c5b03d86bbf5c047bfb1c967def4e0a977a2503f26e5b900f45411464e6',
  '0def9229fa93856e2f685e95123cb90b613697796da323feaf62830690099401',
  'dc0d788f3f58bb5d2081965970e0d6f019af062cc34fb4d5f322682ba3b5b281',
]);
const REQUIRED_CLOSED_MARKERS = Object.freeze([
  "mode: 'DISABLED' as const",
  "'eip155:1': 'HALT' as const",
  "'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'HALT' as const",
  'approvedProviders: NO_APPROVALS',
  'approvedMarkets: NO_APPROVALS',
  'approvedAssets: NO_APPROVALS',
  'approvedActions: NO_APPROVALS',
  'allowlistedWallets: NO_APPROVALS',
  "perTransactionUsdMicros: '0' as const",
  "perWalletDailyUsdMicros: '0' as const",
  "globalDailyUsdMicros: '0' as const",
  "totalOutstandingUsdMicros: '0' as const",
  "maximumNetworkFeeAtomic: '0' as const",
  'maximumNetworkFeeBasisPoints: 0 as const',
  "minimumPostActionNativeBalanceAtomic: '0' as const",
  "maximumAllowanceAtomic: '0' as const",
  'maximumUnresolvedIntentsPerWallet: 0 as const',
  'walletAllowlistSize: 0 as const',
  'exactAllowanceRequired: true as const',
  'durableReplayProtectionAvailable: false as const',
  'durableLimitCountersAvailable: false as const',
  'providerWriteApprovalAvailable: false as const',
  'marketWriteManifestAvailable: false as const',
  "signingResponsibility: 'USER_WALLET_ONLY' as const",
  "broadcastResponsibility: 'USER_WALLET_ONLY' as const",
  "decision: 'DENY' as const",
]);
const REQUIRED_LIFECYCLE_CLOSED_MARKERS = Object.freeze([
  "operationalMode: 'DORMANT' as const",
  'mayAuthorizeFinancialAction: false as const',
  'mayBuildTransaction: false as const',
  'maySignTransaction: false as const',
  'mayBroadcastTransaction: false as const',
  'mayAutomaticallyResubmit: false as const',
  'mayEscalateNetworkFee: false as const',
  "signingResponsibility: 'USER_WALLET_ONLY' as const",
  "broadcastResponsibility: 'USER_WALLET_ONLY' as const",
  "kind: 'VOLATILE_IN_PROCESS_ONLY' as const",
  'durable: false as const',
  'mayClaimReplayProtectionAfterRestart: false as const',
  'persistenceAuthority: false as const',
  "use: 'DORMANT_MAINNET_FINANCIAL_ACTION_LIFECYCLE_PROTOCOL_ONLY' as const",
  "source: 'USER_WALLET_REPORT_ONLY' as const",
  'cryptographicSignatureVerifiedByThisProtocol: false as const',
  'signedPayloadMatchesIntentVerifiedByThisProtocol: false as const',
  'onchainAcceptanceVerifiedByThisProtocol: false as const',
  "source: 'CALLER_SUPPLIED_READ_ONLY_CHAIN_EVIDENCE' as const",
  'independentlyReadByThisProtocol: false as const',
  'executionAuthority: false as const',
]);
const UNSAFE_CAPABILITY =
  /\b(?:mayAuthorizeFinancialAction|apiMaySign|apiMayBroadcast|crossChainExecutionAllowed|automaticResendAllowed|automaticFeeEscalationAllowed|durableReplayProtectionAvailable|durableLimitCountersAvailable|providerWriteApprovalAvailable|marketWriteManifestAvailable)\s*:\s*true\b/u;
const PROHIBITED_BOUNDARY_SOURCE =
  /(?:\bprocess\.env\b|\b(?:fetch|WebSocket|XMLHttpRequest|eval|Function)\s*\(|\b(?:require|import)\s*\(|\bexport\s+(?:\*|\{[^}]*\})\s+from\s*['"]|\b(?:sendRawTransaction|sendTransaction|signTransaction|broadcastTransaction|eth_sendRawTransaction)\b|@(Injectable|Module|Controller)\s*\()/u;
const RUNTIME_REFERENCE =
  /(?:dormant-mainnet-financial-action|DormantMainnetFinancialAction|DORMANT_MAINNET_FINANCIAL_ACTION|MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES|MAINNET_FINANCIAL_ACTION_DATABASE_FINGERPRINT_ENCODING|PostgresDormantMainnetFinancialActionLifecycleDurableAdapter|assessDormantMainnetFinancialAction|parseDormantMainnetFinancialActionIntent|createDormantMainnetFinancialActionLifecycleProtocol)/u;
const ACTION_LIFECYCLE_MIGRATION_REFERENCE =
  /(?:0033-create-mainnet-financial-action-lifecycle|createMainnetFinancialActionLifecycle(?:TestSchema)?MigrationV0033|MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS|mainnet_financial_action_(?:intents|events|evidence_claims)|(?:read|prepare|bind|record)_mainnet_financial_action_(?:lifecycle|submission|broadcast_observation|reconciliation_observation))/u;
const ACTION_LIFECYCLE_DATABASE_FUNCTION_REFERENCE =
  /\b(?:prepare_mainnet_financial_action_lifecycle|bind_mainnet_financial_action_submission|record_mainnet_financial_action_broadcast_observation|record_mainnet_financial_action_reconciliation_observation|read_mainnet_financial_action_lifecycle)\b/u;
const DURABLE_SOURCE_SYMBOL_BRAND = /\bSymbol(?:\.for)?\s*\(/u;
const DURABLE_STANDALONE_RESULT_EXPORT =
  /\bexport\s+(?:(?:const|function)\s+(?:decode(?:Dormant)?MainnetFinancialActionDatabaseResult|createDormantMainnetFinancialActionDatabaseOutcomeUnknown|databaseOutcomeUnknown)|(?:type|interface|class)\s+DormantMainnetFinancialActionLifecycleDatabase(?:CommandV1|Codec|CodecError|CodecErrorCode))\b/u;
const PROHIBITED_DURABLE_REGISTRATION =
  /(?:@(?:Injectable|Module|Controller)\s*\(|\bfrom\s*['"]@nestjs\/|\bexport\s+(?:\*|\{[^}]*\})\s+from\s*['"]|\bproviders\s*:|\bmodule\.exports\b|\bprocess\.env\b|\b(?:fetch|WebSocket|XMLHttpRequest|eval|Function)\s*\(|\b(?:require|import)\s*\()/u;
const PROHIBITED_ADAPTER_DATABASE_CONTROL =
  /(?:\.\s*query\s*\(|\bwithTransaction\s*\(|\b(?:maxRetries|retryDelayMs|retryAttempts|retryCount|retryLimit|retryPolicy)\b|\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\()/iu;
const PROHIBITED_ADAPTER_SQL_AUTHORITY =
  /\b(?:GRANT|REVOKE|CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/u;
const PROHIBITED_DURABLE_AUTHORITY =
  /(?:\b(?:sendRawTransaction|sendTransaction|signTransaction|broadcastTransaction|eth_sendRawTransaction|writeContract|JsonRpcProvider|WalletClient|PrivateKeyAccount)\b|\b(?:job_outbox|outbox|enqueue)\b|\b(?:mayAuthorizeFinancialAction|apiMaySign|apiMayBroadcast|mayResendTransaction|automaticRetryAllowed|ledgerSettlementAuthority)\s*:\s*true\b|\bledger_settlement_authority\s*=\s*true\b)/iu;
const REVIEWED_DORMANT_SOURCE_PATHS = new Set([
  ACTION_BOUNDARY_PATH,
  ACTION_LIFECYCLE_PATH,
  ACTION_LIFECYCLE_DURABLE_PORT_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH,
  ACTION_LIFECYCLE_MIGRATION_PATH,
]);
const REVIEWED_RUNTIME_DYNAMIC_IMPORTS = new Map([
  ['apps/api/src/application-root.ts', Object.freeze(['./local-development-app.module'])],
  [
    'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.ts',
    Object.freeze(['./balance-sync-consumer.runtime']),
  ],
]);

function normalizedPath(path) {
  return path.split('\\').join('/');
}

function exactArray(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => {
      const expected = right[index];
      return Array.isArray(value) && Array.isArray(expected)
        ? exactArray(value, expected)
        : value === expected;
    })
  );
}

function extractActions(source) {
  const match = source.match(
    /export const MAINNET_FINANCIAL_ACTIONS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s*as const\);/u,
  );
  if (!match) return null;
  const values = [...match[1].matchAll(/'([^']+)'\s*,?/gu)].map((entry) => entry[1]);
  const residue = match[1].replace(/'[^']+'\s*,?/gu, '').replace(/\s/gu, '');
  return residue === '' ? values : null;
}

function extractProviderCandidates(source) {
  const match = source.match(
    /export const MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES[\s\S]*?Object\.freeze\(\[([\s\S]*?)\]\);/u,
  );
  if (!match) return null;
  const pattern = /candidate\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)\s*,?/gu;
  const values = [...match[1].matchAll(pattern)].map((entry) => [entry[1], entry[2], entry[3]]);
  const residue = match[1].replace(pattern, '').replace(/\s/gu, '');
  return residue === '' ? values : null;
}

function extractImports(source) {
  return [...source.matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;/gu)].map(
    (entry) => entry[1],
  );
}

function extractExports(source) {
  return [
    ...source.matchAll(
      /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|class|function|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu,
    ),
  ].map((entry) => entry[1]);
}

function hasUnsupportedExportSyntax(source) {
  return /\bexport\s+(?:default\b|\*|\{)/u.test(source);
}

function extractSqlConstants(source) {
  return [...source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*_SQL)\s*=/gu)].map((entry) => entry[1]);
}

function extractSqlFunctions(source) {
  return [...source.matchAll(/\bFROM\s+([a-z][a-z0-9_]*)\s*\(/gu)].map((entry) => entry[1]);
}

function countTests(source) {
  return [...source.matchAll(/\b(?:it|test)\s*\(/gu)].length;
}

function countDeclaredTests(source) {
  return [...source.matchAll(/(?:^|\n)\s*(?:it|test)\s*\(/gu)].length;
}

function occurrences(source, value) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(value, offset)) >= 0) {
    count += 1;
    offset += value.length;
  }
  return count;
}

function extractSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  return start >= 0 && end > start ? source.slice(start, end) : null;
}

function extractFrozenIdentifierArray(source, exportName) {
  const match = source.match(
    new RegExp(`export const ${exportName}[^=]*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`, 'u'),
  );
  if (!match) return null;
  const identifiers = match[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return identifiers.every((value) => /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value))
    ? identifiers
    : null;
}

function hasExactTail(values, tail) {
  return Array.isArray(values) && exactArray(values.slice(-tail.length), tail);
}

function validateDormantActionMigrationSnapshot(migrationSource, migrationSpecSource, indexSource) {
  const errors = [];
  const enforceIntent = extractSection(
    migrationSource,
    'const ENFORCE_INTENT_BODY = `',
    'const VALIDATE_INTENT_COMPLETION_BODY = `',
  );
  const prepare = extractSection(
    migrationSource,
    'const PREPARE_INTENT_BODY = `',
    'const BIND_SUBMISSION_BODY = `',
  );
  const bind = extractSection(
    migrationSource,
    'const BIND_SUBMISSION_BODY = `',
    'const RECORD_BROADCAST_BODY = `',
  );
  const broadcast = extractSection(
    migrationSource,
    'const RECORD_BROADCAST_BODY = `',
    'const RECORD_RECONCILIATION_BODY = `',
  );
  const reconciliation = extractSection(
    migrationSource,
    'const RECORD_RECONCILIATION_BODY = `',
    'function createTablesSql()',
  );

  if ([enforceIntent, prepare, bind, broadcast, reconciliation].some((value) => value === null)) {
    errors.push('0033 lifecycle SQL body inventory is incomplete or reordered');
  }

  if (
    !migrationSource.includes("id: '0033'") ||
    occurrences(migrationSource, "supersedesVerificationOf: ['0032']") !== 1 ||
    !migrationSource.includes(
      'create dormant owner-only restart-safe mainnet financial action lifecycle persistence',
    )
  ) {
    errors.push('0033 migration identity or predecessor verification changed');
  }

  for (const marker of [
    "const ETHEREUM_MAINNET = 'eip155:1';",
    "const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';",
    "requested_network_id NOT IN (\n          'eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'\n        )",
    "requested_action_type NOT IN ('SUPPLY', 'WITHDRAW')",
    "OR NEW.action_type NOT IN ('SUPPLY', 'WITHDRAW')",
    'BORROW/REPAY have no truthful parent yield-operation type in migration 0012.',
  ]) {
    if (!migrationSource.includes(marker)) {
      errors.push(`0033 migration lacks closed network or action marker: ${marker}`);
    }
  }
  if (
    migrationSource.includes('eip155:8453') ||
    migrationSource.includes("requested_action_type NOT IN ('SUPPLY', 'WITHDRAW', 'BORROW'")
  ) {
    errors.push('0033 migration widened the reviewed Ethereum/Solana SUPPLY/WITHDRAW surface');
  }

  for (const marker of [
    "const INTENT_TABLE = 'mainnet_financial_action_intents';",
    "const EVENT_TABLE = 'mainnet_financial_action_events';",
    "const EVIDENCE_TABLE = 'mainnet_financial_action_evidence_claims';",
    'owner-only;runtime-unregistered',
    'append-only;canonical-public-chain-identities',
    'global-digest-role-ownership;append-only',
    'CREATE TABLE ${INTENT_TABLE}',
    'CREATE TABLE ${EVENT_TABLE}',
    'CREATE TABLE ${EVIDENCE_TABLE}',
    'mainnet financial action history is append-only',
    'BEFORE UPDATE OR DELETE ON ${table}',
    'BEFORE TRUNCATE ON ${table}',
    'ENABLE ALWAYS TRIGGER ${table}_append_only_row',
    'ENABLE ALWAYS TRIGGER ${table}_append_only_truncate',
  ]) {
    if (!migrationSource.includes(marker)) {
      errors.push(`0033 migration lacks immutable owner-only history marker: ${marker}`);
    }
  }

  if (
    !enforceIntent?.includes("wallet_status <> 'ACTIVE'") ||
    !enforceIntent.includes("operation_state <> 'SUBMITTED'") ||
    !enforceIntent.includes('NEW.expires_at <= database_prepared_at') ||
    !prepare?.includes('INSERT INTO mainnet_financial_action_intents') ||
    !migrationSource.includes('BEFORE INSERT ON ${INTENT_TABLE}')
  ) {
    errors.push('0033 prepare path no longer requires an active wallet and unexpired intent');
  }
  if (
    !bind?.includes("wallet.status = 'ACTIVE'") ||
    !bind.includes("operation.current_state = 'SUBMITTED'") ||
    !bind.includes('database_recorded_at >= intent.expires_at') ||
    !bind.includes('requested_signed_at >= intent.expires_at')
  ) {
    errors.push('0033 bind path no longer requires an active wallet and unexpired intent');
  }

  const forbiddenPostBindGate =
    /(?:registered_wallets|yield_operations|wallet\.status|operation\.current_state|intent\.expires_at)/u;
  if (
    (broadcast !== null && forbiddenPostBindGate.test(broadcast)) ||
    (reconciliation !== null && forbiddenPostBindGate.test(reconciliation))
  ) {
    errors.push(
      '0033 post-bind evidence path can be stranded by wallet, operation, or expiry drift',
    );
  }
  if (
    !reconciliation?.includes(
      "current_event.stage NOT IN (\n          'WALLET_SIGNED_SUBMISSION_BOUND',",
    ) ||
    !reconciliation.includes(
      'evidence_floor_at := COALESCE(\n        broadcast_event.effective_at, submission_event.effective_at\n      )',
    )
  ) {
    errors.push('0033 reconciliation cannot recover directly from a signed-bound submission');
  }

  for (const marker of [
    'chain_transaction_id text',
    "intent.network_id, requested_transaction_id, 'TRANSACTION'",
    'CRYPTO_LENDING:MAINNET_ACTION:TRANSACTION_ID:FRAMED:v1',
    'wallet_signed_payload_sha256 text',
    'wallet_signature_evidence_sha256 text',
    'evidence_digest_sha256 text PRIMARY KEY',
  ]) {
    if (!migrationSource.includes(marker)) {
      errors.push(`0033 migration lacks canonical public identity or digest evidence: ${marker}`);
    }
  }
  if (
    /\b(?:wallet_)?signed_payload\s+(?:text|bytea)\b|\b(?:wallet_)?signature\s+(?:text|bytea)\b|\b(?:raw_payload|raw_signature|calldata|credentials?|endpoints?)\b/u.test(
      migrationSource,
    )
  ) {
    errors.push(
      '0033 migration persists raw signing, transaction, credential, or endpoint material',
    );
  }

  for (const marker of [
    'AND NOT may_authorize_financial_action',
    'AND NOT api_may_sign AND NOT api_may_broadcast',
    'AND NOT cross_chain_execution_allowed',
    'AND NOT automatic_resend_allowed AND NOT automatic_fee_escalation_allowed',
    'AND NOT volatile_intent_durable_replay_protection_verified',
    'AND database_replay_protection_enforced',
    'AND NOT ledger_settlement_authority',
    "signing_responsibility = 'USER_WALLET_ONLY'",
    "broadcast_responsibility = 'USER_WALLET_ONLY'",
    'REVOKE ALL PRIVILEGES ON TABLE ${table} FROM ${guardedRoles}',
    'REVOKE ALL ON FUNCTION ${functionIdentity} FROM ${guardedRoles}',
  ]) {
    if (!migrationSource.includes(marker)) {
      errors.push(`0033 migration lacks dormant authority marker: ${marker}`);
    }
  }
  if (
    migrationSource.includes('GRANT ') ||
    /\b(?:INSERT\s+INTO\s+job_outbox|sendRawTransaction|sendTransaction|eth_sendRawTransaction)\b/u.test(
      migrationSource,
    ) ||
    /\b(?:api_may_sign|api_may_broadcast|cross_chain_execution_allowed|automatic_resend_allowed|automatic_fee_escalation_allowed|ledger_settlement_authority)\s*=\s*true\b/u.test(
      migrationSource,
    )
  ) {
    errors.push('0033 migration grants or activates runtime financial-action authority');
  }

  const goldenDigests = [...migrationSource.matchAll(/\bsha256:\s*'([0-9a-f]{64})'/gu)].map(
    (match) => match[1],
  );
  if (
    !exactArray(goldenDigests, EXPECTED_FINGERPRINT_GOLDEN_SHA256) ||
    occurrences(migrationSource, 'encodedHex:') !== EXPECTED_FINGERPRINT_GOLDEN_SHA256.length ||
    !migrationSource.includes("pg_catalog.decode('434c4d41465001', 'hex')") ||
    !migrationSource.includes('pg_catalog.int2send') ||
    !migrationSource.includes('pg_catalog.int4send') ||
    migrationSource.includes('jsonb_build_array')
  ) {
    errors.push('0033 CLMA-FP-1 framing or reviewed golden vectors changed');
  }

  if (
    !migrationSpecSource.includes(
      "from './0033-create-mainnet-financial-action-lifecycle.migration'",
    ) ||
    countTests(migrationSpecSource) < 17 ||
    !migrationSpecSource.includes('encodeClmaFp1') ||
    !migrationSpecSource.includes('toHaveLength(6)') ||
    !migrationSpecSource.includes("expect(up).not.toContain('GRANT ')") ||
    !migrationSpecSource.includes("'WALLET_SIGNED_SUBMISSION_BOUND',") ||
    !migrationSpecSource.includes("wallet.status = 'ACTIVE'") ||
    !migrationSpecSource.includes("expect(reconcile).not.toContain('intent.expires_at')") ||
    !migrationSpecSource.includes('supersedesVerificationOf')
  ) {
    errors.push('0033 migration spec is weak, detached, or no longer tests the dormant boundary');
  }

  const productionMigrations = extractFrozenIdentifierArray(indexSource, 'DATABASE_MIGRATION_LIST');
  const testMigrations = extractFrozenIdentifierArray(
    indexSource,
    'DATABASE_TEST_SCHEMA_MIGRATION_LIST',
  );
  if (
    !hasExactTail(productionMigrations, EXPECTED_PRODUCTION_MIGRATION_TAIL) ||
    !hasExactTail(testMigrations, EXPECTED_TEST_MIGRATION_TAIL) ||
    productionMigrations?.filter(
      (value) => value === 'createMainnetFinancialActionLifecycleMigrationV0033',
    ).length !== 1 ||
    testMigrations?.filter(
      (value) => value === 'createMainnetFinancialActionLifecycleTestSchemaMigrationV0033',
    ).length !== 1 ||
    occurrences(
      indexSource,
      "from './0033-create-mainnet-financial-action-lifecycle.migration';",
    ) !== 2
  ) {
    errors.push(
      '0033 migration index registration, predecessor order, or export inventory changed',
    );
  }

  return errors;
}

function validateDormantDurableLifecycleSnapshot(
  durablePortSource,
  postgresAdapterSource,
  postgresAdapterSpecSource,
  postgresAdapterIntegrationSpecSource,
) {
  const errors = [];
  if (!exactArray(extractImports(durablePortSource), EXPECTED_DURABLE_PORT_IMPORTS)) {
    errors.push('dormant durable port import inventory changed');
  }
  if (!exactArray(extractImports(postgresAdapterSource), EXPECTED_POSTGRES_ADAPTER_IMPORTS)) {
    errors.push('dormant Postgres adapter import inventory changed');
  }
  if (
    !exactArray(extractImports(postgresAdapterSpecSource), EXPECTED_POSTGRES_ADAPTER_SPEC_IMPORTS)
  ) {
    errors.push('dormant Postgres adapter spec import inventory changed');
  }
  if (
    !exactArray(
      extractImports(postgresAdapterIntegrationSpecSource),
      EXPECTED_POSTGRES_ADAPTER_INTEGRATION_SPEC_IMPORTS,
    )
  ) {
    errors.push('dormant Postgres adapter integration spec import inventory changed');
  }

  if (
    hasUnsupportedExportSyntax(durablePortSource) ||
    !exactArray(extractExports(durablePortSource), EXPECTED_DURABLE_PORT_EXPORTS)
  ) {
    errors.push('dormant durable port export inventory changed');
  }
  if (
    hasUnsupportedExportSyntax(postgresAdapterSource) ||
    !exactArray(extractExports(postgresAdapterSource), EXPECTED_POSTGRES_ADAPTER_EXPORTS)
  ) {
    errors.push('dormant Postgres adapter export inventory changed');
  }
  if (
    hasUnsupportedExportSyntax(postgresAdapterSpecSource) ||
    hasUnsupportedExportSyntax(postgresAdapterIntegrationSpecSource) ||
    extractExports(postgresAdapterSpecSource).length !== 0 ||
    extractExports(postgresAdapterIntegrationSpecSource).length !== 0
  ) {
    errors.push('dormant Postgres adapter tests export runtime capabilities');
  }
  if (DURABLE_STANDALONE_RESULT_EXPORT.test(postgresAdapterSource)) {
    errors.push(
      'dormant Postgres adapter exposes a standalone raw decoder, outcome maker, or database command',
    );
  }

  const durableSources = [durablePortSource, postgresAdapterSource];
  if (durableSources.some((source) => DURABLE_SOURCE_SYMBOL_BRAND.test(source))) {
    errors.push('dormant durable lifecycle uses a reflectable Symbol cursor brand');
  }
  if (durableSources.some((source) => PROHIBITED_DURABLE_REGISTRATION.test(source))) {
    errors.push(
      'dormant durable lifecycle is registered, re-exported, dynamic, or network-capable',
    );
  }
  if (durableSources.some((source) => PROHIBITED_DURABLE_AUTHORITY.test(source))) {
    errors.push(
      'dormant durable lifecycle gained signer, provider, outbox, retry, or ledger authority',
    );
  }
  if (ACTION_LIFECYCLE_DATABASE_FUNCTION_REFERENCE.test(durablePortSource)) {
    errors.push('migration-0033 lifecycle SQL functions escaped the reviewed Postgres adapter');
  }

  if (
    !exactArray(
      extractSqlConstants(postgresAdapterSource),
      EXPECTED_POSTGRES_ADAPTER_SQL_CONSTANTS,
    ) ||
    !exactArray(
      extractSqlFunctions(postgresAdapterSource),
      EXPECTED_POSTGRES_ADAPTER_SQL_FUNCTIONS,
    ) ||
    occurrences(postgresAdapterSource, 'SELECT ${RESULT_PROJECTION}') !==
      EXPECTED_POSTGRES_ADAPTER_SQL_FUNCTIONS.length
  ) {
    errors.push('dormant Postgres adapter function-SQL allowlist changed');
  }
  const databaseExecution = extractSection(postgresAdapterSource, '  async #execute(', '  #issue(');
  if (
    databaseExecution === null ||
    occurrences(postgresAdapterSource, 'queryWithCancellation') !== 2 ||
    occurrences(postgresAdapterSource, '#databaseQuery') !== 3 ||
    occurrences(postgresAdapterSource, 'Reflect.apply(this.#databaseQuery') !== 1 ||
    occurrences(postgresAdapterSource, 'this.#execute(') !== 5 ||
    PROHIBITED_ADAPTER_DATABASE_CONTROL.test(postgresAdapterSource) ||
    /\b(?:for|while)\s*\(/u.test(databaseExecution)
  ) {
    errors.push('dormant Postgres adapter no longer performs one cancellable call without retry');
  }
  if (PROHIBITED_ADAPTER_SQL_AUTHORITY.test(postgresAdapterSource)) {
    errors.push('dormant Postgres adapter contains grant, DDL, or write-table SQL authority');
  }

  for (const marker of [
    'mayAuthorizeFinancialAction: false;',
    'readonly ledgerSettlementAuthority: false;',
    'readonly apiMaySign: false;',
    'readonly apiMayBroadcast: false;',
    'readonly mayResendTransaction: false;',
    'readonly automaticRetryAllowed: false;',
    'reviewResult(',
  ]) {
    if (!durablePortSource.includes(marker)) {
      errors.push(`dormant durable port lacks authority denial or review marker: ${marker}`);
    }
  }
  for (const marker of [
    'readonly #cursorMetadata = new WeakMap<object, CursorMetadata>();',
    'readonly #issuedResults = new WeakMap<object, IssuedResult>();',
    'readonly #requestMethods = new WeakMap<object, DatabaseMethod>();',
    "captureMethod<QueryWithCancellation>(postgres, 'queryWithCancellation')",
    'ledgerSettlementAuthority: false as const',
    "recoveryMode: 'READ_THEN_RECONCILE_ONLY' as const",
    'reviewResult(',
  ]) {
    if (!postgresAdapterSource.includes(marker)) {
      errors.push(`dormant Postgres adapter lacks exact review or database marker: ${marker}`);
    }
  }

  if (
    countDeclaredTests(postgresAdapterSpecSource) < 9 ||
    !postgresAdapterSpecSource.includes(
      "describe('PostgresDormantMainnetFinancialActionLifecycleDurableAdapter'",
    ) ||
    !postgresAdapterSpecSource.includes('Object.getOwnPropertySymbols') ||
    !postgresAdapterSpecSource.includes("Symbol.for('forged-clma-brand')") ||
    !postgresAdapterSpecSource.includes('structuredClone(prepared.result.cursor)') ||
    !postgresAdapterSpecSource.includes("outcome: 'DATABASE_OUTCOME_UNKNOWN'") ||
    !postgresAdapterSpecSource.includes('ledgerSettlementAuthority: false') ||
    !postgresAdapterSpecSource.includes('toHaveBeenCalledTimes(1)')
  ) {
    errors.push(
      'dormant Postgres adapter spec lost exact provenance, one-call, or denial coverage',
    );
  }
  if (
    countDeclaredTests(postgresAdapterIntegrationSpecSource) !== 1 ||
    !postgresAdapterIntegrationSpecSource.includes(
      "process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1'",
    ) ||
    !postgresAdapterIntegrationSpecSource.includes(
      "!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)",
    ) ||
    !postgresAdapterIntegrationSpecSource.includes('serverVersionNum < 160_000') ||
    !postgresAdapterIntegrationSpecSource.includes('serverVersionNum >= 170_000') ||
    !postgresAdapterIntegrationSpecSource.includes("({ id }) => id <= '0033'") ||
    !postgresAdapterIntegrationSpecSource.includes('await adapter.prepare(prepareRequest)') ||
    !postgresAdapterIntegrationSpecSource.includes('await adapter.bindSubmission(bindRequest)') ||
    !postgresAdapterIntegrationSpecSource.includes(
      'await adapter.recordReconciliation(reconciliationRequest)',
    ) ||
    !postgresAdapterIntegrationSpecSource.includes('await adapter.read(readRequest)') ||
    !postgresAdapterIntegrationSpecSource.includes("outcome: 'UNKNOWN'") ||
    postgresAdapterIntegrationSpecSource.includes('adapter.recordBroadcast(') ||
    occurrences(postgresAdapterIntegrationSpecSource, 'ledgerSettlementAuthority: false') < 5 ||
    !postgresAdapterIntegrationSpecSource.includes('ledger_authority_count: 0')
  ) {
    errors.push('dormant Postgres adapter integration lost loopback 0033 flow or denial coverage');
  }

  return errors;
}

function hasUnreviewedDynamicLoading(path, source) {
  if (/\b(?:require|eval|Function)\s*\(/u.test(source)) return true;
  const tokenCount = (source.match(/\bimport\s*\(/gu) ?? []).length;
  const literalImports = [...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/gu)].map(
    (match) => match[2],
  );
  const expected = REVIEWED_RUNTIME_DYNAMIC_IMPORTS.get(normalizedPath(path)) ?? [];
  return tokenCount !== literalImports.length || !exactArray(literalImports, expected);
}

export function validateDormantMainnetActionBoundarySnapshot(snapshot) {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    typeof snapshot.boundarySource !== 'string' ||
    typeof snapshot.specSource !== 'string' ||
    typeof snapshot.lifecycleSource !== 'string' ||
    typeof snapshot.lifecycleSpecSource !== 'string' ||
    typeof snapshot.durablePortSource !== 'string' ||
    typeof snapshot.postgresAdapterSource !== 'string' ||
    typeof snapshot.postgresAdapterSpecSource !== 'string' ||
    typeof snapshot.postgresAdapterIntegrationSpecSource !== 'string' ||
    typeof snapshot.migrationSource !== 'string' ||
    typeof snapshot.migrationSpecSource !== 'string' ||
    typeof snapshot.migrationIndexSource !== 'string' ||
    !(snapshot.runtimeSources instanceof Map)
  ) {
    return ['action boundary snapshot is malformed'];
  }

  const errors = [];
  const source = snapshot.boundarySource;
  const lifecycleSource = snapshot.lifecycleSource;
  const durablePortSource = snapshot.durablePortSource;
  const postgresAdapterSource = snapshot.postgresAdapterSource;
  if (
    createHash('sha256').update(source, 'utf8').digest('hex') !== REVIEWED_ACTION_BOUNDARY_SHA256
  ) {
    errors.push('action boundary bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(snapshot.specSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_BOUNDARY_SPEC_SHA256
  ) {
    errors.push('action boundary spec bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(lifecycleSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_LIFECYCLE_SHA256
  ) {
    errors.push('action lifecycle bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(snapshot.lifecycleSpecSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_LIFECYCLE_SPEC_SHA256
  ) {
    errors.push('action lifecycle spec bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(durablePortSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_LIFECYCLE_DURABLE_PORT_SHA256
  ) {
    errors.push('dormant durable port bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(postgresAdapterSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SHA256
  ) {
    errors.push('dormant Postgres adapter bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(snapshot.postgresAdapterSpecSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_SHA256
  ) {
    errors.push('dormant Postgres adapter spec bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256')
      .update(snapshot.postgresAdapterIntegrationSpecSource, 'utf8')
      .digest('hex') !== REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_SHA256
  ) {
    errors.push('dormant Postgres adapter integration spec bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(snapshot.migrationSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256
  ) {
    errors.push('0033 action lifecycle migration bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(snapshot.migrationSpecSource, 'utf8').digest('hex') !==
    REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256
  ) {
    errors.push('0033 action lifecycle migration spec bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256').update(snapshot.migrationIndexSource, 'utf8').digest('hex') !==
    REVIEWED_DATABASE_MIGRATION_INDEX_SHA256
  ) {
    errors.push('database migration index bytes drifted from the reviewed 0033 registration');
  }
  errors.push(
    ...validateDormantActionMigrationSnapshot(
      snapshot.migrationSource,
      snapshot.migrationSpecSource,
      snapshot.migrationIndexSource,
    ),
  );
  errors.push(
    ...validateDormantDurableLifecycleSnapshot(
      durablePortSource,
      postgresAdapterSource,
      snapshot.postgresAdapterSpecSource,
      snapshot.postgresAdapterIntegrationSpecSource,
    ),
  );
  if (!exactArray(extractActions(source), EXPECTED_ACTIONS)) {
    errors.push('action boundary must contain exactly the four reviewed lending actions');
  }
  if (!exactArray(extractProviderCandidates(source), EXPECTED_PROVIDER_CANDIDATES)) {
    errors.push('action boundary provider, protocol, chain, or ordering identity drifted');
  }
  if (!exactArray(extractImports(source), EXPECTED_IMPORTS)) {
    errors.push('action boundary import set drifted from the reviewed pure-domain dependencies');
  }
  if (
    (source.match(/export const DORMANT_MAINNET_FINANCIAL_ACTION_POLICY\b/gu) ?? []).length !== 1
  ) {
    errors.push('action boundary must export exactly one fixed dormant policy');
  }
  for (const marker of REQUIRED_CLOSED_MARKERS) {
    if (!source.includes(marker))
      errors.push(`action boundary is missing closed marker: ${marker}`);
  }
  for (const marker of [
    'mayAuthorizeFinancialAction: false as const',
    'apiMaySign: false as const',
    'apiMayBroadcast: false as const',
    'automaticResendAllowed: false as const',
    'automaticFeeEscalationAllowed: false as const',
  ]) {
    if (
      (source.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')) ?? [])
        .length < 2
    ) {
      errors.push(`action boundary lacks repeated intent and policy denial marker: ${marker}`);
    }
  }
  if (UNSAFE_CAPABILITY.test(source)) {
    errors.push('action boundary enables a prohibited financial, signing, or broadcast capability');
  }
  if (PROHIBITED_BOUNDARY_SOURCE.test(source)) {
    errors.push(
      'action boundary contains runtime registration, I/O, dynamic code, or transaction logic',
    );
  }
  if (!exactArray(extractImports(lifecycleSource), EXPECTED_LIFECYCLE_IMPORTS)) {
    errors.push('action lifecycle import set drifted from the reviewed pure-domain dependencies');
  }
  for (const marker of REQUIRED_LIFECYCLE_CLOSED_MARKERS) {
    if (!lifecycleSource.includes(marker)) {
      errors.push(`action lifecycle is missing closed marker: ${marker}`);
    }
  }
  if (UNSAFE_CAPABILITY.test(lifecycleSource)) {
    errors.push(
      'action lifecycle enables a prohibited financial, signing, or broadcast capability',
    );
  }
  if (PROHIBITED_BOUNDARY_SOURCE.test(lifecycleSource)) {
    errors.push(
      'action lifecycle contains runtime registration, I/O, dynamic code, or transaction logic',
    );
  }
  if (
    !snapshot.specSource.includes(`./${BOUNDARY_IMPORT_STEM}`) ||
    countTests(snapshot.specSource) < 15 ||
    !snapshot.specSource.includes('new Proxy') ||
    !snapshot.specSource.includes("decision: 'DENY'")
  ) {
    errors.push('action boundary spec is not exact, adversarial, and denial-bound');
  }
  if (
    !snapshot.lifecycleSpecSource.includes(`./${LIFECYCLE_IMPORT_STEM}`) ||
    countTests(snapshot.lifecycleSpecSource) < 9 ||
    !snapshot.lifecycleSpecSource.includes('new Proxy') ||
    !snapshot.lifecycleSpecSource.includes("operationalMode: 'DORMANT'") ||
    !snapshot.lifecycleSpecSource.includes('executionAuthority: false') ||
    !snapshot.lifecycleSpecSource.includes('persistenceAuthority: false')
  ) {
    errors.push('action lifecycle spec is not exact, adversarial, and authority-closed');
  }

  for (const [path, runtimeSource] of snapshot.runtimeSources) {
    if (typeof path !== 'string' || typeof runtimeSource !== 'string') {
      errors.push('action boundary runtime source inventory is malformed');
    } else if (normalizedPath(path) === PROHIBITED_ACTION_LIFECYCLE_DATABASE_CODEC_PATH) {
      errors.push('standalone dormant lifecycle database codec must remain absent');
    } else if (REVIEWED_DORMANT_SOURCE_PATHS.has(normalizedPath(path))) {
      errors.push('reviewed dormant action source was incorrectly included in runtime consumers');
    } else if (hasUnreviewedDynamicLoading(path, runtimeSource)) {
      errors.push(`runtime source contains unreviewed dynamic loading: ${path}`);
    } else if (ACTION_LIFECYCLE_DATABASE_FUNCTION_REFERENCE.test(runtimeSource)) {
      errors.push(
        `migration-0033 lifecycle SQL function is referenced outside the reviewed adapter by runtime source ${path}`,
      );
    } else if (RUNTIME_REFERENCE.test(runtimeSource)) {
      errors.push(`dormant mainnet action boundary is referenced by runtime source ${path}`);
    } else if (
      normalizedPath(path) !== DATABASE_MIGRATION_INDEX_PATH &&
      ACTION_LIFECYCLE_MIGRATION_REFERENCE.test(runtimeSource)
    ) {
      errors.push(`0033 dormant action persistence is referenced by runtime source ${path}`);
    }
  }
  return [...new Set(errors)];
}

function repositoryFile(repositoryRoot, path) {
  try {
    const root = realpathSync.native(resolve(repositoryRoot));
    const resolved = resolve(root, path);
    const relation = relative(root, resolved);
    if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`)) {
      throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
    }
    const bytes = readSecureLocalFile(resolved, MAX_ACTION_BOUNDARY_FILE_BYTES);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
  }
}

function runtimeSourcePaths(repositoryRoot) {
  const sourceRoot = resolve(repositoryRoot, API_SOURCE_ROOT);
  const paths = [];
  let directories = 0;
  let entries = 0;
  const visit = (directory, depth) => {
    directories += 1;
    if (
      directories > MAX_ACTION_BOUNDARY_RUNTIME_DIRECTORIES ||
      depth > MAX_ACTION_BOUNDARY_RUNTIME_DEPTH
    ) {
      throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
    }
    const handle = opendirSync(directory);
    try {
      for (;;) {
        const entry = handle.readSync();
        if (entry === null) break;
        entries += 1;
        if (entries > MAX_ACTION_BOUNDARY_RUNTIME_ENTRIES) {
          throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
        }
        const absolute = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
        if (entry.isDirectory()) {
          visit(absolute, depth + 1);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          const path = normalizedPath(relative(repositoryRoot, absolute));
          if (!REVIEWED_DORMANT_SOURCE_PATHS.has(path)) paths.push(path);
          if (paths.length > MAX_ACTION_BOUNDARY_RUNTIME_FILES) {
            throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
          }
        }
      }
    } finally {
      handle.closeSync();
    }
  };
  visit(sourceRoot, 0);
  return paths.sort();
}

export function loadDormantMainnetActionBoundarySnapshot(repositoryRoot = REPOSITORY_ROOT) {
  try {
    const runtimeSources = new Map();
    let runtimeBytes = 0;
    for (const path of runtimeSourcePaths(repositoryRoot)) {
      const source = repositoryFile(repositoryRoot, path);
      runtimeBytes += Buffer.byteLength(source, 'utf8');
      if (runtimeBytes > MAX_ACTION_BOUNDARY_RUNTIME_BYTES) {
        throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
      }
      runtimeSources.set(path, source);
    }
    return {
      boundarySource: repositoryFile(repositoryRoot, ACTION_BOUNDARY_PATH),
      specSource: repositoryFile(repositoryRoot, ACTION_BOUNDARY_SPEC_PATH),
      lifecycleSource: repositoryFile(repositoryRoot, ACTION_LIFECYCLE_PATH),
      lifecycleSpecSource: repositoryFile(repositoryRoot, ACTION_LIFECYCLE_SPEC_PATH),
      durablePortSource: repositoryFile(repositoryRoot, ACTION_LIFECYCLE_DURABLE_PORT_PATH),
      postgresAdapterSource: repositoryFile(repositoryRoot, ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH),
      postgresAdapterSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_PATH,
      ),
      postgresAdapterIntegrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_PATH,
      ),
      migrationSource: repositoryFile(repositoryRoot, ACTION_LIFECYCLE_MIGRATION_PATH),
      migrationSpecSource: repositoryFile(repositoryRoot, ACTION_LIFECYCLE_MIGRATION_SPEC_PATH),
      migrationIndexSource: repositoryFile(repositoryRoot, DATABASE_MIGRATION_INDEX_PATH),
      runtimeSources,
    };
  } catch {
    throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
  }
}

export function validateDormantMainnetActionBoundaryFiles(repositoryRoot = REPOSITORY_ROOT) {
  try {
    return validateDormantMainnetActionBoundarySnapshot(
      loadDormantMainnetActionBoundarySnapshot(repositoryRoot),
    );
  } catch {
    return [ACTION_BOUNDARY_INPUT_ERROR];
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const errors = validateDormantMainnetActionBoundaryFiles();
  if (errors.length === 0) {
    console.log(
      'Dormant mainnet action boundary is valid: 10 candidates, 0 enabled, owner-only 0033 persistence, unregistered durable adapter',
    );
  } else {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}
