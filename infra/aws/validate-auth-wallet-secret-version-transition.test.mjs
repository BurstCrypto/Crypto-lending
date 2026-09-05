import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  AUTH_WALLET_SECRET_FIELDS,
  AUTH_WALLET_TRANSITION_AUTHORITY_KEY_REGISTRY,
  AUTH_WALLET_TRANSITION_INPUT_ERROR,
  DEFAULT_AUTH_WALLET_TRANSITION_RECORD,
  LOCAL_AUTH_WALLET_TRANSITION_ROOT,
  MAX_AUTH_WALLET_VERSION_HISTORY,
  authWalletSecretVersionTransitionSigningBytes,
  authWalletTransitionStateSha256,
  canonicalizeAuthWalletTransitionValue,
  isProductionAuthorizedAuthWalletTransitionReport,
  loadAuthWalletSecretVersionTransitionRecord,
  loadAuthWalletSecretVersionTransitionRecordForTest,
  validateAuthWalletSecretVersionTransition,
  verifyAuthWalletSecretVersionTransitionWithTestRegistry,
} from './validate-auth-wallet-secret-version-transition.mjs';

const validatorPath = join(
  import.meta.dirname,
  'validate-auth-wallet-secret-version-transition.mjs',
);
const NOW = new Date('2026-09-05T12:00:00Z');
const ACCOUNT_ID = '111122223333';
const REGION = 'us-west-2';
const STACK_NAME = 'crypto-lending-application-production';
const STACK_ID =
  'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-production/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SECRET_ARN =
  'arn:aws:secretsmanager:us-west-2:111122223333:secret:crypto-lending/auth-wallet-AbCdEf';
const KMS_ARN = 'arn:aws:kms:us-west-2:111122223333:key/11111111-2222-3333-4444-555555555555';
const HASH = Object.fromEntries(
  [
    'currentDeploymentCaptureSha256',
    'currentManifestSha256',
    'targetManifestSha256',
    'outerVersionInventorySha256',
    'preauthCarryForwardSha256',
    'unchangedFieldsCarryForwardSha256',
    'purposeTransitionSha256',
    'databasePolicyCompatibilitySha256',
    'legacyFunctionDenialSha256',
    'candidateTaskReadinessSha256',
    'taskReplacementPlanSha256',
    'rollbackPlanSha256',
    'retirementReadinessSha256',
  ].map((name) => [name, createHash('sha256').update(`evidence:${name}`).digest('hex')]),
);

function clone(value) {
  return structuredClone(value);
}

function outerVersion(number) {
  return `auth_wallet_outer_version_${String(number).padStart(12, '0')}`;
}

function keyEntry(prefix, version) {
  return { keyId: `${prefix}${version}`, version };
}

const RING_FIXTURES = Object.freeze({
  AUTH_IDENTITY_HMAC_KEY_RING_JSON: ['AUTH_IDENTITY_HMAC', 'identity_v'],
  AUTH_SESSION_HMAC_KEY_RING_JSON: ['AUTH_SESSION_HMAC', 'session_v'],
  AUTH_CSRF_HMAC_KEY_RING_JSON: ['AUTH_CSRF_HMAC', 'csrf_v'],
  WALLET_IDENTITY_HMAC_KEY_RING_JSON: ['WALLET_IDENTITY_HMAC', 'wallet-identity-v'],
  WALLET_CHALLENGE_HMAC_KEY_RING_JSON: ['WALLET_CHALLENGE_HMAC', 'wallet-challenge-v'],
  WALLET_METADATA_SEAL_KEY_RING_JSON: ['WALLET_METADATA_SEAL', 'wallet-metadata-v'],
});

function manifest() {
  const value = { AUTH_PREAUTH_SEAL_KEY: { presence: 'PRESENT' } };
  for (const [fieldName, [purpose, prefix]] of Object.entries(RING_FIXTURES)) {
    const initial = keyEntry(prefix, 1);
    value[fieldName] = {
      purpose,
      activeWriteVersion: 1,
      keys: [initial],
      usedKeys: [initial],
      retiredOrBurnedKeys: [],
    };
  }
  return value;
}

function state(versionNumber = 1) {
  return {
    secretArn: SECRET_ARN,
    kmsKeyArn: KMS_ARN,
    currentVersionId: outerVersion(versionNumber),
    usedVersionIds: Array.from({ length: versionNumber }, (_, index) => outerVersion(index + 1)),
    manifest: manifest(),
  };
}

function deployment() {
  return {
    accountId: ACCOUNT_ID,
    region: REGION,
    stackName: STACK_NAME,
    stackId: STACK_ID,
    environmentName: 'production',
    parentTemplateSha256: 'a'.repeat(64),
    workloadTemplateSha256: 'b'.repeat(64),
  };
}

function approvals() {
  return {
    secretCustodyApprovalRef: 'approval/secret-custody/2026-09-05/ticket-001',
    authenticationApprovalRef: 'approval/authentication/2026-09-05/ticket-002',
    walletApprovalRef: 'approval/wallet/2026-09-05/ticket-003',
    deploymentApprovalRef: 'approval/deployment/2026-09-05/ticket-004',
    rollbackApprovalRef: 'approval/rollback/2026-09-05/ticket-005',
  };
}

function evidence(mode, fieldName, action) {
  const required = new Set();
  if (mode === 'create') {
    for (const key of [
      'targetManifestSha256',
      'outerVersionInventorySha256',
      'databasePolicyCompatibilitySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ])
      required.add(key);
  } else if (mode === 'adopt') {
    for (const key of [
      'currentDeploymentCaptureSha256',
      'currentManifestSha256',
      'outerVersionInventorySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ])
      required.add(key);
  } else {
    for (const key of [
      'currentDeploymentCaptureSha256',
      'currentManifestSha256',
      'targetManifestSha256',
      'outerVersionInventorySha256',
      'preauthCarryForwardSha256',
      'unchangedFieldsCarryForwardSha256',
      'purposeTransitionSha256',
      'databasePolicyCompatibilitySha256',
      'candidateTaskReadinessSha256',
      'taskReplacementPlanSha256',
      'rollbackPlanSha256',
    ])
      required.add(key);
    if (fieldName.startsWith('AUTH_') && action !== 'ABORT_STAGED_SUCCESSOR') {
      required.add('legacyFunctionDenialSha256');
    }
    if (action === 'RETIRE_PREDECESSOR') required.add('retirementReadinessSha256');
  }
  return Object.fromEntries(
    Object.keys(HASH).map((key) => [key, required.has(key) ? HASH[key] : 'NOT_APPLICABLE']),
  );
}

function applyRingOperation(target, fieldName, action) {
  const ring = target.manifest[fieldName];
  const prefix = RING_FIXTURES[fieldName][1];
  if (action === 'STAGE_SUCCESSOR') {
    const next = keyEntry(prefix, 2);
    ring.keys.push(next);
    ring.usedKeys.push(next);
  } else if (action === 'ADD_AND_ACTIVATE_SUCCESSOR') {
    const next = keyEntry(prefix, 2);
    ring.keys.push(next);
    ring.usedKeys.push(next);
    ring.activeWriteVersion = 2;
  } else if (action === 'ACTIVATE_SUCCESSOR') {
    ring.activeWriteVersion = 2;
  } else if (action === 'ABORT_STAGED_SUCCESSOR') {
    const staged = ring.keys.pop();
    ring.retiredOrBurnedKeys.push(staged);
  } else if (action === 'RETIRE_PREDECESSOR') {
    const predecessor = ring.keys.shift();
    ring.retiredOrBurnedKeys.push(predecessor);
  }
}

function recordFor(mode = 'transition', fieldName = 'AUTH_IDENTITY_HMAC_KEY_RING_JSON', action) {
  const selectedAction =
    action ?? (fieldName.startsWith('AUTH_') ? 'STAGE_SUCCESSOR' : 'ADD_AND_ACTIVATE_SUCCESSOR');
  let current = state(1);
  let target = clone(current);
  let operation;
  let predecessor;
  if (mode === 'create') {
    current = null;
    target = state(1);
    operation = { kind: 'CREATE', fieldName: 'ALL_SEVEN_FIELDS', action: 'INITIAL_BINDING' };
    predecessor = { stateSha256: 'NO_DEPLOYED_STATE', transitionSha256: 'NONE' };
  } else if (mode === 'adopt') {
    operation = {
      kind: 'ADOPT',
      fieldName: 'ALL_SEVEN_FIELDS',
      action: 'ADOPT_EXISTING_BINDING',
    };
    predecessor = { stateSha256: 'UNTRACKED', transitionSha256: 'NONE' };
  } else {
    if (
      selectedAction === 'ACTIVATE_SUCCESSOR' ||
      selectedAction === 'ABORT_STAGED_SUCCESSOR' ||
      selectedAction === 'RETIRE_PREDECESSOR'
    ) {
      const ring = current.manifest[fieldName];
      const next = keyEntry(RING_FIXTURES[fieldName][1], 2);
      ring.keys.push(next);
      ring.usedKeys.push(next);
      if (selectedAction === 'RETIRE_PREDECESSOR') ring.activeWriteVersion = 2;
      target = clone(current);
    }
    target.currentVersionId = outerVersion(2);
    target.usedVersionIds.push(outerVersion(2));
    applyRingOperation(target, fieldName, selectedAction);
    operation = { kind: 'TRANSITION', fieldName, action: selectedAction };
    predecessor = {
      stateSha256: authWalletTransitionStateSha256(current),
      transitionSha256: 'c'.repeat(64),
    };
  }
  return {
    schemaVersion: 1,
    artifactType: 'AUTH_WALLET_SECRET_VERSION_TRANSITION',
    content: {
      status: 'APPROVED',
      recordId: `auth-wallet/${mode}/2026-09-05/record-001`,
      issuedAt: '2026-09-05T11:55:00Z',
      expiresAt: '2026-09-05T12:55:00Z',
      deployment: deployment(),
      operation,
      predecessor,
      currentState: current,
      targetState: target,
      requiredSecretFields: [...AUTH_WALLET_SECRET_FIELDS],
      evidence: evidence(mode, fieldName, selectedAction),
      approvals: approvals(),
    },
    signatures: [],
  };
}

const authorityKeyPairs = [generateKeyPairSync('ed25519'), generateKeyPairSync('ed25519')];

function publicDer(pair) {
  return pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

const testRegistry = {
  schemaVersion: 1,
  artifactType: 'AUTH_WALLET_TRANSITION_AUTHORITY_KEY_REGISTRY',
  keys: [
    {
      keyId: 'auth-wallet-transition-issuer-v1',
      algorithm: 'Ed25519',
      status: 'APPROVED',
      role: 'AUTH_WALLET_TRANSITION_ISSUER',
      scope: 'AUTH_WALLET_SECRET_VERSION_TRANSITION',
      publicKeySpkiDerBase64: publicDer(authorityKeyPairs[0]),
      validFrom: '2026-09-01T00:00:00Z',
      validUntil: '2026-09-30T00:00:00Z',
      approvalReferenceId: 'authority/auth-wallet-issuer/2026-09',
    },
    {
      keyId: 'auth-wallet-transition-independent-v1',
      algorithm: 'Ed25519',
      status: 'APPROVED',
      role: 'INDEPENDENT_AUTH_WALLET_TRANSITION_VERIFIER',
      scope: 'AUTH_WALLET_SECRET_VERSION_TRANSITION',
      publicKeySpkiDerBase64: publicDer(authorityKeyPairs[1]),
      validFrom: '2026-09-01T00:00:00Z',
      validUntil: '2026-09-30T00:00:00Z',
      approvalReferenceId: 'authority/auth-wallet-independent/2026-09',
    },
  ],
};

function signRecord(record) {
  record.signatures = [];
  const unsigned = {
    schemaVersion: record.schemaVersion,
    artifactType: record.artifactType,
    content: record.content,
  };
  const bytes = authWalletSecretVersionTransitionSigningBytes(unsigned);
  record.signatures = testRegistry.keys.map((authority, index) => ({
    role: authority.role,
    scope: authority.scope,
    authorityKeyId: authority.keyId,
    algorithm: 'Ed25519',
    valueBase64: sign(null, bytes, authorityKeyPairs[index].privateKey).toString('base64'),
  }));
  return record;
}

function optionsFor(record, mode) {
  return {
    mode,
    now: NOW,
    expectedAccount: ACCOUNT_ID,
    expectedRegion: REGION,
    expectedStack: STACK_NAME,
    expectedStackId: STACK_ID,
    expectedEnvironment: 'production',
    expectedParentTemplateSha256: 'a'.repeat(64),
    expectedWorkloadTemplateSha256: 'b'.repeat(64),
    expectedSecretArn: SECRET_ARN,
    expectedKmsKeyArn: KMS_ARN,
    expectedCurrentVersionId:
      mode === 'create' ? 'NO_DEPLOYED_VERSION' : record.content.currentState.currentVersionId,
    expectedTargetVersionId: record.content.targetState.currentVersionId,
  };
}

function verify(record, mode) {
  return verifyAuthWalletSecretVersionTransitionWithTestRegistry(
    record,
    optionsFor(record, mode),
    testRegistry,
  );
}

function assertAccepted(record, mode) {
  const report = verify(signRecord(record), mode);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.signatureValidated, true);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(report.productionAuthorityValidated, false);
  assert.equal(isProductionAuthorizedAuthWalletTransitionReport(report), false);
  assert.equal(report.plan.executionAllowed, false);
  assert.equal(
    report.predecessorTransitionSha256,
    record.content.predecessor.transitionSha256,
    'accepted reports must expose the exact signed predecessor transition',
  );
  for (const key of [
    'externalCallsMade',
    'awsCallsMade',
    'databaseConnectionsMade',
    'redisConnectionsMade',
    'dnsQueriesMade',
    'httpRequestsMade',
    'resourcesCreated',
    'credentialBytesRead',
    'filesWritten',
  ])
    assert.equal(report[key], 0);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.plan), true);
  return report;
}

function assertRejected(record, mode, pattern) {
  const report = verify(signRecord(record), mode);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), pattern);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(isProductionAuthorizedAuthWalletTransitionReport(report), false);
  return report;
}

test('keeps the checked-in example inert, unsigned, and zero-call', () => {
  const example = JSON.parse(readFileSync(DEFAULT_AUTH_WALLET_TRANSITION_RECORD, 'utf8'));
  const report = validateAuthWalletSecretVersionTransition(example, { mode: 'example' });
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(report.signatureValidated, false);
  assert.equal(AUTH_WALLET_TRANSITION_AUTHORITY_KEY_REGISTRY.keys.length, 0);
  assert.equal(isProductionAuthorizedAuthWalletTransitionReport(report), false);
});

test('accepts signed create and no-op adoption structures only through the unbranded test seam', () => {
  const createReport = assertAccepted(recordFor('create'), 'create');
  assert.equal(createReport.currentStateSha256, 'NO_DEPLOYED_STATE');
  assert.equal(createReport.predecessorTransitionSha256, 'NONE');
  assert.match(createReport.targetStateSha256, /^[a-f0-9]{64}$/u);
  const adoption = recordFor('adopt');
  const adoptReport = assertAccepted(adoption, 'adopt');
  assert.equal(adoptReport.currentStateSha256, adoptReport.targetStateSha256);
  assert.equal(adoptReport.predecessorTransitionSha256, 'NONE');
});

test('binds the reported predecessor transition to the signed record', () => {
  const record = recordFor('transition');
  const signed = signRecord(record);
  const report = verify(signed, 'transition');
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.predecessorTransitionSha256, record.content.predecessor.transitionSha256);

  signed.content.predecessor.transitionSha256 = 'd'.repeat(64);
  const tampered = verifyAuthWalletSecretVersionTransitionWithTestRegistry(
    signed,
    optionsFor(signed, 'transition'),
    testRegistry,
  );
  assert.equal(tampered.ok, false);
  assert.equal(tampered.signatureValidated, false);
  assert.equal(tampered.predecessorTransitionSha256, undefined);
  assert.match(tampered.errors.join('\n'), /production authority registry/u);
});

test('accepts every exact auth and wallet inner-purpose operation', () => {
  for (const field of [
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    'AUTH_SESSION_HMAC_KEY_RING_JSON',
    'AUTH_CSRF_HMAC_KEY_RING_JSON',
  ]) {
    assertAccepted(recordFor('transition', field, 'STAGE_SUCCESSOR'), 'transition');
    assertAccepted(recordFor('transition', field, 'ACTIVATE_SUCCESSOR'), 'transition');
    assertAccepted(recordFor('transition', field, 'ABORT_STAGED_SUCCESSOR'), 'transition');
    assertAccepted(recordFor('transition', field, 'RETIRE_PREDECESSOR'), 'transition');
  }
  for (const field of [
    'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
    'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
    'WALLET_METADATA_SEAL_KEY_RING_JSON',
  ]) {
    assertAccepted(recordFor('transition', field, 'ADD_AND_ACTIVATE_SUCCESSOR'), 'transition');
    assertAccepted(recordFor('transition', field, 'RETIRE_PREDECESSOR'), 'transition');
  }
});

test('rejects create/adopt laundering and any UNPINNED state', () => {
  const create = recordFor('create');
  create.content.currentState = state(1);
  assertRejected(create, 'create', /CREATE currentState|CREATE must establish/u);

  const adoption = recordFor('adopt');
  adoption.content.targetState.currentVersionId = outerVersion(2);
  adoption.content.targetState.usedVersionIds.push(outerVersion(2));
  assertRejected(adoption, 'adopt', /no-op binding adoption/u);

  const claimedPrehistory = recordFor('adopt');
  claimedPrehistory.content.currentState.usedVersionIds.unshift(outerVersion(63));
  claimedPrehistory.content.targetState = clone(claimedPrehistory.content.currentState);
  assertRejected(claimedPrehistory, 'adopt', /no-op binding adoption/u);

  const transition = recordFor('transition');
  transition.content.targetState.currentVersionId = 'UNPINNED';
  transition.content.targetState.usedVersionIds[
    transition.content.targetState.usedVersionIds.length - 1
  ] = 'UNPINNED';
  assertRejected(transition, 'transition', /exact Secrets Manager VersionId|append-only history/u);
});

test('rejects outer history replay, truncation, reordering, overflow, and no-op transitions', () => {
  const mutations = [
    (record) => record.content.targetState.usedVersionIds.pop(),
    (record) => record.content.targetState.usedVersionIds.reverse(),
    (record) => {
      record.content.targetState.currentVersionId = outerVersion(1);
      record.content.targetState.usedVersionIds[1] = outerVersion(1);
    },
    (record) => {
      record.content.currentState.usedVersionIds = Array.from(
        { length: MAX_AUTH_WALLET_VERSION_HISTORY },
        (_, index) => outerVersion(index + 1),
      );
      record.content.currentState.currentVersionId = outerVersion(MAX_AUTH_WALLET_VERSION_HISTORY);
      record.content.targetState = clone(record.content.currentState);
      record.content.targetState.usedVersionIds.push(
        outerVersion(MAX_AUTH_WALLET_VERSION_HISTORY + 1),
      );
      record.content.targetState.currentVersionId = outerVersion(
        MAX_AUTH_WALLET_VERSION_HISTORY + 1,
      );
      applyRingOperation(
        record.content.targetState,
        'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
        'STAGE_SUCCESSOR',
      );
      record.content.predecessor.stateSha256 = authWalletTransitionStateSha256(
        record.content.currentState,
      );
    },
  ];
  for (const mutate of mutations) {
    const record = recordFor('transition');
    mutate(record);
    assertRejected(record, 'transition', /append|history|VersionId/u);
  }
});

test('rejects secret/KMS migration, deployment mismatch, and predecessor mismatch', () => {
  for (const [mutate, pattern] of [
    [
      (record) => {
        record.content.targetState.secretArn = record.content.targetState.secretArn.replace(
          'auth-wallet',
          'attacker',
        );
      },
      /same secret and KMS key|invocation binding/u,
    ],
    [
      (record) => {
        record.content.targetState.kmsKeyArn =
          'arn:aws:kms:us-west-2:111122223333:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      },
      /same secret and KMS key|invocation binding/u,
    ],
    [
      (record) => (record.content.deployment.accountId = '999900001111'),
      /deployment identity|account/u,
    ],
    [
      (record) => {
        record.content.deployment.stackId = record.content.deployment.stackId.replace(
          'arn:aws:',
          'arn:aws-us-gov:',
        );
      },
      /stackId|partition/u,
    ],
    [(record) => (record.content.predecessor.stateSha256 = 'd'.repeat(64)), /predecessor/u],
    [(record) => (record.content.predecessor.transitionSha256 = 'NONE'), /predecessor/u],
  ]) {
    const record = recordFor('transition');
    mutate(record);
    assertRejected(record, 'transition', pattern);
  }
});

test('rejects missing, extra, reordered, and cross-machine manifest fields', () => {
  const missing = recordFor('transition');
  missing.content.requiredSecretFields.pop();
  assertRejected(missing, 'transition', /exact seven/u);

  const reordered = recordFor('transition');
  reordered.content.requiredSecretFields.reverse();
  assertRejected(reordered, 'transition', /exact seven/u);

  for (const extraKey of ['apiDatabase', 'redisOperatorSecretVersionId', 'phase', 'slots']) {
    const extra = recordFor('transition');
    extra.content.targetState[extraKey] = 'forbidden';
    assertRejected(extra, 'transition', /exact reviewed keys/u);
  }

  const extraManifest = recordFor('transition');
  extraManifest.content.targetState.manifest.REDIS_OPERATOR_PASSWORD = { presence: 'PRESENT' };
  assertRejected(extraManifest, 'transition', /exact reviewed keys/u);
});

test('rejects changes to multiple purposes and all preauth content-state changes', () => {
  const multiple = recordFor('transition');
  applyRingOperation(
    multiple.content.targetState,
    'AUTH_SESSION_HMAC_KEY_RING_JSON',
    'STAGE_SUCCESSOR',
  );
  assertRejected(multiple, 'transition', /exactly the one declared/u);

  const preauth = recordFor('transition');
  preauth.content.targetState.manifest.AUTH_PREAUTH_SEAL_KEY.presence = 'CHANGED';
  assertRejected(preauth, 'transition', /exact presence|exactly the one declared/u);
});

test('enforces auth stage/activate/retire and wallet add-and-activate semantics', () => {
  const authActiveTooEarly = recordFor('transition');
  authActiveTooEarly.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON.activeWriteVersion = 2;
  assertRejected(authActiveTooEarly, 'transition', /STAGE_SUCCESSOR/u);

  const walletStageOnly = recordFor(
    'transition',
    'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
    'ADD_AND_ACTIVATE_SUCCESSOR',
  );
  walletStageOnly.content.targetState.manifest.WALLET_IDENTITY_HMAC_KEY_RING_JSON.activeWriteVersion = 1;
  assertRejected(walletStageOnly, 'transition', /ADD_AND_ACTIVATE_SUCCESSOR/u);

  const retireActive = recordFor(
    'transition',
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    'RETIRE_PREDECESSOR',
  );
  const ring = retireActive.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON;
  ring.keys = [keyEntry('identity_v', 1)];
  ring.activeWriteVersion = 1;
  ring.retiredOrBurnedKeys = [keyEntry('identity_v', 2)];
  assertRejected(retireActive, 'transition', /RETIRE_PREDECESSOR|retiredOrBurnedKeys/u);

  const walletWrongAction = recordFor('transition', 'WALLET_IDENTITY_HMAC_KEY_RING_JSON');
  walletWrongAction.content.operation.action = 'STAGE_SUCCESSOR';
  assertRejected(walletWrongAction, 'transition', /reviewed auth or wallet ring operation/u);

  const inactiveWalletSuccessor = recordFor(
    'transition',
    'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
    'ADD_AND_ACTIVATE_SUCCESSOR',
  );
  inactiveWalletSuccessor.content.currentState.manifest.WALLET_IDENTITY_HMAC_KEY_RING_JSON.keys.push(
    keyEntry('wallet-identity-v', 2),
  );
  inactiveWalletSuccessor.content.currentState.manifest.WALLET_IDENTITY_HMAC_KEY_RING_JSON.usedKeys.push(
    keyEntry('wallet-identity-v', 2),
  );
  inactiveWalletSuccessor.content.predecessor.stateSha256 = authWalletTransitionStateSha256(
    inactiveWalletSuccessor.content.currentState,
  );
  assertRejected(inactiveWalletSuccessor, 'transition', /highest retained version/u);

  const multipleStagedAuth = recordFor(
    'transition',
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    'ACTIVATE_SUCCESSOR',
  );
  for (const stateName of ['currentState', 'targetState']) {
    const stagedRing =
      multipleStagedAuth.content[stateName].manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON;
    stagedRing.keys.push(keyEntry('identity_v', 3));
    stagedRing.usedKeys.push(keyEntry('identity_v', 3));
  }
  multipleStagedAuth.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON.activeWriteVersion = 3;
  multipleStagedAuth.content.predecessor.stateSha256 = authWalletTransitionStateSha256(
    multipleStagedAuth.content.currentState,
  );
  assertRejected(
    multipleStagedAuth,
    'transition',
    /at most one staged successor|ACTIVATE_SUCCESSOR/u,
  );
});

test('ABORT_STAGED_SUCCESSOR burns the sole bad auth candidate without reusing it', () => {
  const report = assertAccepted(
    recordFor('transition', 'AUTH_IDENTITY_HMAC_KEY_RING_JSON', 'ABORT_STAGED_SUCCESSOR'),
    'transition',
  );
  assert.equal(report.operation, 'ABORT_STAGED_SUCCESSOR');

  const wrong = recordFor(
    'transition',
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    'ABORT_STAGED_SUCCESSOR',
  );
  wrong.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON.usedKeys.pop();
  assertRejected(wrong, 'transition', /usedKeys|ABORT_STAGED_SUCCESSOR/u);
});

test('malformed nested programmatic inputs return sanitized failures and never throw', () => {
  const mutations = [
    (record) => (record.content = null),
    (record) => (record.content.currentState = 'wrong'),
    (record) => (record.content.targetState = []),
    (record) => (record.content.currentState.manifest = null),
    (record) => (record.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON = null),
    (record) => (record.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON.keys = null),
    (record) => (record.content.operation = 'wrong'),
    (record) => (record.content.evidence = null),
  ];
  for (const mutate of mutations) {
    const record = recordFor('transition');
    mutate(record);
    let report;
    assert.doesNotThrow(() => {
      report = verifyAuthWalletSecretVersionTransitionWithTestRegistry(
        record,
        optionsFor(recordFor('transition'), 'transition'),
        testRegistry,
      );
    });
    assert.equal(report.ok, false);
    assert.equal(report.readyForAuthorizedPlan, false);
    assert.equal(isProductionAuthorizedAuthWalletTransitionReport(report), false);
    assert.doesNotMatch(report.errors.join('\n'), /TypeError|Cannot read|\.mjs:/u);
  }
});

test('rejects key-ID reuse and non-append-only inner histories', () => {
  const reused = recordFor('transition');
  reused.content.targetState.manifest.AUTH_SESSION_HMAC_KEY_RING_JSON.usedKeys[0].keyId =
    'identity_v1';
  reused.content.targetState.manifest.AUTH_SESSION_HMAC_KEY_RING_JSON.keys[0].keyId = 'identity_v1';
  assertRejected(reused, 'transition', /reuse a keyId/u);

  const history = recordFor('transition');
  history.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON.usedKeys.reverse();
  assertRejected(history, 'transition', /strictly increasing|STAGE_SUCCESSOR/u);
});

test('requires operation-specific distinct sanitized evidence and preauth carry-forward', () => {
  const missing = recordFor('transition');
  missing.content.evidence.preauthCarryForwardSha256 = 'NOT_APPLICABLE';
  assertRejected(missing, 'transition', /preauthCarryForwardSha256/u);

  const duplicate = recordFor('transition');
  duplicate.content.evidence.targetManifestSha256 =
    duplicate.content.evidence.currentManifestSha256;
  assertRejected(duplicate, 'transition', /distinct domain-specific/u);

  const wallet = recordFor('transition', 'WALLET_IDENTITY_HMAC_KEY_RING_JSON');
  wallet.content.evidence.legacyFunctionDenialSha256 = HASH.legacyFunctionDenialSha256;
  assertRejected(wallet, 'transition', /NOT_APPLICABLE/u);

  const retirement = recordFor(
    'transition',
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    'RETIRE_PREDECESSOR',
  );
  retirement.content.evidence.retirementReadinessSha256 = 'NOT_APPLICABLE';
  assertRejected(retirement, 'transition', /retirementReadinessSha256/u);
});

test('rejects unknown keys, secret-bearing extensions, and duplicate approvals', () => {
  const extra = recordFor('transition');
  extra.content.secretValue = 'prohibited';
  assertRejected(extra, 'transition', /exact reviewed keys/u);

  const material = recordFor('transition');
  material.content.targetState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON.keys[1].material =
    'prohibited';
  assertRejected(material, 'transition', /exact reviewed keys/u);

  const disguisedMaterial = recordFor('transition');
  const currentRing =
    disguisedMaterial.content.currentState.manifest.AUTH_IDENTITY_HMAC_KEY_RING_JSON;
  currentRing.keys[0].keyId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789_-material';
  currentRing.usedKeys[0].keyId = currentRing.keys[0].keyId;
  disguisedMaterial.content.predecessor.stateSha256 = authWalletTransitionStateSha256(
    disguisedMaterial.content.currentState,
  );
  assertRejected(disguisedMaterial, 'transition', /purpose-bound non-secret key ID form/u);

  const approvalsMutation = recordFor('transition');
  approvalsMutation.content.approvals.walletApprovalRef =
    approvalsMutation.content.approvals.authenticationApprovalRef;
  assertRejected(approvalsMutation, 'transition', /mutually independent/u);

  const unstructuredApproval = recordFor('transition');
  unstructuredApproval.content.approvals.walletApprovalRef =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789_-material';
  assertRejected(unstructuredApproval, 'transition', /bounded, non-secret/u);
});

test('rejects stale, future, overlong, and deployment-mismatched records', () => {
  for (const [mutate, pattern] of [
    [(record) => (record.content.expiresAt = '2026-09-05T12:00:00Z'), /active now/u],
    [(record) => (record.content.issuedAt = '2026-09-05T12:01:00Z'), /active now/u],
    [(record) => (record.content.expiresAt = '2026-09-06T12:56:00Z'), /at most 24 hours/u],
  ]) {
    const record = recordFor('transition');
    mutate(record);
    assertRejected(record, 'transition', pattern);
  }
  const record = signRecord(recordFor('transition'));
  const options = optionsFor(record, 'transition');
  options.expectedStackId = options.expectedStackId.replace('aaaaaaaa', 'bbbbbbbb');
  const report = verifyAuthWalletSecretVersionTransitionWithTestRegistry(
    record,
    options,
    testRegistry,
  );
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /deployment identity/u);
});

test('validates signatures but never gives the test seam the private production brand', () => {
  const record = signRecord(recordFor('transition'));
  const report = verify(record, 'transition');
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.signatureValidated, true);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(isProductionAuthorizedAuthWalletTransitionReport(report), false);
  assert.equal(isProductionAuthorizedAuthWalletTransitionReport(clone(report)), false);
  assert.equal(
    isProductionAuthorizedAuthWalletTransitionReport({
      ...report,
      readyForAuthorizedPlan: true,
      productionAuthorityValidated: true,
    }),
    false,
  );
  const structural = validateAuthWalletSecretVersionTransition(record, {
    ...optionsFor(record, 'transition'),
    mode: 'transition',
  });
  assert.equal(structural.ok, false);
  assert.match(structural.errors.join('\n'), /production authority path/u);
});

test('rejects signature tampering, role/scope substitution, key windows, and key reuse', () => {
  for (const mutate of [
    (record) => (record.content.targetState.currentVersionId = outerVersion(3)),
    (record) => (record.signatures[0].scope = 'READ_ONLY'),
    (record) => (record.signatures[0].role = 'INDEPENDENT_AUTH_WALLET_TRANSITION_VERIFIER'),
    (record) => (record.signatures[0].valueBase64 = Buffer.alloc(64).toString('base64')),
  ]) {
    const record = signRecord(recordFor('transition'));
    mutate(record);
    const report = verify(record, 'transition');
    assert.equal(report.ok, false);
    assert.equal(report.readyForAuthorizedPlan, false);
  }

  const expiredRegistry = clone(testRegistry);
  expiredRegistry.keys[0].validUntil = '2026-09-05T12:30:00Z';
  const record = signRecord(recordFor('transition'));
  let report = verifyAuthWalletSecretVersionTransitionWithTestRegistry(
    record,
    optionsFor(record, 'transition'),
    expiredRegistry,
  );
  assert.equal(report.ok, false);

  const duplicateKeyRegistry = clone(testRegistry);
  duplicateKeyRegistry.keys[1].publicKeySpkiDerBase64 =
    duplicateKeyRegistry.keys[0].publicKeySpkiDerBase64;
  report = verifyAuthWalletSecretVersionTransitionWithTestRegistry(
    record,
    optionsFor(record, 'transition'),
    duplicateKeyRegistry,
  );
  assert.equal(report.ok, false);
});

test('signing bytes are canonical, domain separated, and cover the complete unsigned record', () => {
  const record = recordFor('transition');
  const unsigned = {
    schemaVersion: record.schemaVersion,
    artifactType: record.artifactType,
    content: record.content,
  };
  const first = authWalletSecretVersionTransitionSigningBytes(unsigned);
  const reordered = {
    content: clone(unsigned.content),
    artifactType: unsigned.artifactType,
    schemaVersion: unsigned.schemaVersion,
  };
  assert.deepEqual(first, authWalletSecretVersionTransitionSigningBytes(reordered));
  assert.match(
    first.toString('utf8'),
    /^crypto-lending:auth-wallet-secret-version-transition:v1\n/u,
  );
  reordered.content.recordId = 'auth-wallet/changed/2026-09-05';
  assert.notDeepEqual(first, authWalletSecretVersionTransitionSigningBytes(reordered));
});

test('secure loader accepts only canonical operational files under the ignored location', () => {
  mkdirSync(LOCAL_AUTH_WALLET_TRANSITION_ROOT, { recursive: true });
  const directory = mkdtempSync(join(LOCAL_AUTH_WALLET_TRANSITION_ROOT, 'auth-wallet-test-'));
  const canonicalPath = join(directory, 'approved.auth-wallet-transition.local.json');
  const prettyPath = join(directory, 'pretty.auth-wallet-transition.local.json');
  const duplicatePath = join(directory, 'duplicate.auth-wallet-transition.local.json');
  try {
    const record = signRecord(recordFor('transition'));
    writeFileSync(canonicalPath, canonicalizeAuthWalletTransitionValue(record), 'utf8');
    assert.deepEqual(
      loadAuthWalletSecretVersionTransitionRecord(canonicalPath, 'transition'),
      record,
    );
    writeFileSync(prettyPath, JSON.stringify(record, null, 2), 'utf8');
    assert.throws(
      () => loadAuthWalletSecretVersionTransitionRecord(prettyPath, 'transition'),
      new RegExp(AUTH_WALLET_TRANSITION_INPUT_ERROR.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
    writeFileSync(
      duplicatePath,
      '{"artifactType":"AUTH_WALLET_SECRET_VERSION_TRANSITION","artifactType":"DUPLICATE"}',
      'utf8',
    );
    assert.throws(
      () => loadAuthWalletSecretVersionTransitionRecord(duplicatePath, 'transition'),
      /bounded, canonical, stable/u,
    );
    assert.throws(
      () =>
        loadAuthWalletSecretVersionTransitionRecord(
          DEFAULT_AUTH_WALLET_TRANSITION_RECORD,
          'transition',
        ),
      /bounded, canonical, stable/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('secure loader rejects hard links, symlinks, and same-size read races', () => {
  mkdirSync(LOCAL_AUTH_WALLET_TRANSITION_ROOT, { recursive: true });
  const directory = mkdtempSync(join(LOCAL_AUTH_WALLET_TRANSITION_ROOT, 'auth-wallet-files-'));
  const source = join(directory, 'source.auth-wallet-transition.local.json');
  const linked = join(directory, 'linked.auth-wallet-transition.local.json');
  const symlinked = join(directory, 'symlinked.auth-wallet-transition.local.json');
  try {
    const record = signRecord(recordFor('transition'));
    const canonical = canonicalizeAuthWalletTransitionValue(record);
    writeFileSync(source, canonical, 'utf8');
    linkSync(source, linked);
    assert.throws(
      () => loadAuthWalletSecretVersionTransitionRecord(linked, 'transition'),
      /bounded, canonical, stable/u,
    );
    rmSync(linked, { force: true });
    try {
      symlinkSync(source, symlinked, 'file');
      assert.throws(
        () => loadAuthWalletSecretVersionTransitionRecord(symlinked, 'transition'),
        /bounded, canonical, stable/u,
      );
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code)) throw error;
    }
    assert.throws(
      () =>
        loadAuthWalletSecretVersionTransitionRecordForTest(source, 'transition', () => {
          const mutated = canonical.replace(outerVersion(2), outerVersion(3));
          assert.equal(Buffer.byteLength(mutated), Buffer.byteLength(canonical));
          writeFileSync(source, mutated, 'utf8');
        }),
      /bounded, canonical, stable/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('real CLI validates only the inert example and cannot use test authority', () => {
  const example = spawnSync(process.execPath, [validatorPath, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(example.status, 0, example.stderr);
  const exampleReport = JSON.parse(example.stdout);
  assert.equal(exampleReport.ok, true);
  assert.equal(exampleReport.readyForAuthorizedPlan, false);

  mkdirSync(LOCAL_AUTH_WALLET_TRANSITION_ROOT, { recursive: true });
  const directory = mkdtempSync(join(LOCAL_AUTH_WALLET_TRANSITION_ROOT, 'auth-wallet-cli-'));
  const path = join(directory, 'signed.auth-wallet-transition.local.json');
  try {
    const record = signRecord(recordFor('transition'));
    writeFileSync(path, canonicalizeAuthWalletTransitionValue(record), 'utf8');
    const arguments_ = [
      validatorPath,
      '--record',
      path,
      '--mode',
      'transition',
      '--at',
      '2026-09-05T12:00:00Z',
      '--expected-account',
      ACCOUNT_ID,
      '--expected-region',
      REGION,
      '--expected-stack',
      STACK_NAME,
      '--expected-stack-id',
      STACK_ID,
      '--expected-environment',
      'production',
      '--expected-parent-template-sha256',
      'a'.repeat(64),
      '--expected-workload-template-sha256',
      'b'.repeat(64),
      '--expected-secret-arn',
      SECRET_ARN,
      '--expected-kms-key-arn',
      KMS_ARN,
      '--expected-current-version-id',
      outerVersion(1),
      '--expected-target-version-id',
      outerVersion(2),
      '--json',
    ];
    const operational = spawnSync(process.execPath, arguments_, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(operational.status, 1);
    const report = JSON.parse(operational.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.productionAuthorityValidated, false);
    assert.equal(report.awsCallsMade, 0);
    assert.match(report.errors.join('\n'), /production authority registry/u);

    const forbidden = spawnSync(process.execPath, [validatorPath, '--registry', path], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(forbidden.status, 2);
    assert.doesNotMatch(
      forbidden.stderr,
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('source has no external-call, secret-read, signing, or filesystem-write capability', () => {
  const source = readFileSync(validatorPath, 'utf8');
  for (const forbidden of [
    /node:child_process/u,
    /node:(?:http|https|net|tls|dns)/u,
    /@aws-sdk/u,
    /generateKeyPair|createPrivateKey|\bsign\s+as|\bsign\(/u,
    /writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink/u,
    /GetSecretValue|BatchGetSecretValue/u,
  ])
    assert.doesNotMatch(source, forbidden);
});
