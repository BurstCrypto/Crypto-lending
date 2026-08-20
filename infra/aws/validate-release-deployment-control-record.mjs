#!/usr/bin/env node

/**
 * KAN-35 release/deployment control-record validation.
 *
 * This module uses only local filesystem and cryptographic APIs. It does not
 * resolve cloud credentials, invoke subprocesses, contact a registry, or make
 * network calls. A canonical digest is a cross-artifact binding, not a digital
 * signature or deployment authorization on its own.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'artifactType',
  'status',
  'recordId',
  'approvedAt',
  'expiresAt',
  'action',
  'templateSha256',
  'aws',
  'target',
  'artifact',
  'parameters',
  'gates',
  'rollback',
  'authority',
  'independentVerification',
];

export const RELEASE_PARAMETER_NAMES = [
  'BillingAcknowledgement',
  'EnvironmentName',
  'ApplicationVersion',
  'ApiImageUri',
  'WebImageUri',
  'WorkerImageUri',
  'RdsCaBundlePath',
  'ApiDesiredCount',
  'WebDesiredCount',
  'WorkerDesiredCount',
  'VpcCidr',
  'PublicSubnetACidr',
  'PublicSubnetBCidr',
  'PrivateSubnetACidr',
  'PrivateSubnetBCidr',
  'PrivateEgressMode',
  'S3ManagedPrefixListId',
  'AllowedIngressIpv4Cidr',
  'AlbCertificateArn',
  'ApplicationHostname',
  'DatabaseName',
  'DatabaseInstanceClass',
  'DatabaseAllocatedStorageGiB',
  'PostgresEngineVersion',
  'DatabaseDeletionProtection',
  'EnableDatabaseMultiAz',
  'RedisNodeType',
  'EnableRedisReplica',
  'StatefulBackupRetentionDays',
  'SqsMaxReceiveCount',
  'SqsVisibilityTimeoutSeconds',
  'LogRetentionDays',
  'EnableOperationalAlarms',
  'EnableOperationalDashboard',
  'EnableContainerInsights',
];

const OBJECT_KEYS = {
  aws: ['accountId', 'region'],
  target: ['environmentName', 'stackName', 'changeSetName', 'changeSetType'],
  artifact: [
    'sourceRevision',
    'apiImageUri',
    'webImageUri',
    'workerImageUri',
    'buildEvidenceSha256',
    'provenanceReference',
  ],
  parameters: RELEASE_PARAMETER_NAMES,
  gates: [
    'continuousIntegration',
    'unitTests',
    'integrationTests',
    'migrationValidation',
    'reproducibleBuild',
    'artifactVersioning',
    'evidenceReference',
  ],
  rollback: [
    'intent',
    'fromApplicationVersion',
    'priorReleaseRecordSha256',
    'parameterDifferences',
    'databaseCompatibility',
    'evidenceReference',
  ],
  authority: ['deploymentApprovers', 'rollbackApprovers'],
  independentVerification: ['verifier', 'decision', 'verifiedAt'],
};

const ROLLBACK_PARAMETER_DIFFERENCE_KEYS = [
  'parameterName',
  'priorValue',
  'rollbackValue',
  'justification',
];
const ROLLBACK_CAPACITY_PARAMETERS = new Set([
  'ApiDesiredCount',
  'WebDesiredCount',
  'WorkerDesiredCount',
]);

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/;
const STACK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,127}$/;
const ROLE_ALIAS_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const IMAGE_URI_PATTERN =
  /^(?<account>\d{12})\.dkr\.ecr\.(?<region>[a-z0-9-]+)\.(?<suffix>amazonaws\.com(?:\.cn)?)\/(?<repository>crypto-lending-[a-z0-9._/-]+)@sha256:(?<digest>[a-f0-9]{64})$/;
const CERTIFICATE_ARN_PATTERN =
  /^arn:(?<partition>aws|aws-us-gov|aws-cn):acm:(?<region>[a-z0-9-]+):(?<account>\d{12}):certificate\/[A-Za-z0-9-]+$/;
const SECRET_SHAPE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:password|private[_-]?key|secret[_-]?access[_-]?key|session[_-]?token)\s*[:=]/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortedJson(value[key])]),
  );
}

export function canonicalizeReleaseDeploymentControlRecord(record) {
  return JSON.stringify(sortedJson(record));
}

function assertExactKeys(value, expectedKeys, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required.`);
  }
  for (const key of Object.keys(value)) {
    if (!expectedKeys.includes(key)) errors.push(`${path}.${key} is not allowed.`);
  }
}

function assertReference(value, path, errors) {
  if (
    typeof value !== 'string' ||
    !REFERENCE_PATTERN.test(value) ||
    value.includes('@') ||
    /NOT_(?:APPROVED|RUN|APPLICABLE)/i.test(value)
  ) {
    errors.push(`${path} must be a stable non-secret reference.`);
  }
}

function assertRoleAlias(value, path, errors) {
  if (
    typeof value !== 'string' ||
    !ROLE_ALIAS_PATTERN.test(value) ||
    /^(?:admin|owner|security|team|unknown|unset|none|tbd)$/.test(value)
  ) {
    errors.push(`${path} must be a stable 3-64 character lowercase role alias.`);
  }
}

function assertRoleAliasArray(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must contain at least one approved role alias.`);
    return;
  }
  value.forEach((entry, index) => assertRoleAlias(entry, `${path}[${index}]`, errors));
  if (new Set(value).size !== value.length) errors.push(`${path} must not contain duplicates.`);
}

function parseInstant(value, path, errors) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    errors.push(`${path} must be a canonical ISO-8601 UTC instant with seconds.`);
    return undefined;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    errors.push(`${path} must be a real calendar instant.`);
    return undefined;
  }
  const normalized = new Date(timestamp).toISOString().replace(/\.000Z$/, 'Z');
  if (value.replace(/\.000Z$/, 'Z') !== normalized) {
    errors.push(`${path} must be a canonical real calendar instant.`);
    return undefined;
  }
  return new Date(timestamp);
}

function parseInteger(value, { path, minimum, maximum, allowed }, errors) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) {
    errors.push(`${path} must be a canonical non-negative integer string.`);
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(`${path} must be between ${minimum} and ${maximum}.`);
    return undefined;
  }
  if (allowed && !allowed.includes(parsed)) {
    errors.push(`${path} must be one of ${allowed.join(', ')}.`);
    return undefined;
  }
  return parsed;
}

function ipv4ToInteger(address) {
  return (
    address
      .split('.')
      .map(Number)
      .reduce((result, octet) => result * 256 + octet, 0) >>> 0
  );
}

function parseIpv4Cidr(value, path, errors, { minimumPrefix = 0, maximumPrefix = 32 } = {}) {
  if (typeof value !== 'string') {
    errors.push(`${path} must be an IPv4 CIDR string.`);
    return undefined;
  }
  const [address, prefixText, extra] = value.split('/');
  const prefix = Number(prefixText);
  if (
    extra !== undefined ||
    isIP(address) !== 4 ||
    !/^(?:0|[1-9]\d*)$/.test(prefixText ?? '') ||
    !Number.isInteger(prefix) ||
    prefix < minimumPrefix ||
    prefix > maximumPrefix
  ) {
    errors.push(`${path} must be a valid IPv4 CIDR with prefix ${minimumPrefix}-${maximumPrefix}.`);
    return undefined;
  }
  const addressInteger = ipv4ToInteger(address);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  if ((addressInteger & mask) >>> 0 !== addressInteger) {
    errors.push(`${path} must use the canonical network address for its prefix.`);
    return undefined;
  }
  return { address: addressInteger, mask, prefix };
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

function validateImageUri(value, path, record, expectedRepository, errors) {
  const match = typeof value === 'string' ? value.match(IMAGE_URI_PATTERN) : undefined;
  if (!match?.groups) {
    errors.push(`${path} must be a private ECR URI pinned by a sha256 digest.`);
    return;
  }
  if (match.groups.account !== record.aws.accountId || match.groups.region !== record.aws.region) {
    errors.push(`${path} must use the approved account and Region.`);
  }
  const expectedSuffix = record.aws.region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
  if (match.groups.suffix !== expectedSuffix) {
    errors.push(`${path} has the wrong ECR DNS suffix for the approved partition.`);
  }
  if (match.groups.repository !== expectedRepository) {
    errors.push(`${path} must use the exact '${expectedRepository}' ECR repository.`);
  }
}

function validateParameters(record, errors) {
  const parameters = record.parameters;
  for (const name of RELEASE_PARAMETER_NAMES) {
    if (typeof parameters[name] !== 'string' || parameters[name].length === 0) {
      errors.push(`record.parameters.${name} must be a non-empty explicit string.`);
    }
  }

  if (parameters.BillingAcknowledgement !== 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES') {
    errors.push(
      'record.parameters.BillingAcknowledgement must use the exact KAN-34 acknowledgement.',
    );
  }
  if (
    !ENVIRONMENT_PATTERN.test(parameters.EnvironmentName) ||
    parameters.EnvironmentName.length > 31
  ) {
    errors.push(
      'record.parameters.EnvironmentName must identify an explicit non-production environment.',
    );
  }
  if (parameters.EnvironmentName !== record.target.environmentName) {
    errors.push('record.parameters.EnvironmentName must equal record.target.environmentName.');
  }
  if (!COMMIT_PATTERN.test(parameters.ApplicationVersion)) {
    errors.push(
      'record.parameters.ApplicationVersion must be a lowercase 40-character source revision.',
    );
  }
  if (parameters.ApplicationVersion !== record.artifact.sourceRevision) {
    errors.push('record.parameters.ApplicationVersion must equal record.artifact.sourceRevision.');
  }

  for (const [parameterName, artifactName, repositoryName] of [
    ['ApiImageUri', 'apiImageUri', 'crypto-lending-api'],
    ['WebImageUri', 'webImageUri', 'crypto-lending-web'],
    ['WorkerImageUri', 'workerImageUri', 'crypto-lending-worker'],
  ]) {
    validateImageUri(
      parameters[parameterName],
      `record.parameters.${parameterName}`,
      record,
      repositoryName,
      errors,
    );
    if (parameters[parameterName] !== record.artifact[artifactName]) {
      errors.push(`record.parameters.${parameterName} must equal record.artifact.${artifactName}.`);
    }
  }

  if (!/^\/[A-Za-z0-9._/-]+$/.test(parameters.RdsCaBundlePath)) {
    errors.push('record.parameters.RdsCaBundlePath must be an absolute in-image path.');
  }

  const desiredCounts = ['ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount'].map((name) => [
    name,
    parseInteger(
      parameters[name],
      { path: `record.parameters.${name}`, minimum: 0, maximum: 10 },
      errors,
    ),
  ]);

  const vpc = parseIpv4Cidr(parameters.VpcCidr, 'record.parameters.VpcCidr', errors, {
    minimumPrefix: 16,
    maximumPrefix: 16,
  });
  const subnetNames = [
    'PublicSubnetACidr',
    'PublicSubnetBCidr',
    'PrivateSubnetACidr',
    'PrivateSubnetBCidr',
  ];
  const subnets = subnetNames.map((name) => [
    name,
    parseIpv4Cidr(parameters[name], `record.parameters.${name}`, errors, {
      minimumPrefix: 17,
      maximumPrefix: 28,
    }),
  ]);
  if (vpc) {
    for (const [name, subnet] of subnets) {
      if (subnet && (subnet.address & vpc.mask) >>> 0 !== vpc.address) {
        errors.push(`record.parameters.${name} must be contained within VpcCidr.`);
      }
    }
  }
  const parsedSubnets = subnets.filter(([, value]) => value);
  for (let leftIndex = 0; leftIndex < parsedSubnets.length; leftIndex += 1) {
    const [leftName, left] = parsedSubnets[leftIndex];
    const leftEnd = left.address + 2 ** (32 - left.prefix) - 1;
    for (let rightIndex = leftIndex + 1; rightIndex < parsedSubnets.length; rightIndex += 1) {
      const [rightName, right] = parsedSubnets[rightIndex];
      const rightEnd = right.address + 2 ** (32 - right.prefix) - 1;
      if (left.address <= rightEnd && right.address <= leftEnd) {
        errors.push(
          `record.parameters.${leftName} overlaps record.parameters.${rightName}; subnet CIDRs must be pairwise non-overlapping.`,
        );
      }
    }
  }

  if (!['VpcEndpoints', 'None'].includes(parameters.PrivateEgressMode)) {
    errors.push('record.parameters.PrivateEgressMode must equal VpcEndpoints or None.');
  }
  if (
    parameters.PrivateEgressMode === 'None' &&
    desiredCounts.some(([, count]) => count !== undefined && count !== 0)
  ) {
    errors.push('PrivateEgressMode None requires every desired count to equal 0.');
  }
  if (
    record.target.changeSetType === 'CREATE' &&
    desiredCounts.some(([, count]) => count !== undefined && count !== 0)
  ) {
    errors.push('CREATE release records require every desired count to equal 0.');
  }

  if (!/^pl-[a-f0-9]+$/.test(parameters.S3ManagedPrefixListId)) {
    errors.push(
      'record.parameters.S3ManagedPrefixListId must be an explicit managed prefix-list ID.',
    );
  }
  const ingress = parseIpv4Cidr(
    parameters.AllowedIngressIpv4Cidr,
    'record.parameters.AllowedIngressIpv4Cidr',
    errors,
    { minimumPrefix: 1, maximumPrefix: 32 },
  );
  if (ingress?.prefix === 0) errors.push('Public /0 ingress is prohibited.');

  const certificateMatch = parameters.AlbCertificateArn.match(CERTIFICATE_ARN_PATTERN);
  if (!certificateMatch?.groups) {
    errors.push('record.parameters.AlbCertificateArn must be an explicit ACM certificate ARN.');
  } else {
    const expectedPartition = record.aws.region.startsWith('cn-')
      ? 'aws-cn'
      : record.aws.region.startsWith('us-gov-')
        ? 'aws-us-gov'
        : 'aws';
    if (
      certificateMatch.groups.partition !== expectedPartition ||
      certificateMatch.groups.account !== record.aws.accountId ||
      certificateMatch.groups.region !== record.aws.region
    ) {
      errors.push(
        'record.parameters.AlbCertificateArn must use the approved partition, account, and Region.',
      );
    }
  }
  if (!HOSTNAME_PATTERN.test(parameters.ApplicationHostname)) {
    errors.push(
      'record.parameters.ApplicationHostname must be an exact lowercase non-production subdomain.',
    );
  }

  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(parameters.DatabaseName)) {
    errors.push('record.parameters.DatabaseName is invalid.');
  }
  if (
    !['db.t4g.micro', 'db.t4g.small', 'db.t4g.medium'].includes(parameters.DatabaseInstanceClass)
  ) {
    errors.push('record.parameters.DatabaseInstanceClass is outside the reviewed allowlist.');
  }
  parseInteger(
    parameters.DatabaseAllocatedStorageGiB,
    { path: 'record.parameters.DatabaseAllocatedStorageGiB', minimum: 20, maximum: 100 },
    errors,
  );
  if (!/^16\.\d{1,2}$/.test(parameters.PostgresEngineVersion)) {
    errors.push(
      'record.parameters.PostgresEngineVersion must select a PostgreSQL 16 minor version.',
    );
  }
  for (const name of [
    'DatabaseDeletionProtection',
    'EnableDatabaseMultiAz',
    'EnableRedisReplica',
    'EnableOperationalAlarms',
    'EnableOperationalDashboard',
  ]) {
    if (!['true', 'false'].includes(parameters[name])) {
      errors.push(`record.parameters.${name} must equal true or false.`);
    }
  }
  if (
    !['cache.t4g.micro', 'cache.t4g.small', 'cache.t4g.medium'].includes(parameters.RedisNodeType)
  ) {
    errors.push('record.parameters.RedisNodeType is outside the reviewed allowlist.');
  }
  parseInteger(
    parameters.StatefulBackupRetentionDays,
    { path: 'record.parameters.StatefulBackupRetentionDays', minimum: 1, maximum: 7 },
    errors,
  );
  parseInteger(
    parameters.SqsMaxReceiveCount,
    { path: 'record.parameters.SqsMaxReceiveCount', minimum: 1, maximum: 100 },
    errors,
  );
  parseInteger(
    parameters.SqsVisibilityTimeoutSeconds,
    { path: 'record.parameters.SqsVisibilityTimeoutSeconds', minimum: 1, maximum: 43200 },
    errors,
  );
  parseInteger(
    parameters.LogRetentionDays,
    {
      path: 'record.parameters.LogRetentionDays',
      minimum: 1,
      maximum: 90,
      allowed: [1, 3, 5, 7, 14, 30, 60, 90],
    },
    errors,
  );
  if (!['enabled', 'disabled'].includes(parameters.EnableContainerInsights)) {
    errors.push('record.parameters.EnableContainerInsights must equal enabled or disabled.');
  }
}

function validateExample(record, errors) {
  const mustEqual = (value, expected, path) => {
    if (value !== expected)
      errors.push(`${path} must remain ${expected} in the committed example.`);
  };
  mustEqual(record.status, 'NOT_APPROVED', 'record.status');
  mustEqual(record.recordId, 'NOT_APPROVED', 'record.recordId');
  mustEqual(record.approvedAt, 'NOT_RUN', 'record.approvedAt');
  mustEqual(record.expiresAt, 'NOT_APPROVED', 'record.expiresAt');
  mustEqual(record.action, 'NOT_APPROVED', 'record.action');
  mustEqual(record.templateSha256, 'NOT_APPROVED', 'record.templateSha256');
  for (const [path, value] of [
    ['record.aws.accountId', record.aws?.accountId],
    ['record.aws.region', record.aws?.region],
    ...OBJECT_KEYS.target.map((key) => [`record.target.${key}`, record.target?.[key]]),
    ...OBJECT_KEYS.artifact.map((key) => [`record.artifact.${key}`, record.artifact?.[key]]),
    ...RELEASE_PARAMETER_NAMES.map((key) => [`record.parameters.${key}`, record.parameters?.[key]]),
  ]) {
    mustEqual(value, 'NOT_APPROVED', path);
  }
  for (const key of OBJECT_KEYS.gates)
    mustEqual(record.gates?.[key], 'NOT_RUN', `record.gates.${key}`);
  for (const key of OBJECT_KEYS.rollback.filter((name) => name !== 'parameterDifferences')) {
    mustEqual(
      record.rollback?.[key],
      key === 'evidenceReference' ? 'NOT_RUN' : 'NOT_APPROVED',
      `record.rollback.${key}`,
    );
  }
  if (
    !Array.isArray(record.rollback?.parameterDifferences) ||
    record.rollback.parameterDifferences.length !== 0
  ) {
    errors.push('record.rollback.parameterDifferences must remain empty in the committed example.');
  }
  for (const key of OBJECT_KEYS.authority) {
    const value = record.authority?.[key];
    if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'NOT_APPROVED') {
      errors.push(
        `record.authority.${key} must contain only NOT_APPROVED in the committed example.`,
      );
    }
  }
  mustEqual(
    record.independentVerification?.verifier,
    'NOT_APPROVED',
    'record.independentVerification.verifier',
  );
  mustEqual(
    record.independentVerification?.decision,
    'NOT_APPROVED',
    'record.independentVerification.decision',
  );
  mustEqual(
    record.independentVerification?.verifiedAt,
    'NOT_RUN',
    'record.independentVerification.verifiedAt',
  );
}

function validateRollbackParameterDifferences(record, errors) {
  const differences = record.rollback.parameterDifferences;
  const byName = new Map();
  if (!Array.isArray(differences)) {
    errors.push('record.rollback.parameterDifferences must be an array.');
    return byName;
  }
  if (differences.length > ROLLBACK_CAPACITY_PARAMETERS.size) {
    errors.push('record.rollback.parameterDifferences may contain at most three entries.');
  }
  differences.forEach((difference, index) => {
    const path = `record.rollback.parameterDifferences[${index}]`;
    assertExactKeys(difference, ROLLBACK_PARAMETER_DIFFERENCE_KEYS, path, errors);
    if (!isPlainObject(difference)) return;
    const name = difference.parameterName;
    if (!ROLLBACK_CAPACITY_PARAMETERS.has(name)) {
      errors.push(
        `${path}.parameterName may only select an application service desired-count rollout knob.`,
      );
    } else if (byName.has(name)) {
      errors.push(`record.rollback.parameterDifferences must not repeat '${name}'.`);
    } else {
      byName.set(name, difference);
    }
    for (const valueName of ['priorValue', 'rollbackValue']) {
      if (typeof difference[valueName] !== 'string' || difference[valueName].length === 0) {
        errors.push(`${path}.${valueName} must be a non-empty explicit string.`);
      }
    }
    if (difference.justification !== 'CURRENT_ROLLOUT_CAPACITY') {
      errors.push(`${path}.justification must equal CURRENT_ROLLOUT_CAPACITY.`);
    }
    if (difference.priorValue === difference.rollbackValue) {
      errors.push(`${path} must describe a real parameter value difference.`);
    }
    if (
      typeof name === 'string' &&
      Object.hasOwn(record.parameters, name) &&
      difference.rollbackValue !== record.parameters[name]
    ) {
      errors.push(`${path}.rollbackValue must equal record.parameters.${name}.`);
    }
  });
  return byName;
}

function validateRollbackAgainstPriorRecord(record, priorRecord, options, differences, errors) {
  if (!isPlainObject(priorRecord)) {
    errors.push('ROLLBACK validation requires a local --prior-record DEPLOY control record.');
    return undefined;
  }

  const priorResult = validateReleaseDeploymentControlRecord(priorRecord, {
    mode: 'approved',
    now: options.now,
    allowExpiredApproval: true,
    expectedAccount: record.aws.accountId,
    expectedRegion: record.aws.region,
    expectedEnvironment: record.target.environmentName,
    expectedStack: record.target.stackName,
  });
  if (!priorResult.ok) {
    priorResult.errors.forEach((error) => errors.push(`Prior DEPLOY record: ${error}`));
  }
  if (priorRecord.action !== 'DEPLOY') {
    errors.push('The prior release control record must be an approved DEPLOY record.');
  }
  if (priorResult.canonicalSha256 !== record.rollback.priorReleaseRecordSha256) {
    errors.push(
      'The local prior DEPLOY record canonical SHA-256 does not match rollback.priorReleaseRecordSha256.',
    );
  }

  for (const name of [
    'sourceRevision',
    'apiImageUri',
    'webImageUri',
    'workerImageUri',
    'buildEvidenceSha256',
    'provenanceReference',
  ]) {
    if (record.artifact?.[name] !== priorRecord.artifact?.[name]) {
      errors.push(`ROLLBACK record.artifact.${name} must equal the prior DEPLOY record.`);
    }
  }

  for (const name of RELEASE_PARAMETER_NAMES) {
    const priorValue = priorRecord.parameters?.[name];
    const rollbackValue = record.parameters?.[name];
    const difference = differences.get(name);
    if (priorValue === rollbackValue) {
      if (difference) {
        errors.push(
          `record.rollback.parameterDifferences includes '${name}', but its prior and rollback values are equal.`,
        );
      }
      continue;
    }
    if (!difference) {
      errors.push(
        `ROLLBACK parameter '${name}' must equal the prior DEPLOY record or have one approved rollout-capacity difference.`,
      );
      continue;
    }
    if (difference.priorValue !== priorValue || difference.rollbackValue !== rollbackValue) {
      errors.push(
        `record.rollback.parameterDifferences entry '${name}' does not bind the exact prior and rollback values.`,
      );
    }
  }

  return {
    canonicalSha256: priorResult.canonicalSha256,
    recordId: priorRecord.recordId,
    artifact: priorRecord.artifact,
    parameters: priorRecord.parameters,
  };
}

function validateApproved(record, options, errors) {
  if (record.status !== 'APPROVED') errors.push('record.status must equal APPROVED.');
  if (!['DEPLOY', 'ROLLBACK'].includes(record.action)) {
    errors.push('record.action must equal DEPLOY or ROLLBACK.');
  }
  assertReference(record.recordId, 'record.recordId', errors);
  if (!SHA256_PATTERN.test(record.templateSha256)) {
    errors.push('record.templateSha256 must be a lowercase SHA-256 digest.');
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const approvedAt = parseInstant(record.approvedAt, 'record.approvedAt', errors);
  const expiresAt = parseInstant(record.expiresAt, 'record.expiresAt', errors);
  if (approvedAt && approvedAt > now) errors.push('record.approvedAt must not be in the future.');
  if (expiresAt && expiresAt <= now && !options.allowExpiredApproval) {
    errors.push('record.expiresAt must be in the future.');
  }
  if (approvedAt && expiresAt && approvedAt >= expiresAt) {
    errors.push('record.approvedAt must precede record.expiresAt.');
  }

  if (!/^\d{12}$/.test(record.aws.accountId)) {
    errors.push('record.aws.accountId must contain exactly 12 digits.');
  }
  if (!REGION_PATTERN.test(record.aws.region)) errors.push('record.aws.region must be explicit.');
  if (
    !ENVIRONMENT_PATTERN.test(record.target.environmentName) ||
    record.target.environmentName.length > 31
  ) {
    errors.push(
      'record.target.environmentName must identify an explicit non-production environment.',
    );
  }
  for (const name of ['stackName', 'changeSetName']) {
    if (!STACK_NAME_PATTERN.test(record.target[name])) {
      errors.push(`record.target.${name} must be an explicit CloudFormation-safe name.`);
    }
  }
  if (!['CREATE', 'UPDATE'].includes(record.target.changeSetType)) {
    errors.push('record.target.changeSetType must equal CREATE or UPDATE.');
  }

  if (!COMMIT_PATTERN.test(record.artifact.sourceRevision)) {
    errors.push('record.artifact.sourceRevision must be a lowercase 40-character Git revision.');
  }
  for (const [name, repositoryName] of [
    ['apiImageUri', 'crypto-lending-api'],
    ['webImageUri', 'crypto-lending-web'],
    ['workerImageUri', 'crypto-lending-worker'],
  ]) {
    validateImageUri(
      record.artifact[name],
      `record.artifact.${name}`,
      record,
      repositoryName,
      errors,
    );
  }
  if (!SHA256_PATTERN.test(record.artifact.buildEvidenceSha256)) {
    errors.push('record.artifact.buildEvidenceSha256 must be a lowercase SHA-256 digest.');
  }
  assertReference(
    record.artifact.provenanceReference,
    'record.artifact.provenanceReference',
    errors,
  );

  validateParameters(record, errors);

  for (const name of OBJECT_KEYS.gates.filter((key) => key !== 'evidenceReference')) {
    if (record.gates[name] !== 'PASS') errors.push(`record.gates.${name} must equal PASS.`);
  }
  assertReference(record.gates.evidenceReference, 'record.gates.evidenceReference', errors);

  const parameterDifferences = validateRollbackParameterDifferences(record, errors);
  let priorReleaseBinding;
  if (record.action === 'DEPLOY') {
    if (record.rollback.intent !== 'NONE') errors.push('DEPLOY requires rollback.intent NONE.');
    for (const name of [
      'fromApplicationVersion',
      'priorReleaseRecordSha256',
      'databaseCompatibility',
      'evidenceReference',
    ]) {
      if (record.rollback[name] !== 'NOT_APPLICABLE') {
        errors.push(`DEPLOY requires rollback.${name} NOT_APPLICABLE.`);
      }
    }
    if (
      !Array.isArray(record.rollback.parameterDifferences) ||
      record.rollback.parameterDifferences.length !== 0
    ) {
      errors.push('DEPLOY requires rollback.parameterDifferences to be empty.');
    }
    if (options.priorRecord !== undefined) {
      errors.push('DEPLOY validation must not supply a prior release control record.');
    }
  }
  if (record.action === 'ROLLBACK') {
    if (record.target.changeSetType !== 'UPDATE') {
      errors.push('ROLLBACK requires target.changeSetType UPDATE.');
    }
    if (record.rollback.intent !== 'REDEPLOY_PRIOR_VERSION') {
      errors.push('ROLLBACK requires rollback.intent REDEPLOY_PRIOR_VERSION.');
    }
    if (!COMMIT_PATTERN.test(record.rollback.fromApplicationVersion)) {
      errors.push('ROLLBACK requires a concrete rollback.fromApplicationVersion.');
    } else if (record.rollback.fromApplicationVersion === record.artifact.sourceRevision) {
      errors.push('ROLLBACK target source revision must differ from fromApplicationVersion.');
    }
    if (!SHA256_PATTERN.test(record.rollback.priorReleaseRecordSha256)) {
      errors.push('ROLLBACK requires the canonical prior release record SHA-256.');
    }
    if (
      !['NO_SCHEMA_CHANGE', 'BACKWARD_COMPATIBLE_SCHEMA'].includes(
        record.rollback.databaseCompatibility,
      )
    ) {
      errors.push('ROLLBACK requires an approved non-destructive database compatibility decision.');
    }
    assertReference(record.rollback.evidenceReference, 'record.rollback.evidenceReference', errors);
    priorReleaseBinding = validateRollbackAgainstPriorRecord(
      record,
      options.priorRecord,
      options,
      parameterDifferences,
      errors,
    );
  }

  for (const name of OBJECT_KEYS.authority) {
    assertRoleAliasArray(record.authority[name], `record.authority.${name}`, errors);
  }
  assertRoleAlias(
    record.independentVerification.verifier,
    'record.independentVerification.verifier',
    errors,
  );
  if (record.independentVerification.decision !== 'APPROVED') {
    errors.push('record.independentVerification.decision must equal APPROVED.');
  }
  const verifiedAt = parseInstant(
    record.independentVerification.verifiedAt,
    'record.independentVerification.verifiedAt',
    errors,
  );
  if (verifiedAt && verifiedAt > now) {
    errors.push('record.independentVerification.verifiedAt must not be in the future.');
  }
  const approvalRoles = new Set([
    ...(record.authority.deploymentApprovers ?? []),
    ...(record.authority.rollbackApprovers ?? []),
  ]);
  if (approvalRoles.has(record.independentVerification.verifier)) {
    errors.push(
      'The independent verifier must be distinct from deployment and rollback approvers.',
    );
  }

  const expectedValues = [
    ['account', options.expectedAccount, record.aws.accountId],
    ['Region', options.expectedRegion, record.aws.region],
    ['environment', options.expectedEnvironment, record.target.environmentName],
    ['stack', options.expectedStack, record.target.stackName],
    ['change set', options.expectedChangeSet, record.target.changeSetName],
    ['change-set type', options.expectedChangeSetType, record.target.changeSetType],
    ['template SHA-256', options.expectedTemplateSha256, record.templateSha256],
  ];
  for (const [label, expected, actual] of expectedValues) {
    if (expected !== undefined && expected !== actual) {
      errors.push(`The approved ${label} '${actual}' does not match '${expected}'.`);
    }
  }
  return priorReleaseBinding;
}

export function validateReleaseDeploymentControlRecord(record, options = {}) {
  const errors = [];
  assertExactKeys(record, TOP_LEVEL_KEYS, 'record', errors);
  if (!isPlainObject(record)) return { ok: false, errors };
  for (const [key, keys] of Object.entries(OBJECT_KEYS)) {
    assertExactKeys(record[key], keys, `record.${key}`, errors);
  }
  if (record.schemaVersion !== 2) errors.push('record.schemaVersion must equal 2.');
  if (record.artifactType !== 'KAN_35_RELEASE_DEPLOYMENT_CONTROL') {
    errors.push('record.artifactType must equal KAN_35_RELEASE_DEPLOYMENT_CONTROL.');
  }
  let priorReleaseBinding;
  if (!['example', 'approved'].includes(options.mode ?? 'example')) {
    errors.push("Validation mode must equal 'example' or 'approved'.");
  } else if ((options.mode ?? 'example') === 'example') {
    validateExample(record, errors);
  } else if (errors.length === 0) {
    priorReleaseBinding = validateApproved(record, options, errors);
  }
  inspectForSecrets(record, 'record', errors);

  const canonical = canonicalizeReleaseDeploymentControlRecord(record);
  const canonicalSha256 = createHash('sha256').update(canonical, 'utf8').digest('hex');
  if ((options.mode ?? 'example') === 'approved' && options.expectedRecordSha256 !== undefined) {
    if (!SHA256_PATTERN.test(options.expectedRecordSha256)) {
      errors.push('The independently supplied expected record SHA-256 must be lowercase hex.');
    } else if (canonicalSha256 !== options.expectedRecordSha256) {
      errors.push(
        'The canonical release control record SHA-256 does not match the expected digest.',
      );
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    canonicalSha256,
    priorReleaseBinding,
  };
}

function assertLocalRecordPath(path, argumentName = '--record') {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error(`${argumentName} is required.`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^(?:\\\\|\/\/|\\\\[?.]\\)/.test(path)) {
    throw new Error(
      `${argumentName} must be a local filesystem path, not a URI or network/device path.`,
    );
  }
  const absolute = resolve(path);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`${argumentName} must not be a symbolic link.`);
  if (!info.isFile()) throw new Error(`${argumentName} must identify a regular local file.`);
  return absolute;
}

function parseArguments(argv) {
  const result = { mode: 'example', json: false };
  const names = {
    '--record': 'record',
    '--prior-record': 'priorRecordPath',
    '--mode': 'mode',
    '--expected-account': 'expectedAccount',
    '--expected-region': 'expectedRegion',
    '--expected-environment': 'expectedEnvironment',
    '--expected-stack': 'expectedStack',
    '--expected-change-set': 'expectedChangeSet',
    '--expected-change-set-type': 'expectedChangeSetType',
    '--expected-template-sha256': 'expectedTemplateSha256',
    '--expected-record-sha256': 'expectedRecordSha256',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') result.json = true;
    else if (argument === '--now') {
      const value = argv[++index];
      result.now = new Date(value);
      if (!Number.isFinite(result.now.getTime())) throw new Error('--now must be a valid instant.');
    } else if (names[argument]) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${argument}.`);
      result[names[argument]] = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

function runCli() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    options.record = assertLocalRecordPath(options.record, '--record');
    if (options.priorRecordPath !== undefined) {
      options.priorRecordPath = assertLocalRecordPath(options.priorRecordPath, '--prior-record');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\nExternal calls made: 0\n`);
    process.exitCode = 2;
    return;
  }

  let record;
  try {
    record = JSON.parse(readFileSync(options.record, 'utf8'));
  } catch (error) {
    process.stderr.write(`Unable to parse KAN-35 control record: ${error.message}\n`);
    process.stderr.write('External calls made: 0\n');
    process.exitCode = 1;
    return;
  }

  if (options.priorRecordPath !== undefined) {
    try {
      options.priorRecord = JSON.parse(readFileSync(options.priorRecordPath, 'utf8'));
    } catch (error) {
      process.stderr.write(
        `Unable to parse KAN-35 prior DEPLOY control record: ${error.message}\n`,
      );
      process.stderr.write('External calls made: 0\n');
      process.exitCode = 1;
      return;
    }
  }

  const result = validateReleaseDeploymentControlRecord(record, options);
  const output = {
    ...result,
    mode: options.mode,
    record: options.record,
    priorRecord: options.priorRecordPath,
    externalCallsMade: 0,
    awsCallsMade: 0,
    registryCallsMade: 0,
    resourcesCreated: 0,
    binding: result.ok
      ? {
          recordId: record.recordId,
          action: record.action,
          templateSha256: record.templateSha256,
          accountId: record.aws.accountId,
          region: record.aws.region,
          environmentName: record.target.environmentName,
          stackName: record.target.stackName,
          changeSetName: record.target.changeSetName,
          changeSetType: record.target.changeSetType,
          artifact: record.artifact,
          parameters: record.parameters,
          rollback: record.rollback,
          priorRelease: result.priorReleaseBinding ?? null,
        }
      : undefined,
    assurance:
      'Canonical SHA-256 cross-artifact binding only; not a digital signature, registry attestation, deployment result, or spending authorization.',
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else if (output.ok) {
    process.stdout.write(
      `KAN-35 ${options.mode} release/deployment control record valid.\nCanonical record SHA-256: ${output.canonicalSha256}\nExternal calls made: 0\n`,
    );
  } else {
    process.stderr.write('KAN-35 release/deployment control record validation failed:\n');
    output.errors.forEach((error) => process.stderr.write(`- ${error}\n`));
    process.stderr.write('External calls made: 0\n');
  }
  process.exitCode = output.ok ? 0 : 1;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) runCli();
