#!/usr/bin/env node

/**
 * Offline validation for fixed-slot credential state transitions.
 *
 * This module intentionally has no subprocess, AWS, database, Redis, socket,
 * DNS, HTTP, or filesystem-write capability. It validates only a controlled
 * local JSON record and emits a non-executable plan.
 */

import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..', '..');
export const LOCAL_TRANSITION_ROOT = join(REPOSITORY_ROOT, '.local-validation');
export const DEFAULT_FIXED_SLOT_TRANSITION_RECORD = join(
  scriptDirectory,
  'fixed-slot-credential-transition.example.json',
);

export const MAX_FIXED_SLOT_TRANSITION_RECORD_BYTES = 262_144;
export const MAX_SLOT_GENERATIONS = 64;
export const FIXED_SLOT_TRANSITION_INPUT_ERROR =
  'Fixed-slot credential transition record must be a bounded, canonical, stable, single-link local JSON file in the approved ignored location.';
export const FIXED_SLOT_TRANSITION_ARGUMENT_ERROR =
  'Usage: validate-fixed-slot-credential-transition.mjs [--record <local-file>] [--mode <example|adopt|transition>] [--at <UTC-instant>] [--expected-account <id>] [--expected-region <region>] [--expected-stack <name>] [--expected-stack-id <arn>] [--expected-environment <name>] [--expected-parent-template-sha256 <sha256>] [--expected-workload-template-sha256 <sha256>] [--json].';

const DAY_MS = 86_400_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/u;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u;
const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/u;
const STACK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const PHASES = new Set(['A_ONLY', 'BOTH_USE_A', 'BOTH_USE_B', 'B_ONLY']);
const SCOPE_NAMES = ['apiDatabase', 'workerDatabase', 'redis'];
const EVIDENCE_KEYS = [
  'currentStateCaptureSha256',
  'secretRegenerationSha256',
  'backendInstallationSha256',
  'candidateVerificationSha256',
  'activeContinuitySha256',
  'replacementReadinessSha256',
  'retirementDrainSha256',
  'retirementRevocationSha256',
  'retirementSessionDenialSha256',
  'rollbackPlanSha256',
];
const EXPECTED_DEPLOYMENT_OPTION_KEYS = [
  'expectedAccount',
  'expectedRegion',
  'expectedStack',
  'expectedStackId',
  'expectedEnvironment',
  'expectedParentTemplateSha256',
  'expectedWorkloadTemplateSha256',
];

const EXACT_KEYS = Object.freeze({
  top: [
    'schemaVersion',
    'status',
    'recordId',
    'preparedAt',
    'expiresAt',
    'deployment',
    'predecessor',
    'currentState',
    'targetState',
    'authority',
    'evidence',
  ],
  deployment: [
    'accountId',
    'region',
    'stackName',
    'stackId',
    'environmentName',
    'parentTemplateSha256',
    'workloadTemplateSha256',
  ],
  predecessor: ['stateSha256', 'transitionSha256'],
  state: [
    'operatorMode',
    'redisOperatorSecretVersionId',
    'redisOperatorUsedVersionIds',
    'apiDatabase',
    'workerDatabase',
    'redis',
  ],
  scope: ['phase', 'slots', 'preparation', 'overlap'],
  slots: ['a', 'b'],
  slot: ['generation', 'currentVersionId', 'usedVersionIds'],
  preparation: [
    'slot',
    'preparedAt',
    'expiresAt',
    'secretVersionEvidenceSha256',
    'backendInstallEvidenceSha256',
  ],
  overlap: ['rotationId', 'startedAt', 'expiresAt'],
  authority: [
    'secretRegenerationApprovers',
    'backendInstallApprovers',
    'phaseChangeApprovers',
    'rollbackApprovers',
    'independentVerifier',
    'decision',
    'verifiedAt',
  ],
  evidence: EVIDENCE_KEYS,
});

const SCOPE_PLAN = Object.freeze({
  apiDatabase: Object.freeze({
    phaseParameter: 'ApiDatabaseCredentialPhase',
    backend: 'POSTGRESQL_SCRAM_LOGIN',
    secretPrefix: 'ApiDatabaseCredential',
    principalPrefix: 'crypto_api_login_',
  }),
  workerDatabase: Object.freeze({
    phaseParameter: 'WorkerDatabaseCredentialPhase',
    backend: 'POSTGRESQL_SCRAM_LOGIN',
    secretPrefix: 'WorkerDatabaseCredential',
    principalPrefix: 'crypto_worker_login_',
  }),
  redis: Object.freeze({
    phaseParameter: 'RedisCredentialPhase',
    backend: 'ELASTICACHE_REDIS_USER_PASSWORD',
    secretPrefix: 'RedisApi',
    principalPrefix: 'crypto_api_<environment>_',
  }),
});

const ZERO_CALLS = Object.freeze({
  externalCallsMade: 0,
  awsCallsMade: 0,
  databaseConnectionsMade: 0,
  redisConnectionsMade: 0,
  dnsQueriesMade: 0,
  httpRequestsMade: 0,
  resourcesCreated: 0,
  credentialBytesRead: 0,
  filesWritten: 0,
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => [key, sortedJsonValue(value[key])]),
  );
}

export function canonicalizeFixedSlotValue(value) {
  return JSON.stringify(sortedJsonValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function fixedSlotCredentialStateSha256(state) {
  return sha256(canonicalizeFixedSlotValue(state));
}

function assertExactKeys(value, expectedKeys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object.`);
    return false;
  }
  const actual = Object.keys(value);
  if (
    actual.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    errors.push(`${label} must contain only its exact reviewed keys.`);
    return false;
  }
  return true;
}

function canonicalInstant(value) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return undefined;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  return instant.toISOString().replace('.000Z', 'Z') === value ? instant : undefined;
}

function validateWindow(startValue, endValue, now, label, errors) {
  const start = canonicalInstant(startValue);
  const end = canonicalInstant(endValue);
  if (!start || !end || end <= start || end.getTime() - start.getTime() > DAY_MS) {
    errors.push(`${label} must be one canonical UTC window of at most 24 hours.`);
    return;
  }
  if (start > now || end <= now) {
    errors.push(`${label} must be active at validation time.`);
  }
}

function validateSlot(slot, allowUnpinned, label, errors) {
  if (!assertExactKeys(slot, EXACT_KEYS.slot, label, errors)) return;
  if (
    !Number.isSafeInteger(slot.generation) ||
    slot.generation < 0 ||
    slot.generation > MAX_SLOT_GENERATIONS
  ) {
    errors.push(`${label}.generation must be a bounded non-negative integer.`);
    return;
  }
  if (!Array.isArray(slot.usedVersionIds)) {
    errors.push(`${label}.usedVersionIds must be an append-only array.`);
    return;
  }
  if (slot.generation === 0) {
    if (
      !allowUnpinned ||
      slot.currentVersionId !== 'UNPINNED' ||
      slot.usedVersionIds.length !== 0
    ) {
      errors.push(`${label} may be unpinned only in the reviewed adoption source state.`);
    }
    return;
  }
  if (
    slot.usedVersionIds.length !== slot.generation ||
    slot.usedVersionIds.length > MAX_SLOT_GENERATIONS ||
    slot.usedVersionIds.some(
      (value) => typeof value !== 'string' || !VERSION_ID_PATTERN.test(value),
    ) ||
    new Set(slot.usedVersionIds).size !== slot.usedVersionIds.length ||
    slot.currentVersionId !== slot.usedVersionIds.at(-1)
  ) {
    errors.push(`${label} must bind its current exact version to a unique append-only history.`);
  }
}

function inactiveSlot(phase) {
  if (phase === 'A_ONLY') return 'b';
  if (phase === 'B_ONLY') return 'a';
  return undefined;
}

function validatePreparation(preparation, phase, now, label, errors) {
  if (preparation === null) return;
  if (!assertExactKeys(preparation, EXACT_KEYS.preparation, label, errors)) return;
  if (preparation.slot !== inactiveSlot(phase)) {
    errors.push(`${label} must target only the inactive slot of a single-slot phase.`);
  }
  validateWindow(preparation.preparedAt, preparation.expiresAt, now, label, errors);
  if (
    !SHA256_PATTERN.test(preparation.secretVersionEvidenceSha256 ?? '') ||
    !SHA256_PATTERN.test(preparation.backendInstallEvidenceSha256 ?? '')
  ) {
    errors.push(`${label} must bind separate secret-version and backend-install evidence.`);
  }
}

function validateOverlap(overlap, phase, now, label, errors) {
  if (overlap === null) return;
  if (!assertExactKeys(overlap, EXACT_KEYS.overlap, label, errors)) return;
  if (!['BOTH_USE_A', 'BOTH_USE_B'].includes(phase)) {
    errors.push(`${label} is allowed only while both slots are exposed.`);
  }
  if (typeof overlap.rotationId !== 'string' || !REFERENCE_PATTERN.test(overlap.rotationId)) {
    errors.push(`${label}.rotationId must be a bounded non-secret reference.`);
  }
  validateWindow(overlap.startedAt, overlap.expiresAt, now, label, errors);
}

function validateScope(scope, allowUnpinned, now, label, errors) {
  if (!assertExactKeys(scope, EXACT_KEYS.scope, label, errors)) return;
  if (!PHASES.has(scope.phase)) errors.push(`${label}.phase is not reviewed.`);
  if (!assertExactKeys(scope.slots, EXACT_KEYS.slots, `${label}.slots`, errors)) return;
  validateSlot(scope.slots.a, allowUnpinned, `${label}.slots.a`, errors);
  validateSlot(scope.slots.b, allowUnpinned, `${label}.slots.b`, errors);
  validatePreparation(scope.preparation, scope.phase, now, `${label}.preparation`, errors);
  validateOverlap(scope.overlap, scope.phase, now, `${label}.overlap`, errors);
  if (scope.preparation !== null && scope.overlap !== null) {
    errors.push(`${label} cannot be preparing and overlapping simultaneously.`);
  }
  if (['BOTH_USE_A', 'BOTH_USE_B'].includes(scope.phase) && scope.overlap === null) {
    errors.push(`${label} must bind an unexpired overlap window while both slots are exposed.`);
  }
  if (['A_ONLY', 'B_ONLY'].includes(scope.phase) && scope.overlap !== null) {
    errors.push(`${label} must clear overlap state in a single-slot phase.`);
  }
}

function validateState(state, allowUnpinned, now, label, errors) {
  if (!assertExactKeys(state, EXACT_KEYS.state, label, errors)) return;
  if (state.operatorMode !== 'DISABLED') {
    errors.push(`${label}.operatorMode must remain DISABLED for every credential-state change.`);
  }
  if (
    state.redisOperatorSecretVersionId !== 'UNPINNED' &&
    !VERSION_ID_PATTERN.test(state.redisOperatorSecretVersionId ?? '')
  ) {
    errors.push(
      `${label}.redisOperatorSecretVersionId must be UNPINNED or one exact Secrets Manager VersionId.`,
    );
  } else if (!allowUnpinned && state.redisOperatorSecretVersionId === 'UNPINNED') {
    errors.push(
      `${label}.redisOperatorSecretVersionId may be unpinned only in the reviewed adoption source state.`,
    );
  }
  if (
    !Array.isArray(state.redisOperatorUsedVersionIds) ||
    state.redisOperatorUsedVersionIds.length > MAX_SLOT_GENERATIONS ||
    state.redisOperatorUsedVersionIds.some(
      (value) => typeof value !== 'string' || !VERSION_ID_PATTERN.test(value),
    ) ||
    new Set(state.redisOperatorUsedVersionIds).size !== state.redisOperatorUsedVersionIds.length
  ) {
    errors.push(
      `${label}.redisOperatorUsedVersionIds must be a bounded unique append-only version history.`,
    );
  } else if (state.redisOperatorSecretVersionId === 'UNPINNED') {
    if (!allowUnpinned || state.redisOperatorUsedVersionIds.length !== 0) {
      errors.push(`${label} may use an empty operator history only in the adoption source state.`);
    }
  } else if (
    state.redisOperatorUsedVersionIds.length < 1 ||
    state.redisOperatorSecretVersionId !== state.redisOperatorUsedVersionIds.at(-1)
  ) {
    errors.push(`${label} must bind the current operator version to its append-only history.`);
  }
  for (const scopeName of SCOPE_NAMES) {
    validateScope(state[scopeName], allowUnpinned, now, `${label}.${scopeName}`, errors);
  }
  const versions = Array.isArray(state.redisOperatorUsedVersionIds)
    ? [...state.redisOperatorUsedVersionIds]
    : [];
  for (const scopeName of SCOPE_NAMES) {
    for (const slotName of ['a', 'b']) {
      const history = state?.[scopeName]?.slots?.[slotName]?.usedVersionIds;
      if (Array.isArray(history)) versions.push(...history);
    }
  }
  if (new Set(versions).size !== versions.length) {
    errors.push(`${label} must not reuse a version identity across any slot or workload.`);
  }
}

/**
 * Shared, fail-closed structural check for consumers that must bind the exact
 * pinned fixed-slot state and use this validator's established state hash.
 */
export function validatePinnedFixedSlotCredentialState(state, options = {}) {
  const errors = [];
  let stateSha256;
  try {
    const now = options?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      errors.push('Pinned fixed-slot state validation requires an explicit valid instant.');
    } else {
      validateState(state, false, new Date(now.getTime()), 'state', errors);
    }
    if (errors.length === 0) {
      stateSha256 = fixedSlotCredentialStateSha256(state);
    }
  } catch {
    errors.length = 0;
    errors.push('Pinned fixed-slot state is malformed.');
  }
  return Object.freeze({
    ok: errors.length === 0,
    stateSha256: errors.length === 0 ? stateSha256 : undefined,
    errors: Object.freeze(errors),
  });
}

function validateDeployment(deployment, options, errors) {
  if (!assertExactKeys(deployment, EXACT_KEYS.deployment, 'record.deployment', errors)) return;
  if (typeof deployment.accountId !== 'string' || !/^\d{12}$/u.test(deployment.accountId)) {
    errors.push('record.deployment.accountId must be an exact 12-digit account ID.');
  }
  if (typeof deployment.region !== 'string' || !REGION_PATTERN.test(deployment.region)) {
    errors.push('record.deployment.region must be an exact Region.');
  }
  if (typeof deployment.stackName !== 'string' || !STACK_NAME_PATTERN.test(deployment.stackName)) {
    errors.push('record.deployment.stackName must be an exact stack name.');
  }
  if (
    typeof deployment.environmentName !== 'string' ||
    !ENVIRONMENT_PATTERN.test(deployment.environmentName)
  ) {
    errors.push('record.deployment.environmentName must be an exact non-production environment.');
  }
  const escapedRegion = String(deployment.region).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedAccount = String(deployment.accountId).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedStack = String(deployment.stackName).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const stackIdPattern = new RegExp(
    `^arn:(?:aws|aws-us-gov|aws-cn):cloudformation:${escapedRegion}:${escapedAccount}:stack/${escapedStack}/[A-Za-z0-9-]{8,64}$`,
    'u',
  );
  if (typeof deployment.stackId !== 'string' || !stackIdPattern.test(deployment.stackId)) {
    errors.push('record.deployment.stackId must bind the exact account, Region, and stack name.');
  }
  for (const key of ['parentTemplateSha256', 'workloadTemplateSha256']) {
    if (!SHA256_PATTERN.test(deployment[key] ?? '')) {
      errors.push(`record.deployment.${key} must be a lowercase SHA-256 binding.`);
    }
  }
  for (const [key, expected] of [
    ['accountId', options.expectedAccount],
    ['region', options.expectedRegion],
    ['stackName', options.expectedStack],
    ['stackId', options.expectedStackId],
    ['environmentName', options.expectedEnvironment],
    ['parentTemplateSha256', options.expectedParentTemplateSha256],
    ['workloadTemplateSha256', options.expectedWorkloadTemplateSha256],
  ]) {
    if (expected !== undefined && deployment[key] !== expected) {
      errors.push(`record.deployment.${key} does not match the expected deployment identity.`);
    }
  }
}

function validateAuthority(authority, preparedAt, expiresAt, now, errors) {
  if (!assertExactKeys(authority, EXACT_KEYS.authority, 'record.authority', errors)) return;
  const approvers = [];
  for (const key of [
    'secretRegenerationApprovers',
    'backendInstallApprovers',
    'phaseChangeApprovers',
    'rollbackApprovers',
  ]) {
    const values = authority[key];
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 8 ||
      values.some((value) => typeof value !== 'string' || !REFERENCE_PATTERN.test(value)) ||
      new Set(values).size !== values.length
    ) {
      errors.push(`record.authority.${key} must contain unique bounded non-secret references.`);
    } else {
      approvers.push(...values);
    }
  }
  if (new Set(approvers).size !== approvers.length) {
    errors.push('Operational approval groups must use mutually independent references.');
  }
  if (
    typeof authority.independentVerifier !== 'string' ||
    !REFERENCE_PATTERN.test(authority.independentVerifier) ||
    approvers.includes(authority.independentVerifier)
  ) {
    errors.push('record.authority.independentVerifier must be valid and independent.');
  }
  if (authority.decision !== 'APPROVED') {
    errors.push('record.authority.decision must be APPROVED for an operational record.');
  }
  const verifiedAt = canonicalInstant(authority.verifiedAt);
  if (
    !verifiedAt ||
    !preparedAt ||
    !expiresAt ||
    verifiedAt < preparedAt ||
    verifiedAt > expiresAt ||
    verifiedAt > now
  ) {
    errors.push('record.authority.verifiedAt must fall within the record window.');
  }
}

function validateEvidence(evidence, operation, errors) {
  if (!assertExactKeys(evidence, EXACT_KEYS.evidence, 'record.evidence', errors)) return;
  const requiredByOperation = {
    ADOPT_AND_PIN: [
      'currentStateCaptureSha256',
      'backendInstallationSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'rollbackPlanSha256',
    ],
    PREPARE_INACTIVE: [
      'currentStateCaptureSha256',
      'secretRegenerationSha256',
      'backendInstallationSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'rollbackPlanSha256',
    ],
    ABORT_PREPARATION: ['currentStateCaptureSha256', 'rollbackPlanSha256'],
    ENTER_OVERLAP: [
      'currentStateCaptureSha256',
      'secretRegenerationSha256',
      'backendInstallationSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'rollbackPlanSha256',
    ],
    MOVE_ACTIVE_SLOT: [
      'currentStateCaptureSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'replacementReadinessSha256',
      'rollbackPlanSha256',
    ],
    EXIT_OVERLAP: [
      'currentStateCaptureSha256',
      'replacementReadinessSha256',
      'retirementDrainSha256',
      'retirementRevocationSha256',
      'retirementSessionDenialSha256',
      'rollbackPlanSha256',
    ],
  };
  const required = new Set(requiredByOperation[operation] ?? []);
  const boundEvidence = [];
  for (const key of EVIDENCE_KEYS) {
    const value = evidence[key];
    if (required.has(key)) {
      if (!SHA256_PATTERN.test(value ?? '')) {
        errors.push(`record.evidence.${key} must bind reviewed evidence.`);
      } else {
        boundEvidence.push(value);
      }
    } else if (value !== 'NOT_APPLICABLE') {
      errors.push(`record.evidence.${key} must be NOT_APPLICABLE for this operation.`);
    }
  }
  if (new Set(boundEvidence).size !== boundEvidence.length) {
    errors.push('Required evidence fields must use distinct SHA-256 bindings.');
  }
}

function slotAdvancedOnly(currentScope, targetScope, slotName) {
  const otherSlot = slotName === 'a' ? 'b' : 'a';
  const current = currentScope?.slots?.[slotName];
  const target = targetScope?.slots?.[slotName];
  return (
    isPlainObject(current) &&
    isPlainObject(target) &&
    Array.isArray(current.usedVersionIds) &&
    Array.isArray(target.usedVersionIds) &&
    isDeepStrictEqual(currentScope?.slots?.[otherSlot], targetScope?.slots?.[otherSlot]) &&
    target.generation === current.generation + 1 &&
    target.currentVersionId !== current.currentVersionId &&
    target.usedVersionIds.length === current.usedVersionIds.length + 1 &&
    current.usedVersionIds.every((version, index) => target.usedVersionIds[index] === version) &&
    target.usedVersionIds.at(-1) === target.currentVersionId
  );
}

function classifyTransition(currentScope, targetScope, evidence, errors) {
  const hasReviewedContainerShape = (scope) =>
    isPlainObject(scope) &&
    isPlainObject(scope.slots) &&
    isPlainObject(scope.slots.a) &&
    isPlainObject(scope.slots.b) &&
    (scope.preparation === null || isPlainObject(scope.preparation)) &&
    (scope.overlap === null || isPlainObject(scope.overlap));
  if (!hasReviewedContainerShape(currentScope) || !hasReviewedContainerShape(targetScope)) {
    errors.push('Transition scopes must use the exact reviewed state structure.');
    return undefined;
  }
  const samePhase = currentScope.phase === targetScope.phase;
  const sameSlots = isDeepStrictEqual(currentScope.slots, targetScope.slots);
  const currentInactive = inactiveSlot(currentScope.phase);

  if (
    samePhase &&
    currentInactive &&
    currentScope.preparation === null &&
    targetScope.preparation !== null &&
    currentScope.overlap === null &&
    targetScope.overlap === null &&
    targetScope.preparation.slot === currentInactive &&
    slotAdvancedOnly(currentScope, targetScope, currentInactive)
  ) {
    if (
      targetScope.preparation.secretVersionEvidenceSha256 !== evidence?.secretRegenerationSha256 ||
      targetScope.preparation.backendInstallEvidenceSha256 !== evidence?.backendInstallationSha256
    ) {
      errors.push('Prepared inactive-slot state must bind the record evidence exactly.');
    }
    return { operation: 'PREPARE_INACTIVE', slot: currentInactive };
  }

  if (
    samePhase &&
    currentInactive &&
    sameSlots &&
    currentScope.preparation !== null &&
    targetScope.preparation === null &&
    currentScope.overlap === null &&
    targetScope.overlap === null
  ) {
    return { operation: 'ABORT_PREPARATION', slot: currentScope.preparation.slot };
  }

  const entering =
    (currentScope.phase === 'A_ONLY' && targetScope.phase === 'BOTH_USE_A') ||
    (currentScope.phase === 'B_ONLY' && targetScope.phase === 'BOTH_USE_B');
  if (
    entering &&
    sameSlots &&
    currentScope.preparation !== null &&
    targetScope.preparation === null &&
    currentScope.overlap === null &&
    targetScope.overlap !== null &&
    currentScope.preparation.slot === inactiveSlot(currentScope.phase) &&
    targetScope.overlap.startedAt === currentScope.preparation.preparedAt &&
    targetScope.overlap.expiresAt === currentScope.preparation.expiresAt
  ) {
    if (
      currentScope.preparation.secretVersionEvidenceSha256 !== evidence?.secretRegenerationSha256 ||
      currentScope.preparation.backendInstallEvidenceSha256 !== evidence?.backendInstallationSha256
    ) {
      errors.push('Overlap entry must reuse the exact prepared-slot evidence bindings.');
    }
    return { operation: 'ENTER_OVERLAP', slot: currentScope.preparation.slot };
  }

  const moving =
    (currentScope.phase === 'BOTH_USE_A' && targetScope.phase === 'BOTH_USE_B') ||
    (currentScope.phase === 'BOTH_USE_B' && targetScope.phase === 'BOTH_USE_A');
  if (
    moving &&
    sameSlots &&
    currentScope.preparation === null &&
    targetScope.preparation === null &&
    currentScope.overlap !== null &&
    isDeepStrictEqual(currentScope.overlap, targetScope.overlap)
  ) {
    return {
      operation: 'MOVE_ACTIVE_SLOT',
      slot: targetScope.phase === 'BOTH_USE_A' ? 'a' : 'b',
    };
  }

  const exiting =
    (currentScope.phase === 'BOTH_USE_A' && targetScope.phase === 'A_ONLY') ||
    (currentScope.phase === 'BOTH_USE_B' && targetScope.phase === 'B_ONLY');
  if (
    exiting &&
    sameSlots &&
    currentScope.preparation === null &&
    targetScope.preparation === null &&
    currentScope.overlap !== null &&
    targetScope.overlap === null
  ) {
    return {
      operation: 'EXIT_OVERLAP',
      slot: targetScope.phase === 'A_ONLY' ? 'b' : 'a',
    };
  }

  errors.push('Transition must perform exactly one reviewed fixed-slot state-machine step.');
  return undefined;
}

function isUntrackedInitialState(state) {
  return (
    state?.operatorMode === 'DISABLED' &&
    state?.redisOperatorSecretVersionId === 'UNPINNED' &&
    Array.isArray(state?.redisOperatorUsedVersionIds) &&
    state.redisOperatorUsedVersionIds.length === 0 &&
    SCOPE_NAMES.every((scopeName) => {
      const scope = state?.[scopeName];
      return (
        scope?.phase === 'A_ONLY' &&
        scope.preparation === null &&
        scope.overlap === null &&
        ['a', 'b'].every((slotName) => {
          const slot = scope?.slots?.[slotName];
          return (
            slot?.generation === 0 &&
            slot.currentVersionId === 'UNPINNED' &&
            Array.isArray(slot.usedVersionIds) &&
            slot.usedVersionIds.length === 0
          );
        })
      );
    })
  );
}

function isCanonicalAdoptionTarget(state) {
  return (
    state?.operatorMode === 'DISABLED' &&
    VERSION_ID_PATTERN.test(state?.redisOperatorSecretVersionId ?? '') &&
    Array.isArray(state?.redisOperatorUsedVersionIds) &&
    state.redisOperatorUsedVersionIds.length === 1 &&
    state.redisOperatorUsedVersionIds[0] === state.redisOperatorSecretVersionId &&
    SCOPE_NAMES.every((scopeName) => {
      const scope = state?.[scopeName];
      return (
        scope?.phase === 'A_ONLY' &&
        scope.preparation === null &&
        scope.overlap === null &&
        ['a', 'b'].every((slotName) => {
          const slot = scope?.slots?.[slotName];
          return (
            slot?.generation === 1 &&
            Array.isArray(slot.usedVersionIds) &&
            slot.usedVersionIds.length === 1 &&
            slot.currentVersionId === slot.usedVersionIds[0] &&
            VERSION_ID_PATTERN.test(slot.currentVersionId)
          );
        })
      );
    })
  );
}

function exampleStateValid(state) {
  return isUntrackedInitialState(state);
}

function validateExampleRecord(record, now, errors) {
  if (
    record.status !== 'NOT_AUTHORIZED' ||
    record.recordId !== 'NOT_AUTHORIZED' ||
    record.preparedAt !== 'NOT_RUN' ||
    record.expiresAt !== 'NOT_RUN'
  ) {
    errors.push('Example record must remain inert and NOT_AUTHORIZED.');
  }
  if (
    !assertExactKeys(record.deployment, EXACT_KEYS.deployment, 'record.deployment', errors) ||
    Object.entries(record.deployment).some(([key, value]) =>
      ['parentTemplateSha256', 'workloadTemplateSha256'].includes(key)
        ? value !== 'NOT_CAPTURED'
        : value !== 'NOT_AUTHORIZED',
    )
  ) {
    errors.push('Example deployment identity must remain uncaptured.');
  }
  if (
    !assertExactKeys(record.predecessor, EXACT_KEYS.predecessor, 'record.predecessor', errors) ||
    record.predecessor?.stateSha256 !== 'UNTRACKED' ||
    record.predecessor?.transitionSha256 !== 'NONE'
  ) {
    errors.push('Example predecessor must remain untracked.');
  }
  validateState(record.currentState, true, now, 'record.currentState', errors);
  validateState(record.targetState, true, now, 'record.targetState', errors);
  if (!exampleStateValid(record.currentState) || !exampleStateValid(record.targetState)) {
    errors.push('Example states must remain unpinned A_ONLY placeholders.');
  }
  if (
    !assertExactKeys(record.authority, EXACT_KEYS.authority, 'record.authority', errors) ||
    record.authority?.decision !== 'NOT_APPROVED' ||
    record.authority?.independentVerifier !== 'NOT_APPROVED' ||
    record.authority?.verifiedAt !== 'NOT_RUN' ||
    [
      'secretRegenerationApprovers',
      'backendInstallApprovers',
      'phaseChangeApprovers',
      'rollbackApprovers',
    ].some(
      (key) =>
        !Array.isArray(record.authority?.[key]) ||
        record.authority[key].length !== 1 ||
        record.authority[key][0] !== 'NOT_APPROVED',
    )
  ) {
    errors.push('Example authority must remain NOT_APPROVED and NOT_RUN.');
  }
  if (
    !assertExactKeys(record.evidence, EXACT_KEYS.evidence, 'record.evidence', errors) ||
    EVIDENCE_KEYS.some((key) => record.evidence?.[key] !== 'NOT_RUN')
  ) {
    errors.push('Example evidence must remain NOT_RUN.');
  }
}

function validateOperationalEnvelope(record, options, errors) {
  if (record.status !== 'APPROVED') {
    errors.push('Operational record status must be APPROVED.');
  }
  if (typeof record.recordId !== 'string' || !REFERENCE_PATTERN.test(record.recordId)) {
    errors.push('Operational recordId must be a bounded non-secret reference.');
  }
  const preparedAt = canonicalInstant(record.preparedAt);
  const expiresAt = canonicalInstant(record.expiresAt);
  validateWindow(record.preparedAt, record.expiresAt, options.now, 'record approval', errors);
  validateDeployment(record.deployment, options, errors);
  validateAuthority(record.authority, preparedAt, expiresAt, options.now, errors);
  return { preparedAt, expiresAt };
}

function planFor(operation, scope, slot) {
  const planScope = scope ? SCOPE_PLAN[scope] : undefined;
  const slotUpper = slot?.toUpperCase();
  const stepsByOperation = {
    ADOPT_AND_PIN: [
      'CAPTURE_ALL_SEVEN_EXACT_SECRET_VERSION_IDENTITIES_UNDER_SEPARATE_AUTHORITY',
      'VERIFY_ALL_DATABASE_VERIFIERS_AND_REDIS_PASSWORD_BINDINGS_WITHOUT_RECORDING_CREDENTIALS',
      'PIN_ALL_SEVEN_VERSION_SELECTORS_WHILE_ALL_WORKLOAD_DESIRED_COUNTS_REMAIN_ZERO',
      'VERIFY_THE_PERSISTED_CREDENTIAL_STATE_HASH_BEFORE_ANY_WORKLOAD_ACTIVATION',
    ],
    PREPARE_INACTIVE: [
      'REGENERATE_ONE_EXACT_INACTIVE_SECRET_VERSION_UNDER_SEPARATE_AUTHORITY',
      'INSTALL_ONLY_THAT_VERSION_IN_THE_EXACT_INACTIVE_BACKEND_IDENTITY',
      'VERIFY_CANDIDATE_SCOPE_AND_ACTIVE_SLOT_CONTINUITY_WITHOUT_LOGGING_CREDENTIALS',
      'PIN_THE_NEW_INACTIVE_VERSION_WHILE_THE_SLOT_REMAINS_INACTIVE',
    ],
    ABORT_PREPARATION: [
      'KEEP_THE_PREPARED_VERSION_BURNED_IN_APPEND_ONLY_HISTORY',
      'CLEAR_ONLY_THE_EXPIRED_OR_ABORTED_PREPARATION_STATE',
      'REQUIRE_ANOTHER_FRESH_VERSION_BEFORE_REENTERING_OVERLAP',
    ],
    ENTER_OVERLAP: [
      'VERIFY_THE_PREPARED_INACTIVE_VERSION_AND_INSTALLATION_EVIDENCE',
      'ENABLE_ONLY_THE_ADJACENT_BOUNDED_OVERLAP_STATE',
      'PRESERVE_THE_EXISTING_ACTIVE_SLOT_FOR_ROLLBACK',
    ],
    MOVE_ACTIVE_SLOT: [
      'VERIFY_CANDIDATE_READINESS_AND_THE_UNEXPIRED_ROLLBACK_WINDOW',
      'MOVE_ONLY_THE_ACTIVE_SELECTOR_WITH_BOTH_VERSION_BINDINGS_IMMUTABLE',
      'VERIFY_REPLACEMENT_WORKLOAD_READINESS_BEFORE_RETIREMENT',
    ],
    EXIT_OVERLAP: [
      'DRAIN_THE_RETIRING_SLOT_UNDER_SEPARATE_AUTHORITY',
      'REVOKE_THE_EXACT_RETIRING_BACKEND_IDENTITY_AND_TERMINATE_ITS_SESSIONS',
      'VERIFY_RECONNECT_DENIAL_AND_REPLACEMENT_CONTINUITY',
      'CLEAR_OVERLAP_ONLY_AFTER_THE_REVIEWED_EVIDENCE_IS_BOUND',
    ],
  };
  return {
    kind: 'LOCAL_ONLY_NON_EXECUTABLE_CREDENTIAL_PLAN',
    operation,
    scope: scope ?? 'ALL_CREDENTIAL_VERSION_BINDINGS',
    slot: slotUpper ?? 'ALL_CREDENTIAL_VERSION_BINDINGS',
    phaseParameter: planScope?.phaseParameter ?? 'ALL_SEVEN_VERSION_SELECTORS',
    backend: planScope?.backend ?? 'POSTGRESQL_AND_ELASTICACHE',
    secretLogicalId:
      planScope && slotUpper ? `${planScope.secretPrefix}${slotUpper}Secret` : 'DERIVED_BY_SCOPE',
    principal: planScope && slot ? `${planScope.principalPrefix}${slot}` : 'DERIVED_BY_SCOPE',
    executionAllowed: false,
    separateAuthorizationRequired: true,
    steps: stepsByOperation[operation] ?? [],
    prohibitions: [
      'NO_CREDENTIAL_VALUES_OR_CREDENTIAL_HASHES',
      'NO_AWS_CALLS',
      'NO_DATABASE_CONNECTIONS',
      'NO_REDIS_CONNECTIONS',
      'NO_NETWORK_OR_DNS',
      'NO_RESOURCE_MUTATION',
      'NO_FILE_WRITES',
    ],
  };
}

export function validateFixedSlotCredentialTransition(record, options = {}) {
  const mode = options.mode ?? 'example';
  const operationalMode = ['adopt', 'transition'].includes(mode);
  const hasExplicitInstant = options.now instanceof Date && Number.isFinite(options.now.getTime());
  const now = hasExplicitInstant ? new Date(options.now.getTime()) : new Date();
  const validationOptions = { ...options, now };
  const errors = [];
  let derived;

  if (!['example', 'adopt', 'transition'].includes(mode)) {
    errors.push('Validation mode must be example, adopt, or transition.');
  }
  if (operationalMode && !hasExplicitInstant) {
    errors.push('Operational validation requires an explicit valid validation instant.');
  }
  if (
    operationalMode &&
    EXPECTED_DEPLOYMENT_OPTION_KEYS.some(
      (key) => typeof options[key] !== 'string' || options[key].length === 0,
    )
  ) {
    errors.push('Operational validation requires every expected deployment identity binding.');
  }
  if (!assertExactKeys(record, EXACT_KEYS.top, 'record', errors)) {
    return {
      ok: false,
      readyForAuthorizedPlan: false,
      mode,
      errors,
      ...ZERO_CALLS,
    };
  }
  if (record.schemaVersion !== 3) errors.push('record.schemaVersion must be 3.');

  if (mode === 'example') {
    validateExampleRecord(record, now, errors);
    derived = { operation: 'EXAMPLE_ONLY' };
  } else {
    validateOperationalEnvelope(record, validationOptions, errors);
    if (
      !assertExactKeys(record.predecessor, EXACT_KEYS.predecessor, 'record.predecessor', errors)
    ) {
      // The exact-key error is sufficient.
    }

    if (mode === 'adopt') {
      validateState(record.currentState, true, now, 'record.currentState', errors);
      validateState(record.targetState, false, now, 'record.targetState', errors);
      if (
        record.predecessor?.stateSha256 !== 'UNTRACKED' ||
        record.predecessor?.transitionSha256 !== 'NONE'
      ) {
        errors.push('Adoption must start from the explicit untracked predecessor markers.');
      }
      if (
        !isUntrackedInitialState(record.currentState) ||
        !isCanonicalAdoptionTarget(record.targetState)
      ) {
        errors.push('Adoption must pin seven exact versions from the zero-count A_ONLY state.');
      }
      derived = { operation: 'ADOPT_AND_PIN' };
    } else {
      validateState(record.currentState, false, now, 'record.currentState', errors);
      validateState(record.targetState, false, now, 'record.targetState', errors);
      const currentHash = fixedSlotCredentialStateSha256(record.currentState);
      if (
        record.predecessor?.stateSha256 !== currentHash ||
        !SHA256_PATTERN.test(record.predecessor?.transitionSha256 ?? '')
      ) {
        errors.push(
          'Transition predecessor must bind the exact current state and prior transition.',
        );
      }
      if (record.currentState?.operatorMode !== record.targetState?.operatorMode) {
        errors.push('Credential transitions cannot change Redis operator mode.');
      }
      if (
        record.currentState?.redisOperatorSecretVersionId !==
        record.targetState?.redisOperatorSecretVersionId
      ) {
        errors.push(
          'Fixed-slot credential transitions cannot change the Redis operator secret version after adoption.',
        );
      }
      if (
        !isDeepStrictEqual(
          record.currentState?.redisOperatorUsedVersionIds,
          record.targetState?.redisOperatorUsedVersionIds,
        )
      ) {
        errors.push(
          'Fixed-slot credential transitions cannot change the Redis operator version history.',
        );
      }
      const changedScopes = SCOPE_NAMES.filter(
        (scopeName) =>
          !isDeepStrictEqual(record.currentState?.[scopeName], record.targetState?.[scopeName]),
      );
      if (changedScopes.length !== 1) {
        errors.push('Transition must change exactly one credential scope.');
      } else {
        const scope = changedScopes[0];
        const classified = classifyTransition(
          record.currentState[scope],
          record.targetState[scope],
          record.evidence,
          errors,
        );
        if (classified) derived = { ...classified, scope };
      }
    }
    validateEvidence(record.evidence, derived?.operation, errors);
  }

  const canonicalSha256 = sha256(canonicalizeFixedSlotValue(record));
  const currentStateSha256 = record.currentState
    ? fixedSlotCredentialStateSha256(record.currentState)
    : undefined;
  const targetStateSha256 = record.targetState
    ? fixedSlotCredentialStateSha256(record.targetState)
    : undefined;
  const ok = errors.length === 0;
  return {
    ok,
    readyForAuthorizedPlan: ok && mode !== 'example',
    mode,
    operation: ok ? derived?.operation : undefined,
    scope: ok ? derived?.scope : undefined,
    slot: ok ? derived?.slot : undefined,
    canonicalSha256,
    currentStateSha256,
    targetStateSha256,
    plan:
      ok && mode !== 'example'
        ? planFor(derived.operation, derived.scope, derived.slot)
        : undefined,
    errors,
    ...ZERO_CALLS,
  };
}

function comparablePath(path) {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathWithin(parent, child) {
  const fragment = relative(parent, child);
  return (
    fragment !== '' &&
    !isAbsolute(fragment) &&
    fragment !== '..' &&
    !fragment.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  );
}

function assertRecordLocation(recordPath, mode) {
  const resolvedPath = resolve(recordPath);
  if (mode === 'example') {
    if (comparablePath(resolvedPath) !== comparablePath(DEFAULT_FIXED_SLOT_TRANSITION_RECORD)) {
      throw new Error(FIXED_SLOT_TRANSITION_INPUT_ERROR);
    }
    return resolvedPath;
  }
  if (
    !pathWithin(LOCAL_TRANSITION_ROOT, resolvedPath) ||
    !resolvedPath.toLowerCase().endsWith('.credential-transition.local.json')
  ) {
    throw new Error(FIXED_SLOT_TRANSITION_INPUT_ERROR);
  }
  return resolvedPath;
}

function loadRecordInternal(recordPath, mode, afterFirstReadForTest) {
  try {
    const resolvedPath = assertRecordLocation(recordPath, mode);
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(resolvedPath, MAX_FIXED_SLOT_TRANSITION_RECORD_BYTES)
        : readSecureLocalFileForTest(
            resolvedPath,
            MAX_FIXED_SLOT_TRANSITION_RECORD_BYTES,
            afterFirstReadForTest,
          );
    return parseStrictJsonBytes(bytes);
  } catch {
    throw new Error(FIXED_SLOT_TRANSITION_INPUT_ERROR);
  }
}

export function loadFixedSlotCredentialTransitionRecord(recordPath, mode) {
  return loadRecordInternal(recordPath, mode, undefined);
}

/** Test-only fault seam; production callers use loadFixedSlotCredentialTransitionRecord. */
export function loadFixedSlotCredentialTransitionRecordForTest(
  recordPath,
  mode,
  afterFirstReadForTest,
) {
  return loadRecordInternal(recordPath, mode, afterFirstReadForTest);
}

function parseArguments(argv) {
  const options = {
    record: DEFAULT_FIXED_SLOT_TRANSITION_RECORD,
    mode: 'example',
    json: false,
  };
  const valueArguments = new Map([
    ['--record', 'record'],
    ['--mode', 'mode'],
    ['--at', 'at'],
    ['--expected-account', 'expectedAccount'],
    ['--expected-region', 'expectedRegion'],
    ['--expected-stack', 'expectedStack'],
    ['--expected-stack-id', 'expectedStackId'],
    ['--expected-environment', 'expectedEnvironment'],
    ['--expected-parent-template-sha256', 'expectedParentTemplateSha256'],
    ['--expected-workload-template-sha256', 'expectedWorkloadTemplateSha256'],
  ]);
  const operationalArguments = [
    '--at',
    '--expected-account',
    '--expected-region',
    '--expected-stack',
    '--expected-stack-id',
    '--expected-environment',
    '--expected-parent-template-sha256',
    '--expected-workload-template-sha256',
  ];
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (seen.has(argument)) throw new Error(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR);
      seen.add(argument);
      options.json = true;
      continue;
    }
    if (!valueArguments.has(argument) || seen.has(argument)) {
      throw new Error(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR);
    }
    seen.add(argument);
    options[valueArguments.get(argument)] = value;
    index += 1;
  }
  if (!['example', 'adopt', 'transition'].includes(options.mode)) {
    throw new Error(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR);
  }
  if (options.mode === 'example') {
    if (operationalArguments.some((argument) => seen.has(argument))) {
      throw new Error(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR);
    }
  } else {
    if (
      !seen.has('--record') ||
      operationalArguments.some((argument) => !seen.has(argument)) ||
      canonicalInstant(options.at) === undefined
    ) {
      throw new Error(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR);
    }
    options.now = new Date(options.at);
  }
  return options;
}

function fixedFailure(message) {
  process.stderr.write(`${message}\n`);
  for (const [name, value] of Object.entries(ZERO_CALLS)) {
    process.stderr.write(`${name}: ${value}\n`);
  }
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch {
    fixedFailure(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR);
    process.exitCode = 2;
    return;
  }
  let record;
  try {
    record = loadFixedSlotCredentialTransitionRecord(options.record, options.mode);
  } catch {
    fixedFailure(FIXED_SLOT_TRANSITION_INPUT_ERROR);
    process.exitCode = 2;
    return;
  }
  const report = validateFixedSlotCredentialTransition(record, {
    mode: options.mode,
    now: options.now,
    expectedAccount: options.expectedAccount,
    expectedRegion: options.expectedRegion,
    expectedStack: options.expectedStack,
    expectedStackId: options.expectedStackId,
    expectedEnvironment: options.expectedEnvironment,
    expectedParentTemplateSha256: options.expectedParentTemplateSha256,
    expectedWorkloadTemplateSha256: options.expectedWorkloadTemplateSha256,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write(
      `Fixed-slot credential ${options.mode} record validation passed.\nReady for separately authorized plan: ${report.readyForAuthorizedPlan}.\nExternal calls made: 0\nAWS calls made: 0\nDatabase connections made: 0\nRedis connections made: 0\nResources created: 0\nFiles written: 0\n`,
    );
  } else {
    process.stderr.write('Fixed-slot credential transition validation failed:\n');
    for (const error of report.errors) process.stderr.write(`- ${error}\n`);
    fixedFailure('No transition authority was granted.');
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
