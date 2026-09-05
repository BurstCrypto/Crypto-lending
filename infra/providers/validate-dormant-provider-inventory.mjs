import { readdirSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIRECTORY_PATH = 'apps/api/src/mainnet-platforms/domain/mainnet-platform-directory.ts';

const API_SOURCE_ROOT = 'apps/api/src';
export const MAX_DORMANT_PROVIDER_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_DORMANT_PROVIDER_RUNTIME_FILES = 4_096;
export const MAX_DORMANT_PROVIDER_RUNTIME_BYTES = 24 * 1024 * 1024;
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

const STANDARD_CAPABILITY_MARKERS = Object.freeze([
  'mayPersist: false',
  'mayEstablishRecommendationEligibility: false',
  'mayAuthorizeFinancialAction: false',
]);

const UNSAFE_CAPABILITY =
  /\b(?:mayPersist|mayEstablishRecommendationEligibility|mayAuthorizeFinancialAction)\s*:\s*true\b/u;
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

  for (const path of snapshot.artifacts.keys()) {
    if (!exactArtifactPaths.has(path)) errors.push(`unexpected inventory artifact: ${path}`);
  }

  for (const [path, source] of snapshot.runtimeSources) {
    if (typeof path !== 'string' || typeof source !== 'string') {
      errors.push('runtime source inventory is malformed');
      continue;
    }
    for (const provider of DORMANT_PROVIDER_INVENTORY) {
      if (
        source.includes(provider.className) ||
        source.includes(adapterImportStem(provider.adapterPath))
      ) {
        errors.push(`${provider.id} dormant adapter is referenced by runtime source ${path}`);
      }
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
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('runtime source tree contains a symbolic link');
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.test.ts')
      ) {
        paths.push(normalizedPath(relative(repositoryRoot, absolute)));
        if (paths.length > MAX_DORMANT_PROVIDER_RUNTIME_FILES) {
          throw new Error(DORMANT_PROVIDER_INVENTORY_INPUT_ERROR);
        }
      }
    }
  };
  visit(sourceRoot);
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

  const adapterPaths = new Set(DORMANT_PROVIDER_INVENTORY.map(({ adapterPath }) => adapterPath));
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
    console.log('Dormant provider inventory is valid: 10 planned, 10 unregistered, 0 enabled');
  } else {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}
