import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_PRODUCTION_DEPLOYMENT_INTENT_EXAMPLE,
  MAX_PRODUCTION_DEPLOYMENT_INTENT_BYTES,
  PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY,
  PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS,
  PRODUCTION_DEPLOYMENT_INTENT_SCOPE,
  PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES,
  canonicalizeProductionDeploymentIntentValue,
  isProductionAuthorizedDeploymentIntentReport,
  loadAndVerifyProductionDeploymentIntent,
  productionDeploymentAuthorityStateSha256,
  productionDeploymentIntentContentSha256,
  productionDeploymentIntentSigningBytes,
  validateProductionDeploymentIntentExample,
  verifyProductionDeploymentIntent,
  verifyProductionDeploymentIntentAgainstProductionTargetWithTestRegistry,
  verifyProductionDeploymentIntentBytes,
  verifyProductionDeploymentIntentBytesWithTestRegistry,
  verifyProductionDeploymentIntentWithTestRegistry,
} from './validate-production-deployment-intent.mjs';

const VALIDATOR_PATH = resolve(import.meta.dirname, 'validate-production-deployment-intent.mjs');
const ISSUED_AT = '2026-09-07T12:00:00Z';
const SIGNED_AT = '2026-09-07T12:05:00Z';
const EVALUATED_AT = '2026-09-07T12:10:00Z';
const EXPIRES_AT = '2026-09-07T12:30:00Z';
const ZERO_SHA256 = '0'.repeat(64);
const SOURCE_REVISION = 'a'.repeat(40);
const RELEASE_MANIFEST_SHA256 = '1'.repeat(64);
const DEPLOYMENT_TARGET_SHA256 = '2'.repeat(64);
const PREDECESSOR_SHA256 = 'f'.repeat(64);

const INERT_AUTHORITY = Object.freeze({
  apiDesiredCount: 0,
  webDesiredCount: 0,
  outboxWorkerDesiredCount: 0,
  balanceConsumerDesiredCount: 0,
  migrationTaskEnabled: false,
  publicIngressEnabled: false,
  externalEgressMode: 'NO_EXTERNAL_EGRESS',
  allowedNetworkIds: Object.freeze([]),
  financialWritesEnabled: false,
});
const READ_ONLY_AUTHORITY = Object.freeze({
  apiDesiredCount: 2,
  webDesiredCount: 2,
  outboxWorkerDesiredCount: 1,
  balanceConsumerDesiredCount: 0,
  migrationTaskEnabled: false,
  publicIngressEnabled: true,
  externalEgressMode: 'ETHEREUM_SOLANA_READ_ONLY',
  allowedNetworkIds: Object.freeze(['eip155:1', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']),
  financialWritesEnabled: false,
});

const keyPairs = Object.fromEntries(
  PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.map((role) => [role, generateKeyPairSync('ed25519')]),
);
const keyIds = Object.freeze({
  DEPLOYMENT_OWNER: 'deployment-owner-2026',
  INDEPENDENT_SECURITY: 'independent-security-2026',
});
const TEST_REGISTRY = Object.freeze({
  schemaVersion: 1,
  artifactType: 'PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY',
  keys: Object.freeze(
    PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.map((role) =>
      Object.freeze({
        keyId: keyIds[role],
        role,
        scope: PRODUCTION_DEPLOYMENT_INTENT_SCOPE,
        algorithm: 'Ed25519',
        status: 'APPROVED',
        publicKeySpkiDerBase64: keyPairs[role].publicKey
          .export({ format: 'der', type: 'spki' })
          .toString('base64'),
        validFrom: '2026-09-01T00:00:00Z',
        validUntil: '2027-08-01T00:00:00Z',
        approvalReferenceId: `review/deployment-intent/${role.toLowerCase()}`,
      }),
    ),
  ),
});

function buildContent({
  operation = 'PROVISION_INERT',
  currentAuthority = operation === 'PROVISION_INERT' ? INERT_AUTHORITY : READ_ONLY_AUTHORITY,
  proposedAuthority = operation === 'ACTIVATE_READ_ONLY' ? READ_ONLY_AUTHORITY : INERT_AUTHORITY,
  predecessorIntentSha256 = operation === 'PROVISION_INERT' ? ZERO_SHA256 : PREDECESSOR_SHA256,
} = {}) {
  return {
    status: 'AUTHORIZED',
    intentId: `production/${operation.toLowerCase().replaceAll('_', '-')}/2026-09-07/intent-001`,
    operation,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    deployment: {
      accountId: '123456789012',
      region: 'us-east-1',
      stackName: 'crypto-lending-production',
      changeSetName: 'reviewed-production-intent-001',
    },
    sourceRevision: SOURCE_REVISION,
    releaseCandidateManifestSha256: RELEASE_MANIFEST_SHA256,
    deploymentTargetId: 'aws-production-us-east-1-crypto-lending',
    deploymentTargetSha256: DEPLOYMENT_TARGET_SHA256,
    bindings: {
      infrastructureContractSha256: '3'.repeat(64),
      infrastructureTemplateSha256: '4'.repeat(64),
      deploymentConfigurationSha256: '5'.repeat(64),
      billingControlSha256: '6'.repeat(64),
      egressPolicySha256: '7'.repeat(64),
      credentialStateSha256: '8'.repeat(64),
      currentStateSha256: productionDeploymentAuthorityStateSha256(currentAuthority),
      proposedStateSha256: productionDeploymentAuthorityStateSha256(proposedAuthority),
      rollbackPlanSha256: '9'.repeat(64),
      killStateSha256: productionDeploymentAuthorityStateSha256(INERT_AUTHORITY),
      predecessorIntentSha256,
    },
    currentAuthority,
    proposedAuthority,
  };
}

function buildRecord(configuration = {}) {
  const content = buildContent(configuration);
  const unsigned = {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT',
    intentSha256: productionDeploymentIntentContentSha256(content),
    content,
  };
  const signatures = PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.map((role) => {
    const signer = {
      role,
      scope: PRODUCTION_DEPLOYMENT_INTENT_SCOPE,
      authorityKeyId: keyIds[role],
      signedAt: SIGNED_AT,
    };
    return {
      ...signer,
      algorithm: 'Ed25519',
      valueBase64: sign(
        null,
        productionDeploymentIntentSigningBytes(unsigned, signer),
        keyPairs[role].privateKey,
      ).toString('base64'),
    };
  });
  return { ...unsigned, signatures };
}

function optionsFor(record, overrides = {}) {
  return {
    evaluatedAt: EVALUATED_AT,
    expectedOperation: record.content.operation,
    expectedIntentSha256: record.intentSha256,
    expectedPredecessorIntentSha256: record.content.bindings.predecessorIntentSha256,
    expectedSourceRevision: SOURCE_REVISION,
    expectedReleaseCandidateManifestSha256: RELEASE_MANIFEST_SHA256,
    expectedDeploymentTargetId: record.content.deploymentTargetId,
    expectedDeploymentTargetSha256: DEPLOYMENT_TARGET_SHA256,
    expectedInfrastructureContractSha256: record.content.bindings.infrastructureContractSha256,
    expectedInfrastructureTemplateSha256: record.content.bindings.infrastructureTemplateSha256,
    expectedDeploymentConfigurationSha256: record.content.bindings.deploymentConfigurationSha256,
    expectedBillingControlSha256: record.content.bindings.billingControlSha256,
    expectedEgressPolicySha256: record.content.bindings.egressPolicySha256,
    expectedCredentialStateSha256: record.content.bindings.credentialStateSha256,
    expectedCurrentStateSha256: record.content.bindings.currentStateSha256,
    expectedProposedStateSha256: record.content.bindings.proposedStateSha256,
    expectedRollbackPlanSha256: record.content.bindings.rollbackPlanSha256,
    expectedKillStateSha256: record.content.bindings.killStateSha256,
    expectedAccountId: record.content.deployment.accountId,
    expectedRegion: record.content.deployment.region,
    expectedStackName: record.content.deployment.stackName,
    expectedChangeSetName: record.content.deployment.changeSetName,
    ...overrides,
  };
}

function verifyWithTestRegistry(record, options = optionsFor(record), registry = TEST_REGISTRY) {
  return verifyProductionDeploymentIntentWithTestRegistry(record, options, registry);
}

test('accepts an exact two-role intent only through the injected unbranded test registry', () => {
  const record = buildRecord();
  const report = verifyWithTestRegistry(record);
  assert.equal(report.ok, true);
  assert.equal(report.signatureValidated, true);
  assert.equal(report.productionAuthorityValidated, false);
  assert.equal(report.readyForAuthorizedPlan, false);
  assert.equal(report.executionAllowed, false);
  assert.equal(report.operation, 'PROVISION_INERT');
  assert.equal(report.intentSha256, record.intentSha256);
  assert.equal(isProductionAuthorizedDeploymentIntentReport(report), false);
  assert.equal(Object.isFrozen(report), true);

  const canonicalBytes = Buffer.from(canonicalizeProductionDeploymentIntentValue(record), 'utf8');
  assert.equal(
    verifyProductionDeploymentIntentBytesWithTestRegistry(
      canonicalBytes,
      optionsFor(record),
      TEST_REGISTRY,
    ).ok,
    true,
  );
});

test('supports only the five reviewed operations and never proposes financial writes', () => {
  assert.deepEqual(PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS, [
    'PROVISION_INERT',
    'ACTIVATE_READ_ONLY',
    'ROLLBACK',
    'EMERGENCY_KILL',
    'DELETE',
  ]);
  for (const operation of PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS) {
    const record = buildRecord({ operation });
    const report = verifyWithTestRegistry(record);
    assert.equal(report.ok, true, operation);
    assert.equal(report.executionAllowed, false, operation);
    assert.equal(record.content.proposedAuthority.financialWritesEnabled, false, operation);
  }

  const unknown = structuredClone(buildRecord());
  unknown.content.operation = 'ACTIVATE_WRITE';
  assert.equal(verifyWithTestRegistry(unknown).ok, false);
});

test('the empty production registry cannot authorize any otherwise valid intent', () => {
  const record = buildRecord();
  assert.deepEqual(PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY.keys, []);
  const direct = verifyProductionDeploymentIntent(record, optionsFor(record));
  assert.equal(direct.ok, false);
  assert.equal(direct.executionAllowed, false);
  assert.equal(isProductionAuthorizedDeploymentIntentReport(direct), false);
  assert.equal(
    verifyProductionDeploymentIntentWithTestRegistry(
      record,
      optionsFor(record),
      PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY,
    ).ok,
    false,
  );
  const keysPresentButTargetEmpty =
    verifyProductionDeploymentIntentAgainstProductionTargetWithTestRegistry(
      record,
      optionsFor(record),
      TEST_REGISTRY,
    );
  assert.equal(keysPresentButTargetEmpty.ok, false);
  assert.equal(isProductionAuthorizedDeploymentIntentReport(keysPresentButTargetEmpty), false);

  const bytes = Buffer.from(canonicalizeProductionDeploymentIntentValue(record), 'utf8');
  assert.equal(verifyProductionDeploymentIntentBytes(bytes, optionsFor(record)).ok, false);
  assert.equal(
    loadAndVerifyProductionDeploymentIntent(
      resolve('.local-validation/absent.production-deployment-intent.local.json'),
      optionsFor(record),
    ).ok,
    false,
  );
});

test('rejects expired, future, stale-head replayed, and wrongly bound intents', () => {
  const record = buildRecord();
  const invalidOptions = [
    optionsFor(record, { evaluatedAt: EXPIRES_AT }),
    optionsFor(record, { evaluatedAt: '2026-09-07T11:59:59Z' }),
    optionsFor(record, { expectedIntentSha256: 'e'.repeat(64) }),
    optionsFor(record, { expectedPredecessorIntentSha256: record.intentSha256 }),
    optionsFor(record, { expectedOperation: 'DELETE' }),
    optionsFor(record, { expectedSourceRevision: 'b'.repeat(40) }),
    optionsFor(record, { expectedReleaseCandidateManifestSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedDeploymentTargetId: 'different-production-target' }),
    optionsFor(record, { expectedDeploymentTargetSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedInfrastructureContractSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedInfrastructureTemplateSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedDeploymentConfigurationSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedBillingControlSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedEgressPolicySha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedCredentialStateSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedCurrentStateSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedProposedStateSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedRollbackPlanSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedKillStateSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedAccountId: '210987654321' }),
    optionsFor(record, { expectedRegion: 'us-west-2' }),
    optionsFor(record, { expectedStackName: 'different-production-stack' }),
    optionsFor(record, { expectedChangeSetName: 'different-change-set' }),
  ];
  for (const options of invalidOptions) {
    assert.equal(verifyWithTestRegistry(record, options).ok, false);
  }
});

test('rejects wrong roles, keys, signatures, content digests, and target bindings', () => {
  const record = buildRecord();
  const mutations = [];

  const reversed = structuredClone(record);
  reversed.signatures.reverse();
  mutations.push(reversed);

  const wrongRole = structuredClone(record);
  wrongRole.signatures[0].role = 'INDEPENDENT_SECURITY';
  mutations.push(wrongRole);

  const wrongSignature = structuredClone(record);
  wrongSignature.signatures[0].valueBase64 = Buffer.alloc(64).toString('base64');
  mutations.push(wrongSignature);

  const oversizedSignerKeyId = structuredClone(record);
  oversizedSignerKeyId.signatures[0].authorityKeyId = 'a'.repeat(129);
  mutations.push(oversizedSignerKeyId);

  const wrongIntentDigest = structuredClone(record);
  wrongIntentDigest.intentSha256 = 'd'.repeat(64);
  mutations.push(wrongIntentDigest);

  const driftedBinding = structuredClone(record);
  driftedBinding.content.bindings.egressPolicySha256 = 'c'.repeat(64);
  mutations.push(driftedBinding);

  const driftedTarget = structuredClone(record);
  driftedTarget.content.deploymentTargetSha256 = 'b'.repeat(64);
  mutations.push(driftedTarget);

  for (const candidate of mutations) {
    assert.equal(verifyWithTestRegistry(candidate).ok, false);
  }

  const duplicatedKey = structuredClone(TEST_REGISTRY);
  duplicatedKey.keys[1].publicKeySpkiDerBase64 = duplicatedKey.keys[0].publicKeySpkiDerBase64;
  assert.equal(verifyWithTestRegistry(record, optionsFor(record), duplicatedKey).ok, false);

  const wrongRegistryRole = structuredClone(TEST_REGISTRY);
  wrongRegistryRole.keys[0].role = 'INDEPENDENT_SECURITY';
  assert.equal(verifyWithTestRegistry(record, optionsFor(record), wrongRegistryRole).ok, false);

  const oversizedRegistryKeyId = structuredClone(TEST_REGISTRY);
  oversizedRegistryKeyId.keys[0].keyId = 'a'.repeat(129);
  assert.equal(
    verifyWithTestRegistry(record, optionsFor(record), oversizedRegistryKeyId).ok,
    false,
  );
});

test('emergency kill, rollback, delete, and read-only activation cannot increase forbidden authority', () => {
  const unsafeCases = [
    {
      operation: 'EMERGENCY_KILL',
      currentAuthority: READ_ONLY_AUTHORITY,
      proposedAuthority: READ_ONLY_AUTHORITY,
      predecessorIntentSha256: PREDECESSOR_SHA256,
    },
    {
      operation: 'ROLLBACK',
      currentAuthority: INERT_AUTHORITY,
      proposedAuthority: READ_ONLY_AUTHORITY,
      predecessorIntentSha256: PREDECESSOR_SHA256,
    },
    {
      operation: 'DELETE',
      currentAuthority: READ_ONLY_AUTHORITY,
      proposedAuthority: { ...INERT_AUTHORITY, apiDesiredCount: 1 },
      predecessorIntentSha256: PREDECESSOR_SHA256,
    },
    {
      operation: 'ACTIVATE_READ_ONLY',
      currentAuthority: INERT_AUTHORITY,
      proposedAuthority: { ...READ_ONLY_AUTHORITY, financialWritesEnabled: true },
      predecessorIntentSha256: PREDECESSOR_SHA256,
    },
  ];
  for (const candidate of unsafeCases) {
    assert.throws(() => productionDeploymentIntentContentSha256(buildContent(candidate)));
  }

  const kill = buildRecord({ operation: 'EMERGENCY_KILL' });
  assert.equal(verifyWithTestRegistry(kill).ok, true);
  assert.equal(kill.content.proposedAuthority.apiDesiredCount, 0);
  assert.equal(kill.content.proposedAuthority.externalEgressMode, 'NO_EXTERNAL_EGRESS');
  assert.deepEqual(kill.content.proposedAuthority.allowedNetworkIds, []);
});

test('rejects hostile object shapes and ambiguous, noncanonical, or oversized JSON bytes', () => {
  const record = buildRecord();
  const verificationOptions = optionsFor(record);
  const withExtraKey = { ...record, unexpected: true };
  const accessor = { ...record };
  Object.defineProperty(accessor, 'content', {
    enumerable: true,
    get() {
      throw new Error('untrusted getter');
    },
  });
  const proxy = new Proxy(record, {
    ownKeys() {
      throw new Error('untrusted proxy');
    },
  });
  for (const hostile of [null, {}, withExtraKey, accessor, proxy]) {
    assert.doesNotThrow(() => verifyWithTestRegistry(hostile, verificationOptions));
    assert.equal(verifyWithTestRegistry(hostile, verificationOptions).ok, false);
  }

  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalizeProductionDeploymentIntentValue(cycle));

  const canonical = canonicalizeProductionDeploymentIntentValue(record);
  const ambiguousBytes = [
    Buffer.from(JSON.stringify(record, null, 2), 'utf8'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical, 'utf8')]),
    Buffer.from(canonical.replace('{', '{"schemaVersion":1,'), 'utf8'),
    Buffer.concat([Buffer.from(canonical, 'utf8'), Buffer.from([0])]),
    Buffer.alloc(MAX_PRODUCTION_DEPLOYMENT_INTENT_BYTES + 1, 0x20),
  ];
  for (const bytes of ambiguousBytes) {
    assert.equal(
      verifyProductionDeploymentIntentBytesWithTestRegistry(
        bytes,
        optionsFor(record),
        TEST_REGISTRY,
      ).ok,
      false,
    );
  }
});

test('checked-in example is exact, inert, unsigned, and CLI validation is local-only', () => {
  const example = JSON.parse(readFileSync(DEFAULT_PRODUCTION_DEPLOYMENT_INTENT_EXAMPLE, 'utf8'));
  const report = validateProductionDeploymentIntentExample(example);
  assert.equal(report.ok, true);
  assert.equal(report.executionAllowed, false);
  assert.equal(report.signatureValidated, false);
  assert.equal(report.resourcesChanged, 0);
  assert.deepEqual(example.signatures, []);

  const activated = structuredClone(example);
  activated.content.proposedAuthority.apiDesiredCount = 1;
  assert.equal(validateProductionDeploymentIntentExample(activated).ok, false);

  const cli = spawnSync(process.execPath, [VALIDATOR_PATH], {
    cwd: resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Execution allowed: false/u);
  assert.match(cli.stdout, /External calls made: 0/u);
});
