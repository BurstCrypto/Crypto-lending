import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REVIEW_REGISTER_PATH = 'docs/wallets/review/kan-227-consolidated-review.json';
export const REVIEW_SIDECAR_PATH = 'docs/wallets/review/kan-227-consolidated-review.sha256';

const SHA256 = /^[A-F0-9]{64}$/u;
const GIT_OID = /^[a-f0-9]{40}$/u;
const TICKET = /^KAN-[1-9][0-9]{0,7}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EVIDENCE_PREFIXES = Object.freeze([
  'docs/wallets/evidence/results/',
  'docs/wallets/security-review/results/',
  'docs/wallets/license-review/decisions/',
  'docs/wallets/review/decisions/',
]);

export const SUPPORTING_ARTIFACTS = Object.freeze([
  ['ADR', 'docs/adr/0001-wallet-connection-sdk-strategy.md'],
  ['KAN_227_PACKET', 'docs/wallets/KAN-227.md'],
  ['COMPATIBILITY_MATRIX', 'docs/wallets/sdk-compatibility-matrix.md'],
  ['MANUAL_RUNBOOK', 'docs/wallets/manual-validation-runbook.md'],
  ['EVIDENCE_INDEX', 'docs/wallets/evidence/README.md'],
  ['DESKTOP_PLAN', 'docs/wallets/evidence/desktop-execution-plan.md'],
  ['MOBILE_PLAN', 'docs/wallets/evidence/mobile-execution-plan.md'],
  ['SECURITY_PACKET', 'docs/wallets/security-review/README.md'],
  ['THREAT_MODEL', 'docs/wallets/security-review/threat-model.md'],
  ['SECURITY_DECISION_TEMPLATE', 'docs/wallets/security-review/review-decision-template.md'],
  ['NETWORK_OBSERVATION_TEMPLATE', 'docs/wallets/security-review/network-observation-template.md'],
  ['ROLLBACK_RUNBOOK', 'docs/wallets/security-review/rollback-runbook.md'],
  ['LICENSE_PACKET', 'docs/wallets/license-review/README.md'],
  ['LEGAL_GATE', 'docs/wallets/license-review/public-launch-legal-gate.md'],
  ['LOCK_REVIEW_SNAPSHOT', 'docs/wallets/license-review/lock-review-snapshot.json'],
  ['CANDIDATE_DEPENDENCIES', 'docs/wallets/license-review/candidate-dependencies.json'],
  ['CANDIDATE_SPDX', 'docs/wallets/license-review/candidate.spdx.json'],
  ['FULL_LOCK_SPDX', 'docs/wallets/license-review/wallet-lab-lock.spdx.json'],
  ['LICENSE_RECONCILIATION_README', 'docs/wallets/license-review/reconciliation/README.md'],
  [
    'LICENSE_RECONCILIATION',
    'docs/wallets/license-review/reconciliation/see-license-in-license-md.json',
  ],
  ['VENDOR_INQUIRIES', 'docs/wallets/license-review/vendor-inquiries.md'],
  ['THIRD_PARTY_NOTICES', 'tools/wallet-lab/THIRD_PARTY_NOTICES.md'],
]);

const COMMON_CASES = Object.freeze(
  Array.from({ length: 17 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`),
);
const EVM_DIRECT_COMMON_CASES = Object.freeze(COMMON_CASES.filter((caseId) => caseId !== 'C15'));
const SOLANA_DIRECT_COMMON_CASES = Object.freeze(
  COMMON_CASES.filter((caseId) => !['C08', 'C09', 'C15'].includes(caseId)),
);
const WALLETCONNECT_CASES = Object.freeze([
  'WC01',
  'WC03a',
  'WC03b',
  'WC04',
  'WC05',
  'WC06',
  'WC08a',
  'WC08b',
  'WC09',
  'WC10',
  'WC11',
]);
const MOBILE_WALLETCONNECT_CASES = Object.freeze(['WC01', 'WC03a', 'WC04', 'WC06', 'WC09', 'WC10']);

export const REQUIRED_RESULTS = Object.freeze([
  ['DESKTOP_COMMON_METAMASK_D1', 'DESKTOP', 'METAMASK', ['D1'], EVM_DIRECT_COMMON_CASES],
  ['DESKTOP_COMMON_METAMASK_D2', 'DESKTOP', 'METAMASK', ['D2'], EVM_DIRECT_COMMON_CASES],
  ['DESKTOP_COMMON_PHANTOM_D1', 'DESKTOP', 'PHANTOM', ['D1'], SOLANA_DIRECT_COMMON_CASES],
  ['DESKTOP_COMMON_COINBASE_D1', 'DESKTOP', 'COINBASE_WALLET', ['D1'], EVM_DIRECT_COMMON_CASES],
  ['DESKTOP_COMMON_WALLETCONNECT_D3', 'DESKTOP', 'WALLETCONNECT', ['D3'], COMMON_CASES],
  ['DESKTOP_CONCURRENT_EVM_D1', 'DESKTOP', 'CROSS_WALLET', ['D1'], ['C18', 'CB07']],
  ['DESKTOP_METAMASK_D1', 'DESKTOP', 'METAMASK', ['D1'], ['MM01', 'MM04', 'MM05', 'MM06']],
  [
    'DESKTOP_PHANTOM_D1',
    'DESKTOP',
    'PHANTOM',
    ['D1'],
    ['PH01', 'PH03', 'PH04', 'PH05', 'PH06', 'PH07'],
  ],
  ['DESKTOP_PHANTOM_D2_ABSENCE', 'DESKTOP', 'PHANTOM', ['D2'], ['PHANTOM_FIREFOX_ABSENCE']],
  ['DESKTOP_COINBASE_D1', 'DESKTOP', 'COINBASE_WALLET', ['D1'], ['CB01', 'CB05', 'CB06', 'CB08']],
  ['DESKTOP_WALLETCONNECT_D3', 'DESKTOP', 'WALLETCONNECT', ['D3'], WALLETCONNECT_CASES],
  [
    'MOBILE_M1_METAMASK',
    'MOBILE',
    'METAMASK',
    ['P1'],
    ['MM02', 'MM04', ...MOBILE_WALLETCONNECT_CASES],
  ],
  ['MOBILE_M1_PHANTOM', 'MOBILE', 'PHANTOM', ['P1'], MOBILE_WALLETCONNECT_CASES],
  ['MOBILE_M1_COINBASE', 'MOBILE', 'COINBASE_WALLET', ['P1'], ['CB04']],
  ['MOBILE_M1_WALLETCONNECT_A', 'MOBILE', 'WALLETCONNECT_A', ['P1'], MOBILE_WALLETCONNECT_CASES],
  ['MOBILE_M1_WALLETCONNECT_B', 'MOBILE', 'WALLETCONNECT_B', ['P1'], MOBILE_WALLETCONNECT_CASES],
  ['MOBILE_M2_METAMASK_A1', 'MOBILE', 'METAMASK', ['A1'], ['MM03', 'WC02']],
  ['MOBILE_M2_METAMASK_S1', 'MOBILE', 'METAMASK', ['S1'], ['MM03', 'WC02']],
  ['MOBILE_M2_PHANTOM_A1', 'MOBILE', 'PHANTOM', ['A1'], ['PH02', 'PH04', 'PH06', 'PH08']],
  ['MOBILE_M2_PHANTOM_S1', 'MOBILE', 'PHANTOM', ['S1'], ['PHANTOM_S1_SMOKE_OR_ABSENCE']],
  [
    'MOBILE_M2_COINBASE_A1',
    'MOBILE',
    'COINBASE_WALLET',
    ['A1'],
    ['CB02', 'CB03', 'CB05', 'CB06', 'CB08'],
  ],
  ['MOBILE_M2_COINBASE_S1', 'MOBILE', 'COINBASE_WALLET', ['S1'], ['CB02', 'CB03']],
  [
    'MOBILE_M2_WALLETCONNECT_A_A1',
    'MOBILE',
    'WALLETCONNECT_A',
    ['A1'],
    ['WC02', 'WC03a', 'WC04', 'WC07'],
  ],
  ['MOBILE_M2_WALLETCONNECT_A_S1', 'MOBILE', 'WALLETCONNECT_A', ['S1'], ['WC02']],
  [
    'MOBILE_M2_WALLETCONNECT_B_A1',
    'MOBILE',
    'WALLETCONNECT_B',
    ['A1'],
    ['WC02', 'WC03a', 'WC04', 'WC07'],
  ],
  ['MOBILE_M2_WALLETCONNECT_B_S1', 'MOBILE', 'WALLETCONNECT_B', ['S1'], ['WC02']],
  ['MOBILE_M3_METAMASK', 'MOBILE', 'METAMASK', ['H1'], ['MM03', 'WC12']],
  ['MOBILE_M3_PHANTOM', 'MOBILE', 'PHANTOM', ['H1'], ['PH02', 'PH08']],
  ['MOBILE_M3_COINBASE', 'MOBILE', 'COINBASE_WALLET', ['H1'], ['CB02', 'CB03', 'CB08']],
  ['MOBILE_M3_WALLETCONNECT_A', 'MOBILE', 'WALLETCONNECT_A', ['H1'], ['WC02', 'WC12']],
  ['MOBILE_M3_WALLETCONNECT_B', 'MOBILE', 'WALLETCONNECT_B', ['H1'], ['WC02', 'WC12']],
  ['MOBILE_COMMON_M1_METAMASK', 'MOBILE', 'METAMASK', ['P1'], COMMON_CASES],
  ['MOBILE_COMMON_M1_PHANTOM', 'MOBILE', 'PHANTOM', ['P1'], COMMON_CASES],
  ['MOBILE_COMMON_M1_COINBASE', 'MOBILE', 'COINBASE_WALLET', ['P1'], EVM_DIRECT_COMMON_CASES],
  ['MOBILE_COMMON_M1_WALLETCONNECT_A', 'MOBILE', 'WALLETCONNECT_A', ['P1'], COMMON_CASES],
  ['MOBILE_COMMON_M1_WALLETCONNECT_B', 'MOBILE', 'WALLETCONNECT_B', ['P1'], COMMON_CASES],
  ['MOBILE_COMMON_M2_METAMASK_A1', 'MOBILE', 'METAMASK', ['A1'], COMMON_CASES],
  ['MOBILE_COMMON_M2_METAMASK_S1', 'MOBILE', 'METAMASK', ['S1'], COMMON_CASES],
  ['MOBILE_COMMON_M2_PHANTOM_A1', 'MOBILE', 'PHANTOM', ['A1'], SOLANA_DIRECT_COMMON_CASES],
  ['MOBILE_COMMON_M2_COINBASE_A1', 'MOBILE', 'COINBASE_WALLET', ['A1'], EVM_DIRECT_COMMON_CASES],
  ['MOBILE_COMMON_M2_COINBASE_S1', 'MOBILE', 'COINBASE_WALLET', ['S1'], EVM_DIRECT_COMMON_CASES],
  ['MOBILE_COMMON_M2_WALLETCONNECT_A_A1', 'MOBILE', 'WALLETCONNECT_A', ['A1'], COMMON_CASES],
  ['MOBILE_COMMON_M2_WALLETCONNECT_A_S1', 'MOBILE', 'WALLETCONNECT_A', ['S1'], COMMON_CASES],
  ['MOBILE_COMMON_M2_WALLETCONNECT_B_A1', 'MOBILE', 'WALLETCONNECT_B', ['A1'], COMMON_CASES],
  ['MOBILE_COMMON_M2_WALLETCONNECT_B_S1', 'MOBILE', 'WALLETCONNECT_B', ['S1'], COMMON_CASES],
  ['MOBILE_COMMON_M3_METAMASK', 'MOBILE', 'METAMASK', ['H1'], COMMON_CASES],
  ['MOBILE_COMMON_M3_PHANTOM', 'MOBILE', 'PHANTOM', ['H1'], SOLANA_DIRECT_COMMON_CASES],
  ['MOBILE_COMMON_M3_COINBASE', 'MOBILE', 'COINBASE_WALLET', ['H1'], EVM_DIRECT_COMMON_CASES],
  ['MOBILE_COMMON_M3_WALLETCONNECT_A', 'MOBILE', 'WALLETCONNECT_A', ['H1'], COMMON_CASES],
  ['MOBILE_COMMON_M3_WALLETCONNECT_B', 'MOBILE', 'WALLETCONNECT_B', ['H1'], COMMON_CASES],
]);

export const LIMITATION_IDS = Object.freeze([
  'REAL_WALLET_RESULTS_ABSENT',
  'PHYSICAL_HTTPS_M3_UNAUTHORIZED',
  'WALLETCONNECT_LEGAL_TERMS_PENDING',
  'INDEPENDENT_SECURITY_REVIEW_PENDING',
  'PRODUCTION_OWNERSHIP_PROOF_DEFERRED',
  'LIMITED_CONCURRENT_SESSION_CARDINALITY',
  'COINBASE_TELEMETRY_UNVERIFIED',
  'EVIDENCE_EXPORTS_UNSIGNED',
  'MOBILE_PLATFORM_DIVERSITY_UNPROVEN',
]);
export const DECISION_IDS = Object.freeze(['SECURITY', 'LEGAL_OSS', 'PRIVACY']);
export const SIGNOFF_IDS = Object.freeze(['ENGINEERING', 'SECURITY', 'PRODUCT', 'RELEASE']);
export const EXECUTION_GATE_IDS = Object.freeze(['DESKTOP', 'MOBILE']);
export const SECURITY_FINDING_IDS = Object.freeze(
  Array.from({ length: 13 }, (_, index) => `SEC-${String(index + 1).padStart(3, '0')}`),
);
export const RE_REVIEW_TRIGGERS = Object.freeze([
  'EXECUTABLE_CHANGE',
  'DEPENDENCY_OR_LOCK_CHANGE',
  'LICENSE_OR_TERMS_CHANGE',
  'CONNECTOR_CHAIN_OR_ORIGIN_CHANGE',
  'CSP_RPC_RELAY_CHANGE',
  'EVIDENCE_SCHEMA_CHANGE',
  'AUTHENTICATION_BOUNDARY_CHANGE',
  'PUBLIC_OR_HOSTED_DEPLOYMENT',
  'TELEMETRY_OR_STORAGE_CHANGE',
  'SECURITY_INCIDENT',
  'DECISION_EXPIRY',
]);

const TOP_KEYS = Object.freeze([
  'schemaVersion',
  'ticket',
  'sourceDecision',
  'status',
  'preparedAt',
  'candidate',
  'supportingArtifacts',
  'supportingArtifactSetSha256',
  'versions',
  'limitations',
  'requiredResults',
  'securityFindings',
  'executionGates',
  'decisions',
  'signoffs',
  'reReviewTriggers',
  'externalReviewBinding',
]);
const CANDIDATE_KEYS = Object.freeze([
  'executableCommit',
  'executableScope',
  'executableTree',
  'packetPreparationBaseCommit',
  'packageManifestPath',
  'packageManifestSha256',
  'packageLockPath',
  'packageLockSha256',
]);
const SCOPE_KEYS = Object.freeze([
  'executableCommit',
  'executableTree',
  'packageManifestSha256',
  'packageLockSha256',
  'supportingArtifactSetSha256',
]);
const PLACEHOLDERS = new Set([
  'pending',
  'tbd',
  'todo',
  'unknown',
  'n/a',
  'none',
  'security',
  'legal',
  'legal/oss',
  'privacy',
  'engineering',
  'product',
  'release',
  'team',
  'reviewer',
  'approver',
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${path} must contain exactly: ${expected.join(', ')}.`);
    return false;
  }
  return true;
}

function exactArray(actual, expected, path, errors) {
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${path} must equal the closed reviewed list.`);
    return false;
  }
  return true;
}

function canonicalTimestamp(value) {
  return (
    typeof value === 'string' &&
    UTC_TIMESTAMP.test(value) &&
    new Date(value).toISOString() === value
  );
}

function validTicket(value) {
  return typeof value === 'string' && TICKET.test(value);
}

function nonPlaceholder(value, minimum = 3) {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length >= minimum &&
    !PLACEHOLDERS.has(value.toLowerCase())
  );
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

export function computeSupportingArtifactSetSha256(artifacts) {
  if (!Array.isArray(artifacts)) return '';
  if (!artifacts.every(isRecord)) return '';
  const canonical = artifacts
    .map((artifact) => `${artifact.id}\0${artifact.path}\0${artifact.sha256}\n`)
    .join('');
  return sha256Bytes(canonical);
}

function containedPath(repositoryRoot, path, { evidence = false } = {}) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    (evidence && !EVIDENCE_PREFIXES.some((prefix) => path.startsWith(prefix)))
  )
    return null;
  const absolute = resolve(repositoryRoot, path);
  try {
    if (lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) return null;
    const root = realpathSync(repositoryRoot);
    const real = realpathSync(absolute);
    const rel = relative(root, real);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    return real;
  } catch {
    return null;
  }
}

function git(repositoryRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { status: result.status, stdout: result.stdout.trim() };
}

function manifestVersions(manifest) {
  return {
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    overrides: manifest.overrides,
  };
}

export function inspectWalletReviewRepository(register, repositoryRoot = REPOSITORY_ROOT) {
  const candidate = register.candidate;
  const manifestAbsolute = containedPath(repositoryRoot, candidate.packageManifestPath);
  const lockAbsolute = containedPath(repositoryRoot, candidate.packageLockPath);
  if (manifestAbsolute === null || lockAbsolute === null)
    throw new Error('Candidate manifest or lock path is unsafe or missing.');
  const candidateCommit = git(repositoryRoot, [
    'rev-parse',
    '--verify',
    `${candidate.executableCommit}^{commit}`,
  ]).stdout;
  const baseCommit = git(repositoryRoot, [
    'rev-parse',
    '--verify',
    `${candidate.packetPreparationBaseCommit}^{commit}`,
  ]).stdout;
  const candidateTree = git(repositoryRoot, [
    'rev-parse',
    `${candidateCommit}:${candidate.executableScope}`,
  ]).stdout;
  const baseTree = git(repositoryRoot, [
    'rev-parse',
    `${baseCommit}:${candidate.executableScope}`,
  ]).stdout;
  const candidateIsAncestor =
    git(repositoryRoot, ['merge-base', '--is-ancestor', candidateCommit, baseCommit], {
      allowFailure: true,
    }).status === 0;
  const trackedScopeClean =
    git(repositoryRoot, ['diff', '--quiet', candidateCommit, '--', candidate.executableScope], {
      allowFailure: true,
    }).status === 0;
  const scopedStatus = git(repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    candidate.executableScope,
  ]).stdout;
  const scopeClean = trackedScopeClean && scopedStatus === '';
  const artifactHashes = Object.fromEntries(
    SUPPORTING_ARTIFACTS.map(([, path]) => {
      const absolute = containedPath(repositoryRoot, path);
      return [path, absolute === null ? null : sha256Bytes(readFileSync(absolute))];
    }),
  );
  const manifestBytes = readFileSync(manifestAbsolute);
  return {
    candidateCommit,
    baseCommit,
    candidateTree,
    baseTree,
    candidateIsAncestor,
    scopeClean,
    manifestSha256: sha256Bytes(manifestBytes),
    lockSha256: sha256Bytes(readFileSync(lockAbsolute)),
    versions: manifestVersions(JSON.parse(manifestBytes.toString('utf8'))),
    artifactHashes,
    evidenceExists(path) {
      return containedPath(repositoryRoot, path, { evidence: true }) !== null;
    },
  };
}

function validateScopeBinding(binding, register, path, errors) {
  if (!exactKeys(binding, SCOPE_KEYS, path, errors)) return;
  const expected = {
    executableCommit: register.candidate?.executableCommit,
    executableTree: register.candidate?.executableTree,
    packageManifestSha256: register.candidate?.packageManifestSha256,
    packageLockSha256: register.candidate?.packageLockSha256,
    supportingArtifactSetSha256: register.supportingArtifactSetSha256,
  };
  if (JSON.stringify(binding) !== JSON.stringify(expected))
    errors.push(`${path} does not exactly bind the reviewed scope.`);
}

function validateEvidenceFiles(files, path, errors, repository) {
  if (!Array.isArray(files) || new Set(files).size !== files.length) {
    errors.push(`${path} must be a unique array.`);
    return;
  }
  for (const [index, file] of files.entries()) {
    if (typeof file !== 'string' || !repository.evidenceExists(file))
      errors.push(`${path}[${index}] must be a repository-contained regular evidence file.`);
  }
}

function validateResolution(resolution, kind, path, errors, repository, now) {
  const common = ['ticket', 'owner', 'summary', 'evidenceFile'];
  const keys =
    kind === 'APPROVED_EXCEPTION'
      ? [...common, 'approvedBy', 'approvedByIdentity', 'approvedAt', 'expiresAt', 'conditions']
      : common;
  if (!exactKeys(resolution, keys, path, errors)) return;
  if (!validTicket(resolution.ticket)) errors.push(`${path}.ticket must be an owned KAN issue.`);
  if (!nonPlaceholder(resolution.owner) || !nonPlaceholder(resolution.summary, 12))
    errors.push(`${path} requires a named owner and meaningful summary.`);
  if (!repository.evidenceExists(resolution.evidenceFile))
    errors.push(`${path}.evidenceFile must be a repository-contained regular evidence file.`);
  if (kind === 'APPROVED_EXCEPTION') {
    validateNamedPerson(
      resolution.approvedBy,
      resolution.approvedByIdentity,
      `${path}.approvedBy`,
      errors,
    );
    if (!canonicalTimestamp(resolution.approvedAt) || !canonicalTimestamp(resolution.expiresAt))
      errors.push(`${path} approval dates must be canonical UTC.`);
    else if (
      new Date(resolution.expiresAt) <= now ||
      new Date(resolution.approvedAt) >= new Date(resolution.expiresAt)
    )
      errors.push(`${path} exception approval must be current and expire after approval.`);
    if (
      !Array.isArray(resolution.conditions) ||
      resolution.conditions.length === 0 ||
      !resolution.conditions.every((value) => nonPlaceholder(value, 8))
    )
      errors.push(`${path}.conditions must be non-empty and explicit.`);
  }
}

function validateNamedPerson(name, identity, path, errors) {
  if (
    !nonPlaceholder(name, 5) ||
    !/^person:[A-Za-z0-9][A-Za-z0-9._@+-]{2,79}$/u.test(identity ?? '')
  ) {
    errors.push(
      `${path} must name a person and a stable person: identity; role aliases are not approval.`,
    );
  }
}

function validateRequiredResults(register, errors, repository, now) {
  if (
    !Array.isArray(register.requiredResults) ||
    register.requiredResults.length !== REQUIRED_RESULTS.length
  ) {
    errors.push(
      'requiredResults must contain every closed desktop/mobile requirement exactly once.',
    );
    return;
  }
  for (const [index, spec] of REQUIRED_RESULTS.entries()) {
    const row = register.requiredResults[index];
    const path = `requiredResults[${index}]`;
    if (
      !exactKeys(
        row,
        [
          'id',
          'gate',
          'target',
          'environments',
          'caseIds',
          'ownerTicket',
          'status',
          'evidenceFiles',
          'resolution',
        ],
        path,
        errors,
      )
    )
      continue;
    const [id, gate, target, environments, caseIds] = spec;
    if (
      row.id !== id ||
      row.gate !== gate ||
      row.target !== target ||
      JSON.stringify(row.environments) !== JSON.stringify(environments) ||
      JSON.stringify(row.caseIds) !== JSON.stringify(caseIds)
    )
      errors.push(`${path} does not match the closed requirement ${id}.`);
    if (row.ownerTicket !== (gate === 'DESKTOP' ? 'KAN-225' : 'KAN-226'))
      errors.push(`${path}.ownerTicket is incorrect.`);
    validateEvidenceFiles(row.evidenceFiles, `${path}.evidenceFiles`, errors, repository);
    const evidenceCount = Array.isArray(row.evidenceFiles) ? row.evidenceFiles.length : 0;
    if (row.status === 'PENDING') {
      if (evidenceCount !== 0 || row.resolution !== null)
        errors.push(`${path} pending rows cannot contain terminal evidence or resolution.`);
    } else if (row.status === 'PASS') {
      if (id === 'DESKTOP_PHANTOM_D2_ABSENCE')
        errors.push(`${path} is a documented absence and cannot be represented as Pass.`);
      if (evidenceCount === 0 || row.resolution !== null)
        errors.push(`${path} Pass requires evidence and no defect/exception resolution.`);
    } else if (row.status === 'OWNED_DEFECT' || row.status === 'APPROVED_EXCEPTION') {
      if (evidenceCount === 0 && row.status === 'OWNED_DEFECT')
        errors.push(`${path} terminal non-Pass result requires run evidence.`);
      validateResolution(row.resolution, row.status, `${path}.resolution`, errors, repository, now);
    } else errors.push(`${path}.status is not allowed.`);
  }
}

function validateSecurityFindings(register, errors, repository, now) {
  if (
    !Array.isArray(register.securityFindings) ||
    register.securityFindings.length !== SECURITY_FINDING_IDS.length
  ) {
    errors.push('securityFindings must enumerate SEC-001 through SEC-013 individually.');
    return;
  }
  for (const [index, id] of SECURITY_FINDING_IDS.entries()) {
    const row = register.securityFindings[index];
    const path = `securityFindings[${index}]`;
    if (
      !exactKeys(
        row,
        ['id', 'ownerTicket', 'status', 'severity', 'disposition', 'evidenceFiles', 'resolution'],
        path,
        errors,
      )
    )
      continue;
    if (row.id !== id || row.ownerTicket !== 'KAN-223')
      errors.push(`${path} must bind ${id} to KAN-223.`);
    validateEvidenceFiles(row.evidenceFiles, `${path}.evidenceFiles`, errors, repository);
    const evidenceCount = Array.isArray(row.evidenceFiles) ? row.evidenceFiles.length : 0;
    if (row.status === 'PENDING_CLASSIFICATION') {
      if (
        row.severity !== null ||
        row.disposition !== null ||
        row.resolution !== null ||
        evidenceCount !== 0
      )
        errors.push(`${path} pending classification must not imply a disposition.`);
      continue;
    }
    if (
      row.status !== 'CLASSIFIED' ||
      !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(row.severity) ||
      !['CLOSED', 'OWNED_DEFECT', 'APPROVED_EXCEPTION'].includes(row.disposition)
    ) {
      errors.push(`${path} classified finding has an invalid severity or disposition.`);
      continue;
    }
    if (evidenceCount === 0) errors.push(`${path} classified finding requires evidence.`);
    if (row.disposition === 'CLOSED') {
      if (row.resolution !== null)
        errors.push(`${path} closed finding must not carry defect/exception resolution.`);
    } else
      validateResolution(
        row.resolution,
        row.disposition,
        `${path}.resolution`,
        errors,
        repository,
        now,
      );
    if (['HIGH', 'CRITICAL'].includes(row.severity) && row.disposition === 'OWNED_DEFECT')
      errors.push(`${path} cannot leave a High/Critical finding open as an owned defect.`);
  }
}

function validateExecutionGates(register, errors, repository) {
  if (
    !Array.isArray(register.executionGates) ||
    register.executionGates.length !== EXECUTION_GATE_IDS.length
  ) {
    errors.push('executionGates must contain Desktop and Mobile exactly.');
    return;
  }
  for (const [index, id] of EXECUTION_GATE_IDS.entries()) {
    const row = register.executionGates[index];
    const path = `executionGates[${index}]`;
    if (!exactKeys(row, ['id', 'ownerTicket', 'status', 'evidenceFiles'], path, errors)) continue;
    if (row.id !== id || row.ownerTicket !== (id === 'DESKTOP' ? 'KAN-225' : 'KAN-226'))
      errors.push(`${path} identity/owner is incorrect.`);
    validateEvidenceFiles(row.evidenceFiles, `${path}.evidenceFiles`, errors, repository);
    const results = Array.isArray(register.requiredResults)
      ? register.requiredResults.filter((result) => isRecord(result) && result.gate === id)
      : [];
    const complete = results.length > 0 && results.every((result) => result.status !== 'PENDING');
    if (row.status !== (complete ? 'COMPLETE' : 'PENDING'))
      errors.push(`${path}.status must be derived from its required results.`);
    const evidenceCount = Array.isArray(row.evidenceFiles) ? row.evidenceFiles.length : 0;
    if (row.status === 'PENDING' && evidenceCount !== 0)
      errors.push(`${path} pending gate cannot claim completion evidence.`);
    if (row.status === 'COMPLETE' && evidenceCount === 0)
      errors.push(`${path} complete gate requires a consolidated evidence index.`);
  }
}

function validateDecisionRows(register, errors, repository, now) {
  if (!Array.isArray(register.decisions) || register.decisions.length !== DECISION_IDS.length) {
    errors.push('decisions must contain Security, Legal/OSS, and Privacy exactly.');
    return;
  }
  for (const [index, id] of DECISION_IDS.entries()) {
    const row = register.decisions[index];
    const path = `decisions[${index}]`;
    if (
      !exactKeys(
        row,
        [
          'id',
          'ownerTicket',
          'status',
          'scopeBinding',
          'reviewer',
          'decidedAt',
          'expiresAt',
          'result',
          'conditions',
          'evidenceFiles',
        ],
        path,
        errors,
      )
    )
      continue;
    const ticket = id === 'LEGAL_OSS' ? 'KAN-222' : 'KAN-223';
    if (row.id !== id || row.ownerTicket !== ticket)
      errors.push(`${path} identity/owner is incorrect.`);
    validateScopeBinding(row.scopeBinding, register, `${path}.scopeBinding`, errors);
    validateEvidenceFiles(row.evidenceFiles, `${path}.evidenceFiles`, errors, repository);
    const conditions = Array.isArray(row.conditions) ? row.conditions : [];
    const evidenceCount = Array.isArray(row.evidenceFiles) ? row.evidenceFiles.length : 0;
    if (!Array.isArray(row.conditions)) errors.push(`${path}.conditions must be an array.`);
    if (row.status === 'PENDING') {
      if (
        row.reviewer !== null ||
        row.decidedAt !== null ||
        row.expiresAt !== null ||
        row.result !== null ||
        conditions.length !== 0 ||
        evidenceCount !== 0
      )
        errors.push(`${path} pending decision cannot contain approval aliases or terminal fields.`);
      continue;
    }
    if (row.status !== 'DECIDED' || !['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(row.result)) {
      errors.push(`${path} has an invalid decision state.`);
      continue;
    }
    if (
      !exactKeys(
        row.reviewer,
        ['name', 'identity', 'role', 'independenceStatement'],
        `${path}.reviewer`,
        errors,
      )
    )
      continue;
    validateNamedPerson(row.reviewer.name, row.reviewer.identity, `${path}.reviewer`, errors);
    if (
      !nonPlaceholder(row.reviewer.role, 5) ||
      !nonPlaceholder(row.reviewer.independenceStatement, 20)
    )
      errors.push(`${path}.reviewer requires role and independence statement.`);
    if (!canonicalTimestamp(row.decidedAt) || !canonicalTimestamp(row.expiresAt))
      errors.push(`${path} dates must be canonical UTC.`);
    else if (
      new Date(row.decidedAt) > now ||
      new Date(row.expiresAt) <= now ||
      new Date(row.decidedAt) >= new Date(row.expiresAt)
    )
      errors.push(`${path} decision must be observed, current, and have a later expiry.`);
    if (evidenceCount === 0) errors.push(`${path} written decision requires contained evidence.`);
    if (row.result === 'CONDITIONAL' && conditions.length === 0)
      errors.push(`${path} Conditional decision requires conditions.`);
    if (
      !Array.isArray(row.conditions) ||
      !row.conditions.every((condition) => nonPlaceholder(condition, 8))
    )
      errors.push(`${path}.conditions are invalid.`);
  }
}

function validateSignoffs(register, errors, repository, now) {
  if (!Array.isArray(register.signoffs) || register.signoffs.length !== SIGNOFF_IDS.length) {
    errors.push('signoffs must contain Engineering, Security, Product, and Release exactly.');
    return;
  }
  for (const [index, id] of SIGNOFF_IDS.entries()) {
    const row = register.signoffs[index];
    const path = `signoffs[${index}]`;
    if (
      !exactKeys(
        row,
        [
          'id',
          'ownerTicket',
          'status',
          'scopeBinding',
          'signer',
          'signedAt',
          'expiresAt',
          'result',
          'conditions',
          'evidenceFiles',
        ],
        path,
        errors,
      )
    )
      continue;
    if (row.id !== id || row.ownerTicket !== 'KAN-227')
      errors.push(`${path} identity/owner is incorrect.`);
    validateScopeBinding(row.scopeBinding, register, `${path}.scopeBinding`, errors);
    validateEvidenceFiles(row.evidenceFiles, `${path}.evidenceFiles`, errors, repository);
    const conditions = Array.isArray(row.conditions) ? row.conditions : [];
    const evidenceCount = Array.isArray(row.evidenceFiles) ? row.evidenceFiles.length : 0;
    if (!Array.isArray(row.conditions)) errors.push(`${path}.conditions must be an array.`);
    if (row.status === 'PENDING') {
      if (
        row.signer !== null ||
        row.signedAt !== null ||
        row.expiresAt !== null ||
        row.result !== null ||
        conditions.length !== 0 ||
        evidenceCount !== 0
      )
        errors.push(`${path} pending sign-off cannot contain signer aliases or terminal fields.`);
      continue;
    }
    if (row.status !== 'SIGNED' || !['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(row.result)) {
      errors.push(`${path} has an invalid sign-off state.`);
      continue;
    }
    if (!exactKeys(row.signer, ['name', 'identity', 'role'], `${path}.signer`, errors)) continue;
    validateNamedPerson(row.signer.name, row.signer.identity, `${path}.signer`, errors);
    if (!nonPlaceholder(row.signer.role, 5)) errors.push(`${path}.signer.role is invalid.`);
    if (!canonicalTimestamp(row.signedAt) || !canonicalTimestamp(row.expiresAt))
      errors.push(`${path} dates must be canonical UTC.`);
    else if (
      new Date(row.signedAt) > now ||
      new Date(row.expiresAt) <= now ||
      new Date(row.signedAt) >= new Date(row.expiresAt)
    )
      errors.push(`${path} sign-off must be observed, current, and have a later expiry.`);
    if (evidenceCount === 0) errors.push(`${path} signed approval requires contained evidence.`);
    if (row.result === 'CONDITIONAL' && conditions.length === 0)
      errors.push(`${path} Conditional sign-off requires conditions.`);
    if (
      !Array.isArray(row.conditions) ||
      !row.conditions.every((condition) => nonPlaceholder(condition, 8))
    )
      errors.push(`${path}.conditions are invalid.`);
  }
}

function isReady(register) {
  if (
    register.schemaVersion === 1 ||
    !Array.isArray(register.requiredResults) ||
    !Array.isArray(register.securityFindings) ||
    !Array.isArray(register.executionGates) ||
    !Array.isArray(register.decisions) ||
    !Array.isArray(register.signoffs)
  )
    return false;
  return (
    register.requiredResults.every((row) => isRecord(row) && row.status !== 'PENDING') &&
    register.securityFindings.every(
      (row) =>
        isRecord(row) &&
        row.status === 'CLASSIFIED' &&
        !(['HIGH', 'CRITICAL'].includes(row.severity) && row.disposition === 'OWNED_DEFECT'),
    ) &&
    register.executionGates.every((row) => isRecord(row) && row.status === 'COMPLETE') &&
    register.decisions.every(
      (row) => isRecord(row) && row.status === 'DECIDED' && row.result !== 'REJECTED',
    ) &&
    register.signoffs.every(
      (row) => isRecord(row) && row.status === 'SIGNED' && row.result !== 'REJECTED',
    )
  );
}

function validatePreparationOnlySchema(register, errors) {
  if (register.schemaVersion !== 1) return;
  if (register.status !== 'PENDING_EXTERNAL_REVIEW')
    errors.push('schemaVersion 1 is a preparation-only packet and cannot claim readiness.');
  const pendingCollections = [
    ['requiredResults', 'PENDING'],
    ['securityFindings', 'PENDING_CLASSIFICATION'],
    ['executionGates', 'PENDING'],
    ['decisions', 'PENDING'],
    ['signoffs', 'PENDING'],
  ];
  for (const [collection, expectedStatus] of pendingCollections) {
    if (
      Array.isArray(register[collection]) &&
      register[collection].some((row) => !isRecord(row) || row.status !== expectedStatus)
    )
      errors.push(
        `schemaVersion 1 keeps every ${collection} row ${expectedStatus}; terminal evidence requires a future evidence-ingestion schema.`,
      );
  }
}

export function validateWalletReviewRegister(register, options = {}) {
  const errors = [];
  const now = options.now ?? new Date();
  if (!exactKeys(register, TOP_KEYS, 'register', errors)) return { errors, ready: false };
  if (
    register.schemaVersion !== 1 ||
    register.ticket !== 'KAN-227' ||
    register.sourceDecision !== 'KAN-55'
  )
    errors.push('register identity must be schema 1 for KAN-227/KAN-55.');
  if (!['PENDING_EXTERNAL_REVIEW', 'READY_FOR_IN_REVIEW'].includes(register.status))
    errors.push('register.status is invalid.');
  if (!canonicalTimestamp(register.preparedAt) || new Date(register.preparedAt) > now)
    errors.push('register.preparedAt must be an observed canonical UTC timestamp.');
  if (exactKeys(register.candidate, CANDIDATE_KEYS, 'candidate', errors)) {
    if (
      !GIT_OID.test(register.candidate.executableCommit) ||
      !GIT_OID.test(register.candidate.executableTree) ||
      !GIT_OID.test(register.candidate.packetPreparationBaseCommit)
    )
      errors.push('candidate commits/tree must be lowercase full Git object IDs.');
    if (
      register.candidate.executableScope !== 'tools/wallet-lab' ||
      register.candidate.packageManifestPath !== 'tools/wallet-lab/package.json' ||
      register.candidate.packageLockPath !== 'tools/wallet-lab/package-lock.json'
    )
      errors.push('candidate paths must equal the isolated wallet-lab boundary.');
    if (
      !SHA256.test(register.candidate.packageManifestSha256) ||
      !SHA256.test(register.candidate.packageLockSha256)
    )
      errors.push('candidate SHA-256 values must be uppercase hexadecimal.');
  }

  if (
    !Array.isArray(register.supportingArtifacts) ||
    register.supportingArtifacts.length !== SUPPORTING_ARTIFACTS.length
  )
    errors.push('supportingArtifacts must contain the closed packet artifact set.');
  else
    for (const [index, [id, path]] of SUPPORTING_ARTIFACTS.entries()) {
      const artifact = register.supportingArtifacts[index];
      if (!exactKeys(artifact, ['id', 'path', 'sha256'], `supportingArtifacts[${index}]`, errors))
        continue;
      if (artifact.id !== id || artifact.path !== path || !SHA256.test(artifact.sha256))
        errors.push(`supportingArtifacts[${index}] must exactly bind ${id}.`);
    }
  const computedArtifactSet = computeSupportingArtifactSetSha256(register.supportingArtifacts);
  if (
    register.supportingArtifactSetSha256 !== computedArtifactSet ||
    !SHA256.test(register.supportingArtifactSetSha256)
  )
    errors.push('supportingArtifactSetSha256 does not bind the canonical supporting artifact set.');
  if (
    !exactKeys(
      register.versions,
      ['dependencies', 'devDependencies', 'overrides'],
      'versions',
      errors,
    )
  ) {
    // Exact package comparison below remains guarded by repository inspection.
  }

  if (!Array.isArray(register.limitations) || register.limitations.length !== LIMITATION_IDS.length)
    errors.push('limitations must contain the closed supported-limitation set.');
  else
    for (const [index, id] of LIMITATION_IDS.entries()) {
      const row = register.limitations[index];
      const path = `limitations[${index}]`;
      if (
        !exactKeys(
          row,
          ['id', 'status', 'ownerTickets', 'summary', 'evidenceArtifactIds'],
          path,
          errors,
        )
      )
        continue;
      if (
        row.id !== id ||
        row.status !== 'OPEN' ||
        !Array.isArray(row.ownerTickets) ||
        row.ownerTickets.length === 0 ||
        !row.ownerTickets.every(validTicket) ||
        !nonPlaceholder(row.summary, 20)
      )
        errors.push(`${path} must record an open, owned, meaningful limitation.`);
      if (
        !Array.isArray(row.evidenceArtifactIds) ||
        row.evidenceArtifactIds.length === 0 ||
        !row.evidenceArtifactIds.every((artifactId) =>
          SUPPORTING_ARTIFACTS.some(([artifact]) => artifact === artifactId),
        )
      )
        errors.push(`${path}.evidenceArtifactIds must reference packet artifacts.`);
    }

  let repository = options.repository;
  if (repository === undefined) {
    try {
      repository = inspectWalletReviewRepository(register, options.repositoryRoot);
    } catch (error) {
      errors.push(
        `repository inspection failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      repository = {
        candidateCommit: null,
        baseCommit: null,
        candidateTree: null,
        baseTree: null,
        candidateIsAncestor: false,
        scopeClean: false,
        manifestSha256: null,
        lockSha256: null,
        versions: null,
        artifactHashes: {},
        evidenceExists: () => false,
      };
    }
  }
  validateRequiredResults(register, errors, repository, now);
  validateSecurityFindings(register, errors, repository, now);
  validateExecutionGates(register, errors, repository);
  validateDecisionRows(register, errors, repository, now);
  validateSignoffs(register, errors, repository, now);
  exactArray(register.reReviewTriggers, RE_REVIEW_TRIGGERS, 'reReviewTriggers', errors);
  validatePreparationOnlySchema(register, errors);

  if (
    exactKeys(
      register.externalReviewBinding,
      ['status', 'attestedCommit', 'attestedTree', 'registerSha256'],
      'externalReviewBinding',
      errors,
    )
  ) {
    if (
      register.externalReviewBinding.status !== 'PENDING' ||
      register.externalReviewBinding.attestedCommit !== null ||
      register.externalReviewBinding.attestedTree !== null ||
      register.externalReviewBinding.registerSha256 !== null
    )
      errors.push(
        'externalReviewBinding is a post-commit attestation placeholder and must remain explicitly pending in this packet.',
      );
  }

  if (
    repository.candidateCommit !== register.candidate?.executableCommit ||
    repository.baseCommit !== register.candidate?.packetPreparationBaseCommit
  )
    errors.push('candidate commit binding does not resolve exactly.');
  if (!repository.candidateIsAncestor)
    errors.push('candidate commit must be an ancestor of the packet-preparation base.');
  if (
    repository.candidateTree !== register.candidate?.executableTree ||
    repository.baseTree !== register.candidate?.executableTree
  )
    errors.push('candidate/base wallet-lab Git tree does not match the frozen executable tree.');
  if (!repository.scopeClean)
    errors.push('tools/wallet-lab differs from the frozen executable candidate.');
  if (
    repository.manifestSha256 !== register.candidate?.packageManifestSha256 ||
    repository.lockSha256 !== register.candidate?.packageLockSha256
  )
    errors.push('candidate manifest or lock SHA-256 is stale.');
  if (JSON.stringify(repository.versions) !== JSON.stringify(register.versions))
    errors.push(
      'versions must exactly match wallet-lab dependencies, devDependencies, and overrides.',
    );
  if (Array.isArray(register.supportingArtifacts))
    for (const artifact of register.supportingArtifacts) {
      if (isRecord(artifact) && repository.artifactHashes?.[artifact.path] !== artifact.sha256)
        errors.push(`${artifact.path} SHA-256 is stale.`);
    }

  const ready = isReady(register);
  if ((register.status === 'READY_FOR_IN_REVIEW') !== ready)
    errors.push(
      `register.status must be ${ready ? 'READY_FOR_IN_REVIEW' : 'PENDING_EXTERNAL_REVIEW'} from its gates.`,
    );
  return { errors, ready };
}

export function validateWalletReviewFiles({
  repositoryRoot = REPOSITORY_ROOT,
  now = new Date(),
} = {}) {
  const registerAbsolute = containedPath(repositoryRoot, REVIEW_REGISTER_PATH);
  const sidecarAbsolute = containedPath(repositoryRoot, REVIEW_SIDECAR_PATH);
  if (registerAbsolute === null || sidecarAbsolute === null)
    return { errors: ['Register or SHA-256 sidecar is missing/unsafe.'], ready: false };
  let register;
  const bytes = readFileSync(registerAbsolute);
  try {
    register = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { errors: ['KAN-227 register is not valid JSON.'], ready: false };
  }
  const result = validateWalletReviewRegister(register, { repositoryRoot, now });
  result.errors.push(...validateWalletReviewSidecar(bytes, readFileSync(sidecarAbsolute, 'utf8')));
  return result;
}

export function validateWalletReviewSidecar(registerBytes, sidecar) {
  const expected = `${sha256Bytes(registerBytes).toLowerCase()}  kan-227-consolidated-review.json\n`;
  return sidecar === expected
    ? []
    : ['KAN-227 SHA-256 sidecar does not exactly bind the register bytes.'];
}

function main() {
  const result = validateWalletReviewFiles();
  if (result.errors.length > 0) {
    console.error('KAN-227 wallet review packet validation failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `KAN-227 wallet review packet is structurally valid; KAN-55 readiness: ${result.ready ? 'READY_FOR_IN_REVIEW' : 'PENDING_EXTERNAL_REVIEW'}.`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
