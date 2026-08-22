import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  isEvidenceFileWithinRepository,
  threatModelPath,
  validateCanonicalThreatModel,
  validateThreatModelRecord,
} from './validate-kan-49-threat-model.mjs';

function canonicalRecord() {
  return JSON.parse(readFileSync(threatModelPath, 'utf8'));
}

function errorsFor(record) {
  return validateThreatModelRecord(record, { evidenceExists: () => true });
}

test('accepts the canonical fingerprint-bound KAN-49 register', () => {
  assert.deepEqual(validateCanonicalThreatModel().errors, []);
});

test('requires independent review and forbids local approval claims', () => {
  const record = canonicalRecord();
  record.independentApproval.status = 'APPROVED';
  record.independentApproval.selfApprovalForbidden = false;
  record.independentApproval.requiredBinding = ['registerSha256'];

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('must remain PENDING')));
  assert(errors.some((error) => error.includes('selfApprovalForbidden')));
  assert(errors.some((error) => error.includes('gitCommitSha')));
  assert(errors.some((error) => error.includes('gitTreeSha')));
});

test('keeps independent decision and evidence binding vocabularies exact', () => {
  const record = canonicalRecord();
  record.independentApproval.requiredDecision.push('SELF_APPROVED');
  record.independentApproval.requiredBinding.push('authorStatement');

  let errors = errorsFor(record);
  assert(errors.some((error) => error.includes('requiredDecision must equal exactly')));
  assert(errors.some((error) => error.includes('requiredBinding must equal exactly')));

  record.independentApproval.requiredDecision = ['APPROVED', 'APPROVED', 'REJECTED'];
  record.independentApproval.requiredBinding = ['gitCommitSha', 'gitCommitSha', 'registerSha256'];
  errors = errorsFor(record);
  assert(errors.some((error) => error.includes('requiredDecision must equal exactly')));
  assert(errors.some((error) => error.includes('requiredBinding must equal exactly')));
});

test('rejects approval claims outside the pending independent-review record', () => {
  const record = canonicalRecord();
  record.securityApproval = 'APPROVED';
  record.threats[0].approval = 'APPROVED';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('securityApproval is an unauthorized')));
  assert(errors.some((error) => error.includes('threats[0].approval is an unauthorized')));
  assert(errors.some((error) => error.includes('unauthorized approval decision claim')));
});

test('requires owner, mitigation, residual risk, evidence, and follow-up on threats', () => {
  const record = canonicalRecord();
  const threat = record.threats[0];
  threat.owner = '';
  threat.mitigations = [];
  threat.residualRisk = '';
  threat.evidence = [];
  threat.followUp = '';

  const errors = errorsFor(record);
  for (const field of ['owner', 'mitigations', 'residualRisk', 'evidence', 'followUp']) {
    assert(
      errors.some((error) => error.includes(field)),
      `missing ${field} error`,
    );
  }
});

test('rejects dangling threat references and duplicate register identifiers', () => {
  const record = canonicalRecord();
  record.threats[0].boundaryIds = ['TB-UNKNOWN'];
  record.threats[0].assetIds = ['DATA-UNKNOWN'];
  record.dataAssets[1].id = record.dataAssets[0].id;

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('unknown boundary')));
  assert(errors.some((error) => error.includes('unknown asset')));
  assert(errors.some((error) => error.includes('duplicate id')));
});

test('requires prohibited data to be never collected, stored, or logged', () => {
  const record = canonicalRecord();
  const prohibited = record.dataAssets.find(
    ({ classification }) => classification === 'PROHIBITED',
  );
  prohibited.stores = ['unsafe store'];
  prohibited.retention = 'FOREVER';
  prohibited.logging = 'ALLOWED';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('PROHIBITED')));
});

test('requires high-risk coverage for every platform threat domain', () => {
  const record = canonicalRecord();
  record.threats = record.threats.filter(({ domain }) => domain !== 'ADMIN');

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('domain ADMIN')));
});

test('rejects any field shaped like raw secret material', () => {
  const record = canonicalRecord();
  record.secretInventory[0].actualValue = 'must-not-be-recorded';
  record.secretInventory[1].client_secret = 'must-not-be-recorded';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('actualValue is forbidden')));
  assert(errors.some((error) => error.includes('client_secret is forbidden')));
});

test('rejects every unknown schema field, including secret-shaped aliases', () => {
  const record = canonicalRecord();
  record.unexpected = 'arbitrary';
  record.secretInventory[0].secret = 'placeholder-only';
  record.secretInventory[0].authorization = 'placeholder-only';
  record.threats[0].unexpected = 'arbitrary';

  const errors = errorsFor(record);
  for (const field of [
    'record.unexpected',
    'secretInventory[0].secret',
    'secretInventory[0].authorization',
    'threats[0].unexpected',
  ]) {
    assert(errors.some((error) => error.includes(`${field} is not an allowed field`)));
  }
});

test('requires every evidence path to exist', () => {
  const record = canonicalRecord();
  const errors = validateThreatModelRecord(record, { evidenceExists: () => false });

  assert(errors.some((error) => error.includes('does not exist in the repository')));
});

test('accepts only real regular evidence files contained by the repository root', (context) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'kan49-evidence-root-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'kan49-evidence-outside-'));
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

test('retains every reviewed baseline identifier', () => {
  const record = canonicalRecord();
  record.trustBoundaries = record.trustBoundaries.slice(0, 8);
  record.dataAssets = record.dataAssets.slice(0, 1);
  record.secretInventory = record.secretInventory.slice(0, 6);
  record.threats = record.threats.filter(({ id }) => id.endsWith('-001'));

  const errors = errorsFor(record);
  for (const id of ['TB-11', 'DATA-016', 'KEY-012', 'THR-ADMIN-006']) {
    assert(
      errors.some((error) => error.includes(id)),
      `missing baseline ${id} error`,
    );
  }
});

test('enforces exact classification ranks and handling text', () => {
  const record = canonicalRecord();
  const publicLevel = record.classificationLevels.find(({ name }) => name === 'PUBLIC');
  const restrictedLevel = record.classificationLevels.find(({ name }) => name === 'RESTRICTED');
  [publicLevel.rank, restrictedLevel.rank] = [restrictedLevel.rank, publicLevel.rank];
  publicLevel.handling = 'x';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('rank does not match')));
  assert(errors.some((error) => error.includes('handling does not match')));
});

test('rejects unbounded retention and placeholder accountability text', () => {
  const record = canonicalRecord();
  record.dataAssets[0].retention = 'FOREVER';
  record.threats[0].owner = 'nobody';
  record.threats[0].mitigations = ['TODO'];
  record.threats[0].residualRisk = 'none';
  record.threats[0].followUp = 'unknown';

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('bounded lifecycle')));
  assert(errors.some((error) => error.includes('accountable repository roles')));
  assert(errors.filter((error) => error.includes('non-placeholder')).length >= 3);
});

test('rejects directory placeholders as evidence', () => {
  const record = canonicalRecord();
  record.threats[0].evidence = ['.'];

  const errors = errorsFor(record);
  assert(errors.some((error) => error.includes('repository-relative path')));
});

test('returns validation errors instead of throwing for malformed register collections', () => {
  for (const field of ['trustBoundaries', 'dataAssets', 'secretInventory', 'threats']) {
    const record = canonicalRecord();
    record[field] = {};
    assert.doesNotThrow(() => errorsFor(record));
    assert(errorsFor(record).some((error) => error.includes(`${field} must be`)));
  }
});
