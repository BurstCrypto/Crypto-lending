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
  /(?:dormant-mainnet-financial-action|DormantMainnetFinancialAction|DORMANT_MAINNET_FINANCIAL_ACTION|MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES|assessDormantMainnetFinancialAction|parseDormantMainnetFinancialActionIntent|createDormantMainnetFinancialActionLifecycleProtocol)/u;
const REVIEWED_DORMANT_SOURCE_PATHS = new Set([ACTION_BOUNDARY_PATH, ACTION_LIFECYCLE_PATH]);
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

function countTests(source) {
  return [...source.matchAll(/\b(?:it|test)\s*\(/gu)].length;
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
    !(snapshot.runtimeSources instanceof Map)
  ) {
    return ['action boundary snapshot is malformed'];
  }

  const errors = [];
  const source = snapshot.boundarySource;
  const lifecycleSource = snapshot.lifecycleSource;
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
    } else if (REVIEWED_DORMANT_SOURCE_PATHS.has(normalizedPath(path))) {
      errors.push('reviewed dormant action source was incorrectly included in runtime consumers');
    } else if (hasUnreviewedDynamicLoading(path, runtimeSource)) {
      errors.push(`runtime source contains unreviewed dynamic loading: ${path}`);
    } else if (RUNTIME_REFERENCE.test(runtimeSource)) {
      errors.push(`dormant mainnet action boundary is referenced by runtime source ${path}`);
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
    console.log('Dormant mainnet action boundary is valid: 10 candidates, 0 enabled');
  } else {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}
