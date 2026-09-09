import { createHash } from 'node:crypto';
import { opendirSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIRECTORY_PATH = 'apps/api/src/mainnet-platforms/domain/mainnet-platform-directory.ts';

// Reviewed connection implementations remain private and unregistered. Their
// exact bytes are pinned separately from the six endpoint-free position sources.
export const AAVE_POSITION_CONNECTION_ARTIFACTS = Object.freeze([
  Object.freeze({
    id: 'aave-position-context',
    path: 'apps/api/src/mainnet-platforms/infrastructure/aave-v3-ethereum-position-context.reader.ts',
    specPath:
      'apps/api/src/mainnet-platforms/infrastructure/aave-v3-ethereum-position-context.reader.spec.ts',
    sha256: '43eab5970e38e1f92cc3a2f78fbca9ab66b75e9b9da25cd722c7e27dc0b0a175',
    specSha256: 'cf07132dc706b1e1c07cb0ff5686f926006860df60f776beca882ec833e9a5f7',
    symbols: ['AaveV3EthereumPositionContextReader', 'createPostgresAaveV3EthereumPositionSource'],
  }),
  Object.freeze({
    id: 'aave-position-rpc-transcript',
    path: 'apps/api/src/mainnet-platforms/infrastructure/aave-v3-ethereum-position-rpc-transcript.source.ts',
    specPath:
      'apps/api/src/mainnet-platforms/infrastructure/aave-v3-ethereum-position-rpc-transcript.source.spec.ts',
    sha256: '6a5dadbcf6f11299cf4f800c6ac4bc6cdd44da804017885897ae6d95bcca8ea1',
    specSha256: '0eebfa9a903703a8c3295c0af2848c6762e863610e24b52aecccde2608e3495e',
    symbols: [
      'AaveV3EthereumPositionRpcTranscriptSource',
      'createAaveV3EthereumPositionRpcTranscriptSource',
    ],
  }),
]);

const API_SOURCE_ROOT = 'apps/api/src';
export const MAX_DORMANT_PROVIDER_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_DORMANT_PROVIDER_RUNTIME_FILES = 4_096;
export const MAX_DORMANT_PROVIDER_RUNTIME_BYTES = 24 * 1024 * 1024;
export const MAX_DORMANT_PROVIDER_RUNTIME_DIRECTORIES = 4_096;
export const MAX_DORMANT_PROVIDER_RUNTIME_DEPTH = 64;
export const MAX_DORMANT_PROVIDER_RUNTIME_ENTRIES = 16_384;
export const DORMANT_PROVIDER_INVENTORY_INPUT_ERROR =
  'Dormant provider inventory inputs must be non-empty, stable, single-link regular files of at most 2097152 bytes at canonical paths inside the repository and contain UTF-8 text without a byte-order mark.';

export const DORMANT_PROVIDER_INVENTORY = Object.freeze([
  Object.freeze({
    id: 'aave',
    name: 'Aave',
    protocol: 'Aave V3',
    ecosystem: 'EVM',
    network: 'ETHEREUM',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/aave/aave-v3-ethereum-json-rpc.source.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/aave/aave-v3-ethereum-json-rpc.source.spec.ts',
    researchPath: 'docs/KAN-251.md',
    researchIdentity: 'Aave',
    className: 'FixedAaveV3EthereumJsonRpcSource',
    capabilityPath:
      'apps/api/src/smart-lending/infrastructure/aave/aave-v3-ethereum-deployment-evidence.adapter.ts',
    capabilityMarkers: Object.freeze(['mayAuthorizeFinancialAction: false']),
  }),
  Object.freeze({
    id: 'morpho',
    name: 'Morpho',
    protocol: 'Morpho Blue',
    ecosystem: 'EVM',
    network: 'ETHEREUM',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/morpho/morpho-blue-ethereum-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/morpho/morpho-blue-ethereum-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/morpho-blue-ethereum-finalized-transcript.md',
    researchIdentity: 'Morpho Blue',
    className: 'MorphoBlueEthereumFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'compound',
    name: 'Compound',
    protocol: 'Compound III',
    ecosystem: 'EVM',
    network: 'ETHEREUM',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/compound/compound-iii-ethereum-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/compound/compound-iii-ethereum-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/compound-iii-ethereum-usdc-finalized-transcript.md',
    researchIdentity: 'Compound III',
    className: 'CompoundIIIEthereumFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'spark',
    name: 'Spark',
    protocol: 'SparkLend',
    ecosystem: 'EVM',
    network: 'ETHEREUM',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/spark/sparklend-ethereum-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/spark/sparklend-ethereum-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/sparklend-ethereum-usdc-finalized-transcript.md',
    researchIdentity: 'SparkLend',
    className: 'SparkLendEthereumFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'euler',
    name: 'Euler',
    protocol: 'Euler V2',
    ecosystem: 'EVM',
    network: 'ETHEREUM',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/euler/euler-v2-ethereum-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/euler/euler-v2-ethereum-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/euler-v2-ethereum-finalized-transcript.md',
    researchIdentity: 'Euler V2',
    className: 'EulerV2EthereumFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'gearbox',
    name: 'Gearbox',
    protocol: 'Gearbox V3',
    ecosystem: 'EVM',
    network: 'ETHEREUM',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-ethereum-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-ethereum-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/gearbox-v3-ethereum-usdc-finalized-transcript.md',
    researchIdentity: 'Gearbox V3',
    className: 'GearboxV3EthereumFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'kamino',
    name: 'Kamino',
    protocol: 'Kamino Lend',
    ecosystem: 'SOLANA',
    network: 'SOLANA',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/kamino/kamino-lend-solana-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/kamino/kamino-lend-solana-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/kamino-lend-solana-finalized-transcript.md',
    researchIdentity: 'Kamino Lend',
    className: 'KaminoLendSolanaFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'save',
    name: 'Save',
    protocol: 'Save lending',
    ecosystem: 'SOLANA',
    network: 'SOLANA',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/save/save-lend-solana-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/save/save-lend-solana-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/save-lend-solana-finalized-transcript.md',
    researchIdentity: 'Save Lend',
    className: 'SaveLendSolanaFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'project-0',
    name: 'Project 0',
    protocol: 'marginfi v2',
    ecosystem: 'SOLANA',
    network: 'SOLANA',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/marginfi/marginfi-v2-solana-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/marginfi/marginfi-v2-solana-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/marginfi-v2-solana-finalized-transcript.md',
    researchIdentity: 'Marginfi v2',
    className: 'MarginfiV2SolanaFinalizedTranscriptAdapter',
  }),
  Object.freeze({
    id: 'jupiter',
    name: 'Jupiter',
    protocol: 'Jupiter Lend',
    ecosystem: 'SOLANA',
    network: 'SOLANA',
    adapterPath:
      'apps/api/src/smart-lending/infrastructure/jupiter/jupiter-lend-solana-finalized-transcript.adapter.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/jupiter/jupiter-lend-solana-finalized-transcript.adapter.spec.ts',
    researchPath: 'docs/provider-research/jupiter-lend-solana-finalized-transcript.md',
    researchIdentity: 'Jupiter Lend',
    className: 'JupiterLendSolanaFinalizedTranscriptAdapter',
  }),
]);

export const ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS = Object.freeze([
  Object.freeze({
    id: 'kamino-provider-position-source',
    providerId: 'kamino',
    path: 'apps/api/src/mainnet-platforms/infrastructure/dormant-kamino-provider-position-admission.source.ts',
    sha256: 'eacdafa7fcd5fa5574183d0f0e2beb6a02c270cd8ecd71be6b7a120ca60355a6',
    className: 'DormantKaminoProviderPositionAdmissionSource',
    dependencyStems: Object.freeze(['kamino-lend-solana-finalized-transcript.adapter']),
    capabilityMarkers: Object.freeze([
      'mayAuthorizeFinancialAction: false',
      'mayPersist: false',
      'maySign: false',
      'mayAccessWalletPrivateKey: false',
    ]),
  }),
  Object.freeze({
    id: 'morpho-provider-position-source',
    providerId: 'morpho',
    path: 'apps/api/src/mainnet-platforms/infrastructure/dormant-morpho-blue-ethereum-provider-position.source.ts',
    specPath:
      'apps/api/src/mainnet-platforms/infrastructure/dormant-morpho-blue-ethereum-provider-position.source.spec.ts',
    sha256: '54f62b9eb29b806109431c62e5a489c2c3bb5df01c0afc5fe1586377e4afecec',
    specSha256: 'cb5b83ecf4e6803dba79aee4acfa88b25563cf3220f0fe4c2b642bcb3b75e782',
    className: 'DormantMorphoBlueEthereumProviderPositionSource',
    dependencyStems: Object.freeze([
      'morpho-blue-ethereum-finalized-transcript.adapter',
      'morpho-blue-account-position.semantics',
    ]),
    minimumTests: 15,
    capabilityMarkers: Object.freeze([
      'mayAuthorizeFinancialAction: false',
      'mayPersist: false',
      'mayCreatePositionSnapshot: false',
      'maySign: false',
      'mayAccessWalletPrivateKey: false',
    ]),
  }),
  Object.freeze({
    id: 'euler-provider-position-source',
    providerId: 'euler',
    path: 'apps/api/src/mainnet-platforms/infrastructure/dormant-euler-v2-ethereum-provider-position.source.ts',
    specPath:
      'apps/api/src/mainnet-platforms/infrastructure/dormant-euler-v2-ethereum-provider-position.source.spec.ts',
    sha256: '538d3d33eff4d9cabc6af2f1da9d768fcff80f4301f801eaadc3e565f7924506',
    specSha256: '08dbd9046333d67e336dab7f1fdca43bbaaeb5854205543bf1a5ad3a9d1e8be7',
    className: 'DormantEulerV2EthereumProviderPositionSource',
    dependencyStems: Object.freeze([
      'euler-v2-ethereum-finalized-transcript.adapter',
      'euler-v2-account-position.semantics',
    ]),
    minimumTests: 8,
    capabilityMarkers: Object.freeze([
      'mayAuthorizeFinancialAction: false',
      'mayPersist: false',
      'mayCreatePositionSnapshot: false',
      'maySign: false',
      'mayAccessWalletPrivateKey: false',
    ]),
  }),
]);

export const DORMANT_ACCOUNT_POSITION_TRANSCRIPTS = Object.freeze([
  Object.freeze({
    id: 'gearbox-account-position-transcript',
    providerId: 'gearbox',
    path: 'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-account-position.transcript.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-account-position.transcript.spec.ts',
    sha256: '653e5915302b82566b6acfd44a4ee7db6d860a0c1dde883d678a7d107ddf7ad9',
    specSha256: '2ea638ca814e0d586b59077438def6ac2250e00646cadb045618657286bff74f',
    className: 'DormantGearboxV3AccountPositionTranscriptEvaluator',
    useSymbol: 'GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_USE',
    use: 'DORMANT_GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VALIDATION_ONLY',
    approvalUseSymbol: 'GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_USE',
    approvalUse: 'CALLER_SUPPLIED_GEARBOX_V3_ACCOUNT_POSITION_TOPOLOGY_APPROVAL_ONLY',
    semanticsId: 'gearbox-account-position-semantics',
    minimumTests: 17,
    imports: Object.freeze([
      'node:buffer',
      'node:crypto',
      'node:util/types',
      './gearbox-v3-ethereum-usdc.manifest',
      './gearbox-v3-account-position.semantics',
    ]),
    capabilityMarkers: Object.freeze([
      'mayEstablishRecommendationEligibility: false',
      'mayAuthorizeFinancialAction: false',
      'mayPersist: false',
      'mayCreatePositionSnapshot: false',
      'maySign: false',
      'mayAccessWalletPrivateKey: false',
      'mayEstablishCompletePosition: false',
    ]),
  }),
]);

export const DORMANT_ACCOUNT_POSITION_SEMANTICS = Object.freeze([
  Object.freeze({
    id: 'morpho-account-position-semantics',
    providerId: 'morpho',
    path: 'apps/api/src/smart-lending/infrastructure/morpho/morpho-blue-account-position.semantics.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/morpho/morpho-blue-account-position.semantics.spec.ts',
    useSymbol: 'MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE',
    use: 'DORMANT_MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_ONLY',
    minimumTests: 10,
    sha256: 'ddf94542537ec5595b65143fc2563ead405edc6fc61a3abc077b58bf3420e0f6',
    specSha256: '4f9ca78e82be564cbfddba0994d8c845025759a006ba90d63f2af9264270853b',
  }),
  Object.freeze({
    id: 'euler-account-position-semantics',
    providerId: 'euler',
    path: 'apps/api/src/smart-lending/infrastructure/euler/euler-v2-account-position.semantics.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/euler/euler-v2-account-position.semantics.spec.ts',
    useSymbol: 'EULER_V2_ACCOUNT_POSITION_SEMANTICS_USE',
    use: 'DORMANT_EULER_V2_ACCOUNT_AND_EVC_SEMANTICS_ONLY',
    minimumTests: 7,
    sha256: 'dfcb25ed82404ed8e8ce388b1045d09a31e579cf907b5df543d3c26b5fe93977',
    specSha256: 'bced3208b1c384176ac05f2a24def3bc463d27bb2c6b38851e06560207e90c21',
  }),
  Object.freeze({
    id: 'gearbox-account-position-semantics',
    providerId: 'gearbox',
    path: 'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-account-position.semantics.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/gearbox/gearbox-v3-account-position.semantics.spec.ts',
    useSymbol: 'GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_USE',
    use: 'DORMANT_GEARBOX_V3_USDC_ACCOUNT_POSITION_SEMANTICS_ONLY',
    minimumTests: 13,
    sha256: 'b7237a614b04658cf54a520907151742ba59670f96860ce8b7d2f9333b4ad59b',
    specSha256: '77564a7329dbe0454a07a24bfb2b34c42d3dbba80b5569ee1bf6e14772e43358',
  }),
  Object.freeze({
    id: 'save-account-position-semantics',
    providerId: 'save',
    path: 'apps/api/src/smart-lending/infrastructure/save/save-lend-account-position.semantics.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/save/save-lend-account-position.semantics.spec.ts',
    useSymbol: 'SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE',
    use: 'DORMANT_SAVE_LEND_ACCOUNT_POSITION_SUPPLIED_SNAPSHOT_ONLY',
    minimumTests: 9,
    sha256: 'e57b679cbc1218f481e7b2402db46fe57ff4db3e91c7311c5e4e5cd61b540c09',
    specSha256: 'dff7d31028aedaa4d50324e368ee9755f41ddc5f33e333b9d7b2c323723b47d4',
  }),
  Object.freeze({
    id: 'marginfi-account-position-semantics',
    providerId: 'project-0',
    path: 'apps/api/src/smart-lending/infrastructure/marginfi/marginfi-v2-account-position.semantics.ts',
    specPath:
      'apps/api/src/smart-lending/infrastructure/marginfi/marginfi-v2-account-position.semantics.spec.ts',
    useSymbol: 'MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE',
    use: 'DORMANT_MARGINFI_V2_ACCOUNT_POSITION_SUPPLIED_SNAPSHOT_ONLY',
    minimumTests: 14,
    sha256: 'dacd560ed037d7c4355a069dda3b911abae1cd081850c7fb38b247ce4450b7ab',
    specSha256: '97d921a4f0bdd1997aba09d5278de3c8b358e80401e42866b3a38b7ccfb41dc7',
  }),
]);

const STANDARD_CAPABILITY_MARKERS = Object.freeze([
  'mayPersist: false',
  'mayEstablishRecommendationEligibility: false',
  'mayAuthorizeFinancialAction: false',
]);

const UNSAFE_CAPABILITY =
  /\b(?:mayPersist|mayEstablishRecommendationEligibility|mayEstablishCompletePosition|mayAuthorizeFinancialAction|mayCreatePositionSnapshot|maySign|mayAccessWalletPrivateKey)\s*:\s*true\b/u;
const REVIEWED_SEMANTICS_IMPORTS = Object.freeze([
  'node:crypto',
  'node:util/types',
  'viem',
  '../../../wallets/domain/wallet-identity',
]);
const PROHIBITED_SEMANTICS_RUNTIME =
  /(?:\bprocess(?:\.|\[)|\b(?:fetch|WebSocket|XMLHttpRequest|eval|Function)\s*\()/u;
const PROHIBITED_PROVIDER_POSITION_SOURCE =
  /(?:\bprocess(?:\.|\[)|\b(?:fetch|WebSocket|XMLHttpRequest|eval|Function)\s*\(|\b(?:require|import)\s*\(|\b(?:send(?:Raw)?|sign|broadcast)Transaction\b|\bhttps?:\/\/|\bDATABASE_URL\b|@(Injectable|Module|Controller)\s*\()/u;
const PROHIBITED_PROVIDER_POSITION_IMPORT =
  /^(?:node:(?:http|https|net|tls|dns|dgram|child_process|fs(?:\/promises)?)|@nestjs\/|pg$|ioredis$|undici$)/u;
const PREEXISTING_DORMANT_PROVIDER_POSITION_SOURCE_PATHS = new Set([
  'apps/api/src/mainnet-platforms/infrastructure/dormant-aave-v3-ethereum-provider-position.source.ts',
  'apps/api/src/mainnet-platforms/infrastructure/dormant-compound-iii-ethereum-provider-position.source.ts',
  'apps/api/src/mainnet-platforms/infrastructure/dormant-sparklend-ethereum-provider-position.source.ts',
]);
const PINNED_DORMANT_PROVIDER_POSITION_SOURCE_PATHS = new Set(
  ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.filter(({ path }) =>
    path.endsWith('-provider-position.source.ts'),
  ).map(({ path }) => path),
);
const DORMANT_PROVIDER_POSITION_SOURCE_REFERENCE =
  /(?:[A-Za-z0-9._/-]+-provider-position\.source|Dormant[A-Za-z0-9]+ProviderPositionSource)/u;
const GEARBOX_ACCOUNT_POSITION_TRANSCRIPT_PATH =
  /^apps\/api\/src\/smart-lending\/infrastructure\/gearbox\/[^/]+\.transcript\.ts$/u;
const REVIEWED_RUNTIME_DYNAMIC_IMPORTS = new Map([
  ['apps/api/src/application-root.ts', Object.freeze(['./local-development-app.module'])],
  [
    'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.ts',
    Object.freeze(['./balance-sync-consumer.runtime']),
  ],
]);
const PLANNED_PLATFORM =
  /plannedPlatform\(\s*\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*protocol:\s*'([^']+)'\s*\}\s*,\s*'(EVM|SOLANA)'\s*,\s*\[\s*(ETHEREUM|SOLANA)\s*,?\s*\]\s*\)/gu;

function normalizedPath(path) {
  return path.split('\\').join('/');
}

function adapterImportStem(path) {
  return path.slice(path.lastIndexOf('/') + 1, -3);
}

function countTests(source) {
  return [...source.matchAll(/\b(?:it|test)\s*\(/gu)].length;
}

function importedModules(source) {
  return [...source.matchAll(/\b(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)].map((match) => match[1]);
}

function sameStringList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasUnreviewedDynamicLoading(path, source) {
  if (/\b(?:require|eval|Function)\s*\(/u.test(source)) return true;
  const tokenCount = (source.match(/\bimport\s*\(/gu) ?? []).length;
  const literalImports = [...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/gu)].map(
    (match) => match[2],
  );
  const expected = REVIEWED_RUNTIME_DYNAMIC_IMPORTS.get(normalizedPath(path)) ?? [];
  return (
    tokenCount !== literalImports.length ||
    literalImports.length !== expected.length ||
    literalImports.some((value, index) => value !== expected[index])
  );
}

function parsePlannedProviders(source) {
  return [...source.matchAll(PLANNED_PLATFORM)].map((match) => ({
    id: match[1],
    name: match[2],
    protocol: match[3],
    ecosystem: match[4],
    network: match[5],
  }));
}

function expectedPlanningEntry(provider) {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    ecosystem: provider.ecosystem,
    network: provider.network,
  };
}

function samePlanningEntry(left, right) {
  return (
    left?.id === right.id &&
    left?.name === right.name &&
    left?.protocol === right.protocol &&
    left?.ecosystem === right.ecosystem &&
    left?.network === right.network
  );
}

export function validateDormantProviderInventorySnapshot(snapshot) {
  const errors = [];
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    typeof snapshot.directorySource !== 'string' ||
    !(snapshot.artifacts instanceof Map) ||
    !(snapshot.runtimeSources instanceof Map)
  ) {
    return ['inventory snapshot is malformed'];
  }

  if (DORMANT_PROVIDER_INVENTORY.length !== 10) {
    errors.push('validator inventory must contain exactly ten providers');
  }
  if (new Set(DORMANT_PROVIDER_INVENTORY.map(({ id }) => id)).size !== 10) {
    errors.push('validator inventory contains a duplicate provider id');
  }
  if (
    ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.length !== 3 ||
    new Set(ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.map(({ id }) => id)).size !== 3
  ) {
    errors.push('validator must contain exactly three distinct additional dormant artifacts');
  }
  if (
    DORMANT_ACCOUNT_POSITION_TRANSCRIPTS.length !== 1 ||
    new Set(DORMANT_ACCOUNT_POSITION_TRANSCRIPTS.map(({ id }) => id)).size !== 1
  ) {
    errors.push('validator must contain exactly one distinct dormant account-position transcript');
  }
  if (
    DORMANT_ACCOUNT_POSITION_SEMANTICS.length !== 5 ||
    new Set(DORMANT_ACCOUNT_POSITION_SEMANTICS.map(({ id }) => id)).size !== 5 ||
    new Set(DORMANT_ACCOUNT_POSITION_SEMANTICS.map(({ providerId }) => providerId)).size !== 5
  ) {
    errors.push(
      'validator must contain exactly five distinct account-position semantics artifacts',
    );
  }

  const plannedProviders = parsePlannedProviders(snapshot.directorySource);
  if (plannedProviders.length !== DORMANT_PROVIDER_INVENTORY.length) {
    errors.push('planning directory must contain exactly the reviewed ten providers');
  }
  DORMANT_PROVIDER_INVENTORY.forEach((provider, index) => {
    if (!samePlanningEntry(plannedProviders[index], expectedPlanningEntry(provider))) {
      errors.push(`planning directory entry ${index + 1} does not match ${provider.id}`);
    }
  });

  for (const marker of [
    'export const MAINNET_PLATFORM_MINIMUM_PROVIDER_TARGET = 10 as const',
    "integrationStatus: 'PLANNED' as const",
    "dataStatus: 'NOT_CONNECTED' as const",
    "accessStatus: 'UNAVAILABLE' as const",
    "riskStatus: 'NOT_ASSESSED' as const",
    'supportedActions: NO_SUPPORTED_ACTIONS',
    'mayAuthorizeFinancialAction: false as const',
  ]) {
    if (!snapshot.directorySource.includes(marker)) {
      errors.push(`planning directory is missing closed-state marker: ${marker}`);
    }
  }
  if (UNSAFE_CAPABILITY.test(snapshot.directorySource)) {
    errors.push('planning directory enables a prohibited provider capability');
  }

  const exactArtifactPaths = new Set();
  for (const provider of DORMANT_PROVIDER_INVENTORY) {
    const paths = [
      provider.adapterPath,
      provider.specPath,
      provider.researchPath,
      provider.capabilityPath,
    ].filter(Boolean);
    for (const path of paths) exactArtifactPaths.add(path);

    const adapter = snapshot.artifacts.get(provider.adapterPath);
    const spec = snapshot.artifacts.get(provider.specPath);
    const research = snapshot.artifacts.get(provider.researchPath);
    const capability = snapshot.artifacts.get(provider.capabilityPath ?? provider.adapterPath);
    if (typeof adapter !== 'string') {
      errors.push(`${provider.id} adapter artifact is missing`);
      continue;
    }
    if (typeof spec !== 'string') errors.push(`${provider.id} spec artifact is missing`);
    if (typeof research !== 'string') errors.push(`${provider.id} research artifact is missing`);
    if (typeof capability !== 'string')
      errors.push(`${provider.id} capability artifact is missing`);

    if (!adapter.includes(`export class ${provider.className}`)) {
      errors.push(`${provider.id} adapter class identity drifted`);
    }
    if (/@(Injectable|Module|Controller)\s*\(/u.test(adapter)) {
      errors.push(`${provider.id} adapter contains a runtime registration decorator`);
    }
    if (UNSAFE_CAPABILITY.test(adapter) || (capability && UNSAFE_CAPABILITY.test(capability))) {
      errors.push(`${provider.id} enables a prohibited provider capability`);
    }
    for (const marker of provider.capabilityMarkers ?? STANDARD_CAPABILITY_MARKERS) {
      if (!capability?.includes(marker)) {
        errors.push(`${provider.id} is missing closed capability marker: ${marker}`);
      }
    }
    if (typeof spec === 'string') {
      if (!spec.includes(`./${adapterImportStem(provider.adapterPath)}`)) {
        errors.push(`${provider.id} spec is not bound to its exact adapter`);
      }
      if (countTests(spec) < 5) errors.push(`${provider.id} spec lacks hostile-path depth`);
    }
    if (typeof research === 'string' && !/\bdormant\b/iu.test(research)) {
      errors.push(`${provider.id} research does not state that the adapter is dormant`);
    }
    if (
      typeof research === 'string' &&
      !research.toLocaleLowerCase('en-US').includes(provider.researchIdentity.toLowerCase())
    ) {
      errors.push(`${provider.id} research is not bound to its provider identity`);
    }
  }

  for (const artifact of ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS) {
    exactArtifactPaths.add(artifact.path);
    if (artifact.specPath) exactArtifactPaths.add(artifact.specPath);
    const provider = DORMANT_PROVIDER_INVENTORY.find(({ id }) => id === artifact.providerId);
    if (
      provider === undefined ||
      !artifact.dependencyStems.includes(adapterImportStem(provider.adapterPath))
    ) {
      errors.push(`${artifact.id} reviewed dormant dependency identity drifted`);
    }
    const source = snapshot.artifacts.get(artifact.path);
    const spec = artifact.specPath ? snapshot.artifacts.get(artifact.specPath) : undefined;
    if (typeof source !== 'string') {
      errors.push(`${artifact.id} artifact is missing`);
      continue;
    }
    if (artifact.specPath && typeof spec !== 'string') {
      errors.push(`${artifact.id} spec artifact is missing`);
    }
    if (createHash('sha256').update(source, 'utf8').digest('hex') !== artifact.sha256) {
      errors.push(`${artifact.id} artifact bytes drifted`);
    }
    if (
      artifact.specPath &&
      typeof spec === 'string' &&
      createHash('sha256').update(spec, 'utf8').digest('hex') !== artifact.specSha256
    ) {
      errors.push(`${artifact.id} spec bytes drifted`);
    }
    if (!source.includes(`export class ${artifact.className}`)) {
      errors.push(`${artifact.id} class identity drifted`);
    }
    for (const dependencyStem of artifact.dependencyStems) {
      if (!source.includes(dependencyStem)) {
        errors.push(`${artifact.id} reviewed dormant dependency is missing: ${dependencyStem}`);
      }
    }
    if (/@(Injectable|Module|Controller)\s*\(/u.test(source)) {
      errors.push(`${artifact.id} contains a runtime registration decorator`);
    }
    if (UNSAFE_CAPABILITY.test(source)) {
      errors.push(`${artifact.id} enables a prohibited provider capability`);
    }
    for (const marker of artifact.capabilityMarkers) {
      if (!source.includes(marker)) {
        errors.push(`${artifact.id} is missing closed capability marker: ${marker}`);
      }
    }
    if (
      PROHIBITED_PROVIDER_POSITION_SOURCE.test(source) ||
      importedModules(source).some((dependency) =>
        PROHIBITED_PROVIDER_POSITION_IMPORT.test(dependency),
      )
    ) {
      errors.push(
        `${artifact.id} contains transport, persistence, dynamic code, or runtime authority`,
      );
    }
    if (
      artifact.specPath &&
      typeof spec === 'string' &&
      (!spec.includes(`./${adapterImportStem(artifact.path)}`) ||
        countTests(spec) < artifact.minimumTests)
    ) {
      errors.push(`${artifact.id} spec is detached or lacks hostile-path depth`);
    }
  }

  for (const transcript of DORMANT_ACCOUNT_POSITION_TRANSCRIPTS) {
    exactArtifactPaths.add(transcript.path);
    exactArtifactPaths.add(transcript.specPath);
    const provider = DORMANT_PROVIDER_INVENTORY.find(({ id }) => id === transcript.providerId);
    const semantics = DORMANT_ACCOUNT_POSITION_SEMANTICS.find(
      ({ id }) => id === transcript.semanticsId,
    );
    if (provider?.id !== 'gearbox' || semantics?.providerId !== transcript.providerId) {
      errors.push(`${transcript.id} reviewed provider or semantics identity drifted`);
    }

    const source = snapshot.artifacts.get(transcript.path);
    const spec = snapshot.artifacts.get(transcript.specPath);
    if (typeof source !== 'string') {
      errors.push(`${transcript.id} artifact is missing`);
      continue;
    }
    if (typeof spec !== 'string') errors.push(`${transcript.id} spec artifact is missing`);
    if (createHash('sha256').update(source, 'utf8').digest('hex') !== transcript.sha256) {
      errors.push(`${transcript.id} artifact bytes drifted`);
    }
    if (
      typeof spec === 'string' &&
      createHash('sha256').update(spec, 'utf8').digest('hex') !== transcript.specSha256
    ) {
      errors.push(`${transcript.id} spec bytes drifted`);
    }
    if (!source.includes(`export class ${transcript.className}`)) {
      errors.push(`${transcript.id} class identity drifted`);
    }
    if (
      !source.includes(`export const ${transcript.useSymbol}`) ||
      !source.includes(`'${transcript.use}' as const`) ||
      !source.includes(`export const ${transcript.approvalUseSymbol}`) ||
      !source.includes(`'${transcript.approvalUse}' as const`)
    ) {
      errors.push(`${transcript.id} dormant or caller-supplied use identity drifted`);
    }
    for (const marker of transcript.capabilityMarkers) {
      if (!source.includes(marker)) {
        errors.push(`${transcript.id} is missing closed capability marker: ${marker}`);
      }
    }
    if (!sameStringList(importedModules(source), transcript.imports)) {
      errors.push(`${transcript.id} exact reviewed imports drifted`);
    }
    if (
      /@(Injectable|Module|Controller)\s*\(/u.test(source) ||
      UNSAFE_CAPABILITY.test(source) ||
      PROHIBITED_PROVIDER_POSITION_SOURCE.test(source) ||
      importedModules(source).some((dependency) =>
        PROHIBITED_PROVIDER_POSITION_IMPORT.test(dependency),
      )
    ) {
      errors.push(`${transcript.id} contains network, dynamic, Nest, or financial authority`);
    }
    if (
      typeof spec === 'string' &&
      (!spec.includes(`./${adapterImportStem(transcript.path)}`) ||
        countTests(spec) < transcript.minimumTests)
    ) {
      errors.push(`${transcript.id} spec is detached or lacks hostile-path depth`);
    }
  }

  for (const semantics of DORMANT_ACCOUNT_POSITION_SEMANTICS) {
    exactArtifactPaths.add(semantics.path);
    exactArtifactPaths.add(semantics.specPath);
    const provider = DORMANT_PROVIDER_INVENTORY.find(({ id }) => id === semantics.providerId);
    if (provider === undefined) {
      errors.push(`${semantics.id} is not bound to a reviewed provider`);
    }
    const source = snapshot.artifacts.get(semantics.path);
    const spec = snapshot.artifacts.get(semantics.specPath);
    if (typeof source !== 'string') {
      errors.push(`${semantics.id} artifact is missing`);
      continue;
    }
    if (typeof spec !== 'string') errors.push(`${semantics.id} spec artifact is missing`);
    if (createHash('sha256').update(source, 'utf8').digest('hex') !== semantics.sha256) {
      errors.push(`${semantics.id} bytes drifted`);
    }
    if (
      typeof spec === 'string' &&
      createHash('sha256').update(spec, 'utf8').digest('hex') !== semantics.specSha256
    ) {
      errors.push(`${semantics.id} spec bytes drifted`);
    }
    if (
      !source.includes(`export const ${semantics.useSymbol}`) ||
      !source.includes(`'${semantics.use}' as const`)
    ) {
      errors.push(`${semantics.id} dormant use identity drifted`);
    }
    if (/@(Injectable|Module|Controller)\s*\(/u.test(source)) {
      errors.push(`${semantics.id} contains a runtime registration decorator`);
    }
    if (UNSAFE_CAPABILITY.test(source)) {
      errors.push(`${semantics.id} enables a prohibited provider capability`);
    }
    for (const marker of [
      'mayPersist: false',
      'mayAuthorizeFinancialAction: false',
      'mayEstablishCompletePosition: false',
    ]) {
      if (!source.includes(marker)) {
        errors.push(`${semantics.id} is missing closed capability marker: ${marker}`);
      }
    }
    if (
      importedModules(source).some(
        (dependency) => !REVIEWED_SEMANTICS_IMPORTS.includes(dependency),
      ) ||
      /\b(?:import|require)\s*\(/u.test(source) ||
      PROHIBITED_SEMANTICS_RUNTIME.test(source)
    ) {
      errors.push(`${semantics.id} imports an unreviewed or dynamic dependency`);
    }
    if (
      typeof spec === 'string' &&
      (!spec.includes(`./${adapterImportStem(semantics.path)}`) ||
        countTests(spec) < semantics.minimumTests)
    ) {
      errors.push(`${semantics.id} spec is detached or lacks hostile-path depth`);
    }
  }

  const gearboxSemantics = DORMANT_ACCOUNT_POSITION_SEMANTICS.find(
    ({ id }) => id === 'gearbox-account-position-semantics',
  );
  const gearboxTranscript = DORMANT_ACCOUNT_POSITION_TRANSCRIPTS[0];
  if (gearboxSemantics && gearboxTranscript) {
    const permittedGearboxSemanticsImporters = new Set([
      gearboxSemantics.specPath,
      gearboxTranscript.path,
      gearboxTranscript.specPath,
    ]);
    const semanticsImportStem = adapterImportStem(gearboxSemantics.path);
    for (const [path, source] of snapshot.artifacts) {
      if (
        !permittedGearboxSemanticsImporters.has(path) &&
        typeof source === 'string' &&
        importedModules(source).some((dependency) => dependency.includes(semanticsImportStem))
      ) {
        errors.push(`unreviewed artifact imports Gearbox account-position semantics: ${path}`);
      }
    }
  }

  for (const artifact of AAVE_POSITION_CONNECTION_ARTIFACTS) {
    for (const [path, expectedHash] of [
      [artifact.path, artifact.sha256],
      [artifact.specPath, artifact.specSha256],
    ]) {
      exactArtifactPaths.add(path);
      const source = snapshot.artifacts.get(path);
      if (
        typeof source !== 'string' ||
        createHash('sha256').update(source, 'utf8').digest('hex') !== expectedHash
      ) {
        errors.push(`${artifact.id} reviewed connection artifact is missing or drifted: ${path}`);
      }
    }
  }

  for (const path of snapshot.artifacts.keys()) {
    if (!exactArtifactPaths.has(path)) errors.push(`unexpected inventory artifact: ${path}`);
  }

  for (const [path, source] of snapshot.runtimeSources) {
    if (typeof path !== 'string' || typeof source !== 'string') {
      errors.push('runtime source inventory is malformed');
      continue;
    }
    const normalizedRuntimePath = normalizedPath(path);
    const reviewedTranscript = DORMANT_ACCOUNT_POSITION_TRANSCRIPTS.find(
      ({ path: transcriptPath }) => transcriptPath === normalizedRuntimePath,
    );
    if (reviewedTranscript) {
      errors.push(`reviewed dormant account-position transcript was included as runtime: ${path}`);
    } else if (GEARBOX_ACCOUNT_POSITION_TRANSCRIPT_PATH.test(normalizedRuntimePath)) {
      errors.push(`unreviewed Gearbox account-position transcript artifact: ${path}`);
    } else if (PINNED_DORMANT_PROVIDER_POSITION_SOURCE_PATHS.has(normalizedRuntimePath)) {
      errors.push(`reviewed dormant provider-position source was included as runtime: ${path}`);
    } else if (
      normalizedRuntimePath.endsWith('-provider-position.source.ts') &&
      !PREEXISTING_DORMANT_PROVIDER_POSITION_SOURCE_PATHS.has(normalizedRuntimePath)
    ) {
      errors.push(`unreviewed provider-position source artifact: ${path}`);
    } else if (
      !PREEXISTING_DORMANT_PROVIDER_POSITION_SOURCE_PATHS.has(normalizedRuntimePath) &&
      DORMANT_PROVIDER_POSITION_SOURCE_REFERENCE.test(source)
    ) {
      errors.push(`dormant provider-position source is referenced by runtime source ${path}`);
    }
    if (hasUnreviewedDynamicLoading(path, source)) {
      errors.push(`runtime source contains unreviewed dynamic loading: ${path}`);
    }
    for (const artifact of AAVE_POSITION_CONNECTION_ARTIFACTS) {
      if (
        normalizedRuntimePath === artifact.path ||
        artifact.symbols.some((symbol) => source.includes(symbol)) ||
        source.includes(adapterImportStem(artifact.path))
      ) {
        errors.push(`${artifact.id} private connection is referenced by runtime source ${path}`);
      }
    }
    for (const provider of DORMANT_PROVIDER_INVENTORY) {
      if (
        source.includes(provider.className) ||
        source.includes(adapterImportStem(provider.adapterPath))
      ) {
        errors.push(`${provider.id} dormant adapter is referenced by runtime source ${path}`);
      }
    }
    for (const artifact of ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS) {
      if (
        source.includes(artifact.className) ||
        source.includes(adapterImportStem(artifact.path))
      ) {
        errors.push(`${artifact.id} is referenced by runtime source ${path}`);
      }
    }
    for (const transcript of DORMANT_ACCOUNT_POSITION_TRANSCRIPTS) {
      if (
        source.includes(transcript.className) ||
        source.includes(transcript.useSymbol) ||
        source.includes(adapterImportStem(transcript.path))
      ) {
        errors.push(`${transcript.id} is referenced by runtime source ${path}`);
      }
    }
    for (const semantics of DORMANT_ACCOUNT_POSITION_SEMANTICS) {
      if (
        source.includes(semantics.useSymbol) ||
        source.includes(adapterImportStem(semantics.path))
      ) {
        errors.push(`${semantics.id} is referenced by runtime source ${path}`);
      }
    }
    if (path.endsWith('-account-position.semantics.ts')) {
      errors.push(`unreviewed account-position semantics artifact: ${path}`);
    }
  }

  return [...new Set(errors)];
}

function repositoryFile(repositoryRoot, path, maximumBytes, afterFirstReadForTest) {
  try {
    const root = realpathSync.native(resolve(repositoryRoot));
    const resolved = resolve(root, path);
    const relation = relative(root, resolved);
    if (relation === '' || relation.startsWith(`..${sep}`) || relation === '..') {
      throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
    }
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(resolved, maximumBytes)
        : readSecureLocalFileForTest(resolved, maximumBytes, () => afterFirstReadForTest(path));
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
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
      directories > MAX_DORMANT_PROVIDER_RUNTIME_DIRECTORIES ||
      depth > MAX_DORMANT_PROVIDER_RUNTIME_DEPTH
    ) {
      throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
    }
    const handle = opendirSync(directory);
    try {
      for (;;) {
        const entry = handle.readSync();
        if (entry === null) break;
        entries += 1;
        if (entries > MAX_DORMANT_PROVIDER_RUNTIME_ENTRIES) {
          throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
        }
        const absolute = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) {
          throw new Error('runtime source tree contains a symbolic link');
        }
        if (entry.isDirectory()) {
          visit(absolute, depth + 1);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          paths.push(normalizedPath(relative(repositoryRoot, absolute)));
          if (paths.length > MAX_DORMANT_PROVIDER_RUNTIME_FILES) {
            throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
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

function loadDormantProviderInventorySnapshotInternal(repositoryRoot, afterFirstReadForTest) {
  const artifacts = new Map();
  for (const provider of DORMANT_PROVIDER_INVENTORY) {
    for (const path of [
      provider.adapterPath,
      provider.specPath,
      provider.researchPath,
      provider.capabilityPath,
    ].filter(Boolean)) {
      if (!artifacts.has(path)) {
        artifacts.set(
          path,
          repositoryFile(
            repositoryRoot,
            path,
            MAX_DORMANT_PROVIDER_ARTIFACT_BYTES,
            afterFirstReadForTest,
          ),
        );
      }
    }
  }

  for (const artifact of [
    ...ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS,
    ...AAVE_POSITION_CONNECTION_ARTIFACTS,
  ]) {
    for (const path of [artifact.path, artifact.specPath].filter(Boolean)) {
      artifacts.set(
        path,
        repositoryFile(
          repositoryRoot,
          path,
          MAX_DORMANT_PROVIDER_ARTIFACT_BYTES,
          afterFirstReadForTest,
        ),
      );
    }
  }

  for (const transcript of DORMANT_ACCOUNT_POSITION_TRANSCRIPTS) {
    for (const path of [transcript.path, transcript.specPath]) {
      artifacts.set(
        path,
        repositoryFile(
          repositoryRoot,
          path,
          MAX_DORMANT_PROVIDER_ARTIFACT_BYTES,
          afterFirstReadForTest,
        ),
      );
    }
  }

  for (const semantics of DORMANT_ACCOUNT_POSITION_SEMANTICS) {
    for (const path of [semantics.path, semantics.specPath]) {
      if (!artifacts.has(path)) {
        artifacts.set(
          path,
          repositoryFile(
            repositoryRoot,
            path,
            MAX_DORMANT_PROVIDER_ARTIFACT_BYTES,
            afterFirstReadForTest,
          ),
        );
      }
    }
  }

  const adapterPaths = new Set([
    ...DORMANT_PROVIDER_INVENTORY.map(({ adapterPath }) => adapterPath),
    ...ADDITIONAL_DORMANT_PROVIDER_ARTIFACTS.map(({ path }) => path),
    ...DORMANT_ACCOUNT_POSITION_TRANSCRIPTS.map(({ path }) => path),
    ...DORMANT_ACCOUNT_POSITION_SEMANTICS.map(({ path }) => path),
    ...AAVE_POSITION_CONNECTION_ARTIFACTS.map(({ path }) => path),
  ]);
  const runtimeSources = new Map();
  let runtimeBytes = 0;
  for (const path of runtimeSourcePaths(repositoryRoot)) {
    if (adapterPaths.has(path)) continue;
    const source = repositoryFile(
      repositoryRoot,
      path,
      MAX_DORMANT_PROVIDER_ARTIFACT_BYTES,
      afterFirstReadForTest,
    );
    runtimeBytes += Buffer.byteLength(source, 'utf8');
    if (runtimeBytes > MAX_DORMANT_PROVIDER_RUNTIME_BYTES) {
      throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
    }
    runtimeSources.set(path, source);
  }

  return {
    directorySource: repositoryFile(
      repositoryRoot,
      DIRECTORY_PATH,
      MAX_DORMANT_PROVIDER_ARTIFACT_BYTES,
      afterFirstReadForTest,
    ),
    artifacts,
    runtimeSources,
  };
}

export function loadDormantProviderInventorySnapshot(repositoryRoot = REPOSITORY_ROOT) {
  try {
    return loadDormantProviderInventorySnapshotInternal(repositoryRoot, undefined);
  } catch {
    throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
  }
}

/** Test-only fault seam; production callers use loadDormantProviderInventorySnapshot. */
export function loadDormantProviderInventorySnapshotForTest(repositoryRoot, afterFirstReadForTest) {
  try {
    return loadDormantProviderInventorySnapshotInternal(repositoryRoot, afterFirstReadForTest);
  } catch {
    throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
  }
}

export function validateDormantProviderInventoryFiles(repositoryRoot = REPOSITORY_ROOT) {
  try {
    return validateDormantProviderInventorySnapshot(
      loadDormantProviderInventorySnapshot(repositoryRoot),
    );
  } catch {
    return [DORMANT_PROVIDER_INVENTORY_INPUT_ERROR];
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const errors = validateDormantProviderInventoryFiles();
  if (errors.length === 0) {
    console.log(
      'Dormant provider inventory is valid: 10 planned, 5 semantics foundations, 2 byte-pinned position sources, 1 incomplete Gearbox transcript, 0 enabled',
    );
  } else {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}
