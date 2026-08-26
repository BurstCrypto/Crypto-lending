import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  EVIDENCE_INDEX_INTEGRITY_MODEL,
  EVIDENCE_INDEX_RECORD_SCHEMA,
  canonicalizeEgressPolicy,
  canonicalizeEgressPolicyConfiguration,
  validateBillingControlBinding,
  validateBillingControlRecordFile,
  validateBrowserEgressSource,
  validateEvidenceIndexBinding,
  validateEvidenceIndexRecordFile,
  validateEgressPolicy,
  validateLocalPathInput,
  validatePolicyPathHygiene,
  zeroCallMarkers,
  zeroCallReportText,
} from './validate-egress-policy.mjs';
import { validateBillingControlRecord } from '../aws/validate-billing-control-record.mjs';

const NOW = new Date('2026-08-19T18:00:00Z');
const SOURCE_REVISION = '0123456789abcdef0123456789abcdef01234567';

function approvedBillingControlRecord() {
  return {
    schemaVersion: 1,
    status: 'APPROVED',
    recordId: 'jira:KAN-229/control-record-v1',
    approvedAt: '2026-08-19T12:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    aws: {
      accountId: '123456789012',
      accountAlias: 'crypto-lending-nonprod',
      approvedRoleArn: 'arn:aws:iam::123456789012:role/crypto-lending-deployer',
      applicationRegion: 'us-west-2',
      controlRegion: 'us-east-1',
    },
    environment: {
      name: 'dev',
      application: 'crypto-lending',
      owner: 'platform-owner',
      financeOwner: 'billing-finance-owner',
      costCenter: 'CRYPTO-LENDING',
      escalationRoute: 'runbook:cloud-cost-escalation',
    },
    budget: {
      currency: 'USD',
      expectedMonthlyBaselineUsd: '10.00',
      monthlyLimitUsd: '100.00',
      warningPercent: '70',
      criticalPercent: '90',
      warningRecipient: 'cloud-cost-warning',
      criticalRecipient: 'cloud-cost-critical',
      exclusions: ['credits', 'taxes', 'support-plan'],
      pricingAsOf: '2026-08-01',
      pricingExpiresAt: '2026-12-31',
      mechanism: 'AWS_BUDGETS',
      anomalyMode: 'Disabled',
      existingAnomalyMonitorArn: 'NOT_APPLICABLE',
      anomalyAbsoluteUsd: '20.00',
      anomalyPercentage: '40',
      feeDecision: 'NO_ADDITIONAL_CHARGE_CONFIRMED',
    },
    authority: {
      planApprovers: ['platform-owner'],
      deployApprovers: ['release-owner', 'billing-finance-owner'],
      retentionApprovers: ['billing-finance-owner'],
      deletionApprovers: ['platform-owner', 'billing-finance-owner'],
    },
    independentVerification: {
      verifier: 'independent-billing-reviewer',
      decision: 'APPROVED',
      verifiedAt: '2026-08-19T12:00:00Z',
    },
    evidence: {
      accountRegionRole: 'PASS',
      warningDelivery: 'PASS',
      criticalDelivery: 'PASS',
      anomalyDelivery: 'NOT_APPLICABLE',
      retainedResourceReview: 'PASS',
    },
  };
}

const BILLING_RECORD = approvedBillingControlRecord();
const BILLING_VALIDATION = validateBillingControlRecord(BILLING_RECORD, {
  mode: 'approved',
  expectedEnvironment: 'dev',
  expectedAccount: '123456789012',
  expectedApplicationRegion: 'us-west-2',
  now: NOW,
});
assert.equal(BILLING_VALIDATION.ok, true);
const BILLING_CONFIGURATION_SHA = BILLING_VALIDATION.controlConfigurationSha256;
const BILLING_REFERENCE = `billing-control:${BILLING_RECORD.recordId}`;

function approvedDestination({
  id = 'identity-primary',
  hostname = 'identity.vendor.com',
  service = 'IDENTITY',
  dependencyTicket = 'KAN-37',
  dependencyDecisionReference = 'jira:KAN-37/provider-decision-v1',
} = {}) {
  return {
    id,
    status: 'APPROVED',
    dependencyTicket,
    dependencyDecisionReference,
    service,
    serviceAccess: {
      callerService: 'web-browser',
      executionBoundary: 'BROWSER_WEB',
      identityReference: 'browser:web-client',
      networkControlReference: 'csp:production-connect-src-v1',
      serviceBorrowing: 'PROHIBITED',
    },
    purpose: 'Verify an authenticated application session with the approved identity provider.',
    approvedApiScope: ['identity:session.verify'],
    credentialReference: 'credential-ref:browser-session',
    reviewExpiresAt: '2026-12-31T23:59:59Z',
    endpoint: {
      scheme: 'https',
      hostname,
      port: 443,
      redirects: {
        mode: 'DENY_ALL',
        allowedHostnames: [],
        forwardCredentials: 'NEVER',
        maxHops: 0,
      },
    },
    owners: {
      provider: 'provider:identity-vendor',
      service: 'identity-service-owner',
      availability: 'identity-availability-owner',
      security: 'application-security-owner',
      privacy: 'application-privacy-owner',
      finance: 'vendor-finance-owner',
    },
    data: {
      requestClassifications: ['AUTHENTICATION_ASSERTION'],
      responseClassifications: ['PSEUDONYMOUS_ACCOUNT_ID'],
      credentialTransport: 'AUTHORIZATION_HEADER',
    },
    tls: {
      minimumVersion: 'TLS1.2',
      certificateValidation: 'SYSTEM_TRUST_STRICT',
      hostnameVerification: 'REQUIRED',
      sni: 'REQUIRED',
      allowInvalidCertificates: false,
    },
    dns: {
      resolution: 'SYSTEM_DNS',
      privateAddressResponse: 'DENY',
      failureMode: 'FAIL_CLOSED',
      hostnamePinning: 'DISABLED',
    },
    resilience: {
      connectTimeoutMs: 2000,
      requestTimeoutMs: 8000,
      maxAttempts: 3,
      retryBackoff: 'EXPONENTIAL_JITTER',
      retryNonIdempotent: 'NEVER',
      retryOn: ['CONNECT_TIMEOUT', 'HTTP_429', 'HTTP_503'],
      circuitBreaker: {
        failureThreshold: 5,
        openSeconds: 30,
        halfOpenRequests: 1,
        action: 'FAIL_CLOSED',
      },
    },
    fallback: {
      behavior: 'FAIL_CLOSED',
      alternateDestinationId: 'NOT_APPLICABLE',
      serviceBorrowing: 'PROHIBITED',
    },
    logging: {
      allowedMetadata: [
        'destinationId',
        'outcome',
        'durationMs',
        'statusClass',
        'retryCount',
        'circuitState',
      ],
      redactedHeaders: [
        'authorization',
        'proxy-authorization',
        'cookie',
        'set-cookie',
        'x-api-key',
      ],
      bodyLogging: 'DISABLED',
      queryLogging: 'DISABLED',
      secretFieldPolicy: 'DROP_AND_REDACT',
      retentionDays: 30,
      alertOwner: 'security-alert-owner',
    },
    monitoring: {
      status: 'APPROVED',
      metricNames: ['egress_failure_total', 'egress_denied_total'],
      alertRules: [
        {
          id: 'failure-rate-alert',
          metricName: 'egress_failure_total',
          comparisonOperator: 'GREATER_THAN_OR_EQUAL',
          threshold: '5.00',
          evaluationPeriods: 2,
          periodSeconds: 300,
          missingDataBehavior: 'BREACHING',
          alarmReference: 'alarm-ref:identity-failure-rate-v1',
        },
        {
          id: 'denied-request-alert',
          metricName: 'egress_denied_total',
          comparisonOperator: 'GREATER_THAN_OR_EQUAL',
          threshold: '1.00',
          evaluationPeriods: 1,
          periodSeconds: 60,
          missingDataBehavior: 'NOT_BREACHING',
          alarmReference: 'alarm-ref:identity-denied-v1',
        },
      ],
      owner: 'egress-monitoring-owner',
      cost: {
        currency: 'USD',
        estimatedMonthlyFixedUsd: '0.25',
        estimatedMonthlyVariableUsd: '0.10',
        monthlyVariableCeilingUsd: '0.50',
        costDecision: 'APPROVED',
        activationAuthorization: 'APPROVED',
        financeApprovalReference: 'jira:KAN-231/monitoring-cost-v1',
        pricingAsOf: '2026-08-01',
        pricingExpiresAt: '2026-12-31',
      },
    },
    cost: {
      currency: 'USD',
      estimatedMonthlyFixedUsd: '1.00',
      estimatedMonthlyVariableUsd: '0.50',
      monthlyVariableCeilingUsd: '2.00',
      costDecision: 'APPROVED',
      activationAuthorization: 'APPROVED',
      financeApprovalReference: 'jira:KAN-231/identity-cost-v1',
      pricingAsOf: '2026-08-01',
      pricingExpiresAt: '2026-12-31',
    },
    killSwitch: {
      owner: 'incident-commander',
      action: 'DENY_DESTINATION',
      activationReference: 'runbook:disable-identity-egress',
      lastTestedAt: 'NOT_RUN',
      evidence: 'NOT_RUN',
    },
  };
}

function approvedPolicy() {
  return {
    schemaVersion: 1,
    status: 'APPROVED',
    policyId: 'jira:KAN-231/policy-v1',
    currentMode: 'APPROVED_DESTINATIONS_ONLY',
    approvedAt: '2026-08-19T13:00:00Z',
    acceptedAt: 'NOT_RUN',
    expiresAt: '2026-12-31T23:59:59Z',
    environment: {
      application: 'crypto-lending',
      name: 'dev',
      accountId: '123456789012',
      applicationRegion: 'us-west-2',
      sourceRevision: SOURCE_REVISION,
    },
    dependencies: {
      applicationBaseline: {
        ticket: 'KAN-34',
        approvalStatus: 'APPROVED',
        decisionReference: 'jira:KAN-34/application-baseline-v1',
      },
      authenticationSessions: {
        ticket: 'KAN-37',
        approvalStatus: 'APPROVED',
        decisionReference: 'jira:KAN-37/provider-decision-v1',
      },
      rpcIndexing: {
        ticket: 'KAN-62',
        approvalStatus: 'APPROVED',
        decisionReference: 'jira:KAN-62/provider-decision-v1',
      },
    },
    architecture: {
      adrStatus: 'APPROVED',
      decisionReference: 'adr:0002/approved-v1',
      selectedControl: 'BROWSER_APPLICATION_CONTROLS_ONLY',
      defaultAction: 'DENY',
      dnsPolicy: 'DENY_UNLISTED_AND_UNAPPROVED_PRIVATE_ADDRESSES',
      ecsBoundary: 'PRIVATE_SUBNETS_NO_PUBLIC_IP_NO_DEFAULT_INTERNET_ROUTE',
      browserBoundary: 'OUTSIDE_VPC_ENFORCE_WITH_CSP_AND_APPLICATION_ALLOWLIST',
      killSwitch: 'DISABLE_ALL_EXTERNAL_EGRESS',
      estimatedMonthlyFixedCostUsd: '2.00',
      estimatedMonthlyVariableCostUsd: '1.00',
      monthlyVariableCostCeilingUsd: '4.00',
      costDecision: 'APPROVED',
      activationAuthorization: 'APPROVED',
      financeApprovalReference: 'jira:KAN-231/control-cost-v1',
      billingControlRecordReference: BILLING_REFERENCE,
      billingControlConfigurationSha256: BILLING_CONFIGURATION_SHA,
      pricingAsOf: '2026-08-01',
      pricingExpiresAt: '2026-12-31',
    },
    authority: {
      architectureApprovers: ['platform-architecture-owner'],
      securityApprovers: ['security-approval-owner'],
      privacyApprovers: ['privacy-approval-owner'],
      financeApprovers: ['finance-approval-owner'],
      independentVerifier: 'independent-third-party-reviewer',
      decision: 'APPROVED',
      verifiedAt: '2026-08-19T13:00:00Z',
      acceptanceVerifier: 'NOT_APPROVED',
      acceptanceDecision: 'NOT_RUN',
    },
    destinations: [approvedDestination()],
    evidence: {
      localPolicyValidation: 'PASS',
      unlistedDestinationDenied: 'NOT_RUN',
      allowedDestinationReached: 'NOT_RUN',
      providerOutage: 'NOT_RUN',
      dnsFailure: 'NOT_RUN',
      tlsFailure: 'NOT_RUN',
      logsRedacted: 'NOT_RUN',
      killSwitch: 'NOT_RUN',
      observedAtUtc: 'NOT_RUN',
      evidenceIndexReference: 'NOT_RUN',
      policyConfigurationSha256: 'NOT_RUN',
    },
  };
}

function proposedPolicy() {
  const policy = approvedPolicy();
  policy.status = 'PROPOSED';
  policy.currentMode = 'NO_EXTERNAL_EGRESS';
  policy.approvedAt = 'NOT_RUN';
  policy.expiresAt = 'NOT_RUN';
  policy.architecture.adrStatus = 'PROPOSED';
  policy.architecture.costDecision = 'NOT_APPROVED';
  policy.architecture.activationAuthorization = 'NOT_AUTHORIZED';
  policy.architecture.financeApprovalReference = 'NOT_RUN';
  policy.architecture.billingControlRecordReference = 'NOT_RUN';
  policy.architecture.billingControlConfigurationSha256 = 'NOT_RUN';
  policy.authority.decision = 'PROPOSED';
  policy.authority.verifiedAt = 'NOT_RUN';
  policy.destinations[0].status = 'PROPOSED';
  policy.destinations[0].cost.costDecision = 'NOT_APPROVED';
  policy.destinations[0].cost.activationAuthorization = 'NOT_AUTHORIZED';
  policy.destinations[0].cost.financeApprovalReference = 'NOT_RUN';
  policy.destinations[0].monitoring.status = 'PROPOSED';
  policy.destinations[0].monitoring.cost.costDecision = 'NOT_APPROVED';
  policy.destinations[0].monitoring.cost.activationAuthorization = 'NOT_AUTHORIZED';
  policy.destinations[0].monitoring.cost.financeApprovalReference = 'NOT_RUN';
  for (const rule of policy.destinations[0].monitoring.alertRules) {
    rule.alarmReference = 'NOT_RUN';
  }
  policy.destinations[0].killSwitch.activationReference = 'NOT_RUN';
  return policy;
}

function finalPolicy() {
  const policy = approvedPolicy();
  policy.status = 'ACCEPTED';
  policy.acceptedAt = '2026-08-19T16:00:00Z';
  policy.authority.acceptanceVerifier = 'independent-acceptance-reviewer';
  policy.authority.acceptanceDecision = 'ACCEPTED';
  for (const field of [
    'localPolicyValidation',
    'unlistedDestinationDenied',
    'allowedDestinationReached',
    'providerOutage',
    'dnsFailure',
    'tlsFailure',
    'logsRedacted',
    'killSwitch',
  ]) {
    policy.evidence[field] = 'PASS';
  }
  policy.evidence.observedAtUtc = '2026-08-19T15:00:00Z';
  policy.destinations[0].killSwitch.lastTestedAt = '2026-08-19T15:00:00Z';
  policy.destinations[0].killSwitch.evidence = 'PASS';
  const configurationSha256 = createHash('sha256')
    .update(canonicalizeEgressPolicyConfiguration(policy), 'utf8')
    .digest('hex');
  policy.evidence.policyConfigurationSha256 = configurationSha256;
  policy.evidence.evidenceIndexReference = `evidence-index:KAN-231:${configurationSha256}:final-v1`;
  return policy;
}

const EXPECTED_POLICY_CONFIGURATION_SHA256 = finalPolicy().evidence.policyConfigurationSha256;

function finalEvidenceIndexRecord(policy = finalPolicy()) {
  return {
    schemaVersion: 1,
    artifactType: 'KAN_231_EGRESS_EVIDENCE_INDEX',
    status: 'FINAL',
    policyId: policy.policyId,
    policyConfigurationSha256: policy.evidence.policyConfigurationSha256,
    evidenceIndexReference: policy.evidence.evidenceIndexReference,
    observedAtUtc: policy.evidence.observedAtUtc,
    protection: {
      status: 'PROTECTED',
      storageReference: 'protected-evidence:KAN-231/final-index-v1',
      immutableVersionReference: 'protected-version:KAN-231/final-index-v1/0001',
    },
    integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
  };
}

const approvedOptions = {
  mode: 'approved',
  expectedEnvironment: 'dev',
  expectedAccount: '123456789012',
  expectedRegion: 'us-west-2',
  expectedSourceRevision: SOURCE_REVISION,
  expectedBillingControlReference: BILLING_REFERENCE,
  expectedBillingControlConfigurationSha256: BILLING_CONFIGURATION_SHA,
  expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
  now: NOW,
};

test('accepts only the inert, dependency-blocked committed example', () => {
  const example = JSON.parse(readFileSync('infra/egress/egress-policy.example.json', 'utf8'));
  const result = validateEgressPolicy(example, { mode: 'example', now: NOW });

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.match(result.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.match(result.policyConfigurationSha256, /^[a-f0-9]{64}$/);

  example.dependencies.authenticationSessions.approvalStatus = 'APPROVED';
  const changed = validateEgressPolicy(example, { mode: 'example', now: NOW });
  assert.equal(changed.ok, false);
  assert(changed.errors.some((error) => error.includes('explicitly NOT_APPROVED')));
});

test('strictly compiles the draft-2020-12 schema and keeps examples and fixtures in parity', () => {
  const schema = JSON.parse(readFileSync('infra/egress/egress-policy.schema.json', 'utf8'));
  const example = JSON.parse(readFileSync('infra/egress/egress-policy.example.json', 'utf8'));
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);

  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.equal(validate(approvedPolicy()), true, JSON.stringify(validate.errors));

  const validateEvidenceIndex = ajv.compile(EVIDENCE_INDEX_RECORD_SCHEMA);
  assert.equal(
    validateEvidenceIndex(finalEvidenceIndexRecord()),
    true,
    JSON.stringify(validateEvidenceIndex.errors),
  );

  const missingMonitoring = approvedPolicy();
  delete missingMonitoring.destinations[0].monitoring;
  assert.equal(validate(missingMonitoring), false);
});

test('accepts a priced proposal while preserving no external egress and no activation authority', () => {
  const result = validateEgressPolicy(proposedPolicy(), { ...approvedOptions, mode: 'proposed' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('accepts design approval with bounded positive costs but runtime evidence not run', () => {
  const result = validateEgressPolicy(approvedPolicy(), approvedOptions);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('requires independent identity and a validated final KAN-229 billing binding', () => {
  const policy = approvedPolicy();
  const binding = validateBillingControlBinding(BILLING_RECORD, policy, {
    expectedEnvironment: 'dev',
    expectedAccount: '123456789012',
    expectedRegion: 'us-west-2',
    now: NOW,
  });
  assert.deepEqual(binding.errors, []);
  assert.equal(binding.reference, BILLING_REFERENCE);
  assert.equal(binding.controlConfigurationSha256, BILLING_CONFIGURATION_SHA);

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kan-231-billing-'));
  try {
    const recordPath = join(temporaryDirectory, 'final-billing-record.json');
    writeFileSync(recordPath, JSON.stringify(BILLING_RECORD), 'utf8');
    const fileBinding = validateBillingControlRecordFile(recordPath, policy, {
      expectedEnvironment: 'dev',
      expectedAccount: '123456789012',
      expectedRegion: 'us-west-2',
      now: NOW,
    });
    assert.deepEqual(fileBinding.errors, []);
    assert.equal(fileBinding.reference, BILLING_REFERENCE);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const repositoryRecord = validateBillingControlRecordFile(
    'infra/aws/billing-control-record.example.json',
    policy,
    {
      expectedEnvironment: 'dev',
      expectedAccount: '123456789012',
      expectedRegion: 'us-west-2',
      now: NOW,
    },
  );
  assert.equal(repositoryRecord.ok, false);
  assert(repositoryRecord.errors.some((error) => error.includes('outside the repository')));

  const networkRecord = validateBillingControlRecordFile(
    '\\\\server\\share\\billing.json',
    policy,
    {
      expectedEnvironment: 'dev',
      expectedAccount: '123456789012',
      expectedRegion: 'us-west-2',
      now: NOW,
    },
  );
  assert.equal(networkRecord.ok, false);
  assert(networkRecord.errors.some((error) => error.includes('UNC, device, and URI')));

  const noIndependentInputs = validateEgressPolicy(policy, { mode: 'approved', now: NOW });
  assert.equal(noIndependentInputs.ok, false);
  assert(noIndependentInputs.errors.some((error) => error.includes('requires exact expected')));
  assert(noIndependentInputs.errors.some((error) => error.includes('validated KAN-229')));

  const tamperedRecord = structuredClone(BILLING_RECORD);
  tamperedRecord.aws.accountId = '999999999999';
  const tampered = validateBillingControlBinding(tamperedRecord, policy, {
    expectedEnvironment: 'dev',
    expectedAccount: '123456789012',
    expectedRegion: 'us-west-2',
    now: NOW,
  });
  assert.equal(tampered.ok, false);
  assert(tampered.errors.some((error) => error.includes('does not match')));
});

test('rejects missing expected identity and invalid validation dates in every non-example mode', () => {
  const missing = validateEgressPolicy(proposedPolicy(), { mode: 'proposed', now: NOW });
  assert.equal(missing.ok, false);
  assert(missing.errors.some((error) => error.includes('requires exact expected')));

  const invalidNow = validateEgressPolicy(approvedPolicy(), {
    ...approvedOptions,
    now: new Date('invalid'),
  });
  assert.equal(invalidNow.ok, false);
  assert(invalidNow.errors.some((error) => error.includes('real Date')));
});

test('accepts final acceptance only after current protected runtime evidence is independently verified', () => {
  const result = validateEgressPolicy(finalPolicy(), { ...approvedOptions, mode: 'final' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('binds final policy to a strict protected evidence-index artifact and independent digest', () => {
  const policy = finalPolicy();
  const record = finalEvidenceIndexRecord(policy);
  const binding = validateEvidenceIndexBinding(record, policy, {
    expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
    now: NOW,
  });
  assert.deepEqual(binding.errors, []);
  assert.equal(binding.ok, true);
  assert.equal(binding.integrityModel, EVIDENCE_INDEX_INTEGRITY_MODEL);

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kan-231-evidence-index-'));
  try {
    const recordPath = join(temporaryDirectory, 'protected-evidence-index.json');
    writeFileSync(recordPath, JSON.stringify(record), 'utf8');
    const fileBinding = validateEvidenceIndexRecordFile(recordPath, policy, {
      expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
      now: NOW,
    });
    assert.deepEqual(fileBinding.errors, []);
    assert.equal(fileBinding.ok, true);
    assert.equal(fileBinding.integrityModel, EVIDENCE_INDEX_INTEGRITY_MODEL);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const missingExpected = validateEgressPolicy(policy, {
    ...approvedOptions,
    mode: 'final',
    expectedPolicyConfigurationSha256: undefined,
  });
  assert.equal(missingExpected.ok, false);
  assert(
    missingExpected.errors.some((error) =>
      error.includes('independently supplied expected policy configuration'),
    ),
  );

  const repositoryRecord = validateEvidenceIndexRecordFile(
    'infra/egress/egress-policy.example.json',
    policy,
    {
      expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
      now: NOW,
    },
  );
  assert.equal(repositoryRecord.ok, false);
  assert(repositoryRecord.errors.some((error) => error.includes('outside the repository')));

  const networkRecord = validateEvidenceIndexRecordFile(
    '\\\\server\\share\\evidence-index.json',
    policy,
    {
      expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
      now: NOW,
    },
  );
  assert.equal(networkRecord.ok, false);
  assert(networkRecord.errors.some((error) => error.includes('UNC, device, and URI')));
});

test('rejects every evidence-index cross-artifact mismatch and a self-resealed policy', () => {
  const policy = finalPolicy();
  for (const [label, mutate] of [
    ['policy ID', (record) => (record.policyId = 'jira:KAN-231/different-policy-v1')],
    ['configuration digest', (record) => (record.policyConfigurationSha256 = 'f'.repeat(64))],
    [
      'evidence reference',
      (record) =>
        (record.evidenceIndexReference = `evidence-index:KAN-231:${EXPECTED_POLICY_CONFIGURATION_SHA256}:different-index-v1`),
    ],
    ['observation timestamp', (record) => (record.observedAtUtc = '2026-08-19T14:59:59Z')],
  ]) {
    const record = finalEvidenceIndexRecord(policy);
    mutate(record);
    const result = validateEvidenceIndexBinding(record, policy, {
      expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
      now: NOW,
    });
    assert.equal(result.ok, false, label);
    assert(
      result.errors.some((error) => error.includes('must exactly match')),
      label,
    );
  }

  const unknownField = finalEvidenceIndexRecord(policy);
  unknownField.unreviewed = true;
  const unknownFieldResult = validateEvidenceIndexBinding(unknownField, policy, {
    expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
    now: NOW,
  });
  assert.equal(unknownFieldResult.ok, false);
  assert(unknownFieldResult.errors.some((error) => error.includes('unreviewed is not allowed')));

  const resealedPolicy = finalPolicy();
  resealedPolicy.destinations[0].purpose =
    'Verify an authenticated application session under a forged replacement design.';
  const resealedDigest = createHash('sha256')
    .update(canonicalizeEgressPolicyConfiguration(resealedPolicy), 'utf8')
    .digest('hex');
  resealedPolicy.evidence.policyConfigurationSha256 = resealedDigest;
  resealedPolicy.evidence.evidenceIndexReference = `evidence-index:KAN-231:${resealedDigest}:forged-reseal-v1`;
  const resealedRecord = finalEvidenceIndexRecord(resealedPolicy);

  const semanticResult = validateEgressPolicy(resealedPolicy, {
    ...approvedOptions,
    mode: 'final',
  });
  assert.equal(semanticResult.ok, false);
  assert(
    semanticResult.errors.some((error) => error.includes('independently supplied expected digest')),
  );
  const bindingResult = validateEvidenceIndexBinding(resealedRecord, resealedPolicy, {
    expectedPolicyConfigurationSha256: EXPECTED_POLICY_CONFIGURATION_SHA256,
    now: NOW,
  });
  assert.equal(bindingResult.ok, false);
  assert(
    bindingResult.errors.some((error) => error.includes('independently supplied expected digest')),
  );
});

test('requires a distinct post-evidence acceptance verifier and an ACCEPTED decision', () => {
  const designRoleReuse = finalPolicy();
  designRoleReuse.authority.acceptanceVerifier =
    designRoleReuse.authority.independentVerifier.toUpperCase();
  const designRoleResult = validateEgressPolicy(designRoleReuse, {
    ...approvedOptions,
    mode: 'final',
  });
  assert.equal(designRoleResult.ok, false);
  assert(
    designRoleResult.errors.some((error) =>
      error.includes('independent from design approval and verification roles'),
    ),
  );

  const implementationRoleReuse = finalPolicy();
  implementationRoleReuse.authority.acceptanceVerifier =
    implementationRoleReuse.destinations[0].monitoring.owner.toUpperCase();
  const implementationRoleResult = validateEgressPolicy(implementationRoleReuse, {
    ...approvedOptions,
    mode: 'final',
  });
  assert.equal(implementationRoleResult.ok, false);
  assert(
    implementationRoleResult.errors.some((error) =>
      error.includes('independent from destination implementation roles'),
    ),
  );

  for (const [verifier, decision] of [
    ['NOT_APPROVED', 'ACCEPTED'],
    ['independent-acceptance-reviewer', 'REJECTED'],
  ]) {
    const forgedAcceptance = finalPolicy();
    forgedAcceptance.authority.acceptanceVerifier = verifier;
    forgedAcceptance.authority.acceptanceDecision = decision;
    const result = validateEgressPolicy(forgedAcceptance, {
      ...approvedOptions,
      mode: 'final',
    });
    assert.equal(result.ok, false);
  }

  const prematureDesign = approvedPolicy();
  prematureDesign.authority.acceptanceVerifier = 'independent-acceptance-reviewer';
  prematureDesign.authority.acceptanceDecision = 'ACCEPTED';
  const prematureDesignResult = validateEgressPolicy(prematureDesign, approvedOptions);
  assert.equal(prematureDesignResult.ok, false);
  assert(
    prematureDesignResult.errors.some((error) =>
      error.includes('post-evidence acceptance fields must remain'),
    ),
  );
});

test('rejects final evidence when configuration or evidence-index digest binding is forged', () => {
  const changedConfiguration = finalPolicy();
  changedConfiguration.destinations[0].endpoint.hostname = 'changed.vendor.com';
  const changedResult = validateEgressPolicy(changedConfiguration, {
    ...approvedOptions,
    mode: 'final',
  });
  assert.equal(changedResult.ok, false);
  assert(changedResult.errors.some((error) => error.includes('bind final evidence to the exact')));
  assert(changedResult.errors.some((error) => error.includes('must begin with')));

  const forgedIndex = finalPolicy();
  forgedIndex.evidence.evidenceIndexReference = `evidence-index:KAN-231:${'f'.repeat(64)}:forged`;
  const forgedResult = validateEgressPolicy(forgedIndex, {
    ...approvedOptions,
    mode: 'final',
  });
  assert.equal(forgedResult.ok, false);
  assert(forgedResult.errors.some((error) => error.includes('must begin with')));
});

test('binds final evidence to lifecycle, design approval, policy expiry, and destination review', () => {
  const approved = validateEgressPolicy(approvedPolicy(), approvedOptions);
  const final = validateEgressPolicy(finalPolicy(), { ...approvedOptions, mode: 'final' });

  assert.equal(approved.ok, true);
  assert.equal(final.ok, true);
  assert.notEqual(approved.canonicalSha256, final.canonicalSha256);
  assert.equal(approved.policyConfigurationSha256, final.policyConfigurationSha256);
  assert.equal(finalPolicy().evidence.policyConfigurationSha256, final.policyConfigurationSha256);

  for (const mutate of [
    (policy) => (policy.status = 'ACCEPTED'),
    (policy) => (policy.acceptedAt = '2026-08-19T16:00:00Z'),
    (policy) => (policy.authority.acceptanceVerifier = 'independent-acceptance-reviewer'),
    (policy) => (policy.authority.acceptanceDecision = 'ACCEPTED'),
  ]) {
    const acceptanceOnlyChange = approvedPolicy();
    mutate(acceptanceOnlyChange);
    const acceptanceResult = validateEgressPolicy(acceptanceOnlyChange, approvedOptions);
    assert.equal(acceptanceResult.policyConfigurationSha256, approved.policyConfigurationSha256);
  }

  const changed = approvedPolicy();
  changed.architecture.billingControlConfigurationSha256 = 'b'.repeat(64);
  const changedResult = validateEgressPolicy(changed, approvedOptions);
  assert.notEqual(changedResult.policyConfigurationSha256, approved.policyConfigurationSha256);

  for (const mutate of [
    (policy) => (policy.expiresAt = '2026-12-30T23:59:59Z'),
    (policy) => (policy.approvedAt = '2026-08-19T12:59:59Z'),
    (policy) => (policy.authority.independentVerifier = 'another-independent-reviewer'),
    (policy) => (policy.authority.verifiedAt = '2026-08-19T12:59:59Z'),
    (policy) => (policy.destinations[0].status = 'PROPOSED'),
    (policy) => (policy.destinations[0].reviewExpiresAt = '2026-12-30T23:59:59Z'),
  ]) {
    const lifecycleChange = approvedPolicy();
    mutate(lifecycleChange);
    const lifecycleResult = validateEgressPolicy(lifecycleChange, approvedOptions);
    assert.notEqual(lifecycleResult.policyConfigurationSha256, approved.policyConfigurationSha256);
  }
});

test('rejects unknown fields and environment or source identity mismatches', () => {
  const policy = approvedPolicy();
  policy.unreviewed = true;
  const result = validateEgressPolicy(policy, {
    ...approvedOptions,
    expectedAccount: '999999999999',
    expectedSourceRevision: 'f'.repeat(40),
  });

  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('unreviewed is not allowed')));
  assert(result.errors.some((error) => error.includes("account '123456789012'")));
  assert(result.errors.some((error) => error.includes('source revision')));
});

test('rejects wildcard, IP, private, plaintext, query, credential, and non-443 endpoints', () => {
  const mutations = [
    ['wildcard hostname', (destination) => (destination.endpoint.hostname = '*.vendor.com')],
    ['IP literal', (destination) => (destination.endpoint.hostname = '127.0.0.1')],
    ['private hostname', (destination) => (destination.endpoint.hostname = 'identity.internal')],
    ['plaintext', (destination) => (destination.endpoint.scheme = 'http')],
    ['port', (destination) => (destination.endpoint.port = 80)],
    ['query scope', (destination) => (destination.approvedApiScope = ['identity:verify?all=true'])],
    [
      'credential material',
      (destination) => (destination.credentialReference = 'Bearer actual-token-material'),
    ],
  ];

  for (const [label, mutate] of mutations) {
    const policy = approvedPolicy();
    mutate(policy.destinations[0]);
    const result = validateEgressPolicy(policy, approvedOptions);
    assert.equal(result.ok, false, label);
  }
});

test('rejects duplicates, service borrowing, unsafe logging, and unbounded or stale costs', () => {
  const policy = approvedPolicy();
  policy.destinations.push(structuredClone(policy.destinations[0]));
  policy.destinations[0].serviceAccess.callerService = 'api';
  policy.destinations[0].logging.allowedMetadata.push('authorization');
  policy.destinations[0].logging.redactedHeaders = ['authorization'];
  policy.destinations[0].logging.bodyLogging = 'ENABLED';
  policy.destinations[0].cost.estimatedMonthlyVariableUsd = 'unbounded';
  policy.destinations[0].cost.pricingExpiresAt = '2026-08-01';

  const result = validateEgressPolicy(policy, approvedOptions);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('duplicate destination IDs')));
  assert(result.errors.some((error) => error.includes('service borrowing is prohibited')));
  assert(result.errors.some((error) => error.includes('allowedMetadata')));
  assert(result.errors.some((error) => error.includes('redactedHeaders must include')));
  assert(result.errors.some((error) => error.includes('bodyLogging')));
  assert(result.errors.some((error) => error.includes('finite nonnegative')));
  assert(result.errors.some((error) => error.includes('stale pricing')));
});

test('binds fixed services to KAN-37/KAN-62 and requires separate downstream provider decisions', () => {
  const wrongBaselineReference = approvedPolicy();
  wrongBaselineReference.dependencies.applicationBaseline.decisionReference =
    'jira:KAN-999/application-baseline-v1';
  const wrongBaselineResult = validateEgressPolicy(wrongBaselineReference, approvedOptions);
  assert.equal(wrongBaselineResult.ok, false);
  assert(wrongBaselineResult.errors.some((error) => error.includes('exact ticket KAN-34')));

  const wrongIdentityReference = approvedPolicy();
  wrongIdentityReference.dependencies.authenticationSessions.decisionReference =
    'jira:KAN-999/provider-decision-v1';
  wrongIdentityReference.destinations[0].dependencyDecisionReference =
    'jira:KAN-999/provider-decision-v1';
  const wrongIdentityReferenceResult = validateEgressPolicy(
    wrongIdentityReference,
    approvedOptions,
  );
  assert.equal(wrongIdentityReferenceResult.ok, false);
  assert(
    wrongIdentityReferenceResult.errors.some((error) => error.includes('exact ticket KAN-37')),
  );

  const wrongIdentity = approvedPolicy();
  wrongIdentity.destinations[0].dependencyTicket = 'KAN-62';
  wrongIdentity.destinations[0].dependencyDecisionReference =
    wrongIdentity.dependencies.rpcIndexing.decisionReference;
  const wrongIdentityResult = validateEgressPolicy(wrongIdentity, approvedOptions);
  assert.equal(wrongIdentityResult.ok, false);
  assert(wrongIdentityResult.errors.some((error) => error.includes('must equal KAN-37')));

  const partner = approvedPolicy();
  partner.destinations[0] = approvedDestination({
    id: 'partner-api-primary',
    hostname: 'api.partner.com',
    service: 'PARTNER_API',
    dependencyTicket: 'KAN-88',
    dependencyDecisionReference: 'jira:KAN-88/provider-decision-v1',
  });
  const partnerResult = validateEgressPolicy(partner, approvedOptions);
  assert.deepEqual(partnerResult.errors, []);

  for (const forbiddenRootTicket of ['KAN-34', 'KAN-37', 'KAN-62', 'KAN-231']) {
    const borrowedRootDecision = structuredClone(partner);
    borrowedRootDecision.destinations[0].dependencyTicket = forbiddenRootTicket;
    borrowedRootDecision.destinations[0].dependencyDecisionReference = `jira:${forbiddenRootTicket}/provider-decision-v1`;
    const result = validateEgressPolicy(borrowedRootDecision, approvedOptions);
    assert.equal(result.ok, false, forbiddenRootTicket);
    assert(
      result.errors.some((error) => error.includes('separate downstream provider decision')),
      forbiddenRootTicket,
    );
  }
});

test('permits only an explicit compatible approved alternate and rejects missing or cyclic fallback', () => {
  const policy = approvedPolicy();
  const alternate = approvedDestination({
    id: 'identity-alternate',
    hostname: 'identity.backup.com',
  });
  policy.destinations.push(alternate);
  policy.architecture.estimatedMonthlyFixedCostUsd = '3.00';
  policy.architecture.estimatedMonthlyVariableCostUsd = '2.00';
  policy.architecture.monthlyVariableCostCeilingUsd = '6.00';
  policy.destinations[0].fallback = {
    behavior: 'USE_APPROVED_ALTERNATE',
    alternateDestinationId: alternate.id,
    serviceBorrowing: 'PROHIBITED',
  };
  const valid = validateEgressPolicy(policy, approvedOptions);
  assert.deepEqual(valid.errors, []);

  const incompatible = structuredClone(policy);
  incompatible.destinations[1].endpoint.scheme = 'wss';
  incompatible.destinations[1].serviceAccess.identityReference = 'browser:other-client';
  const incompatibleResult = validateEgressPolicy(incompatible, approvedOptions);
  assert.equal(incompatibleResult.ok, false);
  assert(
    incompatibleResult.errors.some(
      (error) => error.includes('scheme') || error.includes('execution identity'),
    ),
  );

  const missing = structuredClone(policy);
  missing.destinations[0].fallback.alternateDestinationId = 'identity-missing';
  const missingResult = validateEgressPolicy(missing, approvedOptions);
  assert.equal(missingResult.ok, false);
  assert(missingResult.errors.some((error) => error.includes('is not listed')));

  const cyclic = structuredClone(policy);
  cyclic.destinations[1].fallback = {
    behavior: 'USE_APPROVED_ALTERNATE',
    alternateDestinationId: cyclic.destinations[0].id,
    serviceBorrowing: 'PROHIBITED',
  };
  const cyclicResult = validateEgressPolicy(cyclic, approvedOptions);
  assert.equal(cyclicResult.ok, false);
  assert(cyclicResult.errors.some((error) => error.includes('fallback graph')));

  const mixedCycle = structuredClone(policy);
  mixedCycle.destinations[1].endpoint.redirects = {
    mode: 'EXACT_HOST_ALLOWLIST',
    allowedHostnames: [mixedCycle.destinations[0].endpoint.hostname],
    forwardCredentials: 'NEVER',
    maxHops: 1,
  };
  const mixedCycleResult = validateEgressPolicy(mixedCycle, approvedOptions);
  assert.equal(mixedCycleResult.ok, false);
  assert(mixedCycleResult.errors.some((error) => error.includes('combined redirect and fallback')));
});

test('requires redirects to another compatible approved record and rejects redirect cycles', () => {
  const policy = approvedPolicy();
  const redirectTarget = approvedDestination({
    id: 'identity-redirect-target',
    hostname: 'login.other-domain.com',
  });
  policy.destinations.push(redirectTarget);
  policy.architecture.estimatedMonthlyFixedCostUsd = '3.00';
  policy.architecture.estimatedMonthlyVariableCostUsd = '2.00';
  policy.architecture.monthlyVariableCostCeilingUsd = '6.00';
  policy.destinations[0].endpoint.redirects = {
    mode: 'EXACT_HOST_ALLOWLIST',
    allowedHostnames: [redirectTarget.endpoint.hostname],
    forwardCredentials: 'NEVER',
    maxHops: 1,
  };
  const valid = validateEgressPolicy(policy, approvedOptions);
  assert.deepEqual(valid.errors, []);

  const unlisted = structuredClone(policy);
  unlisted.destinations[0].endpoint.redirects.allowedHostnames = ['unlisted.vendor.com'];
  const unlistedResult = validateEgressPolicy(unlisted, approvedOptions);
  assert.equal(unlistedResult.ok, false);
  assert(unlistedResult.errors.some((error) => error.includes('exactly one explicit destination')));

  const identityMismatch = structuredClone(policy);
  identityMismatch.destinations[1].serviceAccess.identityReference = 'browser:other-client';
  identityMismatch.destinations[1].credentialReference = 'credential-ref:other-session';
  const identityMismatchResult = validateEgressPolicy(identityMismatch, approvedOptions);
  assert.equal(identityMismatchResult.ok, false);
  assert(
    identityMismatchResult.errors.some((error) =>
      error.includes('same caller/service/decision/data/TLS/API scope'),
    ),
  );

  const cyclic = structuredClone(policy);
  cyclic.destinations[1].endpoint.redirects = {
    mode: 'EXACT_HOST_ALLOWLIST',
    allowedHostnames: [cyclic.destinations[0].endpoint.hostname],
    forwardCredentials: 'NEVER',
    maxHops: 1,
  };
  const cyclicResult = validateEgressPolicy(cyclic, approvedOptions);
  assert.equal(cyclicResult.ok, false);
  assert(cyclicResult.errors.some((error) => error.includes('redirect graph')));
});

test('separates browser and ECS boundaries and binds ECS controls to the selected architecture', () => {
  const policy = approvedPolicy();
  const destination = policy.destinations[0];
  destination.serviceAccess = {
    callerService: 'api',
    executionBoundary: 'ECS_API',
    identityReference: 'iam-role:crypto-lending-api-task',
    networkControlReference: 'egress-proxy:approved-proxy-v1',
    serviceBorrowing: 'PROHIBITED',
  };
  policy.architecture.selectedControl = 'EGRESS_PROXY_WITH_NAT';
  const valid = validateEgressPolicy(policy, approvedOptions);
  assert.deepEqual(valid.errors, []);

  policy.architecture.selectedControl = 'PRIVATE_ENDPOINTS';
  const mismatch = validateEgressPolicy(policy, approvedOptions);
  assert.equal(mismatch.ok, false);
  assert(mismatch.errors.some((error) => error.includes('must match the selected')));
  assert(mismatch.errors.some((error) => error.includes('privateAddressResponse')));
});

test('requires architecture envelopes to cover destination and monitoring costs and expiries', () => {
  const underfunded = approvedPolicy();
  underfunded.architecture.estimatedMonthlyFixedCostUsd = '0.00';
  underfunded.architecture.estimatedMonthlyVariableCostUsd = '0.00';
  underfunded.architecture.monthlyVariableCostCeilingUsd = '0.00';
  const underfundedResult = validateEgressPolicy(underfunded, approvedOptions);
  assert.equal(underfundedResult.ok, false);
  assert(
    underfundedResult.errors.filter((error) => error.includes('must cover aggregate')).length >= 3,
  );

  const expiredEnvelope = approvedPolicy();
  expiredEnvelope.architecture.pricingExpiresAt = '2026-12-30';
  expiredEnvelope.destinations[0].reviewExpiresAt = '2026-12-30T23:59:59Z';
  expiredEnvelope.destinations[0].cost.pricingExpiresAt = '2026-12-30';
  expiredEnvelope.destinations[0].monitoring.cost.pricingExpiresAt = '2026-12-30';
  const expiredResult = validateEgressPolicy(expiredEnvelope, approvedOptions);
  assert.equal(expiredResult.ok, false);
  assert(expiredResult.errors.some((error) => error.includes('architecture.pricingExpiresAt')));
  assert(expiredResult.errors.some((error) => error.includes('reviewExpiresAt')));
  assert(expiredResult.errors.some((error) => error.includes('monitoring.cost.pricingExpiresAt')));
});

test('requires a complete approved monitoring contract and keeps proposals unapproved', () => {
  const proposal = proposedPolicy();
  proposal.destinations[0].status = 'APPROVED';
  proposal.destinations[0].monitoring.status = 'APPROVED';
  proposal.acceptedAt = '2026-08-19T12:00:00Z';
  const proposalResult = validateEgressPolicy(proposal, {
    ...approvedOptions,
    mode: 'proposed',
  });
  assert.equal(proposalResult.ok, false);
  assert(proposalResult.errors.some((error) => error.includes('status must equal PROPOSED')));
  assert(proposalResult.errors.some((error) => error.includes('timestamps must remain NOT_RUN')));

  const monitoring = approvedPolicy();
  monitoring.destinations[0].monitoring.metricNames = ['unapproved_metric'];
  monitoring.destinations[0].monitoring.alertRules[0].alarmReference = 'NOT_RUN';
  monitoring.destinations[0].monitoring.alertRules[1].metricName = 'egress_failure_total';
  monitoring.destinations[0].monitoring.cost.costDecision = 'NOT_APPROVED';
  monitoring.destinations[0].monitoring.cost.monthlyVariableCeilingUsd = '0.01';
  const monitoringResult = validateEgressPolicy(monitoring, approvedOptions);
  assert.equal(monitoringResult.ok, false);
  assert(monitoringResult.errors.some((error) => error.includes('metricNames')));
  assert(monitoringResult.errors.some((error) => error.includes('alarmReference')));
  assert(monitoringResult.errors.some((error) => error.includes('threshold for')));
  assert(monitoringResult.errors.some((error) => error.includes('costDecision')));
  assert(monitoringResult.errors.some((error) => error.includes('variable estimate')));
});

test('rejects personal and high-risk secret material throughout the policy', () => {
  const sensitiveValues = [
    'founder@example.com',
    `ASIA${'A'.repeat(16)}`,
    `xoxb-${'a'.repeat(24)}`,
    `ghp_${'a'.repeat(24)}`,
    `sk-proj-${'a'.repeat(24)}`,
    `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`,
    `0x${'a'.repeat(40)}`,
  ];
  for (const sensitiveValue of sensitiveValues) {
    const policy = approvedPolicy();
    policy.destinations[0].purpose = `Do not store ${sensitiveValue} in this reviewed purpose.`;
    const result = validateEgressPolicy(policy, approvedOptions);
    assert.equal(result.ok, false, sensitiveValue);
    assert(result.errors.some((error) => error.includes('credential or secret material')));
  }
});

test('rejects SSNs and phones everywhere while limiting public-IP PII scans to text and references', () => {
  for (const [label, value, expectedFinding] of [
    ['SSN', '123-45-6789', 'appears to contain an SSN'],
    ['phone number', '303-555-0100', 'appears to contain a phone number'],
    ['phone number', '3035550100', 'appears to contain a phone number'],
    ['public IP address', '8.8.8.8', 'public IP address in a free-text or reference field'],
    [
      'public IP address',
      '2001:4860:4860::8888',
      'public IP address in a free-text or reference field',
    ],
  ]) {
    const narrativePolicy = approvedPolicy();
    narrativePolicy.destinations[0].purpose = `Reviewed destination narrative must not contain ${value}.`;
    const narrativeResult = validateEgressPolicy(narrativePolicy, approvedOptions);
    assert.equal(narrativeResult.ok, false, `${label} narrative`);
    assert(
      narrativeResult.errors.some((error) => error.includes(expectedFinding)),
      `${label} narrative`,
    );

    const referencePolicy = approvedPolicy();
    referencePolicy.architecture.decisionReference = `adr:review-${value}`;
    const referenceResult = validateEgressPolicy(referencePolicy, approvedOptions);
    assert.equal(referenceResult.ok, false, `${label} reference`);
    assert(
      referenceResult.errors.some((error) => error.includes(expectedFinding)),
      `${label} reference`,
    );
  }

  const aliasPolicy = approvedPolicy();
  aliasPolicy.authority.independentVerifier = 'reviewer-123-45-6789';
  aliasPolicy.destinations[0].owners.service = 'owner-303-555-0100';
  const aliasResult = validateEgressPolicy(aliasPolicy, approvedOptions);
  assert.equal(aliasResult.ok, false);
  assert(
    aliasResult.errors.some(
      (error) => error.includes('policy.authority.independentVerifier') && error.includes('SSN'),
    ),
  );
  assert(
    aliasResult.errors.some(
      (error) =>
        error.includes('policy.destinations[0].owners.service') && error.includes('phone number'),
    ),
  );

  const endpointPolicy = approvedPolicy();
  endpointPolicy.destinations[0].endpoint.hostname = '8.8.8.8';
  const endpointResult = validateEgressPolicy(endpointPolicy, approvedOptions);
  assert.equal(endpointResult.ok, false);
  assert(endpointResult.errors.some((error) => error.includes('IP literal')));
  assert.equal(
    endpointResult.errors.some((error) => error.includes('public IP address in a free-text')),
    false,
  );
});

test('rejects stale final evidence or acceptance performed before observation', () => {
  const stale = finalPolicy();
  stale.evidence.observedAtUtc = '2026-07-01T12:00:00Z';
  stale.destinations[0].killSwitch.lastTestedAt = '2026-01-01T12:00:00Z';
  const staleResult = validateEgressPolicy(stale, { ...approvedOptions, mode: 'final' });
  assert.equal(staleResult.ok, false);
  assert(staleResult.errors.some((error) => error.includes('refreshed within seven days')));
  assert(staleResult.errors.some((error) => error.includes('retest within 90 days')));

  const earlyApproval = finalPolicy();
  earlyApproval.acceptedAt = '2026-08-19T14:00:00Z';
  const earlyResult = validateEgressPolicy(earlyApproval, { ...approvedOptions, mode: 'final' });
  assert.equal(earlyResult.ok, false);
  assert(earlyResult.errors.some((error) => error.includes('after the final evidence')));

  const simultaneousAcceptance = finalPolicy();
  simultaneousAcceptance.acceptedAt = simultaneousAcceptance.evidence.observedAtUtc;
  const simultaneousResult = validateEgressPolicy(simultaneousAcceptance, {
    ...approvedOptions,
    mode: 'final',
  });
  assert.equal(simultaneousResult.ok, false);
  assert(simultaneousResult.errors.some((error) => error.includes('after the final evidence')));

  const lateDesignApproval = finalPolicy();
  lateDesignApproval.approvedAt = '2026-08-19T15:30:00Z';
  const lateDesignResult = validateEgressPolicy(lateDesignApproval, {
    ...approvedOptions,
    mode: 'final',
  });
  assert.equal(lateDesignResult.ok, false);
  assert(lateDesignResult.errors.some((error) => error.includes('before final evidence')));
});

test('validates the fail-closed production browser policy and rejects external production sources', () => {
  const source = readFileSync('apps/web/lib/security/browser-egress.js', 'utf8');
  const current = validateBrowserEgressSource(source);
  assert.deepEqual(current.errors, []);

  const unsafe = source.replace("connect-src 'self'", "connect-src 'self' https: *");
  const result = validateBrowserEgressSource(unsafe);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('exactly')));

  const unsafeResource = source.replace("img-src 'self' data: blob:", 'img-src https:');
  const unsafeResourceResult = validateBrowserEgressSource(unsafeResource);
  assert.equal(unsafeResourceResult.ok, false);
  assert(unsafeResourceResult.errors.some((error) => error.includes('resource policy')));
});

test('enforces outside-repository operational records and detects local artifact residue', () => {
  for (const unsafePath of [
    '\\\\server\\share\\policy.json',
    '//server/share/policy.json',
    'https://example.com/policy.json',
  ]) {
    const unsafe = validateLocalPathInput(unsafePath, 'Operational record');
    assert.equal(unsafe.ok, false);
    assert(unsafe.errors.some((error) => error.includes('UNC, device, and URI')));
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'kan-231-policy-'));
  try {
    const exampleDirectory = join(temporaryRoot, 'infra', 'egress');
    mkdirSync(exampleDirectory, { recursive: true });
    const examplePath = join(exampleDirectory, 'egress-policy.example.json');
    writeFileSync(examplePath, '{}', 'utf8');

    const example = validatePolicyPathHygiene(examplePath, {
      mode: 'example',
      repositoryRoot: temporaryRoot,
    });
    assert.deepEqual(example.errors, []);

    const inRepository = validatePolicyPathHygiene(join(temporaryRoot, 'approved.json'), {
      mode: 'approved',
      repositoryRoot: temporaryRoot,
    });
    assert.equal(inRepository.ok, false);
    assert(inRepository.errors.some((error) => error.includes('outside the repository')));

    writeFileSync(join(temporaryRoot, 'dev.egress-policy.local.json'), '{}', 'utf8');
    const residue = validatePolicyPathHygiene(resolve(temporaryRoot, '..', 'approved.json'), {
      mode: 'approved',
      repositoryRoot: temporaryRoot,
    });
    assert.equal(residue.ok, false);
    assert(residue.errors.some((error) => error.includes('Local operational egress artifact')));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('canonicalization is deterministic regardless of object key order', () => {
  const policy = approvedPolicy();
  const reordered = Object.fromEntries(Object.entries(policy).reverse());
  assert.equal(canonicalizeEgressPolicy(policy), canonicalizeEgressPolicy(reordered));
});

test('reports every local-only zero-call and zero-activation marker in structured and text output', () => {
  assert.deepEqual(zeroCallMarkers(), {
    networkCallsMade: 0,
    dnsQueriesMade: 0,
    awsCallsMade: 0,
    providerCallsMade: 0,
    subprocessesStarted: 0,
    tlsConnectionsMade: 0,
    cloudResourcesCreated: 0,
    vendorAccountsOrTrialsCreated: 0,
    paidServiceActivations: 0,
  });
  assert.equal(
    zeroCallReportText(),
    [
      'Network calls made: 0',
      'DNS queries made: 0',
      'AWS API calls made: 0',
      'Provider calls made: 0',
      'Subprocesses started: 0',
      'TLS connections made: 0',
      'Cloud resources created: 0',
      'Vendor accounts or trials created: 0',
      'Paid service activations: 0',
      '',
    ].join('\n'),
  );
});
