#!/usr/bin/env node

/**
 * KAN-234 deployment/rollback rehearsal evidence validation.
 *
 * This module is deliberately filesystem-only. It parses one local JSON file,
 * validates immutable bindings and ordered evidence, and computes a canonical
 * digest. It cannot contact AWS, DNS, a registry, hosted CI, or any other
 * network service, and it cannot execute a deployment command.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

export const REHEARSAL_STEP_ORDER = [
  'preflight',
  'zeroCountCreate',
  'dependencyReadiness',
  'migrationAndVerify',
  'serviceActivation',
  'healthAndOutbox',
  'rollback',
  'postRollbackHealth',
  'cleanupAndCostInventory',
];

const HEALTH_KEYS = [
  'ecsApiService',
  'ecsWebService',
  'ecsWorkerService',
  'applicationLoadBalancer',
  'api',
  'web',
  'worker',
  'privateNetwork',
];
const DEPENDENCY_KEYS = ['database', 'cache', 'queue', 'privateNetwork', 'artifactAvailability'];
const CONCRETE_BINDINGS = [
  ['environmentName', 'expectedEnvironment'],
  ['accountId', 'expectedAccount'],
  ['region', 'expectedRegion'],
  ['stackId', 'expectedStackId'],
  ['sourceRevision', 'expectedSourceRevision'],
  ['priorSourceRevision', 'expectedPriorSourceRevision'],
  ['apiImageUri', 'expectedApiImageUri'],
  ['webImageUri', 'expectedWebImageUri'],
  ['workerImageUri', 'expectedWorkerImageUri'],
  ['releaseControlRecordSha256', 'expectedReleaseControlRecordSha256'],
  ['priorReleaseControlRecordSha256', 'expectedPriorReleaseControlRecordSha256'],
  ['applicationTemplateSha256', 'expectedApplicationTemplateSha256'],
];

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,127}$/;
const ROLE_ALIAS_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ARN_PATTERN =
  /^arn:(?<partition>aws|aws-us-gov|aws-cn):(?<service>[a-z0-9-]+):(?<region>[a-z0-9-]*):(?<account>\d{12}):(?<resource>.+)$/;
const IMAGE_URI_PATTERN =
  /^(?<account>\d{12})\.dkr\.ecr\.(?<region>[a-z0-9-]+)\.(?<suffix>amazonaws\.com(?:\.cn)?)\/(?<repository>crypto-lending-(?:api|web|worker))@sha256:(?<digest>[a-f0-9]{64})$/;
const SECRET_SHAPE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
  /\b(?:password|private[_-]?key|secret[_-]?access[_-]?key|session[_-]?token)\s*[:=]/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  /:\/\/[^/\s:]+:[^/@\s]+@/,
];
const WEAK_ROLE_ALIASES = /^(?:admin|owner|security|team|unknown|unset|none|tbd)$/;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_RECORD_DURATION_MS = 8 * 60 * 60 * 1000;
const MAX_EVIDENCE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

const schema = JSON.parse(
  readFileSync(new URL('./nonproduction-rehearsal-record.schema.json', import.meta.url), 'utf8'),
);
const inertExample = JSON.parse(
  readFileSync(new URL('./nonproduction-rehearsal-record.example.json', import.meta.url), 'utf8'),
);
const schemaValidator = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: false,
}).compile(schema);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortJson(value[key])]),
  );
}

export function canonicalizeNonproductionRehearsalRecord(record) {
  return JSON.stringify(sortJson(record)) ?? 'null';
}

function canonicalSha256(value) {
  return createHash('sha256')
    .update(canonicalizeNonproductionRehearsalRecord(value), 'utf8')
    .digest('hex');
}

function schemaErrors() {
  return (schemaValidator.errors ?? []).map(
    (error) =>
      `schema${error.instancePath || '/'} ${error.message ?? 'is invalid'}${
        error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ''
      }.`,
  );
}

function inspectForSecrets(value, path, errors) {
  if (typeof value === 'string') {
    if (SECRET_SHAPE_PATTERNS.some((pattern) => pattern.test(value))) {
      errors.push(`${path} contains secret-shaped or personal-address data.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectForSecrets(entry, `${path}[${index}]`, errors));
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, entry]) =>
      inspectForSecrets(entry, `${path}.${key}`, errors),
    );
  }
}

function parseInstant(value, path, errors) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    errors.push(`${path} must be an ISO-8601 UTC instant with seconds.`);
    return undefined;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    errors.push(`${path} is not a real calendar instant.`);
    return undefined;
  }
  const normalized = new Date(timestamp).toISOString();
  const canonicalInput = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_match, fraction) => `.${fraction.padEnd(3, '0')}Z`)
    : value.replace(/Z$/, '.000Z');
  if (normalized !== canonicalInput) {
    errors.push(`${path} is not a canonical real calendar instant.`);
    return undefined;
  }
  return new Date(timestamp);
}

function assertReference(value, path, errors) {
  if (
    typeof value !== 'string' ||
    !REFERENCE_PATTERN.test(value) ||
    /NOT_(?:RUN|APPROVED)/i.test(value) ||
    value.includes('@')
  ) {
    errors.push(`${path} must be a stable non-secret reference.`);
  }
}

function assertRoleAlias(value, path, errors) {
  if (
    typeof value !== 'string' ||
    !ROLE_ALIAS_PATTERN.test(value) ||
    WEAK_ROLE_ALIASES.test(value)
  ) {
    errors.push(`${path} must be a stable, specific lowercase role alias.`);
  }
}

function expectedPartition(region) {
  if (region.startsWith('cn-')) return 'aws-cn';
  if (region.startsWith('us-gov-')) return 'aws-us-gov';
  return 'aws';
}

function parseBoundArn(value, path, record, expectedService, resourcePattern, errors) {
  const match = typeof value === 'string' ? ARN_PATTERN.exec(value) : undefined;
  if (!match) {
    errors.push(`${path} must be an exact AWS ARN.`);
    return undefined;
  }
  const { partition, service, region, account, resource } = match.groups;
  if (partition !== expectedPartition(record.binding.region)) {
    errors.push(`${path} uses the wrong partition for the bound Region.`);
  }
  if (expectedService !== undefined && service !== expectedService) {
    errors.push(`${path} must be an ${expectedService} ARN.`);
  }
  if (region !== record.binding.region) errors.push(`${path} must use the bound Region.`);
  if (account !== record.binding.accountId) errors.push(`${path} must use the bound account.`);
  if (!resourcePattern.test(resource)) errors.push(`${path} has an unexpected resource shape.`);
  return { resource, value };
}

function validateImageUri(value, expectedRepository, record, path, errors) {
  const match = typeof value === 'string' ? IMAGE_URI_PATTERN.exec(value) : undefined;
  if (!match) {
    errors.push(`${path} must be a digest-pinned ECR image URI.`);
    return undefined;
  }
  if (match.groups.account !== record.binding.accountId) {
    errors.push(`${path} must use the bound account.`);
  }
  if (match.groups.region !== record.binding.region) {
    errors.push(`${path} must use the bound Region.`);
  }
  const expectedSuffix = record.binding.region.startsWith('cn-')
    ? 'amazonaws.com.cn'
    : 'amazonaws.com';
  if (match.groups.suffix !== expectedSuffix) {
    errors.push(`${path} uses the wrong registry suffix for the bound Region.`);
  }
  if (match.groups.repository !== expectedRepository) {
    errors.push(`${path} must use repository ${expectedRepository}.`);
  }
  return match.groups.digest;
}

function validateExpectedBindings(record, mode, options, errors) {
  for (const [recordKey, optionKey] of CONCRETE_BINDINGS) {
    const expected = options[optionKey];
    if (typeof expected !== 'string' || expected.length === 0) {
      errors.push(`${optionKey} is required for ${mode} validation.`);
    } else if (record.binding[recordKey] !== expected) {
      errors.push(`record.binding.${recordKey} does not match ${optionKey}.`);
    }
  }
  for (const [recordPath, optionKey] of [
    ['priorArtifactManifestSha256', 'expectedPriorArtifactManifestSha256'],
    ['migrationTaskDefinitionSha256', 'expectedMigrationTaskDefinitionSha256'],
  ]) {
    const expected = options[optionKey];
    if (typeof expected !== 'string' || !SHA256_PATTERN.test(expected)) {
      errors.push(`${optionKey} is required as lowercase SHA-256 for ${mode} validation.`);
    } else if (record.observations.release[recordPath] !== expected) {
      errors.push(`record.observations.release.${recordPath} does not match ${optionKey}.`);
    }
  }
  if (mode === 'live-acceptance') {
    if (
      typeof options.expectedBillingControlRecordSha256 !== 'string' ||
      !SHA256_PATTERN.test(options.expectedBillingControlRecordSha256)
    ) {
      errors.push('expectedBillingControlRecordSha256 is required as lowercase SHA-256.');
    } else if (
      record.binding.billingControlRecordSha256 !== options.expectedBillingControlRecordSha256
    ) {
      errors.push(
        'record.binding.billingControlRecordSha256 does not match expectedBillingControlRecordSha256.',
      );
    }
  } else if (record.binding.billingControlRecordSha256 !== 'NOT_RUN') {
    errors.push('A local dry rehearsal must leave billingControlRecordSha256 NOT_RUN.');
  }
}

function validateReleaseRecordBase(releaseRecord, label, record, now, errors) {
  if (!isPlainObject(releaseRecord)) {
    errors.push(`${label} must be loaded from a regular local JSON file.`);
    return false;
  }
  if (
    releaseRecord.schemaVersion !== 2 ||
    releaseRecord.artifactType !== 'KAN_35_RELEASE_DEPLOYMENT_CONTROL' ||
    releaseRecord.status !== 'APPROVED' ||
    releaseRecord.action !== 'DEPLOY'
  ) {
    errors.push(`${label} must be an approved KAN-35 schema-v2 DEPLOY record.`);
    return false;
  }
  if (!isPlainObject(releaseRecord.aws) || !isPlainObject(releaseRecord.target)) {
    errors.push(`${label} is missing its AWS or target binding.`);
    return false;
  }
  if (!isPlainObject(releaseRecord.artifact) || !isPlainObject(releaseRecord.gates)) {
    errors.push(`${label} is missing artifact or gate evidence.`);
    return false;
  }
  if (releaseRecord.aws.accountId !== record.binding.accountId) {
    errors.push(`${label} account does not match the rehearsal binding.`);
  }
  if (releaseRecord.aws.region !== record.binding.region) {
    errors.push(`${label} Region does not match the rehearsal binding.`);
  }
  if (releaseRecord.target.environmentName !== record.binding.environmentName) {
    errors.push(`${label} environment does not match the rehearsal binding.`);
  }
  const stackArn = ARN_PATTERN.exec(record.binding.stackId);
  const stackName = stackArn?.groups.resource.split('/')[1];
  if (releaseRecord.target.stackName !== stackName) {
    errors.push(`${label} stack name does not match the immutable stack ID.`);
  }
  for (const gate of [
    'continuousIntegration',
    'unitTests',
    'integrationTests',
    'migrationValidation',
    'reproducibleBuild',
    'artifactVersioning',
  ]) {
    if (releaseRecord.gates[gate] !== 'PASS') {
      errors.push(`${label}.gates.${gate} must equal PASS.`);
    }
  }
  if (releaseRecord.independentVerification?.decision !== 'APPROVED') {
    errors.push(`${label} requires approved independent verification.`);
  }
  const approvedAt = parseInstant(releaseRecord.approvedAt, `${label}.approvedAt`, errors);
  const expiresAt = parseInstant(releaseRecord.expiresAt, `${label}.expiresAt`, errors);
  if (approvedAt && approvedAt > now) errors.push(`${label} cannot be approved in the future.`);
  if (expiresAt && expiresAt <= now) errors.push(`${label} has expired.`);
  if (approvedAt && expiresAt && approvedAt >= expiresAt) {
    errors.push(`${label} approval must precede expiry.`);
  }
  return true;
}

function validateBoundControlRecords(record, mode, options, now, errors) {
  const current = options.releaseRecord;
  const prior = options.priorReleaseRecord;
  const currentValid = validateReleaseRecordBase(current, 'releaseRecord', record, now, errors);
  const priorValid = validateReleaseRecordBase(prior, 'priorReleaseRecord', record, now, errors);
  if (currentValid) {
    if (canonicalSha256(current) !== record.binding.releaseControlRecordSha256) {
      errors.push('releaseRecord canonical SHA-256 does not match the rehearsal binding.');
    }
    if (current.templateSha256 !== record.binding.applicationTemplateSha256) {
      errors.push('releaseRecord template digest does not match the rehearsal binding.');
    }
    if (
      current.artifact.sourceRevision !== record.binding.sourceRevision ||
      current.artifact.apiImageUri !== record.binding.apiImageUri ||
      current.artifact.webImageUri !== record.binding.webImageUri ||
      current.artifact.workerImageUri !== record.binding.workerImageUri
    ) {
      errors.push('releaseRecord does not bind the exact source and three rehearsal images.');
    }
    if (
      current.target.changeSetType !== 'CREATE' ||
      current.target.changeSetName !== record.observations.release.zeroCountCreateChangeSetId
    ) {
      errors.push('releaseRecord must bind the exact zero-count CREATE change set.');
    }
    if (
      current.parameters?.ApiDesiredCount !== '0' ||
      current.parameters?.WebDesiredCount !== '0' ||
      current.parameters?.WorkerDesiredCount !== '0'
    ) {
      errors.push('releaseRecord must keep all services at zero desired count for CREATE.');
    }
  }
  if (priorValid) {
    if (canonicalSha256(prior) !== record.binding.priorReleaseControlRecordSha256) {
      errors.push('priorReleaseRecord canonical SHA-256 does not match the rehearsal binding.');
    }
    if (prior.artifact.sourceRevision !== record.binding.priorSourceRevision) {
      errors.push('priorReleaseRecord source does not match the rollback source binding.');
    }
    for (const [key, repository] of [
      ['apiImageUri', 'crypto-lending-api'],
      ['webImageUri', 'crypto-lending-web'],
      ['workerImageUri', 'crypto-lending-worker'],
    ]) {
      validateImageUri(
        prior.artifact[key],
        repository,
        record,
        `priorReleaseRecord.artifact.${key}`,
        errors,
      );
    }
    if (
      canonicalSha256(prior.artifact) !== record.observations.release.priorArtifactManifestSha256
    ) {
      errors.push('The prior artifact manifest digest does not match priorReleaseRecord.artifact.');
    }
  }
  if (currentValid && priorValid && current.recordId === prior.recordId) {
    errors.push('Current and prior release records must have different record IDs.');
  }
  if (record.binding.sourceRevision === record.binding.priorSourceRevision) {
    errors.push('Deployment and rollback source revisions must be different.');
  }

  if (mode === 'live-acceptance') {
    const billing = options.billingControlRecord;
    if (!isPlainObject(billing)) {
      errors.push('billingControlRecord must be loaded for live acceptance.');
    } else {
      if (
        billing.schemaVersion !== 1 ||
        billing.status !== 'APPROVED' ||
        billing.independentVerification?.decision !== 'APPROVED'
      ) {
        errors.push(
          'billingControlRecord must be an approved independently verified KAN-229 record.',
        );
      }
      if (
        billing.aws?.accountId !== record.binding.accountId ||
        billing.aws?.applicationRegion !== record.binding.region ||
        billing.environment?.name !== record.binding.environmentName
      ) {
        errors.push('billingControlRecord identity does not match the rehearsal binding.');
      }
      if (canonicalSha256(billing) !== record.binding.billingControlRecordSha256) {
        errors.push('billingControlRecord canonical SHA-256 does not match the rehearsal binding.');
      }
      const billingExpiry = parseInstant(
        billing.expiresAt,
        'billingControlRecord.expiresAt',
        errors,
      );
      if (billingExpiry && billingExpiry <= now) errors.push('billingControlRecord has expired.');
    }
  } else if (options.billingControlRecord !== undefined) {
    errors.push('A local dry rehearsal must not load a live billing authorization record.');
  }
}

function validateBoundary(record, mode, errors) {
  const expected =
    mode === 'local-dry-run'
      ? {
          mode: 'FILESYSTEM_ONLY',
          cloudActions: 'PROHIBITED_ZERO',
          networkActions: 'PROHIBITED_ZERO',
          dnsChanges: 'PROHIBITED_ZERO',
          registryWrites: 'PROHIBITED_ZERO',
          hostedCiRuns: 'PROHIBITED_ZERO',
          paidOperations: 'PROHIBITED_ZERO',
        }
      : {
          mode: 'APPROVED_LIVE_NONPRODUCTION',
          cloudActions: 'AUTHORIZED_EVIDENCED',
          networkActions: 'AUTHORIZED_EVIDENCED',
          dnsChanges: 'PROHIBITED_ZERO',
          registryWrites: 'PROHIBITED_ZERO',
          hostedCiRuns: 'PROHIBITED_ZERO',
          paidOperations: 'AUTHORIZED_EVIDENCED',
        };
  for (const [key, value] of Object.entries(expected)) {
    if (record.executionBoundary[key] !== value) {
      errors.push(`record.executionBoundary.${key} must equal ${value} in ${mode} mode.`);
    }
  }
}

function validateAuthority(record, mode, now, recordStart, recordEnd, errors) {
  const authority = record.authority;
  if (mode === 'local-dry-run') {
    const expected = {
      executionAuthorizationReference: 'NOT_APPROVED',
      costAuthorizationReference: 'NOT_APPROVED',
      operatorRole: 'NOT_APPROVED',
      independentVerifierRole: 'NOT_APPROVED',
      windowStartsAt: 'NOT_RUN',
      windowEndsAt: 'NOT_RUN',
    };
    for (const [key, value] of Object.entries(expected)) {
      if (authority[key] !== value) {
        errors.push(`A local dry rehearsal requires record.authority.${key} to equal ${value}.`);
      }
    }
    return;
  }

  assertReference(
    authority.executionAuthorizationReference,
    'record.authority.executionAuthorizationReference',
    errors,
  );
  assertReference(
    authority.costAuthorizationReference,
    'record.authority.costAuthorizationReference',
    errors,
  );
  if (authority.executionAuthorizationReference === authority.costAuthorizationReference) {
    errors.push('Execution and cost authorization must be separate references.');
  }
  assertRoleAlias(authority.operatorRole, 'record.authority.operatorRole', errors);
  assertRoleAlias(
    authority.independentVerifierRole,
    'record.authority.independentVerifierRole',
    errors,
  );
  if (authority.operatorRole === authority.independentVerifierRole) {
    errors.push('The live operator and independent verifier must be different roles.');
  }
  const windowStart = parseInstant(
    authority.windowStartsAt,
    'record.authority.windowStartsAt',
    errors,
  );
  const windowEnd = parseInstant(authority.windowEndsAt, 'record.authority.windowEndsAt', errors);
  if (windowStart && windowEnd && windowStart >= windowEnd) {
    errors.push('The authorization window must have positive duration.');
  }
  if (windowStart && recordStart && recordStart < windowStart) {
    errors.push('The rehearsal started before the authorization window.');
  }
  if (windowEnd && recordEnd && recordEnd > windowEnd) {
    errors.push('The rehearsal completed after the authorization window.');
  }
  if (windowEnd && now < recordEnd) {
    errors.push('The validator clock cannot precede record completion.');
  }
}

function validateSteps(record, mode, now, recordStart, recordEnd, errors) {
  const expectedScope = mode === 'local-dry-run' ? 'LOCAL_FIXTURE_ONLY' : 'LIVE_NONPRODUCTION';
  const expectedResult = mode === 'local-dry-run' ? 'DRY_PASS' : 'LIVE_PASS';
  const evidenceReferences = new Set();
  const evidenceDigests = new Set();
  const executionIds = new Set();
  let priorCompletion;

  REHEARSAL_STEP_ORDER.forEach((name, index) => {
    const step = record.steps[name];
    const path = `record.steps.${name}`;
    if (step.sequence !== index + 1) errors.push(`${path}.sequence must equal ${index + 1}.`);
    if (step.scope !== expectedScope) errors.push(`${path}.scope must equal ${expectedScope}.`);
    if (step.result !== expectedResult) {
      errors.push(`${path}.result must equal ${expectedResult}; failures stop acceptance.`);
    }
    assertReference(step.executionId, `${path}.executionId`, errors);
    assertRoleAlias(step.ownerRole, `${path}.ownerRole`, errors);
    assertReference(step.evidenceReference, `${path}.evidenceReference`, errors);
    if (!SHA256_PATTERN.test(step.evidenceSha256)) {
      errors.push(`${path}.evidenceSha256 must be lowercase SHA-256.`);
    }
    if (executionIds.has(step.executionId)) errors.push(`${path}.executionId must be unique.`);
    if (evidenceReferences.has(step.evidenceReference)) {
      errors.push(`${path}.evidenceReference must be unique.`);
    }
    if (evidenceDigests.has(step.evidenceSha256)) {
      errors.push(`${path}.evidenceSha256 must be unique.`);
    }
    executionIds.add(step.executionId);
    evidenceReferences.add(step.evidenceReference);
    evidenceDigests.add(step.evidenceSha256);

    const started = parseInstant(step.startedAt, `${path}.startedAt`, errors);
    const completed = parseInstant(step.completedAt, `${path}.completedAt`, errors);
    const expires = parseInstant(step.expiresAt, `${path}.expiresAt`, errors);
    if (started && completed && started >= completed) {
      errors.push(`${path} must have positive duration.`);
    }
    if (priorCompletion && started && started <= priorCompletion) {
      errors.push(`${path} must start strictly after the preceding step completes.`);
    }
    if (recordStart && started && started < recordStart) {
      errors.push(`${path} started before the record.`);
    }
    if (recordEnd && completed && completed > recordEnd) {
      errors.push(`${path} completed after the record.`);
    }
    if (completed && expires && expires <= completed) {
      errors.push(`${path}.expiresAt must follow step completion.`);
    }
    if (expires && expires <= now) errors.push(`${path} evidence has expired.`);
    if (
      completed &&
      expires &&
      expires.getTime() - completed.getTime() > MAX_EVIDENCE_VALIDITY_MS
    ) {
      errors.push(`${path} evidence validity must not exceed seven days.`);
    }
    if (completed) priorCompletion = completed;
  });

  if (
    mode === 'live-acceptance' &&
    REHEARSAL_STEP_ORDER.some(
      (name) => record.steps[name].ownerRole === record.authority.independentVerifierRole,
    )
  ) {
    errors.push('The independent verifier must not own a rehearsal execution step.');
  }
}

function validateReleaseObservations(record, expectedResult, errors) {
  const release = record.observations.release;
  const resultKeys = [
    'zeroCountCreateResult',
    'zeroDesiredCountsVerified',
    'migrationApplyResult',
    'migrationVerifyResult',
    'serviceActivationResult',
    'rollbackDataIntegrityResult',
    'rollbackResult',
  ];
  for (const key of resultKeys) {
    if (release[key] !== expectedResult) {
      errors.push(`record.observations.release.${key} must equal ${expectedResult}.`);
    }
  }
  if (release.zeroCountCreateChangeSetType !== 'CREATE') {
    errors.push('The initial zero-count change set must be CREATE.');
  }
  if (release.serviceActivationChangeSetType !== 'UPDATE') {
    errors.push('Service activation must be a later UPDATE change set.');
  }
  for (const key of [
    'activatedApiDesiredCount',
    'activatedWebDesiredCount',
    'activatedWorkerDesiredCount',
  ]) {
    if (!Number.isSafeInteger(Number(release[key])) || Number(release[key]) < 1) {
      errors.push(`record.observations.release.${key} must be at least 1 after migration verify.`);
    }
  }
  if (
    release.migrationApplyCommand !==
    'node dist/infrastructure/database/migration.cli.js --production up'
  ) {
    errors.push('Migration apply evidence must bind the exact compiled production command.');
  }
  if (
    release.migrationVerifyCommand !==
    'node dist/infrastructure/database/migration.cli.js --production verify'
  ) {
    errors.push('Migration verification evidence must bind the exact compiled production command.');
  }
  if (release.migrationApplyExitCode !== 0 || release.migrationVerifyExitCode !== 0) {
    errors.push('Separate migration apply and verify tasks must both finish with exit code 0.');
  }
  if (release.deployedSourceRevision !== record.binding.sourceRevision) {
    errors.push('The deployed source revision must match the release binding.');
  }
  if (release.rollbackSourceRevision !== record.binding.priorSourceRevision) {
    errors.push('The rollback source revision must match the prior release binding.');
  }
  if (!['NO_SCHEMA_CHANGE', 'BACKWARD_COMPATIBLE'].includes(release.databaseCompatibility)) {
    errors.push('Rollback requires explicit no-change or backward-compatible database evidence.');
  }

  const zeroChangeSet = parseBoundArn(
    release.zeroCountCreateChangeSetArn,
    'record.observations.release.zeroCountCreateChangeSetArn',
    record,
    'cloudformation',
    /^changeSet\/[A-Za-z][A-Za-z0-9-]{0,127}\/[A-Za-z0-9-]+$/,
    errors,
  );
  const activationChangeSet = parseBoundArn(
    release.serviceActivationChangeSetArn,
    'record.observations.release.serviceActivationChangeSetArn',
    record,
    'cloudformation',
    /^changeSet\/[A-Za-z][A-Za-z0-9-]{0,127}\/[A-Za-z0-9-]+$/,
    errors,
  );
  if (
    zeroChangeSet &&
    zeroChangeSet.resource.split('/')[1] !== release.zeroCountCreateChangeSetId
  ) {
    errors.push('The zero-count change-set ID must match its immutable ARN.');
  }
  if (
    activationChangeSet &&
    activationChangeSet.resource.split('/')[1] !== release.serviceActivationChangeSetId
  ) {
    errors.push('The activation change-set ID must match its immutable ARN.');
  }
  if (release.zeroCountCreateChangeSetArn === release.serviceActivationChangeSetArn) {
    errors.push('CREATE and activation UPDATE must use different immutable change sets.');
  }

  parseBoundArn(
    release.migrationTaskDefinitionArn,
    'record.observations.release.migrationTaskDefinitionArn',
    record,
    'ecs',
    new RegExp(
      `^task-definition/crypto-lending-${record.binding.environmentName}-database-migration:\\d+$`,
    ),
    errors,
  );
  const migrationTasks = [
    ['migrationApplyTaskArn', 'migrationApplyTaskExecutionId'],
    ['migrationVerifyTaskArn', 'migrationVerifyTaskExecutionId'],
  ];
  for (const [arnKey, idKey] of migrationTasks) {
    const migrationTask = parseBoundArn(
      release[arnKey],
      `record.observations.release.${arnKey}`,
      record,
      'ecs',
      /^task\/[A-Za-z0-9_-]+\/[a-f0-9]{32,64}$/,
      errors,
    );
    if (migrationTask && migrationTask.resource.split('/').at(-1) !== release[idKey]) {
      errors.push(`record.observations.release.${idKey} must match its task ARN.`);
    }
  }
  if (release.migrationApplyTaskArn === release.migrationVerifyTaskArn) {
    errors.push('Migration apply and verify must be separate ECS task executions.');
  }
  const apiImageDigest = validateImageUri(
    record.binding.apiImageUri,
    'crypto-lending-api',
    record,
    'record.binding.apiImageUri',
    errors,
  );
  validateImageUri(
    record.binding.webImageUri,
    'crypto-lending-web',
    record,
    'record.binding.webImageUri',
    errors,
  );
  validateImageUri(
    record.binding.workerImageUri,
    'crypto-lending-worker',
    record,
    'record.binding.workerImageUri',
    errors,
  );
  if (apiImageDigest && release.migrationImageDigest !== apiImageDigest) {
    errors.push('The migration image digest must equal the bound API image digest.');
  }
}

function validateRuntimeObservations(record, expectedResult, errors) {
  const runtime = record.observations.runtime;
  const taskDefinitions = [
    [
      'apiTaskDefinitionArn',
      new RegExp(`^task-definition/crypto-lending-${record.binding.environmentName}-api:\\d+$`),
    ],
    [
      'webTaskDefinitionArn',
      new RegExp(`^task-definition/crypto-lending-${record.binding.environmentName}-web:\\d+$`),
    ],
    [
      'workerTaskDefinitionArn',
      new RegExp(
        `^task-definition/crypto-lending-${record.binding.environmentName}-outbox-worker:\\d+$`,
      ),
    ],
  ];
  const taskDefinitionValues = [];
  for (const [key, pattern] of taskDefinitions) {
    const result = parseBoundArn(
      runtime[key],
      `record.observations.runtime.${key}`,
      record,
      'ecs',
      pattern,
      errors,
    );
    if (result) taskDefinitionValues.push(result.value);
  }
  if (new Set(taskDefinitionValues).size !== taskDefinitionValues.length) {
    errors.push('API, web, and worker task definitions must be distinct.');
  }

  const taskValues = [];
  for (const key of ['apiTaskArn', 'webTaskArn', 'workerTaskArn']) {
    const result = parseBoundArn(
      runtime[key],
      `record.observations.runtime.${key}`,
      record,
      'ecs',
      /^task\/[A-Za-z0-9_-]+\/[a-f0-9]{32,64}$/,
      errors,
    );
    if (result) taskValues.push(result.value);
  }
  if (new Set(taskValues).size !== taskValues.length) {
    errors.push('API, web, and worker task ARNs must be distinct.');
  }
  const replacementTask = parseBoundArn(
    runtime.workerReplacementTaskArn,
    'record.observations.runtime.workerReplacementTaskArn',
    record,
    'ecs',
    /^task\/[A-Za-z0-9_-]+\/[a-f0-9]{32,64}$/,
    errors,
  );
  assertReference(
    runtime.workerFailureInjectionId,
    'record.observations.runtime.workerFailureInjectionId',
    errors,
  );
  if (replacementTask && runtime.workerReplacementTaskArn === runtime.workerTaskArn) {
    errors.push('Worker recovery must identify a distinct replacement task ARN.');
  }
  parseBoundArn(
    runtime.applicationLoadBalancerArn,
    'record.observations.runtime.applicationLoadBalancerArn',
    record,
    'elasticloadbalancing',
    /^loadbalancer\/app\/[A-Za-z0-9-]+\/[a-f0-9]+$/,
    errors,
  );
  for (const key of ['apiTargetGroupArn', 'webTargetGroupArn']) {
    parseBoundArn(
      runtime[key],
      `record.observations.runtime.${key}`,
      record,
      'elasticloadbalancing',
      /^targetgroup\/[A-Za-z0-9-]+\/[a-f0-9]+$/,
      errors,
    );
  }
  if (runtime.apiTargetGroupArn === runtime.webTargetGroupArn) {
    errors.push('API and web target groups must be distinct.');
  }
  assertReference(
    runtime.apiTargetHealthId,
    'record.observations.runtime.apiTargetHealthId',
    errors,
  );
  assertReference(
    runtime.webTargetHealthId,
    'record.observations.runtime.webTargetHealthId',
    errors,
  );
  if (runtime.apiTargetHealthId === runtime.webTargetHealthId) {
    errors.push('API and web target-health identifiers must be distinct.');
  }
  parseBoundArn(
    runtime.queueArn,
    'record.observations.runtime.queueArn',
    record,
    'sqs',
    new RegExp(`^crypto-lending-${record.binding.environmentName}-jobs$`),
    errors,
  );
  parseBoundArn(
    runtime.queueKmsKeyArn,
    'record.observations.runtime.queueKmsKeyArn',
    record,
    'kms',
    /^key\/[a-f0-9-]{36}$/,
    errors,
  );
  if (runtime.workerRecoveryResult !== expectedResult) {
    errors.push(`record.observations.runtime.workerRecoveryResult must equal ${expectedResult}.`);
  }
}

function validateOperationalObservations(record, mode, now, errors) {
  const expectedResult = mode === 'local-dry-run' ? 'DRY_PASS' : 'LIVE_PASS';
  validateReleaseObservations(record, expectedResult, errors);
  validateRuntimeObservations(record, expectedResult, errors);

  for (const key of DEPENDENCY_KEYS) {
    if (record.observations.dependencies[key] !== expectedResult) {
      errors.push(`record.observations.dependencies.${key} must equal ${expectedResult}.`);
    }
  }
  for (const section of ['healthBeforeRollback', 'healthAfterRollback']) {
    for (const key of HEALTH_KEYS) {
      if (record.observations[section][key] !== expectedResult) {
        errors.push(`record.observations.${section}.${key} must equal ${expectedResult}.`);
      }
    }
  }

  const outbox = record.observations.outbox;
  assertReference(outbox.eventReference, 'record.observations.outbox.eventReference', errors);
  if (outbox.eventReference !== `outbox-message:${record.observations.runtime.outboxMessageId}`) {
    errors.push('The outbox event reference must bind the exact observed queue message ID.');
  }
  const counts = Object.fromEntries(
    [
      'enqueuedCount',
      'publishedCount',
      'markedPublishedCount',
      'recoveredPendingCount',
      'duplicatePublicationCount',
      'duplicateSideEffectCount',
      'deadLetterCount',
      'maximumObservedLagSeconds',
      'allowedMaximumLagSeconds',
    ].map((key) => [key, Number(outbox[key])]),
  );
  if (counts.enqueuedCount !== 1) {
    errors.push('Outbox rehearsal must enqueue exactly one controlled event.');
  }
  if (
    counts.publishedCount !== 1 ||
    counts.markedPublishedCount !== 1 ||
    counts.recoveredPendingCount !== 1
  ) {
    errors.push(
      'Publisher restart evidence must recover, publish, and mark exactly one pending outbox event.',
    );
  }
  if (
    counts.duplicatePublicationCount !== 0 ||
    counts.duplicateSideEffectCount !== 0 ||
    counts.deadLetterCount !== 0
  ) {
    errors.push('Outbox rehearsal permits no duplicate publication, side effect, or DLQ message.');
  }
  if (
    counts.allowedMaximumLagSeconds < 1 ||
    counts.maximumObservedLagSeconds > counts.allowedMaximumLagSeconds
  ) {
    errors.push('Observed outbox lag must not exceed the positive allowed maximum.');
  }

  const cleanup = record.observations.cleanup;
  if (cleanup.temporaryResourcesCreated !== cleanup.temporaryResourcesRemoved) {
    errors.push('Cleanup must remove every temporary resource recorded as created.');
  }
  if (cleanup.unexpectedResidualResourceCount !== '0') {
    errors.push('Cleanup must report zero unexpected residual resources.');
  }
  if (cleanup.credentialArtifactsRemoved !== expectedResult) {
    errors.push(`Credential-artifact cleanup must equal ${expectedResult}.`);
  }
  const retainedArns = new Set();
  let retainedMonthlyCents = 0;
  for (const [index, resource] of cleanup.retainedResources.entries()) {
    const path = `record.observations.cleanup.retainedResources[${index}]`;
    parseBoundArn(resource.resourceArn, `${path}.resourceArn`, record, undefined, /^.+$/, errors);
    if (retainedArns.has(resource.resourceArn)) errors.push(`${path}.resourceArn is duplicated.`);
    retainedArns.add(resource.resourceArn);
    assertReference(resource.resourceType, `${path}.resourceType`, errors);
    assertRoleAlias(resource.ownerRole, `${path}.ownerRole`, errors);
    const expires = parseInstant(resource.expiresAt, `${path}.expiresAt`, errors);
    if (expires && expires <= now) errors.push(`${path} retention has expired.`);
    retainedMonthlyCents += Math.round(Number(resource.projectedMonthlyCostUsd) * 100);
  }

  const cost = record.observations.costInventory;
  if (
    cost.inventoryBeforeSha256 !== cleanup.inventoryBeforeSha256 ||
    cost.inventoryAfterCleanupSha256 !== cleanup.inventoryAfterSha256
  ) {
    errors.push('Cleanup and cost inventory must bind the same before/after inventory digests.');
  }
  const maximumCents = Math.round(Number(cost.maximumAuthorizedIncrementUsd) * 100);
  const observedCents = Math.round(Number(cost.observedIncrementUsd) * 100);
  const recurringCents = Math.round(Number(cost.projectedRecurringIncrementUsd) * 100);
  if (observedCents > maximumCents) {
    errors.push('Observed incremental cost exceeds the authorized maximum.');
  }
  if (recurringCents !== retainedMonthlyCents) {
    errors.push('Projected recurring cost must equal the retained-resource inventory total.');
  }
  if (cost.unexpectedBillableResourceCount !== '0') {
    errors.push('Cost inventory must report zero unexpected billable resources.');
  }
  if (cost.result !== expectedResult) {
    errors.push(`record.observations.costInventory.result must equal ${expectedResult}.`);
  }
  if (
    mode === 'local-dry-run' &&
    (maximumCents !== 0 || observedCents !== 0 || recurringCents !== 0 || retainedArns.size !== 0)
  ) {
    errors.push(
      'A filesystem-only dry rehearsal must remain zero-cost with no retained resources.',
    );
  }

  const findings = record.findings;
  for (const key of ['blockerCount', 'unresolvedHighSeverityCount', 'acceptedRiskCount']) {
    if (findings[key] !== '0') errors.push(`record.findings.${key} must equal 0.`);
  }
  assertRoleAlias(findings.ownerRole, 'record.findings.ownerRole', errors);
  assertReference(findings.evidenceReference, 'record.findings.evidenceReference', errors);
  if (!SHA256_PATTERN.test(findings.evidenceSha256)) {
    errors.push('record.findings.evidenceSha256 must be lowercase SHA-256.');
  }
  const findingExpiry = parseInstant(findings.expiresAt, 'record.findings.expiresAt', errors);
  if (findingExpiry && findingExpiry <= now) errors.push('The findings review has expired.');
}

function validateConcrete(record, mode, options, errors) {
  const expectedStage = mode === 'local-dry-run' ? 'LOCAL_DRY_REHEARSAL' : 'LIVE_ACCEPTANCE';
  const expectedResult = mode === 'local-dry-run' ? 'DRY_PASS' : 'LIVE_PASS';
  if (mode === 'live-acceptance') {
    errors.push(
      'Live acceptance is NOT_IMPLEMENTED and fails closed until fully validated KAN-35 zero-count CREATE, activation DEPLOY, and ROLLBACK records; KAN-229 and KAN-230 controls; pre/post task-image and queue-KMS bindings; a positive cost cap; and resolved-finding/retest evidence are composed.',
    );
  }
  if (record.stage !== expectedStage) errors.push(`record.stage must equal ${expectedStage}.`);
  if (record.overallResult !== expectedResult) {
    errors.push(`record.overallResult must equal ${expectedResult}; failures stop acceptance.`);
  }
  assertReference(record.recordId, 'record.recordId', errors);
  const now = options.now instanceof Date ? options.now : new Date();
  if (!Number.isFinite(now.getTime())) errors.push('options.now must be a valid Date.');
  const started = parseInstant(record.startedAt, 'record.startedAt', errors);
  const completed = parseInstant(record.completedAt, 'record.completedAt', errors);
  if (started && completed && started >= completed) {
    errors.push('The rehearsal must have positive duration.');
  }
  if (started && completed && completed.getTime() - started.getTime() > MAX_RECORD_DURATION_MS) {
    errors.push('The rehearsal duration must not exceed eight hours.');
  }
  if (completed && completed > now) errors.push('The rehearsal cannot complete in the future.');

  validateExpectedBindings(record, mode, options, errors);
  parseBoundArn(
    record.binding.stackId,
    'record.binding.stackId',
    record,
    'cloudformation',
    /^stack\/[A-Za-z][A-Za-z0-9-]{0,127}\/[A-Za-z0-9-]+$/,
    errors,
  );
  validateBoundary(record, mode, errors);
  validateBoundControlRecords(record, mode, options, now, errors);
  validateAuthority(record, mode, now, started, completed, errors);
  validateSteps(record, mode, now, started, completed, errors);
  validateOperationalObservations(record, mode, now, errors);
}

export function validateNonproductionRehearsalRecord(record, options = {}) {
  const errors = [];
  const validSchema = schemaValidator(record);
  if (!validSchema) errors.push(...schemaErrors());
  inspectForSecrets(record, 'record', errors);

  const mode = options.mode ?? 'example';
  if (!['example', 'local-dry-run', 'live-acceptance'].includes(mode)) {
    errors.push("Validation mode must be 'example', 'local-dry-run', or 'live-acceptance'.");
  } else if (validSchema && mode === 'example') {
    if (
      canonicalizeNonproductionRehearsalRecord(record) !==
      canonicalizeNonproductionRehearsalRecord(inertExample)
    ) {
      errors.push('Example mode accepts only the exact inert, all-NOT_RUN repository template.');
    }
  } else if (validSchema) {
    validateConcrete(record, mode, options, errors);
  }

  const canonical = canonicalizeNonproductionRehearsalRecord(record);
  const canonicalSha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');
  if (mode === 'live-acceptance') {
    if (
      typeof options.expectedRecordSha256 !== 'string' ||
      !SHA256_PATTERN.test(options.expectedRecordSha256)
    ) {
      errors.push('expectedRecordSha256 is required as an independently supplied SHA-256.');
    } else if (canonicalSha256 !== options.expectedRecordSha256) {
      errors.push('The canonical rehearsal record does not match expectedRecordSha256.');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    canonicalSha256,
    stage: isPlainObject(record) ? record.stage : undefined,
    liveAcceptanceSatisfied: false,
    localDryRehearsalSatisfied: errors.length === 0 && mode === 'local-dry-run',
  };
}

/** Reject duplicate object keys and excessive nesting before JSON.parse. */
export function assertUnambiguousJson(text) {
  if (typeof text !== 'string') throw new Error('JSON input must be text.');
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(text[index] ?? '')) index += 1;
  }

  function parseString() {
    if (text[index] !== '"') throw new Error(`Expected a JSON string at byte ${index}.`);
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      if (character === '\\') {
        index += 1;
        if (text[index] === 'u') {
          if (!/^[a-fA-F0-9]{4}$/.test(text.slice(index + 1, index + 5))) {
            throw new Error(`Invalid Unicode escape at byte ${index}.`);
          }
          index += 5;
        } else {
          if (!/["\\/bfnrt]/.test(text[index] ?? '')) {
            throw new Error(`Invalid JSON escape at byte ${index}.`);
          }
          index += 1;
        }
      } else {
        if (character.charCodeAt(0) < 0x20) {
          throw new Error(`Unescaped control character at byte ${index}.`);
        }
        index += 1;
      }
    }
    throw new Error('Unterminated JSON string.');
  }

  function parseValue(depth) {
    if (depth > MAX_JSON_DEPTH) throw new Error(`JSON nesting exceeds ${MAX_JSON_DEPTH}.`);
    skipWhitespace();
    const character = text[index];
    if (character === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      while (index < text.length) {
        const key = parseString();
        if (keys.has(key)) throw new Error(`Duplicate JSON object key '${key}'.`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') throw new Error(`Expected ':' at byte ${index}.`);
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        if (text[index] !== ',') throw new Error(`Expected ',' at byte ${index}.`);
        index += 1;
        skipWhitespace();
      }
      throw new Error('Unterminated JSON object.');
    }
    if (character === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      while (index < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        if (text[index] !== ',') throw new Error(`Expected ',' at byte ${index}.`);
        index += 1;
      }
      throw new Error('Unterminated JSON array.');
    }
    if (character === '"') {
      parseString();
      return;
    }
    const remainder = text.slice(index);
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      remainder,
    );
    if (!token) throw new Error(`Invalid JSON value at byte ${index}.`);
    index += token[0].length;
  }

  skipWhitespace();
  parseValue(0);
  skipWhitespace();
  if (index !== text.length) throw new Error(`Unexpected trailing JSON at byte ${index}.`);
}

export function loadLocalRehearsalRecord(path, argumentName = '--record') {
  if (typeof path !== 'string' || path.trim() === '')
    throw new Error(`${argumentName} is required.`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^(?:\\\\|\/\/|\\\\[?.]\\)/.test(path)) {
    throw new Error(`${argumentName} must be a local path, not a URI or network/device path.`);
  }
  const absolute = resolve(path);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`${argumentName} must not be a symbolic link.`);
  if (!info.isFile()) throw new Error(`${argumentName} must identify a regular local file.`);
  if (info.size > MAX_RECORD_BYTES) {
    throw new Error(`${argumentName} exceeds the ${MAX_RECORD_BYTES}-byte limit.`);
  }
  const realPath = realpathSync.native(absolute);
  const text = readFileSync(realPath, 'utf8');
  assertUnambiguousJson(text);
  return { path: realPath, record: JSON.parse(text) };
}

function parseArguments(argv) {
  const options = { mode: 'example', json: false };
  const names = {
    '--record': 'recordPath',
    '--release-record': 'releaseRecordPath',
    '--prior-release-record': 'priorReleaseRecordPath',
    '--billing-control-record': 'billingControlRecordPath',
    '--mode': 'mode',
    '--expected-environment': 'expectedEnvironment',
    '--expected-account': 'expectedAccount',
    '--expected-region': 'expectedRegion',
    '--expected-stack-id': 'expectedStackId',
    '--expected-source-revision': 'expectedSourceRevision',
    '--expected-prior-source-revision': 'expectedPriorSourceRevision',
    '--expected-api-image-uri': 'expectedApiImageUri',
    '--expected-web-image-uri': 'expectedWebImageUri',
    '--expected-worker-image-uri': 'expectedWorkerImageUri',
    '--expected-release-control-record-sha256': 'expectedReleaseControlRecordSha256',
    '--expected-prior-release-control-record-sha256': 'expectedPriorReleaseControlRecordSha256',
    '--expected-application-template-sha256': 'expectedApplicationTemplateSha256',
    '--expected-billing-control-record-sha256': 'expectedBillingControlRecordSha256',
    '--expected-prior-artifact-manifest-sha256': 'expectedPriorArtifactManifestSha256',
    '--expected-migration-task-definition-sha256': 'expectedMigrationTaskDefinitionSha256',
    '--expected-record-sha256': 'expectedRecordSha256',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--now') {
      const value = argv[++index];
      options.now = new Date(value);
      options.nowWasSupplied = true;
      if (!Number.isFinite(options.now.getTime()))
        throw new Error('--now must be a valid instant.');
    } else if (names[argument]) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${argument}.`);
      options[names[argument]] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function runCli() {
  let options;
  let loaded;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.mode === 'live-acceptance' && options.nowWasSupplied) {
      throw new Error('--now is test-only and is forbidden for live-acceptance CLI validation.');
    }
    loaded = loadLocalRehearsalRecord(options.recordPath);
    for (const [pathKey, recordKey, argumentName] of [
      ['releaseRecordPath', 'releaseRecord', '--release-record'],
      ['priorReleaseRecordPath', 'priorReleaseRecord', '--prior-release-record'],
      ['billingControlRecordPath', 'billingControlRecord', '--billing-control-record'],
    ]) {
      if (options[pathKey] !== undefined) {
        options[recordKey] = loadLocalRehearsalRecord(options[pathKey], argumentName).record;
      }
    }
  } catch (error) {
    process.stderr.write(`${error.message}\nExternal calls made: 0\nPaid operations made: 0\n`);
    process.exitCode = 2;
    return;
  }
  const result = validateNonproductionRehearsalRecord(loaded.record, options);
  const output = {
    ...result,
    mode: options.mode,
    record: loaded.path,
    externalCallsMade: 0,
    awsCallsMade: 0,
    dnsChangesMade: 0,
    registryWritesMade: 0,
    hostedCiRunsMade: 0,
    paidOperationsMade: 0,
    assurance:
      'Local schema and evidence binding only; not an authorization, live deployment, rollback result, signature, or cost attestation.',
  };
  if (options.json) process.stdout.write(`${JSON.stringify(output)}\n`);
  else if (result.ok) {
    process.stdout.write(
      `KAN-234 ${options.mode} record valid.\nCanonical record SHA-256: ${result.canonicalSha256}\nLive acceptance satisfied: ${result.liveAcceptanceSatisfied}\nExternal calls made: 0\nPaid operations made: 0\n`,
    );
  } else {
    process.stderr.write(`KAN-234 ${options.mode} record validation failed:\n`);
    result.errors.forEach((error) => process.stderr.write(`- ${error}\n`));
    process.stderr.write('External calls made: 0\nPaid operations made: 0\n');
  }
  process.exitCode = result.ok ? 0 : 1;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) runCli();
