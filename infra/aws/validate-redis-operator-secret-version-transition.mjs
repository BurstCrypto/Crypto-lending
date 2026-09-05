#!/usr/bin/env node

/**
 * Local-only signed validation for the disabled Redis operator secret VersionId.
 * This module has no AWS, Redis, network, subprocess, secret-read, or write capability.
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  fixedSlotCredentialStateSha256,
  validatePinnedFixedSlotCredentialState,
} from './validate-fixed-slot-credential-transition.mjs';
import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(scriptDirectory, '..', '..');
export const LOCAL_REDIS_OPERATOR_TRANSITION_ROOT = join(REPOSITORY_ROOT, '.local-validation');
export const DEFAULT_REDIS_OPERATOR_TRANSITION_RECORD = join(
  scriptDirectory,
  'redis-operator-secret-version-transition.example.json',
);
export const MAX_REDIS_OPERATOR_TRANSITION_RECORD_BYTES = 262_144;
export const REDIS_OPERATOR_TRANSITION_INPUT_ERROR =
  'Redis operator secret transition record must be a bounded, canonical, stable, single-link local JSON file in the approved ignored location.';
export const REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR =
  'Usage: validate-redis-operator-secret-version-transition.mjs [--record <local-file>] [--mode <example|adopt|transition>] [--at <UTC-instant>] [--expected-account <id>] [--expected-region <region>] [--expected-stack <name>] [--expected-stack-id <arn>] [--expected-workload-stack-id <arn>] [--expected-environment <name>] [--expected-parent-template-sha256 <sha256>] [--expected-workload-template-sha256 <sha256>] [--expected-observability-template-sha256 <sha256>] [--expected-secret-arn <arn>] [--expected-kms-key-arn <arn>] [--expected-operator-user-id <id>] [--expected-current-version-id <id>] [--expected-target-version-id <id>] [--expected-redis-operator-state-sha256 <UNTRACKED|sha256>] [--expected-redis-operator-transition-sha256 <NONE|sha256>] [--expected-credential-state-sha256 <sha256>] [--expected-credential-transition-sha256 <sha256>] [--expected-auth-wallet-state-sha256 <sha256>] [--expected-auth-wallet-transition-sha256 <sha256>] [--expected-operation <action>] [--expected-field-name <field>] [--json].';

const SIGNING_DOMAIN = 'crypto-lending:redis-operator-secret-version-transition:v1';
const RECORD_HASH_DOMAIN = 'crypto-lending:redis-operator-secret-version-transition-record:v1';
const OPERATOR_STATE_HASH_DOMAIN = 'crypto-lending:redis-operator-secret-version-state:v1';
const AUTHORITY_REGISTRY_HASH_DOMAIN =
  'crypto-lending:redis-operator-secret-version-transition-authority-registry:v1';
const HOUR_MS = 3_600_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const AUTHORITY_KEY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,191}$/u;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u;
const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/u;
const STACK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/u;
const RECORD_ID_PATTERN =
  /^redis-operator\/(?:adopt|transition)\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u;
const FIELD_NAME = 'REDIS_OPERATOR_SECRET_VERSION_ID';
const ACTIONS = Object.freeze({
  adopt: 'ADOPT_EXISTING_BINDING',
  transition: 'ROTATE_DISABLED_OPERATOR_CREDENTIAL',
});
const SIGNER_ROLES = Object.freeze([
  'REDIS_OPERATOR_TRANSITION_ISSUER',
  'INDEPENDENT_REDIS_OPERATOR_TRANSITION_VERIFIER',
]);
const SIGNER_SCOPE = 'REDIS_OPERATOR_SECRET_VERSION_TRANSITION';

const EXACT_KEYS = Object.freeze({
  root: ['schemaVersion', 'artifactType', 'content', 'signatures'],
  unsignedRoot: ['schemaVersion', 'artifactType', 'content'],
  content: [
    'status',
    'recordId',
    'issuedAt',
    'expiresAt',
    'deployment',
    'operation',
    'predecessors',
    'currentState',
    'targetState',
    'evidence',
    'approvals',
  ],
  deployment: [
    'accountId',
    'region',
    'stackName',
    'stackId',
    'workloadStackId',
    'environmentName',
    'parentTemplateSha256',
    'workloadTemplateSha256',
    'observabilityTemplateSha256',
    'secretArn',
    'kmsKeyArn',
    'operatorUserId',
  ],
  operation: ['kind', 'fieldName', 'action'],
  predecessors: [
    'redisOperatorStateSha256',
    'redisOperatorTransitionSha256',
    'credentialStateSha256',
    'credentialTransitionSha256',
    'authWalletStateSha256',
    'authWalletTransitionSha256',
  ],
  signature: ['role', 'scope', 'authorityKeyId', 'algorithm', 'valueBase64'],
  registry: ['schemaVersion', 'artifactType', 'keys'],
  authorityKey: [
    'keyId',
    'algorithm',
    'status',
    'role',
    'scope',
    'publicKeySpkiDerBase64',
    'validFrom',
    'validUntil',
    'approvalReferenceId',
  ],
});

const EVIDENCE_KEYS = Object.freeze([
  'currentDeploymentCaptureSha256',
  'secretKmsAndUserBindingSha256',
  'operatorDisabledAndTaskAbsentSha256',
  'operatorConnectionAbsenceSha256',
  'targetVersionInventorySha256',
  'targetSecretSchemaSha256',
  'redisUserUpdatePlanSha256',
  'candidateAuthenticationPlanSha256',
  'oldAuthenticationDenialPlanSha256',
  'runtimeContinuityPlanSha256',
  'forwardRecoveryPlanSha256',
  'unrelatedStatePreservationPlanSha256',
]);
const APPROVAL_KEYS = Object.freeze([
  'secretCustodyApprovalRef',
  'redisSecurityApprovalRef',
  'deploymentApprovalRef',
  'rollbackApprovalRef',
]);
const APPROVAL_PATTERNS = Object.freeze({
  secretCustodyApprovalRef:
    /^approval\/secret-custody\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  redisSecurityApprovalRef:
    /^approval\/redis-security\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  deploymentApprovalRef: /^approval\/deployment\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
  rollbackApprovalRef: /^approval\/rollback\/\d{4}-\d{2}-\d{2}\/[a-z0-9][a-z0-9-]{2,63}$/u,
});
const EXPECTED_OPTION_KEYS = Object.freeze([
  'expectedAccount',
  'expectedRegion',
  'expectedStack',
  'expectedStackId',
  'expectedWorkloadStackId',
  'expectedEnvironment',
  'expectedParentTemplateSha256',
  'expectedWorkloadTemplateSha256',
  'expectedObservabilityTemplateSha256',
  'expectedSecretArn',
  'expectedKmsKeyArn',
  'expectedOperatorUserId',
  'expectedCurrentVersionId',
  'expectedTargetVersionId',
  'expectedRedisOperatorStateSha256',
  'expectedRedisOperatorTransitionSha256',
  'expectedCredentialStateSha256',
  'expectedCredentialTransitionSha256',
  'expectedAuthWalletStateSha256',
  'expectedAuthWalletTransitionSha256',
  'expectedOperation',
  'expectedFieldName',
]);

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

export const REDIS_OPERATOR_TRANSITION_AUTHORITY_KEY_REGISTRY = Object.freeze({
  schemaVersion: 1,
  artifactType: 'REDIS_OPERATOR_TRANSITION_AUTHORITY_KEY_REGISTRY',
  keys: Object.freeze([]),
});

const PRODUCTION_AUTHORIZED_REPORTS = new WeakSet();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
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

export function canonicalizeRedisOperatorTransitionValue(value) {
  return JSON.stringify(sortedJsonValue(value));
}

function hashDomain(domain, value) {
  return createHash('sha256').update(`${domain}\n${value}`, 'utf8').digest('hex');
}

function operatorProjection(state) {
  return {
    operatorMode: state?.operatorMode,
    currentVersionId: state?.redisOperatorSecretVersionId,
    usedVersionIds: state?.redisOperatorUsedVersionIds,
  };
}

export function redisOperatorTransitionStateSha256(state) {
  return hashDomain(
    OPERATOR_STATE_HASH_DOMAIN,
    canonicalizeRedisOperatorTransitionValue(operatorProjection(state)),
  );
}

function recordSha256(record) {
  return hashDomain(RECORD_HASH_DOMAIN, canonicalizeRedisOperatorTransitionValue(record));
}

function safeRecordSha256(record) {
  try {
    return recordSha256(record);
  } catch {
    return undefined;
  }
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

function validateWindow(issuedAtValue, expiresAtValue, now, errors) {
  const issuedAt = canonicalInstant(issuedAtValue);
  const expiresAt = canonicalInstant(expiresAtValue);
  if (
    !issuedAt ||
    !expiresAt ||
    expiresAt <= issuedAt ||
    expiresAt.getTime() - issuedAt.getTime() > HOUR_MS
  ) {
    errors.push('Record authority window must be canonical and at most one hour.');
    return { issuedAt, expiresAt };
  }
  if (issuedAt > now || expiresAt <= now) {
    errors.push('Record authority window must be active at the explicit validation instant.');
  }
  return { issuedAt, expiresAt };
}

function parseStackArn(arn, deployment) {
  if (typeof arn !== 'string' || arn.length > 2048) return undefined;
  const match =
    /^arn:([^:]+):cloudformation:([^:]+):(\d{12}):stack\/([^/]+)\/[A-Za-z0-9-]{8,64}$/u.exec(arn);
  if (
    !match ||
    !['aws', 'aws-us-gov', 'aws-cn'].includes(match[1]) ||
    match[2] !== deployment?.region ||
    match[3] !== deployment?.accountId
  ) {
    return undefined;
  }
  return { partition: match[1], stackName: match[4] };
}

function parseResourceArn(arn, service, deployment, partition) {
  if (
    typeof arn !== 'string' ||
    arn.length > 2048 ||
    arn.includes(':AWSCURRENT') ||
    arn.includes(':AWSPREVIOUS')
  ) {
    return undefined;
  }
  const match = /^arn:([^:]+):([^:]+):([^:]*):(\d{12}):(.+)$/u.exec(arn);
  if (
    !match ||
    match[1] !== partition ||
    match[2] !== service ||
    match[3] !== deployment?.region ||
    match[4] !== deployment?.accountId
  ) {
    return undefined;
  }
  return match[5];
}

function validateDeployment(deployment, options, errors) {
  if (!assertExactKeys(deployment, EXACT_KEYS.deployment, 'content.deployment', errors)) return;
  if (typeof deployment.accountId !== 'string' || !/^\d{12}$/u.test(deployment.accountId)) {
    errors.push('content.deployment.accountId must be an exact 12-digit account ID.');
  }
  if (typeof deployment.region !== 'string' || !REGION_PATTERN.test(deployment.region)) {
    errors.push('content.deployment.region must be an exact AWS Region.');
  }
  if (typeof deployment.stackName !== 'string' || !STACK_NAME_PATTERN.test(deployment.stackName)) {
    errors.push('content.deployment.stackName must be an exact stack name.');
  }
  if (
    typeof deployment.environmentName !== 'string' ||
    !ENVIRONMENT_PATTERN.test(deployment.environmentName)
  ) {
    errors.push('content.deployment.environmentName must be an exact reviewed environment.');
  }
  const rootStack = parseStackArn(deployment.stackId, deployment);
  const workloadStack = parseStackArn(deployment.workloadStackId, deployment);
  if (!rootStack || rootStack.stackName !== deployment.stackName) {
    errors.push('content.deployment.stackId must bind the exact root stack identity.');
  }
  if (!workloadStack) {
    errors.push('content.deployment.workloadStackId must bind one exact nested workload stack.');
  }
  if (rootStack && workloadStack && rootStack.partition !== workloadStack.partition) {
    errors.push('Root and workload stack IDs must use the same AWS partition.');
  }
  for (const key of [
    'parentTemplateSha256',
    'workloadTemplateSha256',
    'observabilityTemplateSha256',
  ]) {
    if (!SHA256_PATTERN.test(deployment[key] ?? '')) {
      errors.push(`content.deployment.${key} must be a lowercase SHA-256 binding.`);
    }
  }
  const partition = rootStack?.partition;
  const secretResource = parseResourceArn(
    deployment.secretArn,
    'secretsmanager',
    deployment,
    partition,
  );
  if (!secretResource || !/^secret:[A-Za-z0-9/_+=.@-]{1,512}$/u.test(secretResource)) {
    errors.push('content.deployment.secretArn must be one selector-free secret ARN.');
  }
  const kmsResource = parseResourceArn(deployment.kmsKeyArn, 'kms', deployment, partition);
  if (!kmsResource || !/^key\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(kmsResource)) {
    errors.push('content.deployment.kmsKeyArn must be one customer-managed KMS key ARN.');
  }
  if (deployment.operatorUserId !== `cl-${deployment.environmentName}-ro`) {
    errors.push('content.deployment.operatorUserId must be the exact disabled operator user ID.');
  }
  for (const [key, expected] of [
    ['accountId', options.expectedAccount],
    ['region', options.expectedRegion],
    ['stackName', options.expectedStack],
    ['stackId', options.expectedStackId],
    ['workloadStackId', options.expectedWorkloadStackId],
    ['environmentName', options.expectedEnvironment],
    ['parentTemplateSha256', options.expectedParentTemplateSha256],
    ['workloadTemplateSha256', options.expectedWorkloadTemplateSha256],
    ['observabilityTemplateSha256', options.expectedObservabilityTemplateSha256],
    ['secretArn', options.expectedSecretArn],
    ['kmsKeyArn', options.expectedKmsKeyArn],
    ['operatorUserId', options.expectedOperatorUserId],
  ]) {
    if (deployment[key] !== expected) {
      errors.push(`content.deployment.${key} does not match the expected live binding.`);
    }
  }
}

function appendsExactlyOne(current, target) {
  return (
    Array.isArray(current) &&
    Array.isArray(target) &&
    target.length === current.length + 1 &&
    current.every((value, index) => value === target[index])
  );
}

function validateOperationAndStates(content, mode, options, now, errors) {
  if (!assertExactKeys(content.operation, EXACT_KEYS.operation, 'content.operation', errors))
    return;
  const expectedKind = mode === 'adopt' ? 'ADOPT' : 'TRANSITION';
  if (
    content.operation.kind !== expectedKind ||
    content.operation.fieldName !== FIELD_NAME ||
    content.operation.action !== ACTIONS[mode]
  ) {
    errors.push(`${mode.toUpperCase()} must name the exact reviewed Redis operator operation.`);
  }
  if (
    content.operation.action !== options.expectedOperation ||
    content.operation.fieldName !== options.expectedFieldName
  ) {
    errors.push('Redis operation does not match the explicit invocation binding.');
  }

  const currentValidation = validatePinnedFixedSlotCredentialState(content.currentState, { now });
  const targetValidation = validatePinnedFixedSlotCredentialState(content.targetState, { now });
  if (!currentValidation.ok) {
    errors.push('content.currentState must be an exact valid pinned fixed-slot schema-v3 state.');
  }
  if (!targetValidation.ok) {
    errors.push('content.targetState must be an exact valid pinned fixed-slot schema-v3 state.');
  }
  const current = content.currentState;
  const target = content.targetState;
  if (current?.operatorMode !== 'DISABLED' || target?.operatorMode !== 'DISABLED') {
    errors.push('Redis operator mode must remain DISABLED.');
  }
  if (
    current?.redisOperatorSecretVersionId !== options.expectedCurrentVersionId ||
    target?.redisOperatorSecretVersionId !== options.expectedTargetVersionId
  ) {
    errors.push('Current and target operator VersionIds do not match the explicit invocation.');
  }
  if (mode === 'adopt') {
    if (!isDeepStrictEqual(current, target)) {
      errors.push('ADOPT_EXISTING_BINDING must leave the complete fixed-slot state unchanged.');
    }
    if (
      current?.redisOperatorUsedVersionIds?.length !== 1 ||
      current.redisOperatorUsedVersionIds[0] !== current.redisOperatorSecretVersionId
    ) {
      errors.push('ADOPT_EXISTING_BINDING must begin with exactly one current operator VersionId.');
    }
  } else {
    for (const key of ['operatorMode', 'apiDatabase', 'workerDatabase', 'redis']) {
      if (!isDeepStrictEqual(current?.[key], target?.[key])) {
        errors.push(`Redis operator transition must preserve fixed-slot ${key}.`);
      }
    }
    if (
      current?.redisOperatorSecretVersionId === target?.redisOperatorSecretVersionId ||
      !appendsExactlyOne(
        current?.redisOperatorUsedVersionIds,
        target?.redisOperatorUsedVersionIds,
      ) ||
      target?.redisOperatorSecretVersionId !== target?.redisOperatorUsedVersionIds?.at(-1)
    ) {
      errors.push('Redis operator transition must append and select exactly one fresh VersionId.');
    }
  }
  return { currentValidation, targetValidation };
}

function validatePredecessors(predecessors, content, mode, options, stateReports, errors) {
  if (!assertExactKeys(predecessors, EXACT_KEYS.predecessors, 'content.predecessors', errors)) {
    return;
  }
  const currentCredentialStateSha256 = stateReports?.currentValidation?.stateSha256;
  const currentOperatorStateSha256 =
    stateReports?.currentValidation?.ok === true
      ? redisOperatorTransitionStateSha256(content.currentState)
      : undefined;
  if (mode === 'adopt') {
    if (
      predecessors.redisOperatorStateSha256 !== 'UNTRACKED' ||
      predecessors.redisOperatorTransitionSha256 !== 'NONE'
    ) {
      errors.push('Redis operator adoption must start from UNTRACKED/NONE Redis predecessors.');
    }
  } else if (
    predecessors.redisOperatorStateSha256 !== currentOperatorStateSha256 ||
    !SHA256_PATTERN.test(predecessors.redisOperatorTransitionSha256 ?? '')
  ) {
    errors.push('Redis operator transition must bind the current projection and prior record.');
  }
  if (
    predecessors.credentialStateSha256 !== currentCredentialStateSha256 ||
    !SHA256_PATTERN.test(predecessors.credentialTransitionSha256 ?? '')
  ) {
    errors.push('Credential predecessor must bind the current full state and composite head.');
  }
  if (
    !SHA256_PATTERN.test(predecessors.authWalletStateSha256 ?? '') ||
    !SHA256_PATTERN.test(predecessors.authWalletTransitionSha256 ?? '')
  ) {
    errors.push('Preserved auth-wallet state and transition must be lowercase SHA-256 bindings.');
  }
  for (const [key, expected] of [
    ['redisOperatorStateSha256', options.expectedRedisOperatorStateSha256],
    ['redisOperatorTransitionSha256', options.expectedRedisOperatorTransitionSha256],
    ['credentialStateSha256', options.expectedCredentialStateSha256],
    ['credentialTransitionSha256', options.expectedCredentialTransitionSha256],
    ['authWalletStateSha256', options.expectedAuthWalletStateSha256],
    ['authWalletTransitionSha256', options.expectedAuthWalletTransitionSha256],
  ]) {
    if (predecessors[key] !== expected) {
      errors.push(`content.predecessors.${key} does not match the expected deployed chain.`);
    }
  }
}

function validateEvidence(evidence, mode, errors) {
  if (!assertExactKeys(evidence, EVIDENCE_KEYS, 'content.evidence', errors)) return;
  const adoptionRequired = new Set(EVIDENCE_KEYS.slice(0, 6));
  const observed = [];
  for (const key of EVIDENCE_KEYS) {
    const required = mode === 'transition' || adoptionRequired.has(key);
    if (required) {
      if (!SHA256_PATTERN.test(evidence[key] ?? '')) {
        errors.push(`content.evidence.${key} must be a lowercase SHA-256 binding.`);
      } else {
        observed.push(evidence[key]);
      }
    } else if (evidence[key] !== 'NOT_APPLICABLE') {
      errors.push(`content.evidence.${key} must be NOT_APPLICABLE for adoption.`);
    }
  }
  if (new Set(observed).size !== observed.length) {
    errors.push('Required evidence must use distinct SHA-256 bindings.');
  }
}

function validateApprovals(approvals, errors) {
  if (!assertExactKeys(approvals, APPROVAL_KEYS, 'content.approvals', errors)) return;
  const references = [];
  for (const key of APPROVAL_KEYS) {
    if (typeof approvals[key] !== 'string' || !APPROVAL_PATTERNS[key].test(approvals[key])) {
      errors.push(`content.approvals.${key} must be one purpose-bound approval reference.`);
    } else {
      references.push(approvals[key]);
    }
  }
  if (new Set(references).size !== references.length) {
    errors.push('Redis operator approvals must use mutually independent references.');
  }
}

function validateContent(content, mode, options, errors) {
  if (!assertExactKeys(content, EXACT_KEYS.content, 'content', errors)) return;
  if (content.status !== 'APPROVED') errors.push('content.status must be APPROVED.');
  if (
    !RECORD_ID_PATTERN.test(content.recordId ?? '') ||
    !content.recordId.startsWith(`redis-operator/${mode}/`)
  ) {
    errors.push('content.recordId must be a canonical mode-bound Redis operator record ID.');
  }
  validateWindow(content.issuedAt, content.expiresAt, options.now, errors);
  validateDeployment(content.deployment, options, errors);
  const stateReports = validateOperationAndStates(content, mode, options, options.now, errors);
  validatePredecessors(content.predecessors, content, mode, options, stateReports, errors);
  validateEvidence(content.evidence, mode, errors);
  validateApprovals(content.approvals, errors);
}

function validateExample(record, errors) {
  const content = record.content;
  if (!assertExactKeys(content, EXACT_KEYS.content, 'content', errors)) return;
  if (
    content.status !== 'NOT_AUTHORIZED' ||
    content.recordId !== 'NOT_AUTHORIZED' ||
    content.issuedAt !== 'NOT_RUN' ||
    content.expiresAt !== 'NOT_RUN' ||
    content.currentState !== null ||
    content.targetState !== null ||
    !Array.isArray(record.signatures) ||
    record.signatures.length !== 0
  ) {
    errors.push('Example must remain inert and NOT_AUTHORIZED.');
  }
  if (
    !assertExactKeys(content.deployment, EXACT_KEYS.deployment, 'content.deployment', errors) ||
    Object.values(content.deployment).some((value) => value !== 'NOT_AUTHORIZED')
  ) {
    errors.push('Example deployment identity must remain NOT_AUTHORIZED.');
  }
  if (
    !assertExactKeys(content.operation, EXACT_KEYS.operation, 'content.operation', errors) ||
    Object.values(content.operation).some((value) => value !== 'NOT_AUTHORIZED')
  ) {
    errors.push('Example operation must remain NOT_AUTHORIZED.');
  }
  if (
    !assertExactKeys(
      content.predecessors,
      EXACT_KEYS.predecessors,
      'content.predecessors',
      errors,
    ) ||
    content.predecessors.redisOperatorStateSha256 !== 'UNTRACKED' ||
    content.predecessors.redisOperatorTransitionSha256 !== 'NONE' ||
    [
      'credentialStateSha256',
      'credentialTransitionSha256',
      'authWalletStateSha256',
      'authWalletTransitionSha256',
    ].some((key) => content.predecessors[key] !== 'NOT_CAPTURED')
  ) {
    errors.push('Example predecessor bindings must remain uncaptured.');
  }
  if (
    !assertExactKeys(content.evidence, EVIDENCE_KEYS, 'content.evidence', errors) ||
    EVIDENCE_KEYS.some((key) => content.evidence[key] !== 'NOT_RUN')
  ) {
    errors.push('Example evidence must remain NOT_RUN.');
  }
  if (
    !assertExactKeys(content.approvals, APPROVAL_KEYS, 'content.approvals', errors) ||
    APPROVAL_KEYS.some((key) => content.approvals[key] !== 'NOT_APPROVED')
  ) {
    errors.push('Example approvals must remain NOT_APPROVED.');
  }
}

function canonicalBase64(value, expectedBytes) {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) throw new Error('invalid');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length !== expectedBytes) {
    throw new Error('invalid');
  }
  return bytes;
}

function parseRegistry(registry) {
  if (!assertExactKeys(registry, EXACT_KEYS.registry, 'registry', [])) throw new Error('invalid');
  if (
    registry.schemaVersion !== 1 ||
    registry.artifactType !== 'REDIS_OPERATOR_TRANSITION_AUTHORITY_KEY_REGISTRY' ||
    !Array.isArray(registry.keys) ||
    registry.keys.length > 16
  ) {
    throw new Error('invalid');
  }
  const keyIds = new Set();
  const publicKeyHashes = new Set();
  const keys = registry.keys.map((candidate) => {
    if (!assertExactKeys(candidate, EXACT_KEYS.authorityKey, 'authority key', [])) {
      throw new Error('invalid');
    }
    if (
      typeof candidate.keyId !== 'string' ||
      !AUTHORITY_KEY_ID_PATTERN.test(candidate.keyId) ||
      keyIds.has(candidate.keyId) ||
      candidate.algorithm !== 'Ed25519' ||
      candidate.status !== 'APPROVED' ||
      !SIGNER_ROLES.includes(candidate.role) ||
      candidate.scope !== SIGNER_SCOPE ||
      typeof candidate.approvalReferenceId !== 'string' ||
      !REFERENCE_PATTERN.test(candidate.approvalReferenceId)
    ) {
      throw new Error('invalid');
    }
    const validFrom = canonicalInstant(candidate.validFrom);
    const validUntil = canonicalInstant(candidate.validUntil);
    if (!validFrom || !validUntil || validUntil <= validFrom) throw new Error('invalid');
    const der = canonicalBase64(candidate.publicKeySpkiDerBase64, 44);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('invalid');
    const canonicalDer = key.export({ format: 'der', type: 'spki' });
    if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(der)) throw new Error('invalid');
    const publicKeySha256 = createHash('sha256').update(der).digest('hex');
    if (publicKeyHashes.has(publicKeySha256)) throw new Error('invalid');
    keyIds.add(candidate.keyId);
    publicKeyHashes.add(publicKeySha256);
    return { ...candidate, validFrom, validUntil, key, publicKeySha256 };
  });
  return {
    keys,
    registrySha256: hashDomain(
      AUTHORITY_REGISTRY_HASH_DOMAIN,
      canonicalizeRedisOperatorTransitionValue(registry),
    ),
  };
}

function parseSignatures(signatures) {
  if (!Array.isArray(signatures) || signatures.length !== SIGNER_ROLES.length) {
    throw new Error('invalid');
  }
  const keyIds = new Set();
  return signatures.map((candidate, index) => {
    if (!assertExactKeys(candidate, EXACT_KEYS.signature, 'signature', [])) {
      throw new Error('invalid');
    }
    if (
      candidate.role !== SIGNER_ROLES[index] ||
      candidate.scope !== SIGNER_SCOPE ||
      typeof candidate.authorityKeyId !== 'string' ||
      !AUTHORITY_KEY_ID_PATTERN.test(candidate.authorityKeyId) ||
      keyIds.has(candidate.authorityKeyId) ||
      candidate.algorithm !== 'Ed25519'
    ) {
      throw new Error('invalid');
    }
    canonicalBase64(candidate.valueBase64, 64);
    keyIds.add(candidate.authorityKeyId);
    return candidate;
  });
}

export function redisOperatorSecretVersionTransitionSigningBytes(unsignedRecord) {
  if (!assertExactKeys(unsignedRecord, EXACT_KEYS.unsignedRoot, 'unsigned record', [])) {
    throw new Error('Invalid Redis operator transition signing input.');
  }
  if (
    unsignedRecord.schemaVersion !== 1 ||
    unsignedRecord.artifactType !== 'REDIS_OPERATOR_SECRET_VERSION_TRANSITION'
  ) {
    throw new Error('Invalid Redis operator transition signing input.');
  }
  return Buffer.from(
    `${SIGNING_DOMAIN}\n${canonicalizeRedisOperatorTransitionValue(unsignedRecord)}`,
    'utf8',
  );
}

function parseAndVerifySignatures(record, registry) {
  const parsedRegistry = parseRegistry(registry);
  const signatures = parseSignatures(record.signatures);
  const unsignedRecord = {
    schemaVersion: record.schemaVersion,
    artifactType: record.artifactType,
    content: record.content,
  };
  const signingBytes = redisOperatorSecretVersionTransitionSigningBytes(unsignedRecord);
  const issuedAt = canonicalInstant(record.content.issuedAt);
  const expiresAt = canonicalInstant(record.content.expiresAt);
  const usedPublicKeys = new Set();
  for (const signature of signatures) {
    const authority = parsedRegistry.keys.find(
      (candidate) => candidate.keyId === signature.authorityKeyId,
    );
    if (
      !authority ||
      authority.role !== signature.role ||
      authority.scope !== signature.scope ||
      issuedAt < authority.validFrom ||
      expiresAt > authority.validUntil ||
      usedPublicKeys.has(authority.publicKeySha256) ||
      !verifySignature(
        null,
        signingBytes,
        authority.key,
        canonicalBase64(signature.valueBase64, 64),
      )
    ) {
      throw new Error('invalid');
    }
    usedPublicKeys.add(authority.publicKeySha256);
  }
  return parsedRegistry.registrySha256;
}

function planFor(content, mode) {
  return deepFreeze({
    kind: 'LOCAL_ONLY_NON_EXECUTABLE_REDIS_OPERATOR_VERSION_PLAN',
    operation: content.operation.action,
    fieldName: content.operation.fieldName,
    versionParameter: 'RedisOperatorSecretVersionId',
    currentVersionId: content.currentState.redisOperatorSecretVersionId,
    targetVersionId: content.targetState.redisOperatorSecretVersionId,
    executionAllowed: false,
    separateAuthorizationRequired: true,
    steps:
      mode === 'adopt'
        ? [
            'VERIFY_SIGNED_ALREADY_PINNED_DISABLED_OPERATOR_STATE',
            'VERIFY_COMPOSITE_CREDENTIAL_AND_AUTH_WALLET_HEADS',
            'ADD_ONLY_THE_REDIS_OPERATOR_CHAIN_BINDING',
          ]
        : [
            'VERIFY_SIGNED_CURRENT_TARGET_AND_ALL_THREE_CHAIN_BINDINGS',
            'KEEP_OPERATOR_MODE_DISABLED_AND_OPERATOR_TASK_ABSENT',
            'UPDATE_ONLY_REDIS_OPERATOR_USER_PASSWORDS_TO_THE_EXACT_TARGET_VERSION',
            'VERIFY_CANDIDATE_AUTHENTICATION_AND_OLD_AUTHENTICATION_DENIAL_SEPARATELY',
            'ADVANCE_REDIS_AND_COMPOSITE_CREDENTIAL_CHAINS_ATOMICALLY',
            'FORWARD_RECOVER_WITH_A_FRESH_NEVER_REUSED_VERSION',
          ],
    prohibitions: [
      'NO_SECRET_OR_PASSWORD_MATERIAL',
      'NO_SECRET_VALUE_HASHES',
      'NO_OPERATOR_ENABLEMENT',
      'NO_AWS_CALLS',
      'NO_DATABASE_CONNECTIONS',
      'NO_REDIS_CONNECTIONS',
      'NO_NETWORK_OR_DNS',
      'NO_RESOURCE_MUTATION',
      'NO_FILE_WRITES',
    ],
  });
}

function baseFailureReport(mode, errors) {
  return deepFreeze({
    ok: false,
    readyForAuthorizedPlan: false,
    productionAuthorityValidated: false,
    signatureValidated: false,
    mode,
    errors,
    ...ZERO_CALLS,
  });
}

function validateRecordStructure(record, options) {
  const mode = options.mode ?? 'example';
  const errors = [];
  const operational = ['adopt', 'transition'].includes(mode);
  if (!['example', 'adopt', 'transition'].includes(mode)) {
    errors.push('Validation mode must be example, adopt, or transition.');
  }
  if (operational && (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))) {
    errors.push('Operational validation requires an explicit valid validation instant.');
  }
  if (
    operational &&
    EXPECTED_OPTION_KEYS.some(
      (key) => typeof options[key] !== 'string' || options[key].length === 0,
    )
  ) {
    errors.push('Operational validation requires every expected identity and chain binding.');
  }
  if (!assertExactKeys(record, EXACT_KEYS.root, 'record', errors)) {
    return { mode, operational, errors };
  }
  if (record.schemaVersion !== 1) errors.push('record.schemaVersion must be 1.');
  if (record.artifactType !== 'REDIS_OPERATOR_SECRET_VERSION_TRANSITION') {
    errors.push('record.artifactType must be REDIS_OPERATOR_SECRET_VERSION_TRANSITION.');
  }
  if (mode === 'example') {
    validateExample(record, errors);
  } else {
    validateContent(record.content, mode, options, errors);
  }
  return { mode, operational, errors };
}

function verifyRecord(record, options, registry, production) {
  let structural;
  let requestedMode;
  try {
    requestedMode = options?.mode;
    structural = validateRecordStructure(record, options ?? {});
  } catch {
    return baseFailureReport(requestedMode, [
      'Redis operator transition structure is malformed or non-canonical.',
    ]);
  }
  const errors = structural.errors;
  let authorityRegistrySha256;
  let signatureValidated = false;
  if (structural.operational && errors.length === 0) {
    try {
      authorityRegistrySha256 = parseAndVerifySignatures(record, registry);
      signatureValidated = true;
    } catch {
      errors.push('Record signatures do not satisfy the dedicated production authority registry.');
    }
  }
  const ok = errors.length === 0;
  const content = record?.content;
  let currentOperatorStateSha256;
  let targetOperatorStateSha256;
  let currentCredentialStateSha256;
  let targetCredentialStateSha256;
  if (ok && structural.operational) {
    try {
      currentOperatorStateSha256 = redisOperatorTransitionStateSha256(content.currentState);
      targetOperatorStateSha256 = redisOperatorTransitionStateSha256(content.targetState);
      currentCredentialStateSha256 = fixedSlotCredentialStateSha256(content.currentState);
      targetCredentialStateSha256 = fixedSlotCredentialStateSha256(content.targetState);
    } catch {
      return baseFailureReport(structural.mode, [
        'Redis operator transition structure is malformed or non-canonical.',
      ]);
    }
  }
  const report = deepFreeze({
    ok,
    readyForAuthorizedPlan: false,
    productionAuthorityValidated: false,
    signatureValidated: ok && signatureValidated,
    mode: structural.mode,
    operation: ok && structural.operational ? content.operation.action : undefined,
    fieldName: ok && structural.operational ? content.operation.fieldName : undefined,
    canonicalSha256: safeRecordSha256(record),
    currentOperatorStateSha256,
    targetOperatorStateSha256,
    currentCredentialStateSha256,
    targetCredentialStateSha256,
    redisOperatorPredecessorTransitionSha256:
      ok && structural.operational ? content.predecessors.redisOperatorTransitionSha256 : undefined,
    credentialPredecessorTransitionSha256:
      ok && structural.operational ? content.predecessors.credentialTransitionSha256 : undefined,
    preservedAuthWalletStateSha256:
      ok && structural.operational ? content.predecessors.authWalletStateSha256 : undefined,
    preservedAuthWalletTransitionSha256:
      ok && structural.operational ? content.predecessors.authWalletTransitionSha256 : undefined,
    authorityRegistrySha256: ok && signatureValidated ? authorityRegistrySha256 : undefined,
    plan: ok && structural.operational ? planFor(content, structural.mode) : undefined,
    errors,
    ...ZERO_CALLS,
  });
  if (ok && signatureValidated && production) {
    const productionReport = deepFreeze({
      ...report,
      readyForAuthorizedPlan: true,
      productionAuthorityValidated: true,
    });
    PRODUCTION_AUTHORIZED_REPORTS.add(productionReport);
    return productionReport;
  }
  return report;
}

/** Example validation never grants operational authority. */
export function validateRedisOperatorSecretVersionTransition(record, options = {}) {
  try {
    const mode = options?.mode ?? 'example';
    if (mode !== 'example') {
      return baseFailureReport(mode, [
        'Operational records require verification through the production authority path.',
      ]);
    }
    const structural = validateRecordStructure(record, { ...options, mode: 'example' });
    const ok = structural.errors.length === 0;
    return deepFreeze({
      ok,
      readyForAuthorizedPlan: false,
      productionAuthorityValidated: false,
      signatureValidated: false,
      mode: 'example',
      operation: ok ? 'EXAMPLE_ONLY' : undefined,
      canonicalSha256: safeRecordSha256(record),
      errors: structural.errors,
      ...ZERO_CALLS,
    });
  } catch {
    return baseFailureReport('example', [
      'Redis operator transition structure is malformed or non-canonical.',
    ]);
  }
}

/** Test-only cryptographic seam. Its reports are deliberately never production-branded. */
export function verifyRedisOperatorSecretVersionTransitionWithTestRegistry(
  record,
  options,
  authorityRegistry,
) {
  return verifyRecord(record, options, authorityRegistry, false);
}

export function isProductionAuthorizedRedisOperatorTransitionReport(report) {
  return isPlainObject(report) && PRODUCTION_AUTHORIZED_REPORTS.has(report);
}

function verifyWithProductionRegistry(record, options) {
  return verifyRecord(record, options, REDIS_OPERATOR_TRANSITION_AUTHORITY_KEY_REGISTRY, true);
}

function comparablePath(path) {
  const resolvedPath = resolve(path);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
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
    if (comparablePath(resolvedPath) !== comparablePath(DEFAULT_REDIS_OPERATOR_TRANSITION_RECORD)) {
      throw new Error(REDIS_OPERATOR_TRANSITION_INPUT_ERROR);
    }
    return resolvedPath;
  }
  if (
    !pathWithin(LOCAL_REDIS_OPERATOR_TRANSITION_ROOT, resolvedPath) ||
    !resolvedPath.toLowerCase().endsWith('.redis-operator-transition.local.json')
  ) {
    throw new Error(REDIS_OPERATOR_TRANSITION_INPUT_ERROR);
  }
  return resolvedPath;
}

function loadRecordInternal(recordPath, mode, afterFirstReadForTest) {
  try {
    const resolvedPath = assertRecordLocation(recordPath, mode);
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(resolvedPath, MAX_REDIS_OPERATOR_TRANSITION_RECORD_BYTES)
        : readSecureLocalFileForTest(
            resolvedPath,
            MAX_REDIS_OPERATOR_TRANSITION_RECORD_BYTES,
            afterFirstReadForTest,
          );
    const record = parseStrictJsonBytes(bytes);
    if (mode !== 'example') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (canonicalizeRedisOperatorTransitionValue(record) !== text) {
        throw new Error(REDIS_OPERATOR_TRANSITION_INPUT_ERROR);
      }
    }
    return record;
  } catch {
    throw new Error(REDIS_OPERATOR_TRANSITION_INPUT_ERROR);
  }
}

export function loadRedisOperatorSecretVersionTransitionRecord(recordPath, mode) {
  return loadRecordInternal(recordPath, mode, undefined);
}

/** Test-only fault seam; production callers use the stable loader above. */
export function loadRedisOperatorSecretVersionTransitionRecordForTest(
  recordPath,
  mode,
  afterFirstReadForTest,
) {
  return loadRecordInternal(recordPath, mode, afterFirstReadForTest);
}

function parseArguments(argv) {
  const options = {
    record: DEFAULT_REDIS_OPERATOR_TRANSITION_RECORD,
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
    ['--expected-workload-stack-id', 'expectedWorkloadStackId'],
    ['--expected-environment', 'expectedEnvironment'],
    ['--expected-parent-template-sha256', 'expectedParentTemplateSha256'],
    ['--expected-workload-template-sha256', 'expectedWorkloadTemplateSha256'],
    ['--expected-observability-template-sha256', 'expectedObservabilityTemplateSha256'],
    ['--expected-secret-arn', 'expectedSecretArn'],
    ['--expected-kms-key-arn', 'expectedKmsKeyArn'],
    ['--expected-operator-user-id', 'expectedOperatorUserId'],
    ['--expected-current-version-id', 'expectedCurrentVersionId'],
    ['--expected-target-version-id', 'expectedTargetVersionId'],
    ['--expected-redis-operator-state-sha256', 'expectedRedisOperatorStateSha256'],
    ['--expected-redis-operator-transition-sha256', 'expectedRedisOperatorTransitionSha256'],
    ['--expected-credential-state-sha256', 'expectedCredentialStateSha256'],
    ['--expected-credential-transition-sha256', 'expectedCredentialTransitionSha256'],
    ['--expected-auth-wallet-state-sha256', 'expectedAuthWalletStateSha256'],
    ['--expected-auth-wallet-transition-sha256', 'expectedAuthWalletTransitionSha256'],
    ['--expected-operation', 'expectedOperation'],
    ['--expected-field-name', 'expectedFieldName'],
  ]);
  const operationalArguments = [...valueArguments.keys()].filter(
    (argument) => !['--record', '--mode'].includes(argument),
  );
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (seen.has(argument)) throw new Error(REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR);
      seen.add(argument);
      options.json = true;
      continue;
    }
    if (!valueArguments.has(argument) || seen.has(argument)) {
      throw new Error(REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR);
    seen.add(argument);
    options[valueArguments.get(argument)] = value;
    index += 1;
  }
  if (!['example', 'adopt', 'transition'].includes(options.mode)) {
    throw new Error(REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR);
  }
  if (options.mode === 'example') {
    if (operationalArguments.some((argument) => seen.has(argument))) {
      throw new Error(REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR);
    }
  } else if (
    !seen.has('--record') ||
    operationalArguments.some((argument) => !seen.has(argument)) ||
    !canonicalInstant(options.at)
  ) {
    throw new Error(REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR);
  }
  options.now = options.mode === 'example' ? undefined : new Date(options.at);
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
    fixedFailure(REDIS_OPERATOR_TRANSITION_ARGUMENT_ERROR);
    process.exitCode = 2;
    return;
  }
  let record;
  try {
    record = loadRedisOperatorSecretVersionTransitionRecord(options.record, options.mode);
  } catch {
    fixedFailure(REDIS_OPERATOR_TRANSITION_INPUT_ERROR);
    process.exitCode = 2;
    return;
  }
  const report =
    options.mode === 'example'
      ? validateRedisOperatorSecretVersionTransition(record, { mode: 'example' })
      : verifyWithProductionRegistry(record, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok && options.mode === 'example') {
    process.stdout.write(
      'Inert Redis operator transition example validation passed.\nReady for authorized plan: false.\nExternal calls made: 0\nAWS calls made: 0\nDatabase connections made: 0\nRedis connections made: 0\nResources created: 0\nFiles written: 0\n',
    );
  } else if (report.ok && isProductionAuthorizedRedisOperatorTransitionReport(report)) {
    process.stdout.write(
      `Signed Redis operator ${options.mode} validation passed.\nReady for separately authorized plan: true.\nExternal calls made: 0\nAWS calls made: 0\nDatabase connections made: 0\nRedis connections made: 0\nResources created: 0\nFiles written: 0\n`,
    );
  } else {
    fixedFailure('No production Redis operator transition authority was granted.');
  }
  process.exitCode =
    options.mode === 'example'
      ? report.ok
        ? 0
        : 1
      : report.ok && isProductionAuthorizedRedisOperatorTransitionReport(report)
        ? 0
        : 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
