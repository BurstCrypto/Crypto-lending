import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
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
import test from 'node:test';

import {
  canonicalizeFixedSlotValue,
  DEFAULT_FIXED_SLOT_TRANSITION_RECORD,
  FIXED_SLOT_TRANSITION_ARGUMENT_ERROR,
  FIXED_SLOT_TRANSITION_INPUT_ERROR,
  loadFixedSlotCredentialTransitionRecord,
  loadFixedSlotCredentialTransitionRecordForTest,
  LOCAL_TRANSITION_ROOT,
  MAX_FIXED_SLOT_TRANSITION_RECORD_BYTES,
  MAX_SLOT_GENERATIONS,
  validateFixedSlotCredentialTransition,
} from './validate-fixed-slot-credential-transition.mjs';

const validatorPath = join(import.meta.dirname, 'validate-fixed-slot-credential-transition.mjs');
const validatorSource = readFileSync(validatorPath, 'utf8');
const exampleRecord = JSON.parse(readFileSync(DEFAULT_FIXED_SLOT_TRANSITION_RECORD, 'utf8'));
const NOW = new Date('2027-01-01T12:00:00Z');
const PREPARED_AT = '2027-01-01T11:00:00Z';
const EXPIRES_AT = '2027-01-01T18:00:00Z';
const VERIFIED_AT = '2027-01-01T11:30:00Z';
const VALIDATION_AT = '2027-01-01T12:00:00Z';
const SCOPES = ['apiDatabase', 'workerDatabase', 'redis'];
const PHASES = ['A_ONLY', 'BOTH_USE_A', 'BOTH_USE_B', 'B_ONLY'];
const EVIDENCE_KEYS = [
  'currentStateCaptureSha256',
  'secretRegenerationSha256',
  'backendInstallationSha256',
  'candidateVerificationSha256',
  'activeContinuitySha256',
  'replacementReadinessSha256',
  'retirementDrainSha256',
  'retirementRevocationSha256',
  'retirementSessionDenialSha256',
  'rollbackPlanSha256',
];

mkdirSync(LOCAL_TRANSITION_ROOT, { recursive: true });

function digest(label) {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

function versionId(scope, slot, generation) {
  return `${scope}_${slot}_${generation}`.padEnd(32, 'x');
}

function canonicalStateHash(state) {
  return digest(canonicalizeFixedSlotValue(state));
}

function slot(scope, slotName, generation = 1) {
  const usedVersionIds = [];
  for (let value = 1; value <= generation; value += 1) {
    usedVersionIds.push(versionId(scope, slotName, value));
  }
  return {
    generation,
    currentVersionId: usedVersionIds.at(-1),
    usedVersionIds,
  };
}

function scopeState(scope, phase = 'A_ONLY') {
  return {
    phase,
    slots: { a: slot(scope, 'a'), b: slot(scope, 'b') },
    preparation: null,
    overlap: ['BOTH_USE_A', 'BOTH_USE_B'].includes(phase)
      ? {
          rotationId: `rotation:${scope}:one`,
          startedAt: PREPARED_AT,
          expiresAt: EXPIRES_AT,
        }
      : null,
  };
}

function trackedState(phases = {}) {
  return {
    operatorMode: 'DISABLED',
    redisOperatorSecretVersionId: versionId('redisOperator', 'credential', 1),
    apiDatabase: scopeState('apiDatabase', phases.apiDatabase),
    workerDatabase: scopeState('workerDatabase', phases.workerDatabase),
    redis: scopeState('redis', phases.redis),
  };
}

function untrackedState() {
  return structuredClone(exampleRecord.currentState);
}

function deployment() {
  return {
    accountId: '123456789012',
    region: 'us-west-2',
    stackName: 'crypto-lending-staging',
    stackId:
      'arn:aws:cloudformation:us-west-2:123456789012:stack/crypto-lending-staging/12345678-abcd-1234-abcd-123456789012',
    environmentName: 'staging',
    parentTemplateSha256: digest('parent-template'),
    workloadTemplateSha256: digest('workload-template'),
  };
}

function operationalCliBindings() {
  const expected = deployment();
  return [
    ['--at', VALIDATION_AT],
    ['--expected-account', expected.accountId],
    ['--expected-region', expected.region],
    ['--expected-stack', expected.stackName],
    ['--expected-stack-id', expected.stackId],
    ['--expected-environment', expected.environmentName],
    ['--expected-parent-template-sha256', expected.parentTemplateSha256],
    ['--expected-workload-template-sha256', expected.workloadTemplateSha256],
  ];
}

function operationalCliArguments(path, mode = 'transition') {
  return [
    validatorPath,
    '--mode',
    mode,
    '--record',
    path,
    ...operationalCliBindings().flat(),
    '--json',
  ];
}

function authority() {
  return {
    secretRegenerationApprovers: ['security:secret-approver'],
    backendInstallApprovers: ['database:install-approver'],
    phaseChangeApprovers: ['release:phase-approver'],
    rollbackApprovers: ['operations:rollback-approver'],
    independentVerifier: 'audit:independent-verifier',
    decision: 'APPROVED',
    verifiedAt: VERIFIED_AT,
  };
}

function evidence(operation) {
  const required = {
    ADOPT_AND_PIN: [
      'currentStateCaptureSha256',
      'backendInstallationSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'rollbackPlanSha256',
    ],
    PREPARE_INACTIVE: [
      'currentStateCaptureSha256',
      'secretRegenerationSha256',
      'backendInstallationSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'rollbackPlanSha256',
    ],
    ABORT_PREPARATION: ['currentStateCaptureSha256', 'rollbackPlanSha256'],
    ENTER_OVERLAP: [
      'currentStateCaptureSha256',
      'secretRegenerationSha256',
      'backendInstallationSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'rollbackPlanSha256',
    ],
    MOVE_ACTIVE_SLOT: [
      'currentStateCaptureSha256',
      'candidateVerificationSha256',
      'activeContinuitySha256',
      'replacementReadinessSha256',
      'rollbackPlanSha256',
    ],
    EXIT_OVERLAP: [
      'currentStateCaptureSha256',
      'replacementReadinessSha256',
      'retirementDrainSha256',
      'retirementRevocationSha256',
      'retirementSessionDenialSha256',
      'rollbackPlanSha256',
    ],
  }[operation];
  return Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [
      key,
      required.includes(key) ? digest(`${operation}:${key}`) : 'NOT_APPLICABLE',
    ]),
  );
}

function envelope(currentState, targetState, operation) {
  return {
    schemaVersion: 2,
    status: 'APPROVED',
    recordId: `rotation:${operation.toLowerCase()}:one`,
    preparedAt: PREPARED_AT,
    expiresAt: EXPIRES_AT,
    deployment: deployment(),
    predecessor: {
      stateSha256: canonicalStateHash(currentState),
      transitionSha256: digest('prior-transition'),
    },
    currentState,
    targetState,
    authority: authority(),
    evidence: evidence(operation),
  };
}

function adoptionRecord() {
  const current = untrackedState();
  const target = trackedState();
  const record = envelope(current, target, 'ADOPT_AND_PIN');
  record.predecessor = { stateSha256: 'UNTRACKED', transitionSha256: 'NONE' };
  return record;
}

function preparationRecord(scopeName, phase = 'A_ONLY') {
  const current = trackedState({ [scopeName]: phase });
  const target = structuredClone(current);
  const inactive = phase === 'A_ONLY' ? 'b' : 'a';
  const candidate = target[scopeName].slots[inactive];
  candidate.generation += 1;
  candidate.currentVersionId = versionId(scopeName, inactive, candidate.generation);
  candidate.usedVersionIds.push(candidate.currentVersionId);
  const record = envelope(current, target, 'PREPARE_INACTIVE');
  target[scopeName].preparation = {
    slot: inactive,
    preparedAt: PREPARED_AT,
    expiresAt: EXPIRES_AT,
    secretVersionEvidenceSha256: record.evidence.secretRegenerationSha256,
    backendInstallEvidenceSha256: record.evidence.backendInstallationSha256,
  };
  return record;
}

function abortPreparationRecord(scopeName, phase = 'A_ONLY') {
  const prepared = preparationRecord(scopeName, phase).targetState;
  const target = structuredClone(prepared);
  target[scopeName].preparation = null;
  return envelope(prepared, target, 'ABORT_PREPARATION');
}

function phaseEdgeRecord(scopeName, from, to) {
  const current = trackedState({ [scopeName]: from });
  const target = structuredClone(current);
  target[scopeName].phase = to;
  let operation;

  if ((from === 'A_ONLY' && to === 'BOTH_USE_A') || (from === 'B_ONLY' && to === 'BOTH_USE_B')) {
    operation = 'ENTER_OVERLAP';
    const inactive = from === 'A_ONLY' ? 'b' : 'a';
    current[scopeName].preparation = {
      slot: inactive,
      preparedAt: PREPARED_AT,
      expiresAt: EXPIRES_AT,
      secretVersionEvidenceSha256: digest(`${operation}:secretRegenerationSha256`),
      backendInstallEvidenceSha256: digest(`${operation}:backendInstallationSha256`),
    };
    target[scopeName].preparation = null;
    target[scopeName].overlap = {
      rotationId: `rotation:${scopeName}:one`,
      startedAt: PREPARED_AT,
      expiresAt: EXPIRES_AT,
    };
  } else if (
    (from === 'BOTH_USE_A' && to === 'BOTH_USE_B') ||
    (from === 'BOTH_USE_B' && to === 'BOTH_USE_A')
  ) {
    operation = 'MOVE_ACTIVE_SLOT';
  } else if (
    (from === 'BOTH_USE_A' && to === 'A_ONLY') ||
    (from === 'BOTH_USE_B' && to === 'B_ONLY')
  ) {
    operation = 'EXIT_OVERLAP';
    target[scopeName].overlap = null;
  } else {
    operation = 'MOVE_ACTIVE_SLOT';
    if (['BOTH_USE_A', 'BOTH_USE_B'].includes(to)) {
      target[scopeName].overlap = {
        rotationId: `rotation:${scopeName}:invalid`,
        startedAt: PREPARED_AT,
        expiresAt: EXPIRES_AT,
      };
    } else {
      target[scopeName].overlap = null;
    }
  }
  return envelope(current, target, operation);
}

function validate(record, mode = 'transition', overrides = {}) {
  const expected = deployment();
  const operationalOptions =
    mode === 'example'
      ? {}
      : {
          expectedAccount: expected.accountId,
          expectedRegion: expected.region,
          expectedStack: expected.stackName,
          expectedStackId: expected.stackId,
          expectedEnvironment: expected.environmentName,
          expectedParentTemplateSha256: expected.parentTemplateSha256,
          expectedWorkloadTemplateSha256: expected.workloadTemplateSha256,
        };
  return validateFixedSlotCredentialTransition(record, {
    mode,
    now: NOW,
    ...operationalOptions,
    ...overrides,
  });
}

function assertAccepted(record, mode, operation) {
  const result = validate(record, mode);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.readyForAuthorizedPlan, true);
  assert.equal(result.operation, operation);
  assert.equal(result.plan.executionAllowed, false);
  assert.equal(result.plan.separateAuthorizationRequired, true);
  for (const value of [
    result.externalCallsMade,
    result.awsCallsMade,
    result.databaseConnectionsMade,
    result.redisConnectionsMade,
    result.dnsQueriesMade,
    result.httpRequestsMade,
    result.resourcesCreated,
    result.credentialBytesRead,
    result.filesWritten,
  ]) {
    assert.equal(value, 0);
  }
}

function assertRejected(record, mode = 'transition', pattern) {
  const result = validate(record, mode);
  assert.equal(result.ok, false);
  assert.equal(result.readyForAuthorizedPlan, false);
  if (pattern) assert.match(result.errors.join('\n'), pattern);
  assert.equal(result.awsCallsMade, 0);
  assert.equal(result.databaseConnectionsMade, 0);
  assert.equal(result.redisConnectionsMade, 0);
  return result;
}

function withLocalRecord(contents, assertion) {
  const directory = mkdtempSync(join(LOCAL_TRANSITION_ROOT, 'fixed-slot-test-'));
  const path = join(directory, 'approved.credential-transition.local.json');
  writeFileSync(path, contents);
  try {
    assertion(path, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertInputRejected(path, mode = 'transition') {
  assert.throws(
    () => loadFixedSlotCredentialTransitionRecord(path, mode),
    (error) =>
      error instanceof Error &&
      error.message === FIXED_SLOT_TRANSITION_INPUT_ERROR &&
      !error.message.includes(path),
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

test('accepts only the inert checked-in example by default', () => {
  const loaded = loadFixedSlotCredentialTransitionRecord(
    DEFAULT_FIXED_SLOT_TRANSITION_RECORD,
    'example',
  );
  const result = validate(loaded, 'example');
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.readyForAuthorizedPlan, false);
  assert.equal(result.operation, 'EXAMPLE_ONLY');
  assert.equal(result.plan, undefined);
  assert.equal(result.externalCallsMade, 0);
  assert.equal(result.filesWritten, 0);
});

test('accepts canonical adoption and binds both state digests', () => {
  const record = adoptionRecord();
  const result = validate(record, 'adopt');
  assertAccepted(record, 'adopt', 'ADOPT_AND_PIN');
  assert.equal(result.currentStateSha256, canonicalStateHash(record.currentState));
  assert.equal(result.targetStateSha256, canonicalStateHash(record.targetState));
  assert.match(result.canonicalSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.plan.scope, 'ALL_CREDENTIAL_VERSION_BINDINGS');
  assert.equal(result.plan.phaseParameter, 'ALL_SEVEN_VERSION_SELECTORS');
  assert.deepEqual(result.plan.steps.slice(0, 3), [
    'CAPTURE_ALL_SEVEN_EXACT_SECRET_VERSION_IDENTITIES_UNDER_SEPARATE_AUTHORITY',
    'VERIFY_ALL_DATABASE_VERIFIERS_AND_REDIS_PASSWORD_BINDINGS_WITHOUT_RECORDING_CREDENTIALS',
    'PIN_ALL_SEVEN_VERSION_SELECTORS_WHILE_ALL_WORKLOAD_DESIRED_COUNTS_REMAIN_ZERO',
  ]);
});

test('core operational validation rejects omitted external identity bindings or instant', () => {
  const record = preparationRecord('apiDatabase');
  const omittedAll = validateFixedSlotCredentialTransition(record, { mode: 'transition' });
  assert.equal(omittedAll.ok, false);
  assert.match(
    omittedAll.errors.join('\n'),
    /explicit valid validation instant|every expected deployment identity binding/u,
  );

  const expected = deployment();
  const complete = {
    mode: 'transition',
    now: NOW,
    expectedAccount: expected.accountId,
    expectedRegion: expected.region,
    expectedStack: expected.stackName,
    expectedStackId: expected.stackId,
    expectedEnvironment: expected.environmentName,
    expectedParentTemplateSha256: expected.parentTemplateSha256,
    expectedWorkloadTemplateSha256: expected.workloadTemplateSha256,
  };
  const requiredKeys = [
    'now',
    'expectedAccount',
    'expectedRegion',
    'expectedStack',
    'expectedStackId',
    'expectedEnvironment',
    'expectedParentTemplateSha256',
    'expectedWorkloadTemplateSha256',
  ];
  for (const key of requiredKeys) {
    const incomplete = { ...complete };
    delete incomplete[key];
    const result = validateFixedSlotCredentialTransition(record, incomplete);
    assert.equal(result.ok, false, key);
    assert.match(
      result.errors.join('\n'),
      key === 'now'
        ? /explicit valid validation instant/u
        : /every expected deployment identity binding/u,
    );
  }
});

test('canonical hashes use locale-independent code-unit key ordering', () => {
  assert.equal(canonicalizeFixedSlotValue({ '\u00e4': 3, z: 2, A: 1 }), '{"A":1,"z":2,"\u00e4":3}');
  assert.equal(validatorSource.includes('localeCompare'), false);
});

test('accepts preparation and abort for either inactive slot in every scope', () => {
  for (const scopeName of SCOPES) {
    for (const phase of ['A_ONLY', 'B_ONLY']) {
      const expectedSlot = phase === 'A_ONLY' ? 'b' : 'a';
      const prepared = preparationRecord(scopeName, phase);
      const prepareResult = validate(prepared);
      assertAccepted(prepared, 'transition', 'PREPARE_INACTIVE');
      assert.equal(prepareResult.scope, scopeName);
      assert.equal(prepareResult.slot, expectedSlot);
      assert.equal(prepareResult.plan.slot, expectedSlot.toUpperCase());

      const aborted = abortPreparationRecord(scopeName, phase);
      assertAccepted(aborted, 'transition', 'ABORT_PREPARATION');
    }
  }
});

test('table-drives every allowed and denied phase edge for all three state machines', () => {
  const allowed = new Set([
    'A_ONLY>BOTH_USE_A',
    'BOTH_USE_A>A_ONLY',
    'BOTH_USE_A>BOTH_USE_B',
    'BOTH_USE_B>BOTH_USE_A',
    'BOTH_USE_B>B_ONLY',
    'B_ONLY>BOTH_USE_B',
  ]);
  for (const scopeName of SCOPES) {
    for (const from of PHASES) {
      for (const to of PHASES) {
        const edge = `${from}>${to}`;
        const record = phaseEdgeRecord(scopeName, from, to);
        const result = validate(record);
        assert.equal(
          result.ok,
          allowed.has(edge),
          `${scopeName} ${edge}: ${result.errors.join('\n')}`,
        );
      }
    }
  }
});

test('rejects direct endpoint entry without a prepared inactive generation', () => {
  for (const [from, to] of [
    ['A_ONLY', 'BOTH_USE_A'],
    ['B_ONLY', 'BOTH_USE_B'],
  ]) {
    const record = phaseEdgeRecord('apiDatabase', from, to);
    record.currentState.apiDatabase.preparation = null;
    record.predecessor.stateSha256 = canonicalStateHash(record.currentState);
    assertRejected(record, 'transition', /reviewed fixed-slot state-machine step/u);
  }
});

test('rejects active-slot changes, generation jumps, overflow, and history truncation', () => {
  const active = preparationRecord('apiDatabase');
  active.targetState.apiDatabase.slots.a.generation += 1;
  active.targetState.apiDatabase.slots.a.currentVersionId = versionId('apiDatabase', 'a', 2);
  active.targetState.apiDatabase.slots.a.usedVersionIds.push(versionId('apiDatabase', 'a', 2));
  assertRejected(active);

  const jump = preparationRecord('apiDatabase');
  jump.targetState.apiDatabase.slots.b.generation += 1;
  assertRejected(jump, 'transition', /exact version|state-machine step|append-only/u);

  const overflow = preparationRecord('workerDatabase');
  const currentSlot = overflow.currentState.workerDatabase.slots.b;
  currentSlot.generation = MAX_SLOT_GENERATIONS;
  currentSlot.usedVersionIds = Array.from({ length: MAX_SLOT_GENERATIONS }, (_, index) =>
    versionId('workerDatabase', 'b', index + 1),
  );
  currentSlot.currentVersionId = currentSlot.usedVersionIds.at(-1);
  overflow.predecessor.stateSha256 = canonicalStateHash(overflow.currentState);
  const targetSlot = overflow.targetState.workerDatabase.slots.b;
  targetSlot.generation = MAX_SLOT_GENERATIONS + 1;
  targetSlot.usedVersionIds = [
    ...currentSlot.usedVersionIds,
    versionId('workerDatabase', 'b', MAX_SLOT_GENERATIONS + 1),
  ];
  targetSlot.currentVersionId = targetSlot.usedVersionIds.at(-1);
  assertRejected(overflow, 'transition', /bounded non-negative integer/u);

  const truncated = preparationRecord('redis');
  truncated.targetState.redis.slots.b.usedVersionIds = [
    truncated.targetState.redis.slots.b.currentVersionId,
  ];
  assertRejected(truncated, 'transition', /append-only history|state-machine step/u);
});

test('rejects replay of any prior, operator, or cross-workload version identity', () => {
  const priorReplay = preparationRecord('apiDatabase');
  const target = priorReplay.targetState.apiDatabase.slots.b;
  target.currentVersionId = target.usedVersionIds[0];
  target.usedVersionIds[target.usedVersionIds.length - 1] = target.currentVersionId;
  assertRejected(priorReplay, 'transition', /unique append-only history|reuse a version identity/u);

  const crossWorkload = preparationRecord('apiDatabase');
  const workerVersion = crossWorkload.currentState.workerDatabase.slots.a.currentVersionId;
  crossWorkload.targetState.apiDatabase.slots.b.currentVersionId = workerVersion;
  crossWorkload.targetState.apiDatabase.slots.b.usedVersionIds[1] = workerVersion;
  assertRejected(crossWorkload, 'transition', /reuse a version identity/u);

  const operatorReplay = adoptionRecord();
  operatorReplay.targetState.redisOperatorSecretVersionId =
    operatorReplay.targetState.apiDatabase.slots.a.currentVersionId;
  assertRejected(operatorReplay, 'adopt', /reuse a version identity/u);
});

test('rejects multiple scopes, stale evidence, operator mode, and predecessor drift', () => {
  const multiple = preparationRecord('apiDatabase');
  multiple.targetState.workerDatabase.phase = 'B_ONLY';
  assertRejected(multiple, 'transition', /exactly one credential scope/u);

  const evidenceDrift = preparationRecord('redis');
  evidenceDrift.targetState.redis.preparation.backendInstallEvidenceSha256 = digest('other-scope');
  assertRejected(evidenceDrift, 'transition', /bind the record evidence exactly/u);

  const operator = preparationRecord('workerDatabase');
  operator.currentState.operatorMode = 'ENABLED';
  operator.targetState.operatorMode = 'ENABLED';
  operator.predecessor.stateSha256 = canonicalStateHash(operator.currentState);
  assertRejected(operator, 'transition', /operatorMode must remain DISABLED/u);

  const operatorVersion = preparationRecord('workerDatabase');
  operatorVersion.targetState.redisOperatorSecretVersionId = versionId(
    'redisOperator',
    'credential',
    2,
  );
  assertRejected(operatorVersion, 'transition', /cannot change the Redis operator secret version/u);

  const predecessor = preparationRecord('workerDatabase');
  predecessor.predecessor.stateSha256 = digest('stale-current-state');
  assertRejected(predecessor, 'transition', /exact current state/u);
});

test('rejects expired approval, preparation, and overlap windows', () => {
  const approval = preparationRecord('apiDatabase');
  approval.expiresAt = '2027-01-01T11:59:59Z';
  assertRejected(approval, 'transition', /record approval must be active/u);

  const preparation = preparationRecord('apiDatabase');
  preparation.expiresAt = '2027-01-02T10:00:00Z';
  preparation.authority.verifiedAt = '2027-01-01T11:30:00Z';
  preparation.targetState.apiDatabase.preparation.preparedAt = '2026-12-31T10:00:00Z';
  preparation.targetState.apiDatabase.preparation.expiresAt = '2026-12-31T11:00:00Z';
  assertRejected(preparation, 'transition', /preparation must be active/u);

  const overlap = phaseEdgeRecord('redis', 'BOTH_USE_A', 'BOTH_USE_B');
  overlap.expiresAt = '2027-01-02T10:00:00Z';
  overlap.currentState.redis.overlap.expiresAt = '2027-01-01T11:59:59Z';
  overlap.targetState.redis.overlap.expiresAt = '2027-01-01T11:59:59Z';
  overlap.predecessor.stateSha256 = canonicalStateHash(overlap.currentState);
  assertRejected(overlap, 'transition', /overlap must be active/u);
});

test('rejects invalid operational envelope, identity mismatch, and non-independent review', () => {
  const invalidStatus = preparationRecord('apiDatabase');
  invalidStatus.status = 'PENDING';
  assertRejected(invalidStatus, 'transition', /status must be APPROVED/u);

  const reviewer = preparationRecord('apiDatabase');
  reviewer.authority.independentVerifier = reviewer.authority.phaseChangeApprovers[0];
  assertRejected(reviewer, 'transition', /valid and independent/u);

  const overlappingApprovers = preparationRecord('apiDatabase');
  overlappingApprovers.authority.backendInstallApprovers = [
    overlappingApprovers.authority.secretRegenerationApprovers[0],
  ];
  assertRejected(overlappingApprovers, 'transition', /mutually independent/u);

  const futureReview = preparationRecord('apiDatabase');
  futureReview.authority.verifiedAt = '2027-01-01T13:00:00Z';
  assertRejected(futureReview, 'transition', /verifiedAt must fall within/u);

  for (const [option, expected] of [
    ['expectedAccount', '999900001111'],
    ['expectedRegion', 'us-east-1'],
    ['expectedStack', 'wrong-stack'],
    [
      'expectedStackId',
      'arn:aws:cloudformation:us-west-2:123456789012:stack/crypto-lending-staging/87654321-abcd-1234-abcd-123456789012',
    ],
    ['expectedEnvironment', 'qa'],
    ['expectedParentTemplateSha256', digest('wrong-parent')],
    ['expectedWorkloadTemplateSha256', digest('wrong-workload')],
  ]) {
    const result = validate(preparationRecord('apiDatabase'), 'transition', { [option]: expected });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /does not match the expected deployment identity/u);
  }
});

test('rejects schema drift, credential-bearing fields, ambiguous JSON, and fake evidence reuse', () => {
  const extra = preparationRecord('apiDatabase');
  extra.currentState.apiDatabase.slots.a.credentialValue = 'forbidden';
  assertRejected(extra, 'transition', /exact reviewed keys/u);

  const malformedScope = preparationRecord('apiDatabase');
  malformedScope.targetState.apiDatabase = null;
  assert.doesNotThrow(() => validate(malformedScope));
  assertRejected(malformedScope, 'transition', /exact reviewed state structure|must be an object/u);

  const missing = preparationRecord('apiDatabase');
  delete missing.deployment.stackId;
  assertRejected(missing, 'transition', /exact reviewed keys/u);

  const duplicateEvidence = preparationRecord('apiDatabase');
  duplicateEvidence.evidence.backendInstallationSha256 =
    duplicateEvidence.evidence.secretRegenerationSha256;
  duplicateEvidence.targetState.apiDatabase.preparation.backendInstallEvidenceSha256 =
    duplicateEvidence.evidence.backendInstallationSha256;
  assertRejected(duplicateEvidence, 'transition', /distinct SHA-256 bindings/u);

  const ambiguous = JSON.stringify(preparationRecord('apiDatabase')).replace(
    '{"schemaVersion":2,',
    '{"schemaVersion":2,"schemaVersion":2,',
  );
  withLocalRecord(ambiguous, (path) => assertInputRejected(path));
});

test('rejects noncanonical adoption, unpinned operator adoption, duplicate initial versions, and example escalation', () => {
  const partial = adoptionRecord();
  partial.targetState.redis.slots.b.generation = 0;
  partial.targetState.redis.slots.b.currentVersionId = 'UNPINNED';
  partial.targetState.redis.slots.b.usedVersionIds = [];
  assertRejected(partial, 'adopt', /pin seven exact versions/u);

  const unpinnedOperator = adoptionRecord();
  unpinnedOperator.targetState.redisOperatorSecretVersionId = 'UNPINNED';
  assertRejected(
    unpinnedOperator,
    'adopt',
    /redisOperatorSecretVersionId may be unpinned only|pin seven exact versions/u,
  );

  const duplicate = adoptionRecord();
  duplicate.targetState.redis.slots.b.currentVersionId =
    duplicate.targetState.apiDatabase.slots.a.currentVersionId;
  duplicate.targetState.redis.slots.b.usedVersionIds = [
    duplicate.targetState.redis.slots.b.currentVersionId,
  ];
  assertRejected(duplicate, 'adopt', /reuse a version identity/u);

  const escalated = structuredClone(exampleRecord);
  escalated.status = 'APPROVED';
  assertRejected(escalated, 'example', /remain inert/u);
  assertRejected(exampleRecord, 'transition', /Operational record status|record approval/u);
});

test('rejects legacy schema and malformed or omitted Redis operator version state', () => {
  const legacy = preparationRecord('apiDatabase');
  legacy.schemaVersion = 1;
  assertRejected(legacy, 'transition', /schemaVersion must be 2/u);

  for (const invalid of [undefined, 'AWSCURRENT', 'short', `${'a'.repeat(31)}!`]) {
    const record = preparationRecord('apiDatabase');
    if (invalid === undefined) delete record.currentState.redisOperatorSecretVersionId;
    else record.currentState.redisOperatorSecretVersionId = invalid;
    record.predecessor.stateSha256 = canonicalStateHash(record.currentState);
    assertRejected(
      record,
      'transition',
      /exact reviewed keys|redisOperatorSecretVersionId must be UNPINNED or one exact/u,
    );
  }
});

test('secure loader rejects empty, oversized, malformed UTF-8, and BOM-prefixed records', () => {
  const valid = Buffer.from(JSON.stringify(preparationRecord('apiDatabase')), 'utf8');
  for (const contents of [
    Buffer.alloc(0),
    Buffer.alloc(MAX_FIXED_SLOT_TRANSITION_RECORD_BYTES + 1, 0x20),
    Buffer.concat([valid.subarray(0, valid.length - 1), Buffer.from([0xff])]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]),
  ]) {
    withLocalRecord(contents, (path) => assertInputRejected(path));
  }
});

test('secure loader rejects directories and hard-linked records', () => {
  const directory = mkdtempSync(join(LOCAL_TRANSITION_ROOT, 'fixed-slot-files-'));
  try {
    const directoryPath = join(directory, 'directory.credential-transition.local.json');
    mkdirSync(directoryPath);
    assertInputRejected(directoryPath);

    const sourcePath = join(directory, 'source.credential-transition.local.json');
    const linkedPath = join(directory, 'linked.credential-transition.local.json');
    writeFileSync(sourcePath, JSON.stringify(preparationRecord('apiDatabase')));
    linkSync(sourcePath, linkedPath);
    assertInputRejected(sourcePath);
    assertInputRejected(linkedPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('secure loader rejects a symbolic-link record when supported', (context) => {
  const directory = mkdtempSync(join(LOCAL_TRANSITION_ROOT, 'fixed-slot-symlink-'));
  try {
    const targetPath = join(directory, 'target.credential-transition.local.json');
    const linkedPath = join(directory, 'linked.credential-transition.local.json');
    writeFileSync(targetPath, JSON.stringify(preparationRecord('apiDatabase')));
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

test('secure loader rejects same-size mutation during stable descriptor reads', () => {
  const source = JSON.stringify(preparationRecord('apiDatabase'));
  const replacement = source.replace('"status":"APPROVED"', '"status":"REJECTED"');
  assert.equal(Buffer.byteLength(source), Buffer.byteLength(replacement));
  withLocalRecord(source, (path) => {
    assert.throws(
      () =>
        loadFixedSlotCredentialTransitionRecordForTest(path, 'transition', () => {
          writeFileSync(path, replacement);
        }),
      (error) => error instanceof Error && error.message === FIXED_SLOT_TRANSITION_INPUT_ERROR,
    );
  });
});

test('operational records are accepted only from the ignored local location and suffix', () => {
  const outside = mkdtempSync(join(tmpdir(), 'fixed-slot-outside-'));
  try {
    const outsidePath = join(outside, 'approved.credential-transition.local.json');
    writeFileSync(outsidePath, JSON.stringify(preparationRecord('apiDatabase')));
    assertInputRejected(outsidePath);

    withLocalRecord(JSON.stringify(preparationRecord('apiDatabase')), (path, directory) => {
      const wrongSuffix = join(directory, 'approved.json');
      writeFileSync(wrongSuffix, readFileSync(path));
      assertInputRejected(wrongSuffix);
      assert.deepEqual(
        loadFixedSlotCredentialTransitionRecord(path, 'transition'),
        preparationRecord('apiDatabase'),
      );
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('CLI exposes fixed path-free argument and input failures', () => {
  const hostileArgument = '--customer-secret-value';
  const argumentFailure = spawnSync(process.execPath, [validatorPath, hostileArgument], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(argumentFailure.status, 2);
  assert.equal(argumentFailure.stdout, '');
  assert.match(
    argumentFailure.stderr,
    new RegExp(FIXED_SLOT_TRANSITION_ARGUMENT_ERROR.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  );
  assert.equal(argumentFailure.stderr.includes(hostileArgument), false);

  const missingPath = join(
    LOCAL_TRANSITION_ROOT,
    'missing-sensitive-name.credential-transition.local.json',
  );
  const inputFailure = spawnSync(process.execPath, operationalCliArguments(missingPath), {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(inputFailure.status, 2);
  assert.equal(inputFailure.stdout, '');
  assert.match(inputFailure.stderr, /bounded, canonical, stable, single-link/u);
  assert.equal(inputFailure.stderr.includes(missingPath), false);
  assert.match(inputFailure.stderr, /awsCallsMade: 0/u);
  assert.match(inputFailure.stderr, /databaseConnectionsMade: 0/u);
  assert.match(inputFailure.stderr, /redisConnectionsMade: 0/u);
  assert.match(inputFailure.stderr, /filesWritten: 0/u);
});

test('operational CLI requires every external identity binding and explicit validation instant', () => {
  withLocalRecord(JSON.stringify(preparationRecord('apiDatabase')), (path) => {
    const completeArguments = operationalCliArguments(path);
    const complete = spawnSync(process.execPath, completeArguments, {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(complete.status, 0, complete.stderr);
    const report = JSON.parse(complete.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.operation, 'PREPARE_INACTIVE');

    for (const requiredArgument of [
      '--record',
      ...operationalCliBindings().map(([name]) => name),
    ]) {
      const missing = [...completeArguments];
      const index = missing.indexOf(requiredArgument);
      missing.splice(index, 2);
      const failure = spawnSync(process.execPath, missing, {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(failure.status, 2, `${requiredArgument}: ${failure.stderr}`);
      assert.equal(failure.stdout, '');
      assert.match(failure.stderr, /Usage: validate-fixed-slot-credential-transition/u);
      assert.equal(failure.stderr.includes(path), false);
    }

    const invalidInstant = [...completeArguments];
    invalidInstant[invalidInstant.indexOf('--at') + 1] = '2027-01-01T12:00:00.000Z';
    const invalidInstantFailure = spawnSync(process.execPath, invalidInstant, {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(invalidInstantFailure.status, 2);
    assert.equal(invalidInstantFailure.stderr.includes('2027-01-01'), false);

    const wrongIdentity = [...completeArguments];
    wrongIdentity[wrongIdentity.indexOf('--expected-stack-id') + 1] =
      'arn:aws:cloudformation:us-west-2:123456789012:stack/crypto-lending-staging/87654321-abcd-1234-abcd-123456789012';
    const wrongIdentityFailure = spawnSync(process.execPath, wrongIdentity, {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(wrongIdentityFailure.status, 1);
    const wrongIdentityReport = JSON.parse(wrongIdentityFailure.stdout);
    assert.equal(wrongIdentityReport.ok, false);
    assert.match(wrongIdentityReport.errors.join('\n'), /expected deployment identity/u);
  });

  withLocalRecord(JSON.stringify(adoptionRecord()), (path) => {
    const adopted = spawnSync(process.execPath, operationalCliArguments(path, 'adopt'), {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(adopted.status, 0, adopted.stderr);
    assert.equal(JSON.parse(adopted.stdout).operation, 'ADOPT_AND_PIN');
  });
});

test('example CLI rejects every operational-only argument', () => {
  for (const [argument, value] of operationalCliBindings()) {
    const failure = spawnSync(
      process.execPath,
      [validatorPath, '--mode', 'example', argument, value],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.equal(failure.status, 2, `${argument}: ${failure.stderr}`);
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /Usage: validate-fixed-slot-credential-transition/u);
    assert.equal(failure.stderr.includes(value), false);
  }
});

test('CLI default remains inert and cannot invoke canary external clients', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fixed-slot-canaries-'));
  const marker = join(directory, 'external-client-invoked');
  try {
    for (const command of ['aws', 'psql', 'redis-cli']) {
      const path = join(directory, process.platform === 'win32' ? `${command}.cmd` : command);
      const source =
        process.platform === 'win32'
          ? `@echo off\r\ntype nul > "${marker}"\r\nexit /b 91\r\n`
          : `#!/bin/sh\n: > "${marker}"\nexit 91\n`;
      writeFileSync(path, source);
      if (process.platform !== 'win32') chmodSync(path, 0o700);
    }
    const result = spawnSync(process.execPath, [validatorPath, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: directory, Path: directory },
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.readyForAuthorizedPlan, false);
    assert.equal(report.externalCallsMade, 0);
    assert.equal(report.awsCallsMade, 0);
    assert.equal(report.databaseConnectionsMade, 0);
    assert.equal(report.redisConnectionsMade, 0);
    assert.equal(report.filesWritten, 0);
    assert.equal(existsFileSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('validator source has no external client, subprocess, network, or write capability', () => {
  for (const forbidden of [
    'node:child_process',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:dns',
    '@aws-sdk',
    "from 'pg'",
    'ioredis',
    'redis-cli',
    'psql',
    'writeFile',
    'appendFile',
    "'--apply'",
    "'--execute'",
  ]) {
    assert.equal(validatorSource.includes(forbidden), false, `forbidden capability: ${forbidden}`);
  }
  assert.match(validatorSource, /externalCallsMade: 0/u);
  assert.match(validatorSource, /awsCallsMade: 0/u);
  assert.match(validatorSource, /databaseConnectionsMade: 0/u);
  assert.match(validatorSource, /redisConnectionsMade: 0/u);
  assert.match(validatorSource, /filesWritten: 0/u);
});

function existsFileSync(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
