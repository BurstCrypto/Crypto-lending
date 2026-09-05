import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ACM_DNS_CONTROL_RECORD_INPUT_ERROR,
  MAX_ACM_DNS_CONTROL_RECORD_BYTES,
  canonicalizeAcmDnsControlRecord,
  loadAcmDnsControlRecordFile,
  loadAcmDnsControlRecordFileForTest,
  validateAcmDnsControlRecord,
} from './validate-acm-dns-control-record.mjs';

const NOW = new Date('2026-08-19T18:00:00Z');
const validatorPath = join(import.meta.dirname, 'validate-acm-dns-control-record.mjs');
const exampleRecordPath = join(import.meta.dirname, 'acm-dns-control-record.example.json');

function withTemporaryRecord(contents, assertion) {
  const directory = mkdtempSync(join(tmpdir(), 'kan-230-acm-dns-input-'));
  const recordPath = join(directory, 'record.json');
  writeFileSync(recordPath, contents);
  try {
    assertion(recordPath, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertInputRejected(recordPath) {
  assert.throws(
    () => loadAcmDnsControlRecordFile(recordPath),
    (error) =>
      error instanceof Error &&
      error.message === ACM_DNS_CONTROL_RECORD_INPUT_ERROR &&
      !error.message.includes(recordPath),
  );
}

function skipUnsupportedLink(error, context) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM', 'UNKNOWN'].includes(error.code)
  ) {
    context.skip(`symbolic links are unavailable: ${error.code}`);
    return true;
  }
  return false;
}

function authorizationRecord() {
  return {
    schemaVersion: 1,
    status: 'APPROVED',
    recordId: 'jira:KAN-230/acm-dns-v1',
    approvedAt: '2026-08-19T12:00:00Z',
    expiresAt: '2026-11-19T12:00:00Z',
    aws: {
      accountId: '123456789012',
      region: 'us-west-2',
      approvedRoleArn: 'arn:aws:iam::123456789012:role/crypto-lending-deployer',
    },
    hostname: {
      applicationHostname: 'app.staging.example.com',
      parentDomain: 'example.com',
      dnsProvider: 'provider:existing-authoritative-dns',
      dnsZoneMode: 'EXISTING_EXTERNAL',
      existingZoneReference: 'dns-zone:example-com-existing',
      ownershipReference: 'evidence:domain-ownership-2026-08',
    },
    certificate: {
      mode: 'ACM_INTEGRATED_NON_EXPORTABLE',
      validationMethod: 'DNS',
      certificateArn: 'NOT_RUN',
      subjectAlternativeNames: ['NOT_RUN'],
      certificateStatus: 'NOT_RUN',
      notAfterUtc: 'NOT_RUN',
      sha256Fingerprint: 'NOT_RUN',
      renewalOwner: 'platform-operations',
      renewalMethod: 'AWS_MANAGED',
      renewalWindowDays: '45',
    },
    dnsChange: {
      recordType: 'CNAME',
      ttlSeconds: '300',
      applicationLoadBalancerArn: 'NOT_RUN',
      targetLoadBalancerDnsName: 'NOT_RUN',
      targetLoadBalancerCanonicalHostedZoneId: 'NOT_RUN',
      previousRecordValue: 'NOT_RUN',
      previousTtlSeconds: 'NOT_RUN',
      rollbackDeadlineUtc: 'NOT_RUN',
    },
    costBoundary: {
      decision: 'NO_ADDITIONAL_CHARGE_CONFIRMED',
      domainRegistration: 'NOT_AUTHORIZED',
      hostedZoneCreation: 'NOT_AUTHORIZED',
      exportableCertificate: 'NOT_AUTHORIZED',
      privateCertificateAuthority: 'NOT_AUTHORIZED',
      paidMonitoring: 'NOT_AUTHORIZED',
      estimatedMonthlyIncrementUsd: '0.00',
      pricingAsOf: '2026-08-19',
      pricingExpiresAt: '2026-11-19',
      pricingSourceReference: 'aws-pricing:acm-integrated-and-existing-dns',
    },
    authority: {
      certificateRequestApprovers: ['release-approver'],
      dnsChangeApprovers: ['dns-change-approver'],
      cutoverApprovers: ['release-approver', 'dns-change-approver'],
      rollbackApprovers: ['incident-commander'],
    },
    independentVerification: {
      verifier: 'external-security-reviewer',
      decision: 'APPROVED',
      verifiedAt: '2026-08-19T13:00:00Z',
    },
    evidence: {
      hostnameOwnership: 'NOT_RUN',
      certificateIssued: 'NOT_RUN',
      dnsValidation: 'NOT_RUN',
      dnsCutover: 'NOT_RUN',
      tlsChainAndHostname: 'NOT_RUN',
      httpRedirect: 'NOT_RUN',
      unexpectedHostRejected: 'NOT_RUN',
      expirationMonitoring: 'NOT_RUN',
      rollbackDrill: 'NOT_RUN',
      observedAtUtc: 'NOT_RUN',
      evidenceIndexReference: 'NOT_RUN',
    },
  };
}

function bootstrapRecord() {
  const record = authorizationRecord();
  record.approvedAt = '2026-08-19T14:30:00Z';
  record.certificate.certificateArn =
    'arn:aws:acm:us-west-2:123456789012:certificate/11111111-2222-3333-4444-555555555555';
  record.certificate.subjectAlternativeNames = ['app.staging.example.com'];
  record.certificate.certificateStatus = 'ISSUED';
  record.certificate.notAfterUtc = '2027-02-01T12:00:00Z';
  record.certificate.sha256Fingerprint = 'a'.repeat(64);
  record.evidence.hostnameOwnership = 'PASS';
  record.evidence.certificateIssued = 'PASS';
  record.evidence.dnsValidation = 'PASS';
  record.evidence.observedAtUtc = '2026-08-19T14:00:00Z';
  record.evidence.evidenceIndexReference = 'evidence:KAN-230/bootstrap-v1';
  record.independentVerification.verifiedAt = '2026-08-19T15:00:00Z';
  return record;
}

function cutoverRecord() {
  const record = bootstrapRecord();
  record.approvedAt = '2026-08-19T15:30:00Z';
  record.dnsChange.applicationLoadBalancerArn =
    'arn:aws:elasticloadbalancing:us-west-2:123456789012:loadbalancer/app/staging-app/0123456789abcdef';
  record.dnsChange.targetLoadBalancerDnsName = 'staging-app-1234567890.us-west-2.elb.amazonaws.com';
  record.dnsChange.targetLoadBalancerCanonicalHostedZoneId = 'Z1H1FL5HABSF5';
  record.dnsChange.previousRecordValue = 'NO_PRIOR_RECORD';
  record.dnsChange.previousTtlSeconds = 'NOT_APPLICABLE';
  record.dnsChange.rollbackDeadlineUtc = '2026-08-21T18:00:00Z';
  record.independentVerification.verifiedAt = '2026-08-19T16:00:00Z';
  return record;
}

function finalRecord() {
  const record = cutoverRecord();
  record.approvedAt = '2026-08-19T17:15:00Z';
  for (const key of [
    'dnsCutover',
    'tlsChainAndHostname',
    'httpRedirect',
    'unexpectedHostRejected',
    'expirationMonitoring',
    'rollbackDrill',
  ]) {
    record.evidence[key] = 'PASS';
  }
  record.evidence.observedAtUtc = '2026-08-19T17:00:00Z';
  record.independentVerification.verifiedAt = '2026-08-19T17:30:00Z';
  return record;
}

const expected = {
  expectedAccount: '123456789012',
  expectedRegion: 'us-west-2',
  now: NOW,
};

test('accepts the inert committed example without live claims', () => {
  const record = loadAcmDnsControlRecordFile(exampleRecordPath);
  const result = validateAcmDnsControlRecord(record, { mode: 'example' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('rejects top-level and nested duplicate keys whose last value appears safe', () => {
  const source = readFileSync(exampleRecordPath, 'utf8');
  const ambiguousRecords = [
    source.replace(
      '"status": "NOT_APPROVED",',
      '"status": "APPROVED",\n  "status": "NOT_APPROVED",',
    ),
    source.replace(
      '"accountId": "NOT_APPROVED",',
      '"accountId": "123456789012",\n    "accountId": "NOT_APPROVED",',
    ),
  ];

  for (const contents of ambiguousRecords) {
    withTemporaryRecord(contents, assertInputRejected);
  }
});

test('rejects BOM-prefixed and malformed UTF-8 JSON', () => {
  const bytes = readFileSync(exampleRecordPath);
  const hostileInputs = [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([0xff, 0x7d])]),
  ];

  for (const contents of hostileInputs) {
    withTemporaryRecord(contents, assertInputRejected);
  }
});

test('rejects empty, oversized, directory, and hard-linked record inputs', () => {
  withTemporaryRecord(Buffer.alloc(0), assertInputRejected);
  withTemporaryRecord(
    Buffer.alloc(MAX_ACM_DNS_CONTROL_RECORD_BYTES + 1, 0x20),
    assertInputRejected,
  );

  const directory = mkdtempSync(join(tmpdir(), 'kan-230-acm-dns-files-'));
  try {
    const directoryPath = join(directory, 'directory.json');
    mkdirSync(directoryPath);
    assertInputRejected(directoryPath);

    const sourcePath = join(directory, 'source.json');
    const linkedPath = join(directory, 'hard-link.json');
    writeFileSync(sourcePath, readFileSync(exampleRecordPath));
    linkSync(sourcePath, linkedPath);
    assertInputRejected(sourcePath);
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link record path when supported', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'kan-230-acm-dns-symlink-'));
  try {
    const targetPath = join(directory, 'target.json');
    const linkedPath = join(directory, 'linked.json');
    writeFileSync(targetPath, readFileSync(exampleRecordPath));
    try {
      symlinkSync(targetPath, linkedPath, 'file');
    } catch (error) {
      if (skipUnsupportedLink(error, context)) return;
      throw error;
    }
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a same-size rewrite during the stable descriptor read', () => {
  const original = readFileSync(exampleRecordPath);
  const replacement = Buffer.from(
    original.toString('utf8').replace('"schemaVersion": 1', '"schemaVersion": 2'),
    'utf8',
  );
  assert.equal(replacement.length, original.length);
  assert.notDeepEqual(replacement, original);

  withTemporaryRecord(original, (recordPath) => {
    assert.throws(
      () =>
        loadAcmDnsControlRecordFileForTest(recordPath, () => {
          writeFileSync(recordPath, replacement);
        }),
      (error) => error instanceof Error && error.message === ACM_DNS_CONTROL_RECORD_INPUT_ERROR,
    );
  });
});

test('CLI input failures use one fixed path-free surface and report zero AWS calls', () => {
  const source = readFileSync(exampleRecordPath, 'utf8').replace(
    '"status": "NOT_APPROVED",',
    '"status": "APPROVED",\n  "status": "NOT_APPROVED",',
  );

  withTemporaryRecord(source, (recordPath) => {
    const result = spawnSync(
      process.execPath,
      [validatorPath, '--record', recordPath, '--mode', 'example'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${ACM_DNS_CONTROL_RECORD_INPUT_ERROR}\nAWS API calls made: 0\n`);
    assert.equal(result.stderr.includes(recordPath), false);
  });
});

test('accepts each action-specific lifecycle stage', () => {
  for (const [mode, record] of [
    ['authorization', authorizationRecord()],
    ['bootstrap', bootstrapRecord()],
    ['cutover', cutoverRecord()],
    ['final', finalRecord()],
  ]) {
    const result = validateAcmDnsControlRecord(record, { ...expected, mode });
    assert.equal(result.ok, true, `${mode}: ${result.errors.join('\n')}`);
  }
});

test('keeps the configuration digest stable while evidence advances', () => {
  const authorization = validateAcmDnsControlRecord(authorizationRecord(), {
    ...expected,
    mode: 'authorization',
  });
  const final = validateAcmDnsControlRecord(finalRecord(), { ...expected, mode: 'final' });
  assert.equal(authorization.configurationSha256, final.configurationSha256);
  assert.notEqual(authorization.canonicalSha256, final.canonicalSha256);
  assert.notEqual(
    canonicalizeAcmDnsControlRecord(authorizationRecord()),
    canonicalizeAcmDnsControlRecord(finalRecord()),
  );
});

test('rejects unknown fields, secret-shaped data, and personal addresses', () => {
  const record = authorizationRecord();
  record.unreviewed = true;
  record.hostname.ownershipReference = 'reviewer@example.com';
  const result = validateAcmDnsControlRecord(record, { ...expected, mode: 'authorization' });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('unreviewed')));
  assert(result.errors.some((error) => error.includes('personal-address')));
});

test('rejects wildcards, apex reuse, IP-like values, and hostname escape', () => {
  for (const hostname of [
    '*.staging.example.com',
    'example.com',
    '127.0.0.1',
    'app.staging.example.net',
  ]) {
    const record = authorizationRecord();
    record.hostname.applicationHostname = hostname;
    const result = validateAcmDnsControlRecord(record, { ...expected, mode: 'authorization' });
    assert.equal(result.ok, false, hostname);
  }
});

test('rejects a certificate from the wrong account, Region, partition, or SAN', () => {
  const mutations = [
    (record) =>
      (record.certificate.certificateArn =
        'arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555'),
    (record) =>
      (record.certificate.certificateArn =
        'arn:aws:acm:us-west-2:999999999999:certificate/11111111-2222-3333-4444-555555555555'),
    (record) =>
      (record.certificate.certificateArn =
        'arn:aws-us-gov:acm:us-west-2:123456789012:certificate/11111111-2222-3333-4444-555555555555'),
    (record) => (record.certificate.subjectAlternativeNames = ['other.staging.example.com']),
  ];
  for (const mutate of mutations) {
    const record = bootstrapRecord();
    mutate(record);
    const result = validateAcmDnsControlRecord(record, { ...expected, mode: 'bootstrap' });
    assert.equal(result.ok, false);
  }
});

test('rejects expired certificates and invalid calendar dates', () => {
  const expired = bootstrapRecord();
  expired.certificate.notAfterUtc = '2026-08-18T12:00:00Z';
  assert.equal(validateAcmDnsControlRecord(expired, { ...expected, mode: 'bootstrap' }).ok, false);

  const impossible = authorizationRecord();
  impossible.costBoundary.pricingExpiresAt = '2026-02-30';
  assert.equal(
    validateAcmDnsControlRecord(impossible, { ...expected, mode: 'authorization' }).ok,
    false,
  );

  const futurePricing = authorizationRecord();
  futurePricing.costBoundary.pricingAsOf = '2026-08-20';
  assert.equal(
    validateAcmDnsControlRecord(futurePricing, {
      ...expected,
      mode: 'authorization',
    }).ok,
    false,
  );
});

test('rejects every paid or new-resource cost escape', () => {
  for (const key of [
    'domainRegistration',
    'hostedZoneCreation',
    'exportableCertificate',
    'privateCertificateAuthority',
    'paidMonitoring',
  ]) {
    const record = authorizationRecord();
    record.costBoundary[key] = 'AUTHORIZED';
    const result = validateAcmDnsControlRecord(record, { ...expected, mode: 'authorization' });
    assert.equal(result.ok, false, key);
  }
});

test('rejects sentinel approvers and a verifier who also approves', () => {
  const sentinel = authorizationRecord();
  sentinel.authority.dnsChangeApprovers = ['NOT_APPROVED'];
  assert.equal(
    validateAcmDnsControlRecord(sentinel, { ...expected, mode: 'authorization' }).ok,
    false,
  );

  const overlap = authorizationRecord();
  overlap.independentVerification.verifier = 'release-approver';
  const result = validateAcmDnsControlRecord(overlap, { ...expected, mode: 'authorization' });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('must not also be an approver')));
});

test('rejects premature or incomplete stage evidence', () => {
  const premature = authorizationRecord();
  premature.evidence.certificateIssued = 'PASS';
  assert.equal(
    validateAcmDnsControlRecord(premature, { ...expected, mode: 'authorization' }).ok,
    false,
  );

  const incomplete = cutoverRecord();
  incomplete.evidence.tlsChainAndHostname = 'PASS';
  assert.equal(validateAcmDnsControlRecord(incomplete, { ...expected, mode: 'cutover' }).ok, false);

  const failed = finalRecord();
  failed.evidence.rollbackDrill = 'FAIL';
  assert.equal(validateAcmDnsControlRecord(failed, { ...expected, mode: 'final' }).ok, false);

  const preApproved = bootstrapRecord();
  preApproved.approvedAt = '2026-08-19T13:30:00Z';
  preApproved.independentVerification.verifiedAt = '2026-08-19T13:45:00Z';
  const temporalResult = validateAcmDnsControlRecord(preApproved, {
    ...expected,
    mode: 'bootstrap',
  });
  assert.equal(temporalResult.ok, false);
  assert(temporalResult.errors.some((error) => error.includes('must not precede')));
});

test('rejects numeric values where the versioned schema requires strings', () => {
  const numericRenewal = authorizationRecord();
  numericRenewal.certificate.renewalWindowDays = 45;
  assert.equal(
    validateAcmDnsControlRecord(numericRenewal, {
      ...expected,
      mode: 'authorization',
    }).ok,
    false,
  );

  const numericTtl = authorizationRecord();
  numericTtl.dnsChange.ttlSeconds = 300;
  assert.equal(
    validateAcmDnsControlRecord(numericTtl, { ...expected, mode: 'authorization' }).ok,
    false,
  );
});

test('binds Route 53 mode to an A alias and validates the ALB target', () => {
  const wrongType = authorizationRecord();
  wrongType.hostname.dnsZoneMode = 'EXISTING_ROUTE53';
  wrongType.hostname.existingZoneReference = 'Z0123456789ABCDEF';
  wrongType.dnsChange.ttlSeconds = 'NOT_APPLICABLE';
  const result = validateAcmDnsControlRecord(wrongType, {
    ...expected,
    mode: 'authorization',
  });
  assert.equal(result.ok, false);

  const validAlias = authorizationRecord();
  validAlias.hostname.dnsZoneMode = 'EXISTING_ROUTE53';
  validAlias.hostname.existingZoneReference = 'Z0123456789ABCDEF';
  validAlias.dnsChange.recordType = 'A_ALIAS';
  validAlias.dnsChange.ttlSeconds = 'NOT_APPLICABLE';
  assert.equal(
    validateAcmDnsControlRecord(validAlias, { ...expected, mode: 'authorization' }).ok,
    true,
  );

  const missingZoneId = structuredClone(validAlias);
  missingZoneId.hostname.existingZoneReference = 'dns-zone:not-an-id';
  assert.equal(
    validateAcmDnsControlRecord(missingZoneId, {
      ...expected,
      mode: 'authorization',
    }).ok,
    false,
  );

  const aliasWithTtl = structuredClone(validAlias);
  aliasWithTtl.dnsChange.ttlSeconds = '300';
  assert.equal(
    validateAcmDnsControlRecord(aliasWithTtl, { ...expected, mode: 'authorization' }).ok,
    false,
  );

  const wrongTarget = cutoverRecord();
  wrongTarget.dnsChange.applicationLoadBalancerArn =
    'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/staging-app/0123456789abcdef';
  assert.equal(
    validateAcmDnsControlRecord(wrongTarget, { ...expected, mode: 'cutover' }).ok,
    false,
  );
});

test('validator source contains no network, DNS, TLS, provider, or subprocess imports', () => {
  const source = readFileSync(
    new URL('./validate-acm-dns-control-record.mjs', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    "from 'node:http'",
    "from 'node:https'",
    "from 'node:dns'",
    "from 'node:net'",
    "from 'node:tls'",
    "from 'node:child_process'",
    '@aws-sdk/',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
