import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  REQUIRED_RESULTS,
  REPOSITORY_ROOT,
  REVIEW_REGISTER_PATH,
  validateWalletReviewFiles,
  validateWalletReviewRegister,
  validateWalletReviewSidecar,
} from './validate-kan-227-wallet-review.mjs';

const NOW = new Date('2026-08-23T00:00:00.000Z');

function loadRegister() {
  return JSON.parse(readFileSync(`${REPOSITORY_ROOT}/${REVIEW_REGISTER_PATH}`, 'utf8'));
}

function repositoryFor(register, overrides = {}) {
  return {
    candidateCommit: register.candidate.executableCommit,
    baseCommit: register.candidate.packetPreparationBaseCommit,
    candidateTree: register.candidate.executableTree,
    baseTree: register.candidate.executableTree,
    candidateIsAncestor: true,
    scopeClean: true,
    manifestSha256: register.candidate.packageManifestSha256,
    lockSha256: register.candidate.packageLockSha256,
    versions: structuredClone(register.versions),
    artifactHashes: Object.fromEntries(
      register.supportingArtifacts.map(({ path, sha256 }) => [path, sha256]),
    ),
    evidenceExists: () => true,
    ...overrides,
  };
}

function validate(register, repository = repositoryFor(register)) {
  return validateWalletReviewRegister(register, { now: NOW, repository });
}

test('the checked-in preparation packet is valid and remains pending', () => {
  const register = loadRegister();
  assert.deepEqual(validate(register), { errors: [], ready: false });
  assert.deepEqual(validateWalletReviewFiles({ now: NOW }), { errors: [], ready: false });
});

test('the sidecar rejects changed register bytes without touching workspace files', () => {
  const registerBytes = readFileSync(`${REPOSITORY_ROOT}/${REVIEW_REGISTER_PATH}`);
  const sidecar = readFileSync(
    `${REPOSITORY_ROOT}/docs/wallets/review/kan-227-consolidated-review.sha256`,
    'utf8',
  );
  assert.deepEqual(validateWalletReviewSidecar(registerBytes, sidecar), []);
  assert.deepEqual(
    validateWalletReviewSidecar(Buffer.concat([registerBytes, Buffer.from(' ')]), sidecar),
    ['KAN-227 SHA-256 sidecar does not exactly bind the register bytes.'],
  );
});

test('the closed crosswalk uses canonical environments and exact mobile cases', () => {
  const byId = new Map(REQUIRED_RESULTS.map((row) => [row[0], row]));
  const environments = new Set(REQUIRED_RESULTS.flatMap((row) => row[3]));
  assert.deepEqual([...environments].sort(), ['A1', 'D1', 'D2', 'D3', 'H1', 'P1', 'S1']);
  assert.equal(byId.has('DESKTOP_METAMASK_D2'), false);
  assert.deepEqual(byId.get('MOBILE_M1_METAMASK')?.[4], [
    'MM02',
    'MM04',
    'WC01',
    'WC03a',
    'WC04',
    'WC06',
    'WC09',
    'WC10',
  ]);
  assert.deepEqual(byId.get('MOBILE_M1_COINBASE')?.[4], ['CB04']);
  assert.deepEqual(byId.get('MOBILE_M3_WALLETCONNECT_A')?.[4], ['WC02', 'WC12']);
  assert.deepEqual(byId.get('MOBILE_M3_PHANTOM')?.[4], ['PH02', 'PH08']);
  assert.deepEqual(byId.get('MOBILE_M2_PHANTOM_S1')?.[4], ['PHANTOM_S1_SMOKE_OR_ABSENCE']);
});

test('deleting any closed requirement is rejected', () => {
  const register = loadRegister();
  register.requiredResults.splice(20, 1);
  assert.ok(
    validate(register).errors.some((error) => error.includes('requiredResults must contain')),
  );
});

test('schema 1 cannot turn arbitrary contained evidence into a terminal result', () => {
  const register = loadRegister();
  register.requiredResults[0].status = 'PASS';
  register.requiredResults[0].evidenceFiles = ['docs/wallets/evidence/results/arbitrary.txt'];
  const result = validate(register);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes('future evidence-ingestion schema')));
});

test('the Phantom Firefox absence can never be represented as Pass', () => {
  const register = loadRegister();
  const row = register.requiredResults.find(({ id }) => id === 'DESKTOP_PHANTOM_D2_ABSENCE');
  row.status = 'PASS';
  row.evidenceFiles = ['docs/wallets/evidence/results/phantom-firefox.json'];
  assert.ok(validate(register).errors.some((error) => error.includes('documented absence')));
});

test('schema 1 rejects fabricated terminal decisions and readiness', () => {
  const register = loadRegister();
  register.status = 'READY_FOR_IN_REVIEW';
  register.decisions[0].status = 'DECIDED';
  register.decisions[0].reviewer = {
    name: 'Security Team',
    identity: 'person:security-team',
    role: 'Security reviewer',
    independenceStatement: 'Coordinator-authored alias is not an independent approval.',
  };
  register.decisions[0].decidedAt = '2026-08-22T01:00:00.000Z';
  register.decisions[0].expiresAt = '2027-08-22T01:00:00.000Z';
  register.decisions[0].result = 'APPROVED';
  register.decisions[0].evidenceFiles = ['docs/wallets/review/decisions/fabricated.md'];
  const errors = validate(register).errors;
  assert.ok(errors.some((error) => error.includes('preparation-only packet')));
  assert.ok(errors.some((error) => error.includes('future evidence-ingestion schema')));
});

test('repository candidate, lock, artifact, and clean-scope drift fail closed', () => {
  for (const overrides of [
    { candidateTree: '0'.repeat(40) },
    { lockSha256: '0'.repeat(64) },
    { scopeClean: false },
    { artifactHashes: {} },
  ]) {
    const register = loadRegister();
    assert.notEqual(validate(register, repositoryFor(register, overrides)).errors.length, 0);
  }
});

test('external review binding remains a non-circular pending attestation', () => {
  const register = loadRegister();
  register.externalReviewBinding = {
    status: 'ATTESTED',
    attestedCommit: register.candidate.packetPreparationBaseCommit,
    attestedTree: register.candidate.executableTree,
    registerSha256: 'A'.repeat(64),
  };
  assert.ok(validate(register).errors.some((error) => error.includes('post-commit attestation')));
});

test('mobile physical-platform and distinct-app coverage stays an explicit limitation', () => {
  const register = loadRegister();
  const limitation = register.limitations.find(
    ({ id }) => id === 'MOBILE_PLATFORM_DIVERSITY_UNPROVEN',
  );
  assert.deepEqual(limitation.ownerTickets, ['KAN-226']);
  assert.match(limitation.summary, /iOS and Android/u);
  assert.match(limitation.summary, /distinct applications/u);
});

test('malformed collections return validation errors instead of throwing', () => {
  const mutations = [
    (register) => {
      register.requiredResults = null;
    },
    (register) => {
      register.decisions[0].conditions = null;
    },
    (register) => {
      register.signoffs[0].evidenceFiles = {};
    },
    (register) => {
      register.supportingArtifacts = [null];
    },
    (register) => {
      register.candidate = null;
    },
  ];
  for (const mutate of mutations) {
    const register = loadRegister();
    const repository = repositoryFor(register);
    mutate(register);
    assert.doesNotThrow(() => validate(register, repository));
    assert.notEqual(validate(register, repository).errors.length, 0);
  }
});
