import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import test from 'node:test';

import { fixedSlotCredentialStateSha256 } from './validate-fixed-slot-credential-transition.mjs';
import {
  DEFAULT_REDIS_OPERATOR_TRANSITION_RECORD,
  LOCAL_REDIS_OPERATOR_TRANSITION_ROOT,
  MAX_REDIS_OPERATOR_TRANSITION_RECORD_BYTES,
  REDIS_OPERATOR_TRANSITION_AUTHORITY_KEY_REGISTRY,
  canonicalizeRedisOperatorTransitionValue,
  isProductionAuthorizedRedisOperatorTransitionReport,
  loadRedisOperatorSecretVersionTransitionRecord,
  loadRedisOperatorSecretVersionTransitionRecordForTest,
  redisOperatorSecretVersionTransitionSigningBytes,
  redisOperatorTransitionStateSha256,
  validateRedisOperatorSecretVersionTransition,
  verifyRedisOperatorSecretVersionTransitionWithTestRegistry,
} from './validate-redis-operator-secret-version-transition.mjs';

const validatorPath = join(
  import.meta.dirname,
  'validate-redis-operator-secret-version-transition.mjs',
);
const validatorSource = readFileSync(validatorPath, 'utf8');
const NOW = new Date('2026-09-05T12:00:00Z');
const ACCOUNT_ID = '111122223333';
const REGION = 'us-west-2';
const STACK_NAME = 'crypto-lending-application-production';
const STACK_ID =
  'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-production/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const WORKLOAD_STACK_ID =
  'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-production-WorkloadBoundaries/bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const SECRET_ARN =
  'arn:aws:secretsmanager:us-west-2:111122223333:secret:crypto-lending/production/redis/operator-AbCdEf';
const KMS_ARN = 'arn:aws:kms:us-west-2:111122223333:key/11111111-2222-3333-4444-555555555555';
const OPERATOR_USER_ID = 'cl-production-ro';
const EVIDENCE_KEYS = [
  'currentDeploymentCaptureSha256',
  'secretKmsAndUserBindingSha256',
  'operatorDisabledAndTaskAbsentSha256',
  'operatorConnectionAbsenceSha256',
  'targetVersionInventorySha256',
  'targetSecretSchemaSha256',
  'redisUserUpdatePlanSha256',
  'candidateAuthenticationPlanSha256',
  'oldAuthenticationDenialPlanSha256',
  'runtimeContinuityPlanSha256',
  'forwardRecoveryPlanSha256',
  'unrelatedStatePreservationPlanSha256',
];

mkdirSync(LOCAL_REDIS_OPERATOR_TRANSITION_ROOT, { recursive: true });

function digest(label) {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

function versionId(label, generation = 1) {
  return `${label}_${generation}`.padEnd(32, 'x');
}

function slot(scope, name) {
  const currentVersionId = versionId(`${scope}_${name}`);
  return { generation: 1, currentVersionId, usedVersionIds: [currentVersionId] };
}

function scopeState(scope) {
  return {
    phase: 'A_ONLY',
    slots: { a: slot(scope, 'a'), b: slot(scope, 'b') },
    preparation: null,
    overlap: null,
  };
}

function fixedState(operatorGeneration = 1) {
  const operatorVersion = versionId('redis_operator', operatorGeneration);
  return {
    operatorMode: 'DISABLED',
    redisOperatorSecretVersionId: operatorVersion,
    redisOperatorUsedVersionIds: Array.from({ length: operatorGeneration }, (_, index) =>
      versionId('redis_operator', index + 1),
    ),
    apiDatabase: scopeState('api_database'),
    workerDatabase: scopeState('worker_database'),
    redis: scopeState('redis_api'),
  };
}

function deployment() {
  return {
    accountId: ACCOUNT_ID,
    region: REGION,
    stackName: STACK_NAME,
    stackId: STACK_ID,
    workloadStackId: WORKLOAD_STACK_ID,
    environmentName: 'production',
    parentTemplateSha256: digest('parent-template'),
    workloadTemplateSha256: digest('workload-template'),
    observabilityTemplateSha256: digest('observability-template'),
    secretArn: SECRET_ARN,
    kmsKeyArn: KMS_ARN,
    operatorUserId: OPERATOR_USER_ID,
  };
}

function evidence(mode) {
  return Object.fromEntries(
    EVIDENCE_KEYS.map((key, index) => [
      key,
      mode === 'transition' || index < 6 ? digest(`${mode}:evidence:${key}`) : 'NOT_APPLICABLE',
    ]),
  );
}

function approvals() {
  return {
    secretCustodyApprovalRef: 'approval/secret-custody/2026-09-05/ticket-001',
    redisSecurityApprovalRef: 'approval/redis-security/2026-09-05/ticket-002',
    deploymentApprovalRef: 'approval/deployment/2026-09-05/ticket-003',
    rollbackApprovalRef: 'approval/rollback/2026-09-05/ticket-004',
  };
}

function recordFor(mode = 'transition') {
  const currentState = fixedState(1);
  const targetState = mode === 'transition' ? fixedState(2) : structuredClone(currentState);
  return {
    schemaVersion: 1,
    artifactType: 'REDIS_OPERATOR_SECRET_VERSION_TRANSITION',
    content: {
      status: 'APPROVED',
      recordId: `redis-operator/${mode}/2026-09-05/record-001`,
      issuedAt: '2026-09-05T11:55:00Z',
      expiresAt: '2026-09-05T12:55:00Z',
      deployment: deployment(),
      operation: {
        kind: mode === 'adopt' ? 'ADOPT' : 'TRANSITION',
        fieldName: 'REDIS_OPERATOR_SECRET_VERSION_ID',
        action: mode === 'adopt' ? 'ADOPT_EXISTING_BINDING' : 'ROTATE_DISABLED_OPERATOR_CREDENTIAL',
      },
      predecessors: {
        redisOperatorStateSha256:
          mode === 'adopt' ? 'UNTRACKED' : redisOperatorTransitionStateSha256(currentState),
        redisOperatorTransitionSha256: mode === 'adopt' ? 'NONE' : digest('prior-redis-head'),
        credentialStateSha256: fixedSlotCredentialStateSha256(currentState),
        credentialTransitionSha256: digest('prior-composite-head'),
        authWalletStateSha256: digest('preserved-auth-wallet-state'),
        authWalletTransitionSha256: digest('preserved-auth-wallet-head'),
      },
      currentState,
      targetState,
      evidence: evidence(mode),
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
  artifactType: 'REDIS_OPERATOR_TRANSITION_AUTHORITY_KEY_REGISTRY',
  keys: [
    {
      keyId: 'redis-operator-transition-issuer-v1',
      algorithm: 'Ed25519',
      status: 'APPROVED',
      role: 'REDIS_OPERATOR_TRANSITION_ISSUER',
      scope: 'REDIS_OPERATOR_SECRET_VERSION_TRANSITION',
      publicKeySpkiDerBase64: publicDer(authorityKeyPairs[0]),
      validFrom: '2026-09-01T00:00:00Z',
      validUntil: '2026-09-30T00:00:00Z',
      approvalReferenceId: 'authority/redis-operator-issuer/2026-09',
    },
    {
      keyId: 'redis-operator-transition-independent-v1',
      algorithm: 'Ed25519',
      status: 'APPROVED',
      role: 'INDEPENDENT_REDIS_OPERATOR_TRANSITION_VERIFIER',
      scope: 'REDIS_OPERATOR_SECRET_VERSION_TRANSITION',
      publicKeySpkiDerBase64: publicDer(authorityKeyPairs[1]),
      validFrom: '2026-09-01T00:00:00Z',
      validUntil: '2026-09-30T00:00:00Z',
      approvalReferenceId: 'authority/redis-operator-independent/2026-09',
    },
  ],
};

function signRecord(record) {
  record.signatures = [];
  const signingBytes = redisOperatorSecretVersionTransitionSigningBytes({
    schemaVersion: record.schemaVersion,
    artifactType: record.artifactType,
    content: record.content,
  });
  record.signatures = testRegistry.keys.map((authority, index) => ({
    role: authority.role,
    scope: authority.scope,
    authorityKeyId: authority.keyId,
    algorithm: 'Ed25519',
    valueBase64: sign(null, signingBytes, authorityKeyPairs[index].privateKey).toString('base64'),
  }));
  return record;
}

function optionsFor(record, mode) {
  const {
    deployment: identity,
    predecessors,
    operation,
    currentState,
    targetState,
  } = record.content;
  return {
    mode,
    now: NOW,
    expectedAccount: identity.accountId,
    expectedRegion: identity.region,
    expectedStack: identity.stackName,
    expectedStackId: identity.stackId,
    expectedWorkloadStackId: identity.workloadStackId,
    expectedEnvironment: identity.environmentName,
    expectedParentTemplateSha256: identity.parentTemplateSha256,
    expectedWorkloadTemplateSha256: identity.workloadTemplateSha256,
    expectedObservabilityTemplateSha256: identity.observabilityTemplateSha256,
    expectedSecretArn: identity.secretArn,
    expectedKmsKeyArn: identity.kmsKeyArn,
    expectedOperatorUserId: identity.operatorUserId,
    expectedCurrentVersionId: currentState.redisOperatorSecretVersionId,
    expectedTargetVersionId: targetState.redisOperatorSecretVersionId,
    expectedRedisOperatorStateSha256: predecessors.redisOperatorStateSha256,
    expectedRedisOperatorTransitionSha256: predecessors.redisOperatorTransitionSha256,
    expectedCredentialStateSha256: predecessors.credentialStateSha256,
    expectedCredentialTransitionSha256: predecessors.credentialTransitionSha256,
    expectedAuthWalletStateSha256: predecessors.authWalletStateSha256,
    expectedAuthWalletTransitionSha256: predecessors.authWalletTransitionSha256,
    expectedOperation: operation.action,
    expectedFieldName: operation.fieldName,
  };
}

function verify(record, mode, optionOverrides = {}, registry = testRegistry) {
  return verifyRedisOperatorSecretVersionTransitionWithTestRegistry(
    record,
    { ...optionsFor(record, mode), ...optionOverrides },
    registry,
  );
}

function assertAccepted(record, mode) {
  const report = verify(signRecord(record), mode);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.signatureValidated, true);
  assert.equal(report.productionAuthorityValidated, false);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(isProductionAuthorizedRedisOperatorTransitionReport(report), false);
  assert.equal(report.plan.executionAllowed, false);
  assert.equal(report.plan.separateAuthorizationRequired, true);
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
  ]) {
    assert.equal(report[key], 0);
  }
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.plan), true);
  return report;
}

function assertRejected(record, mode, pattern, optionOverrides = {}, registry = testRegistry) {
  const report = verify(signRecord(record), mode, optionOverrides, registry);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), pattern);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(isProductionAuthorizedRedisOperatorTransitionReport(report), false);
  return report;
}

function withLocalRecord(contents, assertion) {
  const directory = mkdtempSync(join(LOCAL_REDIS_OPERATOR_TRANSITION_ROOT, 'redis-operator-test-'));
  const path = join(directory, 'approved.redis-operator-transition.local.json');
  writeFileSync(path, contents);
  try {
    assertion(path, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function operationalCliArguments(path, record) {
  const options = optionsFor(record, 'transition');
  return [
    validatorPath,
    '--record',
    path,
    '--mode',
    'transition',
    '--at',
    '2026-09-05T12:00:00Z',
    '--expected-account',
    options.expectedAccount,
    '--expected-region',
    options.expectedRegion,
    '--expected-stack',
    options.expectedStack,
    '--expected-stack-id',
    options.expectedStackId,
    '--expected-workload-stack-id',
    options.expectedWorkloadStackId,
    '--expected-environment',
    options.expectedEnvironment,
    '--expected-parent-template-sha256',
    options.expectedParentTemplateSha256,
    '--expected-workload-template-sha256',
    options.expectedWorkloadTemplateSha256,
    '--expected-observability-template-sha256',
    options.expectedObservabilityTemplateSha256,
    '--expected-secret-arn',
    options.expectedSecretArn,
    '--expected-kms-key-arn',
    options.expectedKmsKeyArn,
    '--expected-operator-user-id',
    options.expectedOperatorUserId,
    '--expected-current-version-id',
    options.expectedCurrentVersionId,
    '--expected-target-version-id',
    options.expectedTargetVersionId,
    '--expected-redis-operator-state-sha256',
    options.expectedRedisOperatorStateSha256,
    '--expected-redis-operator-transition-sha256',
    options.expectedRedisOperatorTransitionSha256,
    '--expected-credential-state-sha256',
    options.expectedCredentialStateSha256,
    '--expected-credential-transition-sha256',
    options.expectedCredentialTransitionSha256,
    '--expected-auth-wallet-state-sha256',
    options.expectedAuthWalletStateSha256,
    '--expected-auth-wallet-transition-sha256',
    options.expectedAuthWalletTransitionSha256,
    '--expected-operation',
    options.expectedOperation,
    '--expected-field-name',
    options.expectedFieldName,
    '--json',
  ];
}

test('checked-in Redis operator example remains inert and production authority empty', () => {
  const record = JSON.parse(readFileSync(DEFAULT_REDIS_OPERATOR_TRANSITION_RECORD, 'utf8'));
  const report = validateRedisOperatorSecretVersionTransition(record, { mode: 'example' });
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(report.signatureValidated, false);
  assert.equal(REDIS_OPERATOR_TRANSITION_AUTHORITY_KEY_REGISTRY.keys.length, 0);
  assert.equal(isProductionAuthorizedRedisOperatorTransitionReport(report), false);
  assert.equal(report.externalCallsMade, 0);
  assert.equal(report.awsCallsMade, 0);
  assert.equal(report.redisConnectionsMade, 0);
  assert.equal(report.filesWritten, 0);
});

test('accepts signed adoption and transition only through the unbranded test seam', () => {
  const adoption = recordFor('adopt');
  const adoptReport = assertAccepted(adoption, 'adopt');
  assert.equal(adoptReport.currentOperatorStateSha256, adoptReport.targetOperatorStateSha256);
  assert.equal(adoptReport.currentCredentialStateSha256, adoptReport.targetCredentialStateSha256);
  assert.equal(adoptReport.redisOperatorPredecessorTransitionSha256, 'NONE');

  const transition = recordFor('transition');
  const transitionReport = assertAccepted(transition, 'transition');
  assert.notEqual(
    transitionReport.currentOperatorStateSha256,
    transitionReport.targetOperatorStateSha256,
  );
  assert.notEqual(
    transitionReport.currentCredentialStateSha256,
    transitionReport.targetCredentialStateSha256,
  );
  assert.equal(
    transitionReport.credentialPredecessorTransitionSha256,
    transition.content.predecessors.credentialTransitionSha256,
  );
  assert.equal(
    transitionReport.preservedAuthWalletTransitionSha256,
    transition.content.predecessors.authWalletTransitionSha256,
  );
  assert.equal(transitionReport.plan.kind, 'LOCAL_ONLY_NON_EXECUTABLE_REDIS_OPERATOR_VERSION_PLAN');
  assert.equal(transitionReport.plan.versionParameter, 'RedisOperatorSecretVersionId');
});

test('public structural API cannot validate operational records or mint a production brand', () => {
  const record = signRecord(recordFor('transition'));
  const report = validateRedisOperatorSecretVersionTransition(
    record,
    optionsFor(record, 'transition'),
  );
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /production authority path/u);
  const testReport = verify(record, 'transition');
  assert.equal(testReport.ok, true);
  assert.equal(isProductionAuthorizedRedisOperatorTransitionReport(testReport), false);
  assert.equal(
    isProductionAuthorizedRedisOperatorTransitionReport({
      ...testReport,
      productionAuthorityValidated: true,
      readyForAuthorizedPlan: true,
    }),
    false,
  );
});

test('rejects signature tampering, role swaps, reused keys, and invalid authority windows', () => {
  const tampered = signRecord(recordFor('transition'));
  tampered.content.evidence.targetSecretSchemaSha256 = digest('tampered-after-signing');
  const tamperedReport = verify(tampered, 'transition');
  assert.equal(tamperedReport.ok, false);
  assert.match(tamperedReport.errors.join('\n'), /signatures/u);

  const swapped = signRecord(recordFor('transition'));
  [swapped.signatures[0], swapped.signatures[1]] = [swapped.signatures[1], swapped.signatures[0]];
  const swappedReport = verifyRedisOperatorSecretVersionTransitionWithTestRegistry(
    swapped,
    optionsFor(swapped, 'transition'),
    testRegistry,
  );
  assert.equal(swappedReport.ok, false);
  assert.match(swappedReport.errors.join('\n'), /signatures/u);

  const reusedRegistry = structuredClone(testRegistry);
  reusedRegistry.keys[1].publicKeySpkiDerBase64 = reusedRegistry.keys[0].publicKeySpkiDerBase64;
  assertRejected(recordFor('transition'), 'transition', /signatures/u, {}, reusedRegistry);

  const expiredRegistry = structuredClone(testRegistry);
  expiredRegistry.keys[0].validUntil = '2026-09-05T12:00:00Z';
  assertRejected(recordFor('transition'), 'transition', /signatures/u, {}, expiredRegistry);
});

test('rejects operator mode changes, unrelated fixed-state drift, and replayed histories', () => {
  const enabled = recordFor('transition');
  enabled.content.targetState.operatorMode = 'ENABLED';
  assertRejected(enabled, 'transition', /DISABLED|preserve fixed-slot operatorMode/u);

  const unrelated = recordFor('transition');
  unrelated.content.targetState.apiDatabase.phase = 'B_ONLY';
  assertRejected(unrelated, 'transition', /preserve fixed-slot apiDatabase/u);

  const truncated = recordFor('transition');
  truncated.content.targetState.redisOperatorUsedVersionIds = [
    truncated.content.targetState.redisOperatorSecretVersionId,
  ];
  assertRejected(truncated, 'transition', /append and select exactly one fresh/u);

  const replay = recordFor('transition');
  replay.content.targetState.redisOperatorSecretVersionId =
    replay.content.currentState.redisOperatorSecretVersionId;
  replay.content.targetState.redisOperatorUsedVersionIds[1] =
    replay.content.currentState.redisOperatorSecretVersionId;
  assertRejected(replay, 'transition', /valid pinned|fresh VersionId/u);

  const crossSlot = recordFor('transition');
  const reused = crossSlot.content.currentState.apiDatabase.slots.a.currentVersionId;
  crossSlot.content.targetState.redisOperatorSecretVersionId = reused;
  crossSlot.content.targetState.redisOperatorUsedVersionIds[1] = reused;
  assertRejected(crossSlot, 'transition', /valid pinned/u);
});

test('adoption is no-op and transition predecessor chains fail closed independently', () => {
  const changedAdoption = recordFor('adopt');
  changedAdoption.content.targetState.redisOperatorSecretVersionId = versionId('redis_operator', 2);
  changedAdoption.content.targetState.redisOperatorUsedVersionIds.push(
    changedAdoption.content.targetState.redisOperatorSecretVersionId,
  );
  assertRejected(changedAdoption, 'adopt', /leave the complete fixed-slot state unchanged/u);

  const claimedHistory = recordFor('adopt');
  claimedHistory.content.currentState = fixedState(2);
  claimedHistory.content.targetState = structuredClone(claimedHistory.content.currentState);
  claimedHistory.content.predecessors.credentialStateSha256 = fixedSlotCredentialStateSha256(
    claimedHistory.content.currentState,
  );
  assertRejected(claimedHistory, 'adopt', /exactly one current operator VersionId/u);

  const cases = [
    ['redisOperatorStateSha256', /current projection|expected deployed chain/u],
    ['redisOperatorTransitionSha256', /prior record|expected deployed chain/u],
    ['credentialStateSha256', /current full state|expected deployed chain/u],
    ['credentialTransitionSha256', /composite head|expected deployed chain/u],
    ['authWalletStateSha256', /auth-wallet|expected deployed chain/u],
    ['authWalletTransitionSha256', /auth-wallet|expected deployed chain/u],
  ];
  for (const [key, pattern] of cases) {
    const record = recordFor('transition');
    const options = optionsFor(record, 'transition');
    record.content.predecessors[key] = digest(`wrong:${key}`);
    const report = verifyRedisOperatorSecretVersionTransitionWithTestRegistry(
      signRecord(record),
      options,
      testRegistry,
    );
    assert.equal(report.ok, false, key);
    assert.match(report.errors.join('\n'), pattern, key);
  }
});

test('rejects deployment identity drift, selector-bearing ARNs, and invocation mismatch', () => {
  for (const [key, value, pattern] of [
    ['stackId', STACK_ID.replace('arn:aws:', 'arn:aws-cn:'), /stack identity|same AWS partition/u],
    ['workloadStackId', WORKLOAD_STACK_ID.replace('us-west-2', 'us-east-1'), /workload stack/u],
    ['observabilityTemplateSha256', 'A'.repeat(64), /lowercase SHA-256/u],
    ['secretArn', `${SECRET_ARN}:AWSCURRENT`, /selector-free secret ARN/u],
    ['kmsKeyArn', KMS_ARN.replace(':kms:', ':secretsmanager:'), /KMS key ARN/u],
    ['operatorUserId', 'cl-production-ra', /disabled operator user ID/u],
  ]) {
    const record = recordFor('transition');
    record.content.deployment[key] = value;
    assertRejected(record, 'transition', pattern);
  }
  const record = signRecord(recordFor('transition'));
  const report = verify(record, 'transition', { expectedTargetVersionId: versionId('wrong', 9) });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /explicit invocation/u);
});

test('rejects stale windows, evidence reuse, approval drift, and secret-like schema additions', () => {
  const stale = recordFor('transition');
  stale.content.expiresAt = '2026-09-05T12:00:00Z';
  assertRejected(stale, 'transition', /active at the explicit/u);

  const long = recordFor('transition');
  long.content.expiresAt = '2026-09-05T13:00:01Z';
  assertRejected(long, 'transition', /at most one hour/u);

  const reusedEvidence = recordFor('transition');
  reusedEvidence.content.evidence.targetSecretSchemaSha256 =
    reusedEvidence.content.evidence.targetVersionInventorySha256;
  assertRejected(reusedEvidence, 'transition', /distinct SHA-256/u);

  const approval = recordFor('transition');
  approval.content.approvals.redisSecurityApprovalRef =
    approval.content.approvals.secretCustodyApprovalRef;
  assertRejected(approval, 'transition', /purpose-bound|independent/u);

  const extra = recordFor('transition');
  extra.content.password = 'forbidden-sensitive-value';
  const extraReport = assertRejected(extra, 'transition', /exact reviewed keys/u);
  assert.equal(
    extraReport.errors.some((error) => error.includes('forbidden-sensitive-value')),
    false,
  );

  const malformed = recordFor('transition');
  const malformedOptions = optionsFor(malformed, 'transition');
  malformed.content.predecessors = null;
  let malformedReport;
  assert.doesNotThrow(() => {
    malformedReport = verifyRedisOperatorSecretVersionTransitionWithTestRegistry(
      signRecord(malformed),
      malformedOptions,
      testRegistry,
    );
  });
  assert.equal(malformedReport.ok, false);

  const signed = signRecord(recordFor('transition'));
  const hostileOptions = new Proxy(
    {},
    {
      get() {
        throw new Error('sensitive-option-value');
      },
    },
  );
  let hostileReport;
  assert.doesNotThrow(() => {
    hostileReport = verifyRedisOperatorSecretVersionTransitionWithTestRegistry(
      signed,
      hostileOptions,
      testRegistry,
    );
  });
  assert.equal(hostileReport.ok, false);
  assert.equal(
    hostileReport.errors.some((error) => error.includes('sensitive-')),
    false,
  );

  const hostileRecord = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('sensitive-record-value');
      },
    },
  );
  assert.doesNotThrow(() => {
    hostileReport = verifyRedisOperatorSecretVersionTransitionWithTestRegistry(
      hostileRecord,
      optionsFor(recordFor('transition'), 'transition'),
      testRegistry,
    );
  });
  assert.equal(hostileReport.ok, false);
  assert.equal(
    hostileReport.errors.some((error) => error.includes('sensitive-')),
    false,
  );
});

test('canonical signing bytes and state hashes bind key order, domains, and history', () => {
  const record = recordFor('transition');
  const unsigned = {
    schemaVersion: record.schemaVersion,
    artifactType: record.artifactType,
    content: record.content,
  };
  const signingBytes = redisOperatorSecretVersionTransitionSigningBytes(unsigned);
  assert.match(
    signingBytes.toString('utf8'),
    /^crypto-lending:redis-operator-secret-version-transition:v1\n/u,
  );
  assert.equal(
    canonicalizeRedisOperatorTransitionValue({ '\u00e4': 3, z: 2, A: 1 }),
    '{"A":1,"z":2,"\u00e4":3}',
  );
  const target = structuredClone(record.content.targetState);
  target.redisOperatorUsedVersionIds[0] = versionId('different_history', 1);
  assert.notEqual(
    redisOperatorTransitionStateSha256(record.content.targetState),
    redisOperatorTransitionStateSha256(target),
  );
  assert.throws(
    () =>
      redisOperatorSecretVersionTransitionSigningBytes({
        ...unsigned,
        schemaVersion: 2,
      }),
    /Invalid Redis operator transition signing input/u,
  );
});

test('secure loader accepts only canonical operational files in the ignored location', () => {
  const record = signRecord(recordFor('transition'));
  const canonical = canonicalizeRedisOperatorTransitionValue(record);
  withLocalRecord(canonical, (path, directory) => {
    assert.deepEqual(loadRedisOperatorSecretVersionTransitionRecord(path, 'transition'), record);

    const pretty = join(directory, 'pretty.redis-operator-transition.local.json');
    writeFileSync(pretty, JSON.stringify(record, null, 2));
    assert.throws(
      () => loadRedisOperatorSecretVersionTransitionRecord(pretty, 'transition'),
      /bounded, canonical, stable/u,
    );

    const duplicate = join(directory, 'duplicate.redis-operator-transition.local.json');
    writeFileSync(
      duplicate,
      '{"schemaVersion":1,"schemaVersion":1,"artifactType":"REDIS_OPERATOR_SECRET_VERSION_TRANSITION"}',
    );
    assert.throws(
      () => loadRedisOperatorSecretVersionTransitionRecord(duplicate, 'transition'),
      /bounded, canonical, stable/u,
    );

    const wrongSuffix = join(directory, 'approved.json');
    writeFileSync(wrongSuffix, canonical);
    assert.throws(
      () => loadRedisOperatorSecretVersionTransitionRecord(wrongSuffix, 'transition'),
      /bounded, canonical, stable/u,
    );
  });
  assert.throws(
    () =>
      loadRedisOperatorSecretVersionTransitionRecord(
        DEFAULT_REDIS_OPERATOR_TRANSITION_RECORD,
        'transition',
      ),
    /bounded, canonical, stable/u,
  );
});

test('secure loader rejects empty, oversized, malformed UTF-8, BOM, links, and read races', (context) => {
  for (const contents of [
    Buffer.alloc(0),
    Buffer.alloc(MAX_REDIS_OPERATOR_TRANSITION_RECORD_BYTES + 1, 0x20),
    Buffer.from([0xff]),
    Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
  ]) {
    withLocalRecord(contents, (path) => {
      assert.throws(
        () => loadRedisOperatorSecretVersionTransitionRecord(path, 'transition'),
        /bounded, canonical, stable/u,
      );
    });
  }

  const directory = mkdtempSync(join(LOCAL_REDIS_OPERATOR_TRANSITION_ROOT, 'redis-links-'));
  const source = join(directory, 'source.redis-operator-transition.local.json');
  const linked = join(directory, 'linked.redis-operator-transition.local.json');
  const symlinked = join(directory, 'symlinked.redis-operator-transition.local.json');
  try {
    const canonical = canonicalizeRedisOperatorTransitionValue(signRecord(recordFor('transition')));
    writeFileSync(source, canonical);
    linkSync(source, linked);
    assert.throws(
      () => loadRedisOperatorSecretVersionTransitionRecord(linked, 'transition'),
      /bounded, canonical, stable/u,
    );
    rmSync(linked, { force: true });
    try {
      symlinkSync(source, symlinked, 'file');
      assert.throws(
        () => loadRedisOperatorSecretVersionTransitionRecord(symlinked, 'transition'),
        /bounded, canonical, stable/u,
      );
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code)) throw error;
      context.diagnostic(`symbolic-link check unavailable: ${error.code}`);
    }
    assert.throws(
      () =>
        loadRedisOperatorSecretVersionTransitionRecordForTest(source, 'transition', () => {
          const mutated = canonical.replace(
            versionId('redis_operator', 2),
            versionId('redis_operator', 3),
          );
          assert.equal(Buffer.byteLength(mutated), Buffer.byteLength(canonical));
          writeFileSync(source, mutated);
        }),
      /bounded, canonical, stable/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('real CLI remains inert, requires every binding, and cannot use test authority', () => {
  const example = spawnSync(process.execPath, [validatorPath, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(example.status, 0, example.stderr);
  const exampleReport = JSON.parse(example.stdout);
  assert.equal(exampleReport.ok, true);
  assert.equal(exampleReport.readyForAuthorizedPlan, false);

  const record = signRecord(recordFor('transition'));
  withLocalRecord(canonicalizeRedisOperatorTransitionValue(record), (path) => {
    const arguments_ = operationalCliArguments(path, record);
    const operational = spawnSync(process.execPath, arguments_, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(operational.status, 1, operational.stderr);
    const report = JSON.parse(operational.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.productionAuthorityValidated, false);
    assert.equal(report.awsCallsMade, 0);
    assert.match(report.errors.join('\n'), /production authority registry/u);

    for (const required of [
      '--record',
      '--at',
      '--expected-workload-stack-id',
      '--expected-observability-template-sha256',
      '--expected-redis-operator-state-sha256',
      '--expected-credential-transition-sha256',
      '--expected-auth-wallet-transition-sha256',
    ]) {
      const missing = [...arguments_];
      const index = missing.indexOf(required);
      missing.splice(index, 2);
      const failure = spawnSync(process.execPath, missing, {
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
      });
      assert.equal(failure.status, 2, required);
      assert.equal(failure.stdout, '');
      assert.equal(failure.stderr.includes(path), false);
    }
  });

  const hostile = '--private-key-file';
  const argumentFailure = spawnSync(process.execPath, [validatorPath, hostile, 'sensitive-path'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(argumentFailure.status, 2);
  assert.equal(argumentFailure.stdout, '');
  assert.equal(argumentFailure.stderr.includes(hostile), false);
  assert.equal(argumentFailure.stderr.includes('sensitive-path'), false);
});

test('validator source exposes no external-call, secret-read, signing, or write capability', () => {
  for (const forbidden of [
    /node:child_process/u,
    /node:(?:http|https|net|tls|dns)/u,
    /@aws-sdk/u,
    /generateKeyPair|createPrivateKey|\bsign\s+as|\bsign\(/u,
    /writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink/u,
    /GetSecretValue|BatchGetSecretValue/u,
    /redis-cli|ioredis|from ['"]redis['"]/u,
  ]) {
    assert.doesNotMatch(validatorSource, forbidden);
  }
  for (const key of Object.keys({
    externalCallsMade: 0,
    awsCallsMade: 0,
    redisConnectionsMade: 0,
    filesWritten: 0,
  })) {
    assert.match(validatorSource, new RegExp(`${key}: 0`, 'u'));
  }
});
