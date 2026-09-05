#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, TextDecoder } from 'node:util';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import { readSecureLocalFile } from '../shared/read-secure-local-file.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PREPARATION_PATH = 'docs/security/kan-235-wallet-penetration-test-preparation.json';
export const SIDECAR_PATH = 'docs/security/kan-235-wallet-penetration-test-preparation.sha256';
export const THREAT_MODEL_PATH = 'docs/security/threat-model-register.json';
export const MAX_PREPARATION_BYTES = 16_384;
export const MAX_SIDECAR_BYTES = 65;
export const MAX_THREAT_MODEL_BYTES = 131_072;
export const EXPECTED_PREPARATION_SHA256 =
  '54cb14c3e9e5a5c58391edab148b05641eb25e5b2a9ea543a063004b4da63ed1';
export const EXPECTED_THREAT_MODEL_SHA256 =
  'f38db2134cbf7002acb865dfaa8b30ff6c8a144da2ccbe387f24326f568a4567';
export const PREPARATION_FILE_ERROR =
  'KAN-235 preparation record, sidecar, or reviewed threat model is missing, unsafe, or unreadable.';
export const PREPARATION_JSON_ERROR =
  'KAN-235 preparation record must be strict UTF-8 JSON without a byte-order mark or duplicate object keys.';
export const PREPARATION_SIDECAR_ERROR =
  'KAN-235 sidecar must be exactly one lowercase SHA-256 value followed by LF.';

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'ticket',
  'artifactId',
  'preparedOn',
  'status',
  'evidenceStatus',
  'decisionStatus',
  'scope',
  'candidateBinding',
  'reviewerBoundary',
  'testPlan',
  'mandatoryControls',
  'requiredEvidence',
  'findingPolicy',
  'blockers',
  'zeroCostEvidence',
];
const SCOPE_KEYS = [
  'purpose',
  'networkFamilies',
  'productionNetworkIds',
  'executionEnvironment',
  'executionMode',
  'publicDeployment',
  'mainnetTransactions',
  'fundedWallets',
  'customerData',
  'mayAuthorizeLaunch',
  'mayAuthorizeFinancialAction',
];
const CANDIDATE_KEYS = [
  'releaseCommitSha',
  'releaseTreeSha',
  'releaseManifestSha256',
  'threatModelPath',
  'threatModelSha256',
  'walletReviewPrerequisite',
];
const REVIEWER_KEYS = [
  'independentReviewerAssigned',
  'reviewerIdentity',
  'reviewerOrganization',
  'independenceStatement',
  'rulesOfEngagementReference',
  'permittedEnvironment',
  'testWindowStartsAt',
  'testWindowEndsAt',
];
const PLAN_KEYS = ['id', 'objective', 'techniques', 'status', 'evidenceReference'];
const EVIDENCE_KEYS = ['id', 'status', 'reference', 'sha256'];
const EXPECTED_SCOPE = {
  purpose: 'INDEPENDENT_WALLET_PENETRATION_TEST_PREPARATION_ONLY',
  networkFamilies: ['ETHEREUM', 'SOLANA'],
  productionNetworkIds: ['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  executionEnvironment: 'NOT_AUTHORIZED',
  executionMode: 'PLAN_ONLY_NO_TEST_EXECUTION',
  publicDeployment: 'PROHIBITED',
  mainnetTransactions: 'PROHIBITED',
  fundedWallets: 'PROHIBITED',
  customerData: 'PROHIBITED',
  mayAuthorizeLaunch: false,
  mayAuthorizeFinancialAction: false,
};
const EXPECTED_REVIEWER = {
  independentReviewerAssigned: false,
  reviewerIdentity: null,
  reviewerOrganization: null,
  independenceStatement: null,
  rulesOfEngagementReference: null,
  permittedEnvironment: null,
  testWindowStartsAt: null,
  testWindowEndsAt: null,
};
const EXPECTED_PLAN = new Map([
  [
    'AUTHENTICATION_SESSION_BOUNDARY',
    [
      'SESSION_FIXATION_AND_REPLAY',
      'LOGOUT_AND_REVOCATION',
      'CSRF_AND_ORIGIN_BINDING',
      'BROKEN_OBJECT_LEVEL_AUTHORIZATION',
    ],
  ],
  [
    'EVM_WALLET_OWNERSHIP_BOUNDARY',
    [
      'CHALLENGE_REPLAY',
      'DOMAIN_AND_ORIGIN_CONFUSION',
      'CHAIN_AND_ACCOUNT_SUBSTITUTION',
      'SIGNATURE_MALLEABILITY_AND_FORMAT_VALIDATION',
    ],
  ],
  [
    'SOLANA_WALLET_OWNERSHIP_BOUNDARY',
    [
      'CHALLENGE_REPLAY',
      'DOMAIN_AND_ORIGIN_CONFUSION',
      'CLUSTER_AND_ACCOUNT_SUBSTITUTION',
      'SIGNATURE_AND_MESSAGE_FORMAT_VALIDATION',
    ],
  ],
  [
    'MULTICHAIN_WALLET_ISOLATION',
    [
      'CROSS_CHAIN_IDENTITY_CONFUSION',
      'PROVIDER_REPLACEMENT',
      'STALE_EVENT_RACE',
      'MULTI_WALLET_SESSION_ISOLATION',
    ],
  ],
  [
    'WALLET_DISCONNECT_AND_REVOCATION',
    [
      'STALE_PROVIDER_SESSION',
      'DISCONNECT_FAILURE',
      'ACCOUNT_AND_CHAIN_CHANGE_RACE',
      'RESTORED_VENDOR_STATE',
    ],
  ],
  [
    'TRANSACTION_CAPABILITY_DENIAL',
    [
      'HIDDEN_ACTION_DISCOVERY',
      'DIRECT_API_INVOCATION',
      'METHOD_AND_PARAMETER_TAMPERING',
      'CLIENT_STATE_BYPASS',
    ],
  ],
  [
    'WALLET_PRIVACY_AND_EGRESS',
    [
      'LOG_AND_ERROR_INSPECTION',
      'BROWSER_STORAGE_INSPECTION',
      'NETWORK_DESTINATION_INVENTORY',
      'SENSITIVE_DATA_EXPOSURE',
    ],
  ],
]);
const EXPECTED_CONTROLS = [
  'EXACT_RELEASE_CANDIDATE_BINDING',
  'WRITTEN_AUTHORIZATION_AND_RULES_OF_ENGAGEMENT',
  'INDEPENDENT_REVIEWER',
  'ISOLATED_AUTHORIZED_NON_PRODUCTION_ENVIRONMENT',
  'DEDICATED_UNFUNDED_TEST_WALLETS',
  'ETHEREUM_AND_SOLANA_ONLY_SCOPE',
  'NO_MAINNET_TRANSACTION_SUBMISSION',
  'NO_CUSTOMER_OR_PRODUCTION_DATA',
  'EMERGENCY_STOP_AND_INCIDENT_CONTACT',
  'SANITIZED_EVIDENCE_AND_APPROVED_RETENTION',
];
const EXPECTED_EVIDENCE_IDS = [
  'RULES_OF_ENGAGEMENT',
  'EXACT_RELEASE_CANDIDATE_BINDING',
  'TOOL_AND_VERSION_INVENTORY',
  'SANITIZED_TEST_EXECUTION_LOG',
  'SANITIZED_FINDING_REGISTER',
  'RETEST_RESULTS',
  'FINAL_INDEPENDENT_DECISION',
];
const EXPECTED_BLOCKERS = [
  'INDEPENDENT_REVIEWER_NOT_ASSIGNED',
  'RULES_OF_ENGAGEMENT_NOT_APPROVED',
  'EXACT_RELEASE_CANDIDATE_NOT_BOUND',
  'KAN_227_PREREQUISITE_PENDING',
  'EXECUTION_ENVIRONMENT_NOT_AUTHORIZED',
  'TEST_EVIDENCE_NOT_COLLECTED',
  'FINDINGS_NOT_DISPOSITIONED',
  'INDEPENDENT_DECISION_NOT_RECORDED',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label, errors) {
  if (!isRecord(value) || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) {
    errors.push(`${label} must retain its exact closed fields.`);
    return false;
  }
  return true;
}

function validatePreparationRecordInternal(record) {
  const errors = [];
  if (!exactKeys(record, TOP_LEVEL_KEYS, 'record', errors)) return errors;
  if (record.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');
  if (record.ticket !== 'KAN-235') errors.push('ticket must equal KAN-235.');
  if (record.artifactId !== 'KAN_235_WALLET_PENETRATION_TEST_PREPARATION_V1') {
    errors.push('artifactId must retain the preparation-only schema identity.');
  }
  if (record.preparedOn !== '2026-09-04') errors.push('preparedOn must retain the review date.');
  if (record.status !== 'PENDING_EXTERNAL_REVIEW') {
    errors.push('status must remain PENDING_EXTERNAL_REVIEW.');
  }
  if (record.evidenceStatus !== 'PENDING') errors.push('evidenceStatus must remain PENDING.');
  if (record.decisionStatus !== 'PENDING') errors.push('decisionStatus must remain PENDING.');

  if (exactKeys(record.scope, SCOPE_KEYS, 'scope', errors)) {
    if (!isDeepStrictEqual(record.scope, EXPECTED_SCOPE)) {
      errors.push('scope must retain the closed Ethereum/Solana plan-only prohibitions.');
    }
  }

  if (exactKeys(record.candidateBinding, CANDIDATE_KEYS, 'candidateBinding', errors)) {
    const candidate = record.candidateBinding;
    if (
      candidate.releaseCommitSha !== null ||
      candidate.releaseTreeSha !== null ||
      candidate.releaseManifestSha256 !== null
    ) {
      errors.push(
        'exact release-candidate bindings must remain null until independently supplied.',
      );
    }
    if (
      candidate.threatModelPath !== THREAT_MODEL_PATH ||
      candidate.threatModelSha256 !== EXPECTED_THREAT_MODEL_SHA256
    ) {
      errors.push('candidateBinding must retain the reviewed KAN-49 threat-model binding.');
    }
    const prerequisite = candidate.walletReviewPrerequisite;
    if (
      !exactKeys(
        prerequisite,
        ['ticket', 'status', 'path', 'sha256'],
        'KAN-227 prerequisite',
        errors,
      ) ||
      prerequisite.ticket !== 'KAN-227' ||
      prerequisite.status !== 'PENDING' ||
      prerequisite.path !== 'docs/wallets/review/kan-227-consolidated-review.json' ||
      prerequisite.sha256 !== null
    ) {
      errors.push('KAN-227 must remain a pending path-only prerequisite with no digest binding.');
    }
  }

  if (
    !exactKeys(record.reviewerBoundary, REVIEWER_KEYS, 'reviewerBoundary', errors) ||
    !isDeepStrictEqual(record.reviewerBoundary, EXPECTED_REVIEWER)
  ) {
    errors.push('reviewerBoundary must remain entirely unassigned and unauthorized.');
  }

  if (!Array.isArray(record.testPlan) || record.testPlan.length !== EXPECTED_PLAN.size) {
    errors.push('testPlan must retain all seven pending wallet security areas.');
  } else {
    const expectedEntries = [...EXPECTED_PLAN.entries()];
    record.testPlan.forEach((entry, index) => {
      const [expectedId, expectedTechniques] = expectedEntries[index];
      if (!exactKeys(entry, PLAN_KEYS, `testPlan[${index}]`, errors)) return;
      if (
        entry.id !== expectedId ||
        typeof entry.objective !== 'string' ||
        entry.objective.length < 40 ||
        entry.objective.length > 300 ||
        !isDeepStrictEqual(entry.techniques, expectedTechniques) ||
        entry.status !== 'PENDING' ||
        entry.evidenceReference !== null
      ) {
        errors.push(`testPlan[${index}] must retain its exact pending preparation boundary.`);
      }
    });
  }

  if (!isDeepStrictEqual(record.mandatoryControls, EXPECTED_CONTROLS)) {
    errors.push('mandatoryControls must retain the exact closed control list.');
  }
  if (!Array.isArray(record.requiredEvidence) || record.requiredEvidence.length !== 7) {
    errors.push('requiredEvidence must retain all seven pending evidence rows.');
  } else {
    record.requiredEvidence.forEach((entry, index) => {
      if (!exactKeys(entry, EVIDENCE_KEYS, `requiredEvidence[${index}]`, errors)) return;
      if (
        entry.id !== EXPECTED_EVIDENCE_IDS[index] ||
        entry.status !== 'PENDING' ||
        entry.reference !== null ||
        entry.sha256 !== null
      ) {
        errors.push(`requiredEvidence[${index}] must remain pending and unbound.`);
      }
    });
  }

  if (
    !exactKeys(
      record.findingPolicy,
      [
        'criticalOpenPermitted',
        'highOpenPermitted',
        'findingRegisterStatus',
        'retestStatus',
        'allowedDecisionValues',
        'decision',
        'decisionReference',
        'decisionExpiresAt',
      ],
      'findingPolicy',
      errors,
    ) ||
    !isDeepStrictEqual(record.findingPolicy, {
      criticalOpenPermitted: false,
      highOpenPermitted: false,
      findingRegisterStatus: 'PENDING',
      retestStatus: 'PENDING',
      allowedDecisionValues: ['APPROVED', 'CONDITIONAL', 'REJECTED'],
      decision: null,
      decisionReference: null,
      decisionExpiresAt: null,
    })
  ) {
    errors.push(
      'findingPolicy must remain pending with no decision or accepted High/Critical risk.',
    );
  }
  if (!isDeepStrictEqual(record.blockers, EXPECTED_BLOCKERS)) {
    errors.push('all eight KAN-235 blockers must remain explicit and ordered.');
  }
  if (
    !exactKeys(
      record.zeroCostEvidence,
      [
        'penetrationTestsExecuted',
        'walletsConnected',
        'externalRequestsSent',
        'transactionsSubmitted',
        'providerAccountsCreated',
        'credentialsUsed',
        'paidToolsActivated',
        'costIncurredUsd',
      ],
      'zeroCostEvidence',
      errors,
    ) ||
    !isDeepStrictEqual(record.zeroCostEvidence, {
      penetrationTestsExecuted: 0,
      walletsConnected: 0,
      externalRequestsSent: 0,
      transactionsSubmitted: 0,
      providerAccountsCreated: 0,
      credentialsUsed: 0,
      paidToolsActivated: 0,
      costIncurredUsd: '0.00',
    })
  ) {
    errors.push(
      'zeroCostEvidence must prove that preparation performed no external or paid action.',
    );
  }
  return [...new Set(errors)];
}

export function validatePreparationRecord(record) {
  try {
    return validatePreparationRecordInternal(record);
  } catch {
    return ['KAN-235 preparation record is malformed and failed closed.'];
  }
}

export function parsePreparationBytes(bytes) {
  try {
    return parseStrictJsonBytes(bytes);
  } catch {
    throw new Error(PREPARATION_JSON_ERROR);
  }
}

export function validatePreparationSidecar(bytes, sidecar) {
  try {
    if (
      !Buffer.isBuffer(bytes) ||
      typeof sidecar !== 'string' ||
      !/^[0-9a-f]{64}\n$/u.test(sidecar)
    ) {
      return [PREPARATION_SIDECAR_ERROR];
    }
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    return sidecar === `${fingerprint}\n`
      ? []
      : ['KAN-235 sidecar does not match the preparation record bytes.'];
  } catch {
    return [PREPARATION_SIDECAR_ERROR];
  }
}

function validatePreparationFiles(root) {
  let bytes;
  let sidecarBytes;
  let threatModelBytes;
  try {
    bytes = readSecureLocalFile(resolve(root, PREPARATION_PATH), MAX_PREPARATION_BYTES);
    sidecarBytes = readSecureLocalFile(resolve(root, SIDECAR_PATH), MAX_SIDECAR_BYTES);
    threatModelBytes = readSecureLocalFile(
      resolve(root, THREAT_MODEL_PATH),
      MAX_THREAT_MODEL_BYTES,
    );
  } catch {
    return { errors: [PREPARATION_FILE_ERROR], fingerprint: null, ready: false };
  }
  let record;
  try {
    record = parsePreparationBytes(bytes);
  } catch {
    return { errors: [PREPARATION_JSON_ERROR], fingerprint: null, ready: false };
  }
  let sidecar;
  try {
    sidecar = new TextDecoder('utf-8', { fatal: true }).decode(sidecarBytes);
  } catch {
    return { errors: [PREPARATION_SIDECAR_ERROR], fingerprint: null, ready: false };
  }
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  const errors = [
    ...validatePreparationRecord(record),
    ...validatePreparationSidecar(bytes, sidecar),
  ];
  if (fingerprint !== EXPECTED_PREPARATION_SHA256) {
    errors.push('KAN-235 preparation bytes do not match the compiled reviewed fingerprint.');
  }
  const threatModelFingerprint = createHash('sha256').update(threatModelBytes).digest('hex');
  if (threatModelFingerprint !== EXPECTED_THREAT_MODEL_SHA256) {
    errors.push('KAN-235 reviewed KAN-49 threat-model binding is stale.');
  }
  return { errors: [...new Set(errors)], fingerprint, ready: false };
}

export function validateCanonicalPreparation() {
  return validatePreparationFiles(REPOSITORY_ROOT);
}

/** Test-only fixture boundary; production validation always uses REPOSITORY_ROOT. */
export function validatePreparationFilesForTest(root) {
  return validatePreparationFiles(root);
}

function main() {
  const result = validateCanonicalPreparation();
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`KAN-235 validation: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `KAN-235 wallet penetration-test preparation is valid and remains PENDING_EXTERNAL_REVIEW with PENDING evidence (sha256 ${result.fingerprint}).`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
