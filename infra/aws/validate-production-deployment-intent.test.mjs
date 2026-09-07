import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPublicKey, generateKeyPairSync, sign, verify as verifySignature } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_PRODUCTION_DEPLOYMENT_INTENT_EXAMPLE,
  MAX_PRODUCTION_DEPLOYMENT_INTENT_BYTES,
  PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY,
  PRODUCTION_DEPLOYMENT_LIFECYCLE_STATES,
  PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS,
  PRODUCTION_DEPLOYMENT_INTENT_SCOPE,
  PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES,
  canonicalizeProductionDeploymentIntentValue,
  isProductionAuthorizedDeploymentIntentReport,
  isUnbrandedDeploymentIntentReportFreshAtForTest,
  loadAndVerifyProductionDeploymentIntent,
  productionDeploymentChainGenesisSha256,
  productionDeploymentIntentContentSha256,
  productionDeploymentIntentSigningBytes,
  productionDeploymentStateSha256,
  revalidateProductionDeploymentIntentReportForApplication,
  revalidateUnbrandedDeploymentIntentReportAtForTest,
  validateProductionDeploymentIntentExample,
  verifyProductionDeploymentIntent,
  verifyProductionDeploymentIntentAuthorizationLifecycleForTest,
  verifyProductionDeploymentIntentAtTrustedClockWithTestRegistry,
  verifyProductionDeploymentIntentAgainstProductionDestinationWithTestRegistry,
  verifyProductionDeploymentIntentBytes,
  verifyProductionDeploymentIntentBytesWithTestRegistry,
  verifyProductionDeploymentIntentWithTestRegistry,
} from './validate-production-deployment-intent.mjs';
import {
  isVerifiedProductionDeploymentDestination,
  productionDeploymentDestinationSha256,
  resolveProductionDeploymentDestinationWithTestRegistry,
} from '../../scripts/production-deployment-target.mjs';

const VALIDATOR_PATH = resolve(import.meta.dirname, 'validate-production-deployment-intent.mjs');
const ISSUED_AT = '2026-09-07T12:00:00Z';
const SIGNED_AT = '2026-09-07T12:05:00Z';
const EVALUATED_AT = '2026-09-07T12:10:00Z';
const EXPIRES_AT = '2026-09-07T12:30:00Z';
const ZERO_SHA256 = '0'.repeat(64);
const SOURCE_REVISION = 'a'.repeat(40);
const RELEASE_MANIFEST_SHA256 = '1'.repeat(64);
const PREDECESSOR_SHA256 = 'f'.repeat(64);
const PREDECESSOR_RESERVATION_SHA256 = 'e'.repeat(64);
const PREDECESSOR_RESULT_SHA256 = 'd'.repeat(64);
const PREDECESSOR_HEAD_SHA256 = 'c'.repeat(64);
const TEST_DESTINATION = Object.freeze({
  destinationId: 'production-provisioning-us-east-1',
  epochId: '3'.repeat(64),
  environment: 'production',
  awsAccountId: '123456789012',
  awsRegion: 'us-east-1',
  stackName: 'crypto-lending-production',
  publicOrigin: 'https://app.example.com',
});
const TEST_DESTINATION_SHA256 = productionDeploymentDestinationSha256(TEST_DESTINATION);
const TEST_DESTINATION_REGISTRY = Object.freeze({
  schemaVersion: 1,
  artifactType: 'PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY',
  destinations: Object.freeze([TEST_DESTINATION]),
});
const RESOLVED_TEST_DESTINATION = resolveProductionDeploymentDestinationWithTestRegistry(
  TEST_DESTINATION.destinationId,
  TEST_DESTINATION_SHA256,
  TEST_DESTINATION_REGISTRY,
);
const DESTINATION_BINDING = Object.freeze({
  destinationId: RESOLVED_TEST_DESTINATION.destinationId,
  destinationSha256: RESOLVED_TEST_DESTINATION.destinationSha256,
  epochId: RESOLVED_TEST_DESTINATION.epochId,
  destinationRegistrySha256: RESOLVED_TEST_DESTINATION.registrySha256,
  environment: RESOLVED_TEST_DESTINATION.environment,
  accountId: RESOLVED_TEST_DESTINATION.awsAccountId,
  region: RESOLVED_TEST_DESTINATION.awsRegion,
  stackName: RESOLVED_TEST_DESTINATION.stackName,
  publicOrigin: RESOLVED_TEST_DESTINATION.publicOrigin,
});

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

function state(lifecycle, authority = INERT_AUTHORITY) {
  return Object.freeze({ lifecycle, authority });
}

const DEFAULT_TRANSITIONS = Object.freeze({
  PROVISION_INERT: Object.freeze([state('ABSENT'), state('INERT_DEPLOYED')]),
  ABORT_PROVISION: Object.freeze([state('ABSENT'), state('PROVISION_ABORTED')]),
  ACTIVATE_READ_ONLY: Object.freeze([
    state('INERT_DEPLOYED'),
    state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
  ]),
  UPDATE_READ_ONLY: Object.freeze([
    state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
    state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
  ]),
  ROLLBACK: Object.freeze([
    state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
    state('INERT_DEPLOYED'),
  ]),
  EMERGENCY_KILL: Object.freeze([
    state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
    state('KILLED_INERT'),
  ]),
  DELETE: Object.freeze([state('INERT_DEPLOYED'), state('DELETED')]),
});

const keyPairs = Object.fromEntries(
  PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.map((role) => [role, generateKeyPairSync('ed25519')]),
);
const keyIds = Object.freeze({
  DEPLOYMENT_OWNER: 'deployment-owner-2026',
  INDEPENDENT_SECURITY: 'independent-security-2026',
});
function testRegistry({
  validFrom = '2026-09-01T00:00:00Z',
  validUntil = '2027-08-01T00:00:00Z',
} = {}) {
  return Object.freeze({
    schemaVersion: 2,
    artifactType: 'PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY_V2',
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
          validFrom,
          validUntil,
          approvalReferenceId: `review/deployment-intent/${role.toLowerCase()}`,
        }),
      ),
    ),
  });
}

const TEST_REGISTRY = testRegistry();

function buildContent({
  operation = 'PROVISION_INERT',
  intentId = `production/${operation.toLowerCase().replaceAll('_', '-')}/2026-09-07/intent-001`,
  destinationBinding = DESTINATION_BINDING,
  currentState = DEFAULT_TRANSITIONS[operation]?.[0],
  proposedState = DEFAULT_TRANSITIONS[operation]?.[1],
  sequence = operation === 'PROVISION_INERT' || operation === 'ABORT_PROVISION' ? 1 : 2,
  predecessor = {
    sequence: sequence - 1,
    committedHeadSha256:
      sequence === 1
        ? productionDeploymentChainGenesisSha256(destinationBinding)
        : PREDECESSOR_HEAD_SHA256,
    intentSha256: sequence === 1 ? ZERO_SHA256 : PREDECESSOR_SHA256,
    reservationSha256: sequence === 1 ? ZERO_SHA256 : PREDECESSOR_RESERVATION_SHA256,
    resultSha256: sequence === 1 ? ZERO_SHA256 : PREDECESSOR_RESULT_SHA256,
    stateSha256: productionDeploymentStateSha256(currentState),
  },
  abortedProvisionIntentSha256 = operation === 'ABORT_PROVISION' ? 'a'.repeat(64) : ZERO_SHA256,
  abortedProvisionReservationSha256 = operation === 'ABORT_PROVISION'
    ? 'b'.repeat(64)
    : ZERO_SHA256,
  deploymentConfigurationSha256 = '5'.repeat(64),
  changeSetName = 'reviewed-production-intent-001',
  issuedAt = ISSUED_AT,
  expiresAt = EXPIRES_AT,
} = {}) {
  return {
    status: 'AUTHORIZED',
    intentId,
    operation,
    sequence,
    issuedAt,
    expiresAt,
    destinationBinding,
    deployment: {
      accountId: destinationBinding.accountId,
      region: destinationBinding.region,
      stackName: destinationBinding.stackName,
      changeSetName,
    },
    sourceRevision: SOURCE_REVISION,
    releaseCandidateManifestSha256: RELEASE_MANIFEST_SHA256,
    bindings: {
      infrastructureContractSha256: '5'.repeat(64),
      infrastructureTemplateSha256: '6'.repeat(64),
      deploymentConfigurationSha256,
      billingControlSha256: '6'.repeat(64),
      egressPolicySha256: '7'.repeat(64),
      credentialStateSha256: '8'.repeat(64),
      currentStateSha256: productionDeploymentStateSha256(currentState),
      proposedStateSha256: productionDeploymentStateSha256(proposedState),
      rollbackPlanSha256: '9'.repeat(64),
      killStateSha256: productionDeploymentStateSha256(state('KILLED_INERT')),
      abortedProvisionIntentSha256,
      abortedProvisionReservationSha256,
    },
    predecessor,
    currentState,
    proposedState,
  };
}

function buildRecord({ signedAt = SIGNED_AT, ...configuration } = {}) {
  const content = buildContent(configuration);
  const unsigned = {
    schemaVersion: 2,
    artifactType: 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT_V2',
    intentSha256: productionDeploymentIntentContentSha256(content),
    content,
  };
  const signatures = PRODUCTION_DEPLOYMENT_INTENT_SIGNER_ROLES.map((role) => {
    const signer = {
      role,
      scope: PRODUCTION_DEPLOYMENT_INTENT_SCOPE,
      authorityKeyId: keyIds[role],
      signedAt,
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
    expectedSequence: record.content.sequence,
    expectedIntentSha256: record.intentSha256,
    expectedDestinationId: record.content.destinationBinding.destinationId,
    expectedDestinationSha256: record.content.destinationBinding.destinationSha256,
    expectedDestinationEpochId: record.content.destinationBinding.epochId,
    expectedDestinationRegistrySha256: record.content.destinationBinding.destinationRegistrySha256,
    expectedPublicOrigin: record.content.destinationBinding.publicOrigin,
    expectedPredecessorSequence: record.content.predecessor.sequence,
    expectedPredecessorCommittedHeadSha256: record.content.predecessor.committedHeadSha256,
    expectedPredecessorIntentSha256: record.content.predecessor.intentSha256,
    expectedPredecessorReservationSha256: record.content.predecessor.reservationSha256,
    expectedPredecessorResultSha256: record.content.predecessor.resultSha256,
    expectedAbortedProvisionIntentSha256: record.content.bindings.abortedProvisionIntentSha256,
    expectedAbortedProvisionReservationSha256:
      record.content.bindings.abortedProvisionReservationSha256,
    expectedSourceRevision: SOURCE_REVISION,
    expectedReleaseCandidateManifestSha256: RELEASE_MANIFEST_SHA256,
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

function productionOptionsFor(record, overrides = {}) {
  return Object.fromEntries(
    Object.entries(optionsFor(record, overrides)).filter(([key]) => key !== 'evaluatedAt'),
  );
}

function canonicalInstantAt(milliseconds) {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000).toISOString().replace('.000Z', 'Z');
}

function clockReading(wallTime, monotonicMilliseconds) {
  return { wallTime, monotonicMilliseconds };
}

function verifyWithTestRegistry(
  record,
  options = optionsFor(record),
  registry = TEST_REGISTRY,
  destinationRegistry = TEST_DESTINATION_REGISTRY,
) {
  return verifyProductionDeploymentIntentWithTestRegistry(
    record,
    options,
    registry,
    destinationRegistry,
  );
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
  assert.equal(report.sequence, 1);
  assert.equal(report.intentSha256, record.intentSha256);
  assert.equal(report.destinationResolved, true);
  assert.deepEqual(report.destination, RESOLVED_TEST_DESTINATION);
  assert.equal(isVerifiedProductionDeploymentDestination(report.destination), false);
  assert.equal(report.abortedProvisionAttempt, null);
  assert.equal(report.plan.abortedProvisionAttempt, null);
  assert.equal(report.callerExpectedPredecessorMatched, true);
  assert.equal(report.durableCasRequired, true);
  assert.equal(report.durableCasAccepted, false);
  assert.equal(report.reservationCommitted, false);
  assert.equal(
    report.plan.kind,
    'LOCAL_ONLY_NON_EXECUTABLE_PRODUCTION_DEPLOYMENT_RESERVATION_REQUEST',
  );
  assert.equal(isProductionAuthorizedDeploymentIntentReport(report), false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.destination), true);
  assert.equal(Object.isFrozen(report.plan), true);

  const canonicalBytes = Buffer.from(canonicalizeProductionDeploymentIntentValue(record), 'utf8');
  assert.equal(
    verifyProductionDeploymentIntentBytesWithTestRegistry(
      canonicalBytes,
      optionsFor(record),
      TEST_REGISTRY,
      TEST_DESTINATION_REGISTRY,
    ).ok,
    true,
  );
});

test('supports only the seven reviewed operations and never proposes financial writes', () => {
  assert.deepEqual(PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS, [
    'PROVISION_INERT',
    'ABORT_PROVISION',
    'ACTIVATE_READ_ONLY',
    'UPDATE_READ_ONLY',
    'ROLLBACK',
    'EMERGENCY_KILL',
    'DELETE',
  ]);
  assert.deepEqual(PRODUCTION_DEPLOYMENT_LIFECYCLE_STATES, [
    'ABSENT',
    'INERT_DEPLOYED',
    'READ_ONLY_ACTIVE',
    'KILLED_INERT',
    'DELETED',
    'PROVISION_ABORTED',
  ]);
  for (const operation of PRODUCTION_DEPLOYMENT_INTENT_OPERATIONS) {
    const record = buildRecord({ operation });
    const report = verifyWithTestRegistry(record);
    assert.equal(report.ok, true, operation);
    assert.equal(report.executionAllowed, false, operation);
    assert.equal(record.content.proposedState.authority.financialWritesEnabled, false, operation);
    assert.equal(report.durableCasAccepted, false, operation);
    if (operation === 'ABORT_PROVISION') {
      assert.deepEqual(report.abortedProvisionAttempt, {
        intentSha256: record.content.bindings.abortedProvisionIntentSha256,
        reservationSha256: record.content.bindings.abortedProvisionReservationSha256,
      });
      assert.equal(report.plan.abortedProvisionAttempt, report.abortedProvisionAttempt);
      assert.equal(Object.isFrozen(report.abortedProvisionAttempt), true);
    } else {
      assert.equal(report.abortedProvisionAttempt, null, operation);
      assert.equal(report.plan.abortedProvisionAttempt, null, operation);
    }
  }

  const unknown = structuredClone(buildRecord());
  unknown.content.operation = 'ACTIVATE_WRITE';
  assert.equal(verifyWithTestRegistry(unknown).ok, false);
});

test('hard-rejects the complete version-one intent, scope, registry, and signing protocol', () => {
  assert.equal(PRODUCTION_DEPLOYMENT_INTENT_SCOPE.endsWith('_V2'), true);
  assert.equal(PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY.schemaVersion, 2);
  assert.equal(
    PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY.artifactType,
    'PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY_V2',
  );

  const record = buildRecord();
  const versionOneRoot = structuredClone(record);
  versionOneRoot.schemaVersion = 1;
  versionOneRoot.artifactType = 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT';
  assert.equal(verifyWithTestRegistry(versionOneRoot).ok, false);

  const versionOneRegistry = structuredClone(TEST_REGISTRY);
  versionOneRegistry.schemaVersion = 1;
  versionOneRegistry.artifactType = 'PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY';
  assert.equal(verifyWithTestRegistry(record, optionsFor(record), versionOneRegistry).ok, false);

  const versionOneScope = structuredClone(TEST_REGISTRY);
  versionOneScope.keys[0].scope = 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_INTENT';
  assert.equal(verifyWithTestRegistry(record, optionsFor(record), versionOneScope).ok, false);
});

test('two intents may assert one head but neither acquires a durable reservation or CAS brand', () => {
  const first = buildRecord({
    operation: 'UPDATE_READ_ONLY',
    intentId: 'production/update-read-only/2026-09-07/intent-first',
    changeSetName: 'reviewed-update-first',
    deploymentConfigurationSha256: 'a'.repeat(64),
  });
  const second = buildRecord({
    operation: 'UPDATE_READ_ONLY',
    intentId: 'production/update-read-only/2026-09-07/intent-second',
    changeSetName: 'reviewed-update-second',
    deploymentConfigurationSha256: 'b'.repeat(64),
  });
  assert.equal(first.content.predecessor.committedHeadSha256, PREDECESSOR_HEAD_SHA256);
  assert.equal(second.content.predecessor.committedHeadSha256, PREDECESSOR_HEAD_SHA256);
  assert.notEqual(first.intentSha256, second.intentSha256);
  for (const candidate of [first, second]) {
    const report = verifyWithTestRegistry(candidate);
    assert.equal(report.ok, true);
    assert.equal(report.callerExpectedPredecessorMatched, true);
    assert.equal(report.durableCasAccepted, false);
    assert.equal(report.reservationCommitted, false);
    assert.equal(report.executionAllowed, false);
  }
});

test('binds genesis to stable destination-epoch identity and rejects sequence gaps and overflow', () => {
  const replacementDestination = {
    ...DESTINATION_BINDING,
    epochId: 'a'.repeat(64),
  };
  assert.notEqual(
    productionDeploymentChainGenesisSha256(DESTINATION_BINDING),
    productionDeploymentChainGenesisSha256(replacementDestination),
  );
  assert.equal(
    productionDeploymentChainGenesisSha256(DESTINATION_BINDING),
    productionDeploymentChainGenesisSha256({
      ...DESTINATION_BINDING,
      destinationRegistrySha256: 'b'.repeat(64),
    }),
  );
  for (const [field, value] of [
    ['destinationId', 'replacement-production-destination'],
    ['destinationSha256', 'c'.repeat(64)],
    ['accountId', '210987654321'],
    ['region', 'us-west-2'],
    ['stackName', 'replacement-production-stack'],
    ['publicOrigin', 'https://replacement.example.com'],
  ]) {
    assert.notEqual(
      productionDeploymentChainGenesisSha256(DESTINATION_BINDING),
      productionDeploymentChainGenesisSha256({ ...DESTINATION_BINDING, [field]: value }),
      field,
    );
  }
  assert.throws(() =>
    productionDeploymentIntentContentSha256(
      buildContent({
        destinationBinding: replacementDestination,
        predecessor: buildContent().predecessor,
      }),
    ),
  );
  assert.throws(() =>
    productionDeploymentIntentContentSha256(
      buildContent({
        operation: 'ACTIVATE_READ_ONLY',
        sequence: 3,
        predecessor: {
          ...buildContent({ operation: 'ACTIVATE_READ_ONLY' }).predecessor,
          sequence: 1,
        },
      }),
    ),
  );
  assert.throws(() =>
    productionDeploymentIntentContentSha256(
      buildContent({ operation: 'ACTIVATE_READ_ONLY', sequence: Number.MAX_SAFE_INTEGER + 1 }),
    ),
  );
});

test('abort binds an exact provision attempt and terminal states have no outgoing edge', () => {
  const abort = buildRecord({ operation: 'ABORT_PROVISION' });
  const abortReport = verifyWithTestRegistry(abort);
  assert.equal(abortReport.ok, true);
  assert.deepEqual(abortReport.abortedProvisionAttempt, {
    intentSha256: abort.content.bindings.abortedProvisionIntentSha256,
    reservationSha256: abort.content.bindings.abortedProvisionReservationSha256,
  });
  assert.equal(abortReport.plan.abortedProvisionAttempt, abortReport.abortedProvisionAttempt);
  for (const field of ['abortedProvisionIntentSha256', 'abortedProvisionReservationSha256']) {
    const missing = structuredClone(abort.content);
    missing.bindings[field] = ZERO_SHA256;
    assert.throws(() => productionDeploymentIntentContentSha256(missing), undefined, field);
  }
  const unrelated = buildContent();
  unrelated.bindings.abortedProvisionIntentSha256 = 'a'.repeat(64);
  assert.throws(() => productionDeploymentIntentContentSha256(unrelated));

  for (const terminalLifecycle of ['DELETED', 'PROVISION_ABORTED']) {
    assert.throws(() =>
      productionDeploymentIntentContentSha256(
        buildContent({
          operation: 'ACTIVATE_READ_ONLY',
          currentState: state(terminalLifecycle),
        }),
      ),
    );
  }
});

test('destination physical coordinates must exactly match the deployment request', () => {
  for (const [field, value] of [
    ['accountId', '210987654321'],
    ['region', 'us-west-2'],
    ['stackName', 'different-production-stack'],
  ]) {
    const content = buildContent();
    content.deployment[field] = value;
    assert.throws(() => productionDeploymentIntentContentSha256(content), undefined, field);
  }
});

test('successful reports require the exact resolved destination and registry, not caller pins', () => {
  const mismatchedBindings = [
    { destinationId: 'production-provisioning-us-west-2' },
    { destinationSha256: 'a'.repeat(64) },
    { destinationRegistrySha256: 'b'.repeat(64) },
    { epochId: 'c'.repeat(64) },
    { accountId: '210987654321' },
    { region: 'us-west-2' },
    { stackName: 'different-production-stack' },
    { publicOrigin: 'https://other.example.com' },
  ];
  for (const override of mismatchedBindings) {
    const record = buildRecord({
      destinationBinding: { ...DESTINATION_BINDING, ...override },
    });
    assert.equal(verifyWithTestRegistry(record).ok, false, Object.keys(override)[0]);
  }

  const record = buildRecord();
  assert.equal(
    verifyProductionDeploymentIntentWithTestRegistry(record, optionsFor(record), TEST_REGISTRY).ok,
    false,
  );
  assert.equal(
    verifyWithTestRegistry(record, optionsFor(record), TEST_REGISTRY, {
      ...TEST_DESTINATION_REGISTRY,
      destinations: [],
    }).ok,
    false,
  );
});

test('the empty production registry cannot authorize any otherwise valid intent', () => {
  const record = buildRecord();
  assert.deepEqual(PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY.keys, []);
  const direct = verifyProductionDeploymentIntent(record, productionOptionsFor(record));
  assert.equal(direct.ok, false);
  assert.equal(direct.executionAllowed, false);
  assert.equal(isProductionAuthorizedDeploymentIntentReport(direct), false);
  assert.equal(
    verifyProductionDeploymentIntentWithTestRegistry(
      record,
      optionsFor(record),
      PRODUCTION_DEPLOYMENT_INTENT_AUTHORITY_KEY_REGISTRY,
      TEST_DESTINATION_REGISTRY,
    ).ok,
    false,
  );
  const keysPresentButTargetEmpty =
    verifyProductionDeploymentIntentAgainstProductionDestinationWithTestRegistry(
      record,
      optionsFor(record),
      TEST_REGISTRY,
    );
  assert.equal(keysPresentButTargetEmpty.ok, false);
  assert.equal(isProductionAuthorizedDeploymentIntentReport(keysPresentButTargetEmpty), false);

  const bytes = Buffer.from(canonicalizeProductionDeploymentIntentValue(record), 'utf8');
  assert.equal(
    verifyProductionDeploymentIntentBytes(bytes, productionOptionsFor(record)).ok,
    false,
  );
  assert.equal(
    loadAndVerifyProductionDeploymentIntent(
      resolve('.local-validation/absent.production-deployment-intent.local.json'),
      productionOptionsFor(record),
    ).ok,
    false,
  );
});

test('production-style verification captures current time and rejects injected or stale time', () => {
  const now = Date.now();
  const registry = testRegistry({
    validFrom: canonicalInstantAt(now - 24 * 60 * 60 * 1_000),
    validUntil: canonicalInstantAt(now + 300 * 24 * 60 * 60 * 1_000),
  });
  const active = buildRecord({
    issuedAt: canonicalInstantAt(now - 5 * 60_000),
    signedAt: canonicalInstantAt(now - 4 * 60_000),
    expiresAt: canonicalInstantAt(now + 30 * 60_000),
  });
  const activeOptions = productionOptionsFor(active);
  const activeReport = verifyProductionDeploymentIntentAtTrustedClockWithTestRegistry(
    active,
    activeOptions,
    registry,
    TEST_DESTINATION_REGISTRY,
  );
  assert.equal(activeReport.ok, true);
  assert.equal(activeReport.productionAuthorityValidated, false);
  assert.equal(isProductionAuthorizedDeploymentIntentReport(activeReport), false);
  assert.equal(
    verifyProductionDeploymentIntentAtTrustedClockWithTestRegistry(
      active,
      { evaluatedAt: active.content.issuedAt, ...activeOptions },
      registry,
      TEST_DESTINATION_REGISTRY,
    ).ok,
    false,
  );

  const expired = buildRecord({
    issuedAt: canonicalInstantAt(now - 30 * 60_000),
    signedAt: canonicalInstantAt(now - 20 * 60_000),
    expiresAt: canonicalInstantAt(now - 5 * 60_000),
  });
  assert.equal(
    verifyProductionDeploymentIntentAtTrustedClockWithTestRegistry(
      expired,
      productionOptionsFor(expired),
      registry,
      TEST_DESTINATION_REGISTRY,
    ).ok,
    false,
  );
});

test('cached report freshness and revalidation fail closed at the exact expiration instant', () => {
  const record = buildRecord();
  const report = verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
    record,
    productionOptionsFor(record),
    TEST_REGISTRY,
    TEST_DESTINATION_REGISTRY,
    [clockReading(EVALUATED_AT, 1_000), clockReading('2026-09-07T12:10:01Z', 2_000)],
  );
  assert.equal(report.ok, true);
  assert.equal(report.productionAuthorityValidated, false);
  assert.equal(report.executionAllowed, false);
  assert.equal(isProductionAuthorizedDeploymentIntentReport(report), false);
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      report,
      clockReading('2026-09-07T12:29:59Z', 1_200_000),
    ),
    true,
  );
  assert.equal(
    revalidateUnbrandedDeploymentIntentReportAtForTest(
      report,
      clockReading('2026-09-07T12:29:59Z', 1_200_001),
    ),
    report,
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(report, clockReading(EXPIRES_AT, 1_201_000)),
    false,
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      report,
      clockReading('2026-09-07T12:15:00Z', 1_202_000),
    ),
    false,
  );
  assert.throws(
    () =>
      revalidateUnbrandedDeploymentIntentReportAtForTest(
        report,
        clockReading('2026-09-07T12:20:00Z', 1_203_000),
      ),
    { name: 'ProductionDeploymentIntentInvalidError' },
  );
  assert.throws(() => revalidateProductionDeploymentIntentReportForApplication(report), {
    name: 'ProductionDeploymentIntentInvalidError',
  });
});

test('authorization lifecycle makes observed clock rollback sticky and rejects unsafe double reads', () => {
  const record = buildRecord();
  const productionOptions = productionOptionsFor(record);
  const wallRollbackDuringVerification =
    verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
      record,
      productionOptions,
      TEST_REGISTRY,
      TEST_DESTINATION_REGISTRY,
      [clockReading(EVALUATED_AT, 1_000), clockReading('2026-09-07T12:09:59Z', 2_000)],
    );
  assert.equal(wallRollbackDuringVerification.ok, false);

  const monotonicRollbackDuringVerification =
    verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
      record,
      productionOptions,
      TEST_REGISTRY,
      TEST_DESTINATION_REGISTRY,
      [clockReading(EVALUATED_AT, 1_000), clockReading('2026-09-07T12:10:01Z', 999)],
    );
  assert.equal(monotonicRollbackDuringVerification.ok, false);

  const expiredDuringVerification = verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
    record,
    productionOptions,
    TEST_REGISTRY,
    TEST_DESTINATION_REGISTRY,
    [clockReading(EVALUATED_AT, 1_000), clockReading(EXPIRES_AT, 1_201_000)],
  );
  assert.equal(expiredDuringVerification.ok, false);

  const report = verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
    record,
    productionOptions,
    TEST_REGISTRY,
    TEST_DESTINATION_REGISTRY,
    [clockReading(EVALUATED_AT, 1_000), clockReading('2026-09-07T12:10:01Z', 2_000)],
  );
  assert.equal(report.ok, true);
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      report,
      clockReading('2026-09-07T12:20:00Z', 600_000),
    ),
    true,
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      report,
      clockReading('2026-09-07T12:19:59Z', 601_000),
    ),
    false,
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      report,
      clockReading('2026-09-07T12:21:00Z', 700_000),
    ),
    false,
  );

  const monotonicReport = verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
    record,
    productionOptions,
    TEST_REGISTRY,
    TEST_DESTINATION_REGISTRY,
    [clockReading(EVALUATED_AT, 1_000), clockReading('2026-09-07T12:10:01Z', 2_000)],
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      monotonicReport,
      clockReading('2026-09-07T12:20:00Z', 600_000),
    ),
    true,
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      monotonicReport,
      clockReading('2026-09-07T12:20:01Z', 599_999),
    ),
    false,
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      monotonicReport,
      clockReading('2026-09-07T12:21:00Z', 700_000),
    ),
    false,
  );

  const deadlineReport = verifyProductionDeploymentIntentAuthorizationLifecycleForTest(
    record,
    productionOptions,
    TEST_REGISTRY,
    TEST_DESTINATION_REGISTRY,
    [clockReading(EVALUATED_AT, 1_000), clockReading('2026-09-07T12:10:01Z', 2_000)],
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      deadlineReport,
      clockReading('2026-09-07T12:20:00Z', 1_201_000),
    ),
    false,
  );
  assert.equal(
    isUnbrandedDeploymentIntentReportFreshAtForTest(
      deadlineReport,
      clockReading('2026-09-07T12:20:01Z', 700_000),
    ),
    false,
  );
});

test('rejects expired, future, caller-expected predecessor mismatches, and wrong bindings', () => {
  const record = buildRecord();
  const invalidOptions = [
    optionsFor(record, { evaluatedAt: EXPIRES_AT }),
    optionsFor(record, { evaluatedAt: '2026-09-07T11:59:59Z' }),
    optionsFor(record, { expectedIntentSha256: 'e'.repeat(64) }),
    optionsFor(record, { expectedSequence: 2 }),
    optionsFor(record, { expectedDestinationId: 'different-production-destination' }),
    optionsFor(record, { expectedDestinationSha256: 'a'.repeat(64) }),
    optionsFor(record, { expectedDestinationEpochId: 'b'.repeat(64) }),
    optionsFor(record, { expectedDestinationRegistrySha256: 'c'.repeat(64) }),
    optionsFor(record, { expectedPublicOrigin: 'https://other.example.com' }),
    optionsFor(record, { expectedPredecessorSequence: 1 }),
    optionsFor(record, { expectedPredecessorCommittedHeadSha256: 'd'.repeat(64) }),
    optionsFor(record, { expectedPredecessorIntentSha256: record.intentSha256 }),
    optionsFor(record, { expectedPredecessorReservationSha256: 'e'.repeat(64) }),
    optionsFor(record, { expectedPredecessorResultSha256: 'd'.repeat(64) }),
    optionsFor(record, { expectedAbortedProvisionIntentSha256: 'a'.repeat(64) }),
    optionsFor(record, { expectedAbortedProvisionReservationSha256: 'b'.repeat(64) }),
    optionsFor(record, { expectedOperation: 'DELETE' }),
    optionsFor(record, { expectedSourceRevision: 'b'.repeat(40) }),
    optionsFor(record, { expectedReleaseCandidateManifestSha256: 'b'.repeat(64) }),
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

  const driftedDestination = structuredClone(record);
  driftedDestination.content.destinationBinding.destinationSha256 = 'b'.repeat(64);
  mutations.push(driftedDestination);

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

test('rejects an identity authority key and forged identity signature before Node trust', () => {
  const identityRaw = Buffer.alloc(32);
  identityRaw[0] = 1;
  const identitySpki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), identityRaw]);
  const forgedSignature = Buffer.concat([identityRaw, Buffer.alloc(32)]);
  const record = buildRecord();
  record.signatures[0].valueBase64 = forgedSignature.toString('base64');
  const registry = structuredClone(TEST_REGISTRY);
  registry.keys[0].publicKeySpkiDerBase64 = identitySpki.toString('base64');
  const signature = record.signatures[0];
  const unsigned = {
    schemaVersion: record.schemaVersion,
    artifactType: record.artifactType,
    intentSha256: record.intentSha256,
    content: record.content,
  };
  assert.equal(
    verifySignature(
      null,
      productionDeploymentIntentSigningBytes(unsigned, {
        role: signature.role,
        scope: signature.scope,
        authorityKeyId: signature.authorityKeyId,
        signedAt: signature.signedAt,
      }),
      createPublicKey({ key: identitySpki, format: 'der', type: 'spki' }),
      forgedSignature,
    ),
    true,
  );
  assert.equal(verifyWithTestRegistry(record, optionsFor(record), registry).ok, false);
});

test('emergency kill, rollback, delete, and read-only activation cannot increase forbidden authority', () => {
  const unsafeCases = [
    {
      operation: 'EMERGENCY_KILL',
      currentState: state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
      proposedState: state('KILLED_INERT', READ_ONLY_AUTHORITY),
    },
    {
      operation: 'ROLLBACK',
      currentState: state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
      proposedState: state('READ_ONLY_ACTIVE', {
        ...READ_ONLY_AUTHORITY,
        apiDesiredCount: 3,
      }),
    },
    {
      operation: 'DELETE',
      currentState: state('READ_ONLY_ACTIVE', READ_ONLY_AUTHORITY),
      proposedState: state('DELETED'),
    },
    {
      operation: 'ACTIVATE_READ_ONLY',
      currentState: state('INERT_DEPLOYED'),
      proposedState: state('READ_ONLY_ACTIVE', {
        ...READ_ONLY_AUTHORITY,
        financialWritesEnabled: true,
      }),
    },
  ];
  for (const candidate of unsafeCases) {
    assert.throws(() => productionDeploymentIntentContentSha256(buildContent(candidate)));
  }

  const kill = buildRecord({ operation: 'EMERGENCY_KILL' });
  assert.equal(verifyWithTestRegistry(kill).ok, true);
  assert.equal(kill.content.proposedState.authority.apiDesiredCount, 0);
  assert.equal(kill.content.proposedState.authority.externalEgressMode, 'NO_EXTERNAL_EGRESS');
  assert.deepEqual(kill.content.proposedState.authority.allowedNetworkIds, []);
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
        TEST_DESTINATION_REGISTRY,
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
  activated.content.proposedState.authority.apiDesiredCount = 1;
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
