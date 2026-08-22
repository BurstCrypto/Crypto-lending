#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(moduleDirectory, '..', '..');
export const threatModelPath = resolve(
  repositoryRoot,
  'docs',
  'security',
  'threat-model-register.json',
);
export const threatModelFingerprintPath = resolve(
  repositoryRoot,
  'docs',
  'security',
  'threat-model-register.sha256',
);

const CLASSIFICATION_CONTRACT = new Map([
  [
    'PUBLIC',
    {
      rank: 0,
      handling:
        'May be intentionally disclosed, but integrity and provenance controls still apply.',
    },
  ],
  [
    'INTERNAL',
    {
      rank: 1,
      handling:
        'Limited to personnel and systems with an operational need; never assume public disclosure is harmless.',
    },
  ],
  [
    'CONFIDENTIAL',
    {
      rank: 2,
      handling:
        'Need-to-know access, encrypted transport and storage, bounded retention, and no unrestricted exports.',
    },
  ],
  [
    'RESTRICTED',
    {
      rank: 3,
      handling:
        'Customer, authentication, wallet, financial, or security-sensitive data with least-privilege access and explicit lifecycle approval.',
    },
  ],
  [
    'PROHIBITED',
    {
      rank: 4,
      handling:
        'Must never enter application persistence, logs, analytics, source control, Jira, or review evidence.',
    },
  ],
]);
const CLASSIFICATIONS = new Set(CLASSIFICATION_CONTRACT.keys());
const IMPACTS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const STRIDE = new Set([
  'SPOOFING',
  'TAMPERING',
  'REPUDIATION',
  'INFORMATION_DISCLOSURE',
  'DENIAL_OF_SERVICE',
  'ELEVATION_OF_PRIVILEGE',
]);
const REQUIRED_DOMAINS = new Set([
  'ACCOUNT',
  'WALLET',
  'LEDGER',
  'ADMIN',
  'SECRETS',
  'SUPPLY_CHAIN',
  'AVAILABILITY',
]);
const RISKS = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const RESPONSES = new Set(['MITIGATE', 'ELIMINATE', 'TRANSFER', 'ACCEPT']);
const STATUSES = new Set(['MITIGATED_LOCAL', 'OPEN_EXTERNAL', 'OPEN_FOLLOW_UP']);
const FORBIDDEN_MATERIAL_KEYS = new Set([
  'accesstoken',
  'actualvalue',
  'apikey',
  'clientsecret',
  'credentialvalue',
  'idtoken',
  'password',
  'privatekey',
  'refreshtoken',
  'secretvalue',
  'seedphrase',
  'sessiontoken',
  'tokenvalue',
]);
const REQUIRED_BOUNDARY_IDS = new Set(
  Array.from({ length: 11 }, (_, index) => `TB-${String(index + 1).padStart(2, '0')}`),
);
const REQUIRED_DATA_IDS = new Set(
  Array.from({ length: 16 }, (_, index) => `DATA-${String(index + 1).padStart(3, '0')}`),
);
const REQUIRED_SECRET_IDS = new Set(
  Array.from({ length: 12 }, (_, index) => `KEY-${String(index + 1).padStart(3, '0')}`),
);
const REQUIRED_THREAT_IDS = new Set([
  'THR-ACCOUNT-001',
  'THR-ACCOUNT-002',
  'THR-ACCOUNT-003',
  'THR-ACCOUNT-004',
  'THR-WALLET-001',
  'THR-WALLET-002',
  'THR-WALLET-003',
  'THR-LEDGER-001',
  'THR-LEDGER-002',
  'THR-LEDGER-003',
  'THR-LEDGER-004',
  'THR-ADMIN-001',
  'THR-ADMIN-002',
  'THR-ADMIN-003',
  'THR-ADMIN-004',
  'THR-ADMIN-005',
  'THR-ADMIN-006',
  'THR-SECRETS-001',
  'THR-SECRETS-002',
  'THR-SECRETS-003',
  'THR-SUPPLY-001',
  'THR-SUPPLY-002',
  'THR-AVAILABILITY-001',
  'THR-AVAILABILITY-002',
]);
const ACCOUNTABLE_ROLES = new Set([
  'Accounts',
  'Backend',
  'Blockchain',
  'Cloud Security',
  'Database',
  'Finance',
  'Identity',
  'Ledger',
  'OSS',
  'Privacy',
  'Records',
  'Release',
  'Risk',
  'SRE',
  'Security',
  'Wallet',
  'Wallet Test Lead',
]);
const PLACEHOLDER_VALUE = /^(?:n\/?a|none|nobody|not set|pending|tbd|todo|unknown|x)$/iu;
const RETENTION_CONTROL =
  /(?:\d+_(?:DAY|DAYS|MINUTE|MINUTES)(?:_|;|$)|TTL|PENDING|NEVER|SESSION|APPEND_ONLY|VERSION_HISTORY|DECISION_AND_EXPIRY_BOUND)/u;
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'ticket',
  'modelVersion',
  'localStatus',
  'scope',
  'independentApproval',
  'classificationLevels',
  'trustBoundaries',
  'dataAssets',
  'secretInventory',
  'threats',
]);
const INDEPENDENT_APPROVAL_KEYS = new Set([
  'ticket',
  'status',
  'selfApprovalForbidden',
  'requiredDecision',
  'requiredBinding',
]);
const CLASSIFICATION_KEYS = new Set(['name', 'rank', 'handling']);
const BOUNDARY_KEYS = new Set(['id', 'name', 'source', 'destination', 'data', 'evidence']);
const DATA_ASSET_KEYS = new Set([
  'id',
  'name',
  'classification',
  'cia',
  'stores',
  'retention',
  'logging',
  'owner',
  'evidence',
]);
const CIA_KEYS = new Set(['confidentiality', 'integrity', 'availability']);
const SECRET_INVENTORY_KEYS = new Set([
  'id',
  'name',
  'classification',
  'consumers',
  'injection',
  'storage',
  'rotation',
  'owner',
  'evidence',
]);
const THREAT_KEYS = new Set([
  'id',
  'domain',
  'stride',
  'scenario',
  'risk',
  'boundaryIds',
  'assetIds',
  'response',
  'mitigations',
  'owner',
  'status',
  'evidence',
  'residualRisk',
  'followUp',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(value, path, errors) {
  if (!nonEmptyString(value)) errors.push(`${path} must be a non-empty string.`);
}

function requireMeaningfulString(value, path, errors) {
  requireString(value, path, errors);
  if (nonEmptyString(value) && (value.trim().length < 12 || PLACEHOLDER_VALUE.test(value.trim()))) {
    errors.push(`${path} must be a meaningful, non-placeholder statement.`);
  }
}

function requireOwner(value, path, errors) {
  requireString(value, path, errors);
  if (!nonEmptyString(value)) return;
  const roles = value
    .split(/,|\band\b/u)
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length === 0 || roles.some((role) => !ACCOUNTABLE_ROLES.has(role))) {
    errors.push(`${path} must name only reviewed accountable repository roles.`);
  }
}

function requireStringArray(value, path, errors, minimum = 1) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.some((entry) => !nonEmptyString(entry))
  ) {
    errors.push(`${path} must contain at least ${minimum} non-empty string(s).`);
    return [];
  }
  return value;
}

function collectIds(entries, path, errors) {
  const ids = new Set();
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${path} must be a non-empty array.`);
    return ids;
  }
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry) || !nonEmptyString(entry.id)) {
      errors.push(`${path}[${index}].id must be a non-empty string.`);
      continue;
    }
    if (ids.has(entry.id)) errors.push(`${path} contains duplicate id ${entry.id}.`);
    ids.add(entry.id);
  }
  return ids;
}

function requireBaselineIds(ids, requiredIds, path, errors) {
  for (const id of requiredIds) {
    if (!ids.has(id)) errors.push(`${path} must retain baseline id ${id}.`);
  }
}

function entriesOf(value) {
  return Array.isArray(value) ? value.entries() : [];
}

export function isEvidenceFileWithinRepository(path, root = repositoryRoot) {
  if (
    !nonEmptyString(path) ||
    path === '.' ||
    isAbsolute(path) ||
    path.split(/[\\/]/u).includes('..')
  ) {
    return false;
  }
  try {
    const realRoot = realpathSync(root);
    let candidate = realRoot;
    for (const segment of path.split(/[\\/]/u)) {
      candidate = resolve(candidate, segment);
      if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) return false;
    }
    if (!lstatSync(candidate).isFile()) return false;
    const realCandidate = realpathSync(candidate);
    const inside = relative(realRoot, realCandidate);
    return inside.length > 0 && !isAbsolute(inside) && !inside.split(/[\\/]/u).includes('..');
  } catch {
    return false;
  }
}

function rejectUnknownKeys(value, allowedKeys, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not an allowed field.`);
  }
}

function validateEvidence(evidence, path, errors, evidenceExists) {
  for (const [index, entry] of requireStringArray(evidence, path, errors).entries()) {
    if (
      entry === '.' ||
      entry.startsWith('/') ||
      /^[A-Za-z]:[\\/]/u.test(entry) ||
      entry.split(/[\\/]/u).includes('..')
    ) {
      errors.push(`${path}[${index}] must be a repository-relative path.`);
      continue;
    }
    if (!evidenceExists(entry)) errors.push(`${path}[${index}] does not exist in the repository.`);
  }
}

function inspectForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectForbiddenKeys(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
    if (FORBIDDEN_MATERIAL_KEYS.has(normalizedKey)) {
      errors.push(
        `${path}.${key} is forbidden; inventory metadata must never contain secret material.`,
      );
    }
    inspectForbiddenKeys(child, `${path}.${key}`, errors);
  }
}

function inspectApprovalClaims(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectApprovalClaims(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) {
    if (
      typeof value === 'string' &&
      ['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(value) &&
      !path.startsWith('record.independentApproval.requiredDecision[')
    ) {
      errors.push(`${path} contains an unauthorized approval decision claim.`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
    if (
      normalizedKey.includes('approval') &&
      !(
        (path === 'record' && key === 'independentApproval') ||
        (path === 'record.independentApproval' && key === 'selfApprovalForbidden')
      )
    ) {
      errors.push(`${path}.${key} is an unauthorized approval field.`);
    }
    inspectApprovalClaims(child, `${path}.${key}`, errors);
  }
}

export function validateThreatModelRecord(
  record,
  { evidenceExists = isEvidenceFileWithinRepository } = {},
) {
  const errors = [];
  if (!isRecord(record)) return ['record must be a JSON object.'];
  rejectUnknownKeys(record, TOP_LEVEL_KEYS, 'record', errors);
  inspectForbiddenKeys(record, 'record', errors);
  inspectApprovalClaims(record, 'record', errors);

  if (record.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');
  if (record.ticket !== 'KAN-49') errors.push('ticket must equal KAN-49.');
  requireString(record.modelVersion, 'modelVersion', errors);
  if (record.localStatus !== 'READY_FOR_INDEPENDENT_REVIEW') {
    errors.push('localStatus must equal READY_FOR_INDEPENDENT_REVIEW.');
  }
  requireString(record.scope, 'scope', errors);

  if (!isRecord(record.independentApproval)) {
    errors.push('independentApproval must be an object.');
  } else {
    rejectUnknownKeys(
      record.independentApproval,
      INDEPENDENT_APPROVAL_KEYS,
      'independentApproval',
      errors,
    );
    if (record.independentApproval.ticket !== 'KAN-235') {
      errors.push('independentApproval.ticket must equal KAN-235.');
    }
    if (record.independentApproval.status !== 'PENDING') {
      errors.push(
        'independentApproval.status must remain PENDING until an independent decision exists.',
      );
    }
    if (record.independentApproval.selfApprovalForbidden !== true) {
      errors.push('independentApproval.selfApprovalForbidden must be true.');
    }
    const decisions = requireStringArray(
      record.independentApproval.requiredDecision,
      'independentApproval.requiredDecision',
      errors,
      3,
    );
    for (const expected of ['APPROVED', 'CONDITIONAL', 'REJECTED']) {
      if (!decisions.includes(expected)) {
        errors.push(`independentApproval.requiredDecision must include ${expected}.`);
      }
    }
    if (
      decisions.length !== 3 ||
      new Set(decisions).size !== 3 ||
      decisions.some((decision) => !['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(decision))
    ) {
      errors.push(
        'independentApproval.requiredDecision must equal exactly APPROVED, CONDITIONAL, and REJECTED.',
      );
    }
    const bindings = requireStringArray(
      record.independentApproval.requiredBinding,
      'independentApproval.requiredBinding',
      errors,
      3,
    );
    for (const expected of ['gitCommitSha', 'gitTreeSha', 'registerSha256']) {
      if (!bindings.includes(expected)) {
        errors.push(`independentApproval.requiredBinding must include ${expected}.`);
      }
    }
    if (
      bindings.length !== 3 ||
      new Set(bindings).size !== 3 ||
      bindings.some(
        (binding) => !['gitCommitSha', 'gitTreeSha', 'registerSha256'].includes(binding),
      )
    ) {
      errors.push(
        'independentApproval.requiredBinding must equal exactly gitCommitSha, gitTreeSha, and registerSha256.',
      );
    }
  }

  const levels = Array.isArray(record.classificationLevels) ? record.classificationLevels : [];
  const levelNames = new Set();
  for (const [index, level] of levels.entries()) {
    if (!isRecord(level)) {
      errors.push(`classificationLevels[${index}] must be an object.`);
      continue;
    }
    rejectUnknownKeys(level, CLASSIFICATION_KEYS, `classificationLevels[${index}]`, errors);
    if (!CLASSIFICATIONS.has(level.name)) {
      errors.push(`classificationLevels[${index}].name is not recognized.`);
    } else if (levelNames.has(level.name)) {
      errors.push(`classificationLevels contains duplicate name ${level.name}.`);
    } else {
      levelNames.add(level.name);
    }
    const expected = CLASSIFICATION_CONTRACT.get(level.name);
    if (!expected || level.rank !== expected.rank) {
      errors.push(
        `classificationLevels[${index}].rank does not match the classification contract.`,
      );
    }
    if (!expected || level.handling !== expected.handling) {
      errors.push(
        `classificationLevels[${index}].handling does not match the classification contract.`,
      );
    }
  }
  for (const expected of CLASSIFICATIONS) {
    if (!levelNames.has(expected)) errors.push(`classificationLevels must define ${expected}.`);
  }

  const boundaryIds = collectIds(record.trustBoundaries, 'trustBoundaries', errors);
  requireBaselineIds(boundaryIds, REQUIRED_BOUNDARY_IDS, 'trustBoundaries', errors);
  for (const [index, boundary] of entriesOf(record.trustBoundaries)) {
    if (!isRecord(boundary)) continue;
    rejectUnknownKeys(boundary, BOUNDARY_KEYS, `trustBoundaries[${index}]`, errors);
    requireString(boundary.name, `trustBoundaries[${index}].name`, errors);
    requireString(boundary.source, `trustBoundaries[${index}].source`, errors);
    requireString(boundary.destination, `trustBoundaries[${index}].destination`, errors);
    requireStringArray(boundary.data, `trustBoundaries[${index}].data`, errors);
    validateEvidence(
      boundary.evidence,
      `trustBoundaries[${index}].evidence`,
      errors,
      evidenceExists,
    );
  }

  const assetIds = collectIds(record.dataAssets, 'dataAssets', errors);
  requireBaselineIds(assetIds, REQUIRED_DATA_IDS, 'dataAssets', errors);
  for (const [index, asset] of entriesOf(record.dataAssets)) {
    if (!isRecord(asset)) continue;
    rejectUnknownKeys(asset, DATA_ASSET_KEYS, `dataAssets[${index}]`, errors);
    requireString(asset.name, `dataAssets[${index}].name`, errors);
    if (!CLASSIFICATIONS.has(asset.classification)) {
      errors.push(`dataAssets[${index}].classification is not recognized.`);
    }
    if (!isRecord(asset.cia)) {
      errors.push(`dataAssets[${index}].cia must be an object.`);
    } else {
      rejectUnknownKeys(asset.cia, CIA_KEYS, `dataAssets[${index}].cia`, errors);
      for (const dimension of ['confidentiality', 'integrity', 'availability']) {
        if (!IMPACTS.has(asset.cia[dimension])) {
          errors.push(`dataAssets[${index}].cia.${dimension} is not recognized.`);
        }
      }
    }
    const stores = requireStringArray(asset.stores, `dataAssets[${index}].stores`, errors, 0);
    requireString(asset.retention, `dataAssets[${index}].retention`, errors);
    if (nonEmptyString(asset.retention) && !RETENTION_CONTROL.test(asset.retention)) {
      errors.push(
        `dataAssets[${index}].retention must name a bounded lifecycle or an explicit pending-policy gate.`,
      );
    }
    requireString(asset.logging, `dataAssets[${index}].logging`, errors);
    requireOwner(asset.owner, `dataAssets[${index}].owner`, errors);
    validateEvidence(asset.evidence, `dataAssets[${index}].evidence`, errors, evidenceExists);
    if (
      asset.classification === 'PROHIBITED' &&
      (stores.length !== 0 || asset.retention !== 'NEVER_COLLECT' || asset.logging !== 'NEVER')
    ) {
      errors.push(
        `dataAssets[${index}] is PROHIBITED and must use no stores, NEVER_COLLECT retention, and NEVER logging.`,
      );
    }
  }

  const secretIds = collectIds(record.secretInventory, 'secretInventory', errors);
  requireBaselineIds(secretIds, REQUIRED_SECRET_IDS, 'secretInventory', errors);
  for (const [index, secret] of entriesOf(record.secretInventory)) {
    if (!isRecord(secret)) continue;
    rejectUnknownKeys(secret, SECRET_INVENTORY_KEYS, `secretInventory[${index}]`, errors);
    requireString(secret.name, `secretInventory[${index}].name`, errors);
    if (secret.classification !== 'RESTRICTED') {
      errors.push(`secretInventory[${index}].classification must equal RESTRICTED.`);
    }
    requireStringArray(secret.consumers, `secretInventory[${index}].consumers`, errors);
    requireString(secret.injection, `secretInventory[${index}].injection`, errors);
    requireString(secret.storage, `secretInventory[${index}].storage`, errors);
    requireString(secret.rotation, `secretInventory[${index}].rotation`, errors);
    requireOwner(secret.owner, `secretInventory[${index}].owner`, errors);
    validateEvidence(secret.evidence, `secretInventory[${index}].evidence`, errors, evidenceExists);
  }

  const threatIds = collectIds(record.threats, 'threats', errors);
  requireBaselineIds(threatIds, REQUIRED_THREAT_IDS, 'threats', errors);
  const coveredDomains = new Set();
  for (const [index, threat] of entriesOf(record.threats)) {
    if (!isRecord(threat)) continue;
    rejectUnknownKeys(threat, THREAT_KEYS, `threats[${index}]`, errors);
    requireString(threat.scenario, `threats[${index}].scenario`, errors);
    if (!REQUIRED_DOMAINS.has(threat.domain)) {
      errors.push(`threats[${index}].domain is not recognized.`);
    } else if (threat.risk === 'HIGH' || threat.risk === 'CRITICAL') {
      coveredDomains.add(threat.domain);
    }
    for (const category of requireStringArray(threat.stride, `threats[${index}].stride`, errors)) {
      if (!STRIDE.has(category))
        errors.push(`threats[${index}].stride contains an unknown category.`);
    }
    if (!RISKS.has(threat.risk)) errors.push(`threats[${index}].risk is not recognized.`);
    if (!RESPONSES.has(threat.response)) {
      errors.push(`threats[${index}].response is not recognized.`);
    }
    if (!STATUSES.has(threat.status)) errors.push(`threats[${index}].status is not recognized.`);
    requireOwner(threat.owner, `threats[${index}].owner`, errors);
    requireMeaningfulString(threat.residualRisk, `threats[${index}].residualRisk`, errors);
    requireMeaningfulString(threat.followUp, `threats[${index}].followUp`, errors);
    for (const [mitigationIndex, mitigation] of requireStringArray(
      threat.mitigations,
      `threats[${index}].mitigations`,
      errors,
    ).entries()) {
      requireMeaningfulString(
        mitigation,
        `threats[${index}].mitigations[${mitigationIndex}]`,
        errors,
      );
    }
    validateEvidence(threat.evidence, `threats[${index}].evidence`, errors, evidenceExists);
    for (const boundaryId of requireStringArray(
      threat.boundaryIds,
      `threats[${index}].boundaryIds`,
      errors,
    )) {
      if (!boundaryIds.has(boundaryId)) {
        errors.push(`threats[${index}].boundaryIds references unknown boundary ${boundaryId}.`);
      }
    }
    for (const assetId of requireStringArray(
      threat.assetIds,
      `threats[${index}].assetIds`,
      errors,
    )) {
      if (!assetIds.has(assetId)) {
        errors.push(`threats[${index}].assetIds references unknown asset ${assetId}.`);
      }
    }
    if ((threat.risk === 'HIGH' || threat.risk === 'CRITICAL') && threat.response === 'ACCEPT') {
      errors.push(`threats[${index}] cannot locally accept HIGH or CRITICAL risk.`);
    }
  }
  for (const domain of REQUIRED_DOMAINS) {
    if (!coveredDomains.has(domain)) {
      errors.push(`threats must contain a HIGH or CRITICAL row for domain ${domain}.`);
    }
  }

  return errors;
}

export function validateCanonicalThreatModel() {
  let source;
  let expectedFingerprint;
  try {
    source = readFileSync(threatModelPath, 'utf8');
    expectedFingerprint = readFileSync(threatModelFingerprintPath, 'utf8').trim();
  } catch {
    return {
      errors: ['Canonical threat model or fingerprint file is missing.'],
      fingerprint: null,
    };
  }

  let record;
  try {
    record = JSON.parse(source);
  } catch {
    return { errors: ['Canonical threat model is not valid JSON.'], fingerprint: null };
  }
  const fingerprint = createHash('sha256').update(source, 'utf8').digest('hex');
  const errors = validateThreatModelRecord(record);
  if (!/^[0-9a-f]{64}$/u.test(expectedFingerprint)) {
    errors.push('Canonical fingerprint must be one lowercase SHA-256 value.');
  } else if (expectedFingerprint !== fingerprint) {
    errors.push('Canonical threat model fingerprint does not match its reviewed sidecar.');
  }
  return { errors, fingerprint };
}

function main() {
  const result = validateCanonicalThreatModel();
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`KAN-49 validation: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`KAN-49 threat model valid (sha256 ${result.fingerprint}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
