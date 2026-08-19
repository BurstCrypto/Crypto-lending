import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalizeBillingControlRecord,
  validateBillingControlRecord,
} from './validate-billing-control-record.mjs';

function approvedRecord() {
  return {
    schemaVersion: 1,
    status: 'APPROVED',
    recordId: 'jira:KAN-229/control-record-v1',
    approvedAt: '2026-08-01T12:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    aws: {
      accountId: '123456789012',
      accountAlias: 'crypto-lending-nonprod',
      approvedRoleArn: 'arn:aws:iam::123456789012:role/crypto-lending-deployer',
      applicationRegion: 'us-east-1',
      controlRegion: 'us-east-1',
    },
    environment: {
      name: 'staging',
      application: 'crypto-lending',
      owner: 'platform-owner',
      financeOwner: 'finance-owner',
      costCenter: 'CRYPTO-LENDING',
      escalationRoute: 'runbook:cloud-cost-escalation',
    },
    budget: {
      currency: 'USD',
      expectedMonthlyBaselineUsd: '155.00',
      monthlyLimitUsd: '200.00',
      warningPercent: '70',
      criticalPercent: '90',
      warningRecipient: 'cloud-cost-warning',
      criticalRecipient: 'cloud-cost-critical',
      exclusions: ['credits', 'taxes', 'support-plan'],
      pricingAsOf: '2026-08-19',
      pricingExpiresAt: '2026-11-19',
      mechanism: 'AWS_BUDGETS',
      anomalyMode: 'Disabled',
      existingAnomalyMonitorArn: 'NOT_APPLICABLE',
      anomalyAbsoluteUsd: '20',
      anomalyPercentage: '40',
      feeDecision: 'NO_ADDITIONAL_CHARGE_CONFIRMED',
    },
    authority: {
      planApprovers: ['platform-owner'],
      deployApprovers: ['release-owner', 'finance-owner'],
      retentionApprovers: ['finance-owner'],
      deletionApprovers: ['platform-owner', 'finance-owner'],
    },
    independentVerification: {
      verifier: 'independent-cloud-reviewer',
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

const validationOptions = {
  mode: 'approved',
  expectedAccount: '123456789012',
  expectedApplicationRegion: 'us-east-1',
  expectedControlRegion: 'us-east-1',
  expectedEnvironment: 'staging',
  now: new Date('2026-08-19T18:00:00Z'),
};

test('accepts a complete, current, independently verified control record', () => {
  const record = approvedRecord();
  const result = validateBillingControlRecord(record, validationOptions);

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.match(result.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.match(result.controlConfigurationSha256, /^[a-f0-9]{64}$/);
  assert.equal(canonicalizeBillingControlRecord(record), canonicalizeBillingControlRecord(record));
});

test('rejects unknown fields and unapproved placeholders', () => {
  const record = approvedRecord();
  record.unreviewed = true;
  record.environment.owner = 'NOT_APPROVED';

  const result = validateBillingControlRecord(record, validationOptions);

  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('record.unreviewed is not allowed')));
  assert(result.errors.some((error) => error.includes('record.environment.owner')));
});

test('rejects mismatched identity, environment, and Region values', () => {
  const record = approvedRecord();
  const result = validateBillingControlRecord(record, {
    ...validationOptions,
    expectedAccount: '999999999999',
    expectedApplicationRegion: 'us-west-2',
    expectedControlRegion: 'us-west-2',
    expectedEnvironment: 'qa',
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => error.includes('does not match')).length, 4);
});

test('binds the approved role ARN to the application partition', () => {
  const record = approvedRecord();
  record.aws.approvedRoleArn = 'arn:aws-us-gov:iam::123456789012:role/crypto-lending-deployer';

  const result = validateBillingControlRecord(record, validationOptions);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('application partition')));
});

test('rejects expired approvals and pricing', () => {
  const record = approvedRecord();
  record.expiresAt = '2026-08-18T23:59:59Z';
  record.budget.pricingExpiresAt = '2026-08-18';

  const result = validateBillingControlRecord(record, validationOptions);

  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('record.expiresAt must be in the future')));
  assert(
    result.errors.some((error) =>
      error.includes('record.budget.pricingExpiresAt must be in the future'),
    ),
  );
});

test('rejects impossible calendar dates instead of accepting Date normalization', () => {
  const record = approvedRecord();
  record.approvedAt = '2026-02-30T12:00:00Z';
  record.budget.pricingAsOf = '2026-02-30';

  const result = validateBillingControlRecord(record, validationOptions);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('approvedAt is not a real calendar date')));
  assert(result.errors.some((error) => error.includes('pricingAsOf is not a real calendar date')));
});

test('rejects unsafe thresholds, personal email material, and incomplete evidence', () => {
  const record = approvedRecord();
  record.budget.warningPercent = '90';
  record.budget.criticalPercent = '80';
  record.budget.warningRecipient = 'person@example.com';
  record.evidence.warningDelivery = 'NOT_RUN';

  const result = validateBillingControlRecord(record, validationOptions);

  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('warningPercent')));
  assert(result.errors.some((error) => error.includes('warning threshold')));
  assert(result.errors.some((error) => error.includes('warningRecipient')));
  assert(result.errors.some((error) => error.includes('warningDelivery')));
});

test('requires the committed example to remain inert', () => {
  const example = approvedRecord();
  example.status = 'NOT_APPROVED';
  for (const key of ['recordId', 'approvedAt', 'expiresAt']) {
    example[key] = 'NOT_APPROVED';
  }
  for (const section of ['aws', 'environment', 'budget', 'authority', 'independentVerification']) {
    for (const key of Object.keys(example[section])) {
      example[section][key] = Array.isArray(example[section][key])
        ? ['NOT_APPROVED']
        : 'NOT_APPROVED';
    }
  }
  for (const key of Object.keys(example.evidence)) {
    example.evidence[key] = 'NOT_RUN';
  }

  const result = validateBillingControlRecord(example, { mode: 'example' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);

  example.budget.monthlyLimitUsd = '200.00';
  const changed = validateBillingControlRecord(example, { mode: 'example' });
  assert.equal(changed.ok, false);
});

test('bootstrap mode permits only post-deploy delivery evidence to remain not run', () => {
  const record = approvedRecord();
  record.evidence.warningDelivery = 'NOT_RUN';
  record.evidence.criticalDelivery = 'NOT_RUN';
  record.evidence.anomalyDelivery = 'NOT_APPLICABLE';
  record.evidence.retainedResourceReview = 'NOT_RUN';

  const bootstrap = validateBillingControlRecord(record, {
    ...validationOptions,
    mode: 'bootstrap',
  });
  assert.deepEqual(bootstrap.errors, []);
  assert.equal(bootstrap.ok, true);

  const final = validateBillingControlRecord(record, validationOptions);
  assert.equal(final.ok, false);
  assert(final.errors.some((error) => error.includes('warningDelivery')));

  record.evidence.accountRegionRole = 'NOT_RUN';
  const missingIdentity = validateBillingControlRecord(record, {
    ...validationOptions,
    mode: 'bootstrap',
  });
  assert.equal(missingIdentity.ok, false);
  assert(missingIdentity.errors.some((error) => error.includes('accountRegionRole')));
});

test('binds anomaly delivery evidence to the selected mechanism', () => {
  const disabled = approvedRecord();
  disabled.evidence.anomalyDelivery = 'PASS';
  const disabledResult = validateBillingControlRecord(disabled, validationOptions);
  assert.equal(disabledResult.ok, false);
  assert(
    disabledResult.errors.some((error) => error.includes('when anomaly detection is disabled')),
  );

  const enabled = approvedRecord();
  enabled.budget.mechanism = 'AWS_BUDGETS_AND_COST_ANOMALY_DETECTION';
  enabled.budget.anomalyMode = 'Create';
  enabled.evidence.anomalyDelivery = 'NOT_APPLICABLE';
  const enabledResult = validateBillingControlRecord(enabled, validationOptions);
  assert.equal(enabledResult.ok, false);
  assert(enabledResult.errors.some((error) => error.includes('when anomaly detection is enabled')));
});

test('binds anomaly configuration to the selected mechanism and approved account', () => {
  const mismatched = approvedRecord();
  mismatched.budget.mechanism = 'AWS_BUDGETS_AND_COST_ANOMALY_DETECTION';
  mismatched.budget.anomalyMode = 'Existing';
  mismatched.budget.existingAnomalyMonitorArn =
    'arn:aws:ce::999999999999:anomalymonitor/not-approved';
  mismatched.evidence.anomalyDelivery = 'PASS';

  const result = validateBillingControlRecord(mismatched, validationOptions);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('approved account')));
});

test('rejects fractional anomaly percentages that the deployment guard cannot accept', () => {
  const record = approvedRecord();
  record.budget.anomalyPercentage = '40.5';

  const result = validateBillingControlRecord(record, validationOptions);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('whole number')));
});

test('requires the independent verifier to be separate from implementation and approval roles', () => {
  const record = approvedRecord();
  record.independentVerification.verifier = record.environment.owner;

  const result = validateBillingControlRecord(record, validationOptions);
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('must be distinct')));
});

test('keeps the deployed control configuration binding stable while evidence matures', () => {
  const finalRecord = approvedRecord();
  const bootstrapRecord = structuredClone(finalRecord);
  bootstrapRecord.evidence.warningDelivery = 'NOT_RUN';
  bootstrapRecord.evidence.criticalDelivery = 'NOT_RUN';
  bootstrapRecord.evidence.retainedResourceReview = 'NOT_RUN';

  const bootstrap = validateBillingControlRecord(bootstrapRecord, {
    ...validationOptions,
    mode: 'bootstrap',
  });
  const final = validateBillingControlRecord(finalRecord, validationOptions);

  assert.equal(bootstrap.ok, true);
  assert.equal(final.ok, true);
  assert.notEqual(bootstrap.canonicalSha256, final.canonicalSha256);
  assert.equal(bootstrap.controlConfigurationSha256, final.controlConfigurationSha256);

  const changedConfiguration = structuredClone(finalRecord);
  changedConfiguration.budget.monthlyLimitUsd = '250.00';
  const changed = validateBillingControlRecord(changedConfiguration, validationOptions);
  assert.notEqual(changed.controlConfigurationSha256, final.controlConfigurationSha256);
});
