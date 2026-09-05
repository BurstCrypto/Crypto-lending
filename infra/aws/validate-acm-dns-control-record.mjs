import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

export const MAX_ACM_DNS_CONTROL_RECORD_BYTES = 32_768;
export const ACM_DNS_CONTROL_RECORD_INPUT_ERROR =
  'ACM/DNS control record must be a non-empty, stable, single-link regular file of at most 32768 bytes at a canonical local path containing strict UTF-8 JSON without a byte-order mark or duplicate object keys.';

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'status',
  'recordId',
  'approvedAt',
  'expiresAt',
  'aws',
  'hostname',
  'certificate',
  'dnsChange',
  'costBoundary',
  'authority',
  'independentVerification',
  'evidence',
];

const OBJECT_KEYS = {
  aws: ['accountId', 'region', 'approvedRoleArn'],
  hostname: [
    'applicationHostname',
    'parentDomain',
    'dnsProvider',
    'dnsZoneMode',
    'existingZoneReference',
    'ownershipReference',
  ],
  certificate: [
    'mode',
    'validationMethod',
    'certificateArn',
    'subjectAlternativeNames',
    'certificateStatus',
    'notAfterUtc',
    'sha256Fingerprint',
    'renewalOwner',
    'renewalMethod',
    'renewalWindowDays',
  ],
  dnsChange: [
    'recordType',
    'ttlSeconds',
    'applicationLoadBalancerArn',
    'targetLoadBalancerDnsName',
    'targetLoadBalancerCanonicalHostedZoneId',
    'previousRecordValue',
    'previousTtlSeconds',
    'rollbackDeadlineUtc',
  ],
  costBoundary: [
    'decision',
    'domainRegistration',
    'hostedZoneCreation',
    'exportableCertificate',
    'privateCertificateAuthority',
    'paidMonitoring',
    'estimatedMonthlyIncrementUsd',
    'pricingAsOf',
    'pricingExpiresAt',
    'pricingSourceReference',
  ],
  authority: [
    'certificateRequestApprovers',
    'dnsChangeApprovers',
    'cutoverApprovers',
    'rollbackApprovers',
  ],
  independentVerification: ['verifier', 'decision', 'verifiedAt'],
  evidence: [
    'hostnameOwnership',
    'certificateIssued',
    'dnsValidation',
    'dnsCutover',
    'tlsChainAndHostname',
    'httpRedirect',
    'unexpectedHostRejected',
    'expirationMonitoring',
    'rollbackDrill',
    'observedAtUtc',
    'evidenceIndexReference',
  ],
};

const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const ROLE_ALIAS_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,127}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CERTIFICATE_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):acm:([a-z0-9-]+):(\d{12}):certificate\/[A-Za-z0-9-]+$/;
const ROLE_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):iam::(\d{12}):role\/[A-Za-z0-9+=,.@_/-]{1,512}$/;
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

export function canonicalizeAcmDnsControlRecord(record) {
  return JSON.stringify(sortedJson(record));
}

export function canonicalizeAcmDnsConfiguration(record) {
  return JSON.stringify(
    sortedJson({
      schemaVersion: record?.schemaVersion,
      recordId: record?.recordId,
      aws: record?.aws,
      hostname: record?.hostname,
      certificate: {
        mode: record?.certificate?.mode,
        validationMethod: record?.certificate?.validationMethod,
        renewalOwner: record?.certificate?.renewalOwner,
        renewalMethod: record?.certificate?.renewalMethod,
        renewalWindowDays: record?.certificate?.renewalWindowDays,
      },
      dnsChange: {
        recordType: record?.dnsChange?.recordType,
        ttlSeconds: record?.dnsChange?.ttlSeconds,
      },
      costBoundary: record?.costBoundary,
    }),
  );
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
  if (typeof value !== 'string' || !REFERENCE_PATTERN.test(value) || value.includes('@')) {
    errors.push(`${path} must be a non-secret reference, not an email address.`);
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
  if (new Set(value).size !== value.length) errors.push(`${path} contains duplicate aliases.`);
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
  const inputWithoutMilliseconds = value.replace(/\.000Z$/, 'Z');
  const normalizedWithoutMilliseconds = normalized.replace(/\.000Z$/, 'Z');
  if (inputWithoutMilliseconds !== normalizedWithoutMilliseconds) {
    errors.push(`${path} is not a canonical real calendar instant.`);
    return undefined;
  }
  return new Date(timestamp);
}

function parseDate(value, path, errors) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    errors.push(`${path} must be an ISO-8601 calendar date.`);
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${path} is not a real calendar date.`);
    return undefined;
  }
  return parsed;
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

function validateConcreteRecord(record, options, errors) {
  if (record.status !== 'APPROVED') errors.push('record.status must be APPROVED.');
  assertReference(record.recordId, 'record.recordId', errors);

  const approvedAt = parseInstant(record.approvedAt, 'record.approvedAt', errors);
  const expiresAt = parseInstant(record.expiresAt, 'record.expiresAt', errors);
  const now = options.now instanceof Date ? options.now : new Date();
  if (approvedAt && approvedAt > now) errors.push('record.approvedAt must not be in the future.');
  if (expiresAt && expiresAt <= now) errors.push('record.expiresAt must be in the future.');
  if (approvedAt && expiresAt && approvedAt >= expiresAt) {
    errors.push('record.approvedAt must precede record.expiresAt.');
  }

  if (!/^\d{12}$/.test(record.aws.accountId)) {
    errors.push('record.aws.accountId must contain exactly 12 digits.');
  }
  if (!REGION_PATTERN.test(record.aws.region)) {
    errors.push('record.aws.region must be an AWS Region identifier.');
  }
  if (options.expectedAccount && record.aws.accountId !== options.expectedAccount) {
    errors.push('record.aws.accountId does not match the expected account.');
  }
  if (options.expectedRegion && record.aws.region !== options.expectedRegion) {
    errors.push('record.aws.region does not match the expected Region.');
  }
  const roleArn = ROLE_ARN_PATTERN.exec(record.aws.approvedRoleArn);
  if (!roleArn || roleArn[2] !== record.aws.accountId) {
    errors.push('record.aws.approvedRoleArn must be a role in the approved account.');
  }

  const applicationHostname = record.hostname.applicationHostname;
  const parentDomain = record.hostname.parentDomain;
  if (!HOSTNAME_PATTERN.test(applicationHostname) || applicationHostname.includes('*')) {
    errors.push('record.hostname.applicationHostname must be one exact lowercase hostname.');
  }
  if (!HOSTNAME_PATTERN.test(parentDomain) || parentDomain.includes('*')) {
    errors.push('record.hostname.parentDomain must be one exact lowercase parent domain.');
  }
  if (
    typeof applicationHostname === 'string' &&
    typeof parentDomain === 'string' &&
    !applicationHostname.endsWith(`.${parentDomain}`)
  ) {
    errors.push('record.hostname.applicationHostname must be a subdomain of parentDomain.');
  }
  assertReference(record.hostname.dnsProvider, 'record.hostname.dnsProvider', errors);
  assertReference(
    record.hostname.existingZoneReference,
    'record.hostname.existingZoneReference',
    errors,
  );
  assertReference(record.hostname.ownershipReference, 'record.hostname.ownershipReference', errors);
  if (!['EXISTING_EXTERNAL', 'EXISTING_ROUTE53'].includes(record.hostname.dnsZoneMode)) {
    errors.push('record.hostname.dnsZoneMode must use an existing approved DNS zone.');
  }
  if (
    record.hostname.dnsZoneMode === 'EXISTING_ROUTE53' &&
    !/^Z[A-Z0-9]{1,31}$/.test(record.hostname.existingZoneReference)
  ) {
    errors.push('An existing Route 53 zone requires its exact hosted-zone ID.');
  }

  if (record.certificate.mode !== 'ACM_INTEGRATED_NON_EXPORTABLE') {
    errors.push('record.certificate.mode must be ACM_INTEGRATED_NON_EXPORTABLE.');
  }
  if (record.certificate.validationMethod !== 'DNS') {
    errors.push('record.certificate.validationMethod must be DNS.');
  }
  assertRoleAlias(record.certificate.renewalOwner, 'record.certificate.renewalOwner', errors);
  if (record.certificate.renewalMethod !== 'AWS_MANAGED') {
    errors.push('record.certificate.renewalMethod must be AWS_MANAGED.');
  }
  const renewalWindowDays = Number(record.certificate.renewalWindowDays);
  if (
    typeof record.certificate.renewalWindowDays !== 'string' ||
    !/^\d+$/.test(record.certificate.renewalWindowDays) ||
    renewalWindowDays < 1 ||
    renewalWindowDays > 90
  ) {
    errors.push(
      'record.certificate.renewalWindowDays must be an integer string from 1 through 90.',
    );
  }

  if (!['A_ALIAS', 'CNAME'].includes(record.dnsChange.recordType)) {
    errors.push('record.dnsChange.recordType must be A_ALIAS or CNAME.');
  }
  if (
    record.hostname.dnsZoneMode === 'EXISTING_ROUTE53' &&
    record.dnsChange.recordType !== 'A_ALIAS'
  ) {
    errors.push('An existing Route 53 zone must use an A_ALIAS record for the load balancer.');
  }
  if (record.hostname.dnsZoneMode === 'EXISTING_ROUTE53') {
    if (record.dnsChange.ttlSeconds !== 'NOT_APPLICABLE') {
      errors.push('A Route 53 ALB alias requires ttlSeconds NOT_APPLICABLE.');
    }
  } else {
    const ttl = Number(record.dnsChange.ttlSeconds);
    if (
      typeof record.dnsChange.ttlSeconds !== 'string' ||
      !/^\d+$/.test(record.dnsChange.ttlSeconds) ||
      ttl < 60 ||
      ttl > 86400
    ) {
      errors.push(
        'An external DNS record requires ttlSeconds as an integer string from 60 through 86400.',
      );
    }
  }

  if (record.costBoundary.decision !== 'NO_ADDITIONAL_CHARGE_CONFIRMED') {
    errors.push('record.costBoundary.decision must confirm no additional charge.');
  }
  for (const key of OBJECT_KEYS.costBoundary.filter((key) => key !== 'decision')) {
    if (
      [
        'estimatedMonthlyIncrementUsd',
        'pricingAsOf',
        'pricingExpiresAt',
        'pricingSourceReference',
      ].includes(key)
    ) {
      continue;
    }
    if (record.costBoundary[key] !== 'NOT_AUTHORIZED') {
      errors.push(`record.costBoundary.${key} must remain NOT_AUTHORIZED.`);
    }
  }
  if (record.costBoundary.estimatedMonthlyIncrementUsd !== '0.00') {
    errors.push('record.costBoundary.estimatedMonthlyIncrementUsd must be 0.00.');
  }
  const pricingAsOf = parseDate(
    record.costBoundary.pricingAsOf,
    'record.costBoundary.pricingAsOf',
    errors,
  );
  const pricingExpiresAt = parseDate(
    record.costBoundary.pricingExpiresAt,
    'record.costBoundary.pricingExpiresAt',
    errors,
  );
  if (pricingAsOf && pricingExpiresAt && pricingAsOf >= pricingExpiresAt) {
    errors.push('record.costBoundary.pricingAsOf must precede pricingExpiresAt.');
  }
  if (pricingAsOf && pricingAsOf > now) {
    errors.push('record.costBoundary.pricingAsOf must not be in the future.');
  }
  if (pricingExpiresAt && pricingExpiresAt <= now) {
    errors.push('record.costBoundary.pricingExpiresAt must be in the future.');
  }
  assertReference(
    record.costBoundary.pricingSourceReference,
    'record.costBoundary.pricingSourceReference',
    errors,
  );

  for (const key of OBJECT_KEYS.authority) {
    assertRoleAliasArray(record.authority[key], `record.authority.${key}`, errors);
  }
  assertRoleAlias(
    record.independentVerification.verifier,
    'record.independentVerification.verifier',
    errors,
  );
  if (record.independentVerification.decision !== 'APPROVED') {
    errors.push('record.independentVerification.decision must be APPROVED.');
  }
  const verifiedAt = parseInstant(
    record.independentVerification.verifiedAt,
    'record.independentVerification.verifiedAt',
    errors,
  );
  if (verifiedAt && verifiedAt > now) {
    errors.push('record.independentVerification.verifiedAt must not be in the future.');
  }
  if (approvedAt && verifiedAt && verifiedAt < approvedAt) {
    errors.push('Independent verification must not precede the current stage approval.');
  }
  const authorityAliases = OBJECT_KEYS.authority.flatMap((key) => record.authority[key] ?? []);
  if (authorityAliases.includes(record.independentVerification.verifier)) {
    errors.push('The independent verifier must not also be an approver.');
  }
}

function assertIssuedCertificate(record, options, errors) {
  const certificateArn = CERTIFICATE_ARN_PATTERN.exec(record.certificate.certificateArn);
  const roleArn = ROLE_ARN_PATTERN.exec(record.aws.approvedRoleArn);
  if (
    !certificateArn ||
    certificateArn[2] !== record.aws.region ||
    certificateArn[3] !== record.aws.accountId ||
    (roleArn && certificateArn[1] !== roleArn[1])
  ) {
    errors.push(
      'record.certificate.certificateArn must match the approved partition, account, and Region.',
    );
  }
  if (record.certificate.certificateStatus !== 'ISSUED') {
    errors.push('An issued-certificate stage requires certificateStatus ISSUED.');
  }
  if (
    !Array.isArray(record.certificate.subjectAlternativeNames) ||
    record.certificate.subjectAlternativeNames.length !== 1 ||
    record.certificate.subjectAlternativeNames[0] !== record.hostname.applicationHostname
  ) {
    errors.push('Certificate SANs must contain only the exact applicationHostname.');
  }
  const notAfter = parseInstant(
    record.certificate.notAfterUtc,
    'record.certificate.notAfterUtc',
    errors,
  );
  const now = options.now instanceof Date ? options.now : new Date();
  if (notAfter && notAfter <= now)
    errors.push('record.certificate.notAfterUtc must be in the future.');
  const minimumValidityMilliseconds = Number(record.certificate.renewalWindowDays) * 86_400_000;
  if (notAfter && notAfter.getTime() <= now.getTime() + minimumValidityMilliseconds) {
    errors.push('The certificate must remain valid beyond the approved renewal window.');
  }
  if (!/^[a-f0-9]{64}$/.test(record.certificate.sha256Fingerprint)) {
    errors.push('record.certificate.sha256Fingerprint must be a lowercase SHA-256 fingerprint.');
  }
}

function assertLoadBalancerTarget(record, mode, options, errors) {
  const loadBalancerArn = new RegExp(
    `^arn:(?:aws|aws-us-gov|aws-cn):elasticloadbalancing:${record.aws.region}:${record.aws.accountId}:loadbalancer/app/[A-Za-z0-9-]+/[a-f0-9]+$`,
  );
  if (!loadBalancerArn.test(record.dnsChange.applicationLoadBalancerArn)) {
    errors.push(`${mode} mode requires an ALB ARN in the approved account and Region.`);
  }
  if (!HOSTNAME_PATTERN.test(record.dnsChange.targetLoadBalancerDnsName)) {
    errors.push(`${mode} mode requires the exact load-balancer DNS target.`);
  }
  if (!/^Z[A-Z0-9]{1,31}$/.test(record.dnsChange.targetLoadBalancerCanonicalHostedZoneId)) {
    errors.push(`${mode} mode requires the load-balancer canonical hosted-zone ID.`);
  }
  if (
    record.dnsChange.previousRecordValue !== 'NO_PRIOR_RECORD' &&
    !HOSTNAME_PATTERN.test(record.dnsChange.previousRecordValue)
  ) {
    errors.push(`${mode} mode requires a prior DNS value or NO_PRIOR_RECORD.`);
  }
  if (record.dnsChange.previousRecordValue === 'NO_PRIOR_RECORD') {
    if (record.dnsChange.previousTtlSeconds !== 'NOT_APPLICABLE') {
      errors.push('A new DNS record requires previousTtlSeconds NOT_APPLICABLE.');
    }
  } else if (
    typeof record.dnsChange.previousTtlSeconds !== 'string' ||
    !/^[1-9]\d{0,4}$/.test(record.dnsChange.previousTtlSeconds)
  ) {
    errors.push('An existing DNS record requires its previous TTL in seconds.');
  }
  const rollbackDeadline = parseInstant(
    record.dnsChange.rollbackDeadlineUtc,
    'record.dnsChange.rollbackDeadlineUtc',
    errors,
  );
  const now = options.now instanceof Date ? options.now : new Date();
  if (mode === 'cutover' && rollbackDeadline && rollbackDeadline <= now) {
    errors.push('Cutover mode requires a future rollback deadline.');
  }
}

function assertEvidence(record, mode, options, errors) {
  const liveResults = OBJECT_KEYS.evidence.filter(
    (key) => !['observedAtUtc', 'evidenceIndexReference'].includes(key),
  );

  if (mode === 'authorization') {
    if (record.certificate.certificateArn !== 'NOT_RUN') {
      errors.push('Authorization mode must not claim an issued certificate.');
    }
    if (
      record.certificate.subjectAlternativeNames.length !== 1 ||
      record.certificate.subjectAlternativeNames[0] !== 'NOT_RUN' ||
      record.certificate.certificateStatus !== 'NOT_RUN' ||
      record.certificate.notAfterUtc !== 'NOT_RUN' ||
      record.certificate.sha256Fingerprint !== 'NOT_RUN'
    ) {
      errors.push('Authorization mode must not claim certificate observations.');
    }
    for (const key of [
      'applicationLoadBalancerArn',
      'previousRecordValue',
      'previousTtlSeconds',
      'rollbackDeadlineUtc',
    ]) {
      if (record.dnsChange[key] !== 'NOT_RUN') {
        errors.push(`Authorization mode requires record.dnsChange.${key} to be NOT_RUN.`);
      }
    }
    if (record.dnsChange.targetLoadBalancerDnsName !== 'NOT_RUN') {
      errors.push('Authorization mode must not claim a deployed load balancer.');
    }
    if (record.dnsChange.targetLoadBalancerCanonicalHostedZoneId !== 'NOT_RUN') {
      errors.push('Authorization mode must not claim a load-balancer hosted-zone ID.');
    }
    for (const key of liveResults) {
      if (record.evidence[key] !== 'NOT_RUN') {
        errors.push(`Authorization mode requires record.evidence.${key} to be NOT_RUN.`);
      }
    }
    if (
      record.evidence.observedAtUtc !== 'NOT_RUN' ||
      record.evidence.evidenceIndexReference !== 'NOT_RUN'
    ) {
      errors.push('Authorization mode must not include live evidence metadata.');
    }
    return;
  }

  assertIssuedCertificate(record, options, errors);

  for (const key of ['hostnameOwnership', 'certificateIssued', 'dnsValidation']) {
    if (record.evidence[key] !== 'PASS') {
      errors.push(`${mode} mode requires record.evidence.${key} to be PASS.`);
    }
  }
  const observedAt = parseInstant(
    record.evidence.observedAtUtc,
    'record.evidence.observedAtUtc',
    errors,
  );
  const now = options.now instanceof Date ? options.now : new Date();
  if (observedAt && observedAt > now) {
    errors.push('record.evidence.observedAtUtc must not be in the future.');
  }
  const approvedAt = parseInstant(record.approvedAt, 'record.approvedAt', []);
  const verifiedAt = parseInstant(
    record.independentVerification.verifiedAt,
    'record.independentVerification.verifiedAt',
    [],
  );
  if (observedAt && approvedAt && approvedAt < observedAt) {
    errors.push('The current stage approval must not precede its live evidence observation.');
  }
  if (observedAt && verifiedAt && verifiedAt < observedAt) {
    errors.push('Independent verification must not precede its live evidence observation.');
  }
  assertReference(
    record.evidence.evidenceIndexReference,
    'record.evidence.evidenceIndexReference',
    errors,
  );

  if (mode === 'bootstrap') {
    for (const key of [
      'applicationLoadBalancerArn',
      'targetLoadBalancerDnsName',
      'targetLoadBalancerCanonicalHostedZoneId',
      'previousRecordValue',
      'previousTtlSeconds',
      'rollbackDeadlineUtc',
    ]) {
      if (record.dnsChange[key] !== 'NOT_RUN') {
        errors.push(`Bootstrap mode requires record.dnsChange.${key} to be NOT_RUN.`);
      }
    }
    for (const key of liveResults.filter(
      (key) => !['hostnameOwnership', 'certificateIssued', 'dnsValidation'].includes(key),
    )) {
      if (record.evidence[key] !== 'NOT_RUN') {
        errors.push(`Bootstrap mode requires record.evidence.${key} to be NOT_RUN.`);
      }
    }
    return;
  }

  assertLoadBalancerTarget(record, mode, options, errors);
  if (mode === 'cutover') {
    for (const key of liveResults.filter(
      (key) => !['hostnameOwnership', 'certificateIssued', 'dnsValidation'].includes(key),
    )) {
      if (record.evidence[key] !== 'NOT_RUN') {
        errors.push(`Cutover mode requires record.evidence.${key} to be NOT_RUN.`);
      }
    }
    return;
  }
  for (const key of liveResults) {
    if (record.evidence[key] !== 'PASS') {
      errors.push(`Final mode requires record.evidence.${key} to be PASS.`);
    }
  }
}

export function validateAcmDnsControlRecord(record, options = {}) {
  const errors = [];
  const mode = options.mode ?? 'example';
  if (!['example', 'authorization', 'bootstrap', 'cutover', 'final'].includes(mode)) {
    return { ok: false, errors: [`Unsupported validation mode: ${mode}.`] };
  }

  assertExactKeys(record, TOP_LEVEL_KEYS, 'record', errors);
  for (const [key, expectedKeys] of Object.entries(OBJECT_KEYS)) {
    assertExactKeys(record?.[key], expectedKeys, `record.${key}`, errors);
  }
  inspectForSecrets(record, 'record', errors);
  if (record?.schemaVersion !== 1) errors.push('record.schemaVersion must equal 1.');

  if (mode === 'example') {
    if (record?.status !== 'NOT_APPROVED') errors.push('Example status must be NOT_APPROVED.');
    if (record?.recordId !== 'NOT_APPROVED') errors.push('Example recordId must be NOT_APPROVED.');
    for (const key of ['approvedAt', 'expiresAt']) {
      if (record?.[key] !== 'NOT_APPROVED') errors.push(`Example ${key} must be NOT_APPROVED.`);
    }
    for (const key of OBJECT_KEYS.aws) {
      if (record?.aws?.[key] !== 'NOT_APPROVED') {
        errors.push(`Example aws.${key} must be NOT_APPROVED.`);
      }
    }
    for (const key of OBJECT_KEYS.hostname) {
      if (record?.hostname?.[key] !== 'NOT_APPROVED') {
        errors.push(`Example hostname.${key} must be NOT_APPROVED.`);
      }
    }
    for (const key of [
      'mode',
      'validationMethod',
      'renewalOwner',
      'renewalMethod',
      'renewalWindowDays',
    ]) {
      if (record?.certificate?.[key] !== 'NOT_APPROVED') {
        errors.push(`Example certificate.${key} must be NOT_APPROVED.`);
      }
    }
    for (const key of ['certificateArn', 'certificateStatus', 'notAfterUtc', 'sha256Fingerprint']) {
      if (record?.certificate?.[key] !== 'NOT_RUN') {
        errors.push(`Example certificate.${key} must be NOT_RUN.`);
      }
    }
    if (
      !Array.isArray(record?.certificate?.subjectAlternativeNames) ||
      record.certificate.subjectAlternativeNames.length !== 1 ||
      record.certificate.subjectAlternativeNames[0] !== 'NOT_RUN'
    ) {
      errors.push('Example certificate.subjectAlternativeNames must contain only NOT_RUN.');
    }
    for (const key of ['recordType', 'ttlSeconds']) {
      if (record?.dnsChange?.[key] !== 'NOT_APPROVED') {
        errors.push(`Example dnsChange.${key} must be NOT_APPROVED.`);
      }
    }
    for (const key of OBJECT_KEYS.dnsChange.filter(
      (key) => !['recordType', 'ttlSeconds'].includes(key),
    )) {
      if (record?.dnsChange?.[key] !== 'NOT_RUN') {
        errors.push(`Example dnsChange.${key} must be NOT_RUN.`);
      }
    }
    for (const key of OBJECT_KEYS.costBoundary) {
      const expected = [
        'domainRegistration',
        'hostedZoneCreation',
        'exportableCertificate',
        'privateCertificateAuthority',
        'paidMonitoring',
      ].includes(key)
        ? 'NOT_AUTHORIZED'
        : 'NOT_APPROVED';
      if (record?.costBoundary?.[key] !== expected) {
        errors.push(`Example costBoundary.${key} must be ${expected}.`);
      }
    }
    for (const key of OBJECT_KEYS.authority) {
      if (
        !Array.isArray(record?.authority?.[key]) ||
        record.authority[key].length !== 1 ||
        record.authority[key][0] !== 'NOT_APPROVED'
      ) {
        errors.push(`Example authority.${key} must contain only NOT_APPROVED.`);
      }
    }
    if (
      record?.independentVerification?.verifier !== 'NOT_APPROVED' ||
      record?.independentVerification?.decision !== 'NOT_APPROVED' ||
      record?.independentVerification?.verifiedAt !== 'NOT_RUN'
    ) {
      errors.push('Example independent verification must remain NOT_APPROVED/NOT_RUN.');
    }
    for (const key of OBJECT_KEYS.evidence) {
      if (record?.evidence?.[key] !== 'NOT_RUN') {
        errors.push(`Example evidence.${key} must remain NOT_RUN.`);
      }
    }
  } else if (errors.length === 0) {
    validateConcreteRecord(record, options, errors);
    assertEvidence(record, mode, options, errors);
  }

  const canonical = canonicalizeAcmDnsControlRecord(record);
  const configuration = canonicalizeAcmDnsConfiguration(record);
  return {
    ok: errors.length === 0,
    errors,
    canonicalSha256: createHash('sha256').update(canonical).digest('hex'),
    configurationSha256: createHash('sha256').update(configuration).digest('hex'),
  };
}

function parseArguments(argv) {
  const result = { mode: 'example', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--record') result.record = argv[++index];
    else if (argument === '--mode') result.mode = argv[++index];
    else if (argument === '--expected-account') result.expectedAccount = argv[++index];
    else if (argument === '--expected-region') result.expectedRegion = argv[++index];
    else if (argument === '--now') {
      result.now = new Date(argv[++index]);
      if (!Number.isFinite(result.now.getTime())) throw new Error('--now must be a valid instant.');
    } else if (argument === '--json') result.json = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function loadAcmDnsControlRecordFileInternal(recordPath, afterFirstReadForTest) {
  try {
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(recordPath, MAX_ACM_DNS_CONTROL_RECORD_BYTES)
        : readSecureLocalFileForTest(
            recordPath,
            MAX_ACM_DNS_CONTROL_RECORD_BYTES,
            afterFirstReadForTest,
          );
    return parseStrictJsonBytes(bytes);
  } catch {
    throw new Error(ACM_DNS_CONTROL_RECORD_INPUT_ERROR);
  }
}

export function loadAcmDnsControlRecordFile(recordPath) {
  return loadAcmDnsControlRecordFileInternal(recordPath, undefined);
}

/** Test-only fault seam; production callers use loadAcmDnsControlRecordFile. */
export function loadAcmDnsControlRecordFileForTest(recordPath, afterFirstReadForTest) {
  return loadAcmDnsControlRecordFileInternal(recordPath, afterFirstReadForTest);
}

function runCli() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.record) throw new Error('--record is required.');
  const recordPath = resolve(args.record);
  let record;
  try {
    record = loadAcmDnsControlRecordFile(recordPath);
  } catch {
    process.stderr.write(`${ACM_DNS_CONTROL_RECORD_INPUT_ERROR}\nAWS API calls made: 0\n`);
    process.exitCode = 1;
    return;
  }
  const requestedMode = args.mode;
  if (requestedMode === 'prerequisite') {
    args.mode =
      record?.evidence?.dnsCutover === 'PASS'
        ? 'final'
        : record?.dnsChange?.applicationLoadBalancerArn !== 'NOT_RUN'
          ? 'cutover'
          : 'bootstrap';
  }
  const result = validateAcmDnsControlRecord(record, args);
  const output = {
    ...result,
    mode: args.mode,
    requestedMode,
    externalCallsMade: 0,
    awsCallsMade: 0,
    dnsQueriesMade: 0,
    tlsConnectionsMade: 0,
    providerCallsMade: 0,
    resourcesCreated: 0,
    binding: result.ok
      ? {
          recordId: record.recordId,
          accountId: record.aws.accountId,
          region: record.aws.region,
          applicationHostname: record.hostname.applicationHostname,
          certificateMode: record.certificate.mode,
          certificateArn: record.certificate.certificateArn,
          dnsZoneMode: record.hostname.dnsZoneMode,
        }
      : undefined,
  };
  if (args.json) {
    console.log(JSON.stringify(output));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (!result.ok) {
    console.error('KAN-230 control record validation failed:');
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`KAN-230 ${args.mode} control record valid.`);
  console.log(`Record SHA-256: ${result.canonicalSha256}`);
  console.log(`Configuration SHA-256: ${result.configurationSha256}`);
  console.log('External API calls made: 0');
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    runCli();
  } catch (error) {
    console.error(`KAN-230 control record validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
