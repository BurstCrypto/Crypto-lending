import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  applicationBaselinePath,
  computeLoggerContractFingerprint,
  governancePath,
  isEvidenceFileWithinRepository,
  loggingContextPath,
  structuredLoggerPath,
  validateCanonicalGovernance,
  validateGovernanceRecord,
  validateLoggerContract,
  validateRetentionTemplate,
} from './validate-kan-248-logging-governance.mjs';

function canonicalRecord() {
  return JSON.parse(readFileSync(governancePath, 'utf8'));
}

function errorsFor(record) {
  return validateGovernanceRecord(record, { evidenceExists: () => true });
}

function loggerSources() {
  return {
    context: readFileSync(loggingContextPath, 'utf8'),
    logger: readFileSync(structuredLoggerPath, 'utf8'),
  };
}

test('accepts the fingerprint-bound draft while reporting no effective approval', () => {
  const result = validateCanonicalGovernance();

  assert.deepEqual(result.errors, []);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/u);
  assert.match(result.loggerFingerprint, /^[0-9a-f]{64}$/u);
  const record = canonicalRecord();
  assert.equal(record.effectiveStatus, 'NOT_EFFECTIVE');
  assert(record.approvalGate.reviewers.every(({ status }) => status === 'PENDING'));
});

test('fails closed when dependency or reviewer evidence claims completion', () => {
  const record = canonicalRecord();
  record.dependencyGate.observedStatus = 'DONE';
  record.dependencyGate.status = 'SATISFIED';
  record.approvalGate.status = 'APPROVED';
  record.approvalGate.reviewers[0].status = 'APPROVED';
  record.approvalGate.reviewers[0].decisionReference = 'local-author';
  record.approvalGate.reviewers[0].decidedAt = '2026-08-24T00:00:00Z';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('KAN-220 dependency')));
  assert(errors.some((error) => error.includes('approvalGate.status')));
  assert(errors.some((error) => error.includes('null decision evidence')));
  assert(errors.filter((error) => error.includes('unauthorized effective decision')).length >= 2);
});

test('keeps the independent decision and binding vocabularies exact', () => {
  const record = canonicalRecord();
  record.approvalGate.allowedDecisions.push('SELF_APPROVED');
  record.approvalGate.requiredBindings = ['packetSha256'];
  record.approvalGate.reviewers.pop();

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('allowedDecisions must equal exactly')));
  assert(errors.some((error) => error.includes('requiredBindings must equal exactly')));
  assert(errors.some((error) => error.includes('exactly Security, Privacy, and Operations')));
});

test('classifies exactly every logger correlation field as restricted', () => {
  const record = canonicalRecord();
  record.correlationFields = record.correlationFields.filter(({ name }) => name !== 'messageId');
  record.correlationFields.find(({ name }) => name === 'initiatorActorId').classification =
    'INTERNAL';
  record.correlationFields.push({ ...record.correlationFields[0] });

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('classification must equal RESTRICTED')));
  assert(errors.some((error) => error.includes('duplicate correlationId')));
  assert(errors.some((error) => error.includes('exactly every reviewed logger linkage field')));
});

test('preserves actor provenance and diagnostic-only authority boundaries', () => {
  const record = canonicalRecord();
  record.actorIdentities.find(({ name }) => name === 'initiatorActorId').authority =
    'AUTHENTICATION_AUTHORITY';
  record.actorIdentities.find(({ name }) => name === 'durableAuditActor').authority = 'LOG_RECORD';
  record.correlationFields.find(({ name }) => name === 'transactionId').authority =
    'FINANCIAL_AUTHORITY';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('initiatorActorId must remain')));
  assert(errors.some((error) => error.includes('durableAuditActor')));
  assert(errors.some((error) => error.includes('transactionId must remain only')));
});

test('detects context, event, and field allowlist drift in the actual logger sources', () => {
  const source = loggerSources();
  const mutatedContext = source.context.replace("  'ledgerEventId',\n", '');
  const mutatedLogger = source.logger
    .replace("  'parentSpanId',\n  'spanName',", "  'spanName',")
    .replace("    'messageId',\n    'receiveCount',", "    'receiveCount',");

  const errors = validateLoggerContract(mutatedContext, mutatedLogger);
  assert(errors.some((error) => error.includes('CONTEXT_KEYS drifted')));
  assert(errors.some((error) => error.includes('SAFE_FIELD_KEYS drifted')));
  assert(errors.some((error) => error.includes('field allowlist drifted')));
});

test('binds exact logger bytes with a deterministic domain-separated fingerprint', () => {
  const source = loggerSources();
  const first = computeLoggerContractFingerprint(source.context, source.logger);
  const second = computeLoggerContractFingerprint(source.context, source.logger);
  const changed = computeLoggerContractFingerprint(`${source.context}\n`, source.logger);

  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.match(first, /^[0-9a-f]{64}$/u);
});

test('enforces least privilege, environment separation, and non-standing break glass', () => {
  const record = canonicalRecord();
  record.accessControl.default = 'ALLOW';
  record.accessControl.environmentSeparation = [];
  const writer = record.accessControl.matrix.find(({ role }) => role === 'application-log-writer');
  writer.explicitDenials = ['DELETE'];
  const developer = record.accessControl.matrix.find(({ role }) => role === 'developer');
  developer.explicitDenials = [];
  record.accessControl.breakGlass.maximumMinutes = 61;

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('default must equal DENY')));
  assert(errors.some((error) => error.includes('environmentSeparation')));
  assert(errors.some((error) => error.includes('writer.explicitDenials')));
  assert(errors.some((error) => error.includes('developer.explicitDenials')));
  assert(errors.some((error) => error.includes('between 1 and 60')));
});

test('pins retention to the template and keeps legal hold unimplemented', () => {
  const record = canonicalRecord();
  record.retentionAndDeletion.standardApplicationLogDays = 90;
  record.retentionAndDeletion.templateAllowedDays.push(365);
  record.retentionAndDeletion.legalHold.implementationStatus = 'IMPLEMENTED';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('standardApplicationLogDays')));
  assert(errors.some((error) => error.includes('templateAllowedDays')));
  assert(errors.some((error) => error.includes('Legal hold must remain explicitly pending')));

  const template = readFileSync(applicationBaselinePath, 'utf8');
  assert.deepEqual(validateRetentionTemplate(template), []);
  const mutated = template
    .replace(
      /(LogRetentionDays:\r?\n +Type: Number\r?\n +)Default: 14\r?\n( +)AllowedValues: \[1, 3, 5, 7, 14, 30, 60, 90\]/u,
      '$1Default: 90\n$2AllowedValues: [1, 3, 5, 7, 14, 30, 60, 90, 365]',
    )
    .replace(/(^ +)RetentionInDays: !Ref LogRetentionDays\r?$/mu, '$1RetentionInDays: 90');
  const templateErrors = validateRetentionTemplate(mutated);
  assert(templateErrors.some((error) => error.includes('default must remain 14')));
  assert(templateErrors.some((error) => error.includes('allowlist drifted')));
  assert(templateErrors.some((error) => error.includes('ApiLogGroup')));
});

test('rejects nested decoys for retention parameters and resource properties', () => {
  const template = readFileSync(applicationBaselinePath, 'utf8');
  const nestedParameterDecoy = template.replace(
    /(LogRetentionDays:\r?\n +Type: Number\r?\n +)Default: 14/u,
    '$1Metadata:\n   Default: 14',
  );
  assert(
    validateRetentionTemplate(nestedParameterDecoy).some((error) =>
      error.includes('LogRetentionDays declaration is missing or malformed'),
    ),
  );

  const nestedResourceDecoy = template.replace(
    /(^ +)RetentionInDays: !Ref LogRetentionDays\r?$/mu,
    '$1Metadata:\n$1 RetentionInDays: !Ref LogRetentionDays',
  );
  assert(
    validateRetentionTemplate(nestedResourceDecoy).some((error) =>
      error.includes('ApiLogGroup must bind retention exactly'),
    ),
  );
});

test('preserves immutable financial-record boundaries', () => {
  const record = canonicalRecord();
  record.retentionAndDeletion.immutableFinancialRecordBoundary = [
    'Logs can replace the book of record and authorize ledger updates.',
  ];

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('at least 4')));
  for (const phrase of [
    'never the book of record',
    'only a pivot',
    'must never update',
    'reversal or compensation',
  ]) {
    assert(errors.some((error) => error.includes(phrase)));
  }
});

test('requires bounded incident filters and excludes actor and financial IDs by default', () => {
  const record = canonicalRecord();
  record.incidentQueryPolicy.minimumFilters.requiredForEveryQuery = ['environment'];
  record.incidentQueryPolicy.minimumFilters.initialWindowMinutes = 1440;
  record.incidentQueryPolicy.minimumFilters.defaultProjection.push(
    'initiatorActorId',
    'transactionId',
    'ledgerEventId',
  );
  record.incidentQueryPolicy.authorizedUseCases[0].primarySelectors.push('walletAddress');

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('requiredForEveryQuery must equal exactly')));
  assert(errors.some((error) => error.includes('time bounds')));
  for (const field of ['initiatorActorId', 'transactionId', 'ledgerEventId']) {
    assert(errors.some((error) => error.includes(`exclude ${field}`)));
  }
  assert(errors.some((error) => error.includes('walletAddress is not a reviewed logger field')));
});

test('retains accountable owners, review cadence, exceptions, re-review, and pending gates', () => {
  const record = canonicalRecord();
  record.ownershipAndReview.owners.pop();
  record.ownershipAndReview.cadence = [];
  record.ownershipAndReview.exceptionRequirements = [];
  record.ownershipAndReview.reReviewTriggers = [];
  record.unresolvedGates = ['none'];

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('Security, Privacy, Operations, and Records')));
  assert(errors.some((error) => error.includes('cadence')));
  assert(errors.some((error) => error.includes('exceptionRequirements')));
  assert(errors.some((error) => error.includes('reReviewTriggers')));
  assert(errors.some((error) => error.includes('KAN-220 gate')));
});

test('rejects unknown schema fields including fabricated approval metadata', () => {
  const record = canonicalRecord();
  record.approvedBy = 'local-author';
  record.approvalGate.reviewers[0].approver = 'local-author';
  record.accessControl.breakGlass.permanent = true;
  record.retentionAndDeletion.legalHold.approvedAt = '2026-08-24T00:00:00Z';

  const errors = errorsFor(record);
  for (const field of ['record.approvedBy', 'approver', 'permanent', 'approvedAt']) {
    assert(errors.some((error) => error.includes(field)));
  }
});

test('accepts only real regular evidence files contained by the repository root', (context) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'kan248-evidence-root-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'kan248-evidence-outside-'));
  context.after(() => {
    rmSync(fixtureRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  });
  mkdirSync(join(fixtureRoot, 'docs'));
  writeFileSync(join(fixtureRoot, 'docs', 'evidence.md'), 'review evidence\n');
  writeFileSync(join(outsideRoot, 'outside.md'), 'outside\n');

  assert.equal(isEvidenceFileWithinRepository('docs/evidence.md', fixtureRoot), true);
  assert.equal(isEvidenceFileWithinRepository('docs', fixtureRoot), false);
  assert.equal(isEvidenceFileWithinRepository('../outside.md', fixtureRoot), false);
  symlinkSync(outsideRoot, join(fixtureRoot, 'docs', 'linked'), 'junction');
  assert.equal(isEvidenceFileWithinRepository('docs/linked/outside.md', fixtureRoot), false);
});

test('returns validation errors instead of throwing for malformed collections', () => {
  for (const field of [
    'actorIdentities',
    'correlationFields',
    'localEvidence',
    'unresolvedGates',
  ]) {
    const record = canonicalRecord();
    record[field] = {};
    assert.doesNotThrow(() => errorsFor(record));
    assert(errorsFor(record).some((error) => error.includes(field)));
  }
});
