import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  EXPECTED_THREAT_MODEL_SHA256,
  MAX_THREAT_MODEL_BYTES,
  MAX_THREAT_MODEL_SIDECAR_BYTES,
  THREAT_MODEL_FILE_ERROR,
  THREAT_MODEL_JSON_ERROR,
  THREAT_MODEL_SIDECAR_ERROR,
  isEvidenceFileWithinRepository,
  parseThreatModelBytes,
  threatModelFingerprintPath,
  threatModelPath,
  validateCanonicalThreatModel,
  validateCanonicalThreatModelForTest,
  validateThreatModelRecord,
} from './validate-kan-49-threat-model.mjs';

function writeThreatModelFixture(root, sourceBytes, sidecarBytes) {
  const directory = join(root, 'docs', 'security');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'threat-model-register.json'), sourceBytes);
  writeFileSync(join(directory, 'threat-model-register.sha256'), sidecarBytes);
}

function canonicalRecord() {
  return JSON.parse(readFileSync(threatModelPath, 'utf8'));
}

function errorsFor(record) {
  return validateThreatModelRecord(record, { evidenceExists: () => true });
}

test('accepts the canonical fingerprint-bound KAN-49 register', () => {
  assert.deepEqual(validateCanonicalThreatModel(), {
    errors: [],
    fingerprint: EXPECTED_THREAT_MODEL_SHA256,
  });
});

test('strict parsing rejects matching-sidecar duplicate keys and a byte-order mark', () => {
  const canonicalBytes = readFileSync(threatModelPath);
  const canonicalText = canonicalBytes.toString('utf8');
  const hostileBytes = [
    Buffer.from(canonicalText.replace('{\n', '{\n  "schemaVersion": 999,\n'), 'utf8'),
    Buffer.from(
      canonicalText.replace(
        '  "independentApproval": {\n',
        '  "independentApproval": {\n    "status": "APPROVED",\n',
      ),
      'utf8',
    ),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonicalBytes]),
  ];

  for (const sourceBytes of hostileBytes) {
    const fingerprint = createHash('sha256').update(sourceBytes).digest('hex');
    assert.notEqual(fingerprint, EXPECTED_THREAT_MODEL_SHA256);
    assert.throws(
      () => parseThreatModelBytes(sourceBytes),
      (error) => error instanceof Error && error.message === THREAT_MODEL_JSON_ERROR,
    );
    const root = mkdtempSync(join(tmpdir(), 'kan49-strict-json-'));
    try {
      writeThreatModelFixture(root, sourceBytes, `${fingerprint}\n`);
      assert.deepEqual(validateCanonicalThreatModelForTest(root), {
        errors: [THREAT_MODEL_JSON_ERROR],
        fingerprint: null,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }

  for (const sourceBytes of hostileBytes.slice(0, 2)) {
    assert.deepEqual(
      validateThreatModelRecord(JSON.parse(sourceBytes.toString('utf8')), {
        evidenceExists: () => true,
      }),
      [],
    );
  }
});

test('compiled fingerprint rejects a semantically valid self-resealed register', () => {
  const canonicalText = readFileSync(threatModelPath, 'utf8');
  const sourceBytes = Buffer.from(
    canonicalText.replace(
      'supply-chain boundaries",',
      'supply-chain boundaries with locally resealed drift",',
    ),
    'utf8',
  );
  const fingerprint = createHash('sha256').update(sourceBytes).digest('hex');
  assert.deepEqual(
    validateThreatModelRecord(JSON.parse(sourceBytes.toString('utf8')), {
      evidenceExists: () => true,
    }),
    [],
  );

  const root = mkdtempSync(join(tmpdir(), 'kan49-resealed-'));
  try {
    writeThreatModelFixture(root, sourceBytes, `${fingerprint}\n`);
    assert.deepEqual(validateCanonicalThreatModelForTest(root), {
      errors: ['Canonical threat model bytes do not match the compiled reviewed fingerprint.'],
      fingerprint,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('sidecar format is exact and rejects trim-equivalent aliases', () => {
  const canonicalBytes = readFileSync(threatModelPath);
  for (const sidecar of [EXPECTED_THREAT_MODEL_SHA256, `${EXPECTED_THREAT_MODEL_SHA256} `]) {
    const root = mkdtempSync(join(tmpdir(), 'kan49-sidecar-format-'));
    try {
      writeThreatModelFixture(root, canonicalBytes, sidecar);
      assert.deepEqual(validateCanonicalThreatModelForTest(root), {
        errors: [THREAT_MODEL_SIDECAR_ERROR],
        fingerprint: EXPECTED_THREAT_MODEL_SHA256,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test('canonical file loading rejects oversized, empty, and hard-linked artifacts', () => {
  const canonicalBytes = readFileSync(threatModelPath);
  const canonicalSidecar = readFileSync(threatModelFingerprintPath);
  const cases = [
    (root) =>
      writeThreatModelFixture(
        root,
        Buffer.alloc(MAX_THREAT_MODEL_BYTES + 1, 0x20),
        canonicalSidecar,
      ),
    (root) => writeThreatModelFixture(root, canonicalBytes, Buffer.alloc(0)),
    (root) =>
      writeThreatModelFixture(
        root,
        canonicalBytes,
        Buffer.alloc(MAX_THREAT_MODEL_SIDECAR_BYTES + 1, 0x30),
      ),
    (root) => {
      const directory = join(root, 'docs', 'security');
      mkdirSync(directory, { recursive: true });
      const source = join(directory, 'source.json');
      writeFileSync(source, canonicalBytes);
      linkSync(source, join(directory, 'threat-model-register.json'));
      writeFileSync(join(directory, 'threat-model-register.sha256'), canonicalSidecar);
    },
  ];

  for (const prepare of cases) {
    const root = mkdtempSync(join(tmpdir(), 'kan49-secure-file-'));
    try {
      prepare(root);
      assert.deepEqual(validateCanonicalThreatModelForTest(root), {
        errors: [THREAT_MODEL_FILE_ERROR],
        fingerprint: null,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
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
  for (const id of ['TB-11', 'DATA-017', 'KEY-015', 'THR-ADMIN-006']) {
    assert(
      errors.some((error) => error.includes(id)),
      `missing baseline ${id} error`,
    );
  }
});

test('keeps wallet proof data separate from durable registration identity and keys', () => {
  const record = canonicalRecord();
  const ephemeralProof = record.dataAssets.find(({ id }) => id === 'DATA-005');
  const durableIdentity = record.dataAssets.find(({ id }) => id === 'DATA-017');
  const walletKeys = record.secretInventory.filter(({ id }) =>
    ['KEY-013', 'KEY-014', 'KEY-015'].includes(id),
  );

  assert.match(ephemeralProof.name, /Ephemeral wallet ownership-proof/u);
  assert.match(ephemeralProof.retention, /MEMORY_ONLY/u);
  assert(durableIdentity.stores.some((store) => store.includes('AES-256-GCM ciphertext')));
  assert(durableIdentity.stores.some((store) => store.includes('keyed address digest')));
  assert.match(
    durableIdentity.retention,
    /PREPARED_EXPIRED_CHALLENGE_ATOMICALLY_TERMINALIZED_AUDITED_AND_CRYPTO_SHREDDED/u,
  );
  assert.doesNotMatch(durableIdentity.retention, /EXPIRY_PURGE_POLICY_PENDING/u);
  assert.equal(walletKeys.length, 3);
  assert(walletKeys.every(({ injection }) => injection.includes('disabled by default')));
  assert(walletKeys.every(({ injection }) => injection.includes('local tests')));
  assert(walletKeys.every(({ storage }) => storage.includes('process-memory')));
  assert(walletKeys.every(({ rotation }) => rotation.includes('KAN-235')));
});

test('limits the locally mitigated wallet proof boundary to registration', () => {
  const record = canonicalRecord();
  const threat = record.threats.find(({ id }) => id === 'THR-WALLET-002');

  assert.equal(threat.response, 'MITIGATE');
  assert.equal(threat.status, 'MITIGATED_LOCAL');
  assert(threat.assetIds.includes('DATA-005'));
  assert(threat.assetIds.includes('DATA-017'));
  assert(threat.boundaryIds.includes('TB-03'));
  assert(
    threat.mitigations.some((mitigation) => mitigation.includes('registration ownership only')),
  );
  assert.match(threat.residualRisk, /covers wallet registration only/u);
  assert.match(threat.residualRisk, /no login or transaction authority/u);
  assert.equal(record.independentApproval.status, 'PENDING');
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
