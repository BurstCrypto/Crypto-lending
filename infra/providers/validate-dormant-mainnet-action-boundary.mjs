import { readdirSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACTION_BOUNDARY_PATH =
  'apps/api/src/mainnet-actions/domain/dormant-mainnet-financial-action.ts';
export const ACTION_BOUNDARY_SPEC_PATH =
  'apps/api/src/mainnet-actions/domain/dormant-mainnet-financial-action.spec.ts';
export const MAX_ACTION_BOUNDARY_FILE_BYTES = 512 * 1024;
export const MAX_ACTION_BOUNDARY_RUNTIME_FILES = 4_096;
export const MAX_ACTION_BOUNDARY_RUNTIME_BYTES = 24 * 1024 * 1024;
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
const EXPECTED_IMPORTS = Object.freeze([
  'node:util/types',
  '../../blockchain/domain/mainnet-launch-network-policy',
  '../../blockchain/domain/supported-asset-registry',
  '../../wallets/domain/wallet-identity',
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
const UNSAFE_CAPABILITY =
  /\b(?:mayAuthorizeFinancialAction|apiMaySign|apiMayBroadcast|crossChainExecutionAllowed|automaticResendAllowed|automaticFeeEscalationAllowed|durableReplayProtectionAvailable|durableLimitCountersAvailable|providerWriteApprovalAvailable|marketWriteManifestAvailable)\s*:\s*true\b/u;
const PROHIBITED_BOUNDARY_SOURCE =
  /(?:\bprocess\.env\b|\b(?:fetch|WebSocket|XMLHttpRequest|eval)\s*\(|\b(?:require|import)\s*\(|\b(?:sendRawTransaction|sendTransaction|signTransaction|broadcastTransaction|eth_sendRawTransaction)\b|@(Injectable|Module|Controller)\s*\()/u;
const RUNTIME_REFERENCE =
  /(?:dormant-mainnet-financial-action|DormantMainnetFinancialAction|DORMANT_MAINNET_FINANCIAL_ACTION|MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES|assessDormantMainnetFinancialAction|parseDormantMainnetFinancialActionIntent)/u;

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

export function validateDormantMainnetActionBoundarySnapshot(snapshot) {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    typeof snapshot.boundarySource !== 'string' ||
    typeof snapshot.specSource !== 'string' ||
    !(snapshot.runtimeSources instanceof Map)
  ) {
    return ['action boundary snapshot is malformed'];
  }

  const errors = [];
  const source = snapshot.boundarySource;
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
  if (
    !snapshot.specSource.includes(`./${BOUNDARY_IMPORT_STEM}`) ||
    countTests(snapshot.specSource) < 15 ||
    !snapshot.specSource.includes('new Proxy') ||
    !snapshot.specSource.includes("decision: 'DENY'")
  ) {
    errors.push('action boundary spec is not exact, adversarial, and denial-bound');
  }

  for (const [path, runtimeSource] of snapshot.runtimeSources) {
    if (typeof path !== 'string' || typeof runtimeSource !== 'string') {
      errors.push('action boundary runtime source inventory is malformed');
    } else if (normalizedPath(path) === ACTION_BOUNDARY_PATH) {
      errors.push('action boundary was incorrectly included in runtime consumers');
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
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.test.ts')
      ) {
        const path = normalizedPath(relative(repositoryRoot, absolute));
        if (path !== ACTION_BOUNDARY_PATH) paths.push(path);
        if (paths.length > MAX_ACTION_BOUNDARY_RUNTIME_FILES) {
          throw new Error(ACTION_BOUNDARY_INPUT_ERROR);
        }
      }
    }
  };
  visit(sourceRoot);
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
