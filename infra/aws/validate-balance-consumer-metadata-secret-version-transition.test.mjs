import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
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
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BALANCE_CONSUMER_METADATA_SECRET_FIELD,
  BALANCE_CONSUMER_METADATA_SECRET_FIELDS,
  BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR,
  BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY,
  BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR,
  DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD,
  LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT,
  MAX_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD_BYTES,
  balanceConsumerMetadataSecretTransitionSigningBytes,
  balanceConsumerMetadataTransitionStateSha256,
  canonicalizeBalanceConsumerMetadataTransitionValue,
  isProductionAuthorizedBalanceConsumerMetadataTransitionReport,
  loadBalanceConsumerMetadataSecretVersionTransitionRecord,
  loadBalanceConsumerMetadataSecretVersionTransitionRecordForTest,
  validateBalanceConsumerMetadataSecretVersionTransition,
  verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry,
} from './validate-balance-consumer-metadata-secret-version-transition.mjs';
import { authWalletTransitionStateSha256 } from './validate-auth-wallet-secret-version-transition.mjs';

const validatorPath = fileURLToPath(
  new URL('./validate-balance-consumer-metadata-secret-version-transition.mjs', import.meta.url),
);

const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
const STACK = 'crypto-lending-staging';
const STACK_ID = `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/11111111-1111-1111-1111-111111111111`;
const ENVIRONMENT = 'staging';
const ENVELOPE_SHA256 = 'a'.repeat(64);
const AUTH_WALLET_TRANSITION_SHA256 = 'f'.repeat(64);
function fixtureSecretArn(name) {
  return ['arn:aws:secretsmanager', REGION, ACCOUNT, `secret:${name}`].join(':');
}
const METADATA_SECRET_ARN = fixtureSecretArn('balance-consumer-metadata-AbCd12');
const AUTH_WALLET_SECRET_ARN = fixtureSecretArn('auth-wallet-AbCd12');
const DATABASE_SECRET_ARN = fixtureSecretArn('database-runtime-AbCd12');
const REDIS_SECRET_ARN = fixtureSecretArn('redis-runtime-AbCd12');
const KMS_KEY_ARN = `arn:aws:kms:${REGION}:${ACCOUNT}:key/11111111-1111-1111-1111-111111111111`;
const FIRST_VERSION = 'A'.repeat(32);
const SECOND_VERSION = 'B'.repeat(32);
const THIRD_VERSION = 'C'.repeat(32);
const AUTH_WALLET_FIRST_VERSION = 'D'.repeat(32);
const AUTH_WALLET_SECOND_VERSION = 'E'.repeat(32);
const AUTH_WALLET_THIRD_VERSION = 'F'.repeat(32);
const NOW = new Date('2026-09-05T12:30:00Z');
const ISSUED_AT = '2026-09-05T12:00:00Z';
const EXPIRES_AT = '2026-09-06T12:00:00Z';

function clone(value) {
  return structuredClone(value);
}

function manifest(activeWriteVersion, versions, retiredOrBurnedKeyVersions = []) {
  return {
    schemaVersion: 1,
    fieldName: BALANCE_CONSUMER_METADATA_SECRET_FIELD,
    purpose: 'metadata-seal',
    activeWriteVersion,
    keys: versions.map((version) => ({
      keyId: `balance-consumer-metadata-v${version}`,
      version,
    })),
    retiredOrBurnedKeyVersions,
    containsSecretMaterial: false,
  };
}

function authWalletMetadataProjection(
  activeWriteVersion,
  versions,
  retiredOrBurnedKeyVersions = [],
) {
  return {
    schemaVersion: 1,
    fieldName: 'WALLET_METADATA_SEAL_KEY_RING_JSON',
    purpose: 'metadata-seal',
    activeWriteVersion,
    keys: versions.map((version) => ({
      keyId: `wallet-metadata-v${version}`,
      version,
    })),
    retiredOrBurnedKeyVersions,
    containsSecretMaterial: false,
  };
}

const AUTH_WALLET_RING_FIXTURES = Object.freeze({
  AUTH_IDENTITY_HMAC_KEY_RING_JSON: ['AUTH_IDENTITY_HMAC', 'identity_v'],
  AUTH_SESSION_HMAC_KEY_RING_JSON: ['AUTH_SESSION_HMAC', 'session_v'],
  AUTH_CSRF_HMAC_KEY_RING_JSON: ['AUTH_CSRF_HMAC', 'csrf_v'],
  WALLET_IDENTITY_HMAC_KEY_RING_JSON: ['WALLET_IDENTITY_HMAC', 'wallet-identity-v'],
  WALLET_CHALLENGE_HMAC_KEY_RING_JSON: ['WALLET_CHALLENGE_HMAC', 'wallet-challenge-v'],
  WALLET_METADATA_SEAL_KEY_RING_JSON: ['WALLET_METADATA_SEAL', 'wallet-metadata-v'],
});

function authWalletKey(prefix, version) {
  return { keyId: `${prefix}${version}`, version };
}

function sourceAuthWalletState(
  activeWriteVersion = 1,
  versions = [1],
  retiredVersions = [],
  outerVersionIds = [AUTH_WALLET_FIRST_VERSION],
) {
  const sourceManifest = { AUTH_PREAUTH_SEAL_KEY: { presence: 'PRESENT' } };
  for (const [fieldName, [purpose, prefix]] of Object.entries(AUTH_WALLET_RING_FIXTURES)) {
    const ringVersions = fieldName === 'WALLET_METADATA_SEAL_KEY_RING_JSON' ? versions : [1];
    const ringRetired = fieldName === 'WALLET_METADATA_SEAL_KEY_RING_JSON' ? retiredVersions : [];
    const keys = ringVersions.map((version) => authWalletKey(prefix, version));
    const retiredOrBurnedKeys = ringRetired.map((version) => authWalletKey(prefix, version));
    const usedKeys = [...keys, ...retiredOrBurnedKeys].sort(
      (left, right) => left.version - right.version,
    );
    sourceManifest[fieldName] = {
      purpose,
      activeWriteVersion:
        fieldName === 'WALLET_METADATA_SEAL_KEY_RING_JSON' ? activeWriteVersion : 1,
      keys,
      usedKeys,
      retiredOrBurnedKeys,
    };
  }
  return {
    secretArn: AUTH_WALLET_SECRET_ARN,
    kmsKeyArn: KMS_KEY_ARN,
    currentVersionId: outerVersionIds.at(-1),
    usedVersionIds: outerVersionIds,
    manifest: sourceManifest,
  };
}

const AUTH_WALLET_STATE_SHA256 = authWalletTransitionStateSha256(sourceAuthWalletState());

function state(currentVersionId, usedVersionIds, keyManifest) {
  return {
    secretArn: METADATA_SECRET_ARN,
    kmsKeyArn: KMS_KEY_ARN,
    currentVersionId,
    usedVersionIds,
    manifest: keyManifest,
  };
}

const EVIDENCE_FIELD_NAMES = [
  'currentDeploymentCaptureSha256',
  'currentManifestSha256',
  'targetManifestSha256',
  'outerVersionInventorySha256',
  'metadataOnlyFieldInventorySha256',
  'secretSeparationSha256',
  'databaseKeyUsageSha256',
  'metadataKeyContinuitySha256',
  'databaseRewrapReadinessSha256',
  'candidateTaskReadinessSha256',
  'taskReplacementPlanSha256',
  'rollbackPlanSha256',
  'retirementReadinessSha256',
];

function operationEvidence(mode, action) {
  const required = new Set();
  if (mode === 'create') {
    for (const key of [
      'targetManifestSha256',
      'outerVersionInventorySha256',
      'metadataOnlyFieldInventorySha256',
      'secretSeparationSha256',
      'databaseKeyUsageSha256',
      'metadataKeyContinuitySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ]) {
      required.add(key);
    }
  } else if (mode === 'adopt') {
    for (const key of [
      'currentDeploymentCaptureSha256',
      'currentManifestSha256',
      'outerVersionInventorySha256',
      'metadataOnlyFieldInventorySha256',
      'secretSeparationSha256',
      'databaseKeyUsageSha256',
      'metadataKeyContinuitySha256',
      'candidateTaskReadinessSha256',
      'rollbackPlanSha256',
    ]) {
      required.add(key);
    }
  } else {
    for (const key of EVIDENCE_FIELD_NAMES) {
      if (!['retirementReadinessSha256', 'databaseRewrapReadinessSha256'].includes(key)) {
        required.add(key);
      }
    }
    if (action === 'RETIRE_PREDECESSOR') {
      required.add('databaseRewrapReadinessSha256');
      required.add('retirementReadinessSha256');
    }
  }
  const domains = '123456789abcd';
  return Object.fromEntries(
    EVIDENCE_FIELD_NAMES.map((key, index) => [
      key,
      required.has(key) ? domains[index].repeat(64) : 'NOT_APPLICABLE',
    ]),
  );
}

function baseContent() {
  return {
    status: 'APPROVED',
    recordId: 'balance-consumer-metadata/create/2026-09-05/initial-ring',
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    deployment: {
      accountId: ACCOUNT,
      region: REGION,
      stackName: STACK,
      stackId: STACK_ID,
      environmentName: ENVIRONMENT,
      balanceConsumerEnvelopeSha256: ENVELOPE_SHA256,
    },
    operation: { kind: 'CREATE_SECRET', action: 'CREATE_INITIAL_VERSION' },
    predecessor: {
      stateSha256: 'UNTRACKED',
      transitionSha256: 'NONE',
      authWalletStateSha256: AUTH_WALLET_STATE_SHA256,
      authWalletTransitionSha256: AUTH_WALLET_TRANSITION_SHA256,
    },
    currentState: null,
    targetState: state(FIRST_VERSION, [FIRST_VERSION], manifest(1, [1])),
    authWalletState: sourceAuthWalletState(),
    authWalletMetadataProjection: authWalletMetadataProjection(1, [1]),
    requiredSecretFields: [...BALANCE_CONSUMER_METADATA_SECRET_FIELDS],
    separation: {
      authWalletSecretArn: AUTH_WALLET_SECRET_ARN,
      databaseSecretArn: DATABASE_SECRET_ARN,
      redisSecretArn: REDIS_SECRET_ARN,
    },
    evidence: operationEvidence('create', 'CREATE_INITIAL_VERSION'),
    approvals: {
      secretCustodyApprovalRef: 'approval/secret-custody/2026-09-05/security-team',
      walletPrivacyApprovalRef: 'approval/wallet-privacy/2026-09-05/privacy-team',
      databaseRewrapApprovalRef: 'approval/database-rewrap/2026-09-05/database-team',
      deploymentApprovalRef: 'approval/deployment/2026-09-05/platform-team',
      rollbackApprovalRef: 'approval/rollback/2026-09-05/incident-team',
    },
  };
}

function options(
  mode,
  currentVersionId,
  targetVersionId,
  expectedPredecessorTransitionSha256 = mode === 'transition' ? 'd'.repeat(64) : 'NONE',
  expectedAuthWalletStateSha256 = AUTH_WALLET_STATE_SHA256,
  expectedAuthWalletTransitionSha256 = AUTH_WALLET_TRANSITION_SHA256,
) {
  return {
    mode,
    now: NOW,
    expectedAccount: ACCOUNT,
    expectedRegion: REGION,
    expectedStack: STACK,
    expectedStackId: STACK_ID,
    expectedEnvironment: ENVIRONMENT,
    expectedEnvelopeSha256: ENVELOPE_SHA256,
    expectedSecretArn: METADATA_SECRET_ARN,
    expectedKmsKeyArn: KMS_KEY_ARN,
    expectedAuthWalletSecretArn: AUTH_WALLET_SECRET_ARN,
    expectedDatabaseSecretArn: DATABASE_SECRET_ARN,
    expectedRedisSecretArn: REDIS_SECRET_ARN,
    expectedCurrentVersionId: currentVersionId,
    expectedTargetVersionId: targetVersionId,
    expectedPredecessorTransitionSha256,
    expectedAuthWalletStateSha256,
    expectedAuthWalletTransitionSha256,
  };
}

function authority(role, keyId, publicKey) {
  return {
    keyId,
    algorithm: 'Ed25519',
    status: 'APPROVED',
    role,
    scope: 'BALANCE_CONSUMER_METADATA_SECRET_VERSION_TRANSITION',
    publicKeySpkiDerBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    validFrom: '2026-09-01T00:00:00Z',
    validUntil: '2026-09-30T00:00:00Z',
    approvalReferenceId: `authority/${keyId}/2026-09-01`,
  };
}

function signedRecord(content) {
  const first = generateKeyPairSync('ed25519');
  const second = generateKeyPairSync('ed25519');
  const unsigned = {
    schemaVersion: 1,
    artifactType: 'BALANCE_CONSUMER_METADATA_SECRET_VERSION_TRANSITION',
    content,
  };
  const bytes = balanceConsumerMetadataSecretTransitionSigningBytes(unsigned);
  const signatures = [
    {
      role: 'BALANCE_CONSUMER_METADATA_TRANSITION_ISSUER',
      scope: 'BALANCE_CONSUMER_METADATA_SECRET_VERSION_TRANSITION',
      authorityKeyId: 'metadata-transition-issuer',
      algorithm: 'Ed25519',
      valueBase64: sign(null, bytes, first.privateKey).toString('base64'),
    },
    {
      role: 'INDEPENDENT_BALANCE_CONSUMER_METADATA_TRANSITION_VERIFIER',
      scope: 'BALANCE_CONSUMER_METADATA_SECRET_VERSION_TRANSITION',
      authorityKeyId: 'metadata-transition-verifier',
      algorithm: 'Ed25519',
      valueBase64: sign(null, bytes, second.privateKey).toString('base64'),
    },
  ];
  return {
    record: { ...unsigned, signatures },
    registry: {
      schemaVersion: 1,
      artifactType: 'BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY',
      keys: [
        authority(
          'BALANCE_CONSUMER_METADATA_TRANSITION_ISSUER',
          'metadata-transition-issuer',
          first.publicKey,
        ),
        authority(
          'INDEPENDENT_BALANCE_CONSUMER_METADATA_TRANSITION_VERIFIER',
          'metadata-transition-verifier',
          second.publicKey,
        ),
      ],
    },
  };
}

function verify(content, mode, currentVersionId, targetVersionId) {
  const signed = signedRecord(content);
  return verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    signed.record,
    options(
      mode,
      currentVersionId,
      targetVersionId,
      content.predecessor.transitionSha256,
      content.predecessor.authWalletStateSha256,
      content.predecessor.authWalletTransitionSha256,
    ),
    signed.registry,
  );
}

function assertFrozenSanitizedFailure(action, marker) {
  let report;
  assert.doesNotThrow(() => {
    report = action();
  });
  assert.equal(report.ok, false);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(report.productionAuthorityValidated, false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.errors), true);
  assert.equal(JSON.stringify(report).includes(marker), false);
  return report;
}

function transitionContent(action = 'ADD_AND_ACTIVATE_SUCCESSOR') {
  const content = baseContent();
  content.recordId = 'balance-consumer-metadata/transition/2026-09-05/rotate-ring';
  content.operation = { kind: 'ROTATE_SECRET_VERSION', action };
  content.currentState = state(FIRST_VERSION, [FIRST_VERSION], manifest(1, [1]));
  content.targetState =
    action === 'ADD_AND_ACTIVATE_SUCCESSOR'
      ? state(SECOND_VERSION, [FIRST_VERSION, SECOND_VERSION], manifest(2, [1, 2]))
      : state(THIRD_VERSION, [FIRST_VERSION, SECOND_VERSION, THIRD_VERSION], manifest(2, [2], [1]));
  content.authWalletMetadataProjection =
    action === 'ADD_AND_ACTIVATE_SUCCESSOR'
      ? authWalletMetadataProjection(2, [1, 2])
      : authWalletMetadataProjection(2, [2], [1]);
  content.authWalletState =
    action === 'ADD_AND_ACTIVATE_SUCCESSOR'
      ? sourceAuthWalletState(
          2,
          [1, 2],
          [],
          [AUTH_WALLET_FIRST_VERSION, AUTH_WALLET_SECOND_VERSION],
        )
      : sourceAuthWalletState(
          2,
          [2],
          [1],
          [AUTH_WALLET_FIRST_VERSION, AUTH_WALLET_SECOND_VERSION, AUTH_WALLET_THIRD_VERSION],
        );
  if (action === 'RETIRE_PREDECESSOR') {
    content.currentState = state(
      SECOND_VERSION,
      [FIRST_VERSION, SECOND_VERSION],
      manifest(2, [1, 2]),
    );
  }
  content.predecessor = {
    stateSha256: balanceConsumerMetadataTransitionStateSha256(content.currentState),
    transitionSha256: 'd'.repeat(64),
    authWalletStateSha256: authWalletTransitionStateSha256(content.authWalletState),
    authWalletTransitionSha256: AUTH_WALLET_TRANSITION_SHA256,
  };
  content.evidence = operationEvidence('transition', action);
  return content;
}

function adoptContent(version = 1) {
  const content = baseContent();
  content.recordId = 'balance-consumer-metadata/adopt/2026-09-05/existing-ring';
  content.operation = { kind: 'ADOPT_EXISTING_SECRET', action: 'ADOPT_CURRENT_VERSION' };
  content.currentState = state(FIRST_VERSION, [FIRST_VERSION], manifest(version, [version]));
  content.targetState = clone(content.currentState);
  content.authWalletState = sourceAuthWalletState(version, [version]);
  content.authWalletMetadataProjection = authWalletMetadataProjection(version, [version]);
  content.predecessor.authWalletStateSha256 = authWalletTransitionStateSha256(
    content.authWalletState,
  );
  content.evidence = operationEvidence('adopt', 'ADOPT_CURRENT_VERSION');
  return content;
}

function operationalCliArguments(recordPath, mode = 'create') {
  const expectedAuthWalletStateSha256 =
    mode === 'transition'
      ? authWalletTransitionStateSha256(
          sourceAuthWalletState(
            2,
            [1, 2],
            [],
            [AUTH_WALLET_FIRST_VERSION, AUTH_WALLET_SECOND_VERSION],
          ),
        )
      : AUTH_WALLET_STATE_SHA256;
  return [
    validatorPath,
    '--record',
    recordPath,
    '--mode',
    mode,
    '--at',
    '2026-09-05T12:30:00Z',
    '--expected-account',
    ACCOUNT,
    '--expected-region',
    REGION,
    '--expected-stack',
    STACK,
    '--expected-stack-id',
    STACK_ID,
    '--expected-environment',
    ENVIRONMENT,
    '--expected-envelope-sha256',
    ENVELOPE_SHA256,
    '--expected-secret-arn',
    METADATA_SECRET_ARN,
    '--expected-kms-key-arn',
    KMS_KEY_ARN,
    '--expected-auth-wallet-secret-arn',
    AUTH_WALLET_SECRET_ARN,
    '--expected-database-secret-arn',
    DATABASE_SECRET_ARN,
    '--expected-redis-secret-arn',
    REDIS_SECRET_ARN,
    '--expected-current-version-id',
    mode === 'create' ? 'NO_DEPLOYED_VERSION' : FIRST_VERSION,
    '--expected-target-version-id',
    mode === 'create' ? FIRST_VERSION : SECOND_VERSION,
    '--expected-predecessor-transition-sha256',
    mode === 'transition' ? 'd'.repeat(64) : 'NONE',
    '--expected-auth-wallet-state-sha256',
    expectedAuthWalletStateSha256,
    '--expected-auth-wallet-transition-sha256',
    AUTH_WALLET_TRANSITION_SHA256,
    '--json',
  ];
}

test('the checked-in example is inert, metadata-only, unsigned, and offline', () => {
  const record = loadBalanceConsumerMetadataSecretVersionTransitionRecord(
    DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD,
    'example',
  );
  const report = validateBalanceConsumerMetadataSecretVersionTransition(record);
  assert.equal(report.ok, true);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(report.productionAuthorityValidated, false);
  assert.equal(report.signatureValidated, false);
  assert.equal(report.operation, 'EXAMPLE_ONLY');
  assert.deepEqual(record.content.requiredSecretFields, [
    'BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON',
  ]);
  assert.deepEqual(BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY.keys, []);
  for (const key of [
    'externalCallsMade',
    'awsCallsMade',
    'databaseConnectionsMade',
    'redisConnectionsMade',
    'dnsQueriesMade',
    'httpRequestsMade',
    'secretValuesRead',
    'resourcesCreated',
    'credentialBytesRead',
    'filesWritten',
  ]) {
    assert.equal(report[key], 0);
  }
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.errors), true);
});

test('a two-role signed CREATE can pass only the test seam and remains non-executable', () => {
  const content = baseContent();
  const report = verify(content, 'create', 'NO_DEPLOYED_VERSION', FIRST_VERSION);
  assert.equal(report.ok, true);
  assert.equal(report.signatureValidated, true);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(report.productionAuthorityValidated, false);
  assert.equal(isProductionAuthorizedBalanceConsumerMetadataTransitionReport(report), false);
  assert.equal(report.plan.executionAllowed, false);
  assert.equal(report.plan.separateAuthorizationRequired, true);
  assert.equal(report.predecessorTransitionSha256, 'NONE');
  assert.equal(report.authWalletStateSha256, AUTH_WALLET_STATE_SHA256);
  assert.equal(report.authWalletTransitionSha256, AUTH_WALLET_TRANSITION_SHA256);
  assert.equal(JSON.stringify(report).includes(METADATA_SECRET_ARN), false);
  assert.equal(JSON.stringify(report).includes(FIRST_VERSION), false);

  const publicReport = validateBalanceConsumerMetadataSecretVersionTransition(
    signedRecord(content).record,
    options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
  );
  assert.equal(publicReport.ok, false);
  assert.match(publicReport.errors[0], /production authority path/u);
});

test('signed successor and retirement transitions enforce exact inner and outer histories', () => {
  const successor = verify(transitionContent(), 'transition', FIRST_VERSION, SECOND_VERSION);
  assert.equal(successor.ok, true);
  assert.equal(successor.operation, 'ADD_AND_ACTIVATE_SUCCESSOR');
  assert.equal(successor.predecessorTransitionSha256, 'd'.repeat(64));

  const retirement = verify(
    transitionContent('RETIRE_PREDECESSOR'),
    'transition',
    SECOND_VERSION,
    THIRD_VERSION,
  );
  assert.equal(retirement.ok, true);
  assert.equal(retirement.operation, 'RETIRE_PREDECESSOR');
});

test('ADOPT permits only an unchanged, separately bound existing state', () => {
  const content = adoptContent();
  const report = verify(content, 'adopt', FIRST_VERSION, FIRST_VERSION);
  assert.equal(report.ok, true);
  assert.equal(report.operation, 'ADOPT_CURRENT_VERSION');
});

test('CREATE mirrors an already-rotated auth-wallet metadata ring into one outer version', () => {
  const content = baseContent();
  const retired = [1, 2, 3, 4, 5];
  content.targetState = state(FIRST_VERSION, [FIRST_VERSION], manifest(7, [6, 7], retired));
  content.authWalletState = sourceAuthWalletState(7, [6, 7], retired);
  content.authWalletMetadataProjection = authWalletMetadataProjection(7, [6, 7], retired);
  content.predecessor.authWalletStateSha256 = authWalletTransitionStateSha256(
    content.authWalletState,
  );
  const report = verify(content, 'create', 'NO_DEPLOYED_VERSION', FIRST_VERSION);
  assert.equal(report.ok, true);
  assert.equal(report.operation, 'CREATE_INITIAL_VERSION');
});

test('hostile example substitutions cannot turn the inert record into authority', () => {
  const example = JSON.parse(
    readFileSync(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD, 'utf8'),
  );
  const attacks = [
    (value) => {
      value.extra = true;
    },
    (value) => {
      value.content.status = 'APPROVED';
    },
    (value) => {
      value.content.requiredSecretFields.push('AUTH_SESSION_HMAC_KEY_RING_JSON');
    },
    (value) => {
      value.content.separation.authWalletSecretArn = 'NOT_AUTHORIZED';
    },
    (value) => {
      value.content.evidence.targetManifestSha256 = '0'.repeat(64);
    },
    (value) => {
      value.signatures.push({ role: 'self-approved' });
    },
  ];
  for (const attack of attacks) {
    const candidate = clone(example);
    attack(candidate);
    const report = validateBalanceConsumerMetadataSecretVersionTransition(candidate);
    assert.equal(report.ok, false);
    assert.equal(report.readyForAuthorizedPlan, false);
  }
});

test('hostile operational mutations fail before authority can be reported', () => {
  const attacks = [
    (content) => {
      content.requiredSecretFields = ['WALLET_METADATA_SEAL_KEY_RING_JSON'];
    },
    (content) => {
      content.targetState.manifest.material = 'sensitive-key-material';
    },
    (content) => {
      content.targetState.manifest.containsSecretMaterial = true;
    },
    (content) => {
      content.targetState.manifest.fieldName = 'AUTH_IDENTITY_HMAC_KEY_RING_JSON';
    },
    (content) => {
      content.separation.authWalletSecretArn = METADATA_SECRET_ARN;
    },
    (content) => {
      content.targetState.secretArn = AUTH_WALLET_SECRET_ARN;
    },
    (content) => {
      content.targetState.kmsKeyArn = `arn:aws:kms:us-west-2:${ACCOUNT}:key/11111111-1111-1111-1111-111111111111`;
    },
    (content) => {
      content.targetState.kmsKeyArn = `arn:aws-us-gov:kms:${REGION}:${ACCOUNT}:key/11111111-1111-1111-1111-111111111111`;
    },
    (content) => {
      content.targetState.currentVersionId = 'AWSCURRENT';
      content.targetState.usedVersionIds = ['AWSCURRENT'];
    },
    (content) => {
      content.targetState.usedVersionIds = [FIRST_VERSION, FIRST_VERSION];
    },
    (content) => {
      content.targetState.manifest.keys[0].keyId = 'wallet-metadata-v1';
    },
    (content) => {
      content.targetState.manifest.keys.push({
        keyId: 'balance-consumer-metadata-v1',
        version: 1,
      });
    },
    (content) => {
      content.approvals.rollbackApprovalRef = content.approvals.deploymentApprovalRef;
    },
    (content) => {
      content.evidence.rollbackPlanSha256 = 'NOT_RUN';
    },
    (content) => {
      content.recordId = 'balance-consumer-metadata/adopt/2026-09-05/wrong-mode';
    },
  ];
  for (const attack of attacks) {
    const content = baseContent();
    attack(content);
    const report = verify(content, 'create', 'NO_DEPLOYED_VERSION', FIRST_VERSION);
    assert.equal(report.ok, false);
    assert.equal(report.readyForAuthorizedPlan, false);
    assert.equal(report.productionAuthorityValidated, false);
  }
});

test('deployment, validity, secret-name, and key-version boundaries fail closed', () => {
  const stackMismatch = baseContent();
  stackMismatch.deployment.stackName = 'crypto-lending-other';
  const stackMismatchSigned = signedRecord(stackMismatch);
  const stackMismatchOptions = options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION);
  stackMismatchOptions.expectedStack = stackMismatch.deployment.stackName;
  const stackMismatchReport = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    stackMismatchSigned.record,
    stackMismatchOptions,
    stackMismatchSigned.registry,
  );
  assert.equal(stackMismatchReport.ok, false);
  assert.match(stackMismatchReport.errors.join('\n'), /Deployment binding/u);

  for (const expiresAt of ['2026-09-05T12:30:00Z', '2026-09-06T12:00:01Z']) {
    const content = baseContent();
    content.expiresAt = expiresAt;
    const report = verify(content, 'create', 'NO_DEPLOYED_VERSION', FIRST_VERSION);
    assert.equal(report.ok, false);
    assert.match(report.errors.join('\n'), /validity window/u);
  }

  const invalidSecretName = baseContent();
  invalidSecretName.targetState.secretArn = fixtureSecretArn('metadata!runtime-AbCd12');
  const invalidSecretSigned = signedRecord(invalidSecretName);
  const invalidSecretOptions = options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION);
  invalidSecretOptions.expectedSecretArn = invalidSecretName.targetState.secretArn;
  const invalidSecretReport = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    invalidSecretSigned.record,
    invalidSecretOptions,
    invalidSecretSigned.registry,
  );
  assert.equal(invalidSecretReport.ok, false);
  assert.match(invalidSecretReport.errors.join('\n'), /same-account, same-Region/u);

  const maximumAdopt = verify(adoptContent(32_767), 'adopt', FIRST_VERSION, FIRST_VERSION);
  assert.equal(maximumAdopt.ok, true);

  const overflowingAdopt = verify(adoptContent(32_768), 'adopt', FIRST_VERSION, FIRST_VERSION);
  assert.equal(overflowingAdopt.ok, false);
  assert.match(overflowingAdopt.errors.join('\n'), /material-free metadata/u);

  const overflowingSuccessor = transitionContent();
  overflowingSuccessor.currentState = state(
    FIRST_VERSION,
    [FIRST_VERSION],
    manifest(32_767, [32_767]),
  );
  overflowingSuccessor.targetState = state(
    SECOND_VERSION,
    [FIRST_VERSION, SECOND_VERSION],
    manifest(32_768, [32_767, 32_768]),
  );
  overflowingSuccessor.authWalletMetadataProjection = authWalletMetadataProjection(
    32_768,
    [32_767, 32_768],
  );
  overflowingSuccessor.predecessor.stateSha256 = balanceConsumerMetadataTransitionStateSha256(
    overflowingSuccessor.currentState,
  );
  const overflowingSuccessorReport = verify(
    overflowingSuccessor,
    'transition',
    FIRST_VERSION,
    SECOND_VERSION,
  );
  assert.equal(overflowingSuccessorReport.ok, false);
  assert.match(overflowingSuccessorReport.errors.join('\n'), /material-free metadata/u);
});

test('evidence is operation-specific, non-reusable, and binds continuity or rewrap readiness', () => {
  const duplicateEvidence = baseContent();
  for (const key of EVIDENCE_FIELD_NAMES) {
    if (duplicateEvidence.evidence[key] !== 'NOT_APPLICABLE') {
      duplicateEvidence.evidence[key] = '1'.repeat(64);
    }
  }
  const duplicateReport = verify(duplicateEvidence, 'create', 'NO_DEPLOYED_VERSION', FIRST_VERSION);
  assert.equal(duplicateReport.ok, false);
  assert.match(duplicateReport.errors.join('\n'), /distinct domain-specific/u);

  const attacks = [
    {
      content: baseContent(),
      mode: 'create',
      current: 'NO_DEPLOYED_VERSION',
      target: FIRST_VERSION,
      mutate(evidence) {
        evidence.metadataKeyContinuitySha256 = 'NOT_APPLICABLE';
      },
    },
    {
      content: baseContent(),
      mode: 'create',
      current: 'NO_DEPLOYED_VERSION',
      target: FIRST_VERSION,
      mutate(evidence) {
        evidence.currentManifestSha256 = '0'.repeat(64);
      },
    },
    {
      content: adoptContent(),
      mode: 'adopt',
      current: FIRST_VERSION,
      target: FIRST_VERSION,
      mutate(evidence) {
        evidence.metadataKeyContinuitySha256 = 'NOT_APPLICABLE';
      },
    },
    {
      content: transitionContent(),
      mode: 'transition',
      current: FIRST_VERSION,
      target: SECOND_VERSION,
      mutate(evidence) {
        evidence.metadataKeyContinuitySha256 = 'NOT_APPLICABLE';
      },
    },
    {
      content: transitionContent(),
      mode: 'transition',
      current: FIRST_VERSION,
      target: SECOND_VERSION,
      mutate(evidence) {
        evidence.databaseRewrapReadinessSha256 = '0'.repeat(64);
      },
    },
    {
      content: transitionContent('RETIRE_PREDECESSOR'),
      mode: 'transition',
      current: SECOND_VERSION,
      target: THIRD_VERSION,
      mutate(evidence) {
        evidence.databaseKeyUsageSha256 = 'NOT_APPLICABLE';
      },
    },
    {
      content: transitionContent('RETIRE_PREDECESSOR'),
      mode: 'transition',
      current: SECOND_VERSION,
      target: THIRD_VERSION,
      mutate(evidence) {
        evidence.databaseRewrapReadinessSha256 = 'NOT_APPLICABLE';
      },
    },
    {
      content: transitionContent('RETIRE_PREDECESSOR'),
      mode: 'transition',
      current: SECOND_VERSION,
      target: THIRD_VERSION,
      mutate(evidence) {
        evidence.metadataKeyContinuitySha256 = 'NOT_APPLICABLE';
      },
    },
  ];
  for (const attack of attacks) {
    attack.mutate(attack.content.evidence);
    const report = verify(attack.content, attack.mode, attack.current, attack.target);
    assert.equal(report.ok, false);
  }
});

test('auth-wallet hashes and sanitized metadata projection are exact signed bindings', () => {
  const successor = transitionContent();
  const successorSigned = signedRecord(successor);
  const wrongAuthOptions = options(
    'transition',
    FIRST_VERSION,
    SECOND_VERSION,
    successor.predecessor.transitionSha256,
    successor.predecessor.authWalletStateSha256,
  );
  wrongAuthOptions.expectedAuthWalletStateSha256 = '0'.repeat(64);
  const wrongAuthReport = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    successorSigned.record,
    wrongAuthOptions,
    successorSigned.registry,
  );
  assert.equal(wrongAuthReport.ok, false);
  assert.match(wrongAuthReport.errors.join('\n'), /Auth-wallet source bindings/u);

  const forgedSourceHash = transitionContent();
  forgedSourceHash.predecessor.authWalletStateSha256 = '0'.repeat(64);
  const forgedSourceSigned = signedRecord(forgedSourceHash);
  const forgedSourceOptions = options(
    'transition',
    FIRST_VERSION,
    SECOND_VERSION,
    forgedSourceHash.predecessor.transitionSha256,
    forgedSourceHash.predecessor.authWalletStateSha256,
  );
  const forgedSourceReport = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    forgedSourceSigned.record,
    forgedSourceOptions,
    forgedSourceSigned.registry,
  );
  assert.equal(forgedSourceReport.ok, false);
  assert.match(forgedSourceReport.errors.join('\n'), /exact sanitized auth-wallet state/u);

  const sourceHistoryMismatch = transitionContent();
  sourceHistoryMismatch.authWalletState = sourceAuthWalletState();
  const sourceHistoryReport = verify(
    sourceHistoryMismatch,
    'transition',
    FIRST_VERSION,
    SECOND_VERSION,
  );
  assert.equal(sourceHistoryReport.ok, false);
  assert.match(sourceHistoryReport.errors.join('\n'), /exactly derived/u);

  const projectionAttacks = [
    (content) => {
      content.authWalletMetadataProjection.activeWriteVersion = 1;
    },
    (content) => {
      content.authWalletMetadataProjection = authWalletMetadataProjection(2, [2]);
    },
    (content) => {
      content.authWalletMetadataProjection.keys[0].keyId = 'balance-consumer-metadata-v1';
    },
  ];
  for (const attack of projectionAttacks) {
    const content = transitionContent();
    attack(content);
    const report = verify(content, 'transition', FIRST_VERSION, SECOND_VERSION);
    assert.equal(report.ok, false);
  }

  const retirementProjection = transitionContent('RETIRE_PREDECESSOR');
  retirementProjection.authWalletMetadataProjection.retiredOrBurnedKeyVersions = [];
  const retirementProjectionReport = verify(
    retirementProjection,
    'transition',
    SECOND_VERSION,
    THIRD_VERSION,
  );
  assert.equal(retirementProjectionReport.ok, false);
  assert.match(retirementProjectionReport.errors.join('\n'), /must exactly mirror/u);

  const marker = 'auth-wallet-projection-material-must-not-escape';
  const materialProjection = baseContent();
  materialProjection.authWalletMetadataProjection.material = marker;
  const materialReport = assertFrozenSanitizedFailure(
    () => verify(materialProjection, 'create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
    marker,
  );
  assert.equal(Object.hasOwn(materialReport, 'canonicalSha256'), false);

  const sourceMarker = 'auth-wallet-source-material-must-not-escape';
  const materialSource = baseContent();
  materialSource.authWalletState.manifest.AUTH_SESSION_HMAC_KEY_RING_JSON.material = sourceMarker;
  const materialSourceReport = assertFrozenSanitizedFailure(
    () => verify(materialSource, 'create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
    sourceMarker,
  );
  assert.equal(Object.hasOwn(materialSourceReport, 'canonicalSha256'), false);
});

test('failed schema validation never publishes record, state, or predecessor hashes', () => {
  const marker = 'forbidden-current-state-material';
  const content = transitionContent();
  content.currentState.manifest.material = marker;
  const report = assertFrozenSanitizedFailure(
    () => verify(content, 'transition', FIRST_VERSION, SECOND_VERSION),
    marker,
  );
  for (const key of [
    'canonicalSha256',
    'currentStateSha256',
    'targetStateSha256',
    'predecessorTransitionSha256',
    'authWalletStateSha256',
    'authWalletTransitionSha256',
    'authorityRegistrySha256',
  ]) {
    assert.equal(Object.hasOwn(report, key), false);
  }
});

test('predecessor transition binding is exact and is exposed only on success', () => {
  const content = transitionContent();
  const signed = signedRecord(content);
  const wrongOptions = options(
    'transition',
    FIRST_VERSION,
    SECOND_VERSION,
    'c'.repeat(64),
    content.predecessor.authWalletStateSha256,
  );
  const wrongReport = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    signed.record,
    wrongOptions,
    signed.registry,
  );
  assert.equal(wrongReport.ok, false);
  assert.match(wrongReport.errors.join('\n'), /Predecessor transition/u);
  assert.equal(Object.hasOwn(wrongReport, 'predecessorTransitionSha256'), false);
});

test('transition mutations cannot skip keys, replace custody, or erase history', () => {
  const attacks = [
    (content) => {
      content.targetState.manifest.keys[1] = {
        keyId: 'balance-consumer-metadata-v3',
        version: 3,
      };
      content.targetState.manifest.activeWriteVersion = 3;
    },
    (content) => {
      content.targetState.usedVersionIds = [SECOND_VERSION];
    },
    (content) => {
      content.targetState.secretArn = fixtureSecretArn('replacement-metadata-AbCd12');
    },
    (content) => {
      content.predecessor.stateSha256 = '0'.repeat(64);
    },
    (content) => {
      content.operation.action = 'REPLACE_ALL_KEYS';
    },
  ];
  for (const attack of attacks) {
    const content = transitionContent();
    attack(content);
    const report = verify(content, 'transition', FIRST_VERSION, SECOND_VERSION);
    assert.equal(report.ok, false);
  }
});

test('signature substitution and shared-key approvals fail closed', () => {
  const content = baseContent();
  const signed = signedRecord(content);
  signed.record.signatures[0].valueBase64 = Buffer.alloc(64).toString('base64');
  const tampered = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    signed.record,
    options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
    signed.registry,
  );
  assert.equal(tampered.ok, false);

  const shared = signedRecord(content);
  shared.registry.keys[1].publicKeySpkiDerBase64 = shared.registry.keys[0].publicKeySpkiDerBase64;
  const sharedKey = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    shared.record,
    options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
    shared.registry,
  );
  assert.equal(sharedKey.ok, false);
});

test('rejects an identity authority key with a forged identity signature', () => {
  const signed = signedRecord(baseContent());
  const identityPoint = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]);
  const identitySpki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    identityPoint,
  ]);
  signed.registry.keys[0].publicKeySpkiDerBase64 = identitySpki.toString('base64');
  signed.record.signatures[0].valueBase64 = Buffer.concat([
    identityPoint,
    Buffer.alloc(32),
  ]).toString('base64');

  const report = verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
    signed.record,
    options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
    signed.registry,
  );

  assert.equal(report.ok, false);
  assert.equal(report.signatureValidated, false);
  assert.match(report.errors.join('\n'), /production authority registry/u);
});

test('accessors, custom prototypes, cycles, and sparse arrays are rejected without disclosure', () => {
  let reads = 0;
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'schemaVersion', {
    enumerable: true,
    get() {
      reads += 1;
      return 1;
    },
  });
  const accessorReport = validateBalanceConsumerMetadataSecretVersionTransition(accessor);
  assert.equal(accessorReport.ok, false);
  assert.equal(reads, 0);

  const example = JSON.parse(
    readFileSync(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD, 'utf8'),
  );
  Object.setPrototypeOf(example.content, { privileged: true });
  assert.equal(validateBalanceConsumerMetadataSecretVersionTransition(example).ok, false);

  const cyclic = JSON.parse(
    readFileSync(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD, 'utf8'),
  );
  cyclic.content.loop = cyclic;
  assert.equal(validateBalanceConsumerMetadataSecretVersionTransition(cyclic).ok, false);

  const sparse = JSON.parse(
    readFileSync(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD, 'utf8'),
  );
  sparse.content.requiredSecretFields = new Array(1);
  assert.equal(validateBalanceConsumerMetadataSecretVersionTransition(sparse).ok, false);
});

test('nested deployment, target-state, and manifest getters are never invoked', () => {
  const marker = 'getter-secret-must-not-escape';
  const attacks = [
    (record, countRead) => {
      Object.defineProperty(record.content.deployment, 'accountId', {
        enumerable: true,
        get: countRead,
      });
    },
    (record, countRead) => {
      Object.defineProperty(record.content.targetState, 'secretArn', {
        enumerable: true,
        get: countRead,
      });
    },
    (record, countRead) => {
      Object.defineProperty(record.content.targetState.manifest, 'activeWriteVersion', {
        enumerable: true,
        get: countRead,
      });
    },
    (record, countRead) => {
      Object.defineProperty(record.content.authWalletState, 'secretArn', {
        enumerable: true,
        get: countRead,
      });
    },
    (record, countRead) => {
      Object.defineProperty(
        record.content.authWalletState.manifest.WALLET_METADATA_SEAL_KEY_RING_JSON.keys[0],
        'version',
        {
          enumerable: true,
          get: countRead,
        },
      );
    },
  ];
  for (const attack of attacks) {
    const signed = signedRecord(baseContent());
    let reads = 0;
    attack(signed.record, () => {
      reads += 1;
      return marker;
    });
    const report = assertFrozenSanitizedFailure(
      () =>
        verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
          signed.record,
          options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
          signed.registry,
        ),
      marker,
    );
    assert.equal(reads, 0);
    assert.deepEqual(report.errors, ['Record must be a bounded graph of plain JSON data values.']);
  }
});

test('getter-backed, custom-prototype, and custom-key arrays fail without element reads', () => {
  const marker = 'array-getter-secret-must-not-escape';
  const getterBacked = JSON.parse(
    readFileSync(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD, 'utf8'),
  );
  let reads = 0;
  Object.defineProperty(getterBacked.content.requiredSecretFields, '0', {
    enumerable: true,
    get() {
      reads += 1;
      return marker;
    },
  });
  assertFrozenSanitizedFailure(
    () => validateBalanceConsumerMetadataSecretVersionTransition(getterBacked),
    marker,
  );
  assert.equal(reads, 0);
  assert.throws(
    () =>
      canonicalizeBalanceConsumerMetadataTransitionValue(getterBacked.content.requiredSecretFields),
    /array/u,
  );
  assert.equal(reads, 0);

  for (const mutate of [
    (array) => Object.setPrototypeOf(array, Object.create(Array.prototype)),
    (array) => Object.defineProperty(array, 'unexpected', { enumerable: true, value: marker }),
  ]) {
    const candidate = JSON.parse(
      readFileSync(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD, 'utf8'),
    );
    mutate(candidate.content.requiredSecretFields);
    assertFrozenSanitizedFailure(
      () => validateBalanceConsumerMetadataSecretVersionTransition(candidate),
      marker,
    );
  }
});

test('signature and authority-registry element getters are never invoked', () => {
  const marker = 'authority-getter-secret-must-not-escape';

  const signatureAttack = signedRecord(baseContent());
  let signatureReads = 0;
  Object.defineProperty(signatureAttack.record.signatures[0], 'role', {
    enumerable: true,
    get() {
      signatureReads += 1;
      return marker;
    },
  });
  assertFrozenSanitizedFailure(
    () =>
      verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
        signatureAttack.record,
        options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
        signatureAttack.registry,
      ),
    marker,
  );
  assert.equal(signatureReads, 0);

  const registryAttack = signedRecord(baseContent());
  let registryReads = 0;
  Object.defineProperty(registryAttack.registry.keys[0], 'keyId', {
    enumerable: true,
    get() {
      registryReads += 1;
      return marker;
    },
  });
  const registryReport = assertFrozenSanitizedFailure(
    () =>
      verifyBalanceConsumerMetadataSecretVersionTransitionWithTestRegistry(
        registryAttack.record,
        options('create', 'NO_DEPLOYED_VERSION', FIRST_VERSION),
        registryAttack.registry,
      ),
    marker,
  );
  assert.equal(registryReads, 0);
  assert.deepEqual(registryReport.errors, [
    'Record signatures do not satisfy the dedicated production authority registry.',
  ]);
});

test('canonical hashing is stable and rejects non-data graphs', () => {
  const left = { z: [3, 2, 1], a: { y: true, x: 'value' } };
  const right = { a: { x: 'value', y: true }, z: [3, 2, 1] };
  assert.equal(
    canonicalizeBalanceConsumerMetadataTransitionValue(left),
    canonicalizeBalanceConsumerMetadataTransitionValue(right),
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeBalanceConsumerMetadataTransitionValue(cyclic));
});

test('secure loader accepts one canonical local record and rejects unsafe locations and bytes', () => {
  mkdirSync(LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT, { recursive: true });
  const directory = mkdtempSync(
    join(LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT, 'balance-metadata-files-'),
  );
  const canonicalPath = join(directory, 'approved.balance-consumer-metadata-transition.local.json');
  const prettyPath = join(directory, 'pretty.balance-consumer-metadata-transition.local.json');
  const duplicatePath = join(
    directory,
    'duplicate.balance-consumer-metadata-transition.local.json',
  );
  const wrongSuffixPath = join(directory, 'wrong-suffix.json');
  const emptyPath = join(directory, 'empty.balance-consumer-metadata-transition.local.json');
  const oversizedPath = join(
    directory,
    'oversized.balance-consumer-metadata-transition.local.json',
  );
  const bomPath = join(directory, 'bom.balance-consumer-metadata-transition.local.json');
  const malformedUtf8Path = join(
    directory,
    'malformed-utf8.balance-consumer-metadata-transition.local.json',
  );
  const directoryPath = join(
    directory,
    'directory.balance-consumer-metadata-transition.local.json',
  );
  const outsideDirectory = mkdtempSync(join(tmpdir(), 'balance-metadata-outside-'));
  const outsidePath = join(
    outsideDirectory,
    'outside.balance-consumer-metadata-transition.local.json',
  );
  try {
    const record = signedRecord(baseContent()).record;
    const canonical = canonicalizeBalanceConsumerMetadataTransitionValue(record);
    writeFileSync(canonicalPath, canonical, 'utf8');
    assert.deepEqual(
      loadBalanceConsumerMetadataSecretVersionTransitionRecord(canonicalPath, 'create'),
      record,
    );

    writeFileSync(prettyPath, JSON.stringify(record, null, 2), 'utf8');
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(prettyPath, 'create'),
      new RegExp(
        BALANCE_CONSUMER_METADATA_TRANSITION_INPUT_ERROR.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
        'u',
      ),
    );
    writeFileSync(
      duplicatePath,
      `{"schemaVersion":1,"artifactType":"${'BALANCE_CONSUMER_METADATA_SECRET_VERSION_TRANSITION'}","artifactType":"DUPLICATE"}`,
      'utf8',
    );
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(duplicatePath, 'create'),
      /bounded, canonical, stable/u,
    );

    writeFileSync(outsidePath, canonical, 'utf8');
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(outsidePath, 'create'),
      /bounded, canonical, stable/u,
    );
    writeFileSync(wrongSuffixPath, canonical, 'utf8');
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(wrongSuffixPath, 'create'),
      /bounded, canonical, stable/u,
    );
    writeFileSync(emptyPath, '', 'utf8');
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(emptyPath, 'create'),
      /bounded, canonical, stable/u,
    );
    writeFileSync(
      oversizedPath,
      Buffer.alloc(MAX_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD_BYTES + 1, 0x61),
    );
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(oversizedPath, 'create'),
      /bounded, canonical, stable/u,
    );
    writeFileSync(bomPath, `\uFEFF${canonical}`, 'utf8');
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(bomPath, 'create'),
      /bounded, canonical, stable/u,
    );
    writeFileSync(malformedUtf8Path, Buffer.from([0xc3, 0x28]));
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(malformedUtf8Path, 'create'),
      /bounded, canonical, stable/u,
    );
    mkdirSync(directoryPath);
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(directoryPath, 'create'),
      /bounded, canonical, stable/u,
    );
    assert.throws(
      () =>
        loadBalanceConsumerMetadataSecretVersionTransitionRecord(
          join(
            LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT,
            '..',
            'traversal.balance-consumer-metadata-transition.local.json',
          ),
          'create',
        ),
      /bounded, canonical, stable/u,
    );
    assert.throws(
      () =>
        loadBalanceConsumerMetadataSecretVersionTransitionRecord(
          DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD,
          'create',
        ),
      /bounded, canonical, stable/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outsideDirectory, { recursive: true, force: true });
  }
});

test('secure loader rejects hard links, symlinks, and same-size read races', () => {
  mkdirSync(LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT, { recursive: true });
  const directory = mkdtempSync(
    join(LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT, 'balance-metadata-links-'),
  );
  const source = join(directory, 'source.balance-consumer-metadata-transition.local.json');
  const hardLink = join(directory, 'hard.balance-consumer-metadata-transition.local.json');
  const symbolicLink = join(directory, 'symbolic.balance-consumer-metadata-transition.local.json');
  try {
    const canonical = canonicalizeBalanceConsumerMetadataTransitionValue(
      signedRecord(baseContent()).record,
    );
    writeFileSync(source, canonical, 'utf8');
    linkSync(source, hardLink);
    assert.throws(
      () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(hardLink, 'create'),
      /bounded, canonical, stable/u,
    );
    rmSync(hardLink, { force: true });

    try {
      symlinkSync(source, symbolicLink, 'file');
      assert.throws(
        () => loadBalanceConsumerMetadataSecretVersionTransitionRecord(symbolicLink, 'create'),
        /bounded, canonical, stable/u,
      );
    } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code)) throw error;
    }

    assert.throws(
      () =>
        loadBalanceConsumerMetadataSecretVersionTransitionRecordForTest(source, 'create', () => {
          const changed = canonical.replace(FIRST_VERSION, SECOND_VERSION);
          assert.equal(Buffer.byteLength(changed), Buffer.byteLength(canonical));
          writeFileSync(source, changed, 'utf8');
        }),
      /bounded, canonical, stable/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('real CLI validates only the inert example and reports every zero-call counter', () => {
  const text = spawnSync(process.execPath, [validatorPath], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Ready for authorized plan: false/u);
  assert.match(text.stdout, /External calls made: 0/u);
  assert.match(text.stdout, /AWS calls made: 0/u);
  assert.match(text.stdout, /Database connections made: 0/u);
  assert.match(text.stdout, /Redis connections made: 0/u);
  assert.match(text.stdout, /Secret values read: 0/u);
  assert.match(text.stdout, /Resources created: 0/u);
  assert.match(text.stdout, /Files written: 0/u);

  const json = spawnSync(process.execPath, [validatorPath, '--json'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.readyForAuthorizedPlan, false);
  for (const key of [
    'externalCallsMade',
    'awsCallsMade',
    'databaseConnectionsMade',
    'redisConnectionsMade',
    'dnsQueriesMade',
    'httpRequestsMade',
    'secretValuesRead',
    'resourcesCreated',
    'credentialBytesRead',
    'filesWritten',
  ]) {
    assert.equal(report[key], 0);
  }
});

test('real operational CLI refuses the empty production registry and enforces predecessor binding', () => {
  mkdirSync(LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT, { recursive: true });
  const directory = mkdtempSync(
    join(LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT, 'balance-metadata-cli-'),
  );
  const createPath = join(directory, 'create.balance-consumer-metadata-transition.local.json');
  const transitionPath = join(
    directory,
    'transition.balance-consumer-metadata-transition.local.json',
  );
  try {
    writeFileSync(
      createPath,
      canonicalizeBalanceConsumerMetadataTransitionValue(signedRecord(baseContent()).record),
      'utf8',
    );
    const refused = spawnSync(process.execPath, operationalCliArguments(createPath), {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(refused.status, 1, refused.stderr);
    const refusedReport = JSON.parse(refused.stdout);
    assert.equal(refusedReport.ok, false);
    assert.equal(refusedReport.productionAuthorityValidated, false);
    assert.match(refusedReport.errors.join('\n'), /production authority registry/u);
    assert.equal(Object.hasOwn(refusedReport, 'canonicalSha256'), false);
    assert.equal(refusedReport.externalCallsMade, 0);
    assert.equal(refusedReport.filesWritten, 0);

    const transition = transitionContent();
    writeFileSync(
      transitionPath,
      canonicalizeBalanceConsumerMetadataTransitionValue(signedRecord(transition).record),
      'utf8',
    );
    const wrongPredecessorArguments = operationalCliArguments(transitionPath, 'transition');
    const predecessorIndex = wrongPredecessorArguments.indexOf(
      '--expected-predecessor-transition-sha256',
    );
    wrongPredecessorArguments[predecessorIndex + 1] = 'c'.repeat(64);
    const wrongPredecessor = spawnSync(process.execPath, wrongPredecessorArguments, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(wrongPredecessor.status, 1, wrongPredecessor.stderr);
    const wrongPredecessorReport = JSON.parse(wrongPredecessor.stdout);
    assert.match(wrongPredecessorReport.errors.join('\n'), /Predecessor transition/u);
    assert.equal(Object.hasOwn(wrongPredecessorReport, 'predecessorTransitionSha256'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI rejects checked-in operational input plus missing, duplicate, and unknown arguments', () => {
  const checkedIn = spawnSync(
    process.execPath,
    operationalCliArguments(DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD),
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(checkedIn.status, 2);
  assert.match(checkedIn.stderr, /bounded, canonical, stable/u);
  assert.doesNotMatch(
    checkedIn.stderr,
    /balance-consumer-metadata-secret-version-transition\.example/u,
  );

  const argumentSets = [
    ['--record'],
    ['--mode', 'example', '--mode', 'example'],
    ['--unknown', 'sensitive-value'],
    ['--registry', 'sensitive-path'],
    ['--private-key', 'sensitive-value'],
    ['--mode', 'create', '--record', 'sensitive-path'],
    ['--expected-account', ACCOUNT],
  ];
  for (const arguments_ of argumentSets) {
    const result = spawnSync(process.execPath, [validatorPath, ...arguments_], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      new RegExp(BALANCE_CONSUMER_METADATA_TRANSITION_ARGUMENT_ERROR.split(' ')[0], 'u'),
    );
    assert.doesNotMatch(result.stderr, /sensitive-value|sensitive-path/u);
    assert.match(result.stderr, /externalCallsMade: 0/u);
    assert.match(result.stderr, /secretValuesRead: 0/u);
    assert.match(result.stderr, /filesWritten: 0/u);
  }

  const missingPredecessorBinding = operationalCliArguments(
    DEFAULT_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD,
  );
  const predecessorIndex = missingPredecessorBinding.indexOf(
    '--expected-predecessor-transition-sha256',
  );
  missingPredecessorBinding.splice(predecessorIndex, 2);
  const missingPredecessor = spawnSync(process.execPath, missingPredecessorBinding, {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(missingPredecessor.status, 2);
  assert.match(missingPredecessor.stderr, /Usage:/u);
  assert.match(missingPredecessor.stderr, /externalCallsMade: 0/u);
});

test('validator source has no cloud, network, secret-value, signing, or write capability', () => {
  const source = readFileSync(validatorPath, 'utf8');
  for (const forbidden of [
    /node:child_process/u,
    /node:(?:http|https|net|tls|dns)/u,
    /@aws-sdk/u,
    /generateKeyPair|createPrivateKey|\bsign\s+as|\bsign\(/u,
    /writeFile|appendFile|createWriteStream|mkdir|rmSync|unlink/u,
    /GetSecretValue|BatchGetSecretValue/u,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
