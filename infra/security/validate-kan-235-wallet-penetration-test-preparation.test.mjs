import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  EXPECTED_PREPARATION_SHA256,
  EXPECTED_THREAT_MODEL_SHA256,
  MAX_PREPARATION_BYTES,
  MAX_SIDECAR_BYTES,
  MAX_THREAT_MODEL_BYTES,
  PREPARATION_FILE_ERROR,
  PREPARATION_JSON_ERROR,
  PREPARATION_PATH,
  PREPARATION_SIDECAR_ERROR,
  REPOSITORY_ROOT,
  SIDECAR_PATH,
  THREAT_MODEL_PATH,
  parsePreparationBytes,
  validateCanonicalPreparation,
  validatePreparationFilesForTest,
  validatePreparationRecord,
  validatePreparationSidecar,
} from './validate-kan-235-wallet-penetration-test-preparation.mjs';

function canonicalBytes() {
  return readFileSync(join(REPOSITORY_ROOT, PREPARATION_PATH));
}

function canonicalRecord() {
  return JSON.parse(canonicalBytes().toString('utf8'));
}

function canonicalThreatModelBytes() {
  return readFileSync(join(REPOSITORY_ROOT, THREAT_MODEL_PATH));
}

function sidecarFor(bytes) {
  return `${createHash('sha256').update(bytes).digest('hex')}\n`;
}

function writeFixture(root, bytes, sidecar = sidecarFor(bytes)) {
  const directory = join(root, 'docs', 'security');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(root, PREPARATION_PATH), bytes);
  writeFileSync(join(root, SIDECAR_PATH), sidecar);
  writeFileSync(join(root, THREAT_MODEL_PATH), canonicalThreatModelBytes());
}

test('canonical preparation is valid but cannot authorize review, execution, or launch', () => {
  const record = canonicalRecord();
  assert.deepEqual(validatePreparationRecord(record), []);
  assert.deepEqual(validateCanonicalPreparation(), {
    errors: [],
    fingerprint: EXPECTED_PREPARATION_SHA256,
    ready: false,
  });
  assert.equal(record.status, 'PENDING_EXTERNAL_REVIEW');
  assert.equal(record.evidenceStatus, 'PENDING');
  assert.equal(record.decisionStatus, 'PENDING');
  assert.equal(record.scope.executionEnvironment, 'NOT_AUTHORIZED');
  assert.equal(record.scope.executionMode, 'PLAN_ONLY_NO_TEST_EXECUTION');
  assert.equal(record.scope.mayAuthorizeLaunch, false);
  assert.equal(record.scope.mayAuthorizeFinancialAction, false);
  assert.deepEqual(record.scope.networkFamilies, ['ETHEREUM', 'SOLANA']);
  assert.equal(record.candidateBinding.walletReviewPrerequisite.status, 'PENDING');
  assert.equal(record.candidateBinding.walletReviewPrerequisite.sha256, null);
  assert(record.requiredEvidence.every(({ status }) => status === 'PENDING'));
  assert.equal(record.blockers.length, 8);
});

test('every attempted approval, execution, scope, evidence, or cost promotion fails closed', () => {
  const mutations = [
    (record) => (record.status = 'APPROVED'),
    (record) => (record.evidenceStatus = 'COMPLETE'),
    (record) => (record.decisionStatus = 'APPROVED'),
    (record) => (record.scope.executionEnvironment = 'PRODUCTION'),
    (record) => (record.scope.mainnetTransactions = 'ALLOWED'),
    (record) => (record.scope.mayAuthorizeLaunch = true),
    (record) => record.scope.networkFamilies.push('BASE'),
    (record) => (record.candidateBinding.releaseCommitSha = 'a'.repeat(40)),
    (record) => (record.candidateBinding.walletReviewPrerequisite.status = 'COMPLETE'),
    (record) => (record.candidateBinding.walletReviewPrerequisite.sha256 = 'b'.repeat(64)),
    (record) => (record.reviewerBoundary.independentReviewerAssigned = true),
    (record) => (record.testPlan[0].status = 'PASSED'),
    (record) => (record.requiredEvidence[0].status = 'VERIFIED'),
    (record) => (record.findingPolicy.decision = 'APPROVED'),
    (record) => record.blockers.pop(),
    (record) => (record.zeroCostEvidence.penetrationTestsExecuted = 1),
    (record) => (record.unknownApproval = true),
  ];
  mutations.forEach((mutate, index) => {
    const record = canonicalRecord();
    mutate(record);
    assert.ok(validatePreparationRecord(record).length > 0, `mutation ${index} must fail closed`);
  });
});

test('strict parsing rejects matching-sidecar duplicate keys, BOM, and malformed UTF-8', () => {
  const bytes = canonicalBytes();
  const text = bytes.toString('utf8');
  const hostile = [
    Buffer.from(
      text.replace(
        '  "status": "PENDING_EXTERNAL_REVIEW",',
        '  "status": "APPROVED",\n  "status": "PENDING_EXTERNAL_REVIEW",',
      ),
      'utf8',
    ),
    Buffer.from(
      text.replace(
        '    "mayAuthorizeLaunch": false,',
        '    "mayAuthorizeLaunch": true,\n    "mayAuthorizeLaunch": false,',
      ),
      'utf8',
    ),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
  ];

  assert.deepEqual(validatePreparationRecord(JSON.parse(hostile[0].toString('utf8'))), []);
  assert.deepEqual(validatePreparationRecord(JSON.parse(hostile[1].toString('utf8'))), []);
  for (const sourceBytes of hostile) {
    assert.deepEqual(validatePreparationSidecar(sourceBytes, sidecarFor(sourceBytes)), []);
    assert.throws(
      () => parsePreparationBytes(sourceBytes),
      (error) => error instanceof Error && error.message === PREPARATION_JSON_ERROR,
    );
    const root = mkdtempSync(join(tmpdir(), 'kan235-strict-json-'));
    try {
      writeFixture(root, sourceBytes);
      assert.deepEqual(validatePreparationFilesForTest(root), {
        errors: [PREPARATION_JSON_ERROR],
        fingerprint: null,
        ready: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('compiled fingerprint rejects a semantically valid self-resealed preparation', () => {
  const sourceBytes = Buffer.from(
    canonicalBytes()
      .toString('utf8')
      .replace(
        'Verify wallet state cannot create',
        'Independently verify wallet state cannot create',
      ),
    'utf8',
  );
  const fingerprint = createHash('sha256').update(sourceBytes).digest('hex');
  assert.deepEqual(validatePreparationRecord(JSON.parse(sourceBytes.toString('utf8'))), []);
  assert.notEqual(fingerprint, EXPECTED_PREPARATION_SHA256);

  const root = mkdtempSync(join(tmpdir(), 'kan235-resealed-'));
  try {
    writeFixture(root, sourceBytes);
    assert.deepEqual(validatePreparationFilesForTest(root), {
      errors: ['KAN-235 preparation bytes do not match the compiled reviewed fingerprint.'],
      fingerprint,
      ready: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the reviewed threat-model dependency is loaded securely and bound to its exact bytes', () => {
  const bytes = canonicalBytes();
  const root = mkdtempSync(join(tmpdir(), 'kan235-threat-model-'));
  try {
    writeFixture(root, bytes);
    const changedThreatModel = Buffer.from(canonicalThreatModelBytes());
    changedThreatModel[changedThreatModel.byteLength - 1] ^= 1;
    writeFileSync(join(root, THREAT_MODEL_PATH), changedThreatModel);
    assert.deepEqual(validatePreparationFilesForTest(root), {
      errors: ['KAN-235 reviewed KAN-49 threat-model binding is stale.'],
      fingerprint: EXPECTED_PREPARATION_SHA256,
      ready: false,
    });
    assert.equal(
      createHash('sha256').update(canonicalThreatModelBytes()).digest('hex'),
      EXPECTED_THREAT_MODEL_SHA256,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sidecar format is exact and cannot be trim-aliased', () => {
  const bytes = canonicalBytes();
  for (const sidecar of [EXPECTED_PREPARATION_SHA256, `${EXPECTED_PREPARATION_SHA256} `]) {
    const root = mkdtempSync(join(tmpdir(), 'kan235-sidecar-'));
    try {
      writeFixture(root, bytes, sidecar);
      assert.deepEqual(validatePreparationFilesForTest(root), {
        errors: [PREPARATION_SIDECAR_ERROR],
        fingerprint: EXPECTED_PREPARATION_SHA256,
        ready: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('secure loading rejects oversized, empty, and hard-linked controlled artifacts', () => {
  const bytes = canonicalBytes();
  const sidecar = readFileSync(join(REPOSITORY_ROOT, SIDECAR_PATH));
  const cases = [
    (root) => writeFixture(root, Buffer.alloc(MAX_PREPARATION_BYTES + 1, 0x20), sidecar),
    (root) => writeFixture(root, bytes, Buffer.alloc(0)),
    (root) => writeFixture(root, bytes, Buffer.alloc(MAX_SIDECAR_BYTES + 1, 0x30)),
    (root) => {
      writeFixture(root, bytes, sidecar);
      writeFileSync(join(root, THREAT_MODEL_PATH), Buffer.alloc(MAX_THREAT_MODEL_BYTES + 1, 0x20));
    },
    (root) => {
      const directory = join(root, 'docs', 'security');
      mkdirSync(directory, { recursive: true });
      const source = join(directory, 'source.json');
      writeFileSync(source, bytes);
      linkSync(source, join(root, PREPARATION_PATH));
      writeFileSync(join(root, SIDECAR_PATH), sidecar);
    },
  ];

  for (const prepare of cases) {
    const root = mkdtempSync(join(tmpdir(), 'kan235-secure-file-'));
    try {
      prepare(root);
      assert.deepEqual(validatePreparationFilesForTest(root), {
        errors: [PREPARATION_FILE_ERROR],
        fingerprint: null,
        ready: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('validator has no network, wallet, provider, subprocess, or paid-tool path', () => {
  const source = readFileSync(
    join(
      REPOSITORY_ROOT,
      'infra/security/validate-kan-235-wallet-penetration-test-preparation.mjs',
    ),
    'utf8',
  );
  for (const forbidden of [
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:dns',
    'node:child_process',
    'fetch(',
    'new WebSocket',
    'sendTransaction',
    'eth_call',
    '@solana/web3.js',
    'ethers',
    'viem',
  ]) {
    assert.equal(source.includes(forbidden), false, `validator must not contain ${forbidden}`);
  }
});
