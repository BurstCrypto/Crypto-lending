import { createHash } from 'node:crypto';
import { lstatSync, opendirSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';
import { RECOVERY_SCHEDULER_ARTIFACT_SHA256 } from './dormant-mainnet-action-recovery-inventory.mjs';

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
export const ACTION_WALLET_IDENTITY_BINDING_MIGRATION_PATH =
  'apps/api/src/infrastructure/database/migrations/0034-bind-mainnet-financial-action-wallet-identity.migration.ts';
export const ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_PATH =
  'apps/api/src/infrastructure/database/migrations/0034-bind-mainnet-financial-action-wallet-identity.migration.spec.ts';
export const ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_PATH =
  'apps/api/test/infrastructure/mainnet-financial-action-wallet-identity-binding.integration-spec.ts';
export const ACTION_FINALITY_EVIDENCE_SOURCE_PORT_PATH =
  'apps/api/src/mainnet-actions/application/ports/mainnet-financial-action-finality-evidence-source.port.ts';
export const ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_PATH =
  'apps/api/src/mainnet-actions/application/ports/mainnet-financial-action-finality-evidence-source.port.spec.ts';
export const ACTION_FINALITY_EVIDENCE_PRODUCER_PATH =
  'apps/api/src/mainnet-actions/application/dormant-mainnet-financial-action-finality-evidence.producer.ts';
export const ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_PATH =
  'apps/api/src/mainnet-actions/application/dormant-mainnet-financial-action-finality-evidence.producer.spec.ts';
export const ACTION_FINALITY_SIDECAR_DURABLE_PORT_PATH =
  'apps/api/src/mainnet-actions/application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port.ts';
export const ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_PATH =
  'apps/api/src/mainnet-actions/application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port.spec.ts';
export const ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_PATH =
  'apps/api/src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-finality-sidecar.adapter.ts';
export const ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_PATH =
  'apps/api/src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-finality-sidecar.adapter.spec.ts';
export const ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_PATH =
  'apps/api/src/mainnet-actions/application/ports/mainnet-financial-action-finality-prerequisite-issuer.port.ts';
export const ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_PATH =
  'apps/api/src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter.ts';
export const ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_PATH =
  'apps/api/src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter.spec.ts';
export const ACTION_FINALITY_WALLET_READER_PATH =
  'apps/api/src/mainnet-actions/infrastructure/wallet-registration-mainnet-financial-action-finality-wallet.reader.ts';
export const ACTION_FINALITY_WALLET_READER_SPEC_PATH =
  'apps/api/src/mainnet-actions/infrastructure/wallet-registration-mainnet-financial-action-finality-wallet.reader.spec.ts';
export const ACTION_AUTHENTICATED_FINALITY_MIGRATION_PATH =
  'apps/api/src/infrastructure/database/migrations/0035-create-mainnet-financial-action-authenticated-finality.migration.ts';
export const ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_PATH =
  'apps/api/src/infrastructure/database/migrations/0035-create-mainnet-financial-action-authenticated-finality.migration.spec.ts';
export const ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH =
  'apps/api/test/infrastructure/mainnet-financial-action-authenticated-finality.integration-spec.ts';
export const ACTION_FINALITY_PREREQUISITE_MIGRATION_PATH =
  'apps/api/src/infrastructure/database/migrations/0036-read-mainnet-financial-action-finality-prerequisite.migration.ts';
export const ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_PATH =
  'apps/api/src/infrastructure/database/migrations/0036-read-mainnet-financial-action-finality-prerequisite.migration.spec.ts';
export const ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_PATH =
  'apps/api/test/infrastructure/mainnet-financial-action-finality-prerequisite-read.integration-spec.ts';
export const ACTION_ATOMIC_FINALITY_MIGRATION_PATH =
  'apps/api/src/infrastructure/database/migrations/0037-atomically-persist-mainnet-financial-action-finality.migration.ts';
export const ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_PATH =
  'apps/api/src/infrastructure/database/migrations/0037-atomically-persist-mainnet-financial-action-finality.migration.spec.ts';
export const ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH =
  'apps/api/test/infrastructure/mainnet-financial-action-atomic-finality-persistence.integration-spec.ts';
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
  'aca652cb9770cdfafddf886fb14b52cbc216c4ce8c9041c64577c83df1490142';
export const REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SHA256 =
  'b2a21481711153b4dd9482d18a0f9a0a1b391c142772f558523545e9fcd73c66';
export const REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_SPEC_SHA256 =
  '089acbe297762e20d5a3ee065d36642dd802f7997660fe2340203de6b23d84e1';
export const REVIEWED_ACTION_LIFECYCLE_POSTGRES_ADAPTER_INTEGRATION_SPEC_SHA256 =
  'a3d584df8529a6f15480d0cc469576236825ea26ba436eea8c632619d8854f0e';
export const REVIEWED_ACTION_LIFECYCLE_MIGRATION_SHA256 =
  'c3840f3b3cd7de0e7dbf159c335fbe0784e55e81c936defdf618c9b0092ffa27';
export const REVIEWED_ACTION_LIFECYCLE_MIGRATION_SPEC_SHA256 =
  'c14640d07c43ec41e5cda394f1f1c1cfccb5cb227541fce55a230cc7a94545e9';
export const REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SHA256 =
  '11fd11a882e81f417d0efdfbbb7da3c8bed0171ed9aec420068772e8c56a75a7';
export const REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_SHA256 =
  '389e1b6c28265e841ec9b3afcce9f80bd103fe5cc630592b974632058fcc4c74';
export const REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_SHA256 =
  '7aa0e97a3563468bd1c520a80876ee0f7c12939f13b3a8021d9e6bb44b49d31b';
export const REVIEWED_DATABASE_MIGRATION_INDEX_SHA256 =
  '7957f7a45a3d1ff26bff668a8a84634855e526c7122df0c7b7e8ec0b0f3ffc6a';
export const REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SHA256 =
  '27e42722799ec5e39d93b8ad010866f3dfec780d5d0511641faf2558633b3fa0';
export const REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_SHA256 =
  'c5f845ad069803571e863b1c27000e297c027954cab38ceea09163d03dc47d73';
export const REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SHA256 =
  '2bb77f9ed9533cffedff794c7c8b58523d38b89b1afad6115fc342285a05560e';
export const REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_SHA256 =
  'd3743b2eb3aea2a855b95f1ac9534612c6aa37e46a7fde318c9dc0df4908e3c5';
export const REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SHA256 =
  'aa54e9037fe7463fe00bbaf7d4caca19d698c2b5ac54e67a236202a24f0deebc';
export const REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_SHA256 =
  'aff0a8af77d2f8d2f3234a4baf1be1b18dbd325d36fd8949789830afed91a909';
export const REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SHA256 =
  'b62790bf0ed61360257f9a30f315c9a244c7009ad88abef8afd9620559690c8d';
export const REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_SHA256 =
  '42994e98702034cb4844e8da552fd892f0f19c9fc86cfd5c5c6f8f3fc23fd139';
export const REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SHA256 =
  'f0420669c0fcac4dcba8795851016bd8cc008bff4a56ab39d022ed0da3d110bd';
export const REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_SHA256 =
  'db27ef0514437f58d6ddea8085f642103d809a0e557cb2653a8ceb58f60bdde2';
export const REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256 =
  'f49767540e5cc352473fd0a8c595d351eb5688c02410a932bf17e263acb75673';
export const REVIEWED_ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_SHA256 =
  'f4ab74832dd8ff63608989129c728a0f66d789fdc784338f5661e72a6acefdda';
export const REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SHA256 =
  'ba81fa57285644e5976094b5bf831486a5aaa276a318452db9c5e4b240fa98e1';
export const REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_SHA256 =
  '9224299e2df17f177ec6a1f6b46898a4fcff21464a69aad2af2255713b182f63';
export const REVIEWED_ACTION_FINALITY_WALLET_READER_SHA256 =
  'e0e03424b4f8e4735541c3d0649cda89c3d0d7abccef8e6eb1298cda07bc73a8';
export const REVIEWED_ACTION_FINALITY_WALLET_READER_SPEC_SHA256 =
  'c72cc2b093fc3bbeb8f5fbcfd88c270e57db7617e6c4f85afe8a11c504a4349b';
export const REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SHA256 =
  'ee6fb9a68cb3766a5a146ee9a435895ce13c5645976a4a0df9761c88e3c91bcb';
export const REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_SHA256 =
  'e94876618f421970d26e8385a292e42f1924529b93dc00574144e416a2488391';
export const REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_SHA256 =
  'c2f93d2974e5ffd81ac7894798edd4dc5af77f73ae14d4ed3d9df3617af1d073';
export const REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SHA256 =
  '174ac457309a3ef938c72f93ba2158b7e3887ac40560db0fa92a5bba5e4e439c';
export const REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_SHA256 =
  'fbaf4c633c1a66f9248a5566bbafa0184a47f533f39764d55ea740ae86fbb326';
export const REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256 =
  '5a572918e6c0802852760a4235e9476f792a47f1c9d046fd5bccfa335dde66c6';
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
  '../../wallets/infrastructure/crypto/wallet-registration-crypto',
  '../domain/dormant-mainnet-financial-action',
  '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
  '../application/ports/dormant-mainnet-financial-action-signed-submission-verifier.port',
  '../application/ports/dormant-mainnet-financial-action-verified-submission-binder.port',
  '../domain/mainnet-financial-action-signed-verification-digest',
  './mainnet-financial-action-write-manifest',
]);
const EXPECTED_POSTGRES_ADAPTER_SPEC_IMPORTS = Object.freeze([
  '../../blockchain/domain/supported-asset-registry',
  '../../infrastructure/database/postgres.service',
  '../../wallets/infrastructure/crypto/wallet-registration-crypto',
  '../domain/dormant-mainnet-financial-action',
  '../domain/mainnet-financial-action-signed-verification-digest',
  '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
  '../application/ports/dormant-mainnet-financial-action-signed-submission-verifier.port',
  '../application/ports/dormant-mainnet-financial-action-verified-submission-binder.port',
  './mainnet-financial-action-write-manifest',
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
  '../../src/wallets/infrastructure/crypto/wallet-registration-crypto',
]);
const EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_IMPORTS = Object.freeze([
  'node:crypto',
  './0028-suspend-generic-worker-balance-authority.migration',
  './0033-create-mainnet-financial-action-lifecycle.migration',
  './migration',
]);
const EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_IMPORTS = Object.freeze([
  './0028-suspend-generic-worker-balance-authority.migration',
  './0033-create-mainnet-financial-action-lifecycle.migration',
  './0034-bind-mainnet-financial-action-wallet-identity.migration',
  './index',
]);
const EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_IMPORTS = Object.freeze([
  'node:crypto',
  'pg',
  'pg',
  '../../src/blockchain/domain/supported-asset-registry',
  '../../src/infrastructure/database/migration-runner.service',
  '../../src/infrastructure/database/migrations',
  '../../src/wallets/infrastructure/crypto/wallet-registration-crypto',
]);
const EXPECTED_FINALITY_EVIDENCE_SOURCE_PORT_IMPORTS = Object.freeze([
  '../../../blockchain/domain/mainnet-launch-network-policy',
  '../../../blockchain/domain/supported-asset-registry',
  '../../../mainnet-platforms/domain/mainnet-provider-position-observation-policy',
  '../../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment',
  '../../../wallets/domain/wallet-identity',
  '../../domain/dormant-mainnet-financial-action',
  './dormant-mainnet-financial-action-lifecycle-durable.port',
]);
const EXPECTED_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_IMPORTS = Object.freeze([
  './mainnet-financial-action-finality-evidence-source.port',
  './mainnet-financial-action-finality-evidence-source.port',
  '../../../wallets/domain/wallet-identity',
]);
const EXPECTED_FINALITY_EVIDENCE_PRODUCER_IMPORTS = Object.freeze([
  'node:crypto',
  'node:util/types',
  '../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment',
  '../../mainnet-platforms/domain/mainnet-provider-position-observation-policy',
  '../../blockchain/domain/supported-asset-registry',
  '../../wallets/domain/wallet-identity',
  '../domain/dormant-mainnet-financial-action',
  './ports/dormant-mainnet-financial-action-lifecycle-durable.port',
  './ports/mainnet-financial-action-finality-evidence-source.port',
]);
const EXPECTED_FINALITY_EVIDENCE_PRODUCER_SPEC_IMPORTS = Object.freeze([
  './dormant-mainnet-financial-action-finality-evidence.producer',
  './dormant-mainnet-financial-action-finality-evidence.producer',
  '../../blockchain/domain/supported-asset-registry',
  './ports/mainnet-financial-action-finality-evidence-source.port',
]);
const EXPECTED_FINALITY_SIDECAR_PORT_IMPORTS = Object.freeze([
  '../dormant-mainnet-financial-action-finality-evidence.producer',
  './dormant-mainnet-financial-action-lifecycle-durable.port',
]);
const EXPECTED_FINALITY_SIDECAR_PORT_SPEC_IMPORTS = Object.freeze([
  '../dormant-mainnet-financial-action-finality-evidence.producer',
  './dormant-mainnet-financial-action-finality-sidecar-durable.port',
]);
const EXPECTED_FINALITY_SIDECAR_ADAPTER_IMPORTS = Object.freeze([
  'node:util/types',
  '../../infrastructure/database/postgres.service',
  '../application/dormant-mainnet-financial-action-finality-evidence.producer',
  '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port',
  '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
]);
const EXPECTED_FINALITY_SIDECAR_ADAPTER_SPEC_IMPORTS = Object.freeze([
  '../../infrastructure/database/postgres.service',
  '../../blockchain/domain/supported-asset-registry',
  '../application/dormant-mainnet-financial-action-finality-evidence.producer',
  '../application/ports/mainnet-financial-action-finality-evidence-source.port',
  '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port',
  './postgres-dormant-mainnet-financial-action-finality-sidecar.adapter',
]);
const EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_IMPORTS = Object.freeze([
  'node:crypto',
  './0028-suspend-generic-worker-balance-authority.migration',
  './0034-bind-mainnet-financial-action-wallet-identity.migration',
  './migration',
]);
const EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_SPEC_IMPORTS = Object.freeze([
  './0028-suspend-generic-worker-balance-authority.migration',
  './0035-create-mainnet-financial-action-authenticated-finality.migration',
  './index',
]);
const EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_IMPORTS = Object.freeze([
  'node:crypto',
  'pg',
  'pg',
  '../../src/blockchain/domain/supported-asset-registry',
  '../../src/infrastructure/database/migration-runner.service',
  '../../src/infrastructure/database/migrations',
  '../../src/wallets/infrastructure/crypto/wallet-registration-crypto',
]);
const EXPECTED_FINALITY_PREREQUISITE_ISSUER_PORT_IMPORTS = Object.freeze([
  '../../../blockchain/domain/mainnet-launch-network-policy',
  '../../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port',
  '../../../wallets/domain/wallet-identity',
  '../dormant-mainnet-financial-action-finality-evidence.producer',
  './dormant-mainnet-financial-action-lifecycle-durable.port',
  './dormant-mainnet-financial-action-finality-sidecar-durable.port',
]);
const EXPECTED_FINALITY_PREREQUISITE_ADAPTER_IMPORTS = Object.freeze([
  'node:util/types',
  '../../blockchain/domain/supported-asset-registry',
  '../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port',
  '../../mainnet-platforms/application/dormant-provider-position-chain-anchor-evidence.producer',
  '../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment',
  '../../mainnet-platforms/domain/mainnet-provider-position-observation-policy',
  '../../infrastructure/database/postgres.service',
  '../../wallets/domain/wallet-identity',
  '../application/dormant-mainnet-financial-action-finality-evidence.producer',
  '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
  '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port',
  '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port',
  '../domain/dormant-mainnet-financial-action',
]);
const EXPECTED_FINALITY_PREREQUISITE_ADAPTER_SPEC_IMPORTS = Object.freeze([
  '../../blockchain/domain/supported-asset-registry',
  '../../mainnet-platforms/application/dormant-provider-position-chain-anchor-evidence.producer',
  '../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port',
  '../../infrastructure/database/postgres.service',
  '../../wallets/domain/wallet-identity',
  '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port',
  '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port',
  '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port',
  './postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter',
  './postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter',
]);
const EXPECTED_FINALITY_WALLET_READER_IMPORTS = Object.freeze([
  'node:util/types',
  '../../accounts/domain/account-profile',
  '../../wallets/application/wallet-registration.service',
  '../../wallets/domain/wallet-identity',
  '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port',
]);
const EXPECTED_FINALITY_WALLET_READER_SPEC_IMPORTS = Object.freeze([
  'node:buffer',
  '../../accounts/domain/account-profile',
  '../../blockchain/domain/supported-asset-registry',
  '../../wallets/application/ports/wallet-registration-repository.port',
  '../../wallets/application/wallet-registration.service',
  '../../wallets/domain/wallet-identity',
  '../../wallets/domain/wallet-ownership-proof',
  '../../wallets/infrastructure/config/wallet-registration.config',
  '../../wallets/infrastructure/crypto/wallet-registration-crypto',
  '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port',
  './wallet-registration-mainnet-financial-action-finality-wallet.reader',
]);
const EXPECTED_FINALITY_PREREQUISITE_MIGRATION_IMPORTS = Object.freeze([
  'node:crypto',
  './0028-suspend-generic-worker-balance-authority.migration',
  './0035-create-mainnet-financial-action-authenticated-finality.migration',
  './migration',
]);
const EXPECTED_FINALITY_PREREQUISITE_MIGRATION_SPEC_IMPORTS = Object.freeze([
  './0028-suspend-generic-worker-balance-authority.migration',
  './0036-read-mainnet-financial-action-finality-prerequisite.migration',
  './index',
]);
const EXPECTED_ATOMIC_FINALITY_MIGRATION_IMPORTS = Object.freeze([
  'node:crypto',
  './0028-suspend-generic-worker-balance-authority.migration',
  './0036-read-mainnet-financial-action-finality-prerequisite.migration',
  './migration',
]);
const EXPECTED_ATOMIC_FINALITY_MIGRATION_SPEC_IMPORTS = Object.freeze([
  './0028-suspend-generic-worker-balance-authority.migration',
  './0037-atomically-persist-mainnet-financial-action-finality.migration',
  './index',
]);
const EXPECTED_FINALITY_READ_INTEGRATION_SPEC_IMPORTS = Object.freeze([
  'node:crypto',
  'pg',
  'pg',
  '../../src/blockchain/domain/supported-asset-registry',
  '../../src/infrastructure/database/migration-runner.service',
  '../../src/infrastructure/database/migrations',
  '../../src/wallets/infrastructure/crypto/wallet-registration-crypto',
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
  'DormantMainnetNonterminalReconciliationDatabaseOutcome',
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
const EXPECTED_FINALITY_EVIDENCE_SOURCE_PORT_EXPORTS = Object.freeze([
  'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION',
  'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_READ_USE',
  'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE',
  'MainnetFinancialActionFinalityEvidenceNetworkId',
  'ReadMainnetFinancialActionReconciliationEvidenceSourceRequestV1',
  'ReadMainnetFinancialActionPostFinalityEvidenceSourceRequestV1',
  'ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1',
  'MainnetFinancialActionReconciliationEvidenceSourceAttestationV1',
  'MainnetFinancialActionPostFinalityEvidenceSourceAttestationV1',
  'MainnetFinancialActionFinalityEvidenceSourceAttestationV1',
  'MainnetFinancialActionFinalityEvidenceSourcePort',
]);
const EXPECTED_FINALITY_EVIDENCE_PRODUCER_EXPORTS = Object.freeze([
  'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION',
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE',
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE',
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_ADMISSION_CANDIDATE_USE',
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE',
  'MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION',
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE',
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE',
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE',
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE',
  'MainnetFinancialActionPostFinalityDisposition',
  'MainnetFinancialActionPostFinalityLineageStatus',
  'MainnetFinancialActionEffectiveSafetyState',
  'MainnetFinancialActionReconciliationEvidencePrerequisiteV1',
  'MainnetFinancialActionPostFinalityEvidencePrerequisiteV1',
  'MainnetFinancialActionFinalityEvidencePrerequisitePort',
  'ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1',
  'ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1',
  'MainnetFinancialActionFinalityEvidenceSourceBindingV1',
  'MainnetFinancialActionFinalityEvidenceProducerClock',
  'ProduceMainnetFinancialActionReconciliationEvidenceRequestV1',
  'ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1',
  'MainnetFinancialActionReconciliationAdmissionArgumentsV1',
  'MainnetFinancialActionPostFinalityReviewArgumentsV1',
  'MainnetFinancialActionReconciliationAdmissionCandidateV1',
  'MainnetFinancialActionPostFinalityReviewCandidateV1',
  'MainnetFinancialActionFinalityEvidenceProducerFailureCode',
  'DormantMainnetFinancialActionFinalityEvidenceUnavailableError',
  'DormantMainnetFinancialActionFinalityEvidenceProducer',
]);
const EXPECTED_FINALITY_SIDECAR_PORT_EXPORTS = Object.freeze([
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION',
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE',
  'MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING',
  'DormantMainnetFinancialActionFinalitySidecarOperation',
  'MainnetFinancialActionPostFinalityDisposition',
  'MainnetFinancialActionEffectiveSafetyState',
  'DormantMainnetFinancialActionEffectiveSafetyCursorV1',
  'RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1',
  'ReadMainnetFinancialActionEffectiveSafetyStateRequestV1',
  'RecordMainnetFinancialActionPostFinalityReviewRequestV1',
  'DormantMainnetFinancialActionFinalitySidecarRequestV1',
  'DormantMainnetFinancialActionFinalityPersistenceRequestV1',
  'DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1',
  'DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1',
  'DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1',
  'DormantMainnetFinancialActionFinalitySidecarResultV1',
  'DormantMainnetFinancialActionEffectiveSafetyReaderPort',
  'DormantMainnetFinancialActionFinalityPersistencePort',
]);
const EXPECTED_FINALITY_SIDECAR_ADAPTER_EXPORTS = Object.freeze([
  'DormantMainnetFinancialActionFinalitySidecarUnavailableError',
  'DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE',
  'PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter',
]);
const EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_EXPORTS = Object.freeze([
  'createMainnetFinancialActionAuthenticatedFinalityMigration',
  'createMainnetFinancialActionAuthenticatedFinalityMigrationV0035',
  'createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035',
]);
const EXPECTED_FINALITY_PREREQUISITE_ISSUER_PORT_EXPORTS = Object.freeze([
  'MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION',
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_USE',
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE',
  'MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUANCE_USE',
  'MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION',
  'MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE',
  'MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE',
  'IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1',
  'IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1',
  'IssueMainnetFinancialActionFinalityPrerequisiteRequestV1',
  'MainnetFinancialActionReconciliationPrerequisiteIssuanceV1',
  'MainnetFinancialActionPostFinalityPrerequisiteIssuanceV1',
  'MainnetFinancialActionFinalityPrerequisiteIssuanceV1',
  'ReadMainnetFinancialActionFinalityWalletRequestV2',
  'MainnetFinancialActionFinalityWalletResultV2',
  'MainnetFinancialActionFinalityWalletReaderPort',
  'MainnetFinancialActionFinalityPrerequisiteIssuerClock',
  'MainnetFinancialActionFinalityPrerequisiteIssuerPort',
  'MainnetFinancialActionFinalityPrerequisiteIssuerDependencies',
]);
const EXPECTED_FINALITY_PREREQUISITE_ADAPTER_EXPORTS = Object.freeze([
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_DATABASE_FUNCTION',
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_DATABASE_FUNCTION',
  'MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS',
  'MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_READ_SQL',
  'MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_READ_SQL',
  'MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode',
  'DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError',
  'PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter',
]);
const EXPECTED_FINALITY_WALLET_READER_EXPORTS = Object.freeze([
  'MainnetFinancialActionFinalityWalletReaderFailureCode',
  'DormantMainnetFinancialActionFinalityWalletUnavailableError',
  'WalletRegistrationMainnetFinancialActionFinalityWalletReader',
]);
const EXPECTED_FINALITY_PREREQUISITE_MIGRATION_EXPORTS = Object.freeze([
  'createMainnetFinancialActionFinalityPrerequisiteReadMigration',
  'createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036',
  'createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036',
]);
const EXPECTED_ATOMIC_FINALITY_MIGRATION_EXPORTS = Object.freeze([
  'createMainnetFinancialActionAtomicFinalityPersistenceMigration',
  'createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037',
  'createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037',
]);
const EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_EXPORTS = Object.freeze([
  'createMainnetFinancialActionWalletIdentityBindingMigration',
  'createMainnetFinancialActionWalletIdentityBindingMigrationV0034',
  'createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034',
]);
const EXPECTED_POSTGRES_ADAPTER_SQL_CONSTANTS = Object.freeze([
  'PREPARE_SQL',
  'BIND_SUBMISSION_SQL',
  'BIND_VERIFIED_SUBMISSION_SQL',
  'RECORD_BROADCAST_SQL',
  'RECORD_RECONCILIATION_SQL',
  'READ_SQL',
]);
const EXPECTED_POSTGRES_ADAPTER_SQL_FUNCTIONS = Object.freeze([
  'prepare_mainnet_financial_action_lifecycle_v2',
  'bind_mainnet_financial_action_submission',
  'bind_verified_mainnet_financial_action_submission_v2',
  'record_mainnet_financial_action_broadcast_observation',
  'record_mainnet_financial_action_reconciliation_observation',
  'read_mainnet_financial_action_lifecycle',
]);
const EXPECTED_FINALITY_SIDECAR_SQL_CONSTANTS = Object.freeze([
  'ADMISSION_SQL',
  'POST_FINALITY_SQL',
  'READ_EFFECTIVE_SAFETY_SQL',
]);
const EXPECTED_FINALITY_SIDECAR_SQL_FUNCTIONS = Object.freeze([
  'record_authenticated_mainnet_financial_action_reconciliation_v3',
  'record_mainnet_financial_action_post_finality_review_v3',
  'read_mainnet_financial_action_effective_safety_state_v1',
]);
const EXPECTED_AUTHENTICATED_FINALITY_TABLES = Object.freeze([
  Object.freeze([
    'SOURCE_AUTHORITY_TABLE',
    'mainnet_financial_action_reconciliation_source_authorities',
  ]),
  Object.freeze([
    'DEPLOYMENT_AUTHORITY_TABLE',
    'mainnet_financial_action_reconciliation_deployment_authorities',
  ]),
  Object.freeze([
    'AUTHORITY_CONTROL_TABLE',
    'mainnet_financial_action_reconciliation_authority_controls',
  ]),
  Object.freeze(['ADMISSION_TABLE', 'mainnet_financial_action_reconciliation_admissions']),
  Object.freeze(['REVIEW_TABLE', 'mainnet_financial_action_post_finality_reviews']),
]);
const EXPECTED_AUTHENTICATED_FINALITY_UP_FUNCTION_IDENTIFIERS = Object.freeze([
  'FINALITY_FINGERPRINT_BYTES',
  'FINALITY_FINGERPRINT',
  'HISTORY_GUARD',
  'ADMISSION_GUARD',
  'CONTROL_AUTHORITY_IDENTITY',
  'RECORD_ADMISSION_IDENTITY',
  'RECORD_REVIEW_IDENTITY',
  'READ_EFFECTIVE_IDENTITY',
]);
const EXPECTED_AUTHENTICATED_FINALITY_DOWN_FUNCTION_IDENTIFIERS = Object.freeze([
  'CONTROL_AUTHORITY_IDENTITY',
  'RECORD_ADMISSION_IDENTITY',
  'RECORD_REVIEW_IDENTITY',
  'READ_EFFECTIVE_IDENTITY',
]);
const EXPECTED_AUTHENTICATED_FINALITY_TABLE_IDENTIFIERS = Object.freeze(
  EXPECTED_AUTHENTICATED_FINALITY_TABLES.map(([identifier]) => identifier),
);
const EXPECTED_PRODUCTION_MIGRATION_TAIL = Object.freeze([
  'createProviderPositionChainAnchorEvidenceMigrationV0029',
  'enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030',
  'createProviderPositionChainAnchorRecordIntentMigrationV0031',
  'createMainnetBalanceAgreementEvidenceV2MigrationV0032',
  'createMainnetFinancialActionLifecycleMigrationV0033',
  'createMainnetFinancialActionWalletIdentityBindingMigrationV0034',
  'createMainnetFinancialActionAuthenticatedFinalityMigrationV0035',
  'createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036',
  'createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037',
  'createMainnetFinancialActionRevocationRecoveryMigrationV0038',
]);
const EXPECTED_TEST_MIGRATION_TAIL = Object.freeze([
  'createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029',
  'enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030',
  'createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031',
  'createMainnetBalanceAgreementEvidenceV2TestSchemaMigrationV0032',
  'createMainnetFinancialActionLifecycleTestSchemaMigrationV0033',
  'createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034',
  'createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035',
  'createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036',
  'createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037',
  'createMainnetFinancialActionRevocationRecoveryTestSchemaMigrationV0038',
]);
const EXPECTED_WALLET_IDENTITY_PREPARE_FUNCTION_IDENTITY =
  'prepare_mainnet_financial_action_lifecycle_v2(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,integer,text,text,text,smallint,text,text,text,text,integer,text,text,text,timestamp with time zone,timestamp with time zone,uuid,smallint[],text[])';
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
  /(?:dormant-mainnet-financial-action|mainnet-financial-action-finality-(?:evidence|prerequisite)|wallet-registration-mainnet-financial-action-finality-wallet|DormantMainnetFinancialAction|MainnetFinancialActionFinality|DORMANT_MAINNET_FINANCIAL_ACTION|MAINNET_FINANCIAL_ACTION_(?:PROVIDER_CANDIDATES|DATABASE_FINGERPRINT_ENCODING|FINALITY)|PostgresDormantMainnetFinancialAction(?:LifecycleDurable|FinalitySidecar|FinalityPrerequisite)Adapter|WalletRegistrationMainnetFinancialActionFinalityWalletReader|assessDormantMainnetFinancialAction|parseDormantMainnetFinancialActionIntent|createDormantMainnetFinancialActionLifecycleProtocol)/u;
const ACTION_LIFECYCLE_MIGRATION_REFERENCE =
  /(?:0033-create-mainnet-financial-action-lifecycle|0034-bind-mainnet-financial-action-wallet-identity|0035-create-mainnet-financial-action-authenticated-finality|0036-read-mainnet-financial-action-finality-prerequisite|0037-atomically-persist-mainnet-financial-action-finality|createMainnetFinancialActionLifecycle(?:TestSchema)?MigrationV0033|createMainnetFinancialActionWalletIdentityBinding(?:TestSchema)?MigrationV0034|createMainnetFinancialActionAuthenticatedFinality(?:TestSchema)?MigrationV0035|createMainnetFinancialActionFinalityPrerequisiteRead(?:Migration|(?:TestSchema)?MigrationV0036)|createMainnetFinancialActionAtomicFinalityPersistence(?:Migration|(?:TestSchema)?MigrationV0037)|MAINNET_ACTION_FINGERPRINT_GOLDEN_VECTORS|mainnet_financial_action_(?:intents|events|evidence_claims|reconciliation_(?:source_authorities|deployment_authorities|authority_controls|admissions)|post_finality_reviews)|(?:read|prepare|bind|record|control)_mainnet_financial_action_(?:lifecycle(?:_v2)?|submission|broadcast_observation|reconciliation_observation|reconciliation_(?:prerequisite_v1|authority_v1)|post_finality_(?:prerequisite_v1|review_v[12])|effective_safety_state_v1))/u;
const ACTION_LIFECYCLE_DATABASE_FUNCTION_REFERENCE =
  /\b(?:prepare_mainnet_financial_action_lifecycle(?:_v2)?|bind_mainnet_financial_action_submission|record_mainnet_financial_action_broadcast_observation|record_mainnet_financial_action_reconciliation_observation|read_mainnet_financial_action_lifecycle|read_mainnet_financial_action_(?:reconciliation|post_finality)_prerequisite_v1|record_authenticated_mainnet_financial_action_reconciliation_v[12]|record_mainnet_financial_action_post_finality_review_v[12]|read_mainnet_financial_action_effective_safety_state_v1|control_mainnet_financial_action_reconciliation_authority_v1)\b/u;
const DURABLE_SOURCE_SYMBOL_BRAND = /\bSymbol(?:\.for)?\s*\(/u;
const DURABLE_STANDALONE_RESULT_EXPORT =
  /\bexport\s+(?:(?:const|function)\s+(?:decode(?:Dormant)?MainnetFinancialActionDatabaseResult|createDormantMainnetFinancialActionDatabaseOutcomeUnknown|databaseOutcomeUnknown)|(?:type|interface|class)\s+DormantMainnetFinancialActionLifecycleDatabase(?:CommandV1|Codec|CodecError|CodecErrorCode))\b/u;
const PROHIBITED_DURABLE_REGISTRATION =
  /(?:@(?:Injectable|Module|Controller)\s*\(|\bfrom\s*['"]@nestjs\/|\bexport\s+(?:\*|\{[^}]*\})\s+from\s*['"]|\bproviders\s*:|\bmodule\.exports\b|\bprocess\.env\b|\b(?:fetch|WebSocket|XMLHttpRequest|eval|Function)\s*\(|\b(?:require|import)\s*\()/u;
const PROHIBITED_ADAPTER_DATABASE_CONTROL =
  /(?:\.\s*query\s*\(|\bwithTransaction\s*\(|\b(?:maxRetries|retryDelayMs|retryAttempts|retryCount|retryLimit|retryPolicy)\b|\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\s*\()/iu;
const PROHIBITED_ADAPTER_SQL_AUTHORITY =
  /\b(?:GRANT|REVOKE|CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/u;
const PROHIBITED_WALLET_IDENTITY_CANDIDATE_SINK =
  /(?:\b(?:console|logger|log)\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\([\s\S]{0,256}\bwalletIdentity(?:DigestCandidates|KeyRing)\b|\bJSON\s*\.\s*stringify\s*\([\s\S]{0,256}\bwalletIdentity(?:DigestCandidates|KeyRing)\b|\bwalletIdentity(?:DigestCandidates|KeyRing)\b[\s\S]{0,256}\b(?:console|logger|log)\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\()/u;
const PROHIBITED_DURABLE_AUTHORITY =
  /(?:\b(?:sendRawTransaction|sendTransaction|signTransaction|broadcastTransaction|eth_sendRawTransaction|writeContract|JsonRpcProvider|WalletClient|PrivateKeyAccount)\b|\b(?:job_outbox|outbox|enqueue)\b|\b(?:mayAuthorizeFinancialAction|apiMaySign|apiMayBroadcast|mayResendTransaction|automaticRetryAllowed|ledgerSettlementAuthority)\s*:\s*true\b|\bledger_settlement_authority\s*=\s*true\b)/iu;
const REVIEWED_DORMANT_SOURCE_PATHS = new Set([
  ...Object.keys(RECOVERY_SCHEDULER_ARTIFACT_SHA256),
  ACTION_BOUNDARY_PATH,
  ACTION_LIFECYCLE_PATH,
  ACTION_LIFECYCLE_DURABLE_PORT_PATH,
  ACTION_LIFECYCLE_POSTGRES_ADAPTER_PATH,
  ACTION_LIFECYCLE_MIGRATION_PATH,
  ACTION_WALLET_IDENTITY_BINDING_MIGRATION_PATH,
  ACTION_FINALITY_EVIDENCE_SOURCE_PORT_PATH,
  ACTION_FINALITY_EVIDENCE_PRODUCER_PATH,
  ACTION_FINALITY_SIDECAR_DURABLE_PORT_PATH,
  ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_PATH,
  ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_PATH,
  ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_PATH,
  ACTION_FINALITY_WALLET_READER_PATH,
  ACTION_AUTHENTICATED_FINALITY_MIGRATION_PATH,
  ACTION_FINALITY_PREREQUISITE_MIGRATION_PATH,
  ACTION_ATOMIC_FINALITY_MIGRATION_PATH,
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

function extractLocalIdentifierArrays(source, name) {
  return [...source.matchAll(new RegExp(`\\bconst ${name} = \\[([\\s\\S]*?)\\n  \\];`, 'gu'))].map(
    (match) => {
      const values = match[1]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      return values.every((value) => /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value)) ? values : null;
    },
  );
}

function extractNamedStringConstants(source, names) {
  return names.map((name) => {
    const match = source.match(new RegExp(`\\bconst ${name} = '([^']+)';`, 'u'));
    return match === null ? null : [name, match[1]];
  });
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
    productionMigrations?.filter(
      (value) => value === 'createMainnetFinancialActionWalletIdentityBindingMigrationV0034',
    ).length !== 1 ||
    testMigrations?.filter(
      (value) =>
        value === 'createMainnetFinancialActionWalletIdentityBindingTestSchemaMigrationV0034',
    ).length !== 1 ||
    productionMigrations?.filter(
      (value) => value === 'createMainnetFinancialActionAuthenticatedFinalityMigrationV0035',
    ).length !== 1 ||
    testMigrations?.filter(
      (value) =>
        value === 'createMainnetFinancialActionAuthenticatedFinalityTestSchemaMigrationV0035',
    ).length !== 1 ||
    productionMigrations?.filter(
      (value) => value === 'createMainnetFinancialActionFinalityPrerequisiteReadMigrationV0036',
    ).length !== 1 ||
    testMigrations?.filter(
      (value) =>
        value === 'createMainnetFinancialActionFinalityPrerequisiteReadTestSchemaMigrationV0036',
    ).length !== 1 ||
    productionMigrations?.filter(
      (value) => value === 'createMainnetFinancialActionAtomicFinalityPersistenceMigrationV0037',
    ).length !== 1 ||
    testMigrations?.filter(
      (value) =>
        value === 'createMainnetFinancialActionAtomicFinalityPersistenceTestSchemaMigrationV0037',
    ).length !== 1 ||
    occurrences(
      indexSource,
      "from './0033-create-mainnet-financial-action-lifecycle.migration';",
    ) !== 2 ||
    occurrences(
      indexSource,
      "from './0034-bind-mainnet-financial-action-wallet-identity.migration';",
    ) !== 2 ||
    occurrences(
      indexSource,
      "from './0035-create-mainnet-financial-action-authenticated-finality.migration';",
    ) !== 2 ||
    occurrences(
      indexSource,
      "from './0036-read-mainnet-financial-action-finality-prerequisite.migration';",
    ) !== 2 ||
    occurrences(
      indexSource,
      "from './0037-atomically-persist-mainnet-financial-action-finality.migration';",
    ) !== 2
  ) {
    errors.push(
      '0033-0037 migration index registration, predecessor order, or export inventory changed',
    );
  }

  return errors;
}

function validateWalletIdentityBindingMigrationSnapshot(
  migrationSource,
  migrationSpecSource,
  migrationIntegrationSpecSource,
) {
  const errors = [];
  const prepareBody = extractSection(
    migrationSource,
    'const PREPARE_V2_BODY = `',
    'function createUpSql(',
  );
  const upBuilder = extractSection(
    migrationSource,
    'function createUpSql(',
    'function createDownSql(',
  );
  const downBuilder = extractSection(
    migrationSource,
    'function createDownSql(',
    'function createVerifierSql(',
  );
  const verifierBuilder = extractSection(
    migrationSource,
    'function createVerifierSql(',
    'export function createMainnetFinancialActionWalletIdentityBindingMigration(',
  );

  if (
    !exactArray(
      extractImports(migrationSource),
      EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(migrationSource) ||
    !exactArray(extractExports(migrationSource), EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_EXPORTS)
  ) {
    errors.push('0034 wallet identity binding migration import or export inventory changed');
  }
  if (
    !exactArray(
      extractImports(migrationSpecSource),
      EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_IMPORTS,
    ) ||
    !exactArray(
      extractImports(migrationIntegrationSpecSource),
      EXPECTED_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(migrationSpecSource) ||
    hasUnsupportedExportSyntax(migrationIntegrationSpecSource) ||
    extractExports(migrationSpecSource).length !== 0 ||
    extractExports(migrationIntegrationSpecSource).length !== 0
  ) {
    errors.push('0034 wallet identity binding test import or export inventory changed');
  }

  if (
    prepareBody === null ||
    upBuilder === null ||
    downBuilder === null ||
    verifierBuilder === null
  ) {
    errors.push('0034 wallet identity binding SQL inventory is incomplete or reordered');
    return errors;
  }

  if (
    !migrationSource.includes("id: '0034'") ||
    occurrences(migrationSource, "supersedesVerificationOf: ['0033']") !== 1 ||
    !migrationSource.includes(
      'bind dormant mainnet financial action preparation to registered wallet identity digests',
    ) ||
    !migrationSource.includes(`'${EXPECTED_WALLET_IDENTITY_PREPARE_FUNCTION_IDENTITY}'`)
  ) {
    errors.push('0034 wallet identity binding migration or function identity changed');
  }

  for (const marker of [
    "['requested_wallet_identity_digest_versions', 'smallint[]']",
    "['requested_wallet_identity_digests_hex', 'text[]']",
    'procedure.pronargs = 32',
    'pg_catalog.array_fill(\'i\'::"char", ARRAY[32])',
    'CREATE FUNCTION prepare_mainnet_financial_action_lifecycle_v2(',
    'LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE',
    "'ALTER FUNCTION %I.${PREPARE_V2} SET search_path TO pg_catalog, %I, pg_temp'",
  ]) {
    if (!migrationSource.includes(marker)) {
      errors.push(`0034 wallet identity binding lacks exact function marker: ${marker}`);
    }
  }
  if (
    occurrences(prepareBody, 'prepare_mainnet_financial_action_lifecycle(') !== 1 ||
    prepareBody.includes('prepare_mainnet_financial_action_lifecycle_v2(')
  ) {
    errors.push('0034 wallet identity binding no longer delegates exactly once to reviewed 0033');
  }

  for (const marker of [
    'requested_wallet_identity_digest_versions IS NULL',
    'requested_wallet_identity_digests_hex IS NULL',
    'pg_catalog.array_ndims(requested_wallet_identity_digest_versions) IS DISTINCT FROM 1',
    'pg_catalog.array_lower(requested_wallet_identity_digest_versions, 1) IS DISTINCT FROM 1',
    'pg_catalog.cardinality(requested_wallet_identity_digest_versions) NOT BETWEEN 1 AND 3',
    'requested_wallet_identity_digest_versions[candidate_index] <= 0',
    '<= requested_wallet_identity_digest_versions[candidate_index - 1]',
    "requested_wallet_identity_digests_hex[candidate_index] !~ '^[0-9a-f]{64}$'",
    'pg_catalog.count(DISTINCT candidate.digest_hex)',
    'IS DISTINCT FROM policy_accepted_read_versions',
    "policy.policy_name = 'wallet-registration-identity-hmac'",
  ]) {
    if (!prepareBody.includes(marker)) {
      errors.push(`0034 wallet identity candidate validation lost marker: ${marker}`);
    }
  }

  const policyLock = prepareBody.indexOf(
    "policy.policy_name = 'wallet-registration-identity-hmac'",
  );
  const intentLock = prepareBody.indexOf('FROM mainnet_financial_action_intents AS stored');
  const linkageLock = prepareBody.indexOf('FROM yield_operations AS operation');
  const aliasMatch = prepareBody.indexOf('INNER JOIN registered_wallet_identity_digests AS alias');
  const delegate = prepareBody.indexOf(
    'RETURN QUERY SELECT * FROM prepare_mainnet_financial_action_lifecycle(',
  );
  if (
    policyLock < 0 ||
    intentLock <= policyLock ||
    linkageLock <= intentLock ||
    aliasMatch <= linkageLock ||
    delegate <= aliasMatch
  ) {
    errors.push('0034 wallet identity binding lock, proof, or delegation order changed');
  }
  for (const marker of [
    'FOR SHARE;',
    'WHERE stored.intent_id = requested_intent_id',
    'FOR UPDATE;',
    'wallet.wallet_id = requested_wallet_id',
    'wallet.account_id = requested_account_id',
    "wallet.status = 'ACTIVE'",
    "wallet.registry_environment = 'MAINNET'",
    "requested_network_id = wallet.chain_namespace || ':' || wallet.chain_reference",
    'FOR UPDATE OF operation, submission, ledger_transaction, wallet',
    'alias.wallet_id = requested_wallet_id',
    'alias.account_id = requested_account_id',
    'alias.address_digest_version =',
    "pg_catalog.decode(\n              requested_wallet_identity_digests_hex[candidate.candidate_index], 'hex'",
    "alias.status = 'ACTIVE'",
    'alias.revoked_at IS NULL',
  ]) {
    if (!prepareBody.includes(marker)) {
      errors.push(`0034 wallet identity binding lost atomic proof marker: ${marker}`);
    }
  }
  if (
    prepareBody.includes('wallet.address_digest_version') ||
    prepareBody.includes('wallet.address_digest,')
  ) {
    errors.push('0034 wallet identity binding incorrectly requires the immutable parent digest');
  }

  for (const builder of [upBuilder, downBuilder]) {
    if (
      !builder.includes("LOCK TABLE ${HISTORY_TABLES.join(', ')} IN ACCESS EXCLUSIVE MODE;") ||
      !builder.includes(
        "${HISTORY_TABLES.map((table) => `EXISTS (SELECT 1 FROM ${table})`).join('\\n        OR ')}",
      ) ||
      !builder.includes("USING ERRCODE = '55000'")
    ) {
      errors.push('0034 wallet identity binding history transition is no longer fail closed');
      break;
    }
  }
  if (
    !downBuilder.includes('DROP FUNCTION ${PREPARE_V2};') ||
    downBuilder.includes('DROP TABLE') ||
    downBuilder.includes('prepare_mainnet_financial_action_lifecycle(')
  ) {
    errors.push('0034 wallet identity binding rollback surface changed');
  }

  for (const marker of [
    'REVOKE ALL ON FUNCTION ${PREPARE_V2} FROM ${guardedRoles}',
    'NOT pg_catalog.has_function_privilege(${api}',
    'NOT pg_catalog.has_function_privilege(${worker}',
    'NOT pg_catalog.has_function_privilege(${legacy}',
    'NOT pg_catalog.has_function_privilege(${balance}',
    'NOT pg_catalog.has_function_privilege(${migration}',
    "NOT pg_catalog.has_function_privilege('public'",
    'acl.grantee <> procedure.proowner',
    "procedure.proconfig = ARRAY[\n            'search_path=pg_catalog, '",
    'pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc',
  ]) {
    if (!migrationSource.includes(marker)) {
      errors.push(`0034 wallet identity binding lacks owner-only verifier marker: ${marker}`);
    }
  }
  if (
    migrationSource.includes('GRANT ') ||
    /@(?:Injectable|Module|Controller)\s*\(|\bproviders\s*:|\bprocess\.env\b/u.test(
      migrationSource,
    ) ||
    /\beip155:8453\b/u.test(migrationSource) ||
    /\b(?:sendRawTransaction|sendTransaction|signTransaction|broadcastTransaction|eth_sendRawTransaction|job_outbox)\b/iu.test(
      migrationSource,
    )
  ) {
    errors.push('0034 wallet identity binding grants, registers, widens, or executes authority');
  }
  if (
    /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_$][A-Za-z0-9_$]*\s+SET|DELETE\s+FROM|COPY\s+|pg_notify\s*\()/iu.test(
      prepareBody,
    ) ||
    /\bRAISE\s+(?:DEBUG|LOG|INFO|NOTICE|WARNING)\b/iu.test(prepareBody) ||
    /\b(?:wallet_address|plaintext|hmac_key|credential|private_key|secret)\b/iu.test(
      migrationSource,
    )
  ) {
    errors.push('0034 wallet identity candidates can be logged, persisted, or exposed');
  }

  if (
    countDeclaredTests(migrationSpecSource) !== 8 ||
    !migrationSpecSource.includes(
      "describe('migration 0034 mainnet financial action wallet identity binding'",
    ) ||
    !migrationSpecSource.includes('adds one versioned 32-argument wrapper') ||
    !migrationSpecSource.includes('validates a bounded exact key ring and every digest') ||
    !migrationSpecSource.includes('locks and binds the exact active account wallet network') ||
    !migrationSpecSource.includes("expect(up).not.toContain('GRANT ')") ||
    !migrationSpecSource.includes("expect(up).not.toContain('wallet.address_digest_version')") ||
    !migrationSpecSource.includes('refuses to bless legacy history')
  ) {
    errors.push('0034 wallet identity binding migration spec lost fail-closed evidence');
  }
  if (
    countDeclaredTests(migrationIntegrationSpecSource) !== 5 ||
    !migrationIntegrationSpecSource.includes(
      "process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1'",
    ) ||
    !migrationIntegrationSpecSource.includes(
      "!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)",
    ) ||
    !migrationIntegrationSpecSource.includes('serverVersionNum < 160_000') ||
    !migrationIntegrationSpecSource.includes('serverVersionNum >= 170_000') ||
    !migrationIntegrationSpecSource.includes("({ id }) => id <= '0034'") ||
    !migrationIntegrationSpecSource.includes('v1_execute') ||
    !migrationIntegrationSpecSource.includes('v2_execute') ||
    !migrationIntegrationSpecSource.includes('hostileCandidates') ||
    !migrationIntegrationSpecSource.includes('expect(await historyCounts(pool)).toEqual(before)') ||
    !migrationIntegrationSpecSource.includes(
      'for (const network of [ETHEREUM_FIXTURE, SOLANA_FIXTURE])',
    ) ||
    !migrationIntegrationSpecSource.includes('parent-key retirement') ||
    !migrationIntegrationSpecSource.includes('wallet_identity_digest_version: 1') ||
    !migrationIntegrationSpecSource.includes('await setIdentityPolicy(pool, 2, [2])') ||
    !migrationIntegrationSpecSource.includes('requireRunner().down(1)') ||
    /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u.test(migrationIntegrationSpecSource)
  ) {
    errors.push('0034 wallet identity binding loopback integration lost security evidence');
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
    occurrences(postgresAdapterSource, '#databaseQuery') !== 4 ||
    occurrences(postgresAdapterSource, 'Reflect.apply(this.#databaseQuery') !== 2 ||
    occurrences(postgresAdapterSource, 'this.#execute(') !== 5 ||
    PROHIBITED_ADAPTER_DATABASE_CONTROL.test(postgresAdapterSource) ||
    /\b(?:for|while)\s*\(/u.test(databaseExecution)
  ) {
    errors.push('dormant Postgres adapter no longer performs one cancellable call without retry');
  }
  if (PROHIBITED_ADAPTER_SQL_AUTHORITY.test(postgresAdapterSource)) {
    errors.push('dormant Postgres adapter contains grant, DDL, or write-table SQL authority');
  }
  if (PROHIBITED_WALLET_IDENTITY_CANDIDATE_SINK.test(postgresAdapterSource)) {
    errors.push('dormant Postgres adapter can log or serialize wallet identity key material');
  }

  const prepareKeyInventory = extractSection(
    postgresAdapterSource,
    'const PREPARE_KEYS = Object.freeze([',
    'const LINK_KEYS = Object.freeze([',
  );
  const walletIdentityDerivation = extractSection(
    postgresAdapterSource,
    'function captureWalletIdentityKeyRing(',
    '/** Pure pre-I/O encoder for migration 0034',
  );
  const prepareSql = extractSection(
    postgresAdapterSource,
    'const PREPARE_SQL = `',
    'const BIND_SUBMISSION_SQL = `',
  );
  if (
    prepareKeyInventory === null ||
    /walletIdentity(?:DigestCandidates|DigestVersions|DigestsHex)/u.test(prepareKeyInventory) ||
    walletIdentityDerivation === null ||
    !walletIdentityDerivation.includes(
      "function captureWalletIdentityKeyRing(value: unknown): WalletRegistrationKeyRing<'identity-hmac'>",
    ) ||
    !walletIdentityDerivation.includes('const candidates = ring.keys.map((candidate) => {') ||
    !walletIdentityDerivation.includes(
      'const reference = digestWalletIdentity(key, networkId, canonicalAddress);',
    ) ||
    !postgresAdapterSource.includes(
      'walletIdentityDigestCandidates: deriveWalletIdentityDigestCandidates(',
    ) ||
    !postgresAdapterSource.includes('intent.walletAddress,') ||
    !postgresAdapterSource.includes('captureWalletIdentityKeyRing(walletIdentityKeyRing)')
  ) {
    errors.push('dormant Postgres adapter no longer derives wallet identity candidates internally');
  }
  if (
    prepareSql === null ||
    !prepareSql.includes('FROM prepare_mainnet_financial_action_lifecycle_v2(') ||
    !prepareSql.includes('$31::smallint[], $32::text[]') ||
    occurrences(postgresAdapterSource, 'prepare_mainnet_financial_action_lifecycle_v2(') !== 1 ||
    occurrences(postgresAdapterSource, 'prepare_mainnet_financial_action_lifecycle(') !== 0 ||
    !postgresAdapterSource.includes(
      'Object.freeze(args.walletIdentityDigestCandidates.map((candidate) => candidate.version))',
    ) ||
    !postgresAdapterSource.includes(
      'Object.freeze(args.walletIdentityDigestCandidates.map((candidate) => candidate.value))',
    )
  ) {
    errors.push('dormant Postgres adapter no longer uses only the address-bound V2 prepare call');
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
    "walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'>,",
    'ledgerSettlementAuthority: false as const',
    "recoveryMode: 'READ_THEN_RECONCILE_ONLY' as const",
    'reviewResult(',
  ]) {
    if (!postgresAdapterSource.includes(marker)) {
      errors.push(`dormant Postgres adapter lacks exact review or database marker: ${marker}`);
    }
  }

  if (
    !durablePortSource.includes(
      "export type DormantMainnetNonterminalReconciliationDatabaseOutcome = 'PENDING' | 'UNKNOWN';",
    ) ||
    !durablePortSource.includes(
      'readonly outcome: DormantMainnetNonterminalReconciliationDatabaseOutcome;',
    ) ||
    !postgresAdapterSource.includes(
      "const NONTERMINAL_RECONCILIATION_OUTCOMES: readonly DormantMainnetNonterminalReconciliationDatabaseOutcome[] =\n  Object.freeze(['PENDING', 'UNKNOWN']);",
    ) ||
    !postgresAdapterSource.includes('const effectEvidenceSha256 = null;') ||
    !postgresAdapterSource.includes('const failureEvidenceSha256 = null;') ||
    !postgresAdapterSpecSource.includes(
      "it.each(['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'] as const)(",
    ) ||
    !postgresAdapterSpecSource.includes(
      'rejects caller-authored terminal reconciliation %s before database I/O',
    ) ||
    postgresAdapterIntegrationSpecSource.includes("outcome: 'FINALIZED_SUCCESS'") ||
    postgresAdapterIntegrationSpecSource.includes("outcome: 'FINALIZED_FAILURE'") ||
    postgresAdapterIntegrationSpecSource.includes("outcome: 'REORGED_OUT'")
  ) {
    errors.push(
      'legacy durable adapter no longer excludes caller-authored terminal reconciliation',
    );
  }

  if (
    countDeclaredTests(postgresAdapterSpecSource) < 14 ||
    !postgresAdapterSpecSource.includes(
      "describe('PostgresDormantMainnetFinancialActionLifecycleDurableAdapter'",
    ) ||
    !postgresAdapterSpecSource.includes('Object.getOwnPropertySymbols') ||
    !postgresAdapterSpecSource.includes("Symbol.for('forged-clma-brand')") ||
    !postgresAdapterSpecSource.includes('structuredClone(prepared.result.cursor)') ||
    !postgresAdapterSpecSource.includes("outcome: 'DATABASE_OUTCOME_UNKNOWN'") ||
    !postgresAdapterSpecSource.includes('ledgerSettlementAuthority: false') ||
    !postgresAdapterSpecSource.includes('toHaveBeenCalledTimes(1)') ||
    !postgresAdapterSpecSource.includes(
      'rejects forged identity key rings before any database operation',
    ) ||
    !postgresAdapterSpecSource.includes('prepare_mainnet_financial_action_lifecycle_v2') ||
    !postgresAdapterSpecSource.includes('sorts rotated address candidates') ||
    !postgresAdapterSpecSource.includes('different valid address') ||
    !postgresAdapterSpecSource.includes('caller mutates plaintext after dispatch') ||
    !postgresAdapterSpecSource.includes('walletIdentityDigestVersions: [1]')
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
    !postgresAdapterIntegrationSpecSource.includes("({ id }) => id <= '0034'") ||
    !postgresAdapterIntegrationSpecSource.includes('await adapter.prepare(prepareRequest)') ||
    !postgresAdapterIntegrationSpecSource.includes('await adapter.bindSubmission(bindRequest)') ||
    !postgresAdapterIntegrationSpecSource.includes(
      'await adapter.recordReconciliation(reconciliationRequest)',
    ) ||
    !postgresAdapterIntegrationSpecSource.includes('await adapter.read(readRequest)') ||
    !postgresAdapterIntegrationSpecSource.includes("outcome: 'UNKNOWN'") ||
    postgresAdapterIntegrationSpecSource.includes('adapter.recordBroadcast(') ||
    occurrences(postgresAdapterIntegrationSpecSource, 'ledgerSettlementAuthority: false') < 5 ||
    !postgresAdapterIntegrationSpecSource.includes('ledger_authority_count: 0') ||
    !postgresAdapterIntegrationSpecSource.includes(
      "createWalletRegistrationKeyRing('identity-hmac', 2",
    ) ||
    !postgresAdapterIntegrationSpecSource.includes('parentWalletAddressDigest') ||
    !postgresAdapterIntegrationSpecSource.includes('currentWalletAddressDigest') ||
    !postgresAdapterIntegrationSpecSource.includes('accepted_read_versions: [2]') ||
    !postgresAdapterIntegrationSpecSource.includes('mismatchedIntentId') ||
    !postgresAdapterIntegrationSpecSource.includes('intent_count: 0')
  ) {
    errors.push('dormant Postgres adapter integration lost loopback 0034 flow or denial coverage');
  }

  return errors;
}

function validateFinalityEvidenceSnapshot(
  sourcePortSource,
  sourcePortSpecSource,
  producerSource,
  producerSpecSource,
) {
  const errors = [];
  if (
    !exactArray(extractImports(sourcePortSource), EXPECTED_FINALITY_EVIDENCE_SOURCE_PORT_IMPORTS) ||
    hasUnsupportedExportSyntax(sourcePortSource) ||
    !exactArray(extractExports(sourcePortSource), EXPECTED_FINALITY_EVIDENCE_SOURCE_PORT_EXPORTS)
  ) {
    errors.push('authenticated finality source port import or export inventory changed');
  }
  if (
    !exactArray(
      extractImports(sourcePortSpecSource),
      EXPECTED_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(sourcePortSpecSource) ||
    extractExports(sourcePortSpecSource).length !== 0
  ) {
    errors.push('authenticated finality source port spec inventory changed');
  }
  if (
    !exactArray(extractImports(producerSource), EXPECTED_FINALITY_EVIDENCE_PRODUCER_IMPORTS) ||
    hasUnsupportedExportSyntax(producerSource) ||
    !exactArray(extractExports(producerSource), EXPECTED_FINALITY_EVIDENCE_PRODUCER_EXPORTS)
  ) {
    errors.push('authenticated finality producer import or export inventory changed');
  }
  if (
    !exactArray(
      extractImports(producerSpecSource),
      EXPECTED_FINALITY_EVIDENCE_PRODUCER_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(producerSpecSource) ||
    extractExports(producerSpecSource).length !== 0
  ) {
    errors.push('authenticated finality producer spec inventory changed');
  }

  if (
    occurrences(sourcePortSource, 'readonly mayAuthorizeFinancialAction: false;') < 2 ||
    occurrences(sourcePortSource, 'readonly mayPersist: false;') < 2 ||
    !sourcePortSource.includes(
      'Implementations must honor both `signal` and the exclusive `deadlineAt`',
    ) ||
    !sourcePortSource.includes('settle their returned native Promise on cancellation') ||
    !sourcePortSource.includes(
      'registers no adapter and carries no endpoint, credential, persistence,',
    ) ||
    PROHIBITED_DURABLE_REGISTRATION.test(sourcePortSource) ||
    PROHIBITED_DURABLE_AUTHORITY.test(sourcePortSource)
  ) {
    errors.push('authenticated finality source port gained runtime or financial authority');
  }

  for (const marker of [
    "const ETHEREUM = 'eip155:1' as const;",
    "const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;",
    'const MAX_DEADLINE_MILLISECONDS = 30_000;',
    'const SYSTEM_SET_TIMEOUT = globalThis.setTimeout;',
    'const SYSTEM_CLEAR_TIMEOUT = globalThis.clearTimeout;',
    'readonly #issuedAdmissions = new WeakMap<',
    'readonly #issuedReviews = new WeakMap<',
    'const pendingReads = Promise.allSettled([',
    'primaryBinding.receiver === corroboratingBinding.receiver',
    'primaryBinding.sourceFamilyId === corroboratingBinding.sourceFamilyId',
    'primaryBinding.sourceId === corroboratingBinding.sourceId',
    'prerequisite.chainAnchorEvidenceExpiresAt.milliseconds,',
    'prerequisite.sourceAuthorityExpiresAt.milliseconds,',
    'prerequisite.deploymentAuthorityExpiresAt.milliseconds,',
    'mayAuthorizeFinancialAction: false,',
    'mayPersist: false,',
    'class owns no endpoint, credential, transport, SDK, writer, retry, signer,',
    'bounds already-started read-only source work and is always cleared.',
  ]) {
    if (!producerSource.includes(marker)) {
      errors.push(`authenticated finality producer lacks dormant evidence marker: ${marker}`);
    }
  }
  if (
    producerSource.includes('eip155:8453') ||
    occurrences(producerSource, 'Promise.allSettled([') !== 1 ||
    occurrences(producerSource, 'SYSTEM_SET_TIMEOUT(') !== 1 ||
    occurrences(producerSource, 'SYSTEM_CLEAR_TIMEOUT(') !== 1 ||
    /\b(?:setInterval|setImmediate|queueMicrotask)\s*\(/u.test(producerSource) ||
    /\b(?:maxRetries|retryDelayMs|retryAttempts|retryCount|retryLimit|retryPolicy)\b/iu.test(
      producerSource,
    ) ||
    PROHIBITED_DURABLE_REGISTRATION.test(producerSource) ||
    PROHIBITED_DURABLE_AUTHORITY.test(producerSource)
  ) {
    errors.push('authenticated finality producer gained registration, retry, egress, or authority');
  }
  if (
    countDeclaredTests(sourcePortSpecSource) !== 2 ||
    !sourcePortSpecSource.includes(
      'requires an opaque capability authenticated against the exact request object',
    ) ||
    !sourcePortSpecSource.includes(
      'keeps every source declaration authority-free and exposes no implementation',
    ) ||
    countDeclaredTests(producerSpecSource) !== 19 ||
    !producerSpecSource.includes("it.each(['BORROW', 'REPAY'] as const)(") ||
    !producerSpecSource.includes('rejects the not-yet-durable %s action before source I/O') ||
    !producerSpecSource.includes(
      'stops waiting for unresolved source reads when the request is aborted',
    ) ||
    !producerSpecSource.includes(
      'stops waiting for unresolved source reads at the exclusive deadline',
    ) ||
    !producerSpecSource.includes(
      'stops unresolved reads at the earliest evidence or authority expiry',
    ) ||
    !producerSpecSource.includes(
      'rejects source disagreement and an unauthenticated source capability',
    ) ||
    !producerSpecSource.includes(
      'exports no runtime source, transport, writer, timer, or provider SDK',
    )
  ) {
    errors.push('authenticated finality source or producer specs lost fail-closed evidence');
  }
  return errors;
}

function validateFinalitySidecarSnapshot(
  sidecarPortSource,
  sidecarPortSpecSource,
  sidecarAdapterSource,
  sidecarAdapterSpecSource,
) {
  const errors = [];
  if (
    !exactArray(extractImports(sidecarPortSource), EXPECTED_FINALITY_SIDECAR_PORT_IMPORTS) ||
    hasUnsupportedExportSyntax(sidecarPortSource) ||
    !exactArray(extractExports(sidecarPortSource), EXPECTED_FINALITY_SIDECAR_PORT_EXPORTS)
  ) {
    errors.push('authenticated finality sidecar port import or export inventory changed');
  }
  if (
    !exactArray(
      extractImports(sidecarPortSpecSource),
      EXPECTED_FINALITY_SIDECAR_PORT_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(sidecarPortSpecSource) ||
    extractExports(sidecarPortSpecSource).length !== 0 ||
    !exactArray(extractImports(sidecarAdapterSource), EXPECTED_FINALITY_SIDECAR_ADAPTER_IMPORTS) ||
    hasUnsupportedExportSyntax(sidecarAdapterSource) ||
    !exactArray(extractExports(sidecarAdapterSource), EXPECTED_FINALITY_SIDECAR_ADAPTER_EXPORTS) ||
    !exactArray(
      extractImports(sidecarAdapterSpecSource),
      EXPECTED_FINALITY_SIDECAR_ADAPTER_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(sidecarAdapterSpecSource) ||
    extractExports(sidecarAdapterSpecSource).length !== 0
  ) {
    errors.push('authenticated finality sidecar implementation or spec inventory changed');
  }
  if (
    !exactArray(
      extractSqlConstants(sidecarAdapterSource),
      EXPECTED_FINALITY_SIDECAR_SQL_CONSTANTS,
    ) ||
    !exactArray(
      extractSqlFunctions(sidecarAdapterSource),
      EXPECTED_FINALITY_SIDECAR_SQL_FUNCTIONS,
    ) ||
    occurrences(
      sidecarAdapterSource,
      'const input = exactDataArray(common.admissionArguments, 24);',
    ) !== 1 ||
    occurrences(
      sidecarAdapterSource,
      'const input = exactDataArray(common.reviewArguments, 25);',
    ) !== 1 ||
    occurrences(sidecarAdapterSource, 'Object.freeze([request.accountId, request.intentId])') !== 1
  ) {
    errors.push('authenticated finality sidecar SQL or argument allowlist changed');
  }
  const dispatch = extractSection(sidecarAdapterSource, '  async #dispatch(', '  #issue(');
  if (
    dispatch === null ||
    occurrences(sidecarAdapterSource, 'queryWithCancellation') !== 2 ||
    occurrences(sidecarAdapterSource, 'Reflect.apply(this.#databaseQuery.method') !== 1 ||
    occurrences(sidecarAdapterSource, 'this.#dispatch(') !== 3 ||
    PROHIBITED_ADAPTER_DATABASE_CONTROL.test(sidecarAdapterSource) ||
    /\b(?:for|while)\s*\(/u.test(dispatch)
  ) {
    errors.push(
      'authenticated finality sidecar no longer performs one cancellable call without retry',
    );
  }
  if (
    PROHIBITED_ADAPTER_SQL_AUTHORITY.test(sidecarAdapterSource) ||
    PROHIBITED_DURABLE_REGISTRATION.test(sidecarAdapterSource) ||
    PROHIBITED_DURABLE_AUTHORITY.test(sidecarAdapterSource) ||
    DURABLE_SOURCE_SYMBOL_BRAND.test(sidecarAdapterSource)
  ) {
    errors.push(
      'authenticated finality sidecar gained registration, SQL, signing, or settlement authority',
    );
  }
  for (const marker of [
    'readonly #issuedResults = new WeakMap<object, IssuedResult>();',
    'readonly #requestMethods = new WeakMap<object, DatabaseMethod>();',
    'readonly #issuedCursors = new WeakMap<object, IssuedCursor>();',
    'readonly #spentCursors = new WeakSet<object>();',
    'const secondCandidate = invokeReview(',
    'this.#spentCursors.add(cursorSeal.cursor);',
    "source: 'MIGRATION_0035_DATABASE' as const",
    'networkId: row.networkId,',
    'recordedReviewRevision: null,',
    'recordedReviewFingerprintSha256: null,',
    'recordedReviewDisposition: null,',
    'mayAuthorizeFinancialAction: false as const,',
    'ledgerSettlementAuthority: false as const,',
    'Exactly one producer-backed persistence facet may then be bound. Cursor',
  ]) {
    if (!sidecarAdapterSource.includes(marker)) {
      errors.push(`authenticated finality sidecar lacks dormant database marker: ${marker}`);
    }
  }
  if (
    countDeclaredTests(sidecarPortSpecSource) !== 2 ||
    !sidecarPortSpecSource.includes(
      'keeps public mutation inputs capability-only and separates review CAS provenance',
    ) ||
    countDeclaredTests(sidecarAdapterSpecSource) !== 15 ||
    !sidecarAdapterSpecSource.includes(
      'double-reviews genuine admission evidence and dispatches one exact 24-value call',
    ) ||
    !sidecarAdapterSpecSource.includes(
      'reads one effective state and seals a restart-safe terminal cursor',
    ) ||
    !sidecarAdapterSpecSource.includes(
      'preserves the last cursor on ambiguous review dispatch and requires read recovery',
    ) ||
    !sidecarAdapterSpecSource.includes(
      'rejects copied and cross-instance cursors before reviewing evidence or touching SQL',
    ) ||
    !sidecarAdapterSpecSource.includes('malformed rows as unknown without retry')
  ) {
    errors.push('authenticated finality sidecar specs lost provenance or fail-closed evidence');
  }
  return errors;
}

function validateAuthenticatedFinalityMigrationSnapshot(
  migrationSource,
  migrationSpecSource,
  migrationIntegrationSpecSource,
) {
  const errors = [];
  if (
    !exactArray(
      extractImports(migrationSource),
      EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(migrationSource) ||
    !exactArray(
      extractExports(migrationSource),
      EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_EXPORTS,
    ) ||
    !exactArray(
      extractImports(migrationSpecSource),
      EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_SPEC_IMPORTS,
    ) ||
    !exactArray(
      extractImports(migrationIntegrationSpecSource),
      EXPECTED_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(migrationSpecSource) ||
    hasUnsupportedExportSyntax(migrationIntegrationSpecSource) ||
    extractExports(migrationSpecSource).length !== 0 ||
    extractExports(migrationIntegrationSpecSource).length !== 0
  ) {
    errors.push('0035 authenticated finality import or export inventory changed');
  }
  if (
    !exactArray(
      extractNamedStringConstants(
        migrationSource,
        EXPECTED_AUTHENTICATED_FINALITY_TABLES.map(([name]) => name),
      ),
      EXPECTED_AUTHENTICATED_FINALITY_TABLES,
    ) ||
    occurrences(migrationSource, 'CREATE TABLE ') !==
      EXPECTED_AUTHENTICATED_FINALITY_TABLES.length ||
    occurrences(migrationSource, 'CREATE FUNCTION ') !==
      EXPECTED_AUTHENTICATED_FINALITY_UP_FUNCTION_IDENTIFIERS.length
  ) {
    errors.push('0035 authenticated finality table or SQL function inventory changed');
  }
  const functionArrays = extractLocalIdentifierArrays(migrationSource, 'functions');
  const tableArrays = extractLocalIdentifierArrays(migrationSource, 'tables');
  if (
    functionArrays.length !== 2 ||
    !exactArray(functionArrays[0], EXPECTED_AUTHENTICATED_FINALITY_UP_FUNCTION_IDENTIFIERS) ||
    !exactArray(functionArrays[1], EXPECTED_AUTHENTICATED_FINALITY_DOWN_FUNCTION_IDENTIFIERS) ||
    tableArrays.length !== 2 ||
    tableArrays.some(
      (inventory) => !exactArray(inventory, EXPECTED_AUTHENTICATED_FINALITY_TABLE_IDENTIFIERS),
    )
  ) {
    errors.push('0035 authenticated finality up/down function or table allowlist changed');
  }
  for (const marker of [
    "const ETHEREUM = 'eip155:1';",
    "const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';",
    "id: '0035'",
    "supersedesVerificationOf: ['0034']",
    "action_type IN ('SUPPLY', 'WITHDRAW')",
    'CREATE CONSTRAINT TRIGGER mainnet_action_reconciliation_requires_authenticated_admission',
    'SET CONSTRAINTS mainnet_action_reconciliation_requires_authenticated_admission DEFERRED;',
    "RAISE EXCEPTION 'post-finality quarantine is permanent'",
    'current_review_revision bigint,',
    'current_review_fingerprint_sha256 text,',
    'current_review_disposition text,',
    "REVOKE ALL PRIVILEGES ON TABLE ${tables.join(', ')} FROM ${guarded};",
    'REVOKE ALL ON FUNCTION ${fn} FROM ${guarded};',
    'authenticated finality requires empty mainnet action reconciliation history',
  ]) {
    if (!migrationSource.includes(marker)) {
      errors.push(`0035 authenticated finality lacks fail-closed marker: ${marker}`);
    }
  }
  if (
    migrationSource.includes('eip155:8453') ||
    migrationSource.includes('GRANT ') ||
    /INSERT\s+INTO\s+mainnet_financial_action_reconciliation_(?:source|deployment)_authorities/iu.test(
      migrationSource,
    ) ||
    /@(?:Injectable|Module|Controller)\s*\(|\bproviders\s*:|\bprocess\.env\b/u.test(
      migrationSource,
    ) ||
    PROHIBITED_DURABLE_AUTHORITY.test(migrationSource)
  ) {
    errors.push(
      '0035 authenticated finality seeds, grants, registers, widens, or executes authority',
    );
  }
  if (
    countDeclaredTests(migrationSpecSource) !== 10 ||
    !migrationSpecSource.includes(
      'creates empty Ethereum and Solana evidence authority gates and append-only control',
    ) ||
    !migrationSpecSource.includes(
      'admits exactly one legacy reconciliation call atomically behind a deferred guard',
    ) ||
    !migrationSpecSource.includes('sticky post-finality quarantine overlay') ||
    !migrationSpecSource.includes(
      'pins owner-only functions, exact relations, constraints, indexes, and triggers',
    ) ||
    !migrationSpecSource.includes("expect(up).not.toContain('GRANT ')") ||
    countDeclaredTests(migrationIntegrationSpecSource) !== 2 ||
    !migrationIntegrationSpecSource.includes(
      "process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1'",
    ) ||
    !migrationIntegrationSpecSource.includes(
      "!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)",
    ) ||
    !migrationIntegrationSpecSource.includes('serverVersionNum < 160_000') ||
    !migrationIntegrationSpecSource.includes('serverVersionNum >= 170_000') ||
    !migrationIntegrationSpecSource.includes("({ id }) => id <= '0035'") ||
    !migrationIntegrationSpecSource.includes(
      'for (const network of [ETHEREUM_FIXTURE, SOLANA_FIXTURE])',
    ) ||
    !migrationIntegrationSpecSource.includes('leaves every 0035 capability owner-only') ||
    !migrationIntegrationSpecSource.includes('keeps recovery fail closed') ||
    !migrationIntegrationSpecSource.includes("'DEEP_REORG_QUARANTINED'") ||
    !migrationIntegrationSpecSource.includes("'SUSPENDED', 'SECURITY_REVIEW'") ||
    !migrationIntegrationSpecSource.includes("'REVOKED', 'SOURCE_REVOKED'") ||
    !migrationIntegrationSpecSource.includes('rejects representative %s catalog tampering') ||
    /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u.test(migrationIntegrationSpecSource)
  ) {
    errors.push('0035 authenticated finality tests lost owner-only or fail-closed evidence');
  }
  return errors;
}

function validateAtomicFinalityPrerequisiteSnapshot(
  issuerPortSource,
  prerequisiteAdapterSource,
  prerequisiteAdapterSpecSource,
  walletReaderSource,
  walletReaderSpecSource,
  prerequisiteMigrationSource,
  prerequisiteMigrationSpecSource,
  prerequisiteMigrationIntegrationSpecSource,
  atomicMigrationSource,
  atomicMigrationSpecSource,
  atomicMigrationIntegrationSpecSource,
) {
  const errors = [];
  if (
    !exactArray(
      extractImports(issuerPortSource),
      EXPECTED_FINALITY_PREREQUISITE_ISSUER_PORT_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(issuerPortSource) ||
    !exactArray(
      extractExports(issuerPortSource),
      EXPECTED_FINALITY_PREREQUISITE_ISSUER_PORT_EXPORTS,
    ) ||
    !exactArray(
      extractImports(prerequisiteAdapterSource),
      EXPECTED_FINALITY_PREREQUISITE_ADAPTER_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(prerequisiteAdapterSource) ||
    !exactArray(
      extractExports(prerequisiteAdapterSource),
      EXPECTED_FINALITY_PREREQUISITE_ADAPTER_EXPORTS,
    ) ||
    !exactArray(
      extractImports(prerequisiteAdapterSpecSource),
      EXPECTED_FINALITY_PREREQUISITE_ADAPTER_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(prerequisiteAdapterSpecSource) ||
    extractExports(prerequisiteAdapterSpecSource).length !== 0
  ) {
    errors.push('0036 prerequisite port, adapter, or spec import/export inventory changed');
  }
  if (
    !exactArray(extractImports(walletReaderSource), EXPECTED_FINALITY_WALLET_READER_IMPORTS) ||
    hasUnsupportedExportSyntax(walletReaderSource) ||
    !exactArray(extractExports(walletReaderSource), EXPECTED_FINALITY_WALLET_READER_EXPORTS) ||
    !exactArray(
      extractImports(walletReaderSpecSource),
      EXPECTED_FINALITY_WALLET_READER_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(walletReaderSpecSource) ||
    extractExports(walletReaderSpecSource).length !== 0
  ) {
    errors.push('0036 wallet reader or spec import/export inventory changed');
  }
  if (
    occurrences(prerequisiteAdapterSource, 'queryWithCancellation') !== 2 ||
    occurrences(prerequisiteAdapterSource, 'Reflect.apply(this.#databaseQuery.method') !== 1 ||
    occurrences(prerequisiteAdapterSource, 'this.#issue(') !== 2 ||
    occurrences(
      prerequisiteAdapterSource,
      'read_mainnet_financial_action_reconciliation_prerequisite_v2',
    ) !== 2 ||
    occurrences(
      prerequisiteAdapterSource,
      'read_mainnet_financial_action_post_finality_prerequisite_v2',
    ) !== 2 ||
    PROHIBITED_ADAPTER_DATABASE_CONTROL.test(prerequisiteAdapterSource) ||
    PROHIBITED_ADAPTER_SQL_AUTHORITY.test(prerequisiteAdapterSource)
  ) {
    errors.push('0036 prerequisite adapter SQL or one-shot dispatch allowlist changed');
  }
  if (
    [issuerPortSource, prerequisiteAdapterSource, walletReaderSource].some(
      (source) =>
        PROHIBITED_DURABLE_REGISTRATION.test(source) ||
        PROHIBITED_DURABLE_AUTHORITY.test(source) ||
        DURABLE_SOURCE_SYMBOL_BRAND.test(source),
    ) ||
    !prerequisiteAdapterSource.includes('readonly #spentRequests = new WeakSet<object>();') ||
    !walletReaderSource.includes('readonly #startedRequests = new WeakSet<object>();') ||
    !walletReaderSource.includes('mayAuthorizeFinancialAction: false,')
  ) {
    errors.push(
      '0036 prerequisite or wallet adapter gained runtime, signing, or settlement authority',
    );
  }
  if (
    !exactArray(
      extractImports(prerequisiteMigrationSource),
      EXPECTED_FINALITY_PREREQUISITE_MIGRATION_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(prerequisiteMigrationSource) ||
    !exactArray(
      extractExports(prerequisiteMigrationSource),
      EXPECTED_FINALITY_PREREQUISITE_MIGRATION_EXPORTS,
    ) ||
    !exactArray(
      extractImports(prerequisiteMigrationSpecSource),
      EXPECTED_FINALITY_PREREQUISITE_MIGRATION_SPEC_IMPORTS,
    ) ||
    !exactArray(
      extractImports(prerequisiteMigrationIntegrationSpecSource),
      EXPECTED_FINALITY_READ_INTEGRATION_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(prerequisiteMigrationSpecSource) ||
    hasUnsupportedExportSyntax(prerequisiteMigrationIntegrationSpecSource) ||
    extractExports(prerequisiteMigrationSpecSource).length !== 0 ||
    extractExports(prerequisiteMigrationIntegrationSpecSource).length !== 0
  ) {
    errors.push('0036 prerequisite migration import or export inventory changed');
  }
  for (const marker of [
    "id: '0036'",
    "supersedesVerificationOf: ['0035']",
    'CREATE FUNCTION read_mainnet_financial_action_reconciliation_prerequisite_v1(',
    'CREATE FUNCTION read_mainnet_financial_action_post_finality_prerequisite_v1(',
    'LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE',
    'LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE',
    'SET search_path TO pg_catalog, %I, pg_temp',
    'REVOKE ALL ON FUNCTION ${RECONCILIATION_READ_IDENTITY} FROM ${guarded};',
    'REVOKE ALL ON FUNCTION ${POST_FINALITY_READ_IDENTITY} FROM ${guarded};',
  ]) {
    if (!prerequisiteMigrationSource.includes(marker)) {
      errors.push(`0036 prerequisite migration lacks owner-only marker: ${marker}`);
    }
  }
  if (
    prerequisiteMigrationSource.includes('GRANT ') ||
    occurrences(prerequisiteMigrationSource, 'CREATE FUNCTION ') !== 2 ||
    occurrences(prerequisiteMigrationSource, 'CREATE TABLE ') !== 0 ||
    PROHIBITED_DURABLE_AUTHORITY.test(prerequisiteMigrationSource)
  ) {
    errors.push('0036 prerequisite migration grants, persists, signs, or broadcasts authority');
  }
  if (
    countDeclaredTests(prerequisiteAdapterSpecSource) !== 18 ||
    countDeclaredTests(walletReaderSpecSource) !== 8 ||
    countDeclaredTests(prerequisiteMigrationSpecSource) !== 10 ||
    countDeclaredTests(prerequisiteMigrationIntegrationSpecSource) !== 5 ||
    !prerequisiteMigrationIntegrationSpecSource.includes(
      "process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1'",
    ) ||
    !prerequisiteMigrationIntegrationSpecSource.includes("({ id }) => id <= '0036'") ||
    !prerequisiteMigrationIntegrationSpecSource.includes(
      "!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)",
    ) ||
    !prerequisiteMigrationIntegrationSpecSource.includes('fails closed after wallet revocation')
  ) {
    errors.push('0036 prerequisite tests lost fail-closed or local-only evidence');
  }

  if (
    !exactArray(
      extractImports(atomicMigrationSource),
      EXPECTED_ATOMIC_FINALITY_MIGRATION_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(atomicMigrationSource) ||
    !exactArray(
      extractExports(atomicMigrationSource),
      EXPECTED_ATOMIC_FINALITY_MIGRATION_EXPORTS,
    ) ||
    !exactArray(
      extractImports(atomicMigrationSpecSource),
      EXPECTED_ATOMIC_FINALITY_MIGRATION_SPEC_IMPORTS,
    ) ||
    !exactArray(
      extractImports(atomicMigrationIntegrationSpecSource),
      EXPECTED_FINALITY_READ_INTEGRATION_SPEC_IMPORTS,
    ) ||
    hasUnsupportedExportSyntax(atomicMigrationSpecSource) ||
    hasUnsupportedExportSyntax(atomicMigrationIntegrationSpecSource) ||
    extractExports(atomicMigrationSpecSource).length !== 0 ||
    extractExports(atomicMigrationIntegrationSpecSource).length !== 0
  ) {
    errors.push('0037 atomic finality migration import or export inventory changed');
  }
  const internalV1References = [...atomicMigrationSource.matchAll(/\b[a-z][a-z0-9_]*_v1\b/gu)].map(
    (match) => match[0],
  );
  if (
    !exactArray(internalV1References, [
      'record_authenticated_mainnet_financial_action_reconciliation_v1',
      'record_mainnet_financial_action_post_finality_review_v1',
      'read_mainnet_financial_action_reconciliation_prerequisite_v1',
      'read_mainnet_financial_action_post_finality_prerequisite_v1',
    ]) ||
    occurrences(atomicMigrationSource, '${RECORD_ADMISSION_V1}(') !== 2 ||
    occurrences(atomicMigrationSource, '${RECORD_REVIEW_V1}(') !== 2
  ) {
    errors.push('0037 internal v1 database-call allowlist changed');
  }
  for (const marker of [
    "id: '0037'",
    "supersedesVerificationOf: ['0036']",
    "const RECORD_ADMISSION_V2 = 'record_authenticated_mainnet_financial_action_reconciliation_v2';",
    "const RECORD_REVIEW_V2 = 'record_mainnet_financial_action_post_finality_review_v2';",
    'LANGUAGE plpgsql SECURITY DEFINER VOLATILE CALLED ON NULL INPUT PARALLEL UNSAFE',
    'SET search_path TO pg_catalog, %I, pg_temp',
    'REVOKE ALL ON FUNCTION ${RECORD_ADMISSION_V2_IDENTITY} FROM ${guarded};',
    'REVOKE ALL ON FUNCTION ${RECORD_REVIEW_V2_IDENTITY} FROM ${guarded};',
  ]) {
    if (!atomicMigrationSource.includes(marker)) {
      errors.push(`0037 atomic finality migration lacks owner-only marker: ${marker}`);
    }
  }
  if (
    atomicMigrationSource.includes('GRANT ') ||
    occurrences(atomicMigrationSource, 'CREATE FUNCTION ') !== 2 ||
    occurrences(atomicMigrationSource, 'CREATE TABLE ') !== 0 ||
    PROHIBITED_DURABLE_AUTHORITY.test(atomicMigrationSource)
  ) {
    errors.push(
      '0037 atomic finality migration grants, persists extra state, signs, or broadcasts',
    );
  }
  if (
    countDeclaredTests(atomicMigrationSpecSource) !== 13 ||
    countDeclaredTests(atomicMigrationIntegrationSpecSource) !== 15 ||
    !atomicMigrationIntegrationSpecSource.includes(
      "process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1'",
    ) ||
    !atomicMigrationIntegrationSpecSource.includes("({ id }) => id <= '0038'") ||
    !atomicMigrationIntegrationSpecSource.includes(
      "!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)",
    ) ||
    !atomicMigrationIntegrationSpecSource.includes('without deadlock') ||
    !atomicMigrationIntegrationSpecSource.includes('post-bind revoke recovery races') ||
    !atomicMigrationIntegrationSpecSource.includes(
      'rolls back a newly recorded result that crosses its effective expiry',
    )
  ) {
    errors.push('0037 atomic finality tests lost race, rollback, or local-only evidence');
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

function validateRecoverySchedulerSnapshot(sources, lifecycleAdapter, migrationIndex) {
  const errors = [];
  const paths = Object.keys(RECOVERY_SCHEDULER_ARTIFACT_SHA256);
  if (!(sources instanceof Map) || !exactArray([...sources.keys()].sort(), paths.slice().sort()))
    return ['recovery and scheduler artifact inventory is incomplete or extended'];
  for (const [path, expected] of Object.entries(RECOVERY_SCHEDULER_ARTIFACT_SHA256)) {
    const source = sources.get(path);
    if (
      typeof source !== 'string' ||
      createHash('sha256').update(source, 'utf8').digest('hex') !== expected
    ) {
      errors.push(`reviewed recovery or scheduler artifact drifted: ${path}`);
      if (typeof source !== 'string') continue;
    }
    if (path.endsWith('.migration.ts')) {
      const id = path.split('/').at(-1).slice(0, 4);
      const predecessor = String(Number(id) - 1).padStart(4, '0');
      if (
        !source.includes(`id: '${id}'`) ||
        !source.includes(`supersedesVerificationOf: ['${predecessor}']`) ||
        /\bGRANT\s/u.test(source) ||
        !source.includes('REVOKE ALL')
      )
        errors.push(
          `recovery/scheduler migration widened owner authority or broke ordering: ${path}`,
        );
      if (id >= '0039' && migrationIndex.includes(path.split('/').at(-1).replace(/\.ts$/u, '')))
        errors.push('0039-0042 must remain outside runtime migration registration');
    }
    if (
      path.includes('/mainnet-actions/') &&
      !path.endsWith('.spec.ts') &&
      (PROHIBITED_DURABLE_REGISTRATION.test(source) ||
        source.includes('@solana/web3.js') ||
        /\b(?:mayAuthorizeFinancialAction|apiMaySign|apiMayBroadcast|mayResubmitTransaction|ledgerSettlementAuthority)\s*:\s*true\b/u.test(
          source,
        ))
    )
      errors.push(
        `recovery/scheduler source gained runtime, network, or financial authority: ${path}`,
      );
    if (
      path.endsWith('.integration-spec.ts') &&
      (!source.includes("RUN_INFRASTRUCTURE_INTEGRATION === '1'") ||
        (!source.includes("!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)") &&
          !source.includes(
            "hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1'",
          )))
    )
      errors.push(`recovery/scheduler integration test lost its explicit local guard: ${path}`);
  }
  const scheduler =
    sources.get(
      'apps/api/src/mainnet-actions/application/dormant-mainnet-financial-action-two-queue.scheduler.ts',
    ) ?? '';
  const adapter =
    sources.get(
      'apps/api/src/mainnet-actions/infrastructure/postgres-dormant-mainnet-financial-action-two-queue-scheduler.adapter.ts',
    ) ?? '';
  const manifest =
    sources.get(
      'apps/api/src/mainnet-actions/infrastructure/mainnet-financial-action-write-manifest.ts',
    ) ?? '';
  const migration =
    sources.get(
      'apps/api/src/infrastructure/database/migrations/0042-create-mainnet-financial-action-durable-scheduler.migration.ts',
    ) ?? '';
  const verifiedBind = extractSection(
    lifecycleAdapter,
    '  async #executeVerifiedBind(',
    '  #issueVerifiedBind(',
  );
  if (
    verifiedBind === null ||
    occurrences(verifiedBind, 'Reflect.apply(this.#databaseQuery') !== 1 ||
    /\b(?:for|while)\s*\(/u.test(verifiedBind) ||
    !verifiedBind.includes('databaseOutcomeUnknown(command)')
  )
    errors.push('verified submission binding lost its single-call unknown-outcome boundary');
  if (
    !manifest.includes(
      'DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFESTS: readonly MainnetFinancialActionWriteManifestV1[] =\n  Object.freeze([]);',
    )
  )
    errors.push('production write manifests must remain empty');
  if (
    occurrences(adapter, 'Reflect.apply(this.#databaseQuery') !== 2 ||
    !adapter.includes('this.#claims.delete(sourceClaimCapability);') ||
    !adapter.includes('claim_mainnet_financial_action_scheduler_job_v1') ||
    !adapter.includes('complete_mainnet_financial_action_scheduler_job_v1') ||
    !scheduler.includes(
      'const durableCompletion = sourceCompletion(reviewed, queue, issued, request);',
    ) ||
    !scheduler.includes('completedAt: durableCompletion.completedAt')
  )
    errors.push('scheduler completion must be one-shot and authenticated by the durable source');
  for (const marker of [
    'FOR UPDATE OF job SKIP LOCKED',
    'ATTEMPT_LIMIT_REACHED',
    'MANUAL_REVIEW',
    'WHERE job.job_id = requested_job_id FOR UPDATE',
    'requested_fencing_token',
  ]) {
    if (!migration.includes(marker))
      errors.push(`durable scheduler lost concurrency or quarantine control: ${marker}`);
  }
  return errors;
}

const RECOVERY_SCHEDULER_RUNTIME_STEMS = Object.keys(RECOVERY_SCHEDULER_ARTIFACT_SHA256)
  .filter(
    (path) =>
      (path.includes('/mainnet-actions/') || path.includes('/migrations/')) &&
      !path.endsWith('.spec.ts'),
  )
  .map((path) => path.split('/').at(-1).replace(/\.ts$/u, ''));

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
    typeof snapshot.walletIdentityBindingMigrationSource !== 'string' ||
    typeof snapshot.walletIdentityBindingMigrationSpecSource !== 'string' ||
    typeof snapshot.walletIdentityBindingMigrationIntegrationSpecSource !== 'string' ||
    typeof snapshot.finalityEvidenceSourcePortSource !== 'string' ||
    typeof snapshot.finalityEvidenceSourcePortSpecSource !== 'string' ||
    typeof snapshot.finalityEvidenceProducerSource !== 'string' ||
    typeof snapshot.finalityEvidenceProducerSpecSource !== 'string' ||
    typeof snapshot.finalitySidecarPortSource !== 'string' ||
    typeof snapshot.finalitySidecarPortSpecSource !== 'string' ||
    typeof snapshot.finalitySidecarAdapterSource !== 'string' ||
    typeof snapshot.finalitySidecarAdapterSpecSource !== 'string' ||
    typeof snapshot.authenticatedFinalityMigrationSource !== 'string' ||
    typeof snapshot.authenticatedFinalityMigrationSpecSource !== 'string' ||
    typeof snapshot.authenticatedFinalityMigrationIntegrationSpecSource !== 'string' ||
    typeof snapshot.finalityPrerequisiteIssuerPortSource !== 'string' ||
    typeof snapshot.finalityPrerequisiteAdapterSource !== 'string' ||
    typeof snapshot.finalityPrerequisiteAdapterSpecSource !== 'string' ||
    typeof snapshot.finalityWalletReaderSource !== 'string' ||
    typeof snapshot.finalityWalletReaderSpecSource !== 'string' ||
    typeof snapshot.finalityPrerequisiteMigrationSource !== 'string' ||
    typeof snapshot.finalityPrerequisiteMigrationSpecSource !== 'string' ||
    typeof snapshot.finalityPrerequisiteMigrationIntegrationSpecSource !== 'string' ||
    typeof snapshot.atomicFinalityMigrationSource !== 'string' ||
    typeof snapshot.atomicFinalityMigrationSpecSource !== 'string' ||
    typeof snapshot.atomicFinalityMigrationIntegrationSpecSource !== 'string' ||
    typeof snapshot.migrationIndexSource !== 'string' ||
    !(snapshot.runtimeSources instanceof Map)
  ) {
    return ['action boundary snapshot is malformed'];
  }

  const errors = [];
  errors.push(
    ...validateRecoverySchedulerSnapshot(
      snapshot.recoverySchedulerSources,
      snapshot.postgresAdapterSource,
      snapshot.migrationIndexSource,
    ),
  );
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
    createHash('sha256')
      .update(snapshot.walletIdentityBindingMigrationSource, 'utf8')
      .digest('hex') !== REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SHA256
  ) {
    errors.push('0034 wallet identity binding migration bytes drifted from the reviewed source');
  }
  if (
    createHash('sha256')
      .update(snapshot.walletIdentityBindingMigrationSpecSource, 'utf8')
      .digest('hex') !== REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_SHA256
  ) {
    errors.push(
      '0034 wallet identity binding migration spec bytes drifted from the reviewed source',
    );
  }
  if (
    createHash('sha256')
      .update(snapshot.walletIdentityBindingMigrationIntegrationSpecSource, 'utf8')
      .digest('hex') !== REVIEWED_ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_SHA256
  ) {
    errors.push(
      '0034 wallet identity binding migration integration spec bytes drifted from the reviewed source',
    );
  }
  if (
    createHash('sha256').update(snapshot.migrationIndexSource, 'utf8').digest('hex') !==
    REVIEWED_DATABASE_MIGRATION_INDEX_SHA256
  ) {
    errors.push('database migration index bytes drifted from the reviewed 0033-0037 registration');
  }
  for (const [field, digest, message] of [
    [
      'finalityEvidenceSourcePortSource',
      REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SHA256,
      'authenticated finality source port bytes drifted from the reviewed source',
    ],
    [
      'finalityEvidenceSourcePortSpecSource',
      REVIEWED_ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_SHA256,
      'authenticated finality source port spec bytes drifted from the reviewed source',
    ],
    [
      'finalityEvidenceProducerSource',
      REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SHA256,
      'authenticated finality producer bytes drifted from the reviewed source',
    ],
    [
      'finalityEvidenceProducerSpecSource',
      REVIEWED_ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_SHA256,
      'authenticated finality producer spec bytes drifted from the reviewed source',
    ],
    [
      'finalitySidecarPortSource',
      REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SHA256,
      'authenticated finality sidecar port bytes drifted from the reviewed source',
    ],
    [
      'finalitySidecarPortSpecSource',
      REVIEWED_ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_SHA256,
      'authenticated finality sidecar port spec bytes drifted from the reviewed source',
    ],
    [
      'finalitySidecarAdapterSource',
      REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SHA256,
      'authenticated finality sidecar adapter bytes drifted from the reviewed source',
    ],
    [
      'finalitySidecarAdapterSpecSource',
      REVIEWED_ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_SHA256,
      'authenticated finality sidecar adapter spec bytes drifted from the reviewed source',
    ],
    [
      'authenticatedFinalityMigrationSource',
      REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SHA256,
      '0035 authenticated finality migration bytes drifted from the reviewed source',
    ],
    [
      'authenticatedFinalityMigrationSpecSource',
      REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_SHA256,
      '0035 authenticated finality migration spec bytes drifted from the reviewed source',
    ],
    [
      'authenticatedFinalityMigrationIntegrationSpecSource',
      REVIEWED_ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256,
      '0035 authenticated finality migration integration spec bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteIssuerPortSource',
      REVIEWED_ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_SHA256,
      '0036 finality prerequisite issuer port bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteAdapterSource',
      REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SHA256,
      '0036 finality prerequisite adapter bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteAdapterSpecSource',
      REVIEWED_ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_SHA256,
      '0036 finality prerequisite adapter spec bytes drifted from the reviewed source',
    ],
    [
      'finalityWalletReaderSource',
      REVIEWED_ACTION_FINALITY_WALLET_READER_SHA256,
      '0036 finality wallet reader bytes drifted from the reviewed source',
    ],
    [
      'finalityWalletReaderSpecSource',
      REVIEWED_ACTION_FINALITY_WALLET_READER_SPEC_SHA256,
      '0036 finality wallet reader spec bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteMigrationSource',
      REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SHA256,
      '0036 finality prerequisite migration bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteMigrationSpecSource',
      REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_SHA256,
      '0036 finality prerequisite migration spec bytes drifted from the reviewed source',
    ],
    [
      'finalityPrerequisiteMigrationIntegrationSpecSource',
      REVIEWED_ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_SHA256,
      '0036 finality prerequisite migration integration spec bytes drifted from the reviewed source',
    ],
    [
      'atomicFinalityMigrationSource',
      REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SHA256,
      '0037 atomic finality migration bytes drifted from the reviewed source',
    ],
    [
      'atomicFinalityMigrationSpecSource',
      REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_SHA256,
      '0037 atomic finality migration spec bytes drifted from the reviewed source',
    ],
    [
      'atomicFinalityMigrationIntegrationSpecSource',
      REVIEWED_ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_SHA256,
      '0037 atomic finality migration integration spec bytes drifted from the reviewed source',
    ],
  ]) {
    if (createHash('sha256').update(snapshot[field], 'utf8').digest('hex') !== digest) {
      errors.push(message);
    }
  }
  errors.push(
    ...validateDormantActionMigrationSnapshot(
      snapshot.migrationSource,
      snapshot.migrationSpecSource,
      snapshot.migrationIndexSource,
    ),
  );
  errors.push(
    ...validateWalletIdentityBindingMigrationSnapshot(
      snapshot.walletIdentityBindingMigrationSource,
      snapshot.walletIdentityBindingMigrationSpecSource,
      snapshot.walletIdentityBindingMigrationIntegrationSpecSource,
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
  errors.push(
    ...validateFinalityEvidenceSnapshot(
      snapshot.finalityEvidenceSourcePortSource,
      snapshot.finalityEvidenceSourcePortSpecSource,
      snapshot.finalityEvidenceProducerSource,
      snapshot.finalityEvidenceProducerSpecSource,
    ),
  );
  errors.push(
    ...validateFinalitySidecarSnapshot(
      snapshot.finalitySidecarPortSource,
      snapshot.finalitySidecarPortSpecSource,
      snapshot.finalitySidecarAdapterSource,
      snapshot.finalitySidecarAdapterSpecSource,
    ),
  );
  errors.push(
    ...validateAuthenticatedFinalityMigrationSnapshot(
      snapshot.authenticatedFinalityMigrationSource,
      snapshot.authenticatedFinalityMigrationSpecSource,
      snapshot.authenticatedFinalityMigrationIntegrationSpecSource,
    ),
  );
  errors.push(
    ...validateAtomicFinalityPrerequisiteSnapshot(
      snapshot.finalityPrerequisiteIssuerPortSource,
      snapshot.finalityPrerequisiteAdapterSource,
      snapshot.finalityPrerequisiteAdapterSpecSource,
      snapshot.finalityWalletReaderSource,
      snapshot.finalityWalletReaderSpecSource,
      snapshot.finalityPrerequisiteMigrationSource,
      snapshot.finalityPrerequisiteMigrationSpecSource,
      snapshot.finalityPrerequisiteMigrationIntegrationSpecSource,
      snapshot.atomicFinalityMigrationSource,
      snapshot.atomicFinalityMigrationSpecSource,
      snapshot.atomicFinalityMigrationIntegrationSpecSource,
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
    } else if (
      normalizedPath(path) !== DATABASE_MIGRATION_INDEX_PATH &&
      RECOVERY_SCHEDULER_RUNTIME_STEMS.some((stem) => runtimeSource.includes(stem))
    ) {
      errors.push(`dormant recovery/scheduler source is referenced by runtime source ${path}`);
    } else if (ACTION_LIFECYCLE_DATABASE_FUNCTION_REFERENCE.test(runtimeSource)) {
      errors.push(
        `migration-0033-0037 action SQL function is referenced outside the reviewed adapters by runtime source ${path}`,
      );
    } else if (
      normalizedPath(path) !== DATABASE_MIGRATION_INDEX_PATH &&
      RUNTIME_REFERENCE.test(runtimeSource)
    ) {
      errors.push(`dormant mainnet action boundary is referenced by runtime source ${path}`);
    } else if (
      normalizedPath(path) !== DATABASE_MIGRATION_INDEX_PATH &&
      ACTION_LIFECYCLE_MIGRATION_REFERENCE.test(runtimeSource)
    ) {
      errors.push(`0033-0037 dormant action persistence is referenced by runtime source ${path}`);
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

function stableStatIdentity(path, kind) {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
  }
  return [
    kind,
    stat.dev,
    stat.ino,
    stat.mode,
    stat.nlink,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
    stat.birthtimeNs,
  ].join(':');
}

function runtimeSourceInventory(repositoryRoot) {
  const root = realpathSync.native(resolve(repositoryRoot));
  const sourceRoot = resolve(root, API_SOURCE_ROOT);
  if (realpathSync.native(sourceRoot) !== sourceRoot) {
    throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
  }
  const paths = [];
  const topology = [];
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
    if (realpathSync.native(directory) !== directory) {
      throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
    }
    topology.push(
      `${normalizedPath(relative(root, directory))}\0${stableStatIdentity(directory, 'directory')}`,
    );
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
        if (entry.isSymbolicLink() || realpathSync.native(absolute) !== absolute) {
          throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
        }
        const path = normalizedPath(relative(root, absolute));
        if (entry.isDirectory()) {
          stableStatIdentity(absolute, 'directory');
          visit(absolute, depth + 1);
        } else if (entry.isFile()) {
          topology.push(`${path}\0${stableStatIdentity(absolute, 'file')}`);
          if (
            (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
            !entry.name.endsWith('.spec.ts')
          ) {
            if (!REVIEWED_DORMANT_SOURCE_PATHS.has(path)) paths.push(path);
            if (paths.length > MAX_ACTION_BOUNDARY_RUNTIME_FILES) {
              throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
            }
          }
        } else {
          throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
        }
      }
    } finally {
      handle.closeSync();
    }
  };
  visit(sourceRoot, 0);
  return Object.freeze({ paths: paths.sort(), topology: topology.sort() });
}

function loadSnapshot(repositoryRoot, afterInitialRuntimeEnumeration) {
  try {
    const initialInventory = runtimeSourceInventory(repositoryRoot);
    afterInitialRuntimeEnumeration?.();
    const runtimeSources = new Map();
    let runtimeBytes = 0;
    for (const path of initialInventory.paths) {
      const source = repositoryFile(repositoryRoot, path);
      runtimeBytes += Buffer.byteLength(source, 'utf8');
      if (runtimeBytes > MAX_ACTION_BOUNDARY_RUNTIME_BYTES) {
        throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
      }
      runtimeSources.set(path, source);
    }
    const snapshot = {
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
      walletIdentityBindingMigrationSource: repositoryFile(
        repositoryRoot,
        ACTION_WALLET_IDENTITY_BINDING_MIGRATION_PATH,
      ),
      walletIdentityBindingMigrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_WALLET_IDENTITY_BINDING_MIGRATION_SPEC_PATH,
      ),
      walletIdentityBindingMigrationIntegrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_WALLET_IDENTITY_BINDING_MIGRATION_INTEGRATION_SPEC_PATH,
      ),
      finalityEvidenceSourcePortSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_EVIDENCE_SOURCE_PORT_PATH,
      ),
      finalityEvidenceSourcePortSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_EVIDENCE_SOURCE_PORT_SPEC_PATH,
      ),
      finalityEvidenceProducerSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_EVIDENCE_PRODUCER_PATH,
      ),
      finalityEvidenceProducerSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_EVIDENCE_PRODUCER_SPEC_PATH,
      ),
      finalitySidecarPortSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_SIDECAR_DURABLE_PORT_PATH,
      ),
      finalitySidecarPortSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_SIDECAR_DURABLE_PORT_SPEC_PATH,
      ),
      finalitySidecarAdapterSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_PATH,
      ),
      finalitySidecarAdapterSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_SIDECAR_POSTGRES_ADAPTER_SPEC_PATH,
      ),
      authenticatedFinalityMigrationSource: repositoryFile(
        repositoryRoot,
        ACTION_AUTHENTICATED_FINALITY_MIGRATION_PATH,
      ),
      authenticatedFinalityMigrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_AUTHENTICATED_FINALITY_MIGRATION_SPEC_PATH,
      ),
      authenticatedFinalityMigrationIntegrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_AUTHENTICATED_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
      ),
      finalityPrerequisiteIssuerPortSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_PREREQUISITE_ISSUER_PORT_PATH,
      ),
      finalityPrerequisiteAdapterSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_PATH,
      ),
      finalityPrerequisiteAdapterSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_PREREQUISITE_POSTGRES_ADAPTER_SPEC_PATH,
      ),
      finalityWalletReaderSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_WALLET_READER_PATH,
      ),
      finalityWalletReaderSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_WALLET_READER_SPEC_PATH,
      ),
      finalityPrerequisiteMigrationSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_PREREQUISITE_MIGRATION_PATH,
      ),
      finalityPrerequisiteMigrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_PREREQUISITE_MIGRATION_SPEC_PATH,
      ),
      finalityPrerequisiteMigrationIntegrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_FINALITY_PREREQUISITE_MIGRATION_INTEGRATION_SPEC_PATH,
      ),
      atomicFinalityMigrationSource: repositoryFile(
        repositoryRoot,
        ACTION_ATOMIC_FINALITY_MIGRATION_PATH,
      ),
      atomicFinalityMigrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_ATOMIC_FINALITY_MIGRATION_SPEC_PATH,
      ),
      atomicFinalityMigrationIntegrationSpecSource: repositoryFile(
        repositoryRoot,
        ACTION_ATOMIC_FINALITY_MIGRATION_INTEGRATION_SPEC_PATH,
      ),
      migrationIndexSource: repositoryFile(repositoryRoot, DATABASE_MIGRATION_INDEX_PATH),
      recoverySchedulerSources: new Map(
        Object.keys(RECOVERY_SCHEDULER_ARTIFACT_SHA256).map((path) => [
          path,
          repositoryFile(repositoryRoot, path),
        ]),
      ),
      runtimeSources,
    };
    const finalInventory = runtimeSourceInventory(repositoryRoot);
    if (
      !exactArray(finalInventory.paths, initialInventory.paths) ||
      !exactArray(finalInventory.topology, initialInventory.topology)
    ) {
      throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
    }
    return snapshot;
  } catch {
    throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
  }
}

export function loadDormantMainnetActionBoundarySnapshot(repositoryRoot = REPOSITORY_ROOT) {
  return loadSnapshot(repositoryRoot);
}

export function loadDormantMainnetActionBoundarySnapshotForTest(
  repositoryRoot,
  afterInitialRuntimeEnumeration,
) {
  if (typeof afterInitialRuntimeEnumeration !== 'function') {
    throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
  }
  return loadSnapshot(repositoryRoot, afterInitialRuntimeEnumeration);
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
      'Dormant mainnet action boundary is valid: 10 candidates, 0 enabled, reviewed 0033-0042 persistence, 0039-0042 unregistered, 42 pinned recovery/scheduler artifacts',
    );
  } else {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}
